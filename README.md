# BITS

A puppet-show instrument for phones. You don't animate a scene with timelines and keyframes; you put on the show. Record the bit first (the voices, the argument, the dumb song), cast puppets from photos of yourselves or finger doodles, then perform in passes like a musician overdubs tracks: hit record, drag one puppet while the audio and every earlier pass play back, stop, layer the next one. Spring physics is the inbetweener: you supply intent, the simulation supplies lag, lean, squash, and settle.

**Status: shipping.** Live at https://ampactor.dev/bits/; nothing named is left unbuilt — what's missing is mileage, and nothing merges across phones by design.

## How it works

Then the scissors come out. Draw a line across a puppet and it splits where you cut: the far side hangs from the line's midpoint and dangles with the motion, paper-doll style — and you can grab the piece itself in a pass and puppet it directly. Pin a mouth on anything and it flaps with the voice track; once a puppet has passes, it only talks while one of them covers the moment, so holding the talker is how you say who's speaking. Googly eyes lag the motion. Doodles boil. Backdrops drop in from the camera roll or straight from the camera; two fingers resize and rotate anything; long press drops a puppet; the playhead scrubs and passes punch in anywhere.

Everything lands in an append-only recipe with undo and redo; the same recipe simulates to the same frames (bit-exact, fixed-step grid), so preview and render agree, and the preview clock rides the AudioContext so mouths flap on the audio's time. Everything runs on-device in the browser: WebCodecs for encode/decode, Mediabunny for containers, MediaPipe segmentation for photo cutouts (with a whole-frame fallback), OPFS for storage with asset cleanup on delete. No uploads, no accounts, no generated pixels.

Mouths speak in spectral visemes (loudness plus zero-crossing rate classifies closed, small, wide, fricative slit, and round shapes; deterministic from the PCM). Pins bend uncut photo puppets through moving-least-squares similarity warp (the closed-form ARAP-family deformer), drawn as a textured triangle mesh; pins are spring points you can grab in passes, and pins and snips are exclusive per puppet: cut paper or bend it. Body passes drive puppets with your wrists via MediaPipe pose from the front camera, one hand per target, recorded as ordinary passes. Any bit exports as a single .bit.json bundle (recipe plus every asset, base64) that anyone can open from the bits list and re-perform: the remix loop.

## Collaboration

There is no server, so collaboration is physical: share the phone, or share a file.

On one phone the instrument is already multiplayer. The bit is recorded together; passes are performed one player at a time, and the talker rule makes hand-offs read as dialogue: whoever holds the puppet is the one speaking. Body passes give two hands to two puppets, one player can work the foley board while another drags, and corpse mode is the party game: perform your pass blind, meet the whole show on playback.

Across phones the unit is the bit file. Export packs the recipe plus every asset it references into one .bit.json; the receiver opens it from the bits list and gets the working instrument, not a flattened video. Import copies assets under fresh ids, so every show owns its storage exclusively: deleting any show never breaks another, and re-importing your own bit yields an independent copy. A bit whose bundle lost its sound still opens and offers a re-record. Finished shows leave as ordinary mp4s through the system share sheet.

## What this is not

Nothing merges. Two people editing the same bit on two phones produce two bits; the loop is pass-the-theater, deliberately. The append-only recipe would make merge tractable later if it ever earns its keep. A share-target route (opening a received bit straight from the share sheet) existed for the phase-0 deck and left with it; today the picker is the door.

## Testing

Engine tests run under vitest (`npm test`). `npm run test:e2e` drives
headless Chrome through the real loop: synthesize a bit on-device,
perform, render, re-probe the output. Every deploy is gated on both —
`.github/workflows/deploy.yml` runs `npm test`, the production build,
and the e2e pass before Pages ever sees the artifact, so what's live
passed the full loop on the commit that shipped it. Real phones stay a
manual pass; `tools/` carries the device checklist.

## Dev

    npm install
    npm run dev        # serves at /bits/
    npm test           # engine tests (vitest)
    npm run build      # typecheck + production build to dist/
    npm run test:e2e   # headless Chrome: synthesize -> perform -> render -> re-probe
    npm run lint

Deploys to ampactor.dev/bits from main via GitHub Pages (.github/workflows/deploy.yml).

## Layout

    src/engine/    recipe model, onsets, springs, pieces, warp, wires, sfx, show sim
    src/media/     OPFS + assets, Mediabunny decode, mic, cutouts, pose, bundle, renderers
    src/ui/        React chrome: bits list and the stage
    src/demo/      first-run demo bit, synthesized on-device
    src/pwa/       service worker registration
    src/e2e/       in-browser proof harness (?e2e)
    public/sw.js   precache service worker
    tools/         asset staging, e2e driver, device checklist

One UI rule worth knowing: semantic color pairs are blue vs orange, never red vs green.
