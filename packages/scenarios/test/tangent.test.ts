// A tangency of a line and an arc at a common end (D52): the solver adapter gives it to planegcs as
// "the radius to the common end is square to the line". These are the documents the change meets on
// load: sketches saved by the adapter of before the change (fixtures/d52-saved-by-master.json, made
// by that adapter), loaded by this one.
import { readFileSync } from 'node:fs';
import type { Engine, EngineState, Id } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine, run } from './kit';

type Saved = { status: string; warnings: string[]; document: unknown };
const SAVED = JSON.parse(readFileSync(new URL('./fixtures/d52-saved-by-master.json', import.meta.url), 'utf8')) as Record<'slotExact' | 'slotJoinedExact' | 'slotNoisy' | 'slotInConflict' | 'fixedOffTangent', Saved>;

// A saved document without its header and without the empty section `meshes` a later build adds
// (D55): what the sketch tests compare.
const content = (document: unknown): unknown => {
  const { schemaVersion: _version, schemaSteps: _steps, meshes, ...rest } = document as Record<string, unknown>;
  expect(meshes ?? {}).toEqual({});
  return rest;
};

function load(saved: Saved): { engine: Engine; state: EngineState } {
  const engine = newEngine();
  const result = engine.load(JSON.stringify(saved.document));
  if (!result.ok) throw new Error(result.error.message);
  return { engine, state: result.state };
}
const at = (state: EngineState, id: Id): [number, number] => {
  const p = state.evaluation.features.s.sketch!.points[id];
  return [p.x, p.y];
};
const close = (p: [number, number], x: number, y: number, tolerance = 1e-6) => {
  expect(Math.abs(p[0] - x)).toBeLessThan(tolerance);
  expect(Math.abs(p[1] - y)).toBeLessThan(tolerance);
};

describe('sketches saved before the change of the solver adapter (D52)', () => {
  it('a slot drawn exactly, with its ends as one point or joined, loads as it was saved and can now be changed', () => {
    for (const name of ['slotExact', 'slotJoinedExact'] as const) {
      expect(SAVED[name], name).toMatchObject({ status: 'ok', warnings: [] });
      const { engine, state } = load(SAVED[name]);
      expect(state.evaluation.features.s.status, name).toBe('ok');
      expect(state.evaluation.features.s.warnings).toEqual([]);
      expect(content(JSON.parse(engine.save())), name).toEqual(content(SAVED[name].document));
      // the adapter of before answered this change with a conflict
      const changed = run(engine, { type: 'setConstraintValue', sketch: 's', id: 'len', value: 30 });
      expect(changed.evaluation.features.s.status, name).toBe('ok');
      close(at(changed, 'm2'), 30, 0);
      close(at(changed, 'b'), 30, -5);
      close(at(changed, 'c'), 30, 5);
    }
  });

  it('a slot drawn off by 1e-6 and changed before loads without a warning and follows the next change', () => {
    expect(SAVED.slotNoisy).toMatchObject({ status: 'ok', warnings: [] });
    const { engine, state } = load(SAVED.slotNoisy);
    expect(state.evaluation.features.s).toMatchObject({ status: 'ok', warnings: [] });
    const changed = run(engine, { type: 'setConstraintValue', sketch: 's', id: 'r', value: 5 }, { type: 'setConstraintValue', sketch: 's', id: 'len', value: 25 });
    expect(changed.evaluation.features.s.status).toBe('ok');
    for (const [id, x, y] of [['m1', 0, 0], ['m2', 25, 0], ['a', 0, -5], ['b', 25, -5], ['c', 25, 5], ['d', 0, 5]] as [Id, number, number][]) close(at(changed, id), x, y);
  });

  it('known limit: a slot the adapter of before left in conflict is solved on load, to what its dimensions say', () => {
    // drawn exactly, then its length set to 30: a conflict, the points where they were (20 long)
    expect(SAVED.slotInConflict).toMatchObject({ status: 'warning', warnings: ['sketchConflict'] });
    const document = SAVED.slotInConflict.document as { features: { points?: Record<Id, { x: number }> }[] };
    expect(document.features[0].points?.m2.x).toBe(20);
    const { engine, state } = load(SAVED.slotInConflict);
    expect(state.evaluation.features.s).toMatchObject({ status: 'ok', warnings: [] });
    close(at(state, 'm2'), 30, 0);
    expect(JSON.parse(engine.save())).not.toEqual(SAVED.slotInConflict.document);
  });

  it('known limit: a tangency held by fixed points 1e-6 off tangent was solved before and is a conflict now', () => {
    expect(SAVED.fixedOffTangent).toMatchObject({ status: 'ok', warnings: [] });
    const { state } = load(SAVED.fixedOffTangent);
    const sketch = state.evaluation.features.s;
    expect(sketch.status).toBe('warning');
    expect(sketch.warnings.map((warning) => warning.code)).toEqual(['sketchConflict']);
    expect(sketch.sketch?.conflicting).toEqual(['fixa', 'fixb', 'fixc', 'fixe', 't']);
    // the geometry is the stored one
    close(at(state, 'c'), 1e-6, 1, 1e-12);
  });
});
