/* ============================================================
   ST Engineering Solutions — Mock asset data
   Deterministic (seeded) so data is stable across reloads.
   NOTE: This entire file will be deleted once real Supabase
   data is connected. It exists only to keep the app working
   during the conversion to a proper project structure.
   ============================================================ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260604);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickNot = (arr, x) => { let v; do { v = pick(arr); } while (v === x && arr.length > 1); return v; };
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;

const TODAY = new Date("2026-06-04T00:00:00Z");
const DAY = 86400000;

export const CITIES = {
  Stockholm:    { lat: 59.33, lon: 18.07,  country: "Sweden",    type: "hub" },
  "Liège":      { lat: 50.64, lon: 5.57,   country: "Belgium",   type: "hub" },
  Baltimore:    { lat: 39.29, lon: -76.61, country: "USA",       type: "hub" },
  Xiamen:       { lat: 24.48, lon: 118.09, country: "China",     type: "hub" },
  Dubai:        { lat: 25.20, lon: 55.27,  country: "UAE",       type: "customer" },
  Singapore:    { lat: 1.35,  lon: 103.82, country: "Singapore", type: "hub" },
  Sydney:       { lat: -33.87,lon: 151.21, country: "Australia", type: "customer" },
  "Chula Vista":{ lat: 32.64, lon: -117.08,country: "USA",       type: "hub" },
  Bahrain:      { lat: 26.23, lon: 50.59,  country: "Bahrain",   type: "customer" },
  Berlin:       { lat: 52.52, lon: 13.40,  country: "Germany",   type: "customer" },
  Mumbai:       { lat: 19.08, lon: 72.88,  country: "India",     type: "customer" },
  Beijing:      { lat: 39.90, lon: 116.41, country: "China",     type: "customer" },
  Tokyo:        { lat: 35.68, lon: 139.65, country: "Japan",     type: "customer" },
};
const CITY_NAMES = Object.keys(CITIES);
const HUBS = CITY_NAMES.filter((c) => CITIES[c].type === "hub");
const CUST_CITIES = CITY_NAMES.filter((c) => CITIES[c].type === "customer");

const CUSTOMERS = [
  "SAS Scandinavian", "Brussels Airlines", "Lufthansa Technik", "Delta Air Lines",
  "Emirates", "Singapore Airlines", "Qantas", "Air China", "IndiGo", "ANA",
  "Gulf Air", "Cathay Pacific", "AerCap (lessor)", "Avolon (lessor)", "United Airlines",
];

const AIRCRAFT = ["B787GENX", "B787TRENT", "A320LEAP"];
const NACELLES = ["Thrust Reverser", "Exhaust Nozzle", "Fan Cowl", "Inlet Cowl"];
const STATUSES = ["WIP", "Ready to ship", "Out on lease"];
const ENGAGEMENTS = ["Short-term lease", "Exchange", "Long-term lease"];
const PART_PREFIX = { "Thrust Reverser": "TR", "Exhaust Nozzle": "EN", "Fan Cowl": "FC", "Inlet Cowl": "IC" };
const ENGINE = { B787GENX: "GEnx1B", B787TRENT: "Trent1000", A320LEAP: "LEAP1A" };

const makePN = (prefix, engine, num, mod) => {
  const base = `${prefix}-${engine}-${num}`;
  return mod > 0 ? `${base}/${String.fromCharCode(65 + mod)}` : base;
};

const assets = [];
let counter = 10000;

AIRCRAFT.forEach((acType, acIdx) => {
  for (let i = 0; i < 20; i++) {
    counter += int(3, 17);
    const nacelle = NACELLES[i % NACELLES.length];
    const prefix = PART_PREFIX[nacelle];
    const engine = ENGINE[acType];
    const pnNum = int(1000, 9899);
    let mod = 0;
    const pn = () => makePN(prefix, engine, pnNum, mod);
    const assetNumber = `STE-${counter}`;
    const dailyRate = acType.startsWith("B787") ? int(1100, 1900) : int(700, 1300);
    const description = `${acType.startsWith("B787") ? engine : "LEAP-1A"} ${nacelle} — ${acType} (ATA 78)`;

    const ev = [];
    let off = 0;
    let loc;
    const add = (e) => ev.push(Object.assign(
      { off, from: null, to: null, customer: null, revenue: 0, leaseDays: null, contractType: null, contractYears: null, pn: pn() }, e));

    const backInPool = (note) => { add({ to: loc, event: "Back in Pool", cat: "shop", status: "Ready to ship", notes: note }); };
    const relocate = () => {
      if (rand() < 0.28) {
        off += int(8, 26);
        const nl = pickNot(HUBS, loc);
        add({ from: loc, to: nl, event: "Relocation", cat: "move", status: "Ready to ship",
          notes: `Ferried ${loc} → ${nl} to balance pool capacity.` });
        loc = nl;
      }
    };

    loc = pick(HUBS);
    add({ to: loc, event: "Induction", cat: "shop", status: "WIP",
      notes: `Asset inducted at ${loc}; baseline inspection & certification.` });
    off += int(40, 110);
    backInPool(`Certified serviceable; entered the serviceable pool.`);

    const cycles = int(0, 2);
    for (let c = 0; c < cycles; c++) {
      relocate();
      off += int(8, 24);
      const type = pick(ENGAGEMENTS);
      const cust = pick(CUSTOMERS);
      const dest = pick(CUST_CITIES);

      if (type === "Short-term lease") {
        const d = int(45, 300);
        add({ from: loc, to: dest, event: "Short-term lease", cat: "out", status: "Out on lease",
          customer: cust, contractType: type, revenue: d * dailyRate, leaseDays: d,
          notes: `Dispatched to ${cust} on short-term lease.` });
        loc = dest; off += d;
        const hub = pick(HUBS);
        add({ from: loc, to: hub, event: "Recertification", cat: "in", status: "WIP", customer: cust,
          notes: `Returned from ${cust}; recertification & serviceability check at ${hub}.` });
        loc = hub; off += int(20, 55);
        backInPool(`Recertification complete; returned to serviceable pool.`);
      } else if (type === "Long-term lease") {
        const years = int(4, 7);
        let p = int(300, 540);
        add({ from: loc, to: dest, event: "Long-term lease — start", cat: "out", status: "Out on lease",
          customer: cust, contractType: type, contractYears: years, revenue: p * dailyRate, leaseDays: p,
          notes: `${years}-yr long-term lease commenced with ${cust}; unit installed on-wing.` });
        loc = dest; off += p;
        const swaps = int(0, 2);
        for (let s = 0; s < swaps; s++) {
          const hub = pick(HUBS);
          add({ from: loc, to: hub, event: "LTL repair swap", cat: "in", status: "WIP", customer: cust, contractType: type,
            notes: `Removed for repair under utilisation; replacement unit deployed to ${cust} to maintain contract coverage.` });
          loc = hub; off += int(30, 70);
          const rp = int(260, 520);
          add({ from: loc, to: dest, event: "Long-term lease — resumed", cat: "out", status: "Out on lease",
            customer: cust, contractType: type, contractYears: years, revenue: rp * dailyRate, leaseDays: rp,
            notes: `Repaired unit returned to ${cust}; long-term lease resumed.` });
          loc = dest; off += rp;
        }
        const hub = pick(HUBS);
        add({ from: loc, to: hub, event: "Recertification", cat: "in", status: "WIP", customer: cust, contractType: type,
          notes: `Long-term lease (${years} yr) concluded; unit returned to ${hub} for recertification.` });
        loc = hub; off += int(25, 60);
        backInPool(`Recertification complete; returned to serviceable pool.`);
      } else {
        const d = int(120, 520);
        const fee = int(28, 85) * 1000;
        add({ from: loc, to: dest, event: "Exchange", cat: "out", status: "Out on lease",
          customer: cust, contractType: type, revenue: fee + d * dailyRate, leaseDays: d,
          notes: `Serviceable unit issued on exchange to ${cust}; their core inducted at ${loc}.` });
        loc = dest; off += d;
        const hub = pick(HUBS);
        add({ from: loc, to: hub, event: "Induction", cat: "in", status: "WIP", customer: cust, contractType: type,
          notes: `Core ferried back from ${cust}; inducted for overhaul at ${hub}.` });
        loc = hub; off += int(15, 40);
        const upgraded = rand() < 0.5; if (upgraded) mod++;
        add({ to: loc, event: "Overhaul", cat: "shop", status: "WIP", customer: cust, contractType: type,
          notes: upgraded
            ? `Full overhaul performed; configuration upgraded to ${pn()} per service bulletin — asset number retained.`
            : `Full overhaul performed; acoustic panels & latch kit renewed.` });
        off += int(30, 75);
        backInPool(`Overhaul complete; C-of-C issued, returned to serviceable pool.`);
      }
    }

    const finalStatus = STATUSES[(acIdx * 20 + i) % 3];
    let curEngagement = null, curCustomer = null, curContractYears = null, tailDays;

    if (finalStatus === "Out on lease") {
      relocate();
      off += int(8, 22);
      const type = pick(["Short-term lease", "Long-term lease"]);
      const cust = pick(CUSTOMERS);
      const dest = pick(CUST_CITIES);
      curEngagement = type; curCustomer = cust;
      if (type === "Long-term lease") {
        const years = int(4, 7); curContractYears = years;
        tailDays = int(220, Math.min(years * 365 - 90, 1500));
        add({ from: loc, to: dest, event: "Long-term lease — start", cat: "out", status: "Out on lease",
          customer: cust, contractType: type, contractYears: years, revenue: tailDays * dailyRate, leaseDays: tailDays, open: true,
          notes: `${years}-yr long-term lease commenced with ${cust}; unit currently installed on-wing.` });
      } else {
        tailDays = int(20, 260);
        add({ from: loc, to: dest, event: "Short-term lease", cat: "out", status: "Out on lease",
          customer: cust, contractType: type, revenue: tailDays * dailyRate, leaseDays: tailDays, open: true,
          notes: `Currently out on short-term lease with ${cust}.` });
      }
      loc = dest;
    } else if (finalStatus === "Ready to ship") {
      relocate();
      tailDays = int(5, 60);
      if (ev[ev.length - 1].event !== "Back in Pool") backInPool(`Certified serviceable; available in the pool.`);
    } else {
      relocate();
      off += int(8, 20);
      const cust = pick(CUSTOMERS);
      const src = pick(CUST_CITIES);
      const hub = loc;
      const pct = int(8, 75);
      if (rand() < 0.5) {
        add({ from: src, to: hub, event: "Recertification", cat: "in", status: "WIP", customer: cust,
          notes: `Returned from ${cust}; recertification & serviceability check in progress — ${pct}% complete.` });
      } else {
        add({ from: src, to: hub, event: "Induction", cat: "in", status: "WIP", customer: cust, contractType: "Exchange",
          notes: `Core ferried back from ${cust} (exchange); inducted for overhaul at ${hub}.` });
        off += int(10, 30);
        add({ to: hub, event: "Overhaul", cat: "shop", status: "WIP", customer: cust, contractType: "Exchange",
          notes: `Overhaul in progress — ${pct}% complete; awaiting acoustic panels & latch kit.` });
      }
      tailDays = int(10, 120);
    }

    const L = ev[ev.length - 1].off + tailDays;
    const startMs = TODAY.getTime() - L * DAY;
    ev.forEach((e) => { e.date = new Date(startMs + e.off * DAY).toISOString().slice(0, 10); delete e.off; });

    const totalRevenue = ev.reduce((s, e) => s + (e.revenue || 0), 0);
    const daysOnLease = ev.reduce((s, e) => s + (e.leaseDays || 0), 0);
    const last = ev[ev.length - 1];
    let previousStatus = null;
    for (let k = ev.length - 2; k >= 0; k--) {
      if (ev[k].status !== finalStatus) { previousStatus = ev[k].status; break; }
    }

    assets.push({
      assetNumber, aircraftType: acType, nacelle,
      partNumber: pn(), initialPartNumber: makePN(prefix, engine, pnNum, 0), pnChanged: mod > 0,
      description, status: finalStatus, previousStatus,
      engagementType: curEngagement, contractYears: curContractYears,
      location: loc, customer: curCustomer, dailyRate,
      totalRevenue, daysOnLease, lastUpdated: last.date, history: ev,
    });
  }
});

const EXCHANGE_EXAMPLES = [
  { ac: "B787GENX",  nacelle: "Thrust Reverser", cust: "Emirates",  from: "Dubai",   hub: "Xiamen",    kind: "overhaul", pct: 35, upgrade: true,  days: 9  },
  { ac: "B787TRENT", nacelle: "Fan Cowl",        cust: "Qantas",    from: "Sydney",  hub: "Singapore", kind: "repair",   pct: 62, upgrade: false, days: 5  },
  { ac: "A320LEAP",  nacelle: "Inlet Cowl",      cust: "IndiGo",    from: "Mumbai",  hub: "Baltimore", kind: "overhaul", pct: 18, upgrade: false, days: 16 },
  { ac: "B787GENX",  nacelle: "Exhaust Nozzle",  cust: "Air China", from: "Beijing", hub: "Stockholm", kind: "repair",   pct: 80, upgrade: true,  days: 3  },
];
EXCHANGE_EXAMPLES.forEach((x) => {
  counter += int(3, 17);
  const prefix = PART_PREFIX[x.nacelle];
  const engine = ENGINE[x.ac];
  const pnNum = int(1000, 9899);
  const inPN = makePN(prefix, engine, pnNum, 0);
  const outPN = x.upgrade ? makePN(prefix, engine, pnNum, 1) : inPN;
  const assetNumber = `STE-${counter}`;
  const dailyRate = x.ac.startsWith("B787") ? int(1100, 1900) : int(700, 1300);
  const description = `${x.ac.startsWith("B787") ? engine : "LEAP-1A"} ${x.nacelle} — ${x.ac} (ATA 78)`;

  const ev = [
    { off: 0, from: x.from, to: x.hub, event: "Exchange — core intake", cat: "in", status: "WIP",
      customer: x.cust, contractType: "Exchange", revenue: 0, leaseDays: null, pn: inPN,
      notes: `Serviceable unit issued to ${x.cust} on exchange; their removed core received at ${x.hub} and inducted for ${x.kind}.` },
    { off: int(2, 6), from: null, to: x.hub, event: x.kind === "overhaul" ? "Overhaul" : "Repair",
      cat: "shop", status: "WIP", customer: x.cust, contractType: "Exchange", revenue: 0, leaseDays: null, pn: outPN,
      notes: x.kind === "overhaul"
        ? `Full overhaul in progress — ${x.pct}% complete${x.upgrade ? `; configuration being upgraded to ${outPN} per service bulletin (asset number retained)` : ""}.`
        : `Shop repair in progress — ${x.pct}% complete; defect rectification & serviceability restoration${x.upgrade ? `, reconfigured to ${outPN}` : ""}.` },
  ];
  const L = ev[ev.length - 1].off + x.days;
  const startMs = TODAY.getTime() - L * DAY;
  ev.forEach((e) => { e.date = new Date(startMs + e.off * DAY).toISOString().slice(0, 10); delete e.off; });

  assets.push({
    assetNumber, aircraftType: x.ac, nacelle: x.nacelle,
    partNumber: outPN, initialPartNumber: inPN, pnChanged: x.upgrade,
    description, status: "WIP", previousStatus: null,
    engagementType: null, contractYears: null,
    location: x.hub, customer: x.cust, dailyRate,
    totalRevenue: 0, daysOnLease: 0, lastUpdated: ev[ev.length - 1].date, history: ev,
    exchangeCore: true,
  });
});

assets.sort((a, b) => a.assetNumber.localeCompare(b.assetNumber));

export const ASSET_DATA = assets;

export const FILTER_OPTIONS = {
  aircraft: AIRCRAFT,
  nacelle: NACELLES,
  status: STATUSES,
  engagement: ENGAGEMENTS.filter((e) => e !== "Exchange"),
  location: CITY_NAMES.slice().sort(),
};

export function fmtMoney(n) {
  if (!n) return "$0";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  return "$" + Math.round(n / 1e3) + "K";
}

export function fmtDays(n) {
  if (!n) return "—";
  if (n >= 365) { const y = (n / 365); return y.toFixed(y >= 10 ? 0 : 1) + " yr"; }
  return n + " d";
}
