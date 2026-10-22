// The digital twin without a page: one instrument (state + simulator) with the same operations, scripting calls and
// training challenges as the exhibit. Used by the headless runner (tools/headless.mjs), the MCP server
// (tools/fibview-mcp) and the Python driver (tools/fibview-py). Runs in Node 20+.
import { Sim } from './sim.js';
import { defaultState } from './state.js';
import * as OPS from './ops.js';
import { ScriptCore } from './scripting.js';
import { describe } from './voice.js';
import { analyze } from './analyze.js';
import { newLamella } from './mill.js';

export function createTwin({ name = 'headless' } = {}) {
  const S = defaultState(), sim = new Sim(S);
  const hooks = {
    headless: true,
    other: (op) => { if (op.op === 'analyze') { try { for (let i = 0; i < 3; i++) sim.update(0.05); op.result = analyze(sim, S, op.v ?? undefined); } catch (e) { op.error = e.message; } } },
  };
  const run = (op) => { OPS.applyOp(S, sim, op, hooks); return op.op === 'analyze' ? (op.result ?? { error: op.error }) : describe(op); };
  const scenarioApi = {
    S, sim,
    setSpec: (v) => OPS.specState(S, sim, v), setMode: (m) => OPS.modeState(S, sim, m, S.mode),
    resetMill: () => { sim.mill.reset(); sim.lam = newLamella(); },
    restoreState: (st) => { const m = st.mode; Object.assign(S, structuredClone(st)); S.mode = ''; OPS.modeState(S, sim, m, ''); sim.invalidate('all'); },
  };
  const core = new ScriptCore({ name, S, sim, run, busy: () => null, scenarioApi });
  return { S, sim, run, core, ops: OPS };
}
