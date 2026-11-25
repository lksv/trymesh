// Trim, extend and split (D65) without adapters: the batches over a sketch whose solved positions
// are the positions of its points (a hand-made result), checked against the document they make.
// The rules are docs/d36/6e-trim-extend-split/design.md; the cases with the solver are in
// packages/scenarios/test/trim.test.ts and trim-verify.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import { evaluateParameters } from '../src/expression';
import { SKETCH_TOOLS, type SketchToolInputs, freshIds, sketchTool } from '../src/sketch-tools';
import { contactPlaces, extendEnd, extendReach, sketchContactsOf, trimPiece } from '../src/sketch-cut';
import { sketchWorld, toolBase } from '../src/references/world';
import { detectProfile } from '../src/sketch';
import type { Command, Constraint, Curve, Document, Id, SketchFeature, SketchResult } from '../src/types';

type CutTool = 'trim' | 'extend' | 'split';
const S = 'S';
const XY = { kind: 'base', plane: 'XY' } as const;

function build(points: Record<Id, [number, number]>, curves: Record<Id, Curve | [Curve, number]>, constraints: Record<Id, Constraint | Record<string, unknown>> = {}, more: Command[] = []): Document {
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch(S, S, XY) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: S, id, x, y })),
    ...Object.entries(curves).map(([id, c]): Command => (Array.isArray(c) ? { type: 'addCurve', sketch: S, id, curve: c[0], radius: c[1] } : { type: 'addCurve', sketch: S, id, curve: c })),
    ...Object.entries(constraints).map(([id, constraint]): Command => ({ type: 'addConstraint', sketch: S, id, constraint: constraint as Constraint })),
    ...more,
  ];
  return commands.reduce<Document>(applyCommand, emptyDocument());
}
const sketchOf = (doc: Document, id = S): SketchFeature => doc.features.find((f) => f.id === id) as SketchFeature;
// The positions of the document as the solved ones (the document holds the positions the commands
// gave), and the profile of the sketch over them.
function resultOf(doc: Document, id = S): SketchResult {
  const sketch = sketchOf(doc, id);
  const points = { origin: { x: 0, y: 0 }, ...sketch.points };
  const profile = detectProfile(sketch, { points, radii: sketch.radii }, doc.settings.chordTolerance);
  return { points, radii: { ...sketch.radii }, curves: {}, degreesOfFreedom: 0, conflicting: [], redundant: [], measurements: {}, valid: profile.valid, regions: profile.regions.map((region) => ({ ref: region.ref, loops: [] })) };
}
// The answer of the query sketchContacts over the hand-made result.
function contactsOf(doc: Document) {
  const sketch = sketchOf(doc);
  const result = resultOf(doc);
  const world = sketchWorld(toolBase(sketch, result));
  return sketchContactsOf(contactPlaces(world, result.valid, doc.settings.chordTolerance), world.curves, doc, sketch, result.valid);
}
const context = (doc: Document) => ({ sketch: sketchOf(doc), result: resultOf(doc), parameters: evaluateParameters(doc.parameters), document: doc });
function tool<K extends CutTool>(doc: Document, name: K, input: SketchToolInputs[K]): { doc: Document; ids: Record<string, Id[]>; commands: Command[] } {
  const made = sketchTool(name, context(doc), input, freshIds(doc, 'x_'));
  if (!made.ok) throw new Error(made.message);
  return { doc: applyCommand(doc, { type: 'batch', commands: made.commands }), ids: made.ids, commands: made.commands };
}
function refusal<K extends CutTool>(doc: Document, name: K, input: SketchToolInputs[K]): string {
  const made = sketchTool(name, context(doc), input, freshIds(doc, 'x_'));
  if (made.ok) throw new Error(`${name} was not refused: ${JSON.stringify(made.ids)}`);
  return made.message;
}
const line = (a: Id, b: Id, construction = false): Curve => (construction ? { construction: true, type: 'line', a, b } : { type: 'line', a, b });
const extrude = (id: Id, regions: Id[][]): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: S, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } });
const RECT: Record<Id, [number, number]> = { r1: [0, 0], r2: [40, 0], r3: [40, 30], r4: [0, 30] };
const RECT_LINES: Record<Id, Curve> = { ra: line('r1', 'r2'), rb: line('r2', 'r3'), rc: line('r3', 'r4'), rd: line('r4', 'r1') };

describe('the catalog entries and the input kinds', () => {
  it('a curve and a place are checked like the other inputs', () => {
    const doc = build(RECT, RECT_LINES);
    expect(refusal(doc, 'trim', { curve: 'r1', at: [0, 0] })).toBe('curve: "r1" is a point, not a curve');
    expect(refusal(doc, 'trim', { curve: 'nope', at: [0, 0] })).toBe('curve: the sketch has no curve "nope"');
    expect(refusal(doc, 'trim', { curve: 'ra', at: [0] as never })).toBe('at: two finite numbers `[x, y]` are expected');
    expect(refusal(doc, 'trim', { curve: 'ra', at: [2e9, 0] })).toBe('at: out of the range ±1000000000');
    expect(refusal(doc, 'trim', { curve: 'ra' } as never)).toBe('the input "at" is missing');
    expect(refusal(doc, 'split', { with: 'ra' })).toBe('`with` and `at` need `curve`');
    expect(refusal(doc, 'trim', { curve: 'ra', at: [1, 0], with: 'ra' })).toBe('`with` names the curve itself');
    expect(Object.keys(SKETCH_TOOLS.split.ids)).toHaveLength(16); // 6e's fifteen and 6c's `entries` (D68)
  });
});

describe('the cut of a line: pieces, keeper and constraints', () => {
  // a horizontal line from (0, 10) to (40, 10) and a vertical one from (20, 0) to (20, 20) across it
  const cross = (constraints: Record<Id, Constraint | Record<string, unknown>> = {}, extra: Record<Id, [number, number]> = {}, curves: Record<Id, Curve> = {}) =>
    build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20], ...extra }, { h: line('a', 'b'), v: line('c', 'd'), ...curves }, constraints);

  it('split: the keeper keeps the start and the ID, the new piece runs the same way and is held on the line', () => {
    const { doc, ids } = tool(cross({ hh: { type: 'horizontal', line: 'h' } }), 'split', {});
    const sketch = sketchOf(doc);
    expect(ids.changed).toEqual(['h', 'v']);
    expect(ids.points).toEqual(['x_p1']);
    expect(sketch.curves['h']).toEqual(line('a', 'x_p1'));
    expect(sketch.curves[ids.added[0]]).toEqual(line('x_p1', 'b'));
    expect(sketch.curves['v']).toEqual(line('c', 'x_p1'));
    // the far end of each line held on its keeper: one equation per new point and line
    expect(ids.constraints.map((id) => sketch.constraints[id])).toEqual([
      { type: 'pointOnCurve', point: 'b', curve: 'h' },
      { type: 'pointOnCurve', point: 'd', curve: 'v' },
    ]);
    // the horizontal stays on the keeper
    expect(sketch.constraints['hh']).toEqual({ type: 'horizontal', line: 'h' });
    expect(ids.reattached).toEqual([]);
  });

  it('equalLength and midpoint move to a construction span line over the old ends', () => {
    const { doc, ids } = tool(cross({ eq: { type: 'equalLength', a: 'h', b: 'v' }, mid: { type: 'midpoint', point: 'm', line: 'h' } }, { m: [20, 30] }), 'split', { curve: 'h' });
    const sketch = sketchOf(doc);
    // both lines are cut (the other curve is cut too), and each carries the equalLength
    expect(ids.changed).toEqual(['h', 'v']);
    expect(ids.span).toHaveLength(2);
    const [spanH, spanV] = ids.span;
    expect(sketch.curves[spanH]).toEqual(line('a', 'b', true));
    expect(sketch.curves[spanV]).toEqual(line('c', 'd', true));
    expect(sketch.constraints['eq']).toEqual({ type: 'equalLength', a: spanH, b: spanV });
    expect(sketch.constraints['mid']).toEqual({ type: 'midpoint', point: 'm', line: spanH });
    expect(ids.reattached).toEqual(['eq', 'mid']);
    // the midpoint's point is not on h: the far end is held on the line all the same
    expect(ids.constraints.map((id) => sketch.constraints[id])).toContainEqual({ type: 'pointOnCurve', point: 'b', curve: 'h' });
  });

  it('a midpoint whose point is a cut of the line holds the far end: not held twice; the batch moves it before the re-point', () => {
    // a rib from the middle of the side: the point m on h by midpoint, the line v ends there (a T)
    const doc = build({ a: [0, 10], b: [40, 10], m: [20, 10], d: [20, 20] }, { h: line('a', 'b'), v: line('m', 'd') }, { mid: { type: 'midpoint', point: 'm', line: 'h' } });
    const { doc: after, ids, commands } = tool(doc, 'split', {});
    const sketch = sketchOf(after);
    expect(sketch.curves['h']).toEqual(line('a', 'm'));
    expect(ids.constraints).toEqual([]);
    const order = commands.map((c) => `${c.type}:${'id' in c ? c.id : ''}`);
    expect(order.indexOf('removeConstraint:mid')).toBeLessThan(order.indexOf('setCurvePoint:h'));
  });

  it('a point held on the line where it is cut is used, and its pointOnCurve becomes an identity of the keeper', () => {
    const doc = cross({ on: { type: 'pointOnCurve', point: 'q', curve: 'h' }, onv: { type: 'pointOnCurve', point: 'q', curve: 'v' } }, { q: [20, 10] });
    const { doc: after, ids } = tool(doc, 'split', {});
    const sketch = sketchOf(after);
    expect(ids.points).toEqual(['q']);
    expect(sketch.curves['h']).toEqual(line('a', 'q'));
    expect(ids.removed).toEqual(['on', 'onv']);
  });

  it('an end of another curve on the line (a T) is the point of the cut; the other curve is not cut', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 10], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.changed).toEqual(['h']);
    expect(ids.points).toEqual(['c']);
    expect(sketchOf(after).curves['v']).toEqual(line('c', 'd'));
  });

  it('a line that ends on another (a T) trimmed whole: the other is not cut where the end was', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 10], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'trim', { curve: 'v', at: [20, 15] });
    expect(ids.changed).toEqual([]);
    expect(ids.removed).toEqual(['v', 'c', 'd']);
    expect(sketchOf(after).curves['h']).toEqual(line('a', 'b'));
  });

  it('a contact within the tolerance of an end is no cut; cuts within the tolerance of each other are one', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [40 + 4e-7, 0], d: [40 + 4e-7, 20], e: [10, 0], f: [10, 20], g: [10 + 4e-7, 0], k: [10 + 4e-7, 20] }, { h: line('a', 'b'), v: line('c', 'd'), w: line('e', 'f'), u: line('g', 'k', true) });
    const { ids } = tool(doc, 'split', { curve: 'h', with: 'w' });
    expect(ids.points).toHaveLength(1);
    expect(refusal(doc, 'split', { curve: 'h', with: 'v' })).toBe('"h" has no contact with "v" away from its ends');
  });

  it('a construction curve cuts an outline curve only when `with` names it; the point is held on it', () => {
    const doc = cross({}, {}, {});
    const constructed = applyCommand(doc, { type: 'setConstruction', sketch: S, id: 'v', construction: true });
    expect(refusal(constructed, 'split', { curve: 'h' })).toBe('nothing crosses or touches "h" away from its ends');
    const { doc: after, ids } = tool(constructed, 'split', { curve: 'h', with: 'v' });
    expect(ids.changed).toEqual(['h']);
    const sketch = sketchOf(after);
    expect(ids.constraints.map((id) => sketch.constraints[id])).toContainEqual({ type: 'pointOnCurve', point: 'x_p1', curve: 'v' });
    // a construction curve is cut by every curve
    const { ids: own } = tool(constructed, 'split', { curve: 'v' });
    expect(own.changed).toEqual(['v']);
  });

  it('a tangency moves to the piece that has the common end with the other curve', () => {
    // a line from (0, 0) to (40, 0) tangent at its end b to an arc about (40, 10); a vertical line across the line
    const doc = build(
      { a: [0, 0], b: [40, 0], o: [40, 10], e: [50, 10], c: [20, -5], d: [20, 5] },
      { l: line('a', 'b'), arc: { type: 'arc', center: 'o', start: 'b', end: 'e' }, v: line('c', 'd') },
      { t: { type: 'tangent', a: 'l', b: 'arc' } },
    );
    const { doc: after, ids } = tool(doc, 'split', { curve: 'l' });
    expect(sketchOf(after).constraints['t']).toEqual({ type: 'tangent', a: ids.added[0], b: 'arc' });
    expect(ids.reattached).toEqual(['t']);
    // the piece with the common end trimmed away: refused, the tangency named
    expect(refusal(doc, 'trim', { curve: 'l', at: [30, 0] })).toMatch(/^the tangency "t" holds "l" and "arc" at their common end "b"/);
  });

  it('a moved dimension with an expression wins over a plain repeat; one whose expression fails is refused', () => {
    const doc = build(
      { a: [0, 0], b: [40, 0], o: [40, 10], e: [50, 10], c: [20, -5], d: [20, 5], o2: [70, 10], s2: [80, 10] },
      { l: line('a', 'b'), v: line('c', 'd'), k: [{ type: 'circle', center: 'o2' }, 10], m: line('o', 'e') },
      { e1: { type: 'equalLength', a: 'l', b: 'm' } },
      [{ type: 'setParameter', name: 'L', expr: '10' }, { type: 'addConstraint', sketch: S, id: 'dpl', constraint: { type: 'distancePointLine', point: 'o', line: 'l', value: 'L', driving: true } as never }],
    );
    // the distance of o from l stays on the keeper with its expression
    const { doc: after } = tool(doc, 'split', { curve: 'l' });
    expect(sketchOf(after).expressions?.['constraints/dpl/value']).toBe('L');
    expect(sketchOf(after).constraints['e1']).toMatchObject({ type: 'equalLength' });
  });

  it('constraints moved to a span line that would repeat one there are not added twice', () => {
    // two lines on one line, both equal to m: after the split, both equalLength move to their spans
    const doc = build({ a: [0, 0], b: [40, 0], c: [20, -5], d: [20, 5], p: [0, 20], q: [10, 20] }, { l: line('a', 'b'), v: line('c', 'd'), m: line('p', 'q') }, { e1: { type: 'equalLength', a: 'l', b: 'm' } });
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.span).toHaveLength(1);
    expect(Object.values(sketchOf(after).constraints).filter((c) => c.type === 'equalLength')).toHaveLength(1);
  });
});

describe('the cut of an arc and a circle', () => {
  it('a circle cut at two points: arcs on its centre, the first under its ID with every constraint added again', () => {
    const doc = build({ o: [0, 0], a: [-20, 0], b: [20, 0] }, { k: [{ type: 'circle', center: 'o' }, 10], l: line('a', 'b') }, {}, [
      { type: 'setParameter', name: 'D', expr: '20' },
      { type: 'addConstraint', sketch: S, id: 'kd', constraint: { type: 'diameter', curve: 'k', value: 'D', driving: true } as never },
    ]);
    const { doc: after, ids } = tool(doc, 'split', {});
    const sketch = sketchOf(after);
    expect(ids.changed).toEqual(['k', 'l']);
    // the first cut counter-clockwise from the angle 0 is (10, 0)
    expect(sketch.curves['k']).toMatchObject({ type: 'arc', center: 'o' });
    const k = sketch.curves['k'] as { start: Id; end: Id };
    expect(sketch.points[k.start]).toEqual({ x: 10, y: 0 });
    expect(sketch.curves[ids.added[0]]).toEqual({ type: 'arc', center: 'o', start: k.end, end: k.start });
    expect(sketch.constraints['kd']).toEqual({ type: 'diameter', curve: 'k', value: 20, driving: true });
    expect(sketch.expressions?.['constraints/kd/value']).toBe('D');
    expect(ids.reattached).toEqual(['kd']);
  });

  it('a circle touched at one point is left whole and listed; so is the other curve there', () => {
    const doc = build({ o: [0, 0], a: [-20, 10], b: [20, 10] }, { k: [{ type: 'circle', center: 'o' }, 10], l: line('a', 'b') });
    // split of the sketch has nothing to cut and says why the profile stays invalid
    expect(refusal(doc, 'split', {})).toMatch(/^the circle "k" is touched at one point only/);
    expect(refusal(doc, 'split', { curve: 'k' })).toBe('the circle "k" is touched at one point only; one point does not split a circle');
    expect(refusal(doc, 'split', { curve: 'k', at: [0, 10] })).toMatch(/^at: one point does not split the circle "k"/);
  });

  it('a circle crossed at three places: three arcs', () => {
    const doc = build({ o: [0, 0], a: [-20, 5], b: [20, 5], c: [8, -20], d: [8, 0] }, { k: [{ type: 'circle', center: 'o' }, 10], l: line('a', 'b'), m: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'split', { curve: 'k' });
    expect(ids.changed).toEqual(['k', 'l', 'm']);
    expect(Object.values(sketchOf(after).curves).filter((c) => c.type === 'arc')).toHaveLength(3);
  });

  it('a line that ends inside a circle, its inner part trimmed: the circle is not cut, the point held on it', () => {
    const doc = build({ o: [0, 0], a: [-20, 0], b: [0, 0.5] }, { k: [{ type: 'circle', center: 'o' }, 10], l: line('a', 'b') });
    const { doc: after, ids } = tool(doc, 'trim', { curve: 'l', at: [-2, 0.4], repair: 'on' });
    expect(ids.uncut).toEqual(['k']);
    const sketch = sketchOf(after);
    const end = (sketch.curves['l'] as { b: Id }).b;
    expect(ids.constraints.map((id) => sketch.constraints[id])).toContainEqual({ type: 'pointOnCurve', point: end, curve: 'k' });
    expect(sketch.points[end].x).toBeCloseTo(-Math.sqrt(100 - (0.5 * 10 / 20.006) ** 2), 1);
  });

  it('a generated profile names a circle: it is not cut, and a tool that names it is refused', () => {
    const doc = build({ o: [0, 0], a: [-20, 0], b: [20, 0] }, { k: [{ type: 'circle', center: 'o' }, 10], l: line('a', 'b') }, {}, [
      { type: 'addFeature', feature: { id: 'gear', name: 'gear', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'involuteGear', sketch: S, operands: { circle: 'k' }, params: { teeth: 20 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } as never },
    ]);
    expect(refusal(doc, 'split', { curve: 'k' })).toMatch(/operand of a generated profile/);
    expect(refusal(doc, 'trim', { curve: 'k', at: [0, 10] })).toMatch(/operand of a generated profile/);
    // split of the sketch leaves the circle and the line whole: nothing else to cut
    expect(refusal(doc, 'split', {})).toMatch(/^the circle "k"/);
  });
});

describe('overlaps and ends at one place (what the converter met)', () => {
  it('two lines on one line that overlap: each cut at the end of the other inside it', () => {
    const doc = build({ a: [0, 0], b: [20, 0], c: [10, 0], d: [30, 0] }, { p: line('a', 'b'), q: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.changed).toEqual(['p', 'q']);
    expect(ids.points).toEqual(['c', 'b']);
    expect(sketchOf(after).curves['p']).toEqual(line('a', 'c'));
    expect(sketchOf(after).curves['q']).toEqual(line('c', 'b'));
    // the two duplicates of the overlap stay: the profile is invalid until one is trimmed
    expect(contactsOf(after).reason).toMatch(/lie on each other/);
  });

  it('a duplicate is not cut; split of the sketch is refused with the reason', () => {
    const doc = build({ a: [0, 0], b: [20, 0] }, { p: line('a', 'b'), q: line('b', 'a') });
    expect(refusal(doc, 'split', {})).toBe('"p" and "q" lie on each other; trim or remove one of them');
  });

  it('two ends at one place: the end named by nothing but its curve re-pointed onto the other point', () => {
    const doc = build({ a: [0, 0], b: [20, 0], c: [20, 0], d: [20, 10] }, { p: line('a', 'b'), q: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.changed).toEqual(['q']);
    expect(ids.removed).toEqual(['c']);
    expect(sketchOf(after).curves['q']).toEqual(line('b', 'd'));
  });

  it('two ends at one place both named: a coincident joins them', () => {
    const doc = build({ a: [0, 0], b: [20, 0], c: [20, 0], d: [20, 10] }, { p: line('a', 'b'), q: line('c', 'd') }, { fb: { type: 'fixed', point: 'b', x: 20, y: 0 }, fc: { type: 'fixed', point: 'c', x: 20, y: 0 } });
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.constraints.map((id) => sketchOf(after).constraints[id])).toEqual([{ type: 'coincident', a: 'b', b: 'c' }]);
  });

  it('lines crossing lines, a line crossing circles, two circles crossing: one split repairs them all', () => {
    const doc = build(
      { o1: [0, 0], o2: [12, 0], a: [-20, 1], b: [30, 1], c: [5, -20], d: [5, 20] },
      { k1: [{ type: 'circle', center: 'o1' }, 10], k2: [{ type: 'circle', center: 'o2' }, 8], h: line('a', 'b'), v: line('c', 'd') },
      {},
      [extrude('E', [['k1']])],
    );
    const { doc: after, ids } = tool(doc, 'split', {});
    expect(ids.changed).toEqual(['h', 'k1', 'k2', 'v']);
    expect(ids.patched).toEqual(['E']);
    const s = sketchOf(after);
    const { regions, valid } = profileOfDoc(after);
    expect(valid).toBe(true);
    expect(regions.length).toBeGreaterThan(6);
    void s;
  });
});

// The profile of the own curves of a document's sketch at the positions of its points.
const profileOfDoc = (doc: Document) => {
  const sketch = sketchOf(doc);
  return detectProfile(sketch, { points: { origin: { x: 0, y: 0 }, ...sketch.points }, radii: sketch.radii }, 0.01);
};

describe('ends cut off and whole pieces', () => {
  it('an end nothing names is removed; one a dimension names stays, held on the line', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') });
    const { ids } = tool(doc, 'trim', { curve: 'h', at: [30, 10] });
    expect(ids.removed).toEqual(['b']);
    const named = applyCommand(doc, { type: 'addConstraint', sketch: S, id: 'len', constraint: { type: 'distance', a: 'a', b: 'b', value: 40, driving: true } });
    const { doc: after, ids: kept } = tool(named, 'trim', { curve: 'h', at: [30, 10] });
    expect(kept.removed).toEqual([]);
    expect(kept.constraints.map((id) => sketchOf(after).constraints[id])).toContainEqual({ type: 'pointOnCurve', point: 'b', curve: 'h' });
  });

  it('the origin is never removed; a corner of another curve stays', () => {
    const doc = build({ b: [40, 0], c: [20, -5], d: [20, 5], e: [40, 20] }, { h: line('origin', 'b'), v: line('c', 'd'), w: line('b', 'e') });
    const { ids } = tool(doc, 'trim', { curve: 'h', at: [5, 0] });
    expect(ids.removed).toEqual([]);
    const { ids: corner } = tool(doc, 'trim', { curve: 'h', at: [30, 0] });
    expect(corner.removed).toEqual([]);
  });

  it('the tool\'s own hold does not count as a name: a stray end goes', () => {
    // b is held on h by pointOnCurve only (redundantly): it is still removed with the piece
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') });
    const { doc: split } = tool(doc, 'split', {});
    const piece = Object.keys(sketchOf(split).curves).find((id) => id.startsWith('x_')) as Id;
    const { ids } = tool(split, 'trim', { curve: piece, at: [30, 10] });
    expect(ids.removed).toContain('b');
  });

  it('a whole piece with a sibling: its carrier moves there; without one the curve goes with its constraints', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') }, { hh: { type: 'horizontal', line: 'h' } });
    const { doc: split, ids } = tool(doc, 'split', {});
    const { doc: after, ids: trimmed } = tool(split, 'trim', { curve: 'h', at: [10, 10] });
    expect(trimmed.removed).toContain('h');
    expect(sketchOf(after).constraints['hh']).toEqual({ type: 'horizontal', line: ids.added[0] });
    // the hold of b on h moved to the sibling is an identity there and goes
    expect(Object.values(sketchOf(after).constraints).some((c) => c.type === 'pointOnCurve' && c.curve === ids.added[0] && c.point === 'b')).toBe(false);
    const { ids: lonely } = tool(build({ a: [0, 10], b: [40, 10] }, { h: line('a', 'b') }, { hh: { type: 'horizontal', line: 'h' } }), 'trim', { curve: 'h', at: [10, 10] });
    expect(lonely.removed).toEqual(['h', 'a', 'b', 'hh']);
  });

  it('a concentric arc of another radius and a line running the other way are no siblings', () => {
    const arcs = build({ o: [0, 0], a: [10, 0], b: [0, 10], c: [20, 0], d: [0, 20] }, { k: { type: 'arc', center: 'o', start: 'a', end: 'b' }, m: { type: 'arc', center: 'o', start: 'c', end: 'd' } }, { kr: { type: 'radius', curve: 'k', value: 10, driving: true } });
    const { ids } = tool(arcs, 'trim', { curve: 'k', at: [7, 7] });
    expect(ids.removed).toContain('kr');
    const lines = build({ a: [0, 0], b: [10, 0], c: [20, 0] }, { p: line('a', 'b'), q: line('c', 'b') }, { ph: { type: 'horizontal', line: 'p' }, on: { type: 'pointOnCurve', point: 'c', curve: 'p' } });
    const { ids: reversed } = tool(lines, 'trim', { curve: 'p', at: [5, 0] });
    expect(reversed.removed).toContain('ph');
  });
});

describe('extend', () => {
  const inner = () => build({ ...RECT, ea: [10, 10], eb: [10, 20] }, { ...RECT_LINES, e: line('ea', 'eb') }, { len: { type: 'distance', a: 'ea', b: 'eb', value: 10, driving: true } }, [extrude('E', [['ra', 'rb', 'rc', 'rd']])]);

  it('moves an end to the next curve, cuts it there and patches the region; the old end stays by its dimension', () => {
    const { doc, ids } = tool(inner(), 'extend', { curve: 'e', end: 'b' });
    const sketch = sketchOf(doc);
    expect(ids.changed).toEqual(['e', 'rc']);
    expect(ids.points).toEqual(['x_p1']);
    expect(sketch.points['x_p1']).toEqual({ x: 10, y: 30 });
    expect(sketch.curves['e']).toEqual(line('ea', 'x_p1'));
    expect(ids.patched).toEqual(['E']);
    expect(ids.constraints.map((id) => sketch.constraints[id])).toContainEqual({ type: 'pointOnCurve', point: 'eb', curve: 'e' });
  });

  it('what the app reads: the end nearest a place and where it would go', () => {
    const doc = inner();
    const ctx = context(doc);
    expect(extendEnd(ctx, 'e', [10, 19])).toBe('b');
    expect(extendEnd(ctx, 'e', [10, 11])).toBe('a');
    expect(extendReach(ctx, { curve: 'e', end: 'a' })).toEqual([10, 0]);
    expect(extendReach(ctx, { curve: 'ra', end: 'a' })).toBeUndefined();
  });

  it('an end mapped to its piece: a line cut in the middle extends its last piece', () => {
    const doc = build({ ...RECT, ea: [5, 10], eb: [30, 10], c: [20, 5], d: [20, 15] }, { ...RECT_LINES, e: line('ea', 'eb'), v: line('c', 'd') });
    const { doc: after, ids } = tool(doc, 'extend', { curve: 'e', end: 'b', repair: 'on' });
    const sketch = sketchOf(after);
    const at = (p: Id) => sketch.points[p];
    // the keeper ends at the crossing with v; its new piece from there to the side is the one extended
    expect(at((sketch.curves['e'] as { b: Id }).b)).toEqual({ x: 20, y: 10 });
    const piece = ids.added.find((id) => (sketch.curves[id] as { a: Id }).a === (sketch.curves['e'] as { b: Id }).b) as Id;
    expect(at((sketch.curves[piece] as { b: Id }).b)).toEqual({ x: 40, y: 10 });
    // the new end last; the old end eb is removed (nothing names it)
    expect(at(ids.points[ids.points.length - 1])).toEqual({ x: 40, y: 10 });
    expect(ids.removed).toContain('eb');
  });

  it('refusals: a T, a shared end, a circle, an arc that comes round to itself, nothing met', () => {
    const doc = build({ ...RECT, t: [20, 0], u: [20, 10], o: [20, 20], s: [25, 20], f: [15, 20] }, { ...RECT_LINES, tee: line('t', 'u'), arc: { type: 'arc', center: 'o', start: 's', end: 'f' }, k: [{ type: 'circle', center: 'o' }, 2] });
    expect(refusal(doc, 'extend', { curve: 'tee', end: 'a' })).toMatch(/^"t" lies on "ra" away from its ends/);
    expect(refusal(doc, 'extend', { curve: 'ra', end: 'b' })).toMatch(/^"rb" ends at "r2" too/);
    expect(refusal(doc, 'extend', { curve: 'k', end: 'a' })).toMatch(/is a circle and has no end/);
    expect(refusal(doc, 'extend', { curve: 'arc', end: 'end' })).toMatch(/comes round to the arc itself/);
    expect(refusal(doc, 'extend', { curve: 'ra', end: 'start' })).toBe('a line has the ends a and b, not "start"');
    expect(refusal(build({ a: [0, 0], b: [1, 0] }, { l: line('a', 'b') }), 'extend', { curve: 'l', end: 'b' })).toBe('the extension of "l" beyond "b" meets nothing');
  });
});

describe('trim: pieces and what the app draws', () => {
  it('the piece under the pointer, from the cuts that select it', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20], e: [30, 0], f: [30, 20] }, { h: line('a', 'b'), v: line('c', 'd'), w: line('e', 'f') });
    expect(trimPiece(context(doc), { curve: 'h', at: [25, 11] })).toEqual({ type: 'line', a: [20, 10], b: [30, 10] });
    expect(trimPiece(context(doc), { curve: 'h', at: [25, 11], with: 'w' })).toEqual({ type: 'line', a: [0, 10], b: [30, 10] });
    expect(trimPiece(context(doc), { curve: 'nope', at: [25, 11] })).toBeUndefined();
  });

  it('the marks of an invalid profile and its reason', () => {
    const doc = build({ a: [0, 10], b: [40, 10], c: [20, 0], d: [20, 20] }, { h: line('a', 'b'), v: line('c', 'd') });
    expect(contactsOf(doc)).toEqual({ contacts: [{ at: [20, 10], kind: 'crossing', curves: ['h', 'v'], fix: 'cut' }], lying: [], degenerate: [] });
  });
});

describe('the features over the sketch', () => {
  it('a region of a revolve is followed as one of an extrusion', () => {
    const doc = build({ ...RECT, o: [40, 15] }, { ...RECT_LINES, k: [{ type: 'circle', center: 'o' }, 5] }, {}, [
      { type: 'addFeature', feature: { id: 'R', name: 'R', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: S, regions: [{ outerLoop: ['ra', 'rb', 'rc', 'rd'] }] }, axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' } as never },
    ]);
    const { ids, doc: after } = tool(doc, 'trim', { curve: 'k', at: [45, 15] });
    expect(ids.patched).toEqual(['R']);
    const r = after.features.find((f) => f.id === 'R') as { profile: { regions: { outerLoop: Id[] }[] } };
    expect(r.profile.regions).toHaveLength(2);
  });

  it('a sketch left invalid: the regions are rewritten by names (pending), then followed by the next tool', () => {
    // two crossings of the outline: split of the left side only leaves the right one
    const doc = build({ ...RECT, a: [-5, 15], b: [45, 15] }, { ...RECT_LINES, l: line('a', 'b') }, {}, [extrude('E', [['ra', 'rb', 'rc', 'rd']])]);
    const { doc: first, ids } = tool(doc, 'split', { curve: 'rd' });
    expect(ids.pending).toEqual(['E']);
    expect(ids.patched).toEqual(['E']);
    const regions = (d: Document) => (d.features.find((f) => f.id === 'E') as { profile: { regions: { outerLoop: Id[] }[] } }).profile.regions;
    expect(ids.changed).toEqual(['l', 'rd']);
    expect(regions(first)).toEqual([{ outerLoop: ['ra', 'rb', 'rc', 'rd', ids.added[1]].sort() }]);
    const { doc: second, ids: then } = tool(first, 'split', {});
    expect(then.pending).toEqual([]);
    expect(regions(second)).toHaveLength(2);
  });

  it('a wall split keeps one chain; trimmed it is shortened; emptied it is broken', () => {
    const doc = build({ ...RECT, c: [20, -5], d: [20, 5] }, { ...RECT_LINES, v: line('c', 'd') }, {}, [
      { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: S, curves: ['ra'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } as never },
    ]);
    const { ids } = tool(doc, 'split', { curve: 'ra' });
    expect(ids.patched).toEqual(['W']);
    expect(ids.shortened).toEqual([]);
    const { ids: trimmed } = tool(doc, 'trim', { curve: 'ra', at: [30, 0] });
    expect(trimmed.shortened).toEqual(['W']);
    const lonely = build({ a: [0, 0], b: [10, 0] }, { l: line('a', 'b') }, {}, [
      { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: S, curves: ['l'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } as never },
    ]);
    expect(tool(lonely, 'trim', { curve: 'l', at: [5, 0] }).ids.broken).toEqual(['W']);
  });

  it('moved: a sketch on the side face of a line whose start was re-pointed; broken: an axis on a removed line', () => {
    const doc = build({ ...RECT, c: [20, -5], d: [20, 5], ax: [50, 0], ay: [50, 10] }, { ...RECT_LINES, v: line('c', 'd'), axis: line('ax', 'ay', true) }, {}, [
      extrude('E', [['ra', 'rb', 'rc', 'rd']]),
      { type: 'addFeature', feature: { ...emptySketch('T', 'T', { kind: 'face', body: 'E', face: { feature: 'E', role: 'side', curve: 'ra' } }) } },
      { type: 'addFeature', feature: { id: 'R', name: 'R', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: S, regions: [{ outerLoop: ['ra', 'rb', 'rc', 'rd'] }] }, axis: { kind: 'sketchLine', sketch: S, line: 'axis' }, extent: { type: 'full' }, operation: 'new' } as never },
    ]);
    const { ids } = tool(doc, 'trim', { curve: 'ra', at: [10, 0] });
    expect(ids.moved).toEqual(['T']);
    const { ids: gone } = tool(doc, 'trim', { curve: 'axis', at: [50, 5] });
    expect(gone.broken).toEqual(['R']);
  });

  it('broken: a joint whose axis is a removed line; a sketch on the straight end of a wall whose chain no longer ends there', () => {
    const doc = build({ ...RECT, ax: [50, 0], ay: [50, 10] }, { ...RECT_LINES, axis: line('ax', 'ay', true) });
    const withJoint: Document = {
      ...doc,
      mechanism: { links: { a: { bodies: ['E'] }, b: { bodies: ['F'] } }, joints: { hinge: { type: 'revolute', parent: 'a', child: 'b', axis: { kind: 'sketchLine', sketch: S, line: 'axis' }, lower: -1, upper: 1, value: 0 } as never } },
    };
    expect(tool(withJoint, 'trim', { curve: 'axis', at: [50, 5] }).ids.broken).toEqual(['hinge']);
    // a wall along an open line, a sketch on the face at its end b; the line extended to the side
    const walled = build({ ...RECT, ea: [10, 10], eb: [10, 20] }, { ...RECT_LINES, e: line('ea', 'eb') }, {}, [
      { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: S, curves: ['e'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } as never },
      { type: 'addFeature', feature: emptySketch('T', 'T', { kind: 'face', body: 'W', face: { feature: 'W', role: 'wallEnd', point: 'eb' } }) },
    ]);
    const { ids } = tool(walled, 'extend', { curve: 'e', end: 'b' });
    expect(ids.broken).toEqual(['T']);
    expect(ids.shortened).toEqual(['W']);
  });
});
