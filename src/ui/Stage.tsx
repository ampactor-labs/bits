// The stage: record the bit, cast puppets, perform in passes. Scissors split
// a puppet where you draw the line and the far side dangles; a mouth pinned
// on a puppet flaps with the voice track; two fingers resize and rotate
// while idle; long-press drops a puppet from the cast.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendEvent,
  createProject,
  parseProject,
  serializeProject,
  type CastEvent,
  type PassEvent,
  type Project,
} from '../engine/recipe';
import { computeEnvelope, openAt } from '../engine/envelope';
import { detectOnsets } from '../engine/onsets';
import { castOf, createShowSim, targetForPuppet, type ShowPuppet, type ShowSim } from '../engine/show';
import { AudioSourceHandle, JamAudio, mixdownMono } from '../media/audio';
import { getAsset, saveAsset } from '../media/assets';
import { makeCutout } from '../media/cutout';
import { MicRecorder } from '../media/mic';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { renderShow, visualsOf, type RenderProgress } from '../media/render';
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
  | 'mouthing';

interface Grab {
  puppetId: string;
  samples: number[];
  x: number;
  y: number;
}

/** Idle-time staging overrides, live while fingers are down. */
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

  const audioBlobRef = useRef<Blob | null>(null);
  const envelopeRef = useRef<Float32Array>(new Float32Array(0));
  const jamRef = useRef<JamAudio | null>(null);
  const micRef = useRef<MicRecorder | null>(null);
  const imagesRef = useRef<StageImages>(new Map());
  const visualsRef = useRef<Map<string, PuppetVisual>>(new Map());
  const simRef = useRef<ShowSim | null>(null);
  const lastStatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const grabRef = useRef<Grab | null>(null);
  const stagingRef = useRef<StagingDrag | null>(null);
  const strokeRef = useRef<number[][]>([]);
  const snipStrokeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wallStartRef = useRef(0);
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

  const commit = useCallback(
    (mutate: (p: Project) => Project) => {
      projectRef.current = mutate(projectRef.current);
      visualsRef.current = visualsOf(projectRef.current);
      setProjectSnap(projectRef.current);
      setRendered(null);
      dirtyRef.current = true;
      persistSoon();
    },
    [persistSoon],
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
      envelopeRef.current = computeEnvelope(mix.samples, mix.sampleRate);
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

  const commitGrab = useCallback(() => {
    const grab = grabRef.current;
    grabRef.current = null;
    if (!grab || grab.samples.length < 6) return;
    const pass: PassEvent = {
      kind: 'PASS',
      id: newId(),
      at: grab.samples[0]!,
      puppetId: grab.puppetId,
      samples: grab.samples,
    };
    commit((p) => appendEvent(p, pass));
  }, [commit]);

  useEffect(() => {
    commitGrabRef.current = commitGrab;
  }, [commitGrab]);

  const stop = useCallback(() => {
    if (modeRef.current === 'recording' && grabRef.current) commitGrabRef.current();
    jamRef.current?.stop();
    simRef.current = null;
    grabRef.current = null;
    setModeBoth('idle');
    dirtyRef.current = true;
  }, []);

  const start = (recording: boolean) => {
    if (!projectRef.current.audio) return;
    setRendered(null);
    simRef.current = createShowSim(projectRef.current, 0, (id, tt) => {
      const grab = grabRef.current;
      if (grab && grab.puppetId === id) return { x: grab.x, y: grab.y };
      return targetForPuppet(projectRef.current, id, tt);
    });
    wallStartRef.current = performance.now() + 50;
    void jamRef.current?.play(0);
    setModeBoth(recording ? 'recording' : 'playing');
  };

  // Frame loop: clock, simulation, drawing.
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
        const now = (performance.now() - wallStartRef.current) / 1000;
        const clock = Math.max(0, Math.min(dur, now));
        setT(clock);
        const sim = simRef.current;
        if (sim) {
          const poses = sim.advanceTo(clock);
          lastStatesRef.current = new Map(
            [...poses].map(([id, p]) => [id, { x: p.root.x, y: p.root.y }]),
          );
          drawStage(
            ctx,
            W,
            H,
            castOf(project),
            poses,
            imagesRef.current,
            visualsRef.current,
            openAt(envelopeRef.current, clock),
            clock,
            project.seed,
          );
        }
        if (now >= dur) stop();
        return;
      }

      if (dirtyRef.current) {
        dirtyRef.current = false;
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
        const poses = sim.states();
        lastStatesRef.current = new Map(
          [...poses].map(([id, p]) => [id, { x: p.root.x, y: p.root.y }]),
        );
        drawStage(
          ctx,
          W,
          H,
          cast,
          poses,
          imagesRef.current,
          visualsRef.current,
          0,
          0,
          project.seed,
        );
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
  }, [stop]);

  // Pointer handling.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const pointers = new Map<number, { x: number; y: number }>();

    const norm = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };

    const hitPuppet = (x: number, y: number): ShowPuppet | null => {
      const cast = castOf(projectRef.current);
      for (let i = cast.length - 1; i >= 0; i--) {
        const p = cast[i]!;
        if (p.back) continue;
        const s = lastStatesRef.current.get(p.id);
        if (!s) continue;
        const hw = Math.max(0.06, (p.spec.w * p.home.scale) / 2);
        const hh = Math.max(0.06, (p.spec.h * p.home.scale) / 2);
        if (Math.abs(x - s.x) <= hw && Math.abs(y - s.y) <= hh) return p;
      }
      return null;
    };

    const toLocal = (p: ShowPuppet, x: number, y: number) => {
      const s = lastStatesRef.current.get(p.id) ?? { x: p.home.x, y: p.home.y };
      const c = Math.cos(-p.home.rot);
      const sn = Math.sin(-p.home.rot);
      const dx = x - s.x;
      const dy = y - s.y;
      return {
        x: (dx * c - dy * sn) / (p.spec.w * p.home.scale) + 0.5,
        y: (dx * sn + dy * c) / (p.spec.h * p.home.scale) + 0.5,
      };
    };

    const clearLongPress = () => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
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
        const hit = hitPuppet(x, y);
        if (hit) {
          const local = toLocal(hit, x, y);
          commit((p) =>
            appendEvent(p, {
              kind: 'MOUTH',
              id: newId(),
              at: 0,
              puppetId: hit.id,
              mx: Math.min(1, Math.max(0, local.x)),
              my: Math.min(1, Math.max(0, local.y)),
              size: 0.24,
            }),
          );
          vibrate(15);
          setModeBoth('idle');
        }
        return;
      }
      if (m === 'recording') {
        const hit = hitPuppet(x, y);
        if (hit) {
          const clock = Math.max(0, (performance.now() - wallStartRef.current) / 1000);
          grabRef.current = { puppetId: hit.id, samples: [clock, x, y], x, y };
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
        const hit = hitPuppet(x, y);
        if (hit) {
          stagingRef.current = {
            puppetId: hit.id,
            x: hit.home.x,
            y: hit.home.y,
            scale: hit.home.scale,
            rot: hit.home.rot,
            pinch: null,
          };
          dirtyRef.current = true;
          clearLongPress();
          longPressRef.current = setTimeout(() => {
            stagingRef.current = null;
            commit((p) => appendEvent(p, { kind: 'DROP', id: newId(), at: 0, puppetId: hit.id }));
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
        const clock = Math.max(0, (performance.now() - wallStartRef.current) / 1000);
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
          staging.scale = Math.min(4, Math.max(0.2, staging.pinch.baseScale * (dist / staging.pinch.baseDist)));
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
        const hit = hitPuppet(midX, midY);
        if (hit && lineLen > 0.03) {
          const a = toLocal(hit, s.x0, s.y0);
          const b = toLocal(hit, s.x1, s.y1);
          commit((p) =>
            appendEvent(p, {
              kind: 'SNIP',
              id: newId(),
              at: 0,
              puppetId: hit.id,
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
  }, [commit]);

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
    setModeBoth('idle');
  };

  // Casting.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const backdropInputRef = useRef<HTMLInputElement>(null);

  const onPhotoPicked = async (files: FileList | null) => {
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

  const startDoodle = () => {
    strokeRef.current = [];
    setModeBoth('doodling');
    dirtyRef.current = true;
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

  const undo = () => {
    if (projectRef.current.events.length === 0) return;
    commit((p) => ({ ...p, events: p.events.slice(0, -1) }));
    void reloadImages();
  };

  const doRender = async () => {
    if (rendering) return;
    stop();
    try {
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
    }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`;

  const passCount = projectSnap.events.filter((e) => e.kind === 'PASS').length;
  const puppets = castOf(projectSnap).filter((p) => !p.back);
  const busy = mode === 'playing' || mode === 'recording';

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="showstage">
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
      </div>

      {mode !== 'needsAudio' && mode !== 'micLive' && mode !== 'loading' && (
        <>
          <div className="showbar">
            <div className="progress">
              {onsets.map((o, i) => (
                <span
                  key={i}
                  className="beat"
                  style={{ left: `${durationS ? (o / durationS) * 100 : 0}%` }}
                />
              ))}
              <div
                className="fill"
                style={{ width: durationS ? `${(t / durationS) * 100}%` : '0%' }}
              />
            </div>
            <span className="time">
              {fmt(t)} / {fmt(durationS)}
            </span>
          </div>

          {mode === 'doodling' ? (
            <div className="transport">
              <span className="status">draw with your finger</span>
              <button onClick={() => finishDoodle(false)}>cancel</button>
              <button className="primary" onClick={() => finishDoodle(true)}>
                keep it
              </button>
            </div>
          ) : mode === 'snipping' || mode === 'mouthing' ? (
            <div className="transport">
              <span className="status">
                {mode === 'snipping' ? 'scissors out' : 'placing a mouth'}
              </span>
              <button onClick={() => setModeBoth('idle')}>cancel</button>
            </div>
          ) : (
            <>
              <div className="transport">
                {!busy ? (
                  <>
                    <button
                      className="primary"
                      disabled={puppets.length === 0}
                      onClick={() => start(true)}
                    >
                      ⏺ record a pass
                    </button>
                    <button disabled={passCount === 0} onClick={() => start(false)}>
                      ▶ play
                    </button>
                  </>
                ) : (
                  <button className="primary" onClick={stop}>
                    ■ stop
                  </button>
                )}
                <button onClick={undo} disabled={projectSnap.events.length === 0}>
                  undo
                </button>
              </div>
              <div className="transport">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    void onPhotoPicked(e.target.files);
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
                <button disabled={busy} onClick={() => photoInputRef.current?.click()}>
                  + puppet
                </button>
                <button disabled={busy} onClick={startDoodle}>
                  + doodle
                </button>
                <button disabled={busy} onClick={() => backdropInputRef.current?.click()}>
                  + backdrop
                </button>
              </div>
              <div className="transport">
                <button disabled={busy || puppets.length === 0} onClick={() => setModeBoth('snipping')}>
                  ✂ snip
                </button>
                <button disabled={busy || puppets.length === 0} onClick={() => setModeBoth('mouthing')}>
                  mouth
                </button>
                <span className="spacer" />
                {rendered ? (
                  <button className="primary" onClick={() => void shareOrDownload(rendered)}>
                    share
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={busy || passCount === 0 || !!rendering}
                    onClick={() => void doRender()}
                  >
                    {rendering
                      ? `${rendering.phase} ${Math.round(rendering.fraction * 100)}%`
                      : 'render'}
                  </button>
                )}
              </div>
              <div className="status">
                {puppets.length} in the cast · {passCount} pass{passCount === 1 ? '' : 'es'}
                {puppets.length === 0 ? ' · add a puppet to start' : ''}
                {puppets.length > 0 && passCount === 0
                  ? ' · drag to place · two fingers resize · hold to drop'
                  : ''}
              </div>
            </>
          )}
        </>
      )}
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
