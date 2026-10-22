#!/usr/bin/env node
// fibview-mcp: an MCP server that lets an AI agent (Claude, an emskills agent, …) use the FIB-view dual-beam twin.
//
//   Live:      the exhibit (browser) connects to ws://127.0.0.1:8792 after the visitor clicks "Connect agent".
//              The agent can then read the state, change settings, mill and deposit, acquire images, speak through
//              the exhibit, and receive the visitor's spoken questions.
//   Headless:  simulate / mill run the same simulator in Node, no browser needed, and write NumPy .npz data.
//
// Run it from an MCP client (stdio), e.g. in Claude Code: claude mcp add fibview -- node /path/to/FIB-View/tools/fibview-mcp/server.mjs
// Environment: FIBVIEW_PORT (8792; TEM-view's temview-mcp uses 8790), FIBVIEW_ORIGINS (comma-separated; default the
//              exhibit's site and localhost), FIBVIEW_OUT (folder for acquisitions and simulations; default ./fibview-out).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { createTwin } from '../../js/twin.js';
import { collectData, toNpz } from '../../js/export.js';
import { ANALYSES } from '../../js/analyze.js';
import { MODES, runQueue, addPattern } from '../../js/ops.js';
import { SPEC_KEYS, ION_KEYS, sputter, ionRange, MAT } from '../../js/physics.js';

const PORT = +(process.env.FIBVIEW_PORT ?? 8792);
const ORIGINS = (process.env.FIBVIEW_ORIGINS ?? 'https://advanced-em.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = resolve(process.env.FIBVIEW_OUT ?? 'fibview-out');
const log = (...a) => console.error('[fibview-mcp]', ...a); // stdout belongs to the MCP protocol

// ------------------------------------------------------------------ bridge to the exhibit
let page = null, nextId = 1;
const pending = new Map(), utterances = [], waiters = [];
const allowed = (origin) => !origin || ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, verifyClient: ({ origin }) => allowed(origin) });
wss.on('listening', () => log(`waiting for the exhibit on ws://127.0.0.1:${PORT}`));
wss.on('error', (e) => log('websocket error:', e.message));
wss.on('connection', (ws) => {
  if (page) page.close(4000, 'replaced by a newer exhibit tab');
  page = ws; log('exhibit connected');
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
    else if (m.event === 'utterance' && typeof m.text === 'string') {
      const u = { text: m.text.slice(0, 500), at: new Date().toISOString() };
      const w = waiters.shift(); if (w) w(u); else { utterances.push(u); if (utterances.length > 20) utterances.shift(); }
    }
  });
  ws.on('close', () => { if (page === ws) { page = null; log('exhibit disconnected'); } });
});
function call(method, params = {}, timeoutMs = 30000) {
  if (!page || page.readyState !== 1) return Promise.reject(new Error('No exhibit is connected. Open the exhibit and click "Connect agent" (Controls → Voice and agent).'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`the exhibit did not answer ${method} in time`)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    page.send(JSON.stringify({ id, method, params }));
  });
}
const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e.message ?? String(e) }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

// ------------------------------------------------------------------ settings → operations (the same ops as voice commands)
const settings = {
  mode: z.enum(MODES).optional().describe('se, inlens, bse, ebsd, tkd, eds (electron beam); fib (ion image), mill, gis (deposition); sv (slice & view), lam (lamella); mc (Monte Carlo)'),
  specimen: z.enum(SPEC_KEYS).optional().describe('chip (microchip), ni (polished nickel), sn (tin on carbon), nmc (Li-ion cathode), xs (chip lamella)'),
  ion: z.enum(ION_KEYS).optional().describe('Ga (liquid-metal source) or Xe, Ar, N, O (plasma source)'),
  kV: z.number().min(0.5).max(30).optional().describe('electron beam voltage'),
  current_pA: z.number().positive().max(20000).optional().describe('electron probe current'),
  ion_kV: z.number().min(1).max(30).optional(),
  ion_current_pA: z.number().positive().max(3e6).optional().describe('snaps to the aperture strip'),
  tilt_deg: z.number().min(0).max(72).optional().describe('52: ion beam normal to the surface'),
  fov_um: z.number().positive().max(1500).optional(),
  gas: z.enum(['none', 'XeF2', 'H2O']).optional().describe('etch gas for milling'),
  mc_beam: z.enum(['e', 'ion']).optional(),
  realistic: z.boolean().optional().describe('shot noise and raw signals instead of the educational view'),
};
function toOps(a) {
  const ops = [];
  if (a.specimen) ops.push({ op: 'spec', v: a.specimen });
  if (a.mode) ops.push({ op: 'mode', v: a.mode });
  if (a.ion) ops.push({ op: 'chip', k: 'ion', v: a.ion });
  if (a.kV !== undefined) ops.push({ op: 'kv', beam: 'e', v: a.kV });
  if (a.ion_kV !== undefined) ops.push({ op: 'kv', beam: 'ion', v: a.ion_kV });
  if (a.current_pA !== undefined) ops.push({ op: 'current', beam: 'e', v: a.current_pA });
  if (a.ion_current_pA !== undefined) ops.push({ op: 'current', beam: 'ion', v: a.ion_current_pA });
  if (a.tilt_deg !== undefined) ops.push({ op: 'set', k: 'tilt', v: a.tilt_deg });
  if (a.fov_um !== undefined) ops.push({ op: 'set', k: 'fov', v: a.fov_um });
  if (a.gas) ops.push({ op: 'chip', k: 'gas', v: a.gas });
  if (a.mc_beam) ops.push({ op: 'chip', k: 'mcBeam', v: a.mc_beam });
  if (a.realistic !== undefined) ops.push({ op: 'set', k: 'clarity', v: a.realistic ? 'real' : 'edu' });
  return ops;
}
const pattern = {
  shape: z.enum(['rect', 'rcs', 'ccs', 'line', 'circle']).optional().describe('rect, rcs (regular cross-section), ccs (cleaning cross-section), line, circle'),
  w_um: z.number().positive().max(500).optional(), h_um: z.number().positive().max(500).optional(), depth_um: z.number().positive().max(200).optional().describe('depth in silicon (the application file)'),
  x_um: z.number().optional(), y_um: z.number().optional(),
};

// ------------------------------------------------------------------ headless
function settle(tw) {
  const { S, sim } = tw;
  const steps = S.mode === 'ebsd' || S.mode === 'tkd' ? 400 : S.mode === 'sv' ? 60 : S.mode === 'mc' ? 80 : 8;
  for (let i = 0; i < steps; i++) { sim.update(S.mode === 'sv' ? 0.4 : 0.05); if ((S.mode === 'ebsd' || S.mode === 'tkd') && sim.map?.done >= sim.map.N ** 2) break; if (S.mode === 'sv' && sim.sv?.done) break; }
  sim._mt = 0; sim.update(0.05);
}
function save(tw, tag, a) {
  const data = collectData(tw.sim, tw.S);
  mkdirSync(OUT, { recursive: true });
  const file = a.out ? resolve(a.out) : join(OUT, `${tag}-${tw.S.mode}-${tw.S.spec}-${Date.now()}.npz`);
  writeFileSync(file, toNpz(data));
  return { file, arrays: Object.fromEntries(Object.entries(data.arrays).map(([k, v]) => [k, v.shape])), calibration: data.meta.calibration };
}

// ------------------------------------------------------------------ MCP tools
const server = new McpServer({ name: 'fibview', version: '0.1.0' }, {
  instructions: 'FIB-view is a physics-based dual-beam focused ion beam / scanning electron microscope simulator (a digital twin): Ga⁺ and Xe⁺/Ar⁺/N⁺/O⁺ plasma ion beams that image, mill and deposit, plus SEM imaging, EBSD/TKD and EDS. Use simulate and mill for headless data. The exhibit_* tools act on a live exhibit a visitor has open; a person may be watching and listening, so keep exhibit_say short and plain. Never change settings during a training task the visitor is doing (the exhibit refuses).',
});

server.registerTool('simulate', {
  title: 'Simulate a FIB-view acquisition (headless)',
  description: 'Run the simulator without a browser and save what the detectors record as a NumPy .npz (electron or ion images, EBSD maps, EDS spectra and maps, Monte Carlo histograms, slice & view stacks) with metadata.json. Returns the file path, array shapes and calibration.',
  inputSchema: { ...settings, analysis: z.enum(['auto', ...Object.keys(ANALYSES)]).optional(), out: z.string().optional() },
  annotations: { readOnlyHint: false, openWorldHint: false },
}, safe(async (a) => {
  const tw = createTwin();
  for (const op of toOps(a)) tw.run(op);
  settle(tw);
  const r = save(tw, 'sim', a);
  if (a.analysis) r.analysis = tw.run({ op: 'analyze', v: a.analysis === 'auto' ? null : a.analysis });
  return text({ mode: tw.S.mode, specimen: tw.sim.spec.name, ...r });
}));

server.registerTool('mill', {
  title: 'Mill a pattern (headless)',
  description: 'Mill one pattern with an ion species into a specimen and run it to completion: returns the depth reached, the removed volume, the charge, the measured volume yield and the instrument time, and saves the ion image, the 52° SEM image of the result and the depth map as .npz. Compare species: Xe sputters fastest, O burns carbon and polymers selectively, Ga gives the finest probe.',
  inputSchema: { specimen: z.enum(SPEC_KEYS).optional(), ion: z.enum(ION_KEYS).optional(), ion_kV: z.number().min(1).max(30).optional(), ion_current_pA: z.number().positive().max(3e6).optional(), gas: z.enum(['none', 'XeF2', 'H2O']).optional(), ...pattern, out: z.string().optional() },
}, safe(async (a) => {
  const tw = createTwin(), { S, sim } = tw;
  for (const op of toOps({ specimen: a.specimen ?? 'chip', mode: 'mill', ion: a.ion, ion_kV: a.ion_kV, ion_current_pA: a.ion_current_pA, gas: a.gas })) tw.run(op);
  const p = addPattern(S, sim, { kind: 'mill', shape: a.shape ?? 'rect', x: a.x_um ?? S.cx, y: a.y_um ?? S.cy, w: a.w_um ?? 10, h: a.h_um ?? 10, depth: a.depth_um ?? 2, face: 1 });
  runQueue(sim); settle(tw);
  const m = sim.mill.measure(p), Ysi = sputter(S.ion, 'Si', S.ikV);
  return text({ pattern: { id: p.id, shape: p.shape, ion: p.ion, kV: p.kV, current_pA: p.I, asked_depth_um_in_Si: p.depth }, result: { depth_um: +m.maxDepth.toFixed(3), volume_um3: +m.volume.toFixed(2), charge_nC: +m.charge.toFixed(3), volume_yield_um3_per_nC: +m.Yv.toFixed(4), time_s: +p.t.toFixed(1) }, reference: { si_yield_atoms_per_ion: +Ysi.Y.toFixed(3), si_volume_yield: +Ysi.Yv.toFixed(4) }, ...save(tw, 'mill', a) });
}));

server.registerTool('ion_physics', {
  title: 'Ion–solid numbers',
  description: 'Sputter yield (atoms/ion and µm³/nC, at an incidence angle), projected range, straggle and damage depth of an ion species and energy in a material, from the same physics the exhibit uses (Sigmund/ZBL-scaled yields, Yamamura angular dependence, binary-collision Monte Carlo ranges).',
  inputSchema: { ion: z.enum(ION_KEYS), kV: z.number().min(0.5).max(50), material: z.enum(Object.keys(MAT).filter((k) => k !== 'vac')), incidence_deg: z.number().min(0).max(89).optional() },
  annotations: { readOnlyHint: true },
}, safe(async (a) => {
  const y = sputter(a.ion, a.material, a.kV, ((a.incidence_deg ?? 0) * Math.PI) / 180), r = ionRange(a.ion, a.material, a.kV);
  return text({ ion: a.ion, kV: a.kV, material: MAT[a.material].name, incidence_deg: a.incidence_deg ?? 0, sputter_yield_atoms_per_ion: +y.Y.toFixed(3), volume_yield_um3_per_nC: +y.Yv.toFixed(4), projected_range_nm: +r.Rp.toFixed(2), straggle_nm: +r.dRp.toFixed(2), damage_depth_nm: +r.damage.toFixed(2) });
}));

server.registerTool('exhibit_status', {
  title: 'Exhibit status',
  description: 'Is a live exhibit connected, and what is it showing: mode, specimen, both beams (species, voltage, current, probe size), stage tilt and height, patterns and whether a training task is running.',
  inputSchema: {}, annotations: { readOnlyHint: true },
}, safe(async () => text(page ? { connected: true, ...(await call('state')) } : { connected: false, how: 'Open the exhibit (https://advanced-em.github.io/FIB-view/) and click "Connect agent" in Controls → Voice and agent.' })));

server.registerTool('exhibit_set', {
  title: 'Change exhibit settings',
  description: 'Change the live instrument: mode, specimen, ion species, voltages, currents, tilt, field of view, etch gas, Monte Carlo beam, realistic view. Returns what changed.',
  inputSchema: settings,
}, safe(async (a) => { const ops = toOps(a); if (!ops.length) throw new Error('nothing to change'); return text(await call('run', { ops })); }));

server.registerTool('exhibit_pattern', {
  title: 'Mill or deposit in the exhibit',
  description: 'Add a milling pattern (or a deposition with gas Pt, C or W) at the centre of the live view (or at x_um, y_um) and start it. The visitor sees it run, sped up. Use exhibit_status to follow it.',
  inputSchema: { ...pattern, deposit: z.enum(['Pt', 'C', 'W']).optional(), electron_beam: z.boolean().optional().describe('deposit with the electron beam instead of the ions'), thickness_um: z.number().positive().max(20).optional() },
}, safe(async (a) => {
  const op = a.deposit ? { op: 'deposit', gas: a.deposit, beam: a.electron_beam ? 'e' : 'ion', thick: a.thickness_um ?? null, w: a.w_um ?? null, h: a.h_um ?? null }
    : { op: 'pattern', shape: a.shape ?? 'rect', w: a.w_um ?? null, h: a.h_um ?? null, depth: a.depth_um ?? null, start: true };
  return text(await call('run', { ops: [op] }));
}));

server.registerTool('exhibit_action', {
  title: 'Exhibit action',
  description: 'Press a control: autofocus (the active beam), start_milling, stop_milling, clear_patterns, fresh_specimen, eucentric (go to the coincidence point), lamella_next_step, blank_beam, unblank_beam, narrate (the exhibit explains the current mode aloud).',
  inputSchema: { action: z.enum(['autofocus', 'start_milling', 'stop_milling', 'clear_patterns', 'fresh_specimen', 'eucentric', 'lamella_next_step', 'blank_beam', 'unblank_beam', 'narrate']) },
}, safe(async ({ action }) => {
  const op = { autofocus: { op: 'action', v: 'autofocus' }, start_milling: { op: 'action', v: 'millStart' }, stop_milling: { op: 'action', v: 'millStop' }, clear_patterns: { op: 'action', v: 'clearPatterns' }, fresh_specimen: { op: 'action', v: 'resetMill' }, eucentric: { op: 'action', v: 'eucentric' }, lamella_next_step: { op: 'lam', v: 'next' }, blank_beam: { op: 'set', k: 'paused', v: true }, unblank_beam: { op: 'set', k: 'paused', v: false }, narrate: { op: 'narrate' } }[action];
  return text(await call('run', { ops: [op] }));
}));

server.registerTool('exhibit_command', {
  title: 'Run a spoken-style command',
  description: 'Run a plain-language command with the exhibit\'s voice grammar, as if the visitor had said it: "switch to xenon", "mill a cross-section", "deposit 1 micron of platinum", "thin to 100 nm", "tilt to 52", "acquire". Returns what was done, or that it was not understood.',
  inputSchema: { text: z.string().min(1).max(300) },
}, safe(async ({ text: t }) => text(await call('command', { text: t }))));

server.registerTool('exhibit_acquire', {
  title: 'Acquire from the exhibit',
  description: 'Record what the live detectors show, like the Acquire button. Returns the image(s) and the settings; with save=true also writes the data (.npz) and images (.png) to disk and returns their paths.',
  inputSchema: { save: z.boolean().optional() },
}, safe(async ({ save: sv }) => {
  const r = await call('acquire', { data: !!sv }, 45000);
  const content = [{ type: 'text', text: JSON.stringify({ id: r.id, mode: r.mode, specimen: r.spec, settings: r.summary }, null, 2) }];
  for (const png of [r.png, r.png2].filter(Boolean)) content.push({ type: 'image', data: png.split(',')[1], mimeType: 'image/png' });
  if (sv) {
    mkdirSync(OUT, { recursive: true });
    const base = join(OUT, `exhibit-${r.mode}-${r.id}-${Date.now()}`), files = {};
    if (r.npz) { writeFileSync(`${base}.npz`, Buffer.from(r.npz, 'base64')); files.npz = `${base}.npz`; }
    if (r.png) { writeFileSync(`${base}.png`, Buffer.from(r.png.split(',')[1], 'base64')); files.png = `${base}.png`; }
    content.push({ type: 'text', text: JSON.stringify({ saved: files }) });
  }
  return { content };
}));

server.registerTool('exhibit_analyze', {
  title: 'Analyze what the exhibit shows',
  description: 'Measure the live data and compare with the truth: measure_resolution, measure_mill, sputter_yield, fit_eds (incl. implanted Ga/Xe/Ar), ebsd_stats, sv_fractions, lamella_thickness, ion_range. Omit name to pick by mode.',
  inputSchema: { name: z.enum(Object.keys(ANALYSES)).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ name }) => text(await call('analyze', { name }))));

server.registerTool('exhibit_say', {
  title: 'Speak through the exhibit',
  description: 'Show a caption and say it aloud in the exhibit (the browser\'s speech voice). Use it to answer the visitor\'s spoken questions. Keep it to two or three short sentences.',
  inputSchema: { text: z.string().min(1).max(600) },
}, safe(async ({ text: t }) => text(await call('say', { text: t }))));

server.registerTool('exhibit_wait_for_voice', {
  title: 'Wait for the visitor to speak',
  description: 'Wait for the next thing the visitor says that is not a built-in command (usually a question), up to timeout_s seconds. Answer it with exhibit_say, and act with exhibit_set / exhibit_pattern / exhibit_action if they asked for something.',
  inputSchema: { timeout_s: z.number().min(1).max(600).optional() }, annotations: { readOnlyHint: true },
}, safe(async ({ timeout_s = 60 }) => {
  if (utterances.length) return text(utterances.shift());
  if (!page) throw new Error('No exhibit is connected.');
  const u = await new Promise((res) => { const t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, timeout_s * 1000); const w = (v) => { clearTimeout(t); res(v); }; waiters.push(w); });
  return text(u ?? { text: null, note: `nothing said in ${timeout_s} s` });
}));

await server.connect(new StdioServerTransport());
log('ready (stdio)');
