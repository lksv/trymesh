// Validation scenario 14 (turned parts: a V-belt pulley, a knob with an O-ring), the part of
// package 4a, written as calls against the contract. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. Lines marked `@ts-expect-error` are calls that must not compile.
//
// Scenario 14 is the scenario of step 4 of D36 ("beyond prisms"); 4a builds the parts and 4b
// adds the chamfers and fillets of their circular edges. Every part is drawn as a half profile in
// a sketch on the base plane XZ (x of the sketch is the radius, y the height along the world Z)
// and turned about an axis in that plane.

import type { Expr, Id, Input, Vec3 } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import { contextOf } from '../2d-sketch-fillet/calls';
import { type FilletIds, freshIds, sketchTool } from '../2d-sketch-fillet/contract';
import type { AxisRefD, RevolveExtent, RevolveFeature, StateD, SurfaceD } from './contract';
import { REVOLVE_FACTS } from './contract';

const XZ = { kind: 'base', plane: 'XZ' } as const;
const near = (value: number | undefined, expected: number, tolerance = 1e-6): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const nearVec = (a: Vec3 | undefined, b: Vec3, tolerance = 1e-6): boolean => a !== undefined && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => ['ok', 'warning'].includes(state.evaluation.features[feature.id].status));
// The state with the surfaces this package adds: the evaluation publishes them in `faceSurfaces`.
const withSurfaces = (state: StateAfter): StateD => state;
// The surface of a face of a body by its name; undefined when the body has no such face.
function surfaceOf(state: StateAfter, body: Id, name: FaceNameAfter): SurfaceD | undefined {
  const d = withSurfaces(state);
  const face = d.evaluation.bodies[body]?.faces.find((f) => sameName(d.evaluation.faceNames[f.id], name));
  return face ? d.evaluation.faceSurfaces[face.id] : undefined;
}
const side = (feature: Id, curve: Id): FaceNameAfter => ({ feature, role: 'side', curve });

// ---------------------------------------------------------------- sketch helpers

// A point held at (x, y) of the sketch by `fixed`, both coordinates expressions.
const fixedPoint = (sketch: Id, id: Id, x: Expr, y: Expr): CommandAfter[] => [
  { type: 'addPoint', sketch, id, x: 1, y: 1 },
  { type: 'addConstraint', sketch, id: `${id}_at`, constraint: { type: 'fixed', point: id, x, y } },
];
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });
// A closed polygon of fixed points `${p}1`… and lines named by `names`, the line `names[i]` from
// point i + 1 to point i + 2.
function polygon(sketch: Id, p: string, corners: [Expr, Expr][], names: Id[]): CommandAfter[] {
  return [...corners.flatMap(([x, y], i) => fixedPoint(sketch, `${p}${i + 1}`, x, y)), ...names.map((name, i) => line(sketch, name, `${p}${i + 1}`, `${p}${((i + 1) % corners.length) + 1}`))];
}
const revolve = (id: Id, rest: { profile: Input<RevolveFeature['profile']>; axis: AxisRefD; extent: Input<RevolveExtent>; operation: RevolveFeature['operation']; targets?: Id[] }): CommandAfter => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'revolve', ...rest },
});
const regionsOf = (sketch: Id, curves: Id[]): Input<RevolveFeature['profile']> => ({ type: 'regions', sketch, regions: [{ outerLoop: [...curves].sort() }] });
const Z: AxisRefD = { kind: 'base', axis: 'Z' };

// ---------------------------------------------------------------- a. the pulley

// Parameters: the outer diameter, the bore, the width along the axis, a V-groove of 38° that is
// `gd` deep with a flat bottom `gw` wide in the middle of the width, the radius of the round
// corners of the groove bottom.
export function parameters(): StateAfter {
  const values: Record<string, Expr> = { D: '40', bore: '8', W: '15', gd: '5', gw: '2', vee: 'deg(38)', gr: '0.8', kR: '12', kH: '10', gD: '1.2', ringR: '0.9', ringC: '0.05' };
  return run(...Object.entries(values).map(([name, expr]): CommandAfter => ({ type: 'setParameter', name, expr })));
}

// The half profile: the bottom `b`, the lower rim `r1`, the flanks `f1` and `f2` with the groove
// bottom `g` between them, the upper rim `r2`, the top `t` and the bore `h`. Turned about Z.
export const PULLEY_CURVES = ['b', 'r1', 'f1', 'g', 'f2', 'r2', 't', 'h'];
export function pulley(): StateAfter {
  const flank = 'gd * tan(vee / 2)';
  return run(
    ...sketchOn('pulleyS', XZ),
    ...polygon(
      'pulleyS',
      'p',
      [
        ['bore / 2', '0'],
        ['D / 2', '0'],
        ['D / 2', `W / 2 - gw / 2 - ${flank}`],
        ['D / 2 - gd', 'W / 2 - gw / 2'],
        ['D / 2 - gd', 'W / 2 + gw / 2'],
        ['D / 2', `W / 2 + gw / 2 + ${flank}`],
        ['D / 2', 'W'],
        ['bore / 2', 'W'],
      ],
      PULLEY_CURVES,
    ),
    revolve('pulley', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'full' }, operation: 'new' }),
  );
}

// What the scenario asserts about the pulley.
export function pulleyChecks(state: StateAfter): boolean {
  const s = (curve: Id) => surfaceOf(state, 'pulley', side('pulley', curve));
  // the bottom and the top are planes across the axis, the rims, the groove bottom and the bore
  // cylinders, the flanks cones whose half angle is 90° − 19°
  const planes = ['b', 't'].every((curve) => s(curve)?.kind === 'plane');
  const cylinders = ['r1', 'g', 'r2', 'h'].every((curve) => s(curve)?.kind === 'cylinder');
  const flank = s('f1');
  const cone = flank?.kind === 'cone' && near(flank.halfAngle, Math.PI / 2 - (19 * Math.PI) / 180, 1e-9);
  // no caps: a whole turn
  const caps = state.evaluation.faceNames.some((name) => name.feature === 'pulley' && (name.role === 'startCap' || name.role === 'endCap'));
  // the volume is that of Pappus: the area of the profile times the way of its centroid, within the
  // chord tolerance over the surface (0.01 × about 4500 mm²)
  const exact = 2 * Math.PI * profileMoment();
  const volume = state.evaluation.bodies['pulley'].volume;
  // the facts: the axis as used and the number of steps of the turn
  const facts = state.evaluation.features['pulley'].facts ?? {};
  const axisOk = nearVec(facts.axisPoint as Vec3, [0, 0, 0]) && nearVec(facts.axisDirection as Vec3, [0, 0, 1]);
  // the rims meet the bottom, the top and the flanks in circles a sketch can project
  const circles = state.evaluation.bodies['pulley'].edges.filter((edge) => edge.kind === 'circle').length; // all 8 edges between neighbouring curves (none is on the axis)
  return planes && cylinders && cone && !caps && Math.abs(volume - exact) < 0.01 * 4500 && axisOk && typeof facts.steps === 'number' && circles === PULLEY_CURVES.length && Object.keys(REVOLVE_FACTS).every((key) => key in facts);
}
// The first moment of the profile about the axis, ∫ x dA over the half profile with the parameters
// of the scenario (a value the test computes from the corners).
declare function profileMoment(): number;

// ---------------------------------------------------------------- b. round corners of the groove

// The two corners of the groove bottom get a radius by the fillet of D52. The revolve reads the
// sketch through its regions, so the tool patches it (`ids.patched`), and the pulley gets two
// faces of the arcs: tori about the axis, tangent to the flank and to the groove bottom.
export function groove(): { fillets: FilletIds[]; state: StateAfter } {
  const fillets = ['p4', 'p5'].map((corner, i) => {
    const state = engine.getState();
    const made = sketchTool('fillet', contextOf(state, 'pulleyS'), { corner, radius: 'gr' }, freshIds(state.document, `gf${i + 1}_`));
    if (!made.ok) return fail(made.message);
    run(...made.commands);
    return made.ids as FilletIds;
  });
  return { fillets, state: engine.getState() };
}
export function grooveChecks({ fillets, state }: { fillets: FilletIds[]; state: StateAfter }): boolean {
  const patched = fillets.every((ids) => ids.patched.join() === 'pulley');
  const tori = fillets.map((ids) => surfaceOf(state, 'pulley', side('pulley', ids.arc[0])));
  // the torus of a fillet: its tube has the radius of the fillet, its centre circle lies 0.8 off
  // the groove bottom (radius 15 + 0.8) and its centre on the axis
  const torusOk = tori.every((surface) => surface?.kind === 'torus' && near(surface.minorRadius, 0.8, 1e-9) && near(surface.majorRadius, 15.8, 1e-9) && near(surface.center[0], 0) && near(surface.center[1], 0));
  // the edges of a torus with the flank (a cone) and with the groove bottom (a cylinder) are circles:
  // each pair meets in two circles, and the points of the edge choose the one it is
  const edges = state.evaluation.bodies['pulley'].edges.filter((edge) => fillets.some((ids) => [edge.name.a, edge.name.b].some((name) => sameName(name, side('pulley', ids.arc[0])))));
  return patched && torusOk && edges.length === 4 && edges.every((edge) => edge.kind === 'circle') && allOk(state);
}

// ---------------------------------------------------------------- c. a sketch and holes on a face of the pulley

// The top of the pulley is a plane across the axis, the side of the line `t`: a sketch stands on
// it. Its origin is the start of the line (`p7`, at the radius D / 2) where the turn starts, its
// normal +Z (out of the body), its Y the direction of the turn there. Four plain holes at the
// radius 12 go through the pulley along the axis.
export function lighteningHoles(): StateAfter {
  const onTop = { kind: 'face', body: 'pulley', face: side('pulley', 't') } as const;
  const points: [Expr, Expr][] = [
    ['12 - D / 2', '0'],
    ['-D / 2', '12'],
    ['-12 - D / 2', '0'],
    ['-D / 2', '-12'],
  ];
  return run(
    ...sketchOn('topS', onTop),
    ...points.flatMap(([x, y], i) => fixedPoint('topS', `l${i + 1}`, x, y)),
    { type: 'addFeature', feature: { id: 'lighten', name: 'lighten', suppressed: false, type: 'hole', sketch: 'topS', points: ['l1', 'l2', 'l3', 'l4'], shape: { type: 'plain', diameter: 4 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['pulley'] } },
  );
}
export function topChecks(before: StateAfter, after: StateAfter): boolean {
  const frame = after.evaluation.features['topS'].plane;
  const frameOk = nearVec(frame?.origin, [20, 0, 15]) && nearVec(frame?.normal, [0, 0, 1]) && nearVec(frame?.y, [0, 1, 0]);
  // four bores of radius 2 through the width of 15, less what the polygons leave
  const taken = before.evaluation.bodies['pulley'].volume - after.evaluation.bodies['pulley'].volume;
  return frameOk && Math.abs(taken - 4 * Math.PI * 4 * 15) < 0.01 * 4 * 2 * Math.PI * 2 * 15;
}

// ---------------------------------------------------------------- d. a quarter cut away, in a preview

// A partial turn: a rectangle from the axis out past the rim, turned by 90° from the sketch plane
// and cut from the pulley. Previewed, never written: it takes about a quarter, and its two caps are
// planes through the axis. The first lies in the sketch plane XZ, the second is that plane
// turned by 90° about +Z.
export function quarterCut(angle: Expr = 'deg(90)', share = 0.25): { state: StateAfter; ok: boolean } {
  const preview = done(
    engine.preview({
      type: 'batch',
      commands: [
        ...sketchOn('cutS', XZ),
        ...polygon('cutS', 'c', [['0', '-1'], ['30', '-1'], ['30', '16'], ['0', '16']], ['ca', 'cb', 'cc', 'cd']),
        revolve('quarter', { profile: regionsOf('cutS', ['ca', 'cb', 'cc', 'cd']), axis: Z, extent: { type: 'angle', start: 0, angle }, operation: 'cut', targets: ['pulley'] }),
      ],
    }),
  );
  const caps = (['startCap', 'endCap'] as const).map((role) => surfaceOf(preview, 'pulley', { feature: 'quarter', role }));
  const [start, end] = caps;
  // the start cap lies in XZ; the end cap is XZ turned by the angle about +Z (YZ for 90°)
  const capsOk = start?.kind === 'plane' && end?.kind === 'plane' && near(Math.abs(start.normal[1]), 1) && (angle !== 'deg(90)' || near(Math.abs(end.normal[0]), 1));
  const before = engine.getState().evaluation.bodies['pulley'].volume;
  const after = preview.evaluation.bodies['pulley'].volume;
  // the line `cd` lies on the axis and makes no face; `cb` and `cc` lie outside the pulley. The four
  // holes stand at 0°, 90°, 180° and 270°, so a quarter from 0° takes a quarter of them too.
  const noAxisFace = !preview.evaluation.faceNames.some((name) => sameName(name, side('quarter', 'cd')));
  return { state: preview, ok: capsOk && Math.abs(after - (1 - share) * before) < 0.005 * before && noAxisFace };
}
// The angle is a field: 180° takes half.
export const halfCut = (): boolean => quarterCut('deg(180)', 0.5).ok;

// ---------------------------------------------------------------- e. the knob and its O-ring

// The knob stands at x = 60: a cylinder of radius kR and height kH with a dome of radius kR on
// top. Its axis is a construction line of its own sketch, `kax`, from (60, 0) up: an axis of the
// new kind `sketchLine`. The line `ka` of the profile lies on that axis and makes no face.
export const KNOB_AXIS: AxisRefD = { kind: 'sketchLine', sketch: 'knobS', line: 'kax' };
export function knob(): StateAfter {
  return run(
    ...sketchOn('knobS', XZ),
    ...fixedPoint('knobS', 'k1', '60', '0'),
    ...fixedPoint('knobS', 'k2', '60 + kR', '0'),
    ...fixedPoint('knobS', 'k3', '60 + kR', 'kH'),
    ...fixedPoint('knobS', 'k4', '60', 'kH'),
    ...fixedPoint('knobS', 'k5', '60', 'kH + kR'),
    ...fixedPoint('knobS', 'kt', '60', '40'),
    line('knobS', 'kb', 'k1', 'k2'),
    line('knobS', 'ks', 'k2', 'k3'),
    { type: 'addCurve', sketch: 'knobS', id: 'kd', curve: { type: 'arc', center: 'k4', start: 'k3', end: 'k5' } },
    line('knobS', 'ka', 'k5', 'k1'),
    line('knobS', 'kax', 'k1', 'kt', true),
    revolve('knob', { profile: regionsOf('knobS', ['kb', 'ks', 'kd', 'ka']), axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'new' }),
  );
}
export function knobChecks(state: StateAfter): boolean {
  const dome = surfaceOf(state, 'knob', side('knob', 'kd'));
  const domeOk = dome?.kind === 'sphere' && near(dome.radius, 12) && nearVec(dome.center, [60, 0, 10]);
  const noAxisFace = surfaceOf(state, 'knob', side('knob', 'ka')) === undefined;
  const facts = state.evaluation.features['knob'].facts ?? {};
  const axisOk = nearVec(facts.axisPoint as Vec3, [60, 0, 0]) && nearVec(facts.axisDirection as Vec3, [0, 0, 1]);
  // the dome meets the cylinder in the circle of radius 12 at z = 10: a sphere and a cylinder about
  // one axis that touch, one circle
  const rim = state.evaluation.bodies['knob'].edges.find((edge) => [edge.name.a, edge.name.b].some((name) => sameName(name, side('knob', 'kd'))) && [edge.name.a, edge.name.b].some((name) => sameName(name, side('knob', 'ks'))));
  // the volume: a cylinder and a half ball
  const exact = Math.PI * 144 * 10 + (2 / 3) * Math.PI * 1728;
  return domeOk && noAxisFace && axisOk && rim?.kind === 'circle' && Math.abs(state.evaluation.bodies['knob'].volume - exact) < 0.01 * 2500;
}
// The distance from the bottom of the knob to its dome is that of the plane to the centre of the
// sphere: 10, exactly.
export function domeHeight(): number | undefined {
  const measured = unwrap(engine.query('measure', { from: { kind: 'face', body: 'knob', face: side('knob', 'kb') }, to: { kind: 'face', body: 'knob', face: side('knob', 'kd') } }));
  return measured.distance; // 10
}

// An O-ring groove cut into the knob and the O-ring itself, each from a sketch of its own on XZ,
// both turned about the axis of the knob (a line of another sketch). The groove is 2 wide and gD
// deep; the ring's tube of radius ringR sits ringC off the groove bottom.
export function oring(): StateAfter {
  return run(
    ...sketchOn('grooveS', XZ),
    ...polygon('grooveS', 'g', [['60 + kR - gD', '4'], ['60 + kR + 1', '4'], ['60 + kR + 1', '6'], ['60 + kR - gD', '6']], ['ga', 'gb', 'gc', 'gd2']),
    revolve('ringGroove', { profile: regionsOf('grooveS', ['ga', 'gb', 'gc', 'gd2']), axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'cut', targets: ['knob'] }),
    ...sketchOn('ringS', XZ),
    ...fixedPoint('ringS', 'rc', '60 + kR - gD + ringC + ringR', '5'),
    { type: 'addCurve', sketch: 'ringS', id: 'rcircle', curve: { type: 'circle', center: 'rc' }, radius: 0.9 },
    { type: 'addConstraint', sketch: 'ringS', id: 'rrad', constraint: { type: 'radius', curve: 'rcircle', value: 'ringR', driving: true } },
    revolve('oring', { profile: { type: 'regions', sketch: 'ringS', regions: [{ outerLoop: ['rcircle'] }] }, axis: KNOB_AXIS, extent: { type: 'full' }, operation: 'new' }),
  );
}
export function oringChecks(state: StateAfter): boolean {
  const tube = surfaceOf(state, 'oring', side('oring', 'rcircle'));
  const torusOk = tube?.kind === 'torus' && near(tube.majorRadius, 11.75) && near(tube.minorRadius, 0.9) && nearVec(tube.center, [60, 0, 5]);
  // the groove: two planes and the cylinder of radius 10.8; the outer side lies outside the knob
  const grooveOk = surfaceOf(state, 'knob', side('ringGroove', 'gd2'))?.kind === 'cylinder' && surfaceOf(state, 'knob', side('ringGroove', 'gb')) === undefined;
  // the ring and the knob do not collide, and the gap is the 0.05 to the groove bottom
  const gap = unwrap(engine.query('gap', { bodies: ['knob', 'oring'] })).pairs[0];
  const gapOk = gap !== undefined && 'between' in gap && Math.abs(gap.distance - 0.05) <= gap.accuracy + 0.01;
  // the mass of the ring in a rubber of 1.5 g/cm³: 2π² R r² of volume, less what the polygons leave
  const mass = unwrap(engine.query('mass', { bodies: ['oring'], density: 1.5 }));
  const ringVolume = 2 * Math.PI * Math.PI * 11.75 * 0.81;
  return torusOk && grooveOk && gapOk && Math.abs(mass.volume - ringVolume) < 0.01 * 4 * Math.PI * Math.PI * 11.75 * 0.9 && engine.interference({ bodies: ['knob', 'oring'] }).pairs.length === 0;
}

// ---------------------------------------------------------------- f. patterns of a revolve

// A second groove, mirrored in the plane z = 7: the copy of the tool is built in the mirrored frame
// and turned over by `applyTool`, and takes from the knob what the groove took. Previewed.
export function mirroredGroove(): number {
  const before = engine.getState().evaluation.bodies['knob'].volume;
  // what the groove took: the knob as it was before the groove, less the knob now
  const groove = engine.getState('knob').evaluation.bodies['knob'].volume - before;
  const preview = done(
    engine.preview({
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 7 } },
        { type: 'addFeature', feature: { id: 'twice', name: 'twice', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringGroove'] }, transform: { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } } } },
      ],
    }),
  );
  return before - preview.evaluation.bodies['knob'].volume - groove; // about 0: the copy took as much as the groove
}
// The same second groove as a linear pattern along the axis of the knob: a direction of the new
// kind of `AxisRef`, the line `kax`. 4 apart along +Z puts it at z 8 to 10.
export function linearGroove(): StateAfter {
  return done(engine.preview({ type: 'addFeature', feature: { id: 'along', name: 'along', suppressed: false, type: 'pattern', source: { type: 'features', features: ['ringGroove'] }, transform: { type: 'linear', direction: KNOB_AXIS, count: 2, span: { type: 'spacing', spacing: 4 } } } }));
}

// ---------------------------------------------------------------- g. what is refused

// The structural refusals: an angle of a whole turn (the field ends before 2π), an axis line that
// is a circle, an addition without a target, the angle of a whole turn (which has none).
export function refusedCommands(): string[] {
  const commands: CommandAfter[] = [
    revolve('bad1', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'angle', start: 0, angle: 'deg(360)' }, operation: 'new' }),
    revolve('bad2', { profile: regionsOf('ringS', ['rcircle']), axis: { kind: 'sketchLine', sketch: 'ringS', line: 'rcircle' }, extent: { type: 'full' }, operation: 'new' }),
    revolve('bad3', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: Z, extent: { type: 'full' }, operation: 'add' }), // add without a target
    { type: 'setField', feature: 'pulley', path: 'extent/angle', value: 1 }, // a whole turn has no angle
  ];
  return commands.map((command) => {
    const result = engine.execute(command);
    return result.ok ? 'accepted' : result.error.message;
  });
}
// A generated profile is not a profile of a revolve.
export const generated: Input<RevolveFeature['profile']> = {
  // @ts-expect-error a revolve takes regions or a wall
  type: 'generated',
  generator: 'involuteGear',
  sketch: 'pulleyS',
  operands: { circle: 'x' },
  params: { teeth: 20 },
};

// The errors of the recompute, each in a preview: the code of the feature.
export function axisErrors(): Record<string, string | undefined> {
  const codeOf = (command: CommandAfter, id: Id): string | undefined => done(engine.preview(command)).evaluation.features[id]?.error?.code;
  return {
    // the axis Y is the normal of XZ, not a line in it
    notInPlane: codeOf(revolve('e1', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' }), 'e1'), // invalidAxis
    // a line of the sketch at x = 10 crosses the profile (from the bore at 4 to the rim at 20)
    lineThrough: codeOf(
      {
        type: 'batch',
        commands: [...fixedPoint('pulleyS', 'm1', '10', '-5'), ...fixedPoint('pulleyS', 'm2', '10', '20'), line('pulleyS', 'mid', 'm1', 'm2', true), revolve('e3', { profile: regionsOf('pulleyS', PULLEY_CURVES), axis: { kind: 'sketchLine', sketch: 'pulleyS', line: 'mid' }, extent: { type: 'full' }, operation: 'new' })],
      },
      'e3',
    ), // invalidAxis
    // a line of no length is no axis for a pattern either
    noLength: codeOf(
      {
        type: 'batch',
        commands: [
          ...fixedPoint('pulleyS', 'z1', '50', '50'),
          ...fixedPoint('pulleyS', 'z2', '50', '50'),
          line('pulleyS', 'zl', 'z1', 'z2', true),
          { type: 'addFeature', feature: { id: 'e4', name: 'e4', suppressed: false, type: 'pattern', source: { type: 'body', body: 'knob' }, transform: { type: 'circular', axis: { kind: 'sketchLine', sketch: 'pulleyS', line: 'zl' }, count: 3, span: { type: 'full' } } } },
        ],
      },
      'e4',
    ), // invalidAxis
  };
}

// ---------------------------------------------------------------- h. parameters, save and load

// The pulley follows its diameter: a larger one is a larger body with the same faces.
export function largerPulley(): boolean {
  const before = engine.getState();
  const after = done(engine.preview({ type: 'setParameter', name: 'D', expr: '50' }));
  const sameFaces = before.evaluation.bodies['pulley'].faces.every((face) => after.evaluation.bodies['pulley'].faces.some((other) => sameName(after.evaluation.faceNames[other.id], before.evaluation.faceNames[face.id])));
  return sameFaces && after.evaluation.bodies['pulley'].volume > before.evaluation.bodies['pulley'].volume && allOk(after);
}
// The document saves and loads to the same model; no schema step (an older build refuses the
// unknown feature type and the unknown kind of an axis by itself).
export function roundTrip(): boolean {
  const before = engine.getState();
  const loaded = done(engine.load(engine.save()));
  return Object.keys(before.evaluation.bodies).every((id) => loaded.evaluation.bodies[id].volume === before.evaluation.bodies[id].volume && loaded.evaluation.bodies[id].solid.triangles.length === before.evaluation.bodies[id].solid.triangles.length);
}

// The whole part of 4a, in order.
export function scenario14a(): boolean {
  parameters();
  const built = pulley();
  const first = pulleyChecks(built);
  const rounded = grooveChecks(groove());
  const beforeHoles = engine.getState();
  const holes = topChecks(beforeHoles, lighteningHoles());
  const quarter = quarterCut().ok && halfCut();
  const knobOk = knobChecks(knob()) && near(domeHeight(), 10, 1e-9);
  const ringOk = oringChecks(oring());
  const mirrorOk = Math.abs(mirroredGroove()) < 1;
  const linearOk = allOk(linearGroove());
  const refused = refusedCommands().every((message) => message !== 'accepted');
  const errors = Object.values(axisErrors()).every((code) => code === 'invalidAxis');
  return first && rounded && holes && quarter && knobOk && ringOk && mirrorOk && linearOk && refused && errors && largerPulley() && roundTrip();
}
