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

  // Flip is a frame transform, so it must actually change the pixels and
  // the change must be a mirror. This runs without an encoder.
  const flip = await page.evaluate(() => window.__bitsE2E.runFlip());
  check(
    'flip mirrors the puppet',
    // Not 1.0: rasterising a mirrored stroke re-samples its anti-aliasing.
    flip.mirrorMatch > 0.95,
    `${(flip.mirrorMatch * 100).toFixed(1)}% of sampled pixels mirror`,
  );
  check(
    'flip actually changed something',
    flip.changed > 0.01,
    `${(flip.changed * 100).toFixed(1)}% of pixels differ`,
  );
  check(
    'flip puts the ink the same distance the other side of centre',
    Math.abs(1 - flip.centroidFlipped - flip.centroidPlain) < 0.01 &&
      Math.abs(flip.centroidFlipped - flip.centroidPlain) > 0.05,
    `centroid ${flip.centroidPlain.toFixed(3)} -> ${flip.centroidFlipped.toFixed(3)}`,
  );

  // The frame builder draws exactly what the hand-assembled path drew.
  const parity = await page.evaluate(() => window.__bitsE2E.runFrameParity());
  check(
    'the frame builder draws the old frames pixel for pixel',
    parity.mismatched === 0,
    `${parity.mismatched}/${parity.frames} frames differ, worst channel diff ${parity.maxDiff}`,
  );
  check(
    'the parity fixture moves and talks',
    parity.changedAcrossTime > parity.frames / 2 && parity.mouthOpenFrames > 10,
    `${parity.changedAcrossTime} frames changed, ${parity.mouthOpenFrames} with an open mouth`,
  );

  // Trails fade by elapsed time, so a 60 fps preview ghosts like the film.
  const trail = await page.evaluate(() => window.__bitsE2E.runTrailRate());
  const [t30, t60] = trail.byTime;
  const [f30, f60] = trail.byFrame;
  check(
    'a ghost fades in the same time at 60 fps as at 30',
    // Twice the frames means twice the 8-bit rounding, hence the slack.
    t30 > 3 && Math.abs(t30 - t60) <= Math.max(3, t30 * 0.25) && Math.abs(f30 - f60) > 2 * Math.abs(t30 - t60),
    `ghost after 0.3s: ${t30} vs ${t60} by time; ${f30} vs ${f60} the old way`,
  );

  // The camera: depth is free at rest, parallax when it pans, and a
  // backdrop never shows the void behind it.
  const cam = await page.evaluate(() => window.__bitsE2E.runCamera());
  check('a show with no camera draws no camera', cam.restIsNull, String(cam.restIsNull));
  check(
    'a pan slides near sheets with the world and far ones by f / (f + depth)',
    Math.abs(cam.pan) > 40 &&
      Math.abs(cam.nearSlide + cam.pan) < 2 &&
      Math.abs(cam.farSlide - cam.farExpected) < 2,
    `pan ${cam.pan.toFixed(1)}px: near ${cam.nearSlide.toFixed(1)}, far ${cam.farSlide.toFixed(1)} (want ${cam.farExpected.toFixed(1)})`,
  );
  check(
    'a panned backdrop never opens onto the void',
    cam.voidAtRest < 0.001 && cam.voidPanned < 0.001,
    `bare stage ${(cam.voidAtRest * 100).toFixed(2)}% at rest, ${(cam.voidPanned * 100).toFixed(2)}% panned`,
  );

  // A bit saved by the shipped v0 app must keep opening and keep rendering.
  const v0 = await page.evaluate(() => window.__bitsE2E.runV0());
  check(
    'a v0 bit still opens, migrated to today',
    v0.parsedVersion === v0.currentVersion && v0.castCount === 1,
    `version ${v0.parsedVersion}`,
  );
  check('migration fills updatedAt from createdAt', v0.updatedAt === '2026-07-31T12:00:00.000Z', v0.updatedAt);
  check(
    'a v0 bit still renders to its audio spine',
    Math.abs(v0.renderedDurationS - 2) < 0.2 && v0.renderedWidth === 360 && v0.renderedHeight === 640,
    `${v0.renderedDurationS.toFixed(3)}s ${v0.renderedWidth}x${v0.renderedHeight}`,
  );
  check('a v0 bit renders real bytes', v0.renderedBytes > 20000, `${v0.renderedBytes} bytes`);

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
