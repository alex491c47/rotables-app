// Authentication state — tracks the signed-in user and their profile (role +
// whether an admin has approved them). Everything in the app is gated on this.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [profile, setProfile] = useState(undefined);
  const [recovery, setRecovery] = useState(false);     // arrived via a password-reset link

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s || null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

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
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
