/* ============================================================
   AssetGlobe — stylized dotted Earth on a 2D canvas.
   Uses d3-geo + topojson-client npm packages instead of CDN globals.
   ============================================================ */
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const DEG = Math.PI / 180;
const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";

function llToVec(lat, lon) {
  const phi = lat * DEG, th = lon * DEG;
  return [Math.cos(phi) * Math.sin(th), Math.sin(phi), Math.cos(phi) * Math.cos(th)];
}
function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = Math.max(-1, Math.min(1, dot));
  const om = Math.acos(dot);
  if (om < 1e-4) return a.slice();
  const so = Math.sin(om);
  const s0 = Math.sin((1 - t) * om) / so, s1 = Math.sin(t * om) / so;
  return [a[0] * s0 + b[0] * s1, a[1] * s0 + b[1] * s1, a[2] * s0 + b[2] * s1];
}

export class AssetGlobe {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dots = [];
    this.markers = [];
    this.aggregates = [];
    this._aggLabels = new Set();
    this.focusMarkers = [];
    this.legs = [];
    this.rot = 0;
    this.targetRot = null;
    this.tilt = 20 * DEG;
    this.targetTilt = null;
    this.dragging = false;
    this._last = null;
    this.zoom = 1;
    this._pointers = new Map();
    this.onBubbleClick = null;
    this.onBackgroundClick = null;
    this.speed = 1;
    this.baseSpeed = 0.0016;
    this.theme = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.t0 = performance.now();
    this.arcProgress = 0;
    this._loop = this._loop.bind(this);
    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvas);
    }
    this._resize();
    this._buildFallbackDots();
    this._loadAtlas();
    this._bindDrag();
    requestAnimationFrame(() => this._resize());
    requestAnimationFrame(this._loop);
  }

  _bindDrag() {
    const c = this.canvas;
    c.style.cursor = "grab";
    c.style.touchAction = "none";
    const pts = this._pointers;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let downPos = null, moved = 0, pinchStart = null;

    const rectPt = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY };
    };

    const down = (e) => {
      if (c.setPointerCapture && e.pointerId != null) { try { c.setPointerCapture(e.pointerId); } catch (_) {} }
      const p = rectPt(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        this.dragging = true;
        this._last = { x: p.cx, y: p.cy };
        this.targetRot = null; this.targetTilt = null;
        downPos = { x: p.x, y: p.y }; moved = 0;
        c.style.cursor = "grabbing";
      } else if (pts.size === 2) {
        this.dragging = false;
        const a = [...pts.values()];
        pinchStart = { dist: Math.hypot(a[0].cx - a[1].cx, a[0].cy - a[1].cy), zoom: this.zoom };
      }
      e.preventDefault();
    };

    const move = (e) => {
      if (!pts.has(e.pointerId)) {
        if (pts.size === 0) {
          const p = rectPt(e);
          c.style.cursor = this._hitCity(p.x, p.y) ? "pointer" : "grab";
        }
        return;
      }
      const p = rectPt(e);
      pts.set(e.pointerId, p);
      if (pts.size >= 2 && pinchStart) {
        const a = [...pts.values()];
        const dist = Math.hypot(a[0].cx - a[1].cx, a[0].cy - a[1].cy);
        this.zoom = clamp(pinchStart.zoom * (dist / pinchStart.dist), 1, 3.4);
      } else if (this.dragging) {
        const dx = p.cx - this._last.x, dy = p.cy - this._last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.rot += dx * 0.006;
        this.tilt = clamp(this.tilt + dy * 0.006, -55 * DEG, 72 * DEG);
        this._last = { x: p.cx, y: p.cy };
      }
      e.preventDefault();
    };

    const up = (e) => {
      const had = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchStart = null;
      if (this.dragging && pts.size === 0) {
        this.dragging = false;
        c.style.cursor = "grab";
        if (had && moved < 6 && downPos) {
          const city = this._hitCity(downPos.x, downPos.y);
          if (city) { if (this.onBubbleClick) this.onBubbleClick(city); }
          else if (this.onBackgroundClick) this.onBackgroundClick();
        }
      }
      this._last = null;
    };

    const wheel = (e) => {
      e.preventDefault();
      this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0012), 1, 3.4);
    };

    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
  }

  _hitCity(x, y) {
    if (this.focusMarkers.length || !this.aggregates.length) return null;
    const maxCount = this.aggregates.reduce((m, a) => Math.max(m, a.count), 1);
    let best = null, bestD = Infinity;
    for (const a of this.aggregates) {
      const p = this._rotPoint(a.v);
      if (p[2] <= 0.02) continue;
      const sp = this._project(p);
      const r = 6 + 11 * Math.sqrt(a.count / maxCount);
      const d = Math.hypot(sp[0] - x, sp[1] - y);
      if (d <= r + 5 && d < bestD) { bestD = d; best = a.label; }
    }
    return best;
  }

  spinTo(lat, lon) {
    this.targetRot = -lon * DEG;
    this.targetTilt = Math.max(-45 * DEG, Math.min(60 * DEG, lat * DEG));
  }

  setTheme(t) { this.theme = t; }
  setSpeed(m) { this.speed = m; }

  setAllCityMarkers(list) {
    this.markers = list.map((m) => ({ ...m, v: llToVec(m.lat, m.lon) }));
  }

  setAggregates(list) {
    this.aggregates = (list || []).map((m) => ({ ...m, v: llToVec(m.lat, m.lon) }));
    this._aggLabels = new Set(this.aggregates.map((m) => m.label));
  }

  focus(spec) {
    this.focusMarkers = (spec.markers || []).map((m) => ({ ...m, v: llToVec(m.lat, m.lon) }));
    this.legs = (spec.legs || []).map((l) => ({
      a: llToVec(l.from.lat, l.from.lon),
      b: llToVec(l.to.lat, l.to.lon),
      reason: l.reason,
    }));
    this.arcProgress = 0;
    const target = spec.markers && spec.markers.length
      ? spec.markers[spec.markers.length - 1] : null;
    if (target) {
      this.targetRot = -target.lon * DEG;
      this.targetTilt = Math.max(-45 * DEG, Math.min(60 * DEG, target.lat * DEG));
    }
  }

  clearFocus() {
    this.focusMarkers = []; this.legs = []; this.targetRot = null;
    this.targetTilt = 20 * DEG;
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.baseRadius = Math.min(this.w, this.h) * 0.42;
    this.radius = this.baseRadius * (this.zoom || 1);
  }

  _buildFallbackDots() {
    const N = 1600, pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = ga * i;
      pts.push({ v: [Math.cos(th) * r, y, Math.sin(th) * r], fallback: true });
    }
    this.dots = pts;
  }

  async _loadAtlas() {
    try {
      const world = await fetch(TOPO_URL).then((r) => r.json());
      const land = feature(world, world.objects.land);
      const W = 1024, H = 512;
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const octx = off.getContext("2d");
      const proj = geoEquirectangular()
        .scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
      const path = geoPath(proj, octx);
      octx.fillStyle = "#fff";
      octx.beginPath(); path(land); octx.fill();
      const img = octx.getImageData(0, 0, W, H).data;
      const isLand = (lat, lon) => {
        const px = Math.floor(((lon + 180) / 360) * W);
        const py = Math.floor(((90 - lat) / 180) * H);
        if (px < 0 || px >= W || py < 0 || py >= H) return false;
        return img[(py * W + px) * 4 + 3] > 80;
      };
      const dots = [];
      const step = 2.2;
      for (let lat = -82; lat <= 82; lat += step) {
        const circ = Math.cos(lat * DEG);
        const lonStep = step / Math.max(circ, 0.18);
        for (let lon = -180; lon < 180; lon += lonStep) {
          if (isLand(lat, lon)) dots.push({ v: llToVec(lat, lon) });
        }
      }
      if (dots.length > 400) this.dots = dots;
    } catch (e) {
      console.warn("[globe] atlas load failed, using fallback dots:", e.message);
    }
  }

  _rotPoint(v) {
    const cr = Math.cos(this.rot), sr = Math.sin(this.rot);
    let x = v[0] * cr + v[2] * sr;
    let z = -v[0] * sr + v[2] * cr;
    let y = v[1];
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    const y2 = y * ct - z * st;
    const z2 = y * st + z * ct;
    return [x, y2, z2];
  }

  _project(p) {
    return [this.cx + p[0] * this.radius, this.cy - p[1] * this.radius];
  }

  _loop(now) {
    const T = this.theme || {};
    const ctx = this.ctx;
    this.radius = this.baseRadius * this.zoom;
    if (this.targetTilt !== null) {
      const dt = this.targetTilt - this.tilt;
      if (Math.abs(dt) < 0.002) { this.tilt = this.targetTilt; this.targetTilt = null; }
      else this.tilt += dt * 0.07;
    }
    if (this.targetRot !== null) {
      let d = this.targetRot - this.rot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 0.004) { this.rot = this.targetRot; this.targetRot = null; }
      else this.rot += d * 0.06;
    } else {
      this.rot += this.baseSpeed * this.speed;
    }
    if (this.arcProgress < 1) this.arcProgress = Math.min(1, this.arcProgress + 0.012);

    ctx.clearRect(0, 0, this.w, this.h);

    const ar = this.radius * 1.16;
    const ag = ctx.createRadialGradient(this.cx, this.cy, this.radius * 0.7, this.cx, this.cy, ar);
    ag.addColorStop(0, "rgba(0,0,0,0)");
    ag.addColorStop(0.72, (T.glow || "rgba(56,189,248,0.0)"));
    ag.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, ar, 0, Math.PI * 2); ctx.fill();

    const sg = ctx.createRadialGradient(
      this.cx - this.radius * 0.3, this.cy - this.radius * 0.35, this.radius * 0.1,
      this.cx, this.cy, this.radius);
    sg.addColorStop(0, T.sphereHi || "#10243b");
    sg.addColorStop(1, T.sphereLo || "#060d18");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, this.radius, 0, Math.PI * 2); ctx.fill();

    const dotColor = T.dot || "120,190,255";
    const dotBack = T.dotBack || "120,190,255";
    const ds = this.dots.length > 1200 ? 1.5 : 2.2;
    for (let i = 0; i < this.dots.length; i++) {
      const p = this._rotPoint(this.dots[i].v);
      const sp = this._project(p);
      if (p[2] > 0.02) {
        const a = 0.25 + p[2] * 0.6;
        ctx.fillStyle = `rgba(${dotColor},${a.toFixed(3)})`;
        ctx.fillRect(sp[0] - ds / 2, sp[1] - ds / 2, ds, ds);
      } else if (p[2] > -0.55) {
        const a = 0.06 * (1 + p[2]);
        ctx.fillStyle = `rgba(${dotBack},${a.toFixed(3)})`;
        ctx.fillRect(sp[0] - 0.7, sp[1] - 0.7, 1.4, 1.4);
      }
    }

    const tnow = (now - this.t0) / 1000;
    const showingAgg = !this.focusMarkers.length && this.aggregates.length > 0;
    // Inactive cities (hubs + anywhere the fleet has ever been, but with no asset
    // there right now) render as a soft BLURRED dot that melts into the globe — so a
    // long history of visited locations stays as quiet texture, not a field of loud
    // markers. Only currently-active cities get the bright aggregate bubbles below.
    const cityCol = T.cityDim || "150,180,210";
    for (const m of this.markers) {
      if (showingAgg && this._aggLabels.has(m.label)) continue;
      const p = this._rotPoint(m.v);
      if (p[2] <= 0.04) continue;
      const sp = this._project(p);
      const a = 0.16 + p[2] * 0.18;
      const rr = 2.4;
      const rg = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], rr);
      rg.addColorStop(0, `rgba(${cityCol},${a.toFixed(3)})`);
      rg.addColorStop(1, `rgba(${cityCol},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], rr, 0, Math.PI * 2); ctx.fill();
    }

    if (showingAgg) this._drawAggregates(ctx, T, tnow);
    if (this.legs.length) this._drawArcs(ctx, T);
    if (this.focusMarkers.length) this._drawFocusMarkers(ctx, T, tnow);

    requestAnimationFrame(this._loop);
  }

  _aggColor(T, status) {
    if (status === "Out on lease") return T.markerLease || "56,189,248";
    if (status === "Ready to ship") return T.markerReady || "52,211,153";
    return T.markerWip || "250,204,21";
  }

  _drawAggregates(ctx, T, tnow) {
    const maxCount = this.aggregates.reduce((m, a) => Math.max(m, a.count), 1);
    const pulse = 0.5 + 0.5 * Math.sin(tnow * 2.0);
    const items = this.aggregates
      .map((a) => ({ a, p: this._rotPoint(a.v), sp: null, r: 0, col: "", front: false }))
      .sort((x, y) => x.p[2] - y.p[2]);

    for (const it of items) {
      it.sp = this._project(it.p);
      it.front = it.p[2] > 0.02;
      it.r = 6 + 11 * Math.sqrt(it.a.count / maxCount);
      it.col = this._aggColor(T, it.a.status);
      const { sp, r, col, front, a } = it;

      if (!front) {
        const a2 = 0.09 * (1 + it.p[2]);
        ctx.fillStyle = `rgba(${col},${Math.max(0, a2).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sp[0], sp[1], r * 0.55, 0, Math.PI * 2); ctx.fill();
        continue;
      }

      const hr = r + 6 + pulse * 2.5;
      const rg = ctx.createRadialGradient(sp[0], sp[1], r * 0.3, sp[0], sp[1], hr);
      rg.addColorStop(0, `rgba(${col},0.34)`);
      rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], hr, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = `rgba(${col},0.26)`;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.stroke();

      if (r >= 8.5) {
        ctx.fillStyle = T.labelText || "#e8f1fb";
        const fs = Math.max(9, Math.min(13, r * 0.85));
        ctx.font = `700 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(a.count), sp[0], sp[1] + 0.5);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }
    }

    const overlaps = (r1, r2) =>
      !(r1.x + r1.w < r2.x || r2.x + r2.w < r1.x || r1.y + r1.h < r2.y || r2.y + r2.h < r1.y);
    const front = items.filter((it) => it.front).sort((a, b) => b.a.count - a.a.count);
    const placed = front.map((it) => ({
      x: it.sp[0] - it.r, y: it.sp[1] - it.r, w: it.r * 2, h: it.r * 2,
    }));
    ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif';
    const H = 16;
    for (const it of front) {
      const { sp, r, col, a } = it;
      const w = ctx.measureText(a.label).width + 10;
      const cands = [
        { x: sp[0] + r + 6, y: sp[1] - H / 2 },
        { x: sp[0] - r - 6 - w, y: sp[1] - H / 2 },
        { x: sp[0] - w / 2, y: sp[1] - r - 5 - H },
        { x: sp[0] - w / 2, y: sp[1] + r + 5 },
      ];
      let box = null;
      for (const c of cands) {
        const rect = { x: c.x, y: c.y, w, h: H };
        if (rect.x < 4 || rect.x + rect.w > this.w - 4 ||
            rect.y < 4 || rect.y + rect.h > this.h - 4) continue;
        if (placed.some((p) => overlaps(rect, p))) continue;
        box = rect; break;
      }
      if (!box) continue;
      placed.push(box);
      ctx.fillStyle = T.labelBg || "rgba(6,13,24,0.78)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = `rgba(${col},1)`;
      ctx.fillRect(box.x, box.y, 2, box.h);
      ctx.fillStyle = T.labelText || "#e8f1fb";
      ctx.textBaseline = "middle";
      ctx.fillText(a.label, box.x + 6, box.y + H / 2 + 0.5);
      ctx.textBaseline = "alphabetic";
    }
  }

  _drawArcs(ctx, T) {
    const STEPS = 64;
    const totalLegs = this.legs.length;
    const drawn = this.arcProgress * totalLegs;
    for (let li = 0; li < totalLegs; li++) {
      const leg = this.legs[li];
      const legFrac = Math.max(0, Math.min(1, drawn - li));
      if (legFrac <= 0) continue;
      const lift = 0.18 + 0.06 * Math.min(1, this._arcSpan(leg.a, leg.b));
      const col = leg.reason === "out" ? (T.arcCustomer || "56,189,248")
        : leg.reason === "in" ? (T.arcReturn || "163,230,53")
          : (T.arcMove || "148,163,184");
      let started = false;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        if (t > legFrac) break;
        const m = slerp(leg.a, leg.b, t);
        const h = 1 + lift * Math.sin(t * Math.PI);
        const v = [m[0] * h, m[1] * h, m[2] * h];
        const p = this._rotPoint(v);
        const sp = this._project(p);
        if (p[2] > -0.1) {
          if (!started) { ctx.moveTo(sp[0], sp[1]); started = true; }
          else ctx.lineTo(sp[0], sp[1]);
        } else { started = false; }
      }
      ctx.strokeStyle = `rgba(${col},0.9)`;
      ctx.shadowColor = `rgba(${col},0.8)`;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (legFrac < 1) {
        const m = slerp(leg.a, leg.b, legFrac);
        const h = 1 + lift * Math.sin(legFrac * Math.PI);
        const p = this._rotPoint([m[0] * h, m[1] * h, m[2] * h]);
        if (p[2] > -0.1) {
          const sp = this._project(p);
          ctx.fillStyle = `rgba(${col},1)`;
          ctx.beginPath(); ctx.arc(sp[0], sp[1], 2.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  _arcSpan(a, b) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
  }

  _drawFocusMarkers(ctx, T, tnow) {
    const pulse = 0.5 + 0.5 * Math.sin(tnow * 3.2);
    this.focusMarkers.forEach((m) => {
      const p = this._rotPoint(m.v);
      const sp = this._project(p);
      const front = p[2] > 0.02;
      const isCurrent = m.current;
      let col = T.markerWip || "250,204,21";
      if (m.status === "Out on lease") col = T.markerLease || "56,189,248";
      else if (m.status === "Ready to ship") col = T.markerReady || "52,211,153";
      const baseA = front ? 1 : 0.22;
      if (front) {
        const hr = (isCurrent ? 14 : 9) + pulse * (isCurrent ? 7 : 3);
        const rg = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], hr);
        rg.addColorStop(0, `rgba(${col},0.55)`);
        rg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(sp[0], sp[1], hr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = `rgba(${col},${baseA})`;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], isCurrent ? 4.2 : 3, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(255,255,255,${front ? 0.85 : 0.2})`;
      ctx.stroke();
      if (m.label) {
        ctx.globalAlpha = front ? 1 : (isCurrent ? 0.5 : 0.3);
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        const tx = sp[0] + (isCurrent ? 9 : 7), ty = sp[1] - 7;
        const wText = ctx.measureText(m.label).width;
        ctx.fillStyle = T.labelBg || "rgba(6,13,24,0.78)";
        ctx.fillRect(tx - 4, ty - 11, wText + 8, 16);
        ctx.fillStyle = `rgba(${col},1)`;
        ctx.fillRect(tx - 4, ty - 11, 2, 16);
        ctx.fillStyle = T.labelText || "#e8f1fb";
        ctx.fillText(m.label, tx, ty);
        ctx.globalAlpha = 1;
      }
    });
  }
}
