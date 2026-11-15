// The scene of the model: bodies and their outlines, planes, the sketches that are not being
// edited, and what is highlighted, hovered and selected. The sketch mode and an open form add
// theirs afterwards (sketch-mode.ts, `overlay` of a form).
import type { EngineState, Id, Solid, Vec3 } from '@trymesh/engine';
import { COLOR, loopSegments, planeSquare, pushPolyline, toWorld } from './draw';
import { uiOf } from './features/index';
import { type PanelHost, type ViewPick, pickKey } from './host';
import { type Collisions, pickedPair } from './panels/collisions';
import { polyline, sketchView } from './sketch-view';
import type { SceneModel } from './viewport';

// What the scene uses of the app beyond what every panel does.
export interface SceneHost extends PanelHost {
  readonly hidden: ReadonlySet<Id>; // the features hidden on the timeline
  bodyHidden(body: Id): boolean; // a body is hidden at the feature that created it
  planes(state: EngineState): Extract<ViewPick, { kind: 'plane' }>[]; // the planes that are shown and can be picked
  readonly hover?: ViewPick; // under the pointer in the model
}

// The box of what a state shows: its bodies and the points of its sketches. An empty model has
// a box of 40 mm, and a small one is padded to it, so that the view does not zoom in further.
const BOXES = new WeakMap<Solid, { min: Vec3; max: Vec3 }>();
export function modelBounds(state: EngineState): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: ArrayLike<number>, offset = 0) => {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p[offset + axis]);
      max[axis] = Math.max(max[axis], p[offset + axis]);
    }
  };
  for (const body of Object.values(state.evaluation.bodies)) {
    let box = BOXES.get(body.solid);
    if (!box) {
      const [lo, hi]: [Vec3, Vec3] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
      for (let i = 0; i < body.solid.positions.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], body.solid.positions[i]);
        hi[i % 3] = Math.max(hi[i % 3], body.solid.positions[i]);
      }
      box = { min: lo, max: hi };
      BOXES.set(body.solid, box);
    }
    grow(box.min);
    grow(box.max);
  }
  for (const f of state.document.features) {
    const result = state.evaluation.features[f.id];
    if (!result?.plane || !result.sketch) continue;
    for (const p of Object.values(result.sketch.points)) grow(toWorld(result.plane, p.x, p.y));
  }
  if (min[0] > max[0]) return { min: [-20, -20, -20], max: [20, 20, 20] };
  // prázdná skica nebo drobný model: pohled se nepřibližuje víc než na 40 mm
  const pad = (40 - Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])) / 2;
  if (pad > 0) return { min: [min[0] - pad, min[1] - pad, min[2] - pad], max: [max[0] + pad, max[1] + pad, max[2] + pad] };
  return { min, max };
}

// The scene of the model as it is shown. `sketch`: the sketch being edited, which the sketch mode
// draws itself, and the edge of a body under the pointer of its projection tool.
export function modelScene(host: SceneHost, collisions: Collisions, sketch: { id: Id; hoverEdge?: ViewPick } | undefined): SceneModel {
  const state = host.view();
  const { evaluation, document: doc } = state;
  const inModel = !sketch && !host.draft;
  const model: SceneModel = { bodies: [], lines: [], points: [], fills: [], faces: [], labels: [] };
  const highlighted = host.feature(host.selectedFeature);

  // tělesa a jejich obrysy
  const outline: number[] = [];
  for (const [id, body] of Object.entries(evaluation.bodies)) {
    if (host.bodyHidden(id)) continue;
    model.bodies.push({ id, solid: body.solid });
    for (const edge of body.edges) if (edge.kind !== 'coplanar') for (let i = 0; i < edge.segments.length; i++) outline.push(edge.segments[i]);
    // the faces of the selected extrusion, or of the copies the selected pattern made
    const owns = highlighted && inModel ? uiOf(highlighted.type).ownsFace : undefined;
    if (highlighted && owns) for (const face of body.faces) if (owns(highlighted, evaluation.faceNames[face.id])) model.faces.push({ solid: body.solid, faceId: face.id, color: COLOR.select, opacity: 0.3 });
  }
  model.lines.push({ segments: outline, color: COLOR.edge, width: 1.5 });
  // the two bodies of the picked collision
  const clash = inModel ? pickedPair(collisions, host) : undefined;
  for (const [id, color] of clash ? ([[clash.a, COLOR.select], [clash.b, COLOR.clash]] as [Id, number][]) : []) {
    const body = evaluation.bodies[id];
    if (body && !host.bodyHidden(id)) for (const face of body.faces) model.faces.push({ solid: body.solid, faceId: face.id, color, opacity: 0.45 });
  }

  // roviny
  const square = planeSquare(host.planeSize(state));
  for (const plane of host.planes(state)) {
    const active = pickKey(plane) === pickKey(host.selected) || (plane.ref.kind === 'plane' && plane.ref.feature === host.selectedFeature);
    const hovered = pickKey(plane) === pickKey(host.hover);
    model.fills.push({ frame: plane.frame, loops: [square], color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, opacity: active || hovered ? 0.25 : 0.08 });
    model.lines.push({ segments: loopSegments(plane.frame, square), color: active ? COLOR.select : hovered ? COLOR.hover : COLOR.plane, width: 1 });
  }

  // skici mimo tu, která se právě upravuje
  for (const f of doc.features) {
    const result = evaluation.features[f.id];
    if (f.type !== 'sketch' || host.hidden.has(f.id) || !result?.sketch || !result.plane || sketch?.id === f.id) continue;
    const frame = result.plane;
    const [solid, dashed]: number[][] = [[], []];
    for (const curve of sketchView(f, result.sketch).curves.values()) if (curve.own) pushPolyline(curve.construction ? dashed : solid, frame, polyline(curve.shape));
    const color = f.id === host.selectedFeature ? COLOR.select : COLOR.idle;
    model.lines.push({ segments: solid, color, width: f.id === host.selectedFeature ? 2.5 : 1.5 }, { segments: dashed, color, width: 1, dashed: true });
  }

  // výběr a zvýraznění v modelu
  for (const [pick, color, opacity] of [[host.hover, COLOR.hover, 0.3], [sketch?.hoverEdge, COLOR.hover, 0.3], [host.selected, COLOR.select, 0.5]] as [ViewPick | undefined, number, number][]) {
    const body = pick && pick.kind !== 'plane' ? evaluation.bodies[pick.body] : undefined;
    if (!pick || !body) continue;
    if (pick.kind === 'face') model.faces.push({ solid: body.solid, faceId: pick.faceId, color, opacity });
    else if (pick.kind === 'edge' && body.edges[pick.index]) model.lines.push({ segments: body.edges[pick.index].segments, color, width: 4, onTop: true });
  }
  return model;
}
