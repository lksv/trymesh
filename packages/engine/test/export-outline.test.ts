// The outline of a plane (D54) over sections written by hand: the pieces of a loop (the rule of the
// arcs), the box of what is drawn, and the DXF and SVG written from it. The cuts of real models are
// in packages/scenarios (outline.test.ts, scenario12.test.ts).
import { describe, expect, it } from 'vitest';
import { dxfText } from '../src/export/dxf';
import { type Outline, type OutlineLoop, type OutlinePiece, QUARTER, TURN_ALLOWANCE, loopsOf, piecesOfArc } from '../src/export/outline';
import { svgText } from '../src/export/svg';
import type { SectionLoop, SectionResult, SectionSpan } from '../src/query/section';
import type { FaceName, Frame, Vec2 } from '../src/types';

const FACE: FaceName = { feature: 'f', role: 'side', curve: 'c' };
const line = (from: Vec2, to: Vec2): SectionSpan => ({ kind: 'line', face: FACE, from, to });
const arc = (from: Vec2, to: Vec2, center: Vec2, radius: number, sweep: number): SectionSpan => ({ kind: 'arc', face: FACE, from, to, center, radius, sweep });
const loop = (...spans: SectionSpan[]): SectionLoop => ({ area: 0, length: 0, spans });
const circleLoop = (center: Vec2, radius: number, sweep = 2 * Math.PI): SectionLoop => {
  const at: Vec2 = [center[0] + radius, center[1]];
  return loop(arc(at, at, center, radius, sweep));
};
type Region = { outer: SectionLoop; holes?: SectionLoop[] };
const sectionOf = (...bodies: [string, ...Region[]][]): Pick<SectionResult, 'bodies'> => ({
  bodies: bodies.map(([body, ...regions]) => ({ body, area: 0, loops: 0, regions: regions.map((region) => ({ area: 0, outer: region.outer, holes: region.holes ?? [] })) })),
});
const FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
const outlineOf = (cut: Pick<SectionResult, 'bodies'>): Outline => {
  const { loops, bounds } = loopsOf(cut);
  return { loops, about: { bodies: cut.bodies.map((body) => body.body), loops: loops.length, circles: loops.filter((one) => one.circle).length, area: 0, ...(bounds ? { bounds } : {}), frame: FRAME, below: 0 } };
};
const onlyLoop = (spans: SectionSpan[]): OutlineLoop => loopsOf(sectionOf(['b', { outer: loop(...spans) }])).loops[0];

// The centre of the arc of a piece from `a` to `b`: on the left of the chord when it turns
// counter-clockwise.
function centerOf(a: Vec2, b: Vec2, piece: OutlinePiece): Vec2 {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const chord = Math.hypot(dx, dy);
  const radius = piece.radius as number;
  const apothem = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const side = Math.sign(piece.turn);
  return [(a[0] + b[0]) / 2 - (side * dy * apothem) / chord, (a[1] + b[1]) / 2 + (side * dx * apothem) / chord];
}
// Points along every piece of a loop, as a reader draws it: on its own arc between its corners.
function drawn(one: OutlineLoop, steps = 64): Vec2[] {
  const points: Vec2[] = [];
  one.pieces.forEach((piece, i) => {
    const next = one.pieces[(i + 1) % one.pieces.length].at;
    if (piece.turn === 0) {
      for (let k = 0; k < steps; k++) points.push([piece.at[0] + ((next[0] - piece.at[0]) * k) / steps, piece.at[1] + ((next[1] - piece.at[1]) * k) / steps]);
      return;
    }
    const center = centerOf(piece.at, next, piece);
    const from = Math.atan2(piece.at[1] - center[1], piece.at[0] - center[0]);
    const radius = Math.hypot(piece.at[0] - center[0], piece.at[1] - center[1]);
    for (let k = 0; k <= steps; k++) points.push([center[0] + radius * Math.cos(from + (piece.turn * k) / steps), center[1] + radius * Math.sin(from + (piece.turn * k) / steps)]);
  });
  return points;
}
const polar = (center: Vec2, radius: number, angle: number): Vec2 => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
// The arc pieces of a loop, with the corner each ends at.
const arcsOf = (one: OutlineLoop): { piece: OutlinePiece; next: Vec2 }[] => one.pieces.map((piece, i) => ({ piece, next: one.pieces[(i + 1) % one.pieces.length].at })).filter(({ piece }) => piece.turn !== 0);

describe('the pieces of a loop', () => {
  it('a whole circle is one circle with the centre and radius of its surface, either way round', () => {
    const { loops, bounds } = loopsOf(sectionOf(['b', { outer: loop(line([-10, -10], [10, -10]), line([10, -10], [10, 10]), line([10, 10], [-10, 10]), line([-10, 10], [-10, -10])), holes: [circleLoop([2, 3], 1.5, -2 * Math.PI)] }]));
    expect(loops[1]).toEqual({ body: 'b', hole: true, circle: { center: [2, 3], radius: 1.5 }, pieces: [] });
    expect(loops[0]).toEqual({ body: 'b', hole: false, pieces: [[-10, -10], [10, -10], [10, 10], [-10, 10]].map((at) => ({ at, turn: 0 })) });
    expect(bounds).toEqual({ min: [-10, -10], max: [10, 10] });
    expect(loopsOf(sectionOf(['b', { outer: circleLoop([1, 1], 2) }])).bounds).toEqual({ min: [-1, -1], max: [3, 3] });
  });

  it('the number of pieces: never one, a quarter turn at most, and a sweep of whole quarters give or take its last digit gets no extra piece', () => {
    expect([0.01, 1, QUARTER, QUARTER * (1 + 1e-12), Math.PI * (1 + 1e-6), Math.PI, Math.PI + 1e-12, -Math.PI, 4.37, 3 * QUARTER, 6.2].map(piecesOfArc)).toEqual([2, 2, 2, 2, 3, 2, 2, 2, 3, 3, 4]);
  });

  it('an arc of a few degrees, a quarter, a half and almost a whole turn: the corners between on the circle, the turn of a piece from its corners and radius', () => {
    const center: Vec2 = [3, -2];
    const radius = 7;
    for (const [sweep, count] of [[0.1, 2], [QUARTER, 2], [Math.PI, 2], [-Math.PI, 2], [4.37, 3], [6.2, 4], [-6.2, 4]] as const) {
      const start = 0.4;
      const from = polar(center, radius, start);
      const to = polar(center, radius, start + sweep);
      // closed by a straight piece back from the end of the arc
      const one = onlyLoop([arc(from, to, center, radius, sweep), line(to, from)]);
      const arcs = arcsOf(one);
      expect(arcs.length, String(sweep)).toBe(count);
      expect(one.pieces[0].at).toEqual(from);
      expect(arcs[count - 1].next).toEqual(to);
      arcs.forEach(({ piece, next }, k) => {
        expect(piece.radius).toBe(radius);
        expect(Math.sign(piece.turn)).toBe(Math.sign(sweep));
        expect(piece.turn).toBeCloseTo(sweep / count, 12);
        expect(Math.abs(piece.turn)).toBeLessThanOrEqual(QUARTER * (1 + TURN_ALLOWANCE));
        if (k < count - 1) {
          expect(Math.hypot(next[0] - center[0], next[1] - center[1])).toBeCloseTo(radius, 12);
          expect(next[0]).toBeCloseTo(polar(center, radius, start + ((k + 1) * sweep) / count)[0], 12);
        }
        // the centre of each piece is the centre of the surface
        const own = centerOf(piece.at, next, piece);
        expect(Math.hypot(own[0] - center[0], own[1] - center[1])).toBeLessThan(1e-9);
      });
    }
  });

  it('the case of the review: a quarter turn of radius 5.3 with both ends 0.0097 inside its circle stays within that of the circle everywhere', () => {
    const [radius, inside] = [5.3, 0.0097];
    const from = polar([0, 0], radius - inside, 0);
    const to = polar([0, 0], radius - inside, QUARTER);
    const one = onlyLoop([arc(from, to, [0, 0], radius, QUARTER), line(to, [0, 0]), line([0, 0], from)]);
    expect(arcsOf(one).length).toBe(2);
    const worst = Math.max(...drawn({ ...one, pieces: one.pieces.slice(0, 3) }).slice(0, 129).map((p) => Math.abs(Math.hypot(p[0], p[1]) - radius)));
    expect(worst).toBeLessThanOrEqual(inside * (1 + 1e-9));
    expect(worst).toBeGreaterThan(inside * 0.999); // reached at the corners themselves
  });

  it('a half turn of radius 5.3 between ends a float32 puts outside the circle: two pieces, each within the allowance of a quarter turn', () => {
    const radius = 5.3;
    const from: Vec2 = [Math.fround(5.3), 0];
    const to: Vec2 = [-Math.fround(5.3), 0];
    expect(Math.fround(5.3)).toBeGreaterThan(5.3);
    const one = onlyLoop([arc(from, to, [0, 0], radius, Math.PI), line(to, from)]);
    const arcs = arcsOf(one);
    expect(arcs.length).toBe(2);
    expect(Math.max(...arcs.map(({ piece }) => piece.turn))).toBeGreaterThan(QUARTER); // the turn of an end piece comes out a hair over
    for (const { piece } of arcs) expect(piece.turn).toBeLessThanOrEqual(QUARTER * (1 + TURN_ALLOWANCE));
  });

  it('random spans: no piece leaves its circle by more than the larger end error (pieces.py of the design)', () => {
    let seed = 7;
    const random = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const radius = 0.1 * 10000 ** random();
      const sweep = (0.05 + 6.18 * random()) * (random() < 0.5 ? -1 : 1);
      const start = 2 * Math.PI * random();
      const errors = [0.01 * random(), 0.01 * random()].map((error) => Math.min(error, radius / 20));
      const from = polar([0, 0], radius - errors[0], start);
      const to = polar([0, 0], radius - errors[1], start + sweep);
      const one = onlyLoop([arc(from, to, [0, 0], radius, sweep), line(to, from)]);
      const points = drawn({ ...one, pieces: one.pieces }, 120).slice(0, -120); // the arc pieces, not the closing line
      const off = Math.max(...points.map((p) => Math.abs(Math.hypot(p[0], p[1]) - radius)));
      worst = Math.max(worst, off / Math.max(...errors, 1e-12));
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('a curve is straight pieces through its points; a curve that is a whole loop lists its corners once', () => {
    const points: Vec2[] = [[0, 0], [1, 0.2], [2, 0.1], [3, 1]];
    const one = onlyLoop([{ kind: 'curve', face: FACE, from: [0, 0], to: [3, 1], count: 4, length: 0, points }, line([3, 1], [0, 0])]);
    expect(one.pieces).toEqual([...points.slice(0, 3).map((at) => ({ at, turn: 0 })), { at: [3, 1], turn: 0 }]);
    const whole = onlyLoop([{ kind: 'curve', face: FACE, from: [0, 0], to: [0, 0], count: 3, length: 0, points: [[0, 0], [1, 0], [0, 1]] }]);
    expect(whole.pieces.map((piece) => piece.at)).toEqual([[0, 0], [1, 0], [0, 1]]);
  });

  it('a circle of two faces is a loop of arcs with the right radius, not a circle', () => {
    const one = onlyLoop([arc([2, 0], [-2, 0], [0, 0], 2, Math.PI), arc([-2, 0], [2, 0], [0, 0], 2, Math.PI)]);
    expect(one.circle).toBeUndefined();
    expect(one.pieces.length).toBe(4);
    expect(one.pieces.every((piece) => piece.radius === 2)).toBe(true);
  });

  it('the box: an arc that bulges past its corners reaches its circle there, a piece that does not reach a quarter does not', () => {
    // a half disc above the x axis: the top of the circle is not a corner of the mesh
    const top = loopsOf(sectionOf(['b', { outer: loop(arc([1, 0], [-1, 0], [0, 0], 1, Math.PI), line([-1, 0], [1, 0])) }]));
    expect(top.bounds?.min).toEqual([-1, 0]);
    expect(top.bounds?.max[0]).toBe(1);
    expect(top.bounds?.max[1]).toBeCloseTo(1, 12);
    // clockwise round the bottom: the hole of a region runs that way
    const bottom = loopsOf(sectionOf(['b', { outer: loop(arc([1, 0], [-1, 0], [0, 0], 1, -Math.PI), line([-1, 0], [1, 0])) }]));
    expect(bottom.bounds?.min[1]).toBeCloseTo(-1, 12);
    expect(bottom.bounds?.max[1]).toBeCloseTo(0, 12);
    // a short arc between 10° and 30°: its box is that of its corners
    const short = loopsOf(sectionOf(['b', { outer: loop(arc(polar([0, 0], 1, 0.17), polar([0, 0], 1, 0.52), [0, 0], 1, 0.35), line(polar([0, 0], 1, 0.52), [0, 0]), line([0, 0], polar([0, 0], 1, 0.17))) }]));
    expect(short.bounds?.max[0]).toBeCloseTo(Math.cos(0.17), 12);
    expect(short.bounds?.max[1]).toBeCloseTo(Math.sin(0.52), 12);
  });
});

// A square 20 × 20 with a round hole, and a slot (a rectangle 30 × 10 with a half disc on each end).
const SQUARE = sectionOf(['plate', { outer: loop(line([0, 0], [20, 0]), line([20, 0], [20, 20]), line([20, 20], [0, 20]), line([0, 20], [0, 0])), holes: [circleLoop([10, 10], 2.5, -2 * Math.PI)] }]);
const SLOT = sectionOf(['slot', { outer: loop(line([0, -5], [30, -5]), arc([30, -5], [30, 5], [30, 0], 5, Math.PI), line([30, 5], [0, 5]), arc([0, 5], [0, -5], [0, 0], 5, Math.PI)) }]);
const dxfLines = (outline: Outline): string[] => dxfText(outline).split('\r\n');
const bulges = (text: string): number[] => text.split('\r\n').flatMap((value, i, lines) => (value === '42' && i % 2 === 0 ? [Number(lines[i + 1])] : []));

describe('the DXF and the SVG of an outline', () => {
  it('a square with a round hole, both files whole', () => {
    const outline = outlineOf(SQUARE);
    expect(dxfText(outline)).toBe(
      [
        ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC'],
        ...['0', 'SECTION', '2', 'ENTITIES'],
        ...['0', 'POLYLINE', '8', 'OUTER', '66', '1', '10', '0', '20', '0', '30', '0', '70', '1'],
        ...[[0, 0], [20, 0], [20, 20], [0, 20]].flatMap(([x, y]) => ['0', 'VERTEX', '8', 'OUTER', '10', String(x), '20', String(y), '30', '0']),
        ...['0', 'SEQEND', '8', 'OUTER'],
        ...['0', 'CIRCLE', '8', 'HOLES', '10', '10', '20', '10', '30', '0', '40', '2.5'],
        ...['0', 'ENDSEC', '0', 'EOF', ''],
      ].join('\r\n'),
    );
    expect(svgText(outline, (body) => `${body} <A&B>`)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="22mm" height="22mm" viewBox="-1 -21 22 22">',
        '<g fill="none" stroke="#000000" stroke-width="0.1">',
        '<g><title>plate &lt;A&amp;B&gt;</title>',
        '<path class="outer" d="M 0 0 L 20 0 L 20 -20 L 0 -20 Z"/>',
        '<circle class="hole" cx="10" cy="-10" r="2.5"/>',
        '</g>',
        '</g>',
        '</svg>',
        '',
      ].join('\n'),
    );
  });

  it('a slot: two half turns, each in two pieces with the bulge of a quarter turn and the radius of its surface', () => {
    const outline = outlineOf(SLOT);
    const lines = dxfLines(outline);
    const vertices = lines.flatMap((value, i) => (value === 'VERTEX' ? [lines.slice(i + 3, i + 9 + (lines[i + 9] === '42' ? 2 : 0)).filter((_, k) => k % 2 === 1)] : []));
    expect(vertices).toEqual([
      ['0', '-5', '0'],
      ['30', '-5', '0', '0.414213562373'],
      ['35', '0', '0', '0.414213562373'],
      ['30', '5', '0'],
      ['0', '5', '0', '0.414213562373'],
      ['-5', '0', '0', '0.414213562373'],
    ]);
    expect(svgText(outline, (body) => body)).toContain('<path class="outer" d="M 0 5 L 30 5 A 5 5 0 0 0 35 0 A 5 5 0 0 0 30 -5 L 0 -5 A 5 5 0 0 0 -5 0 A 5 5 0 0 0 0 5 Z"/>');
    expect(svgText(outline, (body) => body)).toContain('width="42mm" height="12mm" viewBox="-6 -6 42 12"');
    expect(outline.about.bounds?.min[0]).toBeCloseTo(-5, 12);
    expect(outline.about.bounds?.max[0]).toBeCloseTo(35, 12);
  });

  it('the bulge and the sweep flag for both directions; the radius a bulge implies is the radius the SVG states', () => {
    const [radius, inside] = [5.3, 0.0097];
    for (const sign of [1, -1]) {
      const from = polar([0, 0], radius - inside, 0);
      const to = polar([0, 0], radius - inside, sign * 2);
      const outline = outlineOf(sectionOf(['b', { outer: loop(arc(from, to, [0, 0], radius, sign * 2), line(to, [0, 0]), line([0, 0], from)) }]));
      const found = bulges(dxfText(outline));
      expect(found.length).toBe(2);
      expect(found.every((bulge) => Math.sign(bulge) === sign)).toBe(true);
      const flags = [...svgText(outline, (body) => body).matchAll(/A ([\d.]+) [\d.]+ 0 0 ([01]) /g)];
      expect(flags.map((match) => match[2])).toEqual(sign > 0 ? ['0', '0'] : ['1', '1']);
      // the radius of an arc from its chord and its bulge: chord · (1 + b²) / (4 |b|)
      arcsOf(outline.loops[0]).forEach(({ piece, next }, k) => {
        const chord = Math.hypot(next[0] - piece.at[0], next[1] - piece.at[1]);
        const implied = (chord * (1 + found[k] ** 2)) / (4 * Math.abs(found[k]));
        expect(Math.abs(implied - Number(flags[k][1]))).toBeLessThan(1e-9);
      });
    }
  });

  it('a drawing with nothing in it: the header and an empty ENTITIES section; the margin about the origin', () => {
    const outline = outlineOf(sectionOf());
    expect(outline.about.bounds).toBeUndefined();
    expect(dxfText(outline)).toBe(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n'));
    expect(svgText(outline, (body) => body)).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="2mm" height="2mm" viewBox="-1 -1 2 2">\n<g fill="none" stroke="#000000" stroke-width="0.1">\n</g>\n</svg>\n');
  });
});
