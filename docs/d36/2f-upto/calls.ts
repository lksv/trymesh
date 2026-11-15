// Validation scenario 12 (a box with a lid and screw posts), the part of package 2f, written as
// calls against the contract. Only type-checked. It continues the model of 2a-offset/calls.ts:
// the screw posts stand on the floor of the cavity and end at the underside of the lid, wherever
// that is; a brace runs from a wall of the cavity to the side of the rib.

import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, PlaneRefAfter, StateAfter } from '../00-prep/contract';
import { FLOOR, RIB_LEFT, done, engine, onFace, pointAt, run, sketchOn, unwrap } from '../2a-offset/calls';
import { UP_TO_FACTS } from './contract';

const circle = (sketch: Id, id: Id, x: string, y: string, radius: string): CommandAfter[] => [
  ...pointAt(sketch, `${id}c`, x, y),
  { type: 'addCurve', sketch, id, curve: { type: 'circle', center: `${id}c` }, radius: 1 },
  { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];

// ---------------------------------------------------------------- the posts

// The underside of the lid: the start cap of its plate. The posts refer to the face, not to the
// height of the box.
export const UNDER_LID: PlaneRefAfter = { kind: 'face', body: 'lid', face: { feature: 'lid', role: 'startCap' } };
export const POST_TOP: FaceNameAfter = { feature: 'posts', role: 'endCap' };
// How far the centre of a post is from the outer faces of the box.
export const INSET = 'wall + clearance + lipT + postR + 1';

// Two posts on the floor of the cavity, in the corners of one long side, added to the box up to
// the lid. The other two are copies turned about the middle of the box.
export function posts(): StateAfter {
  return run(
    ...sketchOn('postSketch', onFace('box', FLOOR)),
    ...pointAt('postSketch', 'mid', 'L / 2', 'W / 2'),
    ...circle('postSketch', 'pa', INSET, INSET, 'postR'),
    ...circle('postSketch', 'pb', `L - (${INSET})`, INSET, 'postR'),
    {
      type: 'addFeature',
      feature: { id: 'posts', name: 'posts', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'postSketch', regions: [{ outerLoop: ['pa'] }, { outerLoop: ['pb'] }] }, extent: { type: 'upTo', plane: UNDER_LID, start: 0 }, operation: 'add', targets: ['box'] },
    },
    { type: 'addFeature', feature: { id: 'postPattern', name: 'postPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['posts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'postSketch', point: 'mid' }, count: 2, span: { type: 'full' } } } },
  );
}

// The length is what the plane gave, and the result says so: from the floor to the lid.
export function postLength(state: StateAfter): number | undefined {
  const facts = state.evaluation.features['posts'].facts;
  const names: string[] = Object.keys(UP_TO_FACTS); // lengthMin, lengthMax, forward
  if (!facts || names.some((name) => !(name in facts))) return undefined;
  // the lid is parallel to the floor, so there is one length: the two are equal exactly
  return facts['forward'] === true && facts['lengthMin'] === facts['lengthMax'] && typeof facts['lengthMin'] === 'number' ? facts['lengthMin'] : undefined; // 28: H − floor
}
const about = (value: number | undefined, expected: number): boolean => value !== undefined && Math.abs(value - expected) < 1e-9;

// The posts follow the lid: a higher box moves the lid, and the posts and their copies grow with
// it. Nothing about the posts is changed. The lid still does not collide with the box (bodies
// that only touch are not reported).
export function higherBox(): boolean {
  const preview = done(engine.preview({ type: 'setParameter', name: 'H', expr: '40' }));
  const collisions = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }, { state: preview }));
  return about(postLength(preview), 38) && preview.evaluation.features['postPattern'].status === 'ok' && collisions.pairs.length === 0;
}

// A gap never turns the posts round: one larger than the way to the lid is an error.
export const gapTooLarge = (): string | undefined => done(engine.preview({ type: 'setField', feature: 'posts', path: 'extent/gap', value: 100 })).evaluation.features['posts'].error?.code; // invalidExtent

// A gap leaves the posts short of the lid by a print layer; the field is optional like the offset.
export function shortOfTheLid(): number | undefined {
  return postLength(done(engine.preview({ type: 'setField', feature: 'posts', path: 'extent/gap', value: 0.2 }))); // 27.8
}

// The top of a post is a face like any end cap: the sketch with the positions of the heat-set
// inserts stands on it (2c).
export const onPostTop = (): StateAfter => run(...sketchOn('tops', onFace('box', POST_TOP)));

// ---------------------------------------------------------------- a brace up to a face in another direction

// A round brace from the wall of the cavity at x = wall to the side of the rib that
// faces it. The sketch stands on the wall face (`cavity`, the side from the curve `od`); its
// normal points into the cavity, so the brace runs along it until the plane of the rib's side.
// With the draft 2b gives the rib that plane is tilted against the sketch, and the end of the
// brace lies in it.
export function brace(): StateAfter {
  return run(
    ...sketchOn('braceSketch', onFace('box', { feature: 'cavity', role: 'side', curve: 'od' })),
    // In the frame of that face x runs along the wall from its corner at y = W - wall, and y up
    // from the sketch plane of the outline. The brace sits 16 mm from the near wall: beside the
    // post in that corner and within the length of the rib.
    ...circle('braceSketch', 'br', '-(W - 2 * wall - 16)', 'floor + 5', '1.5'),
    { type: 'addFeature', feature: { id: 'brace', name: 'brace', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'braceSketch', regions: [{ outerLoop: ['br'] }] }, extent: { type: 'upTo', plane: onFace('box', RIB_LEFT), start: 0 }, operation: 'add', targets: ['box'] } },
  );
}
// Tilted: the shortest and the longest length differ; parallel: they are equal.
export function braceLengths(state: StateAfter): [number, number] | undefined {
  const facts = state.evaluation.features['brace'].facts;
  return facts && typeof facts['lengthMin'] === 'number' && typeof facts['lengthMax'] === 'number' ? [facts['lengthMin'], facts['lengthMax']] : undefined;
}

// ---------------------------------------------------------------- refusals

const withPlane = (plane: PlaneRefAfter): string | undefined => done(engine.preview({ type: 'updateFeature', id: 'posts', patch: { extent: { plane } } })).evaluation.features['posts'].error?.code;
export function refusals(): (string | undefined)[] {
  return [
    // a wall of the cavity is parallel to the direction of the posts: they never reach it
    withPlane(onFace('box', { feature: 'cavity', role: 'side', curve: 'oa' })), // invalidExtent
    // the floor the posts stand on passes through their start
    withPlane(onFace('box', FLOOR)), // invalidExtent
  ];
}
// The plane is a reference like any other: a face of a feature that comes after the posts is an
// invalid command, not an error of the recompute.
export const faceFromLater = (): boolean => engine.preview({ type: 'updateFeature', id: 'posts', patch: { extent: { plane: onFace('box', { feature: 'brace', role: 'side', curve: 'br' }) } } }).ok; // false
// A round face that does come before the feature: a stud up to the side of a post.
export function upToACylinder(): string | undefined {
  const preview = done(
    engine.preview({
      type: 'addFeature',
      feature: { id: 'stud', name: 'stud', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'postSketch', regions: [{ outerLoop: ['pa'] }] }, extent: { type: 'upTo', plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pb' }), start: 0 }, operation: 'new' },
    }),
  );
  return preview.evaluation.features['stud'].error?.code; // nonPlanarFace
}
// A plane feature or a base plane ends a tool as well; a distance extent becomes an `upTo` by
// a patch with the other `type`, which replaces the variant and has to be complete.
export const upToBase = (): boolean => engine.preview({ type: 'updateFeature', id: 'rib', patch: { extent: { type: 'upTo', plane: { kind: 'base', plane: 'XY' }, start: 'ribH' } } }).ok;

export const wrong = (): void => {
  // @ts-expect-error no taper up to a plane
  engine.execute({ type: 'updateFeature', id: 'posts', patch: { extent: { type: 'upTo', plane: UNDER_LID, start: 0, taper: 0.1 } } });
  // @ts-expect-error the plane is a reference, not an ID
  engine.execute({ type: 'updateFeature', id: 'posts', patch: { extent: { type: 'upTo', plane: 'lid', start: 0 } } });
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario12f(): boolean {
  const built = posts();
  const length = about(postLength(built), 28) && built.evaluation.features['postPattern'].status === 'ok';
  const follows = higherBox() && about(shortOfTheLid(), 27.8) && gapTooLarge() === 'invalidExtent';
  onPostTop();
  const lengths = braceLengths(brace());
  const [parallel, through] = refusals();
  return length && follows && lengths !== undefined && lengths[0] <= lengths[1] && parallel === 'invalidExtent' && through === 'invalidExtent' && !faceFromLater() && upToACylinder() === 'nonPlanarFace' && upToBase();
}
