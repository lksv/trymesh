// What the steps of the feature types share: reading the state (a frame of a plane reference, an
// axis), applying a tool to its targets, the texts of issues. Functions over the state, imported by
// the modules of the feature types; they are not handed over in a context that would grow with them.
import { type FaceInfo, analyzeBody, faceFrame, mirrors, onSurface, toWorld, turnedOver, volumeOf } from '../solid';
import type { AxisRef, Frame, Id, Issue, IssueCode, PlaneRef, Solid, SolidKernel, Vec3 } from '../types';
import { LENGTH_TOLERANCE, dot3, faceKey, faceNumber, has, mul3, sub3, unit3 } from '../util';
import { type Applied, type BuiltTool, type Done, type Failed, type Model, type Placement, type State, type Step, type ToolRecipe, ToolProblem } from './state';

// Záznam podle ID, které v něm nemusí být. ID přichází z odkazu v dokumentu a může se jmenovat
// jako vlastnost každého objektu (`constructor`, `toString`); ta se za záznam nepočítá.
export const lookup = <T>(record: Record<Id, T>, id: Id): T | undefined => (has(record, id) ? record[id] : undefined);

export const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

export const MESSAGE: Record<IssueCode, string> = {
  brokenReference: 'The reference leads to a plane, face, sketch or body that does not exist at this point of the timeline.',
  noProfile: 'The selected region is not in the sketch.',
  invalidProfile: 'Curves of the sketch cross or touch away from joined points, or are closer to each other than the division of arcs into segments can resolve.',
  nonPlanarFace: 'The face is not planar.',
  emptyResult: 'The operation would remove the whole body.',
  kernelFailure: 'The geometric kernel could not perform the operation.',
  sketchConflict: 'The constraints of the sketch contradict each other or the sketch could not be solved.',
  brokenProjection: 'The projected geometry is no longer in its source; it keeps its last valid place.',
  degenerateProjection: 'The geometry has no extent in this sketch: it projects to a point.',
  unsupportedProjection: 'The geometry cannot be projected into this sketch.',
  noEffect: 'The operation did not change the body.',
  gearMesh: 'The gear cannot be put in mesh with the gear it refers to.',
  gearInterference: 'The tip of one gear of the pair runs into the root of the other.',
  invalidExpression: 'The expression of a numeric field cannot be evaluated or gives a value outside the range of the field.',
  invalidExtent: 'The extent cannot use its plane: the tool cannot reach the plane it is to end in, or cannot start in its start plane.',
  invalidHole: 'The dimensions do not make a hole.',
  invalidPattern: 'The counts, the directions and the spans do not make a pattern.',
  importedTarget: 'A target or a tool is an imported mesh, which no feature may change.',
  invalidClearance: 'The tool cannot be moved outwards by the clearance without a change of its shape.',
  invalidAxis: 'The axis cannot be used: its line has no length or its face has no axis; for a revolve it does not lie in the plane of the profile or the profile lies on both sides of it; for the tilt of a plane it is not parallel to the plane.',
  unsupportedEdge:
    'The edge cannot be chamfered or filleted: only a straight edge between two planes and a circular edge between a plane, a cylinder or a cone about one axis can, ending at a plane, running out into a hole, a pocket or a boss it crosses (a cylinder; for a circular edge also a plane parallel to its axis, such as the side of a keyway), running out through a round wall into the air outside it, meeting another edge of the same feature at a vertex, or running on smoothly into an edge of the same feature. An edge that would have to stop at a round face or bridge a gap is not taken yet.',
  blendDoesNotFit: 'The chamfer or fillet does not fit on the faces next to the edge: a face would vanish, or the tool reaches material it must not touch.',
  jointLimits: 'The lower limit of the joint is above its upper limit.',
  jointOutOfLimits: 'The value of the joint is outside its limits.',
  brokenCopies: 'A mirror or pattern of the sketch cannot make all its copies.',
  insertedIssues: 'The inserted document did not recompute cleanly with the values of this insertion: a feature of it is in error or a check of it fails.',
};
export const issue = (code: IssueCode, refs?: unknown[], detail?: string): Issue => ({ code, message: detail ? `${MESSAGE[code]} (${detail})` : MESSAGE[code], ...(refs ? { refs } : {}) });

// The largest coordinate of a solid: the scale its float32 positions are precise to.
export const reach = (s: Solid): number => s.positions.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

// The frame of a plane reference in a state: a base plane, a plane feature, or a planar face of a body.
export function frame(ref: PlaneRef, state: State): Frame | IssueCode {
  if (ref.kind === 'base') return BASE[ref.plane];
  if (ref.kind === 'plane') return lookup(state.planes, ref.feature) ?? 'brokenReference';
  const solid = lookup(state.bodies, ref.body);
  const id = faceNumber(state, ref.face);
  if (!solid || id === undefined) return 'brokenReference';
  return faceFrame(analyzeBody(solid, state.faceNames, state.faceInfos, state.chordTolerance), id, state.faceInfos[id]);
}

// The line of an axis reference in a state: a base axis through the origin, the normal of a sketch
// through one of its solved points, or a line of a sketch through its point `a` from `a` to `b`
// (the direction is then `b − a`, not of unit length). A sketch that did not evaluate, a point or
// a line without a place in it is `brokenReference`; a line whose ends are not more than
// `LENGTH_TOLERANCE` apart is `invalidAxis` with the line in `refs` and `detail` saying so. A projected line whose edge is
// gone keeps its last valid place in the sketch, and so does the axis.
// The axis of a round face (D60): the line of its exact surface through the origin of a cylinder,
// the apex of a cone or the centre of a torus, its unit direction turned to the sense the build
// gave the face (`along`). A body or a face not in the state (the face not on that body) is
// `brokenReference`; a face without an axis is `invalidAxis` with the axis in `refs`.
export function axis(ref: AxisRef, state: State): { point: Vec3; direction: Vec3 } | { code: IssueCode; refs: unknown[]; detail?: string } {
  if (ref.kind === 'base') return { point: [0, 0, 0], direction: [ref.axis === 'X' ? 1 : 0, ref.axis === 'Y' ? 1 : 0, ref.axis === 'Z' ? 1 : 0] };
  if (ref.kind === 'face') {
    const solid = lookup(state.bodies, ref.body);
    if (!solid) return { code: 'brokenReference', refs: [ref.body] };
    const id = faceNumber(state, ref.face);
    if (id === undefined || !analyzeBody(solid, state.faceNames, state.faceInfos, state.chordTolerance).normalSum.has(id)) return { code: 'brokenReference', refs: [ref.face] };
    const info = state.faceInfos[id];
    if (info.planar || (info.surface !== 'cylinder' && info.surface !== 'cone' && info.surface !== 'torus')) {
      return { code: 'invalidAxis', refs: [ref], detail: `the face is ${info.planar ? 'a plane' : `a surface of the kind ${info.surface === 'mesh' ? 'general' : info.surface}`} and has no axis` };
    }
    const unit = unit3(info.axis);
    const direction = dot3(unit, info.along) < 0 ? mul3(unit, -1) : unit;
    return { point: info.surface === 'cone' ? info.apex : info.center, direction: [direction[0] + 0, direction[1] + 0, direction[2] + 0] };
  }
  const sketch = lookup(state.sketches, ref.sketch);
  if (!sketch) return { code: 'brokenReference', refs: [ref.sketch] };
  if (ref.kind === 'sketchLine') {
    const line = sketch.curves.get(ref.line)?.shape;
    const [a, b] = line?.type === 'line' ? [lookup(sketch.geometry.points, line.a), lookup(sketch.geometry.points, line.b)] : [];
    if (!a || !b) return { code: 'brokenReference', refs: [ref.line] };
    if (Math.hypot(b.x - a.x, b.y - a.y) <= LENGTH_TOLERANCE) return { code: 'invalidAxis', refs: [ref.line], detail: 'the line of the axis has no length' };
    const from = toWorld(sketch.frame, a.x, a.y);
    return { point: from, direction: sub3(toWorld(sketch.frame, b.x, b.y), from) };
  }
  const at = lookup(sketch.geometry.points, ref.point);
  if (!at) return { code: 'brokenReference', refs: [ref.point] };
  return { point: toWorld(sketch.frame, at.x, at.y), direction: sketch.frame.normal };
}

// Applies a tool to its targets: a boolean operation with each of them. It works from the recipe
// alone, so any feature that produces a tool (an extrusion today) is applied the same way, and
// a pattern applies it again in another placement.
// - A missing target is a broken reference.
// - A target that has a face of an imported mesh (the body of a mesh feature, or a copy of it) is
//   the error `importedTarget` with those targets in `refs`, before anything is built (D55).
// - A cut that would remove a whole target is an error and changes none of them.
// - Targets the tool did not change are returned in `unchanged`. When it changed none, its faces
//   are in no body and do not enter the face table either.
// - A tool marked `refuseChange` that changed a target is the error of the mark, with the changed
//   targets in `refs`, and changes none of them; also when it would remove a target whole.
// - A tool of a mirrored placement (a copy of the pattern `mirror`) is turned over right after its
//   build. A build places every vertex by the frame it is given and winds its triangles as for
//   a right-handed frame; in the left-handed frame of a mirrored copy every triangle then faces
//   inwards. Here, once for every build; a build must not correct it itself.
export function applyTool(recipe: ToolRecipe, model: Model, kernel: SolidKernel, placement?: Placement): Applied {
  const missing = recipe.targets.filter((target) => !lookup(model.bodies, target));
  if (missing.length || recipe.targets.length === 0) return { ok: false, code: 'brokenReference', refs: missing.length ? missing : [recipe.targets] };
  const imported = recipe.targets.filter((target) => isImported(model.bodies[target], model.faceInfos));
  if (imported.length) return { ok: false, code: 'importedTarget', refs: imported };
  const first = model.faceNames.length;
  const bodies = { ...model.bodies };
  const unchanged: Id[] = [];
  let tool: BuiltTool;
  try {
    tool = recipe.build(recipe.targets.map((target) => model.bodies[target]), first, placement);
    if (placement && mirrors(placement.transform)) tool = { ...tool, solid: turnedOver(tool.solid) };
    for (const target of recipe.targets) {
      const before = model.bodies[target];
      const result = kernel.boolean(recipe.operation === 'add' ? 'union' : 'difference', before, tool.solid);
      // a tool that must not change a target and removed one whole is the error of its mark, not emptyResult
      if (result.triangles.length === 0) return tool.refuseChange ? { ok: false, code: tool.refuseChange.code, refs: [target], detail: tool.refuseChange.detail } : { ok: false, code: 'emptyResult', refs: [target] };
      // Bez účinku: objem se nezměnil. U výřezu navíc ve výsledku nesmí být žádná stěna nástroje;
      // u přidání být může (nástroj uvnitř tělesa, jehož stěna lícuje se stěnou tělesa, ji přejmenuje).
      // Změna objemu se měří proti menšímu z obou těles: drobný výstupek na velké desce účinek má.
      // A cut copy of a pattern has no effect also when faces of its tool are in the result but
      // the shape is what it was: a copy that lands on what is cut already (five copies over
      // 360°) would otherwise only take the faces of the original over, silently. The shape is
      // what it was when every face of the tool in the result lies on the surface the target had;
      // the volume alone does not say it, because its tolerance grows with the bodies and a copy
      // that cuts a small corner off a large plate does have an effect.
      const volume = volumeOf(before);
      const scale = Math.min(Math.abs(volume), Math.abs(volumeOf(tool.solid)));
      const sameVolume = Math.abs(volumeOf(result) - volume) <= 1e-6 * Math.max(1, scale);
      const renamedOnly = () => placement !== undefined && onSurface(result, first, before, 1e-5 * Math.max(1, reach(before)));
      if (sameVolume && (recipe.operation === 'add' || !result.faceIds.some((face) => face >= first) || renamedOnly())) unchanged.push(target);
      else bodies[target] = result;
    }
  } catch (error) {
    if (error instanceof ToolProblem) return { ok: false, code: error.code, ...(error.refs ? { refs: error.refs } : {}), ...(error.detail ? { detail: error.detail } : {}) };
    return { ok: false, code: 'kernelFailure', detail: error instanceof Error ? error.message : String(error) };
  }
  if (unchanged.length === recipe.targets.length) return { ok: true, model, unchanged };
  if (tool.refuseChange) return { ok: false, code: tool.refuseChange.code, refs: recipe.targets.filter((target) => !unchanged.includes(target)), detail: tool.refuseChange.detail };
  return { ok: true, model: { ...withFaces(model, tool, first), bodies }, unchanged };
}

// Has a body a face of an imported mesh (D55)? No feature changes such a body: the kernel keeps flush
// faces safe only for faces it knows as planar, and a flat region of an imported mesh is not one.
export function isImported(solid: Solid, faceInfos: readonly FaceInfo[]): boolean {
  let last = -1;
  for (const face of solid.faceIds) {
    if (face === last) continue;
    last = face;
    const info = faceInfos[face];
    if (!info.planar && info.surface === 'mesh') return true;
  }
  return false;
}

// The result of a feature that applied its tool to its targets (an extrusion that adds or cuts,
// a hole), from what `applyTool` answered. The recipe is stored even when nothing changed: a copy
// in a pattern can hit what the original missed.
export function toolResult(id: Id, recipe: ToolRecipe, applied: Applied, state: State, done: Done, failed: Failed): Step {
  if (!applied.ok) return failed(applied.code, applied.refs, applied.detail);
  const tools = { ...state.tools, [id]: recipe };
  const { unchanged } = applied;
  if (unchanged.length === recipe.targets.length) return { state: done({ status: 'warning', warnings: [issue('noEffect', unchanged)] }, { tools }) };
  // Only some targets were missed: the general text would read as if nothing had happened.
  const warnings = unchanged.length ? [issue('noEffect', unchanged, 'only the targets in refs; the others were changed')] : [];
  return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings }, { ...applied.model, tools }) };
}

// The face tables of a model with the faces of a new tool appended.
export function withFaces(state: Model, tool: BuiltTool, first: number): Pick<State, 'faceNames' | 'faceInfos' | 'faceIds'> {
  return {
    faceNames: [...state.faceNames, ...tool.faces.map((f) => f.name)],
    faceInfos: [...state.faceInfos, ...tool.faces.map((f) => f.info)],
    faceIds: new Map([...state.faceIds, ...tool.faces.map((f, i): [string, number] => [faceKey(f.name), first + i])]),
  };
}
