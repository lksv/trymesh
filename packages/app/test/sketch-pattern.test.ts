// Mirror and pattern in the app (D68): the three tools of the sketch bar by clicks (without and
// with a selection, an axis of the origin picked), the row of an entry and its form (the kind, a
// count as an expression, the second direction, Use selection, the axis picked again), the copies
// drawn as derived geometry and not snapped to, the constraint offers off for a copy.
import { type Command, type SketchFeature, type SketchPattern, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR } from '../src/draw';
import { type Harness, client, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});
const at = (x: number, y: number): { x: number; y: number } => client([x, y, 0]);
const doubleClick = (h: Harness, name: string): void => void h.row(name).dispatchEvent(new (h.document.defaultView as unknown as typeof globalThis).MouseEvent('dblclick'));
const run = (h: Harness, ...commands: Command[]): void => {
  const result = h.engine.execute({ type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
};
const sketchOf = (h: Harness): SketchFeature => h.engine.getState().document.features.find((f) => f.id === 's') as SketchFeature;
const status = (h: Harness): string => h.document.getElementById('status')?.textContent ?? '';
const fixed = (id: string, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch: 's', id, x, y },
  { type: 'addConstraint', sketch: 's', id: `${id}f`, constraint: { type: 'fixed', point: id, x, y } as never },
];
// a square 40 × 40 from (5, 5), fixed, its lines `qa` (bottom), `qb`, `qc`, `qd`
async function square(): Promise<Harness> {
  const h = (harness = await startApp());
  run(
    h,
    { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) },
    ...fixed('q1', 5, 5),
    ...fixed('q2', 45, 5),
    ...fixed('q3', 45, 45),
    ...fixed('q4', 5, 45),
    { type: 'addCurve', sketch: 's', id: 'qa', curve: { type: 'line', a: 'q1', b: 'q2' } },
    { type: 'addCurve', sketch: 's', id: 'qb', curve: { type: 'line', a: 'q2', b: 'q3' } },
    { type: 'addCurve', sketch: 's', id: 'qc', curve: { type: 'line', a: 'q3', b: 'q4' } },
    { type: 'addCurve', sketch: 's', id: 'qd', curve: { type: 'line', a: 'q4', b: 'q1' } },
  );
  doubleClick(h, 'Skica 1');
  return h;
}
const selectSquare = (h: Harness): void => {
  h.press('toolbar', 'Výběr');
  h.click(at(25, 5));
  h.click(at(45, 25), { shiftKey: true });
  h.click(at(25, 45), { shiftKey: true });
  h.click(at(5, 25), { shiftKey: true });
};

describe('mirror and pattern in the app (D68)', () => {
  it('Mirror: without a selection it says what to do; with one, a click on the Y axis adds the entry and opens its form', async () => {
    const h = await square();
    h.press('toolbar', 'Mirror');
    h.click(at(0, 60));
    expect(status(h)).toMatch(/^Select the curves and points to copy first, then pick the axis/);
    expect(sketchOf(h).external).toEqual({});
    selectSquare(h);
    h.press('toolbar', 'Mirror');
    h.click(at(0, 60));
    const entries = sketchOf(h).external;
    expect(Object.values(entries)).toEqual([{ type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd'], transform: { type: 'mirror', axis: 'origin/y' } }]);
    const id = Object.keys(entries)[0];
    // the copies: drawn dashed in the colour of projections
    const result = h.engine.getState().evaluation.features.s.sketch;
    expect(result?.curves[`${id}/1/qa`]?.source).toBe('derived');
    const derived = h.view.scene?.lines.find((set) => set.dashed && set.color === COLOR.external);
    expect(derived?.segments.length).toBe(4 * 6);
    // the form: the kind, the axis; the kind changed to a linear pattern, its count an expression
    expect((h.field('Axis') as HTMLSelectElement).value).toBe('origin/y');
    h.choose('Kind', 'linear');
    expect((sketchOf(h).external[id] as SketchPattern).transform).toEqual({ type: 'linear', direction: 'origin/y', count: 3, span: { type: 'spacing', spacing: 10 } });
    run(h, { type: 'setParameter', name: 'n', expr: '4' });
    h.type(h.field('Count'), 'n', true);
    expect(sketchOf(h).expressions?.[`external/${id}/transform/count`]).toBe('n');
    expect((h.field('Count') as HTMLInputElement).value).toBe('n');
    // the second direction: a grid
    const second = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((label) => label.textContent === 'Second direction')?.querySelector('input') as HTMLInputElement;
    second.checked = true;
    h.type(second, '', true);
    expect((sketchOf(h).external[id] as SketchPattern).transform).toMatchObject({ type: 'linear', second: { direction: 'origin/x', count: 2, span: { type: 'spacing', spacing: 10 } } });
  });

  it('Linear and Circular pattern take the count and the spacing or the angle of their panels; the axis is picked again through the row', async () => {
    const h = await square();
    selectSquare(h);
    h.press('toolbar', 'Linear pattern');
    h.type(h.field('Count'), '5', true);
    h.type(h.field('Spacing'), '60', true);
    h.click(at(60, 0)); // the X axis
    const row = Object.entries(sketchOf(h).external).find(([, ref]) => ref.type === 'pattern' && ref.transform.type === 'linear');
    expect(row?.[1]).toEqual({ type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd'], transform: { type: 'linear', direction: 'origin/x', count: 5, span: { type: 'spacing', spacing: 60 } } });
    selectSquare(h);
    h.press('toolbar', 'Circular pattern');
    h.type(h.field('Count'), '4', true);
    h.click(at(0.2, 0.1)); // the origin
    const circle = Object.values(sketchOf(h).external).find((ref) => ref.type === 'pattern' && ref.transform.type === 'circular');
    expect(circle).toEqual({ type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd'], transform: { type: 'circular', center: 'origin', count: 4, span: { type: 'full' } } });
    // the direction of the row picked again: the button of its row, then a click on the Y axis
    const id = row?.[0] as string;
    const button = Array.from(h.document.querySelectorAll<HTMLButtonElement>('#panel button')).find((b) => b.title === 'Pick the direction again in the view');
    button?.click();
    h.click(at(0, -60));
    expect((sketchOf(h).external[id] as SketchPattern).transform).toMatchObject({ type: 'linear', direction: 'origin/y', count: 5 });
  });

  it('a copy is not snapped to while drawing; a selected copy gets no constraint offer; Use selection replaces the sources', async () => {
    const h = await square();
    run(h, { type: 'addExternal', sketch: 's', id: 'm', ref: { type: 'pattern', sources: ['qa'], transform: { type: 'mirror', axis: 'origin/y' } } });
    // a point at the copied corner (−5, 5): a new point, tied to nothing
    h.press('toolbar', 'Bod');
    h.click(at(-5, 5));
    const added = Object.keys(sketchOf(h).points).filter((id) => !id.startsWith('q'));
    expect(added).toHaveLength(1);
    expect(Object.values(sketchOf(h).constraints).filter((c) => JSON.stringify(c).includes('m/1/'))).toEqual([]);
    // the select tool selects the copy; no constraint is offered
    h.press('toolbar', 'Výběr');
    h.click(at(-25, 5));
    expect(h.button('panel', 'Vodorovně').disabled).toBe(true);
    // Use selection in the form of `m`: the right side `qb` alone
    h.click(at(45, 25));
    Array.from(h.document.querySelectorAll<HTMLElement>('#panel .constraint .name')).find((name) => name.textContent?.startsWith('Mirror'))?.click();
    h.press('panel', 'Use selection');
    expect((sketchOf(h).external.m as SketchPattern).sources).toEqual(['qb']);
  });
});
