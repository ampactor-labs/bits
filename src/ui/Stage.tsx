// The stage: record the bit first, cast puppets from photos or doodles, then
// record passes. While a pass records, the audio and every earlier pass play
// back and one finger drives one puppet; the spring makes it alive.

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
import { castOf, createShowSim, targetForPuppet, type ShowSim } from '../engine/show';
import { AudioSourceHandle, JamAudio } from '../media/audio';
import { getAsset, saveAsset } from '../media/assets';
import { makeCutout } from '../media/cutout';
import { MicRecorder } from '../media/mic';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { renderShow, type RenderProgress } from '../media/render';
import { shareOrDownload } from '../media/shareFile';
import { drawStage, loadStageImages, type StageImages } from '../media/stageDraw';

type Mode = 'loading' | 'needsAudio' | 'micLive' | 'idle' | 'playing' | 'recording' | 'doodling';

interface Grab {
  puppetId: string;
  samples: number[];
  x: number;
  y: number;
}

interface HomeDrag {
  puppetId: string;
  x: number;
  y: number;
}

const newId = () => crypto.randomUUID().slice(0, 8);

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

  const audioBlobRef = useRef<Blob | null>(null);
  const jamRef = useRef<JamAudio | null>(null);
  const micRef = useRef<MicRecorder | null>(null);
  const imagesRef = useRef<StageImages>(new Map());
  const simRef = useRef<ShowSim | null>(null);
  const lastStatesRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const grabRef = useRef<Grab | null>(null);
  const homeDragRef = useRef<HomeDrag | null>(null);
  const doodleRef = useRef<number[][]>([]);
  const wallStartRef = useRef(0);
  const rafRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(true);

  const setModeBoth = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  // Pointer handlers live in a mount-once effect; they reach the latest
  // commitGrab through this ref.
  const commitGrabRef = useRef<() => void>(() => {});

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
      setProjectSnap(projectRef.current);
      if (projectRef.current.audio) {
        audioBlobRef.current = await getAsset(projectRef.current.audio.assetId);
        if (cancelled) return;
        const handle = await AudioSourceHandle.open(audioBlobRef.current);
        if (handle) jamRef.current = new JamAudio(handle.makeSink());
      }
      await reloadImages();
      if (!cancelled) setModeBoth(projectRef.current.audio ? 'idle' : 'needsAudio');
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      jamRef.current?.dispose();
      jamRef.current = null;
      for (const img of imagesRef.current.values()) img.close();
      imagesRef.current = new Map();
    };
  }, [showId, reloadImages]);

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
          const states = sim.advanceTo(clock);
          lastStatesRef.current = new Map(
            [...states].map(([id, s]) => [id, { x: s.x, y: s.y }]),
          );
          drawStage(ctx, W, H, castOf(project), states, imagesRef.current, clock, project.seed);
        }
        if (now >= dur) stop();
        return;
      }

      if (dirtyRef.current) {
        dirtyRef.current = false;
        const cast = castOf(project);
        const sim = createShowSim(project);
        const states = sim.states();
        const drag = homeDragRef.current;
        if (drag) {
          const s = states.get(drag.puppetId);
          if (s) states.set(drag.puppetId, { ...s, x: drag.x, y: drag.y });
        }
        lastStatesRef.current = new Map([...states].map(([id, s]) => [id, { x: s.x, y: s.y }]));
        drawStage(ctx, W, H, cast, states, imagesRef.current, 0, project.seed);
        if (modeRef.current === 'doodling') {
          ctx.strokeStyle = '#ece5db';
          ctx.lineWidth = Math.max(2, W * 0.012);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const stroke of doodleRef.current) {
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
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stop]);

  // Pointer handling on the stage.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const norm = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };

    const hitPuppet = (x: number, y: number): string | null => {
      const cast = castOf(projectRef.current);
      for (let i = cast.length - 1; i >= 0; i--) {
        const p = cast[i]!;
        const s = lastStatesRef.current.get(p.id);
        if (!s) continue;
        const hw = Math.max(0.06, (p.spec.w * p.home.scale) / 2);
        const hh = Math.max(0.06, (p.spec.h * p.home.scale) / 2);
        if (Math.abs(x - s.x) <= hw && Math.abs(y - s.y) <= hh) return p.id;
      }
      return null;
    };

    const down = (e: PointerEvent) => {
      frame.setPointerCapture(e.pointerId);
      const { x, y } = norm(e);
      const m = modeRef.current;
      if (m === 'doodling') {
        doodleRef.current.push([x, y]);
        dirtyRef.current = true;
        return;
      }
      const id = hitPuppet(x, y);
      if (!id) return;
      if (m === 'recording') {
        const clock = Math.max(0, (performance.now() - wallStartRef.current) / 1000);
        grabRef.current = { puppetId: id, samples: [clock, x, y], x, y };
      } else if (m === 'idle') {
        homeDragRef.current = { puppetId: id, x, y };
        dirtyRef.current = true;
      }
    };

    const move = (e: PointerEvent) => {
      const { x, y } = norm(e);
      const m = modeRef.current;
      if (m === 'doodling') {
        const stroke = doodleRef.current[doodleRef.current.length - 1];
        if (stroke && e.buttons > 0) {
          stroke.push(x, y);
          dirtyRef.current = true;
        }
        return;
      }
      const grab = grabRef.current;
      if (m === 'recording' && grab) {
        const clock = Math.max(0, (performance.now() - wallStartRef.current) / 1000);
        const lastT = grab.samples[grab.samples.length - 3]!;
        if (clock - lastT >= 1 / 60) grab.samples.push(clock, x, y);
        grab.x = x;
        grab.y = y;
        return;
      }
      const drag = homeDragRef.current;
      if (m === 'idle' && drag) {
        drag.x = x;
        drag.y = y;
        dirtyRef.current = true;
      }
    };

    const up = () => {
      const m = modeRef.current;
      if (m === 'recording' && grabRef.current) {
        commitGrabRef.current();
        return;
      }
      const drag = homeDragRef.current;
      if (m === 'idle' && drag) {
        homeDragRef.current = null;
        const existing = castOf(projectRef.current).find((p) => p.id === drag.puppetId);
        if (existing) {
          const recast: CastEvent = {
            kind: 'CAST',
            id: newId(),
            at: 0,
            puppetId: existing.id,
            puppet: existing.spec,
            x: drag.x,
            y: drag.y,
            scale: existing.home.scale,
          };
          commit((p) => appendEvent(p, recast));
        }
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
    commit((p) => ({ ...p, audio: { assetId, durationS: durationRecorded } }));
    setModeBoth('idle');
  };

  // Cast: photo puppet.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const onPhotoPicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const cutout = await makeCutout(file);
    const assetId = await saveAsset(cutout.blob, 'png');
    const frame = frameRef.current;
    const stageRatio = frame ? frame.clientWidth / frame.clientHeight : 9 / 16;
    const w = 0.38;
    const h = w * stageRatio * (cutout.height / cutout.width);
    const cast: CastEvent = {
      kind: 'CAST',
      id: newId(),
      at: 0,
      puppetId: newId(),
      puppet: { type: 'cutout', assetId, w, h },
      x: 0.5,
      y: 0.55,
      scale: 1,
    };
    commit((p) => appendEvent(p, cast));
    await reloadImages();
  };

  // Cast: doodle puppet.
  const startDoodle = () => {
    doodleRef.current = [];
    setModeBoth('doodling');
    dirtyRef.current = true;
  };

  const finishDoodle = (keep: boolean) => {
    const strokes = doodleRef.current;
    doodleRef.current = [];
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
    const cast: CastEvent = {
      kind: 'CAST',
      id: newId(),
      at: 0,
      puppetId: newId(),
      puppet: { type: 'doodle', strokes: normalized, w, h },
      x: minX + w / 2,
      y: minY + h / 2,
      scale: 1,
    };
    commit((p) => appendEvent(p, cast));
  };

  const undo = () => {
    if (projectRef.current.events.length === 0) return;
    commit((p) => ({ ...p, events: p.events.slice(0, -1) }));
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
  const castCount = castOf(projectSnap).length;

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
      </div>

      {mode !== 'needsAudio' && mode !== 'micLive' && mode !== 'loading' && (
        <>
          <div className="showbar">
            <div className="progress">
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
          ) : (
            <>
              <div className="transport">
                {mode === 'idle' ? (
                  <>
                    <button
                      className="primary"
                      disabled={castCount === 0}
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
                <button onClick={() => photoInputRef.current?.click()}>+ photo puppet</button>
                <button onClick={startDoodle}>+ doodle</button>
                <span className="spacer" />
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
              <div className="status">
                {castCount} in the cast · {passCount} pass{passCount === 1 ? '' : 'es'}
                {castCount === 0 ? ' · add a puppet to start' : ''}
                {castCount > 0 && passCount === 0 ? ' · drag puppets to place them' : ''}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
