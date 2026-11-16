// D45 (package 2b of D36) without adapters: the optional field `extent/taper` in the document, its
// upgrade step, the circle two surfaces meet in, and the rings of a tapered outline with the rule of
// the levels (the mesh sampled densely against its exact cones).
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Input, PlaneRef, Surface, Vec2, Vec3 } from '../src/types';
import { applyCommand, emptyDocument, emptySketch, featureInput, fieldsOf, validateDocument } from '../src/document';
import { type Move, MAX_INTERVALS, taperRings } from '../src/recompute/outline';
import type { Outline } from '../src/recompute/state';
import { tapers } from '../src/recompute/taper';
import { UPGRADES, upgradeDocument } from '../src/schema';
import type { OutlineCurve } from '../src/sketch';
import { circleBetween } from '../src/surfaces';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const REGIONS: Input<ExtrudeFeature>['profile'] = { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] };
const DISTANCE = { type: 'distance', start: 0, distance: 10 } as const;
const extrude = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({ id, name: id, suppressed: false, type: 'extrude', profile: REGIONS, extent: DISTANCE, operation: 'new', ...extra });
const add = (feature: Input<ExtrudeFeature>): Command => ({ type: 'addFeature', feature });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const feature = (doc: Document, id: string): ExtrudeFeature => doc.features.find((f) => f.id === id) as ExtrudeFeature;
const GEAR = { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'c' }, params: { teeth: 18 } } as Input<ExtrudeFeature>['profile'];

// A sketch with a circle `c`, the parameter `a` (degrees) and the body A.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'a', expr: '5' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    add(extrude('A')),
  );
}

describe('the field extent/taper', () => {
  it('is optional: absent it is not stored, given it is kept, also a zero; it takes an expression', () => {
    const doc = run(base(), add(extrude('B', { extent: { ...DISTANCE, taper: 'deg(-a)' } })), add(extrude('Z', { extent: { ...DISTANCE, taper: 0 } })));
    expect(feature(doc, 'A').extent).toEqual(DISTANCE);
    expect('taper' in feature(doc, 'A').extent).toBe(false);
    expect(feature(doc, 'B').extent).toEqual({ ...DISTANCE, taper: expect.closeTo((-5 * Math.PI) / 180, 15) });
    expect(feature(doc, 'B').expressions).toEqual({ 'extent/taper': 'deg(-a)' });
    expect(featureInput(feature(doc, 'B')).extent).toEqual({ ...DISTANCE, taper: 'deg(-a)' });
    expect(feature(doc, 'Z').extent).toEqual({ ...DISTANCE, taper: 0 });
    // listed as a field only while the feature has it
    expect(fieldsOf(feature(doc, 'A')).map((field) => field.path)).toEqual(['extent/start', 'extent/distance']);
    expect(fieldsOf(feature(doc, 'B')).map((field) => field.path)).toEqual(['extent/start', 'extent/distance', 'extent/taper']);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('lies strictly between −π/2 and π/2; whether the far profile exists is for the recompute', () => {
    const doc = base();
    expect(feature(run(doc, add(extrude('B', { extent: { ...DISTANCE, taper: 'deg(89)' } }))), 'B').extent).toMatchObject({ taper: expect.closeTo((89 * Math.PI) / 180, 12) });
    invalid(doc, add(extrude('B', { extent: { ...DISTANCE, taper: Math.PI / 2 } })), /extent\.taper/);
    invalid(doc, add(extrude('B', { extent: { ...DISTANCE, taper: 'deg(-90)' } })), /extent\.taper/);
  });

  it('setField adds it and changes it; a patch with null removes it, also from a feature without it', () => {
    const doc = base();
    const set = run(doc, { type: 'setField', feature: 'A', path: 'extent/taper', value: 'deg(a)' });
    expect(feature(set, 'A').extent).toMatchObject({ taper: expect.closeTo((5 * Math.PI) / 180, 15) });
    expect(feature(set, 'A').expressions).toEqual({ 'extent/taper': 'deg(a)' });
    const changed = run(set, update('A', { extent: { taper: 0.1 } }));
    expect(feature(changed, 'A').extent).toEqual({ ...DISTANCE, taper: 0.1 });
    expect(feature(changed, 'A').expressions).toBeUndefined();
    for (const from of [set, changed, doc]) {
      const removed = run(from, update('A', { extent: { taper: null } }));
      expect(feature(removed, 'A').extent).toEqual(DISTANCE);
      expect(feature(removed, 'A').expressions).toBeUndefined();
    }
    // the start and the distance stay required
    invalid(doc, update('A', { extent: { distance: null } } as never), /extent\.distance/);
  });

  it('is an invalid command on a generated profile and on an extent through all', () => {
    const doc = base();
    invalid(doc, add(extrude('G', { profile: GEAR, extent: { ...DISTANCE, taper: 0.1 } })), /extent\.taper: a generated profile has no curves to move/);
    const gear = run(doc, add(extrude('G', { profile: GEAR })));
    invalid(gear, { type: 'setField', feature: 'G', path: 'extent/taper', value: 0.1 }, /a generated profile has no curves to move/);
    invalid(gear, update('G', { extent: { taper: 0.1 } }), /a generated profile/);
    // a gear may be given an extent with a taper of nothing: the key absent
    expect(feature(run(gear, update('G', { extent: { taper: null } })), 'G').extent).toEqual(DISTANCE);
    // through all: the key is refused, not dropped, and setField does not reach it
    const cut = run(doc, add(extrude('H', { extent: { type: 'distance', start: 0, distance: -3, taper: -0.2 }, operation: 'cut', targets: ['A'] })));
    invalid(doc, add(extrude('T', { extent: { type: 'throughAll', side: 'backward', taper: 0.1 } as never, operation: 'cut', targets: ['A'] })), /extent\.taper: only the extent distance has a taper/);
    invalid(cut, update('H', { extent: { type: 'throughAll', side: 'backward', taper: 0.1 } as never }), /only the extent distance has a taper/);
    // another variant replaces the extent, the taper with it
    const through = run(cut, update('H', { extent: { type: 'throughAll', side: 'backward' } }));
    expect(feature(through, 'H').extent).toEqual({ type: 'throughAll', side: 'backward' });
    invalid(through, { type: 'setField', feature: 'H', path: 'extent/taper', value: 0.1 }, /is not a numeric field/);
    // `null` for the taper asks for an extent without one: accepted whether the feature had one or not
    expect(feature(run(through, update('H', { extent: { taper: null } as never })), 'H').extent).toEqual({ type: 'throughAll', side: 'backward' });
    const plain = run(doc, add(extrude('K', { extent: { type: 'distance', start: 0, distance: -3 }, operation: 'cut', targets: ['A'] })));
    for (const from of [plain, cut]) {
      const id = from === plain ? 'K' : 'H';
      expect(feature(run(from, update(id, { extent: { type: 'throughAll', side: 'both', taper: null } as never })), id).extent).toEqual({ type: 'throughAll', side: 'both' });
    }
  });
});

describe('the upgrade step 2b-taper', () => {
  it('is in the list; a document with a taper loads to itself and a build without the step refuses it', () => {
    expect(UPGRADES.map((step) => step.name)).toContain('2b-taper');
    const doc = run(base(), { type: 'setField', feature: 'A', path: 'extent/taper', value: 'deg(-a)' });
    const saved = JSON.parse(JSON.stringify(doc));
    expect(validateDocument(saved)).toEqual(doc);
    // A build without the step, nothing pending: master before the merge refuses the version (the
    // step is counted in it), a build of a branch that kept the step pending refuses its name.
    const before = UPGRADES.filter((step) => step.name !== '2b-taper');
    expect(() => upgradeDocument(saved, before, 0)).toThrow(/is newer than this build reads|"2b-taper"/);
  });
});

// ---------------------------------------------------------------- circles between surfaces

describe('circleBetween', () => {
  const plane = (z: number, normal: Vec3 = [0, 0, 1]): Surface => ({ kind: 'plane', origin: [7, -3, z], normal });
  const cone = (apex: Vec3, axis: Vec3, halfAngle: number): Surface => ({ kind: 'cone', apex, axis, halfAngle });
  const cylinder = (origin: Vec3, radius: number): Surface => ({ kind: 'cylinder', origin, axis: [0, 0, -1], radius });
  const close = (circle: ReturnType<typeof circleBetween>, center: Vec3, radius: number) => {
    expect(circle).toBeDefined();
    circle?.center.forEach((value, i) => expect(value).toBeCloseTo(center[i], 12));
    expect(circle?.radius).toBeCloseTo(radius, 12);
  };
  it('a plane across the axis of a cylinder or of a cone', () => {
    close(circleBetween(plane(5), cylinder([1, 2, 0], 3)), [1, 2, 5], 3);
    const up = cone([1, 2, 0], [0, 0, 1], Math.PI / 6);
    close(circleBetween(plane(2), up), [1, 2, 2], 2 * Math.tan(Math.PI / 6));
    close(circleBetween(up, plane(2, [0, 0, -1])), [1, 2, 2], 2 * Math.tan(Math.PI / 6));
    // the other half of the cone, the apex, a plane that is not across the axis
    expect(circleBetween(plane(-2), up)).toBeUndefined();
    expect(circleBetween(plane(0), up)).toBeUndefined();
    expect(circleBetween(plane(2, [0, 1, 1]), up)).toBeUndefined();
  });
  it('a cylinder and a cone about one axis, two cones about one axis', () => {
    close(circleBetween(cylinder([0, 0, 9], 1), cone([0, 0, 0], [0, 0, 1], Math.PI / 4)), [0, 0, 1], 1);
    close(circleBetween(cone([0, 0, 0], [0, 0, 1], Math.PI / 4), cylinder([0, 0, -5], 2)), [0, 0, 2], 2);
    expect(circleBetween(cylinder([0.5, 0, 0], 1), cone([0, 0, 0], [0, 0, 1], Math.PI / 4))).toBeUndefined();
    // a cone opening up and one opening down meet half way
    close(circleBetween(cone([0, 0, 0], [0, 0, 1], Math.PI / 4), cone([0, 0, 4], [0, 0, -1], Math.PI / 4)), [0, 0, 2], 2);
    // a steeper cone inside a flatter one from the same side: radii 2t·tan(60°)… meet where they are equal
    const flat = cone([0, 0, 0], [0, 0, 1], Math.PI / 3);
    const steep = cone([0, 0, -2], [0, 0, 1], Math.PI / 6);
    const t = (2 * Math.tan(Math.PI / 6)) / (Math.tan(Math.PI / 3) - Math.tan(Math.PI / 6));
    close(circleBetween(flat, steep), [0, 0, t], t * Math.tan(Math.PI / 3));
  });
  it('nothing for what is not a circle', () => {
    const up = cone([0, 0, 0], [0, 0, 1], Math.PI / 4);
    expect(circleBetween(up, up)).toBeUndefined(); // one surface
    expect(circleBetween(up, cone([0, 0, 1], [0, 0, 1], Math.PI / 4))).toBeUndefined(); // parallel, never meet
    expect(circleBetween(up, cone([0, 0, 0], [0, 0, -1], Math.PI / 4))).toBeUndefined(); // the two halves meet at the apex
    expect(circleBetween(up, cone([0, 0, 4], [0, 0, 1], Math.PI / 6))).toBeUndefined(); // they meet on the other half
    expect(circleBetween(cylinder([0, 0, 0], 1), cylinder([0, 0, 5], 2))).toBeUndefined(); // two cylinders stay other
    expect(circleBetween(plane(1), plane(2, [1, 0, 0]))).toBeUndefined();
    expect(circleBetween(plane(1), { kind: 'swept', axis: [0, 0, 1] })).toBeUndefined();
    expect(circleBetween(up, cone([3, 0, 0], [0, 0, 1], Math.PI / 6))).toBeUndefined(); // another axis
  });
});

// ---------------------------------------------------------------- the rings of a tapered outline

const MOVE: Move = { subject: 'The taper', cure: 'Do something else.' };
const line = (key: string, from: Vec2, to: Vec2): OutlineCurve => ({ key, forward: true, type: 'line', from, to, ends: ['', ''] });
const arc = (key: string, center: Vec2, radius: number, start: number, sweep: number): OutlineCurve => ({
  key,
  forward: true,
  type: 'arc',
  center,
  radius,
  start,
  sweep,
  from: [center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)],
  to: [center[0] + radius * Math.cos(start + sweep), center[1] + radius * Math.sin(start + sweep)],
  ends: ['', ''],
});
const numbered = (loop: OutlineCurve[]): OutlineCurve[] => loop.map((curve, i) => (curve.type === 'circle' ? curve : { ...curve, ends: [String(i), String((i + 1) % loop.length)] as [string, string] }));
const single = (outer: OutlineCurve[], holes: OutlineCurve[][] = []): Outline => ({ regions: [{ outer: numbered(outer), holes: holes.map(numbered) }] });
const TOLERANCE = 0.01;

// The rings of an outline tapered over `distance`, and the largest distance from its exact cone of
// any point of a side triangle of an arc, sampled on a grid of `grid` steps a side.
function sampled(outline: Outline, distance: number, taper: number, tolerance = TOLERANCE, grid = 40): { intervals: number; worst: number } {
  const rings = taperRings(outline, distance * Math.tan(taper), taper, tolerance, () => MOVE);
  if ('code' in rings) throw new Error(rings.message);
  const loopsOf = (o: Outline) => o.regions.flatMap((region) => [region.outer, ...region.holes]);
  let worst = 0;
  for (let j = 0; j + 1 < rings.length; j++) {
    const [lower, upper] = [rings[j], rings[j + 1]];
    const [lowerLoops, upperLoops] = [lower.regions.flatMap((r) => [r.outer, ...r.holes]), upper.regions.flatMap((r) => [r.outer, ...r.holes])];
    lowerLoops.forEach((loop, l) => {
      const count = loop.xy.length / 2;
      for (let k = 0; k < count; k++) {
        const key = loop.curves[k];
        const curves = loopsOf(rings[0].outline)[l];
        const near = curves.find((curve) => curve.key === key) as OutlineCurve;
        if (near.type === 'line') continue;
        const far = loopsOf(rings[rings.length - 1].outline)[l].find((curve) => curve.key === key) as Extract<OutlineCurve, { type: 'arc' | 'circle' }>;
        const radiusAt = (t: number) => near.radius + t * (far.radius - near.radius);
        const point = (xy: number[], i: number, t: number): [number, number, number] => [xy[2 * i], xy[2 * i + 1], t];
        const k1 = (k + 1) % count;
        const [p, p1, q, q1] = [point(loop.xy, k, lower.t), point(loop.xy, k1, lower.t), point(upperLoops[l].xy, k, upper.t), point(upperLoops[l].xy, k1, upper.t)];
        for (const [a, b, c] of [[p, p1, q1], [p, q1, q]]) {
          for (let u = 0; u <= grid; u++) {
            for (let v = 0; u + v <= grid; v++) {
              const w = grid - u - v;
              const at = [0, 1, 2].map((i) => (u * a[i] + v * b[i] + w * c[i]) / grid);
              const r = Math.hypot(at[0] - near.center[0], at[1] - near.center[1]);
              worst = Math.max(worst, Math.abs(r - radiusAt(at[2])) * Math.cos(taper));
            }
          }
        }
      }
    });
  }
  return { intervals: rings.length - 1, worst };
}

describe('the rings of a tapered outline', () => {
  it('an outline of lines, circles and tangent arcs has two rings, with one count per curve', () => {
    // a slot: two lines and two half circles, tangent at every corner, and a circle as a hole
    const slot = single([line('a', [0, -5], [20, -5]), arc('r', [20, 0], 5, -Math.PI / 2, Math.PI), line('b', [20, 5], [0, 5]), arc('l', [0, 0], 5, Math.PI / 2, Math.PI)], [[{ key: 'h', forward: true, type: 'circle', center: [10, 0], radius: 2, ccw: false }]]);
    const rings = taperRings(slot, 3 * Math.tan(-0.3), -0.3, TOLERANCE, () => MOVE);
    if ('code' in rings) throw new Error(rings.message);
    expect(rings.map((ring) => ring.t)).toEqual([0, 1]);
    // the larger near radius sets the count of the arcs: the same number of points in both rings
    expect(rings[0].regions[0].outer.xy.length).toBe(rings[1].regions[0].outer.xy.length);
    expect(rings[0].regions[0].holes[0].xy.length).toBe(rings[1].regions[0].holes[0].xy.length);
    expect(sampled(slot, 3, -0.3).worst).toBeLessThanOrEqual(TOLERANCE);
  });

  it('a half disc under 45° is divided into levels and stays within the tolerance of its cone', () => {
    const half = single([line('d', [-10, 0], [10, 0]), arc('a', [0, 0], 10, 0, Math.PI)]);
    const { intervals, worst } = sampled(half, 4, -Math.PI / 4);
    expect(intervals).toBeGreaterThan(1);
    expect(intervals).toBeLessThan(MAX_INTERVALS);
    expect(worst).toBeLessThanOrEqual(TOLERANCE);
  });

  it('the clipped disc of the review (radius 2.26 at x = −1.995, far offset −1.598) stays within the tolerance', () => {
    const y = Math.sqrt(2.26 ** 2 - 1.995 ** 2);
    const start = Math.atan2(-y, -1.995);
    const clipped = single([arc('a', [0, 0], 2.26, start, -2 * start), line('d', [-1.995, y], [-1.995, -y])]);
    const { intervals, worst } = sampled(clipped, 1.598, -Math.PI / 4);
    expect(intervals).toBeGreaterThan(1);
    expect(intervals).toBeLessThan(MAX_INTERVALS);
    expect(worst).toBeLessThanOrEqual(TOLERANCE);
  });

  it('a lens of two arcs and a D shaped hole stay within the tolerance', () => {
    const start = Math.atan2(-4, 3);
    const lens = single([arc('p', [-3, 0], 5, start, -2 * start), arc('q', [3, 0], 5, Math.PI + start, -2 * start)]);
    const tilted = sampled(lens, 3, -0.35);
    expect(tilted.intervals).toBeGreaterThan(1);
    expect(tilted.worst).toBeLessThanOrEqual(TOLERANCE);
    // a square with a half disc as a hole, run clockwise; a positive taper shrinks the hole
    const square = [line('s1', [-20, -20], [20, -20]), line('s2', [20, -20], [20, 20]), line('s3', [20, 20], [-20, 20]), line('s4', [-20, 20], [-20, -20])];
    const holed = single(square, [[arc('a', [0, 0], 8, Math.PI, -Math.PI), line('d', [8, 0], [-8, 0])]]);
    const shrinking = sampled(holed, 3, 0.4);
    expect(shrinking.intervals).toBeGreaterThan(1);
    expect(shrinking.worst).toBeLessThanOrEqual(TOLERANCE);
  });

  it('at the cap of the intervals the rings are built as they are', () => {
    // a half disc of radius 10 whose far end nearly collapses under a steep taper (the line and the
    // arc meet ever more steeply)
    const half = single([line('d', [-10, 0], [10, 0]), arc('a', [0, 0], 10, 0, Math.PI)]);
    // the far end moved in by 4.9 of its inradius 5
    const rings = taperRings(half, -4.9, -1.2, TOLERANCE, () => MOVE);
    if ('code' in rings) throw new Error(rings.message);
    expect(rings.length - 1).toBe(MAX_INTERVALS);
  });

  it('a taper is built only when the far end moves by more than the length tolerance', () => {
    expect(tapers({ type: 'distance', start: 0, distance: 10, taper: 1e-15 })).toBe(false);
    expect(tapers({ type: 'distance', start: 0, distance: 10, taper: 0 })).toBe(false);
    expect(tapers({ type: 'distance', start: 0, distance: 10 })).toBe(false);
    expect(tapers({ type: 'throughAll', side: 'both' })).toBe(false);
    expect(tapers({ type: 'distance', start: 0, distance: -10, taper: 1e-6 })).toBe(true);
    expect(tapers({ type: 'distance', start: 0, distance: 10, taper: -0.1 })).toBe(true);
  });

  it('a ring that cannot be built is refused with the text of the level', () => {
    const disc = single([{ key: 'c', forward: true, type: 'circle', center: [0, 0], radius: 3, ccw: true }]);
    const refused = taperRings(disc, -4, -0.5, TOLERANCE, (t) => ({ subject: `At ${t}`, cure: 'Cure.' }));
    expect(refused).toMatchObject({ code: 'invalidProfile', refs: ['c'] });
    expect('code' in refused && refused.message).toMatch(/^At 1 leaves no radius for the circle "c"/);
  });
});
