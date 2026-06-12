// Authentication state — tracks the signed-in user and their profile (role +
// whether an admin has approved them). Everything in the app is gated on this.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

// Force everyone to sign in again at least once a day: we stamp the login time
// (per user, in localStorage so it survives reloads) and sign out once 24h pass.
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const LOGIN_KEY = 'ste-login-at';
function clearLoginStamp() { try { localStorage.removeItem(LOGIN_KEY); } catch (e) {} }
function loginStampFor(uid) {
  try {
    const raw = localStorage.getItem(LOGIN_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (p && p.uid === uid && p.at) return p.at;
  } catch (e) {}
  const at = Date.now();
  try { localStorage.setItem(LOGIN_KEY, JSON.stringify({ uid, at })); } catch (e) {}
  return at;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [profile, setProfile] = useState(undefined);
  const [recovery, setRecovery] = useState(false);     // arrived via a password-reset link

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') clearLoginStamp();
      setSession(s || null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Auto sign-out 24h after login (checked on load and every minute thereafter).
  useEffect(() => {
    if (!session) return;
    const at = loginStampFor(session.user.id);
    const check = () => { if (Date.now() - at >= SESSION_MAX_MS) { clearLoginStamp(); supabase.auth.signOut(); } };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, [session]);

  const loadProfile = useCallback(async (uid) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setProfile(data || null);   // null = no profile row yet (treated as pending)
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setProfile(null); return; }
    setProfile(undefined);
    loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = {
    session,
    user: session ? session.user : null,
    profile,
    loading: session === undefined || (!!session && profile === undefined),
    approved: !!(profile && profile.approved),
    role: profile ? profile.role : null,
    canEdit: !!(profile && profile.approved && (profile.role === 'editor' || profile.role === 'admin')),
    isAdmin: !!(profile && profile.approved && profile.role === 'admin'),
    recovery,
    clearRecovery: () => setRecovery(false),
    refreshProfile: () => { if (session) loadProfile(session.user.id); },
    signOut: () => { clearLoginStamp(); return supabase.auth.signOut(); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
