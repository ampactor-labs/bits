// What the Shots room needs from the stage, kept out of Stage.tsx: the
// shots between the show's cuts, stills of how each opens, the framings on
// offer, and the recipe edits behind every button. Each edit is one commit,
// so one undo puts a moved or reframed cut back as it was.

import { useEffect, useMemo, useState } from 'react';
import { CAMERA_ID, type CameraPose } from '../../engine/camera';
import { createFramer } from '../../engine/frame';
import { PUPPET_DT } from '../../engine/puppet';
import { appendEvent, type CutEvent, type Project } from '../../engine/recipe';
import {
  closeOn,
  fitAll,
  nudge,
  sameFraming,
  shotsOf,
  WIDE,
  type Standing,
} from '../../engine/shots';
import { cutsOf, type ShowPuppet } from '../../engine/show';
import { stillsAt } from '../../media/poster';
import type { StageImages } from '../../media/stageDraw';
import type { Framing, ShotsRoomProps } from '../rooms/Shots';
import { newId } from './gestures';

export interface ShotsDeps {
  open: boolean;
  project: Project;
  durationS: number;
  onsets: number[];
  images: () => StageImages;
  /** The playhead. */
  clock: () => number;
  commit: (mutate: (p: Project) => Project) => void;
  seek: (t: number) => void;
  undoable: (message: string) => void;
  name: (p: ShowPuppet) => string;
}

/** A cut this close to another would open a shot nobody could see. */
const MIN_SHOT = 0.25;

/** Where the sheets stand at t, front sheets only: a backdrop is not
 *  something to frame. */
function standingAt(project: Project, t: number): Standing[] {
  const frame = createFramer(project).frameAt(t);
  return frame.layers
    .filter((l) => !l.puppet.back && l.pose)
    .map((l) => ({ x: l.pose!.root.x, y: l.pose!.root.y, puppet: l.puppet }));
}

export function useShots(d: ShotsDeps): Omit<ShotsRoomProps, 'onClose'> {
  const { open, project, durationS } = d;
  const shots = useMemo(() => shotsOf(cutsOf(project), durationS), [project, durationS]);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, shots.length - 1);
  const shot = shots[index]!;

  // Stills, redrawn whenever the shots change while the room is open.
  const [drawn, setDrawn] = useState<{ of: typeof shots; urls: string[] } | null>(null);
  const stills = drawn?.of === shots ? drawn.urls : shots.map(() => null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    // A hair into each shot: the cut has landed, nothing has moved yet.
    const times = shots.map((s) =>
      Math.min(s.from + PUPPET_DT * 2, Math.max(s.from, s.to - PUPPET_DT)),
    );
    void stillsAt(project, times, d.images(), project.aspect === '16:9' ? 240 : 120).then(
      (urls) => {
        if (live) setDrawn({ of: shots, urls });
      },
    );
    return () => {
      live = false;
    };
    // The images ref is read when drawing; it is not a reason to redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project, shots]);

  const framings = useMemo((): Framing[] => {
    if (!open) return [];
    const standing = standingAt(project, shot.from + PUPPET_DT * 2);
    const out: Framing[] = [{ id: 'wide', label: 'wide', pose: { ...WIDE } }];
    if (standing.length > 1) out.push({ id: 'all', label: 'everyone', pose: fitAll(standing) });
    for (const s of standing.slice(0, 6)) {
      out.push({
        id: `close:${s.puppet.id}`,
        label: d.name(s.puppet),
        close: true,
        pose: closeOn(s),
      });
    }
    // Two framings that come out the same are one choice.
    return out.filter((f, i) => out.findIndex((g) => sameFraming(g.pose, f.pose)) === i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project, shot.from]);

  const pose = shot.cut ?? WIDE;
  const current = framings.find((f) => sameFraming(f.pose, pose))?.id ?? null;

  const lo = index > 0 ? shots[index - 1]!.from : 0;
  const hi = shots[index + 1]?.from ?? durationS;
  const moveTo = (dir: -1 | 1) =>
    shot.cut && index > 0 ? nudge(d.onsets, shot.cut.at, dir, lo, hi) : null;

  /** Take a cut out and put one in, as one step: a cut is only a moment
   *  and a pose, so a moved or reframed cut is a new one. */
  const replace = (old: CutEvent | null, at: number, framing: CameraPose) =>
    d.commit((p) => {
      const cleared = old
        ? appendEvent(p, {
            kind: 'REMOVE',
            id: newId(),
            at: 0,
            puppetId: CAMERA_ID,
            target: { cut: old.id },
          })
        : p;
      return appendEvent(cleared, {
        kind: 'CUT',
        id: newId(),
        at,
        puppetId: CAMERA_ID,
        x: framing.x,
        y: framing.y,
        z: framing.z,
        rot: framing.rot,
        scale: framing.scale,
      });
    });

  const clock = Math.max(0, d.clock());
  const beat = d.onsets.find((o) => o >= clock && o - clock <= 0.3);
  const hereAt = beat ?? clock;
  const tooClose = shots.some((s) => Math.abs(s.from - hereAt) < MIN_SHOT);
  const cutHereAt = hereAt > 0 && hereAt < durationS - MIN_SHOT && !tooClose ? hereAt : null;

  return {
    shots,
    stills,
    aspect: project.aspect ?? '9:16',
    selected: index,
    framings,
    current,
    cutHereAt,
    canEarlier: moveTo(-1) !== null,
    canLater: moveTo(1) !== null,
    onSelect: (i) => {
      setSelected(i);
      d.seek(shots[i]!.from + PUPPET_DT * 2);
    },
    onFrame: (f) => {
      if (shot.cut) replace(shot.cut, shot.cut.at, f.pose);
      else if (!sameFraming(f.pose, WIDE)) replace(null, 0, f.pose);
      d.seek(shot.from + PUPPET_DT * 2);
    },
    onMove: (dir) => {
      const at = moveTo(dir);
      if (at === null || !shot.cut) return;
      replace(shot.cut, at, shot.cut);
      d.seek(at + PUPPET_DT * 2);
    },
    onTakeOut: () => {
      if (!shot.cut) return;
      const id = shot.cut.id;
      d.commit((p) =>
        appendEvent(p, {
          kind: 'REMOVE',
          id: newId(),
          at: 0,
          puppetId: CAMERA_ID,
          target: { cut: id },
        }),
      );
      d.undoable(index === 0 ? 'back to wide' : 'took that cut out');
      setSelected(Math.max(0, index - 1));
    },
    onCutHere: () => {
      if (cutHereAt === null) return;
      const inside = shots.filter((s) => s.from <= cutHereAt).pop() ?? shots[0]!;
      const standing = standingAt(project, cutHereAt);
      // A new shot that looked like the one before would be no cut at all:
      // out of a wide shot, go close on the first sheet; otherwise go wide.
      const wasWide = sameFraming(inside.cut ?? WIDE, WIDE);
      const next = wasWide && standing[0] ? closeOn(standing[0]) : { ...WIDE };
      replace(null, cutHereAt, next);
      setSelected(shots.filter((s) => s.from < cutHereAt).length);
      d.seek(cutHereAt + PUPPET_DT * 2);
    },
  };
}
