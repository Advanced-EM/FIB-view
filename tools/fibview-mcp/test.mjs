// Test the MCP server as an agent would: list tools, simulate and mill headless; with --live, also drive an open exhibit.
//   node test.mjs            headless only
//   node test.mjs --live     then open the exhibit and click "Connect agent" within 90 s
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'fibview-'));
const client = new Client({ name: 'fibview-test', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('./server.mjs', import.meta.url).pathname], env: { ...process.env, FIBVIEW_OUT: out, FIBVIEW_PORT: process.env.FIBVIEW_PORT ?? '8792' }, stderr: 'inherit' }));
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const body = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

const { tools } = await client.listTools();
ok(tools.length === 14, `14 tools: ${tools.map((t) => t.name).join(', ')}`);
let r = await client.callTool({ name: 'simulate', arguments: { mode: 'fib', specimen: 'ni', ion: 'Ga', ion_current_pA: 25, analysis: 'auto' } });
const s1 = JSON.parse(body(r));
ok(!r.isError && existsSync(s1.file) && s1.arrays.ion_image, `simulate wrote ${s1.file.split('/').pop()} (${Object.keys(s1.arrays).join(', ')}); ${s1.analysis?.summary?.slice(0, 80)}`);
r = await client.callTool({ name: 'mill', arguments: { specimen: 'chip', ion: 'Xe', shape: 'rect', w_um: 8, h_um: 8, depth_um: 3, ion_current_pA: 15000 } });
const m = JSON.parse(body(r));
ok(!r.isError && m.result.depth_um > 1 && existsSync(m.file), `mill: Xe 8×8 µm → ${m.result.depth_um} µm deep, ${m.result.volume_yield_um3_per_nC} µm³/nC, ${m.result.time_s} s`);
r = await client.callTool({ name: 'ion_physics', arguments: { ion: 'Ga', kV: 30, material: 'Si' } });
const ph = JSON.parse(body(r));
ok(ph.sputter_yield_atoms_per_ion > 1.5 && ph.sputter_yield_atoms_per_ion < 3 && ph.projected_range_nm > 20 && ph.projected_range_nm < 40, `Ga 30 keV in Si: Y ${ph.sputter_yield_atoms_per_ion}, Rp ${ph.projected_range_nm} nm`);
r = await client.callTool({ name: 'cryo_lamella', arguments: { ion: 'Ga', milling_angle_deg: 12, passes: [{ current_pA: 1000, target_nm: 2500 }, { current_pA: 300, target_nm: 800 }, { current_pA: 100, target_nm: 400 }, { current_pA: 30, target_nm: 200 }] } });
const cr = JSON.parse(body(r));
ok(!r.isError && cr.result.t < 300 && cr.result.devit_pct === 0 && !cr.result.bent, `cryo_lamella: ${cr.result.t} nm, t/λ ${cr.result.t_lambda}, damage ${cr.result.damage.join('/')} nm, ${cr.result.time_min} min · ${cr.result.verdict}`);
r = await client.callTool({ name: 'exhibit_set', arguments: { mode: 'mill' } });
ok(r.isError && /No exhibit is connected/.test(body(r)), 'exhibit_set without an exhibit explains how to connect');

if (process.argv.includes('--live')) {
  console.log('waiting up to 90 s for the exhibit to connect…');
  let st;
  for (let i = 0; i < 90; i++) { st = JSON.parse(body(await client.callTool({ name: 'exhibit_status', arguments: {} }))); if (st.connected) break; await new Promise((res) => setTimeout(res, 1000)); }
  ok(st.connected, `exhibit connected: ${st.mode} on ${st.specimen_name}`);
  r = await client.callTool({ name: 'exhibit_set', arguments: { specimen: 'chip', mode: 'mill', ion: 'Xe' } });
  ok(!r.isError, `exhibit_set: ${JSON.parse(body(r)).done.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_command', arguments: { text: 'mill a cross-section' } });
  ok(!r.isError && JSON.parse(body(r)).understood, `exhibit_command: ${JSON.parse(body(r)).done?.join(' · ')}`);
  r = await client.callTool({ name: 'exhibit_acquire', arguments: { save: true } });
  ok(!r.isError && r.content.some((c) => c.type === 'image'), 'exhibit_acquire');
  r = await client.callTool({ name: 'exhibit_say', arguments: { text: 'Xenon ions mill about twice as fast as gallium here.' } });
  ok(!r.isError, 'exhibit_say');
}
await client.close();
