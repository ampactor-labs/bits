// Feature handles: a mouth, a pair of eyes and each live pin, shown as
// something you can take hold of.
//
// They are pointer-events: none. The gesture layer on the stage frame owns
// every pointer and hit-tests these itself, because a handle that was its
// own target would swallow the first finger of a pinch.

import type { RefObject } from 'react';

export type HandleKind = 'mouth' | 'eyes' | 'pin';

export interface HandleSpec {
  key: string;
  kind: HandleKind;
  /** Pin slot, for pin handles. */
  index?: number;
}

export interface HandlesProps {
  handles: HandleSpec[];
  /** Stage positions these every frame; see layoutOverlays. */
  register: (key: string, el: HTMLDivElement | null) => void;
  /** The handle currently being dragged outside the puppet, which will be
   *  removed on release. */
  removingKey: string | null;
  layerRef: RefObject<HTMLDivElement | null>;
}

export function Handles({ handles, register, removingKey, layerRef }: HandlesProps) {
  return (
    <div ref={layerRef} className="handles" aria-hidden="true">
      {handles.map((h) => (
        <div
          key={h.key}
          ref={(el) => register(h.key, el)}
          className={`handle handle-${h.kind}${removingKey === h.key ? ' handle-removing' : ''}`}
        />
      ))}
    </div>
  );
}
