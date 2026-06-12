import * as XLSX from 'xlsx';

// Build a real Excel (.xlsx) workbook from a header row + rows and download it.
// Numbers stay numbers (so Excel can sum/sort them).
export function downloadXlsx(filename, header, rows, sheetName) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31));
  XLSX.writeFile(wb, filename);
}

// Build a multi-sheet workbook. sheets = [{ name, header, rows }].
export function downloadXlsxSheets(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

// Build a CSV file and trigger a download. Used for the Register export and the
// per-asset monthly breakdown. The leading BOM makes Excel open UTF-8 correctly.
function esc(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function downloadCsv(filename, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
