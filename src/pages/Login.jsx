import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const BrandMark = () => <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />;

export default function Login() {
  const [mode, setMode] = useState('signin');   // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);          // { ok, text }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setMsg({ ok: true, text: 'If that email has an account, a password-reset link is on its way. Check your inbox (and spam).' });
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() } },
        });
        if (error) throw error;
        setMsg({ ok: true, text: 'Access requested. If you are not taken in automatically, switch to Sign in.' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Something went wrong — please try again.' });
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Reset password' : 'Request access';
  const cta = busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Request access';

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
        <h2 className="auth-title">{title}</h2>
        <p className="auth-note">
          {mode === 'signin' ? 'Sign in with your ST Engineering account.'
            : mode === 'forgot' ? 'Enter your email and we’ll send a link to set a new password.'
            : 'Request an account — an administrator will review and approve it before you can see any data.'}
        </p>
        {mode === 'signup' && (
          <label className="auth-field">Full name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label className="auth-field">Work email
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {mode !== 'forgot' && (
          <label className="auth-field">Password
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
        )}
        {msg && <div className={'auth-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
        <button className="btn btn-primary auth-submit" disabled={busy} type="submit">{cta}</button>
        {mode === 'signin' && (
          <button type="button" className="auth-toggle" onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button>
        )}
        <button type="button" className="auth-toggle" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null); }}>
          {mode === 'signin' ? 'Need access? Request an account' : mode === 'forgot' ? 'Back to sign in' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
