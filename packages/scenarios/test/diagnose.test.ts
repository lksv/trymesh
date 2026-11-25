// The sketch diagnosis (Engine.diagnoseSketch, explainConstraint) against the real solver.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Engine, Id } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, constrain, dimension, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

// An L-shaped outline drawn in the app: the shape is constrained, the position is not, and six
// constraints are redundant (three of them exact duplicates the app used to allow to be added).
const L_PROFILE = {
  schemaVersion: 1,
  settings: { chordTolerance: 0.01 },
  features: [
    {
      id: 's1',
      name: 'Sketch 1',
      suppressed: false,
      type: 'sketch',
      plane: { kind: 'base', plane: 'XZ' },
      points: {
        p1: { x: -8.174560549192085, y: 12.858713808261804 },
        p2: { x: 14.495439450807918, y: 12.858713808261804 },
        p3: { x: 14.495439450807918, y: 2.738713808261805 },
        p4: { x: -14.15456054919208, y: 2.738713808261805 },
        p5: { x: -14.15456054919208, y: 8.378713808261804 },
        p6: { x: -8.174560549192085, y: 8.378713808261804 },
      },
      radii: {},
      curves: {
        c1: { type: 'line', a: 'p1', b: 'p2' },
        c2: { type: 'line', a: 'p2', b: 'p3' },
        c3: { type: 'line', a: 'p3', b: 'p4' },
        c4: { type: 'line', a: 'p4', b: 'p5' },
        c5: { type: 'line', a: 'p5', b: 'p6' },
        c6: { type: 'line', a: 'p6', b: 'p1' },
      },
      constraints: {
        k1: { type: 'horizontal', line: 'c1' },
        k3: { type: 'horizontal', line: 'c3' },
        k4: { type: 'vertical', line: 'c4' },
        k5: { type: 'horizontal', line: 'c5' },
        k6: { type: 'parallel', a: 'c6', b: 'c2' },
        k7: { type: 'horizontalDistance', a: 'p1', b: 'p2', value: 22.67, driving: true },
        k11: { type: 'vertical', line: 'c2' },
        k12: { type: 'distance', a: 'p2', b: 'p3', value: 10.12, driving: true },
        k13: { type: 'distance', a: 'p6', b: 'p1', value: 4.48, driving: true },
        k14: { type: 'distance', a: 'p3', b: 'p4', value: 28.65, driving: true },
        k15: { type: 'parallel', a: 'c4', b: 'c2' },
        k16: { type: 'parallel', a: 'c3', b: 'c1' },
        k17: { type: 'parallel', a: 'c1', b: 'c5' },
        k18: { type: 'parallel', a: 'c4', b: 'c2' },
        k19: { type: 'horizontal', line: 'c3' },
        k20: { type: 'vertical', line: 'c2' },
      },
      external: {},
      solved: { inputs: '', external: {} },
    },
  ],
};

const loaded = (document: object): Engine => {
  const engine = newEngine();
  const result = engine.load(JSON.stringify(document));
  if (!result.ok) throw new Error(result.error.message);
  return engine;
};
const dofOf = (engine: Engine, sketch: Id) => engine.getState().evaluation.features[sketch].sketch!.degreesOfFreedom;

// A constraint follows from a set when the set makes it redundant, and the set is the smallest when
// that does not hold without any one of its members. It is checked on a copy of the document in which
// only the set and the constraint itself are left in the sketch.
function expectMinimalExplanation(engine: Engine, sketch: Id, constraint: Id, impliedBy: Id[]) {
  const subset = (ids: Id[]) => {
    const copy = JSON.parse(engine.save());
    const feature = copy.features.find((f: { id: Id }) => f.id === sketch);
    feature.constraints = Object.fromEntries(ids.map((id) => [id, feature.constraints[id]]));
    return loaded(copy);
  };
  const implied = (others: Id[]) => dofOf(subset(others), sketch) === dofOf(subset([...others, constraint]), sketch);
  expect(implied(impliedBy)).toBe(true);
  for (const id of impliedBy) expect(implied(impliedBy.filter((other) => other !== id))).toBe(false);
}

describe('sketch diagnosis: the L outline from the app', () => {
  it('the shape is constrained, the position free, six constraints redundant', () => {
    const engine = loaded(L_PROFILE);
    const d = engine.diagnoseSketch('s1');
    expect(d.status).toBe('solved');
    expect(d.degreesOfFreedom).toBe(2);
    expect(d.duplicates).toEqual([['k3', 'k19'], ['k11', 'k20'], ['k15', 'k18']]);
    // every constraint that follows from the others is redundant; the dimensions and the parallelism of c6 are needed
    expect(d.redundant).toEqual(['k1', 'k3', 'k4', 'k5', 'k11', 'k15', 'k16', 'k17', 'k18', 'k19', 'k20']);
    expect(d.removable).toEqual(['k15', 'k16', 'k17', 'k18', 'k19', 'k20']); // the older constraints stay
    // each point can move in two directions and fixing any of them fully constrains the whole sketch
    expect(d.free).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => ({ id, kind: 'point', freedom: 2 })));
  });

  it('explanation: a duplicate comes first, otherwise the smallest set of constraints on neighbouring entities', () => {
    const engine = loaded(L_PROFILE);
    expect(engine.explainConstraint('s1', 'k20')).toEqual({ redundant: true, impliedBy: ['k11'] });
    expect(engine.explainConstraint('s1', 'k18')).toEqual({ redundant: true, impliedBy: ['k15'] });
    expect(engine.explainConstraint('s1', 'k4')).toEqual({ redundant: true, impliedBy: ['k11', 'k15'] }); // c4 vertical: c2 vertical and c4 ∥ c2
    expect(engine.explainConstraint('s1', 'k6')).toEqual({ redundant: false, impliedBy: [] });
    expect(engine.explainConstraint('s1', 'k7')).toEqual({ redundant: false, impliedBy: [] });
    for (const id of engine.diagnoseSketch('s1').redundant) {
      const { impliedBy } = engine.explainConstraint('s1', id);
      expect(impliedBy.length).toBeGreaterThan(0);
      expectMinimalExplanation(engine, 's1', id, impliedBy);
    }
  });

  it('after the proposed set is deleted nothing redundant is left and the freedom does not change; anchoring constrains the sketch', () => {
    const engine = loaded(L_PROFILE);
    const before = structuredClone(engine.getState().evaluation.features.s1.sketch!.points);
    run(engine, batch(...engine.diagnoseSketch('s1').removable.map((id): Command => ({ type: 'removeConstraint', sketch: 's1', id }))));
    let d = engine.diagnoseSketch('s1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 2, duplicates: [], redundant: [], removable: [] });
    const after = engine.getState().evaluation.features.s1.sketch!.points;
    for (const id of Object.keys(before)) expect(Math.hypot(after[id].x - before[id].x, after[id].y - before[id].y)).toBeLessThan(1e-6);

    run(engine, constrain('s1', 'fix', { type: 'coincident', a: 'p4', b: 'origin' }));
    d = engine.diagnoseSketch('s1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [], free: [] });
  });
});

describe('sketch diagnosis: freedom', () => {
  it('a fully constrained rectangle has nothing free and nothing redundant', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30));
    expect(engine.diagnoseSketch('S1')).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
  });

  it('a point on a line has freedom 1, the radius of a circle 1, constrained points none', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S1', XY),
      batch(
        { type: 'addPoint', sketch: 'S1', id: 'a', x: 10, y: 10 },
        { type: 'addCurve', sketch: 'S1', id: 'l', curve: { type: 'line', a: 'origin', b: 'a' } },
        dimension('S1', 'ax', { type: 'horizontalDistance', a: 'origin', b: 'a' }, 10),
        dimension('S1', 'ay', { type: 'verticalDistance', a: 'origin', b: 'a' }, 10),
        { type: 'addPoint', sketch: 'S1', id: 'q', x: 4, y: 4.2 },
        constrain('S1', 'on', { type: 'pointOnCurve', point: 'q', curve: 'l' }),
        { type: 'addPoint', sketch: 'S1', id: 'c', x: 20, y: 0 },
        { type: 'addCurve', sketch: 'S1', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 3 },
        constrain('S1', 'cc', { type: 'coincident', a: 'c', b: 'a' }),
      ),
    );
    const d = engine.diagnoseSketch('S1');
    expect(d.degreesOfFreedom).toBe(2);
    expect(d.free).toEqual([
      { id: 'q', kind: 'point', freedom: 1 },
      { id: 'k', kind: 'radius', freedom: 1 },
    ]);
    run(engine, dimension('S1', 'kr', { type: 'radius', curve: 'k' }, 3));
    expect(engine.diagnoseSketch('S1').free).toEqual([{ id: 'q', kind: 'point', freedom: 1 }]);
  });

  it('a rectangle without a width: the sum of the freedoms of the points is larger than the freedom of the sketch, the points move together', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), { type: 'removeConstraint', sketch: 'S1', id: 'rw' });
    const d = engine.diagnoseSketch('S1');
    expect(d.degreesOfFreedom).toBe(1);
    expect(d.free).toEqual([
      { id: 'r2', kind: 'point', freedom: 1 },
      { id: 'r3', kind: 'point', freedom: 1 },
    ]);
  });
});

describe('sketch diagnosis: redundant dimensions, a conflict, an arc and projected geometry', () => {
  it('extra dimensions: all constraints in the dependent group are redundant, removing two is enough', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), dimension('S1', 'top', { type: 'distance', a: 'r3', b: 'r4' }, 40), dimension('S1', 'diag', { type: 'distance', a: 'r1', b: 'r3' }, 50));
    const d = engine.diagnoseSketch('S1');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 0, duplicates: [], removable: ['top', 'diag'], free: [] });
    expect(d.redundant).toContain('top');
    expect(d.redundant).toContain('diag');
    expect(d.redundant).not.toContain('rfix'); // the anchoring follows from nothing
    for (const id of d.redundant) {
      const { impliedBy } = engine.explainConstraint('S1', id);
      expect(impliedBy.length).toBeGreaterThan(0);
      expectMinimalExplanation(engine, 'S1', id, impliedBy);
    }
    // after the proposed set is removed nothing is redundant any more
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'top' }, { type: 'removeConstraint', sketch: 'S1', id: 'diag' });
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 0, redundant: [], removable: [] });
  });

  it('conflict: the diagnosis returns the conflicting constraints and does not compute the redundancy', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), dimension('S1', 'bad', { type: 'distance', a: 'r1', b: 'r4' }, 31));
    const d = engine.diagnoseSketch('S1');
    expect(d.status).toBe('conflict');
    expect(d.conflicting).toContain('bad');
    expect(d).toMatchObject({ redundant: [], removable: [], free: [] });
    expect(engine.explainConstraint('S1', 'bad')).toEqual({ redundant: false, impliedBy: [] });
  });

  it('a constraint that follows from the definition of an arc is redundant without an explaining set; a point on a projected edge has freedom 1', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S1', XY),
      rectangle('S1', 'r', 0, 0, 40, 30),
      addExtrude('E1', 'S1', [rectLoop('r')], 10),
      addSketch('S2', onFace('E1', cap('E1'))),
      batch(
        { type: 'addExternal', sketch: 'S2', id: 'right', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'rb') }, kind: 'line' } },
        { type: 'addPoint', sketch: 'S2', id: 'c', x: 20, y: 15 },
        { type: 'addPoint', sketch: 'S2', id: 's', x: 25, y: 15 },
        { type: 'addPoint', sketch: 'S2', id: 'e', x: 15, y: 15.2 },
        { type: 'addCurve', sketch: 'S2', id: 'arc', curve: { type: 'arc', center: 'c', start: 's', end: 'e' } },
        { type: 'addCurve', sketch: 'S2', id: 'chord', curve: { type: 'line', a: 'e', b: 's' } },
        constrain('S2', 'onRight', { type: 'pointOnCurve', point: 's', curve: 'right' }),
        constrain('S2', 'endOnArc', { type: 'pointOnCurve', point: 'e', curve: 'arc' }),
      ),
    );
    const d = engine.diagnoseSketch('S2');
    expect(d).toMatchObject({ status: 'solved', degreesOfFreedom: 4, redundant: ['endOnArc'], removable: ['endOnArc'] });
    expect(d.free).toEqual([
      { id: 'c', kind: 'point', freedom: 2 },
      { id: 's', kind: 'point', freedom: 1 },
      { id: 'e', kind: 'point', freedom: 2 },
    ]);
    expect(engine.explainConstraint('S2', 'endOnArc')).toEqual({ redundant: true, impliedBy: [] });
    // the solver does not move projected points, they are not among the free ones
    expect(d.free.some((entity) => entity.id.startsWith('right'))).toBe(false);
  });
});

describe('sketch diagnosis: behaviour of the API', () => {
  it('the result is remembered while the sketch does not change; a change elsewhere does not discard it', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), addSketch('S2', XY), rectangle('S2', 'q', 50, 0, 10, 10, null));
    const first = engine.diagnoseSketch('S1');
    expect(engine.diagnoseSketch('S1')).toBe(first);
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'qw' });
    expect(engine.diagnoseSketch('S1')).toBe(first);
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'rfix' });
    expect(engine.diagnoseSketch('S1')).not.toBe(first);
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(2);
    engine.undo();
    expect(engine.diagnoseSketch('S1').degreesOfFreedom).toBe(0);
  });

  it('reference dimensions are not part of the diagnosis', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), constrain('S1', 'ref', { type: 'distance', a: 'r1', b: 'r3', value: 50, driving: false }));
    expect(engine.diagnoseSketch('S1')).toMatchObject({ degreesOfFreedom: 0, redundant: [], duplicates: [] });
    expect(engine.explainConstraint('S1', 'ref')).toEqual({ redundant: false, impliedBy: [] });
  });

  it('a suppressed sketch and a sketch with a broken plane are unavailable; an unknown sketch or constraint is an error of the call', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), addExtrude('E1', 'S1', [rectLoop('r')], 10), addSketch('S2', onFace('E1', cap('E1'))), rectangle('S2', 'q', 5, 5, 10, 10, null));
    expect(engine.diagnoseSketch('S2').status).toBe('solved');
    run(engine, { type: 'setSuppressed', id: 'S2', suppressed: true });
    expect(engine.diagnoseSketch('S2').status).toBe('unavailable');
    run(engine, { type: 'setSuppressed', id: 'S2', suppressed: false }, { type: 'setSuppressed', id: 'E1', suppressed: true });
    expect(engine.diagnoseSketch('S2')).toMatchObject({ status: 'unavailable', redundant: [], free: [] });
    expect(engine.explainConstraint('S2', 'qw')).toEqual({ redundant: false, impliedBy: [] });
    expect(() => engine.diagnoseSketch('nothing')).toThrow(/the sketch "nothing" does not exist/);
    expect(() => engine.diagnoseSketch('E1')).toThrow(/the sketch "E1" does not exist/);
    expect(() => engine.explainConstraint('S1', 'nothing')).toThrow(/the constraint "nothing"/);
    expect(() => engine.explainConstraint('S1', 'toString')).toThrow(/the constraint "toString"/);
  });

  it('the diagnosis changes neither the document nor the evaluation', () => {
    const engine = loaded(L_PROFILE);
    const [document, evaluation] = [engine.save(), engine.getState().evaluation];
    engine.diagnoseSketch('s1');
    engine.explainConstraint('s1', 'k1');
    expect(engine.save()).toBe(document);
    expect(engine.getState().evaluation).toBe(evaluation);
    expect(engine.getState().canUndo).toBe(false);
  });
});
