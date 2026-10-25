// Renders the icon set and the social-preview banner from tools/brand/icon.svg with headless Chrome:
//   node tools/icons.mjs        → icons/*.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname), out = join(root, 'icons');
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found: set CHROME=/path/to/chrome'); process.exit(1); }
mkdirSync(out, { recursive: true });
const page = pathToFileURL(join(root, 'tools/brand/render.html')).href;
const shot = (name, query, w, h) => {
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', '--virtual-time-budget=6000', `--window-size=${w},${h}`, `--screenshot=${join(out, name)}`, `${page}?${query}`], { stdio: 'ignore' });
  console.log(`icons/${name}`);
};
for (const n of [32, 180, 192, 512, 1024]) shot(`icon-${n}.png`, `size=${n}`, n, n);
shot('maskable-512.png', 'size=512&mode=maskable', 512, 512);
shot('apple-touch-icon.png', 'size=180&mode=bleed', 180, 180);
shot('social-preview.png', 'social', 1280, 640);
