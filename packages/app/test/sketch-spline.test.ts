// The tool Spline in the app (D70): control points by clicks, Enter and the closing click, the
// refusals that keep the places, the inferred tangent start on the extension of a line, the control
// polygon in the scene, no snap of a drawing tool to a spline (a line a little farther is still
// snapped to), the Select tool selecting it with no constraint offered and no re-pointing row.
import { CONSTRAINTS, type Command, type SketchFeature, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR } from '../src/draw';
import { SPLINE_TOOL_PROBLEMS, extensionOf } from '../src/sketch-commands';
import { sketchView } from '../src/sketch-view';
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
const splines = (h: Harness) => Object.entries(sketchOf(h).curves).filter(([, c]) => c.type === 'spline');
const position = (h: Harness, id: string): [number, number] => {
  const p = (h.engine.getState().evaluation.features.s?.sketch?.points ?? {})[id];
  return [p.x, p.y];
};

// an empty sketch on XY, open, with the line `l` from (10, 10) to (30, 10), fixed
async function open(): Promise<Harness> {
  const h = (harness = await startApp());
  run(h, { type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) }, ...fixed('q1', 10, 10), ...fixed('q2', 30, 10), { type: 'addCurve', sketch: 's', id: 'l', curve: { type: 'line', a: 'q1', b: 'q2' } });
  doubleClick(h, 'Skica 1');
  return h;
}

describe('the tool Spline (D70)', () => {
  it('clicks keep the control points, Enter draws the spline; with two places Enter says why and keeps them', async () => {
    const h = await open();
    h.press('toolbar', 'Spline');
    h.click(at(0, 40));
    h.click(at(20, 60));
    h.key('Enter');
    expect(status(h)).toBe(SPLINE_TOOL_PROBLEMS.tooFew);
    expect(splines(h)).toEqual([]);
    // the places stayed: a third click and Enter make the spline over three new points
    h.click(at(40, 40));
    h.move(at(50, 50));
    // the control polygon and the spline in progress are drawn dashed
    expect(h.view.scene.lines.some((line) => line.dashed && line.color === COLOR.rubber && line.segments.length > 0)).toBe(true);
    h.key('Enter');
    const made = splines(h);
    expect(made).toHaveLength(1);
    const points = (made[0][1] as { points: string[] }).points;
    expect(points).toHaveLength(3);
    expect(points.map((id) => position(h, id))).toEqual([
      [0, 40],
      [20, 60],
      [40, 40],
    ]);
    // the control polygon of the spline: thin and dashed in the colour of construction curves
    expect(h.view.scene.lines.some((line) => line.dashed && line.color === COLOR.construction && line.width === 1 && line.segments.length === 2 * 2 * 3)).toBe(true);
    // the places are gone after the spline: Enter does nothing more
    h.key('Enter');
    expect(splines(h)).toHaveLength(1);
  });

  it('a click on the first place with three kept closes the spline; a point picked twice is refused', async () => {
    const h = await open();
    h.press('toolbar', 'Spline');
    h.click(at(0, 40));
    h.click(at(20, 40));
    h.click(at(20, 60));
    h.click(at(0, 60));
    h.click(at(1, 41)); // within the reach of a pick of the first place
    const made = splines(h);
    expect(made).toHaveLength(1);
    const points = (made[0][1] as { points: string[] }).points;
    expect(points).toHaveLength(5);
    expect(points[4]).toBe(points[0]);
    // the existing point q1 picked twice: refused, nothing sent, the places stay
    h.click(at(10, 10));
    h.click(at(0, 80));
    h.click(at(10, 10));
    h.key('Enter');
    expect(status(h)).toBe(SPLINE_TOOL_PROBLEMS.twice(3));
    expect(splines(h)).toHaveLength(1);
    h.key('Escape');
    h.key('Enter');
    expect(splines(h)).toHaveLength(1);
  });

  it('from the end of a line the second place goes onto its extension and is held on the line', async () => {
    const h = await open();
    h.press('toolbar', 'Spline');
    h.click(at(30, 10)); // the end q2 of the line
    h.move(at(40, 13)); // beyond the end, 3 mm off the extension
    expect(h.view.scene.labels.some((label) => label.text === 'tangent')).toBe(true);
    h.click(at(40, 13));
    h.click(at(50, 30));
    h.key('Enter');
    const [[, curve]] = splines(h);
    const points = (curve as { points: string[] }).points;
    expect(points[0]).toBe('q2');
    expect(position(h, points[1])[0]).toBeCloseTo(40, 6);
    expect(position(h, points[1])[1]).toBeCloseTo(10, 6);
    expect(Object.values(sketchOf(h).constraints)).toContainEqual({ type: 'pointOnCurve', point: points[1], curve: 'l' });
    // behind the end (over the line) nothing is inferred
    h.click(at(30, 10));
    h.move(at(20, 12));
    expect(h.view.scene.labels.some((label) => label.text === 'tangent')).toBe(false);
    h.key('Escape');
    // a line joined to the first point by a coincident only: no inference (the rule reads no joins)
    run(h, ...fixed('j1', 10, 60), ...fixed('j2', 30, 60), { type: 'addPoint', sketch: 's', id: 'j3', x: 30, y: 60 }, { type: 'addCurve', sketch: 's', id: 'jl', curve: { type: 'line', a: 'j1', b: 'j2' } }, { type: 'addConstraint', sketch: 's', id: 'jc', constraint: { type: 'coincident', a: 'j2', b: 'j3' } });
    expect(extensionOf(sketchView(sketchOf(h), h.engine.getState().evaluation.features.s?.sketch as never), { at: [30, 60], snap: { kind: 'point', id: 'j3' } }, [40, 61], 7)).toBeUndefined();
    expect(extensionOf(sketchView(sketchOf(h), h.engine.getState().evaluation.features.s?.sketch as never), { at: [30, 60], snap: { kind: 'point', id: 'j2' } }, [40, 61], 7)).toEqual({ at: [40, 60], line: 'jl' });
  });

  it('a drawing tool does not snap to a spline and snaps to a line a little farther; Select selects it with no offer', async () => {
    const h = await open();
    run(h, ...fixed('s1', 0, 40), ...fixed('s2', 20, 40), ...fixed('s3', 40, 40), ...fixed('u1', 0, 45), ...fixed('u2', 40, 45));
    run(h, { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'spline', points: ['s1', 's2', 's3'] } }, { type: 'addCurve', sketch: 's', id: 'u', curve: { type: 'line', a: 'u1', b: 'u2' } });
    h.press('toolbar', 'Úsečka');
    h.click(at(30, 41.5)); // 1.5 from the spline, 3.5 from the line `u`
    h.click(at(30, 80));
    const held = Object.values(sketchOf(h).constraints).filter((c) => c.type === 'pointOnCurve');
    expect(held).toEqual([{ type: 'pointOnCurve', point: expect.any(String), curve: 'u' }]);
    // nothing else in reach: the bare place
    h.key('Escape');
    h.press('toolbar', 'Bod');
    h.click(at(30, 37)); // 3 from the spline, 8 from `u` and from the end of the new line
    expect(Object.values(sketchOf(h).constraints).filter((c) => c.type === 'pointOnCurve')).toHaveLength(1);
    // the Select tool selects the spline; with the point q1 no constraint is offered, and no re-pointing
    h.press('toolbar', 'Výběr');
    h.click(at(10, 40));
    h.click(at(10, 10), { shiftKey: true });
    h.click(at(20, 45), { shiftKey: true }); // and the line `u`: a point, a line and a spline
    for (const type of ['pointOnCurve', 'horizontal', 'coincident'] as const) expect(h.button('panel', CONSTRAINTS[type].title).disabled, type).toBe(true);
    expect(h.document.querySelector('#panel .repoint')).toBeNull();
    // Delete removes the spline
    h.click(at(10, 40));
    h.key('Delete');
    expect(sketchOf(h).curves.k).toBeUndefined();
  });
});
