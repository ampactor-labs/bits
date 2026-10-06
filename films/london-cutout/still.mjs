// Renders chosen stills to PNG for checking: node still.mjs outdir t1 t2 ...
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [dir, ...ts] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
page.on('console', (m) => console.log('console:', m.text()));
const t0 = Date.now();
await page.addInitScript(() => { window.__prof = 1; });
await page.goto('file://' + path.join(here, 'index.html') + '?record&res=' + (process.env.RES || 1));
await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 180000 });
console.log('build ms', Date.now() - t0);
for (const t of ts) {
  const b64 = await page.evaluate((t) => { window.__film.renderFrame(+t); return document.getElementById('film').toDataURL('image/jpeg', 0.85).split(',')[1]; }, t);
  fs.writeFileSync(path.join(dir, `t${(+t).toFixed(2)}.jpg`), Buffer.from(b64, 'base64'));
}
await browser.close();
