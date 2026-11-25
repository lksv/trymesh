// The cover of scenario 15 over an imported board, for the probes of 6f: step 1 (the board of
// the file), steps 2 and 3 (the skeleton and the base of 6b's calls over it).
import { type Command, type Engine, type EngineState, type Expr, type Id, type SketchFeature, type SketchToolInputs, freshIds, sketchTool } from '../../../../packages/engine/src/index';
import { point } from '../../../../packages/scenarios/test/board-kit';
import { XY, addSketch, batch, constrain, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, boardDxf, resultOf } from './kit';
import { importOutline, outlineEntry } from './proto';

export const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
export const allOk = (state: EngineState): string[] => state.document.features.filter((feature) => state.evaluation.features[feature.id].status !== 'ok').map((feature) => `${feature.id}:${state.evaluation.features[feature.id].status}`);
export const loopsOf = (state: EngineState, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
export const COVER: [string, string][] = [['standoffH', '5'], ['baseT', '2'], ['clearance', '0.5'], ['wall', '2'], ['rimH', '4'], ['standoffD', '6']];
export const roundedArea = (W: number, H: number, R: number, o: number): number => (W + 2 * o) * (H + 2 * o) - (4 - Math.PI) * (R + o) * (R + o);
export const baseByHand = (W: number): number => roundedArea(W, 40, 3, 2.5) * 2 + (roundedArea(W, 40, 3, 2.5) - roundedArea(W, 40, 3, 0.5)) * 4 + ((4 * Math.PI * (6 * 6 - 3.2 * 3.2)) / 4) * 5;
export const fromSketch = (sketch: Id, id: Id, source: Id, entity: Id, kind: 'point' | 'line' | 'circle' | 'arc', regions?: boolean): Command => ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: source, entity, kind, ...(regions === undefined ? {} : { regions }) } }) as Command;
export const planeAt = (id: Id, offset: Expr): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } as never });
export const extrudeOp = (id: Id, sketch: Id, regions: Id[][], distance: Expr, operation: 'new' | 'add' | 'cut', offset?: Expr, targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(offset === undefined ? {} : { offset }) }, extent: { type: 'distance', start: 0, distance }, operation, ...(targets ? { targets } : {}) } as never,
});
export const toolContext = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
export function projectWith(engine: Engine, sketch: Id, input: SketchToolInputs['projectSketch'], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool('projectSketch', toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made.ids;
}

export const OUTLINE = ['a1', 'a2', 'a3', 'a4', 'l1', 'l2', 'l3', 'l4'].map((local) => `pcbo/${local}`);
export const FRAME_OUTLINE = ['fa1', 'fa2', 'fa3', 'fa4', 'fl1', 'fl2', 'fl3', 'fl4'];
export const RIM = ['ra1', 'ra2', 'ra3', 'ra4', 'rl1', 'rl2', 'rl3', 'rl4'];
// the file of the board `W` wide as a PCB tool writes it, read as the import reads it
export const boardFile = (W: number, digits = 6) => importOutline(boardDxf(W, 40, 3, digits), { layers: ['Edge.Cuts'] });

// Step 1: the board imported and placed with its centre on the origin, extruded 1.6.
export function importedBoard(engine: Engine): EngineState {
  const { curves } = boardFile(60);
  run(engine, addSketch('board', XY), addOutline('board', 'pcbo', outlineEntry(curves, { name: 'board.dxf', anchor: 'center' })));
  return run(engine, extrudeOp('pcb', 'board', [OUTLINE], '1.6', 'new'));
}

export function skeletonAndBase(engine: Engine): { floor: Id[]; entries: Id[] } {
  importedBoard(engine);
  run(engine, ...COVER.map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
  const f = 'frame';
  run(engine, planeAt('framePl', '-standoffH'), addSketch(f, { kind: 'plane', feature: 'framePl' }));
  run(engine, ...[1, 2, 3, 4].flatMap((i) => [fromSketch(f, `fa${i}`, 'board', `pcbo/a${i}`, 'arc'), fromSketch(f, `fl${i}`, 'board', `pcbo/l${i}`, 'line'), fromSketch(f, `fh${i}`, 'board', `pcbo/c${i}`, 'circle')]));
  run(engine, constrain(f, 'm1', { type: 'distancePointLine', point: 'fh1/center', line: 'origin/y', value: 1, driving: false } as never), constrain(f, 'm2', { type: 'distancePointLine', point: 'fh2/center', line: 'origin/y', value: 1, driving: false } as never));
  run(engine, planeAt('basePl', '-(standoffH + baseT)'), addSketch('baseSk', { kind: 'plane', feature: 'basePl' }));
  const ids = projectWith(engine, 'baseSk', { sketch: 'frame', entities: FRAME_OUTLINE, as: 'own' }, 'o');
  run(engine, extrudeOp('base', 'baseSk', [ids.curves], 'baseT', 'new', 'clearance + wall'));
  run(engine, addSketch('rimSk', { kind: 'plane', feature: 'framePl' }), ...[1, 2, 3, 4].flatMap((i) => [fromSketch('rimSk', `ra${i}`, 'frame', `fa${i}`, 'arc', true), fromSketch('rimSk', `rl${i}`, 'frame', `fl${i}`, 'line', true)]));
  run(engine, extrudeOp('rim', 'rimSk', [RIM], 'rimH', 'add', 'clearance + wall', ['base']), extrudeOp('pocket', 'rimSk', [RIM], 'rimH', 'cut', 'clearance', ['base']));
  const t = 'standSk';
  const commands: Command[] = [addSketch(t, { kind: 'plane', feature: 'framePl' })];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], k) => {
    const i = k + 1;
    commands.push(
      fromSketch(t, `sh${i}`, 'frame', `fh${i}`, 'circle', true),
      point(t, `sc${i}`, sx * 26.4, sy * 16.6),
      { type: 'addCurve', sketch: t, id: `so${i}`, curve: { type: 'circle', center: `sc${i}` }, radius: 2.9 },
      constrain(t, `sk${i}`, { type: 'coincident', a: `sc${i}`, b: `sh${i}/center` }),
      i === 1 ? constrain(t, 'sd', { type: 'diameter', curve: 'so1', value: 'standoffD', driving: true } as never) : constrain(t, `se${i}`, { type: 'equalRadius', a: 'so1', b: `so${i}` }),
    );
  });
  run(engine, ...commands);
  run(engine, extrudeOp('standoffs', t, [['so1'], ['so2'], ['so3'], ['so4']], 'standoffH', 'add', undefined, ['base']));
  return { floor: ids.curves, entries: ids.entries };
}


// ---------------------------------------------------------------- the lid (probe G)

export const pt = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
export const ln = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });
export const ac = (sketch: Id, id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'arc', center, start, end } });
export const dim = (sketch: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): Command => ({ type: 'addConstraint', sketch, id, constraint: { type, a, b, value, driving: true } }) as Command;
export const off = (sketch: Id, id: Id, point: Id, line: Id, value: Expr): Command => ({ type: 'addConstraint', sketch, id, constraint: { type: 'distancePointLine', point, line, value, driving: true } }) as Command;
export const LID_REGION = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];

// The lid over the board: 12 beyond the board's sides, 7 beyond its bottom and top (84 × 54 for the
// board 60 × 40), corners of 5, a grip of 4 on each flank.
export function lidOverTheBoard(engine: Engine): EngineState {
  run(engine, ...([['lidZ', '6'], ['overX', '12'], ['overY', '7'], ['R', '5'], ['T', '2'], ['grip', '4'], ['reach', '10']] as const).map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
  const s = 'lidSketch';
  run(engine, planeAt('lidPl', 'lidZ'), addSketch(s, { kind: 'plane', feature: 'lidPl' }));
  // the bottom, right and top sides of the board, from the skeleton
  const from = (id: Id, entity: Id): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'sketch', sketch: 'frame', entity, kind: 'line' } }) as Command;
  run(engine, from('xb', 'fl1'), from('xr', 'fl2'), from('xt', 'fl3'));
  run(
    engine,
    pt(s, 'a0', 0.4, -27.3),
    pt(s, 'a1', 37.3, -26.8),
    pt(s, 'q1', 36.8, -21.9),
    pt(s, 'a2', 42.2, -22.3),
    pt(s, 'g1', 42.4, -11.7),
    pt(s, 'g2', 37.6, 0.4),
    pt(s, 'g3', 41.7, 11.6),
    pt(s, 'a3', 41.9, 22.4),
    pt(s, 'q2', 37.3, 21.8),
    pt(s, 'a4', 36.8, 27.3),
    pt(s, 'a5', 0.7, 26.8),
    ln(s, 'c1', 'a0', 'a1'),
    ac(s, 'r1', 'q1', 'a1', 'a2'),
    { type: 'addCurve', sketch: s, id: 'c2', curve: { type: 'spline', points: ['a2', 'g1', 'g2', 'g3', 'a3'] } },
    ac(s, 'r2', 'q2', 'a3', 'a4'),
    ln(s, 'c3', 'a4', 'a5'),
    ln(s, 'l1', 'a2', 'g1', true),
    ln(s, 'l2', 'g3', 'a3', true),
  );
  run(
    engine,
    constrain(s, 'k0', { type: 'pointOnCurve', point: 'a0', curve: 'origin/y' }),
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true } as never),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    off(s, 'k10', 'a2', 'xr', 'overX'),
    off(s, 'k11', 'a5', 'xt', 'overY'),
    off(s, 'k13', 'a0', 'xb', 'overY'),
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
    constrain(s, 't1', { type: 'vertical', line: 'l1' }),
    constrain(s, 't2', { type: 'tangent', a: 'r1', b: 'l1' }),
    constrain(s, 't3', { type: 'vertical', line: 'l2' }),
    constrain(s, 't4', { type: 'tangent', a: 'l2', b: 'r2' }),
    off(s, 't5', 'a3', 'xr', 'overX'),
    dim(s, 't6', 'verticalDistance', 'a2', 'g1', 'reach'),
    dim(s, 't7', 'verticalDistance', 'g3', 'a3', 'reach'),
    dim(s, 't8', 'horizontalDistance', 'g2', 'a2', 'grip'),
    dim(s, 't9', 'verticalDistance', 'origin', 'g2', 0),
  );
  run(engine, { type: 'addExternal', sketch: s, id: 'm', ref: { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
  return run(engine, { type: 'addFeature', feature: { id: 'lid', name: 'lid', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: [{ outerLoop: LID_REGION }] }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'new' } } as unknown as Command);
}
export const lidByHand = (W: number): number => (W * 54 - (4 - Math.PI) * 25 - 2 * 9.8 * 4) * 2;

