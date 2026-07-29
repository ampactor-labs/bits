// Pure pointer-gesture state machine for the deck. No DOM: callers feed
// pointer events with explicit timestamps and drive tick() from their frame
// loop, which makes every timing rule unit-testable.
//
// Vocabulary: tap = CUT; hold left = SKIP; hold right = SLOW; two fingers =
// pinch/pan punch-in; double-tap = zoom reset. Taps commit only after the
// double-tap window closes, so a double-tap never leaves a stray cut behind.

export interface PinchSample {
  /** Midpoint in normalized view coords. */
  mx: number;
  my: number;
  /** Scale multiplier relative to pinch start. */
  factor: number;
}

export interface GestureCallbacks {
  onTap(xNorm: number, yNorm: number): void;
  onDoubleTap(): void;
  onHoldStart(side: 'left' | 'right'): void;
  onHoldEnd(side: 'left' | 'right'): void;
  onPinchStart(): void;
  onPinch(sample: PinchSample): void;
  onPinchEnd(): void;
}

export interface GestureConfig {
  viewW: number;
  viewH: number;
  holdMs?: number;
  tapMaxMovePx?: number;
  doubleTapMs?: number;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
  downX: number;
  downY: number;
  downT: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'maybeTapOrHold'; pointer: PointerState }
  | { kind: 'holding'; pointer: PointerState; side: 'left' | 'right' }
  | { kind: 'pinching'; a: number; b: number; baseDist: number }
  | { kind: 'waitRelease' };

export class DeckGestures {
  private phase: Phase = { kind: 'idle' };
  private pointers = new Map<number, PointerState>();
  private pendingTap: { x: number; y: number; fireAt: number } | null = null;
  private readonly holdMs: number;
  private readonly tapMaxMovePx: number;
  private readonly doubleTapMs: number;

  constructor(
    private readonly config: GestureConfig,
    private readonly cb: GestureCallbacks,
  ) {
    this.holdMs = config.holdMs ?? 220;
    this.tapMaxMovePx = config.tapMaxMovePx ?? 12;
    this.doubleTapMs = config.doubleTapMs ?? 280;
  }

  pointerDown(id: number, x: number, y: number, t: number): void {
    const p: PointerState = { id, x, y, downX: x, downY: y, downT: t };
    this.pointers.set(id, p);

    if (this.phase.kind === 'idle' && this.pointers.size === 1) {
      this.phase = { kind: 'maybeTapOrHold', pointer: p };
      return;
    }
    if (
      (this.phase.kind === 'maybeTapOrHold' || this.phase.kind === 'holding') &&
      this.pointers.size === 2
    ) {
      if (this.phase.kind === 'holding') this.cb.onHoldEnd(this.phase.side);
      const [a, b] = [...this.pointers.values()];
      this.phase = { kind: 'pinching', a: a!.id, b: b!.id, baseDist: dist(a!, b!) };
      this.pendingTap = null;
      this.cb.onPinchStart();
      this.emitPinch();
    }
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    if (this.phase.kind === 'pinching') this.emitPinch();
    if (this.phase.kind === 'maybeTapOrHold' && this.phase.pointer.id === id) {
      // A big early move is neither tap nor hold: promote straight to hold so
      // dragging a thumb into position still lands on the pedal.
      if (this.moved(p) > this.tapMaxMovePx && t - p.downT >= this.holdMs) this.startHold(p);
    }
  }

  pointerUp(id: number, t: number): void {
    const p = this.pointers.get(id);
    this.pointers.delete(id);
    if (!p) return;

    switch (this.phase.kind) {
      case 'holding':
        if (this.phase.pointer.id === id) {
          this.cb.onHoldEnd(this.phase.side);
          this.phase = { kind: 'idle' };
        }
        break;
      case 'maybeTapOrHold':
        if (this.phase.pointer.id !== id) break;
        this.phase = { kind: 'idle' };
        if (t - p.downT < this.holdMs && this.moved(p) <= this.tapMaxMovePx) {
          if (this.pendingTap) {
            this.pendingTap = null;
            this.cb.onDoubleTap();
          } else {
            this.pendingTap = {
              x: p.downX / this.config.viewW,
              y: p.downY / this.config.viewH,
              fireAt: t + this.doubleTapMs,
            };
          }
        }
        break;
      case 'pinching':
        if (id === this.phase.a || id === this.phase.b) {
          this.cb.onPinchEnd();
          this.phase = this.pointers.size > 0 ? { kind: 'waitRelease' } : { kind: 'idle' };
        }
        break;
      case 'waitRelease':
        if (this.pointers.size === 0) this.phase = { kind: 'idle' };
        break;
      case 'idle':
        break;
    }
  }

  /** Drive from the frame loop; fires hold starts and deferred tap commits. */
  tick(t: number): void {
    if (this.phase.kind === 'maybeTapOrHold') {
      const p = this.phase.pointer;
      if (t - p.downT >= this.holdMs) this.startHold(p);
    }
    if (this.pendingTap && t >= this.pendingTap.fireAt) {
      const { x, y } = this.pendingTap;
      this.pendingTap = null;
      this.cb.onTap(x, y);
    }
  }

  cancel(): void {
    if (this.phase.kind === 'holding') this.cb.onHoldEnd(this.phase.side);
    if (this.phase.kind === 'pinching') this.cb.onPinchEnd();
    this.phase = { kind: 'idle' };
    this.pointers.clear();
    this.pendingTap = null;
  }

  private startHold(p: PointerState): void {
    const side = p.downX < this.config.viewW / 2 ? 'left' : 'right';
    this.phase = { kind: 'holding', pointer: p, side };
    this.cb.onHoldStart(side);
  }

  private moved(p: PointerState): number {
    return Math.hypot(p.x - p.downX, p.y - p.downY);
  }

  private emitPinch(): void {
    if (this.phase.kind !== 'pinching') return;
    const a = this.pointers.get(this.phase.a);
    const b = this.pointers.get(this.phase.b);
    if (!a || !b) return;
    this.cb.onPinch({
      mx: (a.x + b.x) / 2 / this.config.viewW,
      my: (a.y + b.y) / 2 / this.config.viewH,
      factor: dist(a, b) / this.phase.baseDist,
    });
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}
