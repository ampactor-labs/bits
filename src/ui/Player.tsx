import { useEffect, useRef, useState } from 'react';
import type { CanvasSink, WrappedCanvas } from 'mediabunny';
import { VideoSourceHandle } from '../media/source';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function drawTo(el: HTMLCanvasElement | null, wc: WrappedCanvas) {
  if (!el) return;
  if (el.width !== wc.canvas.width || el.height !== wc.canvas.height) {
    el.width = wc.canvas.width;
    el.height = wc.canvas.height;
  }
  el.getContext('2d')?.drawImage(wc.canvas, 0, 0);
}

export function Player({ file, name }: { file: File; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<VideoSourceHandle | null>(null);
  const sinkRef = useRef<CanvasSink | null>(null);
  // Bumping the token cancels any in-flight play loop.
  const playToken = useRef(0);
  const tRef = useRef(0);
  const scrubBusy = useRef(false);
  const scrubPending = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [durationS, setDurationS] = useState(0);

  const draw = (wc: WrappedCanvas) => drawTo(canvasRef.current, wc);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await VideoSourceHandle.open(file);
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      sinkRef.current = handle.makeSink(720);
      setDurationS(handle.durationS);
      const first = await sinkRef.current.getCanvas(0);
      if (!cancelled && first) drawTo(canvasRef.current, first);
      if (!cancelled) setReady(true);
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      playToken.current += 1;
      handleRef.current?.dispose();
      handleRef.current = null;
      sinkRef.current = null;
    };
  }, [file]);

  const setTime = (v: number) => {
    tRef.current = v;
    setT(v);
  };

  const play = async () => {
    const sink = sinkRef.current;
    const handle = handleRef.current;
    if (!sink || !handle) return;
    const token = ++playToken.current;
    setPlaying(true);
    const nearEnd = tRef.current >= handle.durationS - 0.05;
    const startT = nearEnd ? 0 : tRef.current;
    const wallStart = performance.now();
    for await (const wc of sink.canvases(startT)) {
      if (token !== playToken.current) return;
      const due = wallStart + (wc.timestamp - startT) * 1000;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      if (token !== playToken.current) return;
      draw(wc);
      setTime(wc.timestamp);
    }
    if (token === playToken.current) setPlaying(false);
  };

  const pause = () => {
    playToken.current += 1;
    setPlaying(false);
  };

  const scrub = async (v: number) => {
    pause();
    setTime(v);
    const sink = sinkRef.current;
    if (!sink) return;
    if (scrubBusy.current) {
      scrubPending.current = v;
      return;
    }
    scrubBusy.current = true;
    try {
      let target: number | null = v;
      while (target !== null) {
        const wc = await sink.getCanvas(target);
        if (wc) draw(wc);
        target = scrubPending.current;
        scrubPending.current = null;
      }
    } finally {
      scrubBusy.current = false;
    }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${Math.floor(s % 60)
      .toString()
      .padStart(2, '0')}`;

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="player">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
      <div className="transport">
        <button className="primary" disabled={!ready} onClick={() => (playing ? pause() : void play())}>
          {playing ? 'pause' : 'play'}
        </button>
        <input
          type="range"
          min={0}
          max={durationS || 1}
          step={0.01}
          value={t}
          onChange={(e) => void scrub(Number(e.target.value))}
        />
        <span className="time">
          {fmt(t)} / {fmt(durationS)}
        </span>
      </div>
      <div className="status">{name}</div>
    </div>
  );
}
