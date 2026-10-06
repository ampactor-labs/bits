# The studio road

How bits gets from the puppet instrument it is to the studio in `docs/VISION.md`. Like `docs/ux-audit/PLAN.md`, this carries the decisions that propagate and the places where the obvious implementation is wrong, not a task list. Every session re-reads the code it touches anyway.

Two passes went into it: a plan written against an exploration of the code, then an independent architecture review of that plan against the code, whose corrections are folded in below. Line numbers are as of commit `934d7e7`.

## Shipping

- One PR per milestone, lettered where a milestone splits (S2a, S2b…). The owner merges; main deploys to ampactor.dev/bits.
- PRs stack: each branches from the one before.
- Every PR: lint, unit tests, build, budget, render proof, walkthrough, all green. Golden event traces change only for phases the milestone deliberately changes.
- Commit subjects `S<n>[letter]: lowercase phrase`, bodies end with test counts.

## Decisions that propagate

1. **Every frame is built in exactly one place.** `src/engine/frame.ts`: `composeFrame` is the pure half (poses in, `Frame` out: draw order, voices, wire mods, trail), `createFramer` wraps it around a forward-only sim for anything that plays straight through. Preview, export, poster and the harness all build a `Frame` and hand it to a renderer. A pixel feature therefore lands in two places only: the frame builder and the renderers. (S0.)
2. **Renderers consume frames.** Today `renderFrame2d(ctx, W, H, frame, images)`. From S4a a `StageRenderer { prepare(frame), draw(frame), resetFeedback() }` interface with canvas2d and webgl2 implementations; `prepare` is awaited by export (video frames, shader compiles) and not by preview.
3. **Trails belong to the renderer** because they are feedback state. Fade becomes `keep^(30·Δt)` (exact `keep` when the exponent rounds to 1, so 30 fps exports stay byte-identical), and feedback resets when t goes backwards, Δt > 0.25 s, or a cut passes. Today a 60 fps preview fades twice as fast as the 30 fps film. (S1.)
4. **Impacts on a fixed 30 Hz grid** inside the framer, so preview foley lands where the export's does. (S1.)
5. **The stage canvas holds only frames.** Tool marks moved to an overlay canvas in S0. Required before WebGL: a canvas has one context type.
6. **A frozen legacy renderer** (`src/e2e/legacy/stageDraw.ts`, the pre-studio `drawStage`) is the reference the render proof holds every renderer to for v0/v1 content. Never edit it. Comparisons run in the same browser and the same run, never against stored hashes that a Chrome update would break.
7. **Versioning.** Any grammar or pixel change bumps `RECIPE_VERSION`; unknown kinds already make an older app throw, but optional fields would be silently ignored and render wrong. `migrateProject` becomes a chain `MIGRATIONS[v]` that rewrites old events into today's shapes (keeping ids), so the engine only knows the latest meaning. A newer file reads "made with a newer bits, reload to update".
8. **Names stay.** In code a sheet is a puppet: `puppetId`/`puppet` are in the file format. "Sheet" is the vision's and the UI's word.
9. **Depth is free at rest.** Stored positions are what you see through the resting camera; depth only shows when the camera moves. Pushing a sheet back never moves it, passes stay what the finger did, and every old bit is identical at rest.
10. **A pass can record any number.** `PASS.prop` makes a scalar pass with samples `[t, v, 0]` (triples, so the seven places that index `length - 3`, the lanes and the parser stay unchanged). Camera dolly, roll and zoom, fold angles and anything else performable reuse record, lanes, mute, trim and undo.
11. **Wires never feed physics.** They are post-sim modulation applied in the frame builder through a property registry. Recorded signals are baked into arrays on the 120 Hz grid, so smoothing and delay cannot depend on frame rate.
12. **Store results, not recipes for results.** An ink stores its full genome, never "parent seed + child index" (old bits must not change when mutation changes). Video segmentation, pose and motion are computed once at import and stored as assets, because model output differs across devices and delegates.
13. **Generated means seeded, never AI.** "No generated pixels" (audit non-negotiable) means no model-generated images; deterministic procedural art is in.
14. **Asset references are listed in one place**: `engine/assetRefs.ts`, a visitor used by bundles, remapping and garbage collection, so a new spec type registers its assets once. (S1.)

## Landmines

- **Byte-exactness of legacy wires.** Bounce, shake, lean, trails and foley keep their exact arithmetic and summation order (sources in the order on, voice, beat), including shake noise that is not keyed per puppet. Keep a copy of today's `wireModsFor` as a test oracle.
- **The rest camera must be an explicit identity**, not a matrix that comes out as 0.9999999999999999.
- **`mixdownMono`** is baked into every bit's mouths and beats; never change it. Bands decode separately at native rate (a 16 kHz mixdown cannot see the "air" band).
- **Anisotropic rotation in `localToWorld`** is self-consistent for pins and old bits depend on it; leave it. Camera math is in pixel space.
- **Backdrop edges.** Off rest, a cover-fit backdrop is sampled with mirrored repeat, so a pan never shows a void.
- **Backdrop taps.** Once backdrops are selectable, a tap on the backdrop deselects when something is selected and selects it only when nothing is (or on long press), or the walkthrough's traces shift.
- **Canvas2D shadows** need a cached per-sheet sprite: a clip cuts a shadow off. Only on that path; static sheets reuse their sprite.
- **Frame gate.** The walkthrough requires a median ≤ 34 ms at 4× CPU throttle and the demo sits at ~33 ms already. Canvas2D gets no heavier until WebGL lands; WebGL is measured by CPU time per tick, since SwiftShader ignores CDP throttling.
- **Export in WebGL**: `OffscreenCanvas` `webgl2` with `preserveDrawingBuffer: true` into Mediabunny's `CanvasSource`. Spike it first; the fallback is `transferToImageBitmap` into a 2D canvas.
- **iOS allows few WebGL contexts**: the dice grid draws six tiles on one canvas with viewports.
- **Browser suites need H.264.** See CLAUDE.md for Chrome for Testing.

## Milestones

### S0 — one frame builder (no version bump) — *done in this PR*
- `engine/frame.ts` (`composeFrame`, `createFramer`, `impactsOf`; `PuppetVisual`, `visualsOf`, `voiceMap`, `OwnVoice` moved here from `media/`), `media/analyze.ts` (bed analysis and takes), `renderFrame2d` in `media/stageDraw.ts`.
- Export, poster and both stage paths switched. Posters now include wires, as the film does.
- Overlay canvas for tool marks; frozen legacy renderer; fixed-seed fixture (`src/e2e/fixtures.ts`) with every sheet kind, a cut, a warp, mouths, eyes, wires and trails; render proof checks 120 frames pixel-for-pixel against the legacy path.
- `CLAUDE.md`; `.gitignore` admits `.claude/skills/`.

### S1a — backdrops become sheets (v2) — *done*
What shipped: the migration chain (`MIGRATIONS` in `recipe.ts`); v1 backdrops become `fit: 'cover'` sheets at rest with whatever v1 ignored dropped; the renderer draws `fit: 'cover'` through the normal piece/warp path (the warp samples the cover crop); the sim moves backdrops; `hitTest` takes a `back` option and tests the back layer last; `engine/assetRefs.ts`; backdrops get mouth, eyes, snip, pin, replace and more.

How a backdrop is picked up, settled while building it: a press on an unselected backdrop is a press on bare stage (so a stray drag never moves the scenery); a long press there selects it; a selected backdrop can be dragged like any sheet; a quick tap on a selected backdrop puts it down (it covers the stage, so there is no bare stage left to tap). The halo stays inert until the click that follows a lift has passed, because a long press can raise a docked halo under the finger.

Harness note: late in `ux-walk.mjs`, after the window-shape phases, the original tab stops receiving synthetic touches at all; the backdrop phases run in a fresh tab. Put new touch-driven phases there too, or before the window-shape phases.

### S1 (remaining, as S1b) — sheets everywhere
- Migration chain. Backdrop CASTs become `fit:'cover'` with a reset transform; stray WIRE/MOUTH/EYES/PIN/SNIP/PASS events on backdrop ids drop, with MUTE/TRIM/REMOVE that point at dropped passes. `back` then means only "back layer": transform, sim, hit-testing, snip, pin, wires, mouth and eyes all apply.
- Trails into renderer state with Δt-correct fade; impacts on the 30 Hz grid.
- `engine/assetRefs.ts`.
- `ui/stage/player.ts` (a StagePlayer owning framer and renderer with `tick()`), `ui/stage/store.ts` (a small `useSyncExternalStore` store for project, history, selection, mode).
- Checks: v0/v1 fixtures identical against the legacy renderer; migration fixtures (a v1 backdrop with a stray scale and wires); back layer hit-tests last; walkthrough phases `a-backdrop-can-be-snipped`, `a-backdrop-can-be-wired`.

### S2a — depth and the camera (v3)
- `engine/camera.ts`. Pixel-space projection: P = (x·W, y·H), O = centre, f = 2, k = f / (f + z − camZ), m = k·(f + z)/f, `screen = O + R(roll)·[m·(P − O) + k·(O − c)]`. Each sheet's projection is a similarity, so Canvas2D uses `setTransform`. Cull at f + z − camZ < 0.05. Paint order: depth, ties by `castOf`.
- The camera is a reserved `'@camera'` CAST `{type:'camera'}`: x, y pan, scale zoom, rot roll, depth dolly. It is an extra body in the sim with its own spring (handheld weight for free); scalar props are 1-D springs. `PASS.prop: 'z'|'rot'|'scale'` and `PASS.via: 'finger'|'body'|'gyro'|'video'`.
- Sim checkpoints every 120 steps so seeks cost at most a second of stepping.
- `ui/stage/gestures.ts` (the pointer effect out of Stage.tsx), camera-aware: hit tests through each sheet's inverse view; recorded samples inverse-project the finger at the grabbed sheet's depth.
- Camera gestures: drag pans, pinch records z, twist records roll.
- Checks: rest identity; parallax f/(f + z); project∘unproject round-trip; checkpoint seek equals a fresh sim; harness preview-equals-export with a fake clock; walkthrough `a-camera-pass-is-one-finger`.

### S2b — look: shadows, fog, director view, gyro, cuts (v3 continued or v4)
- `LOOK {shadow?, fog?}` stage event (latest per field wins); migrated bits get `lookBase:'flat'`.
- Shadows onto the nearest overlapping sheet behind, offset and blur growing with the depth gap; fog as a depth tint.
- `DirectorView.tsx`: an inset side view (x against depth) to drag depth and perform the camera.
- `media/gyro.ts`: `DeviceOrientationEvent.requestPermission()` on the tap (iOS), (γ − γ0, β − β0) to camera pan at 60 Hz, saved as a `via:'gyro'` camera pass.
- `CUT {puppetId:'@camera', at, x, y, scale, rot, depth}`: snaps camera state, zeroes velocity; cut-on-beat snaps in the UI only.
- Walkthrough: `a-tilt-is-a-camera-pass` (CDP `DeviceOrientation.setDeviceOrientationOverride`), `depth-in-the-director-view`.

### S3 — the signal matrix
- `engine/dsp.ts` (radix-2 FFT, Hann), bands bass 30–150 Hz, mid 150–2k, air 6–16k, plus `bright` (log centroid), each normalized to its 95th percentile, from a native-rate decode in `media/analysis.worker.ts`, memoized by asset id and an analysis version.
- WIRE becomes `{from: SignalRef, to: PropRef, amount: -1..1, smooth?, threshold?, delay?}`; migration rewrites `{source,target}`.
- SignalRef strings, one parser shared by recipe and evaluator: `const | voice | voice:<pid> | beat | band:bass|mid|air | bright | pass:<id>.x|y|v|speed | sheet:<pid>.speed|x|y | cam.speed | dist:<a>:<b> | lfo:<hz> | step:<n> | rand:<hz>`.
- Recorded signals baked at 120 Hz: source → delay → threshold `max(0,(x−th)/(1−th))` → one-pole attack/release (τ = 0.02·250^smooth, attack τ/4) → × amount. World signals (speeds, distances) filter inside the sim step.
- `engine/props.ts` registry of targets (`x y scale rot opacity hue depth boil shadow`, later `ink.<i>.<k>`, stage `trails fog cam.* palette.mix`, `foley`).
- Rooms: `ui/rooms/RoomBar.tsx` (Stage | Wires), `rooms/Wires.tsx` — signal rows with live meters, the selected sheet's targets as cells, a cell opens amount/smooth/threshold/delay. Replaces MoreSheet's five fixed rows. Rooms are drawers on phones (within a third of the stage) and side by side on desktop.
- Checks: FFT bin of a sine, band separation, query order can't change smoothing, legacy oracle, harness `runBands`, walkthrough `bass-makes-the-sky-pulse`, `a-pass-drives-the-camera-at-30`.

### S4a — WebGL2 parity (+ orbit)
- `src/render/gl/`: mat4 per sheet; painter's order; 4× MSAA; convex pieces as fans; warped grid as one dynamic mesh; doodles and text rasterized by the canvas code into textures per boil variant (LRU); SDF mouths and eyes; ping-pong trails.
- Loaded as a dynamic chunk; `createRenderer('auto')` with `?renderer=` override; repeated context loss falls back to Canvas2D.
- Camera `prop 'yaw'|'pitch'` (orbit) — projective, so WebGL only.
- Harness `runParity`: fixtures through both renderers at 360×640 within frozen tolerances; e2e Chrome flags `--use-angle=swiftshader --enable-unsafe-swiftshader`.

### S4b — Ink and Seed
- Genome `{seed, ops:[{op, p:number[]}]}`, 2–6 ops from `noise stripes cells warp feedback kaleido posterize halftone palette` (later `src`), every parameter normalized 0..1.
- Dice from weighted templates; breed `mutate(parent, rng(hash(seed, gen, i)))` (σ 0.12 nudges, 15 % op swap, 10 % insert/delete); cross per op slot.
- Genome → GLSL is a pure string; programs cached by op sequence, parameters are uniforms. Feedback ticks at 30 Hz; a seek warms up from t − 2 s.
- `ui/rooms/Tray.tsx` and `ui/seed/DiceGrid.tsx` (one GL canvas, six DOM buttons over it): tap breeds, long-press two to cross, keep commits.

### S4c — palettes, paper, motion styles
- `LOOK.palette {colors[5], mix}` (OKLCH harmonies, gradient map in the sheet shader), `LOOK.paper {edge, grain, fade, misreg, seed}` with the London film's looks as presets, springs `jelly | stiff | twos` (twos holds poses on 1/12 s boundaries).

### S5a/b — video in
- `{type:'video', assetId, at?, clipFrom?, loop?, maskAssetId?}`; frames chosen as the largest timestamp ≤ t − at + clipFrom; export awaits exact frames in `prepare`, preview reads ahead. Import transcodes to ≤ 720p with 1 s keyframes when it can; audio goes through `importSoundFile`.
- One analysis pass in a worker (`VideoSampleSink`): masks (MediaPipe VIDEO, 256 px, deflate per frame) as `.mask`, pose landmarks as `.pose` (a picker turns them into ordinary PASS events, `via:'video'`), motion and flow from 64×36 differences as `.sig` → signals `video:<asset>.motion|flowx|flowy`. Ink `src` op takes the video.

### S6a/b — kits and shots
- `CAST.attach {to, x, y}`: kits are sheets on springs, simulated parents first, cycles rejected at parse. `EYES.blink?`/`look?` (blink schedule from the seed). Selfie → kit in one flow.
- Shots: CUTs as cards in `rooms/Time.tsx` alongside Lanes and the timeline.

### S7 — folds
- `SNIP.hinge?`/`fold?` and prop `fold.<i>`: a hinge piece rotates in 3D about the snip line (GL mat4; Canvas2D scales perpendicular to the hinge by cos θ). A strip with N hinges is a tunnel to fly through, with near-plane culling.

## Performance

Main thread keeps the framer, the frame build (allocation-light) and the draw. Workers: bands (S3), video decode and analysis (S5). Caps: three live inks at ≤ 512² scaled by DPR, a ~48 MB doodle-texture LRU, sim checkpoints every second.
