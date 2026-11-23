// The table of the tools of the sketch bar (D64, part 4): what the mode reads of an entry, and the
// places the mode picks for a tool that picks in the sketch or on curves only.
import { type Command, type Id, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { rectangleCommands } from '../src/sketch-commands';
import { type SketchHost, placeAt, sketchContextOf } from '../src/sketch-mode';
import { SKETCH_TOOL_UI, type SketchPlaceTool } from '../src/sketch-tools';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

describe('the tools of the sketch bar', () => {
  it('are the tools of the bar in its order, each with a label and a hint; only Project picks edges', () => {
    expect(Object.keys(SKETCH_TOOL_UI)).toEqual(['select', 'point', 'line', 'rect', 'polygon', 'circle', 'arc', 'fillet', 'trim', 'extend', 'split', 'project']);
    for (const tool of Object.values(SKETCH_TOOL_UI)) expect(tool.label.length * tool.hint.length).toBeGreaterThan(0);
    expect(Object.entries(SKETCH_TOOL_UI).filter(([, tool]) => tool.picks === 'edge').map(([name]) => name)).toEqual(['project']);
    // the shapes of several places say how many; the one-click tools take the place under the click
    expect(Object.fromEntries(Object.entries(SKETCH_TOOL_UI).map(([name, tool]) => [name, tool.picks === 'edge' ? 'edge' : (tool.clicks ?? 'every')]))).toEqual({ select: 'every', point: 'every', line: 2, rect: 2, polygon: 2, circle: 2, arc: 3, fillet: 'every', trim: 'every', extend: 'every', split: 'every', project: 'edge' });
    // D65: the three cuts pick curves, so a click near a crossing gives the curve and not the point there
    expect(['trim', 'extend', 'split'].map((name) => (SKETCH_TOOL_UI[name as 'trim'] as { picks?: unknown }).picks)).toEqual(['curve', 'curve', 'curve']);
  });

  // A rectangle from the origin to (30, 20); one pixel is one millimetre and the pointer is on the plane.
  const engine = createEngine(deps);
  const execute = (command: Command) => expect(engine.execute(command).ok).toBe(true);
  execute({ type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) });
  let counter = 0;
  const context = () => sketchContextOf(engine.getState(), 's')!;
  execute({ type: 'batch', commands: rectangleCommands('s', context().tool, { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, { at: [30, 20] }, (prefix) => `${prefix}${++counter}`)! });
  const host = { planePoint: (event: { clientX: number; clientY: number }) => ({ at: [event.clientX, event.clientY], depth: 0 }), pixelSize: () => 1 } as unknown as SketchHost;
  const lineAt = (test: (a: number[], b: number[]) => boolean): Id => {
    const { feature, view } = context();
    const id = Object.keys(feature.curves).find((curve) => {
      const shape = view.curves.get(curve)?.shape;
      return shape?.type === 'line' && test(shape.a, shape.b);
    });
    if (!id) throw new Error('no such line');
    return id;
  };
  const bottom = lineAt((a, b) => a[1] === 0 && b[1] === 0);
  const left = lineAt((a, b) => a[0] === 0 && b[0] === 0);
  const pointer = (x: number, y: number) => ({ clientX: x, clientY: y });
  const tool = (picks: SketchPlaceTool<undefined>['picks'], eligible?: (curve: Id) => boolean): SketchPlaceTool<undefined> => ({ label: 'Test', hint: 'Test', picks, eligible, click: () => undefined });

  it('`sketch` snaps to a point before a curve, as the drawing tools do', () => {
    expect(placeAt(host, tool('sketch'), pointer(0.5, 0.3), context())).toEqual({ at: [0, 0], snap: { kind: 'point', id: 'origin' } });
    expect(placeAt(host, tool(undefined), pointer(15, 1), context())).toEqual({ at: [15, 0], snap: { kind: 'curve', id: bottom } });
    expect(placeAt(host, tool(undefined), pointer(15, 10), context())).toEqual({ at: [15, 10] });
  });

  it('`curve` gives the nearest curve the tool takes even at a point, and the bare pointer away from them', () => {
    expect(placeAt(host, tool('curve'), pointer(0.5, 0.3), context())).toEqual({ at: [0.5, 0], snap: { kind: 'curve', id: bottom } });
    expect(placeAt(host, tool('curve', (curve) => curve !== bottom), pointer(0.5, 0.3), context())).toEqual({ at: [expect.closeTo(0, 9), expect.closeTo(0.3, 9)], snap: { kind: 'curve', id: left } });
    expect(placeAt(host, tool('curve', () => false), pointer(0.5, 0.3), context())).toEqual({ at: [0.5, 0.3] });
    expect(placeAt(host, tool('curve'), pointer(15, 10), context())).toEqual({ at: [15, 10] });
  });

  it("a tool's own picker makes the place, which may name an entity of another sketch", () => {
    const own = tool({ pick: (_host, event) => ({ at: [event.clientX, event.clientY], snap: { kind: 'foreign', sketch: 'other', id: 'p1' } }) });
    expect(placeAt(host, own, pointer(1, 2), context())).toEqual({ at: [1, 2], snap: { kind: 'foreign', sketch: 'other', id: 'p1' } });
  });
});
