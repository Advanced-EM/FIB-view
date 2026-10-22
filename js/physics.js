// FIB-SEM physics: materials, electron–solid and ion–solid interaction, electron and ion probe formation,
// sputtering, gas-assisted deposition and etching, crystallography and volumetric specimens.
// Units: lengths in µm unless noted (nm where stated), energies in keV, angles in radians.
// DOM-free: runs in browsers and in Node (headless runner, MCP server, Python driver).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const DEG = Math.PI / 180;

// ---------------------------------------------------------------- random / hashing
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(i, j, s = 0) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash3 = (i, j, k, s = 0) => hash(i, j + Math.imul(k | 0, 7919), s);
let spare = null;
export function gauss() {
  if (spare !== null) { const g = spare; spare = null; return g; }
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt((-2 * Math.log(s)) / s);
  spare = v * m;
  return u * m;
}
export function poisson(l) {
  if (l <= 0) return 0;
  if (l < 25) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
  return Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
}
// smooth value noise
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * s(fx)) + ((c + (d - c) * s(fx)) - (a + (b - a) * s(fx))) * s(fy);
}
export function vnoise3(x, y, z, seed = 0) {
  const zi = Math.floor(z), fz = z - zi, s = fz * fz * (3 - 2 * fz);
  return vnoise(x, y, seed + zi * 131) * (1 - s) + vnoise(x, y, seed + (zi + 1) * 131) * s;
}

// ---------------------------------------------------------------- electron optics
export function wavelengthA(kV) { const V = kV * 1e3; return 12.2643 / Math.sqrt(V * (1 + 0.978476e-6 * V)); } // Å

// Convergence semi-angle at the specimen: set by the aperture, demagnified onto a working distance.
export const convAngle = (S) => S.aperture * 0.2e-3 * (7 / (S.wd + 2));
// Probe diameter from brightness, aberrations and diffraction (quadrature sum, FW50-like).
export function probe(S) {
  const V = S.kV * 1e3, I = S.current * 1e-12; // A
  const Br = 1e8; // reduced brightness, A m⁻² sr⁻¹ V⁻¹ (Schottky FEG)
  const alpha = convAngle(S); // rad
  const Cs = 0.9e-3 * Math.pow(S.wd / 4, 1.5), Cc = 1.1e-3 * Math.pow(S.wd / 4, 1.1); // m
  const dE = 0.7; // eV
  const lam = wavelengthA(S.kV) * 1e-10;
  const dg = Math.sqrt((4 * I) / (Math.PI * Math.PI * Br * V)) / alpha;
  const ds = 0.5 * Cs * alpha ** 3;
  const dc = Cc * (dE / V) * alpha;
  const dd = (1.22 * lam) / alpha;
  const d = Math.sqrt(dg * dg + ds * ds + dc * dc + dd * dd);
  return { alpha, Cs, Cc, dg: dg * 1e9, ds: ds * 1e9, dc: dc * 1e9, dd: dd * 1e9, d: d * 1e9 }; // nm
}
// Probe size as a function of α with everything else fixed (for the optimisation curve).
export function probeVsAlpha(S, alpha) {
  const V = S.kV * 1e3, I = S.current * 1e-12, Br = 1e8;
  const Cs = 0.9e-3 * Math.pow(S.wd / 4, 1.5), Cc = 1.1e-3 * Math.pow(S.wd / 4, 1.1), lam = wavelengthA(S.kV) * 1e-10;
  const dg = Math.sqrt((4 * I) / (Math.PI * Math.PI * Br * V)) / alpha, ds = 0.5 * Cs * alpha ** 3, dc = Cc * (0.7 / V) * alpha, dd = (1.22 * lam) / alpha;
  return { dg: dg * 1e9, ds: ds * 1e9, dc: dc * 1e9, dd: dd * 1e9, d: Math.sqrt(dg * dg + ds * ds + dc * dc + dd * dd) * 1e9 };
}

// ---------------------------------------------------------------- materials
// dmax/Emax: SE yield maximum and its energy; cond: conductor; E2: second crossover (δ+η = 1)
// FIB: Yv = Ga⁺ 30 keV sputter volume per dose at normal incidence (µm³/nC, the usual "application file" numbers),
// Us surface binding energy (eV), Ed displacement energy (eV), kind (ion-induced SE and secondary-ion behaviour).
export const MAT = {
  vac: { name: 'Vacuum', Z: 0, A: 1, rho: 0, dmax: 0, Emax: 1, cond: true, comp: {}, Yv: 0, Us: 1, Ed: 1, kind: 'vac' },
  C: { name: 'Carbon', Z: 6, A: 12.01, rho: 2.0, dmax: 1.0, Emax: 0.3, cond: true, comp: { C: 1 }, color: '#6d7480', Yv: 0.18, Us: 7.4, Ed: 28, kind: 'carbon' },
  Sn: { name: 'Tin', Z: 50, A: 118.7, rho: 7.29, dmax: 1.35, Emax: 0.5, cond: true, comp: { Sn: 1 }, color: '#c9ced6', Yv: 0.84, Us: 3.1, Ed: 22, kind: 'metal' },
  Ni: { name: 'Nickel', Z: 28, A: 58.69, rho: 8.9, dmax: 1.3, Emax: 0.55, cond: true, comp: { Ni: 1 }, cryst: 'fcc', a: 3.524, color: '#9fb4c7', Yv: 0.14, Us: 4.4, Ed: 24, kind: 'metal' },
  Al2O3: { name: 'Alumina inclusion', Z: 10.6, A: 20.4, rho: 3.95, dmax: 3.0, Emax: 0.45, cond: false, E2: 2.6, comp: { Al: 0.4, O: 0.6 }, color: '#e8a86a', Yv: 0.08, Us: 6, Ed: 30, kind: 'oxide' },
  Si: { name: 'Silicon', Z: 14, A: 28.09, rho: 2.33, dmax: 1.1, Emax: 0.25, cond: true, comp: { Si: 1 }, cryst: 'dia', a: 5.431, color: '#7f8fa3', Yv: 0.27, Us: 4.7, Ed: 15, kind: 'semi' },
  SiO2: { name: 'Silicon dioxide', Z: 10.8, A: 20.0, rho: 2.2, dmax: 2.9, Emax: 0.42, cond: false, E2: 2.1, comp: { Si: 0.333, O: 0.667 }, color: '#5a6e86', Yv: 0.24, Us: 5.5, Ed: 20, kind: 'oxide' },
  Cu: { name: 'Copper', Z: 29, A: 63.55, rho: 8.96, dmax: 1.3, Emax: 0.6, cond: true, comp: { Cu: 1 }, cryst: 'fcc', a: 3.615, color: '#e0915a', Yv: 0.25, Us: 3.5, Ed: 19, kind: 'metal' },
  W: { name: 'Tungsten', Z: 74, A: 183.8, rho: 19.3, dmax: 1.4, Emax: 0.65, cond: true, comp: { W: 1 }, color: '#e6e6f0', Yv: 0.12, Us: 8.7, Ed: 40, kind: 'metal' },
  Al: { name: 'Aluminium', Z: 13, A: 26.98, rho: 2.7, dmax: 0.97, Emax: 0.3, cond: true, comp: { Al: 1 }, cryst: 'fcc', a: 4.05, color: '#aab6c4', Yv: 0.30, Us: 3.4, Ed: 16, kind: 'metal' },
  Pt: { name: 'Platinum', Z: 78, A: 195.1, rho: 21.45, dmax: 1.6, Emax: 0.72, cond: true, comp: { Pt: 1 }, color: '#f2f2f2', Yv: 0.23, Us: 5.8, Ed: 33, kind: 'metal' },
  // gas-assisted deposits: Pt, C and W in a carbon matrix (with implanted Ga when ion-beam deposited)
  PtC: { name: 'Ion-beam Pt (Pt–C)', Z: 40, A: 75, rho: 12, dmax: 1.45, Emax: 0.6, cond: true, comp: { Pt: 0.3, C: 0.55, Ga: 0.15 }, color: '#f0eadb', Yv: 0.15, Us: 5, Ed: 25, kind: 'metal' },
  PtE: { name: 'Electron-beam Pt (Pt–C)', Z: 22, A: 40, rho: 6, dmax: 1.3, Emax: 0.5, cond: true, comp: { Pt: 0.18, C: 0.82 }, color: '#d8d0bf', Yv: 0.2, Us: 5, Ed: 25, kind: 'carbon' },
  CDep: { name: 'Deposited carbon', Z: 6, A: 12.5, rho: 1.9, dmax: 1.0, Emax: 0.3, cond: true, comp: { C: 0.92, Ga: 0.08 }, color: '#7c858f', Yv: 0.2, Us: 7.4, Ed: 28, kind: 'carbon' },
  WDep: { name: 'Deposited tungsten (W–C)', Z: 52, A: 110, rho: 14, dmax: 1.4, Emax: 0.6, cond: true, comp: { W: 0.5, C: 0.35, Ga: 0.15 }, color: '#d9d9ea', Yv: 0.13, Us: 7, Ed: 35, kind: 'metal' },
  // Li-ion cathode: NMC811 secondary particles, PVDF + carbon-black binder
  NMC: { name: 'NMC811 cathode', Z: 20, A: 24.4, rho: 4.75, dmax: 2.4, Emax: 0.45, cond: false, E2: 3.2, comp: { Ni: 0.2, Mn: 0.025, Co: 0.025, O: 0.5, Li: 0.25 }, color: '#9bb7e0', Yv: 0.16, Us: 5.5, Ed: 25, kind: 'oxide' },
  Binder: { name: 'Binder (PVDF + carbon black)', Z: 6.5, A: 12.8, rho: 1.8, dmax: 1.6, Emax: 0.35, cond: true, comp: { C: 0.6, F: 0.33, H: 0.07 }, color: '#5c6370', Yv: 0.45, Us: 4, Ed: 20, kind: 'polymer' },
};
export const MKEYS = Object.keys(MAT);
export const J = (Z) => (9.76 * Z + 58.5 * Math.pow(Z, -0.19)) * 1e-3; // mean ionisation potential, keV
// atoms per nm³
export const atomDensity = (m) => (m.rho ? (m.rho / m.A) * 602.2 : 0);

// Backscatter coefficient (Reuter) and its tilt dependence (Arnal): η(θ) = 1/(1+cos θ)^(9/√Z)
export function eta(Z, tilt = 0) {
  if (!Z) return 0;
  const e0 = -0.0254 + 0.016 * Z - 1.86e-4 * Z * Z + 8.3e-7 * Z * Z * Z;
  if (!tilt) return e0;
  const p = 9 / Math.sqrt(Z), c = Math.cos(tilt);
  return Math.min(0.95, Math.max(e0, 1 / Math.pow(1 + c, p)));
}
// Universal secondary-electron yield curve
export function delta(m, E) {
  if (!m.dmax) return 0;
  const x = E / m.Emax;
  return m.dmax * 1.28 * Math.pow(x, -0.67) * (1 - Math.exp(-1.614 * Math.pow(x, 1.67)));
}
// Kanaya–Okayama range (µm)
export const rangeKO = (m, E) => (m.rho ? (0.0276 * m.A * Math.pow(E, 1.67)) / (Math.pow(m.Z, 0.889) * m.rho) : 0);
// Anderson–Hasler X-ray generation range (µm)
export const rangeX = (m, E0, Ec) => (m.rho && E0 > Ec ? (0.064 * (Math.pow(E0, 1.68) - Math.pow(Ec, 1.68))) / m.rho : 0);
// Charging: an uncoated insulator charges negatively when δ+η < 1 (above E2)
export const charges = (m, E, coated) => !m.cond && !coated && E > m.E2;

// ---------------------------------------------------------------- X-ray lines (keV)
export const XLINES = [
  { el: 'C', line: 'Kα', E: 0.277, Ec: 0.284, w: 1, y: 0.25 },
  { el: 'N', line: 'Kα', E: 0.392, Ec: 0.41, w: 1, y: 0.35 },
  { el: 'O', line: 'Kα', E: 0.525, Ec: 0.532, w: 1, y: 0.45 },
  { el: 'F', line: 'Kα', E: 0.677, Ec: 0.686, w: 1, y: 0.5 },
  { el: 'Al', line: 'Kα', E: 1.487, Ec: 1.56, w: 1, y: 0.9 },
  { el: 'Si', line: 'Kα', E: 1.74, Ec: 1.839, w: 1, y: 1.0 },
  { el: 'Ar', line: 'Kα', E: 2.957, Ec: 3.206, w: 1, y: 1.0 },
  { el: 'Ni', line: 'Lα', E: 0.851, Ec: 0.855, w: 0.25, y: 0.5 },
  { el: 'Ni', line: 'Kα', E: 7.478, Ec: 8.333, w: 1, y: 1.1 },
  { el: 'Ni', line: 'Kβ', E: 8.265, Ec: 8.333, w: 0.13, y: 1.1 },
  { el: 'Mn', line: 'Kα', E: 5.899, Ec: 6.539, w: 1, y: 1.1 },
  { el: 'Co', line: 'Kα', E: 6.93, Ec: 7.709, w: 1, y: 1.1 },
  { el: 'Cu', line: 'Lα', E: 0.93, Ec: 0.933, w: 0.25, y: 0.5 },
  { el: 'Cu', line: 'Kα', E: 8.048, Ec: 8.979, w: 1, y: 1.1 },
  { el: 'Cu', line: 'Kβ', E: 8.905, Ec: 8.979, w: 0.13, y: 1.1 },
  { el: 'Ga', line: 'Lα', E: 1.098, Ec: 1.116, w: 1, y: 0.8 },
  { el: 'Ga', line: 'Kα', E: 9.251, Ec: 10.367, w: 1, y: 1.1 },
  { el: 'W', line: 'Mα', E: 1.775, Ec: 1.81, w: 1, y: 0.7 },
  { el: 'W', line: 'Lα', E: 8.398, Ec: 10.207, w: 1, y: 0.9 },
  { el: 'W', line: 'Lβ', E: 9.672, Ec: 10.207, w: 0.6, y: 0.9 },
  { el: 'Sn', line: 'Lα', E: 3.444, Ec: 3.929, w: 1, y: 0.9 },
  { el: 'Sn', line: 'Lβ', E: 3.663, Ec: 3.929, w: 0.55, y: 0.9 },
  { el: 'Xe', line: 'Lα', E: 4.11, Ec: 4.782, w: 1, y: 0.9 },
  { el: 'Pt', line: 'Mα', E: 2.048, Ec: 2.122, w: 1, y: 0.7 },
  { el: 'Pt', line: 'Lα', E: 9.442, Ec: 11.564, w: 1, y: 0.9 },
];
export const EL_COLOR = { C: '#9aa4b2', N: '#8fd3ff', O: '#ff7d7d', F: '#b3ff8a', Al: '#ffc15e', Si: '#5cb4ff', Ar: '#7fa8ff', Ni: '#5fe3a8', Mn: '#e88cff', Co: '#4dd6d6', Cu: '#ff9a4d', Ga: '#ffd23f', W: '#c99bff', Sn: '#e2e8f0', Xe: '#b48cff', Pt: '#f0e36b', Li: '#ffffff', H: '#ffffff' };
export const detEff = (E) => Math.exp(-Math.pow(0.35 / E, 2)) * Math.exp(-E / 60);
export const edsFWHM = (E) => Math.sqrt(45.7 * 45.7 + 2.355 * 2.355 * 0.115 * 3.8 * E * 1000) / 1000;
// Relative ionisation efficiency (Bethe-like) for overvoltage U
export const ionQ = (U, Ec) => (U > 1 ? Math.log(U) / (U * Ec * Ec) : 0);

// ---------------------------------------------------------------- crystallography (cubic)
export const mat3 = {
  mul: (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])),
  mv: (A, v) => [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]],
  tmv: (A, v) => [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]],
  T: (A) => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]],
  rx: (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
  axisAngle: (u, a) => {
    const [x, y, z] = norm(u), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  },
};
export const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Orientation = matrix mapping crystal vectors to sample vectors. Uniform random via quaternion.
export function randomOri(r1, r2, r3) {
  const a = Math.sqrt(1 - r1), b = Math.sqrt(r1);
  const q = [a * Math.sin(2 * Math.PI * r2), a * Math.cos(2 * Math.PI * r2), b * Math.sin(2 * Math.PI * r3), b * Math.cos(2 * Math.PI * r3)];
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
// 24 proper rotations of the cube
export const CUBIC = (() => {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) M[i][p[i]] = sg[i];
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (det > 0) out.push(M);
  }
  return out;
})();
export function misorientation(A, B) {
  const D = mat3.mul(mat3.T(A), B);
  let best = Math.PI;
  for (const S of CUBIC) {
    const M = mat3.mul(D, S), tr = M[0][0] + M[1][1] + M[2][2];
    best = Math.min(best, Math.acos(clamp((tr - 1) / 2, -1, 1)));
  }
  return best;
}
// Σ3 annealing twin: 60° about <111>
export const twinOf = (O) => mat3.mul(O, mat3.axisAngle([1, 1, 1], Math.PI / 3));

// Inverse-pole-figure colour of sample direction d (default: surface normal Z)
export function ipfColor(O, d = [0, 0, 1]) {
  const v = mat3.tmv(O, d).map(Math.abs).sort((a, b) => a - b); // x ≤ y ≤ z
  let r = v[2] - v[1], g = v[1] - v[0], b = v[0] * Math.SQRT2;
  const m = Math.max(r, g, b) || 1;
  r /= m; g /= m; b /= m;
  return [Math.pow(r, 0.6) * 255, Math.pow(g, 0.6) * 255, Math.pow(b, 0.6) * 255];
}
// How closely a beam direction (sample frame) runs down a low-index zone axis of crystal O: 0 … 1.
// Electrons: channelling lowers backscattering. Ions: channelled ions go deep, so fewer secondaries and less sputtering.
export function channeling(O, dirS, widthScale = 1) {
  const b = mat3.tmv(O, dirS).map(Math.abs).sort((p, q) => q - p);
  const a100 = Math.acos(clamp(b[0], -1, 1)), a110 = Math.acos(clamp((b[0] + b[1]) / Math.SQRT2, -1, 1)), a111 = Math.acos(clamp((b[0] + b[1] + b[2]) / Math.sqrt(3), -1, 1));
  const w = widthScale * DEG;
  return { ch: 0.45 * Math.exp(-((a110 / (6 * w)) ** 2)) + 0.38 * Math.exp(-((a100 / (5 * w)) ** 2)) + 0.3 * Math.exp(-((a111 / (4 * w)) ** 2)), b };
}

// Electron scattering factor (Å): screened core + Mott–Bethe tail + Debye–Waller
const fElec = (Z, s) => (0.3 * Math.pow(Z, 0.8) * Math.exp(-3.5 * s * s) + (0.0239 * Z) / (s * s + 1)) * Math.exp(-0.4 * s * s);
const BASIS = {
  fcc: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]],
  dia: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]],
};
// Kikuchi band list: plane normals (crystal frame) with width (sin θB) and strength.
const bandCache = new Map();
export function kikuchiBands(matKey, kV) {
  const key = matKey + kV;
  if (bandCache.has(key)) return bandCache.get(key);
  const m = MAT[matKey], basis = BASIS[m.cryst], lam = wavelengthA(kV);
  const fams = new Map();
  for (let h = -4; h <= 4; h++) for (let k = -4; k <= 4; k++) for (let l = -4; l <= 4; l++) {
    const n2 = h * h + k * k + l * l;
    if (!n2 || n2 > 20) continue;
    let re = 0, im = 0;
    const s = Math.sqrt(n2) / (2 * m.a);
    for (const [x, y, z] of basis) { const p = 2 * Math.PI * (h * x + k * y + l * z); re += Math.cos(p); im += Math.sin(p); }
    const F = Math.hypot(re, im) * fElec(m.Z, s);
    if (F < 0.5) continue;
    const first = [h, k, l].find((v) => v !== 0);
    if (first < 0) continue;
    const fam = [h, k, l].map(Math.abs).sort((a, b) => b - a).join('');
    if (!fams.has(fam)) fams.set(fam, { fam, n2, F, normals: [] });
    fams.get(fam).normals.push({ hkl: [h, k, l], n: norm([h, k, l]) });
  }
  const list = [...fams.values()].sort((a, b) => a.n2 - b.n2);
  const Fm = Math.max(...list.map((f) => f.F));
  const bands = [];
  for (const f of list) {
    const d = m.a / Math.sqrt(f.n2), sB = lam / (2 * d);
    for (const nm of f.normals) bands.push({ ...nm, fam: f.fam, sB, w: Math.pow(f.F / Fm, 1.2) });
  }
  const out = { bands, fams: list.map((f) => f.fam) };
  bandCache.set(key, out);
  return out;
}
export function indexerNormals(matKey) {
  const fams = MAT[matKey].cryst === 'dia' ? ['111', '220', '311', '400'] : ['111', '200', '220', '311'];
  return kikuchiBands(matKey, 20).bands.filter((b) => fams.includes(b.fam));
}

// ---------------------------------------------------------------- electron Monte Carlo
// Single-scattering Monte Carlo: screened Rutherford elastic scattering, Joy–Luo continuous energy loss.
const NA = 6.022e23;
export class MonteCarlo {
  constructor(mKey, E0, tiltDeg, lineEc) {
    this.kind = 'e';
    this.m = MAT[mKey]; this.mKey = mKey; this.E0 = E0; this.tilt = tiltDeg * DEG; this.Ec = lineEc;
    this.n = 0; this.nBSE = 0; this.traj = [];
    this.R = rangeKO(this.m, E0) * 1000; // nm
    this.bins = 60;
    this.bseE = new Float32Array(40); this.depthE = new Float32Array(this.bins); this.phi = new Float32Array(this.bins);
    this.lateral = new Float32Array(this.bins); this.maxDepth = 0;
    this.Jk = J(this.m.Z);
  }
  run(count, keepTraj = 150) {
    const m = this.m, Z = m.Z, A = m.A, rho = m.rho, E0 = this.E0, Jk = this.Jk, Ec = this.Ec;
    const zMax = this.R * 1.25, bins = this.bins;
    for (let e = 0; e < count; e++) {
      let x = 0, y = 0, z = 0, E = E0;
      let cx = 0, cy = Math.sin(this.tilt), cz = Math.cos(this.tilt);
      const keep = this.traj.length < keepTraj, pts = keep ? [[x, z, E]] : null;
      let steps = 0, bse = false;
      while (E > 0.05 && steps < 4000) {
        steps++;
        const al = (3.4e-3 * Math.pow(Z, 0.67)) / E;
        const sig = 5.21e-21 * ((Z * Z) / (E * E)) * ((4 * Math.PI) / (al * (1 + al))) * Math.pow((E + 511) / (E + 1024), 2);
        const lam = (A / (NA * rho * sig)) * 1e7; // nm
        const s = -lam * Math.log(Math.random() || 1e-9);
        const nx = x + s * cx, ny = y + s * cy, nz = z + s * cz;
        if (nz < 0) {
          bse = true;
          this.bseE[Math.min(39, Math.floor((E / E0) * 40))]++;
          if (pts) pts.push([x + (-z / (cz || -1e-9)) * cx, 0, E]);
          break;
        }
        const dEds = 7.85e-3 * ((rho * Z) / (A * E)) * Math.log(Math.max(1.0001, (1.166 * (E + 0.85 * Jk)) / Jk));
        const dE = Math.min(E, dEds * s);
        const zm = (z + nz) / 2, bi = Math.min(bins - 1, Math.floor((zm / zMax) * bins));
        this.depthE[bi] += dE;
        if (E > Ec) this.phi[bi] += s * ionQ(E / Ec, Ec);
        const r = Math.hypot((x + nx) / 2, (y + ny) / 2), li = Math.min(bins - 1, Math.floor((r / zMax) * bins));
        this.lateral[li] += dE;
        x = nx; y = ny; z = nz; E -= dE;
        if (z > this.maxDepth) this.maxDepth = z;
        if (pts && (steps % 2 === 0 || E < 0.3)) pts.push([x, z, E]);
        const R = Math.random();
        const ct = 1 - (2 * al * R) / (1 + al - R), st = Math.sqrt(Math.max(0, 1 - ct * ct));
        const ph = 2 * Math.PI * Math.random(), cp = Math.cos(ph), sp = Math.sin(ph);
        if (Math.abs(cz) > 0.99999) { cx = st * cp; cy = st * sp; cz = ct * Math.sign(cz); }
        else {
          const tmp = Math.sqrt(1 - cz * cz);
          const ncx = st * (cx * cz * cp - cy * sp) / tmp + cx * ct;
          const ncy = st * (cy * cz * cp + cx * sp) / tmp + cy * ct;
          const ncz = -st * cp * tmp + cz * ct;
          cx = ncx; cy = ncy; cz = ncz;
        }
      }
      this.n++;
      if (bse) this.nBSE++;
      if (keep) this.traj.push({ pts, bse });
    }
  }
  get eta() { return this.n ? this.nBSE / this.n : 0; }
}

// ================================================================= ION BEAM PHYSICS
// Sources: a gallium liquid-metal ion source (LMIS), or an inductively coupled plasma (ICP) source that can run
// xenon, argon, nitrogen or oxygen ("plasma FIB", PFIB). Probe size vs current follows measured column
// performance: a source-limited floor at low current, a chromatic/brightness term ∝ I^0.35, and a
// spherical/space-charge term ∝ I^0.9 at the highest currents. Lower voltage enlarges the probe.
export const ION = {
  Ga: { key: 'Ga', name: 'Ga⁺', long: 'gallium', Z: 31, M: 69.72, src: 'LMIS', d0: 2.6, a: 25, b: 8, dE: 5, Br: '~1 × 10⁶', color: '#ffb347', rgb: [1, 0.7, 0.28], el: 'Ga', implant: 1,
    currents: [1, 8, 25, 50, 100, 300, 800, 2500, 9000, 21000, 65000] },
  Xe: { key: 'Xe', name: 'Xe⁺', long: 'xenon', Z: 54, M: 131.29, src: 'ICP plasma', d0: 15, a: 55, b: 4, dE: 6, Br: '~1 × 10⁴', color: '#b48cff', rgb: [0.72, 0.55, 1], el: 'Xe', implant: 0.45,
    currents: [1.5, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2500000] },
  Ar: { key: 'Ar', name: 'Ar⁺', long: 'argon', Z: 18, M: 39.95, src: 'ICP plasma', d0: 17, a: 60, b: 4.4, dE: 6, Br: '~1 × 10⁴', color: '#6fa8ff', rgb: [0.45, 0.66, 1], el: 'Ar', implant: 0.35,
    currents: [1.5, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1300000, 2000000] },
  N: { key: 'N', name: 'N⁺', long: 'nitrogen', Z: 7, M: 14.007, src: 'ICP plasma', d0: 22, a: 70, b: 5, dE: 7, Br: '~5 × 10³', color: '#7dffb0', rgb: [0.5, 1, 0.7], el: 'N', implant: 0.4,
    currents: [1.5, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1000000] },
  O: { key: 'O', name: 'O⁺', long: 'oxygen', Z: 8, M: 16.0, src: 'ICP plasma', d0: 20, a: 68, b: 5, dE: 7, Br: '~5 × 10³', color: '#ff7f7f', rgb: [1, 0.5, 0.5], el: 'O', implant: 0.5,
    currents: [1.5, 10, 30, 100, 300, 1000, 4000, 15000, 60000, 200000, 500000, 1000000] },
};
export const ION_KEYS = Object.keys(ION);
export const fmtCurrent = (pA) => (pA >= 1e6 ? `${+(pA / 1e6).toFixed(2)} µA` : pA >= 1000 ? `${+(pA / 1000).toFixed(pA < 1e4 ? 2 : 1)} nA` : `${+pA.toFixed(pA < 10 ? 1 : 0)} pA`);
// ion probe diameter (nm, FW50) at current I (pA) and voltage (kV)
export function ionProbe(ionKey, I_pA, kV) {
  const s = ION[ionKey], I = I_pA / 1000, lowkV = Math.pow(30 / clamp(kV, 0.5, 30), 0.7);
  const src = s.d0, chrom = s.a * Math.pow(I, 0.35), sph = s.b * Math.pow(I, 0.9);
  const d = Math.sqrt(src * src + chrom * chrom + sph * sph) * lowkV;
  // convergence semi-angle: ~0.3–1 mrad for low currents, a few mrad at high current
  const alpha = (0.25 + 0.55 * Math.pow(I + 0.001, 0.22)) * 1e-3;
  return { d, src: src * lowkV, chrom: chrom * lowkV, sph: sph * lowkV, alpha, tail: s.src === 'LMIS' ? 0.05 : 0.08 };
}
export function nearestCurrent(ionKey, pA) {
  return ION[ionKey].currents.reduce((a, b) => (Math.abs(Math.log(b / pA)) < Math.abs(Math.log(a / pA)) ? b : a));
}

// ZBL universal nuclear stopping (eV cm² per atom × 1e15 → "eV / (1e15 atoms/cm²)") and reduced energy
export function reducedEnergy(Z1, M1, Z2, M2, E_keV) {
  return (32.53 * M2 * E_keV) / (Z1 * Z2 * (M1 + M2) * (Math.pow(Z1, 0.23) + Math.pow(Z2, 0.23)));
}
export function snReduced(eps) {
  if (eps > 30) return Math.log(eps) / (2 * eps);
  return Math.log(1 + 1.1383 * eps) / (2 * (eps + 0.01321 * Math.pow(eps, 0.21226) + 0.19593 * Math.sqrt(eps)));
}
export function Sn(Z1, M1, Z2, M2, E_keV) { // eV / (1e15 atoms / cm²)
  return (8.462 * Z1 * Z2 * M1 * snReduced(reducedEnergy(Z1, M1, Z2, M2, E_keV))) / ((M1 + M2) * (Math.pow(Z1, 0.23) + Math.pow(Z2, 0.23)));
}
// Lindhard–Scharff electronic stopping, eV·Å² per atom (E in eV)
export function SeLSS(Z1, M1, Z2, E_eV) {
  const k = (1.212 * Math.pow(Z1, 7 / 6) * Z2) / (Math.pow(Math.pow(Z1, 2 / 3) + Math.pow(Z2, 2 / 3), 1.5) * Math.sqrt(M1));
  return k * Math.sqrt(Math.max(0, E_eV));
}
// Sigmund's α(M2/M1)
const sigAlpha = (r) => clamp(0.15 + 0.13 * r, 0.15, 1.6);
// gas-assisted chemistry on sputtering: XeF₂ volatilises Si, SiO₂ and W; water vapour oxidises carbon
export const ETCH_GAS = {
  XeF2: { name: 'XeF₂ (enhanced etch)', factor: { Si: 8, SiO2: 5, W: 6, Al: 0.5, Cu: 1, Ni: 0.8, Al2O3: 1, NMC: 1.2, C: 1, Binder: 1.5, PtC: 1.5, PtE: 1.5, CDep: 1, WDep: 4, Sn: 1, Pt: 1 } },
  H2O: { name: 'H₂O (carbon etch)', factor: { C: 9, Binder: 6, CDep: 9, PtE: 3, PtC: 1.8, Si: 0.8, SiO2: 0.9, Cu: 1, Al: 0.7, W: 1, Ni: 1, Al2O3: 1, NMC: 1, Sn: 1, Pt: 1, WDep: 1.2 } },
};
// chemistry of the beam itself: oxygen ions burn carbon and polymer away and slow metal milling (an oxide forms);
// nitrogen forms nitrides on metals
function beamChemistry(ionKey, m) {
  if (ionKey === 'O') return m.kind === 'polymer' ? 4 : m.kind === 'carbon' ? 3.2 : m.kind === 'metal' ? 0.65 : 1;
  if (ionKey === 'N') return m.kind === 'metal' ? 0.85 : 1;
  return 1;
}
// Yamamura angular dependence of sputtering: rises as 1/cosᶠθ, collapses near grazing incidence (θopt ≈ 75°)
const COPT = Math.cos(75 * DEG);
export function yamamura(theta) {
  if (!theta) return 1;
  const c = Math.cos(clamp(Math.abs(theta), 0, 89.5 * DEG));
  return Math.pow(c, -2) * Math.exp(2 * (1 - 1 / c) * COPT);
}
// Sputter yield (atoms/ion) and volume yield (µm³/nC) of ion species on material at energy E (keV), incidence θ
const yCache = new Map();
export function sputter(ionKey, matKey, E_keV, theta = 0, gas = null) {
  const m = MAT[matKey];
  if (!m || !m.rho || !m.Yv) return { Y: 0, Yv: 0 };
  const key = `${ionKey}|${matKey}|${E_keV.toFixed(2)}`;
  let base = yCache.get(key);
  if (base === undefined) {
    const N = atomDensity(m), Ga = ION.Ga, I = ION[ionKey];
    const Y30Ga = (m.Yv * N) / 6.2415; // atoms per ion, Ga 30 keV (from the volume yield)
    // Sigmund scaling with species and energy: Y ∝ α(M2/M1)·Sn(E)/U
    const ref = sigAlpha(m.A / Ga.M) * Sn(Ga.Z, Ga.M, m.Z, m.A, 30);
    const thr = (Eth) => Math.pow(Math.max(0, 1 - Math.sqrt(Eth / (E_keV * 1000))), 2);
    const Eth = m.Us * (I.M > m.A ? 8 * Math.pow(I.M / m.A, 0.4) : 1 / ((4 * I.M * m.A) / (I.M + m.A) ** 2 * (1 - (4 * I.M * m.A) / (I.M + m.A) ** 2) + 1e-3));
    const now = sigAlpha(m.A / I.M) * Sn(I.Z, I.M, m.Z, m.A, E_keV) * thr(Eth);
    base = Y30Ga * (now / ref) * beamChemistry(ionKey, m);
    yCache.set(key, base);
  }
  let Y = base * yamamura(theta);
  if (gas && ETCH_GAS[gas]) Y *= ETCH_GAS[gas].factor[matKey] ?? 1;
  const Yv = (Y * 6.2415) / atomDensity(m); // µm³/nC
  return { Y, Yv };
}

// Ion-induced secondary electrons (kinetic emission ∝ electronic stopping): metals bright, oxides dim.
const ISE_KIND = { metal: 1.0, semi: 0.8, oxide: 0.42, carbon: 0.7, polymer: 0.38, vac: 0 };
export function iseYield(ionKey, matKey, E_keV) {
  const m = MAT[matKey], I = ION[ionKey];
  if (!m.rho) return 0;
  const se = SeLSS(I.Z, I.M, m.Z, E_keV * 1000) * atomDensity(m) * 1e-2; // eV/nm
  const ref = SeLSS(31, 69.72, 14, 30000) * atomDensity(MAT.Si) * 1e-2;
  return 1.6 * ISE_KIND[m.kind] * Math.pow(se / ref, 0.8);
}
// Secondary (sputtered) ions: oxygen at the surface enhances positive-ion emission by orders of magnitude, which is
// why oxides look bright in SI images and why O⁺/O₂⁺ beams are used for SIMS.
const SI_KIND = { metal: 0.12, semi: 0.2, oxide: 1.0, carbon: 0.08, polymer: 0.15, vac: 0 };
export function siYield(ionKey, matKey, E_keV) {
  const m = MAT[matKey];
  if (!m.rho) return 0;
  const enh = ionKey === 'O' ? (m.kind === 'oxide' ? 1.5 : 6) : ionKey === 'Ga' ? 1.3 : 1;
  return Math.min(4, SI_KIND[m.kind] * enh) * sputter(ionKey, matKey, E_keV).Y;
}

// ---------------------------------------------------------------- binary-collision Monte Carlo (TRIM-like)
// Ions slow down by nuclear collisions with the Ziegler–Biersack–Littmark universal potential (scattering angles
// from a precomputed table of the classical scattering integral) and continuous Lindhard–Scharff electronic loss.
// Recoils above the displacement energy start their own cascades; target atoms leaving through the surface with
// enough normal energy to overcome the surface binding are sputtered.
const ZBL = (x) => 0.1818 * Math.exp(-3.2 * x) + 0.5099 * Math.exp(-0.9423 * x) + 0.2802 * Math.exp(-0.4029 * x) + 0.02817 * Math.exp(-0.2016 * x);
const GL = (() => { // 24-point Gauss–Legendre on (0, 1)
  const n = 24, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 50; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-14) break;
    }
    x.push((1 - z) / 2); w.push(1 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();
function scatterAngle(eps, b) {
  // distance of closest approach: x² − xΦ(x)/ε − b² = 0
  const f = (x) => x * x - (x * ZBL(x)) / eps - b * b;
  let lo = Math.max(1e-6, b * 0.5), hi = b + 1 / eps + 20;
  while (f(lo) > 0 && lo > 1e-9) lo *= 0.5;
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (f(mid) > 0) hi = mid; else lo = mid; }
  const x0 = hi;
  // θ = π − 2b ∫₀¹ 2s ds / (x0 √g(u)),  u = 1 − s², g(u) = 1 − Φ(x0/u)u/(x0 ε) − (b u/x0)²
  let I = 0;
  for (let k = 0; k < GL.x.length; k++) {
    const s = GL.x[k], u = 1 - s * s, g = 1 - (ZBL(x0 / u) * u) / (x0 * eps) - ((b * u) / x0) ** 2;
    if (g > 0) I += (GL.w[k] * 2 * s) / Math.sqrt(g);
  }
  return clamp(Math.PI - (2 * b * I) / x0, 0, Math.PI);
}
const SCAT = (() => {
  const nE = 48, nB = 72, lo = -3.5, hi = 3.5, tab = new Float32Array(nE * nB), bs = [];
  for (let j = 0; j < nB; j++) bs.push(30 * (j / (nB - 1)) ** 2);
  for (let i = 0; i < nE; i++) {
    const eps = Math.pow(10, lo + ((hi - lo) * i) / (nE - 1));
    for (let j = 0; j < nB; j++) tab[i * nB + j] = j ? scatterAngle(eps, bs[j]) : Math.PI;
  }
  return { nE, nB, lo, hi, tab };
})();
function thetaCM(eps, b) {
  const t = SCAT, le = clamp((Math.log10(eps) - t.lo) / (t.hi - t.lo), 0, 1) * (t.nE - 1);
  const bj = clamp(Math.sqrt(b / 30), 0, 1) * (t.nB - 1);
  const i = Math.min(t.nE - 2, Math.floor(le)), j = Math.min(t.nB - 2, Math.floor(bj)), fi = le - i, fj = bj - j;
  const T = t.tab, n = t.nB;
  if (b > 30) return 0;
  return (T[i * n + j] * (1 - fi) + T[(i + 1) * n + j] * fi) * (1 - fj) + (T[i * n + j + 1] * (1 - fi) + T[(i + 1) * n + j + 1] * fi) * fj;
}

export class IonCascade {
  // ionKey, target material key, energy (keV), incidence angle (deg), full cascade (recoils followed) or primaries only
  constructor(ionKey, mKey, E_keV, incDeg = 0, full = true) {
    this.kind = 'ion';
    this.ion = ION[ionKey]; this.ionKey = ionKey; this.m = MAT[mKey]; this.mKey = mKey; this.E0 = E_keV; this.inc = incDeg * DEG; this.full = full;
    const m = this.m;
    this.N = atomDensity(m) || 50; // /nm³
    this.L = Math.pow(this.N, -1 / 3); // mean free flight path (nm)
    this.pmax = 1 / Math.sqrt(Math.PI * this.N * this.L);
    this.n = 0; this.sput = 0; this.vac = 0; this.back = 0;
    this.bins = 60; this.zMax = 1; // nm, grows
    this.implant = []; this.vacZ = []; this.sputE = new Float32Array(40); this.traj = [];
    this.lateralMax = 0;
  }
  // one collision partner pair → reduced quantities
  pair(Z1, M1) {
    const m = this.m, Z2 = m.Z, M2 = m.A;
    const a = (0.8854 * 0.0529) / (Math.pow(Z1, 0.23) + Math.pow(Z2, 0.23)); // nm
    return { a, kE: (a * M2) / (Z1 * Z2 * 1.44 * (M1 + M2)), gam: (4 * M1 * M2) / (M1 + M2) ** 2, mu: M1 / M2, k: SeLSS(Z1, M1, Z2, 1) * 1e-2 * this.N };
  }
  follow(Z1, M1, E, pos, dir, isIon, path, budget) {
    const m = this.m, P = this.pair(Z1, M1), Us = m.Us, Ed = m.Ed, Ecut = isIon ? 5 : Math.max(2, Us * 0.6);
    let [x, y, z] = pos, [ux, uy, uz] = dir, steps = 0;
    while (E > Ecut && steps < 5000) {
      steps++;
      const L = this.L * (0.6 + 0.8 * Math.random());
      const nx = x + ux * L, ny = y + uy * L, nz = z + uz * L;
      if (nz < 0) {
        // crossing the surface
        if (isIon) { this.back++; if (path) path.push([x + (-z / (uz || -1e-9)) * ux, 0]); return { out: true }; }
        const cosn = -uz;
        if (E * cosn * cosn > Us) { this.sput++; const b = Math.floor((E - Us) / 2.5); if (b < 40) this.sputE[b]++; if (path) path.push([nx, 0]); return { out: true, sputtered: true }; }
        // reflected back by the surface barrier
        uz = -uz; continue;
      }
      x = nx; y = ny; z = nz;
      if (path && (steps % 2 === 0)) path.push([x, z]);
      // electronic loss
      E = Math.max(0, E - P.k * Math.sqrt(E) * L);
      // nuclear collision
      const p = this.pmax * Math.sqrt(Math.random()), eps = P.kE * E, b = p / P.a;
      const th = thetaCM(eps, b);
      const T = P.gam * E * Math.sin(th / 2) ** 2;
      E -= T;
      // lab-frame deflection of the projectile and the recoil direction
      const psi = Math.atan2(Math.sin(th), Math.cos(th) + P.mu), phi = 2 * Math.PI * Math.random();
      const rec = (Math.PI - th) / 2;
      if (T > Ed && this.full && budget.n > 0) {
        budget.n--; this.vac++; this.vacZ.push(z);
        const rd = rotate(ux, uy, uz, rec, phi + Math.PI);
        const rp = path && this.traj.length < 25 && budget.drawn < 60 ? [[x, z]] : null;
        if (rp) budget.drawn++;
        const r = this.follow(m.Z, m.A, T - 1, [x, y, z], rd, false, rp, budget);
        if (rp && rp.length > 1) budget.rec.push({ pts: rp, sp: !!r.sputtered });
      } else if (T > Ed && !this.full) { this.vac++; this.vacZ.push(z); }
      [ux, uy, uz] = rotate(ux, uy, uz, psi, phi);
      if (z > this.zMax) this.zMax = z;
    }
    if (isIon) { this.implant.push(z); this.lateralMax = Math.max(this.lateralMax, Math.hypot(x, y)); if (path) path.push([x, z]); }
    return { out: false };
  }
  run(count) {
    for (let i = 0; i < count; i++) {
      const keep = this.traj.length < 25;
      const path = keep ? [[0, 0]] : null, budget = { n: this.full ? 4000 : 0, drawn: 0, rec: [] };
      const dir = [0, Math.sin(this.inc), Math.cos(this.inc)];
      this.follow(this.ion.Z, this.ion.M, this.E0 * 1000, [0, 0, 1e-4], dir, true, path, budget);
      this.n++;
      if (keep) this.traj.push({ pts: path, rec: budget.rec });
    }
  }
  get Y() { return this.n ? this.sput / this.n : 0; }
  stats() {
    const im = this.implant, n = im.length;
    if (!n) return { Rp: 0, dRp: 0 };
    let s = 0; for (const z of im) s += z;
    const Rp = s / n; let v = 0; for (const z of im) v += (z - Rp) ** 2;
    return { Rp, dRp: Math.sqrt(v / n) };
  }
}
function rotate(ux, uy, uz, th, ph) {
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  if (Math.abs(uz) > 0.99999) return [st * cp, st * sp, ct * Math.sign(uz)];
  const t = Math.sqrt(1 - uz * uz);
  return [(st * (ux * uz * cp - uy * sp)) / t + ux * ct, (st * (uy * uz * cp + ux * sp)) / t + uy * ct, -st * cp * t + uz * ct];
}
// projected range, straggle and amorphised depth of an ion species in a material (nm), from a quick primaries-only run
const rCache = new Map();
export function ionRange(ionKey, mKey, E_keV) {
  const m = MAT[mKey];
  if (!m?.rho) return { Rp: 0, dRp: 0, damage: 0 };
  const key = `${ionKey}|${mKey}|${E_keV.toFixed(1)}`;
  if (rCache.has(key)) return rCache.get(key);
  const mc = new IonCascade(ionKey, mKey, E_keV, 0, false);
  mc.run(160);
  const { Rp, dRp } = mc.stats();
  // the amorphous layer: where the displacement density exceeds the amorphisation threshold (~ to Rp + 1.5ΔRp)
  const r = { Rp, dRp, damage: m.cryst || m.kind === 'semi' ? Rp + 1.5 * dRp : 0.6 * (Rp + dRp) };
  rCache.set(key, r);
  return r;
}

// ---------------------------------------------------------------- gas injection: beam-induced deposition
// Deposition yield (µm³/nC) falls once the beam consumes precursor faster than it adsorbs (Y0/(1+J/Jc)): low current
// density is reaction-limited, high current density is precursor-limited, and above it the beam's own sputtering wins.
export const DEP_GAS = {
  Pt: { name: 'Pt (MeCpPtMe₃)', mat: 'PtC', matE: 'PtE', Y0: 1.35, Jc: 6, Y0e: 0.022, Jce: 120 },
  C: { name: 'C (naphthalene)', mat: 'CDep', matE: 'CDep', Y0: 1.1, Jc: 9, Y0e: 0.03, Jce: 160 },
  W: { name: 'W (W(CO)₆)', mat: 'WDep', matE: 'WDep', Y0: 0.9, Jc: 6, Y0e: 0.012, Jce: 120 },
};
// current density J in pA/µm²; ions → the deposit is also sputtered by the beam
export function depositRate(gasKey, beam, ionKey, kV, J) {
  const g = DEP_GAS[gasKey];
  if (beam === 'e') { const Yd = g.Y0e / (1 + J / g.Jce); return { Yd, Ys: 0, net: Yd }; }
  const sp = sputter(ionKey, g.mat, kV).Yv, ionScale = ionKey === 'Ga' ? 1 : 0.8;
  const Yd = (g.Y0 * ionScale * Math.pow(kV / 30, 0.3)) / (1 + J / g.Jc);
  return { Yd, Ys: sp, net: Yd - sp };
}

// ================================================================= SPECIMENS
// Each specimen is a volume: top(x, y, res) is the original surface height Z (µm, up positive) and vol(x, y, Z)
// the material below it, so milling can expose what is underneath at any depth and magnification.
function voronoi(x, y, cell, seed) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = Infinity, second = Infinity, id = 0, ix = 0, iy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j;
    const px = (gx + 0.15 + 0.7 * hash(gx, gy, seed)) * cell, py = (gy + 0.15 + 0.7 * hash(gx, gy, seed + 7)) * cell;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) { second = best; best = d; id = gx * 73856093 ^ gy * 19349663; ix = gx; iy = gy; }
    else if (d < second) second = d;
  }
  return { id: id >>> 0, ix, iy, edge: Math.sqrt(second) - Math.sqrt(best) };
}
function voronoi3(x, y, z, cell, seed) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
  let best = Infinity, second = Infinity, id = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j, gz = cz + k;
    const px = (gx + 0.15 + 0.7 * hash3(gx, gy, gz, seed)) * cell, py = (gy + 0.15 + 0.7 * hash3(gx, gy, gz, seed + 7)) * cell, pz = (gz + 0.15 + 0.7 * hash3(gx, gy, gz, seed + 13)) * cell;
    const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
    if (d < best) { second = best; best = d; id = (gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791); }
    else if (d < second) second = d;
  }
  return { id: id >>> 0, edge: Math.sqrt(second) - Math.sqrt(best) };
}
const oriCache = new Map();
function grainOri(id, seed) {
  const key = id + '|' + seed;
  let o = oriCache.get(key);
  if (!o) {
    o = randomOri(hash(id, 1, seed), hash(id, 2, seed), hash(id, 3, seed));
    if (oriCache.size > 20000) oriCache.clear();
    oriCache.set(key, o);
  }
  return o;
}
function twinned(x, y, g, seed, cell, prob) {
  const O = grainOri(g.id, seed);
  if (hash(g.id, 9, seed) > prob) return { O, t: 0 };
  const a = hash(g.id, 10, seed) * Math.PI, w = cell * (0.08 + 0.12 * hash(g.id, 11, seed));
  const u = x * Math.cos(a) + y * Math.sin(a) + hash(g.id, 12, seed) * cell;
  const band = Math.floor(u / w);
  return band % 3 === 0 ? { O: twinOf(O), t: 1 } : { O, t: 0 };
}
const R = (mat, extra = {}) => ({ mat, grain: -1, ori: null, ...extra });
const VAC = R('vac');

// --- microchip: passivation, Al bond pads, three copper levels with tungsten vias, silicon substrate.
// Lines run along y, so a cut across y (a cross-section face) shows the stack.
const PAD = 12;
function chipVol(x, y, Z) {
  const X = ((x % PAD) + PAD) % PAD, Yp = ((y % PAD) + PAD) % PAD;
  const pad = X > 2 && X < 10 && Yp > 2 && Yp < 10;
  if (Z > -1.0) {
    if (pad && Z < -0.12 + 1e-9) {
      const g = voronoi(x, y, 1.1, 41);
      return R('Al', { grain: g.id, ori: grainOri(g.id, 41), gb: g.edge });
    }
    return R('SiO2');
  }
  if (Z < -6.8) return R('Si', { grain: 1, ori: mat3.axisAngle([0, 0, 1], 0.3) });
  const line = (lo, hi, w, pitch, off) => { const p = (((X - off) % pitch) + pitch) % pitch; return Z > lo && Z < hi && p < w; };
  const via = (lo, hi, w, pitch, off, ypitch) => { const p = (((X - off) % pitch) + pitch) % pitch, q = (((y % ypitch) + ypitch) % ypitch); return Z > lo && Z < hi && p < w && q < w * 1.6; };
  const nanoCu = (cell) => {
    const seg = Math.floor(y / (cell * 3)), g = voronoi(x, Z, cell, 23 + seg * 7), tw = twinned(x, Z, g, 23 + seg * 7, cell, 0.6);
    return R('Cu', { grain: g.id * 2 + tw.t, ori: tw.O, gb: g.edge });
  };
  if (line(-6.3, -5.7, 0.28, 0.6, 0.1)) return nanoCu(0.12);
  if (via(-5.7, -5.1, 0.12, 1.2, 0.18, 0.9)) return R('W');
  if (line(-4.9, -4.0, 0.55, 1.2, 0.0)) return nanoCu(0.2);
  if (via(-4.0, -3.2, 0.18, 2.4, 0.2, 1.5)) return R('W');
  if (line(-3.2, -1.6, 1.6, 3.0, 0.4)) return nanoCu(0.45);
  return R('SiO2');
}
// --- polished nickel: columnar grains with annealing twins, alumina inclusions, polishing scratches
function niTop(x, y) {
  const g = voronoi(x, y, 22, 11);
  let h = 0.004 * (hash(g.id, 5, 11) - 0.5) + 0.0015 * vnoise(x * 3, y * 3, 2);
  for (let k = 0; k < 3; k++) {
    const a = 0.3 + k * 0.9, d = Math.abs(((x * Math.cos(a) + y * Math.sin(a) + k * 137) % 90) - 45);
    if (d < 0.25) h -= 0.02 * (1 - d / 0.25);
  }
  const inc = niInclusion(x, y);
  if (inc) h = 0.08 * Math.sqrt(1 - inc.d2 / (inc.r * inc.r));
  return h;
}
function niInclusion(x, y) {
  const ic = 55, ix = Math.floor(x / ic), iy = Math.floor(y / ic);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = ix + i, gy = iy + j;
    if (hash(gx, gy, 71) > 0.45) continue;
    const r = 1 + 3.5 * hash(gx, gy, 72), px = (gx + hash(gx, gy, 73)) * ic, py = (gy + hash(gx, gy, 74)) * ic;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < r * r) return { r, d2 };
  }
  return null;
}
function niVol(x, y, Z) {
  const inc = niInclusion(x, y);
  if (inc && Z > -Math.sqrt(Math.max(0, inc.r * inc.r - inc.d2)) * 0.8) return R('Al2O3');
  const cell = 22, g = voronoi(x, y, cell, 11), tw = twinned(x, y, g, 11, cell, 0.55);
  return R('Ni', { grain: g.id * 2 + tw.t, ori: tw.O, gb: g.edge });
}
// --- tin spheres on carbon (SEM/FIB resolution standard); spheres sit on the carbon, partly sunk in
function snTop(x, y, res = 0) {
  let h = 0.004 * vnoise(x * 40, y * 40, 3) + 0.01 * vnoise(x * 6, y * 6, 5);
  for (let lv = 0, cell = 60; lv < 8; lv++, cell /= 2.6) {
    if (cell * 0.34 < res * 0.35) break;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      if (hash(gx, gy, 100 + lv) > 0.55) continue;
      const r = cell * (0.08 + 0.26 * hash(gx, gy, 200 + lv));
      const px = (gx + 0.5 + 0.5 * (hash(gx, gy, 300 + lv) - 0.5)) * cell, py = (gy + 0.5 + 0.5 * (hash(gx, gy, 400 + lv) - 0.5)) * cell;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (d2 < r * r) {
        const hs = Math.sqrt(r * r - d2) + r * 0.25;
        if (hs > h) h = hs + 0.003 * r * vnoise(x / r * 9, y / r * 9, lv);
      }
    }
  }
  return h;
}
const snVol = (x, y, Z) => (Z > 0.012 ? R('Sn') : R('C'));
// --- Li-ion cathode: NMC secondary particles (polycrystalline, cracked), binder web and pores, Al foil below
function nmcParticle(x, y, Z) {
  const cell = 7, cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(Z / cell);
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j, gz = cz + k;
    if (hash3(gx, gy, gz, 501) > 0.9) continue;
    const r = 2.4 + 2.0 * hash3(gx, gy, gz, 502);
    const px = (gx + 0.5 + 0.35 * (hash3(gx, gy, gz, 503) - 0.5)) * cell, py = (gy + 0.5 + 0.35 * (hash3(gx, gy, gz, 504) - 0.5)) * cell, pz = (gz + 0.5 + 0.35 * (hash3(gx, gy, gz, 505) - 0.5)) * cell;
    const d2 = (x - px) ** 2 + (y - py) ** 2 + (Z - pz) ** 2;
    if (d2 < r * r) return { id: (gx * 92821) ^ (gy * 68917) ^ (gz * 39119), r, d: Math.sqrt(d2), c: [px, py, pz] };
  }
  return null;
}
function nmcVol(x, y, Z) {
  if (Z < -34) return R('Al', { grain: 7, ori: grainOri(7, 3) });
  const p = nmcParticle(x, y, Z);
  if (p) {
    // radial cracks between primary grains
    const g = voronoi3(x, y, Z, 0.45, 600 + (p.id & 255));
    if (g.edge < 0.03 && vnoise3(x * 1.3, y * 1.3, Z * 1.3, p.id & 1023) > 0.62) return VAC;
    return R('NMC', { grain: g.id, ori: grainOri(g.id, 77), gb: g.edge });
  }
  const b = vnoise3(x * 0.9, y * 0.9, Z * 0.9, 9) * 0.65 + vnoise3(x * 2.7, y * 2.7, Z * 2.7, 19) * 0.35;
  return b > 0.5 ? R('Binder') : VAC;
}

export const SPECIMENS = {
  chip: {
    id: 'chip', name: 'Microchip (bond pads over copper interconnects)', short: 'Chip', fov: 40, fovMin: 0.3, fovMax: 600, phases: ['Al', 'Cu', 'Si'],
    note: 'A logic chip seen from the top: oxide passivation and aluminium bond pads. Below lie three copper wiring levels with tungsten vias, and the silicon substrate at ~7 µm. Mill a cross-section to see them.',
    top(x, y) { const X = ((x % PAD) + PAD) % PAD, Yp = ((y % PAD) + PAD) % PAD; return X > 2 && X < 10 && Yp > 2 && Yp < 10 ? -0.12 : 0.0008 * vnoise(x * 5, y * 5, 2); },
    vol: chipVol,
  },
  ni: {
    id: 'ni', name: 'Polycrystalline nickel (polished)', short: 'Ni', fov: 150, fovMin: 2, fovMax: 1500, phases: ['Ni'],
    note: 'Annealed, polished nickel: grains with annealing twins, a few alumina inclusions and polishing scratches. Ions channel down the open directions of some grains: the strongest grain contrast of any microscope.',
    top: niTop, vol: niVol,
  },
  sn: {
    id: 'sn', name: 'Tin spheres on carbon', short: 'Sn on C', fov: 20, fovMin: 0.3, fovMax: 400, phases: [],
    note: 'The classic resolution standard: tin spheres from nanometres to tens of micrometres on carbon. Watch the ion beam erode the smallest ones while you image them.',
    top: snTop, vol: snVol,
  },
  nmc: {
    id: 'nmc', name: 'Li-ion cathode (NMC811, binder, pores)', short: 'NMC', fov: 40, fovMin: 1, fovMax: 400, phases: [],
    note: 'A battery cathode: cracked NMC811 particles held by a carbon-binder web, with ~30 % pores, on an aluminium foil. A classic slice-and-view target; oxygen ions remove the binder fast.',
    top(x, y) { return 0.002 * vnoise(x * 3, y * 3, 4); }, vol: nmcVol,
  },
  xs: {
    id: 'xs', name: 'Chip lamella (FIB cross-section)', short: 'Lamella', fov: 12, fovMin: 0.3, fovMax: 40, phases: ['Cu', 'Si'], planar: true,
    note: 'A FIB-polished cross-section (lamella) of the chip: Pt protective cap, Al pad, copper interconnects with W vias, and the Si substrate. Image coordinates: x along the chip, y up through the stack.',
    top(x, y) { return y > 5.2 ? -0.5 : 0.006 * vnoise(x * 3, 0.5, 9) + 0.003 * vnoise(x * 11, 0.5, 4); },
    // the face of the lamella: y is height in the stack (y = 4.3 is the top of the Al pad), cut through a via row
    vol(x, y) {
      if (y > 5.2) return VAC;
      if (y > 4.3) return R('PtC');
      return chipVol(x, 0.05, y - 4.3);
    },
  },
};
export const SPEC_KEYS = Object.keys(SPECIMENS);

// ---------------------------------------------------------------- 4-quadrant BSE detector
// Segment sign: +1 added, −1 subtracted, 0 off. Directions are in the image frame (A right, B left, C up, D down).
export const SEG_DIR = { A: [1, 0], B: [-1, 0], C: [0, 1], D: [0, -1] };
export function segLabel(seg) {
  const on = ['A', 'B', 'C', 'D'].filter((k) => seg[k]);
  if (!on.length) return 'all off';
  return on.map((k, i) => (seg[k] < 0 ? (i ? ' − ' : '−') : i ? ' + ' : '') + k).join('');
}
export function segPreset(seg) {
  const k = ['A', 'B', 'C', 'D'].map((x) => seg[x]).join(',');
  return { '1,1,1,1': 'comp', '1,-1,0,0': 'topoX', '0,0,1,-1': 'topoY' }[k] ?? null;
}
export function segKind(seg) {
  const sum = seg.A + seg.B + seg.C + seg.D, dx = seg.A - seg.B, dy = seg.C - seg.D;
  if (!(seg.A || seg.B || seg.C || seg.D)) return 'no signal';
  if (sum === 0) return 'topography (difference)';
  if (dx === 0 && dy === 0) return 'composition';
  return 'mixed: composition + shading';
}

// geometry of the dual beam: ion column 52° from the electron column; the beams cross at the coincidence point
export const ION_TILT = 52;
