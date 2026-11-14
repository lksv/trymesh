// The sketch tools of the engine (D35, point 7) against the real solver: what a tool draws must
// be accepted by the engine and be the shape the tool promises.
import { describe, expect, it } from 'vitest';
import { type Anchor, type Command, type Engine, type Id, MAX_POLYGON_SIDES, SKETCH_TOOLS, type SketchFeature, type SketchResult, type SketchToolInputs, type SketchToolName, type SketchToolResult, freshIds, sketchTool } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, newEngine, onFace, rectLoop, rectangle, run, status, volume } from './kit';

type Made = Extract<SketchToolResult, { ok: true }>;
const sketchOf = (engine: Engine, id: Id): SketchFeature => engine.getState().document.features.find((f) => f.id === id) as SketchFeature;
const solved = (engine: Engine, id: Id): SketchResult => engine.getState().evaluation.features[id].sketch!;
const free = (x: number, y: number): Anchor => ({ at: [x, y] });
const onPoint = (id: Id): Anchor => ({ at: [1e3, 1e3], snap: { kind: 'point', id } }); // the position comes from the point
// Runs a tool in the sketch `S` with IDs the document does not have and executes its batch.
function draw<K extends SketchToolName>(engine: Engine, tool: K, input: SketchToolInputs[K], sketch: Id = 'S'): Made {
  const made = sketchTool(tool, { sketch: sketchOf(engine, sketch), result: solved(engine, sketch) }, input, freshIds(engine.getState().document));
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made;
}
const refused = <K extends SketchToolName>(engine: Engine, tool: K, input: unknown, sketch: Id = 'S'): string => {
  const made = sketchTool(tool, { sketch: sketchOf(engine, sketch), result: solved(engine, sketch) }, input as SketchToolInputs[K], freshIds(engine.getState().document));
  if (made.ok) throw new Error('the tool should have refused the input');
  return made.message;
};
const at = (engine: Engine, id: Id, sketch: Id = 'S'): [number, number] => [solved(engine, sketch).points[id].x, solved(engine, sketch).points[id].y];
const length = (engine: Engine, a: Id, b: Id): number => Math.hypot(at(engine, a)[0] - at(engine, b)[0], at(engine, a)[1] - at(engine, b)[1]);
const sketched = (): Engine => {
  const engine = newEngine();
  run(engine, addSketch('S', XY));
  return engine;
};
// Angles of the vertices seen from the centre, as steps between neighbours in turns of the circle.
const steps = (engine: Engine, made: Made): number[] => {
  const c = at(engine, made.ids.center[0]);
  const angles = made.ids.points.map((id) => Math.atan2(at(engine, id)[1] - c[1], at(engine, id)[0] - c[0]));
  return angles.map((angle, i) => (((angles[(i + 1) % angles.length] - angle) / (2 * Math.PI)) % 1 + 1) % 1);
};

describe('the catalog of sketch tools', () => {
  it('lists every tool with its inputs and what it returns', () => {
    expect(Object.keys(SKETCH_TOOLS)).toEqual(['rectangle', 'polygon']);
    expect(Object.keys(SKETCH_TOOLS.rectangle.inputs)).toEqual(['first', 'opposite']);
    expect(Object.keys(SKETCH_TOOLS.rectangle.ids)).toEqual(['points', 'lines', 'constraints']);
    expect(SKETCH_TOOLS.polygon.inputs).toMatchObject({ center: { kind: 'anchor' }, vertex: { kind: 'anchor' }, sides: { kind: 'number', spec: { integer: true, min: { value: 3 }, max: { value: MAX_POLYGON_SIDES } } }, sizeKind: { kind: 'option', options: ['circumscribed', 'acrossFlats'], optional: true }, size: { kind: 'number', optional: true, expression: true } });
    expect(Object.keys(SKETCH_TOOLS.polygon.ids)).toEqual(['center', 'circle', 'points', 'lines', 'constraints', 'size']);
    for (const spec of Object.values(SKETCH_TOOLS)) expect(spec.title.length * spec.summary.length).toBeGreaterThan(0);
  });
});

describe('the rectangle tool', () => {
  it('draws four lines with two free sizes; the corners and lines come in the promised order', () => {
    const engine = sketched();
    const made = draw(engine, 'rectangle', { first: onPoint('origin'), opposite: free(30, 20) });
    expect(made.ids.points[0]).toBe('origin');
    expect(made.ids.points.map((id) => at(engine, id))).toEqual([[0, 0], [30, 0], [30, 20], [0, 20]]);
    expect(made.ids.lines).toHaveLength(4);
    made.ids.lines.forEach((line, i) => expect(sketchOf(engine, 'S').curves[line]).toEqual({ type: 'line', a: made.ids.points[i], b: made.ids.points[(i + 1) % 4] }));
    expect(made.ids.constraints.map((id) => sketchOf(engine, 'S').constraints[id].type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
    expect(solved(engine, 'S')).toMatchObject({ degreesOfFreedom: 2, valid: true });
    expect(solved(engine, 'S').regions).toHaveLength(1);
    // every ID the tool reports is in the sketch and nothing else was added
    const sketch = sketchOf(engine, 'S');
    expect(Object.keys(sketch.points).sort()).toEqual(made.ids.points.filter((id) => id !== 'origin').sort());
    expect(Object.keys(sketch.curves).sort()).toEqual([...made.ids.lines].sort());
    expect(Object.keys(sketch.constraints).sort()).toEqual([...made.ids.constraints].sort());
  });

  it('snaps: an own point is used again, a projected one and a curve get a constraint', () => {
    const engine = newEngine();
    run(engine, addSketch('S0', XY), rectangle('S0', 'r', 0, 0, 40, 30), addExtrude('B', 'S0', [rectLoop('r')], 10), addSketch('S', onFace('B', cap('B'))));
    run(engine, { type: 'addExternal', sketch: 'S', id: 'x', ref: { type: 'edge', body: 'B', edge: { a: { feature: 'B', role: 'endCap' }, b: { feature: 'B', role: 'side', curve: 'ra' } }, kind: 'line' } });
    const [a, b] = [at(engine, 'x/a'), at(engine, 'x/b')];
    // one corner on the end of the projected edge, the other on a loose own point
    run(engine, { type: 'addPoint', sketch: 'S', id: 'q', x: 12, y: 17 });
    const made = draw(engine, 'rectangle', { first: { at: [99, 99], snap: { kind: 'point', id: 'x/a' } }, opposite: onPoint('q') });
    expect(made.ids.points[2]).toBe('q');
    expect(made.ids.points[0]).not.toBe('x/a');
    expect(at(engine, made.ids.points[0])).toEqual([expect.closeTo(a[0], 6), expect.closeTo(a[1], 6)]);
    const types = made.ids.constraints.map((id) => sketchOf(engine, 'S').constraints[id].type);
    expect(types).toEqual(['coincident', 'horizontal', 'vertical', 'horizontal', 'vertical']);
    expect(status(engine.getState()).S).toBe('ok');
    // a corner snapped to a curve lies on it and stays on it
    const edge = draw(engine, 'rectangle', { first: { at: [(a[0] + b[0]) / 2 + 3, a[1] + 2], snap: { kind: 'curve', id: 'x' } }, opposite: free(-20, -25) });
    expect(sketchOf(engine, 'S').constraints[edge.ids.constraints[0]]).toEqual({ type: 'pointOnCurve', point: edge.ids.points[0], curve: 'x' });
    expect(at(engine, edge.ids.points[0])[1]).toBeCloseTo(a[1], 6);
    expect(status(engine.getState()).S).toBe('ok');
  });

  it('refuses corners it cannot draw and inputs that are not what the catalog says', () => {
    const engine = sketched();
    expect(refused(engine, 'rectangle', { first: free(1, 1), opposite: free(1, 9) })).toMatch(/must differ in both coordinates/);
    expect(refused(engine, 'rectangle', { first: onPoint('origin'), opposite: onPoint('origin') })).toMatch(/must differ/);
    expect(refused(engine, 'rectangle', { first: free(1, 1) })).toMatch(/input "opposite" is missing/);
    expect(refused(engine, 'rectangle', { first: free(1, 1), opposite: free(5, 5), sides: 4 })).toMatch(/Rectangle has no input "sides"/);
    expect(refused(engine, 'rectangle', { first: { at: [1] }, opposite: free(5, 5) })).toMatch(/first: `at` must be two finite numbers/);
    expect(refused(engine, 'rectangle', { first: { at: [1, NaN] }, opposite: free(5, 5) })).toMatch(/first: `at`/);
    expect(refused(engine, 'rectangle', { first: { at: [1, 1], snap: { kind: 'point', id: 'nope' } }, opposite: free(5, 5) })).toMatch(/no entity "nope"/);
    expect(refused(engine, 'rectangle', { first: { at: [1, 1], snap: { kind: 'curve', id: 'origin' } }, opposite: free(5, 5) })).toMatch(/"origin" is a point, not a curve/);
    expect(refused(engine, 'rectangle', { first: { at: [1, 1], near: 'origin' }, opposite: free(5, 5) })).toMatch(/an anchor has no field "near"/);
    expect(refused(engine, 'rectangle', null)).toMatch(/must be an object/);
    expect(refused(engine, 'star' as never, {})).toMatch(/unknown sketch tool "star"; the tools are rectangle, polygon/);
    expect(Object.keys(sketchOf(engine, 'S').points)).toEqual([]);
  });
});

describe('the polygon tool', () => {
  it.each([3, 4, 5, 6, 7, 8, 12])('%i sides: regular, with four degrees of freedom and one closed region', (sides) => {
    const engine = sketched();
    const made = draw(engine, 'polygon', { center: free(10, 5), vertex: free(18, 11), sides });
    expect(status(engine.getState()).S).toBe('ok');
    expect(engine.diagnoseSketch('S')).toMatchObject({ status: 'solved', degreesOfFreedom: 4, redundant: [], duplicates: [] });
    expect(made.ids.points).toHaveLength(sides);
    expect(made.ids.lines).toHaveLength(sides);
    expect(made.ids.constraints).toHaveLength(2 * sides - 1);
    expect(made.ids).not.toHaveProperty('size');
    // the first vertex is where it was clicked and the others follow counter-clockwise by equal steps
    expect(at(engine, made.ids.points[0])).toEqual([expect.closeTo(18, 6), expect.closeTo(11, 6)]);
    expect(at(engine, made.ids.center[0])).toEqual([expect.closeTo(10, 6), expect.closeTo(5, 6)]);
    for (const step of steps(engine, made)) expect(step).toBeCloseTo(1 / sides, 6);
    made.ids.lines.forEach((line, i) => expect(sketchOf(engine, 'S').curves[line]).toEqual({ type: 'line', a: made.ids.points[i], b: made.ids.points[(i + 1) % sides] }));
    // the circle is construction geometry: the only region is the polygon
    expect(sketchOf(engine, 'S').curves[made.ids.circle[0]]).toEqual({ construction: true, type: 'circle', center: made.ids.center[0] });
    expect(solved(engine, 'S').radii[made.ids.circle[0]]).toBeCloseTo(10, 6);
    expect(solved(engine, 'S').regions.map((region) => region.ref)).toEqual([{ outerLoop: [...made.ids.lines].sort() }]);
  });

  it('stays regular when it is dragged, turned and resized', () => {
    const engine = sketched();
    const made = draw(engine, 'polygon', { center: free(0, 0), vertex: free(10, 0), sides: 6 });
    run(engine, { type: 'dragPoint', sketch: 'S', point: made.ids.points[2], x: 4, y: 19 });
    for (const step of steps(engine, made)) expect(step).toBeCloseTo(1 / 6, 5);
    const side = length(engine, made.ids.points[0], made.ids.points[1]);
    made.ids.points.forEach((id, i) => expect(length(engine, id, made.ids.points[(i + 1) % 6])).toBeCloseTo(side, 5));
    // fixing the centre, a direction and a size determines it
    run(engine, constrain('S', 'fc', { type: 'coincident', a: made.ids.center[0], b: 'origin' }), constrain('S', 'flat', { type: 'horizontal', line: made.ids.lines[1] }), dimension('S', 'd', { type: 'diameter', curve: made.ids.circle[0] }, 24));
    expect(engine.diagnoseSketch('S')).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [] });
    expect(length(engine, made.ids.points[0], made.ids.points[1])).toBeCloseTo(12, 6); // the side of a hexagon is its circumradius
  });

  it('a size as the diameter of the circumscribed circle or across flats; a number is drawn at that size', () => {
    const engine = sketched();
    // the wrench size of an M3 nut: 5.5 across flats, drawn a little off
    const nut = draw(engine, 'polygon', { center: onPoint('origin'), vertex: free(3.3, 0.1), sides: 6, sizeKind: 'acrossFlats', size: 5.5 });
    expect(nut.ids.center).toEqual(['origin']);
    const sketch = sketchOf(engine, 'S');
    expect(sketch.constraints[nut.ids.size[0]]).toEqual({ type: 'distancePointLine', point: nut.ids.points[0], line: nut.ids.lines[3], value: 5.5, driving: true });
    expect(nut.ids.constraints).not.toContain(nut.ids.size[0]);
    expect(engine.diagnoseSketch('S')).toMatchObject({ status: 'solved', degreesOfFreedom: 1, redundant: [] }); // only the rotation is left
    // across flats: the distance of two opposite sides, the vertices on the circle of 5.5 / cos 30°
    const corner = solved(engine, 'S').radii[nut.ids.circle[0]];
    expect(corner).toBeCloseTo(5.5 / 2 / Math.cos(Math.PI / 6), 6);
    const [p0, p3, p4] = [at(engine, nut.ids.points[0]), at(engine, nut.ids.points[3]), at(engine, nut.ids.points[4])];
    const side = [p4[0] - p3[0], p4[1] - p3[1]];
    expect(Math.abs(side[0] * (p0[1] - p3[1]) - side[1] * (p0[0] - p3[0])) / Math.hypot(...side)).toBeCloseTo(5.5, 6);
    // the first vertex kept its direction from the centre
    expect(Math.atan2(p0[1], p0[0])).toBeCloseTo(Math.atan2(0.1, 3.3), 6);
    // the commands already have the size: the points were not left to the solver
    const first = nut.commands.find((command) => command.type === 'addPoint') as Extract<Command, { type: 'addPoint' }>;
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(corner, 9);

    // a size given without its kind is the circumscribed circle; an expression is kept
    run(engine, { type: 'setParameter', name: 'across', expr: '14' });
    const pentagon = draw(engine, 'polygon', { center: free(30, 0), vertex: free(30, 8), sides: 5, size: 'across + 2' });
    expect(sketchOf(engine, 'S').constraints[pentagon.ids.size[0]]).toEqual({ type: 'diameter', curve: pentagon.ids.circle[0], value: 16, driving: true });
    expect(sketchOf(engine, 'S').expressions).toEqual({ [`constraints/${pentagon.ids.size[0]}/value`]: 'across + 2' });
    run(engine, { type: 'setParameter', name: 'across', expr: '20' });
    expect(solved(engine, 'S').radii[pentagon.ids.circle[0]]).toBeCloseTo(11, 6);
    for (const step of steps(engine, pentagon)) expect(step).toBeCloseTo(0.2, 6);

    // the kind alone dimensions the size as drawn, rounded to 0.01 mm, and draws at the rounded size
    const drawn = draw(engine, 'polygon', { center: free(-30, 0), vertex: free(-30 + 7.0037, 0), sides: 8, sizeKind: 'circumscribed' });
    expect(sketchOf(engine, 'S').constraints[drawn.ids.size[0]]).toMatchObject({ type: 'diameter', value: 14.01 });
    expect(at(engine, drawn.ids.points[0])[0]).toBeCloseTo(-30 + 7.005, 9);
    const flats = draw(engine, 'polygon', { center: free(-60, 0), vertex: free(-55, 0), sides: 4, sizeKind: 'acrossFlats' });
    expect(sketchOf(engine, 'S').constraints[flats.ids.size[0]]).toMatchObject({ type: 'distancePointLine', point: flats.ids.points[0], line: flats.ids.lines[2], value: 7.07 });
    expect(status(engine.getState()).S).toBe('ok');
    expect(solved(engine, 'S').conflicting).toEqual([]);
  });

  it('snaps its centre and its first vertex like every drawing tool', () => {
    const engine = sketched();
    run(engine, circle('S', 'k', 20, 10, 6), { type: 'addPoint', sketch: 'S', id: 'v', x: 31, y: 12 });
    const made = draw(engine, 'polygon', { center: onPoint('kc'), vertex: onPoint('v'), sides: 5 });
    expect([made.ids.center[0], made.ids.points[0]]).toEqual(['kc', 'v']);
    expect(at(engine, 'v')).toEqual([expect.closeTo(31, 6), expect.closeTo(12, 6)]);
    for (const step of steps(engine, made)) expect(step).toBeCloseTo(0.2, 6);
    // the centre is dimensioned, so position is gone: the free point `v` gives size and rotation
    expect(engine.diagnoseSketch('S')).toMatchObject({ degreesOfFreedom: 2 });
    // a vertex snapped to a curve lies on it; with a size the solver brings the two together
    const onCircle = draw(engine, 'polygon', { center: free(60, 0), vertex: { at: [27, 10.5], snap: { kind: 'curve', id: 'k' } }, sides: 3 });
    const last = sketchOf(engine, 'S').constraints[onCircle.ids.constraints[0]];
    expect(last).toEqual({ type: 'pointOnCurve', point: onCircle.ids.points[0], curve: 'k' });
    expect(length(engine, onCircle.ids.points[0], 'kc')).toBeCloseTo(6, 6);
    expect(status(engine.getState()).S).toBe('ok');
  });

  it('refuses what it cannot draw', () => {
    const engine = sketched();
    const input = { center: free(0, 0), vertex: free(5, 0), sides: 6 };
    expect(refused(engine, 'polygon', { ...input, vertex: free(0, 0) })).toMatch(/the centre and the vertex are at the same place/);
    expect(refused(engine, 'polygon', { ...input, center: onPoint('origin'), vertex: onPoint('origin') })).toMatch(/same place/);
    expect(refused(engine, 'polygon', { ...input, sides: 2 })).toMatch(/sides: the value 2 is not/);
    expect(refused(engine, 'polygon', { ...input, sides: MAX_POLYGON_SIDES + 1 })).toMatch(/sides: the value 65 is not/);
    expect(refused(engine, 'polygon', { ...input, sides: 6.5 })).toMatch(/sides: the value 6.5 is not an integer/);
    expect(refused(engine, 'polygon', { ...input, sides: 'n' })).toMatch(/sides: a number is expected, not an expression/);
    expect(refused(engine, 'polygon', { center: free(0, 0), vertex: free(5, 0) })).toMatch(/input "sides" is missing/);
    expect(refused(engine, 'polygon', { ...input, sides: 5, sizeKind: 'acrossFlats' })).toMatch(/across flats needs an even number of sides/);
    expect(refused(engine, 'polygon', { ...input, sizeKind: 'inscribed' })).toMatch(/sizeKind: one of circumscribed, acrossFlats is expected/);
    expect(refused(engine, 'polygon', { ...input, size: 0 })).toMatch(/size: the value must be positive/);
    expect(refused(engine, 'polygon', { ...input, size: -3 })).toMatch(/size: the value must be positive/);
    expect(refused(engine, 'polygon', { ...input, size: ' ' })).toMatch(/size: the expression is empty/);
    expect(refused(engine, 'polygon', { ...input, size: true })).toMatch(/size: a number is expected/);
    // an expression the engine cannot evaluate is an invalid command of the batch, not of the tool
    const made = sketchTool('polygon', { sketch: sketchOf(engine, 'S'), result: solved(engine, 'S') }, { ...input, size: 'missing * 2' }, freshIds(engine.getState().document));
    expect(made.ok).toBe(true);
    expect(engine.execute(batch(...(made as Made).commands))).toMatchObject({ ok: false });
    expect(Object.keys(sketchOf(engine, 'S').points)).toEqual([]);
  });

  it('the IDs come from the caller and never repeat one the document has', () => {
    const engine = newEngine();
    // IDs that look like the ones the supplier hands out, as a feature, a point, a curve and a constraint
    run(engine, addSketch('p1', XY), addSketch('S', XY), { type: 'addPoint', sketch: 'S', id: 'p2', x: 1, y: 1 }, { type: 'addPoint', sketch: 'S', id: 'p4', x: 9, y: 1 });
    run(engine, { type: 'addCurve', sketch: 'S', id: 'c1', curve: { type: 'line', a: 'p2', b: 'p4' } }, constrain('S', 'k1', { type: 'horizontal', line: 'c1' }));
    const made = draw(engine, 'polygon', { center: free(0, 20), vertex: free(6, 20), sides: 3 });
    expect(made.ids.points).toEqual(['p5', 'p6', 'p7']);
    expect(made.ids.center).toEqual(['p3']);
    expect(made.ids.circle).toEqual(['c2']);
    expect(made.ids.lines).toEqual(['c3', 'c4', 'c5']);
    expect(made.ids.constraints[0]).toBe('k2');
    // a prefix keeps the IDs of one part of the model together
    const named = sketchTool('rectangle', { sketch: sketchOf(engine, 'S'), result: solved(engine, 'S') }, { first: free(40, 0), opposite: free(50, 5) }, freshIds(engine.getState().document, 'nut_'));
    expect((named as Made).ids.points).toEqual(['nut_p1', 'nut_p3', 'nut_p2', 'nut_p4']); // the two clicked corners get their IDs first
    expect(engine.execute(batch(...(named as Made).commands)).ok).toBe(true);
  });

  it('a nut pocket: a hexagon across flats around a hole, cut to a depth', () => {
    const engine = newEngine();
    run(engine, addSketch('S0', XY), rectangle('S0', 'r', -10, -10, 20, 20, null), addExtrude('block', 'S0', [rectLoop('r')], 10), addSketch('S', onFace('block', cap('block'))));
    run(engine, circle('S', 'bh', 0, 0, 1.7));
    const hex = draw(engine, 'polygon', { center: onPoint('bhc'), vertex: free(3.2, 0.2), sides: 6, sizeKind: 'acrossFlats', size: 5.5 });
    run(engine, constrain('S', 'flat', { type: 'horizontal', line: hex.ids.lines[1] }));
    expect(engine.diagnoseSketch('S')).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [] });
    const state = run(engine, {
      type: 'addFeature',
      feature: { id: 'pocket', name: 'pocket', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: [...hex.ids.lines].sort() }, { outerLoop: ['bh'] }] }, extent: { type: 'distance', start: 0, distance: -3 }, operation: 'cut', targets: ['block'] },
    });
    expect(status(state).pocket).toBe('ok');
    // the area of a hexagon with the size s across flats is s² · √3 / 2
    expect(4000 - volume(state.evaluation.bodies.block.solid)).toBeCloseTo((5.5 ** 2 * Math.sqrt(3)) / 2 * 3, 3);
  });
});
