// FIB-view session collector as a Cloudflare Worker (free tier): receives training sessions that visitors chose to
// share, validates them (schema.js, same rules as hf/space/schema.py), and commits each one to the Hugging Face
// dataset as raw/<scenario>/<session id>.json through the Hub's commit API.
//
// Settings (wrangler.toml [vars] and `wrangler secret put HF_TOKEN`):
//   HF_TOKEN         fine-grained token with write access to the dataset only (secret)
//   DATASET_REPO     e.g. rmsreis/fib-view-training
//   ALLOWED_ORIGINS  comma-separated origins allowed to send
// Without HF_TOKEN it runs as a dry run: sessions are validated and acknowledged, nothing is stored.
// No IP addresses are stored; the optional rate limiter keys on a salted hash and keeps nothing.
//
// It also keeps the news mailing list: POST /subscribe {email, name, institution, role} stores the address in the SUBSCRIBERS KV
// namespace (private to the Cloudflare account, never in the public dataset). Without that binding, /subscribe
// answers 503.
import { clean, Invalid, MAX_BYTES } from './schema.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function cors(req, env) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? 'https://advanced-em.github.io').split(',').map((s) => s.trim());
  return allowed.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
}

async function hashIp(req) {
  const ip = req.headers.get('cf-connecting-ip') ?? '?';
  const day = new Date().toISOString().slice(0, 10); // the key changes daily and is never stored
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fib-view:${day}:${ip}`));
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// one commit per session: header line + file line (NDJSON), https://huggingface.co/docs/hub/api
async function commit(env, path, text, summary) {
  const body = [
    JSON.stringify({ key: 'header', value: { summary, description: '' } }),
    JSON.stringify({ key: 'file', value: { path, content: b64(text), encoding: 'base64' } }),
  ].join('\n');
  const r = await fetch(`https://huggingface.co/api/datasets/${env.DATASET_REPO}/commit/main`, {
    method: 'POST', headers: { authorization: `Bearer ${env.HF_TOKEN}`, 'content-type': 'application/x-ndjson' }, body,
  });
  if (!r.ok) throw new Error(`hub ${r.status}`);
}

// a plain sanity check, not full RFC 5322: one @, a dot in the domain, no spaces
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

const ROLES = ['student', 'staff', 'faculty', 'hobbyist'];

async function subscribe(req, env, h) {
  if (!env.SUBSCRIBERS) return json({ detail: 'the mailing list is not set up yet' }, 503, h);
  let b;
  try { b = JSON.parse(await req.text()); } catch { return json({ detail: 'not JSON' }, 400, h); }
  if (b?.website) return json({ ok: true }, 200, h); // honeypot field, filled only by bots
  const email = String(b?.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ detail: 'please enter a valid email address' }, 422, h);
  // name and role are required, institution is optional (a hobbyist may have none)
  const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  const name = text(b?.name, 100), institution = text(b?.institution, 160), role = String(b?.role ?? '').toLowerCase();
  if (!name) return json({ detail: 'please enter your name' }, 422, h);
  if (!ROLES.includes(role)) return json({ detail: `role must be one of: ${ROLES.join(', ')}` }, 422, h);
  const key = `email:${email}`;
  if (await env.SUBSCRIBERS.get(key)) return json({ ok: true, already: true }, 200, h);
  await env.SUBSCRIBERS.put(key, JSON.stringify({ email, name, institution, role, subscribed: new Date().toISOString().slice(0, 10), source: text(b?.source ?? 'exhibit', 40) }));
  return json({ ok: true }, 200, h);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), h = cors(req, env);
    const dry = !(env.HF_TOKEN && env.DATASET_REPO);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method === 'GET' && url.pathname === '/') return json({ service: 'fib-view session collector', dataset: env.DATASET_REPO || null, dry_run: dry, mailing_list: !!env.SUBSCRIBERS }, 200, h);
    if (req.method !== 'POST' || !['/submit', '/subscribe'].includes(url.pathname)) return json({ detail: 'not found' }, 404, h);
    // browsers send from the exhibit only; sendBeacon carries the origin too
    if (!h['access-control-allow-origin']) return json({ detail: 'origin not allowed' }, 403);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: await hashIp(req) });
      if (!success) return json({ detail: 'too many submissions, try again later' }, 429, h);
    }
    if (url.pathname === '/subscribe') return subscribe(req, env, h);
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ detail: 'session too large' }, 413, h);
    let s;
    try { s = clean(JSON.parse(text)); } catch (e) {
      return json({ detail: `invalid session: ${e instanceof Invalid ? e.message : 'not JSON'}` }, 422, h);
    }
    const id = s.session.id, scen = s.scenario?.id ?? 'free';
    if (dry) return json({ ok: true, id, dataset: null, dry_run: true }, 200, h);
    try {
      await commit(env, `raw/${scen}/${id}.json`, JSON.stringify(s), `Session ${id.slice(0, 8)} (${scen}, ${s.session.experience})`);
    } catch (e) {
      return json({ detail: `could not store the session (${e.message})` }, 502, h);
    }
    return json({ ok: true, id, dataset: env.DATASET_REPO }, 200, h);
  },
};
