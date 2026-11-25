// Probe A: the engine's own DXF (D54) read back as an outline. Rows A1 to A4 of design.md.
import { describe, expect, it } from 'vitest';
import type { Command, Id, SketchResult } from '../../../../packages/engine/src/index';
import { standInBoard } from '../../../../packages/scenarios/test/board-kit';
import { XY, addSketch, batch, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, boardDxf, dxfOf, loopArea, regionArea, resultOf } from './kit';
import { importOutline, installOutlineKind, outlineEntry } from './proto';

installOutlineKind();

describe('A: the writer of D54 read back', () => {
  it('A1: the section of the stand-in board: one outline with four holes', () => {
    const engine = newEngine();
    standInBoard(engine);
    const { text, about } = dxfOf(engine, 'pcb', 0.8);
    const t0 = performance.now();
    const { curves, report } = importOutline(text);
    const read = performance.now() - t0;
    console.log('A1 file', text.length, 'chars; about', about.loops, 'loops', about.circles, 'circles, area', about.area);
    console.log('A1 report', JSON.stringify(report));
    console.log('A1 read ms', read.toFixed(2));
    const state = run(engine, addSketch('back', XY), addOutline('back', 'o', outlineEntry(curves)));
    const result = resultOf(state, 'back');
    console.log('A1 status', state.evaluation.features.back.status, 'valid', result.valid, 'regions', result.regions.length, 'holes', result.regions.map((r) => r.loops.length - 1), 'openEnds', JSON.stringify(result.openEnds));
    const first = result.regions.find((r) => r.loops.length === 5) as SketchResult['regions'][number];
    const withHoles = first.loops.reduce((part, loop, i) => part + (i === 0 ? 1 : -1) * Math.abs(loopArea(loop)), 0);
    console.log('A1 the region with its holes', withHoles, 'against the section', about.area, 'difference', withHoles - about.area, 'by hand', 60 * 40 - (4 - Math.PI) * 9 - 4 * Math.PI * 1.6 * 1.6);
    console.log('A1 outer loop', JSON.stringify(result.regions[0]?.ref));
    expect(result.valid).toBe(true);
    // extruded: the same volume as the board
    const extruded = run(engine, { type: 'addFeature', feature: { id: 'again', name: 'again', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'back', regions: [result.regions[0].ref] }, extent: { type: 'distance', start: 0, distance: 1.6 }, operation: 'new' } } as Command);
    console.log('A1 extruded', extruded.evaluation.features.again.status, extruded.evaluation.bodies.again?.volume, 'the board', extruded.evaluation.bodies.pcb.volume);
    console.log('A1 faces', extruded.evaluation.bodies.again?.faces.length, JSON.stringify(extruded.evaluation.bodies.again?.faces.slice(0, 4).map((f) => extruded.evaluation.faceNames[f.id])));
  });

  it('A2: a plate with a spline side: the section is a polyline, read back as lines', () => {
    const engine = newEngine();
    const s = 'plate';
    const pts: [Id, number, number][] = [['p1', 0, 0], ['p2', 40, 0], ['p3', 40, 30], ['p4', 0, 30], ['q1', 46, 8], ['q2', 34, 15], ['q3', 46, 22]];
    run(
      engine,
      addSketch(s, XY),
      batch(
        ...pts.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: s, id, x, y })),
        ...pts.map(([id, x, y]): Command => ({ type: 'addConstraint', sketch: s, id: `f${id}`, constraint: { type: 'fixed', point: id, x, y } }) as Command),
        { type: 'addCurve', sketch: s, id: 'a', curve: { type: 'line', a: 'p1', b: 'p2' } },
        { type: 'addCurve', sketch: s, id: 'b', curve: { type: 'spline', points: ['p2', 'q1', 'q2', 'q3', 'p3'] } },
        { type: 'addCurve', sketch: s, id: 'c', curve: { type: 'line', a: 'p3', b: 'p4' } },
        { type: 'addCurve', sketch: s, id: 'd', curve: { type: 'line', a: 'p4', b: 'p1' } },
      ),
    );
    const made = run(engine, { type: 'addFeature', feature: { id: 'body', name: 'body', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: [{ outerLoop: ['a', 'b', 'c', 'd'] }] }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } } as Command);
    const sketchArea = regionArea(made, s);
    const { text, about } = dxfOf(engine, 'body', 1);
    const { curves, report } = importOutline(text);
    console.log('A2 file', text.length, 'chars; section area', about.area, 'the sketch polygon', sketchArea);
    console.log('A2 report', JSON.stringify({ ...report, gaps: report.gaps.length }));
    const t0 = performance.now();
    const state = run(engine, addSketch('back', XY), addOutline('back', 'o', outlineEntry(curves)));
    console.log('A2 addExternal ms', (performance.now() - t0).toFixed(1));
    const result = resultOf(state, 'back');
    console.log('A2 status', state.evaluation.features.back.status, 'valid', result.valid, 'regions', result.regions.length, 'outer loop length', result.regions[0]?.ref.outerLoop.length, 'area', regionArea(state, 'back'), 'difference', regionArea(state, 'back') - about.area);
    console.log('A2 document chars of the entry', JSON.stringify((state.document.features.find((f) => f.id === 'back') as { external: object }).external).length, 'solved.external', JSON.stringify((state.document.features.find((f) => f.id === 'back') as { solved: object }).solved));
    expect(result.valid).toBe(true);
  });

  it('A3: the same file with fewer digits: what the weld closes', () => {
    const engine = newEngine();
    standInBoard(engine);
    // the board as separate LINE and ARC entities, as a PCB tool writes it, with `digits` decimals
    for (const digits of [9, 6, 4, 3, 2]) {
      const text = boardDxf(60, 40, 3, digits, 17);
      for (const tolerance of [1e-6, 1e-3, 1e-2]) {
        const { curves, report } = importOutline(text, { layers: ['Edge.Cuts'], weld: tolerance });
        const e = newEngine();
        const state = run(e, addSketch('b', XY), addOutline('b', 'o', outlineEntry(curves)));
        const result = resultOf(state, 'b');
        console.log(`A3 digits ${digits} weld ${tolerance}: welded ${report.welded} moved ${report.moved.toExponential(2)} open ${report.open} gaps ${report.gaps.length}; valid ${result.valid} regions ${result.regions.length} openEnds ${result.openEnds?.count ?? 0} area ${regionArea(state, 'b').toFixed(6)} first gap ${report.gaps[0]?.distance.toExponential(2) ?? '-'}`);
      }
    }
  });

  it('A4: a point held on an imported arc, a line tangent to it: the fixed arc is exact enough for the solver', () => {
    for (const digits of [9, 4, 3]) {
      for (const turn of [0, 0.3]) {
        const text = boardDxf(60, 40, 3, digits, 17);
        const { curves, report } = importOutline(text, { layers: ['Edge.Cuts'], weld: digits < 4 ? 1e-2 : 1e-3 });
        const e = newEngine();
        run(e, addSketch('b', XY), addOutline('b', 'o', outlineEntry(curves, { anchor: 'center', turn, regions: false })));
        const state = run(
          e,
          batch(
            { type: 'addPoint', sketch: 'b', id: 'p', x: 29, y: 19 },
            { type: 'addPoint', sketch: 'b', id: 'q', x: 40, y: 30 },
            { type: 'addCurve', sketch: 'b', id: 'ln', curve: { type: 'line', a: 'p', b: 'q' } },
            { type: 'addConstraint', sketch: 'b', id: 'on', constraint: { type: 'pointOnCurve', point: 'p', curve: 'o/a1' } },
            { type: 'addConstraint', sketch: 'b', id: 'tg', constraint: { type: 'tangent', a: 'ln', b: 'o/a1' } },
          ) as Command,
        );
        const result = resultOf(state, 'b');
        const arc = (state.document.features.find((f) => f.id === 'b') as unknown as { external: { o: { curves: Record<string, { center: number[]; start: number[]; end: number[] }> } } }).external.o.curves.a1;
        const off = Math.abs(Math.hypot(arc.start[0] - arc.center[0], arc.start[1] - arc.center[1]) - Math.hypot(arc.end[0] - arc.center[0], arc.end[1] - arc.center[1]));
        const [c, s2, en] = [result.points['o/a1/center'], result.points['o/a1/start'], result.points['o/a1/end']];
        const placedOff = Math.abs(Math.hypot(s2.x - c.x, s2.y - c.y) - Math.hypot(en.x - c.x, en.y - c.y));
        console.log(`A4 digits ${digits} turn ${turn}: welded ${report.welded} moved ${report.moved.toExponential(1)}; status ${state.evaluation.features.b.status} ${JSON.stringify(state.evaluation.features.b.warnings.map((w) => w.code))} dof ${result.degreesOfFreedom} redundant ${result.redundant.length}; |rs − re| stored ${off.toExponential(2)} placed ${placedOff.toExponential(2)}`);
      }
    }
  });
});

