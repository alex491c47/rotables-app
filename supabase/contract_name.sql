-- ============================================================================
-- The name of the contract a lease / exchange / removal falls under (e.g. a
-- named support agreement). Optional — left blank when the activity is outside
-- any contract. Feeds the per-customer view (group support by contract). Run once.
-- ============================================================================
alter table asset_events add column if not exists contract_name text;
