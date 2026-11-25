// The projection from another sketch (D69) without adapters: the map between two planes, the value
// of a projection over a hand-made state of the source, the form of the kind and what the commands
// refuse. The cases with the solver and the kernel are in packages/scenarios/test/projection.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, entityOf, referenceEntities, validateDocument } from '../src/document';
import { DUPLICATE, ENTITY_GONE, KIND_CHANGED, NOT_PARALLEL, NO_EXTENT, REGIONS_ON_A_POINT, SOURCE_NOT_EVALUATED, UNDER_ORIGIN, projectFromSketch, projection, sketchMap } from '../src/references/projection';
import type { SketchState } from '../src/recompute/state';
import { BASE } from '../src/recompute/services';
import type { SketchCurve } from '../src/sketch';
import { toPlane, toWorld } from '../src/solid';
import type { Command, CurveShape, Document, Frame, Id, Projected, SketchFeature, SketchProjection, Vec2, Vec3 } from '../src/types';

const XY = BASE.XY;
// a frame turned by `turn` about its normal, moved by `origin`, its normal flipped (x kept) when asked
const frameOf = (origin: Vec3, turn: number, flip = false): Frame => {
  const x: Vec3 = [Math.cos(turn), Math.sin(turn), 0];
  const y: Vec3 = flip ? [Math.sin(turn), -Math.cos(turn), 0] : [-Math.sin(turn), Math.cos(turn), 0];
  return { origin, x, y, normal: flip ? [0, 0, -1] : [0, 0, 1] };
};
// a frame tilted by `angle` about the X axis of the world
const tilted = (angle: number, z = 5): Frame => ({ origin: [0, 0, z], x: [1, 0, 0], y: [0, Math.cos(angle), Math.sin(angle)], normal: [0, -Math.sin(angle), Math.cos(angle)] });

// The state of a solved source as the recompute keeps it, from positions and curves.
function source(frame: Frame, points: Record<Id, Vec2>, curves: Record<Id, CurveShape>, radii: Record<Id, number> = {}): SketchState {
  return {
    feature: emptySketch('src', 'src', { kind: 'base', plane: 'XY' }),
    frame,
    geometry: { points: Object.fromEntries(Object.entries({ origin: [0, 0], ...points }).map(([id, [x, y]]) => [id, { x, y }])), radii },
    curves: new Map(Object.entries(curves).map(([id, shape]): [Id, SketchCurve] => [id, { id, shape, source: 'own', regions: true }])),
  } as unknown as SketchState;
}
const ref = (entity: Id, kind: SketchProjection['kind'], regions = false): SketchProjection => ({ type: 'sketch', sketch: 'src', entity, kind, regions });
const value = (answer: ReturnType<typeof projectFromSketch>): Projected => {
  if ('code' in answer) throw new Error(`${answer.code}: ${answer.detail}`);
  return answer;
};
const close = (a: Vec2, b: Vec2, digits = 9): void => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('the map between the planes of two sketches (D69)', () => {
  it('on exactly parallel planes is the projection along the normal, with any offset, shift and turn', () => {
    const to = frameOf([3, -2, 7], 0.7);
    const map = sketchMap(XY, to);
    expect(map.parallel).toBe(true);
    expect(map.flips).toBe(false);
    expect(map.angle).toBe(0);
    for (const p of [[0, 0], [10, 0], [-4, 25], [100, -300]] as Vec2[]) close(map.at(p), toPlane(to, toWorld(XY, p[0], p[1])));
  });

  it('flips across opposite normals and keeps every distance', () => {
    const to = frameOf([0, 0, -1.6], Math.PI, true);
    const map = sketchMap(XY, to);
    expect(map.parallel && map.flips).toBe(true);
    close(map.at([27, 17]), [-27, 17]);
    close(map.at([5, -3]), toPlane(to, toWorld(XY, 5, -3)));
  });

  it('within the tolerance is a rigid motion: lengths and radii exact, a point within d · θ² / 2 of the projection along the normal', () => {
    for (const angle of [5e-5, 9e-5]) {
      const to = tilted(angle);
      const map = sketchMap(XY, to);
      expect(map.parallel).toBe(true);
      expect(map.angle).toBeCloseTo(angle, 12);
      const [o, a, b] = [map.at([0, 0]), map.at([1000, 0]), map.at([0, 1000])];
      expect(Math.hypot(a[0] - o[0], a[1] - o[1])).toBeCloseTo(1000, 9);
      expect(Math.hypot(b[0] - o[0], b[1] - o[1])).toBeCloseTo(1000, 9);
      expect((a[0] - o[0]) * (b[0] - o[0]) + (a[1] - o[1]) * (b[1] - o[1])).toBeCloseTo(0, 9);
      const along = toPlane(to, toWorld(XY, 0, 1000));
      expect(Math.hypot(b[0] - along[0], b[1] - along[1])).toBeLessThanOrEqual((1000 * angle * angle) / 2 + 1e-12);
    }
    const beyond = sketchMap(XY, tilted(1.5e-4));
    expect(beyond.parallel).toBe(false);
    expect(beyond.angle).toBeCloseTo(1.5e-4, 12);
  });
});

describe('the value of a projection from a sketch (D69)', () => {
  const board = source(XY, { c: [27, 17], s: [30, 17], e: [27, 20], a: [0, 0], b: [10, 0], k: [5, 5] }, { arc: { type: 'arc', center: 'c', start: 's', end: 'e' }, l: { type: 'line', a: 'a', b: 'b' }, h: { type: 'circle', center: 'k' } }, { h: 1.6 });

  it('maps each kind into an offset, shifted and turned plane', () => {
    const to = frameOf([1, 2, 5], Math.PI / 2);
    const map = sketchMap(XY, to);
    expect(value(projectFromSketch(ref('k', 'point'), board, to))).toEqual({ kind: 'point', at: map.at([5, 5]) });
    expect(value(projectFromSketch(ref('origin', 'point'), board, to))).toEqual({ kind: 'point', at: map.at([0, 0]) });
    expect(value(projectFromSketch(ref('l', 'line'), board, to))).toEqual({ kind: 'line', a: map.at([0, 0]), b: map.at([10, 0]) });
    expect(value(projectFromSketch(ref('h', 'circle'), board, to))).toEqual({ kind: 'circle', center: map.at([5, 5]), radius: 1.6 });
    const arc = value(projectFromSketch(ref('arc', 'arc'), board, to)) as Extract<Projected, { kind: 'arc' }>;
    close(arc.center, map.at([27, 17]));
    close(arc.start, map.at([30, 17]));
    close(arc.end, map.at([27, 20]));
  });

  it('swaps the ends of an arc across opposite normals, so it stays counter-clockwise', () => {
    const under = frameOf([0, 0, -1.6], Math.PI, true);
    const arc = value(projectFromSketch(ref('arc', 'arc'), board, under)) as Extract<Projected, { kind: 'arc' }>;
    close(arc.center, [-27, 17]);
    close(arc.start, [-27, 20]); // the image of the source's end
    close(arc.end, [-30, 17]);
    const cross = (arc.start[0] - arc.center[0]) * (arc.end[1] - arc.center[1]) - (arc.start[1] - arc.center[1]) * (arc.end[0] - arc.center[0]);
    expect(cross).toBeGreaterThan(0);
  });

  it('makes an arc exact: its end on the circle of its start', () => {
    const off = source(XY, { c: [0, 0], s: [10, 0], e: [0, 10 + 1e-7] }, { q: { type: 'arc', center: 'c', start: 's', end: 'e' } });
    const arc = value(projectFromSketch(ref('q', 'arc'), off, frameOf([0, 0, 3], 0.3))) as Extract<Projected, { kind: 'arc' }>;
    const radius = (p: Vec2): number => Math.hypot(p[0] - arc.center[0], p[1] - arc.center[1]);
    expect(Math.abs(radius(arc.end) - radius(arc.start))).toBeLessThan(1e-12);
    expect(radius(arc.start)).toBeCloseTo(10, 12);
  });

  it('says why it cannot, with the detail', () => {
    expect(projectFromSketch(ref('l', 'line'), undefined, XY)).toEqual({ code: 'brokenProjection', detail: SOURCE_NOT_EVALUATED('src') });
    expect(projectFromSketch(ref('l', 'line'), board, tilted(0.3))).toEqual({ code: 'unsupportedProjection', detail: NOT_PARALLEL('src', 17.188733853924695) });
    expect(NOT_PARALLEL('src', (0.3 * 180) / Math.PI)).toBe('the plane of src is at 17.2° to this sketch; only a parallel plane is projected');
    expect(projectFromSketch(ref('bh3', 'circle'), board, XY)).toEqual({ code: 'brokenProjection', detail: ENTITY_GONE('src', 'bh3', 'circle') });
    expect(ENTITY_GONE('board', 'bh3', 'circle')).toBe('board has no circle bh3');
    expect(projectFromSketch(ref('arc', 'circle'), board, XY)).toEqual({ code: 'brokenProjection', detail: KIND_CHANGED('src', 'arc', 'arc', 'circle') });
    expect(KIND_CHANGED('board', 'c1', 'arc', 'circle')).toBe('c1 of board is an arc now, not a circle');
    expect(projectFromSketch(ref('k', 'line'), board, XY)).toEqual({ code: 'brokenProjection', detail: KIND_CHANGED('src', 'k', 'point', 'line') });
    expect(projectFromSketch(ref('l', 'point'), board, XY)).toEqual({ code: 'brokenProjection', detail: KIND_CHANGED('src', 'l', 'line', 'point') });
  });

  it('a curve with no extent is degenerateProjection, and nothing is NaN', () => {
    const flat = source(XY, { c: [0, 0], s: [10, 0], e: [0, 0], a: [1, 1], b: [1, 1], m: [Number.NaN, 0], k: [3, 3] }, { q: { type: 'arc', center: 'c', start: 's', end: 'e' }, l: { type: 'line', a: 'a', b: 'b' }, n: { type: 'line', a: 'm', b: 'k' }, h: { type: 'circle', center: 'k' } }, { h: 1e-9 });
    expect(projectFromSketch(ref('q', 'arc'), flat, XY)).toEqual({ code: 'degenerateProjection', detail: NO_EXTENT('src', 'q', 'arc') });
    expect(projectFromSketch(ref('l', 'line'), flat, XY)).toEqual({ code: 'degenerateProjection', detail: NO_EXTENT('src', 'l', 'line') });
    expect(projectFromSketch(ref('n', 'line'), flat, XY)).toEqual({ code: 'degenerateProjection', detail: NO_EXTENT('src', 'n', 'line') });
    expect(projectFromSketch(ref('h', 'circle'), flat, XY)).toEqual({ code: 'degenerateProjection', detail: NO_EXTENT('src', 'h', 'circle') });
    expect(projectFromSketch(ref('m', 'point'), flat, XY)).toEqual({ code: 'degenerateProjection', detail: NO_EXTENT('src', 'm', 'point') });
  });
});

// ---------------------------------------------------------------- the form and the commands

const S = (id: Id, plane = { kind: 'base', plane: 'XY' } as const): SketchFeature => emptySketch(id, id, plane);
function documentWith(...commands: Command[]): Document {
  let doc = emptyDocument();
  for (const command of commands) doc = applyCommand(doc, command);
  return doc;
}
const base = (): Document =>
  documentWith(
    { type: 'addFeature', feature: S('a') },
    { type: 'addPoint', sketch: 'a', id: 'p1', x: 0, y: 0 },
    { type: 'addPoint', sketch: 'a', id: 'p2', x: 10, y: 0 },
    { type: 'addPoint', sketch: 'a', id: 'p3', x: 0, y: 10 },
    { type: 'addCurve', sketch: 'a', id: 'l1', curve: { type: 'line', a: 'p1', b: 'p2' } },
    { type: 'addCurve', sketch: 'a', id: 'c1', curve: { type: 'circle', center: 'p3' }, radius: 2 },
    { type: 'addCurve', sketch: 'a', id: 'q1', curve: { type: 'arc', center: 'p1', start: 'p2', end: 'p3' } },
    { type: 'addFeature', feature: S('b') },
  );
const add = (doc: Document, id: Id, ref: Record<string, unknown>, sketch = 'b'): Document => applyCommand(doc, { type: 'addExternal', sketch, id, ref } as Command);
const sketchOf = (doc: Document, id: Id): SketchFeature => doc.features.find((f) => f.id === id) as SketchFeature;

describe('the entry `sketch` and its commands (D69)', () => {
  it('writes the flag as a boolean, false when left out; its entities by kind', () => {
    let doc = add(base(), 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' });
    doc = add(doc, 'x2', { type: 'sketch', sketch: 'a', entity: 'q1', kind: 'arc', regions: true });
    doc = add(doc, 'x3', { type: 'sketch', sketch: 'a', entity: 'c1', kind: 'circle' });
    doc = add(doc, 'x4', { type: 'sketch', sketch: 'a', entity: 'p3', kind: 'point' });
    const b = sketchOf(doc, 'b');
    expect(b.external.x1).toEqual({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: false });
    expect((b.external.x2 as SketchProjection).regions).toBe(true);
    expect(referenceEntities(b, 'x1')).toEqual({ x1: 'line', 'x1/a': 'point', 'x1/b': 'point' });
    expect(referenceEntities(b, 'x2')).toEqual({ x2: 'arc', 'x2/center': 'point', 'x2/start': 'point', 'x2/end': 'point' });
    expect(referenceEntities(b, 'x3')).toEqual({ x3: 'circle', 'x3/center': 'point' });
    expect(referenceEntities(b, 'x4')).toEqual({ x4: 'point' });
    expect(entityOf(b, 'x2/start')).toEqual({ kind: 'point', own: false });
    // a document saved and loaded keeps it
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('refuses what the form or the source does not allow', () => {
    const doc = base();
    const refused = (ref: Record<string, unknown>, text: string | RegExp, sketch = 'b', on = doc): void => expect(() => add(on, 'z', ref, sketch)).toThrow(text);
    refused({ type: 'sketch', sketch: 'a', entity: 'p1', kind: 'point', regions: true }, REGIONS_ON_A_POINT);
    refused({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', flag: true }, /flag/);
    refused({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'spline' }, /kind/);
    refused({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: 'yes' }, /regions/);
    refused({ type: 'sketch', sketch: 'b', entity: 'l1', kind: 'line' }, 'musí ležet před odkazující feature');
    refused({ type: 'sketch', sketch: 'b', entity: 'l1', kind: 'line' }, 'musí ležet před odkazující feature', 'a');
    refused({ type: 'sketch', sketch: 'a', entity: 'zz', kind: 'line' }, 'the sketch "a" has no entity "zz"');
    refused({ type: 'sketch', sketch: 'a', entity: 'c1', kind: 'arc' }, '"c1" is a circle, expected arc');
    refused({ type: 'sketch', sketch: 'a', entity: 'origin/x', kind: 'line' }, UNDER_ORIGIN('origin/x', 'a'));
    refused({ type: 'sketch', sketch: 'a', entity: 'origin/x/b', kind: 'point' }, UNDER_ORIGIN('origin/x/b', 'a'));
    const once = add(doc, 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' });
    refused({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: true }, DUPLICATE('l1', 'a', 'x1'), 'b', once);
    // a projected point under a constraint with a fixed operand alone is refused as before
    expect(() => applyCommand(add(doc, 'x4', { type: 'sketch', sketch: 'a', entity: 'p3', kind: 'point' }), { type: 'addConstraint', sketch: 'b', id: 'k', constraint: { type: 'pointOnCurve', point: 'x4', curve: 'origin/x' } })).toThrow('only between fixed entities');
  });

  it('a load refuses anything under origin/ and a duplicate, but not a source that is gone or of another kind', () => {
    const doc = add(base(), 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' });
    const tampered = (change: (b: any, a: any) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(doc));
      change(
        copy.features.find((f: SketchFeature) => f.id === 'b'),
        copy.features.find((f: SketchFeature) => f.id === 'a'),
      );
      return copy;
    };
    expect(() => validateDocument(tampered((b) => (b.external.x1.entity = 'origin/y')))).toThrow(UNDER_ORIGIN('origin/y', 'a'));
    expect(() => validateDocument(tampered((b) => (b.external.x2 = { ...b.external.x1 })))).toThrow(DUPLICATE('l1', 'a', 'x1'));
    expect(() => validateDocument(tampered((b) => (b.external.x2 = { type: 'sketch', sketch: 'a', entity: 'c1', kind: 'spline', regions: false })))).toThrow(/kind/);
    // the entity removed, or a circle under the ID of the line: a document made by commands loads
    expect(validateDocument(tampered((_b, a) => delete a.curves.l1))).toBeDefined();
    expect(validateDocument(tampered((_b, a) => (a.curves.l1 = { type: 'circle', center: 'p3' }, (a.radii.l1 = 1))))).toBeDefined();
    // a stored point never fits a line
    expect(() => validateDocument(tampered((b) => (b.solved.external = { x1: { kind: 'point', at: [0, 0] } })))).toThrow(/neodpovídá promítnuté geometrii skici/);
    expect(validateDocument(tampered((b) => (b.solved.external = { x1: { kind: 'line', a: [0, 0], b: [1, 0] } })))).toBeDefined();
  });

  it('updateExternal: the flag switched keeps the stored value and checks no reference; another entity is checked and drops it; the kind stays', () => {
    let doc = add(base(), 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' });
    const stored = { kind: 'line', a: [0, 0], b: [10, 0] } as const;
    doc = { ...doc, features: doc.features.map((f) => (f.id === 'b' ? { ...f, solved: { inputs: 'x', external: { x1: stored } } } : f)) } as Document;
    // the source entity gone
    doc = applyCommand(doc, { type: 'removeEntity', sketch: 'a', id: 'l1' });
    const switched = applyCommand(doc, { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: true } });
    expect(sketchOf(switched, 'b').external.x1).toEqual({ type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: true });
    expect(sketchOf(switched, 'b').solved.external.x1).toEqual(stored);
    // to an entity that is gone: refused
    expect(() => applyCommand(doc, { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'l9', kind: 'line' } })).toThrow('has no entity "l9"');
    // the form of the new entry is checked whole, the flag too
    expect(() => applyCommand(doc, { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: 1 } as never })).toThrow(/regions/);
    // another entity of the same kind: taken, the stored value dropped
    const other = applyCommand(base(), { type: 'addCurve', sketch: 'a', id: 'l2', curve: { type: 'line', a: 'p2', b: 'p3' } });
    let moved = add(other, 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' });
    moved = { ...moved, features: moved.features.map((f) => (f.id === 'b' ? { ...f, solved: { inputs: 'x', external: { x1: stored } } } : f)) } as Document;
    moved = applyCommand(moved, { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'l2', kind: 'line' } });
    expect(sketchOf(moved, 'b').solved.external.x1).toBeUndefined();
    // another kind: refused (an entity that stays keeps its kind)
    expect(() => applyCommand(other, { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'q1', kind: 'arc' } })).toThrow();
    expect(() => applyCommand(add(other, 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' }), { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'q1', kind: 'arc' } })).toThrow('druh promítnutí změnit nejde');
    // the entry itself is no duplicate of itself
    expect(() => applyCommand(add(other, 'x1', { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line' }), { type: 'updateExternal', sketch: 'b', id: 'x1', ref: { type: 'sketch', sketch: 'a', entity: 'l1', kind: 'line', regions: true } })).not.toThrow();
  });

  it('the summary and the example of the kind; keepsValue by the source', () => {
    expect(projection.example.ref).toEqual({ type: 'sketch', sketch: 'base', entity: 'b1', kind: 'line', regions: false });
    expect(projection.keepsValue?.(ref('l', 'line'), ref('l', 'line', true))).toBe(true);
    expect(projection.keepsValue?.(ref('l', 'line'), { ...ref('l', 'line'), entity: 'm' })).toBe(false);
  });
});
