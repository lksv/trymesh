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

import { SCHEMA_VERSION } from '../../../packages/engine/src/index';
import type { Id, Input } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, PlaneRefAfter, QueryToolInput, StateAfter } from '../00-prep/contract';
import { RIB_LEFT, done, engine, onFace, pointAt, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import { scenario12 } from '../2c-hole/calls';
import type { LinearTransform, PatternFeatureD, PatternTransformD } from './contract';
import { PATTERN_FIELDS } from './contract';

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
// A mirror has one copy, and the registry knows it: a command that names a second one is invalid
// (for a row it would be accepted and judged by the recompute, because a count may be an expression).
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
  const spans = past.status === 'warning' && past.idle?.length === 2 && byLength() === 'ok' && !zeroSpacing() && fieldsListed().length === 5;
  midPlanes();
  const withVents = volumeOf(engine.getState(), 'box');
  const mirrored = ribMirrorChecks(withVents, ribMirror()) && sketchOnTheCopy() && withoutItsPlane() === 'brokenReference' && inARoundFace() === 'nonPlanarFace' && toARowInstead() && !halfAPatch();
  const built = pads();
  const corners = padChecks(built) && padProperties(built) && sketchUnderAPad() === 'ok' && !secondCopyOfAMirror() && asOneLink().length === 5;
  const lids = lidsInARow()?.join() === 'lids/1,lids/2';
  return trackB && row && spans && mirrored && corners && lids && roundTrip();
}
