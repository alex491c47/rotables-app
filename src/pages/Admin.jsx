import React, { useEffect, useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getDark, saveDark } from '../lib/theme';

const ROLES = ['viewer', 'editor', 'admin'];
const BrandMark = () => <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />;

export default function Admin() {
  const { isAdmin, user, signOut } = useAuth();
  const [dark, setDark] = useState(getDark);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { document.body.classList.toggle('theme-light', !dark); saveDark(dark); }, [dark]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('requested_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, fields) => {
    setBusyId(id);
    await supabase.from('profiles').update(fields).eq('id', id);
    await load();
    setBusyId(null);
  };

  if (!isAdmin) return (
    <div className="app"><div className="empty-state">This page is for administrators only.</div></div>
  );

  const pending = rows.filter((r) => !r.approved);
  const team = rows.filter((r) => r.approved);

  const Row = ({ r, isPending }) => (
    <tr>
      <td>{r.display_name || '—'}</td>
      <td className="dim">{r.email}</td>
      <td>
        <select className="select" value={r.role || 'viewer'} disabled={busyId === r.id}
          onChange={(e) => patch(r.id, { role: e.target.value })}>
          {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </td>
      <td className="num">
        {isPending
          ? <button className="btn btn-primary btn-sm" disabled={busyId === r.id} onClick={() => patch(r.id, { approved: true })}>Approve</button>
          : <button className="btn btn-sm" disabled={busyId === r.id || r.id === user.id} title={r.id === user.id ? "You can't revoke yourself" : ''} onClick={() => patch(r.id, { approved: false })}>Revoke</button>}
      </td>
    </tr>
  );

  return (
    <div className="app">
      <header className="app-header">
        <NavLink to="/" end className="brand" title="Go to Asset Register">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text"><span className="brand-name">ST Engineering Solutions</span><span className="brand-tag">User Administration</span></div>
        </NavLink>
        <nav className="topnav">
          <NavLink to="/" end>Asset Register</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/editor">Editor</NavLink>
          <NavLink to="/admin">Users</NavLink>
        </nav>
        <div className="header-right">
          <span className="user-chip">{user.email}</span>
          <button className="btn" onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'}</button>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="content" style={{ padding: 24, overflow: 'auto' }}>
        <section className="card">
          <div className="card-head"><h3>Pending requests</h3><span className="card-sub">{pending.length} waiting</span></div>
          <div className="card-body">
            {loading ? <div className="dim">Loading…</div> : pending.length === 0 ? <div className="dim">No requests waiting.</div> : (
              <table className="atable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Action</th></tr></thead>
                <tbody>{pending.map((r) => <Row key={r.id} r={r} isPending />)}</tbody></table>
            )}
          </div>
        </section>
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head"><h3>Team</h3><span className="card-sub">{team.length} approved</span></div>
          <div className="card-body">
            {loading ? <div className="dim">Loading…</div> : (
              <table className="atable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="num">Action</th></tr></thead>
                <tbody>{team.map((r) => <Row key={r.id} r={r} />)}</tbody></table>
            )}
          </div>
        </section>
        <p className="assumptions">Roles — <b>viewer</b>: can see everything, can't change anything · <b>editor</b>: can add &amp; edit assets · <b>admin</b>: editor plus managing users here.</p>
      </main>
    </div>
  );
}
