// Probe I: the reader of DXF after the reviews of the design. What is refused (`unreadable`,
// `tooLarge`), what is left out and listed (`skipped`), the extrusion direction, the units, the
// splines and the limits checked while reading. Only the reader (`./dxf`): no engine, no weld.
import { describe, expect, it } from 'vitest';
import { bezierAt, bsplineBeziers, splineBeziers } from '../../../../packages/engine/src/spline';
import { DXF_MAX_CHARACTERS, DXF_MAX_CONTROL, DXF_MAX_CURVES, DXF_MAX_SPLINE_POINTS, readDxf, splineCurves } from './dxf';
import type { ImportedCurve, Vec2 } from './proto';

type G = (code: number, value: string | number) => void;
// A file: the header variables, then the entities written by `build`, then EOF.
function dxf(build: (g: G) => void, header: Record<string, number> = { $INSUNITS: 4 }, end = true): string {
  const out: string[] = [];
  const g: G = (code, value) => void out.push(String(code), String(value));
  g(0, 'SECTION');
  g(2, 'HEADER');
  for (const [name, value] of Object.entries(header)) {
    g(9, name);
    g(70, value);
  }
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  build(g);
  g(0, 'ENDSEC');
  if (end) g(0, 'EOF');
  return `${out.join('\n')}\n`;
}
const line = (g: G, ax: number, ay: number, bx: number, by: number, more: [number, number][] = []): void => {
  g(0, 'LINE');
  g(8, '0');
  g(10, ax);
  g(20, ay);
  g(11, bx);
  g(21, by);
  for (const [code, value] of more) g(code, value);
};
const spline = (g: G, degree: number, knots: (number | string)[], control: Vec2[], more: [number, number | string][] = [], flags = 8): void => {
  g(0, 'SPLINE');
  g(8, '0');
  g(70, flags);
  g(71, degree);
  for (const [code, value] of more) g(code, value);
  for (const k of knots) g(40, k);
  for (const [x, y] of control) {
    g(10, x);
    g(20, y);
  }
};
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return 'read';
};
const kinds = (curves: { curve: ImportedCurve }[]): string => curves.map((c) => (c.curve.type === 'spline' ? `spline${c.curve.points.length}` : c.curve.type)).join(' ');
const far = (p: Vec2, q: Vec2): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
const endsOf = (curve: ImportedCurve): Vec2[] => (curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : curve.type === 'spline' ? [curve.points[0], curve.points[curve.points.length - 1]] : []);
const CONTROL7: Vec2[] = [[0, 0], [2, 3], [5, 4], [8, 1], [11, -2], [14, 1], [16, 0]];

describe('probe I: the reader of DXF, hardened', () => {
  it('I1: groups: what is refused and where the reading stops', () => {
    const good = dxf((g) => line(g, 0, 0, 10, 0));
    const blank = readDxf(`${good}\n\n   \n`);
    const after = readDxf(`${good}this is not a group\nand neither is this\n\n`);
    const badCode = refusal(() => readDxf(good.replace('\n10\n0\n', '\nten\n0\n')));
    const odd = refusal(() => readDxf(dxf((g) => line(g, 0, 0, 10, 0), { $INSUNITS: 4 }, false) + '0'));
    const cut = refusal(() => readDxf(dxf((g) => line(g, 0, 0, 10, 0), { $INSUNITS: 4 }, false)));
    const halfway = refusal(() => readDxf(good.slice(0, good.indexOf('\n11\n') + 1)));
    const empty = refusal(() => readDxf(good.replace('\n11\n10\n', '\n11\n\n')));
    const word = refusal(() => readDxf(good.replace('\n11\n10\n', '\n11\nwide\n')));
    const nothing = refusal(() => readDxf('hello\nworld\n'));
    console.log('I1 blank lines after EOF:', kinds(blank.curves), '| text after EOF:', kinds(after.curves));
    console.log('I1 a code that is no number:', badCode);
    console.log('I1 a code without its value:', odd);
    console.log('I1 no EOF:', cut, '| cut in an entity:', halfway);
    console.log('I1 an empty number:', empty, '| a word:', word);
    console.log('I1 not a DXF:', nothing);
    expect(blank.curves.length).toBe(1);
    expect(after.curves.length).toBe(1);
    for (const message of [badCode, odd, cut, halfway, empty, word, nothing]) expect(message).toMatch(/^unreadable/);
    expect(cut).toContain('cut short');
    expect(empty).toContain('line');
  });

  it('I2: structure: malformed is refused, unsupported is listed', () => {
    const noEndsec = refusal(() => readDxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '1', '21', '0', '0', 'EOF', ''].join('\n')));
    const vertex = (g: G, x: number, y: number): void => {
      g(0, 'VERTEX');
      g(8, '0');
      g(10, x);
      g(20, y);
    };
    const noSeqend = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'POLYLINE');
          g(8, '0');
          g(70, 1);
          vertex(g, 0, 0);
          vertex(g, 5, 0);
          line(g, 0, 0, 1, 1);
        }),
      ),
    );
    const noSeqendAtEnd = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'POLYLINE');
          g(8, '0');
          vertex(g, 0, 0);
          vertex(g, 5, 0);
        }),
      ),
    );
    const stray = refusal(() => readDxf(dxf((g) => vertex(g, 0, 0))));
    const noEnd = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'LINE');
          g(8, '0');
          g(10, 0);
          g(20, 0);
        }),
      ),
    );
    const noRadius = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'CIRCLE');
          g(8, '0');
          g(10, 0);
          g(20, 0);
        }),
      ),
    );
    const noAngle = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'ARC');
          g(8, '0');
          g(10, 0);
          g(20, 0);
          g(40, 2);
          g(50, 0);
        }),
      ),
    );
    const listed = readDxf(
      dxf((g) => {
        line(g, 0, 0, 10, 0);
        g(0, 'ELLIPSE');
        g(8, '0');
        g(0, 'INSERT');
        g(8, '0');
        g(66, 1);
        g(0, 'ATTRIB');
        g(8, '0');
        g(0, 'SEQEND');
        g(0, 'TEXT');
        g(8, 'notes');
        g(1, '');
        // a polyline of one vertex is no segment, not an error
        g(0, 'POLYLINE');
        g(8, '0');
        vertex(g, 3, 3);
        g(0, 'SEQEND');
      }),
    );
    const bare = readDxf(['0', 'LINE', '8', 'a', '10', '0', '20', '0', '11', '1', '21', '0', '0', 'EOF'].join('\r\n'));
    console.log('I2 SECTION without ENDSEC:', noEndsec);
    console.log('I2 POLYLINE without SEQEND:', noSeqend, '|', noSeqendAtEnd);
    console.log('I2 VERTEX outside:', stray);
    console.log('I2 LINE without 11:', noEnd, '| CIRCLE without 40:', noRadius, '| ARC without 51:', noAngle);
    console.log('I2 unsupported, complete:', kinds(listed.curves), JSON.stringify(listed.about.skipped), 'layers', JSON.stringify(listed.about.layers));
    console.log('I2 a bare list of entities:', kinds(bare.curves), JSON.stringify(bare.about.layers), bare.about.unitFrom);
    for (const message of [noEndsec, noSeqend, noSeqendAtEnd, stray, noEnd, noRadius, noAngle]) expect(message).toMatch(/^unreadable/);
    expect(noEnd).toContain('LINE');
    expect(listed.curves.length).toBe(1);
    expect(listed.about.skipped).toEqual({ ELLIPSE: 1, INSERT: 1, ATTRIB: 1, TEXT: 1 });
    expect(bare.curves.length).toBe(1);
  });

  it('I3: the extrusion direction', () => {
    // In world coordinates: A (20, 0), B (30, 0), C (30, 5), a half circle about (25, 5) from C to
    // D (20, 5), and the line D to A. The polyline A, B, C (its second segment bulged outwards by
    // 0.2) and the arc are written from below (0, 0, −1), so their x and the bulge are negated in
    // the file; the line is in world coordinates and carries the direction too.
    const below: [number, number][] = [[210, 0], [220, 0], [230, -1]];
    const read = readDxf(
      dxf((g) => {
        g(0, 'POLYLINE');
        g(8, '0');
        g(66, 1);
        g(70, 0);
        for (const [code, value] of below) g(code, value);
        for (const [x, y, bulge] of [[-20, 0, 0], [-30, 0, -0.2], [-30, 5, 0]]) {
          g(0, 'VERTEX');
          g(8, '0');
          g(10, x);
          g(20, y);
          g(42, bulge);
        }
        g(0, 'SEQEND');
        g(0, 'ARC');
        g(8, '0');
        g(10, -25);
        g(20, 5);
        g(40, 5);
        g(50, 0);
        g(51, 180);
        for (const [code, value] of below) g(code, value);
        line(g, 20, 5, 20, 0, below);
      }),
    );
    const ends = read.curves.flatMap((c, i) => endsOf(c.curve).map((at) => ({ at, i })));
    const partners = ends.map((e) => ends.filter((o) => o.i !== e.i && far(o.at, e.at) < 1e-9).length);
    const bulged = read.curves[1].curve;
    console.log('I3 from below:', kinds(read.curves), 'partners of each end', partners.join(''), 'the bulged segment', JSON.stringify(bulged));
    expect(read.curves.length).toBe(4);
    expect(partners.every((n) => n === 1)).toBe(true);
    expect(bulged.type === 'arc' && far(bulged.center, [24, 2.5]) < 1e-9 && far(bulged.start, [30, 0]) < 1e-9 && far(bulged.end, [30, 5]) < 1e-9).toBe(true);
    expect(read.curves[3].curve).toEqual({ type: 'line', a: [20, 5], b: [20, 0] });
    // an arc that is not symmetric: in the world from 30° to 100° about (5, 5), radius 2
    const arc = readDxf(
      dxf((g) => {
        g(0, 'ARC');
        g(8, '0');
        g(10, -5);
        g(20, 5);
        g(40, 2);
        g(50, 80);
        g(51, 150);
        g(230, -1);
        g(0, 'LWPOLYLINE');
        g(8, '0');
        g(90, 2);
        g(70, 0);
        g(230, -1);
        g(10, -1);
        g(20, 0);
        g(42, 1);
        g(10, -3);
        g(20, 0);
      }),
    ).curves;
    const a = arc[0].curve;
    const rad = (d: number): Vec2 => [5 + 2 * Math.cos((d * Math.PI) / 180), 5 + 2 * Math.sin((d * Math.PI) / 180)];
    console.log('I3 a mirrored arc:', JSON.stringify(a), '| a mirrored LWPOLYLINE with a bulge of 1:', JSON.stringify(arc[1].curve));
    expect(a.type === 'arc' && far(a.center, [5, 5]) < 1e-12 && far(a.start, rad(30)) < 1e-12 && far(a.end, rad(100)) < 1e-12).toBe(true);
    // in the file from (−1, 0) to (−3, 0) with the bulge 1; in the world from (1, 0) to (3, 0), clockwise
    const b = arc[1].curve;
    expect(b.type === 'arc' && far(b.center, [2, 0]) < 1e-12 && far(b.start, [3, 0]) < 1e-12 && far(b.end, [1, 0]) < 1e-12).toBe(true);
    const tilted = readDxf(
      dxf((g) => {
        g(0, 'CIRCLE');
        g(8, '0');
        g(10, 0);
        g(20, 0);
        g(40, 1);
        g(210, 0.6);
        g(220, 0);
        g(230, 0.8);
        g(0, 'ARC');
        g(8, '0');
        g(10, 0);
        g(20, 0);
        g(40, 1);
        g(50, 0);
        g(51, 90);
        g(220, 1);
        g(230, 0);
        g(0, 'POLYLINE');
        g(8, '0');
        g(210, 1);
        g(230, 0);
        g(0, 'VERTEX');
        g(8, '0');
        g(10, 0);
        g(20, 0);
        g(0, 'VERTEX');
        g(8, '0');
        g(10, 1);
        g(20, 0);
        g(0, 'SEQEND');
        line(g, 0, 0, 5, 0, [[210, 1], [220, 0], [230, 0]]);
      }),
    );
    console.log('I3 tilted:', kinds(tilted.curves), JSON.stringify(tilted.about.skipped));
    expect(kinds(tilted.curves)).toBe('line');
    expect(tilted.about.skipped).toEqual({ 'CIRCLE (tilted extrusion)': 1, 'ARC (tilted extrusion)': 1, 'POLYLINE (tilted extrusion)': 1 });
  });

  it('I4: a spline-fit POLYLINE: the frame is passed over', () => {
    const read = readDxf(
      dxf((g) => {
        g(0, 'POLYLINE');
        g(8, '0');
        g(70, 4);
        const vertex = (x: number, y: number, flag: number): void => {
          g(0, 'VERTEX');
          g(8, '0');
          g(10, x);
          g(20, y);
          g(70, flag);
        };
        for (const [x, y] of [[0, 0], [3, 6], [7, 6], [10, 0]]) vertex(x, y, 16); // the frame
        for (const [x, y] of [[0, 0], [2.4, 3.3], [5, 4.5], [7.6, 3.3], [10, 0]]) vertex(x, y, 8); // the curve
        g(0, 'SEQEND');
        g(0, 'POLYLINE');
        g(8, '0');
        g(70, 8);
        vertex(0, 0, 32);
        vertex(1, 1, 32);
        g(0, 'SEQEND');
      }),
    );
    console.log('I4', kinds(read.curves), JSON.stringify(read.about.skipped), 'first', JSON.stringify(read.curves[0].curve), 'last', JSON.stringify(read.curves[3]?.curve));
    expect(kinds(read.curves)).toBe('line line line line');
    expect(read.curves[0].curve).toEqual({ type: 'line', a: [0, 0], b: [2.4, 3.3] });
    expect(read.about.skipped).toEqual({ 'POLYLINE (3D or mesh)': 1 });
  });

  it('I5: an ARC of a whole turn is a circle', () => {
    const arc = (from: number, to: number): string =>
      kinds(
        readDxf(
          dxf((g) => {
            g(0, 'ARC');
            g(8, '0');
            g(10, 3);
            g(20, 4);
            g(40, 1.6);
            g(50, from);
            g(51, to);
          }),
        ).curves,
      );
    const results = { '0..360': arc(0, 360), '10..370': arc(10, 370), '45..45': arc(45, 45), '0..359.9999999999': arc(0, 359.9999999999), '0..359.9': arc(0, 359.9), '350..10': arc(350, 10) };
    console.log('I5', JSON.stringify(results));
    expect(results).toEqual({ '0..360': 'circle', '10..370': 'circle', '45..45': 'circle', '0..359.9999999999': 'circle', '0..359.9': 'arc', '350..10': 'arc' });
  });

  it('I6: SPLINE: checked before it is converted', () => {
    const one = (degree: number, knots: (number | string)[], control: Vec2[], more: [number, number | string][] = [], flags = 8) => readDxf(dxf((g) => spline(g, degree, knots, control, more, flags)));
    const said = (degree: number, knots: (number | string)[], control: Vec2[], more: [number, number | string][] = [], flags = 8): string => {
      const message = refusal(() => one(degree, knots, control, more, flags));
      if (message !== 'read') return message;
      const read = one(degree, knots, control, more, flags);
      return `${kinds(read.curves) || 'nothing'} ${JSON.stringify(read.about.skipped)}`;
    };
    const four: Vec2[] = [[0, 0], [1, 2], [3, 2], [4, 0]];
    const six: Vec2[] = [[4, 0], [5, 1], [3, 2], [2, 3], [1, 2], [0, 0]];
    const cases = {
      fitOnly: said(3, [], [], [[11, 0], [21, 0], [11, 5], [21, 5]]),
      rationalFlag: said(2, [], [], [], 12),
      rationalWeights: said(3, [0, 0, 0, 0, 1, 1, 1, 1], four, [[41, 1], [41, 2], [41, 1], [41, 1]]),
      equalWeights: said(3, [0, 0, 0, 0, 1, 1, 1, 1], four, [[41, 1], [41, 1], [41, 1], [41, 1]]),
      degree5: said(5, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], [...six]),
      knotCount: said(3, [0, 0, 0, 0, 1, 1, 1], four),
      tooFewPoints: said(3, [0, 0, 0, 0, 1, 1, 1], [[0, 0], [1, 1], [2, 0]]),
      knotWord: said(3, [0, 0, 0, 0, 'abc', 1, 1, 1], four),
      // codex's case: clamped at both ends, and .8 before .2 inside
      outOfOrder: said(3, [0, 0, 0, 0, 0.8, 0.2, 1, 1, 1, 1], six),
      unclamped: said(3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], six),
      noExtent: said(3, [2, 2, 2, 2, 2, 2, 2, 2], four),
      discontinuous: said(3, [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2], [[0, 0], [1, 2], [3, 2], [4, 0], [5, 0], [6, 2], [8, 2], [9, 0]]),
      unusedPoint: said(3, [0, 0, 0, 0, 0, 1, 1, 1, 1], [[9, 9], ...four]),
      // knots that differ in their last digits: one double knot, two pieces, none without extent
      lastDigits: said(3, [0, 0, 0, 0, 1, 1 + 1e-12, 2, 2, 2, 2], six),
      // a piece without extent (two control points of a polyline spline at one place) is read as it
      // is written: it takes its place in the order of the file and is left out after the IDs
      pieceWithoutExtent: said(1, [0, 0, 1, 2, 2], [[0, 0], [0, 0], [5, 0]]),
      degree1: said(1, [0, 0, 1, 3, 3], [[0, 0], [2, 1], [5, 0]]),
    };
    for (const [name, value] of Object.entries(cases)) console.log(`I6 ${name}:`, value);
    expect(cases.fitOnly).toContain('SPLINE (fit points only)');
    expect(cases.rationalFlag).toContain('SPLINE (rational)');
    expect(cases.rationalWeights).toContain('SPLINE (rational)');
    expect(cases.equalWeights).toMatch(/^spline4 /);
    expect(cases.degree5).toContain('SPLINE (degree 5)');
    for (const refused of [cases.knotCount, cases.tooFewPoints, cases.knotWord, cases.outOfOrder]) expect(refused).toMatch(/^unreadable/);
    expect(cases.outOfOrder).toContain('out of order');
    expect(cases.unclamped).toContain('SPLINE (periodic or unclamped)');
    expect(cases.noExtent).toContain('SPLINE (no extent)');
    expect(cases.discontinuous).toContain('SPLINE (discontinuous)');
    expect(cases.unusedPoint).toContain('SPLINE (discontinuous)');
    expect(cases.lastDigits).toBe('spline4 spline4 {}');
    expect(cases.pieceWithoutExtent).toBe('line line {}');
    expect(cases.degree1).toBe('line line {}');
    // what the engine's function does with the two cases when it is given them as they are
    const raw = bsplineBeziers(six, [0, 0, 0, 0, 1, 1 + 1e-12, 2, 2, 2, 2], 3);
    const polygon = (points: Vec2[]): number => points.slice(1).reduce((sum, q, i) => sum + far(points[i], q), 0);
    console.log('I6 without the merge of knots: pieces', raw.length, 'their polygons', raw.map((piece) => polygon(piece).toExponential(2)).join(' '));
    const unordered = bsplineBeziers(six, [0, 0, 0, 0, 0.8, 0.2, 1, 1, 1, 1], 3);
    console.log('I6 knots out of order given to bsplineBeziers:', unordered.length, 'pieces, finite', unordered.flat(2).every(Number.isFinite));
  });

  it('I6b: a uniform cubic is kept whole, another is its pieces', () => {
    const whole = (knots: number[]) => readDxf(dxf((g) => spline(g, 3, knots, CONTROL7))).curves;
    const uniform = whole([0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4]);
    const scaled = whole([0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1]);
    const uneven = whole([0, 0, 0, 0, 1, 2, 5, 6, 6, 6, 6]);
    console.log('I6b uniform:', kinds(uniform), '| scaled to 0..1:', kinds(scaled), '| uneven:', kinds(uneven));
    expect(kinds(uniform)).toBe('spline7');
    expect(kinds(scaled)).toBe('spline7');
    expect(kinds(uneven)).toBe('spline4 spline4 spline4 spline4');
    // The same curve: the pieces the engine makes of the kept spline (a spline of a sketch, D70)
    // against the pieces of the B-spline with the knots of the file.
    const mine = splineBeziers(CONTROL7);
    let worst = 0;
    for (const knots of [[0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4], [0, 0, 0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 1], [0, 0, 0, 0, 10, 20, 30, 40, 40, 40, 40]]) {
      const theirs = bsplineBeziers(CONTROL7, knots, 3);
      expect(theirs.length).toBe(mine.length);
      theirs.forEach((piece, i) => {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) worst = Math.max(worst, far(bezierAt(piece, t), bezierAt(mine[i], t)));
        piece.forEach((q, j) => (worst = Math.max(worst, far(q, mine[i][j]))));
      });
    }
    // and the uneven one is another curve than a spline of a sketch over the same points
    const other = bsplineBeziers(CONTROL7, [0, 0, 0, 0, 1, 2, 5, 6, 6, 6, 6], 3);
    const apart = Math.max(...other.map((piece, i) => far(bezierAt(piece, 0.5), bezierAt(mine[i], 0.5))));
    console.log('I6b the kept spline against the pieces of the file, furthest apart:', worst.toExponential(2), 'mm; the uneven one against a spline of the sketch:', apart.toFixed(3), 'mm');
    expect(worst).toBeLessThan(1e-12);
    expect(apart).toBeGreaterThan(0.01);
    // the limits of "whole": 4 and 64 control points; a quadratic of 3; a quadratic of 5 is pieces
    const many = (n: number): Vec2[] => Array.from({ length: n }, (_, i): Vec2 => [i, (i % 2) * 2]);
    const uniformKnots = (n: number, p: number): number[] => [...Array<number>(p + 1).fill(0), ...Array.from({ length: n - p - 1 }, (_, i) => i + 1), ...Array<number>(p + 1).fill(n - p)];
    const of = (n: number, p: number): string => {
      const made = splineCurves(many(n), uniformKnots(n, p), p);
      return 'skipped' in made ? made.skipped : `${made.curves.length} of ${made.curves[0].type === 'spline' ? made.curves[0].points.length : 2}`;
    };
    const sizes = { cubic4: of(4, 3), cubic64: of(64, 3), cubic65: of(65, 3), quadratic3: of(3, 2), quadratic5: of(5, 2) };
    console.log('I6b', JSON.stringify(sizes));
    expect(sizes).toEqual({ cubic4: '1 of 4', cubic64: '1 of 64', cubic65: '62 of 4', quadratic3: '1 of 3', quadratic5: '3 of 3' });
  });

  it('I7: units', () => {
    const one = (header: Record<string, number>, unit?: string) => readDxf(dxf((g) => line(g, 0, 0, 1000, 0), header), unit === undefined ? {} : { unit });
    const length = (header: Record<string, number>, unit?: string): string => {
      const read = one(header, unit);
      const c = read.curves[0].curve;
      return `${c.type === 'line' ? Number(c.b[0].toPrecision(12)) : '?'} mm (${read.about.unit}, ${read.about.unitFrom})`;
    };
    const table = Object.fromEntries([1, 2, 4, 5, 6, 8, 9, 10, 13, 14].map((code) => [code, length({ $INSUNITS: code })]));
    console.log('I7 $INSUNITS, a line of 1000 units:', JSON.stringify(table));
    const miles = refusal(() => one({ $INSUNITS: 3 }));
    console.log('I7 $INSUNITS 3:', miles, '| with the option:', length({ $INSUNITS: 3 }, 'mm'), '| option um:', length({ $INSUNITS: 4 }, 'um'), '| option dm:', length({}, 'dm'));
    const imperial = one({ $MEASUREMENT: 0 });
    const silent = one({ $INSUNITS: 0, $MEASUREMENT: 1 });
    const stated = one({ $INSUNITS: 1, $MEASUREMENT: 0 });
    console.log('I7 $MEASUREMENT 0 and no $INSUNITS:', imperial.about.unit, imperial.about.unitFrom, JSON.stringify(imperial.about.notes));
    console.log('I7 $INSUNITS 0, $MEASUREMENT 1:', silent.about.unit, silent.about.unitFrom, JSON.stringify(silent.about.notes), '| $INSUNITS 1:', JSON.stringify(stated.about.notes));
    const wrong = refusal(() => one({ $INSUNITS: 4 }, 'furlong'));
    console.log('I7 an option that is no unit:', wrong);
    expect(table[13]).toBe('1 mm (um, file)');
    expect(table[14]).toBe('100000 mm (dm, file)');
    expect(table[9]).toBe('25.4 mm (mil, file)');
    expect(miles).toMatch(/^unreadable.*option unit/);
    expect(imperial.about.unitFrom).toBe('default');
    expect(imperial.about.notes?.[0]).toContain('imperial');
    expect(silent.about.notes?.[0]).not.toContain('imperial');
    expect(stated.about.notes).toEqual([]);
    expect(wrong).toMatch(/^invalidArguments/);
  });

  it('I8: the limits, checked while reading', () => {
    const lines = (n: number): string => dxf((g) => Array.from({ length: n }, (_, i) => line(g, i, 0, i + 1, 1)));
    const time = <T>(run: () => T): [T, number] => {
      const start = performance.now();
      const result = run();
      return [result, performance.now() - start];
    };
    const [most, mostMs] = time(() => readDxf(lines(DXF_MAX_CURVES)).curves.length);
    const nine = lines(9000);
    const [tooMany, tooManyMs] = time(() => refusal(() => readDxf(nine)));
    const million = lines(150_000);
    const [far200, far200Ms] = time(() => refusal(() => readDxf(million)));
    const [otherLayer, otherMs] = time(() => readDxf(nine, { layers: ['none'] }).curves.length);
    const long = `${'9'.repeat(DXF_MAX_CHARACTERS)}\n0\nEOF\n`;
    const [tooLong, tooLongMs] = time(() => refusal(() => readDxf(long)));
    const bigSpline = refusal(() => readDxf(dxf((g) => spline(g, 3, [], Array.from({ length: DXF_MAX_SPLINE_POINTS + 1 }, (_, i): Vec2 => [i, 0])))));
    console.log('I8', DXF_MAX_CURVES, 'lines read:', most, `in ${mostMs.toFixed(1)} ms (${lines(DXF_MAX_CURVES).length} characters)`);
    console.log('I8 9000 lines:', tooMany, `in ${tooManyMs.toFixed(1)} ms (${nine.length} characters)`);
    console.log('I8 150,000 lines:', far200, `in ${far200Ms.toFixed(1)} ms (${million.length} characters)`);
    console.log('I8 9000 lines on a layer not asked for:', otherLayer, `curves in ${otherMs.toFixed(1)} ms`);
    console.log('I8 a text over the limit:', tooLong, `in ${tooLongMs.toFixed(2)} ms`);
    console.log('I8 a SPLINE of 2001 control points:', bigSpline);
    expect(most).toBe(DXF_MAX_CURVES);
    expect(tooMany).toMatch(/^tooLarge/);
    expect(far200).toMatch(/^tooLarge/);
    expect(otherLayer).toBe(0);
    expect(tooLong).toMatch(/^tooLarge/);
    expect(bigSpline).toMatch(/^tooLarge/);
  });

  it('I9: a z that is not 0 is noted', () => {
    const flat = readDxf(dxf((g) => line(g, 0, 0, 5, 0, [[30, 0], [31, 0]])));
    const lifted = readDxf(dxf((g) => line(g, 0, 0, 5, 0, [[30, 0], [31, 2.5]])));
    const elevated = readDxf(
      dxf((g) => {
        g(0, 'LWPOLYLINE');
        g(8, '0');
        g(38, 4);
        g(10, 0);
        g(20, 0);
        g(10, 5);
        g(20, 0);
      }),
    );
    console.log('I9 flat:', JSON.stringify(flat.about.notes), '| a line end at z 2.5:', JSON.stringify(lifted.about.notes), '| an elevation of 4:', kinds(elevated.curves), JSON.stringify(elevated.about.notes));
    expect(flat.about.notes).toEqual([]);
    expect(lifted.about.notes?.length).toBe(1);
    expect(lifted.curves[0].curve).toEqual({ type: 'line', a: [0, 0], b: [5, 0] });
    expect(elevated.about.notes?.length).toBe(1);
  });
  it('I10: comments, declared counts, paper space, the control points of splines, the layers by type', () => {
    // 1. comments (group 999) after `0 SECTION`, between `9 $INSUNITS` and its value, inside an entity
    const commented = ['999', 'written by a test', '0', 'SECTION', '999', 'the header', '2', 'HEADER', '9', '$INSUNITS', '999', 'inches', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '999', 'the entities', '2', 'ENTITIES', '0', 'LINE', '8', 'a', '10', '0', '999', 'between the groups of an entity', '20', '0', '11', '1', '21', '0', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
    const read = readDxf(commented);
    console.log('I10 comments:', kinds(read.curves), 'unit', read.about.unit, read.about.unitFrom, 'b', JSON.stringify((read.curves[0].curve as { b: Vec2 }).b), 'layers', JSON.stringify(read.about.layers));
    expect(read.about.unit).toBe('in');
    expect((read.curves[0].curve as { b: Vec2 }).b[0]).toBeCloseTo(25.4, 12);

    // 2. declared counts
    const lw = (declared: number | undefined, n: number, closed = true) =>
      dxf((g) => {
        g(0, 'LWPOLYLINE');
        g(8, '0');
        if (declared !== undefined) g(90, declared);
        g(70, closed ? 1 : 0);
        for (const [x, y] of ([[0, 0], [10, 0], [10, 10], [0, 10]] as Vec2[]).slice(0, n)) {
          g(10, x);
          g(20, y);
        }
      });
    const fourOfThree = refusal(() => readDxf(lw(4, 3)));
    const fourOfFour = kinds(readDxf(lw(4, 4)).curves);
    const undeclared = kinds(readDxf(lw(undefined, 3)).curves);
    const four: Vec2[] = [[0, 0], [1, 2], [3, 2], [4, 0]];
    const clamped = [0, 0, 0, 0, 1, 1, 1, 1];
    const counts = (more: [number, number][], knots = clamped, control = four): string => {
      const text = dxf((g) => spline(g, 3, knots, control, more));
      const message = refusal(() => readDxf(text));
      return message === 'read' ? kinds(readDxf(text).curves) : message;
    };
    const splineCounts = { right: counts([[72, 8], [73, 4], [74, 0]]), knots: counts([[72, 9], [73, 4]]), control: counts([[72, 8], [73, 5]]), fit: counts([[72, 8], [73, 4], [74, 2]]), none: counts([]) };
    console.log('I10 LWPOLYLINE declaring 4 vertices and holding 3:', fourOfThree, '| holding 4:', fourOfFour, '| declaring nothing, 3 vertices:', undeclared);
    for (const [name, value] of Object.entries(splineCounts)) console.log(`I10 SPLINE counts, ${name}:`, value);
    expect(fourOfThree).toMatch(/^unreadable/);
    expect(fourOfThree).toContain('declares 4');
    expect(fourOfFour).toBe('line line line line');
    expect(undeclared).toBe('line line line');
    expect(splineCounts.right).toBe('spline4');
    expect(splineCounts.none).toBe('spline4');
    for (const refused of [splineCounts.knots, splineCounts.control, splineCounts.fit]) expect(refused).toMatch(/^unreadable/);

    // 3. paper space
    const paper = readDxf(
      dxf((g) => {
        line(g, 0, 0, 5, 0);
        g(0, 'CIRCLE');
        g(8, '0');
        g(67, 1);
        g(10, 1);
        g(20, 1);
        g(40, 2);
        g(0, 'POLYLINE');
        g(8, 'frame');
        g(67, 1);
        g(70, 1);
        for (const [x, y] of [[0, 0], [200, 0], [200, 100]]) {
          g(0, 'VERTEX');
          g(8, 'frame');
          g(10, x);
          g(20, y);
        }
        g(0, 'SEQEND');
        g(0, 'CIRCLE');
        g(8, '0');
        g(67, 0);
        g(10, 1);
        g(20, 1);
        g(40, 2);
      }),
    );
    console.log('I10 paper space:', kinds(paper.curves), JSON.stringify(paper.about.skipped), 'layers', JSON.stringify(paper.about.layers));
    expect(kinds(paper.curves)).toBe('line circle');
    expect(paper.about.skipped).toEqual({ 'CIRCLE (paper space)': 1, 'POLYLINE (paper space)': 1 });
    expect(paper.about.layers).toEqual({ 0: { LINE: 1, CIRCLE: 2 }, frame: { POLYLINE: 1 } });
    // paper space does not count toward the limit of curves
    const papers = readDxf(dxf((g) => Array.from({ length: 9000 }, (_, i) => line(g, i, 0, i + 1, 1, [[67, 1]]))));
    expect(papers.curves.length).toBe(0);
    expect(papers.about.skipped).toEqual({ 'LINE (paper space)': 9000 });

    // 4. the control points of splines: per entity, and of all the curves read
    const time = <T>(run: () => T): [T, number] => {
      const start = performance.now();
      const result = run();
      return [result, performance.now() - start];
    };
    const wavy = (n: number, y0 = 0): Vec2[] => Array.from({ length: n }, (_, i): Vec2 => [i, y0 + (i % 2) * 2]);
    // clamped knots that are not even: the second inner span is twice as long
    const uneven = (n: number): number[] => [0, 0, 0, 0, ...Array.from({ length: n - 4 }, (_, i) => (i === 0 ? 1 : i + 2)), n - 1, n - 1, n - 1, n - 1];
    const even = (n: number): number[] => [0, 0, 0, 0, ...Array.from({ length: n - 4 }, (_, i) => i + 1), n - 3, n - 3, n - 3, n - 3];
    const pieces = (count: number) => dxf((g) => Array.from({ length: count }, (_, k) => spline(g, 3, uneven(500), wavy(500, 10 * k))));
    const wholes = (count: number) => dxf((g) => Array.from({ length: count }, (_, k) => spline(g, 3, even(64), wavy(64, 10 * k))));
    const controlOf = (curves: { curve: ImportedCurve }[]): number => curves.reduce((sum, c) => sum + (c.curve.type === 'spline' ? c.curve.points.length : 0), 0);
    const [four500, four500Ms] = time(() => readDxf(pieces(4)).curves);
    const [five500, five500Ms] = time(() => refusal(() => readDxf(pieces(5))));
    const [wholes125, wholes125Ms] = time(() => readDxf(wholes(125)).curves);
    const [wholes200, wholes200Ms] = time(() => refusal(() => readDxf(wholes(200))));
    const [one2000, one2000Ms] = time(() => readDxf(dxf((g) => spline(g, 3, uneven(DXF_MAX_SPLINE_POINTS), wavy(DXF_MAX_SPLINE_POINTS)))).curves);
    const [one2001, one2001Ms] = time(() => refusal(() => readDxf(dxf((g) => spline(g, 3, uneven(DXF_MAX_SPLINE_POINTS + 1), wavy(DXF_MAX_SPLINE_POINTS + 1))))));
    console.log(`I10 four SPLINEs of 500 control points, uneven knots: ${four500.length} curves, ${controlOf(four500)} control points in ${four500Ms.toFixed(0)} ms`);
    console.log(`I10 five of them (9,940 control points): ${five500} in ${five500Ms.toFixed(0)} ms`);
    console.log(`I10 125 SPLINEs of 64 kept whole: ${wholes125.length} curves, ${controlOf(wholes125)} control points in ${wholes125Ms.toFixed(0)} ms`);
    console.log(`I10 200 of them (12,800): ${wholes200} in ${wholes200Ms.toFixed(0)} ms`);
    console.log(`I10 one SPLINE of ${DXF_MAX_SPLINE_POINTS} control points, uneven knots: ${one2000.length} curves, ${controlOf(one2000)} control points in ${one2000Ms.toFixed(0)} ms; of ${DXF_MAX_SPLINE_POINTS + 1}: ${one2001} in ${one2001Ms.toFixed(1)} ms`);
    expect(controlOf(four500)).toBe(4 * 497 * 4);
    expect(five500).toMatch(/^tooLarge/);
    expect(controlOf(wholes125)).toBe(DXF_MAX_CONTROL);
    expect(wholes200).toMatch(/^tooLarge/);
    expect(controlOf(one2000)).toBeLessThanOrEqual(DXF_MAX_CONTROL);
    expect(one2001).toMatch(/^tooLarge/);

    // 7. a number that is not finite
    const huge = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'LINE');
          g(8, '0');
          g(10, 0);
          g(20, 0);
          g(11, '1e999');
          g(21, 0);
        }),
      ),
    );
    const nan = refusal(() =>
      readDxf(
        dxf((g) => {
          g(0, 'CIRCLE');
          g(8, '0');
          g(10, 'nan');
          g(20, 0);
          g(40, 1);
        }),
      ),
    );
    const infinite = refusal(() => readDxf(dxf((g) => spline(g, 3, [0, 0, 0, 0, 1, 1, 1, 'Infinity'], four))));
    console.log('I10 1e999:', huge, '| nan:', nan, '| a knot Infinity:', infinite);
    for (const message of [huge, nan, infinite]) expect(message).toMatch(/^unreadable/);
  });
});
