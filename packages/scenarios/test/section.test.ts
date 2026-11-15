// The query `section` (D38) against the real adapters: the regions and the spans of a small
// model, a plane given by a face, what a body that ends in the plane shows, the budget of the
// answer, and the errors.
import { type Engine, type PlaneRef, type QueryArgs, type SectionLoop, type SectionResult, type SectionSpan, completeRegions, takenAt } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, cap, circle, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

function section(engine: Engine, args: QueryArgs<'section'>, at?: string): SectionResult {
  const answer = engine.query('section', args, at === undefined ? {} : { at });
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const spansOf = (loop: SectionLoop): SectionSpan[] => loop.spans ?? [];
const kinds = (loop: SectionLoop): string => spansOf(loop).map((span) => span.kind).join(' ');
const near = (point: number[], digits = 4) => point.map((value) => expect.closeTo(value, digits));
// the area of a regular polygon of `sides` corners inscribed in a circle
const polygon = (sides: number, radius: number): number => (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);

// A plate 40 × 30 × 10 with a hole of radius 4 at (10, 10) and a pin of radius 3, 5 high, at
// (30, 20) on its top; and a bar 10 × 30 × 10 beside it, 10 away along X.
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'h', 10, 10, 4),
    rectangle('S1', 'q', 50, 0, 10, 30, null),
    addExtrude('E1', 'S1', [rectLoop('r')], 10),
    addExtrude('BAR', 'S1', [rectLoop('q')], 10),
    addSketch('S2', onFace('E1', cap('E1'))),
    circle('S2', 'k', 30, 20, 3),
    addExtrude('PIN', 'S2', [['k']], 5, 'add', 'E1'),
  );
  return engine;
}
const TOP = onFace('E1', cap('E1'));

describe('the query section', () => {
  const engine = model();

  it('across the plate: a region with its hole, lines on planar faces and a whole circle read from the cylinder', () => {
    const result = section(engine, { plane: XY, offset: 5 });
    expect(result.frame).toEqual({ origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] });
    expect(result.below).toBeCloseTo(60e-6, 12); // the bar reaches 60 mm from the origin
    expect(result.truncated).toBeUndefined();
    expect(result.inPlane).toEqual([]);
    expect(result.bodies.map((body) => [body.body, body.loops, body.regions?.length])).toEqual([['E1', 2, 1], ['BAR', 1, 1]]);
    const [plate, bar] = result.bodies;
    const region = plate.regions?.[0];
    if (!region) throw new Error('the plate is cut in one region');
    // the outer loop: four lines, each on its side face, from the corner first in the order of (u, v)
    expect(spansOf(region.outer)).toEqual([
      { kind: 'line', face: side('E1', 'ra'), from: near([0, 0]), to: near([40, 0]) },
      { kind: 'line', face: side('E1', 'rb'), from: near([40, 0]), to: near([40, 30]) },
      { kind: 'line', face: side('E1', 'rc'), from: near([40, 30]), to: near([0, 30]) },
      { kind: 'line', face: side('E1', 'rd'), from: near([0, 30]), to: near([0, 0]) },
    ]);
    expect(region.outer).toMatchObject({ area: expect.closeTo(1200, 3), length: expect.closeTo(140, 3) });
    // the hole: one span, the whole circle of the exact cylinder, run clockwise
    expect(region.holes).toHaveLength(1);
    const [circleOf] = spansOf(region.holes[0]);
    expect(circleOf).toMatchObject({ kind: 'arc', face: side('E1', 'h'), center: near([10, 10], 9), radius: expect.closeTo(4, 9), sweep: -2 * Math.PI });
    expect(circleOf.from).toEqual(circleOf.to);
    expect(Math.hypot(circleOf.from[0] - 10, circleOf.from[1] - 10)).toBeCloseTo(4, 4); // a vertex of the polygon lies on the circle
    // the areas are those of the polygons of the mesh: the hole is a little smaller than the circle
    const drawn = section(engine, { plane: XY, offset: 5, outline: 'polylines' });
    const sides = drawn.bodies[0].regions?.[0].holes[0].points?.length ?? 0;
    expect(sides).toBeGreaterThan(30);
    expect(region.holes[0].area).toBeCloseTo(polygon(sides, 4), 3);
    expect(region.holes[0].area).toBeLessThan(Math.PI * 16);
    expect(region.area).toBeCloseTo(1200 - polygon(sides, 4), 3);
    expect(plate.area).toBeCloseTo(region.area, 9);
    expect(bar).toMatchObject({ area: expect.closeTo(300, 3), regions: [{ outer: { length: expect.closeTo(80, 3) }, holes: [] }] });
    expect(kinds(bar.regions?.[0].outer as SectionLoop)).toBe('line line line line');
    // through the pin, above the plate: one whole circle that runs counter-clockwise
    const pin = section(engine, { plane: XY, offset: 12 });
    expect(pin.bodies.map((body) => body.body)).toEqual(['E1']);
    expect(spansOf(pin.bodies[0].regions?.[0].outer as SectionLoop)).toEqual([expect.objectContaining({ kind: 'arc', face: side('PIN', 'k'), center: near([30, 20], 9), radius: expect.closeTo(3, 9), sweep: 2 * Math.PI })]);
    // above everything: nothing
    expect(section(engine, { plane: XY, offset: 20 })).toMatchObject({ bodies: [], inPlane: [] });
  });

  it('a plane given by a face: the offset cuts into the body, the flip turns which side is below, and bodies that end in the plane are named', () => {
    // the top of the plate with no offset: the plane lies in that face and in the top of the bar.
    // The section is taken just below it, so both bodies show that face.
    const flush = section(engine, { plane: TOP });
    expect(flush.frame.normal).toEqual(near([0, 0, 1], 9));
    expect(flush.inPlane).toEqual([{ body: 'E1', face: cap('E1') }, { body: 'BAR', face: cap('BAR') }]);
    expect(flush.bodies.map((body) => [body.body, body.loops])).toEqual([['E1', 2], ['BAR', 1]]);
    expect(flush.bodies[0].area).toBeGreaterThan(1149);
    // seen from the other side, below the plane is above the plate: only the pin, which stands on that face
    const flipped = section(engine, { plane: TOP, flip: true });
    expect(flipped.frame).toMatchObject({ normal: near([0, 0, -1], 9), x: flush.frame.x.map((part) => expect.closeTo(-part, 9)), y: near(flush.frame.y, 9) });
    expect(flipped.inPlane).toEqual(flush.inPlane);
    expect(flipped.bodies).toMatchObject([{ body: 'E1', loops: 1, area: expect.closeTo(Math.PI * 9, 0) }]); // the polygon of the pin, a little less than its circle
    expect(kinds(flipped.bodies[0].regions?.[0].outer as SectionLoop)).toBe('arc');
    // the normal of a face points out of the body: a negative offset cuts into it
    const into = section(engine, { plane: TOP, offset: -4, bodies: ['E1'] });
    expect(into.frame.origin[2]).toBeCloseTo(6, 9);
    expect(into.bodies[0].area).toBeCloseTo(flush.bodies[0].area, 3);
    expect(into.inPlane).toEqual([]);
    // the side at x = 40, moved 30 into the plate: along the axis of the hole, which is then two lines
    const along = section(engine, { plane: onFace('E1', side('E1', 'rb')), offset: -30, bodies: ['E1'] });
    expect(along.frame.normal).toEqual(near([1, 0, 0], 9));
    const regions = along.bodies[0].regions ?? [];
    expect(regions.map((region) => kinds(region.outer))).toEqual(['line line line line', 'line line line line']);
    expect(regions.map((region) => Math.round(region.area)).sort((a, b) => a - b)).toEqual([60, 160]); // either side of the hole
    expect(regions.flatMap((region) => spansOf(region.outer).map((span) => JSON.stringify(span.face)))).toContain(JSON.stringify(side('E1', 'h')));
  });

  it('only the bodies asked about, and the state asked about', () => {
    const bar = section(engine, { plane: XY, offset: 5, bodies: ['BAR', 'BAR'] });
    expect(bar.bodies.map((body) => body.body)).toEqual(['BAR']);
    // the precision is that of the bodies asked about: the plate alone reaches 40 mm
    expect(section(engine, { plane: XY, offset: 5, bodies: ['E1'] }).below).toBeCloseTo(40e-6, 12);
    // before the pin was added there is nothing at z = 12; the plane of a face that is not there yet is refused
    expect(section(engine, { plane: XY, offset: 12 }, 'BAR').bodies).toEqual([]);
    expect(engine.query('section', { plane: onFace('E1', cap('PIN')) }, { at: 'BAR' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['plane', 'face'] } });
    expect(section(engine, { plane: onFace('E1', cap('PIN')), offset: -1 }).bodies.map((body) => body.body)).toEqual(['E1']);
  });

  it('the budget: outlines first, then the lists of points, each whole or not at all', () => {
    const count = (result: SectionResult): (number | undefined)[] => result.bodies.map((body) => body.regions?.length);
    // five spans of the plate and four of the bar
    expect(section(engine, { plane: XY, offset: 5, maxPoints: 9 }).truncated).toBeUndefined();
    const none = section(engine, { plane: XY, offset: 5, maxPoints: 0 });
    expect(none.truncated).toEqual({ shown: 0, total: 9 });
    expect(none.bodies).toEqual([{ body: 'E1', area: expect.closeTo(1149.9, 1), loops: 2 }, { body: 'BAR', area: expect.closeTo(300, 3), loops: 1 }]);
    // the outline of the plate does not fit four, the later and smaller one of the bar does
    const four = section(engine, { plane: XY, offset: 5, maxPoints: 4 });
    expect(four.truncated).toEqual({ shown: 4, total: 9 });
    expect(count(four)).toEqual([undefined, 1]);
    // as polylines: three loops, then their points (4, the corners of the hole, 4)
    const all = section(engine, { plane: XY, offset: 5, outline: 'polylines' });
    expect(all.truncated).toBeUndefined();
    const hole = all.bodies[0].regions?.[0].holes[0].points?.length ?? 0;
    expect(all.bodies[0].regions?.[0].outer.points).toEqual([near([0, 0]), near([40, 0]), near([40, 30]), near([0, 30])]);
    expect(all.bodies[0].regions?.[0].outer.spans).toBeUndefined();
    const seven = section(engine, { plane: XY, offset: 5, outline: 'polylines', maxPoints: 7 });
    expect(seven.truncated).toEqual({ shown: 7, total: 3 + 4 + hole + 4 });
    expect(seven.bodies[0].regions?.[0].outer.points).toHaveLength(4); // the first list fits
    expect(seven.bodies[0].regions?.[0].holes[0]).toEqual({ area: expect.any(Number), length: expect.any(Number) }); // the hole has no room
    expect(seven.bodies[1].regions?.[0].outer.points).toBeUndefined();
    // the hole does not fit, the bar after it does
    const eleven = section(engine, { plane: XY, offset: 5, outline: 'polylines', maxPoints: 11 });
    expect(eleven.truncated).toEqual({ shown: 11, total: 11 + hole });
    expect(eleven.bodies[1].regions?.[0].outer.points).toHaveLength(4);
    // a curve keeps its count and its length when its points do not fit: the hole cut at an angle is
    // not offered by a plane of this model, so the case is in scenario 11 (the teeth of a gear)
    expect(count(all)).toEqual([1, 1]);
  });

  it('what draws a cut: the regions of a complete answer, in the plane the section was taken at', () => {
    const drawn = section(engine, { plane: XY, offset: 5, outline: 'polylines', maxPoints: 1_000_000 });
    const regions = completeRegions(drawn);
    expect(regions?.map((entry) => entry.body)).toEqual(['E1', 'BAR']);
    const frame = takenAt(drawn);
    expect(frame.origin[2]).toBeCloseTo(5 - 60e-6, 12);
    // an outer loop runs counter-clockwise and a hole clockwise: the material is on the left
    const signed = (points: number[][]): number => points.reduce((sum, point, i) => sum + (point[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * point[1]) / 2, 0);
    for (const { region } of regions ?? []) {
      expect(signed(region.outer.points ?? [])).toBeGreaterThan(0);
      for (const loop of region.holes) expect(signed(loop.points ?? [])).toBeLessThan(0);
    }
    expect(completeRegions(section(engine, { plane: XY, offset: 5, outline: 'polylines', maxPoints: 7 }))).toBeUndefined();
  });

  it('the errors name the argument', () => {
    const refused = (args: unknown) => {
      const answer = engine.query('section', args as QueryArgs<'section'>);
      return answer.ok ? undefined : [answer.error.code, answer.error.arg];
    };
    expect(refused({ plane: onFace('E1', side('E1', 'h')) })).toEqual(['notAvailable', ['plane']]); // a face that is not planar
    expect(refused({ plane: onFace('E1', side('E1', 'nope')) })).toEqual(['notAvailable', ['plane', 'face']]);
    expect(refused({ plane: { kind: 'plane', feature: 'E1' } as PlaneRef })).toEqual(['notAvailable', ['plane', 'feature']]);
    expect(refused({})).toEqual(['invalidArguments', ['plane']]);
    expect(refused({ plane: XY, bodies: [] })).toEqual(['invalidArguments', ['bodies']]);
    expect(refused({ plane: XY, bodies: ['nope'] })).toEqual(['notAvailable', ['bodies', 0]]);
    expect(refused({ plane: XY, outline: 'triangles' })).toEqual(['invalidArguments', ['outline']]);
    expect(refused({ plane: XY, maxPoints: -1 })).toEqual(['invalidArguments', ['maxPoints']]);
    expect(refused({ plane: XY, maxPoints: 2.5 })).toEqual(['invalidArguments', ['maxPoints']]);
  });
});
