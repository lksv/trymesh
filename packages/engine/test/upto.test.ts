// D47 (package 2f of D36) without adapters: the extent `upTo` in the document (its fields, its
// reference, its refusals) and the lengths to a plane (`upToSpan`).
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Frame, Input, PlaneRef } from '../src/types';
import { applyCommand, emptyDocument, emptySketch, featureInput, fieldsOf, validateDocument } from '../src/document';
import { type EndPlane, upToSpan } from '../src/recompute/extent';
import type { Region } from '../src/sketch';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const REGIONS: Input<ExtrudeFeature>['profile'] = { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] };
const TOP: PlaneRef = { kind: 'face', body: 'A', face: { feature: 'A', role: 'endCap' } };
const extrude = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({ id, name: id, suppressed: false, type: 'extrude', profile: REGIONS, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new', ...extra });
const add = (feature: Input<ExtrudeFeature>, index?: number): Command => ({ type: 'addFeature', feature, ...(index === undefined ? {} : { index }) });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const feature = (doc: Document, id: string): ExtrudeFeature => doc.features.find((f) => f.id === id) as ExtrudeFeature;

// A sketch with a circle `c`, the parameter `g`, the body A and a plane feature P.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'g', expr: '0.5' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    add(extrude('A')),
    { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: XY, offset: 30 } },
  );
}

describe('the extent upTo in the document', () => {
  it('takes a plane reference of each kind, a start and an optional gap; it lists its own fields', () => {
    const doc = run(
      base(),
      add(extrude('U', { extent: { type: 'upTo', plane: TOP, start: 0 }, operation: 'add', targets: ['A'] })),
      add(extrude('V', { extent: { type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: '-g', gap: 'g' } })),
      add(extrude('W', { extent: { type: 'upTo', plane: XY, start: 5, gap: 0 } })),
    );
    expect(feature(doc, 'U').extent).toEqual({ type: 'upTo', plane: TOP, start: 0 });
    expect(feature(doc, 'V').extent).toEqual({ type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: -0.5, gap: 0.5 });
    expect(feature(doc, 'V').expressions).toEqual({ 'extent/start': '-g', 'extent/gap': 'g' });
    expect(featureInput(feature(doc, 'V')).extent).toEqual({ type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: '-g', gap: 'g' });
    expect(feature(doc, 'W').extent).toEqual({ type: 'upTo', plane: XY, start: 5, gap: 0 });
    expect(fieldsOf(feature(doc, 'U')).map((field) => field.path)).toEqual(['extent/start']);
    expect(fieldsOf(feature(doc, 'V')).map((field) => field.path)).toEqual(['extent/start', 'extent/gap']);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // a key the variant does not have is refused, not dropped
    invalid(base(), add(extrude('X', { extent: { type: 'upTo', plane: XY, start: 0, side: 'forward' } as never })), /extent\.side: the extent upTo has no such field/);
    invalid(base(), add(extrude('X', { extent: { type: 'upTo', plane: XY, start: 0, taper: 0.1 } as never })), /extent\.taper: only the extent distance has a taper/);
    invalid(base(), add(extrude('X', { extent: { type: 'upTo', plane: XY } as never })), /extent\.start/);
    invalid(base(), add(extrude('X', { extent: { type: 'upTo', plane: 'A', start: 0 } as never })), /extent\.plane/);
  });

  it('the plane is a reference: it has to exist before the feature, and it keeps the order of the timeline', () => {
    const doc = base();
    invalid(doc, add(extrude('U', { extent: { type: 'upTo', plane: { kind: 'plane', feature: 'nope' }, start: 0 } })), /extent\.plane/);
    invalid(doc, add(extrude('U', { extent: { type: 'upTo', plane: { kind: 'face', body: 'A', face: { feature: 'later', role: 'endCap' } }, start: 0 } })), /extent\.plane/);
    // before the plane feature it refers to: refused
    invalid(doc, add(extrude('U', { extent: { type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: 0 } }), 2), /extent\.plane/);
    const with_ = run(doc, add(extrude('U', { extent: { type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: 0 } })));
    invalid(with_, { type: 'moveFeature', id: 'U', index: 2 }, /P/);
    invalid(with_, { type: 'moveFeature', id: 'P', index: 3 }, /P|U/);
  });

  it('a patch replaces the plane, sets and removes the gap, and changes the variant', () => {
    const doc = run(base(), add(extrude('U', { extent: { type: 'upTo', plane: TOP, start: 0 }, operation: 'add', targets: ['A'] })));
    const other = run(doc, update('U', { extent: { plane: { kind: 'plane', feature: 'P' } } }));
    expect(feature(other, 'U').extent).toEqual({ type: 'upTo', plane: { kind: 'plane', feature: 'P' }, start: 0 });
    const gapped = run(doc, { type: 'setField', feature: 'U', path: 'extent/gap', value: 'g' });
    expect(feature(gapped, 'U').extent).toEqual({ type: 'upTo', plane: TOP, start: 0, gap: 0.5 });
    for (const from of [gapped, doc]) expect(feature(run(from, update('U', { extent: { gap: null } })), 'U').extent).toEqual({ type: 'upTo', plane: TOP, start: 0 });
    // to a distance and back: another variant has to be complete
    const distance = run(gapped, update('U', { extent: { type: 'distance', start: 0, distance: 3 } }));
    expect(feature(distance, 'U').extent).toEqual({ type: 'distance', start: 0, distance: 3 });
    expect(feature(distance, 'U').expressions).toBeUndefined();
    invalid(distance, update('U', { extent: { type: 'upTo', start: 0 } as never }), /extent\.plane/);
    expect(feature(run(distance, update('U', { extent: { type: 'upTo', plane: XY, start: 1 } })), 'U').extent).toEqual({ type: 'upTo', plane: XY, start: 1 });
    // the gap is not a field of a distance extent
    invalid(distance, { type: 'setField', feature: 'U', path: 'extent/gap', value: 1 }, /is not a numeric field/);
  });
});

// ---------------------------------------------------------------- the lengths

const FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
// A square 10 × 10 with its corner at (x, 0), as the polylines of a region.
const square = (x = 0, size = 10): Region[] => [
  { ref: { outerLoop: ['q'] }, outer: { xy: [x, 0, x + size, 0, x + size, size, x, size], keys: ['a', 'b', 'c', 'd'], curves: ['q', 'q', 'q', 'q'] }, holes: [] },
];
const plane = (point: [number, number, number], normal: [number, number, number]): EndPlane => {
  const length = Math.hypot(...normal);
  return { point, normal: [normal[0] / length, normal[1] / length, normal[2] / length] };
};
const upTo = (start = 0, gap?: number) => ({ type: 'upTo' as const, plane: XY, start, ...(gap === undefined ? {} : { gap }) });

describe('upToSpan', () => {
  it('a parallel plane gives one length, the prism of a distance extent; a plane on the other side runs back', () => {
    const above = upToSpan(upTo(), plane([3, 4, 20], [0, 0, -1]), FRAME, square());
    expect(above).toEqual({ span: [0, 20], lengthMin: 20, lengthMax: 20, forward: true });
    const below = upToSpan(upTo(2), plane([0, 0, -5], [0, 0, 1]), FRAME, square());
    expect(below).toEqual({ span: [2, -5], lengthMin: 7, lengthMax: 7, forward: false });
  });

  it('a tilted plane gives a length per point and a tilted end cap; the gap is measured across the plane', () => {
    // z = 20 + x / 10: from 20 at x = 0 to 21 at x = 10
    const tilted = plane([0, 0, 20], [-0.1, 0, 1]);
    const span = upToSpan(upTo(), tilted, FRAME, square());
    if ('detail' in span || Array.isArray(span.span)) throw new Error('a tilted span was expected');
    expect(span.lengthMin).toBeCloseTo(20, 12);
    expect(span.lengthMax).toBeCloseTo(21, 12);
    expect(span.forward).toBe(true);
    expect(span.span.end(5, 3)).toBeCloseTo(20.5, 12);
    expect(span.span.cap.normal.map((v) => v * Math.hypot(0.1, 1))).toEqual([expect.closeTo(-0.1, 12), 0, expect.closeTo(1, 12)]);
    expect(span.span.cap.origin).toEqual([0, 0, expect.closeTo(20, 12)]);
    // a gap of 1 moves the plane by 1 across itself: the tool is shorter by 1 / cos of the tilt
    const gapped = upToSpan(upTo(0, 1), tilted, FRAME, square());
    if ('detail' in gapped) throw new Error(gapped.detail);
    expect(gapped.lengthMin).toBeCloseTo(20 - Math.hypot(0.1, 1), 12);
    // a negative gap passes the plane
    const past = upToSpan(upTo(0, -2), tilted, FRAME, square());
    if ('detail' in past) throw new Error(past.detail);
    expect(past.lengthMax).toBeCloseTo(21 + 2 * Math.hypot(0.1, 1), 12);
  });

  it('refuses a plane too near to parallel, one through the start, and a gap that reaches the start', () => {
    const sideways = (angle: number) => plane([0, 0, 5], [Math.cos(angle), 0, Math.sin(angle)]);
    expect(upToSpan(upTo(), sideways(0.005), FRAME, square(-300))).toEqual({ detail: 'the plane is parallel to the direction of the extrusion, or within 0.01 rad of it' });
    // 0.02 rad off: built; every length within a hundred times the distance of the start from the plane
    const near = upToSpan(upTo(), sideways(0.02), FRAME, square(-300));
    expect('span' in near).toBe(true);
    // through the start, and touching it at one corner
    expect(upToSpan(upTo(), plane([5, 0, 0], [-1, 0, 1]), FRAME, square())).toEqual({ detail: 'the plane passes through the start of the extrusion or touches it' });
    expect(upToSpan(upTo(), plane([0, 0, 0], [-1, 0, 1]), FRAME, square())).toEqual({ detail: 'the plane passes through the start of the extrusion or touches it' });
    expect(upToSpan(upTo(3), plane([0, 0, 3], [0, 0, 1]), FRAME, square())).toEqual({ detail: 'the plane passes through the start of the extrusion or touches it' });
    // a gap of 20 before a plane 10 away does not turn the tool round
    expect(upToSpan(upTo(0, 20), plane([0, 0, 10], [0, 0, 1]), FRAME, square())).toEqual({ detail: 'the gap of 20 mm is as large as the way to the plane' });
    expect(upToSpan(upTo(0, 10), plane([0, 0, 10], [0, 0, -1]), FRAME, square())).toEqual({ detail: 'the gap of 10 mm is as large as the way to the plane' });
    expect('span' in upToSpan(upTo(0, 9.99), plane([0, 0, 10], [0, 0, 1]), FRAME, square())).toBe(true);
  });

  it('a profile far from the origin of its sketch under a plane tilted by less than the angle tolerance: a length per point, on the right side', () => {
    // the plane z = −1 + 0.00005 x of the reviews: under the profile at x = 40 000 the lengths are 1 to 1.00005; at the origin −1
    const span = upToSpan(upTo(), plane([0, 0, -1], [-0.00005, 0, 1]), FRAME, square(40000, 1));
    if ('detail' in span) throw new Error(span.detail);
    expect(span.forward).toBe(true);
    expect(span.lengthMin).toBeCloseTo(1, 6);
    expect(span.lengthMax).toBeCloseTo(1.00005, 6);
    expect(Array.isArray(span.span)).toBe(false);
  });
});
