// Mirror and pattern in a sketch (D68) without adapters: the form of the kind `pattern`, what the
// commands refuse, its entities, and the stage after the solver (the copies, the occupation pass,
// the joins by position, the open ends) over sketches whose solved positions are the positions the
// commands gave (a hand-made result, as in sketch-cut.test.ts). The cases with the solver and the
// kernel are in packages/scenarios/test/sketch-pattern.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, entityOf, entryInput, fieldsOf, referenceEntities } from '../src/document';
import { entryOrder, positionJoins } from '../src/references/derive';
import { entityIndex } from '../src/references/index';
import { sketchWorld, toolBase } from '../src/references/world';
import { type SketchCurve, type SketchGeometry, detectProfile, joinsOf, profileOf } from '../src/sketch';
import { type CurveChanges, contactFix, copyParts, curvePredicates, entryCommands, entryPatches, piecesOf, readersOf, reshapedProbes, sameTransform } from '../src/sketch-cut';
import type { Command, Constraint, Curve, Document, ExternalRef, Id, Input, SketchFeature, SketchPattern, SketchResult } from '../src/types';
import { LENGTH_TOLERANCE } from '../src/util';

const S = 'S';
const XY = { kind: 'base', plane: 'XY' } as const;
type Points = Record<Id, [number, number]>;
type Curves = Record<Id, Curve | [Curve, number]>;

function build(points: Points, curves: Curves, more: Command[] = [], constraints: Record<Id, Constraint> = {}): Document {
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch(S, S, XY) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: S, id, x, y })),
    ...Object.entries(curves).map(([id, c]): Command => (Array.isArray(c) ? { type: 'addCurve', sketch: S, id, curve: c[0], radius: c[1] } : { type: 'addCurve', sketch: S, id, curve: c })),
    ...Object.entries(constraints).map(([id, constraint]): Command => ({ type: 'addConstraint', sketch: S, id, constraint })),
    ...more,
  ];
  return commands.reduce<Document>(applyCommand, emptyDocument());
}
const sketchOf = (doc: Document): SketchFeature => doc.features.find((f) => f.id === S) as SketchFeature;
const add = (id: Id, ref: Input<SketchPattern>): Command => ({ type: 'addExternal', sketch: S, id, ref: ref as Input<ExternalRef> });
const lineOf = (a: Id, b: Id, construction = false): Curve => ({ ...(construction ? { construction: true } : {}), type: 'line', a, b });
const arcOf = (center: Id, start: Id, end: Id): Curve => ({ type: 'arc', center, start, end });
const refused = (doc: Document, command: Command): string => {
  try {
    applyCommand(doc, command);
    return 'accepted';
  } catch (error) {
    return (error as Error).message;
  }
};
// The world of the sketch over its own positions: the copies made by the core, as in the step.
function worldOf(doc: Document) {
  const sketch = sketchOf(doc);
  const points = { origin: { x: 0, y: 0 }, ...sketch.points };
  const result: SketchResult = { points, radii: { ...sketch.radii }, curves: {}, degreesOfFreedom: 0, conflicting: [], redundant: [], measurements: {}, valid: true, regions: [] };
  const world = sketchWorld(toolBase(sketch, result));
  const profile = profileOf([...world.curves.values()], world.joins, world.geometry, doc.settings.chordTolerance);
  return { world, profile, loops: profile.regions.map((r) => r.ref.outerLoop) };
}

// A square 10 × 10 at (x, y) with its points `${p}1..4` and lines `${p}a..d`.
const square = (p: string, x: number, y: number, size = 10): [Points, Curves] => [
  { [`${p}1`]: [x, y], [`${p}2`]: [x + size, y], [`${p}3`]: [x + size, y + size], [`${p}4`]: [x, y + size] },
  { [`${p}a`]: lineOf(`${p}1`, `${p}2`), [`${p}b`]: lineOf(`${p}2`, `${p}3`), [`${p}c`]: lineOf(`${p}3`, `${p}4`), [`${p}d`]: lineOf(`${p}4`, `${p}1`) },
];
const SQUARE = ['qa', 'qb', 'qc', 'qd'];

describe('the form of a mirror or pattern (D68)', () => {
  const doc = build(...square('q', 20, 0));
  it('takes each kind of transform with its fields, and refuses a field of another kind', () => {
    for (const ref of [
      { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } },
      { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 15 } } },
      { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'length', length: 30 }, second: { direction: 'origin/y', count: 2, span: { type: 'spacing', spacing: 15 } } } },
      { type: 'pattern', sources: SQUARE, transform: { type: 'circular', center: 'origin', count: 4, span: { type: 'full' } } },
      { type: 'pattern', sources: SQUARE, transform: { type: 'circular', center: 'origin', count: 4, span: { type: 'angle', angle: -1 } } },
    ] as Input<SketchPattern>[]) {
      expect(sketchOf(applyCommand(doc, add('p', ref))).external.p).toEqual(ref);
    }
    expect(refused(doc, add('p', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y', count: 2 } as never }))).toBe('addExternal.ref.transform.count: a transform of the type mirror has no such field');
    expect(refused(doc, add('p', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', plane: 'origin/y' } as never }))).toBe('addExternal.ref.transform.plane: a mirror in a sketch is about a line: `axis`, not `plane`');
    expect(refused(doc, add('p', { type: 'pattern', sources: SQUARE, transform: { type: 'circular', axis: 'origin', count: 2, span: { type: 'full' } } as never }))).toBe('addExternal.ref.transform.axis: a circular pattern in a sketch turns about a point: `center`, not `axis`');
    expect(refused(doc, add('p', { type: 'pattern', sources: SQUARE, transform: { type: 'circular', center: 'origin', count: 201, span: { type: 'full' } } }))).toContain('addExternal.ref.transform.count');
    expect(refused(doc, add('p', { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 0 } } }))).toContain('addExternal.ref.transform.span.spacing');
    expect(refused(doc, add('p', { type: 'pattern', sources: ['qa', 'qa'], transform: { type: 'mirror', axis: 'origin/y' } }))).toBe('addExternal.ref.sources: an ID is listed twice');
    expect(refused(doc, add('p', { type: 'pattern', sources: [], transform: { type: 'mirror', axis: 'origin/y' } }))).toContain('addExternal.ref.sources: a non-empty list');
  });

  it('a command asks the sketch: sources own, an axis or a direction a line that is no copy, a centre a point that is no copy', () => {
    const with_ = applyCommand(doc, add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } }));
    const withArc = build({ c: [0, 0], s: [5, 0], e: [0, 5] }, { r: arcOf('c', 's', 'e') });
    expect(refused(with_, add('p', { type: 'pattern', sources: ['m/1/qa'], transform: { type: 'mirror', axis: 'qa' } }))).toBe('addExternal.ref: the source "m/1/qa" is a copy of the mirror or pattern "m"; a mirror or pattern copies own curves and points of the sketch (and `origin`)');
    expect(refused(with_, add('p', { type: 'pattern', sources: ['origin/y'], transform: { type: 'mirror', axis: 'qa' } }))).toContain('the source "origin/y" is an axis of the origin');
    expect(refused(with_, add('p', { type: 'pattern', sources: ['nothing'], transform: { type: 'mirror', axis: 'qa' } }))).toContain('the source "nothing" is not in the sketch');
    expect(refused(withArc, add('p', { type: 'pattern', sources: ['r'], transform: { type: 'mirror', axis: 'r' } }))).toBe('addExternal.ref: the axis "r" is an own arc; it has to be a line of the sketch (own, projected, or an axis of the origin) that is not a copy');
    expect(refused(with_, add('p', { type: 'pattern', sources: ['qa'], transform: { type: 'linear', direction: 'm/1/qb', count: 2, span: { type: 'spacing', spacing: 3 } } }))).toContain('the direction "m/1/qb" is a copy of the mirror or pattern "m"');
    expect(refused(with_, add('p', { type: 'pattern', sources: ['qa'], transform: { type: 'circular', center: 'm/1/q1', count: 2, span: { type: 'full' } } }))).toContain('the center "m/1/q1" is a copy');
    expect(refused(with_, add('p', { type: 'pattern', sources: ['qa'], transform: { type: 'circular', center: 'qb', count: 2, span: { type: 'full' } } }))).toContain('the center "qb" is an own line');
    // the axes of the origin, an own construction line, origin and own points
    expect(refused(with_, add('p', { type: 'pattern', sources: ['q1', 'origin'], transform: { type: 'linear', direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 3 }, second: { direction: 'qb', count: 2, span: { type: 'spacing', spacing: 3 } } } }))).toBe('accepted');
  });

  it('an update asks only what it brings in; it may switch the kind of transform, not the source of the entry', () => {
    let d = applyCommand(doc, add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'qa' } }));
    d = applyCommand(d, { type: 'removeEntity', sketch: S, id: 'qa' });
    // the axis and a source are gone; the entry loads and an update that keeps them passes
    expect(sketchOf(d).external.m).toEqual({ type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'qa' } });
    expect(refused(d, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: [...SQUARE, 'q1'], transform: { type: 'mirror', axis: 'qa' } } as never })).toBe('accepted');
    // `qb` kept as a source but new as the axis is asked in its new role (it is a line: fine)
    expect(refused(d, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'qb' } } as never })).toBe('accepted');
    expect(refused(d, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: SQUARE, transform: { type: 'circular', center: 'q1', count: 3, span: { type: 'full' } } } as never })).toBe('accepted');
    expect(refused(d, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: SQUARE, transform: { type: 'circular', center: 'qb', count: 3, span: { type: 'full' } } } as never })).toContain('the center "qb" is an own line');
  });

  it('entities: by the count of the document in the listing, by the form of the ID one at a time', () => {
    let d = applyCommand(doc, add('r', { type: 'pattern', sources: ['qa', 'q3', 'origin'], transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 15 } } }));
    d = applyCommand(d, add('g', { type: 'pattern', sources: ['qb'], transform: { type: 'linear', direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 15 }, second: { direction: 'origin/y', count: 2, span: { type: 'spacing', spacing: 15 } } } }));
    d = applyCommand(d, add('m', { type: 'pattern', sources: ['qc'], transform: { type: 'mirror', axis: 'origin/y' } }));
    const s = sketchOf(d);
    const listing = (entry: Id) => Object.entries(referenceEntities(s, entry));
    expect(listing('r')).toEqual([
      ['r/1/qa', 'line'], ['r/1/q1', 'point'], ['r/1/q2', 'point'], ['r/1/q3', 'point'], ['r/1/origin', 'point'],
      ['r/2/qa', 'line'], ['r/2/q1', 'point'], ['r/2/q2', 'point'], ['r/2/q3', 'point'], ['r/2/origin', 'point'],
    ]);
    expect(listing('g').map(([id]) => id)).toEqual(['g/1/qb', 'g/1/q2', 'g/1/q3', 'g/1000/qb', 'g/1000/q2', 'g/1000/q3', 'g/1001/qb', 'g/1001/q2', 'g/1001/q3']);
    // one at a time: any number the transform may have, whatever the count; marked derived
    expect(entityOf(s, 'r/2/qa')).toEqual({ kind: 'line', own: false, derived: true });
    expect(entityOf(s, 'r/199/q2')).toEqual({ kind: 'point', own: false, derived: true });
    expect(entityOf(s, 'r/200/q2')).toBeUndefined();
    expect(entityOf(s, 'r/02/q2')).toBeUndefined();
    expect(entityOf(s, 'r/0/q2')).toBeUndefined();
    expect(entityOf(s, 'r/1/q4')).toBeUndefined(); // a point of no listed curve
    expect(entityOf(s, 'r/1/qb')).toBeUndefined(); // not listed
    expect(entityOf(s, 'r/1')).toBeUndefined();
    expect(entityOf(s, 'g/199199/qb')).toEqual({ kind: 'line', own: false, derived: true });
    expect(entityOf(s, 'g/200/qb')).toBeUndefined();
    expect(entityOf(s, 'g/1000/qb')).toEqual({ kind: 'line', own: false, derived: true });
    expect(entityOf(s, 'm/1/qc')).toEqual({ kind: 'line', own: false, derived: true });
    expect(entityOf(s, 'm/2/qc')).toBeUndefined();
  });

  it('a copy is no operand of a constraint, no point of a curve, nothing to remove, drag or construct', () => {
    const d = applyCommand(doc, add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } }));
    expect(refused(d, { type: 'addConstraint', sketch: S, id: 'k', constraint: { type: 'horizontal', line: 'm/1/qc' } })).toBe('addConstraint.constraint.line: "m/1/qc" is a copy of the mirror or pattern "m": a copy cannot be constrained in its own sketch, it is computed after the sketch is solved; constrain its source "qc", or project the copy in a later sketch');
    expect(refused(d, { type: 'addCurve', sketch: S, id: 'x', curve: lineOf('m/1/q1', 'q1') })).toContain('"m/1/q1" není vlastní bod skici ani počátek');
    expect(refused(d, { type: 'removeEntity', sketch: S, id: 'm/1/qa' })).toContain('není vlastní bod ani křivka');
    expect(refused(d, { type: 'dragPoint', sketch: S, point: 'm/1/q1', x: 0, y: 0 })).toContain('není vlastní bod');
    expect(refused(d, { type: 'setConstruction', sketch: S, id: 'm/1/qa', construction: true })).toContain('není křivka skici');
    expect(refused(d, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'edge', body: 'B', edge: { a: { feature: 'B', role: 'endCap' }, b: { feature: 'B', role: 'startCap' } }, kind: 'line' } })).toContain('updateExternal');
  });

  it('the fields: an expression in the count, the input form, fieldsOf of a grid, setField through the sketch', () => {
    let d = applyCommand(build(...square('q', 20, 0)), { type: 'setParameter', name: 'n', expr: '4' });
    d = applyCommand(d, add('g', { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 'n * 5' }, second: { direction: 'origin/y', count: 2, span: { type: 'length', length: 20 } } } }));
    const s = sketchOf(d);
    expect(s.expressions).toEqual({ 'external/g/transform/count': 'n', 'external/g/transform/span/spacing': 'n * 5' });
    expect(entryInput(s, 'g')).toEqual({ type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 'n * 5' }, second: { direction: 'origin/y', count: 2, span: { type: 'length', length: 20 } } } });
    expect(fieldsOf(s).map((field) => field.path)).toEqual(['external/g/transform/count', 'external/g/transform/span/spacing', 'external/g/transform/second/count', 'external/g/transform/second/span/length']);
    const set = applyCommand(d, { type: 'setField', feature: S, path: 'external/g/transform/second/count', value: 'n - 1' });
    expect(sketchOf(set).expressions?.['external/g/transform/second/count']).toBe('n - 1');
    expect(refused(d, { type: 'setField', feature: S, path: 'external/g/transform/second/span/spacing', value: 3 })).toContain('is not a numeric field');
    // removing the second direction by an update drops its expressions
    const row = applyCommand(set, { type: 'updateExternal', sketch: S, id: 'g', ref: { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 'n * 5' } } } as never });
    expect(sketchOf(row).expressions).toEqual({ 'external/g/transform/count': 'n', 'external/g/transform/span/spacing': 'n * 5' });
  });
});

describe('the copies (the stage after the solver, D68)', () => {
  it('a mirror: a line, an arc with its ends swapped, a circle with its radius, a point alone, origin in a copied curve', () => {
    const doc = build({ p: [10, 0], q: [10, 10], c: [20, 5], s: [25, 5], e: [20, 10], k: [30, 30], t: [40, 0] }, { l: lineOf('origin', 'p'), r: arcOf('c', 's', 'e'), o: [{ type: 'circle', center: 'k' }, 3] }, [add('m', { type: 'pattern', sources: ['l', 'r', 'o', 't'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const { world } = worldOf(doc);
    const shape = (id: Id) => world.curves.get(id)?.shape;
    expect(shape('m/1/l')).toEqual({ type: 'line', a: 'm/1/origin', b: 'm/1/p' });
    expect(shape('m/1/r')).toEqual({ type: 'arc', center: 'm/1/c', start: 'm/1/e', end: 'm/1/s' });
    expect(shape('m/1/o')).toEqual({ type: 'circle', center: 'm/1/k' });
    expect(world.geometry.radii['m/1/o']).toBe(3);
    expect(world.geometry.points['m/1/t']).toEqual({ x: -40, y: 0 });
    expect(world.geometry.points['m/1/s']).toEqual({ x: -25, y: 5 });
    expect(world.geometry.points['m/1/origin'].x).toBeCloseTo(0, 12);
    expect(world.curves.get('m/1/l')).toMatchObject({ source: 'derived', regions: true });
  });

  it('a row by a spacing, by a length, against the direction; a circle turned, an arc not swapped; a count of 1 has no copies', () => {
    const doc = build({ c: [10, 0], s: [12, 0], e: [10, 2], a: [0, 1], b: [1, 1] }, { r: arcOf('c', 's', 'e'), d: lineOf('a', 'b', true) }, [
      add('row', { type: 'pattern', sources: ['r'], transform: { type: 'linear', direction: 'd', count: 3, span: { type: 'spacing', spacing: -5 } } }),
      add('len', { type: 'pattern', sources: ['s'], transform: { type: 'linear', direction: 'origin/y', count: 5, span: { type: 'length', length: 8 } } }),
      add('turn', { type: 'pattern', sources: ['r'], transform: { type: 'circular', center: 'origin', count: 3, span: { type: 'angle', angle: -Math.PI } } }),
      add('one', { type: 'pattern', sources: ['r'], transform: { type: 'circular', center: 'origin', count: 1, span: { type: 'full' } } }),
    ]);
    const { world } = worldOf(doc);
    expect(world.geometry.points['row/2/c']).toEqual({ x: 0, y: 0 });
    expect(world.curves.get('row/1/r')?.shape).toEqual({ type: 'arc', center: 'row/1/c', start: 'row/1/s', end: 'row/1/e' });
    expect(world.geometry.points['len/4/s']).toEqual({ x: 12, y: 8 });
    expect(world.geometry.points['len/1/s']).toEqual({ x: 12, y: 2 });
    expect(world.geometry.points['turn/1/c'].x).toBeCloseTo(0, 12);
    expect(world.geometry.points['turn/1/c'].y).toBeCloseTo(-10, 12);
    expect(world.geometry.points['turn/2/c'].x).toBeCloseTo(-10, 12);
    expect(world.curves.get('turn/2/r')?.shape).toEqual({ type: 'arc', center: 'turn/2/c', start: 'turn/2/s', end: 'turn/2/e' });
    expect([...world.curves.keys()].filter((id) => id.startsWith('one/'))).toEqual([]);
    expect(world.derived.warnings).toEqual([]);
  });

  it('a grid numbers its copies i + 1000 · j; too many places or two in one make no copies and warn', () => {
    const base = build({ p: [0, 0] }, {}, [add('g', { type: 'pattern', sources: ['p'], transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 2 }, second: { direction: 'origin/y', count: 2, span: { type: 'spacing', spacing: -3 } } } })]);
    const { world } = worldOf(base);
    expect(Object.keys(world.derived.entries.g.points)).toEqual(['g/1/p', 'g/2/p', 'g/1000/p', 'g/1001/p', 'g/1002/p']);
    expect(world.geometry.points['g/1002/p']).toEqual({ x: 4, y: -3 });
    const large = applyCommand(base, { type: 'setField', feature: S, path: 'external/g/transform/second/count', value: 67 });
    expect(worldOf(large).world.derived.warnings).toEqual([{ code: 'brokenCopies', refs: ['g', 'external/g/transform/count', 'external/g/transform/second/count'], detail: '3 × 67 is 201 places; a pattern has at most 200, the source included' }]);
    expect(worldOf(large).world.derived.entries).toEqual({});
    const same = applyCommand(base, { type: 'updateExternal', sketch: S, id: 'g', ref: { type: 'pattern', sources: ['p'], transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 2 }, second: { direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 4 } } } } as never });
    expect(worldOf(same).world.derived.warnings[0]).toMatchObject({ code: 'brokenCopies', detail: 'the copies 2 and 1000 would stand in one place' });
  });

  it('an axis gone, a line of no length, a source gone: warnings; the rest copied', () => {
    let doc = build({ a: [0, 0], b: [0, 10], p: [5, 0], q: [5, 5], z: [3, 3], z2: [3, 3] }, { ax: lineOf('a', 'b'), l: lineOf('p', 'q'), k: lineOf('q', 'a'), nil: lineOf('z', 'z2') }, [add('m', { type: 'pattern', sources: ['l', 'k'], transform: { type: 'mirror', axis: 'ax' } }), add('n', { type: 'pattern', sources: ['l'], transform: { type: 'mirror', axis: 'nil' } })]);
    expect(worldOf(doc).world.derived.warnings).toEqual([{ code: 'brokenCopies', refs: ['n', 'nil'], detail: 'the axis: the line "nil" has no length' }]);
    doc = applyCommand(doc, { type: 'removeEntity', sketch: S, id: 'k' });
    const { world } = worldOf(doc);
    expect(world.derived.warnings[0]).toEqual({ code: 'brokenCopies', refs: ['m', 'k'], detail: '"k" is not an own curve or point of the sketch; the other sources are copied', geometry: world.derived.entries.m });
    expect(world.curves.has('m/1/l')).toBe(true);
    doc = applyCommand(doc, { type: 'removeEntity', sketch: S, id: 'ax' });
    expect(worldOf(doc).world.derived.warnings[0]).toEqual({ code: 'brokenCopies', refs: ['m', 'ax'], detail: 'the axis: "ax" is not a line of the sketch' });
  });

  it('a construction curve copies as one: no regions', () => {
    const doc = build({ p: [5, 0], q: [5, 5] }, { l: lineOf('p', 'q', true) }, [add('m', { type: 'pattern', sources: ['l'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    expect(worldOf(doc).world.curves.get('m/1/l')?.regions).toBe(false);
  });
});

describe('a copy that lies on what is there (the occupation pass)', () => {
  it('a circle at the centre of a circular pattern, a line through it turned by π: no regions; a half circle mirrored is the other half', () => {
    const turned = build({ a: [-5, 0], b: [5, 0] }, { o: [{ type: 'circle', center: 'origin' }, 3], d: lineOf('a', 'b', true) }, [add('p', { type: 'pattern', sources: ['o', 'd'], transform: { type: 'circular', center: 'origin', count: 2, span: { type: 'full' } } })]);
    const solid = applyCommand(turned, { type: 'setConstruction', sketch: S, id: 'd', construction: false });
    expect(worldOf(turned).world.curves.get('p/1/o')?.regions).toBe(false);
    // the construction diameter's copy forms no regions by its flag; a profile line's copy lies on it
    expect(worldOf(turned).world.curves.get('p/1/d')?.regions).toBe(false);
    expect(worldOf(solid).world.curves.get('p/1/d')?.regions).toBe(false);
    const doc = build({ t: [0, 10], u: [0, -10] }, { h: arcOf('origin', 'u', 't') }, [add('m', { type: 'pattern', sources: ['h'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const { world, loops } = worldOf(doc);
    expect(world.curves.get('m/1/h')?.regions).toBe(true);
    expect(loops).toContainEqual(['h', 'm/1/h']);
  });

  it('two mirrors that list one curve: the entry first in the order keeps the regions, an entry named by a whole number first', () => {
    const points: Points = { p: [10, 0], q: [5, 8], r: [0, 12] };
    const curves: Curves = { c1: lineOf('origin', 'p'), c2: lineOf('p', 'q'), c3: lineOf('q', 'r') };
    const mirror = (sources: Id[]): Input<SketchPattern> => ({ type: 'pattern', sources, transform: { type: 'mirror', axis: 'origin/y' } });
    const named = build(points, curves, [add('m', mirror(['c1', 'c2'])), add('n', mirror(['c2', 'c3']))]);
    const one = worldOf(named);
    expect(one.world.curves.get('m/1/c2')?.regions).toBe(true);
    expect(one.world.curves.get('n/1/c2')?.regions).toBe(false);
    expect(one.loops).toEqual([['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'n/1/c3']]);
    const numbered = build(points, curves, [add('m', mirror(['c1', 'c2'])), add('5', mirror(['c2', 'c3']))]);
    expect(entryOrder(sketchOf(numbered))).toEqual(['5', 'm']);
    expect(worldOf(numbered).world.curves.get('5/1/c2')?.regions).toBe(true);
    expect(worldOf(numbered).world.curves.get('m/1/c2')?.regions).toBe(false);
  });

  it('a copy on a construction guide or the image of a flank on a construction line keeps its regions', () => {
    // a half with a flank `f` at x = 10 and a construction line at x = −10: the image of the flank lies on it
    const doc = build({ p: [10, 0], q: [10, 8], r: [0, 8], g1: [-10, 0], g2: [-10, 8] }, { c1: lineOf('origin', 'p'), f: lineOf('p', 'q'), c3: lineOf('q', 'r'), guide: lineOf('g1', 'g2', true) }, [add('m', { type: 'pattern', sources: ['c1', 'f', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const { world, loops } = worldOf(doc);
    expect(world.curves.get('m/1/f')?.regions).toBe(true);
    expect(loops).toEqual([['c1', 'c3', 'f', 'm/1/c1', 'm/1/c3', 'm/1/f']]);
  });
});

describe('the joins by position (rules 1 to 3) and the open ends', () => {
  it('squares that share sides: a row and a grid', () => {
    const row = build(...square('q', 0, 0), [add('r', { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 4, span: { type: 'spacing', spacing: 10 } } })]);
    expect(worldOf(row).loops).toHaveLength(4);
    const grid = build(...square('q', 0, 0), [add('g', { type: 'pattern', sources: SQUARE, transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 10 }, second: { direction: 'origin/y', count: 3, span: { type: 'spacing', spacing: 10 } } } })]);
    const { loops, profile } = worldOf(grid);
    expect(profile.valid).toBe(true);
    expect(loops).toHaveLength(9);
  });

  it('a pie of sectors, a rack closed by an own line', () => {
    for (const count of [5, 6, 7, 24]) {
      const angle = (2 * Math.PI) / count;
      const pie = build({ a: [10, 0], b: [10 * Math.cos(angle), 10 * Math.sin(angle)] }, { s1: lineOf('origin', 'a'), s2: arcOf('origin', 'a', 'b') }, [add('p', { type: 'pattern', sources: ['s1', 's2'], transform: { type: 'circular', center: 'origin', count, span: { type: 'full' } } })]);
      const { loops, profile } = worldOf(pie);
      expect(profile.valid, `${count}`).toBe(true);
      expect(loops, `${count}`).toHaveLength(count);
    }
    // teeth of a rack along X, from (0, 0) to (40, 0), closed by an own line below
    const rack = build({ t0: [0, 0], t1: [2, 3], t2: [4, 0], b0: [0, -5], b1: [40, -5], e: [40, 0] }, { u1: lineOf('t0', 't1'), u2: lineOf('t1', 't2'), l0: lineOf('t0', 'b0'), lb: lineOf('b0', 'b1'), l1: lineOf('b1', 'e') }, [add('r', { type: 'pattern', sources: ['u1', 'u2'], transform: { type: 'linear', direction: 'origin/x', count: 10, span: { type: 'spacing', spacing: 4 } } })]);
    const { loops, world } = worldOf(rack);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(23);
    expect(world.derived.openEnds).toBeUndefined();
  });

  it('a copied point alone joins nothing; a copy that forms no regions takes no part', () => {
    // a rectangle 1.5e-6 wide; the image of a point at the middle of its bottom lands on nothing
    const doc = build({ p: [5, 0], q: [5, 8], r: [0, 8], x: [-1e-7, 0] }, { c1: lineOf('origin', 'p'), f: lineOf('p', 'q'), c3: lineOf('q', 'r', true) }, [add('m', { type: 'pattern', sources: ['c1', 'f', 'c3', 'x'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const { world } = worldOf(doc);
    // `m/1/x` at (1e-7, 0) is within the tolerance of `origin` and of `m/1/origin`: it joins neither
    expect(world.joins('m/1/x')).toBe('m/1/x');
    // the construction top and its image are no part of the joins: `m/1/r` stays a point of its own
    expect(world.joins('m/1/r')).toBe('m/1/r');
    // the open ends: the two ends of the open chain at the top
    expect(world.derived.openEnds?.ends.map((end) => end.end).sort()).toEqual(['m/1/q']);
  });

  it('a copy end at a place where two own ends are two vertices joins neither (twoVertices); joined by a coincident, it joins', () => {
    // own `c1` ends at `A`, own `c4` starts at `A2` at the same place, not joined
    const points: Points = { p: [10, 0], A: [0, 8], A2: [0, 8], s: [-10, 8] };
    const curves: Curves = { c1: lineOf('p', 'A'), c4: lineOf('A2', 's'), base: lineOf('origin', 'p') };
    const doc = build(points, curves, [add('m', { type: 'pattern', sources: ['c1'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const { world, profile } = worldOf(doc);
    expect(profile.valid).toBe(false); // as with the two own ends alone
    expect(world.joins('m/1/A')).toBe('m/1/A');
    expect(world.derived.openEnds?.ends.find((end) => end.end === 'm/1/A')).toEqual({ end: 'm/1/A', reason: 'twoVertices', near: ['A', 'A2'], distance: 0 });
    const joined = build(points, curves, [add('m', { type: 'pattern', sources: ['c1'], transform: { type: 'mirror', axis: 'origin/y' } })], { k: { type: 'coincident', a: 'A', b: 'A2' } });
    expect(worldOf(joined).world.joins('m/1/A')).toBe(worldOf(joined).world.joins('A'));
  });

  it('two source ends joined by a coincident: their images join by position', () => {
    // `c1` ends at `p1`, `c2` starts at `p2` at the same place; the half closes with its image
    const doc = build({ e: [10, 0], p1: [10, 5], p2: [10, 5], t: [0, 5] }, { c0: lineOf('origin', 'e'), c1: lineOf('e', 'p1'), c2: lineOf('p2', 't') }, [add('m', { type: 'pattern', sources: ['c0', 'c1', 'c2'], transform: { type: 'mirror', axis: 'origin/y' } })], { k: { type: 'coincident', a: 'p1', b: 'p2' } });
    const { loops, world } = worldOf(doc);
    expect(loops).toEqual([['c0', 'c1', 'c2', 'm/1/c0', 'm/1/c1', 'm/1/c2']]);
    expect(world.derived.openEnds).toBeUndefined();
  });

  it('an own end placed at the origin beside an axis of the origin: the axis does not keep the image from closing', () => {
    const doc = build({ o: [0, 0], p: [10, 0], q: [10, 8], r: [0, 8] }, { c1: lineOf('o', 'p'), f: lineOf('p', 'q'), c3: lineOf('q', 'r') }, [add('m', { type: 'pattern', sources: ['c1', 'f', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    expect(worldOf(doc).loops).toEqual([['c1', 'c3', 'f', 'm/1/c1', 'm/1/c3', 'm/1/f']]);
  });

  it('lists at most 20 open ends, those of twoVertices first, then by distance', () => {
    const doc = build({ a: [0, 0], b: [1, 0] }, { l: lineOf('a', 'b') }, [add('r', { type: 'pattern', sources: ['l'], transform: { type: 'linear', direction: 'origin/x', count: 30, span: { type: 'spacing', spacing: 3 } } })]);
    const open = worldOf(doc).world.derived.openEnds;
    expect(open?.count).toBe(58);
    expect(open?.ends).toHaveLength(20);
    expect(open?.ends.every((end, i) => i === 0 || (open.ends[i - 1].distance <= end.distance))).toBe(true);
  });

  // The stage takes the curves that are not own and form regions as it finds them among the curves
  // of the base: a flagged reference curve (6b, 6f) joins as a copy does, with no code of its own.
  it('flagged reference curves: four lines of a rectangle close with no key; an own end joins when it is the one own vertex there', () => {
    const geometry: SketchGeometry = { points: { origin: { x: 0, y: 0 }, x1a: { x: 0, y: 0 }, x1b: { x: 10, y: 0 }, x2a: { x: 10, y: 0 }, x2b: { x: 10, y: 5 }, x3a: { x: 10, y: 5 }, x3b: { x: 0, y: 5 }, x4a: { x: 0, y: 5 }, x4b: { x: 0, y: 0 }, p: { x: 10, y: 5 }, q: { x: 20, y: 5 }, r: { x: 10, y: 15 } }, radii: {} };
    const ref = (id: Id, a: Id, b: Id): SketchCurve => ({ id, shape: { type: 'line', a, b }, source: 'reference', regions: true });
    const own = (id: Id, a: Id, b: Id): SketchCurve => ({ id, shape: { type: 'line', a, b }, source: 'own', regions: true });
    const curves = [ref('x1', 'x1a', 'x1b'), ref('x2', 'x2a', 'x2b'), ref('x3', 'x3a', 'x3b'), ref('x4', 'x4a', 'x4b')];
    const sketch = sketchOf(build({}, {}));
    const closed = sketchWorld({ sketch, curves, geometry, pairs: [] });
    expect(profileOf([...closed.curves.values()], closed.joins, closed.geometry, 0.01).regions.map((r) => r.ref.outerLoop)).toEqual([['x1', 'x2', 'x3', 'x4']]);
    expect(closed.derived.openEnds).toBeUndefined();
    // a triangle of own lines from the corner (10, 5): its end `p` joins the corner
    const withOwn = sketchWorld({ sketch, curves: [...curves, own('t1', 'p', 'q'), own('t2', 'q', 'r'), own('t3', 'r', 'p')], geometry, pairs: [] });
    expect(withOwn.joins('p')).toBe(withOwn.joins('x2b'));
    // one flagged line alone: two open ends
    const alone = sketchWorld({ sketch, curves: [curves[0]], geometry, pairs: [] });
    expect(alone.derived.openEnds?.ends.map((end) => [end.end, end.reason])).toEqual([['x1a', 'apart'], ['x1b', 'apart']]);
  });

  // The grids of cells against all against all, on random places at jitters around the tolerance.
  it('gives the pairs and the open ends of the brute force', () => {
    let seed = 6;
    const rng = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const tol = LENGTH_TOLERANCE;
    for (let k = 0; k < 400; k++) {
      const points: Record<Id, { x: number; y: number }> = {};
      const curves: SketchCurve[] = [];
      const place = (): { x: number; y: number } => {
        const jitter = [0, 0.25, 0.5, 0.999, 1, 1.001, 1.5, 2.5][Math.floor(rng() * 8)] * tol * (rng() < 0.5 ? -1 : 1);
        return { x: Math.floor(rng() * 3) * 5 + jitter + (rng() < 0.3 ? tol * 0.5 : 0), y: Math.floor(rng() * 3) * 5 + jitter };
      };
      for (let i = 0; i < 12; i++) {
        const [a, b] = [`p${i}a`, `p${i}b`];
        points[a] = place();
        points[b] = place();
        curves.push({ id: `c${i}`, shape: { type: 'line', a, b }, source: rng() < 0.5 ? 'derived' : 'own', regions: rng() < 0.85 });
      }
      const geometry: SketchGeometry = { points, radii: {} };
      const { joins } = positionJoins(curves, geometry, []);
      // the brute force of rule 2: every pair of free ends within the tolerance is in one group
      const free = curves.filter((c) => c.source !== 'own' && c.regions).flatMap((c) => [(c.shape as { a: Id }).a, (c.shape as { b: Id }).b]);
      const groups = joinsOf(joins, geometry);
      for (const a of free) for (const b of free) if (a !== b && Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) <= tol) expect(groups(a), `case ${k}`).toBe(groups(b));
      for (const [a, b] of joins) expect(Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y)).toBeLessThanOrEqual(tol);
    }
  });
});

// ---------------------------------------------------------------- the sketch tools (point 4)

const handResult = (doc: Document): SketchResult => {
  const sketch = sketchOf(doc);
  return { points: { origin: { x: 0, y: 0 }, ...sketch.points }, radii: { ...sketch.radii }, curves: {}, degreesOfFreedom: 0, conflicting: [], redundant: [], measurements: {}, valid: true, regions: [] };
};
const changesOf = (over: Partial<CurveChanges>): CurveChanges => ({ changed: [], restarted: [], rekinded: [], removed: [], removedPoints: [], added: [], span: [], pieces: {}, stretches: [], ...over });

describe('the copies and the sketch tools (D68)', () => {
  it('a copy is named by its entry, copy number and source; other IDs are not copies', () => {
    const [p, c] = square('q', 2, 0);
    const sketch = sketchOf(build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } })]));
    expect(copyParts(sketch, 'm/1/qa')).toEqual({ entry: 'm', copy: '1', source: 'qa' });
    expect(copyParts(sketch, 'qa')).toBeUndefined();
    expect(copyParts(sketch, 'n/1/qa')).toBeUndefined();
    expect(copyParts(sketch, 'origin/y')).toBeUndefined();
  });

  it('contactFix: own against a copy and copies of two entries are none; the image of a contact of two sources is not listed', () => {
    const [p, c] = square('q', 2, 0);
    const doc = build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } }), add('r', { type: 'pattern', sources: ['qa'], transform: { type: 'linear', direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 1 } } })]);
    const sketch = sketchOf(doc);
    const { world } = worldOf(doc);
    const predicates = curvePredicates(doc, sketch);
    const curve = (id: Id): SketchCurve => world.curves.get(id) as SketchCurve;
    expect(contactFix(curve('qa'), curve('m/1/qb'), 'crossing', predicates, sketch)).toEqual({ fix: 'none', why: 'it is a copy of the mirror or pattern "m" ("m/1/qb"), which is never cut: move the curve or change the source of the copy' });
    expect(contactFix(curve('m/1/qa'), curve('m/1/qb'), 'crossing', predicates, sketch)).toBeUndefined();
    expect(contactFix(curve('m/1/qa'), curve('r/1/qa'), 'overlap', predicates, sketch)).toEqual({ fix: 'none', why: '"m/1/qa" and "r/1/qa" are copies, which are never cut: change their sources, the count or the spacing' });
  });

  it('sameTransform compares the input forms: an expression is its text', () => {
    const [p, c] = square('q', 2, 0);
    const row = (count: number | string): Input<SketchPattern> => ({ type: 'pattern', sources: ['qa'], transform: { type: 'linear', direction: 'origin/x', count, span: { type: 'spacing', spacing: 20 } } } as Input<SketchPattern>);
    const doc = build(p, c, [{ type: 'setParameter', name: 'n', expr: '3' }, add('a', row(3)), add('b', row(3)), add('e', row('n'))]);
    const sketch = sketchOf(doc);
    expect(sameTransform(sketch, 'a', 'b')).toBe(true);
    expect(sameTransform(sketch, 'a', 'e')).toBe(false);
  });

  it('entryPatches: pieces in place, a curve removed whole leaves the list, the last one stays; a split adds nothing; the axis removed', () => {
    const [p, c] = square('q', 2, 0);
    const doc = build({ ...p, l1: [-5, -20], l2: [-5, 20] }, { ...c, ax: lineOf('l1', 'l2', true) }, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'ax' } }), add('one', { type: 'pattern', sources: ['qc'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const sketch = sketchOf(doc);
    const base = toolBase(sketch, handResult(doc));
    const found = entryPatches(sketch, base, changesOf({ pieces: { qa: ['qa', 'qa2'] }, removed: ['qc', 'ax'] }), 'split');
    expect(found.patches).toEqual([{ entry: 'm', sources: ['qa', 'qa2', 'qb', 'qd'] }]); // `one` keeps its last source
    expect(found.orphaned).toEqual(['m']);
    expect(found.joined).toEqual([]);
    expect(entryCommands(sketch, found.patches)).toEqual([{ type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: ['qa', 'qa2', 'qb', 'qd'], transform: { type: 'mirror', axis: 'ax' } } }]);
  });

  it('entryPatches: a curve the batch made between two open ends of one entry joins it; between two entries only with the same transform, the first of them', () => {
    // two halves of an open chain `h1` (listed by `a`) and `h2` (by `b`), and a line `j` from the
    // free end of one to the free end of the other, made by the batch
    const points: Points = { p1: [0, 0], p2: [10, 0], p3: [20, 0], p4: [30, 0] };
    const curves: Curves = { h1: lineOf('p1', 'p2'), j: lineOf('p2', 'p3'), h2: lineOf('p3', 'p4'), k: lineOf('p4', 'p1') };
    const row = (source: Id, spacing: number): Input<SketchPattern> => ({ type: 'pattern', sources: [source], transform: { type: 'linear', direction: 'origin/y', count: 2, span: { type: 'spacing', spacing } } } as Input<SketchPattern>);
    for (const [spacing, expected] of [
      [50, ['a']],
      [60, []],
    ] as const) {
      const doc = build(points, curves, [add('a', row('h1', 50)), add('b', row('h2', spacing))]);
      const sketch = sketchOf(doc);
      const found = entryPatches(sketch, toolBase(sketch, handResult(doc)), changesOf({ added: ['j'] }), 'trim');
      expect(found.patches.map((patch) => patch.entry)).toEqual(expected);
      if (expected.length) {
        expect(found.patches[0].sources).toEqual(['h1', 'j']);
        expect(found.joined).toEqual([{ curve: 'j', entry: 'a', between: [{ entry: 'a', curve: 'h1' }, { entry: 'b', curve: 'h2' }] }]);
      }
    }
    // one entry listing both halves: `j` and `k` both stand between its open ends, `j` made by the batch
    const doc = build(points, curves, [add('a', { type: 'pattern', sources: ['h1', 'h2'], transform: { type: 'mirror', axis: 'origin/y' } })]);
    const sketch = sketchOf(doc);
    expect(entryPatches(sketch, toolBase(sketch, handResult(doc)), changesOf({ added: ['j'] }), 'trim').patches).toEqual([{ entry: 'a', sources: ['h1', 'h2', 'j'] }]);
    // a curve there already, with no end at a bound of a stretch the batch took out: stays out
    expect(entryPatches(sketch, toolBase(sketch, handResult(doc)), changesOf({}), 'trim').patches).toEqual([]);
    // the same made by a split: a split adds only pieces
    expect(entryPatches(sketch, toolBase(sketch, handResult(doc)), changesOf({ added: ['j'] }), 'split').patches).toEqual([]);
    // a span line never joins
    expect(entryPatches(sketch, toolBase(sketch, handResult(doc)), changesOf({ added: ['j'], span: ['j'] }), 'trim').patches).toEqual([]);
  });

  it('piecesOf reads a copy of a cut source as the copies of its listed pieces, whatever the copy number', () => {
    const [p, c] = square('q', 2, 0);
    const before = sketchOf(build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } })]));
    const after: SketchFeature = { ...before, external: { m: { ...(before.external.m as SketchPattern), sources: ['qa', 'qa2', 'qb', 'qc', 'qd'] } } };
    const changes = changesOf({ pieces: { qa: ['qa', 'qa2', 'qa3'] } });
    expect(piecesOf(changes, after, 'm/1/qa')).toEqual(['m/1/qa', 'm/1/qa2']);
    expect(piecesOf(changes, after, 'm/7/qa')).toEqual(['m/7/qa', 'm/7/qa2']);
    expect(piecesOf(changes, after, 'm/1/qb')).toBeUndefined();
  });

  it('reshapedProbes adds the images of a place under the copies of every entry that lists its curve', () => {
    const [p, c] = square('q', 2, 0);
    const doc = build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } }), add('r', { type: 'pattern', sources: ['qa'], transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 20 } } }), add('t', { type: 'pattern', sources: ['qb'], transform: { type: 'circular', center: 'origin', count: 4, span: { type: 'full' } } })]);
    const { world } = worldOf(doc);
    const probes = reshapedProbes(sketchOf(doc), world, [
      { curve: 'qa', at: [7, 0] },
      { curve: 'qb', at: [12, 5] },
    ]);
    const near = (q: [number, number]) => probes.some((r) => Math.abs(r[0] - q[0]) < 1e-9 && Math.abs(r[1] - q[1]) < 1e-9);
    for (const q of [[7, 0], [-7, 0], [27, 0], [47, 0], [12, 5], [-12, 5], [-5, 12], [-12, -5], [5, -12]] as [number, number][]) expect(near(q), String(q)).toBe(true);
    expect(probes).toHaveLength(9);
  });

  it('readersOf: an axis on a copy of a removed line is broken', () => {
    const [p, c] = square('q', 2, 0);
    let doc = build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } })]);
    doc = applyCommand(doc, { type: 'addFeature', feature: { id: 'rev', name: 'rev', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: S, regions: [{ outerLoop: SQUARE }] }, axis: { kind: 'sketchLine', sketch: S, line: 'm/1/qd' }, extent: { type: 'full' }, operation: 'new' } as never });
    expect(readersOf(doc, S, changesOf({ removed: ['qd'] })).broken).toEqual(['rev']);
    expect(readersOf(doc, S, changesOf({ removed: ['qb'] })).broken).toEqual([]);
  });
});

describe('the index of the entities of the entries (D68)', () => {
  it('is built once per sketch object, every entity with its kind and entry, and anew for a changed sketch', () => {
    const [p, c] = square('q', 2, 0);
    const doc = build(p, c, [add('m', { type: 'pattern', sources: SQUARE, transform: { type: 'mirror', axis: 'origin/y' } })]);
    const sketch = sketchOf(doc);
    const index = entityIndex(sketch);
    expect(entityIndex(sketch)).toBe(index);
    expect(index.entities.get('m/1/qa')).toEqual({ kind: 'line', entry: 'm' });
    expect(index.entities.get('m/1/q1')).toEqual({ kind: 'point', entry: 'm' });
    expect(index.byEntry.get('m')).toHaveLength(8);
    const changed = sketchOf(applyCommand(doc, { type: 'removeExternal', sketch: S, id: 'm' }));
    expect(entityIndex(changed).entities.size).toBe(0);
  });
});
