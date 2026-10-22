// Renders the figures of the guides (docs/guides/fig) with the exhibit's own simulator, in headless Chrome:
//   node tools/guide-figs.mjs
// It serves the repository, opens tools/guide-figs.html, and writes every image (and numbers.json, the values the
// guides quote) that the page posts back. Set CHROME=/path/to/chrome if Chrome is not in the usual place.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, extname, normalize } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname), out = join(root, 'docs/guides/fig');
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found: set CHROME=/path/to/chrome'); process.exit(1); }
await mkdir(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let browser;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (url.pathname === '/done') {
      res.end('ok');
      if (body.length) console.error(body.toString());
      browser?.kill(); server.close(); process.exitCode = body.length ? 1 : 0;
      return;
    }
    const name = url.pathname.replace(/^\/fig\//, '');
    if (!/^[a-z0-9_.-]+$/.test(name)) { res.statusCode = 400; return res.end(); }
    await writeFile(join(out, name), body); console.log(`  ${name}  ${(body.length / 1024).toFixed(0)} kB`);
    return res.end('ok');
  }
  const p = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try { res.setHeader('content-type', TYPES[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
server.listen(0, '127.0.0.1', () => {
  const page = `http://127.0.0.1:${server.address().port}/tools/guide-figs.html`;
  console.log(`rendering ${page}`);
  browser = spawn(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=2', '--window-size=1500,1100', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(root, 'build', 'chrome-figs')}`, '--remote-debugging-port=0', page], { stdio: 'ignore' });
});
