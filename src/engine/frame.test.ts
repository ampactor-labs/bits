import { describe, expect, it } from 'vitest';
import { fixtureAnalysis, fixtureProject } from '../e2e/fixtures';
import { createFramer, composeFrame, EMPTY_ANALYSIS, impactsOf, visualsOf, voiceMap } from './frame';
import { castOf, createShowSim } from './show';
import { effectiveWires, trailStrength, wireModsFor } from './wires';

describe('frame builder', () => {
  it('assembles exactly what the hand-built path did, frame after frame', () => {
    const project = fixtureProject();
    const analysis = fixtureAnalysis();
    const framer = createFramer(project, analysis);
    const sim = createShowSim(project);
    const cast = castOf(project);
    const visuals = visualsOf(project);
    const wires = effectiveWires(project);
    for (let i = 0; i < 60; i++) {
      const t = 0.033 + i * 0.066;
      const frame = framer.frameAt(t);
      const poses = sim.advanceTo(t);
      const voices = voiceMap(project, visuals, analysis.voice, t, analysis.voices);
      expect(frame.layers.map((l) => l.puppet.id)).toEqual(cast.map((p) => p.id));
      expect(frame.trail).toBe(trailStrength(wires, analysis.voice, analysis.onsets, t));
      for (const layer of frame.layers) {
        const id = layer.puppet.id;
        expect(layer.pose).toEqual(poses.get(id));
        expect(layer.mods).toEqual(
          wireModsFor(wires, id, analysis.voice, analysis.onsets, t, project.seed),
        );
        expect(layer.voice).toEqual(voices.get(id) ?? { open: 0, shape: 0 });
      }
    }
  });

  it('draws idle stills clean', () => {
    const project = fixtureProject();
    const frame = composeFrame({
      project,
      cast: castOf(project),
      visuals: visualsOf(project),
      wires: effectiveWires(project),
      analysis: fixtureAnalysis(),
      poses: createShowSim(project).advanceTo(1),
      t: 1,
      trails: false,
    });
    expect(frame.trail).toBe(0);
  });

  it('keeps mouths shut without a sound to read', () => {
    const framer = createFramer(fixtureProject(), EMPTY_ANALYSIS);
    const frame = framer.frameAt(1.5);
    expect(frame.layers.every((l) => l.voice.open === 0)).toBe(true);
  });

  it('hears a landing once, on the way up through the line', () => {
    const prev = new Map<string, number>();
    const pose = (squash: number) =>
      new Map([['a', { root: { x: 0, y: 0, vx: 0, vy: 0, angle: 0, squash }, dangles: [], pins: [] }]]);
    expect(impactsOf(prev, pose(0.05))).toEqual([]);
    expect(impactsOf(prev, pose(0.3))).toEqual(['a']);
    expect(impactsOf(prev, pose(0.31))).toEqual([]);
    expect(impactsOf(prev, pose(0.0))).toEqual([]);
    expect(impactsOf(prev, pose(0.25))).toEqual(['a']);
  });
});
