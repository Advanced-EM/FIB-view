// Release checks without a browser: every mode × specimen runs, physics stays near reference values, milling does
// not depend on the step size, the training tasks score an ideal operator at 100, and the command grammar parses.
//   node tools/test.mjs        (or npm test)
import { createTwin } from '../js/twin.js';
import * as P from '../js/physics.js';
import * as OPS from '../js/ops.js';
import { SCENARIOS } from '../js/scenarios.js';
import { interpret } from '../js/voice.js';
import { collectData } from '../js/export.js';

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

// command grammar
const cases = { 'switch to xenon': 'chip', 'mill a box 10 by 5 by 2 microns': 'pattern', 'deposit 1 micron of platinum': 'deposit', 'thin to 100 nm': 'lam', 'ion current 1 nA': 'current', 'tilt to 52': 'set', 'what is the sputter yield?': 'analyze' };
for (const [t, op] of Object.entries(cases)) { const r = interpret(t, { beam: 'ion' }); ok(r.ops?.[0]?.op === op, `"${t}" → ${r.ops?.[0]?.op}`); }
ok(interpret('swich to xenom', {}).options?.[0]?.text === 'switch to xenon', 'near miss is corrected and confirmed');
for (const [t, op] of Object.entries({ 'cryo lamella': 'mode', 'mill to 800 nm at 300 pA': 'cryo', 'sputter coat': 'cryo', 'milling angle 12': 'set' })) { const r = interpret(t, { mode: 'cryo', beam: 'ion' }); ok(r.ops?.[0]?.op === op, `"${t}" (cryo) → ${r.ops?.[0]?.op}`); }

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exitCode = fails ? 1 : 0;
