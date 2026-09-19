// Loaded only with ?e2e. Publishes window.__bits so the walkthrough can
// assert on recipe state rather than on pixels: what events a flow
// appended, in what order, and whether playback cost any React commits.

import { probe } from './probe';
import type { Project } from '../engine/recipe';

export interface BitsUxHooks {
  /** The stage's current project, or null when no stage is mounted. */
  project: () => Project | null;
  /** Event kinds in log order: the golden the stage split is judged against. */
  eventKinds: () => string[];
  /** Per-pass sample counts, so a refactor cannot quietly change recording. */
  passSampleCounts: () => number[];
  commits: () => number;
  resetCommits: () => void;
  /** The selected puppet, or null. */
  selectedId: () => string | null;
  /** Where each puppet actually is, so a tap can land on one. */
  poses: () => Record<string, { x: number; y: number }>;
  setOverride: <K extends keyof typeof probe.overrides>(
    key: K,
    value: (typeof probe.overrides)[K],
  ) => void;
}

declare global {
  interface Window {
    __bits?: BitsUxHooks;
  }
}

probe.enabled = true;

const current = (): Project | null => probe.project?.() ?? null;

const hooks: BitsUxHooks = {
  project: current,
  eventKinds: () => (current()?.events ?? []).map((e) => e.kind),
  passSampleCounts: () =>
    (current()?.events ?? [])
      .filter((e): e is Extract<typeof e, { kind: 'PASS' }> => e.kind === 'PASS')
      .map((e) => e.samples.length),
  commits: () => probe.commits,
  resetCommits: () => {
    probe.commits = 0;
  },
  selectedId: () => probe.stage?.().selectedId ?? null,
  poses: () => probe.stage?.().poses ?? {},
  setOverride: (key, value) => {
    probe.overrides[key] = value;
  },
};

// Query params let the harness set an override before the app boots.
const params = new URLSearchParams(location.search);
if (params.has('noavc')) probe.overrides.noAvc = true;
const cap = params.get('maxrec');
if (cap) probe.overrides.maxRecordSeconds = Number(cap);

window.__bits = hooks;
