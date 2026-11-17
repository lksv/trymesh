// The revolve (D58) against the real adapters: the tools of "Measured", A of the design (closed,
// facing outwards, taken by the kernel, with the volume of Pappus), the faces and surfaces of each
// kind of curve, the caps of a partial turn and the frame of a sketch on them, the errors, the axis
// of a line of a sketch for a pattern, a joint and a query, the limit of the size, and what the
// design left to verify (a pinched body through the section, the 3MF and the print check, an axis
// of another sketch far from the origin, a fuzz of profiles that touch the axis).
import { type AxisRef, type Command, type Engine, type EngineState, type Id, type Input, type RevolveFeature, type Solid, type Surface, emptyDocument, namedBySections, shapeOrigin, storedMesh } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, batch, expectAllOk, newEngine, rectLoop, rectangle, run, side } from './kit';

const XZ = { kind: 'base', plane: 'XZ' } as const;
const Z: AxisRef = { kind: 'base', axis: 'Z' };
const revolve = (id: Id, sketch: Id, curves: Id[], extent: Input<RevolveFeature['extent']> = { type: 'full' }, axis: AxisRef = Z, operation: RevolveFeature['operation'] = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'revolve', profile: { type: 'regions', sketch, regions: [{ outerLoop: [...curves].sort() }] }, axis, extent, operation, ...(targets ? { targets } : {}) },
});
// A closed polygon of points `${p}<i>` and lines `${p}l<i>` from point i to i + 1, without constraints.
function polygon(sketch: Id, p: string, corners: [number, number][]): Command {
  return batch(
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i}`, x, y })),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: `${p}l${i}`, curve: { type: 'line', a: `${p}${i}`, b: `${p}${(i + 1) % corners.length}` } })),
  );
}
const lines = (p: string, n: number): Id[] => Array.from({ length: n }, (_, i) => `${p}l${i}`);
// A half circle centred at (x, y) of radius r on the side x > x0 of the vertical line through its
// ends, closed by that line: `${p}a` the arc, `${p}d` the diameter from the top to the bottom.
function halfDisc(sketch: Id, p: string, x: number, y: number, r: number): Command {
  return batch(
    { type: 'addPoint', sketch, id: `${p}0`, x, y: y - r },
    { type: 'addPoint', sketch, id: `${p}1`, x, y: y + r },
    { type: 'addPoint', sketch, id: `${p}c`, x, y },
    { type: 'addCurve', sketch, id: `${p}a`, curve: { type: 'arc', center: `${p}c`, start: `${p}0`, end: `${p}1` } },
    { type: 'addCurve', sketch, id: `${p}d`, curve: { type: 'line', a: `${p}1`, b: `${p}0` } },
  );
}
// Closed by its indices: every directed edge once, with its reverse once.
function closed(solid: Solid): boolean {
  const edges = new Map<string, number>();
  const t = solid.triangles;
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) edges.set(`${t[i + k]}>${t[i + ((k + 1) % 3)]}`, (edges.get(`${t[i + k]}>${t[i + ((k + 1) % 3)]}`) ?? 0) + 1);
  for (const [key, n] of edges) {
    const [a, b] = key.split('>');
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}
// The first moment about the Y axis of the sketch (x is the radius) of a polygon: Pappus.
const moment = (corners: [number, number][]): number => corners.reduce((sum, a, i) => {
  const b = corners[(i + 1) % corners.length];
  return sum + ((a[0] * b[1] - b[0] * a[1]) * (a[0] + b[0])) / 6;
}, 0);
const surfaceOf = (state: EngineState, body: Id, feature: Id, curve: Id): Surface | undefined => {
  const face = state.evaluation.bodies[body]?.faces.find((f) => JSON.stringify(state.evaluation.faceNames[f.id]) === JSON.stringify(side(feature, curve)));
  return face ? state.evaluation.faceSurfaces[face.id] : undefined;
};
const errorOf = (engine: Engine, command: Command, id: Id) => {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state.evaluation.features[id];
};
// The tool taken by the kernel as the operand of a union with a box far away.
function takenByKernel(engine: Engine, body: Id): boolean {
  const state = run(engine, addSketch(`far_${body}`, XY), rectangle(`far_${body}`, `q${body}`, 500, 500, 5, 5, null), addExtrude(`box_${body}`, `far_${body}`, [rectLoop(`q${body}`)], 5, 'add', body));
  return state.evaluation.features[`box_${body}`].status === 'ok';
}

const PULLEY: [number, number][] = [
  [4, 0],
  [20, 0],
  [20, 4],
  [15, 6.5],
  [15, 8.5],
  [20, 11],
  [20, 15],
  [4, 15],
];

describe('the tools of a revolve (D58, "Measured", A)', () => {
  const exact = 2 * Math.PI * moment(PULLEY);
  for (const [label, extent, share] of [
    ['a whole turn', { type: 'full' }, 1],
    ['90°', { type: 'angle', start: 0, angle: Math.PI / 2 }, 0.25],
    ['from 0.3 rad by −4 rad', { type: 'angle', start: 0.3, angle: -4 }, 4 / (2 * Math.PI)],
  ] as const) {
    for (const mirrored of [false, true]) {
      it(`a pulley of eight lines, ${label}${mirrored ? ', drawn on the other side of the axis' : ''}: closed, outwards, the volume of Pappus, taken by the kernel`, () => {
        const engine = newEngine();
        const corners = mirrored ? PULLEY.map(([x, y]): [number, number] => [-x, y]).reverse() : PULLEY;
        const state = run(engine, addSketch('S', XZ), polygon('S', 'p', corners), revolve('R', 'S', lines('p', 8), extent));
        expectAllOk(state);
        const body = state.evaluation.bodies.R;
        expect(closed(body.solid)).toBe(true);
        expect(body.volume / (exact * share) - 1).toBeLessThan(0);
        expect(Math.abs(body.volume / (exact * share) - 1)).toBeLessThan(1e-3);
        expect(takenByKernel(engine, 'R')).toBe(true);
        // every edge between neighbouring curves of a whole turn is a circle
        if (extent.type === 'full') expect(body.edges.map((edge) => edge.kind)).toEqual(Array(8).fill('circle'));
      });
    }
  }

  it('a ball (a half circle and the line on the axis), whole and 270°: a sphere, two poles, the caps meet along the axis', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XZ), halfDisc('S', 'b', 0, 0, 10));
    for (const [id, extent, share] of [['ball', { type: 'full' }, 1], ['part', { type: 'angle', start: 0, angle: 1.5 * Math.PI }, 0.75]] as const) {
      const state = run(engine, revolve(id, 'S', ['ba', 'bd'], extent));
      const body = state.evaluation.bodies[id];
      expect(closed(body.solid)).toBe(true);
      const ratio = body.volume / ((4 / 3) * Math.PI * 1000 * share);
      expect(ratio).toBeLessThan(1);
      expect(ratio).toBeGreaterThan(1 - 0.01 * 3 * 1.1 / 10); // within the chord tolerance over the surface
      expect(surfaceOf(state, id, id, 'ba')).toEqual({ kind: 'sphere', center: [0, 0, 0], radius: 10 });
      expect(surfaceOf(state, id, id, 'bd')).toBeUndefined();
      // the edges of the partial ball: the caps meet each other in a line, the sphere in circles
      if (id === 'part') expect(body.edges.map((edge) => `${edge.name.a.role}/${edge.name.b.role}:${edge.kind}`).sort()).toEqual(['endCap/side:circle', 'endCap/startCap:line', 'side/startCap:circle']);
      expect(takenByKernel(engine, id)).toBe(true);
    }
  });

  it('the mesh of a ball is within the chord tolerance of the sphere, divided for half of it twice', () => {
    const engine = newEngine();
    const state = run(engine, addSketch('S', XZ), halfDisc('S', 'b', 0, 0, 10), revolve('ball', 'S', ['ba', 'bd']));
    const { positions: p, triangles } = state.evaluation.bodies.ball.solid;
    let deepest = 0;
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [3 * triangles[t], 3 * triangles[t + 1], 3 * triangles[t + 2]];
      for (let i = 0; i <= 6; i++) for (let j = 0; i + j <= 6; j++) {
        const [u, v, w] = [i / 6, j / 6, 1 - i / 6 - j / 6];
        const at = [0, 1, 2].map((k) => u * p[a + k] + v * p[b + k] + w * p[c + k]);
        deepest = Math.max(deepest, 10 - Math.hypot(at[0], at[1], at[2]));
      }
    }
    expect(deepest).toBeLessThan(0.01);
    expect(deepest).toBeGreaterThan(0.005);
  });

  it('a torus, a cone with a side on the axis, a hollow ring, a pinched diamond whole and 270°', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XZ),
      { type: 'addPoint', sketch: 'S', id: 'tc', x: 20, y: 0 },
      { type: 'addCurve', sketch: 'S', id: 'tube', curve: { type: 'circle', center: 'tc' }, radius: 5 },
      addSketch('C', XZ),
      polygon('C', 'k', [[0, 0], [8, 0], [0, 12]]),
      addSketch('H', XZ),
      polygon('H', 'o', [[10, -20], [20, -20], [20, -10], [10, -10]]),
      { type: 'addPoint', sketch: 'H', id: 'hc', x: 15, y: -15 },
      { type: 'addCurve', sketch: 'H', id: 'hole', curve: { type: 'circle', center: 'hc' }, radius: 2 },
      addSketch('D', XZ),
      polygon('D', 'm', [[0, 30], [5, 25], [10, 30], [5, 35]]),
    );
    const state = run(
      engine,
      revolve('torus', 'S', ['tube']),
      revolve('cone', 'C', lines('k', 3)),
      revolve('ring', 'H', lines('o', 4)),
      revolve('pinch', 'D', lines('m', 4)),
      revolve('pinch3', 'D', lines('m', 4), { type: 'angle', start: 0, angle: 1.5 * Math.PI }),
    );
    expectAllOk(state);
    const volume = (id: Id) => state.evaluation.bodies[id].volume;
    expect(Math.abs(volume('torus') / (2 * Math.PI * Math.PI * 20 * 25) - 1)).toBeLessThan(3e-3);
    expect(Math.abs(volume('cone') / ((Math.PI * 64 * 12) / 3) - 1)).toBeLessThan(3e-3);
    expect(Math.abs(volume('ring') / (2 * Math.PI * (moment([[10, -20], [20, -20], [20, -10], [10, -10]]) - 15 * Math.PI * 4)) - 1)).toBeLessThan(3e-3);
    const diamond = 2 * Math.PI * moment([[0, 30], [5, 25], [10, 30], [5, 35]]);
    expect(Math.abs(volume('pinch') / diamond - 1)).toBeLessThan(3e-3);
    expect(Math.abs(volume('pinch3') / (0.75 * diamond) - 1)).toBeLessThan(3e-3);
    for (const id of ['torus', 'cone', 'ring', 'pinch', 'pinch3']) expect(closed(state.evaluation.bodies[id].solid), id).toBe(true);
    expect(surfaceOf(state, 'torus', 'torus', 'tube')).toEqual({ kind: 'torus', center: [0, 0, 0], axis: [0, 0, 1], majorRadius: 20, minorRadius: 5 });
    // the cone: the apex where the slanted line meets the axis, the axis towards the face
    const slant = surfaceOf(state, 'cone', 'cone', 'kl1');
    expect(slant?.kind).toBe('cone');
    if (slant?.kind === 'cone') {
      expect(slant.apex.map((v) => +v.toFixed(9))).toEqual([0, 0, 12]);
      expect(slant.axis).toEqual([0, 0, -1]);
      expect(slant.halfAngle).toBeCloseTo(Math.atan2(8, 12), 12);
    }
    expect(surfaceOf(state, 'cone', 'cone', 'kl2')).toBeUndefined(); // the line on the axis
    expect(surfaceOf(state, 'ring', 'ring', 'hole')?.kind).toBe('torus');
    // the pinched body as the target of a cut across the pinch and of a union through it
    const after = run(engine, addSketch('P', XY), rectangle('P', 'pp', -20, -20, 40, 40, null), {
      type: 'addFeature',
      feature: { id: 'slab', name: 'slab', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'P', regions: [{ outerLoop: rectLoop('pp') }] }, extent: { type: 'distance', start: 29, distance: 2 }, operation: 'cut', targets: ['pinch'] },
    });
    expect(after.evaluation.features.slab.status).toBe('ok');
    expect(takenByKernel(engine, 'pinch3')).toBe(true);
  });

  it('a wall along a line: a tube; its sides are cylinders and its ends planes', () => {
    const engine = newEngine();
    const state = run(engine, addSketch('S', XZ), { type: 'addPoint', sketch: 'S', id: 'w0', x: 10, y: 0 }, { type: 'addPoint', sketch: 'S', id: 'w1', x: 10, y: 20 }, { type: 'addCurve', sketch: 'S', id: 'w', curve: { type: 'line', a: 'w0', b: 'w1' } }, {
      type: 'addFeature',
      feature: { id: 'tube', name: 'tube', suppressed: false, type: 'revolve', profile: { type: 'wall', sketch: 'S', curves: ['w'], thickness: 2 }, axis: Z, extent: { type: 'full' }, operation: 'new' },
    });
    expectAllOk(state);
    const kinds = state.evaluation.bodies.tube.faces.map((face) => `${state.evaluation.faceNames[face.id].role}:${state.evaluation.faceSurfaces[face.id].kind}`).sort();
    expect(kinds).toEqual(['wallEnd:plane', 'wallEnd:plane', 'wallSide:cylinder', 'wallSide:cylinder']);
    expect(Math.abs(state.evaluation.bodies.tube.volume / (Math.PI * (121 - 81) * 20) - 1)).toBeLessThan(1e-3);
  });

  it('an ogive: an arc centred across the axis is a torus with a negative major radius; its tip a pole', () => {
    const engine = newEngine();
    // the arc from (0, 0) to (0, 20) about the centre (-15, 10), on the side x > 0, closed on the axis
    const state = run(
      engine,
      addSketch('S', XZ),
      { type: 'addPoint', sketch: 'S', id: 'a', x: 0, y: 0 },
      { type: 'addPoint', sketch: 'S', id: 'b', x: 0, y: 20 },
      { type: 'addPoint', sketch: 'S', id: 'c', x: -15, y: 10 },
      { type: 'addCurve', sketch: 'S', id: 'arc', curve: { type: 'arc', center: 'c', start: 'a', end: 'b' } },
      { type: 'addCurve', sketch: 'S', id: 'axis', curve: { type: 'line', a: 'b', b: 'a' } },
      revolve('ogive', 'S', ['arc', 'axis']),
    );
    expectAllOk(state);
    const torus = surfaceOf(state, 'ogive', 'ogive', 'arc');
    expect(torus?.kind).toBe('torus');
    if (torus?.kind === 'torus') {
      expect(torus.majorRadius).toBeCloseTo(-15, 9);
      expect(torus.minorRadius).toBeCloseTo(Math.hypot(15, 10), 9);
    }
    const body = engine.query('body', { body: 'ogive' });
    if (!body.ok) throw new Error(body.error.message);
    expect(body.result.faces[0]).toMatchObject({ surface: { kind: 'torus' }, convex: true });
  });
});

describe('the caps and the faces a sketch can stand on (D58)', () => {
  it('a sketch on the start cap of a turn from 0 has the frame of the profile sketch with the normal out of the body', () => {
    const engine = newEngine();
    const state = run(engine, addSketch('S', XZ), polygon('S', 'p', PULLEY), revolve('R', 'S', lines('p', 8), { type: 'angle', start: 0, angle: Math.PI / 2 }), addSketch('onCap', { kind: 'face', body: 'R', face: { feature: 'R', role: 'startCap' } }), addSketch('onEnd', { kind: 'face', body: 'R', face: { feature: 'R', role: 'endCap' } }));
    const frame = state.evaluation.features.onCap.plane;
    expect(frame?.origin).toEqual([0, 0, 0]);
    expect(frame?.y.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 1]);
    // XZ has the normal −Y; the turn goes from it towards +Y... the body lies on the side the angle grows, so out of it is −Y
    expect(frame?.normal.map((v) => +v.toFixed(12) + 0)).toEqual([0, -1, 0]);
    // the end cap: the plane YZ, the frame turned by 90° about +Z, the normal out of the body
    const end = state.evaluation.features.onEnd.plane;
    expect(end?.y.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 1]);
    expect(end?.normal.map((v) => +v.toFixed(12) + 0)).toEqual([-1, 0, 0]);
    // a side from a line across the axis: the top, its origin the start of the line
    const top = run(engine, addSketch('onTop', { kind: 'face', body: 'R', face: side('R', 'pl6') })).evaluation.features.onTop.plane;
    expect(top?.origin.map((v) => +v.toFixed(12) + 0)).toEqual([20, 0, 15]);
    expect(top?.normal.map((v) => +v.toFixed(12) + 0)).toEqual([0, 0, 1]);
    // a cylinder and a sphere carry no sketch
    expect(errorOf(engine, addSketch('onRim', { kind: 'face', body: 'R', face: side('R', 'pl1') }), 'onRim').error?.code).toBe('nonPlanarFace');
  });
});

describe('the errors of a revolve and the axis of a line of a sketch (D58)', () => {
  const base = (): Engine => {
    const engine = newEngine();
    run(engine, addSketch('S', XZ), polygon('S', 'p', PULLEY), revolve('R', 'S', lines('p', 8)));
    return engine;
  };

  it('an axis outside the plane, a line on a parallel plane, a profile on both sides: invalidAxis with what it is about', () => {
    const engine = base();
    expect(errorOf(engine, revolve('e1', 'S', lines('p', 8), undefined, { kind: 'base', axis: 'Y' }), 'e1').error).toMatchObject({ code: 'invalidAxis', refs: [{ kind: 'base', axis: 'Y' }] });
    expect(errorOf(engine, revolve('e1', 'S', lines('p', 8), undefined, { kind: 'base', axis: 'Y' }), 'e1').error?.message).toMatch(/at 90° to the plane of the sketch/);
    // a line of a sketch on a plane 5 off XZ: parallel to it, but not in it
    const off = batch(
      { type: 'addFeature', feature: { id: 'pl', name: 'pl', suppressed: false, type: 'plane', base: XZ, offset: 5 } },
      addSketch('L', { kind: 'plane', feature: 'pl' }),
      { type: 'addPoint', sketch: 'L', id: 'l0', x: 0, y: 0 },
      { type: 'addPoint', sketch: 'L', id: 'l1', x: 0, y: 10 },
      { type: 'addCurve', sketch: 'L', id: 'ax', curve: { type: 'line', a: 'l0', b: 'l1' } },
      revolve('e2', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'L', line: 'ax' }),
    );
    expect(errorOf(engine, off, 'e2').error?.message).toMatch(/lies 5 mm off the plane of the sketch/);
    // the bottom line of the profile is an axis too: the profile lies on one side of it
    const across = errorOf(engine, revolve('e3', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'S', line: 'pl0' }), 'e3');
    expect(across.status).toBe('ok'); // the bottom line lies on the profile's edge: the profile is on one side
  });

  it('a line of another sketch at coordinates of a few hundred millimetres, and a sketch on a face through the axis', () => {
    const engine = newEngine();
    // the profile and the axis 300 mm and 700 mm from the origin, the axis drawn in another sketch on XZ
    const state = run(
      engine,
      addSketch('S', XZ),
      polygon('S', 'p', PULLEY.map(([x, y]): [number, number] => [x + 300, y + 700])),
      addSketch('A', XZ),
      { type: 'addPoint', sketch: 'A', id: 'a0', x: 300, y: 650 },
      { type: 'addPoint', sketch: 'A', id: 'a1', x: 300, y: 800 },
      { type: 'addCurve', sketch: 'A', id: 'ax', curve: { type: 'line', a: 'a0', b: 'a1', construction: true } },
      revolve('far', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'A', line: 'ax' }),
    );
    expectAllOk(state);
    expect(state.evaluation.features.far.facts?.axisPoint).toEqual([300, 0, 650]);
    // a sketch on the start cap of a quarter turn: its plane holds the axis, a line of it is the axis again
    const quarter = run(
      engine,
      revolve('q', 'S', lines('p', 8), { type: 'angle', start: 0.3, angle: 1 }, { kind: 'sketchLine', sketch: 'A', line: 'ax' }),
      addSketch('onCap', { kind: 'face', body: 'q', face: { feature: 'q', role: 'endCap' } }),
    );
    const cap = quarter.evaluation.features.onCap.plane;
    expect(cap).toBeDefined();
    // the axis point in the coordinates of the cap sketch: where the turned origin was
    const point = (x: number, y: number): number[] => [0, 1, 2].map((k) => cap!.origin[k] + x * cap!.x[k] + y * cap!.y[k]);
    const toCap = (p: number[]): [number, number] => [0, 1].map((k) => [cap!.x, cap!.y][k].reduce((sum, c, i) => sum + c * (p[i] - cap!.origin[i]), 0)) as [number, number];
    const [u0, v0] = toCap([300, 0, 650]);
    const [u1, v1] = toCap([300, 0, 800]);
    expect(Math.hypot(...point(u0, v0).map((value, k) => value - [300, 0, 650][k]))).toBeLessThan(1e-9);
    const second = run(
      engine,
      addSketch('B', XZ),
      polygon('B', 'b', [[310, 660], [330, 660], [330, 680], [310, 680]]),
      { type: 'addPoint', sketch: 'onCap', id: 'c0', x: u0, y: v0 },
      { type: 'addPoint', sketch: 'onCap', id: 'c1', x: u1, y: v1 },
      { type: 'addCurve', sketch: 'onCap', id: 'cax', curve: { type: 'line', a: 'c0', b: 'c1', construction: true } },
      revolve('again', 'B', lines('b', 4), undefined, { kind: 'sketchLine', sketch: 'onCap', line: 'cax' }),
    );
    expect(second.evaluation.features.again.status).toBe('ok');
  });

  it('a line without length is invalidAxis for a revolve, a pattern, a joint and the argument of the query mass', () => {
    const engine = base();
    const zero = batch({ type: 'addPoint', sketch: 'S', id: 'z0', x: 50, y: 50 }, { type: 'addPoint', sketch: 'S', id: 'z1', x: 50, y: 50 }, { type: 'addCurve', sketch: 'S', id: 'zl', curve: { type: 'line', a: 'z0', b: 'z1', construction: true } });
    run(engine, zero);
    const line: AxisRef = { kind: 'sketchLine', sketch: 'S', line: 'zl' };
    expect(errorOf(engine, revolve('e', 'S', lines('p', 8), undefined, line), 'e').error).toMatchObject({ code: 'invalidAxis', refs: ['zl'] });
    expect(errorOf(engine, { type: 'addFeature', feature: { id: 'pt', name: 'pt', suppressed: false, type: 'pattern', source: { type: 'body', body: 'R' }, transform: { type: 'linear', direction: line, count: 2, span: { type: 'spacing', spacing: 50 } } } }, 'pt').error?.code).toBe('invalidAxis');
    const mass = engine.query('mass', { bodies: ['R'], density: 1, about: line });
    expect(mass.ok ? undefined : mass.error).toMatchObject({ code: 'notAvailable', arg: ['about'] });
    expect(mass.ok ? '' : mass.error.message).toMatch(/the line of the axis has no length/);
    // a joint
    run(engine, revolve('R2', 'S', lines('p', 8)), { type: 'setLink', id: 'base', bodies: ['R'] }, { type: 'setLink', id: 'arm', bodies: ['R2'] });
    const joint = run(engine, { type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'base', child: 'arm', axis: line, lower: -1, upper: 1, value: 0 } });
    expect(joint.evaluation.mechanism.joints.j.error?.code).toBe('invalidAxis');
  });

  it('the axis of a line: validated as a line, its references; the check of a query argument; the names the mechanism reserves', () => {
    const engine = base();
    const refused = (command: Command, pattern: RegExp) => {
      const result = engine.execute(command);
      expect(result.ok ? 'accepted' : result.error.message).toMatch(pattern);
    };
    refused(revolve('x', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'S', line: 'p0' }), /"p0" is a point, expected line/);
    refused(revolve('x', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'S', line: 'nope' }), /has no entity "nope"/);
    refused(revolve('x', 'S', lines('p', 8), undefined, { kind: 'sketchLine', sketch: 'S', point: 'p0' } as never), /has no such field/);
    const query = engine.query('mass', { bodies: ['R'], density: 1, about: { kind: 'sketchLine', sketch: 'S', line: 'p1' } });
    expect(query.ok ? undefined : query.error).toMatchObject({ code: 'notAvailable', arg: ['about', 'line'] });
    const fine = engine.query('mass', { bodies: ['R'], density: 1, about: { kind: 'sketchLine', sketch: 'S', line: 'pl1' } });
    expect(fine.ok).toBe(true);
    // the line of a joint's axis keeps its sketch and the line from removal
    run(
      engine,
      revolve('R2', 'S', lines('p', 8)),
      { type: 'addPoint', sketch: 'S', id: 'j0', x: 0, y: 0 },
      { type: 'addPoint', sketch: 'S', id: 'j1', x: 0, y: 10 },
      { type: 'addCurve', sketch: 'S', id: 'jx', curve: { type: 'line', a: 'j0', b: 'j1', construction: true } },
      { type: 'setLink', id: 'base', bodies: ['R'] },
      { type: 'setLink', id: 'arm', bodies: ['R2'] },
      { type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'base', child: 'arm', axis: { kind: 'sketchLine', sketch: 'S', line: 'jx' }, lower: -1, upper: 1, value: 0.5 } },
    );
    expect(engine.getState().evaluation.mechanism.joints.j.status).toBe('ok');
    // the names the section reserves (no fresh ID takes them): the sketch and the line
    expect(namedBySections(engine.getState().document)).toEqual(expect.arrayContaining(['S', 'jx']));
  });

  it('a removed line is a broken reference; a projected line whose edge is gone keeps its frozen place', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('B', XY),
      rectangle('B', 'r', 0, 0, 40, 10),
      addExtrude('block', 'B', [rectLoop('r')], 10),
      addSketch('S', XZ),
      polygon('S', 'p', [[45, 0], [55, 0], [55, 10], [45, 10]]),
      { type: 'addExternal', sketch: 'S', id: 'x', ref: { type: 'edge', body: 'block', edge: { a: { feature: 'block', role: 'startCap' }, b: side('block', 'ra') }, kind: 'line' } },
    );
    const state = run(engine, revolve('R', 'S', lines('p', 4), undefined, { kind: 'sketchLine', sketch: 'S', line: 'x' }));
    expectAllOk(state);
    expect(state.evaluation.features.R.facts?.axisDirection).toEqual([1, 0, 0]);
    // the edge goes: the line keeps its last place, and the axis with it
    const gone = run(engine, { type: 'setSuppressed', id: 'block', suppressed: true });
    expect(gone.evaluation.features.S.warnings.map((w) => w.code)).toContain('brokenProjection');
    expect(gone.evaluation.features.R.status).toBe('ok');
    // an own line removed: the command is refused while the revolve names it, as for any entity
    const own = run(engine, { type: 'setSuppressed', id: 'block', suppressed: false }, { type: 'addPoint', sketch: 'S', id: 'q0', x: 0, y: -5 }, { type: 'addPoint', sketch: 'S', id: 'q1', x: 0, y: 20 }, { type: 'addCurve', sketch: 'S', id: 'q', curve: { type: 'line', a: 'q0', b: 'q1', construction: true } }, { type: 'updateFeature', id: 'R', patch: { axis: { kind: 'sketchLine', sketch: 'S', line: 'q' } } });
    expect(own.evaluation.features.R.status).toBe('ok');
    const removed = engine.execute({ type: 'removeEntity', sketch: 'S', id: 'q' });
    if (removed.ok) expect(removed.state.evaluation.features.R.error).toMatchObject({ code: 'brokenReference', refs: ['q'] });
  });

  it('a pattern of a revolve about a line of a sketch: four grooves around an off-centre axis', () => {
    const engine = newEngine();
    // a plate, a groove cut by a revolve about a line of its own sketch at x = 30, repeated about a construction line of another sketch
    const state = run(
      engine,
      addSketch('P', XY),
      rectangle('P', 'r', 0, -30, 60, 60, null),
      addExtrude('plate', 'P', [rectLoop('r')], 10),
      addSketch('G', XZ),
      polygon('G', 'g', [[45, 8], [50, 8], [50, 12], [45, 12]]),
      { type: 'addPoint', sketch: 'G', id: 'a0', x: 30, y: 0 },
      { type: 'addPoint', sketch: 'G', id: 'a1', x: 30, y: 10 },
      { type: 'addCurve', sketch: 'G', id: 'ax', curve: { type: 'line', a: 'a0', b: 'a1', construction: true } },
      revolve('groove', 'G', lines('g', 4), { type: 'angle', start: 'deg(-20)', angle: 'deg(40)' }, { kind: 'sketchLine', sketch: 'G', line: 'ax' }, 'cut', ['plate']),
      { type: 'addFeature', feature: { id: 'around', name: 'around', suppressed: false, type: 'pattern', source: { type: 'features', features: ['groove'] }, transform: { type: 'circular', axis: { kind: 'sketchLine', sketch: 'G', line: 'ax' }, count: 4, span: { type: 'full' } } } },
    );
    expectAllOk(state);
    const copies = state.evaluation.faceNames.filter((name) => name.feature === 'groove' && name.copy?.[0]?.pattern === 'around');
    expect(new Set(copies.map((name) => name.copy?.[0]?.index))).toEqual(new Set([1, 2, 3]));
  });

  it('a tool above a million triangles is invalidProfile with the count', () => {
    const engine = newEngine();
    engine.load(JSON.stringify({ ...emptyDocument(), settings: { chordTolerance: 0.0002 } }));
    run(engine, addSketch('S', XZ), { type: 'addPoint', sketch: 'S', id: 'c', x: 100, y: 0 }, { type: 'addCurve', sketch: 'S', id: 'tube', curve: { type: 'circle', center: 'c' }, radius: 50 });
    const error = errorOf(engine, revolve('big', 'S', ['tube']), 'big').error;
    expect(error?.code).toBe('invalidProfile');
    expect(error?.message).toMatch(/would have \d+ triangles, more than 1000000\. Raise the chord tolerance/);
  });
});

describe('what the design of D58 left to verify', () => {
  it('a pinched body through the section, the 3MF export and the print check', () => {
    const engine = newEngine();
    const state = run(engine, addSketch('D', XZ), polygon('D', 'm', [[0, 30], [5, 25], [10, 30], [5, 35]]), revolve('pinch', 'D', lines('m', 4)));
    expectAllOk(state);
    // across the pinch and through the axis
    const across = engine.query('section', { plane: { kind: 'base', plane: 'XY' }, offset: 30, bodies: ['pinch'] });
    expect(across.ok).toBe(true);
    const through = engine.query('section', { plane: XZ, bodies: ['pinch'] });
    expect(through.ok).toBe(true);
    const exported = engine.export('3mf', {});
    expect(exported.ok).toBe(true);
    const print = engine.query('print', { bodies: ['pinch'], orientations: [{ by: { up: [0, 0, 1] } }] });
    expect(print.ok).toBe(true);
  });

  it('the time of the analysis of a revolved body', () => {
    const engine = newEngine();
    const started = performance.now();
    const state = run(engine, addSketch('S', XZ), polygon('S', 'p', PULLEY), revolve('R', 'S', lines('p', 8)));
    expect(state.evaluation.bodies.R.edges).toHaveLength(8);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('a fuzz of profiles that touch the axis (in a point, along a line, by an arc), whole and partial turns of either sign', () => {
    let seed = 4242;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 24; trial++) {
      const engine = newEngine();
      const kind = trial % 3;
      const extent: Input<RevolveFeature['extent']> = trial % 4 === 0 ? { type: 'full' } : { type: 'angle', start: random() * 3 - 1.5, angle: (random() < 0.5 ? -1 : 1) * (0.3 + random() * 5.5) };
      const share = extent.type === 'full' ? 1 : Math.abs(extent.angle as number) / (2 * Math.PI);
      const h = 2 + random() * 10;
      const w = 2 + random() * 10;
      let corners: [number, number][];
      let commands: Command[];
      let exact: number;
      if (kind === 0) {
        // a triangle with a corner on the axis (a point)
        corners = [[0, 0], [w, -h / 2], [w, h / 2]];
        commands = [polygon('S', 'p', corners), revolve('R', 'S', lines('p', 3), extent)];
        exact = 2 * Math.PI * moment(corners) * share;
      } else if (kind === 1) {
        // a trapezium with a side on the axis (a line)
        corners = [[0, 0], [w, 0], [w / 2, h], [0, h]];
        commands = [polygon('S', 'p', corners), revolve('R', 'S', lines('p', 4), extent)];
        exact = 2 * Math.PI * moment(corners) * share;
      } else {
        // a half disc on the axis (an arc that reaches it at its ends)
        commands = [halfDisc('S', 'b', 0, 0, w), revolve('R', 'S', ['ba', 'bd'], extent)];
        exact = (4 / 3) * Math.PI * w * w * w * share;
      }
      const state = run(engine, addSketch('S', XZ), ...commands);
      expectAllOk(state);
      const body = state.evaluation.bodies.R;
      expect(closed(body.solid), `trial ${trial}`).toBe(true);
      expect(body.volume, `trial ${trial}`).toBeGreaterThan(0);
      // within the chord tolerance over the surface, which is less than the turned outline of a box w × h
      expect(Math.abs(body.volume - exact), `trial ${trial}`).toBeLessThan(0.01 * 2 * Math.PI * w * (2 * w + 2 * h) * share);
      expect(takenByKernel(engine, 'R'), `trial ${trial}`).toBe(true);
    }
  });
});

// Where 4a meets what was merged before it (D58 with D55 and D56): a revolved tool moved outwards
// by the clearance of a combine (its spheres and tori move along their exact surfaces), a revolve
// onto an imported body, and the copies of a revolved body in the parts list.
describe('where the revolve meets 3b and 3d', () => {
  const block = (engine: Engine) => run(engine, addSketch('P', XY), rectangle('P', 'r', -30, -30, 60, 60, null), addExtrude('block', 'P', [rectLoop('r')], -20));
  const combine = (id: Id, tool: Id, clearance: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'combine', operation: 'difference', target: 'block', tools: [tool], keepTools: true, clearance } });
  const pocketSurface = (state: EngineState, combineId: Id, tool: Id, curve: Id): Surface | undefined => {
    const name = { ...side(tool, curve), copy: [{ pattern: combineId, index: 1 }] };
    const face = state.evaluation.faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name));
    return face < 0 ? undefined : state.evaluation.faceSurfaces[face];
  };

  it('a ball sunk into a block with a clearance: the pocket is a sphere of the radius grown by it', () => {
    const engine = newEngine();
    block(engine);
    run(engine, addSketch('S', XZ), halfDisc('S', 'b', 0, 0, 10), revolve('ball', 'S', ['ba', 'bd']));
    const state = run(engine, combine('K', 'ball', 0.5));
    expect(state.evaluation.features.K.status).toBe('ok');
    expect(pocketSurface(state, 'K', 'ball', 'ba')).toEqual({ kind: 'sphere', center: [0, 0, 0], radius: 10.5 });
    const pocket = (2 / 3) * Math.PI * 10.5 ** 3;
    expect(Math.abs(60 * 60 * 20 - state.evaluation.bodies.block.volume - pocket) / pocket).toBeLessThan(5e-3);
    // the rim of the pocket on the top of the block: a circle of radius 10.5
    const rims = state.evaluation.bodies.block.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'ball'));
    expect(rims.map((edge) => edge.kind)).toEqual(['circle']);
  });

  it('an O-ring half sunk into a block: the groove is a torus of the minor radius grown; a ring whose hole the clearance fills is refused', () => {
    const engine = newEngine();
    block(engine);
    run(engine, addSketch('S', XZ), { type: 'addPoint', sketch: 'S', id: 'c', x: 15, y: 0 }, { type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 2 }, revolve('ring', 'S', ['k']));
    const state = run(engine, combine('K', 'ring', 0.3));
    expect(state.evaluation.features.K.status).toBe('ok');
    expect(pocketSurface(state, 'K', 'ring', 'k')).toEqual({ kind: 'torus', center: [0, 0, 0], axis: [0, 0, 1], majorRadius: 15, minorRadius: 2.3 });
    const groove = Math.PI * Math.PI * 15 * 2.3 * 2.3;
    expect(Math.abs(60 * 60 * 20 - state.evaluation.bodies.block.volume - groove) / groove).toBeLessThan(5e-3);
    // both rims of the groove lie between the same two faces: one edge of two circles, `other`
    // (a known limit), so no rim of a moved torus has to choose between its two circles here
    const rims = state.evaluation.bodies.block.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'ring'));
    expect(rims.map((edge) => edge.kind)).toEqual(['other']);
    // a ring of R 3 and r 2.8: its hole closes at a clearance of 0.5
    run(engine, addSketch('T', XZ), { type: 'addPoint', sketch: 'T', id: 'tc', x: 3, y: 0 }, { type: 'addCurve', sketch: 'T', id: 'tk', curve: { type: 'circle', center: 'tc' }, radius: 2.8 }, revolve('fat', 'T', ['tk']));
    const fat = errorOf(engine, combine('F', 'fat', 0.5), 'F');
    expect(fat.error?.code).toBe('invalidClearance');
    expect(fat.error?.message).toMatch(/closes at a clearance of 0\.5 mm/);
  });

  it('an ogive (a torus with a negative major radius and a tip on the axis) moved by a clearance', () => {
    const engine = newEngine();
    block(engine);
    const state = run(
      engine,
      addSketch('S', XZ),
      { type: 'addPoint', sketch: 'S', id: 'a', x: 0, y: -10 },
      { type: 'addPoint', sketch: 'S', id: 'b', x: 0, y: 10 },
      { type: 'addPoint', sketch: 'S', id: 'c', x: -15, y: 0 },
      { type: 'addCurve', sketch: 'S', id: 'arc', curve: { type: 'arc', center: 'c', start: 'a', end: 'b' } },
      { type: 'addCurve', sketch: 'S', id: 'axis', curve: { type: 'line', a: 'b', b: 'a' } },
      revolve('ogive', 'S', ['arc', 'axis']),
      combine('K', 'ogive', 0.5),
    );
    expect(state.evaluation.features.K.status).toBe('ok');
    expect(pocketSurface(state, 'K', 'ogive', 'arc')).toMatchObject({ kind: 'torus', majorRadius: -15, minorRadius: Math.hypot(15, 10) + 0.5 });
    // the tip moved along the axis to 0.5 from the moved surface: the bottom of the pocket at
    // z = −(√(18.03² − 15²)) = −10.0…, below the tip of the ogive by more than the clearance
    const p = state.evaluation.bodies.block.solid.positions;
    const onAxis = Array.from({ length: p.length / 3 }, (_, i) => i).filter((i) => Math.hypot(p[3 * i], p[3 * i + 1]) < 1e-3 && p[3 * i + 2] > -19);
    const lowest = Math.min(...onAxis.map((i) => p[3 * i + 2]));
    expect(lowest).toBeCloseTo(-Math.sqrt((Math.hypot(15, 10) + 0.5) ** 2 - 225), 3);
  });

  it('a revolve that cuts or adds to an imported body is importedTarget', () => {
    const engine = newEngine();
    block(engine);
    const mesh = engine.getState().evaluation.bodies.block.solid;
    run(engine, { type: 'addMesh', id: 'cast', mesh: storedMesh({ positions: mesh.positions, triangles: mesh.triangles }) }, { type: 'addFeature', feature: { id: 'M', name: 'M', suppressed: false, type: 'mesh', mesh: 'cast', placement: { frame: { kind: 'base', plane: 'XY' }, z: 100 } } });
    run(engine, addSketch('S', XZ), halfDisc('S', 'b', 0, 100, 10));
    for (const operation of ['cut', 'add'] as const) {
      const error = errorOf(engine, revolve(`R${operation}`, 'S', ['ba', 'bd'], undefined, Z, operation, ['M']), `R${operation}`).error;
      expect(error).toMatchObject({ code: 'importedTarget', refs: ['M'] });
    }
  });

  it('the copies of a revolved body made by a pattern are one row of the parts list', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XZ),
      polygon('S', 'p', PULLEY),
      revolve('pulley', 'S', lines('p', 8)),
      { type: 'addFeature', feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pulley' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 50 } } } },
      { type: 'addFeature', feature: { id: 'flip', name: 'flip', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pulley' }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'XY' } } } },
    );
    expect(shapeOrigin(engine.getState().evaluation.bodies['row/2'].solid).solid).toBe(engine.getState().evaluation.bodies.pulley.solid);
    const list = engine.query('partsList', {});
    if (!list.ok) throw new Error(list.error.message);
    const rows = list.result.printed.map((row) => `${row.count} × ${row.bodies.join(', ')}${row.mirrored ? ' mirrored' : ''}${row.copyOf ? ` of ${row.copyOf}` : ''}`);
    expect(rows).toEqual(['3 × pulley, row/1, row/2', '1 × flip/1 mirrored of pulley']);
  });
});
