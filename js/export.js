// Collect the current detector data and its metadata, and package it as a NumPy .npz.
// Shared by the exhibit's Acquire and Export buttons, the headless runner, the MCP server and the Python driver.
import { npy, zip, jsonBytes } from './npy.js';
import { SESSION_KEYS } from './state.js';
import * as P from './physics.js';
import { lamQuality, cryoQuality } from './mill.js';

const A = (data, shape, units) => ({ data, shape, units });
const hist = (vals, n, max) => { const h = new Float32Array(n); for (const v of vals) h[Math.min(n - 1, Math.floor((v / max) * n))]++; return h; };

export function collectData(sim, S) {
  const m = S.mode, arrays = {}, cal = {};
  if (['se', 'inlens', 'bse'].includes(m) && sim.img) {
    arrays.image = A(sim.img.arr, [sim.img.n, sim.img.n], 'detector signal (a.u.)');
    Object.assign(cal, { pixel_um: sim.img.px, beam: 'electron', view_angle_deg: S.tilt, kV: S.kV, current_pA: S.current, probe_nm: sim.probe.d });
  } else if (['fib', 'mill', 'gis', 'lam', 'cryo'].includes(m) && sim.ionImg) {
    arrays.ion_image = A(sim.ionImg.arr, [sim.ionImg.n, sim.ionImg.n], `${S.fibDet === 'si' ? 'secondary ions' : 'ion-induced SE'} (a.u.)`);
    Object.assign(cal, { pixel_um: sim.ionImg.px, beam: 'ion', ion: S.ion, ion_kV: S.ikV, ion_current_pA: S.icur, ion_probe_nm: sim.iprobe.d, view_angle_deg: S.tilt - P.ION_TILT });
    if (sim.sec && m !== 'fib') { arrays.sem_image = A(sim.sec.arr, [sim.sec.n, sim.sec.n], 'SE (a.u.)'); cal.sem_pixel_um = sim.sec.px; cal.sem_view_angle_deg = S.tilt; }
    for (const p of sim.mill.patterns.filter((q) => q.kind !== 'img').slice(-6)) {
      const g = p.g, d = new Float32Array(g.rem.length);
      for (let k = 0; k < d.length; k++) d[k] = g.dep[k] - g.rem[k];
      arrays[`pattern_${p.id}_height`] = A(d, [g.ny, g.nx], 'µm (deposit − removal)');
      cal[`pattern_${p.id}`] = { kind: p.kind, shape: p.shape, x: p.x, y: p.y, w: p.w, h: p.h, cell_um: g.cell, origin_um: [g.x0, g.y0], ion: p.ion, kV: p.kV, current_pA: p.I, charge_nC: p.charge, gas: p.gas, status: p.status, ...sim.mill.measure(p) };
    }
    if (m === 'lam') cal.lamella_truth = lamQuality(sim.lam);
    if (m === 'cryo') cal.cryo_lamella_truth = { ...cryoQuality(sim.cryo), step: sim.cryo.step, stage_C: S.cryoT, anticontaminator: S.anticontam, log: sim.cryo.log };
  } else if ((m === 'ebsd' || m === 'tkd') && sim.map) {
    const M = sim.map, N = M.N, ipf = new Float32Array(N * N * 3), eul = new Float32Array(N * N * 3);
    for (let k = 0; k < M.done; k++) if (M.O[k]) { const c = P.ipfColor(M.O[k]); ipf.set([c[0] / 255, c[1] / 255, c[2] / 255], k * 3); eul.set(euler(M.O[k]), k * 3); }
    arrays.ipf_z = A(ipf, [N, N, 3], 'RGB 0–1');
    arrays.euler_bunge = A(eul, [N, N, 3], 'degrees (φ1, Φ, φ2)');
    arrays.band_contrast = A(M.bc, [N, N], 'a.u.');
    arrays.mad = A(M.mad, [N, N], 'degrees');
    arrays.error_vs_truth = A(M.err, [N, N], 'degrees (−1: not indexed)');
    Object.assign(cal, { step_um: M.fov / N, points_done: M.done, indexed: M.ok, geometry: S.mode });
  } else if (m === 'eds' && sim.eds) {
    arrays.spectrum = A(sim.acc?.total ? sim.acc.spec : sim.eds.spec, [sim.eds.nb], 'counts');
    cal.energy_keV_per_bin = sim.eds.dE;
    for (const [sym, map] of Object.entries(sim.acc?.maps ?? {})) arrays[`map_${sym}`] = A(map, [sim.eds.n, sim.eds.n], 'counts');
    Object.assign(cal, { map_pixel_um: sim.eds.px, xray_range_um: sim.eds.Rx, implanted: sim.eds.impEl });
  } else if (m === 'mc' && sim.mc) {
    const mc = sim.mc;
    if (mc.kind === 'ion') {
      const st = mc.stats(), zmax = Math.max(1, mc.zMax);
      arrays.implant_depth_hist = A(hist(mc.implant, 60, zmax), [60], `ions per bin (0–${zmax.toFixed(1)} nm)`);
      arrays.vacancy_depth_hist = A(hist(mc.vacZ, 60, zmax), [60], `vacancies per bin (0–${zmax.toFixed(1)} nm)`);
      arrays.sputtered_energy_hist = A(mc.sputE, [40], 'atoms per 2.5 eV bin');
      Object.assign(cal, { ion: S.ion, energy_keV: mc.E0, target: mc.m.name, ions: mc.n, sputter_yield_mc: mc.Y, Rp_nm: st.Rp, dRp_nm: st.dRp, vacancies_per_ion: mc.n ? mc.vac / mc.n : 0, depth_max_nm: zmax });
    } else {
      arrays.bse_energy_hist = A(mc.bseE, [40], 'electrons per bin (E/E0)');
      arrays.energy_deposition = A(mc.depthE, [mc.bins], 'keV per bin');
      arrays.phi_rho_z = A(mc.phi, [mc.bins], 'a.u.');
      Object.assign(cal, { energy_keV: mc.E0, target: mc.m.name, electrons: mc.n, eta_mc: mc.eta, range_nm: mc.R, depth_bin_nm: (mc.R * 1.25) / mc.bins });
    }
  } else if (m === 'sv' && sim.sv?.k) {
    const sv = sim.sv, n = sv.nx * sv.nz, st = new Float32Array(sv.k * n), tr = new Float32Array(sv.k * n);
    for (let s = 0; s < sv.k; s++) { st.set(sv.stack[s], s * n); tr.set(sv.truth[s], s * n); }
    arrays.stack = A(st, [sv.k, sv.nz, sv.nx], `${S.svDet.toUpperCase()} (a.u.); axes: slice (y), depth (z), x`);
    arrays.truth_labels = A(tr, [sv.k, sv.nz, sv.nx], '0 pore, 1 binder/carbon, 2 particle/metal, 3 other');
    Object.assign(cal, { slice_um: sv.s, pixel_x_um: sv.W / sv.nx, pixel_z_um: sv.Hz / sv.nz, slices: sv.k, instrument_time_s: sv.t, fractions: sim.svFractions() });
  } else if (sim.main) {
    arrays.image = A(sim.main.arr, [sim.main.h, sim.main.w], 'a.u.');
  }
  const state = Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]));
  const meta = {
    format: 'fib-view-data/1', generator: 'Sculpting with Ions (FIB-view)', created: new Date().toISOString(),
    simulated: true, mode: m, specimen: sim.spec.name, calibration: cal,
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, v]) => [k, { shape: v.shape, units: v.units }])),
    state,
  };
  return { arrays, meta };
}

export function toNpz({ arrays, meta }) {
  const files = Object.entries(arrays).map(([k, v]) => ({ name: `${k}.npy`, bytes: npy(v.data, v.shape) }));
  files.push({ name: 'metadata.json', bytes: jsonBytes(meta) });
  return zip(files);
}

function euler(O) {
  const g = P.mat3.T(O), Phi = Math.acos(P.clamp(g[2][2], -1, 1));
  let p1, p2;
  if (Math.abs(Math.sin(Phi)) > 1e-6) { p1 = Math.atan2(g[2][0], -g[2][1]); p2 = Math.atan2(g[0][2], g[1][2]); }
  else { p1 = Math.atan2(g[0][1], g[0][0]); p2 = 0; }
  const d = (v) => (((v / P.DEG) % 360) + 360) % 360;
  return [d(p1), Phi / P.DEG, d(p2)];
}
