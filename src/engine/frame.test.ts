import { describe, expect, it } from 'vitest';
import { fixtureAnalysis, fixtureProject } from '../e2e/fixtures';
import {
  createFramer,
  composeFrame,
  EMPTY_ANALYSIS,
  impactListener,
  visualsOf,
  voiceMap,
} from './frame';
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
    const ears = impactListener();
    const at = (k: number, squash: number) =>
      ears.onStep('a', k, { x: 0, y: 0, vx: 0, vy: 0, angle: 0, squash });
    at(0, 0.05);
    at(1, 0.3);
    at(2, 0.31);
    at(3, 0.0);
    at(4, 0.25);
    expect(ears.drain().map((i) => i.at)).toEqual([2 / 120, 5 / 120]);
    expect(ears.drain()).toEqual([]);
  });

  it('hears every step, so the frame rate cannot change what lands', () => {
    // Landings are a function of the per-step stream; it must be the same
    // whether the sim is asked for frames at 24, 30 or 60 per second.
    const project = fixtureProject();
    const stream = (fps: number) => {
      const seen: string[] = [];
      const sim = createShowSim(project, 0, undefined, (id, k, root) =>
        seen.push(`${id}:${k}:${root.squash}`),
      );
      for (let i = 0; i * (1 / fps) < 3; i++) sim.advanceTo((i + 0.5) / fps);
      sim.advanceTo(3.2);
      // Puppet by puppet, each in step order; how the puppets interleave
      // depends on how the time was asked for, and does not matter.
      return seen.sort();
    };
    const at30 = stream(30);
    expect(at30.length).toBeGreaterThan(1000);
    expect(stream(24)).toEqual(at30);
    expect(stream(60)).toEqual(at30);
  });
});
