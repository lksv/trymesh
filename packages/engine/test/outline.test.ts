// D44 (package 2a of D36): exact outlines. The outline of selected regions, an outline moved by an
// offset, the outline of a wall, and the checks of the polylines a tool is built from. No adapters:
// the sketches are given with their solved positions.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Curve, Document, SketchFeature } from '../src/types';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import { type Move, movedChain, movedOutline, nestingOf, outlineRegions, selectionOutline, wallOutline } from '../src/recompute/outline';
import type { Outline, ProfileProblem } from '../src/recompute/state';
import { type Loop, type OutlineCurve, type Region, type SketchGeometry, detectProfile, polygonNesting, polygonProblem } from '../src/sketch';

type Entry = [id: string, curve: Curve, radius?: number];
type Points = Record<string, [number, number]>;

function sketch(points: Points, curves: Entry[], constraints: Record<string, Constraint> = {}): SketchFeature {
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: 'S', id, x, y })),
    ...curves.map(([id, curve, radius]): Command => ({ type: 'addCurve', sketch: 'S', id, curve, ...(radius === undefined ? {} : { radius }) })),
    ...Object.entries(constraints).map(([id, constraint]): Command => ({ type: 'addConstraint', sketch: 'S', id, constraint })),
  ];
  return commands.reduce<Document>(applyCommand, emptyDocument()).features[0] as SketchFeature;
}
const geometry = (s: SketchFeature): SketchGeometry => ({ points: { origin: { x: 0, y: 0 }, ...s.points }, radii: { ...s.radii } });
const line = (a: string, b: string): Curve => ({ type: 'line', a, b });
const arc = (center: string, start: string, end: string): Curve => ({ type: 'arc', center, start, end });

const MOVE: Move = { subject: 'The move', cure: 'Do something else.' };
const TOLERANCE = 0.01;

function area(loop: Loop): number {
  let sum = 0;
  for (let i = 0; i < loop.xy.length / 2; i++) {
    const j = (i + 1) % (loop.xy.length / 2);
    sum += loop.xy[2 * i] * loop.xy[2 * j + 1] - loop.xy[2 * j] * loop.xy[2 * i + 1];
  }
  return sum / 2;
}
const areaOf = (regions: Region[]): number => regions.reduce((sum, region) => sum + area(region.outer) + region.holes.reduce((inner, hole) => inner + area(hole), 0), 0);

// The regions of a sketch by the curves of their outer loops (all of them without a list).
function regionsOf(s: SketchFeature, picked?: string[][], tolerance = TOLERANCE): Region[] {
  const found = detectProfile(s, geometry(s), tolerance);
  expect(found.valid).toBe(true);
  if (!picked) return found.regions;
  return picked.map((loop) => {
    const region = found.regions.find((candidate) => candidate.ref.outerLoop.join() === [...loop].sort().join());
    if (!region) throw new Error(`no region ${loop.join()}; the sketch has ${found.regions.map((r) => r.ref.outerLoop.join()).join(' | ')}`);
    return region;
  });
}
interface Moved {
  outline: Outline;
  moved: Outline;
  regions: Region[];
}
function offset(s: SketchFeature, d: number, picked?: string[][], tolerance = TOLERANCE): Moved | ProfileProblem {
  const outline = selectionOutline(regionsOf(s, picked, tolerance));
  if ('code' in outline) return outline;
  const moved = movedOutline(outline, d, MOVE);
  if ('code' in moved) return moved;
  const regions = outlineRegions(moved, nestingOf(outline), tolerance, MOVE);
  return 'code' in regions ? regions : { outline, moved, regions };
}
const ok = (result: Moved | ProfileProblem): Moved => {
  if ('code' in result) throw new Error(`refused: ${result.message}`);
  return result;
};
const refused = (result: Moved | ProfileProblem | Region[], refs: string[], message: RegExp): void => {
  expect(result).toMatchObject({ code: 'invalidProfile' });
  const problem = result as ProfileProblem;
  expect([...problem.refs].sort()).toEqual([...refs].sort());
  expect(problem.message).toMatch(message);
  // every refusal says what moved the outline and what to do about it
  expect(problem.message).toMatch(/^The move /);
  expect(problem.message).toMatch(/Do something else\.$/);
};

const RECT: Points = { p1: [0, 0], p2: [40, 0], p3: [40, 30], p4: [0, 30] };
const RECT_LINES: Entry[] = [
  ['l1', line('p1', 'p2')],
  ['l2', line('p2', 'p3')],
  ['l3', line('p3', 'p4')],
  ['l4', line('p4', 'p1')],
];
// A rectangle 40 × 30 with corners rounded by `r`: four lines and four arcs, tangent at every joint.
function rounded(r: number): SketchFeature {
  const [w, h] = [40, 30];
  const points: Points = {
    a1: [r, 0], a2: [w - r, 0], b1: [w, r], b2: [w, h - r], c1: [w - r, h], c2: [r, h], d1: [0, h - r], d2: [0, r],
    ca: [w - r, r], cb: [w - r, h - r], cc: [r, h - r], cd: [r, r],
  };
  return sketch(points, [
    ['la', line('a1', 'a2')], ['ra', arc('ca', 'a2', 'b1')],
    ['lb', line('b1', 'b2')], ['rb', arc('cb', 'b2', 'c1')],
    ['lc', line('c1', 'c2')], ['rc', arc('cc', 'c2', 'd1')],
    ['ld', line('d1', 'd2')], ['rd', arc('cd', 'd2', 'a1')],
  ]);
}
// The corners of a loop: where its curves start.
const corners = (loop: OutlineCurve[]): [number, number][] => loop.map((curve) => (curve.type === 'circle' ? curve.center : curve.from));
// The area between a circle of radius `r` and a chord at the distance `a` from its centre: the smaller part.
const segment = (r: number, a: number): number => r * r * Math.acos(a / r) - a * Math.sqrt(r * r - a * a);

describe('the outline of a selection', () => {
  it('a rectangle: its four lines in the order and direction of the loop, counter-clockwise', () => {
    const outline = selectionOutline(regionsOf(sketch(RECT, RECT_LINES))) as Outline;
    expect(outline.regions).toHaveLength(1);
    expect(outline.regions[0].holes).toEqual([]);
    expect(outline.regions[0].outer.map((curve) => [curve.key, curve.type, curve.forward])).toEqual([['l1', 'line', true], ['l2', 'line', true], ['l3', 'line', true], ['l4', 'line', true]]);
    expect(corners(outline.regions[0].outer)).toEqual([[0, 0], [40, 0], [40, 30], [0, 30]]);
  });

  it('a line drawn the other way is passed backwards', () => {
    const s = sketch(RECT, [['l1', line('p2', 'p1')], ...RECT_LINES.slice(1)]);
    const [outer] = (selectionOutline(regionsOf(s)) as Outline).regions.map((region) => region.outer);
    expect(outer.find((curve) => curve.key === 'l1')).toMatchObject({ forward: false, from: [0, 0], to: [40, 0] });
  });

  it('a curve two selected regions share is not part of it: a rectangle with a circle inside, both selected, is the rectangle', () => {
    const s = sketch({ ...RECT, c: [20, 15] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 5]]);
    const both = selectionOutline(regionsOf(s)) as Outline;
    expect(both.regions).toHaveLength(1);
    expect(both.regions[0].holes).toEqual([]);
    expect(both.regions[0].outer.map((curve) => curve.key)).toEqual(['l1', 'l2', 'l3', 'l4']);
    // the rectangle alone has the circle as its hole, passed clockwise; the circle alone is a loop
    const ring = selectionOutline(regionsOf(s, [['l1', 'l2', 'l3', 'l4']])) as Outline;
    expect(ring.regions[0].holes).toEqual([[{ key: 'k', forward: false, type: 'circle', center: [20, 15], radius: 5, ccw: false }]]);
    expect((selectionOutline(regionsOf(s, [['k']])) as Outline).regions).toEqual([{ outer: [{ key: 'k', forward: true, type: 'circle', center: [20, 15], radius: 5, ccw: true }], holes: [] }]);
  });

  it('two regions with a common line: the line is dropped and the rest is one loop', () => {
    // the rectangle cut in two by a line from the bottom to the top
    const s = sketch({ ...RECT, m1: [15, 0], m2: [15, 30] }, [
      ['b1', line('p1', 'm1')], ['b2', line('m1', 'p2')], ['l2', line('p2', 'p3')],
      ['t1', line('p3', 'm2')], ['t2', line('m2', 'p4')], ['l4', line('p4', 'p1')], ['mid', line('m1', 'm2')],
    ]);
    const regions = regionsOf(s);
    expect(regions).toHaveLength(2);
    const outline = selectionOutline(regions) as Outline;
    expect(outline.regions).toHaveLength(1);
    expect(outline.regions[0].outer.map((curve) => curve.key).sort()).toEqual(['b1', 'b2', 'l2', 'l4', 't1', 't2']);
    // moved as one: the two halves of the bottom are tangent neighbours and stay in line
    const grown = ok(offset(s, 2));
    expect(areaOf(grown.regions)).toBeCloseTo(44 * 34, 9);
    const bottom = grown.moved.regions[0].outer.filter((curve) => curve.key === 'b1' || curve.key === 'b2');
    expect(bottom.map((curve) => (curve.type === 'line' ? [curve.from[1], curve.to[1]] : []))).toEqual([[-2, -2], [-2, -2]]);
  });

  it('an island in a hole is a region of its own; a hole belongs to the smallest outer loop around it', () => {
    // a square 60, a square 40 inside it, a square 20 inside that: the outer band and the island selected
    const square = (p: string, low: number, high: number): [Points, Entry[]] => [
      { [`${p}p1`]: [low, low], [`${p}p2`]: [high, low], [`${p}p3`]: [high, high], [`${p}p4`]: [low, high] },
      [1, 2, 3, 4].map((i): Entry => [`${p}${i}`, line(`${p}p${i}`, `${p}p${(i % 4) + 1}`)]),
    ];
    const parts = [square('a', 0, 60), square('b', 10, 50), square('c', 20, 40)];
    const s = sketch(Object.assign({}, ...parts.map(([points]) => points)), parts.flatMap(([, curves]) => curves));
    const outline = selectionOutline(regionsOf(s, [['a1', 'a2', 'a3', 'a4'], ['c1', 'c2', 'c3', 'c4']])) as Outline;
    expect(outline.regions.map((region) => [region.outer[0].key[0], region.holes.map((hole) => hole[0].key[0])])).toEqual([['a', ['b']], ['c', []]]);
    expect(nestingOf(outline)).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
    ]);
    // grown by 2: the band is 64² − 36², the island 24²
    expect(areaOf(ok(offset(s, 2, [['a1', 'a2', 'a3', 'a4'], ['c1', 'c2', 'c3', 'c4']])).regions)).toBeCloseTo(64 * 64 - 36 * 36 + 24 * 24, 9);
  });

  it('regions that meet in a point are two loops, and an inward offset pulls them apart', () => {
    // two squares with one common corner at (10, 10)
    const s = sketch(
      { pa1: [0, 0], pa2: [10, 0], m: [10, 10], pa4: [0, 10], pb2: [20, 10], pb3: [20, 20], pb4: [10, 20] },
      [['a1', line('pa1', 'pa2')], ['a2', line('pa2', 'm')], ['a3', line('m', 'pa4')], ['a4', line('pa4', 'pa1')], ['b1', line('m', 'pb2')], ['b2', line('pb2', 'pb3')], ['b3', line('pb3', 'pb4')], ['b4', line('pb4', 'm')]],
    );
    const outline = selectionOutline(regionsOf(s)) as Outline;
    expect(outline.regions.map((region) => region.outer.map((curve) => curve.key).sort())).toEqual([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3', 'b4']]);
    expect(areaOf(ok(offset(s, -1)).regions)).toBeCloseTo(2 * 64, 9);
    // grown, the two squares run into each other
    expect(offset(s, 1)).toMatchObject({ code: 'invalidProfile' });
  });

  it('a generated loop has no exact curves, so no outline', () => {
    const generated: Region = { ref: { outerLoop: ['teeth'] }, outer: { xy: [0, 0, 1, 0, 0, 1], keys: ['a', 'b', 'c'], curves: ['teeth', 'teeth', 'teeth'] }, holes: [] };
    expect(selectionOutline([generated])).toMatchObject({ code: 'invalidProfile', refs: [] });
  });
});

describe('the offset of an outline', () => {
  it('a rectangle: parallel lines joined in mitres, the curves keep their keys', () => {
    const grown = ok(offset(sketch(RECT, RECT_LINES), 2));
    expect(corners(grown.moved.regions[0].outer)).toEqual([[-2, -2], [42, -2], [42, 32], [-2, 32]]);
    expect(grown.moved.regions[0].outer.map((curve) => curve.key)).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(grown.regions[0].outer.curves).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(new Set(grown.regions[0].outer.keys).size).toBe(4);
    expect(areaOf(grown.regions)).toBeCloseTo(44 * 34, 9);
    const shrunk = ok(offset(sketch(RECT, RECT_LINES), -2));
    expect(corners(shrunk.moved.regions[0].outer)).toEqual([[2, 2], [38, 2], [38, 28], [2, 28]]);
    expect(areaOf(shrunk.regions)).toBeCloseTo(36 * 26, 9);
  });

  it('a sharp corner moves by the offset over the sine of half its angle', () => {
    // a right triangle with legs 30 and 40: the corner at the origin moves along the diagonal
    const s = sketch({ a: [0, 0], b: [40, 0], c: [0, 30] }, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['ca', line('c', 'a')]]);
    const [at] = corners(ok(offset(s, 1)).moved.regions[0].outer);
    expect(at[0]).toBeCloseTo(-1, 12);
    expect(at[1]).toBeCloseTo(-1, 12);
    // the area grows by the perimeter times the offset plus the mitres: d² · Σ cot(half angle)
    const cot = (angle: number): number => 1 / Math.tan(angle / 2);
    const [beta, gamma] = [Math.atan2(30, 40), Math.atan2(40, 30)];
    expect(areaOf(ok(offset(s, 1)).regions)).toBeCloseTo(600 + 120 + cot(Math.PI / 2) + cot(beta) + cot(gamma), 9);
  });

  it('a rounded rectangle: tangent joints stay tangent, the arcs keep their centres', () => {
    for (const d of [2, -2, -4.5]) {
      const result = ok(offset(rounded(5), d));
      const loop = result.moved.regions[0].outer;
      expect(loop.map((curve) => curve.key)).toEqual(['la', 'ra', 'lb', 'rb', 'lc', 'rc', 'ld', 'rd']);
      for (const curve of loop) if (curve.type === 'arc') expect([curve.radius, curve.sweep]).toEqual([5 + d, expect.closeTo(Math.PI / 2, 12)]);
      expect(loop[1]).toMatchObject({ type: 'arc', center: [35, 5] });
      expect(loop[0]).toMatchObject({ type: 'line', from: [5, -d], to: [35, -d] });
      // the area by the exact curves, within what the division of the arcs takes off
      const exact = (40 + 2 * d) * (30 + 2 * d) - (4 - Math.PI) * (5 + d) ** 2;
      expect(areaOf(result.regions)).toBeLessThan(exact + 1e-9);
      expect(areaOf(result.regions)).toBeGreaterThan(exact - 4 * Math.PI * (5 + d) * TOLERANCE);
    }
  });

  it('a corner radius the offset uses up: the arcs are named and the message says what to do', () => {
    for (const d of [-5, -6]) refused(offset(rounded(5), d), ['ra', 'rb', 'rc', 'rd'], /leaves no radius for the arcs "ra", "rb", "rc", "rd" \(the smallest radius is 5 mm\), so they vanish/);
  });

  it('a D shape: an arc that meets a line at an angle, on both branches', () => {
    // a circle of radius 10 around the origin cut by the line x = −6; the larger part and the smaller one
    const points: Points = { o: [0, 0], lo: [-6, -8], hi: [-6, 8] };
    const larger = sketch(points, [['chord', line('hi', 'lo')], ['bow', arc('o', 'lo', 'hi')]]);
    const smaller = sketch(points, [['chord', line('lo', 'hi')], ['bow', arc('o', 'hi', 'lo')]]);
    for (const d of [1, -1, 3]) {
      const big = ok(offset(larger, d));
      // the line moves away from the centre, the corners stay on the moved circle and on the moved line
      const y = Math.sqrt((10 + d) ** 2 - (6 + d) ** 2);
      expect(corners(big.moved.regions[0].outer).sort((p, q) => p[1] - q[1])).toEqual([[expect.closeTo(-6 - d, 12), expect.closeTo(-y, 12)], [expect.closeTo(-6 - d, 12), expect.closeTo(y, 12)]]);
      const exactBig = Math.PI * (10 + d) ** 2 - segment(10 + d, 6 + d);
      expect(areaOf(big.regions)).toBeLessThan(exactBig + 1e-9);
      expect(areaOf(big.regions)).toBeGreaterThan(exactBig - 2 * Math.PI * (10 + d) * TOLERANCE);
      if (d > 2) continue; // the smaller part is gone before 3
      const small = ok(offset(smaller, d));
      const exactSmall = segment(10 + d, 6 - d);
      expect(areaOf(small.regions)).toBeLessThan(exactSmall + 1e-9);
      expect(areaOf(small.regions)).toBeGreaterThan(exactSmall - 2 * Math.PI * (10 + d) * TOLERANCE);
    }
    // a clockwise pass shrinks an arc: the same D as a hole of a square around it
    const frame: Points = { q1: [-20, -20], q2: [20, -20], q3: [20, 20], q4: [-20, 20] };
    const holed = sketch({ ...points, ...frame }, [['chord', line('hi', 'lo')], ['bow', arc('o', 'lo', 'hi')], ['f1', line('q1', 'q2')], ['f2', line('q2', 'q3')], ['f3', line('q3', 'q4')], ['f4', line('q4', 'q1')]]);
    const band = ok(offset(holed, 1, [['f1', 'f2', 'f3', 'f4']]));
    const hole = band.moved.regions[0].holes[0];
    expect(hole.find((curve) => curve.key === 'bow')).toMatchObject({ type: 'arc', radius: 9, forward: false });
    expect(Math.sign((hole.find((curve) => curve.key === 'bow') as Extract<OutlineCurve, { type: 'arc' }>).sweep)).toBe(-1);
    const exact = 42 * 42 - (Math.PI * 81 - segment(9, 5));
    expect(areaOf(band.regions)).toBeGreaterThan(exact - 1e-9);
    expect(areaOf(band.regions)).toBeLessThan(exact + 2 * Math.PI * 9 * TOLERANCE);
  });

  it('two arcs that meet at an angle: a lens', () => {
    // two circles of radius 10 with centres 12 apart; the lens between them
    const s = sketch({ a: [0, 0], b: [12, 0], top: [6, 8], bottom: [6, -8] }, [['left', arc('b', 'top', 'bottom')], ['right', arc('a', 'bottom', 'top')]]);
    for (const d of [1, -1]) {
      const lens = ok(offset(s, d));
      const y = Math.sqrt((10 + d) ** 2 - 36);
      expect(corners(lens.moved.regions[0].outer).map(([x, cy]) => [x, Math.abs(cy)])).toEqual([[expect.closeTo(6, 12), expect.closeTo(y, 12)], [expect.closeTo(6, 12), expect.closeTo(y, 12)]]);
      const exact = 2 * segment(10 + d, 6);
      expect(areaOf(lens.regions)).toBeLessThan(exact + 1e-9);
      expect(areaOf(lens.regions)).toBeGreaterThan(exact - 2 * Math.PI * (10 + d) * TOLERANCE);
    }
    // shrunk by 5 the circles no longer meet
    refused(offset(s, -5), ['left', 'right'], /moves the curves "(left|right)", "(left|right)" so that they no longer meet/);
  });

  it('an outline with a hole: the outer loop grows and the hole shrinks', () => {
    const s = sketch({ ...RECT, c: [20, 15] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 5]]);
    const ring = [['l1', 'l2', 'l3', 'l4']];
    const grown = ok(offset(s, 1, ring));
    expect(grown.moved.regions[0].holes[0]).toEqual([{ key: 'k', forward: false, type: 'circle', center: [20, 15], radius: 4, ccw: false }]);
    expect(areaOf(grown.regions)).toBeGreaterThan(42 * 32 - Math.PI * 16);
    expect(areaOf(grown.regions)).toBeLessThan(42 * 32 - Math.PI * 16 + 2 * Math.PI * 4 * TOLERANCE);
    expect(ok(offset(s, -1, ring)).moved.regions[0].holes[0][0]).toMatchObject({ radius: 6 });
    // the circle alone grows with a positive offset
    expect(ok(offset(s, 1, [['k']])).moved.regions[0].outer[0]).toMatchObject({ radius: 6, ccw: true });
  });

  it('an offset and its opposite give the outline back: random convex and L-shaped outlines', () => {
    let seed = 20261115;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const polygon = (xy: [number, number][]): SketchFeature =>
      sketch(Object.fromEntries(xy.map((p, i) => [`p${i}`, p])), xy.map((_, i): Entry => [`l${i}`, line(`p${i}`, `p${(i + 1) % xy.length}`)]));
    let passed = 0;
    for (let round = 0; round < 200; round++) {
      let xy: [number, number][];
      if (round % 2) {
        // an L: a rectangle w × h with a notch a × b cut from its upper right corner
        const [w, h] = [20 + 40 * random(), 20 + 40 * random()];
        const [a, b] = [w * (0.3 + 0.4 * random()), h * (0.3 + 0.4 * random())];
        xy = [[0, 0], [w, 0], [w, h - b], [w - a, h - b], [w - a, h], [0, h]];
      } else {
        // convex: points on an ellipse at growing angles
        const count = 3 + Math.floor(6 * random());
        const [rx, ry] = [15 + 30 * random(), 15 + 30 * random()];
        const angles = Array.from({ length: count }, (_, i) => ((i + 0.2 + 0.6 * random()) * 2 * Math.PI) / count);
        xy = angles.map((angle): [number, number] => [rx * Math.cos(angle), ry * Math.sin(angle)]);
      }
      const d = (random() < 0.5 ? -1 : 1) * (0.2 + 2.8 * random());
      const outline = selectionOutline(regionsOf(polygon(xy))) as Outline;
      const there = movedOutline(outline, d, MOVE);
      if ('code' in there) continue; // a short edge used up by an inward offset
      const regions = outlineRegions(there, nestingOf(outline), TOLERANCE, MOVE);
      if ('code' in regions) continue;
      // the area changes by the sign of the offset
      expect(Math.sign(areaOf(regions) - areaOf(regionsOf(polygon(xy))))).toBe(Math.sign(d));
      const back = movedOutline(there, -d, MOVE) as Outline;
      const [before, after] = [corners(outline.regions[0].outer), corners(back.regions[0].outer)];
      expect(after).toHaveLength(before.length);
      after.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(before[i][0], 9);
        expect(p[1]).toBeCloseTo(before[i][1], 9);
      });
      passed++;
    }
    expect(passed).toBeGreaterThan(150);
  });
});

describe('what an offset is refused for', () => {
  it('a rectangle moved in by more than half its height: the lines the others meet before are named', () => {
    refused(offset(sketch(RECT, RECT_LINES), -15), ['l2', 'l4'], /leaves no length for the curves "l2", "l4": their neighbours meet before them, so they vanish/);
    refused(offset(sketch(RECT, RECT_LINES), -25), ['l1', 'l2', 'l3', 'l4'], /leaves no length for the curves "l1", "l2", "l3", "l4"/);
    // just under half the height it still stands
    expect(areaOf(ok(offset(sketch(RECT, RECT_LINES), -14.9)).regions)).toBeCloseTo(10.2 * 0.2, 9);
  });

  it('a hole the offset closes: the circle is named with its radius', () => {
    const s = sketch({ ...RECT, c: [20, 15] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 5]]);
    for (const d of [5, 6]) refused(offset(s, d, [['l1', 'l2', 'l3', 'l4']]), ['k'], /leaves no radius for the circle "k" \(its radius is 5 mm\)/);
  });

  it('an arc that turns round: its neighbours meet before it', () => {
    // a rectangle with one corner cut by a small arc that is not tangent to its neighbours (a bite)
    const s = sketch({ p1: [0, 0], p2: [40, 0], p3: [40, 30], p4: [0, 30], e1: [3, 0], e2: [0, 3] }, [['l1', line('e1', 'p2')], ['l2', line('p2', 'p3')], ['l3', line('p3', 'p4')], ['l4', line('p4', 'e2')], ['bite', arc('p1', 'e1', 'e2')]]);
    expect(regionsOf(s)).toHaveLength(1);
    // the bite is passed clockwise, so growing the profile shrinks it; at 3 it is gone
    expect(ok(offset(s, 1)).moved.regions[0].outer.find((curve) => curve.key === 'bite')).toMatchObject({ radius: 2 });
    refused(offset(s, 3), ['bite'], /leaves no radius for the arc "bite" \(the smallest radius is 3 mm\), so it vanishes/);
  });

  it('a hole that runs into the outer loop: the two curves are named', () => {
    // the circle is 2 from the left side; moved in by 3 the side passes through it
    const s = sketch({ ...RECT, c: [7, 15] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 5]]);
    refused(offset(s, -3, [['l1', 'l2', 'l3', 'l4']]), ['k', 'l4'], /makes the curves "l4", "k" touch or cross where they are not joined/);
    expect(areaOf(ok(offset(s, -0.5, [['l1', 'l2', 'l3', 'l4']])).regions)).toBeGreaterThan(0);
  });

  it('a hole that grows past its outer loop without touching it: the nesting changed', () => {
    // a square 10 with a circle of radius 1 in its middle; moved in by 4.5 the square (1 × 1) lies inside the circle (5.5)
    const s = sketch({ p1: [0, 0], p2: [10, 0], p3: [10, 10], p4: [0, 10], c: [5, 5] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 1]]);
    refused(offset(s, -4.5, [['l1', 'l2', 'l3', 'l4']]), ['l1', 'l2', 'l3', 'l4'], /moves the loop of "l1", "l2", "l3", "l4" out of the loop it lay in, or into another/);
  });

  it('a sliver between an arc and its chord that the division of the arc flattens', () => {
    // the smaller part of a circle of radius 10 cut 0.1 from its edge; moved in, the arc is one segment
    const y = Math.sqrt(100 - 9.9 * 9.9);
    const s = sketch({ o: [0, 0], lo: [-9.9, -y], hi: [-9.9, y] }, [['chord', line('lo', 'hi')], ['bow', arc('o', 'hi', 'lo')]]);
    expect(regionsOf(s)).toHaveLength(1);
    refused(offset(s, -0.049), ['bow', 'chord'], /leaves no area inside the loop of the curves "bow", "chord"/);
    // a little less and it is a thin triangle with an area
    expect(ok(offset(s, -0.04)).regions[0].outer.keys.length).toBeGreaterThanOrEqual(3);
  });

  it('a small hole that lies inside the exact circle and outside its polygon', () => {
    // between two corners of the polygon of a circle of radius 10 there is room for a hole the polygon does not hold
    const steps = 71; // the division of the circle at the tolerance 0.01
    const angle = Math.PI / steps;
    const s = sketch({ o: [0, 0], h: [9.996 * Math.cos(angle), 9.996 * Math.sin(angle)] }, [['big', { type: 'circle', center: 'o' }, 10], ['small', { type: 'circle', center: 'h' }, 0.002]]);
    const outline = selectionOutline(regionsOf(s, [['big']])) as Outline;
    expect(nestingOf(outline)).toEqual([[false, false], [true, false]]);
    const moved = movedOutline(outline, 0.0005, MOVE) as Outline;
    const built = outlineRegions(moved, nestingOf(outline), TOLERANCE, MOVE);
    refused(built, ['small'], /moves the loop of "small" out of the loop it lay in/);
  });
});

describe('the checks of the polylines', () => {
  const loop = (xy: [number, number][], tag: string, curve = tag): Loop => ({ xy: xy.flat(), keys: xy.map((_, i) => `${tag}${i}`), curves: xy.map(() => curve) });
  const SQUARE: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('a square with a hole passes', () => {
    const loops = [loop(SQUARE, 'outer'), loop([[2, 2], [2, 8], [8, 8], [8, 2]], 'hole')];
    expect(polygonProblem(loops, [1, -1])).toBeUndefined();
    expect(polygonNesting(loops)).toEqual([[false, false], [true, false]]);
  });

  it('a hole that passes through an edge of its outer polygon at two of its own vertices', () => {
    // two vertices on the bottom edge, one inside: no proper crossing, a sound area, one vertex inside
    const hole = loop([[3, 0], [5, 4], [7, 0]], 'hole');
    expect(polygonProblem([loop(SQUARE, 'outer'), hole], [1, -1])).toEqual({ what: 'clearance', curves: ['outer', 'hole'] });
  });

  it('a loop that returns to a point it has been at', () => {
    // two squares that touch in one vertex, walked as one loop
    const eight: [number, number][] = [[0, 0], [5, 0], [5, 5], [10, 5], [10, 10], [5, 10], [5, 5], [0, 5]];
    expect(polygonProblem([loop(eight, 'eight')], [1])).toEqual({ what: 'clearance', curves: ['eight'] });
  });

  it('two loops nearer than the tolerance, also where their boxes do not overlap', () => {
    const near = loop([[10 + 5e-7, 2], [12, 2], [12, 8], [10 + 5e-7, 8]], 'near');
    expect(polygonProblem([loop(SQUARE, 'outer'), near], [1, 1])).toEqual({ what: 'clearance', curves: ['outer', 'near'] });
    const far = loop([[10 + 5e-6, 2], [12, 2], [12, 8], [10 + 5e-6, 8]], 'far');
    expect(polygonProblem([loop(SQUARE, 'outer'), far], [1, 1])).toBeUndefined();
  });

  it('an edge that folds back onto the one before it, and an edge shorter than the tolerance', () => {
    expect(polygonProblem([loop([[0, 0], [10, 0], [5, 0], [5, 5]], 'fold')], [1])).toMatchObject({ what: 'clearance' });
    expect(polygonProblem([loop([[0, 0], [10, 0], [10, 5e-7], [10, 10], [0, 10]], 'short')], [1])).toMatchObject({ what: 'clearance' });
  });

  it('a loop with fewer than three points, a loop walked the other way, a loop without area', () => {
    expect(polygonProblem([loop([[0, 0], [10, 0]], 'two')], [1])).toEqual({ what: 'points', curves: ['two'] });
    expect(polygonProblem([loop([...SQUARE].reverse(), 'turned')], [1])).toEqual({ what: 'area', curves: ['turned'] });
    expect(polygonProblem([loop(SQUARE, 'outer')], [-1])).toEqual({ what: 'area', curves: ['outer'] });
  });
});

describe('the outline of a wall', () => {
  const wall = (s: SketchFeature, ids: string[], thickness: number) => wallOutline(s, geometry(s), ids, thickness, MOVE);
  const built = (s: SketchFeature, ids: string[], thickness: number) => {
    const found = wall(s, ids, thickness);
    if ('code' in found) throw new Error(`refused: ${found.message ?? found.code}`);
    const regions = outlineRegions(found.outline, found.nesting, TOLERANCE, MOVE);
    if ('code' in regions) throw new Error(`refused: ${regions.message}`);
    return { ...found, regions };
  };
  const names = (sides: Map<string, { name: object }>): object[] => [...sides.values()].map((side) => side.name);

  it('one line: a rectangle around it, two sides and two ends', () => {
    const s = sketch({ a: [0, 0], b: [10, 0] }, [['w', { ...line('a', 'b'), construction: true }]]);
    const result = built(s, ['w'], 2);
    expect(corners(result.outline.regions[0].outer)).toEqual([[0, -1], [10, -1], [10, 1], [0, 1]]);
    expect(result.regions[0].outer.curves).toEqual(['R|w', 'E|b', 'L|w', 'E|a']);
    expect(areaOf(result.regions)).toBeCloseTo(20, 12);
    expect(names(result.sides)).toEqual([
      { role: 'wallSide', curve: 'w', side: 'right' },
      { role: 'wallSide', curve: 'w', side: 'left' },
      { role: 'wallEnd', point: 'b' },
      { role: 'wallEnd', point: 'a' },
    ]);
    // the plane of a side is given in the direction of the curve; an end from the left of the curve to its right
    expect(result.sides.get('L|w')?.shape).toEqual({ type: 'line', a: [0, 1], b: [10, 1] });
    expect(result.sides.get('R|w')?.shape).toEqual({ type: 'line', a: [0, -1], b: [10, -1] });
    expect(result.sides.get('E|b')?.shape).toEqual({ type: 'line', a: [10, 1], b: [10, -1] });
    expect(result.sides.get('E|a')?.shape).toEqual({ type: 'line', a: [0, 1], b: [0, -1] });
  });

  it('the names follow the curve, not the walk: the same line drawn the other way swaps its sides', () => {
    const s = sketch({ a: [0, 0], b: [10, 0] }, [['w', line('b', 'a')]]);
    const result = built(s, ['w'], 2);
    // the walk starts at the free end with the smaller key (`a`), against the direction of the curve
    expect(result.regions[0].outer.curves).toEqual(['L|w', 'E|b', 'R|w', 'E|a']);
    expect(result.sides.get('L|w')?.shape).toEqual({ type: 'line', a: [10, -1], b: [0, -1] });
    expect(result.sides.get('E|a')?.shape).toEqual({ type: 'line', a: [0, -1], b: [0, 1] });
  });

  it('an L of two lines: a mitred corner; a curve added to the chain renames nothing', () => {
    const points: Points = { a: [0, 0], b: [10, 0], c: [10, 10], d: [20, 10] };
    const s = sketch(points, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['cd', line('c', 'd')]]);
    const corner = built(s, ['ab', 'bc'], 2);
    expect(corners(corner.outline.regions[0].outer)).toEqual([[0, -1], [11, -1], [11, 10], [9, 10], [9, 1], [0, 1]]);
    expect(areaOf(corner.regions)).toBeCloseTo(40, 12);
    expect(corner.regions[0].outer.curves).toEqual(['R|ab', 'R|bc', 'E|c', 'L|bc', 'L|ab', 'E|a']);
    const longer = built(s, ['ab', 'bc', 'cd'], 2);
    expect(areaOf(longer.regions)).toBeCloseTo(60, 12);
    const before = names(corner.sides).map((name) => JSON.stringify(name));
    const after = names(longer.sides).map((name) => JSON.stringify(name));
    // every face of the shorter wall but its end at `c`, which is a corner now
    expect(before.filter((name) => !after.includes(name))).toEqual([JSON.stringify({ role: 'wallEnd', point: 'c' })]);
    // the list is a set: its order does not matter
    expect(built(s, ['bc', 'ab'], 2).regions[0].outer.curves).toEqual(corner.regions[0].outer.curves);
  });

  it('points held together by a satisfied coincident constraint join the chain', () => {
    const s = sketch({ a: [0, 0], b: [10, 0], b2: [10, 0], c: [10, 10] }, [['ab', line('a', 'b')], ['bc', line('b2', 'c')]], { join: { type: 'coincident', a: 'b', b: 'b2' } });
    expect(areaOf(built(s, ['ab', 'bc'], 2).regions)).toBeCloseTo(40, 12);
    // without the constraint the two lines are two chains
    const apart = sketch({ a: [0, 0], b: [10, 0], b2: [10, 0], c: [10, 10] }, [['ab', line('a', 'b')], ['bc', line('b2', 'c')]]);
    expect(wall(apart, ['ab', 'bc'], 2)).toMatchObject({ code: 'invalidProfile', refs: ['ab', 'bc'], message: expect.stringMatching(/are not connected: "bc" is not joined to the chain of "ab"/) });
  });

  it('an arc: a quarter of a ring; left is the side of the centre', () => {
    const s = sketch({ o: [0, 0], p: [10, 0], q: [0, 10] }, [['bend', arc('o', 'p', 'q')]]);
    const result = built(s, ['bend'], 2);
    expect(result.sides.get('L|bend')).toEqual({ name: { role: 'wallSide', curve: 'bend', side: 'left' }, shape: { type: 'round', center: [0, 0], radius: 9 } });
    expect(result.sides.get('R|bend')?.shape).toEqual({ type: 'round', center: [0, 0], radius: 11 });
    expect(names(result.sides).filter((name) => (name as { role: string }).role === 'wallEnd')).toEqual([{ role: 'wallEnd', point: 'q' }, { role: 'wallEnd', point: 'p' }]);
    const exact = (Math.PI / 4) * (121 - 81);
    expect(areaOf(result.regions)).toBeGreaterThan(exact - 0.5);
    expect(areaOf(result.regions)).toBeLessThan(exact + 0.5);
  });

  it('a circle: a ring, the outer loop from its right side and the hole from its left', () => {
    const s = sketch({ o: [0, 0] }, [['ring', { type: 'circle', center: 'o', construction: true }, 10]]);
    const result = built(s, ['ring'], 2);
    expect(result.outline.regions).toEqual([{ outer: [{ key: 'R|ring', forward: true, type: 'circle', center: [0, 0], radius: 11, ccw: true }], holes: [[{ key: 'L|ring', forward: false, type: 'circle', center: [0, 0], radius: 9, ccw: false }]] }]);
    expect(names(result.sides)).toEqual([{ role: 'wallSide', curve: 'ring', side: 'right' }, { role: 'wallSide', curve: 'ring', side: 'left' }]);
    expect(areaOf(result.regions)).toBeGreaterThan(40 * Math.PI - 1);
    expect(areaOf(result.regions)).toBeLessThan(40 * Math.PI);
    // a wall as thick as the circle is wide has no hole left
    expect(wall(s, ['ring'], 20)).toMatchObject({ code: 'invalidProfile', refs: ['ring'], message: expect.stringMatching(/leaves no radius for the circle "ring"/) });
  });

  it('a closed loop of lines: a band with a hole, whichever way the loop was drawn', () => {
    for (const lines of [RECT_LINES, RECT_LINES.map(([id, curve]): Entry => [id, curve.type === 'line' ? line(curve.b, curve.a) : curve])]) {
      const result = built(sketch(RECT, lines), ['l1', 'l2', 'l3', 'l4'], 2);
      expect(result.outline.regions[0].holes).toHaveLength(1);
      expect(areaOf(result.regions)).toBeCloseTo(42 * 32 - 38 * 28, 9);
      expect(result.nesting).toEqual([[false, false], [true, false]]);
    }
    // the outside of a loop drawn counter-clockwise is on the right of its lines
    const drawn = built(sketch(RECT, RECT_LINES), ['l1', 'l2', 'l3', 'l4'], 2);
    expect(drawn.regions[0].outer.curves).toEqual(['R|l1', 'R|l2', 'R|l3', 'R|l4']);
  });

  it('what is not one chain is refused with the curves named', () => {
    const points: Points = { a: [0, 0], b: [10, 0], c: [10, 10], d: [20, 0], e: [30, 0], f: [40, 0], o: [50, 50], g: [60, 0], g2: [60, 0] };
    const s = sketch(points, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['bd', line('b', 'd')], ['ef', line('e', 'f')], ['dot', line('g', 'g2')], ['ring', { type: 'circle', center: 'o' }, 5]]);
    expect(wall(s, ['ab', 'bc', 'bd'], 1)).toMatchObject({ code: 'invalidProfile', refs: ['ab', 'bc', 'bd'], message: expect.stringMatching(/The curves "ab", "bc", "bd" of the wall meet in one point\. A wall follows one chain/) });
    expect(wall(s, ['ab', 'ef'], 1)).toMatchObject({ code: 'invalidProfile', refs: ['ab', 'ef'], message: expect.stringMatching(/not connected: "ef" is not joined to the chain of "ab"/) });
    expect(wall(s, ['ab', 'ring'], 1)).toMatchObject({ code: 'invalidProfile', message: expect.stringMatching(/A circle makes a wall by itself/) });
    expect(wall(s, ['dot'], 1)).toMatchObject({ code: 'invalidProfile', refs: ['dot'], message: expect.stringMatching(/has no length/) });
    expect(wall(s, ['ab', 'gone'], 1)).toEqual({ code: 'brokenReference', refs: ['gone'] });
  });

  it('a bend tighter than the wall, and a chain that crosses itself', () => {
    // a hairpin: two long lines 1 apart joined by a short one; a wall 2 thick folds onto itself
    const pin = sketch({ a: [0, 0], b: [20, 0], c: [20, 1], d: [0, 1] }, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['cd', line('c', 'd')]]);
    expect(wall(pin, ['ab', 'bc', 'cd'], 2)).toMatchObject({ code: 'invalidProfile', refs: ['bc'], message: expect.stringMatching(/leaves no length for the curve "bc"/) });
    expect(areaOf(built(pin, ['ab', 'bc', 'cd'], 0.5).regions)).toBeGreaterThan(0);
    // a figure of four lines whose last crosses the first
    const cross = sketch({ a: [0, 0], b: [20, 0], c: [20, 10], d: [10, 10], e: [10, -10] }, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['cd', line('c', 'd')], ['de', line('d', 'e')]]);
    const found = wall(cross, ['ab', 'bc', 'cd', 'de'], 1);
    expect('code' in found).toBe(false);
    if ('code' in found) return;
    expect(outlineRegions(found.outline, found.nesting, TOLERANCE, MOVE, found.curveOf)).toMatchObject({ code: 'invalidProfile', refs: ['ab', 'de'], message: expect.stringMatching(/makes the curves "ab", "de" touch or cross where they are not joined/) });
  });

  it('an open chain moved to one side: the free ends move along their own normals', () => {
    const points: Points = { a: [0, 0], b: [10, 0], c: [10, 10] };
    const s = sketch(points, [['ab', line('a', 'b')], ['bc', line('b', 'c')]]);
    const chain = (wall(s, ['ab', 'bc'], 2) as { outline: Outline }).outline.regions[0].outer.slice(0, 2).map((curve) => ({ ...curve, key: curve.key.slice(2) }));
    expect(chain.map((curve) => curve.key)).toEqual(['ab', 'bc']);
    const moved = movedChain(chain, 1, false, MOVE) as OutlineCurve[];
    expect(corners(moved)).toEqual([[0, -2], [12, -2]]);
    expect(moved[1]).toMatchObject({ to: [12, 10] });
  });
});
