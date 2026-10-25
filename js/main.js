// Sculpting with Ions (FIB-view): state, controls, interaction and the render loop.
import * as P from './physics.js';
import { Sim, ION_MODES } from './sim.js';
import * as R2 from './render2d.js';
import { Scene3D } from './scene3d.js';
import { modeInfo, changeText, dataRows, fmtLen } from './explain.js';
import { renderComponent, COMPONENTS } from './components.js';
import { defaultState, SESSION_KEYS } from './state.js';
import { SHAPES, LAM_STEPS, newLamella, lamQuality } from './mill.js';
import * as OPS from './ops.js';
import { Panel } from './panel.js';
import { VirtualPanel } from './vpanel.js';
import { Voice, describe, parseCommand, EXAMPLES, HELP } from './voice.js';
import { AgentBridge } from './agent.js';
import { Scenarios, SCENARIOS } from './scenarios.js';
import { Acquisitions } from './acquire.js';
import { collectData, toNpz } from './export.js';
import { analyze } from './analyze.js';
import { ScriptCore, b64, stateSummary } from './scripting.js';
import { PythonIDE } from './ide.js';
import { Narrator } from './narration.js';
import { SUPPORT, AGENT } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

// ------------------------------------------------------------------ state
const S = defaultState();
const sim = new Sim(S);
const scene = new Scene3D($('#gl'), $('#labels'));
const mainCv = $('#detMain'), secCv = $('#detSec');
let hoverIdx = -1, redraw = false;

const MODES = [
  ['se', 'SE · ETD', 'secondary electrons', 'Electron beam'], ['inlens', 'In-lens', 'through-the-lens SE', 'Electron beam'], ['bse', 'BSE', 'backscattered', 'Electron beam'],
  ['ebsd', 'EBSD', 'orientation maps', 'Electron beam'], ['tkd', 'TKD', 'transmission Kikuchi', 'Electron beam'], ['eds', 'EDS', 'X-ray spectra', 'Electron beam'],
  ['fib', 'Ion image', 'ion-induced electrons and ions', 'Ion beam'], ['mill', 'Mill', 'sputtering patterns', 'Ion beam'], ['gis', 'Deposit', 'gas injection', 'Ion beam'],
  ['sv', 'Slice & View', 'FIB-SEM tomography', 'Workflows'], ['lam', 'Lamella', 'TEM lift-out', 'Workflows'], ['mc', 'Monte Carlo', 'electrons and ions', 'Physics'],
];
const KEYS = Object.fromEntries(MODES.map(([m], i) => [m, '1234567890-='[i]]));
const logMap = (min, max) => ({ to: (v) => (Math.log(v / min) / Math.log(max / min)) * 1000, from: (t) => min * Math.pow(max / min, t / 1000) });
const IMG = 'se inlens bse', EB = 'se inlens bse ebsd tkd eds', IONM = 'fib mill gis lam sv', PATM = 'mill gis';
const beamNow = () => OPS.activeBeam(S);
const SPEC_KEYS_ALL = ['chip', 'ni', 'sn', 'nmc', 'xs'];
const SPEC_OK = { lam: ['chip'], sv: ['nmc', 'chip'], tkd: ['xs'], ebsd: ['chip', 'ni', 'xs'], fib: ['chip', 'ni', 'sn', 'nmc'], mill: ['chip', 'ni', 'sn', 'nmc'], gis: ['chip', 'ni', 'sn', 'nmc'] };

const CONTROLS = [
  { sec: 'The specimen' },
  // only the specimens that make sense in each mode (a lamella is cut from the chip, TKD needs a thin foil, …)
  { chips: 'spec', dynOpts: () => [['chip', 'Microchip'], ['ni', 'Nickel'], ['sn', 'Tin on C'], ['nmc', 'Battery cathode'], ['xs', 'Chip lamella']].filter(([k]) => (SPEC_OK[S.mode] ?? SPEC_KEYS_ALL).includes(k)) },
  { slider: 'fov', label: 'Field of view', dyn: () => ({ min: sim.spec.fovMin, max: sim.spec.fovMax }), log: true, fmt: (v) => `${fmtLen(v)}  ×${Math.round(127000 / v).toLocaleString()}`, note: 'Drag the image to move the stage (in Mill and Deposit: Alt-drag); scroll it to zoom.' },
  { slider: 'tilt', label: 'Stage tilt', min: 0, max: 72, step: 1, fmt: (v) => `${v}°`, ends: ['flat', 'FIB 52°', 'EBSD 70°'] },
  { slider: 'ez', label: 'Stage Z', min: -40, max: 40, step: 0.1, fmt: (v) => `${(v + (S.mis?.zRead ?? 0)) >= 0 ? '+' : ''}${(v + (S.mis?.zRead ?? 0)).toFixed(1)} µm`, ends: ['down', 'eucentric', 'up'] },
  { buttons: [['tilt0', '0°'], ['tilt52', '52° (FIB)'], ['eucentric', 'Go to eucentric']] },
  { toggles: [['coated', 'Carbon coating']] },

  { sec: 'Electron beam', modes: `${EB} mill gis lam sv mc` },
  { slider: 'kV', label: 'Accelerating voltage', min: 0.5, max: 30, step: 0.5, fmt: (v) => `${v} kV` },
  { chips: 'kV', small: true, opts: [[1, '1 kV'], [2, '2 kV'], [5, '5 kV'], [15, '15 kV'], [30, '30 kV']] },
  { slider: 'current', label: 'Probe current', min: 1, max: 20000, log: true, fmt: (v) => P.fmtCurrent(v), ends: ['imaging', '', 'EDS / EBSD'], modes: EB },
  { chips: 'aperture', label: 'Aperture', opts: [[10, '10 µm'], [20, '20 µm'], [30, '30 µm'], [60, '60 µm'], [120, '120 µm']], modes: EB },
  { slider: 'wd', label: 'Working distance', min: 2, max: 20, step: 0.5, fmt: (v) => `${v} mm`, ends: ['resolution', 'coincidence 4', 'depth of field'], modes: EB },

  { sec: 'Focus & astigmatism', modes: IMG },
  { slider: 'focus', label: 'Focus', dyn: () => { const r = Math.max(0.3, Math.min(200, S.fov * 3)); return { min: -r, max: r, step: r / 500 }; }, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} µm`, ends: ['under', 'focus', 'over'] },
  { slider: 'stig', label: 'Stigmator', min: -3, max: 3, step: 0.01, fmt: (v) => v.toFixed(2) },
  { buttons: [['autofocus', 'Auto focus + stigmation']] },
  { slider: 'dwell', label: 'Dwell time', min: 0.1, max: 30, log: true, fmt: (v) => `${v.toFixed(v < 1 ? 2 : 1)} µs`, ends: ['TV rate, noisy', '', 'slow, clean'] },

  { sec: 'Ion beam', modes: `${IONM} mc` },
  { chips: 'ion', opts: P.ION_KEYS.map((k) => [k, `${P.ION[k].name}`]) },
  { p: '', pFn: () => { const i = P.ION[S.ion]; return `${i.long[0].toUpperCase() + i.long.slice(1)} from ${i.src === 'LMIS' ? 'the liquid-metal source' : 'the plasma source'} · probe ${sim.iprobe.d >= 1000 ? `${(sim.iprobe.d / 1000).toFixed(2)} µm` : `${sim.iprobe.d.toFixed(1)} nm`}`; } },
  { chips: 'icur', label: 'Beam current (aperture strip)', dynOpts: () => P.ION[S.ion].currents.map((c) => [c, P.fmtCurrent(c).replace(' ', ' ')]), small: true },
  { slider: 'ikV', label: 'Ion voltage', min: 1, max: 30, step: 1, fmt: (v) => `${v} kV`, ends: ['low damage', '', 'fine probe'] },
  { chips: 'ikV', small: true, opts: [[2, '2 kV'], [5, '5 kV'], [8, '8 kV'], [16, '16 kV'], [30, '30 kV']] },
  { slider: 'ifocus', label: 'Ion focus', dyn: () => { const r = Math.max(5, Math.min(3000, S.fov * 40)); return { min: -r, max: r, step: r / 500 }; }, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} µm`, modes: 'fib' },
  { slider: 'istig', label: 'Ion stigmator', min: -60, max: 60, step: 0.1, fmt: (v) => v.toFixed(1), modes: 'fib' },
  { buttons: [['autofocus', 'Auto focus (ion)']], modes: 'fib' },
  { slider: 'idwell', label: 'Dwell time', min: 0.1, max: 10, log: true, fmt: (v) => `${v.toFixed(v < 1 ? 2 : 1)} µs`, ends: ['fast, gentle', '', 'slow, damaging'], modes: 'fib' },
  { chips: 'fibDet', label: 'Detector', opts: [['ise', 'Ion-induced electrons'], ['si', 'Secondary ions']], modes: 'fib' },
  { toggles: [['flood', 'Electron flood (charge neutraliser)']], modes: 'fib mill gis' },

  { sec: 'Patterning', modes: 'mill' },
  { chips: 'shape', opts: Object.entries(SHAPES).map(([k, v]) => [k, v.replace(' cross-section', ' x-section')]) },
  { slider: 'patW', label: 'Width', min: 0.2, max: 200, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { slider: 'patH', label: 'Height', min: 0.05, max: 200, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { slider: 'patDepth', label: 'Depth (silicon file)', min: 0.02, max: 100, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { chips: 'gas', label: 'Gas', opts: [['none', 'None'], ['XeF2', 'XeF₂ etch'], ['H2O', 'H₂O (carbon)']] },
  { toggles: [['rocking', 'Rocking mill'], ['realTime', 'Real time']] },

  { sec: 'Deposition', modes: 'gis' },
  { chips: 'depGas', opts: [['Pt', 'Platinum'], ['C', 'Carbon'], ['W', 'Tungsten']] },
  { chips: 'depBeam', label: 'Beam', opts: [['ion', 'Ion beam'], ['e', 'Electron beam']] },
  { slider: 'patW', label: 'Width', min: 0.2, max: 60, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { slider: 'patH', label: 'Height', min: 0.1, max: 60, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { slider: 'depThick', label: 'Thickness', min: 0.02, max: 5, log: true, fmt: (v) => fmtLen(v), inv: 'pattern' },
  { toggles: [['realTime', 'Real time']] },

  { sec: 'Patterns', modes: PATM },
  { p: 'Drag on the ion image to draw a pattern. Patterns run one after another, like a real patterning engine.' },
  { buttons: [['addPattern', 'Add at centre'], ['millToggle', 'Start'], ['undoPattern', 'Undo']] },
  { custom: 'patterns' },
  { buttons: [['clearPatterns', 'Clear queue'], ['resetMill', 'Fresh specimen']] },

  { sec: 'Lamella', modes: 'lam' },
  { custom: 'lamsteps' },
  { buttons: [['lamNext', 'Run next step'], ['lamReset', 'Start over']] },
  { chips: 'lamI', label: 'Thinning current', dynOpts: () => P.ION[S.ion].currents.filter((c) => c <= (S.ion === 'Ga' ? 3000 : 15000) && c >= 5).map((c) => [c, P.fmtCurrent(c).replace(' ', ' ')]), small: true },
  { chips: 'lamKV', label: 'Voltage', small: true, opts: [[30, '30 kV'], [16, '16 kV'], [8, '8 kV'], [5, '5 kV'], [2, '2 kV']] },
  { slider: 'lamTarget', label: 'Target thickness', min: 20, max: 3000, log: true, fmt: (v) => `${Math.round(v)} nm`, inv: 'pattern' },
  { slider: 'lamOver', label: 'Over-tilt', min: 0, max: 4, step: 0.1, fmt: (v) => `±${v.toFixed(1)}°`, inv: 'pattern' },
  { toggles: [['rocking', 'Rocking']] },
  { buttons: [['lamThin', 'Thin both faces'], ['lamPolish5', 'Polish 5 kV'], ['lamPolish2', 'Polish 2 kV']] },
  { buttons: [['lamTKD', 'Send to TKD']] },

  { sec: 'Slice & view', modes: 'sv' },
  { slider: 'svSlice', label: 'Slice thickness', min: 5, max: 1000, log: true, fmt: (v) => `${Math.round(v)} nm` },
  { slider: 'svN', label: 'Slices', min: 10, max: 200, step: 1, fmt: (v) => `${v}`, inv: 'svN' },
  { chips: 'svDet', label: 'Imaging', opts: [['bse', 'BSE (composition)'], ['se', 'SE (topography)']] },
  { slider: 'svZ', label: 'XY slice depth', min: 0, max: 0.99, step: 0.01, fmt: (v) => `${(v * (sim.sv?.Hz ?? 10)).toFixed(1)} µm`, inv: 'svView' },
  { slider: 'svX', label: 'YZ slice position', min: 0, max: 0.99, step: 0.01, fmt: (v) => `${(v * (sim.sv?.W ?? 20)).toFixed(1)} µm`, inv: 'svView' },
  { toggles: [['svTiltCorr', 'Tilt correction'], ['rocking', 'Rocking mill']] },
  { buttons: [['svRestart', 'Restart']] },

  { sec: 'Detectors', modes: 'se bse ebsd tkd eds mc' },
  { slider: 'etdBias', label: 'ETD Faraday cage bias', min: -150, max: 300, step: 5, fmt: (v) => `${v > 0 ? '+' : ''}${v} V`, modes: 'se', ends: ['BSE only', '0', 'all SE'] },
  { chips: 'bseMode', label: 'Segment presets', modes: 'bse', opts: [['comp', 'A+B+C+D'], ['topoX', 'A−B'], ['topoY', 'C−D']] },
  { p: 'Or click the quadrants on the detector diagram to add (+), subtract (−) or switch off each segment.', modes: 'bse' },
  { chips: 'mapN', label: 'Map size', modes: 'ebsd tkd', opts: [[24, '24²'], [40, '40²'], [56, '56²']] },
  { slider: 'expo', label: 'Pattern exposure', min: 1, max: 50, step: 1, fmt: (v) => `${v} ms`, modes: 'ebsd tkd' },
  { slider: 'tkdThick', label: 'Foil thickness', min: 20, max: 400, step: 5, fmt: (v) => `${v} nm`, modes: 'tkd' },
  { chips: 'mapView', label: 'Show', modes: 'ebsd tkd', opts: [['ipf', 'IPF-Z'], ['bc', 'Band contrast'], ['mad', 'MAD']] },
  { toggles: [['showHough', 'Hough bands']], modes: 'ebsd tkd' },
  { buttons: [['remap', 'Restart map']], modes: 'ebsd tkd' },
  { chips: 'edsSel', label: 'Map element', modes: 'eds', dynOpts: () => [['all', 'All']].concat(sim.eds ? sim.eds.syms.map((s) => [s, s]) : []) },
  { chips: 'mcBeam', label: 'Beam', modes: 'mc', opts: [['e', 'Electrons'], ['ion', 'Ions']] },
  { slider: 'mcMax', label: 'Electrons', min: 200, max: 6000, step: 100, fmt: (v) => v.toLocaleString(), modes: 'mc', show: () => S.mcBeam === 'e' },
  { slider: 'mcIons', label: 'Ions', min: 20, max: 1000, step: 10, fmt: (v) => v.toLocaleString(), modes: 'mc', show: () => S.mcBeam === 'ion' },
  { buttons: [['remc', 'Restart simulation']], modes: 'mc' },

  { sec: 'Time' },
  { slider: 'speed', inv: 'none', label: 'Simulation speed', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  { buttons: [['pause', 'Pause'], ['resetView', 'Reset view']] },
  { sec: 'Show' },
  { toggles: [['showLabels', 'Labels'], ['showElectrons', 'Beams & particles'], ['showGlass', 'Chamber window'], ['autoRotate', 'Slow orbit'], ['cross', 'Centre crosshair']], grid: true },
  { sec: 'Experiments' },
  { exp: 'xsec', title: 'Cross-section a chip', desc: 'Protect with Pt, dig a staircase, polish the face, and watch the copper wiring appear in the SEM at 52°.', icon: 'cut' },
  { exp: 'species', title: 'Gallium vs xenon vs oxygen', desc: 'Mill three identical boxes into a battery cathode with three ion species. Compare speed and selectivity.', icon: 'ions' },
  { exp: 'channel', title: 'Channelling contrast', desc: 'Polished nickel in the ion image: grains flash dark and bright as you tilt by a few degrees.', icon: 'grid' },
  { exp: 'charge', title: 'Charge it up', desc: 'An uncoated alumina inclusion at 15 kV. Watch it bloom, then find the voltage where it stops.', icon: 'bolt' },
  { exp: 'nano', title: 'Nanograins: EBSD vs TKD', desc: 'Copper interconnect grains with EBSD on a cross-section, then TKD on the lamella. Compare.', icon: 'grid' },
  { exp: 'tour', title: 'Fly through the dual beam', desc: 'From the electron gun and the ion source down to the coincidence point.', icon: 'path' },
  { sec: 'Training scenarios' },
  { p: 'Tasks with a hidden answer, as on a real instrument. With your consent the session is recorded (no personal data) to study how people run a FIB-SEM; you can download it, replay it, or share it with the research dataset on Hugging Face.' },
  { buttons: Object.entries(SCENARIOS).map(([id, s]) => [`scn:${id}`, s.title]) },
  { buttons: [['replayFile', 'Replay a session file…'], ['lastSession', 'Download last session']] },
  { sec: 'Voice and agent' },
  { p: 'Turn on AI mode with the brain button (or <kbd>/</kbd>) and type a command, or hold <kbd>M</kbd> and say it: "switch to xenon", "mill a cross-section", "deposit 1 micron of platinum", "thin to 100 nm", "what is the sputter yield?". Close misses are confirmed before they run. Connect an AI agent (tools/fibview-mcp) to answer questions and run the instrument with you.' },
  { buttons: [['voiceHelp', 'What can I say?'], ['agent', 'Connect agent']] },
  { sec: 'Python scripting' },
  { p: 'Script the instrument in Python: set both beams, mill and deposit, acquire NumPy data, run analyses, and test automation against a hidden error (challenges). The IDE runs Python in this browser; the same scripts run on a desktop with <code>tools/fibview-py</code>. Shortcut <kbd>P</kbd>.' },
  { buttons: [['ide', 'Open the Python IDE']] },
  { sec: 'Session & data' },
  { buttons: [['saveSession', 'Save session'], ['loadSession', 'Load session'], ['exportData', 'Export data (.npz)']] },
  { sec: 'Instrument readout' },
  { table: true },
];
const ICONS = {
  bolt: '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M18 3 7 18h7l-2 11 11-16h-7z"/></svg>',
  grid: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 9l7-4 8 3 7-2v9l-6 4 3 8-8 1-6-5-5 2z M12 5l-1 9 9-6M11 14l-6 7M11 14l9 4 7-5M20 18l-3 10"/></svg>',
  path: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3v5M10 10h12M16 8c-5 5 5 9 0 14M9 22h14M16 22v7"/><circle cx="16" cy="29" r="1.6" fill="currentColor"/></svg>',
  cut: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10h24M4 10v14h24V10"/><path d="M9 10v6l4 3h6l4-3v-6" fill="currentColor" fill-opacity=".25"/><path d="M22 3l-4 6"/></svg>',
  ions: '<svg viewBox="0 0 32 32"><circle cx="8" cy="10" r="3" fill="#ffb347"/><circle cx="16" cy="8" r="4.2" fill="#b48cff"/><circle cx="25" cy="10" r="2.4" fill="#ff7f7f"/><path d="M4 24h24" stroke="currentColor" stroke-width="1.6"/><path d="M6 24v-3h4v3M14 24v-6h5v6M23 24v-2h3v2" fill="currentColor" fill-opacity=".35"/></svg>',
};

// ------------------------------------------------------------------ control builder
const panelEl = $('#controlsBody'), bound = [];
const folded = new Set(['Time', 'Show', 'Instrument readout', 'Python scripting', 'Session & data']);
function sliderDef(c) { const d = { key: c.slider, min: c.min, max: c.max, step: c.step ?? 0.01, log: c.log, fmt: c.fmt }; if (c.dyn) Object.assign(d, c.dyn()); return d; }
function build() {
  let secName = null;
  for (const c of CONTROLS) {
    let el;
    if (c.sec) {
      el = document.createElement('h3'); el.className = 'sec'; el.textContent = c.sec; secName = c.sec;
      const name = c.sec;
      el.addEventListener('click', () => { if (!document.body.classList.contains('stacked')) return; folded.has(name) ? folded.delete(name) : folded.add(name); refresh(); });
      bound.push({ c, el });
    } else if (c.slider) {
      el = document.createElement('div'); el.className = 'ctl slider';
      el.innerHTML = `<div class="row"><label>${c.label}</label><span class="val"></span></div><input type="range">${c.ends ? `<div class="ends">${c.ends.map((e) => `<span>${e}</span>`).join('')}</div>` : ''}${c.note ? `<p class="note">${c.note}</p>` : ''}`;
      const input = el.querySelector('input');
      input.addEventListener('input', () => { const d = sliderDef(c); const v = d.log ? logMap(d.min, d.max).from(+input.value) : +input.value; set(d.key, d.log ? +v.toPrecision(4) : +(+v).toFixed(4), c.inv ?? d.key); });
      bound.push({ c, el, input, val: el.querySelector('.val') });
    } else if (c.chips) {
      el = document.createElement('div'); el.className = 'ctl';
      el.innerHTML = `${c.label ? `<div class="row"><label>${c.label}</label></div>` : ''}<div class="chips${c.small ? ' small' : ''}"></div>`;
      bound.push({ c, el, box: el.querySelector('.chips') });
    } else if (c.buttons) {
      el = document.createElement('div'); el.className = 'ctl buttons';
      for (const [id, text] of c.buttons) { const b = document.createElement('button'); b.className = 'btn'; b.dataset.act = id; b.textContent = text; b.addEventListener('click', () => action(id)); el.appendChild(b); }
      bound.push({ c, el });
    } else if (c.toggles) {
      el = document.createElement('div'); el.className = 'ctl toggles' + (c.grid ? ' grid' : '');
      for (const [key, text] of c.toggles) { const b = document.createElement('button'); b.className = 'tog'; b.dataset.key = key; b.innerHTML = `<i></i>${text}`; b.addEventListener('click', () => set(key, !S[key], key)); el.appendChild(b); }
      bound.push({ c, el });
    } else if (c.exp) {
      el = document.createElement('button'); el.className = 'exp'; el.dataset.exp = c.exp;
      el.innerHTML = `<span class="ico">${ICONS[c.icon]}</span><span><b>${c.title}</b><small>${c.desc}</small></span>`;
      el.addEventListener('click', () => action(c.exp));
      bound.push({ c, el });
    } else if (c.p !== undefined || c.pFn) { el = document.createElement('p'); el.className = 'ctl note'; el.innerHTML = c.p ?? ''; bound.push({ c, el }); }
    else if (c.custom) { el = document.createElement('div'); el.className = 'ctl'; el.dataset.custom = c.custom; bound.push({ c, el }); }
    else if (c.table) { el = document.createElement('table'); el.className = 'data'; el.innerHTML = '<tbody id="dataBody"></tbody>'; bound.push({ c, el }); }
    if (c.modes) el.dataset.modes = c.modes;
    bound[bound.length - 1].sec = secName;
    panelEl.appendChild(el);
  }
  // elements after a moded section header share its modes
  let secModes = null;
  for (const b of bound) if (b.c.sec) secModes = b.c.modes || null; else if (secModes && !b.c.modes) b.el.dataset.modes = secModes;
}
function renderChips(b) {
  const opts = b.c.dynOpts ? b.c.dynOpts() : b.c.opts, sig = JSON.stringify(opts);
  if (b.box.dataset.sig !== sig) {
    b.box.dataset.sig = sig; b.box.innerHTML = '';
    for (const [v, text] of opts) { const el = document.createElement('button'); el.className = 'chip'; el.textContent = text; el.dataset.v = JSON.stringify(v); el.addEventListener('click', () => chip(b.c.chips, v)); b.box.appendChild(el); }
  }
  const cur = b.c.chips === 'icur' || b.c.chips === 'lamI' ? P.nearestCurrent(S.ion, S[b.c.chips]) : S[b.c.chips];
  b.box.querySelectorAll('.chip').forEach((el) => el.classList.toggle('on', JSON.stringify(cur) === el.dataset.v));
}
function renderCustom(b) {
  if (b.c.custom === 'patterns') {
    const pats = sim.mill.patterns.filter((p) => p.kind !== 'img').slice(-8).reverse();
    b.el.innerHTML = pats.length ? `<div class="patlist">${pats.map((p) => `<div class="pat ${p.status}"><b>#${p.id}</b><span>${p.kind === 'dep' ? `${p.gas} dep (${p.beam === 'e' ? 'e⁻' : p.ion})` : SHAPES[p.shape]} ${+p.w.toFixed(2)}×${+p.h.toFixed(2)} µm · ${P.fmtCurrent(p.I)}</span><i>${p.status === 'running' ? `${Math.round(p.done * 100)}%` : p.status === 'queued' ? `${(p.tEst / 60).toFixed(1)} min` : p.status}</i>${p.status === 'queued' ? `<button data-del="${p.id}" title="Remove">×</button>` : ''}</div>`).join('')}</div>` : '<p class="note">No patterns yet.</p>';
    b.el.querySelectorAll('[data-del]').forEach((x) => x.addEventListener('click', () => { sim.mill.remove(+x.dataset.del); refresh(); }));
  } else if (b.c.custom === 'lamsteps') {
    const L = sim.lam;
    b.el.innerHTML = `<ol class="lamsteps">${LAM_STEPS.map((st, i) => `<li class="${i < L.step || (i === 7 && L.step > 7) ? 'done' : i === L.step ? 'now' : ''}"><em>${i + 1}</em>${st.title}${i === L.step && L.busy ? ' · running…' : ''}</li>`).join('')}</ol>`;
  }
}
function refresh() {
  document.body.dataset.mode = S.mode;
  const stacked = document.body.classList.contains('stacked');
  for (const b of bound) {
    if (b.c.sec) b.el.classList.toggle('closed', stacked && folded.has(b.c.sec));
    const vis = (!b.el.dataset.modes || b.el.dataset.modes.split(' ').includes(S.mode)) && (!b.c.show || b.c.show()) && !(stacked && !b.c.sec && folded.has(b.sec));
    b.el.hidden = !vis;
    if (!vis) continue;
    if (b.input) {
      const d = sliderDef(b.c), lm = d.log ? logMap(d.min, d.max) : null, v = S[d.key];
      b.input.min = d.log ? 0 : d.min; b.input.max = d.log ? 1000 : d.max; b.input.step = d.log ? 1 : d.step;
      b.input.value = lm ? lm.to(v) : v;
      b.input.style.setProperty('--p', `${clamp(((+b.input.value - +b.input.min) / (+b.input.max - +b.input.min)) * 100, 0, 100)}%`);
      b.val.textContent = d.fmt(v);
    }
    if (b.box) renderChips(b);
    if (b.c.toggles) b.el.querySelectorAll('.tog').forEach((t) => t.classList.toggle('on', !!S[t.dataset.key]));
    if (b.c.pFn) b.el.textContent = b.c.pFn();
    if (b.c.custom) renderCustom(b);
  }
  document.querySelectorAll('[data-act="pause"]').forEach((b) => (b.textContent = S.paused ? 'Resume' : 'Pause'));
  document.querySelectorAll('[data-act="millToggle"]').forEach((b) => (b.textContent = sim.mill.active ? 'Stop' : 'Start'));
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('.clarity button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.clarity));
  $('.exp[data-exp="tour"]')?.classList.toggle('on', !!scene.tour);
  renderInfo(); header();
}

// ------------------------------------------------------------------ state changes
const QUIET = ['speed', 'showLabels', 'showElectrons', 'showGlass', 'autoRotate', 'paused', 'showHough', 'cross', 'realTime', 'svZ', 'svX', 'lamI', 'lamKV', 'lamTarget', 'lamOver'];
function set(key, v, inv = key) {
  if (S[key] === v) return;
  S[key] = v;
  if (key === 'tilt' || key === 'ez') sim.invalidate('all');
  else if (key === 'svSlice' || key === 'svDet' || (key === 'rocking' && S.mode === 'sv') || key === 'svN') { sim.stale.sv = key === 'svN' ? sim.stale.sv : 1; if (key === 'svN' && sim.sv) sim.sv.done = sim.sv.k >= v; sim.version++; }
  else if (key === 'svTiltCorr' || key === 'svZ' || key === 'svX') sim.version++;
  else if (!QUIET.includes(key)) sim.invalidate(inv);
  else sim.version++;
  if (key === 'showHough') sim.version++;
  refresh();
  explain(key);
}
function chip(key, v) {
  if (key === 'spec') return setSpec(v);
  if (key === 'ion') { OPS.setIon(S, sim, v); refresh(); explain('ion'); return; }
  if (key === 'mcBeam') { S.mcBeam = v; sim.invalidate('all'); refresh(); explain('mcBeam'); return; }
  if (key === 'bseMode') { S.seg = { comp: { A: 1, B: 1, C: 1, D: 1 }, topoX: { A: 1, B: -1, C: 0, D: 0 }, topoY: { A: 0, B: 0, C: 1, D: -1 } }[v]; return segChanged(); }
  if (key === 'kV') return set('kV', v, 'kV');
  set(key, v, key);
}
function segChanged() { S.bseMode = P.segPreset(S.seg); sim.invalidate('seg'); refresh(); explain('seg'); }
function setSpec(v) { OPS.specState(S, sim, v); refresh(); explain('spec'); }
function setMode(m) {
  if (m === S.mode) return;
  const prev = S.mode;
  OPS.modeState(S, sim, m, prev);
  hoverIdx = -1;
  if (scn.recorder.active) scn.recorder.event('mode', { from: prev, to: m });
  refresh(); explain(null);
  if (autoNarrate) N.speak('mode-' + m);
}

function blockedMsg(id) { $('#change').hidden = false; $('#change').innerHTML = `<small>Not in this task</small><p>${esc(id)} is disabled during this training task.</p>`; if (scn.recorder.active) scn.recorder.event('blocked', { id }); }
function action(id) {
  if (scn.blocked(id)) return blockedMsg(id);
  if (scn.recorder.active && !id.startsWith('scn:')) scn.recorder.event('button', { id });
  if (id.startsWith('scn:')) { scn.start(id.slice(4)); return; }
  if (id === 'pause') { S.paused = !S.paused; refresh(); }
  if (id === 'resetView') scene.resetView();
  if (id === 'remap') { sim.stale.map = 1; sim.version++; }
  if (id === 'remc') { sim.stale.mc = 1; sim.version++; }
  if (id === 'svRestart') { sim.stale.sv = 1; sim.version++; }
  if (id === 'tilt0') set('tilt', 0, 'tilt');
  if (id === 'tilt52') set('tilt', 52, 'tilt');
  if (id === 'eucentric') { S.ez = 0; sim.invalidate('all'); refresh(); explain('ez'); }
  if (id === 'autofocus') autofocus();
  if (id === 'addPattern') { OPS.addPattern(S, sim, { face: 1 }); refresh(); explain('pattern'); }
  if (id === 'millToggle') { if (sim.mill.active) sim.mill.stop(); else if (!sim.mill.start()) { $('#change').hidden = false; $('#change').innerHTML = '<small>Patterning</small><p>Nothing queued: drag on the ion image to draw a pattern, or press Add at centre.</p>'; } refresh(); }
  if (id === 'undoPattern') { const q = sim.mill.queued.pop?.() ?? sim.mill.queued[sim.mill.queued.length - 1]; if (q) sim.mill.remove(q.id); refresh(); }
  if (id === 'clearPatterns') { sim.mill.clearQueued(); refresh(); }
  if (id === 'resetMill') { sim.mill.reset(); sim.lam = newLamella(); sim.invalidate('all'); refresh(); explain('spec'); }
  if (id === 'lamNext') { const r = OPS.lamStep(S, sim); if (r) explainLam(r); refresh(); }
  if (id === 'lamReset') { sim.mill.reset(); sim.lam = newLamella(); sim.invalidate('all'); refresh(); explain(null); }
  if (id === 'lamThin') { const dt = OPS.lamThin(S, sim); if (dt == null) explainLamNotReady(); else explainLam('thin', dt); refresh(); }
  if (id === 'lamPolish5' || id === 'lamPolish2') { const dt = OPS.lamPolish(S, sim, id === 'lamPolish5' ? 5 : 2); if (dt == null) explainLamNotReady(); else explainLam('polish', dt); refresh(); }
  if (id === 'lamTKD') {
    const q = lamQuality(sim.lam);
    if (sim.lam.step < 6) return explainLamNotReady();
    S.tkdThick = clamp(Math.round(q.t_top), 20, 400); S.tkdAmorph = Math.max(...q.amorph);
    setMode('tkd');
    $('#change').hidden = false; $('#change').innerHTML = `<small>From the lamella</small><p>TKD on your lamella: ${q.t_top} nm thick with ${q.amorph[0]}/${q.amorph[1]} nm of amorphous damage on its faces${q.hole ? ' (and a hole)' : ''}. Thicker foils and thicker damage both blur the Kikuchi bands.</p>`;
  }
  if (id === 'agent') return agent.connected || agent.status === 'connecting' ? agent.disconnect() : agent.connect();
  if (id === 'voiceHelp') voice.flash(`<b>What can I say?</b><p>${esc(HELP)}</p>`, 12000);
  if (id === 'ide') ide.toggle();
  if (id === 'replayFile') $('#fileReplay').click();
  if (id === 'lastSession') { if (scn.lastSession) scn.downloadSession(scn.lastSession); else { $('#change').hidden = false; $('#change').innerHTML = '<small>No recorded session yet</small><p>Run a training scenario with recording on, then download it here.</p>'; } }
  if (id === 'saveSession') saveSession();
  if (id === 'loadSession') $('#fileSession').click();
  if (id === 'exportData') exportData();
  if (id === 'charge') {
    OPS.specState(S, sim, 'ni');
    let best = null;
    for (let r = 0; r < 400 && !best; r += 3) for (let a = 0; a < 6.28 && !best; a += 0.2) { const x = r * Math.cos(a), y = r * Math.sin(a); if (P.SPECIMENS.ni.vol(x, y, -0.01).mat === 'Al2O3') best = [x, y]; }
    if (best) { S.cx = best[0]; S.cy = best[1]; }
    Object.assign(S, { fov: 18, coated: false, kV: 15, current: 300, tilt: 0, mode: 'se' });
    sim.invalidate('all'); refresh();
    note('Experiment · charging', 'An alumina inclusion (an insulator) in nickel at <b>15 kV</b>, uncoated. More electrons arrive than leave (δ + η < 1 above E2 ≈ 2.6 kV), so negative charge builds up and deflects the beam and the secondaries: blooming and streaks. Drag the voltage down toward <b>2 kV</b>, or switch on the carbon coating. Then try the ion image: under ions the inclusion charges <i>positive</i> and goes dark.');
  }
  if (id === 'nano') {
    OPS.specState(S, sim, 'xs');
    OPS.modeState(S, sim, 'ebsd', S.mode);
    Object.assign(S, { cx: 1.2, cy: 1.9, fov: 2, mapN: 40, kV: 20 });
    sim.invalidate('all'); refresh();
    note('Experiment · nanograins', 'EBSD on a 1.6 µm copper line with ~0.4 µm grains. At 70° tilt the electrons sample an elongated volume, so neighbouring grains’ patterns overlap and many points fail or mis-index. When the map is done, switch to <b>TKD</b> (key 5): the same line as a thin lamella, with a ~10 nm source volume. Or make your own lamella in Lamella mode and send it to TKD.');
  }
  if (id === 'xsec') {
    OPS.specState(S, sim, 'chip');
    OPS.modeState(S, sim, 'mill', S.mode);
    Object.assign(S, { cx: 6, cy: 6, fov: 34, tilt: 52, ion: 'Ga', icur: 9000 });
    const p1 = OPS.addPattern(S, sim, { kind: 'dep', beam: 'ion', gas: 'Pt', shape: 'rect', x: 6, y: 7.2, w: 16, h: 1.8, depth: 1.2, I: 800, label: 'Pt cap' });
    OPS.addPattern(S, sim, { shape: 'rcs', x: 6, y: 1.9, w: 16, h: 10, depth: 8, I: 9000, face: 1 });
    OPS.addPattern(S, sim, { shape: 'ccs', x: 6, y: 6.2, w: 15.5, h: 1.2, depth: 8, I: 800, face: 1 });
    sim.mill.start(); sim.invalidate('ion'); refresh();
    note('Experiment · cross-section', `Three patterns run in turn: a <b>Pt cap</b> over the region of interest, a <b>regular cross-section</b> at 9 nA (a staircase trench, deepest at the face), and a <b>cleaning cross-section</b> at 0.8 nA that polishes the face. The SEM image on the right looks into the trench at 52°: watch the passivation, the copper wiring levels, the tungsten vias and the silicon appear on the face. ${p1 ? '' : ''}`);
  }
  if (id === 'species') {
    OPS.specState(S, sim, 'nmc');
    OPS.modeState(S, sim, 'mill', S.mode);
    Object.assign(S, { cx: 0, cy: 0, fov: 40, tilt: 52 });
    for (const [k, x] of [['Ga', -12], ['Xe', 0], ['O', 12]]) { OPS.setIon(S, sim, k); OPS.addPattern(S, sim, { shape: 'rect', x, y: 0, w: 8, h: 8, depth: 3, I: P.nearestCurrent(k, 4000) }); }
    OPS.setIon(S, sim, 'Xe');
    sim.mill.start(); sim.invalidate('ion'); refresh();
    note('Experiment · ion species', 'Three 8 × 8 µm boxes, each asked to reach 3 µm (in silicon), milled with <b>gallium</b> (left), <b>xenon</b> (centre) and <b>oxygen</b> (right) at about 4 nA. Xenon sputters fastest per ion. Oxygen burns the carbon binder away several times faster than the oxide particles, so the particles stand proud: a <b>selective</b> mill. Watch the times in the pattern list, then look at the trenches in the SEM view.');
  }
  if (id === 'channel') {
    OPS.specState(S, sim, 'ni');
    OPS.modeState(S, sim, 'fib', S.mode);
    Object.assign(S, { fov: 120, cx: 0, cy: 0, tilt: 52, ion: 'Ga', icur: 100, fibDet: 'ise' });
    sim.invalidate('all'); refresh();
    note('Experiment · channelling', 'Polished nickel in the <b>ion image</b>. In grains whose open crystal directions point along the beam, ions slip down between the atomic rows, deep into the crystal, and emit few secondary electrons: those grains are dark. Tilt the stage by one or two degrees and watch grains flash. Compare with the SEM BSE image: electron channelling contrast is there too, but far weaker.');
  }
  if (id === 'tour') {
    if (scene.tour) { scene.stopTour(); return; }
    scene.startTour(tourStops(), (st, i, n) => {
      const cap = $('#tourCap');
      if (!st) { cap.hidden = true; refresh(); return; }
      cap.hidden = false;
      cap.innerHTML = `<small>${i + 1} / ${n}</small><b>${st.title}</b><p>${st.text}</p>`;
      cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in');
      refresh();
    });
  }
}
function note(title, html) { $('#change').hidden = false; $('#change').innerHTML = `<small>${title}</small><p>${html}</p>`; }
function explainLam(r, dt) {
  const L = sim.lam, hide = !!S.mis?.hideTruth;
  if (r === 'thin' || r === 'polish') return note(r === 'thin' ? 'Thinning pass' : 'Low-kV polish', `${r === 'thin' ? `Both faces thinned at ${P.fmtCurrent(S.lamI)}, ${S.lamKV} kV, toward ${S.lamTarget} nm` : 'A glancing pass on each face at low voltage'}: ${(dt / 60).toFixed(1)} min of instrument time.${hide ? ' Judge the result from the SEM face view.' : ` Now ${Math.round(L.t_top)} nm thick at the top of the window, with ${L.amorph.map((v) => v.toFixed(1)).join(' / ')} nm of amorphous damage.`}${L.bent ? ' <b>The lamella has bent.</b>' : ''}${L.hole ? ' <b>There is a hole.</b>' : ''}`);
  const st = LAM_STEPS.find((s) => s.id === r) ?? LAM_STEPS[L.step];
  note(`Lamella · ${st.title}`, `${st.text} ${r === 'liftout' ? 'The lamella now sits on the grid post, about a micrometre thick: thin it with the controls below.' : 'The patterns run in the ion view; the electron view on the right watches.'}`);
}
function explainLamNotReady() { note('Lamella', 'Run the steps up to the lift-out first (Run next step): thinning works on the lamella once it is on the grid.'); }
function autofocus() {
  const ion = beamNow() === 'ion', mis = S.mis ?? {};
  const f0 = ion ? S.ifocus : S.focus, s0 = ion ? S.istig : S.stig;
  const f1 = ion ? (mis.iFocus ?? 0) + (Math.random() - 0.5) * 2 : (mis.eFocus ?? 0) + (Math.random() - 0.5) * 0.004 * S.fov;
  const s1 = ion ? sim.iastig + (mis.iStig ?? 0) + (Math.random() - 0.5) * 0.05 : sim.astig + (mis.eStig ?? 0) + (Math.random() - 0.5) * 0.02, t0 = performance.now();
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / 1100), e = 1 - Math.pow(1 - f, 3);
    if (ion) { S.ifocus = +(f0 + (f1 - f0) * e).toFixed(2); S.istig = +(s0 + (s1 - s0) * e).toFixed(3); sim.invalidate('ifocus'); }
    else { S.focus = +(f0 + (f1 - f0) * e).toFixed(4); S.stig = +(s0 + (s1 - s0) * e).toFixed(3); sim.invalidate('focus'); }
    refresh();
    if (f < 1) requestAnimationFrame(step); else explain('autofocus');
  };
  step();
}
function tourStops() {
  const C = scene.coincidence;
  return [
    { y: 6.6, pos: [2.4, 7.2, 4], title: 'The electron gun', text: `A Schottky field emitter makes the electron probe at ${S.kV} kV. In a dual beam the electrons are the eyes: they image without (much) damage.` },
    { y: 5.0, pos: [3, 5.6, 4.6], title: 'Electron column', text: 'Condenser, aperture, scan coils and the objective form a nanometre probe, focused on the coincidence point ~4 mm below the pole piece.' },
    { y: 4.3, pos: [5.2, 6.6, -1.2], target: [0, 4.3, -3], title: 'The ion source', text: S.ion === 'Ga' ? 'A gallium liquid-metal ion source: a tungsten needle wetted with liquid gallium, pulled into a Taylor cone a few nanometres across. Very bright, so the ion probe reaches ~2.5 nm.' : `An inductively coupled plasma of ${P.ION[S.ion].long}: an RF coil keeps the gas glowing, and ions are drawn out through an aperture. Microamps of current, and the gas can be switched.` },
    { y: 3.2, pos: [4.6, 4.2, 0.4], target: [0, 3.0, -1.8], title: 'Ion column, 52° from the electrons', text: 'Electrostatic lenses (ions are too heavy for magnetic ones), an aperture strip that sets the current from picoamps to micro-amps, a blanker and an octupole stigmator.' },
    { y: C.y, pos: [2.2, C.y + 0.9, 2.4], target: C.toArray(), title: 'The coincidence point', text: 'Both beams cross here. Tilt the stage to 52° and the ions hit the surface head-on while the electrons watch at 52°: mill with one beam, image with the other.' },
    { y: C.y, pos: [-2.2, C.y + 1.4, 2.6], target: C.toArray(), title: 'Gas needles and the manipulator', text: 'Gas injection needles puff platinum, carbon or tungsten precursors (or XeF₂ and water for etching); the manipulator needle lifts lamellae out.' },
    { y: 2.3, pos: scene.home.pos.toArray(), target: scene.home.target.toArray(), title: 'See with electrons, sculpt with ions', text: 'Image, mill, deposit, slice and lift out: every result here is computed from how electrons and ions interact with the solid.', dur: 6 },
  ];
}

// ------------------------------------------------------------------ text panels
let infoOpen = false;
function renderInfo() {
  const inf = modeInfo(S, sim);
  $('#infoTitle').innerHTML = inf.title;
  $('#infoBody').innerHTML = inf.body;
  $('#infoStats').innerHTML = inf.stats.map(([k, v, s]) => `<div><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');
  const stacked = document.body.classList.contains('stacked');
  $('#infoBody').classList.toggle('clamp', stacked && !infoOpen);
  $('#infoMore').hidden = !stacked; $('#infoMore').textContent = infoOpen ? 'Show less' : 'Read more';
}
function explain(key) {
  const box = $('#change'), t = key ? changeText(key, S, sim) : null;
  if (!t) { if (!key) box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<small>What just changed · ${t[0]}</small><p>${t[1]}</p>`;
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
}
function header() {
  const n = {
    se: ['Everhart–Thornley detector · SE image', 'Total electron yield vs voltage'],
    inlens: ['In-lens detector · SE image', 'Probe size vs convergence'],
    bse: ['BSE detector · ' + P.segLabel(S.seg), 'Backscatter coefficient & segments'],
    ebsd: ['EBSD orientation map', 'Kikuchi pattern & indexing'],
    tkd: ['TKD orientation map', 'Kikuchi pattern & indexing'],
    eds: ['EDS element map', 'X-ray spectrum'],
    fib: [`Ion image · ${P.ION[S.ion].name} · ${S.fibDet === 'si' ? 'secondary ions' : 'ion-induced electrons'}`, 'Sputter yield vs angle · probe vs current'],
    mill: [`Ion view · patterning with ${P.ION[S.ion].name}`, `SEM at ${S.tilt}° · profile through the pattern`],
    gis: [`Ion view · ${P.DEP_GAS[S.depGas].name}`, `SEM at ${S.tilt}° · growth vs current density`],
    sv: ['Slice & view · the current face', 'Orthogonal slices · phase fractions'],
    lam: ['Lamella · ion view', 'SEM view of the face · thickness profile'],
    mc: [S.mcBeam === 'ion' ? `Ion collision cascades · ${P.ION[S.ion].name}` : 'Electron trajectories · side view', S.mcBeam === 'ion' ? 'Implantation, damage, sputtered atoms' : 'Backscatter energies & depth profiles'],
  }[S.mode];
  $('#detTitle').textContent = n[0]; $('#secTitle').textContent = n[1];
}
function updateTable() { const t = $('#dataBody'); if (t && !t.closest('[hidden]')) t.innerHTML = dataRows(S, sim).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join(''); }

// ------------------------------------------------------------------ narration and component cards
const N = new Narrator({
  text: (key, level) => {
    if (key.startsWith('mode-')) { const inf = modeInfo(S, sim); return `${inf.title}. ${inf.body}`; }
    const c = COMPONENTS[key];
    if (!c) return '';
    return level === 'physics' ? `${key}. ${c.role} ${c.physics} ${c.metrology} ${c.limits}` : `${key}. ${c.role} ${c.physics.split('. ').slice(0, 2).join('. ')}.`;
  },
  onState: (k) => { $('#infoSpeak')?.classList.toggle('on', !!k && k.startsWith('mode-')); $('#compSpeak')?.classList.toggle('on', !!k && !k.startsWith('mode-')); },
});
let autoNarrate = store('fib-narrate') === '1';
function setAutoNarrate(on) { autoNarrate = on; $('#btnNarrate').setAttribute('aria-pressed', on); $('#btnNarrate').classList.toggle('on', on); store('fib-narrate', on ? '1' : '0'); if (on) N.speak(openComp || 'mode-' + S.mode); else N.stop(); }
let openComp = null;
function showComponent(name, el) {
  const card = $('#comp');
  document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active'));
  if (openComp === name && !card.hidden) return closeComponent();
  openComp = name; el.classList.add('active');
  card.querySelector('.compBody').innerHTML = renderComponent(name, S, sim) ?? '';
  card.hidden = false; card.scrollTop = 0;
  if (autoNarrate) N.speak(name);
  if (!document.body.classList.contains('stacked')) {
    const r = el.getBoundingClientRect(), W = 360, H = Math.min(card.offsetHeight, innerHeight - 40);
    const x = r.right + 14 + W < innerWidth - 360 ? r.right + 14 : Math.max(16, r.left - W - 14);
    card.style.left = `${x}px`; card.style.top = `${Math.max(16, Math.min(innerHeight - H - 16, r.top - 40))}px`;
  }
}
function closeComponent() { $('#comp').hidden = true; if (openComp && N.playing() === openComp) N.stop(); openComp = null; document.querySelectorAll('.lbl.active').forEach((l) => l.classList.remove('active')); }
scene.onLabel = showComponent;
$('#comp .close').addEventListener('click', closeComponent);
$('#compSpeak').addEventListener('click', () => openComp && N.speak(openComp));
$('#infoSpeak').addEventListener('click', () => N.speak('mode-' + S.mode));
document.addEventListener('pointerdown', (e) => { if (openComp && !e.target.closest('#comp') && !e.target.closest('.lbl')) closeComponent(); });
setInterval(() => { if (openComp) { const b = $('#comp .compBody'), st = b.parentElement.scrollTop; b.innerHTML = renderComponent(openComp, S, sim) ?? ''; b.parentElement.scrollTop = st; } }, 700);

// ------------------------------------------------------------------ hardware control panel and the on-screen console
const hwPanel = new Panel({
  S, sim, set, explain: (k) => explain(k), refresh: () => refresh(), action: (id) => action(id), beam: beamNow,
  setRaw: (k, v, inv) => { S[k] = v; sim.invalidate(inv); },
  moveStage: (dx, dy) => { S.cx += dx; S.cy += dy; sim.invalidate('stage'); },
  noteSource: (s) => scn.recorder.noteSource(s),
  openVirtual: (where) => (where === 'window' ? vPanel.openWindow() : vPanel.openDock()),
  talk: (down) => (down ? voice.start() : voice.stop()),
  mfOverride: () => null,
  cycleMode: (d) => { const i = MODES.findIndex((m) => m[0] === S.mode); setMode(MODES[(i + d + MODES.length) % MODES.length][0]); },
  toggle: (k) => {
    if (k === 'pause') action('pause');
    else if (k === 'clarity') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refresh(); explain('clarity'); }
    else if (k === 'labels') set('showLabels', !S.showLabels);
    else if (k === 'narrate') setAutoNarrate(!autoNarrate);
    else if (k === 'expand') setExpanded(!document.body.classList.contains('detBig'));
    else if (k === 'acquire') acquireNow();
  },
});
const vPanel = new VirtualPanel(hwPanel);

// ------------------------------------------------------------------ acquisitions
const acq = new Acquisitions({
  S, sim, mainCv, secCv, download: (b, n) => download(b, n),
  onChange: (a) => {
    const c = $('#acqCount');
    c.hidden = !acq.list.length; c.textContent = acq.list.length;
    if (!a) return;
    const d = $('.detector'); d.classList.remove('shot'); void d.offsetWidth; d.classList.add('shot');
    hwPanel.say(`Acquired #${a.id}`);
    note(`Acquired #${a.id}`, `${a.mode.toUpperCase()} on ${esc(sim.spec.short)}: ${esc(a.summary)}. Open the acquisitions (next to Acquire) to download the picture or the data.${a.mode === 'fib' ? ' This slow ion scan also sputtered the field.' : ''}`);
  },
});
function acquireNow() { redraw = true; R2.draw(sim, S, mainCv, secCv, hoverIdx); acq.acquire(); if (scn.recorder.active) scn.recorder.event('acquire'); }

// ------------------------------------------------------------------ one executor for voice, agent and scripts
let setAI = () => {};
function runOp(op) {
  OPS.applyOp(S, sim, op, {
    setMode, setSpec, autofocus: () => (scn.blocked('autofocus') ? blockedMsg('autofocus') : autofocus()),
    other: (o) => {
      if (o.op === 'acquire') acquireNow();
      else if (o.op === 'export') exportData();
      else if (o.op === 'narrate') N.speak('mode-' + S.mode);
      else if (o.op === 'stopSpeech') N.stop();
      else if (o.op === 'training') openTraining();
      else if (o.op === 'help') voice.flash(`<b>What can I say?</b><p>${esc(HELP)}</p>`, 12000);
      else if (o.op === 'analyze') { try { for (let i = 0; i < 3; i++) sim.update(0.05); o.result = analyze(sim, S, o.v ?? undefined); o.v = o.result.analysis; } catch (e) { o.error = e.message; } }
    },
  });
  if (op.op === 'lam' && op.done) explainLam(op.v === 'next' ? op.done : op.v, typeof op.done === 'number' ? op.done : 0);
  refresh();
  if (op.op === 'set' || op.op === 'chip') explain(op.k);
  return op;
}
const voice = new Voice({
  ctx: () => ({ mode: S.mode, paused: S.paused, beam: beamNow() }),
  run: (op) => { if (scn?.recorder.active) scn.recorder.noteSource('voice'); runOp(op); },
  agent: { get connected() { return agent.connected; }, utterance: (t) => agent.utterance(t) },
  onEvent: (kind, data) => { if (kind === 'voice' && scn?.recorder.active) scn.recorder.event('voice', data); $('#btnMic')?.classList.toggle('on', kind === 'listening' && data === true); },
});
const agent = new AgentBridge({
  urls: AGENT.urls,
  state: () => ({ ...stateSummary(S, sim), training_task: scn?.active?.id ?? null }),
  busy: () => (scn?.active ? 'A training task is running in the exhibit; the agent cannot change settings until it ends.' : scn?.replay ? 'A session replay is playing.' : null),
  run: (ops) => ops.filter((op) => op.op !== 'export').map((op) => { if (scn?.recorder.active) scn.recorder.noteSource('agent'); runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); }),
  analyze: (name) => { for (let i = 0; i < 3; i++) sim.update(0.05); return analyze(sim, S, name ?? undefined); },
  script: (call, args) => { const enc = (v) => (v instanceof Uint8Array ? { $bytes: b64(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v); return enc(scriptCore.call(call, args)); },
  command: (text) => {
    const r = parseCommand(text, { paused: S.paused, mode: S.mode, beam: beamNow() });
    if (!r.ops) return { understood: false, text };
    return { understood: true, done: r.ops.filter((op) => op.op !== 'export').map((op) => { runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); }) };
  },
  acquire: (withData) => {
    acquireNow();
    const a = acq.list[0];
    if (!a) throw new Error('nothing to acquire in this mode');
    let npz;
    if (withData) npz = b64(toNpz(a.data));
    return { id: a.id, mode: a.mode, spec: a.spec, summary: a.summary, png: a.png, png2: a.png2, npz };
  },
  say: (text) => { voice.flash(`<span class="mic agent"></span><b>Agent</b><p>${esc(text)}</p>`, Math.max(5000, text.length * 70)); N.sayText(text); },
  onStatus: (status, msg) => {
    const b = document.querySelector('[data-act="agent"]');
    if (b) b.textContent = status === 'on' ? 'Agent connected · Disconnect' : status === 'connecting' ? 'Connecting…' : 'Connect agent';
    b?.classList.toggle('on', status === 'on');
    if (msg) voice.flash(`<b>Agent</b><p>${esc(msg)}</p>`, 7000);
    else if (status === 'on') voice.flash('<span class="mic agent"></span><b>Agent connected</b><p>Ask a question with the microphone (hold M); the agent can also run the instrument.</p>', 5000);
  },
});

// ------------------------------------------------------------------ training scenarios and telemetry
const scenarioApi = {
  S, sim, version: 'fib-view-1',
  setSpec: (v) => { OPS.specState(S, sim, v); }, setMode: (m) => { if (m === S.mode) return; OPS.modeState(S, sim, m, S.mode); },
  resetMill: () => { sim.mill.reset(); sim.lam = newLamella(); },
  download: (b, n) => download(b, n),
  invalidateAll: () => { sim.invalidate('all'); refresh(); },
  applyFlat: (st) => {
    if (st.mode && st.mode !== S.mode) OPS.modeState(S, sim, st.mode, S.mode);
    for (const [k, v] of Object.entries(st)) if (k !== 'mode' && k in S && k !== 'paused') S[k] = v;
    sim.invalidate('all'); refresh();
  },
  snapshotState: () => structuredClone(Object.fromEntries(SESSION_KEYS.map((k) => [k, S[k]]))),
  restoreState: (st) => { const m = st.mode; Object.assign(S, structuredClone(st)); S.mode = ''; OPS.modeState(S, sim, m, ''); sim.invalidate('all'); refresh(); },
  onEvent: () => refresh(),
};
const scn = new Scenarios(scenarioApi);
window.addEventListener('pagehide', () => scn.flushOnExit());
const openTraining = () => scn.menu({ replay: () => action('replayFile'), last: () => action('lastSession') });

// ------------------------------------------------------------------ Python scripting
const scriptCore = new ScriptCore({
  name: 'exhibit', S, sim, scenarioApi,
  run: (op) => { runOp(op); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); },
  busy: () => (scn?.active ? 'A training task is running in the exhibit; scripts cannot change settings until it ends.' : scn?.replay ? 'A session replay is playing.' : null),
  refresh: () => refresh(),
});
const ide = new PythonIDE({ core: scriptCore, onRun: () => refresh() });
$('#btnScript').addEventListener('click', () => ide.toggle());
window.addEventListener('pointerdown', (e) => scn.recorder.noteSource(e.pointerType === 'touch' ? 'touch' : 'mouse'), true);
window.addEventListener('wheel', () => scn.recorder.noteSource('mouse'), true);
window.addEventListener('keydown', () => scn.recorder.noteSource('keyboard'), true);

// ------------------------------------------------------------------ results panel: enlarge or pop out
function setExpanded(on) { document.body.classList.toggle('detBig', on); $('#btnExpand').setAttribute('aria-pressed', on); redraw = true; resize(); }
let pop = null;
function openPopout() {
  if (pop && !pop.closed) { pop.focus(); return; }
  pop = window.open('', 'fib-results', 'popup,width=1320,height=760');
  if (!pop) { setExpanded(true); return; }
  pop.document.title = 'Sculpting with Ions · results';
  pop.document.body.innerHTML = `<style>html, body { margin: 0; height: 100%; background: #05070a; color: #e9edf2; font: 500 11px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
    body { display: flex; flex-direction: column; padding: 12px; box-sizing: border-box; gap: 8px; } header { display: flex; gap: 16px; } header span:last-child { color: #8a94a3; margin-left: auto; }
    main { flex: 1; display: flex; gap: 12px; min-height: 0; } canvas { border-radius: 8px; background: #06080b; height: 100%; } #m { aspect-ratio: 1; max-width: 58%; } #s { flex: 1; min-width: 0; }</style>
    <header><span id="t1"></span><span id="t2"></span></header><main><canvas id="m"></canvas><canvas id="s"></canvas></main>`;
  redraw = true;
}
function drawPopout() {
  if (!pop || pop.closed) { pop = null; return; }
  const m = pop.document.getElementById('m'), s = pop.document.getElementById('s');
  if (!m) return;
  pop.document.getElementById('t1').textContent = $('#detTitle').textContent; pop.document.getElementById('t2').textContent = $('#secTitle').textContent;
  R2.draw(sim, S, m, s, hoverIdx);
}

// ------------------------------------------------------------------ files
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
function saveSession() {
  const state = Object.fromEntries(SESSION_KEYS.filter((k) => k !== 'mis').map((k) => [k, S[k]]));
  const patterns = sim.mill.patterns.filter((p) => p.kind !== 'img' && p.status === 'done').map((p) => ({ kind: p.kind, shape: p.shape, x: p.x, y: p.y, w: p.w, h: p.h, depth: p.depth, ion: p.ion, kV: p.kV, I: p.I, gas: p.gas, beam: p.beam, face: p.face, overtilt: p.overtilt, rocking: p.rocking }));
  download(new Blob([JSON.stringify({ format: 'fib-view-session/1', saved: new Date().toISOString(), state, patterns, lamella: sim.lam }, null, 1)], { type: 'application/json' }), `fib-view-session-${stamp()}.json`);
  note('Session saved', 'The settings, the milled and deposited patterns and the lamella were saved. Load the file later to continue (the patterns are milled again on loading).');
}
function loadSessionFile(text) {
  const o = JSON.parse(text);
  if (!o.format?.startsWith('fib-view-session') || !o.state) throw new Error('not a FIB-view session');
  const st = o.state, d = defaultState(), mode = OPS.MODES.includes(st.mode) ? st.mode : S.mode;
  if (P.SPECIMENS[st.spec]) OPS.specState(S, sim, st.spec);
  // the mode first (it moves the stage and picks currents), then the saved values on top
  S.mode = ''; OPS.modeState(S, sim, mode, '');
  for (const k of SESSION_KEYS) { if (!(k in st) || k === 'mode' || k === 'spec' || k === 'mis') continue; if (typeof st[k] === typeof d[k]) S[k] = st[k]; }
  for (const p of o.patterns ?? []) sim.mill.add({ ...p, status: 'queued' });
  OPS.runQueue(sim);
  if (o.lamella && typeof o.lamella.step === 'number') Object.assign(sim.lam, o.lamella, { busy: null });
  sim.invalidate('all'); refresh();
  note('Session loaded', `Settings restored and ${(o.patterns ?? []).length} pattern(s) milled again.`);
}
function exportData() {
  const data = collectData(sim, S);
  if (!Object.keys(data.arrays).length) return;
  download(new Blob([toNpz(data)], { type: 'application/zip' }), `fib-view-${S.mode}-${S.spec}-${stamp()}.npz`);
  note('Exported', 'The detector data of this mode as NumPy arrays (.npz) with metadata.json: calibrations, beams, patterns and the full state.');
}

// ------------------------------------------------------------------ wiring
function wire() {
  const nav = $('.modes');
  let grp = null;
  MODES.forEach(([m, name, sub, g]) => {
    if (!grp || grp.dataset.g !== g) { grp = document.createElement('div'); grp.className = 'grp'; grp.dataset.g = g; grp.innerHTML = `<small>${g}</small><div></div>`; nav.appendChild(grp); }
    const b = document.createElement('button'); b.dataset.mode = m; b.title = `${sub} (key ${KEYS[m]})`; b.innerHTML = `${name}<kbd>${KEYS[m]}</kbd>`;
    b.addEventListener('click', () => setMode(m)); grp.lastChild.appendChild(b);
  });
  document.querySelectorAll('.clarity button').forEach((b) => b.addEventListener('click', () => { S.clarity = b.dataset.v; sim.invalidate('clarity'); refresh(); explain('clarity'); }));
  // narration chips
  const narr = () => {
    $('#narrLevel').innerHTML = [['general', 'General'], ['physics', 'Physics']].map(([k, l]) => `<button class="chip${N.level === k ? ' on' : ''}" data-l="${k}">${l}</button>`).join('');
    $('#narrVoice').innerHTML = [['female', 'Female'], ['male', 'Male']].map(([k, l]) => `<button class="chip${N.voice === k ? ' on' : ''}" data-v="${k}">${l}</button>`).join('');
    $('#narrLevel').querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { N.setLevel(b.dataset.l); narr(); }));
    $('#narrVoice').querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { N.setVoice(b.dataset.v); narr(); }));
  };
  narr();
  $('#btnNarrate').addEventListener('click', () => setAutoNarrate(!autoNarrate));
  $('#btnNarrate').setAttribute('aria-pressed', autoNarrate); $('#btnNarrate').classList.toggle('on', autoNarrate);
  $('#btnLabels').addEventListener('click', () => set('showLabels', !S.showLabels));
  $('#btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));
  $('#btnHelp').addEventListener('click', () => ($('#help').hidden = false));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });
  { const hero = $('.hero'), fit = () => document.documentElement.style.setProperty('--heroB', `${Math.round(hero.getBoundingClientRect().bottom)}px`); new ResizeObserver(fit).observe(hero); addEventListener('resize', fit); fit(); }
  if (SUPPORT.coffee) { $('#btnCoffee').href = SUPPORT.coffee; $('#btnCoffee').hidden = false; }
  $('#btnNews').addEventListener('click', () => {
    $('#newsBody').innerHTML = `<p>New modes, training tasks, guides and the TEM-view Console: get an email when they ship (one list for the TEM, SEM and FIB exhibits).</p>
      ${SUPPORT.subscribe ? `<form id="newsForm" class="newsform" novalidate>
        <label>Name<input name="name" autocomplete="name" required maxlength="100"></label>
        <label>Email<input type="email" name="email" placeholder="you@example.org" autocomplete="email" required></label>
        <label><span>Institution <small>(optional)</small></span><input name="institution" autocomplete="organization" maxlength="160"></label>
        <fieldset><legend>I am a</legend>${['student', 'staff', 'faculty', 'hobbyist'].map((r) => `<label class="role"><input type="radio" name="role" value="${r}" required>${r[0].toUpperCase() + r.slice(1)}</label>`).join('')}</fieldset>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <button class="btn primary" type="submit">Subscribe</button></form>
      <p class="muted" id="newsMsg">Only used for exhibit news, a few emails a year. Reply to any of them to unsubscribe.</p>` : ''}
      <p class="muted">Or follow the release notes on <a href="${SUPPORT.repo}/releases" target="_blank" rel="noopener">GitHub</a>.</p>`;
    $('#newsModal').hidden = false;
    const f = $('#newsForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#newsMsg'), btn = f.querySelector('button[type=submit]'), email = f.email.value.trim(), name = f.name.value.trim(), role = f.role.value;
      const bad = (t, el) => { msg.textContent = t; msg.className = 'err'; el?.focus(); };
      if (!name) return bad('Please enter your name.', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad('Please enter a valid email address.', f.email);
      if (!role) return bad('Please choose student, staff, faculty or hobbyist.');
      btn.disabled = true; btn.textContent = 'Subscribing…';
      try {
        const r = await fetch(SUPPORT.subscribe, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ email, name, institution: f.institution.value.trim(), role, website: f.website.value, source: 'fib-exhibit' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `error ${r.status}`);
        $('#newsBody').innerHTML = `<p class="thanks"><b>Thanks for subscribing!</b></p><p>News will go to <b>${esc(email)}</b>.</p>`;
      } catch (err) { msg.textContent = `Could not subscribe: ${err.message}. Please try again later.`; msg.className = 'err'; btn.disabled = false; btn.textContent = 'Subscribe'; }
    });
  });
  $('#newsModal').addEventListener('click', (e) => { if (e.target.id === 'newsModal' || e.target.closest('.close')) $('#newsModal').hidden = true; });
  $('#btnTrain').addEventListener('click', openTraining);
  const bar = $('#cmdBar'), inp = $('#cmdInput'), hist = []; let hi = 0;
  setAI = (on) => { bar.hidden = !on; $('#btnAI').classList.toggle('on', on); $('#btnAI').setAttribute('aria-pressed', String(on)); if (on) inp.focus(); else { inp.blur(); voice.escape(); } };
  $('#btnAI').addEventListener('click', () => setAI(bar.hidden));
  $('#cmdList').innerHTML = EXAMPLES.map((e) => `<option value="${e}"></option>`).join('');
  bar.addEventListener('submit', (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; hist.push(v); hi = hist.length; inp.value = ''; if (scn?.recorder.active) scn.recorder.noteSource('keyboard'); voice.handle(v, true); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); hi = Math.max(0, hi - 1); inp.value = hist[hi]; }
    else if (e.key === 'ArrowDown' && hist.length) { e.preventDefault(); hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] ?? ''; }
    else if (e.key === 'Escape') setAI(false);
  });
  const mic = $('#btnMic');
  mic.addEventListener('pointerdown', (e) => { e.preventDefault(); mic.setPointerCapture(e.pointerId); voice.start(); });
  for (const ev of ['pointerup', 'pointercancel']) mic.addEventListener(ev, () => voice.stop());
  document.querySelectorAll('[data-fold]').forEach((b) => b.addEventListener('click', () => fold(b.dataset.fold)));
  for (const k of ['L', 'R']) if (store(`fib-fold${k}`) === '1') document.body.classList.add(`fold${k}`);
  $('#fileSession').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { loadSessionFile(await f.text()); } catch (err) { note(`Could not load ${esc(f.name)}`, esc(err.message)); } });
  $('#fileReplay').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { scn.loadReplay(await f.text()); } catch (err) { note(`Could not replay ${esc(f.name)}`, esc(err.message)); } });
  $('#infoMore').addEventListener('click', () => { infoOpen = !infoOpen; renderInfo(); });
  $('#btnAcquire').addEventListener('click', acquireNow);
  $('#btnGallery').addEventListener('click', () => { $('#gallery').hidden = false; acq.render($('#gallery .gBody')); });
  $('#gallery').addEventListener('click', (e) => { if (e.target.id === 'gallery' || e.target.closest('.close')) $('#gallery').hidden = true; });
  $('#btnPanel').addEventListener('click', () => { $('#panelCfg').hidden = false; hwPanel.renderConfig($('#panelCfg .pBody')); });
  $('#panelCfg').addEventListener('click', (e) => { if (e.target.id === 'panelCfg' || e.target.closest('.close')) $('#panelCfg').hidden = true; });
  $('#btnExpand').addEventListener('click', () => setExpanded(!document.body.classList.contains('detBig')));
  $('#btnPopout').addEventListener('click', openPopout);

  // detector interactions: drag to move the stage (draw a pattern in Mill/Deposit), scroll to zoom
  let drag = null;
  const mapMode = () => S.mode === 'ebsd' || S.mode === 'tkd';
  const patMode = () => S.mode === 'mill' || S.mode === 'gis';
  const toSample = (e) => {
    const r = mainCv.getBoundingClientRect(), th = ['fib', 'mill', 'gis', 'lam'].includes(S.mode) ? sim.thetaI() : sim.thetaE();
    const pj = R2.projector(sim, S, th, r.width, r.height);
    return pj.from(e.clientX - r.left, e.clientY - r.top);
  };
  mainCv.addEventListener('pointerdown', (e) => {
    mainCv.setPointerCapture(e.pointerId);
    if (patMode() && !e.altKey && e.button === 0) { const r = mainCv.getBoundingClientRect(); drag = { pat: true, x0: e.clientX - r.left, y0: e.clientY - r.top, s0: toSample(e) }; return; }
    drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, moved: false };
  });
  mainCv.addEventListener('pointermove', (e) => {
    const r = mainCv.getBoundingClientRect();
    if (mapMode() && sim.map && !drag) {
      const Nn = sim.map.N, i = clamp(Math.floor(((e.clientX - r.left) / r.width) * Nn), 0, Nn - 1), j = clamp(Math.floor(((e.clientY - r.top) / r.height) * Nn), 0, Nn - 1), k = j * Nn + i;
      if (k < sim.map.done && k !== hoverIdx) { hoverIdx = k; sim.version++; }
      return;
    }
    if (!drag) return;
    if (drag.pat) { R2.layout.drag = { x0: Math.min(drag.x0, e.clientX - r.left), y0: Math.min(drag.y0, e.clientY - r.top), x1: Math.max(drag.x0, e.clientX - r.left), y1: Math.max(drag.y0, e.clientY - r.top) }; redraw = true; return; }
    const sc = (mapMode() && sim.map ? sim.map.fov : S.fov) / r.width;
    S.cx = drag.cx - (e.clientX - drag.x) * sc; S.cy = drag.cy + (e.clientY - drag.y) * sc; drag.moved = true;
    if (!mapMode()) sim.invalidate('stage');
  });
  const end = (e) => {
    if (drag?.pat) {
      const a = drag.s0, b = toSample(e), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      R2.layout.drag = null; redraw = true;
      if (w > S.fov * 0.01 && h > S.fov * 0.004) {
        const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
        S.patW = +w.toPrecision(3); S.patH = +h.toPrecision(3);
        // a cross-section's face is the edge toward the middle of the view (the region of interest)
        const p = OPS.addPattern(S, sim, { x, y, w, h, face: y < S.cy ? 1 : -1 });
        if (scn.recorder.active) scn.recorder.event('button', { id: `pattern:${p.shape}` });
        note('Pattern added', `#${p.id}: ${p.kind === 'dep' ? `${p.gas} deposit` : SHAPES[p.shape]} ${fmtLen(w)} × ${fmtLen(h)}, ${p.kind === 'dep' ? `${S.depThick} µm thick` : `${S.patDepth} µm deep (in Si)`}, about ${(p.tEst / 60).toFixed(1)} min at ${P.fmtCurrent(p.I)}. Press <b>Start</b> (or U).`);
        refresh();
      }
    } else if (drag?.moved) { if (mapMode()) sim.invalidate('stage'); explain(null); }
    drag = null;
  };
  mainCv.addEventListener('pointerup', end); mainCv.addEventListener('pointercancel', () => { drag = null; R2.layout.drag = null; });
  mainCv.addEventListener('pointerleave', () => { if (hoverIdx >= 0) { hoverIdx = -1; sim.version++; } });
  mainCv.addEventListener('wheel', (e) => { if (S.mode === 'mc' || S.mode === 'sv') return; e.preventDefault(); set('fov', clamp(S.fov * Math.pow(1.0015, e.deltaY), sim.spec.fovMin, sim.spec.fovMax), 'fov'); }, { passive: false });
  secCv.addEventListener('pointerdown', (e) => {
    if (S.mode === 'bse' && R2.layout.quad) {
      const r = secCv.getBoundingClientRect(), Q = R2.layout.quad, x = e.clientX - r.left - Q.cx, y = Q.cy - (e.clientY - r.top), rad = Math.hypot(x, y);
      if (rad < Q.R * 0.25 || rad > Q.R) return;
      const a = Math.atan2(y, x), q = Math.abs(a) <= Math.PI / 4 ? 'A' : Math.abs(a) >= (3 * Math.PI) / 4 ? 'B' : a > 0 ? 'C' : 'D';
      S.seg = { ...S.seg, [q]: S.seg[q] === 1 ? -1 : S.seg[q] === -1 ? 0 : 1 };
      return segChanged();
    }
    if (S.mode !== 'eds' || !R2.layout.eds) return;
    const L = R2.layout.eds, x = e.clientX - secCv.getBoundingClientRect().left, E = ((x - L.x0) / L.w) * L.Emax;
    let best = null, bd = 0.25;
    for (const l of P.XLINES) if (sim.eds.comp[l.el] && Math.abs(l.E - E) < bd) { bd = Math.abs(l.E - E); best = l.el; }
    set('edsSel', best ?? 'all', 'edsSel');
  });
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    const km = Object.keys(KEYS).find((k) => KEYS[k] === e.key);
    if (km && !e.metaKey && !e.ctrlKey && !e.altKey) setMode(km);
    else if (e.key === ' ') { e.preventDefault(); action('pause'); }
    else if (e.key === 'l' || e.key === 'L') set('showLabels', !S.showLabels);
    else if (e.key === 'r' || e.key === 'R') scene.resetView();
    else if (e.key === 'c' || e.key === 'C') { S.clarity = S.clarity === 'edu' ? 'real' : 'edu'; sim.invalidate('clarity'); refresh(); explain('clarity'); }
    else if (e.key === 'v' || e.key === 'V') vPanel.openDock();
    else if (e.key === 'i' || e.key === 'I') acquireNow();
    else if (e.key === 'u' || e.key === 'U') action('millToggle');
    else if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey) openTraining();
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) ide.toggle();
    else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) setAutoNarrate(!autoNarrate);
    else if ((e.key === 'm' || e.key === 'M') && !e.repeat && !e.metaKey && !e.ctrlKey) voice.start();
    else if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setAI(true); }
    else if (e.key === '[') fold('L');
    else if (e.key === ']') fold('R');
    else if (e.key === 'x' || e.key === 'X') setExpanded(!document.body.classList.contains('detBig'));
    else if (e.key === 'Escape') { setExpanded(false); $('#help').hidden = true; closeComponent(); if (scene.tour) scene.stopTour(); setAI(false); $('#newsModal').hidden = true; }
  });
  window.addEventListener('keyup', (e) => { if ((e.key === 'm' || e.key === 'M') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) voice.stop(); });
  window.addEventListener('resize', resize);
}
function fold(side, on = !document.body.classList.contains(`fold${side}`)) { document.body.classList.toggle(`fold${side}`, on); store(`fib-fold${side}`, on ? '1' : '0'); resize(); }
let lastBottom = 0;
function resize() {
  const w = innerWidth, h = innerHeight, wide = w >= 1100;
  if (document.body.classList.contains('stacked') === wide) { document.body.classList.toggle('stacked', !wide); if (bound.length) refresh(); }
  if (wide) {
    const L = $('.explain').getBoundingClientRect(), Rr = $('.controls').getBoundingClientRect(), D = $('.detector').getBoundingClientRect(), bc = document.body.classList;
    const off = { left: bc.contains('foldL') ? 0 : L.right, right: bc.contains('foldR') ? 0 : w - Rr.left, bottom: bc.contains('detBig') ? lastBottom : h - D.top + 10, top: 70 };
    lastBottom = off.bottom;
    scene.resize(w, h, off);
  } else { const g = $('#gl').getBoundingClientRect(); scene.resize(g.width, g.height, { left: 0, right: 0, bottom: 0, top: 0 }); }
}

// ------------------------------------------------------------------ loop
let last = performance.now(), lastDraw = 0, lastVer = -1, lastSlow = 0, frames = 0, fpsT = 0, fps = 0, lastActive = null;
const patCv = document.createElement('canvas'); patCv.width = patCv.height = 256;
const specCv = document.createElement('canvas'); specCv.width = specCv.height = 256;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    hwPanel.poll(dt);
    scn.tick();
    sim.update(dt);
    if (S.mode === 'lam' && OPS.lamTick(sim)) { refresh(); explainLam(LAM_STEPS[sim.lam.step]?.id ?? 'thin', 0); }
    const act = sim.mill.active?.id ?? null;
    if (act !== lastActive) { lastActive = act; refresh(); }
    const live = S.clarity === 'real' && (IMG.includes(S.mode) || S.mode === 'fib') && !S.paused;
    if (sim.version !== lastVer || (live && now - lastDraw > 90) || redraw) {
      redraw = false;
      drawPopout();
      R2.draw(sim, S, mainCv, secCv, hoverIdx);
      lastVer = sim.version; lastDraw = now;
      if ((IMG.includes(S.mode) || ION_MODES.includes(S.mode)) && mainCv.width > 1) { specCv.getContext('2d').drawImage(mainCv, 0, 0, 256, 256); scene.specTex.image = specCv; scene.specTex.needsUpdate = true; }
      if ((S.mode === 'ebsd' || S.mode === 'tkd') && R2.layout.pat) { patCv.getContext('2d').drawImage(secCv, 0, 0, R2.layout.pat.sz, R2.layout.pat.sz, 0, 0, 256, 256); scene.patTex.image = patCv; scene.patTex.needsUpdate = true; }
    }
    scene.update(dt, S, sim);
  } catch (err) { console.error(err); }
  frames++;
  if (now - fpsT > 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
  if (now - lastSlow > 300) {
    lastSlow = now;
    updateTable();
    hwPanel.hud($('#panelHud'));
    vPanel.update();
    if (!$('#panelCfg').hidden) { if (hwPanel.pad && !$('#pLive')) hwPanel.renderConfig($('#panelCfg .pBody')); hwPanel.renderLive($('#pLive')); }
    for (const b of bound) if ((b.c.custom || b.c.pFn) && !b.el.hidden) { if (b.c.custom) renderCustom(b); else b.el.textContent = b.c.pFn(); }
    if (['ebsd', 'tkd', 'eds', 'mc', 'mill', 'gis', 'sv', 'lam', 'fib'].includes(S.mode)) renderInfo();
    $('#status').textContent = `· ${fps} fps`;
  }
  requestAnimationFrame(frame);
}

build(); wire(); refresh(); explain('spec'); resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
// deep links: ?mode=mill, ?train=lamella-thin, ?ion=Xe, ?script=quickstart (opens the Python IDE with that example)
{ const q = new URLSearchParams(location.search); if (q.get('ion')) chip('ion', q.get('ion')); if (q.get('mode') && KEYS[q.get('mode')]) setMode(q.get('mode')); if (q.get('train') && SCENARIOS[q.get('train')]) scn.start(q.get('train'));
  const sc = q.get('script'); if (sc && /^[a-z_]+$/.test(sc)) { ide.toggle(true); ide.loadExample(`${sc}.py`); } }
window.__fib = { S, sim, scene, scn, voice, agent, hwPanel, vPanel, draw: () => R2.draw(sim, S, mainCv, secCv, hoverIdx), runOp };
