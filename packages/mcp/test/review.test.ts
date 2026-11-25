// Regressions from reviews of the MCP package.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, emptySketch } from '@trymesh/engine';
import { engineTypes } from '../src/api';
import { callTool } from '../src/tools';
import { newEngine } from './kit';

describe('regressions from reviews', () => {
  // D64, the review of 6a part 5: the description for the AI keeps everything after the ports, so
  // the result of a sketch with its curves that are not own is in it (a note had said it was not).
  it('describe_api shows ResultCurve and the curves of a sketch result', () => {
    const types = engineTypes();
    expect(types).toContain('export interface ResultCurve');
    expect(types).toContain('curves: Record<Id, ResultCurve>;');
  });
});

// The review of the implementation of 6c (D68).
describe('get_sketch of a mirror or pattern: the review of 6c', () => {
  const ok = (engine: Engine, name: string, args: Record<string, unknown> = {}): any => {
    const outcome = callTool(engine, name, args);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.result;
  };
  const run = (engine: Engine, ...commands: Command[]) => ok(engine, 'execute', { command: { type: 'batch', commands } });
  const point = (id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: 's', id, x, y });
  const line = (id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch: 's', id, curve: { type: 'line', a, b } });
  const sketch: Command = { type: 'addFeature', feature: emptySketch('s', 's', { kind: 'base', plane: 'XY' }) };

  // M5: a row of open marks got the advice of a mirror (a constraint on the axis)
  it('the advice of open ends follows the transform: a row may be open on purpose, a ring takes a count or an angle', () => {
    const engine = newEngine();
    run(engine, sketch, point('p1', 0, 0), point('p2', 0, 5), line('mk', 'p1', 'p2'));
    run(engine, { type: 'addExternal', sketch: 's', id: 'r', ref: { type: 'pattern', sources: ['mk'], transform: { type: 'linear', direction: 'origin/x', count: 3, span: { type: 'spacing', spacing: 6 } } } });
    const row = ok(engine, 'get_sketch', { sketch: 's' }).advice.find((text: string) => text.includes('open (`openEnds`'));
    expect(row).toMatch(/^4 ends of copies of `r` are open/);
    expect(row).toContain('or leave them open if that is meant');
    expect(row).not.toContain('axis');
    run(engine, { type: 'updateExternal', sketch: 's', id: 'r', ref: { type: 'pattern', sources: ['mk'], transform: { type: 'circular', center: 'origin', count: 3, span: { type: 'full' } } } });
    const ring = ok(engine, 'get_sketch', { sketch: 's' }).advice.find((text: string) => text.includes('open (`openEnds`'));
    expect(ring).toContain('choose a count or an angle that brings the copies together');
  });

  // nit: a grid whose first count is 1 had no shift of its first direction (copy 1 is not made)
  it('the step of a grid whose first count is 1 is read from the transform', () => {
    const engine = newEngine();
    run(engine, sketch, point('p1', 0, 0), point('p2', 0, 5), line('mk', 'p1', 'p2'));
    run(engine, { type: 'addExternal', sketch: 's', id: 'g', ref: { type: 'pattern', sources: ['mk'], transform: { type: 'linear', direction: 'origin/x', count: 1, span: { type: 'spacing', spacing: 6 }, second: { direction: 'origin/y', count: 3, span: { type: 'spacing', spacing: 10 } } } } });
    expect(ok(engine, 'get_sketch', { sketch: 's' }).external[0].step).toEqual({ shift: [6, 0], second: [0, 10] });
  });
});
