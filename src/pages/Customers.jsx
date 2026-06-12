import React, { useState, useMemo, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { AssetStore, useAssets, assetsStatus } from '../data/assetStore';
import { getDark, saveDark } from '../lib/theme';
import { fmtMoney } from '../data/mockData';
import UserMenu from '../components/UserMenu';
import TopNav from '../components/TopNav';
import { BusyOverlay } from '../components/Spinner';

const BrandMark = () => <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />;
const NO_CONTRACT = "(outside any contract)";

// Per-customer overview of the rotables support we've given them: every lease,
// exchange and recertification tied to a customer, rolled up by contract name.
function buildCustomers(assets) {
  const map = {};
  assets.forEach((a) => {
    (a.history || []).forEach((e) => {
      if (!e.customer) return;
      const cust = (map[e.customer] = map[e.customer] || {
        name: e.customer, units: new Set(), days: 0, revenue: 0, engagements: 0,
        contracts: {}, assets: {},
      });
      const cName = e.contractName || NO_CONTRACT;
      const c = (cust.contracts[cName] = cust.contracts[cName] || { name: cName, units: new Set(), days: 0, revenue: 0, engagements: 0 });
      cust.units.add(a.assetNumber); c.units.add(a.assetNumber);
      cust.days += e.leaseDays || 0; c.days += e.leaseDays || 0;
      cust.revenue += e.revenue || 0; c.revenue += e.revenue || 0;
      const isEngagement = e.cat === "out";   // a lease / exchange dispatched to them
      if (isEngagement) { cust.engagements++; c.engagements++; }
      const cur = a.status === "Out on lease" && a.customer === e.customer;
      cust.assets[a.assetNumber] = {
        assetNumber: a.assetNumber, aircraftType: a.aircraftType, nacelle: a.nacelle,
        status: a.status, engagementType: a.engagementType, current: cur,
      };
    });
  });
  return map;
}

export default function Customers() {
  const dataVersion = useAssets();
  const [dark, setDark] = useState(getDark);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  useEffect(() => { document.body.classList.toggle("theme-light", !dark); saveDark(dark); }, [dark]);

  const byCustomer = useMemo(() => buildCustomers(AssetStore.listAll()), [dataVersion]);
  const customers = useMemo(() =>
    Object.values(byCustomer).map((c) => ({ ...c, unitCount: c.units.size }))
      .sort((a, b) => b.revenue - a.revenue), [byCustomer]);
  const filtered = customers.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const current = sel && byCustomer[sel] ? byCustomer[sel] : null;

  const contracts = current
    ? Object.values(current.contracts).map((c) => ({ ...c, unitCount: c.units.size })).sort((a, b) => b.revenue - a.revenue)
    : [];
  const units = current ? Object.values(current.assets).sort((a, b) => (b.current - a.current) || a.assetNumber.localeCompare(b.assetNumber)) : [];
  const activeNow = units.filter((u) => u.current).length;

  return (
    <div className="page">
      <BusyOverlay show={assetsStatus() === "loading" && AssetStore.listAll().length === 0} label="Loading assets…" />
      <header className="app-header">
        <NavLink to="/" end className="brand" title="Go to Asset Register">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text">
            <span className="brand-name">ST Engineering Solutions</span>
            <span className="brand-tag">Customer Support</span>
          </div>
        </NavLink>
        <TopNav />
        <div className="header-right">
          <button className="theme-btn" onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"} mode</button>
          <UserMenu />
        </div>
      </header>

      <div className="cust-wrap">
        <aside className="cust-list">
          <div className="search-wrap" style={{ margin: "0 0 12px" }}>
            <svg viewBox="0 0 24 24" className="search-ico"><path d="M21 21l-4.3-4.3M11 19a8 8 0 110-16 8 8 0 010 16z" /></svg>
            <input className="search-input" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {filtered.map((c) => (
            <button key={c.name} className={"cust-item" + (sel === c.name ? " sel" : "")} onClick={() => setSel(c.name)}>
              <div className="cust-item-name">{c.name}</div>
              <div className="cust-item-sub">{c.unitCount} unit{c.unitCount === 1 ? "" : "s"} · {fmtMoney(c.revenue)}</div>
            </button>
          ))}
          {filtered.length === 0 && <div className="dim" style={{ padding: 14, fontSize: 13 }}>
            {assetsStatus() === "loading" ? "Loading…" : q ? "No matching customers." : "No customer activity yet."}
          </div>}
        </aside>

        <main className="cust-detail">
          {!current ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
              <div>Select a customer to see the rotables support we've provided.</div>
            </div>
          ) : (
            <>
              <div className="cust-head">
                <h2>{current.name}</h2>
              </div>
              <div className="cust-kpis">
                <div className="kpi"><div className="kpi-label">Units supported</div><div className="kpi-value">{current.units.size}</div></div>
                <div className="kpi kpi-lease"><div className="kpi-label">Currently out to them</div><div className="kpi-value">{activeNow}</div></div>
                <div className="kpi"><div className="kpi-label">Lease / exchange engagements</div><div className="kpi-value">{current.engagements}</div></div>
                <div className="kpi"><div className="kpi-label">Total days on lease</div><div className="kpi-value">{current.days.toLocaleString("en-US")}</div></div>
                <div className="kpi kpi-ready"><div className="kpi-label">Total revenue</div><div className="kpi-value">{fmtMoney(current.revenue)}</div></div>
              </div>

              <section className="card">
                <div className="card-head"><h3>By contract</h3><span className="card-sub">support grouped by the contract it falls under</span></div>
                <div className="card-body">
                  <table className="cust-table">
                    <thead><tr><th>Contract</th><th className="num">Units</th><th className="num">Engagements</th><th className="num">Days on lease</th><th className="num">Revenue</th></tr></thead>
                    <tbody>
                      {contracts.map((c) => (
                        <tr key={c.name}>
                          <td>{c.name === NO_CONTRACT ? <span className="dim">{c.name}</span> : <span style={{ color: "var(--accent)" }}>{c.name}</span>}</td>
                          <td className="num">{c.unitCount}</td>
                          <td className="num">{c.engagements}</td>
                          <td className="num">{c.days.toLocaleString("en-US")}</td>
                          <td className="num">{fmtMoney(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <div className="card-head"><h3>Units</h3><span className="card-sub">every asset we've supported them with</span></div>
                <div className="card-body">
                  <table className="cust-table">
                    <thead><tr><th>Asset</th><th>Type</th><th>Component</th><th>Status</th></tr></thead>
                    <tbody>
                      {units.map((u) => (
                        <tr key={u.assetNumber}>
                          <td className="mono">{u.assetNumber}</td>
                          <td>{u.aircraftType}</td>
                          <td>{u.nacelle}</td>
                          <td>{u.current ? <span style={{ color: "var(--lease)" }}>● out to them now{u.engagementType ? ` (${u.engagementType})` : ""}</span> : <span className="dim">{u.status}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
