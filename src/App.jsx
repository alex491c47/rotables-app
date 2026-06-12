import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Analytics from './pages/Analytics'
import Customers from './pages/Customers'
import Editor from './pages/Editor'
import Admin from './pages/Admin'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import { useAuth } from './lib/auth'
import { SpinnerLogo } from './components/Spinner'

const BrandMark = () => <img src="/logo.png" alt="ST Engineering" className="brand-mark-img" />

function Splash({ text }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <SpinnerLogo size={44} />
        <div className="dim" style={{ marginTop: 14 }}>{text || 'Loading…'}</div>
      </div>
    </div>
  )
}

function Pending() {
  const { user, profile, signOut, refreshProfile } = useAuth()
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center', alignItems: 'center' }}>
        <div className="brand-mark" style={{ width: 44, height: 44 }}><BrandMark /></div>
        <h2 className="auth-title" style={{ marginTop: 14 }}>Awaiting approval</h2>
        <p className="auth-note">
          Thanks{profile && profile.display_name ? `, ${profile.display_name}` : ''} — your request for access
          ({user && user.email}) has been received. An administrator needs to approve your account before you
          can see any data. You'll have access as soon as they do.
        </p>
        <button className="btn btn-primary auth-submit" onClick={refreshProfile}>Check again</button>
        <button type="button" className="auth-toggle" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}

export default function App() {
  const { loading, session, approved, recovery, canEdit, isAdmin } = useAuth()
  if (recovery) return <ResetPassword />
  if (loading) return <Splash />
  if (!session) return <Login />
  if (!approved) return <Pending />
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/editor" element={canEdit ? <Editor /> : <Navigate to="/" replace />} />
      <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
