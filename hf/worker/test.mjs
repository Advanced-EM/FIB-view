// Offline test of the Worker: validation, CORS, dry run, and the Hub commit it would make (fetch is mocked).
import worker from './src/index.js';
import { readFileSync } from 'node:fs';

const sample = readFileSync(new URL('../../tools/analysis/sample/eucentric-example.json', import.meta.url), 'utf8');
const env = { DATASET_REPO: 'rmsreis/fib-view-training', HF_TOKEN: 'test-token', ALLOWED_ORIGINS: 'http://localhost:8768' };
const post = (body, origin = 'http://localhost:8768', e = env) => worker.fetch(new Request('https://x.workers.dev/submit', { method: 'POST', body, headers: { origin, 'content-type': 'text/plain' } }), e);
let calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); };
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

let r = await post(sample);
ok(r.status === 200 && (await r.json()).ok, 'valid session accepted');
ok(r.headers.get('access-control-allow-origin') === 'http://localhost:8768', 'CORS header for the exhibit');
const c = calls[0], lines = c.init.body.split('\n').map((l) => JSON.parse(l));
ok(c.url === 'https://huggingface.co/api/datasets/rmsreis/fib-view-training/commit/main', 'commits to the dataset');
ok(c.init.headers.authorization === 'Bearer test-token', 'uses the secret token');
ok(lines[1].value.path === 'raw/eucentric/7e1e4fae-51b0-4677-9f20-25adbe8e1f9d.json', 'raw/<scenario>/<id>.json');
const stored = JSON.parse(Buffer.from(lines[1].value.content, 'base64').toString());
ok(stored.session.started === '2026-10-22T18:00:00Z' && stored.session.screen[0] === 1600, 'time to the hour, coarse screen');
const bad = JSON.parse(sample); bad.session.consent = false;
ok((await post(JSON.stringify(bad))).status === 422, 'no consent rejected');
ok((await post('nope')).status === 422, 'garbage rejected');
ok((await post(sample, 'https://evil.example')).status === 403, 'foreign origin refused');
calls = [];
r = await post(sample, 'http://localhost:8768', { ...env, HF_TOKEN: '' });
ok((await r.json()).dry_run === true && calls.length === 0, 'dry run without a token stores nothing');
globalThis.fetch = async () => new Response('nope', { status: 403 });
ok((await post(sample)).status === 502, 'hub failure reported');
r = await worker.fetch(new Request('https://x.workers.dev/'), env);
ok((await r.json()).dry_run === false, 'status page');

// the mailing list lives on the TEM-view collector: here /subscribe answers 503
r = await worker.fetch(new Request('https://x.workers.dev/subscribe', { method: 'POST', body: JSON.stringify({ email: 'a@example.org', name: 'A', role: 'student' }), headers: { origin: 'http://localhost:8768' } }), env);
ok(r.status === 503, 'no mailing list on this collector');
