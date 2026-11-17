// Validation scenario 14 (docs/requirements.md), the part of package 4a (D58): turned parts, a V-belt
// pulley and a knob with an O-ring, made by the revolve. Written from docs/d36/4a-revolve/calls.ts.
// Every part is a half profile in a sketch on XZ (x of the sketch is the radius, y the height along
// the world Z), turned about an axis in that plane. The steps share one engine and run in order.
import { type AxisRef, type Command, type EngineState, type Expr, type FaceName, type Id, type Input, type RevolveFeature, type SketchFeature, type Surface, type Vec3, freshIds, sketchTool } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { addSketch, batch, newEngine, run } from './kit';

const XZ = { kind: 'base', plane: 'XZ' } as const;
const engine = newEngine();
const near = (value: number | undefined, expected: number, tolerance = 1e-6): void => {
  expect(value, `${value} is not ${expected}`).toBeDefined();
  expect(Math.abs((value as number) - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(tolerance);
};
const nearVec = (a: Vec3 | undefined, b: Vec3, tolerance = 1e-6): void => {
  expect(a).toBeDefined();
  (a as Vec3).forEach((value, i) => near(value, b[i], tolerance));
};
const sameName = (a: FaceName, b: FaceName): boolean => JSON.stringify(a) === JSON.stringify(b);
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
function surfaceOf(state: EngineState, body: Id, name: FaceName): Surface | undefined {
  const face = state.evaluation.bodies[body]?.faces.find((f) => sameName(state.evaluation.faceNames[f.id], name));
  return face ? state.evaluation.faceSurfaces[face.id] : undefined;
}
const allOk = (state: EngineState): boolean => state.document.features.every((feature) => ['ok', 'warning'].includes(state.evaluation.features[feature.id].status));
const preview = (command: Command): EngineState => {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};

// a point held at (x, y) of the sketch by `fixed`, both coordinates expressions
// `at`: where the point starts before the solver moves it (the centre and the ends of an arc must
// not start in one place)
const fixedPoint = (sketch: Id, id: Id, x: Expr, y: Expr, at: [number, number] = [1, 1]): Command[] => [
  { type: 'addPoint', sketch, id, x: at[0], y: at[1] },
  { type: 'addConstraint', sketch, id: `${id}_at`, constraint: { type: 'fixed', point: id, x, y } },
];
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });
// a closed polygon of fixed points `${p}1`… and lines `names[i]` from point i + 1 to point i + 2
const polygon = (sketch: Id, p: string, corners: [Expr, Expr][], names: Id[]): Command[] => [
  ...corners.flatMap(([x, y], i) => fixedPoint(sketch, `${p}${i + 1}`, x, y)),
  ...names.map((name, i) => line(sketch, name, `${p}${i + 1}`, `${p}${((i + 1) % corners.length) + 1}`)),
];
const revolve = (id: Id, rest: Omit<Input<RevolveFeature>, 'id' | 'name' | 'suppressed' | 'type'>): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'revolve', ...rest } });
const regionsOf = (sketch: Id, curves: Id[]): Input<RevolveFeature['profile']> => ({ type: 'regions', sketch, regions: [{ outerLoop: [...curves].sort() }] });
const Z: AxisRef = { kind: 'base', axis: 'Z' };
const KNOB_AXIS: AxisRef = { kind: 'sketchLine', sketch: 'knobS', line: 'kax' };
const PULLEY_CURVES = ['b', 'r1', 'f1', 'g', 'f2', 'r2', 't', 'h'];

// The pulley's half profile with the parameters of the scenario: the corners and their first
// moment about the axis, ∫ x dA.
const vee = (38 * Math.PI) / 180;
const flank = 5 * Math.tan(vee / 2);
const PULLEY: [number, number][] = [
  [4, 0],
  [20, 0],
  [20, 7.5 - 1 - flank],
  [15, 6.5],
  [15, 8.5],
  [20, 8.5 + flank],
  [20, 15],
  [4, 15],
];
function profileMoment(corners: [number, number][]): number {
  let moment = 0;
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length];
    moment += ((a[0] * b[1] - b[0] * a[1]) * (a[0] + b[0])) / 6;
  });
  return moment;
}

describe('scenario 14: turned parts, a V-belt pulley and a knob with an O-ring (4a, D58)', () => {
  it('a. the pulley: planes, cylinders, cones, eight circular edges, the volume of Pappus, the facts', () => {
    const values: Record<string, Expr> = { D: '40', bore: '8', W: '15', gd: '5', gw: '2', vee: 'deg(38)', gr: '0.8', kR: '12', kH: '10', gD: '1.2', ringR: '0.9', ringC: '0.05' };
    run(engine, ...Object.entries(values).map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
    const flankExpr = 'gd * tan(vee / 2)';
    const state = run(
      engine,
      addSketch('pulleyS', XZ),
      batch(
        ...polygon(
          'pulleyS',
          'p',
          [
            ['bore / 2', '0'],
            ['D / 2', '0'],
            ['D / 2', `W / 2 - gw / 2 - ${flankExpr}`],
            ['D / 2 - gd', 'W / 2 - gw / 2'],
            ['D / 2 - gd', 'W / 2 + gw / 2'],
            ['D / 2', `W / 2 + gw / 2 + ${flankExpr}`],
            ['D / 2', 'W'],
            ['bore / 2', 'W'],
          ],
          PULLEY_CURVES,
        ),
      ),
      revolve('pulley', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'full' }, operation: 'new' }),
    );
    const s = (curve: Id) => surfaceOf(state, 'pulley', side('pulley', curve));
    expect(['b', 't'].map((curve) => s(curve)?.kind)).toEqual(['plane', 'plane']);
    expect(['r1', 'g', 'r2', 'h'].map((curve) => s(curve)?.kind)).toEqual(['cylinder', 'cylinder', 'cylinder', 'cylinder']);
    const f1 = s('f1');
    expect(f1?.kind).toBe('cone');
    if (f1?.kind === 'cone') near(f1.halfAngle, Math.PI / 2 - vee / 2, 1e-9);
    expect(state.evaluation.faceNames.some((name) => name.feature === 'pulley' && (name.role === 'startCap' || name.role === 'endCap'))).toBe(false);
    // the volume of Pappus within the chord tolerance over the surface
    const exact = 2 * Math.PI * profileMoment(PULLEY);
    expect(Math.abs(state.evaluation.bodies.pulley.volume - exact)).toBeLessThan(0.01 * 4500);
    const facts = state.evaluation.features.pulley.facts ?? {};
    nearVec(facts.axisPoint as Vec3, [0, 0, 0]);
    nearVec(facts.axisDirection as Vec3, [0, 0, 1]);
    expect(typeof facts.steps).toBe('number');
    expect(state.evaluation.bodies.pulley.edges.filter((edge) => edge.kind === 'circle')).toHaveLength(PULLEY_CURVES.length);
  });

  it('g. the errors of the recompute, asked before the groove gets its round corners: invalidAxis', () => {
    const codeOf = (command: Command, id: Id): string | undefined => preview(command).evaluation.features[id]?.error?.code;
    // the axis Y is the normal of XZ, not a line in it
    expect(codeOf(revolve('e1', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' }), 'e1')).toBe('invalidAxis');
    // a construction line of the sketch at x = 10 crosses the profile
    const through = batch(...fixedPoint('pulleyS', 'm1', '10', '-5'), ...fixedPoint('pulleyS', 'm2', '10', '20'), line('pulleyS', 'mline', 'm1', 'm2', true), revolve('e3', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: { kind: 'sketchLine', sketch: 'pulleyS', line: 'mline' }, extent: { type: 'full' }, operation: 'new' }));
    const crossed = preview(through).evaluation.features.e3?.error;
    expect(crossed?.code).toBe('invalidAxis');
    // the axis, then the curve that reaches farthest to each side: the bottom, from the bore to the rim
    expect(crossed?.refs).toEqual([{ kind: 'sketchLine', sketch: 'pulleyS', line: 'mline' }, 'b', 'b']);
    // a line of no length is no axis for a pattern either
    const noLength = batch(
      ...fixedPoint('pulleyS', 'z1', '50', '50'),
      ...fixedPoint('pulleyS', 'z2', '50', '50'),
      line('pulleyS', 'zl', 'z1', 'z2', true),
      { type: 'addFeature', feature: { id: 'e4', name: 'e4', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pulley' }, transform: { type: 'circular', axis: { kind: 'sketchLine', sketch: 'pulleyS', line: 'zl' }, count: 3, span: { type: 'full' } } } },
    );
    expect(codeOf(noLength, 'e4')).toBe('invalidAxis');
  });

  it('b. round corners of the groove: the fillet patches the revolve; two tori whose edges are circles', () => {
    const fillets = ['p4', 'p5'].map((corner, i) => {
      const state = engine.getState();
      const sketch = state.document.features.find((f) => f.id === 'pulleyS') as SketchFeature;
      const made = sketchTool('fillet', { sketch, result: state.evaluation.features.pulleyS.sketch, parameters: state.evaluation.parameters, document: state.document }, { corner, radius: 'gr' }, freshIds(state.document, `gf${i + 1}_`));
      if (!made.ok) throw new Error(made.message);
      run(engine, batch(...made.commands));
      return made.ids;
    });
    const state = engine.getState();
    expect(fillets.map((ids) => ids.patched.join())).toEqual(['pulley', 'pulley']);
    for (const ids of fillets) {
      const torus = surfaceOf(state, 'pulley', side('pulley', ids.arc[0]));
      expect(torus?.kind).toBe('torus');
      if (torus?.kind !== 'torus') continue;
      near(torus.minorRadius, 0.8, 1e-9);
      near(torus.majorRadius, 15.8, 1e-9);
      near(torus.center[0], 0);
      near(torus.center[1], 0);
    }
    const edges = state.evaluation.bodies.pulley.edges.filter((edge) => fillets.some((ids) => [edge.name.a, edge.name.b].some((name) => sameName(name, side('pulley', ids.arc[0])))));
    expect(edges.map((edge) => edge.kind)).toEqual(['circle', 'circle', 'circle', 'circle']);
    expect(allOk(state)).toBe(true);
  });

  it('c. a sketch on the top of the pulley and four holes through it', () => {
    const before = engine.getState();
    const onTop = { kind: 'face', body: 'pulley', face: side('pulley', 't') } as const;
    const points: [Expr, Expr][] = [
      ['12 - D / 2', '0'],
      ['-D / 2', '12'],
      ['-12 - D / 2', '0'],
      ['-D / 2', '-12'],
    ];
    const after = run(
      engine,
      addSketch('topS', onTop),
      batch(...points.flatMap(([x, y], i) => fixedPoint('topS', `l${i + 1}`, x, y))),
      { type: 'addFeature', feature: { id: 'lighten', name: 'lighten', suppressed: false, type: 'hole', sketch: 'topS', points: ['l1', 'l2', 'l3', 'l4'], shape: { type: 'plain', diameter: 4 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['pulley'] } },
    );
    const frame = after.evaluation.features.topS.plane;
    nearVec(frame?.origin, [20, 0, 15]);
    nearVec(frame?.normal, [0, 0, 1]);
    nearVec(frame?.y, [0, 1, 0]);
    const taken = before.evaluation.bodies.pulley.volume - after.evaluation.bodies.pulley.volume;
    expect(Math.abs(taken - 4 * Math.PI * 4 * 15)).toBeLessThan(0.01 * 4 * 2 * Math.PI * 2 * 15);
  });

  it('d. a quarter cut away in a preview by a partial turn, and the half by 180°', () => {
    const quarter = (angle: Expr, share: number): void => {
      const state = preview(
        batch(
          addSketch('cutS', XZ),
          batch(...polygon('cutS', 'c', [['0', '-1'], ['30', '-1'], ['30', '16'], ['0', '16']], ['ca', 'cb', 'cc', 'cd'])),
          revolve('quarter', { profile: regionsOf('cutS', ['ca', 'cb', 'cc', 'cd']), axis: Z, extent: { type: 'angle', start: 0, angle }, operation: 'cut', targets: ['pulley'] }),
        ),
      );
      const [start, end] = (['startCap', 'endCap'] as const).map((role) => surfaceOf(state, 'pulley', { feature: 'quarter', role }));
      expect(start?.kind).toBe('plane');
      expect(end?.kind).toBe('plane');
      if (start?.kind === 'plane') near(Math.abs(start.normal[1]), 1);
      if (end?.kind === 'plane' && share === 0.25) near(Math.abs(end.normal[0]), 1);
      const before = engine.getState().evaluation.bodies.pulley.volume;
      expect(Math.abs(state.evaluation.bodies.pulley.volume - (1 - share) * before)).toBeLessThan(0.005 * before);
      expect(state.evaluation.faceNames.some((name) => sameName(name, side('quarter', 'cd')))).toBe(false);
    };
    quarter('deg(90)', 0.25);
    quarter('deg(180)', 0.5);
  });

  it('e. the knob about a construction line of its own sketch: a sphere, its rim a circle, the dome 10 above the bottom', () => {
    const state = run(
      engine,
      addSketch('knobS', XZ),
      batch(
        ...fixedPoint('knobS', 'k1', '60', '0', [60, 0]),
        ...fixedPoint('knobS', 'k2', '60 + kR', '0', [72, 0]),
        ...fixedPoint('knobS', 'k3', '60 + kR', 'kH', [72, 10]),
        ...fixedPoint('knobS', 'k4', '60', 'kH', [60, 10]),
        ...fixedPoint('knobS', 'k5', '60', 'kH + kR', [60, 22]),
        ...fixedPoint('knobS', 'kt', '60', '40', [60, 40]),
        line('knobS', 'kb', 'k1', 'k2'),
        line('knobS', 'ks', 'k2', 'k3'),
        { type: 'addCurve', sketch: 'knobS', id: 'kd', curve: { type: 'arc', center: 'k4', start: 'k3', end: 'k5' } },
        line('knobS', 'ka', 'k5', 'k1'),
        line('knobS', 'kax', 'k1', 'kt', true),
      ),
      revolve('knob', { profile: regionsOf('knobS', ['kb', 'ks', 'kd', 'ka']), axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'new' }),
    );
    const dome = surfaceOf(state, 'knob', side('knob', 'kd'));
    expect(dome?.kind).toBe('sphere');
    if (dome?.kind === 'sphere') {
      near(dome.radius, 12);
      nearVec(dome.center, [60, 0, 10]);
    }
    expect(surfaceOf(state, 'knob', side('knob', 'ka'))).toBeUndefined();
    const facts = state.evaluation.features.knob.facts ?? {};
    nearVec(facts.axisPoint as Vec3, [60, 0, 0]);
    nearVec(facts.axisDirection as Vec3, [0, 0, 1]);
    const rim = state.evaluation.bodies.knob.edges.find((edge) => [edge.name.a, edge.name.b].some((name) => sameName(name, side('knob', 'kd'))) && [edge.name.a, edge.name.b].some((name) => sameName(name, side('knob', 'ks'))));
    expect(rim?.kind).toBe('circle');
    const exact = Math.PI * 144 * 10 + (2 / 3) * Math.PI * 1728;
    expect(Math.abs(state.evaluation.bodies.knob.volume - exact)).toBeLessThan(0.01 * 2500);
    const measured = engine.query('measure', { from: { kind: 'face', body: 'knob', face: side('knob', 'kb') }, to: { kind: 'face', body: 'knob', face: side('knob', 'kd') } });
    if (!measured.ok) throw new Error(measured.error.message);
    near(measured.result.distance, 10, 1e-9);
    expect(measured.result.to).toMatchObject({ is: 'sphere', convex: true });
  });

  it('e. an O-ring groove and an O-ring about the axis of the knob: no collision, the gap, the mass', () => {
    const state = run(
      engine,
      addSketch('grooveS', XZ),
      batch(...polygon('grooveS', 'g', [['60 + kR - gD', '4'], ['60 + kR + 1', '4'], ['60 + kR + 1', '6'], ['60 + kR - gD', '6']], ['ga', 'gb', 'gc', 'gd2'])),
      revolve('ringGroove', { profile: regionsOf('grooveS', ['ga', 'gb', 'gc', 'gd2']), axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'cut', targets: ['knob'] }),
      addSketch('ringS', XZ),
      batch(
        ...fixedPoint('ringS', 'rc', '60 + kR - gD + ringC + ringR', '5'),
        { type: 'addCurve', sketch: 'ringS', id: 'rcircle', curve: { type: 'circle', center: 'rc' }, radius: 0.9 },
        { type: 'addConstraint', sketch: 'ringS', id: 'rrad', constraint: { type: 'radius', curve: 'rcircle', value: 'ringR', driving: true } },
      ),
      revolve('oring', { profile: { type: 'regions', sketch: 'ringS', regions: [{ outerLoop: ['rcircle'] }] }, axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'new' }),
    );
    const tube = surfaceOf(state, 'oring', side('oring', 'rcircle'));
    expect(tube?.kind).toBe('torus');
    if (tube?.kind === 'torus') {
      near(tube.majorRadius, 11.75);
      near(tube.minorRadius, 0.9);
      nearVec(tube.center, [60, 0, 5]);
    }
    expect(surfaceOf(state, 'knob', side('ringGroove', 'gd2'))?.kind).toBe('cylinder');
    expect(surfaceOf(state, 'knob', side('ringGroove', 'gb'))).toBeUndefined();
    const gap = engine.query('gap', { bodies: ['knob', 'oring'] });
    if (!gap.ok) throw new Error(gap.error.message);
    const pair = gap.result.pairs[0];
    expect(pair && 'between' in pair).toBe(true);
    if (pair && 'between' in pair) expect(Math.abs(pair.distance - 0.05)).toBeLessThanOrEqual(pair.accuracy + 0.01);
    const mass = engine.query('mass', { bodies: ['oring'], density: 1.5 });
    if (!mass.ok) throw new Error(mass.error.message);
    const ringVolume = 2 * Math.PI * Math.PI * 11.75 * 0.81;
    expect(Math.abs(mass.result.mass - (1.5 * ringVolume) / 1000)).toBeLessThan((1.5 * 0.01 * 4 * Math.PI * Math.PI * 11.75 * 0.9) / 1000);
    // the mass about the axis of the knob, a line of a sketch
    const about = engine.query('mass', { bodies: ['oring'], density: 1.5, about: KNOB_AXIS });
    if (!about.ok) throw new Error(about.error.message);
    near(about.result.about?.distance, 0, 1e-3);
    expect(engine.interference({ bodies: ['knob', 'oring'] }).pairs).toHaveLength(0);
  });

  it('f. a mirrored groove and a linear pattern of it along the axis of the knob take what the groove took', () => {
    const before = engine.getState().evaluation.bodies.knob.volume;
    const groove = engine.getState('knob').evaluation.bodies.knob.volume - before;
    const mirrored = preview(
      batch(
        { type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 6.5 } },
        { type: 'addFeature', feature: { id: 'twice', name: 'twice', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringGroove'] }, transform: { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } } } },
      ),
    );
    expect(Math.abs(before - mirrored.evaluation.bodies.knob.volume - groove)).toBeLessThan(1);
    const along = preview({ type: 'addFeature', feature: { id: 'along', name: 'along', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringGroove'] }, transform: { type: 'linear', direction: KNOB_AXIS, count: 2, span: { type: 'spacing', spacing: 3 } } } });
    expect(along.evaluation.features.along.status).toBe('ok');
    const bottom = surfaceOf(along, 'knob', { ...side('ringGroove', 'ga'), copy: [{ pattern: 'along', index: 1 }] });
    expect(bottom?.kind).toBe('plane');
    if (bottom?.kind === 'plane') near(Math.abs(bottom.origin[2]), 7);
    expect(Math.abs(before - along.evaluation.bodies.knob.volume - groove)).toBeLessThan(1);
  });

  it('g. what is refused: an angle of 360°, a circle as the line of an axis, an addition without a target, an angle of a whole turn', () => {
    const commands: Command[] = [
      revolve('bad1', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'angle', start: 0, angle: 'deg(360)' }, operation: 'new' }),
      revolve('bad2', { profile: regionsOf('ringS', ['rcircle']), axis: { kind: 'sketchLine', sketch: 'ringS', line: 'rcircle' }, extent: { type: 'full' }, operation: 'new' }),
      revolve('bad3', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'full' }, operation: 'add' }),
      { type: 'setField', feature: 'pulley', path: 'extent/angle', value: 1 },
      revolve('bad4', { profile: { type: 'generated', generator: 'involuteGear', sketch: 'pulleyS', operands: { circle: 'x' }, params: { teeth: 20 } } as never, axis: Z, extent: { type: 'full' }, operation: 'new' }),
    ];
    const messages = commands.map((command) => {
      const result = engine.execute(command);
      return result.ok ? 'accepted' : result.error.message;
    });
    expect(messages[0]).toMatch(/extent\.angle/);
    expect(messages[1]).toMatch(/"rcircle" is a circle, expected line/);
    expect(messages[2]).toMatch(/needs exactly one target body/);
    expect(messages[3]).toMatch(/extent\/angle/);
    expect(messages[4]).toMatch(/a revolve takes regions or a wall/);
  });

  it('h. a larger diameter keeps every face; the document loads to the same model without a schema step', () => {
    const before = engine.getState();
    const after = preview({ type: 'setParameter', name: 'D', expr: '50' });
    const names = (state: EngineState) => state.evaluation.bodies.pulley.faces.map((face) => JSON.stringify(state.evaluation.faceNames[face.id])).sort();
    expect(names(after)).toEqual(names(before));
    expect(after.evaluation.bodies.pulley.volume).toBeGreaterThan(before.evaluation.bodies.pulley.volume);
    expect(allOk(after)).toBe(true);
    const saved = engine.save();
    // no step of 4a: only the pending step of the branch d36/3c, which its merge removes
    expect(JSON.parse(saved).schemaSteps).toEqual(['3c-document-insert']);
    const loaded = engine.load(saved);
    if (!loaded.ok) throw new Error(loaded.error.message);
    for (const id of Object.keys(before.evaluation.bodies)) {
      expect(loaded.state.evaluation.bodies[id].volume).toBe(before.evaluation.bodies[id].volume);
      expect(loaded.state.evaluation.bodies[id].solid.triangles.length).toBe(before.evaluation.bodies[id].solid.triangles.length);
    }
  });
});
