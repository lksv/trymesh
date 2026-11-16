// The model of validation scenario 12 (docs/requirements.md): a box with a lid, built step by step
// by the packages of track B of D36. This file holds the steps as commands, so that each package
// adds its own to the same model (docs/d36/2a-offset/calls.ts and the calls.ts of 2b, 2c and 2f).
import { type Command, type ExtrudeFeature, type Expr, type FaceName, type Id, type Input, type PlaneRef, emptySketch } from '@trymesh/engine';
import { XY, batch } from './kit';

const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
// An empty sketch on a plane or on a face.
export const sketchOn = (id: Id, plane: PlaneRef): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const dimension = (sketch: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): Command => ({ type: 'addConstraint', sketch, id, constraint: { type, a, b, value, driving: true } });
// A point at (x, y) from the origin of the sketch, both given as expressions.
export const pointAt = (sketch: Id, id: Id, x: Expr, y: Expr): Command =>
  batch({ type: 'addPoint', sketch, id, x: 1, y: 1 }, dimension(sketch, `${id}x`, 'horizontalDistance', 'origin', id, x), dimension(sketch, `${id}y`, 'verticalDistance', 'origin', id, y));
// A rectangle with a corner at the origin: lines `${p}a` (bottom), `${p}b` (right), `${p}c` (top),
// `${p}d` (left), with its sizes as expressions.
export function rectangle(sketch: Id, p: string, width: Expr, height: Expr): Command {
  const corners: [number, number][] = [[0, 0], [10, 1], [11, 9], [1, 10]];
  const names = ['a', 'b', 'c', 'd'];
  return batch(
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i + 1}`, x, y })),
    ...names.map((name, i): Command => ({ type: 'addCurve', sketch, id: `${p}${name}`, curve: { type: 'line', a: `${p}${i + 1}`, b: `${p}${((i + 1) % 4) + 1}` } })),
    { type: 'addConstraint', sketch, id: `${p}h1`, constraint: { type: 'horizontal', line: `${p}a` } },
    { type: 'addConstraint', sketch, id: `${p}v1`, constraint: { type: 'vertical', line: `${p}b` } },
    { type: 'addConstraint', sketch, id: `${p}h2`, constraint: { type: 'horizontal', line: `${p}c` } },
    { type: 'addConstraint', sketch, id: `${p}v2`, constraint: { type: 'vertical', line: `${p}d` } },
    { type: 'addConstraint', sketch, id: `${p}fix`, constraint: { type: 'coincident', a: `${p}1`, b: 'origin' } },
    dimension(sketch, `${p}w`, 'horizontalDistance', `${p}1`, `${p}2`, width),
    dimension(sketch, `${p}h`, 'verticalDistance', `${p}2`, `${p}3`, height),
  );
}
export const OUTLINE: Id[] = ['oa', 'ob', 'oc', 'od'];
const base = (id: Id): Pick<ExtrudeFeature, 'id' | 'name' | 'suppressed' | 'type'> => ({ id, name: id, suppressed: false, type: 'extrude' });
const add = (feature: Input<ExtrudeFeature>): Command => ({ type: 'addFeature', feature });
// The outline of the box as a profile, moved by `offset` when one is given.
const outline = (offset?: Expr): Input<ExtrudeFeature>['profile'] => ({ type: 'regions', sketch: 'outline', regions: [{ outerLoop: [...OUTLINE].sort() }], ...(offset === undefined ? {} : { offset }) });

// ---------------------------------------------------------------- 2a: the box, its cavity, the lid, a rib

// The outer size, the wall and the floor, the print clearance of the lid, the lip and the ribs.
export const PARAMETERS: Record<string, Expr> = { L: '80', W: '50', H: '30', wall: '2', floor: '2', clearance: '0.2', lidT: '3', lipH: '4', lipT: '1.5', ribT: '1.6', ribH: '12', postR: '4' };
export const parameters = (): Command => batch(...Object.entries(PARAMETERS).map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));

// The outer body: the outline extruded to the height, without an offset.
export const box = (): Command => batch(sketchOn('outline', XY), rectangle('outline', 'o', 'L', 'W'), add({ ...base('box'), profile: outline(), extent: { type: 'distance', start: 0, distance: 'H' }, operation: 'new' }));

// The cavity: the same outline moved inwards by the wall, cut from the floor up through the top.
export const cavity = (): Command => add({ ...base('cavity'), profile: outline('-wall'), extent: { type: 'distance', start: 'floor', distance: 'H' }, operation: 'cut', targets: ['box'] });

// The lid, modelled in place: a plate on top of the box from the same outline, a lip that goes down
// into the cavity with the print clearance, and the inside of the lip cut out again. All three
// read one sketch; the clearance of the fit is one expression.
export const lid = (): Command =>
  batch(
    add({ ...base('lid'), profile: outline(), extent: { type: 'distance', start: 'H', distance: 'lidT' }, operation: 'new' }),
    add({ ...base('lip'), profile: outline('-(wall + clearance)'), extent: { type: 'distance', start: 'H', distance: '-lipH' }, operation: 'add', targets: ['lid'] }),
    add({ ...base('lipInside'), profile: outline('-(wall + clearance + lipT)'), extent: { type: 'distance', start: 'H', distance: '-(lipH + 1)' }, operation: 'cut', targets: ['lid'] }),
  );

// A rib on the floor of the cavity, from one construction line that starts inside the long wall and
// runs towards the middle. The line closes no region; the wall profile does not need one.
export const FLOOR: FaceName = { feature: 'cavity', role: 'startCap' };
export const rib = (): Command =>
  batch(
    sketchOn('ribs', onFace('box', FLOOR)),
    pointAt('ribs', 'r1a', 'L / 2', 'wall / 2'),
    pointAt('ribs', 'r1b', 'L / 2', 'wall + 20'),
    { type: 'addCurve', sketch: 'ribs', id: 'r1', curve: { type: 'line', a: 'r1a', b: 'r1b', construction: true } },
    add({ ...base('rib'), profile: { type: 'wall', sketch: 'ribs', curves: ['r1'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] }),
  );
export const RIB_LEFT: FaceName = { feature: 'rib', role: 'wallSide', curve: 'r1', side: 'left' };

// A chain of two lines makes an L-shaped wall with a mitred corner, from inside the long wall to
// inside the short one; its thickness is then set as a field.
export const bracket = (): Command =>
  batch(
    pointAt('ribs', 'b1', 'L - wall - 12', 'wall / 2'),
    pointAt('ribs', 'b2', 'L - wall - 12', 'wall + 10'),
    pointAt('ribs', 'b3', 'L - wall / 2', 'wall + 10'),
    { type: 'addCurve', sketch: 'ribs', id: 'b12', curve: { type: 'line', a: 'b1', b: 'b2', construction: true } },
    { type: 'addCurve', sketch: 'ribs', id: 'b23', curve: { type: 'line', a: 'b2', b: 'b3', construction: true } },
    add({ ...base('bracket'), profile: { type: 'wall', sketch: 'ribs', curves: ['b12', 'b23'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] }),
    { type: 'setField', feature: 'bracket', path: 'profile/thickness', value: 2 },
  );

// ---------------------------------------------------------------- 2b: a draft, a lead-in, a countersink by hand

// The rib gets a draft of three degrees: narrower at its top. The taper is a field of the extent; a
// patch merges it into the extent the feature has.
export const ribDraft = (): Command => ({ type: 'updateFeature', id: 'rib', patch: { extent: { taper: 'deg(-3)' } } });

// A lead-in on the lip so that the lid finds the box: the lip narrows towards its free end. The
// field was absent; `setField` adds it.
export const lipLeadIn = (): Command => ({ type: 'setField', feature: 'lip', path: 'extent/taper', value: 'deg(-10)' });

// Two concentric circles on the top of the lid, in its middle, and from them a countersink: a cut
// that narrows by 45° from the wide circle down to the narrow one, and a straight bore through. The
// sizes and the angle are made up for the geometry (8 and 5 mm); they are no screw. Real sizes and
// angles come from the catalogs of 2c. The disc of the wide circle is two regions of the sketch
// (the ring and the disc inside it); they are taken together, so the narrow circle is not part of
// the outline that tapers.
export const LID_TOP: FaceName = { feature: 'lid', role: 'endCap' };
export const CONE: FaceName = { feature: 'sink', role: 'side', curve: 'wide' };
export const BORE: FaceName = { feature: 'bore', role: 'side', curve: 'narrow' };
const centred = (sketch: Id, id: Id, radius: Expr): Command[] => [
  { type: 'addCurve', sketch, id, curve: { type: 'circle', center: 'lidMid' }, radius: 1 },
  { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];
export const countersinkByHand = (): Command =>
  batch(
    { type: 'setParameter', name: 'wideD', expr: '8' },
    { type: 'setParameter', name: 'narrowD', expr: '5' },
    sketchOn('middle', onFace('lid', LID_TOP)),
    pointAt('middle', 'lidMid', 'L / 2', 'W / 2'),
    ...centred('middle', 'wide', 'wideD / 2'),
    ...centred('middle', 'narrow', 'narrowD / 2'),
    add({ ...base('sink'), profile: { type: 'regions', sketch: 'middle', regions: [{ outerLoop: ['wide'] }, { outerLoop: ['narrow'] }] }, extent: { type: 'distance', start: 0, distance: '-(wideD - narrowD) / 2', taper: 'deg(-45)' }, operation: 'cut', targets: ['lid'] }),
    add({ ...base('bore'), profile: { type: 'regions', sketch: 'middle', regions: [{ outerLoop: ['narrow'] }] }, extent: { type: 'throughAll', side: 'backward' }, operation: 'cut', targets: ['lid'] }),
  );
