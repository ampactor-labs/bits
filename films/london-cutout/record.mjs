// Records the film frame by frame (deterministic timeline) and encodes an MP4.
// usage: node record.mjs [out.mp4]   (needs `playwright` and an ffmpeg with libx264 on PATH or $FFMPEG)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, 'london-cutout.mp4');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => { console.error(e); process.exit(1); });
await page.goto('file://' + path.join(here, 'index.html') + '?record&res=1.5');
await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 120000 });
const { DUR, FPS } = await page.evaluate(() => ({ DUR: window.__film.DUR, FPS: window.__film.FPS }));
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(DUR * FPS);
for (let i = 0; i < n; i++) {
  const b64 = await page.evaluate((i) => {
    window.__film.renderFrame(i / window.__film.FPS);
    return document.getElementById('film').toDataURL('image/png').split(',')[1];
  }, i);
  if (!enc.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => enc.stdin.once('drain', r));
  if (i % 24 === 0) process.stdout.write(`frame ${i}/${n}\n`);
}
enc.stdin.end();
await new Promise((r) => enc.on('close', r));
await browser.close();
console.log('wrote', out);
