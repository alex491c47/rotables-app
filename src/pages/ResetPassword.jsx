import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const BrandMark = () => <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />;

export default function ResetPassword() {
  const { clearRecovery, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setMsg({ ok: false, text: 'The two passwords don’t match.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      clearRecovery();   // password set — fall through to the normal app
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not set the new password — the link may have expired.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark"><BrandMark /></div>
          <div className="brand-text">
            <span className="brand-name">ST Engineering Solutions</span>
            <span className="brand-tag">Nacelle Asset Operations</span>
          </div>
        </div>
        <h2 className="auth-title">Set a new password</h2>
        <p className="auth-note">Choose a new password for your account.</p>
        <label className="auth-field">New password
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        <label className="auth-field">Confirm password
          <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
        </label>
        {msg && <div className={'auth-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
        <button className="btn btn-primary auth-submit" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save new password'}</button>
        <button type="button" className="auth-toggle" onClick={() => { clearRecovery(); signOut(); }}>Cancel</button>
      </form>
    </div>
  );
}
