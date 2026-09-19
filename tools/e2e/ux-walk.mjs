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
import { mkdirSync, writeFileSync } from 'node:fs';
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
  /** A phase that cannot take the rest of the run down with it. */
  const phase = async (id, fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      check(id, false, String(err && err.message ? err.message : err).slice(0, 120));
      await shot(`failed-${id}`).catch(() => {});
      return false;
    }
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
        await h.tap();
        return true;
      }
    }
    throw new Error(`no ${sel} reading ${texts.map((t) => `"${t}"`).join(' or ')}`);
  };
  const tapLabel = async (label) => {
    const h = await page.$(`[aria-label="${label}"]`);
    if (!h) throw new Error(`no control labelled "${label}"`);
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
    await page.goto(`${BASE}?e2e`, { waitUntil: 'networkidle0' });
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
    check(
      'disabled-controls-look-disabled',
      disabled.opacity === 0 || disabled.opacity <= 0.5,
      `worst ${disabled.opacity} on "${disabled.label.trim()}"`,
    );
    await closeTools();
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
    await sleep(2600);
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

    await phase('the-mode-menu-is-gone', async () => {
      const kit = await page.$('.kit');
      check('the-mode-menu-is-gone', !kit, kit ? 'the kit is still here' : 'no kit');
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

  // A short landscape window would make a 9:16 stage a postage stamp.
  await phase('landscape-says-turn-the-phone', async () => {
    await goToList();
    const rows = await page.$$('.source-row .row-open');
    if (rows.length === 0) throw new Error('no bits to open');
    await rows[0].tap();
    await sleep(800);
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(400);
    await shot('landscape');
    const shown = await page.evaluate(() => {
      const card = document.querySelector('.rotate-card');
      return !!card && getComputedStyle(card).display !== 'none';
    });
    check('landscape-says-turn-the-phone', shown, shown ? 'card shown' : 'stage left squashed');
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(400);
  });

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
