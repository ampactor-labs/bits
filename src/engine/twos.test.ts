import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../e2e/fixtures';
import { createShowSim } from './show';
import type { Project } from './recipe';

/** The fixture with the walking guy put on twos. */
function onTwos(): Project {
  const base = fixtureProject();
  return {
    ...base,
    events: base.events.map((e) =>
      e.kind === 'CAST' && e.puppetId === 'guy' ? { ...e, puppet: { ...e.puppet, spring: 'twos' as const } } : e,
    ),
  };
}

describe('on twos', () => {
  it('holds a pose for a twelfth of a second, then jumps to the next', () => {
    const sim = createShowSim(onTwos());
    const seen: number[] = [];
    for (let k = 1; k <= 120; k++) seen.push(sim.advanceTo(0.4 + k / 120).get('guy')!.root.x);
    // Ten sim steps per held pose: no more distinct positions than twelfths.
    const changes = seen.filter((x, i) => i > 0 && x !== seen[i - 1]).length;
    expect(changes).toBeGreaterThan(6);
    expect(changes).toBeLessThanOrEqual(12);
  });

  it('runs the felt spring underneath, so it lands where felt lands', () => {
    const felt = fixtureProject();
    const a = createShowSim(felt).advanceTo(2.5).get('guy')!.root;
    const b = createShowSim(onTwos()).advanceTo(2.5).get('guy')!.root;
    // 2.5 s is a twelfth-of-a-second boundary: the held pose is the live one.
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });

  it('seeks from a checkpoint to the same held pose', () => {
    const p = onTwos();
    createShowSim(p).advanceTo(3.5);
    for (const t of [1.04, 2.37, 3.31]) {
      const fresh = createShowSim(p).advanceTo(t).get('guy');
      const resumed = createShowSim(p, 0, undefined, undefined, { resumeAt: t }).advanceTo(t).get('guy');
      expect(resumed).toEqual(fresh);
    }
  });
});
