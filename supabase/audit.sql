-- ============================================================================
-- Audit trail — a log of who created / edited / removed which asset, and when.
-- Run this once in the Supabase SQL Editor. Safe to re-run.
-- (Relies on the is_approved() helper created in auth.sql.)
-- ============================================================================
create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  user_id       uuid,
  user_email    text,
  action        text not null,        -- 'created' | 'edited' | 'removed'
  asset_number  text,
  summary       text
);
create index if not exists audit_log_at_idx on audit_log (at desc);

alter table audit_log enable row level security;

-- approved users can read the log; you can only write log rows as yourself
drop policy if exists "audit read"   on audit_log;
create policy "audit read"   on audit_log for select using (is_approved());
drop policy if exists "audit insert" on audit_log;
create policy "audit insert" on audit_log for insert with check (is_approved() and user_id = auth.uid());
