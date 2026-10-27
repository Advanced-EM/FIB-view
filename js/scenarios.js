// Training scenarios: tasks with a hidden answer, recorded (with consent) for behavior research.
// Each scenario hides a seeded error in S.mis (or in the lamella's true geometry), so the readings are not the truth,
// and defines metrics the participant never sees until the end: how far the true result is from the target.
import * as P from './physics.js';
import { Recorder } from './telemetry.js';
import { SHARE } from './config.js';
import { newLamella, lamQuality, lamThickness, newCryoLamella, cryoPrep, cryoQuality } from './mill.js';

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const r1 = (v, d = 1) => +(+v).toFixed(d);
const sg = (rng) => (rng() < 0.5 ? -1 : 1);

// blur of a beam from its true defocus and astigmatism, in units of its probe diameter
function blurRatio(alpha, foc, ast, d_nm) {
  const b = alpha * Math.hypot(foc + ast, foc - ast) * 1000 / Math.SQRT2; // nm
  return { blur: b, E: Math.hypot(b, d_nm) / d_nm };
}

export const SCENARIOS = {
  'sem-focus-stig': {
    title: 'SEM: focus and stigmate',
    short: 'Tin spheres at high magnification, with the electron beam out of focus and astigmatic by hidden amounts. Make the image as sharp as the probe allows.',
    brief: 'The electron beam is defocused and astigmatic, and the knob readings do not tell you by how much. Using only the image, set the <b>focus</b> and the <b>stigmator</b> so that the smallest tin spheres are as sharp as the probe allows. Tip: astigmatism smears the image in one direction under focus and the perpendicular one over focus; stigmate until going through focus no longer streaks. Auto focus is disabled. Press <b>I\'m done</b> when you are satisfied.',
    cues: ['Edges look sharp', 'No streaking through focus', 'Smallest spheres resolved', 'Watched the sharpness number', 'Went through focus several times', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('sn');
      api.setMode('se');
      Object.assign(S, { kV: 5, current: 50, aperture: 30, wd: 4, tilt: 0, ez: 0, fov: 1.6, cx: 3.1, cy: -2.4, dwell: 2, focus: 0, stig: 0, clarity: 'edu' });
      const f = sg(rng) * (0.9 + rng() * 2.4), a = sg(rng) * (0.5 + rng() * 1.6);
      // the true astigmatism is stig − (0.9 + eStig): the knob's zero is not the answer
      S.mis = { eFocus: r1(f, 3), eStig: r1(-a - api.sim.astig, 3), cross: false };
      return { hidden: { mis: S.mis }, target: { blur_over_probe: 1 } };
    },
    metrics(api) {
      const { S, sim } = api, pr = sim.probe, mis = S.mis ?? {};
      const { blur, E } = blurRatio(pr.alpha, S.focus - (mis.eFocus ?? 0), S.stig - sim.astig - (mis.eStig ?? 0), pr.d);
      const score = Math.round(E <= 1.15 ? 100 : 100 * Math.exp(-(((E - 1.15) / 1.6) ** 2)));
      return { score, blur_nm: r1(blur, 2), probe_nm: r1(pr.d, 2), ratio: r1(E, 3), focus_err_um: r1(S.focus - (mis.eFocus ?? 0), 3), astig_err: r1(S.stig - sim.astig - (mis.eStig ?? 0), 3), success: score >= 80, verdict: score >= 95 ? 'Sharp ✓' : score >= 80 ? 'In focus ✓' : score >= 50 ? 'Close' : 'Not quite' };
    },
    explain: (m) => `The best this probe can do is ${m.probe_nm} nm. Your remaining defocus (${m.focus_err_um} µm) and astigmatism (${m.astig_err} µm between the two line foci) spread it by another ${m.blur_nm} nm, so the image is ${m.ratio}× as blurred as a perfectly focused one (≤ 1.15 counts as sharp). Experienced operators zoom in on a small, round feature, focus until it is sharpest, then stigmate in X and Y until going through focus only blurs it evenly, and repeat once.`,
    blocked: ['autofocus'],
  },
  'fib-focus-stig': {
    title: 'Ion beam: focus without destroying it',
    short: 'Focus and stigmate the gallium beam on tin spheres. Every frame you take sputters the specimen: get it sharp before the small spheres are gone.',
    brief: 'The ion beam is out of focus and astigmatic by hidden amounts. Make the ion image of the tin spheres as sharp as you can with the <b>ion focus</b> and <b>ion stigmator</b>. Unlike electrons, <b>every ion image removes material</b>: at this magnification the smallest spheres erode within minutes. Work fast, use fast scans (short dwell) and pause the beam while you think. Auto focus is disabled. Press <b>I\'m done</b> when satisfied.',
    cues: ['Edges look sharp', 'Small spheres resolved', 'Used short dwell times', 'Paused the beam between adjustments', 'Watched the sharpness number', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('sn');
      api.resetMill();
      api.setMode('fib');
      Object.assign(S, { ion: 'Ga', ikV: 30, icur: 8, tilt: 52, ez: 0, fov: 2.4, cx: -1.4, cy: 2.2, idwell: 1, ifocus: 0, istig: 0, fibDet: 'ise', clarity: 'edu' });
      const f = sg(rng) * (25 + rng() * 60), a = sg(rng) * (10 + rng() * 30);
      S.mis = { iFocus: r1(f, 1), iStig: r1(-a - api.sim.iastig, 2) };
      return { hidden: { mis: S.mis }, target: { blur_over_probe: 1, eroded_nm: 0 } };
    },
    metrics(api) {
      const { S, sim } = api, pr = sim.iprobe, mis = S.mis ?? {};
      const { blur, E } = blurRatio(pr.alpha, S.ifocus - (mis.iFocus ?? 0), S.istig - sim.iastig - (mis.iStig ?? 0), pr.d);
      const eroded = sim.imgRemoved ?? 0;
      const fs = E <= 1.2 ? 1 : Math.exp(-(((E - 1.2) / 1.8) ** 2)), ds = Math.exp(-Math.max(0, eroded - 10) / 80);
      const score = Math.round(100 * fs * ds);
      return { score, blur_nm: r1(blur, 1), probe_nm: r1(pr.d, 1), ratio: r1(E, 3), eroded_nm: r1(eroded, 1), dose_ions_nm2: r1(sim.imgDose ?? 0, 2), success: score >= 70, verdict: score >= 90 ? 'Sharp and intact ✓' : score >= 70 ? 'Good ✓' : fs > 0.8 ? 'Sharp, but damaged' : 'Not quite' };
    },
    explain: (m) => `The ion probe is ${m.probe_nm} nm; your residual defocus and astigmatism add ${m.blur_nm} nm (${m.ratio}× the ideal blur). Imaging delivered ${m.dose_ions_nm2} ions/nm² and removed about ${m.eroded_nm} nm from the centre of the field: tin sputters at ~5 atoms per gallium ion. FIB operators focus on a sacrificial spot next to the region of interest, at the lowest current that shows the feature, and never park the beam at high magnification.`,
    blocked: ['autofocus'],
  },
  eucentric: {
    title: 'Dual beam: find the eucentric height',
    short: 'The stage is at an unknown height. Bring the specimen to the beams’ coincidence point, where tilting does not move the image and both beams see the same spot.',
    brief: 'The electron and ion beams cross at one point, 52° apart. Only when the specimen surface sits exactly there (<b>eucentric height</b>) does a feature stay put while you tilt, and appear at the same place in the electron and the ion image. The stage Z reading is not calibrated today. Pick a feature at the centre of the electron image at 0° tilt, tilt toward 52° and watch it move; correct with <b>Stage Z</b> (or the multifunction knob in Tilt & Z), and repeat. Switch between the SE image and the ion image (keys <kbd>1</kbd> and <kbd>7</kbd>) to compare. Press <b>I\'m done</b> when the feature no longer moves.',
    cues: ['Feature stays put while tilting', 'Ion and electron images coincide', 'Used the centre crosshair', 'Tilted back and forth', 'Guessed'],
    setup(api, rng) {
      const { S } = api;
      api.setSpec('chip');
      api.setMode('se');
      Object.assign(S, { tilt: 0, fov: 30, cx: 2.1, cy: 1.7, kV: 5, current: 100, icur: 25, ion: 'Ga', clarity: 'edu' });
      S.ez = r1(sg(rng) * (8 + rng() * 30), 1);
      S.mis = { zRead: r1((rng() - 0.5) * 80, 1), cross: true };
      return { hidden: { ez0: S.ez, zRead: S.mis.zRead }, target: { ez_um: 0 } };
    },
    metrics(api) {
      const { S } = api, e = Math.abs(S.ez), shift = e * Math.sin(P.ION_TILT * P.DEG);
      const score = Math.round(100 * Math.exp(-((Math.max(0, e - 0.8) / 4) ** 2)));
      return { score, ez_err_um: r1(S.ez, 2), shift_um: r1(shift, 2), tilt: S.tilt, success: e <= 2.5, verdict: e <= 1 ? 'Eucentric ✓' : e <= 2.5 ? 'Close enough ✓' : 'Not quite' };
    },
    blocked: ['eucentric'],
    explain: (m) => `You ended ${m.ez_err_um} µm from the coincidence point. At 52° that offsets the ion beam's spot by ${m.shift_um} µm from the electron beam's: anything you mill appears that far from where you pointed in the SEM image. A good routine: centre a feature at 0°, tilt to ~10°, bring it back with Z (not with the stage X/Y), then tilt to 52° and correct again.`,
  },
  'lamella-thin': {
    title: 'Lamella: thin to 100 nm',
    short: 'A lifted-out lamella, ~1 µm thick, on the grid. Thin it to about 100 nm with good crystal left inside, without bending it or punching a hole.',
    brief: 'The lamella is welded to the grid and about a micrometre thick. Thin it toward <b>~100 nm</b> using <b>Thin both faces</b> with a current, a target thickness and an over-tilt that you choose (Controls → Lamella), then <b>polish</b> at low kV. You cannot see the true thickness: judge from the 5 kV SEM view of the face (thin regions brighten as electrons pass through, a wedge shows as a gradient). Too much current on a thin lamella bends it; going too far makes a hole. Press <b>I\'m done</b> when you think it is ready for the TEM.',
    cues: ['Lamella turned bright at 5 kV', 'Even contrast top to bottom (no wedge)', 'Lowered the current as it got thinner', 'Polished at low kV', 'Trusted the target thickness', 'Guessed'],
    hideTruth: true,
    setup(api, rng) {
      const { S, sim } = api;
      api.setSpec('chip');
      api.setMode('lam');
      const L = newLamella(rng);
      Object.assign(L, { step: 6, t_top: 900 + rng() * 400, wedge: 1.2 + rng() * 1.2, amorph: [24, 24], capLeft: 0.6 + rng() * 0.6, liftedOut: true, onGrid: true, curtain: 0.3 });
      sim.lam = L;
      Object.assign(S, { lamI: 800, lamKV: 30, lamTarget: 400, lamOver: 1.5, kV: 5, clarity: 'edu' });
      S.mis = { hideTruth: true };
      return { hidden: { t0: r1(L.t_top), wedge0: r1(L.wedge, 2), offset: r1(L.offset), drift: r1(L.drift) }, target: { t_nm: 100, window: [60, 150] } };
    },
    metrics(api) {
      const q = lamQuality(api.sim.lam);
      let s = 100 * Math.exp(-(((q.t_top - 100) / 70) ** 2)) * Math.exp(-Math.max(0, q.t_bottom - q.t_top - 80) / 250);
      s *= Math.exp(-Math.max(0, Math.max(...q.amorph) - 8) / 40);
      if (q.bent) s *= 0.4;
      if (q.hole) s = 0;
      const score = Math.round(s);
      return { score, t_top_nm: q.t_top, t_bottom_nm: q.t_bottom, crystalline_nm: q.crystalline, amorph_nm: Math.max(...q.amorph), ga_pct: q.ga, bent: q.bent, hole: q.hole, time_min: q.time_min, success: score >= 60, verdict: q.hole ? 'Holed ✗' : q.bent ? 'Bent' : score >= 85 ? 'TEM-ready ✓' : score >= 60 ? 'Usable ✓' : 'Not quite' };
    },
    explain: (m) => `The lamella ended ${m.t_top_nm} nm thick at the top of the window and ${m.t_bottom_nm} nm three micrometres down (the wedge from the sidewall taper), with ${m.amorph_nm} nm of amorphous damage on each face, leaving ${m.crystalline_nm} nm of good crystal.${m.bent ? ' It bent: too much current for its thickness.' : ''}${m.hole ? ' It was holed.' : ''} The usual recipe steps the current down with the thickness (e.g. 0.8 nA to 500 nm, 0.3 nA to 250 nm, 80 pA to 120 nm), uses ±1–2° over-tilt to cancel the taper, and finishes with 5 kV and 2 kV polishing.`,
  },
  'cryo-lamella': {
    title: 'Cryo lamella: 200 nm for cryo-ET',
    short: 'A frozen yeast cell on the grid, coated and ready to mill at 12°. Mill it to ~200 nm for cryo-electron tomography: keep the ice vitreous and clean, and do not lose it.',
    brief: 'The site is prepared (sputter coat, cold GIS Pt, milling angle 12°, relief cuts). Mill both boxes with <b>Mill both boxes</b>, choosing the <b>current</b> and the <b>target thickness</b> of each pass (Controls → Cryo lamella), down to <b>~200 nm</b> (150–250 counts). The true thickness is hidden: judge it from the SEM view from above (thin ice brightens at low kV). Too much current for the thickness warms the slab and the ice crystallises; slow work lets contamination grow; a lamella left too thick is useless for cryo-ET and one too thin has little undamaged volume. Finish with the <b>Final sputter coat</b> and press <b>I\'m done</b>.',
    cues: ['Lamella brightened in the SEM', 'Lowered the current as it thinned', 'Worked fast at the end', 'Trusted the target thickness', 'Coated at the end', 'Guessed'],
    hideTruth: true,
    setup(api, rng) {
      const { S, sim } = api;
      api.setSpec('cell');
      api.setMode('cryo');
      Object.assign(S, { ion: 'Ga', ikV: 30, cryoAngle: 12, cryoRelief: true, cryoT: -190, anticontam: true, kV: 3, current: 25, clarity: 'edu' });
      const C = newCryoLamella(rng);
      C.t = C.t0 = Math.round(4200 + rng() * 2400);
      for (const id of ['sputter', 'gis', 'angle', 'relief']) cryoPrep(C, id, { sputter: 15, gis: 20, angle: 12, relief: true, T: -190 });
      C.step = 4; sim.cryo = C; S.coated = true; S.tilt = 19;
      S.cryoI = P.nearestCurrent('Ga', 1000); S.cryoTarget = 2500;
      S.mis = { hideTruth: true };
      return { hidden: { t0_nm: C.t0, offset: r1(C.offset), drift: r1(C.drift) }, target: { t_nm: 200, window: [150, 250] } };
    },
    metrics(api) {
      const C = api.sim.cryo, q = cryoQuality(C);
      let s = C.step < 5 ? 0 : 100 * Math.exp(-(((q.t_eff - 200) / 80) ** 2));
      s *= Math.exp(-C.devit / 0.1) * Math.exp(-Math.max(0, q.damage_frac - 0.5) * 2) * Math.exp(-Math.max(0, q.time_min - 100) / 150);
      if (C.bent) s *= 0.5;
      if (!C.coatFinal) s *= 0.85;
      if (C.lost || C.hole) s = 0;
      const score = Math.round(s);
      return { score, t_nm: q.t, t_eff_nm: q.t_eff, t_lambda: q.t_lambda, damage_nm: Math.max(...q.damage), intact_nm: q.intact, devit_pct: q.devit_pct, contam_nm: q.contam_nm, bent: q.bent, lost: q.lost, coated: q.coated, time_min: q.time_min, success: score >= 60, verdict: C.lost ? 'Lost ✗' : C.devit > 0.15 ? 'Devitrified ✗' : score >= 85 ? 'Ready for cryo-ET ✓' : score >= 60 ? 'Usable ✓' : 'Not quite' };
    },
    explain: (m) => `The lamella ended ${m.t_nm} nm thick (${m.t_eff_nm} nm with contamination and coating; t/λ ${m.t_lambda}, where ~0.4–0.7 is good for tomography), with ${m.damage_nm} nm of ion damage on each face, leaving ${m.intact_nm} nm undamaged. ${m.devit_pct > 0 ? `${m.devit_pct} % of the ice crystallised: too much beam power for the thickness. ` : 'The ice stayed vitreous. '}${m.bent ? 'It bent. ' : ''}${m.lost ? 'It was lost. ' : ''}${m.coated ? '' : 'It was not coated at the end, so it will charge in the TEM. '}A typical recipe: 1 nA to 2.5 µm, 300 pA to 800 nm, 100 pA to 400 nm, then 30–50 pA to 200 nm, coat, and unload promptly.`,
  },
};

// ---------------------------------------------------------------------------------------------- runner
export class Scenarios {
  // api: { S, sim, version, setSpec, setMode, refresh, invalidateAll, download, applyFlat, snapshotState, restoreState, onEvent }
  constructor(api) {
    this.api = api;
    this.recorder = new Recorder({ S: api.S, version: api.version });
    this.api.noteSource ??= (src) => this.recorder.noteSource(src);
    this.active = null; this.lastSession = null; this.replay = null;
    this.el = (id, cls, html = '') => { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; document.body.appendChild(e); } e.innerHTML = html; e.hidden = false; return e; };
  }
  blocked(id) { return !!this.active && (SCENARIOS[this.active.id].blocked ?? []).includes(id); }

  // ---------------------------------------------------------------- the Training menu (top-right button)
  menu({ replay, last }) {
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training mode</p><h2>Run the <em>dual beam</em></h2>
      <p>Each task hides an error, as on a real instrument: the readings are not the true values. Fix it from what you see, say how good you think the result is, then see the truth.</p>
      <div class="scnlist">${Object.entries(SCENARIOS).map(([id, s]) => `<button class="scnpick" data-id="${id}"><b>${s.title}</b><small>${s.short}</small></button>`).join('')}</div>
      <div class="crow"><button class="btn" data-x="replay">Replay a session file…</button><button class="btn" data-x="last" ${this.lastSession ? '' : 'disabled'}>Download last session</button>${this.active ? '<button class="btn" data-x="stop">Stop the current task</button>' : ''}</div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    m.querySelectorAll('.scnpick').forEach((b) => { b.onclick = () => { if (this.active) this.finish('abandoned'); this.start(b.dataset.id); }; });
    m.querySelector('[data-x="replay"]').onclick = () => { close(); replay(); };
    m.querySelector('[data-x="last"]').onclick = () => { close(); last(); };
    m.querySelector('[data-x="stop"]')?.addEventListener('click', () => { close(); this.finish('gave_up'); });
  }

  // ---------------------------------------------------------------- start: consent first
  start(id) {
    if (this.replay) this.stopReplay();
    const exp = store('fib-exp') ?? 'novice';
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">Training scenario · research</p><h2>${SCENARIOS[id].title}</h2>
      <p>You can record this session to help us understand how people run a FIB-SEM: which controls you use, in what order, and when you decide the result is good. It will be used to build better guidance and assistance for real instruments through the digital twin.</p>
      <ul class="cons"><li><b>Recorded:</b> the settings you change and when, which input you used, your own rating at the end, and the true quality computed by the simulator.</li>
        <li><b>Not recorded:</b> your name, email, location, or any images of you. The session gets a random id.</li>
        ${SHARE.url ? `<li><b>Shared only if you choose:</b> <i>Record and share</i> sends the anonymous session file to the research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''} automatically when the task ends, to study FIB-SEM operation and train models that assist real instruments; it may be included in published data. <i>Record only</i> keeps it on this computer.</li>` : '<li><b>Stays with you:</b> nothing is sent anywhere. At the end you can download the session file.</li>'}</ul>
      <div class="cgrid"><label>Your experience with electron microscopes<select id="scnExp">
        ${[['novice', 'Never used one'], ['student', 'Student / occasional user'], ['trained', 'Trained user'], ['expert', 'Expert / facility staff']].map(([k, l]) => `<option value="${k}" ${k === exp ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="crow">${SHARE.url ? '<button class="btn primary" id="scnShare">Record and share</button><button class="btn" id="scnRec">Record only</button>' : '<button class="btn primary" id="scnRec">Record and start</button>'}<button class="btn" id="scnNoRec">Start without recording</button></div></div>`);
    const close = () => { m.hidden = true; };
    m.querySelector('.close').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    const go = (rec, share = false) => { const e = m.querySelector('#scnExp').value; store('fib-exp', e); close(); this.begin(id, rec, e, share); };
    m.querySelector('#scnShare')?.addEventListener('click', () => go(true, true));
    m.querySelector('#scnRec').onclick = () => go(true);
    m.querySelector('#scnNoRec').onclick = () => go(false);
  }

  begin(id, record, experience, share = false) {
    const sc = SCENARIOS[id], seed = (Math.random() * 2 ** 31) | 0, rng = P.mulberry32(seed);
    const info = sc.setup(this.api, rng);
    this.api.invalidateAll();
    this.active = { id, seed, ...info, t0: performance.now(), record, share: record && share && !!SHARE.url };
    const metrics = () => sc.metrics(this.api, this.active);
    if (record) this.recorder.start({ experience, scenario: { id, seed, hidden: info.hidden, target: info.target }, metrics });
    this.api.onEvent?.('start', id);
    this.card();
  }
  card() {
    const sc = SCENARIOS[this.active.id];
    const c = this.el('scnCard', 'card scncard', `<div class="scnhead"><b>${sc.title}</b><span id="scnTime">0:00</span>${this.active.record ? `<i class="rec">● ${this.active.share ? 'recording · will share' : 'recording'}</i>` : ''}<span class="sp"></span><button data-x="brief" title="Show or hide the task">?</button></div>
      <p class="scnbrief">${sc.brief}</p>
      <div class="crow"><button class="btn primary" data-x="done">I'm done</button><button class="btn" data-x="give">Give up</button></div>`);
    c.querySelector('[data-x="brief"]').onclick = () => c.classList.toggle('mini');
    c.querySelector('[data-x="done"]').onclick = () => this.judge();
    c.querySelector('[data-x="give"]').onclick = () => this.finish('gave_up');
    sc.mount?.(this.api, c);
    this.draggable(c, c.querySelector('.scnhead'));
  }
  // the card can be moved by its header (it would otherwise cover the detector or the column); the spot is kept
  // for the rest of the visit, and a double-click on the header puts it back
  draggable(c, handle) {
    const place = (x, y) => {
      const r = c.getBoundingClientRect();
      x = Math.max(4, Math.min(innerWidth - r.width - 4, x)); y = Math.max(4, Math.min(innerHeight - 40, y));
      Object.assign(c.style, { left: `${x}px`, top: `${y}px`, transform: 'none' }); this.cardPos = [x, y];
    };
    if (this.cardPos) place(...this.cardPos);
    handle.title = 'Drag to move · double-click to put back';
    handle.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = c.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      handle.setPointerCapture(e.pointerId); c.classList.add('dragging');
      handle.onpointermove = (m) => place(m.clientX - dx, m.clientY - dy);
      handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; c.classList.remove('dragging'); };
    };
    handle.ondblclick = (e) => { if (e.target.closest('button')) return; this.cardPos = null; Object.assign(c.style, { left: '', top: '', transform: '' }); };
  }
  tick() {
    const now = performance.now(), dt = Math.min(0.1, (now - (this.lastTick ?? now)) / 1000); this.lastTick = now;
    if (this.active) SCENARIOS[this.active.id].tick?.(this.api, dt);
    this.recorder.tick();
    if (this.active) { const s = Math.floor((performance.now() - this.active.t0) / 1000), t = document.getElementById('scnTime'); if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    this.replayTick();
  }

  // ---------------------------------------------------------------- the participant's own judgment
  judge() {
    const sc = SCENARIOS[this.active.id];
    const m = this.el('scnModal', 'modal', `<div class="card"><p class="eyebrow">Before we show the answer</p><h2>${esc(sc.judgeQ ?? 'How good is the result?')}</h2>
      <div class="rate">${[1, 2, 3, 4, 5].map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div><p class="muted">1 = still clearly off · 5 = as good as it gets</p>
      <h4>What did you use to decide?</h4><div class="cues">${sc.cues.map((c, i) => `<label><input type="checkbox" value="${i}">${c}</label>`).join('')}</div>
      <label class="note">Anything else? (optional, please no personal information)<input id="scnNote" maxlength="140" type="text"></label>
      <div class="crow"><button class="btn primary" id="scnSubmit" disabled>Show me the answer</button><button class="btn" id="scnBack">Keep adjusting</button></div></div>`);
    let rating = 0;
    m.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { rating = +b.dataset.r; m.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('#scnSubmit').disabled = false; }));
    m.querySelector('#scnBack').onclick = () => { m.hidden = true; this.recorder.event('judge_cancel'); };
    m.querySelector('#scnSubmit').onclick = () => {
      const cues = [...m.querySelectorAll('.cues input:checked')].map((c) => sc.cues[+c.value]);
      this.recorder.event('judge', { rating, cues, note: m.querySelector('#scnNote').value.slice(0, 140) });
      m.hidden = true;
      this.finish('done', rating);
    };
  }

  // ---------------------------------------------------------------- the reveal
  finish(outcome, rating = null) {
    const a = this.active, sc = SCENARIOS[a.id], mt = sc.metrics(this.api, a), secs = (performance.now() - a.t0) / 1000;
    const sess = a.record ? this.recorder.stop(outcome) : null;
    if (sess) this.lastSession = sess;
    const changes = sess ? sess.events.filter((e) => e.k === 'change' && !['paused'].includes(e.key)) : [];
    const bySrc = {};
    for (const e of changes) bySrc[e.src] = (bySrc[e.src] ?? 0) + 1;
    sc.unmount?.(this.api);
    document.getElementById('scnCard').hidden = true;
    this.active = null;
    const m = this.el('scnModal', 'modal', `<div class="card"><button class="close" aria-label="Close">×</button>
      <p class="eyebrow">${outcome === 'done' ? 'Result' : 'Gave up'} · ${sc.title}</p>
      <h2>${mt.verdict ?? (mt.success ? 'Success ✓' : 'Not quite')} <em>${mt.score}/100</em></h2>
      ${rating ? `<p>You rated it <b>${rating}/5</b>${mt.success === rating >= 4 ? ', and the simulator agrees.' : mt.success ? ', but it was actually good.' : ', but it was still off.'}</p>` : ''}
      <p>${sc.explain(mt, a)}</p>
      <table class="data">${[['Time', `${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s`], ...(sess ? [['Adjustments', `${changes.length} (${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ') || '—'})`]] : []), ...(mt.dose != null ? [['Dose used', `${mt.dose} e⁻/Å²`]] : [])].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="crow">${sess ? '<button class="btn primary" id="scnDl">Download the session file</button><button class="btn" id="scnReplay">Replay</button>' : '<span class="muted">This session was not recorded.</span>'}<button class="btn" id="scnAgain">Try another one</button></div>
      ${sess && a.share ? '<div class="share"><h4>Shared with the research dataset</h4><div class="crow"><span class="muted" id="scnSent">Sending…</span></div></div>' : ''}
      ${sess && SHARE.url && !a.share ? `<div class="share"><h4>Share with the research dataset</h4>
        <p>Send this session (the anonymous file you can download above: settings, timing, your rating and cues, no personal data) to the open research dataset${SHARE.dataset ? ` <b>${esc(SHARE.dataset)}</b> on Hugging Face` : ''}, where it will be used to study FIB-SEM operation and to train models that assist real instruments. Once sent it may be included in published data. Optional: the exhibit works the same either way.</p>
        <label class="note"><input type="checkbox" id="scnAgree"> I agree to share this session</label>
        <div class="crow"><button class="btn primary" id="scnSend" disabled>Send</button><span class="muted" id="scnSent"></span></div></div>` : ''}</div>`);
    m.querySelector('.close').onclick = () => { m.hidden = true; this.clear(); };
    m.querySelector('#scnAgain').onclick = () => { m.hidden = true; this.begin(a.id, a.record, store('fib-exp') ?? 'novice', a.share); };
    if (sess) {
      m.querySelector('#scnDl').onclick = () => this.downloadSession(sess);
      m.querySelector('#scnReplay').onclick = () => { m.hidden = true; this.startReplay(sess); };
      if (a.share) this.share(sess, null, m.querySelector('#scnSent'));
      const agree = m.querySelector('#scnAgree'), send = m.querySelector('#scnSend');
      if (agree) {
        agree.onchange = () => { send.disabled = !agree.checked; };
        send.onclick = () => this.share(sess, send, m.querySelector('#scnSent'));
      }
    }
    this.api.onEvent?.('end', a.id, mt);
  }
  // send one session to the collector (only after the visitor ticked the box); the receipt id lets them ask for removal
  async share(sess, btn, out) {
    if (btn) btn.disabled = true;
    out.textContent = 'Sending…';
    try {
      const r = await fetch(SHARE.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sess) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
      if (btn) btn.textContent = 'Sent ✓';
      out.innerHTML = `Sent ✓ Thank you. Session id <code>${esc(j.id ?? sess.session.id)}</code>: quote it to have it removed.`;
      this.recorder.sent = (this.recorder.sent ?? 0) + 1;
    } catch (e) {
      if (btn) btn.disabled = false;
      out.textContent = `Not sent (${e.message}). You can download the file instead.`;
    }
  }

  // the page is closing during a shared task: send what was recorded, marked abandoned
  flushOnExit() {
    const a = this.active;
    if (!a?.share || !this.recorder.active) return;
    const sess = this.recorder.stop('abandoned');
    try { navigator.sendBeacon(SHARE.url, new Blob([JSON.stringify(sess)], { type: 'text/plain' })); } catch { /* best effort */ }
  }

  // back to the normal exhibit: no hidden error
  clear() { this.api.S.mis = null; this.api.invalidateAll(); }
  // the active scenario may take over the panel's multifunction knobs (e.g. alignment pads)
  mfOverride() { return (this.active && SCENARIOS[this.active.id].mf?.()) || null; }
  downloadSession(sess) {
    this.api.download(new Blob([JSON.stringify(sess)], { type: 'application/json' }), `fib-view-session-${sess.scenario?.id ?? 'free'}-${sess.session.id.slice(0, 8)}.json`);
  }

  // ---------------------------------------------------------------- replay: drive the exhibit from a recorded session
  startReplay(sess) {
    if (this.active) return;
    const snaps = sess.events.filter((e) => e.k === 'snap');
    if (!snaps.length) return;
    this.replay = { sess, snaps, saved: this.api.snapshotState(), t: 0, playing: true, speed: 1, last: performance.now(), T: sess.events[sess.events.length - 1].t };
    this.api.S.mis = sess.scenario?.hidden?.mis ?? null;
    const r = this.replay, marks = sess.events.filter((e) => ['acquire', 'judge', 'end', 'mode', 'button', 'blocked'].includes(e.k));
    const bar = this.el('replayBar', 'card replaybar', `<div class="rbhead"><b>Replay</b><span>${esc(sess.scenario?.id ?? 'free session')} · ${esc(sess.session.experience)} · ${r.T.toFixed(0)} s</span><span class="sp"></span>
      <button data-r="play">❚❚</button><select data-r="speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select><button data-r="close" title="Leave the replay">×</button></div>
      <canvas class="rbchart"></canvas><input type="range" min="0" max="${r.T}" step="0.1" value="0" data-r="scrub"><p class="rblog"></p>`);
    r.bar = bar; r.marks = marks;
    bar.querySelector('[data-r="play"]').onclick = (e) => { r.playing = !r.playing; e.target.textContent = r.playing ? '❚❚' : '▶'; r.last = performance.now(); };
    bar.querySelector('[data-r="speed"]').onchange = (e) => { r.speed = +e.target.value; };
    bar.querySelector('[data-r="scrub"]').oninput = (e) => { r.t = +e.target.value; r.playing = false; bar.querySelector('[data-r="play"]').textContent = '▶'; this.applyAt(r.t); };
    bar.querySelector('[data-r="close"]').onclick = () => this.stopReplay();
    this.applyAt(0);
  }
  loadReplay(text) { this.startReplay(JSON.parse(text)); }
  applyAt(t) {
    const r = this.replay;
    let s = r.snaps[0];
    for (const x of r.snaps) { if (x.t <= t) s = x; else break; }
    if (s !== r.cur) { r.cur = s; this.api.applyFlat(s.state); }
    this.drawReplay(t, s);
  }
  replayTick() {
    const r = this.replay;
    if (!r || !r.playing) return;
    const now = performance.now();
    r.t = Math.min(r.T, r.t + ((now - r.last) / 1000) * r.speed); r.last = now;
    r.bar.querySelector('[data-r="scrub"]').value = r.t;
    this.applyAt(r.t);
    if (r.t >= r.T) { r.playing = false; r.bar.querySelector('[data-r="play"]').textContent = '▶'; }
  }
  drawReplay(t, s) {
    const r = this.replay, cv = r.bar.querySelector('.rbchart'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    const q = cv.getContext('2d'), W = cv.width, H = cv.height, X = (x) => (x / (r.T || 1)) * W, Y = (v) => H - 4 * dpr - (v / 100) * (H - 8 * dpr);
    q.fillStyle = '#06080b'; q.fillRect(0, 0, W, H);
    // the true score over time, with the target line and the decision points
    q.strokeStyle = 'rgba(255,255,255,0.15)'; q.beginPath(); q.moveTo(0, Y(100)); q.lineTo(W, Y(100)); q.stroke();
    q.strokeStyle = '#6fd6ff'; q.lineWidth = 1.5 * dpr; q.beginPath();
    r.snaps.forEach((x, i) => { const v = x.m?.score ?? 0; i ? q.lineTo(X(x.t), Y(v)) : q.moveTo(X(x.t), Y(v)); });
    q.stroke();
    for (const e of r.marks) { q.fillStyle = e.k === 'judge' ? '#ffb45e' : e.k === 'acquire' ? '#9be39b' : e.k === 'blocked' ? '#ff8a8a' : '#8a94a3'; q.fillRect(X(e.t) - dpr, 0, 2 * dpr, H); }
    q.fillStyle = '#fff'; q.fillRect(X(t) - dpr, 0, 2 * dpr, H);
    const recent = r.sess.events.filter((e) => e.k === 'change' && e.t <= t && e.t > t - 3 && e.key !== 'paused').slice(-4).map((e) => `${e.key} ${e.from}→${e.to} (${e.src})`);
    r.bar.querySelector('.rblog').textContent = `${t.toFixed(1)} s · true score ${s.m?.score ?? '—'}${s.m?.ratio != null ? ` · blur ${s.m.ratio}× ideal` : ''}${s.m?.ez_err_um != null ? ` · Z error ${s.m.ez_err_um} µm` : ''}${s.m?.t_top_nm != null ? ` · ${s.m.t_top_nm} nm thick` : ''}${recent.length ? ' · ' + recent.join(' · ') : ''}`;
  }
  stopReplay() {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.bar.hidden = true;
    this.api.restoreState(r.saved);
  }
}
