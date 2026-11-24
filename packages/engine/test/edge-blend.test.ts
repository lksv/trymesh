// D63 (package 4b of D36) without adapters: the features `chamfer` and `fillet` in the document, the
// profile of a corner, the prism of a straight piece, the region of a revolve of a circular one,
// and the normal of a surface. The recompute against the real adapters is in
// packages/scenarios/test/edge-blend.test.ts.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, fieldsOf } from '../src/document';
import { FEATURE_TYPE_INFO, specOf } from '../src/features/index';
import { faceKey } from '../src/face-roles';
import { BLEND_LIFT, BLEND_MIN_CROSSING, BLEND_RUN_OUT_VOID, BLEND_SIDES, type Motion, type RunOutFace, blendProfile, blendRevolveSetup, checkFrom, edgePrism, implicit, liftOf, moved, overshootOf, prismLength, reachPast, revolveRegion, rootsAlong, runOutRegionSides, runOutUncertain } from '../src/recompute/tool-edge';
import { crossingAt, sameCylinder } from '../src/recompute/edge-blend';
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

// ---------------------------------------------------------------- run-outs (D67)

describe('run-outs past a round face (D67): the exact geometry without adapters', () => {
  const deg = Math.PI / 180;
  const cylinder = (point: Vec3, axis: Vec3, radius: number): RunOutFace => ({ kind: 'cylinder', point, axis, radius });
  const line = (point: Vec3, direction: Vec3): Motion => ({ kind: 'translation', point, direction });
  const turn = (radius: number, angle: number, sense: 1 | -1): Motion => ({ kind: 'rotation', center: [0, 0, 0], axis: [0, 0, 1], radius, point: [radius * Math.cos(angle), radius * Math.sin(angle), 0], sense });

  it('the constants: the least crossing angle 10°, the bound of the void check 10⁻⁵ mm³ with the uncertainty of a non-empty result', () => {
    expect(BLEND_MIN_CROSSING).toBeCloseTo(10 * deg, 15);
    expect(BLEND_RUN_OUT_VOID).toBe(1e-5);
    expect(runOutUncertain(1e-6, 5)).toBe(false);
    expect(runOutUncertain(1e-6, 20)).toBe(true);
  });

  it('crossingAt: a line and a cylinder, upright and tilted; the side of a hole is its inside and its air', () => {
    // a hole of radius 2 about the line x 10, y 0: its wall faces the axis, the air
    const hole = cylinder([10, 0, 0], [0, 0, 1], 2);
    const found = crossingAt(hole, [1, 0, 0], line([0, 0, 0], [1, 0, 0]), 8, 0.1);
    expect('refused' in found).toBe(false);
    if (!('refused' in found)) {
      expect(found.at).toBeCloseTo(8, 12);
      expect(found.crossing).toBeCloseTo(1, 12);
      expect(found.beyondInside).toBe(true);
      expect(found.intoAir).toBe(true);
    }
    // the same face as the wall of a boss (its outward normal away from the axis): into material
    const boss = crossingAt(hole, [-1, 0, 0], line([0, 0, 0], [1, 0, 0]), 8, 0.1);
    expect(!('refused' in boss) && boss.intoAir).toBe(false);
    // the axis tilted 25° in XZ: the roots 10 ± 2 / cos 25°, the crossing 65°
    const tilted = cylinder([10, 0, 0], [Math.sin(25 * deg), 0, Math.cos(25 * deg)], 2);
    const t = crossingAt(tilted, [1, 0, 0], line([0, 0, 0], [1, 0, 0]), 10 - 2 / Math.cos(25 * deg), 0.1);
    expect('refused' in t).toBe(false);
    if (!('refused' in t)) {
      expect(t.at).toBeCloseTo(10 - 2 / Math.cos(25 * deg), 9);
      expect(Math.asin(t.crossing) / deg).toBeCloseTo(65, 9);
    }
  });

  it('crossingAt: an arc and a parallel cylinder; an arc and a plane it crosses twice (a keyway) read between the roots; none or two roots in the band', () => {
    // the rim of radius 10 from the angle π on, a pocket of radius 2 at (10, 0)
    const phi = Math.acos(0.98);
    const pocket = crossingAt(cylinder([10, 0, 0], [0, 0, 1], 2), [-1, 0, 0], turn(10, Math.PI, 1), Math.PI - phi, 0.01);
    expect('refused' in pocket).toBe(false);
    if (!('refused' in pocket)) {
      expect(pocket.at).toBeCloseTo(Math.PI - phi, 12);
      expect(pocket.beyondInside).toBe(true);
    }
    // the side y = 1.5 of a keyway: the circle from π backwards crosses it at π − 0.15 first and at
    // the end, 0.15, second; between those roots it lies at y > 1.5, so beyond the end is y < 1.5
    const side: RunOutFace = { kind: 'plane', origin: [0, 1.5, 0], normal: [0, 1, 0] };
    const theta = Math.asin(0.15);
    const keyway = crossingAt(side, [0, -1, 0], turn(10, Math.PI, -1), Math.PI - theta, 0.01);
    expect('refused' in keyway).toBe(false);
    if (!('refused' in keyway)) {
      expect(keyway.at).toBeCloseTo(Math.PI - theta, 12);
      expect(keyway.beyondInside).toBe(true); // against the normal: y < 1.5
      expect(keyway.intoAir).toBe(true);
      expect(Math.asin(keyway.crossing)).toBeCloseTo(Math.PI / 2 - theta, 9);
    }
    // read at the middle of the piece (y = 0) the side would be the keyway's
    expect(implicit(side, [-10, 0, 0])).toBeLessThan(0);
    expect(crossingAt(hole2(), [1, 0, 0], line([0, 0, 0], [1, 0, 0]), 5, 0.1)).toEqual({ refused: 'missed' });
    expect(crossingAt(cylinder([10, 0, 0], [0, 0, 1], 0.05), [1, 0, 0], line([0, 0, 0], [1, 0, 0]), 9.95, 0.2)).toEqual({ refused: 'grazes' });
    function hole2(): RunOutFace {
      return cylinder([10, 0, 0], [0, 0, 1], 2);
    }
  });

  it('rootsAlong and moved: a rotation carries a point about its axis by sense · t', () => {
    const motion = turn(10, 0, -1);
    const q = moved(motion, [10, 0, 3], Math.PI / 2);
    expect(q[0]).toBeCloseTo(0, 12);
    expect(q[1]).toBeCloseTo(-10, 12);
    expect(q[2]).toBeCloseTo(3, 12);
    expect(rootsAlong(line([0, 0, 0], [1, 0, 0]), cylinder([10, 0, 0], [0, 0, 1], 2)).map((t) => Number(t.toFixed(12)))).toEqual([8, 12]);
  });

  // The wedge of a chamfer of 1 at a right angle at the end (8, 0, 0) of an edge along +x: face a
  // the top z = 0 (material below), face b the front y = 0 (material at y > 0).
  const wedgeAt = (x: number, size = 1): Vec3[] => [
    [x, 0, 0],
    [x, size, 0],
    [x, 0, -size],
  ];

  it('reachPast: into a hole, exactly; a hole the corner never fits in (a bridge)', () => {
    const lift = 0.015;
    const reach = reachPast(wedgeAt(8), line([8, 0, 0], [1, 0, 0]), cylinder([10, 0, 0], [0, 0, 1], 2), true, lift, 50);
    expect(reach).toBeCloseTo(2 - Math.sqrt((2 - lift) ** 2 - 1), 12);
    expect(reachPast(wedgeAt(8), line([8, 0, 0], [1, 0, 0]), cylinder([10, 0.5, 0], [0, 0, 1], 0.4), true, lift, 50)).toBeUndefined();
    // a limit before the reach: no reach
    expect(reachPast(wedgeAt(8), line([8, 0, 0], [1, 0, 0]), cylinder([10, 0, 0], [0, 0, 1], 2), true, lift, 0.2)).toBeUndefined();
  });

  it('reachPast: a point that has crossed and come back does not count; the intersection of the sets', () => {
    // a hole tilted 45° in XZ: the point at the top of the corner is inside it for t in [1.6, 2.4],
    // the point 1 below for t in [0.6, 1.4]; the latest first crossing (1.6) is no reach
    const tilted = cylinder([10, 0, 0], [Math.SQRT1_2, 0, Math.SQRT1_2], 0.3 + 0.015);
    const points: Vec3[] = [
      [8, 0, 0],
      [8, 0, -1],
    ];
    expect(reachPast(points, line([8, 0, 0], [1, 0, 0]), tilted, true, 0.015, 50)).toBeUndefined();
    // a wider hole: the two intervals overlap, the reach is where the later one starts
    const wide = cylinder([10, 0, 0], [Math.SQRT1_2, 0, Math.SQRT1_2], 0.8 + 0.015);
    const reach = reachPast(points, line([8, 0, 0], [1, 0, 0]), wide, true, 0.015, 50) as number;
    expect(reach).toBeCloseTo(2 - 0.8 * Math.SQRT2, 9);
  });

  it('reachPast: out through a shaft, where the points clear before the polygon does (round 2 refused it as a bridge)', () => {
    // the top edge of the wall y = −1 of a slot across a shaft of radius 6 (axis z), a chamfer of 2:
    // its points clear the cylinder of 6 + lift at x 5.93, its side from y −1 to 1 only at 6 + lift
    const lift = 0.015;
    const end = Math.sqrt(35);
    const wedge: Vec3[] = [
      [end, -1, 0],
      [end, 1, 0],
      [end, -1, -2],
    ];
    const reach = reachPast(wedge, line([end, -1, 0], [1, 0, 0]), cylinder([0, 0, 0], [0, 0, 1], 6), false, lift, 50) as number;
    expect(end + reach).toBeCloseTo(6 + lift, 9);
  });

  it('reachPast: a rotation out through a cylinder (the rim of a hole broken out through a disc)', () => {
    // a hole of radius 4 about (8, 0) through a disc of radius 10: its rim leaves the disc at
    // (9.25, ±3.80); the end at the larger y, turning towards (12, 0)
    const lift = 0.015;
    const start = Math.atan2(Math.sqrt(100 - 9.25 ** 2), 1.25);
    const motion: Motion = { kind: 'rotation', center: [8, 0, 0], axis: [0, 0, 1], radius: 4, point: [8 + 4 * Math.cos(start), 4 * Math.sin(start), 0], sense: -1 };
    const at = (rho: number, z: number): Vec3 => [8 + rho * Math.cos(start), rho * Math.sin(start), z];
    const reach = reachPast([at(4, 0), at(5, 0), at(4, -1)], motion, cylinder([0, 0, 0], [0, 0, 1], 10), false, lift, Math.PI) as number;
    // the nearest point is the corner, at radius 4 about the hole's axis: |(8 + 4 cos θ, 4 sin θ)| = 10 + lift
    expect(start - reach).toBeCloseTo(Math.acos(((10 + lift) ** 2 - 80) / 64), 9);
  });

  it('checkFrom: a profile clear at once; an acute fillet whose profile reaches the hole far back; the plane of a keyway crossed again; a piece too short', () => {
    const offset = 0.025;
    const hole = cylinder([10, 0, 0], [0, 0, 1], 2);
    // the tool profile of the chamfer at the end lies in the hole only past the end: clear at once,
    // then back by the margin
    expect(checkFrom(wedgeAt(8), line([8, 0, 0], [-1, 0, 0]), hole, true, offset, 8, 1.5)).toBeCloseTo(1.5, 12);
    expect(checkFrom(wedgeAt(8), line([8, 0, 0], [-1, 0, 0]), hole, true, offset, 1, 1.5)).toBeCloseTo(0.5, 12);
    // a fillet of 1 between faces at 10°: its profile reaches 11.4 along face a; a hole of radius 25
    // crossing the edge at 45°: the far points of the profile are in the hole long before the end
    const profile = blendProfile('fillet', 1, { beta: 10 * deg, convex: true, round: [false, false] }, 0.01);
    expect(profile.setback).toBeGreaterThan(11);
    const toWorld = (q: Vec2): Vec3 => [8, q[0], q[1]];
    const points = profile.points.map(toWorld);
    const c: Vec3 = [8 + 25 * Math.cos(45 * deg), 25 * Math.sin(45 * deg), 0];
    const big = cylinder(c, [0, 0, 1], 25);
    const first = checkFrom(points, line([8, 0, 0], [-1, 0, 0]), big, true, offset, 100, 0) as number;
    const inRegion = (t: number): boolean => points.some((p) => Math.hypot(p[0] - t - c[0], p[1] - c[1]) < 25 - offset);
    expect(first).toBeGreaterThan(5);
    expect(inRegion(first - 1e-6)).toBe(true);
    expect(inRegion(first + 1e-6)).toBe(false);
    expect(checkFrom(points, line([8, 0, 0], [-1, 0, 0]), big, true, offset, first / 2, 0)).toBeUndefined();
    // the rim of radius 10 back from its end at the keyway's side y = 1.5 (beyond: y < 1.5): the
    // profile is clear from near the end to where the circle comes back below y = 1.5 at π − 0.15
    const theta = Math.asin(0.15);
    const rim = (q: Vec2): Vec3 => [(10 + q[0]) * Math.cos(theta), (10 + q[0]) * Math.sin(theta), -q[1]];
    const chamferProfile = blendProfile('chamfer', 0.5, { beta: Math.PI / 2, convex: true, round: [false, true] }, 0.01).points.map(rim);
    const side: RunOutFace = { kind: 'plane', origin: [0, 1.5, 0], normal: [0, -1, 0] };
    const from = checkFrom(chamferProfile, turn(10, theta, 1), side, false, offset, 2 * Math.PI - 2 * theta, 100) as number;
    expect(from).toBeGreaterThan(0);
    expect(from).toBeLessThan(Math.PI - 2 * theta);
  });

  it('runOutRegionSides: the sagitta within a quarter of the chord tolerance; past 4 096 sides refused', () => {
    for (const [radius, tol] of [
      [10, 0.01],
      [500, 0.01],
      [2.5, 0.05],
    ]) {
      const n = runOutRegionSides(radius, tol) as number;
      expect(radius * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(tol / 4 + 1e-12);
    }
    expect(runOutRegionSides(500, 0.01)).toBe(994);
    expect(runOutRegionSides(100000, 0.001)).toBeUndefined();
  });

  it('sameCylinder: by the axis line and the radius, the points given anywhere on the axis', () => {
    const a = cylinder([1, 2, 0], [0, 0, 1], 3);
    expect(sameCylinder(a, cylinder([1, 2, 7], [0, 0, -1], 3), 1e-5)).toBe(true);
    expect(sameCylinder(a, cylinder([1, 2.01, 7], [0, 0, 1], 3), 1e-5)).toBe(false);
    expect(sameCylinder(a, cylinder([1, 2, 7], [0, 0, 1], 3.01), 1e-5)).toBe(false);
    expect(sameCylinder(a, cylinder([1, 2, 0], [0, 0.01, 1], 3), 1e-5)).toBe(false);
    expect(sameCylinder(a, { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] }, 1e-5)).toBe(false);
  });

  it('the texts: the message of unsupportedEdge names run-outs, stops and bridges; the summaries say where an edge may end', () => {
    expect(MESSAGE.unsupportedEdge).toMatch(/running out into a hole, a pocket or a boss it crosses/);
    expect(MESSAGE.unsupportedEdge).toMatch(/An edge that would have to stop at a round face or bridge a gap is not taken yet\.$/);
    for (const type of ['chamfer', 'fillet'] as const) expect(FEATURE_TYPE_INFO[type].summary).toMatch(/run out past a round face it crosses at 10° or more/);
  });
});
