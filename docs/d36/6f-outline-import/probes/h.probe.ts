// Probe H: scenario 15 as one model over the imported board: steps 1 to 6 in one document, then the
// checks of step 7. Rows H1 to H5 of design.md.
import { describe, it, vi } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchToolInputs, freshIds, sketchTool } from '../../../../packages/engine/src/index';
import { XY, addSketch, constrain, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { LID_REGION, ac, allOk, baseByHand, boardFile, dim, lidByHand, lidOverTheBoard, ln, loopsOf, off, pt, sketchOf, skeletonAndBase, toolContext } from './cover';
import { addOutline, dxfOf, loopArea, regionArea, resultOf } from './kit';
import { importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

function cut<K extends 'trim' | 'split' | 'extend'>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) throw new Error(`${name}: ${made.message}`);
  run(engine, { type: 'batch', commands: made.commands });
  return made.ids;
}
const set = (engine: Engine, name: string, expr: string): EngineState => run(engine, { type: 'setParameter', name, expr });
const SLOT = 3 * 9 + Math.PI * 1.5 * 1.5;
function slot(sketch: Id, p: string, x: number, y: number): Command[] {
  return [pt(sketch, `${p}o1`, x, y - 4.5), pt(sketch, `${p}o2`, x, y + 4.5), pt(sketch, `${p}s1`, x - 1.5, y - 4.5), pt(sketch, `${p}s2`, x + 1.5, y - 4.5), pt(sketch, `${p}s3`, x + 1.5, y + 4.5), pt(sketch, `${p}s4`, x - 1.5, y + 4.5), ac(sketch, `${p}g1`, `${p}o1`, `${p}s1`, `${p}s2`), ln(sketch, `${p}e1`, `${p}s2`, `${p}s3`), ac(sketch, `${p}g2`, `${p}o2`, `${p}s3`, `${p}s4`), ln(sketch, `${p}e2`, `${p}s4`, `${p}s1`)];
}
const copyRegion = (copy: number): Id[] => ['wg1', 'we1', 'wg2', 'we2'].map((curve) => `vb/${copy}/${curve}`).sort();
const linear = (sources: Id[]): object => ({ type: 'pattern', sources, transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } });
const volume = (state: EngineState, body: Id): number => state.evaluation.bodies[body].volume;

describe('H: the cover as one model', () => {
  it('H1 to H5: the vents, the two notches, then the checks of step 7', () => {
    const engine = newEngine();
    const { floor } = skeletonAndBase(engine);
    lidOverTheBoard(engine);
    run(engine, ...([['vents', '5'], ['ventPitch', '6'], ['slotW', '8'], ['slotD', '5'], ['cableD', '8']] as const).map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
    // step 5: a row in the lid sketch, holes of its region; a second row in a sketch of its own,
    // placed from the projection of a copy of the lid's top line, cut by the regions of copies 1 and 3
    const s = 'lidSketch';
    let state = run(engine, ...slot(s, 'v', -12, -10), { type: 'addExternal', sketch: s, id: 'va', ref: linear(['vg1', 've1', 'vg2', 've2']) } as Command);
    console.log('H1 row A: lid regions', loopsOf(state, s).length, 'lid', volume(state, 'lid'), 'by hand', lidByHand(84) - 5 * SLOT * 2);
    run(engine, addSketch('ventSketch', { kind: 'plane', feature: 'lidPl' }), { type: 'addExternal', sketch: 'ventSketch', id: 'lf', ref: { type: 'sketch', sketch: s, entity: 'm/1/c3', kind: 'line' } } as Command, ...slot('ventSketch', 'w', -12, 10));
    run(engine, off('ventSketch', 'lfd', 'wo2', 'lf', '12.5'), { type: 'addExternal', sketch: 'ventSketch', id: 'vb', ref: linear(['wg1', 'we1', 'wg2', 'we2']) } as Command);
    state = run(engine, { type: 'addFeature', feature: { id: 'ventCut', name: 'ventCut', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'ventSketch', regions: [{ outerLoop: copyRegion(1) }, { outerLoop: copyRegion(3) }] }, extent: { type: 'distance', start: 0, distance: 'T' }, operation: 'cut', targets: ['lid'] } } as unknown as Command);
    console.log('H1 row B: not ok', allOk(state), 'wo2', JSON.stringify(resultOf(state, 'ventSketch').points.wo2), 'lid', volume(state, 'lid'), 'by hand', lidByHand(84) - 7 * SLOT * 2);

    // step 6: the rectangular notch of the floor, three lines across the bottom side of its own outline
    const b = 'baseSk';
    const bottom = floor[4]; // the own curve over fl1, the fifth of the outline as it was named (fa1..fa4, fl1..fl4)
    console.log('H2 bottom', bottom, JSON.stringify(sketchOf(state, b).curves[bottom]), JSON.stringify(resultOf(state, b).points[(sketchOf(state, b).curves[bottom] as { a: Id }).a]));
    state = run(
      engine,
      pt(b, 'u1', -6.4, -15.2),
      pt(b, 'sa', -6.6, -23.1),
      pt(b, 'u2', 6.6, -14.9),
      pt(b, 'sc', 6.4, -22.8),
      ln(b, 'ua', 'sa', 'u1'),
      ln(b, 'ub', 'u1', 'u2'),
      ln(b, 'uc', 'u2', 'sc'),
      constrain(b, 'uav', { type: 'vertical', line: 'ua' }),
      constrain(b, 'ubh', { type: 'horizontal', line: 'ub' }),
      constrain(b, 'ucv', { type: 'vertical', line: 'uc' }),
      dim(b, 'ux', 'horizontalDistance', 'u1', 'origin', 'slotW / 2 + clearance + wall'),
      dim(b, 'uw', 'horizontalDistance', 'u1', 'u2', 'slotW + 2 * (clearance + wall)'),
      off(b, 'ud', 'u1', bottom, 'slotD'),
      off(b, 'say', 'sa', bottom, '3'),
      off(b, 'scy', 'sc', bottom, '3'),
    );
    console.log('H2 drawn: base', state.evaluation.features.base.status, state.evaluation.features.base.error?.code, 'dof', engine.diagnoseSketch(b).degreesOfFreedom);
    const first = cut(engine, 'trim', b, { curve: bottom, at: [0, -20] }, 's1_');
    cut(engine, 'trim', b, { at: [-6.5, -21.5] }, 's2_');
    cut(engine, 'trim', b, { at: [6.5, -21.5] }, 's3_');
    state = engine.getState();
    console.log('H2 notched: not ok', allOk(state), 'patched', JSON.stringify(first.patched), 'baseSk dof', engine.diagnoseSketch(b).degreesOfFreedom, 'redundant', engine.diagnoseSketch(b).redundant.length, 'regions', loopsOf(state, b).map((l) => l.length), 'base', volume(state, 'base'), 'by hand', baseByHand(60) - 8 * 5 * 2);

    // the round notch in the top line of the lid's source half; the mirror copies it
    run(engine, pt(s, 'nc', 20, 27), { type: 'addCurve', sketch: s, id: 'nk', curve: { type: 'circle', center: 'nc' }, radius: 4 } as Command, constrain(s, 'nkc', { type: 'pointOnCurve', point: 'nc', curve: 'c3' }), dim(s, 'nkx', 'horizontalDistance', 'origin', 'nc', 20), constrain(s, 'nkd', { type: 'diameter', curve: 'nk', value: 'cableD', driving: true } as never));
    const one = cut(engine, 'trim', s, { curve: 'nk', at: [20, 31] }, 'n1_');
    const two = cut(engine, 'trim', s, { at: [20, 27] }, 'n2_');
    state = engine.getState();
    const lidRegion = (state.document.features.find((f) => f.id === 'lid') as unknown as { profile: { regions: { outerLoop: Id[] }[] } }).profile.regions;
    console.log('H3 lid notch: not ok', allOk(state), 'dropped', JSON.stringify([one.dropped, two.dropped]), 'lid regions', lidRegion.length, 'loop has', ['c2', 'm/1/c2', 'nk', 'm/1/nk'].map((c) => lidRegion[0].outerLoop.includes(c)), 'lid', volume(state, 'lid'), 'by hand', lidByHand(84) - 7 * SLOT * 2 - Math.PI * 16 * 2, 'dof', engine.diagnoseSketch(s).degreesOfFreedom);

    // step 7: the vents
    const before = state;
    const seven = set(engine, 'vents', '7');
    console.log('H4 vents 7: not ok', allOk(seven), 'lid', volume(seven, 'lid') - volume(before, 'lid'), 'by hand', -2 * SLOT * 2);
    const three = engine.preview({ type: 'setParameter', name: 'vents', expr: '3' });
    console.log('H4 vents 3:', three.ok ? JSON.stringify([three.state.evaluation.features.ventCut.error?.code, three.state.evaluation.features.ventCut.error?.refs]) : three.error.message);
    state = set(engine, 'vents', '5');
    console.log('H4 vents 5: not ok', allOk(state), 'lid back', volume(state, 'lid') - volume(before, 'lid'));

    // step 7: the revised file of the board, 2 mm wider
    const entry = sketchOf(state, 'board').external.pcbo as unknown as { curves: object };
    const t0 = performance.now();
    const wider = run(engine, { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { ...entry, curves: boardFile(62).curves } } as unknown as Command);
    console.log('H5 the revised file:', (performance.now() - t0).toFixed(0), 'ms; not ok', allOk(wider), 'pcb', volume(wider, 'pcb') - volume(state, 'pcb'), 'base', volume(wider, 'base') - volume(state, 'base'), 'by hand', baseByHand(62) - baseByHand(60), 'lid', volume(wider, 'lid') - volume(state, 'lid'), 'by hand', 2 * 54 * 2);
    console.log('H5 frame', resultOf(wider, 'frame').measurements.m1, resultOf(wider, 'frame').measurements.m2, 'dof', ['baseSk', 'lidSketch'].map((id) => engine.diagnoseSketch(id).degreesOfFreedom), 'redundant', ['baseSk', 'lidSketch'].map((id) => engine.diagnoseSketch(id).redundant.length), 'features', wider.document.features.length);
    // the section of the lid as DXF, read back: the same area
    const { text, about } = dxfOf(engine, 'lid', 7);
    const read = importOutline(text);
    const back = newEngine();
    const again = run(back, addSketch('lidBack', XY), addOutline('lidBack', 'o', outlineEntry(read.curves)));
    const regions = resultOf(again, 'lidBack').regions;
    const outer = regions.reduce((best, r) => (r.loops.length > best.loops.length ? r : best), regions[0]);
    const withHoles = outer.loops.reduce((part, loop, i) => part + (i === 0 ? 1 : -1) * Math.abs(loopArea(loop)), 0);
    console.log('H5 lid section:', about.loops, 'loops', about.circles, 'circles, area', about.area, '; read back', JSON.stringify(read.report.byKind), 'welded', read.report.welded, 'regions', regions.length, 'valid', resultOf(again, 'lidBack').valid, 'the lid region with its holes', withHoles, 'difference', withHoles - about.area, 'the lid', volume(wider, 'lid') / 2, 'all regions', regionArea(again, 'lidBack'));
  });
});
