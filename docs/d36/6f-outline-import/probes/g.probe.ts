// Probe G: the lid of scenario 15 tied to the imported board through the skeleton: the half of
// 6d's calls with its sides dimensioned from projections of the frame, mirrored about origin/y;
// then the revised file. Rows G1 and G2 of design.md.
import { describe, it, vi } from 'vitest';
import type { Command } from '../../../../packages/engine/src/index';
import { newEngine, run } from '../../../../packages/scenarios/test/kit';
import { allOk, baseByHand, boardFile, lidByHand, lidOverTheBoard, loopsOf, sketchOf, skeletonAndBase } from './cover';
import { regionArea, resultOf } from './kit';
import { installOutlineKind } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

describe('G: the lid tied to the imported board', () => {
  it('G1: the half dimensioned from the projected sides of the board, mirrored; G2: the revised file', () => {
    const engine = newEngine();
    skeletonAndBase(engine);
    let state = lidOverTheBoard(engine);
    const diagnosis = engine.diagnoseSketch('lidSketch');
    console.log('G1 not ok', allOk(state), 'lidSketch', diagnosis.status, 'dof', diagnosis.degreesOfFreedom, 'redundant', diagnosis.redundant.length, 'regions', JSON.stringify(loopsOf(state, 'lidSketch')), 'openEnds', resultOf(state, 'lidSketch').openEnds?.count ?? 0);
    console.log('G1 a2', JSON.stringify(resultOf(state, 'lidSketch').points.a2), 'a0', JSON.stringify(resultOf(state, 'lidSketch').points.a0), 'a5', JSON.stringify(resultOf(state, 'lidSketch').points.a5));
    console.log('G1 lid', state.evaluation.bodies.lid.volume, 'by hand', lidByHand(84), 'polygon', regionArea(state, 'lidSketch') * 2, 'base', state.evaluation.bodies.base.volume, 'by hand', baseByHand(60));
    const before = state;
    const entry = sketchOf(state, 'board').external.pcbo as unknown as { curves: object };
    const t0 = performance.now();
    state = run(engine, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: boardFile(62).curves } } as unknown as Command);
    console.log('G2 the revised file:', (performance.now() - t0).toFixed(0), 'ms; not ok', allOk(state), 'a2', JSON.stringify(resultOf(state, 'lidSketch').points.a2), 'copy', JSON.stringify(resultOf(state, 'lidSketch').points['m/1/a2']));
    console.log('G2 lid', state.evaluation.bodies.lid.volume - before.evaluation.bodies.lid.volume, 'by hand', lidByHand(86) - lidByHand(84), 'base', state.evaluation.bodies.base.volume - before.evaluation.bodies.base.volume, 'by hand', baseByHand(62) - baseByHand(60), 'dof', engine.diagnoseSketch('lidSketch').degreesOfFreedom);
    const mass = engine.query('mass', { bodies: ['base', 'lid'] } as never);
    console.log('G2 mass', mass.ok ? JSON.stringify(mass.result).slice(0, 300) : mass.error.message);
  });
});
