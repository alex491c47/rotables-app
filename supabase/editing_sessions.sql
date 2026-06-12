-- ============================================================================
-- Lightweight "who's editing what" presence, so the Editor can warn you when
-- someone else already has the same asset open (avoids two people overwriting
-- each other). One row per (asset, user); the app heartbeats updated_at while the
-- asset is open and deletes the row on leave. Rows older than ~2 min are treated
-- as stale by the app. Run once. Safe to re-run.
-- ============================================================================
create table if not exists editing_sessions (
  asset_number text not null,
  user_id      uuid not null,
  user_email   text,
  updated_at   timestamptz not null default now(),
  primary key (asset_number, user_id)
);

alter table editing_sessions enable row level security;

-- everyone signed in can see who's editing
drop policy if exists "editing read" on editing_sessions;
create policy "editing read" on editing_sessions for select to authenticated using (true);

-- but you may only write/clear your OWN presence rows
drop policy if exists "editing write own" on editing_sessions;
create policy "editing write own" on editing_sessions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
