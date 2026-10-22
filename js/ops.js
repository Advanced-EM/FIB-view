// Instrument operations on the state alone (no DOM): load a specimen, switch mode, change a setting, add and run
// patterns, run the lamella workflow. The exhibit calls these and then refreshes its controls; voice commands, the AI
// agent, the Python package and the headless runner all go through applyOp, so they drive the same instrument.
import * as P from './physics.js';
import { newLamella, thinPass, LAM_STEPS } from './mill.js';
import { ION_MODES } from './sim.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const MODES = ['se', 'inlens', 'bse', 'ebsd', 'tkd', 'eds', 'fib', 'mill', 'gis', 'sv', 'lam', 'mc'];
export const BEAM = { se: 'e', inlens: 'e', bse: 'e', ebsd: 'e', tkd: 'e', eds: 'e', fib: 'ion', mill: 'ion', gis: 'ion', sv: 'ion', lam: 'ion', mc: 'e' };
export const activeBeam = (S) => (S.mode === 'mc' ? (S.mcBeam === 'ion' ? 'ion' : 'e') : BEAM[S.mode] ?? 'e');
// where each specimen's interesting region is
const SITE = { chip: [6, 6], ni: [0, 0], sn: [0, 0], nmc: [0, 0], xs: [6, 1.3] };

export function specState(S, sim, v) {
  if (!P.SPECIMENS[v]) return false;
  S.spec = v;
  const sp = P.SPECIMENS[v];
  S.fov = sp.fov; [S.cx, S.cy] = v === 'chip' ? [0, 0] : [0, 0]; S.edsSel = 'all';
  sim.mill.reset(); sim.lam = newLamella(); sim.sv = null;
  if (ION_MODES.includes(S.mode) || S.mode === 'sv') S.fov = Math.min(S.fov, v === 'ni' ? 120 : 40);
  sim.invalidate('spec');
  return true;
}

// switching mode moves the stage and the detectors as an operator would
export function modeState(S, sim, m, prev = S.mode) {
  if (!MODES.includes(m) || m === prev) return false;
  S.mode = m;
  const ionish = ION_MODES.includes(m) || m === 'sv';
  if (m === 'ebsd') { if (!['ni', 'chip', 'xs'].includes(S.spec)) specState(S, sim, 'ni'); S.tilt = 70; S.kV = Math.max(S.kV, 20); S.current = Math.max(S.current, 3000); S.wd = Math.max(S.wd, 14); }
  if (m === 'tkd') { if (S.spec !== 'xs') specState(S, sim, 'xs'); S.tilt = 0; S.kV = Math.max(S.kV, 30); S.current = Math.max(S.current, 2000); S.wd = Math.min(S.wd, 5); }
  if (m === 'eds') { S.kV = Math.max(S.kV, 15); S.current = Math.max(S.current, 1000); if (prev === 'ebsd') S.tilt = 0; }
  if (['se', 'inlens', 'bse'].includes(m) && prev === 'ebsd') S.tilt = 0;
  if (m === 'inlens') S.wd = Math.min(S.wd, 4);
  if (ionish) {
    // the ion modes work at the coincidence point, with the ion beam normal to the surface
    S.wd = 4; if (S.tilt !== 52 && !(m === 'fib' && prev === 'fib')) S.tilt = 52;
    if (S.spec === 'xs') specState(S, sim, 'chip');
    if (m === 'sv' && S.spec !== 'nmc') specState(S, sim, 'nmc');
    if (m === 'mill' && S.icur < 1000) S.icur = P.nearestCurrent(S.ion, S.ion === 'Ga' ? 9000 : 60000);
    if (m === 'fib' && S.icur > 1000) S.icur = P.nearestCurrent(S.ion, S.ion === 'Ga' ? 25 : 100);
    if (m === 'gis') S.icur = P.nearestCurrent(S.ion, clamp(4 * S.patW * S.patH, 10, S.ion === 'Ga' ? 3000 : 15000)); // ~4 pA/µm² for Pt
    if (m === 'sv') { S.icur = P.nearestCurrent(S.ion, S.ion === 'Ga' ? 800 : 15000); S.kV = Math.min(S.kV, 3); S.current = Math.max(S.current, 400); }
    if (m === 'lam' && S.spec !== 'chip') specState(S, sim, 'chip');
    if (m === 'lam') { S.fov = 30; S.cx = SITE.chip[0]; S.cy = SITE.chip[1]; S.kV = 5; }
  }
  if (m === 'mc' && prev && ION_MODES.includes(prev)) S.mcBeam = 'ion';
  sim.invalidate('mode-all');
  return true;
}

export function setIon(S, sim, k) {
  if (!P.ION[k]) return false;
  const was = S.icur, wasSrc = P.ION[S.ion].src;
  S.ion = k;
  // keep a similar current (the plasma column's smallest probes are larger, its largest currents far higher)
  S.icur = P.nearestCurrent(k, was);
  if (wasSrc !== P.ION[k].src && S.mode === 'mill') S.icur = P.nearestCurrent(k, k === 'Ga' ? 9000 : 60000);
  sim.invalidate('ion');
  return true;
}

// a pattern from the current settings (or from overrides), centred in the view unless given
export function addPattern(S, sim, o = {}) {
  const kind = o.kind ?? (S.mode === 'gis' ? 'dep' : 'mill');
  const beam = kind === 'dep' ? (o.beam ?? S.depBeam) : 'ion';
  const p = sim.mill.add({
    kind, shape: o.shape ?? (kind === 'dep' ? 'rect' : S.shape), x: o.x ?? S.cx, y: o.y ?? S.cy, w: o.w ?? S.patW, h: o.h ?? S.patH,
    depth: o.depth ?? (kind === 'dep' ? S.depThick : S.patDepth), ion: S.ion, kV: beam === 'e' ? S.kV : S.ikV, I: o.I ?? (beam === 'e' ? S.current : S.icur),
    gas: kind === 'dep' ? (o.gas ?? S.depGas) : (o.gas ?? (S.gas === 'none' ? null : S.gas)), beam, face: o.face ?? 1, overtilt: o.overtilt ?? S.overtilt, rocking: o.rocking ?? S.rocking, label: o.label ?? '',
  });
  return p;
}
// run every queued pattern to completion (headless and scripts: instrument time passes at once)
export function runQueue(sim, maxSteps = 4000) {
  sim.mill.start();
  let n = 0;
  while (sim.mill.active && n++ < maxSteps) { const a = sim.mill.active; sim.mill.update(Math.max(0.05, a.tEst / 30)); }
  sim.mill.version++; sim.invalidate('pattern');
}

// ---------------------------------------------------------------- lamella workflow
// steps 0–4 are real patterns on the chip at the lamella site; 5 is the lift-out; 6–7 work on the lifted lamella
export function lamSite(S) { return SITE.chip; }
export function lamStep(S, sim) {
  const L = sim.lam, [x0, y0] = lamSite(S), ga = S.ion === 'Ga';
  if (L.busy || L.step >= 6) return null;
  const id = LAM_STEPS[L.step].id, ids = [];
  const add = (o) => { const p = addPattern(S, sim, o); ids.push(p.id); return p; };
  if (id === 'ebeamPt') add({ kind: 'dep', beam: 'e', gas: 'Pt', shape: 'rect', x: x0, y: y0, w: 14, h: 2, depth: 0.25, I: 3200, label: 'e-beam Pt' });
  if (id === 'ionPt') add({ kind: 'dep', beam: 'ion', gas: 'Pt', shape: 'rect', x: x0, y: y0, w: 14, h: 2, depth: 1.4, I: P.nearestCurrent(S.ion, ga ? 300 : 1000), label: 'ion-beam Pt' });
  if (id === 'trenches') {
    const I = P.nearestCurrent(S.ion, ga ? 9000 : 60000);
    add({ shape: 'rcs', x: x0, y: y0 + 0.75 + 5, w: 16, h: 10, depth: 7, I, face: -1, label: 'upper trench' });
    add({ shape: 'rcs', x: x0, y: y0 - 0.75 - 5, w: 16, h: 10, depth: 7, I, face: 1, label: 'lower trench' });
  }
  if (id === 'clean') {
    const I = P.nearestCurrent(S.ion, ga ? 800 : 4000);
    add({ shape: 'ccs', x: x0, y: y0 + 0.5 + 1.2, w: 15, h: 2.4, depth: 6.5, I, face: -1, label: 'cleaning, upper face' });
    add({ shape: 'ccs', x: x0, y: y0 - 0.5 - 1.2, w: 15, h: 2.4, depth: 6.5, I, face: 1, label: 'cleaning, lower face' });
  }
  if (id === 'jcut') {
    const I = P.nearestCurrent(S.ion, ga ? 2500 : 15000);
    add({ shape: 'rect', x: x0 - 7.6, y: y0, w: 0.8, h: 2.4, depth: 7, I, label: 'J-cut side' });
    add({ shape: 'rect', x: x0 + 1.5, y: y0 - 0.9, w: 17, h: 0.6, depth: 7.5, I, label: 'J-cut bottom' });
  }
  if (id === 'liftout') {
    // weld the needle, cut the tab, lift, attach to the grid post: ~10 minutes of careful manipulation
    L.time += 600; L.liftedOut = true; L.onGrid = true; L.step = 6; L.t_top = 1000; L.wedge = ga ? 1.6 : 1.2; L.amorph = [ga ? 22 : 12, ga ? 22 : 12];
    L.capLeft = 1.1; L.ion = S.ion;
    L.log.push({ step: 'liftout' });
    sim.invalidate('pattern');
    return 'liftout';
  }
  if (ids.length) {
    L.busy = ids; sim.mill.start();
    const t = sim.mill.patterns.filter((p) => ids.includes(p.id)).reduce((a, p) => a + p.tEst, 0);
    L.time += t;
  }
  return id;
}
// called every frame: a step is finished when its patterns are
export function lamTick(sim) {
  const L = sim.lam;
  if (!L.busy) return false;
  const left = sim.mill.patterns.filter((p) => L.busy.includes(p.id) && p.status !== 'done');
  if (left.length) return false;
  const id = LAM_STEPS[L.step].id;
  L.log.push({ step: id }); L.busy = null; L.step++;
  if (id === 'ionPt') L.capLeft = 1.4;
  if (id === 'clean') { L.t_top = 1000; L.wedge = 1.6; }
  return true;
}
export function lamThin(S, sim, o = {}) {
  const L = sim.lam;
  if (L.step < 6) return null;
  const dt = thinPass(L, { ion: S.ion, I: o.I ?? S.lamI, kV: o.kV ?? S.lamKV, target: o.target ?? S.lamTarget, overtilt: o.overtilt ?? S.lamOver, rocking: S.rocking });
  sim.invalidate('pattern');
  return dt;
}
export function lamPolish(S, sim, kV) {
  const L = sim.lam;
  if (L.step < 6) return null;
  L.step = 7;
  return lamThin(S, sim, { I: P.nearestCurrent(S.ion, S.ion === 'Ga' ? (kV <= 2 ? 25 : 50) : 100), kV, target: Math.max(5, L.t_top - (kV <= 2 ? 6 : 12)), overtilt: S.lamOver + 3 });
}

// ---------------------------------------------------------------- the shared executor
// op → a short description of what was done (or a result for analyses); hooks supply what needs the page
export function applyOp(S, sim, op, hooks = {}) {
  const spec = sim.spec, ion = activeBeam(S) === 'ion';
  switch (op.op) {
    case 'mode': (hooks.setMode ?? ((m) => modeState(S, sim, m)))(op.v); break;
    case 'spec': (hooks.setSpec ?? ((v) => specState(S, sim, v)))(op.v); break;
    case 'set': {
      const k = op.k;
      if (k === 'fov') S.fov = clamp(op.v, spec.fovMin, spec.fovMax);
      else if (k === 'tilt') S.tilt = clamp(Math.round(op.v), 0, 72);
      else if (k === 'focus' || k === 'ifocus') S[k] = op.v;
      else if (k === 'clarity') { if (['edu', 'real'].includes(op.v)) S.clarity = op.v; }
      else if (['flood', 'rocking', 'showLabels', 'coated', 'realTime'].includes(k)) S[k] = !!op.v;
      else if (k in S && typeof S[k] === typeof op.v) S[k] = op.v;
      op.v = S[k];
      sim.invalidate(k === 'focus' || k === 'ifocus' ? k : k === 'tilt' ? 'tilt' : 'all');
      break;
    }
    case 'chip':
      if (op.k === 'ion') setIon(S, sim, op.v);
      else if (op.k === 'gas' && ['none', 'XeF2', 'H2O'].includes(op.v)) S.gas = op.v;
      else if (op.k === 'fibDet' && ['ise', 'si'].includes(op.v)) { S.fibDet = op.v; sim.invalidate('fibDet'); }
      else if (op.k === 'mcBeam' && ['e', 'ion'].includes(op.v)) { S.mcBeam = op.v; sim.invalidate('all'); }
      break;
    case 'current':
      if (op.beam === 'ion') { S.icur = P.nearestCurrent(S.ion, op.v); op.v = S.icur; sim.invalidate('icur'); }
      else { S.current = clamp(op.v, 1, 20000); op.v = S.current; sim.invalidate('current'); }
      break;
    case 'scaleCurrent':
      if (ion) { const L = P.ION[S.ion].currents, i = L.indexOf(P.nearestCurrent(S.ion, S.icur)); S.icur = L[clamp(i + op.f, 0, L.length - 1)]; sim.invalidate('icur'); }
      else { S.current = clamp(S.current * (op.f > 0 ? 2 : 0.5), 1, 20000); sim.invalidate('current'); }
      break;
    case 'kv':
      if (op.beam === 'ion') { S.ikV = clamp(Math.round(op.v), 1, 30); op.v = S.ikV; sim.invalidate('ikV'); }
      else { S.kV = clamp(+op.v, 0.5, 30); op.v = S.kV; sim.invalidate('kV'); }
      break;
    case 'nudge': S[op.k] = +(S[op.k] + (op.d * 1.5 * S.fov) / 256 / (op.k === 'ifocus' ? sim.iprobe.alpha : sim.probe.alpha)).toFixed(4); sim.invalidate(op.k); break;
    case 'nudgeZ': S.ez = +clamp(S.ez + op.d, -60, 60).toFixed(2); sim.invalidate('ez'); break;
    case 'zoom': S.fov = clamp(S.fov * op.f, spec.fovMin, spec.fovMax); sim.invalidate('fov'); break;
    case 'pattern': {
      if (op.shape) S.shape = op.shape;
      if (op.w) S.patW = op.w; if (op.h) S.patH = op.h; if (op.depth) S.patDepth = op.depth;
      if (op.gas !== undefined && op.gas !== null) S.gas = op.gas;
      if (!ION_MODES.includes(S.mode)) (hooks.setMode ?? ((m) => modeState(S, sim, m)))('mill');
      const p = addPattern(S, sim, { kind: 'mill', shape: S.shape, face: 1 });
      op.id = p.id; op.tEst = p.tEst;
      if (op.start !== false) { if (hooks.headless) runQueue(sim); else sim.mill.start(); }
      break;
    }
    case 'deposit': {
      S.depGas = op.gas ?? S.depGas; S.depBeam = op.beam ?? S.depBeam;
      if (op.thick) S.depThick = op.thick; if (op.w) S.patW = op.w; if (op.h) S.patH = op.h;
      if (S.mode !== 'gis') (hooks.setMode ?? ((m) => modeState(S, sim, m)))('gis');
      const p = addPattern(S, sim, { kind: 'dep' });
      op.id = p.id; op.tEst = p.tEst;
      if (hooks.headless) runQueue(sim); else sim.mill.start();
      break;
    }
    case 'lam':
      if (S.mode !== 'lam') (hooks.setMode ?? ((m) => modeState(S, sim, m)))('lam');
      if (op.v === 'next') op.done = lamStep(S, sim);
      else if (op.v === 'thin') { if (op.target) S.lamTarget = op.target; op.done = lamThin(S, sim); }
      else if (op.v === 'polish') op.done = lamPolish(S, sim, op.kV ?? 5);
      if (hooks.headless) { runQueue(sim); lamTick(sim); }
      break;
    case 'action':
      if (op.v === 'pause') S.paused = !S.paused;
      else if (op.v === 'millStart') sim.mill.start();
      else if (op.v === 'millStop') sim.mill.stop();
      else if (op.v === 'clearPatterns') sim.mill.clearQueued();
      else if (op.v === 'resetMill') { sim.mill.reset(); sim.lam = newLamella(); sim.invalidate('all'); }
      else if (op.v === 'eucentric') { S.ez = 0; sim.invalidate('ez'); }
      else if (op.v === 'autofocus') (hooks.autofocus ?? (() => autofocusNow(S, sim)))();
      break;
    case 'cycle': { const i = MODES.indexOf(S.mode); (hooks.setMode ?? ((m) => modeState(S, sim, m)))(MODES[(i + op.d + MODES.length) % MODES.length]); break; }
    default: hooks.other?.(op);
  }
  return op;
}
// focus and stigmate the active beam on the true optimum, with a little measurement error
export function autofocusNow(S, sim) {
  const mis = S.mis ?? {};
  if (activeBeam(S) === 'ion') { S.ifocus = +((mis.iFocus ?? 0) + (Math.random() - 0.5) * 2).toFixed(2); S.istig = +(sim.iastig + (mis.iStig ?? 0) + (Math.random() - 0.5) * 0.02).toFixed(3); sim.invalidate('ifocus'); }
  else { S.focus = +((mis.eFocus ?? 0) + (Math.random() - 0.5) * 0.004 * S.fov).toFixed(4); S.stig = +(sim.astig + (mis.eStig ?? 0) + (Math.random() - 0.5) * 0.02).toFixed(3); sim.invalidate('focus'); }
}
