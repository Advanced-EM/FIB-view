// Headless FIB-view for Python: one simulator in this process, driven by JSON lines on stdin.
//   request  {"id": 1, "call": "set", "args": {"mode": "fib"}}
//   reply    {"id": 1, "result": ...}  or  {"id": 1, "error": "..."}
// Byte results (the .npz from acquire) are sent as {"$bytes": "<base64>"}. Started by fibview.connect("headless").
// The repository's js/ folder is found from FIBVIEW_ROOT, or from this file's place in the repository.
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.FIBVIEW_ROOT ? resolve(process.env.FIBVIEW_ROOT) : resolve(here, '../../..');
if (!existsSync(join(root, 'js', 'twin.js'))) {
  process.stdout.write(JSON.stringify({ id: 0, error: `FIB-view not found at ${root}: set FIBVIEW_ROOT to the repository folder` }) + '\n');
  process.exit(1);
}
const [{ createTwin }, { b64 }] = await Promise.all([import(pathToFileURL(join(root, 'js', 'twin.js')).href), import(pathToFileURL(join(root, 'js', 'scripting.js')).href)]);
const { core } = createTwin({ name: 'headless' });

const enc = (v) => (v instanceof Uint8Array ? { $bytes: b64(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
send({ id: 0, result: { ready: true, root } });
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let m; try { m = JSON.parse(line); } catch { send({ id: null, error: 'not JSON' }); continue; }
  try { send({ id: m.id, result: enc(core.call(m.call, m.args)) }); }
  catch (e) { send({ id: m.id, error: e.message ?? String(e) }); }
}
