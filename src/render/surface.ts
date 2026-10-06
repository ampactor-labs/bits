// What the stage draws onto: the WebGL2 renderer where there is a real GPU,
// the canvas renderer everywhere else. A canvas keeps the first context it
// gives out, so the choice is made once per canvas element, on a probe
// canvas first. Software GL (SwiftShader, llvmpipe) is slower than Canvas2D
// for this, so it does not count as a GPU. `?renderer=gl` or `?renderer=2d`
// overrides, for testing either on any machine.

import type { Frame } from '../engine/frame';
import { createRenderer2d, type StageImages } from '../media/stageDraw';
import { createGlRenderer } from './gl/glRenderer';

export type RendererChoice = 'auto' | 'gl' | '2d';

export interface StageSurface {
  readonly kind: 'gl' | '2d';
  draw(W: number, H: number, frame: Frame, images: StageImages): void;
  reset(): void;
  /** True once a GL context is gone: the caller makes a fresh canvas and
   *  asks for 2d. */
  readonly lost: boolean;
  dispose(): void;
}

export function rendererFromUrl(search: string): RendererChoice {
  const v = new URLSearchParams(search).get('renderer');
  return v === 'gl' || v === '2d' ? v : 'auto';
}

/** Read once, when the app starts: the app rewrites its own URL (an
 *  opened inbox link, for one), and the choice should outlive that. */
export const STARTUP_RENDERER: RendererChoice =
  typeof location === 'undefined' ? 'auto' : rendererFromUrl(location.search);

/** True when this browser has a hardware WebGL2. */
export function hasGpu(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export function createSurface(canvas: HTMLCanvasElement, choice: RendererChoice): StageSurface {
  if (choice === 'gl' || (choice === 'auto' && hasGpu())) {
    const gl = createGlRenderer(canvas);
    if (gl) {
      return {
        kind: 'gl',
        draw: (W, H, frame, images) => gl.draw(W, H, frame, images),
        reset: () => gl.reset(),
        get lost() {
          return gl.lost;
        },
        dispose: () => gl.dispose(),
      };
    }
  }
  const renderer = createRenderer2d();
  return {
    kind: '2d',
    draw(W, H, frame, images) {
      const ctx = canvas.getContext('2d');
      if (ctx) renderer.draw(ctx, W, H, frame, images);
    },
    reset: () => renderer.reset(),
    lost: false,
    dispose() {},
  };
}
