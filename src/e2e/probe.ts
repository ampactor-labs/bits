// A hairline seam the test harness can reach through. Always present, but
// inert unless the harness turns it on, so production pays for a boolean.
//
// It exists because the render proof never loads the stage: that harness
// imports engine and media modules and calls renderShow directly, so it
// cannot see a UI regression at all. The walkthrough can, through this.

import type { Project } from '../engine/recipe';

export interface Probe {
  /** Off in production. The harness sets it before driving the app. */
  enabled: boolean;
  /** Registered by the stage while it is mounted. */
  project: (() => Project) | null;
  /** React commits of the stage; playback must not move this. */
  commits: number;
  /** Test-only behaviour overrides, read where they are honoured. */
  overrides: {
    /** Force canEncodeVideo to report false, to exercise the failure path. */
    noAvc?: boolean;
    /** Shorten the mic length cap so the test does not wait for it. */
    maxRecordSeconds?: number;
  };
}

export const probe: Probe = {
  enabled: false,
  project: null,
  commits: 0,
  overrides: {},
};

/** Counted only while the harness is watching. */
export function countCommit(): void {
  if (probe.enabled) probe.commits += 1;
}
