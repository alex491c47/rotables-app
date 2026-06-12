import React, { useState, useMemo, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { AssetStore, AssetCalc, useAssets, assetsStatus } from '../data/assetStore';
import { CITIES, FILTER_OPTIONS, fmtMoney, COMMON_CUSTOMERS } from '../data/mockData';
import { getDark, saveDark } from '../lib/theme';
import { effectiveFinance } from '../lib/analyticsModel';
import UserMenu from '../components/UserMenu';
import TopNav from '../components/TopNav';

/* sessionStorage-backed state — survives navigating to another page and back
   (and a reload), so a half-finished asset/location pop-up or unsaved edits
   aren't lost when you pop over to another page to look something up. The keys
   are cleared explicitly on save / create / cancel. */
const SS = (k) => `ste-editor:${k}`;
function loadSS(k, fallback) {
  try { const s = sessionStorage.getItem(SS(k)); return s != null ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}
function clearSS(...keys) { keys.forEach((k) => { try { sessionStorage.removeItem(SS(k)); } catch (e) {} }); }
function usePersistent(k, initial) {
  const [v, setV] = useState(() => loadSS(k, typeof initial === "function" ? initial() : initial));
  useEffect(() => { try { sessionStorage.setItem(SS(k), JSON.stringify(v)); } catch (e) {} }, [k, v]);
  return [v, setV];
}

const TYPE_COLOR = { B787GENX: "#38bdf8", B787TRENT: "#818cf8", A320LEAP: "#2dd4bf" };
const STATUS_META = {
  "WIP": { c: "var(--wip)" }, "Ready to ship": { c: "var(--ready)" }, "Out on lease": { c: "var(--lease)" },
  // end-of-use states
  "Returned": { c: "#7c93b0" }, "Sold": { c: "#5fa888" }, "Retired": { c: "var(--dim)" }, "Destroyed": { c: "#c97b7b" },
};
const CAT_COLOR = { out: "#38bdf8", in: "#a3e635", move: "#94a3b8", shop: "#64748b", end: "#64748b" };
const OWN_TYPES = ["Owned", "Long-term lease", "Short-term lease"];
const STATUSES = ["WIP", "Ready to ship", "Out on lease"];
const CUSTOMERS = COMMON_CUSTOMERS;
// dropdown options = customers known to the database (which were seeded from the
// defaults) merged with the built-in list, so newly-added customers appear too
const customerOptions = () => Array.from(new Set([...AssetStore.customerList(), ...COMMON_CUSTOMERS])).sort();
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
  // End-of-use events — archive the asset (drops off the Register, kept in Analytics + historical view)
  { id: "return", label: "End of use — returned to lessor / lease ended", evt: "Returned — end of lease", status: "Returned", cat: "end", fields: ["notes"], req: [] },
  { id: "sold", label: "End of use — sold outright to customer", evt: "Sold outright", status: "Sold", cat: "end", fields: ["customer", "salePrice", "notes"], req: ["customer"] },
  { id: "scrap", label: "End of use — scrapped for parts", evt: "Scrapped for parts", status: "Retired", cat: "end", fields: ["notes"], req: [] },
  { id: "destroyed", label: "End of use — destroyed (fire / write-off)", evt: "Destroyed", status: "Destroyed", cat: "end", fields: ["customer", "notes"], req: [] },
];
const FEE_FIELDS = ["dailyFee", "monthlyRevenue", "exchangeFee", "contractYears", "recertFee", "salePrice"];

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

/* Rank options for a typed query: whole-string prefix matches first, then
   matches where any word starts with the query. Anything that doesn't start
   with the query is dropped — so typing "STO" surfaces Stockholm and removes
   Boston entirely, and typing "york" still finds "New York". */
function rankMatches(options, q) {
  const ql = q.toLowerCase();
  if (!ql) return options;
  const starts = [], wordStarts = [];
  for (const o of options) {
    const ol = o.toLowerCase();
    if (ol.startsWith(ql)) starts.push(o);
    else if (ol.split(/[\s\-/.,]+/).some((w) => w.startsWith(ql))) wordStarts.push(o);
  }
  return [...starts, ...wordStarts];
}

/* themed suggestion input — a text field with a dropdown that matches the app.
   showAll: list opens on focus with every option (short lists like engine types).
   Otherwise the list opens once typing begins, capped to `limit` for long lists
   (the 3,000+ airports). Free text is always allowed. The list stays open even
   when the value exactly matches an option, so you can confirm it; ↑/↓ move the
   highlight and Tab or Enter selects the highlighted row. */
function SuggestInput({ value, onChange, options, showAll, limit, className, placeholder }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = (value || "").trim();
  const matches = q ? rankMatches(options, q) : (showAll ? options : []);
  const shown = limit ? matches.slice(0, limit) : matches;
  const show = open && shown.length > 0 && (showAll || q.length > 0);
  // keep the highlight on the best (first) match as the list narrows while typing
  useEffect(() => { setActive(0); }, [value]);
  const ai = Math.min(active, shown.length - 1);
  const pick = (c) => { onChange(c); setOpen(false); };
  const onKey = (e) => {
    if (!show) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" || e.key === "Tab") {
      if (shown[ai]) { e.preventDefault(); pick(shown[ai]); }
    } else if (e.key === "Escape") { setOpen(false); }
  };
  return (
    <div className="city-ac" ref={ref}>
      <input className={className || "input"} value={value || ""} placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        onChange={(e) => { setOpen(true); onChange(e.target.value); }} />
      {show && (
        <ul className="city-ac-list">
          {shown.map((c, i) => (
            <li key={c} className={"city-ac-item" + (i === ai ? " active" : "")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}>{c}</li>
          ))}
          {limit && matches.length > shown.length && <li className="city-ac-more">+{matches.length - shown.length} more — keep typing…</li>}
        </ul>
      )}
    </div>
  );
}
const CityInput = (props) => <SuggestInput options={AssetStore.cityList()} limit={9} placeholder="Type a city…" {...props} />;

/* themed date picker — replaces the browser's native calendar (which can't be
   styled to match). value/onChange use ISO "YYYY-MM-DD" strings. */
const CAL_WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const CAL_MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function fmtDateDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${CAL_MONTHS[m - 1].slice(0, 3)} ${y}`;
}
function DateField({ value, onChange, className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const base = value ? value.split("-").map(Number) : null;
  const todayISO = new Date().toISOString().slice(0, 10);
  const t = todayISO.split("-").map(Number);
  const [view, setView] = useState(() => base ? { y: base[0], m: base[1] - 1 } : { y: t[0], m: t[1] - 1 });
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const openCal = () => { if (base) setView({ y: base[0], m: base[1] - 1 }); setOpen(true); };
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const firstDow = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // Monday-first
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const shift = (delta) => setView((v) => {
    const nm = v.m + delta;
    return { y: v.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });
  const pick = (d) => {
    onChange(`${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    setOpen(false);
  };
  const isSel = (d) => base && base[0] === view.y && base[1] - 1 === view.m && base[2] === d;
  const isToday = (d) => t[0] === view.y && t[1] - 1 === view.m && t[2] === d;
  return (
    <div className="city-ac" ref={ref}>
      <button type="button" className={(className || "input") + " date-btn"} onClick={openCal}>
        <span className={value ? "" : "picker-ph"}>{value ? fmtDateDisplay(value) : "Select date…"}</span>
        <svg className="date-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="4.5" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="cal">
          <div className="cal-head">
            <div className="cal-nav-grp">
              <button type="button" className="cal-nav" title="Previous year" onClick={() => shift(-12)}>«</button>
              <button type="button" className="cal-nav" title="Previous month" onClick={() => shift(-1)}>‹</button>
            </div>
            <span className="cal-title">{CAL_MONTHS[view.m]} {view.y}</span>
            <div className="cal-nav-grp">
              <button type="button" className="cal-nav" title="Next month" onClick={() => shift(1)}>›</button>
              <button type="button" className="cal-nav" title="Next year" onClick={() => shift(12)}>»</button>
            </div>
          </div>
          <div className="cal-grid cal-dow">
            {CAL_WEEKDAYS.map((w) => <span key={w} className="cal-dow-cell">{w}</span>)}
          </div>
          <div className="cal-grid">
            {cells.map((d, i) => d === null
              ? <span key={i} className="cal-empty"></span>
              : <button type="button" key={i}
                  className={"cal-day" + (isSel(d) ? " sel" : "") + (isToday(d) ? " today" : "")}
                  onClick={() => pick(d)}>{d}</button>)}
          </div>
          <div className="cal-foot">
            <button type="button" className="cal-link" onClick={() => { onChange(todayISO); setOpen(false); }}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* money input — shows thousand separators ("1,982,000") while editing.
   onChange emits a plain digit string ("1982000") or "" so callers can Number() it. */
function MoneyInput({ value, onChange, className, placeholder }) {
  const digits = value == null ? "" : String(value).replace(/[^\d]/g, "");
  const display = digits === "" ? "" : Number(digits).toLocaleString("en-US");
  return (
    <input className={className} inputMode="numeric" placeholder={placeholder}
      value={display}
      onChange={(e) => { const raw = e.target.value.replace(/[^\d]/g, ""); onChange(raw); }} />
  );
}

/* themed dropdown for fixed choices — looks like the suggestion lists above,
   but behaves like a <select> (click to open, pick one, no free text) */
function Picker({ value, onChange, options, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="city-ac" ref={ref}>
      <button type="button" className={(className || "select") + " picker-btn"}
        onClick={() => setOpen((o) => !o)}>
        <span className={value ? "" : "picker-ph"}>{value || placeholder || "— select —"}</span>
      </button>
      {open && (
        <ul className="city-ac-list">
          {options.map((o) => (
            <li key={o} className={"city-ac-item" + (o === value ? " sel" : "")}
              onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventLogger({ asset, onAppend }) {
  const [typeId, setTypeId] = usePersistent("evtType", "pool");
  const def = EVENT_TYPES.find((t) => t.id === typeId) || EVENT_TYPES.find((t) => t.id === "pool");
  const makeBlank = () => ({ date: today(), to: "", customer: "", dailyFee: "", monthlyRevenue: "", contractYears: "", exchangeFee: "", pn: "", recertFee: "", salePrice: "", notes: "" });
  const [f, setF] = usePersistent("evtForm", makeBlank);
  const [errs, setErrs] = useState({});
  const [showLoc, setShowLoc] = usePersistent("showLoc", false);
  // The in-progress event form survives navigating away and back (it's persisted),
  // but is reset to blank when you switch to a DIFFERENT asset — tracked via owner.
  const [fOwner, setFOwner] = usePersistent("evtFormOwner", null);
  useEffect(() => {
    if (fOwner !== asset.assetNumber) {
      setF(makeBlank()); setErrs({}); setTypeId("pool"); setFOwner(asset.assetNumber);
    }
  }, [asset.assetNumber]);
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
    // a typed location must be one the system knows, or the database rejects the
    // event (the city is a foreign key). Pick it from the list or add it first.
    if (has("to") && String(f.to || "").trim() && !AssetStore.cityList().includes(f.to.trim())) {
      miss.to = 1; miss._city = 1;
    }
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
    if (has("salePrice") && f.salePrice !== "") e.salePrice = Number(f.salePrice) || 0;
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
          <Picker className="select" options={EVENT_TYPES.map((t) => t.label)} value={def.label}
            onChange={(label) => { const t = EVENT_TYPES.find((x) => x.label === label); if (t) { setTypeId(t.id); setErrs({}); } }} />
        </Field>
        <Field label="Date" req><DateField className="input mono" value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Current location" hint="where the asset is now — update via Relocation"><input className="input mono" value={asset.location || "—"} disabled readOnly /></Field>
        {has("to") && <Field label={def.cat === "out" ? "To (customer city)" : def.cat === "move" ? "To (hub)" : "Location / hub"} req>
          <CityInput className={cls("to")} value={f.to} onChange={(v) => set("to", v)} placeholder={`Type ${def.cat === "out" ? "destination city" : "location"}…`} />
          <button type="button" className="add-loc-link" onClick={() => setShowLoc(true)}>+ Add a new location</button>
        </Field>}
        {has("customer") && <Field label="Customer" req={def.req.includes("customer")}>
          <SuggestInput className={cls("customer")} options={customerOptions()} showAll value={f.customer} onChange={(v) => set("customer", v)} placeholder="Select or type customer…" /></Field>}
        {has("dailyFee") && <Field label="Daily lease fee (USD/day)" req hint="revenue recognised per day on lease"><MoneyInput className={cls("dailyFee") + " mono"} value={f.dailyFee} onChange={(v) => set("dailyFee", v)} /></Field>}
        {has("monthlyRevenue") && <Field label="Monthly revenue (USD/month)" req hint="recognised per month on lease"><MoneyInput className={cls("monthlyRevenue") + " mono"} value={f.monthlyRevenue} onChange={(v) => set("monthlyRevenue", v)} /></Field>}
        {has("contractYears") && <Field label="Contract length (years)" req hint="for utilisation planning"><input type="number" inputMode="numeric" className={cls("contractYears") + " mono"} value={f.contractYears} onChange={(e) => set("contractYears", e.target.value)} placeholder="e.g. 5" /></Field>}
        {has("exchangeFee") && <Field label="Exchange fee (USD)" req hint="recognised in the exchange month"><MoneyInput className={cls("exchangeFee") + " mono"} value={f.exchangeFee} onChange={(v) => set("exchangeFee", v)} /></Field>}
        {has("pn") && <Field label="Part number received" req><input className={cls("pn") + " mono"} value={f.pn} onChange={(e) => set("pn", e.target.value)} placeholder="new P/N" /></Field>}
        {has("recertFee") && <Field label="Recertification fee (USD)" hint="recognised as revenue (optional)"><MoneyInput className="input mono" value={f.recertFee} onChange={(v) => set("recertFee", v)} /></Field>}
        {has("salePrice") && <Field label="Sale price (USD)" hint="one-off revenue on outright sale (optional)"><MoneyInput className="input mono" value={f.salePrice} onChange={(v) => set("salePrice", v)} /></Field>}
        {has("notes") && <Field label="Notes" span><textarea className="input" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={def.cat === "end" ? "Optional — reason / reference" : isLease ? "Optional — e.g. expected return / planning note" : "Optional note for the log"} /></Field>}
      </div>
      {(isLease || def.contractType === "Exchange") && <p className="field-hint" style={{ marginTop: 10 }}>Days leased are calculated automatically — from this date until the next logged event (or today). No need to enter them.</p>}
      <div className="row-actions" style={{ marginTop: 14 }}>
        <span className="dim" style={{ fontSize: 12, alignSelf: "center" }}>New status → <b style={{ color: STATUS_META[def.status].c }}>{def.status}</b></span>
        {Object.keys(errs).length > 0 && <span className="form-err" style={{ marginLeft: 14 }}>{errs._city ? "City not recognised — pick it from the list or use “+ Add a new location”." : "Fill the required fields."}</span>}
        <div className="spacer"></div>
        <button className="btn" onClick={() => { setF(makeBlank()); setErrs({}); }}>Clear</button>
        <button className="btn btn-primary" onClick={submit}>+ Append event</button>
      </div>
      {showLoc && <NewLocationModal onClose={() => { setShowLoc(false); clearSS("newLoc"); }}
        onCreate={async (loc) => { await AssetStore.addCity(loc); set("to", loc.name); setShowLoc(false); clearSS("newLoc"); }} />}
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

function Timeline({ asset, onEditEvent, onChangeType, onDeleteEvent, onSave, onDiscard, dirty }) {
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
    // draft-only and recoverable via Discard until Save, so no confirm prompt
    if (openIdx === lastIdx) setOpenIdx(null);
    onDeleteEvent(lastIdx);
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
                      <label className="tl-city">Event type
                        <Picker className="select" options={EVENT_TYPES.map((t) => t.label)} value={(EVENT_TYPES.find((t) => t.id === tId) || {}).label || ""}
                          onChange={(label) => { const t = EVENT_TYPES.find((x) => x.label === label); if (t) { setMsg(null); onChangeType(idx, t.id); } }} />
                      </label>
                      <label>Date
                        <DateField className="input mono" value={e.date} onChange={(v) => tryEditDate(idx, v)} />
                      </label>
                      {fhas("to") && <label className="tl-city">{eDef.cat === "out" ? "Customer city" : "Location"}
                        <CityInput className="input tl-wide" value={e.to || ""} placeholder="Type city…"
                          onChange={(v) => onEditEvent(idx, { to: v })} />
                      </label>}
                      {fhas("dailyFee") && <label>Daily lease fee (USD) <MoneyInput className="input mono" value={e.dailyFee || 0}
                        onChange={(v) => onEditEvent(idx, { dailyFee: Number(v) || 0 })} /></label>}
                      {fhas("monthlyRevenue") && <label>Monthly revenue (USD) <MoneyInput className="input mono" value={e.monthlyRevenue || 0}
                        onChange={(v) => onEditEvent(idx, { monthlyRevenue: Number(v) || 0 })} /></label>}
                      {fhas("exchangeFee") && <label>Exchange fee (USD) <MoneyInput className="input mono" value={e.exchangeFee || 0}
                        onChange={(v) => onEditEvent(idx, { exchangeFee: Number(v) || 0 })} /></label>}
                      {fhas("recertFee") && <label>Recertification fee (USD) <MoneyInput className="input mono" value={e.recertFee || 0}
                        onChange={(v) => onEditEvent(idx, { recertFee: Number(v) || 0 })} /></label>}
                      {fhas("salePrice") && <label>Sale price (USD) <MoneyInput className="input mono" value={e.salePrice || 0}
                        onChange={(v) => onEditEvent(idx, { salePrice: Number(v) || 0 })} /></label>}
                      {fhas("contractYears") && <label>Contract years <input type="number" inputMode="numeric" className="input mono" defaultValue={e.contractYears || ""}
                        onBlur={(ev2) => onEditEvent(idx, { contractYears: ev2.target.value === "" ? null : Number(ev2.target.value) })} /></label>}
                      {fhas("customer") && <label className="tl-city">Customer
                        <SuggestInput className="input tl-wide" options={customerOptions()} showAll value={e.customer || ""}
                          onChange={(v) => onEditEvent(idx, { customer: v || null })} placeholder="Customer…" /></label>}
                      {fhas("pn") && <label>P/N received <input className="input mono" defaultValue={e.pn || ""}
                        onBlur={(ev2) => onEditEvent(idx, { pn: ev2.target.value || asset.partNumber })} /></label>}
                      {msg && msg.idx === idx && <div className={"tl-inline-msg " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}
                    </div>
                  );
                })()}
              </div>
              <div className="tl-actions">
                <button className="icon-btn" title="Edit event" onClick={() => { setMsg(null); setOpenIdx(openIdx === idx ? null : idx); }}>✎</button>
                {openIdx === idx && (
                  <React.Fragment>
                    <button className="icon-btn save" title="Save all changes" disabled={!dirty}
                      onClick={() => { if (dirty && onSave) { onSave(); setOpenIdx(null); } }}>💾</button>
                    <button className="icon-btn" title="Discard unsaved changes" disabled={!dirty}
                      onClick={() => { if (onDiscard) { onDiscard(); setOpenIdx(null); } }}>↩</button>
                  </React.Fragment>
                )}
                <button className="icon-btn del" title={ongoing ? "Remove event" : "Only the most recent event can be removed — remove later events first to avoid a gap in the asset's history"}
                  disabled={!ongoing}
                  onClick={() => { if (ongoing) onDeleteEvent(idx); }}>🗑</button>
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
  const adjustments = asset.depAdjustments || [];
  const setAdjustments = (next) => onChange({ ...asset, depAdjustments: next });
  const setAdj = (i, patch) => setAdjustments(adjustments.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // Short-term leases are leased IN from a lessor and shipped straight back out —
  // they sit off the balance sheet and are never depreciated, so the depreciation
  // controls are locked unless the ownership is changed to an owned/long-term type.
  const isSTL = asset.ownership === "Short-term lease";
  // the values the model actually uses, so generated/legacy assets show real numbers
  // instead of blanks. Explicit fields win; otherwise the computed defaults show.
  const eff = effectiveFinance(asset);
  return (
    <div className="section">
      <h3 className="section-title">Asset details <span className="hint">correct static information</span></h3>
      <div className="grid3">
        <Field label="A/C+Engine">
          <SuggestInput className="input" options={FILTER_OPTIONS.aircraft} showAll
            value={asset.aircraftType} onChange={(v) => set("aircraftType", v)} placeholder="Select or type new…" />
        </Field>
        <Field label="Component"><Picker className="select" options={FILTER_OPTIONS.nacelle} value={asset.nacelle} onChange={(v) => set("nacelle", v)} /></Field>
        <Field label="Ownership"><Picker className="select" options={OWN_TYPES} value={asset.ownership || "Owned"} onChange={(v) => set("ownership", v)} /></Field>
        <Field label="CLP (USD)" hint={asset.clp == null && eff.clp ? `auto from type: ${fmtMoney(eff.clp)}` : "catalogue list price"}><MoneyInput className="input mono" value={asset.clp != null ? asset.clp : ""} placeholder={eff.clp ? eff.clp.toLocaleString("en-US") : "auto from type"} onChange={(v) => set("clp", v === "" ? null : Number(v))} /></Field>
        <Field label="Initial part number"><input className="input mono" value={asset.initialPartNumber || ""} onChange={(e) => set("initialPartNumber", e.target.value)} /></Field>
        {!isSTL && <Field label="Acquisition value (USD)" hint="NBV & depreciation are based on this"><MoneyInput className="input mono" value={asset.acquisitionValue != null ? asset.acquisitionValue : Math.round(eff.acqValue)} onChange={(v) => set("acquisitionValue", v === "" ? null : Number(v))} /></Field>}
        {!isSTL && <Field label="Depreciation method"><Picker className="select" options={["Straight-line", "Declining balance"]} value={asset.depMethod || eff.method} onChange={(v) => set("depMethod", v)} /></Field>}
        {!isSTL && <Field label="Depreciation years"><input type="number" inputMode="numeric" className="input mono" value={asset.depLife != null ? asset.depLife : eff.lifeYears} onChange={(e) => set("depLife", e.target.value === "" ? null : Number(e.target.value))} /></Field>}
        {!isSTL && <Field label="Residual (%)" hint="of acquisition value"><input type="number" inputMode="numeric" className="input mono" value={asset.depResidual != null ? Math.round(asset.depResidual * 100) : Math.round(eff.residual * 100)} onChange={(e) => set("depResidual", e.target.value === "" ? 0 : (Number(e.target.value) || 0) / 100)} /></Field>}
        {isSTL && <Field label="Daily lease-in cost (USD)" hint="what we pay the lessor / day — short-term lease only"><MoneyInput className="input mono" value={asset.dailyRate || ""} onChange={(v) => set("dailyRate", v === "" ? 0 : Number(v))} /></Field>}
        <Field label="Description" span><input className="input" value={asset.description || ""} onChange={(e) => set("description", e.target.value)} /></Field>
      </div>

      <div style={{ marginTop: 18 }}>
        {isSTL ? (
          <p className="field-hint" style={{ marginTop: 4 }}>This asset is a <b>short-term lease</b> — leased in from a lessor and not depreciated, so the depreciation scheme is locked. Change the <b>Ownership</b> above to an owned or long-term type to enable it.</p>
        ) : (
          <React.Fragment>
            <label className="checkbox-row">
              <input type="checkbox" checked={!!dep} onChange={(e) => onChange({ ...asset, depOverride: e.target.checked ? { life: 10, residual: 0, from: today() } : null })} />
              Override depreciation scheme from a date
            </label>
            {dep && (
              <div className="grid3" style={{ marginTop: 12 }}>
                <Field label="New life (years)"><input type="number" className="input mono" value={dep.life} onChange={(e) => setDep({ life: Number(e.target.value) || 0 })} /></Field>
                <Field label="Residual (%)" hint="of CLP-based value"><input type="number" className="input mono" value={Math.round((dep.residual || 0) * 100)} onChange={(e) => setDep({ residual: (Number(e.target.value) || 0) / 100 })} /></Field>
                <Field label="Effective from"><DateField className="input mono" value={dep.from} onChange={(v) => setDep({ from: v })} /></Field>
              </div>
            )}
            <p className="field-hint" style={{ marginTop: 8 }}>Depreciation before the effective date is kept; the new straight-line scheme applies after it. Net book value & analytics update automatically.</p>

            <div style={{ marginTop: 18 }}>
              <h3 className="section-title" style={{ fontSize: 12.5 }}>Impairments / write-downs
                <span className="hint">one-off depreciation in a specific month — e.g. fire or accident damage</span></h3>
              {adjustments.map((adj, i) => (
                <div className="adj-row" key={i}>
                  <input type="month" className="input mono" value={adj.month || ""} onChange={(e) => setAdj(i, { month: e.target.value })} />
                  <MoneyInput className="input mono" placeholder="amount written down (USD)" value={adj.amount} onChange={(v) => setAdj(i, { amount: v === "" ? "" : Number(v) })} />
                  <input className="input" placeholder="reason (e.g. fire damage)" value={adj.note || ""} onChange={(e) => setAdj(i, { note: e.target.value })} />
                  <button className="icon-btn del" title="Remove this write-down" onClick={() => setAdjustments(adjustments.filter((_, j) => j !== i))}>🗑</button>
                </div>
              ))}
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAdjustments([...adjustments, { month: today().slice(0, 7), amount: "", note: "" }])}>+ Add write-down</button>
              <p className="field-hint" style={{ marginTop: 6 }}>Each row books extra depreciation in that month — net book value drops by that amount from then on. See the month-by-month figures via “Monthly Excel” on the Analytics page.</p>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function NewLocationModal({ onClose, onCreate }) {
  const [a, setA] = usePersistent("newLoc", { name: "", country: "", lat: "", lon: "", type: "customer" });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setA((s) => ({ ...s, [k]: v }));
  const create = async () => {
    const e = {};
    if (!a.name.trim()) e.name = 1;
    if (a.name.trim() && AssetStore.cityMap()[a.name.trim()]) e.name = 1;   // already exists
    if (a.lat === "" || isNaN(Number(a.lat)) || Math.abs(Number(a.lat)) > 90) e.lat = 1;
    if (a.lon === "" || isNaN(Number(a.lon)) || Math.abs(Number(a.lon)) > 180) e.lon = 1;
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await onCreate({ name: a.name.trim(), country: a.country.trim(), lat: Number(a.lat), lon: Number(a.lon), type: a.type }); }
    catch (err) { setErrs({ form: err.message || "Could not save the location." }); setBusy(false); }
  };
  const cx = (k) => "input" + (errs[k] ? " err" : "");
  return (
    <div className="modal-back">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head"><h3>Add a new location</h3><button className="icon-btn" onClick={onClose} style={{ fontSize: 20 }}>×</button></div>
        <div className="modal-body">
          <p className="field-hint" style={{ marginBottom: 12 }}>Adds a location to the shared list so it can be used everywhere and shown on the map. Look up the coordinates by searching e.g. “Bratislava latitude longitude”.</p>
          <div className="grid2">
            <Field label="Location name" req span><input className={cx("name") + " mono"} value={a.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Bratislava" /></Field>
            <Field label="Country"><input className="input" value={a.country} onChange={(e) => set("country", e.target.value)} placeholder="e.g. Slovakia" /></Field>
            <Field label="Type"><Picker className="select" options={["customer", "hub"]} value={a.type} onChange={(v) => set("type", v)} /></Field>
            <Field label="Latitude" req hint="−90 to 90"><input type="number" inputMode="decimal" className={cx("lat") + " mono"} value={a.lat} onChange={(e) => set("lat", e.target.value)} placeholder="48.15" /></Field>
            <Field label="Longitude" req hint="−180 to 180"><input type="number" inputMode="decimal" className={cx("lon") + " mono"} value={a.lon} onChange={(e) => set("lon", e.target.value)} placeholder="17.11" /></Field>
          </div>
        </div>
        <div className="modal-foot">
          {(errs.name || errs.lat || errs.lon || errs.form) && <span className="form-err">{errs.form || "Check the fields — name must be new, latitude −90…90, longitude −180…180."}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>{busy ? "Saving…" : "Add location"}</button>
        </div>
      </div>
    </div>
  );
}

function NewAssetModal({ onClose, onCreate }) {
  const [a, setA] = usePersistent("newAsset", () => ({
    assetNumber: "", aircraftType: "", nacelle: "",
    initialPartNumber: "", ownership: "", clp: "", acquisitionValue: "", dailyRate: "",
    depMethod: "Straight-line", depLife: "25", depResidual: "0",
    description: "", inDate: today(), hub: "", status: "",
  }));
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
            <Field label="Asset number" req><input className={cx("assetNumber") + " mono"} value={a.assetNumber} onChange={(e) => set("assetNumber", e.target.value)} /></Field>
            <Field label="Ownership" req>
              <Picker className={sx("ownership")} options={OWN_TYPES} value={a.ownership} onChange={(v) => set("ownership", v)} />
            </Field>
            <Field label="A/C+Engine" req>
              <SuggestInput className={cx("aircraftType")} options={FILTER_OPTIONS.aircraft} showAll
                value={a.aircraftType} onChange={(v) => set("aircraftType", v)} placeholder="Select or type new…" />
            </Field>
            <Field label="Component" req>
              <Picker className={sx("nacelle")} options={FILTER_OPTIONS.nacelle} value={a.nacelle} onChange={(v) => set("nacelle", v)} />
            </Field>
            <Field label="Initial part number" req><input className={cx("initialPartNumber") + " mono"} value={a.initialPartNumber} onChange={(e) => set("initialPartNumber", e.target.value)} /></Field>
            <Field label="CLP (USD)" req hint="catalogue list price — guidance only"><MoneyInput className={cx("clp") + " mono"} value={a.clp} onChange={(v) => set("clp", v)} /></Field>
            {capitalised && (
              <Field label="Acquisition value (USD)" req hint="NBV & depreciation are based on this"><MoneyInput className={cx("acquisitionValue") + " mono"} value={a.acquisitionValue} onChange={(v) => set("acquisitionValue", v)} /></Field>
            )}
            {isSTL && (
              <Field label="Daily lease-in cost (USD)" req hint="what we pay the lessor / day"><MoneyInput className={cx("dailyRate") + " mono"} value={a.dailyRate} onChange={(v) => set("dailyRate", v)} /></Field>
            )}
            {capitalised && (
              <React.Fragment>
                <Field label="Depreciation method" req><Picker className="select" options={["Straight-line", "Declining balance"]} value={a.depMethod} onChange={(v) => set("depMethod", v)} /></Field>
                <Field label="Depreciation years" req><input type="number" inputMode="numeric" className={cx("depLife") + " mono"} value={a.depLife} onChange={(e) => set("depLife", e.target.value)} /></Field>
                <Field label="Residual (%)" hint="of acquisition value"><input type="number" inputMode="numeric" className="input mono" value={a.depResidual} onChange={(e) => set("depResidual", e.target.value)} /></Field>
              </React.Fragment>
            )}
            <Field label="Status" req>
              <Picker className={sx("status")} options={STATUSES} value={a.status} onChange={(v) => set("status", v)} />
            </Field>
            <Field label="Induction date" req><DateField className={cx("inDate") + " mono"} value={a.inDate} onChange={(v) => set("inDate", v)} /></Field>
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
  const dataVersion = useAssets();   // load from Supabase + re-render on changes
  const [dark, setDark] = useState(getDark);
  const [q, setQ] = useState("");
  const [selId, setSelId] = usePersistent("selId", null);
  const [draft, setDraft] = usePersistent("draft", null);
  const [dirty, setDirty] = usePersistent("dirty", false);
  const [toast, setToast] = useState(null);
  const [showNew, setShowNew] = usePersistent("showNew", false);
  const [tick, setTick] = useState(0);
  const [showArchived, setShowArchived] = usePersistent("archived", false);

  useEffect(() => { document.body.classList.toggle("theme-light", !dark); saveDark(dark); }, [dark]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const source = showArchived ? AssetStore.listArchived() : AssetStore.list();
    return source.filter((a) => !ql ||
      (a.assetNumber + " " + a.partNumber + " " + a.aircraftType + " " + a.nacelle + " " + (a.customer || "") + " " + (a.location || "")).toLowerCase().includes(ql));
  }, [q, tick, showArchived, dataVersion]);
  const archivedCount = useMemo(() => AssetStore.listArchived().length, [tick, dataVersion]);

  const selectAsset = (id) => {
    setSelId(id);
    const a = AssetStore.get(id);
    setDraft(a ? JSON.parse(JSON.stringify(a)) : null);
    setDirty(false);
  };

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1800); };
  const refresh = () => setTick((t) => t + 1);

  const updateDraft = (next) => { setDraft(next); setDirty(true); };

  // Appending recomputes immediately: the history re-sorts by date (so an event
  // dated earlier than the last one slots into place) and the current location
  // updates, so a second event chains from where the first one left the asset.
  const appendEvent = (e) => {
    const next = AssetStore.recompute({ ...draft, history: [...draft.history, e] });
    setDraft({ ...next }); setDirty(true);
  };
  const editEvent = (idx, patch) => {
    const hist = draft.history.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    const next = { ...draft, history: hist };
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
    setDraft(next); setDirty(true);
  };
  const deleteEvent = (idx) => {
    const next = { ...draft, history: draft.history.filter((_, i) => i !== idx) };
    setDraft(next); setDirty(true);
  };

  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    // catch any location (incl. inline-edited ones) the database won't recognise,
    // so we show a clear message instead of a raw foreign-key error
    const known = AssetStore.cityList();
    const badCity = (draft.history || [])
      .flatMap((h) => [h.to, h.from]).filter(Boolean).find((c) => !known.includes(c));
    if (badCity) { flash(`"${badCity}" isn't a known location — pick it from the list or add it as a new location.`); return; }
    setBusy(true);
    try { await AssetStore.save(draft); setDirty(false); selectAsset(draft.assetNumber); flash("Saved — changes flow to Register & Analytics"); }
    catch (err) { flash("Save failed: " + (err.message || "could not reach the database")); }
    finally { setBusy(false); }
  };
  const discard = () => { selectAsset(selId); flash("Unsaved changes discarded"); };
  const revert = () => {};
  const removeAsset = async () => {
    if (!confirm("Remove this asset from the register?")) return;
    if (busy) return; setBusy(true);
    const id = selId;
    try { await AssetStore.remove(id); setSelId(null); setDraft(null); flash("Asset removed"); }
    catch (err) { flash("Remove failed: " + (err.message || "could not reach the database")); }
    finally { setBusy(false); }
  };
  const createAsset = async (a) => {
    if (busy) return; setBusy(true);
    try { await AssetStore.save(a); setShowNew(false); clearSS("newAsset"); selectAsset(a.assetNumber); flash("Asset created"); }
    catch (err) { flash("Create failed: " + (err.message || "could not reach the database")); }
    finally { setBusy(false); }
  };

  return (
    <div className="app editor-page">
      <header className="app-header">
        <NavLink to="/" end className="brand" title="Go to Asset Register">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text"><span className="brand-name">ST Engineering Solutions</span><span className="brand-tag">Asset Editor</span></div>
        </NavLink>
        <TopNav />
        <div className="header-right">
          <button className="btn" onClick={() => setDark(!dark)}>{dark ? "Light" : "Dark"}</button>
          <UserMenu />
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
          <div className="aside-tabs">
            <button className={"aside-tab" + (!showArchived ? " on" : "")} onClick={() => { setShowArchived(false); }}>Active</button>
            <button className={"aside-tab" + (showArchived ? " on" : "")} onClick={() => { setShowArchived(true); }}>Historical{archivedCount ? ` (${archivedCount})` : ""}</button>
          </div>
          <div className="alist">
            {list.map((a) => (
              <div key={a.assetNumber} className={"aitem" + (selId === a.assetNumber ? " sel" : "")} onClick={() => selectAsset(a.assetNumber)}>
                <span className="aitem-dot" style={{ background: (STATUS_META[a.status] || {}).c }}></span>
                <div className="aitem-main">
                  <div className="aitem-id">{a.assetNumber}</div>
                  <div className="aitem-sub">{a.aircraftType} · {a.nacelle}</div>
                </div>
                {a.retired ? <span className="aitem-flag retired">{(a.status || "retired").toLowerCase()}</span>
                  : AssetStore.isAdded(a.assetNumber) ? <span className="aitem-flag new">new</span>
                  : AssetStore.isEdited(a.assetNumber) ? <span className="aitem-flag">edited</span> : null}
              </div>
            ))}
            {list.length === 0 && <div className="dim" style={{ padding: 16, fontSize: 13 }}>
              {assetsStatus() === "loading" ? "Loading assets…"
                : assetsStatus() === "error" ? "Couldn't reach the database — check your connection."
                : showArchived ? "No historical assets yet."
                : q ? "No matching assets." : "No assets yet — click + New to add the first one."}
            </div>}
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
                  <button className="btn btn-primary" disabled={!dirty || busy} onClick={save} style={!dirty || busy ? { opacity: .5 } : null}>{busy ? "Saving…" : "Save"}</button>
                  {dirty && <button className="btn" onClick={discard} title="Throw away unsaved changes">Discard changes</button>}
                  {AssetStore.isBase(selId) && AssetStore.isEdited(selId) && <button className="btn" onClick={revert}>Revert</button>}
                  <button className="btn btn-danger btn-sm" onClick={removeAsset}>Remove asset</button>
                </div>
              </div>

              {dirty && <div className="banner banner-warn"><span>●</span> Unsaved changes — click <b>Save</b> to persist them and update the Register & Analytics views.</div>}

              <EventLogger asset={draft} onAppend={appendEvent} />
              <Timeline asset={draft} onEditEvent={editEvent} onChangeType={changeEventType} onDeleteEvent={deleteEvent} onSave={save} onDiscard={discard} dirty={dirty} />
              <RawFields asset={draft} onChange={updateDraft} />
            </div>
          )}
        </main>
      </div>

      {showNew && <NewAssetModal onClose={() => { setShowNew(false); clearSS("newAsset"); }} onCreate={createAsset} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
