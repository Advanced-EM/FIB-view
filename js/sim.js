// Simulation engine: image formation for both beams (ray-cast through the milled surface), EBSD/TKD patterns and
// indexing, EDS, electron and ion Monte Carlo, patterning, slice & view, and the lamella workflow.
// DOM-free: runs in browsers and in Node.
import * as P from './physics.js';
import { Mill, newLamella, lamThickness, newCryoLamella, cryoAge } from './mill.js';

const { clamp, mat3, DEG, MKEYS } = P;
const SP = P.SPECIMENS;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// separable Gaussian blur (edge-clamped) returning a new array
export function blurred(a, w, h, sx, sy = sx) {
  let src = a;
  const pass = (arr, s, horiz) => {
    if (s < 0.35) return arr;
    const R = Math.min(60, Math.ceil(3 * s)), k = new Float32Array(2 * R + 1);
    let sum = 0;
    for (let i = -R; i <= R; i++) { k[i + R] = Math.exp((-0.5 * i * i) / (s * s)); sum += k[i + R]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const out = new Float32Array(w * h);
    if (horiz) for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { let v = 0; for (let i = -R; i <= R; i++) v += arr[o + clamp(x + i, 0, w - 1)] * k[i + R]; out[o + x] = v; } }
    else for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -R; i <= R; i++) v += arr[clamp(y + i, 0, h - 1) * w + x] * k[i + R]; out[y * w + x] = v; }
    return out;
  };
  src = pass(src, sx, true);
  src = pass(src, sy, false);
  return src === a ? Float32Array.from(a) : src;
}

export const IMG_MODES = ['se', 'inlens', 'bse'];
export const ION_MODES = ['fib', 'mill', 'gis', 'lam', 'cryo'];
export const MODE_BEAM = { se: 'e', inlens: 'e', bse: 'e', ebsd: 'e', tkd: 'e', eds: 'e', mc: 'both', fib: 'ion', mill: 'ion', gis: 'ion', sv: 'both', lam: 'ion', cryo: 'ion' };

export class Sim {
  constructor(S) {
    this.S = S;
    this.mill = new Mill(() => this.spec);
    this.stale = { img: 1, ion: 1, map: 1, eds: 1, mc: 1, sv: 1 };
    this.version = 0;
    this.raster = 0; this.frame = 0; this.iraster = 0; this.iframe = 0;
    this.astig = 0.9; // hidden residual astigmatism of the electron column (µm), cancelled by the stigmator
    this.iastig = 0.35; // hidden residual astigmatism of the ion column (µm)
    this.clock = 0; // instrument time (s)
    this.views = new Map();
    this.lam = newLamella();
    this.cryo = newCryoLamella();
    this.imgDose = 0; // ions/nm² delivered by imaging at the current field
    this.millAccel = 1;
  }
  get spec() { return SP[this.S.spec]; }
  get probe() { return P.probe(this.S); }
  get iprobe() { return P.ionProbe(this.S.ion, this.S.icur, this.S.ikV); }
  invalidate(key) {
    const only = {
      etdBias: ['img'], bseMode: ['img'], seg: ['img'], mapView: [], edsSel: [], dwell: ['img'], hover: [], fibDet: ['ion'], idwell: ['ion'], flood: ['ion'],
      ifocus: ['ion'], istig: ['ion'], icur: ['ion', 'mc'], ion: ['ion', 'mc'], ikV: ['ion', 'mc'], focus: ['img'], stig: ['img'], svView: [], svSel: [], pattern: [],
    };
    for (const k of only[key] ?? ['img', 'ion', 'map', 'eds', 'mc']) this.stale[k] = 1;
    if (key === 'spec' || key === 'all') { this.stale.sv = 1; this.views.clear(); this._prevViews?.clear(); }
    this.version++;
  }
  // sample → microscope rotation (stage tilted about x toward the ion column and the EBSD camera)
  tiltM() { return mat3.rx(-this.S.tilt * DEG); }
  // beam angles from the sample normal, in the sample's y–z plane: the e-beam and the ion beam (52° apart)
  thetaE() { return this.S.tilt * DEG; }
  thetaI() { return (this.S.tilt - P.ION_TILT) * DEG; }

  // the surface as it is now (with milling and deposits): height and what is there
  sampleAt(x, y, res = 0) {
    const s = this.mill.surface(x, y, res);
    const r = this.mill.materialAt(x, y, s.Z - 1e-4, s.top, s);
    return { h: s.Z, mat: r.mat, grain: r.grain ?? -1, ori: r.ori ?? null, gb: r.gb };
  }

  // ------------------------------------------------------------------ viewing the surface along a beam
  // An orthographic image of n × n pixels along a beam at angle theta (sample frame). Each pixel's ray is marched
  // down to the first point below the surface, so a tilted view sees the walls and faces of milled trenches.
  view(theta, n, fov, cx, cy) {
    const S = this.S, key = [S.spec, theta.toFixed(4), n, fov.toFixed(5), cx.toFixed(4), cy.toFixed(4), S.ez, this.mill.version].join('|');
    const hit = this.views.get(key);
    if (hit) return hit;
    const px = fov / n, c = Math.cos(theta), s = Math.sin(theta), mill = this.mill, sp = this.spec;
    const N = n * n, Zh = new Float32Array(N), Wv = new Float32Array(N), Xh = new Float32Array(N), Yh = new Float32Array(N);
    const M = new Uint8Array(N), ori = new Array(N), gb = new Float32Array(N).fill(9), nxA = new Float32Array(N), nyA = new Float32Array(N), nzA = new Float32Array(N), dep = new Float32Array(N);
    const flat = Math.abs(s) < 2e-3;
    const xs = (i) => cx + (i + 0.5 - n / 2) * px;
    let Hs, ny0, ys0, pyS, rows;
    let FL = null;
    if (flat) {
      // straight down: the image grid is the height map (and its fields are reused for the materials)
      Hs = new Float32Array(N); rows = n; pyS = px; ys0 = cy + (n / 2 - 0.5) * px; ny0 = n;
      FL = { top: new Float32Array(N), f: new Array(N) };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i, sf = mill.surface(xs(i), cy - (j + 0.5 - n / 2) * px, px);
        Hs[k] = sf.Z; FL.top[k] = sf.top; FL.f[k] = mill.patterns.length ? sf : null;
      }
    } else {
      // height map over the beam's footprint, rows ordered by decreasing y
      // the image centre is the coincidence point on the original surface: milling under it does not move the stage
      const zc = sp.top(cx, cy, px);
      const vC = cy * c + (S.ez + zc) * s, vTop = vC + (n / 2) * px, vBot = vC - (n / 2) * px;
      // Z range: probe the flat footprint
      let zmin = Infinity, zmax = -Infinity;
      for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) {
        const x = cx + (a / 12 - 0.5) * fov, y = (vBot + (b / 12) * (vTop - vBot) - zc * s) / c, z = mill.surface(x, y, px * 4).Z;
        zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
      }
      for (const p of mill.patterns) { const m = mill.measure(p); zmin = Math.min(zmin, -m.maxDepth - 0.05); }
      const pad = Math.max(0.02, (zmax - zmin) * 0.1);
      zmin -= pad; zmax += pad;
      const yA = (vTop - zmin * s) / c, yB = (vBot - zmax * s) / c, y1 = Math.max(yA, yB), y2 = Math.min(yA, yB);
      rows = Math.ceil((y1 - y2) / px) + 2; pyS = px;
      if (rows > 4 * n) { rows = 4 * n; pyS = (y1 - y2) / (rows - 2); }
      ys0 = y1 + pyS;
      Hs = new Float32Array(rows * n);
      for (let r = 0; r < rows; r++) { const y = ys0 - r * pyS; for (let i = 0; i < n; i++) Hs[r * n + i] = mill.surface(xs(i), y, px).Z; }
      // march each pixel's ray
      const Hat = (i, y) => { const f = (ys0 - y) / pyS, r = Math.floor(f), a = f - r; if (r < 0) return Hs[i]; if (r >= rows - 1) return Hs[(rows - 1) * n + i]; return Hs[r * n + i] * (1 - a) + Hs[(r + 1) * n + i] * a; };
      const dz = (pyS * Math.abs(c / s)) * 1.5;
      for (let j = 0; j < n; j++) {
        const v = vC + (n / 2 - j - 0.5) * px;
        for (let i = 0; i < n; i++) {
          let Z = zmax, prev = Z, found = false;
          for (let it = 0; it < 4000 && Z >= zmin; it++) {
            const y = (v - Z * s) / c;
            if (Z <= Hat(i, y)) { found = true; break; }
            prev = Z; Z -= dz;
          }
          if (!found) Z = zmin;
          else { let lo = Z, hi = prev; for (let b = 0; b < 7; b++) { const mid = 0.5 * (lo + hi), y = (v - mid * s) / c; if (mid <= Hat(i, y)) lo = mid; else hi = mid; } Z = 0.5 * (lo + hi); }
          const k = j * n + i;
          Zh[k] = Z; Xh[k] = xs(i); Yh[k] = (v - Z * s) / c;
        }
      }
      // normals from the height map
      for (let k = 0; k < N; k++) {
        const i = k % n, y = Yh[k];
        const hx = (Hat(Math.min(n - 1, i + 1), y) - Hat(Math.max(0, i - 1), y)) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * px || px);
        const hy = (Hat(i, y + pyS) - Hat(i, y - pyS)) / (2 * pyS);
        const nn = P.norm([-hx, -hy, 1]); nxA[k] = nn[0]; nyA[k] = nn[1]; nzA[k] = nn[2];
      }
    }
    if (flat) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        Zh[k] = Hs[k]; Xh[k] = xs(i); Yh[k] = cy - (j + 0.5 - n / 2) * px;
        const hx = (Hs[j * n + Math.min(n - 1, i + 1)] - Hs[j * n + Math.max(0, i - 1)]) / (2 * px);
        const hy = (Hs[Math.max(0, j - 1) * n + i] - Hs[Math.min(n - 1, j + 1) * n + i]) / (2 * px);
        const nn = P.norm([-hx, -hy, 1]); nxA[k] = nn[0]; nyA[k] = nn[1]; nzA[k] = nn[2];
      }
    }
    // what each ray hits: a point just inside the surface along the ray. Pixels whose hit point has not moved since
    // the last view of this field (milling changes only the patterned area) keep their material lookup.
    const eps = Math.max(1e-4, px * 0.3);
    const baseKey = key.slice(0, key.lastIndexOf('|')), prev = this._prevViews?.get(baseKey);
    for (let k = 0; k < N; k++) {
      if (prev && prev.Zh[k] === Zh[k] && prev.Yh[k] === Yh[k]) {
        M[k] = prev.M[k]; ori[k] = prev.ori[k]; gb[k] = prev.gb[k]; dep[k] = prev.dep[k]; Wv[k] = prev.Wv[k];
        continue;
      }
      const x = Xh[k], y = Yh[k] + eps * s, Z = Zh[k] - eps * c;
      const f = FL ? FL.f[k] : mill.patterns.length ? mill.fields(x, y) : null;
      const top = FL ? FL.top[k] : sp.top(x, y, px);
      const r = mill.materialAt(x, y, Z, top, f);
      M[k] = MKEYS.indexOf(r.mat); ori[k] = r.ori ?? null; if (r.gb != null) gb[k] = r.gb;
      dep[k] = f ? f.dep - f.rem : 0;
      Wv[k] = Zh[k] * c - Yh[k] * s; // height along the beam (toward the source)
    }
    const out = { n, px, theta, Zh, Wv, Xh, Yh, M, ori, gb, nx: nxA, ny: nyA, nz: nzA, dep, key };
    this._prevViews ??= new Map();
    if (this._prevViews.size > 6) this._prevViews.delete(this._prevViews.keys().next().value);
    this._prevViews.set(baseKey, out);
    if (this.views.size > 4) this.views.delete(this.views.keys().next().value);
    this.views.set(key, out);
    return out;
  }
  // a flat grid of surface records for the analyses that look straight down (EDS)
  sampleGrid(n, fov, cx, cy) {
    const v = this.view(this.thetaE(), n, fov, cx, cy);
    return { H: v.Zh, M: v.M, ori: v.ori, px: v.px, n };
  }
  dominant(v) {
    const cnt = new Map();
    for (let i = 0; i < v.M.length; i += 7) cnt.set(v.M[i], (cnt.get(v.M[i]) || 0) + 1);
    const sorted = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
    const first = sorted.find(([k]) => P.MAT[MKEYS[k]].rho) ?? sorted[0];
    return P.MAT[MKEYS[first[0]]];
  }

  // curtaining on a wall pixel: streaks running down the face below where the beam milled through materials of
  // different sputter yield (copper lines in oxide, particles in binder). A Pt cap and a rocking stage reduce it.
  curtain(v, k) {
    const x = v.Xh[k], y = v.Yh[k] + 0.05 * Math.sin(v.theta), Z = v.Zh[k], sp = this.spec;
    const top = sp.top(x, y), f = this.mill.patterns.length ? this.mill.fields(x, y) : { dep: 0 };
    let A = 0, prev = null;
    const depth = top - Z;
    if (depth < 0.05) return 0;
    for (let t = 0; t < 7; t++) {
      const z = top - (depth * (t + 0.5)) / 7, m = sp.vol(x, y, z).mat;
      const Yv = P.MAT[m].Yv || 0.5;
      if (prev !== null) A += Math.abs(Yv - prev) / 0.25;
      prev = Yv;
    }
    let damp = f.dep > 0.3 ? 0.4 : 1;
    const pat = this.mill.patterns.find((p) => p.kind === 'mill' && Math.abs(x - p.x) < p.w / 2 + 1 && Math.abs(y - p.y) < p.h / 2 + 1);
    if (pat?.rocking) damp *= 0.3;
    if (pat && pat.ion !== 'Ga') damp *= 1.4;
    if (pat?.shape === 'ccs') damp *= 0.7;
    return Math.min(1.2, A * 0.18 * damp) * (P.vnoise(x / 0.07, Z * 0.15, 31) - 0.5) * 2;
  }

  // ------------------------------------------------------------------ electron imaging (SE · ETD, in-lens, BSE)
  computeImage(target = 'img', n = 256, opts = {}) {
    const S = this.S, E = S.kV, fov = opts.fov ?? S.fov;
    const v = this.view(this.thetaE(), n, fov, S.cx, S.cy);
    const { M, ori, px } = v;
    const T = this.tiltM(), mode = opts.mode ?? S.mode;
    const dom = this.dominant(v);
    const Rko = P.rangeKO(dom.rho ? dom : P.MAT.Ni, E); // µm
    const sBSE = (0.25 * Rko) / px, sEdge = Math.max(0.6, (0.15 * Rko) / px);
    const W = v.Wv, Wb = sEdge > 0.35 ? blurred(W, n, n, Math.min(60, sEdge)) : W;
    const se1 = new Float32Array(n * n), bse = new Float32Array(n * n), nxA = new Float32Array(n * n), nyA = new Float32Array(n * n), face = new Float32Array(n * n), edge = new Float32Array(n * n), curt = new Float32Array(n * n);
    const beamS = mat3.tmv(T, [0, 0, -1]);
    const det = P.norm([-1, 0.25, 0.6]); // the ETD sits to the left, above the sample
    const coatM = P.MAT.C;
    const dtab = MKEYS.map((mk) => { const m = P.MAT[mk]; return m.rho ? P.delta(S.coated && !m.cond ? { ...m, dmax: coatM.dmax * 0.6 + m.dmax * 0.4 } : m, E) : 0; });
    const chMemo = new Map(), chOf = (O) => { let c = chMemo.get(O); if (c === undefined) { const r = P.channeling(O, beamS, 0.85); c = 1 - 0.3 * r.ch - 0.04 * r.b[2]; chMemo.set(O, c); } return c; };
    for (let k = 0; k < n * n; k++) {
      const m = P.MAT[MKEYS[M[k]]];
      if (!m.rho) continue;
      const nS = [v.nx[k], v.ny[k], v.nz[k]], nM = mat3.mv(T, nS);
      const cosI = clamp(nM[2], 0.05, 1), inc = Math.acos(cosI);
      se1[k] = dtab[M[k]] / Math.max(0.15, cosI);
      let et = P.eta(m.Z, inc);
      const O = ori[k];
      if (O) et *= chOf(O);
      bse[k] = et;
      nxA[k] = nM[0]; nyA[k] = nM[1];
      face[k] = clamp(0.55 + 0.7 * P.dot(nM, det), 0.15, 1.25);
      edge[k] = Math.max(0, W[k] - Wb[k]) / Math.max(1e-6, 0.15 * Rko);
      if (v.nz[k] < 0.4 && this.mill.patterns.length) curt[k] = this.curtain(v, k);
    }
    // shadowing toward the ETD
    const shadow = new Float32Array(n * n).fill(1);
    const tanE = Math.tan(28 * DEG);
    if (mode === 'se') for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, h0 = W[k];
        for (let s = 2; s < 40 && i - s >= 0; s += 2) if (W[j * n + i - s] > h0 + s * px * tanE) { shadow[k] = 0.5; break; }
      }
    const bseB = blurred(bse, n, n, sBSE * 0.6), se2src = blurred(bse, n, n, sBSE);
    const beta = clamp(1 + 0.09 * E, 1, 3.5);
    const out = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) {
      const m = P.MAT[MKEYS[M[k]]];
      if (!m.rho) { out[k] = 0; continue; }
      const dN = dtab[M[k]];
      const SE1 = se1[k] * (1 + 0.8 * Math.min(3, edge[k])), SE2 = dN * beta * se2src[k];
      let val;
      if (mode === 'inlens') val = (SE1 + 0.35 * SE2) * (1 / (1 + (S.wd / 5) ** 2));
      else if (mode === 'bse') {
        val = 0;
        for (const q of ['A', 'B', 'C', 'D']) {
          const sg = S.seg[q];
          if (!sg) continue;
          const [ux, uy] = P.SEG_DIR[q];
          val += sg * (0.25 * bseB[k] + 0.6 * bse[k] * (nxA[k] * ux + nyA[k] * uy));
        }
      } else if (mode === 'ebsd' || mode === 'tkd') val = bseB[k];
      else if (S.etdBias < 0) val = 0.6 * bse[k] * face[k] * face[k] * shadow[k];
      else val = (SE1 + SE2) * face[k] * shadow[k] * (0.5 + 0.5 * clamp(S.etdBias / 250, 0, 1)) + 0.2 * bse[k] * face[k] * shadow[k];
      if (curt[k]) val *= 1 + 0.45 * curt[k];
      out[k] = val;
    }
    // charging of uncoated insulators above E2: bright blooms and streaks along the scan
    let charging = false;
    if (mode !== 'bse') {
      for (let j = 0; j < n; j++) {
        let ch = 0;
        for (let i = 0; i < n; i++) {
          const k = j * n + i, m = P.MAT[MKEYS[M[k]]];
          if (P.charges(m, E, S.coated) && v.dep[k] < 0.02) { ch = Math.min(2.5, ch + 0.06 * clamp((E - m.E2) / m.E2, 0.2, 2)); charging = true; }
          else ch *= 0.965;
          out[k] += ch;
        }
      }
    }
    // focus, astigmatism and depth of field → blur
    const pr = this.probe, alpha = pr.alpha;
    const sProbe = pr.d / 1000 / 2.355 / px;
    const mis = S.mis ?? {};
    const ast = S.stig - this.astig - (mis.eStig ?? 0), foc = S.focus - (mis.eFocus ?? 0);
    const wRef = W[(n / 2) * n + n / 2];
    const dof = new Float32Array(n * n);
    let sMax = 0;
    for (let k = 0; k < n * n; k++) { const dz = W[k] - wRef; dof[k] = Math.hypot((alpha * Math.abs(dz)) / px, sProbe); if (dof[k] > sMax) sMax = dof[k]; }
    const res = this.dofBlur(out, n, dof, sMax);
    const sx = (alpha * Math.abs(foc + ast)) / px, sy = (alpha * Math.abs(foc - ast)) / px;
    const final = Math.abs(ast) > 0.02 || Math.abs(foc) > 0.01 ? blurred(res, n, n, Math.max(0, sx - 0.3), Math.max(0, sy - 0.3)) : res;
    const img = { arr: final, n, px, charging, Rko, dom, sharp: sharpness(final, n), view: v, beam: 'e', fov };
    if (target === 'img') { this.img = img; this.grid = { M: v.M }; this.main = { arr: final, w: n, h: n }; this.raster = 0; this.firstPass = this.frame; }
    return img;
  }
  dofBlur(out, n, dof, sMax) {
    const levels = [0, 1, 2, 4, 8, 16].filter((l, i, a) => i < 2 || a[i - 1] < sMax);
    const pyr = levels.map((s) => (s ? blurred(out, n, n, s) : out));
    const res = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) {
      const s = dof[k];
      let lv = 0;
      while (lv < levels.length - 2 && levels[lv + 1] < s) lv++;
      const f = clamp((s - levels[lv]) / (levels[lv + 1] - levels[lv]), 0, 1);
      res[k] = pyr[lv][k] * (1 - f) + pyr[lv + 1][k] * f;
    }
    return res;
  }

  // ------------------------------------------------------------------ ion imaging (ion-induced SE, secondary ions)
  computeIonImage(n = 256) {
    const S = this.S, E = S.ikV, ion = S.ion;
    const v = this.view(this.thetaI(), n, S.fov, S.cx, S.cy);
    const { M, ori, px } = v;
    const dS = [0, Math.sin(v.theta), -Math.cos(v.theta)];
    const det = P.norm([-1, 0.25, 0.6]), T = this.tiltM();
    const out = new Float32Array(n * n), W = v.Wv, Wb = blurred(W, n, n, 1.2);
    // per-material yields and per-grain channelling, computed once per image
    const ytab = MKEYS.map((mk) => (P.MAT[mk].rho ? (S.fibDet === 'si' ? P.siYield(ion, mk, E) : P.iseYield(ion, mk, E)) : 0));
    const chMemo = new Map(), chOf = (O) => { let c = chMemo.get(O); if (c === undefined) { c = Math.min(1, 1.15 * P.channeling(O, dS, 2.4).ch); chMemo.set(O, c); } return c; };
    let charging = false;
    for (let k = 0; k < n * n; k++) {
      const m = P.MAT[MKEYS[M[k]]];
      if (!m.rho) continue;
      const nx = v.nx[k], ny = v.ny[k], nz = v.nz[k], cosI = clamp(-(nx * dS[0] + ny * dS[1] + nz * dS[2]), 0.08, 1);
      const O = ori[k], ch = O ? chOf(O) : 0;
      const nM = mat3.mv(T, [nx, ny, nz]), face = clamp(0.6 + 0.6 * P.dot(nM, det), 0.2, 1.2);
      const edge = 1 + 0.5 * Math.min(2, Math.max(0, W[k] - Wb[k]) / (px * 2));
      let val;
      if (S.fibDet === 'si') val = ytab[M[k]] * (1 - 0.45 * ch) / Math.pow(cosI, 0.4) * edge;
      else val = (ytab[M[k]] * (1 - 0.8 * ch)) / Math.pow(cosI, 0.9) * edge * face;
      // insulators charge positive under ions and hold their secondaries back, unless an electron flood neutralises them
      if (!m.cond && !S.coated && v.dep[k] < 0.02) { charging = true; if (!S.flood) val *= S.fibDet === 'si' ? 1.4 : 0.22; }
      if (v.nz[k] < 0.4 && this.mill.patterns.length) val *= 1 + 0.35 * this.curtain(v, k);
      out[k] = val;
    }
    // the ion probe: core plus a weak, wide tail (stronger for plasma sources)
    const pr = this.iprobe, sP = pr.d / 1000 / 2.355 / px, mis = S.mis ?? {};
    const foc = S.ifocus - (mis.iFocus ?? 0), ast = S.istig - this.iastig - (mis.iStig ?? 0);
    let res = blurred(out, n, n, Math.max(0, sP));
    const sx = (pr.alpha * Math.abs(foc + ast)) / px, sy = (pr.alpha * Math.abs(foc - ast)) / px;
    if (sx > 0.3 || sy > 0.3) res = blurred(res, n, n, Math.max(0, sx - 0.3), Math.max(0, sy - 0.3));
    if (pr.tail) {
      // the tail is wide and weak: blur a quarter-size copy and spread it back
      const q = 4, m = n / q, small = new Float32Array(m * m);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) small[((j / q) | 0) * m + ((i / q) | 0)] += res[j * n + i] / (q * q);
      const hs = blurred(small, m, m, Math.min(15, (sP * 8 + 2) / q));
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const fx = Math.min(m - 1.001, Math.max(0, (i + 0.5) / q - 0.5)), fy = Math.min(m - 1.001, Math.max(0, (j + 0.5) / q - 0.5)), a = fx | 0, b = fy | 0, u = fx - a, w = fy - b;
        const h = (hs[b * m + a] * (1 - u) + hs[b * m + a + 1] * u) * (1 - w) + (hs[(b + 1) * m + a] * (1 - u) + hs[(b + 1) * m + a + 1] * u) * w;
        res[j * n + i] = res[j * n + i] * (1 - pr.tail) + h * pr.tail;
      }
    }
    this.ionImg = { arr: res, n, px, charging, view: v, sharp: sharpness(res, n), beam: 'ion' };
    if (ION_MODES.includes(S.mode)) this.main = { arr: res, w: n, h: n };
    this.iraster = 0; this.ifirstPass = this.iframe;
    return this.ionImg;
  }
  sharpness(a, n) { return sharpness(a, n); }

  // ------------------------------------------------------------------ Kikuchi patterns
  geom() {
    const S = this.S;
    return S.mode === 'tkd' ? { type: 'tkd', D: 0.85, pcx: 0, pcy: 0 } : { type: 'ebsd', D: 0.9, pcx: 0.0, pcy: 0.25 };
  }
  dirM(G, u, v) { return G.type === 'tkd' ? [u - G.pcx, v - G.pcy, -G.D] : [u - G.pcx, G.D, v - G.pcy]; }
  simPattern(grains, N, noise = true) {
    const S = this.S, G = this.geom(), T = this.tiltM(), out = new Float32Array(N * N);
    const quality = G.type === 'ebsd' ? Math.exp(-(((S.tilt - 70) / 18) ** 2)) : Math.exp(-(((S.tkdThick - 90) / 110) ** 2)) * (S.tilt < 25 ? 1 : 0.2);
    // amorphous FIB damage on a lamella blurs the patterns (both faces)
    const amorph = G.type === 'tkd' ? clamp(1 - (S.tkdAmorph ?? 0) / 60, 0.25, 1) : 1;
    const lists = grains.map((g) => ({ ...g, B: g.cryst ? P.kikuchiBands(g.mat, S.kV).bands : null, OT: g.O ? mat3.T(g.O) : null }));
    const TT = mat3.T(T);
    const sMin = 1.1 / (N * G.D);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const u = ((i + 0.5) / N) * 2 - 1, v = 1 - ((j + 0.5) / N) * 2;
        if (u * u + v * v > 1) continue;
        const rm = P.norm(this.dirM(G, u, v)), rs = mat3.mv(TT, rm);
        const bg = G.type === 'ebsd' ? 0.35 + Math.exp(-(((v + 0.55) / 0.95) ** 2)) * 0.9 + 0.15 * (1 - Math.abs(u)) : 0.3 + Math.exp(-(u * u + v * v) / 0.35);
        let band = 0;
        for (const g of lists) {
          if (!g.B) continue;
          const rc = mat3.mv(g.OT, rs);
          let b = 0;
          for (const B of g.B) {
            const d = Math.abs(rc[0] * B.n[0] + rc[1] * B.n[1] + rc[2] * B.n[2]), x = d / Math.max(B.sB, sMin);
            if (x < 1) b += B.w * (0.55 + 0.45 * Math.cos(Math.PI * x));
            else if (x < 1.35) b -= B.w * 0.18 * Math.sin((Math.PI * (x - 1)) / 0.35);
          }
          band += g.w * b;
        }
        out[j * N + i] = bg * (1 + 0.28 * quality * amorph * band);
      }
    if (noise) {
      const counts = (S.expo / 10) * (S.current / 1000) * 120 * (S.clarity === 'real' ? 1 : 4);
      for (let k = 0; k < N * N; k++) if (out[k]) out[k] = P.poisson(out[k] * counts) / counts;
    }
    return out;
  }
  grainsAt(x, y) {
    const S = this.S, G = this.geom();
    const dom = this.sampleAt(x, y);
    const m = P.MAT[dom.mat];
    const R = P.rangeKO(m.rho ? m : P.MAT.Ni, S.kV);
    const r = G.type === 'tkd' ? 0.004 + (S.tkdThick / 1000) * 0.06 : 0.02 * R;
    const ry = G.type === 'tkd' ? r : r / Math.cos(Math.min(80, S.tilt) * DEG);
    const pts = [[0, 0, 0.4], [r, 0, 0.15], [-r, 0, 0.15], [0, ry, 0.15], [0, -ry, 0.15]];
    const acc = new Map();
    for (const [dx, dy, w] of pts) {
      const s = this.sampleAt(x + dx, y + dy);
      const key = s.ori ? `${s.mat}:${s.grain}` : `am:${s.mat}`;
      const e = acc.get(key) || { w: 0, O: s.ori, mat: s.mat, cryst: !!(P.MAT[s.mat].cryst && s.ori), grain: s.grain };
      e.w += w; acc.set(key, e);
    }
    return [...acc.values()].sort((a, b) => b.w - a.w);
  }
  hough(img, N, K) {
    const nT = 90, nR = N, acc = new Float32Array(nT * nR);
    const bgs = blurred(img, N, N, N / 10);
    const cs = [], sn = [];
    for (let t = 0; t < nT; t++) { cs.push(Math.cos((t * Math.PI) / nT)); sn.push(Math.sin((t * Math.PI) / nT)); }
    const c = N / 2, rMax = N * 0.72;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = i + 0.5 - c, y = c - (j + 0.5);
        if (x * x + y * y > c * c * 0.88) continue;
        const v = img[j * N + i] - bgs[j * N + i];
        if (v <= 0) continue;
        for (let t = 0; t < nT; t++) {
          const r = x * cs[t] + y * sn[t], ri = Math.round(((r + rMax) / (2 * rMax)) * (nR - 1));
          acc[t * nR + ri] += v;
        }
      }
    for (let t = 0; t < nT; t++) for (let ri = 0; ri < nR; ri++) {
      const r = (ri / (nR - 1)) * 2 * rMax - rMax, L2 = c * c * 0.88 - r * r;
      acc[t * nR + ri] = Math.abs(r) > 0.7 * c ? 0 : acc[t * nR + ri] / (2 * Math.sqrt(Math.max(L2, 0.25 * c * c)));
    }
    const peaks = [];
    const taken = new Uint8Array(nT * nR);
    for (let p = 0; p < K; p++) {
      let best = -1, bi = -1;
      for (let i = 0; i < nT * nR; i++) if (!taken[i] && acc[i] > best) { best = acc[i]; bi = i; }
      if (bi < 0 || best <= 0) break;
      const t = Math.floor(bi / nR), ri = bi % nR;
      peaks.push({ theta: (t * Math.PI) / nT, rho: ((ri / (nR - 1)) * 2 * rMax - rMax) / c, h: best });
      for (let dt = -5; dt <= 5; dt++) for (let dr = -4; dr <= 4; dr++) {
        const tt = (t + dt + nT) % nT, rr = dt + t < 0 || dt + t >= nT ? nR - 1 - (ri + dr) : ri + dr;
        if (rr >= 0 && rr < nR) taken[tt * nR + rr] = 1;
      }
    }
    return { peaks, acc, nT, nR };
  }
  bandNormal(pk) {
    const G = this.geom(), T = this.tiltM();
    const ct = Math.cos(pk.theta), st = Math.sin(pk.theta);
    const p0 = [pk.rho * ct, pk.rho * st], dirv = [-st, ct];
    const a = this.dirM(G, p0[0] - 0.5 * dirv[0], p0[1] - 0.5 * dirv[1]), b = this.dirM(G, p0[0] + 0.5 * dirv[0], p0[1] + 0.5 * dirv[1]);
    return P.norm(mat3.tmv(T, P.cross(a, b)));
  }
  index(peaks, matKey) {
    const C = P.indexerNormals(matKey), n = peaks.map((p) => this.bandNormal(p)), K = n.length;
    if (K < 3) return null;
    const tol = 1.6 * DEG, ctol = Math.cos(1.8 * DEG);
    const cpairs = [];
    for (let p = 0; p < C.length; p++) for (let q = p + 1; q < C.length; q++) cpairs.push([p, q, Math.acos(clamp(Math.abs(P.dot(C[p].n, C[q].n)), 0, 1))]);
    let best = null;
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) {
      const dij = P.dot(n[i], n[j]), ang = Math.acos(clamp(Math.abs(dij), 0, 1));
      if (ang < 8 * DEG) continue;
      for (const [p, q, ca] of cpairs) {
        if (Math.abs(ca - ang) > tol) continue;
        const a1 = C[p].n, a2 = C[q].n;
        const s = Math.sign(P.dot(a1, a2)) === Math.sign(dij) ? 1 : -1;
        const b1 = n[i], b2 = n[j].map((v) => v * s);
        const O = triad(a1, a2, b1, b2);
        let matched = 0, sum = 0;
        for (let k = 0; k < K; k++) {
          let bestc = 0;
          for (const c of C) { const d = Math.abs(P.dot(mat3.mv(O, c.n), n[k])); if (d > bestc) bestc = d; }
          if (bestc > ctol) { matched++; sum += Math.acos(clamp(bestc, 0, 1)); }
        }
        const mad = matched ? sum / matched : 9;
        if (!best || matched > best.matched || (matched === best.matched && mad < best.mad)) best = { O, matched, mad, K };
      }
    }
    if (!best || best.matched < 3) return null;
    best.ci = best.matched / K;
    return best;
  }
  analyzePoint(x, y, N = 64, K = 7) {
    const grains = this.grainsAt(x, y);
    const top = grains[0];
    const cryst = grains.filter((g) => g.cryst);
    const pat = this.simPattern(grains, N);
    if (!cryst.length || !this.spec.phases.includes(cryst[0].mat)) return { pat, res: null, truth: top, phase: top.mat };
    const H = this.hough(pat, N, K);
    const res = this.index(H.peaks, cryst[0].mat);
    const bc = H.peaks.reduce((s, p) => s + p.h, 0) / Math.max(1, H.peaks.length);
    if (res) { res.bc = bc; res.err = misoDeg(res.O, cryst[0].O); res.phase = cryst[0].mat; }
    return { pat, res, truth: cryst[0], peaks: H.peaks, bc, phase: cryst[0].mat };
  }
  startMap() {
    const S = this.S, N = S.mapN;
    this.map = { N, done: 0, fov: S.fov, cx: S.cx, cy: S.cy, O: new Array(N * N), mad: new Float32Array(N * N), bc: new Float32Array(N * N), err: new Float32Array(N * N).fill(-1), phase: new Array(N * N), grain: new Array(N * N), ok: 0, errSum: 0, t0: now() };
    this.stale.map = 0;
  }
  stepMap(budget) {
    const M = this.map;
    if (!M || M.done >= M.N * M.N) return false;
    const t0 = now();
    while (M.done < M.N * M.N && now() - t0 < budget) {
      const k = M.done, i = k % M.N, j = (k / M.N) | 0, step = M.fov / M.N;
      const x = M.cx + (i + 0.5 - M.N / 2) * step, y = M.cy - (j + 0.5 - M.N / 2) * step;
      const a = this.analyzePoint(x, y, 64, 8);
      M.phase[k] = a.phase; M.grain[k] = a.truth?.grain;
      if (a.res) { M.O[k] = a.res.O; M.mad[k] = a.res.mad / DEG; M.bc[k] = a.res.bc; M.err[k] = a.res.err; M.ok++; M.errSum += Math.min(a.res.err, 10); }
      else M.bc[k] = a.bc || 0;
      M.done++;
    }
    return true;
  }
  patternAt(k, live = false) {
    const M = this.map;
    if (!M) return null;
    // while a map runs, the newest point's pattern is refreshed a few times a second, not every frame
    if (live && this._pat && now() - (this._patT ?? 0) < 500) return this._pat;
    this._patT = now();
    // the pattern of one map point changes only with the map and the conditions, not with every new frame
    const key = `${k}|${M.t0}|${this.S.kV}|${this.S.clarity}|${this.S.expo}|${this.S.current}|${this.S.tkdThick}|${this.S.tkdAmorph}`;
    if (this._patKey === key) return this._pat;
    const i = k % M.N, j = (k / M.N) | 0, step = M.fov / M.N;
    const x = M.cx + (i + 0.5 - M.N / 2) * step, y = M.cy - (j + 0.5 - M.N / 2) * step;
    const a = this.analyzePoint(x, y, live ? 96 : 144, 9);
    a.N = live ? 96 : 144;
    this._pat = a; this._patKey = key;
    return a;
  }

  // ------------------------------------------------------------------ EDS
  computeEDS() {
    const S = this.S, n = 96, E0 = S.kV;
    const g = this.sampleGrid(n, S.fov, S.cx, S.cy);
    const els = new Set();
    for (let k = 0; k < n * n; k++) for (const e in P.MAT[MKEYS[g.M[k]]].comp) els.add(e);
    // implanted beam ions in milled areas (Ga, Xe, Ar, N, O) and their concentration map
    const imp = new Float32Array(n * n);
    let impEl = null;
    if (this.mill.patterns.length) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = S.cx + (i + 0.5 - n / 2) * g.px, y = S.cy - (j + 0.5 - n / 2) * g.px, a = this.mill.implantAt(x, y);
        if (a) { imp[j * n + i] = a.c; impEl ??= a.el; }
      }
      if (impEl) els.add(impEl);
    }
    const syms = [...els].filter((e) => P.XLINES.some((l) => l.el === e));
    const cnt = new Map();
    for (let k = 0; k < n * n; k += 5) cnt.set(g.M[k], (cnt.get(g.M[k]) || 0) + 1);
    const dom = P.MAT[MKEYS[[...cnt.entries()].sort((a, b) => b[1] - a[1]).find(([k]) => P.MAT[MKEYS[k]].rho)?.[0] ?? 1]];
    const mainLine = P.XLINES.filter((l) => dom.comp[l.el] && E0 > l.Ec * 1.1).sort((a, b) => b.Ec - a.Ec)[0];
    const Rx = mainLine ? P.rangeX(dom, E0, mainLine.Ec) : P.rangeKO(dom, E0) * 0.6;
    const sig = (0.35 * Rx) / g.px;
    // the implanted layer is only ~Rp thick: it weighs in the X-ray volume as Rp / Rx
    const impW = impEl ? clamp(0.03 / Math.max(0.03, Rx), 0.02, 1) : 0;
    const maps = {};
    for (const e of syms) {
      const a = new Float32Array(n * n);
      for (let k = 0; k < n * n; k++) a[k] = (P.MAT[MKEYS[g.M[k]]].comp[e] || 0) * (1 - imp[k] * impW) + (e === impEl ? imp[k] * impW : 0);
      maps[e] = blurred(a, n, n, sig);
    }
    const nb = 1000, Emax = Math.max(10, Math.min(30, Math.ceil(E0 + 1))), dE = Emax / nb, spec = new Float32Array(nb);
    const comp = {}, zbar = { s: 0, n: 0 };
    for (let k = 0; k < n * n; k++) {
      const m = P.MAT[MKEYS[g.M[k]]];
      if (!m.rho) continue;
      for (const e in m.comp) if (syms.includes(e)) comp[e] = (comp[e] || 0) + m.comp[e] * (1 - imp[k] * impW);
      if (impEl) comp[impEl] = (comp[impEl] || 0) + imp[k] * impW;
      zbar.s += m.Z; zbar.n++;
    }
    let tot = 0;
    for (const e in comp) tot += comp[e];
    for (const e in comp) comp[e] /= tot || 1;
    const Z = zbar.s / (zbar.n || 1), A = 2 * Z + 1;
    const absorb = (E, Ec) => {
      const mu = Math.min(2e4, 1.47 * Math.pow(Z, 2.8) * Math.pow(E, -2.8)), chi = mu / Math.sin(35 * DEG);
      const sg = 4.5e5 / Math.max(1e-3, Math.pow(E0, 1.65) - Math.pow(Ec, 1.65)), h = (1.2 * A) / (Z * Z);
      return 1 / ((1 + chi / sg) * (1 + (h / (1 + h)) * (chi / sg)));
    };
    for (const L of P.XLINES) {
      const c = comp[L.el];
      if (!c || E0 <= L.Ec) continue;
      const U = E0 / L.Ec, I = c * L.y * L.w * (Math.log(U) / U) * absorb(L.E, L.Ec) * P.detEff(L.E);
      const s = P.edsFWHM(L.E) / 2.355;
      for (let b = Math.max(0, Math.floor((L.E - 4 * s) / dE)); b <= Math.min(nb - 1, Math.ceil((L.E + 4 * s) / dE)); b++) {
        const e = (b + 0.5) * dE;
        spec[b] += (I * dE * Math.exp(-0.5 * ((e - L.E) / s) ** 2)) / (s * 2.5066);
      }
    }
    for (let b = 0; b < nb; b++) {
      const e = (b + 0.5) * dE;
      if (e < 0.1 || e >= E0) continue;
      spec[b] += 3e-4 * Z * ((E0 - e) / e) * P.detEff(e) * absorb(e, 0.1) * dE * 10;
    }
    let st = 0;
    for (let b = 0; b < nb; b++) st += spec[b];
    for (let b = 0; b < nb; b++) spec[b] /= st || 1;
    this.eds = { n, maps, syms, spec, nb, dE, Emax, comp, Rx, mainLine, dom, px: g.px, impEl };
    this.acc = { t: 0, total: 0, spec: new Float32Array(nb), maps: Object.fromEntries(syms.map((s) => [s, new Float32Array(n * n)])) };
    this.main = null;
  }
  accumulateEDS(dt) {
    const e = this.eds, a = this.acc, S = this.S;
    if (!e) return;
    a.t += dt;
    const rate = (S.current / 1000) * 60000 * dt;
    for (let b = 0; b < e.nb; b++) { const c = P.poisson(e.spec[b] * rate); a.spec[b] += c; a.total += c; }
    const k = (S.current / 1000) * 6 * dt;
    for (const s of e.syms) { const m = e.maps[s], acc = a.maps[s]; for (let i = 0; i < m.length; i++) acc[i] += P.poisson(m[i] * k); }
  }

  // ------------------------------------------------------------------ Monte Carlo (electrons or ions)
  startMC() {
    const S = this.S;
    let s = this.sampleAt(S.cx, S.cy);
    this.mcNote = null;
    // on a pore or in vacuum: simulate the nearest solid in the field instead, and say so
    if (!P.MAT[s.mat].rho) {
      search: for (let r = S.fov / 64; r <= S.fov / 2; r *= 1.4) for (let a = 0; a < 6.28; a += 0.5) {
        const t = this.sampleAt(S.cx + r * Math.cos(a), S.cy + r * Math.sin(a));
        if (P.MAT[t.mat].rho) { s = t; this.mcNote = `beam on a pore: simulating the nearest solid, ${P.MAT[t.mat].name.toLowerCase()}, ${r < 1 ? `${Math.round(r * 1000)} nm` : `${r.toFixed(1)} µm`} away`; break search; }
      }
    }
    const mk = P.MAT[s.mat].rho ? s.mat : null;
    this.mcMat = mk;
    this.stale.mc = 0;
    if (!mk) { this.mc = null; return; }
    if (S.mcBeam === 'ion') {
      const inc = Math.abs(S.tilt - P.ION_TILT);
      this.mc = new P.IonCascade(S.ion, mk, S.ikV, inc, true);
      this.mcLine = null;
      return;
    }
    const m = P.MAT[mk];
    const line = P.XLINES.filter((l) => m.comp[l.el] && S.kV > l.Ec * 1.2).sort((a, b) => b.Ec - a.Ec)[0];
    this.mcLine = line;
    this.mc = new P.MonteCarlo(mk, S.kV, S.tilt, line ? line.Ec : 1e9);
  }

  // ------------------------------------------------------------------ slice & view
  startSV() {
    const S = this.S, W = clamp(S.fov * 0.8, 4, 40), Hz = W * 0.6, nx = 160, nz = 96;
    this.sv = { W, Hz, nx, nz, cx: S.cx, y0: S.cy - 3, s: S.svSlice / 1000, k: 0, stack: [], truth: [], t: 0, lastWall: 0, done: false, mill: 0, img: 0 };
    this.stale.sv = 0;
  }
  sliceAt(y) {
    const S = this.S, sv = this.sv, sp = this.spec, { W, Hz, nx, nz } = sv, img = new Float32Array(nx * nz), tr = new Uint8Array(nx * nz);
    const E = S.kV, sn = Math.sin(P.ION_TILT * DEG), cs = Math.cos(P.ION_TILT * DEG);
    const level = (mk) => { const m = P.MAT[mk]; return S.svDet === 'bse' ? P.eta(m.Z) : P.delta(m, E) * 0.6 + P.eta(m.Z) * 0.6; };
    const cryo = !!sp.cryo, cls = (mk) => (cryo ? (mk === 'Ice' ? 0 : mk === 'Lipid' || mk === 'Nuc' ? 2 : 1) : mk === 'vac' ? 0 : mk === 'Binder' || mk === 'C' || mk === 'CDep' || mk === 'SiO2' ? 1 : mk === 'NMC' || mk === 'Cu' || mk === 'W' || mk === 'Ni' || mk === 'Sn' ? 2 : 3);
    for (let i = 0; i < nx; i++) {
      const x = sv.cx - W / 2 + (i + 0.5) * (W / nx);
      let streak = 0, prevY = null;
      const top = sp.top(x, y);
      for (let j = 0; j < nz; j++) {
        const Z = top - (j + 0.5) * (Hz / nz), r = sp.vol(x, y, Z), k = j * nx + i;
        tr[k] = cls(r.mat);
        let val;
        if (r.mat === 'vac') {
          // a pore: the beam passes into it and picks up signal from the material behind, dimmed and blurred
          let got = 0;
          for (let t = 0.15; t < 3; t += 0.15) { const r2 = sp.vol(x, y + t * sn, Z - t * cs); if (r2.mat !== 'vac') { got = level(r2.mat) * Math.exp(-t / 1.1) * 0.75; break; } }
          val = got;
        } else val = level(r.mat) * (r.ori ? 1 - 0.12 * P.channeling(r.ori, [0, sn, -cs]).ch : 1);
        // curtains: streaks below where milling crossed materials of different yield
        const Yv = P.MAT[r.mat].Yv || 0.6;
        if (prevY !== null) streak += Math.abs(Yv - prevY) * 0.25;
        prevY = Yv;
        streak *= 0.995;
        val *= 1 + Math.min(0.5, streak) * (P.vnoise(x / 0.12, y * 0.4, 77) - 0.5) * (S.rocking ? 0.4 : 1.2);
        img[k] = val;
      }
    }
    return { img, tr };
  }
  stepSV(dtWall) {
    const S = this.S, sv = this.sv;
    if (!sv || sv.done || S.paused) return false;
    sv.lastWall += dtWall * S.speed;
    if (sv.lastWall < 0.35) return false;
    sv.lastWall = 0;
    const y = sv.y0 + sv.k * sv.s, sl = this.sliceAt(y);
    // shot noise from the imaging dwell
    const counts = S.current * 6.24 * S.dwell * 0.3 * (S.clarity === 'real' ? 1 : 10);
    if (S.clarity === 'real') for (let k = 0; k < sl.img.length; k++) sl.img[k] = P.poisson(sl.img[k] * counts) / counts;
    sv.stack.push(sl.img); sv.truth.push(sl.tr); sv.k++;
    // instrument time: mill one slice (W × Hz × s) and image the face
    const Yv = P.sputter(S.ion, this.dominantMat(sl.tr), S.ikV).Yv, tm = (sv.W * sv.Hz * sv.s) / ((S.icur / 1000) * Yv), ti = (sv.nx * sv.nz * 16 * S.dwell) / 1e6 + 2;
    sv.t += tm + ti; sv.mill += tm; sv.img += ti;
    if (sv.k >= S.svN) sv.done = true;
    return true;
  }
  dominantMat(tr) {
    const c = [0, 0, 0, 0]; for (let k = 0; k < tr.length; k += 13) c[tr[k]]++;
    const names = this.spec.cryo ? ['Ice', 'Cyto', 'Lipid', 'Ice'] : ['vac', 'Binder', 'NMC', 'Al'], mk = names[c.indexOf(Math.max(...c))];
    return mk === 'vac' ? 'Binder' : mk;
  }
  // segmentation by thresholds between the phases' expected signal levels; compared with the truth
  svFractions() {
    const sv = this.sv;
    if (!sv?.k) return null;
    const S = this.S, lv = (mk) => (S.svDet === 'bse' ? P.eta(P.MAT[mk].Z) : P.delta(P.MAT[mk], S.kV) * 0.6 + P.eta(P.MAT[mk].Z) * 0.6);
    const chip = S.spec === 'chip', cryo = !!this.spec.cryo, lp = cryo ? lv('Ice') : 0, lb = lv(chip ? 'SiO2' : cryo ? 'Cyto' : 'Binder'), ln = lv(chip ? 'Cu' : cryo ? 'Lipid' : 'NMC'), t1 = (lp + lb) / 2, t2 = (lb + ln) / 2;
    const meas = [0, 0, 0], tru = [0, 0, 0];
    let nm = 0, nt = 0;
    for (let s = 0; s < sv.k; s++) {
      const a = sv.stack[s], t = sv.truth[s];
      for (let k = 0; k < a.length; k += 3) {
        const c = a[k] < t1 ? 0 : a[k] < t2 ? 1 : 2;
        meas[c]++; nm++;
        if (t[k] < 3) { tru[t[k]]++; nt++; }
      }
    }
    return { measured: meas.map((v) => v / (nm || 1)), truth: tru.map((v) => v / (nt || 1)), names: chip ? ['voids', 'dielectric', 'metal'] : cryo ? ['ice', 'cytoplasm', 'lipid & nuclei'] : ['pores', 'binder', 'particles'] };
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const S = this.S, m = S.mode, t = now();
    // a frozen specimen keeps ageing in real time: ice contamination grows, a warm stage devitrifies it
    if (this.spec.cryo && !S.paused) cryoAge(this.cryo, dt, { T: S.cryoT, anticontam: S.anticontam });
    if (IMG_MODES.includes(m)) {
      if (this.stale.img) { this.computeImage(); this.stale.img = 0; this.version++; }
      if (!S.paused) {
        const frameT = clamp(0.35 + S.dwell * 0.25, 0.35, 8), prev = this.raster;
        this.raster += (dt * S.speed) / frameT;
        if (this.raster >= 1) { this.raster = 0; this.frame++; }
        if ((this.raster * 256 | 0) !== (prev * 256 | 0)) this.version++;
      }
    }
    if (ION_MODES.includes(m)) {
      // patterning runs in instrument time, sped up so a pattern takes ~12 s on screen (or real time)
      const a = this.mill.active;
      if (a && !S.paused) {
        this.millAccel = S.realTime ? 1 : clamp(a.tEst / 12, 1, 2e5);
        const dts = dt * this.millAccel;
        this.mill.update(dts); this.clock += dts;
      } else this.millAccel = 1;
      // imaging erodes what the ion beam looks at (only while it scans, i.e. not paused)
      if (m === 'fib' && !S.paused) {
        this._imgAcc = (this._imgAcc ?? 0) + dt * S.speed;
        if (this._imgAcc > 0.5) {
          const p = this.mill.imaging({ x: S.cx, y: S.cy, w: S.fov, h: S.fov, ion: S.ion, kV: S.ikV, I: S.icur }, this._imgAcc);
          this.imgDose = p.implant; this.imgRemoved = this.mill.measure(p).maxDepth * 1000; this._imgAcc = 0;
        }
      }
      const changed = this.mill.version !== this._mv;
      // the ion image and the SEM view are recomputed on alternate frames, so a refresh never stalls a frame twice
      // refreshes while milling are spaced by their own cost, so they take at most ~a quarter of the frame time
      if (this.stale.ion || (changed && t - (this._mt ?? 0) > (a ? Math.max(350, 4 * (this._rc ?? 0)) : 120))) {
        this._mv = this.mill.version; this._mt = t;
        this.computeIonImage(); this.stale.ion = 0; this._rc = now() - t;
        if (m !== 'fib') this._needSec = true;
        this.version++;
      } else if ((this._needSec || this.stale.img || !this.sec) && m !== 'fib') {
        this.sec = this.computeImage('sec', 192, { mode: 'se' }); this._needSec = false; this.stale.img = 0; this.version++;
      }
      if (!S.paused) {
        const frameT = clamp(0.35 + S.idwell * 0.25, 0.35, 8), prev = this.iraster;
        this.iraster += (dt * S.speed) / frameT;
        if (this.iraster >= 1) { this.iraster = 0; this.iframe++; }
        if ((this.iraster * 256 | 0) !== (prev * 256 | 0)) this.version++;
      }
    }
    if (m === 'ebsd' || m === 'tkd') {
      if (this.stale.img) { this.computeImage(); this.stale.img = 0; }
      if (this.stale.map) { this.startMap(); this.version++; }
      if (!S.paused && this.stepMap(6 * clamp(S.speed, 0.3, 2.5))) this.version++;
    }
    if (m === 'eds') {
      if (this.stale.eds) { this.computeEDS(); this.stale.eds = 0; this.version++; }
      if (!S.paused) { this.accumulateEDS(dt * S.speed); this.version++; }
    }
    if (m === 'mc') {
      if (this.stale.mc) { this.startMC(); this.version++; }
      const mc = this.mc;
      if (mc && !S.paused) {
        if (mc.kind === 'ion' && mc.n < S.mcIons) { mc.run(Math.max(1, Math.ceil(2 * S.speed))); this.version++; }
        else if (mc.kind === 'e' && mc.n < S.mcMax) { mc.run(Math.ceil(25 * S.speed)); this.version++; }
      }
    }
    if (m === 'sv') {
      if (this.stale.sv) { this.startSV(); this.version++; }
      if (this.stepSV(dt)) this.version++;
    }
  }
}

function sharpness(a, n) {
  let s = 0, m = 0;
  for (let i = 0; i < n * n; i++) m += a[i];
  m /= n * n;
  for (let j = 1; j < n - 1; j += 2) for (let i = 1; i < n - 1; i += 2) { const gx = a[j * n + i + 1] - a[j * n + i - 1], gy = a[(j + 1) * n + i] - a[(j - 1) * n + i]; s += gx * gx + gy * gy; }
  return Math.sqrt(s / ((n * n) / 4)) / (m || 1);
}
function triad(a1, a2, b1, b2) {
  const ta = [a1, P.norm(P.cross(a1, a2))]; ta.push(P.cross(ta[0], ta[1]));
  const tb = [b1, P.norm(P.cross(b1, b2))]; tb.push(P.cross(tb[0], tb[1]));
  const O = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) O[r][c] += tb[i][r] * ta[i][c];
  return O;
}
const misoDeg = (A, B) => P.misorientation(A, B) / DEG;
export { lamThickness };
