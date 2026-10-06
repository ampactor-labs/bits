// The phone walkthrough, as a build gate.
//
// The render proof guards the pipeline; it never loads the UI. This drives
// the real app on an emulated phone with a fake mic and camera, walks the
// path a first-time user walks, and asserts the things the UX audit
// measured: how much of the stage an overlay covers, how small the text
// that instructs is, whether controls have names, whether disabled looks
// disabled, whether a system dialog ever appears, and whether the path has
// a dead end.
//
// Phases are independent: one broken flow reports and the rest still run,
// because a gate that stops at the first problem tells you less than one
// that tells you all of them.
//
// Known gaps are declared, not hidden. An assertion listed in GAPS is
// allowed to fail until the milestone that closes it; when it starts
// passing the run says so, so the entry gets removed rather than rotting.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const PORT = 4175;
const BASE = `http://localhost:${PORT}/bits/`;
const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '/usr/bin/google-chrome';
const SHOTS = process.env.UX_SHOTS_DIR || join(process.cwd(), 'dist-ux-shots');

/** id -> the milestone that closes it. Delete an entry when it passes. */
const GAPS = {
};

/** A 2s 440Hz mono WAV, written by hand so the import path is exercised
 *  with a real file rather than a mock. */
function makeWav(path, seconds = 2, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = i % (rate / 2) < rate / 4 ? 1 : 0.2;
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000 * env), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return path;
}

/** A small opaque PNG, so casting a photo can be driven from a file
 *  input without a fixture checked into the repo. */
function makePng(path, size = 64) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      raw[p++] = 40 + ((x * 3) % 200);
      raw[p++] = 60 + ((y * 3) % 180);
      raw[p++] = 200 - ((x + y) % 150);
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cs = Buffer.alloc(4);
    cs.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cs]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
  return path;
}

/** The audit's table, re-taken. Every row here was a number in
 *  docs/ux-audit/README.md section 7; measuring them again in the same
 *  units is the plan's done condition, and doing it here means the table
 *  is reproducible rather than eyeballed. */
const measures = [];
const measure = (name, value) => {
  measures.push([name, String(value)]);
};

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok, detail: detail ?? '' });
  const gap = GAPS[id];
  const tag = ok ? 'ok  ' : gap ? 'gap ' : 'FAIL';
  console.log(`${tag} - ${id}${detail ? ` (${detail})` : ''}${!ok && gap ? ` [until ${gap}]` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});

const waitForServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('preview server never came up');
};

let browser;
const dialogs = [];
const pageErrors = [];

// UX_RENDERER=gl walks the stage drawn by the WebGL2 renderer (on
// SwiftShader here); the frame gate is the Canvas2D one, so it is reported
// but not held to in that mode.
const RENDERER = process.env.UX_RENDERER ? `&renderer=${process.env.UX_RENDERER}` : '';

try {
  mkdirSync(SHOTS, { recursive: true });
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      ...(RENDERER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
    ],
  });

  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices['iPhone 14']);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // A system dialog is a bug by policy: the app speaks in sheets and toasts.
  page.on('dialog', async (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    await d.dismiss().catch(() => d.accept());
  });

  let shotN = 0;
  const shot = async (name) => {
    shotN += 1;
    await page.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`) });
  };
  /** What each phase left in the recipe, as event kinds. This is the
   *  golden the stage split is judged against: a refactor may move every
   *  line in the file, but the bit a person makes by doing the same things
   *  has to come out identical. Counts and timings vary with the mic;
   *  kinds do not. */
  const trace = [];
  /** A phase that cannot take the rest of the run down with it. */
  const phase = async (id, fn) => {
    let ok = true;
    try {
      await fn();
    } catch (err) {
      check(id, false, String(err && err.message ? err.message : err).slice(0, 120));
      await shot(`failed-${id}`).catch(() => {});
      ok = false;
    }
    try {
      const kinds = await page.evaluate(() => window.__bits?.eventKinds?.() ?? null);
      if (kinds) trace.push([id, kinds.join(',')]);
    } catch {
      // No stage mounted: nothing to record for this phase.
    }
    return ok;
  };

  const stageBox = () =>
    page.$eval('.stagebox', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const dragStage = async (path, stepMs = 60) => {
    const b = await stageBox();
    const [x0, y0] = path[0];
    await page.touchscreen.touchStart(b.x + x0 * b.w, b.y + y0 * b.h);
    for (const [fx, fy] of path.slice(1)) {
      await page.touchscreen.touchMove(b.x + fx * b.w, b.y + fy * b.h);
      await sleep(stepMs);
    }
    await page.touchscreen.touchEnd();
  };
  /** Two fingers on the stage at once, each dragging its own path.
   *  page.touchscreen carries one point; this needs the raw protocol. */
  const twoFingerDrag = async (pathA, pathB, stepMs = 120) => {
    const b = await stageBox();
    const cdp = await page.createCDPSession();
    const pt = ([fx, fy], id) => ({ x: b.x + fx * b.w, y: b.y + fy * b.h, id });
    // One point at a time: a touchStart carrying a point that is already
    // down is how Chromium is told a second finger has landed.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [pt(pathA[0], 1)],
    });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [pt(pathA[0], 1), pt(pathB[0], 2)],
    });
    const steps = Math.max(pathA.length, pathB.length);
    for (let i = 1; i < steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          pt(pathA[Math.min(i, pathA.length - 1)], 1),
          pt(pathB[Math.min(i, pathB.length - 1)], 2),
        ],
      });
      await sleep(stepMs);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  const tapStage = async (fx, fy) => {
    const b = await stageBox();
    await page.touchscreen.tap(b.x + fx * b.w, b.y + fy * b.h);
  };
  /** Where the first non-backdrop puppet actually is, in stage fractions.
   *  Its home is not its position once a pass has moved it. */
  const puppetAt = () =>
    page.evaluate(() => {
      const p = window.__bits.project();
      if (!p) return null;
      const live = new Set();
      const backs = new Set();
      for (const e of p.events) {
        if (e.kind === 'CAST') {
          live.add(e.puppetId);
          if (e.back) backs.add(e.puppetId);
        }
        if (e.kind === 'DROP') live.delete(e.puppetId);
      }
      const poses = window.__bits.poses();
      for (const id of live) {
        if (!backs.has(id) && poses[id]) return poses[id];
      }
      return null;
    });
  const tapText = async (sel, ...texts) => {
    for (const h of await page.$$(sel)) {
      const t = (await h.evaluate((e) => (e.textContent || '').trim())) || '';
      if (texts.some((want) => t === want || t.startsWith(want))) {
        await assertReachable(h, t.slice(0, 24));
        await h.tap();
        return true;
      }
    }
    throw new Error(`no ${sel} reading ${texts.map((t) => `"${t}"`).join(' or ')}`);
  };
  /** A tap that another element would swallow is a bug in the test or in
   *  the app, never something to shrug at: it used to look identical to a
   *  control that simply did nothing. */
  const assertReachable = async (h, what) => {
    const blocked = await h.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return 'has no box';
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!top || el === top || el.contains(top)) return null;
      const name = typeof top.className === 'string' ? top.className : '';
      return `covered by ${name || top.tagName}`;
    });
    if (blocked) throw new Error(`"${what}" ${blocked}`);
  };
  const tapLabel = async (label) => {
    const h = await page.$(`[aria-label="${label}"]`);
    if (!h) throw new Error(`no control labelled "${label}"`);
    await assertReachable(h, label);
    await h.tap();
  };
  const waitMode = (m, ms = 20000) =>
    page.waitForFunction(
      (mode) => document.querySelector('.stagebox')?.classList.contains(`mode-${mode}`),
      { timeout: ms },
      m,
    );
  // The worst-case overlay is the cast sheet, the tallest thing that ever
  // sits over the stage.
  const openTools = async () => {
    if (!(await page.$('.sheet'))) {
      await tapLabel('cast someone');
      await sleep(300);
    }
  };
  const closeTools = async () => {
    const close = await page.$('.sheet [aria-label="close"]');
    if (close) {
      await close.tap();
      await sleep(250);
    }
  };
  const goToList = async () => {
    // Already there: the list has no back control of its own.
    if (await page.$('.source-list, .empty')) return;
    await tapLabel('bits');
    await sleep(700);
  };
  const castDoodle = async () => {
    await openTools();
    await tapText('.cast-tile', 'draw one');
    await sleep(250);
    await dragStage([
      [0.32, 0.3],
      [0.5, 0.2],
      [0.66, 0.34],
      [0.5, 0.5],
      [0.32, 0.3],
    ]);
    await tapText('.doodle-done button', 'put it on stage');
    await sleep(400);
  };

  // ---- first exposure ------------------------------------------------
  await phase('first-run-lands-on-a-bit', async () => {
    await page.goto(`${BASE}?e2e${RENDERER}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__bits !== undefined', { timeout: 15000 });
    await page.waitForSelector('.stagebox', { timeout: 20000 });
    await sleep(800);
    await shot('first-run');
    check('first-run-lands-on-a-bit', true);
  });

  // ---- measurements, taken with the tools open (the worst case) -------
  await phase('measurements', async () => {
    await openTools();
    await shot('tools-open');

    const overlay = await page.evaluate(() => {
      const stage = document.querySelector('.stagebox')?.getBoundingClientRect();
      if (!stage) return null;
      let worst = 0;
      let who = '';
      for (const sel of ['.kit', '.sheet', '.stagepills', '.foleyrow']) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const covered =
            Math.max(0, Math.min(stage.bottom, r.bottom) - Math.max(stage.top, r.top)) /
            stage.height;
          if (covered > worst) {
            worst = covered;
            who = sel;
          }
        }
      }
      return { worst, who };
    });
    check(
      'overlay-covers-at-most-a-third',
      !!overlay && overlay.worst <= 0.34,
      overlay ? `${Math.round(overlay.worst * 100)}% by ${overlay.who || 'nothing'}` : 'no stage',
    );
    measure(
      'Worst overlay coverage of the stage',
      `${Math.round((overlay?.worst ?? 1) * 100)}% (${overlay?.who || 'nothing'})`,
    );

    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        const size = parseFloat(cs.fontSize);
        if (size < 15) out.push(`${size}px "${text.slice(0, 24)}"`);
      }
      return out;
    });
    check('no-instructive-text-under-15px', small.length === 0, small.slice(0, 3).join('; '));
    const smallest = await page.evaluate(() => {
      let min = Infinity;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue;
        if (!(el.textContent || '').trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        min = Math.min(min, parseFloat(cs.fontSize));
      }
      return Number.isFinite(min) ? min : 0;
    });
    measure('Smallest visible text size', `${smallest}px`);

    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => {
          const cs = getComputedStyle(b);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
          // An emoji-only label is not a name a screen reader can read out.
          return name.length === 0 || /^[\p{Extended_Pictographic}\p{So}️\s]+$/u.test(name);
        })
        .map((b) => b.className || b.tagName),
    );
    check('every-button-has-a-name', unnamed.length === 0, unnamed.slice(0, 5).join(', '));

    const disabled = await page.evaluate(() => {
      const worst = { opacity: 0, label: '' };
      for (const b of document.querySelectorAll('button:disabled')) {
        const o = parseFloat(getComputedStyle(b).opacity);
        if (o > worst.opacity) {
          worst.opacity = o;
          worst.label = b.getAttribute('aria-label') || b.textContent || '';
        }
      }
      return worst;
    });
    measure('Disabled button opacity', disabled.opacity === 0 ? 'none disabled' : disabled.opacity);
    check(
      'disabled-controls-look-disabled',
      disabled.opacity === 0 || disabled.opacity <= 0.5,
      `worst ${disabled.opacity} on "${disabled.label.trim()}"`,
    );
    await closeTools();
    await sleep(250);

    // The transport: the old timeline was 74px wide on a 390px phone with
    // an opacity-0 scrubber and no duration.
    const bar = await page.evaluate(() => {
      const t = document.querySelector('.timeline .track')?.getBoundingClientRect();
      const seek = document.querySelector('.timeline .seek')?.getBoundingClientRect();
      const knob = getComputedStyle(
        document.querySelector('.timeline .playhead') ?? document.body,
        '::after',
      );
      const times = document.querySelector('.timeline .times')?.textContent ?? '';
      return t
        ? {
            width: Math.round(t.width),
            frac: t.width / innerWidth,
            grab: seek ? Math.round(seek.height) : 0,
            knob: parseFloat(knob.width) || 0,
            times: times.replace(/\s+/g, ' ').trim(),
          }
        : null;
    });
    measure('Timeline width', bar ? `${bar.width}px (${Math.round(bar.frac * 100)}% of the window)` : 'none');
    measure(
      'Scrubber touch target height',
      bar ? `${bar.grab}px, with a ${bar.knob}px visible handle` : 'none',
    );
    measure('Time shown on the transport', bar ? `"${bar.times}"` : 'none');
  });

  // The kit's header, render button and rail used to sit above the top of
  // a 375x667 screen with a puppet selected: unreachable, unscrollable.
  await phase('nothing-lands-off-the-top-of-a-small-phone', async () => {
    const se = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    await page.setViewport(se);
    await sleep(500);
    await openTools();
    await sleep(400);
    await shot('small-phone');
    const above = await page.evaluate(() => {
      let worst = 0;
      let who = '';
      for (const el of document.querySelectorAll('.sheet, .halo, .lanes, .dock, .timeline, .stage-cta')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.top < worst) {
          worst = r.top;
          who = el.className.split(' ')[0];
        }
      }
      return { worst: Math.round(worst), who };
    });
    check(
      'nothing-lands-off-the-top-of-a-small-phone',
      above.worst >= 0,
      above.worst >= 0 ? 'all on screen' : `${above.worst}px on .${above.who}`,
    );
    measure(
      'Worst top edge on 375x667, tools open',
      above.worst >= 0 ? 'on screen' : `${above.worst}px (.${above.who})`,
    );
    await closeTools();
    // Back to the device the run is measured on. setViewport alone would
    // leave the window taller than the emulated phone's usable height, and
    // every later measurement would be taken on a screen that does not
    // exist.
    await page.emulate(puppeteer.KnownDevices['iPhone 14']);
    await sleep(500);
  });

  // ---- the new-user path ---------------------------------------------
  const madeSound = await phase('new-bit-gets-sound', async () => {
    await goToList();
    await tapText('.transport button', '+ new bit');
    await sleep(600);
    await shot('needs-sound');
    // On the first sound screen, before anything is recorded: can a person
    // who will not talk out loud start a bit at all?
    const offersFile = await page.evaluate(() => {
      const cta = document.querySelector('.stage-cta');
      return /use a file|pick a file|from a file/i.test(cta?.innerText ?? '');
    });
    check('sound-can-come-from-a-file', offersFile, offersFile ? 'offered' : 'mic only');
    await tapText('.stage-cta button', '⏺ record the bit', 'record the bit');
    await waitMode('micLive');
    await sleep(1400);
    await shot('recording');
    // A take used to be the word "recording…": a muted mic looked exactly
    // like a live one, and the length cap arrived out of nowhere.
    const take = await page.evaluate(() => ({
      meter: !!document.querySelector('.record-panel [role=meter]'),
      clock: document.querySelector('.rec-clock span')?.textContent ?? '',
      cap: document.querySelector('.rec-clock .times-total')?.textContent ?? '',
    }));
    check(
      'a-take-shows-a-level-and-a-clock',
      take.meter && take.clock !== '0:00' && take.cap !== '',
      `meter=${take.meter} clock=${take.clock} of ${take.cap}`,
    );
    await sleep(1200);
    await tapText('.stage-cta button', '■ done', 'done');
    await waitMode('idle', 25000);
    await sleep(500);
    await shot('after-sound');
    check('new-bit-gets-sound', true);
  });

  if (madeSound) {
    await phase('empty-stage-says-what-to-do', async () => {
      const state = await page.evaluate(() => {
        const rec = document.querySelector('[aria-label="record a pass"]');
        const text = document.querySelector('main')?.innerText ?? '';
        return { recDisabled: rec ? rec.disabled : null, guides: /cast|puppet|add/i.test(text) };
      });
      check(
        'empty-stage-says-what-to-do',
        !state.recDisabled || state.guides,
        `record disabled=${state.recDisabled}, guidance=${state.guides}`,
      );
    });

    await phase('cast-a-doodle', async () => {
      await castDoodle();
      await shot('cast');
      const casts = await page.evaluate(
        () => window.__bits.eventKinds().filter((k) => k === 'CAST').length,
      );
      check('casting-a-doodle-appends-one-cast', casts === 1, `${casts} CAST`);
      await closeTools();
    });

    await phase('play-works-before-any-pass', async () => {
      const disabled = await page.$eval('[aria-label="play"]', (b) => b.disabled);
      check('play-works-before-any-pass', disabled === false, `disabled=${disabled}`);
    });

    await phase('held-finger-never-drops', async () => {
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      const b = await stageBox();
      await page.touchscreen.touchStart(b.x + 0.5 * b.w, b.y + 0.33 * b.h);
      await sleep(1100);
      await page.touchscreen.touchEnd();
      await sleep(400);
      const added = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      check('held-finger-never-drops', !added.includes('DROP'), added.join(',') || 'nothing added');
      // A hold that changes nothing should not append anything either,
      // or undo has a no-op to step through before it reaches real work.
      check('a-hold-appends-nothing', added.length === 0, added.join(',') || 'clean');
      measure('Events appended by a 1.1s hold on a puppet', added.length);
    });

    await phase('pass-phase-reachable', async () => {
      // The held-finger bug can remove the only puppet; re-cast so the
      // recording flow is still exercised, and say that is what happened.
      const cast = await page.evaluate(
        () => window.__bits.project()?.events.filter((e) => e.kind === 'CAST').length ?? 0,
      );
      const dropped = await page.evaluate(() =>
        window.__bits.eventKinds().includes('DROP'),
      );
      if (dropped) await castDoodle();
      await closeTools();
      check('pass-phase-reachable', !dropped, dropped ? 're-cast after a drop' : `${cast} cast`);

      await tapLabel('record a pass');
      await waitMode('recording', 20000);
      await dragStage(
        [
          [0.5, 0.33],
          [0.62, 0.42],
          [0.7, 0.55],
          [0.45, 0.6],
        ],
        140,
      );
      await tapLabel('stop');
      await waitMode('idle', 15000);
      await sleep(400);
      await shot('after-pass');
      const passes = await page.evaluate(() => window.__bits.passSampleCounts());
      check('a-drag-while-recording-becomes-a-pass', passes.length >= 1, `${passes.length} pass(es)`);
    });

    // ---- the halo: a puppet's tools live on the puppet ---------------
    await phase('a-tap-selects-rather-than-moves', async () => {
      const home = await puppetAt();
      if (!home) throw new Error('nothing on stage');
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      await tapStage(home.x, home.y);
      await sleep(350);
      const after = await page.evaluate(() => window.__bits.eventKinds().length);
      const halo = await page.$('.halo');
      await shot('halo');
      check('a-tap-selects-rather-than-moves', after === before, `${after - before} events appended`);
      check('a-selected-puppet-wears-its-tools', !!halo, halo ? 'halo shown' : 'no halo');
      const covered = await page.evaluate(() => {
        const stage = document.querySelector('.stagebox')?.getBoundingClientRect();
        const bar = document.querySelector('.halo')?.getBoundingClientRect();
        if (!stage || !bar) return 1;
        return bar.height / stage.height;
      });
      check('the-halo-barely-covers-the-stage', covered <= 0.12, `${Math.round(covered * 100)}%`);
      measure('A puppet\'s tools, coverage of the stage', `${Math.round(covered * 100)}%`);
      measure(
        'Tools in a puppet\'s toolbar',
        await page.evaluate(() => document.querySelectorAll('.halo button').length),
      );
    });

    await phase('a-mouth-is-three-taps', async () => {
      const home = await puppetAt();
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      // tap 1 selected it above; tap 2 picks the tool, tap 3 places it.
      await tapLabel('mouth');
      await sleep(250);
      await tapStage(home.x, home.y + 0.02);
      await sleep(400);
      const kinds = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      check('a-mouth-is-three-taps', kinds.join(',') === 'MOUTH', kinds.join(',') || 'nothing');
      // Select, pick the tool, place it. It used to be open the kit, pick
      // the mode, tap; twice over for a mouth and eyes.
      measure('Taps to add a mouth to a puppet', 3);
      const handles = await page.$$('.handle');
      check('a-feature-becomes-a-handle', handles.length === 1, `${handles.length} handle(s)`);
    });

    await phase('a-feature-drags-off-to-come-back-off', async () => {
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      const h = await page.$eval('.handle', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const b = await stageBox();
      await page.touchscreen.touchStart(h.x, h.y);
      // Out past the puppet's own box, where letting go takes it off.
      for (let i = 1; i <= 6; i++) {
        await page.touchscreen.touchMove(h.x, b.y + (0.86 + 0.01 * i) * b.h);
        await sleep(40);
      }
      await shot('handle-removing');
      await page.touchscreen.touchEnd();
      await sleep(400);
      const kinds = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      const undo = await page.$('.toast-action');
      check('a-feature-drags-off-to-come-back-off', kinds.join(',') === 'REMOVE', kinds.join(',') || 'nothing');
      check('taking-a-feature-off-is-undoable', !!undo, undo ? 'undo offered' : 'no undo');
      if (undo) await undo.tap();
      await sleep(400);
    });

    await phase('layering-is-one-event', async () => {
      const home = await puppetAt();
      await tapStage(home.x, home.y);
      await sleep(300);
      await tapLabel('more');
      await sleep(350);
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      await tapLabel('to the back');
      await sleep(350);
      const kinds = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      check('layering-is-one-event', kinds.join(',') === 'REORDER', kinds.join(',') || 'nothing');
      measure('Events appended by sending a puppet to the back', kinds.length);
      await closeTools();
      await sleep(200);
    });

    // A doodle used to be one bone line at one width, with no way to fix a
    // stroke short of throwing the whole drawing away.
    await phase('a-doodle-can-be-drawn-in-colour', async () => {
      await openTools();
      await tapText('.cast-tile', 'draw one');
      await sleep(300);
      const overStage = await page.evaluate(() => {
        const stage = document.querySelector('.stagebox')?.getBoundingClientRect();
        const bar = document.querySelector('.doodlebar')?.getBoundingClientRect();
        if (!stage || !bar) return null;
        return Math.max(0, Math.min(stage.bottom, bar.bottom) - Math.max(stage.top, bar.top));
      });
      check('drawing-tools-never-cover-the-drawing', overStage === 0, `${overStage}px over the stage`);
      await tapLabel('orange');
      await tapLabel('thick');
      await sleep(150);
      await dragStage([
        [0.3, 0.32],
        [0.46, 0.22],
        [0.62, 0.36],
        [0.46, 0.5],
        [0.3, 0.32],
      ]);
      // A second line, rubbed out again: the drawing survives, that line does not.
      await dragStage([
        [0.34, 0.6],
        [0.58, 0.62],
      ]);
      await sleep(200);
      // While drawing, the dock's undo takes the last line.
      const twoLines = await page.evaluate(() => {
        const b = document.querySelector('[aria-label="undo"]');
        return b ? !b.disabled : false;
      });
      await tapLabel('rub a line out');
      await sleep(150);
      await tapStage(0.46, 0.61);
      await sleep(250);
      await shot('doodle-tools');
      await tapText('.doodle-done button', 'put it on stage');
      await sleep(500);
      const spec = await page.evaluate(() => {
        const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
        return casts[casts.length - 1]?.puppet ?? null;
      });
      check('a-doodle-can-be-drawn-in-colour', !!twoLines && !!spec?.strokeStyle, JSON.stringify(spec?.strokeStyle ?? null).slice(0, 60));
      check(
        'rubbing-out-takes-one-line-not-the-drawing',
        spec?.strokes?.length === 1,
        `${spec?.strokes?.length ?? 0} line(s) kept`,
      );
    });

    // Every cast used to arrive at dead centre, so a second photo hid the
    // first and looked like nothing had happened (audit F14).
    await phase('two-photos-do-not-stack', async () => {
      const png = makePng(join(SHOTS, 'cast-fixture.png'));
      const input = await page.$('input[type=file][accept="image/*"]:not([capture])');
      if (!input) throw new Error('no photo input');
      const homes = [];
      for (let i = 0; i < 2; i++) {
        await openTools();
        await input.uploadFile(png);
        await page.waitForFunction(
          (want) =>
            window.__bits
              .project()
              .events.filter((e) => e.kind === 'CAST' && e.puppet.type === 'cutout' && !e.back)
              .length >= want,
          { timeout: 40000 },
          i + 1,
        );
        const casts = await page.evaluate(() =>
          window.__bits
            .project()
            .events.filter((e) => e.kind === 'CAST' && e.puppet.type === 'cutout' && !e.back)
            .map((e) => ({ x: e.x, y: e.y })),
        );
        homes.push(casts[casts.length - 1]);
      }
      await shot('two-photos');
      const apart = Math.hypot(homes[0].x - homes[1].x, homes[0].y - homes[1].y);
      check('two-photos-do-not-stack', apart > 0.1, `${apart.toFixed(3)} apart`);
      await closeTools();
    });

    // A pass used to be invisible: audible and visible in motion, but not
    // findable, silenceable, shortenable or removable (audit F22, F23).
    await phase('a-pass-is-a-thing-you-can-see', async () => {
      await tapLabel('the passes (1)');
      await sleep(400);
      await shot('lanes');
      const spans = await page.$$('.lanes .span');
      check('a-pass-is-a-thing-you-can-see', spans.length === 1, `${spans.length} span(s)`);
      const overStage = await page.evaluate(() => {
        const stage = document.querySelector('.stagebox')?.getBoundingClientRect();
        const lanes = document.querySelector('.lanes')?.getBoundingClientRect();
        if (!stage || !lanes) return 1;
        const covered =
          Math.max(0, Math.min(stage.bottom, lanes.bottom) - Math.max(stage.top, lanes.top)) /
          stage.height;
        return covered;
      });
      check('the-lanes-cover-at-most-a-third', overStage <= 0.34, `${Math.round(overStage * 100)}%`);
      // The talker rule, drawn: a mouthed puppet's span says it talks.
      const striped = await page.evaluate(
        () => document.querySelectorAll('.lanes .span-talks').length,
      );
      check('a-talking-pass-says-so', striped === 1, `${striped} striped`);
    });

    await phase('a-pass-can-be-muted-and-taken-out', async () => {
      await (await page.$('.lanes .span')).tap();
      await sleep(300);
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      await tapLabel('mute it');
      await sleep(300);
      const muted = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      check('muting-a-pass-is-one-event', muted.join(',') === 'MUTE', muted.join(',') || 'nothing');
      const grey = await page.$$('.lanes .span-muted');
      check('a-muted-pass-still-shows', grey.length === 1, `${grey.length} muted span(s)`);
      await tapLabel('let it play');
      await sleep(300);

      await tapLabel('take this pass out');
      await sleep(400);
      const gone = await page.$$('.lanes .span');
      const undo = await page.$('.toast-action');
      check('a-pass-can-be-taken-out', gone.length === 0, `${gone.length} left`);
      check('taking-a-pass-out-is-undoable', !!undo, undo ? 'undo offered' : 'no undo');
      if (undo) await undo.tap();
      await sleep(500);
      const back = await page.$$('.lanes .span');
      check('undo-brings-the-pass-back', back.length === 1, `${back.length} span(s)`);
    });

    // Looping is what makes passes feel like overdubs: the lap you just
    // performed has to play on the next one, which means the sim is rebuilt
    // rather than rewound.
    await phase('a-loop-plays-the-pass-you-just-recorded', async () => {
      await page.$eval('.lanes-axis', (el) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
          new PointerEvent('pointerdown', { clientX: r.left + 2, clientY: r.top + 8, bubbles: true }),
        );
        el.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: r.left + r.width * 0.9,
            clientY: r.top + 8,
            bubbles: true,
          }),
        );
        el.dispatchEvent(
          new PointerEvent('pointerup', {
            clientX: r.left + r.width * 0.9,
            clientY: r.top + 8,
            bubbles: true,
          }),
        );
      });
      await sleep(300);
      const band = await page.$('.loop-band');
      check('a-stretch-can-be-looped', !!band, band ? 'band shown' : 'no band');

      const before = await page.evaluate(() => window.__bits.passSampleCounts().length);
      await tapLabel('play');
      // Long enough for at least one wrap of a bit under three seconds.
      await sleep(4200);
      const stillPlaying = await page.$('.dock-stop');
      if (stillPlaying) await tapLabel('stop');
      await sleep(400);
      const after = await page.evaluate(() => window.__bits.passSampleCounts().length);
      check(
        'looping-goes-round-without-recording-anything',
        !!stillPlaying && after === before,
        `playing=${!!stillPlaying}, ${before} -> ${after} passes`,
      );
      // Hearing one puppet is a preview, not an edit: it must leave the
      // recipe alone, or "let me listen to this one" costs an undo.
      const beforeSolo = await page.evaluate(() => window.__bits.eventKinds().length);
      const lane = await page.$('.lane-name');
      if (lane) await lane.tap();
      await sleep(300);
      const afterSolo = await page.evaluate(() => window.__bits.eventKinds().length);
      check('hearing-one-puppet-writes-nothing', afterSolo === beforeSolo, `${afterSolo - beforeSolo} events`);
      if (lane) await lane.tap();
      await sleep(200);

      // Punching in: the stretch is where a new pass begins and ends.
      const region = await page.evaluate(() => {
        const band = document.querySelector('.loop-band');
        const axis = document.querySelector('.lanes-axis');
        if (!band || !axis) return null;
        const b = band.getBoundingClientRect();
        const a = axis.getBoundingClientRect();
        const dur = window.__bits.project().audio.durationS;
        return { from: ((b.left - a.left) / a.width) * dur, to: ((b.right - a.left) / a.width) * dur };
      });
      const passesBefore = await page.evaluate(() => window.__bits.passSampleCounts().length);
      await tapLabel('record a pass');
      await waitMode('recording', 20000);
      await dragStage(
        [
          [0.5, 0.4],
          [0.6, 0.5],
          [0.4, 0.55],
        ],
        120,
      );
      if (await page.$('.dock-stop')) await tapLabel('stop');
      await sleep(600);
      const punched = await page.evaluate(() => {
        const passes = window.__bits.project().events.filter((e) => e.kind === 'PASS');
        const last = passes[passes.length - 1];
        if (!last) return null;
        const times = [];
        for (let i = 0; i < last.samples.length; i += 3) times.push(last.samples[i]);
        return { first: Math.min(...times), last: Math.max(...times), n: passes.length };
      });
      check(
        'recording-inside-a-stretch-stays-inside-it',
        !!region &&
          !!punched &&
          punched.n === passesBefore + 1 &&
          punched.first >= region.from - 0.2 &&
          punched.last <= region.to + 0.1,
        region && punched
          ? `${punched.first.toFixed(2)}-${punched.last.toFixed(2)} in ${region.from.toFixed(2)}-${region.to.toFixed(2)}`
          : 'no region or no pass',
      );

      await tapLabel('stop looping');
      await sleep(200);
      await tapLabel('close the lanes');
      await sleep(250);
    });

    // Two people, four hands. A second finger used to steal the first
    // one's puppet and cut its pass short where it was touched.
    await phase('two-fingers-record-two-passes', async () => {
      // The two furthest apart: one finger per channel is the rule, so two
      // fingers landing on the same overlapping puppet is one grab, and
      // would test nothing.
      const homes = await page.evaluate(() => {
        const poses = window.__bits.poses();
        const p = window.__bits.project();
        const live = new Set();
        const backs = new Set();
        for (const e of p.events) {
          if (e.kind === 'CAST') {
            live.add(e.puppetId);
            if (e.back) backs.add(e.puppetId);
          }
          if (e.kind === 'DROP') live.delete(e.puppetId);
        }
        const all = [...live]
          .filter((id) => !backs.has(id) && poses[id])
          .map((id) => ({ id, ...poses[id] }));
        let best = null;
        for (const u of all) {
          for (const v of all) {
            if (u === v) continue;
            const d = Math.hypot(u.x - v.x, u.y - v.y);
            if (!best || d > best.d) best = { d, pair: [u, v] };
          }
        }
        return best && best.d > 0.15 ? best.pair : [];
      });
      if (homes.length < 2) throw new Error('no two puppets far enough apart');
      const before = await page.evaluate(() => window.__bits.passSampleCounts().length);
      await tapLabel('record a pass');
      await waitMode('recording', 20000);
      const [a, b] = homes;
      await twoFingerDrag(
        [
          [a.x, a.y],
          [a.x - 0.12, a.y - 0.08],
          [a.x - 0.18, a.y + 0.05],
        ],
        [
          [b.x, b.y],
          [b.x + 0.1, b.y + 0.08],
          [b.x + 0.16, b.y - 0.06],
        ],
      );
      if (await page.$('.dock-stop')) await tapLabel('stop');
      await sleep(600);
      const added = await page.evaluate((n) => {
        const passes = window.__bits.project().events.filter((e) => e.kind === 'PASS');
        return passes.slice(n).map((p) => p.puppetId);
      }, before);
      check(
        'two-fingers-record-two-passes',
        added.length === 2 && new Set(added).size === 2,
        `${added.length} pass(es) on ${new Set(added).size} puppet(s)`,
      );
    });

    // Blind: perform against an empty stage, then meet the whole show.
    await phase('a-blind-take-reveals-the-whole-show', async () => {
      await tapLabel('this bit');
      await sleep(350);
      await tapText('.sheet-row .segment', 'on');
      await sleep(250);
      await (await page.$('.sheet [aria-label="close"]')).tap();
      await sleep(300);
      await tapLabel('record a pass');
      await waitMode('recording', 20000);
      await dragStage(
        [
          [0.5, 0.4],
          [0.55, 0.5],
        ],
        120,
      );
      if (await page.$('.dock-stop')) await tapLabel('stop');
      await sleep(250);
      await shot('curtain');
      const curtain = await page.$('.curtain');
      check('a-blind-take-reveals-the-whole-show', !!curtain, curtain ? 'curtain shown' : 'no curtain');
      // It plays itself: you meet the show rather than being told to.
      await sleep(1600);
      const playing = await page.$('.dock-stop');
      check('the-reveal-plays-itself', !!playing, playing ? 'playing' : 'stopped');
      if (playing) await tapLabel('stop');
      await sleep(300);
      await tapLabel('this bit');
      await sleep(300);
      await tapText('.sheet-row .segment', 'off');
      await sleep(200);
      await (await page.$('.sheet [aria-label="close"]')).tap();
      await sleep(250);
    });

    // Perform: the stage and nothing else.
    await phase('perform-leaves-only-the-stage', async () => {
      await tapLabel('this bit');
      await sleep(350);
      await tapLabel('perform');
      await sleep(450);
      await shot('perform');
      const bare = await page.evaluate(() => {
        const gone = (sel) => {
          const el = document.querySelector(sel);
          return !el || getComputedStyle(el).display === 'none';
        };
        return {
          chrome: gone('.dock') && gone('.timeline') && gone('.titlebar'),
          record: !!document.querySelector('.perform-controls [aria-label="record a pass"]'),
          stage: (document.querySelector('.stagebox')?.getBoundingClientRect().height ?? 0) /
            innerHeight,
          aspect: (() => {
            const r = document.querySelector('.stagebox')?.getBoundingClientRect();
            return r ? r.width / r.height : 0;
          })(),
        };
      });
      check(
        'perform-leaves-only-the-stage',
        bare.chrome && bare.record,
        `chrome gone=${bare.chrome}, record=${bare.record}`,
      );
      // Bigger, but still 9:16: performing in one shape and rendering in
      // another would change what the puppets look like in the film.
      check(
        'performing-gives-the-stage-the-screen',
        bare.stage > 0.78 && Math.abs(bare.aspect - 9 / 16) < 0.005,
        `${Math.round(bare.stage * 100)}% of the window at ${bare.aspect.toFixed(3)}`,
      );
      await tapText('.perform-controls button', 'done performing');
      await sleep(400);
      const back = await page.$('.dock');
      check('perform-can-be-left', !!back, back ? 'dock back' : 'stuck');
    });

    // Two people record their halves separately and the right mouth moves
    // for each: a puppet with a take of its own flaps to that take.
    await phase('a-puppet-can-have-its-own-voice', async () => {
      const home = await puppetAt();
      await tapStage(home.x, home.y);
      await sleep(300);
      await tapLabel('more');
      await sleep(400);
      const before = await page.evaluate(() => window.__bits.eventKinds().length);
      await tapLabel('record its voice');
      await waitMode('micLive', 20000);
      const saidWho = await page.evaluate(
        () => document.querySelector('.record-panel .live')?.textContent ?? '',
      );
      await sleep(1400);
      await tapText('.stage-cta button', 'done');
      await waitMode('idle', 25000);
      await sleep(600);
      const kinds = await page.evaluate((n) => window.__bits.eventKinds().slice(n), before);
      check(
        'a-puppet-can-have-its-own-voice',
        kinds.join(',') === 'VOICE',
        kinds.join(',') || 'nothing',
      );
      check(
        'a-voice-take-says-whose-it-is',
        /lines/.test(saidWho),
        saidWho.slice(0, 40) || 'nothing said',
      );

      // And it can be handed back to the bit.
      await tapStage(home.x, home.y);
      await sleep(300);
      await tapLabel('more');
      await sleep(400);
      const beforeDrop = await page.evaluate(() => window.__bits.eventKinds().length);
      await tapLabel('back to the bit');
      await sleep(400);
      const dropped = await page.evaluate((n) => window.__bits.eventKinds().slice(n), beforeDrop);
      const undo = await page.$('.toast-action');
      check(
        'a-voice-can-be-handed-back-to-the-bit',
        dropped.join(',') === 'REMOVE' && !!undo,
        `${dropped.join(',')}, undo=${!!undo}`,
      );
      if (undo) await undo.tap();
      await sleep(400);
      await closeTools();
      await sleep(250);
    });

    await phase('the-mode-menu-is-gone', async () => {
      const kit = await page.$('.kit');
      check('the-mode-menu-is-gone', !kit, kit ? 'the kit is still here' : 'no kit');
    });

    await phase('the-foley-row-fits', async () => {
      await tapLabel('record a pass');
      await waitMode('recording', 20000);
      await sleep(300);
      const foley = await page.evaluate(() => {
        const row = document.querySelector('.foleyrow');
        if (!row) return null;
        const r = row.getBoundingClientRect();
        const pills = Array.from(row.querySelectorAll('button'));
        const clipped = pills.filter((p) => {
          const b = p.getBoundingClientRect();
          return b.left < r.left - 1 || b.right > r.right + 1 || b.right > innerWidth + 1;
        });
        const stage = document.querySelector('.stagebox')?.getBoundingClientRect();
        const overStage = stage
          ? Math.max(0, Math.min(stage.bottom, r.bottom) - Math.max(stage.top, r.top))
          : 0;
        return { total: pills.length, clipped: clipped.length, overStage: Math.round(overStage) };
      });
      if (await page.$('.dock-stop')) await tapLabel('stop');
      await sleep(400);
      check(
        'the-foley-row-fits',
        !!foley && foley.clipped === 0 && foley.overStage === 0,
        foley ? `${foley.clipped}/${foley.total} clipped, ${foley.overStage}px over the stage` : 'no row',
      );
      measure(
        'Foley pills clipped at 390px',
        foley ? `${foley.clipped} of ${foley.total}` : 'no row',
      );
    });

    await phase('playback-does-not-rerender-every-frame', async () => {
      await page.evaluate(() => window.__bits.resetCommits());
      await tapLabel('play');
      await sleep(2000);
      const commits = await page.evaluate(() => window.__bits.commits());
      const clock = await page.$eval('.timeline .times span', (e) => (e.textContent ?? '').trim());
      const fill = await page.$eval('.timeline .fill', (e) => e.style.width);
      if (await page.$('.dock-stop')) await tapLabel('stop');
      check('playback-does-not-rerender-every-frame', commits <= 4, `${commits} commits in 2s`);
      // Painting through refs must not mean painting nothing.
      check(
        'the-clock-still-moves-during-playback',
        clock !== '0:00' && fill !== '' && fill !== '0%',
        `clock ${clock}, fill ${fill}`,
      );
    });
  }

  // A forgotten mic used to record until the phone filled up, and there
  // was no way to abandon a take once it had started.
  await phase('a-take-stops-at-the-cap-and-can-be-thrown-away', async () => {
    await goToList();
    await tapText('.transport button', '+ new bit');
    await sleep(600);
    await page.evaluate(() => window.__bits.setOverride('maxRecordSeconds', 3));
    await tapText('.stage-cta button', '⏺ record the bit', 'record the bit');
    await waitMode('micLive');
    await tapText('.stage-cta button', 'throw it away');
    await sleep(600);
    const afterCancel = await page.evaluate(() => ({
      audio: window.__bits.project()?.audio ?? null,
      live: !!document.querySelector('.record-panel'),
    }));
    check(
      'a-take-can-be-thrown-away',
      !afterCancel.audio && !afterCancel.live,
      `audio=${JSON.stringify(afterCancel.audio)} live=${afterCancel.live}`,
    );

    await tapText('.stage-cta button', '⏺ record the bit', 'record the bit');
    await waitMode('micLive');
    await waitMode('idle', 20000);
    const dur = await page.evaluate(() => window.__bits.project()?.audio?.durationS ?? 0);
    check('a-take-stops-at-the-cap', dur > 1 && dur < 6, `${dur.toFixed(2)}s against a 3s cap`);
  });

  // Sound used to be an invisible asset with two buttons in the mode menu.
  await phase('the-sound-can-be-trimmed', async () => {
    const before = await page.evaluate(() => window.__bits.project()?.audio?.durationS ?? 0);
    if (before <= 0) throw new Error('no sound to trim');
    await tapLabel('this bit');
    await sleep(350);
    await tapLabel('the sound');
    await sleep(400);
    const handle = await page.$('[aria-label="where the sound ends"]');
    if (!handle) throw new Error('no trim handle');
    const box = await handle.boundingBox();
    const track = await page.$eval('.trim-track', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, w: r.width };
    });
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 1; i <= 5; i++) {
      await page.touchscreen.touchMove(track.x + track.w * (1 - 0.06 * i), box.y + box.height / 2);
      await sleep(40);
    }
    await page.touchscreen.touchEnd();
    await sleep(350);
    await shot('trim');
    const trim = await page.evaluate(() => window.__bits.project()?.audio?.trim ?? null);
    check(
      'the-sound-can-be-trimmed',
      !!trim && trim.to < before - 0.2 && trim.from >= 0,
      trim ? `${trim.from.toFixed(2)}-${trim.to.toFixed(2)} of ${before.toFixed(2)}` : 'no trim',
    );
    // Trimming is metadata: it must not touch what was performed.
    const kinds = await page.evaluate(() => window.__bits.eventKinds());
    check('trimming-appends-no-event', !kinds.includes('TRIM'), kinds.join(',') || 'no events');
    await closeTools();
    await sleep(200);
  });

  // The headline change of M1, proven rather than asserted: a person who
  // will not talk out loud can still start a bit.
  await phase('a-file-becomes-a-bits-sound', async () => {
    await goToList();
    await tapText('.transport button', '+ new bit');
    await sleep(600);
    const wav = makeWav(join(SHOTS, 'import-fixture.wav'));
    const input = await page.$('input[type=file][accept*="audio"]');
    if (!input) throw new Error('no sound file input on the first screen');
    await input.uploadFile(wav);
    await page.waitForFunction(
      () => (window.__bits.project()?.audio?.durationS ?? 0) > 0,
      { timeout: 30000 },
    );
    const dur = await page.evaluate(() => window.__bits.project().audio.durationS);
    await shot('sound-from-file');
    check('a-file-becomes-a-bits-sound', Math.abs(dur - 2) < 0.3, `${dur.toFixed(2)}s`);
  });

  // Deleting used to be one unguarded tap inside the row's own tap area,
  // with the assets purged immediately (audit F6).
  await phase('delete-is-undoable', async () => {
    await goToList();
    const rowsBefore = (await page.$$('.source-row')).length;
    if (rowsBefore === 0) throw new Error('no bits to delete');
    const more = await page.$('.source-row [aria-label^="more for"]');
    if (!more) throw new Error('no row menu');
    await more.tap();
    await sleep(300);
    check('delete-asks-first', !!(await page.$('.sheet')), 'menu sheet opened');
    measure('Confirmation before deleting a bit', 'a menu, then an undo for five seconds');
    await tapText('.sheet button', 'delete');
    await sleep(700);
    const rowsAfter = (await page.$$('.source-row')).length;
    const undo = await page.$('.toast-action');
    if (!undo) throw new Error('no undo offered after delete');
    await undo.tap();
    await sleep(900);
    const rowsRestored = (await page.$$('.source-row')).length;
    check(
      'delete-is-undoable',
      rowsAfter === rowsBefore - 1 && rowsRestored === rowsBefore,
      `${rowsBefore} -> ${rowsAfter} -> ${rowsRestored}`,
    );
  });

  // Three bits called "untitled bit" used to be one bit three times over
  // (audit F35).
  await phase('the-list-tells-bits-apart', async () => {
    await goToList();
    await sleep(900);
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.source-row')).map((r) => ({
        poster: !!r.querySelector('.poster img'),
        summary: (r.querySelector('.size')?.textContent ?? '').trim(),
      })),
    );
    await shot('list');
    check(
      'a-row-says-more-than-its-title',
      rows.length > 0 && rows.every((r) => /pass/.test(r.summary) && /ago|today|yesterday/.test(r.summary)),
      rows.map((r) => r.summary).join(' | ').slice(0, 90),
    );
    check(
      'a-row-carries-a-still-of-the-bit',
      rows.some((r) => r.poster),
      `${rows.filter((r) => r.poster).length}/${rows.length} with a still`,
    );
  });

  // A copy to wreck, with the original left alone. The two share their
  // assets, so deleting one must not empty the other.
  await phase('a-bit-can-be-copied', async () => {
    await goToList();
    const before = (await page.$$('.source-row')).length;
    const more = await page.$('.source-row [aria-label^="more for"]');
    await more.tap();
    await sleep(300);
    await tapText('.sheet button', 'make a copy');
    await sleep(900);
    const rows = await page.$$eval('.source-row .name', (els) => els.map((e) => e.textContent));
    check(
      'a-bit-can-be-copied',
      rows.length === before + 1 && rows.some((t) => /again/.test(t ?? '')),
      `${before} -> ${rows.length}`,
    );

    // Delete the original; the copy must keep its puppets.
    const copyIdx = rows.findIndex((t) => /again/.test(t ?? ''));
    const originalIdx = copyIdx === 0 ? 1 : 0;
    const menus = await page.$$('.source-row [aria-label^="more for"]');
    await menus[originalIdx].tap();
    await sleep(300);
    await tapText('.sheet button', 'delete');
    await sleep(600);
    const undo = await page.$('.toast-action');
    // Let the undo window close so the assets are actually collected.
    await sleep(5400);
    if (undo) {
      // The toast is gone by now; nothing to press.
    }
    await sleep(600);
    const stillDrawn = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.source-row')).find((r) =>
        /again/.test(r.querySelector('.name')?.textContent ?? ''),
      );
      return !!row?.querySelector('.poster img');
    });
    check(
      'a-copy-keeps-its-puppets-when-the-original-goes',
      stillDrawn,
      stillDrawn ? 'copy still draws' : 'copy lost its assets',
    );
  });

  // The share target: a bit file handed to BITS by another app's share
  // sheet. It arrives as a POST, which a worker that bails out on
  // non-GET requests would hand straight back to the network.
  await phase('a-shared-bit-file-opens-as-a-remix', async () => {
    await goToList();
    const posted = await page.evaluate(async () => {
      if (!(await navigator.serviceWorker.ready.catch(() => null))) return 'no worker';
      const recipe = JSON.stringify({
        version: 1,
        id: 'shared-original',
        title: 'a bit from a friend',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        seed: 7,
        events: [],
      });
      const bundle = JSON.stringify({ kind: 'bits-bundle', version: 0, recipe, assets: {} });
      const form = new FormData();
      form.append('bit', new File([bundle], 'shared.bits.json', { type: 'application/json' }));
      const resp = await fetch('inbox', { method: 'POST', body: form, redirect: 'follow' });
      return resp.redirected || resp.url.includes('inbox=1') ? 'redirected' : `no redirect (${resp.status})`;
    });
    check('a-share-is-taken-by-the-worker', posted === 'redirected', String(posted));

    // Now open the app the way the redirect would, and let it collect.
    await page.goto(`${BASE}?e2e${RENDERER}&inbox=1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__bits !== undefined', { timeout: 15000 });
    await sleep(2500);
    await goToList();
    await sleep(700);
    const opened = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.source-row')).map((r) =>
        Array.from(r.querySelectorAll('.name, .size')).map((e) => e.textContent ?? ''),
      ),
    );
    const flat = opened.flat().join(' | ');
    check(
      'a-shared-bit-file-opens-as-a-remix',
      /a bit from a friend/.test(flat) && /after a bit from a friend/.test(flat),
      flat.slice(0, 110),
    );
  });

  // A server's Chromium is not a phone. Throttling it four times over is
  // a rough stand-in for a mid-range one, on the heaviest bit there is:
  // the demo, six puppets and ten passes, with mouths, a warp and a snip.
  await phase('the-frame-loop-holds-up-on-a-slow-phone', async () => {
    await goToList();
    // The heaviest bit in the list, by pass count: names drift as the walk
    // copies and renames things, but the workload is what matters.
    const demoHandle = await page.evaluateHandle(() => {
      let best = null;
      let most = -1;
      for (const r of document.querySelectorAll('.source-row')) {
        const n = Number(/(\d+) pass/.exec(r.querySelector('.size')?.textContent ?? '')?.[1] ?? 0);
        if (n > most) {
          most = n;
          best = r.querySelector('.row-open');
        }
      }
      return most > 0 ? best : null;
    });
    const demo = demoHandle.asElement();
    if (!demo) throw new Error('no bit with passes to open');
    await demo.tap();
    await sleep(1200);

    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(500);
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (window.__framesOn) requestAnimationFrame(tick);
      };
      window.__framesOn = true;
      requestAnimationFrame(tick);
    });
    await tapLabel('play');
    await sleep(4000);
    const frames = await page.evaluate(() => {
      window.__framesOn = false;
      // The first few frames carry the cost of starting audio.
      return window.__frames.slice(5);
    });
    if (await page.$('.dock-stop')) await tapLabel('stop');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    await sleep(400);

    const sorted = [...frames].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 999;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 999;
    const janky = frames.filter((f) => f > 50).length / Math.max(1, frames.length);
    const drawnBy = await page.evaluate(() => document.querySelector('.stagebox canvas')?.dataset.renderer ?? '?');
    measure('Stage renderer', drawnBy);
    check(
      'the-frame-loop-holds-up-on-a-slow-phone',
      // SwiftShader runs GL on the CPU and ignores the throttle; on GL the
      // gate only asks that frames kept coming.
      RENDERER ? frames.length > 30 : frames.length > 60 && median <= 34 && janky <= 0.1,
      `${frames.length} frames, median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, ${Math.round(janky * 100)}% over 50ms`,
    );
    measure(
      'Frame time on the demo at 4x CPU throttle',
      `${median.toFixed(1)}ms median, ${p95.toFixed(1)}ms p95`,
    );
  });

  // A puppet's own take, through the render's own code. The render proof
  // cannot reach this: making a film at all needs an H.264 encoder, and
  // this container's Chromium has none. A mix nobody can hear is a mix
  // nobody has checked.
  await phase('a-voice-take-reaches-the-mix', async () => {
    await page.goto(`${BASE}?e2e${RENDERER}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__bitsE2E !== undefined', { timeout: 20000 });
    const v = await page.evaluate(() => window.__bitsE2E.runVoice());
    check(
      'a-take-is-found-and-decoded',
      v.collected === 1 && Math.abs(v.decodedS - 1.5) < 0.1 && v.envelopeFound,
      `${v.collected} collected, ${v.decodedS.toFixed(2)}s decoded, envelope=${v.envelopeFound}`,
    );
    check(
      'a-take-lands-at-its-own-offset',
      v.at === 2 && v.during > 100 && v.before < 1 && v.after < 1,
      `at ${v.at}s: before ${v.before.toFixed(1)}, during ${v.during.toFixed(1)}, after ${v.after.toFixed(1)}`,
    );
    check(
      'a-takes-gain-is-honoured',
      Math.abs(v.halfGainRatio - 0.5) < 0.02,
      `half gain is ${v.halfGainRatio.toFixed(3)} of full`,
    );
    await page.goto(`${BASE}?e2e${RENDERER}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__bits !== undefined', { timeout: 15000 });
    await sleep(600);
  });

  // `height: 100%` with an aspect-ratio and a max-width looks like "the
  // biggest box of this shape that fits" and is not: when one dimension
  // clamps, the other stays, and the shape comes apart. It came apart
  // twice in perform mode, where a puppet was a different shape on the
  // stage than in the film being performed for it.
  await phase('the-stage-keeps-its-shape-in-any-window', async () => {
    await goToList();
    const withSoundHandle = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('.source-row')).find((r) =>
        /\d:\d\d/.test(r.querySelector('.size')?.textContent ?? ''),
      )?.querySelector('.row-open'),
    );
    const openRow = withSoundHandle.asElement();
    if (!openRow) throw new Error('no bit with sound to open');
    await openRow.tap();
    await sleep(900);
    const shapeIn = async (w, h) => {
      await page.setViewport({
        width: w,
        height: h,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await sleep(400);
      return page.evaluate(() => {
        const r = document.querySelector('.stagebox')?.getBoundingClientRect();
        const area = document.querySelector('.stagearea')?.getBoundingClientRect();
        if (!r || !area) return null;
        return {
          aspect: r.width / r.height,
          fits: r.width <= area.width + 1 && r.height <= area.height + 1,
          // The largest box of that shape that fits touches one bound.
          snug: r.width >= area.width - 1 || r.height >= area.height - 1,
        };
      });
    };
    const windows = [
      ['a tall phone', 390, 844],
      ['a small phone', 375, 667],
      ['a short window', 390, 480],
      ['a squat window', 900, 420],
      ['a square window', 600, 600],
    ];
    const bad = [];
    for (const [name, w, h] of windows) {
      const got = await shapeIn(w, h);
      if (!got || Math.abs(got.aspect - 9 / 16) > 0.005 || !got.fits || !got.snug) {
        bad.push(`${name}: ${got ? `${got.aspect.toFixed(3)} fits=${got.fits} snug=${got.snug}` : 'no stage'}`);
      }
    }
    check(
      'the-stage-keeps-its-shape-in-any-window',
      bad.length === 0,
      bad.join('; ') || `9:16 in all ${windows.length}`,
    );
    await page.emulate(puppeteer.KnownDevices['iPhone 14']);
    await sleep(400);
  });

  // A tall bit in a short landscape window is a postage stamp. A wide bit
  // is what that window is for.
  await phase('landscape-says-turn-the-phone', async () => {
    await goToList();
    // A bit with sound: one without has no timeline to look at, and the
    // list now holds a shared bit that arrived as recipe only.
    const withSound = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('.source-row')).find((r) =>
        /\d:\d\d/.test(r.querySelector('.size')?.textContent ?? ''),
      )?.querySelector('.row-open'),
    );
    const row = withSound.asElement();
    if (!row) throw new Error('no bit with sound to open');
    await row.tap();
    await sleep(900);
    const land = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const port = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const cardShown = () =>
      page.evaluate(() => {
        const card = document.querySelector('.rotate-card');
        return !!card && getComputedStyle(card).display !== 'none';
      });
    await page.setViewport(land);
    await sleep(400);
    await shot('landscape');
    check('landscape-says-turn-the-phone', await cardShown(), 'tall bit in a short window');

    // Make it a wide bit; the card has nothing to say any more.
    await page.setViewport(port);
    await sleep(400);
    await tapLabel('this bit');
    await sleep(350);
    await tapText('.sheet-row .segment', 'wide');
    await sleep(300);
    await (await page.$('.sheet [aria-label="close"]')).tap();
    await sleep(300);
    await page.setViewport(land);
    await sleep(500);
    await shot('landscape-wide');
    const wideOk = await page.evaluate(() => {
      const r = document.querySelector('.stagebox')?.getBoundingClientRect();
      return r ? r.width / r.height : 0;
    });
    check(
      'a-wide-bit-keeps-the-landscape-window',
      !(await cardShown()) && Math.abs(wideOk - 16 / 9) < 0.05,
      `card=${await cardShown()}, aspect ${wideOk.toFixed(2)}`,
    );
    check(
      'the-shape-is-in-the-recipe',
      (await page.evaluate(() => window.__bits.project()?.aspect)) === '16:9',
      String(await page.evaluate(() => window.__bits.project()?.aspect)),
    );
    await page.setViewport(port);
    await sleep(400);
    await tapLabel('this bit');
    await sleep(350);
    await tapText('.sheet-row .segment', 'tall');
    await sleep(250);
    await (await page.$('.sheet [aria-label="close"]')).tap();
    await sleep(250);
  });

  // Keys, for anyone on a laptop or with a keyboard paired to a phone.
  await phase('the-keyboard-can-drive-it', async () => {
    const before = await page.$eval('.timeline .fill', (e) => e.style.width);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await sleep(300);
    const after = await page.$eval('.timeline .fill', (e) => e.style.width);
    check('arrows-scrub', before !== after, `${before} -> ${after}`);
    await page.keyboard.press('Space');
    await sleep(700);
    const playing = !!(await page.$('.dock-stop'));
    await page.keyboard.press('Space');
    await sleep(400);
    check(
      'space-plays-and-stops',
      playing && !(await page.$('.dock-stop')),
      `played=${playing}`,
    );
  });

  // Ready-made puppets, which behave exactly like drawn ones.
  await phase('a-sticker-is-a-puppet', async () => {
    await openTools();
    await tapText('.cast-tile', 'a sticker');
    await sleep(700);
    const last = await page.evaluate(() => {
      const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
      const p = casts[casts.length - 1]?.puppet;
      return p ? { type: p.type, name: p.name, strokes: p.strokes?.length ?? 0 } : null;
    });
    check(
      'a-sticker-is-a-puppet',
      last?.type === 'doodle' && !!last.name && last.strokes > 0,
      JSON.stringify(last),
    );
    await closeTools();
  });

  // A backdrop is a sheet like any other (studio S1): it can be cut and
  // wired. It is picked up by a long press on bare stage, so an ordinary
  // drag on "nothing" never moves the scenery, and a quick tap puts it
  // down. These run in a fresh tab: late in the walk, after the window has
  // been resized and the page reloaded, the original tab stops receiving
  // synthetic touches at all (even puppeteer's own element taps), for
  // reasons in the test harness rather than the app.
  {
    const tab = await browser.newPage();
    await tab.emulate(puppeteer.KnownDevices['iPhone 14']);
    tab.on('pageerror', (err) => pageErrors.push(err.message));
    const box = () =>
      tab.$eval('.stagebox', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
    const finger = async (path, { holdMs = 0, stepMs = 60 } = {}) => {
      const b = await box();
      const at = ([fx, fy]) => [b.x + fx * b.w, b.y + fy * b.h];
      await tab.touchscreen.touchStart(...at(path[0]));
      if (holdMs) await sleep(holdMs);
      for (const pt of path.slice(1)) {
        await tab.touchscreen.touchMove(...at(pt));
        await sleep(stepMs);
      }
      await tab.touchscreen.touchEnd();
    };
    const label = async (name) => {
      let h = await tab.$(`[aria-label="${name}"]`);
      // A pill's text is its name.
      if (!h) {
        const byText = await tab.evaluateHandle(
          (n) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === n),
          name,
        );
        h = byText.asElement();
      }
      if (!h) throw new Error(`no control labelled "${name}"`);
      await h.tap();
    };
    const kindsNow = () => tab.evaluate(() => window.__bits.eventKinds().length);
    const kindsSince = (n) => tab.evaluate((k) => window.__bits.eventKinds().slice(k), n);
    const selected = () => tab.evaluate(() => window.__bits.selectedId());
    const tabShot = (name) => {
      shotN += 1;
      return tab.screenshot({ path: join(SHOTS, `${String(shotN).padStart(2, '0')}-${name}.png`) });
    };
    try {
      await tab.goto(`${BASE}?e2e${RENDERER}`, { waitUntil: 'networkidle0' });
      await sleep(800);
      const withSound = await tab.evaluateHandle(() =>
        Array.from(document.querySelectorAll('.source-row')).find((r) =>
          /\d:\d\d/.test(r.querySelector('.size')?.textContent ?? ''),
        )?.querySelector('.row-open'),
      );
      const row = withSound.asElement();
      if (!row) throw new Error('no bit with sound to open');
      await row.tap();
      await tab.waitForFunction(() => window.__bits?.project?.(), { timeout: 20000 });
      await sleep(1200);

      await phase('a-backdrop-can-be-snipped', async () => {
        const png = makePng(join(SHOTS, 'backdrop-fixture.png'), 96);
        const input = await tab.$('input[data-pick="backdrop"]');
        if (!input) throw new Error('no backdrop input');
        const casts = await tab.evaluate(
          () => window.__bits.project().events.filter((e) => e.kind === 'CAST').length,
        );
        await input.uploadFile(png);
        await tab.waitForFunction(
          (n) => window.__bits.project().events.filter((e) => e.kind === 'CAST').length > n,
          { timeout: 20000 },
          casts,
        );
        await sleep(500);
        const fresh = await tab.$('[aria-label="replace the backdrop"]');
        check('a-new-backdrop-arrives-selected', !!fresh, fresh ? 'backdrop tools shown' : 'no backdrop tools');
        // It covers the stage, so a quick tap on it is how it goes back down.
        await finger([[0.6, 0.3]]);
        await sleep(400);
        check('a-tap-puts-the-backdrop-down', (await selected()) === null, `selected ${await selected()}`);
        // And a long press on open stage picks it up again.
        await finger([[0.6, 0.3]], { holdMs: 800 });
        await sleep(400);
        await tabShot('backdrop-picked');
        const picked = await tab.$('[aria-label="replace the backdrop"]');
        check('a-long-press-picks-up-the-backdrop', !!picked, picked ? 'backdrop tools shown' : `selected ${await selected()}`);
        const before = await kindsNow();
        await label('snip');
        await tab.waitForFunction(() => document.querySelector('.stagebox')?.classList.contains('mode-snipping'), { timeout: 5000 });
        await finger([
          [0.1, 0.42],
          [0.4, 0.43],
          [0.7, 0.45],
          [0.9, 0.46],
        ]);
        await sleep(500);
        await tabShot('backdrop-snipped');
        const kinds = await kindsSince(before);
        check('a-backdrop-can-be-snipped', kinds.join(',') === 'SNIP', kinds.join(',') || 'nothing');
      });

      // The cut just made can fold instead of swing, and back again.
      await phase('a-cut-can-fold', async () => {
        if (!(await tab.$('[aria-label="replace the backdrop"]'))) throw new Error('the backdrop is not selected');
        await label('more');
        await sleep(350);
        const pick = async (text) => {
          const h = await tab.evaluateHandle(
            (t) =>
              Array.from(document.querySelectorAll('[aria-label="how cut 1 moves"] button')).find(
                (b) => b.textContent?.trim() === t,
              ),
            text,
          );
          if (!h.asElement()) throw new Error(`no "${text}" for the cut`);
          await h.asElement().evaluate((e) => e.scrollIntoView({ block: 'center' }));
          await h.asElement().tap();
        };
        const before = await kindsNow();
        await pick('folded over');
        await sleep(400);
        await label('close');
        await sleep(400);
        await tabShot('a-cut-folded-over');
        const angle = await tab.evaluate(() => window.__bits.project().events.filter((e) => e.kind === 'FOLD').pop()?.angle);
        // Back to a swinging cut: the later phases expect the whole backdrop.
        await label('more');
        await sleep(350);
        await pick('swings');
        await sleep(300);
        await label('close');
        await sleep(300);
        const kinds = await kindsSince(before);
        check('a-cut-can-fold', kinds.join(',') === 'FOLD,FOLD' && angle > 3, `${kinds.join(',') || 'nothing'}, angle ${angle}`);
      });

      await phase('a-backdrop-can-be-wired', async () => {
        if (!(await tab.$('[aria-label="replace the backdrop"]'))) throw new Error('the backdrop is not selected');
        await label('more');
        await sleep(350);
        for (const h of await tab.$$('.sheet button')) {
          if ((await h.evaluate((e) => (e.textContent || '').trim())) === 'wires') {
            await h.tap();
            break;
          }
        }
        await sleep(300);
        const before = await kindsNow();
        // The Wires room: the bass row's "size" chip plugs bass into it.
        const chip = await tab.$('[aria-label="bass drives size"]');
        if (!chip) throw new Error('no bass → size chip');
        await chip.tap();
        await sleep(300);
        await tabShot('wires-room');
        const kinds = await kindsSince(before);
        const wire = await tab.evaluate(() => {
          const w = window.__bits.project().events.filter((e) => e.kind === 'WIRE').pop();
          return w ? `${w.from}>${w.to}@${w.amount}` : 'none';
        });
        check('a-backdrop-can-be-wired', kinds.join(',') === 'WIRE', kinds.join(',') || 'nothing');
        check('bass-makes-the-sky-pulse', wire === 'band:bass>scale@0.5', wire);
        // Shaping it is one more event; pulling it out is undoable.
        const smooth = await tab.$('[aria-label="smooth"]');
        if (!smooth) throw new Error('no smooth control');
        await smooth.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await sleep(200);
        const box = await smooth.boundingBox();
        await tab.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2);
        await sleep(300);
        const shaped = await tab.evaluate(() => {
          const w = window.__bits.project().events.filter((e) => e.kind === 'WIRE').pop();
          return w?.smooth ?? 0;
        });
        check('a-wire-can-be-smoothed', shaped > 0, `smooth ${shaped}`);
        await label('close');
        await sleep(300);
        await label('more');
        await sleep(300);
      });

      // Depth is free at rest: pushing the backdrop back records a CAST
      // and moves nothing until the camera does.
      await phase('a-sheet-can-be-pushed-back', async () => {
        const before = await kindsNow();
        const far = await tab.evaluateHandle(() =>
          Array.from(document.querySelectorAll('[aria-label="how far back it sits"] button')).find(
            (b) => b.textContent?.trim() === 'far',
          ),
        );
        if (!far.asElement()) throw new Error('no depth control');
        await far.asElement().tap();
        await sleep(300);
        await tabShot('pushed-back');
        const kinds = await kindsSince(before);
        const depth = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
          return casts[casts.length - 1]?.depth ?? 0;
        });
        check('a-sheet-can-be-pushed-back', kinds.join(',') === 'CAST' && depth === 3, `${kinds.join(',') || 'nothing'} at depth ${depth}`);
        await label('close');
        await sleep(300);
      });

      // The camera is one more thing to perform: pick it up, record, and a
      // single finger dragged across the stage is a camera pass.
      await phase('a-camera-pass-is-one-finger', async () => {
        await label('pick up the camera');
        await sleep(300);
        const before = await kindsNow();
        await label('record a pass');
        await tab.waitForFunction(
          () => document.querySelector('.stagebox')?.classList.contains('mode-recording'),
          { timeout: 10000 },
        );
        await sleep(300);
        await finger(
          [
            [0.5, 0.5],
            [0.45, 0.5],
            [0.38, 0.52],
            [0.3, 0.52],
            [0.25, 0.5],
          ],
          { stepMs: 120 },
        );
        await sleep(300);
        await tabShot('camera-pass');
        await label('stop');
        await sleep(500);
        const passes = await tab.evaluate((k) =>
          window.__bits
            .project()
            .events.slice(k)
            .filter((e) => e.kind === 'PASS')
            .map((e) => `${e.puppetId}${e.prop ? `.${e.prop}` : ''}`),
          before,
        );
        check('a-camera-pass-is-one-finger', passes.join(',') === '@camera', passes.join(',') || 'no pass');
        await label('put the camera down');
      });

      // A segmented control's option by its text, inside a labelled group.
      const option = async (group, text) => {
        const h = await tab.evaluateHandle(
          (g, t) =>
            Array.from(document.querySelectorAll(`[aria-label="${g}"] button`)).find(
              (b) => b.textContent?.trim() === t,
            ),
          group,
          text,
        );
        if (!h.asElement()) throw new Error(`no "${text}" in ${group}`);
        await h.asElement().tap();
      };
      const recordCameraTake = async (during) => {
        await label('pick up the camera');
        await sleep(300);
        await label('record a pass');
        await tab.waitForFunction(
          () => document.querySelector('.stagebox')?.classList.contains('mode-recording'),
          { timeout: 10000 },
        );
        await sleep(300);
        await during();
        await label('stop');
        await sleep(500);
        await label('put the camera down');
        await sleep(200);
      };

      await phase('shadows-and-fog-from-the-menu', async () => {
        await label('this bit');
        await sleep(350);
        const before = await kindsNow();
        await option('paper shadows', 'deep');
        await sleep(200);
        await option('fog with distance', 'haze');
        await sleep(200);
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(400);
        await tabShot('shadows-and-fog');
        check('shadows-and-fog-from-the-menu', kinds.join(',') === 'LOOK,LOOK', kinds.join(',') || 'nothing');
      });

      // The stage has its own room: a slow wave patched into the camera
      // makes it drift by itself.
      await phase('the-stage-wires-move-the-camera', async () => {
        await label('this bit');
        await sleep(350);
        await label('stage wires');
        await sleep(350);
        const before = await kindsNow();
        const chip = await tab.$('[aria-label="slow wave drives camera sideways"]');
        if (!chip) throw new Error('no slow wave → camera chip');
        await chip.tap();
        await sleep(300);
        const kinds = await kindsSince(before);
        check('the-stage-wires-move-the-camera', kinds.join(',') === 'WIRE', kinds.join(',') || 'nothing');
        // And out again: a drifting camera would move the later phases'
        // targets about.
        await label('pull it out');
        await sleep(300);
        const unplugged = await tab.evaluate(() => {
          const w = window.__bits.project().events.filter((e) => e.kind === 'WIRE').pop();
          return w ? w.amount : -1;
        });
        const toast = await tab.evaluate(() => document.body.textContent?.includes('pulled that wire out') ?? false);
        check('a-wire-pulled-out-can-be-undone', unplugged === 0 && toast, `amount ${unplugged}, toast ${toast}`);
        await label('close');
        await sleep(300);
      });

      await phase('a-cut-snaps-the-camera', async () => {
        const before = await kindsNow();
        await recordCameraTake(async () => {
          await finger([[0.5, 0.5], [0.4, 0.5], [0.3, 0.5]], { stepMs: 120 });
          await sleep(200);
          await label('cut');
          await sleep(200);
        });
        const kinds = await kindsSince(before);
        check('a-cut-snaps-the-camera', kinds.includes('CUT') && kinds.includes('PASS'), kinds.join(',') || 'nothing');
      });

      await phase('a-tilt-is-a-camera-pass', async () => {
        const cdp = await tab.createCDPSession();
        await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: 0, gamma: 0 });
        const before = await tab.evaluate(() => window.__bits.project().events.length);
        await recordCameraTake(async () => {
          await label('tilt');
          await sleep(200);
          for (let g = 0; g <= 24; g += 4) {
            await cdp.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: g / 2, gamma: g });
            await sleep(120);
          }
          await sleep(200);
        });
        await cdp.send('DeviceOrientation.clearDeviceOrientationOverride');
        const passes = await tab.evaluate(
          (k) =>
            window.__bits
              .project()
              .events.slice(k)
              .filter((e) => e.kind === 'PASS')
              .map((e) => `${e.puppetId}${e.via ? `/${e.via}` : ''}`),
          before,
        );
        check('a-tilt-is-a-camera-pass', passes.join(',') === '@camera/gyro', passes.join(',') || 'no pass');
      });

      await phase('depth-in-the-director-view', async () => {
        // The backdrop is the sheet that is always there: pick it up, and
        // open the side view from its own panel.
        await finger([[0.6, 0.3]], { holdMs: 800 });
        await sleep(400);
        await tabShot('director-long-press');
        await label('more');
        await sleep(350);
        for (const h of await tab.$$('.sheet button')) {
          if ((await h.evaluate((e) => (e.textContent || '').trim())) === 'see the stage from the side') {
            await h.tap();
            break;
          }
        }
        await sleep(400);
        const dot = await tab.$('.director-dot:not(.back)');
        if (!dot) throw new Error('no sheet in the side view');
        const r = await dot.boundingBox();
        const before = await kindsNow();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        await tab.touchscreen.touchStart(cx, cy);
        for (let i = 1; i <= 5; i++) {
          await tab.touchscreen.touchMove(cx, cy - i * 12);
          await sleep(60);
        }
        await tab.touchscreen.touchEnd();
        await sleep(400);
        await tabShot('director-view');
        const kinds = await kindsSince(before);
        const depth = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
          return casts[casts.length - 1]?.depth ?? 0;
        });
        check('depth-in-the-director-view', kinds.join(',') === 'CAST' && depth > 0, `${kinds.join(',') || 'nothing'} at depth ${depth}`);
      });

      // Ink: grow one from the cast sheet, breed it once, keep it as a new
      // sheet; then dress that sheet in a child of its own ink.
      await phase('grow-an-ink-and-keep-it', async () => {
        if (await tab.$('[aria-label="close the side view"]')) await label('close the side view');
        await label('cast someone');
        await sleep(400);
        const tile = await tab.evaluateHandle(() =>
          Array.from(document.querySelectorAll('.sheet button')).find((b) =>
            (b.textContent || '').includes('grow an ink'),
          ),
        );
        if (!tile.asElement()) throw new Error('no ink tile in the cast sheet');
        await tile.asElement().tap();
        await sleep(600);
        const tiles = await tab.$$('.ink-tile');
        if (tiles.length !== 6) throw new Error(`${tiles.length} ink tiles`);
        await tiles[3].tap();
        await sleep(500);
        await tabShot('ink-tray');
        const before = await kindsNow();
        await label('a new sheet');
        await sleep(600);
        const cast = await tab.evaluate((k) => {
          const e = window.__bits.project().events.slice(k).find((x) => x.kind === 'CAST');
          return e ? e.puppet.type : 'none';
        }, before);
        check('grow-an-ink-and-keep-it', cast === 'ink', `cast ${cast}`);
      });

      await phase('dress-a-sheet-in-ink', async () => {
        await label('more');
        await sleep(350);
        await label('dress it in an ink');
        await sleep(600);
        const before = await kindsNow();
        await label('keep it');
        await sleep(600);
        await tabShot('inked');
        const kinds = await kindsSince(before);
        check('dress-a-sheet-in-ink', kinds.join(',') === 'INK', kinds.join(',') || 'nothing');
      });

      // Print: a palette and a paper from the show menu.
      await phase('a-palette-and-paper-from-the-menu', async () => {
        await label('this bit');
        await sleep(350);
        const before = await kindsNow();
        await label('tropic');
        await sleep(250);
        await option('what it is printed on', 'newsprint');
        await sleep(250);
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(500);
        await tabShot('printed');
        check('a-palette-and-paper-from-the-menu', kinds.join(',') === 'LOOK,LOOK', kinds.join(',') || 'nothing');
      });

      // Motion style: the ink sheet on twos.
      await phase('a-sheet-on-twos', async () => {
        await label('more');
        await sleep(350);
        const before = await kindsNow();
        await option('how floppy it is', 'on twos');
        await sleep(300);
        const spring = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
          return casts[casts.length - 1]?.puppet.spring ?? 'none';
        });
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(300);
        check('a-sheet-on-twos', kinds.join(',') === 'CAST' && spring === 'twos', `${kinds.join(',')} ${spring}`);
      });

      // A clip from the camera roll becomes a sheet that plays in time.
      await phase('a-video-becomes-a-sheet', async () => {
        const before = await tab.evaluate(() => window.__bits.project().events.length);
        const fed = await tab.evaluate(() => window.__bitsE2E.pickVideo());
        if (!fed) throw new Error('no video picker');
        await tab.waitForFunction(
          (n) => window.__bits.project().events.slice(n).some((e) => e.kind === 'CAST' && e.puppet.type === 'video'),
          { timeout: 20000 },
          before,
        );
        await sleep(800);
        await label('play');
        await sleep(1500);
        await tabShot('video-sheet');
        if (await tab.$('.dock-stop')) await label('stop');
        await sleep(300);
        const spec = await tab.evaluate((n) => {
          const e = window.__bits.project().events.slice(n).find((x) => x.kind === 'CAST' && x.puppet.type === 'video');
          return e ? e.puppet : null;
        }, before);
        check('a-video-becomes-a-sheet', !!spec && spec.durationS > 1.4 && spec.durationS < 1.6, spec ? `${spec.durationS.toFixed(2)}s` : 'no clip');
      });

      // Reading it: the real models, offline, with progress; then it can
      // show just the person.
      await phase('a-clip-can-be-read-and-masked', async () => {
        await label('more');
        await sleep(350);
        const read = await tab.evaluateHandle(() =>
          Array.from(document.querySelectorAll('.sheet button')).find((b) =>
            (b.textContent || '').startsWith('read the clip'),
          ),
        );
        if (!read.asElement()) throw new Error('no read button');
        await read.asElement().tap();
        await tab.waitForFunction(
          () => {
            const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST' && e.puppet.type === 'video');
            return !!casts[casts.length - 1]?.puppet.analysisId;
          },
          { timeout: 60000 },
        );
        await sleep(500);
        const before = await kindsNow();
        await option('what of the clip shows', 'the person');
        await sleep(400);
        const masked = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST' && e.puppet.type === 'video');
          return casts[casts.length - 1]?.puppet.masked === true;
        });
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(300);
        check('a-clip-can-be-read-and-masked', masked && kinds.join(',') === 'CAST', `${kinds.join(',')} masked ${masked}`);
      });

      // Kits: the clip rides another sheet, then lets go.
      await phase('a-sheet-rides-another', async () => {
        // The clip is the one to ride. The read before this can leave it
        // put down, so pick it up again rather than trust it is held.
        const clipId = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST' && e.puppet.type === 'video');
          return casts[casts.length - 1]?.puppetId ?? null;
        });
        if (!clipId) throw new Error('no clip on the stage');
        for (let i = 0; i < 3 && (await selected()) !== clipId; i++) {
          const at = await tab.evaluate((id) => window.__bits.poses()[id] ?? null, clipId);
          if (!at) throw new Error('the clip has no pose');
          await finger([[at.x, at.y]]);
          await sleep(500);
        }
        await tab.waitForSelector('[aria-label="more"]', { timeout: 5000 });
        await label('more');
        await sleep(350);
        const pill = await tab.evaluateHandle(() => {
          const row = Array.from(document.querySelectorAll('.sheet .sheet-row')).find((r) =>
            (r.textContent || '').startsWith('rides on'),
          );
          return row?.querySelector('button.pill') ?? null;
        });
        if (!pill.asElement()) throw new Error('nothing to ride');
        const before = await kindsNow();
        await pill.asElement().tap();
        await sleep(400);
        const attach = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
          return casts[casts.length - 1]?.attach ?? null;
        });
        await label('let go');
        await sleep(400);
        const free = await tab.evaluate(() => {
          const casts = window.__bits.project().events.filter((e) => e.kind === 'CAST');
          return !casts[casts.length - 1]?.attach;
        });
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(300);
        check('a-sheet-rides-another', !!attach && free && kinds.join(',') === 'CAST,CAST', `${kinds.join(',')} rode ${attach?.to ?? 'nothing'}, free ${free}`);
      });

      // A selfie kit from a photo with no person in it: one piece, said so.
      await phase('a-kit-without-a-person-is-one-piece', async () => {
        const png = makePng(join(SHOTS, 'kit-fixture.png'), 96);
        const input = await tab.$('input[data-pick="kit"]');
        if (!input) throw new Error('no kit input');
        const before = await tab.evaluate(() => window.__bits.project().events.length);
        await input.uploadFile(png);
        await tab.waitForFunction(
          (n) => window.__bits.project().events.slice(n).some((e) => e.kind === 'CAST'),
          { timeout: 30000 },
          before,
        );
        await sleep(400);
        const casts = await tab.evaluate(
          (n) => window.__bits.project().events.slice(n).filter((e) => e.kind === 'CAST').map((e) => e.puppet.type),
          before,
        );
        check('a-kit-without-a-person-is-one-piece', casts.join(',') === 'cutout', casts.join(',') || 'nothing');
      });

      // Shots: a cut dropped at the playhead from the shots room, reframed,
      // then taken out again with an undo on offer.
      await phase('shots-are-cards-to-frame-and-time', async () => {
        const bar = await tab.evaluate(() => {
          const r = document.querySelector('.timeline .seek')?.getBoundingClientRect();
          return r ? { x: r.left + r.width * 0.72, y: r.top + r.height / 2 } : null;
        });
        if (!bar) throw new Error('no timeline');
        await tab.touchscreen.tap(bar.x, bar.y);
        await sleep(300);
        await label('this bit');
        await sleep(350);
        await label('shots');
        await sleep(300);
        // Every card gets a still of how its shot opens.
        await tab.waitForFunction(
          () => {
            const cards = document.querySelectorAll('.shot-card');
            return cards.length > 0 && document.querySelectorAll('.shot-card img').length === cards.length;
          },
          { timeout: 15000 },
        );
        const cardsBefore = await tab.evaluate(() => document.querySelectorAll('.shot-card').length);
        const before = await kindsNow();
        const cutHere = await tab.evaluateHandle(() =>
          Array.from(document.querySelectorAll('.sheet button')).find((b) => b.textContent?.startsWith('cut here,')),
        );
        if (!cutHere.asElement()) throw new Error('no cut here');
        await cutHere.asElement().tap();
        await sleep(400);
        const cardsAfter = await tab.evaluate(() => document.querySelectorAll('.shot-card').length);
        // Reframe the new shot with any framing it does not have.
        const other = await tab.$('.shot-framings button[aria-pressed="false"]');
        if (!other) throw new Error('no other framing');
        await other.tap();
        await sleep(400);
        await tabShot('shots-room');
        await label('take the cut out');
        await sleep(400);
        const toast = await tab.evaluate(() => document.body.textContent?.includes('took that cut out') ?? false);
        const kinds = await kindsSince(before);
        await label('close');
        await sleep(300);
        check(
          'shots-are-cards-to-frame-and-time',
          cardsAfter === cardsBefore + 1 && kinds.join(',') === 'CUT,REMOVE,CUT,REMOVE' && toast,
          `${cardsBefore}→${cardsAfter} cards, ${kinds.join(',') || 'nothing'}, toast ${toast}`,
        );
      });
    } finally {
      await tab.close();
    }
  }

  // The audit's table, re-taken. Written as markdown so it can go
  // straight into docs/ux-audit/README.md rather than being retyped.
  const measPath = join(SHOTS, 'measurements.md');
  writeFileSync(
    measPath,
    ['| Measurement | Value |', '|---|---|', ...measures.map(([k, v]) => `| ${k} | ${v} |`)].join(
      '\n',
    ) + '\n',
  );
  console.log(`\n${measures.map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`);

  // The golden: recorded before the stage was split, compared after.
  const tracePath = join(SHOTS, 'events.json');
  writeFileSync(tracePath, JSON.stringify(trace, null, 2));
  const goldenPath = join(process.cwd(), 'tools', 'e2e', 'golden-events.json');
  if (process.env.UX_RECORD_GOLDEN) {
    writeFileSync(goldenPath, JSON.stringify(trace, null, 2));
    console.log(`recorded ${trace.length} phases to ${goldenPath}`);
  } else if (existsSync(goldenPath)) {
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
    const want = new Map(golden);
    const diffs = [];
    for (const [id, kinds] of trace) {
      if (!want.has(id)) continue;
      if (want.get(id) !== kinds) diffs.push(id);
    }
    const missing = golden.filter(([id]) => !trace.some(([t]) => t === id)).map(([id]) => id);
    check(
      'the-recipe-a-walkthrough-builds-is-unchanged',
      diffs.length === 0 && missing.length === 0,
      [...diffs.map((d) => `${d} differs`), ...missing.map((m) => `${m} missing`)]
        .join('; ')
        .slice(0, 160),
    );
  }

  check('no-system-dialog-appeared', dialogs.length === 0, dialogs.join(' | '));
  check('no-page-errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  // A dead end is: the stage gone, or an error still standing on it.
  const deadEnd = await page.evaluate(() => ({
    stage: !!document.querySelector('.stagebox') || !!document.querySelector('.source-list, .empty'),
    error: document.querySelector('.banner-error')?.textContent ?? '',
  }));
  check('no-dead-end', deadEnd.stage && !deadEnd.error, deadEnd.error || 'stage intact');
} catch (err) {
  check('the-walkthrough-ran', false, String(err && err.message ? err.message : err));
} finally {
  await browser?.close();
  preview.kill();
}

const hard = results.filter((r) => !r.ok && !GAPS[r.id]);
const closed = results.filter((r) => r.ok && GAPS[r.id]);
const open = results.filter((r) => !r.ok && GAPS[r.id]);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks pass`);
if (open.length) {
  console.log(`${open.length} known gap(s) still open:`);
  for (const r of open) console.log(`  ${r.id} -> ${GAPS[r.id]}`);
}
if (closed.length) {
  console.log(`\n${closed.length} declared gap(s) now PASS; remove from GAPS in this file:`);
  for (const r of closed) console.log(`  ${r.id}`);
}
if (hard.length) {
  console.error(`\n${hard.length} failure(s)`);
  process.exit(1);
}
console.log('\nux walk passed');
