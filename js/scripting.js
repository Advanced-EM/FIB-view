// What a Python script can do to the instrument. One implementation serves every way of running a script:
//   - the Python IDE inside the exhibit (Pyodide, js/ide.js)
//   - desktop Python driving an open exhibit (the agent bridge, method "script")
//   - desktop Python with the headless simulator (tools/fibview-py/fibview/driver.mjs)
// The host supplies the state, the simulator and how to run one operation; this file holds the rest, so a
// script behaves the same in all three. Every call is synchronous: the simulator computes on demand.
import * as P from './physics.js';
import { collectData, toNpz } from './export.js';
import { analyze, ANALYSES } from './analyze.js';
import { parseCommand } from './voice.js';
import { SCENARIOS } from './scenarios.js';
import { MODES, activeBeam, addPattern, runQueue } from './ops.js';
import { SESSION_KEYS } from './state.js';
import { lamQuality } from './mill.js';

export const SCRIPT_API = 1;
const SPECS = P.SPEC_KEYS;
const CHALLENGES = ['sem-focus-stig', 'fib-focus-stig', 'eucentric'];
const SETTINGS = {
  mode: MODES.join(', '), specimen: SPECS.join(', '), kV: 'electron beam, 0.5–30', current_pA: 'electron probe current', wd_mm: 'working distance',
  tilt_deg: 'stage tilt (52: ion beam normal to the surface)', fov_um: 'field of view', focus_um: 'electron focus', stage_z_um: 'height above/below the coincidence point',
  ion: 'Ga, Xe, Ar, N, O', ion_kV: 'ion beam, 1–30', ion_current_pA: 'snaps to the aperture strip', ion_focus_um: 'ion focus', stig: 'electron stigmator', ion_stig: 'ion stigmator', detector: 'ise or si (ion image)',
  realistic: 'shot noise and real detectors', beam: 'True (on) or False (blanked)', gas: 'none, XeF2, H2O (milling)',
};

export function settingsToOps(a) {
  const bad = Object.keys(a).filter((k) => !(k in SETTINGS));
  if (bad.length) throw new Error(`unknown setting ${bad.join(', ')}. Settings: ${Object.keys(SETTINGS).join(', ')}`);
  const ops = [];
  if (a.specimen !== undefined) { if (!SPECS.includes(a.specimen)) throw new Error(`specimen must be one of ${SPECS.join(', ')}`); ops.push({ op: 'spec', v: a.specimen }); }
  if (a.mode !== undefined) { if (!MODES.includes(a.mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`); ops.push({ op: 'mode', v: a.mode }); }
  if (a.ion !== undefined) { if (!P.ION[a.ion]) throw new Error('ion must be Ga, Xe, Ar, N or O'); ops.push({ op: 'chip', k: 'ion', v: a.ion }); }
  if (a.kV !== undefined) ops.push({ op: 'kv', beam: 'e', v: +a.kV });
  if (a.ion_kV !== undefined) ops.push({ op: 'kv', beam: 'ion', v: +a.ion_kV });
  if (a.current_pA !== undefined) ops.push({ op: 'current', beam: 'e', v: +a.current_pA });
  if (a.ion_current_pA !== undefined) ops.push({ op: 'current', beam: 'ion', v: +a.ion_current_pA });
  if (a.wd_mm !== undefined) ops.push({ op: 'set', k: 'wd', v: +a.wd_mm });
  if (a.tilt_deg !== undefined) ops.push({ op: 'set', k: 'tilt', v: +a.tilt_deg });
  if (a.stage_z_um !== undefined) ops.push({ op: 'set', k: 'ez', v: +a.stage_z_um });
  if (a.fov_um !== undefined) ops.push({ op: 'set', k: 'fov', v: +a.fov_um });
  if (a.focus_um !== undefined) ops.push({ op: 'set', k: 'focus', v: +a.focus_um });
  if (a.ion_focus_um !== undefined) ops.push({ op: 'set', k: 'ifocus', v: +a.ion_focus_um });
  if (a.stig !== undefined) ops.push({ op: 'set', k: 'stig', v: +a.stig });
  if (a.ion_stig !== undefined) ops.push({ op: 'set', k: 'istig', v: +a.ion_stig });
  if (a.detector !== undefined) ops.push({ op: 'chip', k: 'fibDet', v: a.detector });
  if (a.gas !== undefined) ops.push({ op: 'chip', k: 'gas', v: a.gas });
  if (a.realistic !== undefined) ops.push({ op: 'set', k: 'clarity', v: a.realistic ? 'real' : 'edu' });
  if (a.beam !== undefined) ops.push({ op: 'set', k: 'paused', v: !a.beam });
  return ops;
}

export function stateSummary(S, sim) {
  const pe = sim.probe, pi = sim.iprobe, s = sim.sampleAt(S.cx, S.cy), y = P.sputter(S.ion, P.MAT[s.mat].rho ? s.mat : 'Si', S.ikV);
  return {
    mode: S.mode, active_beam: activeBeam(S), specimen: S.spec, specimen_name: sim.spec.name, fov_um: S.fov, center_um: [S.cx, S.cy], tilt_deg: S.tilt, stage_z_um: S.ez,
    electron: { kV: S.kV, current_pA: S.current, wd_mm: S.wd, aperture_um: S.aperture, probe_nm: +pe.d.toFixed(2), focus_um: S.focus },
    ion: { species: S.ion, source: P.ION[S.ion].src, kV: S.ikV, current_pA: S.icur, probe_nm: +pi.d.toFixed(1), focus_um: S.ifocus, detector: S.fibDet },
    under_beam: { material: P.MAT[s.mat].name, sputter_yield_atoms_per_ion: +y.Y.toFixed(3), volume_yield_um3_per_nC: +y.Yv.toFixed(4) },
    patterns: sim.mill.patterns.filter((p) => p.kind !== 'img').map((p) => ({ id: p.id, kind: p.kind, shape: p.shape, status: p.status, done: +p.done.toFixed(3), depth_um: p.depth, est_time_s: +p.tEst.toFixed(1) })),
    lamella: S.mode === 'lam' ? { step: sim.lam.step } : undefined,
    clarity: S.clarity, beam: S.paused ? 'blanked' : 'on',
  };
}

const plain = (html) => String(html).replace(/<kbd>(.*?)<\/kbd>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export class ScriptCore {
  // host: { name, S, sim, run(op) → description or result, busy() → reason | null, refresh(), scenarioApi }
  constructor(host) { this.h = host; this.ch = null; }
  get S() { return this.h.S; }
  get sim() { return this.h.sim; }
  guard() { const b = this.h.busy?.(); if (b) throw new Error(b); }
  settle(steps) {
    const S = this.S, n = steps ?? (S.mode === 'ebsd' || S.mode === 'tkd' ? 200 : S.mode === 'sv' ? 80 : S.mode === 'mc' ? 60 : 6);
    for (let i = 0; i < n; i++) {
      this.sim.update(S.mode === 'sv' ? 0.4 : 0.05);
      if ((S.mode === 'ebsd' || S.mode === 'tkd') && this.sim.map && this.sim.map.done >= this.sim.map.N ** 2) break;
      if (S.mode === 'sv' && this.sim.sv?.done) break;
    }
  }
  info() {
    return { api: SCRIPT_API, backend: this.h.name, modes: MODES, specimens: SPECS, ions: P.ION_KEYS, settings: SETTINGS, analyses: Object.keys(ANALYSES), challenges: CHALLENGES.map((id) => ({ id, title: SCENARIOS[id].title })), compute: 'cpu' };
  }
  state() { return { ...stateSummary(this.S, this.sim), challenge: this.ch?.id ?? null }; }
  set(a = {}) {
    this.guard();
    const done = settingsToOps(a).map((op) => this.h.run(op));
    this.h.refresh?.();
    return done;
  }
  command({ text } = {}) {
    this.guard();
    const r = parseCommand(String(text ?? ''), { paused: this.S.paused, mode: this.S.mode, beam: activeBeam(this.S) });
    if (!r.ops) return { understood: false, text };
    const done = r.ops.filter((op) => op.op !== 'export').map((op) => this.h.run(op));
    this.h.refresh?.();
    return { understood: true, done };
  }
  // add a pattern and run it to completion: instrument time passes at once
  mill({ shape = 'rect', x, y, w = 5, h = 5, depth = 1, gas = null, face = 1 } = {}) {
    this.guard();
    const S = this.S, sim = this.sim;
    if (!['fib', 'mill', 'gis', 'lam'].includes(S.mode)) this.h.run({ op: 'mode', v: 'mill' });
    const p = addPattern(S, sim, { kind: 'mill', shape, x: x ?? S.cx, y: y ?? S.cy, w, h, depth, gas, face });
    runQueue(sim);
    this.h.refresh?.();
    return { id: p.id, ...sim.mill.measure(p), time_s: +p.t.toFixed(1), est_time_s: +p.tEst.toFixed(1), status: p.status };
  }
  deposit({ gas = 'Pt', x, y, w = 10, h = 2, thickness = 1, beam = 'ion' } = {}) {
    this.guard();
    const S = this.S, sim = this.sim;
    if (!['gis', 'mill', 'lam'].includes(S.mode)) this.h.run({ op: 'mode', v: 'gis' });
    const p = addPattern(S, sim, { kind: 'dep', gas, beam, x: x ?? S.cx, y: y ?? S.cy, w, h, depth: thickness });
    runQueue(sim);
    this.h.refresh?.();
    const m = sim.mill.measure(p);
    return { id: p.id, thickness_um: +(-m.volume / (w * h)).toFixed(4), charge_nC: m.charge, time_s: +p.t.toFixed(1) };
  }
  lamella({ action = 'next', target_nm, kV } = {}) {
    this.guard();
    const op = this.h.run({ op: 'lam', v: action, target: target_nm, kV });
    this.settle(4);
    return { step: this.sim.lam.step, done: op?.done ?? op, quality: lamQuality(this.sim.lam) };
  }
  acquire({ steps } = {}) {
    this.guard();
    this.settle(steps);
    const data = collectData(this.sim, this.S);
    if (!Object.keys(data.arrays).length) throw new Error(`nothing to record in ${this.S.mode} mode yet`);
    return { npz: toNpz(data), arrays: Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape])), meta: data.meta };
  }
  analyze({ name } = {}) { this.guard(); this.settle(3); return analyze(this.sim, this.S, name ?? undefined); }
  step({ n = 1 } = {}) { this.settle(Math.max(1, Math.min(2000, n | 0))); return { time_s: +(this.sim.clock ?? 0).toFixed(2) }; }
  challenge({ id, seed } = {}) {
    this.guard();
    if (!CHALLENGES.includes(id)) throw new Error(`challenge must be one of ${CHALLENGES.join(', ')}`);
    const sc = SCENARIOS[id], s = Number.isInteger(seed) ? seed : (Math.random() * 2 ** 31) | 0;
    this.saved ??= structuredClone(Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, this.S[k]])));
    const info = sc.setup(this.h.scenarioApi, P.mulberry32(s));
    this.sim.invalidate('all');
    this.h.refresh?.();
    this.ch = { id, seed: s, ...info };
    return { id, seed: s, title: sc.title, task: plain(sc.brief), target: info.target };
  }
  score() {
    if (!this.ch) throw new Error('no challenge is running: call challenge() first');
    this.settle(3);
    return SCENARIOS[this.ch.id].metrics(this.h.scenarioApi, this.ch);
  }
  reveal() { if (!this.ch) throw new Error('no challenge is running'); return { id: this.ch.id, seed: this.ch.seed, hidden: this.ch.hidden }; }
  end_challenge() {
    const was = this.ch?.id ?? null;
    this.ch = null; this.S.mis = null;
    if (this.saved) {
      const st = this.saved; this.saved = null;
      if (this.h.scenarioApi?.restoreState) this.h.scenarioApi.restoreState({ ...st, mis: null });
      else { Object.assign(this.S, structuredClone(st)); this.S.mis = null; }
    }
    this.sim.invalidate('all'); this.h.refresh?.();
    return { ended: was, restored: true };
  }
  call(name, args = {}) {
    if (!['info', 'state', 'set', 'command', 'mill', 'deposit', 'lamella', 'acquire', 'analyze', 'step', 'challenge', 'score', 'reveal', 'end_challenge'].includes(name)) throw new Error(`unknown call ${name}`);
    return this[name](args ?? {});
  }
}

export function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64'); }
