# BITS

A puppet-show instrument for phones. You don't animate a scene with timelines and keyframes; you put on the show. Record the bit first (the voices, the argument, the dumb song), cast puppets from photos of yourselves or finger doodles, then perform in passes like a musician overdubs tracks: hit record, drag one puppet while the audio and every earlier pass play back, stop, layer the next one. Spring physics is the inbetweener: you supply intent, the simulation supplies lag, lean, squash, and settle.

Then the scissors come out. Draw a line across a puppet and it splits where you cut: the far side hangs from the line's midpoint and dangles with the motion, paper-doll style — and you can grab the piece itself in a pass and puppet it directly. Pin a mouth on anything and it flaps with the voice track; once a puppet has passes, it only talks while one of them covers the moment, so holding the talker is how you say who's speaking. Googly eyes lag the motion. Doodles boil. Backdrops drop in from the camera roll or straight from the camera; two fingers resize and rotate anything; long press drops a puppet; the playhead scrubs and passes punch in anywhere.

Everything lands in an append-only recipe with undo and redo; the same recipe simulates to the same frames (bit-exact, fixed-step grid), so preview and render agree, and the preview clock rides the AudioContext so mouths flap on the audio's time. Everything runs on-device in the browser: WebCodecs for encode/decode, Mediabunny for containers, MediaPipe segmentation for photo cutouts (with a whole-frame fallback), OPFS for storage with asset cleanup on delete. No uploads, no accounts, no generated pixels.

## Status

The full instrument is live: bit, cast, snap, snip, mouth, eyes, backdrop, punch-in passes, piece grabs, talker spans, scrub, undo/redo, rename, render under a wake lock, share. Next organs: viseme-grade lip sync (Rhubarb-wasm), perform-with-your-body limb passes (MediaPipe pose), ARAP mesh warp for bendy puppets, and recipe-in-export remixing.

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
