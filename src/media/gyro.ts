// The phone's tilt as a camera operator. Tipping the phone pans the shot,
// the way a window onto the stage would move if you leaned it, and the
// motion is recorded as an ordinary camera pass.
//
// iOS asks permission, and only inside a tap, so `askTilt` must be the
// first thing a click handler awaits.

/** Tilt this far either way covers this much of the stage. */
const DEGREES = 45;
const REACH = 0.3;

export function tiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

interface PermissionedOrientation {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export async function askTilt(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: PermissionedOrientation })
    .DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission !== 'function') return true;
  try {
    return (await D.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Calls back with how far the phone has tipped since the first reading,
 *  in stage units: right and down are positive. Returns the unsubscribe. */
export function watchTilt(onTilt: (dx: number, dy: number) => void): () => void {
  let zero: { gamma: number; beta: number } | null = null;
  const on = (e: DeviceOrientationEvent) => {
    if (e.gamma === null || e.beta === null) return;
    zero ??= { gamma: e.gamma, beta: e.beta };
    const clampDeg = (d: number) => Math.max(-DEGREES, Math.min(DEGREES, d));
    onTilt(
      (clampDeg(e.gamma - zero.gamma) / DEGREES) * REACH,
      (clampDeg(e.beta - zero.beta) / DEGREES) * REACH,
    );
  };
  window.addEventListener('deviceorientation', on);
  return () => window.removeEventListener('deviceorientation', on);
}
