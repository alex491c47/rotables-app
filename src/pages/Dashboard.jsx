import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { AssetStore, AssetCalc, useAssets } from '../data/assetStore';
import { downloadXlsx } from '../lib/exportCsv';
import { CITIES, FILTER_OPTIONS, fmtMoney, fmtDays } from '../data/mockData';
import { AssetGlobe } from '../lib/globe';
import { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakSlider } from '../components/TweaksPanel';
import { getDark, saveDark } from '../lib/theme';
import UserMenu from '../components/UserMenu';
import TopNav from '../components/TopNav';
import DownloadIcon from '../components/DownloadIcon';

const GLOBE_THEMES = {
  dark: {
    glow: "rgba(56,189,248,0.12)", sphereHi: "#0e2540", sphereLo: "#050e1a",
    dot: "120,190,255", dotBack: "90,150,210", cityDim: "150,180,210",
    arcCustomer: "56,189,248", arcReturn: "163,230,53", arcMove: "148,163,184",
    markerLease: "56,189,248", markerWip: "250,204,21", markerReady: "52,211,153",
    labelBg: "rgba(6,13,24,0.82)", labelText: "#e8f1fb",
  },
  light: {
    glow: "rgba(37,99,235,0.10)", sphereHi: "#e6eefa", sphereLo: "#b6cce6",
    dot: "30,64,124", dotBack: "90,120,170", cityDim: "70,95,140",
    arcCustomer: "14,116,200", arcReturn: "77,124,15", arcMove: "100,116,139",
    markerLease: "14,116,200", markerWip: "180,120,0", markerReady: "13,148,90",
    labelBg: "rgba(255,255,255,0.9)", labelText: "#0b1b30",
  },
};

const STATUS_META = {
  "WIP": { cls: "wip", dot: "#facc15" },
  "Ready to ship": { cls: "ready", dot: "#34d399" },
  "Out on lease": { cls: "lease", dot: "#38bdf8" },
};
const ENGAGEMENT_META = {
  "Short-term lease": { cls: "eng-short", color: "#38bdf8", short: "Short-term" },
  "Exchange": { cls: "eng-exch", color: "#c084fc", short: "Exchange" },
  "Long-term lease": { cls: "eng-long", color: "#2dd4bf", short: "Long-term" },
};
const CAT_COLOR = { out: "#38bdf8", in: "#a3e635", move: "#94a3b8", shop: "#64748b" };
const STATUS_RANK = { "Ready to ship": 0, "WIP": 1, "Out on lease": 2 };

// Long-term leases ending within this many days are flagged "ending soon".
const LEASE_SOON_DAYS = 60;
// Days until an active long-term lease is due to end (null if not applicable).
function leaseEndDays(a) {
  if (a.status !== "Out on lease" || a.engagementType !== "Long-term lease" || !a.contractYears) return null;
  let start = null;
  for (let i = a.history.length - 1; i >= 0; i--) { if (a.history[i].cat === "out") { start = a.history[i].date; break; } }
  if (!start) return null;
  const endMs = Date.parse(start + "T00:00:00Z") + a.contractYears * 365.25 * 86400000;
  return Math.round((endMs - AssetCalc.TODAY_MS) / 86400000);
}

function matchField(a, q) {
  if (a.assetNumber.toLowerCase().includes(q)) return { field: "asset", value: a.assetNumber };
  if (a.partNumber.toLowerCase().includes(q)) return { field: "pn", value: a.partNumber };
  if (a.initialPartNumber.toLowerCase().includes(q)) return { field: "pn", value: a.initialPartNumber };
  if (a.description.toLowerCase().includes(q)) return { field: "desc", value: a.description };
  return { field: "asset", value: a.assetNumber };
}
function highlight(text, q) {
  const lc = text.toLowerCase();
  let idx = lc.indexOf(q);
  if (!q || idx === -1) return text;
  const out = []; let i = 0, k = 0;
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark className="sug-hl" key={k++}>{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
    idx = lc.indexOf(q, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function StatusBadge({ status, muted }) {
  const m = STATUS_META[status] || {};
  return (
    <span className={"badge badge-" + m.cls + (muted ? " badge-muted" : "")}>
      <span className="badge-dot" style={{ background: m.dot }}></span>
      {status}
    </span>
  );
}
function EngagementTag({ type, compact }) {
  if (!type) return <span className="dim">—</span>;
  const m = ENGAGEMENT_META[type] || {};
  return (
    <span className="eng-tag" style={{ color: m.color, borderColor: m.color + "55", background: m.color + "1a" }}>
      {compact ? m.short : type}
    </span>
  );
}

function CheckRow({ label, checked, onChange, swatch }) {
  // preventDefault on mousedown stops the checkbox from grabbing focus on click,
  // which is what made Chrome scroll the whole page to "reveal" a checkbox low in
  // the sidebar. The click still toggles, so onChange fires as normal.
  return (
    <label className="check-row" onMouseDown={(e) => e.preventDefault()}>
      <input type="checkbox" checked={checked} onChange={onChange} tabIndex={-1} />
      <span className="check-box" aria-hidden="true"></span>
      {swatch && <span className="check-swatch" style={{ background: swatch }}></span>}
      <span className="check-label">{label}</span>
    </label>
  );
}
function FilterGroup({ title, children, count }) {
  return (
    <div className="filter-group">
      <div className="filter-group-head">
        <span>{title}</span>
        {count != null && <span className="filter-count">{count}</span>}
      </div>
      <div className="filter-group-body">{children}</div>
    </div>
  );
}

const EMPTY_FILTERS = () => ({
  aircraft: new Set(), nacelle: new Set(), status: new Set(),
  engagement: new Set(), location: new Set(), search: "",
});

function FilterPane({ filters, setFilters, resultCount, total, allAssets, onSelectAsset }) {
  const [sugOpen, setSugOpen] = useState(false);
  const [locSearch, setLocSearch] = useState("");
  const q = filters.search.trim().toLowerCase();

  const dynamicAircraft = useMemo(() => [...new Set(allAssets.map((a) => a.aircraftType))].sort(), [allAssets]);
  const dynamicLocations = useMemo(() => [...new Set(allAssets.map((a) => a.location).filter(Boolean))].sort(), [allAssets]);
  const filteredLocs = locSearch
    ? dynamicLocations.filter((l) => l.toLowerCase().includes(locSearch.toLowerCase()))
    : dynamicLocations;
  const suggestions = q
    ? allAssets.filter((a) =>
        (a.assetNumber + " " + a.partNumber + " " + a.initialPartNumber + " " + a.description)
          .toLowerCase().includes(q)).slice(0, 8)
    : [];
  const toggle = (key, val) => {
    setFilters((f) => {
      const next = new Set(f[key]);
      next.has(val) ? next.delete(val) : next.add(val);
      return { ...f, [key]: next };
    });
  };
  const activeCount =
    filters.aircraft.size + filters.nacelle.size + filters.status.size +
    filters.engagement.size + filters.location.size + (filters.search ? 1 : 0);

  return (
    <aside className="filter-pane">
      <div className="filter-pane-head">
        <span>Filters</span>
        {activeCount > 0 && (
          <button className="clear-btn" onClick={() => setFilters(EMPTY_FILTERS())}>Clear all</button>
        )}
      </div>

      <div className="search-wrap">
        <svg viewBox="0 0 24 24" className="search-ico"><path d="M21 21l-4.3-4.3M11 19a8 8 0 110-16 8 8 0 010 16z" /></svg>
        <input className="search-input" placeholder="Asset #, part #, description…"
          value={filters.search}
          onFocus={() => setSugOpen(true)}
          onBlur={() => setTimeout(() => setSugOpen(false), 120)}
          onChange={(e) => { setSugOpen(true); setFilters((f) => ({ ...f, search: e.target.value })); }} />
        {filters.search && (
          <button className="search-clear" onClick={() => setFilters((f) => ({ ...f, search: "" }))}>×</button>
        )}
        {sugOpen && suggestions.length > 0 && (
          <ul className="search-suggest">
            {suggestions.map((a) => {
              const m = matchField(a, q);
              const kind = m.field === "pn" ? "P/N" : m.field === "desc" ? "Desc" : "Asset";
              return (
                <li key={a.assetNumber} className="suggest-item"
                  onMouseDown={(e) => { e.preventDefault(); onSelectAsset(a.assetNumber); setSugOpen(false); }}>
                  <span className="suggest-dot" style={{ background: STATUS_META[a.status].dot }}></span>
                  <span className="suggest-text">
                    <span className={"suggest-primary" + (m.field !== "desc" ? " mono" : "")}>{highlight(m.value, q)}</span>
                    <span className="suggest-secondary">{m.field === "asset" ? `${a.aircraftType} · ${a.nacelle}` : a.assetNumber}</span>
                  </span>
                  <span className="suggest-kind">{kind}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="filter-scroll">
        <FilterGroup title="Aircraft type" count={filters.aircraft.size || null}>
          {dynamicAircraft.map((a) => (
            <CheckRow key={a} label={a} checked={filters.aircraft.has(a)} onChange={() => toggle("aircraft", a)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Nacelle component" count={filters.nacelle.size || null}>
          {FILTER_OPTIONS.nacelle.map((n) => (
            <CheckRow key={n} label={n} checked={filters.nacelle.has(n)} onChange={() => toggle("nacelle", n)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Status" count={filters.status.size || null}>
          {FILTER_OPTIONS.status.map((s) => (
            <CheckRow key={s} label={s} checked={filters.status.has(s)} swatch={STATUS_META[s].dot}
              onChange={() => toggle("status", s)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Lease / contract type" count={filters.engagement.size || null}>
          {FILTER_OPTIONS.engagement.map((e) => (
            <CheckRow key={e} label={e} checked={filters.engagement.has(e)} swatch={ENGAGEMENT_META[e].color}
              onChange={() => toggle("engagement", e)} />
          ))}
        </FilterGroup>
        <div className="filter-group">
          <div className="filter-group-head">
            <span>Location</span>
            {filters.location.size > 0 && <span className="filter-count">{filters.location.size}</span>}
          </div>
          {dynamicLocations.length > 6 && (
            <div className="filter-group-search">
              <input className="fgs-input" placeholder="Search…" value={locSearch}
                onChange={(e) => setLocSearch(e.target.value)} />
              {locSearch && <button className="fgs-clear" onClick={() => setLocSearch("")}>×</button>}
            </div>
          )}
          <div className="filter-group-body">
            {filteredLocs.map((l) => (
              <CheckRow key={l} label={l} checked={filters.location.has(l)} onChange={() => toggle("location", l)} />
            ))}
            {filteredLocs.length === 0 && <div className="fgs-empty">No match</div>}
          </div>
        </div>
      </div>

      <div className="filter-foot">Showing <strong>{resultCount}</strong> of {total} assets</div>
    </aside>
  );
}

function GlobePanel({ globeRef, selected, stats, allAssets }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    globeRef.current = new AssetGlobe(canvasRef.current);
  }, []);
  // mark only hubs and cities the fleet actually touches — CITIES now holds
  // thousands of airports for the Editor dropdowns, far too many to draw
  useEffect(() => {
    if (!globeRef.current) return;
    const names = new Set();
    Object.keys(CITIES).forEach((n) => { if (CITIES[n].type === "hub") names.add(n); });
    (allAssets || []).forEach((a) => {
      if (a.location && CITIES[a.location]) names.add(a.location);
      (a.history || []).forEach((h) => {
        if (h.from && CITIES[h.from]) names.add(h.from);
        if (h.to && CITIES[h.to]) names.add(h.to);
      });
    });
    const cities = [...names].map((name) => ({
      lat: CITIES[name].lat, lon: CITIES[name].lon, label: name, kind: CITIES[name].type,
    }));
    globeRef.current.setAllCityMarkers(cities);
  }, [allAssets]);

  const route = selected
    ? [...new Set(selected.history.flatMap((h) => [h.from, h.to]).filter(Boolean))]
    : null;

  return (
    <section className="globe-panel">
      <canvas ref={canvasRef} className="globe-canvas"></canvas>
      <div className="globe-overlay-top">
        <div className="globe-title">
          <span className="globe-kicker">Global Asset Map</span>
          <span className="globe-sub">{selected ? "Tracking " + selected.assetNumber : "Nacelle positions"}</span>
        </div>
      </div>
      <div className="globe-legend">
        {selected ? (
          <React.Fragment>
            <div className="legend-row"><span className="legend-line" style={{ background: CAT_COLOR.out }}></span>Out to customer</div>
            <div className="legend-row"><span className="legend-line" style={{ background: CAT_COLOR.in }}></span>Returned to ST</div>
            <div className="legend-row"><span className="legend-line" style={{ background: CAT_COLOR.move }}></span>Ferry / relocation</div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="legend-row"><span className="legend-dot" style={{ background: STATUS_META["Ready to ship"].dot }}></span>Ready to ship</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: STATUS_META["WIP"].dot }}></span>WIP</div>
            <div className="legend-row"><span className="legend-dot" style={{ background: STATUS_META["Out on lease"].dot }}></span>Out on lease</div>
            <div className="legend-note">Bubble size = items at location ·<br />colour shows soonest-to-ready status</div>
          </React.Fragment>
        )}
      </div>
      {selected && (
        <div className="globe-route">
          <div className="route-asset">{selected.assetNumber} · {selected.aircraftType}
            {selected.engagementType && <span className="route-eng" style={{ color: ENGAGEMENT_META[selected.engagementType].color }}>· {selected.engagementType}{selected.contractYears ? ` (${selected.contractYears} yr)` : ""}</span>}
          </div>
          <div className="route-path">{route.join("  →  ")}</div>
        </div>
      )}
      {!selected && (
        <div className="globe-totals">
          <div className="gt-title">Nacelle positions · {stats.total}</div>
          <div className="gt-row"><span className="gt-dot" style={{ background: STATUS_META["Ready to ship"].dot }}></span><span className="gt-lbl">Ready to ship</span><span className="gt-num">{stats.ready}</span></div>
          <div className="gt-row"><span className="gt-dot" style={{ background: STATUS_META["WIP"].dot }}></span><span className="gt-lbl">WIP</span><span className="gt-num">{stats.wip}</span></div>
          <div className="gt-row"><span className="gt-dot" style={{ background: STATUS_META["Out on lease"].dot }}></span><span className="gt-lbl">Out on lease</span><span className="gt-num">{stats.lease}</span></div>
        </div>
      )}
      {!selected && <div className="globe-hint">Drag to rotate · scroll to zoom · click a bubble to filter</div>}
    </section>
  );
}

function HistoryTimeline({ asset }) {
  const rows = asset.history.slice().reverse();
  return (
    <div className="history">
      <div className="history-scroll">
        <div className="history-head">
          <span>Date</span><span>Movement</span><span>Event</span><span>Part number</span>
          <span>Customer</span><span>Status</span><span className="num">Days</span><span className="num">Revenue</span>
        </div>
        <div className="history-body">
          {rows.map((h, i) => {
            const next = rows[i + 1];
            const pnChanged = next && next.pn !== h.pn;
            const col = CAT_COLOR[h.cat] || CAT_COLOR.shop;
            return (
              <div className="hist-row" key={i}>
                <span className="hist-date">{h.date}</span>
                <span className="hist-move">
                  {h.from ? <span className="loc-from">{h.from}</span> : <span className="loc-origin">At facility</span>}
                  <span className="arrow" style={{ color: col }}>{h.from ? "→" : "•"}</span>
                  <span className="loc-to">{h.to || asset.location}</span>
                </span>
                <span className="hist-event"><span className="reason-pip" style={{ background: col }}></span>{h.event}</span>
                <span className={"hist-pn mono" + (pnChanged ? " pn-changed" : "")}>
                  {h.pn}{pnChanged && <span className="pn-flag" title={"Changed from " + next.pn}>NEW P/N</span>}
                </span>
                <span className="hist-cust">{h.customer || "—"}</span>
                <span><StatusBadge status={h.status} /></span>
                <span className="num hist-days">{h.leaseDays ? fmtDays(h.leaseDays) : "—"}</span>
                <span className="num hist-rev">{h.revenue ? fmtMoney(h.revenue) : "—"}</span>
                <span className="hist-notes">{h.notes}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AssetTable({ assets, expandedId, onToggle }) {
  const wrapRef = useRef(null);
  const theadRef = useRef(null);
  const openRowRef = useRef(null);
  const detailRowRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current, thead = theadRef.current;
    if (!wrap || !thead) return;
    const setHeights = () => {
      wrap.style.setProperty("--thead-h", thead.getBoundingClientRect().height + "px");
      const r = openRowRef.current;
      if (r) wrap.style.setProperty("--openrow-h", r.getBoundingClientRect().height + "px");
    };
    const onScroll = () => {
      const r = openRowRef.current;
      if (!r) return;
      const theadH = thead.getBoundingClientRect().height;
      const openH = r.getBoundingClientRect().height;
      const wrapTop = wrap.getBoundingClientRect().top;
      const pinBottom = wrapTop + theadH + openH;
      const d = detailRowRef.current;
      const detailBottom = d ? d.getBoundingClientRect().bottom : Infinity;
      const overlap = pinBottom - detailBottom;
      if (overlap > 0) {
        r.style.setProperty("--pin-shift", -overlap + "px");
        r.classList.add("releasing");
      } else {
        r.classList.remove("releasing");
      }
    };
    setHeights();
    onScroll();
    wrap.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", setHeights);
    const ro = new ResizeObserver(() => { setHeights(); onScroll(); });
    ro.observe(thead);
    if (openRowRef.current) ro.observe(openRowRef.current);
    return () => {
      wrap.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", setHeights);
      ro.disconnect();
    };
  }, [expandedId, assets]);

  return (
    <div className="table-wrap" ref={wrapRef}>
      <table className="asset-table">
        <thead ref={theadRef}>
          <tr>
            <th className="col-exp"></th>
            <th>Asset #</th><th>Aircraft</th><th>Component</th>
            <th>Current P/N</th><th>Location</th><th>Previous status</th><th>Status</th><th>Lease type</th>
            <th className="num">Days leased</th><th className="num">Revenue (LTD)</th><th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {assets.length === 0 && (
            <tr><td colSpan="12" className="empty-row">No assets match the current filters.</td></tr>
          )}
          {assets.map((a) => {
            const open = expandedId === a.assetNumber;
            return (
              <React.Fragment key={a.assetNumber}>
                <tr className={"asset-row" + (open ? " open" : "")} ref={open ? openRowRef : null} onClick={() => onToggle(a.assetNumber)}>
                  <td className="col-exp"><span className={"chev" + (open ? " up" : "")}>›</span></td>
                  <td className="mono strong">{a.assetNumber}</td>
                  <td><span className="ac-tag">{a.aircraftType}</span></td>
                  <td>{a.nacelle}</td>
                  <td className="mono dim pn-cell">{a.partNumber}{a.pnChanged && <span className="pn-dot" title={"Reconfigured — originally " + a.initialPartNumber}></span>}</td>
                  <td className="loc-cell">{a.location}</td>
                  <td>{a.exchangeCore
                    ? <span className="intake-tag" title="Core received via exchange — newly inducted">Exchange intake</span>
                    : a.previousStatus ? <StatusBadge status={a.previousStatus} muted /> : <span className="dim">—</span>}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>
                    <EngagementTag type={a.engagementType} compact />
                    {(() => { const d = leaseEndDays(a); return d != null && d <= LEASE_SOON_DAYS
                      ? <span className="lease-soon" title={d < 0 ? "Long-term lease past its end date — log a return/renewal" : `Long-term lease ends in ${d} days`}>{d < 0 ? "overdue" : `${d}d left`}</span>
                      : null; })()}
                  </td>
                  <td className="num">{fmtDays(a.daysOnLease)}</td>
                  <td className="num">{fmtMoney(a.totalRevenue)}</td>
                  <td className="dim">{a.lastUpdated}</td>
                </tr>
                {open && (
                  <tr className="detail-row" ref={detailRowRef}>
                    <td colSpan="12">
                      <div className="detail-inner">
                        <div className="detail-meta">
                          <div className="dm-item dm-key"><label>Asset number (permanent)</label><span className="mono strong">{a.assetNumber}</span></div>
                          <div className="dm-item"><label>Description</label><span>{a.description}</span></div>
                          <div className="dm-item"><label>Current part number</label><span className="mono">{a.partNumber}{a.pnChanged && <em className="pn-was"> — was {a.initialPartNumber}</em>}</span></div>
                          <div className="dm-item"><label>Lease / contract</label><span>{a.engagementType ? <span>{a.engagementType}{a.contractYears ? ` · ${a.contractYears} yr` : ""}</span> : (a.status === "WIP" ? "In work at ST Engineering" : "In serviceable pool")}</span></div>
                          <div className="dm-item"><label>Current location</label><span>{a.location}</span></div>
                          <div className="dm-item"><label>Previous status</label><span>{a.previousStatus || "—"}</span></div>
                          <div className="dm-item"><label>Customer</label><span>{a.customer || "—"}</span></div>
                          <div className="dm-item"><label>Days on lease (LTD)</label><span className="days-strong">{fmtDays(a.daysOnLease)}{a.daysOnLease >= 365 ? ` (${a.daysOnLease} d)` : ""}</span></div>
                          <div className="dm-item"><label>Revenue (life-to-date)</label><span className="rev-strong">{fmtMoney(a.totalRevenue)}</span></div>
                          <div className="dm-item"><label>Movements logged</label><span>{a.history.length}</span></div>
                        </div>
                        <HistoryTimeline asset={a} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BrandMark = () => (
  <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />
);

function Header({ stats }) {
  return (
    <header className="app-header">
      <NavLink to="/" end className="brand" title="Go to Asset Register">
        <div className="brand-mark"><BrandMark /></div>
        <div className="brand-text">
          <span className="brand-name">ST Engineering Solutions</span>
          <span className="brand-tag">Nacelle Asset Operations</span>
        </div>
      </NavLink>
      <TopNav />
      <div className="header-stats">
        <div className="stat"><span className="stat-num">{stats.total}</span><span className="stat-lbl">Assets</span></div>
        <div className="stat stat-wip"><span className="stat-num">{stats.wip}</span><span className="stat-lbl">WIP</span></div>
        <div className="stat stat-ready"><span className="stat-num">{stats.ready}</span><span className="stat-lbl">Ready to ship</span></div>
        <div className="stat stat-lease"><span className="stat-num">{stats.lease}</span><span className="stat-lbl">Out on lease</span></div>
        <div className="stat stat-rev"><span className="stat-num">{fmtMoney(stats.revenue)}</span><span className="stat-lbl">Revenue LTD</span></div>
      </div>
      <UserMenu />
    </header>
  );
}

export default function Dashboard() {
  useAssets();   // load from Supabase + re-render when the shared data changes
  const [t, setTweak] = useTweaks({ dark: getDark(), spin: 1 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState(null);
  const globeRef = useRef(null);

  const all = AssetStore.list();
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return all.filter((a) => {
      if (filters.aircraft.size && !filters.aircraft.has(a.aircraftType)) return false;
      if (filters.nacelle.size && !filters.nacelle.has(a.nacelle)) return false;
      if (filters.status.size && !filters.status.has(a.status)) return false;
      if (filters.engagement.size && !filters.engagement.has(a.engagementType)) return false;
      if (filters.location.size && !filters.location.has(a.location)) return false;
      if (q) {
        const hay = (a.assetNumber + " " + a.partNumber + " " + a.initialPartNumber + " " + a.description).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, filters]);

  const stats = useMemo(() => {
    const s = { total: filtered.length, ready: 0, wip: 0, lease: 0, revenue: 0 };
    filtered.forEach((a) => {
      if (a.status === "Ready to ship") s.ready++;
      else if (a.status === "WIP") s.wip++;
      else s.lease++;
      s.revenue += a.totalRevenue;
    });
    return s;
  }, [filtered]);

  const selected = useMemo(
    () => filtered.find((a) => a.assetNumber === expandedId) || null,
    [filtered, expandedId]
  );

  useEffect(() => {
    document.body.classList.toggle("theme-light", !t.dark);
    saveDark(t.dark);
    if (globeRef.current) globeRef.current.setTheme(GLOBE_THEMES[t.dark ? "dark" : "light"]);
  }, [t.dark]);
  useEffect(() => { if (globeRef.current) globeRef.current.setSpeed(t.spin); }, [t.spin]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (globeRef.current) {
        globeRef.current.setTheme(GLOBE_THEMES[t.dark ? "dark" : "light"]);
        globeRef.current.setSpeed(t.spin);
      }
    }, 40);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (!selected) { g.clearFocus(); return; }
    const seen = new Map();
    selected.history.forEach((h) => { if (h.to) seen.set(h.to, h.status); });
    selected.history.forEach((h) => { if (h.from && !seen.has(h.from)) seen.set(h.from, h.status); });
    const names = [...seen.keys()];
    const markers = names.map((name) => ({
      lat: CITIES[name].lat, lon: CITIES[name].lon, label: name,
      status: name === selected.location ? selected.status : seen.get(name),
      current: name === selected.location,
    }));
    markers.sort((a, b) => (a.current ? 1 : 0) - (b.current ? 1 : 0));
    const legs = selected.history.filter((h) => h.from && h.to && CITIES[h.from] && CITIES[h.to]).map((h) => ({
      from: { lat: CITIES[h.from].lat, lon: CITIES[h.from].lon },
      to: { lat: CITIES[h.to].lat, lon: CITIES[h.to].lon },
      reason: h.cat,
    }));
    g.focus({ markers, legs });
  }, [selected]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (selected) { g.setAggregates([]); return; }
    const byCity = new Map();
    filtered.forEach((a) => {
      if (!CITIES[a.location]) return;
      if (!byCity.has(a.location)) byCity.set(a.location, { count: 0, statuses: {} });
      const e = byCity.get(a.location);
      e.count++;
      e.statuses[a.status] = (e.statuses[a.status] || 0) + 1;
    });
    const aggs = [...byCity.entries()].map(([name, e]) => {
      const dominant = Object.keys(e.statuses)
        .sort((x, y) => STATUS_RANK[x] - STATUS_RANK[y])[0];
      return {
        lat: CITIES[name].lat, lon: CITIES[name].lon, label: name,
        count: e.count, status: dominant, breakdown: e.statuses,
      };
    });
    g.setAggregates(aggs);
  }, [filtered, selected]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g || selected) return;
    const locs = [...filters.location].filter((n) => CITIES[n]);
    if (!locs.length) return;
    const D = Math.PI / 180;
    let x = 0, y = 0, z = 0;
    locs.forEach((n) => {
      const la = CITIES[n].lat * D, lo = CITIES[n].lon * D;
      x += Math.cos(la) * Math.sin(lo);
      y += Math.sin(la);
      z += Math.cos(la) * Math.cos(lo);
    });
    const lat = Math.atan2(y, Math.hypot(x, z)) / D;
    const lon = Math.atan2(x, z) / D;
    g.spinTo(lat, lon);
  }, [filters.location, selected]);

  // safety net: the dashboard is a fixed full-screen layout with its own internal
  // scroll regions — the .app box and the window should never scroll. If a focused
  // control (e.g. a filter checkbox) makes the browser scroll them anyway, snap back.
  useEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;
    const pinApp = () => { if (app.scrollTop) app.scrollTop = 0; if (app.scrollLeft) app.scrollLeft = 0; };
    const pinWin = () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); };
    app.addEventListener("scroll", pinApp, { passive: true });
    window.addEventListener("scroll", pinWin, { passive: true });
    return () => { app.removeEventListener("scroll", pinApp); window.removeEventListener("scroll", pinWin); };
  }, []);

  const onToggle = useCallback((id) => setExpandedId((cur) => (cur === id ? null : id)), []);

  const endingSoonCount = filtered.filter((a) => { const d = leaseEndDays(a); return d != null && d <= LEASE_SOON_DAYS; }).length;
  const exportRegister = () => {
    const header = ["Asset #", "Aircraft", "Component", "Current P/N", "Location", "Previous status",
      "Status", "Lease type", "Days leased", "Revenue (USD)", "Lease ends in (days)", "Last updated"];
    const rows = filtered.map((a) => {
      const d = leaseEndDays(a);
      return [a.assetNumber, a.aircraftType, a.nacelle, a.partNumber, a.location, a.previousStatus || "",
        a.status, a.engagementType || "", a.daysOnLease, Math.round(a.totalRevenue), d == null ? "" : d, a.lastUpdated];
    });
    downloadXlsx("asset-register.xlsx", header, rows, "Asset Register");
  };

  const selectAsset = useCallback((id) => {
    const a = all.find((x) => x.assetNumber === id);
    setFilters((f) => ({ ...f, search: a ? a.assetNumber : f.search }));
    setExpandedId(id);
  }, [all]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const clearLoc = () => setFilters((f) => (f.location.size ? { ...f, location: new Set() } : f));
    g.onBubbleClick = (city) => {
      setFilters((f) => {
        const next = new Set(f.location);
        next.has(city) ? next.delete(city) : next.add(city);
        return { ...f, location: next };
      });
    };
    g.onBackgroundClick = clearLoc;

    const onDocClick = (e) => {
      const tgt = e.target;
      if (!tgt || !tgt.closest) return;
      if (tgt.closest(".filter-pane") || tgt.closest(".table-section") ||
          tgt.closest(".globe-canvas") || tgt.closest("[data-omelette-chrome]")) return;
      clearLoc();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  return (
    <div className="app">
      <Header stats={stats} />
      <div className="body-row">
        <FilterPane filters={filters} setFilters={setFilters} resultCount={filtered.length} total={all.length}
          allAssets={all} onSelectAsset={selectAsset} />
        <main className="main-col">
          <GlobePanel globeRef={globeRef} selected={selected} stats={stats} allAssets={all} />
          <div className="table-section">
            <div className="table-section-head">
              <span className="ts-title">Asset Register</span>
              <span className="ts-sub">{filtered.length} assets{endingSoonCount > 0 ? ` · ${endingSoonCount} lease${endingSoonCount === 1 ? "" : "s"} ending within ${LEASE_SOON_DAYS} days` : ""} · click a row for history</span>
              <button className="btn btn-sm reg-export" onClick={exportRegister} title="Download the current table as an Excel spreadsheet"><DownloadIcon />Export to Excel</button>
            </div>
            <AssetTable assets={filtered} expandedId={expandedId} onToggle={onToggle} />
          </div>
        </main>
      </div>

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakSection label="Globe" />
        <TweakSlider label="Spin speed" value={t.spin} min={0} max={4} step={0.25} unit="×"
          onChange={(v) => setTweak("spin", v)} />
      </TweaksPanel>
    </div>
  );
}
