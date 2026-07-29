# Device smoke checklist

Run on both phones after each phase lands. Phase 0 checks:

1. Open ampactor.dev/bits in Chrome. App loads, wordmark visible.
2. Install to home screen. Icon renders (orange play, blue dot).
3. Launch from home screen: standalone window, no browser chrome.
4. Import a clip shot on this phone. It appears in the library with a size.
5. Tap the clip: first frame appears, play runs smoothly, scrub tracks the thumb.
6. Airplane mode, relaunch from home screen: library and playback still work.
7. Share a video from the gallery app to BITS: it lands in the library.
8. Delete a clip: row disappears, storage meter (when it exists) drops.

Phase 1 checks (the deck):

9. Open a clip: first frame appears; Q shows once the onset grid is ready.
10. Roll: playback runs with sound; tap flashes and drops an orange tick on the bar.
11. Hold left: blue border, footage fast-forwards, audio mutes; release resumes sound; a blue span appears on the bar.
12. Hold right: orange border, slow motion; release returns to speed.
13. Pinch: punch-in follows the fingers; double-tap resets it.
14. Stop, scrub back, roll again: ticks after the playhead disappear (rewind is undo).
15. Leave to library, reopen the clip: moves are still there (persistence).
16. Render: progress runs, then share hands the mp4 to a messaging app; the export
    matches what was performed (skips gone, slowmo stretched, punch-ins framed,
    sound present at normal speed).
17. The status line's out-duration matches the exported clip's length.

Record failures with phone model + Chrome version in an issue.
