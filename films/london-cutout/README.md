# A Journey Through London

A ten-second cutout film in the Victorian-engraving, torn-paper style: London Eye → Thames → a fish in a top hat → the Underground → a guardsman's trumpet → Big Ben's cuckoo pigeon.

- `index.html` + `film.js`: the film. Open `index.html` and it plays in a loop with no controls. Every sprite (engravings, halftone photographs, torn paper edges, film grain) is generated from seeded noise when the page loads, so the timeline is deterministic: `window.__film.renderFrame(t)` draws time `t`.
- `london-cutout.mp4`: 1920×1080, 24 fps, 10 s, recorded frame by frame from the page.
- `record.mjs`: re-records the MP4 (`FFMPEG=/path/to/ffmpeg node record.mjs`; needs `playwright` and an ffmpeg with libx264).
- `still.mjs`: renders single stills for checking (`node still.mjs outdir 2.5 7.1`).

URL options: `?res=1` or `?res=1.5` sets render scale; `?t=3.2` shows one still.
