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

Record failures with phone model + Chrome version in an issue.
