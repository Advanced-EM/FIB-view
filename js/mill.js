// Patterning engine: ion milling, gas-assisted etching, beam-induced deposition and the damage done by imaging.
//
// Every pattern owns a small grid over its footprint (adaptive: ~128 cells across, so a 200 µm PFIB trench and a
// 2 µm lamella-thinning box both get enough resolution). A grid stores how much material the pattern removed
// (rem, µm) and deposited (dep, µm) at each point. The surface anywhere is
//     Z = top(x, y) + Σ dep − Σ rem
// and what lies at a point is the deposit (above the original surface) or the specimen's own volume (below it).
//
// The beam's dose follows the pattern's exposure map: a box (or a staircase for a regular cross-section) blurred by
// the probe, with a ramp that gives the walls their taper. Each step removes J·Yv(material, local slope, channelling,
// gas) of material and deposits J·(Ydep(J) − Ysput) of precursor, with redeposition slowing deep, narrow trenches.
// Like real FIB software, the pattern's dose is computed from a silicon "application file": in other materials the
// depth reached differs from the depth asked for.
import * as P from './physics.js';

const { clamp, MAT } = P;
const E_CHARGE = 1.602e-19;
let NEXT = 1;

export const SHAPES = {
  rect: 'Rectangle', rcs: 'Regular cross-section', ccs: 'Cleaning cross-section', line: 'Line', circle: 'Circle',
};

export class Mill {
  constructor(spec) {
    this.spec = spec; // () → specimen
    this.patterns = []; this.version = 0; this.time = 0; this.charge = 0;
  }
  reset() { this.patterns = []; this.version++; this.time = 0; this.charge = 0; }
  get active() { return this.patterns.find((p) => p.status === 'running') ?? null; }
  get queued() { return this.patterns.filter((p) => p.status === 'queued'); }

  // ---------------------------------------------------------------- creating patterns
  // o: { kind 'mill'|'dep'|'img', shape, x, y (centre, µm), w, h (µm), depth (µm: removal target in Si, or deposit
  //      thickness), ion, kV, I (pA), gas, beam ('ion'|'e'), face (+1: the face is the +y edge, −1: the −y edge),
  //      overtilt (deg), rocking (bool), status }
  add(o) {
    const sp = this.spec();
    const p = {
      id: NEXT++, kind: o.kind ?? 'mill', shape: o.shape ?? 'rect', x: o.x, y: o.y, w: Math.max(0.01, o.w), h: Math.max(0.01, o.h), depth: o.depth ?? 1,
      ion: o.ion ?? 'Ga', kV: o.kV ?? 30, I: o.I ?? 1000, gas: o.gas ?? null, beam: o.beam ?? 'ion', face: o.face ?? 1, overtilt: o.overtilt ?? 0,
      rocking: !!o.rocking, status: o.status ?? 'queued', label: o.label ?? '', t: 0, done: 0, charge: 0, implant: 0,
    };
    if (p.shape === 'line') p.h = Math.max(p.h, 0.002);
    const pr = p.beam === 'e' ? { d: 5, tail: 0 } : P.ionProbe(p.ion, p.I, p.kV);
    p.sigma = Math.max(0.002, pr.d / 1000 / 2.355); // µm
    p.tail = pr.tail ?? 0;
    // the exposure map extends past the box by the probe blur and its tail
    const wallA = (p.beam === 'e' ? 0 : p.ion === 'Ga' ? 1.6 : 1.2) * P.DEG;
    p.wallA = wallA;
    const margin = 3.2 * p.sigma + p.depth * Math.tan(wallA + Math.abs(p.overtilt) * P.DEG) + 0.02;
    const W = p.w + 2 * margin, H = p.h + 2 * margin;
    const cell = Math.max(0.003, Math.max(W, H) / (o.cells ?? 128));
    const nx = Math.max(4, Math.ceil(W / cell)), ny = Math.max(4, Math.ceil(H / cell));
    const g = { nx, ny, cell, x0: p.x - (nx * cell) / 2, y0: p.y - (ny * cell) / 2, rem: new Float32Array(nx * ny), dep: new Float32Array(nx * ny), w: new Float32Array(nx * ny), top: new Float32Array(nx * ny), memZ: new Float32Array(nx * ny).fill(1e9), memM: new Uint8Array(nx * ny) };
    p.g = g;
    // the original surface under the grid (static)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.top[j * nx + i] = sp.top(g.x0 + (i + 0.5) * cell, g.y0 + (j + 0.5) * cell, cell);
    this.exposure(p);
    // the charge to deliver: depth in silicon (or the deposit thickness at the pattern's current density)
    const A = p.w * p.h, Jn = p.I / 1000 / Math.max(1e-6, A); // nA/µm²
    let Yref;
    if (p.kind === 'dep') {
      const dr = P.depositRate(p.gas, p.beam, p.ion, p.kV, Jn * 1000);
      Yref = Math.max(1e-4, dr.net);
    } else Yref = P.sputter(p.ion, 'Si', p.kV, 0, p.gas).Yv;
    p.Yref = Yref;
    p.Q = (p.depth / Yref) * p.sumW * cell * cell; // nC
    p.tEst = p.Q / (p.I / 1000); // s
    this.patterns.push(p);
    this.version++;
    return p;
  }
  exposure(p) {
    const g = p.g, s = p.sigma, hw = p.w / 2, hh = p.h / 2;
    const ramp = (d, extra) => { // inside distance d from an edge → 0 … 1, with the taper and the probe blur
      const L = p.depth * Math.tan(Math.max(0.002, p.wallA + extra)) + 1.2 * s;
      return clamp((d + 0.6 * s) / L, 0, 1);
    };
    const ot = p.overtilt * P.DEG;
    let sum = 0;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const dx = g.x0 + (i + 0.5) * g.cell - p.x, dy = g.y0 + (j + 0.5) * g.cell - p.y;
      let w;
      if (p.shape === 'circle') { const r = Math.min(hw, hh); w = ramp(r - Math.hypot(dx, dy), 0); }
      else {
        // the face edge gets the over-tilt: a positive over-tilt makes that wall steeper (compensates the taper)
        const ey = p.face > 0 ? [ramp(hh + dy, 0), ramp(hh - dy, -ot)] : [ramp(hh + dy, -ot), ramp(hh - dy, 0)];
        w = ramp(hw - Math.abs(dx), 0) * Math.min(ey[0], ey[1]);
        if (p.shape === 'rcs') { const u = clamp((dy * p.face + hh) / (2 * hh), 0, 1); w *= 0.12 + 0.88 * u; } // staircase: deepest at the face
      }
      // probe tail: a weak halo outside the box
      if (p.tail && w < 0.02) { const ox = Math.max(0, Math.abs(dx) - hw), oy = Math.max(0, Math.abs(dy) - hh), r = Math.hypot(ox, oy); w = Math.max(w, p.tail * Math.exp(-r / (6 * s + 0.005))); }
      g.w[j * g.nx + i] = w; sum += w;
    }
    p.sumW = sum;
  }
  remove(id) { this.patterns = this.patterns.filter((p) => p.id !== id); this.version++; }
  clearQueued() { this.patterns = this.patterns.filter((p) => p.status !== 'queued'); this.version++; }
  start() { const q = this.queued[0]; if (q && !this.active) { q.status = 'running'; this.version++; } return q; }
  stop() { const a = this.active; if (a) { a.status = 'stopped'; this.version++; } }

  // ---------------------------------------------------------------- the surface
  // Σrem and Σdep at (x, y) over every pattern (optionally leaving one out)
  fields(x, y, skip = null) {
    let rem = 0, dep = 0, dmat = null, did = -1;
    for (const p of this.patterns) {
      if (p === skip) continue;
      const g = p.g, fx = (x - g.x0) / g.cell - 0.5, fy = (y - g.y0) / g.cell - 0.5;
      if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) continue;
      const i = fx | 0, j = fy | 0, a = fx - i, b = fy - j, n = g.nx, k = j * n + i;
      const i1 = Math.min(i + 1, g.nx - 1) - i, j1 = (Math.min(j + 1, g.ny - 1) - j) * n;
      rem += (g.rem[k] * (1 - a) + g.rem[k + i1] * a) * (1 - b) + (g.rem[k + j1] * (1 - a) + g.rem[k + j1 + i1] * a) * b;
      if (p.kind === 'dep') {
        const d = (g.dep[k] * (1 - a) + g.dep[k + i1] * a) * (1 - b) + (g.dep[k + j1] * (1 - a) + g.dep[k + j1 + i1] * a) * b;
        if (d > 1e-5) { dep += d; if (p.id > did) { did = p.id; dmat = p.mat; } }
      }
    }
    return { rem, dep, dmat };
  }
  surface(x, y, res = 0) {
    const t = this.spec().top(x, y, res);
    if (!this.patterns.length) return { Z: t, top: t, rem: 0, dep: 0, dmat: null };
    const f = this.fields(x, y);
    return { Z: t + f.dep - f.rem, top: t, ...f };
  }
  // what is at (x, y, Z): the deposit above the original surface, the specimen below
  materialAt(x, y, Z, top = null, f = null) {
    const sp = this.spec(), t = top ?? sp.top(x, y);
    if (Z > t + 1e-6) {
      f ??= this.fields(x, y);
      return Z <= t + f.dep && f.dmat ? { mat: f.dmat, grain: -1, ori: null } : { mat: 'vac', grain: -1, ori: null };
    }
    return sp.vol(x, y, Z);
  }

  // ---------------------------------------------------------------- milling and deposition
  // advance the running pattern (and continuous imaging patterns) by dt seconds of instrument time
  update(dt) {
    let changed = false;
    for (const p of this.patterns) if (p.status === 'running' || p.status === 'imaging') { if (this.step(p, dt)) changed = true; }
    if (changed) this.version++;
    this.time += dt;
    return changed;
  }
  step(p, dt) {
    if (p.status === 'running' && p.t >= p.tEst) { p.status = 'done'; p.done = 1; this.start(); return true; }
    const g = p.g, n = g.nx * g.ny, InA = p.I / 1000;
    const tLeft = p.status === 'running' ? Math.min(dt, p.tEst - p.t) : dt;
    if (tLeft <= 0) return false;
    // dose rate per unit exposure weight (nA/µm²) so that Σ over the grid gives the beam current
    const J0 = InA / (p.sumW * g.cell * g.cell);
    // substeps keep each update below a fraction of a cell in depth
    const Ymax = p.kind === 'dep' ? 1.5 : 4 * P.sputter(p.ion, 'Si', p.kV, 0, p.gas).Yv + 0.02;
    const nSub = clamp(Math.ceil((J0 * Ymax * tLeft) / Math.max(0.003, g.cell * 0.4)), 1, 24), h = tLeft / nSub;
    if (!p.base) this.snapshotBase(p);
    const sp = this.spec(), ionDir = [0, 0, 1];
    // volume yield of every material at normal incidence for this beam (the angle and channelling scale it)
    p.yTab ??= P.MKEYS.map((mk) => (MAT[mk].rho && p.kind !== 'dep' ? P.sputter(p.ion, mk, p.kV, 0, p.gas).Yv : 0));
    const redepK = p.shape === 'ccs' ? 0.2 : p.shape === 'line' ? 0.6 : 0.35, minDim = Math.max(0.05, Math.min(p.w, p.h));
    for (let s = 0; s < nSub; s++) {
      for (let k = 0; k < n; k++) {
        const w = g.w[k];
        if (w < 1e-4) continue;
        const i = k % g.nx, j = (k / g.nx) | 0, x = g.x0 + (i + 0.5) * g.cell, y = g.y0 + (j + 0.5) * g.cell;
        const top = g.top[k], Zs = top + p.base.dep[k] + g.dep[k] - p.base.rem[k] - g.rem[k];
        const J = J0 * w; // nA/µm²
        if (p.kind === 'dep') {
          const dr = P.depositRate(p.gas, p.beam, p.ion, p.kV, J * 1000);
          let dz = J * dr.net * h;
          if (dz >= 0) g.dep[k] += dz;
          else { const fromDep = Math.min(g.dep[k], -dz); g.dep[k] -= fromDep; g.rem[k] += -dz - fromDep; }
          continue;
        }
        // material at the current surface (cached until the surface moves by a few nm)
        let mi;
        if (Math.abs(g.memZ[k] - Zs) > Math.min(0.03, g.cell * 0.5)) {
          const depTot = p.base.dep[k] + g.dep[k], remTot = p.base.rem[k] + g.rem[k];
          let r;
          if (depTot - remTot > 1e-4) r = { mat: p.base.dmat[k] || 'PtC' };
          else r = sp.vol(x, y, Zs - 1e-4);
          mi = P.MKEYS.indexOf(r.mat); g.memM[k] = mi; g.memZ[k] = Zs;
          // channelled ions sputter less: grain-dependent milling
          g.memC ??= new Float32Array(n).fill(1);
          g.memC[k] = r.ori ? 1 - 0.5 * Math.min(1, 1.15 * P.channeling(r.ori, ionDir, 2.4).ch) : 1;
        } else mi = g.memM[k];
        const mk = P.MKEYS[mi];
        if (mk === 'vac') { g.rem[k] += J * 0.02 * h; continue; } // a pore or a hole: the beam goes deeper
        // local slope from the grid (the beam is along the surface normal of the unmilled specimen)
        const zl = i > 0 ? g.rem[k - 1] : g.rem[k], zr = i < g.nx - 1 ? g.rem[k + 1] : g.rem[k], zd = j > 0 ? g.rem[k - g.nx] : g.rem[k], zu = j < g.ny - 1 ? g.rem[k + g.nx] : g.rem[k];
        const slope = Math.hypot(zr - zl, zu - zd) / (2 * g.cell), theta = Math.atan(slope);
        // vertical recession = J·Y(θ)·Ω; the angular rise is capped because sputtered atoms leaving steep walls
        // largely redeposit on the facing floor in a confined trench
        let Yv = p.yTab[mi] * Math.min(P.yamamura(theta), 1.6) * (g.memC ? g.memC[k] : 1);
        // sputtered atoms land on the walls of a deep, narrow trench and are milled again
        const depth = p.base.rem[k] + g.rem[k];
        Yv /= 1 + (redepK * depth) / minDim;
        g.rem[k] += J * Yv * h;
      }
    }
    // redeposition and beam-tail smoothing: material sputtered into a deep, narrow trench lands on its floor and
    // fills troughs; scaled with the aspect ratio
    // (its strength follows the fraction of the pattern milled in this step, so the result does not depend on the step size)
    if (p.kind !== 'dep' && p.kind !== 'img') this.smooth(p, minDim, p.status === 'running' ? clamp((tLeft / p.tEst) * 40, 0, 1) : 1);
    p.t += tLeft; p.charge += InA * tLeft; this.charge += InA * tLeft;
    p.done = p.status === 'running' ? clamp(p.t / p.tEst, 0, 1) : p.done;
    // implanted ions: dose at the pattern centre (ions/nm²)
    p.implant += ((J0 * 1e-9) / E_CHARGE) * tLeft * 1e-6;
    if (p.status === 'running' && p.t >= p.tEst - 1e-9) { p.status = 'done'; p.done = 1; this.start(); }
    return true;
  }
  smooth(p, minDim, w = 1) {
    const g = p.g, n = g.nx, R = g.rem, out = this._sm && this._sm.length === R.length ? this._sm : (this._sm = new Float32Array(R.length));
    out.set(R);
    for (let j = 1; j < g.ny - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      if (g.w[k] < 0.05) continue;
      const avg = 0.25 * (R[k - 1] + R[k + 1] + R[k - n] + R[k + n]);
      if (avg >= R[k]) continue; // only troughs fill in
      const a = clamp(0.06 + (0.25 * R[k]) / minDim, 0, 0.45) * w;
      out[k] = R[k] + a * (avg - R[k]);
    }
    R.set(out);
  }
  // what the other patterns did under this one (constant while it runs; the queue is serial)
  snapshotBase(p) {
    const g = p.g, n = g.nx * g.ny, rem = new Float32Array(n), dep = new Float32Array(n), dmat = new Array(n);
    for (let k = 0; k < n; k++) {
      const x = g.x0 + ((k % g.nx) + 0.5) * g.cell, y = g.y0 + (((k / g.nx) | 0) + 0.5) * g.cell;
      const f = this.fields(x, y, p);
      rem[k] = f.rem; dep[k] = f.dep; dmat[k] = f.dmat;
    }
    p.base = { rem, dep, dmat };
    if (p.kind === 'dep') p.mat = p.beam === 'e' ? P.DEP_GAS[p.gas].matE : P.DEP_GAS[p.gas].mat;
  }
  // the imaging beam erodes what it looks at: one continuous pattern per field of view
  imaging(o, dt) {
    const near = this.patterns.find((p) => p.kind === 'img' && p.ion === o.ion && Math.abs(p.x - o.x) < o.w * 0.15 && Math.abs(p.y - o.y) < o.w * 0.15 && Math.abs(Math.log(p.w / o.w)) < 0.35);
    let p = near;
    if (!p) {
      const imgs = this.patterns.filter((q) => q.kind === 'img');
      if (imgs.length >= 10) p = imgs[0]; // reuse the oldest instead of growing forever
      else p = this.add({ ...o, kind: 'img', shape: 'rect', depth: 0.001, status: 'imaging', cells: 48 });
    }
    p.I = o.I; p.status = 'imaging';
    if (p.base) p.base = null; // other patterns may have changed underneath
    this.step(p, dt);
    p.status = 'idle';
    this.version++;
    return p;
  }

  // ---------------------------------------------------------------- summaries
  // implanted primary ions near (x, y): steady-state surface concentration (atomic fraction) of the beam's element
  implantAt(x, y) {
    let best = null;
    for (const p of this.patterns) {
      if (p.kind === 'dep' && p.beam === 'e') continue;
      const g = p.g;
      if (x < g.x0 || y < g.y0 || x > g.x0 + g.nx * g.cell || y > g.y0 + g.ny * g.cell) continue;
      const f = this.fields(x, y);
      const rem = f.rem; if (rem < 0.002 && p.kind !== 'dep') continue;
      const r = P.ionRange(p.ion, 'Si', p.kV), Y = P.sputter(p.ion, 'Si', p.kV).Y;
      const css = (P.ION[p.ion].implant / (1 + Y)) * (1 - Math.exp(-rem / Math.max(0.002, r.Rp / 1000)));
      const c = p.kind === 'dep' ? 0.12 : css;
      if (!best || c > best.c) best = { el: P.ION[p.ion].el, c, Rp: r.Rp };
    }
    return best;
  }
  // depth profile along a line (for cross-section plots): Z of the surface vs position
  profile(x0, y0, x1, y1, n = 200) {
    const out = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; out.push(this.surface(x, y).Z); }
    return out;
  }
  // measured removed volume and charge of a pattern: the actual volume yield vs the Si application file
  measure(p) {
    const g = p.g; let V = 0, D = 0;
    for (let k = 0; k < g.rem.length; k++) { V += g.rem[k] - g.dep[k]; D = Math.max(D, g.rem[k]); }
    V *= g.cell * g.cell;
    return { volume: V, charge: p.charge, Yv: p.charge ? V / p.charge : 0, maxDepth: D, YvSi: p.Yref };
  }
}

// ================================================================= lamella preparation
// The workflow of a TEM lamella lift-out, with the true geometry the operator can't see directly: thickness at the
// top of the window and at its bottom (the wedge from the sidewall taper), the amorphous damage on each face, the
// implanted Ga, curtaining, and whether the lamella bent or was holed.
export const LAM_STEPS = [
  { id: 'ebeamPt', title: 'Electron-beam Pt', text: 'A first, thin protective layer deposited with the electron beam: no ions touch the surface yet.' },
  { id: 'ionPt', title: 'Ion-beam Pt cap', text: '1–2 µm of ion-beam Pt protects the top edge from the ion beam’s tails during all the milling to come.' },
  { id: 'trenches', title: 'Bulk trenches', text: 'Two regular cross-sections at high current dig staircase trenches on both sides, leaving a ~1.5 µm thick wall.' },
  { id: 'clean', title: 'Cleaning cross-sections', text: 'Line-by-line cleaning cross-sections at medium current flatten both faces to ~1 µm.' },
  { id: 'jcut', title: 'J-cut (undercut)', text: 'At low tilt, the beam cuts under and around the lamella, leaving it hanging by one small tab.' },
  { id: 'liftout', title: 'Lift-out', text: 'The manipulator needle is welded on with Pt, the tab is cut, and the lamella is carried to a TEM grid post and welded there.' },
  { id: 'thin', title: 'Thinning', text: 'Both faces are thinned alternately with decreasing currents and a ±1–2° over-tilt, toward ~100 nm.' },
  { id: 'polish', title: 'Low-kV polish', text: 'A final pass at 5 kV and then 2 kV removes most of the 30 kV amorphous damage on each face.' },
];

export function newLamella(rng = Math.random) {
  return {
    step: 0, t_top: 2000, wedge: 0, amorph: [0, 0], amorphKV: 30, ga: 0, curtain: 0, capLeft: 0, bent: false, hole: false,
    time: 0, offset: (rng() - 0.5) * 60, drift: (rng() - 0.5) * 30, log: [], liftedOut: false, onGrid: false, ion: 'Ga',
  };
}
// thickness (nm) at depth z (µm) below the top of the lamella
export const lamThickness = (L, z) => L.t_top + 2 * z * 1000 * Math.tan(Math.max(0, L.wedge) * P.DEG);
// one thinning pass on both faces: current I (pA), kV, target thickness (nm), over-tilt (deg)
export function thinPass(L, { ion = 'Ga', I = 300, kV = 30, target = 300, overtilt = 1.5, rocking = false, window = 5 }) {
  const pr = P.ionProbe(ion, I, kV), sig = pr.d / 2.355;
  const before = L.t_top;
  // positioning error: half the probe and the hidden drift since the last image
  const err = (L.offset * 0.2 + L.drift) * Math.min(1, sig / 20) + (Math.random() - 0.5) * sig * 0.6;
  let t = Math.max(target, 0) + Math.abs(err) * 0.6 - sig * 0.15;
  // the beam tail eats into the top edge when the cap is gone; the cap thins every pass
  L.capLeft = Math.max(0, L.capLeft - (0.02 + pr.d / 2000) * (kV / 30));
  if (L.capLeft <= 0.05) t -= pr.d * 0.35;
  t = Math.min(before, t);
  // sidewall taper: the wedge angle relaxes toward the beam's natural taper minus the over-tilt
  const taper = (ion === 'Ga' ? 1.6 : 1.2) - overtilt + (I > 2000 ? 0.6 : 0);
  L.wedge = before - t > 30 ? Math.max(0, taper) : L.wedge;
  // damage: each face keeps the amorphous layer of the last (glancing-incidence) pass
  const dmg = 0.5 * P.ionRange(ion, 'Si', kV).damage;
  if (before - t > 2 * dmg || kV < L.amorphKV) { L.amorph = [dmg * (1 + err / 200), dmg * (1 - err / 200)]; L.amorphKV = kV; }
  // risks: too much current on a thin lamella bends it; going below zero makes a hole
  if (t < 250 && I > 1200) L.bent = true;
  if (t < 120 && I > 400) L.bent = true;
  if (t <= 10 || t - 2 * Math.max(...L.amorph) < 0) { L.hole = true; t = Math.max(0, t); }
  // curtaining from milling through the copper levels; rocking and the Pt cap reduce it
  L.curtain = Math.max(0, (L.curtain * 0.5 + (ion === 'Ga' ? 0.25 : 0.45) * (rocking ? 0.35 : 1) * (L.capLeft > 0.1 ? 0.5 : 1.3)));
  if (ion === 'Ga') L.ga = Math.min(8, L.ga + 0.8 * (kV / 30));
  // time: volume removed from both faces over the window (12 µm × window depth)
  const V = (2 * ((before - t) / 2) / 1000) * 12 * window, Yv = P.sputter(ion, 'Si', kV).Yv;
  const dt = V / ((I / 1000) * Yv) + 30;
  L.time += dt; L.t_top = t; L.ion = ion;
  L.drift = (Math.random() - 0.5) * 30;
  L.log.push({ I, kV, target, overtilt, t: Math.round(t), wedge: +L.wedge.toFixed(2), amorph: L.amorph.map((v) => +v.toFixed(1)), dt: Math.round(dt) });
  return dt;
}
// quality summary used by the lamella mode, the training task and the analyses
export function lamQuality(L) {
  const tBot = lamThickness(L, 3), crys = Math.max(0, L.t_top - L.amorph[0] - L.amorph[1]);
  return { t_top: Math.round(L.t_top), t_bottom: Math.round(tBot), crystalline: Math.round(crys), amorph: L.amorph.map((v) => +v.toFixed(1)), ga: +L.ga.toFixed(1), curtain: +L.curtain.toFixed(2), bent: L.bent, hole: L.hole, time_min: +(L.time / 60).toFixed(1) };
}
