// The chamfer and the fillet of edges (D63, package 4b of D36) against the real adapters: the cases
// the design measured ("Measured", A, B, D, E, F and H) as assertions, the ends of an edge, the
// faces and edges of the result, and every refusal the two codes name.
import { type Command, type EdgeName, type EngineState, type FaceName, type Id, type SketchFeature, type Surface, faceKey, freshIds, sketchTool } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { BOX_BOTTOM, BOX_TOP, BOX_TOP_FRONT, BOX_VERTICAL, BRACKET, STEPPED, TILTED, box, boxWithBoss, boxWithHole, cap, chamfer, edge, fillet, polygonLoop, polygonSketch, profileXZ, side } from './blend-kit';
import { XY, addExtrude, addSketch, batch, circle, newEngine, onFace, rectangle, rectLoop, run } from './kit';

interface Outcome {
  status: string;
  code?: string;
  message?: string;
  refs: unknown[];
  change: number; // the volume of E after less before
  state: EngineState;
}
// The feature of `command` applied in a preview to a copy of the model of `state`.
function apply(state: EngineState, command: Command, body = 'E', chordTolerance?: number): Outcome {
  const engine = newEngine();
  const document = chordTolerance === undefined ? state.document : { ...state.document, settings: { ...state.document.settings, chordTolerance } };
  const loaded = engine.load(JSON.stringify(document));
  if (!loaded.ok) throw new Error(loaded.error.message);
  const before = engine.getState().evaluation.bodies[body].volume;
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  const id = (command as { feature: { id: Id } }).feature.id;
  const outcome = result.state.evaluation.features[id];
  return { status: outcome.status, code: outcome.error?.code, message: outcome.error?.message, refs: outcome.error?.refs ?? [], change: result.state.evaluation.bodies[body].volume - before, state: result.state };
}
const near = (value: number, expected: number, tolerance = 1e-3) => expect(Math.abs(value - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(tolerance);
const ok = (outcome: Outcome): Outcome => {
  expect(outcome.message ?? '', outcome.message).toBe('');
  expect(outcome.status).toBe('ok');
  return outcome;
};
const sameEdge = (ref: unknown, name: EdgeName): boolean => typeof ref === 'object' && ref !== null && 'a' in ref && faceKey((ref as EdgeName).a) === faceKey(name.a) && faceKey((ref as EdgeName).b) === faceKey(name.b);
function surfaceOf(state: EngineState, body: Id, name: FaceName): Surface | undefined {
  const face = state.evaluation.bodies[body].faces.find((f) => faceKey(state.evaluation.faceNames[f.id]) === faceKey(name));
  return face ? state.evaluation.faceSurfaces[face.id] : undefined;
}
const facesOf = (state: EngineState, body = 'E'): string[] => state.evaluation.bodies[body].faces.map((face) => faceKey(state.evaluation.faceNames[face.id]));
const edgesWith = (state: EngineState, name: FaceName, body = 'E') => state.evaluation.bodies[body].edges.filter((e) => [e.name.a, e.name.b].some((face) => faceKey(face) === faceKey(name)));

// The box with its four vertical corners rounded by the fillet of the sketch.
function rounded(radius: number): EngineState {
  const engine = newEngine();
  box(engine);
  for (const corner of ['r1', 'r2', 'r3', 'r4']) {
    const state = engine.getState();
    const context = { sketch: state.document.features.find((f) => f.id === 's') as SketchFeature, result: state.evaluation.features.s.sketch!, parameters: state.evaluation.parameters, document: state.document };
    const made = sketchTool('fillet', context, { corner, radius }, freshIds(state.document, `f${corner}_`));
    if (!made.ok) throw new Error(made.message);
    run(engine, batch(...made.commands));
  }
  return engine.getState();
}
const topLoop = (state: EngineState): EdgeName[] => state.evaluation.bodies.E.edges.filter((e) => [e.name.a, e.name.b].some((name) => name.role === 'endCap')).map((e) => e.name);

describe('straight edges (the design, "Measured", A)', () => {
  const b = box();
  it('the top-front edge of a box: a chamfer takes the exact prism, a fillet the corner less the quarter circle within the polygon', () => {
    const c = ok(apply(b, chamfer('c', 'E', [BOX_TOP_FRONT], 3)));
    near(c.change, -270);
    expect(c.state.evaluation.features.c.facts).toEqual({ 'setback/0': 3, 'cut/0': true });
    const f = ok(apply(b, fillet('c', 'E', [BOX_TOP_FRONT], 4)));
    near(f.change, -207.228, 1e-2);
    near(f.change, -(16 - 4 * Math.PI) * 60, 1.3);
    for (const [r, taken] of [
      [0.5, 3.353],
      [10, 1290.711],
      [19.9, 5104.989],
    ]) near(ok(apply(b, fillet('c', 'E', [BOX_TOP_FRONT], r))).change, -taken, 1e-2);
  });

  it('the faces: a plane for a chamfer, a cylinder for a fillet; the faces of the box kept; the edges of the result', () => {
    const c = ok(apply(b, chamfer('c', 'E', [BOX_TOP_FRONT], 3)));
    const plane = surfaceOf(c.state, 'E', { feature: 'c', role: 'chamfer', edge: 0 });
    expect(plane?.kind).toBe('plane');
    if (plane?.kind === 'plane') expect(Math.abs(plane.normal[1] * plane.normal[2])).toBeCloseTo(0.5, 9);
    expect(facesOf(c.state)).toEqual(expect.arrayContaining(facesOf(b)));
    // the chamfer meets the top, the front and the two sides in straight edges
    expect(edgesWith(c.state, { feature: 'c', role: 'chamfer', edge: 0 }).map((e) => e.kind)).toEqual(['line', 'line', 'line', 'line']);
    const f = ok(apply(b, fillet('c', 'E', [BOX_TOP_FRONT], 4)));
    const cylinder = surfaceOf(f.state, 'E', { feature: 'c', role: 'fillet', edge: 0 });
    expect(cylinder).toMatchObject({ kind: 'cylinder', radius: 4 });
    if (cylinder?.kind === 'cylinder') {
      near(Math.abs(cylinder.axis[0]), 1, 1e-9);
      near(cylinder.origin[1], 4, 1e-9);
      near(cylinder.origin[2], 16, 1e-9);
    }
    // a plane touching a cylinder is `other`; a plane across it a circle
    const kinds = edgesWith(f.state, { feature: 'c', role: 'fillet', edge: 0 }).map((e) => e.kind).sort();
    expect(kinds).toEqual(['circle', 'circle', 'other', 'other']);
  });

  it('a sketch on a chamfer: its origin where the chamfer meets face a at the end the projection of the edge calls a, Y along the edge', () => {
    const engine = newEngine();
    box(engine);
    const state = run(engine, chamfer('c', 'E', [BOX_TOP_FRONT], 3), addSketch('on', onFace('E', { feature: 'c', role: 'chamfer', edge: 0 })));
    // a = E/endCap (outward +Z), b = E/side/ra (outward −Y): n_a × n_b = +X, the end at x = 0
    const frame = state.evaluation.features.on.plane!;
    [0, 3, 20].forEach((value, i) => near(frame.origin[i], value, 1e-9));
    [1, 0, 0].forEach((value, i) => near(frame.y[i], value, 1e-12));
    [0, -Math.SQRT1_2, Math.SQRT1_2].forEach((value, i) => near(frame.normal[i], value, 1e-12));
  });

  it('a fillet larger than the face is wide: blendDoesNotFit, the face named', () => {
    const outcome = apply(b, fillet('c', 'E', [BOX_TOP_FRONT], 25));
    expect(outcome.code).toBe('blendDoesNotFit');
    expect(outcome.refs[1]).toEqual(side('E', 'ra'));
    expect(outcome.message).toMatch(/the face in refs would vanish/);
    expect(outcome.change).toBe(0);
  });

  it('the inner corner of an L is concave: material added, the caps become the end faces', () => {
    const L = profileXZ(BRACKET);
    const inner = [edge(side('E', 'l2'), side('E', 'l3'))];
    const c = ok(apply(L, chamfer('c', 'E', inner, 3)));
    near(c.change, 180);
    expect(c.state.evaluation.features.c.facts).toEqual({ 'setback/0': 3, 'cut/0': false });
    near(ok(apply(L, fillet('c', 'E', inner, 4))).change, 138.152);
    // the start cap and the end cap of the extrusion grew by the triangle of the chamfer
    expect(facesOf(c.state)).not.toContain('c/chamfer/1');
    expect(edgesWith(c.state, { feature: 'c', role: 'chamfer', edge: 0 }).map((e) => faceKey(e.name.a === undefined ? e.name.b : [e.name.a, e.name.b].find((n) => n.feature !== 'c')!)).sort()).toEqual(['E/endCap', 'E/side/l2', 'E/side/l3', 'E/startCap']);
  });

  it('a step: the low top edge ends at the riser, whose face grows; the foot of the riser is concave', () => {
    const S = profileXZ(STEPPED);
    const low = ok(apply(S, chamfer('c', 'E', [edge(side('E', 'l4'), cap('E', 'startCap'))], 3)));
    near(low.change, -135);
    near(ok(apply(S, fillet('c', 'E', [edge(side('E', 'l4'), cap('E', 'startCap'))], 4))).change, -103.614);
    const foot = [edge(side('E', 'l3'), side('E', 'l4'))];
    near(ok(apply(S, chamfer('c', 'E', foot, 3))).change, 180);
    near(ok(apply(S, fillet('c', 'E', foot, 4))).change, 138.152);
  });

  it('a block with a tilted end: the top edge ends in the tilted plane, the tilted edge itself at 116.6°', () => {
    const T = profileXZ(TILTED);
    near(ok(apply(T, chamfer('c', 'E', [edge(side('E', 'l2'), cap('E', 'startCap'))], 3))).change, -272.25);
    near(ok(apply(T, chamfer('c', 'E', [edge(side('E', 'l1'), side('E', 'l2'))], 3))).change, -160.997);
    near(ok(apply(T, fillet('c', 'E', [edge(side('E', 'l1'), side('E', 'l2'))], 4))).change, -41.757);
  });
});

describe('circular edges (the design, "Measured", B)', () => {
  it('the rim of a hole and of a boss, convex and concave: cones and tori whose rims are circles', () => {
    const h = boxWithHole();
    const rim = edge(cap('E'), side('H', 'h'));
    const c = ok(apply(h, chamfer('c', 'E', [rim], 4.5)));
    // Pappus: the triangle 4.5 × 4.5 / 2 at the radius 5 + 1.5
    near(c.change, -2 * Math.PI * (5 + 1.5) * 10.125, 0.5);
    near(c.change, -413.906, 1e-2);
    const cone = surfaceOf(c.state, 'E', { feature: 'c', role: 'chamfer', edge: 0 });
    expect(cone).toMatchObject({ kind: 'cone' });
    if (cone?.kind === 'cone') near(cone.halfAngle, Math.PI / 4, 1e-9);
    expect(edgesWith(c.state, { feature: 'c', role: 'chamfer', edge: 0 }).map((e) => e.kind)).toEqual(['circle', 'circle']);
    for (const r of [0.2, 1, 4]) ok(apply(h, fillet('c', 'E', [rim], r)));
    const boss = boxWithBoss();
    for (const s of [0.2, 1, 4]) ok(apply(boss, chamfer('c', 'E', [edge(cap('B'), side('B', 'b'))], s)));
    const foot = ok(apply(boss, fillet('c', 'E', [edge(cap('E'), side('B', 'b'))], 2)));
    expect(foot.change).toBeGreaterThan(0);
    expect(foot.state.evaluation.features.c.facts).toMatchObject({ 'cut/0': false });
    const torus = surfaceOf(foot.state, 'E', { feature: 'c', role: 'fillet', edge: 0 });
    expect(torus).toMatchObject({ kind: 'torus', majorRadius: 10, minorRadius: 2 });
    expect(edgesWith(foot.state, { feature: 'c', role: 'fillet', edge: 0 }).map((e) => e.kind)).toEqual(['circle', 'circle']);
  });

  it('a fillet whose setback reaches the axis is refused; the start of a whole circle does not depend on the mesh', () => {
    const boss = boxWithBoss();
    const outcome = apply(boss, fillet('c', 'E', [edge(cap('B'), side('B', 'b'))], 8));
    expect(outcome.code).toBe('blendDoesNotFit');
    expect(outcome.message).toMatch(/reaches the axis/);
    // the same rim on a boss built in another order of its segments: the same tool
    const a = ok(apply(boss, chamfer('c', 'E', [edge(cap('B'), side('B', 'b'))], 1)));
    const again = ok(apply(boss, chamfer('c', 'E', [edge(cap('B'), side('B', 'b'))], 1)));
    expect(again.state.evaluation.bodies.E.solid.positions).toEqual(a.state.evaluation.bodies.E.solid.positions);
  });

  it('an arc of a partial revolve ends at its caps, planes through the axis; an arc cut by a slot runs out past its sides (D67), an arc at a tilted plane is refused', () => {
    const engine = newEngine();
    const XZ = { kind: 'base', plane: 'XZ' } as const;
    run(engine, addSketch('s', XZ), polygonSketch('s', [[0, 0], [20, 0], [20, 10], [0, 10]]), {
      type: 'addFeature',
      feature: { id: 'E', name: 'E', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: polygonLoop(4) }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'angle', start: 0, angle: Math.PI / 2 }, operation: 'new' },
    });
    const quarter = engine.getState();
    const rimEdge = edge(side('E', 'l1'), side('E', 'l2'));
    const c = ok(apply(quarter, chamfer('c', 'E', [rimEdge], 2)));
    // a quarter of the ring of the triangle 2 × 2 / 2 at the radius 20 − 2/3
    near(c.change, -(Math.PI / 2) * (20 - 2 / 3) * 2, 0.05);
    // the box with a hole and a slot across its rim: D63 refused the arc's end at the slot's sides,
    // planes off its axis; they are parallel to it, so the chamfer runs out past them (D67) and
    // takes what the chamfer made before the slot takes
    const slot = (engine: ReturnType<typeof newEngine>) => run(engine, addSketch('u', onFace('E', cap('E'))), rectangle('u', 'q', 34, 19, 10, 2, null), addExtrude('U', 'u', [rectLoop('q')], -3, 'cut', 'E'));
    const engine2 = newEngine();
    boxWithHole(5, engine2);
    const cut = slot(engine2);
    const runOut = ok(apply(cut, chamfer('c', 'E', [edge(cap('E'), side('H', 'h'))], 0.5)));
    const engine3 = newEngine();
    boxWithHole(5, engine3);
    run(engine3, chamfer('c', 'E', [edge(cap('E'), side('H', 'h'))], 0.5));
    near(runOut.state.evaluation.bodies.E.volume, slot(engine3).evaluation.bodies.E.volume, 0.01);
    // an arc that ends at a plane neither through nor parallel to its axis: the rim of a hole that
    // breaks into the chamfer of the box's top-front edge
    const engine4 = newEngine();
    box(engine4);
    const tilted = run(engine4, chamfer('k', 'E', [BOX_TOP_FRONT], 3), addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 2, 4), addExtrude('H', 't', [['h']], -20, 'cut', 'E'));
    const off = apply(tilted, chamfer('c', 'E', [edge(cap('E'), side('H', 'h'))], 0.5));
    expect(off.code).toBe('unsupportedEdge');
    expect(off.message).toMatch(/does not hold its axis and is not parallel to it/);
    expect(off.refs.some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && faceKey(ref as FaceName) === 'k/chamfer/0')).toBe(true);
  });
});

describe('several edges, corners (the design, "Measured", D, F and H)', () => {
  const b = box();
  it('the four top edges, with the four vertical ones, all twelve: chamfers meet exactly, fillets leave a crease', () => {
    near(ok(apply(b, chamfer('c', 'E', BOX_TOP, 3))).change, -864);
    near(ok(apply(b, chamfer('c', 'E', [...BOX_TOP, ...BOX_VERTICAL], 3))).change, -1179);
    near(ok(apply(b, chamfer('c', 'E', [...BOX_TOP, ...BOX_VERTICAL, ...BOX_BOTTOM], 3))).change, -1998);
    near(ok(apply(b, fillet('c', 'E', BOX_TOP, 4))).change, -665.984);
    near(ok(apply(b, fillet('c', 'E', [...BOX_TOP, ...BOX_VERTICAL], 4))).change, -907.683);
    const twelve = ok(apply(b, fillet('c', 'E', [...BOX_TOP, ...BOX_VERTICAL, ...BOX_BOTTOM], 4)));
    near(twelve.change, -1539.061);
    expect(facesOf(twelve.state).filter((key) => key.startsWith('c/fillet/'))).toHaveLength(12);
  });

  it('an L: a concave inner edge and two convex outer ones in one feature', () => {
    const L = profileXZ(BRACKET);
    const edges = [edge(side('E', 'l2'), side('E', 'l3')), edge(side('E', 'l3'), side('E', 'l4')), edge(side('E', 'l1'), side('E', 'l2'))];
    const c = ok(apply(L, chamfer('c', 'E', edges, 2)));
    near(c.change, -80);
    expect(c.state.evaluation.features.c.facts).toEqual({ 'setback/0': 2, 'cut/0': false, 'setback/1': 2, 'cut/1': true, 'setback/2': 2, 'cut/2': true });
    near(ok(apply(L, fillet('c', 'E', edges, 2))).change, 16965.305 - 17000);
  });

  it('a convex and a concave edge that meet at a vertex: refused, both named', () => {
    const S = profileXZ(STEPPED);
    const convex = edge(side('E', 'l4'), cap('E', 'startCap'));
    const concave = edge(side('E', 'l3'), side('E', 'l4'));
    const outcome = apply(S, chamfer('c', 'E', [convex, edge(side('E', 'l3'), cap('E', 'startCap')), concave], 2));
    expect(outcome.code).toBe('unsupportedEdge');
    expect(outcome.message).toMatch(/a convex and a concave edge/);
    expect(outcome.refs.some((ref) => sameEdge(ref, concave))).toBe(true);
  });

  it('two edges at a reflex corner end in their mitre; the whole top loop of an L; a pentagon; the floor loop of a cavity with thin walls', () => {
    const engine = newEngine();
    const L = run(engine, addSketch('s', XY), polygonSketch('s', [[0, 0], [60, 0], [60, 20], [20, 20], [20, 50], [0, 50]]), addExtrude('E', 's', [polygonLoop(6)], 20));
    const reflex = [edge(cap('E'), side('E', 'l2')), edge(cap('E'), side('E', 'l3'))];
    near(ok(apply(L, chamfer('c', 'E', reflex, 3))).change, -324);
    near(ok(apply(L, fillet('c', 'E', reflex, 3))).change, -138.858);
    const loop = [0, 1, 2, 3, 4, 5].map((i) => edge(cap('E'), side('E', `l${i}`)));
    near(ok(apply(L, chamfer('c', 'E', loop, 3))).change, -954);
    near(ok(apply(L, fillet('c', 'E', loop, 3))).change, -417.689);
    const P = run(newEngine(), addSketch('s', XY), polygonSketch('s', [[0, 0], [50, 0], [50, 30], [30, 15], [10, 40]]), addExtrude('E', 's', [polygonLoop(5)], 15));
    near(ok(apply(P, chamfer('c', 'E', [0, 1, 2, 3, 4].map((i) => edge(cap('E'), side('E', `l${i}`))), 2))).change, -342.278);
    const engine3 = newEngine();
    box(engine3);
    const cavity = run(engine3, addSketch('t', onFace('E', cap('E'))), polygonSketch('t', [[2, 2], [58, 2], [58, 38], [2, 38]]), addExtrude('C', 't', [polygonLoop(4)], -18, 'cut', 'E'));
    const floor = [0, 1, 2, 3].map((i) => edge(cap('C'), side('C', `l${i}`)));
    near(ok(apply(cavity, fillet('c', 'E', floor, 3))).change, 347.624);
    near(ok(apply(cavity, chamfer('c', 'E', floor, 3))).change, 792);
  });

  it('a concave fillet in the corner of walls 2 thick does not pierce them: the overshoot into the body is four chord tolerances', () => {
    const thin = profileXZ([[0, 0], [60, 0], [60, 2], [2, 2], [2, 30], [0, 30]]);
    for (const [size, added] of [
      [1, 8.786],
      [2.5, 54.128],
      [4, 138.152],
    ]) near(ok(apply(thin, fillet('c', 'E', [edge(side('E', 'l2'), side('E', 'l3'))], size))).change, added);
  });

  it('two convex edges at different angles at a convex corner end in the plane of the other face', () => {
    const edges: EdgeName[] = [edge(side('E', 'l2'), cap('E', 'startCap')), edge(side('E', 'l2'), side('E', 'l1'))];
    const T = profileXZ(TILTED);
    near(ok(apply(T, chamfer('c', 'E', edges, 3))).change, -424.772);
    near(ok(apply(T, fillet('c', 'E', edges, 3))).change, -140.003);
    const T2 = profileXZ([[0, 0], [80, 0], [60, 20], [0, 20]]);
    near(ok(apply(T2, chamfer('c', 'E', edges, 3))).change, -394.483);
    near(ok(apply(T2, fillet('c', 'E', edges, 3))).change, -125.705);
  });

  it('two concave edges at different angles: refused, both named', () => {
    // a channel along Y with one wall leaning, closed at its far end by a wall W
    const engine = newEngine();
    const XZ = { kind: 'base', plane: 'XZ' } as const;
    profileXZ([[0, 0], [60, 0], [60, 20], [50, 20], [45, 5], [10, 5], [10, 20], [0, 20]], 40, engine);
    const closed = run(engine, addSketch('w', XZ), rectangle('w', 'q', 0, 0, 60, 20, null), {
      type: 'addFeature',
      feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'w', regions: [{ outerLoop: rectLoop('q') }] }, extent: { type: 'distance', start: -40, distance: -5 }, operation: 'add', targets: ['E'] },
    });
    const leaning = edge(side('E', 'l3'), side('E', 'l4'));
    const end = edge(side('E', 'l4'), cap('W', 'startCap'));
    ok(apply(closed, fillet('c', 'E', [leaning], 1)));
    const outcome = apply(closed, fillet('c', 'E', [leaning, end], 1));
    expect(outcome.code).toBe('unsupportedEdge');
    expect(outcome.message).toMatch(/meet at a vertex in a way this feature cannot join/);
    expect(outcome.refs.some((ref) => sameEdge(ref, end))).toBe(true);
  });
});

describe('the ends of an edge', () => {
  it('a chain of tangent edges in one feature: the lines and the arcs of a rounded box; the lines alone name an arc', () => {
    const r = rounded(6);
    const loop = topLoop(r);
    expect(loop).toHaveLength(8);
    for (const [kind, size, taken] of [
      ['chamfer', 1, 93.654],
      ['fillet', 2, 161.75],
      ['fillet', 5.9, 1359.01],
    ] as const) {
      const outcome = ok(apply(r, (kind === 'chamfer' ? chamfer : fillet)('c', 'E', loop, size)));
      near(outcome.change, -taken, 0.01);
    }
    const lines = loop.filter((name) => ['ra', 'rb', 'rc', 'rd'].includes((name.b as { curve: string }).curve));
    const half = apply(r, fillet('c', 'E', lines, 2));
    expect(half.code).toBe('unsupportedEdge');
    expect(half.message).toMatch(/continues smoothly into the second edge in refs; add it to this feature/);
    expect(faceKey((half.refs[1] as EdgeName).b)).toMatch(/^E\/side\/fr\d_c1$/);
  });

  it('a chain at a chord tolerance near the band of the kernel: the result is right or refused, never wrong', () => {
    const r = rounded(6);
    const loop = topLoop(r);
    // At 0.001 a lift of 1.5 chord tolerances (about one band) left a vertex of the chamfer of a line
    // 0.7 mm off it without an error of the kernel. The lift is now at least two bands, and a vertex of
    // a blend off its surface is a kernelFailure.
    near(ok(apply(r, chamfer('c', 'E', loop, 2), 'E', 0.001)).change, -370.986, 0.01);
    near(ok(apply(r, chamfer('c', 'E', loop, 3), 'E', 0.001)).change, -825.314, 0.01);
    for (const [size, exact] of [[4, -1450.491], [5, -2240.233]]) {
      const out = apply(r, chamfer('c', 'E', loop, size), 'E', 0.001);
      if (out.code === undefined) near(out.change, exact, 0.01);
      else expect(out.code).toBe('kernelFailure');
    }
  });

  it('a fillet that lies within the lift of its edge is too small for the chord tolerance', () => {
    const engine = newEngine();
    const XZ = { kind: 'base', plane: 'XZ' } as const;
    run(engine, addSketch('s', XZ), polygonSketch('s', [[5, 0], [20, 0], [20, 6], [17, 15], [5, 15]]), {
      type: 'addFeature',
      feature: { id: 'E', name: 'E', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: polygonLoop(5) }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'full' }, operation: 'new' },
    });
    const ring = engine.getState();
    // the cylinder and the cone meet at 162°: a fillet of 0.3 lies 0.004 mm from the edge
    const small = apply(ring, fillet('c', 'E', [edge(side('E', 'l1'), side('E', 'l2'))], 0.3));
    expect(small.code).toBe('blendDoesNotFit');
    expect(small.message).toMatch(/too small for the chord tolerance/);
    ok(apply(ring, fillet('c', 'E', [edge(side('E', 'l1'), side('E', 'l2'))], 3)));
  });

  it('an edge whose end has two faces that are not a seam: refused; a straight edge that ends at a round face runs out into it (D67)', () => {
    const engine = newEngine();
    box(engine);
    // a block flush with the front, on the left half of the top
    const block = run(engine, addSketch('t', onFace('E', cap('E'))), rectangle('t', 'k', 0, 0, 30, 20, null), addExtrude('K', 't', [rectLoop('k')], 5, 'add', 'E'));
    const four = apply(block, chamfer('c', 'E', [BOX_TOP_FRONT], 1));
    expect(four.code).toBe('unsupportedEdge');
    expect(four.message).toMatch(/which are not one face it ends at nor a seam/);
    const engine2 = newEngine();
    box(engine2);
    const holed = run(engine2, addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 0, 4), addExtrude('H', 't', [['h']], -20, 'cut', 'E'));
    // D63 refused the straight edge's end at the hole; it runs out into the hole now (D67), equal to
    // the chamfer made before the hole
    const round = ok(apply(holed, chamfer('c', 'E', [BOX_TOP_FRONT], 1)));
    const engine3 = newEngine();
    box(engine3);
    run(engine3, chamfer('c', 'E', [BOX_TOP_FRONT], 1));
    const reference = run(engine3, addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 0, 4), addExtrude('H', 't', [['h']], -20, 'cut', 'E'));
    near(round.state.evaluation.bodies.E.volume, reference.evaluation.bodies.E.volume, 2e-3);
  });

  it('an edge cut into two pieces gets a tool per piece; the ends of a short piece that meet within the chamfer are refused', () => {
    const engine = newEngine();
    box(engine);
    const notched = run(engine, addSketch('t', onFace('E', cap('E'))), rectangle('t', 'n', 25, -1, 10, 6, null), addExtrude('N', 't', [rectLoop('n')], -4, 'cut', 'E'));
    const two = ok(apply(notched, chamfer('c', 'E', [BOX_TOP_FRONT], 2)));
    near(two.change, -2 * 50, 1e-3);
    const trapezoid = profileXZ([[0, 0], [20, 0], [11, 10], [9, 10]]);
    const short = apply(trapezoid, chamfer('c', 'E', [edge(side('E', 'l2'), cap('E', 'startCap'))], 3));
    expect(short.code).toBe('blendDoesNotFit');
    expect(short.message).toMatch(/the ends of a piece of the edge meet within the chamfer/);
  });
});

describe('what is refused', () => {
  it('an edge of the kind other, faces nearly flat, an edge the body does not have', () => {
    const engine = newEngine();
    box(engine);
    // a hole through the front face: the front meets the bore along two lines on a cylinder
    const holed = run(engine, addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 0, 4), addExtrude('H', 't', [['h']], -20, 'cut', 'E'));
    const other = apply(holed, chamfer('c', 'E', [edge(side('E', 'ra'), side('H', 'h'))], 1));
    expect(other.code).toBe('unsupportedEdge');
    expect(other.message).toMatch(/of the kind other between a plane and a cylinder/);
    const flat = profileXZ([[0, 0], [60, 0], [60, 10], [30, 10.1], [0, 10]]);
    const nearlyFlat = apply(flat, chamfer('c', 'E', [edge(side('E', 'l2'), side('E', 'l3'))], 1));
    expect(nearlyFlat.code).toBe('unsupportedEdge');
    expect(nearlyFlat.message).toMatch(/too sharp or too flat/);
    const missing = apply(box(), chamfer('c', 'E', [edge(cap('E'), cap('E', 'startCap'))], 1));
    expect(missing.code).toBe('brokenReference');
  });

  it('a piece of the body swallowed by the overshoot: the volume check', () => {
    const engine = newEngine();
    box(engine, 20);
    // a cube of 1 mm³ apart from the box, within the overshoot of a chamfer of 2 past the top-front
    // edge, 20 long: the bound is 0.5 × 0.01 × 2 × 2 × 20 + 0.001 = 0.401 mm³
    const islanded = run(engine, addSketch('t', XY), rectangle('t', 'i', 5, -1.5, 1, 1, null), {
      type: 'addFeature',
      feature: { id: 'I', name: 'I', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 't', regions: [{ outerLoop: rectLoop('i') }] }, extent: { type: 'distance', start: 20.5, distance: 1 }, operation: 'add', targets: ['E'] },
    });
    const outcome = apply(islanded, chamfer('c', 'E', [BOX_TOP_FRONT], 2));
    expect(outcome.code).toBe('blendDoesNotFit');
    expect(outcome.message).toMatch(/more than the chamfers and fillets hold/);
  });

  it('the foot of a boss whose ring overhangs the edge of the plate; a boss that stands out over it', () => {
    const engine = newEngine();
    box(engine);
    const boss = run(engine, addSketch('t', onFace('E', cap('E'))), circle('t', 'b', 30, 9, 8), { type: 'addFeature', feature: { id: 'B', name: 'B', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 't', regions: [{ outerLoop: ['b'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'add', targets: ['E'] } });
    ok(apply(boss, fillet('c', 'E', [edge(cap('E'), side('B', 'b'))], 0.5)));
    const outcome = apply(boss, fillet('c', 'E', [edge(cap('E'), side('B', 'b'))], 2));
    expect(outcome.code).toBe('blendDoesNotFit');
    expect(outcome.message).toMatch(/the tool reached material it must not touch/);
    const engine2 = newEngine();
    box(engine2);
    const over = run(engine2, addSketch('t', onFace('E', cap('E'))), circle('t', 'b', 30, 5, 8), { type: 'addFeature', feature: { id: 'B', name: 'B', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 't', regions: [{ outerLoop: ['b'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'add', targets: ['E'] } });
    expect(apply(over, fillet('c', 'E', [edge(cap('E'), side('B', 'b'))], 1)).code).toBe('unsupportedEdge');
  });

  it('too many triangles at a fine chord tolerance', () => {
    const outcome = apply(boxWithHole(15), fillet('c', 'E', [edge(cap('E'), side('H', 'h'))], 10), 'E', 0.0001);
    expect(outcome.code).toBe('blendDoesNotFit');
    expect(outcome.message).toMatch(/triangles, more than 1000000/);
  });
});
