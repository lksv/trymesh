// Probe D: an outline next to the packages before it: 6e's tools and query, a mirror of 6c about
// one of its lines, a projection of 6b losing its entity, a spline of 6d, an open outline, a hole.
// Rows D1 to D8 of design.md.
import { describe, it, vi } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchFeature, type SketchToolInputs, freshIds, repairsByDefault, sketchTool } from '../../../../packages/engine/src/index';
import { XY, addSketch, batch, constrain, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, boardDxf, regionArea, resultOf } from './kit';
import { importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const loopsOf = (state: EngineState, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
const toolContext = (state: EngineState, sketch: Id) => ({ sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
function tool<K extends keyof SketchToolInputs>(engine: Engine, name: K, sketch: Id, input: SketchToolInputs[K], prefix: string): string {
  const state = engine.getState();
  const made = sketchTool(name, toolContext(state, sketch), input, freshIds(state.document, prefix));
  if (!made.ok) return `refused: ${made.message}`;
  const after = run(engine, batch(...made.commands));
  return `ok, ${made.commands.length} commands; valid ${resultOf(after, sketch).valid}, regions ${JSON.stringify(loopsOf(after, sketch).map((l) => l.length))}`;
}
const pt = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const ln = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });
const board = (engine: Engine, more: object = {}): EngineState => {
  const { curves } = importOutline(boardDxf(60, 40, 3, 6), { layers: ['Edge.Cuts'] });
  return run(engine, addSketch('board', XY), addOutline('board', 'o', outlineEntry(curves, { anchor: 'center', ...more })));
};
const newBoardWithNotch = (): Engine => {
  const engine = newEngine();
  board(engine);
  run(engine, batch(pt('board', 'n1', 0, -25), pt('board', 'n2', 0, -15), ln('board', 'n', 'n1', 'n2')));
  return engine;
};
const contacts = (engine: Engine, sketch: Id) => {
  const outcome = engine.query('sketchContacts', { sketch });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};

describe('D: an outline and the packages before it', () => {
  it('D1: an own line across an outline that forms regions: the query, split, and the flag off', () => {
    const engine = newEngine();
    board(engine);
    // l1 is the bottom side (y = −20): a notch line across it
    let state = run(engine, batch(pt('board', 'n1', 0, -25), pt('board', 'n2', 0, -15), ln('board', 'n', 'n1', 'n2')));
    console.log('D1 valid', resultOf(state, 'board').valid, 'regions', loopsOf(state, 'board').length);
    const found = contacts(engine, 'board');
    console.log('D1 contacts', JSON.stringify(found.contacts.map((c) => ({ curves: c.curves, kind: c.kind, fix: c.fix, why: c.why }))), 'reason', found.reason);
    console.log('D1 split:', tool(engine, 'split', 'board', {}, 's'));
    // a trim by a place takes the whole own line: nothing bounds it (the contact with the outline is no cut)
    console.log('D1 trim of the own line by a place:', tool(newBoardWithNotch(), 'trim', 'board', { at: [0, -23] }, 't'));
    // the flag off: the own line is then free to cross, and a trim with the outline line as `with` cuts it
    const entry = sketchOf(state, 'board').external.o;
    state = run(engine, { type: 'updateExternal', sketch: 'board', id: 'o', ref: { ...entry, regions: false } } as unknown as Command);
    console.log('D1 flag off: valid', resultOf(state, 'board').valid, 'regions', loopsOf(state, 'board').length, 'contacts', contacts(engine, 'board').total);
    console.log('D1 trim with o/l1:', tool(engine, 'trim', 'board', { curve: 'n', at: [0, -23], with: 'o/l1' } as never, 'u'), JSON.stringify(sketchOf(engine.getState(), 'board').constraints));
    console.log('D1 extend of the own line to o/l3:', tool(engine, 'extend', 'board', { curve: 'n', end: 'b', with: 'o/l3' } as never, 'v'), 'n.b at', JSON.stringify(resultOf(engine.getState(), 'board').points[(sketchOf(engine.getState(), 'board').curves.n as { b: Id }).b]));
    // an update without the curves: what the engine says today
    const short = engine.preview({ type: 'updateExternal', sketch: 'board', id: 'o', ref: { type: 'outline', regions: true } } as unknown as Command);
    console.log('D1 an update without `curves`:', short.ok ? 'accepted' : short.error.message);
  });

  it('D2: an own chain that ends on the ends of an outline side, in the outline sketch', () => {
    const engine = newEngine();
    const { curves } = importOutline(boardDxf(60, 40, 3, 6), { layers: ['Edge.Cuts'] });
    // the outline without its bottom side: an own notched side takes its place
    const { l1: side, ...rest } = curves;
    run(engine, addSketch('board', XY), addOutline('board', 'o', outlineEntry(rest, { x: -130, y: -100 })));
    let state = engine.getState();
    console.log('D2 open: valid', resultOf(state, 'board').valid, 'regions', loopsOf(state, 'board').map((l) => l.length), 'openEnds', JSON.stringify(resultOf(state, 'board').openEnds));
    void side;
    // own points on the two open ends, a notch between them
    state = run(
      engine,
      batch(
        pt('board', 'e1', -27, -20),
        pt('board', 'e2', 27, -20),
        pt('board', 'm1', -5, -20),
        pt('board', 'm2', -5, -14),
        pt('board', 'm3', 5, -14),
        pt('board', 'm4', 5, -20),
        constrain('board', 'k1', { type: 'coincident', a: 'e1', b: 'o/a4/end' }),
        constrain('board', 'k2', { type: 'coincident', a: 'e2', b: 'o/a1/start' }),
        ln('board', 'b1', 'e1', 'm1'),
        ln('board', 'b2', 'm1', 'm2'),
        ln('board', 'b3', 'm2', 'm3'),
        ln('board', 'b4', 'm3', 'm4'),
        ln('board', 'b5', 'm4', 'e2'),
      ),
    );
    console.log('D2 closed by own lines: valid', resultOf(state, 'board').valid, 'regions', JSON.stringify(loopsOf(state, 'board').filter((l) => l.length > 1)), 'openEnds', resultOf(state, 'board').openEnds?.count ?? 0, 'area', regionArea(state, 'board').toFixed(3), 'by hand', (2400 - (4 - Math.PI) * 9 - 60).toFixed(3));
    const found = contacts(engine, 'board');
    console.log('D2 contacts', found.contacts.length, 'reason', found.reason);
  });

  it('D3: a mirror of 6c about a line of the outline; a pattern of the outline itself is refused', () => {
    const engine = newEngine();
    board(engine, { regions: false });
    const state = run(
      engine,
      batch(pt('board', 'q1', 30, -5), pt('board', 'q2', 40, 0), pt('board', 'q3', 30, 5), ln('board', 'g1', 'q1', 'q2'), ln('board', 'g2', 'q2', 'q3'), constrain('board', 'h1', { type: 'pointOnCurve', point: 'q1', curve: 'o/l2' }), constrain('board', 'h2', { type: 'pointOnCurve', point: 'q3', curve: 'o/l2' })),
      { type: 'addExternal', sketch: 'board', id: 'm', ref: { type: 'pattern', sources: ['g1', 'g2'], transform: { type: 'mirror', axis: 'o/l2' } } } as Command,
    );
    console.log('D3 mirror about o/l2:', state.evaluation.features.board.status, 'regions', JSON.stringify(loopsOf(state, 'board')), 'copy q2', JSON.stringify(resultOf(state, 'board').points['m/1/q2']));
    const refused = engine.execute({ type: 'addExternal', sketch: 'board', id: 'm2', ref: { type: 'pattern', sources: ['o/c1'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
    console.log('D3 a pattern of an outline curve:', refused.ok ? 'accepted' : refused.error.message);
  });

  it('D4: a later sketch projects entities of the outline; a revised file without one of them; repairsByDefault', () => {
    const engine = newEngine();
    board(engine);
    const add = (id: Id, entity: Id, kind: string, regions = false): Command => ({ type: 'addExternal', sketch: 'later', id, ref: { type: 'sketch', sketch: 'board', entity, kind, regions } }) as Command;
    let state = run(engine, addSketch('later', XY), add('x1', 'o/c4', 'circle', true), add('x2', 'o/l1/a', 'point'), add('x3', 'o/a1', 'arc'));
    console.log('D4 projected', state.evaluation.features.later.status, JSON.stringify(resultOf(state, 'later').points['x2']), 'regions', JSON.stringify(loopsOf(state, 'later')), 'repairsByDefault of board', repairsByDefault(state.document, 'board'));
    const entry = sketchOf(state, 'board').external.o as unknown as { curves: Record<string, object> };
    const { c4: _gone, ...fewer } = entry.curves;
    state = run(engine, { type: 'updateExternal', sketch: 'board', id: 'o', ref: { ...entry, curves: fewer } } as unknown as Command);
    console.log('D4 without c4: later', state.evaluation.features.later.status, JSON.stringify(state.evaluation.features.later.warnings.map((w) => w.message)), 'x1 kept', JSON.stringify(resultOf(state, 'later').points['x1/center']));
    const spline = engine.preview({ type: 'addExternal', sketch: 'later', id: 'x9', ref: { type: 'sketch', sketch: 'board', entity: 'o/nothing', kind: 'line', regions: false } } as Command);
    console.log('D4 an entity the outline lacks:', spline.ok ? 'accepted' : spline.error.message);
  });

  it('D5: a DXF with SPLINE entities: a closed shape of a line and a cubic spline of three spans, extruded; its projection', () => {
    const lines: string[] = [];
    const g = (code: number, value: string | number): void => void lines.push(String(code), String(value));
    g(0, 'SECTION');
    g(2, 'HEADER');
    g(9, '$INSUNITS');
    g(70, 1); // inches
    g(0, 'ENDSEC');
    g(0, 'SECTION');
    g(2, 'ENTITIES');
    g(0, 'LINE');
    g(8, '0');
    g(10, 0);
    g(20, 0);
    g(11, 4);
    g(21, 0);
    const control: [number, number][] = [[4, 0], [5, 1], [3, 2], [2, 3], [1, 2], [0, 0]];
    const knots = [0, 0, 0, 0, 1, 2, 3, 3, 3, 3];
    g(0, 'SPLINE');
    g(8, '0');
    g(70, 8);
    g(71, 3);
    g(72, knots.length);
    g(73, control.length);
    for (const k of knots) g(40, k);
    for (const [x, y] of control) {
      g(10, x);
      g(20, y);
      g(30, 0);
    }
    // a rational one and an ellipse, to be listed
    g(0, 'SPLINE');
    g(8, '0');
    g(70, 12);
    g(71, 2);
    g(0, 'ELLIPSE');
    g(8, '0');
    g(0, 'ENDSEC');
    g(0, 'EOF');
    const { curves, report } = importOutline(lines.join('\n'));
    console.log('D5 report', JSON.stringify({ byKind: report.byKind, unit: report.about.unit, skipped: report.about.skipped, bounds: report.bounds, open: report.open }));
    console.log('D5 s1', JSON.stringify(curves.s1), 'keys', Object.keys(curves).join(' '));
    const engine = newEngine();
    let state = run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)));
    const result = resultOf(state, 's');
    console.log('D5 sketch', state.evaluation.features.s.status, 'valid', result.valid, 'regions', JSON.stringify(loopsOf(state, 's')), 'area mm²', regionArea(state, 's').toFixed(3), 'shape of o/s1', JSON.stringify(result.curves['o/s1']?.shape));
    state = run(engine, { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [result.regions[0].ref] }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } } as Command);
    console.log('D5 extruded', state.evaluation.features.e.status, state.evaluation.bodies.e?.volume.toFixed(2), 'faces', state.evaluation.bodies.e?.faces.map((f) => JSON.stringify(state.evaluation.faceNames[f.id])).join(' '));
    const projected = engine.preview({ type: 'addExternal', sketch: 's2', id: 'x', ref: { type: 'sketch', sketch: 's', entity: 'o/s1', kind: 'line', regions: false } } as Command);
    run(engine, addSketch('s2', XY));
    const again = engine.preview({ type: 'addExternal', sketch: 's2', id: 'x', ref: { type: 'sketch', sketch: 's', entity: 'o/s1', kind: 'line', regions: false } } as Command);
    console.log('D5 a projection of the spline:', projected.ok ? 'accepted' : projected.error.message, '|', again.ok ? 'accepted' : again.error.message);
    console.log('D5 the whole sketch projected:', tool(engine, 'projectSketch', 's2', { sketch: 's' }, 'w'));
    const own = engine.preview({ type: 'addConstraint', sketch: 's', id: 'k', constraint: { type: 'pointOnCurve', point: 'origin', curve: 'o/s1' } } as Command);
    console.log('D5 a point on the spline of the outline:', own.ok ? 'accepted' : own.error.message);
  });

  it('D6: a hole feature at the centre of an imported circle; an axis on a line of the outline', () => {
    const engine = newEngine();
    board(engine);
    run(engine, { type: 'addFeature', feature: { id: 'pcb', name: 'pcb', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'board', regions: [{ outerLoop: ['a1', 'a2', 'a3', 'a4', 'l1', 'l2', 'l3', 'l4'].map((c) => `o/${c}`) }] }, extent: { type: 'distance', start: 0, distance: 1.6 }, operation: 'new' } } as Command);
    const hole = engine.preview({ type: 'addFeature', feature: { id: 'h', name: 'h', suppressed: false, type: 'hole', sketch: 'board', points: ['o/c1/center'], shape: { type: 'plain', diameter: 2 }, extent: { type: 'throughAll' }, targets: ['pcb'] } } as unknown as Command);
    console.log('D6 a hole at o/c1/center:', hole.ok ? 'accepted' : hole.error.message);
    const cut = engine.preview({ type: 'addFeature', feature: { id: 'c', name: 'c', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'board', regions: [{ outerLoop: ['o/c1'] }] }, extent: { type: 'distance', start: 0, distance: 1.6 }, operation: 'cut', targets: ['pcb'] } } as Command);
    console.log('D6 the disc of o/c1 cut again:', cut.ok ? cut.state.evaluation.features.c.status : cut.error.message);
  });

  it('D7: an outline that does not close: what the result says', () => {
    const engine = newEngine();
    const { curves, report } = importOutline(boardDxf(60, 40, 3, 2, 17), { layers: ['Edge.Cuts'], weld: 1e-3 });
    const state = run(engine, addSketch('b', XY), addOutline('b', 'o', outlineEntry(curves)));
    const open = resultOf(state, 'b').openEnds;
    console.log('D7 report gaps', report.gaps.length, 'nearest', report.gaps[0]?.distance, 'open', report.open, '; openEnds', open?.count, JSON.stringify(open?.ends[0]));
  });

  it('D8: the same outline in two entries of one sketch, and two outlines side by side', () => {
    const engine = newEngine();
    const { curves } = importOutline(boardDxf(60, 40, 3, 6), { layers: ['Edge.Cuts'] });
    let state = run(engine, addSketch('b', XY), addOutline('b', 'o', outlineEntry(curves)), addOutline('b', 'p', outlineEntry(curves, { x: 70 })));
    console.log('D8 side by side: valid', resultOf(state, 'b').valid, 'regions', loopsOf(state, 'b').length);
    state = run(engine, { type: 'setField', feature: 'b', path: 'external/p/x', value: 0 } as unknown as Command);
    const found = contacts(engine, 'b');
    console.log('D8 on each other: valid', resultOf(state, 'b').valid, 'regions', loopsOf(state, 'b').length, 'lying', found.lying.length, 'contacts', found.total, 'reason', found.reason);
  });
});
