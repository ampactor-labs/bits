# bits

A phone-first puppet-show instrument (React 19 + TypeScript strict + Vite 8), growing into the paper-cutout studio in `docs/VISION.md`. The road there is `docs/studio/PLAN.md`; read it before starting a milestone, and re-read the code it names, because a long plan is wrong in places.

## Commands

    npm ci
    npm run lint && npm test && npm run build && npm run test:budget
    npm run test:e2e     # render proof: headless Chrome through the ?e2e harness
    npm run test:ux      # the walkthrough: ~45 phases on an emulated iPhone, ~2 min

Both browser suites need a Chrome with an H.264 encoder. The Playwright Chromium in cloud containers has none, so install Chrome for Testing once and point at it:

    npx -y @puppeteer/browsers install chrome@stable --path /tmp/cft
    export PUPPETEER_EXECUTABLE_PATH=$(ls -d /tmp/cft/chrome/linux-*/chrome-linux64)/chrome

CI (`.github/workflows/deploy.yml`) runs all of the above on every PR; main deploys to ampactor.dev/bits.

## Invariants

- **The recipe is append-only and deterministic.** Every frame is a function of the recipe, its assets and t. No wall clock or `Math.random` in the engine; randomness comes from `project.seed` through `boilNoise`.
- **One frame builder.** `src/engine/frame.ts` (`createFramer`, `composeFrame`) assembles every frame; preview, export, poster and the harness all go through it and a renderer (`renderFrame2d` in `src/media/stageDraw.ts`). New per-frame features land there once, never in a caller.
- **The stage canvas holds only rendered frames.** Tool marks go on the overlay canvas (`overlayRef` in `Stage.tsx`).
- **Old bits keep opening and look the same.** Any grammar that changes pixels bumps `RECIPE_VERSION` and adds a migration; v0 and v1 fixtures stay pixel-identical (render proof checks this against a frozen legacy renderer).
- **The sim is forward-only** on a fixed 1/120 s grid; seeking rebuilds it.
- Non-negotiables from the UX audit still hold (`docs/ux-audit/PLAN.md` §1): a bottom sheet covers at most a third of the stage, every wait shows progress, every destructive action has a five-second undo, nothing instructive under 15px, blue/orange is the semantic pair, MediaPipe stays lazy.

## Landmines

- `localToWorld` rotates in normalized stage coords while drawing rotates in pixels, so pins and joints of rotated puppets on 9:16 are slightly off. Old bits depend on it; don't "fix" it. Camera and depth work in pixel space.
- Pin and snip indices are slots that never compact (passes name them by position).
- The rest camera is `null` on the frame, never an identity matrix: old bits must take the exact old drawing path. Anything a finger touches goes through `toStage` at the sheet's depth (`ui/stage/gestures.ts`).
- Trails read the previous frame, so renders draw every frame in order.
- `mixdownMono` (16 kHz, stride decimation) is baked into every bit's mouths and beats. New analysis (bands) decodes separately at native rate.
- `Stage.tsx` is large; move code out before adding to it.

## Conventions

- Commit subjects: `S<n>[letter]: lowercase phrase` for studio milestones; the body explains why and ends with the test counts.
- One PR per milestone; the owner merges.
- Write comments the way the existing ones read: why, in plain sentences.
