import React from 'react';

// Clear download glyph (arrow into a tray) for export buttons.
export default function DownloadIcon({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ verticalAlign: '-3px', marginRight: 6 }} aria-hidden="true">
      <path d="M12 3v11M7.5 9.5 12 14l4.5-4.5M5 20h14" />
    </svg>
  );
}
