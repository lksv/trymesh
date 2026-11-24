// Trim, extend and split in the app (D65): what the snapshot of app.test.ts (`trim.txt`) does not
// show: the repair chosen in one sketch and not in the next, an extend clicked on a line under a
// span line, Up to and the nearest crossing in the panels, and the view of the query of the contacts.
import { type Command, type QueryResult, type SketchFeature, emptySketch } from '@trymesh/engine';
import type { ViewPanel } from '../src/queries';
import { sketchContactsView } from '../src/queries/sketch-contacts';
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

  it('an extend clicked on a line under a span line extends the line, not the span line the picker takes', async () => {
    const h = (harness = await startApp());
    // a span line `S` over the old ends (0, 0) and (40, 0) of a line `L` that runs to (50, 0) now;
    // `S` is added first, so the picker, which takes the first of equally near curves, takes it, and
    // only `curveUnder` gives the line. A line across at x = 60 to extend `L` to.
    run(
      h,
      { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) },
      ...fixed('s', 'la', 0, 0),
      ...fixed('s', 'lb', 50, 0),
      { type: 'addPoint', sketch: 's', id: 'old', x: 40, y: 0 },
      { type: 'addCurve', sketch: 's', id: 'S', curve: { type: 'line', a: 'la', b: 'old', construction: true } },
      { type: 'addConstraint', sketch: 's', id: 'Sl', constraint: { type: 'distance', a: 'la', b: 'old', value: 40, driving: true } },
      { type: 'addCurve', sketch: 's', id: 'L', curve: { type: 'line', a: 'la', b: 'lb' } },
      { type: 'addConstraint', sketch: 's', id: 'on', constraint: { type: 'pointOnCurve', point: 'old', curve: 'L' } },
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

  // a line X across two fixed lines at x = 10 and x = 30, and a construction line at x = 30
  function crossed(h: Harness): void {
    run(
      h,
      { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) },
      ...fixed('s', 'xa', -10, 20),
      ...fixed('s', 'xb', 70, 20),
      { type: 'addCurve', sketch: 's', id: 'X', curve: { type: 'line', a: 'xa', b: 'xb' } },
      ...fixed('s', 'va', 10, 0),
      ...fixed('s', 'vb', 10, 40),
      { type: 'addCurve', sketch: 's', id: 'V', curve: { type: 'line', a: 'va', b: 'vb' } },
      ...fixed('s', 'wa', 30, 0),
      ...fixed('s', 'wb', 30, 40),
      { type: 'addCurve', sketch: 's', id: 'W', curve: { type: 'line', a: 'wa', b: 'wb' } },
    );
    doubleClick(h, 'Skica 1');
  }
  const upTo = (h: Harness): string => Array.from(h.document.querySelectorAll('#panel p.hint')).find((p) => p.textContent?.startsWith('Up to:'))?.textContent ?? '';
  const startOf = (h: Harness, line: string): number => {
    const curve = sketchOf(h, 's').curves[line] as { a: string };
    return h.engine.getState().evaluation.features['s'].sketch?.points[curve.a].x ?? NaN;
  };

  it('Up to: the curve selected bounds the trim; it does not carry over to another sketch; Clear drops it', async () => {
    const h = (harness = await startApp());
    crossed(h);
    h.press('toolbar', 'Výběr');
    h.move(at(30, 11));
    h.click(at(30, 11));
    h.press('toolbar', 'Trim');
    expect(upTo(h)).toBe('Up to: the nearest curves');
    h.press('panel', 'Use the selected curve');
    expect(upTo(h)).toBe('Up to: W');
    // bounded by W, the piece at x = 5 runs from the start of X to W, past V
    h.click(at(5, 20));
    expect(startOf(h, 'X')).toBeCloseTo(30, 6);
    h.press('toolbar', 'Dokončit skicu');
    run(h, { type: 'addFeature', feature: emptySketch('s2', 'Skica 2', { kind: 'base', plane: 'XY' }) });
    doubleClick(h, 'Skica 2');
    h.press('toolbar', 'Trim');
    expect(upTo(h)).toBe('Up to: the nearest curves');
    expect(h.button('panel', 'Clear').disabled).toBe(true);
    h.press('toolbar', 'Dokončit skicu');
    doubleClick(h, 'Skica 1');
    h.press('toolbar', 'Trim');
    expect(upTo(h)).toBe('Up to: W');
    h.press('panel', 'Clear');
    expect(upTo(h)).toBe('Up to: the nearest curves');
  });

  it('Split with "Only at the crossing nearest to the click" cuts at that crossing alone', async () => {
    const h = (harness = await startApp());
    crossed(h);
    h.press('toolbar', 'Split');
    const nearest = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((label) => label.textContent === 'Only at the crossing nearest to the click')?.querySelector('input') as HTMLInputElement;
    nearest.checked = true;
    h.type(nearest, '', true);
    h.click(at(25, 20));
    // X and W cut at x = 30 (a new piece each), V not cut
    expect(Object.keys(sketchOf(h, 's').curves)).toHaveLength(5);
    expect(sketchOf(h, 's').curves['V']).toEqual({ type: 'line', a: 'va', b: 'vb' });
    const keeper = sketchOf(h, 's').curves['X'] as { b: string };
    expect(h.engine.getState().evaluation.features['s'].sketch?.points[keeper.b].x).toBeCloseTo(30, 6);
  });

  it('the view of the query of the contacts: its rows, its marks and its note', async () => {
    const h = (harness = await startApp());
    run(h, { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) }, ...fixed('s', 'aa', 0, 0), ...fixed('s', 'ab', 20, 0), { type: 'addCurve', sketch: 's', id: 'A', curve: { type: 'line', a: 'aa', b: 'ab' } });
    run(h, ...fixed('s', 'ba', 10, -5), ...fixed('s', 'bb', 10, 5), { type: 'addCurve', sketch: 's', id: 'B', curve: { type: 'line', a: 'ba', b: 'bb' } });
    const outcome = h.engine.query('sketchContacts', { sketch: 's' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.result.contacts).toEqual([{ at: [expect.closeTo(10, 9), expect.closeTo(0, 9)], kind: 'crossing', curves: ['A', 'B'], fix: 'cut' }]);
    const panel = (picked?: number) => ({ number: (value: number, unit: string) => `${+value.toFixed(3)} ${unit}`, picked, pick: () => undefined, state: h.engine.getState() }) as unknown as ViewPanel<'sketchContacts'>;
    const result = { ...outcome.result, status: 'ok' } as unknown as QueryResult<'sketchContacts'>;
    expect((sketchContactsView.answer?.(result, { sketch: 's' }, panel()) ?? []).map((e) => e.textContent)).toEqual(['The profile is invalid; 1 contact(s).', 'crossing: A × B[10 mm, 0 mm], split cuts it']);
    const scene = sketchContactsView.scene?.(result, { sketch: 's' }, panel(0)) as { points: { positions: number[]; color: unknown }[] };
    expect(scene.points).toHaveLength(2);
    expect(scene.points[0].positions.map((v) => +v.toFixed(6))).toEqual([10, 0, 0]);
    expect(sketchContactsView.note?.(result, panel())).toEqual({ text: 'Contacts: 1.', error: false });
  });
});
