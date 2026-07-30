# BITS

A puppet-show instrument for phones. You don't animate a scene with timelines and keyframes; you put on the show. Record the bit first (the voices, the argument, the dumb song), cast puppets from photos of yourselves or finger doodles, then perform in passes like a musician overdubs tracks: hit record, drag one puppet while the audio and every earlier pass play back, stop, layer the next one. Spring physics is the inbetweener: you supply intent, the simulation supplies lag, lean, squash, and settle.

Then the scissors come out. Draw a line across a puppet and it splits where you cut: the far side hangs from the line's midpoint and dangles with the motion, paper-doll style. Pin a mouth on anything and it flaps with the loudness of the voice track. Doodles boil (three seeded jitter variants) so a single drawing never sits still. Backdrops drop in from the camera roll; two fingers resize and rotate anything; a long press drops a puppet from the cast.

Everything lands in an append-only recipe; the same recipe simulates to the same frames (bit-exact, fixed-step grid), so preview and render agree. Everything runs on-device in the browser: WebCodecs for encode/decode, Mediabunny for containers, MediaPipe segmentation for photo cutouts (with a whole-frame fallback), OPFS for storage. No uploads, no accounts, no generated pixels.

## Status

The full instrument is live: bit, cast, snip, mouth, backdrop, passes, undo, render, share. Next organs: viseme-grade lip sync (Rhubarb-wasm), perform-with-your-body limb passes (MediaPipe pose), ARAP mesh warp for bendy puppets, and recipe-in-export remixing.

## Dev

    npm install
    npm run dev        # serves at /bits/
    npm test           # engine tests (vitest)
    npm run build      # typecheck + production build to dist/
    npm run test:e2e   # headless Chrome: synthesize -> perform -> render -> re-probe
    npm run lint

Deploys to ampactor.dev/bits from main via GitHub Pages (.github/workflows/deploy.yml).

## Layout

    src/engine/    recipe model, program compiler, onsets, puppet springs, show sim
    src/jam/       pointer-gesture state machine (pure, unit-tested)
    src/media/     OPFS + assets, Mediabunny probe/decode, mic, cutouts, renderers
    src/ui/        React chrome: shows, stage, clips library, deck
    src/pwa/       service worker registration
    src/e2e/       in-browser proof harness (?e2e)
    public/sw.js   precache + share-target service worker
    tools/         asset staging, e2e driver, device checklist

One UI rule worth knowing: semantic color pairs are blue vs orange, never red vs green.
