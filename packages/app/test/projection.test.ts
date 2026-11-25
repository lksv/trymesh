// The projection from another sketch in the app (D69): the tool From sketch (its candidates, the
// pick of a point and of a curve, the latest sketch first, the option of regions, a whole sketch
// with a role, a repair, a tilted sketch not offered), the row of the entry with its flag, and
// a sketch of projections drawn in the model view.
import { type Command, type SketchFeature, type SketchProjection, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { candidateAt } from '../src/sketch-tools/project-sketch';
import { type Harness, client, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});
const at = (x: number, y: number): { x: number; y: number } => client([x, y, 0]);
const run = (h: Harness, ...commands: Command[]): void => {
  const result = h.engine.execute({ type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
};
const sketchOf = (h: Harness, id: string): SketchFeature => h.engine.getState().document.features.find((f) => f.id === id) as SketchFeature;
const doubleClick = (h: Harness, name: string): void => void h.row(name).dispatchEvent(new (h.document.defaultView as unknown as typeof globalThis).MouseEvent('dblclick'));
const fixed = (sketch: string, id: string, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch, id, x, y },
  { type: 'addConstraint', sketch, id: `${id}f`, constraint: { type: 'fixed', point: id, x, y } as never },
];
const check = (h: Harness, label: string): HTMLInputElement => {
  const found = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((candidate) => candidate.textContent === label)?.querySelector('input');
  if (!found) throw new Error(`there is no checkbox "${label}"`);
  return found;
};
const toggle = (h: Harness, label: string): void => {
  const box = check(h, label);
  box.checked = !box.checked;
  h.type(box, '', true);
};

// `src` on XY: a line `l` from (0, 0) to (60, 0), a point `q` at (10, 30), a circle `k` at (80, 30)
// of radius 10, all fixed; `dst` after it on XY, empty; `tilt` on a plane tilted by 0.3 rad.
function model(h: Harness): void {
  run(
    h,
    { type: 'addFeature', feature: emptySketch('src', 'Source', { kind: 'base', plane: 'XY' }) },
    ...fixed('src', 'a', 0, 0),
    ...fixed('src', 'b', 60, 0),
    ...fixed('src', 'q', 10, 30),
    ...fixed('src', 'kc', 80, 30),
    { type: 'addCurve', sketch: 'src', id: 'l', curve: { type: 'line', a: 'a', b: 'b' } },
    { type: 'addCurve', sketch: 'src', id: 'k', curve: { type: 'circle', center: 'kc' }, radius: 10 },
    { type: 'addConstraint', sketch: 'src', id: 'kr', constraint: { type: 'radius', curve: 'k', value: 10, driving: true } },
    { type: 'addFeature', feature: { id: 'tiltPl', name: 'tiltPl', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 20, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 0.3 } } } as Command,
    { type: 'addFeature', feature: emptySketch('tilt', 'Tilted', { kind: 'plane', feature: 'tiltPl' }) },
    { type: 'addFeature', feature: emptySketch('dst', 'Target', { kind: 'base', plane: 'XY' }) },
  );
}

describe('the tool From sketch (D69)', () => {
  it('picks a curve and a point of an earlier sketch, with the flag of the options; a tilted sketch is listed and not offered', async () => {
    const h = (harness = await startApp());
    model(h);
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    // the From list: Source parallel, Tilted at its angle and disabled
    const from = h.field('From') as HTMLSelectElement;
    expect(Array.from(from.options).map((option) => [option.textContent, option.disabled])).toEqual([['any earlier sketch', false], ['Source', false], ['Tilted (at 17.2°)', true]]);
    h.click(at(30, 0.1));
    h.click(at(10, 30.1));
    toggle(h, 'Forms regions');
    h.click(at(90, 30.1));
    const refs = Object.values(sketchOf(h, 'dst').external) as SketchProjection[];
    expect(refs.map((ref) => [ref.entity, ref.kind, ref.regions])).toEqual([['l', 'line', false], ['q', 'point', false], ['k', 'circle', true]]);
  });

  it('the latest sketch first where several lie on each other; From one sketch takes it', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, { type: 'addFeature', feature: emptySketch('mid', 'Middle', { kind: 'base', plane: 'XY' }), index: 1 }, { type: 'addExternal', sketch: 'mid', id: 'ml', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line' } });
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    h.click(at(30, 0.1));
    h.choose('From', 'src');
    h.click(at(30, 0.1));
    expect((Object.values(sketchOf(h, 'dst').external) as SketchProjection[]).map((ref) => [ref.sketch, ref.entity])).toEqual([['mid', 'ml'], ['src', 'l']]);
  });

  it('a whole sketch as own curves, and a repair from the row keeping the ID', async () => {
    const h = (harness = await startApp());
    model(h);
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    toggle(h, 'Whole sketch');
    h.choose('As', 'own');
    h.click(at(30, 0.1));
    const dst = sketchOf(h, 'dst');
    expect(Object.keys(dst.external)).toHaveLength(3);
    expect(Object.keys(dst.curves)).toHaveLength(2);
    // the row of the projection of `l`, its repair to the circle of the source refused (another kind) and to `l` again taken
    const entry = Object.entries(dst.external).find(([, ref]) => (ref as SketchProjection).entity === 'l')?.[0] as string;
    const row = Array.from(h.document.querySelectorAll<HTMLElement>('#panel .constraint')).find((candidate) => candidate.querySelector('small')?.textContent?.startsWith(`${entry} · `));
    expect(row?.querySelector('small')?.textContent).toContain(`${entry} · Source: l`);
    toggle(h, 'Whole sketch');
    (row?.querySelector('button[title^="Project again"]') as HTMLButtonElement).click();
    // to the point of the source, which the whole sketch projected as a lone point: refused with
    // the engine's text
    h.click(at(10, 30.1));
    h.record('refused');
    expect(h.text()).toMatch(/status: updateExternal.ref: q of src is projected already as x\d+ {2}\[error\]/);
    // to the line of a sketch in between: taken, the ID kept
    run(h, { type: 'addFeature', feature: emptySketch('mid', 'Middle', { kind: 'base', plane: 'XY' }), index: 1 }, { type: 'addExternal', sketch: 'mid', id: 'ml', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line' } });
    h.click(at(30, 0.1));
    expect(sketchOf(h, 'dst').external[entry]).toEqual({ type: 'sketch', sketch: 'mid', entity: 'ml', kind: 'line', regions: false });
  });

  it('the checkbox of the flag in the row sends updateExternal; the sketch of projections is drawn in the model', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, { type: 'addExternal', sketch: 'dst', id: 'x1', ref: { type: 'sketch', sketch: 'src', entity: 'k', kind: 'circle' } }, { type: 'addExternal', sketch: 'dst', id: 'x2', ref: { type: 'sketch', sketch: 'src', entity: 'q', kind: 'point' } });
    doubleClick(h, 'Target');
    const boxes = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).filter((label) => label.textContent === 'regions');
    // a point has no checkbox
    expect(boxes).toHaveLength(1);
    const box = boxes[0].querySelector('input') as HTMLInputElement;
    box.checked = true;
    h.type(box, '', true);
    expect((sketchOf(h, 'dst').external.x1 as SketchProjection).regions).toBe(true);
    h.press('toolbar', 'Dokončit skicu');
    h.record('the model');
    // outside the sketch mode the circle of the projection is drawn with the sketch (solid: it forms regions)
    const scene = h.view.scene.lines.filter((set) => set.segments.length > 0 && !set.dashed);
    expect(scene.some((set) => Array.from(set.segments).some((v, i) => i % 3 === 0 && Math.abs(v - 90) < 1e-6))).toBe(true);
  });

  it('the candidate under the pointer: points before curves, the first listed of equally near', () => {
    const candidates = [
      { sketch: 'b', id: 'bl', kind: 'line' as const, shape: { type: 'line' as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number] } },
      { sketch: 'a', id: 'al', kind: 'line' as const, shape: { type: 'line' as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number] } },
      { sketch: 'a', id: 'p', kind: 'point' as const, at: [5, 0.5] as [number, number] },
    ];
    expect(candidateAt(candidates, [5, 0.2], 1)?.candidate.id).toBe('p');
    expect(candidateAt(candidates, [8, 0.2], 1)?.candidate.id).toBe('bl');
    expect(candidateAt(candidates, [8, 0.2], 1, 'a')?.candidate.id).toBe('al');
    expect(candidateAt(candidates, [8, 5], 1)).toBeUndefined();
  });
});
