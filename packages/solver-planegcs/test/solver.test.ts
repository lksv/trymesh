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

// A rectangle anchored to the fixed origin, the positions inexact on purpose (the user draws freehand).
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

describe('solving a sketch', () => {
  it('a fully determined rectangle: solved, dof 0, the fixed point does not move', () => {
    const r = solver.solve(rect({ height }));
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.points.p3!.x).toBeCloseTo(40, 8);
    expect(r.points.p3!.y).toBeCloseTo(30, 8);
    expect(r.points.origin).toEqual({ x: 0, y: 0 });
    expect(r.conflicting).toEqual([]);
    expect(r.redundant).toEqual([]);
  });

  it('an underconstrained rectangle: dof 1', () => {
    const r = solver.solve(rect());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(1);
  });

  it('conflict: returns the input unchanged, the IDs of the constraints and dof 0', () => {
    const source = rect({ height, width2: { type: 'distance', a: 'p4', b: 'p3', value: 50, driving: true } });
    const r = solver.solve(source);
    expect(r.status).toBe('conflict');
    expect(r.conflicting).toContain('width2');
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.points).toEqual(source.points);
    expect(r.points).not.toBe(source.points);
  });

  it('a redundant constraint: solved, the ID in redundant', () => {
    const r = solver.solve(rect({ height, width2: { type: 'distance', a: 'p4', b: 'p3', value: 40, driving: true } }));
    expect(r.status).toBe('solved');
    expect(r.redundant).toContain('width2');
    expect(r.conflicting).toEqual([]);
  });

  it('the same input gives a bitwise identical output, also with another order of keys', () => {
    const a = solver.solve(rect({ height }));
    const b = solver.solve(rect({ height }));
    expect(b).toEqual(a);
    const source = rect({ height });
    const reversed = <T>(record: Record<Id, T>) => Object.fromEntries(Object.entries(record).reverse());
    const c = solver.solve({ ...source, points: reversed(source.points), curves: reversed(source.curves), constraints: reversed(source.constraints) });
    expect(c).toEqual(a);
  });

  it('a satisfied input is returned unchanged (both fully determined and underconstrained)', () => {
    for (const source of [rect({ height }), rect()]) {
      const first = solver.solve(source);
      const again = solver.solve({ ...source, points: first.points, radii: first.radii });
      expect(again.points).toEqual(first.points);
      expect(again.degreesOfFreedom).toBe(first.degreesOfFreedom);
    }
  });

  it('a reference dimension is not sent to the solver: it takes no dof and does not change the geometry', () => {
    const plain = solver.solve(rect());
    const withRef = solver.solve(rect({ ref: { type: 'distance', a: 'p2', b: 'p3', value: 999, driving: false } }));
    expect(withRef).toEqual(plain);
  });
});

describe('dragging', () => {
  it('keeps the constraints, follows the target in the free direction, dof does not change, the input stays', () => {
    const stored = solver.solve(rect());
    const source = { ...rect(), points: stored.points };
    for (let i = 1; i <= 30; i++) {
      const target = { x: 40 + i * 1.5, y: 26 + i * 2 }; // x is forbidden by the width dimension
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

  it('dragging a fully determined point changes nothing and is no conflict', () => {
    const stored = solver.solve(rect({ height }));
    const r = solver.solve({ ...rect({ height }), points: stored.points, drag: { point: 'p3', target: { x: 80, y: 90 } } });
    expect(r.status).toBe('solved');
    expect(r.points.p3!.x).toBeCloseTo(40, 6);
    expect(r.points.p3!.y).toBeCloseTo(30, 6);
    expect(r.conflicting).toEqual([]);
  });
});

describe('projected geometry', () => {
  const projected = (): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, 'ext/center': { x: 12, y: 7 }, hc: { x: 10, y: 9 } },
      radii: { ext: 10, hole: 3.3 },
      curves: { ext: { type: 'circle', center: 'ext/center' }, hole: { type: 'circle', center: 'hc' } },
      constraints: { concentric: { type: 'coincident', a: 'hc', b: 'ext/center' } },
      fixed: ['origin', 'ext/center', 'ext'],
    });

  it('a concentric hole: 1 dof, the fixed circle does not change', () => {
    const r = solver.solve(projected());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(1);
    expect(r.points.hc).toEqual({ x: 12, y: 7 });
    expect(r.radii.ext).toBe(10);
    expect(Object.keys(r.radii).sort()).toEqual(['ext', 'hole']);
    expect(Object.keys(r.points).sort()).toEqual(['ext/center', 'hc', 'origin']);
  });

  it('a diameter dimension of the hole: dof 0, radius 4', () => {
    const source = projected();
    source.constraints.d = { type: 'diameter', curve: 'hole', value: 8, driving: true };
    const r = solver.solve(source);
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.radii.hole).toBeCloseTo(4, 8);
  });

  it('a tangent to a fixed circle does not change it', () => {
    const source = projected();
    source.points.q = { x: 20, y: 20 };
    source.curves.tl = { type: 'line', a: 'origin', b: 'q' };
    source.constraints.tan = { type: 'tangent', a: 'ext', b: 'tl' }; // the order of the operands is arbitrary
    const r = solver.solve(source);
    const q = r.points.q!;
    expect(Math.abs(q.x * 7 - q.y * 12) / Math.hypot(q.x, q.y)).toBeCloseTo(10, 6);
    expect(r.radii.ext).toBe(10);
    expect(r.points['ext/center']).toEqual({ x: 12, y: 7 });
  });

  it('a dimension of another radius of a fixed circle: a conflict without the auxiliary constraints of the adapter', () => {
    const source = projected();
    source.constraints.userRadius = { type: 'radius', curve: 'ext', value: 7, driving: true };
    const r = solver.solve(source);
    expect(r.status).toBe('conflict');
    expect(r.conflicting).toEqual(['userRadius']);
    expect(r.degreesOfFreedom).toBe(0);
    expect(r.radii.ext).toBe(10);
  });
});

describe('arc', () => {
  const arc = (extra: Record<Id, Constraint> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, c: { x: 10, y: 10 }, s: { x: 21, y: 9 }, e: { x: 11, y: 18 } }, // does not fit the radius
      curves: { arc: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constraints: extra,
      fixed: ['origin'],
    });
  const radiusOf = (p: Record<Id, Point2>, id: Id) => Math.hypot(p[id]!.x - p.c!.x, p[id]!.y - p.c!.y);

  it('both the start and the end lie on the dimensioned radius', () => {
    const r = solver.solve(arc({ r: { type: 'radius', curve: 'arc', value: 8, driving: true } }));
    expect(r.status).toBe('solved');
    expect(radiusOf(r.points, 's')).toBeCloseTo(8, 6);
    expect(radiusOf(r.points, 'e')).toBeCloseTo(8, 6);
    expect(r.redundant).toEqual([]);
  });

  it('a free arc has 5 degrees of freedom and both ends on the same radius', () => {
    const r = solver.solve(arc());
    expect(r.status).toBe('solved');
    expect(r.degreesOfFreedom).toBe(5);
    expect(radiusOf(r.points, 's')).toBeCloseTo(radiusOf(r.points, 'e'), 6);
  });

  it('an arc across the angle ±π (the end has a smaller angle than the start)', () => {
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
    // the ends stayed on their side, the arc did not flip over
    expect(r.points.s!.y).toBeGreaterThan(5);
    expect(r.points.e!.y).toBeLessThan(-5);
  });
});

describe('mapping of constraints', () => {
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
    'pointOnCurve line': { type: 'pointOnCurve', point: 'd', curve: 'ab' },
    'pointOnCurve circle': { type: 'pointOnCurve', point: 'd', curve: 'circ' },
    'pointOnCurve arc': { type: 'pointOnCurve', point: 'd', curve: 'arcA' },
    horizontal: { type: 'horizontal', line: 'ab' },
    vertical: { type: 'vertical', line: 'bcLine' },
    parallel: { type: 'parallel', a: 'ab', b: 'cd' },
    perpendicular: { type: 'perpendicular', a: 'ab', b: 'bcLine' },
    equalLength: { type: 'equalLength', a: 'ab', b: 'cd' },
    'equalRadius circle–circle': { type: 'equalRadius', a: 'circ', b: 'circ2' },
    'equalRadius arc–circle': { type: 'equalRadius', a: 'arcA', b: 'circ' },
    'equalRadius circle–arc': { type: 'equalRadius', a: 'circ2', b: 'arcB' },
    'equalRadius arc–arc': { type: 'equalRadius', a: 'arcA', b: 'arcB' },
    fixed: { type: 'fixed', point: 'c', x: -3, y: 12 },
    'tangent line–circle': { type: 'tangent', a: 'ab', b: 'circ' },
    'tangent circle–line': { type: 'tangent', a: 'circ', b: 'ab' },
    'tangent line–arc': { type: 'tangent', a: 'arcA', b: 'ab' },
    'tangent circle–circle': { type: 'tangent', a: 'circ', b: 'circ2' },
    'tangent arc–circle': { type: 'tangent', a: 'arcA', b: 'circ2' },
    'tangent arc–arc': { type: 'tangent', a: 'arcA', b: 'arcB' },
    distance: d({ type: 'distance', a: 'a', b: 'b', value: 12 }),
    distancePointLine: d({ type: 'distancePointLine', point: 'c', line: 'ab', value: 5 }),
    horizontalDistance: d({ type: 'horizontalDistance', a: 'a', b: 'b', value: 7 }),
    verticalDistance: d({ type: 'verticalDistance', a: 'a', b: 'c', value: 6 }),
    angle: d({ type: 'angle', a: 'ab', b: 'bcLine', value: Math.PI / 3 }),
    'radius circle': d({ type: 'radius', curve: 'circ', value: 4 }),
    'radius arc': d({ type: 'radius', curve: 'arcA', value: 4 }),
    'diameter circle': d({ type: 'diameter', curve: 'circ', value: 9 }),
    'diameter arc': d({ type: 'diameter', curve: 'arcA', value: 9 }),
  };

  it.each(Object.entries(variants))('%s takes at least one degree of freedom', (_name, constraint) => {
    const free = solver.solve(base()).degreesOfFreedom;
    const source = base();
    source.constraints.k = constraint;
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect(free - r.degreesOfFreedom).toBeGreaterThanOrEqual(1);
  });

  const dir = (p: Record<Id, Point2>, from: Id, to: Id) => Math.atan2(p[to]!.y - p[from]!.y, p[to]!.x - p[from]!.x);
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

  it('oriented distances mean b − a, also negative ones', () => {
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

  it('the angle is measured from the direction of a to the direction of b counterclockwise', () => {
    for (const value of [Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3]) {
      const source = base();
      source.constraints.k = d({ type: 'angle', a: 'ab', b: 'cd', value });
      const r = solver.solve(source);
      expect(r.status).toBe('solved');
      expect(wrap(dir(r.points, 'c', 'd') - dir(r.points, 'a', 'b'))).toBeCloseTo(value, 6);
    }
  });

  it('the distance of a point from a line and tangency give the right geometry', () => {
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

describe('symmetry and the midpoint of a line', () => {
  // a vertical axis from the fixed origin and two freehand points
  const axis = (constraints: Record<Id, Constraint>, points: Record<Id, Point2> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, top: { x: 0.6, y: 29 }, a: { x: -14, y: 3 }, b: { x: 22, y: 9 }, ...points },
      curves: { axis: { type: 'line', a: 'origin', b: 'top' }, ab: { type: 'line', a: 'a', b: 'b' } },
      constraints: { v: { type: 'vertical', line: 'axis' }, ...constraints },
      fixed: ['origin'],
    });

  it('symmetric points have the same distance from the axis and the line joining them is perpendicular to it', () => {
    const result = solver.solve(axis({ s: { type: 'symmetric', a: 'a', b: 'b', line: 'axis' } }));
    expect(result.status).toBe('solved');
    const { a, b, top } = result.points;
    expect(top.x).toBeCloseTo(0, 8);
    expect(a.x).toBeCloseTo(-b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
    expect(Math.abs(a.x)).toBeGreaterThan(5); // the points did not collapse onto the axis
  });

  it('the order of the symmetric points does not matter and an oblique axis works the same', () => {
    const swapped = solver.solve(axis({ s: { type: 'symmetric', a: 'b', b: 'a', line: 'axis' } }));
    expect(swapped.status).toBe('solved');
    expect(swapped.points.a.x).toBeCloseTo(-swapped.points.b.x, 8);
    // an axis at 45°: the mirror swaps the coordinates
    const slanted = solver.solve(input({ points: { origin: { x: 0, y: 0 }, e: { x: 10, y: 10 }, a: { x: 8, y: 1 }, b: { x: 2, y: 9 } }, curves: { axis: { type: 'line', a: 'origin', b: 'e' } }, constraints: { s: { type: 'symmetric', a: 'a', b: 'b', line: 'axis' } }, fixed: ['origin', 'e'] }));
    expect(slanted.status).toBe('solved');
    expect(slanted.points.a.x).toBeCloseTo(slanted.points.b.y, 8);
    expect(slanted.points.a.y).toBeCloseTo(slanted.points.b.x, 8);
  });

  it('a point at the midpoint of a line keeps the midpoint also after a change of its length', () => {
    const constraints: Record<Id, Constraint> = { m: { type: 'midpoint', point: 'c', line: 'ab' }, h: { type: 'horizontal', line: 'ab' }, fix: { type: 'coincident', a: 'a', b: 'origin' } };
    for (const length of [30, 80]) {
      const result = solver.solve(axis({ ...constraints, len: { type: 'distance', a: 'a', b: 'b', value: length, driving: true } }, { c: { x: 3, y: 4 } }));
      expect(result.status).toBe('solved');
      expect(result.points.c.x).toBeCloseTo(length / 2, 8);
      expect(result.points.c.y).toBeCloseTo(0, 8);
    }
  });

  // In a state where the symmetric points coincide, the library reports the symmetry as a conflict
  // although it is satisfied. The adapter works around it (see Merged symmetry in index.ts).
  describe('symmetric points that collapse on the axis', () => {
    const s: Constraint = { type: 'symmetric', a: 'a', b: 'b', line: 'axis' };
    const forced: Record<string, Constraint> = {
      'point on the axis': { type: 'pointOnCurve', point: 'a', curve: 'axis' },
      'coincident points': { type: 'coincident', a: 'a', b: 'b' },
      'coincident with the origin': { type: 'coincident', a: 'a', b: 'origin' },
      'zero distance': { type: 'distance', a: 'a', b: 'b', value: 0, driving: true },
      'zero horizontal distance': { type: 'horizontalDistance', a: 'a', b: 'b', value: 0, driving: true },
      'zero distance from the axis': { type: 'distancePointLine', point: 'a', line: 'axis', value: 0, driving: true },
    };
    for (const [name, extra] of Object.entries(forced)) {
      it(`${name}: the sketch is solved with both points on the axis`, () => {
        const first = solver.solve(axis({ s }));
        expect(first.status).toBe('solved');
        const result = solver.solve(axis({ s, extra }, first.points));
        expect(result.status).toBe('solved');
        const { a, b } = result.points;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-7);
        expect(a.x).toBeCloseTo(0, 7);
        // and so is the next solve from the collapsed state
        expect(solver.solve(axis({ s, extra }, result.points)).status).toBe('solved');
      });
    }

    it('points that coincide already in the input: off the axis they move apart or onto the axis, on the axis they stay', () => {
      const off = solver.solve(axis({ s }, { a: { x: 7, y: 10 }, b: { x: 7, y: 10 } }));
      expect(off.status).toBe('solved');
      expect(off.points.a.x).toBeCloseTo(-off.points.b.x, 7);
      expect(off.points.a.y).toBeCloseTo(off.points.b.y, 7);
      const on = solver.solve(axis({ s }, { top: { x: 0, y: 29 }, a: { x: 0, y: 10 }, b: { x: 0, y: 10 } }));
      expect(on.status).toBe('solved');
      const apart = solver.solve(axis({ s }, { top: { x: 0, y: 29 }, a: { x: 0, y: 10 }, b: { x: 0, y: 20 } }));
      expect(apart.status).toBe('solved');
      expect(apart.points.a.x).toBeCloseTo(-apart.points.b.x, 7);
    });

    it('collapsed points can be moved apart again by a dimension and by dragging', () => {
      const collapsed = solver.solve(axis({ s, on: forced['point on the axis'] }));
      expect(collapsed.status).toBe('solved');
      const width = solver.solve(axis({ s, w: { type: 'distance', a: 'a', b: 'b', value: 10, driving: true } }, collapsed.points));
      expect(width.status).toBe('solved');
      expect(Math.abs(width.points.a.x)).toBeCloseTo(5, 6);
      expect(width.points.a.x).toBeCloseTo(-width.points.b.x, 7);
      const dragged = solver.solve({ ...axis({ s }, collapsed.points), drag: { point: 'a', target: { x: 6, y: collapsed.points.a.y } } });
      expect(dragged.status).toBe('solved');
      expect(dragged.points.a.x).toBeCloseTo(6, 6);
      expect(dragged.points.b.x).toBeCloseTo(-6, 6);
    });

    it('a real conflict stays a conflict', () => {
      // the axis has a given length; the solver would collapse a free axis to a point and so "satisfy" the constraints
      const result = solver.solve(axis({ s, len: { type: 'distance', a: 'origin', b: 'top', value: 29, driving: true }, on: forced['point on the axis'], w: { type: 'distance', a: 'a', b: 'b', value: 10, driving: true } }));
      expect(result.status).not.toBe('solved');
    });
  });

  it('the midpoint of a line whose ends lie in the same place in the input', () => {
    const result = solver.solve(input({ points: { p: { x: 5, y: 5 }, q: { x: 5, y: 5 }, m: { x: 8, y: 9 } }, curves: { l: { type: 'line', a: 'p', b: 'q' } }, constraints: { mid: { type: 'midpoint', point: 'm', line: 'l' } }, fixed: [] }));
    expect(result.status).toBe('solved');
    const { p, q, m } = result.points;
    expect(m.x).toBeCloseTo((p.x + q.x) / 2, 7);
    expect(m.y).toBeCloseTo((p.y + q.y) / 2, 7);
  });

  it('symmetry about a projected (fixed) line and the midpoint of a fixed line', () => {
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

  it('the midpoint of a line needs a line: a circle is an error of the input', () => {
    const bad = input({ points: { o: { x: 0, y: 0 }, p: { x: 1, y: 1 } }, radii: { k: 3 }, curves: { k: { type: 'circle', center: 'o' } }, constraints: { m: { type: 'midpoint', point: 'p', line: 'k' } } });
    expect(() => solver.solve(bad)).toThrow(/expects a line/);
  });
});

describe('errors of the input and edge behaviour', () => {
  it('an unknown point, curve and a wrong kind of curve throw an exception', () => {
    const curves: Record<Id, Curve> = { l: { type: 'line', a: 'a', b: 'missing' } };
    expect(() => solver.solve(input({ points: { a: { x: 0, y: 0 } }, curves }))).toThrow(/unknown point/);
    const source = rect();
    source.constraints.bad = { type: 'horizontal', line: 'nope' };
    expect(() => solver.solve(source)).toThrow(/an unknown curve/);
    const two = rect();
    two.constraints.bad = { type: 'tangent', a: 'l1', b: 'l2' };
    expect(() => solver.solve(two)).toThrow(/tangency/);
    expect(() => solver.solve(input({ points: { m: { x: 0, y: 0 } }, curves: { k: { type: 'circle', center: 'm' } } }))).toThrow(/radius/);
  });

  it('after an exception and after a conflict the solver still works', () => {
    expect(() => solver.solve(input({ curves: { l: { type: 'line', a: 'x', b: 'y' } } }))).toThrow();
    expect(solver.solve(rect({ height })).status).toBe('solved');
  });

  it('an empty sketch is solved with dof 0', () => {
    const r = solver.solve(input({}));
    expect(r).toEqual({ status: 'solved', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] });
  });

  it('the solver prints nothing', () => {
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

// Findings of the review of the adapter, 2026-11-14.
describe('findings of the review', () => {
  const clean = (extra: Record<Id, Constraint> = {}): SolveInput => {
    const source = rect(extra);
    source.points = { origin: { x: 0, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, p3: { x: 40, y: 26 }, p4: { x: 0, y: 26 } };
    return source;
  };
  const distanceOf = (p: Record<Id, Point2>, a: Id, b: Id) => Math.hypot(p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y);

  it.each<[string, Record<Id, Constraint>]>([
    ['a dimension of the opposite side', { width2: { type: 'distance', a: 'p4', b: 'p3', value: 40, driving: true } }],
    ['a doubled horizontal', { h1b: { type: 'horizontal', line: 'l1' } }],
    ['parallel opposite sides', { par: { type: 'parallel', a: 'l1', b: 'l3' } }],
  ])('a drag in a sketch with a redundant constraint is no conflict (%s)', (_name, extra) => {
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

  it('a drag in a sketch that is in conflict without the drag returns a conflict', () => {
    const source = clean({ height: { type: 'distance', a: 'p2', b: 'p3', value: 26, driving: true }, width2: { type: 'distance', a: 'p4', b: 'p3', value: 50, driving: true } });
    const r = solver.solve({ ...source, drag: { point: 'p3', target: { x: 45, y: 28 } } });
    expect(r.status).toBe('conflict');
    expect(r.points).toEqual(source.points);
  });

  // The library ends here in the state Converged and leaves the redundant constraint unsatisfied; the adapter solves on.
  it('the result satisfies also the constraints the library marked as redundant', () => {
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
      expect(Math.abs(r.points.p0!.x)).toBeLessThan(1e-6); // a line from the origin that is both vertical and horizontal has zero length
      expect(Math.abs(r.points.p0!.y)).toBeLessThan(1e-6);
      expect(distanceOf(r.points, 'p0', 'p1')).toBeLessThan(1e-6);
    } else expect(r.points).toEqual(source.points);
  });

  it('the diagnostics describe the returned geometry: solving again from the result gives the same', () => {
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

  it('a negative radius is no solution', () => {
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

  it('a fixed circle with a free centre keeps its radius bitwise', () => {
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

  it('an arc with all points fixed and its ends on different radii is no solution', () => {
    const source = input({
      points: { c: { x: 0, y: 0 }, s: { x: 10, y: 0 }, e: { x: 0, y: 7 } },
      curves: { arc: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      fixed: ['c', 's', 'e'],
    });
    expect(solver.solve(source).status).not.toBe('solved');
  });

  it('an unknown kind of curve, an inadmissible fixed and a collision with auxiliary IDs throw an exception', () => {
    const points = { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, c: { x: 0, y: 5 } };
    const ellipse = { type: 'ellipse', center: 'a', start: 'b', end: 'c' } as unknown as Curve;
    expect(() => solver.solve(input({ points, curves: { e: ellipse } }))).toThrow(/unknown kind of curve/);
    const arc: Curve = { type: 'arc', center: 'a', start: 'b', end: 'c' };
    expect(() => solver.solve(input({ points, curves: { arc }, fixed: ['arc'] }))).toThrow(/is neither a point nor a circle/);
    expect(() => solver.solve(input({ points, fixed: ['ghost'] }))).toThrow(/is neither a point nor a circle/);
    expect(() => solver.solve(input({ points: { ...points, '//x': { x: 1, y: 1 } } }))).toThrow(/collides/);
  });

  it('the result does not depend on the order of the keys even for a sketch without an exact solution', () => {
    // an underconstrained sketch with arcs and tangencies: the result depends on the course of the iterations
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

  it('constraints give the geometry their name promises', () => {
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
    expect(distanceOf(r.points, 'd', 'as')).toBeGreaterThan(0.1); // not coincidence with the start of the arc
    r = solved({ type: 'pointOnCurve', point: 'd', curve: 'k' });
    expect(distanceOf(r.points, 'd', 'm')).toBeCloseTo(r.radii.k!, 6);
  });
});

describe('equal radius and a fixed point (D35, point 6)', () => {
  const base = (constraints: Record<Id, Constraint> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, m: { x: 20, y: 5 }, m2: { x: 30, y: 6 }, ac: { x: 40, y: 0 }, as: { x: 45, y: 0 }, ae: { x: 40, y: 5 }, bc: { x: 52, y: 0 }, bs: { x: 55, y: 0 }, be: { x: 52, y: 3 }, p: { x: 3, y: 4 } },
      radii: { k: 3, k2: 2 },
      curves: {
        k: { type: 'circle', center: 'm' },
        k2: { type: 'circle', center: 'm2' },
        arcA: { type: 'arc', center: 'ac', start: 'as', end: 'ae' },
        arcB: { type: 'arc', center: 'bc', start: 'bs', end: 'be' },
      },
      constraints,
      fixed: ['origin'],
    });
  const radiusOf = (r: ReturnType<SketchSolver['solve']>, arc: 'arcA' | 'arcB') => {
    const [c, s] = arc === 'arcA' ? ['ac', 'as'] : ['bc', 'bs'];
    return Math.hypot(r.points[s]!.x - r.points[c]!.x, r.points[s]!.y - r.points[c]!.y);
  };
  const radius = (curve: Id, value: number): Constraint => ({ type: 'radius', curve, value, driving: true });

  it('equal radius: circles and arcs in every combination follow the one dimension', () => {
    let r = solver.solve(base({ r: radius('k', 4), eq: { type: 'equalRadius', a: 'k', b: 'k2' } }));
    expect(r.status).toBe('solved');
    expect([r.radii.k, r.radii.k2]).toEqual([expect.closeTo(4, 8), expect.closeTo(4, 8)]);
    // the dimension may be on either of the two
    r = solver.solve(base({ r: radius('k2', 5), eq: { type: 'equalRadius', a: 'k', b: 'k2' } }));
    expect(r.radii.k).toBeCloseTo(5, 8);
    // an arc with a circle, in both orders of the operands
    for (const eq of [{ type: 'equalRadius', a: 'k', b: 'arcA' }, { type: 'equalRadius', a: 'arcA', b: 'k' }] as Constraint[]) {
      r = solver.solve(base({ r: radius('k', 4), eq }));
      expect(r.status).toBe('solved');
      expect(radiusOf(r, 'arcA')).toBeCloseTo(4, 6);
    }
    r = solver.solve(base({ r: radius('arcA', 6), eq: { type: 'equalRadius', a: 'arcB', b: 'arcA' } }));
    expect(r.status).toBe('solved');
    expect(radiusOf(r, 'arcB')).toBeCloseTo(6, 6);
    // a chain: one dimension sizes four curves
    r = solver.solve(base({ r: radius('k', 2.5), e1: { type: 'equalRadius', a: 'k', b: 'k2' }, e2: { type: 'equalRadius', a: 'k2', b: 'arcA' }, e3: { type: 'equalRadius', a: 'arcA', b: 'arcB' } }));
    expect(r.status).toBe('solved');
    expect([r.radii.k2, radiusOf(r, 'arcA'), radiusOf(r, 'arcB')]).toEqual([expect.closeTo(2.5, 6), expect.closeTo(2.5, 6), expect.closeTo(2.5, 6)]);
    // without a dimension the radii only become equal: one degree of freedom less
    const free = solver.solve(base()).degreesOfFreedom;
    r = solver.solve(base({ eq: { type: 'equalRadius', a: 'k', b: 'k2' } }));
    expect(r.radii.k).toBeCloseTo(r.radii.k2!, 8);
    expect(r.degreesOfFreedom).toBe(free - 1);
  });

  it('equal radius: a conflict and a redundant constraint are reported by their IDs', () => {
    const conflict = solver.solve(base({ r1: radius('k', 4), r2: radius('k2', 6), eq: { type: 'equalRadius', a: 'k', b: 'k2' } }));
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicting).toEqual(['eq', 'r1', 'r2']);
    const redundant = solver.solve(base({ r1: radius('k', 4), r2: radius('k2', 4), eq: { type: 'equalRadius', a: 'k', b: 'k2' } }));
    expect(redundant.status).toBe('solved');
    expect(redundant.redundant).toHaveLength(1);
    expect(() => solver.solve({ ...base({ eq: { type: 'equalRadius', a: 'k', b: 'line' } }), curves: { ...base().curves, line: { type: 'line', a: 'm', b: 'm2' } } })).toThrow(/equal radius needs circles or arcs/);
  });

  it('a fixed point goes to its coordinates and takes two degrees of freedom', () => {
    const free = solver.solve(base()).degreesOfFreedom;
    const r = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 10, y: -2 } }));
    expect(r.status).toBe('solved');
    expect(r.points.p).toEqual({ x: expect.closeTo(10, 9), y: expect.closeTo(-2, 9) });
    expect(r.degreesOfFreedom).toBe(free - 2);
    expect(r.redundant).toEqual([]);
    // the centre of a circle or of an arc is a point like any other
    const centre = solver.solve(base({ f: { type: 'fixed', point: 'ac', x: 41, y: 1 } }));
    expect(centre.status).toBe('solved');
    expect(centre.points.ac).toEqual({ x: expect.closeTo(41, 9), y: expect.closeTo(1, 9) });
    // dragging a fixed point does not move it; dragging another point leaves it where it is
    const dragged = solver.solve({ ...base({ f: { type: 'fixed', point: 'p', x: 10, y: -2 } }), drag: { point: 'p', target: { x: 30, y: 30 } } });
    expect(dragged.status).toBe('solved');
    expect(dragged.points.p).toEqual({ x: expect.closeTo(10, 6), y: expect.closeTo(-2, 6) });
    const other = solver.solve({ ...base({ f: { type: 'fixed', point: 'p', x: 10, y: -2 } }), drag: { point: 'm', target: { x: 25, y: 9 } } });
    expect(other.points.m).toEqual({ x: expect.closeTo(25, 6), y: expect.closeTo(9, 6) });
    expect(other.points.p).toEqual({ x: expect.closeTo(10, 6), y: expect.closeTo(-2, 6) });
  });

  it('dragging next to a fixed point whose one coordinate repeats another constraint keeps the point fixed', () => {
    // p is fixed at (5, 0) and also on a horizontal line from the origin: the y of the fixed point
    // or the horizontal constraint is redundant, whichever sorts later; q is 10 from p
    const sketch = (horizontal: Id): SolveInput =>
      input({
        points: { origin: { x: 0, y: 0 }, p: { x: 5, y: 0 }, q: { x: 11, y: 8 } },
        curves: { op: { type: 'line', a: 'origin', b: 'p' }, pq: { type: 'line', a: 'p', b: 'q' } },
        constraints: { [horizontal]: { type: 'horizontal', line: 'op' }, f: { type: 'fixed', point: 'p', x: 5, y: 0 }, len: { type: 'distance', a: 'p', b: 'q', value: 10, driving: true } },
        fixed: ['origin'],
      });
    for (const horizontal of ['a', 'z']) {
      const still = solver.solve({ ...sketch(horizontal), drag: { point: 'p', target: { x: 25, y: 3 } } });
      expect(still.status, horizontal).toBe('solved');
      expect(still.points.p, horizontal).toEqual({ x: expect.closeTo(5, 6), y: expect.closeTo(0, 6) });
      expect(still.points.q, horizontal).toEqual({ x: expect.closeTo(11, 6), y: expect.closeTo(8, 6) });
      // q goes to the point of its circle around p nearest to the target
      const pulled = solver.solve({ ...sketch(horizontal), drag: { point: 'q', target: { x: 40, y: 40 } } });
      const reach = Math.hypot(35, 40);
      expect(pulled.points.p, horizontal).toEqual({ x: expect.closeTo(5, 6), y: expect.closeTo(0, 6) });
      expect(pulled.points.q, horizontal).toEqual({ x: expect.closeTo(5 + (10 * 35) / reach, 3), y: expect.closeTo((10 * 40) / reach, 3) });
    }
  });

  it('a fixed point and a dimension that agrees with it are solved from a rough estimate too', () => {
    // the point starts off the axis it ends on; without starting at the fixed coordinates the
    // library reported a conflict here
    const r = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 6, y: 0 }, d: { type: 'distance', a: 'origin', b: 'p', value: 6, driving: true } }));
    expect(r.status).toBe('solved');
    expect(r.points.p).toEqual({ x: expect.closeTo(6, 8), y: expect.closeTo(0, 8) });
    expect(r.redundant).toHaveLength(1);
  });

  it('a fixed point is one constraint: both of its coordinates report under its ID', () => {
    // 10 mm from the origin is impossible for a point fixed at (10, 3)
    const conflict = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 10, y: 3 }, d: { type: 'distance', a: 'origin', b: 'p', value: 10, driving: true } }));
    expect(conflict.status).toBe('conflict');
    expect(conflict.conflicting).toEqual(['d', 'f']);
    // the coordinate y alone clashes with a vertical distance
    const half = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 10, y: 3 }, v: { type: 'verticalDistance', a: 'origin', b: 'p', value: 5, driving: true } }));
    expect(half.status).toBe('conflict');
    expect(half.conflicting).toEqual(['f', 'v']);
    // a dimension that says the same is redundant; whichever the library names, it is named once
    const redundant = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 6, y: 8 }, d: { type: 'distance', a: 'origin', b: 'p', value: 10, driving: true }, h: { type: 'horizontalDistance', a: 'origin', b: 'p', value: 6, driving: true } }));
    expect(redundant.status).toBe('solved');
    expect(redundant.points.p).toEqual({ x: expect.closeTo(6, 8), y: expect.closeTo(8, 8) });
    expect(redundant.redundant.length).toBeGreaterThanOrEqual(1);
    expect(new Set(redundant.redundant).size).toBe(redundant.redundant.length);
    expect(redundant.redundant.every((id) => ['f', 'd', 'h'].includes(id))).toBe(true);
    // two fixed points and a distance between them that fits
    const pair = solver.solve(base({ f: { type: 'fixed', point: 'p', x: 0, y: 0 }, g: { type: 'fixed', point: 'm', x: 3, y: 4 }, d: { type: 'distance', a: 'p', b: 'm', value: 5, driving: true } }));
    expect(pair.status).toBe('solved');
    expect(pair.redundant).toHaveLength(1);
    expect(['f', 'g', 'd']).toContain(pair.redundant[0]);
    // the result does not depend on the order of the keys
    const one = base({ f: { type: 'fixed', point: 'p', x: 10, y: -2 }, eq: { type: 'equalRadius', a: 'k', b: 'k2' } });
    const reversed = <T,>(record: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.entries(record).reverse());
    expect(solver.solve({ ...one, points: reversed(one.points), constraints: reversed(one.constraints) })).toEqual(solver.solve(one));
  });
});

// D52: a tangency of a line and an arc at a common end (the same point ID, or two points one
// coincident constraint joins) is given to the library as "the radius to that end is square to the
// line". The library's own form has a double root there: drawn exactly, it calls the tangency
// redundant and every later change of a dimension is a conflict.
describe('a tangency of a line and an arc at a common end (D52)', () => {
  // A fillet as the sketch tool draws it: a right corner at the origin, its lines 40 and 30 long,
  // the arc of radius 6 exactly in place, the corner kept on both lines.
  const fillet = (radius: number, extra: Record<Id, Constraint> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, p: { x: 0, y: 0 }, q1: { x: 40, y: 0 }, q2: { x: 0, y: 30 }, t1: { x: 6, y: 0 }, t2: { x: 0, y: 6 }, c: { x: 6, y: 6 } },
      curves: { l1: { type: 'line', a: 't1', b: 'q1' }, l2: { type: 'line', a: 'q2', b: 't2' }, f: { type: 'arc', center: 'c', start: 't2', end: 't1' } },
      constraints: {
        fix: { type: 'coincident', a: 'p', b: 'origin' },
        h: { type: 'horizontal', line: 'l1' },
        v: { type: 'vertical', line: 'l2' },
        w: { type: 'distance', a: 'p', b: 'q1', value: 40, driving: true },
        d: { type: 'distance', a: 'p', b: 'q2', value: 30, driving: true },
        tan1: { type: 'tangent', a: 'l1', b: 'f' },
        tan2: { type: 'tangent', a: 'l2', b: 'f' },
        on1: { type: 'pointOnCurve', point: 'p', curve: 'l1' },
        on2: { type: 'pointOnCurve', point: 'p', curve: 'l2' },
        r: { type: 'radius', curve: 'f', value: radius, driving: true },
        ...extra,
      },
      fixed: ['origin'],
    });
  // A slot 20 long with half circles of radius 5. `shared`: the ends are one point ID; `joined`:
  // the arcs end at points of their own, each joined to the end of a line by one coincident
  // constraint; `third`: joined through a third point (two coincident constraints).
  type Join = 'shared' | 'joined' | 'third';
  const slot = (join: Join): SolveInput => {
    const points: Record<Id, Point2> = { origin: { x: 0, y: 0 }, a: { x: 0, y: -5 }, b: { x: 20, y: -5 }, c: { x: 20, y: 5 }, d: { x: 0, y: 5 }, m1: { x: 0, y: 0 }, m2: { x: 20, y: 0 } };
    const end = (k: 'a' | 'b' | 'c' | 'd'): Id => (join === 'shared' ? k : `${k}2`);
    const constraints: Record<Id, Constraint> = {};
    for (const k of join === 'shared' ? [] : (['a', 'b', 'c', 'd'] as const)) {
      points[`${k}2`] = { ...points[k] };
      if (join === 'joined') constraints[`j${k}`] = { type: 'coincident', a: k, b: `${k}2` };
      else {
        points[`${k}3`] = { ...points[k] };
        constraints[`j${k}`] = { type: 'coincident', a: k, b: `${k}3` };
        constraints[`k${k}`] = { type: 'coincident', a: `${k}3`, b: `${k}2` };
      }
    }
    return input({
      points,
      curves: { bot: { type: 'line', a: 'a', b: 'b' }, top: { type: 'line', a: 'c', b: 'd' }, right: { type: 'arc', center: 'm2', start: end('b'), end: end('c') }, left: { type: 'arc', center: 'm1', start: end('d'), end: end('a') } },
      constraints: {
        ...constraints,
        t1: { type: 'tangent', a: 'bot', b: 'right' },
        t2: { type: 'tangent', a: 'top', b: 'right' },
        t3: { type: 'tangent', a: 'top', b: 'left' },
        t4: { type: 'tangent', a: 'bot', b: 'left' },
        fix: { type: 'coincident', a: 'm1', b: 'origin' },
        h: { type: 'horizontal', line: 'bot' },
        r: { type: 'radius', curve: 'left', value: 5, driving: true },
        len: { type: 'horizontalDistance', a: 'm1', b: 'm2', value: 20, driving: true },
        r2: { type: 'radius', curve: 'right', value: 5, driving: true },
      },
      fixed: ['origin'],
    });
  };
  // Each change of a dimension solved from the last solution, as the engine does; the statuses.
  const changes = (start: SolveInput, steps: [Id, number][]): { statuses: string[]; last: SolveInput } => {
    let current = start;
    const statuses = [solver.solve(current).status as string];
    for (const [id, value] of steps) {
      current = { ...current, constraints: { ...current.constraints, [id]: { ...current.constraints[id], value } as Constraint } };
      const result = solver.solve(current);
      statuses.push(result.status);
      if (result.status === 'solved') current = { ...current, points: result.points };
    }
    return { statuses, last: current };
  };
  const SLOT_CHANGES: [Id, number][] = [['r', 6], ['r2', 6], ['len', 30], ['r', 5], ['r2', 5], ['len', 20.5]];
  const near = (p: Point2, x: number, y: number) => expect(p).toEqual({ x: expect.closeTo(x, 9), y: expect.closeTo(y, 9) });

  it('a fillet drawn exactly is solved again with another radius; nothing is redundant', () => {
    const first = solver.solve(fillet(6));
    expect(first).toMatchObject({ status: 'solved', redundant: [], conflicting: [] });
    const changed = solver.solve(fillet(10));
    expect(changed.status).toBe('solved');
    near(changed.points.t1!, 10, 0);
    near(changed.points.t2!, 0, 10);
    near(changed.points.c!, 10, 10);
    near(changed.points.p!, 0, 0);
    expect(changes(fillet(6), [['r', 10], ['r', 1], ['r', 29], ['r', 6]]).statuses).toEqual(['solved', 'solved', 'solved', 'solved', 'solved']);
  });

  it('a slot drawn exactly is solved after every change, with the ends as one point and joined by a coincident constraint', () => {
    for (const join of ['shared', 'joined'] as const) {
      expect(solver.solve(slot(join)).redundant, join).toEqual([]);
      const { statuses, last } = changes(slot(join), SLOT_CHANGES);
      expect(statuses, join).toEqual(Array(7).fill('solved'));
      // the last shape: 20.5 long, radius 5, the lines tangent at the ends of the arcs
      const p = solver.solve(last).points;
      near(p.m2!, 20.5, 0);
      near(p.b!, 20.5, -5);
      near(p.c!, 20.5, 5);
      near(p.d!, 0, 5);
    }
  });

  it('the tangency keeps its ID in conflicting', () => {
    // the end of the arc 3 from the corner contradicts a fillet of 6 at a right angle
    const result = solver.solve(fillet(6, { bad: { type: 'distance', a: 'p', b: 't1', value: 3, driving: true } }));
    expect(result.status).toBe('conflict');
    expect(result.conflicting).toContain('bad');
    expect(result.conflicting.some((id) => id === 'tan1' || id === 'tan2')).toBe(true);
    expect(result.conflicting.every((id) => !id.startsWith('/'))).toBe(true);
  });

  it('a drag of the end of a determined fillet keeps the arc on its line', () => {
    const dragged = solver.solve({ ...fillet(6), drag: { point: 't1', target: { x: 20, y: 3 } } });
    expect(dragged.status).toBe('solved');
    near(dragged.points.t1!, 6, 0);
    near(dragged.points.c!, 6, 6);
  });

  it('a line that ends at the origin, and a projected line joined to the end of the arc, keep their tangency under a change', () => {
    const atOrigin = input({
      points: { origin: { x: 0, y: 0 }, q: { x: 30, y: 0 }, c: { x: 0, y: 6 }, e: { x: -6, y: 6 } },
      curves: { l: { type: 'line', a: 'origin', b: 'q' }, f: { type: 'arc', center: 'c', start: 'origin', end: 'e' } },
      constraints: { h: { type: 'horizontal', line: 'l' }, t: { type: 'tangent', a: 'l', b: 'f' }, r: { type: 'radius', curve: 'f', value: 6, driving: true }, ey: { type: 'verticalDistance', a: 'c', b: 'e', value: 0, driving: true } },
      fixed: ['origin'],
    });
    const origin = changes(atOrigin, [['r', 10], ['r', 3]]);
    expect(origin.statuses).toEqual(['solved', 'solved', 'solved']);
    near(solver.solve(origin.last).points.c!, 0, 3);
    // the projected line is a line of the input with two fixed points; a snap joins the arc to it
    const projected = input({
      points: { origin: { x: 0, y: 0 }, 'x/a': { x: 0, y: 0 }, 'x/b': { x: 30, y: 0 }, s: { x: 30, y: 0 }, c: { x: 30, y: 6 }, e: { x: 36, y: 6 } },
      curves: { x: { type: 'line', a: 'x/a', b: 'x/b' }, f: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constraints: { snap: { type: 'coincident', a: 's', b: 'x/b' }, t: { type: 'tangent', a: 'x', b: 'f' }, r: { type: 'radius', curve: 'f', value: 6, driving: true }, ey: { type: 'verticalDistance', a: 'c', b: 'e', value: 0, driving: true } },
      fixed: ['origin', 'x/a', 'x/b'],
    });
    const edge = changes(projected, [['r', 10], ['r', 3]]);
    expect(edge.statuses).toEqual(['solved', 'solved', 'solved']);
    near(solver.solve(edge.last).points.c!, 30, 3);
  });

  // Known limits, pinned as they are.
  it('a join through a third point and two arcs keep the form of the library, with its defect', () => {
    const third = changes(slot('third'), SLOT_CHANGES);
    expect(solver.solve(slot('third')).redundant).toEqual(['t1', 't2', 't3', 't4']);
    expect(third.statuses.filter((status) => status === 'conflict')).toHaveLength(5);
    // an S of two arcs that join smoothly at a common end, drawn exactly
    const esse = input({
      points: { origin: { x: 0, y: 0 }, m1: { x: 0, y: 0 }, s1: { x: -5, y: 0 }, q: { x: 0, y: 5 }, m2: { x: 0, y: 10 }, e: { x: 5, y: 10 } },
      curves: { r1: { type: 'arc', center: 'm1', start: 'q', end: 's1' }, r2: { type: 'arc', center: 'm2', start: 'q', end: 'e' } },
      constraints: {
        t: { type: 'tangent', a: 'r1', b: 'r2' },
        fix: { type: 'coincident', a: 'm1', b: 'origin' },
        ra: { type: 'radius', curve: 'r1', value: 5, driving: true },
        rb: { type: 'radius', curve: 'r2', value: 5, driving: true },
        qx: { type: 'horizontalDistance', a: 'origin', b: 'q', value: 0, driving: true },
        s1y: { type: 'verticalDistance', a: 'origin', b: 's1', value: 0, driving: true },
        ey: { type: 'verticalDistance', a: 'm2', b: 'e', value: 0, driving: true },
      },
      fixed: ['origin'],
    });
    expect(changes(esse, [['ra', 6], ['rb', 4], ['ra', 5], ['rb', 5]]).statuses).toEqual(['solved', 'solved', 'conflict', 'conflict', 'solved']);
  });

  it('a line and an arc with all points fixed slightly off tangent are a conflict (the library form called it solved below about 1e-4)', () => {
    for (const off of [1e-9, 1e-6]) {
      const radius = Math.hypot(off, 1);
      const at: [Id, number, number][] = [['a', 0, 0], ['b', 10, 0], ['c', off, 1], ['e', off + radius, 1]];
      const result = solver.solve(
        input({
          points: { origin: { x: 0, y: 0 }, ...Object.fromEntries(at.map(([id, x, y]) => [id, { x, y }])) },
          curves: { l: { type: 'line', a: 'a', b: 'b' }, f: { type: 'arc', center: 'c', start: 'a', end: 'e' } },
          constraints: { t: { type: 'tangent', a: 'l', b: 'f' }, ...Object.fromEntries(at.map(([id, x, y]): [Id, Constraint] => [`fix${id}`, { type: 'fixed', point: id, x, y }])) },
          fixed: ['origin'],
        }),
      );
      expect(result.status, String(off)).toBe('conflict');
      expect(result.conflicting).toEqual(['fixa', 'fixb', 'fixc', 'fixe', 't']);
    }
  });

  it('review of D52: a line whose two ends are joined to the two ends of the arc gives one result whatever the order of the keys', () => {
    const chord = input({
      points: { origin: { x: 0, y: 0 }, a: { x: -3, y: 4 }, b: { x: 5, y: 0 }, s: { x: 5, y: 0 }, e: { x: -3, y: 4 }, c: { x: 0, y: 0 } },
      curves: { l: { type: 'line', a: 'a', b: 'b' }, f: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constraints: { j1: { type: 'coincident', a: 's', b: 'b' }, j2: { type: 'coincident', a: 'e', b: 'a' }, t: { type: 'tangent', a: 'l', b: 'f' }, fix: { type: 'coincident', a: 'c', b: 'origin' } },
      fixed: ['origin'],
    });
    const reversed = <T,>(record: Record<Id, T>): Record<Id, T> => Object.fromEntries(Object.entries(record).reverse());
    expect(solver.solve({ ...chord, points: reversed(chord.points), constraints: reversed(chord.constraints) })).toEqual(solver.solve(chord));
  });

  it('nothing keeps a fillet a fillet: a radius past the fit is solved into an arc beyond the end of a line', () => {
    // the lines are 40 and 30 long, so a fillet at the right angle fits below 30
    const result = solver.solve(fillet(50));
    expect(result.status).toBe('solved');
    expect(result.points.t2!.y).toBeGreaterThan(30);
  });
});

describe('two points level or plumb, the midpoint of two points, the distance of two lines and of a line and a circle (D75)', () => {
  const dim = (shape: object): Constraint => ({ ...shape, driving: true }) as Constraint;
  // the signed distance of a point from the line through two points (positive to the left of a → b)
  const off = (p: Point2, a: Point2, b: Point2): number => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  const cross = (r: { points: Record<Id, Point2> }, [a, b, c, e]: Id[]): number => {
    const [A, B, C, E] = [r.points[a], r.points[b], r.points[c], r.points[e]];
    return ((B.x - A.x) * (E.y - C.y) - (B.y - A.y) * (E.x - C.x)) / (Math.hypot(B.x - A.x, B.y - A.y) * Math.hypot(E.x - C.x, E.y - C.y));
  };
  // two freehand lines 30° apart, the first one held by the fixed origin
  const lines = (constraints: Record<Id, Constraint>, points: Record<Id, Point2> = {}): SolveInput =>
    input({
      points: { origin: { x: 0, y: 0 }, a: { x: 0, y: 0 }, b: { x: 40, y: 1 }, c: { x: 3, y: 12 }, e: { x: 38, y: 33 }, ...points },
      curves: { ab: { type: 'line', a: 'a', b: 'b' }, ce: { type: 'line', a: 'c', b: 'e' } },
      constraints: { anchor: { type: 'coincident', a: 'a', b: 'origin' }, h: { type: 'horizontal', line: 'ab' }, ...constraints },
      fixed: ['origin'],
    });

  it('two points level have one y and two points plumb one x; each takes one degree of freedom', () => {
    const free = input({ points: { origin: { x: 0, y: 0 }, p: { x: 7, y: 3 }, q: { x: 21, y: -6 } }, fixed: ['origin'] });
    expect(solver.solve(free).degreesOfFreedom).toBe(4);
    const level = solver.solve({ ...free, constraints: { k: { type: 'horizontalPoints', a: 'p', b: 'q' } } });
    expect(level).toMatchObject({ status: 'solved', degreesOfFreedom: 3, redundant: [] });
    expect(level.points.p.y).toBeCloseTo(level.points.q.y, 9);
    expect(level.points.p.x).not.toBeCloseTo(level.points.q.x, 3);
    const plumb = solver.solve({ ...free, constraints: { k: { type: 'verticalPoints', a: 'q', b: 'origin' } } });
    expect(plumb).toMatchObject({ status: 'solved', degreesOfFreedom: 3 });
    expect(plumb.points.q).toEqual({ x: expect.closeTo(0, 9), y: expect.closeTo(-6, 6) });
    // against a vertical distance that is not 0 a conflict by the IDs; with one of 0 redundant
    const clash = solver.solve({ ...free, constraints: { k: { type: 'horizontalPoints', a: 'p', b: 'q' }, v: dim({ type: 'verticalDistance', a: 'p', b: 'q', value: 5 }) } });
    expect(clash).toMatchObject({ status: 'conflict', conflicting: ['k', 'v'] });
    const twice = solver.solve({ ...free, constraints: { k: { type: 'horizontalPoints', a: 'p', b: 'q' }, v: dim({ type: 'verticalDistance', a: 'p', b: 'q', value: 0 }) } });
    expect(twice.status).toBe('solved');
    expect(twice.redundant).toHaveLength(1);
    expect(twice.degreesOfFreedom).toBe(3);
  });

  it('the midpoint of two points follows them, in either order, and takes two degrees of freedom', () => {
    for (const [a, b] of [['p', 'q'], ['q', 'p']]) {
      const source = input({
        points: { origin: { x: 0, y: 0 }, p: { x: 0, y: 0 }, q: { x: 30, y: 8 }, m: { x: 9, y: 20 } },
        constraints: { anchor: { type: 'coincident', a: 'p', b: 'origin' }, mid: { type: 'midpointPoints', point: 'm', a, b }, far: dim({ type: 'distance', a: 'p', b: 'q', value: 50 }) },
        fixed: ['origin'],
      });
      const r = solver.solve(source);
      expect(r).toMatchObject({ status: 'solved', degreesOfFreedom: 1, redundant: [] });
      expect(Math.hypot(r.points.q.x, r.points.q.y)).toBeCloseTo(50, 6);
      expect([r.points.m.x, r.points.m.y]).toEqual([expect.closeTo(r.points.q.x / 2, 7), expect.closeTo(r.points.q.y / 2, 7)]);
      // dragged, the middle pulls the far point twice as far
      const dragged = solver.solve({ ...source, points: r.points, drag: { point: 'm', target: { x: 0, y: 25 } } });
      expect(dragged.status).toBe('solved');
      expect([dragged.points.q.x, dragged.points.q.y]).toEqual([expect.closeTo(0, 5), expect.closeTo(50, 5)]);
    }
  });

  it('the midpoint of two points that lie at one place in the input, and of two points held together', () => {
    // the library takes the middle from the line joining the two: merged, it calls the met constraint a conflict
    const merged = solver.solve(input({ points: { p: { x: 5, y: 5 }, q: { x: 5, y: 5 }, m: { x: 8, y: 9 } }, constraints: { mid: { type: 'midpointPoints', point: 'm', a: 'p', b: 'q' } } }));
    expect(merged.status).toBe('solved');
    expect(merged.points.m.x).toBeCloseTo((merged.points.p.x + merged.points.q.x) / 2, 7);
    expect(merged.points.m.y).toBeCloseTo((merged.points.p.y + merged.points.q.y) / 2, 7);
    // held together by a coincident constraint the three are one point
    const held = solver.solve(
      input({
        points: { origin: { x: 0, y: 0 }, p: { x: 5, y: 5 }, q: { x: 5, y: 5 }, m: { x: 8, y: 9 } },
        constraints: { join: { type: 'coincident', a: 'p', b: 'q' }, mid: { type: 'midpointPoints', point: 'm', a: 'p', b: 'q' }, at: { type: 'fixed', point: 'p', x: 5, y: 5 } },
        fixed: ['origin'],
      }),
    );
    expect(held.status).toBe('solved');
    for (const id of ['p', 'q', 'm']) expect(held.points[id]).toEqual({ x: expect.closeTo(5, 7), y: expect.closeTo(5, 7) });
  });

  it('the distance of two lines turns them parallel at the distance, on the side the second was drawn on', () => {
    for (const [a, b] of [['ab', 'ce'], ['ce', 'ab']]) {
      for (const side of [1, -1]) {
        const source = lines({ k: dim({ type: 'distanceLineLine', a, b, value: 15 }) }, { c: { x: 3, y: 12 * side }, e: { x: 38, y: 33 * side } });
        const r = solver.solve(source);
        expect(r, `${a} ${side}`).toMatchObject({ status: 'solved', redundant: [] });
        expect(r.degreesOfFreedom).toBe(solver.solve(lines({}, source.points)).degreesOfFreedom - 2); // two equations
        expect(cross(r, ['a', 'b', 'c', 'e'])).toBeCloseTo(0, 8);
        expect(r.points.c.y).toBeCloseTo(15 * side, 6);
        expect(r.points.e.y).toBeCloseTo(15 * side, 6);
        // another value from the solved state
        const wider = solver.solve({ ...source, points: r.points, constraints: { ...source.constraints, k: dim({ type: 'distanceLineLine', a, b, value: 22.5 }) } });
        expect(wider.status).toBe('solved');
        expect([wider.points.c.y, wider.points.e.y]).toEqual([expect.closeTo(22.5 * side, 6), expect.closeTo(22.5 * side, 6)]);
      }
    }
  });

  it('a distance of two lines of 0 puts them on one line, and back apart again', () => {
    const source = lines({ k: dim({ type: 'distanceLineLine', a: 'ce', b: 'ab', value: 0 }) });
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect([r.points.c.y, r.points.e.y]).toEqual([expect.closeTo(0, 7), expect.closeTo(0, 7)]);
    expect(r.degreesOfFreedom).toBe(solver.solve(lines({})).degreesOfFreedom - 2);
    const apart = solver.solve({ ...source, points: r.points, constraints: { ...source.constraints, k: dim({ type: 'distanceLineLine', a: 'ce', b: 'ab', value: 4 }) } });
    expect(apart.status).toBe('solved');
    expect(Math.abs(apart.points.c.y)).toBeCloseTo(4, 6);
    expect(apart.points.e.y).toBeCloseTo(apart.points.c.y, 6);
  });

  it('a parallel beside the distance of two lines is redundant and only once; a drag keeps both', () => {
    const source = lines({ k: dim({ type: 'distanceLineLine', a: 'ab', b: 'ce', value: 15 }), par: { type: 'parallel', a: 'ce', b: 'ab' } });
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect(r.redundant).toHaveLength(1);
    expect(['k', 'par']).toContain(r.redundant[0]);
    expect(r.degreesOfFreedom).toBe(solver.solve(lines({})).degreesOfFreedom - 2);
    // the distance holds while an end of the second line is dragged along it
    for (let i = 1; i <= 10; i++) {
      const dragged = solver.solve({ ...source, points: r.points, drag: { point: 'e', target: { x: 38 + 3 * i, y: 15 + 2 * i } } });
      expect(dragged.status, String(i)).toBe('solved');
      expect([dragged.points.c.y, dragged.points.e.y]).toEqual([expect.closeTo(15, 6), expect.closeTo(15, 6)]);
      expect(dragged.points.e.x).toBeCloseTo(38 + 3 * i, 5);
    }
  });

  it('the distance of two lines against another distance of them is a conflict by its ID; to a fixed line it moves only the free one', () => {
    // added to the solved sketch, as a user adds it: the library finds the dependent rows there
    const k = dim({ type: 'distanceLineLine', a: 'ab', b: 'ce', value: 15 });
    const other = dim({ type: 'distancePointLine', point: 'e', line: 'ab', value: 20 });
    const solved = solver.solve(lines({ k }));
    const clash = solver.solve(lines({ k, other }, solved.points));
    expect(clash.status).toBe('conflict');
    expect(clash.conflicting).toEqual(['k', 'other']);
    // From a freehand estimate the library does not see the dependence and only fails, and so it
    // does with the same written by a parallel and a distance of a point; against a perpendicular
    // there is no solution at all, as for a `parallel`.
    const spelled: Record<Id, Constraint> = { par: { type: 'parallel', a: 'ab', b: 'ce' }, d: dim({ type: 'distancePointLine', point: 'a', line: 'ce', value: 15 }) };
    const perpendicular: Constraint = { type: 'perpendicular', a: 'ab', b: 'ce' };
    for (const against of [other, perpendicular]) {
      const [one, two] = [solver.solve(lines({ k, against })), solver.solve(lines({ ...spelled, against }))];
      expect(one.status).not.toBe('solved');
      expect([one.status, one.conflicting.length > 0]).toEqual([two.status, two.conflicting.length > 0]);
    }
    const fixedLine = input({
      points: { 'x/a': { x: 10, y: 0 }, 'x/b': { x: 10, y: 20 }, p: { x: 14, y: 3 }, q: { x: 19, y: 31 } },
      curves: { x: { type: 'line', a: 'x/a', b: 'x/b' }, pq: { type: 'line', a: 'p', b: 'q' } },
      constraints: { k: dim({ type: 'distanceLineLine', a: 'x', b: 'pq', value: 6 }) },
      fixed: ['x/a', 'x/b'],
    });
    const r = solver.solve(fixedLine);
    expect(r.status).toBe('solved');
    expect(r.points['x/a']).toEqual({ x: 10, y: 0 });
    expect(r.points['x/b']).toEqual({ x: 10, y: 20 });
    expect([r.points.p.x, r.points.q.x]).toEqual([expect.closeTo(16, 6), expect.closeTo(16, 6)]);
  });

  it('the distance of a line and a circle is the gap to its rim, kept when the radius changes, on the side of the centre', () => {
    for (const side of [1, -1]) {
      const source = input({
        points: { origin: { x: 0, y: 0 }, a: { x: 0, y: 0 }, b: { x: 40, y: 1 }, m: { x: 18, y: 9 * side } },
        radii: { k: 6 },
        curves: { ab: { type: 'line', a: 'a', b: 'b' }, k: { type: 'circle', center: 'm' } },
        constraints: { anchor: { type: 'coincident', a: 'a', b: 'origin' }, h: { type: 'horizontal', line: 'ab' }, gap: dim({ type: 'distanceLineCircle', line: 'ab', curve: 'k', value: 4 }), size: dim({ type: 'radius', curve: 'k', value: 6 }) },
        fixed: ['origin'],
      });
      const free = solver.solve({ ...source, constraints: { anchor: source.constraints.anchor, h: source.constraints.h, size: source.constraints.size } });
      const r = solver.solve(source);
      expect(r, String(side)).toMatchObject({ status: 'solved', redundant: [], degreesOfFreedom: free.degreesOfFreedom - 1 });
      expect(off(r.points.m, r.points.a, r.points.b)).toBeCloseTo(10 * side, 6);
      const larger = solver.solve({ ...source, points: r.points, radii: r.radii, constraints: { ...source.constraints, size: dim({ type: 'radius', curve: 'k', value: 11 }) } });
      expect(larger.status).toBe('solved');
      expect(larger.radii.k).toBeCloseTo(11, 7);
      expect(off(larger.points.m, larger.points.a, larger.points.b)).toBeCloseTo(15 * side, 6);
    }
  });

  it('a circle drawn across the line is moved off it to the side of its centre; a gap of 0 touches', () => {
    const source = (value: number): SolveInput =>
      input({
        points: { origin: { x: 0, y: 0 }, far: { x: 40, y: 0 }, m: { x: 18, y: -2 } },
        radii: { k: 6 },
        curves: { ab: { type: 'line', a: 'origin', b: 'far' }, k: { type: 'circle', center: 'm' } },
        constraints: { gap: dim({ type: 'distanceLineCircle', line: 'ab', curve: 'k', value }), size: dim({ type: 'radius', curve: 'k', value: 6 }) },
        fixed: ['origin', 'far'],
      });
    const across = solver.solve(source(3));
    expect(across.status).toBe('solved');
    expect(across.points.m.y).toBeCloseTo(-9, 6);
    const touching = solver.solve(source(0));
    expect(touching.status).toBe('solved');
    expect(touching.points.m.y).toBeCloseTo(-6, 6);
    // and from touching to a gap again
    const again = solver.solve({ ...source(2.5), points: touching.points, radii: touching.radii });
    expect(again.status).toBe('solved');
    expect(again.points.m.y).toBeCloseTo(-8.5, 6);
  });

  it('the distance of a line and an arc measures the whole circle of the arc', () => {
    const source = input({
      points: { origin: { x: 0, y: 0 }, far: { x: 40, y: 0 }, z: { x: 20, y: 30 }, s: { x: 30, y: 30 }, e: { x: 20, y: 41 } },
      curves: { ab: { type: 'line', a: 'origin', b: 'far' }, r: { type: 'arc', center: 'z', start: 's', end: 'e' } },
      constraints: { gap: dim({ type: 'distanceLineCircle', line: 'ab', curve: 'r', value: 7 }), size: dim({ type: 'radius', curve: 'r', value: 10 }) },
      fixed: ['origin', 'far'],
    });
    const r = solver.solve(source);
    expect(r).toMatchObject({ status: 'solved', redundant: [] });
    const { z, s, e } = r.points;
    expect(z.y).toBeCloseTo(17, 6); // the arc is the upper right quarter, yet its lowest point of the circle is 7 above the line
    expect(Math.hypot(s.x - z.x, s.y - z.y)).toBeCloseTo(10, 6);
    expect(Math.hypot(e.x - z.x, e.y - z.y)).toBeCloseTo(10, 6);
    expect(r.degreesOfFreedom).toBe(solver.solve({ ...source, constraints: { size: source.constraints.size } }).degreesOfFreedom - 1);
  });

  it('a reference dimension of the new kinds is not sent to the solver; a wrong kind of curve is an error of the input', () => {
    const source = lines({ k: { type: 'distanceLineLine', a: 'ab', b: 'ce', value: 15, driving: false } });
    const r = solver.solve(source);
    expect(r.status).toBe('solved');
    expect(Math.abs(cross(r, ['a', 'b', 'c', 'e']))).toBeGreaterThan(0.1);
    const round = { radii: { k: 3 }, points: { o: { x: 0, y: 0 }, p: { x: 9, y: 1 }, q: { x: 9, y: 8 } } };
    expect(() => solver.solve(input({ ...round, curves: { k: { type: 'circle', center: 'o' }, pq: { type: 'line', a: 'p', b: 'q' } }, constraints: { d: dim({ type: 'distanceLineLine', a: 'pq', b: 'k', value: 2 }) } }))).toThrow(/expects a line/);
    expect(() => solver.solve(input({ ...round, curves: { k: { type: 'circle', center: 'o' }, pq: { type: 'line', a: 'p', b: 'q' } }, constraints: { d: dim({ type: 'distanceLineCircle', line: 'k', curve: 'pq', value: 2 }) } }))).toThrow(/expects a line/);
    expect(() => solver.solve(input({ ...round, curves: { k: { type: 'circle', center: 'o' }, pq: { type: 'line', a: 'p', b: 'q' } }, constraints: { d: dim({ type: 'distanceLineCircle', line: 'pq', curve: 'pq', value: 2 }) } }))).toThrow(/needs a circle or an arc/);
  });
});
