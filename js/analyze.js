// Analyses of what the instrument shows right now, each compared with the simulator's truth.
//   measure_resolution  image resolution of the electron or ion image (blur-ratio method) vs the true probe + defocus
//   measure_mill        depth, volume, charge and time of the last pattern vs the depth asked for (Si application file)
//   sputter_yield       measured volume yield (µm³/nC) of the last pattern vs the Si file and the tabulated yield
//   fit_eds             peaks found in the EDS spectrum, identified, incl. implanted beam ions (Ga, Xe, Ar)
//   ebsd_stats          indexing rate, misindexing and grain size from an EBSD/TKD map
//   sv_fractions        phase volume fractions segmented from a slice & view stack vs the true fractions
//   lamella_thickness   lamella thickness estimated from the SEM contrast vs the true thickness
//   ion_range           projected range, straggle and damage depth of the ion beam in the material under it
// None of these has an emskills registry skill yet (eds-quant and ebsd skills are related). Runs in browsers and Node.
import * as P from './physics.js';
import { collectData } from './export.js';
import { blurred } from './sim.js';
import { lamQuality, lamThickness } from './mill.js';

const r = (v, n = 3) => (v == null || !Number.isFinite(v) ? v : +(+v).toFixed(n));
const lastPattern = (sim) => [...sim.mill.patterns].reverse().find((p) => p.kind !== 'img' && (p.status === 'done' || p.status === 'running' || p.status === 'stopped'));
// gradient energy of an image
const grad = (a, n) => { let s = 0; for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const gx = a[j * n + i + 1] - a[j * n + i - 1], gy = a[(j + 1) * n + i] - a[(j - 1) * n + i]; s += Math.sqrt(gx * gx + gy * gy); } return s; };

export const ANALYSES = {
  measure_resolution: {
    label: 'image resolution', modes: ['se', 'inlens', 'bse', 'fib', 'mill', 'gis', 'lam'], related: 'sem-resolution (FFT/edge methods)',
    run(sim, S) {
      const ion = ['fib', 'mill', 'gis', 'lam'].includes(S.mode), I = ion ? sim.ionImg : sim.img;
      if (!I) throw new Error('no image yet');
      // blur-ratio method: an edge's gradient scales as 1/σ, so blurring by a known σb reveals the unknown σ
      const n = I.n, sb = 2, g1 = grad(I.arr, n), g2 = grad(blurred(I.arr, n, n, sb), n), q = g1 / (g2 || 1);
      const sig = q > 1.0005 ? sb / Math.sqrt(q * q - 1) : 20;
      const meas = 2.355 * sig * I.px * 1000;
      const pr = ion ? sim.iprobe : sim.probe, mis = S.mis ?? {};
      const foc = ion ? S.ifocus - (mis.iFocus ?? 0) : S.focus - (mis.eFocus ?? 0), ast = ion ? S.istig - sim.iastig - (mis.iStig ?? 0) : S.stig - sim.astig - (mis.eStig ?? 0);
      const dfb = pr.alpha * Math.hypot(foc + ast, foc - ast) * 1000 / Math.SQRT2;
      const truth = Math.hypot(pr.d, 2.355 * dfb);
      const pxnm = I.px * 1000;
      return {
        summary: `${ion ? 'Ion' : 'Electron'} image resolution ≈ ${r(Math.max(meas, pxnm * 2), 1)} nm (true blur ${r(truth, 1)} nm: probe ${r(pr.d, 1)} nm${dfb > 0.3 * pr.d ? `, defocus/astigmatism ${r(2.355 * dfb, 1)} nm` : ''}). Pixel ${r(pxnm, 1)} nm${pxnm * 2 > truth ? ': the pixels, not the probe, limit this image; zoom in to measure the probe' : ''}.`,
        result: { resolution_nm: r(meas, 2), pixel_nm: r(pxnm, 2) }, truth: { blur_nm: r(truth, 2), probe_nm: r(pr.d, 2), defocus_blur_nm: r(2.355 * dfb, 2) },
      };
    },
  },
  measure_mill: {
    label: 'milled pattern', modes: ['mill', 'gis', 'lam', 'fib', 'se', 'inlens', 'bse'],
    run(sim) {
      const p = lastPattern(sim);
      if (!p) throw new Error('no pattern has been milled yet: draw one in Mill mode and start it');
      const m = sim.mill.measure(p), t = p.t;
      const asked = p.kind === 'dep' ? `${p.depth} µm of deposit` : `${p.depth} µm (in silicon)`;
      return {
        summary: `${p.kind === 'dep' ? 'Deposit' : 'Pattern'} #${p.id} (${p.shape}, ${r(p.w, 2)} × ${r(p.h, 2)} µm): ${p.kind === 'dep' ? `thickness ${r(-sim.mill.measure(p).volume / (p.w * p.h), 3)} µm` : `deepest ${r(m.maxDepth, 2)} µm, volume ${r(m.volume, 1)} µm³`} for ${r(m.charge, 2)} nC in ${r(t, 1)} s at ${P.fmtCurrent(p.I)} ${p.ion}⁺. Asked for ${asked}.`,
        result: { depth_um: r(m.maxDepth, 3), volume_um3: r(m.volume, 2), charge_nC: r(m.charge, 3), time_s: r(t, 1), status: p.status },
        truth: { target_depth_um: p.depth, ion: p.ion, kV: p.kV, current_pA: p.I },
      };
    },
  },
  sputter_yield: {
    label: 'sputter yield', modes: ['mill', 'gis', 'lam', 'fib', 'se', 'inlens', 'bse'],
    run(sim) {
      const p = [...sim.mill.patterns].reverse().find((q) => q.kind === 'mill' && q.charge > 0);
      if (!p) throw new Error('mill a pattern first: the yield is its removed volume divided by the charge');
      const m = sim.mill.measure(p), si = P.sputter(p.ion, 'Si', p.kV, 0, p.gas);
      const top = sim.spec.vol(p.x, p.y, sim.spec.top(p.x, p.y) - 0.01).mat, tab = P.sputter(p.ion, top, p.kV, 0, p.gas);
      return {
        summary: `Measured ${r(m.Yv, 3)} µm³/nC for ${p.ion}⁺ at ${p.kV} kV${p.gas ? ` with ${p.gas}` : ''}: silicon would give ${r(si.Yv, 3)} µm³/nC (${r(si.Y, 2)} atoms/ion), and ${P.MAT[top].name.toLowerCase()} at the top of the pattern ${r(tab.Yv, 3)} µm³/nC (${r(tab.Y, 2)} atoms/ion). The difference comes from the materials milled through, redeposition and the sloped walls.`,
        result: { volume_yield_um3_per_nC: r(m.Yv, 4) }, truth: { si_um3_per_nC: r(si.Yv, 4), top_material: top, top_um3_per_nC: r(tab.Yv, 4), top_atoms_per_ion: r(tab.Y, 3) },
      };
    },
  },
  fit_eds: {
    label: 'EDS peaks', modes: ['eds'], related: 'eds-quant',
    run(sim, S, data) {
      const sp = data.arrays.spectrum.data, dE = data.meta.calibration.energy_keV_per_bin, n = sp.length;
      const sm = blurred(Float32Array.from(sp), n, 1, 2, 0), bg = blurred(sm, n, 1, 40, 0), peaks = [];
      for (let i = 3; i < n - 3; i++) if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > bg[i] * 1.25 + 3 && (i + 0.5) * dE > 0.2) peaks.push({ E: (i + 0.5) * dE, h: sm[i] - bg[i] });
      peaks.sort((a, b) => b.h - a.h);
      const found = [];
      for (const pk of peaks.slice(0, 14)) {
        const L = P.XLINES.reduce((b, l) => (Math.abs(l.E - pk.E) < Math.abs(b.E - pk.E) ? l : b));
        if (Math.abs(L.E - pk.E) < 0.07 && !found.some((f) => f.el === L.el && f.line === L.line)) found.push({ el: L.el, line: L.line, E_keV: r(pk.E, 3) });
      }
      const els = [...new Set(found.map((f) => f.el))], truth = Object.keys(sim.eds.comp).filter((e) => sim.eds.comp[e] > 0.005);
      const imp = sim.eds.impEl;
      return {
        summary: els.length ? `Found ${found.map((f) => `${f.el} ${f.line} (${f.E_keV} keV)`).join(', ')}.${imp && els.includes(imp) ? ` ${imp} is implanted by the ion beam, not part of the specimen.` : ''}${truth.filter((e) => !els.includes(e) && P.XLINES.some((l) => l.el === e)).length ? ` Present but not found: ${truth.filter((e) => !els.includes(e) && P.XLINES.some((l) => l.el === e)).join(', ')} (overvoltage, absorption or counts).` : ''}` : 'No peaks yet: acquire longer.',
        result: { lines: found }, truth: { elements: Object.fromEntries(truth.map((e) => [e, r(sim.eds.comp[e], 3)])), implanted: imp ?? null },
      };
    },
  },
  ebsd_stats: {
    label: 'EBSD map statistics', modes: ['ebsd', 'tkd'], related: 'ebsd-grain-analysis',
    run(sim) {
      const M = sim.map;
      if (!M?.done) throw new Error('no map yet');
      const N = M.N;
      let bounds = 0, segs = 0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) {
        const a = j * N + i, b = a + 1;
        if (b >= M.done || !M.O[a] || !M.O[b]) continue;
        segs++; if (P.misorientation(M.O[a], M.O[b]) > 5 * P.DEG) bounds++;
      }
      const step = M.fov / N, grain = bounds ? (segs * step) / bounds : null;
      const tg = new Set(M.grain.slice(0, M.done).filter((g) => g != null && g >= 0)).size;
      return {
        summary: `${M.done} points, ${Math.round((100 * M.ok) / M.done)} % indexed, mean error ${M.ok ? r(M.errSum / M.ok, 2) : '—'}° vs the true orientations. Mean linear-intercept grain size ≈ ${grain ? `${r(grain, 3)} µm` : 'larger than the map'} (boundaries > 5°, step ${r(step, 3)} µm).`,
        result: { indexed_fraction: r(M.ok / M.done, 3), grain_size_um: r(grain, 3), step_um: r(step, 4) }, truth: { mean_error_deg: M.ok ? r(M.errSum / M.ok, 3) : null, true_grains_sampled: tg },
      };
    },
  },
  sv_fractions: {
    label: 'slice & view fractions', modes: ['sv'], related: 'tomography-segmentation',
    run(sim) {
      const f = sim.svFractions();
      if (!f) throw new Error('no slices yet');
      const pct = (a) => a.map((v) => `${Math.round(v * 100)} %`);
      return {
        summary: `Segmented from ${sim.sv.k} slices: ${f.names.map((nm, i) => `${nm} ${pct(f.measured)[i]}`).join(', ')}. True: ${f.names.map((nm, i) => `${nm} ${pct(f.truth)[i]}`).join(', ')}. Pores look partly filled because the beam sees the material behind them (shine-through); resin infiltration removes that error.`,
        result: Object.fromEntries(f.names.map((nm, i) => [nm, r(f.measured[i], 3)])), truth: Object.fromEntries(f.names.map((nm, i) => [nm, r(f.truth[i], 3)])),
      };
    },
  },
  lamella_thickness: {
    label: 'lamella thickness', modes: ['lam', 'tkd'],
    run(sim, S) {
      const L = sim.lam, q = lamQuality(L);
      if (L.step < 6) throw new Error('the lamella is not on the grid yet: run the lamella steps up to Thinning');
      // what the 5 kV SE contrast says: transparency saturates, so the estimate is good near the electron range only
      const R = P.rangeKO(P.MAT.Si, S.kV) * 1000, tr = Math.exp(-L.t_top / (0.35 * R));
      const est = tr > 0.03 && tr < 0.97 ? -0.35 * R * Math.log(tr * (1 + 0.12 * (Math.random() - 0.5))) : null;
      return {
        summary: est ? `From the ${S.kV} kV SE contrast: about ${Math.round(est)} nm at the top of the window. (True: ${q.t_top} nm at the top, ${q.t_bottom} nm 3 µm down, ${q.amorph[0]}/${q.amorph[1]} nm amorphous on the faces.)` : `At ${S.kV} kV the lamella is ${tr >= 0.97 ? 'fully transparent: thinner than this voltage can measure; lower the kV' : 'opaque: thicker than the electrons\' range; raise the kV'} (true ${q.t_top} nm).`,
        result: { estimated_nm: est ? Math.round(est) : null, kV: S.kV }, truth: q,
      };
    },
  },
  ion_range: {
    label: 'ion range', modes: ['fib', 'mill', 'gis', 'lam', 'mc', 'sv', 'se', 'inlens', 'bse', 'eds', 'ebsd', 'tkd'],
    run(sim, S) {
      const s = sim.sampleAt(S.cx, S.cy), mk = P.MAT[s.mat].rho ? s.mat : 'Si', g = P.ionRange(S.ion, mk, S.ikV), y = P.sputter(S.ion, mk, S.ikV);
      return {
        summary: `${S.ion}⁺ at ${S.ikV} keV in ${P.MAT[mk].name.toLowerCase()}: projected range ${r(g.Rp, 1)} ± ${r(g.dRp, 1)} nm, damaged to ~${r(g.damage, 1)} nm at normal incidence (about half that on a lamella face, at glancing incidence); sputter yield ${r(y.Y, 2)} atoms/ion (${r(y.Yv, 3)} µm³/nC).`,
        result: { Rp_nm: r(g.Rp, 2), dRp_nm: r(g.dRp, 2), damage_nm: r(g.damage, 2), yield_atoms_per_ion: r(y.Y, 3) }, truth: { method: 'binary-collision Monte Carlo (ZBL potential, LSS electronic stopping)' },
      };
    },
  },
};
const DEFAULT = { se: 'measure_resolution', inlens: 'measure_resolution', bse: 'measure_resolution', fib: 'measure_resolution', mill: 'measure_mill', gis: 'measure_mill', lam: 'lamella_thickness', eds: 'fit_eds', ebsd: 'ebsd_stats', tkd: 'ebsd_stats', sv: 'sv_fractions', mc: 'ion_range' };

export function analyze(sim, S, name) {
  name = name ?? DEFAULT[S.mode];
  const a = ANALYSES[name];
  if (!a) throw new Error(`no analysis called ${name}. Try: ${Object.keys(ANALYSES).join(', ')}`);
  if (!a.modes.includes(S.mode)) throw new Error(`${a.label} needs ${a.modes.slice(0, 4).map((m) => m.toUpperCase()).join(' or ')} mode; the instrument is in ${S.mode.toUpperCase()}`);
  const data = collectData(sim, S);
  return { analysis: name, emskills: { skill: null, in_registry: false, related: a.related ?? null }, mode: S.mode, specimen: sim.spec.name, ...a.run(sim, S, data) };
}
