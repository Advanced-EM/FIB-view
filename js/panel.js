// Hardware control panel support (and ordinary game controllers as a stand-in).
//
// Protocol of the TEM-view panel and Console (see hardware notes in the README): a USB HID joystick with 8 axes and
// 16 buttons. Axes 0–1 are the stage joystick (absolute); axes 2–7 are rotary encoders sent as 16-bit wrapping
// counters, so the browser reads how far each knob turned since the last poll. The same hardware drives FIB-view:
// the knobs act on whichever beam the current mode uses (electrons or ions).
//
// A standard game controller (Xbox / PlayStation layout) is mapped onto the same functions: sticks for the
// stage and the multifunction knobs, triggers for focus, bumpers for magnification, d-pad for current and mode.
import * as P from './physics.js';

export const AXES = [
  ['stageX', 'Stage X (joystick)'], ['stageY', 'Stage Y (joystick)'], ['focus', 'Focus (active beam)'], ['mag', 'Magnification'],
  ['intensity', 'Beam current'], ['mfX', 'Multifunction X'], ['mfY', 'Multifunction Y'], ['context', 'Context knob'],
];
export const BUTTONS = [
  ['modePrev', 'Previous mode'], ['modeNext', 'Next mode'], ['mfSelect', 'Multifunction: stigmator / beam shift / tilt & Z / pattern'], ['wobbler', 'Focus wobbler'],
  ['focusFine', 'Focus fine / coarse'], ['optFocus', 'Auto focus (active beam)'], ['pause', 'Pause / blank'], ['clarity', 'Educational / realistic'],
  ['labels', 'Labels'], ['narrate', 'Narration'], ['expand', 'Enlarge results'], ['calib', 'Start / stop patterning'], ['acquire', 'Acquire'], ['talk', 'Talk (hold to speak)'],
];
// multifunction modes; the pattern knobs only appear while patterning
export const MF = [['stig', 'Stigmator'], ['shift', 'Beam shift'], ['tilt', 'Tilt & Z'], ['pattern', 'Pattern size', true]];

const DEFAULTS = {
  panel: {
    axes: { stageX: 0, stageY: 1, focus: 2, mag: 3, intensity: 4, mfX: 5, mfY: 6, context: 7 },
    buttons: { modePrev: 0, modeNext: 1, mfSelect: 2, wobbler: 3, focusFine: 4, optFocus: 5, pause: 6, clarity: 7, labels: 8, narrate: 9, expand: 10, calib: 11, acquire: 12, talk: 13 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 }, counts: 4,
  },
  standard: {
    axes: { stageX: 0, stageY: 1, mfX: 2, mfY: 3 },
    buttons: { mfSelect: 0, wobbler: 1, optFocus: 2, clarity: 3, magDown: 4, magUp: 5, focusDown: 6, focusUp: 7, focusFine: 8, pause: 9, acquire: 10, talk: 11, intensityUp: 12, intensityDown: 13, modePrev: 14, modeNext: 15 },
    invert: {}, sens: { focus: 1, mag: 1, intensity: 1, mf: 1, stage: 1, context: 1 },
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const PATTERN_MODES = ['mill', 'gis'];

export class Panel {
  // api: { S, sim, set(key, v, inv), setRaw(key, v, inv), moveStage(dx, dy), cycleMode(d), action(id), toggle(name), refresh(), explain(key), beam() → 'e'|'ion' }
  constructor(api) {
    this.api = api;
    this.pad = null; this.kind = null; this.prevAxes = null; this.prevButtons = [];
    this.mf = 'stig'; this.fine = false; this.wob = null; this.acc = {}; this.lastApply = 0; this.msg = ''; this.msgT = 0; this.repeat = {};
    this.maps = { panel: store('fib-panel-map-panel') ?? structuredClone(DEFAULTS.panel), standard: store('fib-panel-map-standard') ?? structuredClone(DEFAULTS.standard) };
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => this.say(`Connected: ${shortName(e.gamepad.id)}`));
      window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.say('Panel disconnected'); });
    }
  }
  map() { return this.maps[this.kind ?? 'panel']; }
  saveMap() { store(`fib-panel-map-${this.kind}`, this.map()); }
  resetMap() { this.maps[this.kind] = structuredClone(DEFAULTS[this.kind]); this.saveMap(); }
  say(m) { this.msg = m; this.msgT = performance.now(); }
  beam() { return this.api.beam?.() ?? 'e'; }

  poll(dt) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads.find((p) => /TEM-view|FIB-view/i.test(p.id)) ?? pads[0] ?? null;
    if (!gp) { this.pad = null; this.stageV = this.vstage; this.wobble(dt); this.flush(dt); return; }
    if (!this.pad || this.pad.index !== gp.index) { this.prevAxes = null; this.prevButtons = []; }
    this.pad = gp;
    this.kind = /TEM-view|FIB-view/i.test(gp.id) || gp.mapping !== 'standard' ? 'panel' : 'standard';
    const M = this.map(), ax = gp.axes, bt = gp.buttons.map((b) => b.value), inv = (k) => (M.invert[k] ? -1 : 1);
    const A = (k) => (M.axes[k] != null && M.axes[k] < ax.length ? ax[M.axes[k]] * inv(k) : 0);
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const pressed = (k) => { const i = M.buttons[k]; return i != null && bt[i] > 0.5 && !(this.prevButtons[i] > 0.5); };
    const held = (k) => { const i = M.buttons[k]; return i != null ? bt[i] ?? 0 : 0; };
    const add = (k, v) => { if (v) this.acc[k] = (this.acc[k] ?? 0) + v; };
    if (this.kind === 'panel') {
      const cur = {};
      for (const k of ['focus', 'mag', 'intensity', 'mfX', 'mfY', 'context']) cur[k] = A(k);
      if (this.prevAxes) for (const k in cur) {
        let d = Math.round((cur[k] - this.prevAxes[k]) * 32767);
        if (d > 32767) d -= 65535; else if (d < -32767) d += 65535;
        add(k, d / (M.counts || 4));
      }
      this.prevAxes = cur;
    } else {
      add('mfX', dz(A('mfX')) * 12 * dt); add('mfY', dz(A('mfY')) * 12 * dt);
      add('focus', (held('focusUp') - held('focusDown')) * 14 * dt);
      for (const [k, key, d] of [['magUp', 'mag', 1], ['magDown', 'mag', -1], ['intensityUp', 'intensity', 1], ['intensityDown', 'intensity', -1]]) {
        if (held(k) > 0.5) { this.repeat[k] = (this.repeat[k] ?? -0.35) + dt; if (pressed(k) || this.repeat[k] > 0.12) { add(key, d); if (this.repeat[k] > 0.12) this.repeat[k] = 0; } } else this.repeat[k] = -0.35;
      }
    }
    const sx = dz(A('stageX')), sy = dz(A('stageY'));
    this.stageV = sx || sy ? [sx, sy] : this.vstage;
    for (const [k] of BUTTONS) if (k !== 'talk' && pressed(k)) this.button(k);
    const ti = M.buttons.talk;
    if (ti != null) { const now = bt[ti] > 0.5, was = this.prevButtons[ti] > 0.5; if (now !== was) this.api.talk?.(now); }
    this.prevButtons = bt;
    if (Object.keys(this.acc).length || this.stageV) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    this.wobble(dt);
    this.flush(dt);
  }
  flush() {
    if (this.stageV) this.acc.stage = 1;
    const now = performance.now();
    if (now - this.lastApply > 50 && Object.keys(this.acc).length) { this.lastApply = now; this.apply(); }
  }

  // ---------------------------------------------------------------- input from the on-screen panel
  turn(axis, detents) { this.api.noteSource?.('onscreen-panel'); this.acc[axis] = (this.acc[axis] ?? 0) + detents; }
  setStage(vx, vy) { if (vx || vy) this.api.noteSource?.('onscreen-panel'); this.vstage = vx || vy ? [vx, vy] : null; }
  button(k) {
    if (this.pad && !this.virtual) this.api.noteSource?.(this.kind === 'panel' ? 'panel' : 'controller');
    if (k === 'talk') return;
    if (k === 'modePrev') this.api.cycleMode(-1);
    else if (k === 'modeNext') this.api.cycleMode(1);
    else if (k === 'mfSelect') { const L = this.mfList(), i = L.findIndex((m) => m[0] === this.mf); this.setMF(L[(i + 1) % L.length][0]); }
    else if (k === 'focusFine') { this.fine = !this.fine; this.say(`Focus ${this.fine ? 'fine' : 'coarse'}`); }
    else if (k === 'wobbler') this.toggleWobbler();
    else if (k === 'optFocus') { this.api.action('autofocus'); this.say(`Auto focus (${this.beam() === 'ion' ? 'ion' : 'electron'} beam)`); }
    else if (k === 'calib') this.api.action('millToggle');
    else this.api.toggle(k);
  }
  setMF(k) { this.mf = k; this.say(`Multifunction knobs: ${MF.find((m) => m[0] === k)[1]}`); }
  mfList() { return MF.filter((m) => !m[2] || PATTERN_MODES.includes(this.api.S.mode)); }
  mfNow() { if (!this.mfList().some((m) => m[0] === this.mf)) this.mf = 'stig'; return this.mf; }
  // the context knob's job in each mode
  contextOf() {
    const S = this.api.S, m = S.mode;
    if (m === 'mill') return ['Pattern depth', `${S.patDepth} µm`];
    if (m === 'gis') return ['Deposit thickness', `${S.depThick} µm`];
    if (m === 'lam') return ['Target thickness', `${S.lamTarget} nm`];
    if (m === 'sv') return ['Slice thickness', `${S.svSlice} nm`];
    if (m === 'tkd') return ['Foil thickness', `${S.tkdThick} nm`];
    if (m === 'ebsd') return ['Pattern exposure', `${S.expo} ms`];
    if (m === 'fib' || (m === 'mc' && S.mcBeam === 'ion')) return ['Ion voltage', `${S.ikV} kV`];
    return ['Accelerating voltage', `${S.kV} kV`];
  }
  readouts() {
    const { S, sim } = this.api, ion = this.beam() === 'ion';
    const mf = this.mfNow();
    const mfv = mf === 'stig' ? `${ion ? S.istig.toFixed(2) : S.stig.toFixed(2)}` : mf === 'shift' ? `${S.cx.toFixed(2)}, ${S.cy.toFixed(2)} µm` : mf === 'tilt' ? `${S.tilt}°, Z ${S.ez >= 0 ? '+' : ''}${S.ez.toFixed(1)} µm` : `${S.patW} × ${S.patH} µm`;
    return {
      focus: ['Focus', `${ion ? 'ion' : 'e⁻'} ${(ion ? S.ifocus : S.focus) >= 0 ? '+' : ''}${(ion ? S.ifocus : S.focus).toFixed(2)} µm · ${this.fine ? 'fine' : 'coarse'}`],
      mag: ['Magnification', `${S.fov < 1 ? `${(S.fov * 1000).toFixed(0)} nm` : `${S.fov.toFixed(1)} µm`} field`],
      intensity: ['Beam current', ion ? `${S.ion}⁺ ${P.fmtCurrent(S.icur)}` : P.fmtCurrent(S.current)],
      mf: [MF.find((x) => x[0] === mf)[1], mfv], context: this.contextOf(),
    };
  }

  apply() {
    const { S } = this.api, M = this.map(), acc = this.acc;
    this.acc = {};
    const sens = M.sens, ion = this.beam() === 'ion';
    if (acc.focus) {
      // one fine detent blurs the image by about a third of a pixel: the step follows the beam's convergence angle
      const alpha = ion ? this.api.sim.iprobe.alpha : this.api.sim.probe.alpha, key = ion ? 'ifocus' : 'focus';
      const step = ((0.3 * S.fov) / 256 / alpha) * (this.fine ? 1 : 5) * sens.focus;
      const lim = ion ? Math.max(5, Math.min(3000, S.fov * 40)) : Math.max(0.3, Math.min(200, S.fov * 3));
      if (this.wob && !ion) this.wob.base = clamp(this.wob.base + acc.focus * step, -lim, lim);
      else this.api.set(key, +clamp(S[key] + acc.focus * step, -lim, lim).toFixed(4), key);
      this.say(`Focus ${S[key] > 0 ? '+' : ''}${S[key].toFixed(ion ? 1 : 3)} µm (${ion ? 'ion' : 'electron'} beam)`);
    }
    if (acc.mag) {
      const sp = this.api.sim.spec;
      this.api.set('fov', +clamp(S.fov * Math.pow(1.1, -acc.mag * sens.mag), sp.fovMin, sp.fovMax).toFixed(4), 'fov');
      this.say(`Field of view ${S.fov < 1 ? `${(S.fov * 1000).toFixed(0)} nm` : `${S.fov.toFixed(1)} µm`}`);
    }
    if (acc.intensity) {
      if (ion) {
        const L = P.ION[S.ion].currents, i = L.indexOf(P.nearestCurrent(S.ion, S.icur)), j = clamp(i + Math.round(acc.intensity * sens.intensity), 0, L.length - 1);
        this.api.set('icur', L[j], 'icur'); this.say(`Ion current ${P.fmtCurrent(S.icur)}`);
      } else { this.api.set('current', +clamp(S.current * Math.pow(1.25, acc.intensity * sens.intensity), 1, 20000).toFixed(1), 'current'); this.say(`Probe current ${P.fmtCurrent(S.current)}`); }
    }
    if (acc.mfX || acc.mfY) this.multifunction((acc.mfX ?? 0) * sens.mf, (acc.mfY ?? 0) * sens.mf);
    if (acc.context) this.context(acc.context * sens.context);
    if (acc.stage && this.stageV) {
      const f = S.fov * 0.05 * sens.stage;
      this.api.moveStage(this.stageV[0] * f, -this.stageV[1] * f);
    }
  }
  multifunction(dx, dy) {
    const o = this.api.mfOverride?.();
    if (o) { o.apply(dx, dy); this.say(o.label()); return; }
    const { S } = this.api, mf = this.mfNow(), ion = this.beam() === 'ion';
    if (mf === 'stig') {
      const key = ion ? 'istig' : 'stig';
      this.api.set(key, +clamp(S[key] + (dx + dy) * 0.02, -2, 2).toFixed(3), key);
      this.say(`Stigmator (${ion ? 'ion' : 'electron'}) ${S[key].toFixed(2)}`);
    } else if (mf === 'shift') {
      const f = S.fov * 0.01;
      this.api.moveStage(dx * f, dy * f);
      this.say('Beam shift');
    } else if (mf === 'tilt') {
      if (dx) this.api.set('tilt', clamp(Math.round(S.tilt + dx), 0, 72), 'tilt');
      if (dy) this.api.set('ez', +clamp(S.ez + dy * 0.5, -40, 40).toFixed(1), 'ez');
      this.say(`Tilt ${S.tilt}°, stage Z ${S.ez >= 0 ? '+' : ''}${S.ez.toFixed(1)} µm`);
    } else {
      this.api.set('patW', +clamp(S.patW * Math.pow(1.05, dx), 0.2, 200).toFixed(2), 'pattern');
      this.api.set('patH', +clamp(S.patH * Math.pow(1.05, dy), 0.05, 200).toFixed(2), 'pattern');
      this.say(`Pattern ${S.patW} × ${S.patH} µm`);
    }
  }
  context(d) {
    const { S } = this.api, m = S.mode;
    const step = (key, mul, lo, hi, label, unit, digits = 1, inv = key) => { this.api.set(key, +clamp(S[key] * Math.pow(mul, d), lo, hi).toFixed(digits), inv); this.say(`${label} ${S[key]} ${unit}`); };
    const lin = (key, inc, lo, hi, label, unit, digits = 1, inv = key) => { this.api.set(key, +clamp(S[key] + d * inc, lo, hi).toFixed(digits), inv); this.say(`${label} ${S[key]} ${unit}`); };
    if (m === 'mill') step('patDepth', 1.1, 0.02, 200, 'Pattern depth', 'µm', 2, 'pattern');
    else if (m === 'gis') step('depThick', 1.1, 0.02, 20, 'Deposit thickness', 'µm', 2, 'pattern');
    else if (m === 'lam') step('lamTarget', 1.06, 20, 3000, 'Target thickness', 'nm', 0, 'pattern');
    else if (m === 'sv') step('svSlice', 1.1, 5, 1000, 'Slice', 'nm', 0, 'svSlice');
    else if (m === 'tkd') lin('tkdThick', 5, 20, 400, 'Foil thickness', 'nm', 0);
    else if (m === 'ebsd') lin('expo', 1, 1, 50, 'Exposure', 'ms', 0);
    else if (this.beam() === 'ion' || (m === 'mc' && S.mcBeam === 'ion')) lin('ikV', 1, 1, 30, 'Ion voltage', 'kV', 0);
    else lin('kV', 0.5, 0.5, 30, 'Accelerating voltage', 'kV', 1);
  }
  // focus wobbler: flick the electron focus up and down; the image swings sideways if the aperture is off-centre
  toggleWobbler() {
    const { S } = this.api;
    if (this.wob) { this.api.set('focus', this.wob.base, 'focus'); this.wob = null; this.say('Wobbler off'); return; }
    this.wob = { base: S.focus, t: 0, sign: 1 };
    this.say('Wobbler on');
  }
  wobble(dt) {
    if (!this.wob) return;
    const { S } = this.api;
    this.wob.t += dt;
    if (this.wob.t < 0.3) return;
    this.wob.t = 0; this.wob.sign *= -1;
    this.api.setRaw('focus', +(this.wob.base + this.wob.sign * ((2 * S.fov) / 256 / this.api.sim.probe.alpha)).toFixed(4), 'focus');
  }

  hud(el) {
    if (!this.pad || this.virtual) { el.hidden = true; return; }
    el.hidden = false;
    const fresh = performance.now() - this.msgT < 2500;
    el.innerHTML = `<b>${esc(shortName(this.pad.id))}</b><span>${this.kind === 'panel' ? 'panel' : 'controller'} · ${this.beam() === 'ion' ? 'ion beam' : 'electron beam'}</span>
      <div class="mf">${this.mfList().map(([k, l]) => `<i class="${k === this.mf ? 'on' : ''}">${l}</i>`).join('')}</div>
      <small>focus ${this.fine ? 'fine' : 'coarse'}${this.wob ? ' · wobbler' : ''}</small>
      <p class="${fresh ? 'fresh' : ''}">${esc(this.msg)}</p>`;
  }
  renderConfig(el) {
    const gp = this.pad, M = gp ? this.map() : null;
    const vbtns = `<div class="crow"><button class="btn primary" data-vp="dock">On-screen panel (V)</button><button class="btn" data-vp="window">Pop out panel</button><span class="muted">Drive the microscope with the keyboard and mouse: the same knobs and buttons as the hardware panel.</span></div>`;
    const wireV = () => el.querySelectorAll('[data-vp]').forEach((b) => b.addEventListener('click', () => { el.closest('.modal').hidden = true; this.api.openVirtual(b.dataset.vp); }));
    if (!gp) {
      el.innerHTML = `<p class="eyebrow">Control panel</p><h2>Connect a <em>panel</em>, or use the keyboard</h2>${vbtns}
        <p>Plug in the TEM-view Console, or any game controller, over USB or Bluetooth, then <b>press one of its buttons</b>: browsers only reveal a controller after it has been used.</p>
        <p class="muted">The panel is a USB joystick (8 axes, 16 buttons). The knobs drive whichever beam the mode uses: focus, magnification, beam current (the ion column's aperture strip), the stigmator, beam shift, tilt and stage Z, and pattern size while milling.</p>
        <p><a href="https://advanced-em.github.io/TEM-view/console/" target="_blank" rel="noopener">The TEM-view Console</a>: the physical panel, in development. It drives this exhibit too.</p>`;
      wireV();
      return;
    }
    const opt = (n, sel) => `<option value="-1">—</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('')}`;
    const axisRows = this.kind === 'panel' ? AXES : AXES.filter(([k]) => ['stageX', 'stageY', 'mfX', 'mfY'].includes(k));
    const btnList = this.kind === 'panel' ? BUTTONS : [...BUTTONS.filter(([k]) => !['labels', 'narrate', 'expand', 'calib'].includes(k)), ['focusUp', 'Focus + (trigger)'], ['focusDown', 'Focus − (trigger)'], ['magUp', 'Magnification +'], ['magDown', 'Magnification −'], ['intensityUp', 'Current +'], ['intensityDown', 'Current −']];
    el.innerHTML = `<p class="eyebrow">Control panel · ${this.kind === 'panel' ? 'Console protocol' : 'standard game controller'}</p>
      <h2>${esc(shortName(gp.id))}</h2>
      <p class="muted">Turn a knob or press a button to see its number light up, then assign it below. Settings are saved in this browser.</p>
      <div class="pgrid">
        <div><h4>Axes</h4><table class="data pin">${axisRows.map(([k, l]) => `<tr><td>${l}</td><td><select data-ax="${k}">${opt(gp.axes.length, M.axes[k])}</select> <label class="inv"><input type="checkbox" data-inv="${k}" ${M.invert[k] ? 'checked' : ''}>invert</label></td></tr>`).join('')}</table></div>
        <div><h4>Buttons</h4><table class="data pin">${btnList.map(([k, l]) => `<tr><td>${l}</td><td><select data-bt="${k}">${opt(gp.buttons.length, M.buttons[k])}</select></td></tr>`).join('')}</table></div>
      </div>
      <h4>Live input</h4><div class="plive" id="pLive"></div>
      <h4>Sensitivity</h4><div class="cgrid">${Object.keys(M.sens).map((k) => `<label>${k}<input type="number" step="0.1" min="0.1" max="10" data-sens="${k}" value="${M.sens[k]}"></label>`).join('')}${this.kind === 'panel' ? `<label>Encoder counts per detent<input type="number" step="1" min="1" max="8" id="pCounts" value="${M.counts}"></label>` : ''}</div>
      <div class="crow"><button class="btn" id="pReset">Reset to defaults</button></div>${vbtns}`;
    wireV();
    el.querySelectorAll('[data-ax]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.axes[s.dataset.ax]; else M.axes[s.dataset.ax] = v; this.prevAxes = null; this.saveMap(); }));
    el.querySelectorAll('[data-bt]').forEach((s) => s.addEventListener('change', () => { const v = +s.value; if (v < 0) delete M.buttons[s.dataset.bt]; else M.buttons[s.dataset.bt] = v; this.saveMap(); }));
    el.querySelectorAll('[data-inv]').forEach((c) => c.addEventListener('change', () => { M.invert[c.dataset.inv] = c.checked; this.saveMap(); }));
    el.querySelectorAll('[data-sens]').forEach((c) => c.addEventListener('change', () => { M.sens[c.dataset.sens] = clamp(+c.value || 1, 0.1, 10); this.saveMap(); }));
    el.querySelector('#pCounts')?.addEventListener('change', (e) => { M.counts = clamp(Math.round(+e.target.value) || 4, 1, 8); this.saveMap(); });
    el.querySelector('#pReset').addEventListener('click', () => { this.resetMap(); this.renderConfig(el); });
  }
  renderLive(el) {
    const gp = this.pad;
    if (!gp || !el) return;
    el.innerHTML = `<div>${gp.axes.map((v, i) => `<span class="ax"><b>${i}</b><i style="--v:${((v + 1) / 2) * 100}%"></i></span>`).join('')}</div>
      <div>${gp.buttons.map((b, i) => `<span class="bt ${b.value > 0.5 ? 'on' : ''}">${i}</span>`).join('')}</div>`;
  }
}

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const shortName = (id) => String(id).replace(/\s*\(.*?Vendor.*?\)\s*/i, ' ').replace(/\s+/g, ' ').trim().slice(0, 48);
