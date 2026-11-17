// D60 (package 5c of D36) against the real adapters: the axis of a round face (`AxisRef` of the kind
// `face`). Its sense as each build gives it (a bore of an extrusion from either side, a hole and its
// countersink, a cone of a taper whose angle passes through zero, a revolve, the copies of a pattern
// and of a mirror), the faces without an axis, and the axis for every consumer: a pattern, a joint,
// the tilt of a plane and the mass query, also in a pose.
import type { AxisRef, Command, Engine, EngineState, FaceName, Id, Input, RevolveFeature, Vec3 } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { cylinder } from './arm';
import { addSketch, batch, newEngine, onFace, run } from './kit';

const side = (feature: Id): FaceName => ({ feature, role: 'side', curve: `${feature}Circle` });
const face = (body: Id, name: FaceName): AxisRef => ({ kind: 'face', body, face: name });
const preview = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.preview(commands.length === 1 ? commands[0] : batch(...commands));
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const nearV = (a: Vec3 | undefined, b: Vec3, within = 1e-6) => {
  expect(a, `expected ${JSON.stringify(b)}`).toBeDefined();
  a?.forEach((value, i) => expect(Math.abs(value - b[i]), `${JSON.stringify(a)} is not ${JSON.stringify(b)}`).toBeLessThanOrEqual(within));
};
// The axis as a joint resolves it (`JointResult.axis`), or its error: the readout every kind shares.
// Two links are needed; `other` is a body of the second.
function jointAxis(engine: Engine, axis: AxisRef, body: Id, other: Id): { origin: Vec3; direction: Vec3 } | { code: string; message: string } {
  const state = preview(engine, { type: 'setLink', id: 'la', bodies: [body] }, { type: 'setLink', id: 'lb', bodies: [other] }, { type: 'setJoint', id: 'j', joint: { type: 'continuous', parent: 'la', child: 'lb', axis, value: 0 } });
  const joint = state.evaluation.mechanism.joints.j;
  if (joint.status === 'error') return { code: joint.error?.code ?? '', message: joint.error?.message ?? '' };
  return joint.axis as { origin: Vec3; direction: Vec3 };
}
// The point lies on the line of the axis.
const onAxis = (axis: { origin: Vec3; direction: Vec3 }, p: Vec3): number => {
  const d = [p[0] - axis.origin[0], p[1] - axis.origin[1], p[2] - axis.origin[2]];
  const u = axis.direction;
  const c = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  return Math.hypot(c[0], c[1], c[2]);
};
const resolved = (outcome: ReturnType<typeof jointAxis>): { origin: Vec3; direction: Vec3 } => {
  if ('code' in outcome) throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome;
};

// A disc 30 in radius from z = 0 to 10 about the origin, and a pin of radius 2 at (20, 0) above it.
function plate(): Engine {
  const engine = newEngine();
  run(engine, batch(...cylinder('plate', 0, 0, 30, 0, 10), ...cylinder('pin', 20, 0, 2, 12, 20)));
  return engine;
}

describe('the sense of the axis of a round face: the one its build gives it', () => {
  it('an extrusion: the normal of its sketch, out of the body for a bore cut from either cap', () => {
    const engine = plate();
    nearV(resolved(jointAxis(engine, face('plate', side('plate')), 'plate', 'pin')).direction, [0, 0, 1]);
    run(
      engine,
      addSketch('top', onFace('plate', { feature: 'plate', role: 'endCap' })),
      { type: 'addPoint', sketch: 'top', id: 'tc', x: 10, y: 0 },
      { type: 'addCurve', sketch: 'top', id: 'topBoreCircle', curve: { type: 'circle', center: 'tc' }, radius: 3 },
      { type: 'addFeature', feature: { id: 'topBore', name: 'topBore', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'top', regions: [{ outerLoop: ['topBoreCircle'] }] }, extent: { type: 'distance', start: 0, distance: -5 }, operation: 'cut', targets: ['plate'] } },
      addSketch('under', onFace('plate', { feature: 'plate', role: 'startCap' })),
      { type: 'addPoint', sketch: 'under', id: 'uc', x: 10, y: 0 },
      { type: 'addCurve', sketch: 'under', id: 'underBoreCircle', curve: { type: 'circle', center: 'uc' }, radius: 3 },
      { type: 'addFeature', feature: { id: 'underBore', name: 'underBore', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'under', regions: [{ outerLoop: ['underBoreCircle'] }] }, extent: { type: 'distance', start: 0, distance: -3 }, operation: 'cut', targets: ['plate'] } },
    );
    // drilled from the top: up, through (10, 0, 10)
    const top = resolved(jointAxis(engine, face('plate', side('topBore')), 'plate', 'pin'));
    nearV(top.direction, [0, 0, 1]);
    nearV(top.origin, [10, 0, 10]);
    // drilled from the underside, whose normal points down: down, and the x of that sketch runs along −X
    const under = resolved(jointAxis(engine, face('plate', side('underBore')), 'plate', 'pin'));
    nearV(under.direction, [0, 0, -1]);
    expect(onAxis(under, [-10, 0, 5])).toBeLessThan(1e-9);
  });

  it('a hole and its countersink: the normal of the sketch of the hole, whichever way the hole goes', () => {
    const engine = plate();
    const countersink = (id: Id, sketch: Id, point: Id, side: 'forward' | 'backward'): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', sketch, points: [point], shape: { type: 'countersink', diameter: 3.4, headDiameter: 6, angle: 'deg(90)' }, extent: { type: 'throughAll', side }, targets: ['plate'] } });
    run(
      engine,
      // from the top into the body (against the normal of the face) and from XY at the bottom up into it
      addSketch('T', onFace('plate', { feature: 'plate', role: 'endCap' })),
      { type: 'addPoint', sketch: 'T', id: 'hp', x: -10, y: 5 },
      countersink('h', 'T', 'hp', 'backward'),
      addSketch('B', { kind: 'base', plane: 'XY' }),
      { type: 'addPoint', sketch: 'B', id: 'gp', x: -10, y: -5 },
      countersink('g', 'B', 'gp', 'forward'),
    );
    const state = engine.getState();
    const headOf = (feature: Id) => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((name) => name.feature === feature && name.role === 'holeHead')];
    for (const [feature, point, mouth, y] of [['h', 'hp', 10, 5], ['g', 'gp', 0, -5]] as const) {
      const bore = resolved(jointAxis(engine, face('plate', { feature, role: 'holeBore', point }), 'plate', 'pin'));
      nearV(bore.direction, [0, 0, 1]);
      expect(onAxis(bore, [-10, y, 0])).toBeLessThan(1e-9);
      // the apex of the countersink of 90° lies 3 into the hole from its mouth
      const cone = resolved(jointAxis(engine, face('plate', { feature, role: 'holeHead', point }), 'plate', 'pin'));
      nearV(cone.direction, [0, 0, 1]);
      nearV(cone.origin, [-10, y, feature === 'h' ? mouth - 3 : mouth + 3]);
    }
    // the cone's own axis points from the apex to the face, so it turns with the direction of the hole
    const [h, g] = [headOf('h'), headOf('g')];
    expect(h.kind === 'cone' && h.axis[2]).toBeCloseTo(1, 12);
    expect(g.kind === 'cone' && g.axis[2]).toBeCloseTo(-1, 12);
  });

  it('a cone of a taper whose angle passes through zero: the surface turns round, the sense of the axis does not', () => {
    const engine = plate();
    const boss = (taper: number): Command => ({ type: 'updateFeature', id: 'pin', patch: { extent: { taper } } });
    for (const taper of [0.1, -0.1]) {
      run(engine, boss(taper));
      const state = engine.getState();
      const cone = state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((name) => name.feature === 'pin' && name.role === 'side')];
      expect(cone.kind === 'cone' && Math.sign(cone.axis[2])).toBe(taper > 0 ? 1 : -1);
      const axis = resolved(jointAxis(engine, face('pin', side('pin')), 'plate', 'pin'));
      nearV(axis.direction, [0, 0, 1]);
      expect(onAxis(axis, [20, 0, 0])).toBeLessThan(1e-9);
    }
  });

  it('the copies: a circular pattern turns the sense with the copy, a mirror gives its image', () => {
    const engine = plate();
    run(
      engine,
      { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pin' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'angle', angle: Math.PI / 2 } } } },
      { type: 'addFeature', feature: { id: 'M', name: 'M', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pin' }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'XY' } } } },
    );
    // turned by 90° about X: up becomes −Y
    const turned = resolved(jointAxis(engine, face('P/1', { ...side('pin'), copy: [{ pattern: 'P', index: 1 }] }), 'plate', 'P/1'));
    nearV(turned.direction, [0, -1, 0]);
    expect(onAxis(turned, [20, 0, 0])).toBeLessThan(1e-9);
    // the mirror image in XY: down
    const mirrored = resolved(jointAxis(engine, face('M/1', { ...side('pin'), copy: [{ pattern: 'M', index: 1 }] }), 'plate', 'M/1'));
    nearV(mirrored.direction, [0, 0, -1]);
    expect(onAxis(mirrored, [20, 0, -15])).toBeLessThan(1e-9);
  });

  it('a revolve: the direction of its axis; a torus has an axis, a sphere and a plane have none', () => {
    const engine = plate();
    const point = (s: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
    const revolve = (id: Id, curves: Id[], axis: AxisRef): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'R', regions: [{ outerLoop: curves }] }, axis, extent: { type: 'full' }, operation: 'new' } as Input<RevolveFeature> });
    run(
      engine,
      addSketch('R', { kind: 'base', plane: 'XZ' }),
      // a ring from x = 40 to 45, z = 0 to 5: its outer side a cylinder
      ...([['r1', 40, 0], ['r2', 45, 0], ['r3', 45, 5], ['r4', 40, 5]] as const).map(([id, x, y]) => point('R', id, x, y)),
      ...(['a', 'b', 'c', 'd'] as const).map((id, i): Command => ({ type: 'addCurve', sketch: 'R', id, curve: { type: 'line', a: `r${i + 1}`, b: `r${((i + 1) % 4) + 1}` } })),
      // an axis line along Z, drawn downwards
      point('R', 'q1', 0, 10),
      point('R', 'q2', 0, 0),
      { type: 'addCurve', sketch: 'R', id: 'down', curve: { type: 'line', a: 'q1', b: 'q2', construction: true } },
      // a circle off the axis (a torus) and a half circle on it (a sphere)
      point('R', 'tc', 60, 20),
      { type: 'addCurve', sketch: 'R', id: 'tk', curve: { type: 'circle', center: 'tc' }, radius: 3 },
      point('R', 's0', 0, 30),
      point('R', 's1', 0, 40),
      point('R', 'sc', 0, 35),
      { type: 'addCurve', sketch: 'R', id: 'sa', curve: { type: 'arc', center: 'sc', start: 's0', end: 's1' } },
      { type: 'addCurve', sketch: 'R', id: 'sd', curve: { type: 'line', a: 's1', b: 's0' } },
      revolve('up', ['a', 'b', 'c', 'd'], { kind: 'base', axis: 'Z' }),
      revolve('downward', ['a', 'b', 'c', 'd'], { kind: 'sketchLine', sketch: 'R', line: 'down' }),
      revolve('ring', ['tk'], { kind: 'base', axis: 'Z' }),
      revolve('ball', ['sa', 'sd'], { kind: 'base', axis: 'Z' }),
    );
    nearV(resolved(jointAxis(engine, face('up', { feature: 'up', role: 'side', curve: 'b' }), 'plate', 'up')).direction, [0, 0, 1]);
    nearV(resolved(jointAxis(engine, face('downward', { feature: 'downward', role: 'side', curve: 'b' }), 'plate', 'downward')).direction, [0, 0, -1]);
    const torus = resolved(jointAxis(engine, face('ring', { feature: 'ring', role: 'side', curve: 'tk' }), 'plate', 'ring'));
    nearV(torus.direction, [0, 0, 1]);
    nearV(torus.origin, [0, 0, 20]);
    expect(jointAxis(engine, face('ball', { feature: 'ball', role: 'side', curve: 'sa' }), 'plate', 'ball')).toMatchObject({ code: 'invalidAxis', message: expect.stringContaining('the face is a surface of the kind sphere and has no axis') });
    expect(jointAxis(engine, face('plate', { feature: 'plate', role: 'endCap' }), 'plate', 'pin')).toMatchObject({ code: 'invalidAxis', message: expect.stringContaining('the face is a plane and has no axis') });
    // a face not on the body asked for, and a body that is not there
    expect(jointAxis(engine, face('pin', side('plate')), 'plate', 'pin')).toMatchObject({ code: 'brokenReference' });
  });
});

describe('the axis of a round face for every consumer', () => {
  it('a circular pattern about the axis of the pin and a linear one along it; a planar face is the error of the pattern', () => {
    const engine = plate();
    run(engine, batch(...cylinder('block', 30, 0, 1, 12, 14)));
    const around = preview(engine, { type: 'addFeature', feature: { id: 'C', name: 'C', suppressed: false, type: 'pattern', source: { type: 'body', body: 'block' }, transform: { type: 'circular', axis: face('pin', side('pin')), count: 2, span: { type: 'angle', angle: Math.PI } } } });
    // the block at (30, 0) turned by π about the axis through (20, 0): at (10, 0)
    const copy = around.evaluation.bodies['C/1'].bounds;
    expect((copy.min[0] + copy.max[0]) / 2).toBeCloseTo(10, 1); // the polygon of the circle is not symmetric under a half turn
    const along = preview(engine, { type: 'addFeature', feature: { id: 'L', name: 'L', suppressed: false, type: 'pattern', source: { type: 'body', body: 'block' }, transform: { type: 'linear', direction: face('pin', side('pin')), count: 2, span: { type: 'spacing', spacing: 7 } } } });
    expect(along.evaluation.bodies['L/1'].bounds.min[2] - along.evaluation.bodies.block.bounds.min[2]).toBeCloseTo(7, 4);
    const flat = preview(engine, { type: 'addFeature', feature: { id: 'F', name: 'F', suppressed: false, type: 'pattern', source: { type: 'body', body: 'block' }, transform: { type: 'circular', axis: face('plate', { feature: 'plate', role: 'endCap' }), count: 2, span: { type: 'full' } } } });
    expect(flat.evaluation.features.F.error?.code).toBe('invalidAxis');
  });

  it('a plane tilted about the axis of a face: the axis has to be parallel to the plane', () => {
    const engine = plate();
    // YZ turned by 30° about the axis of the pin (along Z through (20, 0)): through it
    const state = preview(engine, { type: 'addFeature', feature: { id: 'T', name: 'T', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'YZ' }, offset: 0, tilt: { axis: face('pin', side('pin')), angle: 'deg(30)' } } });
    const frame = state.evaluation.features.T.plane;
    nearV(frame?.normal, [Math.sqrt(3) / 2, 0.5, 0]);
    expect(Math.abs((20 - (frame?.origin[0] ?? 0)) * (frame?.normal[0] ?? 0) + (0 - (frame?.origin[1] ?? 0)) * (frame?.normal[1] ?? 0))).toBeLessThan(1e-9);
    nearV(state.evaluation.features.T.facts?.axisDirection as Vec3, [0, 0, 1]);
    // XY about the same axis: across the plane
    const across = preview(engine, { type: 'addFeature', feature: { id: 'U', name: 'U', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: face('pin', side('pin')), angle: 0.1 } } });
    expect(across.evaluation.features.U.error).toMatchObject({ code: 'invalidAxis', message: expect.stringContaining('the axis of the tilt is at 90° to the plane it tilts'), refs: [face('pin', side('pin'))] });
  });

  it('the mass about the axis of a face moves with its body in a pose; an axis of a sketch does not', () => {
    const engine = plate();
    run(
      engine,
      addSketch('layout', { kind: 'base', plane: 'XY' }),
      { type: 'addPoint', sketch: 'layout', id: 'pc', x: 20, y: 0 },
      { type: 'setLink', id: 'a', bodies: ['plate'] },
      { type: 'setLink', id: 'b', bodies: ['pin'] },
      { type: 'setJoint', id: 'turn', joint: { type: 'continuous', parent: 'a', child: 'b', axis: { kind: 'base', axis: 'Z' }, value: 0 } },
      { type: 'setPose', values: { turn: Math.PI / 2 } },
    );
    const about = (axis: AxisRef) => {
      const outcome = engine.query('mass', { bodies: ['pin'], density: 1, about: axis });
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.result.about;
    };
    // the pin stands at (0, 20) in the pose; the axis of its side went with it
    expect(about(face('pin', side('pin')))?.distance).toBeLessThan(1e-4);
    // the normal through the point where the pin was modelled stays there
    expect(about({ kind: 'sketchPoint', sketch: 'layout', point: 'pc' })?.distance).toBeCloseTo(20 * Math.SQRT2, 4);
    // as modelled both go through the pin
    const modelled = engine.query('mass', { bodies: ['pin'], density: 1, about: { kind: 'sketchPoint', sketch: 'layout', point: 'pc' } }, { geometry: 'modelled' });
    expect(modelled.ok && modelled.result.about?.distance).toBeLessThan(1e-4);
    // a planar face in the pose: the message says why
    const flat = engine.query('mass', { bodies: ['pin'], density: 1, about: face('pin', { feature: 'pin', role: 'endCap' }) });
    expect(flat).toMatchObject({ ok: false, error: { code: 'notAvailable', message: 'mass: about: the face is a plane and has no axis', arg: ['about'] } });
    // a face of another body than the one named is not in the state: the argument check refuses it
    const wrong = engine.query('mass', { bodies: ['pin'], density: 1, about: face('pin', side('plate')) });
    expect(wrong).toMatchObject({ ok: false, error: { arg: ['about', 'face'] } });
  });
});
