-- ============================================================================
-- Step 8 — Login, approval & security (run this in the Supabase SQL Editor)
--
-- What it does, in plain terms:
--   1. Adds approval fields to the profiles table.
--   2. Auto-creates a "pending" profile whenever someone signs up.
--   3. Adds helper checks (is this person approved? an editor? an admin?).
--   4. Turns ON Row Level Security so the database only answers signed-in,
--      approved people — and only lets editors/admins make changes.
--
-- After running this, sign up once on the live site, then run the small
-- "make me an admin" snippet at the very bottom (edit the email first).
-- ============================================================================

-- 1. approval fields on profiles --------------------------------------------
alter table profiles add column if not exists approved     boolean     not null default false;
alter table profiles add column if not exists email        text;
alter table profiles add column if not exists requested_at timestamptz not null default now();

-- 2. auto-create a pending profile on sign-up -------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role, approved)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'display_name', new.email),
          'viewer', false)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 3. permission helpers (security definer = they can read profiles safely) --
create or replace function is_approved() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select approved from profiles where id = auth.uid()), false); $$;

create or replace function my_role() returns text
  language sql security definer stable set search_path = public as $$
  select role from profiles where id = auth.uid(); $$;

create or replace function can_write() returns boolean
  language sql security definer stable set search_path = public as $$
  select is_approved() and my_role() in ('editor','admin'); $$;

create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select is_approved() and my_role() = 'admin'; $$;

-- 4. turn on Row Level Security + policies -----------------------------------
alter table assets        enable row level security;
alter table asset_events  enable row level security;
alter table cities        enable row level security;
alter table customers     enable row level security;
alter table profiles      enable row level security;

-- approved people can read the data; editors/admins can change it
-- (drop-if-exists first so this whole file is safe to re-run)
drop policy if exists "assets read"  on assets;        create policy "assets read"  on assets       for select using (is_approved());
drop policy if exists "assets write" on assets;        create policy "assets write" on assets       for all    using (can_write()) with check (can_write());
drop policy if exists "events read"  on asset_events;  create policy "events read"  on asset_events for select using (is_approved());
drop policy if exists "events write" on asset_events;  create policy "events write" on asset_events for all    using (can_write()) with check (can_write());
drop policy if exists "cities read"  on cities;        create policy "cities read"  on cities       for select using (is_approved());
drop policy if exists "cities write" on cities;        create policy "cities write" on cities       for all    using (can_write()) with check (can_write());
drop policy if exists "cust read"    on customers;     create policy "cust read"    on customers    for select using (is_approved());
drop policy if exists "cust write"   on customers;     create policy "cust write"   on customers    for all    using (can_write()) with check (can_write());

-- profiles: you can see your own; admins can see & manage everyone
drop policy if exists "profile self read"   on profiles; create policy "profile self read"   on profiles for select using (id = auth.uid() or is_admin());
drop policy if exists "profile self insert" on profiles; create policy "profile self insert" on profiles for insert with check (id = auth.uid());
drop policy if exists "profile admin write" on profiles; create policy "profile admin write" on profiles for update using (is_admin()) with check (is_admin());

-- ============================================================================
-- AFTER you have signed up once on the live site, make yourself the first
-- admin by running this (replace the email with the one you signed up with):
--
--   update profiles set approved = true, role = 'admin'
--   where email = 'you@stengg.com';
--
-- From then on you can approve everyone else from the in-app "Users" page.
-- ============================================================================
