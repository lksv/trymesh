// The projection from another sketch in the app (D69): the tool From sketch (its candidates, the
// pick of a point and of a curve, the latest sketch first, the option of regions, a whole sketch
// with a role, a repair, a tilted sketch not offered), the row of the entry with its flag, and
// a sketch of projections drawn in the model view.
import { type Command, type QueryResult, type SketchFeature, type SketchProjection, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewPanel } from '../src/queries';
import { sketchSourcesView } from '../src/queries/sketch-sources';
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
    h.press('toolbar', 'Finish sketch');
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

// The review of the implementation (6b): what its probes reproduced, and the gaps of the tests.
describe('the tool From sketch: the review of the implementation (D69)', () => {
  const entryRow = (h: Harness, id: string): HTMLElement | undefined => Array.from(h.document.querySelectorAll<HTMLElement>('#panel .constraint')).find((candidate) => candidate.querySelector('small')?.textContent?.startsWith(`${id} · `));
  const lines = (h: Harness, dashed: boolean): number[][] => h.view.scene.lines.filter((set) => set.segments.length > 0 && Boolean(set.dashed) === dashed).map((set) => Array.from(set.segments));
  const reaches = (sets: number[][], x: number): boolean => sets.some((segments) => segments.some((v, i) => i % 3 === 0 && Math.abs(v - x) < 1e-6));

  // finding 1: the new ref took `regions` from the option (false by default), so a repair dropped
  // the flag of the entry it repaired
  it('a repair from the row, and one through a selected projection, keep the flag of the entry', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, ...fixed('src', 'c', 0, 40), ...fixed('src', 'd', 60, 40), { type: 'addCurve', sketch: 'src', id: 'l2', curve: { type: 'line', a: 'c', b: 'd' } });
    run(h, { type: 'addExternal', sketch: 'dst', id: 'x1', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line', regions: true } });
    doubleClick(h, 'Target');
    (entryRow(h, 'x1')?.querySelector('button[title^="Project again"]') as HTMLButtonElement).click();
    expect(check(h, 'Forms regions').checked).toBe(false);
    h.click(at(30, 40.1));
    expect(sketchOf(h, 'dst').external.x1).toEqual({ type: 'sketch', sketch: 'src', entity: 'l2', kind: 'line', regions: true });
    // the projection selected (the select tool), then From sketch: the pick replaces its source
    h.press('toolbar', 'Select');
    h.click(at(30, 40.1));
    h.press('toolbar', 'From sketch');
    h.click(at(30, 0.1));
    expect(sketchOf(h, 'dst').external.x1).toEqual({ type: 'sketch', sketch: 'src', entity: 'l', kind: 'line', regions: true });
  });

  // finding 2: *From* set in one sketch to a sketch that is no source of the next one opened made
  // the tool pick nothing while the select showed "any earlier sketch"
  it('a From option that is no parallel source of the open sketch counts as any', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, { type: 'addFeature', feature: emptySketch('dst2', 'Target2', { kind: 'base', plane: 'XY' }) });
    doubleClick(h, 'Target2');
    h.press('toolbar', 'From sketch');
    h.choose('From', 'dst');
    h.press('toolbar', 'Finish sketch');
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    expect((h.field('From') as HTMLSelectElement).value).toBe('');
    h.click(at(30, 0.1));
    expect((Object.values(sketchOf(h, 'dst').external) as SketchProjection[]).map((ref) => [ref.sketch, ref.entity])).toEqual([['src', 'l']]);
  });

  it('picks the centre of a circle and an end of a line as points; the row is titled by the kind', async () => {
    const h = (harness = await startApp());
    model(h);
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    h.click(at(80, 30.1));
    h.click(at(59.9, 0.1));
    const refs = Object.entries(sketchOf(h, 'dst').external) as [string, SketchProjection][];
    expect(refs.map(([, ref]) => [ref.entity, ref.kind])).toEqual([['kc', 'point'], ['b', 'point']]);
    h.press('toolbar', 'Select');
    h.click(at(30, 0.1));
    h.press('toolbar', 'From sketch');
    h.click(at(30, 0.1));
    const line = Object.entries(sketchOf(h, 'dst').external).find(([, ref]) => (ref as SketchProjection).entity === 'l')?.[0] as string;
    expect(entryRow(h, line)?.querySelector('.name')?.firstChild?.textContent).toBe('Line ');
    expect(entryRow(h, refs[0][0])?.querySelector('.name')?.firstChild?.textContent).toBe('Point ');
  });

  it('the whole sketch in each role: as in its source, reference only, forming regions', async () => {
    const h = (harness = await startApp());
    model(h);
    for (const [id, name] of [['tSource', 'Source role'], ['tReference', 'Reference role'], ['tRegions', 'Regions role']]) run(h, { type: 'addFeature', feature: emptySketch(id, name, { kind: 'base', plane: 'XY' }) });
    const roles: [string, string, string][] = [['tSource', 'Source role', 'source'], ['tReference', 'Reference role', 'reference'], ['tRegions', 'Regions role', 'regions']];
    for (const [id, name, as] of roles) {
      doubleClick(h, name);
      h.press('toolbar', 'From sketch');
      if (!check(h, 'Whole sketch').checked) toggle(h, 'Whole sketch');
      h.choose('As', as);
      // the sketches projected before lie on the source and are later: the latest is picked first
      h.choose('From', 'src');
      h.click(at(30, 0.1));
      const refs = Object.values(sketchOf(h, id).external).filter((ref) => ref.type === 'sketch' && ref.sketch === 'src') as SketchProjection[];
      expect(refs.map((ref) => [ref.entity, ref.kind, ref.regions]), as).toEqual([['l', 'line', as !== 'reference'], ['k', 'circle', as !== 'reference'], ['q', 'point', false]]);
      expect(Object.keys(sketchOf(h, id).curves), as).toEqual([]);
      h.press('toolbar', 'Finish sketch');
    }
  });

  it('a click on the geometry of a sketch on a tilted plane projects nothing', async () => {
    const h = (harness = await startApp());
    model(h);
    // a line of the tilted sketch along its x axis, which is the world X: drawn straight down it
    // falls on y = 0 of Target, away from the geometry of the source
    run(h, ...fixed('tilt', 'ta', 100, 0), ...fixed('tilt', 'tb', 140, 0), { type: 'addCurve', sketch: 'tilt', id: 'tl', curve: { type: 'line', a: 'ta', b: 'tb' } });
    doubleClick(h, 'Target');
    h.press('toolbar', 'From sketch');
    h.click(at(120, 0.1));
    expect(Object.keys(sketchOf(h, 'dst').external)).toEqual([]);
    h.record('a click on the tilted sketch');
    expect(h.text()).toMatch(/Click a point or a curve of an earlier sketch \(dashed\)\./);
  });

  it('in the model view a projection without the flag is drawn dashed, with the flag solid', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, { type: 'addExternal', sketch: 'dst', id: 'x1', ref: { type: 'sketch', sketch: 'src', entity: 'k', kind: 'circle' } });
    doubleClick(h, 'Target');
    h.press('toolbar', 'Finish sketch');
    // the circle of the source is solid at x = 90 already (an own curve of src): the projection
    // adds a dashed one there, and with the flag no dashed one
    expect(reaches(lines(h, true), 90)).toBe(true);
    doubleClick(h, 'Target');
    const box = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((label) => label.textContent === 'regions')?.querySelector('input') as HTMLInputElement;
    box.checked = true;
    h.type(box, '', true);
    h.press('toolbar', 'Finish sketch');
    expect(reaches(lines(h, true), 90)).toBe(false);
  });

  it('the view of the query sketchSources: its rows, the mark of a picked entity and its note', async () => {
    const h = (harness = await startApp());
    model(h);
    run(h, { type: 'addExternal', sketch: 'dst', id: 'x1', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line' } });
    const panel = (picked?: number) => ({ number: (value: number, unit: string) => `${+value.toFixed(3)} ${unit}`, picked, pick: () => undefined, state: h.engine.getState() }) as unknown as ViewPanel<'sketchSources'>;
    const all = h.engine.query('sketchSources', { sketch: 'dst' });
    if (!all.ok) throw new Error(all.error.message);
    const sources = { ...all.result, status: 'ok' } as unknown as QueryResult<'sketchSources'>;
    expect((sketchSourcesView.answer?.(sources, { sketch: 'dst' }, panel()) ?? []).map((e) => e.textContent)).toEqual(['Sourceparallel; 2 curves, 5 points', 'Tiltedtilted at 0.3 rad; 0 curves, 1 points']);
    expect(sketchSourcesView.note?.(sources, panel())).toEqual({ text: 'Earlier sketches: 2, parallel: 1.', error: false });
    const one = h.engine.query('sketchSources', { sketch: 'dst', from: 'src' });
    if (!one.ok) throw new Error(one.error.message);
    const entities = { ...one.result, status: 'ok' } as unknown as QueryResult<'sketchSources'>;
    const rows = (sketchSourcesView.answer?.(entities, { sketch: 'dst', from: 'src' }, panel()) ?? []).map((e) => e.textContent);
    expect(rows).toContain('l (line)whole, regions, projected as x1');
    expect(sketchSourcesView.note?.(entities, panel())).toEqual({ text: `${one.result.total} entities to project.`, error: false });
    const k = one.result.entities?.findIndex((entity) => entity.id === 'k') as number;
    const scene = sketchSourcesView.scene?.(entities, { sketch: 'dst', from: 'src' }, panel(k)) as { points: { positions: number[] }[] };
    expect(scene.points[0].positions.map((v) => +v.toFixed(6))).toEqual([80, 30, 0]);
  });
});
