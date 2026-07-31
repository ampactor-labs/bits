// End-to-end render proof: serves the production build, opens it headless with
// ?e2e, and asserts the in-browser show pipeline (synthesize audio -> cast a
// snipped, mouthed puppet -> replay a scripted pass -> render -> re-probe)
// holds. Exits nonzero on any miss.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const PORT = 4174;
const URL_UNDER_TEST = `http://localhost:${PORT}/bits/?e2e`;
const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  '/usr/bin/google-chrome';

const failures = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/bits/`);
      if (r.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server never came up');
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.goto(URL_UNDER_TEST, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForFunction('window.__bitsE2E !== undefined', { timeout: 10000 });

  const show = await page.evaluate(() => window.__bitsE2E.runShow());

  check(
    'fixture audio is a real ~2s track',
    Math.abs(show.audioDurationS - 2) < 0.15,
    `duration ${show.audioDurationS.toFixed(3)}s`,
  );
  check('onset grid hears the four beeps', show.onsetCount === 4, `found ${show.onsetCount}`);
  check(
    'show renders to the length of its audio spine',
    Math.abs(show.renderedDurationS - show.audioDurationS) < 0.2,
    `audio ${show.audioDurationS.toFixed(3)}s, rendered ${show.renderedDurationS.toFixed(3)}s`,
  );
  check(
    'show renders portrait at the requested size',
    show.renderedWidth === 360 && show.renderedHeight === 640,
    `${show.renderedWidth}x${show.renderedHeight}`,
  );
  check('show render has real bytes', show.renderedBytes > 20000, `${show.renderedBytes} bytes`);

  const bundle = await page.evaluate(() => window.__bitsE2E.runBundle());
  check(
    'bit file name survives an emoji title',
    bundle.fileName === 'roundtrip bit.bit.json',
    bundle.fileName,
  );
  check(
    'import copies assets under fresh ids',
    bundle.audioRemapped && bundle.cutoutRemapped,
    `audio ${bundle.audioRemapped}, cutout ${bundle.cutoutRemapped}`,
  );
  check(
    'imported assets carry the original bytes',
    bundle.audioBytesMatch && bundle.cutoutBytes > 0,
    `cutout ${bundle.cutoutBytes} bytes`,
  );
  check(
    'recipe arrives whole',
    bundle.castCount === 4 && bundle.passCount === 3,
    `${bundle.castCount} cast, ${bundle.passCount} passes`,
  );
  check(
    'import keeps playing after the original assets are deleted',
    bundle.survivesOriginalDelete,
  );

  check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
} catch (err) {
  check('e2e run completed', false, String(err));
} finally {
  await browser?.close();
  preview.kill();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nrender proof passed');
