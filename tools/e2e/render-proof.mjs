// End-to-end render proof: serves the production build, opens it headless with
// ?e2e, and asserts the in-browser pipeline (synthesize -> perform -> render ->
// re-probe) produces the program-predicted output. Exits nonzero on any miss.

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

  const result = await page.evaluate(() => window.__bitsE2E.run());

  check(
    'fixture is a real ~2s clip',
    Math.abs(result.fixtureDurationS - 2) < 0.15,
    `duration ${result.fixtureDurationS.toFixed(3)}s`,
  );
  // Skip removes 0.5s, the half-speed span adds 0.3s; encoders pad the
  // fixture's duration slightly, so the expectation derives from the probe.
  const predicted = result.fixtureDurationS - 0.5 + 0.3;
  check(
    'program output duration follows the recipe math',
    Math.abs(result.expectedOutDurationS - predicted) < 0.001,
    `predicted ${result.expectedOutDurationS.toFixed(3)}s vs ${predicted.toFixed(3)}s`,
  );
  check(
    'rendered duration matches the program',
    Math.abs(result.renderedDurationS - result.expectedOutDurationS) < 0.12,
    `rendered ${result.renderedDurationS.toFixed(3)}s`,
  );
  check(
    'rendered dimensions are even and sized',
    result.renderedWidth === 320 && result.renderedHeight === 240,
    `${result.renderedWidth}x${result.renderedHeight}`,
  );
  check(
    'onset grid hears the four beeps',
    result.onsetsInFixture.length === 4,
    `found ${result.onsetsInFixture.length} at ${result.onsetsInFixture.map((t) => t.toFixed(2)).join(', ')}`,
  );
  check('rendered file has bytes', result.renderedBytes > 10000, `${result.renderedBytes} bytes`);

  const showResult = await page.evaluate(() => window.__bitsE2E.runShow());
  check(
    'show renders to the length of its audio spine',
    Math.abs(showResult.renderedDurationS - showResult.audioDurationS) < 0.2,
    `audio ${showResult.audioDurationS.toFixed(3)}s, rendered ${showResult.renderedDurationS.toFixed(3)}s`,
  );
  check(
    'show renders portrait at the requested size',
    showResult.renderedWidth === 360 && showResult.renderedHeight === 640,
    `${showResult.renderedWidth}x${showResult.renderedHeight}`,
  );
  check(
    'show render has real bytes',
    showResult.renderedBytes > 20000,
    `${showResult.renderedBytes} bytes`,
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
