# BITS: the plan to the ultimate form

## Context

The UX audit (`docs/ux-audit/README.md`, branch `claude/bits-ux-audit-dqik4b`) found that the BITS engine is right and the chrome is wrong. A puppet-show instrument with a real thesis, audio first and perform in passes, wrapped in an editor's habits: a mode menu that covers the stage it serves, 13px hints, system dialogs, silent failures, destructive gestures with no undo, and an invisible looper. It ranked 42 findings and described the target shape.

This is the road from there to here. It is deliberately not a task list for every milestone. A plan written three months ahead of use is fiction with citations, and every implementation session re-reads the actual code anyway. What this document does carry is the part that does not survive being re-derived later: the decisions that propagate, the places where the obvious implementation is wrong, and the order that avoids rework.

Three architects reviewed an earlier, much longer draft against the code and returned 45 grounded corrections. The serious ones are folded in below and several were load-bearing: flip cannot be a draw-time mirror, a puppet drag would silently undo a layer reorder, removing a pin would re-target other passes, and the service worker would serve a stale shell to every installed phone forever. That review is why this document is worth having.

Findings referenced as F1 to F42 are the audit's. Line numbers are commit `c9ff5a2`.

## Decisions taken

1. **Sound import ships in the first milestone**, not the fifth. Today a person must talk out loud before anything happens, which is the biggest wall in the funnel. "Use a file" sits beside the mic on the first sound screen.
2. **iOS is a first-class target, verified whenever an iPhone turns up.** Platform-sensitive paths are written defensively from the start: feature-detect, fall back, never hard-depend on H.264 encode or OPFS writable streams. The device pass blocks nothing. Until it happens the support line reads honestly.
3. **Claude implements, in sessions like this one.** Milestones carry acceptance checks rather than rationale. Estimates are given in sessions as well as engineer-days.

---

## 1. Non-negotiables

If a change would violate one of these, the change is wrong.

1. **The recipe stays append-only and deterministic.** Every new event is pure data, no wall-clock reads in the engine, undo stays "pop the tail".
2. **The stage canvas holds nothing but `drawStage` output.** Preview-only marks (halo, handles, selection outline, scissor line, live doodle strokes, pin rings) live in DOM or on a separate transparent overlay canvas the render never sees. Today the idle loop paints pin rings and stroke previews straight onto the stage canvas at `Stage.tsx:513-537`; that gets retired, not preserved.
3. **On device, no server, no accounts, no generated pixels.** Files are the unit of sharing. Nothing merges.
4. **A sheet may cover the dock, the timeline, and at most a third of the stage height.** Not 33vh, which on a 667px phone would eat the dock, the timeline, and most of the stage before showing any content.
5. **Every wait shows progress. Every destructive action is undoable for five seconds.** No `window.prompt`, `confirm`, or `alert` anywhere.
6. **Nothing that instructs is under 15px.** Every control has an accessible name. Disabled looks disabled.
7. **Blue and orange stay the semantic pair.** Destructive actions use the accent with a confirm or an undo, never a red.
8. **MediaPipe JS, wasm and models all stay lazy.** The JS is currently static-imported into the entry chunk through `cutout.ts` and `pose.ts`; that changes.
9. **Old bits keep opening.** v0 recipes and v0 bit files load forever through `migrate()`.

---

## 2. The landmines

This is the section that earns the document. Everything here is something where the obvious implementation is wrong and the wrongness propagates into shipped files on someone's phone.

### 2.1 Recipe v1

Additive. Types in the appendix. `RECIPE_VERSION` becomes `1` at the **first milestone that changes pixels or motion**, which is the doodle colors in the cast milestone, not later when the halo lands. A field that changes what you see always ships with a version bump; pure metadata (`name`, `poster`, `remixOf`, `sound`) never needs one.

| Event | Purpose |
|---|---|
| `REORDER {order: string[]}` | Draw order, back to front. One event, one undo, replacing the N recasts that `sendToBack` emits today. |
| `REMOVE {target}` | Tombstone for a mouth, eyes, a pin slot, a snip slot, a pass, or a sound. |
| `MUTE {passId, muted}` | A pass stops driving its puppet and stops counting as talking. |
| `TRIM {passId, from, to}` | Clamps a pass's coverage window. |
| `PIN {..., index?}` | With `index`, re-places an existing pin slot instead of appending. |
| `CAST {..., flip?}` | Mirrors the puppet's local frame. |
| `VOICE {puppetId, assetId, at, gain?}` | A separate audio take owned by a puppet, late milestone. |

Project-level, not events: `audio.trim`, `poster`, `updatedAt`, `remixOf`, `sound`, `aspect`.

**Migration touchpoints that are easy to miss.** `createProject` must fill `updatedAt`, and `migrate()` must synthesize it from `createdAt` for v0 files. `buildDemoShow` hardcodes `version: 0` at `demoBit.ts:381` and self-checks through `parseProject`, so the demo must be built as v1 or typecheck fails. The e2e harness builds projects the same way. Keep one stored v0 JSON fixture that the render proof migrates and renders, so the compatibility promise is tested rather than asserted.

**Event id references.** `MUTE`, `TRIM`, and `REMOVE` of a pass or sound name another event by id. Ids are 8 hex characters from `crypto.randomUUID().slice(0,8)` (`Stage.tsx:87`) and `parseProject` never checks uniqueness. Add parse rules: ids unique within a project, and a reference must name an earlier event of the right kind. Grow new ids to 12 characters. Engine helpers must tolerate a dangling reference at runtime, because corpse recording builds a sim from a project with the passes stripped out (`Stage.tsx:318-321`) while keeping the mutes that point at them.

### 2.2 Engine semantics where the obvious answer is wrong

**Flip is a frame transform, not `ctx.scale(-1,1)`.** Pass samples are normalized *stage* coordinates, not local (`recipe.ts:32-36`), so they do not mirror with the puppet. The sim and drawer convert through `localToWorld` and `worldToLocal` (`show.ts:338-368`), which know nothing about flip, so pin rest positions, the piece joint, the piece rest angle and the dangle chase angle would all be computed unmirrored while the texture drew mirrored. A dragged pin would render at the mirror image of the finger. So: `ShowPuppet` gains `flip`; the local-to-world pair maps `lx -> (flip ? 0.5 - lx : lx - 0.5)`; the sim mirrors the piece rest angle and negates the dangle chase sign; `drawStage` applies the mirror after the root transform so mouths, eyes, pieces and the warp follow; text puppets mirror their position but not their glyphs, or a flipped word reads backwards. Also retire `Stage.tsx`'s private `toLocal` (`:560-571`) in favour of `worldToLocal`, which fixes an existing discrepancy: the private one ignores `root.angle`, so hit testing already disagrees with the drawer on a leaning puppet.

**A reorder must survive the next drag.** `castOf` builds draw order from Map insertion order, and every CAST does `map.delete` then `map.set`, so the latest CAST fronts its puppet (`show.ts:56-64`, verified). Since a drag commits a CAST on release, the first touch after a reorder would silently undo it. The rule is: draw order equals the latest `REORDER` filtered to live puppets, then every live puppet not in that list in latest-CAST order. A CAST for a listed puppet never changes its layer. With no REORDER in the log the order is exactly today's, so v0 files draw identically.

**Pin and snip indices are slots and must never compact.** Pin index is the position in the filtered PIN list (`show.ts:80-83`), and six places pair by that position: `pinLocals`, `pose.pins`, the pin step loop, hit testing, the warp's control-point zip, and `PuppetVisual.pins`. A naive filter on removal re-targets every later pass. So `pinsOf` returns `(PinEvent | null)[]`: slot `i` is the i-th appended pin or its latest re-placement, a remove nulls the slot, and a fresh pin always takes `slots.length` and never a freed one. Snips get the same shape, which is cheap because `splitPieces` already skips degenerate lines with `continue` while children keep their original `snipIndex`.

**Exclusivity counts live features only.** `pinsOf` returns empty for any puppet with a snip (`show.ts:79-83`, verified). If tombstoned snips stayed in the count, a puppet snipped once could never be pinned again, and the halo would refuse with "cut paper or bend it" on a visibly uncut puppet.

**A loop wrap rebuilds the sim.** `createShowSim` only advances forward and documents that seeking backward means rebuilding. The live sim is built once at record start with the live-grab target provider, and the frame loop clamps the clock forward. So a wrap is: commit the open grabs as passes, rebuild the sim from the current project with the same provider, advance to the loop start, reset the clock refs, restart audio. That is what makes the next lap play the pass you just recorded, which is the whole point of a looper.

**Group undo needs a symmetric redo.** Undo pops one event onto a flat redo stack (`Stage.tsx:1104-1120`). Making undo pop a whole group without changing redo means one redo re-appends only the first event of the group. For the foley nudge that is the remove without the re-add, so the sound vanishes. A group is a contiguous run at the tail; undo pops the run and pushes in reverse; redo pops and keeps popping while the next shares the group.

**Trim is a render input.** "Show time equals asset time" is the right call, because the sim grid and the audio clock both already speak asset seconds. But the render needs explicit handling: frames at `from + (i+0.5)/fps`, the sim fast-forwarded to `from` first, the audio sink iterated over `[from, to]` with bus times kept in asset seconds so foley offsets need no adjustment. And `drawStage` wipes fully for trails only when `t < 0.08` (`stageDraw.ts:55`), so a trimmed render with trails on would start from an unwiped canvas. Pre-fill the background once before the first frame.

### 2.3 The pointer model

Moving from "touch drags" to "tap selects, drag moves" is the riskiest interaction change in the plan, and it has four failure modes that are cheaper to decide now than to discover.

**No dead zone.** A tap is a release with under 6px of movement before the long-press timer fires. There is no upper time limit. The draft's "under 250ms" left a finger resting 250 to 500ms doing nothing, which is exactly the six-year-old and the low-vision user from the audit. Use 6 CSS pixels, not a percentage of stage width: the current code measures in normalized units where the vertical slop works out to nearly twice the horizontal on a 9:16 stage.

**Drag keeps the finger offset.** Today the first move sets the puppet's home to the fingertip (`Stage.tsx:801-804`), because pointerdown stores the home rather than the finger-to-home offset. That is invisible today because the drag starts immediately. With a 6px threshold the puppet jumps by the grab offset on the first move. Store the offset at pointerdown.

**One pointer owner.** Handles sit where a pinch's first finger lands and halo buttons sit where the second lands. If both are real DOM targets, a pinch starting on a mouth becomes a handle drag, and a pinch whose second finger lands on a halo button fires it on release. So: handles are `pointer-events: none` visuals that the gesture layer hit-tests itself; halo buttons stay real buttons for taps and screen readers, but the halo goes non-interactive while any pointer is down on the stage.

**Tool sub-state.** Snip and pin need "the next drag is the scissor line" and "the next tap places a pin". With drag now meaning move, that is ambiguous without an explicit `tool: null | 'snip' | 'pin'` on idle, entered and cleared by its own events, with the banner carrying the hint and its cancel.

Also: drop the two-finger stage gestures. Two fingers on the stage already means pinch in idle and two grabs while recording, so a two-finger swipe to stop would drag two puppets to the floor and record it. Perform is entered from the menu and stopped by a floating button.

**Long-press opens the halo, never a sheet and never a delete.** It is the same as a tap plus a haptic, and it is cancelled by a second pointer or by movement.

**Count-in is for getting ready.** A touch on a puppet during the count-in pre-grabs it so the pass starts at frame zero, rather than cancelling the take. Cancel lives on the dock and the banner.

### 2.4 Infrastructure that will bite

**The service worker will serve a stale shell forever.** `CACHE` is a constant in a static `public/sw.js`, so its bytes never change between builds; the browser only re-runs install when the file changes; and navigation is served cache-first from the cached shell. Every installed phone would keep the old build, which means every device pass would test the wrong thing. Fix: have the precache plugin stamp a build hash into `sw.js`, delete non-current caches on activate, and show a "new version, reload" toast on `controllerchange`. Assert that two consecutive builds produce different `sw.js` bytes. The inbox route for share targets must also be registered before the non-GET early return.

**CI never sees a pull request.** The workflow runs on push to main only, and never runs lint even though lint passes today. A red milestone PR would be discovered after merge, with main already broken. Split the build job to run on pull requests and gate deploy on the main ref.

**The render proof cannot see a UI regression.** The `?e2e` harness imports engine and media modules and calls `renderShow` directly; it never loads `Stage.tsx`. So "the split is proven byte-identical by render proof" is false. What is needed is a `uxHooks.ts` under the same `?e2e` flag exposing the project, the event-kind sequence, a commit counter, and test overrides. Then the split is proven by replaying the walkthrough and diffing the event sequence against a golden recorded before the split.

**Per-glob test environments do not exist in this Vitest.** `environmentMatchGlobs` was removed in Vitest 4, `.test.tsx` files are not even collected by the current include pattern, and jsdom is not installed. Use `test.projects` with a node project for the engine and a jsdom project for the UI.

**The bundle budget must count preloaded chunks.** Today's initial payload is the entry chunk plus a modulepreloaded mediabunny chunk, roughly 242KB gzipped against a 450KB budget. A check that counts only the entry under-reports by half.

---

## 3. The target shape

One diagram, since the audit already argued for it.

```
┌──────────────────────────────────────┐
│ ‹        the cat argument         ⋯  │  translucent strip over the stage
│                                      │
│              STAGE                   │  canvas + DOM overlays:
│         (drawStage only)             │  banner, halo bar, handles, curtain
│                                      │
│ ▁▂▃▅▂▁▃▆▂▁▏▏▏▏      0:04 / 0:12  ▲   │  waveform, beat ticks, playhead, loop
│   ↺    ↻      ⏺       ▶      ＋      │  dock, never changes shape
└──────────────────────────────────────┘
```

Two honest notes about geometry. The stage cannot be full-bleed on an iPhone: with a 48px title strip, a 44px timeline and a 72px dock plus safe areas, a 9:16 box is about 337px wide on a 390x844 phone and 272px on a 375x667. Laying the title bar *over* the stage rather than above it returns 48px and brings that to roughly 364px. And the halo is a bar in fixed order, not a ring: six 44px buttons need 304px, which does not fit around a puppet on the narrower phone, and a ring would put buttons in different places on different phones for the same puppet.

Everything else is as the audit's section 5 describes it: puppets carry their own tools, features are draggable handles, passes become lanes with visible talking stripes, sound is an object you can import and trim, and nothing is lost without an undo.

---

## 4. Order of work

The order below differs from the audit's roadmap in four ways the review forced. Foundations split into a kit half and a stage-internals half, because eight tasks including a 1550-line file split is not four days. The recipe engine work splits out of the halo milestone, because it was bundling the two highest risks into the largest pull request. The cast sheet comes after the halo, because building a chip rail that the halo milestone then deletes is throwaway work. And sound import moves to the front, per the decision above.

Estimates are engineer-days, with sessions in brackets. A session is one working block like this one.

### Next four, in detail

**M0a. Kit and harness.** 4 to 5 days [3 to 4 sessions]
Design tokens with real surface steps, disabled and focus states, and reduced motion. An icon sprite whose button component cannot be rendered without a label. Primitives: scrollable sheet with a sticky header, segmented control, toast with undo, banner, progress ring, meter, slider. The service-worker versioning fix. The walkthrough harness with DOM assertions and the `uxHooks` surface, wired into CI on pull requests alongside lint.
*Acceptance:* two consecutive builds produce different service worker bytes; the harness fails the build on an overlay covering more than a third of the stage, on instructive text under 15px, on a button with no accessible name, and on any system dialog; CI runs on pull requests; lint is in the pipeline.

**M1. Stop the bleeding, plus sound import.** 5 to 6 days [4 to 5 sessions]
Closes F1, F3, F4, F5, F6, F7, F8, F11, F17, F27, F28, F33, F34. Kit gets a max height and a scroll. Disabled looks disabled and an empty stage says what to do. Errors become a dismissible banner instead of replacing the stage, and a damaged recipe is never silently swapped for a blank project. Long-press stops deleting. List delete gets a confirm, a trash directory, and a five-second undo, with a sweep on next launch so an interrupted undo still collects assets. Photo casting shows progress and reports failures, which needs `makeCutout` to return whether it fell back. Play works with zero passes. Foley pills fit and move below the stage. The demo flag is set after the demo builds, not before. And sound import: accept an audio or video file, transcode when needed, reject with a plain message when there is no audio track.
*Acceptance:* the walkthrough completes with no dead end and no dialog; a held finger never changes the event count; a deleted bit is restorable for five seconds; a song file becomes a bit's sound in one tap.

**M0b. Stage internals.** 4 to 5 days [3 to 4 sessions]
The state machine with a test per transition, including transitional states for the placing modes that still exist until the halo lands. Extract the session hook, the frame loop, the gesture layer and the stage view from `Stage.tsx`; leave the bar and the kit markup inline, since both are replaced shortly. Move the per-frame clock update out of React state onto DOM refs.
*Acceptance:* the walkthrough's event sequence matches a golden recorded before the split; the commit counter is unchanged across two seconds of playback.

**M4e. Recipe v1 engine.** 3 to 4 days [2 to 3 sessions]
Everything in section 2.1 and 2.2 as pure engine work with no UI: the types, `migrate()`, reorder semantics, tombstone slots, pin re-placement, flip through the local-world transform, spring presets, and the trim render path.
*Acceptance:* a stored v0 fixture migrates and renders to the same duration and size as before; a cast after a reorder does not change draw order; removing pin 0 of two leaves a pass on pin 1 driving pin 1; a pass on a removed piece does not open a mouth; removing the last snip makes the puppet pinnable again; undo then redo of a two-event group restores both in order; a pin pass on a flipped puppet lands the pin under the finger. Pixel assertions run in the browser harness, never in Vitest, which has no canvas.

### The rest, in one line each

**M2. Stage, dock, timeline, title.** 5 to 7 days [4 to 5 sessions]. The new skeleton: title strip over the stage, fixed dock, full-width timeline with waveform and a real playhead, banners, cancellable render overlay, a turn-your-phone card until the landscape stage exists.

**M4. Halo.** 7 to 9 days [5 to 7 sessions]. On-stage selection, the halo bar, draggable feature handles with a clear removal band, the per-puppet sheet, and the deletion of the kit.

**M3. Cast.** 5 to 7 days [4 to 5 sessions]. The cast sheet, cutout progress with real bytes and a cut-out or whole-photo toggle, auto-placement so casts never stack, thumbnails, and a doodle canvas with colors, widths and an eraser. Carries the v1 version bump.

**M5. Sound.** 4 to 6 days [3 to 4 sessions]. Record with a level meter, timer, cancel and a length cap; trim handles; retake and extend as in-app sheets.

**M6. Lanes.** 8 to 10 days [6 to 8 sessions]. Passes as spans over a shared time axis, talking stripes that make the talker rule visible, mute, solo, delete, trim, punch-in, and a loop region.

**M7. Perform.** 4 to 5 days [3 to 4 sessions]. Chrome-free stage, multi-touch grabs so two people can play at once, corpse recording with a curtain reveal, body passes assigned from the puppet.

**M8. Share, remix, list.** 6 to 8 days [5 to 6 sessions]. Render sheet with progress and a poster, the last render kept, share target for bit files, duplicate, and a list that tells bits apart.

**M9. Voices.** 7 to 9 days [5 to 7 sessions]. A voice take per puppet, so two people can record their halves separately and the right mouth flaps for each.

**M10. Accessibility, platforms, onboarding.** 6 to 8 days [5 to 6 sessions]. Names and roles, keyboard, landscape stage with a per-bit aspect, three coach marks, stickers, install prompt, copy pass.

**Unscheduled: iPhone verification.** Whenever a device turns up. OPFS writable streams, H.264 encode, MediaRecorder input, getUserMedia in standalone, share sheet, share target.

**Total: 65 to 85 days, roughly 48 to 64 sessions.**

**Cut lines.** If only one thing happens, make it M1: it removes every way to lose work and every dead end, and it lets a person start a bit without talking out loud. If the goal is a legible instrument rather than a finished product, stop after M6. The full road only pays if strangers are meant to have a second session.

---

## 5. Verification

Three layers, two of which exist.

**Engine, in Vitest.** Pure functions only. Every new event kind gets: parse accepts, parse rejects malformed, semantics, determinism, migration. Nothing that reads pixels.

**Pipeline proof, in the browser.** The existing render proof stays the bit-exact guard, and gains a fixture per milestone: a v0 recipe, a trimmed bit, muted and trimmed passes, a flipped puppet, voices. Plus a determinism check that renders the demo twice and compares bytes.

**Walkthrough, in a phone-emulated Chromium.** The audit's driver becomes a CI gate. Every measurable finding gets an assertion, so the audit's table is the regression suite. Screenshots are uploaded as artifacts rather than diffed, because a boiling canvas makes pixel diffs meaningless.

The done condition is the audit's own measurement table, re-taken: no kit, no overlay past a third of the stage, a full-width timeline, 15px minimum, disabled at 40 percent opacity, at most four taps for a mouth and eyes, one event for a reorder, no hold that deletes, and a confirm plus undo on every destructive action.

---

## 6. Open questions

Defaults in bold; change any before the milestone that needs it.

1. Lanes drawn as **DOM** spans or canvas. Needed by M6.
2. Voices as **bed plus takes** or takes only. Needed by M9.
3. Keep the word **corpse** in the menu, call the armed state "blind". Needed by M7.
4. Emoji leave the chrome **entirely**. Needed by M4.
5. Puppet names **auto-assigned**, renameable. Needed by M3.
6. Story export length: **15 seconds**. Needed by M8.
7. Mic cap: **100 seconds**. Needed by M5.
8. Doodle palette: **bone, orange, blue, black**. Needed by M3.

---

## Appendix. Recipe v1 types

```ts
export const RECIPE_VERSION = 1 as const;

interface EventBase {
  id: string;                 // unique within a project; 12 hex chars for new events
  at: number;
  group?: string;             // contiguous tail run; undo pops the run, redo re-appends in order
}

export type SpringPreset = 'paper' | 'felt' | 'rubber';   // felt equals today's constants

export type PuppetSpec =
  | { type: 'cutout'; assetId: string; w: number; h: number; name?: string; spring?: SpringPreset }
  | { type: 'doodle'; strokes: number[][];
      strokeStyle?: { color: string; width: number }[];    // parallel to strokes; absent = today's look
      w: number; h: number; name?: string; spring?: SpringPreset }
  | { type: 'text'; text: string; w: number; h: number; name?: string; spring?: SpringPreset }
  | { type: 'rect'; color: string; w: number; h: number; name?: string; spring?: SpringPreset };

export interface CastEvent extends EventBase {
  kind: 'CAST'; puppetId: string; puppet: PuppetSpec;
  x: number; y: number; scale: number; rot: number;
  back?: boolean;
  flip?: boolean;             // mirrors the LOCAL FRAME: see section 2.2, not a draw-time scale
}

export interface ReorderEvent extends EventBase {
  kind: 'REORDER'; puppetId: ''; order: string[];   // back to front; unlisted follow in latest-CAST order
}

export interface PassEvent extends EventBase {
  kind: 'PASS'; puppetId: string;
  samples: number[];          // [t, x, y, ...] in show seconds and NORMALIZED STAGE coords
  piece?: number;             // snip slot
  pin?: number;               // pin slot
}

export interface PinEvent extends EventBase {
  kind: 'PIN'; puppetId: string; px: number; py: number;
  index?: number;             // re-place slot `index`; must name an existing slot
}

export interface SnipEvent extends EventBase { kind: 'SNIP'; puppetId: string; x0: number; y0: number; x1: number; y1: number }
export interface MouthEvent extends EventBase { kind: 'MOUTH'; puppetId: string; mx: number; my: number; size: number }
export interface EyesEvent extends EventBase { kind: 'EYES'; puppetId: string; ex: number; ey: number; size: number }

export type RemoveTarget =
  | { mouth: true } | { eyes: true }
  | { pin: number } | { snip: number }    // slot nulled, never compacted
  | { pass: string } | { sound: string }; // by event id

export interface RemoveEvent extends EventBase { kind: 'REMOVE'; puppetId: string; target: RemoveTarget }
export interface MuteEvent extends EventBase { kind: 'MUTE'; puppetId: ''; passId: string; muted: boolean }
export interface TrimEvent extends EventBase { kind: 'TRIM'; puppetId: ''; passId: string; from: number; to: number }

export type WireSource = 'on' | 'voice' | 'beat';
export type WireTarget = 'bounce' | 'shake' | 'lean' | 'trails' | 'foley';
export interface WireEvent extends EventBase { kind: 'WIRE'; puppetId: string; source: WireSource; target: WireTarget; amount: number }

export type SfxKind = 'boing' | 'slap' | 'honk' | 'scratch' | 'drop';
export interface SoundEvent extends EventBase { kind: 'SOUND'; puppetId: ''; sfx: SfxKind }
export interface VoiceEvent extends EventBase { kind: 'VOICE'; puppetId: string; assetId: string; durationS: number; gain?: number }
export interface DropEvent extends EventBase { kind: 'DROP'; puppetId: string }

export interface Project {
  version: typeof RECIPE_VERSION;
  id: string; title: string; createdAt: string; updatedAt: string; seed: number;
  events: RecipeEvent[];
  audio?: { assetId: string; durationS: number; trim?: { from: number; to: number } };
  sound?: { source: 'mic' | 'file'; name?: string };
  aspect?: '9:16' | '16:9';
  poster?: string;
  remixOf?: { title: string; id: string };
}

export function migrate(raw: unknown): Project;   // v0: fill updatedAt from createdAt, set version
```

Parse rules to add: ids unique; `passId` and pass or sound remove targets name an earlier event of the right kind; grouped events are contiguous; `REORDER.order` is an array of strings; `REMOVE.target` has exactly one key; `TRIM.from < TRIM.to`; `PIN.index` names an existing slot; `VOICE.durationS > 0` and `gain` in 0 to 1; `strokeStyle` length equals `strokes` length when present.

Engine tolerance: `passesFor`, `talkOpenFor` and the lanes ignore a mute, trim or remove whose target is absent from the project they are handed, because the corpse sim strips passes but keeps everything else.

---

## Verification of this deliverable

The plan lands as `docs/ux-audit/PLAN.md` on `claude/bits-ux-audit-dqik4b`, next to the audit. It changes no product code, so `npm test`, `npm run build` and `npm run test:e2e` stay green. Every claim in section 2 cites a file and line at `c9ff5a2` and was checked against the source rather than inferred. Each milestone's acceptance list is the verification for that milestone when it is built.
