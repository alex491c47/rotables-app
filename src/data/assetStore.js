/* ============================================================
   ST Engineering Solutions — Asset edit store
   Overlays user edits (localStorage) on top of the generated
   ASSET_DATA so changes flow into the Register, Analytics &
   Editor views.
   ============================================================ */
import { ASSET_DATA } from './mockData';

const KEY = "ste_asset_edits_hv2";
const base = ASSET_DATA.slice();
const baseById = {};
base.forEach((a) => (baseById[a.assetNumber] = a));

const clone = (o) => JSON.parse(JSON.stringify(o));
const DAY = 86400000;
const TODAY_MS = Math.max(Date.parse("2026-06-04T00:00:00Z"), Date.now());
const dateMs = (d) => Date.parse(d + "T00:00:00Z");

export const AssetCalc = {
  TODAY_MS,
  isRated: (e) => e.dailyFee != null || e.monthlyRevenue != null || e.exchangeFee != null || e.recertFee != null,
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
    return e.revenue || 0;
  },
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
let store = load();
store.edits = store.edits || {};
store.added = store.added || [];
store.deleted = store.deleted || [];
function persist() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

function recompute(a) {
  const ev = (a.history || []).slice().sort((x, y) =>
    x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  a.history = ev;
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
  return a;
}

let currentAssets = [];

function build() {
  const deleted = new Set(store.deleted);
  const merged = [];
  base.forEach((a) => {
    if (deleted.has(a.assetNumber)) return;
    merged.push(store.edits[a.assetNumber] ? recompute(clone(store.edits[a.assetNumber])) : a);
  });
  store.added.forEach((a) => { if (!deleted.has(a.assetNumber)) merged.push(recompute(clone(a))); });
  merged.sort((x, y) => String(x.assetNumber).localeCompare(String(y.assetNumber)));
  currentAssets = merged;
  return merged;
}

export const AssetStore = {
  list: () => currentAssets,
  get: (id) => currentAssets.find((a) => a.assetNumber === id),
  baseGet: (id) => baseById[id] || null,
  isBase: (id) => !!baseById[id],
  isEdited: (id) => !!store.edits[id] || store.added.some((a) => a.assetNumber === id) || store.deleted.includes(id),
  isAdded: (id) => store.added.some((a) => a.assetNumber === id),
  save(asset) {
    const a = recompute(clone(asset));
    if (baseById[a.assetNumber]) store.edits[a.assetNumber] = a;
    else {
      const i = store.added.findIndex((x) => x.assetNumber === a.assetNumber);
      if (i >= 0) store.added[i] = a; else store.added.push(a);
    }
    store.deleted = store.deleted.filter((x) => x !== a.assetNumber);
    persist(); return build();
  },
  remove(id) {
    if (baseById[id]) { if (!store.deleted.includes(id)) store.deleted.push(id); delete store.edits[id]; }
    else store.added = store.added.filter((a) => a.assetNumber !== id);
    persist(); return build();
  },
  revert(id) {
    delete store.edits[id];
    store.deleted = store.deleted.filter((x) => x !== id);
    persist(); return build();
  },
  resetAll() { store = { edits: {}, added: [], deleted: [] }; persist(); return build(); },
  nextNumber() {
    let max = 10000;
    currentAssets.forEach((a) => {
      const n = parseInt(String(a.assetNumber).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return "STE-" + (max + 1 + Math.floor(Math.random() * 9));
  },
  recompute,
  editCount: () => Object.keys(store.edits).length + store.added.length + store.deleted.length,
};

// Initialise on module load
build();
