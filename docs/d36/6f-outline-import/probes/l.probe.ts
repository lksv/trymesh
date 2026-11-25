// Probe L: what the third round of reviews asked to be measured. The properties of the weld over
// generated rings, each also somewhere else (L1); a ring far from the origin of its file, in a real
// sketch (L2); curves at the scale of the join (L3); the gap of the report beside a dense place
// (L4); an end beside a polyline of short segments (L5); a gap equal to the weld and equal gaps
// (L6); many curves at one place (L7); a search that is cut short, an arc pulled far, a tiny arc
// beside a large one (L8); how much a radius changes where an arc gives way (L9); names of the file
// that are names of `Object.prototype`, and `slice` (L10). The generators of L1 and the cases of
// L2 to L7 are the third review's, turned into assertions.
import { describe, expect, it, vi } from 'vitest';
import { type EngineState } from '../../../../packages/engine/src/index';
import { XY, addSketch, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { readDxf } from './dxf';
import { addOutline, resultOf } from './kit';
import { type ImportedCurve, type ReadCurve, type ReadOutline, type Vec2, JOIN, assemble, curveProblem, importOutline, installOutlineKind, openEnds, outlineEntry, outlineRevision, weld, work } from './proto';
import { readSvg } from './svg';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

type Arc = Extract<ImportedCurve, { type: 'arc' }>;
const about = { unit: 'mm', unitFrom: 'file', layers: {}, skipped: {} } as unknown as ReadOutline['about'];
const read = (curves: ImportedCurve[]): ReadCurve[] => curves.map((curve) => ({ curve, layer: '0' }) as ReadCurve);
const line = (a: Vec2, b: Vec2): ImportedCurve => ({ type: 'line', a, b });
const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
const arc = (c: Vec2, r: number, from: number, to: number): ImportedCurve => ({ type: 'arc', center: c, start: polar(c, r, from), end: polar(c, r, to) });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rnd = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
};
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const deg = (r: number): number => (r * 180) / Math.PI;
const endsOf = (c: ImportedCurve | undefined): Vec2[] => (!c ? [] : c.type === 'line' ? [c.a, c.b] : c.type === 'arc' ? [c.start, c.end] : c.type === 'spline' && dist(c.points[0], c.points[c.points.length - 1]) > 0 ? [c.points[0], c.points[c.points.length - 1]] : []);
const kept = (curves: (ImportedCurve | undefined)[]): ImportedCurve[] => curves.filter((c): c is ImportedCurve => !!c);
const inSketch = (curves: Record<string, ImportedCurve>, anchor: 'origin' | 'center' = 'origin'): EngineState => run(newEngine(), addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves, { anchor })));
const move = (c: ImportedCurve, d: Vec2): ImportedCurve => {
  const mv = (p: Vec2): Vec2 => [p[0] + d[0], p[1] + d[1]];
  return c.type === 'line' ? { type: 'line', a: mv(c.a), b: mv(c.b) } : c.type === 'arc' ? { type: 'arc', center: mv(c.center), start: mv(c.start), end: mv(c.end) } : c.type === 'circle' ? { type: 'circle', center: mv(c.center), radius: c.radius } : { type: 'spline', points: c.points.map(mv) };
};
const counts = (m: ReturnType<typeof weld>, w: number): string => JSON.stringify([m.welded, m.reshaped, m.closed, m.dropped, m.duplicates, m.blocked, m.crowded, openEnds(kept(m.curves), w).open, m.curves.map((c) => (c ? c.type[0] : '-')).join('')]);
const dxfOf = (...entities: string[][]): string => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
const dxfArc = (layer: string, x: number, y: number, r: number, from: number, to: number): string[] => ['0', 'ARC', '8', layer, '10', String(x), '20', String(y), '40', String(r), '50', String(from), '51', String(to)];

// ---- the generators: each a closed ring of curves, written with `digits` decimals as a DXF writes it
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
// a polygon whose sides are arcs with a bulge from deep to very shallow, some sides lines (joints
// of two arcs, of an arc and a line); each arc written by its centre, radius and angles
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
const jittered = (weldOf: number): Gen => (next) => {
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
const withExtras = (gen: Gen): Gen => (next, digits) => {
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
  files: number;
  worstMove: number; // in welds
  metMoved: number;
  refused: number;
  radiiApart: number; // the worst |rs − re| of an arc kept, mm
  notClosed: number; // every gap of the file within the weld, and an end is open
  notClosedArcArc: number; // of them, with only ends of arcs open
  notTheSame: number; // the same input twice
  secondWeld: number; // a second weld over the result changes something
  elsewhereCounts: number; // the file somewhere else: other counts or other curves kept
  elsewherePlaces: number; // ... the same counts, an end more than 1e-7 mm elsewhere
  worstBent: number; // in welds
  worstRadius: number; // the largest change of a radius, as a part of the radius of the file
  reshaped: number;
  notes: string[];
}
const fresh = (): Tally => ({ files: 0, worstMove: 0, metMoved: 0, refused: 0, radiiApart: 0, notClosed: 0, notClosedArcArc: 0, notTheSame: 0, secondWeld: 0, elsewhereCounts: 0, elsewherePlaces: 0, worstBent: 0, worstRadius: 0, reshaped: 0, notes: [] });
const SLACK = 1e-9;

function check(name: string, curves: ImportedCurve[], w: number, t: Tally, shifts: Vec2[]): void {
  t.files++;
  const note = (text: string): void => void (t.notes.length < 10 && t.notes.push(`${name}: ${text}`));
  const made = weld(read(curves), w);
  const now = kept(made.curves);
  // the file as step 0 leaves it: what "met" is said of
  const tidy = weld(read(curves), 0).curves;
  const all = tidy.flatMap((c, i) => endsOf(c).map((p) => ({ p, i })));
  const gapOf = (e: { p: Vec2; i: number }): number => Math.min(Infinity, ...all.filter((f) => f.i !== e.i).map((f) => dist(f.p, e.p)));
  curves.forEach((_, i) => {
    const [was, is] = [tidy[i], made.curves[i]];
    if (!was || !is) return;
    if (was.type === is.type) {
      const [e0, e1] = [endsOf(was), endsOf(is)];
      e0.forEach((p, k) => {
        if (!e1[k]) return; // a spline closed onto its start
        const d = dist(p, e1[k]);
        t.worstMove = Math.max(t.worstMove, d / w);
        if (d > w + SLACK) note(`an end moved ${d} with the weld ${w}`);
        if (d > 0 && gapOf({ p, i }) <= JOIN) (t.metMoved++, note(`a met end moved ${d.toExponential(2)}`));
      });
    }
    const problem = curveProblem(is);
    if (problem) (t.refused++, note(`refused ${is.type}: ${problem}`));
    if (is.type === 'arc') {
      const [rs, re] = [dist(is.start, is.center), dist(is.end, is.center)];
      t.radiiApart = Math.max(t.radiiApart, Math.abs(rs - re));
      if (was.type === 'arc' && (was.center[0] !== is.center[0] || was.center[1] !== is.center[1])) {
        const r0 = dist(was.start, was.center);
        t.reshaped++;
        t.worstRadius = Math.max(t.worstRadius, Math.abs(rs - r0) / r0);
      }
    }
  });
  t.worstBent = Math.max(t.worstBent, made.bent / w);
  const open = openEnds(now, w).open;
  const largestGap = Math.max(0, ...all.map(gapOf));
  if (largestGap <= w && open > 0) {
    t.notClosed++;
    const openEnd = now.flatMap((c, i) => endsOf(c).map((p) => ({ p, i, type: c.type }))).filter((e, _, list) => !list.some((f) => f.i !== e.i && dist(f.p, e.p) <= JOIN));
    if (openEnd.every((e) => e.type === 'arc')) t.notClosedArcArc++;
    else note(`every gap within the weld (${largestGap.toExponential(2)} of ${w}), open ${open} blocked ${made.blocked} crowded ${made.crowded}; ${curves.map((c) => c.type[0]).join('')}, open ends of ${openEnd.map((e) => e.type[0]).join('')}`);
  }
  if (JSON.stringify(weld(read(curves), w)) !== JSON.stringify(made)) t.notTheSame++;
  const again = weld(read(now), w);
  if (again.welded + again.dropped + again.closed + again.reshaped + again.duplicates > 0) (t.secondWeld++, note(`a second weld: welded ${again.welded} moved ${again.moved.toExponential(2)} reshaped ${again.reshaped} dropped ${again.dropped} closed ${again.closed} duplicates ${again.duplicates}`));
  for (const d of shifts) {
    const there = weld(read(curves.map((c) => move(c, d))), w);
    if (counts(there, w) !== counts(made, w)) {
      t.elsewhereCounts++;
      note(`moved by ${d}: ${counts(made, w)} against ${counts(there, w)}`);
      continue;
    }
    let worst = 0;
    made.curves.forEach((c, i) => endsOf(c).forEach((p, k) => (worst = Math.max(worst, dist([p[0] + d[0], p[1] + d[1]], endsOf(there.curves[i])[k])))));
    if (worst > 1e-7) (t.elsewherePlaces++, note(`moved by ${d}: an end ${worst.toExponential(2)} elsewhere`));
  }
}
const say = (name: string, t: Tally): void => {
  console.log(name, JSON.stringify({ ...t, worstMove: +t.worstMove.toFixed(4), worstBent: +t.worstBent.toFixed(4), worstRadius: +t.worstRadius.toPrecision(3), radiiApart: +t.radiiApart.toExponential(2), notes: undefined }));
  for (const note of t.notes) console.log('   ', note.slice(0, 400));
};
const holds = (t: Tally): void => {
  expect(t.worstMove).toBeLessThanOrEqual(1 + 1e-6);
  expect([t.metMoved, t.refused, t.notTheSame, t.secondWeld]).toEqual([0, 0, 0, 0]);
  expect(t.radiiApart).toBeLessThanOrEqual(1e-7);
  expect(t.worstBent).toBeLessThanOrEqual(1 + 1e-6);
  expect(t.notClosed - t.notClosedArcArc).toBe(0);
  expect([t.elsewhereCounts, t.elsewherePlaces]).toEqual([0, 0]);
};

describe('L: the third round of reviews', () => {
  const SHIFTS: Vec2[] = [[1234.5, -987.25], [100000.123, 250000.777]];

  it('L1: the properties of the weld over 2200 generated rings, each also at two other places', () => {
    const [p1, p2, p3] = [fresh(), fresh(), fresh()];
    for (let seed = 1; seed <= 600; seed++) check(`filleted ${seed}`, (seed % 3 === 0 ? withExtras(filleted) : filleted)(rnd(seed), [2, 3, 4, 6, 9][seed % 5]), [0.01, 0.001, 0.05, 0.01][seed % 4], p1, SHIFTS);
    for (let seed = 1; seed <= 800; seed++) check(`bulged ${seed}`, (seed % 3 === 0 ? withExtras(bulged) : bulged)(rnd(1000 + seed), [2, 3, 4, 6, 9][seed % 5]), [0.01, 0.001, 0.05, 0.01][seed % 4], p2, SHIFTS);
    for (let seed = 1; seed <= 800; seed++) {
      const w = [0.01, 0.001, 0.05, 0.2][seed % 4];
      check(`jittered ${seed}`, (seed % 3 === 0 ? withExtras(jittered(w)) : jittered(w))(rnd(5000 + seed), 9), w, p3, SHIFTS);
    }
    say('L1 filleted polygons (a line and an arc), 600:', p1);
    say('L1 polygons of arcs (two arcs, shallow arcs), 800:', p2);
    say('L1 rings with every end moved within the weld (lines, arcs, splines), 800:', p3);
    for (const t of [p1, p2, p3]) holds(t);
  });

  it('L2: a ring of four arcs with gaps of 0.004, far from the origin of its file, welded and in a real sketch', () => {
    for (const [far, gapped] of [[0, true], [1e3, true], [1e5, true], [3e5, true], [1e6, true], [1e6, false], [1e7, true], [1e7, false], [1e8, true], [5e8, true], [5e8, false]] as const) {
      let [reshaped, worst, refused, open, dropped, notOneRegion] = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 40; k++) {
        const o: Vec2 = [far + 13.137 * k + 0.3331, far * 0.7 + 7.771 * k + 0.1117];
        const r3 = (v: number): number => round(v, 3);
        const [R, turn] = [4 + 0.37 * k, 9.17 * k];
        const ring = [0, 1, 2, 3].map((i) => arc([r3(o[0]), r3(o[1])], r3(R + (gapped && i % 2 ? 0.004 : 0)), r3(turn + 90 * i), r3(turn + 90 * i + 90)));
        const made = assemble({ curves: read(ring), about }, 0.01);
        reshaped += made.report.reshaped;
        open += made.report.open;
        dropped += made.report.dropped;
        for (const c of Object.values(made.curves)) {
          if (c.type !== 'arc') continue;
          worst = Math.max(worst, Math.abs(dist(c.start, c.center) - dist(c.end, c.center)));
          if (curveProblem(c)) refused++;
        }
        const result = Object.keys(made.curves).length > 0 ? resultOf(inSketch(made.curves, 'center'), 's') : undefined;
        if (!result?.valid || result.regions.length !== 1 || (result.openEnds?.count ?? 0) > 0) notOneRegion++;
      }
      console.log(`L2 ${far / 1000} m from the origin, ${gapped ? 'neighbours 0.004 apart' : 'no gaps (the control)'}: ${reshaped} arcs reshaped, open ends ${open}, dropped ${dropped}; the worst |rs - re| ${worst.toExponential(1)}; refused by the validator ${refused}; sketches that are not one valid region ${notOneRegion} of 40`);
      expect(refused).toBe(0);
      if (far <= 1e7) expect([open, dropped, notOneRegion]).toEqual([0, 0, 0]);
    }
  });

  it('L3: curves at the scale of the join: nothing leaves the weld that the validator refuses', () => {
    const tinySpline: ImportedCurve = { type: 'spline', points: [[10, 10], [10.0000002, 10], [10.0000002, 10.0000002], [10, 10.0000001]] };
    const quarter: ImportedCurve = { type: 'arc', center: [5, 5], start: [5.0000004, 5], end: [5, 5.0000004] };
    const threeQuarters: ImportedCurve = { type: 'arc', center: [5, 5], start: [5, 5.0000004], end: [5.0000004, 5] };
    const zeroCubic: ImportedCurve = { type: 'spline', points: [[0, 0], [0, 0], [0, 0], [5e-7, 0]] };
    const underArc = arc([0, 0], 5e-7, 0, 270);
    for (const w of [0, 0.01])
      for (const [name, curve] of [['a spline of four points 2e-7 apart', tinySpline], ['an arc of a quarter turn, radius 4e-7', quarter], ['an arc of three quarters, radius 4e-7', threeQuarters], ['a cubic of three points at one place and one 5e-7 away', zeroCubic], ['an arc of radius 5e-7 over 270 degrees', underArc]] as const) {
        const m = weld(read([line([0, 0], [1, 0]), curve]), w);
        console.log(`L3 weld ${w}, ${name}: ${m.curves[1] ? `${m.curves[1].type}, the validator: ${curveProblem(m.curves[1]) ?? 'accepted'}` : 'left out'} | closed ${m.closed} dropped ${m.dropped}`);
        expect(m.curves[1]).toBeUndefined();
        expect([m.closed, m.dropped]).toEqual([0, 1]);
      }
    let [files, refused, far, notTheSame, secondWeld] = [0, 0, 0, 0, 0];
    const notes: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
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
      if (curves.length === 0) continue;
      files++;
      const m = weld(read(curves), w);
      if (JSON.stringify(weld(read(curves), w)) !== JSON.stringify(m)) notTheSame++;
      const reach = Math.max(w >= JOIN ? w : 0, JOIN) + SLACK;
      m.curves.forEach((now, i) => {
        if (!now) return;
        const problem = curveProblem(now);
        if (problem) (refused++, notes.length < 6 && notes.push(`seed ${seed} weld ${w} grid ${grid}: ${now.type} refused: ${problem}`));
        if (now.type === curves[i].type) endsOf(curves[i]).forEach((p, k) => endsOf(now)[k] && dist(p, endsOf(now)[k]) > reach && far++);
      });
      const again = weld(read(kept(m.curves)), w);
      if (again.welded + again.dropped + again.closed + again.duplicates + again.reshaped > 0) secondWeld++;
    }
    console.log(`L3 ${files} files of curves at the scale of the join and of the weld: curves the validator refuses ${refused}; ends moved further than the weld ${far}; not the same on a second run ${notTheSame}; a second weld over the result changes something in ${secondWeld}`);
    for (const note of notes) console.log('    ', note.slice(0, 300));
    expect([refused, far, notTheSame]).toEqual([0, 0, 0]);
  });

  it('L4: the gap of the report beside 64 short strokes', () => {
    const hatch = Array.from({ length: 64 }, (_, i) => line([0.05 + 0.11 * (i % 8), 0.1 + 0.11 * Math.floor(i / 8)], [0.05 + 0.11 * (i % 8) + 0.04, 0.1 + 0.11 * Math.floor(i / 8) + 0.02]));
    const contour = [line([0, 0], [1, 0]), line([1.015, 0], [1.015, 5]), line([1.015, 5], [0, 5]), line([0, 5], [0, 0])];
    for (const [name, file] of [['the contour alone', contour], ['the strokes first', [...hatch, ...contour]], ['the contour first', [...contour, ...hatch]]] as const) {
      const made = assemble({ curves: read(file), about }, 0.01);
      console.log(`L4 ${name}: open ${made.report.open}; the first of gaps ${JSON.stringify(made.report.gaps.slice(0, 3).map((g) => [+g.distance.toPrecision(4), g.atMost ?? false]))}`);
      expect(made.report.gaps[0].distance).toBeCloseTo(0.015, 9);
      expect(made.report.gaps[1].distance).toBeCloseTo(0.015, 9);
    }
    // an end with more than 64 ends around it at every size: the distance is an upper bound and says so
    const dense = Array.from({ length: 200 }, (_, i) => line([0.3 + 0.0031 * (i % 20), 0.3 + 0.0031 * Math.floor(i / 20)], [0.3 + 0.0031 * (i % 20) + 0.001, 0.3 + 0.0031 * Math.floor(i / 20)]));
    const crowd = assemble({ curves: read(dense), about }, 0.001);
    console.log(`L4 200 strokes 0.0031 apart, weld 0.001: open ${crowd.report.open}, gaps ${JSON.stringify(crowd.report.gaps.slice(0, 2).map((g) => [+g.distance.toPrecision(3), g.atMost ?? false]))}`);
  });

  it('L5: a line that should start at the end of a polyline of short segments', () => {
    for (const [w, s] of [[0.01, 0.002], [0.05, 0.01], [0.1, 0.02], [0.5, 0.1], [0.1, 0.05], [0.01, 0.0002]] as const) {
      const n = 60;
      const r = (n * s) / (Math.PI / 2);
      const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => polar([0, 0], r, (i * 90) / n));
      const poly = pts.slice(1).map((p, i) => line(pts[i], p));
      const start: Vec2 = [pts[n][0] - 0.6 * w, pts[n][1]];
      const file = [...poly, line(start, [-5, pts[n][1]]), line([-5, pts[n][1]], [-5, -5]), line([-5, -5], [pts[0][0], -5]), line([pts[0][0], -5], pts[0])];
      const m = weld(read(file), w);
      const now = (m.curves[n] as { a: Vec2 }).a;
      const onto = pts.findIndex((p) => dist(p, now) < 1e-12);
      const open = openEnds(kept(m.curves), w).open;
      console.log(`L5 weld ${w}, segments of ${s}: the start of the line is now on vertex ${onto} (the end of the polyline is vertex ${n}), ${dist(start, now).toPrecision(3)} from its place; open ${open}, crowded ${m.crowded}, blocked ${m.blocked}`);
      if (s >= 0.002) expect([onto, open]).toEqual([n, 0]);
      else expect([onto, m.crowded]).toEqual([-1, 2]); // more than 64 ends around: both ends left alone, and said
    }
  });

  it('L6: a gap equal to the weld, and equal gaps, wherever the file stands', () => {
    let welded = 0;
    for (let k = 0; k < 400; k++) {
      const [x, y] = [round(3 + k * 0.37, 2), round(7 + k * 0.11, 2)];
      const x2 = round(x + 0.01, 2);
      if (weld(read([line([x - 10, y - 5], [x, y]), line([x2, y], [x2 + 10, y + 5])]), 0.01).welded > 0) welded++;
    }
    console.log(`L6 two ends 0.01 apart in a file of two decimals, weld 0.01, at 400 places: welded at ${welded}`);
    expect(welded).toBe(400);
    const three = (dx: number, dy: number): ImportedCurve[] => [line([dx - 5, dy], [dx, dy]), line([dx + 0.006, dy], [dx + 0.006, dy + 5]), line([dx + 0.012, dy], [dx + 5, dy])];
    const seen = new Map<string, number>();
    for (let k = 0; k < 200; k++) {
      const key = counts(weld(read(three(round(k * 1.37, 2), round(k * 0.73, 2))), 0.01), 0.01);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    console.log(`L6 ends at x = 0, 0.006 and 0.012 of three lines, at 200 places: ${[...seen].map(([key, count]) => `${count} times ${key}`).join('; ')}`);
    expect(seen.size).toBe(1);
    // the ring the third review found: closed where it stands, two ends open when moved
    const ring = filleted(rnd(275), 2);
    const [here, there] = [weld(read(ring), 0.01), weld(read(ring.map((c) => move(c, [1234.5, -987.25]))), 0.01)];
    console.log(`L6 the filleted ring of seed 275: ${counts(here, 0.01)} where it stands, ${counts(there, 0.01)} moved by (1234.5, -987.25)`);
    expect(counts(there, 0.01)).toBe(counts(here, 0.01));
  });

  it('L7: many curves at one place: the work of the searches', () => {
    for (const n of [2000, 8000]) {
      const timed = (curves: ImportedCurve[]): string => {
        work.looked = 0;
        const t = performance.now();
        const m = weld(read(curves), 0.01);
        return `${(performance.now() - t).toFixed(0)} ms, ${work.looked} candidates looked at (${(work.looked / n).toFixed(1)} a curve), duplicates ${m.duplicates}, crowded ${m.crowded}`;
      };
      console.log(`L7 ${n} lines from one point: ${timed(Array.from({ length: n }, (_, i) => line([0, 0], polar([0, 0], 50, (i * 360) / n))))}`);
      console.log(`L7 ${n} circles about one centre, every radius another: ${timed(Array.from({ length: n }, (_, i): ImportedCurve => ({ type: 'circle', center: [0, 0], radius: 1 + i * 0.01 })))}`);
      console.log(`L7 ${n} arcs between two points, every centre another: ${timed(Array.from({ length: n }, (_, i): ImportedCurve => ({ type: 'arc', center: [0, 1 + i * 0.01], start: [5, 0], end: [-5, 0] })))}`);
      console.log(`L7 ${n} lines, each twice: ${timed(Array.from({ length: n }, (_, i) => line([Math.floor(i / 2) * 3, 0], [Math.floor(i / 2) * 3 + 1, 7])))}`);
      const looked = ((work.looked = 0), weld(read(Array.from({ length: n }, (_, i): ImportedCurve => ({ type: 'circle', center: [0, 0], radius: 1 + i * 0.01 }))), 0.01), work.looked);
      expect(looked).toBeLessThanOrEqual(64 * n);
    }
    const rings = Object.fromEntries(Array.from({ length: 2000 }, (_, i): [string, ImportedCurve] => [`c${i + 1}`, { type: 'circle', center: [0, 0], radius: 1 + i * 0.01 }]));
    const grown = Object.fromEntries(Object.entries(rings).map(([id, c]) => [id, { ...c, radius: (c as { radius: number }).radius + 0.001 } as ImportedCurve]));
    work.looked = 0;
    const t = performance.now();
    const revision = outlineRevision(rings, grown);
    console.log(`L7 the revision of 2000 circles about one centre with every radius changed: ${(performance.now() - t).toFixed(0)} ms, ${work.looked} candidates looked at; kept ${revision.kept} changed ${revision.changed} renamed ${revision.renamed.length}`);
    expect([revision.changed, revision.renamed.length]).toEqual([2000, 0]);
    // a twin is still found among them
    const twice = weld(read([...Object.values(rings), { type: 'circle', center: [0, 0], radius: 11 + 5e-7 }]), 0.01);
    expect(twice.duplicates).toBe(1);
  });

  it('L8: a search cut short proves nothing; an arc pulled far; a tiny arc beside a large one', () => {
    // an arc of nearly a whole turn whose ends are 0.001 apart, and a line that starts between them
    const nearly: ImportedCurve = { type: 'arc', center: [-1, 0], start: [0, 0], end: polar([-1, 0], 1, -0.0573) };
    const beside = line([0.001, 0], [3, 0]);
    const others = Array.from({ length: 65 }, (_, i) => line([-0.0099, -0.0099], polar([-0.0099, -0.0099], 5, 181 + i)));
    const alone = weld(read([nearly, beside]), 0.01);
    const crowded = weld(read([...others, nearly, beside]), 0.01);
    console.log(`L8 an arc of nearly a turn with a line beside its ends: ${alone.curves[0]?.type}; with 65 other lines starting 0.014 away: ${crowded.curves[65]?.type} (closed ${crowded.closed})`);
    expect([alone.curves[0]?.type, crowded.curves[65]?.type]).toEqual(['arc', 'arc']);
    // an arc of radius 0.02 over 300 degrees; its start is to go onto the end of another arc that a
    // line holds where it is, 0.0095 away: the two ends, the middle and the quarter points are
    // within the weld of the new circle, the arc at 15 % of its sweep is not
    const wide = arc([0, 0], 0.02, 0, 300) as Arc;
    const held = (target: Vec2): ImportedCurve[] => [{ type: 'arc', center: [target[0] + 3, target[1]], start: [target[0] + 6, target[1]], end: target }, line(target, [target[0], target[1] + 4]), wide];
    const sampled = (now: Arc): number => {
      let most = 0;
      for (let i = 0; i <= 3000; i++) most = Math.max(most, Math.abs(dist(polar([0, 0], 0.02, (300 * i) / 3000), now.center) - dist(now.start, now.center)));
      return most;
    };
    const pulled = weld(read(held([0.029, 0.003])), 0.01);
    console.log(`L8 an arc of radius 0.02 over 300 degrees, its start ${dist(wide.start, [0.029, 0.003]).toFixed(5)} from a held end of another arc: reshaped ${pulled.reshaped}, blocked ${pulled.blocked}`);
    expect([pulled.reshaped, pulled.blocked]).toEqual([0, 1]);
    // pulled less far it gives way, and the report's `bent` is the furthest of the whole arc
    for (const target of [[0.023, 0.001], [0.026, 0.002], [0.0275, 0.0025]] as Vec2[]) {
      const near = weld(read(held(target)), 0.01);
      const most = near.reshaped ? sampled(near.curves[2] as Arc) : 0;
      console.log(`L8 the same with its start ${dist(wide.start, target).toFixed(5)} from that end: reshaped ${near.reshaped}, blocked ${near.blocked}; sampled at 3000 places the arc of the file is at most ${most.toFixed(7)} from the new circle, the report says ${near.bent.toFixed(7)}`);
      expect(near.bent).toBeGreaterThanOrEqual(most - 1e-12);
      expect(near.bent).toBeLessThanOrEqual(0.01 + SLACK);
    }
    // a DXF of two arcs: radius 2 over 270 degrees, and radius 0.01 over 0.01 degrees beside its end
    const two = importOutline(dxfOf(dxfArc('0', 98.001, 99.997, 2, 0, 270), dxfArc('0', 100, 100, 0.01, 0, 0.01)));
    const radii = Object.values(two.curves).map((c) => (c.type === 'arc' ? Math.abs(dist(c.start, c.center) - dist(c.end, c.center)) : 0));
    console.log(`L8 a tiny arc beside the end of a large one: curves ${two.report.curves}, reshaped ${two.report.reshaped}, blocked ${two.report.blocked}, dropped ${two.report.dropped}; |rs - re| ${radii.map((v) => v.toExponential(1)).join(', ')}; the validator: ${Object.values(two.curves).map((c) => curveProblem(c) ?? 'accepted').join(', ')}`);
    for (const c of Object.values(two.curves)) expect(curveProblem(c)).toBeUndefined();
  });

  it('L9: how much a radius changes where an arc gives way, and an arc pulled nearly straight', () => {
    for (const [R, sweep] of [[10, 90], [50, 10], [500, 2], [20, 3], [100, 1], [500, 0.5], [2000, 0.2]] as const) {
      const sag = R * (1 - Math.cos((sweep * Math.PI) / 360));
      const row: string[] = [];
      for (const digits of [3, 4]) {
        const next = rnd(11 + digits);
        let [n, closed, worst] = [0, 0, 0];
        for (let k = 0; k < 400; k++) {
          const turn = 360 * next();
          const c: Vec2 = [100 * next(), 100 * next()];
          const r = (v: number): number => round(v, digits);
          const first = arc([r(c[0]), r(c[1])], r(R), r(turn), r(turn + sweep)) as Arc;
          const joint = polar(c, R, turn + sweep);
          const second = arc([r(2 * joint[0] - c[0]), r(2 * joint[1] - c[1])], r(R), r(turn + 180), r(turn + sweep + 180)) as Arc;
          const gap = Math.min(dist(first.end, second.end), dist(first.end, second.start));
          if (gap <= JOIN || gap > 0.01) continue;
          n++;
          const m = weld(read([first, second]), 0.01);
          if (m.reshaped === 0) continue;
          closed++;
          worst = Math.max(worst, m.radius);
        }
        row.push(`${digits} decimals: ${closed} of ${n} joints closed, a radius changed by up to ${worst.toPrecision(3)} (${((100 * worst) / R).toPrecision(2)} %)`);
      }
      console.log(`L9 R ${R} over ${sweep} degrees (sagitta ${sag.toPrecision(2)}): ${row.join(' | ')}`);
    }
    // R 500 over half a degree (sagitta 0.0048), its end pulled outward by d onto the end of an arc of
    // a quarter turn. Free, the quarter arc gives way (its radius changes less in proportion); held
    // by a line, the shallow arc has to, and near the straight line it is left as it is.
    const top = arc([0, 0], 500, 89.75, 90.25) as Arc;
    for (const d of [0.004, 0.008, 0.0094, 0.00951, 0.0095192, 0.00951939]) {
      const joint: Vec2 = [top.end[0], top.end[1] + d];
      const quarter: ImportedCurve = { type: 'arc', center: [joint[0] - 20, joint[1]], start: [joint[0] - 20, joint[1] - 20], end: joint };
      const rest = [line(top.start, [top.start[0], top.start[1] - 20 - d]), line([top.start[0], top.start[1] - 20 - d], [joint[0] - 20, joint[1] - 20])];
      const free = assemble({ curves: read([quarter, top, ...rest]), about }, 0.01);
      const result = resultOf(inSketch(free.curves), 's');
      const heldBy = assemble({ curves: read([quarter, top, ...rest, line(joint, [joint[0] + 3, joint[1] + 3])]), about }, 0.01);
      const now = heldBy.curves.a2 as Arc;
      const said = (r: ReturnType<typeof assemble>['report']): string => JSON.stringify(r.reshapedArcs.map(({ id, was, radius }) => [id, +was.toPrecision(7), +radius.toPrecision(7)]));
      console.log(`L9 the end pulled by ${d}: free, reshaped ${said(free.report)}, in a sketch valid ${result.valid} with ${result.regions.length} region | the quarter arc held: ${heldBy.report.reshaped ? `reshaped ${said(heldBy.report)}, a radius of ${(dist(now.start, now.center) / dist(now.start, now.end)).toPrecision(3)} chords, |rs - re| ${Math.abs(dist(now.start, now.center) - dist(now.end, now.center)).toExponential(1)}` : `not reshaped (blocked ${heldBy.report.blocked})`}`);
      expect([result.valid, result.regions.length]).toEqual([true, 1]);
      expect(dist(now.start, now.center)).toBeLessThanOrEqual(1e6 * dist(now.start, now.end));
      for (const c of [...Object.values(free.curves), ...Object.values(heldBy.curves)]) expect(curveProblem(c)).toBeUndefined();
    }
  });

  it('L10: names of the file that are names of Object.prototype; slice', () => {
    const svg = readSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><g id="__proto__"><circle r="1"/></g><g id="constructor"><circle r="2"/><toString/></g></svg>');
    const dxf = readDxf(dxfOf(dxfArc('__proto__', 0, 0, 1, 0, 90), dxfArc('constructor', 0, 0, 2, 0, 90), dxfArc('toString', 0, 0, 3, 0, 90), ['0', 'hasOwnProperty', '8', 'valueOf']));
    console.log(`L10 svg layers ${JSON.stringify(svg.about.layers)} skipped ${JSON.stringify(svg.about.skipped)} | dxf layers ${JSON.stringify(dxf.about.layers)} skipped ${JSON.stringify(dxf.about.skipped)} | Object.prototype has circle: ${'circle' in Object.prototype}, ARC: ${'ARC' in Object.prototype}`);
    expect(Object.keys(svg.about.layers)).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(dxf.about.layers)).toEqual(['__proto__', 'constructor', 'toString', 'valueOf']);
    expect(dxf.about.skipped).toEqual({ hasOwnProperty: 1 });
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>).circle).toBeUndefined();
    expect(readDxf(dxfOf(dxfArc('__proto__', 0, 0, 1, 0, 90), dxfArc('a', 0, 0, 2, 0, 90)), { layers: ['__proto__'] }).curves.length).toBe(1);
    const refusal = (run: () => unknown): string => {
      try {
        run();
        return 'read';
      } catch (error) {
        return (error as Error).message.slice(0, 90);
      }
    };
    console.log(`L10 an entity &constructor;: ${refusal(() => readSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="&constructor;"/></svg>'))} | width="5constructor": ${refusal(() => readSvg('<svg xmlns="http://www.w3.org/2000/svg" width="5constructor" height="5mm" viewBox="0 0 5 5"><circle r="1"/></svg>').about.unit)} | the option unit "constructor": ${refusal(() => readDxf(dxfOf(dxfArc('0', 0, 0, 1, 0, 90)), { unit: 'constructor' }))}`);
    expect(refusal(() => readSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="&constructor;"/></svg>'))).toContain('unreadable');
    expect(refusal(() => readDxf(dxfOf(dxfArc('0', 0, 0, 1, 0, 90)), { unit: 'constructor' }))).toContain('invalidArguments');
    // a box of 10 by 10 in a size of 20 mm by 10 mm: meet takes 1 mm per unit, slice 2
    const sized = (fit: string): ReadOutline => readSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 10 10" ${fit}><circle cx="5" cy="5" r="1"/></svg>`);
    const radius = (o: ReadOutline): number => (o.curves[0].curve as { radius: number }).radius;
    console.log(`L10 a box of 10 by 10 in 20 mm by 10 mm: a circle of r 1 is ${radius(sized(''))} mm by default, ${radius(sized('preserveAspectRatio="xMidYMid slice"'))} with slice (${JSON.stringify(sized('preserveAspectRatio="xMidYMid slice"').about.notes)}); none: ${refusal(() => sized('preserveAspectRatio="none"'))}`);
    expect([radius(sized('')), radius(sized('preserveAspectRatio="xMidYMid slice"'))]).toEqual([1, 2]);
  });
});
