// The stage, whole instrument: record the bit, cast puppets (photo, snap,
// doodle, backdrop), snip them apart, pin mouths and googly eyes, then
// perform in passes from any point on the playhead. Grab a body or a
// snipped-off piece; hold the talker and its mouth speaks.
//
// While idle a tap selects and a drag moves. A selected puppet wears its
// own tools (the halo) and its features become handles you can take hold
// of. Two fingers resize and rotate.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
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
  type SpringPreset,
} from '../engine/recipe';
import { detectOnsets } from '../engine/onsets';
import { redoStep, undoStep } from '../engine/history';
import { impactSfx, renderSfx, type SfxName } from '../engine/sfx';
import { computeVoiceTrack, EMPTY_VOICE, type VoiceTrack } from '../engine/envelope';
import { CAMERA_ID, REST_CAMERA, magnification, toScreen, toStage, type CameraPose } from '../engine/camera';
import { askTilt, tiltSupported, watchTilt } from '../media/gyro';
import {
  castOf,
  createShowSim,
  eyesOf,
  cutsOf,
  inkOf,
  anchorOn,
  lanePasses,
  localToWorld,
  lookOf,
  mouthOf,
  pinsOf,
  sameChannel,
  snipsOf,
  foldsOf,
  voiceOf,
  type Channel,
  type PuppetPose,
  type ShowPuppet,
  type ShowSim,
} from '../engine/show';
import {
  AudioSourceHandle,
  JamAudio,
  concatAudio,
  mixdownMono,
  type VoiceLane,
} from '../media/audio';
import { getAsset, saveAsset } from '../media/assets';
import { exportBundle } from '../media/bundle';
import { makeCutout } from '../media/cutout';
import { splitPieces } from '../engine/pieces';
import { MicRecorder } from '../media/mic';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { PoseDriver } from '../media/pose';
import { effectiveWires, wireAmount, wireAt, type WireMap } from '../engine/wires';
import {
  isWorldSignal,
  parseSignal,
  timeSignalAt,
  worldSignalAt,
  type Bands,
} from '../engine/signals';
import { bandsFor } from '../media/bands';
import { loadVideos, prefetchVideos, probeVideo } from '../media/video';
import { makeKit } from '../media/kit';
import {
  analyzeVideo,
  loadVideoAnalyses,
  mediapipeModels,
  rememberTracks,
  serializeTracks,
  tracksOf,
  videoSourcesOf,
} from '../media/videoAnalysis';
import { poseToSamples, type Joint } from '../engine/video';
import { COMMON_SIGNALS, WiresRoom, type WirePatch } from './rooms/Wires';
import { BannerView, useBanner } from '../kit/Banner';
import { Sheet } from '../kit/Sheet';
import { IconButton } from '../kit/IconButton';
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
import { DOODLE_COLORS, DoodleBar, type DoodleInk } from './stage/DoodleBar';
import { STICKERS, stickerSpec } from './stage/stickers';
import { canEnter, isBusy, isPlacing, rulesFor, type Mode } from './stage/machine';
import {
  TILT_KEY,
  installGestures,
  newId,
  type Grab,
  type HandleDrag,
  type StagingDrag,
} from './stage/gestures';
import { createStagePlayer, drawMarks, type StagePlayer } from './stage/player';
import {
  createSurface,
  STARTUP_RENDERER,
  type RendererChoice,
  type StageSurface,
} from '../render/surface';
import { MoreSheet } from './stage/sheets/MoreSheet';
import { Tray, type KeepAs } from './rooms/Tray';
import { ShotsRoom } from './rooms/Shots';
import { useShots } from './stage/useShots';
import type { Genome } from '../engine/ink';
import { DirectorView } from './stage/DirectorView';
import { ShowMenu } from './stage/sheets/ShowMenu';
import { RenderSheet } from './stage/sheets/RenderSheet';
import { posterFor } from '../media/poster';
import { SoundSheet, type SoundTrim } from './stage/sheets/SoundSheet';
import { RecordPanel, clock as clockText } from './stage/RecordPanel';
import { Lanes, type Lane, type LoopRegion } from './stage/Lanes';
import { TitleBar } from './stage/TitleBar';
import { Timeline } from './stage/Timeline';
import { countCommit, probe } from '../e2e/probe';
import { RenderCancelled, renderShow, type RenderProgress } from '../media/render';
import {
  foleyOn,
  impactListener,
  visualsOf,
  type OwnVoice,
  type PuppetVisual,
} from '../engine/frame';
import { shareOrDownload } from '../media/shareFile';
import {
  loadStageImages,
  type StageImages,
} from '../media/stageDraw';

interface BodyMap {
  right: { puppetId: string; channel: Channel } | null;
  left: { puppetId: string; channel: Channel } | null;
}

const HOLD_SAMPLE_S = 0.25;
/** A bit is a bit, not a podcast. Long enough for a scene, short enough
 *  that a forgotten mic does not fill the phone. */
const MAX_RECORD_S = 100;




export function Stage({
  showId,
  onBack,
  onAspect,
}: {
  showId: string;
  onBack: () => void;
  /** The app frame needs to know: a wide bit stops the turn-your-phone
   *  card, which is about a tall stage in a short window. */
  onAspect?: (aspect: '9:16' | '16:9') => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Marks that are not the show: pin rings, the scissor line, a doodle in
   *  progress. They live on their own canvas so the stage canvas holds
   *  nothing but rendered frames (and can become a WebGL canvas). */
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const overlayInkedRef = useRef(false);
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
    (err: unknown) => bannerRef.current.error(err instanceof Error ? err.message : String(err)),
    [],
  );
  /** Casting a photo can take seconds on a cold model; say so. */
  const [casting, setCasting] = useState(false);
  /** Bytes of the scissors fetched so far, 0..1, or null for a wait with
   *  no number on it. */
  const [castProgress, setCastProgress] = useState<number | null>(null);
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
    | { kind: 'sound' }
    | { kind: 'render' }
    | { kind: 'more' }
    | { kind: 'show' }
    | { kind: 'wires'; pid: string }
    | { kind: 'shots' }
    | { kind: 'ink'; target: string | null }
  >(null);
  const [textDraft, setTextDraft] = useState('');
  /** dropPuppet is defined above undo; this keeps the toast's undo honest. */
  const undoRef = useRef<() => void>(() => {});
  const seenDemoHintRef = useRef(false);
  /** Three things nobody guesses, said once each, ever. They go through the
   *  banner rather than a tour: a tour you cannot leave is worse than a
   *  control you have not found yet. */
  const coachRef = useRef<string | null>(null);
  const coach = useCallback((key: string, say: string) => {
    const flag = `bits-coach-${key}`;
    try {
      if (localStorage.getItem(flag)) return;
      localStorage.setItem(flag, '1');
    } catch {
      // Private mode: say it every time rather than never.
    }
    coachRef.current = say;
  }, []);
  const renderAbortRef = useRef<AbortController | null>(null);
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<File | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [onsets, setOnsets] = useState<number[]>([]);
  /** puppetId -> its own envelope, for the mouths. */
  const voicesRef = useRef<Map<string, OwnVoice>>(new Map());
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [redoCount, setRedoCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [corpse, setCorpse] = useState(false);
  const corpseRef = useRef(corpse);
  corpseRef.current = corpse;
  const [lanesOpen, setLanesOpen] = useState(false);
  const onAspectRef = useRef(onAspect);
  useEffect(() => {
    onAspectRef.current = onAspect;
  }, [onAspect]);
  useEffect(() => {
    onAspectRef.current?.(projectSnap.aspect ?? '9:16');
  }, [projectSnap.aspect]);
  useEffect(() => () => onAspectRef.current?.('9:16'), []);
  /** Perform: the stage and nothing else. Two people, four hands, no
   *  chrome to fat-finger. */
  const [performing, setPerforming] = useState(false);
  /** After a blind take, the reveal: everything that was hidden, played
   *  back at once. */
  const [curtain, setCurtain] = useState(false);
  const [selectedPassId, setSelectedPassId] = useState<string | null>(null);
  /** Solo is a preview, not a recipe change: the sim is built from a
   *  project with the other puppets' passes stripped, exactly as corpse
   *  recording does. Nothing is written, so nothing needs undoing. */
  const [soloId, setSoloId] = useState<string | null>(null);
  const soloRef = useRef<string | null>(null);
  soloRef.current = soloId;
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const loopRef = useRef<LoopRegion | null>(null);
  loopRef.current = loop;
  const lanesPlayheadRef = useRef<HTMLDivElement>(null);
  /** Set by the loop when a lap ends, read once by the frame loop: a wrap
   *  has to rebuild the sim, and doing that inside the draw is asking for
   *  a half-advanced frame. */
  const wrapRef = useRef(false);
  /** The recipe names audio we can't load or decode (imported bit whose
   *  bundle lacked it, OPFS eviction): offer a re-record, never a dead end. */
  const [soundLost, setSoundLost] = useState(false);
  const retakeModeRef = useRef<'replace' | 'extend'>('replace');
  /** Set while the mic is recording one puppet's own take rather than the
   *  bit itself. */
  const voiceTargetRef = useRef<{ puppetId: string; at: number } | null>(null);
  /** Decoded takes: envelopes for the mouths, sinks for the speakers. Kept
   *  by asset id, because re-deriving them on every commit would decode
   *  the same audio dozens of times a session. */
  const ownVoicesRef = useRef<Map<string, OwnVoice>>(new Map());
  const voiceHandlesRef = useRef<Map<string, AudioSourceHandle>>(new Map());
  const [retakeMode, setRetakeMode] = useState<'replace' | 'extend'>('replace');
  /** The mic take's level and clock are painted through refs, like the
   *  playhead: a meter that cost a React commit a frame would undo the
   *  one optimisation the stage has. */
  const meterRef = useRef<HTMLDivElement>(null);
  const meterFillRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  /** Draws the stage and remembers the frame before, for trails. */
  /** Hears landings from the live sim; rebuilt with it. */
  const liveImpactsRef = useRef<ReturnType<typeof impactListener> | null>(null);
  const liveImpactCountRef = useRef(0);

  const audioBlobRef = useRef<Blob | null>(null);
  const voiceRef = useRef<VoiceTrack>(EMPTY_VOICE);
  const jamRef = useRef<JamAudio | null>(null);
  const micRef = useRef<MicRecorder | null>(null);
  const imagesRef = useRef<StageImages>(new Map());
  const visualsRef = useRef<Map<string, PuppetVisual>>(new Map());
  const wiresRef = useRef<WireMap>(new Map());
  const simRef = useRef<ShowSim | null>(null);
  /** Band analysis of the bit's sound, once the worker has it. */
  const bandsRef = useRef<Bands | null>(null);
  /** The onsets as of now, for the player, which outlives any render. */
  const onsetsRef = useRef<number[]>([]);
  onsetsRef.current = onsets;
  const playerRef = useRef<StagePlayer>(null as unknown as StagePlayer);
  if (!playerRef.current) {
    playerRef.current = createStagePlayer({
      visualsRef,
      wiresRef,
      imagesRef,
      analysis: () => {
        const videos = videoSourcesOf(castOf(projectRef.current));
        return {
          voice: voiceRef.current,
          onsets: onsetsRef.current,
          voices: voicesRef.current,
          bands: bandsRef.current,
          ...(videos.size ? { videos } : {}),
        };
      },
    });
  }
  const lastPosesRef = useRef<Map<string, PuppetPose>>(new Map());
  /** The camera the last frame was drawn through; null at rest. */
  const lastCameraRef = useRef<CameraPose | null>(null);
  /** What draws the stage canvas, made for the canvas element it draws. */
  const surfaceRef = useRef<{ canvas: HTMLCanvasElement; surface: StageSurface } | null>(null);
  const rendererChoiceRef = useRef<RendererChoice>(STARTUP_RENDERER);
  /** Bumped to give the stage a fresh canvas element after a lost context. */
  const [canvasKey, setCanvasKey] = useState(0);
  /** The camera in hand: while a take rolls, fingers move it instead of
   *  the sheets. */
  const [cameraArmed, setCameraArmed] = useState(false);
  const [sideView, setSideView] = useState(false);
  const cameraArmedRef = useRef(false);
  useEffect(() => {
    cameraArmedRef.current = cameraArmed;
  }, [cameraArmed]);
  /** One grab per finger, so two people can perform at once. It used to
   *  be a single grab: the second finger stole the first one's puppet and
   *  the first one's pass ended where it was touched. */
  const grabsRef = useRef<Map<number, Grab>>(new Map());
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
  /** Parallel to strokeRef, one entry per stroke. */
  const inkRef = useRef<DoodleInk[]>([]);
  const [ink, setInk] = useState<DoodleInk>({ color: DOODLE_COLORS[0]!.value, width: 1 });
  const inkNowRef = useRef(ink);
  inkNowRef.current = ink;
  const [erasing, setErasing] = useState(false);
  const erasingRef = useRef(false);
  erasingRef.current = erasing;
  /** Re-renders the bar when a stroke lands or is rubbed out. */
  const [strokeCount, setStrokeCount] = useState(0);
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
  const coachRef2 = useRef<(key: string, say: string) => void>(() => {});
  /** stopBit is defined below the frame loop, which enforces the cap. */
  const stopBitRef = useRef<() => void>(() => {});
  const startRef = useRef<(recording: boolean) => void>(() => {});
  const seekRef2 = useRef<(t: number) => void>(() => {});
  const finishDoodleRef = useRef<(keep: boolean) => void>(() => {});
  const sheetRef = useRef<unknown>(null);
  const commitOneGrabRef = useRef<(grab: Grab) => void>(() => {});
  const buildSimRef = useRef<(recording: boolean, from: number) => ShowSim>(
    () => createShowSim(createProject('')),
  );
  const wrapLoopRef = useRef<() => void>(() => {});

  /** The one way the stage changes mode. The machine says which moves
   *  exist; a move that is not one of them is a bug in the caller, and in
   *  development it says so loudly rather than leaving the stage somewhere
   *  nothing can get it out of. */
  const setModeBoth = (m: Mode) => {
    if (!canEnter(modeRef.current, m)) {
      if (import.meta.env.DEV) {
        console.error(`stage: ${modeRef.current} -> ${m} is not a move`);
      }
      return;
    }
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
      // Drawing has its own way out, twice over, on the bar below.
      if (mode === 'doodling') banner.hint(text);
      else {
        banner.hint(text, {
          label: 'cancel',
          run: () => {
            modeRef.current = 'idle';
            setMode('idle');
          },
        });
      }
    } else if (mode === 'idle' && showId === 'show-demo' && !seenDemoHintRef.current) {
      // The demo is a real bit, and saying so is the whole tutorial.
      seenDemoHintRef.current = true;
      banner.hint('watch it once. then tap a puppet and wreck it.');
    } else if (mode === 'idle' && coachRef.current) {
      const say = coachRef.current;
      coachRef.current = null;
      banner.hint(say);
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

  /** Any change to the recipe makes the last film out of date, so the
   *  menu stops offering to share it. */
  const commit = useCallback(
    (mutate: (p: Project) => Project) => applyProject(mutate, true),
    [applyProject],
  );

  const reloadImages = useCallback(async () => {
    imagesRef.current = await loadStageImages(castOf(projectRef.current), async (id) =>
      getAsset(id),
    );
    await loadVideos(
      castOf(projectRef.current).map((p) => p.spec),
      async (id) => getAsset(id),
    );
    await loadVideoAnalyses(
      castOf(projectRef.current).map((p) => p.spec),
      async (id) => getAsset(id),
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
    // Bands come later, from a worker; band wires read silence until then.
    const assetId = projectRef.current.audio?.assetId;
    if (assetId) {
      void bandsFor(assetId, blob).then((bands) => {
        bandsRef.current = bands;
        dirtyRef.current = true;
      });
    }
  }, []);

  /** Decode every take the recipe names, once each, and hand the jam the
   *  lanes it needs. Cheap when nothing changed: the cache is keyed on the
   *  asset, and a take never changes once recorded. */
  const reloadVoices = useCallback(async () => {
    const project = projectRef.current;
    const want = new Map<string, { assetId: string; at: number; durationS: number; gain: number }>();
    for (const p of castOf(project)) {
      const v = voiceOf(project, p.id);
      if (v) want.set(p.id, { assetId: v.assetId, at: v.at, durationS: v.durationS, gain: v.gain ?? 1 });
    }
    const owns = new Map<string, OwnVoice>();
    const lanes: VoiceLane[] = [];
    for (const [puppetId, v] of want) {
      try {
        let handle = voiceHandlesRef.current.get(v.assetId);
        if (!handle) {
          const blob = await getAsset(v.assetId);
          const opened = await AudioSourceHandle.open(blob);
          if (!opened) continue;
          handle = opened;
          voiceHandlesRef.current.set(v.assetId, opened);
          const mix = await mixdownMono(blob);
          if (mix) {
            ownVoicesRef.current.set(v.assetId, {
              track: computeVoiceTrack(mix.samples, mix.sampleRate),
              at: v.at,
              durationS: v.durationS,
            });
          }
        }
        const cached = ownVoicesRef.current.get(v.assetId);
        if (cached) owns.set(puppetId, { ...cached, at: v.at, durationS: v.durationS });
        lanes.push({ sink: handle.makeSink(), at: v.at, gain: v.gain });
      } catch {
        // A take that will not open leaves its puppet on the bed.
      }
    }
    voicesRef.current = owns;
    jamRef.current?.setVoices(lanes);
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
      await reloadVoices();
      if (!cancelled) setModeBoth(jamRef.current ? 'idle' : 'needsAudio');
    })().catch((err: unknown) => {
      if (!cancelled) fail(err);
    });
    const openVoices = voiceHandlesRef.current;
    const longPress = longPressRef;
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (longPress.current) clearTimeout(longPress.current);
      jamRef.current?.dispose();
      for (const handle of openVoices.values()) handle.dispose();
      openVoices.clear();
      jamRef.current = null;
      for (const img of imagesRef.current.values()) img.close();
      imagesRef.current = new Map();
    };
  }, [showId, reloadImages, reloadVoices, analyzeAudio, fail]);

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
        ? {
            ...puppet,
            home: { x: staging.x, y: staging.y, scale: staging.scale, rot: staging.rot },
          }
        : puppet;
    // Through the camera: the outline and the handles sit where the sheet
    // is drawn, not where it is on the stage plane.
    const cam = lastCameraRef.current;
    const screen = (x: number, y: number) => toScreen(cam, live.depth, x, y, W, H);
    const centre = screen(pose.root.x, pose.root.y);
    const zoom = magnification(cam, live.depth);
    const cx = centre.x * W;
    const cy = centre.y * H;
    const bw = live.spec.w * live.home.scale * W * zoom;
    const bh = live.spec.h * live.home.scale * H * zoom;

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
    if (!visual) return;
    const drag = handleDragRef.current;
    const place = (key: string, lx: number, ly: number) => {
      const onStage =
        drag && drag.key === key ? { x: drag.x, y: drag.y } : localToWorld(pose.root, live, lx, ly);
      const world = screen(onStage.x, onStage.y);
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
        const at = screen(state.x, state.y);
        positions.set(key, { x: at.x * W, y: at.y * H });
        const el = handleElsRef.current.get(key);
        if (el) el.style.transform = `translate(${at.x * W}px, ${at.y * H}px)`;
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
    const lanesHead = lanesPlayheadRef.current;
    if (lanesHead) lanesHead.style.left = `${dur > 0 ? (clock / dur) * 100 : 0}%`;
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
      const audio = projectRef.current.audio;
      // Punch-out is exact: a pass stops where the stretch does, not a
      // frame or two past it where nothing will ever play it back.
      const end = Math.min(
        audio?.durationS ?? 0,
        audio?.trim?.to ?? Infinity,
        loopRef.current?.to ?? Infinity,
      );
      const clock = Math.min(end, Math.max(0, currentClock()));
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
      const performed = grab.via ? { ...base, via: grab.via } : base;
      const pass: PassEvent =
        grab.channel === null
          ? performed
          : 'piece' in grab.channel
            ? { ...performed, piece: grab.channel.piece }
            : 'pin' in grab.channel
              ? { ...performed, pin: grab.channel.pin }
              : { ...performed, prop: grab.channel.prop };
      commit((p) => appendEvent(p, pass));
    },
    [commit, currentClock],
  );

  /** What the sim is allowed to see. Blind recording hides every earlier
   *  pass; soloing hides everyone else's. Both are previews: neither
   *  writes anything, so neither needs undoing. */
  const simProjectFor = useCallback((recording: boolean): Project => {
    const project = projectRef.current;
    const blind = recording && corpseRef.current;
    const solo = soloRef.current;
    if (!blind && !solo) return project;
    return {
      ...project,
      events: project.events.filter(
        (e) => e.kind !== 'PASS' || (!blind && (!solo || e.puppetId === solo)),
      ),
    };
  }, []);

  const buildSim = useCallback(
    (recording: boolean, from: number): ShowSim => {
      // Landings are heard at the sim's own resolution, so the stage plays
      // the same impacts the film will. The fast-forward to `from` is not
      // something anyone hears.
      const ears = impactListener();
      liveImpactsRef.current = ears;
      const sim = createShowSim(simProjectFor(recording), 0, (id, channel, tt) => {
        for (const finger of grabsRef.current.values()) {
          if (
            finger.puppetId === id &&
            sameChannel(finger.channel, channel) &&
            tt >= finger.samples[0]!
          ) {
            return { x: finger.x, y: finger.y };
          }
        }
        for (const g of bodyGrabsRef.current) {
          if (g.puppetId === id && sameChannel(g.channel, channel) && tt >= g.samples[0]!) {
            return { x: g.x, y: g.y };
          }
        }
        return null;
      }, ears.onStep, { resumeAt: from });
      sim.advanceTo(from);
      ears.drain();
      return sim;
    },
    [simProjectFor],
  );

  useEffect(() => {
    buildSimRef.current = buildSim;
  }, [buildSim]);

  /** Close every open grab: the take is over, or the loop is going round
   *  again and each lap's holds become their own passes. */
  const commitGrab = useCallback(() => {
    const fingers = [...grabsRef.current.values()];
    grabsRef.current.clear();
    for (const g of fingers) commitOneGrab(g);
    if (fingers.length > 0) coachRef2.current('film', 'the ⋯ at the top makes the film.');
    const body = bodyGrabsRef.current;
    bodyGrabsRef.current = [];
    for (const g of body) commitOneGrab(g);
  }, [commitOneGrab]);

  useEffect(() => {
    commitGrabRef.current = commitGrab;
    commitOneGrabRef.current = commitOneGrab;
    coachRef2.current = coach;
  }, [commitGrab, commitOneGrab, coach]);

  const stop = useCallback(() => {
    // Hand the playhead back to React so the scrubber and the clock agree
    // with what the loop last painted.
    setT(playheadRef.current);
    // A blind take was performed against an empty stage. The point of it
    // is meeting the whole show afterwards, so it is met, not waited for.
    if (modeRef.current === 'recording' && corpseRef.current) setCurtain(true);
    if (modeRef.current === 'recording') commitGrabRef.current();
    jamRef.current?.stop();
    simRef.current = null;
    grabsRef.current.clear();
    bodyGrabsRef.current = [];
    poseDriverRef.current?.dispose();
    poseDriverRef.current = null;
    setBodyActive(false);
    setModeBoth('idle');
    dirtyRef.current = true;
  }, []);

  const start = async (recording: boolean) => {
    const audio = projectRef.current.audio;
    const dur = audio?.durationS ?? 0;
    if (dur <= 0) return;
    // A trimmed bit plays only what it kept. Show time never moves, so a
    // pass at five seconds is still at five seconds.
    const fromLimit = audio?.trim?.from ?? 0;
    const toLimit = audio?.trim?.to ?? dur;
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
    // A stretch is where playing starts and where a punched-in pass
    // begins and ends; without one the trim decides, and without that the
    // whole take does.
    const region = loopRef.current;
    const low = Math.max(fromLimit, region?.from ?? 0);
    const high = Math.min(toLimit, region?.to ?? dur);
    let from = playheadRef.current;
    if (from >= high - 0.05 || from < low) from = low;
    playheadRef.current = from;
    liveImpactCountRef.current = 0;

    if (recording && jamRef.current) {
      setCounting(true);
      await jamRef.current.countIn();
      setCounting(false);
    }

    const sim = buildSimRef.current(recording, from);
    simRef.current = sim;
    clockFromRef.current = from;
    prevClockRef.current = from;
    wallStartRef.current = performance.now() + 50;
    void jamRef.current?.play(from);
    if (recording) coach('perform', 'hold a puppet while it plays. that is a pass.');
    setModeBoth(recording ? 'recording' : 'playing');
  };

  /** Go round again: close the open grabs so the lap just performed
   *  becomes a pass, rebuild the sim so the next lap plays it, and start
   *  the sound over at the top of the stretch. */
  const wrapLoop = useCallback(() => {
    const region = loopRef.current;
    if (!region) return;
    if (modeRef.current === 'recording') commitGrabRef.current();
    const from = region.from;
    playheadRef.current = from;
    prevClockRef.current = from;
    simRef.current = buildSimRef.current(modeRef.current === 'recording', from);
    clockFromRef.current = from;
    wallStartRef.current = performance.now();
    void jamRef.current?.play(from);
    paintClock(from);
    vibrate(8);
  }, [paintClock]);

  useEffect(() => {
    wrapLoopRef.current = wrapLoop;
  }, [wrapLoop]);

  startRef.current = (recording: boolean) => void start(recording);

  // The reveal: hold for a beat on a drawn curtain, then play the lot.
  useEffect(() => {
    if (!curtain) return;
    const id = setTimeout(() => {
      setCurtain(false);
      playheadRef.current =
        loopRef.current?.from ?? projectRef.current.audio?.trim?.from ?? 0;
      startRef.current(false);
    }, 1100);
    return () => clearTimeout(id);
  }, [curtain]);

  /** Keys, for anyone on a laptop or with a keyboard paired to a phone.
   *  Space plays and stops, the arrows scrub, Escape backs out of whatever
   *  is open. Nothing here is the only way to do anything. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never steal a key from a field, a slider or a menu.
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const m = modeRef.current;
      if (e.key === 'Escape') {
        if (sheetRef.current) {
          setSheet(null);
        } else if (m !== 'idle' && m !== 'playing' && m !== 'recording') {
          if (m === 'doodling') finishDoodleRef.current(false);
          else setModeBoth('idle');
        } else if (m === 'playing' || m === 'recording') {
          stop();
        } else {
          setSelectedId(null);
        }
        e.preventDefault();
        return;
      }
      if (e.key === ' ') {
        if (m === 'playing' || m === 'recording') stop();
        else if (m === 'idle') startRef.current(false);
        else return;
        e.preventDefault();
        return;
      }
      if (m !== 'idle') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dur = projectRef.current.audio?.durationS ?? 0;
        if (dur <= 0) return;
        const step = e.shiftKey ? 1 : 0.1;
        seekRef2.current(playheadRef.current + (e.key === 'ArrowRight' ? step : -step));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  // Frame loop: clock, simulation, drawing, seek previews, hold sampling.
  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (wrapRef.current) {
        wrapRef.current = false;
        wrapLoopRef.current();
      }
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
      // One surface per canvas element: GL on a real GPU, canvas otherwise.
      // A lost GL context gets a fresh canvas element, drawn by Canvas2D.
      let surf = surfaceRef.current;
      if (!surf || surf.canvas !== canvas) {
        surf?.surface.dispose();
        surf = { canvas, surface: createSurface(canvas, rendererChoiceRef.current) };
        surfaceRef.current = surf;
        canvas.dataset.renderer = surf.surface.kind;
        dirtyRef.current = true;
      }
      if (surf.surface.lost) {
        rendererChoiceRef.current = '2d';
        surfaceRef.current = null;
        setCanvasKey((k) => k + 1);
        return;
      }
      const surface = surf.surface;

      const m = modeRef.current;
      const project = projectRef.current;
      const dur = project.audio?.durationS ?? 0;

      if (m === 'micLive') {
        const mic = micRef.current;
        if (mic) {
          const level = mic.level();
          const fill = meterFillRef.current;
          if (fill) fill.style.width = `${Math.round(level * 100)}%`;
          meterRef.current?.setAttribute('aria-valuenow', String(Math.round(level * 100)));
          const secs = mic.elapsedS;
          const text = elapsedRef.current;
          if (text) text.textContent = clockText(secs);
          if (secs >= (probe.overrides.maxRecordSeconds ?? MAX_RECORD_S)) stopBitRef.current();
        }
        return;
      }

      if (m === 'playing' || m === 'recording') {
        if (overlayInkedRef.current && overlayRef.current) {
          overlayRef.current.getContext('2d')?.clearRect(0, 0, W, H);
          overlayInkedRef.current = false;
        }
        const region = loopRef.current;
        const stopAt = Math.min(region?.to ?? Infinity, project.audio?.trim?.to ?? dur);
        const now = currentClock();
        const clock = Math.max(clockFromRef.current, Math.min(stopAt, now));
        playheadRef.current = clock;
        paintClock(clock);

        if (m === 'recording') {
          // A finger that stops moving still holds: without this the pass
          // would end where the movement did.
          for (const grab of grabsRef.current.values()) {
            const lastT = grab.samples[grab.samples.length - 3]!;
            if (clock - lastT >= HOLD_SAMPLE_S) grab.samples.push(clock, grab.x, grab.y);
          }
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
            // The wrist is where it is on screen; the pass records the
            // stage point under it at the puppet's depth, as a finger's does.
            const depth =
              castOf(project).find((p) => p.id === assigned.puppetId)?.depth ?? 0;
            const at = toStage(lastCameraRef.current, depth, hand.x, hand.y, W, H);
            let g = bodyGrabsRef.current.find(
              (x) => x.puppetId === assigned.puppetId && sameChannel(x.channel, assigned.channel),
            );
            if (!g) {
              g = {
                puppetId: assigned.puppetId,
                channel: assigned.channel,
                samples: [clock, at.x, at.y],
                x: at.x,
                y: at.y,
                depth,
              };
              bodyGrabsRef.current.push(g);
            }
            g.x = at.x;
            g.y = at.y;
            const lastT = g.samples[g.samples.length - 3]!;
            if (clock - lastT >= 1 / 60) g.samples.push(clock, at.x, at.y);
          }
        }

        const sim = simRef.current;
        if (sim) {
          const clips = videoSpecsOf(project);
          if (clips.length > 0) prefetchVideos(clips, clock);
          const frame = playerRef.current.playing(surface, W, H, project, sim, clock);
          lastPosesRef.current = playerRef.current.lastPoses();
          lastCameraRef.current = frame.camera;
          const landed = liveImpactsRef.current?.drain() ?? [];
          if (foleyOn(wiresRef.current)) {
            for (let n = landed.length; n > 0; n--) {
              void jamRef.current?.playSfx(renderSfx(impactSfx(liveImpactCountRef.current++)));
            }
          }
        }
        layoutOverlays();
        if (now >= stopAt) {
          // A lap ends where the stretch does. The sim only ever runs
          // forward, so going round again means building a new one — from
          // a project that now includes the pass just performed, which is
          // the whole point of looping.
          if (region && region.to - region.from > 0.2) wrapRef.current = true;
          else stop();
        }
        return;
      }

      // Idle: throttled re-sim when the playhead moved, else draw on dirty.
      // A clip's frames arrive after the still was drawn, so a stage with
      // clips on it redraws its still a few times a second.
      const clips = videoSpecsOf(project);
      if (clips.length > 0) {
        prefetchVideos(clips, playheadRef.current);
        if (performance.now() - lastSeekDrawRef.current > 200) dirtyRef.current = true;
      }
      const wantSeekSim =
        m === 'idle' &&
        seekSimAtRef.current !== playheadRef.current &&
        performance.now() - lastSeekDrawRef.current > 150;
      if (dirtyRef.current || wantSeekSim) {
        dirtyRef.current = false;
        seekSimAtRef.current = playheadRef.current;
        lastSeekDrawRef.current = performance.now();
        const frame = playerRef.current.still(
          surface,
          W,
          H,
          project,
          stagingRef.current,
          playheadRef.current,
        );
        lastPosesRef.current = playerRef.current.lastPoses();
        lastCameraRef.current = frame.camera;
        const overlay = overlayRef.current;
        if (overlay) {
          const mode = modeRef.current;
          drawMarks(overlay, W, H, frame, lastPosesRef.current, {
            strokes: mode === 'doodling' ? strokeRef.current : null,
            inks: inkRef.current,
            snip: mode === 'snipping' ? snipStrokeRef.current : null,
          });
          overlayInkedRef.current = true;
        }
        layoutOverlays();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stop, currentClock, onsets, paintClock, layoutOverlays]);

  // Pointer handling lives in ui/stage/gestures.ts.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    return installGestures({
      frame,
      canvasRef,
      projectRef,
      modeRef,
      lastPosesRef,
      lastCameraRef,
      cameraArmedRef,
      visualsRef,
      selectedIdRef,
      handlePxRef,
      longPressRef,
      grabsRef,
      stagingRef,
      handleDragRef,
      pointerDownRef,
      dirtyRef,
      erasingRef,
      strokeRef,
      inkRef,
      inkNowRef,
      snipStrokeRef,
      bannerRef,
      toastRef,
      undoRef,
      commitOneGrabRef,
      commit,
      currentClock,
      setModeBoth,
      setSelectedId,
      setPointerDown,
      setRemovingKey,
      setStrokeCount,
    });
  }, [commit, currentClock]);

  // The bit: mic recording.
  /** A take for one puppet, recorded against the bit so the two halves
   *  land on each other. Starts where the playhead is. */
  const recordVoice = (puppet: ShowPuppet) => {
    voiceTargetRef.current = { puppetId: puppet.id, at: Math.max(0, playheadRef.current) };
    setSheet(null);
    void recordBit();
  };

  const recordBit = async () => {
    const mic = new MicRecorder();
    try {
      await mic.start();
    } catch {
      // Denied, or no mic at all. Saying so beats a screen that does
      // nothing, and the file route is still open.
      bannerRef.current.error('no microphone. you can use a file instead.');
      return;
    }
    micRef.current = mic;
    setRetakeMode(retakeModeRef.current);
    setModeBoth('micLive');
    // A take for a puppet is performed against the bit, so the bit plays
    // while it is recorded.
    if (voiceTargetRef.current) void jamRef.current?.play(voiceTargetRef.current.at);
  };

  /** Throw the take away and go back to whatever was there before. */
  const cancelBit = () => {
    micRef.current?.cancel();
    micRef.current = null;
    retakeModeRef.current = 'replace';
    voiceTargetRef.current = null;
    jamRef.current?.stop();
    setModeBoth(projectRef.current.audio ? 'idle' : 'needsAudio');
  };

  const stopBit = async () => {
    const mic = micRef.current;
    if (!mic) return;
    const quiet = mic.peakLevel < 0.06;
    let blob = await mic.stop();
    micRef.current = null;

    // A take belongs to one puppet; the bit itself is untouched.
    const voiceTarget = voiceTargetRef.current;
    if (voiceTarget) {
      voiceTargetRef.current = null;
      jamRef.current?.stop();
      const handle = await AudioSourceHandle.open(blob);
      const durationS = handle ? await handle.duration() : 0;
      handle?.dispose();
      if (durationS <= 0) {
        bannerRef.current.error('could not read that take; try again');
        setModeBoth('idle');
        return;
      }
      const assetId = await saveAsset(blob, 'webm');
      commit((p) =>
        appendEvent(p, {
          kind: 'VOICE',
          id: newId(),
          at: voiceTarget.at,
          puppetId: voiceTarget.puppetId,
          assetId,
          durationS,
        }),
      );
      await reloadVoices();
      setSelectedId(voiceTarget.puppetId);
      setModeBoth('idle');
      if (quiet) toast.show('that take was very quiet. check the mic and try again?');
      return;
    }
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
    // The trim belonged to the old sound; a new one arrives whole.
    commit((p) => ({
      ...p,
      audio: { assetId, durationS: durationRecorded },
      sound: { source: 'mic' as const },
    }));
    setSoundLost(false);
    await reloadVoices();
    playheadRef.current = 0;
    setT(0);
    setModeBoth('idle');
    // A take the mic never heard is a bit that will never play. Better to
    // hear it now than after casting a puppet to it.
    if (quiet) toast.show('that take was very quiet. check the mic and try again?');
  };
  stopBitRef.current = () => void stopBit();

  // Casting.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const snapInputRef = useRef<HTMLInputElement>(null);
  const backdropInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const kitInputRef = useRef<HTMLInputElement>(null);
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

  /** A clip, as a sheet that plays from the playhead, sized to its own
   *  shape on the stage's. */
  const castVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCasting(true);
    setCastProgress(null);
    try {
      const info = await probeVideo(file);
      if (!info) {
        banner.error("couldn't play that video");
        return;
      }
      const ext = (file.name.split('.').pop() ?? 'mp4').toLowerCase();
      const assetId = await saveAsset(file, ext);
      const frame = frameRef.current;
      const stageRatio = frame ? frame.clientWidth / frame.clientHeight : 9 / 16;
      let w = 0.6;
      let h = w * stageRatio * (info.height / info.width);
      if (h > 0.5) {
        w *= 0.5 / h;
        h = 0.5;
      }
      const id = newId();
      const spot = freeSpot();
      commit((p) =>
        appendEvent(p, {
          kind: 'CAST',
          id: newId(),
          at: 0,
          puppetId: id,
          puppet: {
            type: 'video',
            assetId,
            durationS: info.durationS,
            at: playheadRef.current,
            w,
            h,
          },
          x: spot.x,
          y: spot.y,
          scale: 1,
          rot: 0,
        }),
      );
      setSelectedId(id);
      setSheet(null);
      await reloadImages();
    } catch {
      banner.error("couldn't read that video");
    } finally {
      setCasting(false);
    }
  };

  /** A selfie as a kit: a body, and a head riding it at the neck. When it
   *  cannot be split, it is cast as an ordinary cutout, and says so. */
  const castKit = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCasting(true);
    setCastProgress(0);
    try {
      const kit = await makeKit(file, setCastProgress);
      if (!kit) {
        setCasting(false);
        setCastProgress(null);
        toast.show('no neck found, so it is one piece');
        return castPhotoFile(file);
      }
      const bodyId = await saveAsset(kit.body.blob, 'png');
      const headId = await saveAsset(kit.head.blob, 'png');
      const frame = frameRef.current;
      const stageRatio = frame ? frame.clientWidth / frame.clientHeight : 9 / 16;
      const w = 0.42;
      const bodyH = w * stageRatio * (kit.body.height / kit.body.width);
      const headH = w * stageRatio * (kit.head.height / kit.head.width);
      const spot = freeSpot();
      const body = newId();
      const head = newId();
      const bodyY = spot.y + headH / 2;
      const group = newId();
      // The head image is as wide as the body's and sits on its top edge,
      // overlapping a little so the seam hides as it nods; it rides there.
      const headY = bodyY - bodyH / 2 - headH / 2 + headH * 0.04;
      const anchor = { x: 0.5, y: (headY - (bodyY - bodyH / 2)) / bodyH };
      commit((p) =>
        appendEvent(
          appendEvent(p, {
            kind: 'CAST',
            id: newId(),
            at: 0,
            group,
            puppetId: body,
            puppet: { type: 'cutout', assetId: bodyId, w, h: bodyH, name: 'body' },
            x: spot.x,
            y: bodyY,
            scale: 1,
            rot: 0,
          }),
          {
            kind: 'CAST',
            id: newId(),
            at: 0,
            group,
            puppetId: head,
            puppet: { type: 'cutout', assetId: headId, w, h: headH, name: 'head' },
            x: spot.x,
            y: headY,
            scale: 1,
            rot: 0,
            attach: { to: body, ...anchor },
          },
        ),
      );
      setSelectedId(head);
      setSheet(null);
      await reloadImages();
      toast.show('a head on a body: drag the body and the head follows');
    } catch {
      banner.error("couldn't make a kit from that photo");
    } finally {
      setCasting(false);
      setCastProgress(null);
    }
  };

  const castPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (file) await castPhotoFile(file);
  };

  /** Takes the File itself: an input's FileList empties when the input is
   *  cleared, which happens before an async flow gets round to reading it. */
  const castPhotoFile = async (file: File) => {
    // The segmenter's first run downloads 11MB of wasm and a model. Saying
    // nothing for that long reads as a broken app (audit F7).
    setCasting(true);
    setCastProgress(0);
    try {
      const cutout = await makeCutout(file, setCastProgress);
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
      setSheet(null);
      coach('tools', 'tap a puppet to pick it up. its tools appear above it.');
      await reloadImages();
      if (cutout.fallback === 'no-person') toast.show('no person found, kept the whole photo');
      else if (cutout.fallback === 'no-model')
        toast.show('cutting out is unavailable, kept the whole photo');
    } catch {
      banner.error("couldn't read that photo");
    } finally {
      setCasting(false);
      setCastProgress(null);
    }
  };

  const onBackdropPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const assetId = await saveAsset(file, 'img');
      const id = newId();
      setSelectedId(id);
      setSheet(null);
      commit((p) =>
        appendEvent(p, {
          kind: 'CAST',
          id: newId(),
          at: 0,
          puppetId: id,
          puppet: { type: 'cutout', assetId, w: 1, h: 1, fit: 'cover' },
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
      banner.error(
        err instanceof NoSoundInFileError ? 'no sound in that file' : "couldn't read that file",
      );
    } finally {
      setCasting(false);
    }
  };

  /** strokeRef and inkRef are parallel and must stay that way: a stale ink
   *  entry would be written into strokeStyle, whose length has to match
   *  strokes or the recipe will not parse on the next load. */
  const resetDoodle = () => {
    strokeRef.current = [];
    inkRef.current = [];
    setStrokeCount(0);
    setErasing(false);
  };

  const undoStroke = () => {
    strokeRef.current.pop();
    inkRef.current.pop();
    setStrokeCount(strokeRef.current.length);
    dirtyRef.current = true;
  };

  const finishDoodle = (keep: boolean) => {
    const strokes = strokeRef.current;
    const inks = strokes.map(
      (_, i) => inkRef.current[i] ?? { color: DOODLE_COLORS[0]!.value, width: 1 },
    );
    resetDoodle();
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
    coach('tools', 'tap a puppet to pick it up. its tools appear above it.');
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: {
          type: 'doodle',
          strokes: normalized,
          // Every line the same bone at the default width is what a v0
          // doodle looks like, so it is recorded as no styling at all.
          ...(inks.some((k) => k.color !== DOODLE_COLORS[0]!.value || k.width !== 1)
            ? { strokeStyle: inks.map((k) => ({ ...k })) }
            : {}),
          w,
          h,
        },
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
        ...(p.depth !== 0 ? { depth: p.depth } : {}),
        ...(p.attach ? { attach: p.attach } : {}),
        ...patch,
      }),
    );
  };

  /** Rides another sheet from where it is now, or lets go. One CAST
   *  either way, so undo puts it back. */
  const ride = (p: ShowPuppet, parentId: string | null) => {
    const parent = parentId ? castOf(projectRef.current).find((x) => x.id === parentId) : undefined;
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
        ...(p.depth !== 0 ? { depth: p.depth } : {}),
        ...(parent ? { attach: { to: parent.id, ...anchorOn(parent, p.home.x, p.home.y) } } : {}),
      }),
    );
    if (parent) toast.show(`it rides ${puppetLabel(parent, castOf(projectRef.current).indexOf(parent))} now`);
  };

  const setSpec = (p: ShowPuppet, patch: Partial<PuppetSpec>) =>
    recastWith(p, { puppet: { ...p.spec, ...patch } as PuppetSpec });

  const setWire = (pid: string, from: string, to: string, patch: WirePatch) => {
    const unplugging = patch.amount === 0 && !!wireAt(wiresRef.current, pid, from, to);
    commit((p) =>
      appendEvent(p, { kind: 'WIRE', id: newId(), at: 0, puppetId: pid, from, to, ...patch }),
    );
    if (unplugging) toast.undoable('pulled that wire out', undoRef.current);
  };

  const wireLevel = (pid: string, from: string, to: string) =>
    wireAmount(effectiveWires(projectSnap), pid, from, to);

  /** A signal's value at the playhead, for the Wires room's meters. */
  const sampleSignal = useCallback((from: string): number => {
    const signal = parseSignal(from);
    if (!signal) return 0;
    if (isWorldSignal(signal)) return worldSignalAt(signal, lastPosesRef.current);
    return timeSignalAt(
      signal,
      {
        voice: voiceRef.current,
        onsets: onsetsRef.current,
        voices: voicesRef.current,
        bands: bandsRef.current,
        seed: projectRef.current.seed,
      },
      playheadRef.current,
    );
  }, []);

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
        ...(p.depth !== 0 ? { depth: p.depth } : {}),
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
    commit((p) => appendEvent(p, { kind: 'SOUND', id: newId(), at: clock, puppetId: '', sfx }));
  };

  const startRetake = (mode: 'replace' | 'extend') => {
    setSheet({ kind: 'retake', mode });
  };

  const confirmRetake = (mode: 'replace' | 'extend') => {
    retakeModeRef.current = mode;
    setSheet(null);
    setModeBoth('needsAudio');
  };

  /** Ready-made puppets, cycling so tapping twice gives two different
   *  ones rather than a picker nobody needs. */
  const stickerCountRef = useRef(0);
  const castSticker = () => {
    const spec = stickerSpec(stickerCountRef.current++);
    const id = newId();
    const spot = freeSpot();
    setSelectedId(id);
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: spec,
        x: spot.x,
        y: spot.y,
        scale: 1,
        rot: 0,
      }),
    );
    toast.show(`${STICKERS[(stickerCountRef.current - 1) % STICKERS.length]!.name} is on stage`);
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
    const next = undoStep({ events: projectRef.current.events, redo: redoRef.current });
    if (next.events.length === projectRef.current.events.length) return;
    redoRef.current = next.redo;
    setRedoCount(next.redo.length);
    applyProject((p) => ({ ...p, events: next.events }), false);
    void reloadImages();
    void reloadVoices();
  };

  undoRef.current = undo;

  const redo = () => {
    const next = redoStep({ events: projectRef.current.events, redo: redoRef.current });
    if (next.redo.length === redoRef.current.length) return;
    redoRef.current = next.redo;
    setRedoCount(next.redo.length);
    applyProject((p) => ({ ...p, events: next.events }), false);
    void reloadImages();
    void reloadVoices();
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
      setPoster(await posterFor(showId, projectRef.current, 160));
      setSheet({ kind: 'render' });
    } catch (err) {
      // Backing out is not a failure worth a banner.
      if (!(err instanceof RenderCancelled)) fail(err);
    } finally {
      renderAbortRef.current = null;
      setRendering(null);
      void wakeLock?.release().catch(() => {});
    }
  };

  // ---- lanes ----------------------------------------------------------
  const lanes: Lane[] = lanesOpen
    ? castOf(projectSnap)
        .map((p, i): Lane => ({
          puppetId: p.id,
          name: puppetLabel(p, i),
          mouthed: !!mouthOf(projectSnap, p.id),
          passes: lanePasses(projectSnap, p.id),
        }))
        .filter((l) => l.passes.length > 0)
        .concat(
          // The camera's passes get a lane of their own, on top, so a shot
          // can be muted, trimmed or taken out like any performance.
          lanePasses(projectSnap, CAMERA_ID).length > 0 || cutsOf(projectSnap).length > 0
            ? [
                {
                  puppetId: CAMERA_ID,
                  name: 'camera',
                  mouthed: false,
                  passes: lanePasses(projectSnap, CAMERA_ID),
                  cuts: cutsOf(projectSnap).map((c) => ({ id: c.id, at: c.at })),
                },
              ]
            : [],
        )
    : [];

  const mutePass = (passId: string, muted: boolean) =>
    commit((p) => appendEvent(p, { kind: 'MUTE', id: newId(), at: 0, puppetId: '', passId, muted }));

  const trimPass = (passId: string, from: number, to: number) =>
    commit((p) =>
      appendEvent(p, { kind: 'TRIM', id: newId(), at: 0, puppetId: '', passId, from, to }),
    );

  const deletePass = (passId: string) => {
    const owner = projectRef.current.events.find((e) => e.id === passId)?.puppetId ?? '';
    setSelectedPassId(null);
    commit((p) =>
      appendEvent(p, {
        kind: 'REMOVE',
        id: newId(),
        at: 0,
        puppetId: owner,
        target: { pass: passId },
      }),
    );
    toast.undoable('took that pass out', undoRef.current);
  };

  /** Trimming is metadata, not an event: it changes what plays and what
   *  renders, never what was performed. */
  const setTrim = (trim: SoundTrim | null) => {
    commit((p) => {
      if (!p.audio) return p;
      const audio = { assetId: p.audio.assetId, durationS: p.audio.durationS };
      return { ...p, audio: trim ? { ...audio, trim } : audio };
    });
    const from = trim?.from ?? 0;
    if (playheadRef.current < from) seek(from);
    const to = trim?.to ?? (projectRef.current.audio?.durationS ?? 0);
    if (playheadRef.current > to) seek(to);
  };

  const seek = (v: number) => {
    const audio = projectRef.current.audio;
    const clamped = Math.min(audio?.trim?.to ?? v, Math.max(audio?.trim?.from ?? 0, v));
    playheadRef.current = clamped;
    setT(clamped);
    paintClock(clamped);
  };

  const shotsRoom = useShots({
    open: sheet?.kind === 'shots',
    project: projectSnap,
    durationS,
    onsets,
    images: () => imagesRef.current,
    clock: () => playheadRef.current,
    commit,
    seek,
    undoable: (message) => toast.undoable(message, undoRef.current),
    name: (p) => puppetLabel(p, castOf(projectRef.current).indexOf(p)),
  });

  const passCount = projectSnap.events.filter((e) => e.kind === 'PASS').length;
  const puppets = castOf(projectSnap).filter((p) => !p.back);
  const busy = isBusy(mode);
  const rules = rulesFor(mode);

  const selected = selectedId ? castOf(projectSnap).find((p) => p.id === selectedId) : undefined;

  /** A mode the whole stage enters: it belongs to no puppet, so nothing
   *  stays selected under it. */
  const enterMode = (m: Mode) => {
    setSheet(null);
    setSelectedId(null);
    if (m === 'doodling') resetDoodle();
    setModeBoth(m);
    dirtyRef.current = true;
  };

  /** The camera in hand: the stage's fingers move the shot instead of the
   *  sheets while a take rolls. Nothing is selected under it, since a
   *  finger can only be doing one of the two. */
  const toggleCamera = (on: boolean) => {
    setCameraArmed(on);
    cameraArmedRef.current = on;
    if (on) {
      setSelectedId(null);
      banner.hint('drag to move the camera while you record. two fingers push in and roll.');
    } else {
      banner.clear();
    }
    dirtyRef.current = true;
  };

  /** Reading a clip: motion, masks and pose, once, with progress, kept as
   *  an asset the sheet points at. */
  const [readingId, setReadingId] = useState<string | null>(null);
  const [readProgress, setReadProgress] = useState(0);
  const readClip = async (p: ShowPuppet) => {
    if (p.spec.type !== 'video' || readingId) return;
    const spec = p.spec;
    setReadingId(p.id);
    setReadProgress(0);
    try {
      const blob = await getAsset(spec.assetId);
      // Without the models (offline, too old a phone) the read still finds
      // motion; masks and pose need them.
      const models = await mediapipeModels({ masks: true, pose: true }).catch(() => ({}));
      const tracks = await analyzeVideo(blob, spec.durationS, models, setReadProgress);
      const analysisId = await saveAsset(serializeTracks(tracks), 'vread');
      rememberTracks(analysisId, tracks);
      // The sheet as it is now: it may have moved while the clip was read.
      const now = castOf(projectRef.current).find((x) => x.id === p.id);
      if (now) setSpec(now, { analysisId } as Partial<PuppetSpec>);
      toast.show(tracks.masks ? 'read: it can show just the person now' : 'read: its motion can drive wires');
    } catch {
      banner.error("couldn't read that clip");
    } finally {
      setReadingId(null);
    }
  };

  /** A joint of the clip's person leads another sheet: an ordinary pass,
   *  made from the pose track, in stage coordinates. */
  const leadWith = (p: ShowPuppet, joint: Joint, targetId: string) => {
    if (p.spec.type !== 'video') return;
    const tracks = tracksOf(p.spec);
    if (!tracks) return;
    const samples = poseToSamples(p.spec, tracks, joint, {
      x: p.home.x,
      y: p.home.y,
      w: p.spec.w * p.home.scale,
      h: p.spec.h * p.home.scale,
      rot: p.home.rot,
    });
    if (samples.length < 6) {
      toast.show('the clip never shows that clearly enough');
      return;
    }
    commit((proj) =>
      appendEvent(proj, {
        kind: 'PASS',
        id: newId(),
        at: samples[0]!,
        puppetId: targetId,
        samples,
        via: 'video',
      }),
    );
    toast.undoable('it follows the clip now', undoRef.current);
  };

  /** An ink kept from the tray: dressing a sheet, or a sheet of its own. */
  const keepInk = (genome: Genome, as: KeepAs, target: string | null) => {
    if (as === 'dress' && target) {
      commit((p) => appendEvent(p, { kind: 'INK', id: newId(), at: 0, puppetId: target, genome }));
      setSelectedId(target);
      return;
    }
    const id = newId();
    const back = as === 'backdrop';
    // Square on screen whatever the stage's shape.
    const wide = (projectRef.current.aspect ?? '9:16') === '16:9';
    const w = back ? 1 : wide ? 0.28 : 0.5;
    const h = back ? 1 : wide ? 0.5 : 0.28;
    const spot = back ? { x: 0.5, y: 0.5 } : freeSpot();
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: id,
        puppet: { type: 'ink', genome, w, h },
        x: spot.x,
        y: spot.y,
        scale: 1,
        rot: 0,
        ...(back ? { back: true as const } : {}),
      }),
    );
    setSelectedId(id);
  };

  /** A cut back to the wide shot, on the beat when one is about to land:
   *  a cut a hair before the beat reads as late. */
  const dropCut = () => {
    const clock = Math.max(0, currentClock());
    const beat = onsetsRef.current.find((o) => o >= clock && o - clock <= 0.3);
    commit((p) =>
      appendEvent(p, {
        kind: 'CUT',
        id: newId(),
        at: beat ?? clock,
        puppetId: CAMERA_ID,
        ...REST_CAMERA,
      }),
    );
    vibrate(15);
  };

  // Tilt: while it is on and a camera take rolls, tipping the phone pans.
  const tiltable = tiltSupported();
  const [tilting, setTilting] = useState(false);
  const tiltStopRef = useRef<(() => void) | null>(null);
  /** Where the camera would be with the phone level, for this take. */
  const tiltBaseRef = useRef<{ x: number; y: number } | null>(null);
  const toggleTilt = async (on: boolean) => {
    if (on && !(await askTilt())) {
      banner.hint('this phone will not share its tilt.');
      return;
    }
    tiltStopRef.current?.();
    tiltStopRef.current = null;
    const held = grabsRef.current.get(TILT_KEY);
    if (held) {
      grabsRef.current.delete(TILT_KEY);
      commitOneGrab(held);
    }
    setTilting(on);
    if (!on) return;
    tiltStopRef.current = watchTilt((dx, dy) => {
      if (modeRef.current !== 'recording' || !cameraArmedRef.current) return;
      const clock = Math.max(0, currentClock());
      let grab = grabsRef.current.get(TILT_KEY);
      if (!grab) {
        const cam = lastCameraRef.current ?? REST_CAMERA;
        tiltBaseRef.current = { x: cam.x - dx, y: cam.y - dy };
        grab = {
          puppetId: CAMERA_ID,
          channel: null,
          samples: [clock, cam.x, cam.y],
          x: cam.x,
          y: cam.y,
          depth: 0,
          via: 'gyro',
        };
        grabsRef.current.set(TILT_KEY, grab);
      }
      const base = tiltBaseRef.current!;
      grab.x = base.x + dx;
      grab.y = base.y + dy;
      const lastT = grab.samples[grab.samples.length - 3]!;
      if (clock - lastT >= 1 / 60) grab.samples.push(clock, grab.x, grab.y);
    });
  };
  useEffect(() => () => tiltStopRef.current?.(), []);

  /** A tool the selected puppet is holding. The selection has to survive:
   *  the tool acts on it, and the halo it came from belongs to it. */
  const enterTool = (m: Mode) => {
    setSheet(null);
    setModeBoth(m);
    dirtyRef.current = true;
  };

  /** The panel says whose lines are being recorded. */
  const voiceForName = (() => {
    const target = voiceTargetRef.current;
    if (!target) return null;
    const cast = castOf(projectSnap);
    const i = cast.findIndex((p) => p.id === target.puppetId);
    return i < 0 ? null : puppetLabel(cast[i]!, i);
  })();

  seekRef2.current = seek;
  finishDoodleRef.current = finishDoodle;
  sheetRef.current = sheet;

  /** Absent means the tall stage every bit has had so far. */
  const aspect = projectSnap.aspect ?? '9:16';

  const placing = isPlacing(mode) && mode !== 'doodling';

  // Every live feature of the selected puppet is something to take hold
  // of. The frame loop puts them where the puppet is, frame by frame.
  const handles: HandleSpec[] = [];
  if (selected && mode === 'idle') {
    if (mouthOf(projectSnap, selected.id)) handles.push({ key: 'mouth', kind: 'mouth' });
    if (eyesOf(projectSnap, selected.id)) handles.push({ key: 'eyes', kind: 'eyes' });
    pinsOf(projectSnap, selected.id).forEach((pin, i) => {
      if (pin) handles.push({ key: `pin:${i}`, kind: 'pin', index: i });
    });
  }
  /** The halo and the handles are positioned by the frame loop, which only
   *  runs a layout when something has dirtied the canvas. A selection that
   *  arrives any other way — a sheet closing, a cast landing, undo — would
   *  otherwise leave the bar sitting at the stage's top-left corner, over
   *  the title strip, until the next redraw. Placing it before paint also
   *  removes the one-frame flash on every selection. */
  useLayoutEffect(() => {
    layoutOverlays();
    // Only when the overlays themselves change: which puppet is selected,
    // which handles exist, whether they are on screen at all, and how big
    // the stage is. A puppet moved by a sheet goes through commit, which
    // dirties the canvas, and the frame loop lays out on the next frame.
  }, [selectedId, mode, performing, lanesOpen, handles.length, aspect, layoutOverlays]);

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

  /** The picker kinds that hand off to the system file sheet leave this
   *  one open behind them, so the cutting-out progress has somewhere to
   *  live and a cancelled picker leaves you where you were. */
  const castPick = (kind: CastKind) => {
    if (kind === 'photo') return photoInputRef.current?.click();
    if (kind === 'selfie') return snapInputRef.current?.click();
    if (kind === 'kit') return kitInputRef.current?.click();
    if (kind === 'backdrop') return backdropInputRef.current?.click();
    if (kind === 'ink') return setSheet({ kind: 'ink', target: null });
    if (kind === 'video') return videoInputRef.current?.click();
    setSheet(null);
    if (kind === 'sticker') return castSticker();
    if (kind === 'doodle') return enterMode('doodling');
    if (kind === 'word') {
      setTextDraft('');
      setSheet({ kind: 'text' });
    }
  };

  return (
    <div className={`showstage${performing ? ' performing' : ''}`}>
      <div className="stagearea">
        <div
          ref={frameRef}
          className={`stagebox mode-${mode}`}
          style={
            aspect === '16:9'
              ? ({ '--aspect-w': 16, '--aspect-h': 9 } as CSSProperties)
              : undefined
          }
        >
          {/* The stage is a picture that changes; its state is spoken by
              the banner, the clock and the lanes rather than by the pixels. */}
          <canvas
            key={canvasKey}
            ref={canvasRef}
            role="img"
            aria-label={
              puppets.length === 0
                ? 'an empty stage'
                : `the stage, with ${puppets.length} puppet${puppets.length === 1 ? '' : 's'}`
            }
          />
          <canvas ref={overlayRef} className="stage-overlay" aria-hidden="true" />
          {!performing && (
          <TitleBar
            title={projectSnap.title}
            onRename={(title) =>
              commit((p) => ({ ...p, title, updatedAt: new Date().toISOString() }))
            }
            onBack={onBack}
            onMenu={() => setSheet({ kind: 'show' })}
            extra={
              // In the strip, where no halo, banner or sheet ever sits on it.
              (mode === 'idle' || mode === 'recording') && puppets.length > 0 && durationS > 0 ? (
                <IconButton
                  icon="camera"
                  label={cameraArmed ? 'put the camera down' : 'pick up the camera'}
                  aria-pressed={cameraArmed}
                  className={`stage-camera${cameraArmed ? ' on' : ''}`}
                  onClick={() => toggleCamera(!cameraArmed)}
                />
              ) : null
            }
          />
          )}
          <BannerView />
          {selected && mode === 'idle' && !busy && !performing && (
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
              {casting && <ProgressRing value={castProgress} label="cutting out" />}
            </div>
          )}
          {mode === 'micLive' && (
            <RecordPanel
              mode={retakeMode}
              voiceFor={voiceForName}
              capS={probe.overrides.maxRecordSeconds ?? MAX_RECORD_S}
              meterRef={meterRef}
              meterFillRef={meterFillRef}
              elapsedRef={elapsedRef}
              onDone={() => void stopBit()}
              onCancel={cancelBit}
            />
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
          {curtain && (
            <div className="curtain">
              <span className="curtain-left" aria-hidden="true" />
              <span className="curtain-right" aria-hidden="true" />
              <p className="curtain-text">now everyone at once</p>
            </div>
          )}
          {performing && (
            <div className="perform-controls" onPointerDown={(e) => e.stopPropagation()}>
              {busy ? (
                <button className="dock-rec dock-stop on-accent" aria-label="stop" onClick={stop}>
                  <span className="dock-glyph" aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="dock-rec on-accent"
                  aria-label="record a pass"
                  disabled={puppets.length === 0 || durationS <= 0}
                  onClick={() => void start(true)}
                >
                  <span className="dock-glyph" aria-hidden="true" />
                </button>
              )}
              <button className="pill" onClick={() => setPerforming(false)}>
                done performing
              </button>
            </div>
          )}
          {mode === 'recording' && <span className="recdot">●</span>}
          {sideView && (mode === 'idle' || mode === 'recording') && !performing && (
            <DirectorView
              cast={castOf(projectSnap)}
              selectedId={selectedId}
              name={(p) => puppetLabel(p, castOf(projectSnap).indexOf(p))}
              onDepth={(p, depth) => recastWith(p, { depth })}
              onClose={() => setSideView(false)}
            />
          )}
          {mode === 'recording' && cameraArmed && (
            <div className="camera-tools" onPointerDown={(e) => e.stopPropagation()}>
              <button className="pill" onClick={dropCut}>
                cut
              </button>
              {tiltable && (
                <button
                  className={`pill${tilting ? ' on' : ''}`}
                  aria-pressed={tilting}
                  onClick={() => void toggleTilt(!tilting)}
                >
                  tilt
                </button>
              )}
            </div>
          )}
          {counting && <div className="stage-hintline">🥁 count-in…</div>}

          <video ref={pipVideoRef} className="pip" muted playsInline hidden={!bodyActive} />

          {placing && (
            <div className="stagepills">
              <button className="pill" onClick={() => setModeBoth('idle')}>
                cancel
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

      {lanesOpen && mode !== 'doodling' && mode !== 'micLive' && mode !== 'needsAudio' && (
        <Lanes
          lanes={lanes}
          durationS={durationS}
          selectedPassId={selectedPassId}
          soloPuppetId={soloId}
          loop={loop}
          playheadRef={lanesPlayheadRef}
          onSelectPass={setSelectedPassId}
          onMute={mutePass}
          onDelete={deletePass}
          onTrim={trimPass}
          onSolo={setSoloId}
          onLoop={setLoop}
          onRemoveCut={(cutId) => {
            commit((p) =>
              appendEvent(p, {
                kind: 'REMOVE',
                id: newId(),
                at: 0,
                puppetId: CAMERA_ID,
                target: { cut: cutId },
              }),
            );
            toast.undoable('took that cut out', undoRef.current);
          }}
        />
      )}

      {mode === 'doodling' && (
        <DoodleBar
          ink={ink}
          erasing={erasing}
          strokeCount={strokeCount}
          onInk={setInk}
          onErasing={setErasing}
          onCancel={() => finishDoodle(false)}
          onKeep={() => finishDoodle(true)}
        />
      )}

      {mode !== 'needsAudio' && mode !== 'micLive' && mode !== 'loading' && (
        <>
          {mode !== 'doodling' && (
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
              trim={projectSnap.audio?.trim ?? null}
              lanesOpen={lanesOpen}
              passCount={passCount}
              onLanes={() => {
                setLanesOpen((open) => !open);
                setSelectedPassId(null);
                setSoloId(null);
              }}
            />
          )}
          <Dock
            busy={busy}
            canRecord={rules.canRecord && puppets.length > 0 && !counting}
            canPlay={rules.canPlay && durationS > 0 && !counting}
            canUndo={mode === 'doodling' ? strokeCount > 0 : projectSnap.events.length > 0}
            canRedo={mode === 'doodling' ? false : redoCount > 0}
            toolsOpen={sheet?.kind === 'cast'}
            onRecord={() => void start(true)}
            onPlay={() => void start(false)}
            onStop={stop}
            onUndo={mode === 'doodling' ? undoStroke : undo}
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
          modelProgress={castProgress}
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
          hand={handOf(selected.id)}
          voiceS={voiceOf(projectSnap, selected.id)?.durationS ?? null}
          onVoice={() => recordVoice(selected)}
          onDropVoice={() => {
            commit((p) =>
              appendEvent(p, {
                kind: 'REMOVE',
                id: newId(),
                at: 0,
                puppetId: selected.id,
                target: { voice: true },
              }),
            );
            void reloadVoices();
            toast.undoable('back to the bit', undoRef.current);
          }}
          onRename={(name) => setSpec(selected, { name })}
          onWires={() => setSheet({ kind: 'wires', pid: selected.id })}
          onScale={(scale) => recastWith(selected, { scale })}
          onDepth={(depth) => recastWith(selected, { depth })}
          onSideView={() => {
            setSheet(null);
            setSideView(true);
          }}
          onInk={() => setSheet({ kind: 'ink', target: selected.id })}
          inked={!!inkOf(projectSnap, selected.id)}
          riding={
            selected.attach
              ? puppetLabel(
                  castOf(projectSnap).find((p) => p.id === selected.attach!.to) ?? selected,
                  castOf(projectSnap).findIndex((p) => p.id === selected.attach!.to),
                )
              : null
          }
          rideable={castOf(projectSnap)
            .filter((p) => p.id !== selected.id && !p.back && !ridesOn(projectSnap, p.id, selected.id))
            .map((p) => ({ id: p.id, name: puppetLabel(p, castOf(projectSnap).indexOf(p)) }))}
          onRide={(parentId) => ride(selected, parentId)}
          cuts={splitPieces(snipsOf(projectSnap, selected.id)).children.map((c) => ({
            snip: c.snipIndex,
            angle: foldsOf(projectSnap, selected.id)[c.snipIndex] ?? null,
          }))}
          onFold={(snip, angle) =>
            commit((p) =>
              appendEvent(p, { kind: 'FOLD', id: newId(), at: 0, puppetId: selected.id, snip, angle }),
            )
          }
          {...(selected.spec.type === 'video'
            ? {
                clip: {
                  read: !!selected.spec.analysisId,
                  reading: readingId === selected.id ? readProgress : null,
                  masked: selected.spec.masked === true,
                  hasPose: !!(tracksOf(selected.spec)?.pose),
                  others: castOf(projectSnap)
                    .filter((p) => p.id !== selected.id && !p.back)
                    .map((p) => ({ id: p.id, name: puppetLabel(p, castOf(projectSnap).indexOf(p)) })),
                },
                onRead: () => void readClip(selected),
                onMasked: (masked: boolean) => setSpec(selected, { masked } as Partial<PuppetSpec>),
                onLead: (joint: Joint, targetId: string) => leadWith(selected, joint, targetId),
              }
            : {})}
          onInkOff={() => {
            commit((p) =>
              appendEvent(p, { kind: 'INK', id: newId(), at: 0, puppetId: selected.id, genome: null }),
            );
            toast.undoable('took the ink off', undoRef.current);
          }}
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

      {sheet?.kind === 'ink' && (
        <Tray
          target={
            sheet.target
              ? {
                  name: puppetLabel(
                    castOf(projectSnap).find((p) => p.id === sheet.target) ?? castOf(projectSnap)[0]!,
                    castOf(projectSnap).findIndex((p) => p.id === sheet.target),
                  ),
                }
              : null
          }
          start={sheet.target ? inkOf(projectSnap, sheet.target) : null}
          onKeep={(genome, as) => {
            setSheet(null);
            keepInk(genome, as, sheet.target);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'shots' && <ShotsRoom {...shotsRoom} onClose={() => setSheet(null)} />}

      {sheet?.kind === 'wires' && (
        <WiresRoom
          pid={sheet.pid}
          title={
            sheet.pid === ''
              ? 'the stage'
              : puppetLabel(
                  castOf(projectSnap).find((p) => p.id === sheet.pid) ?? castOf(projectSnap)[0]!,
                  castOf(projectSnap).findIndex((p) => p.id === sheet.pid),
                )
          }
          signals={
            sheet.pid === ''
              ? [...COMMON_SIGNALS, ...clipSignals(projectSnap)]
              : [
                  ...clipSignals(projectSnap),
                  ...COMMON_SIGNALS,
                  ...(voiceOf(projectSnap, sheet.pid)
                    ? [{ id: `voice:${sheet.pid}`, label: 'its own voice' }]
                    : []),
                  { id: `sheet:${sheet.pid}.speed`, label: 'its speed' },
                ]
          }
          wireAt={(from, to) => wireAt(effectiveWires(projectSnap), sheet.pid, from, to)}
          sample={sampleSignal}
          onSet={(from, to, patch) => setWire(sheet.pid, from, to, patch)}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'render' && rendered && (
        <RenderSheet
          file={rendered}
          poster={poster}
          durationS={
            (projectSnap.audio?.trim?.to ?? durationS) - (projectSnap.audio?.trim?.from ?? 0)
          }
          onShare={() => void shareOrDownload(rendered)}
          onAgain={() => {
            setRendered(null);
            setSheet(null);
            void doRender();
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'sound' && durationS > 0 && (
        <SoundSheet
          durationS={durationS}
          peaks={peaks}
          trim={projectSnap.audio?.trim ?? null}
          source={projectSnap.sound?.name ?? (projectSnap.sound?.source === 'file' ? 'a file' : 'the mic')}
          onTrim={setTrim}
          onRetake={(m) => startRetake(m)}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'show' && (
        <ShowMenu
          passCount={passCount}
          castCount={puppets.length}
          canRender={passCount > 0 && !rendering}
          rendered={!!rendered}
          trails={wireLevel('', 'const', 'trails')}
          foley={wireLevel('', 'const', 'foley')}
          corpse={corpse}
          aspect={aspect}
          onAspect={(next) =>
            commit((p) => ({ ...p, aspect: next, updatedAt: new Date().toISOString() }))
          }
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
          canPerform={puppets.length > 0 && durationS > 0}
          onPerform={() => {
            setSheet(null);
            setSelectedId(null);
            setLanesOpen(false);
            setPerforming(true);
          }}
          onSound={() => setSheet({ kind: 'sound' })}
          onStageWire={(target, amount) => setWire('', 'const', target, { amount })}
          onStageWires={() => setSheet({ kind: 'wires', pid: '' })}
          onShots={() => setSheet({ kind: 'shots' })}
          shadow={lookOf(projectSnap)?.shadow ?? 0}
          fog={lookOf(projectSnap)?.fog ?? 0}
          palette={lookOf(projectSnap)?.palette ?? null}
          paper={lookOf(projectSnap)?.paper ?? null}
          onLook={(patch) =>
            commit((p) => appendEvent(p, { kind: 'LOOK', id: newId(), at: 0, puppetId: '', ...patch }))
          }
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
        data-pick="backdrop"
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void onBackdropPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={kitInputRef}
        data-pick="kit"
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => {
          void castKit(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        data-pick="video"
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          void castVideo(e.target.files);
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

/** The video sheets on stage, as specs. castOf is memoised per event
 *  list, so this is a short filter per frame. */
function videoSpecsOf(project: Project): PuppetSpec[] {
  return castOf(project)
    .map((p) => p.spec)
    .filter((spec) => spec.type === 'video');
}

/** The signals a read clip offers, for the Wires room. */
function clipSignals(project: Project): { id: string; label: string }[] {
  const cast = castOf(project);
  return cast.flatMap((p, i) => {
    if (p.spec.type !== 'video' || !p.spec.analysisId) return [];
    const name = puppetLabel(p, i);
    return [
      { id: `video:${p.id}.motion`, label: `${name} moving` },
      { id: `video:${p.id}.flowx`, label: `${name} drifting sideways` },
      { id: `video:${p.id}.flowy`, label: `${name} drifting up and down` },
    ];
  });
}

/** True when `id` rides `on`, however far up the chain: offering it as
 *  a mount would make a circle, which the recipe refuses. */
function ridesOn(project: Project, id: string, on: string): boolean {
  const byId = new Map(castOf(project).map((p) => [p.id, p]));
  const seen = new Set<string>();
  let at = byId.get(id)?.attach?.to;
  while (at && !seen.has(at)) {
    if (at === on) return true;
    seen.add(at);
    at = byId.get(at)?.attach?.to;
  }
  return false;
}
