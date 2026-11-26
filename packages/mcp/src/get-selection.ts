// The operation `get_selection` (D74): what the user has selected and clicked in the running app,
// so that the AI can act on "the selected line", "the marked face" or "roughly here". An operation
// of the app, not a query: the selection is a state of the user interface, which the engine and
// the document know nothing of.
// - What the app gives to it is one capability (`AppHost.selection`): its selection as it is now,
//   already in the shapes commands take (a face as its body and stable name, a plane as its
//   `PlaneRef`, sketch entities by their IDs).
// - The selection exists only in the present state of the app, so the operation takes no state
//   path (`presentOnly`, host.ts): `at` and `after` are not in its schema and a call with them is
//   refused.
//
// This module has no dependency on Node or on a browser: the server and the app share it.
import type { ArgSpecs, EdgeKind, EdgeName, FaceName, Feature, Id, PlaneRef, QueryOutcome, Vec2, Vec3 } from '@trymesh/engine';
import type { HostOperation } from './host';
import type { Json } from './tools';

// ---------------------------------------------------------------- the answer

// What the app is doing: the model (`at`: the timeline is rolled back to after this feature and
// the view shows the model there; `pending`: a new feature of this type waits for a plane to be
// picked), a sketch being edited (with the active tool of the sketch bar), or the form of
// a feature (a new one, or `editing` one of the document).
export type AppMode =
  | { kind: 'model'; at?: Id; pending?: Feature['type'] }
  | { kind: 'sketch'; sketch: Id; tool: string }
  | { kind: 'form'; type: Feature['type']; feature: Id; editing: boolean };

// What is selected in the view of the model: a face, an edge, or a plane.
export type SelectedPick = { body: Id; face: FaceName; planar: boolean } | { body: Id; edge: EdgeName; kind: EdgeKind } | { plane: PlaneRef };

// An entity of a sketch: `source` `own` (drawn in the sketch; a command may change or remove it),
// `reference` (projected geometry, the origin and its axes: fixed, constrained to with an own
// operand) or `derived` (a copy of a mirror or pattern: no constraint names it).
export interface SketchEntity {
  id: Id;
  kind: 'point' | 'line' | 'circle' | 'arc' | 'spline';
  source: 'own' | 'reference' | 'derived';
  construction?: true;
}

// What a point of the view lies over (a click, or the pointer).
// - `point`: in model coordinates (mm). In the model: where the ray of the pointer meets what it
//   hit: the face, the nearest point of the edge, or the plane. In a sketch: where it meets the
//   plane of the sketch.
// - `hit`: what the view picks there, as a click would select it: an edge near the pointer before
//   the face under it, a face before a plane (planes only outside a sketch). A face has the
//   normal of the face at that place (out of its body, where the view draws it), a plane its
//   normal. `point` of a hit only in a sketch, where it differs from the point in the sketch plane.
// - `sketch`: in a sketch, the coordinates in the sketch (`at`, mm) and its entity nearest to them
//   with its distance in mm: a point a drawing tool would snap to there, else the nearer of the
//   nearest point and the nearest curve within `SPOT_REACH` pixels.
// - `pose`: the view showed the mechanism in a pose (the joints that move it, with their values):
//   the point is where the view drew it, not where the model is as modelled.
export type SpotHit =
  | { body: Id; face: FaceName; planar: boolean; normal: Vec3; point?: Vec3 }
  | { body: Id; edge: EdgeName; kind: EdgeKind; point?: Vec3 }
  | { plane: PlaneRef; normal: Vec3; point?: Vec3 };
export interface SelectionSpot {
  point: Vec3;
  hit?: SpotHit;
  sketch?: { sketch: Id; at: Vec2; nearest?: SketchEntity & { distance: number } };
  pose?: Record<Id, number>;
}
// How near (in pixels of the view) a point or a curve of a sketch has to be to a spot to be named
// its nearest: three times the reach of a pick, since the AI is told "roughly here".
export const SPOT_REACH = 20;

export interface AppSelection {
  mode: AppMode;
  feature?: { id: Id; type: Feature['type']; name: string }; // selected on the timeline
  pick?: SelectedPick; // selected in the view of the model
  sketch?: { sketch: Id; selected: SketchEntity[] }; // selected in the open sketch, when anything is
  click?: SelectionSpot; // the last click in the view, as it was then
  pointer?: SelectionSpot; // where the pointer is now, while it is over the view
}

// ---------------------------------------------------------------- the capability of the host

// What a running app gives: its selection as it is now. The click is the one the app recorded (and
// marks in its view); the pointer is looked at now, with the view as it stands.
export interface SelectionCapability {
  selection(): AppSelection;
}

declare module './host' {
  interface AppHost {
    // Absent in a host that keeps no selection (a test, an older app): the operation then answers
    // `notAvailable`.
    selection?: SelectionCapability;
  }
  interface HostOperations {
    get_selection: typeof GET_SELECTION_ARGS;
  }
}

// ---------------------------------------------------------------- the operation

export const GET_SELECTION_ARGS = {} as const satisfies ArgSpecs;

// Numbers of the answer to six decimal places, as the tool query rounds them.
function rounded(value: unknown): Json {
  if (typeof value === 'number') {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  }
  if (Array.isArray(value)) return value.map(rounded);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, rounded(v)]));
  return value as Json;
}

export const getSelection: HostOperation<typeof GET_SELECTION_ARGS> = {
  title: 'Selection',
  summary:
    'What the user has selected and clicked in the app now, in the shapes commands take, so that "the selected line", "the marked face" or "roughly here" can be acted on. It answers about the app as it is at this moment, so it takes no `at` and no `after`. The last click is marked in the view, so the user sees what this gives; Escape or another document removes it.',
  returns:
    'JSON; what is not there is left out. `mode`: `{ kind: "model", at?, pending? }` (`at`: the timeline is rolled back to after this feature; `pending`: a new feature of this type waits for a plane), `{ kind: "sketch", sketch, tool }` (the sketch being edited and the tool of its bar) or `{ kind: "form", type, feature, editing }` (the form of a new feature, or of one being edited). ' +
    '`feature`: the feature selected on the timeline, `{ id, type, name }`. `pick`: what is selected in the view of the model: `{ body, face, planar }` (a face by its stable name; with `planar`, `{ kind: "face", body, face }` is a PlaneRef), `{ body, edge, kind }` (an edge as chamfer and fillet name it) or `{ plane }` (a PlaneRef). ' +
    '`sketch`: in a sketch with something selected, `{ sketch, selected }`, each entity `{ id, kind, source, construction? }` (`kind` point, line, circle, arc or spline; `source` own, reference (projected geometry, the origin and its axes) or derived (a copy of a mirror or pattern, which no constraint may name)). ' +
    '`click`: the last click in the view, as it was then (a click on empty space in the model removes it): `point` [x, y, z] in model coordinates (mm), where the click met what it hit, in a sketch where it met the sketch plane; `hit`, what the view picks there as a click selects (an edge near the pointer before the face under it, a face before a plane): `{ body, face, planar, normal }` (the normal of the face there), `{ body, edge, kind }` or `{ plane, normal }`, in a sketch with its own `point`; `sketch`, in a sketch: `{ sketch, at: [x, y] }` in the coordinates of the sketch and `nearest`, the entity of the sketch nearest to it within about 20 pixels (a point a click would snap to first), with its `distance` in mm; `pose`: the view showed the mechanism in this pose (joint: value), so the point is where the view drew it, not as modelled. ' +
    '`pointer`: the same for where the pointer is now, only while it is over the view (not while the user types elsewhere). Numbers are rounded to six decimal places.',
  args: GET_SELECTION_ARGS,
  presentOnly: true,
  async run(host): Promise<QueryOutcome<{ kind: 'data'; data: Json }>> {
    if (!host.selection) return { ok: false, error: { code: 'notAvailable', message: 'the app that is connected does not report its selection (an older app: reload it)' } };
    return { ok: true, result: { kind: 'data', data: rounded(host.selection.selection()) } };
  },
};
