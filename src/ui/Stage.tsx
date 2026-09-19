// The stage, whole instrument: record the bit, cast puppets (photo, snap,
// doodle, backdrop), snip them apart, pin mouths and googly eyes, then
// perform in passes from any point on the playhead. Grab a body or a
// snipped-off piece; hold the talker and its mouth speaks.
//
// While idle a tap selects and a drag moves. A selected puppet wears its
// own tools (the halo) and its features become handles you can take hold
// of. Two fingers resize and rotate.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendEvent,
  createProject,
  parseProject,
  serializeProject,
  type CastEvent,
  type PassEvent,
  type Project,
  type PuppetSpec,
  type RecipeEvent,
  type RemoveTarget,
  type SpringPreset,
} from '../engine/recipe';
import { detectOnsets } from '../engine/onsets';
import { IMPACT_SQUASH, impactSfx, renderSfx, type SfxName } from '../engine/sfx';
import { computeVoiceTrack, EMPTY_VOICE, type VoiceTrack } from '../engine/envelope';
import { pointInPoly } from '../engine/pieces';
import {
  castOf,
  createShowSim,
  eyesOf,
  localToWorld,
  mouthOf,
  pinsOf,
  sameChannel,
  snipsOf,
  worldToLocal,
  type Channel,
  type PuppetPose,
  type ShowPuppet,
  type ShowSim,
} from '../engine/show';
import { restingPuppet } from '../engine/puppet';
import { AudioSourceHandle, JamAudio, concatAudio, mixdownMono } from '../media/audio';
import { getAsset, saveAsset } from '../media/assets';
import { exportBundle } from '../media/bundle';
import { makeCutout } from '../media/cutout';
import { MicRecorder } from '../media/mic';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { PoseDriver } from '../media/pose';
import {
  effectiveWires,
  trailStrength,
  wireAmount,
  wireModsFor,
  type WireMap,
  type WireMods,
} from '../engine/wires';
import type { WireSource, WireTarget } from '../engine/recipe';
import { BannerView, useBanner } from '../kit/Banner';
import { Sheet } from '../kit/Sheet';
import { useToast } from '../kit/Toast';
import { ProgressRing } from '../kit/Controls';
import {
  NoSoundInFileError,
  SOUND_FILE_ACCEPT,
  importSoundFile,
  soundExtension,
} from '../media/audioImport';
import { peaksFromMono } from '../engine/peaks';
import { puppetLabel } from './stage/CastChip';
import { Dock } from './stage/Dock';
import { Halo, type HaloAction } from './stage/Halo';
import { Handles, type HandleSpec } from './stage/Handles';
import { CastSheet, type CastKind } from './stage/sheets/CastSheet';
import { MoreSheet } from './stage/sheets/MoreSheet';
import { ShowMenu } from './stage/sheets/ShowMenu';
import { TitleBar } from './stage/TitleBar';
import { Timeline } from './stage/Timeline';
import { countCommit, probe } from '../e2e/probe';
import {
  RenderCancelled,
  voiceMap,
  renderShow,
  visualsOf,
  type RenderProgress,
} from '../media/render';
import { shareOrDownload } from '../media/shareFile';
import { drawStage, loadStageImages, type PuppetVisual, type StageImages } from '../media/stageDraw';

type Mode =
  | 'loading'
  | 'needsAudio'
  | 'micLive'
  | 'idle'
  | 'playing'
  | 'recording'
  | 'doodling'
  | 'snipping'
  | 'mouthing'
  | 'eyeing'
  | 'pinning';

interface Grab {
  puppetId: string;
  channel: Channel;
  samples: number[];
  x: number;
  y: number;
}

interface BodyMap {
  right: { puppetId: string; channel: Channel } | null;
  left: { puppetId: string; channel: Channel } | null;
}

interface StagingDrag {
  puppetId: string;
  x: number;
  y: number;
  scale: number;
  rot: number;
  /** Finger-to-home offset at the moment of the grab. Without it the
   *  puppet snaps its centre to the fingertip on the first move, which was
   *  invisible only because the drag used to start on contact. */
  dx: number;
  dy: number;
  pinch: { baseDist: number; baseAngle: number; baseScale: number; baseRot: number } | null;
}

const newId = () => crypto.randomUUID().slice(0, 12);
const LONG_PRESS_MS = 500;
const HOLD_SAMPLE_S = 0.25;
/** A tap is a release that never travelled this far. In CSS pixels, not a
 *  fraction of the stage: the old normalised threshold gave nearly twice
 *  the slop vertically as horizontally on a 9:16 stage. */
const DRAG_PX = 6;
/** How near a finger has to land to take hold of a feature. */
const HANDLE_HIT_PX = 22;

type HandleKey = 'mouth' | 'eyes' | `pin:${number}`;

interface HandleDrag {
  key: HandleKey;
  puppet: ShowPuppet;
  /** Live position in normalised stage coords. */
  x: number;
  y: number;
  /** True while the finger is far enough outside the puppet to remove it. */
  outside: boolean;
}

/** How far outside its own box a feature has to be dragged to come off.
 *  A fifth of the box either way: far enough that nudging a mouth to the
 *  chin never throws it away, near enough to find without aiming. */
const REMOVE_BAND = 0.2;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function Stage({ showId, onBack }: { showId: string; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [projectSnap, setProjectSnap] = useState<Project>(() => createProject('untitled bit'));
  const projectRef = useRef(projectSnap);

  // The walkthrough reads the recipe through here and counts commits, so a
  // refactor that quietly changes what a flow records, or that starts
  // re-rendering every frame, fails in CI rather than on a phone.
  useEffect(() => {
    probe.project = () => projectRef.current;
    probe.stage = () => ({
      selectedId: selectedIdRef.current,
      poses: Object.fromEntries(
        [...lastPosesRef.current].map(([id, pose]) => [id, { x: pose.root.x, y: pose.root.y }]),
      ),
    });
    return () => {
      probe.project = null;
      probe.stage = null;
    };
  }, []);
  useEffect(() => countCommit());

  const [mode, setMode] = useState<Mode>('loading');
  const modeRef = useRef<Mode>('loading');
  /** The playhead is written to the DOM sixty times a second. Keeping it in
   *  React state re-rendered the whole stage every frame; `t` now only
   *  carries the value between scrubs, and the loop paints through refs. */
  const [t, setT] = useState(0);
  const timeTextRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const banner = useBanner();
  /** Errors are a banner over a stage that stays mounted. Replacing the
   *  whole screen with one line of text left no way back (audit F4). */
  const bannerRef = useRef(banner);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  bannerRef.current = banner;
  const fail = useCallback(
    (err: unknown) =>
      bannerRef.current.error(err instanceof Error ? err.message : String(err)),
    [],
  );
  /** Casting a photo can take seconds on a cold model; say so. */
  const [casting, setCasting] = useState(false);
  /** Set when the stored recipe would not parse: the bytes are kept and
   *  offered back rather than overwritten. */
  const [damagedRaw, setDamagedRaw] = useState<string | null>(null);
  /** In-app sheets replace window.prompt and window.confirm: a system
   *  dialog breaks the instrument feel and looks foreign in a PWA. */
  const [sheet, setSheet] = useState<
    | null
    | { kind: 'text' }
    | { kind: 'retake'; mode: 'replace' | 'extend' }
    | { kind: 'cast' }
    | { kind: 'more' }
    | { kind: 'show' }
  >(null);
  const [textDraft, setTextDraft] = useState('');
  /** dropPuppet is defined above undo; this keeps the toast's undo honest. */
  const undoRef = useRef<() => void>(() => {});
  const seenDemoHintRef = useRef(false);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<File | null>(null);
  const [onsets, setOnsets] = useState<number[]>([]);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [redoCount, setRedoCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [corpse, setCorpse] = useState(false);
  /** The recipe names audio we can't load or decode (imported bit whose
   *  bundle lacked it, OPFS eviction): offer a re-record, never a dead end. */
  const [soundLost, setSoundLost] = useState(false);
  const retakeModeRef = useRef<'replace' | 'extend'>('replace');
  const prevSquashRef = useRef<Map<string, number>>(new Map());
  const liveImpactCountRef = useRef(0);

  const audioBlobRef = useRef<Blob | null>(null);
  const voiceRef = useRef<VoiceTrack>(EMPTY_VOICE);
  const jamRef = useRef<JamAudio | null>(null);
  const micRef = useRef<MicRecorder | null>(null);
  const imagesRef = useRef<StageImages>(new Map());
  const visualsRef = useRef<Map<string, PuppetVisual>>(new Map());
  const wiresRef = useRef<WireMap>(new Map());
  const simRef = useRef<ShowSim | null>(null);
  const lastPosesRef = useRef<Map<string, PuppetPose>>(new Map());
  const grabRef = useRef<Grab | null>(null);
  const bodyGrabsRef = useRef<Grab[]>([]);
  const bodyMapRef = useRef<BodyMap>({ right: null, left: null });
  const poseDriverRef = useRef<PoseDriver | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const [bodyActive, setBodyActive] = useState(false);
  /** bodyMapRef is a ref the frame loop reads; this makes the sheet
   *  re-render when a hand is assigned. */
  const [handsVersion, setHandsVersion] = useState(0);
  const stagingRef = useRef<StagingDrag | null>(null);
  const handleDragRef = useRef<HandleDrag | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  /** Handle positions in frame pixels, refreshed every frame so the
   *  gesture layer can hit-test them itself. The handles are
   *  pointer-events: none, or the first finger of a pinch would land on one
   *  instead of on the stage. */
  const handlePxRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const handleElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const haloBarRef = useRef<HTMLDivElement>(null);
  const selOutlineRef = useRef<HTMLDivElement>(null);
  const handleLayerRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const pointerDownRef = useRef(false);
  const [pointerDown, setPointerDown] = useState(false);
  const strokeRef = useRef<number[][]>([]);
  const snipStrokeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redoRef = useRef<RecipeEvent[]>([]);
  const playheadRef = useRef(0);
  const prevClockRef = useRef(0);
  const clockFromRef = useRef(0);
  const wallStartRef = useRef(0);
  const seekSimAtRef = useRef(-1);
  const lastSeekDrawRef = useRef(0);
  const rafRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(true);
  const commitGrabRef = useRef<() => void>(() => {});

  const setModeBoth = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  /** Guidance lives in the banner over the top of the stage. It used to be
   *  13px along the bottom, where the puppets and the cancel pill covered
   *  it (audit F25). */
  useEffect(() => {
    const hints: Partial<Record<Mode, string>> = {
      snipping: 'drag a line across it to cut',
      mouthing: 'tap where the mouth goes',
      eyeing: 'tap where the eyes go',
      pinning: 'tap where it should bend',
      doodling: 'draw with a finger',
    };
    const text = hints[mode];
    const banner = bannerRef.current;
    if (text) {
      banner.hint(text, {
        label: 'cancel',
        run: () => {
          modeRef.current = 'idle';
          setMode('idle');
        },
      });
    } else if (mode === 'idle' && showId === 'show-demo' && !seenDemoHintRef.current) {
      // The demo is a real bit, and saying so is the whole tutorial.
      seenDemoHintRef.current = true;
      banner.hint('watch it once. then tap a puppet and wreck it.');
    } else if (banner.current?.kind === 'hint') {
      banner.clear();
    }
  }, [mode, showId]);

  const vibrate = (ms: number) => navigator.vibrate?.(ms);
  const durationS = projectSnap.audio?.durationS ?? 0;

  const persistSoon = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveProjectJson(showId, serializeProject(projectRef.current));
    }, 400);
  }, [showId]);

  const applyProject = useCallback(
    (mutate: (p: Project) => Project, clearRedo: boolean) => {
      projectRef.current = mutate(projectRef.current);
      visualsRef.current = visualsOf(projectRef.current);
      wiresRef.current = effectiveWires(projectRef.current);
      setProjectSnap(projectRef.current);
      setRendered(null);
      if (clearRedo) {
        redoRef.current = [];
        setRedoCount(0);
      }
      dirtyRef.current = true;
      persistSoon();
    },
    [persistSoon],
  );

  const commit = useCallback(
    (mutate: (p: Project) => Project) => applyProject(mutate, true),
    [applyProject],
  );

  const reloadImages = useCallback(async () => {
    imagesRef.current = await loadStageImages(castOf(projectRef.current), async (id) =>
      getAsset(id),
    );
    dirtyRef.current = true;
  }, []);

  const analyzeAudio = useCallback(async (blob: Blob) => {
    const mix = await mixdownMono(blob);
    if (mix) {
      voiceRef.current = computeVoiceTrack(mix.samples, mix.sampleRate);
      setOnsets(detectOnsets(mix.samples, mix.sampleRate));
      // Enough buckets for a full-width waveform on any phone.
      setPeaks(peaksFromMono(mix.samples, 600));
    }
  }, []);

  // Mount: restore the show.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadProjectJson(showId);
      if (cancelled) return;
      if (saved) {
        try {
          projectRef.current = parseProject(saved);
        } catch {
          // Swapping in a blank project threw the bytes away silently. Keep
          // them, say so, and offer the file back (audit F4).
          setDamagedRaw(saved);
          bannerRef.current.error("this bit's recipe is damaged; nothing was overwritten");
        }
      }
      visualsRef.current = visualsOf(projectRef.current);
      wiresRef.current = effectiveWires(projectRef.current);
      setProjectSnap(projectRef.current);
      if (projectRef.current.audio) {
        const blob = await getAsset(projectRef.current.audio.assetId).catch(() => null);
        if (cancelled) return;
        audioBlobRef.current = blob;
        const handle = blob ? await AudioSourceHandle.open(blob) : null;
        if (handle) {
          jamRef.current = new JamAudio(handle.makeSink());
          await analyzeAudio(blob!);
        } else {
          setSoundLost(true);
        }
      }
      await reloadImages();
      if (!cancelled) setModeBoth(jamRef.current ? 'idle' : 'needsAudio');
    })().catch((err: unknown) => {
      if (!cancelled) fail(err);
    });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (longPressRef.current) clearTimeout(longPressRef.current);
      jamRef.current?.dispose();
      jamRef.current = null;
      for (const img of imagesRef.current.values()) img.close();
      imagesRef.current = new Map();
    };
  }, [showId, reloadImages, analyzeAudio, fail]);

  /** Where a puppet's features sit right now, in frame pixels. */
  const layoutOverlays = useCallback(() => {
    const frame = frameRef.current;
    const positions = handlePxRef.current;
    positions.clear();
    const id = selectedIdRef.current;
    const outline = selOutlineRef.current;
    const bar = haloBarRef.current;
    if (!frame || !id) {
      if (outline) outline.style.display = 'none';
      if (bar) bar.style.display = 'none';
      return;
    }
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    const puppet = castOf(projectRef.current).find((p) => p.id === id);
    const pose = lastPosesRef.current.get(id);
    const visual = visualsRef.current.get(id);
    if (!puppet || !pose) {
      if (outline) outline.style.display = 'none';
      if (bar) bar.style.display = 'none';
      return;
    }

    const staging = stagingRef.current;
    const live =
      staging && staging.puppetId === id
        ? { ...puppet, home: { x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot } }
        : puppet;
    const cx = (puppet.back ? 0.5 : pose.root.x) * W;
    const cy = (puppet.back ? 0.5 : pose.root.y) * H;
    const bw = puppet.back ? W : live.spec.w * live.home.scale * W;
    const bh = puppet.back ? H : live.spec.h * live.home.scale * H;

    if (outline) {
      outline.style.display = '';
      outline.style.left = `${cx - bw / 2}px`;
      outline.style.top = `${cy - bh / 2}px`;
      outline.style.width = `${bw}px`;
      outline.style.height = `${bh}px`;
    }

    if (bar) {
      bar.style.display = '';
      const barH = bar.offsetHeight || 56;
      const barW = bar.offsetWidth || 300;
      const above = cy - bh / 2 - barH - 8;
      const below = cy + bh / 2 + 8;
      // Above the puppet, below it when there is no room, docked to the
      // bottom edge when there is room for neither.
      const top = above >= 48 ? above : below + barH <= H ? below : H - barH - 8;
      bar.style.top = `${Math.max(48, Math.min(H - barH - 8, top))}px`;
      bar.style.left = `${Math.max(8, Math.min(W - barW - 8, cx - barW / 2))}px`;
    }

    // Feature handles ride the puppet, so they track a drag frame by frame.
    if (!visual || puppet.back) return;
    const drag = handleDragRef.current;
    const place = (key: string, lx: number, ly: number) => {
      const world =
        drag && drag.key === key
          ? { x: drag.x, y: drag.y }
          : localToWorld(pose.root, live, lx, ly);
      positions.set(key, { x: world.x * W, y: world.y * H });
      const el = handleElsRef.current.get(key);
      if (el) el.style.transform = `translate(${world.x * W}px, ${world.y * H}px)`;
    };
    if (visual.mouth) place('mouth', visual.mouth.mx, visual.mouth.my);
    if (visual.eyes) place('eyes', visual.eyes.ex, visual.eyes.ey);
    visual.pins.forEach((pin, i) => {
      if (!pin) return;
      const state = pose.pins[i];
      const key = `pin:${i}`;
      if (drag && drag.key === key) {
        place(key, pin.px, pin.py);
      } else if (state) {
        positions.set(key, { x: state.x * W, y: state.y * H });
        const el = handleElsRef.current.get(key);
        if (el) el.style.transform = `translate(${state.x * W}px, ${state.y * H}px)`;
      }
    });
  }, []);

  const registerHandle = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) handleElsRef.current.set(key, el);
    else handleElsRef.current.delete(key);
  }, []);

  /** Write the playhead straight to the DOM. No React commit, no re-render
   *  of the stage, at sixty frames a second. */
  const paintClock = useCallback((clock: number) => {
    const dur = projectRef.current.audio?.durationS ?? 0;
    const time = timeTextRef.current;
    if (time) {
      const text = `${Math.floor(clock / 60)}:${Math.floor(clock % 60)
        .toString()
        .padStart(2, '0')}`;
      if (time.textContent !== text) time.textContent = text;
    }
    if (fillRef.current) {
      fillRef.current.style.width = dur ? `${(clock / dur) * 100}%` : '0%';
    }
    if (seekRef.current) seekRef.current.value = String(clock);
    if (handleRef.current) {
      handleRef.current.style.left = dur ? `${(clock / dur) * 100}%` : '0%';
    }
  }, []);

  const currentClock = useCallback((): number => {
    const audio = jamRef.current?.positionS();
    if (audio !== null && audio !== undefined) return audio;
    return clockFromRef.current + (performance.now() - wallStartRef.current) / 1000;
  }, []);

  const commitOneGrab = useCallback(
    (grab: Grab) => {
      const dur = projectRef.current.audio?.durationS ?? 0;
      const clock = Math.min(dur, Math.max(0, currentClock()));
      const lastT = grab.samples[grab.samples.length - 3]!;
      if (clock - lastT > 1 / 120) grab.samples.push(clock, grab.x, grab.y);
      if (grab.samples.length < 6) return;
      const base = {
        kind: 'PASS' as const,
        id: newId(),
        at: grab.samples[0]!,
        puppetId: grab.puppetId,
        samples: grab.samples,
      };
      const pass: PassEvent =
        grab.channel === null
          ? base
          : 'piece' in grab.channel
            ? { ...base, piece: grab.channel.piece }
            : { ...base, pin: grab.channel.pin };
      commit((p) => appendEvent(p, pass));
    },
    [commit, currentClock],
  );

  const commitGrab = useCallback(() => {
    const grab = grabRef.current;
    grabRef.current = null;
    if (grab) commitOneGrab(grab);
    const body = bodyGrabsRef.current;
    bodyGrabsRef.current = [];
    for (const g of body) commitOneGrab(g);
  }, [commitOneGrab]);

  useEffect(() => {
    commitGrabRef.current = commitGrab;
  }, [commitGrab]);

  const stop = useCallback(() => {
    // Hand the playhead back to React so the scrubber and the clock agree
    // with what the loop last painted.
    setT(playheadRef.current);
    if (modeRef.current === 'recording') commitGrabRef.current();
    jamRef.current?.stop();
    simRef.current = null;
    grabRef.current = null;
    bodyGrabsRef.current = [];
    poseDriverRef.current?.dispose();
    poseDriverRef.current = null;
    setBodyActive(false);
    setModeBoth('idle');
    dirtyRef.current = true;
  }, []);

  const start = async (recording: boolean) => {
    const dur = projectRef.current.audio?.durationS ?? 0;
    if (dur <= 0) return;
    setRendered(null);

    // A puppet with a hand assigned brings the camera up for the take.
    const hands = bodyMapRef.current;
    if (recording && (hands.right || hands.left) && !poseDriverRef.current) {
      const video = pipVideoRef.current;
      if (video) {
        try {
          poseDriverRef.current = await PoseDriver.create(video);
          setBodyActive(true);
        } catch (err) {
          fail(err);
          return;
        }
      }
    }
    let from = playheadRef.current;
    if (from >= dur - 0.05) from = 0;
    playheadRef.current = from;
    prevSquashRef.current = new Map();
    liveImpactCountRef.current = 0;

    if (recording && jamRef.current) {
      setCounting(true);
      await jamRef.current.countIn();
      setCounting(false);
    }

    // Corpse mode: record blind; earlier passes stay hidden until playback.
    const simProject =
      recording && corpse
        ? { ...projectRef.current, events: projectRef.current.events.filter((e) => e.kind !== 'PASS') }
        : projectRef.current;
    const sim = createShowSim(simProject, 0, (id, channel, tt) => {
      const finger = grabRef.current;
      if (
        finger &&
        finger.puppetId === id &&
        sameChannel(finger.channel, channel) &&
        tt >= finger.samples[0]!
      ) {
        return { x: finger.x, y: finger.y };
      }
      for (const g of bodyGrabsRef.current) {
        if (g.puppetId === id && sameChannel(g.channel, channel) && tt >= g.samples[0]!) {
          return { x: g.x, y: g.y };
        }
      }
      return null;
    });
    sim.advanceTo(from);
    simRef.current = sim;
    clockFromRef.current = from;
    prevClockRef.current = from;
    wallStartRef.current = performance.now() + 50;
    void jamRef.current?.play(from);
    setModeBoth(recording ? 'recording' : 'playing');
  };

  // Frame loop: clock, simulation, drawing, seek previews, hold sampling.
  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(frame.clientWidth * dpr);
      const H = Math.round(frame.clientHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        dirtyRef.current = true;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const m = modeRef.current;
      const project = projectRef.current;
      const dur = project.audio?.durationS ?? 0;

      if (m === 'playing' || m === 'recording') {
        const now = currentClock();
        const clock = Math.max(clockFromRef.current, Math.min(dur, now));
        playheadRef.current = clock;
        paintClock(clock);

        const grab = grabRef.current;
        if (m === 'recording' && grab) {
          const lastT = grab.samples[grab.samples.length - 3]!;
          if (clock - lastT >= HOLD_SAMPLE_S) grab.samples.push(clock, grab.x, grab.y);
        }

        // Performed sounds replay live; impact foley fires off squash spikes.
        const prevClock = prevClockRef.current;
        prevClockRef.current = clock;
        if (clock > prevClock) {
          for (const e of project.events) {
            if (e.kind === 'SOUND' && e.at > prevClock && e.at <= clock) {
              void jamRef.current?.playSfx(renderSfx(e.sfx));
            }
          }
        }

        // Body passes: wrists update their virtual grabs.
        const driver = poseDriverRef.current;
        if (m === 'recording' && driver) {
          const hands = driver.latest();
          const map = bodyMapRef.current;
          for (const side of ['right', 'left'] as const) {
            const assigned = map[side];
            const hand = hands[side];
            if (!assigned || !hand) continue;
            let g = bodyGrabsRef.current.find(
              (x) => x.puppetId === assigned.puppetId && sameChannel(x.channel, assigned.channel),
            );
            if (!g) {
              g = {
                puppetId: assigned.puppetId,
                channel: assigned.channel,
                samples: [clock, hand.x, hand.y],
                x: hand.x,
                y: hand.y,
              };
              bodyGrabsRef.current.push(g);
            }
            g.x = hand.x;
            g.y = hand.y;
            const lastT = g.samples[g.samples.length - 3]!;
            if (clock - lastT >= 1 / 60) g.samples.push(clock, hand.x, hand.y);
          }
        }

        const sim = simRef.current;
        if (sim) {
          const poses = sim.advanceTo(clock);
          lastPosesRef.current = poses;
          if (wireAmount(wiresRef.current, '', 'on', 'foley') > 0) {
            for (const [pid, pose] of poses) {
              const prev = prevSquashRef.current.get(pid) ?? 0;
              if (pose.root.squash >= IMPACT_SQUASH && prev < IMPACT_SQUASH) {
                void jamRef.current?.playSfx(renderSfx(impactSfx(liveImpactCountRef.current++)));
              }
              prevSquashRef.current.set(pid, pose.root.squash);
            }
          }
          const cast = castOf(project);
          const mods = new Map<string, WireMods>();
          for (const p of cast) {
            mods.set(
              p.id,
              wireModsFor(wiresRef.current, p.id, voiceRef.current, onsets, clock, project.seed),
            );
          }
          drawStage(
            ctx,
            W,
            H,
            cast,
            poses,
            imagesRef.current,
            visualsRef.current,
            voiceMap(project, visualsRef.current, voiceRef.current, clock),
            clock,
            project.seed,
            mods,
            trailStrength(wiresRef.current, voiceRef.current, onsets, clock),
          );
        }
        layoutOverlays();
        if (now >= dur) stop();
        return;
      }

      // Idle: throttled re-sim when the playhead moved, else draw on dirty.
      const wantSeekSim =
        m === 'idle' &&
        seekSimAtRef.current !== playheadRef.current &&
        performance.now() - lastSeekDrawRef.current > 150;
      if (dirtyRef.current || wantSeekSim) {
        dirtyRef.current = false;
        seekSimAtRef.current = playheadRef.current;
        lastSeekDrawRef.current = performance.now();
        let cast = castOf(project);
        const staging = stagingRef.current;
        if (staging) {
          cast = cast.map((p) =>
            p.id === staging.puppetId
              ? {
                  ...p,
                  home: { x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot },
                }
              : p,
          );
        }
        const sim = createShowSim({ ...project, events: applyStagingCast(project, staging) });
        const poses = sim.advanceTo(playheadRef.current);
        lastPosesRef.current = poses;
        const idleMods = new Map<string, WireMods>();
        for (const p of cast) {
          idleMods.set(
            p.id,
            wireModsFor(
              wiresRef.current,
              p.id,
              voiceRef.current,
              onsets,
              playheadRef.current,
              project.seed,
            ),
          );
        }
        drawStage(
          ctx,
          W,
          H,
          cast,
          poses,
          imagesRef.current,
          visualsRef.current,
          voiceMap(project, visualsRef.current, voiceRef.current, playheadRef.current),
          playheadRef.current,
          project.seed,
          idleMods,
        );
        // Pin rings, visible while staging and pinning.
        for (const p of cast) {
          const pose = poses.get(p.id);
          const visual = visualsRef.current.get(p.id);
          if (!pose || !visual || visual.pins.length === 0) continue;
          ctx.strokeStyle = '#58a6ff';
          ctx.lineWidth = 2;
          pose.pins.forEach((pin, pi) => {
            if (!visual.pins[pi]) return;
            ctx.beginPath();
            ctx.arc(pin.x * W, pin.y * H, Math.max(6, W * 0.012), 0, Math.PI * 2);
            ctx.stroke();
          });
        }
        layoutOverlays();
        if (modeRef.current === 'doodling') drawStrokes(ctx, W, H, strokeRef.current);
        if (modeRef.current === 'snipping' && snipStrokeRef.current) {
          const s = snipStrokeRef.current;
          ctx.strokeStyle = '#58a6ff';
          ctx.setLineDash([8, 8]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(s.x0 * W, s.y0 * H);
          ctx.lineTo(s.x1 * W, s.y1 * H);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stop, currentClock, onsets, paintClock, layoutOverlays]);

  // Pointer handling.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Travel is tracked in client pixels: the normalised measure the tap
    // threshold used to share gave nearly twice the slop vertically as
    // horizontally on a 9:16 stage.
    const pointers = new Map<
      number,
      { x: number; y: number; cx: number; cy: number; movedPx: number }
    >();
    /** Set when a press lands on bare stage, so the release can deselect. */
    let downOnNothing = false;

    // Soft bounds well past the frame: puppets enter and exit through the
    // wings, and a drag that wanders offstage still comes back.
    const norm = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      return {
        x: Math.min(1.75, Math.max(-0.75, (e.clientX - r.left) / r.width)),
        y: Math.min(1.75, Math.max(-0.75, (e.clientY - r.top) / r.height)),
      };
    };

    // One transform for hit testing and for drawing. The private copy this
    // replaces ignored the spring's lean, so hits disagreed with the drawer
    // on a leaning puppet, and it knew nothing about flip.
    const toLocal = (p: ShowPuppet, x: number, y: number) =>
      worldToLocal(lastPosesRef.current.get(p.id)?.root ?? restingPuppet(p.home.x, p.home.y), p, x, y);

    /** Hit a puppet and which handle: a warp pin, a snipped-off piece
     *  (accounting for its swing), or the body. */
    const hitTest = (x: number, y: number): { puppet: ShowPuppet; channel: Channel } | null => {
      const cast = castOf(projectRef.current);
      for (let i = cast.length - 1; i >= 0; i--) {
        const p = cast[i]!;
        if (p.back) continue;
        const local = toLocal(p, x, y);
        const visual = visualsRef.current.get(p.id);
        const pose = lastPosesRef.current.get(p.id);
        if (visual && pose) {
          for (let pi = 0; pi < pose.pins.length; pi++) {
            // A removed slot keeps its index but has nothing to grab.
            if (!visual.pins[pi]) continue;
            const pin = pose.pins[pi]!;
            if (Math.hypot(x - pin.x, y - pin.y) < 0.045) {
              return { puppet: p, channel: { pin: pi } };
            }
          }
          for (const child of visual.pieces.children) {
            const dangle = pose.dangles[child.snipIndex]?.angle ?? 0;
            const j = child.joint!;
            const ca = Math.cos(-dangle);
            const sa = Math.sin(-dangle);
            const rx = j.x + (local.x - j.x) * ca - (local.y - j.y) * sa;
            const ry = j.y + (local.x - j.x) * sa + (local.y - j.y) * ca;
            if (pointInPoly(child.poly, rx, ry)) {
              return { puppet: p, channel: { piece: child.snipIndex } };
            }
          }
          if (pointInPoly(visual.pieces.root.poly, local.x, local.y)) {
            return { puppet: p, channel: null };
          }
        }
        const hw = Math.max(0.06, (p.spec.w * p.home.scale) / 2);
        const hh = Math.max(0.06, (p.spec.h * p.home.scale) / 2);
        const s = pose?.root ?? { x: p.home.x, y: p.home.y };
        if (Math.abs(x - s.x) <= hw && Math.abs(y - s.y) <= hh) {
          return { puppet: p, channel: null };
        }
      }
      return null;
    };

    /** Handles are pointer-events: none so a pinch's first finger can
     *  never land on one instead of on the stage. The gesture layer
     *  hit-tests them itself against the frame pixels the frame loop
     *  wrote. */
    const handleAt = (e: PointerEvent): HandleKey | null => {
      if (!selectedIdRef.current) return null;
      const r = frame.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      let best: HandleKey | null = null;
      let bestD = HANDLE_HIT_PX;
      for (const [key, pos] of handlePxRef.current) {
        const d = Math.hypot(px - pos.x, py - pos.y);
        if (d < bestD) {
          bestD = d;
          best = key as HandleKey;
        }
      }
      return best;
    };

    /** The puppet a placing tool acts on. With something selected the tool
     *  belongs to it, so a tap that misses the outline by a few pixels
     *  still lands rather than silently doing nothing. */
    const toolTarget = (x: number, y: number): ShowPuppet | null => {
      const id = selectedIdRef.current;
      const cast = castOf(projectRef.current);
      if (id) return cast.find((p) => p.id === id) ?? null;
      return hitTest(x, y)?.puppet ?? null;
    };

    const clearLongPress = () => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    };

    const placeFeature = (kind: 'MOUTH' | 'EYES', x: number, y: number) => {
      const puppet = toolTarget(x, y);
      if (!puppet) return;
      const local = toLocal(puppet, x, y);
      const lx = clamp01(local.x);
      const ly = clamp01(local.y);
      commit((p) =>
        appendEvent(
          p,
          kind === 'MOUTH'
            ? { kind, id: newId(), at: 0, puppetId: puppet.id, mx: lx, my: ly, size: 0.24 }
            : { kind, id: newId(), at: 0, puppetId: puppet.id, ex: lx, ey: ly, size: 0.3 },
        ),
      );
      setSelectedId(puppet.id);
      vibrate(15);
      setModeBoth('idle');
    };

    const HANDLE_NAMES: Record<'mouth' | 'eyes' | 'pin', string> = {
      mouth: 'mouth',
      eyes: 'eyes',
      pin: 'bend',
    };

    /** A released handle either re-places its feature or, dragged clear of
     *  the puppet, takes it off. Removal is a tombstone: the slot stays, so
     *  the passes driving other pins keep driving the pins they named. */
    const commitHandle = (drag: HandleDrag) => {
      const puppet = drag.puppet;
      const kind = drag.key.startsWith('pin:') ? 'pin' : (drag.key as 'mouth' | 'eyes');
      const slot = kind === 'pin' ? Number(drag.key.slice(4)) : -1;
      if (drag.outside) {
        const target: RemoveTarget =
          kind === 'mouth' ? { mouth: true } : kind === 'eyes' ? { eyes: true } : { pin: slot };
        commit((p) =>
          appendEvent(p, {
            kind: 'REMOVE',
            id: newId(),
            at: 0,
            puppetId: puppet.id,
            target,
          }),
        );
        toastRef.current.undoable(`took the ${HANDLE_NAMES[kind]} off`, undoRef.current);
        vibrate(20);
        return;
      }
      const local = toLocal(puppet, drag.x, drag.y);
      const lx = clamp01(local.x);
      const ly = clamp01(local.y);
      commit((p) => {
        if (kind === 'mouth') {
          const prev = mouthOf(p, puppet.id);
          return appendEvent(p, {
            kind: 'MOUTH',
            id: newId(),
            at: 0,
            puppetId: puppet.id,
            mx: lx,
            my: ly,
            size: prev?.size ?? 0.24,
          });
        }
        if (kind === 'eyes') {
          const prev = eyesOf(p, puppet.id);
          return appendEvent(p, {
            kind: 'EYES',
            id: newId(),
            at: 0,
            puppetId: puppet.id,
            ex: lx,
            ey: ly,
            size: prev?.size ?? 0.3,
          });
        }
        return appendEvent(p, {
          kind: 'PIN',
          id: newId(),
          at: 0,
          puppetId: puppet.id,
          px: lx,
          py: ly,
          index: slot,
        });
      });
      vibrate(10);
    };

    const down = (e: PointerEvent) => {
      // The gesture layer owns the canvas and nothing else. Every overlay
      // inside the frame — the halo, the banner, the title strip, the
      // cancel pills — sits on top of it, and a press on one used to run
      // this handler too: the release deselected the puppet, React pulled
      // the halo out from under the finger, and the button never saw its
      // own click.
      if (e.target !== frame && e.target !== canvasRef.current) return;
      frame.setPointerCapture(e.pointerId);
      const { x, y } = norm(e);
      pointers.set(e.pointerId, { x, y, cx: e.clientX, cy: e.clientY, movedPx: 0 });
      const m = modeRef.current;

      if (m === 'doodling') {
        strokeRef.current.push([x, y]);
        dirtyRef.current = true;
        return;
      }
      if (m === 'snipping') {
        snipStrokeRef.current = { x0: x, y0: y, x1: x, y1: y };
        dirtyRef.current = true;
        return;
      }
      if (m === 'mouthing') {
        placeFeature('MOUTH', x, y);
        return;
      }
      if (m === 'eyeing') {
        placeFeature('EYES', x, y);
        return;
      }
      if (m === 'pinning') {
        const puppet = toolTarget(x, y);
        if (puppet) {
          const pinnable =
            puppet.spec.type === 'cutout' &&
            !snipsOf(projectRef.current, puppet.id).some((snip) => snip !== null);
          if (pinnable) {
            const local = toLocal(puppet, x, y);
            commit((p) =>
              appendEvent(p, {
                kind: 'PIN',
                id: newId(),
                at: 0,
                puppetId: puppet.id,
                px: clamp01(local.x),
                py: clamp01(local.y),
              }),
            );
            setSelectedId(puppet.id);
            vibrate(15);
          } else {
            vibrate(40);
          }
          setModeBoth('idle');
        }
        return;
      }
      if (m === 'recording') {
        const hit = hitTest(x, y);
        if (hit) {
          const clock = Math.max(0, currentClock());
          grabRef.current = {
            puppetId: hit.puppet.id,
            channel: hit.channel,
            samples: [clock, x, y],
            x,
            y,
          };
        }
        return;
      }
      if (m === 'idle') {
        const staging = stagingRef.current;
        if (staging && pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          staging.pinch = {
            baseDist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 0.01,
            baseAngle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
            baseScale: staging.scale,
            baseRot: staging.rot,
          };
          clearLongPress();
          return;
        }
        // The halo goes non-interactive while a finger is down, so a
        // pinch's second finger can never fire one of its buttons.
        pointerDownRef.current = true;
        setPointerDown(true);

        // A feature under the finger wins over the puppet carrying it.
        const key = handleAt(e);
        if (key && !handleDragRef.current) {
          const puppet = castOf(projectRef.current).find((p) => p.id === selectedIdRef.current);
          if (puppet) {
            handleDragRef.current = { key, puppet, x, y, outside: false };
            clearLongPress();
            dirtyRef.current = true;
            return;
          }
        }

        const hit = hitTest(x, y);
        if (!hit) {
          // A press on bare stage puts the tools away on release.
          downOnNothing = pointers.size === 1;
          return;
        }
        downOnNothing = false;
        stagingRef.current = {
          puppetId: hit.puppet.id,
          x: hit.puppet.home.x,
          y: hit.puppet.home.y,
          scale: hit.puppet.home.scale,
          rot: hit.puppet.home.rot,
          // Grab offset, so the puppet travels with the finger instead of
          // jumping its centre under it on the first move.
          dx: hit.puppet.home.x - x,
          dy: hit.puppet.home.y - y,
          pinch: null,
        };
        dirtyRef.current = true;
        clearLongPress();
        // A hesitation used to delete the puppet (audit F5). Now it is a
        // tap with a buzz: it selects, and the finger keeps the puppet, so
        // the same press can go on to drag it. It opens no panel, which
        // would appear under the held finger and be fired by the release.
        longPressRef.current = setTimeout(() => {
          setSelectedId(hit.puppet.id);
          vibrate(10);
          dirtyRef.current = true;
        }, LONG_PRESS_MS);
      }
    };

    const move = (e: PointerEvent) => {
      const pt = pointers.get(e.pointerId);
      if (!pt) return;
      const { x, y } = norm(e);
      pt.x = x;
      pt.y = y;
      pt.movedPx = Math.max(pt.movedPx, Math.hypot(e.clientX - pt.cx, e.clientY - pt.cy));
      const movedFar = pt.movedPx > DRAG_PX;
      const m = modeRef.current;

      if (m === 'doodling') {
        const stroke = strokeRef.current[strokeRef.current.length - 1];
        if (stroke && e.buttons > 0) {
          stroke.push(x, y);
          dirtyRef.current = true;
        }
        return;
      }
      if (m === 'snipping') {
        if (snipStrokeRef.current) {
          snipStrokeRef.current.x1 = x;
          snipStrokeRef.current.y1 = y;
          dirtyRef.current = true;
        }
        return;
      }
      if (m === 'recording' && grabRef.current) {
        const grab = grabRef.current;
        const clock = Math.max(0, currentClock());
        const lastT = grab.samples[grab.samples.length - 3]!;
        if (clock - lastT >= 1 / 60) grab.samples.push(clock, x, y);
        grab.x = x;
        grab.y = y;
        return;
      }
      if (m === 'idle' && handleDragRef.current) {
        const drag = handleDragRef.current;
        drag.x = x;
        drag.y = y;
        const local = toLocal(drag.puppet, x, y);
        const outside =
          local.x < -REMOVE_BAND ||
          local.x > 1 + REMOVE_BAND ||
          local.y < -REMOVE_BAND ||
          local.y > 1 + REMOVE_BAND;
        if (outside !== drag.outside) {
          drag.outside = outside;
          setRemovingKey(outside ? drag.key : null);
          const what = drag.key.startsWith('pin:') ? 'bend' : drag.key;
          if (outside) bannerRef.current.hint(`let go to take the ${what} off`);
          else bannerRef.current.clear();
          vibrate(10);
        }
        dirtyRef.current = true;
        return;
      }
      if (m === 'idle' && stagingRef.current) {
        if (movedFar) clearLongPress();
        const staging = stagingRef.current;
        if (staging.pinch && pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 0.01;
          const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
          staging.scale = Math.min(
            4,
            Math.max(0.2, staging.pinch.baseScale * (dist / staging.pinch.baseDist)),
          );
          staging.rot = staging.pinch.baseRot + (angle - staging.pinch.baseAngle);
        } else if (pointers.size === 1 && movedFar) {
          staging.x = x + staging.dx;
          staging.y = y + staging.dy;
        }
        dirtyRef.current = true;
      }
    };

    const up = (e: PointerEvent) => {
      const pt = pointers.get(e.pointerId);
      const tapped = !!pt && pt.movedPx < DRAG_PX;
      pointers.delete(e.pointerId);
      clearLongPress();
      if (pointers.size === 0) {
        pointerDownRef.current = false;
        setPointerDown(false);
      }
      const m = modeRef.current;

      if (m === 'snipping' && snipStrokeRef.current && pointers.size === 0) {
        const s = snipStrokeRef.current;
        snipStrokeRef.current = null;
        const midX = (s.x0 + s.x1) / 2;
        const midY = (s.y0 + s.y1) / 2;
        const lineLen = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
        const puppet = toolTarget(midX, midY);
        if (puppet && lineLen > 0.03) {
          const a = toLocal(puppet, s.x0, s.y0);
          const b = toLocal(puppet, s.x1, s.y1);
          commit((p) =>
            appendEvent(p, {
              kind: 'SNIP',
              id: newId(),
              at: 0,
              puppetId: puppet.id,
              x0: a.x,
              y0: a.y,
              x1: b.x,
              y1: b.y,
            }),
          );
          setSelectedId(puppet.id);
          vibrate(20);
        }
        setModeBoth('idle');
        dirtyRef.current = true;
        return;
      }
      if (m === 'recording' && grabRef.current) {
        commitGrabRef.current();
        return;
      }
      if (m === 'idle' && handleDragRef.current && pointers.size === 0) {
        const drag = handleDragRef.current;
        handleDragRef.current = null;
        setRemovingKey(null);
        if (drag.outside) bannerRef.current.clear();
        dirtyRef.current = true;
        // A tap on a handle is not a re-placement; it would append an
        // event identical to the one before it for undo to step through.
        if (!tapped) commitHandle(drag);
        return;
      }

      if (m === 'idle' && stagingRef.current && pointers.size === 0) {
        const staging = stagingRef.current;
        stagingRef.current = null;
        const existing = castOf(projectRef.current).find((p) => p.id === staging.puppetId);
        if (tapped) {
          // Tap selects. It used to move the puppet to the fingertip and
          // record it, which made choosing a puppet a destructive act.
          if (existing) setSelectedId(existing.id);
          dirtyRef.current = true;
          return;
        }
        // A drag that landed back where it started records nothing.
        const moved =
          !!existing &&
          (Math.abs(existing.home.x - staging.x) > 1e-4 ||
            Math.abs(existing.home.y - staging.y) > 1e-4 ||
            Math.abs(existing.home.scale - staging.scale) > 1e-4 ||
            Math.abs(existing.home.rot - staging.rot) > 1e-4);
        if (existing && moved) {
          const recast: CastEvent = {
            kind: 'CAST',
            id: newId(),
            at: 0,
            puppetId: existing.id,
            puppet: existing.spec,
            x: staging.x,
            y: staging.y,
            scale: staging.scale,
            rot: staging.rot,
            ...(existing.back ? { back: true as const } : {}),
            ...(existing.flip ? { flip: true as const } : {}),
          };
          commit((p) => appendEvent(p, recast));
        }
        dirtyRef.current = true;
        return;
      }

      if (m === 'idle' && tapped && downOnNothing && pointers.size === 0) {
        downOnNothing = false;
        setSelectedId(null);
        dirtyRef.current = true;
      }
    };

    frame.addEventListener('pointerdown', down);
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    return () => {
      frame.removeEventListener('pointerdown', down);
      frame.removeEventListener('pointermove', move);
      frame.removeEventListener('pointerup', up);
      frame.removeEventListener('pointercancel', up);
    };
  }, [commit, currentClock]);

  // The bit: mic recording.
  const recordBit = async () => {
    const mic = new MicRecorder();
    micRef.current = mic;
    await mic.start();
    setModeBoth('micLive');
  };

  const stopBit = async () => {
    const mic = micRef.current;
    if (!mic) return;
    let blob = await mic.stop();
    micRef.current = null;
    if (retakeModeRef.current === 'extend' && audioBlobRef.current) {
      blob = (await concatAudio(audioBlobRef.current, blob)) ?? blob;
    }
    retakeModeRef.current = 'replace';
    const assetId = await saveAsset(blob, 'webm');
    const handle = await AudioSourceHandle.open(blob);
    if (!handle) {
      banner.error('could not read the recording; try again');
      setModeBoth('needsAudio');
      return;
    }
    const durationRecorded = await handle.duration();
    audioBlobRef.current = blob;
    jamRef.current?.dispose();
    jamRef.current = new JamAudio(handle.makeSink());
    await analyzeAudio(blob);
    commit((p) => ({ ...p, audio: { assetId, durationS: durationRecorded } }));
    setSoundLost(false);
    playheadRef.current = 0;
    setT(0);
    setModeBoth('idle');
  };

  // Casting.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const snapInputRef = useRef<HTMLInputElement>(null);
  const backdropInputRef = useRef<HTMLInputElement>(null);
  const soundFileInputRef = useRef<HTMLInputElement>(null);

  /** Where a new cast lands. Everything used to arrive at dead centre, so
   *  a second photo hid the first and looked like nothing had happened. */
  const freeSpot = (): { x: number; y: number } => {
    const taken = castOf(projectRef.current).filter((p) => !p.back);
    const spots: [number, number][] = [
      [0.5, 0.55],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.38, 0.7],
      [0.62, 0.7],
      [0.5, 0.34],
      [0.22, 0.66],
      [0.78, 0.66],
    ];
    for (const [x, y] of spots) {
      if (!taken.some((p) => Math.hypot(p.home.x - x, p.home.y - y) < 0.12)) return { x, y };
    }
    // Every obvious spot is full. Fan out from the centre, deterministically.
    const n = taken.length;
    return { x: 0.5 + 0.3 * Math.sin(n * 2.4), y: 0.52 + 0.18 * Math.cos(n * 2.4) };
  };

  const castPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    // The segmenter's first run downloads 11MB of wasm and a model. Saying
    // nothing for that long reads as a broken app (audit F7).
    setCasting(true);
    try {
      const cutout = await makeCutout(file);
      const assetId = await saveAsset(cutout.blob, 'png');
      const frame = frameRef.current;
      const stageRatio = frame ? frame.clientWidth / frame.clientHeight : 9 / 16;
      const w = 0.38;
      const h = w * stageRatio * (cutout.height / cutout.width);
      const id = newId();
      const spot = freeSpot();
      commit((p) =>
        appendEvent(p, {
          kind: 'CAST',
          id: newId(),
          at: 0,
          puppetId: id,
          puppet: { type: 'cutout', assetId, w, h },
          x: spot.x,
          y: spot.y,
          scale: 1,
          rot: 0,
        }),
      );
      setSelectedId(id);
      await reloadImages();
      if (cutout.fallback === 'no-person') toast.show('no person found, kept the whole photo');
      else if (cutout.fallback === 'no-model') toast.show('cutting out is unavailable, kept the whole photo');
    } catch {
      banner.error("couldn't read that photo");
    } finally {
      setCasting(false);
    }
  };

  const onBackdropPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const assetId = await saveAsset(file, 'img');
      const id = newId();
      setSelectedId(id);
      commit((p) =>
        appendEvent(p, {
          kind: 'CAST',
          id: newId(),
          at: 0,
          puppetId: id,
          puppet: { type: 'cutout', assetId, w: 1, h: 1 },
          x: 0.5,
          y: 0.5,
          scale: 1,
          rot: 0,
          back: true,
        }),
      );
      await reloadImages();
    } catch {
      banner.error("couldn't read that image");
    }
  };

  /** Sound from a file: a voice memo, a song, the audio off a video. The
   *  mic used to be the only way in, which asked a person to talk out loud
   *  before anything happened at all (audit F28). */
  const pickSoundFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCasting(true);
    try {
      const sound = await importSoundFile(file);
      const assetId = await saveAsset(sound.blob, soundExtension(sound, file));
      const handle = await AudioSourceHandle.open(sound.blob);
      if (!handle) throw new NoSoundInFileError();
      audioBlobRef.current = sound.blob;
      jamRef.current?.dispose();
      jamRef.current = new JamAudio(handle.makeSink());
      await analyzeAudio(sound.blob);
      commit((p) => ({ ...p, audio: { assetId, durationS: sound.durationS } }));
      setSoundLost(false);
      playheadRef.current = 0;
      setT(0);
      setModeBoth('idle');
      if (sound.extracted) toast.show('took the sound off that video');
    } catch (err) {
      banner.error(err instanceof NoSoundInFileError ? 'no sound in that file' : "couldn't read that file");
    } finally {
      setCasting(false);
    }
  };


  const finishDoodle = (keep: boolean) => {
    const strokes = strokeRef.current;
    strokeRef.current = [];
    setModeBoth('idle');
    dirtyRef.current = true;
    if (!keep || strokes.length === 0) return;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const s of strokes) {
      for (let i = 0; i + 1 < s.length; i += 2) {
        minX = Math.min(minX, s[i]!);
        maxX = Math.max(maxX, s[i]!);
        minY = Math.min(minY, s[i + 1]!);
        maxY = Math.max(maxY, s[i + 1]!);
      }
    }
    const w = Math.max(0.05, maxX - minX);
    const h = Math.max(0.05, maxY - minY);
    const normalized = strokes.map((s) => {
      const out: number[] = [];
      for (let i = 0; i + 1 < s.length; i += 2) {
        out.push((s[i]! - minX) / w, (s[i + 1]! - minY) / h);
      }
      return out;
    });
    const id = newId();
    setSelectedId(id);
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: { type: 'doodle', strokes: normalized, w, h },
        x: minX + w / 2,
        y: minY + h / 2,
        scale: 1,
        rot: 0,
      }),
    );
  };

  /** A CAST that carries everything forward but the patch. A CAST no
   *  longer fronts a puppet the latest REORDER names, so this is safe to
   *  use for a nudge, a resize or a flip. */
  const recastWith = (p: ShowPuppet, patch: Partial<CastEvent>) => {
    commit((proj) =>
      appendEvent(proj, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: p.id,
        puppet: p.spec,
        x: p.home.x,
        y: p.home.y,
        scale: p.home.scale,
        rot: p.home.rot,
        ...(p.back ? { back: true as const } : {}),
        ...(p.flip ? { flip: true as const } : {}),
        ...patch,
      }),
    );
  };

  const setSpec = (p: ShowPuppet, patch: Partial<PuppetSpec>) =>
    recastWith(p, { puppet: { ...p.spec, ...patch } as PuppetSpec });

  const setWire = (pid: string, source: WireSource, target: WireTarget, amount: number) => {
    commit((p) =>
      appendEvent(p, { kind: 'WIRE', id: newId(), at: 0, puppetId: pid, source, target, amount }),
    );
  };

  const wireLevel = (pid: string, source: WireSource, target: WireTarget) =>
    wireAmount(effectiveWires(projectSnap), pid, source, target);

  /** One REORDER, one undo. Layering used to re-cast every other puppet,
   *  so sending one to the back of a cast of six cost six events, and the
   *  next drag put it straight back (audit F21). */
  const layerPuppet = (p: ShowPuppet, dir: 'front' | 'back') => {
    const fronts = castOf(projectRef.current)
      .filter((o) => !o.back)
      .map((o) => o.id);
    const rest = fronts.filter((id) => id !== p.id);
    const order = dir === 'front' ? [...rest, p.id] : [p.id, ...rest];
    commit((proj) =>
      appendEvent(proj, { kind: 'REORDER', id: newId(), at: 0, puppetId: '', order }),
    );
  };

  const duplicatePuppet = (p: ShowPuppet) => {
    const id = newId();
    commit((proj) =>
      appendEvent(proj, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: p.spec,
        x: Math.min(0.92, p.home.x + 0.12),
        y: p.home.y,
        scale: p.home.scale,
        rot: p.home.rot,
        ...(p.back ? { back: true as const } : {}),
        ...(p.flip ? { flip: true as const } : {}),
      }),
    );
    setSelectedId(id);
  };

  /** Which hand drives a puppet in a body pass. This used to be its own
   *  mode with its own tap-two-puppets ritual; it belongs to the puppet. */
  const handOf = (id: string): 'left' | 'right' | 'none' => {
    void handsVersion;
    const map = bodyMapRef.current;
    if (map.right?.puppetId === id) return 'right';
    if (map.left?.puppetId === id) return 'left';
    return 'none';
  };

  const assignHand = (p: ShowPuppet, hand: 'left' | 'right' | 'none') => {
    const map = bodyMapRef.current;
    if (map.right?.puppetId === p.id) map.right = null;
    if (map.left?.puppetId === p.id) map.left = null;
    if (hand !== 'none') map[hand] = { puppetId: p.id, channel: null };
    setHandsVersion((v) => v + 1);
    bannerRef.current.hint(
      hand === 'none'
        ? 'the camera no longer drives it.'
        : `your ${hand} hand drives it. record to perform with the camera.`,
    );
  };

  const dropPuppet = (p: ShowPuppet) => {
    const index = castOf(projectRef.current).findIndex((x) => x.id === p.id);
    setSelectedId(null);
    commit((proj) => appendEvent(proj, { kind: 'DROP', id: newId(), at: 0, puppetId: p.id }));
    toast.undoable(`dropped ${puppetLabel(p, Math.max(0, index))}`, undoRef.current);
  };


  /** Foley board: play it now, land it in the recipe at the playhead. */
  const foley = (sfx: SfxName) => {
    const dur = projectRef.current.audio?.durationS ?? 0;
    const clock = Math.min(dur, Math.max(0, currentClock()));
    void jamRef.current?.playSfx(renderSfx(sfx));
    commit((p) =>
      appendEvent(p, { kind: 'SOUND', id: newId(), at: clock, puppetId: '', sfx }),
    );
  };

  const startRetake = (mode: 'replace' | 'extend') => {
    setSheet({ kind: 'retake', mode });
  };

  const confirmRetake = (mode: 'replace' | 'extend') => {
    retakeModeRef.current = mode;
    setSheet(null);
    setModeBoth('needsAudio');
  };

  const addTextPuppet = (raw: string) => {
    const text = raw.trim();
    setSheet(null);
    if (!text) return;
    const id = newId();
    setSelectedId(id);
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: { type: 'text', text: text.slice(0, 40), w: 0.56, h: 0.1 },
        x: 0.5,
        y: freeSpot().y,
        scale: 1,
        rot: 0,
      }),
    );
  };

  const exportBit = async () => {
    try {
      await shareOrDownload(await exportBundle(projectRef.current));
    } catch (err) {
      fail(err);
    }
  };

  /** Events committed together share a group and form one contiguous run at
   *  the tail, so a compound edit is a single undo step. */
  const undo = () => {
    const events = projectRef.current.events;
    if (events.length === 0) return;
    const last = events[events.length - 1]!;
    let n = 1;
    if (last.group) {
      while (n < events.length && events[events.length - 1 - n]!.group === last.group) n += 1;
    }
    const removed = events.slice(events.length - n);
    // Pushed in reverse so redo pops them back in their original order.
    for (let i = removed.length - 1; i >= 0; i--) redoRef.current.push(removed[i]!);
    setRedoCount(redoRef.current.length);
    applyProject((p) => ({ ...p, events: p.events.slice(0, -n) }), false);
    void reloadImages();
  };

  undoRef.current = undo;

  const redo = () => {
    const stack = redoRef.current;
    const first = stack.pop();
    if (!first) return;
    const batch: RecipeEvent[] = [first];
    if (first.group) {
      while (stack.length > 0 && stack[stack.length - 1]!.group === first.group) {
        batch.push(stack.pop()!);
      }
    }
    setRedoCount(stack.length);
    applyProject((p) => ({ ...p, events: [...p.events, ...batch] }), false);
    void reloadImages();
  };

  const doRender = async () => {
    if (rendering) return;
    stop();
    const abort = new AbortController();
    renderAbortRef.current = abort;
    let wakeLock: WakeLockSentinel | null = null;
    try {
      wakeLock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
      const out = await renderShow({
        audioBlob: audioBlobRef.current,
        project: projectRef.current,
        getAssetBlob: async (id) => getAsset(id),
        fileName: `${projectRef.current.title || 'show'}.mp4`,
        onProgress: setRendering,
        signal: abort.signal,
      });
      setRendered(out);
      toast.show('rendered', { action: { label: 'share', run: () => void shareOrDownload(out) } });
    } catch (err) {
      // Backing out is not a failure worth a banner.
      if (!(err instanceof RenderCancelled)) fail(err);
    } finally {
      renderAbortRef.current = null;
      setRendering(null);
      void wakeLock?.release().catch(() => {});
    }
  };

  const seek = (v: number) => {
    playheadRef.current = v;
    setT(v);
    paintClock(v);
  };

  const passCount = projectSnap.events.filter((e) => e.kind === 'PASS').length;
  const puppets = castOf(projectSnap).filter((p) => !p.back);
  const busy = mode === 'playing' || mode === 'recording';

  const selected = selectedId ? castOf(projectSnap).find((p) => p.id === selectedId) : undefined;

  /** A mode the whole stage enters: it belongs to no puppet, so nothing
   *  stays selected under it. */
  const enterMode = (m: Mode) => {
    setSheet(null);
    setSelectedId(null);
    if (m === 'doodling') strokeRef.current = [];
    setModeBoth(m);
    dirtyRef.current = true;
  };

  /** A tool the selected puppet is holding. The selection has to survive:
   *  the tool acts on it, and the halo it came from belongs to it. */
  const enterTool = (m: Mode) => {
    setSheet(null);
    setModeBoth(m);
    dirtyRef.current = true;
  };

  const placing =
    mode === 'snipping' || mode === 'mouthing' || mode === 'eyeing' || mode === 'pinning';

  // Every live feature of the selected puppet is something to take hold
  // of. The frame loop puts them where the puppet is, frame by frame.
  const handles: HandleSpec[] = [];
  if (selected && !selected.back && mode === 'idle') {
    if (mouthOf(projectSnap, selected.id)) handles.push({ key: 'mouth', kind: 'mouth' });
    if (eyesOf(projectSnap, selected.id)) handles.push({ key: 'eyes', kind: 'eyes' });
    pinsOf(projectSnap, selected.id).forEach((pin, i) => {
      if (pin) handles.push({ key: `pin:${i}`, kind: 'pin', index: i });
    });
  }
  const canPin =
    !!selected &&
    selected.spec.type === 'cutout' &&
    !snipsOf(projectSnap, selected.id).some((snip) => snip !== null);

  const onHalo = (action: HaloAction) => {
    if (!selected) return;
    switch (action) {
      case 'mouth':
        return enterTool('mouthing');
      case 'eyes':
        return enterTool('eyeing');
      case 'snip':
        return enterTool('snipping');
      case 'pin':
        return enterTool('pinning');
      case 'flip':
        return recastWith(selected, { flip: !selected.flip });
      case 'more':
        return setSheet({ kind: 'more' });
      case 'replace':
        return backdropInputRef.current?.click();
      case 'drop':
        return dropPuppet(selected);
    }
  };

  const castPick = (kind: CastKind) => {
    setSheet(null);
    if (kind === 'photo') return photoInputRef.current?.click();
    if (kind === 'selfie') return snapInputRef.current?.click();
    if (kind === 'backdrop') return backdropInputRef.current?.click();
    if (kind === 'doodle') return enterMode('doodling');
    if (kind === 'word') {
      setTextDraft('');
      setSheet({ kind: 'text' });
    }
  };

  return (
    <div className="showstage">
      <div className="stagearea">
        <div ref={frameRef} className={`stagebox mode-${mode}`}>
          <canvas ref={canvasRef} />
          <TitleBar
            title={projectSnap.title}
            onRename={(title) =>
              commit((p) => ({ ...p, title, updatedAt: new Date().toISOString() }))
            }
            onBack={onBack}
            onMenu={() => setSheet({ kind: 'show' })}
          />
          <BannerView />
          {selected && mode === 'idle' && !busy && (
            <Halo
              name={puppetLabel(selected, castOf(projectSnap).indexOf(selected))}
              backdrop={selected.back}
              canPin={canPin}
              inert={pointerDown}
              onAction={onHalo}
              barRef={haloBarRef}
              outlineRef={selOutlineRef}
            />
          )}
          <Handles
            handles={handles}
            register={registerHandle}
            removingKey={removingKey}
            layerRef={handleLayerRef}
          />
          {mode === 'needsAudio' && (
            <div className="stage-cta" onPointerDown={(e) => e.stopPropagation()}>
              <p>
                {soundLost
                  ? 'the sound for this bit is missing. record it again, or use a file.'
                  : 'every bit starts with the sound.'}
              </p>
              <div className="cta-row">
                <button className="primary" onClick={() => void recordBit()} disabled={casting}>
                  record the bit
                </button>
                <button onClick={() => soundFileInputRef.current?.click()} disabled={casting}>
                  use a file
                </button>
              </div>
              {casting && <ProgressRing value={null} label="reading that file" />}
              {projectSnap.audio && !soundLost && (
                <button onClick={() => setModeBoth('idle')}>keep the old sound</button>
              )}
              {damagedRaw && (
                <button
                  onClick={() =>
                    void shareOrDownload(
                      new File([damagedRaw], `${showId}.damaged.json`, {
                        type: 'application/json',
                      }),
                    )
                  }
                >
                  save the damaged file
                </button>
              )}
            </div>
          )}
          {mode === 'idle' && durationS > 0 && puppets.length === 0 && (
            <div className="stage-cta" onPointerDown={(e) => e.stopPropagation()}>
              <p>now cast a puppet.</p>
              <div className="cta-row">
                <button className="primary" onClick={() => setSheet({ kind: 'cast' })}>
                  cast someone
                </button>
                <button onClick={() => enterMode('doodling')}>draw one</button>
              </div>
              {casting && <ProgressRing value={null} label="cutting out" />}
            </div>
          )}
          {mode === 'micLive' && (
            <div className="stage-cta">
              <p className="live">recording… do the bit</p>
              <button className="primary" onClick={() => void stopBit()}>
                ■ done
              </button>
            </div>
          )}
          {rendering && (
            <div className="render-overlay" onPointerDown={(e) => e.stopPropagation()}>
              <ProgressRing value={rendering.fraction} label="rendering" size={56} />
              <p className="render-phase">
                {rendering.phase === 'video'
                  ? 'drawing'
                  : rendering.phase === 'audio'
                    ? 'mixing'
                    : 'packing'}{' '}
                {Math.round(rendering.fraction * 100)}%
              </p>
              <button onClick={() => renderAbortRef.current?.abort()}>cancel</button>
            </div>
          )}
          {mode === 'recording' && <span className="recdot">●</span>}
          {counting && <div className="stage-hintline">🥁 count-in…</div>}

          <video ref={pipVideoRef} className="pip" muted playsInline hidden={!bodyActive} />

          {placing && (
            <div className="stagepills">
              <button className="pill" onClick={() => setModeBoth('idle')}>
                cancel
              </button>
            </div>
          )}
          {mode === 'doodling' && (
            <div className="stagepills">
              <button className="pill" onClick={() => finishDoodle(false)}>
                cancel
              </button>
              <button className="pill primary" onClick={() => finishDoodle(true)}>
                keep it
              </button>
            </div>
          )}
        </div>
      </div>

      {mode === 'recording' && (
        <div className="foleyrow" onPointerDown={(e) => e.stopPropagation()}>
          <button className="pill" onClick={() => foley('boing')}>
            boing
          </button>
          <button className="pill" onClick={() => foley('slap')}>
            slap
          </button>
          <button className="pill" onClick={() => foley('honk')}>
            honk
          </button>
          <button className="pill" onClick={() => foley('scratch')}>
            scratch
          </button>
          <button className="pill" onClick={() => foley('drop')}>
            drop
          </button>
        </div>
      )}

      {mode !== 'needsAudio' && mode !== 'micLive' && mode !== 'loading' && (
        <>
          <Timeline
            durationS={durationS}
            peaks={peaks}
            onsets={onsets}
            disabled={busy}
            onSeek={seek}
            fillRef={fillRef}
            handleRef={handleRef}
            seekRef={seekRef}
            timeTextRef={timeTextRef}
            initialT={t}
          />
          <Dock
            busy={busy}
            canRecord={puppets.length > 0 && !placing && mode !== 'doodling' && !counting}
            canPlay={durationS > 0 && !placing && mode !== 'doodling' && !counting}
            canUndo={projectSnap.events.length > 0}
            canRedo={redoCount > 0}
            toolsOpen={sheet?.kind === 'cast'}
            onRecord={() => void start(true)}
            onPlay={() => void start(false)}
            onStop={stop}
            onUndo={undo}
            onRedo={redo}
            onTools={() => setSheet(sheet?.kind === 'cast' ? null : { kind: 'cast' })}
          />
        </>
      )}

      {sheet?.kind === 'cast' && (
        <CastSheet
          cast={castOf(projectSnap)}
          images={imagesRef.current}
          seed={projectSnap.seed}
          busy={casting}
          modelProgress={null}
          selectedId={selectedId}
          onPick={castPick}
          onSelect={(id) => {
            setSelectedId(id);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'more' && selected && (
        <MoreSheet
          puppet={selected}
          name={puppetLabel(selected, castOf(projectSnap).indexOf(selected))}
          wireAmount={(source, target) => wireLevel(selected.id, source, target)}
          hand={handOf(selected.id)}
          onRename={(name) => setSpec(selected, { name })}
          onWire={(source, target, amount) => setWire(selected.id, source, target, amount)}
          onScale={(scale) => recastWith(selected, { scale })}
          onSpring={(spring: SpringPreset) => setSpec(selected, { spring })}
          onHand={(hand) => assignHand(selected, hand)}
          onDuplicate={() => {
            setSheet(null);
            duplicatePuppet(selected);
          }}
          onLayer={(dir) => layerPuppet(selected, dir)}
          onCenter={() => recastWith(selected, { x: 0.5, y: 0.55 })}
          onDrop={() => {
            setSheet(null);
            dropPuppet(selected);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'show' && (
        <ShowMenu
          passCount={passCount}
          castCount={puppets.length}
          canRender={passCount > 0 && !rendering}
          rendered={!!rendered}
          trails={wireLevel('', 'on', 'trails')}
          foley={wireLevel('', 'on', 'foley')}
          corpse={corpse}
          onRender={() => {
            setSheet(null);
            void doRender();
          }}
          onShareRender={() => {
            setSheet(null);
            if (rendered) void shareOrDownload(rendered);
          }}
          onBitFile={() => {
            setSheet(null);
            void exportBit();
          }}
          onSound={(mode) => startRetake(mode)}
          onStageWire={(target, amount) => setWire('', 'on', target, amount)}
          onCorpse={setCorpse}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'text' && (
        <Sheet title="what should it say?" onClose={() => setSheet(null)}>
          <input
            className="text-field"
            value={textDraft}
            autoFocus
            maxLength={40}
            aria-label="the word"
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTextPuppet(textDraft);
            }}
          />
          <button className="primary" onClick={() => addTextPuppet(textDraft)}>
            put it on stage
          </button>
        </Sheet>
      )}

      {sheet?.kind === 'retake' && (
        <Sheet
          title={sheet.mode === 'replace' ? 'retake the sound' : 'extend the sound'}
          onClose={() => setSheet(null)}
        >
          <p className="sheet-copy">
            {sheet.mode === 'replace'
              ? 'your moves stay, but they may land differently against new sound.'
              : 'the new sound joins onto the end; everything you performed stays put.'}
          </p>
          <button className="primary" onClick={() => confirmRetake(sheet.mode)}>
            {sheet.mode === 'replace' ? 'record new sound' : 'record more'}
          </button>
          <button onClick={() => setSheet(null)}>keep what I have</button>
        </Sheet>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void castPhoto(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={snapInputRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => {
          void castPhoto(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={backdropInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onBackdropPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={soundFileInputRef}
        type="file"
        accept={SOUND_FILE_ACCEPT}
        hidden
        onChange={(e) => {
          void pickSoundFile(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** While staging drags, the sim needs the overridden home too. */
function applyStagingCast(project: Project, staging: StagingDrag | null): Project['events'] {
  if (!staging) return project.events;
  return project.events.map((e) =>
    e.kind === 'CAST' && e.puppetId === staging.puppetId
      ? { ...e, x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot }
      : e,
  );
}

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  strokes: number[][],
): void {
  ctx.strokeStyle = '#ece5db';
  ctx.lineWidth = Math.max(2, W * 0.012);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    ctx.beginPath();
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      const x = stroke[i]! * W;
      const y = stroke[i + 1]! * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
