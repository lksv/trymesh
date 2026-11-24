// The axes of the origin in the app (D36 6a2, D71): two curves of the view of every open sketch that
// are not own, whole lines a pointer hovers, picks and snaps to anywhere, drawn by the view as their
// stretch inside what it shows; offered in the constraints that do not measure a line and in the
// pickers of a line of a sketch.
import { type Command, type Id, type SketchFeature, type Vec2, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { COLOR, stretchInView } from '../src/draw';
import { changeAxis, deleteCommands, dimensionFor, geometricFor, hasLength, lineCommands, lineIds } from '../src/sketch-commands';
import { type SketchHost, sketchContextOf, sketchMode, placeAt, sketchScene } from '../src/sketch-mode';
import { hitCurve } from '../src/sketch-view';
import type { SceneModel } from '../src/viewport';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

// A sketch `s` on XY with the points p (12, 5) and q (-7, 9), and the line l between them.
function setup() {
  const engine = createEngine(deps);
  const run = (...commands: Command[]) => {
    for (const command of commands) {
      const outcome = engine.execute(command);
      if (!outcome.ok) throw new Error(outcome.error.message);
    }
  };
  run(
    { type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) },
    { type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'p', x: 12, y: 5 }, { type: 'addPoint', sketch: 's', id: 'q', x: -7, y: 9 }, { type: 'addCurve', sketch: 's', id: 'l', curve: { type: 'line', a: 'p', b: 'q' } }] },
  );
  const context = () => sketchContextOf(engine.getState(), 's')!;
  return { engine, run, context, view: () => context().view, sketch: () => context().feature };
}

describe('the axes of the origin in the sketch view (D71)', () => {
  it('are curves of the view that are not own, held by the origin, whole lines', () => {
    const { view } = setup();
    expect([...view().curves.keys()]).toEqual(['l', 'origin/x', 'origin/y']);
    expect(view().curves.get('origin/x')).toEqual({ id: 'origin/x', own: false, construction: false, points: ['origin'], shape: { type: 'line', a: [-1e6, 0], b: [1e6, 0] } });
    expect(view().curves.get('origin/y')?.shape).toEqual({ type: 'line', a: [0, -1e6], b: [0, 1e6] });
    // the far points are no points of the view
    expect([...view().points.keys()]).toEqual(['origin', 'p', 'q']);
  });

  it('are hit far from the origin, and an own curve wins at the same distance', () => {
    const { view } = setup();
    expect(hitCurve(view(), [500, 0.3], 0.5)?.id).toBe('origin/x');
    expect(hitCurve(view(), [-0.2, -700], 0.5)?.id).toBe('origin/y');
    expect(hitCurve(view(), [500, 0.6], 0.5)).toBeUndefined();
  });

  it('a click near an axis away from the origin snaps to it, and the point is held on it', () => {
    const t = setup();
    const host = { planePoint: (event: { clientX: number; clientY: number }) => ({ at: [event.clientX, event.clientY], depth: 0 }), pixelSize: () => 1 } as unknown as SketchHost;
    const place = placeAt(host, { label: 'Line', hint: '' , click: () => undefined }, { clientX: 500, clientY: 3 }, t.context());
    expect(place).toEqual({ at: [expect.closeTo(500, 6), expect.closeTo(0, 9)], snap: { kind: 'curve', id: 'origin/x' } });
    const below = placeAt(host, { label: 'Line', hint: '', click: () => undefined }, { clientX: -3, clientY: -400 }, t.context());
    expect(below?.snap).toEqual({ kind: 'curve', id: 'origin/y' });
    let n = 0;
    const made = lineCommands('s', t.view(), place as { at: Vec2; snap: { kind: 'curve'; id: Id } }, { at: [520, 30] }, (prefix) => `${prefix}n${++n}`);
    expect(made?.commands).toContainEqual(expect.objectContaining({ type: 'addConstraint', constraint: { type: 'pointOnCurve', point: 'pn1', curve: 'origin/x' } }));
    t.run({ type: 'batch', commands: made!.commands });
    const at = t.context().result.points.pn1;
    expect([at.x, at.y]).toEqual([expect.closeTo(500, 6), expect.closeTo(0, 9)]);
  });

  it('the offers of constraints: what does not measure a line takes an axis, equalLength, midpoint and the length of an axis do not', () => {
    const { view } = setup();
    const v = view();
    expect(geometricFor('pointOnCurve', v, ['p', 'origin/x'])).toEqual([{ type: 'pointOnCurve', point: 'p', curve: 'origin/x' }]);
    expect(geometricFor('symmetric', v, ['p', 'q', 'origin/y'])).toEqual([{ type: 'symmetric', a: 'p', b: 'q', line: 'origin/y' }]);
    expect(geometricFor('symmetric', v, ['origin', 'p', 'origin/y'])).toBeUndefined(); // the origin is the point of the axis
    expect(geometricFor('parallel', v, ['l', 'origin/x'])).toEqual([{ type: 'parallel', a: 'l', b: 'origin/x' }]);
    expect(geometricFor('equalLength', v, ['l', 'origin/x'])).toBeUndefined();
    expect(geometricFor('midpoint', v, ['p', 'origin/y'])).toBeUndefined();
    expect(geometricFor('horizontal', v, ['origin/x'])).toEqual([{ type: 'horizontal', line: 'origin/x' }]); // the engine refuses it: fixed operands only
    expect([hasLength('l'), hasLength('origin/x'), hasLength('origin/y')]).toEqual([true, false, false]);
    expect(dimensionFor('auto', v, ['origin/x'])).toBeUndefined();
    expect(dimensionFor('horizontal', v, ['origin/y'])).toBeUndefined();
    expect(dimensionFor('auto', v, ['l'])).toMatchObject({ type: 'distance', a: 'p', b: 'q' });
    expect(dimensionFor('auto', v, ['p', 'origin/y'])).toEqual({ type: 'distancePointLine', point: 'p', line: 'origin/y', value: 12, driving: true });
    expect(dimensionFor('auto', v, ['q', 'origin/x'])).toEqual({ type: 'distancePointLine', point: 'q', line: 'origin/x', value: 9, driving: true });
    expect(dimensionFor('auto', v, ['origin/x', 'l'])).toMatchObject({ type: 'angle', a: 'origin/x', b: 'l' });
  });

  it('deleting an axis by the selection does nothing', () => {
    const { view, sketch } = setup();
    expect(deleteCommands('s', sketch(), view(), ['origin/x'])).toEqual([]);
    expect(deleteCommands('s', sketch(), view(), ['origin/y', 'l']).map((command) => (command.type === 'removeEntity' ? command.id : command.type))).toEqual(['l', 'p', 'q']);
  });

  it('the pickers of a line of a sketch list the axes after its lines', () => {
    const { sketch } = setup();
    expect(lineIds(sketch())).toEqual(['l', 'origin/x', 'origin/y']);
    const empty = emptySketch('e', 'Empty', { kind: 'base', plane: 'XY' }) as SketchFeature;
    expect(lineIds(empty)).toEqual(['origin/x', 'origin/y']);
    // a sketch without a line: the axis picker starts at its X axis
    expect(changeAxis({ kind: 'base', axis: 'Z' }, { axis: 'sketchLine' }, ['e'], (id) => (id === 'e' ? lineIds(empty) : []))).toEqual({ kind: 'sketchLine', sketch: 'e', line: 'origin/x' });
  });
});

describe('the axes of the origin in the scene (D71)', () => {
  const scene = (t: ReturnType<typeof setup>, change: (m: ReturnType<typeof sketchMode>) => void = () => undefined): SceneModel => {
    const m = sketchMode('s');
    change(m);
    const host = { sketchContext: () => t.context(), engine: t.engine, sketching: { tools: {} } } as unknown as SketchHost;
    const model: SceneModel = { bodies: [], lines: [], points: [], fills: [], faces: [], labels: [] };
    sketchScene(host, m, model);
    return model;
  };

  it('are drawn in a bucket of their own, thin in the colour of a plane, and not among the lines of the sketch', () => {
    const t = setup();
    const model = scene(t);
    const frame = t.context().frame;
    expect(model.axes).toEqual([
      { frame, direction: [1, 0], color: COLOR.plane, width: 1 },
      { frame, direction: [0, 1], color: COLOR.plane, width: 1 },
    ]);
    // the lines of the sketch hold the own line only
    expect(model.lines.reduce((sum, set) => sum + set.segments.length, 0)).toBe(6);
    expect(model.lines.flatMap((set) => Array.from(set.segments)).every((value) => Math.abs(value) < 100)).toBe(true);
  });

  it('a hovered or a selected axis is marked', () => {
    const t = setup();
    expect(scene(t, (m) => (m.hover = 'origin/x')).axes?.[0]).toMatchObject({ color: COLOR.hover, width: 3 });
    expect(scene(t, (m) => (m.selection = ['origin/y'])).axes?.[1]).toMatchObject({ color: COLOR.select, width: 3 });
    expect(scene(t, (m) => (m.selection = ['origin/y'])).axes?.[0]).toMatchObject({ color: COLOR.plane, width: 1 });
  });
});

describe('the stretch of a line without ends inside the view', () => {
  const square = (half: number, at: Vec2 = [0, 0]): Vec2[] => [
    [at[0] - half, at[1] - half],
    [at[0] + half, at[1] - half],
    [at[0] + half, at[1] + half],
    [at[0] - half, at[1] + half],
  ];

  it('is the part of the line the corners of the view enclose', () => {
    expect(stretchInView(square(10), [1, 0])).toEqual([
      [-10, 0],
      [10, 0],
    ]);
    expect(stretchInView(square(10, [3, 4]), [0, 1])).toEqual([
      [0, -6],
      [0, 14],
    ]);
    // a view seen at an angle: a parallelogram on the plane
    const skew: Vec2[] = [
      [-5, -2],
      [15, -2],
      [25, 6],
      [5, 6],
    ];
    const [a, b] = stretchInView(skew, [1, 0])!;
    expect([a[0], a[1], b[0], b[1]]).toEqual([expect.closeTo(-2.5, 9), 0, expect.closeTo(17.5, 9), 0]);
  });

  it('reaches the edges of the view after a zoom far out, beyond the reach of an axis', () => {
    expect(stretchInView(square(5e8), [1, 0])).toEqual([
      [-5e8, 0],
      [5e8, 0],
    ]);
  });

  it('is nothing when the view does not show the line', () => {
    expect(stretchInView(square(10, [100, 50]), [1, 0])).toBeUndefined();
    expect(stretchInView(square(10, [100, 50]), [0, 1])).toBeUndefined();
    expect(stretchInView(square(10), [0, 0])).toBeUndefined();
  });
});
