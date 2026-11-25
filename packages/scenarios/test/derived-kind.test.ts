// The slots of derived geometry (D68, the second point of work of 6c) against the real solver, on
// a kind of entry that only this test registers: `testCopy` copies one own line `count − 1` times,
// 10 mm apart along X, under `<entry>/<n>/<line>` and `<entry>/<n>/<point>`, and reads its count as
// a numeric field at `external/<id>/count`. What it checks holds for any derived kind: the copies
// are made after the solver and never reach its input, the stamp or the stored values; they are in
// the result and in the world of the sketch, not in its base; constraints cannot name them; the
// fields of an entry take expressions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Command, type Engine, type ExternalRef, type Id, type SketchFeature, type SketchResult, entryInput, fieldsOf, sketchWorld, toolBase } from '@trymesh/engine';
import { REFERENCE_KINDS } from '../../engine/src/references/index';
import type { NumberSpec } from '../../engine/src/catalog';
import type { DerivedKindSpec } from '../../engine/src/references/spec';
import { solverSetup } from '../../engine/src/sketch';
import { curvePoints } from '../../engine/src/sketch-content';
import { string } from '../../engine/src/validation';
import { XY, addExtrude, addSketch, batch, cap, newEngine, rectLoop, rectangle, run, side } from './kit';

interface TestCopy {
  type: 'testCopy';
  line: Id;
  count: number;
}
const COUNT: NumberSpec = { title: 'count', unit: 'count', min: { value: 1 }, max: { value: 20 }, integer: true };
const testCopy: DerivedKindSpec<TestCopy> = {
  source: 'derived',
  title: 'Test copies',
  summary: 'Copies of a line, side by side.',
  example: { id: 't', ref: { type: 'testCopy', line: 'l1', count: 2 } },
  validate: (context, _sketch, id, o, what) => ({ type: 'testCopy', line: string(o.line, `${what}.line`), count: context.fields.number(o.count, `external/${id}/count`, COUNT, `${what}.count`) }),
  refs: () => [],
  faces: () => [],
  entities: (id, ref, sketch) => {
    const out: Record<Id, 'line' | 'point'> = {};
    const line = sketch.curves[ref.line];
    if (!line || line.type !== 'line') return out;
    for (let n = 1; n < ref.count; n++) {
      out[`${id}/${n}/${ref.line}`] = 'line';
      for (const p of curvePoints(line)) out[`${id}/${n}/${p}`] = 'point';
    }
    return out;
  },
  entity: (id, ref, sketch, entry) => {
    const [owner, n, source, ...rest] = id.split('/');
    if (owner !== entry || rest.length || !/^[1-9][0-9]?$/.test(n)) return undefined;
    const line = sketch.curves[ref.line];
    if (!line || line.type !== 'line') return undefined;
    return source === ref.line ? 'line' : curvePoints(line).includes(source) ? 'point' : undefined;
  },
  commandProblem: (sketch, ref, before) => (before?.line === ref.line || sketch.curves[ref.line]?.type === 'line' ? undefined : `"${ref.line}" is not an own line of the sketch`),
  derive: (id, ref, base) => {
    const line = base.sketch.curves[ref.line];
    if (!line || line.type !== 'line') return { code: 'brokenProjection', refs: [id, ref.line] };
    const geometry = { points: {} as Record<Id, { x: number; y: number }>, curves: {} as Record<Id, { type: 'line'; a: Id; b: Id }>, radii: {}, regions: [] as Id[] };
    for (let n = 1; n < ref.count; n++) {
      for (const p of [line.a, line.b]) geometry.points[`${id}/${n}/${p}`] = { x: base.geometry.points[p].x + 10 * n, y: base.geometry.points[p].y };
      geometry.curves[`${id}/${n}/${ref.line}`] = { type: 'line', a: `${id}/${n}/${line.a}`, b: `${id}/${n}/${line.b}` };
      geometry.regions.push(`${id}/${n}/${ref.line}`);
    }
    return geometry;
  },
};
const kinds = REFERENCE_KINDS as unknown as Record<string, unknown>;
beforeAll(() => void (kinds.testCopy = testCopy));
afterAll(() => void delete kinds.testCopy);

const entry = (line: Id, count: number | string): ExternalRef => ({ type: 'testCopy', line, count }) as unknown as ExternalRef;
const sketchOf = (engine: Engine, id: Id): SketchFeature => engine.getState().document.features.find((f) => f.id === id) as SketchFeature;
const resultOf = (engine: Engine, id: Id): SketchResult => engine.getState().evaluation.features[id].sketch as SketchResult;
const refused = (engine: Engine, command: Command): string => {
  const result = engine.execute(command);
  return result.ok ? 'accepted' : result.error.message;
};
const point = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
const fixed = (sketch: Id, id: Id, p: Id): Command => ({ type: 'addConstraint', sketch, id, constraint: { type: 'fixed', point: p } as never });

// A plate whose bottom edge S2 projects as `e` and its right edge as `f`; in S2 a line `l` from
// (5, 5) to (5, 15), both ends fixed, and `c`, its copies.
function setup(count: number | string = 3): Engine {
  const engine = newEngine();
  run(
    engine,
    { type: 'setParameter', name: 'n', expr: '3' },
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 60, 40),
    addExtrude('plate', 'S1', [rectLoop('r')], 5),
    addSketch('S2', XY),
    { type: 'addExternal', sketch: 'S2', id: 'e', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate', 'startCap'), b: side('plate', 'ra') }, kind: 'line' } },
    batch(point('S2', 'p', 5, 5), point('S2', 'q', 5, 15), line('S2', 'l', 'p', 'q'), fixed('S2', 'k1', 'p'), fixed('S2', 'k2', 'q')),
    { type: 'addExternal', sketch: 'S2', id: 'c', ref: entry('l', count) },
    { type: 'addExternal', sketch: 'S2', id: 'f', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate', 'startCap'), b: side('plate', 'rb') }, kind: 'line' } },
  );
  return engine;
}

describe('derived geometry: the copies never reach the solver', () => {
  it('the stamp and the input of the solver are those of the sketch without the entry, at every count', () => {
    const engine = setup(3);
    const without = { ...sketchOf(engine, 'S2'), external: { e: sketchOf(engine, 'S2').external.e, f: sketchOf(engine, 'S2').external.f } };
    const stamp = sketchOf(engine, 'S2').solved.inputs;
    expect(stamp).not.toBe('');
    run(engine, { type: 'setField', feature: 'S2', path: 'external/c/count', value: 6 });
    expect(sketchOf(engine, 'S2').solved.inputs).toBe(stamp);
    expect(Object.keys(resultOf(engine, 'S2').curves).filter((id) => id.startsWith('c/'))).toHaveLength(5);
    // the stamp of the sketch as the engine would compute it without the entry, from the stored
    // values of the two projections
    const references = Object.fromEntries(Object.entries(sketchOf(engine, 'S2').solved.external).map(([id, value]) => [id, { value, geometry: { points: {}, curves: {}, radii: {}, regions: [] } }]));
    expect(Object.keys(sketchOf(engine, 'S2').solved.external).sort()).toEqual(['e', 'f']);
    expect(solverSetup(without, references).input.curves).not.toHaveProperty('c/1/l');
  });

  it('a value stored under a derived entry is refused on load', () => {
    const engine = setup();
    const document = engine.getState().document;
    const s2 = sketchOf(engine, 'S2');
    const stored = { ...document, features: document.features.map((f) => (f.id === 'S2' ? { ...s2, solved: { ...s2.solved, external: { ...s2.solved.external, c: { kind: 'line', a: [0, 0], b: [1, 0] } } } } : f)) };
    const result = newEngine().load(JSON.stringify(stored));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('"c" neodpovídá');
  });

  it('the result has the copies, derived, in the order of the entries; the base of a tool has none, its world has them', () => {
    const engine = setup(3);
    const result = resultOf(engine, 'S2');
    expect(Object.keys(result.curves)).toEqual(['e', 'c/1/l', 'c/2/l', 'f']);
    expect(result.curves['c/2/l']).toEqual({ shape: { type: 'line', a: 'c/2/p', b: 'c/2/q' }, source: 'derived', regions: true });
    expect(result.points['c/2/q']).toEqual({ x: 25, y: 15 });
    const base = toolBase(sketchOf(engine, 'S2'), result);
    expect(base.curves.some((curve) => curve.source === 'derived')).toBe(false);
    const world = sketchWorld(base);
    expect(world.curves.get('c/1/l')).toMatchObject({ source: 'derived', regions: true });
    expect(world.geometry.points['c/1/p']).toEqual({ x: 15, y: 5 });
    expect(Object.keys(world.derived.entries)).toEqual(['c']);
  });

  it('a copy is an entity that is derived, for any copy number; no constraint may name it', () => {
    const engine = setup(3);
    const text = refused(engine, { type: 'addConstraint', sketch: 'S2', id: 'k3', constraint: { type: 'vertical', line: 'c/1/l' } });
    expect(text).toContain('"c/1/l" is a copy of the mirror or pattern "c": a copy cannot be constrained in its own sketch');
    expect(text).toContain('constrain its source "l"');
    expect(refused(engine, { type: 'addConstraint', sketch: 'S2', id: 'k3', constraint: { type: 'coincident', a: 'p', b: 'c/9/q' } })).toContain('"c/9/q" is a copy');
    expect(refused(engine, { type: 'addConstraint', sketch: 'S2', id: 'k3', constraint: { type: 'coincident', a: 'p', b: 'c/100/q' } })).toContain('entita "c/100/q" ve skice není');
    expect(refused(engine, { type: 'removeEntity', sketch: 'S2', id: 'c/1/l' })).toContain('není vlastní');
    expect(refused(engine, { type: 'dragPoint', sketch: 'S2', point: 'c/1/p', x: 0, y: 0 })).toContain('není vlastní');
  });

  it('the commands ask the kind against the sketch, and an update may not change the source of an entry', () => {
    const engine = setup();
    expect(refused(engine, { type: 'addExternal', sketch: 'S2', id: 'd', ref: entry('nothing', 2) })).toBe('addExternal.ref: "nothing" is not an own line of the sketch');
    expect(refused(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: { type: 'edge', body: 'plate', edge: { a: cap('plate', 'startCap'), b: side('plate', 'ra') }, kind: 'line' } })).toBe('updateExternal: an entry of reference geometry cannot become derived geometry, or the other way; remove it and add the other');
    expect(refused(engine, { type: 'updateExternal', sketch: 'S2', id: 'e', ref: entry('l', 2) })).toContain('cannot become derived geometry');
    // a source gone since: the update of the count is still taken (only what it brings in is asked)
    run(engine, { type: 'removeEntity', sketch: 'S2', id: 'l' });
    expect(engine.getState().evaluation.features.S2.warnings.map((w) => w.code)).toContain('brokenProjection');
    run(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: entry('l', 4) });
  });
});

describe('derived geometry: the numeric fields of an entry', () => {
  it('take expressions: add, fieldsOf, setField, renameParameter, the input form', () => {
    const engine = setup('n');
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'n' });
    expect((sketchOf(engine, 'S2').external.c as unknown as TestCopy).count).toBe(3);
    expect(fieldsOf(sketchOf(engine, 'S2')).find((f) => f.path === 'external/c/count')).toMatchObject({ expr: 'n', value: 3 });
    expect(entryInput(sketchOf(engine, 'S2'), 'c')).toEqual({ type: 'testCopy', line: 'l', count: 'n' });
    run(engine, { type: 'setParameter', name: 'n', expr: '5' });
    expect(Object.keys(resultOf(engine, 'S2').curves).filter((id) => id.startsWith('c/'))).toHaveLength(4);
    expect((sketchOf(engine, 'S2').external.c as unknown as TestCopy).count).toBe(5); // written back
    run(engine, { type: 'setField', feature: 'S2', path: 'external/c/count', value: 'n + 1' });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'n + 1' });
    run(engine, { type: 'renameParameter', name: 'n', to: 'copies' });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'copies + 1' });
    expect(Object.keys(resultOf(engine, 'S2').curves).filter((id) => id.startsWith('c/'))).toHaveLength(5);
    // a number removes the expression
    run(engine, { type: 'setField', feature: 'S2', path: 'external/c/count', value: 2 });
    expect(sketchOf(engine, 'S2').expressions).toBeUndefined();
  });

  it('an expression that fails keeps the last number, with invalidExpression', () => {
    const engine = setup('n');
    run(engine, { type: 'setParameter', name: 'n', expr: '50' });
    const status = engine.getState().evaluation.features.S2;
    expect(status.warnings.map((w) => w.code)).toContain('invalidExpression');
    expect(Object.keys(resultOf(engine, 'S2').curves).filter((id) => id.startsWith('c/'))).toHaveLength(2);
  });

  it('are kept across constraint commands and go with the entry', () => {
    const engine = setup('n');
    run(engine, { type: 'addConstraint', sketch: 'S2', id: 'k3', constraint: { type: 'distance', a: 'p', b: 'q', value: 'n * 3 + 1', driving: true } as never });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'constraints/k3/value': 'n * 3 + 1', 'external/c/count': 'n' });
    run(engine, { type: 'removeConstraint', sketch: 'S2', id: 'k3' }, { type: 'removeConstraint', sketch: 'S2', id: 'k1' });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'n' });
    run(engine, { type: 'removeExternal', sketch: 'S2', id: 'c' });
    expect(sketchOf(engine, 'S2').expressions).toBeUndefined();
  });

  it('an update sets every field anew; a repeated expression is no change, even when it no longer evaluates', () => {
    const engine = setup('n');
    run(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: entry('l', 4) });
    expect(sketchOf(engine, 'S2').expressions).toBeUndefined();
    run(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: entry('l', 'n') });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'n' });
    run(engine, { type: 'removeParameter', name: 'n' });
    // the input form sent back with an expression whose parameter is gone
    run(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: entryInput(sketchOf(engine, 'S2'), 'c') });
    expect(sketchOf(engine, 'S2').expressions).toEqual({ 'external/c/count': 'n' });
    expect(refused(engine, { type: 'updateExternal', sketch: 'S2', id: 'c', ref: entry('l', 'n + 1') })).toContain('n');
    expect(refused(engine, { type: 'addExternal', sketch: 'S2', id: 'd', ref: entry('l', 'n') })).toContain('n');
  });

  it('a document with the expression of an entry saves and loads', () => {
    const engine = setup('n');
    const loaded = newEngine();
    const result = loaded.load(JSON.stringify(engine.getState().document));
    expect(result.ok).toBe(true);
    expect(sketchOf(loaded, 'S2').expressions).toEqual({ 'external/c/count': 'n' });
    expect(Object.keys(resultOf(loaded, 'S2').curves)).toEqual(['e', 'c/1/l', 'c/2/l', 'f']);
    const stray = engine.getState().document;
    const bad = { ...stray, features: stray.features.map((f) => (f.id === 'S2' ? { ...f, expressions: { 'external/c/count': 'n', 'external/c/other': '2' } } : f)) };
    expect(newEngine().load(JSON.stringify(bad)).ok).toBe(false);
  });
});
