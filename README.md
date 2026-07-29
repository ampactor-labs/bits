# BITS

A video instrument for phones. CapCut is a document editor: footage is text and you sit and revise it. BITS is the other thing: footage plays, your fingers are mapped to moves (tap cuts, hold slows, pinch punches in), and the performance is the edit. Every gesture lands in an append-only recipe; same recipe over same sources renders the same frames, so any export can reopen as the moves that made it.

Built for two people making skits together. Everything runs on-device in the browser: WebCodecs for decode/encode, Mediabunny for containers, OPFS for storage. No uploads, no accounts, no generated pixels.

## Status

Phase 1: the deck is playable. Open a clip, hit roll, and perform: tap cuts (quantized to an onset grid computed from the clip's own audio), hold the left half to skip footage, hold the right half for slow motion, pinch to punch in, double-tap to reset the punch. Rolling from an earlier point truncates what came after, so undo is rewind. Render runs the same compiled program as the preview and hands the mp4 to the share sheet.

The full ten-phase plan (ghosts, stop-motion, time-as-paint, rule chips, two-phone co-op) continues from here; each phase ends with a skit we actually film.

## Dev

    npm install
    npm run dev        # serves at /bits/
    npm test           # engine tests (vitest)
    npm run build      # typecheck + production build to dist/
    npm run test:e2e   # headless Chrome: synthesize -> perform -> render -> re-probe
    npm run lint

Deploys to ampactor.dev/bits from main via GitHub Pages (.github/workflows/deploy.yml).

## Layout

    src/engine/    recipe model, program compiler, onset detection
    src/jam/       pointer-gesture state machine (pure, unit-tested)
    src/media/     OPFS store, Mediabunny probe/decode, audio, offline render
    src/ui/        React chrome: library, deck
    src/pwa/       service worker registration
    src/e2e/       in-browser proof harness (?e2e)
    public/sw.js   precache + share-target service worker

One UI rule worth knowing: semantic color pairs are blue vs orange, never red vs green.
