# BITS

A video instrument for phones. CapCut is a document editor: footage is text and you sit and revise it. BITS is the other thing: footage plays, your fingers are mapped to moves (tap cuts, hold slows, pinch punches in), and the performance is the edit. Every gesture lands in an append-only recipe; same recipe over same sources renders the same frames, so any export can reopen as the moves that made it.

Built for two people making skits together. Everything runs on-device in the browser: WebCodecs for decode/encode, Mediabunny for containers, OPFS for storage. No uploads, no accounts, no generated pixels.

## Status

Phase 0: import clips, play and scrub them inside an installable PWA, offline. The full ten-phase plan (ghosts, stop-motion, time-as-paint, rule chips, two-phone co-op) lives outside this repo for now; each phase ends with a skit we actually film.

## Dev

    npm install
    npm run dev        # serves at /bits/
    npm test           # engine tests (vitest)
    npm run build      # typecheck + production build to dist/
    npm run lint

Deploys to ampactor.dev/bits from main via GitHub Pages (.github/workflows/deploy.yml).

## Layout

    src/engine/    recipe model: append-only event log, deterministic replay
    src/media/     OPFS store, Mediabunny probe/decode
    src/ui/        React chrome: library, player
    src/pwa/       service worker registration
    public/sw.js   precache + share-target service worker

One UI rule worth knowing: semantic color pairs are blue vs orange, never red vs green.
