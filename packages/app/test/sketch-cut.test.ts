// Trim, extend and split in the app (D65): what the snapshot of app.test.ts (`trim.txt`) does not
// show: the repair chosen in one sketch and not in the next, an extend clicked on a piece under a
// span line, and the view of the query of the contacts.
import { type Command, type SketchFeature, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { type Harness, client, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});
const at = (x: number, y: number): { x: number; y: number } => client([x, y, 0]);
const REPAIR = 'Cut the other crossings of the outline first';
const repairBox = (h: Harness): HTMLInputElement => {
  const label = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((candidate) => candidate.textContent === REPAIR);
  const box = label?.querySelector('input');
  if (!box) throw new Error(`there is no checkbox "${REPAIR}"`);
  return box;
};
const doubleClick = (h: Harness, name: string): void => void h.row(name).dispatchEvent(new (h.document.defaultView as unknown as typeof globalThis).MouseEvent('dblclick'));
const run = (h: Harness, ...commands: Command[]): void => {
  const result = h.engine.execute({ type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
};
const sketchOf = (h: Harness, id: string): SketchFeature => h.engine.getState().document.features.find((f) => f.id === id) as SketchFeature;
const fixed = (sketch: string, id: string, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch, id, x, y },
  { type: 'addConstraint', sketch, id: `${id}f`, constraint: { type: 'fixed', point: id, x, y } as never },
];

describe('the tools Trim, Extend and Split in the app (D65)', () => {
  it('the repair chosen in one sketch is not applied in the next, whose checkbox shows its default; the first keeps its choice', async () => {
    const h = (harness = await startApp());
    run(h, { type: 'addFeature', feature: emptySketch('s1', 'Skica 1', { kind: 'base', plane: 'XY' }) }, { type: 'addFeature', feature: emptySketch('s2', 'Skica 2', { kind: 'base', plane: 'XY' }) });
    doubleClick(h, 'Skica 1');
    h.press('toolbar', 'Trim');
    // no feature reads the sketch: the repair is off by default
    expect(repairBox(h).checked).toBe(false);
    repairBox(h).checked = true;
    h.type(repairBox(h), '', true);
    expect(repairBox(h).checked).toBe(true);
    h.press('toolbar', 'Dokončit skicu');
    doubleClick(h, 'Skica 2');
    h.press('toolbar', 'Trim');
    expect(repairBox(h).checked).toBe(false);
    h.press('toolbar', 'Dokončit skicu');
    doubleClick(h, 'Skica 1');
    h.press('toolbar', 'Trim');
    expect(repairBox(h).checked).toBe(true);
  });

  it('an extend clicked on a line under a span line extends the line, not the span line', async () => {
    const h = (harness = await startApp());
    // a line from (0, 0) to (50, 0) after an extend that gave it a span line over its old ends
    // (0, 0) and (40, 0); a line across at x = 60 to extend it to
    run(
      h,
      { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) },
      ...fixed('s', 'la', 0, 0),
      ...fixed('s', 'lb', 50, 0),
      { type: 'addCurve', sketch: 's', id: 'L', curve: { type: 'line', a: 'la', b: 'lb' } },
      { type: 'addPoint', sketch: 's', id: 'old', x: 40, y: 0 },
      { type: 'addConstraint', sketch: 's', id: 'on', constraint: { type: 'pointOnCurve', point: 'old', curve: 'L' } },
      { type: 'addCurve', sketch: 's', id: 'S', curve: { type: 'line', a: 'la', b: 'old', construction: true } },
      { type: 'addConstraint', sketch: 's', id: 'Sl', constraint: { type: 'distance', a: 'la', b: 'old', value: 40, driving: true } },
      ...fixed('s', 'ta', 60, -10),
      ...fixed('s', 'tb', 60, 10),
      { type: 'addCurve', sketch: 's', id: 'T', curve: { type: 'line', a: 'ta', b: 'tb' } },
    );
    doubleClick(h, 'Skica 1');
    h.press('toolbar', 'Extend');
    h.click(at(38, 0));
    const extended = sketchOf(h, 's');
    const end = (extended.curves['L'] as { b: string }).b;
    expect(end).not.toBe('lb');
    expect(h.engine.getState().evaluation.features['s'].sketch?.points[end].x).toBeCloseTo(60, 6);
    expect(extended.curves['S']).toEqual({ type: 'line', a: 'la', b: 'old', construction: true });
  });

  it('the query of the contacts in the panel of queries: a row per contact, the marks in the view', async () => {
    const h = (harness = await startApp());
    run(h, { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) }, ...fixed('s', 'aa', 0, 0), ...fixed('s', 'ab', 20, 0), { type: 'addCurve', sketch: 's', id: 'A', curve: { type: 'line', a: 'aa', b: 'ab' } });
    run(h, ...fixed('s', 'ba', 10, -5), ...fixed('s', 'bb', 10, 5), { type: 'addCurve', sketch: 's', id: 'B', curve: { type: 'line', a: 'ba', b: 'bb' } });
    const outcome = h.engine.query('sketchContacts', { sketch: 's' });
    expect(outcome.ok && outcome.result.contacts).toEqual([{ at: [expect.closeTo(10, 9), expect.closeTo(0, 9)], kind: 'crossing', curves: ['A', 'B'], fix: 'cut' }]);
    const { QUERY_VIEWS } = await import('../src/queries/index');
    expect(Object.keys(QUERY_VIEWS)).toContain('sketchContacts');
  });
});
