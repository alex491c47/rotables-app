import React from 'react';

// In-app confirmation dialog (replaces the browser's native confirm popup) —
// matches the app's modal styling.
export function ConfirmModal({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, busy, onConfirm, onCancel }) {
  return (
    <div className="modal-back">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onCancel} style={{ fontSize: 20 }}>×</button></div>
        <div className="modal-body"><p style={{ margin: 0, fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>{message}</p></div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
