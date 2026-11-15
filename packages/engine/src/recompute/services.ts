// What the steps of the feature types share: reading the state (a frame of a plane reference, an
// axis), applying a tool to its targets, the texts of issues. Functions over the state, imported by
// the modules of the feature types; they are not handed over in a context that would grow with them.
import { type Prism, analyzeBody, faceFrame, onSurface, toWorld, volumeOf } from '../solid';
import type { AxisRef, Frame, Id, Issue, IssueCode, PlaneRef, Solid, SolidKernel, Vec3 } from '../types';
import { faceKey, has } from '../util';
import type { Applied, Model, Placement, State, ToolRecipe } from './state';

// Záznam podle ID, které v něm nemusí být. ID přichází z odkazu v dokumentu a může se jmenovat
// jako vlastnost každého objektu (`constructor`, `toString`); ta se za záznam nepočítá.
export const lookup = <T>(record: Record<Id, T>, id: Id): T | undefined => (has(record, id) ? record[id] : undefined);

export const BASE: Record<'XY' | 'XZ' | 'YZ', Frame> = {
  XY: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
};

export const MESSAGE: Record<IssueCode, string> = {
  brokenReference: 'Odkaz vede na rovinu, stěnu, skicu nebo těleso, které v tomto místě časové osy neexistuje.',
  noProfile: 'Vybraná oblast ve skice není.',
  invalidProfile: 'Křivky skici se kříží nebo dotýkají mimo spojené body, nebo jsou si blíž, než rozliší dělení oblouků na úsečky.',
  nonPlanarFace: 'Stěna není rovinná.',
  emptyResult: 'Operace by odebrala celé těleso.',
  kernelFailure: 'Geometrické jádro operaci nezvládlo.',
  sketchConflict: 'Vazby skici si odporují nebo se skicu nepodařilo vyřešit.',
  brokenProjection: 'Promítnutá hrana už na tělese není.',
  degenerateProjection: 'Hrana je kolmá na rovinu skici a nejde promítnout.',
  unsupportedProjection: 'Hranu nejde promítnout jako zvolený druh křivky.',
  noEffect: 'Operace těleso nezměnila.',
  gearMesh: 'The gear cannot be put in mesh with the gear it refers to.',
  gearInterference: 'The tip of one gear of the pair runs into the root of the other.',
  invalidExpression: 'The expression of a numeric field cannot be evaluated or gives a value outside the range of the field.',
};
export const issue = (code: IssueCode, refs?: unknown[], detail?: string): Issue => ({ code, message: detail ? `${MESSAGE[code]} (${detail})` : MESSAGE[code], ...(refs ? { refs } : {}) });

// The largest coordinate of a solid: the scale its float32 positions are precise to.
export const reach = (s: Solid): number => s.positions.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

// The frame of a plane reference in a state: a base plane, a plane feature, or a planar face of a body.
export function frame(ref: PlaneRef, state: State): Frame | IssueCode {
  if (ref.kind === 'base') return BASE[ref.plane];
  if (ref.kind === 'plane') return lookup(state.planes, ref.feature) ?? 'brokenReference';
  const solid = lookup(state.bodies, ref.body);
  const id = state.faceIds.get(faceKey(ref.face));
  if (!solid || id === undefined) return 'brokenReference';
  return faceFrame(analyzeBody(solid, state.faceNames, state.faceInfos), id, state.faceInfos[id]);
}

// The line of an axis reference in a state: a base axis through the origin, or the normal of a sketch
// through one of its solved points.
export function axis(ref: AxisRef, state: State): { point: Vec3; direction: Vec3 } | { code: IssueCode; refs: unknown[] } {
  if (ref.kind === 'base') return { point: [0, 0, 0], direction: [ref.axis === 'X' ? 1 : 0, ref.axis === 'Y' ? 1 : 0, ref.axis === 'Z' ? 1 : 0] };
  const sketch = lookup(state.sketches, ref.sketch);
  if (!sketch) return { code: 'brokenReference', refs: [ref.sketch] };
  const at = lookup(sketch.geometry.points, ref.point);
  if (!at) return { code: 'brokenReference', refs: [ref.point] };
  return { point: toWorld(sketch.frame, at.x, at.y), direction: sketch.frame.normal };
}

// Applies a tool to its targets: a boolean operation with each of them. It works from the recipe
// alone, so any feature that produces a tool (an extrusion today) is applied the same way, and
// a pattern applies it again in another placement.
// - A missing target is a broken reference.
// - A cut that would remove a whole target is an error and changes none of them.
// - Targets the tool did not change are returned in `unchanged`. When it changed none, its faces
//   are in no body and do not enter the face table either.
export function applyTool(recipe: ToolRecipe, model: Model, kernel: SolidKernel, placement?: Placement): Applied {
  const missing = recipe.targets.filter((target) => !lookup(model.bodies, target));
  if (missing.length || recipe.targets.length === 0) return { ok: false, code: 'brokenReference', refs: missing.length ? missing : [recipe.targets] };
  const first = model.faceNames.length;
  const bodies = { ...model.bodies };
  const unchanged: Id[] = [];
  let tool: Prism;
  try {
    tool = recipe.build(recipe.targets.map((target) => model.bodies[target]), first, placement);
    for (const target of recipe.targets) {
      const before = model.bodies[target];
      const result = kernel.boolean(recipe.operation === 'add' ? 'union' : 'difference', before, tool.solid);
      if (result.triangles.length === 0) return { ok: false, code: 'emptyResult', refs: [target] };
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
    return { ok: false, code: 'kernelFailure', detail: error instanceof Error ? error.message : String(error) };
  }
  if (unchanged.length === recipe.targets.length) return { ok: true, model, unchanged };
  return { ok: true, model: { ...withFaces(model, tool, first), bodies }, unchanged };
}

// The face tables of a model with the faces of a new tool appended.
export function withFaces(state: Model, tool: Prism, first: number): Pick<State, 'faceNames' | 'faceInfos' | 'faceIds'> {
  return {
    faceNames: [...state.faceNames, ...tool.faces.map((f) => f.name)],
    faceInfos: [...state.faceInfos, ...tool.faces.map((f) => f.info)],
    faceIds: new Map([...state.faceIds, ...tool.faces.map((f, i): [string, number] => [faceKey(f.name), first + i])]),
  };
}
