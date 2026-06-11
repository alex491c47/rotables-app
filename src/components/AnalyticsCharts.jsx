import React, { useState, useRef, useEffect } from 'react';

function useWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback || 600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => { const cw = es[0].contentRect.width; if (cw > 0) setW(cw); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function useTweenValues(targets, dur) {
  const d = dur || 500;
  const [vals, setVals] = useState(targets);
  const ref = useRef({ raf: 0, to: 0, from: targets });
  const key = targets.join(",");
  useEffect(() => {
    const from = ref.current.from;
    const start = performance.now();
    cancelAnimationFrame(ref.current.raf);
    clearTimeout(ref.current.to);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / d);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = targets.map((tg, i) => { const f = (from[i] != null ? from[i] : tg); return f + (tg - f) * e; });
      setVals(cur); ref.current.from = cur;
      if (t < 1) ref.current.raf = requestAnimationFrame(tick);
      else ref.current.from = targets;
    };
    ref.current.raf = requestAnimationFrame(tick);
    ref.current.to = setTimeout(() => { setVals(targets); ref.current.from = targets; }, d + 80);
    return () => { cancelAnimationFrame(ref.current.raf); clearTimeout(ref.current.to); };
  }, [key]);
  return vals;
}

export const fmtUSD = (n) => {
  const s = n < 0 ? "-" : "";
  n = Math.abs(n);
  if (n >= 1e9) return s + "$" + (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (n >= 1e6) return s + "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return s + "$" + Math.round(n / 1e3) + "K";
  return s + "$" + Math.round(n);
};
export const fmtBarM = (n) => "$" + (n / 1e6).toFixed(1) + "M";
export const fmtPct = (f) => (f * 100).toFixed(f >= 0.0995 ? 0 : 1) + "%";
export const fmtPct1 = (f) => (f * 100).toFixed(1) + "%";

export function BarChart({ data, height = 220, fmt = fmtUSD, accent, highlightIdx, onHover }) {
  const acc = accent || "var(--accent)";
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth(640);
  const padTop = 26, padBottom = 26, padLeft = 48, plotH = height - padTop - padBottom;
  const n = data.length;
  const plotW = Math.max(1, W - padLeft);
  const slot = plotW / n;
  const barW = Math.min(34, slot * 0.56);
  const cx = (i) => padLeft + i * slot + slot / 2;
  return (
    <div className="chart-bars" ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}
        style={{ display: "block", overflow: "visible" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={padLeft} x2={W} y1={padTop + plotH * (1 - g)} y2={padTop + plotH * (1 - g)}
              stroke={g === 0 ? "var(--border2)" : "var(--border)"} strokeWidth="1" />
            <text x={padLeft - 8} y={padTop + plotH * (1 - g) + 3.5} textAnchor="end"
              fontSize="9.5" fill="var(--dim)" fontFamily="'IBM Plex Sans',sans-serif">{fmt(max * g)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const y = padTop + plotH - h;
          const active = hover === i || highlightIdx === i;
          return (
            <g key={i}
              onMouseEnter={() => { setHover(i); onHover && onHover(i); }}
              onMouseLeave={() => { setHover(null); onHover && onHover(null); }}>
              <rect x={padLeft + i * slot} y={padTop} width={slot} height={plotH} fill="transparent" />
              <rect x={cx(i) - barW / 2} y={y} width={barW} height={Math.max(0, h)} rx="3"
                fill={acc} opacity={active ? 1 : 0.85}
                style={{ transition: "y .5s cubic-bezier(.22,1,.36,1), height .5s cubic-bezier(.22,1,.36,1)" }} />
              {h > 5 && (
                <text x={cx(i)} y={y - 7} textAnchor="middle"
                  fontSize="10" fill="var(--text)"
                  fontFamily="'IBM Plex Mono',monospace">{fmtBarM(d.value)}</text>
              )}
              <text x={cx(i)} y={height - 9} textAnchor="middle"
                fontSize="10.5" fill="var(--dim)" fontFamily="'IBM Plex Sans',sans-serif">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(padLeft + (hover + 0.5) * slot) / W * 100}%` }}>
          <strong>{data[hover].label}</strong>
          <span>{fmt(data[hover].value)}</span>
          {data[hover].sublabel && <em>{data[hover].sublabel}</em>}
        </div>
      )}
    </div>
  );
}

export function LineChart({ data, height = 220, color }) {
  const c = color || "var(--lease)";
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth(640);
  const tv = useTweenValues(data.map((d) => d.value));
  const padTop = 26, padBottom = 26, padL = 44, padR = 18;
  const plotW = W - padL - padR, plotH = height - padTop - padBottom;
  const n = data.length;
  const v = (i) => (tv[i] != null ? tv[i] : data[i].value);
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (val) => padTop + plotH * (1 - val);
  const pts = data.map((d, i) => `${xAt(i)},${yAt(v(i))}`).join(" ");
  const area = `${padL},${padTop + plotH} ${pts} ${padL + plotW},${padTop + plotH}`;
  return (
    <div className="chart-line" ref={ref} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height}
        style={{ display: "block", overflow: "visible" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={padL} x2={padL + plotW} y1={yAt(g)} y2={yAt(g)}
              stroke={g === 0 ? "var(--border2)" : "var(--border)"} strokeWidth="1" />
            <text x={padL - 8} y={yAt(g) + 3.5} textAnchor="end"
              fontSize="9.5" fill="var(--dim)" fontFamily="'IBM Plex Sans',sans-serif">{Math.round(g * 100)}%</text>
          </g>
        ))}
        <polygon points={area} fill={c} opacity="0.12" />
        <polyline points={pts} fill="none" stroke={c} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={xAt(i) - plotW / (2 * n)} y={padTop} width={plotW / n} height={plotH} fill="transparent" />
            <circle cx={xAt(i)} cy={yAt(v(i))} r={hover === i ? 4.5 : 3} fill={c} />
            <text x={xAt(i)} y={yAt(v(i)) - 9} textAnchor="middle"
              fontSize="10" fill="var(--text)"
              fontFamily="'IBM Plex Sans',sans-serif">{fmtPct1(v(i))}</text>
            <text x={xAt(i)} y={height - 9} textAnchor="middle" fontSize="10.5" fill="var(--dim)"
              fontFamily="'IBM Plex Sans',sans-serif">{d.label}</text>
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${xAt(hover) / W * 100}%` }}>
          <strong>{data[hover].label}</strong><span>{fmtPct1(data[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

export function StackBar({ rows, height = 26 }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  return (
    <div className="stackbar">
      {rows.map((r, i) => {
        const total = r.parts.reduce((s, p) => s + p.value, 0);
        return (
          <div className="stackbar-row" key={i}>
            <div className="stackbar-label">{r.label}</div>
            <div className="stackbar-track" style={{ height }}>
              {r.parts.map((p, j) => {
                const w = (p.value / max) * 100;
                return (
                  <div key={j} className="stackbar-seg" title={`${p.name}: ${fmtUSD(p.value)}`}
                    style={{ width: w + "%", background: p.color }}></div>
                );
              })}
            </div>
            <div className="stackbar-total">{fmtUSD(total)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ data, size = 150, thickness = 26, centerLabel, centerValue }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const [hover, setHover] = useState(null);
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * circ;
          const seg = (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={d.color}
              strokeWidth={thickness}
              opacity={hover === null || hover === i ? 1 : 0.38}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-acc * circ}
              transform={`rotate(-90 ${c} ${c})`}
              style={{ transition: "opacity .15s, stroke-dasharray .5s cubic-bezier(.22,1,.36,1), stroke-dashoffset .5s cubic-bezier(.22,1,.36,1)" }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
          acc += frac;
          return seg;
        })}
        <text x={c} y={c - 4} textAnchor="middle" fontSize="22" fontWeight="700"
          fill="var(--text)" fontFamily="'IBM Plex Mono',monospace">
          {hover != null ? data[hover].value : centerValue}
        </text>
        <text x={c} y={c + 15} textAnchor="middle" fontSize="10" fill="var(--dim)"
          style={{ textTransform: "uppercase", letterSpacing: "1px" }}>
          {hover != null ? data[hover].name : centerLabel}
        </text>
      </svg>
    </div>
  );
}
