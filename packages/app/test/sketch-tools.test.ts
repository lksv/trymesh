// Drawing tools and constraints from a selection against the real engine: the commands the UI builds
// must be accepted by the engine and the result must match what the user drew.
import { CONSTRAINTS, type Command, type Constraint, type DimensionShape, type Engine, type ExtrudeFeature, type Id, type SketchFeature, type SketchResult, type SketchToolCall, createEngine, duplicateOf, emptySketch, isOriginAxis, nearestCurvePoint } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import {
  type Anchor,
  CURVE_POINT_LABELS,
  DEFAULT_FILLET,
  DEFAULT_POLYGON,
  GEOMETRIC_KINDS,
  type PatternChoices,
  type PatternDraft,
  WALL_THICKNESS,
  arcCommands,
  asConstruction,
  axisKind,
  changeExtrude,
  changePattern,
  type PatternChange,
  type PatternMemory,
  rememberPattern,
  circleCommands,
  deleteCommands,
  dimensionFor,
  draftCommand,
  filletCommands,
  generatedProfile,
  geometricFor,
  lineCommands,
  normalizeAngle,
  patternIncomplete,
  patternSource,
  pointCommands,
  polygonCommands,
  polygonSizeKind,
  profileKind,
  rectangleCommands,
  repointSelection,
  noPlane,
  rememberedProfile,
} from '../src/sketch-commands';
import { type Shape, type SketchView, anchorOf, closestOn, hitCurve, hitPoint, insideLoop, kindOf, measure, operandsOf, polyline, sketchView } from '../src/sketch-view';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

// An engine with a sketch `s` on the plane XY and a counter of IDs as in the app.
function setup(): { engine: Engine; newId: (prefix: string) => Id; run: (commands: Command[] | undefined) => void; view: () => SketchView; tool: () => SketchToolCall; sketch: () => SketchFeature; result: () => SketchResult } {
  const engine = createEngine(deps);
  let counter = 0;
  const newId = (prefix: string) => `${prefix}${++counter}`;
  const execute = (command: Command) => {
    const outcome = engine.execute(command);
    if (!outcome.ok) throw new Error(outcome.error.message);
  };
  execute({ type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) });
  const sketch = () => engine.getState().document.features.find((f) => f.id === 's') as SketchFeature;
  const result = () => engine.getState().evaluation.features.s.sketch as SketchResult;
  return {
    engine,
    newId,
    run: (commands) => {
      expect(commands).toBeDefined();
      execute({ type: 'batch', commands: commands as Command[] });
    },
    view: () => sketchView(sketch(), result()),
    // what the sketch tools of the engine take, as the app makes it (sketchContextOf)
    tool: () => ({ sketch: sketch(), result: result(), parameters: engine.getState().evaluation.parameters, document: engine.getState().document, features: engine.getState().evaluation.features }),
    sketch,
    result,
  };
}
const free = (x: number, y: number): Anchor => ({ at: [x, y] });
const onPoint = (view: SketchView, id: Id): Anchor => ({ at: view.points.get(id)!.at, snap: { kind: 'point', id } });
const types = (sketch: SketchFeature): string[] => Object.values(sketch.constraints).map((c) => c.type).sort();

describe('drawing tools', () => {
  it('a rectangle from the origin: four lines, one region, only the width and the height free', () => {
    const t = setup();
    t.run(rectangleCommands('s', t.tool(), onPoint(t.view(), 'origin'), free(30, 20), t.newId));
    expect(Object.keys(t.sketch().points)).toHaveLength(3); // the fourth corner is the origin
    expect(Object.keys(t.sketch().curves)).toHaveLength(4);
    expect(types(t.sketch())).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(t.result().regions).toHaveLength(1);
    expect(t.result().degreesOfFreedom).toBe(2);
  });

  it('construction mode: the curves of the tool are construction geometry, the constraints arise the same and they make no profile', () => {
    const t = setup();
    t.run(asConstruction(rectangleCommands('s', t.tool(), onPoint(t.view(), 'origin'), free(30, 20), t.newId)!));
    expect(Object.values(t.sketch().curves).map((curve) => curve.construction)).toEqual([true, true, true, true]);
    expect(types(t.sketch())).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(t.result().regions).toHaveLength(0);
    expect(t.result().degreesOfFreedom).toBe(2);
    expect([...t.view().curves.values()].filter((curve) => curve.own).every((curve) => curve.construction)).toBe(true);
    // a circle and an arc; an ordinary curve drawn afterwards is not construction geometry
    t.run(asConstruction(circleCommands('s', t.view(), free(50, 0), free(55, 0), t.newId)!));
    t.run(asConstruction(arcCommands('s', t.view(), free(80, 0), free(90, 0), free(80, 10), t.newId)!));
    t.run(lineCommands('s', t.view(), free(0, 40), free(10, 40), t.newId)!.commands);
    expect(Object.values(t.sketch().curves).map((curve) => curve.construction === true)).toEqual([true, true, true, true, true, true, false]);
    // commands without curves stay unchanged
    const point = pointCommands('s', t.view(), free(5, 5), t.newId) as Command[];
    expect(asConstruction(point)).toEqual(point);
  });

  it('a rectangle of zero width or from two equal points is not made', () => {
    const t = setup();
    expect(rectangleCommands('s', t.tool(), free(1, 1), free(1, 5), t.newId)).toBeUndefined();
    expect(rectangleCommands('s', t.tool(), onPoint(t.view(), 'origin'), onPoint(t.view(), 'origin'), t.newId)).toBeUndefined();
  });

  it('a polygon: a hexagon by default, the dimension of the size as the panel says', () => {
    const t = setup();
    expect(DEFAULT_POLYGON).toEqual({ sides: 6, sizeKind: 'none' });
    t.run(polygonCommands('s', t.tool(), onPoint(t.view(), 'origin'), free(10, 0), DEFAULT_POLYGON, t.newId));
    expect(Object.keys(t.sketch().points)).toHaveLength(6);
    const curves = Object.values(t.sketch().curves);
    expect(curves.map((curve) => [curve.type, curve.construction === true])).toEqual([['circle', true], ...Array.from({ length: 6 }, () => ['line', false])]);
    expect(types(t.sketch())).toEqual([...Array.from({ length: 5 }, () => 'equalLength'), ...Array.from({ length: 6 }, () => 'pointOnCurve')]);
    expect(t.result().regions).toHaveLength(1);
    expect(t.result().degreesOfFreedom).toBe(2); // the size and the rotation
    // across flats: the size as drawn, rounded; vertex at 10 from the centre gives 10 · √3
    const flats = setup();
    flats.run(polygonCommands('s', flats.tool(), onPoint(flats.view(), 'origin'), free(10, 0), { sides: 6, sizeKind: 'acrossFlats' }, flats.newId));
    const size = Object.values(flats.sketch().constraints).find((constraint) => constraint.type === 'distancePointLine');
    expect(size).toMatchObject({ value: 17.32, driving: true });
    expect(flats.result().degreesOfFreedom).toBe(1);
    // an odd number of sides has no size across flats: the circle is dimensioned instead
    expect(polygonSizeKind({ sides: 5, sizeKind: 'acrossFlats' })).toBe('circumscribed');
    expect(polygonSizeKind({ sides: 8, sizeKind: 'acrossFlats' })).toBe('acrossFlats');
    expect(polygonSizeKind({ sides: 5, sizeKind: 'none' })).toBe('none');
    const odd = setup();
    odd.run(polygonCommands('s', odd.tool(), free(5, 5), free(5, 15), { sides: 5, sizeKind: 'acrossFlats' }, odd.newId));
    expect(Object.values(odd.sketch().constraints).find((constraint) => constraint.type === 'diameter')).toMatchObject({ value: 20, driving: true });
    expect(odd.result().degreesOfFreedom).toBe(3); // the place and the rotation
    // a polygon of no size is not drawn
    expect(polygonCommands('s', t.tool(), free(1, 1), free(1, 1), DEFAULT_POLYGON, t.newId)).toBeUndefined();
    expect(polygonCommands('s', t.tool(), onPoint(t.view(), 'origin'), onPoint(t.view(), 'origin'), DEFAULT_POLYGON, t.newId)).toBeUndefined();
  });

  it('a chain of lines shares points and closes on the first point', () => {
    const t = setup();
    const first = lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId, 'horizontal');
    t.run(first?.commands);
    const start = Object.keys(t.sketch().points)[0];
    const second = lineCommands('s', t.view(), onPoint(t.view(), first!.end), free(10, 12), t.newId, 'vertical');
    t.run(second?.commands);
    const third = lineCommands('s', t.view(), onPoint(t.view(), second!.end), onPoint(t.view(), start), t.newId);
    t.run(third?.commands);
    expect(third!.end).toBe(start);
    expect(Object.keys(t.sketch().points)).toHaveLength(3);
    expect(Object.keys(t.sketch().curves)).toHaveLength(3);
    expect(types(t.sketch())).toEqual(['horizontal', 'vertical']);
    expect(t.result().regions).toHaveLength(1);
    // a line from a point to the same point is not made
    expect(lineCommands('s', t.view(), onPoint(t.view(), start), onPoint(t.view(), start), t.newId)).toBeUndefined();
  });

  it('a snap to a curve adds a point-on-curve constraint and the point lies on it', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0.5), free(20, 0.5), t.newId)?.commands);
    const line = Object.keys(t.sketch().curves)[0];
    t.run(lineCommands('s', t.view(), { at: [8, 0.7], snap: { kind: 'curve', id: line } }, free(8, 10), t.newId)?.commands);
    expect(types(t.sketch())).toEqual(['pointOnCurve']);
    const added = Object.values(t.sketch().constraints)[0] as Extract<Constraint, { type: 'pointOnCurve' }>;
    expect(t.result().points[added.point].y).toBeCloseTo(0.5, 6);
    // a point alone: on a curve with a constraint, on an existing point nothing
    expect(pointCommands('s', t.view(), onPoint(t.view(), 'origin'), t.newId)).toBeUndefined();
    t.run(pointCommands('s', t.view(), { at: [15, 0.4], snap: { kind: 'curve', id: line } }, t.newId));
    expect(types(t.sketch())).toEqual(['pointOnCurve', 'pointOnCurve']);
  });

  it('a circle: the radius from the second click; a snap of the circumference to a point adds a constraint', () => {
    const t = setup();
    t.run(pointCommands('s', t.view(), free(10, 0), t.newId));
    const point = Object.keys(t.sketch().points)[0];
    t.run(circleCommands('s', t.view(), free(4, 0), onPoint(t.view(), point), t.newId));
    const circle = Object.keys(t.sketch().curves)[0];
    expect(t.result().radii[circle]).toBeCloseTo(6, 6);
    expect(types(t.sketch())).toEqual(['pointOnCurve']);
    expect(circleCommands('s', t.view(), free(4, 0), free(4, 0), t.newId)).toBeUndefined();
  });

  it('an arc: the free end moves to the radius of the start and the arc runs counterclockwise', () => {
    const t = setup();
    t.run(arcCommands('s', t.view(), free(0, 0), free(10, 0), free(0, 25), t.newId));
    const arc = [...t.view().curves.values()][0];
    expect(arc.shape).toMatchObject({ type: 'arc', radius: expect.closeTo(10, 6), from: expect.closeTo(0, 6), sweep: expect.closeTo(Math.PI / 2, 6) });
    expect(t.result().points[arc.points[2]]).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(10, 6) });
    expect(t.result().conflicting).toEqual([]);
    expect(arcCommands('s', t.view(), free(0, 0), free(0, 0), free(5, 5), t.newId)).toBeUndefined();
  });

  it('an end on a projected point: a new own point with a coincident constraint', () => {
    const t = setup();
    // a box 30 × 20 × 10 and a sketch on its top face with a projected edge
    t.run(rectangleCommands('s', t.tool(), onPoint(t.view(), 'origin'), free(30, 20), t.newId));
    const loop = Object.keys(t.sketch().curves).sort();
    const execute = (command: Command) => expect(t.engine.execute(command)).toMatchObject({ ok: true });
    execute({ type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: loop }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    const top = { feature: 'e', role: 'endCap' as const };
    const edge = t.engine.getState().evaluation.bodies.e.edges.find((e) => e.kind === 'line' && JSON.stringify(e.name).includes('endCap'))!;
    execute({ type: 'addFeature', feature: emptySketch('s2', 'Skica 2', { kind: 'face', body: 'e', face: top }) });
    execute({ type: 'addExternal', sketch: 's2', id: 'x', ref: { type: 'edge', body: 'e', edge: edge.name, kind: 'line' } });
    const state = () => t.engine.getState();
    const sketch2 = () => state().document.features.find((f) => f.id === 's2') as SketchFeature;
    const view = sketchView(sketch2(), state().evaluation.features.s2.sketch!);
    expect(view.curves.get('x')).toMatchObject({ own: false, points: ['x/a', 'x/b'] });
    const corner = view.points.get('x/a')!;
    const line = lineCommands('s2', view, { at: corner.at, snap: { kind: 'point', id: 'x/a' } }, free(corner.at[0] + 3, corner.at[1] + 4), t.newId);
    execute({ type: 'batch', commands: line!.commands });
    expect(types(sketch2())).toEqual(['coincident']);
    const curve = Object.values(sketch2().curves)[0] as { a: Id };
    expect(curve.a).not.toBe('x/a'); // the curve does not refer to the projected point
    expect(state().evaluation.features.s2.sketch!.points[curve.a]).toMatchObject({ x: expect.closeTo(corner.at[0], 6), y: expect.closeTo(corner.at[1], 6) });
  });
});

describe('the fillet and the re-point (D52)', () => {
  it('the fillet of a corner through the context of the app; a refusal comes back with its reason', () => {
    const t = setup();
    t.run(rectangleCommands('s', t.tool(), onPoint(t.view(), 'origin'), free(30, 20), t.newId));
    const corner = [...t.view().points.values()].find((p) => Math.hypot(p.at[0] - 30, p.at[1] - 20) < 1e-9)!.id;
    expect(DEFAULT_FILLET).toEqual({ radius: 2 });
    const made = filletCommands(t.tool(), corner, { radius: 4 }, t.newId);
    expect(made.ok).toBe(true);
    t.run(made.ok ? made.commands : undefined);
    expect(t.result().regions).toHaveLength(1);
    expect(Object.values(t.sketch().curves).filter((curve) => curve.type === 'arc')).toHaveLength(1);
    expect(filletCommands(t.tool(), corner, { radius: 4 }, t.newId)).toEqual({ ok: false, message: expect.stringMatching(/no curve ends there/) });
  });

  it('the selection a curve can be re-pointed by: one own curve and one own point or the origin; the nearer point first', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0), free(10, 0), t.newId)!.commands);
    t.run(pointCommands('s', t.view(), free(9, 5), t.newId));
    const [line] = Object.keys(t.sketch().curves);
    const [a, b, p] = Object.keys(t.sketch().points);
    expect(repointSelection(t.view(), [line, p])).toEqual({ curve: line, to: p });
    expect(repointSelection(t.view(), [p, line])).toEqual({ curve: line, to: p });
    expect(repointSelection(t.view(), [line, 'origin'])).toEqual({ curve: line, to: 'origin' });
    expect(repointSelection(t.view(), [line])).toBeUndefined();
    expect(repointSelection(t.view(), [a, b])).toBeUndefined();
    expect(repointSelection(t.view(), [line, p, a])).toBeUndefined();
    expect(nearestCurvePoint(t.view().source, line, p)).toBe('b');
    expect(nearestCurvePoint(t.view().source, line, 'origin')).toBe('a');
    expect(nearestCurvePoint(t.view().source, 'nope', p)).toBeUndefined();
    expect(Object.keys(CURVE_POINT_LABELS).sort()).toEqual(['a', 'b', 'center', 'end', 'start']);
  });
});

describe('constraints and dimensions from a selection', () => {
  // a triangle p1 (0,0) – p2 (12,0) – p3 (12,9), a circle and an arc aside
  function shapes() {
    const t = setup();
    const a = lineCommands('s', t.view(), free(1, 1), free(13, 1), t.newId)!;
    t.run(a.commands);
    const b = lineCommands('s', t.view(), onPoint(t.view(), a.end), free(13, 10), t.newId)!;
    t.run(b.commands);
    t.run(circleCommands('s', t.view(), free(30, 5), free(34, 5), t.newId));
    t.run(arcCommands('s', t.view(), free(-20, 0), free(-15, 0), free(-20, 5), t.newId));
    const view = t.view();
    const curves = [...view.curves.values()];
    const [bottom, right] = curves.filter((c) => c.shape.type === 'line').map((c) => c.id);
    return { t, view, bottom, right, circle: curves.find((c) => c.shape.type === 'circle')!.id, arc: curves.find((c) => c.shape.type === 'arc')!.id, corner: a.end, start: view.curves.get(bottom)!.points[0], top: b.end };
  }

  it('the type of a dimension by the selection matches the table in docs/ui.md', () => {
    const s = shapes();
    const kind = (ids: Id[], variant: 'auto' | 'horizontal' | 'vertical' = 'auto') => dimensionFor(variant, s.view, ids);
    expect(kind([s.start, s.top])).toMatchObject({ type: 'distance', a: s.start, b: s.top, value: 15, driving: true });
    expect(kind([s.bottom])).toMatchObject({ type: 'distance', a: s.start, b: s.corner, value: 12 });
    expect(kind([s.top, s.bottom])).toMatchObject({ type: 'distancePointLine', point: s.top, line: s.bottom, value: 9 });
    expect(kind([s.bottom, s.right])).toMatchObject({ type: 'angle', a: s.bottom, b: s.right, value: expect.closeTo(Math.PI / 2, 9) });
    expect(kind([s.circle])).toMatchObject({ type: 'diameter', curve: s.circle, value: 8 });
    expect(kind([s.arc])).toMatchObject({ type: 'radius', curve: s.arc, value: 5 });
    expect(kind([s.top, s.start], 'horizontal')).toMatchObject({ type: 'horizontalDistance', a: s.top, b: s.start, value: -12 }); // signed: b − a
    expect(kind([s.right], 'vertical')).toMatchObject({ type: 'verticalDistance', value: 9 });
    expect(kind([s.circle], 'horizontal')).toBeUndefined();
    expect(kind([s.start, s.top, s.corner])).toBeUndefined();
    expect(kind([])).toBeUndefined();
  });

  it('the engine accepts dimensions from a selection and the sketch stays without a conflict', () => {
    const s = shapes();
    for (const ids of [[s.start, s.top], [s.bottom], [s.bottom, s.right], [s.circle], [s.arc]]) {
      const d = dimensionFor('auto', s.t.view(), ids);
      s.t.run([{ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint: d! }]);
    }
    expect(s.t.result().conflicting).toEqual([]);
    expect(s.t.engine.getState().evaluation.features.s.status).toBe('ok');
  });

  it('two parallel lines get their distance and a line with a circle the gap between them (D75)', () => {
    const s = shapes();
    s.t.run(lineCommands('s', s.t.view(), free(2, 6), free(9, 6), s.t.newId)!.commands);
    const view = s.t.view();
    const third = [...view.curves.values()].find((c) => c.shape.type === 'line' && c.id !== s.bottom && c.id !== s.right)!.id;
    const kind = (ids: Id[], variant: 'auto' | 'horizontal' | 'vertical' = 'auto') => dimensionFor(variant, view, ids);
    // parallel within the tolerance of the engine: the distance; otherwise the angle as before
    expect(kind([s.bottom, third])).toEqual({ type: 'distanceLineLine', a: s.bottom, b: third, value: 5, driving: true });
    expect(kind([third, s.right])).toMatchObject({ type: 'angle', a: third, b: s.right });
    expect(kind([s.bottom, third], 'horizontal')).toBeUndefined();
    // a line and a circle or an arc, in either order of the selection
    expect(kind([s.right, s.circle])).toEqual({ type: 'distanceLineCircle', line: s.right, curve: s.circle, value: 13, driving: true });
    expect(kind([s.arc, s.right])).toEqual({ type: 'distanceLineCircle', line: s.right, curve: s.arc, value: 28, driving: true });
    expect(measure({ type: 'distanceLineCircle', line: s.bottom, curve: s.arc }, view)).toBe(-4);
    expect(kind([s.bottom, s.arc])).toBeUndefined(); // the circle of the arc crosses the line: no gap to dimension
    // the engine accepts them and nothing moves
    const before = s.t.result().points;
    for (const ids of [[s.bottom, third], [s.right, s.circle], [s.arc, s.right]]) s.t.run([{ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint: kind(ids)! }]);
    expect(s.t.result().conflicting).toEqual([]);
    expect(s.t.engine.getState().evaluation.features.s.status).toBe('ok');
    for (const [id, p] of Object.entries(s.t.result().points)) expect([p.x, p.y], id).toEqual([expect.closeTo(before[id].x, 6), expect.closeTo(before[id].y, 6)]);
  });

  it('measuring in the UI uses the same conventions as the reference dimensions of the engine', () => {
    const s = shapes();
    const dimensions: DimensionShape[] = [
      { type: 'distance', a: s.start, b: s.top },
      { type: 'horizontalDistance', a: s.top, b: s.start },
      { type: 'verticalDistance', a: s.top, b: s.start },
      { type: 'distancePointLine', point: s.top, line: s.bottom },
      // D75: of two lines from the point a of the first, also when they are not parallel; of a
      // circle the gap, negative where the arc's circle crosses the line
      { type: 'distanceLineLine', a: s.right, b: s.bottom },
      { type: 'distanceLineCircle', line: s.right, curve: s.circle },
      { type: 'distanceLineCircle', line: s.right, curve: s.arc },
      { type: 'distanceLineCircle', line: s.bottom, curve: s.arc },
      { type: 'angle', a: s.right, b: s.bottom },
      { type: 'angle', a: s.bottom, b: s.right },
      { type: 'radius', curve: s.arc },
      { type: 'diameter', curve: s.circle },
    ];
    s.t.run(dimensions.map((shape, i): Command => ({ type: 'addConstraint', sketch: 's', id: `ref${i}`, constraint: { ...shape, value: 1, driving: false } })));
    const view = s.t.view();
    dimensions.forEach((shape, i) => expect(measure(shape, view), shape.type).toBeCloseTo(s.t.result().measurements[`ref${i}`], 9));
    expect(measure({ type: 'distance', a: s.start, b: 'missing' }, view)).toBeUndefined();
  });

  it('constraints without a special rule are offered by the catalog of the engine: symmetry and the midpoint of a line', () => {
    // the list of geometric constraints is the catalog without dimensions, so a new constraint of the engine is in it by itself
    expect(GEOMETRIC_KINDS).toEqual(['coincident', 'pointOnCurve', 'horizontal', 'vertical', 'horizontalPoints', 'verticalPoints', 'parallel', 'perpendicular', 'equalLength', 'tangent', 'symmetric', 'midpoint', 'midpointPoints', 'equalRadius', 'fixed']);
    expect(Object.keys(CONSTRAINTS).filter((type) => !GEOMETRIC_KINDS.includes(type as (typeof GEOMETRIC_KINDS)[number]))).toEqual(['distance', 'distancePointLine', 'distanceLineLine', 'distanceLineCircle', 'horizontalDistance', 'verticalDistance', 'angle', 'radius', 'diameter']);

    const t = setup();
    t.run([
      { type: 'addPoint', sketch: 's', id: 'top', x: 0.4, y: 30 },
      { type: 'addCurve', sketch: 's', id: 'axis', curve: { type: 'line', a: 'origin', b: 'top', construction: true } },
      { type: 'addPoint', sketch: 's', id: 'l', x: -12, y: 8 },
      { type: 'addPoint', sketch: 's', id: 'r', x: 15, y: 11 },
      { type: 'addPoint', sketch: 's', id: 'm', x: 2, y: 13 },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 3 },
      { type: 'addConstraint', sketch: 's', id: 'v', constraint: { type: 'vertical', line: 'axis' } },
    ]);
    const offer = (kind: Parameters<typeof geometricFor>[0], ids: Id[]) => geometricFor(kind, t.view(), ids);
    // the operands are assigned by kind; the order in which the axis and the points are selected does not matter
    expect(offer('symmetric', ['l', 'r', 'axis'])).toEqual([{ type: 'symmetric', a: 'l', b: 'r', line: 'axis' }]);
    expect(offer('symmetric', ['axis', 'r', 'l'])).toEqual([{ type: 'symmetric', a: 'r', b: 'l', line: 'axis' }]);
    expect(offer('symmetric', ['l', 'r'])).toBeUndefined();
    expect(offer('symmetric', ['l', 'axis', 'k'])).toBeUndefined(); // a circle instead of the second point
    expect(offer('symmetric', ['l', 'r', 'm', 'axis'])).toBeUndefined();
    expect(offer('midpoint', ['axis', 'm'])).toEqual([{ type: 'midpoint', point: 'm', line: 'axis' }]);
    expect(offer('midpoint', ['m', 'k'])).toBeUndefined();
    expect(offer('midpoint', ['m'])).toBeUndefined();
    // D75: two points level or plumb, in the order of the selection; of three points the first one selected is the middle
    expect(offer('horizontalPoints', ['l', 'r'])).toEqual([{ type: 'horizontalPoints', a: 'l', b: 'r' }]);
    expect(offer('verticalPoints', ['m', 'top'])).toEqual([{ type: 'verticalPoints', a: 'm', b: 'top' }]);
    expect(offer('horizontalPoints', ['l', 'axis'])).toBeUndefined();
    expect(offer('horizontalPoints', ['origin', 'r'])).toEqual([{ type: 'horizontalPoints', a: 'origin', b: 'r' }]);
    expect(offer('midpointPoints', ['m', 'l', 'r'])).toEqual([{ type: 'midpointPoints', point: 'm', a: 'l', b: 'r' }]);
    expect(offer('midpointPoints', ['l', 'r'])).toBeUndefined();
    expect(offer('midpointPoints', ['m', 'l', 'axis'])).toBeUndefined();
    // a selection the engine would refuse by a rule of the constraint itself is not offered
    expect(offer('symmetric', ['origin', 'r', 'axis'])).toBeUndefined(); // the symmetric point is an end of the axis
    expect(offer('symmetric', ['top', 'r', 'axis'])).toBeUndefined();
    expect(offer('midpoint', ['top', 'axis'])).toBeUndefined(); // the midpoint would be an end of the line
    expect(offer('symmetric', ['l', 'l', 'axis'])).toBeUndefined();
    // the engine accepts the offered constraints and the geometry matches them
    t.run([...offer('symmetric', ['l', 'r', 'axis'])!, ...offer('midpoint', ['axis', 'm'])!].map((constraint): Command => ({ type: 'addConstraint', sketch: 's', id: t.newId('k'), constraint })));
    const p = t.result().points;
    expect(t.result().conflicting).toEqual([]);
    expect(p.l.x).toBeCloseTo(-p.r.x, 6);
    expect(p.l.y).toBeCloseTo(p.r.y, 6);
    expect([p.m.x, p.m.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(p.top.y / 2, 6)]);
    // the label of a constraint in the view sits at its operands: symmetry on the axis between the points, the midpoint at the point
    const anchor = (type: Constraint['type']) => anchorOf(Object.values(t.sketch().constraints).find((c) => c.type === type)!, t.view())!;
    expect(anchor('symmetric')[0]).toBeCloseTo(0, 6);
    expect(anchor('symmetric')[1]).toBeGreaterThan(p.l.y);
    expect(anchor('symmetric')[1]).toBeLessThan(p.top.y);
    expect(anchor('midpoint')).toEqual([expect.closeTo(p.m.x, 6), expect.closeTo(p.m.y, 6)]);
    expect(operandsOf({ type: 'symmetric', a: 'l', b: 'r', line: 'axis' })).toEqual(['l', 'r', 'axis']);
  });

  it('geometric constraints are offered only for a fitting selection', () => {
    const s = shapes();
    const offer = (kind: Parameters<typeof geometricFor>[0], ids: Id[]) => geometricFor(kind, s.view, ids);
    expect(offer('coincident', [s.start, s.top])).toEqual([{ type: 'coincident', a: s.start, b: s.top }]);
    expect(offer('coincident', [s.start, s.bottom])).toBeUndefined();
    expect(offer('pointOnCurve', [s.circle, s.top])).toEqual([{ type: 'pointOnCurve', point: s.top, curve: s.circle }]);
    expect(offer('horizontal', [s.bottom, s.right])).toEqual([{ type: 'horizontal', line: s.bottom }, { type: 'horizontal', line: s.right }]);
    expect(offer('vertical', [s.circle])).toBeUndefined();
    expect(offer('parallel', [s.bottom, s.right])).toEqual([{ type: 'parallel', a: s.bottom, b: s.right }]);
    expect(offer('equalLength', [s.bottom])).toBeUndefined();
    expect(offer('tangent', [s.bottom, s.circle])).toEqual([{ type: 'tangent', a: s.bottom, b: s.circle }]);
    expect(offer('tangent', [s.arc, s.circle])).toEqual([{ type: 'tangent', a: s.arc, b: s.circle }]);
    expect(offer('tangent', [s.bottom, s.right])).toBeUndefined(); // two lines
    // the engine accepts every offered constraint
    for (const kind of ['horizontal', 'perpendicular', 'tangent'] as const) {
      const ids = kind === 'tangent' ? [s.bottom, s.circle] : kind === 'horizontal' ? [s.bottom] : [s.bottom, s.right];
      s.t.run(offer(kind, ids)!.map((constraint): Command => ({ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint })));
    }
    expect(s.t.result().conflicting).toEqual([]);
  });

  it('equal radius and a fixed point are offered for a fitting selection (D35, point 6)', () => {
    const s = shapes();
    const offer = (kind: Parameters<typeof geometricFor>[0], ids: Id[]) => geometricFor(kind, s.view, ids);
    // two circles or arcs, in the order of the selection
    expect(offer('equalRadius', [s.circle, s.arc])).toEqual([{ type: 'equalRadius', a: s.circle, b: s.arc }]);
    expect(offer('equalRadius', [s.arc, s.circle])).toEqual([{ type: 'equalRadius', a: s.arc, b: s.circle }]);
    expect(offer('equalRadius', [s.circle])).toBeUndefined();
    expect(offer('equalRadius', [s.circle, s.bottom])).toBeUndefined();
    expect(offer('equalRadius', [s.circle, s.top])).toBeUndefined();
    // every selected own point is fixed where it is; the origin and curves are not offered
    const [top, start] = [s.view.points.get(s.top)!.at, s.view.points.get(s.start)!.at];
    expect(offer('fixed', [s.top])).toEqual([{ type: 'fixed', point: s.top, x: top[0], y: top[1] }]);
    expect(offer('fixed', [s.top, s.start])).toEqual([
      { type: 'fixed', point: s.top, x: top[0], y: top[1] },
      { type: 'fixed', point: s.start, x: start[0], y: start[1] },
    ]);
    expect(offer('fixed', [])).toBeUndefined();
    expect(offer('fixed', ['origin'])).toBeUndefined();
    expect(offer('fixed', [s.top, 'origin'])).toBeUndefined();
    expect(offer('fixed', [s.top, s.circle])).toBeUndefined();
    // the engine accepts what is offered: nothing moves, the radii become equal, the points lose their freedom
    const before = s.t.result().degreesOfFreedom;
    s.t.run([...offer('equalRadius', [s.circle, s.arc])!, ...offer('fixed', [s.top, s.start])!].map((constraint): Command => ({ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint })));
    const result = s.t.result();
    expect(result.conflicting).toEqual([]);
    expect(result.degreesOfFreedom).toBe(before - 5);
    expect(result.points[s.top]).toEqual({ x: expect.closeTo(top[0], 9), y: expect.closeTo(top[1], 9) });
    const arc = s.t.view().curves.get(s.arc)!.shape as Extract<Shape, { type: 'arc' }>;
    expect(arc.radius).toBeCloseTo(result.radii[s.circle], 6);
    // the label of the constraint sits at its point; the operands come from the catalog
    const fixed = Object.values(s.t.sketch().constraints).find((c) => c.type === 'fixed')!;
    expect(anchorOf(fixed, s.t.view())).toEqual([expect.closeTo(top[0], 6), expect.closeTo(top[1], 6)]);
    expect(operandsOf(fixed)).toEqual([s.top]);
    // the same constraint is not offered twice by the engine's duplicate rule
    expect(duplicateOf(s.t.sketch(), offer('fixed', [s.top])![0])).toBeDefined();
    expect(duplicateOf(s.t.sketch(), { type: 'equalRadius', a: s.arc, b: s.circle })).toBeDefined();
  });
});

describe('hit test', () => {
  it('a point has a reach, an own point wins a tie; the nearest curve is taken', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0), free(10, 0), t.newId)?.commands); // starts with a free point exactly at the origin
    const view = t.view();
    const own = [...view.points.values()].find((p) => p.own && p.at[0] === 0)!;
    expect(hitPoint(view, [0.2, 0.1], 0.5)?.id).toBe(own.id); // the origin lies in the same place, the own point takes precedence
    expect(hitPoint(view, [0.2, 0.1], 0.5, (id) => id === own.id)?.id).toBe('origin');
    expect(hitPoint(view, [5, 3], 0.5)).toBeUndefined();
    expect(hitCurve(view, [5, 0.3], 0.5)?.id).toBe([...view.curves.keys()][0]);
    expect(hitCurve(view, [5, 0.6], 0.5)).toBeUndefined();
    // past the end of the line runs the X axis of the origin (D71), a whole line
    expect(hitCurve(view, [11, 0], 0.5)?.id).toBe('origin/x');
    expect(hitCurve(view, [11, 0], 0.5, isOriginAxis)).toBeUndefined();
  });

  it('the nearest point of an arc outside its range is the nearer end', () => {
    const arc = { type: 'arc' as const, center: [0, 0] as [number, number], radius: 10, from: 0, sweep: Math.PI / 2 };
    expect(closestOn(arc, [20, 20])).toEqual([expect.closeTo(7.0711, 3), expect.closeTo(7.0711, 3)]);
    expect(closestOn(arc, [5, -8])).toEqual([expect.closeTo(10, 9), expect.closeTo(0, 9)]);
    expect(closestOn(arc, [-8, 5])).toEqual([expect.closeTo(0, 9), expect.closeTo(10, 9)]);
    const points = polyline(arc);
    expect(points[0]).toEqual([10, 0]);
    expect(points[points.length - 1]).toEqual([expect.closeTo(0, 9), expect.closeTo(10, 9)]);
    expect(polyline({ type: 'circle', center: [1, 1], radius: 2 })).toHaveLength(97); // closed
  });
});

describe('findings of the review of the app', () => {
  it('review of D52: the row Re-point is not offered for a point the curve has already', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0), free(10, 0), t.newId)!.commands);
    const [line] = Object.keys(t.sketch().curves);
    const [a, b] = Object.keys(t.sketch().points);
    expect(repointSelection(t.view(), [line, a])).toBeUndefined();
    expect(repointSelection(t.view(), [b, line])).toBeUndefined();
    t.run(arcCommands('s', t.view(), onPoint(t.view(), 'origin'), free(20, 0), free(0, 20), t.newId));
    const arc = Object.keys(t.sketch().curves).find((id) => t.sketch().curves[id].type === 'arc')!;
    expect(repointSelection(t.view(), [arc, 'origin'])).toBeUndefined();
    expect(repointSelection(t.view(), [arc, b])).toEqual({ curve: arc, to: b });
  });

  it('a double click with the Line tool does not make a line of zero length', () => {
    const t = setup();
    // two clicks on the same empty place
    expect(lineCommands('s', t.view(), free(3, 3), free(3, 3), t.newId)).toBeUndefined();
    // the second click at the end of the line just drawn: it snaps to its end and the chain ends
    const first = lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId)!;
    t.run(first.commands);
    expect(lineCommands('s', t.view(), onPoint(t.view(), first.end), onPoint(t.view(), first.end), t.newId)).toBeUndefined();
    // even without a snap (the cursor computed before the point existed) a line to the same place is not made
    expect(lineCommands('s', t.view(), onPoint(t.view(), first.end), free(10, 5), t.newId)).toBeUndefined();
    expect(Object.keys(t.sketch().curves)).toHaveLength(1);
    expect(t.result().valid).toBe(true);
    expect(arcCommands('s', t.view(), free(0, 0), free(5, 0), free(9, 0), t.newId)).toBeUndefined(); // the end at the start
  });

  it('an angle dimension just by −180° is stored as 180° and the engine accepts it', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId)?.commands);
    t.run(lineCommands('s', t.view(), free(10, 8), free(0, 8.02), t.newId)?.commands); // almost opposite
    const [first, second] = Object.keys(t.sketch().curves);
    for (const pair of [[first, second], [second, first]]) {
      const d = dimensionFor('auto', t.view(), pair)!;
      expect(d).toMatchObject({ type: 'angle', value: Math.PI });
      t.run([{ type: 'addConstraint', sketch: 's', id: t.newId('k'), constraint: { ...d, driving: false } }]);
    }
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
    expect(normalizeAngle((270 * Math.PI) / 180)).toBeCloseTo(-Math.PI / 2, 12);
    expect(normalizeAngle(0.5)).toBe(0.5);
  });

  it('a new dimension has a value rounded without decimal noise', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0.5), free(4.3512, 0.5), t.newId)?.commands);
    expect(dimensionFor('auto', t.view(), Object.keys(t.sketch().curves))?.value).toBe(4.35);
  });

  it('deletion: shared points stay, orphaned ones go; a projection without geometry can be removed', () => {
    const t = setup();
    t.run(rectangleCommands('s', t.tool(), free(5, 5), free(15, 12), t.newId));
    t.run(lineCommands('s', t.view(), free(30, 0.5), free(40, 0.5), t.newId)?.commands);
    const lone = Object.keys(t.sketch().curves)[4];
    const sideOfRectangle = Object.keys(t.sketch().curves)[0];
    t.run(deleteCommands('s', t.sketch(), t.view(), [sideOfRectangle]));
    expect([Object.keys(t.sketch().curves).length, Object.keys(t.sketch().points).length]).toEqual([4, 6]); // the corners are held by the neighbouring sides
    t.run(deleteCommands('s', t.sketch(), t.view(), [lone]));
    expect([Object.keys(t.sketch().curves).length, Object.keys(t.sketch().points).length]).toEqual([3, 4]);
    // a point shared by two sides takes both and with them the corner that was left alone
    const corner = t.view().curves.get(Object.keys(t.sketch().curves)[0])!.points[1];
    t.run(deleteCommands('s', t.sketch(), t.view(), [corner]));
    expect(Object.keys(t.sketch().curves)).toHaveLength(1);
    expect(deleteCommands('s', t.sketch(), t.view(), ['origin'])).toEqual([]);
    // a projection the recompute could not project is not in the view, but it can be deleted
    const broken: SketchFeature = { ...t.sketch(), external: { x: { type: 'edge', body: 'e', edge: { a: { feature: 'e', role: 'endCap' }, b: { feature: 'e', role: 'startCap' } }, kind: 'line' } } };
    expect(sketchView(broken, t.result()).curves.has('x')).toBe(false);
    expect(deleteCommands('s', broken, sketchView(broken, t.result()), ['x'])).toEqual([{ type: 'removeExternal', sketch: 's', id: 'x' }]);
  });

  it('a projected circle is in the view as a fixed curve with a centre', () => {
    const t = setup();
    const feature: SketchFeature = { ...t.sketch(), external: { x: { type: 'edge', body: 'e', edge: { a: { feature: 'e', role: 'endCap' }, b: { feature: 'e', role: 'side', curve: 'k' } }, kind: 'circle' } } };
    const view = sketchView(feature, { ...t.result(), points: { ...t.result().points, 'x/center': { x: 3, y: 4 } }, radii: { x: 2 }, curves: { x: { shape: { type: 'circle', center: 'x/center' }, source: 'reference', regions: false } } });
    expect(view.curves.get('x')).toEqual({ id: 'x', own: false, construction: false, points: ['x/center'], shape: { type: 'circle', center: [3, 4], radius: 2 } });
    expect(view.points.get('x/center')).toEqual({ id: 'x/center', at: [3, 4], own: false });
    expect([kindOf(view, 'x'), kindOf(view, 'x/center'), kindOf(view, 'origin'), kindOf(view, 'absent')]).toEqual(['circle', 'point', 'point', undefined]);
    const diameter: Constraint = { type: 'diameter', curve: 'x', value: 4, driving: false };
    expect(operandsOf(diameter)).toEqual(['x']);
    expect(anchorOf(diameter, view)).toEqual([expect.closeTo(3 + Math.SQRT2, 9), expect.closeTo(4 + Math.SQRT2, 9)]);
    expect(anchorOf({ type: 'distance', a: 'origin', b: 'x/center', value: 5, driving: false }, view)).toEqual([1.5, 2]);
    expect(anchorOf({ type: 'distance', a: 'origin', b: 'absent', value: 5, driving: false }, view)).toBeUndefined();
    expect(operandsOf({ type: 'pointOnCurve', point: 'p', curve: 'c' })).toEqual(['p', 'c']);
  });

  it('an extrusion draft: a missing target is not rewritten by itself', () => {
    const draft: ExtrudeFeature = { id: 'e2', name: 'e2', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'add', targets: ['deleted'] };
    expect(changeExtrude(draft, { distance: 8 }, ['e1'])).toMatchObject({ extent: { type: 'distance', start: 0, distance: 8 }, targets: ['deleted'] });
    expect(changeExtrude(draft, { target: 'e1' }, ['e1']).targets).toEqual(['e1']);
    expect(changeExtrude(draft, { sketch: 's9', regions: [] }, ['e1']).profile).toEqual({ type: 'regions', sketch: 's9', regions: [] });
    expect(changeExtrude(draft, { operation: 'new' }, ['e1'])).not.toHaveProperty('targets');
    const fresh = changeExtrude({ ...draft, operation: 'new', targets: undefined }, { operation: 'cut' }, ['e0', 'e1']);
    expect(fresh).toMatchObject({ operation: 'cut', targets: ['e1'] });
    // no body to pick: the draft stays without a target and the engine says what is missing
    expect(changeExtrude({ ...draft, targets: undefined }, {}, [])).toMatchObject({ operation: 'add' });
    expect(changeExtrude({ ...draft, targets: undefined }, {}, [])).not.toHaveProperty('targets');

    // a cut may have several targets; an addition keeps the first one
    const cut = changeExtrude(draft, { operation: 'cut', target: 'e1' }, ['e0', 'e1']);
    expect(changeExtrude(cut, { toggleTarget: 'e0' }, ['e0', 'e1']).targets).toEqual(['e1', 'e0']);
    expect(changeExtrude(changeExtrude(cut, { toggleTarget: 'e0' }, ['e0', 'e1']), { toggleTarget: 'e1' }, ['e0', 'e1']).targets).toEqual(['e0']);
    expect(changeExtrude(changeExtrude(cut, { toggleTarget: 'e0' }, ['e0', 'e1']), { operation: 'add' }, ['e0', 'e1']).targets).toEqual(['e1']);
    // unticking the last target leaves the list empty; no body is picked behind the user's back
    const none = changeExtrude(cut, { toggleTarget: 'e1' }, ['e0', 'e1']);
    expect(none.targets).toEqual([]);
    expect(changeExtrude(none, { distance: 3 }, ['e0', 'e1']).targets).toEqual([]);
    // an addition shows a select, which always displays a body: it does not stay without one
    expect(changeExtrude(none, { operation: 'add' }, ['e0', 'e1'])).toMatchObject({ operation: 'add', targets: ['e1'] });
    expect(changeExtrude(none, { operation: 'add' }, [])).not.toHaveProperty('targets');

    // the extent: through all exists only for a cut and starts on both sides
    const all = changeExtrude(cut, { extent: 'throughAll' }, ['e1']);
    expect(all.extent).toEqual({ type: 'throughAll', side: 'both' });
    expect(changeExtrude(all, { side: 'backward' }, ['e1']).extent).toEqual({ type: 'throughAll', side: 'backward' });
    expect(changeExtrude(all, { distance: 3, start: 1 }, ['e1']).extent).toEqual({ type: 'throughAll', side: 'both' }); // fields of the other variant
    expect(changeExtrude(all, { extent: 'throughAll' }, ['e1']).extent).toBe(all.extent);
    expect(changeExtrude(all, { extent: 'distance' }, ['e1']).extent).toEqual({ type: 'distance', start: 0, distance: 10 });
    expect(changeExtrude(all, { operation: 'add' }, ['e1'])).toMatchObject({ operation: 'add', extent: { type: 'distance', start: 0, distance: 10 }, targets: ['e1'] });
    expect(changeExtrude(draft, { extent: 'throughAll' }, ['e1']).extent).toEqual({ type: 'distance', start: 0, distance: 5 }); // not a cut
    expect(changeExtrude(draft, { operation: 'cut', extent: 'throughAll' }, ['e1'])).toMatchObject({ operation: 'cut', extent: { type: 'throughAll', side: 'both' } });
    expect(changeExtrude(draft, { start: 'h / 2', side: 'both' }, ['e1']).extent).toEqual({ type: 'distance', start: 'h / 2', distance: 5 });
    // the form passes the distance extent the draft had last: switching there and back keeps it
    const last = { type: 'distance' as const, start: 'h / 2', distance: 'h' };
    expect(changeExtrude(all, { extent: 'distance' }, ['e1'], last).extent).toEqual(last);
    expect(changeExtrude(all, { operation: 'add' }, ['e1'], last).extent).toEqual(last);
    // editing sends the profile whole; what a draft of regions does not have, its offset, is removed,
    // and so is a start plane the extent does not have (D66)
    expect(draftCommand(all, true, 3)).toEqual({ type: 'updateFeature', id: 'e2', patch: { profile: { ...all.profile, offset: null }, extent: { type: 'throughAll', side: 'both', from: null }, operation: 'cut', targets: ['e1'] } });

    expect(draftCommand(draft, false, 3)).toEqual({ type: 'addFeature', feature: draft, index: 3 });
    expect(draftCommand(draft, true, 3)).toEqual({ type: 'updateFeature', id: 'e2', patch: { profile: { ...draft.profile, offset: null }, extent: { ...draft.extent, taper: null, from: null }, operation: 'add', targets: ['deleted'] } });
    expect(draftCommand({ ...draft, operation: 'new', targets: undefined }, true, 3)).not.toHaveProperty('patch.targets');
    // a plane without a second plane or a tilt removes them by name (D60)
    expect(draftCommand({ id: 'r', name: 'r', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 4 }, true, 0)).toEqual({ type: 'updateFeature', id: 'r', patch: { base: { kind: 'base', plane: 'XY' }, offset: 4, midplaneWith: null, tilt: null } });
    const tilt = { axis: { kind: 'base', axis: 'X' } as const, angle: 'deg(30)' };
    expect(draftCommand({ id: 'r', name: 'r', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 4, midplaneWith: { kind: 'base', plane: 'XZ' }, tilt }, true, 0)).toEqual({
      type: 'updateFeature',
      id: 'r',
      patch: { base: { kind: 'base', plane: 'XY' }, offset: 4, midplaneWith: { kind: 'base', plane: 'XZ' }, tilt },
    });
  });

  it('an extrusion draft with a profile generator: source, operands, parameters and references', () => {
    const draft: ExtrudeFeature = { id: 'e2', name: 'e2', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' };
    // to a generator: the defaults of the catalog and the operands the form found in the sketch
    const gear = changeExtrude(draft, { source: 'involuteGear', operands: { circle: 'c1' } }, []);
    expect(gear.profile).toEqual({ type: 'generated', generator: 'involuteGear', sketch: 's', operands: { circle: 'c1' }, params: { teeth: 18, pressureAngle: (20 * Math.PI) / 180, backlash: 0, rotation: 0, internal: false } });
    expect(profileKind(gear.profile)).toBe('involuteGear');
    expect(changeExtrude(gear, { source: 'involuteGear' }, []).profile).toEqual(gear.profile); // the same source changes nothing
    // entries change one by one; an expression goes into the field as typed
    const changed = changeExtrude(gear, { params: { teeth: 'Zs', internal: true }, refs: { meshWith: 'e1' } }, []);
    expect(changed.profile).toMatchObject({ params: { teeth: 'Zs', internal: true, backlash: 0 }, operands: { circle: 'c1' }, refs: { meshWith: 'e1' } });
    expect(changeExtrude(changed, { refs: { meshWith: null } }, []).profile).not.toHaveProperty('refs');
    expect(changeExtrude(changed, { sketch: 's9', operands: { circle: 'k' } }, []).profile).toMatchObject({ sketch: 's9', operands: { circle: 'k' }, params: { teeth: 'Zs' } });
    expect(changeExtrude(changed, { regions: [{ outerLoop: ['x'] }] }, []).profile).toEqual(changed.profile); // regions belong to the other source
    // back to regions: nothing is picked
    expect(changeExtrude(changed, { source: 'regions' }, []).profile).toEqual({ type: 'regions', sketch: 's', regions: [] });
    // the form remembers the profile of each kind: regions and back returns the gear with its expressions and references
    const remembered = { regions: draft.profile, involuteGear: changed.profile };
    const toRegions = changeExtrude(changed, { source: 'regions' }, [], undefined, remembered);
    expect(toRegions.profile).toEqual(draft.profile);
    expect(changeExtrude(toRegions, { source: 'involuteGear' }, [], undefined, remembered).profile).toEqual(changed.profile);
    // in another sketch the remembered operands and regions mean nothing: the source starts fresh
    const moved = changeExtrude(toRegions, { sketch: 's9', regions: [] }, [], undefined, remembered);
    expect(changeExtrude(moved, { source: 'involuteGear', operands: { circle: 'k' } }, [], undefined, remembered).profile).toMatchObject({ sketch: 's9', operands: { circle: 'k' }, params: { teeth: 18 } });
    expect(rememberedProfile(remembered, 'involuteGear', 's')).toEqual(changed.profile);
    expect(rememberedProfile(remembered, 'involuteGear', 's9')).toBeUndefined();
    expect(rememberedProfile({}, 'regions', 's')).toBeUndefined();
    // the engine accepts the draft as a new feature and as a change of an existing one
    const { engine, run } = setup();
    run([{ type: 'addCurve', sketch: 's', id: 'c1', curve: { type: 'circle', center: 'origin', construction: true }, radius: 8.1 }, { type: 'addCurve', sketch: 's', id: 'c2', curve: { type: 'circle', center: 'origin', construction: true }, radius: 9 }]);
    run([draftCommand({ ...gear, id: 'e1' }, false, 1), draftCommand(changeExtrude(changed, { params: { teeth: 20, internal: false }, operands: { circle: 'c2' } }, []), false, 2)]);
    expect(engine.getState().document.features[2]).toMatchObject({ profile: { operands: { circle: 'c2' }, params: { teeth: 20 }, refs: { meshWith: 'e1' } } });
    // editing: a reference the draft no longer has is removed, the other entries are sent whole
    const edited = changeExtrude(engine.getState().document.features[2] as ExtrudeFeature, { refs: { meshWith: null }, params: { backlash: 0.1 } }, []);
    expect(draftCommand(edited, true, 2)).toMatchObject({ type: 'updateFeature', id: 'e2', patch: { profile: { type: 'generated', params: { backlash: 0.1, teeth: 20 }, refs: { meshWith: null } } } });
    run([draftCommand(edited, true, 2)]);
    expect(engine.getState().document.features[2]).toMatchObject({ profile: { params: { backlash: 0.1, teeth: 20 } } });
    expect((engine.getState().document.features[2] as ExtrudeFeature).profile).not.toHaveProperty('refs');
    // and a feature that never had the reference accepts the same shape of the patch
    run([draftCommand(changeExtrude(engine.getState().document.features[1] as ExtrudeFeature, { params: { teeth: 24 } }, []), true, 1)]);
    expect(engine.getState().document.features[1]).toMatchObject({ profile: { params: { teeth: 24 } } });
    // the generated profile of a new draft comes from the catalog
    expect(generatedProfile('involuteGear', 's', {}).operands).toEqual({});
  });

  it('an extrusion draft with the generators of 5d: the examples of the catalog, the optional shift of a gear (D61)', () => {
    // a new draft starts from the example of the entry and the defaults; an optional parameter is not in it
    expect(generatedProfile('cycloidalDisc', 's', { circle: 'c1' }).params).toEqual({ pins: 12, pinRadius: 2.5, eccentricity: 1, clearance: 0, rotation: 0, pinAngle: 0 });
    expect(generatedProfile('gt2Pulley', 's', { center: 'origin' }).params).toEqual({ teeth: 20, allowance: 0, rotation: 0 });
    expect(generatedProfile('involuteGear', 's', {}).params).not.toHaveProperty('shift');
    const draft: ExtrudeFeature = { id: 'e2', name: 'e2', suppressed: false, type: 'extrude', profile: generatedProfile('involuteGear', 's', { circle: 'c1' }), extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' };
    // the shift is in the draft only while it has a value: a number, an expression, and gone again
    const shifted = changeExtrude(draft, { params: { shift: 0.3 } }, []);
    expect(shifted.profile).toMatchObject({ params: { shift: 0.3, teeth: 18 } });
    expect(changeExtrude(shifted, { params: { shift: '-x' } }, []).profile).toMatchObject({ params: { shift: '-x' } });
    const plain = changeExtrude(shifted, { params: { shift: null } }, []);
    expect(plain.profile).toEqual(draft.profile);
    // editing: a shift the draft does not have is removed by name; one it has is sent
    expect(draftCommand(plain, true, 1)).toMatchObject({ patch: { profile: { params: { shift: null, teeth: 18 } } } });
    expect(draftCommand(shifted, true, 1)).toMatchObject({ patch: { profile: { params: { shift: 0.3 } } } });
    // a new feature has no null in it
    expect(draftCommand(plain, false, 1)).toEqual({ type: 'addFeature', feature: plain, index: 1 });
    // the engine accepts both, and the patch removes the shift of a gear that has one
    const { engine, run } = setup();
    run([{ type: 'addCurve', sketch: 's', id: 'c1', curve: { type: 'circle', center: 'origin', construction: true }, radius: 8.1 }]);
    run([draftCommand(shifted, false, 1)]);
    expect((engine.getState().document.features[1] as ExtrudeFeature).profile).toMatchObject({ params: { shift: 0.3 } });
    run([draftCommand(plain, true, 1)]);
    expect(((engine.getState().document.features[1] as ExtrudeFeature).profile as { params: object }).params).not.toHaveProperty('shift');
  });

  it('an extrusion draft with an offset and with a wall (D44)', () => {
    const draft: ExtrudeFeature = { id: 'e1', name: 'e1', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' };
    // the offset is in the draft only while it has a value: a number, an expression, and gone again
    const grown = changeExtrude(draft, { offset: 2 }, []);
    expect(grown.profile).toEqual({ ...draft.profile, offset: 2 });
    expect(changeExtrude(grown, { offset: '-wall' }, []).profile).toEqual({ ...draft.profile, offset: '-wall' });
    expect(changeExtrude(grown, { distance: 7 }, []).profile).toEqual(grown.profile); // another field leaves it
    expect(changeExtrude(grown, { offset: null }, []).profile).toEqual(draft.profile);
    expect(changeExtrude(grown, { offset: 0 }, []).profile).toEqual({ ...draft.profile, offset: 0 }); // a zero is a value
    expect(changeExtrude(grown, { regions: [] }, []).profile).toEqual({ type: 'regions', sketch: 's', regions: [], offset: 2 });
    // a wall: no curve yet and the thickness a new wall starts with; the curves are kept sorted
    const wall = changeExtrude(grown, { source: 'wall' }, []);
    expect(wall.profile).toEqual({ type: 'wall', sketch: 's', curves: [], thickness: WALL_THICKNESS });
    expect(profileKind(wall.profile)).toBe('wall');
    const along = changeExtrude(wall, { curves: ['n', 'm'], thickness: 'ribT' }, []);
    expect(along.profile).toEqual({ type: 'wall', sketch: 's', curves: ['m', 'n'], thickness: 'ribT' });
    expect(changeExtrude(along, { offset: 1, regions: [] }, []).profile).toEqual(along.profile); // fields of the other source
    expect(changeExtrude(along, { sketch: 's9', curves: [] }, []).profile).toEqual({ type: 'wall', sketch: 's9', curves: [], thickness: 'ribT' });
    // the form remembers each kind: regions with their offset and back to the wall
    const remembered = { regions: grown.profile, wall: along.profile };
    expect(changeExtrude(along, { source: 'regions' }, [], undefined, remembered).profile).toEqual(grown.profile);
    expect(changeExtrude(grown, { source: 'wall' }, [], undefined, remembered).profile).toEqual(along.profile);

    // the engine accepts the drafts as new features and as changes of existing ones
    const { engine, run } = setup();
    run([
      { type: 'addCurve', sketch: 's', id: 'c1', curve: { type: 'circle', center: 'origin' }, radius: 8 },
      { type: 'addPoint', sketch: 's', id: 'p1', x: 20, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'p2', x: 30, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'p3', x: 30, y: 10 },
      { type: 'addCurve', sketch: 's', id: 'm', curve: { type: 'line', a: 'p1', b: 'p2', construction: true } },
      { type: 'addCurve', sketch: 's', id: 'n', curve: { type: 'line', a: 'p2', b: 'p3', construction: true } },
    ]);
    const feature = (id: Id): ExtrudeFeature => engine.getState().document.features.find((f) => f.id === id) as ExtrudeFeature;
    run([draftCommand(grown, false, 1), draftCommand({ ...changeExtrude(along, { thickness: 2 }, []), id: 'e2', name: 'e2' }, false, 2)]);
    expect(engine.getState().evaluation.features).toMatchObject({ e1: { status: 'ok' }, e2: { status: 'ok' } });
    expect(feature('e1').profile).toEqual({ ...draft.profile, offset: 2 });
    expect(feature('e2').profile).toEqual({ type: 'wall', sketch: 's', curves: ['m', 'n'], thickness: 2 });
    // editing: an offset the draft no longer has is removed; a draft that never had one sends the same shape
    const without = changeExtrude(feature('e1'), { offset: null, distance: 6 }, []);
    expect(draftCommand(without, true, 1)).toMatchObject({ type: 'updateFeature', id: 'e1', patch: { profile: { type: 'regions', offset: null } } });
    run([draftCommand(without, true, 1)]);
    expect(feature('e1').profile).toEqual(draft.profile);
    run([draftCommand(changeExtrude(feature('e1'), { distance: 9 }, []), true, 1)]);
    expect(feature('e1')).toMatchObject({ profile: draft.profile, extent: { distance: 9 } });
    // a wall is sent whole, and regions turned into a wall replace the profile
    run([draftCommand(changeExtrude(feature('e2'), { curves: ['m'], thickness: 3 }, []), true, 2)]);
    expect(feature('e2').profile).toEqual({ type: 'wall', sketch: 's', curves: ['m'], thickness: 3 });
    run([draftCommand(changeExtrude(changeExtrude(feature('e1'), { source: 'wall' }, []), { curves: ['n'] }, []), true, 1)]);
    expect(feature('e1').profile).toEqual({ type: 'wall', sketch: 's', curves: ['n'], thickness: WALL_THICKNESS });
    run([draftCommand(changeExtrude(changeExtrude(feature('e1'), { source: 'regions' }, []), { regions: [{ outerLoop: ['c1'] }], offset: 1 }, []), true, 1)]);
    expect(feature('e1').profile).toEqual({ ...draft.profile, offset: 1 });
  });

  it('an extent up to a plane: for every operation, without a plane until one is picked, the gap optional (D47)', () => {
    const draft: ExtrudeFeature = { id: 'e1', name: 'e1', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 2, distance: 5 }, operation: 'new' };
    const fresh = changeExtrude(draft, { extent: 'upTo' }, []);
    // a new one takes the start of the distance and has no plane yet
    expect(fresh.extent).toEqual({ type: 'upTo', start: 2 });
    expect(noPlane(fresh.extent)).toBe(true);
    const XY = { kind: 'base', plane: 'XY' } as const;
    const picked = changeExtrude(fresh, { plane: XY, gap: 'g' }, []);
    expect(picked.extent).toEqual({ type: 'upTo', start: 2, plane: XY, gap: 'g' });
    expect(noPlane(picked.extent)).toBe(false);
    expect(changeExtrude(picked, { gap: null, start: 0 }, []).extent).toEqual({ type: 'upTo', start: 0, plane: XY });
    // fields of the other variants are ignored; every operation keeps it
    expect(changeExtrude(picked, { distance: 9, taper: 0.1, side: 'both' }, []).extent).toEqual(picked.extent);
    expect(changeExtrude(picked, { operation: 'cut', target: 'b' }, ['b']).extent).toEqual(picked.extent);
    expect(changeExtrude(picked, { operation: 'add', target: 'b' }, ['b']).extent).toEqual(picked.extent);
    // to a distance and back: the form passes the one it had last
    const back = changeExtrude(picked, { extent: 'distance' }, [], draft.extent);
    expect(back.extent).toEqual(draft.extent);
    expect(changeExtrude(back, { extent: 'upTo' }, [], undefined, {}, picked.extent as never).extent).toEqual(picked.extent);
    // editing: the patch removes a gap the draft no longer has; the plane is a reference, sent whole
    expect(draftCommand(changeExtrude(picked, { gap: null }, []), true, 1)).toMatchObject({ patch: { extent: { type: 'upTo', plane: XY, start: 2, gap: null } } });
  });

  it('the start plane of an extent: kept across the variants, never brought back by a remembered extent, "through all" from it one-sided (D66)', () => {
    const draft: ExtrudeFeature = { id: 'e1', name: 'e1', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'cut', targets: ['b'] };
    const TOP = { kind: 'face', body: 'b', face: { feature: 'b', role: 'endCap' } } as const;
    const XY = { kind: 'base', plane: 'XY' } as const;
    const from = changeExtrude(draft, { from: TOP }, ['b']);
    expect(from.extent).toEqual({ type: 'distance', start: 0, distance: 5, from: TOP });
    // distance → upTo → through all and back: the start plane goes along
    const upTo = changeExtrude(from, { extent: 'upTo' }, ['b']);
    expect(upTo.extent).toEqual({ type: 'upTo', start: 0, from: TOP });
    const through = changeExtrude(upTo, { extent: 'throughAll' }, ['b']);
    // from a plane, through all goes backward rather than to both sides
    expect(through.extent).toEqual({ type: 'throughAll', side: 'backward', from: TOP });
    expect(changeExtrude(through, { side: 'both' }, ['b']).extent).toEqual({ type: 'throughAll', side: 'backward', from: TOP });
    expect(changeExtrude(through, { side: 'forward' }, ['b']).extent).toEqual({ type: 'throughAll', side: 'forward', from: TOP });
    expect(changeExtrude(through, { extent: 'distance' }, ['b'], from.extent).extent).toEqual(from.extent);
    // a start plane set on "through all" to both sides makes it one-sided
    const both = changeExtrude(draft, { extent: 'throughAll' }, ['b']);
    expect(changeExtrude(both, { from: XY }, ['b']).extent).toEqual({ type: 'throughAll', side: 'backward', from: XY });
    // removed: the remembered extents bring back their numbers, not their start planes
    const removed = changeExtrude(through, { from: null }, ['b']);
    expect(removed.extent).toEqual({ type: 'throughAll', side: 'backward' });
    expect(changeExtrude(removed, { extent: 'distance' }, ['b'], from.extent).extent).toEqual(draft.extent);
    expect(changeExtrude(removed, { extent: 'upTo' }, ['b'], undefined, {}, { type: 'upTo', start: 1, plane: XY, from: TOP }).extent).toEqual({ type: 'upTo', start: 1, plane: XY });
    // another one replaces it; changes of the profile and the operation keep it
    expect(changeExtrude(from, { from: XY }, ['b']).extent).toMatchObject({ from: XY });
    expect(changeExtrude(from, { operation: 'add', target: 'b' }, ['b']).extent).toEqual(from.extent);
    expect(changeExtrude(from, { regions: [] }, ['b']).extent).toEqual(from.extent);
    // editing: the start plane is sent whole, and removed by name when the draft has none
    expect(draftCommand(from, true, 1)).toMatchObject({ patch: { extent: { type: 'distance', from: TOP } } });
    expect(draftCommand(changeExtrude(from, { from: null }, ['b']), true, 1)).toMatchObject({ patch: { extent: { type: 'distance', from: null } } });
    expect(draftCommand(through, true, 1)).toMatchObject({ patch: { extent: { type: 'throughAll', side: 'backward', from: TOP } } });
  });

  it('the taper of a distance extent: an optional field of the draft, gone with a generated profile (D45)', () => {
    const draft: ExtrudeFeature = { id: 'e1', name: 'e1', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c1'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' };
    const tapered = changeExtrude(draft, { taper: 'deg(-5)' }, []);
    expect(tapered.extent).toEqual({ type: 'distance', start: 0, distance: 5, taper: 'deg(-5)' });
    expect(changeExtrude(tapered, { distance: 7 }, []).extent).toEqual({ type: 'distance', start: 0, distance: 7, taper: 'deg(-5)' });
    expect(changeExtrude(tapered, { taper: null }, []).extent).toEqual(draft.extent);
    expect(changeExtrude(tapered, { taper: 0 }, []).extent).toEqual({ ...draft.extent, taper: 0 }); // a zero is a value
    // a generated profile has no taper: the draft drops it
    expect(changeExtrude(tapered, { source: 'involuteGear' }, []).extent).toEqual(draft.extent);
    // through all keeps the distance extent to return to, the taper with it
    const cut = changeExtrude({ ...tapered, operation: 'cut', targets: ['b'] }, { extent: 'throughAll' }, ['b']);
    expect(cut.extent).toEqual({ type: 'throughAll', side: 'both' });
    expect(changeExtrude(cut, { taper: 0.1 }, ['b']).extent).toEqual({ type: 'throughAll', side: 'both' });
    expect(changeExtrude(cut, { extent: 'distance' }, ['b'], tapered.extent).extent).toEqual(tapered.extent);
    // editing: the patch removes a taper the draft no longer has; through all replaces the extent
    expect(draftCommand(changeExtrude(tapered, { taper: null }, []), true, 1)).toMatchObject({ patch: { extent: { type: 'distance', taper: null } } });
    expect(draftCommand(cut, true, 1)).toMatchObject({ patch: { extent: { type: 'throughAll', side: 'both' } } });
    // the engine accepts both
    const { engine, run } = setup();
    run([{ type: 'addCurve', sketch: 's', id: 'c1', curve: { type: 'circle', center: 'origin' }, radius: 8 }, draftCommand(tapered, false, 1)]);
    expect(engine.getState().evaluation.features.e1.status).toBe('ok');
    run([draftCommand(changeExtrude(tapered, { taper: null }, []), true, 1)]);
    expect((engine.getState().document.features[1] as ExtrudeFeature).extent).toEqual(draft.extent);
  });

  it('a pattern draft: the source, the axis, the count and the span', () => {
    const choices: PatternChoices = { tools: ['h1', 'h2', 'h3'], bodies: ['a', 'b'], sketches: ['s', 's2'] };
    // the first source: the selected feature when it can be one, else the latest tool, else the latest body
    expect(patternSource(choices, 'h1')).toEqual({ type: 'features', features: ['h1'] });
    expect(patternSource(choices, 'a')).toEqual({ type: 'body', body: 'a' });
    expect(patternSource(choices, 's')).toEqual({ type: 'features', features: ['h3'] });
    expect(patternSource(choices)).toEqual({ type: 'features', features: ['h3'] });
    expect(patternSource({ ...choices, tools: [] })).toEqual({ type: 'body', body: 'b' });
    expect(patternSource({ tools: [], bodies: [], sketches: ['s'] })).toBeUndefined();

    const draft: PatternDraft = { id: 'n1', name: 'n1', suppressed: false, type: 'pattern', source: { type: 'features', features: ['h2'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } } };
    // toggling keeps the order of the timeline, not of the clicks
    const two = changePattern(draft, { toggleFeature: 'h1' }, choices);
    expect(two.source).toEqual({ type: 'features', features: ['h1', 'h2'] });
    expect(changePattern(two, { toggleFeature: 'h2' }, choices).source).toEqual({ type: 'features', features: ['h1'] });
    // a feature that is no longer on offer stays in the list until it is unchecked
    const stale: PatternDraft = { ...draft, source: { type: 'features', features: ['gone', 'h2'] } };
    expect(changePattern(stale, { toggleFeature: 'h3' }, choices).source).toEqual({ type: 'features', features: ['gone', 'h2', 'h3'] });
    expect(changePattern(stale, { toggleFeature: 'gone' }, choices).source).toEqual({ type: 'features', features: ['h2'] });
    // nothing picked: there is nothing to compute
    const none = changePattern(draft, { toggleFeature: 'h2' }, choices);
    expect(none.source).toEqual({ type: 'features', features: [] });
    expect([patternIncomplete(none), patternIncomplete(draft)]).toEqual([true, false]);
    // the other kind of source starts from the latest choice; the same kind changes nothing
    const body = changePattern(two, { source: 'body' }, choices);
    expect(body.source).toEqual({ type: 'body', body: 'b' });
    expect(changePattern(body, { body: 'a' }, choices).source).toEqual({ type: 'body', body: 'a' });
    expect(changePattern(body, { toggleFeature: 'h1' }, choices).source).toEqual(body.source); // features belong to the other source
    expect(changePattern(two, { source: 'features' }, choices).source).toEqual(two.source);
    expect(changePattern(body, { source: 'features' }, choices).source).toEqual({ type: 'features', features: ['h3'] });
    expect(patternIncomplete(changePattern(two, { source: 'body' }, { ...choices, bodies: [] }))).toBe(true);
    // the axis: a base axis, or the origin of the latest sketch until a sketch and a point are chosen
    expect(draft.transform.type === 'circular' && axisKind(draft.transform.axis)).toBe('Z');
    expect(changePattern(draft, { axis: 'X' }, choices).transform).toMatchObject({ axis: { kind: 'base', axis: 'X' } });
    const through = changePattern(draft, { axis: 'sketchPoint' }, choices);
    expect(through.transform).toMatchObject({ axis: { kind: 'sketchPoint', sketch: 's2', point: 'origin' } });
    expect(through.transform.type === 'circular' && axisKind(through.transform.axis)).toBe('sketchPoint');
    expect(changePattern(through, { point: 'p1' }, choices).transform).toMatchObject({ axis: { kind: 'sketchPoint', sketch: 's2', point: 'p1' } });
    expect(changePattern(changePattern(through, { point: 'p1' }, choices), { sketch: 's' }, choices).transform).toMatchObject({ axis: { kind: 'sketchPoint', sketch: 's', point: 'origin' } }); // a point of the other sketch does not carry over
    expect(changePattern(changePattern(through, { point: 'p1' }, choices), { axis: 'sketchPoint' }, choices).transform).toMatchObject({ axis: { kind: 'sketchPoint', sketch: 's2', point: 'p1' } });
    expect(changePattern(draft, { axis: 'sketchPoint' }, { ...choices, sketches: [] }).transform).toMatchObject({ axis: { kind: 'base', axis: 'Z' } }); // no sketch to go through
    expect(changePattern(draft, { point: 'p1' }, choices).transform).toMatchObject({ axis: { kind: 'base', axis: 'Z' } });
    // the axis of a round face (D60) comes only with the face picked; the kind alone changes nothing
    const pin = { body: 'b', face: { feature: 'e', role: 'side', curve: 'k' } } as const;
    expect(changePattern(draft, { axis: 'face' }, choices).transform).toMatchObject({ axis: { kind: 'base', axis: 'Z' } });
    const aroundPin = changePattern(draft, { face: pin }, choices);
    expect(aroundPin.transform).toMatchObject({ axis: { kind: 'face', ...pin } });
    expect(aroundPin.transform.type === 'circular' && axisKind(aroundPin.transform.axis)).toBe('face');
    expect(changePattern(aroundPin, { axis: 'Y' }, choices).transform).toMatchObject({ axis: { kind: 'base', axis: 'Y' } });
    expect(changePattern(aroundPin, { sketch: 's', point: 'p1', line: 'l' }, choices).transform).toMatchObject({ axis: { kind: 'face', ...pin } });
    // the count and the span; the angle the draft had last comes back
    expect(changePattern(draft, { count: 'n' }, choices).transform).toMatchObject({ count: 'n' });
    const angled = changePattern(draft, { span: 'angle' }, choices);
    expect(angled.transform).toMatchObject({ span: { type: 'angle', angle: Math.PI / 2 } });
    const typed = changePattern(angled, { angle: 'deg(120)' }, choices);
    expect(typed.transform).toMatchObject({ span: { type: 'angle', angle: 'deg(120)' } });
    expect(changePattern(typed, { span: 'full' }, choices).transform).toMatchObject({ span: { type: 'full' } });
    expect(changePattern(changePattern(typed, { span: 'full' }, choices), { span: 'angle' }, choices, rememberPattern({}, typed)).transform).toMatchObject({ span: { type: 'angle', angle: 'deg(120)' } });
    expect(changePattern(draft, { angle: 1 }, choices).transform).toMatchObject({ span: { type: 'full' } }); // the full circle has no angle

    // the kinds (D53): a new transform of another kind, the one the draft had there before, its fields
    const row = changePattern(typed, { kind: 'linear' }, choices);
    expect(row.transform).toEqual({ type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 10 } });
    expect(changePattern(row, { axis: 'sketchPoint' }, choices).transform).toMatchObject({ direction: { kind: 'sketchPoint', sketch: 's2', point: 'origin' } });
    const spaced = changePattern(row, { spacing: 'pitch', count: 5 }, choices);
    expect(spaced.transform).toMatchObject({ count: 5, span: { type: 'spacing', spacing: 'pitch' } });
    const long = changePattern(spaced, { span: 'length' }, choices);
    expect(long.transform).toMatchObject({ span: { type: 'length', length: 20 } });
    expect(changePattern(long, { length: 40, spacing: 1, angle: 1 }, choices).transform).toMatchObject({ span: { type: 'length', length: 40 } }); // only the field of the span it has
    expect(changePattern(long, { span: 'spacing' }, choices, rememberPattern({}, spaced)).transform).toMatchObject({ span: { type: 'spacing', spacing: 'pitch' } });
    expect(changePattern(row, { span: 'angle' }, choices).transform).toEqual(row.transform); // a span of another kind
    const mirror = changePattern(row, { kind: 'mirror' }, choices);
    expect(mirror.transform).toEqual({ type: 'mirror', plane: { kind: 'base', plane: 'YZ' } });
    expect(changePattern(mirror, { count: 3, axis: 'X', span: 'full' }, choices).transform).toEqual(mirror.transform); // a mirror has none of them
    expect(changePattern(mirror, { plane: { kind: 'plane', feature: 'mid' } }, choices).transform).toEqual({ type: 'mirror', plane: { kind: 'plane', feature: 'mid' } });
    // back to a kind: the transform it had, kept by the memory of the form
    const memory = rememberPattern(rememberPattern({}, typed), spaced);
    expect(changePattern(mirror, { kind: 'circular' }, choices, memory).transform).toEqual(typed.transform);
    expect(changePattern(mirror, { kind: 'linear' }, choices, memory).transform).toEqual(spaced.transform);
    expect(changePattern(mirror, { kind: 'circular' }, choices).transform).toEqual({ type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } });

    // the engine accepts the draft as a new feature and as a change of an existing one
    const { engine, run } = setup();
    const extrude = (id: Id, curve: Id, operation: 'new' | 'cut'): Command => ({
      type: 'addFeature',
      feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: [curve] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation, ...(operation === 'cut' ? { targets: ['a'] } : {}) },
    });
    run([
      { type: 'addPoint', sketch: 's', id: 'p1', x: 12, y: 0 },
      { type: 'addCurve', sketch: 's', id: 'c1', curve: { type: 'circle', center: 'origin' }, radius: 20 },
      { type: 'addCurve', sketch: 's', id: 'c2', curve: { type: 'circle', center: 'p1' }, radius: 2 },
      extrude('a', 'c1', 'new'),
      extrude('h1', 'c2', 'cut'),
    ]);
    const real: PatternChoices = { tools: ['h1'], bodies: ['a'], sketches: ['s'] };
    const first: PatternDraft = { ...draft, source: patternSource(real) as PatternDraft['source'] };
    run([draftCommand(first, false, 3)]);
    expect(engine.getState().document.features[3]).toEqual(first);
    expect(engine.getState().evaluation.features.n1.status).toBe('ok');
    // editing sends the whole source and transform; another variant of either replaces the old one
    const edited = changePattern(changePattern(changePattern(first, { source: 'body' }, real), { axis: 'sketchPoint' }, real), { span: 'angle', count: 3 }, real);
    expect(draftCommand(edited, true, 3)).toEqual({ type: 'updateFeature', id: 'n1', patch: { source: { type: 'body', body: 'a' }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 's', point: 'origin' }, count: 3, span: { type: 'angle', angle: Math.PI / 2 } } } });
    run([draftCommand(edited, true, 3)]);
    expect(engine.getState().document.features[3]).toEqual(edited);
    expect(engine.getState().evaluation.features.n1.bodies).toEqual(['n1/1', 'n1/2']);
    run([draftCommand(changePattern(edited, { source: 'features', span: 'full' }, real), true, 3)]);
    expect(engine.getState().document.features[3]).toMatchObject({ source: { type: 'features', features: ['h1'] }, transform: { span: { type: 'full' } } });
    expect(engine.getState().evaluation.features.n1.bodies).toEqual([]);
    // another kind replaces the transform and its expressions: a row of the body, then its mirror image
    const bodyRow = changePattern(changePattern(edited, { kind: 'linear' }, real), { count: 3, spacing: 50 }, real);
    run([draftCommand(bodyRow, true, 3)]);
    expect(engine.getState().document.features[3]).toEqual(bodyRow);
    expect(engine.getState().evaluation.features.n1.bodies).toEqual(['n1/1', 'n1/2']);
    const bodyMirror = changePattern(bodyRow, { kind: 'mirror', plane: { kind: 'base', plane: 'XZ' } }, real);
    run([draftCommand(bodyMirror, true, 3)]);
    expect(engine.getState().document.features[3]).toEqual(bodyMirror);
    expect(engine.getState().evaluation.features.n1).toMatchObject({ status: 'ok', bodies: ['n1/1'] });
  });

  it('a grid (D53): the checkbox, the second direction and what the form remembers of it', () => {
    const choices: PatternChoices = { tools: ['h1'], bodies: ['a'], sketches: ['s', 's2'] };
    const row: PatternDraft = { id: 'n1', name: 'n1', suppressed: false, type: 'pattern', source: { type: 'features', features: ['h1'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 10 } } };
    // the form remembers before every change, as `set` does
    let memory: PatternMemory = {};
    const step = (draft: PatternDraft, change: PatternChange): PatternDraft => {
      memory = rememberPattern(memory, draft);
      return changePattern(draft, change, choices, memory);
    };
    // ticked: a new second direction along Y (X when the first is Y), a count of 2, a spacing of 10
    const gridded = step(row, { grid: true });
    expect(gridded.transform).toEqual({ ...row.transform, second: { direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 10 } } });
    expect(changePattern(changePattern(row, { axis: 'Y' }, choices), { grid: true }, choices).transform).toMatchObject({ second: { direction: { kind: 'base', axis: 'X' } } });
    // the changes of the second direction leave the first alone, and back
    let g = step(gridded, { second: { axis: 'sketchPoint' } });
    expect(g.transform).toMatchObject({ direction: { kind: 'base', axis: 'X' }, second: { direction: { kind: 'sketchPoint', sketch: 's2', point: 'origin' } } });
    g = step(g, { second: { sketch: 's', count: 'rows', spacing: 'pitch' } });
    expect(g.transform).toMatchObject({ count: 3, span: { spacing: 10 }, second: { direction: { kind: 'sketchPoint', sketch: 's' }, count: 'rows', span: { type: 'spacing', spacing: 'pitch' } } });
    g = step(g, { count: 4, spacing: 7 });
    expect(g.transform).toMatchObject({ count: 4, span: { spacing: 7 }, second: { count: 'rows', span: { spacing: 'pitch' } } });
    // the spans of the second direction come back from slots of their own, not from those of the first
    g = step(g, { span: 'length' });
    g = step(g, { length: 30 });
    g = step(g, { second: { span: 'length' } });
    expect(g.transform).toMatchObject({ span: { type: 'length', length: 30 }, second: { span: { type: 'length', length: 20 } } });
    g = step(g, { second: { length: 'L' } });
    g = step(g, { second: { span: 'spacing' } });
    expect(g.transform).toMatchObject({ second: { span: { type: 'spacing', spacing: 'pitch' } } });
    g = step(g, { span: 'spacing' });
    expect(g.transform).toMatchObject({ span: { type: 'spacing', spacing: 7 } });
    g = step(g, { second: { span: 'length' } });
    expect(g.transform).toMatchObject({ second: { span: { type: 'length', length: 'L' } } });
    const kept = g.transform.type === 'linear' ? g.transform.second : undefined;
    // the checkbox cleared, the first direction changed, the checkbox ticked again: the second direction comes back
    let r = step(g, { grid: false });
    expect(r.transform).not.toHaveProperty('second');
    r = step(r, { axis: 'Z', count: 2 });
    expect(memory.second).toEqual(kept);
    expect(step(r, { grid: true }).transform).toMatchObject({ direction: { kind: 'base', axis: 'Z' }, count: 2, second: kept });
    // a mirror and back: the grid with it
    const mirrored = step(g, { kind: 'mirror' });
    expect(step(mirrored, { kind: 'linear' }).transform).toEqual(g.transform);
    // another kind has no second direction
    expect(changePattern(mirrored, { grid: true, second: { count: 3 } }, choices).transform).toEqual(mirrored.transform);
    // without a tick, a change of the second direction does nothing
    expect(changePattern(row, { second: { count: 3 } }, choices).transform).toEqual(row.transform);
  });

  it('a point inside a loop', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect([insideLoop(square, [5, 5]), insideLoop(square, [15, 5]), insideLoop(square, [5, -1]), insideLoop(new Float64Array(square), [9.9, 0.1])]).toEqual([true, false, false, true]);
  });
});
