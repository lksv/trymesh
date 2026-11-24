// The check of a run-out's cap (D67): what is left of the cap of a tool past its end is renamed into
// the blend, so every vertex of it has to lie on the blend's surface. It is a backstop behind the
// void check, which refuses first whatever it sees (the review of the implementation, M1), so here
// the void check is switched off: its bound is infinite and nothing is uncertain. In a file of its
// own, since the mock holds for the whole file.
import { type Command, type Id, emptySketch } from '@trymesh/engine';
import { expect, it, vi } from 'vitest';
import { XY, cap, circle, newEngine, onFace, run, side } from './kit';
import { chamfer, edge } from './blend-kit';

vi.mock('../../engine/src/recompute/tool-edge', async (importOriginal) => ({ ...(await importOriginal<object>()), BLEND_RUN_OUT_VOID: Infinity, runOutUncertain: () => false }));

const sketch = (id: Id, plane = XY): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const square = (s: Id, prefix: string, [x0, y0, x1, y1]: [number, number, number, number]): Command => {
  const points: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return {
    type: 'batch',
    commands: [
      ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch: s, id: `${prefix}p${i}`, x, y })),
      ...points.map((_, i): Command => ({ type: 'addCurve', sketch: s, id: `${prefix}l${i}`, curve: { type: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % 4}` } })),
    ],
  };
};
const extrude = (id: Id, s: Id, outer: Id[], distance: number, operation: 'new' | 'add' | 'cut' = 'new'): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: [{ outerLoop: [...outer].sort() }] }, extent: { type: 'distance', start: 0, distance }, operation, ...(operation === 'new' ? {} : { targets: ['E'] }) },
});
const loop = (prefix: string): Id[] => [0, 1, 2, 3].map((i) => `${prefix}l${i}`);

it('a post outside a shaft R 40 where the cap of a chamfer\'s run-out lies: with the void check off, refused by the check of the cap', () => {
  // a slot y 34 to 37 across the top of the shaft, 3 deep; the top edge of its wall y = 37 runs
  // out through the shaft's side at x = ±15.2 (at 0.01); the post 0.3 × 0.3 at x 15, y 37.5, 0.4
  // outside the shaft, lies where the tool's cap ends
  const engine = newEngine();
  const loaded = engine.load(JSON.stringify({ ...engine.getState().document, settings: { ...engine.getState().document.settings, chordTolerance: 0.01 } }));
  if (!loaded.ok) throw new Error(loaded.error.message);
  const R = 40;
  run(engine, sketch('s'), circle('s', 'c', 0, 0, R), extrude('E', 's', ['c'], 20), sketch('t', onFace('E', cap('E'))), square('t', 't', [-R - 5, R - 6, R + 5, R - 3]), extrude('S', 't', loop('t'), -3, 'cut'));
  run(engine, sketch('q'), square('q', 'q', [15, R - 2.5, 15.3, R - 2.2]), extrude('Q', 'q', loop('q'), 20, 'add'));
  const result = engine.preview(chamfer('k', 'E', [edge(cap('E'), side('S', 'tl2'))], 2));
  if (!result.ok) throw new Error(result.error.message);
  const outcome = result.state.evaluation.features.k;
  expect(outcome.error?.code, outcome.error?.message).toBe('blendDoesNotFit');
  expect(outcome.error?.message).toMatch(/a vertex of the end of the chamfer's run-out lies .* mm off its surface/);
  expect(outcome.error?.refs).toContainEqual(side('E', 'c'));
});
