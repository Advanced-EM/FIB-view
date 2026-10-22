// Run the FIB-SEM simulator without a browser and save what the detectors record as a NumPy .npz.
//   node tools/headless.mjs --mode fib --spec ni --ion Ga --icur 25 --out ni-ise.npz
//   node tools/headless.mjs --mode mill --spec chip --ion Xe --mill rcs:16x8x6 --out xsec.npz
//   node tools/headless.mjs --mode mc --mcBeam ion --ion Xe --spec chip --out cascade.npz
//   node tools/headless.mjs --session my-session.json --out run.npz
// Options: --mode, --spec, --kV, --current (pA), --tilt, --fov (µm), --ion Ga|Xe|Ar|N|O, --ikV, --icur (pA),
// --mill shape:WxHxD (µm, run to completion), --deposit gas:WxHxT, --mcBeam e|ion, --real, --steps n,
// --session <file saved from the exhibit>, --out <file.npz>.
import { readFileSync, writeFileSync } from 'node:fs';
import { createTwin } from '../js/twin.js';
import { SESSION_KEYS } from '../js/state.js';
import { collectData, toNpz } from '../js/export.js';

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) { const k = args[i].slice(2), v = args[i + 1]; if (!v || v.startsWith('--')) opt[k] = true; else { opt[k] = v; i++; } }

const { S, sim, run } = createTwin();
if (opt.session) {
  const ses = JSON.parse(readFileSync(opt.session, 'utf8'));
  if (ses.state?.spec) run({ op: 'spec', v: ses.state.spec });
  for (const k of SESSION_KEYS) if (k in (ses.state ?? {}) && !['mode', 'spec', 'mis'].includes(k)) S[k] = ses.state[k];
  if (ses.state?.mode) run({ op: 'mode', v: ses.state.mode });
  for (const p of ses.patterns ?? []) sim.mill.add({ ...p, status: 'queued' });
}
if (opt.spec) run({ op: 'spec', v: opt.spec });
if (opt.mode) run({ op: 'mode', v: opt.mode });
if (opt.ion) run({ op: 'chip', k: 'ion', v: opt.ion });
if (opt.kV) run({ op: 'kv', beam: 'e', v: +opt.kV });
if (opt.ikV) run({ op: 'kv', beam: 'ion', v: +opt.ikV });
if (opt.current) run({ op: 'current', beam: 'e', v: +opt.current });
if (opt.icur) run({ op: 'current', beam: 'ion', v: +opt.icur });
if (opt.tilt) run({ op: 'set', k: 'tilt', v: +opt.tilt });
if (opt.fov) run({ op: 'set', k: 'fov', v: +opt.fov });
if (opt.mcBeam) run({ op: 'chip', k: 'mcBeam', v: opt.mcBeam });
if (opt.real) S.clarity = 'real';
const dims = (s) => s.split(':')[1].split('x').map(Number);
if (opt.mill) { const [w, h, d] = dims(opt.mill); run({ op: 'pattern', shape: opt.mill.split(':')[0], w, h, depth: d, start: true }); }
if (opt.deposit) { const [w, h, t] = dims(opt.deposit); run({ op: 'deposit', gas: opt.deposit.split(':')[0], beam: 'ion', w, h, thick: t }); }
if (sim.mill.queued.length) { const OPS = await import('../js/ops.js'); OPS.runQueue(sim); }

const steps = +(opt.steps ?? (S.mode === 'ebsd' || S.mode === 'tkd' ? 400 : S.mode === 'sv' ? 60 : S.mode === 'mc' ? 80 : 8));
const t0 = performance.now();
for (let i = 0; i < steps; i++) {
  sim.update(S.mode === 'sv' ? 0.4 : 0.05);
  if ((S.mode === 'ebsd' || S.mode === 'tkd') && sim.map && sim.map.done >= sim.map.N ** 2) break;
  if (S.mode === 'sv' && sim.sv?.done) break;
}
sim._mt = 0; sim.update(0.05); sim.update(0.05);
const data = collectData(sim, S);
const out = opt.out ?? `${S.mode}-${S.spec}.npz`;
writeFileSync(out, toNpz(data));
console.log(`${S.mode} on ${sim.spec.name}: ${Object.keys(data.arrays).join(', ')} → ${out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
