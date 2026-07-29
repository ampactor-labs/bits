import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckGestures, type GestureCallbacks } from './deckGestures';

// No annotation: inference keeps the vi.fn Mock types; DeckGestures accepts it
// structurally as GestureCallbacks.
const cb = () => ({
  onTap: vi.fn(),
  onDoubleTap: vi.fn(),
  onHoldStart: vi.fn(),
  onHoldEnd: vi.fn(),
  onPinchStart: vi.fn(),
  onPinch: vi.fn(),
  onPinchEnd: vi.fn(),
}) satisfies GestureCallbacks;

const VIEW = { viewW: 400, viewH: 800 };

describe('DeckGestures', () => {
  let calls: ReturnType<typeof cb>;
  let g: DeckGestures;

  beforeEach(() => {
    calls = cb();
    g = new DeckGestures(VIEW, calls);
  });

  it('commits a tap after the double-tap window closes', () => {
    g.pointerDown(1, 100, 400, 0);
    g.pointerUp(1, 80);
    g.tick(200);
    expect(calls.onTap).not.toHaveBeenCalled();
    g.tick(400);
    expect(calls.onTap).toHaveBeenCalledWith(0.25, 0.5);
  });

  it('turns two quick taps into a double-tap with no stray tap', () => {
    g.pointerDown(1, 100, 400, 0);
    g.pointerUp(1, 60);
    g.pointerDown(1, 104, 402, 180);
    g.pointerUp(1, 240);
    g.tick(1000);
    expect(calls.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(calls.onTap).not.toHaveBeenCalled();
  });

  it('fires left hold via tick and ends it on release', () => {
    g.pointerDown(1, 50, 400, 0);
    g.tick(100);
    expect(calls.onHoldStart).not.toHaveBeenCalled();
    g.tick(230);
    expect(calls.onHoldStart).toHaveBeenCalledWith('left');
    g.pointerUp(1, 500);
    expect(calls.onHoldEnd).toHaveBeenCalledWith('left');
  });

  it('sides the hold by the down position', () => {
    g.pointerDown(1, 350, 400, 0);
    g.tick(230);
    expect(calls.onHoldStart).toHaveBeenCalledWith('right');
  });

  it('a moved finger never taps', () => {
    g.pointerDown(1, 100, 400, 0);
    g.pointerMove(1, 160, 400, 50);
    g.pointerUp(1, 80);
    g.tick(1000);
    expect(calls.onTap).not.toHaveBeenCalled();
  });

  it('second finger ends an active hold and starts a pinch', () => {
    g.pointerDown(1, 50, 400, 0);
    g.tick(230);
    expect(calls.onHoldStart).toHaveBeenCalledWith('left');
    g.pointerDown(2, 250, 400, 300);
    expect(calls.onHoldEnd).toHaveBeenCalledWith('left');
    expect(calls.onPinchStart).toHaveBeenCalledTimes(1);
  });

  it('reports pinch scale relative to start and midpoint in view coords', () => {
    g.pointerDown(1, 100, 400, 0);
    g.pointerDown(2, 300, 400, 50);
    calls.onPinch.mockClear();
    g.pointerMove(1, 0, 400, 100);
    g.pointerMove(2, 400, 400, 100);
    const last = calls.onPinch.mock.calls.at(-1)![0] as { mx: number; my: number; factor: number };
    expect(last.factor).toBeCloseTo(2);
    expect(last.mx).toBeCloseTo(0.5);
    expect(last.my).toBeCloseTo(0.5);
  });

  it('lifting one pinch finger ends the pinch and ignores the survivor', () => {
    g.pointerDown(1, 100, 400, 0);
    g.pointerDown(2, 300, 400, 0);
    g.pointerUp(1, 100);
    expect(calls.onPinchEnd).toHaveBeenCalledTimes(1);
    g.pointerMove(2, 350, 400, 150);
    g.pointerUp(2, 200);
    g.tick(1000);
    expect(calls.onTap).not.toHaveBeenCalled();
    expect(calls.onHoldStart).not.toHaveBeenCalled();
  });

  it('cancel ends whatever is active', () => {
    g.pointerDown(1, 50, 400, 0);
    g.tick(230);
    g.cancel();
    expect(calls.onHoldEnd).toHaveBeenCalledWith('left');
  });
});
