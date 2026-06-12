/* ============================================================
   ST Engineering Solutions — Asset store (Supabase-backed)

   Reads/writes the shared Supabase database. An in-memory cache
   (currentAssets) keeps the synchronous list()/get() API the
   pages already use; components subscribe via useAssets() and
   re-render when the cache changes. Current status/location/
   revenue are still CALCULATED here (recompute) from the event
   history, so the database only stores raw assets + events.
   ============================================================ */
import { useSyncExternalStore, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CITIES, COMMON_CUSTOMERS } from './mockData';

const DAY = 86400000;
const TODAY_MS = Math.max(Date.parse("2026-06-04T00:00:00Z"), Date.now());
const dateMs = (d) => Date.parse(d + "T00:00:00Z");

export const AssetCalc = {
  TODAY_MS,
  isRated: (e) => e.dailyFee != null || e.monthlyRevenue != null || e.exchangeFee != null || e.recertFee != null || e.salePrice != null,
  leaseDays(hist, i) {
    const e = hist[i];
    if (!this.isRated(e)) return e.leaseDays != null ? e.leaseDays : null;
    if (e.cat !== "out" || e.contractType === "Exchange") return null;
    const start = dateMs(e.date);
    const end = i + 1 < hist.length ? dateMs(hist[i + 1].date) : TODAY_MS;
    return Math.max(0, Math.round((end - start) / DAY));
  },
  revenue(e, days) {
    if (e.dailyFee != null) return (e.dailyFee || 0) * (days || 0);
    if (e.monthlyRevenue != null) return (e.monthlyRevenue || 0) * (days || 0) / (365.25 / 12);
    if (e.exchangeFee != null) return e.exchangeFee || 0;
    if (e.recertFee != null) return e.recertFee || 0;
    if (e.salePrice != null) return e.salePrice || 0;
    return e.revenue || 0;
  },
};

function recompute(a) {
  const ev = (a.history || []).slice().sort((x, y) =>
    x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  a.history = ev;
  // Chain each event's "from" to where the asset was after the previous event,
  // so renaming/correcting a location flows through to later events' origin (and
  // keeps every from a valid city). The first event keeps its own origin — null,
  // or the acquisition source (Collins/Safran/etc.) which lives on e.source.
  let loc = null;
  ev.forEach((e, i) => {
    if (i === 0) { loc = e.to || e.from || loc; return; }
    e.from = loc;
    if (e.to) loc = e.to;
  });
  ev.forEach((e, i) => {
    if (!AssetCalc.isRated(e)) return;
    if (e.cat === "out" && e.contractType !== "Exchange") e.leaseDays = AssetCalc.leaseDays(ev, i);
    e.revenue = AssetCalc.revenue(e, e.leaseDays);
  });
  a.initialPartNumber = a.initialPartNumber || (ev[0] && ev[0].pn) || a.partNumber || "";
  if (ev.length) {
    const last = ev[ev.length - 1];
    a.status = last.status || a.status;
    a.lastUpdated = last.date;
    a.location = last.to || last.from || a.location;
    for (let i = ev.length - 1; i >= 0; i--) { if (ev[i].pn) { a.partNumber = ev[i].pn; break; } }
    a.previousStatus = null;
    for (let i = ev.length - 2; i >= 0; i--) {
      if (ev[i].status && ev[i].status !== a.status) { a.previousStatus = ev[i].status; break; }
    }
    if (a.status === "Out on lease") {
      for (let i = ev.length - 1; i >= 0; i--) {
        if (ev[i].cat === "out") {
          a.engagementType = ev[i].contractType || null;
          a.contractYears = ev[i].contractYears || null;
          a.customer = ev[i].customer || null;
          break;
        }
      }
    } else { a.engagementType = null; a.contractYears = null; }
  }
  a.totalRevenue = ev.reduce((s, e) => s + (e.revenue || 0), 0);
  a.daysOnLease = ev.reduce((s, e) => s + (e.leaseDays || 0), 0);
  a.pnChanged = !!a.partNumber && a.partNumber !== a.initialPartNumber;
  const lastEv = ev[ev.length - 1];
  a.retired = !!(lastEv && lastEv.cat === "end");
  a.retiredReason = a.retired ? lastEv.event : null;
  a.retiredDate = a.retired ? lastEv.date : null;
  return a;
}

/* ---------------- in-memory cache + subscription ---------------- */
let currentAssets = [];
let customerNames = [];
const BASE_CITY_NAMES = Object.keys(CITIES);
let cityNamesCache = BASE_CITY_NAMES.slice().sort();   // all selectable location names
let cityMapCache = CITIES;                             // name -> { lat, lon, country, type }
function rebuildCities(extra) {
  cityMapCache = { ...CITIES, ...extra };
  cityNamesCache = Object.keys(cityMapCache).sort();
}
let version = 0;
let status = "idle";        // idle | loading | ready | error
let loadError = null;
const listeners = new Set();
function notify() { version += 1; listeners.forEach((fn) => fn()); }
function subscribeAssets(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ---------------- DB row <-> app object mapping ---------------- */
function rowToEvent(e) {
  return {
    date: e.event_date, event: e.event_type, cat: e.category, status: e.status,
    from: e.from_city, to: e.to_city, customer: e.customer, source: e.source || null,
    contractType: e.contract_type, contractYears: e.contract_years,
    dailyFee: e.daily_fee, monthlyRevenue: e.monthly_revenue, exchangeFee: e.exchange_fee,
    recertFee: e.recert_fee, salePrice: e.sale_price, pn: e.part_number, notes: e.notes,
  };
}
function rowToAsset(a, events) {
  return recompute({
    _id: a.id, assetNumber: a.asset_number, aircraftType: a.aircraft_type, nacelle: a.nacelle,
    description: a.description, ownership: a.ownership, initialPartNumber: a.initial_part_number,
    partNumber: a.initial_part_number, clp: a.clp, acquisitionValue: a.acquisition_value,
    dailyRate: a.daily_rate || 0, depMethod: a.dep_method, depLife: a.dep_life_years,
    depResidual: a.dep_residual, depOverride: a.dep_override, exchangeCore: a.exchange_core,
    depAdjustments: a.dep_adjustments || [],
    history: (events || []).map(rowToEvent),
  });
}
function assetToRow(a) {
  const row = {
    asset_number: a.assetNumber, aircraft_type: a.aircraftType, nacelle: a.nacelle,
    description: a.description || null, ownership: a.ownership || "Owned",
    initial_part_number: a.initialPartNumber || a.partNumber || "",
    clp: a.clp ?? null, acquisition_value: a.acquisitionValue ?? null, daily_rate: a.dailyRate || 0,
    dep_method: a.depMethod || "Straight-line", dep_life_years: a.depLife ?? null,
    dep_residual: a.depResidual ?? 0, dep_override: a.depOverride || null, exchange_core: !!a.exchangeCore,
  };
  // only send adjustments when present, so saves still work before the dep_adjustments column is added
  if (a.depAdjustments && a.depAdjustments.length) row.dep_adjustments = a.depAdjustments;
  return row;
}
function eventToRow(e, assetId) {
  const row = {
    asset_id: assetId, event_date: e.date, event_type: e.event, category: e.cat, status: e.status,
    from_city: e.from || null, to_city: e.to || null, customer: e.customer || null,
    contract_type: e.contractType || null, contract_years: e.contractYears ?? null,
    daily_fee: e.dailyFee ?? null, monthly_revenue: e.monthlyRevenue ?? null, exchange_fee: e.exchangeFee ?? null,
    recert_fee: e.recertFee ?? null, sale_price: e.salePrice ?? null, part_number: e.pn || null, notes: e.notes || null,
  };
  // only send `source` when set, so saves still work before the source column is added
  if (e.source) row.source = e.source;
  return row;
}

/* one-time population of the reference lists (cities for the globe/pickers,
   customers for the dropdown) so the app behaves like before */
async function seedReferenceData() {
  const { count: cityCount } = await supabase.from("cities").select("*", { count: "exact", head: true });
  if (!cityCount) {
    const rows = Object.keys(CITIES).map((name) => ({
      name, lat: CITIES[name].lat, lon: CITIES[name].lon,
      country: CITIES[name].country || "", city_type: CITIES[name].type || "customer",
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("cities").upsert(rows.slice(i, i + 500), { onConflict: "name" });
    }
  }
  const { count: custCount } = await supabase.from("customers").select("*", { count: "exact", head: true });
  if (!custCount) {
    const rows = COMMON_CUSTOMERS.map((name) => ({ name, is_lessor: /lessor|Collins|Safran|AJW/i.test(name) }));
    await supabase.from("customers").upsert(rows, { onConflict: "name" });
  }
}

async function loadAssets() {
  if (status === "loading") return;
  status = "loading"; loadError = null; notify();
  try {
    await seedReferenceData();
    const { data: assetRows, error: e1 } = await supabase
      .from("assets").select("*").is("deleted_at", null).order("asset_number");
    if (e1) throw e1;
    let eventRows = [];
    const ids = (assetRows || []).map((a) => a.id);
    if (ids.length) {
      const { data: ev, error: e2 } = await supabase.from("asset_events").select("*").in("asset_id", ids);
      if (e2) throw e2;
      eventRows = ev || [];
    }
    const byAsset = {};
    eventRows.forEach((e) => { (byAsset[e.asset_id] = byAsset[e.asset_id] || []).push(e); });
    Object.values(byAsset).forEach((l) => l.sort((x, y) => (x.event_date < y.event_date ? -1 : x.event_date > y.event_date ? 1 : 0)));
    currentAssets = (assetRows || []).map((a) => rowToAsset(a, byAsset[a.id]));
    const { data: custs } = await supabase.from("customers").select("name").order("name");
    customerNames = (custs || []).map((c) => c.name);
    try {
      const { data: extra } = await supabase.from("cities").select("name,lat,lon,country,city_type").eq("added", true);
      const map = {};
      (extra || []).forEach((c) => { map[c.name] = { lat: c.lat, lon: c.lon, country: c.country, type: c.city_type }; });
      rebuildCities(map);
    } catch (e) { /* 'added' column may not exist yet — fine */ }
    status = "ready";
  } catch (err) {
    loadError = err; status = "error";
    console.error("Supabase load failed:", err);
  } finally {
    notify();
  }
}

// best-effort audit entry: who did what to which asset, when (never blocks the save)
async function logAction(action, assetNumber, summary) {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data && data.user;
    if (!user) return;
    await supabase.from("audit_log").insert({
      user_id: user.id, user_email: user.email, action, asset_number: assetNumber, summary,
    });
  } catch (e) { /* audit is best-effort — don't disrupt the user */ }
}

export const AssetStore = {
  list: () => currentAssets.filter((a) => !a.retired),     // active — Register / Editor / globe
  listAll: () => currentAssets,                            // everything incl. retired — Analytics
  listArchived: () => currentAssets.filter((a) => a.retired), // retired — Editor historical view
  customerList: () => customerNames,                       // customers known to the database
  cityList: () => cityNamesCache,                          // all selectable location names
  cityMap: () => cityMapCache,                             // name -> { lat, lon, country, type }
  async addCity({ name, country, lat, lon, type }) {
    const row = { name, country: country || "", lat: Number(lat), lon: Number(lon), city_type: type || "customer", added: true };
    const { error } = await supabase.from("cities").upsert(row, { onConflict: "name" });
    if (error) throw error;
    rebuildCities({ ...cityMapCache, [name]: { lat: row.lat, lon: row.lon, country: row.country, type: row.city_type } });
    notify();
  },
  get: (id) => currentAssets.find((a) => a.assetNumber === id),
  status: () => status,
  error: () => loadError,
  reload: loadAssets,

  async save(asset) {
    const existed = !!currentAssets.find((x) => x.assetNumber === asset.assetNumber);
    const { data: up, error: e1 } = await supabase
      .from("assets").upsert(assetToRow(asset), { onConflict: "asset_number" }).select("id").single();
    if (e1) throw e1;
    const id = up.id;
    const { error: eDel } = await supabase.from("asset_events").delete().eq("asset_id", id);
    if (eDel) throw eDel;
    const rows = (asset.history || []).map((e) => eventToRow(e, id));
    if (rows.length) {
      const { error: eIns } = await supabase.from("asset_events").insert(rows);
      if (eIns) throw eIns;
    }
    // any customer typed on an event that isn't in the list yet gets added,
    // so it shows up in the dropdown for everyone next time
    const newCustomers = [...new Set((asset.history || []).map((e) => e.customer).filter(Boolean))]
      .filter((n) => !customerNames.includes(n));
    if (newCustomers.length) {
      try { await supabase.from("customers").upsert(newCustomers.map((name) => ({ name })), { onConflict: "name" }); } catch (e) {}
    }
    await logAction(existed ? "edited" : "created", asset.assetNumber,
      asset.description || `${asset.aircraftType || ""} ${asset.nacelle || ""}`.trim());
    await loadAssets();
  },

  async remove(id) {
    const a = currentAssets.find((x) => x.assetNumber === id);
    if (a && a._id) {
      const { error } = await supabase.from("assets").update({ deleted_at: new Date().toISOString() }).eq("id", a._id);
      if (error) throw error;
    }
    await logAction("removed", id, a ? (a.description || `${a.aircraftType || ""} ${a.nacelle || ""}`.trim()) : "");
    await loadAssets();
  },

  nextNumber() {
    let max = 10000;
    currentAssets.forEach((a) => {
      const n = parseInt(String(a.assetNumber).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return "STE-" + (max + 1);
  },

  recompute,
  // edit-layer concepts from the old localStorage model no longer apply
  isBase: () => false, isEdited: () => false, isAdded: () => false, editCount: () => 0,
  revert: () => {}, resetAll: () => {},
};

/* React hook: subscribe to the cache and trigger the first load */
export function useAssets() {
  const v = useSyncExternalStore(subscribeAssets, () => version, () => version);
  useEffect(() => { if (status === "idle") loadAssets(); }, []);
  return v;
}
export function assetsStatus() { return status; }
