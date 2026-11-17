// The model of validation scenario 12 (docs/requirements.md): a box with a lid, built step by step
// by the packages of track B of D36 and by 2e. This file holds the steps as commands, so that each
// package adds its own to the same model (docs/d36/2a-offset/calls.ts and the calls.ts of 2b, 2c,
// 2f and 2e).
import { type Command, type ExtrudeFeature, type Expr, type FaceName, type HoleShape, type Id, type Input, type PatternFeature, type PlaneRef, emptySketch } from '@trymesh/engine';
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

// ---------------------------------------------------------------- 2f: posts up to the lid, a brace up to the rib

// The underside of the lid: the start cap of its plate. The posts refer to the face, not to the
// height of the box.
export const UNDER_LID: PlaneRef = { kind: 'face', body: 'lid', face: { feature: 'lid', role: 'startCap' } };
export const POST_TOP: FaceName = { feature: 'posts', role: 'endCap' };
// How far the centre of a post is from the outer faces of the box.
export const INSET = 'wall + clearance + lipT + postR + 1';
const round = (sketch: Id, id: Id, x: Expr, y: Expr, radius: Expr): Command =>
  batch(
    pointAt(sketch, `${id}c`, x, y),
    { type: 'addCurve', sketch, id, curve: { type: 'circle', center: `${id}c` }, radius: 1 },
    { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
  );

// Two posts on the floor of the cavity, in the corners of one long side, added to the box up to
// the lid; the other two are copies turned about the middle of the box.
export const posts = (): Command =>
  batch(
    sketchOn('postSketch', onFace('box', FLOOR)),
    pointAt('postSketch', 'mid', 'L / 2', 'W / 2'),
    round('postSketch', 'pa', INSET, INSET, 'postR'),
    round('postSketch', 'pb', `L - (${INSET})`, INSET, 'postR'),
    add({ ...base('posts'), profile: { type: 'regions', sketch: 'postSketch', regions: [{ outerLoop: ['pa'] }, { outerLoop: ['pb'] }] }, extent: { type: 'upTo', plane: UNDER_LID, start: 0 }, operation: 'add', targets: ['box'] }),
    { type: 'addFeature', feature: { id: 'postPattern', name: 'postPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['posts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'postSketch', point: 'mid' }, count: 2, span: { type: 'full' } } } },
  );

// A round brace from the wall of the cavity at x = wall to the side of the rib that faces it. The
// sketch stands on the wall face (`cavity`, the side from the curve `od`); its normal points into
// the cavity, so the brace runs along it until the plane of the rib's side. With the draft of 2b
// that plane is tilted against the sketch, and the end of the brace lies in it. In the frame of
// the face x runs along the wall from its corner at y = W − wall, and y up from the sketch plane of
// the outline; the brace sits 16 mm from the near wall, beside the post in that corner.
export const brace = (): Command =>
  batch(
    sketchOn('braceSketch', onFace('box', { feature: 'cavity', role: 'side', curve: 'od' })),
    round('braceSketch', 'br', '-(W - 2 * wall - 16)', 'floor + 5', '1.5'),
    add({ ...base('brace'), profile: { type: 'regions', sketch: 'braceSketch', regions: [{ outerLoop: ['br'] }] }, extent: { type: 'upTo', plane: onFace('box', RIB_LEFT), start: 0 }, operation: 'add', targets: ['box'] }),
  );

// ---------------------------------------------------------------- 2c: screws through the lid, inserts in the posts

// Four points on the top of the lid over the posts, and one hole feature for all four. Its shape and
// label are the answer of the query `hardwareHole`, given here; no size is written in this file.
export const SCREW_POINTS: Id[] = ['s1', 's2', 's3', 's4'];
export const screwHoles = (shape: Input<HoleShape>, label: string, lidT: Expr): Command =>
  batch(
    { type: 'setParameter', name: 'lidT', expr: lidT },
    { type: 'setParameter', name: 'holeComp', expr: '0.2' },
    sketchOn('screws', onFace('lid', LID_TOP)),
    pointAt('screws', 's1', INSET, INSET),
    pointAt('screws', 's2', `L - (${INSET})`, INSET),
    pointAt('screws', 's3', `L - (${INSET})`, `W - (${INSET})`),
    pointAt('screws', 's4', INSET, `W - (${INSET})`),
    { type: 'addFeature', feature: { id: 'screwHoles', name: 'screwHoles', suppressed: false, type: 'hole', sketch: 'screws', points: SCREW_POINTS, shape, extent: { type: 'throughAll', side: 'backward' }, targets: ['lid'], label } },
  );

// Two points on the tops of the two posts of 2f and a blind hole for a heat-set insert at each, as
// deep as the catalog says; the holes in the two copied posts are a pattern of the hole feature
// about the middle of the box.
export const insertHoles = (shape: Input<HoleShape>, label: string, depth: number): Command =>
  batch(
    pointAt('tops', 'i1', INSET, INSET),
    pointAt('tops', 'i2', `L - (${INSET})`, INSET),
    pointAt('tops', 'center', 'L / 2', 'W / 2'),
    { type: 'addFeature', feature: { id: 'inserts', name: 'inserts', suppressed: false, type: 'hole', sketch: 'tops', points: ['i1', 'i2'], shape, extent: { type: 'distance', start: 0, distance: -depth }, targets: ['box'], label } },
    { type: 'addFeature', feature: { id: 'insertPattern', name: 'insertPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['inserts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'tops', point: 'center' }, count: 2, span: { type: 'full' } } } },
  );

// ---------------------------------------------------------------- 2e: vent slots, the rib mirrored, pads under the corners

const pattern = (id: Id, source: PatternFeature['source'], transform: Input<PatternFeature>['transform']): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'pattern', source, transform },
});

// The outer face of the long wall at y = 0: the side of the box from the curve `oa`. In the frame of
// a sketch on it x runs along the wall (the X of the model) and y up (its Z); the normal points out.
export const WALL_OUT: FaceName = { feature: 'box', role: 'side', curve: 'oa' };
// One slot 2 wide and 12 high cut through the long wall, and a row of them along X: the count and
// the spacing are parameters.
export const vents = (): Command =>
  batch(
    { type: 'setParameter', name: 'vents', expr: '5' },
    { type: 'setParameter', name: 'ventPitch', expr: '4' },
    sketchOn('ventSketch', onFace('box', WALL_OUT)),
    pointAt('ventSketch', 'v1', '16', '10'),
    pointAt('ventSketch', 'v2', '16 + 2', '10'),
    pointAt('ventSketch', 'v3', '16 + 2', '10 + 12'),
    pointAt('ventSketch', 'v4', '16', '10 + 12'),
    ...['a', 'b', 'c', 'd'].map((name, i): Command => ({ type: 'addCurve', sketch: 'ventSketch', id: `v${name}`, curve: { type: 'line', a: `v${i + 1}`, b: `v${((i + 1) % 4) + 1}` } })),
    add({ ...base('vent'), profile: { type: 'regions', sketch: 'ventSketch', regions: [{ outerLoop: ['va', 'vb', 'vc', 'vd'] }] }, extent: { type: 'distance', start: 0, distance: '-(wall + 1)' }, operation: 'cut', targets: ['box'] }),
    pattern('ventRow', { type: 'features', features: ['vent'] }, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } }),
  );

// The two planes of symmetry of the box as plane features, so that they follow its size: the base
// plane XZ has the normal −Y, so the plane y = W / 2 is its offset by −W / 2.
export const MID_W: PlaneRef = { kind: 'plane', feature: 'midW' };
export const MID_L: PlaneRef = { kind: 'plane', feature: 'midL' };
export const midPlanes = (): Command =>
  batch(
    { type: 'addFeature', feature: { id: 'midW', name: 'midW', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XZ' }, offset: '-W / 2' } },
    { type: 'addFeature', feature: { id: 'midL', name: 'midL', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'YZ' }, offset: 'L / 2' } },
  );

// The rib with its draft and the brace that ends on the rib's drafted side, once more on the other
// long wall: a mirror of features in the plane y = W / 2, which keeps the plane of the brace's end.
export const ribMirror = (): Command => pattern('ribMirror', { type: 'features', features: ['rib', 'brace'] }, { type: 'mirror', plane: MID_W });
export const RIB_LEFT_COPY: FaceName = { ...RIB_LEFT, copy: [{ pattern: 'ribMirror', index: 1 }] };

// An L-shaped pad under the corner of the box at the origin, 2 thick: a leg 15 long under the long
// wall and one 8 long under the short one, both 3 wide. The shape has a handedness in its plane, so
// the pad of the next corner is its mirror image: three mirrors, one of them of a copy. The
// material is said once, on the source.
export const PADS: Id[] = ['pad', 'padX/1', 'padY/1', 'padXY/1'];
export function pads(): Command {
  const corners: [string, string][] = [
    ['15', '0'],
    ['15', '3'],
    ['3', '3'],
    ['3', '8'],
    ['0', '8'],
  ];
  const at = (i: number): Id => (i % 6 === 0 ? 'origin' : `q${i % 6}`);
  return batch(
    sketchOn('padSketch', XY),
    ...corners.map(([x, y], i) => pointAt('padSketch', `q${i + 1}`, x, y)),
    ...[0, 1, 2, 3, 4, 5].map((i): Command => ({ type: 'addCurve', sketch: 'padSketch', id: `ql${i}`, curve: { type: 'line', a: at(i), b: at(i + 1) } })),
    add({ ...base('pad'), profile: { type: 'regions', sketch: 'padSketch', regions: [{ outerLoop: ['ql0', 'ql1', 'ql2', 'ql3', 'ql4', 'ql5'] }] }, extent: { type: 'distance', start: 0, distance: -2 }, operation: 'new' }),
    pattern('padX', { type: 'body', body: 'pad' }, { type: 'mirror', plane: MID_L }),
    pattern('padY', { type: 'body', body: 'pad' }, { type: 'mirror', plane: MID_W }),
    pattern('padXY', { type: 'body', body: 'padX/1' }, { type: 'mirror', plane: MID_W }),
    { type: 'setBodyMaterial', body: 'pad', material: 'TPU' },
  );
}

// The lid twice more beside it, 5 mm apart, for the print bed: a linear pattern of a body.
export const lidsInARow = (): Command => pattern('lids', { type: 'body', body: 'lid' }, { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 'L + 5' } });

// ---------------------------------------------------------------- the grid (2e, D53, an addition)

const X_AXIS = { kind: 'base', axis: 'X' } as const;
const Y_AXIS = { kind: 'base', axis: 'Y' } as const;
// A second direction of a linear pattern as a patch: the first direction is merged with what the
// row has.
export const secondDirection = (id: Id, direction: typeof X_AXIS | typeof Y_AXIS, count: number | Expr, spacing: number | Expr): Command => ({
  type: 'updateFeature',
  id,
  patch: { transform: { second: { direction, count, span: { type: 'spacing', spacing } } } },
});

// The slot is cut `wall + 1` deep from the outer face of the wall at y = 0. Shifted by
// `W - wall - 0.5` along Y the same tool stands astride the other long wall (from y = 47.5 to
// 50.5), so the row of vents gets a second direction with a count of 2 and cuts both walls.
export const ventsOnBothWalls = (): Command => secondDirection('ventRow', Y_AXIS, 2, 'W - wall - 0.5');

// One plain hole of 2 mm through the floor at a point of a sketch on the floor of the cavity, and
// a grid of it: columns 5 apart along X, rows 6 apart along Y, both counts parameters.
export const drains = (): Command =>
  batch(
    { type: 'setParameter', name: 'drainCols', expr: '4' },
    { type: 'setParameter', name: 'drainRows', expr: '3' },
    sketchOn('drainSketch', onFace('box', FLOOR)),
    pointAt('drainSketch', 'd1', '18', '10'),
    { type: 'addFeature', feature: { id: 'drain', name: 'drain', suppressed: false, type: 'hole', sketch: 'drainSketch', points: ['d1'], shape: { type: 'plain', diameter: 2 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['box'] } },
    pattern('drains', { type: 'features', features: ['drain'] }, { type: 'linear', direction: X_AXIS, count: 'drainCols', span: { type: 'spacing', spacing: 5 }, second: { direction: Y_AXIS, count: 'drainRows', span: { type: 'spacing', spacing: 6 } } }),
  );

// Six lids for the print bed: the row of three lids and a second row beside it, all of PETG.
export const sixLids = (): Command => batch(lidsInARow(), secondDirection('lids', Y_AXIS, 2, 'W + 5'), { type: 'setBodyMaterial', body: 'lid', material: 'PETG' });
