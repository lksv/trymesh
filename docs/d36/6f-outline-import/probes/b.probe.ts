// Probe B: scenario 15 on an imported board: step 1, steps 2 and 3 over it, the revised file of
// step 7, a projection and an own outline over an import, and what an update does to a constraint
// today. Rows B1 to B6 of design.md.
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../../../../packages/engine/src/index';
import { pcbByHand, point } from '../../../../packages/scenarios/test/board-kit';
import { addSketch, batch, constrain, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { allOk, baseByHand, boardFile, importedBoard, loopsOf, planeAt, projectWith, roundedArea, sketchOf, skeletonAndBase } from './cover';
import { boardDxf, regionArea, resultOf } from './kit';
import { importOutline, installOutlineKind } from './proto';

installOutlineKind();
// the stored value of an outline has a form of its own, which the reader of stored values gets in 6f
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

describe('B: scenario 15 on an imported board', () => {
  it('B1: step 1: the board of the file, placed by its centre, one region with four holes, 1.6 thick', () => {
    const engine = newEngine();
    const { report } = boardFile(60);
    console.log('B1 report', JSON.stringify(report));
    const state = importedBoard(engine);
    const result = resultOf(state, 'board');
    console.log('B1 board', state.evaluation.features.board.status, 'valid', result.valid, 'dof', result.degreesOfFreedom, 'regions', loopsOf(state, 'board').map((l) => l.length), 'openEnds', result.openEnds?.count ?? 0);
    console.log('B1 pcb', state.evaluation.features.pcb.status, state.evaluation.bodies.pcb.volume, 'by hand', pcbByHand(60));
    console.log('B1 holes', ['c1', 'c2', 'c3', 'c4'].map((c) => `${c} ${JSON.stringify(result.points[`pcbo/${c}/center`])}`).join(' '));
    console.log('B1 corners', JSON.stringify(result.points['pcbo/l1/a']), JSON.stringify(result.points['pcbo/a4/end']));
    console.log('B1 entry chars', JSON.stringify(sketchOf(state, 'board').external).length, 'solved', JSON.stringify(sketchOf(state, 'board').solved));
    console.log('B1 faces', state.evaluation.bodies.pcb.faces.map((f) => JSON.stringify(state.evaluation.faceNames[f.id])).slice(2, 5).join(' '));
    expect(result.valid).toBe(true);
  });

  it('B2: steps 2 and 3 over the import: the skeleton measures, the floor is held, the rim and the standoffs', () => {
    const engine = newEngine();
    const { floor } = skeletonAndBase(engine);
    const state = engine.getState();
    console.log('B2 not ok', allOk(state));
    console.log('B2 frame m1 m2', resultOf(state, 'frame').measurements.m1, resultOf(state, 'frame').measurements.m2);
    const diagnosis = engine.diagnoseSketch('baseSk');
    console.log('B2 baseSk', diagnosis.status, 'dof', diagnosis.degreesOfFreedom, 'redundant', diagnosis.redundant.length, 'regions', loopsOf(state, 'baseSk').length, 'floor curves', floor.length);
    console.log('B2 rimSk regions', JSON.stringify(loopsOf(state, 'rimSk')), 'standSk regions', loopsOf(state, 'standSk').length);
    console.log('B2 base', state.evaluation.bodies.base.volume, 'by hand', baseByHand(60));
  });

  it('B3: step 7: the revised file 2 mm wider replaces the outline; everything follows', () => {
    const engine = newEngine();
    skeletonAndBase(engine);
    const before = engine.getState();
    const entry = sketchOf(before, 'board').external.pcbo as unknown as { curves: object };
    const revised = boardFile(62);
    console.log('B3 same IDs', JSON.stringify(Object.keys(revised.curves)) === JSON.stringify(Object.keys(entry.curves)));
    const t0 = performance.now();
    const state = run(engine, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: revised.curves } } as unknown as Command);
    console.log('B3 update ms', (performance.now() - t0).toFixed(1), 'not ok', allOk(state));
    console.log('B3 pcb', state.evaluation.bodies.pcb.volume - before.evaluation.bodies.pcb.volume, 'by hand', pcbByHand(62) - pcbByHand(60));
    console.log('B3 base', state.evaluation.bodies.base.volume - before.evaluation.bodies.base.volume, 'by hand', baseByHand(62) - baseByHand(60));
    console.log('B3 frame m1 m2', resultOf(state, 'frame').measurements.m1, resultOf(state, 'frame').measurements.m2);
    const diagnosis = engine.diagnoseSketch('baseSk');
    console.log('B3 baseSk', diagnosis.status, 'dof', diagnosis.degreesOfFreedom, 'redundant', diagnosis.redundant.length, 'regions', loopsOf(state, 'baseSk').length);
    // the same with the anchor of the file: the board grows to the right only, the holes move with it
    const onOrigin = run(engine, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: revised.curves, anchor: 'origin', x: -130, y: -100 } } as unknown as Command);
    console.log('B3 anchor origin x -130: not ok', allOk(onOrigin), 'm1 m2', resultOf(onOrigin, 'frame').measurements.m1, resultOf(onOrigin, 'frame').measurements.m2);
    // a placement field as an expression, and a turn by a quarter
    const turned = run(engine, { type: 'setParameter', name: 'boardTurn', expr: 'deg(90)' }, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: revised.curves, turn: 'boardTurn' } } as unknown as Command);
    console.log('B3 turned by the parameter: not ok', allOk(turned), 'expressions', JSON.stringify(sketchOf(turned, 'board').expressions), 'box of pcb', JSON.stringify(turned.evaluation.bodies.pcb.bounds ?? null));
    const back = run(engine, { type: 'setParameter', name: 'boardTurn', expr: '0' });
    console.log('B3 turned back: not ok', allOk(back), 'base', back.evaluation.bodies.base.volume - before.evaluation.bodies.base.volume);
    const byField = engine.execute({ type: 'setField', feature: 'board', path: 'external/pcbo/x', value: 5 } as unknown as Command);
    console.log('B3 setField external/pcbo/x', byField.ok ? `ok, hole c1 at ${JSON.stringify(resultOf(byField.state, 'board').points['pcbo/c1/center'])}, not ok ${allOk(byField.state)}` : byField.error.message);
  });

  it('B4: the whole import projected, in its role and as an own outline', () => {
    const engine = newEngine();
    importedBoard(engine);
    run(engine, planeAt('pl', '-3'), addSketch('whole', { kind: 'plane', feature: 'pl' }), addSketch('own', { kind: 'plane', feature: 'pl' }));
    const source = projectWith(engine, 'whole', { sketch: 'board' }, 'w');
    let state = engine.getState();
    console.log('B4 source: entries', source.entries.length, 'regions', loopsOf(state, 'whole').map((l) => l.length), 'valid', resultOf(state, 'whole').valid);
    const own = projectWith(engine, 'own', { sketch: 'board', as: 'own' }, 'n');
    state = engine.getState();
    const diagnosis = engine.diagnoseSketch('own');
    console.log('B4 own: entries', own.entries.length, 'curves', own.curves.length, 'regions', loopsOf(state, 'own').map((l) => l.length), 'dof', diagnosis.degreesOfFreedom, 'redundant', diagnosis.redundant.length, 'status', diagnosis.status);
    // the revised file under it
    const entry = sketchOf(state, 'board').external.pcbo as unknown as { curves: object };
    const wider = run(engine, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: boardFile(62).curves } } as unknown as Command);
    console.log('B4 revised: not ok', allOk(wider), 'own area', regionArea(wider, 'own'), 'by hand', roundedArea(62, 40, 3, 0));
  });

  it('B5: an update that takes away a constrained entity, as the engine is today', () => {
    const engine = newEngine();
    importedBoard(engine);
    run(engine, batch(point('board', 'p', 5, 5), constrain('board', 'k', { type: 'coincident', a: 'p', b: 'pcbo/c4/center' })));
    const entry = sketchOf(engine.getState(), 'board').external.pcbo as unknown as { curves: Record<string, object> };
    const { c4: _gone, ...fewer } = entry.curves;
    const outcome = engine.preview({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: fewer } } as unknown as Command);
    console.log('B5 update without c4:', outcome.ok ? `accepted; board ${outcome.state.evaluation.features.board.status} ${JSON.stringify(outcome.state.evaluation.features.board.warnings.map((w) => [w.code, w.refs]))}; p ${JSON.stringify(resultOf(outcome.state, 'board').points.p)}` : outcome.error.message);
    if (outcome.ok) {
      const json = JSON.stringify(outcome.state.document);
      const loaded = newEngine().load(json);
      console.log('B5 that document loaded:', loaded.ok ? 'ok' : loaded.error.message);
    }
    // a kind changed under an ID that stays is refused already
    const kinded = engine.preview({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: { ...entry.curves, c4: { type: 'line', a: [0, 0], b: [1, 1] } } } } as unknown as Command);
    console.log('B5 c4 as a line:', kinded.ok ? 'accepted' : kinded.error.message);
  });

  it('B6: a later file with the holes in another order: the IDs follow the order of the file', () => {
    const a = importOutline(boardDxf(60, 40, 3, 6), { layers: ['Edge.Cuts'] });
    const b = importOutline(boardDxf(60, 40, 3, 6, 0, [[56.5, 3.5], [3.5, 3.5], [56.5, 36.5], [3.5, 36.5]]), { layers: ['Edge.Cuts'] });
    console.log('B6 c1 of the first', JSON.stringify(a.curves.c1), 'of the second', JSON.stringify(b.curves.c1));
    expect(Object.keys(a.curves)).toEqual(Object.keys(b.curves));
  });
});
