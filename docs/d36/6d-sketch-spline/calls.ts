// Validation scenario 15 (a cover for a controller board), the part of package 6d, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract.
//
// Step 4 of the scenario: the lid outline, one half with a spline flank (a grip) and mirrored about
// the Y axis by 6c; the mirrored half closes into one region with the original. 6c's calls draw the
// flank `c2` as a line; here it is a spline over five control points under the same ID, so the
// region and the faces keep 6c's names. Then what the lid shows of the spline (the face, its edges,
// the area against a value by hand, the depth of the grip as a parameter), the refusals, a closed
// spline, a spline that crosses itself, the change of control points, and the section of the lid as
// DXF (the part of step 7 that is 6d's).
//
// Written as 6c's calls are, before 6b: the mirror is about the vertical construction line `ay`;
// with 6b in, the test of the whole scenario uses `origin/y`.
//
// The numbers in the comments were measured so (design.md, "Measured"): the polyline of a spline by
// a prototype of `splinePolyline` in the scratchpad; the solver by the real planegcs adapter with
// the control points and the legs (the spline itself is not in the solver, so that is what the
// solver sees); the region and the volume by the real profile and kernel with the spline put in as
// a chain of own lines through its polyline (the shape the profile divides a spline into).

import type { Id, Vec3 } from '../../../packages/engine/src/index';
import type { ExportFile, Exported } from '../../../packages/engine/src/index';
import type { OutlineAbout } from '../../../packages/engine/src/export/outline';
import type { CommandAfter, EdgeNameAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, run, unwrap } from '../2a-offset/calls';
import { LID_REGION, parameters, stand } from '../6c-sketch-mirror-pattern/calls';
import type { SketchPattern } from '../6c-sketch-mirror-pattern/contract';
import type { EngineAfter2g } from '../2g-export/contract';
import type { SketchResult6d } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const nearVec = (a: Vec3 | undefined, b: Vec3, tolerance = 1e-9): boolean => a !== undefined && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const resultOf = (state: StateAfter, id: Id): SketchResult6d => (state.evaluation.features[id].sketch as SketchResult6d | undefined) ?? fail(`no result of "${id}"`);
const regionsOf = (state: StateAfter, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
const sketchFeature = (id: Id): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
const point = (sketch: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
const arc = (sketch: Id, id: Id, center: Id, start: Id, end: Id): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
const spline = (sketch: Id, id: Id, points: Id[]): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'spline', points } });
const constrain = (sketch: Id, id: Id, constraint: object): CommandAfter => ({ type: 'addConstraint', sketch, id, constraint } as CommandAfter);
const extrudeRegions = (id: Id, sketch: Id, regions: Id[][], distance: number | string, offset?: number): CommandAfter => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset === undefined ? {} : { offset }) }, extent: { type: 'distance', start: 0, distance }, operation: 'new' },
});
const mirror = (sketch: Id, id: Id, sources: Id[], axis: Id): CommandAfter => ({ type: 'addExternal', sketch, id, ref: { type: 'pattern', sources, transform: { type: 'mirror', axis } } satisfies SketchPattern });
const errorOf = (command: CommandAfter, feature: Id) => done(engine.preview(command)).evaluation.features[feature]?.error;
const refused = (command: CommandAfter): string | undefined => {
  const result = engine.preview(command);
  return result.ok ? undefined : result.error.message;
};

// ---------------------------------------------------------------- the numbers

// The lid W × H with corners of radius R, T thick (6c's parameters). The grip: the flank of each
// half is pulled in by `grip` at mid-height, its end legs `reach` long and vertical, so the spline
// runs on from the corner arcs without a kink.
const [W, H, R, T] = [84, 54, 5, 2];
const [GRIP, REACH] = [4, 10];
// The area a grip takes from the rectangle, by hand. The control points are (42, 5), (42, 15),
// (42 − d, 27), (42, 39), (42, 49), d the grip. Their two Bezier pieces (knot 1 inserted twice):
// (42, 5), (42, 15), (42 − d/2, 21), (42 − d/2, 27) and its mirror image about y = 27. Over the
// first piece the depth is w(t) = (d/2)(3t² − 2t³) and dy/dt = 30 − 24t + 12t², so its area is
// (d/2) ∫₀¹ (3t² − 2t³)(30 − 24t + 12t²) dt = (d/2) · 9.8; both pieces 9.8 d, 39.2 mm² for d = 4
// (the Gauss–Legendre integral of the prototype gives 39.200000).
const gripArea = (d: number): number => 9.8 * d;
const LID = W * H - (4 - Math.PI) * R * R; // 4514.5398, the lid of 6c
const LID_WITH_GRIPS = (d: number): number => LID - 2 * gripArea(d); // 4436.1398 for d = 4
// Measured: the region's polygon 4435.9046 mm², 0.2353 below; of that 0.19 is the arcs (6c) and
// 0.022 each grip (its polygon 39.2221 against 39.2). So within (0.2 + 2 · 0.03) T of the volume.
const ALLOWANCE = (0.2 + 2 * 0.03) * T;

// ================================================================ step 4: the lid outline with a grip

export function gripParameters(): StateAfter {
  return run({ type: 'setParameter', name: 'grip', expr: `${GRIP}` }, { type: 'setParameter', name: 'reach', expr: `${REACH}` });
}

// The right half, drawn off its place and solved: `c1` along the bottom from the origin, the corner
// arc `r1`, the flank `c2` (a spline over `a2`, `g1`, `g2`, `g3`, `a3`), the corner arc `r2`, the top
// `c3`, which ends at `a5` on the Y axis `ay`. The legs `l1` (`a2` to `g1`) and `l2` (`g3` to `a3`)
// are construction lines, vertical and tangent to the arcs: the spline leaves `r1` and enters `r2`
// without a kink. Measured: 0 degrees of freedom, no redundant constraint; g1 (42, 15), g2 (38, 27),
// g3 (42, 39), a3 (42, 49), a5 (0, 54).
export function lidHalfWithGrip(): StateAfter {
  const s = 'lidSketch';
  run(sketchFeature(s));
  run(
    point(s, 'a1', 37.3, 0.2),
    point(s, 'q1', 36.8, 5.1),
    point(s, 'a2', 42.2, 4.7),
    point(s, 'g1', 42.4, 15.3),
    point(s, 'g2', 37.6, 27.4),
    point(s, 'g3', 41.7, 38.6),
    point(s, 'a3', 41.9, 49.4),
    point(s, 'q2', 37.3, 48.8),
    point(s, 'a4', 36.8, 54.3),
    point(s, 'a5', 0.7, 53.8),
    point(s, 'py', 0.4, 60.5),
    line(s, 'c1', 'origin', 'a1'),
    arc(s, 'r1', 'q1', 'a1', 'a2'),
    spline(s, 'c2', ['a2', 'g1', 'g2', 'g3', 'a3']),
    arc(s, 'r2', 'q2', 'a3', 'a4'),
    line(s, 'c3', 'a4', 'a5'),
    line(s, 'ay', 'origin', 'py', true),
    line(s, 'l1', 'a2', 'g1', true),
    line(s, 'l2', 'g3', 'a3', true),
  );
  return run(
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true }),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    constrain(s, 'k10', { type: 'horizontalDistance', a: 'origin', b: 'a2', value: 'W / 2', driving: true }),
    constrain(s, 'k11', { type: 'verticalDistance', a: 'origin', b: 'a4', value: 'H', driving: true }),
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'ay' }),
    constrain(s, 'k13', { type: 'vertical', line: 'ay' }),
    constrain(s, 'k14', { type: 'distance', a: 'origin', b: 'py', value: 60, driving: true }),
    // the grip: the legs vertical and tangent to the corner arcs, the far end under the near one,
    // the inner control points by the parameters
    constrain(s, 't1', { type: 'vertical', line: 'l1' }),
    constrain(s, 't2', { type: 'tangent', a: 'r1', b: 'l1' }),
    constrain(s, 't3', { type: 'vertical', line: 'l2' }),
    constrain(s, 't4', { type: 'tangent', a: 'l2', b: 'r2' }),
    constrain(s, 't5', { type: 'horizontalDistance', a: 'origin', b: 'a3', value: 'W / 2', driving: true }),
    constrain(s, 't6', { type: 'verticalDistance', a: 'a2', b: 'g1', value: 'reach', driving: true }),
    constrain(s, 't7', { type: 'verticalDistance', a: 'g3', b: 'a3', value: 'reach', driving: true }),
    constrain(s, 't8', { type: 'horizontalDistance', a: 'g2', b: 'a2', value: 'grip', driving: true }),
    constrain(s, 't9', { type: 'verticalDistance', a: 'origin', b: 'g2', value: 'H / 2', driving: true }),
  );
}

// The mirror of 6c: the five curves about `ay`, the spline among them. Its copy `m/1/c2` runs over
// the copies of the control points in the same order; its ends `m/1/a2`, `m/1/a3` are the ends of
// the copies of the arcs, so the outline is one loop as in 6c.
export function mirroredWithGrip(): StateAfter {
  parameters();
  stand();
  gripParameters();
  lidHalfWithGrip();
  return run(mirror('lidSketch', 'm', ['c1', 'r1', 'c2', 'r2', 'c3'], 'ay'));
}

// One region with both halves, named as in 6c; the copy of the spline is a spline of the result;
// the half is fully determined (the spline added no freedom and took none).
export function oneRegionWithGrip(state: StateAfter): boolean {
  const result = resultOf(state, 'lidSketch');
  return (
    result.valid &&
    same(regionsOf(state, 'lidSketch'), [LID_REGION]) &&
    same(result.curves['m/1/c2'], { shape: { type: 'spline', points: ['m/1/a2', 'm/1/g1', 'm/1/g2', 'm/1/g3', 'm/1/a3'] }, source: 'derived', regions: true }) &&
    near(result.points['m/1/g2']?.x, -(W / 2 - GRIP), 1e-9) &&
    result.degreesOfFreedom === 0 &&
    state.evaluation.features['lidSketch'].status === 'ok'
  );
}

// ---------------------------------------------------------------- the lid and its grip faces

export function lidWithGrip(): StateAfter {
  return run(extrudeRegions('lid', 'lidSketch', [LID_REGION], 'T'));
}
const side = (curve: Id): FaceNameAfter => ({ feature: 'lid', role: 'side', curve });
const TOP: FaceNameAfter = { feature: 'lid', role: 'endCap' };
const faceId = (state: StateAfter, name: FaceNameAfter): number | undefined => state.evaluation.bodies['lid']?.faces.find((f) => same(state.evaluation.faceNames[f.id], name))?.id;
// The edge of the top along the grip of the right half.
export const GRIP_EDGE: EdgeNameAfter = { a: TOP, b: side('c2') };

// The volume against the value by hand; the flank of each half is one face, a swept surface along
// the extrusion; the edges of a grip face are of the kind `other` (the top, the bottom, and the two
// straight edges where it meets the arcs: a swept surface meets a cylinder there, which no rule
// takes for a line).
export function lidWithGripChecks(state: StateAfter): boolean {
  const flank = faceId(state, side('c2'));
  const copy = faceId(state, side('m/1/c2'));
  const surface = flank === undefined ? undefined : state.evaluation.faceSurfaces[flank];
  const edges = state.evaluation.bodies['lid'].edges.filter((e) => same(e.name.a, side('c2')) || same(e.name.b, side('c2')));
  return (
    near(volumeOf(state, 'lid'), LID_WITH_GRIPS(GRIP) * T, ALLOWANCE) && // measured 8871.8091, by hand 8872.2796
    copy !== undefined &&
    surface?.kind === 'swept' &&
    (nearVec(surface.axis, [0, 0, 1]) || nearVec(surface.axis, [0, 0, -1])) &&
    edges.length === 4 &&
    edges.every((e) => e.kind === 'other')
  );
}

// The depth of the grip follows its parameter: 6 moves `g2` to x = 36 and its copy to −36, and the
// lid loses 9.8 · 2 mm² more per grip.
export const deeperGrip = (): boolean => {
  const state = done(engine.preview({ type: 'setParameter', name: 'grip', expr: '6' }));
  return near(resultOf(state, 'lidSketch').points['g2']?.x, 36, 1e-9) && near(resultOf(state, 'lidSketch').points['m/1/g2']?.x, -36, 1e-9) && near(volumeOf(state, 'lid'), LID_WITH_GRIPS(6) * T, ALLOWANCE);
};

// ---------------------------------------------------------------- what a spline is refused for

// Errors of features (the command is valid, the recompute refuses), each naming the spline:
// - the offset of the lid region: no exact outline (`invalidProfile`, refs the two splines);
// - a chamfer of the edge of the top along the grip: the edge is of the kind `other`
//   (`unsupportedEdge`, D63);
// - a revolve of a closed spline beside the Y axis: no exact outline (`invalidProfile`).
export function featureRefusals(): boolean {
  const offset = errorOf(extrudeRegions('lidOffset', 'lidSketch', [LID_REGION], 'T', 1), 'lidOffset');
  const chamfer = errorOf({ type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'lid', edges: [GRIP_EDGE], distance: 0.5 } }, 'ch');
  const revolve = errorOf({ type: 'addFeature', feature: { id: 'rv', name: 'rv', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'pebble', regions: [{ outerLoop: ['s'] }] }, axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' } }, 'rv');
  return (
    offset?.code === 'invalidProfile' &&
    same(offset.refs, ['c2', 'm/1/c2']) && // the splines of the selection, each once, sorted
    chamfer?.code === 'unsupportedEdge' &&
    revolve?.code === 'invalidProfile' &&
    same(revolve.refs, ['s'])
  );
}

// Invalid commands (nothing changes), with the text that says why.
export function commandRefusals(): (string | undefined)[] {
  const s = 'lidSketch';
  return [
    refused(spline(s, 'x1', ['a2', 'g1'])), // a spline has 3 to 64 control points, not 2
    refused(spline(s, 'x2', ['a2', 'g1', 'a2', 'g3'])), // "a2" is listed twice; only the first point may come again, as the last
    refused(spline(s, 'x3', ['a2', 'g1', 'a2'])), // a closed spline needs at least three different points
    refused(spline(s, 'x4', ['a2', 'g1', 'm/1/g2'])), // "m/1/g2" is not an own point of the sketch nor the origin
    refused({ type: 'addCurve', sketch: s, id: 'x5', curve: { type: 'spline', points: ['a2', 'g1', 'g2'] }, radius: 3 } as CommandAfter), // a radius only for a circle
    refused(constrain(s, 'x6', { type: 'pointOnCurve', point: 'g1', curve: 'c2' })), // "c2" is a spline, a line, circle or arc is expected
    refused(constrain(s, 'x7', { type: 'tangent', a: 'c2', b: 'r1' })), // likewise
    refused(constrain(s, 'x8', { type: 'radius', curve: 'c2', value: 5, driving: true })), // likewise
    refused({ type: 'setCurvePoint', sketch: s, id: 'c2', point: 'a', to: 'g1' }), // a spline has no named points; remove it and add it again
    refused({ type: 'addFeature', feature: { id: 'w', name: 'w', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: s, curves: ['c2'], thickness: 1 }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'new' } }), // a wall takes lines, arcs and circles
  ];
}

// ---------------------------------------------------------------- a closed spline, a crossing one

// A closed spline over the corners of a square 20 × 20 beside the Y axis (x from 10 to 30): one
// region named by the spline alone; extruded, one side face. Measured: exact area 240 (the Gauss–
// Legendre integral of the prototype), the polygon at 0.01 mm 239.8216 (82 pieces); a corner at
// (10, 0), where the first and the last leg meet at a right angle.
export function pebble(): StateAfter {
  const s = 'pebble';
  run(sketchFeature(s));
  run(point(s, 'b1', 10, 0), point(s, 'b2', 30, 0), point(s, 'b3', 30, 20), point(s, 'b4', 10, 20), spline(s, 's', ['b1', 'b2', 'b3', 'b4', 'b1']));
  return run(extrudeRegions('pebbleBody', s, [['s']], 2));
}
export const pebbleChecks = (state: StateAfter): boolean =>
  same(regionsOf(state, 'pebble'), [['s']]) &&
  near(volumeOf(state, 'pebbleBody'), 240 * 2, 0.2 * 2) &&
  state.evaluation.bodies['pebbleBody'].faces.filter((f) => state.evaluation.faceNames[f.id].role === 'side').length === 1;

// A spline whose control polygon makes it cross itself: the profile is invalid (as the chain of its
// polyline was in the measurement), and an extrusion of the sketch is `invalidProfile`.
export function crossing(): boolean {
  const s = 'knot';
  run(sketchFeature(s));
  const state = run(point(s, 'n1', 0, 0), point(s, 'n2', 30, 0), point(s, 'n3', 30, 20), point(s, 'n4', 10, 20), point(s, 'n5', 10, -10), spline(s, 'k', ['n1', 'n2', 'n3', 'n4', 'n5']));
  return resultOf(state, s).valid === false;
}

// ---------------------------------------------------------------- changing the control points

// A sixth control point in the grip: the spline removed and added again under its ID in one batch.
// The region, the lid and its faces keep their names; the lid is still ok. Removing a control point
// alone removes the spline: the outline opens and the lid has no profile.
export function sixPoints(): boolean {
  const s = 'lidSketch';
  const state = done(engine.preview({ type: 'batch', commands: [point(s, 'g4', 39, 33), { type: 'removeEntity', sketch: s, id: 'c2' }, spline(s, 'c2', ['a2', 'g1', 'g2', 'g4', 'g3', 'a3'])] }));
  const without = done(engine.preview({ type: 'removeEntity', sketch: s, id: 'g2' }));
  return (
    same(regionsOf(state, s), [LID_REGION]) &&
    state.evaluation.features['lid'].status === 'ok' &&
    faceId(state, side('c2')) !== undefined &&
    without.evaluation.features['lid'].error?.code === 'noProfile'
  );
}

// ---------------------------------------------------------------- step 7, the part of 6d

// The section of the lid at half its thickness as DXF: one loop, no circle, the grips written as
// polylines through the corners of the mesh (the section's `curve` spans), its area that of the
// region's polygon (the volume over the thickness) to the precision of float32. 6f reads the file
// back and compares the areas.
const only = (exported: Exported): ExportFile => (exported.layout === 'file' && exported.files.length === 1 && exported.empty === undefined ? exported.files[0] : fail(exported.empty ?? 'one file is expected'));
export function lidSection(state: StateAfter): boolean {
  const exporter = engine as unknown as EngineAfter2g; // the engine with the export formats of 2g
  const file = only(unwrap(exporter.export('dxf', { plane: XY, offset: T / 2, bodies: ['lid'] })));
  const about = file.about as OutlineAbout;
  return about.loops === 1 && about.circles === 0 && near(about.area, volumeOf(state, 'lid') / T, 1e-3);
}

// The whole part of 6d, in order.
export function scenario(): boolean {
  const mirrored = mirroredWithGrip();
  const ok = oneRegionWithGrip(mirrored);
  const lid = lidWithGrip();
  const checks = lidWithGripChecks(lid) && deeperGrip();
  const closed = pebbleChecks(pebble());
  return ok && checks && closed && featureRefusals() && commandRefusals().every((text) => text !== undefined) && crossing() && sixPoints() && lidSection(lid);
}
