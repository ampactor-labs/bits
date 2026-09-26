# BITS design notes

Detail behind the README's [How it works](../README.md#how-it-works) section.
Each section names the files that implement it.

## The recipe

The recipe (`src/engine/recipe.ts`) is an append-only log of events: CAST,
REORDER, PASS, SNIP, MOUTH, EYES, PIN, REMOVE, MUTE, TRIM, WIRE, SOUND, VOICE
and DROP. Each bit is saved as one JSON recipe.

- Undo pops the last event, or the last group of events committed together,
  and redo puts it back (`src/engine/history.ts`). A group is a contiguous run
  at the tail of the log, and the parser rejects a group that is split.
- Removing a feature appends a REMOVE event instead of rewriting history.
  Pin and snip slots are never renumbered, because every pass that targets a
  pin or a piece names it by index. A removed slot stays empty.
- The parser also checks that event ids are unique and that MUTE, TRIM and
  REMOVE point back at earlier events, so the same recipe cannot resolve
  differently in two implementations.
- The recipe is at version 1. Version 0 files migrate on load, and a stored
  v0 bit is part of the render proof.

## Mouths

Mouths use spectral visemes: mouth shapes chosen from the sound's character
(`src/engine/envelope.ts`). Every 20 ms, the voice track's loudness and
zero-crossing rate (how often the waveform crosses zero, which is high for
hissy sounds like s and sh) pick one of five shapes: closed, small, wide, a
thin slit or round. Loudness is normalised against the track's 95th
percentile, so one shout does not flatten the rest. The track is computed
from the audio samples alone, so the render recomputes it exactly.

A puppet can carry a voice take of its own (a VOICE event). A puppet without
one flaps to the bit's sound, and a puppet with one flaps to its own take, so
two people can record their halves separately.

## Pins

Pins use moving-least-squares similarity deformation (Schaefer, McPhail and
Warren, 2006) in `src/engine/warp.ts`. It is a closed-form warp: no solver,
and each small region of the image stays close to rigid. The puppet is drawn
as a textured triangle mesh, and each pin is a spring point that a pass can
drag. Pins apply only to uncut puppets. Removing the last snip makes a puppet
pinnable again and brings back the pins it had before the cut.

## Snips

Each snip line splits the puppet's box with a half-plane
(`src/engine/pieces.ts`). The side holding the box centre stays as the root,
and the far side becomes a child hinged at the line's midpoint. Successive
snips carve the remaining root. A child dangles on its own spring, driven by
the body's sideways acceleration, or chases the finger when a pass grabs it.

## Photo cutouts and body passes

Photo cutouts use MediaPipe's selfie segmentation model
(`src/media/cutout.ts`). When the model will not load, or finds no person in
the photo, the whole frame becomes the puppet and the app says so. The
MediaPipe JavaScript is imported dynamically, and its 11.5 MB wasm and the
model are fetched on first use, so a person who never casts a photo never
downloads them. The app streams the 11.8 MB of wasm and model into the HTTP
cache itself first, so the wait can show progress.

Body passes run MediaPipe pose tracking on the front camera
(`src/media/pose.ts`). Each wrist drives one assigned puppet, and the
coordinates are mirrored so moving your right hand right moves the puppet
right on screen. The recorded motion is an ordinary pass.

## Flip

Flip lives in the puppet's local transform (`localToWorld` in
`src/engine/show.ts`). Pass samples are stage
coordinates and do not mirror with the puppet, so a mirror applied only at
draw time would put a dragged pin at the mirror image of the finger.

## Storage

Bits and their assets live in OPFS, the Origin Private File System: a
per-site file store inside the browser (`src/media/opfs.ts`,
`src/media/assets.ts`). Assets are cutout images and audio, stored by id.

Deleting a bit moves its recipe to a trash folder and removes its assets only
after the five-second undo window closes. The next launch sweeps a delete
that was interrupted, so a tab closing mid-undo neither loses a bit nor leaks
its storage.

Posters on the bits list are drawn from the recipe with the same drawer as
the stage and the film (`src/media/poster.ts`). Nothing is stored for them.

## Bit files

A bit file (`src/media/bundle.ts`) is one JSON file holding the recipe plus
every asset it references (the sound, cutouts and voice takes) as base64 data
URLs. Import copies the assets under fresh ids, so an imported bit shares
nothing with its source and importing the same file twice gives two
independent bits. Imported bits carry a `remixOf` credit with the original's
title and id. Nothing is fetched from it.

"make a copy" on the bits list is the one case that shares assets, because
copying every photo per duplicate would fill a phone. Deletion checks whether
another bit still uses an asset before removing it.

## Offline and updates

The service worker (`public/sw.js`) precaches the app shell and serves it
cache-first. The MediaPipe files are cached at runtime on first use instead.
A Vite plugin in `vite.config.ts` writes `dist/precache.json` and stamps a
hash of the file list into `sw.js`, because a browser only reinstalls a
worker whose bytes changed. A new worker waits until the page asks it to take
over, since the running page may still load a chunk the new build removed.

The same worker takes POSTs from the share sheet: an installed copy registers
as a share target in `public/manifest.webmanifest`, and a shared bit file
waits in a cache until the bits list opens it.

## Colour

The interface uses blue and orange as its semantic colour pair. Red and green
are never used as a pair (`src/kit/tokens.css`).
