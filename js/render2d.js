// Detector views for the FIB-SEM exhibit.
import * as P from './physics.js';
import { blurred } from './sim.js';
import { lamQuality, lamThickness, LAM_STEPS, SHAPES, CRYO_STEPS, cryoQuality, cryoLength } from './mill.js';

export const C = { accent: '#6fd6ff', warm: '#ffb45e', text: '#e9edf2', muted: '#8a94a3', dim: '#566070', grid: 'rgba(255,255,255,0.07)', bg: '#06080b', green: '#5fe3a8' };
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const clamp = P.clamp;
const _arc = CanvasRenderingContext2D.prototype.arc;
CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) { return _arc.call(this, x, y, Math.max(0, r), ...rest); };

function lut(stops) {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], f = clamp((t - t0) / (t1 - t0), 0, 1);
    for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return L;
}
export const LUT = {
  gray: lut([[0, [0, 0, 0]], [1, [255, 255, 255]]]),
  sem: lut([[0, [4, 6, 10]], [0.55, [120, 132, 145]], [1, [245, 248, 250]]]),
  ice: lut([[0, [3, 6, 12]], [0.3, [14, 52, 102]], [0.65, [70, 170, 235]], [1, [236, 250, 255]]]),
  phosphor: lut([[0, [2, 7, 4]], [0.45, [28, 120, 62]], [0.8, [150, 235, 150]], [1, [235, 255, 225]]]),
};

const offs = new Map();
function off(w, h) {
  const k = w + 'x' + h;
  let o = offs.get(k);
  if (!o) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); o = { c, ctx, id: ctx.createImageData(w, h) }; offs.set(k, o); }
  return o;
}
export function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { ctx, W: w, H: h, dpr };
}
export function range(arr, pLo = 0.005, pHi = 0.995) {
  const n = arr.length, m = Math.min(n, 5000), s = new Float32Array(m);
  for (let i = 0; i < m; i++) s[i] = arr[Math.floor((i * n) / m)];
  s.sort();
  return [s[Math.floor(pLo * (m - 1))], s[Math.floor(pHi * (m - 1))]];
}
export function paint(ctx, arr, w, h, dst, o = {}) {
  const { lo, hi, lut: L = LUT.gray, noise = 0, gamma = 1, rows = h, rowsFill = null } = o;
  const { c, ctx: oc, id } = off(w, h), d = id.data;
  let mean = 1;
  if (noise) { mean = 0; for (let i = 0; i < arr.length; i++) mean += arr[i]; mean = mean / arr.length || 1; }
  const span = hi - lo || 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = arr[i];
      if (noise) v = (P.poisson(Math.max(0, (v / mean) * noise)) / noise) * mean;
      let t = clamp((v - lo) / span, 0, 1);
      if (gamma !== 1) t = Math.pow(t, gamma);
      if (y >= rows && rowsFill !== null) t = rowsFill;
      const k = (t * 255) | 0, p = i * 4;
      d[p] = L[k * 3]; d[p + 1] = L[k * 3 + 1]; d[p + 2] = L[k * 3 + 2]; d[p + 3] = 255;
    }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h, dst[0], dst[1], dst[2], dst[3]);
}
export function font(ctx, px, dpr, weight = 400) { ctx.font = `${weight} ${Math.round(px * dpr)}px ${MONO}`; }
export function label(ctx, text, x, y, dpr, { color = C.text, bg = 'rgba(5,7,10,0.62)', size = 10, align = 'left' } = {}) {
  font(ctx, size, dpr);
  const w = ctx.measureText(text).width, p = 4 * dpr, h = size * dpr + 2 * p;
  const bx = align === 'center' ? x - w / 2 - p : align === 'right' ? x - w - 2 * p : x;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - h / 2, w + 2 * p, h, 4 * dpr) : ctx.rect(bx, y - h / 2, w + 2 * p, h); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, bx + p, y + 0.5 * dpr);
}
export const fmtLen = (um) => (um >= 1000 ? `${+(um / 1000).toFixed(2)} mm` : um >= 1 ? `${+um.toFixed(um < 10 ? 2 : 0)} µm` : `${+(um * 1000).toFixed(um < 0.01 ? 1 : 0)} nm`);
function scaleBar(ctx, W, H, fov, dpr) {
  const target = fov * 0.25, e = Math.pow(10, Math.floor(Math.log10(target)));
  const L = [1, 2, 5].map((k) => k * e).filter((v) => v <= target).pop() || e;
  const px = (L / fov) * W, x = W - px - 12 * dpr, y = H - 14 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(x, y, px, 3 * dpr);
  font(ctx, 10, dpr, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(fmtLen(L), x + px / 2, y - 3 * dpr); ctx.textAlign = 'left';
}
export function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
}
const real = (S) => S.clarity === 'real';
export const layout = {};

export function draw(sim, S, mainCv, secCv, hover) {
  const m = fit(mainCv), s = fit(secCv);
  m.ctx.fillStyle = C.bg; m.ctx.fillRect(0, 0, m.W, m.H);
  s.ctx.fillStyle = C.bg; s.ctx.fillRect(0, 0, s.W, s.H);
  ({ se: drawImage, inlens: drawImage, bse: drawImage, ebsd: drawMap, tkd: drawMap, eds: drawEDS, mc: drawMC, fib: drawIon, mill: drawMill, gis: drawMill, lam: drawLam, cryo: drawCryo, sv: drawSV })[S.mode](sim, S, m, s, hover);
  if (S.mis?.cross || S.cross) crosshair(m.ctx, m.W, m.H, m.dpr);
}

// ------------------------------------------------------------------ SE / In-lens / BSE images
function drawImage(sim, S, m, s) {
  const I = sim.img;
  if (!I) return;
  const { ctx, W, H, dpr } = m;
  const [lo, hi] = range(I.arr, 0.004, 0.996);
  const eff = S.mode === 'bse' ? 0.35 : S.mode === 'inlens' ? 0.25 : 0.3;
  let mean = 0;
  for (let i = 0; i < I.arr.length; i += 11) mean += I.arr[i];
  mean /= I.arr.length / 11;
  const counts = S.current * 6.24 * S.dwell * eff * mean * (real(S) ? 1 : 12);
  const row = Math.floor(sim.raster * I.n), first = sim.frame === sim.firstPass;
  paint(ctx, I.arr, I.n, I.n, [0, 0, W, H], { lo, hi, lut: real(S) ? LUT.gray : LUT.sem, noise: Math.max(0.5, counts), rows: first ? row : I.n, rowsFill: 0 });
  const y = (row / I.n) * H;
  const g = ctx.createLinearGradient(0, y - 10 * dpr, 0, y + 2 * dpr);
  g.addColorStop(0, 'rgba(111,214,255,0)'); g.addColorStop(1, 'rgba(111,214,255,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 10 * dpr, W, 12 * dpr);
  scaleBar(ctx, W, H, S.fov, dpr);
  // data bar, like a real SEM
  const mag = Math.round(127000 / S.fov);
  label(ctx, `${S.kV} kV · ×${mag.toLocaleString()} · WD ${S.wd} mm · tilt ${S.tilt}° · ${S.mode === 'se' ? 'ETD' : S.mode === 'inlens' ? 'In-lens' : `BSE ${P.segLabel(S.seg)}`}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  drawPatternMarks(ctx, sim, S, W, H, dpr, sim.thetaE(), 0.35);
  if (I.charging) label(ctx, 'CHARGING: insulator above E2', 8 * dpr, 16 * dpr, dpr, { color: C.warm });
  label(ctx, `sharpness ${(I.sharp * 100).toFixed(1)}`, W - 8 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  if (S.mode === 'se') drawYieldCurves(sim, S, s);
  else if (S.mode === 'inlens') drawProbeCurve(sim, S, s);
  else drawEtaCurve(sim, S, s);
}

function axes(q, x0, y0, w, h, dpr, xt, yt) {
  q.strokeStyle = C.grid; q.lineWidth = 1 * dpr;
  q.beginPath(); q.moveTo(x0, y0); q.lineTo(x0, y0 + h); q.lineTo(x0 + w, y0 + h); q.stroke();
  font(q, 9, dpr); q.fillStyle = C.muted; q.textBaseline = 'top'; q.textAlign = 'center';
  for (const [v, x] of xt) q.fillText(v, x, y0 + h + 4 * dpr);
  q.textAlign = 'right'; q.textBaseline = 'middle';
  for (const [v, y] of yt) q.fillText(v, x0 - 4 * dpr, y);
  q.textAlign = 'left';
}
// SE + BSE yield vs beam energy: E1/E2 crossovers decide whether an insulator charges
function drawYieldCurves(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 34 * d, y0 = 18 * d, w = s.W - x0 - 12 * d, h = s.H - y0 - 30 * d;
  const X = (E) => x0 + ((Math.log10(E) + 1) / (Math.log10(30) + 1)) * w, Y = (v) => y0 + h - (v / 3.5) * h;
  axes(q, x0, y0, w, h, d, [[0.1, X(0.1)], [0.3, X(0.3)], [1, X(1)], [3, X(3)], [10, X(10)], [30, X(30)]].map(([v, x]) => [`${v}`, x]), [[0, Y(0)], [1, Y(1)], [2, Y(2)], [3, Y(3)]].map(([v, y]) => [`${v}`, y]));
  q.setLineDash([3 * d, 3 * d]); q.strokeStyle = 'rgba(255,255,255,0.3)'; q.beginPath(); q.moveTo(x0, Y(1)); q.lineTo(x0 + w, Y(1)); q.stroke(); q.setLineDash([]);
  const mats = [...new Set(sim.grid ? [...sim.grid.M].filter((_, i) => i % 97 === 0) : [])].map((i) => Object.keys(P.MAT)[i]).filter((k) => P.MAT[k].rho);
  for (const k of mats) {
    const m = P.MAT[k];
    q.beginPath();
    for (let i = 0; i <= 120; i++) { const E = Math.pow(10, -1 + (i / 120) * (Math.log10(30) + 1)); const v = P.delta(m, E) + P.eta(m.Z); i ? q.lineTo(X(E), Y(v)) : q.moveTo(X(E), Y(v)); }
    q.strokeStyle = m.cond ? m.color : C.warm; q.lineWidth = (m.cond ? 1.3 : 2) * d; q.stroke();
    if (!m.cond) { const E2 = m.E2; q.fillStyle = C.warm; q.beginPath(); q.arc(X(E2), Y(1), 3.5 * d, 0, 7); q.fill(); label(q, `E2 ≈ ${E2} kV`, X(E2) + 6 * d, Y(1) - 12 * d, d, { color: C.warm, size: 9 }); }
    const Ep = 1.2;
    label(q, m.name.split(' ')[0], X(Ep) + 4 * d, Y(P.delta(m, Ep) + P.eta(m.Z)) - 8 * d, d, { color: m.cond ? m.color : C.warm, size: 8.5 });
  }
  q.strokeStyle = C.accent; q.lineWidth = 1.5 * d; q.beginPath(); q.moveTo(X(S.kV), y0); q.lineTo(X(S.kV), y0 + h); q.stroke();
  label(q, 'total yield δ + η  vs  beam energy (keV)', x0, 8 * d, d, { color: C.muted, size: 9 });
  label(q, `${S.kV} kV`, X(S.kV) + 4 * d, y0 + 10 * d, d, { color: C.accent, size: 9 });
  label(q, S.etdBias >= 0 ? `ETD grid +${S.etdBias} V: SE collected` : `ETD grid ${S.etdBias} V: SE rejected → BSE only`, x0 + w, y0 + h - 10 * d, d, { color: S.etdBias >= 0 ? C.green : C.warm, size: 9, align: 'right' });
}
// Probe size vs convergence angle: the classic SEM optimisation curve
function drawProbeCurve(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 40 * d, y0 = 18 * d, w = s.W - x0 - 12 * d, h = s.H - y0 - 30 * d;
  const aMin = 0.5e-3, aMax = 30e-3, X = (a) => x0 + (Math.log(a / aMin) / Math.log(aMax / aMin)) * w;
  const pr = sim.probe;
  const curves = { d: [], dg: [], ds: [], dc: [], dd: [] };
  let yMax = 0;
  for (let i = 0; i <= 150; i++) { const a = aMin * Math.pow(aMax / aMin, i / 150), v = P.probeVsAlpha(S, a); for (const k in curves) curves[k].push([a, v[k]]); }
  yMax = Math.max(pr.d * 4, 5);
  const Y = (v) => y0 + h - clamp(Math.log10(Math.max(0.1, v)) / Math.log10(yMax), 0, 1) * h;
  const yt = [0.1, 1, 10, 100, 1000].filter((v) => v <= yMax * 1.01 && v >= 0.1).map((v) => [`${v}`, Y(v)]);
  axes(q, x0, y0, w, h, d, [1, 3, 10, 30].map((v) => [`${v}`, X(v * 1e-3)]), yt);
  const col = { dg: '#b59bff', ds: C.warm, dc: '#ff7d7d', dd: C.green, d: C.text };
  const nm = { dg: 'source image', ds: 'spherical Cs', dc: 'chromatic Cc', dd: 'diffraction', d: 'probe' };
  for (const k of ['dg', 'ds', 'dc', 'dd', 'd']) {
    q.beginPath(); curves[k].forEach(([a, v], i) => (i ? q.lineTo(X(a), Y(v)) : q.moveTo(X(a), Y(v))));
    q.strokeStyle = col[k]; q.lineWidth = (k === 'd' ? 2.2 : 1.1) * d; if (k !== 'd') q.setLineDash([3 * d, 3 * d]); q.stroke(); q.setLineDash([]);
  }
  let yy = y0 + 4 * d;
  for (const k of ['d', 'dg', 'ds', 'dc', 'dd']) { label(q, nm[k], x0 + w, yy, d, { color: col[k], size: 8.5, align: 'right' }); yy += 15 * d; }
  q.fillStyle = C.accent; q.beginPath(); q.arc(X(pr.alpha), Y(pr.d), 4 * d, 0, 7); q.fill();
  label(q, `α = ${(pr.alpha * 1000).toFixed(1)} mrad → d = ${pr.d.toFixed(1)} nm`, X(pr.alpha) + 8 * d, Y(pr.d) - 12 * d, d, { color: C.accent, size: 9 });
  label(q, 'probe diameter (nm)  vs  convergence α (mrad)', x0, 8 * d, d, { color: C.muted, size: 9 });
}
// Backscatter coefficient vs atomic number
function drawEtaCurve(sim, S, s) {
  const q = s.ctx, d = s.dpr, x0 = 34 * d, y0 = 18 * d, w = s.W * 0.62 - x0, h = s.H - y0 - 30 * d;
  const X = (Z) => x0 + (Z / 80) * w, Y = (v) => y0 + h - (v / 0.6) * h;
  axes(q, x0, y0, w, h, d, [10, 20, 40, 60, 80].map((Z) => [`${Z}`, X(Z)]), [0, 0.2, 0.4, 0.6].map((v) => [`${v}`, Y(v)]));
  q.beginPath();
  for (let Z = 1; Z <= 80; Z++) { const v = P.eta(Z); Z > 1 ? q.lineTo(X(Z), Y(v)) : q.moveTo(X(Z), Y(v)); }
  q.strokeStyle = C.text; q.lineWidth = 1.5 * d; q.stroke();
  const shown = new Set();
  for (const k of Object.keys(P.MAT)) {
    const m = P.MAT[k];
    if (!m.rho || shown.has(m.Z)) continue;
    if (sim.grid && ![...sim.grid.M].some((v, i) => i % 53 === 0 && Object.keys(P.MAT)[v] === k)) continue;
    shown.add(m.Z);
    q.fillStyle = m.color; q.beginPath(); q.arc(X(m.Z), Y(P.eta(m.Z)), 4 * d, 0, 7); q.fill();
    label(q, `${k.replace('2O3', '₂O₃').replace('O2', 'O₂')} η=${P.eta(m.Z).toFixed(2)}`, X(m.Z) + 6 * d, Y(P.eta(m.Z)) - 10 * d, d, { color: m.color, size: 8.5 });
  }
  label(q, 'backscatter coefficient η  vs  Z', x0, 8 * d, d, { color: C.muted, size: 9 });
  // quadrant detector
  const cx = s.W * 0.83, cy = s.H / 2 + 6 * d, R = Math.min(s.W * 0.13, s.H * 0.36);
  layout.quad = { cx: cx / d, cy: cy / d, R: R / d };
  const segs = [['A', 0], ['B', Math.PI], ['C', Math.PI / 2], ['D', -Math.PI / 2]];
  for (const [nm, a] of segs) {
    const sg = S.seg[nm];
    q.fillStyle = sg > 0 ? 'rgba(111,214,255,0.38)' : sg < 0 ? 'rgba(255,125,125,0.4)' : 'rgba(255,255,255,0.04)';
    q.beginPath(); q.moveTo(cx, cy); q.arc(cx, cy, R, a - Math.PI / 4, a + Math.PI / 4); q.closePath(); q.fill();
    q.strokeStyle = 'rgba(255,255,255,0.3)'; q.lineWidth = 1 * d; q.stroke();
    font(q, 11, d, 600); q.fillStyle = sg ? C.text : C.dim; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText(`${sg > 0 ? '+' : sg < 0 ? '−' : ''}${nm}`, cx + Math.cos(a) * R * 0.62, cy - Math.sin(a) * R * 0.62);
  }
  q.fillStyle = C.bg; q.beginPath(); q.arc(cx, cy, R * 0.25, 0, 7); q.fill(); q.textAlign = 'left';
  label(q, `${P.segLabel(S.seg)}: ${P.segKind(S.seg)}`, cx, 12 * d, d, { color: C.accent, size: 9, align: 'center' });
  label(q, 'click a segment: + / − / off', cx, s.H - 12 * d, d, { color: C.muted, size: 8.5, align: 'center' });
}

// ------------------------------------------------------------------ EBSD / TKD maps
function drawMap(sim, S, m, s, hover) {
  const M = sim.map, { ctx, W, H, dpr } = m;
  if (!M) return;
  const N = M.N;
  layout.map = { N };
  const { c, ctx: oc, id } = off(N, N);
  let bcMax = 0;
  for (let k = 0; k < M.done; k++) bcMax = Math.max(bcMax, M.bc[k]);
  for (let k = 0; k < N * N; k++) {
    const p = k * 4;
    let col = [0, 0, 0];
    if (k < M.done) {
      if (S.mapView === 'bc') { const v = clamp(M.bc[k] / (bcMax || 1), 0, 1) * 255; col = [v, v, v]; }
      else if (S.mapView === 'mad') col = M.O[k] ? hsv(0.33 * (1 - clamp(M.mad[k] / 2, 0, 1)), 0.8, 0.95) : [0, 0, 0];
      else col = M.O[k] ? P.ipfColor(M.O[k]) : [0, 0, 0];
    } else col = [8, 10, 14];
    id.data[p] = col[0]; id.data[p + 1] = col[1]; id.data[p + 2] = col[2]; id.data[p + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, N, N, 0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  const sel = hover >= 0 ? hover : Math.max(0, M.done - 1), si = sel % N, sj = (sel / N) | 0;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr;
  ctx.strokeRect((si / N) * W - 1, (sj / N) * H - 1, W / N + 2, H / N + 2);
  scaleBar(ctx, W, H, M.fov, dpr);
  const pct = Math.round((100 * M.done) / (N * N));
  const rate = M.done ? Math.round((100 * M.ok) / M.done) : 0;
  label(ctx, `${S.mode.toUpperCase()} map ${N}×${N} · step ${fmtLen(M.fov / N)} · ${pct < 100 ? `${pct}%` : 'done'} · indexed ${rate}%`, 8 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
  if (M.ok) label(ctx, `mean error vs truth ${(M.errSum / M.ok).toFixed(2)}°`, 8 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9 });
  label(ctx, { ipf: 'IPF-Z colouring', bc: 'band contrast', mad: 'MAD (green = good fit)' }[S.mapView], W - 8 * dpr, H - 30 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });

  // secondary: Kikuchi pattern + indexing
  const q = s.ctx, d = s.dpr, sz = Math.min(s.H, s.W * 0.55);
  const a = sel < M.done ? sim.patternAt(sel, hover < 0 && M.done < N * N) : null;
  layout.pat = { sz };
  if (!a) return;
  const Np = a.N ?? 144;
  const pat = a.pat;
  // background correction (as done before indexing) and the display range, computed once per pattern
  const dk = real(S) ? 'real' : 'edu';
  if (!a.disp || a.disp.k !== dk) {
    let arr = pat;
    if (!real(S)) {
      const bg = blurred(pat, Np, Np, Np / 12);
      arr = new Float32Array(Np * Np);
      for (let i = 0; i < arr.length; i++) arr[i] = pat[i] ? pat[i] / (bg[i] || 1) : 0;
    }
    const inside = [];
    for (let i = 0; i < arr.length; i++) if (arr[i]) inside.push(arr[i]);
    a.disp = { k: dk, arr, r: range(Float32Array.from(inside), 0.01, 0.995) };
  }
  const arr = a.disp.arr, [lo, hi] = a.disp.r;
  paint(q, arr, Np, Np, [0, 0, sz, sz], { lo, hi, lut: real(S) ? LUT.gray : LUT.phosphor });
  q.strokeStyle = 'rgba(255,255,255,0.15)'; q.lineWidth = 1 * d; q.beginPath(); q.arc(sz / 2, sz / 2, sz / 2 - 1, 0, 7); q.stroke();
  const G = sim.geom(), toPx = (u, v) => [((u + 1) / 2) * sz, ((1 - v) / 2) * sz];
  // pattern centre
  const [pcx, pcy] = toPx(G.pcx, G.pcy);
  q.strokeStyle = C.warm; q.beginPath(); q.moveTo(pcx - 6 * d, pcy); q.lineTo(pcx + 6 * d, pcy); q.moveTo(pcx, pcy - 6 * d); q.lineTo(pcx, pcy + 6 * d); q.stroke();
  if (a.peaks && S.showHough) {
    q.strokeStyle = 'rgba(111,214,255,0.8)'; q.lineWidth = 1.2 * d;
    q.save(); q.beginPath(); q.arc(sz / 2, sz / 2, sz / 2, 0, 7); q.clip();
    for (const pk of a.peaks) {
      const ct = Math.cos(pk.theta), st = Math.sin(pk.theta);
      const [x1, y1] = toPx(pk.rho * ct - 2 * st, pk.rho * st + 2 * ct), [x2, y2] = toPx(pk.rho * ct + 2 * st, pk.rho * st - 2 * ct);
      q.beginPath(); q.moveTo(x1, y1); q.lineTo(x2, y2); q.stroke();
    }
    q.restore();
  }
  // zone axes from the indexed orientation
  if (a.res && !real(S)) {
    const T = sim.tiltM();
    for (const z of [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 1, 2]]) {
      const perms = new Set();
      for (const Sm of P.CUBIC) {
        const v = P.mat3.mv(Sm, z), key = v.join(',');
        if (perms.has(key)) continue; perms.add(key);
        const rm = P.mat3.mv(T, P.mat3.mv(a.res.O, P.norm(v)));
        let u, w;
        if (G.type === 'ebsd') { if (rm[1] <= 0.05) continue; u = (rm[0] / rm[1]) * G.D + G.pcx; w = (rm[2] / rm[1]) * G.D + G.pcy; }
        else { if (rm[2] >= -0.05) continue; u = (rm[0] / -rm[2]) * G.D + G.pcx; w = (rm[1] / -rm[2]) * G.D + G.pcy; }
        if (u * u + w * w > 0.85) continue;
        const [x, y] = toPx(u, w);
        q.fillStyle = C.warm; q.beginPath(); q.arc(x, y, 2.5 * d, 0, 7); q.fill();
        label(q, `[${v.map((c) => (c < 0 ? `${-c}̅` : c)).join('')}]`, x + 4 * d, y - 8 * d, d, { color: '#ffe2b8', size: 8 });
      }
    }
  }
  // indexing report
  const tx = sz + 14 * d;
  const rows = [];
  if (!a.res) rows.push(['result', a.phase && P.MAT[a.phase]?.cryst ? 'not indexed' : `${P.MAT[a.phase]?.name ?? 'vacuum'}: no pattern`]);
  else {
    const r = a.res;
    rows.push(['phase', `${P.MAT[r.phase].name} (${P.MAT[r.phase].cryst === 'dia' ? 'Fd3̄m' : 'Fm3̄m'})`], ['bands', `${r.matched} / ${r.K} matched`], ['MAD', `${(r.mad / P.DEG).toFixed(2)}°`], ['CI', r.ci.toFixed(2)], ['error vs truth', `${r.err.toFixed(2)}°`]);
    const e = euler(r.O);
    rows.push(['Euler (Bunge)', `${e.map((v) => v.toFixed(0)).join('°, ')}°`]);
  }
  rows.push(['pattern centre', `(${G.pcx.toFixed(2)}, ${G.pcy.toFixed(2)}) · DD ${G.D.toFixed(2)}`]);
  let y = 16 * d;
  for (const [k, v] of rows) {
    font(q, 8.5, d); q.fillStyle = C.muted; q.textBaseline = 'top'; q.fillText(k.toUpperCase(), tx, y);
    font(q, 11, d, 500); q.fillStyle = C.text; q.fillText(v, tx, y + 11 * d);
    y += 30 * d;
  }
  // IPF colour key: the [001]–[101]–[111] standard triangle
  const L = 46 * d, A = [s.W - 70 * d, s.H - 18 * d], B = [A[0] + L, A[1]], Cv = [A[0] + L * 0.8, A[1] - L * 0.75];
  const V = [[0, 0, 1], [Math.SQRT1_2, 0, Math.SQRT1_2], [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]];
  const st = 18;
  for (let i = 0; i <= st; i++) for (let j = 0; j <= st - i; j++) {
    const b = i / st, c = j / st, a0 = 1 - b - c;
    const dir = P.norm([0, 1, 2].map((k) => a0 * V[0][k] + b * V[1][k] + c * V[2][k]));
    const col = P.ipfColor(frameTo(dir));
    const x = a0 * A[0] + b * B[0] + c * Cv[0], y = a0 * A[1] + b * B[1] + c * Cv[1];
    q.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    q.fillRect(x - 1.6 * d, y - 1.6 * d, 3.4 * d, 3.4 * d);
  }
  font(q, 8, d); q.fillStyle = C.muted; q.textBaseline = 'top';
  q.fillText('001', A[0] - 8 * d, A[1] + 4 * d); q.fillText('101', B[0] - 8 * d, B[1] + 4 * d); q.textBaseline = 'bottom'; q.fillText('111', Cv[0] - 8 * d, Cv[1] - 4 * d);
}
// an orientation whose sample-Z lies along crystal direction v (rows of O = sample axes in crystal coords)
function frameTo(v) {
  const z = v, x = P.norm(P.cross([0.13, 1, 0.07], z)), y = P.cross(z, x);
  return [x, y, z];
}
function euler(O) {
  // Bunge angles of the crystal→sample matrix
  const g = P.mat3.T(O), Phi = Math.acos(clamp(g[2][2], -1, 1));
  let p1, p2;
  if (Math.abs(Math.sin(Phi)) > 1e-6) { p1 = Math.atan2(g[2][0], -g[2][1]); p2 = Math.atan2(g[0][2], g[1][2]); }
  else { p1 = Math.atan2(g[0][1], g[0][0]); p2 = 0; }
  const d = (v) => (((v / P.DEG) % 360) + 360) % 360;
  return [d(p1), Phi / P.DEG, d(p2)];
}

// ------------------------------------------------------------------ EDS
function drawEDS(sim, S, m, s) {
  const e = sim.eds, a = sim.acc;
  if (!e || !a) return;
  const { ctx, W, H, dpr } = m, n = e.n;
  const syms = S.edsSel === 'all' ? e.syms : [S.edsSel];
  // colour each pixel by its element mix (weighted mean colour), brightness by the strongest element
  const { c, ctx: oc, id } = off(n, n), buf = new Float32Array(n * n * 3), wsum = new Float32Array(n * n), vmax = new Float32Array(n * n);
  for (const sym of syms) {
    const src = real(S) ? a.maps[sym] : e.maps[sym];
    let mx = 0;
    for (let i = 0; i < n * n; i++) mx = Math.max(mx, src[i]);
    const col = syms.length === 1 && real(S) ? [255, 255, 255] : hex(P.EL_COLOR[sym]);
    for (let i = 0; i < n * n; i++) {
      const v = src[i] / (mx || 1), w = v * v;
      buf[i * 3] += w * col[0]; buf[i * 3 + 1] += w * col[1]; buf[i * 3 + 2] += w * col[2];
      wsum[i] += w; if (v > vmax[i]) vmax[i] = v;
    }
  }
  for (let i = 0; i < n * n; i++) {
    const k = wsum[i] ? Math.pow(vmax[i], 0.8) / wsum[i] : 0;
    id.data[i * 4] = buf[i * 3] * k; id.data[i * 4 + 1] = buf[i * 3 + 1] * k; id.data[i * 4 + 2] = buf[i * 3 + 2] * k; id.data[i * 4 + 3] = 255;
  }
  oc.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = !real(S);
  ctx.drawImage(c, 0, 0, n, n, 0, 0, W, H);
  scaleBar(ctx, W, H, S.fov, dpr);
  let yy = 16 * dpr;
  for (const sym of syms) { label(ctx, sym, 8 * dpr, yy, dpr, { color: P.EL_COLOR[sym] }); yy += 20 * dpr; }
  label(ctx, `X-ray range ≈ ${fmtLen(e.Rx)}`, W - 8 * dpr, 16 * dpr, dpr, { color: C.warm, size: 9, align: 'right' });
  label(ctx, `${a.t.toFixed(1)} s · ${Math.round(a.total).toLocaleString()} counts`, W - 8 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  // spectrum
  const q = s.ctx, d = s.dpr, x0 = 38 * d, y0 = 16 * d, w = s.W - x0 - 10 * d, h = s.H - y0 - 30 * d, Emax = e.Emax;
  layout.eds = { x0: x0 / d, w: w / d, Emax };
  const data = real(S) ? a.spec : e.spec;
  let mx = 0;
  for (let b = Math.floor(0.2 / e.dE); b < e.nb; b++) mx = Math.max(mx, data[b]);
  const X = (E) => x0 + (E / Emax) * w;
  q.strokeStyle = C.grid; q.lineWidth = 1 * d;
  font(q, 9, d); q.fillStyle = C.muted; q.textAlign = 'center'; q.textBaseline = 'top';
  const step = Emax > 16 ? 5 : 2;
  for (let E = 0; E <= Emax; E += step) { q.beginPath(); q.moveTo(X(E), y0); q.lineTo(X(E), y0 + h); q.stroke(); q.fillText(`${E}`, X(E), y0 + h + 4 * d); }
  q.fillText('keV', x0 + w - 8 * d, y0 + h + 14 * d); q.textAlign = 'left';
  q.beginPath();
  for (let b = 0; b < e.nb; b++) { const x = X((b + 0.5) * e.dE), y = y0 + h - Math.min(1, data[b] / (mx || 1)) * h * 0.92; b ? q.lineTo(x, y) : q.moveTo(x, y); }
  q.lineTo(x0 + w, y0 + h); q.lineTo(x0, y0 + h); q.closePath();
  const gg = q.createLinearGradient(0, y0, 0, y0 + h); gg.addColorStop(0, 'rgba(255,180,94,0.5)'); gg.addColorStop(1, 'rgba(255,180,94,0.04)');
  q.fillStyle = gg; q.fill(); q.strokeStyle = C.warm; q.lineWidth = 1.2 * d; q.stroke();
  // Duane–Hunt limit
  q.setLineDash([3 * d, 3 * d]); q.strokeStyle = C.accent; q.beginPath(); q.moveTo(X(S.kV), y0); q.lineTo(X(S.kV), y0 + h); q.stroke(); q.setLineDash([]);
  if (S.kV < Emax) label(q, `Duane–Hunt limit = ${S.kV} keV`, X(S.kV) - 4 * d, y0 + 8 * d, d, { color: C.accent, size: 8.5, align: 'right' });
  const placed = [];
  for (const L of P.XLINES.filter((l) => e.comp[l.el] && l.w >= 0.5 && S.kV > l.Ec)) {
    const b = Math.floor(L.E / e.dE);
    let pk = 0;
    for (let k = b - 4; k <= b + 4; k++) pk = Math.max(pk, data[k] || 0);
    const x = X(L.E), y = Math.max(y0 + 8 * d, y0 + h - Math.min(1, pk / (mx || 1)) * h * 0.92 - 12 * d);
    if (placed.some((p) => Math.abs(p[0] - x) < 40 * d && Math.abs(p[1] - y) < 14 * d)) continue;
    placed.push([x, y]);
    label(q, `${L.el} ${L.line}`, x, y, d, { color: P.EL_COLOR[L.el], size: 8.5, align: 'center' });
  }
  const missing = P.XLINES.filter((l) => e.comp[l.el] && l.w === 1 && S.kV <= l.Ec * 1.5 && S.kV > 0);
  if (missing.length) label(q, `U = E₀/Ec < 1.5 for ${[...new Set(missing.map((l) => `${l.el} ${l.line.startsWith('K') ? 'K' : l.line[0]}`))].join(', ')}: weak or absent`, x0, y0 + h - 12 * d, d, { color: C.warm, size: 8.5 });
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ------------------------------------------------------------------ Monte Carlo
function drawMC(sim, S, m, s) {
  const mc = sim.mc, { ctx, W, H, dpr } = m;
  if (mc?.kind === 'ion') return drawIonMC(sim, S, m, s);
  if (!mc) { label(ctx, 'beam on vacuum: move the stage onto the specimen', W / 2, H / 2, dpr, { color: C.warm, align: 'center' }); return; }
  const R = Math.max(mc.R, mc.maxDepth) * 1.05, oy = H * 0.2, sc = Math.min(W / (1.7 * R), (H - oy - 8 * dpr) / R), ox = W / 2;
  ctx.fillStyle = '#0b0f15'; ctx.fillRect(0, oy, W, H - oy);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  for (const t of mc.traj) {
    ctx.beginPath();
    t.pts.forEach(([x, z], i) => (i ? ctx.lineTo(ox + x * sc, oy + z * sc) : ctx.moveTo(ox + x * sc, oy + z * sc)));
    const E = t.pts[t.pts.length - 1][2] / mc.E0;
    const [r, g, b] = t.bse ? [255, 180, 94] : real(S) ? [200, 205, 215] : hsv(0.55 + 0.25 * (1 - E), 0.75, 1);
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${t.bse ? 0.75 : 0.35})`;
    ctx.lineWidth = (t.bse ? 1.1 : 0.8) * dpr; ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  // incident beam
  const tb = S.tilt * P.DEG;
  ctx.strokeStyle = C.green; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(ox - Math.sin(tb) * oy * 0.9, oy - Math.cos(tb) * oy * 0.9); ctx.lineTo(ox, oy); ctx.stroke();
  const Rk = P.rangeKO(mc.m, mc.E0) * 1000;
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(111,214,255,0.6)';
  ctx.beginPath(); ctx.moveTo(0, oy + Rk * sc); ctx.lineTo(W, oy + Rk * sc); ctx.stroke();
  if (sim.mcLine) { const Rx = P.rangeX(mc.m, mc.E0, sim.mcLine.Ec) * 1000; ctx.strokeStyle = 'rgba(255,180,94,0.6)'; ctx.beginPath(); ctx.moveTo(0, oy + Rx * sc); ctx.lineTo(W, oy + Rx * sc); ctx.stroke(); label(ctx, `X-ray range (${sim.mcLine.el} ${sim.mcLine.line}) ${fmtLen(Rx / 1000)}`, 8 * dpr, oy + Rx * sc - 10 * dpr, dpr, { color: C.warm, size: 8.5 }); }
  ctx.setLineDash([]);
  label(ctx, `Kanaya–Okayama range ${fmtLen(Rk / 1000)}`, 8 * dpr, oy + Rk * sc + 12 * dpr, dpr, { color: C.accent, size: 8.5 });
  label(ctx, `${mc.m.name} · ${mc.E0} keV · tilt ${S.tilt}° · ${mc.n.toLocaleString()} electrons`, 8 * dpr, 14 * dpr, dpr, { color: C.text, size: 9 });
  if (sim.mcNote) label(ctx, sim.mcNote, 8 * dpr, 54 * dpr, dpr, { color: C.warm, size: 9 });
  label(ctx, `η (Monte Carlo) = ${mc.eta.toFixed(3)} · η (Reuter/Arnal) = ${P.eta(mc.m.Z, tb).toFixed(3)}`, 8 * dpr, 34 * dpr, dpr, { color: C.warm, size: 9 });
  // scale bar
  const target = 2 * R * 0.25, e = Math.pow(10, Math.floor(Math.log10(target))), L = [1, 2, 5].map((k) => k * e).filter((v) => v <= target).pop() || e;
  ctx.fillStyle = '#fff'; ctx.fillRect(W - 12 * dpr - L * sc, H - 14 * dpr, L * sc, 3 * dpr);
  font(ctx, 10, dpr, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fmtLen(L / 1000), W - 12 * dpr - (L * sc) / 2, H - 17 * dpr); ctx.textAlign = 'left';

  // secondary: BSE energy spectrum + depth distributions
  const q = s.ctx, d = s.dpr, pw = (s.W - 30 * d) / 2, ph = s.H - 50 * d;
  // BSE energy
  let bm = 0;
  for (const v of mc.bseE) bm = Math.max(bm, v);
  const bx = 14 * d, by = 22 * d;
  q.fillStyle = 'rgba(255,180,94,0.7)';
  mc.bseE.forEach((v, i) => { const hh = (v / (bm || 1)) * ph; q.fillRect(bx + (i / 40) * pw, by + ph - hh, pw / 40 - 1, hh); });
  q.strokeStyle = C.grid; q.strokeRect(bx, by, pw, ph);
  label(q, 'backscattered energy  E/E₀', bx, 10 * d, d, { color: C.muted, size: 9 });
  font(q, 9, d); q.fillStyle = C.muted; q.fillText('0', bx, by + ph + 12 * d); q.fillText('1', bx + pw - 6 * d, by + ph + 12 * d);
  // depth profiles
  const dx = bx + pw + 16 * d;
  const norm = (a) => { let mx = 0; for (const v of a) mx = Math.max(mx, v); return Array.from(a, (v) => v / (mx || 1)); };
  const dep = norm(mc.depthE), phi = norm(mc.phi);
  const plot = (arr, col) => { q.beginPath(); arr.forEach((v, i) => { const x = dx + v * pw, y = by + (i / arr.length) * ph; i ? q.lineTo(x, y) : q.moveTo(x, y); }); q.strokeStyle = col; q.lineWidth = 1.6 * d; q.stroke(); };
  plot(dep, C.accent);
  if (sim.mcLine) plot(phi, C.warm);
  q.strokeStyle = C.grid; q.lineWidth = 1 * d; q.strokeRect(dx, by, pw, ph);
  label(q, 'depth ↓: energy deposited', dx, 10 * d, d, { color: C.accent, size: 9 });
  if (sim.mcLine) label(q, `φ(ρz) ${sim.mcLine.el} ${sim.mcLine.line}`, dx + pw, by + 12 * d, d, { color: C.warm, size: 9, align: 'right' });
  font(q, 9, d); q.fillStyle = C.muted; q.fillText(fmtLen(0), dx - 2 * d, by + ph + 12 * d); q.fillText(`${fmtLen((mc.R * 1.25) / 1000)}`, dx + pw - 44 * d, by + ph + 12 * d);
}

// ================================================================== FIB views
const ionCol = (S) => P.ION[S.ion].color;
const fmtI = P.fmtCurrent;
// projection of sample (x, y, Z) into an image of the given beam angle: returns canvas pixels
export function projector(sim, S, theta, W, H) {
  const c = Math.cos(theta), s = Math.sin(theta), zc = sim.spec.top(S.cx, S.cy), vC = S.cy * c + (S.ez + zc) * s;
  const to = (x, y, Z = 0) => [W / 2 + ((x - S.cx) / S.fov) * W, H / 2 - ((y * c + (Z + S.ez) * s - vC) / S.fov) * H];
  const from = (X, Y, Z = 0) => [S.cx + ((X - W / 2) / W) * S.fov, ((H / 2 - Y) / H) * S.fov / c + vC / c - ((Z + S.ez) * s) / c];
  return { to, from, c, s, vC };
}
export function crosshair(q, W, H, d) {
  q.strokeStyle = 'rgba(255,214,90,0.85)'; q.lineWidth = 1.2 * d;
  q.beginPath(); q.moveTo(W / 2 - 14 * d, H / 2); q.lineTo(W / 2 - 4 * d, H / 2); q.moveTo(W / 2 + 4 * d, H / 2); q.lineTo(W / 2 + 14 * d, H / 2);
  q.moveTo(W / 2, H / 2 - 14 * d); q.lineTo(W / 2, H / 2 - 4 * d); q.moveTo(W / 2, H / 2 + 4 * d); q.lineTo(W / 2, H / 2 + 14 * d); q.stroke();
}
// pattern outlines (and progress) over an image
function drawPatternMarks(q, sim, S, W, H, d, theta, alpha = 1) {
  const pats = sim.mill.patterns.filter((p) => p.kind !== 'img');
  if (!pats.length) return;
  const pj = projector(sim, S, theta, W, H);
  for (const p of pats) {
    const [x0, y0] = pj.to(p.x - p.w / 2, p.y + p.h / 2), [x1, y1] = pj.to(p.x + p.w / 2, p.y - p.h / 2);
    const col = p.kind === 'dep' ? '255,214,120' : p.status === 'done' ? '140,150,165' : '111,214,255';
    q.globalAlpha = alpha;
    q.strokeStyle = `rgba(${col},${p.status === 'queued' ? 0.95 : 0.7})`; q.lineWidth = (p.status === 'running' ? 1.8 : 1.1) * d;
    if (p.status === 'queued') q.setLineDash([4 * d, 3 * d]);
    if (p.shape === 'circle') { q.beginPath(); q.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, 7); q.stroke(); }
    else { q.strokeRect(x0, y0, x1 - x0, y1 - y0); }
    q.setLineDash([]);
    if (p.shape === 'rcs' || p.shape === 'ccs') { // mark the face edge
      const yf = p.face > 0 ? y0 : y1; q.strokeStyle = `rgba(255,180,94,${0.9 * alpha})`; q.lineWidth = 2.2 * d; q.beginPath(); q.moveTo(x0, yf); q.lineTo(x1, yf); q.stroke();
    }
    if (p.status === 'running') { q.fillStyle = `rgba(${col},0.18)`; const hh = (y1 - y0) * p.done; q.fillRect(x0, y0 + (p.face > 0 ? (y1 - y0) - hh : 0), x1 - x0, hh); }
    q.globalAlpha = 1;
    if (alpha > 0.5 && Math.abs(x1 - x0) > 40 * d) label(q, `#${p.id} ${p.kind === 'dep' ? `${p.gas} dep` : p.shape}${p.status === 'running' ? ` ${Math.round(p.done * 100)}%` : p.status === 'queued' ? ' · queued' : ''}`, x0 + 3 * d, Math.min(y0, y1) - 9 * d, d, { color: `rgb(${col})`, size: 8.5 });
  }
}
function paintImage(q, I, S, W, H, raster, firstPass, ion) {
  const [lo, hi] = range(I.arr, 0.004, 0.996);
  let mean = 0;
  for (let i = 0; i < I.arr.length; i += 11) mean += I.arr[i];
  mean /= I.arr.length / 11;
  const counts = ion ? S.icur * 6.24 * S.idwell * 1.5 * mean * (real(S) ? 1 : 12) : S.current * 6.24 * S.dwell * 0.3 * mean * (real(S) ? 1 : 12);
  const row = Math.floor(raster * I.n);
  paint(q, I.arr, I.n, I.n, [0, 0, W, H], { lo, hi, lut: real(S) ? LUT.gray : ion ? LUT.ion : LUT.sem, noise: Math.max(0.3, counts), rows: firstPass ? row : I.n, rowsFill: 0 });
  return row;
}
LUT.ion = lut([[0, [6, 4, 2]], [0.55, [150, 122, 92]], [1, [255, 244, 226]]]);

// ------------------------------------------------------------------ ion image
function drawIon(sim, S, m, s) {
  const I = sim.ionImg;
  if (!I) return;
  const { ctx, W, H, dpr } = m;
  const row = paintImage(ctx, I, S, W, H, sim.iraster, sim.iframe === sim.ifirstPass, true);
  const y = (row / I.n) * H, g = ctx.createLinearGradient(0, y - 10 * dpr, 0, y + 2 * dpr);
  g.addColorStop(0, 'rgba(255,180,94,0)'); g.addColorStop(1, 'rgba(255,180,94,0.45)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 10 * dpr, W, 12 * dpr);
  layout.ionView = { W: W / dpr, H: H / dpr, theta: sim.thetaI() };
  drawPatternMarks(ctx, sim, S, W, H, dpr, sim.thetaI(), 0.6);
  scaleBar(ctx, W, H, S.fov, dpr);
  label(ctx, `${P.ION[S.ion].name} ${S.ikV} kV · ${fmtI(S.icur)} · ×${Math.round(127000 / S.fov).toLocaleString()} · tilt ${S.tilt}° · ${S.fibDet === 'si' ? 'SI' : 'ISE'}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  if (I.charging && !S.flood) label(ctx, 'CHARGING (+) · flood off', 8 * dpr, 16 * dpr, dpr, { color: C.warm });
  label(ctx, `sharpness ${(I.sharp * 100).toFixed(1)}`, W - 8 * dpr, 16 * dpr, dpr, { color: C.muted, size: 9, align: 'right' });
  if (sim.imgRemoved > 0.5) label(ctx, `imaging has removed ${sim.imgRemoved.toFixed(1)} nm here (${(sim.imgDose ?? 0).toFixed(2)} ions/nm²)`, W - 8 * dpr, 36 * dpr, dpr, { color: sim.imgRemoved > 20 ? C.warm : C.muted, size: 9, align: 'right' });
  drawYieldPanel(sim, S, s);
}
// sputter yield vs incidence angle for every species on the material under the beam, and the probe vs current
function drawYieldPanel(sim, S, s) {
  const q = s.ctx, d = s.dpr, w0 = s.W * 0.56, x0 = 34 * d, y0 = 20 * d, w = w0 - x0 - 10 * d, h = s.H - y0 - 30 * d;
  const sm = sim.sampleAt(S.cx, S.cy), mk = P.MAT[sm.mat].rho ? sm.mat : 'Si';
  let ymax = 0;
  for (const k of P.ION_KEYS) for (let a = 0; a <= 88; a += 2) ymax = Math.max(ymax, P.sputter(k, mk, S.ikV, a * P.DEG).Y);
  ymax = Math.ceil(ymax * 1.1);
  const X = (a) => x0 + (a / 90) * w, Y = (v) => y0 + h - (v / ymax) * h;
  axes(q, x0, y0, w, h, d, [0, 30, 60, 90].map((a) => [`${a}°`, X(a)]), [0, ymax / 2, ymax].map((v) => [v.toFixed(v < 10 ? 1 : 0), Y(v)]));
  for (const k of P.ION_KEYS) {
    q.beginPath();
    for (let a = 0; a <= 89; a++) { const v = P.sputter(k, mk, S.ikV, a * P.DEG).Y; a ? q.lineTo(X(a), Y(v)) : q.moveTo(X(a), Y(v)); }
    q.strokeStyle = P.ION[k].color; q.lineWidth = (k === S.ion ? 2.4 : 1) * d; q.globalAlpha = k === S.ion ? 1 : 0.55; q.stroke(); q.globalAlpha = 1;
    label(q, P.ION[k].name, X(89), Y(P.sputter(k, mk, S.ikV, 75 * P.DEG).Y), d, { color: P.ION[k].color, size: 8.5, align: 'right' });
  }
  label(q, `sputter yield (atoms/ion) vs incidence · ${P.MAT[mk].name} · ${S.ikV} keV`, x0, 9 * d, d, { color: C.muted, size: 9 });
  // probe size vs current for this column, with the aperture strip
  const px0 = w0 + 30 * d, pw = s.W - px0 - 12 * d, L = P.ION[S.ion].currents, dmax = P.ionProbe(S.ion, L[L.length - 1], S.ikV).d, dmin = P.ionProbe(S.ion, L[0], S.ikV).d;
  const PX = (I) => px0 + (Math.log(I / L[0]) / Math.log(L[L.length - 1] / L[0])) * pw, PY = (v) => y0 + h - (Math.log(v / (dmin * 0.8)) / Math.log((dmax * 1.2) / (dmin * 0.8))) * h;
  axes(q, px0, y0, pw, h, d, [L[0], L[Math.floor(L.length / 2)], L[L.length - 1]].map((I) => [fmtI(I).replace(' ', ''), PX(I)]), [dmin, dmax].map((v) => [v >= 1000 ? `${(v / 1000).toFixed(1)}µm` : `${v.toFixed(0)}nm`, PY(v)]));
  q.beginPath(); L.forEach((I, i) => { const v = P.ionProbe(S.ion, I, S.ikV).d; i ? q.lineTo(PX(I), PY(v)) : q.moveTo(PX(I), PY(v)); });
  q.strokeStyle = ionCol(S); q.lineWidth = 1.6 * d; q.stroke();
  for (const I of L) { const v = P.ionProbe(S.ion, I, S.ikV).d, on = I === P.nearestCurrent(S.ion, S.icur); q.fillStyle = on ? '#fff' : ionCol(S); q.beginPath(); q.arc(PX(I), PY(v), (on ? 4 : 2) * d, 0, 7); q.fill(); }
  const pr = sim.iprobe;
  label(q, `probe vs current (aperture strip) · ${fmtI(S.icur)} → ${pr.d >= 1000 ? `${(pr.d / 1000).toFixed(2)} µm` : `${pr.d.toFixed(1)} nm`}`, px0, 9 * d, d, { color: C.muted, size: 9 });
}

// ------------------------------------------------------------------ milling and deposition
function drawMill(sim, S, m, s) {
  const I = sim.ionImg, { ctx, W, H, dpr } = m;
  if (!I) return;
  paintImage(ctx, I, S, W, H, 1, false, true);
  layout.ionView = { W: W / dpr, H: H / dpr, theta: sim.thetaI() };
  drawPatternMarks(ctx, sim, S, W, H, dpr, sim.thetaI(), 1);
  const dr = layout.drag;
  if (dr) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.strokeRect(dr.x0 * dpr, dr.y0 * dpr, (dr.x1 - dr.x0) * dpr, (dr.y1 - dr.y0) * dpr); ctx.setLineDash([]); }
  scaleBar(ctx, W, H, S.fov, dpr);
  const a = sim.mill.active;
  label(ctx, `ion view · ${P.ION[S.ion].name} ${S.ikV} kV · ${fmtI(S.icur)} · tilt ${S.tilt}°${S.mode === 'gis' ? ` · ${P.DEP_GAS[S.depGas].name}` : S.gas !== 'none' ? ` · ${S.gas}` : ''}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  if (a) label(ctx, `${a.kind === 'dep' ? 'DEPOSITING' : 'MILLING'} #${a.id} · ${Math.round(a.done * 100)} % · ${(a.t / 60).toFixed(1)} / ${(a.tEst / 60).toFixed(1)} min${sim.millAccel > 1.5 ? ` · ×${Math.round(sim.millAccel)}` : ''}`, 8 * dpr, 16 * dpr, dpr, { color: C.warm });
  else if (!layout.quiet && S.mode !== 'cryo' && !sim.mill.patterns.some((p) => p.kind !== 'img')) label(ctx, 'drag on the image to draw a pattern', W / 2, H / 2, dpr, { color: C.text, align: 'center' });
  else if (sim.mill.queued.length) label(ctx, `${sim.mill.queued.length} pattern(s) queued: press Start`, 8 * dpr, 16 * dpr, dpr, { color: C.accent });
  // secondary: the electron image of the same place, and a profile through the pattern
  const q = s.ctx, d = s.dpr, sz = Math.min(s.H, s.W * 0.56);
  if (sim.sec) {
    paint(q, sim.sec.arr, sim.sec.n, sim.sec.n, [0, 0, sz, sz], { ...rangeLH(sim.sec.arr), lut: real(S) ? LUT.gray : LUT.sem });
    label(q, `SEM ${S.kV} kV · ${S.tilt}° view`, 6 * d, sz - 12 * d, d, { color: C.muted, size: 8.5 });
  }
  if (S.mode === 'gis') drawDepCurve(sim, S, q, sz + 12 * d, d, s.W - sz - 20 * d, s.H);
  else if (S.mode === 'cryo') drawCryoStatus(sim, S, q, sz + 12 * d, d);
  else drawProfile(sim, S, q, sz + 12 * d, d, s.W - sz - 20 * d, s.H);
}
const rangeLH = (a) => { const [lo, hi] = range(a, 0.004, 0.996); return { lo, hi }; };
// side profile through the last mill pattern (along y, at its centre x), over the materials it cut through
function drawProfile(sim, S, q, x0, d, w, Hc) {
  const p = sim.mill.active ?? [...sim.mill.patterns].reverse().find((r) => r.kind === 'mill');
  const y0 = 22 * d, h = Hc - y0 - 28 * d;
  label(q, 'profile through the pattern (side view)', x0, 9 * d, d, { color: C.muted, size: 9 });
  if (!p) return;
  const ya = p.y - p.h * 0.85, yb = p.y + p.h * 0.85, prof = sim.mill.profile(p.x, ya, p.x, yb, 120);
  const zmin = Math.min(-0.5, ...prof) * 1.15, zmax = Math.max(0.3, ...prof) + 0.2;
  const X = (i) => x0 + (i / 119) * w, Z = (z) => y0 + ((zmax - z) / (zmax - zmin)) * h;
  // materials below the original surface along the line (coloured bands)
  const sp = sim.spec, cols = 60, rows = 40;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const yy = ya + ((i + 0.5) / cols) * (yb - ya), zz = zmax - ((j + 0.5) / rows) * (zmax - zmin), top = sp.top(p.x, yy);
    if (zz > top) continue;
    const mt = P.MAT[sp.vol(p.x, yy, zz).mat];
    q.fillStyle = mt.color ?? '#333'; q.globalAlpha = 0.35;
    q.fillRect(x0 + (i / cols) * w, y0 + (j / rows) * h, w / cols + 1, h / rows + 1);
  }
  q.globalAlpha = 1;
  // what was removed: dark
  q.beginPath(); q.moveTo(X(0), Z(zmax));
  prof.forEach((z, i) => q.lineTo(X(i), Z(z)));
  q.lineTo(X(119), Z(zmax)); q.closePath(); q.fillStyle = 'rgba(6,8,11,0.92)'; q.fill();
  q.beginPath(); prof.forEach((z, i) => (i ? q.lineTo(X(i), Z(z)) : q.moveTo(X(i), Z(z)))); q.strokeStyle = C.accent; q.lineWidth = 1.6 * d; q.stroke();
  const md = sim.mill.measure(p);
  label(q, `#${p.id} ${SHAPES[p.shape]} · deepest ${md.maxDepth.toFixed(2)} µm (asked ${p.depth} µm in Si)`, x0, Hc - 12 * d, d, { color: C.accent, size: 8.5 });
  label(q, `${md.Yv.toFixed(3)} µm³/nC measured · Si file ${p.Yref.toFixed(3)}`, x0, Hc - 28 * d, d, { color: C.muted, size: 8.5 });
}
// net deposition rate vs current density: reaction-limited, precursor-limited, milling
function drawDepCurve(sim, S, q, x0, d, w, Hc) {
  const y0 = 22 * d, h = Hc - y0 - 30 * d, beam = S.depBeam, kV = beam === 'e' ? S.kV : S.ikV;
  const J0 = beam === 'e' ? 1 : 0.05, J1 = beam === 'e' ? 1e4 : 500;
  const X = (J) => x0 + (Math.log(J / J0) / Math.log(J1 / J0)) * w;
  let ymax = 0, ymin = 0;
  const pts = [];
  for (let i = 0; i <= 120; i++) { const J = J0 * Math.pow(J1 / J0, i / 120), r = P.depositRate(S.depGas, beam, S.ion, kV, J); pts.push([J, r.net]); ymax = Math.max(ymax, r.net); ymin = Math.min(ymin, r.net); }
  ymax *= 1.15; ymin = Math.min(ymin * 1.2, -0.08 * ymax);
  const Y = (v) => y0 + ((ymax - v) / (ymax - ymin)) * h;
  axes(q, x0, y0, w, h, d, [J0, Math.sqrt(J0 * J1), J1].map((J) => [J >= 1 ? J.toFixed(0) : J.toFixed(2), X(J)]), [ymin, 0, ymax].map((v) => [v.toFixed(2), Y(v)]));
  q.strokeStyle = 'rgba(255,255,255,0.25)'; q.beginPath(); q.moveTo(x0, Y(0)); q.lineTo(x0 + w, Y(0)); q.stroke();
  q.beginPath(); pts.forEach(([J, v], i) => (i ? q.lineTo(X(J), Y(v)) : q.moveTo(X(J), Y(v)))); q.strokeStyle = '#ffd678'; q.lineWidth = 2 * d; q.stroke();
  const Jnow = (beam === 'e' ? S.current : S.icur) / Math.max(1e-3, S.patW * S.patH), r = P.depositRate(S.depGas, beam, S.ion, kV, Jnow);
  q.fillStyle = '#fff'; q.beginPath(); q.arc(X(Math.min(J1, Math.max(J0, Jnow))), Y(r.net), 4 * d, 0, 7); q.fill();
  label(q, `net deposit (µm³/nC) vs current density (pA/µm²)`, x0, 9 * d, d, { color: C.muted, size: 9 });
  label(q, `${Jnow.toFixed(2)} pA/µm² → ${r.net.toFixed(2)} µm³/nC${r.net < 0 ? ': milling!' : ''}`, x0 + w, y0 + 10 * d, d, { color: r.net < 0 ? C.warm : C.text, size: 9, align: 'right' });
  label(q, 'reaction-limited', X(J0 * 3), Y(ymax * 0.2), d, { color: C.muted, size: 8 });
  label(q, 'precursor-limited', X(Math.sqrt(J0 * J1) * 1.5), Y(ymax * 0.55), d, { color: C.muted, size: 8 });
}

// ------------------------------------------------------------------ lamella
function drawLam(sim, S, m, s) {
  const L = sim.lam, hide = !!S.mis?.hideTruth;
  if (L.step < 6) {
    drawMill(sim, S, m, s);
    label(m.ctx, `Step ${L.step + 1}/8 · ${LAM_STEPS[L.step].title}${L.busy ? ' · running' : ''}`, 8 * m.dpr, 36 * m.dpr, m.dpr, { color: C.accent });
    return;
  }
  // on the grid: the ion view from above (the lamella welded to the side of a copper post), and the SEM view of the face
  const { ctx, W, H, dpr } = m;
  ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.46, sc = Math.min(W, H) / 26; // px per µm
  // grid post: a copper finger seen from above, with milling marks
  const pg = ctx.createLinearGradient(0, cy, 0, cy + 10 * sc); pg.addColorStop(0, '#9a6a3c'); pg.addColorStop(1, '#4a3420');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.moveTo(cx - 12 * sc, cy + 10 * sc); ctx.lineTo(cx - 12 * sc, cy + 1.2 * sc); ctx.lineTo(cx - 7 * sc, cy + 1.2 * sc); ctx.lineTo(cx - 7 * sc, cy + 10 * sc); ctx.closePath(); ctx.fill();
  // Pt welds
  ctx.fillStyle = '#e8e0cc'; ctx.fillRect(cx - 7.4 * sc, cy - 1.0 * sc, 1.6 * sc, 2.4 * sc);
  // the lamella: thickness drawn ×8; the thinned window narrower and brighter where thin (ions see the top edge)
  const ex = 2.5, tThick = (1000 / 1000) * sc * ex, tWin = Math.max(1.2 * dpr, (L.t_top / 1000) * sc * ex);
  ctx.fillStyle = '#8f99a6'; ctx.fillRect(cx - 6 * sc, cy - tThick / 2, 12 * sc, tThick);
  ctx.fillStyle = L.hole ? '#2a0e0e' : `rgb(${Math.round(150 + 60 * Math.exp(-L.t_top / 200))},${Math.round(160 + 60 * Math.exp(-L.t_top / 200))},${Math.round(175 + 60 * Math.exp(-L.t_top / 200))})`;
  const bend = L.bent ? 0.4 * sc : 0;
  ctx.beginPath(); ctx.moveTo(cx - 4 * sc, cy - tWin / 2); ctx.quadraticCurveTo(cx, cy - tWin / 2 + bend, cx + 4 * sc, cy - tWin / 2); ctx.lineTo(cx + 4 * sc, cy + tWin / 2); ctx.quadraticCurveTo(cx, cy + tWin / 2 + bend, cx - 4 * sc, cy + tWin / 2); ctx.closePath(); ctx.fill();
  // Pt cap remnant on the top edge
  if (L.capLeft > 0.05) { ctx.fillStyle = 'rgba(240,234,219,0.55)'; ctx.fillRect(cx - 6 * sc, cy - Math.min(tThick, tWin) / 2 - 1, 12 * sc, 2); }
  // thinning windows either side
  ctx.strokeStyle = 'rgba(111,214,255,0.55)'; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(cx - 4 * sc, cy - 3 * sc, 8 * sc, 3 * sc - tWin / 2); ctx.strokeRect(cx - 4 * sc, cy + tWin / 2, 8 * sc, 3 * sc - tWin / 2); ctx.setLineDash([]);
  label(ctx, 'thinning windows', cx, cy - 3.5 * sc, dpr, { color: C.accent, size: 8.5, align: 'center' });
  label(ctx, 'grid post', cx - 9.5 * sc, cy + 6 * sc, dpr, { color: '#d9b27c', size: 8.5, align: 'center' });
  label(ctx, `ion view from above (thickness ×${ex}) · ${P.ION[S.ion].name}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  label(ctx, `Step ${Math.min(8, L.step + 1)}/8 · ${LAM_STEPS[Math.min(7, L.step)].title}`, 8 * dpr, 16 * dpr, dpr, { color: C.accent });
  if (!hide) label(ctx, `${Math.round(L.t_top)} nm at the top · ${Math.round(lamThickness(L, 3))} nm 3 µm down${L.bent ? ' · BENT' : ''}${L.hole ? ' · HOLE' : ''}`, 8 * dpr, 36 * dpr, dpr, { color: L.bent || L.hole ? C.warm : C.text, size: 9 });
  // the face at the SEM's voltage: thin regions transmit electrons and brighten
  const q = s.ctx, d = s.dpr, fw = Math.min(s.W * (hide ? 1 : 0.6), s.H * 1.6), fh = Math.min(s.H, fw / 1.6);
  const n = 160, nz = 100, arr = new Float32Array(n * nz), R = P.rangeKO(P.MAT.Si, S.kV) * 1000, xs = P.SPECIMENS.xs;
  for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
    const x = -6 + (12 * (i + 0.5)) / n, yv = 5.2 - (7.5 * (j + 0.5)) / nz, mk = xs.vol(x, yv).mat, mt = P.MAT[mk];
    if (mk === 'vac') { arr[j * n + i] = 0; continue; }
    const z = Math.max(0, 5.2 - yv), inWin = Math.abs(x) < 4 && z < 5;
    let t = inWin ? lamThickness(L, z) : 2500;
    if (L.bent && inWin) t *= 1 + 0.25 * Math.sin((x / 4) * Math.PI);
    if (inWin && L.hole && z < 1.2 && Math.abs(x) < 1.5) { arr[j * n + i] = 0; continue; }
    const T = Math.exp(-t / (0.35 * R));
    let v = (P.delta(mt, S.kV) * 0.5 + P.eta(mt.Z)) * (1 + 1.6 * T);
    if (inWin) v *= 1 + L.curtain * 0.3 * (P.vnoise(x * 9, 0.5, 77) - 0.5);
    arr[j * n + i] = v;
  }
  paint(q, arr, n, nz, [0, 0, fw, fh], { lo: 0, hi: Math.max(...arr) * 0.95, lut: real(S) ? LUT.gray : LUT.sem, noise: real(S) ? 40 : 0 });
  label(q, `SEM ${S.kV} kV · the lamella face`, 6 * d, fh - 12 * d, d, { color: C.muted, size: 8.5 });
  if (hide) return;
  // thickness profile: the wedge, the amorphous layers and the target
  const x0 = fw + 18 * d, w = s.W - x0 - 10 * d, y0 = 22 * d, h = s.H - y0 - 30 * d, tMax = Math.max(400, lamThickness(L, 5) * 1.1);
  const X = (t) => x0 + w / 2 + ((t / 2) / tMax) * w, Z = (z) => y0 + (z / 5) * h;
  q.fillStyle = 'rgba(154,166,181,0.6)'; q.beginPath();
  for (let z = 0; z <= 5; z += 0.25) q.lineTo(X(lamThickness(L, z)), Z(z));
  for (let z = 5; z >= 0; z -= 0.25) q.lineTo(X(-lamThickness(L, z)), Z(z));
  q.closePath(); q.fill();
  q.fillStyle = 'rgba(255,125,125,0.55)';
  for (const sgn of [1, -1]) { q.beginPath(); for (let z = 0; z <= 5; z += 0.25) q.lineTo(X(sgn * lamThickness(L, z)), Z(z)); for (let z = 5; z >= 0; z -= 0.25) q.lineTo(X(sgn * (lamThickness(L, z) - 2 * L.amorph[sgn > 0 ? 0 : 1])), Z(z)); q.closePath(); q.fill(); }
  q.setLineDash([3 * d, 3 * d]); q.strokeStyle = C.green; q.beginPath(); q.moveTo(X(100), y0); q.lineTo(X(100), y0 + h); q.moveTo(X(-100), y0); q.lineTo(X(-100), y0 + h); q.stroke(); q.setLineDash([]);
  label(q, 'thickness vs depth (red: amorphous)', x0, 9 * d, d, { color: C.muted, size: 9 });
  label(q, '100 nm', X(100) + 3 * d, y0 + h - 8 * d, d, { color: C.green, size: 8 });
  const qq = lamQuality(L);
  label(q, `crystal ${qq.crystalline} nm · Ga ${qq.ga}%`, x0, s.H - 12 * d, d, { color: C.text, size: 8.5 });
}

// ------------------------------------------------------------------ cryo lamella
// the state of the frozen specimen while the site is prepared
function drawCryoStatus(sim, S, q, x0, d) {
  const Cq = sim.cryo, T = S.cryoT, rows = [
    ['Stage', `${Math.round(T)} °C`, T > -137 ? C.warm : C.green],
    ['Ice', T > -137 ? 'devitrifying' : `vitreous · ${Math.round(Cq.devit * 100)} % crystalline`, Cq.devit > 0.05 ? C.warm : C.green],
    ['Sputtered Pt', Cq.coat ? `${Math.round(Cq.coat)} nm` : 'none: ice charges above 1.6 kV', Cq.coat ? C.green : C.warm],
    ['Cold GIS layer', Cq.gis ? `${Cq.gis.toFixed(1)} µm organometallic Pt` : 'none yet', Cq.gis ? C.green : C.muted],
    ['Milling angle', Cq.angle ? `${Cq.angle}° · lamella ~${cryoLength(Cq).toFixed(0)} µm long` : `planned ${S.cryoAngle}°`, C.text],
    ['Anticontaminator', S.anticontam ? 'in' : 'out: contamination ×10', S.anticontam ? C.green : C.warm],
  ];
  label(q, 'the frozen specimen', x0, 9 * d, d, { color: C.muted, size: 9 });
  rows.forEach(([k, v, col], i) => { label(q, k, x0, (32 + i * 30) * d, d, { color: C.muted, size: 8.5 }); label(q, v, x0, (46 + i * 30) * d, d, { color: col, size: 9 }); });
}
function drawCryo(sim, S, m, s) {
  const Cq = sim.cryo, hide = !!S.mis?.hideTruth, { ctx, W, H, dpr } = m, step = Math.min(7, Cq.step);
  const head = `Step ${step + 1}/8 · ${CRYO_STEPS[step].title}${Cq.done ? ' · done' : ''} · stage ${Math.round(S.cryoT)} °C`;
  if (Cq.step < 3) {
    // preparing the site: the real ion image of the clump (charging until it is sputter coated), and the SEM view
    drawMill(sim, S, m, s);
    const sc = W / S.fov, bw = 12 * sc, bh = 2.4 * sc;
    ctx.strokeStyle = 'rgba(111,214,255,0.8)'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = 1.2 * dpr;
    ctx.strokeRect(W / 2 - bw / 2, H / 2 - bh / 2, bw, bh); ctx.setLineDash([]);
    label(ctx, 'lamella site', W / 2, H / 2 - bh / 2 - 10 * dpr, dpr, { color: C.accent, size: 8.5, align: 'center' });
    label(ctx, head, 8 * dpr, 36 * dpr, dpr, { color: C.accent });
    return;
  }
  // the ion view at the milling angle: the frozen cells foreshortened into a long mound of ice, milled from both
  // sides; the lamella is the bright slab left between the two dark trenches (thickness drawn ×4)
  const sc = Math.min(W / 30, H / 18), len = cryoLength(Cq), ex = 4, q0 = cryoQuality(Cq), sp = P.SPECIMENS.cell;
  const tPx = (t) => Math.max(1.2 * dpr, (t / 1000) * sc * ex), milled = Cq.step >= 4 && Cq.t < Cq.t0;
  const slab = tPx(Cq.t) / sc, boxH = milled ? Math.min(5.5, (tPx(Cq.t0 - Cq.t) / 2) / sc + 1.2) : 0; // µm on screen
  const n = 300, nz = Math.round((n * H) / W), U = W / sc / 2, V = H / sc / 2, arr = new Float32Array(n * nz);
  const ise = P.iseYield(S.ion, 'Ice', S.ikV), sn = Math.sin(Math.max(4, Cq.angle) * P.DEG);
  for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
    const u = -U + (2 * U * (i + 0.5)) / n, v = V - (2 * V * (j + 0.5)) / nz, e = (u / 13) ** 2 + (v / 6.2) ** 2;
    const bend = Cq.bent ? 0.6 * (1 - (u / 6) ** 2) : 0, inW = Math.abs(u) < 6, dv = Math.abs(v - bend);
    let val;
    if (Cq.relief && Math.abs(Math.abs(u) - 9) < 0.25 && Math.abs(v) < 4) val = 0.03;
    else if (inW && milled && dv < slab / 2) val = Cq.lost ? 0.03 : 0.95 * ise * (0.9 + 0.2 * P.vnoise(u * 3, v * 9, 5));
    else if (inW && milled && dv < slab / 2 + boxH && e < 1.15) {
      // looking down a trench: dark, a little light from its floor, curtains streaking down the faces
      const f = (dv - slab / 2) / boxH;
      val = ise * (0.06 + 0.16 * f + Cq.curtain * 0.25 * (P.vnoise(u * 5, 0.5, 77) - 0.4) * (1 - f));
    } else if (e < 1) {
      // the mound's surface, lit by the ion-induced electrons; the cells underneath raise it in bumps
      const h = sp.top(u, -v / sn * 0.25, 0.1), hx = sp.top(u + 0.3, -v / sn * 0.25, 0.1) - h;
      val = ise * (0.75 + 0.35 * (1 - e) + 0.6 * hx + 0.08 * P.vnoise(u * 2, v * 4, 3)) * (Cq.gis > 0 ? 1.12 : 1);
      if (Cq.gis > 0 && e > 0.955 && v > 0) val += ise * 0.6 * Math.min(1, Cq.gisLeft + 0.2); // the Pt layer catches the beam at the edge
    } else {
      // the grid film far below, in the mound's shadow near it
      val = ise * (0.2 + 0.05 * P.vnoise(u * 0.7, v * 2, 8)) * clamp(0.5 + 0.5 * (e - 1), 0.5, 1);
    }
    arr[j * n + i] = val;
  }
  paint(ctx, arr, n, nz, [0, 0, W, H], { lo: 0, hi: ise * 1.25, lut: real(S) ? LUT.gray : LUT.ion, noise: real(S) ? Math.max(3, S.icur * 0.6) : 0 });
  const cx = W / 2, cy = H / 2;
  if (Cq.lost) label(ctx, 'the lamella broke off', cx, cy, dpr, { color: C.warm, align: 'center' });
  if (Cq.step >= 4) {
    ctx.strokeStyle = 'rgba(111,214,255,0.55)'; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.lineWidth = 1 * dpr;
    const tb = tPx(S.cryoTarget);
    ctx.strokeRect(cx - 6 * sc, cy - tb / 2 - 4 * sc, 12 * sc, 4 * sc); ctx.strokeRect(cx - 6 * sc, cy + tb / 2, 12 * sc, 4 * sc); ctx.setLineDash([]);
    label(ctx, `next pass: ${fmtI(S.cryoI)} to ${Math.round(S.cryoTarget)} nm`, cx, cy - tb / 2 - 4.8 * sc, dpr, { color: C.accent, size: 8.5, align: 'center' });
  }
  label(ctx, `ion view at ${Cq.angle}° to the grid (thickness ×${ex}) · ${P.ION[S.ion].name} ${S.ikV} kV · lamella ${len.toFixed(0)} µm long`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  label(ctx, head, 8 * dpr, 16 * dpr, dpr, { color: C.accent });
  if (!hide) label(ctx, `${q0.t} nm${q0.contam_nm >= 1 ? ` + ${q0.contam_nm} nm ice contamination per face` : ''}${Cq.devit > 0.02 ? ` · ${q0.devit_pct} % devitrified` : ''}${Cq.bent ? ' · BENT' : ''}${Cq.hole ? ' · HOLE' : ''}`, 8 * dpr, 36 * dpr, dpr, { color: Cq.bent || Cq.lost || Cq.devit > 0.15 ? C.warm : C.text, size: 9 });

  // secondary: the SEM looking down on the lamella (thin ice brightens at low kV; crystalline patches speckle)
  const q = s.ctx, d = s.dpr, fw = Math.min(s.W * (hide ? 1 : 0.55), s.H * 1.5), fh = Math.min(s.H, fw / 1.5);
  const sn2 = 150, snz = 100, sarr = new Float32Array(sn2 * snz), Rk = P.rangeKO(P.MAT.Ice, S.kV) * 1000;
  for (let j = 0; j < snz; j++) for (let i = 0; i < sn2; i++) {
    const x = -9 + (18 * (i + 0.5)) / sn2, y = -6 + (12 * (j + 0.5)) / snz, inLam = Math.abs(x) < 6 && Math.abs(y) < 3.2, inBox = Math.abs(x) < 6 && Math.abs(y) < 5;
    let v;
    if (Cq.step >= 4 && inBox && !inLam) v = 0.04; // the milled-away trenches either side of the slab (seen through)
    else if (inLam && Cq.step >= 4) {
      if (Cq.lost) { v = 0.02; sarr[j * sn2 + i] = v; continue; }
      const z = (y + 3.2) / 6.4, t = Cq.t + 2 * z * 3000 * Math.tan(Cq.wedge * P.DEG) * 0.5 + 2 * Cq.contam;
      if (Cq.hole && Math.abs(x) < 1.2 && z < 0.25) { sarr[j * sn2 + i] = 0.02; continue; }
      // what the slab cuts through: the cells along the lamella plane, tilted at the milling angle
      const uu = (y / 3.2) * (cryoLength(Cq) / 2), mk = P.SPECIMENS.cell.vol(x * 0.6, uu * Math.cos(Cq.angle * P.DEG), 2.1 + uu * Math.sin(Cq.angle * P.DEG)).mat;
      const lv = mk === 'vac' ? 0.5 : (P.delta(P.MAT[mk], S.kV) * 0.6 + P.eta(P.MAT[mk].Z) * 0.6) / 0.3;
      v = (0.35 + 0.9 * Math.exp(-t / (0.5 * Rk))) * (0.55 + 0.45 * lv);
      if (!S.coated && !Cq.coatFinal && S.kV > 1.6) v += 0.5 * P.vnoise(x * 0.8, y * 3, 9); // charging streaks
      v *= 1 + Cq.curtain * 0.35 * (P.vnoise(x * 6, 0.5, 77) - 0.5);
      if (Cq.devit > 0.02 && P.hash(i >> 1, j >> 1, 41) < Cq.devit) v *= 1.6; // crystalline ice diffracts: bright specks
    } else {
      v = 0.3 + 0.12 * P.vnoise(x * 0.6, y * 0.6, 3) + (Math.abs(x) < 6.5 && Math.abs(y) < 7 && Cq.gis > 0 ? 0.08 : 0);
      if (Cq.relief && Math.abs(Math.abs(x) - 8) < 0.3 && Math.abs(y) < 4) v = 0.04;
    }
    if (Cq.contam > 0.5 && P.hash(i, j, 61) < Math.min(0.08, Cq.contam / 300)) v *= 0.55; // contamination specks
    sarr[j * sn2 + i] = v;
  }
  paint(q, sarr, sn2, snz, [0, 0, fw, fh], { lo: 0, hi: 1.4, lut: real(S) ? LUT.gray : LUT.sem, noise: real(S) ? 40 : 0 });
  label(q, `SEM ${S.kV} kV · the lamella from above`, 6 * d, fh - 12 * d, d, { color: C.muted, size: 8.5 });
  if (hide) return;
  // side profile: Pt layer, slab with damaged faces (red) and contamination (blue), the target window for cryo-ET
  const x0 = fw + 16 * d, w = s.W - x0 - 10 * d, y0 = 22 * d, h = s.H - y0 - 34 * d, tMax = Math.max(500, Cq.t * 1.15);
  const X = (t) => x0 + w / 2 + (t / 2 / tMax) * w, Z = (z) => y0 + z * h;
  const tz = (z) => Cq.t + 2 * z * 3000 * Math.tan(Cq.wedge * P.DEG) * 0.5;
  q.fillStyle = 'rgba(95,227,168,0.12)'; q.fillRect(X(-250), y0, X(250) - X(-250), h);
  // integer steps, so both edges reach z = 0 and z = 1 exactly
  const Zs = Array.from({ length: 21 }, (_, i) => i / 20), Zr = [...Zs].reverse();
  q.fillStyle = 'rgba(154,166,181,0.6)'; q.beginPath();
  for (const z of Zs) q.lineTo(X(tz(z)), Z(z));
  for (const z of Zr) q.lineTo(X(-tz(z)), Z(z));
  q.closePath(); q.fill();
  q.fillStyle = 'rgba(255,125,125,0.55)';
  for (const [sg, dm] of [[1, Cq.damage[0]], [-1, Cq.damage[1]]]) { q.beginPath(); for (const z of Zs) q.lineTo(X(sg * tz(z)), Z(z)); for (const z of Zr) q.lineTo(X(sg * (tz(z) - 2 * dm)), Z(z)); q.closePath(); q.fill(); }
  if (Cq.contam > 0.3) { q.fillStyle = 'rgba(111,214,255,0.7)'; for (const sg of [1, -1]) q.fillRect(sg > 0 ? X(Cq.t) : X(-Cq.t) - Math.max(1, (Cq.contam / tMax) * w), y0, Math.max(1, (Cq.contam / tMax) * w), h); }
  if (Cq.gisLeft > 0.02) { q.fillStyle = 'rgba(240,226,190,0.8)'; q.fillRect(X(-Cq.t), y0 - Math.min(14 * d, Cq.gisLeft * 10 * d), X(Cq.t) - X(-Cq.t), Math.min(14 * d, Cq.gisLeft * 10 * d)); }
  label(q, 'thickness through the lamella (red: damage, blue: contamination)', x0, 9 * d, d, { color: C.muted, size: 8.5 });
  label(q, '150–250 nm', X(250) + 3 * d, y0 + h - 8 * d, d, { color: C.green, size: 8 });
  label(q, `${q0.verdict} · t/λ ${q0.t_lambda} · ${q0.intact} nm undamaged · ${q0.time_min} min`, x0, s.H - 12 * d, d, { color: C.text, size: 8.5 });
}

// ------------------------------------------------------------------ slice & view
function drawSV(sim, S, m, s) {
  const sv = sim.sv, { ctx, W, H, dpr } = m;
  if (!sv || !sv.k) { label(ctx, 'milling the first slice…', W / 2, H / 2, dpr, { color: C.text, align: 'center' }); return; }
  if (S.svView === '3d' && layout.recon) return drawSV3D(sim, S, m, s);
  const k = sv.k - 1, img = sv.stack[k], fh = S.svTiltCorr ? H * (sv.Hz / sv.W) : H * (sv.Hz / sv.W) * Math.sin(P.ION_TILT * P.DEG);
  const lh = rangeLH(img);
  paint(ctx, img, sv.nx, sv.nz, [0, (H - fh) / 2, W, fh], { ...lh, lut: real(S) ? LUT.gray : LUT.sem });
  scaleBar(ctx, W, (H + fh) / 2 + 18 * dpr, sv.W, dpr);
  label(ctx, `slice ${sv.k}/${S.svN} · y = ${(sv.y0 + k * sv.s).toFixed(2)} µm · ${S.svDet.toUpperCase()} ${S.kV} kV${S.svTiltCorr ? ' · tilt-corrected' : ' · foreshortened ×sin 52°'}`, 8 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
  label(ctx, `instrument time ${(sv.t / 60).toFixed(1)} min${sv.done ? ' · done' : ''}`, 8 * dpr, 36 * dpr, dpr, { color: C.muted, size: 9 });
  // orthoslices
  const q = s.ctx, d = s.dpr, gap = 10 * d, pw = (s.W - 3 * gap) * 0.38, ph = s.H - 50 * d;
  const jz = Math.min(sv.nz - 1, Math.floor(S.svZ * sv.nz)), ix = Math.min(sv.nx - 1, Math.floor(S.svX * sv.nx));
  const xy = new Float32Array(sv.nx * sv.k), yz = new Float32Array(sv.nz * sv.k);
  for (let t = 0; t < sv.k; t++) { for (let i = 0; i < sv.nx; i++) xy[t * sv.nx + i] = sv.stack[t][jz * sv.nx + i]; for (let j = 0; j < sv.nz; j++) yz[j * sv.k + t] = sv.stack[t][j * sv.nx + ix]; }
  // the stack is shown stretched along y (slices) to fill the panels; the true voxel is labelled
  const ph2 = (ph - 18 * d) / 2, pw2 = pw * 2 + gap;
  paint(q, xy, sv.nx, sv.k, [gap, 22 * d, pw2, ph2], { ...lh, lut: real(S) ? LUT.gray : LUT.sem });
  label(q, `XY at depth ${(S.svZ * sv.Hz).toFixed(1)} µm · rows = ${sv.k} slices (${(sv.k * sv.s).toFixed(1)} µm, stretched)`, gap, 10 * d, d, { color: C.muted, size: 8.5 });
  paint(q, yz, sv.k, sv.nz, [gap, 40 * d + ph2, pw2, ph2], { ...lh, lut: real(S) ? LUT.gray : LUT.sem });
  label(q, `YZ at x = ${(S.svX * sv.W).toFixed(1)} µm · columns = slices`, gap, 28 * d + ph2, d, { color: C.muted, size: 8.5 });
  drawFractions(sim, q, 3 * gap + 2 * pw, s.W - gap, d, s.H);
}
// the 3D reconstruction (main view) with the current face and the phase fractions beside it
function drawSV3D(sim, S, m, s) {
  const sv = sim.sv, { ctx, W, H, dpr } = m, rc = layout.recon;
  const cv = rc.render(sim, S, Math.round(W), Math.round(H), layout.reconDt ?? 0);
  layout.reconDt = 0;
  if (!cv) { label(ctx, 'the 3D view needs WebGL', W / 2, H / 2, dpr, { color: C.warm, align: 'center' }); return; }
  ctx.drawImage(cv, 0, 0, W, H);
  const f = sim.svFractions(), shown = S.svShow === 'both' ? `${f.names[1]} and ${f.names[2]}` : f.names[S.svShow === '1' ? 1 : 2];
  label(ctx, `3D reconstruction · ${sv.k} slices · ${shown} (segmented) · drag to rotate, scroll to zoom`, 8 * dpr, 16 * dpr, dpr, { color: C.accent, size: 9 });
  if (rc.dims) label(ctx, `block ${rc.dims.W.toFixed(1)} × ${rc.dims.H.toFixed(1)} × ${rc.dims.L.toFixed(1)} µm · voxel ${rc.dims.voxel.map((v) => Math.round(v * 1000)).join(' × ')} nm · ${rc.n.toLocaleString()} surface voxels${sv.done ? '' : ' · growing'}`, 8 * dpr, H - 14 * dpr, dpr, { color: C.muted, size: 9 });
  // secondary: the current face and the fractions
  const q = s.ctx, d = s.dpr, gap = 10 * d, fw = (s.W - 3 * gap) * 0.62, img = sv.stack[sv.k - 1], fh = Math.min(s.H - 40 * d, fw * (sv.Hz / sv.W));
  paint(q, img, sv.nx, sv.nz, [gap, 22 * d, fw, fh], { ...rangeLH(img), lut: real(S) ? LUT.gray : LUT.sem });
  label(q, `the current face · slice ${sv.k}/${S.svN} · ${S.svDet.toUpperCase()} ${S.kV} kV`, gap, 10 * d, d, { color: C.muted, size: 8.5 });
  label(q, `instrument time ${(sv.t / 60).toFixed(1)} min${sv.done ? ' · done' : ''}`, gap, 22 * d + fh + 14 * d, d, { color: C.muted, size: 8.5 });
  drawFractions(sim, q, 2 * gap + fw, s.W - gap, d, s.H);
}
function drawFractions(sim, q, bx, x1, d, Hc) {
  const f = sim.svFractions(), bw = x1 - bx, cols = ['#30363f', '#7c858f', '#9bb7e0'];
  if (f) f.names.forEach((nm, i) => {
    const y = 26 * d + i * 34 * d;
    label(q, nm, bx, y, d, { color: C.text, size: 8.5 });
    q.fillStyle = cols[i]; q.fillRect(bx, y + 8 * d, bw * f.measured[i], 7 * d);
    q.strokeStyle = C.warm; q.lineWidth = 1.5 * d; q.beginPath(); q.moveTo(bx + bw * f.truth[i], y + 6 * d); q.lineTo(bx + bw * f.truth[i], y + 17 * d); q.stroke();
    label(q, `${Math.round(f.measured[i] * 100)}% (true ${Math.round(f.truth[i] * 100)}%)`, bx + bw, y, d, { color: C.muted, size: 8, align: 'right' });
  });
  label(q, 'segmented vs true (orange)', bx, Hc - 12 * d, d, { color: C.muted, size: 8.5 });
}

// ------------------------------------------------------------------ ion collision cascade
function drawIonMC(sim, S, m, s) {
  const mc = sim.mc, { ctx, W, H, dpr } = m;
  const st = mc.stats(), R = Math.max(10, Math.max(st.Rp + 3 * st.dRp, mc.zMax * 0.8)) * 1.1;
  const oy = H * 0.18, sc = Math.min(W / (2.2 * R), (H - oy - 10 * dpr) / R), ox = W / 2;
  ctx.fillStyle = '#0b0f15'; ctx.fillRect(0, oy, W, H - oy);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  const ic = P.ION[S.ion].rgb.map((v) => Math.round(v * 255));
  for (const t of mc.traj) {
    for (const r of t.rec) {
      ctx.beginPath(); r.pts.forEach(([x, z], i) => (i ? ctx.lineTo(ox + x * sc, oy + z * sc) : ctx.moveTo(ox + x * sc, oy + z * sc)));
      ctx.strokeStyle = r.sp ? 'rgba(255,240,150,0.8)' : real(S) ? 'rgba(170,180,195,0.22)' : 'rgba(111,214,255,0.28)'; ctx.lineWidth = 0.7 * dpr; ctx.stroke();
      if (r.sp) { const e = r.pts[r.pts.length - 1]; ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(ox + e[0] * sc, oy - 3 * dpr, 2 * dpr, 0, 7); ctx.fill(); }
    }
    ctx.beginPath(); t.pts.forEach(([x, z], i) => (i ? ctx.lineTo(ox + x * sc, oy + z * sc) : ctx.moveTo(ox + x * sc, oy + z * sc)));
    ctx.strokeStyle = `rgba(${ic[0]},${ic[1]},${ic[2]},0.95)`; ctx.lineWidth = 1.4 * dpr; ctx.stroke();
    const e = t.pts[t.pts.length - 1]; ctx.fillStyle = `rgb(${ic})`; ctx.beginPath(); ctx.arc(ox + e[0] * sc, oy + e[1] * sc, 2.4 * dpr, 0, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const inc = Math.abs(S.tilt - P.ION_TILT) * P.DEG;
  ctx.strokeStyle = ionCol(S); ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(ox - Math.sin(inc) * oy * 0.9, oy - Math.cos(inc) * oy * 0.9); ctx.lineTo(ox, oy); ctx.stroke();
  ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,180,94,0.6)'; ctx.beginPath(); ctx.moveTo(0, oy + st.Rp * sc); ctx.lineTo(W, oy + st.Rp * sc); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, `projected range Rp ${st.Rp.toFixed(1)} ± ${st.dRp.toFixed(1)} nm`, 8 * dpr, oy + st.Rp * sc + 12 * dpr, dpr, { color: C.warm, size: 8.5 });
  label(ctx, `${P.ION[S.ion].name} ${mc.E0} keV → ${mc.m.name} · incidence ${Math.round(inc / P.DEG)}° · ${mc.n} ions`, 8 * dpr, 14 * dpr, dpr, { color: C.text, size: 9 });
  if (sim.mcNote) label(ctx, sim.mcNote, 8 * dpr, 54 * dpr, dpr, { color: C.warm, size: 9 });
  label(ctx, `sputter yield (MC) ${mc.Y.toFixed(2)} · table ${P.sputter(S.ion, mc.mKey, mc.E0, inc).Y.toFixed(2)} atoms/ion · ${mc.n ? Math.round(mc.vac / mc.n) : 0} displacements/ion`, 8 * dpr, 34 * dpr, dpr, { color: C.warm, size: 9 });
  const target = 2 * R * 0.25, e10 = Math.pow(10, Math.floor(Math.log10(target))), Lb = [1, 2, 5].map((k) => k * e10).filter((v) => v <= target).pop() || e10;
  ctx.fillStyle = '#fff'; ctx.fillRect(W - 12 * dpr - Lb * sc, H - 14 * dpr, Lb * sc, 3 * dpr);
  font(ctx, 10, dpr, 500); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(`${Lb} nm`, W - 12 * dpr - (Lb * sc) / 2, H - 17 * dpr); ctx.textAlign = 'left';
  // secondary: implantation and damage vs depth; energies of sputtered atoms
  const q = s.ctx, d = s.dpr, pw = (s.W - 30 * d) / 2, ph = s.H - 50 * d, bx = 14 * d, by = 22 * d, zmax = Math.max(st.Rp + 4 * st.dRp, 5);
  const bins = 40, hi = new Float32Array(bins), hv = new Float32Array(bins);
  for (const z of mc.implant) hi[Math.min(bins - 1, Math.floor((z / zmax) * bins))]++;
  for (const z of mc.vacZ) hv[Math.min(bins - 1, Math.floor((z / zmax) * bins))]++;
  const mxi = Math.max(1, ...hi), mxv = Math.max(1, ...hv);
  const plot = (arr, mx, col) => { q.beginPath(); arr.forEach((v, i) => { const x = bx + (v / mx) * pw, y = by + ((i + 0.5) / bins) * ph; i ? q.lineTo(x, y) : q.moveTo(x, y); }); q.strokeStyle = col; q.lineWidth = 1.8 * d; q.stroke(); };
  plot(hv, mxv, C.accent); plot(hi, mxi, ionCol(S));
  q.strokeStyle = C.grid; q.lineWidth = 1 * d; q.strokeRect(bx, by, pw, ph);
  label(q, 'depth ↓: implanted ions / displacements', bx, 10 * d, d, { color: C.muted, size: 9 });
  label(q, `${S.ion}`, bx + pw, by + 10 * d, d, { color: ionCol(S), size: 9, align: 'right' }); label(q, 'damage', bx + pw, by + 26 * d, d, { color: C.accent, size: 9, align: 'right' });
  font(q, 9, d); q.fillStyle = C.muted; q.fillText('0', bx - 2 * d, by + ph + 12 * d); q.fillText(`${zmax.toFixed(0)} nm`, bx + pw - 40 * d, by + ph + 12 * d);
  const ex = bx + pw + 16 * d, mxe = Math.max(1, ...mc.sputE);
  q.fillStyle = 'rgba(255,240,150,0.7)';
  mc.sputE.forEach((v, i) => { const hh = (v / mxe) * ph; q.fillRect(ex + (i / 40) * pw, by + ph - hh, pw / 40 - 1, hh); });
  q.strokeStyle = C.grid; q.strokeRect(ex, by, pw, ph);
  label(q, 'sputtered-atom energy (0–100 eV)', ex, 10 * d, d, { color: C.muted, size: 9 });
  label(q, `Us = ${mc.m.Us} eV · peak ≈ Us/2 (Thompson)`, ex + pw, by + 10 * d, d, { color: C.muted, size: 8.5, align: 'right' });
}
