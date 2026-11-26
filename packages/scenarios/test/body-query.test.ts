// The query `body` (D37): a body described by its faces and edges.
import type { BodyDescription, BodyEdge, BodyFace, Engine, FaceName } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, cap, circle, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

const key = (name: FaceName): string => JSON.stringify(name);
function describeBody(engine: Engine, body: string, at?: string): BodyDescription {
  const answer = engine.query('body', { body }, at === undefined ? {} : { at });
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.result;
}
const faceOf = (description: BodyDescription, name: FaceName): BodyFace => description.faces.find((face) => key(face.name) === key(name)) as BodyFace;
const edgeOf = (description: BodyDescription, a: FaceName, b: FaceName): BodyEdge => description.edges.find((edge) => [key(edge.name.a), key(edge.name.b)].sort().join() === [key(a), key(b)].sort().join()) as BodyEdge;
const close = (values: number[], digits = 6) => values.map((value) => expect.closeTo(value, digits));

// A plate 40 × 30 × 10 with a hole of radius 4 at (10, 10) and a pin of radius 3, 5 high, on its
// top at (30, 20).
function plate(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'h', 10, 10, 4),
    addExtrude('E1', 'S1', [rectLoop('r')], 10),
    addSketch('S2', onFace('E1', cap('E1'))),
    circle('S2', 'k', 30, 20, 3),
    addExtrude('PIN', 'S2', [['k']], 5, 'add', 'E1'),
  );
  return engine;
}

describe('the query body', () => {
  it('faces: the surface, the area, the normal of a planar face out of the body, a hole and a pin told apart', () => {
    const description = describeBody(plate(), 'E1');
    expect(description).toMatchObject({ body: 'E1', bounds: { min: close([0, 0, 0], 4), max: close([40, 30, 15], 4) } });
    expect(description.volume).toBeCloseTo(40 * 30 * 10 - Math.PI * 16 * 10 + Math.PI * 9 * 5, -1); // round faces are polygons
    expect(description.faces.map((face) => face.surface.kind).sort()).toEqual(['cylinder', 'cylinder', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane']);
    // the bottom looks down although the plane of the sketch looks up
    expect(faceOf(description, cap('E1', 'startCap'))).toMatchObject({ surface: { kind: 'plane', normal: close([0, 0, 1]) }, meshNormal: close([0, 0, -1]) });
    expect(faceOf(description, cap('E1')).meshNormal).toEqual(close([0, 0, 1]));
    expect(faceOf(description, cap('PIN')).meshNormal).toEqual(close([0, 0, 1]));
    expect(faceOf(description, side('E1', 'ra')).meshNormal).toEqual(close([0, -1, 0]));
    expect(faceOf(description, side('E1', 'ra')).area).toBeCloseTo(400, 4);
    // round faces are polygons: within a percent
    const about = (value: number, exact: number) => expect(Math.abs(value / exact - 1)).toBeLessThan(0.01);
    about(faceOf(description, cap('PIN')).area, Math.PI * 9);
    // a planar face has no `convex`, a round one no `meshNormal`
    expect(faceOf(description, cap('E1'))).not.toHaveProperty('convex');
    const [hole, pin] = [faceOf(description, side('E1', 'h')), faceOf(description, side('PIN', 'k'))];
    expect(hole).toMatchObject({ surface: { kind: 'cylinder', radius: expect.closeTo(4, 6) }, convex: false });
    expect(pin).toMatchObject({ surface: { kind: 'cylinder', radius: expect.closeTo(3, 6) }, convex: true });
    expect(hole).not.toHaveProperty('meshNormal');
    about(hole.area, 2 * Math.PI * 4 * 10);
    about(pin.area, 2 * Math.PI * 3 * 5);
  });

  it('edges: a line with its ends, a circle with its centre and radius, and a line a cut interrupts', () => {
    const engine = plate();
    const description = describeBody(engine, 'E1');
    const bottom = edgeOf(description, cap('E1', 'startCap'), side('E1', 'ra'));
    expect(bottom).toMatchObject({ kind: 'line', length: expect.closeTo(40, 4), segments: 1, gaps: false });
    if (bottom.kind !== 'line') throw new Error('a line is expected');
    expect([bottom.from, bottom.to].sort((a, b) => a[0] - b[0])).toEqual([close([0, 0, 0], 4), close([40, 0, 0], 4)]);
    const rim = edgeOf(description, cap('E1'), side('E1', 'h'));
    expect(rim).toMatchObject({ kind: 'circle', circle: { center: close([10, 10, 10], 4), radius: expect.closeTo(4, 4) } });
    expect(Math.abs(rim.length / (2 * Math.PI * 4) - 1)).toBeLessThan(0.01);
    expect(rim.segments).toBeGreaterThan(8);
    // a slot cut across the front edge of the top leaves it in two pieces
    run(engine, addSketch('S3', onFace('E1', cap('E1'))), rectangle('S3', 'q', 15, -5, 10, 10, null), addExtrude('SLOT', 'S3', [rectLoop('q')], -4, 'cut', 'E1'));
    const front = edgeOf(describeBody(engine, 'E1'), cap('E1'), side('E1', 'ra'));
    expect(front).toMatchObject({ kind: 'line', gaps: true, segments: 2, length: expect.closeTo(30, 4) });
  });

  it('a filter by feature and by kind: the faces of a feature and its copies, the edges with such a face, the totals of the whole body', () => {
    // From the Gridfinity session (2026-11-26): the whole description of the bin was 132,000
    // characters, too large for an answer, and the edges of one hole had to be dug out of it.
    const engine = plate();
    run(engine, {
      type: 'addFeature',
      feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'features', features: ['PIN'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: -15 } } },
    });
    const whole = describeBody(engine, 'E1');
    const filter = (args: object): BodyDescription => {
      const answer = engine.query('body', { body: 'E1', ...args });
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.result;
    };
    const pin = filter({ feature: 'PIN' });
    // the side and the top of the pin and of its copy; the edges at their foot and their top
    expect(pin.faces.map((face) => key(face.name)).sort()).toEqual(
      [side('PIN', 'k'), cap('PIN'), { ...side('PIN', 'k'), copy: [{ pattern: 'row', index: 1 }] }, { ...cap('PIN'), copy: [{ pattern: 'row', index: 1 }] }].map(key).sort(),
    );
    expect(pin.edges).toHaveLength(4);
    expect(pin.edges.every((edge) => edge.name.a.feature === 'PIN' || edge.name.b.feature === 'PIN')).toBe(true);
    expect(pin.total).toEqual({ faces: whole.faces.length, edges: whole.edges.length });
    expect(pin).toMatchObject({ volume: whole.volume, bounds: whole.bounds });
    // the copies alone, by the pattern
    expect(filter({ feature: 'row' }).faces.map((face) => face.name.copy)).toEqual([[{ pattern: 'row', index: 1 }], [{ pattern: 'row', index: 1 }]]);
    // one list alone
    expect(filter({ only: 'edges' })).toMatchObject({ faces: [], edges: whole.edges, total: pin.total });
    expect(filter({ feature: 'PIN', only: 'faces' })).toMatchObject({ faces: pin.faces, edges: [] });
    // no filter: no totals, the description as it was
    expect(whole.total).toBeUndefined();
    expect(engine.query('body', { body: 'E1', feature: 'nothing' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/the feature "nothing" is not in the state asked about/) } });
    // a feature that made no face of the body: empty lists
    expect(filter({ feature: 'S2' })).toMatchObject({ faces: [], edges: [] });
  });

  it('answers for the state asked about and keeps the description by the mesh', () => {
    const engine = plate();
    const early = describeBody(engine, 'E1', 'E1');
    expect(early.faces).toHaveLength(7);
    expect(early.bounds.max).toEqual(close([40, 30, 10], 4));
    expect(describeBody(engine, 'E1').faces).toHaveLength(9);
    // asked again without a change: the same lists
    expect(describeBody(engine, 'E1', 'E1').faces).toBe(early.faces);
    expect(describeBody(engine, 'E1').edges).toBe(describeBody(engine, 'E1').edges);
    expect(engine.query('body', { body: 'PIN' })).toEqual({ ok: false, error: { code: 'notAvailable', message: 'body: body: the body "PIN" is not in the state asked about', arg: ['body'] } });
  });

  it('a swept side has a surface and neither a normal nor a side of material', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), circle('S1', 'c', 0, 0, 9), {
      type: 'addFeature',
      feature: { id: 'G', name: 'G', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'c' }, params: { teeth: 18 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' },
    });
    const description = describeBody(engine, 'G');
    const teeth = faceOf(description, side('G', 'teeth'));
    expect(teeth.surface).toEqual({ kind: 'swept', axis: close([0, 0, 1]) });
    expect(teeth).not.toHaveProperty('convex');
    expect(teeth).not.toHaveProperty('meshNormal');
    expect(edgeOf(description, cap('G'), side('G', 'teeth'))).toMatchObject({ kind: 'other' });
  });
});
