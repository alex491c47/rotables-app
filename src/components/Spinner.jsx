import React from 'react';

// The ST Engineering logo, spinning — used for any wait: page/data loading,
// saving an asset, etc. Reuses the .brand-mark styling so the light-mode logo
// treatment carries over.
export function SpinnerLogo({ size = 40 }) {
  return (
    <span className="brand-mark logo-spin" style={{ width: size, height: size }}>
      <img src="/logo.png" alt="" />
    </span>
  );
}

// Full-screen translucent overlay with the spinning logo and an optional label.
export function BusyOverlay({ show, label }) {
  if (!show) return null;
  return (
    <div className="busy-overlay">
      <div className="busy-card">
        <SpinnerLogo size={52} />
        {label && <div className="busy-label">{label}</div>}
      </div>
    </div>
  );
}
