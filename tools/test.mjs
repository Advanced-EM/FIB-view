// Release checks without a browser: every mode × specimen runs, physics stays near reference values, milling does
// not depend on the step size, the training tasks score an ideal operator at 100, and the command grammar parses.
//   node tools/test.mjs        (or npm test)
import { createTwin } from '../js/twin.js';
import * as P from '../js/physics.js';
import * as OPS from '../js/ops.js';
import { SCENARIOS } from '../js/scenarios.js';
import { interpret } from '../js/voice.js';
import { collectData } from '../js/export.js';
import { dataRows } from '../js/explain.js';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const near = (v, lo, hi) => v >= lo && v <= hi;

// physics against reference values (SRIM-like ranges and yields, measured probe sizes)
ok(near(P.sputter('Ga', 'Si', 30).Y, 1.8, 2.4), `Ga 30 keV → Si yield ${P.sputter('Ga', 'Si', 30).Y.toFixed(2)} (≈2.1)`);
ok(P.sputter('Xe', 'Si', 30).Y > P.sputter('Ga', 'Si', 30).Y, 'Xe sputters Si faster than Ga');
ok(P.sputter('O', 'Binder', 30).Y > 3 * P.sputter('O', 'NMC', 30).Y, 'O⁺ removes binder far faster than NMC');
const rp = P.ionRange('Ga', 'Si', 30).Rp; ok(near(rp, 22, 36), `Ga 30 keV range in Si ${rp.toFixed(1)} nm (≈27–30)`);
ok(near(P.ionProbe('Ga', 1, 30).d, 2, 4), `Ga 1 pA probe ${P.ionProbe('Ga', 1, 30).d.toFixed(1)} nm (≈2.5–3)`);
ok(P.depositRate('Pt', 'ion', 'Ga', 30, 4).net > 0 && P.depositRate('Pt', 'ion', 'Ga', 30, 200).net < P.depositRate('Pt', 'ion', 'Ga', 30, 4).net, 'Pt deposition slows at high current density');

// every mode and specimen runs and records data
for (const m of OPS.MODES) for (const sp of P.SPEC_KEYS) {
  const tw = createTwin(), { S, sim } = tw;
  try {
    tw.run({ op: 'spec', v: sp }); tw.run({ op: 'mode', v: m });
    for (let i = 0; i < (m === 'sv' ? 6 : 4); i++) sim.update(m === 'sv' ? 0.4 : 0.05);
    sim._mt = 0; sim.update(0.05); sim.update(0.05);
    const d = collectData(sim, S), arrs = Object.values(d.arrays);
    const finite = arrs.every((a) => Array.prototype.every.call(a.data, Number.isFinite));
    if (!arrs.length || !finite) ok(false, `${m}/${sp}: ${arrs.length} arrays, finite ${finite}`);
  } catch (e) { ok(false, `${m}/${sp}: ${e.message}`); }
}
ok(true, `${OPS.MODES.length} modes × ${P.SPEC_KEYS.length} specimens ran`);

// milling converges with the step size
const depth = (steps) => { const tw = createTwin(), { S, sim } = tw; tw.run({ op: 'spec', v: 'chip' }); tw.run({ op: 'mode', v: 'mill' }); const p = OPS.addPattern(S, sim, { shape: 'rect', w: 8, h: 6, depth: 2 }); sim.mill.start(); let k = 0; while (sim.mill.active && k++ < steps * 3) sim.mill.update(p.tEst / steps); return sim.mill.measure(p).maxDepth; };
const d60 = depth(60), d240 = depth(240); ok(Math.abs(d60 - d240) / d240 < 0.03, `milled depth independent of step size (${d60.toFixed(3)} vs ${d240.toFixed(3)} µm)`);

// training tasks: an ideal operator scores ≥ 90
for (const id of Object.keys(SCENARIOS)) {
  const tw = createTwin(), { S, sim } = tw, api = { S, sim, setSpec: (v) => OPS.specState(S, sim, v), setMode: (m) => OPS.modeState(S, sim, m, S.mode), resetMill: () => sim.mill.reset() };
  const sc = SCENARIOS[id], info = sc.setup(api, P.mulberry32(11));
  const m0 = sc.metrics(api, info).score;
  if (id === 'sem-focus-stig') { S.focus = S.mis.eFocus; S.stig = sim.astig + S.mis.eStig; }
  if (id === 'fib-focus-stig') { S.ifocus = S.mis.iFocus; S.istig = sim.iastig + S.mis.iStig; }
  if (id === 'eucentric') S.ez = 0;
  if (id === 'cryo-lamella') { for (const [I, T] of [[1000, 2500], [300, 800], [100, 400], [30, 200]]) OPS.cryoMill(S, sim, { I, target: T }); OPS.cryoCoat(S, sim); }
  if (id === 'lamella-thin') { for (const [I, T] of [[800, 500], [300, 250], [80, 130], [50, 100]]) OPS.lamThin(S, sim, { I, target: T }); OPS.lamPolish(S, sim, 5); OPS.lamPolish(S, sim, 2); }
  const m1 = sc.metrics(api, info).score;
  ok(m0 < 50 && m1 >= 90, `${id}: hidden error scores ${m0}, ideal operator ${m1}`);
}

// cryo: ions in vitreous ice, the lamella recipe and its failure modes
{
  const M = await import('../js/mill.js');
  const rIce = P.ionRange('Ga', 'Ice', 30).Rp;
  ok(rIce > 40 && rIce < 70, `Ga 30 keV range in vitreous ice ${rIce.toFixed(1)} nm (≈50–60)`);
  ok(P.sputter('Ga', 'Ice', 30).Yv > 3 * P.sputter('Ga', 'Si', 30).Yv && P.sputter('Ga', 'PtCryo', 30).Yv < P.sputter('Ga', 'Ice', 30).Yv / 5, 'ice mills several times faster than Si; the cold GIS layer far slower than ice');
  const run = (o = {}) => {
    const tw = createTwin(), { S, sim } = tw;
    // species comparisons on the teaching instrument (at NUANCE the cryo stage is on the Hydra, without gallium)
    tw.run({ op: 'inst', v: 'generic' });
    Object.assign(S, { cryoRelief: o.relief ?? true, anticontam: o.anticontam ?? true });
    tw.run({ op: 'chip', k: 'ion', v: o.ion ?? 'Ga' }); tw.run({ op: 'mode', v: 'cryo' });
    for (let i = 0; i < 4; i++) tw.run({ op: 'cryo', v: 'next' });
    for (const [I, T] of o.passes ?? [[1000, 2500], [300, 800], [100, 400], [30, 200]]) tw.run({ op: 'cryo', v: 'mill', I, target: T });
    if (o.wait) M.cryoAge(sim.cryo, o.wait, { T: S.cryoT, anticontam: S.anticontam });
    return M.cryoQuality(sim.cryo);
  };
  const ga = run(), xe = run({ ion: 'Xe' });
  ok(ga.verdict === 'Ready for cryo-ET' && xe.verdict === 'Ready for cryo-ET' && xe.damage[0] < ga.damage[0] / 1.5, `recipe → ${ga.t} nm, Ga damage ${ga.damage[0]} nm vs Xe ${xe.damage[0]} nm`);
  ok(run({ passes: [[1000, 200]] }).devit_pct > 50, 'rushing at 1 nA to 200 nm devitrifies the ice');
  ok(run({ relief: false }).bent, 'no relief cuts: the thin lamella bends');
  ok(run({ anticontam: false, wait: 600 }).contam_nm > 5 * run({ wait: 600 }).contam_nm, 'without the anticontaminator, contamination grows ~10× faster');
}

// the NUANCE instruments: resolution specs, aperture strips, and switching to the instrument a request needs
{
  const best = (kV) => Math.min(...[10, 20, 30, 60, 120].map((ap) => P.probe({ kV, aperture: ap, current: 2, wd: 4 }).d));
  P.useInstrument('h5uc');
  ok(Math.abs(best(1) - 0.7) < 0.01 && Math.abs(best(15) - 0.6) < 0.01 && Math.abs(P.ionProbe('Ga', 1.1, 30).d - 3.6) < 0.05 && P.ION.Ga.currents.at(-1) === 100000, `Helios 5 UC: SEM ${best(1).toFixed(2)} nm at 1 kV, ${best(15).toFixed(2)} nm at 15 kV; Ga ${P.ionProbe('Ga', 1.1, 30).d.toFixed(2)} nm, up to 100 nA`);
  P.useInstrument('hydra');
  ok(P.ionProbe('Xe', 1, 30).d <= 20.01 && P.ION.Xe.currents[0] === 1 && P.ION.Xe.currents.at(-1) === 2.5e6, `Hydra: Xe ${P.ionProbe('Xe', 1, 30).d.toFixed(1)} nm at 1 pA, 1 pA – 2.5 µA`);
  P.useInstrument('h600');
  ok(Math.abs(best(15) - 0.9) < 0.01 && P.ION.Ga.currents.at(-1) === 21000, `Helios 600: SEM ${best(15).toFixed(2)} nm at 15 kV, Ga up to 21 nA`);
  const tw = createTwin(), { S } = tw;
  ok(S.inst === 'generic', 'starts on the teaching instrument'); tw.run({ op: 'inst', v: 'h5uc' }); ok(S.inst === 'h5uc' && S.ion === 'Ga', 'the Helios 5 UC has gallium');
  tw.run({ op: 'chip', k: 'ion', v: 'Xe' }); ok(S.inst === 'hydra' && S.ion === 'Xe', 'asking for xenon moves to the Hydra');
  tw.run({ op: 'chip', k: 'ion', v: 'Ga' }); tw.run({ op: 'mode', v: 'ebsd' }); ok(S.inst === 'hydra' && S.mode === 'ebsd', 'EBSD (Symmetry S3) is on the Hydra');
  tw.run({ op: 'inst', v: 'h5uc' }); ok(S.mode === 'se' && S.ion === 'Ga', 'the Helios 5 UC has no EBSD: back to the SE image');
  tw.run({ op: 'mode', v: 'cryo' }); ok(S.inst === 'hydra' && S.spec === 'cell' && S.cryoT >= -183, `cryo lamella on the Hydra (stage ${S.cryoT} °C, ~90 K)`);
  tw.run({ op: 'inst', v: 'generic' }); P.useInstrument('generic');
}

// the instrument readout table renders on every instrument and in every mode (it runs each frame in the exhibit)
{
  const tw = createTwin();
  let err = '';
  for (const k of ['generic', 'h5uc', 'hydra', 'h600']) for (const m of ['se', 'fib', 'mill', 'cryo', 'sv']) {
    try { tw.run({ op: 'inst', v: k }); tw.run({ op: 'mode', v: m }); tw.sim.update(0.05); const r = dataRows(tw.S, tw.sim); if (!r.every(([a, b]) => typeof a === 'string' && typeof b === 'string')) err ||= `${k}/${m}: bad row`; } catch (e) { err ||= `${k}/${m}: ${e.message}`; }
  }
  P.useInstrument('generic');
  ok(!err, `readout table on every instrument and mode${err ? `: ${err}` : ''}`);
}

// command grammar
const cases = { 'switch to xenon': 'chip', 'mill a box 10 by 5 by 2 microns': 'pattern', 'deposit 1 micron of platinum': 'deposit', 'thin to 100 nm': 'lam', 'ion current 1 nA': 'current', 'tilt to 52': 'set', 'what is the sputter yield?': 'analyze' };
for (const [t, op] of Object.entries(cases)) { const r = interpret(t, { beam: 'ion' }); ok(r.ops?.[0]?.op === op, `"${t}" → ${r.ops?.[0]?.op}`); }
ok(interpret('swich to xenom', {}).options?.[0]?.text === 'switch to xenon', 'near miss is corrected and confirmed');
for (const [t, op] of Object.entries({ 'cryo lamella': 'mode', 'mill to 800 nm at 300 pA': 'cryo', 'sputter coat': 'cryo', 'milling angle 12': 'set' })) { const r = interpret(t, { mode: 'cryo', beam: 'ion' }); ok(r.ops?.[0]?.op === op, `"${t}" (cryo) → ${r.ops?.[0]?.op}`); }

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
