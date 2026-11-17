// Validation scenario 12 (a box with a lid and screw posts), the part of package 2e, written as
// calls against the contract. Only type-checked. It continues the model of track B
// (2c-hole/calls.ts, `scenario12`): the long wall gets a row of vent slots (a linear pattern of
// a cut), the rib and its brace are mirrored to the other long wall (a mirror of features: a wall
// with a draft and an extent up to a tilted plane), and the box gets four L-shaped pads under its
// corners, one modelled and three mirrored (mirrors of a body, one of them of a copy).
// The numbers in the comments were measured with a prototype against the real adapters (design.md,
// "What was measured"), on the model as packages/scenarios/test/box.ts builds it. `scenario12` of
// 2c-hole/calls.ts, imported here for the order of the parts, was written before 2c was
// implemented and asks the catalog for an insert of the size `M3`; the catalog as implemented
// names its rows as sold (`M3x3x4.5`), and the test of this part follows box.ts.
//
// The grid (an addition to D53, grid.md) has its part at the end of this file, `scenario12grid`:
// the vents of both long walls as one pattern, drain holes in the floor as a grid of a hole
// feature, and six lids for the print bed as a grid of a body. Its numbers were measured with
// a prototype of the second direction against the real adapters (grid.md, "What was measured").

import { SCHEMA_VERSION } from '../../../packages/engine/src/index';
import type { Id, Input } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, PlaneRefAfter, QueryToolInput, StateAfter } from '../00-prep/contract';
import { FLOOR, RIB_LEFT, done, engine, onFace, pointAt, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import { scenario12 } from '../2c-hole/calls';
import type { LinearTransform, PatternFeatureD, PatternTransformD, SecondDirection } from './contract';
import { GRID_STRIDE, MAX_PATTERN_PLACES, PATTERN_FIELDS, copyBody, copyNumber } from './contract';

const volumeOf = (state: StateAfter, body: Id): number => state.evaluation.bodies[body].volume;
const about = (value: number | undefined, expected: number, tolerance = 1e-3): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const statusOf = (state: StateAfter, id: Id): string => state.evaluation.features[id].status;
const hasFace = (state: StateAfter, body: Id, name: FaceNameAfter): boolean => state.evaluation.bodies[body].faces.some((face) => sameName(state.evaluation.faceNames[face.id], name));
const pattern = (id: Id, source: PatternFeatureD['source'], transform: Input<PatternTransformD>): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform } });
const planeAt = (id: Id, base: 'XY' | 'XZ' | 'YZ', offset: string): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: base }, offset } });

// ---------------------------------------------------------------- a row of vent slots: a linear pattern of a cut

// The outer face of the long wall at y = 0: the side of the box from the curve `oa`. In the frame
// of a sketch on it x runs along the wall (the X of the model) and y up (its Z); the normal points
// out of the box.
export const WALL_OUT: FaceNameAfter = { feature: 'box', role: 'side', curve: 'oa' };
const slot = (sketch: Id, p: string, x: string, y: string, width: string, height: string): CommandAfter[] => [
  ...pointAt(sketch, `${p}1`, x, y),
  ...pointAt(sketch, `${p}2`, `${x} + ${width}`, y),
  ...pointAt(sketch, `${p}3`, `${x} + ${width}`, `${y} + ${height}`),
  ...pointAt(sketch, `${p}4`, x, `${y} + ${height}`),
  ...['a', 'b', 'c', 'd'].map((name, i): CommandAfter => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
];
// One slot 2 wide and 12 high through the wall, and a row of them along X. The count and the
// spacing are parameters.
export function vents(): StateAfter {
  return run(
    { type: 'setParameter', name: 'vents', expr: '5' },
    { type: 'setParameter', name: 'ventPitch', expr: '4' },
    ...sketchOn('ventSketch', onFace('box', WALL_OUT)),
    ...slot('ventSketch', 'v', '16', '10', '2', '12'),
    { type: 'addFeature', feature: { id: 'vent', name: 'vent', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'ventSketch', regions: [{ outerLoop: ['va', 'vb', 'vc', 'vd'] }] }, extent: { type: 'distance', start: 0, distance: '-(wall + 1)' }, operation: 'cut', targets: ['box'] } },
    pattern('ventRow', { type: 'features', features: ['vent'] }, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } }),
  );
}
// Five slots take five times the volume of one out of the wall (2 · 12 · 2 each), the fields hold
// numbers with their expressions, and a face of a copy is the face of the slot with the copy's tag.
export function ventChecks(before: number, state: StateAfter): boolean {
  const row = state.document.features.find((f) => f.id === 'ventRow');
  if (row?.type !== 'pattern' || row.transform.type !== 'linear' || row.transform.span.type !== 'spacing') return false;
  const fields = row.transform.count === 5 && row.transform.span.spacing === 4 && row.expressions?.['transform/count'] === 'vents' && row.expressions?.['transform/span/spacing'] === 'ventPitch';
  const fourth: FaceNameAfter = { feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: 4 }] };
  return fields && statusOf(state, 'ventRow') === 'ok' && about(before - volumeOf(state, 'box'), 5 * 2 * 12 * 2) && hasFace(state, 'box', fourth) && !hasFace(state, 'box', { ...fourth, copy: [{ pattern: 'ventRow', index: 5 }] });
}
// One more slot is one parameter; the copies that were there keep their numbers and their places.
export const oneMore = (before: number): boolean => about(before - volumeOf(done(engine.preview({ type: 'setParameter', name: 'vents', expr: '6' })), 'box'), 6 * 2 * 12 * 2);
// Eighteen slots would run past the end of the box (80 long, the first slot at 16, one every 4):
// the pattern is not an error, and the copies that changed nothing are named, by their numbers.
export function pastTheEnd(): { status: string; idle: unknown[] | undefined } {
  const preview = done(engine.preview({ type: 'setParameter', name: 'vents', expr: '18' }));
  const result = preview.evaluation.features['ventRow'];
  return { status: result.status, idle: result.warnings[0]?.refs }; // warning; [{ copy: 16, feature: 'vent', targets: ['box'] }, { copy: 17, … }]
}
// The other span: a length between the first slot and the last. Three slots over 16 mm stand 8
// apart, and the second copy is where the fourth was. The patch names the span alone: the
// transform is merged, the span is another variant and is replaced whole.
const overALength: LinearTransform['span'] = { type: 'length', length: 16 };
export const byLength = (): string => statusOf(done(engine.preview({ type: 'batch', commands: [{ type: 'setParameter', name: 'vents', expr: '3' }, { type: 'updateFeature', id: 'ventRow', patch: { transform: { span: overALength } } }] })), 'ventRow'); // ok
// A spacing of zero is refused where it is typed; the registry lists the fields of every kind.
export const zeroSpacing = (): boolean => engine.preview({ type: 'setField', feature: 'ventRow', path: 'transform/span/spacing', value: 0 }).ok; // false
export const fieldsListed = (): string[] => PATTERN_FIELDS.map((field) => `${field.path} when ${field.when?.path} is ${field.when?.equals}`);

// ---------------------------------------------------------------- the rib and its brace on the other side: a mirror of features

// The two planes of symmetry of the box as plane features, so that they follow its size: the base
// plane XZ has the normal −Y, so the plane y = W / 2 is its offset by −W / 2.
export const MID_W: PlaneRefAfter = { kind: 'plane', feature: 'midW' };
export const MID_L: PlaneRefAfter = { kind: 'plane', feature: 'midL' };
export const midPlanes = (): StateAfter => run(planeAt('midW', 'XZ', '-W / 2'), planeAt('midL', 'YZ', 'L / 2'));

// The rib (a wall from a line with a draft: a stack of two rings) and the brace (an extent up to
// the drafted side of the rib: a prism with a tilted end) once more on the other long wall. The
// tools are built again in the mirrored frame of their sketches; the brace of the copy runs to the
// same plane, which the mirror maps onto itself, so it ends on the copy of the rib.
export const RIB_LEFT_COPY: FaceNameAfter = { ...RIB_LEFT, copy: [{ pattern: 'ribMirror', index: 1 }] };
export const ribMirror = (): StateAfter => run(pattern('ribMirror', { type: 'features', features: ['rib', 'brace'] }, { type: 'mirror', plane: MID_W }));
// The copies add what the originals added (492.78 mm³ each, measured), their faces carry the tag
// of the copy, and the lid still clears the box.
export function ribMirrorChecks(before: number, state: StateAfter): boolean {
  const withoutBoth = done(engine.preview({ type: 'batch', commands: ['ribMirror', 'brace', 'rib'].map((id): CommandAfter => ({ type: 'setSuppressed', id, suppressed: true })) }));
  const originals = before - volumeOf(withoutBoth, 'box');
  const copies = volumeOf(state, 'box') - before;
  const faces = hasFace(state, 'box', RIB_LEFT_COPY) && hasFace(state, 'box', { feature: 'brace', role: 'side', curve: 'br', copy: [{ pattern: 'ribMirror', index: 1 }] });
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  return statusOf(state, 'ribMirror') === 'ok' && about(copies, originals, 1e-2) && faces && report.pairs.length === 0 && report.failed.length === 0;
}
// A sketch stands on a face of the copy. Its frame is right-handed with the normal out of the
// body, like every sketch frame: the origin and the Y axis are the images of those of a sketch on
// the source face, and X is their cross product with the normal, which is the opposite of the image
// of X. (Measured: origin [39.2, 49, 2] where the source has [39.2, 1, 2], and the same X, Y and
// normal as the source, because this mirror keeps Y and the normal.)
export function sketchOnTheCopy(): boolean {
  const preview = done(engine.preview({ type: 'batch', commands: sketchOn('onCopy', onFace('box', RIB_LEFT_COPY)) }));
  const frame = preview.evaluation.features['onCopy'].plane;
  if (preview.evaluation.features['onCopy'].status !== 'ok' || !frame) return false;
  const [x, y, n] = [frame.x, frame.y, frame.normal];
  const handed = (x[1] * y[2] - x[2] * y[1]) * n[0] + (x[2] * y[0] - x[0] * y[2]) * n[1] + (x[0] * y[1] - x[1] * y[0]) * n[2];
  return about(handed, 1, 1e-9) && about(frame.origin[1], 49, 1e-9);
}
// The plane is a reference like the plane of a sketch: removed, the mirror is in error and the
// model stays as it was before it; a round face is no mirror.
export const withoutItsPlane = (): string | undefined => done(engine.preview({ type: 'removeFeature', id: 'midW' })).evaluation.features['ribMirror'].error?.code; // brokenReference
export const inARoundFace = (): string | undefined =>
  done(engine.preview({ type: 'updateFeature', id: 'ribMirror', patch: { transform: { plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pa' }) } } })).evaluation.features['ribMirror'].error?.code; // nonPlanarFace
// Another kind is another variant: the patch replaces the transform and has to be complete.
export const toARowInstead = (): boolean => engine.preview({ type: 'updateFeature', id: 'ribMirror', patch: { transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 'W - 2 * wall - 21' } } } }).ok; // true
export const halfAPatch = (): boolean => engine.preview({ type: 'updateFeature', id: 'ribMirror', patch: { transform: { type: 'linear' } } }).ok; // false: no direction, count or span

// ---------------------------------------------------------------- pads under the corners: mirrors of a body

// An L-shaped pad under the corner of the box at the origin, 2 thick: a leg 15 long under the long
// wall and a leg 8 long under the short one, both 3 wide. The shape has a handedness in its plane,
// so the pad of the next corner is its mirror image and no turn of it.
export function pads(): StateAfter {
  const corners: [string, string][] = [['15', '0'], ['15', '3'], ['3', '3'], ['3', '8'], ['0', '8']];
  const at = (i: number): Id => (i % 6 === 0 ? 'origin' : `q${i % 6}`);
  return run(
    ...sketchOn('padSketch', { kind: 'base', plane: 'XY' }),
    ...corners.flatMap(([x, y], i) => pointAt('padSketch', `q${i + 1}`, x, y)),
    ...[0, 1, 2, 3, 4, 5].map((i): CommandAfter => ({ type: 'addCurve', sketch: 'padSketch', id: `ql${i}`, curve: { type: 'line', a: at(i), b: at(i + 1) } })),
    { type: 'addFeature', feature: { id: 'pad', name: 'pad', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'padSketch', regions: [{ outerLoop: ['ql0', 'ql1', 'ql2', 'ql3', 'ql4', 'ql5'] }] }, extent: { type: 'distance', start: 0, distance: -2 }, operation: 'new' } },
    // across the length, across the width, and the copy of the first across the width
    pattern('padX', { type: 'body', body: 'pad' }, { type: 'mirror', plane: MID_L }),
    pattern('padY', { type: 'body', body: 'pad' }, { type: 'mirror', plane: MID_W }),
    pattern('padXY', { type: 'body', body: 'padX/1' }, { type: 'mirror', plane: MID_W }),
    // the pads are printed in TPU: said once, on the source
    { type: 'setBodyMaterial', body: 'pad', material: 'TPU' },
  );
}
export const PADS: Id[] = ['pad', 'padX/1', 'padY/1', 'padXY/1'];
// Four bodies of one volume (the L is 60 mm², so 120 mm³), each a closed body with a positive
// volume in its own corner; nothing collides, the pads only touch the box.
export function padChecks(state: StateAfter): boolean {
  const volumes = PADS.every((id) => about(volumeOf(state, id), 120));
  const corner = (id: Id, x: number, y: number): boolean => about(state.evaluation.bodies[id].bounds.min[0], x, 1e-4) && about(state.evaluation.bodies[id].bounds.min[1], y, 1e-4);
  // the long leg stays along the long wall in every corner: 65 = L − 15, 42 = W − 8
  const places = corner('pad', 0, 0) && corner('padX/1', 65, 0) && corner('padY/1', 0, 42) && corner('padXY/1', 65, 42);
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid', ...PADS] }));
  return volumes && places && report.pairs.length === 0 && report.failed.length === 0;
}
// A copy takes after its source (D48), through a mirror as through any pattern, and a copy of
// a copy through both: the material is stated once.
export function padProperties(state: StateAfter): boolean {
  const last = state.evaluation.bodyProperties['padXY/1'];
  return last.material === 'TPU' && last.from === 'padX/1' && state.evaluation.bodyProperties['padX/1'].from === 'pad' && about(unwrap(engine.query('mass', { bodies: ['padXY/1'] })).mass, 0.15, 1e-6);
}
export const massOverMcp: QueryToolInput = { query: 'mass', args: { bodies: PADS } };
// A face of a copy of a copy carries both tags, the latest last, and a sketch stands on it. Two
// mirrors make a turn: the copy has the handedness of the source again.
export const UNDER_LAST_PAD: FaceNameAfter = { feature: 'pad', role: 'endCap', copy: [{ pattern: 'padX', index: 1 }, { pattern: 'padXY', index: 1 }] };
export const sketchUnderAPad = (): string => statusOf(done(engine.preview({ type: 'batch', commands: sketchOn('under', onFace('padXY/1', UNDER_LAST_PAD)) })), 'under'); // ok
// A mirror has one copy, and the registry knows it: a command cannot bring in a second one as
// a body (for a row it would be accepted and judged by the recompute, because a count may be an
// expression).
export const secondCopyOfAMirror = (): boolean => engine.preview({ type: 'setBodyProperties', body: 'padX/2', patch: { color: '#000000' } }).ok; // false
// A link of a mechanism lists a mirrored copy like any body (D49).
export const asOneLink = (): Id[] => done(engine.preview({ type: 'setLink', id: 'base', bodies: ['box', ...PADS] })).evaluation.mechanism.links['base'].bodies;

// ---------------------------------------------------------------- three lids for the print bed: a linear pattern of a body

// The lid twice more, 5 mm apart along X: bodies `lids/1` and `lids/2`.
export function lidsInARow(): Id[] | undefined {
  const preview = done(engine.preview(pattern('lids', { type: 'body', body: 'lid' }, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 'L + 5' } })));
  const moved = about(preview.evaluation.bodies['lids/2'].bounds.min[0], 170, 1e-4) && about(volumeOf(preview, 'lids/2'), volumeOf(preview, 'lid'), 1e-3);
  return moved ? preview.evaluation.features['lids'].bodies : undefined; // ['lids/1', 'lids/2']
}

// ---------------------------------------------------------------- the document

// No step of the schema: the document is saved with the version this build has, and loads to the
// same model. (A build without the package refuses it: it does not know the kinds.)
export function roundTrip(): boolean {
  const before = engine.getState();
  const saved = engine.save();
  const loaded = engine.load(saved);
  return (
    loaded.ok &&
    (JSON.parse(saved) as { schemaVersion: number }).schemaVersion === SCHEMA_VERSION &&
    loaded.state.evaluation.features['ribMirror'].status === 'ok' &&
    PADS.every((id) => about(volumeOf(loaded.state, id), 120)) &&
    about(volumeOf(loaded.state, 'box'), volumeOf(before, 'box'), 1e-9)
  );
}

// ---------------------------------------------------------------- what must not compile

export const wrong = (): void => {
  // @ts-expect-error a mirror has no count
  engine.execute(pattern('m', { type: 'body', body: 'pad' }, { type: 'mirror', plane: MID_L, count: 2 }));
  // @ts-expect-error the direction of a linear pattern is `direction`; `axis` belongs to the circular one
  engine.execute(pattern('l', { type: 'body', body: 'pad' }, { type: 'linear', axis: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 5 } }));
  // @ts-expect-error a spacing and a length are two spans
  engine.execute(pattern('l', { type: 'body', body: 'pad' }, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', length: 5 } }));
  // @ts-expect-error the plane of a mirror is a reference, not an ID
  engine.execute(pattern('m', { type: 'body', body: 'pad' }, { type: 'mirror', plane: 'midL' }));
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario12e(): boolean {
  const trackB = scenario12();
  const before = volumeOf(engine.getState(), 'box');
  const row = ventChecks(before, vents()) && oneMore(before);
  const past = pastTheEnd();
  // five fields of the kinds and four of the second direction of the grid
  const spans = past.status === 'warning' && past.idle?.length === 2 && byLength() === 'ok' && !zeroSpacing() && fieldsListed().length === 9;
  midPlanes();
  const withVents = volumeOf(engine.getState(), 'box');
  const mirrored = ribMirrorChecks(withVents, ribMirror()) && sketchOnTheCopy() && withoutItsPlane() === 'brokenReference' && inARoundFace() === 'nonPlanarFace' && toARowInstead() && !halfAPatch();
  const built = pads();
  const corners = padChecks(built) && padProperties(built) && sketchUnderAPad() === 'ok' && !secondCopyOfAMirror() && asOneLink().length === 5;
  const lids = lidsInARow()?.join() === 'lids/1,lids/2';
  return trackB && row && spans && mirrored && corners && lids && roundTrip();
}

// ================================================================ the grid (an addition to 2e, grid.md)

const X = { kind: 'base', axis: 'X' } as const;
const Y = { kind: 'base', axis: 'Y' } as const;
const second = (id: Id, direction: Input<SecondDirection>['direction'], count: number | string, spacing: number | string): CommandAfter => ({ type: 'updateFeature', id, patch: { transform: { second: { direction, count, span: { type: 'spacing', spacing } } } } });
const preview = (...commands: CommandAfter[]): StateAfter => done(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const errorOf = (state: StateAfter, id: Id) => state.evaluation.features[id].error;
const patternOf = (state: StateAfter, id: Id): PatternFeatureD | undefined => {
  const feature = state.document.features.find((f) => f.id === id);
  return feature?.type === 'pattern' ? feature : undefined;
};

// ---------------------------------------------------------------- the vents of both long walls: a row gets a second direction

// The slot is cut `wall + 1` deep from the outer face of the wall at y = 0. Shifted by
// `W - wall - 0.5` along Y the same tool stands astride the other long wall (from y = 47.5 to 50.5),
// so one pattern cuts both: the row of 2e gets a second direction with a count of 2. The patch
// names the second direction alone; the first is merged with what the row has.
export const ventsOnBothWalls = (): StateAfter => run(second('ventRow', Y, 2, 'W - wall - 0.5'));
// A face of a slot in the far wall: the copy `i` steps along X and one step along Y, number 1000 + i.
export const farVent = (i: number): FaceNameAfter => ({ feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: copyNumber(i, 1) }] });
const nearVent = (i: number): FaceNameAfter => ({ feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: copyNumber(i, 0) }] });
// The far wall loses what the near one lost (five slots, 240 mm³). The copies of the row keep their
// numbers 1 to 4 and their faces; the far wall has the numbers 1000 (the place across from the
// original) to 1004; the fields of the second direction hold numbers with their expressions.
export function bothWallsChecks(before: number, state: StateAfter): boolean {
  const transform = patternOf(state, 'ventRow')?.transform;
  if (transform?.type !== 'linear' || !transform.second || transform.second.span.type !== 'spacing') return false;
  const expressions = patternOf(state, 'ventRow')?.expressions;
  const fields = transform.count === 5 && transform.second.count === 2 && transform.second.span.spacing === 47.5 && expressions?.['transform/second/span/spacing'] === 'W - wall - 0.5' && expressions?.['transform/count'] === 'vents';
  const faces = hasFace(state, 'box', nearVent(4)) && hasFace(state, 'box', farVent(0)) && hasFace(state, 'box', farVent(4)) && !hasFace(state, 'box', nearVent(5)) && !hasFace(state, 'box', farVent(5));
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  return fields && statusOf(state, 'ventRow') === 'ok' && about(before - volumeOf(state, 'box'), 5 * 2 * 12 * 2) && faces && farVent(0).copy?.[0].index === GRID_STRIDE && report.pairs.length === 0;
}
// A sketch on a slot of the far wall, and then a sixth slot per wall: one parameter, two more
// copies (5 and 1005), and no copy moves: the sketch stands where it stood.
export function sixPerWall(before: number): boolean {
  const standing = run(...sketchOn('onFarVent', onFace('box', farVent(4))));
  const six = preview({ type: 'setParameter', name: 'vents', expr: '6' });
  const [was, is] = [standing.evaluation.features['onFarVent'].plane?.origin, six.evaluation.features['onFarVent'].plane?.origin];
  const stays = was !== undefined && is !== undefined && was.every((value, axis) => about(is[axis], value, 1e-9));
  return statusOf(six, 'onFarVent') === 'ok' && stays && hasFace(six, 'box', nearVent(5)) && hasFace(six, 'box', farVent(5)) && about(before - volumeOf(six, 'box'), 7 * 2 * 12 * 2);
}
// Eighteen per wall run past the end of the box in both rows: the idle copies are named by their
// numbers, row by row: 16, 17, 1016, 1017.
export const pastTheEndOfBoth = (): unknown[] | undefined => preview({ type: 'setParameter', name: 'vents', expr: '18' }).evaluation.features['ventRow'].warnings[0]?.refs;

// ---------------------------------------------------------------- drain holes in the floor: a grid of a hole feature

// One plain hole of 2 mm through the floor at a point of a sketch on the floor of the cavity, and
// a grid of it: columns 5 apart along X, rows 6 apart along Y, both counts parameters.
export function drains(): StateAfter {
  return run(
    { type: 'setParameter', name: 'drainCols', expr: '4' },
    { type: 'setParameter', name: 'drainRows', expr: '3' },
    ...sketchOn('drainSketch', onFace('box', FLOOR)),
    ...pointAt('drainSketch', 'd1', '18', '10'),
    { type: 'addFeature', feature: { id: 'drain', name: 'drain', suppressed: false, type: 'hole', sketch: 'drainSketch', points: ['d1'], shape: { type: 'plain', diameter: 2 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['box'] } },
    pattern('drains', { type: 'features', features: ['drain'] }, { type: 'linear', direction: X, count: 'drainCols', span: { type: 'spacing', spacing: 5 }, second: { direction: Y, count: 'drainRows', span: { type: 'spacing', spacing: 6 } } }),
  );
}
export const drainBore = (i: number, j: number): FaceNameAfter => ({ feature: 'drain', role: 'holeBore', point: 'd1', copy: [{ pattern: 'drains', index: copyNumber(i, j) }] });
// Is the bore of the place (i, j) a cylinder whose axis passes (x, y)? The published surface of
// a bore says where the hole is, exactly (measured: `origin: [33, 22, 2]` for the copy 2003).
function boreAt(state: StateAfter, i: number, j: number, x: number, y: number): boolean {
  const face = state.evaluation.bodies['box'].faces.find((candidate) => sameName(state.evaluation.faceNames[candidate.id], drainBore(i, j)));
  const surface = face && state.evaluation.faceSurfaces[face.id];
  return surface?.kind === 'cylinder' && about(surface.origin[0], x, 1e-6) && about(surface.origin[1], y, 1e-6);
}
// What one hole removes (6.2053 mm³ measured: a polygon of the circle through the floor of 2).
const oneDrain = (before: number): number => before - volumeOf(preview({ type: 'setSuppressed', id: 'drains', suppressed: true }), 'box');
// Twelve holes for one; every copy cut through the floor ("through all" is measured per copy); the
// bore of the last place is the bore of the hole with the number 2003 and stands three columns and
// two rows from the original at (18, 10); there is no fifth column and no fourth row.
export function drainChecks(before: number, state: StateAfter): boolean {
  const places = drainBore(3, 2).copy?.[0].index === 2003 && boreAt(state, 3, 2, 33, 22) && boreAt(state, 2, 1, 28, 16) && boreAt(state, 3, 0, 33, 10) && !hasFace(state, 'box', drainBore(4, 0)) && !hasFace(state, 'box', drainBore(0, 3));
  return statusOf(state, 'drains') === 'ok' && about(before - volumeOf(state, 'box'), 12 * oneDrain(before), 1e-4) && places;
}
// One more column and one more row are two parameters: eight more holes (4, 1004, 2004 and the row
// 3000 to 3004), and every hole that was there keeps its number and its place.
export function oneMoreEachWay(before: number): boolean {
  const more = preview({ type: 'setParameter', name: 'drainCols', expr: '5' }, { type: 'setParameter', name: 'drainRows', expr: '4' });
  return statusOf(more, 'drains') === 'ok' && about(before - volumeOf(more, 'box'), 20 * oneDrain(before), 1e-4) && boreAt(more, 3, 2, 33, 22) && boreAt(more, 2, 1, 28, 16) && boreAt(more, 4, 0, 38, 10) && boreAt(more, 4, 3, 38, 28);
}
// A grid has at most 200 places. Fifty columns of five rows are an error of the pattern, found by
// the recompute (each count is within its own range, and either may be an expression); the fields
// are named, and the model stays as it was before the pattern.
export function tooManyPlaces(before: number): boolean {
  const over = preview({ type: 'setParameter', name: 'drainCols', expr: '50' }, { type: 'setParameter', name: 'drainRows', expr: '5' });
  const error = errorOf(over, 'drains');
  return 50 * 5 > MAX_PATTERN_PLACES && error?.code === 'invalidPattern' && JSON.stringify(error.refs) === JSON.stringify(['transform/count', 'transform/second/count']) && about(before - volumeOf(over, 'box'), oneDrain(before), 1e-9);
}
// No two places of a grid may be one place. With the second direction along X as well and the
// same step of 5, the copy one step along the first direction and the copy one step along the
// second (1 and 1000) would be one hole: an error of the pattern. Parallel directions alone are
// not the error: with the steps 5 and 6 the twelve places are twelve places on one line.
export const onePlaceTwice = (): string | undefined => errorOf(preview({ type: 'updateFeature', id: 'drains', patch: { transform: { second: { direction: X, span: { type: 'spacing', spacing: 5 } } } } }), 'drains')?.code; // invalidPattern
export const onOneLine = (): string => statusOf(preview({ type: 'updateFeature', id: 'drains', patch: { transform: { second: { direction: X } } } }), 'drains'); // ok
// `second: null` makes it a row again: the four holes of the first row, and the expression of the
// second count goes with its field.
export function aRowAgain(before: number): boolean {
  const row = preview({ type: 'updateFeature', id: 'drains', patch: { transform: { second: null } } });
  const expressions = patternOf(row, 'drains')?.expressions;
  return statusOf(row, 'drains') === 'ok' && about(before - volumeOf(row, 'box'), 4 * oneDrain(before), 1e-4) && expressions?.['transform/count'] === 'drainCols' && expressions['transform/second/count'] === undefined;
}
// Only a linear pattern has a second direction: on a mirror (and on a circular pattern) the field
// is an invalid command.
export const secondOnAMirror = (): boolean => engine.preview(second('ribMirror', X, 2, 5)).ok; // false

// ---------------------------------------------------------------- six lids for the print bed: a grid of a body

// The row of three lids of 2e, and a second row beside it: the bodies of the first row keep the
// IDs they had, the second row is `lids/1000` to `lids/1002`.
export const LIDS: Id[] = [copyBody('lids', 1, 0), copyBody('lids', 2, 0), copyBody('lids', 0, 1), copyBody('lids', 1, 1), copyBody('lids', 2, 1)]; // lids/1, lids/2, lids/1000, lids/1001, lids/1002
const lidRow = (): CommandAfter => pattern('lids', { type: 'body', body: 'lid' }, { type: 'linear', direction: X, count: 3, span: { type: 'spacing', spacing: 'L + 5' } });
// A second direction is whole or absent: a patch that brings half of one to a row is refused.
export const halfASecond = (): boolean => engine.preview({ type: 'batch', commands: [lidRow(), { type: 'updateFeature', id: 'lids', patch: { transform: { second: { count: 2 } } } }] }).ok; // false
export const sixLids = (): StateAfter => run(lidRow(), second('lids', Y, 2, 'W + 5'), { type: 'setBodyMaterial', body: 'lid', material: 'PETG' });
// Five copies, listed in the order of their numbers; the last stands two lids along X and one
// along Y from the original; each takes the material of the lid (D48) and weighs what it weighs;
// a link lists copies of both rows (D49); a sketch stands on a face of a copy of the second row;
// the six do not collide.
export function lidChecks(state: StateAfter): boolean {
  const listed = state.evaluation.features['lids'].bodies.join() === LIDS.join();
  const last = state.evaluation.bodies['lids/1002'];
  const placed = about(last.bounds.min[0], 170, 1e-4) && about(last.bounds.min[1], 55, 1e-4) && about(last.volume, volumeOf(state, 'lid'), 1e-2);
  const properties = state.evaluation.bodyProperties['lids/1002'];
  const mass = unwrap(engine.query('mass', { bodies: ['lid', ...LIDS] }));
  const weighed = properties.material === 'PETG' && properties.from === 'lid' && about(mass.mass, 6 * (mass.bodies[0].mass ?? NaN), 1e-3);
  const linked = preview({ type: 'setLink', id: 'bed', bodies: ['lid', 'lids/1', 'lids/1000', 'lids/1002'] }).evaluation.mechanism.links['bed'];
  const under: FaceNameAfter = { feature: 'lid', role: 'startCap', copy: [{ pattern: 'lids', index: 1001 }] };
  const sketched = statusOf(preview(...sketchOn('underALid', onFace('lids/1001', under))), 'underALid') === 'ok';
  const report = unwrap(engine.query('interference', { bodies: ['lid', ...LIDS] }));
  return listed && placed && weighed && linked.bodies.length === 4 && linked.missing.length === 0 && sketched && report.pairs.length === 0 && report.failed.length === 0;
}
// A fourth lid per row: `lids/3` and `lids/1003` are new, and `lids/1002` is the body it was, in
// its place. One row instead of two: the bodies of the second row are gone, and a link that lists
// one names it as missing.
export function lidCounts(): boolean {
  const four = preview({ type: 'setField', feature: 'lids', path: 'transform/count', value: 4 });
  const added = four.evaluation.features['lids'].bodies.join() === 'lids/1,lids/2,lids/3,lids/1000,lids/1001,lids/1002,lids/1003' && about(four.evaluation.bodies['lids/1002'].bounds.min[0], 170, 1e-4);
  const one = preview({ type: 'setLink', id: 'bed', bodies: ['lid', 'lids/1', 'lids/1002'] }, { type: 'setField', feature: 'lids', path: 'transform/second/count', value: 1 });
  return added && one.evaluation.features['lids'].bodies.join() === 'lids/1,lids/2' && one.evaluation.mechanism.links['bed'].missing.join() === 'lids/1002';
}

// ---------------------------------------------------------------- the document, and what must not compile

// No step of the schema for the grid either: the version is the one of the build, and the document
// loads to the same model. (A build without the grid refuses it: its linear transform lists its
// fields, and `second` is not among them.)
export function roundTripGrid(): boolean {
  const before = engine.getState();
  const saved = engine.save();
  const loaded = engine.load(saved);
  return (
    loaded.ok &&
    (JSON.parse(saved) as { schemaVersion: number }).schemaVersion === SCHEMA_VERSION &&
    loaded.state.evaluation.features['drains'].status === 'ok' &&
    loaded.state.evaluation.features['lids'].bodies.join() === LIDS.join() &&
    about(volumeOf(loaded.state, 'box'), volumeOf(before, 'box'), 1e-9)
  );
}

export const wrongGrid = (): void => {
  const along = { direction: Y, count: 2, span: { type: 'spacing', spacing: 5 } } as const;
  // @ts-expect-error only a linear pattern has a second direction
  engine.execute(pattern('c', { type: 'body', body: 'pad' }, { type: 'circular', axis: X, count: 2, span: { type: 'full' }, second: along }));
  // @ts-expect-error a second direction has a span
  engine.execute(pattern('g', { type: 'body', body: 'pad' }, { type: 'linear', direction: X, count: 2, span: { type: 'spacing', spacing: 5 }, second: { direction: Y, count: 2 } }));
  // @ts-expect-error a second direction is not a transform: it has no `type`
  engine.execute(pattern('g', { type: 'body', body: 'pad' }, { type: 'linear', direction: X, count: 2, span: { type: 'spacing', spacing: 5 }, second: { type: 'linear', ...along } }));
  // @ts-expect-error the rows are the count of the second direction, not a field of the first
  engine.execute(pattern('g', { type: 'body', body: 'pad' }, { type: 'linear', direction: X, count: 2, span: { type: 'spacing', spacing: 5 }, rows: 2 }));
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario12grid(): boolean {
  const part2e = scenario12e();
  const walls = volumeOf(engine.getState(), 'box');
  const vents = bothWallsChecks(walls, ventsOnBothWalls()) && sixPerWall(walls) && JSON.stringify(pastTheEndOfBoth()?.map((ref) => (ref as { copy: number }).copy)) === '[16,17,1016,1017]';
  const floor = volumeOf(engine.getState(), 'box');
  const holes = drainChecks(floor, drains()) && oneMoreEachWay(floor) && tooManyPlaces(floor) && onePlaceTwice() === 'invalidPattern' && onOneLine() === 'ok' && aRowAgain(floor) && !secondOnAMirror();
  const half = halfASecond();
  const lids = !half && lidChecks(sixLids()) && lidCounts();
  return part2e && vents && holes && lids && roundTripGrid();
}
