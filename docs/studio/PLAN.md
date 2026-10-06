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

### S1b — trails and foley that don't depend on frame rate — *done*
What shipped: `createRenderer2d()` keeps the previous frame's time and fades trails by `keep^(30·Δt)` (exact at 30 fps, so exports are byte-identical; the render proof checks a vanished sheet's ghost after 0.3 s: 37 vs 31 at 30/60 fps, against 37 vs 2 before). `createShowSim` takes an `onStep` observer; `impactListener()` hears landings at the sim's 1/120 s steps, so preview and film hear the same landings at the same moments, and export places foley at the crossing rather than the frame. The `StagePlayer` and store extraction moved to S2a, where the camera needs them.

### S1 (original notes, kept for the record)
- Migration chain. Backdrop CASTs become `fit:'cover'` with a reset transform; stray WIRE/MOUTH/EYES/PIN/SNIP/PASS events on backdrop ids drop, with MUTE/TRIM/REMOVE that point at dropped passes. `back` then means only "back layer": transform, sim, hit-testing, snip, pin, wires, mouth and eyes all apply.
- Trails into renderer state with Δt-correct fade; impacts on the 30 Hz grid.
- `engine/assetRefs.ts`.
- `ui/stage/player.ts` (a StagePlayer owning framer and renderer with `tick()`), `ui/stage/store.ts` (a small `useSyncExternalStore` store for project, history, selection, mode).
- Checks: v0/v1 fixtures identical against the legacy renderer; migration fixtures (a v1 backdrop with a stray scale and wires); back layer hit-tests last; walkthrough phases `a-backdrop-can-be-snipped`, `a-backdrop-can-be-wired`.

### S2a — depth and the camera (v3) — *done*
What shipped: `engine/camera.ts` (the projection below, `viewOf` returning null at rest, `toScreen`/`toStage`, culling); `CAST.depth` (−1.5..20) and `PASS.prop: 'z'|'rot'|'scale'`, camera-only, on puppetId `'@camera'`, at recipe v3 (v2 migrates by header). The camera needs no CAST: it rests at identity until a pass moves it, then holds where the pass left it, like any sheet. The sim steps it as one more body (pan) plus a spring per prop, only when there are camera passes or a live stage; `ShowSim.camera()` reaches the frame as `Frame.camera`, null at rest, and each layer carries its depth. Paint order is back layer first, then far to near, stable on `castOf`. A backdrop that the camera has moved draws a mirrored apron, so a pan never shows the void. Sim checkpoints every 120 steps (`resumeAt`), keyed by the immutable event array and written only by sims that nothing is steering live. The pointer effect moved out of Stage.tsx into `ui/stage/gestures.ts`, which un-projects every touch at the touched sheet's depth: hits, staging drags, handles, tools and recorded samples. The camera is a button on the stage: with it in hand, a take's single finger pans (the world follows the finger) and a second finger dollies and rolls, each as its own pass in a camera lane. Depth is a five-stop row in a sheet's more panel.

Not done here: the StagePlayer/store extraction (the frame loop still lives in Stage.tsx; it moves with S2b's director view, which needs a second view of the same frame); a harness check that preview equals export under a fake clock; body (pose) passes are recorded in screen coords, so they ignore a moving camera.

Original notes:
- `engine/camera.ts`. Pixel-space projection: P = (x·W, y·H), O = centre, f = 2, k = f / (f + z − camZ), m = k·(f + z)/f, `screen = O + R(roll)·[m·(P − O) + k·(O − c)]`. Each sheet's projection is a similarity, so Canvas2D uses `setTransform`. Cull at f + z − camZ < 0.05. Paint order: depth, ties by `castOf`.
- The camera is a reserved `'@camera'` CAST `{type:'camera'}`: x, y pan, scale zoom, rot roll, depth dolly. It is an extra body in the sim with its own spring (handheld weight for free); scalar props are 1-D springs. `PASS.prop: 'z'|'rot'|'scale'` and `PASS.via: 'finger'|'body'|'gyro'|'video'`.
- Sim checkpoints every 120 steps so seeks cost at most a second of stepping.
- `ui/stage/gestures.ts` (the pointer effect out of Stage.tsx), camera-aware: hit tests through each sheet's inverse view; recorded samples inverse-project the finger at the grabbed sheet's depth.
- Camera gestures: drag pans, pinch records z, twist records roll.
- Checks: rest identity; parallax f/(f + z); project∘unproject round-trip; checkpoint seek equals a fresh sim; harness preview-equals-export with a fake clock; walkthrough `a-camera-pass-is-one-finger`.

### S2b — look: shadows, fog, director view, gyro, cuts (v4) — *done*
What shipped:
- **Recipe v4** (v3 migrates by header) adds three things:
  - `LOOK {shadow, fog, fogColor}`: latest wins per field, absent is off.
  - `CUT` on `'@camera'`: snaps pose and stops motion at the step boundary where it lands, and is removable with REMOVE `{cut}`.
  - `PASS.via: 'gyro'`.
- **One sprite path for both looks.** A looked layer is drawn alone onto a scratch canvas, fogged there with `source-atop` by depth, then drawn with a canvas shadow whose offset grows with the depth gap to the nearest overlapping sheet behind (`engine/look.ts`). With no look, every frame takes the old path, so parity is unchanged.
- **The renderer starts clean when a cut passes** (`Frame.cutAt`).
- **The stage player** (`ui/stage/player.ts`) owns playing and still frames and the overlay marks, and keeps the last frame.
- **The director view** (`DirectorView.tsx`) is opened from a sheet's more panel. Each sheet is a dot at (x, depth) on a log scale; drag a dot up to push the sheet back.
- **Camera-in-hand controls during a take:**
  - A "cut" pill cuts back to the wide shot, on the next beat if one lands within 0.3 s.
  - A "tilt" pill: `media/gyro.ts` records the phone's tilt as a camera pass.
- **Cuts in the lanes.** They are ticks in the camera lane; a tap takes one out, with an undo.
- **Body passes go through the camera.**

Not done here: a measured frame gate for looked frames. A look costs one stage-sized sprite blit per sheet, which WebGL (S4a) makes cheap; until then the gate covers the demo, which has no look.

Original notes:
- `LOOK {shadow?, fog?}` stage event (latest per field wins); migrated bits get `lookBase:'flat'`.
- Shadows onto the nearest overlapping sheet behind, offset and blur growing with the depth gap; fog as a depth tint.
- `DirectorView.tsx`: an inset side view (x against depth) to drag depth and perform the camera.
- `media/gyro.ts`: `DeviceOrientationEvent.requestPermission()` on the tap (iOS), (γ − γ0, β − β0) to camera pan at 60 Hz, saved as a `via:'gyro'` camera pass.
- `CUT {puppetId:'@camera', at, x, y, scale, rot, depth}`: snaps camera state, zeroes velocity; cut-on-beat snaps in the UI only.
- Walkthrough: `a-tilt-is-a-camera-pass` (CDP `DeviceOrientation.setDeviceOrientationOverride`), `depth-in-the-director-view`.

### S3 — the signal matrix (v5) — *done*
What shipped:
- **WIRE is `{from, to, amount −1..1, smooth?, threshold?, delay?}`.** v4 `{source, target}` migrates, with `on` becoming `const`.
- **Signals** (`engine/signals.ts`) share one parser with the recipe:
  - `const`, `voice`, `voice:<pid>`, `beat`, `band:bass|mid|air`, `bright`, `lfo:<hz>`, `rand:<hz>` and `step:<hz>`.
  - World signals: `sheet:<pid>.x|y|speed` and `dist:<a>:<b>`.
- **Shaping.** A shaped time signal is baked causally on the 120 Hz grid: delay, then threshold, then a one-pole attack/release with τ = 0.02·250^smooth and attack τ/4. Any order of questions gets the same answers.
- **Targets** (`engine/props.ts`):
  - Sheet: bounce, shake and lean (legacy), plus x, y, scale, rot, opacity, hue and depth.
  - Stage: trails and foley (legacy), plus fog and cam.x/y/z/rot/scale. The stage targets apply after the sim, in `composeFrame` (`stageMods`).
- **Legacy wires stay exact.** A legacy wire (const, voice or beat into bounce, shake or lean, unshaped) keeps the exact old arithmetic and summation order. `src/e2e/legacy/wires.ts` is the frozen oracle, checked on 40 random v4 wire sets, and parity stays 0/120.
- **Bands.** `engine/dsp.ts` (radix-2 FFT, Hann, each band normalised to its own 95th percentile) runs in `media/analysis.worker.ts` from a native-rate decode, memoised by asset and `BANDS_VERSION` (`media/bands.ts`). The render proof checks that the worker returns the same arrays as inline.
- **The Wires room** (`ui/rooms/Wires.tsx`) is the matrix read by rows: each signal has a live meter and a strip of target chips. Tap a chip to plug it in at 50%. A lit chip opens how much, smooth, above and late by; pulling a wire out is undoable. Sheets reach it from their more panel, the stage from the show menu's "stage wires".

Differs from the notes below:
- **No pass signals yet** (`pass:<id>.x|y|v|speed`).
- **World signals are read from the frame's poses and take no shaping.** Shaping would need a filter inside the sim step, so the room offers no smoothing for them.
- **Rooms are drawers opened from context** rather than a RoomBar, which waits until there are more rooms than one.
- **The camera controls moved to the stage's bottom-right,** because the camera's own hint banner covered the button that puts the camera down.

Original notes:
- `engine/dsp.ts` (radix-2 FFT, Hann), bands bass 30–150 Hz, mid 150–2k, air 6–16k, plus `bright` (log centroid), each normalized to its 95th percentile, from a native-rate decode in `media/analysis.worker.ts`, memoized by asset id and an analysis version.
- WIRE becomes `{from: SignalRef, to: PropRef, amount: -1..1, smooth?, threshold?, delay?}`; migration rewrites `{source,target}`.
- SignalRef strings, one parser shared by recipe and evaluator: `const | voice | voice:<pid> | beat | band:bass|mid|air | bright | pass:<id>.x|y|v|speed | sheet:<pid>.speed|x|y | cam.speed | dist:<a>:<b> | lfo:<hz> | step:<n> | rand:<hz>`.
- Recorded signals baked at 120 Hz: source → delay → threshold `max(0,(x−th)/(1−th))` → one-pole attack/release (τ = 0.02·250^smooth, attack τ/4) → × amount. World signals (speeds, distances) filter inside the sim step.
- `engine/props.ts` registry of targets (`x y scale rot opacity hue depth boil shadow`, later `ink.<i>.<k>`, stage `trails fog cam.* palette.mix`, `foley`).
- Rooms: `ui/rooms/RoomBar.tsx` (Stage | Wires), `rooms/Wires.tsx` — signal rows with live meters, the selected sheet's targets as cells, a cell opens amount/smooth/threshold/delay. Replaces MoreSheet's five fixed rows. Rooms are drawers on phones (within a third of the stage) and side by side on desktop.
- Checks: FFT bin of a sine, band separation, query order can't change smoothing, legacy oracle, harness `runBands`, walkthrough `bass-makes-the-sky-pulse`, `a-pass-drives-the-camera-at-30`.

### S4a — WebGL2 parity — *done*
What shipped, a different shape from the notes below, chosen for parity: **Canvas2D draws a sheet, WebGL2 draws the stage.**

`drawLayer` split into `placementOf` (where the sheet's own frame sits) and `drawSheetContent` (everything the sheet is, drawn in that frame). The canvas renderer composes the two exactly as before, so parity is byte-identical. `src/render/gl/glRenderer.ts` instead rasterises each sheet's content with that same function into a sprite in the sheet's own frame and places it with one textured quad. The GL side handles:
- placement, squash and lean through the camera;
- trails, a background quad faded by the shared `trailFor`;
- shadows, a blurred silhouette pass, and fog, mixed in the shader;
- fade, and colour through the CSS hue-rotate matrix the canvas filter uses;
- the moved backdrop's apron, using `MIRRORED_REPEAT` on a three-by-three quad.

Static content (`sheetContentKey`: no mouth, eyes, swinging pieces or warp; doodles keyed by boil step) keeps its sprite in a 48 MB LRU, so a backdrop uploads once. A single rasteriser means the two renderers can differ only in resampling. The render proof bounds that difference: on the fixture, and on the fixture with the camera moving and a look on, at most 0.36% of pixels are visibly off (channel diff over 40), with mean diff under 1.2.

`src/render/surface.ts` picks the renderer per canvas element:
- GL on a hardware GPU; software GL (SwiftShader, llvmpipe) counts as none and gets Canvas2D.
- `?renderer=gl|2d` overrides.
- A lost context gets a fresh canvas element drawn by Canvas2D.

`UX_RENDERER=gl npm run test:ux` walks the whole app on GL (SwiftShader); the frame gate stays a Canvas2D gate.

Not done here:
- **Export stays Canvas2D,** so films stay byte-identical to before.
- **Orbit** (yaw/pitch, projective) waits for full GL sheets, because a projective sheet cannot be a canvas sprite.
- **SDF mouths and eyes, and GL-native pieces,** are left for when Ink (S4b) needs sheets to be shaders anyway.

Original notes:
- `src/render/gl/`: mat4 per sheet; painter's order; 4× MSAA; convex pieces as fans; warped grid as one dynamic mesh; doodles and text rasterized by the canvas code into textures per boil variant (LRU); SDF mouths and eyes; ping-pong trails.
- Loaded as a dynamic chunk; `createRenderer('auto')` with `?renderer=` override; repeated context loss falls back to Canvas2D.
- Camera `prop 'yaw'|'pitch'` (orbit) — projective, so WebGL only.
- Harness `runParity`: fixtures through both renderers at 360×640 within frozen tolerances; e2e Chrome flags `--use-angle=swiftshader --enable-unsafe-swiftshader`.

### S4b — Ink and Seed (v6) — *done*
What shipped:
- **Genomes** (`engine/ink.ts`) are 2–6 steps from `noise stripes cells warp kaleido posterize halftone palette feedback`, every parameter in 0..1, run coordinate steps first and colour last, with exactly one palette.
- **Making them.** `dice` rolls from weighted templates. `mutate` nudges parameters (σ 0.12), swaps a step for another of its kind 15% of the time, and inserts or deletes one 10% of the time. `cross` combines two genomes slot by slot. Children's seeds come from `childSeed(seed, gen, i)`.
- **Recipe v6.**
  - An `ink` sheet type: `{type: 'ink', genome}`.
  - `INK {puppetId, genome | null}` dresses any sheet. Its content keeps its silhouette and takes the ink's colours, like paper cut from patterned stock.
  - Genomes are stored whole.
- **The Seed tray** (`ui/rooms/Tray.tsx`) is six live inks in one row (the sheet stays within a third of the stage):
  - tap one to breed from it (it moves to the front with five children);
  - hold two to cross them;
  - roll for six new ones;
  - keep: dress the sheet it was opened for, or cast a new ink sheet or backdrop.

  It opens from the cast sheet ("grow an ink") and a sheet's more panel; taking an ink off has an undo.

Differs from the notes below, deliberately: **inks are computed on the CPU, not in GLSL.**
- **Why.** Export and the software-GL fallback are Canvas2D, and two implementations of every op would drift apart. One deterministic implementation means preview, film, Canvas2D and GL all show the same ink.
- **How.** An ink is a 96² field, shaded every quarter second and cross-faded on the 30 Hz grid, with feedback stepped per tick. That is about 0.3 ms per tick plus about 12 ms per slice on a desktop. A seek warms up from 2 s back, and feedback forgets the difference (the unit test bounds it at 3/255).
- **Drawing.** The field is drawn smoothly scaled, which suits the printed look. A GLSL path can come later for live inks larger than this, with the CPU version as its reference.

Original notes:
- Genome `{seed, ops:[{op, p:number[]}]}`, 2–6 ops from `noise stripes cells warp feedback kaleido posterize halftone palette` (later `src`), every parameter normalized 0..1.
- Dice from weighted templates; breed `mutate(parent, rng(hash(seed, gen, i)))` (σ 0.12 nudges, 15 % op swap, 10 % insert/delete); cross per op slot.
- Genome → GLSL is a pure string; programs cached by op sequence, parameters are uniforms. Feedback ticks at 30 Hz; a seek warms up from t − 2 s.
- `ui/rooms/Tray.tsx` and `ui/seed/DiceGrid.tsx` (one GL canvas, six DOM buttons over it): tap breeds, long-press two to cross, keep commits.

### S4c — palettes, paper, motion styles (v7) — *done*
What shipped:
- **Grading.** `LOOK.palette {colors[5], mix}` and `LOOK.paper {edge, grain, fade, misreg}`, latest per field, null to take off. `engine/grade.ts` holds:
  - the OKLCH harmonies (analogous, complement, triad, duotone) behind the menu's named palettes;
  - four paper presets in the London film's spirit;
  - the grade itself: `gradePixels`, with the lookup table and seeded grain tile it uses.
- **The grade in both renderers.** The canvas renderer runs `gradePixels` on a copy. GL draws into a multisampled buffer, resolves it, and grades in a shader fed the same table and tile. Neither grades its trail buffer, so ghosts are never graded twice. The render proof holds GL to canvas on a graded scene (0.19% of pixels visibly off) and checks that the grade really changes the picture.
- **Springs.** `jelly`, `stiff`, and `twos`: felt physics, shown on twos. The sim keeps the physics and the shown pose apart and holds the shown one for ten steps (1/12 s); checkpoints carry both.
- **Memoisation.** `castOf`, `lookOf` and `cutsOf` are memoised per event array (projects are immutable), which takes three event-log scans out of every preview frame.

Measured later (S6a), with the gate's own steps run in isolation, three runs at a time on fresh profiles. The share of frames over 50 ms swings from 3% to 36% on identical builds, including the pre-studio S0 build (4–36%) and S5b (4–23%) as well as S6a (3–20%). The walkthrough's single sample therefore sits on noise at its 10% line. The studio work did not move it, and CI has passed it every time; when it fails locally, re-measure rather than loosen.

Watch: the frame gate's "over 50 ms" share sits near its 10% limit because frame times quantise to vsync (33.3 / 50.0 ms). It passed every run after the memoisation, but S5 should not add per-frame work on the Canvas2D path without measuring.

Original notes:
- `LOOK.palette {colors[5], mix}` (OKLCH harmonies, gradient map in the sheet shader), `LOOK.paper {edge, grain, fade, misreg, seed}` with the London film's looks as presets, springs `jelly | stiff | twos` (twos holds poses on 1/12 s boundaries).

### S5a — video sheets (v8) — *done*
What shipped:
- **The spec:** `{type: 'video', assetId, durationS, at?, clipFrom?, loop?}`. The duration is stored, so where a clip is at any moment (`videoLocalTime`) is a rule of the recipe.
- **`media/video.ts`** opens each clip once (Mediabunny `CanvasSink`, at most 720 px on the long side).
  - **The stage** reads ahead about a second behind the playhead and draws the latest frame it holds.
  - **The film and the poster** wait for the exact frame at each time (`videosReadyAt`), so a slow decoder makes the preview late, never the film wrong.
- **Same path as every sheet.** Video is ordinary sheet content in `drawSheetContent`, so both renderers, every look, the camera and the grade apply to it. In GL it is never cached.
- **Import.** "a video" in the cast sheet: probed, saved as is, sized to its own shape on the stage's, starting at the playhead and looping. Videos travel in bundles through `assetRefs`.
- **The render proof** encodes a clip in the browser (a bar moving one step a frame) and checks the drawn frame is exactly the one the rule names at nine uneven times, across a loop.

Not done here:
- **Transcoding on import** to 720p with 1 s keyframes: files are stored as chosen.
- **The clip's own audio.**
- **Masks, pose and motion analysis:** these are S5b.

### S5b — reading a clip (v9) — *done*
What shipped:
- **One read per clip** (`media/videoAnalysis.ts`), sampled 15 times a second of clip:
  - **motion:** the mean frame difference at 64×36, normalised to its 95th percentile;
  - **drift:** the global shift that best explains each step, found by block matching within ±4 px. A gradient (Lucas–Kanade) step could not see a thin thing that moves further than its own width; the render proof's bar does exactly that.
  - **person masks:** from MediaPipe's selfie segmenter, in VIDEO mode at 256 px;
  - **head and wrist tracks:** from the pose landmarker.
- **Storage.** The read is saved as one binary asset (`serializeTracks`) and referenced from the sheet (`analysisId`, carried through `assetRefs`). Model output differs across phones, so it is a result kept, never re-run.
- **What a read clip offers:**
  - signals `video:<pid>.motion|flowx|flowy`, which shape like any time signal and appear in the Wires room as "<name> moving / drifting";
  - `masked`, to show only the person;
  - "their head / left hand / right hand leads <sheet>", which writes an ordinary PASS from the pose track (`poseToSamples`, `via: 'video'`) in stage coordinates.
- **Without the models** (offline, an old phone), the read still finds motion and drift.
- **The render proof:**
  - checks drift, masks, masking and leading on the encoded bar clip, with a stand-in model that finds the bar;
  - runs the real models on that clip offline to prove they load and answer at the right sizes.

Not done here:
- **Running the read in a worker.** It runs on the main thread with progress shown. MediaPipe's VIDEO mode in a worker needs its own canvas plumbing.

Original notes for S5a/b:
- `{type:'video', assetId, at?, clipFrom?, loop?, maskAssetId?}`; frames chosen as the largest timestamp ≤ t − at + clipFrom; export awaits exact frames in `prepare`, preview reads ahead. Import transcodes to ≤ 720p with 1 s keyframes when it can; audio goes through `importSoundFile`.
- One analysis pass in a worker (`VideoSampleSink`): masks (MediaPipe VIDEO, 256 px, deflate per frame) as `.mask`, pose landmarks as `.pose` (a picker turns them into ordinary PASS events, `via:'video'`), motion and flow from 64×36 differences as `.sig` → signals `video:<asset>.motion|flowx|flowy`. Ink `src` op takes the video.

### S6a — kits (v10) — *done*
What shipped:
- **`CAST.attach {to, x, y}`.** A sheet rides another at a point in the parent's own box (0..1). The parser rejects a sheet riding itself or a ring of riders ("attachments go round in a circle").
- **The sim steps parents first** (`simOrder`), otherwise in cast order, so a show without kits steps exactly as before. A rider springs toward its anchor on the parent as the parent stood at the same 1/120 s step; a pass on the rider still wins while it covers the moment. Only sheets something rides keep their per-step roots, so shows without kits allocate nothing new.
- **`EYES.blink`.** Blinks come from the seed (`engine/blink.ts`: one in every 3.5 s window, 0.13 s long, placed by `boilNoise`), so preview and film blink together. New eyes blink; old eyes have no `blink` and draw byte-identically.
- **The more sheet** has a "rides on" row: pills for each sheet it could ride without making a ring, and "let go". Riding keeps where the sheet sits now (`anchorOn`).
- **A selfie kit** (`media/kit.ts`, "a selfie kit" in the cast sheet): the photo is cut out, the pose model finds the neck, and the cutout splits there into a body and a head that rides it, cast as one undoable step. Without a person (or the model), it casts the cutout as one sheet.

Not done here:
- **`EYES.look`** (eyes that follow something). It waits for a signal-driven target; a wire to an eye prop is the likely shape.

### S6b — shots
- Shots: CUTs as cards in `rooms/Time.tsx` alongside Lanes and the timeline.

### S7 — folds
- `SNIP.hinge?`/`fold?` and prop `fold.<i>`: a hinge piece rotates in 3D about the snip line (GL mat4; Canvas2D scales perpendicular to the hinge by cos θ). A strip with N hinges is a tunnel to fly through, with near-plane culling.

## Performance

Main thread keeps the framer, the frame build (allocation-light) and the draw. Workers: bands (S3), video decode and analysis (S5). Caps: three live inks at ≤ 512² scaled by DPR, a ~48 MB doodle-texture LRU, sim checkpoints every second.
