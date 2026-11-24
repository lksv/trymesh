// The table of the tools of the sketch bar (D64, part 4): what the mode reads of an entry, the
// places the mode picks for a tool that picks in the sketch or on curves only, and what the mode
// does with the places a tool keeps.
import { type Command, type Id, createEngine, emptySketch, isOriginAxis } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { rectangleCommands } from '../src/sketch-commands';
import { type SketchHost, type SketchMode, placeAt, settleSketch, sketchClick, sketchContextOf, sketchFinish, sketchMode } from '../src/sketch-mode';
import { type Place, SKETCH_TOOL_UI, type SketchPlaceTool } from '../src/sketch-tools';

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
    // the X axis of the origin (D71) runs under the bottom line and is nearer than the left one
    expect(placeAt(host, tool('curve', (curve) => curve !== bottom), pointer(0.5, 0.3), context())).toEqual({ at: [expect.closeTo(0.5, 9), expect.closeTo(0, 9)], snap: { kind: 'curve', id: 'origin/x' } });
    expect(placeAt(host, tool('curve', (curve) => curve !== bottom && !isOriginAxis(curve)), pointer(0.5, 0.3), context())).toEqual({ at: [expect.closeTo(0, 9), expect.closeTo(0.3, 9)], snap: { kind: 'curve', id: left } });
    expect(placeAt(host, tool('curve', () => false), pointer(0.5, 0.3), context())).toEqual({ at: [0.5, 0.3] });
    expect(placeAt(host, tool('curve'), pointer(15, 10), context())).toEqual({ at: [15, 10] });
  });

  it("a tool's own picker makes the place, which may name an entity of another sketch", () => {
    const own = tool({ pick: (_host, event) => ({ at: [event.clientX, event.clientY], snap: { kind: 'foreign', sketch: 'other', id: 'p1' } }) });
    expect(placeAt(host, own, pointer(1, 2), context())).toEqual({ at: [1, 2], snap: { kind: 'foreign', sketch: 'other', id: 'p1' } });
  });
});

// The generic paths of the mode that no tool of today takes (the review of the implementation of
// 6a): a tool without `clicks` that keeps places (6d's spline), `finish` on Enter, and a tool's own
// picker in the click flow with a foreign snap that a change of the sketch keeps.
describe('the mode with a tool that keeps places, and Enter', () => {
  const engine = createEngine(deps);
  expect(engine.execute({ type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) }).ok).toBe(true);
  expect(engine.execute({ type: 'addPoint', sketch: 's', id: 'p', x: 10, y: 10 }).ok).toBe(true);
  const context = () => sketchContextOf(engine.getState(), 's')!;
  const log: string[] = [];
  const m: SketchMode = sketchMode('s');
  const host = {
    planePoint: (event: { clientX: number; clientY: number }) => ({ at: [event.clientX, event.clientY], depth: 0 }),
    pixelSize: () => 1,
    sketchContext: () => context(),
    get sketch() {
      return m;
    },
    sketching: { tools: {} },
    renderScene: () => void log.push('scene'),
  } as unknown as SketchHost;
  const show = (places: Place[]): string => places.map((p) => `${p.at.join(',')}${p.snap ? `@${p.snap.kind}:${p.snap.id}` : ''}`).join(' ');
  const click = (x: number, y: number) => sketchClick(host, m, { clientX: x, clientY: y, shiftKey: false } as PointerEvent);
  // a spline as 6d draws it: every click is kept; Enter needs three places, else they stay
  const collect: SketchPlaceTool<undefined> = {
    label: 'Collect',
    hint: 'Collect',
    click: (_host, _m, places) => (log.push(`click ${show(places)}`), places),
    finish: (_host, _m, places) => {
      log.push(`finish ${show(places)}`);
      return places.length < 3 ? places : undefined;
    },
  };
  const once: SketchPlaceTool<undefined> = { label: 'Once', hint: 'Once', click: (_host, _m, places) => void log.push(`once ${show(places)}`) };
  const foreign: SketchPlaceTool<undefined> = {
    label: 'Foreign',
    hint: 'Foreign',
    clicks: 2,
    picks: { pick: (_host, event) => ({ at: [event.clientX, event.clientY], snap: { kind: 'foreign', sketch: 'other', id: 'q' } }) },
    click: (_host, _m, places) => void log.push(`foreign ${show(places)}`),
  };
  const table = SKETCH_TOOL_UI as Record<string, unknown>;
  const use = (name: string, tool: SketchPlaceTool<undefined>, run: () => void) => {
    table[name] = tool;
    Object.assign(m, { tool: name, clicks: [] });
    log.length = 0;
    try {
      run();
    } finally {
      delete table[name];
    }
  };

  it('a tool without `clicks` that keeps places: the mode keeps them and redraws; Enter finishes, and what `finish` returns stays', () => {
    use('collect', collect, () => {
      click(10.5, 10.3);
      expect(show(m.clicks)).toBe('10,10@point:p');
      click(20, 15);
      expect(show(m.clicks)).toBe('10,10@point:p 20,15');
      expect(log).toEqual(['click 10,10@point:p', 'scene', 'click 10,10@point:p 20,15', 'scene']);
      log.length = 0;
      // too few places: the tool refuses and the places stay
      expect(sketchFinish(host, m)).toBe(true);
      expect(show(m.clicks)).toBe('10,10@point:p 20,15');
      click(30, 20);
      expect(sketchFinish(host, m)).toBe(true);
      expect(m.clicks).toEqual([]);
      expect(log).toEqual(['finish 10,10@point:p 20,15', 'scene', 'click 10,10@point:p 20,15 30,20', 'scene', 'finish 10,10@point:p 20,15 30,20', 'scene']);
      // nothing kept: Enter is not the tool's
      log.length = 0;
      expect(sketchFinish(host, m)).toBe(false);
      expect(log).toEqual([]);
    });
  });

  it('a tool without `clicks` that keeps nothing redraws nothing of the mode; a tool without `finish` does not take Enter', () => {
    use('once', once, () => {
      click(30, 25);
      click(40, 35);
      expect(m.clicks).toEqual([]);
      expect(log).toEqual(['once 30,25', 'once 40,35']);
      m.clicks = [{ at: [1, 1] }];
      expect(sketchFinish(host, m)).toBe(false);
      expect(m.clicks).toEqual([{ at: [1, 1] }]);
    });
  });

  it("a tool's own picker gives the places of a click; a kept foreign snap survives a change of the sketch, a snap to a point that is gone does not", () => {
    use('foreign', foreign, () => {
      click(3, 4);
      expect(show(m.clicks)).toBe('3,4@foreign:q');
      expect(log).toEqual(['scene']);
      m.clicks = [...m.clicks, { at: [7, 7], snap: { kind: 'point', id: 'gone' } }, { at: [10, 10], snap: { kind: 'point', id: 'p' } }];
      settleSketch(m, context());
      expect(show(m.clicks)).toBe('3,4@foreign:q 10,10@point:p');
      m.clicks = m.clicks.slice(0, 1);
      click(8, 9);
      expect(log).toEqual(['scene', 'foreign 3,4@foreign:q 8,9@foreign:q', 'scene']);
      expect(m.clicks).toEqual([]);
    });
  });
});
