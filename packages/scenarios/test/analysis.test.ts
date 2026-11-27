// The analysis of how far a sketch is constrained (engine/src/analysis.ts) against the real solver:
// the equations of the constraints must describe the same as the solver, and the analysis must give
// the right answer even where the solver does not. The cases "findings of the review" come from an
// independent review of the diagnosis.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Engine, Id, SketchFeature, SolveInput } from '@trymesh/engine';
import { SketchAnalysis } from '../../engine/src/analysis';
import { XY, addSketch, batch, constrain, dimension, newEngine, rectangle, run } from './kit';

const point = (id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y });
const line = (id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch: 'S1', id, curve: { type: 'line', a, b } });
const circle = (id: Id, center: Id, radius: number): Command => ({ type: 'addCurve', sketch: 'S1', id, curve: { type: 'circle', center }, radius });
const arc = (id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch: 'S1', id, curve: { type: 'arc', center, start, end } });
const sketchWith = (...commands: Command[]): Engine => {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), batch(...commands));
  return engine;
};
const dofOf = (engine: Engine, sketch: Id = 'S1') => engine.getState().evaluation.features[sketch].sketch!.degreesOfFreedom;

// The input of the analysis from the state of the engine (a sketch without projected geometry).
function inputOf(engine: Engine, id: Id = 'S1'): SolveInput {
  const state = engine.getState();
  const feature = state.document.features.find((f) => f.id === id) as SketchFeature;
  const solved = state.evaluation.features[id].sketch!;
  const points = Object.fromEntries(['origin', ...Object.keys(feature.points)].map((p) => [p, solved.points[p]]));
  const constraints = Object.fromEntries(Object.entries(feature.constraints).filter(([, c]) => !('value' in c) || c.driving));
  return { points, radii: solved.radii, curves: feature.curves, constraints, fixed: ['origin'] };
}

describe('the equations of the constraints match the solver', () => {
  // For each type of constraint a freehand sketch in which the constraint changes something. The table
  // is complete by its type: a new constraint without a case does not compile.
  const base = [point('a', 1, 2), point('b', 21, 5), point('c', 18, 19), point('d', -3, 14), point('w', -4, 25), point('m', 40, 10), point('n', 62, 12), line('ab', 'a', 'b'), line('cd', 'c', 'd'), circle('k', 'm', 6), circle('q', 'n', 9)];
  const withArc = [point('s', 50, 30), point('e', 38, 41), point('z', 40, 30), arc('r', 'z', 's', 'e')];
  const cases: Record<Constraint['type'], Constraint[]> = {
    coincident: [{ type: 'coincident', a: 'b', b: 'c' }],
    pointOnCurve: [
      { type: 'pointOnCurve', point: 'd', curve: 'ab' },
      { type: 'pointOnCurve', point: 'c', curve: 'k' },
      { type: 'pointOnCurve', point: 'a', curve: 'r' },
    ],
    horizontal: [{ type: 'horizontal', line: 'ab' }],
    vertical: [{ type: 'vertical', line: 'cd' }],
    horizontalPoints: [{ type: 'horizontalPoints', a: 'a', b: 'c' }],
    verticalPoints: [{ type: 'verticalPoints', a: 'c', b: 'b' }],
    parallel: [{ type: 'parallel', a: 'ab', b: 'cd' }],
    perpendicular: [{ type: 'perpendicular', a: 'cd', b: 'ab' }],
    equalLength: [{ type: 'equalLength', a: 'ab', b: 'cd' }],
    equalRadius: [
      { type: 'equalRadius', a: 'k', b: 'q' },
      { type: 'equalRadius', a: 'r', b: 'k' },
      { type: 'equalRadius', a: 'q', b: 'r' },
    ],
    // far from where the point was drawn and at the place it was drawn
    fixed: [
      { type: 'fixed', point: 'c', x: -30, y: 44 },
      { type: 'fixed', point: 'm', x: 40, y: 10 },
    ],
    tangent: [
      { type: 'tangent', a: 'ab', b: 'k' },
      { type: 'tangent', a: 'k', b: 'q' },
      { type: 'tangent', a: 'r', b: 'cd' },
      { type: 'tangent', a: 'q', b: 'r' },
    ],
    // points on opposite sides of the axis; with two points on the same side of a free axis the solver collapses the axis to a point
    symmetric: [
      { type: 'symmetric', a: 'a', b: 'w', line: 'cd' },
      { type: 'symmetric', a: 'w', b: 'a', line: 'cd' },
    ],
    midpoint: [{ type: 'midpoint', point: 'm', line: 'ab' }],
    midpointPoints: [
      { type: 'midpointPoints', point: 'w', a: 'a', b: 'c' },
      { type: 'midpointPoints', point: 'n', a: 'm', b: 'e' },
    ],
    distance: [{ type: 'distance', a: 'a', b: 'c', value: 25, driving: true }],
    distancePointLine: [{ type: 'distancePointLine', point: 'c', line: 'ab', value: 9, driving: true }],
    // parallel and at the distance: two equations; at 0 on one line
    distanceLineLine: [
      { type: 'distanceLineLine', a: 'ab', b: 'cd', value: 12, driving: true },
      { type: 'distanceLineLine', a: 'cd', b: 'ab', value: 0, driving: true },
    ],
    // a circle and an arc, each on the side it was drawn on, and touching
    distanceLineCircle: [
      { type: 'distanceLineCircle', line: 'ab', curve: 'k', value: 5, driving: true },
      { type: 'distanceLineCircle', line: 'cd', curve: 'r', value: 3, driving: true },
      { type: 'distanceLineCircle', line: 'ab', curve: 'q', value: 0, driving: true },
    ],
    horizontalDistance: [{ type: 'horizontalDistance', a: 'b', b: 'a', value: -17, driving: true }],
    verticalDistance: [{ type: 'verticalDistance', a: 'a', b: 'd', value: 11, driving: true }],
    angle: [
      { type: 'angle', a: 'ab', b: 'cd', value: 2.5, driving: true },
      { type: 'angle', a: 'cd', b: 'ab', value: Math.PI, driving: true },
    ],
    radius: [
      { type: 'radius', curve: 'k', value: 4, driving: true },
      { type: 'radius', curve: 'r', value: 8, driving: true },
    ],
    diameter: [
      { type: 'diameter', curve: 'q', value: 20, driving: true },
      { type: 'diameter', curve: 'r', value: 30, driving: true },
    ],
  };

  for (const [type, variants] of Object.entries(cases)) {
    it(`${type}: the solved sketch satisfies the equations and the constraint removes as many degrees of freedom as it has equations`, () => {
      variants.forEach((constraint, i) => {
        const engine = sketchWith(...base, ...withArc);
        const before = new SketchAnalysis(inputOf(engine));
        expect(before.degreesOfFreedom).toBe(2 * 10 + 2 - 1); // ten points, two radii, the rule of the arc
        expect(before.residual).toBeLessThan(1e-7);
        run(engine, constrain('S1', `x${i}`, constraint));
        expect(engine.getState().evaluation.features.S1.status, `${type} ${i}`).toBe('ok');
        const after = new SketchAnalysis(inputOf(engine));
        expect(after.residual, `${type} ${i}`).toBeLessThan(1e-6);
        expect(after.degreesOfFreedom, `${type} ${i}`).toBe(before.degreesOfFreedom - (['coincident', 'symmetric', 'midpoint', 'midpointPoints', 'fixed', 'distanceLineLine'].includes(type) ? 2 : 1));
        expect(after.surplus()).toEqual({ redundant: [], removable: [] });
        expect(dofOf(engine)).toBe(after.degreesOfFreedom);
      });
    });
  }

  it('equal radius of two arcs: one equation, satisfied by the solved sketch', () => {
    const engine = sketchWith(...base, ...withArc, point('s2', 80, 30), point('e2', 70, 43), point('z2', 70, 30), arc('r2', 'z2', 's2', 'e2'));
    const before = new SketchAnalysis(inputOf(engine));
    expect(before.degreesOfFreedom).toBe(2 * 13 + 2 - 2); // thirteen points, two radii, the rule of each arc
    for (const [a, b] of [['r', 'r2'], ['r2', 'r']]) {
      run(engine, constrain('S1', 'eq', { type: 'equalRadius', a, b }));
      expect(engine.getState().evaluation.features.S1.status).toBe('ok');
      const after = new SketchAnalysis(inputOf(engine));
      expect(after.residual).toBeLessThan(1e-6);
      expect(after.degreesOfFreedom).toBe(before.degreesOfFreedom - 1);
      expect(after.surplus()).toEqual({ redundant: [], removable: [] });
      expect(dofOf(engine)).toBe(after.degreesOfFreedom);
      const p = engine.getState().evaluation.features.S1.sketch!.points;
      expect(Math.hypot(p.s.x - p.z.x, p.s.y - p.z.y)).toBeCloseTo(Math.hypot(p.s2.x - p.z2.x, p.s2.y - p.z2.y), 6);
      engine.undo();
    }
  });

  it('scale: the same sketch five orders of magnitude larger and smaller gives the same analysis', () => {
    for (const scale of [1e-4, 1, 1e5]) {
      const engine = newEngine();
      run(engine, addSketch('S1', XY), rectangle('S1', 'r', 3 * scale, 2 * scale, 40 * scale, 30 * scale, null), constrain('S1', 'par', { type: 'parallel', a: 'ra', b: 'rc' }), dimension('S1', 'diag', { type: 'distance', a: 'r1', b: 'r3' }, 50 * scale));
      const d = engine.diagnoseSketch('S1');
      expect(d, `scale ${scale}`).toMatchObject({ status: 'solved', degreesOfFreedom: 0, removable: ['par', 'diag'], free: [] });
      expect(engine.explainConstraint('S1', 'par').impliedBy).toEqual(['rh1', 'rh2']);
      run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'rx' });
      expect(engine.diagnoseSketch('S1').free.map((entity) => [entity.id, entity.freedom])).toEqual([['r1', 1], ['r2', 1], ['r3', 1], ['r4', 1]]);
    }
  });
});

describe('findings of the review of the diagnosis', () => {
  it('a line the solver collapsed to a point: neither the freedom nor the redundancy falls apart', () => {
    const engine = sketchWith(point('p0', -3.84, -16.24), point('p1', -20.93, -15.8), point('p2', 22.04, -9.92), point('p3', 32.58, -3.21), point('p4', -39.22, -6.77), line('l0', 'p2', 'p1'), line('l1', 'origin', 'p3'), line('l2', 'p0', 'p2'), line('l3', 'p2', 'p4'));
    run(
      engine,
      dimension('S1', 'c1', { type: 'verticalDistance', a: 'p1', b: 'p0' }, -0.44),
      constrain('S1', 'c3', { type: 'perpendicular', a: 'l3', b: 'l1' }),
      constrain('S1', 'c6', { type: 'vertical', line: 'l1' }),
      dimension('S1', 'c7', { type: 'distancePointLine', point: 'p3', line: 'l2' }, 11),
      constrain('S1', 'c8', { type: 'horizontal', line: 'l0' }),
    );
    const d = engine.diagnoseSketch('S1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 5, redundant: [], removable: [] });
    expect(dofOf(engine)).toBe(5);
    expect(d.free.length).toBeGreaterThan(0);
  });

  it('a cycle of equal lengths in a triangle: one equality is redundant and the triangle has a free size', () => {
    const engine = sketchWith(point('a', 0.2, 0.1), point('b', 10.3, 0.4), point('c', 4.6, 8.9), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'a'));
    run(engine, constrain('S1', 'fix', { type: 'coincident', a: 'a', b: 'origin' }), constrain('S1', 'h', { type: 'horizontal', line: 'l1' }), constrain('S1', 'e12', { type: 'equalLength', a: 'l1', b: 'l2' }), constrain('S1', 'e23', { type: 'equalLength', a: 'l2', b: 'l3' }), constrain('S1', 'e31', { type: 'equalLength', a: 'l3', b: 'l1' }));
    const d = engine.diagnoseSketch('S1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 1, redundant: ['e12', 'e23', 'e31'], removable: ['e31'] });
    expect(d.free).toEqual([
      { id: 'b', kind: 'point', freedom: 1 },
      { id: 'c', kind: 'point', freedom: 1 },
    ]);
    expect(dofOf(engine)).toBe(1); // the state of the sketch comes from the same analysis
    expect(engine.explainConstraint('S1', 'e31')).toEqual({ redundant: true, impliedBy: ['e12', 'e23'] });
    // The size really is free: point b can be dragged away and the triangle stays equilateral. The
    // solver does not recognise the redundant equality itself and refuses the drag with it; after it
    // is removed the drag passes.
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'e31' }, { type: 'dragPoint', sketch: 'S1', point: 'b', x: 20, y: 0 });
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 1, redundant: [] });
    const p = engine.getState().evaluation.features.S1.sketch!.points;
    expect(Math.hypot(p.c.x - p.b.x, p.c.y - p.b.y)).toBeCloseTo(20, 4);
    expect(Math.hypot(p.c.x, p.c.y)).toBeCloseTo(20, 4);
  });

  it('a square of equal lengths: the only dimension of the size is not redundant; the explanation is the smallest', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), { type: 'removeConstraint', sketch: 'S1', id: 'rh' }, constrain('S1', 'eq', { type: 'equalLength', a: 'ra', b: 'rb' }), constrain('S1', 'eq2', { type: 'equalLength', a: 'rb', b: 'rc' }));
    const d = engine.diagnoseSketch('S1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 0, removable: ['eq2'] });
    expect(d.redundant).not.toContain('rw');
    expect(d.redundant).not.toContain('rfix');
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'eq2' });
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 0, redundant: [] });
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'rw' });
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(1);

    const other = newEngine();
    run(other, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), constrain('S1', 'eq1', { type: 'equalLength', a: 'ra', b: 'rc' }), constrain('S1', 'eq2', { type: 'equalLength', a: 'rb', b: 'rd' }), constrain('S1', 'perp', { type: 'perpendicular', a: 'ra', b: 'rb' }), constrain('S1', 'par', { type: 'parallel', a: 'ra', b: 'rc' }));
    expect(other.explainConstraint('S1', 'rh1')).toEqual({ redundant: true, impliedBy: ['rv1', 'perp'] });
    expect(other.diagnoseSketch('S1').removable).toEqual(['eq1', 'eq2', 'perp', 'par']);
  });

  it('a slot: a point of tangency that cannot move is not among the free ones', () => {
    const engine = sketchWith(point('a', 0.1, -4.8), point('b', 20.2, -5.1), point('c', 19.7, 5.2), point('d', -0.3, 4.9), point('m1', 0.2, 0.1), point('m2', 20.1, -0.2), line('bot', 'a', 'b'), line('top', 'c', 'd'), arc('right', 'm2', 'b', 'c'), arc('left', 'm1', 'd', 'a'));
    run(
      engine,
      constrain('S1', 't1', { type: 'tangent', a: 'bot', b: 'right' }),
      constrain('S1', 't2', { type: 'tangent', a: 'top', b: 'right' }),
      constrain('S1', 't3', { type: 'tangent', a: 'top', b: 'left' }),
      constrain('S1', 't4', { type: 'tangent', a: 'bot', b: 'left' }),
      constrain('S1', 'fix', { type: 'coincident', a: 'm1', b: 'origin' }),
      constrain('S1', 'h', { type: 'horizontal', line: 'bot' }),
      dimension('S1', 'r', { type: 'radius', curve: 'left' }, 5),
      dimension('S1', 'len', { type: 'horizontalDistance', a: 'm1', b: 'm2' }, 20),
    );
    const d = engine.diagnoseSketch('S1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 1, redundant: [] });
    // the height of the right centre is free; the top line moves with it, the bottom one stays
    expect(d.free).toEqual([
      { id: 'c', kind: 'point', freedom: 1 },
      { id: 'd', kind: 'point', freedom: 1 },
      { id: 'm2', kind: 'point', freedom: 1 },
    ]);
    // the rule of anchoring holds: fixing any of the free points fully constrains the sketch
    for (const free of d.free) {
      const p = engine.getState().evaluation.features.S1.sketch!.points[free.id];
      const pinned = engine.preview(batch(dimension('S1', 'px', { type: 'horizontalDistance', a: 'origin', b: free.id }, p.x), dimension('S1', 'py', { type: 'verticalDistance', a: 'origin', b: free.id }, p.y)));
      expect(pinned.ok && pinned.state.evaluation.features.S1.sketch!.degreesOfFreedom, free.id).toBe(0);
    }
  });

  it('tangency at a shared point: the constraint counts even though it is a double root in the solution', () => {
    // the line ends at the start of the arc
    let engine = sketchWith(point('a', 0, 0.3), point('b', 10, -0.2), point('m', 10.4, 5.1), point('e', 15.2, 4.7), line('ab', 'a', 'b'), arc('r', 'm', 'b', 'e'));
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(7);
    run(engine, constrain('S1', 't', { type: 'tangent', a: 'ab', b: 'r' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 6, redundant: [] });
    // a separate constraint holds the end of the line on the circle
    engine = sketchWith(point('a', 0, 0.3), point('b', 10, -0.2), point('m', 10.4, 5.1), line('ab', 'a', 'b'), circle('k', 'm', 5));
    run(engine, constrain('S1', 'on', { type: 'pointOnCurve', point: 'b', curve: 'k' }), constrain('S1', 't', { type: 'tangent', a: 'k', b: 'ab' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 5, redundant: [] });
    // two arcs join smoothly at a shared point
    engine = sketchWith(point('m1', 0, 0), point('s', -5, 0.2), point('q', 0.3, 5), point('m2', 0.1, 9.8), point('e', 5.2, 10.1), arc('r1', 'm1', 'q', 's'), arc('r2', 'm2', 'q', 'e'));
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(8);
    run(engine, constrain('S1', 't', { type: 'tangent', a: 'r1', b: 'r2' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 7, redundant: [] });
  });

  it('a zero distance is a coincidence: the explanation names it', () => {
    const engine = sketchWith(point('a', 3, 4), point('b', 3.5, 4.2));
    run(engine, dimension('S1', 'd0', { type: 'distance', a: 'a', b: 'b' }, 0), constrain('S1', 'co', { type: 'coincident', a: 'a', b: 'b' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 2, redundant: ['d0', 'co'], removable: ['co'] });
    expect(engine.explainConstraint('S1', 'd0')).toEqual({ redundant: true, impliedBy: ['co'] });
    expect(engine.explainConstraint('S1', 'co')).toEqual({ redundant: true, impliedBy: ['d0'] });
  });

  it('cost: thirty rectangles (240 constraints) are analysed in a fraction of a second', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), batch(...Array.from({ length: 30 }, (_, i) => rectangle('S1', `q${i}_`, 50 * i, 0, 40, 30, null))), { type: 'removeConstraint', sketch: 'S1', id: 'q7_w' }, dimension('S1', 'extra', { type: 'distance', a: 'q3_1', b: 'q3_3' }, 50));
    const started = performance.now();
    const d = engine.diagnoseSketch('S1');
    const explained = engine.explainConstraint('S1', 'extra');
    const elapsed = performance.now() - started;
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 1, removable: ['extra'] });
    expect(d.free.map((entity) => entity.id)).toEqual(['q7_2', 'q7_3']);
    expect(explained.impliedBy).toEqual(['q3_h1', 'q3_v1', 'q3_w', 'q3_h']);
    expect(elapsed).toBeLessThan(2000); // usually around 0.1 s; a margin for a busy machine
  });
});

describe('findings of the second review of the analysis', () => {
  const freedoms = (engine: Engine) => engine.diagnoseSketch('S1').free.map((entity) => [entity.id, entity.freedom]);

  it('a tangency whose point of contact falls on the end of the line only thanks to another constraint: the radius is not lost', () => {
    // the radius m→b perpendicular to the line: the contact is at b, but only the tangency itself holds b on the circle
    const engine = sketchWith(point('a', 0, 0.3), point('b', 30, -0.2), point('m', 29.5, 8), line('ab', 'a', 'b'), circle('k', 'm', 6), line('rad', 'm', 'b'));
    run(engine, constrain('S1', 'perp', { type: 'perpendicular', a: 'rad', b: 'ab' }), constrain('S1', 't', { type: 'tangent', a: 'ab', b: 'k' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 5, redundant: [], removable: [] });
    // With a constraint that holds b on the circle by itself, one of the three is redundant (any of
    // them follows from the other two). The analysis then takes the tangency as the perpendicularity
    // of the radius and offers it for removal.
    run(engine, constrain('S1', 'on', { type: 'pointOnCurve', point: 'b', curve: 'k' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 5, redundant: ['perp', 't'], removable: ['t'] });
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 't' });
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 5, redundant: [] });
  });

  it('a tangency whose point of contact falls on a corner by a coincidence of sizes: the circle is constrained', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), point('m', 39, 11), circle('k', 'm', 8), dimension('S1', 'mx', { type: 'horizontalDistance', a: 'origin', b: 'm' }, 40), dimension('S1', 'my', { type: 'verticalDistance', a: 'origin', b: 'm' }, 10));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 1, free: [{ id: 'k', kind: 'radius', freedom: 1 }] });
    run(engine, constrain('S1', 't', { type: 'tangent', a: 'ra', b: 'k' }));
    expect(engine.getState().evaluation.features.S1.sketch!.radii.k).toBeCloseTo(10, 5);
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [], free: [] });
  });

  it('an arc tangent to a circle whose end lies on it only thanks to the tangency: the radius of the circle is not lost', () => {
    // a helper line holds the centres and the end of the arc on one line; the contact is then at the end of the arc
    const engine = sketchWith(point('m1', 0, 0), point('s', -5, 0.2), point('q', 5.1, 0.1), point('m2', 12, 0.3), arc('r', 'm1', 'q', 's'), circle('k', 'm2', 6.5), line('axis', 'm1', 'm2'));
    run(engine, constrain('S1', 'on', { type: 'pointOnCurve', point: 'q', curve: 'axis' }));
    const before = engine.diagnoseSketch('S1').degreesOfFreedom;
    run(engine, constrain('S1', 't', { type: 'tangent', a: 'r', b: 'k' }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: before - 1, redundant: [] });
    expect(freedoms(engine)).toContainEqual(['m2', 2]);
  });

  it('points that coincide only to the precision of the solver: the constraints between them count', () => {
    let engine = sketchWith(point('a', 3, 4), point('b', 3.5, 4.2));
    run(engine, dimension('S1', 'd0', { type: 'distance', a: 'a', b: 'b' }, 0));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 2, redundant: [] });
    engine = sketchWith(point('a', 3, 4), point('b', 23.5, 4.2), point('c', 3.4, 4.3), line('ab', 'a', 'b'));
    run(
      engine,
      constrain('S1', 'co', { type: 'coincident', a: 'c', b: 'a' }),
      dimension('S1', 'dl', { type: 'distancePointLine', point: 'c', line: 'ab' }, 0),
      dimension('S1', 'vd', { type: 'verticalDistance', a: 'c', b: 'a' }, 0),
      constrain('S1', 'h', { type: 'horizontal', line: 'ab' }),
    );
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 3, removable: ['dl', 'vd'] });
  });

  it('the freedom of entities when the sketch has more freedom: each point has both directions', () => {
    const engine = sketchWith(point('a', 0, 0.3), point('b', 30, -0.2), point('c', 2, 10.4), point('d', 28, 9.7), line('ab', 'a', 'b'), line('cd', 'c', 'd'));
    run(engine, constrain('S1', 'h', { type: 'horizontal', line: 'ab' }), constrain('S1', 'par', { type: 'parallel', a: 'ab', b: 'cd' }));
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(6);
    expect(freedoms(engine)).toEqual([['a', 2], ['b', 2], ['c', 2], ['d', 2]]);
    // without constraints: ten points, each with two directions
    const loose = sketchWith(...Array.from({ length: 10 }, (_, i) => point(`p${i}`, 7 * i, i * i)));
    expect(freedoms(loose)).toEqual(Array.from({ length: 10 }, (_, i) => [`p${i}`, 2]));
  });

  it('perpendicular lines of equal length: the equations of perpendicularity stay smooth', () => {
    // a quadrilateral of four perpendicularities and three equal lengths is a square with a free position, rotation and size
    const engine = sketchWith(point('a', 0.2, 0.1), point('b', 20.3, 0.4), point('c', 19.8, 20.2), point('d', -0.3, 19.9), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'c', 'd'), line('l4', 'd', 'a'));
    const perpendicular = (id: Id, a: Id, b: Id): Command => constrain('S1', id, { type: 'perpendicular', a, b });
    const equal = (id: Id, a: Id, b: Id): Command => constrain('S1', id, { type: 'equalLength', a, b });
    run(engine, perpendicular('p1', 'l1', 'l2'), perpendicular('p2', 'l2', 'l3'), perpendicular('p3', 'l3', 'l4'), perpendicular('p4', 'l4', 'l1'), equal('e1', 'l1', 'l2'), equal('e2', 'l2', 'l3'), equal('e3', 'l3', 'l4'));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 4, removable: ['p4', 'e2', 'e3'] });

    const square = newEngine();
    run(square, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 40), perpendicular('p1', 'ra', 'rb'), perpendicular('p2', 'rb', 'rc'), perpendicular('p3', 'rc', 'rd'), perpendicular('p4', 'rd', 'ra'));
    expect(square.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 0, removable: ['p1', 'p2', 'p3', 'p4'] });
    expect(square.explainConstraint('S1', 'rh2')).toEqual({ redundant: true, impliedBy: ['rv1', 'p2'] }); // the dimension of the height used to creep in here
  });

  it('a small shape far from the origin: a redundant constraint is recognised', () => {
    // a triangle given by three sides of different lengths; a right angle between two of them is redundant
    for (const [x, y, s] of [[1000, 300, 0.01], [1e6, 3e5, 1], [0, 0, 10]]) {
      const engine = sketchWith(point('a', x, y), point('b', x + 4.1 * s, y + 0.2 * s), point('c', x - 0.1 * s, y + 2.9 * s), line('l1', 'a', 'b'), line('l2', 'b', 'c'), line('l3', 'a', 'c'));
      run(engine, dimension('S1', 'd1', { type: 'distance', a: 'a', b: 'b' }, 4 * s), dimension('S1', 'd2', { type: 'distance', a: 'b', b: 'c' }, 5 * s), dimension('S1', 'd3', { type: 'distance', a: 'c', b: 'a' }, 3 * s), dimension('S1', 'ang', { type: 'angle', a: 'l1', b: 'l3' }, Math.PI / 2));
      expect(engine.diagnoseSketch('S1'), `${x} ${s}`).toMatchObject({ status: 'solved', degreesOfFreedom: 3, redundant: ['d1', 'd2', 'd3', 'ang'], removable: ['ang'] });
    }
  });

  it('the explanation does not contain a constraint it can do without', () => {
    // a coincidence has two equations; a horizontal dimension stands in for one of them in the basis, but it is not needed
    const engine = sketchWith(point('a', 3, 4), point('b', 3.4, 4.3), point('c', 20, 12));
    run(
      engine,
      dimension('S1', 'hd', { type: 'horizontalDistance', a: 'a', b: 'b' }, 0),
      constrain('S1', 'co', { type: 'coincident', a: 'a', b: 'b' }),
      dimension('S1', 'dbc', { type: 'distance', a: 'b', b: 'c' }, 18),
      dimension('S1', 'dac', { type: 'distance', a: 'a', b: 'c' }, 18),
    );
    expect(engine.explainConstraint('S1', 'dac')).toEqual({ redundant: true, impliedBy: ['co', 'dbc'] });
    expect(engine.explainConstraint('S1', 'hd')).toEqual({ redundant: true, impliedBy: ['co'] });
  });

  it('the set to remove for constraints with two equations: the count of equations matches, the count of constraints depends on the order', () => {
    const variants: [Command[], Id[]][] = [
      [[constrain('S1', 'co', { type: 'coincident', a: 'a', b: 'b' }), dimension('S1', 'hd', { type: 'horizontalDistance', a: 'a', b: 'b' }, 0), dimension('S1', 'vd', { type: 'verticalDistance', a: 'a', b: 'b' }, 0)], ['hd', 'vd']],
      [[dimension('S1', 'hd', { type: 'horizontalDistance', a: 'a', b: 'b' }, 0), dimension('S1', 'vd', { type: 'verticalDistance', a: 'a', b: 'b' }, 0), constrain('S1', 'co', { type: 'coincident', a: 'a', b: 'b' })], ['co']],
    ];
    for (const [commands, removable] of variants) {
      const engine = sketchWith(point('a', 3, 4), point('b', 3.4, 4.3));
      run(engine, ...commands);
      expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 2, redundant: ['co', 'hd', 'vd'].sort((p, q) => commands.findIndex((c) => (c as { id: Id }).id === p) - commands.findIndex((c) => (c as { id: Id }).id === q)), removable });
      run(engine, ...removable.map((id): Command => ({ type: 'removeConstraint', sketch: 'S1', id })));
      expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 2, redundant: [] });
    }
  });
});

describe('findings of the review of symmetry', () => {
  // a vertical construction axis of a given length from the origin and a symmetric pair of points
  const symmetricPair = (): Engine => {
    const engine = sketchWith(point('top', 0.5, 30), { type: 'addCurve', sketch: 'S1', id: 'axis', curve: { type: 'line', a: 'origin', b: 'top', construction: true } }, point('a', -14, 5), point('b', 12, 8));
    run(engine, constrain('S1', 'v', { type: 'vertical', line: 'axis' }), dimension('S1', 'len', { type: 'distance', a: 'origin', b: 'top' }, 40), constrain('S1', 's', { type: 'symmetric', a: 'a', b: 'b', line: 'axis' }));
    return engine;
  };

  it('a symmetric pair that another constraint pulls onto the axis is not a conflict', () => {
    const extras: Constraint[] = [
      { type: 'pointOnCurve', point: 'a', curve: 'axis' },
      { type: 'coincident', a: 'a', b: 'b' },
      { type: 'coincident', a: 'a', b: 'origin' },
      { type: 'horizontalDistance', a: 'a', b: 'b', value: 0, driving: true },
    ];
    for (const extra of extras) {
      const engine = symmetricPair();
      expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 2 });
      run(engine, constrain('S1', 'x', extra));
      const d = engine.diagnoseSketch('S1');
      expect(d, extra.type).toMatchObject({ status: 'solved', conflicting: [], degreesOfFreedom: extra.type === 'coincident' && extra.b === 'origin' ? 0 : 1 });
      const p = engine.getState().evaluation.features.S1.sketch!.points;
      expect(Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y)).toBeLessThan(1e-6);
      expect(p.a.x).toBeCloseTo(0, 6);
      // the pair can be moved apart again: after the constraint is removed, by a dimension of the width
      run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'x' }, dimension('S1', 'w', { type: 'distance', a: 'a', b: 'b' }, 20));
      const q = engine.getState().evaluation.features.S1.sketch!.points;
      expect(engine.diagnoseSketch('S1')).toMatchObject({ status: 'solved', degreesOfFreedom: 1 });
      expect(Math.abs(q.a.x)).toBeCloseTo(10, 5);
      expect(q.a.x).toBeCloseTo(-q.b.x, 6);
    }
  });

  it('a document with a symmetric pair on the axis saves and loads in the same state', () => {
    const engine = symmetricPair();
    run(engine, constrain('S1', 'on', { type: 'pointOnCurve', point: 'a', curve: 'axis' }));
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.diagnoseSketch('S1')).toEqual(engine.diagnoseSketch('S1'));
    expect(other.getState().evaluation.features.S1.sketch!.points).toEqual(engine.getState().evaluation.features.S1.sketch!.points);
  });
});
