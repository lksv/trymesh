// D60 (package 5c of D36) without adapters: the fields `midplaneWith` and `tilt` of the plane
// feature in the document, the kind `face` of `AxisRef`, the frames of the midplane and of the tilt,
// the upgrade step `5c-more-planes`.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, fieldsOf, validateDocument } from '../src/document';
import { FEATURE_TYPE_INFO } from '../src/features/index';
import { TILT_ANGLE, midplaneFrame, tiltedFrame } from '../src/features/plane';
import { SCHEMA_PENDING, UPGRADES, schemaHeader, upgradeDocument } from '../src/schema';
import { mechanism } from '../src/sections/mechanism';
import type { AxisRef, Command, Document, FaceName, FeaturePatch, Frame, Input, PlaneFeature, PlaneRef, Vec3 } from '../src/types';
import { ANGLE_TOLERANCE } from '../src/util';
import { axisRefs } from '../src/validation';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const plane = (id: string, extra: Partial<Input<PlaneFeature>> = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset: 0, ...extra } });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const feature = (doc: Document, id: string): PlaneFeature => doc.features.find((f) => f.id === id) as PlaneFeature;
const SIDE: FaceName = { feature: 'E', role: 'side', curve: 'k' };
const TOP: FaceName = { feature: 'E', role: 'endCap' };
const X: AxisRef = { kind: 'base', axis: 'X' };

// A sketch S on XY with a line `l` and a circle `k`, and a cylinder E extruded from the circle.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'addFeature', feature: emptySketch('S', 'S', XY) },
    { type: 'addPoint', sketch: 'S', id: 'p1', x: 0, y: 0 },
    { type: 'addPoint', sketch: 'S', id: 'p2', x: 10, y: 0 },
    { type: 'addCurve', sketch: 'S', id: 'l', curve: { type: 'line', a: 'p1', b: 'p2' } },
    { type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'p1' }, radius: 5 },
    { type: 'addFeature', feature: { id: 'E', name: 'E', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
  );
}

describe('the fields midplaneWith and tilt of the plane feature (D60)', () => {
  it('absent, given, read in the order of the type; the numeric fields; the references', () => {
    const doc = run(base(), plane('P'), plane('Q', { midplaneWith: { kind: 'face', body: 'E', face: TOP }, tilt: { axis: { kind: 'sketchLine', sketch: 'S', line: 'l' }, angle: 'deg(30)' } }));
    expect(feature(doc, 'P')).toEqual({ id: 'P', name: 'P', suppressed: false, type: 'plane', base: XY, offset: 0 });
    expect(Object.keys(feature(doc, 'Q'))).toEqual(['id', 'name', 'suppressed', 'type', 'base', 'offset', 'midplaneWith', 'tilt', 'expressions']);
    expect(feature(doc, 'Q').tilt).toEqual({ axis: { kind: 'sketchLine', sketch: 'S', line: 'l' }, angle: Math.PI / 6 });
    expect(feature(doc, 'Q').expressions).toEqual({ 'tilt/angle': 'deg(30)' });
    expect(fieldsOf(feature(doc, 'P')).map((field) => field.path)).toEqual(['offset']);
    expect(fieldsOf(feature(doc, 'Q')).map((field) => field.path)).toEqual(['offset', 'tilt/angle']);
    expect(FEATURE_TYPE_INFO.plane.fields).toEqual([
      { path: 'offset', spec: { title: 'Offset', unit: 'mm' } },
      { path: 'tilt/angle', spec: TILT_ANGLE },
    ]);
    expect(TILT_ANGLE).toEqual({ title: 'Tilt angle', unit: 'rad', min: { value: -Math.PI }, max: { value: Math.PI } });
    expect(FEATURE_TYPE_INFO.plane.updatable).toEqual(['base', 'offset', 'midplaneWith', 'tilt']);
    // the angle may be ±π, not beyond
    expect(() => run(base(), plane('R', { tilt: { axis: X, angle: Math.PI } }), plane('T', { tilt: { axis: X, angle: -Math.PI } }))).not.toThrow();
    invalid(base(), plane('R', { tilt: { axis: X, angle: 3.15 } }), /tilt\.angle/);
    // the document loads to itself
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('refused: a tilt without an axis or an angle, a field a tilt does not have, a second plane or an axis of a later feature', () => {
    const doc = base();
    invalid(doc, plane('P', { tilt: { angle: 0.3 } as never }), /tilt\.axis/);
    invalid(doc, plane('P', { tilt: { axis: X } as never }), /tilt\.angle/);
    invalid(doc, plane('P', { tilt: { axis: X, angle: 0.3, offset: 2 } as never }), /tilt\.offset: a tilt has no such field/);
    invalid(doc, plane('P', { midplaneWith: 'XY' as never }), /midplaneWith/);
    invalid(doc, plane('P', { midplaneWith: { kind: 'plane', feature: 'later' } }), /later/);
    // a plane before the cylinder cannot take its face as the second plane or as the axis
    invalid(doc, { ...(plane('P', { midplaneWith: { kind: 'face', body: 'E', face: TOP } }) as Extract<Command, { type: 'addFeature' }>), index: 1 }, /E/);
    invalid(doc, { ...(plane('P', { tilt: { axis: { kind: 'face', body: 'E', face: SIDE }, angle: 0 } }) as Extract<Command, { type: 'addFeature' }>), index: 1 }, /E/);
    // a later plane as the second plane of an earlier one
    const two = run(doc, plane('P'), plane('Q'));
    invalid(two, update('P', { midplaneWith: { kind: 'plane', feature: 'Q' } }), /Q/);
  });

  it('the patch: a tilt merged by fields with its axis replaced whole, removed by null with its expression; setField reaches the angle only of a tilt', () => {
    let doc = run(base(), plane('P', { tilt: { axis: { kind: 'sketchLine', sketch: 'S', line: 'l' }, angle: 'deg(30)' } }));
    doc = run(doc, update('P', { tilt: { angle: 'deg(45)' } }));
    expect(feature(doc, 'P').tilt).toEqual({ axis: { kind: 'sketchLine', sketch: 'S', line: 'l' }, angle: Math.PI / 4 });
    expect(feature(doc, 'P').expressions).toEqual({ 'tilt/angle': 'deg(45)' });
    doc = run(doc, update('P', { tilt: { axis: X } }));
    expect(feature(doc, 'P').tilt).toEqual({ axis: X, angle: Math.PI / 4 });
    doc = run(doc, { type: 'setField', feature: 'P', path: 'tilt/angle', value: 0.25 });
    expect(feature(doc, 'P').tilt?.angle).toBe(0.25);
    doc = run(doc, update('P', { tilt: { angle: 'deg(10)' } }), update('P', { tilt: null }));
    expect(feature(doc, 'P').tilt).toBeUndefined();
    expect(feature(doc, 'P').expressions).toBeUndefined();
    // a patch of the angle alone on a plane without a tilt: the axis is missing
    invalid(doc, update('P', { tilt: { angle: 0.2 } }), /tilt\.axis/);
    // the angle has no default, so setField cannot add a tilt
    invalid(doc, { type: 'setField', feature: 'P', path: 'tilt/angle', value: 0.2 }, /tilt\/angle/);
    // null on a field the plane does not have is allowed; on the base it is not
    expect(feature(run(doc, update('P', { midplaneWith: null, tilt: null })), 'P')).toEqual(feature(doc, 'P'));
    invalid(doc, update('P', { base: null } as never), /base/);
    doc = run(doc, update('P', { midplaneWith: { kind: 'face', body: 'E', face: TOP } }));
    expect(feature(doc, 'P').midplaneWith).toEqual({ kind: 'face', body: 'E', face: TOP });
    doc = run(doc, update('P', { midplaneWith: null }));
    expect(feature(doc, 'P').midplaneWith).toBeUndefined();
  });
});

describe('the kind face of AxisRef (D60)', () => {
  it('the body and a face named as for a sketch on a face; its references; a field of another kind refused', () => {
    const doc = base();
    const pattern = (axis: unknown): Command => ({ type: 'addFeature', feature: { id: 'N', name: 'N', suppressed: false, type: 'pattern', source: { type: 'body', body: 'E' }, transform: { type: 'circular', axis: axis as AxisRef, count: 3, span: { type: 'full' } } } });
    expect(() => applyCommand(doc, pattern({ kind: 'face', body: 'E', face: SIDE }))).not.toThrow();
    // a planar face is a valid reference: that it has no axis is the recompute's error
    expect(() => applyCommand(doc, pattern({ kind: 'face', body: 'E', face: TOP }))).not.toThrow();
    invalid(doc, pattern({ kind: 'face', body: 'E', face: SIDE, sketch: 'S' }), /sketch: an axis of the kind face has no such field/);
    invalid(doc, pattern({ kind: 'face', body: 'nope', face: SIDE }), /nope/);
    invalid(doc, pattern({ kind: 'face', body: 'E', face: { feature: 'nope', role: 'endCap' } }), /nope/);
    invalid(doc, pattern({ kind: 'face', body: 'E' }), /face/);
    const copied: FaceName = { ...SIDE, copy: [{ pattern: 'M', index: 1 }] };
    expect(axisRefs({ kind: 'face', body: 'M/1', face: copied }, 'axis')).toEqual([
      { path: 'axis', id: 'M/1', kind: 'body' },
      { path: 'axis', id: 'E', kind: 'faceSource' },
      { path: 'axis', id: 'M', kind: 'pattern' },
    ]);
  });

  it('a joint about the axis of a face: the command checks the face; the mechanism names the body, the feature of the face and its patterns', () => {
    const second: Command = { type: 'addFeature', feature: { id: 'G', name: 'G', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 10, distance: 5 }, operation: 'new' } };
    let doc = run(base(), second, { type: 'setLink', id: 'a', bodies: ['E'] }, { type: 'setLink', id: 'b', bodies: ['G'] });
    doc = run(doc, { type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'a', child: 'b', axis: { kind: 'face', body: 'E', face: SIDE }, lower: -1, upper: 1, value: 0 } });
    expect(doc.mechanism.joints.j).toMatchObject({ axis: { kind: 'face', body: 'E', face: SIDE } });
    invalid(doc, { type: 'setJoint', id: 'k', joint: { type: 'revolute', parent: 'a', child: 'b', axis: { kind: 'face', body: 'E', face: { feature: 'nope', role: 'side', curve: 'k' } }, lower: -1, upper: 1, value: 0 } }, /nope/);
    const section = { links: {}, joints: { j: { ...doc.mechanism.joints.j, axis: { kind: 'face', body: 'M/1', face: { ...SIDE, copy: [{ pattern: 'M', index: 1 }] } } } } } as Document['mechanism'];
    expect(mechanism.names(section)).toEqual(['M/1', 'M', 'E', 'M']);
  });
});

// ---------------------------------------------------------------- the frames

const near = (a: Vec3 | undefined, b: Vec3, within = 1e-12) => {
  expect(a).toBeDefined();
  a?.forEach((value, i) => expect(Math.abs(value - b[i])).toBeLessThanOrEqual(within));
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const at = (f: Frame, u: number, v: number, w = 0): Vec3 => [0, 1, 2].map((k) => f.origin[k] + u * f.x[k] + v * f.y[k] + w * f.normal[k]) as Vec3;
const frameAt = (origin: Vec3, x: Vec3, normal: Vec3): Frame => ({ origin, x, y: [normal[1] * x[2] - normal[2] * x[1], normal[2] * x[0] - normal[0] * x[2], normal[0] * x[1] - normal[1] * x[0]], normal });
const TOP16 = frameAt([0, 0, 16], [1, 0, 0], [0, 0, 1]);
const UNDER8 = frameAt([0, 0, 8], [-1, 0, 0], [0, 0, -1]);
const XY0 = frameAt([0, 0, 0], [1, 0, 0], [0, 0, 1]);
const signed = (f: Frame, p: Vec3) => dot(f.normal, sub(p, f.origin));

describe('the midplane of two frames', () => {
  it('parallel planes facing each other and facing the same way: the plane in the middle with the axes of the base', () => {
    const mid = midplaneFrame(TOP16, UNDER8);
    expect(mid).toEqual({ origin: [0, 0, 12], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] });
    const below = midplaneFrame(UNDER8, TOP16);
    near(below.origin, [0, 0, 12]);
    near(below.normal, [0, 0, -1]);
    near(below.x, [-1, 0, 0]);
    const same = midplaneFrame(XY0, frameAt([0, 0, 10], [1, 0, 0], [0, 0, 1]));
    near(same.origin, [0, 0, 5]);
    near(same.normal, [0, 0, 1]);
  });

  it('planes at an angle: the bisector nearer to the base in both cases, through the line where they meet; a right angle', () => {
    const c = Math.sqrt(3) / 2;
    // the top and a plane tilted by 30° about the hinge x = 230 (normals the same way): 15° from Z
    const tilted = frameAt([30.814157, 0, 131], [c, 0, -0.5], [0.5, 0, c]);
    const half = midplaneFrame(TOP16, tilted);
    const s15 = Math.sin(Math.PI / 12);
    near(half.normal, [s15, 0, Math.cos(Math.PI / 12)]);
    near(half.origin, [15.407079, 0, 73.5], 1e-5);
    for (const p of [[230, -20, 16], [230, 20, 16]] as Vec3[]) expect(Math.abs(signed(half, p))).toBeLessThan(1e-4);
    // equally far from both planes: s1 = −s2 when the normals look the same way
    for (const p of [at(half, 0, 0), at(half, 50, 7), at(half, -30, 90)]) expect(signed(TOP16, p) + signed(tilted, p)).toBeCloseTo(0, 4);
    // normals that look away from each other (a wedge): s1 = s2
    const wedge = frameAt([0, 0, 0], [1, 0, 0], [0, -Math.sin(0.4), -Math.cos(0.4)]);
    const inside = midplaneFrame(TOP16, wedge);
    for (const p of [at(inside, 0, 0), at(inside, 10, 3)]) expect(signed(TOP16, p) - signed(wedge, p)).toBeCloseTo(0, 9);
    expect(dot(inside.normal, TOP16.normal)).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-12);
    // exactly at a right angle n1 · n2 = 0: the rule takes n1 − n2, still 45° from the base
    const wall = frameAt([5, 0, 0], [0, 1, 0], [1, 0, 0]);
    const corner = midplaneFrame(XY0, wall);
    near(corner.normal, [-Math.SQRT1_2, 0, Math.SQRT1_2]);
    for (const p of [at(corner, 0, 0), at(corner, 3, -4)]) expect(signed(XY0, p) - signed(wall, p)).toBeCloseTo(0, 9);
    // the frame stays orthonormal and right-handed
    for (const f of [half, inside, corner]) {
      expect(dot(f.x, f.y)).toBeCloseTo(0, 12);
      expect(dot(f.x, f.normal)).toBeCloseTo(0, 12);
      const cross: Vec3 = [f.x[1] * f.y[2] - f.x[2] * f.y[1], f.x[2] * f.y[0] - f.x[0] * f.y[2], f.x[0] * f.y[1] - f.x[1] * f.y[0]];
      near(cross, f.normal, 1e-12);
    }
  });

  it('two neighbouring sides of a hexagonal prism: the bisector outside the body; the plane of symmetry by a tilt of π/2 about their edge', () => {
    // sides at the apothem 10 with the outward normals (1, 0, 0) and (0.5, 0.866, 0)
    const n2: Vec3 = [0.5, Math.sqrt(3) / 2, 0];
    const a = frameAt([10, 0, 0], [0, 1, 0], [1, 0, 0]);
    const b = frameAt([10 * n2[0], 10 * n2[1], 0], [-n2[1], n2[0], 0], n2);
    const mid = midplaneFrame(a, b);
    // the plane that touches the prism along the edge: the centre lies inside, below it
    const edge: Vec3 = [10, 10 / Math.sqrt(3), 0];
    expect(Math.abs(signed(mid, edge))).toBeLessThan(1e-9);
    expect(signed(mid, [0, 0, 0])).toBeLessThan(-5);
    // turned by π/2 about the edge (along Z): the plane of symmetry through the centre and the edge
    const symmetry = tiltedFrame(mid, { point: edge, direction: [0, 0, 1] }, Math.PI / 2);
    if ('code' in symmetry) throw new Error(symmetry.detail);
    expect(Math.abs(signed(symmetry, [0, 0, 0]))).toBeLessThan(1e-9);
    expect(Math.abs(signed(symmetry, edge))).toBeLessThan(1e-9);
    // a point and its image across the plane of symmetry are the two sides' midpoints
    expect(signed(symmetry, [10, 0, 0]) + signed(symmetry, [10 * n2[0], 10 * n2[1], 0])).toBeCloseTo(0, 9);
  });
});

describe('the tilted frame', () => {
  it('XY about the base axis X by 30°: the normal (0, −0.5, 0.866) through the origin; about Z refused', () => {
    const tilted = tiltedFrame(XY0, { point: [0, 0, 0], direction: [1, 0, 0] }, Math.PI / 6);
    if ('code' in tilted) throw new Error(tilted.detail);
    near(tilted.origin, [0, 0, 0]);
    near(tilted.x, [1, 0, 0]);
    near(tilted.y, [0, Math.sqrt(3) / 2, 0.5], 1e-15);
    near(tilted.normal, [0, -0.5, Math.sqrt(3) / 2], 1e-15);
    expect(tiltedFrame(XY0, { point: [0, 0, 0], direction: [0, 0, 1] }, 0.3)).toEqual({ code: 'invalidAxis', detail: 'the axis of the tilt is at 90° to the plane it tilts; it has to be parallel to it' });
  });

  it('an axis beside the plane: the plane through it; the ends of the hinge keep their coordinates in the tilted frame', () => {
    // the top of the forearm turned by 30° about the line x = 230 from y = −20 to 20 (measured in the design)
    const tilted = tiltedFrame(TOP16, { point: [230, -20, 16], direction: [0, 40, 0] }, Math.PI / 6);
    if ('code' in tilted) throw new Error(tilted.detail);
    near(tilted.normal, [0.5, 0, Math.sqrt(3) / 2], 1e-15);
    near(tilted.x, [Math.sqrt(3) / 2, 0, -0.5], 1e-15);
    near(tilted.origin, [30.814157, 0, 131], 1e-6);
    for (const [u, v] of [[230, -20], [230, 20]]) near(at(tilted, u, v), [u, v, 16], 1e-12);
    // an axis 7 above XY: the plane moved onto it, the angle 0 keeps the direction of the base
    const lifted = tiltedFrame(XY0, { point: [3, 4, 7], direction: [0, 1, 0] }, 0);
    if ('code' in lifted) throw new Error(lifted.detail);
    expect(lifted).toEqual({ origin: [0, 0, 7], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] });
    // ±π: the plane through the axis turned over
    for (const angle of [Math.PI, -Math.PI]) {
      const over = tiltedFrame(XY0, { point: [0, 0, 0], direction: [1, 0, 0] }, angle);
      if ('code' in over) throw new Error(over.detail);
      near(over.normal, [0, 0, -1], 1e-15);
      near(over.x, [1, 0, 0], 1e-15);
    }
  });

  it('an axis off by half the angle tolerance is accepted and made exact; twice the tolerance is refused with the angle', () => {
    const off = (angle: number): Vec3 => [Math.cos(angle), 0, Math.sin(angle)];
    const accepted = tiltedFrame(XY0, { point: [0, 0, 0], direction: off(0.5 * ANGLE_TOLERANCE) }, Math.PI / 2);
    if ('code' in accepted) throw new Error(accepted.detail);
    // the tilted plane contains the line along X exactly, and is at exactly 90° to the base
    expect(accepted.normal[0]).toBe(0);
    near(accepted.normal, [0, -1, 0], 1e-15);
    const refused = tiltedFrame(XY0, { point: [0, 0, 0], direction: off(2 * ANGLE_TOLERANCE) }, 0.1);
    expect(refused).toMatchObject({ code: 'invalidAxis' });
    expect('code' in refused && refused.detail).toMatch(/the axis of the tilt is at 0\.0114592° to the plane it tilts/);
  });
});

describe('the upgrade step 5c-more-planes', () => {
  it('converts nothing; a build without the step refuses the document, a document of the branch loads', () => {
    const step = UPGRADES.find((entry) => entry.name === '5c-more-planes');
    expect(step).toBeDefined();
    expect(UPGRADES[6]).toBe(step);
    // merged; the step of 3c follows it
    expect(SCHEMA_PENDING).toBe(0);
    const doc = run(base(), plane('P', { tilt: { axis: X, angle: 0.5 }, midplaneWith: { kind: 'face', body: 'E', face: TOP } }));
    const saved = JSON.parse(JSON.stringify({ ...doc, schemaVersion: 8 }));
    expect(step?.run(saved)).toBe(saved);
    expect(validateDocument(saved)).toEqual(doc);
    // a build without the step (master before the merge of 5c) refuses it by its version
    expect(() => upgradeDocument(saved, UPGRADES.slice(0, 6), 0)).toThrow(/the schema version 8 is newer than this build reads \(it saves 7\)/);
    // a document of the branch d36/5c before the merge (version 7 naming the step) loads the same
    expect(validateDocument({ ...saved, schemaVersion: 7, schemaSteps: ['5c-more-planes'] })).toEqual(doc);
  });
});
