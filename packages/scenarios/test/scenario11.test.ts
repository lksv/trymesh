// Validation scenario 11 (docs/requirements.md): the queries of step 1 of D36 asked about the
// robot joint of scenario 9. Each package of track A adds its part; this is the part of 1b
// (D39), measuring: the wall between the root circle of the ring gear and the bolt holes.
import type { EdgeName, Engine, EntityRef, FaceName, Id, Measurement } from '@trymesh/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { bodiesAndHoles, parametersAndGearSketch } from './joint';
import { expectAllOk, newEngine } from './kit';

type Ref = Exclude<EntityRef, { kind: 'body' }>;
const side = (feature: Id, curve: Id, copy?: { pattern: Id; index: number }): FaceName => ({ feature, role: 'side', curve, ...(copy ? { copy: [copy] } : {}) });
const face = (body: Id, name: FaceName): Ref => ({ kind: 'face', body, face: name });
function measure(engine: Engine, from: Ref, to: Ref): Measurement {
  const answer = engine.query('measure', { from, to });
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}

describe('scenario 11: the queries asked about the robot joint', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    parametersAndGearSketch(engine);
    expectAllOk(bodiesAndHoles(engine));
  });

  const RING = face('housing', side('ring', 'teeth'));
  const BOLT_HOLE = face('housing', side('boltHole', 'bh'));

  it('1b: the wall between the ring gear and a bolt hole, on the mesh and exactly', () => {
    // The ring gear is a face of gear teeth: it has a direction and no position, so the pair has
    // no exact distance. It still has the smallest distance on the mesh, with what it is good to.
    const started = performance.now();
    const onMesh = measure(engine, RING, BOLT_HOLE);
    const took = performance.now() - started;
    expect(onMesh.from).toEqual({ is: 'swept', axis: [0, 0, 1] });
    expect(onMesh.to).toMatchObject({ is: 'cylinder', radius: expect.closeTo(1.7, 9), convex: false });
    expect(onMesh.distance).toBeUndefined();
    expect(onMesh.angle).toBe(0);
    // both entities lie on the housing, which has round faces: twice the chord tolerance, and the
    // precision of the coordinates of a body that reaches 55 mm from the origin
    expect(onMesh.smallest.accuracy).toBeCloseTo(0.02 + 55e-6, 6);
    // The same wall exactly: the bolt hole is a cylinder, the axis of the gear goes through the
    // origin of the gear sketch, and the root circle is a fact the generator published.
    const hole = measure(engine, { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' }, BOLT_HOLE);
    const root = engine.getState().evaluation.features.ring.facts?.rootDiameter;
    if (hole.to.is !== 'cylinder' || hole.distance === undefined || typeof root !== 'number') throw new Error('the bolt hole is a cylinder and the ring gear publishes its root diameter');
    const exactly = hole.distance - hole.to.radius - root / 2;
    expect(hole.distance).toBeCloseTo(50.5, 9);
    expect(exactly).toBeCloseTo(15.275, 6);
    // the mesh agrees with the exact wall within its accuracy, and lies between the two faces along X
    expect(Math.abs(onMesh.smallest.distance - exactly)).toBeLessThan(onMesh.smallest.accuracy);
    expect(onMesh.smallest.distance).toBeCloseTo(15.2837, 3);
    expect(onMesh.smallest.from[0]).toBeCloseTo(33.526, 2);
    expect(onMesh.smallest.to[0]).toBeCloseTo(48.81, 2);
    expect(onMesh.smallest.from[2]).toBeCloseTo(onMesh.smallest.to[2], 2);
    // a face of some 1400 triangles against one of some 60: well under a second also on a loaded machine
    expect(took).toBeLessThan(2000);
  });

  it('1b: the pitch of the bolt holes, the floor above the motor, and the mouth of a bolt hole', () => {
    // two holes of the pattern: the distance of their axes, exact (a sixth of the bolt circle of radius 50.5)
    const pitch = measure(engine, BOLT_HOLE, face('housing', side('boltHole', 'bh', { pattern: 'bolts', index: 1 })));
    expect(pitch.distance).toBeCloseTo(50.5, 9);
    expect(pitch.angle).toBe(0);
    // two planar faces that look away from each other: the solid part of the housing above the motor recess
    const floor = measure(engine, face('housing', { feature: 'motorBore', role: 'endCap' }), face('housing', { feature: 'housing', role: 'endCap' }));
    expect(floor).toMatchObject({ distance: expect.closeTo(18, 9), angle: expect.closeTo(Math.PI, 9), facing: 'away' });
    // a circular edge is read from its two surfaces: the mouth of a bolt hole in the seating face
    const mouth: EdgeName = { a: side('boltHole', 'bh'), b: { feature: 'housing', role: 'startCap' } };
    const shape = measure(engine, { kind: 'edge', body: 'housing', edge: mouth }, { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' }).from;
    expect(shape).toMatchObject({ is: 'circle', center: [expect.closeTo(50.5, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)], radius: expect.closeTo(1.7, 9) });
    expect(shape.is === 'circle' && Math.abs(shape.axis[2])).toBeCloseTo(1, 12);
    // the description of the body carries the same circle, whatever the number of its vertices
    const description = engine.query('body', { body: 'housing' });
    const key = (name: FaceName): string => JSON.stringify(name);
    const described = description.ok ? description.result.edges.find((edge) => [key(edge.name.a), key(edge.name.b)].sort().join() === [key(mouth.a), key(mouth.b)].sort().join()) : undefined;
    expect(described).toMatchObject({ kind: 'circle', circle: { center: [expect.closeTo(50.5, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)], radius: expect.closeTo(1.7, 9) } });
  });

  it('1b: a face that is not in the state asked about is named by its argument', () => {
    const missing = engine.query('measure', { from: face('housing', side('nope', 'x')), to: BOLT_HOLE });
    expect(missing).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['from', 'face'] } });
    // before the pattern of the bolt holes only the first hole is there
    const early = engine.query('measure', { from: BOLT_HOLE, to: face('housing', side('boltHole', 'bh', { pattern: 'bolts', index: 1 })) }, { at: 'boltHole' });
    expect(early).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['to', 'face'] } });
  });
});
