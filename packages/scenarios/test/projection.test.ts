// The projection from another sketch (D69) with the real solver and kernel: the chain of sketches
// that follow one another, the joins by position of projections that form regions, the side faces
// they name, a source that is lost, tilted, in conflict, or has no extent, a projection of
// a projection and of a copy, and updateExternal over a frozen projection. The pure functions are
// tested in packages/engine/test/projection.test.ts; scenario 15's part is in scenario15.test.ts.
import { describe, expect, it } from 'vitest';
import { type Command, type Engine, type EngineState, type Id, type SketchFeature, type SketchProjection, type SketchResult, type SketchToolInputs, freshIds, repairsByDefault, sketchTool } from '@trymesh/engine';
import { point, standInBoard } from './board-kit';
import { XY, addExtrude, addSketch, cap, constrain, dimension, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
const regionsOf = (state: EngineState, id: Id): Id[][] => resultOf(state, id).regions.map((region) => region.ref.outerLoop);
const warningsOf = (state: EngineState, id: Id): string[] => state.evaluation.features[id].warnings.map((w) => `${w.code}: ${w.message}`);
const project = (sketch: Id, id: Id, source: Id, entity: Id, kind: SketchProjection['kind'], regions?: boolean): Command =>
  ({ type: 'addExternal', sketch, id, ref: { type: 'sketch', sketch: source, entity, kind, ...(regions === undefined ? {} : { regions }) } }) as Command;
const plane = (id: Id, offset: number, tilt?: { axis: 'X' | 'Y'; angle: number }): Command =>
  ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset, ...(tilt ? { tilt: { axis: { kind: 'base', axis: tilt.axis }, angle: tilt.angle } } : {}) } }) as Command;
const onPlane = (feature: Id) => ({ kind: 'plane', feature }) as const;
const line = (s: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch: s, id, curve: { ...(construction ? { construction: true } : {}), type: 'line', a, b } });
const arc = (s: Id, id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'arc', center, start, end } });
const fixed = (s: Id, id: Id, p: Id, x: number, y: number): Command => constrain(s, id, { type: 'fixed', point: p, x, y });
const at = (state: EngineState, s: Id, p: Id): [number, number] => [resultOf(state, s).points[p].x, resultOf(state, s).points[p].y];
const near = (a: [number, number], b: [number, number], digits = 9): void => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

// The board, `frame` on a plane 5 below it projecting the outline and the holes without the flag,
// `rimSk` on the same plane projecting the outline of `frame` with the flag.
const RIM = ['ra0', 'ra1', 'ra2', 'ra3', 'rl0', 'rl1', 'rl2', 'rl3'];
function chain(engine: Engine): EngineState {
  standInBoard(engine);
  run(engine, plane('framePl', -5), addSketch('frame', onPlane('framePl')));
  run(engine, ...[0, 1, 2, 3].flatMap((i) => [project('frame', `fa${i}`, 'board', `ba${i}`, 'arc'), project('frame', `fl${i}`, 'board', `bl${i}`, 'line'), project('frame', `fh${i}`, 'board', `bh${i}`, 'circle')]));
  run(engine, constrain('frame', 'm1', { type: 'distancePointLine', point: 'fh0/center', line: 'origin/y', value: 1, driving: false }));
  return run(engine, addSketch('rimSk', onPlane('framePl')), ...[0, 1, 2, 3].flatMap((i) => [project('rimSk', `ra${i}`, 'frame', `fa${i}`, 'arc', true), project('rimSk', `rl${i}`, 'frame', `fl${i}`, 'line', true)]));
}

describe('a chain of projections follows its source (D69)', () => {
  it('the skeleton has no region; the rim projected with the flag is one region named by the entries, joined by position; its side faces are named by the entries', () => {
    const engine = newEngine();
    let state = chain(engine);
    expect(status(state)).toMatchObject({ board: 'ok', frame: 'ok', rimSk: 'ok' });
    expect(regionsOf(state, 'frame')).toEqual([]);
    expect(resultOf(state, 'frame').measurements.m1).toBeCloseTo(26.5, 9);
    expect(resultOf(state, 'frame').curves.fa0).toMatchObject({ source: 'reference', regions: false, shape: { type: 'arc' } });
    expect(Object.keys(sketchOf(state, 'frame').solved.external.fa0).sort()).toEqual(['center', 'end', 'kind', 'start']);
    expect(regionsOf(state, 'rimSk')).toEqual([RIM]);
    expect(resultOf(state, 'rimSk').valid).toBe(true);
    expect(resultOf(state, 'rimSk').openEnds).toBeUndefined();
    state = run(engine, addExtrude('rim', 'rimSk', [RIM], 4));
    expect(status(state).rim).toBe('ok');
    const faces = state.evaluation.bodies.rim.faces.map((f) => state.evaluation.faceNames[f.id]);
    expect(faces).toContainEqual(side('rim', 'ra0'));
    expect(faces).toContainEqual(side('rim', 'rl2'));
    const before = volume(state.evaluation.bodies.rim.solid);
    // the board 2 mm wider: everything follows, the stamps change
    const stamp = sketchOf(state, 'rimSk').solved.inputs;
    state = run(engine, { type: 'setParameter', name: 'boardW', expr: '62' });
    expect(status(state)).toMatchObject({ board: 'ok', frame: 'ok', rimSk: 'ok', rim: 'ok' });
    expect(sketchOf(state, 'rimSk').solved.inputs).not.toBe(stamp);
    expect(resultOf(state, 'frame').measurements.m1).toBeCloseTo(27.5, 9);
    expect(volume(state.evaluation.bodies.rim.solid) - before).toBeCloseTo(2 * 40 * 4, 6);
  });

  it('without the flag a projected outline bounds nothing', () => {
    const engine = newEngine();
    chain(engine);
    const state = run(engine, addSketch('plain', onPlane('framePl')), ...[0, 1, 2, 3].flatMap((i) => [project('plain', `pa${i}`, 'frame', `fa${i}`, 'arc'), project('plain', `pl${i}`, 'frame', `fl${i}`, 'line')]));
    expect(regionsOf(state, 'plain')).toEqual([]);
    expect(resultOf(state, 'plain').valid).toBe(true);
  });

  it('a sketch on the other side (normal −Z, its x along −X) gets the arcs counter-clockwise, their ends swapped', () => {
    const engine = newEngine();
    standInBoard(engine);
    const state = run(engine, addSketch('under', onFace('pcb', cap('pcb', 'startCap'))), project('under', 'u0', 'board', 'ba0', 'arc'), project('under', 'u1', 'board', 'bh0', 'circle'));
    near(at(state, 'under', 'u0/center'), [-27, 17]);
    near(at(state, 'under', 'u0/start'), [-at(state, 'board', 'be0')[0], at(state, 'board', 'be0')[1]]);
    near(at(state, 'under', 'u0/end'), [-at(state, 'board', 'bs0')[0], at(state, 'board', 'bs0')[1]]);
    near(at(state, 'under', 'u1/center'), [-26.5, 16.5]);
    expect(resultOf(state, 'under').radii.u1).toBeCloseTo(1.6, 12);
  });

  it('a projection of a projection, of a point, of the origin and of a centre', () => {
    const engine = newEngine();
    chain(engine);
    const state = run(engine, plane('p2', 3), addSketch('pts', onPlane('p2')), project('pts', 'hp', 'frame', 'fh0/center', 'point'), project('pts', 'op', 'frame', 'origin', 'point'), project('pts', 'ep', 'rimSk', 'ra0/end', 'point'));
    expect(status(state).pts).toBe('ok');
    near(at(state, 'pts', 'hp'), [26.5, 16.5]);
    near(at(state, 'pts', 'op'), [0, 0]);
    near(at(state, 'pts', 'ep'), at(state, 'board', 'be0'));
    expect(resultOf(state, 'pts').curves).toEqual({});
  });
});

describe('joins by position of projections that form regions (D69)', () => {
  it('two routes to one corner: an outline from two sketches closes', () => {
    const engine = newEngine();
    chain(engine);
    const state = run(engine, addSketch('two', onPlane('framePl')), ...[0, 1, 2, 3].flatMap((i) => [project('two', `ta${i}`, 'frame', `fa${i}`, 'arc', true), i === 0 ? project('two', 'tl0', 'board', 'bl0', 'line', true) : project('two', `tl${i}`, 'frame', `fl${i}`, 'line', true)]));
    expect(resultOf(state, 'two').valid).toBe(true);
    expect(regionsOf(state, 'two')).toEqual([['ta0', 'ta1', 'ta2', 'ta3', 'tl0', 'tl1', 'tl2', 'tl3']]);
    expect(resultOf(state, 'two').redundant).toEqual([]);
  });

  it('a source made of projected edges of a body, projected again with the flag, closes', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 20, 10), addExtrude('E1', 'S1', [rectLoop('r')], 5));
    const edges = rectLoop('r').map((l, i): Command => ({ type: 'addExternal', sketch: 'top', id: `e${i}`, ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', l) }, kind: 'line' } }) as Command);
    run(engine, addSketch('top', onFace('E1', cap('E1'))), ...edges);
    const state = run(engine, plane('above', 12), addSketch('again', onPlane('above')), ...[0, 1, 2, 3].map((i) => project('again', `g${i}`, 'top', `e${i}`, 'line', true)), addExtrude('pad', 'again', [['g0', 'g1', 'g2', 'g3']], 2));
    expect(regionsOf(state, 'again')).toEqual([['g0', 'g1', 'g2', 'g3']]);
    expect(status(state).pad).toBe('ok');
    expect(volume(state.evaluation.bodies.pad.solid)).toBeCloseTo(400, 3);
  });

  it('copies of construction curves of a mirror, projected with the flag, close with the projections of their sources', () => {
    const engine = newEngine();
    const h = 'half';
    run(
      engine,
      addSketch(h, XY),
      point(h, 'a', 0, -5),
      point(h, 'b', 10, -5),
      point(h, 'c', 10, 5),
      point(h, 'd', 0, 5),
      line(h, 'h1', 'a', 'b', true),
      line(h, 'h2', 'b', 'c', true),
      line(h, 'h3', 'c', 'd', true),
      fixed(h, 'fa', 'a', 0, -5),
      fixed(h, 'fb', 'b', 10, -5),
      fixed(h, 'fc', 'c', 10, 5),
      fixed(h, 'fd', 'd', 0, 5),
      { type: 'addExternal', sketch: h, id: 'm', ref: { type: 'pattern', sources: ['h1', 'h2', 'h3'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command,
    );
    expect(regionsOf(engine.getState(), h)).toEqual([]);
    const ids = ['h1', 'h2', 'h3', 'm/1/h1', 'm/1/h2', 'm/1/h3'];
    const state = run(engine, plane('up', 4), addSketch('whole', onPlane('up')), ...ids.map((id, i) => project('whole', `w${i}`, h, id, 'line', true)));
    expect(regionsOf(state, 'whole')).toEqual([['w0', 'w1', 'w2', 'w3', 'w4', 'w5']]);
  });

  it('an own end at the end of a flagged projection is its vertex, by a coincident or by position; two own vertices there join neither', () => {
    const engine = newEngine();
    run(engine, addSketch('edgeSk', XY), point('edgeSk', 'a', 0, 60), point('edgeSk', 'b', 20, 60), line('edgeSk', 's1', 'a', 'b'), fixed('edgeSk', 'fa', 'a', 0, 60), fixed('edgeSk', 'fb', 'b', 20, 60));
    let state = run(
      engine,
      addSketch('loopSk', XY),
      project('loopSk', 'x', 'edgeSk', 's1', 'line', true),
      point('loopSk', 'u1', 0, 60),
      point('loopSk', 'u2', 20, 60),
      point('loopSk', 'u3', 10, 72),
      line('loopSk', 'n1', 'u1', 'u3'),
      line('loopSk', 'n2', 'u3', 'u2'),
      fixed('loopSk', 'f1', 'u1', 0, 60),
      constrain('loopSk', 'k2', { type: 'coincident', a: 'u2', b: 'x/b' }),
      fixed('loopSk', 'f3', 'u3', 10, 72),
    );
    expect(regionsOf(state, 'loopSk')).toEqual([['n1', 'n2', 'x']]);
    state = run(engine, point('loopSk', 'u4', 0, 60), point('loopSk', 'u5', -5, 68), line('loopSk', 'n3', 'u4', 'u5'), fixed('loopSk', 'f4', 'u4', 0, 60), fixed('loopSk', 'f5', 'u5', -5, 68));
    expect(resultOf(state, 'loopSk').valid).toBe(false);
    expect(resultOf(state, 'loopSk').openEnds?.ends[0]).toMatchObject({ end: 'x/a', reason: 'twoVertices', near: ['u1', 'u4'] });
  });

  it('an own curve over a flagged projection, and two flagged projections on each other, leave the profile invalid', () => {
    const engine = newEngine();
    chain(engine);
    let state = run(engine, addSketch('over', onPlane('framePl')), ...[0, 1, 2, 3].flatMap((i) => [project('over', `oa${i}`, 'frame', `fa${i}`, 'arc', true), project('over', `ol${i}`, 'frame', `fl${i}`, 'line', true)]));
    expect(resultOf(state, 'over').valid).toBe(true);
    state = run(engine, project('over', 'twin', 'board', 'bl0', 'line', true));
    expect(resultOf(state, 'over').valid).toBe(false);
    run(engine, { type: 'removeExternal', sketch: 'over', id: 'twin' });
    const [a, b] = [at(engine.getState(), 'over', 'ol0/a'), at(engine.getState(), 'over', 'ol0/b')];
    state = run(engine, point('over', 'q1', a[0], a[1]), point('over', 'q2', b[0], b[1]), line('over', 'own', 'q1', 'q2'), constrain('over', 'k1', { type: 'coincident', a: 'q1', b: 'ol0/a' }), constrain('over', 'k2', { type: 'coincident', a: 'q2', b: 'ol0/b' }));
    expect(resultOf(state, 'over').valid).toBe(false);
  });
});

describe('when the source changes (D69)', () => {
  it('a removed hole freezes its projection at its place with the detail, the constraint on it acting; the flag switched keeps the value', () => {
    const engine = newEngine();
    chain(engine);
    let state = run(engine, addSketch('standSk', onPlane('framePl')), project('standSk', 'sh3', 'frame', 'fh3', 'circle', true), point('standSk', 'sc', -26, -16), { type: 'addCurve', sketch: 'standSk', id: 'so', curve: { type: 'circle', center: 'sc' }, radius: 3 }, constrain('standSk', 'k', { type: 'coincident', a: 'sc', b: 'sh3/center' }));
    const before = { center: at(state, 'frame', 'fh3/center'), radius: resultOf(state, 'frame').radii.fh3 };
    state = run(engine, { type: 'removeEntity', sketch: 'board', id: 'bh3' });
    expect(warningsOf(state, 'frame')).toEqual(['brokenProjection: The projected geometry is no longer in its source; it keeps its last valid place. (board has no circle bh3)']);
    near(at(state, 'frame', 'fh3/center'), before.center, 12);
    expect(resultOf(state, 'frame').radii.fh3).toBe(before.radius);
    // the chain below follows the frozen circle, with no warning of its own
    expect(status(state).standSk).toBe('ok');
    near(at(state, 'standSk', 'sc'), before.center, 9);
    // the flag switched on the frozen projection: its value is kept, its gone source not checked
    const stored = sketchOf(state, 'frame').solved.external.fh3;
    state = run(engine, { type: 'updateExternal', sketch: 'frame', id: 'fh3', ref: { type: 'sketch', sketch: 'board', entity: 'bh3', kind: 'circle', regions: true } } as Command);
    expect(sketchOf(state, 'frame').solved.external.fh3).toEqual(stored);
    expect(resultOf(state, 'frame').curves.fh3).toMatchObject({ regions: true });
    expect(regionsOf(state, 'frame')).toEqual([['fh3']]);
    near(at(state, 'frame', 'fh3/center'), before.center, 12);
    // to an entity that is gone: refused
    expect(engine.preview({ type: 'updateExternal', sketch: 'frame', id: 'fh3', ref: { type: 'sketch', sketch: 'board', entity: 'bh9', kind: 'circle' } } as Command).ok).toBe(false);
  });

  it('a frozen curve in a middle sketch is followed silently; the outline of the last opens and openEnds names its ends', () => {
    const engine = newEngine();
    chain(engine);
    let state = run(engine, { type: 'removeEntity', sketch: 'board', id: 'bl0' });
    expect(status(state)).toMatchObject({ frame: 'warning:brokenProjection', rimSk: 'ok' });
    expect(regionsOf(state, 'rimSk')).toEqual([RIM]);
    state = run(engine, { type: 'setParameter', name: 'boardW', expr: '70' });
    expect(status(state)).toMatchObject({ frame: 'warning:brokenProjection', rimSk: 'ok' });
    expect(resultOf(state, 'rimSk').valid).toBe(true);
    expect(regionsOf(state, 'rimSk')).toEqual([]);
    expect(resultOf(state, 'rimSk').openEnds?.ends.map((end) => end.end).sort()).toEqual(['ra0/end', 'ra1/start', 'rl0/a', 'rl0/b']);
    expect(resultOf(state, 'rimSk').openEnds?.ends.every((end) => end.reason === 'apart' && end.distance > 4)).toBe(true);
  });

  it('a circle trimmed into an arc under its ID breaks its projection with the detail; a curve made a point too', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), point('src', 'c', 0, 0), { type: 'addCurve', sketch: 'src', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 5 }, fixed('src', 'fc', 'c', 0, 0), dimension('src', 'r', { type: 'radius', curve: 'k' }, 5));
    run(engine, addSketch('dst', XY), project('dst', 'x', 'src', 'k', 'circle'));
    run(engine, { type: 'removeEntity', sketch: 'src', id: 'k' }, point('src', 's', 5, 0), point('src', 'e', 0, 5), arc('src', 'k', 'c', 's', 'e'));
    const state = engine.getState();
    expect(warningsOf(state, 'dst')).toEqual(['brokenProjection: The projected geometry is no longer in its source; it keeps its last valid place. (k of src is an arc now, not a circle)']);
    expect(resultOf(state, 'dst').curves.x.shape.type).toBe('circle');
  });

  it('a tilted plane: unsupportedProjection with the angle, no geometry, the constraint on it left out', () => {
    const engine = newEngine();
    chain(engine);
    const state = run(engine, plane('tiltPl', 20, { axis: 'X', angle: 0.3 }), addSketch('tilted', onPlane('tiltPl')), project('tilted', 't0', 'frame', 'fl0', 'line'), point('tilted', 'q', 1, 1), constrain('tilted', 'on', { type: 'pointOnCurve', point: 'q', curve: 't0' }));
    expect(warningsOf(state, 'tilted')).toEqual(['unsupportedProjection: The geometry cannot be projected into this sketch. (the plane of frame is at 17.2° to this sketch; only a parallel plane is projected; the constraints on it were left out of the solve)']);
    expect(resultOf(state, 'tilted').curves.t0).toBeUndefined();
  });

  it('a source in conflict is followed at the positions it keeps, with no warning here', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), point('src', 'a', 0, 0), point('src', 'b', 10, 0), line('src', 'l', 'a', 'b'), fixed('src', 'fa', 'a', 0, 0), fixed('src', 'fb', 'b', 10, 0));
    run(engine, addSketch('dst', XY), project('dst', 'x', 'src', 'l', 'line'));
    const state = run(engine, dimension('src', 'bad', { type: 'horizontalDistance', a: 'a', b: 'b' }, 20));
    expect(status(state)).toMatchObject({ src: 'warning:sketchConflict', dst: 'ok' });
    near(at(state, 'dst', 'x/b'), at(state, 'src', 'b'));
  });

  it('a source line with no extent is degenerateProjection: no geometry, nothing NaN, also after a save and a load', () => {
    const engine = newEngine();
    const s = 'flatSrc';
    // solved, with its two ends at one place (a never-solved arc is tested without the solver)
    run(engine, addSketch(s, XY), point(s, 'a', 0, 0), point(s, 'b', 10, 0), line(s, 'q', 'a', 'b'), fixed(s, 'fa', 'a', 0, 0), dimension(s, 'dx', { type: 'horizontalDistance', a: 'a', b: 'b' }, 0), dimension(s, 'dy', { type: 'verticalDistance', a: 'a', b: 'b' }, 0));
    let state = run(engine, plane('flatPl', 5), addSketch('flat', onPlane('flatPl')), project('flat', 'xq', s, 'q', 'line', true), point('flat', 'm', 3, 3), constrain('flat', 'on', { type: 'pointOnCurve', point: 'm', curve: 'xq' }));
    for (let round = 0; round < 2; round++) {
      expect(warningsOf(state, 'flat')).toEqual(['degenerateProjection: The geometry has no extent in this sketch: it projects to a point. (the line q of flatSrc cannot be projected as it stands: it has no length or no radius, or a position that is not a number; the constraints on it were left out of the solve)']);
      expect(resultOf(state, 'flat').curves.xq).toBeUndefined();
      expect(sketchOf(state, 'flat').solved.external.xq).toBeUndefined();
      expect(Object.values(resultOf(state, 'flat').points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      const loaded = newEngine().load(engine.save());
      if (!loaded.ok) throw new Error(loaded.error.message);
      state = loaded.state;
    }
  });

  it('a copy of a mirror as a source follows its source', () => {
    const engine = newEngine();
    run(engine, addSketch('lid', XY), point('lid', 'a', 5, 0), point('lid', 'b', 10, 8), line('lid', 'c2', 'a', 'b'), fixed('lid', 'fa', 'a', 5, 0), fixed('lid', 'fb', 'b', 10, 8));
    run(engine, { type: 'addExternal', sketch: 'lid', id: 'm', ref: { type: 'pattern', sources: ['c2'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
    let state = run(engine, plane('rowPl', 2), addSketch('row', onPlane('rowPl')), project('row', 'lf', 'lid', 'm/1/c2', 'line'));
    near(at(state, 'row', 'lf/a'), [-5, 0]);
    near(at(state, 'row', 'lf/b'), [-10, 8]);
    state = run(engine, { type: 'removeConstraint', sketch: 'lid', id: 'fa' }, fixed('lid', 'fa2', 'a', 6, 0));
    near(at(state, 'row', 'lf/a'), [-6, 0]);
  });

  it('a projected edge repaired into a projection from a sketch of the same kind, and back', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 20, 10), addExtrude('E1', 'S1', [rectLoop('r')], 5));
    const edgeRef = { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'ra') }, kind: 'line' };
    run(engine, addSketch('top', onFace('E1', cap('E1'))), { type: 'addExternal', sketch: 'top', id: 'e', ref: edgeRef } as Command);
    let state = run(engine, { type: 'updateExternal', sketch: 'top', id: 'e', ref: { type: 'sketch', sketch: 'S1', entity: 'ra', kind: 'line' } } as Command);
    expect(sketchOf(state, 'top').external.e).toEqual({ type: 'sketch', sketch: 'S1', entity: 'ra', kind: 'line', regions: false });
    near(at(state, 'top', 'e/b'), [20, 0]);
    state = run(engine, { type: 'updateExternal', sketch: 'top', id: 'e', ref: edgeRef } as Command);
    expect(sketchOf(state, 'top').external.e.type).toBe('edge');
    expect(status(state).top).toBe('ok');
  });
});


// A sketch tool run in a sketch of the engine's state, its batch executed; or the refusal.
type Made = { ids: Record<string, Id[]>; state: EngineState };
function tool<K extends keyof SketchToolInputs>(engine: Engine, sketch: Id, name: K, input: SketchToolInputs[K], prefix: string): Made | string {
  const state = engine.getState();
  const made = sketchTool(name, { sketch: sketchOf(state, sketch), result: resultOf(state, sketch), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input, freshIds(state.document, prefix));
  return made.ok ? { ids: made.ids, state: run(engine, { type: 'batch', commands: made.commands }) } : made.message;
}
const made = (answer: Made | string): Made => {
  if (typeof answer === 'string') throw new Error(answer);
  return answer;
};

describe('a projection at the plug-in points of 6e (D69)', () => {
  // `src` on XY: a line `l` from (0, 0) to (20, 0) crossed by a line `x` at x = 15, a circle `k`
  // crossed by `x` too; `dst` projects `l`, `k`, and the point `e` (the end of `l`) as a point.
  function crossed(engine: Engine, flag = false): EngineState {
    run(
      engine,
      addSketch('src', XY),
      point('src', 'p1', 0, 0),
      point('src', 'e', 20, 0),
      point('src', 'x1', 15, -5),
      point('src', 'x2', 15, 30),
      point('src', 'kc', 15, 20),
      line('src', 'l', 'p1', 'e'),
      line('src', 'x', 'x1', 'x2'),
      { type: 'addCurve', sketch: 'src', id: 'k', curve: { type: 'circle', center: 'kc' }, radius: 4 },
      ...['p1', 'e', 'x1', 'x2', 'kc'].map((p) => fixed('src', `f${p}`, p, ...(({ p1: [0, 0], e: [20, 0], x1: [15, -5], x2: [15, 30], kc: [15, 20] }) as Record<string, [number, number]>)[p])),
    );
    return run(engine, plane('dstPl', 3), addSketch('dst', onPlane('dstPl')), project('dst', 'pl', 'src', 'l', 'line', flag), project('dst', 'pk', 'src', 'k', 'circle'), project('dst', 'pe', 'src', 'e', 'point'));
  }

  it('readersOf: a sketch that projects a shortened line is in shortened; one that projects a removed curve or a circle turned into an arc is in broken; a projected end stays', () => {
    let engine = newEngine();
    crossed(engine);
    // the end of `l` beyond `x` goes: `l` is shortened, its end `e` stays (dst names it), held on the line
    let answer = made(tool(engine, 'src', 'trim', { curve: 'l', at: [18, 0], repair: 'off' }, 't'));
    expect(answer.ids.shortened).toEqual(['dst']);
    expect(answer.ids.broken).toEqual([]);
    expect(sketchOf(answer.state, 'src').points.e).toBeDefined();
    expect(status(answer.state).dst).toBe('ok');
    near(at(answer.state, 'dst', 'pl/b'), [15, 0]);
    near(at(answer.state, 'dst', 'pe'), [20, 0]);
    // the circle trimmed into an arc under its ID
    engine = newEngine();
    crossed(engine);
    answer = made(tool(engine, 'src', 'trim', { curve: 'k', at: [19, 20], repair: 'off' }, 't'));
    expect(answer.ids.broken).toEqual(['dst']);
    expect(warningsOf(answer.state, 'dst')[0]).toContain('k of src is an arc now, not a circle');
    // a piece removed whole: the left part of `l` after a split, trimmed away
    engine = newEngine();
    crossed(engine);
    made(tool(engine, 'src', 'split', { curve: 'l' }, 's'));
    answer = made(tool(engine, 'src', 'trim', { curve: 'l', at: [5, 0], repair: 'off' }, 't'));
    expect(answer.ids.broken).toEqual(['dst']);
    expect(warningsOf(answer.state, 'dst')[0]).toContain('src has no line l');
  });

  it('repairsByDefault: on when a later sketch projects a curve of the sketch with the flag', () => {
    const engine = newEngine();
    crossed(engine);
    expect(repairsByDefault(engine.getState().document, 'src')).toBe(false);
    run(engine, { type: 'updateExternal', sketch: 'dst', id: 'pl', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line', regions: true } } as Command);
    expect(repairsByDefault(engine.getState().document, 'src')).toBe(true);
  });

  it('sketchContacts: an own curve across a flagged projection is fix none with the reason', () => {
    const engine = newEngine();
    crossed(engine, true);
    run(engine, point('dst', 'q1', 5, -5), point('dst', 'q2', 5, 5), line('dst', 'own', 'q1', 'q2'), fixed('dst', 'fq1', 'q1', 5, -5), fixed('dst', 'fq2', 'q2', 5, 5));
    const outcome = engine.query('sketchContacts', { sketch: 'dst' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.result.contacts).toEqual([
      expect.objectContaining({
        curves: ['own', 'pl'],
        fix: 'none',
        why: 'pl is a projection that forms regions and is not cut: draw an own curve over it with the sketch tool projectSketch { sketch: "src", entities: ["l"], as: "own" }, which also switches its flag off, then cut that; or remove the curve that meets it',
      }),
    ]);
  });

  it('a trim in a sketch that also holds a flagged projected outline: the profile in memory is the step\'s, and the feature over the outline is followed, not pending', () => {
    const engine = newEngine();
    chain(engine);
    const s = 'padSk';
    const PAD = ['ya0', 'ya1', 'ya2', 'ya3', 'yl0', 'yl1', 'yl2', 'yl3'];
    run(engine, addSketch(s, onPlane('framePl')), ...[0, 1, 2, 3].flatMap((i) => [project(s, `ya${i}`, 'frame', `fa${i}`, 'arc', true), project(s, `yl${i}`, 'frame', `fl${i}`, 'line', true)]));
    run(engine, point(s, 'q1', -5, -5), point(s, 'q2', 5, -5), point(s, 'q3', 5, 5), point(s, 'q4', -5, 5), line(s, 'n1', 'q1', 'q2'), line(s, 'n2', 'q2', 'q3'), line(s, 'n3', 'q3', 'q4'), line(s, 'n4', 'q4', 'q1'));
    run(engine, addExtrude('pad', s, [PAD], 1));
    let state = run(engine, point(s, 'q5', -8, 0), point(s, 'q6', 8, 0), line(s, 'n5', 'q5', 'q6'));
    expect(resultOf(state, s).valid).toBe(false);
    for (const [i, place] of ([[-7, 0], [7, 0]] as const).entries()) {
      const answer = made(tool(engine, s, 'trim', { ...(i === 0 ? { curve: 'n5' } : {}), at: [...place] }, 't'));
      expect(answer.ids.pending).toEqual([]);
      state = answer.state;
    }
    expect(resultOf(state, s).valid).toBe(true);
    expect(status(state).pad).toBe('ok');
    expect(regionsOf(state, s)).toContainEqual(PAD);
    // the same for the fillet: a corner of the own pocket inside the flagged outline
    const filleted = made(tool(engine, s, 'fillet', { corner: 'q3', radius: 1 }, 'f'));
    expect(resultOf(filleted.state, s).valid).toBe(true);
    expect(status(filleted.state).pad).toBe('ok');
    expect(regionsOf(filleted.state, s)).toContainEqual(PAD);
  });
});

// How far the own curves of a sketch are from the projections they were drawn over (`curves[i]`
// over `entries[i]`): the largest distance of a centre, a start or an end of an own arc, an end of
// an own line, a centre of an own circle, from the same point of its projection.
export function offProjection(state: EngineState, s: Id, curves: Id[], entries: Id[]): number {
  const [f, r] = [sketchOf(state, s), resultOf(state, s)];
  const far = (own: Id, projected: Id): number => Math.hypot((r.points[own]?.x ?? NaN) - (r.points[projected]?.x ?? NaN), (r.points[own]?.y ?? NaN) - (r.points[projected]?.y ?? NaN));
  return Math.max(
    ...curves.map((own, i) => {
      const curve = f.curves[own];
      if (curve.type === 'arc') return Math.max(far(curve.center, `${entries[i]}/center`), far(curve.start, `${entries[i]}/start`), far(curve.end, `${entries[i]}/end`));
      return curve.type === 'line' ? Math.max(far(curve.a, `${entries[i]}/a`), far(curve.b, `${entries[i]}/b`)) : 'center' in curve ? far(curve.center, `${entries[i]}/center`) : 0;
    }),
  );
}
const countFlagged = (state: EngineState, s: Id): number => Object.values(sketchOf(state, s).external).filter((ref) => (ref as SketchProjection).regions).length;

describe('the sketch tool projectSketch (D69)', () => {
  it('a whole sketch, each curve in the role it has in its source', () => {
    const engine = newEngine();
    chain(engine);
    run(engine, addSketch('copyB', onPlane('framePl')));
    let answer = made(tool(engine, 'copyB', 'projectSketch', { sketch: 'board' }, 'b'));
    expect(answer.ids.entries).toHaveLength(12);
    expect(countFlagged(answer.state, 'copyB')).toBe(12);
    expect(regionsOf(answer.state, 'copyB')).toHaveLength(5);
    run(engine, addSketch('copyF', onPlane('framePl')));
    answer = made(tool(engine, 'copyF', 'projectSketch', { sketch: 'frame' }, 'c'));
    expect(answer.ids.sources).toEqual(['fa0', 'fl0', 'fh0', 'fa1', 'fl1', 'fh1', 'fa2', 'fl2', 'fh2', 'fa3', 'fl3', 'fh3']);
    expect(countFlagged(answer.state, 'copyF')).toBe(0);
    expect(regionsOf(answer.state, 'copyF')).toEqual([]);
    run(engine, addSketch('copyR', onPlane('framePl')));
    answer = made(tool(engine, 'copyR', 'projectSketch', { sketch: 'frame', as: 'regions', entities: ['fa0', 'fl0', 'fa1', 'fl1', 'fa2', 'fl2', 'fa3', 'fl3'] }, 'r'));
    expect(regionsOf(answer.state, 'copyR')).toHaveLength(1);
    // reference: none forms regions
    run(engine, addSketch('copyS', onPlane('framePl')));
    answer = made(tool(engine, 'copyS', 'projectSketch', { sketch: 'board', as: 'reference' }, 's'));
    expect(countFlagged(answer.state, 'copyS')).toBe(0);
    // run again: everything is projected already
    expect(tool(engine, 'copyB', 'projectSketch', { sketch: 'board' }, 'f')).toBe('nothing to project: of board 12 entities are projected already');
    expect(made(tool(engine, 'copyB', 'projectSketch', { sketch: 'board', entities: ['hc0', 'bl0'] }, 'g')).ids).toMatchObject({ sources: ['hc0'], skipped: ['bl0'] });
  });

  it('as own: the outline of the frame drawn over its projections, fully determined, one region, following the board', () => {
    const engine = newEngine();
    chain(engine);
    run(engine, plane('basePl', -7), addSketch('baseSk', onPlane('basePl')));
    const state0 = engine.getState();
    const raw = sketchTool('projectSketch', { sketch: sketchOf(state0, 'baseSk'), result: resultOf(state0, 'baseSk'), document: state0.document, features: state0.evaluation.features }, { sketch: 'frame', entities: RIM.map((id) => id.replace('r', 'f')), as: 'own' }, freshIds(state0.document, 'o'));
    if (!raw.ok) throw new Error(raw.message);
    expect(raw.commands).toHaveLength(44);
    expect([raw.ids.entries.length, raw.ids.points.length, raw.ids.curves.length, raw.ids.helpers.length, raw.ids.constraints.length]).toEqual([8, 12, 8, 4, 12]);
    let state = run(engine, { type: 'batch', commands: raw.commands }, addExtrude('base', 'baseSk', [raw.ids.curves], 2));
    const held = (s: EngineState): void => {
      const diagnosis = engine.diagnoseSketch('baseSk');
      expect(diagnosis.status).toBe('solved');
      expect(diagnosis.degreesOfFreedom).toBe(0);
      expect(diagnosis.redundant).toEqual([]);
      expect(resultOf(s, 'baseSk').redundant).toEqual([]);
      expect(regionsOf(s, 'baseSk')).toEqual([[...raw.ids.curves].sort()]);
      expect(offProjection(s, 'baseSk', raw.ids.curves, raw.ids.entries)).toBeLessThan(1e-7);
      expect(status(s).base).toBe('ok');
    };
    held(state);
    for (const [name, expr] of [['boardR', '6'], ['boardR', '3'], ['boardW', '80'], ['boardW', '60']]) {
      state = run(engine, { type: 'setParameter', name, expr });
      held(state);
    }
  });

  it('as own on the other side (normal −Z): the arcs swapped and still held', () => {
    const engine = newEngine();
    standInBoard(engine);
    run(engine, addSketch('under', onFace('pcb', cap('pcb', 'startCap'))));
    const answer = made(tool(engine, 'under', 'projectSketch', { sketch: 'board', entities: ['ba0', 'bl0', 'ba1', 'bl1', 'ba2', 'bl2', 'ba3', 'bl3'], as: 'own' }, 'u'));
    const diagnosis = engine.diagnoseSketch('under');
    expect([diagnosis.degreesOfFreedom, diagnosis.redundant]).toEqual([0, []]);
    expect(regionsOf(answer.state, 'under')).toEqual([[...answer.ids.curves].sort()]);
    expect(offProjection(answer.state, 'under', answer.ids.curves, answer.ids.entries)).toBeLessThan(1e-7);
  });

  it('as own: a slot of two half turns and a circle, held with no freedom and no redundancy', () => {
    const engine = newEngine();
    const s = 'slot';
    run(
      engine,
      addSketch(s, XY),
      point(s, 'c1', 0, 0),
      point(s, 'c2', 20, 0),
      point(s, 'a1', 0, -5),
      point(s, 'a2', 20, -5),
      point(s, 'b2', 20, 5),
      point(s, 'b1', 0, 5),
      line(s, 'l1', 'a1', 'a2'),
      arc(s, 'r2', 'c2', 'a2', 'b2'),
      line(s, 'l2', 'b2', 'b1'),
      arc(s, 'r1', 'c1', 'b1', 'a1'),
      { type: 'addCurve', sketch: s, id: 'h', curve: { type: 'circle', center: 'c2' }, radius: 2 },
      ...([['c1', 0, 0], ['c2', 20, 0], ['a1', 0, -5], ['a2', 20, -5], ['b2', 20, 5], ['b1', 0, 5]] as const).map(([p, x, y]) => fixed(s, `f${p}`, p, x, y)),
      dimension(s, 'hr', { type: 'radius', curve: 'h' }, 2),
    );
    run(engine, plane('slotPl', 4), addSketch('own', onPlane('slotPl')));
    const answer = made(tool(engine, 'own', 'projectSketch', { sketch: s, as: 'own' }, 'q'));
    expect(answer.ids.curves).toHaveLength(5);
    const diagnosis = engine.diagnoseSketch('own');
    expect([diagnosis.degreesOfFreedom, diagnosis.redundant]).toEqual([0, []]);
    expect(regionsOf(answer.state, 'own')).toHaveLength(2);
    expect(offProjection(answer.state, 'own', answer.ids.curves, answer.ids.entries)).toBeLessThan(1e-7);
  });

  it('one own curve per place: a line drawn twice the other way round and a circle twice', () => {
    const engine = newEngine();
    const s = 'twice';
    run(engine, addSketch(s, XY), rectangle(s, 'r', 0, 0, 20, 10), point(s, 'k', 10, 5), { type: 'addCurve', sketch: s, id: 'c', curve: { type: 'circle', center: 'k' }, radius: 2 }, { type: 'addCurve', sketch: s, id: 'cc', curve: { type: 'circle', center: 'k', construction: true }, radius: 2 }, constrain(s, 'ce', { type: 'equalRadius', a: 'c', b: 'cc' }), dimension(s, 'cr', { type: 'radius', curve: 'c' }, 2), fixed(s, 'fk', 'k', 10, 5), line(s, 'rr', 'r2', 'r1', true));
    run(engine, plane('twPl', 3), addSketch('tw', onPlane('twPl')));
    const answer = made(tool(engine, 'tw', 'projectSketch', { sketch: s, entities: ['ra', 'rb', 'rc', 'rd', 'rr', 'c', 'cc'], as: 'own' }, 't'));
    expect(answer.ids.doubled).toEqual(['rr', 'cc']);
    expect(answer.ids.curves).toHaveLength(5);
    expect(engine.diagnoseSketch('tw').degreesOfFreedom).toBe(0);
    expect(regionsOf(answer.state, 'tw')).toHaveLength(2);
  });

  it('a source with a T: two regions whatever the role', () => {
    for (const as of ['source', 'regions', 'own'] as const) {
      const engine = newEngine();
      const s = 'tee';
      run(engine, addSketch(s, XY), rectangle(s, 'r', 0, 0, 20, 10), point(s, 'm1', 10, 0), point(s, 'm2', 10, 10), constrain(s, 'k1', { type: 'pointOnCurve', point: 'm1', curve: 'ra' }), constrain(s, 'k2', { type: 'pointOnCurve', point: 'm2', curve: 'rc' }), line(s, 'mid', 'm1', 'm2'), dimension(s, 'md', { type: 'horizontalDistance', a: 'r1', b: 'm1' }, 10), constrain(s, 'mv', { type: 'vertical', line: 'mid' }));
      // the T is in pieces in the source so its profile is valid: split it first
      made(tool(engine, s, 'split', {}, 'z'));
      expect(regionsOf(engine.getState(), s)).toHaveLength(2);
      run(engine, plane('tPl', 3), addSketch('t', onPlane('tPl')));
      const answer = made(tool(engine, 't', 'projectSketch', { sketch: s, as }, 'p'));
      expect(regionsOf(answer.state, 't'), as).toHaveLength(2);
      if (as === 'own') expect([engine.diagnoseSketch('t').degreesOfFreedom, engine.diagnoseSketch('t').redundant], as).toEqual([0, []]);
    }
  });

  it('refuses a tilted plane, a source that is not evaluated, a later sketch, itself, an entity it lacks, anything under origin/, every curve with regions where two lie on each other', () => {
    const engine = newEngine();
    chain(engine);
    run(engine, plane('tiltPl', 20, { axis: 'X', angle: 0.3 }), addSketch('tilted', onPlane('tiltPl')));
    expect(tool(engine, 'tilted', 'projectSketch', { sketch: 'frame' }, 'w')).toBe('the plane of frame is at 17.2° to this sketch; only a sketch on a parallel plane is projected');
    run(engine, addSketch('t2', onPlane('framePl')));
    expect(tool(engine, 't2', 'projectSketch', { sketch: 'nope' }, 'w')).toBe('the document has no sketch "nope"');
    expect(tool(engine, 't2', 'projectSketch', { sketch: 't2' }, 'w')).toBe('t2 is this sketch; only an earlier sketch is projected');
    expect(tool(engine, 'rimSk', 'projectSketch', { sketch: 't2' }, 'w')).toBe('t2 is after this sketch; only an earlier sketch is projected');
    expect(tool(engine, 't2', 'projectSketch', { sketch: 'frame', entities: ['zz'] }, 'w')).toBe('frame has no point or curve "zz"');
    expect(tool(engine, 't2', 'projectSketch', { sketch: 'frame', entities: ['origin/x'] }, 'w')).toContain('origin/x of frame is not projected');
    run(engine, { type: 'setSuppressed', id: 'frame', suppressed: true });
    expect(tool(engine, 't2', 'projectSketch', { sketch: 'frame' }, 'w')).toBe('frame is not evaluated: suppressed, in error, or its plane is broken');
    run(engine, { type: 'setSuppressed', id: 'frame', suppressed: false });
    // an own outline over projections, all with regions: two on each place
    run(engine, addSketch('over', onPlane('framePl')));
    const own = made(tool(engine, 'over', 'projectSketch', { sketch: 'frame', entities: ['fa0', 'fl0', 'fa1', 'fl1', 'fa2', 'fl2', 'fa3', 'fl3'], as: 'own' }, 'v'));
    run(engine, addSketch('t3', onPlane('framePl')));
    expect(tool(engine, 't3', 'projectSketch', { sketch: 'over', as: 'regions' }, 'w')).toBe(`${own.ids.curves[0]} and ${own.ids.entries[0]} of over lie on each other: projected with regions both would bound the same regions; name the entities, or use as: "source"`);
  });
});

describe('the query sketchSources (D69)', () => {
  it('without `from` the earlier sketches with their planes; with it every entity of one a projection may name, placed where a projection puts it', () => {
    const engine = newEngine();
    chain(engine);
    run(engine, plane('tiltPl', 20, { axis: 'X', angle: 0.3 }), addSketch('tilted', onPlane('tiltPl')), addSketch('last', onPlane('framePl')));
    const ask = (args: Record<string, unknown>) => {
      const outcome = engine.query('sketchSources', args as never);
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.result;
    };
    const all = ask({ sketch: 'last' });
    expect(all.entities).toBeUndefined();
    expect(all.sources.map((s) => [s.sketch, s.status, s.flips])).toEqual([['board', 'parallel', false], ['frame', 'parallel', false], ['rimSk', 'parallel', false], ['tilted', 'tilted', false]]);
    expect(all.sources[1]).toMatchObject({ curves: 12, points: 25 });
    expect(all.sources[3].angle).toBeCloseTo(0.3, 12);
    // the tilted one: no entities
    expect(ask({ sketch: 'last', from: 'tilted' })).toEqual({ sources: [all.sources[3]] });
    // what rimSk can project of frame: 37 entities, the twelve curves the tool takes whole first
    const one = ask({ sketch: 'rimSk', from: 'frame' });
    const entities = one.entities ?? [];
    expect(one.total).toBe(37);
    expect(entities.filter((e) => e.whole).map((e) => e.id)).toEqual(['fa0', 'fl0', 'fh0', 'fa1', 'fl1', 'fh1', 'fa2', 'fl2', 'fh2', 'fa3', 'fl3', 'fh3']);
    expect(entities.slice(0, 12).every((e) => e.whole && e.kind !== 'point')).toBe(true);
    expect(entities.find((e) => e.id === 'fa0')).toMatchObject({ kind: 'arc', entry: 'ra0', regions: false });
    expect(entities.filter((e) => e.entry !== undefined)).toHaveLength(8);
    const hole = entities.find((e) => e.id === 'fh0/center') as { kind: string; at: [number, number]; whole: boolean };
    expect(hole).toMatchObject({ kind: 'point', whole: false });
    expect(hole.at[0]).toBeCloseTo(26.5, 9);
    expect(entities.some((e) => e.id === 'origin' && e.kind === 'point')).toBe(true);
    expect(entities.some((e) => e.id.startsWith('origin/'))).toBe(false);
    // the places are where the projections are
    const state = engine.getState();
    const arc = entities.find((e) => e.id === 'fa1') as { center: [number, number]; start: [number, number]; end: [number, number] };
    near(arc.center, at(state, 'rimSk', 'ra1/center'));
    near(arc.start, at(state, 'rimSk', 'ra1/start'));
    near(arc.end, at(state, 'rimSk', 'ra1/end'));
    // max and total
    expect(ask({ sketch: 'rimSk', from: 'frame', max: 5 })).toMatchObject({ total: 37, entities: entities.slice(0, 5) });
    // a point named from the answer projected
    const named = run(engine, addSketch('pointSk', onPlane('framePl')), project('pointSk', 'hp', 'frame', 'fh0/center', 'point'));
    near(at(named, 'pointSk', 'hp'), hole.at);
    // a source suppressed, and an argument that is not earlier
    run(engine, { type: 'setSuppressed', id: 'frame', suppressed: true });
    expect(ask({ sketch: 'last' }).sources[1]).toMatchObject({ sketch: 'frame', status: 'notEvaluated' });
    run(engine, { type: 'setSuppressed', id: 'frame', suppressed: false });
    const later = engine.query('sketchSources', { sketch: 'frame', from: 'rimSk' });
    expect(later.ok ? 'answered' : later.error.message).toBe('sketchSources: "rimSk" is not a sketch before "frame" on the timeline');
  });

  it('`whole` is what projectSketch takes without `entities`; on the other side the arcs are swapped', () => {
    const engine = newEngine();
    standInBoard(engine);
    run(engine, addSketch('under', onFace('pcb', cap('pcb', 'startCap'))));
    const outcome = engine.query('sketchSources', { sketch: 'under', from: 'board' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.result.sources[0].flips).toBe(true);
    const whole = (outcome.result.entities ?? []).filter((e) => e.whole).map((e) => e.id);
    const answer = made(tool(engine, 'under', 'projectSketch', { sketch: 'board' }, 'w'));
    expect(answer.ids.sources).toEqual(whole);
    const arc = (outcome.result.entities ?? []).find((e) => e.id === 'ba0') as { start: [number, number] };
    const entry = answer.ids.entries[answer.ids.sources.indexOf('ba0')];
    near(arc.start, at(answer.state, 'under', `${entry}/start`));
  });
});
