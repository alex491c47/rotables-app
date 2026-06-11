-- ============================================================================
-- ST Engineering Solutions — Nacelle Asset Operations
-- Supabase / PostgreSQL schema (Step 4 of the build plan)
--
-- Plain-language overview:
--   • assets        — one row per physical nacelle asset (the fixed facts)
--   • asset_events  — the history; many rows per asset, one per movement/event
--   • cities        — reference list feeding the globe + location pickers
--   • customers     — reference list feeding the customer dropdown
--   • profiles      — one row per signed-in user (used later for roles)
--
-- Design decisions baked in:
--   • Current status / location / current part number / total revenue / days on
--     lease are NOT stored. They are calculated from asset_events (the app's
--     recompute), so they can never drift out of sync between users. A read-only
--     view (assets_current) reproduces that calculation for direct queries.
--   • asset_number is the human-typed business key (unique); a hidden uuid id is
--     the real key, so renaming an asset never detaches its history.
--   • Cities must come from the cities table; customers are a list you can add to.
--   • All money is USD for now (a currency column can be added later).
--   • Deleting is soft (deleted_at) — records are archived, never truly lost.
-- ============================================================================

-- ---------- reference list: cities -----------------------------------------
create table if not exists cities (
  name        text primary key,                 -- e.g. 'Stockholm', 'Singapore'
  lat         double precision not null,
  lon         double precision not null,
  country     text not null,
  city_type   text not null default 'customer'
              check (city_type in ('hub','customer'))
);

-- ---------- reference list: customers --------------------------------------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,             -- airline or lessor name
  is_lessor   boolean not null default false    -- true for Collins/Safran/AJW etc.
);

-- ---------- main table: assets (the fixed facts) ---------------------------
create table if not exists assets (
  id                  uuid primary key default gen_random_uuid(),  -- hidden real key
  asset_number        text unique not null,      -- human key, e.g. 'STE-10042'
  aircraft_type       text not null,             -- 'A320LEAP', 'B787GENX', ...
  nacelle             text not null,             -- Thrust Reverser / Inlet Cowl / ...
  description         text,
  ownership           text not null
                      check (ownership in ('Owned','Long-term lease','Short-term lease')),
  initial_part_number text not null,             -- as-delivered P/N (never changes)
  -- finance (nullable: short-term leases carry none, others fall back to CLP table)
  clp                 numeric,                   -- catalogue list price (USD)
  acquisition_value   numeric,                   -- basis for NBV & depreciation (USD)
  daily_rate          numeric default 0,         -- short-term lease-in cost / day (USD)
  dep_method          text default 'Straight-line'
                      check (dep_method in ('Straight-line','Declining balance')),
  dep_life_years      numeric,
  dep_residual        numeric default 0,         -- fraction 0..1
  dep_override        jsonb,                     -- optional {life, residual, from}
  exchange_core       boolean default false,
  -- bookkeeping
  deleted_at          timestamptz,               -- soft delete / archive
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid                       -- references auth.users (added with sign-in)
);

-- ---------- main table: asset_events (the history) -------------------------
create table if not exists asset_events (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references assets(id) on delete cascade,
  event_date      date not null,
  event_type      text not null,                 -- 'Induction','Short-term lease','Returned — end of lease', ...
  category        text not null
                  check (category in ('out','in','move','shop','end')),
  status          text not null,                 -- WIP / Ready to ship / Out on lease / Returned / Sold / Retired / Destroyed
  from_city       text references cities(name),
  to_city         text references cities(name),
  customer        text,                          -- kept as text; matches a customers.name
  contract_type   text check (contract_type in ('Short-term lease','Long-term lease','Exchange')),
  contract_years  numeric,
  -- fee inputs only — revenue/leaseDays are calculated, never stored
  daily_fee       numeric,
  monthly_revenue numeric,
  exchange_fee    numeric,
  recert_fee      numeric,
  sale_price      numeric,                        -- one-off, on outright sale
  part_number     text,                           -- set when the P/N changes
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);
create index if not exists asset_events_asset_date_idx
  on asset_events (asset_id, event_date);

-- ---------- users (groundwork for sign-in & roles, steps 8 & 10) -----------
create table if not exists profiles (
  id            uuid primary key,                 -- references auth.users(id)
  display_name  text,
  role          text not null default 'editor'
                check (role in ('viewer','editor','admin'))
);

-- ---------- assets_current: the calculated current state -------------------
-- Read-only convenience view that reproduces the app's recompute() in SQL, so
-- reports / direct queries see the same derived figures the app shows.
create or replace view assets_current as
with ev as (
  select
    e.*,
    row_number() over (partition by e.asset_id order by e.event_date, e.id) as seq,
    count(*)     over (partition by e.asset_id) as ev_count,
    lead(e.event_date) over (partition by e.asset_id order by e.event_date, e.id) as next_date
  from asset_events e
),
per_event as (
  select
    ev.*,
    case
      when ev.category = 'out' and coalesce(ev.contract_type,'') <> 'Exchange'
        then greatest(0, coalesce(ev.next_date, current_date) - ev.event_date)
    end as lease_days
  from ev
),
revenue as (
  select
    pe.*,
    coalesce(
      pe.daily_fee       * pe.lease_days,
      pe.monthly_revenue * pe.lease_days / (365.25/12),
      pe.exchange_fee,
      pe.recert_fee,
      pe.sale_price,
      0
    ) as event_revenue
  from per_event pe
),
last_ev as (
  select distinct on (asset_id) asset_id, status, to_city, from_city, event_date, category, event_type
  from revenue order by asset_id, event_date desc, id desc
)
select
  a.*,
  l.status                                   as current_status,
  coalesce(l.to_city, l.from_city)           as current_location,
  (l.category = 'end')                       as retired,
  case when l.category = 'end' then l.event_type end as retired_reason,
  case when l.category = 'end' then l.event_date end as retired_date,
  (select sum(event_revenue) from revenue r where r.asset_id = a.id) as total_revenue,
  (select sum(lease_days)    from revenue r where r.asset_id = a.id) as days_on_lease
from assets a
left join last_ev l on l.asset_id = a.id
where a.deleted_at is null;

-- ============================================================================
-- Row Level Security (added with the sign-in step — left here as a reminder):
--   alter table assets        enable row level security;
--   alter table asset_events  enable row level security;
--   -- everyone signed in can read; editors/admins can write; only admins delete.
-- ============================================================================
