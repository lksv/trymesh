// Splines in a sketch (D70) against the real adapters: the validator and the commands, the solver
// and the analysis, the side face and its edges, the refusals of what reads an exact outline, and
// the places of 6e (trim, extend, split, the query of the contacts), 6c (mirror and pattern) and 6b
// (projection from a sketch). docs/d36/6d-sketch-spline/design.md, "Tests the implementation owes".
import { describe, expect, it } from 'vitest';
import { type Command, type CutIds, type Engine, type EngineState, type Id, type SketchFeature, type SketchResult, type SketchToolInputs, curveUnder, freshIds, sketchTool, splinePolyline } from '@trymesh/engine';
import { occupies } from '../../engine/src/references/derive';
import { XY, addExtrude, addSketch, constrain, newEngine, run } from './kit';

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const refusal = (engine: Engine, command: Command): string => {
  const result = engine.preview(command);
  return result.ok ? 'accepted' : result.error.message;
};
const point = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction: true } : {}) } });
const circle = (sketch: Id, id: Id, center: Id, radius: number): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'circle', center }, radius });
const spline = (sketch: Id, id: Id, points: Id[], construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'spline', points, ...(construction ? { construction: true } : {}) } });
const contextOf = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), document: state.document, features: state.evaluation.features });
function tool<K extends keyof SketchToolInputs>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix = 't_') {
  const state = engine.getState();
  return sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, prefix));
}
function apply<K extends keyof SketchToolInputs>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix = 't_'): { state: EngineState; ids: CutIds } {
  const made = tool(engine, name, sketch, input, prefix);
  if (!made.ok) throw new Error(made.message);
  return { state: run(engine, ...made.commands), ids: made.ids as CutIds };
}

// A rectangle 40 × 20 whose right side is a spline of three points bulging out to x = 45.
function bulge(engine: Engine): EngineState {
  run(engine, addSketch('S', XY));
  return run(
    engine,
    point('S', 'p1', 0, 0),
    point('S', 'p2', 40, 0),
    point('S', 'm', 50, 10),
    point('S', 'p3', 40, 20),
    point('S', 'p4', 0, 20),
    line('S', 'l1', 'p1', 'p2'),
    spline('S', 'sp', ['p2', 'm', 'p3']),
    line('S', 'l3', 'p3', 'p4'),
    line('S', 'l4', 'p4', 'p1'),
  );
}
// the area of the bulge by hand: a quadratic Bezier over (40, 0), (50, 10), (40, 20) takes 2/3 of
// the triangle of its control points beyond the chord
const BULGE = 800 + (2 / 3) * 100;

describe('a spline in the document (D70)', () => {
  it('the validator refuses a spline of 2 or 65 points, a point listed twice, a short closed one, a point that is not own, a radius', () => {
    const engine = newEngine();
    bulge(engine);
    expect(refusal(engine, spline('S', 'x', ['p1', 'p2']))).toMatch(/a spline has 3 to 64 control points, not 2/);
    expect(refusal(engine, spline('S', 'x', Array.from({ length: 65 }, () => 'p1')))).toMatch(/not 65/);
    expect(refusal(engine, spline('S', 'x', ['p1', 'p2', 'p1', 'p3']))).toMatch(/"p1" is listed twice; only the first point may come again, as the last/);
    expect(refusal(engine, spline('S', 'x', ['p1', 'p2', 'p1']))).toMatch(/a closed spline needs at least three different points/);
    expect(refusal(engine, spline('S', 'x', ['p1', 'p2', 'nope']))).toMatch(/points\[2\]: "nope" není vlastní bod skici ani počátek/);
    expect(refusal(engine, { type: 'addCurve', sketch: 'S', id: 'x', curve: { type: 'spline', points: ['p1', 'p2', 'p3'] }, radius: 3 })).toMatch(/poloměr se zadává jen u kružnice/);
    expect(refusal(engine, spline('S', 'x', ['origin', 'p2', 'p3', 'origin']))).toBe('accepted');
  });

  it('no constraint takes a spline; setCurvePoint refuses it by its own text', () => {
    const engine = newEngine();
    bulge(engine);
    expect(refusal(engine, constrain('S', 'k', { type: 'pointOnCurve', point: 'p4', curve: 'sp' }))).toMatch(/"sp" je spline, čeká se line nebo circle nebo arc/);
    expect(refusal(engine, constrain('S', 'k', { type: 'tangent', a: 'sp', b: 'l1' }))).toMatch(/"sp" je spline/);
    expect(refusal(engine, constrain('S', 'k', { type: 'radius', curve: 'sp', value: 5, driving: true }))).toMatch(/"sp" je spline/);
    expect(refusal(engine, { type: 'setCurvePoint', sketch: 'S', id: 'sp', point: 'a', to: 'p4' })).toBe('setCurvePoint.id: "sp" is a spline, which has no named points; to change its control points, remove it and add it again under its ID in one batch');
  });

  it('removing a control point removes the spline; a replacement in a batch keeps the region and its body', () => {
    const engine = newEngine();
    bulge(engine);
    const extruded = run(engine, addExtrude('E', 'S', [['l1', 'l3', 'l4', 'sp']], 5));
    expect(extruded.evaluation.features.E.status).toBe('ok');
    const without = engine.preview({ type: 'removeEntity', sketch: 'S', id: 'm' });
    expect(without.ok && sketchOf(without.state, 'S').curves.sp).toBeUndefined();
    const replaced = run(engine, { type: 'batch', commands: [point('S', 'm2', 46, 14), { type: 'removeEntity', sketch: 'S', id: 'sp' }, spline('S', 'sp', ['p2', 'm', 'm2', 'p3'])] });
    expect(replaced.evaluation.features.E.status).toBe('ok');
    expect(resultOf(replaced, 'S').regions.map((r) => r.ref.outerLoop)).toEqual([['l1', 'l3', 'l4', 'sp']]);
  });

  it('the solver sees only the points: free control points count two each; a spline moves nothing', () => {
    const engine = newEngine();
    const state = bulge(engine);
    expect(resultOf(state, 'S').degreesOfFreedom).toBe(10); // five free points
    expect(resultOf(state, 'S').points.m).toEqual({ x: 50, y: 10 });
    const diagnosis = engine.diagnoseSketch('S');
    expect(diagnosis.degreesOfFreedom).toBe(10);
  });

  it('a tangent join to an arc: a construction leg over the end leg, tangent to the arc, is solved and the profile is one region', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY));
    const state = run(
      engine,
      point('S', 'q', 0, 0),
      point('S', 's', 10, 0),
      point('S', 'e', 0, 10),
      point('S', 'c1', -5, 11),
      point('S', 'c2', -12, 5),
      point('S', 'c3', -12, 0),
      { type: 'addCurve', sketch: 'S', id: 'a', curve: { type: 'arc', center: 'q', start: 's', end: 'e' } },
      spline('S', 'sp', ['e', 'c1', 'c2', 'c3']),
      line('S', 'l', 'c3', 's'),
      line('S', 'leg', 'e', 'c1', true),
      constrain('S', 't', { type: 'tangent', a: 'leg', b: 'a' }),
    );
    const result = resultOf(state, 'S');
    // the leg is tangent to the circle at the end of the arc: square to the radius there
    const [q, e, c1] = [result.points.q, result.points.e, result.points.c1];
    expect(((c1.x - e.x) * (e.x - q.x) + (c1.y - e.y) * (e.y - q.y)) / Math.hypot(c1.x - e.x, c1.y - e.y) / Math.hypot(e.x - q.x, e.y - q.y)).toBeCloseTo(0, 6);
    expect(c1.x).toBeLessThan(e.x);
    expect(result.valid).toBe(true);
    expect(result.regions.map((r) => r.ref.outerLoop)).toEqual([['a', 'l', 'sp']]);
  });

  it('a second control point held on a line keeps the side it starts on (measured I)', () => {
    for (const [x, smooth] of [
      [26, true],
      [12, false],
    ] as const) {
      const engine = newEngine();
      run(engine, addSketch('S', XY));
      const state = run(
        engine,
        point('S', 'b', 20, 0),
        point('S', 'c', x, 0.3),
        point('S', 'd', 30, 15),
        point('S', 'e', 0, 15),
        line('S', 'l', 'origin', 'b'),
        spline('S', 'sp', ['b', 'c', 'd', 'e']),
        line('S', 'm', 'e', 'origin'),
        constrain('S', 'h', { type: 'horizontal', line: 'l' }),
        constrain('S', 'k', { type: 'pointOnCurve', point: 'c', curve: 'l' }),
        addExtrude('E', 'S', [['l', 'm', 'sp']], 2),
      );
      const c = resultOf(state, 'S').points.c;
      expect(c.y).toBeCloseTo(0, 9);
      expect(c.x > resultOf(state, 'S').points.b.x).toBe(smooth);
      expect(resultOf(state, 'S').valid).toBe(true);
      expect(state.evaluation.features.E.status).toBe('ok');
    }
  });
});

describe('the side face of a spline and what reads an exact outline (D70)', () => {
  it('is one swept face along the extrusion; its four edges are of the kind other; a projection and a chamfer of one are refused', () => {
    const engine = newEngine();
    bulge(engine);
    const state = run(engine, addExtrude('E', 'S', [['l1', 'l3', 'l4', 'sp']], 5));
    expect(Math.abs(state.evaluation.bodies.E.volume - BULGE * 5)).toBeLessThan(1); // the polyline within the chord tolerance
    const faces = state.evaluation.bodies.E.faces.filter((f) => state.evaluation.faceNames[f.id].role === 'side' && (state.evaluation.faceNames[f.id] as { curve: Id }).curve === 'sp');
    expect(faces).toHaveLength(1);
    const surface = state.evaluation.faceSurfaces[faces[0].id];
    expect(surface.kind).toBe('swept');
    const side = { feature: 'E', role: 'side', curve: 'sp' } as const;
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    const edges = state.evaluation.bodies.E.edges.filter((e) => same(e.name.a, side) || same(e.name.b, side));
    expect(edges).toHaveLength(4);
    expect(edges.every((e) => e.kind === 'other')).toBe(true);
    const top = edges.find((e) => same(e.name.a, { feature: 'E', role: 'endCap' }) || same(e.name.b, { feature: 'E', role: 'endCap' }));
    const chamfer = engine.preview({ type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'E', edges: [top?.name as never], distance: 0.5 } });
    expect(chamfer.ok && chamfer.state.evaluation.features.ch.error?.code).toBe('unsupportedEdge');
    // the edge of a line that meets the spline at a corner ends at the spline face (measured K)
    const ends = engine.preview({ type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'E', edges: [{ a: { feature: 'E', role: 'endCap' }, b: { feature: 'E', role: 'side', curve: 'l1' } }], distance: 0.5 } });
    expect(ends.ok && ends.state.evaluation.features.ch.error?.code).toBe('unsupportedEdge');
    const away = engine.preview({ type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'E', edges: [{ a: { feature: 'E', role: 'endCap' }, b: { feature: 'E', role: 'side', curve: 'l4' } }], distance: 0.5 } });
    expect(away.ok && away.state.evaluation.features.ch.status).toBe('ok');
    // a sketch cannot stand on the face
    const on = engine.preview(addSketch('T', { kind: 'face', body: 'E', face: side }));
    expect(on.ok && on.state.evaluation.features.T.error?.code).toBe('nonPlanarFace');
  });

  it('the offset, the taper and the revolve refuse a profile with a spline, naming it; the wall refuses it at the command', () => {
    const engine = newEngine();
    bulge(engine);
    const regions = [{ outerLoop: ['l1', 'l3', 'l4', 'sp'] }];
    const offset = engine.preview({ type: 'addFeature', feature: { id: 'O', name: 'O', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions, offset: 1 }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } });
    const error = offset.ok ? offset.state.evaluation.features.O.error : undefined;
    expect(error?.code).toBe('invalidProfile');
    expect(error?.refs).toEqual(['sp']);
    expect(error?.message).toMatch(/The curve "sp" is a spline, which has no exact form/);
    const taper = engine.preview({ type: 'addFeature', feature: { id: 'O', name: 'O', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions }, extent: { type: 'distance', start: 0, distance: 2, taper: 0.1 }, operation: 'new' } as never });
    expect(taper.ok && taper.state.evaluation.features.O.error?.code).toBe('invalidProfile');
    expect(taper.ok && taper.state.evaluation.features.O.error?.refs).toEqual(['sp']);
    const revolve = engine.preview({ type: 'addFeature', feature: { id: 'R', name: 'R', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'S', regions }, axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' } as never });
    expect(revolve.ok && revolve.state.evaluation.features.R.error?.code).toBe('invalidProfile');
    expect(revolve.ok && revolve.state.evaluation.features.R.error?.refs).toEqual(['sp']);
    expect(refusal(engine, { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'S', curves: ['sp'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'new' } as never })).toMatch(/sp/);
  });

  it('a region away from the splines of its sketch is offset and revolved; a wall whose line becomes a spline in a batch is refused in the recompute', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY));
    run(
      engine,
      point('S', 'p1', 10, 0),
      point('S', 'p2', 20, 0),
      point('S', 'p3', 20, 10),
      point('S', 'p4', 10, 10),
      line('S', 'l1', 'p1', 'p2'),
      line('S', 'l2', 'p2', 'p3'),
      line('S', 'l3', 'p3', 'p4'),
      line('S', 'l4', 'p4', 'p1'),
      point('S', 's1', 30, 0),
      point('S', 's2', 40, 0),
      point('S', 's3', 40, 10),
      point('S', 's4', 30, 10),
      spline('S', 'sp', ['s1', 's2', 's3', 's4', 's1']),
    );
    const regions = [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }];
    const offset = engine.preview({ type: 'addFeature', feature: { id: 'O', name: 'O', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions, offset: 1 }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } });
    expect(offset.ok && offset.state.evaluation.features.O.status).toBe('ok');
    // the square 10 × 10 grown by 1 (sharp corners), 2 high
    expect(offset.ok && offset.state.evaluation.bodies.O.volume).toBeCloseTo(12 * 12 * 2, 3);
    const revolve = engine.preview({ type: 'addFeature', feature: { id: 'R', name: 'R', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'S', regions }, axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' } as never });
    expect(revolve.ok && revolve.state.evaluation.features.R.status).toBe('ok');
    run(engine, { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'S', curves: ['l1'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'new' } as never });
    const state = run(engine, { type: 'batch', commands: [{ type: 'removeEntity', sketch: 'S', id: 'l1' }, point('S', 'q', 15, -3), spline('S', 'l1', ['p1', 'q', 'p2'])] });
    const error = state.evaluation.features.W.error;
    expect(error?.code).toBe('invalidProfile');
    expect(error?.message).toBe('The curve "l1" is a spline; a wall runs along lines, arcs and circles.');
    expect(error?.refs).toEqual(['l1']);
  });

  it('a plate whose hole is a closed spline is not offset either: the refusal names the spline of the hole', () => {
    const engine = newEngine();
    run(engine, addSketch('P', XY));
    run(
      engine,
      ...[
        ['r1', 0, -10],
        ['r2', 40, -10],
        ['r3', 40, 30],
        ['r4', 0, 30],
        ['b1', 10, 0],
        ['b2', 30, 0],
        ['b3', 30, 20],
        ['b4', 10, 20],
      ].map(([id, x, y]) => point('P', id as Id, x as number, y as number)),
      line('P', 'pa', 'r1', 'r2'),
      line('P', 'pb', 'r2', 'r3'),
      line('P', 'pc', 'r3', 'r4'),
      line('P', 'pd', 'r4', 'r1'),
      spline('P', 's', ['b1', 'b2', 'b3', 'b4', 'b1']),
    );
    const state = run(engine, addExtrude('E', 'P', [['pa', 'pb', 'pc', 'pd']], 2));
    expect(state.evaluation.bodies.E.volume).toBeCloseTo((1600 - 239.8216) * 2, 2);
    const offset = engine.preview({ type: 'addFeature', feature: { id: 'O', name: 'O', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'P', regions: [{ outerLoop: ['pa', 'pb', 'pc', 'pd'] }], offset: 1 }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } });
    expect(offset.ok && offset.state.evaluation.features.O.error?.refs).toEqual(['s']);
  });
});

describe('6e beside a spline (D70)', () => {
  const contacts = (engine: Engine, sketch: Id) => {
    const answer = engine.query('sketchContacts', { sketch });
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.result;
  };

  it('every tool refuses a spline by name, as the curve and as `with`; a place on it without `curve` is refused naming it', () => {
    const engine = newEngine();
    bulge(engine);
    run(engine, point('S', 'x1', 30, -5), point('S', 'x2', 30, 25), line('S', 'x', 'x1', 'x2'));
    for (const name of ['trim', 'split'] as const) {
      const made = tool(engine, name, 'S', { curve: 'sp', at: [45, 10] } as never);
      expect(!made.ok && made.message).toMatch(/"sp" is a spline; a spline is not trimmed, split or extended/);
    }
    const extend = tool(engine, 'extend', 'S', { curve: 'sp', end: 'a' } as never);
    expect(extend.ok).toBe(false);
    const withSpline = tool(engine, 'trim', 'S', { curve: 'x', at: [30, 22], with: 'sp' });
    expect(!withSpline.ok && withSpline.message).toMatch(/"sp" is a spline/);
    const place = tool(engine, 'trim', 'S', { at: [45, 10] });
    expect(!place.ok && place.message).toMatch(/"sp" is a spline/);
  });

  it('the query: a curve across a spline is a crossing that no cut repairs; a self-crossing spline, a spline of no length', () => {
    const engine = newEngine();
    bulge(engine);
    run(engine, point('S', 'y1', 30, 10), point('S', 'y2', 60, 10), line('S', 'y', 'y1', 'y2'));
    const found = contacts(engine, 'S');
    expect(found.valid).toBe(false);
    const withSpline = found.contacts.find((c) => c.curves.includes('sp'));
    expect(withSpline?.kind).toBe('crossing');
    expect(withSpline?.fix).toBe('none');
    expect(withSpline?.why).toMatch(/"sp" is a spline, which is not cut and holds no point/);
    // an end of the other curve on the spline is `end`: on its polyline (a point of it), since the
    // polyline lies inside the curve (an end on the curve itself is a crossing of a piece)
    const polyline = splinePolyline(
      [
        [40, 0],
        [50, 10],
        [40, 20],
      ],
      0.01,
    );
    const onIt = polyline[Math.floor(polyline.length / 2) - 1];
    run(engine, { type: 'removeEntity', sketch: 'S', id: 'y' }, point('S', 'y3', onIt[0], onIt[1]), point('S', 'y4', 30, onIt[1]), line('S', 'y', 'y4', 'y3'));
    const ended = contacts(engine, 'S').contacts.find((c) => c.curves.includes('sp'));
    expect(ended?.kind).toBe('end');
    expect(ended?.fix).toBe('none');
    expect(ended?.at[0]).toBeCloseTo(onIt[0], 6);
    expect(ended?.at[1]).toBeCloseTo(onIt[1], 6);
    const knot = newEngine();
    run(knot, addSketch('K', XY));
    run(knot, point('K', 'n1', 0, 0), point('K', 'n2', 30, 0), point('K', 'n3', 30, 20), point('K', 'n4', 10, 20), point('K', 'n5', 10, -10), spline('K', 'k', ['n1', 'n2', 'n3', 'n4', 'n5']));
    const self = contacts(knot, 'K');
    expect(self.valid).toBe(false);
    expect(self.total).toBe(1);
    expect(self.contacts[0].curves).toEqual(['k', 'k']);
    expect(self.contacts[0].kind).toBe('crossing');
    expect(self.contacts[0].fix).toBe('none');
    expect(self.reason).toMatch(/the spline "k" crosses or touches itself/);
    const flat = newEngine();
    run(flat, addSketch('F', XY));
    run(flat, point('F', 'a', 0, 0), point('F', 'b', 0, 0), point('F', 'c', 0, 0), spline('F', 'f', ['a', 'b', 'c']));
    expect(contacts(flat, 'F').degenerate).toEqual(['f']);
  });

  it('a straight spline along a line lies on it', () => {
    const engine = newEngine();
    run(engine, addSketch('L', XY));
    run(engine, point('L', 'a', 0, 0), point('L', 'b', 10, 0), point('L', 'c', 20, 0), point('L', 'd', 5, 0), point('L', 'e', 15, 0), spline('L', 's', ['a', 'b', 'c']), line('L', 'l', 'd', 'e'));
    const found = contacts(engine, 'L');
    expect(found.lying).toEqual([['l', 's']]);
  });

  it('two ends at one place, one a spline\'s: split joins them without re-pointing the spline (the other curve, or a coincident)', () => {
    for (const dimensioned of [false, true]) {
      const engine = newEngine();
      run(engine, addSketch('U', XY));
      run(engine, point('U', 'ua', 0, 0), point('U', 'ub', 20, 0), point('U', 'uc', 10, 12), point('U', 'ud', 0, 0), spline('U', 'us', ['ub', 'uc', 'ua']), line('U', 'ul', 'ud', 'ub'));
      if (dimensioned) run(engine, constrain('U', 'ux', { type: 'horizontalDistance', a: 'ud', b: 'ub', value: 20, driving: true }));
      const found = contacts(engine, 'U');
      expect(found.contacts.map((c) => [c.kind, c.fix])).toEqual([['ends', 'join']]);
      const made = tool(engine, 'split', 'U', {});
      if (!made.ok) throw new Error(made.message);
      const repointed = made.commands.flatMap((c) => (c.type === 'setCurvePoint' ? [c.id] : []));
      const joined = made.commands.some((c) => c.type === 'addConstraint' && c.constraint.type === 'coincident');
      expect(repointed).toEqual(dimensioned ? [] : ['ul']);
      expect(joined).toBe(dimensioned);
      const state = run(engine, ...made.commands);
      expect(resultOf(state, 'U').valid).toBe(true);
      expect(resultOf(state, 'U').regions.map((r) => r.ref.outerLoop)).toEqual([['ul', 'us']]);
    }
  });

  it('two splines whose ends meet at two places: split joins both by a coincident and re-points neither', () => {
    const engine = newEngine();
    run(engine, addSketch('U', XY));
    run(engine, point('U', 'a', 0, 0), point('U', 'b', 10, 10), point('U', 'c', 20, 0), point('U', 'd', 20, 0), point('U', 'f', 10, -10), point('U', 'g', 0, 0), spline('U', 's1', ['a', 'b', 'c']), spline('U', 's2', ['d', 'f', 'g']));
    const found = contacts(engine, 'U');
    expect(found.contacts.map((c) => [c.kind, c.fix, c.curves])).toEqual([
      ['ends', 'join', ['s1', 's2']],
      ['ends', 'join', ['s1', 's2']],
    ]);
    const made = tool(engine, 'split', 'U', {});
    if (!made.ok) throw new Error(made.message);
    expect(made.commands.some((c) => c.type === 'setCurvePoint')).toBe(false);
    const joined = made.commands.flatMap((c) => (c.type === 'addConstraint' && c.constraint.type === 'coincident' ? [[c.constraint.a, c.constraint.b].sort().join('=')] : []));
    expect(joined.sort()).toEqual(['a=g', 'c=d']);
    const state = run(engine, ...made.commands);
    expect(resultOf(state, 'U').valid).toBe(true);
    expect(resultOf(state, 'U').regions.map((r) => r.ref.outerLoop)).toEqual([['s1', 's2']]);
  });

  it('curveUnder answers with the spline for a place on it, and with the line for a place on a line', () => {
    const engine = newEngine();
    const state = bulge(engine);
    expect(curveUnder(contextOf(state, 'S'), [44.9, 10])).toBe('sp');
    expect(curveUnder(contextOf(state, 'S'), [20, 0.01])).toBe('l1');
  });

  it('a construction leg to an inner control point that nothing else names, trimmed away: the point and the spline stay', () => {
    const engine = newEngine();
    run(engine, addSketch('G', XY));
    run(engine, point('G', 'e0', 0, 70), point('G', 'e1', 0.2, 76), point('G', 'e2', 8, 80), point('G', 'e3', 14, 74), spline('G', 'es', ['e0', 'e1', 'e2', 'e3']), line('G', 'el', 'e0', 'e1', true));
    run(engine, constrain('G', 'ev', { type: 'vertical', line: 'el' }));
    const { state, ids } = apply(engine, 'trim', 'G', { curve: 'el', at: [0, 73] });
    expect(ids.removed).toContain('el');
    expect(ids.removed).not.toContain('e1');
    expect(sketchOf(state, 'G').points.e1).toBeDefined();
    expect(sketchOf(state, 'G').curves.es).toBeDefined();
  });

  it('a line across a spline side, trimmed back: the body is followed, not dropped (the spline is cut in memory alone)', () => {
    const engine = newEngine();
    run(engine, addSketch('C', XY));
    run(engine, point('C', 'ka', 0, 0), point('C', 'kb', 20, 0), point('C', 'kc', 20, 20), point('C', 'kd', 0, 20), point('C', 'w1', -4, 14), point('C', 'w2', -4, 6));
    run(engine, line('C', 'bt', 'ka', 'kb'), line('C', 'rt', 'kb', 'kc'), line('C', 'tp', 'kc', 'kd'), spline('C', 'sp', ['kd', 'w1', 'w2', 'ka']));
    const before = run(engine, addExtrude('B', 'C', [['bt', 'rt', 'sp', 'tp']], 2));
    const volume = before.evaluation.bodies.B.volume;
    run(engine, point('C', 'l0', -5, 10), point('C', 'l1', 25, 10), line('C', 'ln', 'l0', 'l1'));
    const found = contacts(engine, 'C');
    expect(found.total).toBe(2);
    expect(found.contacts.find((c) => c.curves.includes('sp'))?.fix).toBe('none');
    expect(found.contacts.some((c) => c.curves.includes('ln') && c.curves.includes('rt') && c.fix === 'cut')).toBe(true);
    const { state, ids } = apply(engine, 'trim', 'C', { curve: 'ln', at: [10, 10] });
    expect(resultOf(state, 'C').valid).toBe(true);
    expect(ids.dropped).not.toContain('B');
    expect(state.evaluation.features.B.status).toBe('ok');
    expect(state.evaluation.bodies.B.volume).toBeCloseTo(volume, 3);
  });

  it('a plate with a hole that is a closed spline keeps its hole through a notch trimmed into its edge', () => {
    const engine = newEngine();
    run(engine, addSketch('P', XY));
    run(
      engine,
      point('P', 'r1', 0, -10),
      point('P', 'r2', 40, -10),
      point('P', 'r3', 40, 30),
      point('P', 'r4', 0, 30),
      line('P', 'pa', 'r1', 'r2'),
      line('P', 'pb', 'r2', 'r3'),
      line('P', 'pc', 'r3', 'r4'),
      line('P', 'pd', 'r4', 'r1'),
      point('P', 'b1', 10, 0),
      point('P', 'b2', 30, 0),
      point('P', 'b3', 30, 20),
      point('P', 'b4', 10, 20),
      spline('P', 's', ['b1', 'b2', 'b3', 'b4', 'b1']),
    );
    const before = run(engine, addExtrude('E', 'P', [['pa', 'pb', 'pc', 'pd']], 2));
    const volume = before.evaluation.bodies.E.volume;
    run(engine, point('P', 'kc', 20, -10), circle('P', 'kn', 'kc', 3));
    const first = apply(engine, 'trim', 'P', { curve: 'kn', at: [20, -13] }, 'k1_');
    const second = apply(engine, 'trim', 'P', { at: [20, -10] }, 'k2_');
    expect(first.ids.dropped).not.toContain('E');
    // the second trim takes the half disc of the notch away, a region of E after the first: E is in
    // `dropped` for it, as in 6e's own notch (scenario 15), and keeps the region of the plate
    expect(second.ids.dropped).toEqual(['E']);
    const feature = second.state.document.features.find((f) => f.id === 'E');
    const regions = feature?.type === 'extrude' && feature.profile.type === 'regions' ? feature.profile.regions.map((r) => r.outerLoop) : [];
    expect(regions).toHaveLength(1);
    expect(regions.some((loop) => loop.length === 1 && loop[0] === 's')).toBe(false);
    expect(second.state.evaluation.features.E.status).toBe('ok');
    expect(second.state.evaluation.bodies.E.volume).toBeCloseTo(volume - Math.PI * 9, 0);
  });
});

describe('6c with a spline (D70)', () => {
  it('a spline from the origin to a point on the Y axis, mirrored about it: one region of the spline and its copy, no open end', () => {
    const engine = newEngine();
    run(engine, addSketch('A', XY));
    run(engine, point('A', 'top', 0.3, 30.2), point('A', 'h1', 12, 2), point('A', 'h2', 14, 26), spline('A', 'half', ['origin', 'h1', 'h2', 'top']));
    run(engine, constrain('A', 'on', { type: 'pointOnCurve', point: 'top', curve: 'origin/y' }));
    const state = run(engine, { type: 'addExternal', sketch: 'A', id: 'm', ref: { type: 'pattern', sources: ['half'], transform: { type: 'mirror', axis: 'origin/y' } } });
    const result = resultOf(state, 'A');
    expect(result.valid).toBe(true);
    expect(result.regions.map((r) => r.ref.outerLoop)).toEqual([['half', 'm/1/half']]);
    expect(result.curves['m/1/half'].shape).toEqual({ type: 'spline', points: ['m/1/origin', 'm/1/h1', 'm/1/h2', 'm/1/top'] });
    expect((result as { openEnds?: unknown }).openEnds).toBeUndefined();
    // 0.01 mm off the axis, the copy's end is an open end
    const off = engine.preview({ type: 'batch', commands: [{ type: 'removeConstraint', sketch: 'A', id: 'on' }, constrain('A', 'off', { type: 'horizontalDistance', a: 'origin', b: 'top', value: 0.01, driving: true })] });
    expect(off.ok && (resultOf(off.state, 'A') as { openEnds?: { count: number } }).openEnds?.count).toBeGreaterThan(0);
  });

  it('a spline mirrored onto itself forms no regions with its copy (occupies, in both orders), and a circular pattern copies it', () => {
    const engine = newEngine();
    run(engine, addSketch('M', XY));
    run(engine, point('M', 'a', -10, 0), point('M', 'b', -5, 10), point('M', 'c', 5, 10), point('M', 'd', 10, 0), spline('M', 's', ['a', 'b', 'c', 'd']), line('M', 'l', 'a', 'd'));
    run(engine, constrain('M', 'k1', { type: 'symmetric', a: 'a', b: 'd', line: 'origin/y' }), constrain('M', 'k2', { type: 'symmetric', a: 'b', b: 'c', line: 'origin/y' }));
    const state = run(engine, { type: 'addExternal', sketch: 'M', id: 'm', ref: { type: 'pattern', sources: ['s'], transform: { type: 'mirror', axis: 'origin/y' } } });
    const result = resultOf(state, 'M');
    expect(result.curves['m/1/s'].regions).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.regions.map((r) => r.ref.outerLoop)).toEqual([['l', 's']]);
    const turned = run(engine, { type: 'addExternal', sketch: 'M', id: 'p', ref: { type: 'pattern', sources: ['s', 'l'], transform: { type: 'circular', center: 'origin', count: 3, span: { type: 'full' } } } as never });
    expect(resultOf(turned, 'M').curves['p/1/s'].shape).toEqual({ type: 'spline', points: ['p/1/a', 'p/1/b', 'p/1/c', 'p/1/d'] });
    // the source listed the other way round: the copy occupies it too
    const reversed = engine.preview({ type: 'batch', commands: [{ type: 'removeExternal', sketch: 'M', id: 'p' } as never, { type: 'removeExternal', sketch: 'M', id: 'm' } as never, { type: 'removeEntity', sketch: 'M', id: 's' }, spline('M', 's', ['d', 'c', 'b', 'a']), { type: 'addExternal', sketch: 'M', id: 'm', ref: { type: 'pattern', sources: ['s'], transform: { type: 'mirror', axis: 'origin/y' } } }] });
    if (!reversed.ok) throw new Error(reversed.error.message);
    expect(resultOf(reversed.state, 'M').curves['m/1/s'].regions).toBe(false);
    expect(resultOf(reversed.state, 'M').regions.map((r) => r.ref.outerLoop)).toEqual([['l', 's']]);
  });

  it('occupies takes a spline\'s control points in order or in reverse, and nothing else', () => {
    const geometry = { points: { a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, c: { x: 10, y: 0 }, d: { x: 15, y: 5 } }, radii: {} };
    const curve = (id: Id, points: Id[]) => ({ id, shape: { type: 'spline' as const, points }, source: 'own' as const, regions: true });
    expect(occupies(curve('x', ['a', 'b', 'c']), curve('y', ['a', 'b', 'c']), geometry)).toBe(true);
    expect(occupies(curve('x', ['a', 'b', 'c']), curve('y', ['c', 'b', 'a']), geometry)).toBe(true);
    expect(occupies(curve('x', ['a', 'b', 'c']), curve('y', ['b', 'a', 'c']), geometry)).toBe(false);
    expect(occupies(curve('x', ['a', 'b', 'c']), curve('y', ['a', 'b', 'c', 'd']), geometry)).toBe(false);
  });
});

describe('6b and a spline (D70)', () => {
  function source(engine: Engine): EngineState {
    bulge(engine);
    run(engine, addSketch('T', XY));
    return engine.getState();
  }
  const projection = (sketch: Id, id: Id, entity: Id, kind: string): Command => ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: 'S', entity, kind, regions: false } } as never);

  it('the form refuses kind spline, also on load; a command naming a spline as a line is refused; its control points are projected', () => {
    const engine = newEngine();
    source(engine);
    expect(refusal(engine, projection('T', 'e1', 'sp', 'spline'))).toMatch(/kind: a spline is not projected yet: project its control points as points/);
    expect(refusal(engine, projection('T', 'e2', 'sp', 'line'))).toMatch(/"sp" of S is a spline, and a spline is not projected yet/);
    expect(refusal(engine, projection('T', 'e3', 'm', 'point'))).toBe('accepted');
    const doc = JSON.parse(JSON.stringify(engine.getState().document));
    doc.features.find((f: { id: Id }) => f.id === 'T').external.e1 = { type: 'sketch', sketch: 'S', entity: 'sp', kind: 'spline', regions: false };
    expect(engine.load(doc).ok).toBe(false);
  });

  it('the projection of a line that became a spline is frozen with brokenProjection', () => {
    const engine = newEngine();
    source(engine);
    run(engine, projection('T', 'f1', 'l1', 'line'));
    const state = run(engine, { type: 'batch', commands: [{ type: 'removeEntity', sketch: 'S', id: 'l1' }, point('S', 'q', 20, -5), spline('S', 'l1', ['p1', 'q', 'p2'])] });
    const follower = state.evaluation.features.T;
    expect(follower.status).not.toBe('error');
    expect(follower.warnings.some((w) => w.code === 'brokenProjection' && /is a spline now, not a line/.test(w.message ?? JSON.stringify(w)))).toBe(true);
    expect(resultOf(state, 'T').points['f1/b']?.x).toBeCloseTo(40, 9);
    // the document loads, and the projection is frozen there too
    const loaded = newEngine();
    expect(loaded.load(JSON.stringify(state.document)).ok).toBe(true);
    const again = loaded.getState().evaluation.features.T;
    expect(again.status).toBe('warning');
    expect(again.warnings.map((w) => w.code)).toContain('brokenProjection');
  });

  it('projectSketch leaves the splines out and lists them; with entities naming one it refuses; sketchSources lists it without a place', () => {
    const engine = newEngine();
    source(engine);
    const whole = tool(engine, 'projectSketch', 'T', { sketch: 'S' });
    expect(whole.ok && whole.ids.splines).toEqual(['sp']);
    expect(whole.ok && whole.ids.sources).toEqual(['l1', 'l3', 'l4']);
    const own = tool(engine, 'projectSketch', 'T', { sketch: 'S', as: 'own' });
    expect(own.ok && own.ids.splines).toEqual(['sp']);
    const named = tool(engine, 'projectSketch', 'T', { sketch: 'S', entities: ['l1', 'sp'] });
    expect(!named.ok && named.message).toMatch(/entities: "sp" of S is a spline/);
    const points = tool(engine, 'projectSketch', 'T', { sketch: 'S', entities: ['m'] });
    expect(points.ok).toBe(true);
    const answer = engine.query('sketchSources', { sketch: 'T', from: 'S' });
    const listed = answer.ok ? answer.result.entities?.find((e) => e.id === 'sp') : undefined;
    expect(listed).toEqual({ id: 'sp', kind: 'spline', whole: false, regions: true });
    expect(answer.ok && answer.result.entities?.some((e) => e.id === 'm' && e.kind === 'point')).toBe(true);
  });
});
