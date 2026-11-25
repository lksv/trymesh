// Validation scenario 15 (a cover for a controller board), the part of package 6d, written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract.
//
// Step 4 of the scenario: the lid outline, one half with a spline flank (a grip) and mirrored about
// the Y axis of the origin by 6c; the mirrored half closes into one region with the original. 6c's
// calls draw the flank `c2` as a line; here it is a spline over five control points under the same
// ID, so the region and the faces keep 6c's names. Then what the lid shows of the spline (the face,
// its edges, where the curve runs, the area against a value by hand, the pull of the grip as a
// parameter), the refusals, a closed spline, a spline that crosses itself, the change of control
// points. Step 6, the part of 6d: the second notch, a circle trimmed into the top line of the
// source half, with the spline flank in, and a plate whose hole is a closed spline: both follow a
// region whose loop has no exact curves through a cut of 6e. Step 7, the part of 6d: the section of
// the lid as DXF.
//
// Written after 6a2, 6e, 6c and 6b, which are implemented before 6d (docs/d36/6-plan.md): the
// mirror is about `origin/y` and the top's end is held on it (the owner's answer 1), the trims and
// the query of the contacts are 6e's (its revised contract is merged and imported), a projection
// of the spline is 6b's entry. The designs of 6e, 6c and 6b are merged; 6e's and 6c's types are
// imported, and 6b's tool and query are written as short declarations of what 6d reads of them.
//
// The numbers in the comments were measured so (design.md, "Measured"): the polyline, the joints
// and the box of a spline by a prototype of `spline.ts`; the solver by the real planegcs adapter
// with the control points and the legs (the half with a construction line through the origin in
// the place of `origin/y`, which stands at the same place); the region and the volume by the real
// profile and kernel with a prototype of the spline as one shape of the profile, both halves own
// geometry (6c is not implemented). The cases that run 6e's tools are not measured as a whole:
// the tools are not implemented. What they rest on is: the faces of `lineAcrossSplineSide` with the
// spline as the chain of its polyline pieces ("Measured", L).

import type { Id, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { ExportFile, Exported } from '../../../packages/engine/src/index';
import type { OutlineAbout } from '../../../packages/engine/src/export/outline';
import type { CommandAfter, EdgeNameAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { done, engine, fail, run, unwrap } from '../2a-offset/calls';
import { LID_REGION, parameters, stand } from '../6c-sketch-mirror-pattern/calls';
import type { OpenEnds, SketchPattern } from '../6c-sketch-mirror-pattern/contract';
import { contextOf } from '../6e-trim-extend-split/calls';
import { freshIds, sketchTool } from '../6e-trim-extend-split/contract';
import type { CutIds, SketchContactsResult, SketchToolInputsAfter } from '../6e-trim-extend-split/contract';
import type { EngineAfter2g } from '../2g-export/contract';
import type { SketchPlaceToolAfter, SketchResult6d, SourceSpline, SplineBatch, SplineContact, SplineDetail } from './contract';
import { PROJECT_SKETCH_IDS_6D, splineCommands } from './contract';

const XY = { kind: 'base', plane: 'XY' } as const;
const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const nearVec = (a: readonly number[] | undefined, b: readonly number[], tolerance = 1e-9): boolean => a !== undefined && a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const resultOf = (state: StateAfter, id: Id): SketchResult6d => (state.evaluation.features[id].sketch as SketchResult6d | undefined) ?? fail(`no result of "${id}"`);
const regionsOf = (state: StateAfter, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
const sketchFeature = (id: Id): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
const point = (sketch: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
const arc = (sketch: Id, id: Id, center: Id, start: Id, end: Id): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
const circle = (sketch: Id, id: Id, center: Id, radius: number): CommandAfter => ({ type: 'addCurve', sketch, id, curve: { type: 'circle', center }, radius });
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
const regionsOfFeature = (state: StateAfter, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
// The area of a region of the result: the polygon the body is built from, its outer loop less its
// holes.
const polygon = (xy: Float64Array): number => {
  let area = 0;
  for (let i = 0; i < xy.length; i += 2) area += xy[i] * xy[(i + 3) % xy.length] - xy[(i + 2) % xy.length] * xy[i + 1];
  return Math.abs(area) / 2;
};
const regionArea = (state: StateAfter, sketch: Id, outerLoop: Id[]): number => {
  const region = resultOf(state, sketch).regions.find((r) => same(r.ref.outerLoop, [...outerLoop].sort())) ?? fail('no such region');
  return polygon(region.loops[0]) - region.loops.slice(1).reduce((sum, hole) => sum + polygon(hole), 0);
};

// 6e's sketch tools, run on the state of the engine: the batch applied, and the lists answered.
const tool = <K extends 'trim' | 'split'>(name: K, sketch: Id, input: SketchToolInputsAfter[K], prefix: string): CutIds => {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) return fail(made.message);
  run(...made.commands);
  return made.ids as CutIds;
};
const trim = (sketch: Id, curve: Id, at: Vec2, prefix: string): CutIds => tool('trim', sketch, { curve, at }, prefix);
// What a tool would do, without doing it: its batch, or the text it refuses with.
const planned = <K extends 'trim' | 'split'>(name: K, sketch: Id, input: SketchToolInputsAfter[K]) => {
  const state = engine.getState();
  return sketchTool(name, contextOf(state, sketch), input, freshIds(state.document, 'x_'));
};
const trimRefusal = (sketch: Id, input: SketchToolInputsAfter['trim']): string | undefined => {
  const made = planned('trim', sketch, input);
  return made.ok ? undefined : made.message;
};
// 6e's query of the contacts (the owner's answer 5).
const contactsOf = (sketch: Id): SketchContactsResult => unwrap(engine.query('sketchContacts', { sketch }));
// Stand-ins for what is not in this tree.
// - MCP: `get_sketch` (packages/mcp/src/tools.ts, `sketchDetail`), as far as 6d reads it.
declare function getSketch(sketch: Id): { curves: ({ id: Id; type: 'line' | 'circle' | 'arc' } | SplineDetail)[] };
// - 6b: the entry of a projection, the tool `projectSketch` and the query `sketchSources`, as far
//   as 6d adds to them.
const projection = (sketch: Id, id: Id, from: Id, entity: Id, kind: string): CommandAfter => ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: from, entity, kind, regions: false } } as unknown as CommandAfter);
declare function projectSketch(into: Id, input: { sketch: Id; entities?: Id[]; as?: 'source' | 'reference' | 'regions' | 'own' }): { ok: true; commands: CommandAfter[]; ids: Record<string, Id[]> & { [K in keyof typeof PROJECT_SKETCH_IDS_6D]: Id[] } } | { ok: false; message: string };
declare function sketchSources(sketch: Id, from: Id): { entities?: ({ id: Id; kind: 'point' | 'line' | 'circle' | 'arc' } | SourceSpline)[] };
// 6c's field of the result: the ends of copies that stayed open.
const openEndsOf = (state: StateAfter, sketch: Id): OpenEnds | undefined => (resultOf(state, sketch) as { openEnds?: OpenEnds }).openEnds;

// ---------------------------------------------------------------- the numbers

// The lid W × H with corners of radius R, T thick (6c's parameters). The grip: the middle control
// point of the flank of each half is pulled in by `grip` at mid-height, its end legs are `reach`
// long and vertical, so the spline runs on from the corner arcs without a kink. The curve itself
// is `grip / 2` deep: it passes (W / 2 − grip / 2, H / 2).
const [W, H, R, T] = [84, 54, 5, 2];
const [GRIP, REACH] = [4, 10];
// The area a grip takes from the rectangle, by hand. The control points are (42, 5), (42, 15),
// (42 − d, 27), (42, 39), (42, 49), d the pull. Their two Bezier pieces (knot 1 inserted twice):
// (42, 5), (42, 15), (42 − d/2, 21), (42 − d/2, 27) and its mirror image about y = 27. Over the
// first piece the depth is w(t) = (d/2)(3t² − 2t³) and dy/dt = 30 − 24t + 12t², so its area is
// (d/2) ∫₀¹ (3t² − 2t³)(30 − 24t + 12t²) dt = (d/2) · 9.8; both pieces 9.8 d, 39.2 mm² for d = 4
// (the Gauss–Legendre integral of the prototype gives 39.200000).
const gripArea = (d: number): number => 9.8 * d;
const LID = W * H - (4 - Math.PI) * R * R; // 4514.5398, the lid of 6c
const LID_WITH_GRIPS = (d: number): number => LID - 2 * gripArea(d); // 4436.1398 for d = 4
// Measured: the region's polygon 4435.9046 mm², 0.2352 below; of that 0.19 is the arcs (6c) and
// 0.022 each grip (its polygon 39.2221 against 39.2); for d = 6 the polygon is 0.2431 below. The
// body is the prism of the polygon, so its volume is first compared with the polygon (to the
// precision of the float32 mesh) and then with the value by hand, within twice what was measured
// for the grips: (0.2 + 2 · 0.06) T.
const ALLOWANCE = (0.2 + 2 * 0.06) * T;
const PRISM = 1e-3; // mm³: a volume against the area of its polygon times the thickness

// ================================================================ step 4: the lid outline with a grip

export function gripParameters(): StateAfter {
  return run({ type: 'setParameter', name: 'grip', expr: `${GRIP}` }, { type: 'setParameter', name: 'reach', expr: `${REACH}` });
}

// The right half, drawn off its place and solved: `c1` along the bottom from the origin, the corner
// arc `r1`, the flank `c2` (a spline over `a2`, `g1`, `g2`, `g3`, `a3`), the corner arc `r2`, the top
// `c3`, which ends at `a5` on the Y axis `origin/y` (6a2). The legs `l1` (`a2` to `g1`) and `l2`
// (`g3` to `a3`) are construction lines, vertical and tangent to the arcs: the spline leaves `r1`
// and enters `r2` without a kink. Measured: 0 degrees of freedom, no redundant constraint;
// g1 (42, 15), g2 (38, 27), g3 (42, 39), a3 (42, 49), a5 (0, 54).
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
    line(s, 'c1', 'origin', 'a1'),
    arc(s, 'r1', 'q1', 'a1', 'a2'),
    spline(s, 'c2', ['a2', 'g1', 'g2', 'g3', 'a3']),
    arc(s, 'r2', 'q2', 'a3', 'a4'),
    line(s, 'c3', 'a4', 'a5'),
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
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
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

// The mirror of 6c: the five curves about `origin/y`, the spline among them. Its copy `m/1/c2` runs
// over the copies of the control points in the same order; its ends `m/1/a2`, `m/1/a3` are the ends
// of the copies of the arcs, so the outline is one loop as in 6c.
export function mirroredWithGrip(): StateAfter {
  parameters();
  stand();
  gripParameters();
  lidHalfWithGrip();
  return run(mirror('lidSketch', 'm', ['c1', 'r1', 'c2', 'r2', 'c3'], 'origin/y'));
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

// Where the grip runs, as `get_sketch` says it for the AI (the owner's answer 26): five points the
// curve passes, its two ends, the joint of its two Bezier pieces and the middle of each piece. The
// joint is `grip / 2` inside the flank, not `grip`; and the box is half as deep as the box of the
// control points. Measured: (42, 5), (41, 17.5), (40, 27), (41, 36.5), (42, 49); x from 40 to 42,
// y from 5 to 49.
export function gripDetail(): boolean {
  const detail = getSketch('lidSketch').curves.find((curve): curve is SplineDetail => curve.id === 'c2' && curve.type === 'spline') ?? fail('no spline "c2"');
  const through = detail.through ?? fail('no `through`');
  return (
    same(detail.points, ['a2', 'g1', 'g2', 'g3', 'a3']) &&
    through.length === 5 &&
    nearVec(through[0], [W / 2, R], 1e-6) &&
    nearVec(through[1], [W / 2 - GRIP / 4, 17.5], 1e-6) &&
    nearVec(through[2], [W / 2 - GRIP / 2, H / 2], 1e-6) &&
    nearVec(through[3], [W / 2 - GRIP / 4, 36.5], 1e-6) &&
    nearVec(through[4], [W / 2, H - R], 1e-6) &&
    nearVec(detail.box, [W / 2 - GRIP / 2, R, W / 2, H - R], 1e-6)
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

// The volume is the prism of the region's polygon, and within the allowance of the value by hand;
// the flank of each half is one face, a swept surface along the extrusion; the edges of a grip
// face are of the kind `other` (the top, the bottom, and the two straight edges where it meets the
// arcs: a swept surface meets a cylinder there, which no rule takes for a line).
export function lidWithGripChecks(state: StateAfter): boolean {
  const flank = faceId(state, side('c2'));
  const copy = faceId(state, side('m/1/c2'));
  const surface = flank === undefined ? undefined : state.evaluation.faceSurfaces[flank];
  const edges = state.evaluation.bodies['lid'].edges.filter((e) => same(e.name.a, side('c2')) || same(e.name.b, side('c2')));
  const axis: Vec3 | undefined = surface?.kind === 'swept' ? surface.axis : undefined;
  return (
    near(volumeOf(state, 'lid'), regionArea(state, 'lidSketch', LID_REGION) * T, PRISM) &&
    near(volumeOf(state, 'lid'), LID_WITH_GRIPS(GRIP) * T, ALLOWANCE) && // measured 8871.8091, by hand 8872.2796
    copy !== undefined &&
    (nearVec(axis, [0, 0, 1]) || nearVec(axis, [0, 0, -1])) &&
    edges.length === 4 &&
    edges.every((e) => e.kind === 'other')
  );
}

// The pull of the grip follows its parameter: 6 moves `g2` to x = 36 and its copy to −36, the
// curve to x = 39, and the lid loses 9.8 · 2 mm² more per grip (measured 8832.5934, by hand
// 8833.0796).
export const deeperGrip = (): boolean => {
  const state = done(engine.preview({ type: 'setParameter', name: 'grip', expr: '6' }));
  return (
    near(resultOf(state, 'lidSketch').points['g2']?.x, 36, 1e-9) &&
    near(resultOf(state, 'lidSketch').points['m/1/g2']?.x, -36, 1e-9) &&
    near(volumeOf(state, 'lid'), regionArea(state, 'lidSketch', LID_REGION) * T, PRISM) &&
    near(volumeOf(state, 'lid'), LID_WITH_GRIPS(6) * T, ALLOWANCE)
  );
};

// ---------------------------------------------------------------- what a spline is refused for

// Errors of features (the command is valid, the recompute refuses), each naming the spline:
// - the offset of the lid region: no exact outline (`invalidProfile`, refs the two splines);
// - a chamfer of the edge of the top along the grip: the edge is of the kind `other`
//   (`unsupportedEdge`, D63); and of the straight top edge of `c3` with its copy's, which runs on
//   smoothly into the arcs and, through them, ends at the grips: no edge of this rim can be
//   chamfered (the owner's answer 24), so the lid has no chamfer;
// - a revolve of a closed spline beside the Y axis: no exact outline (`invalidProfile`, answer 23).
export function featureRefusals(): boolean {
  const chamferOf = (edges: EdgeNameAfter[]) => errorOf({ type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'lid', edges, distance: 0.5 } }, 'ch');
  const topOf = (curve: Id): EdgeNameAfter => ({ a: TOP, b: side(curve) });
  const offset = errorOf(extrudeRegions('lidOffset', 'lidSketch', [LID_REGION], 'T', 1), 'lidOffset');
  const revolve = errorOf({ type: 'addFeature', feature: { id: 'rv', name: 'rv', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'pebble', regions: [{ outerLoop: ['s'] }] }, axis: { kind: 'base', axis: 'Y' }, extent: { type: 'full' }, operation: 'new' } }, 'rv');
  return (
    offset?.code === 'invalidProfile' &&
    same(offset.refs, ['c2', 'm/1/c2']) && // the splines of the selection, each once, sorted
    chamferOf([GRIP_EDGE])?.code === 'unsupportedEdge' &&
    chamferOf([topOf('c3'), topOf('m/1/c3')])?.code === 'unsupportedEdge' &&
    chamferOf([topOf('c3'), topOf('m/1/c3'), topOf('r2'), topOf('m/1/r2')])?.code === 'unsupportedEdge' &&
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
    trimRefusal(s, { curve: 'c2', at: [W / 2 - GRIP / 2, H / 2] }), // 6e: a spline is not trimmed, split or extended
    // the same place without `curve`: the curve it means is the grip, so it is refused naming "c2",
    // and the nearest curve that can be trimmed is not trimmed in its place (review 2, major 2a)
    trimRefusal(s, { at: [W / 2 - GRIP / 2, H / 2] }),
    // the mirrored place lies on the copy `m/1/c2` of the grip, a spline that is not own: refused as
    // a place on a copy is (6e), which takes the copy measured by its polyline (the light read)
    trimRefusal(s, { at: [-(W / 2 - GRIP / 2), H / 2] }),
  ];
}

// A projection of the spline into a later sketch is refused, with 6d's texts (the owner's answer
// 22): `kind: 'spline'` by the form of 6b's entry, and the spline named as a line by the check of
// the command against the source. Its control points are projected as points. The tool
// `projectSketch` of 6b projects the rest of the lid's sketch and lists the splines it left out;
// asked for the spline by name it refuses; the query `sketchSources` lists the spline with its
// kind and no place.
export function projectionRefused(): boolean {
  run(sketchFeature('over'));
  const asSpline = refused(projection('over', 'e1', 'lidSketch', 'c2', 'spline'));
  const asLine = refused(projection('over', 'e2', 'lidSketch', 'c2', 'line'));
  const point = engine.preview(projection('over', 'e3', 'lidSketch', 'g2', 'point'));
  const whole = projectSketch('over', { sketch: 'lidSketch' });
  const named = projectSketch('over', { sketch: 'lidSketch', entities: ['c1', 'c2'] });
  const listed = sketchSources('over', 'lidSketch').entities?.find((entity): entity is SourceSpline => entity.id === 'c2' && entity.kind === 'spline');
  return (
    asSpline?.includes('a spline is not projected yet') === true &&
    asLine?.includes('a spline is not projected yet') === true &&
    point.ok &&
    whole.ok &&
    same(whole.ids.splines, ['c2', 'm/1/c2']) && // the source's own spline, then the copy that forms regions
    !named.ok &&
    named.message.includes('"c2"') &&
    listed?.whole === false
  );
}

// A source curve that becomes a spline under its ID after it was projected (a line replaced by
// a spline in one batch, as the flank of the lid replaces 6c's line): the projection is frozen at
// its last values with the warning `brokenProjection`, 6b's answer to an entity of another kind,
// and nothing throws (review 2, minor 3).
export function projectionBroken(): boolean {
  run(sketchFeature('src'));
  run(point('src', 'qa', 0, 60), point('src', 'qm', 5, 65), point('src', 'qb', 10, 60), line('src', 'q', 'qa', 'qb'));
  run(sketchFeature('follower'));
  run(projection('follower', 'f1', 'src', 'q', 'line'));
  const state = done(engine.preview({ type: 'batch', commands: [{ type: 'removeEntity', sketch: 'src', id: 'q' }, spline('src', 'q', ['qa', 'qm', 'qb'])] }));
  const follower = state.evaluation.features['follower'];
  return follower.status !== 'error' && follower.warnings.some((issue) => issue.code === 'brokenProjection') && near(resultOf(state, 'follower').points['f1/b']?.x, 10, 1e-9);
}

// ---------------------------------------------------------------- a closed spline, a crossing one

// A closed spline over the corners of a square 20 × 20 beside the Y axis (x from 10 to 30): one
// region named by the spline alone; extruded, one side face. Measured: exact area 240 (the Gauss–
// Legendre integral of the prototype), the polygon at 0.01 mm 239.8216 (82 pieces), the volume
// 479.6431; a corner at (10, 0), where the first and the last leg meet at a right angle; the curve
// passes (25, 15) and stays within x 10 to 27.78, y 0 to 17.78.
export function pebble(): StateAfter {
  const s = 'pebble';
  run(sketchFeature(s));
  run(point(s, 'b1', 10, 0), point(s, 'b2', 30, 0), point(s, 'b3', 30, 20), point(s, 'b4', 10, 20), spline(s, 's', ['b1', 'b2', 'b3', 'b4', 'b1']));
  return run(extrudeRegions('pebbleBody', s, [['s']], 2));
}
export const pebbleChecks = (state: StateAfter): boolean =>
  same(regionsOf(state, 'pebble'), [['s']]) &&
  near(volumeOf(state, 'pebbleBody'), regionArea(state, 'pebble', ['s']) * 2, PRISM) &&
  near(volumeOf(state, 'pebbleBody'), 240 * 2, 0.3 * 2) && // measured 0.357 below
  state.evaluation.bodies['pebbleBody'].faces.filter((f) => state.evaluation.faceNames[f.id].role === 'side').length === 1;

// The case the first design got wrong (review, finding 1): a triangle of long lines at the point of
// the closed spline. Both the spline and the triangle are regions, and the body of the spline's
// region stays as it was. With the first rule of the half-edges the region `s` was gone, with
// `valid: true`, once the lines were longer than 42 mm.
export function pebbleWithLongLines(): boolean {
  const s = 'pebble';
  const state = run(point(s, 'z1', -190, -240), point(s, 'z2', -190, 260), line(s, 'u1', 'b1', 'z1'), line(s, 'u2', 'z2', 'b1'), line(s, 'u3', 'z1', 'z2'));
  const ok = resultOf(state, s).valid && same(regionsOf(state, s), [['s'], ['u1', 'u2', 'u3']]) && state.evaluation.features['pebbleBody'].status === 'ok';
  run({ type: 'removeEntity', sketch: s, id: 'z1' }, { type: 'removeEntity', sketch: s, id: 'z2' }); // the lines go with their points
  return ok;
}

// A spline whose control polygon makes it cross itself: the profile is invalid (as the chain of its
// polyline was in the measurement), and the query of 6e says why: one contact whose two curves are
// the spline, which no cut repairs.
export function crossing(): boolean {
  const s = 'knot';
  run(sketchFeature(s));
  const state = run(point(s, 'n1', 0, 0), point(s, 'n2', 30, 0), point(s, 'n3', 30, 20), point(s, 'n4', 10, 20), point(s, 'n5', 10, -10), spline(s, 'k', ['n1', 'n2', 'n3', 'n4', 'n5']));
  const contacts = contactsOf(s);
  return resultOf(state, s).valid === false && contacts.valid === false && contacts.total === 1 && same(contacts.contacts[0].curves, ['k', 'k']) && contacts.contacts[0].kind === 'crossing' && contacts.contacts[0].fix === 'none' && contacts.contacts[0].why !== undefined && contacts.reason !== undefined;
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

// ================================================================ step 6, the part of 6d

// The second notch of the scenario with the spline flank in (6e with 6c; 6d brings the loop without
// exact curves). A circle `nk` of radius 4 whose centre lies on the top line `c3` of the source
// half at x = 20; two trims of 6e leave the notch: the arc of the circle outside the outline goes,
// then the piece of the line inside the circle. 6c patches the entry of the mirror, so the copy has
// the notch at x = −20. The lid's region passes the two splines, so its loop has no exact curves:
// 6e's face rule follows it on its polygon. The lid keeps one region with the grips and the notch
// arcs, and loses two half discs. Corrected after the implementation (its review, deviation 1): the
// first trim leaves the half disc of the notch a second region of the lid, which the second trim
// takes away, so the second lists the lid in `dropped`, as 6e's own notch of scenario 15 does.
// Run after `lidWithGrip`, last: it changes the lid's sketch.
const NOTCH_R = 4;
export function notchWithGrip(): boolean {
  const s = 'lidSketch';
  run(point(s, 'nc', 20, H), circle(s, 'nk', 'nc', NOTCH_R));
  const first = trim(s, 'nk', [20, H + NOTCH_R], 'n1_');
  const second = trim(s, 'c3', [20, H], 'n2_');
  const state = engine.getState();
  const region = regionsOfFeature(state, 'lid');
  return (
    !first.dropped.includes('lid') &&
    same(second.dropped, ['lid']) && // corrected after the implementation (deviation 1)
    resultOf(state, s).valid &&
    region.length === 1 &&
    region[0].includes('c2') &&
    region[0].includes('m/1/c2') &&
    region[0].includes('nk') &&
    region[0].includes('m/1/nk') &&
    state.evaluation.features['lid'].status === 'ok' &&
    near(volumeOf(state, 'lid'), regionArea(state, s, region[0]) * T, PRISM) &&
    near(volumeOf(state, 'lid'), (LID_WITH_GRIPS(GRIP) - Math.PI * NOTCH_R * NOTCH_R) * T, ALLOWANCE + 0.06 * 2 * T)
  );
}

// A plate 40 × 40 whose hole is a closed spline, extruded as the region of its four lines; a notch
// of radius 3 trimmed into its bottom edge. The plate's feature keeps a region whose hole is the
// spline's loop, which has no exact curves: a point inside the hole must not count as plate, so
// the region `s` of the hole is not added to the feature (review, finding 3, case B), and the body
// keeps its hole. Measured before the notch: the volume 2720.3569, which is (1600 − 239.8216) · 2.
// As for the lid, the second trim lists the plate in `dropped` (corrected after the implementation,
// deviation 1).
export function plateWithSplineHole(): boolean {
  const s = 'plateSketch';
  run(sketchFeature(s));
  run(
    point(s, 'r1', 0, -10),
    point(s, 'r2', 40, -10),
    point(s, 'r3', 40, 30),
    point(s, 'r4', 0, 30),
    line(s, 'pa', 'r1', 'r2'),
    line(s, 'pb', 'r2', 'r3'),
    line(s, 'pc', 'r3', 'r4'),
    line(s, 'pd', 'r4', 'r1'),
    point(s, 'b1', 10, 0),
    point(s, 'b2', 30, 0),
    point(s, 'b3', 30, 20),
    point(s, 'b4', 10, 20),
    spline(s, 's', ['b1', 'b2', 'b3', 'b4', 'b1']),
  );
  const before = run(extrudeRegions('plate', s, [['pa', 'pb', 'pc', 'pd']], 2));
  const hole = regionArea(before, s, ['s']); // 239.8216
  run(point(s, 'kc', 20, -10), circle(s, 'kn', 'kc', 3));
  const first = trim(s, 'kn', [20, -13], 'k1_');
  const second = trim(s, 'pa', [20, -10], 'k2_');
  const state = engine.getState();
  const regions = regionsOfFeature(state, 'plate');
  const offset = errorOf(extrudeRegions('plateOffset', s, regions, 2, 1), 'plateOffset');
  return (
    near(volumeOf(before, 'plate'), (1600 - hole) * 2, PRISM) &&
    !first.dropped.includes('plate') &&
    same(second.dropped, ['plate']) && // corrected after the implementation (deviation 1)
    regions.length === 1 &&
    !regions.some((loop) => same(loop, ['s'])) &&
    state.evaluation.features['plate'].status === 'ok' &&
    near(volumeOf(state, 'plate'), (1600 - hole - (Math.PI * 9) / 2) * 2, 0.1 * 2) && // the arc of the notch is a polygon
    // and a region with a spline hole is not offset: the refusal names the spline of the hole
    offset?.code === 'invalidProfile' &&
    same(offset.refs, ['s'])
  );
}

// ---------------------------------------------------------------- 6e's tools beside a spline

// The one contact no tool can cut, repaired the natural way (review 2, major 1). An outline 20 × 20
// whose left side is a spline, extruded; a line from (−5, 10) to (25, 10) across it. The profile is
// invalid: the line crosses the spline (`fix: 'none'`, with the reason) and the right side
// (`fix: 'cut'`). A trim of the line by a place between the two takes the piece from (−5, 10) to
// its cut on the right side, which is cut there; the tail outside the outline stays. The sketch is
// valid again and the body's region names a changed curve, so it is followed: the faces are the
// profile with the removed piece put back, and that piece crosses the spline. In that world the
// spline is the chain of its polyline pieces, split at the contact (`splineChain`), so the faces
// are a valid profile, two faces that make up the region, and the body is not in `dropped`.
// Measured with the faces built by hand: with the spline whole they are no valid profile; with the
// chain, two faces of 220.33907 mm² each, the region's 440.678141 (chord tolerance 0.01).
export function lineAcrossSplineSide(): boolean {
  const s = 'crossed';
  run(sketchFeature(s));
  run(point(s, 'ka', 0, 0), point(s, 'kb', 20, 0), point(s, 'kc', 20, 20), point(s, 'kd', 0, 20), point(s, 'w1', -4, 14), point(s, 'w2', -4, 6));
  run(line(s, 'bt', 'ka', 'kb'), line(s, 'rt', 'kb', 'kc'), line(s, 'tp', 'kc', 'kd'), spline(s, 'sp', ['kd', 'w1', 'w2', 'ka']));
  const before = run(extrudeRegions('crossedBody', s, [['bt', 'rt', 'sp', 'tp']], 2));
  const volume = volumeOf(before, 'crossedBody');
  run(point(s, 'l0', -5, 10), point(s, 'l1', 25, 10), line(s, 'ln', 'l0', 'l1'));
  const contacts = contactsOf(s);
  const withSpline = contacts.contacts.find((contact): contact is SplineContact => contact.curves.includes('sp'));
  const ids = trim(s, 'ln', [10, 10], 'c_');
  const state = engine.getState();
  const region = regionsOfFeature(state, 'crossedBody');
  return (
    contacts.valid === false &&
    contacts.total === 2 &&
    withSpline?.kind === 'crossing' &&
    withSpline.fix === 'none' &&
    contacts.contacts.some((contact) => contact.curves.includes('ln') && contact.curves.includes('rt') && contact.fix === 'cut') &&
    resultOf(state, s).valid &&
    !ids.dropped.includes('crossedBody') &&
    ids.patched.includes('crossedBody') &&
    region.length === 1 &&
    region[0].includes('sp') &&
    state.evaluation.features['crossedBody'].status === 'ok' &&
    near(volumeOf(state, 'crossedBody'), volume, PRISM)
  );
}

// Two ends at one place, one of them a spline's (review 2, major 2b): the last control point of
// a spline lies at the end of a line without being that point, which is what an AI writes and what
// the converter met. The query lists the place with `fix: 'join'`; `split` without a curve joins
// the two, and its batch never re-points the spline, which `setCurvePoint` refuses.
// - The end of the line named by nothing but the line: the line is re-pointed onto the spline's
//   point, and the orphan goes.
// - The end of the line named by a dimension too (`dimensioned`): neither curve is re-pointed, and
//   a `coincident` joins the two points.
export function endsAtOnePlace(dimensioned: boolean): boolean {
  const s = dimensioned ? 'unjoinedHeld' : 'unjoined';
  run(sketchFeature(s));
  run(point(s, 'ua', 0, 0), point(s, 'ub', 20, 0), point(s, 'uc', 10, 12), point(s, 'ud', 0, 0), spline(s, 'us', ['ub', 'uc', 'ua']), line(s, 'ul', 'ud', 'ub'));
  if (dimensioned) run(constrain(s, 'ux', { type: 'horizontalDistance', a: 'ud', b: 'ub', value: 20, driving: true }));
  const contacts = contactsOf(s);
  const made = planned('split', s, {});
  if (!made.ok) return fail(made.message);
  const state = run(...made.commands);
  const repointed = made.commands.filter((command) => command.type === 'setCurvePoint').map((command) => command.id);
  const joined = made.commands.some((command) => command.type === 'addConstraint' && command.constraint.type === 'coincident');
  return (
    contacts.valid === false &&
    contacts.contacts.length === 1 &&
    contacts.contacts[0].kind === 'ends' &&
    contacts.contacts[0].fix === 'join' &&
    (dimensioned ? repointed.length === 0 && joined : same(repointed, ['ul']) && !joined) &&
    resultOf(state, s).valid &&
    same(regionsOf(state, s), [['ul', 'us']])
  );
}

// What names a point (review 2, major 2c): a construction leg from the end of a spline to its
// second control point, trimmed away. It crosses nothing, so it goes whole with its constraint,
// and "its ends that nothing else names go with it". Nothing but the leg and the spline names the
// far end `e1` (the one constraint is on the line), and `e1` is an inner control point: named by
// the spline, it stays. Read from the ends of curves, the rule removes it, and `removeEntity`
// takes the spline with it. (The lid's own leg `l1` cannot show this: a dimension names its far
// end `g1`, which keeps the point under either reading.)
export function legTrimmedAway(): boolean {
  const s = 'leg';
  run(sketchFeature(s));
  run(point(s, 'e0', 0, 70), point(s, 'e1', 0.2, 76), point(s, 'e2', 8, 80), point(s, 'e3', 14, 74), spline(s, 'es', ['e0', 'e1', 'e2', 'e3']), line(s, 'el', 'e0', 'e1', true));
  run(constrain(s, 'ev', { type: 'vertical', line: 'el' }));
  const made = planned('trim', s, { curve: 'el', at: [0, 73] });
  if (!made.ok) return fail(made.message);
  const state = run(...made.commands);
  const ids = made.ids as CutIds;
  const after = contextOf(state, s).sketch;
  return ids.removed.includes('el') && ids.removed.includes('ev') && !ids.removed.includes('e1') && !ids.removed.includes('es') && after.points['e1'] !== undefined && after.curves['es'] !== undefined;
}

// The ends of a copied spline join by position, as the ends of a copied line do (review 2, minor
// 2; 6c's position stage, which the lid does not reach: there the ends of the spline's copy are
// the ends of the copies of the arcs, one ID). A spline from the origin to a point held on the
// Y axis, mirrored about it: one region of the spline and its copy, and no open end.
export function archMirrored(): boolean {
  const s = 'arch';
  run(sketchFeature(s));
  run(point(s, 'top', 0.3, 30.2), point(s, 'h1', 12, 2), point(s, 'h2', 14, 26), spline(s, 'half', ['origin', 'h1', 'h2', 'top']));
  run(constrain(s, 'on', { type: 'pointOnCurve', point: 'top', curve: 'origin/y' }));
  const state = run(mirror(s, 'm', ['half'], 'origin/y'));
  return resultOf(state, s).valid && same(regionsOf(state, s), [['half', 'm/1/half']]) && openEndsOf(state, s) === undefined;
}

// ---------------------------------------------------------------- the app's part, type-checked

// What the contract promises of the app has to be writable (review 2, minor 7): a batch of
// `splineCommands` holds an `addCurve` with a spline, and an entry of the table of the sketch
// tools may say `infer: 'extension'`.
export const exampleBatch: SplineBatch = { commands: [point('lidSketch', 'n1', 0, 0), spline('lidSketch', 'n', ['n1', 'g1', 'g2'])] };
export const exampleTool: SketchPlaceToolAfter<undefined> = {
  label: 'Spline',
  hint: 'Click the control points; Enter ends the spline, a click on the first point closes it, Esc drops it.',
  infer: 'extension',
  click: (_host, _m, places) => places, // every place is kept; the mode redraws
  finish: (host, m, places, context) => {
    const batch = splineCommands(m.id, context.view, [], false, host.newId);
    if ('problem' in batch) host.say(batch.problem);
    return 'problem' in batch ? places : undefined;
  },
};

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
  const ok = oneRegionWithGrip(mirrored) && gripDetail();
  const lid = lidWithGrip();
  const checks = lidWithGripChecks(lid) && deeperGrip() && lidSection(lid);
  const closed = pebbleChecks(pebble()) && pebbleWithLongLines();
  const refusals = featureRefusals() && commandRefusals().every((text) => text !== undefined) && projectionRefused() && projectionBroken();
  const beside = lineAcrossSplineSide() && endsAtOnePlace(false) && endsAtOnePlace(true) && legTrimmedAway() && archMirrored();
  return ok && checks && closed && refusals && crossing() && sixPoints() && beside && plateWithSplineHole() && notchWithGrip();
}
