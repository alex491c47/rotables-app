-- ============================================================================
-- Monthly depreciation write-downs / impairments.
-- Adds a place on each asset to record one-off depreciation in a given month
-- (e.g. fire or accident damage). Run once in the Supabase SQL Editor.
--
-- Each entry is { "month": "YYYY-MM", "amount": <USD>, "note": "..." }.
-- The app books that amount as extra depreciation in that month, so the
-- asset's net book value drops by it from then on.
-- ============================================================================
alter table assets add column if not exists dep_adjustments jsonb not null default '[]'::jsonb;
