import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Compact signed-in-user controls for the page headers: an admin link (admins
// only), the user's email, and Sign out.
export default function UserMenu() {
  const { user, isAdmin, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="user-menu">
      {isAdmin && <NavLink to="/admin" className="user-admin-link" title="Manage users">Users</NavLink>}
      <span className="user-chip" title={user.email}>{user.email}</span>
      <button className="btn btn-sm" onClick={signOut}>Sign out</button>
    </div>
  );
}
