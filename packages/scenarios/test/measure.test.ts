// The query `measure` (D39) against the real adapters: what each entity is, the exact part, the
// smallest distance on the mesh and its accuracy, and the errors.
import type { EdgeName, Engine, EntityRef, FaceName, Measurement } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, cap, circle, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

type Ref = Exclude<EntityRef, { kind: 'body' }>;
const face = (body: string, name: FaceName): Ref => ({ kind: 'face', body, face: name });
const edge = (body: string, a: FaceName, b: FaceName): Ref => ({ kind: 'edge', body, edge: { a, b } as EdgeName });
const point = (sketch: string, id: string): Ref => ({ kind: 'sketchPoint', sketch, point: id });
function measure(engine: Engine, from: Ref, to: Ref, at?: string): Measurement {
  const answer = engine.query('measure', { from, to }, at === undefined ? {} : { at });
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const close = (values: number[], digits = 6) => values.map((value) => expect.closeTo(value, digits));
const TOLERANCE = 0.01; // the chord tolerance of a new document

// A plate 40 × 30 × 10 with a hole of radius 4 at (10, 10) and a pin of radius 3, 5 high, on its
// top; and a bar 10 × 30 × 10 beside it, 10 away along X. The sketch S1 has the corner r3 at (40, 30).
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'h', 10, 10, 4),
    rectangle('S1', 'q', 50, 0, 10, 30, null),
    addExtrude('E1', 'S1', [rectLoop('r')], 10),
    addExtrude('BAR', 'S1', [rectLoop('q')], 10),
    addSketch('S2', onFace('E1', cap('E1'))),
    circle('S2', 'k', 30, 20, 3),
    addExtrude('PIN', 'S2', [['k']], 5, 'add', 'E1'),
  );
  return engine;
}
const [BOTTOM, TOP, FRONT, RIGHT, BACK, LEFT] = [cap('E1', 'startCap'), cap('E1'), side('E1', 'ra'), side('E1', 'rb'), side('E1', 'rc'), side('E1', 'rd')];
const HOLE = side('E1', 'h');
const PIN = side('PIN', 'k');

describe('the query measure', () => {
  const engine = model();

  it('two planar faces: a wall, a gap between two bodies, two steps, a corner', () => {
    // the bottom and the top of the plate: a wall 10 thick; both entities lie on a body with round faces
    const wall = measure(engine, face('E1', BOTTOM), face('E1', TOP));
    expect(wall).toMatchObject({ from: { is: 'plane', normal: close([0, 0, -1]) }, to: { is: 'plane', normal: close([0, 0, 1]) }, distance: expect.closeTo(10, 9), angle: expect.closeTo(Math.PI, 9), facing: 'away' });
    expect(wall.smallest.distance).toBeCloseTo(10, 5);
    expect(wall.smallest.accuracy).toBeCloseTo(2 * TOLERANCE + 40e-6, 9);
    // the plate and the bar look at each other across a gap of 10; the bar has only planar faces
    const gap = measure(engine, face('E1', RIGHT), face('BAR', side('BAR', 'qd')));
    expect(gap).toMatchObject({ distance: expect.closeTo(10, 6), angle: expect.closeTo(Math.PI, 9), facing: 'towards' });
    expect(gap.smallest).toMatchObject({ distance: expect.closeTo(10, 5), from: [expect.closeTo(40, 5), expect.anything(), expect.anything()], to: [expect.closeTo(50, 5), expect.anything(), expect.anything()] });
    expect(gap.smallest.accuracy).toBeCloseTo(TOLERANCE + 60e-6, 9);
    // the top of the plate and the top of the pin look the same way: two steps, 5 apart
    const steps = measure(engine, face('E1', TOP), face('E1', cap('PIN')));
    expect(steps).toMatchObject({ distance: expect.closeTo(5, 9), angle: expect.closeTo(0, 9) });
    expect(steps.facing).toBeUndefined();
    expect(steps.smallest.distance).toBeCloseTo(5, 5);
    // two faces that meet in an edge: no distance, and nothing between them on the mesh
    const corner = measure(engine, face('E1', BOTTOM), face('E1', FRONT));
    expect(corner.distance).toBeUndefined();
    expect(corner.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(corner.smallest.distance).toBe(0);
  });

  it('a hole and a pin: what they are, the distance of their axes, and the material beside a hole', () => {
    const pair = measure(engine, face('E1', HOLE), face('E1', PIN));
    expect(pair.from).toMatchObject({ is: 'cylinder', origin: close([10, 10, 0]), axis: close([0, 0, 1]), radius: expect.closeTo(4, 9), convex: false });
    expect(pair.to).toMatchObject({ is: 'cylinder', radius: expect.closeTo(3, 9), convex: true });
    const axisOfPin = pair.to.is === 'cylinder' ? pair.to.origin : [NaN, NaN, NaN];
    expect(pair.distance).toBeCloseTo(Math.hypot(axisOfPin[0] - 10, axisOfPin[1] - 10), 9);
    expect(pair.distance).toBeCloseTo(Math.hypot(20, 10), 4);
    expect(pair.angle).toBeCloseTo(0, 9);
    // the hole beside the left wall: 10 from the axis to the wall, 6 of material left; the mesh
    // of the hole is a polygon inside its circle, so the material is a little more, within the accuracy
    const beside = measure(engine, face('E1', HOLE), face('E1', LEFT));
    expect(beside).toMatchObject({ distance: expect.closeTo(10, 9), angle: expect.closeTo(0, 9) });
    expect(beside.facing).toBeUndefined();
    expect(beside.smallest.distance).toBeGreaterThanOrEqual(6 - 1e-5);
    expect(beside.smallest.distance).toBeLessThan(6 + beside.smallest.accuracy);
    // the hole stands on the bottom face
    expect(measure(engine, face('E1', HOLE), face('E1', BOTTOM))).toMatchObject({ angle: expect.closeTo(Math.PI / 2, 9), smallest: { distance: 0 } });
    expect(measure(engine, face('E1', HOLE), face('E1', BOTTOM)).distance).toBeUndefined();
  });

  it('edges: a circle from its two surfaces, a line from its two planes', () => {
    // the mouth of the hole in the bottom face, against the origin of the sketch
    const mouth = measure(engine, edge('E1', HOLE, BOTTOM), point('S1', 'origin'));
    expect(mouth.from).toMatchObject({ is: 'circle', center: close([10, 10, 0], 9), radius: expect.closeTo(4, 9) });
    expect(mouth.from.is === 'circle' && Math.abs(mouth.from.axis[2])).toBeCloseTo(1, 12);
    expect(mouth.to).toEqual({ is: 'point', at: [0, 0, 0] });
    expect(mouth.distance).toBeCloseTo(Math.hypot(10, 10), 9); // to the centre
    expect(mouth.angle).toBeUndefined();
    expect(mouth.smallest.distance).toBeCloseTo(Math.hypot(10, 10) - 4, 1); // to the rim, a polygon
    expect(mouth.smallest.accuracy).toBeCloseTo(TOLERANCE + 40e-6, 9); // a sketch point adds nothing
    // the description of the body carries the same circle
    const description = engine.query('body', { body: 'E1' });
    const described = description.ok ? description.result.edges.filter((one) => one.kind === 'circle') : [];
    expect(described).toHaveLength(4); // the two mouths of the hole, the foot and the top of the pin
    for (const one of described) expect(one.kind === 'circle' && [one.circle.radius, Math.abs(one.circle.axis[2])]).toEqual([expect.closeTo(one.circle.center[0] < 20 ? 4 : 3, 9), expect.closeTo(1, 12)]);
    // two edges of the plate along X: parallel lines
    const [low, high] = [edge('E1', BOTTOM, FRONT), edge('E1', TOP, BACK)];
    const along = measure(engine, low, high);
    expect(along.from).toMatchObject({ is: 'line' });
    expect(along.from.is === 'line' && [along.from.from, along.from.to].sort((a, b) => a[0] - b[0])).toEqual([close([0, 0, 0]), close([40, 0, 0])]);
    expect(along).toMatchObject({ distance: expect.closeTo(Math.hypot(30, 10), 6), angle: expect.closeTo(0, 9) });
    expect(along.smallest.distance).toBeCloseTo(Math.hypot(30, 10), 5);
    // an edge along X and an upright one: skew lines, the common perpendicular
    const upright = measure(engine, low, edge('E1', RIGHT, BACK));
    expect(upright).toMatchObject({ distance: expect.closeTo(30, 6), angle: expect.closeTo(Math.PI / 2, 9) });
    expect(upright.smallest.distance).toBeCloseTo(30, 5);
    // an edge against a face it runs along, and against one it stands on
    expect(measure(engine, low, face('E1', TOP))).toMatchObject({ distance: expect.closeTo(10, 6), angle: expect.closeTo(0, 9) });
    expect(measure(engine, edge('E1', RIGHT, BACK), face('E1', TOP)).distance).toBeUndefined();
  });

  it('sketch points: where the model has them', () => {
    const diagonal = measure(engine, point('S1', 'origin'), point('S1', 'r3'));
    expect(diagonal).toMatchObject({ from: { is: 'point', at: [0, 0, 0] }, to: { is: 'point', at: close([40, 30, 0]) }, distance: expect.closeTo(50, 6), smallest: { distance: expect.closeTo(50, 6), accuracy: 0 } });
    expect(diagonal.angle).toBeUndefined();
    // a point of the sketch on the top face is at the height of that face
    expect(measure(engine, point('S2', 'kc'), face('E1', BOTTOM))).toMatchObject({ distance: expect.closeTo(10, 9), smallest: { distance: expect.closeTo(10, 5) } });
    expect(measure(engine, point('S1', 'origin'), face('E1', HOLE)).distance).toBeCloseTo(Math.hypot(10, 10), 9); // to the axis
  });

  it('the state asked about, and the same pair asked the other way round', () => {
    // before the pin the top of the plate has no pin on it
    expect(failure(engine.query('measure', { from: face('E1', TOP), to: face('E1', PIN) }, { at: 'BAR' }))).toEqual(['notAvailable', ['to', 'face'], expect.any(String)]);
    expect(measure(engine, face('E1', BOTTOM), face('E1', TOP), 'E1').distance).toBeCloseTo(10, 9);
    const [there, back] = [measure(engine, face('E1', HOLE), face('BAR', side('BAR', 'qd'))), measure(engine, face('BAR', side('BAR', 'qd')), face('E1', HOLE))];
    expect(back).toMatchObject({ from: there.to, to: there.from, distance: there.distance, angle: there.angle });
    expect(back.smallest).toMatchObject({ distance: expect.closeTo(there.smallest.distance, 9), accuracy: there.smallest.accuracy });
  });

  it('refuses with a code and the place of the argument', () => {
    expect(failure(engine.query('measure', { from: face('E1', side('E1', 'nope')), to: face('E1', TOP) }))).toEqual(['notAvailable', ['from', 'face'], 'measure: from.face: the body "E1" has no face E1/side/nope']);
    expect(failure(engine.query('measure', { from: face('E1', TOP), to: edge('E1', TOP, BOTTOM) }))).toEqual(['notAvailable', ['to', 'edge'], expect.any(String)]); // the two caps share no edge
    expect(failure(engine.query('measure', { from: { kind: 'body', body: 'E1' } as never, to: face('E1', TOP) }))).toEqual(['invalidArguments', ['from'], expect.any(String)]);
    expect(failure(engine.query('measure', { from: face('E1', TOP) } as never))).toEqual(['invalidArguments', ['to'], 'measure: to: the argument is required']);
    expect(failure(engine.query('measure', { from: point('S1', 'nope'), to: face('E1', TOP) }))).toEqual(['notAvailable', ['from', 'point'], expect.any(String)]);
    // a sketch that did not evaluate is in the document, so it passes the check; its points have no place
    const suppressed = model();
    run(suppressed, { type: 'setSuppressed', id: 'S2', suppressed: true });
    expect(failure(suppressed.query('measure', { from: point('S2', 'kc'), to: point('S1', 'origin') }))).toEqual(['notAvailable', ['from', 'sketch'], 'measure: the sketch "S2" did not evaluate, so its points have no place']);
  });
});

function failure(outcome: { ok: boolean; error?: { code: string; arg?: readonly (string | number)[]; message: string } }): unknown {
  return outcome.ok ? 'ok' : [outcome.error?.code, outcome.error?.arg, outcome.error?.message];
}
