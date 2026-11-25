// Mirror and pattern in a sketch through MCP (D68): the generated section "Entries of a sketch" and
// its examples run over the fixture, the short form of a derived entry in get_sketch and its round
// trip into updateExternal, the equal regions of copies grouped, the advice of an open end, and
// the size of the answer for a row of 200 slots.
import { type Command, type Engine, REFERENCE_KINDS, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { ENTRY_KIND_FIXTURE, apiText, entryKinds } from '../src/api';
import { callTool } from '../src/tools';
import { newEngine } from './kit';

const ok = (engine: Engine, name: string, args: Record<string, unknown> = {}): any => {
  const outcome = callTool(engine, name, args);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
};
const run = (engine: Engine, ...commands: Command[]) => ok(engine, 'execute', { command: { type: 'batch', commands } });
const XY = { kind: 'base', plane: 'XY' } as const;
const point = (sketch: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: string, id: string, a: string, b: string, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
// a rectangle `${p}1..4`, `${p}a..d` (or the given line IDs) from (x, y), w × h
const rectangle = (sketch: string, p: string, x: number, y: number, w: number, h: number, lines = ['a', 'b', 'c', 'd'].map((l) => `${p}${l}`)): Command[] => [
  point(sketch, `${p}1`, x, y),
  point(sketch, `${p}2`, x + w, y),
  point(sketch, `${p}3`, x + w, y + h),
  point(sketch, `${p}4`, x, y + h),
  line(sketch, lines[0], `${p}1`, `${p}2`),
  line(sketch, lines[1], `${p}2`, `${p}3`),
  line(sketch, lines[2], `${p}3`, `${p}4`),
  line(sketch, lines[3], `${p}4`, `${p}1`),
];

// The fixture of the section: the box `box` from `b1`..`b4` of `base`, the sketch `top` on its top
// face with `l1`..`l4` and the construction line `cl`.
function fixture(engine: Engine): void {
  run(engine, { type: 'addFeature', feature: emptySketch('base', 'base', XY) }, ...rectangle('base', 'q', 0, 0, 100, 60, ['b1', 'b2', 'b3', 'b4']));
  run(engine, {
    type: 'addFeature',
    feature: { id: 'box', name: 'box', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'base', regions: [{ outerLoop: ['b1', 'b2', 'b3', 'b4'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' },
  } as Command);
  run(engine, { type: 'addFeature', feature: emptySketch('top', 'top', { kind: 'face', body: 'box', face: { feature: 'box', role: 'endCap' } }) }, ...rectangle('top', 'p', 5, 5, 10, 10, ['l1', 'l2', 'l3', 'l4']), point('top', 'c1', 0, 30), point('top', 'c2', 90, 30), line('top', 'cl', 'c1', 'c2', true));
}

describe('the entries of a sketch in describe_api (D68)', () => {
  it('every kind of the registry is described with its source, summary, fields and example, and every example runs over the fixture', () => {
    const kinds = entryKinds();
    expect(kinds.map((kind) => kind.type)).toEqual(Object.keys(REFERENCE_KINDS));
    expect(kinds.map((kind) => kind.source)).toEqual(['reference', 'derived', 'reference', 'reference']);
    expect(kinds.find((kind) => kind.type === 'pattern')?.fields).toEqual(['external/row/transform/count (Count, count, an integer, in the interval [1, 200])', 'external/row/transform/span/spacing (Spacing, mm, non-zero)']);
    const text = apiText();
    expect(text).toContain('# Entries of a sketch');
    expect(text).toContain(ENTRY_KIND_FIXTURE);
    for (const kind of kinds) expect(text).toContain(`  example: ${JSON.stringify(kind.example)}`);
    // the hand-written sentence for the edge went
    expect(text).not.toContain('Projected edge (addExternal)');
    for (const kind of kinds) {
      const engine = newEngine();
      fixture(engine);
      const result = ok(engine, 'execute', { command: { type: 'addExternal', sketch: 'top', id: kind.example.id, ref: kind.example.ref } });
      expect(result.problems ?? [], kind.type).toEqual([]);
      expect(engine.getState().evaluation.features.top.status, kind.type).toBe('ok');
    }
  });
});

describe('get_sketch of a mirror or pattern (D68)', () => {
  function slots(engine: Engine, count: number | string): void {
    run(engine, { type: 'setParameter', name: 'vents', expr: String(count) }, { type: 'addFeature', feature: emptySketch('s', 's', XY) }, ...rectangle('s', 'o', -50, -50, 2000, 100), ...rectangle('s', 'v', 0, 0, 3, 9));
    run(engine, { type: 'addExternal', sketch: 's', id: 'r', ref: { type: 'pattern', sources: ['va', 'vb', 'vc', 'vd'], transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 6 } } } } as unknown as Command);
  }

  it('the input form with the expression, the source, the copies as ranges, the step and the first copy; it goes back into updateExternal unchanged', () => {
    const engine = newEngine();
    slots(engine, 5);
    const answer = ok(engine, 'get_sketch', { sketch: 's' });
    const entry = answer.external.find((e: { id: string }) => e.id === 'r');
    expect(entry).toEqual({
      id: 'r',
      type: 'pattern',
      sources: ['va', 'vb', 'vc', 'vd'],
      transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 6 } },
      source: 'derived',
      copies: [[1, 4]],
      step: { shift: [6, 0] },
      first: { 'r/1/va': 'line', 'r/1/v1': [6, 0], 'r/1/v2': [9, 0], 'r/1/vb': 'line', 'r/1/v3': [9, 9], 'r/1/vc': 'line', 'r/1/v4': [6, 9], 'r/1/vd': 'line' },
    });
    const { id, source, copies, step, first, ...ref } = entry;
    void [source, copies, step, first];
    const before = engine.getState().document;
    run(engine, { type: 'updateExternal', sketch: 's', id, ref } as unknown as Command);
    expect(engine.getState().document.features).toEqual(before.features);
  });

  it('the equal regions of copies are one row; a copy with a hole of its own is a row of its own, and the ranges skip it', () => {
    const engine = newEngine();
    slots(engine, 5);
    run(engine, point('s', 'h0', 13.5, 4.5), { type: 'addCurve', sketch: 's', id: 'hole', curve: { type: 'circle', center: 'h0' }, radius: 1 });
    const regions = ok(engine, 'get_sketch', { sketch: 's' }).regions as { ref: { outerLoop: string[] }; area: number; holes: number; copies?: unknown }[];
    const grouped = regions.filter((row) => row.copies);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ ref: { outerLoop: ['r/1/va', 'r/1/vb', 'r/1/vc', 'r/1/vd'] }, area: 27, holes: 0, copies: { entry: 'r', numbers: [[1, 1], [3, 4]] } });
    const holed = regions.find((row) => row.ref.outerLoop.includes('r/2/va'));
    expect(holed).toMatchObject({ holes: 1 });
    expect(holed?.copies).toBeUndefined();
  });

  it('an entry that cannot make its copies lists none; the answer for a row of 200 slots stays short', () => {
    const engine = newEngine();
    slots(engine, 200);
    const answer = ok(engine, 'get_sketch', { sketch: 's' });
    const entry = answer.external.find((e: { id: string }) => e.id === 'r');
    expect(entry.copies).toEqual([[1, 199]]);
    const size = JSON.stringify(entry).length + JSON.stringify(answer.regions).length;
    expect(size).toBeLessThan(1500);
    // a grid of 15 × 15 places is more than 200: the warning brokenCopies, and no copies
    run(engine, { type: 'updateExternal', sketch: 's', id: 'r', ref: { type: 'pattern', sources: ['va', 'vb', 'vc', 'vd'], transform: { type: 'linear', direction: 'origin/x', count: 15, span: { type: 'spacing', spacing: 6 }, second: { direction: 'origin/y', count: 15, span: { type: 'spacing', spacing: 12 } } } } } as unknown as Command);
    expect(engine.getState().evaluation.features.s.warnings.map((w) => w.code)).toEqual(['brokenCopies']);
    expect(ok(engine, 'get_sketch', { sketch: 's' }).external.find((e: { id: string }) => e.id === 'r')).toMatchObject({ copies: [], first: {} });
  });

  it('a mirror: the axis as two points; an open end is advice with the end, the distance and the cure', () => {
    const engine = newEngine();
    run(engine, { type: 'addFeature', feature: emptySketch('o', 'o', XY) }, point('o', 'e1', 10, 0), point('o', 'e2', 10, 8), point('o', 'e5', 0.01, 8), line('o', 'o1', 'origin', 'e1'), line('o', 'o2', 'e1', 'e2'), line('o', 'o3', 'e2', 'e5'));
    run(engine, { type: 'addExternal', sketch: 'o', id: 'm', ref: { type: 'pattern', sources: ['o1', 'o2', 'o3'], transform: { type: 'mirror', axis: 'origin/y' } } } as unknown as Command);
    const answer = ok(engine, 'get_sketch', { sketch: 'o' });
    expect(answer.external[0]).toMatchObject({ copies: [[1, 1]], step: { axis: [[0, 0], [0, 1]] } });
    expect(answer.advice).toContain('1 end of copies of `m` is open (`openEnds` of the result): `m/1/e5` is 0.02 mm from `e5`. Copies close with what lies at their ends within 1e-6 mm: hold the source\'s end on the axis by a constraint (`pointOnCurve` with the axis).');
  });
});
