// The projection from another sketch through MCP (D69): what describe_api says of it, an entry
// added by execute and read back by get_sketch, the query sketchSources and the sketch tool
// projectSketch with an own outline.
import type { Command, Engine } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { apiText, sketchToolCatalog } from '../src/api';
import { callTool } from '../src/tools';
import { newEngine } from './kit';

const ok = (engine: Engine, name: string, args: Record<string, unknown> = {}): any => {
  const outcome = callTool(engine, name, args);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
};
const sketch = (id: string, plane: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } }) as Command;
const plane = (id: string, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset } }) as Command;

// `base` on XY with the rectangle of the example of the tool rectangle; `top` on a plane 5 above it.
function fixture(engine: Engine): void {
  ok(engine, 'execute', { command: sketch('base', { kind: 'base', plane: 'XY' }) });
  ok(engine, 'sketch_tool', { sketch: 'base', tool: 'rectangle', input: { first: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, opposite: { at: [40, 30] } } });
  ok(engine, 'execute', { command: { type: 'batch', commands: [plane('up', 5), sketch('top', { kind: 'plane', feature: 'up' })] } });
}

describe('the projection from a sketch through MCP (D69)', () => {
  it('describe_api: the entry type, the kind, the query, the tool and its input kinds', () => {
    const text = apiText();
    expect(text).toContain('export interface SketchProjection');
    expect(text).toContain("| { kind: 'arc'; center: Vec2; start: Vec2; end: Vec2 }");
    expect(text).toContain('- sketch (Projection from a sketch, reference geometry)');
    expect(text).toContain('- sketchSources (');
    expect(text).toContain('- projectSketch (Project from a sketch)');
    const tool = sketchToolCatalog().find((entry) => entry.tool === 'projectSketch');
    expect(tool?.inputs).toEqual([
      { name: 'sketch', description: 'the ID of an earlier sketch of the document', required: true },
      { name: 'entities', description: 'IDs of points and curves of the sketch `sketch`, as its get_sketch or the query sketchSources lists them', required: false },
      { name: 'as', description: 'one of "source", "reference", "regions", "own"', required: false },
    ]);
  });

  it('an entry by execute, read back by get_sketch; the query and the tool with an own outline', () => {
    const engine = newEngine();
    fixture(engine);
    const sources = ok(engine, 'query', { query: 'sketchSources', args: { sketch: 'top', from: 'base' } });
    expect(sources.sources).toEqual([expect.objectContaining({ sketch: 'base', status: 'parallel', curves: 4 })]);
    const line = sources.entities.find((e: { id: string }) => e.id === 'c1');
    expect(line).toMatchObject({ kind: 'line', whole: true, regions: true });
    const added = ok(engine, 'execute', { command: { type: 'addExternal', sketch: 'top', id: 'x1', ref: { type: 'sketch', sketch: 'base', entity: 'c1', kind: 'line' } } });
    expect(added.problems ?? []).toEqual([]);
    const answer = ok(engine, 'get_sketch', { sketch: 'top' });
    expect(answer.external[0]).toMatchObject({ id: 'x1', type: 'sketch', sketch: 'base', entity: 'c1', kind: 'line', regions: false });
    // its entities and the positions of its points; a circle with its radius
    expect(answer.external[0]).toMatchObject({ entities: ['x1', 'x1/a', 'x1/b'], at: [line.a, line.b] });
    const made = ok(engine, 'sketch_tool', { sketch: 'top', tool: 'projectSketch', input: { sketch: 'base', as: 'own' } });
    expect(made.ids.skipped).toEqual(['c1']);
    expect(made.ids.entries).toHaveLength(3);
    // c1 is projected already and gets no own curve: the outline stays open
    expect(made.ids.curves).toHaveLength(3);
    expect(made.sketches.find((s: { id: string }) => s.id === 'top')).toMatchObject({ solved: true });
    // a circle: its entities, the position of its centre and its radius
    ok(engine, 'execute', { command: { type: 'batch', commands: [{ type: 'addPoint', sketch: 'base', id: 'k0', x: 20, y: 15 }, { type: 'addCurve', sketch: 'base', id: 'k', curve: { type: 'circle', center: 'k0' }, radius: 5 }] } });
    ok(engine, 'execute', { command: { type: 'addExternal', sketch: 'top', id: 'xk', ref: { type: 'sketch', sketch: 'base', entity: 'k', kind: 'circle', regions: true } } });
    expect(ok(engine, 'get_sketch', { sketch: 'top' }).external.find((e: { id: string }) => e.id === 'xk')).toEqual({ id: 'xk', type: 'sketch', sketch: 'base', entity: 'k', kind: 'circle', regions: true, entities: ['xk', 'xk/center'], at: [[20, 15]], radius: 5 });
  });
});
