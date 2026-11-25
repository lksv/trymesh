// Regressions from reviews of the MCP package.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type SketchFeature, type SketchResult, emptySketch } from '@trymesh/engine';
import { engineTypes } from '../src/api';
import { callTool, openEndAdvice } from '../src/tools';
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

  // round 2, nit 4: the open ends of a projection that forms regions were called ends of copies
  it('the advice of open ends calls the ends of a projection its own, and names copies as copies', () => {
    const feature = { ...emptySketch('s', 's', { kind: 'base', plane: 'XY' }), external: { e1: { type: 'edge', body: 'b', edge: { a: { feature: 'x', role: 'endCap' }, b: { feature: 'x', role: 'side', curve: 'k' } }, kind: 'line' }, m: { type: 'pattern', sources: ['l'], transform: { type: 'mirror', axis: 'origin/y' } } } } as SketchFeature;
    const result = (ends: string[]) => ({ openEnds: { count: ends.length, ends: ends.map((end) => ({ end, reason: 'apart', near: [], distance: 1 })) } }) as unknown as SketchResult;
    const projected = openEndAdvice(feature, result(['e1/a']));
    expect(projected).toMatch(/^1 end of `e1` is open/);
    expect(projected).toContain('Projected curves close with what lies at their ends within 1e-6 mm: end an own curve at it, or project the edge that continues it.');
    expect(projected).not.toContain('copies');
    expect(openEndAdvice(feature, result(['m/1/a', 'e1/b']))).toMatch(/^2 ends of copies of `m` and of `e1` are open/);
  });

  // nit: a grid whose first count is 1 had no shift of its first direction (copy 1 is not made)
  it('the step of a grid whose first count is 1 is read from the transform', () => {
    const engine = newEngine();
    run(engine, sketch, point('p1', 0, 0), point('p2', 0, 5), line('mk', 'p1', 'p2'));
    run(engine, { type: 'addExternal', sketch: 's', id: 'g', ref: { type: 'pattern', sources: ['mk'], transform: { type: 'linear', direction: 'origin/x', count: 1, span: { type: 'spacing', spacing: 6 }, second: { direction: 'origin/y', count: 3, span: { type: 'spacing', spacing: 10 } } } } });
    expect(ok(engine, 'get_sketch', { sketch: 's' }).external[0].step).toEqual({ shift: [6, 0], second: [0, 10] });
  });
});

// The review of the implementation of 6f (D72): the tool import_outline and the row of get_sketch.
describe('import_outline and get_sketch of an outline: the review of 6f', () => {
  const SKETCH = { type: 'addFeature', feature: { ...emptySketch('s', 's', { kind: 'base', plane: 'XY' }) } } as Command;
  const dxf = (...entities: (string | number)[][]): string => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat().map(String), '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const line = (a: number[], b: number[]) => ['0', 'LINE', '8', '0', '10', a[0], '20', a[1], '11', b[0], '21', b[1]];
  const arc = (c: number[], r: number, from: number, to: number) => ['0', 'ARC', '8', '0', '10', c[0], '20', c[1], '40', r, '50', from, '51', to];
  const circle = (c: number[], r: number) => ['0', 'CIRCLE', '8', '0', '10', c[0], '20', c[1], '40', r];
  const file = (name: string, text: string) => ({ name, base64: Buffer.from(text).toString('base64') });
  const engineWithSketch = (): Engine => {
    const engine = newEngine();
    expect(callTool(engine, 'execute', { command: SKETCH }).ok).toBe(true);
    return engine;
  };
  const ok = (engine: Engine, name: string, args: Record<string, unknown>): any => {
    const outcome = callTool(engine, name, args);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.result;
  };
  const row = (engine: Engine, id: string) => ok(engine, 'get_sketch', { sketch: 's' }).external.find((entry: { id: string }) => entry.id === id);

  // S1: the box was grown from the points of the entry, so the bulge of an arc and the curve of a
  // spline were not in it
  it('S1: the box of the row is the curves at their places: an arc that bulges, two half arcs, a spline', () => {
    const engine = engineWithSketch();
    const r = Math.hypot(50, 50);
    ok(engine, '_outline', { file: file('dome.dxf', dxf(line([0, 0], [100, 0]), line([100, 0], [100, 50]), arc([50, 0], r, 45, 135), line([0, 50], [0, 0]))), sketch: 's', id: 'd' });
    expect(row(engine, 'd').box).toEqual([0, 0, 100, Math.round(r * 1e6) / 1e6]);
    ok(engine, '_outline', { file: file('ring.dxf', dxf(arc([0, 0], 5, 0, 180), arc([0, 0], 5, 180, 360))), sketch: 's', id: 'h', x: 200 });
    expect(row(engine, 'h').box).toEqual([195, -5, 205, 5]);
    ok(engine, '_outline', { file: file('c.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><path d="M0 0 C0 20 10 20 10 0 Z"/></svg>'), sketch: 's', id: 'c', y: -100 });
    expect(row(engine, 'c').box).toEqual([0, -115, 10, -100]);
  });

  // M1: the advice of a revision came with every refusal, a placement under a taken ID among them
  it('M1: a refused placement has no advice of a revision; a refused replacement names the constraints to remove (hold)', () => {
    const engine = engineWithSketch();
    const board = file('b.dxf', dxf(line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 10]), line([0, 10], [0, 0]), circle([5, 5], 1)));
    for (const args of [{ id: 's' }, { x: 'nope + 1' }, { id: 'a/b' }]) {
      const answer = ok(engine, '_outline', { file: board, sketch: 's', ...args });
      expect(answer.refused).toBeTruthy();
      expect(answer.next).not.toMatch(/remove/);
    }
    ok(engine, '_outline', { file: board, sketch: 's', id: 'b' });
    ok(engine, 'execute', { command: { type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'p', x: 1, y: 1 }, { type: 'addConstraint', sketch: 's', id: 'k', constraint: { type: 'coincident', a: 'p', b: 'b/c1/center' } }] } });
    const holeless = file('b.dxf', dxf(line([0, 0], [10, 0]), line([10, 0], [10, 10]), line([10, 10], [0, 10]), line([0, 10], [0, 0])));
    const refused = ok(engine, '_outline', { file: holeless, sketch: 's', id: 'b', replace: true });
    expect(refused.refused).toMatch(/b\/c1/);
    expect(refused.hold).toEqual([{ constraint: 'k', entities: ['b/c1/center'] }]);
    expect(refused.next).toContain('remove: ["k"]');
    expect(ok(engine, '_outline', { file: holeless, sketch: 's', id: 'b', replace: true, remove: ['k'] }).refused).toBeUndefined();
  });

  // M2: the advice after a placement named `<id>/l1`, which an outline of circles does not have
  it('M2: the advice after a placement names the first curve the file gave', () => {
    const engine = engineWithSketch();
    const placed = ok(engine, '_outline', { file: file('holes.dxf', dxf(circle([0, 0], 1), circle([5, 0], 1))), sketch: 's', id: 'h' });
    expect(placed.next).toContain('curve: "h/c1"');
    expect(placed.next).not.toContain('h/l1');
  });

  // the second round, nit 7: the example of the points of each kind was the last curve of the kind
  it('the advice after a placement gives the first curve of each kind as the example of its points', () => {
    const engine = engineWithSketch();
    const placed = ok(engine, '_outline', { file: file('two.dxf', dxf(line([0, 0], [10, 0]), line([10, 0], [10, 10]), circle([20, 0], 1), circle([30, 0], 1))), sketch: 's', id: 't' });
    expect(placed.next).toContain('`t/l1/a`, `t/c1/center`');
    expect(placed.next).not.toMatch(/t\/l2\/a|t\/c2\/center/);
  });

  // M5: the `more` of the row starts where the query's next page does
  it('M5: the row of a large outline points entryCurves at the next page', () => {
    const engine = engineWithSketch();
    const circles = Array.from({ length: 60 }, (_, i) => circle([3 * i, 0], 1));
    ok(engine, '_outline', { file: file('many.dxf', dxf(...circles)), sketch: 's', id: 'm' });
    const shown = row(engine, 'm');
    expect(shown.listed).toBe(50);
    expect(shown.more).toContain('from: 50');
  });
});
