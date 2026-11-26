// The selection of the app as the AI reads it (D74, the operation `get_selection`): what is picked,
// what is selected in a sketch, and what lies under a click or the pointer, in the shapes commands
// take. The view picks as it does for a click (host.pick, the ray, the hit on a body); what is
// computed of it here (the point on an edge, the normal of a face, the nearest entity of a sketch)
// is plain geometry with no dependency on the renderer.
import { type EngineState, type Id, type MechanismResult, type RigidTransform, type Solid, type Vec2, type Vec3, bodyOwner, faceKey, poseNote } from '@trymesh/engine';
import { SPOT_REACH, type SelectedPick, type SelectionSpot, type SketchEntity, type SpotHit } from '@trymesh/mcp/get-selection';
import { toWorld } from './draw';
import { PICK_REACH, type ViewPick } from './host';
import { type Pose, placedSegments } from './pose';
import { type SketchContext, type SketchMode, sketchContextOf } from './sketch-mode';
import { type SketchView, dist, distanceTo, hitCurve, hitPoint } from './sketch-view';
import type { View } from './viewport';

type At = { clientX: number; clientY: number };

// What a spot needs of the app.
export interface SpotHost {
  view(): EngineState; // the state shown
  pose(): Pose;
  shownMechanism(): MechanismResult | undefined; // the mechanism whose pose the view shows
  readonly sketch: SketchMode | undefined;
  sketchContext(): SketchContext | undefined;
  pick(at: At, want: { edges?: boolean; faces?: boolean; planes?: boolean }): ViewPick | undefined;
  planePoint(at: At, frame: SketchContext['frame']): { at: Vec2; depth: number } | undefined;
  pixelSize(): number;
}

// A pick of the view as the answer names it.
export function pickAnswer(pick: ViewPick): SelectedPick {
  if (pick.kind === 'face') return { body: pick.body, face: pick.name, planar: pick.planar };
  if (pick.kind === 'edge') return { body: pick.body, edge: pick.name, kind: pick.edgeKind };
  return { plane: pick.ref };
}

// An entity of a sketch by its ID: its kind and where it comes from.
export function entityOf(view: SketchView, id: Id): SketchEntity | undefined {
  const point = view.points.get(id);
  if (point) return { id, kind: 'point', source: point.derived ? 'derived' : point.own ? 'own' : 'reference' };
  const curve = view.curves.get(id);
  if (!curve) return undefined;
  return { id, kind: curve.shape.type, source: curve.derived ? 'derived' : curve.own ? 'own' : 'reference', ...(curve.construction ? { construction: true as const } : {}) };
}

// The entity of a sketch nearest to a place, with its distance: a point within `snap` (mm, the
// reach a drawing tool snaps to it from), else the nearer of the nearest point and the nearest
// curve within `reach` (mm), a point on a tie.
export function nearestEntity(view: SketchView, at: Vec2, snap: number, reach: number): (SketchEntity & { distance: number }) | undefined {
  const snapped = hitPoint(view, at, snap);
  const point = snapped ?? hitPoint(view, at, reach);
  const curve = snapped ? undefined : hitCurve(view, at, reach);
  const [pointDistance, curveDistance] = [point ? dist(point.at, at) : Infinity, curve ? distanceTo(curve.shape, at) : Infinity];
  const found = pointDistance <= curveDistance ? point : curve;
  const entity = found && entityOf(view, found.id);
  return entity ? { ...entity, distance: Math.min(pointDistance, curveDistance) } : undefined;
}

// The normal of a triangle of a solid (out of the body), turned by the pose of its body.
export function triangleNormal(solid: Solid, triangle: number, transform?: { matrix: number[][] }): Vec3 {
  const corner = (k: number): Vec3 => {
    const i = 3 * solid.triangles[3 * triangle + k];
    return [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]];
  };
  const [a, b, c] = [corner(0), corner(1), corner(2)];
  const [u, v] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]];
  let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (transform) n = [0, 1, 2].map((row) => transform.matrix[row][0] * n[0] + transform.matrix[row][1] * n[1] + transform.matrix[row][2] * n[2]) as Vec3;
  const length = Math.hypot(...n) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

// The point of a set of segments (6 numbers each) that the view shows nearest to a point of the
// window, as an edge is picked: along the segment on the screen, which a parallel view maps
// linearly to the model.
export function nearestOnSegments(segments: ArrayLike<number>, project: ReturnType<View['projector']>, x: number, y: number): Vec3 | undefined {
  let best: Vec3 | undefined;
  let bestDistance = Infinity;
  for (let i = 0; i + 5 < segments.length; i += 6) {
    const [a, b] = [project(segments[i], segments[i + 1], segments[i + 2]), project(segments[i + 3], segments[i + 4], segments[i + 5])];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / length2));
    const distance = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [0, 1, 2].map((k) => segments[i + k] + t * (segments[i + 3 + k] - segments[i + k])) as Vec3;
    }
  }
  return best;
}

// A point and a direction of the view taken back to the model as modelled: the inverse of the
// rigid transform of the pose of a body (its matrix is a rotation, so its inverse is its transpose).
const modelledPoint = (t: RigidTransform, p: Vec3): Vec3 => {
  const d = [p[0] - t.translation[0], p[1] - t.translation[1], p[2] - t.translation[2]];
  return [0, 1, 2].map((k) => t.matrix[0][k] * d[0] + t.matrix[1][k] * d[1] + t.matrix[2][k] * d[2]) as Vec3;
};
const modelledDirection = (t: RigidTransform, n: Vec3): Vec3 => [0, 1, 2].map((k) => t.matrix[0][k] * n[0] + t.matrix[1][k] * n[1] + t.matrix[2][k] * n[2]) as Vec3;

export type Want = { edges?: boolean; faces?: boolean; planes?: boolean };
// What a spot looks for when no click says otherwise: an edge, a face, a plane (outside a sketch).
export const ALL_PICKS = { edges: true, faces: true, planes: true } as const;

// What the view picks at a point of the window, with the point of the model it lies at, and the
// transform of the pose of the body hit, when the view draws it moved.
function hitAt(host: SpotHost, view: Pick<View, 'pickBody' | 'projector'>, at: At, want: Want, state: EngineState, pose: Pose): { hit: SpotHit; point: Vec3; transform?: RigidTransform } | undefined {
  const pick = host.pick(at, want);
  if (!pick) return undefined;
  if (pick.kind === 'plane') {
    const p = host.planePoint(at, pick.frame);
    return p ? { hit: { plane: pick.ref, normal: pick.frame.normal }, point: toWorld(pick.frame, p.at[0], p.at[1]) } : undefined;
  }
  const body = state.evaluation.bodies[pick.body];
  const { transform } = pose(pick.body);
  const moved = transform ? { transform } : {};
  if (pick.kind === 'edge') {
    const point = nearestOnSegments(placedSegments(body.edges[pick.index].segments, transform), view.projector(), at.clientX, at.clientY);
    return point ? { hit: { body: pick.body, edge: pick.name, kind: pick.edgeKind }, point, ...moved } : undefined;
  }
  const hit = view.pickBody(at.clientX, at.clientY);
  if (!hit || hit.body !== pick.body) return undefined;
  return { hit: { body: pick.body, face: pick.name, planar: pick.planar, normal: triangleNormal(body.solid, hit.triangle, transform) }, point: hit.point, ...moved };
}

// What lies under a point of the window. `want`: what the view picks there, as the click picks
// (`ALL_PICKS` for the pointer); in a sketch edges and faces.
// - In a sketch: the point of its plane with the nearest entity, and what the view picks there with
//   its own point; seen edge-on, where the ray misses the plane, what the view picks alone.
// - In the model or a form: what the view picks and the point on it, or nothing. A body the pose
//   moved gives the joints of the pose and the point (and the normal of a face) as modelled.
export function spotAt(host: SpotHost, view: Pick<View, 'pickBody' | 'projector'>, at: At, want: Want = ALL_PICKS): SelectionSpot | undefined {
  const state = host.view();
  const pose = host.pose();
  const m = host.sketch;
  if (m) {
    const context = host.sketchContext();
    if (!context) return undefined;
    const p = host.planePoint(at, context.frame);
    const found = hitAt(host, view, at, { edges: true, faces: true }, state, pose);
    if (!p) return found ? { point: found.point, hit: found.hit } : undefined;
    const nearest = nearestEntity(context.view, p.at, PICK_REACH * host.pixelSize(), SPOT_REACH * host.pixelSize());
    return {
      point: toWorld(context.frame, p.at[0], p.at[1]),
      ...(found ? { hit: { ...found.hit, point: found.point } } : {}),
      sketch: { sketch: m.id, at: p.at, ...(nearest ? { nearest } : {}) },
    };
  }
  const found = hitAt(host, view, at, want, state, pose);
  if (!found) return undefined;
  if (!found.transform) return { point: found.point, hit: found.hit };
  // the view drew the body moved by the pose of the mechanism: the point is where it was drawn
  const shown = host.shownMechanism();
  const note = shown ? poseNote(shown, state.document.mechanism) : undefined;
  const t = found.transform;
  const modelled = { point: modelledPoint(t, found.point), ...('normal' in found.hit ? { normal: modelledDirection(t, found.hit.normal) } : {}) };
  return { point: found.point, hit: found.hit, ...(note ? { pose: note.pose } : {}), modelled };
}

// Whether a spot names a thing a form previews (a body, a face or an edge of the feature `id`,
// which the document does not have yet).
export function namesFeature(spot: SelectionSpot, id: Id): boolean {
  const hit = spot.hit;
  if (!hit || !('body' in hit)) return false;
  if (bodyOwner(hit.body).feature === id) return true;
  return 'face' in hit ? hit.face.feature === id : hit.edge.a.feature === id || hit.edge.b.feature === id;
}

// Whether what a spot names is still in a state: the body with the face or the edge, the plane,
// the sketch and its nearest entity.
export function spotStillThere(spot: SelectionSpot, state: EngineState): boolean {
  const hit = spot.hit;
  const { bodies, faceNames, features } = state.evaluation;
  const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
  if (hit && 'plane' in hit && hit.plane.kind !== 'base') {
    const ref = hit.plane;
    if (ref.kind === 'plane' && !features[ref.feature]?.plane) return false;
    if (ref.kind === 'face' && !(has(bodies, ref.body) && bodies[ref.body].faces.some((f) => faceKey(faceNames[f.id]) === faceKey(ref.face)))) return false;
  }
  if (hit && 'body' in hit) {
    if (!has(bodies, hit.body)) return false;
    const body = bodies[hit.body];
    if ('face' in hit && !body.faces.some((f) => faceKey(faceNames[f.id]) === faceKey(hit.face))) return false;
    if ('edge' in hit && !body.edges.some((e) => faceKey(e.name.a) === faceKey(hit.edge.a) && faceKey(e.name.b) === faceKey(hit.edge.b))) return false;
  }
  if (spot.sketch) {
    const context = sketchContextOf(state, spot.sketch.sketch);
    if (!context) return false;
    if (spot.sketch.nearest && !entityOf(context.view, spot.sketch.nearest.id)) return false;
  }
  return true;
}
