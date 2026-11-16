// D45 (package 2b of D36) in the recompute, against the real adapters: the taper of an extrusion,
// its surfaces (tilted planes and cones), the edges of a cone, sketches on a tilted side,
// a pattern of a tapered cut and the refusals.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, FaceName, Id, Input, Surface } from '@trymesh/engine';
import { XY, addSketch, batch, cap, circle, expectAllOk, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, volume } from './kit';

type Profile = Input<ExtrudeFeature>['profile'];
type Extent = Input<ExtrudeFeature>['extent'];
const feature = (id: Id, profile: Profile, extent: Extent, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) },
});
const regions = (sketch: Id, loops: Id[][], offset?: number): Profile => ({ type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset === undefined ? {} : { offset }) });
const tapered = (distance: number, taper: number | string, start = 0): Extent => ({ type: 'distance', start, distance, taper });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const surface = (state: EngineState, name: FaceName): Surface => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name))];
const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
const deg = (angle: number): number => (angle * Math.PI) / 180;
// The number of sides of a circle of the radius at the chord tolerance 0.01 (`segments` of sketch.ts).
const sides = (radius: number): number => Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / radius)) - 1e-9);
// A frustum over a regular polygon inscribed in circles of the radii r0 and r1, n sides, height h.
const frustum = (n: number, r0: number, r1: number, h: number): number => ((n / 2) * Math.sin((2 * Math.PI) / n) * h * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;

// A sketch S1 with a rectangle `r` 40 × 30 at the origin; a sketch S2 with the same rectangle `q`
// and a circle `k` of radius 4 in its middle (the region of `q` has the hole `k`); a sketch C1 with
// a lone circle `o` of radius 10 at (100, 0).
function plate(): Engine {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), addSketch('S2', XY), rectangle('S2', 'q', 0, 0, 40, 30), circle('S2', 'k', 20, 15, 4), addSketch('C1', XY), circle('C1', 'o', 100, 0, 10));
  return engine;
}

describe('a taper on an extrusion', () => {
  it('a tapered box and a frustum have the volumes of their formulas', () => {
    const engine = plate();
    const k = Math.tan(deg(10));
    const state = run(engine, feature('A', regions('S1', [rectLoop('r')]), tapered(10, 'deg(-10)')), feature('F', regions('C1', [['o']]), tapered(-8, 'deg(20)')));
    expectAllOk(state);
    // the rectangle narrows by k on every side for every unit of height
    const h = 10;
    near(volumeOf(state, 'A'), 1200 * h - 2 * k * 70 * h * h / 2 + (4 * k * k * h * h * h) / 3);
    // the circle widens downwards: radius 10 at the sketch, 10 + 8 tan 20° at the far end; one count for both rings
    const r1 = 10 + 8 * Math.tan(deg(20));
    near(volumeOf(state, 'F'), frustum(sides(r1), 10, r1, 8), 1e-2);
    expect(faceNames(state, 'A')).toEqual(['A/endCap', 'A/side/ra', 'A/side/rb', 'A/side/rc', 'A/side/rd', 'A/startCap']);
    expect(faceNames(state, 'F')).toEqual(['F/endCap', 'F/side/o', 'F/startCap']);
  });

  it('the side of a line is a tilted plane, the side of a circle a cone with its apex on the axis', () => {
    const engine = plate();
    const state = run(engine, feature('A', regions('S2', [rectLoop('q')]), tapered(10, 'deg(-10)')), feature('U', regions('C1', [['o']]), tapered(10, 'deg(30)')), feature('D', regions('C1', [['o']]), tapered(-10, 'deg(30)')), feature('N', regions('C1', [['o']]), tapered(10, 'deg(-30)')));
    expectAllOk(state);
    // the bottom side `ra` leans inwards (+y) going up: its normal has the parts −cos 10° in y and sin 10° in z
    const bottom = surface(state, side('A', 'qa'));
    expect(bottom.kind).toBe('plane');
    const normal = (bottom as Extract<Surface, { kind: 'plane' }>).normal;
    near(Math.abs(normal[1]), Math.cos(deg(10)), 1e-9);
    near(Math.abs(normal[2]), Math.sin(deg(10)), 1e-9);
    expect(Math.sign(normal[1] * normal[2])).toBe(-1);
    // the hole `k` of the rectangle grows going up (a negative taper narrows the material): a cone opening upwards
    const hole = surface(state, side('A', 'k')) as Extract<Surface, { kind: 'cone' }>;
    expect(hole.kind).toBe('cone');
    near(hole.halfAngle, deg(10), 1e-12);
    expect(hole.axis).toEqual([0, 0, 1]);
    near(hole.apex[2], -4 / Math.tan(deg(10)), 1e-6);
    expect(hole.apex.slice(0, 2).map((value) => Math.round(value * 1e9) / 1e9)).toEqual([20, 15]);
    // a widening cone up, a widening cone down, a narrowing cone up
    const cone = (id: Id) => surface(state, side(id, 'o')) as Extract<Surface, { kind: 'cone' }>;
    const apex = 10 / Math.tan(deg(30));
    expect(cone('U')).toMatchObject({ kind: 'cone', axis: [0, 0, 1], halfAngle: expect.closeTo(deg(30), 12) });
    near(cone('U').apex[2], -apex, 1e-6);
    expect(cone('D')).toMatchObject({ kind: 'cone', axis: [0, 0, -1] });
    near(cone('D').apex[2], apex, 1e-6);
    expect(cone('N')).toMatchObject({ kind: 'cone', axis: [0, 0, -1] });
    near(cone('N').apex[2], apex, 1e-6);
    expect(cone('N').apex.slice(0, 2).map((value) => Math.round(value * 1e9) / 1e9)).toEqual([100, 0]);
    // the caps are planes and the rims of the cone are circles, of the radii at the two ends
    const rims = state.evaluation.bodies.U.edges.filter((edge) => edge.name.a.role === 'side' || edge.name.b.role === 'side');
    expect(rims.map((edge) => edge.kind)).toEqual(['circle', 'circle']);
  });

  it('a sketch stands on a tilted side; its origin is the start of the line where the plane meets the sketch plane', () => {
    const engine = plate();
    run(engine, feature('A', regions('S1', [rectLoop('r')]), tapered(10, 0, 0)), addSketch('W', onFace('A', side('A', 'ra'))));
    const straight = engine.getState().evaluation.features.W.plane;
    expect(straight?.origin).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), 0]);
    // a taper with the start at zero moves no sketch: the origin stays where it was
    const leaning = run(engine, { type: 'setField', feature: 'A', path: 'extent/taper', value: 'deg(-10)' });
    expectAllOk(leaning);
    const frame = leaning.evaluation.features.W.plane;
    expect(frame?.origin.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([0, 0, 0]);
    // the sketch plane leans with the face: its y runs up the face, its normal outwards and down
    near(frame?.y[1] ?? 0, Math.sin(deg(10)), 1e-9);
    near(frame?.y[2] ?? 0, Math.cos(deg(10)), 1e-9);
    expect(frame?.normal[1]).toBeLessThan(0);
    // with a start of 2 the line at the start holds; the plane continued down meets the sketch plane 2 tan 10° further out
    const raised = run(engine, { type: 'updateFeature', id: 'A', patch: { extent: { start: 2 } } });
    expectAllOk(raised);
    const origin = raised.evaluation.features.W.plane?.origin ?? [NaN, NaN, NaN];
    near(origin[1], -2 * Math.tan(deg(10)), 1e-9);
    near(origin[2], 0, 1e-12);
    // a hole in the tilted side cuts the box
    const cut = run(engine, circle('W', 'h', 20, 4, 1), feature('H', regions('W', [['h']]), { type: 'distance', start: 0, distance: -2 }, 'cut', ['A']));
    expectAllOk(cut);
    expect(volumeOf(cut, 'A')).toBeLessThan(volumeOf(raised, 'A'));
  });

  it('a taper of zero builds the prism of today, triangle for triangle', () => {
    const engine = plate();
    const state = run(engine, feature('A', regions('S2', [rectLoop('q')]), tapered(10, 0)), feature('B', regions('S2', [rectLoop('q')]), { type: 'distance', start: 0, distance: 10 }));
    const [a, b] = [state.evaluation.bodies.A.solid, state.evaluation.bodies.B.solid];
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.triangles)).toEqual(Array.from(b.triangles));
    expect(surface(state, side('A', 'k')).kind).toBe('cylinder');
  });

  it('a pattern repeats a tapered cut, each copy with its cone', () => {
    const engine = plate();
    run(
      engine,
      feature('A', regions('S1', [rectLoop('r')]), { type: 'distance', start: 0, distance: 10 }),
      addSketch('T', onFace('A', cap('A'))),
      circle('T', 'h', 8, 8, 3),
      feature('H', regions('T', [['h']]), tapered(-2, 'deg(-45)'), 'cut', ['A']),
    );
    const one = volumeOf(engine.getState(), 'A');
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['H'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'S2', point: 'kc' }, count: 2, span: { type: 'full' } } },
    });
    expectAllOk(state);
    near(volumeOf(state, 'A'), 12000 - 2 * (12000 - one), 1e-2);
    const copy: FaceName = { feature: 'H', role: 'side', curve: 'h', copy: [{ pattern: 'P', index: 1 }] };
    const original = surface(state, side('H', 'h')) as Extract<Surface, { kind: 'cone' }>;
    const turned = surface(state, copy) as Extract<Surface, { kind: 'cone' }>;
    expect(turned.kind).toBe('cone');
    // half a turn about (20, 15): the apex moves from (x, y) to (40 − x, 30 − y)
    near(turned.apex[0], 40 - original.apex[0], 1e-6);
    near(turned.apex[1], 30 - original.apex[1], 1e-6);
    near(turned.apex[2], original.apex[2], 1e-6);
  });

  it('a profile that vanishes at the far end is an error of the feature that says it is the far end', () => {
    const engine = plate();
    const state = run(engine, feature('A', regions('C1', [['o']]), tapered(10, 'deg(-60)')));
    expect(errorOf(state, 'A')).toMatchObject({ code: 'invalidProfile', refs: ['o'] });
    expect(errorOf(state, 'A')?.message).toMatch(/^At the far end of the extrusion, the taper of -60° leaves no radius for the circle "o"/);
    // the corner of a rectangle with a hole: the hole reaches the outline before the end
    const crowded = run(engine, feature('B', regions('S2', [rectLoop('q')]), tapered(10, 'deg(-40)')));
    expect(errorOf(crowded, 'B')?.code).toBe('invalidProfile');
    expect(errorOf(crowded, 'B')?.message).toMatch(/far end/);
  });

  it('a wall tapers; a refusal names the curves of the sketch, not the keys of the outline', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      batch(
        { type: 'addPoint', sketch: 'S', id: 'a', x: 0, y: 0 },
        { type: 'addPoint', sketch: 'S', id: 'b', x: 30, y: 0 },
        { type: 'addCurve', sketch: 'S', id: 'm', curve: { type: 'line', a: 'a', b: 'b', construction: true } },
      ),
    );
    const state = run(engine, feature('R', { type: 'wall', sketch: 'S', curves: ['m'], thickness: 2 }, tapered(10, 'deg(-3)')));
    expectAllOk(state);
    // the band 30 × 2 narrows by k on every side for every unit of height: (30 − 2kz)(2 − 2kz)
    const [k, h] = [Math.tan(deg(3)), 10];
    near(volumeOf(state, 'R'), 60 * h - 32 * k * h * h + (4 / 3) * k * k * h * h * h);
    expect(surface(state, { feature: 'R', role: 'wallSide', curve: 'm', side: 'left' }).kind).toBe('plane');
    const steep = run(engine, { type: 'setField', feature: 'R', path: 'extent/taper', value: 'deg(-10)' });
    expect(errorOf(steep, 'R')).toMatchObject({ code: 'invalidProfile' });
    expect(errorOf(steep, 'R')?.refs).toEqual(['m']);
    expect(errorOf(steep, 'R')?.message).not.toMatch(/\|/);
  });
});
