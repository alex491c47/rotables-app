import React, { useState, useMemo, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { AssetStore, AssetCalc } from '../data/assetStore';
import { CITIES, FILTER_OPTIONS, fmtMoney } from '../data/mockData';

const TYPE_COLOR = { B787GENX: "#38bdf8", B787TRENT: "#818cf8", A320LEAP: "#2dd4bf" };
const STATUS_META = {
  "WIP": { c: "var(--wip)" }, "Ready to ship": { c: "var(--ready)" }, "Out on lease": { c: "var(--lease)" },
};
const CAT_COLOR = { out: "#38bdf8", in: "#a3e635", move: "#94a3b8", shop: "#64748b" };
const OWN_TYPES = ["Owned", "Long-term lease", "Short-term lease"];
const STATUSES = ["WIP", "Ready to ship", "Out on lease"];
const CUSTOMERS = ["SAS Scandinavian", "Brussels Airlines", "Lufthansa Technik", "Delta Air Lines",
  "Emirates", "Singapore Airlines", "Qantas", "Air China", "IndiGo", "ANA", "Gulf Air", "Cathay Pacific",
  "AerCap (lessor)", "Avolon (lessor)", "United Airlines"];
const CITY_NAMES = Object.keys(CITIES).sort();
const HUBS = CITY_NAMES.filter((c) => CITIES[c].type === "hub");
const today = () => new Date().toISOString().slice(0, 10);

const EVENT_TYPES = [
  { id: "wip", label: "Induction / In shop (WIP)", evt: "Induction", status: "WIP", cat: "shop", fields: ["to", "notes"], req: ["to"] },
  { id: "pool", label: "Back in Pool (Ready to ship)", evt: "Back in Pool", status: "Ready to ship", cat: "shop", fields: ["to", "notes"], req: ["to"] },
  { id: "short", label: "Out on short-term lease", evt: "Short-term lease", status: "Out on lease", cat: "out", contractType: "Short-term lease", fields: ["to", "customer", "dailyFee", "notes"], req: ["to", "customer", "dailyFee"] },
  { id: "long", label: "Out on long-term lease", evt: "Long-term lease — start", status: "Out on lease", cat: "out", contractType: "Long-term lease", fields: ["to", "customer", "monthlyRevenue", "contractYears", "notes"], req: ["to", "customer", "monthlyRevenue", "contractYears"] },
  { id: "exch", label: "Out on exchange", evt: "Exchange", status: "Out on lease", cat: "out", contractType: "Exchange", fields: ["to", "customer", "exchangeFee", "notes"], req: ["to", "customer", "exchangeFee"] },
  { id: "exchin", label: "Exchange core received (new P/N in)", evt: "Induction", status: "WIP", cat: "in", contractType: "Exchange", fields: ["to", "customer", "pn", "recertFee", "notes"], req: ["to", "pn"] },
  { id: "recert", label: "Recertification (lease return)", evt: "Recertification", status: "WIP", cat: "in", fields: ["to", "customer", "recertFee", "notes"], req: ["to"] },
  { id: "reloc", label: "Relocation between hubs", evt: "Relocation", status: "Ready to ship", cat: "move", fields: ["to", "notes"], req: ["to"] },
];
const FEE_FIELDS = ["dailyFee", "monthlyRevenue", "exchangeFee", "contractYears", "recertFee"];

const NOW_MS = AssetCalc.TODAY_MS;
const dMs = (d) => Date.parse(d + "T00:00:00Z");
const dayLabel = (n) => n + (n === 1 ? " day" : " days");

function StatusPill({ status }) {
  const m = STATUS_META[status] || {};
  return <span className="pill" style={{ color: m.c, background: "color-mix(in srgb, " + m.c + " 14%, transparent)" }}>
    <span className="pill-dot" style={{ background: m.c }}></span>{status}</span>;
}

function Field({ label, hint, children, span, req }) {
  return <div className={"field" + (span ? " col-span2" : "")}>
    <label>{label}{req && <span className="req"> *</span>}</label>{children}{hint && <span className="field-hint">{hint}</span>}</div>;
}

/* city picker — themed suggestion list that only opens once typing has
   narrowed the 3,000+ airports down to 7 or fewer matches */
function CityInput({ value, onChange, className, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = (value || "").trim().toLowerCase();
  const matches = q ? CITY_NAMES.filter((c) => c.toLowerCase().includes(q)) : [];
  const exact = matches.length === 1 && matches[0].toLowerCase() === q;
  const show = open && q.length > 0 && matches.length > 0 && matches.length <= 7 && !exact;
  return (
    <div className="city-ac" ref={ref}>
      <input className={className || "input"} value={value || ""} placeholder={placeholder || "Start typing a city…"}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setOpen(true); onChange(e.target.value); }} />
      {show && (
        <ul className="city-ac-list">
          {matches.map((c) => (
            <li key={c} className="city-ac-item"
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setOpen(false); }}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventLogger({ asset, onAppend }) {
  const [typeId, setTypeId] = useState("pool");
  const def = EVENT_TYPES.find((t) => t.id === typeId);
  const makeBlank = () => ({ date: today(), to: "", customer: "", dailyFee: "", monthlyRevenue: "", contractYears: "", exchangeFee: "", pn: "", recertFee: "", notes: "" });
  const [f, setF] = useState(makeBlank);
  const [errs, setErrs] = useState({});
  useEffect(() => { setF(makeBlank()); setErrs({}); }, [asset.assetNumber]);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const has = (k) => def.fields.includes(k);
  const isLease = def.cat === "out" && def.contractType !== "Exchange";

  const submit = () => {
    const miss = {};
    def.req.forEach((k) => {
      const v = f[k];
      if (FEE_FIELDS.includes(k)) { if (v === "" || Number(v) <= 0) miss[k] = 1; }
      else if (!v || !String(v).trim()) miss[k] = 1;
    });
    setErrs(miss);
    if (Object.keys(miss).length) return;

    const e = { date: f.date || today(), event: def.evt, cat: def.cat, status: def.status,
      from: asset.location || null, to: f.to || null,
      customer: has("customer") ? (f.customer || null) : null,
      contractType: def.contractType || null,
      contractYears: has("contractYears") ? (Number(f.contractYears) || null) : null,
      pn: has("pn") ? (f.pn || asset.partNumber) : asset.partNumber, notes: f.notes || "" };
    if (has("dailyFee")) e.dailyFee = Number(f.dailyFee) || 0;
    if (has("monthlyRevenue")) e.monthlyRevenue = Number(f.monthlyRevenue) || 0;
    if (has("exchangeFee")) e.exchangeFee = Number(f.exchangeFee) || 0;
    if (has("recertFee") && f.recertFee !== "") e.recertFee = Number(f.recertFee) || 0;
    onAppend(e);
    setF(makeBlank());
    setErrs({});
  };
  const cls = (k) => "input" + (errs[k] ? " err" : "");
  const scls = (k) => "select" + (errs[k] ? " err" : "");

  return (
    <div className="section">
      <h3 className="section-title">Log an event <span className="hint">appends to the timeline & recalculates the asset</span></h3>
      <div className="grid3">
        <Field label="Event type" span>
          <select className="select" value={typeId} onChange={(e) => { setTypeId(e.target.value); setErrs({}); }}>
            {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Date" req><input type="date" className="input mono" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Current location" hint="where the asset is now — update via Relocation"><input className="input mono" value={asset.location || "—"} disabled readOnly /></Field>
        {has("to") && <Field label={def.cat === "out" ? "To (customer city)" : def.cat === "move" ? "To (hub)" : "Location / hub"} req>
          <CityInput className={cls("to")} value={f.to} onChange={(v) => set("to", v)} placeholder={`Type ${def.cat === "out" ? "destination city" : "location"}…`} />
        </Field>}
        {has("customer") && <Field label="Customer" req={def.req.includes("customer")}>
          <input className={cls("customer")} list="cust-list" value={f.customer} onChange={(e) => set("customer", e.target.value)} placeholder="Customer" />
          <datalist id="cust-list">{CUSTOMERS.map((c) => <option key={c} value={c} />)}</datalist></Field>}
        {has("dailyFee") && <Field label="Daily lease fee (USD/day)" req hint="revenue recognised per day on lease"><input type="number" inputMode="numeric" className={cls("dailyFee") + " mono"} value={f.dailyFee} onChange={(e) => set("dailyFee", e.target.value)} /></Field>}
        {has("monthlyRevenue") && <Field label="Monthly revenue (USD/month)" req hint="recognised per month on lease"><input type="number" inputMode="numeric" className={cls("monthlyRevenue") + " mono"} value={f.monthlyRevenue} onChange={(e) => set("monthlyRevenue", e.target.value)} /></Field>}
        {has("contractYears") && <Field label="Contract length (years)" req hint="for utilisation planning"><input type="number" inputMode="numeric" className={cls("contractYears") + " mono"} value={f.contractYears} onChange={(e) => set("contractYears", e.target.value)} placeholder="e.g. 5" /></Field>}
        {has("exchangeFee") && <Field label="Exchange fee (USD)" req hint="recognised in the exchange month"><input type="number" inputMode="numeric" className={cls("exchangeFee") + " mono"} value={f.exchangeFee} onChange={(e) => set("exchangeFee", e.target.value)} /></Field>}
        {has("pn") && <Field label="Part number received" req><input className={cls("pn") + " mono"} value={f.pn} onChange={(e) => set("pn", e.target.value)} placeholder="new P/N" /></Field>}
        {has("recertFee") && <Field label="Recertification fee (USD)" hint="recognised as revenue (optional)"><input type="number" inputMode="numeric" className="input mono" value={f.recertFee} onChange={(e) => set("recertFee", e.target.value)} /></Field>}
        {has("notes") && <Field label="Notes" span><textarea className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={isLease ? "Optional — e.g. expected return / planning note" : "Optional note for the log"} /></Field>}
      </div>
      {(isLease || def.contractType === "Exchange") && <p className="field-hint" style={{ marginTop: 10 }}>Days leased are calculated automatically — from this date until the next logged event (or today). No need to enter them.</p>}
      <div className="row-actions" style={{ marginTop: 14 }}>
        <span className="dim" style={{ fontSize: 12, alignSelf: "center" }}>New status → <b style={{ color: STATUS_META[def.status].c }}>{def.status}</b></span>
        {Object.keys(errs).length > 0 && <span className="form-err" style={{ marginLeft: 14 }}>Fill the required fields.</span>}
        <div className="spacer"></div>
        <button className="btn" onClick={() => { setF(makeBlank()); setErrs({}); }}>Clear</button>
        <button className="btn btn-primary" onClick={submit}>+ Append event</button>
      </div>
    </div>
  );
}

function typeIdOf(e) {
  const ct = e.contractType || null;
  const exact = EVENT_TYPES.find((t) => t.evt === e.event && (t.contractType || null) === ct && t.cat === e.cat);
  if (exact) return exact.id;
  const byEvt = EVENT_TYPES.find((t) => t.evt === e.event && t.cat === e.cat) || EVENT_TYPES.find((t) => t.evt === e.event);
  return byEvt ? byEvt.id : "pool";
}

function Timeline({ asset, onEditEvent, onChangeType, onDeleteEvent }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [msg, setMsg] = useState(null);
  const hist = asset.history;
  const ev = hist.slice().reverse();

  const durationAt = (idx) => {
    const start = dMs(hist[idx].date);
    const end = idx + 1 < hist.length ? dMs(hist[idx + 1].date) : NOW_MS;
    return Math.max(0, Math.round((end - start) / 86400000));
  };

  const tryEditDate = (idx, newDate) => {
    if (!newDate) return;
    const prev = hist[idx - 1], next = hist[idx + 1];
    if (prev && newDate < prev.date) {
      setMsg({ idx, text: `Can't move before the previous event (${prev.event} on ${prev.date}).`, ok: false }); return;
    }
    if (next && newDate > next.date) {
      setMsg({ idx, text: `Can't move after the next event (${next.event} on ${next.date}).`, ok: false }); return;
    }
    setMsg({ idx, text: "Date updated.", ok: true });
    onEditEvent(idx, { date: newDate });
  };

  const lastIdx = hist.length - 1;
  const undoLast = () => {
    const e = hist[lastIdx];
    if (confirm(`Undo the most recent event — ${e.event} on ${e.date}? The asset returns to its previous state.`)) {
      if (openIdx === lastIdx) setOpenIdx(null);
      onDeleteEvent(lastIdx);
    }
  };

  return (
    <div className="section">
      <h3 className="section-title">Movement timeline
        <span className="hint">{hist.length} events · newest first · click ✎ to edit type, date, revenue & customer</span>
        <div className="spacer"></div>
        {hist.length > 1 && <button className="btn btn-sm" onClick={undoLast} title="Remove the most recent event">↺ Undo last event</button>}
      </h3>
      <div className="timeline">
        {ev.length === 0 && <div className="dim" style={{ fontSize: 13 }}>No events yet — log one above.</div>}
        {ev.map((e, ri) => {
          const idx = hist.length - 1 - ri;
          const col = CAT_COLOR[e.cat] || CAT_COLOR.shop;
          const dur = durationAt(idx);
          const ongoing = idx === lastIdx;
          const tId = typeIdOf(e);
          return (
            <div className="tl-event" key={idx}>
              <div className="tl-date">{e.date}
                <div className="tl-dur">({dayLabel(dur)}{ongoing ? ", ongoing" : ""})</div>
              </div>
              <div className="tl-body">
                <div className="tl-evt-name"><span className="tl-cat" style={{ background: col }}></span>{e.event}
                  {e.contractType && <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}>· {e.contractType}{e.contractYears ? ` (${e.contractYears} yr)` : ""}</span>}</div>
                <div className="tl-meta">
                  {(e.from || e.to) && <span>{e.from || "facility"} → <span className="mono">{e.to || asset.location}</span></span>}
                  {e.customer && <span>{e.customer}</span>}
                  {e.pn && <span className="mono">{e.pn}</span>}
                  {e.leaseDays ? <span>{e.leaseDays} d</span> : null}
                  {e.revenue ? <span style={{ color: "var(--ready)" }}>{fmtMoney(e.revenue)}</span> : null}
                  <StatusPill status={e.status} />
                </div>
                {e.notes && <div className="tl-notes">{e.notes}</div>}
                {openIdx === idx && (() => {
                  const eDef = EVENT_TYPES.find((t) => t.id === tId) || { fields: [] };
                  const fhas = (k) => eDef.fields.includes(k);
                  return (
                    <div className="tl-inline">
                      <label>Event type
                        <select className="select" value={tId} onChange={(ev2) => { setMsg(null); onChangeType(idx, ev2.target.value); }}>
                          {EVENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </label>
                      <label>Date
                        <input type="date" className="input mono" defaultValue={e.date} key={e.date}
                          onBlur={(ev2) => tryEditDate(idx, ev2.target.value)} />
                      </label>
                      {fhas("to") && <label>{eDef.cat === "out" ? "Customer city" : "Location"}
                        <CityInput className="input" value={e.to || ""} placeholder="Type city…"
                          onChange={(v) => onEditEvent(idx, { to: v })} />
                      </label>}
                      {fhas("dailyFee") && <label>Daily fee <input type="number" inputMode="numeric" className="input mono" defaultValue={e.dailyFee || 0}
                        onBlur={(ev2) => onEditEvent(idx, { dailyFee: Number(ev2.target.value) || 0 })} /></label>}
                      {fhas("monthlyRevenue") && <label>Monthly rev <input type="number" inputMode="numeric" className="input mono" defaultValue={e.monthlyRevenue || 0}
                        onBlur={(ev2) => onEditEvent(idx, { monthlyRevenue: Number(ev2.target.value) || 0 })} /></label>}
                      {fhas("exchangeFee") && <label>Exchange fee <input type="number" inputMode="numeric" className="input mono" defaultValue={e.exchangeFee || 0}
                        onBlur={(ev2) => onEditEvent(idx, { exchangeFee: Number(ev2.target.value) || 0 })} /></label>}
                      {fhas("recertFee") && <label>Recert fee <input type="number" inputMode="numeric" className="input mono" defaultValue={e.recertFee || 0}
                        onBlur={(ev2) => onEditEvent(idx, { recertFee: Number(ev2.target.value) || 0 })} /></label>}
                      {fhas("contractYears") && <label>Contract yrs <input type="number" inputMode="numeric" className="input mono" defaultValue={e.contractYears || ""}
                        onBlur={(ev2) => onEditEvent(idx, { contractYears: ev2.target.value === "" ? null : Number(ev2.target.value) })} /></label>}
                      {fhas("customer") && <label>Customer <input className="input" defaultValue={e.customer || ""}
                        onBlur={(ev2) => onEditEvent(idx, { customer: ev2.target.value || null })} /></label>}
                      {fhas("pn") && <label>P/N received <input className="input mono" defaultValue={e.pn || ""}
                        onBlur={(ev2) => onEditEvent(idx, { pn: ev2.target.value || asset.partNumber })} /></label>}
                      {msg && msg.idx === idx && <div className={"tl-inline-msg " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
                    </div>
                  );
                })()}
              </div>
              <div className="tl-actions">
                <button className="icon-btn" title="Edit event" onClick={() => { setMsg(null); setOpenIdx(openIdx === idx ? null : idx); }}>✎</button>
                <button className="icon-btn del" title="Remove event" onClick={() => { if (confirm("Remove this event from the timeline?")) onDeleteEvent(idx); }}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RawFields({ asset, onChange }) {
  const set = (k, v) => onChange({ ...asset, [k]: v });
  const dep = asset.depOverride || null;
  const setDep = (patch) => onChange({ ...asset, depOverride: { life: 10, residual: 0, from: today(), ...(dep || {}), ...patch } });
  return (
    <div className="section">
      <h3 className="section-title">Asset details <span className="hint">correct static information</span></h3>
      <div className="grid3">
        <Field label="Engine type">
          <input className="input" list="aircraft-list-raw" value={asset.aircraftType} onChange={(e) => set("aircraftType", e.target.value)} placeholder="e.g. B787GENX or type new…" autoComplete="off" />
          <datalist id="aircraft-list-raw">{FILTER_OPTIONS.aircraft.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Component"><select className="select" value={asset.nacelle} onChange={(e) => set("nacelle", e.target.value)}>
          {FILTER_OPTIONS.nacelle.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Ownership"><select className="select" value={asset.ownership || "Owned"} onChange={(e) => set("ownership", e.target.value)}>
          {OWN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="CLP (USD)" hint="catalogue list price"><input type="number" className="input mono" value={asset.clp != null ? asset.clp : ""} placeholder="auto from type" onChange={(e) => set("clp", e.target.value === "" ? null : Number(e.target.value))} /></Field>
        <Field label="Daily rate (USD)"><input type="number" className="input mono" value={asset.dailyRate || ""} onChange={(e) => set("dailyRate", Number(e.target.value) || 0)} /></Field>
        <Field label="Initial part number"><input className="input mono" value={asset.initialPartNumber || ""} onChange={(e) => set("initialPartNumber", e.target.value)} /></Field>
        <Field label="Description" span><input className="input" value={asset.description || ""} onChange={(e) => set("description", e.target.value)} /></Field>
      </div>

      <div style={{ marginTop: 18 }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={!!dep} onChange={(e) => onChange({ ...asset, depOverride: e.target.checked ? { life: 10, residual: 0, from: today() } : null })} />
          Override depreciation scheme from a date
        </label>
        {dep && (
          <div className="grid3" style={{ marginTop: 12 }}>
            <Field label="New life (years)"><input type="number" className="input mono" value={dep.life} onChange={(e) => setDep({ life: Number(e.target.value) || 0 })} /></Field>
            <Field label="Residual (%)" hint="of CLP-based value"><input type="number" className="input mono" value={Math.round((dep.residual || 0) * 100)} onChange={(e) => setDep({ residual: (Number(e.target.value) || 0) / 100 })} /></Field>
            <Field label="Effective from"><input type="date" className="input mono" value={dep.from} onChange={(e) => setDep({ from: e.target.value })} /></Field>
          </div>
        )}
        <p className="field-hint" style={{ marginTop: 8 }}>Depreciation before the effective date is kept; the new straight-line scheme applies after it. Net book value & analytics update automatically.</p>
      </div>
    </div>
  );
}

function NewAssetModal({ onClose, onCreate }) {
  const [suggestedNo] = useState(() => AssetStore.nextNumber());
  const [a, setA] = useState({
    assetNumber: "", aircraftType: "", nacelle: "",
    initialPartNumber: "", ownership: "", clp: "", acquisitionValue: "", dailyRate: "",
    depMethod: "Straight-line", depLife: "25", depResidual: "0",
    description: "", inDate: today(), hub: "", status: "",
  });
  const [errs, setErrs] = useState({});
  const set = (k, v) => setA((s) => ({ ...s, [k]: v }));
  const isSTL = a.ownership === "Short-term lease";
  const capitalised = a.ownership === "Owned" || a.ownership === "Long-term lease";

  const create = () => {
    const e = {};
    if (!a.assetNumber.trim()) e.assetNumber = 1;
    if (!a.aircraftType.trim()) e.aircraftType = 1;
    if (!a.nacelle) e.nacelle = 1;
    if (!a.ownership) e.ownership = 1;
    if (!a.status) e.status = 1;
    if (!a.initialPartNumber.trim()) e.initialPartNumber = 1;
    if (a.clp === "" || Number(a.clp) <= 0) e.clp = 1;
    if (!a.inDate) e.inDate = 1;
    if (!a.hub) e.hub = 1;
    if (capitalised && (a.acquisitionValue === "" || Number(a.acquisitionValue) <= 0)) e.acquisitionValue = 1;
    if (capitalised && (a.depLife === "" || Number(a.depLife) <= 0)) e.depLife = 1;
    if (isSTL && (a.dailyRate === "" || Number(a.dailyRate) <= 0)) e.dailyRate = 1;
    if (AssetStore.get(a.assetNumber.trim())) e.assetNumber = 1;
    setErrs(e);
    if (Object.keys(e).length) return;

    const ev = [{ date: a.inDate, event: a.status === "WIP" ? "Induction" : "Back in Pool", cat: "shop", status: a.status,
      from: null, to: a.hub, customer: null, revenue: 0, leaseDays: null, contractType: null, contractYears: null,
      pn: a.initialPartNumber, notes: "Asset added via editor." }];
    const asset = {
      assetNumber: a.assetNumber.trim(), aircraftType: a.aircraftType, nacelle: a.nacelle,
      initialPartNumber: a.initialPartNumber, partNumber: a.initialPartNumber,
      ownership: a.ownership, clp: Number(a.clp), dailyRate: isSTL ? Number(a.dailyRate) : 0,
      description: a.description || `${a.aircraftType} ${a.nacelle}`, status: a.status, location: a.hub,
      customer: null, engagementType: null, contractYears: null, history: ev,
    };
    if (capitalised) {
      asset.acquisitionValue = Number(a.acquisitionValue);
      asset.depMethod = a.depMethod;
      asset.depLife = Number(a.depLife);
      asset.depResidual = (Number(a.depResidual) || 0) / 100;
    }
    onCreate(asset);
  };
  const cx = (k) => "input" + (errs[k] ? " err" : "");
  const sx = (k) => "select" + (errs[k] ? " err" : "");

  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-head"><h3>Add new asset</h3><button className="icon-btn" onClick={onClose} style={{ fontSize: 20 }}>×</button></div>
        <div className="modal-body">
          <div className="grid2">
            <Field label="Asset number" req hint={`next free number: ${suggestedNo}`}><input className={cx("assetNumber") + " mono"} value={a.assetNumber} placeholder={`e.g. ${suggestedNo}`} onChange={(e) => set("assetNumber", e.target.value)} /></Field>
            <Field label="Ownership" req>
              <select className={sx("ownership")} value={a.ownership} onChange={(e) => set("ownership", e.target.value)}>
                <option value="" disabled>— select —</option>
                {OWN_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Engine type" req>
              <input className={cx("aircraftType")} list="aircraft-list" value={a.aircraftType} onChange={(e) => set("aircraftType", e.target.value)} placeholder="e.g. B787GENX or type new…" autoComplete="off" />
              <datalist id="aircraft-list">{FILTER_OPTIONS.aircraft.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label="Component" req>
              <select className={sx("nacelle")} value={a.nacelle} onChange={(e) => set("nacelle", e.target.value)}>
                <option value="" disabled>— select —</option>
                {FILTER_OPTIONS.nacelle.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Initial part number" req><input className={cx("initialPartNumber") + " mono"} value={a.initialPartNumber} onChange={(e) => set("initialPartNumber", e.target.value)} placeholder="e.g. TR-GEnx1B-1492" /></Field>
            <Field label="CLP (USD)" req hint="catalogue list price — guidance only"><input type="number" inputMode="numeric" className={cx("clp") + " mono"} value={a.clp} onChange={(e) => set("clp", e.target.value)} /></Field>
            {capitalised && (
              <Field label="Acquisition value (USD)" req hint="NBV & depreciation are based on this"><input type="number" inputMode="numeric" className={cx("acquisitionValue") + " mono"} value={a.acquisitionValue} onChange={(e) => set("acquisitionValue", e.target.value)} /></Field>
            )}
            {isSTL && (
              <Field label="Daily lease-in cost (USD)" req hint="what we pay the lessor / day"><input type="number" inputMode="numeric" className={cx("dailyRate") + " mono"} value={a.dailyRate} onChange={(e) => set("dailyRate", e.target.value)} /></Field>
            )}
            {capitalised && (
              <React.Fragment>
                <Field label="Depreciation method" req><select className="select" value={a.depMethod} onChange={(e) => set("depMethod", e.target.value)}>
                  <option>Straight-line</option><option>Declining balance</option></select></Field>
                <Field label="Depreciation years" req><input type="number" inputMode="numeric" className={cx("depLife") + " mono"} value={a.depLife} onChange={(e) => set("depLife", e.target.value)} /></Field>
                <Field label="Residual (%)" hint="of acquisition value"><input type="number" inputMode="numeric" className="input mono" value={a.depResidual} onChange={(e) => set("depResidual", e.target.value)} /></Field>
              </React.Fragment>
            )}
            <Field label="Status" req>
              <select className={sx("status")} value={a.status} onChange={(e) => set("status", e.target.value)}>
                <option value="" disabled>— select —</option>
                {STATUSES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Induction date" req><input type="date" className={cx("inDate") + " mono"} value={a.inDate} onChange={(e) => set("inDate", e.target.value)} /></Field>
            <Field label="Hub / location" req>
              <CityInput className={cx("hub")} value={a.hub} onChange={(v) => set("hub", v)} placeholder="Start typing a city…" />
            </Field>
            <Field label="Description" span hint="auto if left blank"><input className="input" value={a.description} onChange={(e) => set("description", e.target.value)} /></Field>
          </div>
        </div>
        <div className="modal-foot">
          {Object.keys(errs).length > 0 && <span className="form-err">Please fill the required fields{errs.assetNumber && AssetStore.get(a.assetNumber.trim()) ? " (asset number already exists)" : ""}.</span>}
          <button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={create}>Create asset</button>
        </div>
      </div>
    </div>
  );
}

const BrandMark = () => (
  <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />
);

export default function Editor() {
  const [dark, setDark] = useState(true);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { document.body.classList.toggle("theme-light", !dark); }, [dark]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return AssetStore.list().filter((a) => !ql ||
      (a.assetNumber + " " + a.partNumber + " " + a.aircraftType + " " + a.nacelle + " " + (a.customer || "") + " " + (a.location || "")).toLowerCase().includes(ql));
  }, [q, tick]);

  const selectAsset = (id) => {
    setSelId(id);
    const a = AssetStore.get(id);
    setDraft(a ? JSON.parse(JSON.stringify(a)) : null);
    setDirty(false);
  };

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1800); };
  const refresh = () => setTick((t) => t + 1);

  const updateDraft = (next) => { setDraft(next); setDirty(true); };

  const appendEvent = (e) => {
    const next = { ...draft, history: [...draft.history, e] };
    AssetStore.recompute(next);
    setDraft(next); setDirty(true);
  };
  const editEvent = (idx, patch) => {
    const hist = draft.history.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    const next = { ...draft, history: hist };
    AssetStore.recompute(next);
    setDraft(next); setDirty(true);
  };
  const changeEventType = (idx, typeId) => {
    const t = EVENT_TYPES.find((x) => x.id === typeId);
    if (!t) return;
    const hist = draft.history.map((h, i) => {
      if (i !== idx) return h;
      const n = { ...h, event: t.evt, cat: t.cat, status: t.status, contractType: t.contractType || null };
      const keep = (k) => t.fields.includes(k);
      n.dailyFee = keep("dailyFee") ? (h.dailyFee != null ? h.dailyFee : 0) : undefined;
      n.monthlyRevenue = keep("monthlyRevenue") ? (h.monthlyRevenue != null ? h.monthlyRevenue : 0) : undefined;
      n.exchangeFee = keep("exchangeFee") ? (h.exchangeFee != null ? h.exchangeFee : 0) : undefined;
      n.recertFee = keep("recertFee") ? (h.recertFee != null ? h.recertFee : 0) : undefined;
      n.contractYears = keep("contractYears") ? (h.contractYears || null) : null;
      if (!["dailyFee", "monthlyRevenue", "exchangeFee", "recertFee"].some(keep)) { n.revenue = 0; n.leaseDays = null; }
      return n;
    });
    const next = { ...draft, history: hist };
    AssetStore.recompute(next);
    setDraft(next); setDirty(true);
  };
  const deleteEvent = (idx) => {
    const next = { ...draft, history: draft.history.filter((_, i) => i !== idx) };
    AssetStore.recompute(next);
    setDraft(next); setDirty(true);
  };

  const save = () => { AssetStore.save(draft); setDirty(false); refresh(); selectAsset(draft.assetNumber); flash("Saved — changes flow to Register & Analytics"); };
  const revert = () => { AssetStore.revert(selId); refresh(); selectAsset(selId); flash("Reverted to generated data"); };
  const removeAsset = () => { if (!confirm("Remove this asset from the register?")) return; const id = selId; AssetStore.remove(id); setSelId(null); setDraft(null); refresh(); flash("Asset removed"); };
  const createAsset = (a) => { AssetStore.save(a); setShowNew(false); refresh(); selectAsset(a.assetNumber); flash("Asset created"); };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text"><span className="brand-name">ST Engineering Solutions</span><span className="brand-tag">Asset Editor</span></div>
        </div>
        <nav className="topnav">
          <NavLink to="/" end>Asset Register</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/editor">Editor</NavLink>
        </nav>
        <div className="header-right">
          {AssetStore.editCount() > 0 && <span className="edit-badge"><b>{AssetStore.editCount()}</b> local edit{AssetStore.editCount() === 1 ? "" : "s"}</span>}
          <button className="btn" onClick={() => { if (confirm("Discard ALL local edits and restore generated data?")) { AssetStore.resetAll(); setSelId(null); setDraft(null); refresh(); flash("All edits reset"); } }}>Reset all</button>
          <button className="btn" onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"}</button>
        </div>
      </header>

      <div className="body-row">
        <aside className="aside">
          <div className="aside-head">
            <div className="search-wrap">
              <svg viewBox="0 0 24 24" className="search-ico"><path d="M21 21l-4.3-4.3M11 19a8 8 0 110-16 8 8 0 010 16z" /></svg>
              <input className="search-input" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)} title="Add new asset">+ New</button>
          </div>
          <div className="alist">
            {list.map((a) => (
              <div key={a.assetNumber} className={"aitem" + (selId === a.assetNumber ? " sel" : "")} onClick={() => selectAsset(a.assetNumber)}>
                <span className="aitem-dot" style={{ background: (STATUS_META[a.status] || {}).c }}></span>
                <div className="aitem-main">
                  <div className="aitem-id">{a.assetNumber}</div>
                  <div className="aitem-sub">{a.aircraftType} · {a.nacelle}</div>
                </div>
                {AssetStore.isAdded(a.assetNumber) ? <span className="aitem-flag new">new</span>
                  : AssetStore.isEdited(a.assetNumber) ? <span className="aitem-flag">edited</span> : null}
              </div>
            ))}
            {list.length === 0 && <div className="dim" style={{ padding: 16, fontSize: 13 }}>No matching assets.</div>}
          </div>
        </aside>

        <main className="main">
          {!draft ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
              <div>Select an asset to edit, or <a href="#" onClick={(e) => { e.preventDefault(); setShowNew(true); }} style={{ color: "var(--accent)" }}>add a new one</a>.</div>
            </div>
          ) : (
            <div className="editor">
              <div className="ed-head">
                <div>
                  <div className="ed-title">{draft.assetNumber}</div>
                  <div className="ed-sub">{draft.description}</div>
                </div>
                <div className="ed-head-actions">
                  <StatusPill status={draft.status} />
                  {dirty && <span className="dim" style={{ fontSize: 12, color: "var(--wip)" }}>● unsaved</span>}
                  <button className="btn btn-primary" disabled={!dirty} onClick={save} style={!dirty ? { opacity: .5 } : null}>Save</button>
                  {AssetStore.isBase(selId) && AssetStore.isEdited(selId) && <button className="btn" onClick={revert}>Revert</button>}
                  <button className="btn btn-danger btn-sm" onClick={removeAsset}>Remove asset</button>
                </div>
              </div>

              {dirty && <div className="banner banner-warn"><span>●</span> Unsaved changes — click <b>Save</b> to persist them and update the Register & Analytics views.</div>}

              <EventLogger asset={draft} onAppend={appendEvent} />
              <Timeline asset={draft} onEditEvent={editEvent} onChangeType={changeEventType} onDeleteEvent={deleteEvent} />
              <RawFields asset={draft} onChange={updateDraft} />
            </div>
          )}
        </main>
      </div>

      {showNew && <NewAssetModal onClose={() => setShowNew(false)} onCreate={createAsset} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
