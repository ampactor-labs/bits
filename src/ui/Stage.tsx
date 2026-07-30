// The stage, whole instrument: record the bit, cast puppets (photo, snap,
// doodle, backdrop), snip them apart, pin mouths and googly eyes, then
// perform in passes from any point on the playhead. Grab a body or a
// snipped-off piece; hold the talker and its mouth speaks. Two fingers
// resize and rotate while idle; long-press drops from the cast.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendEvent,
  createProject,
  parseProject,
  serializeProject,
  type CastEvent,
  type PassEvent,
  type Project,
  type RecipeEvent,
} from '../engine/recipe';
import { detectOnsets } from '../engine/onsets';
import { computeVoiceTrack, EMPTY_VOICE, type VoiceTrack } from '../engine/envelope';
import { pointInPoly } from '../engine/pieces';
import {
  castOf,
  createShowSim,
  sameChannel,
  type Channel,
  type PuppetPose,
  type ShowPuppet,
  type ShowSim,
} from '../engine/show';
import { AudioSourceHandle, JamAudio, mixdownMono } from '../media/audio';
import { getAsset, saveAsset } from '../media/assets';
import { exportBundle } from '../media/bundle';
import { makeCutout } from '../media/cutout';
import { MicRecorder } from '../media/mic';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { PoseDriver } from '../media/pose';
import { voiceMap, renderShow, visualsOf, type RenderProgress } from '../media/render';
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
  | 'pinning'
  | 'bodyAssign';

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
  pinch: { baseDist: number; baseAngle: number; baseScale: number; baseRot: number } | null;
}

const newId = () => crypto.randomUUID().slice(0, 8);
const LONG_PRESS_MS = 650;
const HOLD_SAMPLE_S = 0.25;

export function Stage({ showId }: { showId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const [projectSnap, setProjectSnap] = useState<Project>(() => createProject('untitled bit'));
  const projectRef = useRef(projectSnap);
  const [mode, setMode] = useState<Mode>('loading');
  const modeRef = useRef<Mode>('loading');
  const [t, setT] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<File | null>(null);
  const [onsets, setOnsets] = useState<number[]>([]);
  const [redoCount, setRedoCount] = useState(0);
  const [kitOpen, setKitOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const audioBlobRef = useRef<Blob | null>(null);
  const voiceRef = useRef<VoiceTrack>(EMPTY_VOICE);
  const jamRef = useRef<JamAudio | null>(null);
  const micRef = useRef<MicRecorder | null>(null);
  const imagesRef = useRef<StageImages>(new Map());
  const visualsRef = useRef<Map<string, PuppetVisual>>(new Map());
  const simRef = useRef<ShowSim | null>(null);
  const lastPosesRef = useRef<Map<string, PuppetPose>>(new Map());
  const grabRef = useRef<Grab | null>(null);
  const bodyGrabsRef = useRef<Grab[]>([]);
  const bodyMapRef = useRef<BodyMap>({ right: null, left: null });
  const poseDriverRef = useRef<PoseDriver | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const [bodyActive, setBodyActive] = useState(false);
  const [bodyHint, setBodyHint] = useState('');
  const stagingRef = useRef<StagingDrag | null>(null);
  const strokeRef = useRef<number[][]>([]);
  const snipStrokeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redoRef = useRef<RecipeEvent[]>([]);
  const playheadRef = useRef(0);
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
          projectRef.current = createProject('untitled bit');
        }
      }
      visualsRef.current = visualsOf(projectRef.current);
      setProjectSnap(projectRef.current);
      if (projectRef.current.audio) {
        audioBlobRef.current = await getAsset(projectRef.current.audio.assetId);
        if (cancelled) return;
        const handle = await AudioSourceHandle.open(audioBlobRef.current);
        if (handle) jamRef.current = new JamAudio(handle.makeSink());
        await analyzeAudio(audioBlobRef.current);
      }
      await reloadImages();
      if (!cancelled) setModeBoth(projectRef.current.audio ? 'idle' : 'needsAudio');
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
  }, [showId, reloadImages, analyzeAudio]);

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

  const start = (recording: boolean) => {
    const dur = projectRef.current.audio?.durationS ?? 0;
    if (dur <= 0) return;
    setRendered(null);
    let from = playheadRef.current;
    if (from >= dur - 0.05) from = 0;
    playheadRef.current = from;

    const sim = createShowSim(projectRef.current, 0, (id, channel, tt) => {
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
        setT(clock);

        const grab = grabRef.current;
        if (m === 'recording' && grab) {
          const lastT = grab.samples[grab.samples.length - 3]!;
          if (clock - lastT >= HOLD_SAMPLE_S) grab.samples.push(clock, grab.x, grab.y);
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
          drawStage(
            ctx,
            W,
            H,
            castOf(project),
            poses,
            imagesRef.current,
            visualsRef.current,
            voiceMap(project, visualsRef.current, voiceRef.current, clock),
            clock,
            project.seed,
          );
        }
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
        );
        // Pin rings, visible while staging and pinning.
        for (const p of cast) {
          const pose = poses.get(p.id);
          const visual = visualsRef.current.get(p.id);
          if (!pose || !visual || visual.pins.length === 0) continue;
          ctx.strokeStyle = '#58a6ff';
          ctx.lineWidth = 2;
          for (const pin of pose.pins) {
            ctx.beginPath();
            ctx.arc(pin.x * W, pin.y * H, Math.max(6, W * 0.012), 0, Math.PI * 2);
            ctx.stroke();
          }
        }
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
  }, [stop, currentClock]);

  // Pointer handling.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const pointers = new Map<number, { x: number; y: number }>();

    // Soft bounds well past the frame: puppets enter and exit through the
    // wings, and a drag that wanders offstage still comes back.
    const norm = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      return {
        x: Math.min(1.75, Math.max(-0.75, (e.clientX - r.left) / r.width)),
        y: Math.min(1.75, Math.max(-0.75, (e.clientY - r.top) / r.height)),
      };
    };

    const toLocal = (p: ShowPuppet, x: number, y: number) => {
      const pose = lastPosesRef.current.get(p.id);
      const s = pose?.root ?? { x: p.home.x, y: p.home.y };
      const c = Math.cos(-p.home.rot);
      const sn = Math.sin(-p.home.rot);
      const dx = x - s.x;
      const dy = y - s.y;
      return {
        x: (dx * c - dy * sn) / (p.spec.w * p.home.scale) + 0.5,
        y: (dx * sn + dy * c) / (p.spec.h * p.home.scale) + 0.5,
      };
    };

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

    const clearLongPress = () => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    };

    const placeFeature = (kind: 'MOUTH' | 'EYES', x: number, y: number) => {
      const hit = hitTest(x, y);
      if (!hit) return;
      const local = toLocal(hit.puppet, x, y);
      const lx = Math.min(1, Math.max(0, local.x));
      const ly = Math.min(1, Math.max(0, local.y));
      commit((p) =>
        appendEvent(
          p,
          kind === 'MOUTH'
            ? { kind, id: newId(), at: 0, puppetId: hit.puppet.id, mx: lx, my: ly, size: 0.24 }
            : { kind, id: newId(), at: 0, puppetId: hit.puppet.id, ex: lx, ey: ly, size: 0.3 },
        ),
      );
      vibrate(15);
      setModeBoth('idle');
    };

    const down = (e: PointerEvent) => {
      frame.setPointerCapture(e.pointerId);
      const { x, y } = norm(e);
      pointers.set(e.pointerId, { x, y });
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
        const hit = hitTest(x, y);
        if (hit) {
          const visual = visualsRef.current.get(hit.puppet.id);
          const pinnable =
            hit.puppet.spec.type === 'cutout' && (visual?.pieces.children.length ?? 0) === 0;
          if (pinnable) {
            const local = toLocal(hit.puppet, x, y);
            commit((p) =>
              appendEvent(p, {
                kind: 'PIN',
                id: newId(),
                at: 0,
                puppetId: hit.puppet.id,
                px: Math.min(1, Math.max(0, local.x)),
                py: Math.min(1, Math.max(0, local.y)),
              }),
            );
            vibrate(15);
          } else {
            vibrate(40);
          }
          setModeBoth('idle');
        }
        return;
      }
      if (m === 'bodyAssign') {
        const hit = hitTest(x, y);
        if (hit) {
          const map = bodyMapRef.current;
          if (!map.right) {
            map.right = { puppetId: hit.puppet.id, channel: hit.channel };
            setBodyHint('tap another for your LEFT hand, or start');
          } else if (!map.left) {
            map.left = { puppetId: hit.puppet.id, channel: hit.channel };
            setBodyHint('both hands assigned; start when ready');
          }
          vibrate(15);
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
        const hit = hitTest(x, y);
        if (hit) {
          stagingRef.current = {
            puppetId: hit.puppet.id,
            x: hit.puppet.home.x,
            y: hit.puppet.home.y,
            scale: hit.puppet.home.scale,
            rot: hit.puppet.home.rot,
            pinch: null,
          };
          dirtyRef.current = true;
          clearLongPress();
          longPressRef.current = setTimeout(() => {
            stagingRef.current = null;
            commit((p) =>
              appendEvent(p, { kind: 'DROP', id: newId(), at: 0, puppetId: hit.puppet.id }),
            );
            vibrate(40);
          }, LONG_PRESS_MS);
        }
      }
    };

    const move = (e: PointerEvent) => {
      const pt = pointers.get(e.pointerId);
      if (!pt) return;
      const { x, y } = norm(e);
      const movedFar = Math.hypot(x - pt.x, y - pt.y) > 0.015;
      pt.x = x;
      pt.y = y;
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
        } else if (pointers.size === 1) {
          staging.x = x;
          staging.y = y;
        }
        dirtyRef.current = true;
      }
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearLongPress();
      const m = modeRef.current;

      if (m === 'snipping' && snipStrokeRef.current && pointers.size === 0) {
        const s = snipStrokeRef.current;
        snipStrokeRef.current = null;
        const midX = (s.x0 + s.x1) / 2;
        const midY = (s.y0 + s.y1) / 2;
        const lineLen = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
        const hit = hitTest(midX, midY);
        if (hit && lineLen > 0.03) {
          const a = toLocal(hit.puppet, s.x0, s.y0);
          const b = toLocal(hit.puppet, s.x1, s.y1);
          commit((p) =>
            appendEvent(p, {
              kind: 'SNIP',
              id: newId(),
              at: 0,
              puppetId: hit.puppet.id,
              x0: a.x,
              y0: a.y,
              x1: b.x,
              y1: b.y,
            }),
          );
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
      if (m === 'idle' && stagingRef.current && pointers.size === 0) {
        const staging = stagingRef.current;
        stagingRef.current = null;
        const existing = castOf(projectRef.current).find((p) => p.id === staging.puppetId);
        if (existing) {
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
          };
          commit((p) => appendEvent(p, recast));
        }
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
    const blob = await mic.stop();
    micRef.current = null;
    const assetId = await saveAsset(blob, 'webm');
    const handle = await AudioSourceHandle.open(blob);
    if (!handle) {
      setError('could not read the recording; try again');
      setModeBoth('needsAudio');
      return;
    }
    const durationRecorded = await handle.duration();
    audioBlobRef.current = blob;
    jamRef.current?.dispose();
    jamRef.current = new JamAudio(handle.makeSink());
    await analyzeAudio(blob);
    commit((p) => ({ ...p, audio: { assetId, durationS: durationRecorded } }));
    playheadRef.current = 0;
    setT(0);
    setModeBoth('idle');
  };

  // Casting.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const snapInputRef = useRef<HTMLInputElement>(null);
  const backdropInputRef = useRef<HTMLInputElement>(null);

  const castPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const cutout = await makeCutout(file);
    const assetId = await saveAsset(cutout.blob, 'png');
    const frame = frameRef.current;
    const stageRatio = frame ? frame.clientWidth / frame.clientHeight : 9 / 16;
    const w = 0.38;
    const h = w * stageRatio * (cutout.height / cutout.width);
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: newId(),
        puppet: { type: 'cutout', assetId, w, h },
        x: 0.5,
        y: 0.55,
        scale: 1,
        rot: 0,
      }),
    );
    await reloadImages();
  };

  const onBackdropPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const assetId = await saveAsset(file, 'img');
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: newId(),
        puppet: { type: 'cutout', assetId, w: 1, h: 1 },
        x: 0.5,
        y: 0.5,
        scale: 1,
        rot: 0,
        back: true,
      }),
    );
    await reloadImages();
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
    commit((p) =>
      appendEvent(p, {
        kind: 'CAST',
        id: newId(),
        at: 0,
        puppetId: newId(),
        puppet: { type: 'doodle', strokes: normalized, w, h },
        x: minX + w / 2,
        y: minY + h / 2,
        scale: 1,
        rot: 0,
      }),
    );
  };

  /** Rail actions: rail order is draw order, back to front. */
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
        ...patch,
      }),
    );
  };

  const bringForward = (p: ShowPuppet) => recastWith(p, {});

  const sendToBack = (p: ShowPuppet) => {
    // Re-cast everyone else in their current order; the target stays put and
    // ends up drawn first among the non-backdrops.
    const others = castOf(projectRef.current).filter((o) => !o.back && o.id !== p.id);
    for (const o of others) recastWith(o, {});
  };

  const centerOnStage = (p: ShowPuppet) => recastWith(p, { x: 0.5, y: 0.55 });

  const dropPuppet = (p: ShowPuppet) => {
    setSelectedId(null);
    commit((proj) => appendEvent(proj, { kind: 'DROP', id: newId(), at: 0, puppetId: p.id }));
  };


  const startBodyPass = async () => {
    if (!bodyMapRef.current.right && !bodyMapRef.current.left) return;
    const video = pipVideoRef.current;
    if (!video) return;
    try {
      poseDriverRef.current = await PoseDriver.create(video);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModeBoth('idle');
      return;
    }
    setBodyActive(true);
    start(true);
  };

  const exportBit = async () => {
    try {
      await shareOrDownload(await exportBundle(projectRef.current));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const undo = () => {
    const events = projectRef.current.events;
    if (events.length === 0) return;
    const popped = events[events.length - 1]!;
    redoRef.current.push(popped);
    setRedoCount(redoRef.current.length);
    applyProject((p) => ({ ...p, events: p.events.slice(0, -1) }), false);
    void reloadImages();
  };

  const redo = () => {
    const event = redoRef.current.pop();
    if (!event) return;
    setRedoCount(redoRef.current.length);
    applyProject((p) => appendEvent(p, event), false);
    void reloadImages();
  };

  const doRender = async () => {
    if (rendering) return;
    stop();
    let wakeLock: WakeLockSentinel | null = null;
    try {
      wakeLock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
      const out = await renderShow({
        audioBlob: audioBlobRef.current,
        project: projectRef.current,
        getAssetBlob: async (id) => getAsset(id),
        fileName: `${projectRef.current.title || 'show'}.mp4`,
        onProgress: setRendering,
      });
      setRendered(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(null);
      void wakeLock?.release().catch(() => {});
    }
  };

  const seek = (v: number) => {
    playheadRef.current = v;
    setT(v);
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`;

  const passCount = projectSnap.events.filter((e) => e.kind === 'PASS').length;
  const puppets = castOf(projectSnap).filter((p) => !p.back);
  const busy = mode === 'playing' || mode === 'recording';

  if (error) return <p className="error">{error}</p>;

  const selected = selectedId ? castOf(projectSnap).find((p) => p.id === selectedId) : undefined;
  const chipGlyph = (p: ShowPuppet) =>
    p.back ? '🖼' : p.spec.type === 'doodle' ? '✏️' : p.spec.type === 'rect' ? '▦' : '🙂';

  const enterMode = (m: Mode) => {
    setKitOpen(false);
    setSelectedId(null);
    if (m === 'doodling') strokeRef.current = [];
    if (m === 'bodyAssign') {
      bodyMapRef.current = { right: null, left: null };
      setBodyHint('tap a puppet (or a piece or pin) for your RIGHT hand');
    }
    setModeBoth(m);
    dirtyRef.current = true;
  };

  const placing = mode === 'snipping' || mode === 'mouthing' || mode === 'eyeing' || mode === 'pinning';

  return (
    <div className="showstage">
      <div className="stagearea">
        <div ref={frameRef} className={`stagebox mode-${mode}`}>
          <canvas ref={canvasRef} />
          {mode === 'needsAudio' && (
            <div className="stage-cta">
              <p>every bit starts with the sound.</p>
              <button className="primary" onClick={() => void recordBit()}>
                ⏺ record the bit
              </button>
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
          {mode === 'recording' && <span className="recdot">●</span>}
          {mode === 'snipping' && <div className="stage-hintline">draw a line across a puppet</div>}
          {mode === 'mouthing' && <div className="stage-hintline">tap where the mouth goes</div>}
          {mode === 'eyeing' && <div className="stage-hintline">tap where the eyes go</div>}
          {mode === 'pinning' && (
            <div className="stage-hintline">tap an uncut photo puppet to pin it</div>
          )}
          {mode === 'bodyAssign' && <div className="stage-hintline">{bodyHint}</div>}
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
          {mode === 'bodyAssign' && (
            <div className="stagepills">
              <button className="pill" onClick={() => setModeBoth('idle')}>
                cancel
              </button>
              <button
                className="pill primary"
                disabled={!projectSnap.audio}
                onClick={() => void startBodyPass()}
              >
                ⏺ start
              </button>
            </div>
          )}
        </div>
      </div>

      {mode !== 'needsAudio' && mode !== 'micLive' && mode !== 'loading' && (
        <div className="bar">
          {!busy ? (
            <>
              <button
                className="rec"
                aria-label="record a pass"
                disabled={puppets.length === 0 || placing || mode === 'doodling'}
                onClick={() => start(true)}
              >
                ⏺
              </button>
              <button
                className="ghost"
                aria-label="play"
                disabled={passCount === 0 || placing || mode === 'doodling'}
                onClick={() => start(false)}
              >
                ▶
              </button>
            </>
          ) : (
            <button className="rec stop" aria-label="stop" onClick={stop}>
              ■
            </button>
          )}
          <div className="progress">
            {onsets.map((o, i) => (
              <span
                key={i}
                className="beat"
                style={{ left: `${durationS ? (o / durationS) * 100 : 0}%` }}
              />
            ))}
            <div className="fill" style={{ width: durationS ? `${(t / durationS) * 100}%` : '0%' }} />
            <input
              className="seek"
              type="range"
              min={0}
              max={durationS || 1}
              step={0.01}
              value={t}
              disabled={busy}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="playhead"
            />
          </div>
          <span className="time">{fmt(t)}</span>
          <button
            className="ghost"
            aria-label="undo"
            disabled={busy || projectSnap.events.length === 0}
            onClick={undo}
          >
            ↺
          </button>
          <button
            className={`ghost${kitOpen ? ' on' : ''}`}
            aria-label="kit"
            disabled={busy}
            onClick={() => setKitOpen((k) => !k)}
          >
            ⋮⋮
          </button>
        </div>
      )}

      {kitOpen && !busy && mode === 'idle' && (
        <div className="kit">
          <div className="kitrow kithead">
            <span className="status">
              {puppets.length} in the cast · {passCount} pass{passCount === 1 ? '' : 'es'}
            </span>
            {rendered ? (
              <button className="primary" onClick={() => void shareOrDownload(rendered)}>
                share
              </button>
            ) : (
              <button
                className="primary"
                disabled={passCount === 0 || !!rendering}
                onClick={() => void doRender()}
              >
                {rendering
                  ? `${rendering.phase} ${Math.round(rendering.fraction * 100)}%`
                  : 'render'}
              </button>
            )}
          </div>

          <div className="kitrow rail">
            {castOf(projectSnap).map((p) => (
              <button
                key={p.id}
                className={`chip${selectedId === p.id ? ' on' : ''}`}
                onClick={() => setSelectedId((s) => (s === p.id ? null : p.id))}
              >
                {chipGlyph(p)}
              </button>
            ))}
            <button className="chip add" onClick={() => photoInputRef.current?.click()}>
              ＋
            </button>
            <button className="chip add" onClick={() => snapInputRef.current?.click()}>
              📷
            </button>
            <button className="chip add" onClick={() => enterMode('doodling')}>
              ✏️
            </button>
            <button className="chip add" onClick={() => backdropInputRef.current?.click()}>
              🖼
            </button>
          </div>

          {selected && (
            <div className="kitrow">
              <span className="status">rail order is layer order</span>
              {!selected.back && (
                <>
                  <button onClick={() => bringForward(selected)}>front</button>
                  <button onClick={() => sendToBack(selected)}>back</button>
                </>
              )}
              <button onClick={() => centerOnStage(selected)}>center</button>
              <button onClick={() => dropPuppet(selected)}>drop</button>
            </div>
          )}

          <div className="kitrow">
            <button disabled={puppets.length === 0} onClick={() => enterMode('snipping')}>
              ✂ snip
            </button>
            <button disabled={puppets.length === 0} onClick={() => enterMode('mouthing')}>
              mouth
            </button>
            <button disabled={puppets.length === 0} onClick={() => enterMode('eyeing')}>
              eyes
            </button>
            <button disabled={puppets.length === 0} onClick={() => enterMode('pinning')}>
              📌 pin
            </button>
            <button disabled={puppets.length === 0} onClick={() => enterMode('bodyAssign')}>
              🧍 body
            </button>
            <button
              disabled={projectSnap.events.length === 0}
              onClick={() => void exportBit()}
            >
              bit file
            </button>
            <button disabled={redoCount === 0} onClick={redo}>
              redo
            </button>
          </div>
        </div>
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
        capture="environment"
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
