# Database (Supabase) — plan & setup notes

This folder holds the **database design** for the platform. It does not affect the
live app yet — it's the blueprint we'll use when we create the real database.

## `schema.sql`
The full database definition. In plain terms it creates:

| Table | What it holds |
|-------|---------------|
| `assets` | One row per nacelle asset — the fixed facts (number, type, ownership, finance). |
| `asset_events` | The history — one row per movement/event for an asset. |
| `cities` | The list of locations (feeds the globe & the location pickers). |
| `customers` | Airlines & lessors (feeds the customer dropdown; you can add new ones). |
| `profiles` | One row per signed-in user — used later for who-can-do-what (roles). |
| `assets_current` | Not a table — a live calculation of each asset's current status, location and revenue from its events. |

### Decisions locked in
- Current status / location / revenue are **calculated from the events**, never stored — so they can't go stale or disagree between people.
- Asset numbers are **typed by you and must be unique**; a hidden internal ID keeps history attached even if a number is corrected.
- **Cities** must come from the list; **customers** come from a list you can add to.
- Money is **USD** for now.
- Removing an asset is a **soft delete** (archived, recoverable) — nothing is truly erased.

## Next: Step 5 — create the Supabase project (manual, in the browser)
When you're ready, you'll:
1. Create a free Supabase account and a new project.
2. Open the project's **SQL Editor**, paste in `schema.sql`, and run it.
3. Send me the project's **URL** and **anon key** (safe to use in the app).

I'll then wire the app to it (Step 6) and switch it from demo data to the real
database (Step 7). Authentication (Step 8) and roles (Step 10) come after.
