// How the diagnosis of a sketch is presented for the panel and the view, against the real engine.
import { type Command, type Constraint, type Engine, type Id, type SketchFeature, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { anchorPoints, duplicateTwins, explanationText, freeEntities, freeSummary, listed, markOf } from '../src/sketch-diagnosis';
import { sketchView } from '../src/sketch-view';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

// A freehand rectangle a..d with the directions of its sides; the test adds further constraints.
function rectangle(): Engine {
  const engine = createEngine(deps);
  const points: [Id, number, number][] = [
    ['a', 0.3, -0.2],
    ['b', 39.5, 0.4],
    ['c', 40.6, 29.7],
    ['d', -0.4, 30.5],
  ];
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) },
    ...points.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 's', id, x, y })),
    ...points.map(([id], i): Command => ({ type: 'addCurve', sketch: 's', id: `${id}${points[(i + 1) % 4][0]}`, curve: { type: 'line', a: id, b: points[(i + 1) % 4][0] } })),
  ];
  for (const command of commands) expect(engine.execute(command).ok).toBe(true);
  add(engine, 'h1', { type: 'horizontal', line: 'ab' });
  add(engine, 'v1', { type: 'vertical', line: 'bc' });
  add(engine, 'h2', { type: 'horizontal', line: 'cd' });
  add(engine, 'v2', { type: 'vertical', line: 'da' });
  return engine;
}
function add(engine: Engine, id: Id, constraint: Constraint): void {
  const result = engine.execute({ type: 'addConstraint', sketch: 's', id, constraint });
  if (!result.ok) throw new Error(result.error.message);
}
const featureOf = (engine: Engine) => engine.getState().document.features[0] as SketchFeature;
const viewOf = (engine: Engine) => sketchView(featureOf(engine), engine.getState().evaluation.features.s.sketch!);
const label = (id: Id) => `<${id}>`;
const explainText = (engine: Engine, id: Id) => explanationText(featureOf(engine).constraints[id], id, engine.explainConstraint('s', id), engine.diagnoseSketch('s'), label);

describe('free and determined entities', () => {
  it('a rectangle without dimensions: everything is free, no point determines the sketch by itself', () => {
    const engine = rectangle();
    const d = engine.diagnoseSketch('s');
    expect(d.degreesOfFreedom).toBe(4);
    const free = freeEntities(d, viewOf(engine))!;
    expect([...free.points].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...free.curves].sort()).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(anchorPoints(d)).toEqual([]);
  });

  it('a dimensioned rectangle without an anchor: any point determines the sketch; once anchored nothing is free', () => {
    const engine = rectangle();
    add(engine, 'w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    add(engine, 'hgt', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true });
    expect(anchorPoints(engine.diagnoseSketch('s'))).toEqual(['a', 'b', 'c', 'd']);
    add(engine, 'fix', { type: 'coincident', a: 'a', b: 'origin' });
    const d = engine.diagnoseSketch('s');
    expect(freeEntities(d, viewOf(engine))).toEqual({ points: new Set(), curves: new Set() });
    expect(anchorPoints(d)).toEqual([]);
  });

  it('an anchored rectangle without a width: the right side and the lines touching it are free; a circle with a free radius', () => {
    const engine = rectangle();
    add(engine, 'hgt', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true });
    add(engine, 'fix', { type: 'coincident', a: 'a', b: 'origin' });
    expect(engine.execute({ type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 }).ok).toBe(true);
    const d = engine.diagnoseSketch('s');
    const free = freeEntities(d, viewOf(engine))!;
    expect([...free.points].sort()).toEqual(['b', 'c']);
    expect([...free.curves].sort()).toEqual(['ab', 'bc', 'cd', 'k']); // the left side is determined
    expect(anchorPoints(d)).toEqual([]); // the width and the radius are two independent freedoms
  });

  it('a sketch in conflict: nothing can be said about freedom', () => {
    const engine = rectangle();
    add(engine, 'w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    add(engine, 'w2', { type: 'horizontalDistance', a: 'd', b: 'c', value: 50, driving: true });
    const d = engine.diagnoseSketch('s');
    expect(d.status).not.toBe('solved');
    expect(freeEntities(d, viewOf(engine))).toBeUndefined();
    expect(anchorPoints(d)).toEqual([]);
    expect(explainText(engine, 'w2')).toMatch(/is not solved/);
  });
});

describe('the sentence about free entities', () => {
  it('singular and plural, the advice on anchoring without a coincidence with the origin', () => {
    const engine = rectangle();
    add(engine, 'w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    add(engine, 'hgt', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true });
    expect(freeSummary(engine.diagnoseSketch('s'))).toBe('Free (blue in the view): points a, b, c, d. Fixing the position of any of them fully constrains the sketch: for example by two dimensions from the origin.');
    add(engine, 'x', { type: 'horizontalDistance', a: 'origin', b: 'a', value: 0, driving: true });
    expect(freeSummary(engine.diagnoseSketch('s'))).toBe('Free (blue in the view): points a, b, c, d. Fixing the position of any of them fully constrains the sketch: one dimension or constraint in the direction it can move is enough.');
    add(engine, 'y', { type: 'verticalDistance', a: 'origin', b: 'a', value: 0, driving: true });
    expect(freeSummary(engine.diagnoseSketch('s'))).toBeUndefined();
  });

  it('a single free point and a single free radius; a radius is not offered as an anchor point', () => {
    const line = createEngine(deps);
    for (const command of [
      { type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) },
      { type: 'addPoint', sketch: 's', id: 'p', x: 20, y: 5 },
      { type: 'addCurve', sketch: 's', id: 'l', curve: { type: 'line', a: 'origin', b: 'p' } },
    ] as Command[]) expect(line.execute(command).ok).toBe(true);
    expect(freeSummary(line.diagnoseSketch('s'))).toBe('Free (blue in the view): point p. Fixing the position of the point p fully constrains the sketch: for example by two dimensions from the origin.');

    const circle = createEngine(deps);
    for (const command of [
      { type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    ] as Command[]) expect(circle.execute(command).ok).toBe(true);
    const d = circle.diagnoseSketch('s');
    expect(d).toMatchObject({ degreesOfFreedom: 1, free: [{ id: 'k', kind: 'radius', freedom: 1 }] });
    expect(anchorPoints(d)).toEqual([]);
    expect(freeSummary(d)).toBe('Free (blue in the view): radius k.');
  });

  it('a long list is shortened with the right form of the word "more"', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `p${i}`);
    expect(listed(ids.slice(0, 8))).toBe('p0, p1, p2, p3, p4, p5, p6, p7');
    expect(listed(ids.slice(0, 9))).toBe('p0, p1, p2, p3, p4, p5, p6, p7 and 1 more');
    expect(listed(ids.slice(0, 11))).toBe('p0, p1, p2, p3, p4, p5, p6, p7 and 3 more');
    expect(listed(ids)).toBe('p0, p1, p2, p3, p4, p5, p6, p7 and 6 more');
  });
});

describe('marks and explanations of constraints', () => {
  it('a derived constraint is surplus and the explanation names the constraints it follows from', () => {
    const engine = rectangle();
    add(engine, 'par', { type: 'parallel', a: 'ab', b: 'cd' });
    const d = engine.diagnoseSketch('s');
    expect(markOf(d, 'par')).toBe('surplus');
    expect(markOf(d, 'h1')).toBeUndefined(); // older constraints stay unmarked
    expect(duplicateTwins(d)).toEqual([]);
    expect(explainText(engine, 'par')).toBe('The constraint follows from the constraints: <h1>; <h2>. Either it or any one of them can be removed without changing the geometry.');
    expect(explainText(engine, 'h1')).toMatch(/^The constraint follows from the constraints: <h2>; <par>\./);
    expect(explainText(engine, 'v1')).toBe('The constraint is needed: it does not follow from the others.');
  });

  it('a duplicate from a document of an older version: the newer twin is marked and the explanation names it', () => {
    const engine = rectangle();
    const document = JSON.parse(engine.save());
    document.features[0].constraints.h1again = { type: 'horizontal', line: 'ab' };
    expect(engine.load(JSON.stringify(document)).ok).toBe(true);
    const d = engine.diagnoseSketch('s');
    expect(duplicateTwins(d)).toEqual(['h1again']);
    expect(markOf(d, 'h1again')).toBe('duplicate');
    expect(markOf(d, 'h1')).toBeUndefined();
    // the twins have the same label, so the sentence does not repeat it; the highlight in the list shows which one it is
    expect(explainText(engine, 'h1again')).toBe('The constraint is a duplicate: the sketch already has the same constraint (highlighted in the list).');
    expect(explainText(engine, 'h1')).toBe(explainText(engine, 'h1again'));
    // three equal constraints: the older one stays, both newer ones are twins; the explanation names one of them
    document.features[0].constraints.h1third = { type: 'horizontal', line: 'ab' };
    expect(engine.load(JSON.stringify(document)).ok).toBe(true);
    expect(duplicateTwins(engine.diagnoseSketch('s'))).toEqual(['h1again', 'h1third']);
    expect(markOf(engine.diagnoseSketch('s'), 'h1')).toBeUndefined();
  });

  it('a constraint following from a single constraint: they are interchangeable only when the other one is wholly surplus itself', () => {
    // the point on the line follows from the midpoint of the line, but the midpoint has two equations and cannot be removed
    const engine = rectangle();
    expect(engine.execute({ type: 'addPoint', sketch: 's', id: 'm', x: 18, y: 1 }).ok).toBe(true);
    add(engine, 'mid', { type: 'midpoint', point: 'm', line: 'ab' });
    add(engine, 'on', { type: 'pointOnCurve', point: 'm', curve: 'ab' });
    const before = engine.diagnoseSketch('s').degreesOfFreedom;
    expect(explainText(engine, 'on')).toBe('The constraint follows from the constraint: <mid>. This constraint can be removed without changing the geometry.');
    expect(engine.preview({ type: 'removeConstraint', sketch: 's', id: 'on' })).toMatchObject({ ok: true });
    expect(engine.execute({ type: 'removeConstraint', sketch: 's', id: 'mid' }).ok).toBe(true);
    expect(engine.diagnoseSketch('s').degreesOfFreedom).toBe(before + 1); // the advice "any one of them" would lie here
    // two constraints with one equation that say the same thing differently: they are interchangeable
    add(engine, 'h1b', { type: 'verticalDistance', a: 'a', b: 'b', value: 0, driving: true });
    expect(explainText(engine, 'h1b')).toBe('The constraint follows from the constraint: <h1>. Either it or the other one can be removed without changing the geometry.');
  });

  it('a constraint left out of the solve and a sketch that was not evaluated', () => {
    const engine = rectangle();
    const d = engine.diagnoseSketch('s');
    const h1 = featureOf(engine).constraints.h1;
    expect(explanationText(h1, 'h1', { redundant: false, impliedBy: [] }, d, label, true)).toMatch(/left out of the solve/);
    expect(explanationText(h1, 'h1', { redundant: false, impliedBy: [] }, { ...d, status: 'unavailable' }, label)).toBe('The sketch was not evaluated, so its constraints cannot be judged.');
  });

  it('a reference dimension and a constraint following from the definition of an arc', () => {
    const engine = rectangle();
    add(engine, 'ref', { type: 'distance', a: 'a', b: 'c', value: 50, driving: false });
    expect(explainText(engine, 'ref')).toBe('A reference dimension only measures; it does not drive the geometry.');
    for (const command of [
      { type: 'addPoint', sketch: 's', id: 'm', x: 60, y: 0 },
      { type: 'addPoint', sketch: 's', id: 's1', x: 70, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'e1', x: 50, y: 0.5 },
      { type: 'addCurve', sketch: 's', id: 'arc', curve: { type: 'arc', center: 'm', start: 's1', end: 'e1' } },
    ] as Command[]) expect(engine.execute(command).ok).toBe(true);
    add(engine, 'onArc', { type: 'pointOnCurve', point: 'e1', curve: 'arc' });
    expect(markOf(engine.diagnoseSketch('s'), 'onArc')).toBe('surplus');
    expect(explainText(engine, 'onArc')).toBe('The constraint is surplus: it already follows from the definition of the curve.');
  });
});
