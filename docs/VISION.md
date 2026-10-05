# What bits becomes

A pocket animation studio. You make a cartoon the way a band makes a song: record the voices, throw paper on the stage, perform it with your fingers, patch the music into everything, move the camera through a cardboard world, and it plays back the same every time. South Park simple to start. Trippy as you like once you're in.

Mobile first, desktop welcome. No LLM. Every frame comes from the recipe.

## The test every feature has to pass

**One mechanism, several jobs.** If a new feature needs its own concept, its own panel and its own file format, it's the wrong feature. The good ones fall out of things that already exist. bits already has five mechanisms that do this; the plan is to widen each one until it covers the whole studio, and add exactly two more.

| Mechanism | Today | Becomes |
|---|---|---|
| **Recipe** (append-only log) | undo, render, export, remix | also versions, branches ("try a take"), and the format a scene, a character or a texture is shared in |
| **Pass** (perform while it plays back) | drag a puppet | record *any* property with your finger: camera, light, texture, color, speed |
| **Wire** (signal → property, matrix not cables) | voice, beats → bounce, shake, lean | every signal into every property; the whole reactive system |
| **Scissors** (cut a line, the far side hangs) | split puppets | the one way anything becomes a usable piece: photo, video, texture, doodle |
| **Springs** (the inbetweener) | lag, lean, settle | also drives the camera, cloth-ish paper, and hinge snap; you give intent, physics gives life |
| **Sheet** (new) | — | the single kind of *thing* on stage |
| **Seed** (new) | — | the single way to *make* things without sliders |

## Sheet: one kind of thing

Everything on stage is a sheet of paper: a puppet, a background, a prop, a sky, a video, a doodle, a generated texture. A sheet has an image source, a cut outline, a position in the world, and properties you can wire or perform.

The image source is where variety lives, not the sheet:

- **photo** (camera or camera roll), cut out by segmentation or by your finger
- **doodle**, which boils on twos like hand-drawn line
- **ink**: a generated texture (below), alive and wireable
- **video**: a clip playing on the sheet

Because they're all sheets, everything works on everything: you can snip a video, pin a mouth on a texture, put googly eyes on the sky, wire the bass into a doodle's boil.

### Video upload does four jobs at once

Drop in a clip and bits offers what it can pull out of it, all from one decode:

1. **A moving cutout.** Segment the person per frame: a rotoscoped paper puppet of your friend, ready to mix with drawn ones.
2. **A performance.** Pose tracking turns their body into passes for any puppet (body passes already do this from the live camera; recorded video is the same pipeline offline, and deterministic).
3. **A texture.** Frames become an ink source: posterized, halftoned, kaleidoscoped.
4. **A signal and a soundtrack.** Its audio becomes the bit's track, and its motion (frame-difference energy, optical-flow direction) becomes signals you can wire, so the scene shakes when the video does.

## The world: a toy theater you can fly through

The answer to "2D or 3D?" is **paper in a 3D world**. Sheets stand in space like cardboard flats in a toy theater or a South Park diorama. Each sheet gets a depth. That one number buys:

- **parallax**, for free, whenever the camera moves
- **real camera moves**: dolly through the scene, orbit a character, crane up over a skyline of cutouts
- **ordering**: layering is just distance, no layer panel
- **shadows**: sheets cast soft drop shadows onto the sheets behind them, which is what makes paper read as paper
- **fog and focus**: depth tints and softens far sheets automatically

Sheets can also **fold**: a scissor cut can be a hinge instead of a dangle, so a cutout can open like a pop-up book, and a long strip can bend into a tunnel or a curved street you fly down. Hard 3D modeling never enters the picture; it's always paper.

**The camera is a puppet.** It's a sheet you see from a "director's view": drag it to perform a camera pass, put springs on it for weighty handheld moves, wire the kick drum to a punch-in. On a phone, **tilt the phone** during a camera pass and the gyro steers the shot: the device itself becomes the camera, and the gesture is recorded like any other pass.

Shots are just the camera cutting. A **cut** is a recipe event; "cut on the beat" snaps cuts to the onset grid you already compute.

## Signals: one matrix for everything reactive

A signal is a number over show time. Passes, the voice envelope, beats, frequency bands, a video's motion, the gyro, another puppet's speed, a slow wobble: all signals. A wire plays a signal into a property with an amount. That's the whole reactive system, and it's the same grid on every screen.

Sources (all computed from recorded data, so renders match previews bit for bit):

- **voice**: loudness, visemes (already)
- **music**: beats (already), plus three bands (bass, mid, air) and brightness, analysed once from the decoded track
- **finger**: any pass you performed
- **body**: pose from camera or video
- **world**: a puppet's speed, the camera's motion, distance between two sheets
- **clock**: wobble (LFO), step (on twos/threes), random-held (seeded)

Targets: every number on every sheet, ink, light and the camera.

The elegant part: **performing a pass is wiring your finger live.** It's not a separate system. And a recorded pass can be wired into anything else, so one gesture can drive a puppet's arm and, at 30%, the camera's sway and, inverted, the sky's hue.

Each wire has four controls, no more: **amount**, **smooth** (attack/release), **threshold** (only react above a level), and **delay** (echo the motion later, which makes crowds and follow-the-leader for free).

## Seed: making things without sliders

Phones are bad at forty sliders and good at choosing. So every generator works the same way:

1. **Dice** makes six variations.
2. Tap the one you like; **Breed** makes six children of it (or long-press two to cross them).
3. Keep going until it's right. Each result is just a seed and a few numbers in the recipe.

The same dice-and-breed loop makes:

- **Ink textures**: a short stack of operators (noise, stripes, cells, warp, feedback, kaleido, posterize, halftone, palette). Feedback plus warp plus the bass band is where "trippy" lives: textures that melt and breathe with the music. Every operator's numbers are wire targets.
- **Palettes**: one tap re-colors the whole scene from five swatches, so mismatched photos and doodles suddenly belong together.
- **Paper**: edge roughness, grain, fade, print misregistration. The London film's engraving, torn paper and halftone photo looks become paper presets.
- **Motion styles**: spring presets ("felt", "jelly", "stiff hinge", "on twos").
- **Scenes**: dice a backdrop from your tray: a horizon, a sky ink, three props at random depths.

Expert controls stay available behind each result for desktop users, but nobody has to open them.

## Characters, South Park simple

A character is a **kit**: body, head, eyes, mouth, optional arms, each a sheet on springs. Make one in under a minute: take a selfie, segmentation cuts the head, pick a body from the tray or doodle one, done. Then the existing magic does the work:

- mouths flap with the voice (visemes already)
- eyes blink on a seeded schedule and follow the camera or another character
- the head leans and bobs from springs and the voice envelope
- the "talker rule" (already) decides who speaks

Walks are a wire too: a "step" clock into bounce, plus a pass for the path.

## The phone grammar

Four rooms, one thumb:

- **Stage**: watch, perform, record a pass. Drag = perform, two fingers = move/scale/rotate the sheet, long press = what can this thing do.
- **Tray**: everything you've made or cut, plus Dice.
- **Wires**: the matrix, filtered to the selected sheet, signals down the side, a live meter on every source.
- **Time**: scrub, see passes as lanes, punch in.

Rules: nothing important behind a hover; every action is reachable one-handed in the bottom half; every screen opens in a working state (the demo bit is always there to poke); undo is always one tap. Desktop gets the same rooms side by side, plus keys.

## What bits refuses to become

- **A keyframe editor.** Timing comes from performing, not plotting points. Time lanes are for trimming and punch-in, not for drawing curves.
- **A node graph.** The matrix stays a matrix.
- **A 3D modeling tool.** Paper only. Depth, folds and cameras, never meshes.
- **Cloud-dependent.** On-device, offline, deterministic. Sharing is a file.

## Rendering

The stage moves to a **WebGL2 renderer** (the canvas renderer stays as the reference for tests until parity): sheets are textured quads in a perspective world, inks are fragment shaders, shadows and fog are cheap passes. Determinism stays the law: fixed step, seeded everything, signals analysed from decoded data, render reads the recipe only. Export stays WebCodecs + Mediabunny.

## Milestones

Each is one session-sized step a user can feel, with checks you can do on a phone. Every one keeps preview equal to export.

1. **Sheets everywhere.** Backdrops, props and puppets become one sheet type in the recipe (v2, with v1 migration). *Check:* old bits open and render identically; a backdrop can be snipped and wired.
2. **Depth and camera.** Per-sheet depth, perspective camera, parallax, drop shadows onto sheets behind. Camera as a performable puppet; gyro camera pass. *Check:* record a dolly with one finger and one with phone tilt; export matches preview frame for frame.
3. **The signal matrix.** Bands and brightness from the track, passes as sources, any numeric target, the four wire controls. *Check:* bass makes the sky pulse, a recorded arm pass drives the camera sway at 30%.
4. **Ink and Seed.** WebGL renderer, the operator stack, dice and breed, palettes, paper presets. *Check:* from nothing to a breathing, music-driven texture background in under a minute, on a phone.
5. **Video in.** One decode yields cutout, pose passes, texture source, audio and motion signals. *Check:* a 10 s clip of a friend dancing becomes a rotoscoped puppet next to a drawn one, both moving to the clip's audio.
6. **Kits and shots.** Selfie-to-character in a minute, auto blink and eye-follow, cuts as events with cut-on-beat. *Check:* a two-character, three-shot, 20-second scene made start to finish on a phone in ten minutes.
7. **Folds.** Hinged cuts, pop-up opening, a strip bent into a tunnel to fly through.

After that, the studio is done and what's left is mileage, the same as today.
