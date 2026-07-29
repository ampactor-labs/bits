// The deck: footage plays, fingers perform the edit, every gesture lands in
// the recipe. Tap cuts (quantized to onsets), left hold skips, right hold
// slows, pinch punches in, double-tap resets the punch. Review plays raw;
// roll captures. Rolling from an earlier point truncates what came after:
// undo is rewind.

import { useEffect, useRef, useState } from 'react';
import type { AudioBufferSink, CanvasSink, WrappedCanvas } from 'mediabunny';
import {
  appendEvent,
  createProject,
  parseProject,
  serializeProject,
  type Project,
  type RecipeEvent,
} from '../engine/recipe';
import { compileProgram, truncateAfter, zoomAtSrc, type Zoom } from '../engine/program';
import { detectOnsets, quantizeToOnsets } from '../engine/onsets';
import { DeckGestures } from '../jam/deckGestures';
import { AudioSourceHandle, JamAudio, mixdownForOnsets } from '../media/audio';
import { loadProjectJson, saveProjectJson } from '../media/opfs';
import { renderProject, type RenderProgress } from '../media/render';
import { VideoSourceHandle } from '../media/source';

const SLOW_RATE = 0.3;
const SKIP_PREVIEW_RATE = 3;
const MAX_PUNCH = 6;

type Mode = 'idle' | 'review' | 'rolling';

interface HoldState {
  side: 'left' | 'right';
  startSrcT: number;
}

const newEventId = () => crypto.randomUUID().slice(0, 8);

export function Deck({ file, name, sourceId }: { file: File; name: string; sourceId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<VideoSourceHandle | null>(null);
  const sinkRef = useRef<CanvasSink | null>(null);
  const audioRef = useRef<AudioSourceHandle | null>(null);
  const audioSinkRef = useRef<AudioBufferSink | null>(null);
  const jamRef = useRef<JamAudio | null>(null);

  const onsetsRef = useRef<number[]>([]);
  const modeRef = useRef<Mode>('idle');
  const srcTRef = useRef(0);
  const holdRef = useRef<HoldState | null>(null);
  const liveZoomRef = useRef<Zoom | null>(null);
  const pinchBaseRef = useRef<{ zoom: Zoom; mx: number; my: number } | null>(null);
  const lastFrameRef = useRef<WrappedCanvas | null>(null);
  const iterRef = useRef<AsyncGenerator<WrappedCanvas, void, unknown> | null>(null);
  const iterNextRef = useRef<WrappedCanvas | null>(null);
  const iterBusyRef = useRef(false);
  const gesturesRef = useRef<DeckGestures | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);
  const lastTickRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [srcT, setSrcT] = useState(0);
  const [durationS, setDurationS] = useState(0);
  const [quantize, setQuantize] = useState(true);
  // Render-facing snapshot; projectRef below stays the frame loop's truth.
  const [projectSnap, setProjectSnap] = useState<Project>(() => createProject(name));
  const projectRef = useRef(projectSnap);
  const [holdUi, setHoldUi] = useState<'left' | 'right' | null>(null);
  const [flash, setFlash] = useState(0);
  const [gridReady, setGridReady] = useState(false);
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const [rendered, setRendered] = useState<File | null>(null);

  const setModeBoth = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  const vibrate = (ms: number) => navigator.vibrate?.(ms);

  const persistSoon = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveProjectJson(sourceId, serializeProject(projectRef.current));
    }, 400);
  };

  const addEvent = (e: RecipeEvent) => {
    projectRef.current = appendEvent(projectRef.current, e);
    setProjectSnap(projectRef.current);
    setRendered(null);
    persistSoon();
  };

  const drawFrame = (wc: WrappedCanvas | null) => {
    const el = canvasRef.current;
    if (!el || !wc) return;
    const src = wc.canvas;
    if (el.width !== src.width || el.height !== src.height) {
      el.width = src.width;
      el.height = src.height;
    }
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const zoom = liveZoomRef.current ?? zoomAtSrc(projectRef.current, srcTRef.current);
    const scale = Math.max(1, zoom.scale);
    const sw = src.width / scale;
    const sh = src.height / scale;
    const sx = Math.min(Math.max(zoom.cx * src.width - sw / 2, 0), src.width - sw);
    const sy = Math.min(Math.max(zoom.cy * src.height - sh / 2, 0), src.height - sh);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, el.width, el.height);
    lastFrameRef.current = wc;
  };

  const disposeIter = () => {
    void iterRef.current?.return();
    iterRef.current = null;
    iterNextRef.current = null;
    iterBusyRef.current = false;
  };

  const startIter = (fromS: number) => {
    disposeIter();
    const sink = sinkRef.current;
    if (!sink) return;
    iterRef.current = sink.canvases(fromS);
    pullNext();
  };

  const pullNext = () => {
    const iter = iterRef.current;
    if (!iter || iterBusyRef.current) return;
    iterBusyRef.current = true;
    void iter.next().then((r) => {
      iterBusyRef.current = false;
      iterNextRef.current = r.done ? null : r.value;
    });
  };

  /** Advance decoded frames up to the playhead; returns true near stream end. */
  const feedFrames = () => {
    let drew = false;
    while (iterNextRef.current && iterNextRef.current.timestamp <= srcTRef.current) {
      drawFrame(iterNextRef.current);
      iterNextRef.current = null;
      pullNext();
      drew = true;
    }
    if (!drew && lastFrameRef.current) drawFrame(lastFrameRef.current);
  };

  const seekIdle = (t: number) => {
    srcTRef.current = t;
    setSrcT(t);
    disposeIter();
    void sinkRef.current?.getCanvas(t).then((wc) => {
      if (wc && modeRef.current === 'idle') drawFrame(wc);
    });
  };

  const currentRate = () => {
    if (modeRef.current !== 'rolling' || !holdRef.current) return 1;
    return holdRef.current.side === 'left' ? SKIP_PREVIEW_RATE : SLOW_RATE;
  };

  const stopTransport = () => {
    if (modeRef.current === 'rolling' && holdRef.current) endHold(holdRef.current.side, true);
    gesturesRef.current?.cancel();
    jamRef.current?.stop();
    disposeIter();
    setModeBoth('idle');
    setHoldUi(null);
    persistSoon();
  };

  const startTransport = (rolling: boolean) => {
    if (!ready) return;
    if (srcTRef.current >= durationS - 0.05) {
      srcTRef.current = 0;
      setSrcT(0);
    }
    if (rolling) {
      projectRef.current = truncateAfter(projectRef.current, srcTRef.current);
      setProjectSnap(projectRef.current);
      setRendered(null);
    }
    setModeBoth(rolling ? 'rolling' : 'review');
    lastTickRef.current = performance.now();
    startIter(srcTRef.current);
    void jamRef.current?.play(srcTRef.current);
  };

  const beginHold = (side: 'left' | 'right') => {
    if (modeRef.current !== 'rolling') return;
    holdRef.current = { side, startSrcT: srcTRef.current };
    setHoldUi(side);
    vibrate(8);
    jamRef.current?.stop();
    if (side === 'right') {
      addEvent({ kind: 'SPEED', id: newEventId(), at: srcTRef.current, rate: SLOW_RATE });
    }
  };

  const endHold = (side: 'left' | 'right', silent = false) => {
    const hold = holdRef.current;
    holdRef.current = null;
    setHoldUi(null);
    if (!hold || hold.side !== side) return;
    if (!silent) vibrate(8);
    const t = srcTRef.current;
    if (side === 'left') {
      if (t - hold.startSrcT > 0.05) {
        addEvent({ kind: 'SKIP', id: newEventId(), at: hold.startSrcT, endAt: t });
      }
    } else {
      addEvent({ kind: 'SPEED', id: newEventId(), at: t, rate: 1 });
    }
    if (modeRef.current === 'rolling') void jamRef.current?.play(t);
  };

  const commitZoomSample = (zoom: Zoom) => {
    addEvent({
      kind: 'ZOOM',
      id: newEventId(),
      at: srcTRef.current,
      cx: zoom.cx,
      cy: zoom.cy,
      scale: zoom.scale,
    });
  };

  // Mount: open media, restore project, compute the onset grid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const video = await VideoSourceHandle.open(file);
      if (cancelled) {
        video.dispose();
        return;
      }
      videoRef.current = video;
      sinkRef.current = video.makeSink(720);
      setDurationS(video.durationS);

      const saved = await loadProjectJson(sourceId);
      if (saved) {
        try {
          projectRef.current = parseProject(saved);
        } catch {
          projectRef.current = createProject(name);
        }
      } else {
        projectRef.current = createProject(name);
      }
      if (!projectRef.current.sources.some((s) => s.id === sourceId)) {
        projectRef.current = {
          ...projectRef.current,
          sources: [
            ...projectRef.current.sources,
            {
              id: sourceId,
              name,
              bytes: file.size,
              durationS: video.durationS,
              addedAt: new Date().toISOString(),
            },
          ],
        };
      }
      setProjectSnap(projectRef.current);

      const first = await sinkRef.current.getCanvas(0);
      if (!cancelled && first) drawFrame(first);
      if (!cancelled) setReady(true);

      const audio = await AudioSourceHandle.open(file);
      if (cancelled) {
        audio?.dispose();
        return;
      }
      if (audio) {
        audioRef.current = audio;
        audioSinkRef.current = audio.makeSink();
        jamRef.current = new JamAudio(audioSinkRef.current);
      }

      const mix = await mixdownForOnsets(file);
      if (!cancelled && mix) {
        onsetsRef.current = detectOnsets(mix.samples, mix.sampleRate);
        setGridReady(true);
      }
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      disposeIter();
      jamRef.current?.dispose();
      audioRef.current?.dispose();
      videoRef.current?.dispose();
      jamRef.current = null;
      audioRef.current = null;
      videoRef.current = null;
      sinkRef.current = null;
    };
  }, [file, sourceId, name]);

  // Gesture wiring.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = () => stage.getBoundingClientRect();
    const g = new DeckGestures(
      { viewW: rect().width || 1, viewH: rect().height || 1 },
      {
        onTap: () => {
          if (modeRef.current !== 'rolling') return;
          const at = srcTRef.current;
          const atQ = quantize ? quantizeToOnsets(at, onsetsRef.current) : undefined;
          addEvent(
            atQ === undefined
              ? { kind: 'CUT', id: newEventId(), at }
              : { kind: 'CUT', id: newEventId(), at, atQ },
          );
          vibrate(12);
          setFlash((f) => f + 1);
        },
        onDoubleTap: () => {
          if (modeRef.current !== 'rolling') return;
          liveZoomRef.current = null;
          commitZoomSample({ cx: 0.5, cy: 0.5, scale: 1 });
          vibrate(20);
        },
        onHoldStart: (side) => beginHold(side),
        onHoldEnd: (side) => endHold(side),
        onPinchStart: () => {
          pinchBaseRef.current = null;
        },
        onPinch: (s) => {
          if (modeRef.current !== 'rolling') return;
          if (!pinchBaseRef.current) {
            const zoom = liveZoomRef.current ?? zoomAtSrc(projectRef.current, srcTRef.current);
            pinchBaseRef.current = { zoom, mx: s.mx, my: s.my };
          }
          const base = pinchBaseRef.current;
          const scale = Math.min(MAX_PUNCH, Math.max(1, base.zoom.scale * s.factor));
          const cx = Math.min(1, Math.max(0, base.zoom.cx - (s.mx - base.mx) / scale));
          const cy = Math.min(1, Math.max(0, base.zoom.cy - (s.my - base.my) / scale));
          liveZoomRef.current = { cx, cy, scale };
        },
        onPinchEnd: () => {
          if (liveZoomRef.current) commitZoomSample(liveZoomRef.current);
          pinchBaseRef.current = null;
        },
      },
    );
    gesturesRef.current = g;

    const toLocal = (e: PointerEvent) => {
      const r = rect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      stage.setPointerCapture(e.pointerId);
      const { x, y } = toLocal(e);
      g.pointerDown(e.pointerId, x, y, performance.now());
    };
    const move = (e: PointerEvent) => {
      const { x, y } = toLocal(e);
      g.pointerMove(e.pointerId, x, y, performance.now());
    };
    const up = (e: PointerEvent) => g.pointerUp(e.pointerId, performance.now());
    const cancel = () => g.cancel();

    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', cancel);
    return () => {
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', cancel);
      gesturesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilding on quantize keeps the tap closure fresh
  }, [quantize]);

  // Frame loop: playhead clock, frame feeding, gesture timers.
  useEffect(() => {
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      gesturesRef.current?.tick(now);
      const m = modeRef.current;
      if (m === 'review' || m === 'rolling') {
        const dt = Math.min(0.1, (now - lastTickRef.current) / 1000);
        lastTickRef.current = now;
        const rate = m === 'rolling' ? currentRate() : 1;
        srcTRef.current = Math.min(durationS, srcTRef.current + dt * rate);
        setSrcT(srcTRef.current);
        feedFrames();
        if (srcTRef.current >= durationS) stopTransport();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loop reads refs; durationS is the only reactive input
  }, [durationS]);

  const doRender = async () => {
    if (rendering) return;
    stopTransport();
    try {
      const out = await renderProject({
        blob: file,
        project: projectRef.current,
        fileName: `${name.replace(/\.[^.]+$/, '')} bit.mp4`,
        onProgress: setRendering,
      });
      setRendered(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(null);
    }
  };

  const shareRendered = async () => {
    if (!rendered) return;
    if (navigator.canShare?.({ files: [rendered] })) {
      try {
        await navigator.share({ files: [rendered] });
        return;
      } catch {
        // Fall through to download.
      }
    }
    const url = URL.createObjectURL(rendered);
    const a = document.createElement('a');
    a.href = url;
    a.download = rendered.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const undo = () => {
    const events = projectRef.current.events;
    if (events.length === 0) return;
    projectRef.current = { ...projectRef.current, events: events.slice(0, -1) };
    setProjectSnap(projectRef.current);
    setRendered(null);
    persistSoon();
  };

  const eventCount = projectSnap.events.length;
  const program = compileProgram(projectSnap, durationS || 1);
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`;

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="deck">
      <div
        ref={stageRef}
        className={`stage hold-${holdUi ?? 'none'}`}
        data-flash={flash % 2}
      >
        <canvas ref={canvasRef} />
        {mode === 'rolling' && (
          <>
            <span className="zone zone-left">hold: skip</span>
            <span className="zone zone-right">hold: slow</span>
          </>
        )}
        {mode !== 'rolling' && <div className="stage-hint">roll to perform. tap cuts.</div>}
      </div>

      <div className="timeline">
        {program.cuts.map((c, i) => (
          <span key={i} className="tick tick-cut" style={{ left: `${(c / (durationS || 1)) * 100}%` }} />
        ))}
        {projectSnap.events
          .filter((e): e is RecipeEvent & { kind: 'SKIP' } => e.kind === 'SKIP')
          .map((e, i) => (
            <span
              key={`s${i}`}
              className="span-skip"
              style={{
                left: `${(e.at / (durationS || 1)) * 100}%`,
                width: `${((e.endAt - e.at) / (durationS || 1)) * 100}%`,
              }}
            />
          ))}
        <input
          type="range"
          min={0}
          max={durationS || 1}
          step={0.01}
          value={srcT}
          disabled={mode !== 'idle'}
          onChange={(e) => seekIdle(Number(e.target.value))}
        />
      </div>

      <div className="transport">
        {mode === 'idle' ? (
          <>
            <button onClick={() => startTransport(false)} disabled={!ready}>
              review
            </button>
            <button className="primary" onClick={() => startTransport(true)} disabled={!ready}>
              ● roll
            </button>
          </>
        ) : (
          <button className="primary" onClick={stopTransport}>
            ■ stop
          </button>
        )}
        <button
          className={quantize ? 'toggled' : ''}
          onClick={() => setQuantize((q) => !q)}
          title="quantize cuts to the onset grid"
        >
          Q{gridReady ? '' : '…'}
        </button>
        <button onClick={undo} disabled={eventCount === 0}>
          undo
        </button>
        <span className="time">
          {fmt(srcT)} / {fmt(durationS)}
        </span>
      </div>

      <div className="deckbar">
        <span className="status">
          {name} · {eventCount} moves · out {fmt(program.outputDurationS)}
        </span>
        {rendered ? (
          <button className="primary" onClick={() => void shareRendered()}>
            share
          </button>
        ) : (
          <button className="primary" onClick={() => void doRender()} disabled={!ready || !!rendering}>
            {rendering ? `${rendering.phase} ${Math.round(rendering.fraction * 100)}%` : 'render'}
          </button>
        )}
      </div>
    </div>
  );
}
