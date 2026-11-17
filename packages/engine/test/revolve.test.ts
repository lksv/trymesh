// D58 (package 4a of D36) without adapters: the feature `revolve` in the document, the kind
// `sketchLine` of `AxisRef`, the circles two surfaces meet in (`circlesBetween`, `circleBetween`
// with the points of an edge), the setup of a turn and the tool build over a hand-made profile.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch, fieldsOf } from '../src/document';
import { FEATURE_TYPE_INFO } from '../src/features/index';
import type { Outline, ResolvedProfile } from '../src/recompute/state';
import { MAX_REVOLVE_TRIANGLES, buildRevolve, revolveSetup } from '../src/recompute/tool-revolve';
import type { OutlineCurve } from '../src/sketch';
import { volumeOf } from '../src/solid';
import { type Circle3, circleBetween, circlesBetween } from '../src/surfaces';
import type { AxisRef, Command, Document, FeaturePatch, Frame, Input, PlaneRef, RevolveFeature, SolidKernel, Surface, Vec2, Vec3 } from '../src/types';
import { axisRefs } from '../src/validation';

const XZ: PlaneRef = { kind: 'base', plane: 'XZ' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const revolve = (id: string, extra: Partial<Input<RevolveFeature>> = {}): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['a', 'b', 'c'] }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'full' }, operation: 'new', ...extra },
});
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const feature = (doc: Document, id: string): RevolveFeature => doc.features.find((f) => f.id === id) as RevolveFeature;

// A sketch S on XZ with a triangle a, b, c, a construction line `ax`, a circle `k`; a body A.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'addFeature', feature: emptySketch('S', 'S', XZ) },
    ...(['p1', 'p2', 'p3', 'q1', 'q2'] as const).map((id, i): Command => ({ type: 'addPoint', sketch: 'S', id, x: [5, 10, 5, 0, 0][i], y: [0, 0, 5, 0, 10][i] })),
    { type: 'addCurve', sketch: 'S', id: 'a', curve: { type: 'line', a: 'p1', b: 'p2' } },
    { type: 'addCurve', sketch: 'S', id: 'b', curve: { type: 'line', a: 'p2', b: 'p3' } },
    { type: 'addCurve', sketch: 'S', id: 'c', curve: { type: 'line', a: 'p3', b: 'p1' } },
    { type: 'addCurve', sketch: 'S', id: 'ax', curve: { type: 'line', a: 'q1', b: 'q2', construction: true } },
    { type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'q1' }, radius: 2 },
    revolve('A'),
  );
}

describe('the feature revolve in the document', () => {
  it('takes regions or a wall, an axis, a whole turn or an angle; its fields are those of the profile and the extent', () => {
    const doc = run(base(), revolve('B', { extent: { type: 'angle', start: 'deg(-45)', angle: 'deg(90)' }, axis: { kind: 'sketchLine', sketch: 'S', line: 'ax' } }));
    expect(feature(doc, 'B').extent).toEqual({ type: 'angle', start: -Math.PI / 4, angle: Math.PI / 2 });
    expect(feature(doc, 'B').expressions).toEqual({ 'extent/angle': 'deg(90)', 'extent/start': 'deg(-45)' });
    expect(fieldsOf(feature(doc, 'B')).map((field) => field.path)).toEqual(['extent/start', 'extent/angle']);
    expect(FEATURE_TYPE_INFO.revolve.fields.map((field) => field.path)).toEqual(['profile/offset', 'profile/thickness', 'extent/start', 'extent/angle']);
    expect(FEATURE_TYPE_INFO.revolve.updatable).toEqual(['profile', 'axis', 'extent', 'operation', 'targets']);
  });

  it('refuses a generated profile, an angle of a whole turn or of zero, a key of another variant, targets of the wrong count', () => {
    const doc = base();
    invalid(doc, revolve('B', { profile: { type: 'generated', generator: 'involuteGear', sketch: 'S', operands: { circle: 'k' }, params: { teeth: 20 } } as never }), /a revolve takes regions or a wall/);
    invalid(doc, revolve('B', { extent: { type: 'angle', start: 0, angle: 'deg(360)' } }), /extent\.angle/);
    invalid(doc, revolve('B', { extent: { type: 'angle', start: 0, angle: -7 } }), /extent\.angle/);
    invalid(doc, revolve('B', { extent: { type: 'angle', start: 0, angle: 0 } }), /extent\.angle/);
    invalid(doc, revolve('B', { extent: { type: 'angle', angle: 1 } as never }), /extent\.start/);
    invalid(doc, revolve('B', { extent: { type: 'full', angle: 1 } as never }), /extent\.angle: the extent full \(a whole turn\) has no such field/);
    invalid(doc, revolve('B', { extent: { type: 'angle', start: 0, angle: 1, taper: 0 } as never }), /extent\.taper: the extent angle has no such field/);
    invalid(doc, revolve('B', { operation: 'add' }), /needs exactly one target body/);
    invalid(doc, revolve('B', { operation: 'cut', targets: ['A', 'A'] }), /listed twice/);
    invalid(doc, revolve('B', { targets: ['A'] }), /a new body has no target/);
    invalid(doc, { type: 'setField', feature: 'A', path: 'extent/angle', value: 1 }, /extent\/angle/);
  });

  it('the patch: an extent of another type replaced, the axis replaced whole, a change to new drops the targets; no taper to remove', () => {
    let doc = run(base(), revolve('B', { operation: 'cut', targets: ['A'] }));
    doc = run(doc, update('B', { extent: { type: 'angle', start: 0, angle: 1 } }), update('B', { extent: { angle: 2 } }));
    expect(feature(doc, 'B').extent).toEqual({ type: 'angle', start: 0, angle: 2 });
    doc = run(doc, update('B', { axis: { kind: 'sketchLine', sketch: 'S', line: 'ax' } }));
    expect(feature(doc, 'B').axis).toEqual({ kind: 'sketchLine', sketch: 'S', line: 'ax' });
    doc = run(doc, update('B', { profile: { offset: 1 } }), update('B', { profile: { offset: null } }));
    expect(feature(doc, 'B').profile).toEqual({ type: 'regions', sketch: 'S', regions: [{ outerLoop: ['a', 'b', 'c'] }] });
    invalid(doc, update('B', { extent: { taper: null } } as never), /taper/);
    doc = run(doc, update('B', { operation: 'new' }));
    expect(feature(doc, 'B').targets).toBeUndefined();
  });
});

describe('the kind sketchLine of AxisRef', () => {
  it('a line of the sketch, own (construction or not) or projected; a point or a circle is refused; its references', () => {
    const doc = base();
    const pattern = (axis: unknown): Command => ({ type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'A' }, transform: { type: 'circular', axis: axis as AxisRef, count: 3, span: { type: 'full' } } } });
    expect(() => applyCommand(doc, pattern({ kind: 'sketchLine', sketch: 'S', line: 'a' }))).not.toThrow();
    expect(() => applyCommand(doc, pattern({ kind: 'sketchLine', sketch: 'S', line: 'ax' }))).not.toThrow();
    invalid(doc, pattern({ kind: 'sketchLine', sketch: 'S', line: 'k' }), /"k" is a circle, expected line/);
    invalid(doc, pattern({ kind: 'sketchLine', sketch: 'S', line: 'p1' }), /"p1" is a point, expected line/);
    invalid(doc, pattern({ kind: 'sketchLine', sketch: 'S', line: 'ax', point: 'p1' }), /point: an axis of the kind sketchLine has no such field/);
    invalid(doc, pattern({ kind: 'sketchLine', sketch: 'S' }), /line/);
    expect(axisRefs({ kind: 'sketchLine', sketch: 'S', line: 'ax' }, 'axis')).toEqual([
      { path: 'axis', id: 'S', kind: 'sketch' },
      { path: 'axis', id: 'ax', kind: 'entity', sketch: 'S', accepts: ['line'] },
    ]);
    // a projected line is a line of the sketch
    const projected = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'S2', XZ) }, { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'A', edge: { a: { feature: 'A', role: 'side', curve: 'a' }, b: { feature: 'A', role: 'side', curve: 'b' } }, kind: 'line' } });
    expect(() => applyCommand(projected, pattern({ kind: 'sketchLine', sketch: 'S2', line: 'x' }))).not.toThrow();
  });
});

// ---------------------------------------------------------------- the circles of two surfaces

// `circleBetween` as it was before the sphere and the torus (master at 101007f), the reference of
// the comparison on random pairs.
function before(a: Surface, b: Surface): Circle3 | undefined {
  const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
  const unit = (v: Vec3): Vec3 => [v[0] / len(v), v[1] / len(v), v[2] / len(v)];
  const sub = (x: Vec3, y: Vec3): Vec3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const add = (x: Vec3, y: Vec3): Vec3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
  const mul = (x: Vec3, s: number): Vec3 => [x[0] * s, x[1] * s, x[2] * s];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const cross = (x: Vec3, y: Vec3): Vec3 => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const parallel = (x: Vec3, y: Vec3) => len(cross(unit(x), unit(y))) <= Math.sin(1e-4);
  type Round = Extract<Surface, { kind: 'cylinder' | 'cone' }>;
  const pointOf = (r: Round): Vec3 => (r.kind === 'cylinder' ? r.origin : r.apex);
  const coaxial = (x: Round, y: Round): boolean => {
    if (!parallel(x.axis, y.axis)) return false;
    const axis = unit(x.axis);
    const apart = sub(pointOf(y), pointOf(x));
    return len(sub(apart, mul(axis, dot(apart, axis)))) <= 1e-6;
  };
  const circle = (center: Vec3, axis: Vec3, radius: number): Circle3 | undefined => (radius > 1e-6 ? { center, axis, radius } : undefined);
  if (a.kind === 'plane' || b.kind === 'plane') {
    const [plane, round] = a.kind === 'plane' ? [a, b] : [b, a];
    if (plane.kind !== 'plane' || (round.kind !== 'cylinder' && round.kind !== 'cone')) return undefined;
    const [normal, axis] = [unit(plane.normal), unit(round.axis)];
    if (!parallel(normal, axis)) return undefined;
    const along = dot(normal, sub(plane.origin, pointOf(round))) / dot(normal, axis);
    const center = add(pointOf(round), mul(axis, along));
    if (round.kind === 'cylinder') return circle(center, axis, round.radius);
    return along > 0 ? circle(center, axis, along * Math.tan(round.halfAngle)) : undefined;
  }
  if ((a.kind !== 'cylinder' && a.kind !== 'cone') || (b.kind !== 'cylinder' && b.kind !== 'cone') || !coaxial(a, b)) return undefined;
  if (a.kind === 'cylinder' && b.kind === 'cylinder') return undefined;
  if (a.kind === 'cylinder' || b.kind === 'cylinder') {
    const [cylinder, cone] = (a.kind === 'cylinder' ? [a, b] : [b, a]) as [Extract<Surface, { kind: 'cylinder' }>, Extract<Surface, { kind: 'cone' }>];
    const axis = unit(cone.axis);
    return circle(add(cone.apex, mul(axis, cylinder.radius / Math.tan(cone.halfAngle))), axis, cylinder.radius);
  }
  const [p1, p2] = [a as Extract<Surface, { kind: 'cone' }>, b as Extract<Surface, { kind: 'cone' }>];
  const u = unit(p1.axis);
  const p = dot(sub(p2.apex, p1.apex), u);
  const [sa, sb] = [1, Math.sign(dot(unit(p2.axis), u))];
  const [ta, tb] = [Math.tan(p1.halfAngle), Math.tan(p2.halfAngle)];
  const denominator = sa * ta - sb * tb;
  if (Math.abs(denominator) <= 1e-12) return undefined;
  const s = (-sb * p * tb) / denominator;
  if (!(s * sa > 0 && (s - p) * sb > 0)) return undefined;
  return circle(add(p1.apex, mul(u, s)), u, s * sa * ta);
}

const Z: Vec3 = [0, 0, 1];
const plane = (z: number, normal: Vec3 = Z): Surface => ({ kind: 'plane', origin: [0, 0, z], normal });
const cylinder = (radius: number): Surface => ({ kind: 'cylinder', origin: [0, 0, 0], axis: Z, radius });
const torus = (z: number, major: number, minor: number): Surface => ({ kind: 'torus', center: [0, 0, z], axis: Z, majorRadius: major, minorRadius: minor });
const sphere = (center: Vec3, radius: number): Surface => ({ kind: 'sphere', center, radius });
// points of a circle about Z, at radius r and height z (a few of them, as an edge has)
const ring = (r: number, z: number, count = 12, from = 0, sweep = 2 * Math.PI): number[] => Array.from({ length: count }, (_, i) => [r * Math.cos(from + (sweep * i) / (count - 1)), r * Math.sin(from + (sweep * i) / (count - 1)), z]).flat();
const shape = (circles: Circle3[]): [number, number][] => circles.map((c) => [+c.center[2].toFixed(4), +c.radius.toFixed(4)]);

describe('the circles two surfaces meet in (D58)', () => {
  it('on 20 000 random pairs of planes, cylinders and cones the circle of today, or none', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const unit = (): Vec3 => {
      const v: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
      const l = Math.hypot(...v);
      return [v[0] / l, v[1] / l, v[2] / l];
    };
    let differ = 0;
    for (let i = 0; i < 20000; i++) {
      const u: Vec3 = random() < 0.8 ? [0, 0, 1] : unit();
      const o: Vec3 = [random() * 10, random() * 10, random() * 10];
      const make = (): Surface => {
        const k = Math.floor(random() * 3);
        const z = random() * 20 - 10;
        const at: Vec3 = [o[0] + u[0] * z, o[1] + u[1] * z, o[2] + u[2] * z];
        const axis: Vec3 = random() < 0.5 ? u : [-u[0], -u[1], -u[2]];
        if (random() < 0.1) return { kind: 'plane', origin: at, normal: unit() };
        if (k === 0) return { kind: 'plane', origin: at, normal: axis };
        if (k === 1) return { kind: 'cylinder', origin: at, axis, radius: 0.5 + random() * 5 };
        return { kind: 'cone', apex: at, axis, halfAngle: 0.1 + random() * 1.3 };
      };
      const [a, b] = [make(), make()];
      const [x, y] = [before(a, b), circleBetween(a, b)];
      const agree = (!x && !y) || (x && y && Math.hypot(x.center[0] - y.center[0], x.center[1] - y.center[1], x.center[2] - y.center[2]) < 1e-9 && Math.abs(x.radius - y.radius) < 1e-9 && Math.abs(Math.abs(x.axis[0] * y.axis[0] + x.axis[1] * y.axis[1] + x.axis[2] * y.axis[2]) - 1) < 1e-12);
      if (!agree) differ++;
    }
    expect(differ).toBe(0);
  });

  it('the pairs of the sphere and the torus ("Measured", E)', () => {
    const t = torus(10, 20, 3);
    expect(shape(circlesBetween(t, plane(11)))).toEqual([[11, 17.1716], [11, 22.8284]]);
    expect(circleBetween(t, plane(11), ring(20 + Math.sqrt(8), 11), 0.01)?.radius).toBeCloseTo(20 + Math.sqrt(8), 9);
    expect(circleBetween(t, plane(11), [...ring(20 + Math.sqrt(8), 11), ...ring(20 - Math.sqrt(8), 11)], 0.01)).toBeUndefined();
    expect(circleBetween(t, plane(11))).toBeUndefined(); // two and no points
    expect(circleBetween(t, plane(11), ring(20 + Math.sqrt(8), 11))).toBeUndefined(); // two and no tolerance
    expect(shape(circlesBetween(t, plane(13)))).toEqual([[13, 20]]); // touching its top
    expect(shape(circlesBetween(t, cylinder(23)))).toEqual([[10, 23]]);
    expect(shape(circlesBetween(t, cylinder(22)))).toEqual([[7.7639, 22], [12.2361, 22]]);
    expect(circleBetween(t, cylinder(22), ring(22, 10 - Math.sqrt(5)), 0.01)?.center[2]).toBeCloseTo(10 - Math.sqrt(5), 9);
    const cone: Surface = { kind: 'cone', apex: [0, 0, -10], axis: Z, halfAngle: Math.PI / 4 };
    expect(shape(circlesBetween(t, cone))).toEqual([[7.8787, 17.8787], [12.1213, 22.1213]]);
    expect(circleBetween(t, cone, ring(20 - Math.sqrt(4.5), 10 - Math.sqrt(4.5)), 0.01)?.radius).toBeCloseTo(20 - Math.sqrt(4.5), 9);
    // a plane through the axis: the two tubes; the points say the side
    const xz: Surface = { kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 0] };
    expect(circlesBetween(t, xz).map((c) => [c.center.map((v) => +v.toFixed(9) + 0), c.radius])).toEqual([[[-20, 0, 10], 3], [[20, 0, 10], 3]]);
    expect(circleBetween(t, xz, [23, 0, 10, 20, 0, 13], 0.01)?.center).toEqual([20, 0, 10]);
    expect(circleBetween(t, xz, [23, 0, 10, -20, 0, 13], 0.01)).toBeUndefined();
    // a sphere and planes, two spheres, a coaxial cylinder
    expect(circlesBetween(sphere([1, 2, 3], 10), { kind: 'plane', origin: [1, 2, 8], normal: [0, 0.6, 0.8] }).map((c) => +c.radius.toFixed(3))).toEqual([9.165]);
    expect(shape(circlesBetween(sphere([0, 0, 0], 10), sphere([0, 0, 12], 5)))).toEqual([[9.125, 4.0908]]);
    expect(shape(circlesBetween(sphere([0, 0, 0], 10), cylinder(6)))).toEqual([[-8, 6], [8, 6]]);
    expect(circleBetween(sphere([0, 0, 0], 10), cylinder(6), ring(6, 8), 0.01)?.center[2]).toBeCloseTo(8, 9);
    expect(circlesBetween(sphere([1, 0, 0], 10), cylinder(6))).toEqual([]); // off its centre
    expect(shape(circlesBetween(sphere([0, 0, 0], 10), { kind: 'plane', origin: [0, 0, 0], normal: [0, 1, 0] }))).toEqual([[0, 10]]); // a cap through the centre
    // a ball touching a plane: a point, no circle
    expect(circlesBetween(sphere([0, 0, 0], 10), plane(10))).toEqual([]);
    expect(circlesBetween(sphere([0, 0, 0], 10), plane(10 - 1e-9))).toEqual([]);
    // one surface: none
    expect(circlesBetween(t, t)).toEqual([]);
    expect(circlesBetween(sphere([0, 0, 0], 3), sphere([0, 0, 0], 3))).toEqual([]);
  });

  it('a fillet that touches its neighbours gives one circle, also a hair apart or a hair across', () => {
    const fillet = torus(17, 27, 3);
    expect(shape(circlesBetween(fillet, plane(20)))).toEqual([[20, 27]]);
    for (const off of [0, 1e-9, -1e-9, 1e-12, -1e-12]) {
      expect(shape(circlesBetween(fillet, cylinder(30 + off))), `${off}`).toEqual([[17, 30]]);
      expect(shape(circlesBetween(fillet, plane(20 + off))), `${off}`).toEqual([[20, 27]]);
    }
  });

  it('spindle tori with a negative major radius: a point across the axis is no circle, never folded back', () => {
    // R −3, r 10 and the plane 5 above the centre: one circle, of radius √75 − 3
    expect(shape(circlesBetween(torus(0, -3, 10), plane(5)))).toEqual([[5, +(Math.sqrt(75) - 3).toFixed(4)]]);
    // a lemon (R −3, r 10) against a cylinder of radius 2: two circles, the points choose
    expect(shape(circlesBetween(torus(0, -3, 10), cylinder(2)))).toEqual([[-Math.sqrt(75).toFixed(4) as unknown as number, 2], [+Math.sqrt(75).toFixed(4), 2]].map(([z, r]) => [+z, r]));
    // the cap of a partial lemon about an axis at x = 60.1 and a tilted one: the side of the points
    // decides, the poles (in float32 a few 1e-6 off the axis) left out
    for (const axis of [[0, 0, 1], [0.6, 0, 0.8]] as Vec3[]) {
      const center: Vec3 = [60.1, 0, 0];
      const lemon: Surface = { kind: 'torus', center, axis, majorRadius: -3, minorRadius: 10 };
      const n: Vec3 = [0, 1, 0]; // the cap holds the axis
      const cap: Surface = { kind: 'plane', origin: center, normal: n };
      const across: Vec3 = [axis[2], 0, -axis[0]]; // in the cap, across the axis
      const f32 = (v: number) => Math.fround(v);
      // points of the cap edge on the side +across: on the arc of the lemon there, centred across the axis
      const points: number[] = [];
      for (let i = 0; i <= 10; i++) {
        const z = -Math.sqrt(91) + (2 * Math.sqrt(91) * i) / 10;
        const rho = Math.sqrt(100 - z * z) - 3;
        points.push(...[0, 1, 2].map((k) => f32(center[k] + axis[k] * z + across[k] * rho)));
      }
      const chosen = circleBetween(lemon, cap, points, 0.01);
      expect(chosen, `axis ${axis}`).toBeDefined();
      // the circle centred at the signed major radius towards the side of the points: across the axis
      const towards = [0, 1, 2].map((k) => center[k] - 3 * across[k]);
      expect(Math.hypot(...[0, 1, 2].map((k) => (chosen as Circle3).center[k] - towards[k]))).toBeLessThan(1e-9);
      // points on both sides: none
      const mirrored = points.map((v, i) => (i % 3 === 1 ? v : 2 * center[i % 3] - v));
      expect(circleBetween(lemon, cap, [...points, ...mirrored.slice(3, 6)], 0.01)).toBeUndefined();
    }
  });

  it('an edge divided again or cut short keeps its circle; circles closer than their reaches give none', () => {
    const t = torus(10, 20, 3);
    const outer = 20 + Math.sqrt(8);
    // the mesh of an edge lies off its circle by up to about the chord tolerance
    const off = ring(outer + 0.004, 11 + 0.003, 40);
    expect(circleBetween(t, plane(11), off, 0.01)?.radius).toBeCloseTo(outer, 9);
    expect(circleBetween(t, plane(11), ring(outer, 11, 3, 0.2, 0.3), 0.01)?.radius).toBeCloseTo(outer, 9); // cut short
    // a tube thinner than the chord tolerance against a plane through it: the two circles are closer
    // than their reaches, the edge is other
    expect(circleBetween(torus(0, 20, 0.004), plane(0.001), ring(20.004, 0.001), 0.01)).toBeUndefined();
    // a plane near the top of a tube: the angle is small, the reach large
    const z = 3 * 0.99999;
    expect(circleBetween(t, plane(10 + z), ring(20 + Math.sqrt(9 - z * z), 10 + z), 0.01)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the setup and the build

// A stub of the kernel: the triangulation of convex loops as a fan (the build needs no more here).
const kernel = {
  triangulate: (loops: Float64Array[]) => {
    const n = loops[0].length / 2;
    return Uint32Array.from(Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]).flat());
  },
} as unknown as SolidKernel;
const XZ_FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] };
// A profile of one polygon of lines (counter-clockwise), resolved as the profile service would.
function polygonProfile(corners: Vec2[]): ResolvedProfile {
  const curves: OutlineCurve[] = corners.map((from, i) => ({ key: `l${i}`, forward: true, type: 'line', from, to: corners[(i + 1) % corners.length], ends: [String(i), String((i + 1) % corners.length)] }));
  const outline: Outline = { regions: [{ outer: curves, holes: [] }] };
  return {
    regions: [],
    frame: XZ_FRAME,
    sideOf: (key) => {
      const i = Number(key.slice(1));
      return { name: { role: 'side', curve: key }, shape: { type: 'line', a: corners[i], b: corners[(i + 1) % corners.length] } };
    },
    outline: () => outline,
  };
}
const Z_LINE = { point: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 };
const AXIS: AxisRef = { kind: 'base', axis: 'Z' };

describe('the setup and the build of a revolve (D58)', () => {
  const square: Vec2[] = [[5, 0], [10, 0], [10, 5], [5, 5]];

  it('in the plane or not; a profile on both sides names a curve on each; the steps and the size', () => {
    const profile = polygonProfile(square);
    const setup = revolveSetup(profile, Z_LINE, AXIS, { type: 'full' }, 0.01);
    if ('code' in setup) throw new Error(setup.detail);
    expect(setup.axis).toEqual({ point: [0, 0], direction: [0, 1], side: -1 });
    expect(setup.steps).toBe(Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.005 / 10)) - 1e-9));
    expect(setup.triangles).toBe(4 * 2 * setup.steps);
    expect(revolveSetup(profile, { point: [0, 0, 0], direction: [0, 1, 0] }, AXIS, { type: 'full' }, 0.01)).toMatchObject({ code: 'invalidAxis', refs: [AXIS], detail: 'the axis is at 90° to the plane of the sketch' });
    expect(revolveSetup(profile, { point: [0, 2, 0], direction: [0, 0, 1] }, AXIS, { type: 'full' }, 0.01)).toMatchObject({ code: 'invalidAxis', detail: 'the axis lies 2 mm off the plane of the sketch' });
    // tilted by less than the angle tolerance: its projection is used
    expect('code' in revolveSetup(profile, { point: [0, 0, 0], direction: [0, 5e-5, 1] }, AXIS, { type: 'full' }, 0.01)).toBe(false);
    // the axis x = 7 runs through the square
    const through = revolveSetup(profile, { point: [7, 0, 0], direction: [0, 0, 1] }, AXIS, { type: 'full' }, 0.01);
    expect(through).toMatchObject({ code: 'invalidAxis', refs: [AXIS, 'l0', 'l0'] });
    // a partial turn: the caps add their triangles
    const part = revolveSetup(profile, Z_LINE, AXIS, { type: 'angle', start: 0, angle: 1 }, 0.01);
    if ('code' in part) throw new Error(part.detail);
    expect(part.triangles).toBe(4 * 2 * part.steps + 2 * 2);
    // the limit
    // 200 lines far from the axis, each turned in 4096 steps
    const gon = Array.from({ length: 200 }, (_, i): Vec2 => [1e5 + Math.cos((2 * Math.PI * i) / 200), Math.sin((2 * Math.PI * i) / 200)]);
    const huge = revolveSetup(polygonProfile(gon), Z_LINE, AXIS, { type: 'full' }, 1e-6);
    expect(huge).toMatchObject({ code: 'invalidProfile' });
    expect(MAX_REVOLVE_TRIANGLES).toBe(1_000_000);
  });

  it('the build: closed, outwards, a line on the axis without a face, one vertex at a pole; the surfaces of each kind of line', () => {
    // a trapezium with a side on the axis: across, slanted, parallel, on the axis
    const corners: Vec2[] = [[0, 0], [10, 0], [6, 8], [6, 12], [0, 12]];
    const profile = polygonProfile(corners);
    for (const extent of [{ type: 'full' }, { type: 'angle', start: 0.5, angle: -2 }] as const) {
      const setup = revolveSetup(profile, Z_LINE, AXIS, extent, 0.01);
      if ('code' in setup) throw new Error(setup.detail);
      const tool = buildRevolve('R', setup, extent, XZ_FRAME, profile.sideOf, 0, kernel);
      const names = tool.faces.map((face) => ('curve' in face.name ? face.name.curve : face.name.role));
      expect(names).toEqual(extent.type === 'full' ? ['l0', 'l1', 'l2', 'l3'] : ['startCap', 'endCap', 'l0', 'l1', 'l2', 'l3']);
      expect(tool.solid.triangles.length / 3).toBe(setup.triangles);
      expect(volumeOf(tool.solid)).toBeGreaterThan(0);
      const info = Object.fromEntries(tool.faces.map((face) => [('curve' in face.name ? face.name.curve : face.name.role) as string, face.info]));
      expect(info.l0).toMatchObject({ planar: true, normal: [0, 0, 1] });
      // the slanted line meets the axis at z = 20, above the face: the axis of the cone points down
      expect(info.l1).toMatchObject({ planar: false, surface: 'cone', axis: [0, 0, -1], apex: [0, 0, 20] });
      expect(info.l2).toMatchObject({ planar: false, surface: 'cylinder', radius: 6 });
      expect(info.l3).toMatchObject({ planar: true, normal: [0, 0, 1], origin: [6 * Math.cos(extent.type === 'full' ? 0 : 0.5), 6 * Math.sin(extent.type === 'full' ? 0 : 0.5), 12].map((v) => expect.closeTo(v, 12)) });
      // one vertex for each of the two poles
      const { positions } = tool.solid;
      let poles = 0;
      for (let i = 0; i < positions.length; i += 3) if (Math.hypot(positions[i], positions[i + 1]) < 1e-9) poles++;
      expect(poles).toBe(2);
    }
  });
});
