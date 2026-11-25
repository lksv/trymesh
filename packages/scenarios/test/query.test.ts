// `Engine.query` against the real adapters (D37): the state a query answers for, its errors, and
// the methods that were queries before the catalog sharing its computation.
import type { Engine, EngineState } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, circle, constrain, newEngine, rectLoop, rectangle, run } from './kit';

// Two plates: LOW 40 × 30 × 10 and HIGH, the same rectangle from 5 to 15, so they share 40 × 30 × 5.
// A pin stands apart. The sketch S2 comes after the bodies.
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'k', 100, 0, 4),
    addExtrude('LOW', 'S1', [rectLoop('r')], 10),
    { type: 'addFeature', feature: { id: 'HIGH', name: 'HIGH', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: rectLoop('r') }] }, extent: { type: 'distance', start: 5, distance: 10 }, operation: 'new' } },
    addExtrude('PIN', 'S1', [['k']], 10),
    addSketch('S2', XY),
    circle('S2', 'c', 0, 0, 3),
  );
  return engine;
}
const failure = (outcome: { ok: boolean; error?: { code: string; arg?: readonly (string | number)[]; message: string } }) => (outcome.ok ? 'ok' : [outcome.error?.code, outcome.error?.arg, outcome.error?.message]);

describe('Engine.query', () => {
  it('answers what the method of the same name answers, and shares what it computed', () => {
    const engine = model();
    const asked = engine.query('interference', {});
    expect(asked).toEqual({ ok: true, result: engine.interference() });
    expect(asked.ok && asked.result).toMatchObject({ pairs: [{ a: 'HIGH', b: 'LOW', volume: expect.closeTo(6000, 3), depth: expect.closeTo(5, 4) }], fits: [], failed: [], checked: 3 });
    expect(engine.query('interference', { bodies: ['LOW', 'PIN'] })).toEqual({ ok: true, result: { pairs: [], fits: [], failed: [], checked: 1 } });
    expect(engine.query('interference', { bodies: ['LOW'] })).toEqual({ ok: true, result: { pairs: [], fits: [], failed: [], checked: 0 } }); // an answer, not an error
    expect(engine.query('interference', { threshold: 7000 })).toMatchObject({ ok: true, result: { pairs: [] } });
    expect(engine.query('interference', { threshold: 1e12 })).toMatchObject({ ok: true, result: { pairs: [] } }); // no limit of the document on an argument

    const diagnosis = engine.query('sketchDiagnosis', { sketch: 'S2' });
    expect(diagnosis).toEqual({ ok: true, result: engine.diagnoseSketch('S2') });
    // the diagnosis is kept by the evaluated sketch: asked either way it is the same object
    expect(diagnosis.ok && diagnosis.result).toBe(engine.diagnoseSketch('S2'));
    expect(diagnosis.ok && diagnosis.result.status).toBe('solved');
    expect(engine.query('constraintExplanation', { sketch: 'S2', constraint: 'cr' })).toEqual({ ok: true, result: engine.explainConstraint('S2', 'cr') });
  });

  it('the state asked about: now, after a feature, or one that preview returned', () => {
    const engine = model();
    expect(engine.query('interference', {}, { at: 'LOW' })).toEqual({ ok: true, result: { pairs: [], fits: [], failed: [], checked: 0 } });
    expect(engine.query('interference', {}, { at: 'LOW' })).toEqual({ ok: true, result: engine.interference({ at: 'LOW' }) });
    // a preview: HIGH moved up so that the plates only touch; nothing is written
    const before = engine.save();
    const previewed = engine.preview({ type: 'setField', feature: 'HIGH', path: 'extent/start', value: 10 });
    if (!previewed.ok) throw new Error(previewed.error.message);
    expect(engine.query('interference', {}, { state: previewed.state })).toMatchObject({ ok: true, result: { pairs: [], checked: 3 } });
    expect(engine.query('interference', {})).toMatchObject({ ok: true, result: { pairs: [{ a: 'HIGH', b: 'LOW' }] } });
    expect(engine.save()).toBe(before);
    // a state of getState is one the engine handed out as well
    expect(engine.query('interference', {}, { state: engine.getState('LOW') })).toMatchObject({ ok: true, result: { checked: 0 } });
    // a previewed state evaluated up to a feature holds the later features in its document, not in its evaluation
    const early = engine.preview({ type: 'renameFeature', id: 'LOW', name: 'low' }, 'LOW');
    if (!early.ok) throw new Error(early.error.message);
    expect(failure(engine.query('sketchDiagnosis', { sketch: 'S2' }, { state: early.state }))).toEqual(['notAvailable', ['sketch'], 'sketchDiagnosis: sketch: the sketch "S2" is not in the state asked about']);
    expect(engine.query('sketchDiagnosis', { sketch: 'S1' }, { state: early.state })).toMatchObject({ ok: true, result: { status: 'solved' } });
  });

  it('a drag preview is diagnosed as dragged, without a recompute', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), { type: 'addPoint', sketch: 'S1', id: 'p', x: 5, y: 5 }, { type: 'addPoint', sketch: 'S1', id: 'q', x: 20, y: 5 }, { type: 'addCurve', sketch: 'S1', id: 'l', curve: { type: 'line', a: 'p', b: 'q' } }, constrain('S1', 'h', { type: 'horizontal', line: 'l' }));
    const dragged = engine.preview({ type: 'dragPoint', sketch: 'S1', point: 'q', x: 30, y: 12 });
    if (!dragged.ok) throw new Error(dragged.error.message);
    const moved = dragged.state.evaluation.features.S1.sketch?.points.q;
    expect(moved?.x).toBeCloseTo(30, 3);
    const asked = engine.query('sketchDiagnosis', { sketch: 'S1' }, { state: dragged.state });
    expect(asked.ok && asked.result).toMatchObject({ status: 'solved', degreesOfFreedom: 3 });
    // the diagnosis of the document is another one: the document was not dragged
    expect(asked.ok && asked.result).not.toBe(engine.diagnoseSketch('S1'));
  });

  it('refuses with a code and the place of the argument instead of throwing', () => {
    const engine = model();
    const other = model();
    expect(failure(engine.query('interference', { bodies: ['LOW', 'nope'] }))).toEqual(['notAvailable', ['bodies', 1], 'interference: bodies[1]: the body "nope" is not in the state asked about']);
    expect(failure(engine.query('interference', { bodies: ['LOW', 'HIGH'] }, { at: 'LOW' }))).toEqual(['notAvailable', ['bodies', 1], expect.any(String)]); // not yet there
    expect(failure(engine.query('interference', { threshold: -1 }))).toEqual(['invalidArguments', ['threshold'], 'interference: threshold: the value must not be negative']);
    expect(failure(engine.query('interference', { bodies: 'LOW' } as never))).toEqual(['invalidArguments', ['bodies'], 'interference: bodies: a list is expected']);
    expect(failure(engine.query('interference', { body: 'LOW' } as never))).toEqual(['invalidArguments', ['body'], 'interference: body: there is no argument "body"; the arguments are: bodies, threshold']);
    expect(failure(engine.query('sketchDiagnosis', {} as never))).toEqual(['invalidArguments', ['sketch'], 'sketchDiagnosis: sketch: the argument is required']);
    expect(failure(engine.query('sketchDiagnosis', { sketch: 'LOW' }))).toEqual(['notAvailable', ['sketch'], expect.any(String)]);
    expect(failure(engine.query('constraintExplanation', { sketch: 'S2', constraint: 'nope' }))).toEqual(['notAvailable', ['constraint'], 'constraintExplanation: constraint: the sketch "S2" has no constraint "nope"']);
    expect(failure(engine.query('nope' as never, {} as never))).toEqual(['invalidArguments', ['query'], expect.stringMatching(/there is no query "nope"; the queries are interference, sketchDiagnosis, constraintExplanation, sketchContacts, sketchSources, body, catalog/)]);
    expect(failure(engine.query('constructor' as never, {} as never))).toEqual(['invalidArguments', ['query'], expect.any(String)]);
    expect(failure(engine.query('interference', {}, { at: 'nope' }))).toEqual(['notAvailable', ['at'], 'interference: `at`: the feature "nope" is not in the document']);
    // a state the engine did not hand out: put together by a caller, or of another engine
    const own = engine.getState();
    expect(failure(engine.query('interference', {}, { state: { ...own, evaluation: { ...own.evaluation } } }))).toEqual(['invalidArguments', ['state'], 'interference: `state` is not a state this engine handed out']);
    expect(failure(engine.query('interference', {}, { state: other.getState() }))).toEqual(['invalidArguments', ['state'], expect.any(String)]);
    expect(failure(engine.query('interference', {}, { state: own, at: 'LOW' } as never))).toEqual(['invalidArguments', ['state'], expect.stringMatching(/not both/)]);
    // an evaluation cannot be paired with another document: the engine takes the document it kept
    const renamed = engine.preview({ type: 'removeFeature', id: 'S2' });
    if (!renamed.ok) throw new Error(renamed.error.message);
    const mixed: EngineState = { ...own, document: renamed.state.document };
    expect(engine.query('sketchDiagnosis', { sketch: 'S2' }, { state: mixed })).toMatchObject({ ok: true, result: { status: 'solved' } });
  });

  it('a sketch that did not evaluate is a valid argument with the diagnosis unavailable', () => {
    const engine = model();
    run(engine, { type: 'setSuppressed', id: 'S2', suppressed: true });
    expect(engine.query('sketchDiagnosis', { sketch: 'S2' })).toMatchObject({ ok: true, result: { status: 'unavailable', degreesOfFreedom: 0 } });
    expect(engine.query('constraintExplanation', { sketch: 'S2', constraint: 'cr' })).toEqual({ ok: true, result: { redundant: false, impliedBy: [] } });
    // the methods keep their own texts and keep throwing
    expect(() => engine.diagnoseSketch('nope')).toThrow('diagnoseSketch: skica "nope" neexistuje');
    expect(() => engine.explainConstraint('S2', 'nope')).toThrow('explainConstraint: vazba "nope" ve skice "S2" není');
    expect(() => engine.interference({ bodies: ['nope'] })).toThrow('interference: the body "nope" does not exist');
    expect(() => engine.interference({ threshold: -1 })).toThrow('interference: the threshold is a volume in mm³, zero or more');
    expect(() => engine.interference({ at: 'nope' })).toThrow('getState: feature "nope" neexistuje');
  });
});
