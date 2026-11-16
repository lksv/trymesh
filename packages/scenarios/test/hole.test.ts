// D46 (package 2c of D36) in the recompute, against the real adapters: the hole feature, its four
// shapes at one point and at several, the volumes against the formulas, the surfaces and the edges,
// sketches on a seat and on a flat, the names of the faces, "through all" with a head against the
// reach of the targets, a pattern of a hole, and the refusals of the recompute.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, FaceName, HoleExtent, HoleFeature, HoleShape, Id, Input, Surface } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, dimension, expectAllOk, faceNames, newEngine, onFace, rectLoop, rectangle, run, status, volume } from './kit';

type Shape = Input<HoleShape>;
type Extent = Input<HoleExtent>;
const hole = (id: Id, points: Id[], shape: Shape, extent: Extent, targets: Id[] = ['P'], extra: Partial<Input<HoleFeature>> = {}): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'hole', sketch: 'T', points, shape, extent, targets, ...extra },
});
const point = (sketch: Id, id: Id, x: number, y: number): Command =>
  batch({ type: 'addPoint', sketch, id, x: x + 0.1, y: y - 0.1 }, dimension(sketch, `${id}x`, { type: 'horizontalDistance', a: 'origin', b: id }, x), dimension(sketch, `${id}y`, { type: 'verticalDistance', a: 'origin', b: id }, y));
const plane = (id: Id, base: 'XY' | 'XZ' | 'YZ', offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: base }, offset } });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const preview = (engine: Engine, command: Command): EngineState => {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
const warningsOf = (state: EngineState, id: Id) => state.evaluation.features[id].warnings.map((warning) => warning.code);
const surface = (state: EngineState, name: FaceName): Surface => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name))];
const ofHole = (state: EngineState, body: Id, feature: Id): string[] => faceNames(state, body).filter((name) => name.startsWith(`${feature}/`));
const THROUGH: Extent = { type: 'throughAll', side: 'backward' };
const FORWARD: Extent = { type: 'throughAll', side: 'forward' };
const deg = (angle: number): number => (angle * Math.PI) / 180;
// A regular polygon of `n` sides inscribed in a circle of radius `r`, and the number of sides of
// a circle at the chord tolerance 0.01 (`segments` of sketch.ts).
const polygon = (n: number, r: number): number => (n / 2) * Math.sin((2 * Math.PI) / n) * r * r;
const sides = (radius: number): number => Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / radius)) - 1e-9);
// A hexagon `s` across flats.
const hexagon = (s: number): number => (Math.sqrt(3) / 2) * s * s;
const COUNTERBORE: Shape = { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 3 };
const COUNTERSINK: Shape = { type: 'countersink', diameter: 3.4, headDiameter: 6, angle: 'deg(90)' };
const NUT: Shape = { type: 'nutPocket', diameter: 3.4, acrossFlats: 5.5, headDepth: 2.4, rotation: 0 };

// A plate P of 40 × 30 × `thickness` with its corner at (x, 0), and the sketch T on its top with
// the points p1, p2 and p3 at (10, 10), (30, 10) and (20, 20) from that corner.
function plate(thickness = 10, x = 0): Engine {
  const engine = newEngine();
  run(engine, addSketch('S', XY), rectangle('S', 'r', x, 0, 40, 30, null), addExtrude('P', 'S', [rectLoop('r')], thickness), addSketch('T', onFace('P', { feature: 'P', role: 'endCap' })), point('T', 'p1', x + 10, 10), point('T', 'p2', x + 30, 10), point('T', 'p3', x + 20, 20));
  return engine;
}

describe('a hole: the four shapes', () => {
  it('a plain hole through the plate at two points: a bore per point, one mouth and one bottom', () => {
    const state = run(plate(), hole('H', ['p1', 'p2'], { type: 'plain', diameter: 3.4 }, THROUGH));
    expectAllOk(state);
    near(volumeOf(state, 'P'), 12000 - 2 * polygon(sides(1.7), 1.7) * 10, 1e-2);
    expect(ofHole(state, 'P', 'H')).toEqual(['H/holeBore/p1', 'H/holeBore/p2']);
    // the depth is how far the plate reaches from the mouth, measured on its mesh
    expect(state.evaluation.features.H.facts).toEqual({ depth: expect.closeTo(10, 5) });
    expect(surface(state, { feature: 'H', role: 'holeBore', point: 'p2' })).toMatchObject({ kind: 'cylinder', origin: [30, 10, 10], axis: [0, 0, 1], radius: 1.7 });
  });

  it('a counterbore: head, seat and bore, the volumes of the polygons; the seat is one face for all points', () => {
    const state = run(plate(), hole('C', ['p1', 'p2'], COUNTERBORE, THROUGH));
    expectAllOk(state);
    expect(ofHole(state, 'P', 'C')).toEqual(['C/holeBore/p1', 'C/holeBore/p2', 'C/holeHead/p1', 'C/holeHead/p2', 'C/holeSeat']);
    const n = sides(3);
    near(volumeOf(state, 'P'), 12000 - 2 * (polygon(n, 3) * 3 + polygon(n, 1.7) * 7), 1e-2);
    expect(state.evaluation.features.C.facts).toEqual({ headDepth: 3, depth: expect.closeTo(10, 5) });
    expect(surface(state, { feature: 'C', role: 'holeHead', point: 'p1' })).toMatchObject({ kind: 'cylinder', origin: [10, 10, 10], radius: 3 });
    expect(surface(state, { feature: 'C', role: 'holeSeat' })).toMatchObject({ kind: 'plane', origin: [0, 0, 7], normal: [0, 0, 1] });
  });

  it('a countersink: a cone from the mouth to the bore, its depth from the angle, one count of sides for the two', () => {
    const engine = plate();
    const state = run(engine, hole('K', ['p1'], COUNTERSINK, THROUGH));
    expectAllOk(state);
    expect(ofHole(state, 'P', 'K')).toEqual(['K/holeBore/p1', 'K/holeHead/p1']);
    // a cone of 90° from radius 3 to 1.7 is 1.3 deep; its apex lies 3 below the mouth
    const n = sides(3);
    const frustum = (polygon(n, 1) * 1.3 * (9 + 3 * 1.7 + 1.7 * 1.7)) / 3;
    near(volumeOf(state, 'P'), 12000 - frustum - polygon(n, 1.7) * 8.7, 1e-2);
    expect(state.evaluation.features.K.facts).toEqual({ headDepth: expect.closeTo(1.3, 12), depth: expect.closeTo(10, 5) });
    const cone = surface(state, { feature: 'K', role: 'holeHead', point: 'p1' }) as Extract<Surface, { kind: 'cone' }>;
    expect(cone).toMatchObject({ kind: 'cone', axis: [0, 0, 1], halfAngle: expect.closeTo(Math.PI / 4, 12) });
    near(cone.apex[2], 7, 1e-9);
    // the cone is a hole, and both rims are circles
    const body = engine.query('body', { body: 'P' });
    if (!body.ok) throw new Error(body.error.message);
    expect(body.result.faces.find((face) => face.name.role === 'holeHead')?.convex).toBe(false);
    const rims = state.evaluation.bodies.P.edges.filter((edge) => edge.name.a.role === 'holeHead' || edge.name.b.role === 'holeHead');
    expect(rims.map((edge) => edge.kind)).toEqual(['circle', 'circle']);
  });

  it('a nut pocket: six flats numbered from the corner the rotation points to, a seat, a bore', () => {
    const state = run(plate(), hole('N', ['p3'], { ...NUT, rotation: 'deg(30)' } as Shape, THROUGH));
    expectAllOk(state);
    expect(ofHole(state, 'P', 'N')).toEqual(['N/holeBore/p3', 'N/holeFlat/1/p3', 'N/holeFlat/2/p3', 'N/holeFlat/3/p3', 'N/holeFlat/4/p3', 'N/holeFlat/5/p3', 'N/holeFlat/6/p3', 'N/holeSeat']);
    near(volumeOf(state, 'P'), 12000 - hexagon(5.5) * 2.4 - polygon(sides(1.7), 1.7) * 7.6, 1e-2);
    // the corner at 30° and the next at 90°: the first flat faces 60°, its origin the corner in the sketch plane
    const flat = surface(state, { feature: 'N', role: 'holeFlat', point: 'p3', flat: 1 }) as Extract<Surface, { kind: 'plane' }>;
    const r = 5.5 / Math.sqrt(3);
    near(flat.origin[0], 20 + r * Math.cos(deg(30)), 1e-9);
    near(flat.origin[1], 20 + r * Math.sin(deg(30)), 1e-9);
    near(flat.origin[2], 10, 1e-9);
    near(Math.abs(flat.normal[0]), Math.cos(deg(60)), 1e-9);
    near(Math.abs(flat.normal[1]), Math.sin(deg(60)), 1e-9);
    // the edges of a flat are lines
    const edges = state.evaluation.bodies.P.edges.filter((edge) => edge.name.a.role === 'holeFlat' && edge.name.b.role === 'holeFlat');
    expect(edges.length).toBe(6);
    expect(edges.every((edge) => edge.kind === 'line')).toBe(true);
  });

  it('a blind hole by a distance: the mouth at the start, the depth with the head; the facts', () => {
    const engine = plate();
    const state = run(engine, hole('B', ['p1'], COUNTERBORE, { type: 'distance', start: 0, distance: -6 }));
    expectAllOk(state);
    expect(ofHole(state, 'P', 'B')).toEqual(['B/endCap', 'B/holeBore/p1', 'B/holeHead/p1', 'B/holeSeat']);
    const n = sides(3);
    near(volumeOf(state, 'P'), 12000 - polygon(n, 3) * 3 - polygon(n, 1.7) * 3, 1e-2);
    expect(state.evaluation.features.B.facts).toEqual({ headDepth: 3, depth: 6 });
    // a mouth above the plate: the tool starts 1 above it, the head is 2 deep in the plate and the bore 4
    const above = preview(engine, { type: 'updateFeature', id: 'B', patch: { extent: { start: 1, distance: -7 } } });
    near(volumeOf(above, 'P'), 12000 - polygon(n, 3) * 2 - polygon(n, 1.7) * 4, 1e-2);
  });
});

describe('a hole: faces and edges a sketch uses', () => {
  it('the rims of a counterbore and of a countersink are circles a sketch projects', () => {
    const engine = plate();
    run(engine, hole('C', ['p1'], COUNTERBORE, THROUGH), hole('K', ['p2'], COUNTERSINK, THROUGH));
    const top: FaceName = { feature: 'P', role: 'endCap' };
    const state = run(
      engine,
      addSketch('R', XY),
      { type: 'addExternal', sketch: 'R', id: 'mouth', ref: { type: 'edge', body: 'P', edge: { a: top, b: { feature: 'C', role: 'holeHead', point: 'p1' } }, kind: 'circle' } },
      { type: 'addExternal', sketch: 'R', id: 'seatRim', ref: { type: 'edge', body: 'P', edge: { a: { feature: 'C', role: 'holeSeat' }, b: { feature: 'C', role: 'holeBore', point: 'p1' } }, kind: 'circle' } },
      { type: 'addExternal', sketch: 'R', id: 'sink', ref: { type: 'edge', body: 'P', edge: { a: top, b: { feature: 'K', role: 'holeHead', point: 'p2' } }, kind: 'circle' } },
      { type: 'addExternal', sketch: 'R', id: 'lower', ref: { type: 'edge', body: 'P', edge: { a: { feature: 'K', role: 'holeBore', point: 'p2' }, b: { feature: 'K', role: 'holeHead', point: 'p2' } }, kind: 'circle' } },
    );
    expect(state.evaluation.features.R.status).toBe('ok');
    const radii = state.evaluation.features.R.sketch?.radii ?? {};
    near(radii.mouth, 3, 1e-9);
    near(radii.seatRim, 1.7, 1e-9);
    near(radii.sink, 3, 1e-9);
    near(radii.lower, 1.7, 1e-9);
    const points = state.evaluation.features.R.sketch?.points ?? {};
    expect(points['lower/center']).toMatchObject({ x: expect.closeTo(30, 9), y: expect.closeTo(10, 9) });
    // the head of the counterbore meets the seat in a circle too
    const kinds = state.evaluation.bodies.P.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'C' && name.role === 'holeHead')).map((edge) => edge.kind);
    expect(kinds).toEqual(['circle', 'circle']);
  });

  it('a sketch stands on the seat and on a flat; a flat starts in the sketch plane also when the mouth is moved', () => {
    const engine = plate();
    const state = run(engine, hole('N', ['p1', 'p3'], NUT, { type: 'distance', start: 1, distance: -7 }), addSketch('OnSeat', onFace('P', { feature: 'N', role: 'holeSeat' })), addSketch('OnFlat', onFace('P', { feature: 'N', role: 'holeFlat', point: 'p1', flat: 2 })));
    expectAllOk(state);
    // the seat lies 1.4 below the top: the head of 2.4 starts 1 above it
    expect(state.evaluation.features.OnSeat.plane).toMatchObject({ origin: [0, 0, expect.closeTo(8.6, 9)], normal: [0, 0, 1] });
    const flat = state.evaluation.features.OnFlat.plane;
    const r = 5.5 / Math.sqrt(3);
    // the second flat runs from the corner at 60° to the corner at 120°; its origin is the first, at the top of the plate
    near(flat?.origin[0] ?? 0, 10 + r * Math.cos(deg(60)), 1e-9);
    near(flat?.origin[1] ?? 0, 10 + r * Math.sin(deg(60)), 1e-9);
    near(flat?.origin[2] ?? 0, 10, 1e-9);
    near(Math.abs(flat?.normal[1] ?? 0), 1, 1e-9);
  });

  it('the bore keeps its name when the shape changes and when a point is added', () => {
    const engine = plate();
    run(engine, hole('H', ['p1'], { type: 'plain', diameter: 3.4 }, THROUGH), addSketch('OnBore', XY), { type: 'addExternal', sketch: 'OnBore', id: 'b', ref: { type: 'edge', body: 'P', edge: { a: { feature: 'P', role: 'endCap' }, b: { feature: 'H', role: 'holeBore', point: 'p1' } }, kind: 'circle' } });
    const counterbore = preview(engine, { type: 'updateFeature', id: 'H', patch: { shape: COUNTERBORE } });
    expect(ofHole(counterbore, 'P', 'H')).toEqual(['H/holeBore/p1', 'H/holeHead/p1', 'H/holeSeat']);
    // the edge the sketch projected was the bore against the top; now the head meets the top, so it is gone
    expect(warningsOf(counterbore, 'OnBore')).toEqual(['brokenProjection']);
    const more = preview(engine, { type: 'updateFeature', id: 'H', patch: { points: ['p1', 'p2'] } });
    expectAllOk(more);
    expect(ofHole(more, 'P', 'H')).toEqual(['H/holeBore/p1', 'H/holeBore/p2']);
    expect(more.evaluation.features.OnBore.sketch?.radii.b).toBeCloseTo(1.7, 9);
  });
});

describe('a hole: through all, the head against the reach of the targets', () => {
  it('a head half a millimetre deeper than the plate is refused, although the overshoot is longer', () => {
    const engine = plate(2.5);
    const state = run(engine, hole('C', ['p1'], COUNTERBORE, THROUGH));
    expect(errorOf(state, 'C')).toMatchObject({ code: 'invalidHole', refs: ['P'] });
    expect(errorOf(state, 'C')?.message).toMatch(/the head is 3 mm deep and the targets reach only 2\.5 mm from the mouth/);
    near(volumeOf(state, 'P'), 40 * 30 * 2.5, 1e-6);
    // a distance as deep as the head is refused in the step
    const flush = preview(engine, { type: 'updateFeature', id: 'C', patch: { extent: { type: 'distance', start: 0, distance: -3 } } });
    expect(errorOf(flush, 'C')?.code).toBe('invalidHole');
    expect(errorOf(flush, 'C')?.message).toMatch(/the head is 3 mm deep and the hole 3 mm/);
  });

  it('a plate thicker than the head by less than the resolution is refused; by twice it the hole has its seat and bore', () => {
    // the largest coordinate is 40: the resolution 1e-4 · 40 = 0.004
    const thin = run(plate(3.002), hole('C', ['p1'], COUNTERBORE, THROUGH));
    expect(errorOf(thin, 'C')?.code).toBe('invalidHole');
    const thick = run(plate(3.008), hole('C', ['p1'], COUNTERBORE, THROUGH));
    expectAllOk(thick);
    expect(ofHole(thick, 'P', 'C')).toEqual(['C/holeBore/p1', 'C/holeHead/p1', 'C/holeSeat']);
  });

  it('a plate 0.005 thick 1000 away from the origin: refused, not cut', () => {
    const state = run(plate(0.005, 1000), hole('C', ['p1'], { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 1 }, THROUGH));
    expect(errorOf(state, 'C')?.code).toBe('invalidHole');
    near(volumeOf(state, 'P'), 40 * 30 * 0.005, 1e-6);
  });

  it('away from the target: the warning of a cut that misses, and a pattern of it that turns it round hits', () => {
    const engine = plate();
    const state = run(engine, hole('C', ['p1'], COUNTERBORE, FORWARD));
    expect(status(state).C).toBe('warning:noEffect');
    expect(state.evaluation.features.C.warnings[0].refs).toEqual(['P']);
    near(volumeOf(state, 'P'), 12000, 1e-6);
    // turned by 180° about a line along Y through (20, 0, 10): the copy stands at (30, 10) and points down
    const turned = run(engine, addSketch('A', { kind: 'base', plane: 'XZ' }), point('A', 'a', 20, 10), { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'pattern', source: { type: 'features', features: ['C'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'A', point: 'a' }, count: 2, span: { type: 'full' } } } });
    expect(turned.evaluation.features.Q.status).toBe('ok');
    expect(faceNames(turned, 'P').filter((name) => name.includes('@Q:1'))).toEqual(['C/holeBore/p1@Q:1', 'C/holeHead/p1@Q:1', 'C/holeSeat@Q:1']);
    const n = sides(3);
    near(volumeOf(turned, 'P'), 12000 - polygon(n, 3) * 3 - polygon(n, 1.7) * 7, 1e-2);
  });

  it('away from a target whose top float32 does not hold exactly, and from the top of a body turned by a pattern', () => {
    const high = run(plate(33.4), hole('C', ['p1'], COUNTERSINK, FORWARD));
    expect(status(high).C).toBe('warning:noEffect');
    // the plate copied by a pattern of a body, turned about Z by 90° around (100, 0): its top is still at 10
    const engine = plate();
    run(engine, addSketch('A', XY), point('A', 'a', 100, 0), { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'pattern', source: { type: 'body', body: 'P' }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'A', point: 'a' }, count: 4, span: { type: 'full' } } } });
    const frame = run(engine, addSketch('U', onFace('Q/1', { feature: 'P', role: 'endCap', copy: [{ pattern: 'Q', index: 1 }] }))).evaluation.features.U.plane;
    if (!frame) throw new Error('the sketch on the copy has no plane');
    // the copy covers x from 70 to 100 and y from −100 to −60; the point at (85, −80) of the model
    const along = (axis: number[]) => (85 - frame.origin[0]) * axis[0] + (-80 - frame.origin[1]) * axis[1] + (10 - frame.origin[2]) * axis[2];
    expect(frame.origin[2]).toBeCloseTo(10, 9);
    const state = run(
      engine,
      point('U', 'u', along(frame.x), along(frame.y)),
      { type: 'addFeature', feature: { id: 'C', name: 'C', suppressed: false, type: 'hole', sketch: 'U', points: ['u'], shape: COUNTERBORE, extent: FORWARD, targets: ['Q/1'] } },
    );
    expect(status(state).C).toBe('warning:noEffect');
    const into = preview(engine, { type: 'updateFeature', id: 'C', patch: { extent: THROUGH } });
    expect(status(into).C).toBe('ok');
  });

  it('a tilted face that passes the sketch plane by a hair: a headed hole is refused, a plain hole cuts the sliver (pinned)', () => {
    // the plate leans in by 5° on every side; the plane of the sketch is 0.01 inside its right side at the floor
    const engine = newEngine();
    run(engine, addSketch('S', XY), rectangle('S', 'r', 0, 0, 40, 30, null), { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: rectLoop('r').sort() }] }, extent: { type: 'distance', start: 0, distance: 10, taper: 'deg(-5)' }, operation: 'new' } });
    run(engine, plane('X', 'YZ', 39.99), addSketch('T', { kind: 'plane', feature: 'X' }), point('T', 'p1', 15, 1));
    const before = volumeOf(engine.getState(), 'P');
    const headed = run(engine, hole('C', ['p1'], COUNTERBORE, FORWARD));
    expect(errorOf(headed, 'C')?.code).toBe('invalidHole');
    const plain = preview(engine, { type: 'updateFeature', id: 'C', patch: { shape: { type: 'plain', diameter: 3.4 } } });
    expect(status(plain).C).toBe('ok');
    const sliver = before - volumeOf(plain, 'P');
    expect(sliver > 0 && sliver < 1e-2).toBe(true);
  });

  it('through a plate of a body that reaches deeper at its rim: not detected (pinned); the seat is in no body', () => {
    // a plate 3 thick on top of a rim 10 deep around a pocket: the counterbore head of 4 passes the plate
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 40, 30, null),
      addExtrude('P', 'S', [rectLoop('r')], 13),
      addSketch('I', XY),
      rectangle('I', 'i', 3, 3, 34, 24, null),
      addExtrude('pocket', 'I', [rectLoop('i')], 10, 'cut', 'P'),
      addSketch('T', onFace('P', { feature: 'P', role: 'endCap' })),
      point('T', 'p1', 10, 10),
    );
    const state = run(engine, hole('C', ['p1'], { ...COUNTERBORE, headDepth: 4 } as Shape, THROUGH));
    expect(status(state).C).toBe('ok');
    expect(state.evaluation.features.C.facts?.depth).toBeCloseTo(13, 5);
    expect(ofHole(state, 'P', 'C')).toEqual(['C/holeHead/p1']);
  });
});

describe('a hole: a pattern, and the refusals of the recompute', () => {
  it('a pattern repeats a hole, and a hole and a counterbore in one list', () => {
    const engine = plate();
    const state = run(
      engine,
      hole('H', ['p1'], { type: 'plain', diameter: 3.4 }, THROUGH),
      hole('C', ['p2'], COUNTERBORE, THROUGH),
      addSketch('A', XY),
      point('A', 'mid', 20, 15),
      { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'pattern', source: { type: 'features', features: ['H', 'C'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'A', point: 'mid' }, count: 2, span: { type: 'full' } } } },
    );
    expectAllOk(state);
    const n = sides(3);
    near(volumeOf(state, 'P'), 12000 - 2 * (polygon(sides(1.7), 1.7) * 10 + polygon(n, 3) * 3 + polygon(n, 1.7) * 7), 2e-2);
    expect(faceNames(state, 'P').filter((name) => name.includes('@Q:1'))).toEqual(['C/holeBore/p2@Q:1', 'C/holeHead/p2@Q:1', 'C/holeSeat@Q:1', 'H/holeBore/p1@Q:1']);
  });

  it('a head not wider than the bore, a bore wider than the flats, overlapping holes, a point that is gone', () => {
    const engine = plate();
    run(engine, hole('C', ['p1', 'p2'], COUNTERBORE, THROUGH));
    const narrow = preview(engine, { type: 'setField', feature: 'C', path: 'shape/headDiameter', value: 3.4 });
    expect(errorOf(narrow, 'C')).toMatchObject({ code: 'invalidHole' });
    expect(errorOf(narrow, 'C')?.message).toMatch(/the head of 3\.4 mm is not wider than the bore of 3\.4 mm/);
    const nut = preview(engine, { type: 'updateFeature', id: 'C', patch: { shape: { ...NUT, acrossFlats: 3 } } });
    expect(errorOf(nut, 'C')?.message).toMatch(/the bore of 3\.4 mm does not fit between the flats, 3 mm apart/);
    // p1 and p2 are 20 apart: holes 20 wide touch
    const wide = preview(engine, { type: 'setField', feature: 'C', path: 'shape/headDiameter', value: 20 });
    expect(errorOf(wide, 'C')).toMatchObject({ code: 'invalidHole', refs: ['p1', 'p2'] });
    expect(status(preview(engine, { type: 'setField', feature: 'C', path: 'shape/headDiameter', value: 19.9 })).C).toBe('ok');
    // the point is removed from the sketch: the hole has a broken reference
    const gone = preview(engine, { type: 'removeEntity', sketch: 'T', id: 'p2' });
    expect(errorOf(gone, 'C')).toMatchObject({ code: 'brokenReference', refs: ['p2'] });
    // a hole at the origin of the sketch
    expect(status(preview(engine, { type: 'updateFeature', id: 'C', patch: { points: ['origin'], extent: FORWARD } })).C).toBe('warning:noEffect');
  });

  it('a hole through two targets, and one it misses', () => {
    const engine = plate();
    run(engine, addSketch('S2', XY), rectangle('S2', 'q', 0, 0, 20, 30, null), { type: 'addFeature', feature: { id: 'B', name: 'B', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S2', regions: [{ outerLoop: rectLoop('q').sort() }] }, extent: { type: 'distance', start: 0, distance: -5 }, operation: 'new' } });
    const state = run(engine, hole('H', ['p1', 'p2'], { type: 'plain', diameter: 3.4 }, THROUGH, ['P', 'B']));
    expectAllOk(state);
    expect(state.evaluation.features.H.facts?.depth).toBeCloseTo(15, 5);
    expect(ofHole(state, 'B', 'H')).toEqual(['H/holeBore/p1']);
    const missed = preview(engine, { type: 'updateFeature', id: 'H', patch: { points: ['p2'] } });
    expect(missed.evaluation.features.H.warnings).toMatchObject([{ code: 'noEffect', refs: ['B'] }]);
  });
});
