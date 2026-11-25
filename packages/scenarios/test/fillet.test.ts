// The sketch tool `fillet` (D52) against the real adapters: the batch it makes, the features of the
// document it patches or names, what it refuses, and how a fillet behaves under later changes
// (docs/d36/2d-sketch-fillet/design.md, "Measured").
import { type Command, type Constraint, type Engine, type EngineState, type ExtrudeFeature, type FaceName, type Id, type SketchFeature, type SketchToolResult, freshIds, sketchTool } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, batch, constrain, dimension, expectAllOk, newEngine, onFace, rectLoop, rectangle, run, side, volume } from './kit';

type Made = Extract<SketchToolResult, { ok: true }>;
const sketchOf = (state: EngineState, id: Id): SketchFeature => state.document.features.find((f) => f.id === id) as SketchFeature;
// The tool as the app and MCP call it: the sketch, its solved state, the parameters and the document.
function tool(state: EngineState, sketch: Id, corner: Id, radius: number | string, prefix = 'f_'): SketchToolResult {
  const context = { sketch: sketchOf(state, sketch), result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features };
  return sketchTool('fillet', context, { corner, radius }, freshIds(state.document, prefix));
}
function fillet(engine: Engine, sketch: Id, corner: Id, radius: number | string, prefix = 'f_'): Made {
  const made = tool(engine.getState(), sketch, corner, radius, prefix);
  if (!made.ok) throw new Error(made.message);
  run(engine, batch(...made.commands));
  return made;
}
const refusal = (engine: Engine, sketch: Id, corner: Id, radius: number | string): string => {
  const made = tool(engine.getState(), sketch, corner, radius);
  if (made.ok) throw new Error(`the fillet of ${corner} should have been refused`);
  return made.message;
};
const point = (sketch: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
const line = (sketch: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b, ...(construction ? { construction: true } : {}) } });
const at = (state: EngineState, sketch: Id, id: Id): [number, number] => {
  const p = state.evaluation.features[sketch].sketch!.points[id];
  return [p.x, p.y];
};
const close = (p: [number, number], x: number, y: number, tolerance = 1e-9) => {
  expect(Math.abs(p[0] - x), `x ${p[0]} not ${x}`).toBeLessThan(tolerance);
  expect(Math.abs(p[1] - y), `y ${p[1]} not ${y}`).toBeLessThan(tolerance);
};
const faces = (state: EngineState, body: Id): FaceName[] => state.evaluation.bodies[body].faces.map((face) => state.evaluation.faceNames[face.id]);
// The plate 80 × 50 × 10: the rectangle o1..o4 (oa bottom, ob right, oc top, od left; each from
// its number to the next) fully dimensioned with its corner o1 at the origin.
const plate = (): Engine => {
  const engine = newEngine();
  run(engine, addSketch('s', XY), rectangle('s', 'o', 0, 0, 80, 50), addExtrude('E', 's', [rectLoop('o')], 10));
  return engine;
};

describe('the fillet tool: the batch', () => {
  it('a corner of the plate: three points, two re-points, the arc, five constraints and the patch, in this order', () => {
    const engine = plate();
    const before = engine.getState();
    const made = fillet(engine, 's', 'o3', 6);
    expect(made.ids).toEqual({ arc: ['f_c1'], center: ['f_p3'], lines: ['ob', 'oc'], ends: ['f_p1', 'f_p2'], constraints: ['f_k1', 'f_k2', 'f_k3', 'f_k4'], radius: ['f_k5'], patched: ['E'], moved: [], shortened: [], entries: [] });
    expect(made.commands.map((command) => command.type)).toEqual(['addPoint', 'addPoint', 'addPoint', 'setCurvePoint', 'setCurvePoint', 'addCurve', 'addConstraint', 'addConstraint', 'addConstraint', 'addConstraint', 'addConstraint', 'updateFeature']);
    expect(made.commands.slice(3)).toEqual([
      { type: 'setCurvePoint', sketch: 's', id: 'ob', point: 'b', to: 'f_p1' },
      { type: 'setCurvePoint', sketch: 's', id: 'oc', point: 'a', to: 'f_p2' },
      { type: 'addCurve', sketch: 's', id: 'f_c1', curve: { type: 'arc', center: 'f_p3', start: 'f_p1', end: 'f_p2' } },
      { type: 'addConstraint', sketch: 's', id: 'f_k1', constraint: { type: 'tangent', a: 'ob', b: 'f_c1' } },
      { type: 'addConstraint', sketch: 's', id: 'f_k2', constraint: { type: 'tangent', a: 'oc', b: 'f_c1' } },
      { type: 'addConstraint', sketch: 's', id: 'f_k3', constraint: { type: 'pointOnCurve', point: 'o3', curve: 'ob' } },
      { type: 'addConstraint', sketch: 's', id: 'f_k4', constraint: { type: 'pointOnCurve', point: 'o3', curve: 'oc' } },
      { type: 'addConstraint', sketch: 's', id: 'f_k5', constraint: { type: 'radius', curve: 'f_c1', value: 6, driving: true } },
      { type: 'updateFeature', id: 'E', patch: { profile: { regions: [{ outerLoop: ['f_c1', 'oa', 'ob', 'oc', 'od'] }] } } },
    ]);
    const state = engine.getState();
    expectAllOk(state);
    // exactly in place: the ends on the lines, the centre on the bisector; the corner is still the sharp one
    close(at(state, 's', 'f_p1'), 80, 44);
    close(at(state, 's', 'f_p2'), 74, 50);
    close(at(state, 's', 'f_p3'), 74, 44);
    close(at(state, 's', 'o3'), 80, 50);
    // as determined as before
    expect(before.evaluation.features.s.sketch!.degreesOfFreedom).toBe(0);
    expect(state.evaluation.features.s.sketch!.degreesOfFreedom).toBe(0);
    expect(engine.diagnoseSketch('s').redundant).toEqual([]);
    // the faces of before keep their names; the arc is a cylinder; the volume is the plate less the corner
    for (const name of faces(before, 'E')) expect(faces(state, 'E')).toContainEqual(name);
    const round = state.evaluation.faceNames.findIndex((name) => name.role === 'side' && name.curve === 'f_c1');
    expect(state.evaluation.faceSurfaces[round]).toMatchObject({ kind: 'cylinder', radius: expect.closeTo(6, 9) });
    expect(volume(state.evaluation.bodies.E.solid)).toBeCloseTo(39922.1505, 3);
    // one undo takes it back, the patch included
    engine.undo();
    expect(engine.getState().document).toEqual(before.document);
  });

  it('the radius dimension can be changed afterwards (the solver adapter of D52), and the arc follows', () => {
    const engine = plate();
    const made = fillet(engine, 's', 'o3', 6);
    const state = run(engine, { type: 'setConstraintValue', sketch: 's', id: made.ids.radius[0], value: 12 });
    expectAllOk(state);
    close(at(state, 's', 'f_p1'), 80, 38, 1e-7);
    close(at(state, 's', 'f_p3'), 68, 38, 1e-7);
    // the size of the plate is still measured between the sharp corners
    const sized = run(engine, { type: 'setConstraintValue', sketch: 's', id: 'ow', value: 100 });
    expectAllOk(sized);
    close(at(sized, 's', 'o3'), 100, 50, 1e-7);
    close(at(sized, 's', 'f_p3'), 88, 38, 1e-7);
  });

  it('an expression as the radius; refused without the parameters or with an expression that has no value', () => {
    const engine = plate();
    run(engine, { type: 'setParameter', name: 'R', expr: '4' });
    const state = engine.getState();
    const blind = sketchTool('fillet', { sketch: sketchOf(state, 's'), result: state.evaluation.features.s.sketch, document: state.document, features: state.evaluation.features }, { corner: 'o3', radius: 'R' }, freshIds(state.document));
    expect(blind).toEqual({ ok: false, message: 'radius: the expression cannot be evaluated without the values of the parameters' });
    expect(refusal(engine, 's', 'o3', 'nothing * 2')).toMatch(/^radius: .*nothing/);
    expect(refusal(engine, 's', 'o3', 'R - 5')).toBe('radius: the value must be positive');
    const made = fillet(engine, 's', 'o3', 'R * 2');
    const after = engine.getState();
    expect(sketchOf(after, 's').expressions).toEqual({ [`constraints/${made.ids.radius[0]}/value`]: 'R * 2' });
    close(at(after, 's', 'f_p3'), 72, 42);
    const larger = run(engine, { type: 'setParameter', name: 'R', expr: '5' });
    close(at(larger, 's', 'f_p3'), 70, 40, 1e-7);
  });

  it('construction lines give a construction arc; a corner at the origin; a construction diagonal stays on the corner', () => {
    // two construction lines from a fixed corner, at 60°
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch(point('s', 'p', 10, 10), point('s', 'q1', 50, 10), point('s', 'q2', 10 + 20, 10 + 20 * Math.sqrt(3)), line('s', 'l1', 'p', 'q1', true), line('s', 'l2', 'q2', 'p', true), constrain('s', 'fp', { type: 'fixed', point: 'p', x: 10, y: 10 })));
    const made = fillet(engine, 's', 'p', 5);
    const s = sketchOf(engine.getState(), 's');
    expect(s.curves[made.ids.arc[0]]).toMatchObject({ construction: true, type: 'arc' });
    const half = Math.PI / 6;
    close(at(engine.getState(), 's', made.ids.ends[0]), 10 + 5 / Math.tan(half), 10, 1e-7);
    close(at(engine.getState(), 's', made.ids.center[0]), 10 + 5 / Math.tan(half), 15, 1e-7);
    // the rectangle of the app from the origin: the corner is `origin` itself
    const origin = newEngine();
    run(origin, addSketch('s', XY));
    const rect = sketchTool('rectangle', { sketch: sketchOf(origin.getState(), 's'), result: origin.getState().evaluation.features.s.sketch, document: origin.getState().document, features: origin.getState().evaluation.features }, { first: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, opposite: { at: [40, 30] } }, freshIds(origin.getState().document));
    if (!rect.ok) throw new Error(rect.message);
    run(origin, batch(...rect.commands));
    const atOrigin = fillet(origin, 's', 'origin', 3);
    expect(atOrigin.commands.filter((command) => command.type === 'addConstraint').map((command) => (command as { constraint: Constraint }).constraint.type)).toEqual(['tangent', 'tangent', 'pointOnCurve', 'pointOnCurve', 'radius']);
    close(at(origin.getState(), 's', atOrigin.ids.center[0]), 3, 3, 1e-7);
    expect(origin.getState().evaluation.features.s.status).toBe('ok');
    // a construction diagonal at the corner: the two lines of the outline are filleted
    const diagonal = plate();
    run(diagonal, line('s', 'diag', 'o1', 'o3', true));
    const made2 = fillet(diagonal, 's', 'o3', 6);
    expect(made2.ids.lines).toEqual(['ob', 'oc']);
    expect(sketchOf(diagonal.getState(), 's').curves.diag).toEqual({ construction: true, type: 'line', a: 'o1', b: 'o3' });
    expectAllOk(diagonal.getState());
  });

  it('a corner tied to a projected point by a coincident constraint, as a snap leaves it; a pointOnCurve already there is named, not added', () => {
    const engine = plate();
    // a sketch on the top of the plate: an edge of it projected, two lines meeting at a point joined to its end
    run(
      engine,
      addSketch('t', onFace('E', { feature: 'E', role: 'endCap' })),
      { type: 'addExternal', sketch: 't', id: 'x', ref: { type: 'edge', body: 'E', edge: { a: { feature: 'E', role: 'endCap' }, b: side('E', 'oa') }, kind: 'line' } },
    );
    const end = at(engine.getState(), 't', 'x/b');
    run(engine, batch(point('t', 'c', end[0], end[1]), point('t', 'u', end[0] - 30, end[1]), point('t', 'v', end[0], end[1] + 20), line('t', 'm1', 'u', 'c'), line('t', 'm2', 'c', 'v'), constrain('t', 'snap', { type: 'coincident', a: 'c', b: 'x/b' }), constrain('t', 'hold', { type: 'pointOnCurve', point: 'c', curve: 'm1' })));
    const made = fillet(engine, 't', 'c', 4);
    expect(made.ids.lines).toEqual(['m1', 'm2']);
    expect(made.ids.constraints).toEqual(['f_k1', 'f_k2', 'hold', 'f_k3']);
    expect(engine.getState().evaluation.features.t.status).toBe('ok');
  });
});

describe('the fillet tool: the features of the document', () => {
  it('a corner of a pocket inside a plate: the plate is not patched and gets the round corner by itself; a feature with both regions is patched for the inner one', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'o', 0, 0, 80, 50), rectangle('s', 'i', 20, 10, 30, 20, null), addExtrude('E', 's', [rectLoop('o')], 10));
    const plateOnly = tool(engine.getState(), 's', 'i3', 3);
    expect(plateOnly.ok && plateOnly.ids.patched).toEqual([]);
    run(engine, batch(...(plateOnly as Made).commands));
    const state = engine.getState();
    expectAllOk(state);
    expect(faces(state, 'E')).toContainEqual(side('E', (plateOnly as Made).ids.arc[0]));
    // with the inner region extruded as well (a second feature with both regions)
    const both = newEngine();
    run(both, addSketch('s', XY), rectangle('s', 'o', 0, 0, 80, 50), rectangle('s', 'i', 20, 10, 30, 20, null), addExtrude('E', 's', [rectLoop('o'), rectLoop('i')], 10));
    const made = fillet(both, 's', 'i3', 3);
    expect(made.ids.patched).toEqual(['E']);
    const regions = (both.getState().document.features.find((f) => f.id === 'E') as ExtrudeFeature).profile;
    expect(regions).toMatchObject({ regions: [{ outerLoop: rectLoop('o') }, { outerLoop: [made.ids.arc[0], ...rectLoop('i')].sort() }] });
    expectAllOk(both.getState());
  });

  it('walls: one along both lines is patched, one along a single line is named in shortened', () => {
    const engine = newEngine();
    run(
      engine,
      addSketch('s', XY),
      batch(point('s', 'a', 0, 0), point('s', 'b', 30, 0), point('s', 'c', 30, 20), line('s', 'ab', 'a', 'b', true), line('s', 'bc', 'b', 'c', true), constrain('s', 'fa', { type: 'fixed', point: 'a', x: 0, y: 0 }), constrain('s', 'fb', { type: 'fixed', point: 'b', x: 30, y: 0 }), constrain('s', 'fc', { type: 'fixed', point: 'c', x: 30, y: 20 })),
      { type: 'addFeature', feature: { id: 'W', name: 'W', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 's', curves: ['ab', 'bc'], thickness: 2 }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'H', name: 'H', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 's', curves: ['bc'], thickness: 1 }, extent: { type: 'distance', start: 10, distance: 5 }, operation: 'new' } },
    );
    const before = volume(engine.getState().evaluation.bodies.H.solid);
    const made = fillet(engine, 's', 'b', 4);
    expect(made.ids).toMatchObject({ patched: ['W'], moved: [], shortened: ['H'] });
    const state = engine.getState();
    expectAllOk(state);
    expect((state.document.features.find((f) => f.id === 'W') as ExtrudeFeature).profile).toMatchObject({ curves: ['ab', 'bc', made.ids.arc[0]].sort() });
    expect((state.document.features.find((f) => f.id === 'H') as ExtrudeFeature).profile).toMatchObject({ curves: ['bc'] });
    // the wall along `bc` alone is 4 shorter, and its straight end is named by the end of the arc
    expect(volume(state.evaluation.bodies.H.solid)).toBeCloseTo((before * 16) / 20, 6);
    const ends = faces(state, 'H').flatMap((name) => (name.role === 'wallEnd' ? [name.point] : []));
    expect(ends).toContain(made.ids.ends[made.ids.lines.indexOf('bc')]);
    expect(ends).not.toContain('b');
  });

  it('moved: the planes on a side face that starts at the corner, for both, one or none of the lines', () => {
    // a triangle o→p→q→o; the corner `o` is the start of `op` and the end of `qo`
    const build = (reverse: [boolean, boolean]): Engine => {
      const engine = newEngine();
      const [first, second] = reverse;
      run(
        engine,
        addSketch('s', XY),
        batch(point('s', 'o', 0, 0), point('s', 'p', 40, 0), point('s', 'q', 0, 30), first ? line('s', 'op', 'p', 'o') : line('s', 'op', 'o', 'p'), line('s', 'pq', 'p', 'q'), second ? line('s', 'qo', 'o', 'q') : line('s', 'qo', 'q', 'o'), ...['o', 'p', 'q'].map((id, i) => constrain('s', `f${id}`, { type: 'fixed', point: id, x: [0, 40, 0][i], y: [0, 0, 30][i] }))),
        addExtrude('E', 's', [['op', 'pq', 'qo']], 10),
        addSketch('onOp', onFace('E', side('E', 'op'))),
        addSketch('onQo', onFace('E', side('E', 'qo'))),
        { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: onFace('E', side('E', 'op')), offset: 1 } },
      );
      return engine;
    };
    // `op` starts at the corner, `qo` ends there
    expect(tool(build([false, false]).getState(), 's', 'o', 3)).toMatchObject({ ok: true, ids: { patched: ['E'], moved: ['onOp', 'P'], shortened: [] } });
    // both start there
    expect(tool(build([false, true]).getState(), 's', 'o', 3)).toMatchObject({ ok: true, ids: { moved: ['onOp', 'onQo', 'P'] } });
    // neither does
    expect(tool(build([true, false]).getState(), 's', 'o', 3)).toMatchObject({ ok: true, ids: { moved: [] } });
    // a sketch on the same face of a copy made by a pattern of the body is read the same way
    const copied = build([false, false]);
    run(
      copied,
      { type: 'addFeature', feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'body', body: 'E' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'spacing', spacing: 20 } } } },
      addSketch('onCopy', onFace('row/1', { ...side('E', 'op'), copy: [{ pattern: 'row', index: 1 }] })),
    );
    expectAllOk(copied.getState());
    expect(tool(copied.getState(), 's', 'o', 3)).toMatchObject({ ok: true, ids: { moved: ['onOp', 'P', 'onCopy'] } });
    // the plane on the face that starts at the corner moves with the start of its line
    const engine = build([false, false]);
    const origin = engine.getState().evaluation.features.onOp.plane!.origin;
    fillet(engine, 's', 'o', 3);
    expectAllOk(engine.getState());
    expect(engine.getState().evaluation.features.onOp.plane!.origin[0]).toBeCloseTo(origin[0] + 3, 9);
  });

  it('shortened: a projected edge of a side face of either line; the edge between the two side faces is listed and reported as broken', () => {
    const engine = plate();
    const top: FaceName = { feature: 'E', role: 'endCap' };
    run(
      engine,
      addSketch('t', onFace('E', top)),
      { type: 'addExternal', sketch: 't', id: 'edge', ref: { type: 'edge', body: 'E', edge: { a: top, b: side('E', 'ob') }, kind: 'line' } },
      addSketch('u', onFace('E', top)),
      { type: 'addExternal', sketch: 'u', id: 'corner', ref: { type: 'edge', body: 'E', edge: { a: side('E', 'ob'), b: side('E', 'oc') }, kind: 'line' } },
      addSketch('w', onFace('E', top)),
      { type: 'addExternal', sketch: 'w', id: 'far', ref: { type: 'edge', body: 'E', edge: { a: top, b: side('E', 'od') }, kind: 'line' } },
    );
    const made = fillet(engine, 's', 'o3', 6);
    expect(made.ids.shortened).toEqual(['t', 'u']);
    const state = engine.getState();
    expect(state.evaluation.features.t.status).toBe('ok');
    expect(state.evaluation.features.u.warnings.map((warning) => warning.code)).toEqual(['brokenProjection']);
    expect(state.evaluation.features.w.status).toBe('ok');
  });
});

describe('the fillet tool: what it refuses', () => {
  // two lines from a fixed corner `p` at `angle`, 40 and 30 long
  const corner = (angle: number, extra: Command[] = []): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), batch(point('s', 'p', 0, 0), point('s', 'q1', 40, 0), point('s', 'q2', 30 * Math.cos(angle), 30 * Math.sin(angle)), line('s', 'l1', 'p', 'q1'), line('s', 'l2', 'q2', 'p'), constrain('s', 'fp', { type: 'fixed', point: 'p', x: 0, y: 0 }), ...extra));
    return engine;
  };

  it('a radius that does not fit, and the bound from both sides', () => {
    const engine = corner(Math.PI / 2);
    expect(refusal(engine, 's', 'p', 30)).toBe('the radius 30 does not fit: the lines are 40 and 30 long at an angle of 90°, so the radius has to be below 30');
    expect(tool(engine.getState(), 's', 'p', 30 - 1e-5).ok).toBe(true);
    expect(refusal(engine, 's', 'p', 30 - 1e-7)).toMatch(/does not fit/);
  });

  it('lines nearly parallel: folded onto each other, or one straight line through the corner', () => {
    expect(refusal(corner(5e-5), 's', 'p', 1e-3)).toBe('the lines "l1" and "l2" are parallel: there is no corner to round');
    expect(tool(corner(2e-4).getState(), 's', 'p', 1e-3).ok).toBe(true);
    expect(refusal(corner(Math.PI - 5e-5), 's', 'p', 1)).toMatch(/parallel/);
    expect(tool(corner(Math.PI - 2e-4).getState(), 's', 'p', 1).ok).toBe(true);
  });

  it('a radius too small to draw: the radius, or the distance from the corner to the arc, at the length tolerance', () => {
    const sixty = corner(Math.PI / 3);
    expect(refusal(sixty, 's', 'p', 0.75e-6)).toBe('the radius 7.5e-7 is too small to draw: the arc would have no length');
    expect(tool(sixty.getState(), 's', 'p', 1.5e-6).ok).toBe(true);
    // nearly straight: the arc ends 7.5e-7 from the corner
    expect(refusal(corner(Math.PI - 1.5e-4), 's', 'p', 0.01)).toMatch(/too small to draw/);
    expect(tool(corner(Math.PI - 1.5e-4).getState(), 's', 'p', 0.03).ok).toBe(true);
  });

  it('a centre out of the range of coordinates', () => {
    const engine = newEngine();
    const y = 1e9 - 0.5;
    run(engine, addSketch('s', XY), batch(point('s', 'p', 0, y), point('s', 'q1', 100, y), point('s', 'q2', -100, y + 0.4), line('s', 'l1', 'p', 'q1'), line('s', 'l2', 'q2', 'p')));
    expect(refusal(engine, 's', 'p', 1)).toBe('the fillet reaches out of the range ±1000000000');
  });

  it('a corner that is not one: one line, three lines, a line and an arc, nothing, two joined points, a projected point', () => {
    const engine = corner(Math.PI / 2, [point('s', 'q3', -10, -10), point('s', 'q4', 10, 40), line('s', 'l3', 'q3', 'q2'), line('s', 'l4', 'q2', 'q4'), point('s', 'm', 5, 5), point('s', 'n', 5, 25), { type: 'addCurve', sketch: 's', id: 'arc', curve: { type: 'arc', center: 'm', start: 'q1', end: 'n' } }]);
    expect(refusal(engine, 's', 'q3', 2)).toBe('"q3" is not the common end of exactly two lines: what ends there is "l3" (line)');
    expect(refusal(engine, 's', 'q2', 2)).toBe('"q2" is not the common end of exactly two lines: what ends there is "l2" (line), "l3" (line), "l4" (line)');
    expect(refusal(engine, 's', 'q1', 2)).toBe('"q1" is not the common end of exactly two lines: what ends there is "l1" (line), "arc" (arc)');
    expect(refusal(engine, 's', 'm', 2)).toBe('"m" is not the common end of exactly two lines: no curve ends there');
    expect(refusal(engine, 's', 'nope', 2)).toBe('corner: the sketch has no point "nope"');
    expect(refusal(engine, 's', 'l1', 2)).toBe('corner: "l1" is a line, not a point');
    // two points at one place joined by a coincident constraint
    const joined = newEngine();
    run(joined, addSketch('s', XY), batch(point('s', 'p', 0, 0), point('s', 'p2', 0, 0), point('s', 'q1', 40, 0), point('s', 'q2', 0, 30), line('s', 'l1', 'p', 'q1'), line('s', 'l2', 'q2', 'p2'), constrain('s', 'j', { type: 'coincident', a: 'p', b: 'p2' })));
    expect(refusal(joined, 's', 'p', 2)).toBe('the corner is two points: "l2" ends at "p2", which a coincident constraint joins to "p"; re-point one line onto the other point first (setCurvePoint)');
    // a corner joined to the origin with a third line that ends at the origin itself
    const third = newEngine();
    run(third, addSketch('s', XY), batch(point('s', 'p', 0, 0), point('s', 'q1', 40, 0), point('s', 'q2', 0, 30), point('s', 'q3', -20, -20), line('s', 'l1', 'p', 'q1'), line('s', 'l2', 'q2', 'p'), line('s', 'l3', 'q3', 'origin'), constrain('s', 'j', { type: 'coincident', a: 'p', b: 'origin' })));
    expect(refusal(third, 's', 'p', 2)).toBe('"p" is not the common end of exactly two lines: what ends there is "l1" (line), "l2" (line), "l3" (line)');
    // a point of projected geometry
    const projected = plate();
    run(projected, addSketch('t', onFace('E', { feature: 'E', role: 'endCap' })), { type: 'addExternal', sketch: 't', id: 'x', ref: { type: 'edge', body: 'E', edge: { a: { feature: 'E', role: 'endCap' }, b: side('E', 'oa') }, kind: 'line' } });
    expect(refusal(projected, 't', 'x/a', 2)).toBe('corner: "x/a" is a point of projected geometry; give an own point of the sketch');
  });

  it('equalLength or midpoint on a line of the corner', () => {
    const equal = corner(Math.PI / 2, [constrain('s', 'eq', { type: 'equalLength', a: 'l1', b: 'l2' })]);
    expect(refusal(equal, 's', 'p', 2)).toBe('the equalLength constraint "eq" is on a line of the corner; after the fillet it would measure the shortened line, so remove it first');
    const middle = corner(Math.PI / 2, [point('s', 'mid', 20, 0), constrain('s', 'mp', { type: 'midpoint', point: 'mid', line: 'l1' })]);
    expect(refusal(middle, 's', 'p', 2)).toMatch(/the midpoint constraint "mp"/);
  });

  it('nothing is drawn: a refused tool returns a message only', () => {
    expect(tool(corner(Math.PI / 2).getState(), 's', 'p', 100)).toEqual({ ok: false, message: expect.stringMatching(/does not fit/) });
  });
});

// Known limits, pinned as they were measured (design.md, "Measured" and "Known limits").
describe('the fillet tool: a fillet under later changes', () => {
  it('the plate with four fillets: radii, sizes, a drag stay fillets, a conflict or an invalid profile', () => {
    const engine = plate();
    const radii = ['o1', 'o2', 'o3', 'o4'].map((corner, i) => fillet(engine, 's', corner, 6, `f${i}_`).ids.radius[0]);
    expectAllOk(engine.getState());
    const status = (command: Command): string => {
      const result = engine.preview(command);
      if (!result.ok) return 'refused';
      const sketch = result.state.evaluation.features.s;
      return sketch.warnings.some((warning) => warning.code === 'sketchConflict') ? 'conflict' : sketch.sketch!.valid ? 'solved' : 'invalid';
    };
    const radius = (value: number): Command => ({ type: 'setConstraintValue', sketch: 's', id: radii[2], value });
    expect([1, 12, 24.9, 43.9].map((value) => status(radius(value)))).toEqual(['solved', 'solved', 'solved', 'solved']);
    expect([44, 60].map((value) => status(radius(value)))).toEqual(['conflict', 'conflict']);
    expect(status(radius(50))).toBe('invalid');
    const all = (value: number): Command => batch(...radii.map((id): Command => ({ type: 'setConstraintValue', sketch: 's', id, value })));
    expect([2, 24.9].map((value) => status(all(value)))).toEqual(['solved', 'solved']);
    expect(status(all(25))).toBe('conflict');
    const height = (value: number): Command => ({ type: 'setConstraintValue', sketch: 's', id: 'oh', value });
    expect([12.2, 300].map((value) => status(height(value)))).toEqual(['solved', 'solved']);
    expect(status(height(12))).toBe('conflict');
    expect(status(height(5))).toBe('invalid');
    // a drag of the end of an arc in the determined sketch changes nothing
    const dragged = engine.preview({ type: 'dragPoint', sketch: 's', point: 'f2_p1', x: 60, y: 60 });
    expect(dragged.ok && dragged.state.evaluation.features.s.status).toBe('ok');
    if (dragged.ok) close(at(dragged.state, 's', 'f2_p1'), 80, 44, 1e-7);
  });

  it('known limit: an arc solved past the end of its line, with no message (open construction lines, a concave outline, a radius far past the fit)', () => {
    // two construction lines 40 and 30 long from a fixed corner, nothing built on them
    const open = newEngine();
    run(open, addSketch('s', XY), batch(point('s', 'p', 0, 0), point('s', 'q1', 40, 0), point('s', 'q2', 0, 30), line('s', 'l1', 'p', 'q1', true), line('s', 'l2', 'q2', 'p', true), constrain('s', 'fix', { type: 'coincident', a: 'p', b: 'origin' }), constrain('s', 'h', { type: 'horizontal', line: 'l1' }), constrain('s', 'v', { type: 'vertical', line: 'l2' }), dimension('s', 'w', { type: 'distance', a: 'p', b: 'q1' }, 40), dimension('s', 'd', { type: 'distance', a: 'p', b: 'q2' }, 30)));
    const made = fillet(open, 's', 'p', 6);
    const past = open.preview({ type: 'setConstraintValue', sketch: 's', id: made.ids.radius[0], value: 35 });
    if (!past.ok) throw new Error(past.error.message);
    expect(past.state.evaluation.features.s).toMatchObject({ status: 'ok', warnings: [] });
    // the end of the arc on `l2` is 5 past its far end at (0, 30)
    close(at(past.state, 's', made.ids.ends[made.ids.lines.indexOf('l2')]), 0, 35, 1e-6);
    // the plate 80 × 50 with a fillet at one corner, the radius set to 250: a body that is not the plate
    const engine = plate();
    const corner = fillet(engine, 's', 'o3', 6);
    const wrong = engine.preview({ type: 'setConstraintValue', sketch: 's', id: corner.ids.radius[0], value: 250 });
    if (!wrong.ok) throw new Error(wrong.error.message);
    expect(wrong.state.evaluation.features.E.status).toBe('ok');
    expect(wrong.state.evaluation.features.s.sketch!.valid).toBe(true);
    expect(at(wrong.state, 's', corner.ids.ends[0])[1]).toBeLessThan(0);
    // a closed concave outline with fixed corners, the fillet at its inner corner, radius 35 where it fits below 30
    const concave = newEngine();
    const pts: [Id, number, number][] = [['p0', 0, 0], ['p1', 40, 0], ['p2', 40, -10], ['p3', -10, -10], ['p4', -10, 30], ['p5', 0, 30]];
    run(concave, addSketch('s', XY), batch(...pts.map(([id, x, y]) => point('s', id, x, y)), ...pts.map(([id], i) => line('s', `l${i}`, id, pts[(i + 1) % pts.length][0])), ...pts.map(([id, x, y]) => constrain('s', `fix${id}`, { type: 'fixed', point: id, x, y }))), addExtrude('E', 's', [['l0', 'l1', 'l2', 'l3', 'l4', 'l5']], 10));
    const inner = fillet(concave, 's', 'p0', 6);
    const bad = concave.preview({ type: 'setConstraintValue', sketch: 's', id: inner.ids.radius[0], value: 35 });
    if (!bad.ok) throw new Error(bad.error.message);
    expect(bad.state.evaluation.features.s.status).toBe('ok');
    expect(bad.state.evaluation.features.E.status).toBe('ok');
  });
});
