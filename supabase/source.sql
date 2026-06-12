-- ============================================================================
-- Adds where an asset was acquired FROM (e.g. Collins, Safran, a lessor or a
-- teardown company). This can't live in from_city — that column is a foreign key
-- into the cities table, and a supplier isn't a city — so it gets its own column.
-- Shown as the origin on an asset's first timeline event in place of "facility".
-- Run once. Safe to re-run.
-- ============================================================================
alter table asset_events add column if not exists source text;
