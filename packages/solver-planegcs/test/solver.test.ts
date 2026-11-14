import { beforeAll, describe, expect, it } from 'vitest';
import type { Constraint, Curve, Id, Point2, SketchSolver, SolveInput } from '@trymesh/engine';
import { createPlanegcsSolver } from '../src/index';

let solver: SketchSolver;
beforeAll(async () => {
  solver = await createPlanegcsSolver();
});

const input = (parts: Partial<SolveInput>): SolveInput => ({
  points: {},
  radii: {},
  curves: {},
  constraints: {},
  fixed: [],
  ...parts,
});

// Obdélník ukotvený k pevnému počátku, polohy záměrně nepřesné (uživatel kreslí od ruky).
const rect = (extra: Record<Id, Constraint> = {}): SolveInput =>
  input({
    points: {
      origin: { x: 0, y: 0 },
      p1: { x: 1, y: 2 },
      p2: { x: 37, y: -1 },
      p3: { x: 41, y: 26 },
      p4: { x: -2, y: 31 },
    },
    curves: {
      l1: { type: 'line', a: 'p1', b: 'p2' },
      l2: { type: 'line', a: 'p2', b: 'p3' },
      l3: { type: 'line', a: 'p3', b: 'p4' },
      l4: { type: 'line', a: 'p4', b: 'p1' },
    },
    constraints: {
      anchor: { type: 'coincident', a: 'p1', b: 'origin' },
      h1: { type: 'horizontal', line: 'l1' },
      v2: { type: 'vertical', line: 'l2' },
      h3: { type: 'horizontal', line: 'l3' },
      v4: { type: 'vertical', line: 'l4' },
      width: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true },
      ...extra,
    },
    fixed: ['origin'],
  });
const height: Constraint = { type: 'distance', a: 'p2', b: 'p3', value: 30, driving: true };

describe('řešení skici', () => {
  it('plně určený obdélník: vyřešeno, dof 0, pevný bod se nepohne', () => {
    const r = solver.solve(rect({ height }));
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.points.p3!.x).toBeCloseTo(40, 8);
    expect(r.points.p3!.y).toBeCloseTo(30, 8);
    expect(r.points.origin).toEqual({ x: 0, y: 0 });
    expect(r.conflicting).toEqual([]);
    expect(r.redundant).toEqual([]);
  });

  it('podurčený obdélník: dof 1', () => {
    const r = solver.solve(rect());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(1);
  });

  it('konflikt: vrací vstup beze změny, ID vazeb a dof 0', () => {
    const source = rect({ height, width2: { type: 'distance', a: 'p4', b: 'p3', value: 50, driving: true } });
    const r = solver.solve(source);
    expect(r.status).toBe('conflict');
    expect(r.conflicting).toContain('width2');
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.points).toEqual(source.points);
    expect(r.points).not.toBe(source.points);
  });

  it('nadbytečná vazba: vyřešeno, ID v redundant', () => {
    const r = solver.solve(rect({ height, width2: { type: 'distance', a: 'p4', b: 'p3', value: 40, driving: true } }));
    expect(r.status).toBe('solved');
    expect(r.redundant).toContain('width2');
    expect(r.conflicting).toEqual([]);
  });

  it('stejný vstup dá bitově stejný výstup, i při jiném pořadí klíčů', () => {
    const a = solver.solve(rect({ height }));
    const b = solver.solve(rect({ height }));
    expect(b).toEqual(a);
    const source = rect({ height });
    const reversed = <T>(record: Record<Id, T>) => Object.fromEntries(Object.entries(record).reverse());
    const c = solver.solve({ ...source, points: reversed(source.points), curves: reversed(source.curves), constraints: reversed(source.constraints) });
    expect(c).toEqual(a);
  });

  it('splněný vstup se vrátí beze změny (plně určený i podurčený)', () => {
    for (const source of [rect({ height }), rect()]) {
      const first = solver.solve(source);
      const again = solver.solve({ ...source, points: first.points, radii: first.radii });
      expect(again.points).toEqual(first.points);
      expect(again.degreesOfFreedom).toBe(first.degreesOfFreedom);
    }
  });

  it('referenční kóta se solveru neposílá: neubírá dof a nemění geometrii', () => {
    const plain = solver.solve(rect());
    const withRef = solver.solve(rect({ ref: { type: 'distance', a: 'p2', b: 'p3', value: 999, driving: false } }));
    expect(withRef).toEqual(plain);
  });
});

describe('tažení', () => {
  it('drží vazby, sleduje cíl ve volném směru, dof se nemění, vstup zůstává', () => {
    const stored = solver.solve(rect());
    const source = { ...rect(), points: stored.points };
    for (let i = 1; i <= 30; i++) {
      const target = { x: 40 + i * 1.5, y: 26 + i * 2 }; // x je kótou šířky zakázáno
      const r = solver.solve({ ...source, drag: { point: 'p3', target } });
      expect(r.status).toBe('solved');
      expect(r.degreesOfFreedom).toBe(1);
      expect(r.points.p3!.x).toBeCloseTo(40, 6);
      expect(r.points.p3!.y).toBeCloseTo(target.y, 6);
      expect(r.points.p4!.y).toBeCloseTo(target.y, 6);
      expect(r.points.p2!).toEqual({ x: expect.closeTo(40, 6), y: expect.closeTo(0, 6) });
    }
    expect(source.points).toEqual(stored.points);
  });

  it('tažení plně určeného bodu nic nezmění a není konflikt', () => {
    const stored = solver.solve(rect({ height }));
    const r = solver.solve({ ...rect({ height }), points: stored.points, drag: { point: 'p3', target: { x: 80, y: 90 } } });
    expect(r.status).toBe('solved');
    expect(r.points.p3!.x).toBeCloseTo(40, 6);
    expect(r.points.p3!.y).toBeCloseTo(30, 6);
    expect(r.conflicting).toEqual([]);
  });
});

describe('promítnutá geometrie', () => {
  const projected = (): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, 'ext/center': { x: 12, y: 7 }, hc: { x: 10, y: 9 } },
      radii: { ext: 10, hole: 3.3 },
      curves: { ext: { type: 'circle', center: 'ext/center' }, hole: { type: 'circle', center: 'hc' } },
      constraints: { concentric: { type: 'coincident', a: 'hc', b: 'ext/center' } },
      fixed: ['origin', 'ext/center', 'ext'],
    });

  it('soustředná díra: 1 dof, pevná kružnice se nezmění', () => {
    const r = solver.solve(projected());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(1);
    expect(r.points.hc).toEqual({ x: 12, y: 7 });
    expect(r.radii.ext).toBe(10);
    expect(Object.keys(r.radii).sort()).toEqual(['ext', 'hole']);
    expect(Object.keys(r.points).sort()).toEqual(['ext/center', 'hc', 'origin']);
  });

  it('kóta průměru díry: dof 0, poloměr 4', () => {
    const source = projected();
    source.constraints.d = { type: 'diameter', curve: 'hole', value: 8, driving: true };
    const r = solver.solve(source);
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.radii.hole).toBeCloseTo(4, 8);
  });

  it('tečna k pevné kružnici ji nezmění', () => {
    const source = projected();
    source.points.q = { x: 20, y: 20 };
    source.curves.tl = { type: 'line', a: 'origin', b: 'q' };
    source.constraints.tan = { type: 'tangent', a: 'ext', b: 'tl' }; // pořadí operandů je libovolné
    const r = solver.solve(source);
    const q = r.points.q!;
    expect(Math.abs(q.x * 7 - q.y * 12) / Math.hypot(q.x, q.y)).toBeCloseTo(10, 6);
    expect(r.radii.ext).toBe(10);
    expect(r.points['ext/center']).toEqual({ x: 12, y: 7 });
  });

  it('kóta jiného poloměru pevné kružnice: konflikt bez pomocných vazeb adaptéru', () => {
    const source = projected();
    source.constraints.userRadius = { type: 'radius', curve: 'ext', value: 7, driving: true };
    const r = solver.solve(source);
    expect(r.status).toBe('conflict');
    expect(r.conflicting).toEqual(['userRadius']);
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.radii.ext).toBe(10);
  });
});

describe('oblouk', () => {
  const arc = (extra: Record<Id, Constraint> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, c: { x: 10, y: 10 }, s: { x: 21, y: 9 }, e: { x: 11, y: 18 } }, // nesedí na poloměr
      curves: { arc: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constraints: extra,
      fixed: ['origin'],
    });
  const radiusOf = (p: Record<Id, Point2>, id: Id) => Math.hypot(p[id]!.x - p.c!.x, p[id]!.y - p.c!.y);

  it('začátek i konec leží na kótovaném poloměru', () => {
    const r = solver.solve(arc({ r: { type: 'radius', curve: 'arc', value: 8, driving: true } }));
    expect(r.status).toBe('solved');
    expect(radiusOf(r.points, 's')).toBeCloseTo(8, 6);
    expect(radiusOf(r.points, 'e')).toBeCloseTo(8, 6);
    expect(r.redundant).toEqual([]);
  });

  it('volný oblouk má 5 stupňů volnosti a oba konce na stejném poloměru', () => {
    const r = solver.solve(arc());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(5);
    expect(radiusOf(r.points, 's')).toBeCloseTo(radiusOf(r.points, 'e'), 6);
  });

  it('oblouk přes úhel ±π (konec má menší úhel než začátek)', () => {
    const source = input({
      points: { c: { x: 0, y: 0 }, s: { x: -7, y: 7.5 }, e: { x: -7.2, y: -7 } },
      curves: { arc: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constraints: { r: { type: 'radius', curve: 'arc', value: 10, driving: true } },
      fixed: ['c'],
    });
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect(Math.hypot(r.points.s!.x, r.points.s!.y)).toBeCloseTo(10, 6);
    expect(Math.hypot(r.points.e!.x, r.points.e!.y)).toBeCloseTo(10, 6);
    // konce zůstaly na své straně, oblouk se nepřeklopil
    expect(r.points.s!.y).toBeGreaterThan(5);
    expect(r.points.e!.y).toBeLessThan(-5);
  });
});

describe('mapování vazeb', () => {
  const base = (): SolveInput =>
    input({
      points: {
        origin: { x: 0, y: 0 },
        a: { x: 1, y: 1 },
        b: { x: 9, y: 2 },
        c: { x: 8, y: 9 },
        d: { x: 2, y: 8 },
        m: { x: 20, y: 5 },
        m2: { x: 30, y: 6 },
        ac: { x: 40, y: 0 },
        as: { x: 45, y: 0 },
        ae: { x: 40, y: 5 },
        bc: { x: 52, y: 0 },
        bs: { x: 55, y: 0 },
        be: { x: 52, y: 3 },
      },
      radii: { circ: 3, circ2: 2 },
      curves: {
        ab: { type: 'line', a: 'a', b: 'b' },
        cd: { type: 'line', a: 'c', b: 'd' },
        bcLine: { type: 'line', a: 'b', b: 'c' },
        circ: { type: 'circle', center: 'm' },
        circ2: { type: 'circle', center: 'm2' },
        arcA: { type: 'arc', center: 'ac', start: 'as', end: 'ae' },
        arcB: { type: 'arc', center: 'bc', start: 'bs', end: 'be' },
      },
      fixed: ['origin'],
    });
  const d = (shape: object): Constraint => ({ ...shape, driving: true }) as Constraint;
  const variants: Record<string, Constraint> = {
    coincident: { type: 'coincident', a: 'a', b: 'origin' },
    'pointOnCurve úsečka': { type: 'pointOnCurve', point: 'd', curve: 'ab' },
    'pointOnCurve kružnice': { type: 'pointOnCurve', point: 'd', curve: 'circ' },
    'pointOnCurve oblouk': { type: 'pointOnCurve', point: 'd', curve: 'arcA' },
    horizontal: { type: 'horizontal', line: 'ab' },
    vertical: { type: 'vertical', line: 'bcLine' },
    parallel: { type: 'parallel', a: 'ab', b: 'cd' },
    perpendicular: { type: 'perpendicular', a: 'ab', b: 'bcLine' },
    equalLength: { type: 'equalLength', a: 'ab', b: 'cd' },
    'tangent úsečka–kružnice': { type: 'tangent', a: 'ab', b: 'circ' },
    'tangent kružnice–úsečka': { type: 'tangent', a: 'circ', b: 'ab' },
    'tangent úsečka–oblouk': { type: 'tangent', a: 'arcA', b: 'ab' },
    'tangent kružnice–kružnice': { type: 'tangent', a: 'circ', b: 'circ2' },
    'tangent oblouk–kružnice': { type: 'tangent', a: 'arcA', b: 'circ2' },
    'tangent oblouk–oblouk': { type: 'tangent', a: 'arcA', b: 'arcB' },
    distance: d({ type: 'distance', a: 'a', b: 'b', value: 12 }),
    distancePointLine: d({ type: 'distancePointLine', point: 'c', line: 'ab', value: 5 }),
    horizontalDistance: d({ type: 'horizontalDistance', a: 'a', b: 'b', value: 7 }),
    verticalDistance: d({ type: 'verticalDistance', a: 'a', b: 'c', value: 6 }),
    angle: d({ type: 'angle', a: 'ab', b: 'bcLine', value: Math.PI / 3 }),
    'radius kružnice': d({ type: 'radius', curve: 'circ', value: 4 }),
    'radius oblouku': d({ type: 'radius', curve: 'arcA', value: 4 }),
    'diameter kružnice': d({ type: 'diameter', curve: 'circ', value: 9 }),
    'diameter oblouku': d({ type: 'diameter', curve: 'arcA', value: 9 }),
  };

  it.each(Object.entries(variants))('%s ubere aspoň jeden stupeň volnosti', (_name, constraint) => {
    const free = solver.solve(base()).degreesOfFreedom;
    const source = base();
    source.constraints.k = constraint;
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect(free - r.degreesOfFreedom).toBeGreaterThanOrEqual(1);
  });

  const dir = (p: Record<Id, Point2>, from: Id, to: Id) => Math.atan2(p[to]!.y - p[from]!.y, p[to]!.x - p[from]!.x);
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

  it('orientované vzdálenosti znamenají b − a, i záporné', () => {
    for (const value of [7, -7]) {
      const source = base();
      source.constraints.h = d({ type: 'horizontalDistance', a: 'a', b: 'b', value });
      source.constraints.v = d({ type: 'verticalDistance', a: 'a', b: 'b', value: value / 2 });
      const r = solver.solve(source);
      expect(r.status).toBe('solved');
      expect(r.points.b!.x - r.points.a!.x).toBeCloseTo(value, 8);
      expect(r.points.b!.y - r.points.a!.y).toBeCloseTo(value / 2, 8);
    }
  });

  it('úhel se měří od směru a ke směru b proti směru hodin', () => {
    for (const value of [Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3]) {
      const source = base();
      source.constraints.k = d({ type: 'angle', a: 'ab', b: 'cd', value });
      const r = solver.solve(source);
      expect(r.status).toBe('solved');
      expect(wrap(dir(r.points, 'c', 'd') - dir(r.points, 'a', 'b'))).toBeCloseTo(value, 6);
    }
  });

  it('vzdálenost bodu od přímky a tečnost dávají správnou geometrii', () => {
    const source = base();
    source.constraints.k = d({ type: 'distancePointLine', point: 'c', line: 'ab', value: 5 });
    source.constraints.t = { type: 'tangent', a: 'cd', b: 'circ' };
    const r = solver.solve(source);
    const dist = (p: Id, a: Id, b: Id) => {
      const [P, A, B] = [r.points[p]!, r.points[a]!, r.points[b]!];
      return Math.abs((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)) / Math.hypot(B.x - A.x, B.y - A.y);
    };
    expect(dist('c', 'a', 'b')).toBeCloseTo(5, 6);
    expect(dist('m', 'c', 'd')).toBeCloseTo(r.radii.circ!, 6);
  });
});

describe('souměrnost a střed úsečky', () => {
  // svislá osa z pevného počátku a dva body od ruky
  const axis = (constraints: Record<Id, Constraint>, points: Record<Id, Point2> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, top: { x: 0.6, y: 29 }, a: { x: -14, y: 3 }, b: { x: 22, y: 9 }, ...points },
      curves: { axis: { type: 'line', a: 'origin', b: 'top' }, ab: { type: 'line', a: 'a', b: 'b' } },
      constraints: { v: { type: 'vertical', line: 'axis' }, ...constraints },
      fixed: ['origin'],
    });

  it('souměrné body mají stejnou vzdálenost od osy a spojnici na ni kolmou', () => {
    const result = solver.solve(axis({ s: { type: 'symmetric', a: 'a', b: 'b', line: 'axis' } }));
    expect(result.status).toBe('solved');
    const { a, b, top } = result.points;
    expect(top.x).toBeCloseTo(0, 8);
    expect(a.x).toBeCloseTo(-b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
    expect(Math.abs(a.x)).toBeGreaterThan(5); // body se nestáhly na osu
  });

  it('na pořadí souměrných bodů nezáleží a šikmá osa funguje stejně', () => {
    const swapped = solver.solve(axis({ s: { type: 'symmetric', a: 'b', b: 'a', line: 'axis' } }));
    expect(swapped.status).toBe('solved');
    expect(swapped.points.a.x).toBeCloseTo(-swapped.points.b.x, 8);
    // osa pod 45°: zrcadlení zamění souřadnice
    const slanted = solver.solve(input({ points: { origin: { x: 0, y: 0 }, e: { x: 10, y: 10 }, a: { x: 8, y: 1 }, b: { x: 2, y: 9 } }, curves: { axis: { type: 'line', a: 'origin', b: 'e' } }, constraints: { s: { type: 'symmetric', a: 'a', b: 'b', line: 'axis' } }, fixed: ['origin', 'e'] }));
    expect(slanted.status).toBe('solved');
    expect(slanted.points.a.x).toBeCloseTo(slanted.points.b.y, 8);
    expect(slanted.points.a.y).toBeCloseTo(slanted.points.b.x, 8);
  });

  it('bod ve středu úsečky drží střed i po změně její délky', () => {
    const constraints: Record<Id, Constraint> = { m: { type: 'midpoint', point: 'c', line: 'ab' }, h: { type: 'horizontal', line: 'ab' }, fix: { type: 'coincident', a: 'a', b: 'origin' } };
    for (const length of [30, 80]) {
      const result = solver.solve(axis({ ...constraints, len: { type: 'distance', a: 'a', b: 'b', value: length, driving: true } }, { c: { x: 3, y: 4 } }));
      expect(result.status).toBe('solved');
      expect(result.points.c.x).toBeCloseTo(length / 2, 8);
      expect(result.points.c.y).toBeCloseTo(0, 8);
    }
  });

  it('souměrnost podle promítnuté (pevné) úsečky a střed pevné úsečky', () => {
    const fixedLine = input({
      points: { 'x/a': { x: 10, y: 0 }, 'x/b': { x: 10, y: 20 }, a: { x: 4, y: 6 }, b: { x: 15, y: 5 }, c: { x: 9, y: 9 } },
      curves: { x: { type: 'line', a: 'x/a', b: 'x/b' } },
      constraints: { s: { type: 'symmetric', a: 'a', b: 'b', line: 'x' }, m: { type: 'midpoint', point: 'c', line: 'x' } },
      fixed: ['x/a', 'x/b'],
    });
    const result = solver.solve(fixedLine);
    expect(result.status).toBe('solved');
    expect(result.points['x/a']).toEqual({ x: 10, y: 0 });
    expect(result.points.a.x + result.points.b.x).toBeCloseTo(20, 8);
    expect(result.points.a.y).toBeCloseTo(result.points.b.y, 8);
    expect([result.points.c.x, result.points.c.y]).toEqual([expect.closeTo(10, 8), expect.closeTo(10, 8)]);
  });

  it('střed úsečky chce úsečku: kružnice je chyba vstupu', () => {
    const bad = input({ points: { o: { x: 0, y: 0 }, p: { x: 1, y: 1 } }, radii: { k: 3 }, curves: { k: { type: 'circle', center: 'o' } }, constraints: { m: { type: 'midpoint', point: 'p', line: 'k' } } });
    expect(() => solver.solve(bad)).toThrow(/čeká úsečku/);
  });
});

describe('chyby vstupu a okrajové chování', () => {
  it('neznámý bod, křivka a nesprávný druh křivky vyhodí výjimku', () => {
    const curves: Record<Id, Curve> = { l: { type: 'line', a: 'a', b: 'missing' } };
    expect(() => solver.solve(input({ points: { a: { x: 0, y: 0 } }, curves }))).toThrow(/neznámý bod/);
    const source = rect();
    source.constraints.bad = { type: 'horizontal', line: 'nope' };
    expect(() => solver.solve(source)).toThrow(/neznámou křivku/);
    const two = rect();
    two.constraints.bad = { type: 'tangent', a: 'l1', b: 'l2' };
    expect(() => solver.solve(two)).toThrow(/tečnost/);
    expect(() => solver.solve(input({ points: { m: { x: 0, y: 0 } }, curves: { k: { type: 'circle', center: 'm' } } }))).toThrow(/poloměr/);
  });

  it('po výjimce i po konfliktu solver dál funguje', () => {
    expect(() => solver.solve(input({ curves: { l: { type: 'line', a: 'x', b: 'y' } } }))).toThrow();
    expect(solver.solve(rect({ height })).status).toBe('solved');
  });

  it('prázdná skica je vyřešená s dof 0', () => {
    const r = solver.solve(input({}));
    expect(r).toEqual({ status: 'solved', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] });
  });

  it('solver nic nevypisuje', () => {
    const lines: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args);
    try {
      const source = rect({ height });
      source.constraints.h1b = { type: 'horizontal', line: 'l1' };
      const r = solver.solve(source);
      expect(r.redundant).toContain('h1b');
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([]);
  });
});

// Nálezy z revize adaptéru 2026-11-14.
describe('nálezy z revize', () => {
  const clean = (extra: Record<Id, Constraint> = {}): SolveInput => {
    const source = rect(extra);
    source.points = { origin: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, p3: { x: 40, y: 26 }, p4: { x: 0, y: 26 } };
    return source;
  };
  const distanceOf = (p: Record<Id, Point2>, a: Id, b: Id) => Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);

  it.each<[string, Record<Id, Constraint>]>([
    ['kóta protější strany', { width2: { type: 'distance', a: 'p4', b: 'p3', value: 40, driving: true } }],
    ['zdvojená vodorovnost', { h1b: { type: 'horizontal', line: 'l1' } }],
    ['rovnoběžnost protějších stran', { par: { type: 'parallel', a: 'l1', b: 'l3' } }],
  ])('tažení ve skice s nadbytečnou vazbou není konflikt (%s)', (_name, extra) => {
    const source = clean(extra);
    const plain = solver.solve(source);
    expect(plain.status).toBe('solved');
    expect(plain.redundant).toEqual(Object.keys(extra));
    const r = solver.solve({ ...source, drag: { point: 'p3', target: { x: 45, y: 28 } } });
    expect(r.status).toBe('solved');
    expect(r.points.p3!.x).toBeCloseTo(40, 6);
    expect(r.points.p3!.y).toBeCloseTo(28, 6);
    expect(r.degreesOfFreedom).toBe(1);
    expect(r.redundant).toEqual(Object.keys(extra));
  });

  it('tažení ve skice, která je bez tažení v konfliktu, vrátí konflikt', () => {
    const source = clean({ height: { type: 'distance', a: 'p2', b: 'p3', value: 26, driving: true }, width2: { type: 'distance', a: 'p4', b: 'p3', value: 50, driving: true } });
    const r = solver.solve({ ...source, drag: { point: 'p3', target: { x: 45, y: 28 } } });
    expect(r.status).toBe('conflict');
    expect(r.points).toEqual(source.points);
  });

  // Knihovna tu skončí stavem Converged a nadbytečnou vazbu nechá nesplněnou; adaptér řeší dál.
  it('výsledek splňuje i vazby, které knihovna označila za nadbytečné', () => {
    const source = input({
      points: { origin: { x: 0, y: 0 }, p0: { x: -12.4, y: 4.9 }, p1: { x: 6.8, y: -0.2 } },
      curves: { l0: { type: 'line', a: 'origin', b: 'p0' }, l1: { type: 'line', a: 'p1', b: 'origin' } },
      constraints: {
        c0: { type: 'equalLength', a: 'l1', b: 'l0' },
        c1: { type: 'horizontal', line: 'l0' },
        c2: { type: 'vertical', line: 'l0' },
        c3: { type: 'coincident', a: 'p0', b: 'p1' },
      },
      fixed: ['origin'],
    });
    const r = solver.solve(source);
    if (r.status === 'solved') {
      expect(Math.abs(r.points.p0!.x)).toBeLessThan(1e-6); // svislá i vodorovná úsečka z počátku má nulovou délku
      expect(Math.abs(r.points.p0!.y)).toBeLessThan(1e-6);
      expect(distanceOf(r.points, 'p0', 'p1')).toBeLessThan(1e-6);
    } else expect(r.points).toEqual(source.points);
  });

  it('diagnostika popisuje vrácenou geometrii: opakované řešení z výsledku dá totéž', () => {
    const source = input({
      points: { origin: { x: 0, y: 0 }, a: { x: 0, y: 0 }, b: { x: 40, y: 0 }, c: { x: 5, y: 20 }, d: { x: 35, y: 21 } },
      curves: { l1: { type: 'line', a: 'a', b: 'b' }, l2: { type: 'line', a: 'c', b: 'd' } },
      constraints: {
        anchor: { type: 'coincident', a: 'a', b: 'origin' },
        h1: { type: 'horizontal', line: 'l1' },
        h2: { type: 'horizontal', line: 'l2' },
        par: { type: 'parallel', a: 'l1', b: 'l2' },
      },
      fixed: ['origin'],
    });
    const first = solver.solve(source);
    const again = solver.solve({ ...source, points: first.points, radii: first.radii });
    expect(first.status).toBe('solved');
    expect(again).toEqual(first);
    expect(first.redundant).toEqual(['par']);
    expect(first.degreesOfFreedom).toBe(4);
  });

  it('záporný poloměr není řešení', () => {
    const source = input({
      points: { origin: { x: 0, y: 0 }, m: { x: 0, y: 0 }, n: { x: 13, y: 0 } },
      radii: { k: 10, j: 3 },
      curves: { k: { type: 'circle', center: 'm' }, j: { type: 'circle', center: 'n' } },
      constraints: {
        anchor: { type: 'coincident', a: 'm', b: 'origin' },
        rk: { type: 'radius', curve: 'k', value: 10, driving: true },
        tan: { type: 'tangent', a: 'k', b: 'j' },
        d: { type: 'distance', a: 'm', b: 'n', value: 4, driving: true },
        v: { type: 'verticalDistance', a: 'm', b: 'n', value: 0, driving: true },
      },
      fixed: ['origin'],
    });
    const r = solver.solve(source);
    if (r.status === 'solved') expect(r.radii.j).toBeGreaterThan(0);
    else expect(r.radii).toEqual(source.radii);
  });

  it('pevná kružnice s volným středem si drží poloměr bitově', () => {
    const r = solver.solve(
      input({
        points: { origin: { x: 0, y: 0 }, p1: { x: -0.4, y: 0.5 }, p3: { x: -3.7, y: -17.5 } },
        radii: { k0: 5.6 },
        curves: { k0: { type: 'circle', center: 'p3' }, l0: { type: 'line', a: 'p1', b: 'origin' } },
        constraints: { h: { type: 'horizontal', line: 'l0' }, t: { type: 'tangent', a: 'l0', b: 'k0' } },
        fixed: ['origin', 'k0'],
      }),
    );
    expect(r.status).toBe('solved');
    expect(r.radii.k0).toBe(5.6);
  });

  it('oblouk se všemi body pevnými a konci na různých poloměrech není řešení', () => {
    const source = input({
      points: { c: { x: 0, y: 0 }, s: { x: 10, y: 0 }, e: { x: 0, y: 7 } },
      curves: { arc: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      fixed: ['c', 's', 'e'],
    });
    expect(solver.solve(source).status).not.toBe('solved');
  });

  it('neznámý druh křivky, nepřípustné fixed a kolize s pomocnými ID vyhodí výjimku', () => {
    const points = { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 0, y: 5 } };
    const ellipse = { type: 'ellipse', center: 'a', start: 'b', end: 'c' } as unknown as Curve;
    expect(() => solver.solve(input({ points, curves: { e: ellipse } }))).toThrow(/neznámý druh křivky/);
    const arc: Curve = { type: 'arc', center: 'a', start: 'b', end: 'c' };
    expect(() => solver.solve(input({ points, curves: { arc }, fixed: ['arc'] }))).toThrow(/není bod ani kružnice/);
    expect(() => solver.solve(input({ points, fixed: ['ghost'] }))).toThrow(/není bod ani kružnice/);
    expect(() => solver.solve(input({ points: { ...points, '//x': { x: 1, y: 1 } } }))).toThrow(/koliduje/);
  });

  it('výsledek nezávisí na pořadí klíčů ani u skici bez přesného řešení', () => {
    // podurčená skica s oblouky a tečnostmi: výsledek závisí na průběhu iterací
    const source = input({
      points: { origin: { x: 0, y: 0 }, a: { x: 1.3, y: 0.7 }, b: { x: 9.1, y: 2.2 }, c: { x: 8.4, y: 9.3 }, m: { x: 14, y: 3 }, s: { x: 19, y: 4 }, e: { x: 13, y: 8 } },
      radii: { k: 3.1 },
      curves: { ab: { type: 'line', a: 'a', b: 'b' }, bc: { type: 'line', a: 'b', b: 'c' }, k: { type: 'circle', center: 'c' }, arc: { type: 'arc', center: 'm', start: 's', end: 'e' } },
      constraints: {
        t1: { type: 'tangent', a: 'ab', b: 'k' },
        d1: { type: 'distance', a: 'a', b: 'b', value: 11, driving: true },
        an: { type: 'angle', a: 'ab', b: 'bc', value: 1.1, driving: true },
        ra: { type: 'radius', curve: 'arc', value: 6, driving: true },
      },
      fixed: ['origin'],
    });
    const first = solver.solve(source);
    expect(first.status).toBe('solved');
    const reversed = <T>(record: Record<Id, T>) => Object.fromEntries(Object.entries(record).reverse());
    expect(solver.solve({ ...source, points: reversed(source.points), curves: reversed(source.curves), constraints: reversed(source.constraints), radii: reversed(source.radii) })).toEqual(first);
  });

  it('vazby dávají geometrii, kterou jejich jméno slibuje', () => {
    const base = (): SolveInput =>
      input({
        points: { origin: { x: 0, y: 0 }, a: { x: 1, y: 1 }, b: { x: 9, y: 2 }, c: { x: 8, y: 9 }, d: { x: 2, y: 8 }, m: { x: 20, y: 5 }, m2: { x: 30, y: 6 }, ac: { x: 40, y: 0 }, as: { x: 45, y: 0 }, ae: { x: 40, y: 5 } },
        radii: { k: 3, k2: 2 },
        curves: {
          ab: { type: 'line', a: 'a', b: 'b' },
          cd: { type: 'line', a: 'c', b: 'd' },
          k: { type: 'circle', center: 'm' },
          k2: { type: 'circle', center: 'm2' },
          arc: { type: 'arc', center: 'ac', start: 'as', end: 'ae' },
        },
        fixed: ['origin'],
      });
    const solved = (constraint: Constraint) => {
      const source = base();
      source.constraints.k1 = constraint;
      const r = solver.solve(source);
      expect(r.status).toBe('solved');
      return r;
    };
    const vector = (p: Record<Id, Point2>, from: Id, to: Id) => [p[to]!.x - p[from]!.x, p[to]!.y - p[from]!.y];
    const dimension = (shape: object) => ({ ...shape, driving: true }) as Constraint;

    let r = solved({ type: 'equalLength', a: 'ab', b: 'cd' });
    expect(distanceOf(r.points, 'a', 'b')).toBeCloseTo(distanceOf(r.points, 'c', 'd'), 6);
    r = solved({ type: 'parallel', a: 'ab', b: 'cd' });
    let [u, v] = [vector(r.points, 'a', 'b'), vector(r.points, 'c', 'd')];
    expect(u[0] * v[1] - u[1] * v[0]).toBeCloseTo(0, 6);
    r = solved({ type: 'perpendicular', a: 'ab', b: 'cd' });
    [u, v] = [vector(r.points, 'a', 'b'), vector(r.points, 'c', 'd')];
    expect(u[0] * v[0] + u[1] * v[1]).toBeCloseTo(0, 6);
    expect(solved(dimension({ type: 'radius', curve: 'k', value: 4 })).radii.k).toBeCloseTo(4, 8);
    expect(solved(dimension({ type: 'diameter', curve: 'k', value: 9 })).radii.k).toBeCloseTo(4.5, 8);
    expect(distanceOf(solved(dimension({ type: 'radius', curve: 'arc', value: 4 })).points, 'ac', 'as')).toBeCloseTo(4, 6);
    expect(distanceOf(solved(dimension({ type: 'diameter', curve: 'arc', value: 9 })).points, 'ac', 'as')).toBeCloseTo(4.5, 6);
    r = solved({ type: 'tangent', a: 'k', b: 'k2' });
    const centres = distanceOf(r.points, 'm', 'm2');
    expect(Math.min(Math.abs(centres - (r.radii.k! + r.radii.k2!)), Math.abs(centres - Math.abs(r.radii.k! - r.radii.k2!)))).toBeLessThan(1e-6);
    r = solved({ type: 'pointOnCurve', point: 'd', curve: 'arc' });
    expect(distanceOf(r.points, 'd', 'ac')).toBeCloseTo(distanceOf(r.points, 'as', 'ac'), 6);
    expect(distanceOf(r.points, 'd', 'as')).toBeGreaterThan(0.1); // ne totožnost se začátkem oblouku
    r = solved({ type: 'pointOnCurve', point: 'd', curve: 'k' });
    expect(distanceOf(r.points, 'd', 'm')).toBeCloseTo(r.radii.k!, 6);
  });
});
