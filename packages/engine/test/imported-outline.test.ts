// The imported outline (D72) without adapters: the validator of the kind, its entities, the
// placement and the geometry, the stored value and the stamp, the partial update and the rule of an
// update. The cases with the solver and the kernel are in packages/scenarios/test/imported-outline.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, entityOf, referenceEntities, validateDocument } from '../src/document';
import { OUTLINE_LIMITS, OUTLINE_REFUSALS, curveProblem } from '../src/imported-curve';
import { ENTITY_KIND_CHANGED, ENTITY_TAKEN, narrowed, resolveReferences, storedValue } from '../src/references/index';
import { outlineGeometry, placeOutline } from '../src/references/outline';
import { solverSetup } from '../src/sketch';
import type { Command, Document, Id, ImportedCurve, PlacedOutline, SketchFeature, SketchOutline, Vec2 } from '../src/types';

const S = 's';
const sketchOf = (doc: Document): SketchFeature => doc.features.find((f) => f.id === S) as SketchFeature;
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const add = (id: Id, ref: Record<string, unknown>): Command => ({ type: 'addExternal', sketch: S, id, ref }) as Command;
const update = (id: Id, ref: Record<string, unknown>): Command => ({ type: 'updateExternal', sketch: S, id, ref }) as Command;
const base = (): Document => applyCommand(emptyDocument(), { type: 'addFeature', feature: emptySketch(S, S, { kind: 'base', plane: 'XY' }) });

// a board 60 × 40 with rounded corners of 3 and four holes, in page coordinates as a PCB tool writes it
function board(width = 60): Record<Id, ImportedCurve> {
  const [x0, y0, x1, y1, r] = [100, 80, 100 + width, 120, 3];
  return {
    l1: { type: 'line', a: [x0 + r, y0], b: [x1 - r, y0] },
    l2: { type: 'line', a: [x1, y0 + r], b: [x1, y1 - r] },
    l3: { type: 'line', a: [x1 - r, y1], b: [x0 + r, y1] },
    l4: { type: 'line', a: [x0, y1 - r], b: [x0, y0 + r] },
    a1: { type: 'arc', center: [x1 - r, y0 + r], start: [x1 - r, y0], end: [x1, y0 + r] },
    a2: { type: 'arc', center: [x1 - r, y1 - r], start: [x1, y1 - r], end: [x1 - r, y1] },
    a3: { type: 'arc', center: [x0 + r, y1 - r], start: [x0 + r, y1], end: [x0, y1 - r] },
    a4: { type: 'arc', center: [x0 + r, y0 + r], start: [x0, y0 + r], end: [x0 + r, y0] },
    c1: { type: 'circle', center: [x0 + 3.5, y0 + 3.5], radius: 1.6 },
    c2: { type: 'circle', center: [x1 - 3.5, y0 + 3.5], radius: 1.6 },
    c3: { type: 'circle', center: [x1 - 3.5, y1 - 3.5], radius: 1.6 },
    c4: { type: 'circle', center: [x0 + 3.5, y1 - 3.5], radius: 1.6 },
  };
}
const withBoard = (more: Record<string, unknown> = {}): Document => run(base(), add('o', { type: 'outline', curves: board(), ...more }));
const entry = (doc: Document, id: Id = 'o'): SketchOutline => sketchOf(doc).external[id] as SketchOutline;
const refused = (doc: Document, command: Command): string => {
  try {
    applyCommand(doc, command);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the command was taken');
};
const spline = (points: Vec2[]): ImportedCurve => ({ type: 'spline', points });

describe('the validator of the kind outline (D72)', () => {
  it('takes an outline with its defaults, stores every curve given, and lists the entities in the order of the curves', () => {
    const doc = withBoard();
    const ref = entry(doc);
    expect(ref).toMatchObject({ type: 'outline', x: 0, y: 0, turn: 0, anchor: 'origin', regions: true });
    expect(ref.name).toBeUndefined();
    expect(ref.readWith).toBeUndefined();
    expect(Object.keys(ref.curves)).toEqual(Object.keys(board()));
    expect(ref.curves).toEqual(board());
    const entities = referenceEntities(sketchOf(doc), 'o');
    expect(Object.keys(entities).slice(0, 6)).toEqual(['o/l1', 'o/l1/a', 'o/l1/b', 'o/l2', 'o/l2/a', 'o/l2/b']);
    expect(Object.keys(entities)).toHaveLength(4 * 3 + 4 * 4 + 4 * 2);
  });

  it.each([
    ['no curves', {}, OUTLINE_REFUSALS.count('addExternal.ref', 0)],
    ['a local ID with a dash', { 'l-1': { type: 'line', a: [0, 0], b: [1, 0] } }, OUTLINE_REFUSALS.localId('addExternal.ref', 'l-1')],
    ['a local ID of 33 characters', { ['l'.repeat(33)]: { type: 'line', a: [0, 0], b: [1, 0] } }, OUTLINE_REFUSALS.localId('addExternal.ref', 'l'.repeat(33))],
    ['the local ID constructor', { constructor: { type: 'line', a: [0, 0], b: [1, 0] } }, OUTLINE_REFUSALS.localId('addExternal.ref', 'constructor')],
    ['the local ID toString', { toString: { type: 'line', a: [0, 0], b: [1, 0] } }, OUTLINE_REFUSALS.localId('addExternal.ref', 'toString')],
    ['a line of no length', { l1: { type: 'line', a: [0, 0], b: [0, 5e-7] } }, OUTLINE_REFUSALS.noLength('addExternal.ref.curves.l1')],
    ['a circle under the tolerance', { c1: { type: 'circle', center: [0, 0], radius: 1e-7 } }, OUTLINE_REFUSALS.noRadius('addExternal.ref.curves.c1')],
    ['an arc of a whole turn', { a1: { type: 'arc', center: [0, 0], start: [1, 0], end: [1, 0] } }, OUTLINE_REFUSALS.arcWhole('addExternal.ref.curves.a1')],
    ['a spline of two points', { s1: spline([[0, 0], [1, 1]]) }, OUTLINE_REFUSALS.splinePoints('addExternal.ref.curves.s1')],
    ['a spline of 65 points', { s1: spline(Array.from({ length: 65 }, (_, i): Vec2 => [i, i % 2])) }, OUTLINE_REFUSALS.splinePoints('addExternal.ref.curves.s1')],
    ['a closed spline of three points', { s1: spline([[0, 0], [1, 1], [0, 0]]) }, OUTLINE_REFUSALS.splinePoints('addExternal.ref.curves.s1')],
    ['a spline whose ends are near and not one place', { s1: spline([[0, 0], [1, 1], [2, 0], [5e-7, 0]]) }, OUTLINE_REFUSALS.splineEnds('addExternal.ref.curves.s1')],
    ['a spline of no extent', { s1: spline([[0, 0], [1e-7, 0], [2e-7, 0], [0, 0]]) }, OUTLINE_REFUSALS.noExtent('addExternal.ref.curves.s1')],
    ['points that are no list', { s1: { type: 'spline', points: 'none' } }, OUTLINE_REFUSALS.points('addExternal.ref.curves.s1')],
    ['an expression in a position', { l1: { type: 'line', a: ['w', 0], b: [1, 0] } }, OUTLINE_REFUSALS.expression('addExternal.ref.curves.l1.a')],
  ])('refuses %s', (_what, curves, text) => {
    expect(refused(base(), add('o', { type: 'outline', curves }))).toContain(text);
  });

  it('refuses an outline without curves, more than 2000 curves, and more than 2000 control points of splines', () => {
    expect(refused(base(), add('o', { type: 'outline' }))).toContain(OUTLINE_REFUSALS.missingCurves('addExternal.ref'));
    const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`l${i + 1}`, { type: 'line', a: [i, 0], b: [i, 1] }]));
    expect(refused(base(), add('o', { type: 'outline', curves: many }))).toContain(OUTLINE_REFUSALS.count('addExternal.ref', 2001));
    const splines = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i + 1}`, spline([[i, 0], [i, 1], [i + 0.5, 1], [i + 0.5, 0]])]));
    expect(() => run(base(), add('o', { type: 'outline', curves: splines(500) }))).not.toThrow();
    expect(refused(base(), add('o', { type: 'outline', curves: splines(501) }))).toContain(OUTLINE_REFUSALS.control('addExternal.ref', 2004));
  });

  it('refuses the local ID __proto__ of parsed JSON, and leaves Object.prototype alone', () => {
    const curves = JSON.parse('{"__proto__": {"type": "line", "a": [0, 0], "b": [1, 0]}}');
    expect(refused(base(), add('o', { type: 'outline', curves }))).toContain(OUTLINE_REFUSALS.localId('addExternal.ref', '__proto__'));
    expect(({} as Record<string, unknown>).type).toBeUndefined();
  });

  it('refuses the ends of an arc more than the tolerance off one radius, by the size of the coordinates and never more than 1e-7 mm', () => {
    const arc = (c: number, off: number): ImportedCurve => ({ type: 'arc', center: [c, c], start: [c + 10, c], end: [c, c + 10 + off] });
    expect(curveProblem(arc(0, 5e-10), 'a')).toBeUndefined();
    expect(curveProblem(arc(0, 5e-8), 'a')).toContain('off one radius');
    expect(curveProblem(arc(1000, 5e-8), 'a')).toBeUndefined();
    // at coordinates of 1e5 the relative tolerance would be 1e-4; the cap is a tenth of the join
    expect(curveProblem(arc(1e5, 5e-7), 'a')).toContain(`(at most ${OUTLINE_LIMITS.arcMost})`);
  });

  it('takes control points of a spline at one place, as both readers give them', () => {
    expect(curveProblem(spline([[0, 0], [0, 0], [5, 5], [10, 0]]), 's')).toBeUndefined();
    expect(curveProblem(spline([[0, 0], [5, 5], [10, 0], [10, 0]]), 's')).toBeUndefined();
    expect(curveProblem(spline([[0, 0], [5, 5], [10, 0], [0, 0]]), 's')).toBeUndefined();
  });

  it('reads name, readWith, the fields and the anchor; an empty name is no name; checks readWith by its form', () => {
    const doc = withBoard({ name: '', readWith: { format: 'dxf', layers: ['Edge.Cuts'], weld: 0.01 }, x: 5, y: '2 * 3', turn: 0.5, anchor: 'center', regions: false });
    const ref = entry(doc);
    expect(ref).toMatchObject({ x: 5, y: 6, turn: 0.5, anchor: 'center', regions: false, readWith: { format: 'dxf', layers: ['Edge.Cuts'], weld: 0.01 } });
    expect(ref.name).toBeUndefined();
    expect(sketchOf(doc).expressions).toEqual({ 'external/o/y': '2 * 3' });
    expect(refused(base(), add('o', { type: 'outline', curves: board(), readWith: { format: 'dxf', layers: [] } }))).toContain('readWith.layers');
    expect(refused(base(), add('o', { type: 'outline', curves: board(), readWith: { format: 'dxf', scale: 2 } }))).toContain('readWith.scale');
    expect(refused(base(), add('o', { type: 'outline', curves: board(), anchor: 'corner' }))).toContain('anchor');
    expect(refused(base(), add('o', { type: 'outline', curves: board(), turn: 7 }))).toContain('turn');
    expect(refused(base(), add('o', { type: 'outline', curves: board(), sketch: 'b' }))).toContain('an imported outline has no such field');
  });

  it('never holds the caller object, freezes its own copy, and keeps it across commands', () => {
    const curves = board();
    let doc = run(base(), add('o', { type: 'outline', curves }));
    const stored = entry(doc).curves;
    expect(stored).not.toBe(curves);
    curves.l1 = { type: 'line', a: [0, 0], b: [1, 0] };
    expect(entry(doc).curves.l1).toEqual(board().l1);
    expect(Object.isFrozen(stored) && Object.isFrozen(stored.l1) && Object.isFrozen((stored.l1 as { a: Vec2 }).a)).toBe(true);
    doc = run(doc, { type: 'addPoint', sketch: S, id: 'p', x: 1, y: 2 });
    expect(entry(doc).curves).toBe(stored);
    doc = run(doc, update('o', { type: 'outline', regions: false }));
    expect(entry(doc).curves).toBe(stored);
    // two entries over one object of curves
    doc = run(doc, add('o2', { type: 'outline', curves: stored, x: 100 }));
    expect(entry(doc, 'o2').curves).toBe(stored);
  });

  it('loads a saved document with an outline as it was', () => {
    const doc = run(base(), { type: 'setParameter', name: 'w', expr: '3' }, add('o', { type: 'outline', curves: board(), name: 'board.dxf', anchor: 'center', x: 'w' }));
    const loaded = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(entry(loaded)).toEqual(entry(doc));
    expect(sketchOf(loaded).expressions).toEqual({ 'external/o/x': 'w' });
  });
});

describe('the entities of an outline (D72)', () => {
  it('answers one ID with one look-up, as entityOf asks it', () => {
    const curves = { ...board(), s1: spline([[0, 0], [1, 2], [3, 2], [4, 0]]), s2: spline([[0, 0], [1, 2], [3, 2], [0, 0]]) };
    const sketch = sketchOf(run(base(), add('o', { type: 'outline', curves })));
    const kind = (id: Id) => entityOf(sketch, id)?.kind;
    expect([kind('o/l1'), kind('o/l1/a'), kind('o/l1/b'), kind('o/l1/center')]).toEqual(['line', 'point', 'point', undefined]);
    expect([kind('o/c1'), kind('o/c1/center'), kind('o/c1/a')]).toEqual(['circle', 'point', undefined]);
    expect([kind('o/a1'), kind('o/a1/center'), kind('o/a1/start'), kind('o/a1/end')]).toEqual(['arc', 'point', 'point', 'point']);
    expect([kind('o/s1'), kind('o/s1/0'), kind('o/s1/3'), kind('o/s1/4'), kind('o/s1/01')]).toEqual(['spline', 'point', 'point', undefined, undefined]);
    // a closed spline lists its first point once
    expect([kind('o/s2/2'), kind('o/s2/3')]).toEqual(['point', undefined]);
    expect([kind('o'), kind('o/'), kind('o/x9'), kind('o/constructor'), kind('o/__proto__'), kind('o/l1/a/b')]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(entityOf(sketch, 'o/l1')).toEqual({ kind: 'line', own: false });
    expect(Object.keys(referenceEntities(sketch, 'o')).filter((id) => id.startsWith('o/s2'))).toEqual(['o/s2', 'o/s2/0', 'o/s2/1', 'o/s2/2']);
  });

  it('a constraint names an entity with an own operand; its own rule reads the points of an outline curve', () => {
    let doc = run(withBoard(), { type: 'addPoint', sketch: S, id: 'p', x: 0, y: 0 });
    doc = run(doc, { type: 'addConstraint', sketch: S, id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } });
    expect(refused(doc, { type: 'addConstraint', sketch: S, id: 'k2', constraint: { type: 'coincident', a: 'o/l1/b', b: 'o/a1/start' } })).toContain('only between fixed entities');
    // a point on its own curve is refused by the rule of pointOnCurve: the outline's line holds its ends
    expect(refused(doc, { type: 'addConstraint', sketch: S, id: 'k3', constraint: { type: 'pointOnCurve', point: 'o/l1/a', curve: 'o/l1' } })).toBeTruthy();
    expect(refused(doc, { type: 'addConstraint', sketch: S, id: 'k4', constraint: { type: 'pointOnCurve', point: 'p', curve: 'o/s1' } })).toContain('"o/s1"');
  });
});

describe('the placement, the geometry and the stored value of an outline (D72)', () => {
  const ref = (more: Partial<SketchOutline> = {}): SketchOutline => entry(withBoard(more as Record<string, unknown>));

  it('the anchor origin keeps the coordinates of the file; a turn of 0 moves no digit', () => {
    const value = placeOutline(ref());
    expect(value).toMatchObject({ kind: 'outline', at: [0, 0], turn: 0 });
    const geometry = outlineGeometry('o', ref(), value);
    expect(geometry.points['o/l1/a']).toEqual({ x: 103, y: 80 });
    expect(geometry.radii['o/c1']).toBe(1.6);
    expect(geometry.curves['o/a1']).toEqual({ type: 'arc', center: 'o/a1/center', start: 'o/a1/start', end: 'o/a1/end' });
    expect(geometry.regions).toEqual(Object.keys(board()).map((local) => `o/${local}`));
    expect(outlineGeometry('o', ref({ regions: false }), value).regions).toEqual([]);
  });

  it('the anchor center lands the centre of the box at (x, y) and turns the outline about it', () => {
    const value = placeOutline(ref({ anchor: 'center' }));
    expect(value.at).toEqual([-130, -100]);
    const turned = ref({ anchor: 'center', x: 10, y: 20, turn: Math.PI / 2 });
    const geometry = outlineGeometry('o', turned, placeOutline(turned));
    // the corner (160, 80) of the file is (30, -20) from the centre; a quarter turn makes it (20, 30)
    const corner = geometry.points['o/l2/a'];
    expect(corner.x).toBeCloseTo(10 + 20 - 3, 9);
    expect(corner.y).toBeCloseTo(20 + 30, 9);
  });

  it('puts the end of an arc on the circle of its start, exactly', () => {
    const r = 1e5;
    const curves = { a1: { type: 'arc', center: [r, r], start: [r + 3, r], end: [r, r + 3 + 1e-8] } };
    const outline = entry(run(base(), add('o', { type: 'outline', curves, turn: 0.3 })));
    const g = outlineGeometry('o', outline, placeOutline(outline));
    const [c, s, e] = [g.points['o/a1/center'], g.points['o/a1/start'], g.points['o/a1/end']];
    expect(Math.abs(Math.hypot(s.x - c.x, s.y - c.y) - Math.hypot(e.x - c.x, e.y - c.y))).toBeLessThan(1e-9);
  });

  it('keeps the geometry per entry object, and two entries over one object of curves keep theirs', () => {
    let doc = withBoard();
    doc = run(doc, add('p', { type: 'outline', curves: entry(doc).curves, x: 100 }));
    const [o, p] = [entry(doc, 'o'), entry(doc, 'p')];
    const go = outlineGeometry('o', o, placeOutline(o));
    const gp = outlineGeometry('p', p, placeOutline(p));
    expect(outlineGeometry('o', o, placeOutline(o))).toBe(go);
    expect(outlineGeometry('p', p, placeOutline(p))).toBe(gp);
    expect(gp.points['p/l1/a'].x).toBe(go.points['o/l1/a'].x + 100);
  });

  it('the value is the placement and the fingerprint; the stamp changes with the place or the curves, not with the flag, the name or readWith', () => {
    const stamp = (doc: Document): string => {
      const { resolved } = resolveReferences(sketchOf(doc), {} as never);
      return solverSetup(sketchOf(doc), resolved).stamp;
    };
    const doc = withBoard();
    const value = placeOutline(entry(doc));
    expect(Object.keys(value).sort()).toEqual(['at', 'data', 'kind', 'turn']);
    expect(JSON.stringify(value).length).toBeLessThan(100);
    const first = stamp(doc);
    expect(stamp(run(doc, update('o', { type: 'outline', regions: false })))).toBe(first);
    expect(stamp(run(doc, update('o', { type: 'outline', name: 'other.dxf', readWith: { format: 'svg' } })))).toBe(first);
    expect(stamp(run(doc, update('o', { type: 'outline', x: 1 })))).not.toBe(first);
    expect(stamp(run(doc, update('o', { type: 'outline', curves: board(62) })))).not.toBe(first);
  });

  it('reads a stored placement and the stored positions of before; refuses a malformed one', () => {
    expect(storedValue({ kind: 'outline', at: [1, 2], turn: 0, data: 'x' }, 'v')).toEqual({ kind: 'outline', at: [1, 2], turn: 0, data: 'x' });
    expect(storedValue({ kind: 'point', at: [1, 2] }, 'v')).toEqual({ kind: 'point', at: [1, 2] });
    expect(storedValue({ kind: 'circle', center: [1, 2], radius: 3 }, 'v')).toEqual({ kind: 'circle', center: [1, 2], radius: 3 });
    expect(() => storedValue({ kind: 'outline', at: [1], turn: 0, data: 'x' }, 'v')).toThrow('v.at');
    const doc = withBoard();
    const saved = JSON.parse(JSON.stringify(doc));
    saved.features[0].solved.external = { o: placeOutline(entry(doc)) };
    expect(sketchOf(validateDocument(saved)).solved.external.o).toEqual(placeOutline(entry(doc)));
    saved.features[0].solved.external = { o: { kind: 'point', at: [0, 0] } };
    expect(() => validateDocument(saved)).toThrow('neodpovídá');
  });
});

describe('the solver gets what the constraints name (D72)', () => {
  it('narrows the geometry of an outline to the named curves with their points and radii, and named points', () => {
    const doc = withBoard();
    const outline = entry(doc);
    const whole = outlineGeometry('o', outline, placeOutline(outline));
    expect(narrowed(whole, new Set())).toEqual({ points: {}, curves: {}, radii: {}, regions: [] });
    const part = narrowed(whole, new Set(['o/c1', 'o/l2/b', 'o/a1']));
    expect(Object.keys(part.curves)).toEqual(['o/a1', 'o/c1']);
    expect(Object.keys(part.points)).toEqual(['o/l2/b', 'o/a1/center', 'o/a1/start', 'o/a1/end', 'o/c1/center']);
    expect(part.radii).toEqual({ 'o/c1': 1.6 });
  });

  it('the input of the solver holds only what the constraints name; a sketch without an outline keeps its stamp', () => {
    let doc = withBoard();
    doc = run(doc, { type: 'addPoint', sketch: S, id: 'p', x: 0, y: 0 });
    const input = () => {
      const { resolved } = resolveReferences(sketchOf(doc), {} as never);
      return solverSetup(sketchOf(doc), resolved).input;
    };
    expect(Object.keys(input().points)).toEqual(['origin', 'p']);
    doc = run(doc, { type: 'addConstraint', sketch: S, id: 'k', constraint: { type: 'coincident', a: 'p', b: 'o/c1/center' } });
    expect(Object.keys(input().points)).toEqual(['origin', 'p', 'o/c1/center']);
    expect(input().curves).toEqual({});
    expect(input().fixed).toEqual(['origin', 'o/c1/center']);
    doc = run(doc, { type: 'addConstraint', sketch: S, id: 'r', constraint: { type: 'distancePointLine', point: 'p', line: 'o/l1', value: 1, driving: false } });
    expect(Object.keys(input().curves)).toEqual(['o/l1']);
  });
});

describe('updateExternal of an outline (D72)', () => {
  it('a field left out keeps what the entry has, an expression too; a field given as undefined is left out', () => {
    let doc = run(withBoard({ name: 'board.dxf', readWith: { format: 'dxf' }, anchor: 'center' }), { type: 'setParameter', name: 'w', expr: '4' });
    doc = run(doc, update('o', { type: 'outline', x: 'w', y: 2 }));
    const curves = entry(doc).curves;
    expect(entry(doc)).toMatchObject({ x: 4, y: 2, anchor: 'center', name: 'board.dxf', readWith: { format: 'dxf' } });
    for (const field of [{ regions: false }, { turn: 0.1 }, { anchor: 'origin' }, { name: 'b.dxf' }, { y: undefined, regions: false }]) {
      const next = run(doc, update('o', { type: 'outline', ...field }));
      expect(entry(next).x).toBe(4);
      expect(sketchOf(next).expressions).toEqual({ 'external/o/x': 'w' });
      expect(entry(next).curves).toBe(curves);
      expect(entry(next).y).toBe(2);
    }
    // a number given drops the expression
    expect(sketchOf(run(doc, update('o', { type: 'outline', x: 1 }))).expressions).toBeUndefined();
  });

  it('an expression in error is kept as it is when its field is left out', () => {
    let doc = run(withBoard(), { type: 'setParameter', name: 'w', expr: '4' });
    doc = run(doc, update('o', { type: 'outline', x: 'w' }));
    doc = run(doc, { type: 'removeParameter', name: 'w' } as Command);
    const next = run(doc, update('o', { type: 'outline', regions: false }));
    expect(sketchOf(next).expressions).toEqual({ 'external/o/x': 'w' });
    expect(entry(next).x).toBe(4);
  });

  it("clears the name with '' and readWith with null", () => {
    const doc = withBoard({ name: 'board.dxf', readWith: { format: 'dxf' } });
    const next = entry(run(doc, update('o', { type: 'outline', name: '', readWith: null })));
    expect(next.name).toBeUndefined();
    expect(next.readWith).toBeUndefined();
  });

  it('an update of another type is the whole entry, not merged', () => {
    const doc = withBoard();
    expect(refused(doc, update('o', { type: 'sketch', sketch: S, entity: 'x', kind: 'point', curves: board() }))).toBeTruthy();
  });

  it('keeps the stored value when neither the place nor the curves change, and drops it otherwise', () => {
    const doc = withBoard();
    const s = sketchOf(doc);
    const saved: Document = { ...doc, features: [{ ...s, solved: { inputs: 'x', external: { o: placeOutline(entry(doc)) } } }] };
    expect(sketchOf(run(saved, update('o', { type: 'outline', regions: false }))).solved.external.o).toBeDefined();
    expect(sketchOf(run(saved, update('o', { type: 'outline', x: 3 }))).solved.external.o).toBeUndefined();
    expect(sketchOf(run(saved, update('o', { type: 'outline', curves: board(62) }))).solved.external.o).toBeUndefined();
  });

  describe('the rule of an update', () => {
    const held = (): Document =>
      run(
        withBoard(),
        { type: 'addPoint', sketch: S, id: 'p', x: 0, y: 0 },
        { type: 'addPoint', sketch: S, id: 'q', x: 5, y: 0 },
        { type: 'addConstraint', sketch: S, id: 'k1', constraint: { type: 'coincident', a: 'p', b: 'o/c4/center' } },
        { type: 'addConstraint', sketch: S, id: 'k2', constraint: { type: 'distance', a: 'q', b: 'o/c4/center', value: 3, driving: false } },
      );
    const without = (...locals: string[]): Record<Id, ImportedCurve> => Object.fromEntries(Object.entries(board()).filter(([local]) => !locals.includes(local)));

    it('refuses an update that takes away an entity a driving or a reference constraint names, naming them', () => {
      const doc = held();
      expect(refused(doc, update('o', { type: 'outline', curves: without('c4') }))).toBe(`updateExternal: ${ENTITY_TAKEN('o', [{ entity: 'o/c4/center', constraints: ['k1', 'k2'] }])}`);
      // what no constraint names may go
      expect(() => run(doc, update('o', { type: 'outline', curves: without('c3') }))).not.toThrow();
    });

    it('refuses a control point that goes', () => {
      const curves = { s1: spline([[0, 0], [1, 2], [3, 2], [4, 0]]) };
      const doc = run(base(), add('o', { type: 'outline', curves }), { type: 'addPoint', sketch: S, id: 'p', x: 0, y: 0 }, { type: 'addConstraint', sketch: S, id: 'k', constraint: { type: 'coincident', a: 'p', b: 'o/s1/3' } });
      expect(refused(doc, update('o', { type: 'outline', curves: { s1: spline([[0, 0], [1, 2], [4, 0]]) } }))).toContain('"o/s1/3" (named by k)');
    });

    it('refuses an entity a constraint names that changes its kind, and takes one no constraint names', () => {
      const doc = run(held(), { type: 'addConstraint', sketch: S, id: 'k3', constraint: { type: 'pointOnCurve', point: 'q', curve: 'o/c4' } });
      const asArc = { ...without('c4'), c4: { type: 'arc', center: [103.5, 116.5], start: [105.1, 116.5], end: [103.5, 118.1] } };
      expect(refused(doc, update('o', { type: 'outline', curves: asArc }))).toBe(`updateExternal: ${ENTITY_KIND_CHANGED('o/c4', 'circle', 'arc', ['k3'])}`);
      const c3AsArc = { ...without('c3'), c3: { type: 'arc', center: [156.5, 116.5], start: [158.1, 116.5], end: [156.5, 118.1] } };
      expect(entry(run(doc, update('o', { type: 'outline', curves: c3AsArc }))).curves.c3.type).toBe('arc');
    });

    it('passes in a batch that removes the constraints first, and not in the other order', () => {
      const doc = held();
      const remove = (id: Id): Command => ({ type: 'removeConstraint', sketch: S, id });
      const after = run(doc, { type: 'batch', commands: [remove('k1'), remove('k2'), update('o', { type: 'outline', curves: without('c4') })] });
      expect(Object.keys(entry(after).curves)).not.toContain('c4');
      expect(() => validateDocument(JSON.parse(JSON.stringify(after)))).not.toThrow();
      expect(refused(doc, { type: 'batch', commands: [update('o', { type: 'outline', curves: without('c4') }), remove('k1'), remove('k2')] })).toContain('takes away');
    });

    it('a projection updated into an outline while a constraint names the projection, and back', () => {
      let doc = applyCommand(emptyDocument(), { type: 'addFeature', feature: emptySketch('a', 'a', { kind: 'base', plane: 'XY' }) });
      doc = run(doc, { type: 'addPoint', sketch: 'a', id: 'a1', x: 0, y: 0 }, { type: 'addPoint', sketch: 'a', id: 'a2', x: 10, y: 0 }, { type: 'addCurve', sketch: 'a', id: 'al', curve: { type: 'line', a: 'a1', b: 'a2' } });
      doc = run(doc, { type: 'addFeature', feature: emptySketch(S, S, { kind: 'base', plane: 'XY' }) }, add('e', { type: 'sketch', sketch: 'a', entity: 'al', kind: 'line' }), { type: 'addPoint', sketch: S, id: 'p', x: 1, y: 1 });
      doc = run(doc, { type: 'addConstraint', sketch: S, id: 'k', constraint: { type: 'pointOnCurve', point: 'p', curve: 'e' } });
      const asOutline = update('e', { type: 'outline', curves: { l1: { type: 'line', a: [0, 0], b: [10, 0] } } });
      expect(refused(doc, asOutline)).toBe(`updateExternal: ${ENTITY_TAKEN('e', [{ entity: 'e', constraints: ['k'] }])}`);
      // the other way: the outline's entity that a constraint names goes
      doc = run(doc, { type: 'batch', commands: [{ type: 'removeConstraint', sketch: S, id: 'k' }, asOutline] }, { type: 'addConstraint', sketch: S, id: 'k', constraint: { type: 'pointOnCurve', point: 'p', curve: 'e/l1' } });
      expect(refused(doc, update('e', { type: 'sketch', sketch: 'a', entity: 'al', kind: 'line' }))).toContain('"e/l1" (named by k)');
    });

    it('removeExternal takes the constraints on the entities with it', () => {
      const doc = run(held(), { type: 'removeExternal', sketch: S, id: 'o' });
      expect(sketchOf(doc).constraints).toEqual({});
    });
  });
});
