// D35 point 3 in the recompute, against the real adapters: an extrusion whose profile comes from
// the involute gear generator. The profile itself is tested in packages/engine/test/gear.test.ts.
import { describe, expect, it } from 'vitest';
import type { Command, Engine, EngineState, ExtrudeFeature, Facts, Id, Input, ProfileSource, Solid, Vec3 } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { XY, addSketch, cap, expectAllOk, faceNames, newEngine, onFace, run, side, status, volume } from './kit';

const kernel = await createManifoldKernel();
const DEG = Math.PI / 180;
const overlap = (a: Solid, b: Solid): number => volume(kernel.boolean('intersection', a, b));
const solidOf = (state: EngineState, body: Id): Solid => state.evaluation.bodies[body].solid;
const factsOf = (state: EngineState, feature: Id): Facts => state.evaluation.features[feature].facts as Facts;
const warningsOf = (state: EngineState, feature: Id) => state.evaluation.features[feature].warnings.map((w) => w.code);

const gearProfile = (circle: Id, params: Record<string, number | boolean | string>, meshWith?: Id, sketch: Id = 'S1'): Input<ProfileSource> => ({ type: 'generated', generator: 'involuteGear', sketch, operands: { circle }, params, ...(meshWith ? { refs: { meshWith } } : {}) });
function extrude(id: Id, profile: Input<ProfileSource>, start: number, distance: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command {
  return { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent: { type: 'distance', start, distance }, operation, ...(targets ? { targets } : {}) } as Input<ExtrudeFeature> };
}
const disc = (id: Id, sketch: Id, curve: Id, start: number, distance: number): Command => extrude(id, { type: 'regions', sketch, regions: [{ outerLoop: [curve] }] }, start, distance);

// Parameters of a planetary set and the sketch S1 of its pitch circles: sun `s` at the origin,
// planet `p` tangent to it with its centre on the X axis, ring `r` concentric with the sun. All
// three are construction circles driven by expressions; `o` is an ordinary circle of diameter 100.
function gearSketch(zs = 18, zp = 27): Engine {
  const engine = newEngine();
  const dim = (id: Id, shape: object, value: number | string): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint: { ...shape, value, driving: true } as never });
  const circle = (id: Id, center: Id, radius: number, construction = true): Command => ({ type: 'addCurve', sketch: 'S1', id, curve: { type: 'circle', center, ...(construction ? { construction: true } : {}) }, radius });
  run(
    engine,
    { type: 'setParameter', name: 'm', expr: '0.9' },
    { type: 'setParameter', name: 'Zs', expr: String(zs) },
    { type: 'setParameter', name: 'Zp', expr: String(zp) },
    { type: 'setParameter', name: 'Zr', expr: 'Zs + 2 * Zp' },
    addSketch('S1', XY),
    {
      type: 'batch',
      commands: [
        { type: 'addPoint', sketch: 'S1', id: 'cp', x: 20, y: 1 },
        circle('s', 'origin', 8),
        circle('p', 'cp', 12),
        circle('r', 'origin', 32),
        circle('o', 'origin', 48, false),
        { type: 'addConstraint', sketch: 'S1', id: 'tsp', constraint: { type: 'tangent', a: 's', b: 'p' } },
        dim('cpy', { type: 'verticalDistance', a: 'origin', b: 'cp' }, 0),
        dim('ds', { type: 'diameter', curve: 's' }, 'm * Zs'),
        dim('dp', { type: 'diameter', curve: 'p' }, 'm * Zp'),
        dim('dr', { type: 'diameter', curve: 'r' }, 'm * Zr'),
        dim('do', { type: 'diameter', curve: 'o' }, 100),
      ],
    },
  );
  return engine;
}
// sun, planet in mesh with it, a housing disc and the ring cut into it in mesh with the planet
function train(engine: Engine, backlash = 0.05): EngineState {
  return run(
    engine,
    extrude('sun', gearProfile('s', { teeth: 'Zs', backlash }), 0, 8),
    extrude('planet', gearProfile('p', { teeth: 'Zp', backlash }, 'sun'), 0, 8),
    disc('housing', 'S1', 'o', 0, 8),
    { type: 'addFeature', feature: { id: 'ring', name: 'ring', suppressed: false, type: 'extrude', profile: gearProfile('r', { teeth: 'Zr', backlash, internal: true }, 'planet'), extent: { type: 'throughAll', side: 'forward' }, operation: 'cut', targets: ['housing'] } as Input<ExtrudeFeature> },
  );
}

describe('a gear from the generator', () => {
  it('builds a body: facts, face names, a volume between the root and the tip cylinder', () => {
    const engine = gearSketch();
    const state = run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 2, 8));
    expectAllOk(state);
    expect(faceNames(state, 'sun')).toEqual(['sun/endCap', 'sun/side/teeth', 'sun/startCap']);
    expect(factsOf(state, 'sun')).toMatchObject({ module: expect.closeTo(0.9, 9), teeth: 18, pitchDiameter: expect.closeTo(16.2, 9), tipDiameter: expect.closeTo(18, 9), rootDiameter: expect.closeTo(13.95, 9), rotation: 0, meshed: false, internal: false });
    expect(factsOf(state, 'sun').center).toEqual([0, 0, 0]);
    expect(factsOf(state, 'sun').axis).toEqual([0, 0, 1]);
    const v = volume(solidOf(state, 'sun'));
    expect(v).toBeGreaterThan(Math.PI * 6.975 ** 2 * 8);
    expect(v).toBeLessThan(Math.PI * 9 ** 2 * 8);
    expect(v / (Math.PI * 8.1 ** 2 * 8)).toBeCloseTo(1, 1); // about the pitch cylinder
    // the values of the expressions are written back and the feature lists them
    expect(state.evaluation.features.sun.values).toEqual({ 'profile/params/teeth': 18 });
    // the side of the teeth is one face that is not planar; its edges with the caps are general curves
    const body = state.evaluation.bodies.sun;
    expect(body.faces.map((f) => f.planar)).toEqual([true, true, false]);
    expect(body.edges.map((e) => e.kind)).toEqual(['other', 'other']);
  });

  it('a sketch stands on a cap but not on the teeth; an edge of the teeth cannot be projected', () => {
    const engine = gearSketch();
    run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8));
    const onCap = run(engine, addSketch('S2', onFace('sun', cap('sun'))));
    expect(status(onCap).S2).toBe('ok');
    expect(onCap.evaluation.features.S2.plane?.origin).toEqual([0, 0, 8]);
    const edge = onCap.evaluation.bodies.sun.edges[0].name;
    for (const kind of ['circle', 'line'] as const) {
      const projected = run(engine, { type: 'addExternal', sketch: 'S2', id: `x${kind}`, ref: { type: 'edge', body: 'sun', edge, kind } });
      expect(projected.evaluation.features.S2.warnings.map((w) => w.code)).toContain('unsupportedProjection');
    }
    const onTeeth = run(engine, addSketch('S3', onFace('sun', side('sun', 'teeth'))));
    expect(status(onTeeth).S3).toBe('error:nonPlanarFace');
  });

  it('does not depend on the sketch profile: ordinary tangent circles invalidate it, the gears still build', () => {
    const engine = gearSketch();
    const state = run(engine, { type: 'setConstruction', sketch: 'S1', id: 's', construction: false }, { type: 'setConstruction', sketch: 'S1', id: 'p', construction: false }, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8), extrude('planet', gearProfile('p', { teeth: 'Zp' }, 'sun'), 0, 8));
    expect(state.evaluation.features.S1.sketch?.valid).toBe(false);
    expect(status(state)).toMatchObject({ sun: 'ok', planet: 'ok' });
    // an extrusion of a region of the same sketch does fail
    expect(status(run(engine, disc('d', 'S1', 'o', 0, 1))).d).toBe('error:invalidProfile');
  });

  it('the pitch circle may be a projected circle', () => {
    const engine = gearSketch();
    run(engine, disc('shaft', 'S1', 'o', 0, 5), addSketch('S2', onFace('shaft', cap('shaft'))));
    const rim = engine.getState().evaluation.bodies.shaft.edges.find((e) => e.kind === 'circle' && JSON.stringify(e.name).includes('endCap'))!;
    const state = run(engine, { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'shaft', edge: rim.name, kind: 'circle' } }, extrude('gear', gearProfile('x', { teeth: 100 }, undefined, 'S2'), 0, 4, 'add', ['shaft']));
    expectAllOk(state);
    expect(factsOf(state, 'gear')).toMatchObject({ module: expect.closeTo(1, 9), pitchDiameter: expect.closeTo(100, 9) });
    expect(factsOf(state, 'gear').center).toEqual([0, 0, 5]);
    expect(faceNames(state, 'shaft')).toContain('gear/side/teeth');
    // without the projection the operand is a broken reference that names it
    const broken = run(engine, { type: 'removeExternal', sketch: 'S2', id: 'x' });
    expect(status(broken).gear).toBe('error:brokenReference');
    expect(broken.evaluation.features.gear.error?.refs).toEqual(['x']);
    expect(broken.evaluation.features.gear).not.toHaveProperty('facts');
  });

  it('adds teeth to a body and cuts a splined bore', () => {
    const engine = gearSketch();
    const state = run(
      engine,
      disc('hub', 'S1', 'o', 0, 4),
      extrude('teeth', gearProfile('s', { teeth: 'Zs' }), 4, 6, 'add', ['hub']),
      { type: 'addFeature', feature: { id: 'bore', name: 'bore', suppressed: false, type: 'extrude', profile: gearProfile('s', { teeth: 'Zs', backlash: 0 }), extent: { type: 'throughAll', side: 'forward' }, operation: 'cut', targets: ['hub'] } as Input<ExtrudeFeature> },
    );
    expectAllOk(state);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['hub']);
    // the bore removed the added teeth entirely (the same profile) and left its own side in the disc
    expect(faceNames(state, 'hub').filter((name) => name.includes('teeth'))).toEqual(['bore/side/teeth']);
    expect(factsOf(state, 'teeth').center).toEqual([0, 0, 0]);
  });
});

describe('gears in mesh', () => {
  it('sun, planet and ring: rotations from the mesh, no warnings, no overlap of the bodies', () => {
    for (const [zs, zp] of [[18, 27], [24, 24], [18, 36]]) {
      const engine = gearSketch(zs, zp);
      const started = performance.now();
      const state = train(engine);
      const elapsed = performance.now() - started;
      expectAllOk(state);
      expect([factsOf(state, 'sun').meshed, factsOf(state, 'planet').meshed, factsOf(state, 'ring').meshed]).toEqual([false, true, true]);
      expect(factsOf(state, 'ring')).toMatchObject({ internal: true, teeth: zs + 2 * zp, tipDiameter: expect.closeTo(0.9 * (zs + 2 * zp) - 1.8, 9) });
      expect(overlap(solidOf(state, 'sun'), solidOf(state, 'planet')), `${zs}/${zp}`).toBeLessThan(1e-3);
      expect(overlap(solidOf(state, 'planet'), solidOf(state, 'housing')), `${zs}/${zp}`).toBeLessThan(1e-3);
      expect(faceNames(state, 'housing').filter((name) => name.startsWith('ring/'))).toEqual(['ring/side/teeth']);
      expect(elapsed, 'four extrusions with two booleans').toBeLessThan(5000);
    }
  });

  it('a wrong rotation does overlap: the reference is what puts the gears in mesh', () => {
    const engine = gearSketch();
    train(engine, 0);
    // half a pitch off, without the reference
    const state = run(engine, { type: 'updateFeature', id: 'planet', patch: { profile: { refs: { meshWith: null }, params: { rotation: (factsOf(engine.getState(), 'planet').rotation as number) + Math.PI / 27 } } } });
    expect(factsOf(state, 'planet').meshed).toBe(false);
    expect(overlap(solidOf(state, 'sun'), solidOf(state, 'planet'))).toBeGreaterThan(1);
  });

  it('changing the tooth counts recomputes the train and keeps it in mesh', () => {
    const engine = gearSketch();
    train(engine);
    const before = factsOf(engine.getState(), 'planet').rotation;
    const state = run(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'Zs', expr: '24' }, { type: 'setParameter', name: 'Zp', expr: '24' }] });
    expectAllOk(state);
    expect(factsOf(state, 'sun')).toMatchObject({ teeth: 24, pitchDiameter: expect.closeTo(21.6, 6) });
    expect(factsOf(state, 'planet')).toMatchObject({ teeth: 24, meshed: true });
    expect(factsOf(state, 'planet').rotation).not.toBe(before);
    expect((factsOf(state, 'planet').center as Vec3)[0]).toBeCloseTo(21.6, 6);
    expect(overlap(solidOf(state, 'sun'), solidOf(state, 'planet'))).toBeLessThan(1e-3);
    expect(overlap(solidOf(state, 'planet'), solidOf(state, 'housing'))).toBeLessThan(1e-3);
    // the numbers of the fields in the document follow
    const planet = state.document.features.find((f) => f.id === 'planet') as ExtrudeFeature;
    expect(planet.profile).toMatchObject({ params: { teeth: 24 } });
    // undo restores the model; save and load give the same one
    engine.undo();
    expect(factsOf(engine.getState(), 'planet')).toMatchObject({ teeth: 27, rotation: before });
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(engine.getState().evaluation);
  });

  it('gearMesh: a mate that is missing, suppressed or does not fit is a warning and the rotation parameter is used', () => {
    const engine = gearSketch();
    train(engine);
    const meshed = factsOf(engine.getState(), 'planet').rotation;
    // the sun is suppressed: the planet keeps building with its own rotation, the ring follows the planet
    let state = run(engine, { type: 'setSuppressed', id: 'sun', suppressed: true });
    expect(status(state)).toMatchObject({ sun: 'suppressed', planet: 'warning:gearMesh', ring: 'ok' });
    expect(factsOf(state, 'planet')).toMatchObject({ meshed: false, rotation: 0 });
    expect(state.evaluation.features.planet.warnings[0].message).toMatch(/missing, suppressed, in error or not a gear/);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['planet', 'housing']);
    state = run(engine, { type: 'setSuppressed', id: 'sun', suppressed: false });
    expect(factsOf(state, 'planet')).toMatchObject({ meshed: true, rotation: meshed });
    // the pitch circle of the planet is 1 mm too large: neither its module nor the tangency with the ring fits
    state = run(engine, { type: 'setField', feature: 'S1', path: 'constraints/dp/value', value: 'm * Zp + 1' });
    expect(status(state)).toMatchObject({ planet: 'warning:gearMesh', ring: 'warning:gearMesh' });
    expect(state.evaluation.features.planet.warnings[0].message).toMatch(/the modules differ/);
    expect(overlap(solidOf(state, 'planet'), solidOf(state, 'housing'))).toBeGreaterThan(0.1);
    engine.undo();
    // the mate removed: a broken reference of this kind is a warning as well
    state = run(engine, { type: 'removeFeature', id: 'sun' });
    expect(status(state).planet).toBe('warning:gearMesh');
  });

  it('a mate that is not a gear; a chain through a gear with a warning; two warnings at once', () => {
    const engine = gearSketch();
    train(engine);
    // the sun turned into a plain disc: healthy, but there is no gear to mesh with
    let state = run(engine, { type: 'updateFeature', id: 'sun', patch: { profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['o'] }] } } });
    expect(status(state)).toMatchObject({ sun: 'ok', planet: 'warning:gearMesh', ring: 'ok' });
    expect(state.evaluation.features.planet.warnings[0].message).toMatch(/not a gear/);
    // the ring still meshes with the planet: a gear with a warning publishes its facts
    expect(factsOf(state, 'ring')).toMatchObject({ meshed: true });
    expect(overlap(solidOf(state, 'planet'), solidOf(state, 'housing'))).toBeLessThan(1e-3);
    engine.undo();
    // a gear that refers to itself (only a loaded document can) has no facts to read either
    const saved = JSON.parse(engine.save());
    saved.features.find((f: { id: Id }) => f.id === 'planet').profile.refs = { meshWith: 'planet' };
    const other = newEngine();
    expect(other.load(JSON.stringify(saved)).ok).toBe(true);
    expect(status(other.getState()).planet).toBe('warning:gearMesh');
    // a ring cut that misses its target and cannot mesh: both warnings are reported
    state = run(engine, { type: 'setSuppressed', id: 'planet', suppressed: true }, { type: 'updateFeature', id: 'ring', patch: { extent: { side: 'backward' } } });
    expect(warningsOf(state, 'ring').sort()).toEqual(['gearMesh', 'noEffect']);
    expect(state.evaluation.features.ring.status).toBe('warning');
  });

  it('gears on mirrored planes: a planet drawn on the bottom of a body meshes like one drawn from above', () => {
    const engine = gearSketch();
    let state = train(engine);
    // a sketch on the bottom face of the housing looks at the plane from below
    state = run(engine, addSketch('S2', onFace('housing', cap('housing', 'startCap'))));
    const frame = state.evaluation.features.S2.plane!;
    expect(frame.normal[2]).toBeCloseTo(-1, 9);
    const centre: Vec3 = [20.25, 0, 0];
    const local = (axis: Vec3): number => axis.reduce((sum, value, i) => sum + value * (centre[i] - frame.origin[i]), 0);
    const dim = (id: Id, shape: object, value: number): Command => ({ type: 'addConstraint', sketch: 'S2', id, constraint: { ...shape, value, driving: true } as never });
    state = run(
      engine,
      { type: 'addPoint', sketch: 'S2', id: 'c2', x: local(frame.x) + 0.3, y: local(frame.y) - 0.2 },
      { type: 'addCurve', sketch: 'S2', id: 'p2', curve: { type: 'circle', center: 'c2', construction: true }, radius: 12 },
      dim('c2x', { type: 'horizontalDistance', a: 'origin', b: 'c2' }, local(frame.x)),
      dim('c2y', { type: 'verticalDistance', a: 'origin', b: 'c2' }, local(frame.y)),
      dim('d2', { type: 'diameter', curve: 'p2' }, 24.3),
      // against the normal of the sketch, so the gear occupies the same 8 mm as the others
      extrude('mirrored', gearProfile('p2', { teeth: 27, backlash: 0.05 }, 'sun', 'S2'), 0, -8),
    );
    expect(status(state).mirrored).toBe('ok');
    expect(factsOf(state, 'mirrored')).toMatchObject({ meshed: true });
    expect(overlap(solidOf(state, 'sun'), solidOf(state, 'mirrored'))).toBeLessThan(1e-3);
    // it is the same gear in the same place as the planet drawn from above
    const planet = volume(solidOf(state, 'planet'));
    expect(overlap(solidOf(state, 'planet'), solidOf(state, 'mirrored')) / planet).toBeGreaterThan(0.995);
  });

  it('a loaded document whose operand is not a circle of the sketch is a broken reference, not an exception', () => {
    const engine = gearSketch();
    run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8));
    for (const operand of ['cp', 'origin', 'tsp', 'missing', 'constructor', '__proto__', 'toString']) {
      const saved = JSON.parse(engine.save());
      saved.features.find((f: { id: Id }) => f.id === 'sun').profile.operands.circle = operand;
      const other = newEngine();
      expect(other.load(JSON.stringify(saved)).ok, operand).toBe(true);
      const state = other.getState();
      expect(status(state).sun, operand).toBe('error:brokenReference');
      expect(state.evaluation.features.sun.error?.refs, operand).toEqual([operand]);
      expect(Object.keys(state.evaluation.bodies)).toEqual([]);
    }
  });

  it('gearInterference is reported with the mesh in place', () => {
    const engine = gearSketch(12, 24);
    const state = run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8), extrude('planet', gearProfile('p', { teeth: 'Zp' }, 'sun'), 0, 8));
    expect(status(state)).toMatchObject({ sun: 'ok', planet: 'warning:gearInterference' });
    expect(factsOf(state, 'planet').meshed).toBe(true);
    expect(state.evaluation.features.planet.warnings[0].message).toMatch(/this gear with 24 teeth/);
  });
});

describe('a gear in error', () => {
  it('a bad expression, a failing generator and a missing operand are errors that can be fixed', () => {
    const engine = gearSketch();
    train(engine);
    // a parameter of the tooth count is removed: the gears that use it are in error, the others stay
    let state = run(engine, { type: 'removeParameter', name: 'Zp' });
    expect(status(state)).toMatchObject({ sun: 'ok', planet: 'error:invalidExpression', ring: 'error:invalidExpression' });
    expect(state.evaluation.features.planet.fieldErrors).toMatchObject({ 'profile/params/teeth': { code: 'unknownName' } });
    expect(state.evaluation.features.planet).not.toHaveProperty('facts');
    engine.undo();
    // a tooth count that is not an integer is an error of the field, not a rounding
    state = run(engine, { type: 'setParameter', name: 'Zs', expr: '18.5' });
    expect(state.evaluation.features.sun.fieldErrors).toMatchObject({ 'profile/params/teeth': { code: 'notInteger' } });
    engine.undo();
    // numbers the catalog allows but the generator cannot build
    state = run(engine, { type: 'updateFeature', id: 'sun', patch: { profile: { params: { backlash: 1.5 } } } });
    expect(status(state)).toMatchObject({ sun: 'error:invalidProfile', planet: 'warning:gearMesh' });
    expect(state.evaluation.features.sun.error?.message).toMatch(/cannot build the profile: the tooth is pointed/);
    expect(state.evaluation.features.sun.error?.refs).toEqual(['sun']); // the feature, not its sketch
    expect(Object.keys(state.evaluation.bodies)).toEqual(['planet', 'housing']);
    engine.undo();
    // the pitch circle is removed from the sketch
    state = run(engine, { type: 'removeEntity', sketch: 'S1', id: 's' });
    expect(status(state).sun).toBe('error:brokenReference');
    expect(state.evaluation.features.sun.error?.refs).toEqual(['s']);
    // the fix: another circle
    state = run(engine, { type: 'updateFeature', id: 'sun', patch: { profile: { operands: { circle: 'p' }, params: { teeth: 'Zp' } } } });
    expect(status(state).sun).toBe('ok');
    expect(factsOf(state, 'sun')).toMatchObject({ teeth: 27, module: expect.closeTo(0.9, 9) });
  });

  it('the chord tolerance of the document reaches the sketch and the generated profile', () => {
    const engine = gearSketch();
    run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8));
    const loopOf = (state: EngineState): number => (state.evaluation.features.S1.sketch?.regions.find((region) => region.ref.outerLoop.join() === 'o')?.loops[0].length ?? 0) / 2;
    const fine = engine.getState();
    const saved = JSON.parse(engine.save());
    saved.settings.chordTolerance = 0.2;
    const other = newEngine();
    expect(other.load(JSON.stringify(saved)).ok).toBe(true);
    const coarse = other.getState();
    expectAllOk(coarse);
    // the circle of the sketch and the flanks of the teeth are both divided by the tolerance
    expect(loopOf(fine)).toBeGreaterThan(2 * loopOf(coarse));
    expect(loopOf(coarse)).toBeGreaterThan(8);
    expect(solidOf(fine, 'sun').triangles.length).toBeGreaterThan(1.5 * solidOf(coarse, 'sun').triangles.length);
  });

  it('a preview returns the facts and the values without writing to the document', () => {
    const engine = gearSketch();
    run(engine, extrude('sun', gearProfile('s', { teeth: 'Zs' }), 0, 8));
    const saved = engine.save();
    const preview = engine.preview({ type: 'updateFeature', id: 'sun', patch: { profile: { params: { teeth: 'Zs + 2', pressureAngle: 'deg(25)' } } } }, 'sun');
    expect(preview.ok && preview.state.evaluation.features.sun.values).toEqual({ 'profile/params/pressureAngle': expect.closeTo(25 * DEG, 12), 'profile/params/teeth': 20 });
    expect(preview.ok && preview.state.evaluation.features.sun.facts).toMatchObject({ teeth: 20, module: expect.closeTo(0.81, 9), pressureAngle: expect.closeTo(25 * DEG, 12) });
    expect(engine.save()).toBe(saved);
  });
});

describe('a gear tool in a pattern of features (D35, point 4)', () => {
  it('a gear pocket and a gear boss are repeated through the same recipe as any other tool', () => {
    const engine = gearSketch();
    const plain = volume(solidOf(run(engine, disc('housing', 'S1', 'o', 0, 8)), 'housing'));
    const pocket = plain - volume(solidOf(run(engine, extrude('pocket', gearProfile('p', { teeth: 'Zp' }), 5, 3, 'cut', ['housing'])), 'housing'));
    let state = run(engine, extrude('boss', gearProfile('p', { teeth: 'Zp' }), 8, 2, 'add', ['housing']));
    expectAllOk(state);
    const boss = volume(solidOf(state, 'housing')) - plain + pocket;
    expect(pocket / 3).toBeGreaterThan(Math.PI * 10.9 ** 2); // between the root and the tip cylinder of the planet
    expect(pocket / 3).toBeLessThan(Math.PI * 13.1 ** 2);
    expect(boss / pocket).toBeCloseTo(2 / 3, 4);

    state = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['pocket', 'boss'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } });
    expectAllOk(state);
    // every copy removes and adds what the original does
    expect((volume(solidOf(state, 'housing')) - plain) / (3 * (boss - pocket))).toBeCloseTo(1, 4);
    expect(faceNames(state, 'housing').filter((name) => name.includes('teeth'))).toEqual(['boss/side/teeth', 'boss/side/teeth@P:1', 'boss/side/teeth@P:2', 'pocket/side/teeth', 'pocket/side/teeth@P:1', 'pocket/side/teeth@P:2']);
    // the facts belong to the source features; the pattern publishes none
    expect(state.evaluation.features.P.facts).toBeUndefined();
    expect(factsOf(state, 'pocket')).toMatchObject({ teeth: 27 });
    // a change of the tooth count rebuilds the copies as well
    const before = volume(solidOf(state, 'housing'));
    state = run(engine, { type: 'setParameter', name: 'Zp', expr: '21' });
    expectAllOk(state);
    expect(volume(solidOf(state, 'housing'))).not.toBeCloseTo(before, 0);
    expect(faceNames(state, 'housing').filter((name) => name.includes('teeth'))).toHaveLength(6);
  });
});

