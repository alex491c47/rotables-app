/* ============================================================
   ST Engineering Solutions — Analytics financial model
   Exported as buildAN(rawAssets) so the Analytics page always
   gets a fresh model built from current AssetStore data.
   ============================================================ */

const TODAY = new Date(Math.max(Date.parse("2026-06-04T00:00:00Z"), Date.now()));
const DAY = 86400000;

export const AN_CLP = {
     // Widebody — GEnx / Trent 1000 (approx. 2026 CLP, USD)
     B787GENX:       { "Thrust Reverser": 6100000, "Inlet Cowl": 3100000, "Fan Cowl": 600000, "Exhaust Nozzle": 1800000 },
     B787TRENT:      { "Thrust Reverser": 6100000, "Inlet Cowl": 3100000, "Fan Cowl": 600000, "Exhaust Nozzle": 1800000 },
     // Mid-widebody — CF6-80E / Trent 700
     A330CF6:        { "Thrust Reverser": 4200000, "Inlet Cowl": 2400000, "Fan Cowl": 520000, "Exhaust Nozzle": 1400000 },
     A330TRENT700:   { "Thrust Reverser": 4100000, "Inlet Cowl": 2350000, "Fan Cowl": 510000, "Exhaust Nozzle": 1380000 },
     // Narrowbody — LEAP-1A / PW1100G
     A320LEAP:       { "Thrust Reverser": 2800000, "Inlet Cowl": 1800000, "Fan Cowl": 450000, "Exhaust Nozzle": 1100000 },
     A320PW1000G:    { "Thrust Reverser": 2900000, "Inlet Cowl": 1850000, "Fan Cowl": 460000, "Exhaust Nozzle": 1150000 },
     // Narrowbody — CFM56-7B / LEAP-1B
     B737NGCFM56:    { "Thrust Reverser": 2400000, "Inlet Cowl": 1500000, "Fan Cowl": 380000, "Exhaust Nozzle": 950000 },
     "B737 (MAX)LEAP": { "Thrust Reverser": 2700000, "Inlet Cowl": 1750000, "Fan Cowl": 430000, "Exhaust Nozzle": 1050000 },
     // COMAC narrowbody / regional
     C919LEAP:       { "Thrust Reverser": 2600000, "Inlet Cowl": 1650000, "Fan Cowl": 420000, "Exhaust Nozzle": 1000000 },
     ARJ21CF34:      { "Thrust Reverser": 1800000, "Inlet Cowl": 1100000, "Fan Cowl": 280000, "Exhaust Nozzle": 700000 },
};

export const LEASE_IN_PCT = {
     "A320LEAP-Thrust Reverser": 0.000043,
     "A320LEAP-other":           0.001,
     "B787":                     0.0005,
     "default":                  0.0007,
};

function hash01(s) {
     let h = 2166136261;
     for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
     return (h >>> 0) / 4294967296;
}

function classify(a) {
     if (a.ownership) return a.ownership;
     const r = hash01(a.assetNumber + "|own");
     if (a.aircraftType === "A320LEAP") {
            if (a.nacelle === "Thrust Reverser") return r < 0.8 ? "Short-term lease" : "Owned";
            return "Owned";
     }
     return r < 0.9 ? "Long-term lease" : "Owned";
}

// The finance values actually used for an asset — explicit fields if present,
// otherwise the same defaults the model applies. Lets the Editor SHOW the real
// numbers instead of blank boxes for generated/legacy assets.
export function effectiveFinance(a) {
     const clp = a.clp != null ? a.clp : ((AN_CLP[a.aircraftType] && AN_CLP[a.aircraftType][a.nacelle]) || 0);
     const ownership = classify(a);
     if (ownership === "Short-term lease") {
            return { clp, ownership, acqValue: 0, lifeYears: 0, residual: 0, method: "Straight-line" };
     }
     const defAcq = ownership === "Long-term lease" ? 0.4 * clp : clp;
     const defLife = ownership === "Long-term lease" ? 10 : 25;
     return {
            clp, ownership,
            acqValue: a.acquisitionValue != null ? a.acquisitionValue : defAcq,
            lifeYears: a.depLife != null ? a.depLife : defLife,
            residual: a.depResidual != null ? a.depResidual : 0,
            method: a.depMethod || "Straight-line",
     };
}

export const ymKey = (y, m) => y + "-" + String(m + 1).padStart(2, "0");
export const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Fractional months between two dates, counted so each whole calendar month is
// worth exactly 1 — lets depreciation be booked evenly per month (not by day count).
function monthsElapsed(fromMs, toMs) {
  if (toMs <= fromMs) return 0;
  const a = new Date(fromMs), b = new Date(toMs);
  const af = a.getUTCDate() / dim(a.getUTCFullYear(), a.getUTCMonth());
  const bf = b.getUTCDate() / dim(b.getUTCFullYear(), b.getUTCMonth());
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (bf - af));
}

function spreadDays(startISO, numDays) {
     const out = [];
     let d = new Date(startISO + "T00:00:00Z");
     let remaining = numDays;
     let guard = 0;
     while (remaining > 0 && guard++ < 400) {
            const y = d.getUTCFullYear(), m = d.getUTCMonth();
            const daysLeft = dim(y, m) - d.getUTCDate() + 1;
            const take = Math.min(remaining, daysLeft);
            out.push({ y, m, days: take });
            remaining -= take;
            d = new Date(Date.UTC(y, m + 1, 1));
     }
     return out;
}

function leaseInPctForAsset(a) {
     if (a.aircraftType === "A320LEAP") {
            return a.nacelle === "Thrust Reverser"
              ? LEASE_IN_PCT["A320LEAP-Thrust Reverser"]
                     : LEASE_IN_PCT["A320LEAP-other"];
     }
     if (a.aircraftType.startsWith("B787")) return LEASE_IN_PCT["B787"];
     return LEASE_IN_PCT["default"];
}

export function buildAN(rawAssets) {
     let yMin = 9999, yMax = 0;

  const assets = rawAssets.map((a) => {
         const clp = a.clp != null ? a.clp : ((AN_CLP[a.aircraftType] && AN_CLP[a.aircraftType][a.nacelle]) || 0);
         const ownership = classify(a);

                                   let acqValue, lifeYears, residual, method;
         if (ownership === "Short-term lease") { acqValue = 0; lifeYears = 0; residual = 0; method = "Straight-line"; }
         else {
                  const defAcq = ownership === "Long-term lease" ? 0.4 * clp : clp;
                  const defLife = ownership === "Long-term lease" ? 10 : 25;
                  acqValue = a.acquisitionValue != null ? a.acquisitionValue : defAcq;
                  lifeYears = a.depLife != null ? a.depLife : defLife;
                  residual = a.depResidual != null ? a.depResidual : 0;
                  method = a.depMethod || "Straight-line";
         }

                                   const inService = a.history.length ? a.history[0].date : (a.lastUpdated || "2026-01-01");
         const inMs = new Date(inService + "T00:00:00Z").getTime();
         const ageDays = Math.max(1, (TODAY - inMs) / DAY);
         const ageYears = ageDays / 365.25;
         const annualDep = lifeYears ? acqValue / lifeYears : 0;
         const depOverride = a.depOverride || null;

                                   function baseAccum(yrs) {
                                            const resAbs = residual * acqValue;
                                            const depreciable = Math.max(0, acqValue - resAbs);
                                            if (method === "Declining balance") {
                                                       const rate = Math.min(0.9, (lifeYears ? 2 / lifeYears : 0));
                                                       const nbvT = Math.max(resAbs, acqValue * Math.pow(1 - rate, Math.max(0, yrs)));
                                                       return acqValue - nbvT;
                                            }
                                            return Math.min(depreciable, (lifeYears ? depreciable / lifeYears : 0) * Math.max(0, yrs));
                                   }

                                   function depAt(asof) {
                                            if (asof < inMs || !acqValue) return { nbv: asof >= inMs ? acqValue : 0, accumDep: 0 };
                                            if (depOverride && depOverride.from && depOverride.life > 0) {
                                                       const fromMs = Math.max(new Date(depOverride.from + "T00:00:00Z").getTime(), inMs);
                                                       const yToFrom = monthsElapsed(inMs, Math.min(asof, fromMs)) / 12;
                                                       const depOld = baseAccum(yToFrom);
                                                       if (asof <= fromMs) return { nbv: acqValue - depOld, accumDep: depOld };
                                                       const nbvAtFrom = acqValue - depOld;
                                                       const residualAbs = (depOverride.residual || 0) * acqValue;
                                                       const annualNew = Math.max(0, nbvAtFrom - residualAbs) / depOverride.life;
                                                       const depNew = Math.min(Math.max(0, nbvAtFrom - residualAbs), annualNew * (monthsElapsed(fromMs, asof) / 12));
                                                       return { nbv: acqValue - depOld - depNew, accumDep: depOld + depNew };
                                            }
                                            const dep = baseAccum(monthsElapsed(inMs, asof) / 12);
                                            return { nbv: acqValue - dep, accumDep: dep };
                                   }

                                   // manual per-month adjustments / write-downs (e.g. fire damage):
                                   // extra depreciation booked at the end of the given month.
                                   const depAdj = (a.depAdjustments || []).map((x) => {
                                            const p = String(x.month || "").split("-").map(Number);
                                            return { ms: (p[0] && p[1]) ? Date.UTC(p[0], p[1], 0) : 0, amount: Number(x.amount) || 0 };
                                   }).filter((x) => x.ms);
                                   if (depAdj.length) {
                                            const baseDepAt = depAt;
                                            depAt = function (asof) {
                                                       const b = baseDepAt(asof);
                                                       let extra = 0;
                                                       for (const x of depAdj) if (x.ms <= asof) extra += x.amount;
                                                       if (!extra) return b;
                                                       const ad = b.accumDep + extra;
                                                       return { nbv: Math.max(0, acqValue - ad), accumDep: ad };
                                            };
                                   }

                                   const now = depAt(TODAY.getTime());
         const accumDep = now.accumDep, nbv = now.nbv;

                                   const mRev = {}, mUtil = {};
         const removals = { "Long-term lease": 0, "Short-term lease": 0, "Exchange": 0 };

                                   a.history.forEach((e) => {
                                            const isOut = e.cat === "out";
                                            const isEx = e.contractType === "Exchange";
                                            if (isOut) {
                                                       if (isEx) removals["Exchange"]++;
                                                       else if (e.event === "Short-term lease") removals["Short-term lease"]++;
                                                       else if (e.event === "Long-term lease — start") removals["Long-term lease"]++;
                                            }
                                            if (e.revenue) {
                                                       if (isOut && !isEx && e.leaseDays && e.monthlyRevenue != null) {
                                                                    // Long-term lease: recognise the monthly fee per CALENDAR month
                                                                    // (full month = the fee; partial start/end month pro-rated by days).
                                                                    spreadDays(e.date, e.leaseDays).forEach((s) => {
                                                                                   const k = ymKey(s.y, s.m);
                                                                                   mRev[k] = (mRev[k] || 0) + e.monthlyRevenue * (s.days / dim(s.y, s.m));
                                                                    });
                                                       } else if (isOut && !isEx && e.leaseDays) {
                                                                    // Short-term lease (daily fee): recognise by day.
                                                                    const per = e.revenue / e.leaseDays;
                                                                    spreadDays(e.date, e.leaseDays).forEach((s) => {
                                                                                   const k = ymKey(s.y, s.m); mRev[k] = (mRev[k] || 0) + per * s.days;
                                                                    });
                                                       } else {
                                                                    const [y, m] = e.date.split("-").map(Number);
                                                                    const k = ymKey(y, m - 1);
                                                                    mRev[k] = (mRev[k] || 0) + e.revenue;
                                                       }
                                            }
                                            if (isOut) {
                                                       const utilDays = isEx ? (a.nacelle === "Thrust Reverser" ? 122 : 61) : (e.leaseDays || 0);
                                                       spreadDays(e.date, utilDays).forEach((s) => {
                                                                    const k = ymKey(s.y, s.m); mUtil[k] = (mUtil[k] || 0) + s.days;
                                                                    if (s.y < yMin) yMin = s.y; if (s.y > yMax) yMax = s.y;
                                                       });
                                            }
                                   });

                                   return {
                                            ref: a,
                                            assetNumber: a.assetNumber, aircraftType: a.aircraftType, nacelle: a.nacelle,
                                            status: a.status, engagementType: a.engagementType, location: a.location,
                                            clp, ownership, acqValue, lifeYears, inService, ageDays, ageYears,
                                            annualDep, accumDep, nbv, depOverride, depAt,
                                            leaseInDaily: ownership === "Short-term lease" ? leaseInPctForAsset(a) * clp : 0,
                                            leaseInPct: leaseInPctForAsset(a),
                                            mRev, mUtil, removals, totalRevenue: a.totalRevenue,
                                   };
  });

  if (yMax < yMin) { yMin = TODAY.getUTCFullYear() - 5; yMax = TODAY.getUTCFullYear(); }
     const years = [];
     for (let y = yMin; y <= yMax; y++) years.push(y);

  function revInPeriod(asset, period) {
         if (period.year == null) { let s = 0; for (const k in asset.mRev) s += asset.mRev[k]; return s; }
         if (period.month != null) return asset.mRev[ymKey(period.year, period.month)] || 0;
         let s = 0; for (let m = 0; m < 12; m++) s += asset.mRev[ymKey(period.year, m)] || 0; return s;
  }
     function utilDaysInPeriod(asset, period) {
            if (period.year == null) { let s = 0; for (const k in asset.mUtil) s += asset.mUtil[k]; return s; }
            if (period.month != null) return asset.mUtil[ymKey(period.year, period.month)] || 0;
            let s = 0; for (let m = 0; m < 12; m++) s += asset.mUtil[ymKey(period.year, m)] || 0; return s;
     }
     // The time an asset actually HAD to be utilised within a period: from when it
     // came into service (day-level) up to the earliest of today or its return/
     // retirement date, intersected with the period. So a unit inaugurated mid-year
     // is only measured from that day, a returned unit only up to its return date,
     // and the current month only counts the days elapsed so far.
     function periodEndExclusiveMs(period) {
            if (period.year == null) return Infinity;
            return period.month != null ? Date.UTC(period.year, period.month + 1, 1) : Date.UTC(period.year + 1, 0, 1);
     }
     function retiredMs(asset) {
            const ref = asset.ref;
            if (ref && ref.retired && ref.retiredDate) return new Date(ref.retiredDate + "T00:00:00Z").getTime();
            return Infinity;
     }
     function availDays(asset, period) {
            const inMs = inServiceMs(asset);
            const startMs = Math.max(periodStartMs(period), inMs);
            const endMs = Math.min(periodEndExclusiveMs(period), retiredMs(asset), TODAY.getTime());
            return Math.max(0, (endMs - startMs) / DAY);
     }
     function utilFrac(asset, period) {
            const days = utilDaysInPeriod(asset, period);
            // Short-term leases are only on our books while actually out on lease
            // (leased in from a supplier, shipped straight to the customer, returned),
            // so their utilisation is ~100% whenever they are active.
            if (asset.ownership === "Short-term lease") return days > 0 ? 1 : 0;
            const denom = availDays(asset, period);
            return Math.min(1, denom > 0 ? days / denom : 0);
     }
     function leaseInCost(asset, period) {
            if (!asset.leaseInDaily) return 0;
            // we only pay the lessor for the days the unit is actually out on lease
            return asset.leaseInDaily * utilDaysInPeriod(asset, period);
     }
     function periodStartMs(period) {
            if (period.year == null) return -Infinity;
            return period.month != null ? Date.UTC(period.year, period.month, 1) : Date.UTC(period.year, 0, 1);
     }
     // whether an asset was genuinely "online" during the period: in service by the
     // period end, not retired before it began, and (for short-term leases) actually
     // out on lease during it.
     function activeInPeriod(asset, period) {
            if (!inServiceBy(asset, period)) return false;
            const ref = asset.ref;
            if (ref && ref.retired && ref.retiredDate) {
                     const retMs = new Date(ref.retiredDate + "T00:00:00Z").getTime();
                     if (retMs < periodStartMs(period)) return false;
            }
            if (asset.ownership === "Short-term lease") return utilDaysInPeriod(asset, period) > 0;
            return true;
     }
     function monthlyRev(asset, year) {
            const out = []; for (let m = 0; m < 12; m++) out.push(asset.mRev[ymKey(year, m)] || 0); return out;
     }
     function monthlyUtilFrac(asset, year) {
            const out = [];
            for (let m = 0; m < 12; m++) {
                     const days = asset.mUtil[ymKey(year, m)] || 0;
                     if (asset.ownership === "Short-term lease") { out.push(days > 0 ? 1 : 0); continue; }
                     const avail = availDays(asset, { year, month: m });
                     // future months (no available time yet) read 0 here; the projection overlay handles them
                     out.push(avail > 0 ? Math.min(1, days / avail) : 0);
            }
            return out;
     }
     function asOfMs(period) {
            if (period.year == null) return TODAY.getTime();
            const end = period.month != null
              ? Date.UTC(period.year, period.month + 1, 0)
                     : Date.UTC(period.year, 11, 31);
            return Math.min(end, TODAY.getTime());
     }
     function inServiceMs(asset) { return new Date(asset.inService + "T00:00:00Z").getTime(); }
     function inServiceBy(asset, period) { return inServiceMs(asset) <= asOfMs(period); }
     function nbvAsOf(asset, period) {
            if (typeof asset.depAt === "function") return asset.depAt(asOfMs(period));
            const asof = asOfMs(period);
            if (asof < inServiceMs(asset) || !asset.acqValue) return { nbv: 0, accumDep: 0 };
            const ageY = (asof - inServiceMs(asset)) / (365.25 * DAY);
            const annual = asset.acqValue / asset.lifeYears;
            const accumDep = Math.min(asset.acqValue, annual * ageY);
            return { nbv: asset.acqValue - accumDep, accumDep };
     }
     function removalsInPeriod(asset, period) {
            if (period.year == null) return asset.removals;
            const out = { "Long-term lease": 0, "Short-term lease": 0, "Exchange": 0 };
            asset.ref.history.forEach((e) => {
                     if (e.cat !== "out") return;
                     const [y, m] = e.date.split("-").map(Number);
                     if (y !== period.year) return;
                     if (period.month != null && (m - 1) !== period.month) return;
                     if (e.contractType === "Exchange") out["Exchange"]++;
                     else if (e.event === "Short-term lease") out["Short-term lease"]++;
                     else if (e.event === "Long-term lease — start") out["Long-term lease"]++;
            });
            return out;
     }

  return {
         assets, years, AN_CLP, LEASE_IN_PCT,
         revInPeriod, utilDaysInPeriod, utilFrac, availDays, leaseInCost, monthlyRev, monthlyUtilFrac,
         asOfMs, inServiceBy, activeInPeriod, nbvAsOf, removalsInPeriod, dim, ymKey,
         weightedUtil(list, period) {
                  let wsum = 0, num = 0;
                  list.forEach((a) => { const w = nbvAsOf(a, period).nbv; if (w > 0) { wsum += w; num += utilFrac(a, period) * w; } });
                  if (wsum > 0) return num / wsum;
                  const active = list.filter((a) => inServiceBy(a, period));
                  if (!active.length) return 0;
                  let s = 0; active.forEach((a) => (s += utilFrac(a, period))); return s / active.length;
         },
  };
}
