import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// Top navigation, role-aware: everyone sees the Register & Analytics; only
// editors/admins see the Editor; only admins see the Users page.
export default function TopNav() {
  const { canEdit, isAdmin } = useAuth();
  return (
    <nav className="topnav">
      <NavLink to="/" end>Asset Register</NavLink>
      <NavLink to="/analytics">Analytics</NavLink>
      <NavLink to="/customers">Customers</NavLink>
      {canEdit && <NavLink to="/editor">Editor</NavLink>}
      {isAdmin && <NavLink to="/admin">Users</NavLink>}
    </nav>
  );
}
