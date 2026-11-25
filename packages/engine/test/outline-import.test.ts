// The import of an outline (D72) without adapters: the catalog and the options, the reader of DXF,
// the local IDs, the weld (the cases of the reviews and its properties over generated rings, the
// review's probe L carried over with its generators), the report and the revision. The cases in a
// sketch are in packages/scenarios/test/outline-import.test.ts.
import { describe, expect, it } from 'vitest';
import { curveProblem } from '../src/imported-curve';
import { splineCurves } from '../src/import/dxf';
import { OUTLINE_FORMATS, type OutlineOutcome, type OutlineReport, importOutline, openEnds, outlineIds, outlineRevision, weldOutline } from '../src/import/outline-formats';
import type { Id, ImportedCurve, Vec2 } from '../src/types';
import { boardDxf } from './outline-kit';

type Arc = Extract<ImportedCurve, { type: 'arc' }>;
const JOIN = 1e-6;
const SLACK = 1e-9;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const dxfOf = (...entities: (string | number)[][]): string => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat().map(String), '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
const withHeader = (header: (string | number)[], ...entities: (string | number)[][]): string => ['0', 'SECTION', '2', 'HEADER', ...header.map(String), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities.flat().map(String), '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
const LINE = (layer: string, ax: number, ay: number, bx: number, by: number): (string | number)[] => [0, 'LINE', 8, layer, 10, ax, 20, ay, 11, bx, 21, by];
const ARC = (layer: string, x: number, y: number, r: number, from: number, to: number, more: (string | number)[] = []): (string | number)[] => [0, 'ARC', 8, layer, 10, x, 20, y, 40, r, 50, from, 51, to, ...more];
const CIRCLE = (layer: string, x: number, y: number, r: number, more: (string | number)[] = []): (string | number)[] => [0, 'CIRCLE', 8, layer, 10, x, 20, y, 40, r, ...more];
const ok = (outcome: OutlineOutcome): { curves: Record<Id, ImportedCurve>; report: OutlineReport } => {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome;
};
const dxf = (text: string, options: Record<string, unknown> = {}) => importOutline('dxf', bytes(text), options as never);
const refusal = (outcome: OutlineOutcome): string => (outcome.ok ? 'read' : `${outcome.error.code}: ${outcome.error.message}`);
const line = (a: Vec2, b: Vec2): ImportedCurve => ({ type: 'line', a, b });
const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const arc = (c: Vec2, r: number, from: number, to: number): ImportedCurve => ({ type: 'arc', center: c, start: polar(c, r, from), end: polar(c, r, to) });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const kept = (curves: (ImportedCurve | undefined)[]): ImportedCurve[] => curves.filter((c): c is ImportedCurve => !!c);
const endsOf = (c: ImportedCurve | undefined): Vec2[] => (!c ? [] : c.type === 'line' ? [c.a, c.b] : c.type === 'arc' ? [c.start, c.end] : c.type === 'spline' && dist(c.points[0], c.points[c.points.length - 1]) > 0 ? [c.points[0], c.points[c.points.length - 1]] : []);
const rnd = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
};
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const deg = (r: number): number => (r * 180) / Math.PI;
const move = (c: ImportedCurve, d: Vec2): ImportedCurve => {
  const mv = (p: Vec2): Vec2 => [p[0] + d[0], p[1] + d[1]];
  return c.type === 'line' ? { type: 'line', a: mv(c.a), b: mv(c.b) } : c.type === 'arc' ? { type: 'arc', center: mv(c.center), start: mv(c.start), end: mv(c.end) } : c.type === 'circle' ? { type: 'circle', center: mv(c.center), radius: c.radius } : { type: 'spline', points: c.points.map(mv) };
};
const counts = (m: ReturnType<typeof weldOutline>, w: number): string => JSON.stringify([m.welded, m.reshaped, m.closed, m.dropped, m.duplicates, m.blocked, m.crowded, openEnds(kept(m.curves), w).open, m.curves.map((c) => (c ? c.type[0] : '-')).join('')]);

// ---------------------------------------------------------------- the generators of probe L

// Each a closed ring of curves, written with `digits` decimals as a DXF writes it.
type Gen = (next: () => number, digits: number) => ImportedCurve[];
// a convex polygon, some corners filleted (joints of a line and an arc, of two lines)
const filleted: Gen = (next, digits) => {
  const r = (v: number): number => round(v, digits);
  const n = 3 + Math.floor(next() * 6);
  const R0 = 5 + 40 * next();
  const o: Vec2 = [50 * next(), 50 * next()];
  const corners = Array.from({ length: n }, (_, i): Vec2 => polar(o, R0 * (0.7 + 0.3 * next()), (360 * (i + 0.6 * next())) / n));
  const pieces: { from: Vec2; to: Vec2; arc?: ImportedCurve }[] = [];
  for (let i = 0; i < n; i++) {
    const [p, q, s] = [corners[(i + n - 1) % n], corners[i], corners[(i + 1) % n]];
    const u: Vec2 = [(p[0] - q[0]) / dist(p, q), (p[1] - q[1]) / dist(p, q)];
    const v: Vec2 = [(s[0] - q[0]) / dist(s, q), (s[1] - q[1]) / dist(s, q)];
    const half = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) / 2;
    const f = next() < 0.4 ? 0 : Math.min(dist(p, q), dist(s, q)) * 0.3 * (0.2 + next()) * Math.tan(half);
    if (f < 0.05 || half < 0.05 || half > 1.5) {
      pieces.push({ from: q, to: q });
      continue;
    }
    const t = f / Math.tan(half);
    const [a, b]: [Vec2, Vec2] = [[q[0] + u[0] * t, q[1] + u[1] * t], [q[0] + v[0] * t, q[1] + v[1] * t]];
    const bis: Vec2 = [u[0] + v[0], u[1] + v[1]];
    const bl = Math.hypot(bis[0], bis[1]);
    const c: Vec2 = [q[0] + (bis[0] / bl) * (f / Math.sin(half)), q[1] + (bis[1] / bl) * (f / Math.sin(half))];
    pieces.push({ from: a, to: b, arc: arc([r(c[0]), r(c[1])], r(f), r(deg(Math.atan2(a[1] - c[1], a[0] - c[0]))), r(deg(Math.atan2(b[1] - c[1], b[0] - c[0])))) });
  }
  const out: ImportedCurve[] = [];
  for (let i = 0; i < n; i++) {
    const [here, there] = [pieces[i], pieces[(i + 1) % n]];
    if (here.arc) out.push(here.arc);
    out.push(line([r(here.to[0]), r(here.to[1])], [r(there.from[0]), r(there.from[1])]));
  }
  return out;
};
// a polygon whose sides are arcs with a bulge from deep to very shallow, some sides lines
const bulged: Gen = (next, digits) => {
  const r = (v: number): number => round(v, digits);
  const n = 3 + Math.floor(next() * 6);
  const R0 = [2, 10, 60, 300][Math.floor(next() * 4)];
  const o: Vec2 = [80 * next(), 80 * next()];
  const corners = Array.from({ length: n }, (_, i): Vec2 => polar(o, R0 * (0.75 + 0.25 * next()), (360 * (i + 0.5 * next())) / n));
  const out: ImportedCurve[] = [];
  for (let i = 0; i < n; i++) {
    const [p, q] = [corners[i], corners[(i + 1) % n]];
    if (next() < 0.2) {
      out.push(line([r(p[0]), r(p[1])], [r(q[0]), r(q[1])]));
      continue;
    }
    const b = (next() < 0.5 ? 1 : -1) * [0.9, 0.4, 0.1, 0.02, 0.004][Math.floor(next() * 5)] * (0.5 + next());
    const k = (1 - b * b) / (4 * b);
    const c: Vec2 = [(p[0] + q[0]) / 2 - k * (q[1] - p[1]), (p[1] + q[1]) / 2 + k * (q[0] - p[0])];
    const rad = dist(p, c);
    const [ap, aq] = [deg(Math.atan2(p[1] - c[1], p[0] - c[0])), deg(Math.atan2(q[1] - c[1], q[0] - c[0]))];
    const cr: Vec2 = [r(c[0]), r(c[1])];
    out.push(b > 0 ? arc(cr, r(rad), r(ap), r(aq)) : arc(cr, r(rad), r(aq), r(ap)));
  }
  return out;
};
// an exact ring of lines, arcs and splines, every end then moved at random by up to a part of half the weld
const jittered =
  (weldOf: number): Gen =>
  (next) => {
    const n = 3 + Math.floor(next() * 7);
    const o: Vec2 = [30 * next(), 30 * next()];
    const corners = Array.from({ length: n }, (_, i): Vec2 => polar(o, 20 * (0.6 + 0.4 * next()), (360 * (i + 0.5 * next())) / n));
    const j = [0.3, 0.6, 0.98][Math.floor(next() * 3)] * (weldOf / 2);
    const jit = (p: Vec2): Vec2 => {
      const [a, d] = [2 * Math.PI * next(), j * Math.sqrt(next())];
      return [p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)];
    };
    const out: ImportedCurve[] = [];
    for (let i = 0; i < n; i++) {
      const [p, q] = [jit(corners[i]), jit(corners[(i + 1) % n])];
      const kind = next();
      if (kind < 0.4) out.push(line(p, q));
      else if (kind < 0.8) {
        const b = (next() < 0.5 ? 1 : -1) * [0.9, 0.3, 0.05, 0.005][Math.floor(next() * 4)] * (0.5 + next());
        const k = (1 - b * b) / (4 * b);
        const c: Vec2 = [(p[0] + q[0]) / 2 - k * (q[1] - p[1]), (p[1] + q[1]) / 2 + k * (q[0] - p[0])];
        out.push(b > 0 ? { type: 'arc', center: c, start: p, end: q } : { type: 'arc', center: c, start: q, end: p });
      } else {
        const m = (t: number, off: number): Vec2 => [p[0] + (q[0] - p[0]) * t - off * (q[1] - p[1]), p[1] + (q[1] - p[1]) * t + off * (q[0] - p[0])];
        out.push({ type: 'spline', points: next() < 0.5 ? [p, m(0.3, 0.2), m(0.7, -0.2), q] : [p, m(0.5, 0.3), q] });
      }
    }
    return out;
  };
// what a file also holds: a twin (a line the other way round), a curve with no extent, a hole written as a near-whole arc
const withExtras =
  (gen: Gen): Gen =>
  (next, digits) => {
    const ring = gen(next, digits);
    const out = [...ring];
    const pick = ring[Math.floor(next() * ring.length)];
    if (pick.type === 'line') out.push(next() < 0.5 ? line(pick.a, pick.b) : line(pick.b, pick.a));
    else out.push(pick);
    out.splice(Math.floor(next() * out.length), 0, line([500, 500], [500, 500 + 5e-7]));
    out.push(arc([600, 600], 1.6, 0, 359.9));
    return out;
  };

interface Tally {
  worstMove: number; // in welds
  metMoved: number;
  refused: number;
  radiiApart: number;
  notClosed: number; // every gap of the file within the weld, and an end is open
  notClosedArcArc: number; // of them, with only ends of arcs open
  notTheSame: number;
  secondWeld: number;
  elsewhereCounts: number;
  elsewherePlaces: number;
  worstBent: number; // in welds
  notes: string[];
}
const tally = (): Tally => ({ worstMove: 0, metMoved: 0, refused: 0, radiiApart: 0, notClosed: 0, notClosedArcArc: 0, notTheSame: 0, secondWeld: 0, elsewhereCounts: 0, elsewherePlaces: 0, worstBent: 0, notes: [] });
const SHIFTS: Vec2[] = [
  [1234.5, -987.25],
  [100000.123, 250000.777],
];
function check(name: string, curves: ImportedCurve[], w: number, t: Tally): void {
  const note = (text: string): void => void (t.notes.length < 10 && t.notes.push(`${name}: ${text}`));
  const made = weldOutline(curves, w);
  const now = kept(made.curves);
  // the file as step 0 leaves it: what "met" is said of
  const tidy = weldOutline(curves, 0).curves;
  const all = tidy.flatMap((c, i) => endsOf(c).map((p) => ({ p, i })));
  const gapOf = (e: { p: Vec2; i: number }): number => Math.min(Infinity, ...all.filter((f) => f.i !== e.i).map((f) => dist(f.p, e.p)));
  curves.forEach((_, i) => {
    const [was, is] = [tidy[i], made.curves[i]];
    if (!was || !is) return;
    if (was.type === is.type) {
      const [e0, e1] = [endsOf(was), endsOf(is)];
      e0.forEach((p, k) => {
        if (!e1[k]) return;
        const d = dist(p, e1[k]);
        t.worstMove = Math.max(t.worstMove, d / w);
        if (d > 0 && gapOf({ p, i }) <= JOIN) {
          t.metMoved++;
          note(`a met end moved ${d}`);
        }
      });
    }
    if (curveProblem(is, 'c')) {
      t.refused++;
      note(`refused ${is.type}`);
    }
    if (is.type === 'arc') t.radiiApart = Math.max(t.radiiApart, Math.abs(dist(is.start, is.center) - dist(is.end, is.center)));
  });
  t.worstBent = Math.max(t.worstBent, made.bent / w);
  const open = openEnds(now, w).open;
  const largestGap = Math.max(0, ...all.map(gapOf));
  if (largestGap <= w && open > 0) {
    t.notClosed++;
    const openEnd = now.flatMap((c, i) => endsOf(c).map((p) => ({ p, i, type: c.type }))).filter((e, _, list) => !list.some((f) => f.i !== e.i && dist(f.p, e.p) <= JOIN));
    if (openEnd.every((e) => e.type === 'arc')) t.notClosedArcArc++;
    else note(`every gap within the weld, open ${open}`);
  }
  if (JSON.stringify(weldOutline(curves, w)) !== JSON.stringify(made)) t.notTheSame++;
  const again = weldOutline(now, w);
  if (again.welded + again.dropped + again.closed + again.reshaped + again.duplicates > 0) {
    t.secondWeld++;
    note('a second weld changes something');
  }
  for (const d of SHIFTS) {
    const there = weldOutline(
      curves.map((c) => move(c, d)),
      w,
    );
    if (counts(there, w) !== counts(made, w)) {
      t.elsewhereCounts++;
      note(`moved by ${d}: ${counts(made, w)} against ${counts(there, w)}`);
      continue;
    }
    let worst = 0;
    made.curves.forEach((c, i) => endsOf(c).forEach((p, k) => (worst = Math.max(worst, dist([p[0] + d[0], p[1] + d[1]], endsOf(there.curves[i])[k])))));
    if (worst > 1e-7) {
      t.elsewherePlaces++;
      note(`moved by ${d}: an end ${worst} elsewhere`);
    }
  }
}
const holds = (t: Tally): void => {
  expect(t.notes).toEqual([]);
  expect(t.worstMove).toBeLessThanOrEqual(1 + 1e-6);
  expect([t.metMoved, t.refused, t.notTheSame, t.secondWeld]).toEqual([0, 0, 0, 0]);
  expect(t.radiiApart).toBeLessThanOrEqual(1e-7);
  expect(t.worstBent).toBeLessThanOrEqual(1 + 1e-6);
  expect(t.notClosed - t.notClosedArcArc).toBe(0);
  expect([t.elsewhereCounts, t.elsewherePlaces]).toEqual([0, 0]);
};

// ---------------------------------------------------------------- the catalog

describe('the catalog of outline formats (D72)', () => {
  it('has dxf and svg, each with layers, unit and weld', () => {
    expect(Object.keys(OUTLINE_FORMATS)).toEqual(['dxf', 'svg']);
    for (const spec of Object.values(OUTLINE_FORMATS)) expect(Object.keys(spec.options).sort()).toEqual(['layers', 'unit', 'weld']);
  });

  it('refuses an unknown format, options of the wrong shape and no bytes', () => {
    expect(refusal(importOutline('dwg' as never, bytes('')))).toContain('invalidArguments');
    expect(refusal(dxf(dxfOf(LINE('0', 0, 0, 1, 0)), { weld: 2 }))).toContain('invalidArguments');
    expect(refusal(dxf(dxfOf(LINE('0', 0, 0, 1, 0)), { unit: 'constructor' }))).toContain('invalidArguments');
    expect(refusal(dxf(dxfOf(LINE('0', 0, 0, 1, 0)), { layers: [] }))).toContain('invalidArguments');
    expect(refusal(importOutline('dxf', 'text' as never))).toContain('invalidArguments');
  });
});

// ---------------------------------------------------------------- the reader of DXF

describe('the reader of DXF (D72)', () => {
  it('reads the board of a PCB tool on its layer: twelve curves under the IDs of the file, nothing welded', () => {
    const { curves, report } = ok(dxf(boardDxf(60), { layers: ['Edge.Cuts'] }));
    expect(Object.keys(curves)).toEqual(['l1', 'a1', 'l2', 'a2', 'l3', 'a3', 'l4', 'a4', 'c1', 'c2', 'c3', 'c4']);
    expect(report).toMatchObject({ format: 'dxf', curves: 12, byKind: { line: 4, arc: 4, circle: 4, spline: 0 }, welded: 0, open: 0, readWith: { format: 'dxf', layers: ['Edge.Cuts'] } });
    expect(report.about).toMatchObject({ unit: 'mm', unitFrom: 'file' });
    expect(report.about.layers['F.CrtYd']).toEqual({ LINE: 2 });
    expect(report.about.layers['F.SilkS']).toEqual({ TEXT: 1 });
    expect(report.bounds).toEqual({ min: [100, 80], max: [160, 120] });
    expect(report.ids).toMatchObject({ lines: 4, arcs: 4, circles: 4, splines: 0, unused: [], unusedCount: 0, otherKind: [] });
    expect(curves.a1).toMatchObject({ type: 'arc', center: [157, 83] });
    expect(curves.c1).toEqual({ type: 'circle', center: [103.5, 83.5], radius: 1.6 });
  });

  it('reads every layer without the option, and lists what it left out', () => {
    const { report } = ok(dxf(boardDxf(60)));
    expect(report.curves).toBe(14);
    expect(report.about.skipped).toEqual({ TEXT: 1 });
    expect(report.readWith).toEqual({ format: 'dxf' });
  });

  it('the same bytes and options give the same curves under the same IDs', () => {
    expect(JSON.stringify(ok(dxf(boardDxf(60))))).toBe(JSON.stringify(ok(dxf(boardDxf(60)))));
  });

  it('reads LWPOLYLINE with bulges of both signs, closed, and POLYLINE with VERTEX and SEQEND', () => {
    const lw = [0, 'LWPOLYLINE', 8, '0', 90, 4, 70, 1, 10, 0, 20, 0, 10, 10, 20, 0, 42, 1, 10, 10, 20, 10, 10, 0, 20, 10, 42, -0.5];
    const { curves } = ok(dxf(dxfOf(lw)));
    expect(Object.keys(curves)).toEqual(['l1', 'a1', 'l2', 'a2']);
    // bulge 1: a half circle from (10, 0) to (10, 10), counter-clockwise, its centre (10, 5)
    expect((curves.a1 as Arc).center[0]).toBeCloseTo(10, 12);
    expect((curves.a1 as Arc).center[1]).toBeCloseTo(5, 12);
    expect((curves.a1 as Arc).start).toEqual([10, 0]);
    // bulge −0.5: clockwise from (0, 10) to (0, 0), stored counter-clockwise from (0, 0)
    expect((curves.a2 as Arc).start).toEqual([0, 0]);
    expect((curves.a2 as Arc).end).toEqual([0, 10]);
    const poly = [0, 'POLYLINE', 8, '0', 66, 1, 70, 1, 0, 'VERTEX', 8, '0', 10, 0, 20, 0, 0, 'VERTEX', 8, '0', 10, 5, 20, 0, 0, 'VERTEX', 8, '0', 10, 5, 20, 5, 0, 'SEQEND', 8, '0'];
    expect(Object.keys(ok(dxf(dxfOf(poly))).curves)).toEqual(['l1', 'l2', 'l3']);
  });

  it('reads a spline-fit POLYLINE by its curve vertices, not its frame', () => {
    const v = (x: number, y: number, flag: number): (string | number)[] => [0, 'VERTEX', 8, '0', 10, x, 20, y, 70, flag];
    const poly = [0, 'POLYLINE', 8, '0', 70, 4, ...v(0, 0, 16), ...v(5, 5, 16), ...v(10, 0, 16), ...v(15, 5, 16), ...[0, 1, 2, 3, 4].flatMap((i) => v(i * 3, i % 2, 8)), 0, 'SEQEND'];
    expect(ok(dxf(dxfOf(poly))).report.byKind.line).toBe(4);
  });

  it('reads the units of the header and of the option', () => {
    const header = (code: number) => ['9', '$INSUNITS', 70, code];
    const size = (text: string, options = {}) => ok(dxf(text, options)).curves.l1 as { b: Vec2 };
    expect(size(withHeader(header(1), LINE('0', 0, 0, 1, 0))).b[0]).toBeCloseTo(25.4, 12);
    expect(size(withHeader(header(13), LINE('0', 0, 0, 1000, 0))).b[0]).toBeCloseTo(1, 12);
    expect(size(withHeader(header(14), LINE('0', 0, 0, 1, 0))).b[0]).toBe(100);
    expect(size(withHeader(header(9), LINE('0', 0, 0, 1, 0))).b[0]).toBeCloseTo(0.0254, 12);
    expect(size(withHeader(header(1), LINE('0', 0, 0, 1, 0)), { unit: 'mm' }).b[0]).toBe(1);
    expect(refusal(dxf(withHeader(header(3), LINE('0', 0, 0, 1, 0))))).toContain('give the option unit');
    const imperial = ok(dxf(withHeader(['9', '$MEASUREMENT', 70, 0], LINE('0', 0, 0, 1, 0))));
    expect(imperial.report.about.unitFrom).toBe('default');
    expect(imperial.report.notes[0]).toContain('give the option unit "in"');
    expect(ok(dxf(dxfOf(LINE('0', 0, 0, 1, 0)))).report.notes[0]).toContain('states no unit');
  });

  it('mirrors CIRCLE, ARC, LWPOLYLINE and a 2D POLYLINE drawn from below, never LINE; leaves a tilted one out', () => {
    const down = [210, 0, 220, 0, 230, -1];
    const { curves } = ok(dxf(dxfOf(CIRCLE('0', 5, 0, 1, down), ARC('0', 5, 0, 2, 0, 90, down), LINE('0', 5, 0, 6, 0))));
    expect((curves.c1 as { center: Vec2 }).center).toEqual([-5, 0]);
    // the arc from 0° to 90° about (5, 0), seen from below, runs counter-clockwise from 90° to 180° about (−5, 0)
    const a = curves.a1 as Arc;
    expect(a.start[0]).toBeCloseTo(-5, 12);
    expect(a.start[1]).toBeCloseTo(2, 12);
    expect(a.end[0]).toBeCloseTo(-7, 12);
    expect((curves.l1 as { a: Vec2 }).a).toEqual([5, 0]);
    const tilted = ok(dxf(dxfOf(CIRCLE('0', 5, 0, 1, [210, 1, 220, 0, 230, 0]), LINE('0', 0, 0, 1, 0))));
    expect(tilted.report.about.skipped).toEqual({ 'CIRCLE (tilted extrusion)': 1 });
  });

  it('a closed outline of a 2D POLYLINE and an ARC drawn from below and a LINE: every end meets', () => {
    const down = [210, 0, 220, 0, 230, -1];
    const poly = [0, 'POLYLINE', 8, '0', 70, 0, ...down, 0, 'VERTEX', 8, '0', 10, 0, 20, 0, 0, 'VERTEX', 8, '0', 10, 10, 20, 0, 0, 'SEQEND'];
    // seen from below, the polyline runs from (0, 0) to (−10, 0); the arc about (−10, 5) of radius 5
    const arcBelow = ARC('0', 10, 5, 5, 90, 270, down);
    const { report } = ok(dxf(dxfOf(poly, arcBelow, LINE('0', -10, 10, 0, 0))));
    expect(report.open).toBe(0);
    expect(report.welded).toBe(0);
  });

  it('ARC of a whole turn, or of equal angles, is a circle; an arc that only nearly closes is the weld’s', () => {
    const one = (from: number, to: number) => ok(dxf(dxfOf(ARC('0', 0, 0, 1, from, to)))).curves;
    expect(one(0, 360).c1?.type ?? one(0, 360).a1?.type).toBe('circle');
    expect(Object.keys(one(10, 370))).toEqual(['c1']);
    expect(Object.keys(one(45, 45))).toEqual(['c1']);
    // 0 to 359.9: an arc of the file, read by the weld as a circle under the ID the file gave it
    const near = ok(dxf(dxfOf(ARC('0', 0, 0, 1, 0, 359.9))));
    expect(near.curves.a1.type).toBe('circle');
    expect(near.report.ids.otherKind).toEqual([{ id: 'a1', type: 'circle' }]);
    expect(near.report.closed).toBe(1);
  });

  it('reads SPLINE: a cubic with even knots whole, uneven knots in Bezier pieces, degree 1 as lines, degree 2 of three points whole', () => {
    const spline = (degree: number, control: Vec2[], knots: number[], more: (string | number)[] = []): (string | number)[] => [0, 'SPLINE', 8, '0', 70, 8, 71, degree, 72, knots.length, 73, control.length, ...knots.flatMap((k) => [40, k]), ...control.flatMap(([x, y]) => [10, x, 20, y, 30, 0]), ...more];
    const six: Vec2[] = [[4, 0], [5, 1], [3, 2], [2, 3], [1, 2], [0, 0]];
    const even = ok(dxf(dxfOf(spline(3, six, [0, 0, 0, 0, 1, 2, 3, 3, 3, 3]))));
    expect(Object.keys(even.curves)).toEqual(['s1']);
    expect((even.curves.s1 as { points: Vec2[] }).points).toEqual(six);
    const uneven = ok(dxf(dxfOf(spline(3, six, [0, 0, 0, 0, 1, 2.5, 3, 3, 3, 3]))));
    expect(uneven.report.byKind.spline).toBe(3);
    expect(Object.values(uneven.curves).every((c) => c.type === 'spline' && c.points.length === 4)).toBe(true);
    expect(ok(dxf(dxfOf(spline(1, [[0, 0], [1, 0], [1, 1]], [0, 0, 1, 2, 2])))).report.byKind.line).toBe(2);
    expect(Object.keys(ok(dxf(dxfOf(spline(2, [[0, 0], [1, 1], [2, 0]], [0, 0, 0, 1, 1, 1])))).curves)).toEqual(['s1']);
    expect(ok(dxf(dxfOf(spline(2, [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]], [0, 0, 0, 1, 2, 3, 3, 3])))).report.byKind.spline).toBe(3);
  });

  it('refuses SPLINE knots out of order; knots a digit apart are one; lists what it does not read', () => {
    const spline = (degree: number, control: Vec2[], knots: number[], flags = 8, more: (string | number)[] = []): (string | number)[] => [0, 'SPLINE', 8, '0', 70, flags, 71, degree, ...knots.flatMap((k) => [40, k]), ...control.flatMap(([x, y]) => [10, x, 20, y]), ...more];
    const five: Vec2[] = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]];
    expect(refusal(dxf(dxfOf(spline(3, five, [0, 0, 0, 0, 0.8, 0.2, 1, 1, 1]))))).toContain('knots are out of order (0.8, then 0.2)');
    const six: Vec2[] = [...five, [5, 1]];
    expect(ok(dxf(dxfOf(spline(3, six, [0, 0, 0, 0, 1, 1 + 1e-12, 2, 2, 2, 2])))).report.byKind.spline).toBe(2);
    const skipped = (made: (string | number)[]) => ok(dxf(dxfOf(LINE('0', 0, 0, 1, 0), made))).report.about.skipped;
    expect(skipped(spline(3, five, [0, 0, 0, 0, 1, 2, 2, 2, 2], 12))).toEqual({ 'SPLINE (rational)': 1 });
    expect(skipped(spline(4, five.slice(0, 5), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]))).toEqual({ 'SPLINE (degree 4)': 1 });
    expect(skipped(spline(3, five, [0, 1, 2, 3, 4, 5, 6, 7, 8]))).toEqual({ 'SPLINE (periodic or unclamped)': 1 });
    expect(skipped([0, 'SPLINE', 8, '0', 70, 8, 71, 3, 74, 2, 11, 0, 21, 0, 11, 1, 21, 1])).toEqual({ 'SPLINE (fit points only)': 1 });
    expect(skipped(spline(3, [...five, [5, 1], [6, 0], [7, 1]], [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]))).toEqual({ 'SPLINE (discontinuous)': 1 });
    expect(refusal(dxf(dxfOf(spline(3, five, [0, 0, 0, 0, 1, 1, 1]))))).toContain('needs 9 knots');
    expect(refusal(dxf(dxfOf([...spline(3, five, [0, 0, 0, 0, 1, 2, 2, 2, 2]), 72, 8])))).toContain('declares 8 knots (group 72) and holds 9');
  });

  it('refuses a file that is not whole, with the place', () => {
    expect(refusal(dxf(`${dxfOf(LINE('0', 0, 0, 1, 0))}\nnot read`))).toBe('read');
    expect(refusal(dxf(['0', 'SECTION', '2', 'ENTITIES', ...LINE('0', 0, 0, 1, 0).map(String)].join('\n')))).toContain('the file is cut short: no EOF');
    expect(refusal(dxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8'].join('\n')))).toContain('has no value');
    expect(refusal(dxf(dxfOf([0, 'LINE', 8, '0', 10, '', 20, 0, 11, 1, 21, 0])))).toContain('not a number');
    expect(refusal(dxf(dxfOf([0, 'LINE', 8, '0', 10, 'nan', 20, 0, 11, 1, 21, 0])))).toContain('not a number');
    expect(refusal(dxf(dxfOf([0, 'LINE', 8, '0', 10, '1e999', 20, 0, 11, 1, 21, 0])))).toContain('not a number');
    expect(refusal(dxf(dxfOf([0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 1])))).toContain('LINE without the group 21');
    expect(refusal(dxf(['0', 'SECTION', '2', 'ENTITIES', '0', 'EOF'].join('\n')))).toContain('has no ENDSEC');
    expect(refusal(dxf(dxfOf([0, 'POLYLINE', 8, '0', 0, 'VERTEX', 10, 0, 20, 0])))).toContain('has no SEQEND');
    expect(refusal(dxf(dxfOf([0, 'VERTEX', 10, 0, 20, 0])))).toContain('a VERTEX outside a POLYLINE');
    expect(refusal(dxf('AutoCAD Binary DXF\r\n\u001a\u0000'))).toContain('binary DXF');
    expect(refusal(dxf('AC1027 something'))).toContain('DWG');
    expect(refusal(dxf('hello'))).toContain('unreadable');
    expect(refusal(dxf(dxfOf([0, 'LWPOLYLINE', 8, '0', 90, 4, 10, 0, 20, 0, 10, 1, 20, 0, 10, 1, 20, 1])))).toContain('declares 4 vertices (group 90) and holds 3');
  });

  it('passes over comments anywhere, reads a bare list of entities, and leaves paper space out', () => {
    const text = ['999', 'a comment', '0', 'SECTION', '999', 'x', '2', 'HEADER', '9', '$INSUNITS', '999', 'y', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...LINE('0', 0, 0, 1, 0).map(String), '999', 'inside', ...CIRCLE('0', 0, 0, 1, [67, 1]).map(String), '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const read = ok(dxf(text));
    expect((read.curves.l1 as { b: Vec2 }).b[0]).toBeCloseTo(25.4, 12);
    expect(read.report.about.skipped).toEqual({ 'CIRCLE (paper space)': 1 });
    expect(ok(dxf([...LINE('0', 0, 0, 1, 0).map(String), '0', 'EOF'].join('\n'))).report.curves).toBe(1);
  });

  it('counts layers and types of the file without a prototype; Object.prototype stays as it was', () => {
    const text = dxfOf(ARC('__proto__', 0, 0, 1, 0, 90), ARC('constructor', 0, 0, 2, 0, 90), ARC('toString', 0, 0, 3, 0, 90), [0, 'hasOwnProperty', 8, 'valueOf']);
    const { report } = ok(dxf(text));
    expect(Object.keys(report.about.layers)).toEqual(['__proto__', 'constructor', 'toString', 'valueOf']);
    expect({ ...report.about.skipped }).toEqual({ hasOwnProperty: 1 });
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(ok(dxf(text, { layers: ['__proto__'] })).report.curves).toBe(1);
  });

  it('refuses early by bytes, curves and control points', () => {
    expect(refusal(importOutline('dxf', new Uint8Array(8_000_001)))).toContain('tooLarge');
    const many = (n: number) => dxfOf(...Array.from({ length: n }, (_, i) => LINE('0', i, 0, i, 1)));
    expect(refusal(dxf(many(8001)))).toContain('more than 8000 curves');
    expect(refusal(dxf(many(2001)))).toContain('2001 curves, more than the 2000 an outline holds');
    const big = (n: number): (string | number)[] => [0, 'SPLINE', 8, '0', 70, 8, 71, 3, ...Array.from({ length: n + 4 }, (_, i) => [40, Math.max(0, Math.min(n - 3, i - 3))]).flat(), ...Array.from({ length: n }, (_, i) => [10, i, 20, i % 2]).flat()];
    expect(refusal(dxf(dxfOf(big(2001))))).toContain('a SPLINE of 2001 control points');
    // five splines of 500 points with uneven knots: their pieces pass the limit of control points read
    const uneven = (n: number, k: number): (string | number)[] => [0, 'SPLINE', 8, '0', 70, 8, 71, 3, ...[0, 0, 0, 0, ...Array.from({ length: n - 4 }, (_, i) => (i + 1) ** 1.01), 1e6, 1e6, 1e6, 1e6].flatMap((u) => [40, u]), ...Array.from({ length: n }, (_, i) => [10, i, 20, (i + k) % 3]).flat()];
    expect(refusal(dxf(dxfOf(...[0, 1, 2, 3, 4].map((k) => uneven(500, k)))))).toContain('control points of splines');
  });

  it('empty: no curve on the layers asked for, naming the layers of the file', () => {
    const outcome = dxf(boardDxf(60), { layers: ['Nothing'] });
    expect(refusal(outcome)).toContain('empty');
    expect(refusal(outcome)).toContain('Edge.Cuts (4 LINE, 4 ARC, 4 CIRCLE)');
  });

  it('the splines of a SPLINE converted are the curve of the file (splineCurves)', () => {
    const control: Vec2[] = [[0, 0], [1, 2], [3, 3], [5, 2], [6, 0], [7, 1], [8, 0]];
    const even = splineCurves(control, [0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4], 3, 1);
    expect('curves' in even && even.curves).toEqual([{ type: 'spline', points: control }]);
  });
});

// ---------------------------------------------------------------- the weld

describe('the weld of an outline (D72)', () => {
  it('closes a board written with four and three decimals, moving the ends of lines onto the ends of arcs; arcs keep their digits', () => {
    for (const digits of [4, 3]) {
      const { curves, report } = ok(dxf(boardDxf(60, 40, 3, digits, 17), { layers: ['Edge.Cuts'] }));
      expect(report.open).toBe(0);
      expect(report.welded).toBe(8);
      expect(report.reshaped).toBe(0);
      expect(report.moved).toBeLessThanOrEqual(0.01);
      const file = ok(dxf(boardDxf(60, 40, 3, digits, 17), { layers: ['Edge.Cuts'], weld: 0 })).curves;
      for (const id of ['a1', 'a2', 'a3', 'a4']) expect(curves[id]).toEqual(file[id]);
    }
    const two = ok(dxf(boardDxf(60, 40, 3, 2, 17), { layers: ['Edge.Cuts'], weld: 0.001 }));
    expect(two.report.open).toBe(16);
    expect(two.report.gaps[0].distance).toBeGreaterThan(0.001);
    expect(two.report.notes.join(' ')).toContain('import again with weld');
    expect(ok(dxf(boardDxf(60, 40, 3, 2, 17), { layers: ['Edge.Cuts'], weld: 0.01 })).report.open).toBe(0);
  });

  it('a corner drawn as 200 short lines is not welded: nothing is merged along a chain', () => {
    const corner = Array.from({ length: 200 }, (_, i) => line(polar([0, 0], 0.5, (i * 90) / 200), polar([0, 0], 0.5, ((i + 1) * 90) / 200)));
    const m = weldOutline([...corner, line([0, 0.5], [0, 5]), line([0, 5], [5, 5]), line([5, 5], [5, 0]), line([5, 0], [0.5, 0])], 0.01);
    expect([m.welded, kept(m.curves).length]).toEqual([0, 204]);
  });

  it('three ends 0.009 apart: the second goes onto the first, the third would go too far', () => {
    const m = weldOutline([line([-5, 0], [0, 0]), line([0.009, 0], [0.009, 5]), line([0.018, 0], [5, 0])], 0.01);
    expect([m.welded, m.blocked]).toEqual([1, 1]);
    expect(m.moved).toBeCloseTo(0.009, 12);
  });

  it('an arc of 359.9° is a circle under its ID; of 359° an arc; with a line on each end an arc (a key hole)', () => {
    expect(weldOutline([arc([0, 0], 1.6, 0, 359.9)], 0.01).curves[0]?.type).toBe('circle');
    expect(weldOutline([arc([0, 0], 1.6, 0, 359)], 0.01).curves[0]?.type).toBe('arc');
    const key = arc([0, 0], 1.6, 0, 359.9) as Arc;
    const m = weldOutline([key, line(key.end, [3, -1]), line(key.start, [3, 0.5])], 0.01);
    expect(m.curves[0]?.type).toBe('arc');
  });

  it('an arc of radius 1000 beside a line: the line moves, the arc keeps its digits', () => {
    const big = arc([0, 0], 1000, 1, 359) as Arc;
    const m = weldOutline([big, line([big.start[0] + 0.006, big.start[1] + 0.006], [1100, 200])], 0.01);
    expect(m.curves[0]).toEqual(big);
    expect(m.welded).toBe(1);
  });

  it('two quarter arcs 0.005 apart: one gives way as the circle through its new ends and its old middle; 0.02 apart: not welded', () => {
    const first = arc([0, 0], 10, 0, 90) as Arc;
    const second = { type: 'arc', center: [-20, 0], start: [first.end[0] + 0.005, first.end[1]], end: [-10, 0] } as Arc;
    const near = weldOutline([first, { ...second, start: polar([-20, 0], 20, 30) }], 0.01);
    void near;
    const m = weldOutline([first, arc([0.005, 20], 10, 180, 270)], 0.01);
    expect(m.reshaped).toBe(1);
    expect(m.bent).toBeLessThanOrEqual(0.01 + SLACK);
    for (const c of kept(m.curves)) expect(curveProblem(c, 'c')).toBeUndefined();
    expect(weldOutline([first, arc([0.02, 20], 10, 180, 270)], 0.01).reshaped).toBe(0);
  });

  it('a curve twice in a file is read once, its ID unused; a square with four gaps and each side twice closes', () => {
    const square = [line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 10]), line([0, 10], [0, 0])];
    const m = weldOutline([...square, line([10, 0], [0, 0]), { type: 'circle', center: [5, 5], radius: 1 }, { type: 'circle', center: [5, 5], radius: 1 }], 0.01);
    expect(m.duplicates).toBe(2);
    expect(m.curves.map((c) => (c ? c.type[0] : '-')).join('')).toBe('llll-c-');
    const gapped = [line([0, 0], [10, 0]), line([10.005, 0], [10, 10]), line([10, 10.005], [0, 10]), line([0.005, 10], [0, 0.005])];
    const twice = weldOutline([...gapped, ...gapped], 0.01);
    expect(twice.duplicates).toBe(4);
    expect(openEnds(kept(twice.curves), 0.01).open).toBe(0);
  });

  it('refuses no local ID: curves under __proto__, constructor and toString are no outline', () => {
    expect(outlineIds([line([0, 0], [1, 0]), arc([0, 0], 1, 0, 90), { type: 'circle', center: [0, 0], radius: 1 }, { type: 'spline', points: [[0, 0], [1, 1], [2, 0]] }, line([0, 0], [0, 1])])).toEqual(['l1', 'a1', 'c1', 's1', 'l2']);
  });

  it('the IDs are the same for every weld; a near-whole arc among circles and arcs keeps its ID', () => {
    const file = dxfOf(LINE('0', 0, 0, 30, 0), LINE('0', 30, 0, 30, 30), LINE('0', 30, 30, 0, 30), LINE('0', 0, 30, 0, 0), ARC('0', 5, 5, 1, 0, 359.9), CIRCLE('0', 10, 5, 1), ARC('0', 15, 5, 1, 0, 180), CIRCLE('0', 20, 5, 1), ARC('0', 25, 5, 1, 0, 90));
    const ids = [0.01, 0.001, 0].map((weld) => Object.keys(ok(dxf(file, { weld })).curves).join(' '));
    expect(ids).toEqual(['l1 l2 l3 l4 a1 c1 a2 c2 a3', 'l1 l2 l3 l4 a1 c1 a2 c2 a3', 'l1 l2 l3 l4 a1 c1 a2 c2 a3']);
    expect(ok(dxf(file, { weld: 0.01 })).curves.a1.type).toBe('circle');
    expect(ok(dxf(file, { weld: 0.001 })).curves.a1.type).toBe('arc');
  });

  it('two lines that meet 0.005 from the start of an arc of radius 1: the arc is untouched, the joint open and blocked', () => {
    const a = arc([0, 0], 1, 90, 180) as Arc;
    const corner: Vec2 = [a.start[0] + 0.005, a.start[1]];
    const m = weldOutline([a, line([5, 1], corner), line(corner, [corner[0], 5])], 0.01);
    expect(m.curves[0]).toEqual(a);
    expect(m.blocked).toBe(1);
  });

  it('a spline of three points with its ends close stays open; one of four is closed, its end landing on its neighbour point', () => {
    const three: ImportedCurve = { type: 'spline', points: [[0, 0], [5, 5], [0.005, 0]] };
    const m3 = weldOutline([three], 0.01);
    expect([m3.closed, m3.welded, openEnds(kept(m3.curves), 0.01).open]).toEqual([0, 0, 2]);
    expect(m3.curves[0]).toEqual(three);
    const four: ImportedCurve = { type: 'spline', points: [[0, 0], [5, 0], [5, 5], [0, 0], [0.004, 0]] };
    const m4 = weldOutline([four], 0.01);
    expect(m4.closed).toBe(1);
    expect((m4.curves[0] as { points: Vec2[] }).points.at(-1)).toEqual([0, 0]);
    expect(curveProblem(m4.curves[0] as ImportedCurve, 'c')).toBeUndefined();
  });

  it('an arc of radius 1000: a line ending 0.009 from it moves, an arc of radius 30 gives way within the weld; a line twice beside it is one and welded', () => {
    // the end of the small arc 0.009 outside the start of the large one: across the large arc, along the small one
    const big = arc([0, 0], 1000, 90, 88) as Arc;
    const near: Vec2 = [big.start[0], big.start[1] + 0.009];
    const small = { type: 'arc', center: [near[0] - 30, near[1]], start: [near[0] - 30, near[1] - 30], end: near } as Arc;
    const m = weldOutline([big, small], 0.01);
    expect(m.curves[0]).toEqual(big);
    expect(m.reshaped).toBe(1);
    const now = m.curves[1] as Arc;
    expect(now.end).toEqual(big.start);
    expect(Math.abs(dist(now.start, now.center) - 30)).toBeLessThan(1e-5);
    expect(Math.abs(dist(now.end, now.center) - dist(now.start, now.center))).toBeLessThan(1e-12);
    expect(m.bent).toBeLessThanOrEqual(0.01 + SLACK);
    const twice = weldOutline([big, line([big.start[0] + 0.006, big.start[1] + 0.006], [1100, 200]), line([1100, 200], [big.start[0] + 0.006, big.start[1] + 0.006])], 0.01);
    expect([twice.duplicates, twice.welded]).toEqual([1, 1]);
    expect(twice.curves[0]).toEqual(big);
  });

  it('an open spline 0.004 from the start of an arc goes onto it; the arc is untouched', () => {
    const a = arc([0, 0], 1, 90, 180) as Arc;
    const m = weldOutline([a, { type: 'spline', points: [[a.start[0] + 0.004, a.start[1]], [2, 2], [3, 0], [4, 1]] }], 0.01);
    expect(m.curves[0]).toEqual(a);
    expect((m.curves[1] as { points: Vec2[] }).points[0]).toEqual(a.start);
  });

  it('a short line between two ends is not collapsed', () => {
    const m = weldOutline([line([-5, 0], [0, 0]), line([0.003, 0], [0.006, 0]), line([0.0135, 0], [5, 0])], 0.01);
    expect(kept(m.curves)).toHaveLength(3);
    expect(openEnds(kept(m.curves), 0.01).open).toBe(2);
  });

  it('an arc of 359.99999° is a circle with the default weld and with none', () => {
    for (const w of [0.01, 0]) expect(weldOutline([arc([0, 0], 1, 0, 359.99999)], w).curves[0]?.type).toBe('circle');
  });

  it('2000 strokes that do not meet and 8000 ends in two clusters, within a time limit', () => {
    const strokes = Array.from({ length: 2000 }, (_, i) => line([5 * (i % 50), 5 * Math.floor(i / 50)], [5 * (i % 50) + 1, 5 * Math.floor(i / 50) + 1]));
    let t = performance.now();
    const read = ok(importOutline('dxf', bytes(dxfOf(...strokes.map((s) => LINE('0', ...(s as { a: Vec2 }).a, ...(s as { b: Vec2 }).b))))));
    expect(performance.now() - t).toBeLessThan(5000);
    expect(read.report.open).toBe(4000);
    const clusters = Array.from({ length: 4000 }, (_, i) => line(polar([0, 0], 0.0001 * (i % 20), i), polar([100, 0], 0.0001 * (i % 20), i)));
    t = performance.now();
    const m = weldOutline(clusters, 0.01);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(m.welded).toBe(0);
  });

  it('curves at the scale of the join are left out, counted once, with any weld', () => {
    const tinySpline: ImportedCurve = { type: 'spline', points: [[10, 10], [10.0000002, 10], [10.0000002, 10.0000002], [10, 10.0000001]] };
    const quarter: ImportedCurve = { type: 'arc', center: [5, 5], start: [5.0000004, 5], end: [5, 5.0000004] };
    const threeQuarters: ImportedCurve = { type: 'arc', center: [5, 5], start: [5, 5.0000004], end: [5.0000004, 5] };
    const zeroCubic: ImportedCurve = { type: 'spline', points: [[0, 0], [0, 0], [0, 0], [5e-7, 0]] };
    for (const w of [0, 0.01])
      for (const curve of [tinySpline, quarter, threeQuarters, zeroCubic, arc([0, 0], 5e-7, 0, 270)]) {
        const m = weldOutline([line([0, 0], [1, 0]), curve], w);
        expect(m.curves[1]).toBeUndefined();
        expect([m.closed, m.dropped]).toEqual([0, 1]);
      }
  });

  it('the property: nothing leaves the weld that the validator refuses, over 1500 files at the scale of the join', () => {
    let refused = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const next = rnd(seed);
      const w = [0, 0.01, 0.001, 5e-7, 0.01][seed % 5];
      const grid = [2.5e-7, 1e-6, 0.002, 0.004][seed % 4];
      const span = [4, 6, 8][seed % 3];
      const at = (): Vec2 => [10 + grid * Math.floor(next() * span), 20 + grid * Math.floor(next() * span)];
      const n = 2 + Math.floor(next() * 8);
      const curves: ImportedCurve[] = [];
      for (let i = 0; i < n; i++) {
        const kind = next();
        if (kind < 0.4) curves.push({ type: 'line', a: at(), b: next() < 0.3 ? [at()[0] + 5, at()[1]] : at() });
        else if (kind < 0.7) {
          const [c, s] = [at(), at()];
          const r = dist(c, s);
          if (r === 0) continue;
          const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]) + 2 * Math.PI * next();
          curves.push({ type: 'arc', center: c, start: s, end: [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)] });
        } else if (kind < 0.8) curves.push({ type: 'circle', center: at(), radius: grid * (0.5 + 3 * next()) });
        else curves.push({ type: 'spline', points: Array.from({ length: next() < 0.5 ? 3 : 4 + Math.floor(next() * 3) }, at) });
      }
      for (const c of kept(weldOutline(curves, w).curves)) if (curveProblem(c, 'c')) refused++;
    }
    expect(refused).toBe(0);
  });

  it('the property: what importOutline answers the validator takes, over 600 generated DXF files with points on each other', () => {
    let [refused, read] = [0, 0];
    for (let seed = 1; seed <= 600; seed++) {
      const next = rnd(7000 + seed);
      const grid = [2.5e-7, 1e-6, 0.002, 0.5][seed % 4];
      const at = (): [number, number] => [10 + grid * Math.floor(next() * 6), 20 + grid * Math.floor(next() * 6)];
      const entities: (string | number)[][] = [];
      for (let i = 0, n = 2 + Math.floor(next() * 8); i < n; i++) {
        const kind = next();
        if (kind < 0.35) entities.push(LINE('0', ...at(), ...at()));
        else if (kind < 0.6) entities.push(ARC('0', ...at(), grid * (0.5 + 4 * next()), Math.round(360 * next()), Math.round(360 * next())));
        else if (kind < 0.7) entities.push(CIRCLE('0', ...at(), grid * (0.5 + 3 * next())));
        else if (kind < 0.85) {
          const v = Array.from({ length: 2 + Math.floor(next() * 4) }, at);
          entities.push([0, 'LWPOLYLINE', 8, '0', 90, v.length, 70, next() < 0.5 ? 1 : 0, ...v.flatMap(([x, y]) => [10, x, 20, y, ...(next() < 0.4 ? [42, (next() - 0.5) * 2] : [])])]);
        } else {
          const control = Array.from({ length: 4 + Math.floor(next() * 3) }, at);
          const spans = control.length - 3;
          const knots = [0, 0, 0, 0, ...Array.from({ length: spans - 1 }, (_, k) => k + 1 + (next() < 0.5 ? 0 : 0.3)), spans, spans, spans, spans];
          entities.push([0, 'SPLINE', 8, '0', 70, 8, 71, 3, ...knots.flatMap((k) => [40, k]), ...control.flatMap(([x, y]) => [10, x, 20, y])]);
        }
      }
      const outcome = importOutline('dxf', bytes(dxfOf(...entities)), { weld: [0, 0.01, 0.001, 5e-7][seed % 4] });
      if (!outcome.ok) continue;
      read++;
      for (const c of Object.values(outcome.curves)) if (curveProblem(c, 'c')) refused++;
    }
    expect(read).toBeGreaterThan(400);
    expect(refused).toBe(0);
  });

  it('a search cut short proves nothing: the near-whole arc beside 65 lines stays an arc', () => {
    const nearly: ImportedCurve = { type: 'arc', center: [-1, 0], start: [0, 0], end: polar([-1, 0], 1, -0.0573) };
    const beside = line([0.001, 0], [3, 0]);
    const others = Array.from({ length: 65 }, (_, i) => line([-0.0099, -0.0099], polar([-0.0099, -0.0099], 5, 181 + i)));
    expect(weldOutline([nearly, beside], 0.01).curves[0]?.type).toBe('arc');
    expect(weldOutline([...others, nearly, beside], 0.01).curves[65]?.type).toBe('arc');
  });

  it('an arc of 300° that its quarter points would let through is not reshaped; pulled less far, bent is of the whole arc', () => {
    const wide = arc([0, 0], 0.02, 0, 300) as Arc;
    const held = (target: Vec2): ImportedCurve[] => [{ type: 'arc', center: [target[0] + 3, target[1]], start: [target[0] + 6, target[1]], end: target }, line(target, [target[0], target[1] + 4]), wide];
    const pulled = weldOutline(held([0.029, 0.003]), 0.01);
    expect([pulled.reshaped, pulled.blocked]).toEqual([0, 1]);
    for (const target of [[0.023, 0.001], [0.026, 0.002], [0.0275, 0.0025]] as Vec2[]) {
      const near = weldOutline(held(target), 0.01);
      if (!near.reshaped) continue;
      const now = near.curves[2] as Arc;
      let most = 0;
      for (let i = 0; i <= 3000; i++) most = Math.max(most, Math.abs(dist(polar([0, 0], 0.02, (300 * i) / 3000), now.center) - dist(now.start, now.center)));
      expect(near.bent).toBeGreaterThanOrEqual(most - 1e-12);
      expect(near.bent).toBeLessThanOrEqual(0.01 + SLACK);
    }
  });

  it('the gap beside a dense patch is the first of gaps; a search cut short says atMost', () => {
    const hatch = Array.from({ length: 64 }, (_, i) => line([0.05 + 0.11 * (i % 8), 0.1 + 0.11 * Math.floor(i / 8)], [0.05 + 0.11 * (i % 8) + 0.04, 0.1 + 0.11 * Math.floor(i / 8) + 0.02]));
    const contour = [line([0, 0], [1, 0]), line([1.015, 0], [1.015, 5]), line([1.015, 5], [0, 5]), line([0, 5], [0, 0])];
    for (const file of [contour, [...hatch, ...contour], [...contour, ...hatch]]) {
      const { gaps } = openEnds(kept(weldOutline(file, 0.01).curves), 0.01);
      expect(gaps[0].distance).toBeCloseTo(0.015, 9);
      expect(gaps[1].distance).toBeCloseTo(0.015, 9);
    }
    const dense = Array.from({ length: 200 }, (_, i) => line([0.3 + 0.0031 * (i % 20), 0.3 + 0.0031 * Math.floor(i / 20)], [0.3 + 0.0031 * (i % 20) + 0.001, 0.3 + 0.0031 * Math.floor(i / 20)]));
    expect(openEnds(dense, 0.001).gaps.some((gap) => gap.atMost)).toBe(true);
  });

  it('a line beside a polyline of short segments goes onto its end; met ends are no crowd', () => {
    for (const [w, s] of [[0.01, 0.002], [0.05, 0.01], [0.1, 0.02], [0.5, 0.1]] as const) {
      const n = 60;
      const r = (n * s) / (Math.PI / 2);
      const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => polar([0, 0], r, (i * 90) / n));
      const poly = pts.slice(1).map((p, i) => line(pts[i], p));
      const start: Vec2 = [pts[n][0] - 0.6 * w, pts[n][1]];
      const file = [...poly, line(start, [-5, pts[n][1]]), line([-5, pts[n][1]], [-5, -5]), line([-5, -5], [pts[0][0], -5]), line([pts[0][0], -5], pts[0])];
      const m = weldOutline(file, w);
      expect((m.curves[n] as { a: Vec2 }).a).toEqual(pts[n]);
      expect(openEnds(kept(m.curves), w).open).toBe(0);
    }
    const n = 60;
    const r = (n * 0.0002) / (Math.PI / 2);
    const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => polar([0, 0], r, (i * 90) / n));
    const poly = pts.slice(1).map((p, i) => line(pts[i], p));
    // segments of 0.0002 with a weld of 0.01: more than 64 ends in the cells around, both ends left alone
    const start: Vec2 = [pts[n][0] - 0.006, pts[n][1]];
    const m = weldOutline([...poly, line(start, [-5, pts[n][1]]), line([-5, pts[n][1]], [-5, -5]), line([-5, -5], [pts[0][0], -5]), line([pts[0][0], -5], pts[0])], 0.01);
    expect([m.crowded, m.welded]).toEqual([2, 0]);
  });

  it('a gap equal to the weld closes at every place of a file of two decimals; three ends with equal gaps weld one way everywhere', () => {
    let welded = 0;
    for (let k = 0; k < 400; k++) {
      const [x, y] = [round(3 + k * 0.37, 2), round(7 + k * 0.11, 2)];
      const x2 = round(x + 0.01, 2);
      if (weldOutline([line([x - 10, y - 5], [x, y]), line([x2, y], [x2 + 10, y + 5])], 0.01).welded > 0) welded++;
    }
    expect(welded).toBe(400);
    const three = (dx: number, dy: number): ImportedCurve[] => [line([dx - 5, dy], [dx, dy]), line([dx + 0.006, dy], [dx + 0.006, dy + 5]), line([dx + 0.012, dy], [dx + 5, dy])];
    const seen = new Set<string>();
    for (let k = 0; k < 200; k++) seen.add(counts(weldOutline(three(round(k * 1.37, 2), round(k * 0.73, 2)), 0.01), 0.01));
    expect(seen.size).toBe(1);
    const ring = filleted(rnd(275), 2);
    expect(counts(weldOutline(ring.map((c) => move(c, [1234.5, -987.25])), 0.01), 0.01)).toBe(counts(weldOutline(ring, 0.01), 0.01));
  });

  it('the work of the searches is bounded: lines from one point, circles about one centre, arcs between two points, each curve twice', () => {
    for (const curves of [
      Array.from({ length: 2000 }, (_, i) => line([0, 0], polar([0, 0], 50, (i * 360) / 2000))),
      Array.from({ length: 2000 }, (_, i): ImportedCurve => ({ type: 'circle', center: [0, 0], radius: 1 + i * 0.01 })),
      Array.from({ length: 2000 }, (_, i): ImportedCurve => ({ type: 'arc', center: [0, 1 + i * 0.01], start: [5, 0], end: [-5, 0] })),
      Array.from({ length: 2000 }, (_, i) => line([Math.floor(i / 2) * 3, 0], [Math.floor(i / 2) * 3 + 1, 7])),
    ]) {
      const t = performance.now();
      weldOutline(curves, 0.01);
      expect(performance.now() - t).toBeLessThan(3000);
    }
    const rings = Array.from({ length: 2000 }, (_, i): ImportedCurve => ({ type: 'circle', center: [0, 0], radius: 1 + i * 0.01 }));
    expect(weldOutline([...rings, { type: 'circle', center: [0, 0], radius: 11 + 5e-7 }], 0.01).duplicates).toBe(1);
  });

  it('of two arcs the one whose radius changes less in proportion gives way; reshapedArcs and the note name the arcs', () => {
    const top = arc([0, 0], 500, 89.75, 90.25) as Arc;
    const joint: Vec2 = [top.end[0], top.end[1] + 0.004];
    const quarter: ImportedCurve = { type: 'arc', center: [joint[0] - 20, joint[1]], start: [joint[0] - 20, joint[1] - 20], end: joint };
    const rest = [line(top.start, [top.start[0], top.start[1] - 20 - 0.004]), line([top.start[0], top.start[1] - 20 - 0.004], [joint[0] - 20, joint[1] - 20])];
    const free = weldOutline([quarter, top, ...rest], 0.01);
    expect(free.reshapedArcs.map((a) => a.index)).toEqual([0]);
    // held by a line, the shallow arc gives way, its radius changes much, and the report names it
    const text = dxfOf(...[quarter, top, ...rest, line(joint, [joint[0] + 3, joint[1] + 3])].map((c): (string | number)[] => (c.type === 'line' ? LINE('0', ...c.a, ...c.b) : ARC('0', ...(c as Arc).center, dist((c as Arc).start, (c as Arc).center), deg(Math.atan2((c as Arc).start[1] - (c as Arc).center[1], (c as Arc).start[0] - (c as Arc).center[0])), deg(Math.atan2((c as Arc).end[1] - (c as Arc).center[1], (c as Arc).end[0] - (c as Arc).center[0]))))));
    const held = ok(dxf(text));
    expect(held.report.reshapedArcs.map((a) => a.id)).toEqual(['a2']);
    expect(held.report.notes.join(' ')).toContain('a2: 500 to');
    for (const c of Object.values(held.curves)) expect(curveProblem(c, 'c')).toBeUndefined();
  });

  it('the properties over generated rings, each again at two other places (probe L of the review)', () => {
    const [p1, p2, p3] = [tally(), tally(), tally()];
    for (let seed = 1; seed <= 300; seed++) check(`filleted ${seed}`, (seed % 3 === 0 ? withExtras(filleted) : filleted)(rnd(seed), [2, 3, 4, 6, 9][seed % 5]), [0.01, 0.001, 0.05, 0.01][seed % 4], p1);
    for (let seed = 1; seed <= 400; seed++) check(`bulged ${seed}`, (seed % 3 === 0 ? withExtras(bulged) : bulged)(rnd(1000 + seed), [2, 3, 4, 6, 9][seed % 5]), [0.01, 0.001, 0.05, 0.01][seed % 4], p2);
    for (let seed = 1; seed <= 400; seed++) {
      const w = [0.01, 0.001, 0.05, 0.2][seed % 4];
      check(`jittered ${seed}`, (seed % 3 === 0 ? withExtras(jittered(w)) : jittered(w))(rnd(5000 + seed), 9), w, p3);
    }
    for (const t of [p1, p2, p3]) holds(t);
  }, 120_000);
});

// ---------------------------------------------------------------- the report and the revision

describe('the report and the revision of an outline (D72)', () => {
  it('ids.more when more than twenty numbers are unused; otherKind for a near-whole arc', () => {
    const many = dxfOf(...Array.from({ length: 25 }, (_, i) => LINE('0', i, 0, i, 1e-7)), LINE('0', 0, 0, 5, 0), ARC('0', 50, 0, 1, 0, 359.9));
    const { report } = ok(dxf(many));
    expect(report.ids.unusedCount).toBe(25);
    expect(report.ids.unused).toHaveLength(20);
    expect(report.ids.more).toContain('entryCurves');
    expect(report.ids.otherKind).toEqual([{ id: 'a1', type: 'circle' }]);
    expect(report.dropped).toBe(25);
  });

  it('notes the bounds of another unit and the cost of many curves', () => {
    expect(ok(dxf(dxfOf(LINE('0', 0, 0, 0.5, 0)))).report.notes.join(' ')).toContain('is the unit right');
    const many = dxfOf(...Array.from({ length: 600 }, (_, i) => LINE('0', i, 0, i, 1)));
    expect(ok(dxf(many)).report.notes.join(' ')).toContain('600 curves');
  });

  it('outlineRevision: kept and changed, two holes swapped, a hole put in first, lines swapped and reversed, a place across the edge of a cell', () => {
    const board = ok(dxf(boardDxf(60), { layers: ['Edge.Cuts'] })).curves;
    const wider = ok(dxf(boardDxf(62), { layers: ['Edge.Cuts'] })).curves;
    expect(outlineRevision(board, wider)).toEqual({ kept: 12, changed: 7, added: [], removed: [], renamed: [] });
    const swapped = { ...board, c1: board.c2, c2: board.c1 };
    expect(outlineRevision(board, swapped).renamed).toEqual([
      { id: 'c1', was: 'c2' },
      { id: 'c2', was: 'c1' },
    ]);
    const first = { ...board, c1: { type: 'circle', center: [130, 100], radius: 1 } as ImportedCurve, c2: board.c1, c3: board.c2, c4: board.c3, c5: board.c4 };
    const revision = outlineRevision(board, first);
    expect(revision.renamed).toEqual([
      { id: 'c2', was: 'c1' },
      { id: 'c3', was: 'c2' },
      { id: 'c4', was: 'c3' },
      { id: 'c5', was: 'c4' },
    ]);
    expect(revision.added).toEqual(['c5']);
    expect(revision.changed).toBe(1);
    const l = board.l1 as { a: Vec2; b: Vec2 };
    expect(outlineRevision({ l1: board.l1, l2: board.l2 }, { l1: board.l2, l2: { type: 'line', a: l.b, b: l.a } }).renamed.map((r) => r.id)).toEqual(['l1', 'l2']);
    const cell = (x: number): ImportedCurve => ({ type: 'circle', center: [x, 0], radius: 1 });
    expect(outlineRevision({ c1: cell(1e-6 * 3 - 1e-15) }, { c2: cell(1e-6 * 3 + 1e-15) }).renamed).toEqual([{ id: 'c2', was: 'c1' }]);
  });
});
