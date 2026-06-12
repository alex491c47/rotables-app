-- ============================================================================
-- Lets users add a new location/hub that isn't in the seeded airport list.
-- Adds an "added" flag so the app can load just the user-added ones quickly
-- (the ~3,100 seeded airports already live in the app). Run once. Safe to re-run.
-- ============================================================================
alter table cities add column if not exists added boolean not null default false;
