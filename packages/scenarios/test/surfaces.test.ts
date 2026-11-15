// The surfaces of faces in the evaluation (D37, the preparatory step of D36): what a face is,
// exactly, published next to its name.
import type { EngineState, FaceName, Surface } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, cap, circle, newEngine, rectLoop, rectangle, run, side } from './kit';

const key = (name: FaceName): string => JSON.stringify(name);
const surfaceOf = (state: EngineState, name: FaceName): Surface | undefined => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => key(other) === key(name))];
const close = (values: number[]) => values.map((value) => expect.closeTo(value, 6));

// A plate 40 × 30 × 10 with a hole of radius 4 at (10, 10).
function plate() {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), circle('S1', 'h', 10, 10, 4), addExtrude('E1', 'S1', [rectLoop('r')], 10));
  return engine;
}

describe('surfaces of faces', () => {
  it('every face has a surface: planes for caps and sides from lines, a cylinder for a side from a circle', () => {
    const state = plate().getState();
    const { faceNames, faceSurfaces } = state.evaluation;
    expect(faceSurfaces).toHaveLength(faceNames.length);
    expect(surfaceOf(state, cap('E1', 'startCap'))).toEqual({ kind: 'plane', origin: close([0, 0, 0]), normal: close([0, 0, 1]) });
    expect(surfaceOf(state, cap('E1'))).toEqual({ kind: 'plane', origin: close([0, 0, 10]), normal: close([0, 0, 1]) });
    // the side from the bottom line of the rectangle lies in the plane y = 0
    const bottom = surfaceOf(state, side('E1', 'ra')) as Extract<Surface, { kind: 'plane' }>;
    expect(bottom.kind).toBe('plane');
    expect(Math.abs(bottom.normal[1])).toBeCloseTo(1, 6);
    expect(bottom.origin[1]).toBeCloseTo(0, 6);
    // the hole: a cylinder about the line through (10, 10) along Z
    const hole = surfaceOf(state, side('E1', 'h')) as Extract<Surface, { kind: 'cylinder' }>;
    expect(hole).toEqual({ kind: 'cylinder', origin: expect.anything(), axis: close([0, 0, 1]), radius: expect.closeTo(4, 6) });
    expect(hole.origin.slice(0, 2)).toEqual(close([10, 10]));
    // and it agrees with what a body says about its faces
    for (const face of state.evaluation.bodies.E1.faces) expect(faceSurfaces[face.id].kind === 'plane', key(faceNames[face.id])).toBe(face.planar);
  });

  it('the state after a feature has the faces up to it, and an unchanged face table is the same list', () => {
    const engine = plate();
    run(engine, addSketch('S2', { kind: 'face', body: 'E1', face: cap('E1') }), circle('S2', 'k', 30, 20, 3), addExtrude('E2', 'S2', [['k']], 5, 'add', 'E1'));
    const all = engine.getState();
    const early = engine.getState('E1');
    expect(early.evaluation.faceSurfaces.length).toBeLessThan(all.evaluation.faceSurfaces.length);
    expect(early.evaluation.faceSurfaces).toHaveLength(early.evaluation.faceNames.length);
    expect(surfaceOf(all, side('E2', 'k'))).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(3, 6) });
    expect(surfaceOf(early, side('E2', 'k'))).toBeUndefined();
    // asked twice without a change: the same list, so a caller can keep results by it
    expect(engine.getState().evaluation.faceSurfaces).toBe(all.evaluation.faceSurfaces);
    expect(engine.getState('E1').evaluation.faceSurfaces).toBe(early.evaluation.faceSurfaces);
  });

  it('gear teeth are a swept surface and a copy made by a pattern has its surface where the copy is', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S1', XY),
      circle('S1', 'c', 20, 0, 9),
      { type: 'addFeature', feature: { id: 'G', name: 'G', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'c' }, params: { teeth: 18 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
      addExtrude('D', 'S1', [['c']], 5),
      { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'D' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } },
    );
    const state = engine.getState();
    expect(surfaceOf(state, side('G', 'teeth'))).toEqual({ kind: 'swept', axis: close([0, 0, 1]) });
    // the disc at (20, 0) turned by half a circle about Z stands at (-20, 0)
    const copy = surfaceOf(state, { ...side('D', 'c'), copy: [{ pattern: 'P', index: 1 }] }) as Extract<Surface, { kind: 'cylinder' }>;
    expect(copy).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(9, 6) });
    expect(copy.origin.slice(0, 2)).toEqual(close([-20, 0]));
  });
});
