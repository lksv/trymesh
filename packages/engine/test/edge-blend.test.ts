// D63 (package 4b of D36) without adapters: the features `chamfer` and `fillet` in the document, the
// profile of a corner, the prism of a straight piece, the region of a revolve of a circular one,
// and the normal of a surface. The recompute against the real adapters is in
// packages/scenarios/test/edge-blend.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, fieldsOf } from '../src/document';
import { FEATURE_TYPE_INFO, specOf } from '../src/features/index';
import { faceKey } from '../src/face-roles';
import { BLEND_LIFT, BLEND_SIDES, blendProfile, blendRevolveSetup, edgePrism, liftOf, overshootOf, prismLength, revolveRegion } from '../src/recompute/tool-edge';
import { MESSAGE } from '../src/recompute/services';
import { type FaceInfo, normalAt, volumeOf } from '../src/solid';
import type { ChamferFeature, Command, Document, EdgeName, FaceName, FeaturePatch, FilletFeature, Frame, Input, PlaneRef, SolidKernel, Vec2, Vec3 } from '../src/types';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const side = (feature: string, curve: string): FaceName => ({ feature, role: 'side', curve });
const cap = (feature: string, role: 'startCap' | 'endCap' = 'endCap'): FaceName => ({ feature, role });
const edge = (a: FaceName, b: FaceName): EdgeName => ({ a, b });
const chamfer = (id: string, extra: Partial<Input<ChamferFeature>> = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'chamfer', body: 'E', edges: [edge(cap('E'), side('E', 'a'))], distance: 1, ...extra } });
const fillet = (id: string, extra: Partial<Input<FilletFeature>> = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'fillet', body: 'E', edges: [edge(cap('E'), side('E', 'a'))], radius: 1, ...extra } });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const feature = <F>(doc: Document, id: string): F => doc.features.find((f) => f.id === id) as F;

// A sketch S with a triangle a, b, c and an extrusion E of it.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'addFeature', feature: emptySketch('S', 'S', XY) },
    ...(['p1', 'p2', 'p3'] as const).map((id, i): Command => ({ type: 'addPoint', sketch: 'S', id, x: [0, 10, 0][i], y: [0, 0, 10][i] })),
    { type: 'addCurve', sketch: 'S', id: 'a', curve: { type: 'line', a: 'p1', b: 'p2' } },
    { type: 'addCurve', sketch: 'S', id: 'b', curve: { type: 'line', a: 'p2', b: 'p3' } },
    { type: 'addCurve', sketch: 'S', id: 'c', curve: { type: 'line', a: 'p3', b: 'p1' } },
    { type: 'addFeature', feature: { id: 'E', name: 'E', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['a', 'b', 'c'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
  );
}

describe('the features chamfer and fillet in the document', () => {
  it('a body, edges in their canonical order, the size a numeric field with an expression; the registry', () => {
    const doc = run(base(), chamfer('C', { edges: [edge(side('E', 'a'), cap('E'))], distance: '2 * 0.5' }), fillet('F', { radius: 3 }));
    const c = feature<ChamferFeature>(doc, 'C');
    expect(c.edges).toEqual([edge(cap('E'), side('E', 'a'))]);
    expect(c.distance).toBe(1);
    expect(c.expressions).toEqual({ distance: '2 * 0.5' });
    expect(fieldsOf(c).map((field) => field.path)).toEqual(['distance']);
    expect(fieldsOf(feature<FilletFeature>(doc, 'F')).map((field) => field.path)).toEqual(['radius']);
    expect(FEATURE_TYPE_INFO.chamfer).toMatchObject({ title: 'Chamfer', bodies: 'none', updatable: ['body', 'edges', 'distance'] });
    expect(FEATURE_TYPE_INFO.fillet).toMatchObject({ title: 'Fillet', bodies: 'none', updatable: ['body', 'edges', 'radius'] });
    const spec = specOf(c);
    expect([spec.createsBody(c, undefined), spec.namesFaces, spec.producesTool(c)]).toEqual([false, true, false]);
    expect(spec.refs(c)).toEqual([
      { path: 'body', id: 'E', kind: 'body' },
      { path: 'edges/0/a', id: 'E', kind: 'faceSource' },
      { path: 'edges/0/b', id: 'E', kind: 'faceSource' },
    ]);
  });

  it('refuses no edge, an edge twice, a size of 0, a face of a later feature, a body that is not there, an edge of one face', () => {
    const doc = base();
    invalid(doc, chamfer('C', { edges: [] }), /edges: a non-empty list of edges/);
    invalid(doc, chamfer('C', { edges: [edge(cap('E'), side('E', 'a')), edge(cap('E'), side('E', 'b')), edge(side('E', 'a'), cap('E'))] }), /edges\[2\]: the edge is listed twice, also at 0/);
    invalid(doc, chamfer('C', { distance: 0 }), /distance/);
    invalid(doc, fillet('F', { radius: -1 }), /radius/);
    invalid(doc, fillet('F', { radius: 'nothing' }), /radius/);
    invalid(doc, chamfer('C', { edges: [edge(cap('E'), side('X', 'a'))] }), /edges\[0\]/);
    invalid(run(doc, chamfer('C')), chamfer('D', { edges: [edge(cap('E'), { feature: 'C', role: 'chamfer', edge: 0 }), edge(cap('E'), { feature: 'Z', role: 'chamfer', edge: 0 })] }), /edges\[1\]/);
    invalid(doc, chamfer('C', { body: 'X' }), /body/);
    invalid(doc, chamfer('C', { edges: [edge(cap('E'), cap('E'))] }), /edges\[0\]/);
    invalid(doc, chamfer('C', { edges: [edge(cap('E'), { feature: 'E', role: 'chamfer', edge: 0.5 } as FaceName)] }), /whole number/);
  });

  it('the patch: the edges replaced whole, the size with an expression; the faces of a chamfer name it as a feature that names faces', () => {
    let doc = run(base(), chamfer('C'));
    doc = run(doc, update('C', { edges: [edge(cap('E'), side('E', 'b')), edge(cap('E'), side('E', 'c'))] }), update('C', { distance: 'pi' }));
    expect(feature<ChamferFeature>(doc, 'C').edges).toEqual([edge(cap('E'), side('E', 'b')), edge(cap('E'), side('E', 'c'))]);
    expect(feature<ChamferFeature>(doc, 'C').distance).toBeCloseTo(Math.PI, 12);
    invalid(doc, update('C', { radius: 2 } as never), /radius/);
    invalid(doc, update('C', { distance: null } as never), /distance/);
    // a later chamfer of an edge of the first chamfer's face
    doc = run(doc, chamfer('D', { edges: [edge(cap('E'), { feature: 'C', role: 'chamfer', edge: 1 })] }));
    expect(faceKey({ feature: 'C', role: 'chamfer', edge: 1 })).toBe('C/chamfer/1');
    expect(specOf(feature<ChamferFeature>(doc, 'D')).refs(feature<ChamferFeature>(doc, 'D'))).toContainEqual({ path: 'edges/0/a', id: 'C', kind: 'faceSource' });
  });

  it('the two codes have their texts', () => {
    expect(MESSAGE.unsupportedEdge).toMatch(/cannot be chamfered or filleted/);
    expect(MESSAGE.blendDoesNotFit).toMatch(/does not fit/);
  });
});

describe('the profile of a corner', () => {
  const area = (points: readonly Vec2[]): number => points.reduce((sum, p, i) => sum + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1], 0) / 2;
  const tol = 0.01;

  it('a chamfer at a right angle: the setback is the distance, the line between the faces, counter-clockwise, the overshoot of the size past a convex edge', () => {
    const profile = blendProfile('chamfer', 3, { beta: Math.PI / 2, convex: true, round: [false, false] }, tol);
    expect(profile.setback).toBe(3);
    expect(profile.overshoot).toBe(3);
    expect(profile.blend).toEqual({ type: 'line', a: [3, 0], b: [3 * Math.cos(Math.PI / 2), 3] });
    expect(profile.keys).toEqual(['blend', 'pastB', 'cornerB', 'cornerA', 'pastA']);
    expect(profile.points.map((p) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0))).toEqual([
      [3, 0],
      [0, 3],
      [-3, 3],
      [-3, -3],
      [3, -3],
    ]);
    expect(area(profile.points)).toBeGreaterThan(0);
    expect(area(profile.wedge)).toBeCloseTo(4.5, 12);
  });

  it('a fillet: the setback r / tan(β/2), the arc divided for half the chord tolerance, its wedge the corner less the quarter circle', () => {
    const beta = Math.PI / 3;
    const profile = blendProfile('fillet', 2, { beta, convex: true, round: [false, false] }, tol);
    expect(profile.setback).toBeCloseTo(2 / Math.tan(beta / 2), 12);
    expect(profile.blend.type).toBe('round');
    if (profile.blend.type === 'round') {
      expect(Math.hypot(...profile.blend.center)).toBeCloseTo(2 / Math.sin(beta / 2), 12);
      for (const p of profile.wedge.slice(1)) expect(Math.hypot(p[0] - profile.blend.center[0], p[1] - profile.blend.center[1])).toBeCloseTo(2, 12);
    }
    const right = blendProfile('fillet', 2, { beta: Math.PI / 2, convex: true, round: [false, false] }, tol);
    expect(area(right.wedge)).toBeGreaterThan(4 - Math.PI);
    expect(area(right.wedge)).toBeLessThan(4 - Math.PI + 0.01);
    expect(area(profile.points)).toBeGreaterThan(0);
  });

  it('the lift: only an end on a round face is moved off it, a chamfer along its line, a fillet along the normal', () => {
    const lift = BLEND_LIFT * tol;
    const plain = blendProfile('chamfer', 2, { beta: Math.PI / 2, convex: true, round: [false, false] }, tol);
    const lifted = blendProfile('chamfer', 2, { beta: Math.PI / 2, convex: true, round: [true, false] }, tol);
    expect(lifted.points[1]).toEqual(plain.points[1]);
    expect(lifted.points[0][1]).toBeCloseTo(-lift, 12); // off face a by the lift
    expect(lifted.points[0][0] + lifted.points[0][1]).toBeCloseTo(2, 12); // on the line of the chamfer
    const round = blendProfile('fillet', 2, { beta: Math.PI / 2, convex: true, round: [false, true] }, tol);
    const last = round.points[round.keys.indexOf('pastB')];
    expect(last[0]).toBeCloseTo(-lift, 12);
    expect(last[1]).toBeCloseTo(2, 12);
    expect(round.points[0][0]).toBeCloseTo(2, 12);
    expect(round.points[0][1]).toBe(0);
  });

  it('the overshoot: the size past a convex edge, four chord tolerances past a concave one', () => {
    const lift = BLEND_LIFT * tol;
    expect(overshootOf(3, true, lift)).toBe(3);
    expect(overshootOf(0.01, true, lift)).toBeCloseTo(0.04, 12);
    expect(overshootOf(3, false, lift)).toBeCloseTo(0.04, 12);
    // a lift held up by the band of the kernel holds up the overshoot in the same share
    expect(overshootOf(3, false, 0.03)).toBeCloseTo(0.08, 12);
    expect(liftOf(0.01, 0.001)).toBeCloseTo(0.015, 12);
    expect(liftOf(0.001, 0.001)).toBeCloseTo(0.002, 12);
    const concave = blendProfile('chamfer', 3, { beta: Math.PI / 2, convex: false, round: [false, false] }, tol);
    expect(concave.points[3][0]).toBeCloseTo(-0.04, 12);
    expect(concave.points[3][1]).toBeCloseTo(-0.04, 12);
  });
});

// A kernel that triangulates a convex loop as a fan; enough for the prism of a chamfer.
const fan: Pick<SolidKernel, 'triangulate'> = {
  triangulate: ([loop]) => Uint32Array.from(Array.from({ length: loop.length / 2 - 2 }, (_, i) => [0, i + 1, i + 2]).flat()),
};

describe('the prism of a straight piece', () => {
  const frame: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
  const square: Vec2[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  const closed = (triangles: Uint32Array): boolean => {
    const directed = new Set<string>();
    for (let t = 0; t < triangles.length; t += 3) for (let k = 0; k < 3; k++) directed.add(`${triangles[t + k]}>${triangles[t + ((k + 1) % 3)]}`);
    return [...directed].every((side) => directed.has(side.split('>').reverse().join('>')));
  };

  it('closed and facing outwards between two planes across the edge; the faces by side and by end', () => {
    const prism = edgePrism(square, [1, 2, 3, 4], frame, [{ point: [0, 0, 0], normal: [0, 0, 1] }, { point: [0, 0, 10], normal: [0, 0, -1] }], [5, 6], fan);
    expect(closed(prism.triangles)).toBe(true);
    expect(volumeOf(prism)).toBeCloseTo(40, 4);
    expect([...new Set(prism.faceIds)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ends in slanted planes; the shortest length tells ends that meet within the profile', () => {
    const ends: [{ point: Vec3; normal: Vec3 }, { point: Vec3; normal: Vec3 }] = [
      { point: [0, 0, 0], normal: [-1, 0, 1] },
      { point: [0, 0, 10], normal: [1, 0, 1] },
    ];
    const prism = edgePrism(square, [1, 1, 1, 1], frame, ends, [2, 3], fan);
    expect(closed(prism.triangles)).toBe(true);
    // the length along Z at x is 10 − 2x: the mean over the square is 8
    expect(volumeOf(prism)).toBeCloseTo(32, 4);
    expect(prismLength(square, frame, ends)).toBeCloseTo(6, 9);
    expect(prismLength(square, frame, [{ point: [0, 0, 0], normal: [-1, 0, 1] }, { point: [0, 0, 1], normal: [1, 0, 1] }])).toBeLessThan(0);
  });
});

describe('the region of the revolve of a circular piece', () => {
  it('carried into (ρ, z), reversed with its keys where the place mirrors it', () => {
    const points: Vec2[] = [
      [1, 0],
      [0, 1],
      [-1, -1],
    ];
    const keys = ['blend', 'pastB', 'cornerA'];
    const straight = revolveRegion({ point: [10, 0], alongA: [1, 0], acrossTowardsB: [0, 1] }, points, keys);
    expect(straight.outer.xy).toEqual([11, 0, 10, 1, 9, -1]);
    expect(straight.outer.curves).toEqual(keys);
    const mirrored = revolveRegion({ point: [10, 0], alongA: [1, 0], acrossTowardsB: [0, -1] }, points, keys);
    // the points reversed, and each side keeps its key: from (9, 1) to (10, −1) is the old side 1 → 2
    expect(mirrored.outer.xy).toEqual([9, 1, 10, -1, 11, 0]);
    expect(mirrored.outer.curves).toEqual(['pastB', 'blend', 'cornerA']);
    const setup = blendRevolveSetup(straight, 2 * Math.PI, true, 0.01);
    expect(setup.axis).toEqual({ point: [0, 0], direction: [0, 1], side: -1 });
    expect(setup.triangles).toBe(3 * 2 * setup.steps);
    expect(blendRevolveSetup(straight, 1, false, 0.01).triangles).toBe(3 * 2 * blendRevolveSetup(straight, 1, false, 0.01).steps + 2);
    expect(BLEND_SIDES).toEqual(['blend', 'pastB', 'cornerB', 'cornerA', 'pastA']);
  });
});

describe('the normal of a surface at a point', () => {
  const near = (v: Vec3 | undefined, w: Vec3) => {
    expect(v).toBeDefined();
    const parallel = Math.hypot((v as Vec3)[1] * w[2] - (v as Vec3)[2] * w[1], (v as Vec3)[2] * w[0] - (v as Vec3)[0] * w[2], (v as Vec3)[0] * w[1] - (v as Vec3)[1] * w[0]);
    expect(parallel).toBeLessThan(1e-12);
  };
  it('a plane, a cylinder, a cone, a sphere, a torus with a signed major radius; none on an axis or of a swept surface', () => {
    const plane: FaceInfo = { planar: true, origin: [0, 0, 0], y: [0, 1, 0], normal: [0, 0, 2] };
    near(normalAt(plane, [5, 5, 0]), [0, 0, 1]);
    near(normalAt({ planar: false, surface: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], radius: 2 }, [0, 2, 7]), [0, 1, 0]);
    expect(normalAt({ planar: false, surface: 'cylinder', center: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], radius: 2 }, [0, 0, 7])).toBeUndefined();
    // a cone of 45° from the origin up Z: at (1, 0, 1) the normal is (1, 0, −1)/√2
    near(normalAt({ planar: false, surface: 'cone', apex: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], halfAngle: Math.PI / 4 }, [1, 0, 1]), [1, 0, -1]);
    near(normalAt({ planar: false, surface: 'sphere', center: [1, 1, 1], radius: 1 }, [1, 1, 2]), [0, 0, 1]);
    near(normalAt({ planar: false, surface: 'torus', center: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], majorRadius: 10, minorRadius: 2 }, [12, 0, 0]), [1, 0, 0]);
    near(normalAt({ planar: false, surface: 'torus', center: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], majorRadius: 10, minorRadius: 2 }, [10, 0, 2]), [0, 0, 1]);
    // a negative major radius: the centre of the tube lies across the axis from the point
    near(normalAt({ planar: false, surface: 'torus', center: [0, 0, 0], axis: [0, 0, 1], along: [0, 0, 1], majorRadius: -1, minorRadius: 2 }, [1, 0, Math.sqrt(4 - 4)]), [1, 0, 0]);
    expect(normalAt({ planar: false, surface: 'swept', axis: [0, 0, 1] }, [0, 0, 0])).toBeUndefined();
  });
});
