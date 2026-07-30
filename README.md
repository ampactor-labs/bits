# BITS

A puppet-show instrument for phones. You don't animate a scene with timelines and keyframes; you put on the show. Record the bit first (the voices, the argument, the dumb song), cast puppets from photos of yourselves or finger doodles, then perform in passes like a musician overdubs tracks: hit record, drag one puppet while the audio and every earlier pass play back, stop, layer the next one. Spring physics is the inbetweener: you supply intent, the simulation supplies lag, lean, squash, and settle. Doodles boil (three seeded jitter variants) so a single drawing never sits still.

Everything lands in an append-only recipe; the same recipe simulates to the same frames, so preview and render agree exactly. Everything runs on-device in the browser: WebCodecs for encode/decode, Mediabunny for containers, MediaPipe segmentation for photo cutouts (with a whole-frame fallback), OPFS for storage. No uploads, no accounts, no generated pixels.

## Status

The show slice is live: record the bit, cast from camera roll or doodle, record passes, undo a pass, render to a portrait mp4 with the audio passed through, share. The earlier clip deck (perform cuts over footage) survives under "clips"; its engine (onset grid, program compiler, render pipeline) is what the show is built on. Next organs, in rough order: pinned spring limbs, loudness-driven mouth flaps, loop scenes that chain, and cutouts of arbitrary objects.

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
