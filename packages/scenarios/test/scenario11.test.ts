// Validation scenario 11 (docs/requirements.md): the queries of step 1 of D36 asked about the
// robot joint of scenario 9. Each package of track A adds its part:
// - 1b (D39), measuring: the wall between the root circle of the ring gear and the bolt holes;
// - 1a (D38), a section through the gears;
// - 1c (D40), the gap between a planet and the carrier, and the tight places of the whole joint;
// - 1d (D41), the mass of what turns with the output.
import type { EdgeName, Engine, EntityRef, FaceName, GapReport, Id, MassProperties, Measurement, PlaneRef, QueryArgs, QueryOptions, SectionLoop, SectionResult, SectionSpan } from '@trymesh/engine';
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

function section(engine: Engine, args: QueryArgs<'section'>, at?: Id): SectionResult {
  const answer = engine.query('section', args, at === undefined ? {} : { at });
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
function mass(engine: Engine, args: QueryArgs<'mass'>, options: QueryOptions = {}): MassProperties {
  const answer = engine.query('mass', args, options);
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const PLA = 1.24; // g/cm3
function gap(engine: Engine, args: QueryArgs<'gap'> = {}, options: QueryOptions = {}): GapReport {
  const answer = engine.query('gap', args, options);
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const loopsOf = (result: SectionResult): SectionLoop[] => result.bodies.flatMap((body) => (body.regions ?? []).flatMap((region) => [region.outer, ...region.holes]));
const spansOf = (result: SectionResult): SectionSpan[] => loopsOf(result).flatMap((loop) => loop.spans ?? []);

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

  it('1a: a section across the axis, through the gears: the bodies, their areas, and the budget spent on outlines first', () => {
    const started = performance.now();
    const result = section(engine, { plane: XY, offset: 40 });
    const took = performance.now() - started;
    // through the teeth of the sun, the three planets and the ring gear, and through the pins of
    // the carrier; the motor and the plate lie below
    expect(result.bodies.map((body) => body.body)).toEqual(['sun', 'planet', 'planets/1', 'planets/2', 'housing', 'carrier']);
    const area = Object.fromEntries(result.bodies.map((body) => [body.body, body.area]));
    expect(area.sun).toBeCloseTo(190.354, 3);
    expect(area.housing).toBeCloseTo(6131.972, 3);
    expect(area.carrier).toBeCloseTo(58.606, 3); // three pins of 19.535
    // a planet is a prism: its section is its volume over its height
    const planet = engine.getState().evaluation.bodies.planet;
    for (const id of ['planet', 'planets/1', 'planets/2']) expect(area[id]).toBeCloseTo(431.379, 3);
    expect(area.planet).toBeCloseTo(planet.volume / (planet.bounds.max[2] - planet.bounds.min[2]), 3);
    expect(result.below).toBeCloseTo(55e-6, 9); // the housing reaches 55 mm from the origin
    expect(result.inPlane).toEqual([]);
    // 19 loops of one span each: 14 whole circles and the five faces of teeth as curves
    expect(result.bodies.map((body) => body.loops)).toEqual([2, 2, 2, 2, 8, 3]);
    const spans = spansOf(result);
    expect(spans).toHaveLength(19);
    expect(spans.filter((span) => span.kind === 'arc' && Math.abs(span.sweep) === 2 * Math.PI)).toHaveLength(14);
    const curves = spans.flatMap((span) => (span.kind === 'curve' ? [span] : []));
    expect(curves.map((curve) => curve.count)).toEqual([270, 405, 405, 405, 720]); // the sun, the planets, the ring gear
    expect(curves.every((curve) => curve.face.role === 'side' && curve.face.curve === 'teeth')).toBe(true);
    // the default budget of 500 takes the 19 spans and the teeth of the sun, the first curve that
    // fits; the others come with their count and length
    expect(result.truncated).toEqual({ shown: 289, total: 2224 });
    expect(curves.map((curve) => curve.points?.length)).toEqual([270, undefined, undefined, undefined, undefined]);
    expect(curves[0].points?.[0]).toEqual(curves[0].from);
    expect(curves[0].from).toEqual(curves[0].to); // a whole loop, its corners listed once
    for (const curve of curves) expect(curve.length).toBeGreaterThan(40);
    // a budget of nothing: the bodies with their areas and the numbers of their loops
    const bare = section(engine, { plane: XY, offset: 40, maxPoints: 0 });
    expect(bare.bodies.every((body) => body.regions === undefined)).toBe(true);
    expect(bare.bodies.reduce((sum, body) => sum + body.loops, 0)).toBe(19);
    expect(bare.truncated).toEqual({ shown: 0, total: 2224 });
    // a small budget goes to the outlines of all bodies: the teeth of the sun do not take the
    // place of the bolt circles of the housing
    const small = section(engine, { plane: XY, offset: 40, maxPoints: 30 });
    expect(small.bodies.every((body) => body.regions !== undefined)).toBe(true);
    expect(small.truncated).toEqual({ shown: 19, total: 2224 });
    expect(spansOf(small).filter((span) => span.kind === 'curve' && span.points)).toEqual([]);
    // as polylines: the corners of the polygons, 2792 of them, however the faces are divided
    const drawn = section(engine, { plane: XY, offset: 40, outline: 'polylines', maxPoints: 1_000_000 });
    expect(drawn.truncated).toBeUndefined();
    expect(loopsOf(drawn).reduce((sum, loop) => sum + (loop.points?.length ?? 0), 0)).toBe(2792);
    // six bodies of some thousands of triangles: well under a second also on a loaded machine
    expect(took).toBeLessThan(2000);
  });

  it('1a: what an AI reads out of the housing: the outer wall, the bolt circle and the ring gear', () => {
    const housing = section(engine, { plane: XY, offset: 40, bodies: ['housing'] }).bodies[0];
    expect(housing.regions).toHaveLength(1);
    const region = housing.regions?.[0];
    const outer = region?.outer.spans?.[0];
    // the outer wall is one whole circle of the exact radius, on its face
    expect(outer).toMatchObject({ kind: 'arc', face: side('housing', 'ho'), radius: expect.closeTo(55, 9), center: [expect.closeTo(0, 9), expect.closeTo(0, 9)], sweep: 2 * Math.PI });
    // its ends are a vertex of the polygon: on the circle within the precision of the coordinates
    expect(Math.hypot(...(outer?.from ?? [0, 0]))).toBeCloseTo(55, 4);
    // seven holes: six bolt holes as whole circles whose centres are 50.5 from the axis, and the ring gear
    const holes = (region?.holes ?? []).map((hole) => hole.spans?.[0]);
    const bolts = holes.flatMap((span) => (span?.kind === 'arc' ? [span] : []));
    expect(bolts).toHaveLength(6);
    for (const bolt of bolts) expect(bolt).toMatchObject({ radius: expect.closeTo(1.7, 9), sweep: -2 * Math.PI });
    expect(bolts.map((bolt) => Math.hypot(...bolt.center))).toEqual(bolts.map(() => expect.closeTo(50.5, 9)));
    expect(bolts.map((bolt) => Math.round((Math.atan2(bolt.center[1], bolt.center[0]) * 180) / Math.PI) + 0).sort((a, b) => a - b)).toEqual([-120, -60, 0, 60, 120, 180]);
    const ring = holes.find((span) => span?.kind === 'curve');
    expect(ring).toMatchObject({ face: side('ring', 'teeth'), count: 720 });
    expect(ring?.kind === 'curve' && ring.points).toBeUndefined(); // 8 spans and 720 points do not fit 500
    // the teeth of one gear as points: a planet fits the default, the ring gear needs the budget raised
    const planet = section(engine, { plane: XY, offset: 40, bodies: ['planet'] });
    expect(planet.truncated).toBeUndefined();
    const flank = planet.bodies[0].regions?.[0].outer.spans?.[0];
    expect(flank?.kind === 'curve' && flank.points).toHaveLength(405);
    const raised = section(engine, { plane: XY, offset: 40, bodies: ['housing'], maxPoints: 1000 });
    expect(raised.truncated).toBeUndefined();
    const teeth = spansOf(raised).find((span) => span.kind === 'curve');
    expect(teeth?.kind === 'curve' && teeth.points).toHaveLength(720);
    // before the ring gear is cut, the housing is a solid disc there
    const before = section(engine, { plane: XY, offset: 40 }, 'motorBore').bodies.find((body) => body.body === 'housing');
    expect(before).toMatchObject({ loops: 1, regions: [{ holes: [], outer: { spans: [{ kind: 'arc', radius: expect.closeTo(55, 9) }] } }] });
  });

  it('1a: along the axis everything is lines; a plane in the front face of the housing shows that face from inside and nothing from outside', () => {
    // the base plane XZ goes exactly through vertices of the round faces: every loop still closes
    const along = section(engine, { plane: { kind: 'base', plane: 'XZ' } });
    expect(along.truncated).toBeUndefined();
    const spans = spansOf(along);
    expect(spans).toHaveLength(92);
    expect(spans.every((span) => span.kind === 'line')).toBe(true);
    const area = Object.fromEntries(along.bodies.map((body) => [body.body, body.area]));
    expect(area.motor).toBeCloseTo(2385, 3); // 90 by 26.5
    expect(area.carrier).toBeCloseTo(362.5, 3);
    expect(along.bodies.find((body) => body.body === 'housing')?.regions).toHaveLength(4);
    // 1.5 mm below the front face of the housing, through the nut pockets (3 mm deep): the outer
    // wall, the ring gear and six hexagons of six lines each
    const front: PlaneRef = { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'endCap' } };
    const pockets = section(engine, { plane: front, offset: -1.5, bodies: ['housing'] });
    expect(spansOf(pockets)).toHaveLength(38);
    const hexagons = (pockets.bodies[0].regions?.[0].holes ?? []).filter((hole) => (hole.spans ?? []).every((span) => span.kind === 'line'));
    expect(hexagons.map((hole) => hole.spans?.length)).toEqual([6, 6, 6, 6, 6, 6]);
    // With no offset the plane lies in that face and in the end caps of the planets and of the
    // teeth of the sun. The section is taken just below the plane, so each of those bodies shows
    // that face, and they are named.
    const flush = section(engine, { plane: front });
    expect(flush.inPlane.map((entry) => entry.body)).toEqual(['sun', 'planet', 'planets/1', 'planets/2', 'housing']);
    expect(flush.inPlane[4].face).toEqual({ feature: 'housing', role: 'endCap' });
    expect(flush.bodies.find((body) => body.body === 'housing')?.area).toBeCloseTo(6028.838, 3); // the front face with its pockets
    // seen from the other side, below the plane is outside those bodies
    const outside = section(engine, { plane: front, flip: true, bodies: ['housing'] });
    expect(outside.bodies).toEqual([]);
    expect(outside.inPlane.map((entry) => entry.body)).toEqual(['housing']);
    // a face that is not planar gives no cutting plane
    expect(engine.query('section', { plane: { kind: 'face', body: 'housing', face: side('housing', 'ho') } })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['plane'] } });
  });

  it('1c: the gap between a planet and the carrier lies on the wall of the bore and on the pin', () => {
    // The pin of the carrier (diameter 5) goes through the bore of the planet (5.3): 0.15 by
    // design, a little less between the two polygons.
    const report = gap(engine, { bodies: ['planet', 'carrier'] });
    expect(report).toMatchObject({ within: 5, close: 1, apart: 0, refused: 0, checked: 1 });
    const [pair] = report.pairs;
    if (!('between' in pair)) throw new Error('a gap above zero says where it is');
    expect(pair).toMatchObject({ a: 'carrier', b: 'planet', distance: expect.closeTo(0.140453, 5) }); // `a` is the smaller ID
    // The closest points lie on the rim of the bore, where the cap of the planet is as near as
    // its wall: the face named is the wall, the feature to change.
    expect(pair.between.faceA).toEqual(side('carrierPin', 'pin'));
    expect(pair.between.faceB).toEqual(side('planetHole', 'ph'));
    expect(pair.between.a).toEqual([expect.closeTo(17.75, 3), expect.closeTo(0, 3), expect.closeTo(34, 3)]);
    expect(pair.between.b).toEqual([expect.closeTo(17.61, 3), expect.closeTo(0, 3), expect.closeTo(34, 3)]);
    // two bodies with round faces, and the precision of the coordinates of a pair that reaches 51.5 mm
    expect(pair.accuracy).toBeCloseTo(0.02 + 51.5e-6, 9);
    expect(Math.abs(pair.distance - 0.15)).toBeLessThan(pair.accuracy);
  });

  it('1c: the tight places of the whole joint in one call, the closest first', () => {
    const started = performance.now();
    const report = gap(engine);
    const took = performance.now() - started;
    expect(report).toMatchObject({ within: 5, close: 15, apart: 13, refused: 0, checked: 28, failed: [] });
    expect(report.truncated).toBeUndefined();
    const listed = report.pairs.map((pair) => `${pair.a} ${pair.b} ${'between' in pair ? pair.distance.toFixed(4) : pair.contact}`);
    // the three copies of a planet are the same gap to the last digits or so: their order among
    // themselves is that of the numbers, so the list is compared group by group
    expect(report.pairs.map((pair) => pair.distance)).toEqual([...report.pairs.map((pair) => pair.distance)].sort((a, b) => a - b));
    expect(listed.slice(0, 3)).toEqual(['motor plate touching', 'motor sun touching', 'housing plate touching']); // in the order of the bodies
    expect(listed.slice(3, 6).sort()).toEqual(['housing planet 0.0497', 'housing planets/1 0.0497', 'housing planets/2 0.0497']);
    expect(listed.slice(6, 9).sort()).toEqual(['planet sun 0.0499', 'planets/1 sun 0.0499', 'planets/2 sun 0.0499']);
    expect(listed.slice(9, 12).sort()).toEqual(['carrier planet 0.1405', 'carrier planets/1 0.1405', 'carrier planets/2 0.1405']);
    expect([...listed].sort()).toEqual([
      // seating faces: flush, no shared volume
      'motor plate touching',
      'motor sun touching',
      'housing plate touching',
      // the backlash of 0.05 between the flanks of the teeth
      'housing planet 0.0497',
      'housing planets/1 0.0497',
      'housing planets/2 0.0497',
      'planet sun 0.0499',
      'planets/1 sun 0.0499',
      'planets/2 sun 0.0499',
      // the pins of the carrier in the bores of the planets
      'carrier planet 0.1405',
      'carrier planets/1 0.1405',
      'carrier planets/2 0.1405',
      'carrier sun 0.5000',
      'housing motor 0.9900', // the motor in its recess, 1 by design
      'carrier housing 1.5812',
    ].sort());
    expect(listed.slice(12)).toEqual(['carrier sun 0.5000', 'housing motor 0.9900', 'carrier housing 1.5812']);
    // the backlash lies between the faces of teeth
    const mesh = report.pairs.find((pair) => pair.a === 'planet' && pair.b === 'sun');
    expect(mesh && 'between' in mesh && [mesh.between.faceA, mesh.between.faceB]).toEqual([side('planet', 'teeth'), side('sunTeeth', 'teeth')]);
    // 28 pairs of some 17 000 triangles together: a few seconds at most on a loaded machine
    expect(took).toBeLessThan(10_000);
    // the answer is remembered by the meshes: asked again, nothing is measured
    const again = performance.now();
    expect(gap(engine)).toEqual(report);
    expect(performance.now() - again).toBeLessThan(took / 2 + 50);
  });

  it('1c: a pair far apart, a pair that collides, and the gap followed over a parameter', () => {
    // the plate and the pins of the carrier are 34 mm apart: counted, and measured with a larger search distance
    expect(gap(engine, { bodies: ['plate', 'carrier'] })).toMatchObject({ pairs: [], close: 0, apart: 1 });
    const far = gap(engine, { bodies: ['plate', 'carrier'], within: 50 });
    expect(far.pairs).toMatchObject([{ a: 'carrier', b: 'plate', distance: expect.closeTo(34, 6) }]);
    // the planet made too large, as in part i of scenario 9, without writing it down
    const tooLarge = engine.preview({ type: 'setField', feature: 'skGears', path: 'constraints/dp/value', value: 'module * Zp + 1' });
    if (!tooLarge.ok) throw new Error(tooLarge.error.message);
    expect(gap(engine, { bodies: ['housing', 'planet'] }, { state: tooLarge.state }).pairs).toEqual([{ a: 'housing', b: 'planet', distance: 0, contact: 'collision' }]);
    // the gap of the sun and a planet follows the backlash
    const looser = engine.preview({ type: 'setParameter', name: 'backlash', expr: '0.2' });
    if (!looser.ok) throw new Error(looser.error.message);
    const [open] = gap(engine, { bodies: ['sun', 'planet'] }, { state: looser.state }).pairs;
    expect(open.distance).toBeGreaterThan(0.15);
    expect(open.distance).toBeLessThan(0.2);
  });

  it('1d: the carrier alone: its mass, its centre of mass on the axis, the tensor of a body of revolution', () => {
    const carrier = mass(engine, { bodies: ['carrier'], density: PLA });
    // the volume the engine publishes; with exact circles it would be 14873.478 (the polygons are inscribed)
    expect(carrier.volume).toBeCloseTo(engine.getState().evaluation.bodies.carrier.volume, 6);
    expect(carrier.volume).toBeCloseTo(14863.496, 2);
    expect(carrier.mass).toBeCloseTo(18.431, 3);
    // on the axis of the joint, at z = 48.569 (48.567 with exact circles)
    expect(Math.hypot(carrier.centerOfMass[0], carrier.centerOfMass[1])).toBeLessThan(1e-3);
    expect(carrier.centerOfMass[2]).toBeCloseTo(48.569, 3);
    // about the axis 8256.9 g·mm2, about a line across it 4242.9; three pins a third of a turn
    // apart make the two across equal and leave nothing off the diagonal
    expect(carrier.inertia[2][2]).toBeCloseTo(8256.9, 0);
    expect(carrier.inertia[0][0]).toBeCloseTo(4242.9, 0);
    expect(carrier.inertia[1][1]).toBeCloseTo(carrier.inertia[0][0], 1);
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      expect(Math.abs(carrier.inertia[i][j])).toBeLessThan(0.05);
      expect(carrier.inertia[j][i]).toBe(carrier.inertia[i][j]);
    }
    // the disc before its pins, asked after its feature
    const disc = mass(engine, { bodies: ['carrier'], density: PLA }, { at: 'carrier' });
    expect(disc.centerOfMass[2]).toBeCloseTo(49, 3); // a disc from 46.5 to 51.5
    expect(disc.mass).toBeLessThan(carrier.mass);
  });

  it('1d: what turns with the output: the carrier and the three planets as one piece, about the axis of the joint', () => {
    const planets = engine.getState().evaluation.features.planets.bodies ?? [];
    expect(planets).toEqual(['planets/1', 'planets/2']);
    const link = mass(engine, { bodies: ['carrier', 'planet', ...planets], density: PLA, about: { kind: 'base', axis: 'Z' } });
    expect(link.volume).toBeCloseTo(30393.134, 1);
    expect(link.mass).toBeCloseTo(37.687, 3);
    // three planets a third of a turn apart cancel out: the centre of mass stays on the axis
    expect(link.about?.distance).toBeLessThan(1e-3);
    expect(link.centerOfMass[2]).toBeCloseTo(44.1905, 3);
    expect(link.about?.moment).toBeCloseTo(17639, -1);
    expect(link.about?.moment).toBeCloseTo(link.inertia[2][2], 3); // the axis goes through the centre of mass
    expect(link.bodies.map((body) => body.body)).toEqual(['carrier', 'planet', 'planets/1', 'planets/2']);
    // one planet about the axis of the joint: its centre of mass is the centre distance away,
    // and its moment is its own and its mass times the square of that
    const planet = mass(engine, { bodies: ['planet'], density: PLA, about: { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' } });
    expect(planet.about?.distance).toBeCloseTo(20.25, 3);
    expect(planet.about?.moment).toBeCloseTo(planet.inertia[2][2] + planet.mass * 20.25 ** 2, 1);
    // the link is its four bodies: their moments about the axis add up
    const carrier = mass(engine, { bodies: ['carrier'], density: PLA, about: { kind: 'base', axis: 'Z' } });
    expect(link.about?.moment).toBeCloseTo((carrier.about?.moment ?? 0) + 3 * (planet.about?.moment ?? 0), 0);
  });

  it('1d: a bought motor and a printed carrier: a density by body, and a fill factor for the printed one', () => {
    const mixed = mass(engine, { bodies: ['carrier', 'motor'], densities: { motor: 2.9 }, density: PLA, fill: 0.4 });
    expect(mixed.bodies).toMatchObject([
      { body: 'carrier', density: PLA, fill: 0.4, mass: expect.closeTo(7.372, 3) },
      { body: 'motor', density: 2.9, fill: 1 },
    ]);
    expect(mixed.mass).toBeCloseTo(mixed.bodies[0].mass + mixed.bodies[1].mass, 9);
    expect(mass(engine, { bodies: ['carrier'], density: PLA, fill: 0.4 }).mass).toBeCloseTo(7.372, 3);
    // a fill factor that reaches no body is refused; so is a body left without a density
    expect(engine.query('mass', { bodies: ['motor'], densities: { motor: 2.9 }, fill: 0.4 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['fill'] } });
    expect(engine.query('mass', { bodies: ['carrier'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['density'] } });
    expect(engine.query('mass', { bodies: ['carrier'], densities: { nope: 1 } })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['densities', 'nope'] } });
  });
});
