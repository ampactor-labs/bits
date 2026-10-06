// The gesture layer: what a finger on the stage means, in every mode. It
// was a five-hundred-line effect inside Stage.tsx; it lives here so the
// stage can grow without that file growing with it, and so the camera is
// taught to it in one place.
//
// Everything a finger touches is found through the camera: a press is
// un-projected at each sheet's own depth before it is hit-tested, and a
// recorded pass stores the stage point under the finger, so a pass
// performed while the camera moves plays back where the finger was.

import type { RefObject } from 'react';
import { CAMERA_ID, REST_CAMERA, type CameraPose } from '../../engine/camera';
import { appendEvent, type CastEvent, type Project, type RemoveTarget } from '../../engine/recipe';
import {
  castOf,
  eyesOf,
  mouthOf,
  sameChannel,
  snipsOf,
  type Channel,
  type PuppetPose,
  type ShowPuppet,
} from '../../engine/show';
import type { PuppetVisual } from '../../engine/frame';
import type { Mode } from './machine';
import type { DoodleInk } from './DoodleBar';
import {
  DRAG_PX,
  stagePointAt,
  clamp01,
  handleAt as handleNear,
  hitTest as hitScene,
  normPoint,
  outsideBox,
  strokeNear,
  toLocal as localOf,
  type HandleKey,
  type StageScene,
} from './hit';

export interface Grab {
  puppetId: string;
  channel: Channel;
  samples: number[];
  /** The live target, in stage coords (or the prop's value in x). */
  x: number;
  y: number;
  /** The sheet's depth, so each move is un-projected where the sheet is. */
  depth: number;
}

export interface StagingDrag {
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
  /** The sheet's depth: the drag follows the finger through the camera. */
  depth: number;
  pinch: { baseDist: number; baseAngle: number; baseScale: number; baseRot: number } | null;
}

export interface HandleDrag {
  key: HandleKey;
  puppet: ShowPuppet;
  /** Live position in normalised stage coords. */
  x: number;
  y: number;
  /** True while the finger is far enough outside the puppet to remove it. */
  outside: boolean;
}

/** A camera take in progress: where the camera and the fingers were when
 *  it began, so a drag moves the world with the finger. */
interface CameraHold {
  pan: { pointerId: number; fx: number; fy: number; cx: number; cy: number } | null;
  twist: {
    pointerId: number;
    baseDist: number;
    baseAngle: number;
    z0: number;
    rot0: number;
  } | null;
}

export const newId = () => crypto.randomUUID().slice(0, 12);
export const LONG_PRESS_MS = 500;
/** Keys for the two prop grabs a twist opens, beside the pointer-keyed
 *  finger grabs, so neither can collide with a real pointer id. */
const Z_KEY = -1;
const ROLL_KEY = -2;
/** How far a dolly can go: past 1.5 the stage plane is nearly at the
 *  lens, and pulling back further than 2 shrinks the stage to a stamp. */
const DOLLY_MIN = -2;
const DOLLY_MAX = 1.5;

const vibrate = (ms: number) => navigator.vibrate?.(ms);

/** Everything the gesture layer reads and writes. Refs, because the
 *  handlers outlive any one render. */
export interface GestureDeps {
  frame: HTMLDivElement;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  projectRef: RefObject<Project>;
  modeRef: RefObject<Mode>;
  lastPosesRef: RefObject<Map<string, PuppetPose>>;
  /** Where the camera was in the last frame drawn; null at rest. */
  lastCameraRef: RefObject<CameraPose | null>;
  /** True while the camera, not a sheet, is in hand. */
  cameraArmedRef: RefObject<boolean>;
  visualsRef: RefObject<Map<string, PuppetVisual>>;
  selectedIdRef: RefObject<string | null>;
  handlePxRef: RefObject<Map<string, { x: number; y: number }>>;
  longPressRef: { current: ReturnType<typeof setTimeout> | null };
  grabsRef: RefObject<Map<number, Grab>>;
  stagingRef: { current: StagingDrag | null };
  handleDragRef: { current: HandleDrag | null };
  pointerDownRef: { current: boolean };
  dirtyRef: { current: boolean };
  erasingRef: RefObject<boolean>;
  strokeRef: RefObject<number[][]>;
  inkRef: RefObject<DoodleInk[]>;
  inkNowRef: RefObject<DoodleInk>;
  snipStrokeRef: { current: { x0: number; y0: number; x1: number; y1: number } | null };
  bannerRef: RefObject<{ hint: (text: string) => void; clear: () => void }>;
  toastRef: RefObject<{ undoable: (text: string, undo: () => void) => void }>;
  undoRef: RefObject<() => void>;
  commitOneGrabRef: RefObject<(grab: Grab) => void>;
  commit: (change: (p: Project) => Project) => void;
  currentClock: () => number;
  setModeBoth: (m: Mode) => void;
  setSelectedId: (id: string | null) => void;
  setPointerDown: (down: boolean) => void;
  setRemovingKey: (key: string | null) => void;
  setStrokeCount: (n: number) => void;
}

/** Wires the stage's pointer handlers onto the frame; returns the undo. */
export function installGestures(g: GestureDeps): () => void {
  const {
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
  } = g;
  let cameraHold: CameraHold = { pan: null, twist: null };
  // Travel is tracked in client pixels: the normalised measure the tap
  // threshold used to share gave nearly twice the slop vertically as
  // horizontally on a 9:16 stage.
  const pointers = new Map<
    number,
    { x: number; y: number; cx: number; cy: number; movedPx: number }
  >();
  /** Set when a press lands on bare stage, so the release can deselect. */
  let downOnNothing = false;
  /** When the current press began, to tell a tap from a long press. */
  let pressedAt = 0;

  /** What the finger is aiming at, this frame. */
  const scene = (): StageScene => ({
    project: projectRef.current,
    poses: lastPosesRef.current,
    visuals: visualsRef.current,
    camera: { pose: lastCameraRef.current, W: frame.clientWidth, H: frame.clientHeight },
  });
  const norm = (e: PointerEvent) =>
    normPoint(frame.getBoundingClientRect(), e.clientX, e.clientY);
  /** The stage point under a screen point, on a sheet at this depth. */
  const onSheet = (p: { depth: number }, x: number, y: number) =>
    stagePointAt(scene(), p.depth, x, y);
  /** Stage coords to the puppet's own box. */
  const toLocal = (p: ShowPuppet, x: number, y: number) =>
    localOf(lastPosesRef.current, p, x, y);
  /** Screen coords to the puppet's own box, through the camera. */
  const localAt = (p: ShowPuppet, x: number, y: number) => {
    const s = onSheet(p, x, y);
    return toLocal(p, s.x, s.y);
  };
  // The selected backdrop can be grabbed like anything else; an
  // unselected one is the floor, and a press on it is a press on nothing.
  const hitTest = (x: number, y: number) =>
    hitScene(scene(), x, y, { back: (p) => p.id === selectedIdRef.current });
  const backdropAt = (x: number, y: number) =>
    hitScene(scene(), x, y, { back: () => true })?.puppet ?? null;
  const handleAt = (e: PointerEvent): HandleKey | null => {
    if (!selectedIdRef.current) return null;
    const r = frame.getBoundingClientRect();
    return handleNear(handlePxRef.current, e.clientX - r.left, e.clientY - r.top);
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

  // The camera in hand. One finger pans: the world follows it, as a map
  // does. A second finger dollies (spread to push in) and rolls (twist).
  // Each is its own pass, so each can be muted, trimmed or taken out.
  const cameraNow = (): CameraPose => lastCameraRef.current ?? REST_CAMERA;
  const openCameraGrab = (key: number, channel: Channel, x: number, y: number) => {
    const clock = Math.max(0, currentClock());
    grabsRef.current.set(key, {
      puppetId: CAMERA_ID,
      channel,
      samples: [clock, x, y],
      x,
      y,
      depth: 0,
    });
  };
  const pushSample = (grab: Grab, x: number, y: number) => {
    const clock = Math.max(0, currentClock());
    const lastT = grab.samples[grab.samples.length - 3]!;
    if (clock - lastT >= 1 / 60) grab.samples.push(clock, x, y);
    grab.x = x;
    grab.y = y;
  };
  const cameraDown = (pointerId: number, x: number, y: number) => {
    const cam = cameraNow();
    if (!cameraHold.pan) {
      cameraHold.pan = { pointerId, fx: x, fy: y, cx: cam.x, cy: cam.y };
      openCameraGrab(pointerId, null, cam.x, cam.y);
      return;
    }
    if (cameraHold.twist) return;
    const first = pointers.get(cameraHold.pan.pointerId);
    if (!first) return;
    cameraHold.twist = {
      pointerId,
      baseDist: Math.hypot(x - first.x, y - first.y) || 0.01,
      baseAngle: Math.atan2(y - first.y, x - first.x),
      z0: cam.z,
      rot0: cam.rot,
    };
    openCameraGrab(Z_KEY, { prop: 'z' }, cam.z, 0);
    openCameraGrab(ROLL_KEY, { prop: 'rot' }, cam.rot, 0);
  };
  const cameraMove = (pointerId: number, x: number, y: number) => {
    const { pan, twist } = cameraHold;
    if (twist) {
      // Two fingers: the pan holds where it was and the pair dollies and
      // rolls, whichever finger moved.
      const a = pan && pointers.get(pan.pointerId);
      const b = pointers.get(twist.pointerId);
      if (!a || !b) return;
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const z = Math.min(DOLLY_MAX, Math.max(DOLLY_MIN, twist.z0 + (dist / twist.baseDist - 1) * 1.2));
      const zGrab = grabsRef.current.get(Z_KEY);
      const rollGrab = grabsRef.current.get(ROLL_KEY);
      if (zGrab) pushSample(zGrab, z, 0);
      if (rollGrab) pushSample(rollGrab, twist.rot0 + (angle - twist.baseAngle), 0);
      return;
    }
    if (pan && pointerId === pan.pointerId) {
      const grab = grabsRef.current.get(pointerId);
      if (grab) pushSample(grab, pan.cx - (x - pan.fx), pan.cy - (y - pan.fy));
    }
  };
  /** Closes whatever this finger was holding of the camera; false when it
   *  held none of it. */
  const cameraUp = (pointerId: number): boolean => {
    const { pan, twist } = cameraHold;
    const close = (key: number, onlyIfMoved: boolean) => {
      const grab = grabsRef.current.get(key);
      if (!grab) return;
      grabsRef.current.delete(key);
      // A pinch that never twisted records no roll, and the other way
      // round: an unmoved prop pass would only clutter the lanes.
      const s = grab.samples;
      const moved = s.some((v, i) => i % 3 === 1 && Math.abs(v - s[1]!) > 1e-3);
      if (onlyIfMoved && !moved) return;
      commitOneGrabRef.current(grab);
    };
    if (twist && (pointerId === twist.pointerId || pointerId === pan?.pointerId)) {
      close(Z_KEY, true);
      close(ROLL_KEY, true);
      cameraHold.twist = null;
      if (pointerId === twist.pointerId) return true;
    }
    if (pan && pointerId === pan.pointerId) {
      close(pointerId, false);
      cameraHold = { pan: null, twist: null };
      return true;
    }
    return false;
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
    const local = localAt(puppet, x, y);
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
    // A first finger starts every gesture afresh, whatever a take that
    // stopped under a held finger left behind.
    if (pointers.size === 1) cameraHold = { pan: null, twist: null };
    const m = modeRef.current;

    if (m === 'doodling') {
      if (erasingRef.current) {
        const hit = strokeNear(strokeRef.current, x, y);
        if (hit >= 0) {
          strokeRef.current.splice(hit, 1);
          inkRef.current.splice(hit, 1);
          setStrokeCount(strokeRef.current.length);
          vibrate(10);
          dirtyRef.current = true;
        }
        return;
      }
      strokeRef.current.push([x, y]);
      inkRef.current.push(inkNowRef.current);
      setStrokeCount(strokeRef.current.length);
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
          const local = localAt(puppet, x, y);
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
    if (m === 'recording' && cameraArmedRef.current) {
      cameraDown(e.pointerId, x, y);
      return;
    }
    if (m === 'recording') {
      const hit = hitTest(x, y);
      // One finger per channel: two hands on the same puppet would
      // record two passes fighting over it.
      const taken = [...grabsRef.current.values()].some(
        (g) => hit && g.puppetId === hit.puppet.id && sameChannel(g.channel, hit.channel),
      );
      if (hit && !taken) {
        const clock = Math.max(0, currentClock());
        const at = onSheet(hit.puppet, x, y);
        grabsRef.current.set(e.pointerId, {
          puppetId: hit.puppet.id,
          channel: hit.channel,
          samples: [clock, at.x, at.y],
          x: at.x,
          y: at.y,
          depth: hit.puppet.depth,
        });
      }
      return;
    }
    if (m === 'idle' && cameraArmedRef.current) {
      // The camera is performed, not placed: it only moves while a take
      // is rolling, so a stray drag can never knock the shot.
      bannerRef.current.hint('press record, then drag to move the camera.');
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
          handleDragRef.current = { key, puppet, ...onSheet(puppet, x, y), outside: false };
          clearLongPress();
          dirtyRef.current = true;
          return;
        }
      }

      const hit = hitTest(x, y);
      if (!hit) {
        // A press on bare stage puts the tools away on release. Held
        // long, it picks up the backdrop under it, if there is one.
        downOnNothing = pointers.size === 1;
        const under = backdropAt(x, y);
        if (under && downOnNothing) {
          clearLongPress();
          longPressRef.current = setTimeout(() => {
            downOnNothing = false;
            setSelectedId(under.id);
            vibrate(10);
            dirtyRef.current = true;
          }, LONG_PRESS_MS);
        }
        return;
      }
      downOnNothing = false;
      pressedAt = performance.now();
      const at = onSheet(hit.puppet, x, y);
      stagingRef.current = {
        puppetId: hit.puppet.id,
        x: hit.puppet.home.x,
        y: hit.puppet.home.y,
        scale: hit.puppet.home.scale,
        rot: hit.puppet.home.rot,
        // Grab offset, so the puppet travels with the finger instead of
        // jumping its centre under it on the first move.
        dx: hit.puppet.home.x - at.x,
        dy: hit.puppet.home.y - at.y,
        depth: hit.puppet.depth,
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
      if (erasingRef.current) return;
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
    if (m === 'recording' && (cameraHold.pan || cameraHold.twist)) {
      cameraMove(e.pointerId, x, y);
      return;
    }
    if (m === 'recording') {
      const grab = grabsRef.current.get(e.pointerId);
      if (!grab) return;
      // Where the finger is on the sheet now, through the camera as it is
      // now: the camera may be moving under the finger.
      const at = onSheet(grab, x, y);
      const clock = Math.max(0, currentClock());
      const lastT = grab.samples[grab.samples.length - 3]!;
      if (clock - lastT >= 1 / 60) grab.samples.push(clock, at.x, at.y);
      grab.x = at.x;
      grab.y = at.y;
      return;
    }
    if (m === 'idle' && handleDragRef.current) {
      const drag = handleDragRef.current;
      const at = onSheet(drag.puppet, x, y);
      drag.x = at.x;
      drag.y = at.y;
      const outside = outsideBox(toLocal(drag.puppet, at.x, at.y));
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
        const at = onSheet(staging, x, y);
        staging.x = at.x + staging.dx;
        staging.y = at.y + staging.dy;
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
      // Wake the halo only after this release's click has gone by. A
      // long press can raise the halo under the very finger that is
      // still down (a backdrop's halo docks where the finger often is),
      // and the click that follows the lift would fire whatever button
      // it lands on.
      setTimeout(() => {
        if (!pointerDownRef.current) setPointerDown(false);
      }, 0);
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
        const a = localAt(puppet, s.x0, s.y0);
        const b = localAt(puppet, s.x1, s.y1);
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
    if (m === 'recording' && cameraUp(e.pointerId)) return;
    if (m === 'recording') {
      // Only this finger's pass closes. The other hand keeps performing.
      const grab = grabsRef.current.get(e.pointerId);
      if (grab) {
        grabsRef.current.delete(e.pointerId);
        commitOneGrabRef.current(grab);
      }
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
        // A selected backdrop covers the whole stage, so there is no bare
        // stage left to tap: a quick tap on it puts it down instead.
        const quick = performance.now() - pressedAt < LONG_PRESS_MS;
        if (existing?.back && quick) setSelectedId(null);
        else if (existing) setSelectedId(existing.id);
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
          ...(existing.depth !== 0 ? { depth: existing.depth } : {}),
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
}
