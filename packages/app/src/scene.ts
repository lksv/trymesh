// The scene of the model: bodies and their outlines, planes, the sketches that are not being
// edited, and what is highlighted, hovered and selected. The sketch mode and an open form add
// theirs afterwards (sketch-mode.ts, `overlay` of a form).
import { type EngineState, type Id, type Vec3, faceKey } from '@trymesh/engine';
import { COLOR, keptSegments, loopSegments, planeSquare, pushPolyline, threadLines, toWorld } from './draw';
import { uiOf } from './features/index';
import { type PanelHost, type ViewPick, pickKey } from './host';
import { type QueryPanel, queryScene } from './panels/query';
import { AS_MODELLED, type Pose, placedBox, placedCorners, placedSegments } from './pose';
import type { SceneAdditions } from './queries/index';
import { entryOf, referenceUi } from './references/index';
import { polyline, sketchView } from './sketch-view';
import type { HalfSpace, SceneModel } from './viewport';

// What the scene uses of the app beyond what every panel does.
export interface SceneHost extends PanelHost {
  readonly hidden: ReadonlySet<Id>; // the features hidden on the timeline
  bodyHidden(body: Id): boolean; // a body is hidden at the feature that created it
  planes(state: EngineState): Extract<ViewPick, { kind: 'plane' }>[]; // the planes that are shown and can be picked
  readonly hover?: ViewPick; // under the pointer in the model
  // Where the view puts the bodies (D49): the pose of the mechanism of the shown state in the model
  // mode, as modelled in a sketch and in a form.
  pose(): Pose;
}

// An auxiliary body (kept-free space, an envelope) is drawn see-through.
export const AUXILIARY_OPACITY = 0.35;

// The box of what a state shows: its bodies (where the pose puts them) and the points of its
// sketches. An empty model has a box of 40 mm, and a small one is padded to it, so that the view
// does not zoom in further.
export function modelBounds(state: EngineState, pose: Pose = AS_MODELLED): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: ArrayLike<number>, offset = 0) => {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[offset + axis]);
      max[axis] = Math.max(max[axis], p[offset + axis]);
    }
  };
  for (const [id, body] of Object.entries(state.evaluation.bodies)) {
    const box = placedBox(body.solid, pose(id).transform);
    grow(box.min);
    grow(box.max);
  }
  for (const f of state.document.features) {
    const result = state.evaluation.features[f.id];
    if (!result?.plane || !result.sketch) continue;
    for (const p of Object.values(result.sketch.points)) grow(toWorld(result.plane, p.x, p.y));
  }
  if (min[0] > max[0]) return { min: [-20, -20, -20], max: [20, 20, 20] };
  // an empty sketch or a tiny model: the view does not zoom in closer than to 40 mm
  const pad = (40 - Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])) / 2;
  if (pad > 0) return { min: [min[0] - pad, min[1] - pad, min[2] - pad], max: [max[0] + pad, max[1] + pad, max[2] + pad] };
  return { min, max };
}

// Puts what a view of a query adds into the scene: a face given by its name is resolved to its
// mesh, a body is drawn in its colour, and what an addition says about a body the user has hidden
// is left out (a face, a coloured body, a fill or a line that names its body). A body or a face
// goes where the pose puts its body (D49); coordinates of an answer are in the pose already.
function addToScene(model: SceneModel, additions: Partial<SceneAdditions>, state: EngineState, host: SceneHost, pose: Pose): void {
  const { bodies, faceNames } = state.evaluation;
  const shown = (id: Id | undefined): boolean => id === undefined || (Object.prototype.hasOwnProperty.call(bodies, id) && !host.bodyHidden(id));
  const placed = (id: Id) => {
    const { transform } = pose(id);
    return transform ? { transform } : {};
  };
  for (const { body: id, color } of additions.bodies ?? []) if (shown(id)) for (const face of bodies[id].faces) model.faces.push({ solid: bodies[id].solid, faceId: face.id, color, opacity: 0.45, ...placed(id) });
  for (const { body: id, face, color, opacity } of additions.faces ?? []) {
    if (!shown(id)) continue;
    const key = faceKey(face);
    const number = bodies[id].faces.find((own) => faceKey(faceNames[own.id]) === key)?.id;
    if (number !== undefined) model.faces.push({ solid: bodies[id].solid, faceId: number, color, opacity, ...placed(id) });
  }
  for (const { body, ...line } of additions.lines ?? []) if (shown(body)) model.lines.push(line);
  model.points.push(...(additions.points ?? []));
  for (const { body, ...fill } of additions.fills ?? []) if (shown(body)) model.fills.push(fill);
  model.labels.push(...(additions.labels ?? []));
  if (additions.clip) model.clip = additions.clip;
}

// The cut of the model that a shown answer makes: the half-space that is cut away, and the fills
// of the cut that are drawn (not those of a hidden body). The scene and the pick of the app read
// it, so that what is not drawn is not picked.
export function shownCut(additions: Partial<SceneAdditions>, host: SceneHost): { clip: HalfSpace; fills: SceneModel['fills'] } | undefined {
  if (!additions.clip) return undefined;
  return { clip: additions.clip, fills: (additions.fills ?? []).filter((fill) => fill.body === undefined || !host.bodyHidden(fill.body)) };
}

// The scene of the model as it is shown. `sketch`: the sketch being edited, which the sketch mode
// draws itself, and the edge of a body under the pointer of its projection tool. A body, its
// outline and its highlighted faces and edges go where the pose puts it (D49); a body whose link is
// blocked is drawn by the transform of its link and marked with the joint that blocks it.
export function modelScene(host: SceneHost, queries: QueryPanel, sketch: { id: Id; hoverEdge?: ViewPick } | undefined): SceneModel {
  const state = host.view();
  const { evaluation, document: doc } = state;
  const pose = host.pose();
  const inModel = !sketch && !host.draft;
  const model: SceneModel = { bodies: [], lines: [], points: [], fills: [], faces: [], labels: [] };
  const highlighted = host.feature(host.selectedFeature);
  // what the shown answer of a query adds: the two bodies of a picked collision, the line of
  // a measured distance, a cut of the model. A cut takes away a part of everything that belongs
  // to a body: the bodies and their highlighted faces in the view, their edges here.
  const additions = inModel ? queryScene(queries, host) : {};
  const clip = additions.clip;

  // bodies and their outlines
  const outline: number[] = [];
  const blocked = new Map<Id, Id[]>(); // joint → the bodies it keeps from their pose
  for (const [id, body] of Object.entries(evaluation.bodies)) {
    if (host.bodyHidden(id)) continue;
    const { transform, blockedBy } = pose(id);
    const placed = transform ? { transform } : {};
    // a body in the colour of its properties, an auxiliary body translucent (D48)
    const properties = Object.prototype.hasOwnProperty.call(evaluation.bodyProperties, id) ? evaluation.bodyProperties[id] : undefined;
    model.bodies.push({ id, solid: body.solid, ...(properties?.color ? { color: Number.parseInt(properties.color.slice(1), 16) } : {}), ...(properties?.use === 'auxiliary' ? { opacity: AUXILIARY_OPACITY } : {}), ...placed });
    for (const edge of body.edges) {
      if (edge.kind === 'coplanar') continue;
      const segments = placedSegments(edge.segments, transform);
      for (let i = 0; i < segments.length; i++) outline.push(segments[i]);
    }
    // the faces of the selected extrusion, or of the copies the selected pattern made
    const owns = highlighted && inModel ? uiOf(highlighted.type).ownsFace : undefined;
    if (highlighted && owns) for (const face of body.faces) if (owns(highlighted, evaluation.faceNames[face.id])) model.faces.push({ solid: body.solid, faceId: face.id, color: COLOR.select, opacity: 0.3, ...placed });
    if (blockedBy !== undefined) blocked.set(blockedBy, [...(blocked.get(blockedBy) ?? []), id]);
  }
  model.lines.push({ segments: keptSegments(outline, clip), color: COLOR.edge, width: 1.5 });
  // the helix of every cosmetic thread on a body that is shown (D76), cut as the edges are
  const helices: number[] = [];
  for (const thread of evaluation.threads) {
    if (thread.modelled) continue;
    const body = thread.bodies.find((id) => !host.bodyHidden(id));
    if (body === undefined) continue;
    const segments = placedSegments(threadLines(thread), pose(body).transform);
    for (let i = 0; i < segments.length; i++) helices.push(segments[i]);
  }
  if (helices.length) model.lines.push({ segments: keptSegments(helices, clip), color: COLOR.thread, width: 1 });
  // a body that is not in its pose is marked at the top of its box, with the joint that blocks it
  for (const [joint, ids] of blocked) {
    for (const id of ids) {
      const corners = placedCorners(evaluation.bodies[id].bounds, pose(id).transform);
      const middle = [0, 1].map((axis) => corners.reduce((sum, corner) => sum + corner[axis], 0) / corners.length);
      const top = Math.max(...corners.map((corner) => corner[2]));
      model.labels.push({ at: [middle[0], middle[1], top], text: `not posed: ${state.document.mechanism.joints[joint]?.name ?? joint}`, tone: 'problem' });
    }
  }
  addToScene(model, additions, state, host, pose);

  // planes
  const square = planeSquare(host.planeSize(state));
  for (const plane of host.planes(state)) {
    const active = pickKey(plane) === pickKey(host.selected) || (plane.ref.kind === 'plane' && plane.ref.feature === host.selectedFeature);
    const hovered = pickKey(plane) === pickKey(host.hover);
    model.fills.push({ frame: plane.frame, loops: [square], color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, opacity: active || hovered ? 0.25 : 0.08 });
    model.lines.push({ segments: loopSegments(plane.frame, square), color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, width: 1 });
  }

  // sketches other than the one being edited
  for (const f of doc.features) {
    const result = evaluation.features[f.id];
    if (f.type !== 'sketch' || host.hidden.has(f.id) || !result?.sketch || !result.plane || sketch?.id === f.id) continue;
    const frame = result.plane;
    const [solid, dashed]: number[][] = [[], []];
    // the copies of a mirror or pattern (D68) are drawn as the curves they copy; the curves of an
    // entry whose row says so (a projection from a sketch, D69) solid when they form regions
    const inModel = (id: Id): boolean => {
      const entry = entryOf(f, id);
      return entry !== undefined && referenceUi(f.external[entry]).inModel === true;
    };
    for (const curve of sketchView(f, result.sketch).curves.values()) {
      if (curve.own || curve.derived) pushPolyline(curve.construction ? dashed : solid, frame, polyline(curve.shape));
      else if (inModel(curve.id)) pushPolyline(result.sketch.curves[curve.id]?.regions ? solid : dashed, frame, polyline(curve.shape));
    }
    const color = f.id === host.selectedFeature ? COLOR.select : COLOR.idle;
    model.lines.push({ segments: solid, color, width: f.id === host.selectedFeature ? 2.5 : 1.5 }, { segments: dashed, color, width: 1, dashed: true });
  }

  // selection and highlighting in the model
  for (const [pick, color, opacity] of [[host.hover, COLOR.hover, 0.3], [sketch?.hoverEdge, COLOR.hover, 0.3], [host.selected, COLOR.select, 0.5]] as [ViewPick | undefined, number, number][]) {
    const body = pick && pick.kind !== 'plane' ? evaluation.bodies[pick.body] : undefined;
    if (!pick || pick.kind === 'plane' || !body) continue;
    const { transform } = pose(pick.body);
    if (pick.kind === 'face') model.faces.push({ solid: body.solid, faceId: pick.faceId, color, opacity, ...(transform ? { transform } : {}) });
    else if (pick.kind === 'edge' && body.edges[pick.index]) model.lines.push({ segments: keptSegments(placedSegments(body.edges[pick.index].segments, transform), clip), color, width: 4, onTop: true });
  }
  return model;
}
