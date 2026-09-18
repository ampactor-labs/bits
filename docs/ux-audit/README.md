# BITS UX audit

Date: 2026-09-18. Audited at commit `c9ff5a2` (main). Method: read every source file, then drove the production build in a phone-emulated headless Chromium (iPhone 14, iPhone SE size, landscape, desktop) with a fake mic and camera, walking the app as six different users. Screenshots referenced below live in `shots/`. Measurements are from the DOM, not eyeballed.

## The short version

The instrument is right. The chrome is wrong.

Everything under the hood argues for a puppet theater you hold: audio first, perform in passes, springs as the inbetweener, an append-only recipe that renders bit-exact, files as the unit of sharing. That is a strong, rare idea and the engine delivers it. But the UI wraps that idea in an editor's habits: a mode machine entered from a menu, one overloaded panel (the kit) that covers the stage it is supposed to serve, hint text at 13px, system dialogs, silent failures, and destructive gestures with no safety net. A first-time user meets a black rectangle after recording, with buttons that look enabled and do nothing.

The ten fixes that matter most, in order:

1. The kit grows past the top of the screen when a puppet is selected. On a 375x667 phone its header, the render button and the cast rail sit 123px above the viewport with no way to scroll. Blocker.
2. Disabled buttons look identical to enabled ones. After recording the bit, record and play are dead and nothing says why.
3. Holding a puppet still for 650ms deletes it. A hesitation is a delete.
4. Delete on the bits list has no confirmation and no undo, and purges assets immediately.
5. A failed render (or any error) replaces the whole stage with one line of text and no way back.
6. Casting a photo gives no feedback while an 11.5MB model downloads and segments, and failures are swallowed.
7. Play is disabled until a pass exists, so you cannot preview mouths or wires after rigging.
8. Kit buttons are the same color as the kit. They read as floating words.
9. The timeline is 74px wide on a 390px phone, with an invisible scrubber and no duration.
10. Passes are invisible. The looper model that defines the product has no track view, no mute, no solo, no delete.

The ultimate form, in a sentence: a full-bleed stage with a thumb dock, where you touch puppets instead of menus, where passes are visible lanes you can hear and mute, where sound is a first-class object you can import and trim, and where nothing you do can lose work without a one-tap undo. Section 5 spells it out.

## 1. What is already good

Say this first so the rest lands as engineering, not taste.

- **Audio-first is the right spine.** "Every bit starts with the sound" is a real product decision and it is correct for comedy timing.
- **Perform, don't keyframe.** Passes as overdubs, punch-in from the playhead, a two-beat count-in, the wings (puppets can enter and exit offstage), and the talker rule are a coherent performance model.
- **The springs feel alive.** Lag, lean, squash and settle make bad dragging look intentional.
- **Determinism.** Same recipe, same frames; preview and render agree; the recipe is append-only with undo. This is the foundation the whole vision below stands on.
- **The demo is a bit you can wreck.** A tutorial that is a real project is the best kind.
- **Bit files, asset ownership on import, OPFS persistence request, wake lock during render, the blue/orange rule, 48px targets on real buttons.** Solid craft.
- **The voice.** "no bits yet. record the sound, cast some puppets, put on the show." Keep that voice everywhere.

## 2. Six users, six walkthroughs

Each walkthrough is what actually happened in the emulated phone, plus what a real person would think at that moment.

### 2.1 Maya, 15, wants a funny clip for the group chat

Phone, impatient, has never read a README.

1. Opens the link. Lands on the demo stage. The only guidance is 13px blue text at the bottom of the stage: "▶ watch it once. then open ⋮⋮ and wreck it." (`shots/01-first-run.png`). She taps ▶. Good, it is funny.
2. Taps ⋮⋮. Twelve buttons, five add-chips and a row of emoji, on a panel that covers 83% of the stage (`shots/02-kit-open.png`). She taps a 🙂 chip to see what it is. The panel grows and now covers the entire stage, the rail of chips scrolls off the top, and she is looking at "rail order is layer order / front / back / center / drop / wires" for a puppet she can no longer see (`shots/03-kit-selected.png`).
3. She taps "bits" in the top bar, hoping it is back. It is. She taps "+ new bit". "every bit starts with the sound." She records eight seconds of her and a friend. There is no level meter and no timer, just "recording… do the bit" (`shots/06-mic-live.png`).
4. Taps done. A black rectangle. The big orange record button looks exactly as it did on the demo, but tapping it does nothing. Play does nothing. Nothing on screen says "add a puppet" (`shots/07-after-recording.png`).
5. She finds ⋮⋮ again, taps ＋, picks a selfie. On a real phone the segmentation model (11.5MB) now downloads with zero feedback. She taps ＋ again. Eventually two copies of her face land at the exact same spot in the middle of the stage.
6. She wants her face to look at her friend's. There is no flip.
7. She taps "mouth". The kit closes. "tap where the mouth goes" appears at the bottom in 13px. She taps the mouth. Now she wants eyes: open kit, tap eyes, tap face. Three taps per feature, every time.
8. Taps ⏺. A count-in ticks (nice). She drags her face around. A row of pills ("boing slap honk scrtch dro") has appeared over the bottom of the stage, clipped on both ends, and she honks by accident reaching for her friend's puppet (`shots/08-recording-foley.png`).
9. Stops. Plays. Her puppet's mouth moves only while she was holding it. Her friend's puppet, which has a mouth, is silent. "Why doesn't he talk?" There is no answer anywhere in the app. She records a second pass holding him, and now hers goes quiet during that stretch. She thinks it is a bug. It is the talker rule, and it is a good rule, but it is invisible.
10. Render, share. The clip is charming. The road to it took twelve minutes and three "is this broken?" moments. She sends it. Whether she comes back depends on step 4 and step 9.

### 2.2 Dev, 34, musician and animator, the "instrument" audience

He reads the README, gets the overdub metaphor immediately, and is the person the engine was built for.

- Loves: count-in, punch-in from the playhead, corpse mode, the fact that renders match the preview, bit files.
- Wants on day one and cannot have: a waveform, importing a track he already has, looping four seconds to practice a move, seeing his passes as lanes, muting or deleting the third of five passes, precise scale and rotation, a per-puppet "how floppy" control, more than five foley sounds, 1080p.
- Finds: a 74px timeline (measured on a 390px phone, `.bar .progress`), an invisible scrubber, wires shown as `bounce ·` and `bounce ··` with tap-to-cycle and no indication it is a three-state control, and undo as the only editing operation.
- His verdict: "This is a great engine wearing a prototype."

### 2.3 Priya and Theo (6), pass the phone on the couch

Theo draws, Priya records the voices. This is the multiplayer-on-one-phone story from the README, and it is where the safety gaps bite.

- Theo draws a blob, keeps it, then holds his finger on it to "hold" it. 650ms later it vanishes with a short buzz (`Stage.tsx:88`, `Stage.tsx:744-750`). No toast, no "undo" offer. Priya finds ↺, but Theo has already tapped three other things.
- Doodles are one color and one width, with no eraser and no per-stroke undo (only "cancel" which throws away the whole drawing).
- Two-finger resize and rotate is hard for small hands, and there is no other way to resize.
- Back on the list, Theo scrolls with his thumb and hits the ✕ inside a row. The bit is gone, assets purged, no confirmation (`Shows.tsx:102-113`).
- Corpse mode is the party game they would love. It is a candle emoji in a row of twelve buttons and its state is invisible once the kit is closed.

### 2.4 Sam, 48, low vision, sometimes a screen reader, often 200% zoom

- All mode guidance is 13px (`styles.css:180`). It sits at the bottom of the stage where puppets and the cancel pill cover it (`shots/03-kit-selected.png` shows the cat over the hint).
- The cast chips are unlabeled emoji. A text puppet and a photo puppet are both 🙂; three doodles are three ✏️ (`Stage.tsx:1161-1162`). No `aria-label`, no thumbnail.
- Disabled controls have no visual state at all (no `:disabled` rule exists in `styles.css`; measured opacity 1, identical colors).
- The scrubber is an `opacity: 0` range input over an 8px bar (`styles.css:282-289`). There is no playhead handle.
- On desktop nothing on the stage is keyboard reachable; there is no space-to-play, no shortcut for record or undo; the canvas has no text alternative.
- Contrast is actually fine (muted text measures about 6:1). Size and labeling are the problem, not color.

### 2.5 The returning user, a month later

- Nine rows that all say "untitled bit", distinguishable only by pass count (`shots/04-list.png`). No date, no duration, no thumbnail. Every new bit is created as "untitled bit" (`Stage.tsx:95`, `Stage.tsx:210`) and the stage never shows or lets you edit the title; renaming is a `window.prompt` on the list (`Shows.tsx:117`).
- Wants to duplicate a bit to try a different take: no duplicate.
- Wants to remember which one had the good cat: no poster frame.

### 2.6 The iPhone person

The pitch says "for phones"; the smoke checklist says Chrome. Safari support was not verifiable in this environment and the code leans on `FileSystemFileHandle.createWritable` (OPFS), WebCodecs H.264 encode, and `MediaRecorder` webm/opus. Either verify on a current iPhone and fix what breaks, or say "Android Chrome" on the tin. An install prompt that leads to a broken app is worse than no install prompt.

## 3. Findings, ranked

Severity: **Blocker** (stops a user or loses work), **Major** (a core flow is confusing or clunky), **Minor** (polish). Each has evidence and a proposed fix. Line numbers refer to `c9ff5a2`.

### 3.1 Layout and the kit

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| F1 | Blocker | The kit has no max height and no scroll (`styles.css:299-310`). Selecting a chip adds two rows and the panel grows upward past the top bar. On 375x667 the kit top measures −123px; the header, render button and rail are off-screen (`shots/11-se-kit-selected.png`). | `.kit{position:absolute;bottom:70px}` with no `max-height`/`overflow` | Short term: `max-height: calc(100% - 80px); overflow-y:auto`. Real fix: replace the kit (section 5). |
| F2 | Blocker | Even unselected, the kit covers 83% of the stage (measured). With a selection it covers 100%. You rig and reorder a puppet you cannot see. | `shots/02-kit-open.png`, `shots/03-kit-selected.png` | Contextual actions on the puppet itself; a short bottom sheet that never covers more than a third. |
| F11 | Major | Kit buttons use `background: var(--panel)` (`styles.css:68`); the kit is `color-mix(panel 92%)` (`styles.css:305`). Buttons are invisible against the panel and read as floating text. | `shots/02-kit-open.png` | Give kit buttons a distinct surface token (a lighter step) and a visible pressed state. |
| F9 | Major | The tools row mixes editing modes (snip, mouth, eyes, pin, body), stage effects (trails, foley), a recording option (corpse), audio retake/extend, export (bit file) and redo, in one wrapping row of twelve (`Stage.tsx:1441-1481`). Redo is three taps away; undo is on the bar. | `shots/02-kit-open.png` | Group by intent: Cast / Rig / Sound / Share. Put redo next to undo. |
| F10 | Major | Every placement closes the kit and drops to idle (`enterMode` `Stage.tsx:1164-1172`; kit renders only when `mode === 'idle'`, `Stage.tsx:1340`). Mouth plus eyes plus snip on one puppet costs nine taps. | Walkthrough 2.1 step 7 | Keep the context open after an action; or better, make features handles on the puppet. |
| F17 | Major | The foley row overflows the stage width and clips both end pills at 390px ("oing", "dro"), and covers the bottom 60px of the stage during every recording whether or not foley is wanted (`styles.css:377-392`, `Stage.tsx:1207-1224`). | `shots/08-recording-foley.png` | Move foley to the dock (below the stage) as a collapsible strip; fit five pills or scroll. |
| F26 | Major | Landscape shrinks the 9:16 stage to a box about 300px tall (`styles.css:151-160`). | `shots/10-landscape.png` | Lock to portrait in the manifest, or offer a landscape stage with 16:9 export. |
| F25 | Major | Hint text is 13px at the bottom of the stage (`styles.css:175-183`) where puppets and the cancel pill overlap it. | `shots/03-kit-selected.png` | A 15px+ banner at the top of the stage with the cancel affordance built in. |
| F14 | Major | The timeline is 74px wide on a 390px phone (measured `.bar .progress`): six pixels per second on a 12s bit. The scrubber is `opacity: 0` with no thumb; only current time is shown, never duration. | `styles.css:282-289`, `Stage.tsx:1299-1319` | Give the timeline its own full-width row under the stage; show a playhead handle and `0:04 / 0:12`; draw the waveform. |
| F35 | Minor | Render progress lives only in the kit header button; closing the kit hides it. | `Stage.tsx:1349-1366` | Progress as an overlay on the stage with a cancel. |

### 3.2 Controls and affordances

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| F3 | Blocker | No `:disabled` style exists. After recording the bit, ⏺ and ▶ are disabled (`Stage.tsx:1280`, `Stage.tsx:1288`) but look identical to enabled (measured: opacity 1, same colors). No hint appears on an empty stage. | `shots/07-after-recording.png` | Style disabled (40% opacity), and show "cast a puppet to start" on the empty stage with a direct ＋ button. |
| F8 | Major | Play requires a pass (`Stage.tsx:1288`). After rigging mouths and wires you cannot hear the bit and watch them react until you record something. | Walkthrough 2.1 | Enable play whenever audio exists. A puppet with no passes already talks freely (`show.ts:151-155`), so this just works. |
| F13 | Major | There is no selection on the stage. Tapping a puppet drags it; selection lives only in the rail chip, which does not say which puppet it is. | `Stage.tsx:719-752` | Tap selects and shows a halo; drag moves; selection highlights the matching chip. |
| F12 | Major | Chips are emoji glyphs (`chipGlyph`, `Stage.tsx:1161-1162`): text and photos are both 🙂, doodles all ✏️; no thumbnails, no labels. | `shots/02-kit-open.png` | Render a tiny thumbnail per puppet (the drawer already exists); label with an index or name. |
| F18 | Major | Every photo lands at (0.5, 0.55) at width 0.38 (`Stage.tsx:930-946`); every text at (0.5, 0.2) (`Stage.tsx:1397-1398`). Repeated casts stack exactly. No flip, no duplicate, no nudge, no numeric scale. | Walkthrough 2.1 step 5 | Auto-offset new casts; add flip and duplicate to the halo; a slider for scale in the halo's "more". |
| F19 | Major | Mouths, eyes, pins and snips cannot be moved or removed except by undo. Mouth and eyes are "latest wins"; pins and snips accumulate. | `recipe.ts`, `show.ts:86-103` | Features become handles: drag to move, drag off the puppet to remove. Add `UNMOUTH`/`UNPIN`/`UNSNIP` events or a generic `REMOVE` event. |
| F20 | Major | "back" re-casts every other puppet (`Stage.tsx:1045-1050`): N events for N other puppets, so undo takes N steps. Measured: with two other puppets in the cast, one tap on "back" appended two events. | `Stage.tsx:1045` | Add a `layer` or `order` field to CAST, or a single `REORDER` event. |
| F21 | Major | `window.prompt` for text puppets (`Stage.tsx:1388`) and rename (`Shows.tsx:117`); `window.confirm` for retake (`Stage.tsx:1090`). System dialogs break the instrument feel and look different in a standalone PWA. | | In-app sheets with the app's voice. |
| F31 | Major | Wire levels are shown as `bounce ·` and `bounce ··` (`Stage.tsx:1060`) with tap-to-cycle. Nothing signals a three-state control. | `shots/03-kit-selected.png` | A three-segment control (off / gentle / wild) or a tiny slider. |
| F30 | Minor | Snap uses the rear camera (`capture="environment"`, `Stage.tsx:1499`) although the pitch is "photos of yourselves". | | `capture="user"`, or let the OS camera decide. |
| F34 | Minor | "scrtch" (`Stage.tsx:1220`). | | "scratch", once it has room. |
| F38 | Minor | No keyboard on desktop: no space to play, no R to record, no Z to undo. | | Add shortcuts; they cost little. |

### 3.3 Feedback and errors

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| F4 | Blocker | Any error replaces the entire stage with one line of text (`if (error) return <p className="error">`, `Stage.tsx:1158`). A failed render leaves no stage, no bar, no retry. | `shots/09-render-error.png` | Errors are a dismissible banner over the stage. The project is untouched, so the stage should stay. |
| F7 | Blocker | `castPhoto` shows nothing while the segmenter loads (11.5MB wasm plus model, `cutout.ts:13-29`) and segments. Errors are unhandled: `void castPhoto(...)` (`Stage.tsx:1491`, `Stage.tsx:1502`, `Stage.tsx:1512`), so a HEIC or decode failure shows nothing. | Nothing to screenshot: the screen does not change, which is the finding. | A progress chip on the rail while cutting out; catch and toast errors; say "no person found, kept the whole photo" when the fallback fires. |
| F23 | Major | The mic screen has no level meter, no timer, no cancel, no maximum length (`Stage.tsx:1198-1205`, `mic.ts`). A muted mic looks like success. | `shots/06-mic-live.png` | Live level bar, elapsed time, cancel, and a gentle cap (60s) with a warning. |
| F24 | Major | Silent refusals: a mouth or eyes tap off-puppet does nothing (`Stage.tsx:624`); pin on a doodle or snipped puppet buzzes and exits (`Stage.tsx:684`) with no message. Measured: pin mode on a doodle returned to idle with no hint and no error. | walk2 notes | Say why, in the banner: "pins only bend uncut photo puppets". |
| F16 | Major | The talker rule (`show.ts:151-155`) is invisible: a mouthed puppet stops talking after its first pass unless a pass covers the moment. Neither the demo hint nor any UI explains it. | Walkthrough 2.1 step 9 | Show talking spans in the lanes; a one-time coach mark the first time a puppet with a mouth gets its first pass. |
| F29 | Minor | Corpse, foley and trails have no visible state when the kit is closed; corpse is session state (`Stage.tsx:108`), not saved. | | Show active modes as chips on the dock; persist corpse as a project flag or drop it into the record button's long-press. |
| F36 | Minor | The rendered file is discarded on any edit; there is no "last render" to reshare. | `applyProject` `Stage.tsx:163-179` | Keep the last render until the recipe changes, and say so. |

### 3.4 Destructive actions and safety

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| F5 | Blocker | Long-press (650ms, `Stage.tsx:88`) with less than 1.5% movement drops the puppet (`Stage.tsx:744-750`). A hesitation is a delete. Reproduced: a 900ms hold appended a `DROP`. | walk notes: `last: "DROP"` | Long-press opens the halo (or does nothing). Delete lives in the halo behind a confirm or with an undo toast. |
| F6 | Blocker | List delete has no confirmation and purges assets immediately (`Shows.tsx:102-113`). The ✕ is a 40px target inside a row that is itself a tap target. Reproduced: no dialog, row gone. | walk notes: `delete confirm dialogs: []` | Swipe-to-delete or a confirm sheet, plus a 5-second undo toast; move ✕ out of the row's tap area. |
| F27 | Major | The first-run flag is written before the demo is built (`Shows.tsx:59-71`). Any failure or cancellation loses the tutorial forever. Reproduced in dev via StrictMode's double effect; on a device a slow encode plus a tab switch does the same. | | Set the flag after `buildDemoShow` resolves. Also offer "open the demo" from the empty list. |
| F37 | Minor | Rename and delete share `className="delete"` and sit inside the tappable row (`Shows.tsx:160-183`). | `shots/04-list.png` | Row actions in an overflow, or swipe actions. |

### 3.5 Discoverability and language

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| F22 | Major | The bit has no title on the stage; every bit is "untitled bit"; the list shows only pass count. | `shots/04-list.png` | Title field in the stage header; list rows with poster frame, duration, date. |
| F32 | Major | The back control is labeled "bits" next to the "BITS." wordmark. | `App.tsx:15-17` | "‹ bits" with a chevron, or replace the top bar with the title and a back chevron. |
| F15 | Major | Passes are invisible. The product's central object has no representation on screen beyond a count in the kit header. | | Lanes (section 5.4). |
| F28 | Major | Sound can only come from the mic (`Stage.tsx:1183-1197`). No voice memo, song, or video audio. | `shots/05-needs-audio.png` | "record" and "use a file" on the first screen; accept audio and video files and strip the audio. |
| F33 | Minor | Manifest and meta description still say "A video instrument. Perform the edit." (`public/manifest.webmanifest:4`, `index.html:7`), phase-0 copy. | | "A puppet show instrument. Record the bit, cast puppets, perform in passes." |
| F39 | Minor | Jargon with no in-app definitions: bit, pass, cast, kit, wires, corpse, foley, snip, pin, body, trails. | | Keep the words (they are good), add first-use coach marks and a one-screen "how to bits" reachable from the list. |

### 3.6 Accessibility

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| F40 | Major | Chips, kit buttons with emoji, and the foley pills have no `aria-label`; the canvas has no text alternative; nothing on the stage is focusable. | Labels on everything; a visually hidden description of the cast for the canvas; focus order through dock and halo. |
| F41 | Major | 13px is the only size used for guidance. | Minimum 15px for anything that instructs. |
| F42 | Minor | Vibration is the only feedback for several outcomes (`vibrate(40)` on refusal); iOS has no vibration API. | Pair every haptic with a visible change. |

## 4. Why the kit fails, structurally

It is worth naming the pattern, because fixing findings one by one will not fix it.

The kit is a **mode menu**: you open a panel, pick a mode, close the panel, act on the stage, and drop back to idle. That is how desktop editors work when they have a toolbar and a big canvas. On a phone the panel and the canvas are the same 390px, so the panel must cover the canvas, so every action becomes open, choose, close, act, repeat. The measurements make this concrete: 83% coverage unselected, 100% selected, three taps per feature, twelve tools in one row.

The instrument metaphor suggests the opposite structure. You do not open a menu to choose "hand"; you touch the puppet. The actions that belong to a puppet (mouth, eyes, snip, pin, flip, layer, drop) should appear on the puppet. The actions that belong to the show (record, play, scrub, undo, cast someone new, render) should live in one thumb-height dock that is always there. The actions that belong to the sound (retake, extend, import, trim) belong with the timeline. Once things live where they belong, the kit has nothing left in it.

## 5. The ultimate form of BITS

Principles first, then the concrete shape, then what not to build.

### 5.1 Principles

1. **The stage is the screen.** Chrome floats over it and gets out of the way; nothing ever hides more than a third of it.
2. **Touch the thing, not the menu.** Puppets, mouths, eyes, pins, pieces and pass spans are all direct-manipulation objects.
3. **Everything performed is visible and reversible.** Passes are lanes. Every destructive action is an undo toast, never a dialog and never silent.
4. **Sound is an object.** You can see it, import it, trim it, and say who is talking.
5. **Feedback for every wait.** Model loads, cutouts, renders and recordings all show progress and time.
6. **Keep the identity.** No timelines with keyframes, no accounts, no server, no generated pixels, no merge. Files stay the unit of sharing. The recipe stays append-only.

### 5.2 The stage and the dock

```
┌──────────────────────────────────────┐
│ ‹ bits        the cat argument   ⋯   │   title is editable; ⋯ holds share/render/bit file/help
│┌────────────────────────────────────┐│
││                                    ││
││          (full-bleed 9:16          ││
││           stage, edge to edge)     ││
││                                    ││
││        [halo appears on tap]       ││
││                                    ││
│└────────────────────────────────────┘│
│ ▁▂▃▅▂▁▃▆▂▁ ▏▏▏  0:04 / 0:12          │   waveform + beat ticks + visible playhead, full width, draggable
│  ↺   ↻      ⏺        ▶      ＋       │   thumb dock: undo, redo, record, play, cast
└──────────────────────────────────────┘
```

- The dock never changes shape. Record becomes stop while busy; the rest dim.
- The waveform row is the timeline. Drag anywhere to scrub. Pull it upward and it expands into lanes (5.4).
- ＋ opens a short cast sheet (a third of the screen at most): photo, selfie, doodle, text, backdrop, sticker. Each tile shows what it will do and its cost ("cutting out… 3s" the first time).
- ⋯ holds the rare things: render and share, bit file, retake or extend sound, help.
- Landscape locks to portrait until a landscape stage exists; when it does, it exports 16:9.

### 5.3 The halo: puppets carry their own tools

Tap a puppet and a ring appears around it. Drag still drags; pinch still resizes and rotates; long-press opens the halo too and never deletes.

```
            ◯ mouth      ◯ eyes
        ◯ snip                 ◯ pin
            ◯ flip       ◯ more…
                 [ puppet ]
                    ◯ layer ▲▼   ◯ drop (with undo toast)
```

- Choosing "mouth" does not enter a mode you must escape. The mouth appears at the puppet's center as a handle; drag it into place; drag it off the puppet to remove it. Same for eyes and pins. Snip draws a scissor line from the halo; the piece then has its own tiny handle so it can be grabbed in a pass.
- The ring explains refusals in place: "pin" is dimmed on a snipped puppet with "cut paper or bend it, not both" on press.
- "more…" is the small sheet with wires (three-segment controls with names: gentle, wild), scale slider, duplicate, and a "how floppy" spring preset (paper, felt, rubber).
- The halo is the whole rig surface. The kit's rig row, layer row and wires row all disappear into it.

### 5.4 Lanes: the looper becomes visible

Pull the timeline up and each puppet gets a lane. Passes are colored spans. Talking spans are drawn as a mouth stripe so the talker rule is something you see, not something you infer.

```
 cat     ▓▓▓▓▓▓░░░░░░░░▓▓▓▓▓▓▓▓░░░░░   ← body passes (solid) ; mouth stripe under them
 guy     ░░░▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░
 head    ░░░░░░░░░░░░░▓▓▓░░░░░░░░░░░   ← a piece or pin gets its own sub-lane
 foley   ·    ·        ·     ·         ← performed sounds; drag to nudge
```

- Tap a span: solo, mute, delete, or "punch in here" (sets the playhead to its start and arms record).
- Drag a span's ends to trim it. Mute and trim are new recipe events (`MUTE_PASS`, `TRIM_PASS`); the append-only model survives untouched.
- Loop: drag across the timeline to set a region; play and record loop inside it. This is how you practice a move.
- Record still works the old way with lanes closed. Lanes are for the second look, not the first take.

### 5.5 Sound as an object

- The first screen offers **record** and **use a file**. Files can be audio or video; video is stripped to its audio.
- Recording shows a level meter, elapsed time, and cancel. A count-in before recording is optional.
- Trim handles on the waveform (a `TRIM_AUDIO` recipe field, no destructive edits).
- **Who is talking.** Two ways, both explicit: paint talking spans directly on a puppet's mouth stripe; or record each voice as its own take on the mic screen ("record cat's lines", "record guy's lines") and the mouth for each puppet follows its own track. The second is the long-term answer: it makes the talker rule literal and it lets two people record their halves separately.
- Retake and extend live behind ⋯, with in-app confirmation sheets in the app's voice.

### 5.6 Casting, richer and safer

- Photo casting shows a progress ring on the new chip while the model loads and segments, then a one-tap toggle between "cut out" and "whole photo". The first-run model download is announced once ("getting the scissors, 11MB, once").
- Selfie camera by default for "snap"; rear camera one tap away.
- Doodle: four colors, two widths, eraser, per-stroke undo, keep.
- Stickers: a small built-in set (hats, glasses, props) as ordinary doodle-type puppets.
- Every cast lands offset from the last, never stacked; duplicate and flip in the halo.
- Chips become thumbnails; the selected puppet on stage and its chip highlight together.

### 5.7 Perform mode and the party

- **Perform**: one tap hides all chrome; the stage goes edge to edge; a two-beat pulse shows the count-in; hand zones on the left and right halves are drawn faintly so two players know their side. Stop is a swipe down.
- **Corpse** becomes a mode on the record button (long-press ⏺: "record blind") with a reveal moment: the stage stays dark until playback, then curtains open. Its state is visible on the dock while armed.
- **Body** keeps its assignment flow but assigns from the halo ("this puppet: my right hand"), with the camera preview mirrored in a corner and a big stop.

### 5.8 Sharing and the remix loop

- Render is a sheet with a progress bar, a poster frame, and share or save. The last render is kept until the recipe changes.
- Bit files stay the unit. Add the share-target route back so a received `.bit.json` opens straight into the list, and a QR or nearby-share path for the room.
- Remix chain: an imported bit remembers where it came from ("remixed from Dev's cat argument") as recipe metadata, not a server.
- Story-sized export: "render the last 15 seconds" and 16:9 when a landscape stage exists.

### 5.9 Onboarding as play

- The demo stays and stays wreckable. It gains three coach marks that fire once, on the real events: first tap on a puppet ("this is a puppet, drag it"), first pass ("your move is a pass, it plays back with the sound"), first mouth plus first pass ("a puppet talks while you hold it").
- The empty stage after recording says what to do next and does it in one tap.
- "how to bits" lives on the list as a card, not only as a 13px line.

### 5.10 What not to build

- No keyframes, no curves, no per-property timelines. Lanes show performances; they do not become an editor.
- No accounts, no cloud, no merge. Pass-the-theater is the collaboration model, and it is a feature.
- No generated pixels. Cutouts and doodles are the aesthetic.
- No settings screen. Preferences live where they act (spring preset in the halo, quality in the render sheet).

## 6. Roadmap

### Now: stop the bleeding (about a week)

1. F1 kit max-height and scroll (one CSS rule) as a stopgap.
2. F3 disabled styles plus an empty-stage prompt with a ＋.
3. F5 long-press no longer drops; drop moves into a confirm or an undo toast.
4. F6 confirm plus undo toast on list delete; move ✕ out of the row tap area.
5. F4 errors as a banner, stage stays.
6. F7 progress chip and error toasts for photo casting; catch every `void` promise.
7. F8 play whenever audio exists.
8. F11 kit button surface token.
9. F17 foley row fits and moves below the stage.
10. F27 set the demo flag after the build resolves; add "open the demo" to the empty list.
11. F33 manifest and meta copy.

### Next: make it legible (two to three weeks)

- Title on the stage header; list rows with poster frame, duration, date; F22, F32.
- Chips as thumbnails with labels; on-stage selection synced to chips; F12, F13.
- Halo with mouth/eyes/pin handles, flip, duplicate, layer, drop; F10, F18, F19, F20.
- Full-width timeline row with waveform, playhead handle and duration; F14.
- Hint banner at 15px at the top of the stage; in-app sheets replace prompt and confirm; F21, F25.
- Wires as named three-segment controls; F31.
- Mic screen with meter, timer, cancel; F23.
- Auto-offset casts; selfie camera default; F30.

### Later: the looper is visible (about a month)

- Lanes with mute, solo, delete, trim, punch-in; talking spans; loop region; F15, F16.
- Sound import and trim; F28.
- Perform mode; corpse on the record button; body assignment from the halo.
- Accessibility pass: labels, focus order, keyboard; F40 to F42.

### Someday

- Voices per puppet as separate takes.
- Share target and nearby share for bit files; remix chain metadata.
- Landscape stage and 16:9 export.
- Stickers.
- iOS Safari verification, or a clear "Android Chrome" statement on the site.

## 7. Appendix: measurements

Taken on the production build with an emulated iPhone 14 (390x844) unless noted.

| Measurement | Value |
|---|---|
| Kit coverage of the stage, nothing selected | 83% |
| Kit coverage, puppet selected | 100%, rail scrolled off screen |
| Kit top edge on 375x667 with a puppet selected | −123px (above the viewport) |
| Render button top on 375x667 with a puppet selected | −111px |
| Timeline width | 74px |
| Scrubber opacity | 0 |
| Guidance text size | 13px |
| Disabled button opacity | 1 (identical to enabled) |
| Tools in the kit's last row | 12 |
| Taps to add a mouth and eyes to one puppet | 6 (open kit, mouth, tap, open kit, eyes, tap) |
| Events appended by "back" with one other puppet | 2 (N for N puppets) |
| Hold time that deletes a puppet | 650ms, under 1.5% movement |
| Confirmation before list delete | none |
| Foley pills clipped at 390px | 2 of 5 |
| Time from tapping ⏺ start in body mode to recording | 1.8s (model cached) |

### Screenshot index

- `shots/01-first-run.png` first exposure, the demo stage and its 13px hint
- `shots/02-kit-open.png` the kit: twelve tools, unlabeled chips, buttons on a same-color panel
- `shots/03-kit-selected.png` the kit with a puppet selected: covers the stage, rail gone
- `shots/04-list.png` the bits list
- `shots/05-needs-audio.png` new bit, sound first, mic only
- `shots/06-mic-live.png` recording with no meter, timer or cancel
- `shots/07-after-recording.png` the black stage, disabled buttons that look enabled
- `shots/08-recording-foley.png` recording with the clipped foley row over the stage
- `shots/09-render-error.png` a failed render replaces the whole stage
- `shots/10-landscape.png` landscape
- `shots/11-se-kit-selected.png` iPhone SE size, the kit's header and rail above the screen

### How to reproduce

```
npm ci && npm run build && npx vite preview --port 4173
```

Then open `http://localhost:4173/bits/` in Chrome's device mode as an iPhone 14, and follow walkthrough 2.1. The headless driver used for this audit launched Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` so the mic and camera flows run unattended.
