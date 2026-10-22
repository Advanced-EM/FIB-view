// The Python IDE inside the exhibit: an editor, Python 3 (Pyodide, CPython compiled to WebAssembly) with NumPy,
// and the same `fibview` package desktop scripts use (tools/fibview-py), wired straight to this page.
// Everything loads on first open from public CDNs, and runs on this computer: no code is sent anywhere.
//
// Scripts run on the page's main thread, so the exhibit pauses while a script runs and redraws when it
// ends. A worker (and, later, WebGPU compute for the simulator) would let long scripts run alongside the
// display; the fibview calls would not change.
import { b64 } from './scripting.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
const PKG = ['__init__.py', 'microscope.py', 'transports.py'];
const EXAMPLES = [
  ['quickstart.py', 'Quick start: image with both beams'],
  ['mill_rates.py', 'Milling rate: Ga vs Xe vs O'],
  ['cross_section.py', 'Mill a cross-section and image the face'],
  ['auto_focus_ion.py', 'Test automation: focus the ion beam'],
];
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const esc = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(`could not load ${src}`)); document.head.appendChild(s); });
const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };

export class PythonIDE {
  // core: the ScriptCore of this page; base: URL of the site root (for the fibview package and examples)
  constructor({ core, base = new URL('./', location.href).href, onRun }) {
    this.core = core; this.base = base; this.onRun = onRun;
    this.py = null; this.loading = null; this.cm = null;
  }

  // ---------------------------------------------------------------- window
  build() {
    const el = document.createElement('section');
    el.id = 'ide'; el.className = 'card ide'; el.hidden = true;
    el.setAttribute('aria-label', 'Python scripting');
    el.innerHTML = `
      <header class="idehead"><b>Python</b><span class="idestat">Not loaded</span><span class="sp"></span>
        <select class="ideex" aria-label="Examples"><option value="">Examples…</option>${EXAMPLES.map(([f, t]) => `<option value="${f}">${esc(t)}</option>`).join('')}</select>
        <button data-a="open" title="Open a .py file">Open</button><button data-a="save" title="Save as a .py file">Save</button>
        <button data-a="help" title="The fibview calls">Help</button><button data-a="clear" title="Clear the output">Clear</button>
        <button data-a="run" class="run" title="Run (Ctrl+Enter or ⌘+Enter)">▶ Run</button><button data-a="close" class="x" aria-label="Close">×</button></header>
      <div class="idebody"><div class="ideed"><textarea spellcheck="false" aria-label="Python code"></textarea></div><div class="ideout" aria-live="polite"></div></div>
      <div class="idehelp" hidden>${HELP}</div>
      <input type="file" accept=".py,text/x-python,text/plain" hidden>`;
    document.body.appendChild(el);
    this.el = el; this.out = el.querySelector('.ideout'); this.stat = el.querySelector('.idestat'); this.ta = el.querySelector('textarea');
    this.ta.value = store('fib-ide-code') ?? DEFAULT_CODE;
    el.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => this.act(b.dataset.a); });
    el.querySelector('.ideex').onchange = (e) => { if (e.target.value) this.loadExample(e.target.value); e.target.value = ''; };
    el.querySelector('input[type=file]').onchange = async (e) => { const f = e.target.files[0]; if (f) this.setCode(await f.text()); e.target.value = ''; };
    el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run(); } e.stopPropagation(); });
    this.drag(el.querySelector('.idehead'));
  }
  drag(h) {
    h.onpointerdown = (e) => {
      if (e.button !== 0 || e.target.closest('button, select')) return;
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      h.setPointerCapture(e.pointerId);
      h.onpointermove = (m) => Object.assign(this.el.style, { left: `${Math.max(0, Math.min(innerWidth - 120, m.clientX - dx))}px`, top: `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`, right: 'auto', bottom: 'auto' });
      h.onpointerup = h.onpointercancel = () => { h.onpointermove = null; };
    };
  }
  get open() { return !!this.el && !this.el.hidden; }
  toggle(on = !this.open) {
    if (!this.el) this.build();
    this.el.hidden = !on;
    document.getElementById('btnScript')?.classList.toggle('on', on);
    if (on) { this.editor(); this.ensurePython(); (this.cm ?? this.ta).focus(); }
  }
  act(a) {
    if (a === 'run') this.run();
    else if (a === 'close') this.toggle(false);
    else if (a === 'clear') this.out.innerHTML = '';
    else if (a === 'help') this.el.querySelector('.idehelp').hidden = !this.el.querySelector('.idehelp').hidden;
    else if (a === 'open') this.el.querySelector('input[type=file]').click();
    else if (a === 'save') { const b = new Blob([this.code()], { type: 'text/x-python' }), u = URL.createObjectURL(b), l = document.createElement('a'); l.href = u; l.download = 'fibview_script.py'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  }

  // ---------------------------------------------------------------- editor (CodeMirror 5; a plain textarea if it cannot load)
  async editor() {
    if (this.cm || this.cmTried) return;
    this.cmTried = true;
    try {
      loadCss(`${CM}codemirror.min.css`);
      await loadScript(`${CM}codemirror.min.js`);
      await Promise.all([loadScript(`${CM}mode/python/python.min.js`), loadScript(`${CM}addon/edit/matchbrackets.min.js`)]);
      this.cm = window.CodeMirror.fromTextArea(this.ta, { mode: 'python', lineNumbers: true, indentUnit: 4, matchBrackets: true, theme: 'default', extraKeys: { Tab: (cm) => cm.replaceSelection('    ') } });
      this.cm.on('change', () => store('fib-ide-code', this.cm.getValue()));
    } catch { this.ta.oninput = () => store('fib-ide-code', this.ta.value); }
  }
  code() { return this.cm ? this.cm.getValue() : this.ta.value; }
  setCode(t) { if (this.cm) this.cm.setValue(t); else this.ta.value = t; store('fib-ide-code', t); }
  async loadExample(f) {
    try { const r = await fetch(new URL(`tools/fibview-py/examples/${f}`, this.base)); if (!r.ok) throw new Error(r.status); this.setCode(await r.text()); }
    catch (e) { this.print(`Could not load the example ${f} (${e.message}).`, 'err'); }
  }

  // ---------------------------------------------------------------- Python
  ensurePython() {
    this.loading ??= (async () => {
      this.status('Loading Python (about 15 MB the first time)…');
      if (!window.loadPyodide) await loadScript(`${PYODIDE}pyodide.js`);
      const py = await window.loadPyodide({ indexURL: PYODIDE });
      await py.loadPackage('numpy');
      py.FS.mkdirTree('/home/pyodide/fibview');
      for (const f of PKG) {
        const r = await fetch(new URL(`tools/fibview-py/fibview/${f}`, this.base));
        if (!r.ok) throw new Error(`could not load fibview/${f} (${r.status})`);
        py.FS.writeFile(`/home/pyodide/fibview/${f}`, await r.text());
      }
      // the page side of the fibview package: one call, JSON in, JSON (plus the .npz bytes) out
      window.fibviewScript = {
        call: (name, argsJson) => {
          try {
            const r = this.core.call(name, JSON.parse(argsJson || '{}'));
            let bytes = null, out = r;
            if (r && r.npz instanceof Uint8Array) { bytes = r.npz; out = { ...r }; delete out.npz; }
            return { json: JSON.stringify(out ?? null), bytes, error: null };
          } catch (e) { return { json: 'null', bytes: null, error: e.message ?? String(e) }; }
        },
      };
      window.fibviewIDE = { showImage: (bytes, w, h, title) => this.image(bytes, w, h, title), showPlot: (bytes, n, title) => this.plot(bytes, n, title) };
      py.setStdout({ batched: (s) => this.print(s) });
      py.setStderr({ batched: (s) => this.print(s, 'err') });
      py.runPython('import sys; sys.path.insert(0, "/home/pyodide"); import fibview');
      this.py = py;
      const v = py.runPython('import sys; sys.version.split()[0]');
      this.status(`Python ${v} · NumPy · fibview ${py.runPython('fibview.__version__')} · ${navigator.gpu ? 'WebGPU available (the simulator computes on the CPU today)' : 'CPU'}`);
      return py;
    })().catch((e) => { this.loading = null; this.status('Python could not load'); this.print(`Python could not load: ${e.message}. It needs a network connection the first time.`, 'err'); throw e; });
    return this.loading;
  }
  async run() {
    if (this.running) return;
    const code = this.code();
    this.running = true;
    const btn = this.el.querySelector('[data-a=run]'); btn.disabled = true;
    this.print(`▶ ${new Date().toLocaleTimeString()}`, 'run');
    try {
      const py = await this.ensurePython();
      this.status('Running… the exhibit pauses until the script ends');
      await new Promise((r) => setTimeout(r, 30)); // let the status paint before the script takes the thread
      await py.loadPackagesFromImports(code);
      const t0 = performance.now();
      await py.runPythonAsync(code);
      this.print(`✓ done in ${((performance.now() - t0) / 1000).toFixed(1)} s`, 'ok');
    } catch (e) {
      this.print(cleanError(e.message ?? String(e)), 'err');
    } finally {
      this.running = false; btn.disabled = false;
      if (this.py) this.status(this.stat.dataset.ready ?? 'Ready');
      this.onRun?.();
    }
  }

  // ---------------------------------------------------------------- output
  status(t) { this.stat.textContent = t; if (!/^(Running|Loading)/.test(t)) this.stat.dataset.ready = t; }
  print(t, cls = '') { const p = document.createElement('pre'); p.className = cls; p.textContent = t; this.out.appendChild(p); this.out.scrollTop = this.out.scrollHeight; }
  image(bytes, w, h, title) {
    const g = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = g[i]; id.data[4 * i + 3] = 255; }
    cv.getContext('2d').putImageData(id, 0, 0);
    this.figure(cv, title);
  }
  plot(bytes, n, title) {
    const v = new Float32Array((bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).buffer.slice(0));
    const W = 480, H = 180, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), lo = Math.min(...v), hi = Math.max(...v);
    c.fillStyle = '#0b0e12'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#6fd6ff'; c.lineWidth = 1.5; c.beginPath();
    v.forEach((y, i) => { const X = 8 + (i / Math.max(1, n - 1)) * (W - 16), Y = H - 8 - ((y - lo) / ((hi - lo) || 1)) * (H - 16); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    c.stroke();
    this.figure(cv, title);
  }
  figure(cv, title) {
    const f = document.createElement('figure');
    f.appendChild(cv);
    if (title) { const t = document.createElement('figcaption'); t.textContent = title; f.appendChild(t); }
    this.out.appendChild(f); this.out.scrollTop = this.out.scrollHeight;
  }
}

// Python tracebacks: keep the user's part, drop Pyodide's own frames
const cleanError = (m) => { const lines = m.split('\n'); const i = lines.findIndex((l) => l.includes('File "<exec>"')); return (i > 0 ? ['Traceback (most recent call last):', ...lines.slice(i)] : lines).join('\n').trim(); };

const DEFAULT_CODE = `# Python in the exhibit. Ctrl+Enter (⌘+Enter) runs. Help lists the calls; Examples has more.
import fibview as fv

fib = fv.connect()                       # this exhibit
fib.set(mode="fib", specimen="ni", ion="Ga", ion_current_pA=25, tilt_deg=52)
img = fib.acquire()
print(img, img.calibration)
fv.show(img, "Ion-induced SE: channelling contrast in nickel")
`;

const HELP = `<p><b>import fibview as fv</b> · <b>fib = fv.connect()</b> gives this exhibit. The same script runs on a desktop
(<code>pip install -e tools/fibview-py</code>), headless or driving an open exhibit: <code>fv.connect("live")</code>.</p>
<table>
<tr><td><code>fib.set(**settings)</code></td><td>mode, specimen, kV, current_pA, wd_mm, tilt_deg, fov_um, focus_um, ion (Ga, Xe, Ar, N, O), ion_kV, ion_current_pA, ion_focus_um, detector, realistic, beam</td></tr>
<tr><td><code>fib.state()</code></td><td>current settings, electron and ion probe sizes, sputter yield of what is under the beam</td></tr>
<tr><td><code>fib.command(text)</code></td><td>a plain-language command: "switch to xenon", "mill a cross-section"</td></tr>
<tr><td><code>fib.mill(shape, x, y, w, h, depth, gas=None)</code></td><td>add a pattern (rect, rcs, ccs, line, circle) and run it to completion; returns depth, volume and the measured volume yield</td></tr>
<tr><td><code>fib.deposit(gas, x, y, w, h, thickness, beam="ion")</code></td><td>gas-assisted deposition: Pt, C or W</td></tr>
<tr><td><code>a = fib.acquire()</code></td><td>record the detectors: <code>a.image</code>, <code>a.arrays</code>, <code>a.calibration</code>, <code>a.meta</code></td></tr>
<tr><td><code>fib.analyze(name)</code></td><td>measure_resolution, measure_mill, fit_eds, ebsd_stats, sv_fractions, lamella_thickness, sputter_yield, with the true values</td></tr>
<tr><td><code>fib.challenge(id, seed)</code></td><td>sem-focus-stig, fib-focus-stig or eucentric: a hidden misalignment for your algorithm; <code>fib.score()</code>, <code>fib.reveal()</code>, <code>fib.end_challenge()</code></td></tr>
<tr><td><code>fv.show(x, title)</code></td><td>draw an image (2D) or a profile (1D) here</td></tr>
</table>
<p>The exhibit pauses while a script runs. Scripts cannot change settings during a training task, and challenge
runs are never recorded or shared.</p>`;
