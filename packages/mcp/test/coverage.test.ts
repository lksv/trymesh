// Guard for the rule that everything the engine can do is reachable through MCP (D36).
// Changes of the document are covered by construction: `execute` takes any command and the API
// description is generated from the engine. Queries are not: each one needs a tool written by
// hand. The table below names, for every method of `Engine`, the tools that reach it. A method
// added to `Engine` without an entry does not compile, and an entry whose tool does not reach
// the method fails the test.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, Engine } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, connect, newEngine } from './kit';

type Args = Record<string, unknown>;
type Call = { tool: string; args?: Args | ((dir: string) => Args) };
type Reach = { calls: Call[] } | { internal: string };

const plate: Command = {
  type: 'batch',
  commands: [
    { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
    { type: 'addPoint', sketch: 's', id: 'p', x: 0, y: 0 },
    { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'p' }, radius: 5 },
    { type: 'addConstraint', sketch: 's', id: 'r', constraint: { type: 'radius', curve: 'k', value: 5, driving: true } },
    { type: 'addFeature', feature: { id: 'a', name: 'a', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
  ],
};
const rename: Command = { type: 'renameFeature', id: 'a', name: 'disc' };

// The order of the entries is the order the calls run in; `load` comes after `save` so that the
// file it opens exists.
const ENGINE_IN_MCP: Record<keyof Engine, Reach> = {
  execute: { calls: [{ tool: 'execute', args: { command: rename } }] },
  preview: { calls: [{ tool: 'preview', args: { command: rename } }] },
  undo: { calls: [{ tool: 'undo' }] },
  redo: { calls: [{ tool: 'redo' }] },
  getState: {
    calls: [{ tool: 'get_model' }, { tool: 'get_document' }, { tool: 'get_sketch', args: { sketch: 's' } }, { tool: 'get_parameters' }, { tool: 'get_body', args: { body: 'a' } }],
  },
  diagnoseSketch: { calls: [{ tool: 'get_sketch', args: { sketch: 's' } }] },
  explainConstraint: { calls: [{ tool: 'explain_constraint', args: { sketch: 's', constraint: 'r' } }] },
  interference: { calls: [{ tool: 'check_interference' }] },
  query: { calls: [{ tool: 'query', args: { query: 'sketchDiagnosis', args: { sketch: 's' } } }, { tool: 'get_body', args: { body: 'a' } }] },
  exportMesh: { calls: [{ tool: 'export_stl', args: (dir) => ({ path: join(dir, 'model.stl') }) }] },
  save: { calls: [{ tool: 'save_document', args: (dir) => ({ path: join(dir, 'model.json') }) }] },
  load: { calls: [{ tool: 'open_document', args: (dir) => ({ path: join(dir, 'model.json') }) }] },
  subscribe: { internal: 'change notifications for the app; an MCP client asks again instead' },
};

// An engine that records which of its methods were called.
function recording(engine: Engine): { engine: Engine; called: Set<string> } {
  const called = new Set<string>();
  const proxy = new Proxy(engine, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      return (...args: unknown[]) => {
        called.add(key);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { engine: proxy, called };
}

describe('every method of the engine is reachable through MCP', () => {
  let dir: string;
  let session: Session;
  let called: Set<string>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-coverage-'));
    const engine = newEngine();
    const built = engine.execute(plate);
    if (!built.ok) throw new Error(built.error.message);
    const recorded = recording(engine);
    called = recorded.called;
    session = await connect({ engine: recorded.engine });
  });
  afterAll(async () => {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('the tools named in the table are offered to the client', async () => {
    const offered = new Set((await session.client.listTools()).tools.map((tool) => tool.name));
    for (const [method, reach] of Object.entries(ENGINE_IN_MCP)) {
      if ('internal' in reach) continue;
      expect(reach.calls.length, method).toBeGreaterThan(0);
      for (const call of reach.calls) expect(offered.has(call.tool), `${method}: ${call.tool}`).toBe(true);
    }
  });

  for (const [method, reach] of Object.entries(ENGINE_IN_MCP)) {
    if ('internal' in reach) continue;
    for (const call of reach.calls) {
      it(`${call.tool} reaches Engine.${method}`, async () => {
        called.clear();
        const result = await session.call(call.tool, typeof call.args === 'function' ? call.args(dir) : call.args);
        expect(result?.error, JSON.stringify(result)).toBeUndefined();
        expect([...called]).toContain(method);
      });
    }
  }
});
