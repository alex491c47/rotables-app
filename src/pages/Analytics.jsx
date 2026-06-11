import React, { useState, useMemo, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { buildAN } from '../lib/analyticsModel';
import { AssetStore, useAssets } from '../data/assetStore';
import { BarChart, LineChart, StackBar, Donut, fmtUSD, fmtPct, fmtPct1 } from '../components/AnalyticsCharts';
import { getDark, saveDark } from '../lib/theme';
import UserMenu from '../components/UserMenu';

const TYPE_PALETTE = ["#38bdf8", "#818cf8", "#2dd4bf", "#f472b6", "#fbbf24", "#a3e635", "#fb923c", "#22d3ee", "#c084fc"];
const OWN_TYPES = ["Owned", "Long-term lease", "Short-term lease"];
const OWN_COLOR = { "Owned": "#34d399", "Long-term lease": "#38bdf8", "Short-term lease": "#facc15" };
const REMOVAL_COLOR = { "Long-term lease": "#2dd4bf", "Short-term lease": "#38bdf8", "Exchange": "#c084fc" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function useTween(target, dur = 500) {
  const [val, setVal] = useState(target);
  const ref = useRef({ raf: 0, to: 0, from: target });
  useEffect(() => {
    const from = ref.current.from;
    const start = performance.now();
    cancelAnimationFrame(ref.current.raf);
    clearTimeout(ref.current.to);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = from + (target - from) * e;
      setVal(cur);
      ref.current.from = cur;
      if (t < 1) ref.current.raf = requestAnimationFrame(tick);
      else ref.current.from = target;
    };
    ref.current.raf = requestAnimationFrame(tick);
    ref.current.to = setTimeout(() => { setVal(target); ref.current.from = target; }, dur + 80);
    return () => { cancelAnimationFrame(ref.current.raf); clearTimeout(ref.current.to); };
  }, [target]);
  return val;
}
function AnimatedNumber({ value, format }) {
  const v = useTween(value);
  return <React.Fragment>{format(v)}</React.Fragment>;
}

function KPI({ label, value, sub, tone }) {
  return (
    <div className={"kpi" + (tone ? " kpi-" + tone : "")}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function Card({ title, sub, children, span }) {
  return (
    <section className="card" style={span ? { gridColumn: "span " + span } : null}>
      <div className="card-head">
        <h3>{title}</h3>{sub && <span className="card-sub">{sub}</span>}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <div className="legend-item" key={it.name}>
          <span className="legend-sw" style={{ background: it.color }}></span>
          <span className="legend-nm">{it.name}</span>
          {it.value != null && <span className="legend-val">{it.value}</span>}
        </div>
      ))}
    </div>
  );
}

function AssetSearch({ value, onSelect, onClear, AN, TYPE_COLOR }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (value) {
    return (
      <div className="asset-sel">
        <span className="asset-sel-tag mono">{value}</span>
        <button className="asset-sel-x" onClick={onClear} title="Clear asset">×</button>
      </div>
    );
  }
  const ql = q.trim().toLowerCase();
  const matches = ql ? AN.assets.filter((a) => {
    const r = a.ref;
    return (a.assetNumber + " " + r.partNumber + " " + r.initialPartNumber + " " + r.description + " " + a.nacelle)
      .toLowerCase().includes(ql);
  }).slice(0, 8) : [];
  return (
    <div className="asset-search" ref={ref}>
      <svg viewBox="0 0 24 24" className="as-ico"><path d="M21 21l-4.3-4.3M11 19a8 8 0 110-16 8 8 0 010 16z" /></svg>
      <input className="as-input" placeholder="Asset #, part #, description…" value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && matches.length > 0 && (
        <ul className="as-suggest">
          {matches.map((a) => (
            <li key={a.assetNumber} className="as-item"
              onMouseDown={(e) => { e.preventDefault(); onSelect(a.assetNumber); setQ(""); setOpen(false); }}>
              <span className="as-dot" style={{ background: TYPE_COLOR[a.aircraftType] }}></span>
              <span className="as-text">
                <span className="as-primary mono">{a.assetNumber}</span>
                <span className="as-secondary">{a.aircraftType} · {a.nacelle}</span>
              </span>
              <span className="as-own" style={{ color: OWN_COLOR[a.ownership] }}>{a.ownership}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MultiSelect({ options, selected, onToggle, onClear, colorMap, allLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const summary = selected.size === 0 ? (allLabel || "All") : selected.size + " selected";
  return (
    <div className="ms" ref={ref}>
      <button className={"ms-btn" + (selected.size ? " on" : "")} onClick={() => setOpen((o) => !o)}>
        <span>{summary}</span><span className="ms-caret">▾</span>
      </button>
      {open && (
        <div className="ms-panel">
          {selected.size > 0 && <button className="ms-all" onClick={onClear}>Clear selection</button>}
          {options.map((o) => (
            <label key={o} className="ms-opt">
              <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} />
              <span className="ms-box" aria-hidden="true"></span>
              {colorMap && <span className="ms-dot" style={{ background: colorMap[o] }}></span>}
              <span className="ms-lbl">{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function UtilCell({ f }) {
  return (
    <span className="util-cell">
      <span className="util-bar"><span className="util-fill" style={{ width: (f * 100).toFixed(0) + "%" }}></span></span>
      <span className="util-num">{fmtPct(f)}</span>
    </span>
  );
}

const BrandMark = () => (
  <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />
);

export default function Analytics() {
  const dataVersion = useAssets();   // load from Supabase + re-render on changes
  const [dark, setDark] = useState(getDark);
  const [year, setYear] = useState(2025);
  const [month, setMonth] = useState(null);
  const [types, setTypes] = useState(new Set());
  const [owns, setOwns] = useState(new Set());
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [sortKey, setSortKey] = useState("nbv");
  const [sortDir, setSortDir] = useState(-1);

  useEffect(() => { document.body.classList.toggle("theme-light", !dark); saveDark(dark); }, [dark]);

  const AN = useMemo(() => buildAN(AssetStore.listAll()), [dataVersion]);
  const ALL_TYPES = useMemo(() => [...new Set(AN.assets.map((a) => a.aircraftType))].sort(), [AN]);
  const TYPE_COLOR = useMemo(() => {
    const m = {};
    ALL_TYPES.forEach((t, i) => { m[t] = TYPE_PALETTE[i % TYPE_PALETTE.length]; });
    return m;
  }, [ALL_TYPES]);

  const period = useMemo(() => ({ year, month: year == null ? null : month }), [year, month]);

  const assets = useMemo(() => {
    if (selectedAsset) {
      const one = AN.assets.find((a) => a.assetNumber === selectedAsset);
      return one ? [one] : [];
    }
    return AN.assets.filter((a) => {
      if (types.size && !types.has(a.aircraftType)) return false;
      if (owns.size && !owns.has(a.ownership)) return false;
      return true;
    });
  }, [AN, types, owns, selectedAsset]);

  const pickAsset = (id) => { setSelectedAsset(id); };
  const focus = selectedAsset ? AN.assets.find((a) => a.assetNumber === selectedAsset) : null;

  const agg = useMemo(() => {
    let revenue = 0, leaseIn = 0, nbv = 0, acq = 0, accumDep = 0, clp = 0, count = 0;
    const byType = {}; const byOwn = {}; const removals = { "Long-term lease": 0, "Short-term lease": 0, "Exchange": 0 };
    ALL_TYPES.forEach((t) => (byType[t] = { count: 0, nbv: 0, revenue: 0 }));
    assets.forEach((a) => {
      const r = AN.revInPeriod(a, period);
      revenue += r;
      const rem = AN.removalsInPeriod(a, period);
      Object.keys(removals).forEach((k) => (removals[k] += rem[k]));
      if (!AN.activeInPeriod(a, period)) return;
      const d = AN.nbvAsOf(a, period);
      leaseIn += AN.leaseInCost(a, period);
      nbv += d.nbv; acq += a.acqValue; accumDep += d.accumDep; clp += a.clp; count++;
      if (!byType[a.aircraftType]) byType[a.aircraftType] = { count: 0, nbv: 0, revenue: 0 };
      byType[a.aircraftType].count++; byType[a.aircraftType].nbv += d.nbv; byType[a.aircraftType].revenue += r;
      byOwn[a.ownership] = (byOwn[a.ownership] || 0) + 1;
    });
    const util = AN.weightedUtil(assets, period);
    const owned = (byOwn["Owned"] || 0) + (byOwn["Long-term lease"] || 0);
    const leasedIn = byOwn["Short-term lease"] || 0;
    const turn = nbv > 0 ? revenue / nbv : 0;
    return { revenue, leaseIn, nbv, acq, accumDep, clp, count, byType, byOwn, removals, util, owned, leasedIn, turn };
  }, [AN, assets, period, ALL_TYPES]);

  const revTrend = useMemo(() => {
    if (year == null) {
      return AN.years.map((y) => ({
        label: "'" + String(y).slice(2),
        value: assets.reduce((s, a) => s + AN.revInPeriod(a, { year: y, month: null }), 0),
      }));
    }
    return MONTHS.map((mn, m) => ({
      label: mn,
      value: assets.reduce((s, a) => s + AN.revInPeriod(a, { year, month: m }), 0),
    }));
  }, [AN, assets, year]);

  const utilTrend = useMemo(() => {
    if (year == null) {
      return AN.years.map((y) => ({ label: "'" + String(y).slice(2), value: AN.weightedUtil(assets, { year: y, month: null }) }));
    }
    return MONTHS.map((mn, m) => ({ label: mn, value: AN.weightedUtil(assets, { year, month: m }) }));
  }, [AN, assets, year]);

  // NBV chart uses ALL assets (unfiltered) so the chart always shows the full picture
  const depRows = useMemo(() => {
    return ALL_TYPES.map((t) => {
      let nbvSum = 0, dep = 0;
      AN.assets.filter((a) => a.aircraftType === t && AN.activeInPeriod(a, period)).forEach((a) => {
        const d = AN.nbvAsOf(a, period); nbvSum += d.nbv; dep += d.accumDep;
      });
      if (!nbvSum && !dep) return null;
      return { label: t, parts: [
        { name: "Net book value", value: nbvSum, color: TYPE_COLOR[t] },
        { name: "Accum. depreciation", value: dep, color: "var(--border2)" },
      ] };
    }).filter(Boolean);
  }, [AN, period, ALL_TYPES, TYPE_COLOR]);

  const rows = useMemo(() => {
    // only assets that were online during the selected period appear
    const data = assets.filter((a) => AN.activeInPeriod(a, period)).map((a) => {
      const d = AN.nbvAsOf(a, period);
      const revenue = AN.revInPeriod(a, period);
      return {
        a, revenue, util: AN.utilFrac(a, period),
        nbv: d.nbv, dep: d.accumDep, inSvc: AN.inServiceBy(a, period),
        turn: d.nbv > 0 ? revenue / d.nbv : null,
      };
    });
    const get = (r) => ({
      asset: r.a.assetNumber, type: r.a.aircraftType, nacelle: r.a.nacelle, own: r.a.ownership,
      clp: r.a.clp, nbv: r.nbv, dep: r.dep, revenue: r.revenue, util: r.util,
      turn: r.turn == null ? -1 : r.turn,
    }[sortKey]);
    data.sort((x, y) => {
      // retired assets always sink to the bottom, regardless of the active sort
      const rx = x.a.ref && x.a.ref.retired ? 1 : 0, ry = y.a.ref && y.a.ref.retired ? 1 : 0;
      if (rx !== ry) return rx - ry;
      const a = get(x), b = get(y);
      if (typeof a === "string") return sortDir * a.localeCompare(b);
      return sortDir * (a - b);
    });
    return data;
  }, [AN, assets, period, sortKey, sortDir]);

  const sort = (k) => { if (sortKey === k) setSortDir(-sortDir); else { setSortKey(k); setSortDir(-1); } };
  const periodLabel = year == null ? "Life-to-date" : month != null ? MONTHS[month] + " " + year : String(year);

  return (
    <div className="page">
      <header className="app-header">
        <NavLink to="/" end className="brand" title="Go to Asset Register">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text">
            <span className="brand-name">ST Engineering Solutions</span>
            <span className="brand-tag">Portfolio Analytics</span>
          </div>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/" end>Asset Register</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/editor">Editor</NavLink>
        </nav>
        <div className="header-right">
          {!selectedAsset && (types.size > 0 || owns.size > 0) && (
            <button className="theme-btn" onClick={() => { setTypes(new Set()); setOwns(new Set()); }}>Clear filters</button>
          )}
          <button className="theme-btn" onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"} mode</button>
          <UserMenu />
        </div>
      </header>

      <div className="filterbar">
        <div className="fb-group">
          <label>Asset</label>
          <div className="fb-asset-row">
            <AssetSearch value={selectedAsset} onSelect={pickAsset} onClear={() => setSelectedAsset(null)} AN={AN} TYPE_COLOR={TYPE_COLOR} />
            {focus && (
              <div className="fb-asset-info">
                <span className="fai-nacelle">{focus.nacelle}</span>
                <span className="fai-sep">·</span>
                <span style={{ color: TYPE_COLOR[focus.aircraftType] }}>{focus.aircraftType}</span>
                <span className="fai-sep">·</span>
                <span style={{ color: OWN_COLOR[focus.ownership] }}>{focus.ownership}</span>
                <span className="fai-sep">·</span>
                <span className="fai-loc">{focus.ref.location}</span>
              </div>
            )}
          </div>
        </div>
        <div className="fb-group">
          <label>Period</label>
          <div className="seg">
            <button className={year == null ? "on" : ""} onClick={() => { setYear(null); setMonth(null); }}>All</button>
            {AN.years.map((y) => (
              <button key={y} className={year === y ? "on" : ""} onClick={() => { setYear(y); setMonth(null); }}>{y}</button>
            ))}
          </div>
        </div>
        {year != null && (
          <div className="fb-group">
            <label>Month</label>
            <div className="seg seg-sm">
              <button className={month == null ? "on" : ""} onClick={() => setMonth(null)}>Year</button>
              {MONTHS.map((mn, m) => (
                <button key={m} className={month === m ? "on" : ""} onClick={() => setMonth(m)}>{mn}</button>
              ))}
            </div>
          </div>
        )}
        {!selectedAsset && (
          <div className="fb-group">
            <label>Engine type</label>
            <MultiSelect options={ALL_TYPES} selected={types} colorMap={TYPE_COLOR} allLabel="All types"
              onClear={() => setTypes(new Set())}
              onToggle={(t) => setTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })} />
          </div>
        )}
        {!selectedAsset && (
          <div className="fb-group">
            <label>Ownership</label>
            <div className="chips">
              {OWN_TYPES.map((o) => (
                <button key={o} className={"chip" + (owns.has(o) ? " on" : "")}
                  style={owns.has(o) ? { borderColor: OWN_COLOR[o], color: OWN_COLOR[o] } : null}
                  onClick={() => setOwns((s) => { const n = new Set(s); n.has(o) ? n.delete(o) : n.add(o); return n; })}>{o}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <main className="content">
        <div className="kpi-row">
          <KPI label={`Revenue · ${periodLabel}`} value={<AnimatedNumber value={agg.revenue} format={fmtUSD} />} tone="rev"
            sub={agg.leaseIn > 0 ? `net ${fmtUSD(agg.revenue - agg.leaseIn)} after lease-in` : `${agg.count} assets`} />
          <KPI label="Avg utilisation" value={<AnimatedNumber value={agg.util} format={(f) => (f * 100).toFixed(1) + "%"} />} tone="lease" sub="NBV-weighted" />
          <KPI label="Net book value" value={<AnimatedNumber value={agg.nbv} format={fmtUSD} />} sub={`of ${fmtUSD(agg.clp)} CLP`} />
          <KPI label="Accum. depreciation" value={<AnimatedNumber value={agg.accumDep} format={fmtUSD} />} tone="wip"
            sub={agg.acq > 0 ? fmtPct(agg.accumDep / agg.acq) + " of capitalised" : "—"} />
          <KPI label={`Asset turn · ${periodLabel}`} value={<AnimatedNumber value={agg.turn} format={(v) => v.toFixed(2) + "×"} />} sub="revenue ÷ NBV" />
          <KPI label="Own vs leased-in" value={<span><AnimatedNumber value={agg.owned} format={(v) => Math.round(v)} /> / <AnimatedNumber value={agg.leasedIn} format={(v) => Math.round(v)} /></span>} sub="owned · leased-in" />
          <KPI label={`Short-term lease cost · ${periodLabel}`} value={<AnimatedNumber value={agg.leaseIn} format={fmtUSD} />} tone="wip"
            sub={agg.leasedIn ? `paid to lessors · ${agg.leasedIn} unit${agg.leasedIn === 1 ? "" : "s"}` : "no leased-in units"} />
        </div>

        <div className="grid">
          <Card title={year == null ? "Revenue by year" : "Revenue by month"} sub={periodLabel} span={2}>
            <BarChart data={revTrend} accent="var(--ready)" />
          </Card>
          <Card title="Utilisation trend" sub="NBV-weighted" span={2}>
            <LineChart data={utilTrend} color="var(--lease)" />
          </Card>

          <Card title="Assets by engine type">
            <Donut size={190}
              data={ALL_TYPES.filter((t) => agg.byType[t].count).map((t) => ({ name: t, value: agg.byType[t].count, color: TYPE_COLOR[t] }))}
              centerLabel="assets" centerValue={agg.count} />
            <Legend items={ALL_TYPES.filter((t) => agg.byType[t].count).map((t) => ({ name: t, color: TYPE_COLOR[t], value: agg.byType[t].count }))} />
          </Card>

          <Card title="Removals by type" sub={periodLabel === "Life-to-date" ? "life-to-date" : periodLabel}>
            <Donut size={190}
              data={Object.keys(agg.removals).map((k) => ({ name: k.replace(" lease", ""), value: agg.removals[k], color: REMOVAL_COLOR[k] }))}
              centerLabel="removals" centerValue={Object.values(agg.removals).reduce((s, v) => s + v, 0)} />
            <Legend items={Object.keys(agg.removals).map((k) => ({ name: k, color: REMOVAL_COLOR[k], value: agg.removals[k] }))} />
          </Card>

          <Card title="Ownership split">
            <Donut size={190}
              data={Object.keys(OWN_COLOR).filter((o) => agg.byOwn[o]).map((o) => ({ name: o, value: agg.byOwn[o], color: OWN_COLOR[o] }))}
              centerLabel="owned" centerValue={`${Math.round(agg.owned / Math.max(1, agg.count) * 100)}%`} />
            <Legend items={Object.keys(OWN_COLOR).filter((o) => agg.byOwn[o]).map((o) => ({ name: o, color: OWN_COLOR[o], value: agg.byOwn[o] }))} />
          </Card>

          <Card title="Net book value vs depreciation" sub="by engine type — all assets">
            <StackBar rows={depRows} />
            <Legend items={[{ name: "Net book value", color: "var(--accent)" }, { name: "Accumulated depreciation", color: "var(--border2)" }]} />
          </Card>
        </div>

        <section className="card card-table">
          <div className="card-head">
            <h3>Asset detail</h3>
            <span className="card-sub">{rows.length} assets · {periodLabel}</span>
          </div>
          <div className="atable-wrap">
            <table className="atable">
              <thead>
                <tr>
                  {[["asset", "Asset #"], ["type", "Type"], ["nacelle", "Component"], ["own", "Ownership"]].map(([k, l]) => (
                    <th key={k} className={sortKey === k ? "sorted" : ""} onClick={() => sort(k)}>{l}{sortKey === k ? (sortDir < 0 ? " ↓" : " ↑") : ""}</th>
                  ))}
                  {[["clp", "CLP"], ["nbv", "NBV"], ["dep", "Accum. dep."], ["revenue", "Revenue"], ["util", "Util %"], ["turn", "Turn"]].map(([k, l]) => (
                    <th key={k} className={"num" + (sortKey === k ? " sorted" : "")} onClick={() => sort(k)}>{l}{sortKey === k ? (sortDir < 0 ? " ↓" : " ↑") : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, revenue, util, turn, nbv, dep }) => (
                  <tr key={a.assetNumber} className={"arow" + (selectedAsset === a.assetNumber ? " arow-sel" : "") + (a.ref && a.ref.retired ? " arow-retired" : "")}
                    onClick={() => setSelectedAsset(selectedAsset === a.assetNumber ? null : a.assetNumber)}
                    title={a.ref && a.ref.retired ? "Retired — no longer in the active register; still counted in historical figures" : (selectedAsset === a.assetNumber ? "Click to clear filter" : "Click to filter to this asset")}>
                    <td className="mono strong">{a.assetNumber}{a.ref && a.ref.retired ? <span className="retired-tag">{(a.status || "retired").toLowerCase()}</span> : null}</td>
                    <td><span className="ttag" style={{ color: TYPE_COLOR[a.aircraftType], borderColor: TYPE_COLOR[a.aircraftType] + "55", background: TYPE_COLOR[a.aircraftType] + "14" }}>{a.aircraftType}</span></td>
                    <td>{a.nacelle}</td>
                    <td><span className="otag" style={{ color: OWN_COLOR[a.ownership] }}>● {a.ownership}</span></td>
                    <td className="num mono dim">{fmtUSD(a.clp)}</td>
                    <td className="num mono">{nbv > 0 ? fmtUSD(nbv) : "—"}</td>
                    <td className="num mono dim">{dep > 0 ? fmtUSD(dep) : "—"}</td>
                    <td className="num mono rev">{revenue > 0 ? fmtUSD(revenue) : "—"}</td>
                    <td className="num"><UtilCell f={util} /></td>
                    <td className="num mono">{turn == null ? "—" : turn.toFixed(2) + "×"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="assumptions">
          Assumptions — CLP per type/nacelle (2026), straight-line depreciation (Owned 25 yr→0; Long-term lease 40% CLP, 10 yr→0;
          Short-term leased TRs off balance-sheet). Utilisation: lease-days, with exchanges credited 1/6 yr (Thrust Reverser 1/3 yr);
          portfolio average is NBV-weighted.
        </p>
      </main>
    </div>
  );
}
