// The boolean of bodies, the subtraction with a clearance and the split (D56) against the real
// adapters (docs/d36/3d-body-boolean/design.md, "Tests the implementation owes").
import type { CommandResult, Engine, EngineState, FaceName } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { booleanOfBodies } from '../../engine/src/recompute/body-boolean';
import { isMoveProblem, movedOutwards } from '../../engine/src/recompute/moved-body';
import { batch, box, codeOf, combine, cylinder, faceNumber, hasFace, infosOf, onFace, plane, prism, sketchOn, solidOf, split, surfaceOf, volumeOf } from './combine-kit';
import { newEngine, run } from './kit';
import { createManifoldKernel } from '@trymesh/kernel-manifold';

const port = await createManifoldKernel();

const done = (result: CommandResult): EngineState => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const built = (...commands: Parameters<typeof batch>): { engine: Engine; state: EngineState } => {
  const engine = newEngine();
  return { engine, state: run(engine, batch(...commands)) };
};
const TOP: FaceName = { feature: 'A', role: 'endCap' };

describe('combine: a boolean of finished bodies', () => {
  it('a union of two boxes: one body under the target, faces under their names, the tool used up', () => {
    const { engine, state: before } = built(...box('A', 0, 0, 20, 10, 0, 10), ...box('B', 10, 0, 30, 10, 0, 10));
    const state = run(engine, combine('K', { operation: 'union', target: 'A', tools: ['B'], keepTools: false }));
    expect(state.evaluation.features.K).toMatchObject({ status: 'ok', bodies: [] });
    expect(volumeOf(state, 'A')).toBeCloseTo(3000, 6);
    expect('B' in state.evaluation.bodies).toBe(false);
    expect('B' in before.evaluation.bodies).toBe(true);
    expect(hasFace(state, 'A', { feature: 'B', role: 'side', curve: 'BL1' }) && hasFace(state, 'A', { feature: 'A', role: 'side', curve: 'AL3' })).toBe(true);
    // a later feature that names the used-up tool is a broken reference, the command is valid
    expect(codeOf(done(engine.preview(batch(...cylinder('late', 25, 5, 1, -1, 11, 'cut', ['B'])))), 'late')).toBe('brokenReference');
    engine.undo();
    expect('B' in engine.getState().evaluation.bodies).toBe(true);
  });

  it('a difference with a kept tool: the faces it leaves carry its names, one face on two bodies', () => {
    const { engine } = built(...box('A', 0, 0, 20, 20, 0, 10), ...cylinder('pin', 10, 10, 3, -5, 15));
    const state = run(engine, combine('K', { operation: 'difference', target: 'A', tools: ['pin'], keepTools: true }));
    const wall: FaceName = { feature: 'pin', role: 'side', curve: 'pinCircle' };
    expect(hasFace(state, 'A', wall) && hasFace(state, 'pin', wall)).toBe(true);
    expect(volumeOf(state, 'A')).toBeCloseTo(4000 - volumeOf(state, 'pin') / 2, 1);
  });

  it('an intersection; several tools one after another; a tool that misses; a target used up whole', () => {
    const { engine } = built(...box('A', 0, 0, 20, 20, 0, 10), ...box('B', 10, 10, 30, 30, 5, 15), ...box('C', 100, 0, 110, 10, 0, 10), ...box('D', -5, -5, 25, 25, -5, 15));
    expect(volumeOf(done(engine.preview(combine('K', { operation: 'intersection', target: 'A', tools: ['B'], keepTools: true }))), 'A')).toBeCloseTo(500, 6);
    const two = done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['B', 'C'], keepTools: true })));
    expect(volumeOf(two, 'A')).toBeCloseTo(3500, 6);
    expect(two.evaluation.features.K).toMatchObject({ status: 'warning', warnings: [{ code: 'noEffect', refs: ['C'] }] });
    expect(two.evaluation.features.K.warnings[0].message).toMatch(/only the tools in refs/);
    // a tool that misses leaves the model all the same when it is used up
    const missed = done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['C'], keepTools: false })));
    expect(missed.evaluation.features.K.warnings[0]).toMatchObject({ code: 'noEffect', refs: ['C'] });
    expect('C' in missed.evaluation.bodies).toBe(false);
    // nothing of the target left; an intersection with nothing shared
    expect(codeOf(done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['D'], keepTools: true }))), 'K')).toBe('emptyResult');
    const none = done(engine.preview(combine('K', { operation: 'intersection', target: 'A', tools: ['C'], keepTools: false })));
    expect(codeOf(none, 'K')).toBe('emptyResult');
    // in error the feature changes nothing: the tool did not leave
    expect('C' in none.evaluation.bodies).toBe(true);
  });

  it('bodies that share face numbers: the two parts of a split joined again, a kept tool subtracted twice', () => {
    const { engine } = built(...box('A', 0, 0, 20, 20, 0, 10), plane('mid', 'YZ', 7), split('S', { body: 'A', plane: { kind: 'plane', feature: 'mid' }, side: 'forward' }), ...cylinder('pin', 10, 10, 3, -5, 15));
    // the adapter refuses operands that share a number; the engine gives the tool its own for the call
    const joined = run(engine, combine('J', { operation: 'union', target: 'A', tools: ['S'], keepTools: false }));
    expect(joined.evaluation.features.J.status).toBe('ok');
    expect(volumeOf(joined, 'A')).toBeCloseTo(4000, 3);
    const once = run(engine, combine('K1', { operation: 'difference', target: 'A', tools: ['pin'], keepTools: true }));
    const twice = run(engine, combine('K2', { operation: 'difference', target: 'A', tools: ['pin'], keepTools: true }));
    expect(twice.evaluation.features.K2).toMatchObject({ status: 'warning', warnings: [{ code: 'noEffect', refs: ['pin'] }] });
    expect(volumeOf(twice, 'A')).toBe(volumeOf(once, 'A'));
  });

  it('the patch of the operation drops the clearance; undo of a combine is one step', () => {
    const { engine } = built(...box('A', 0, 0, 20, 20, 0, 10), ...box('B', 5, 5, 15, 15, 5, 15));
    run(engine, combine('K', { operation: 'difference', target: 'A', tools: ['B'], keepTools: true, clearance: 0.5 }));
    const union = run(engine, { type: 'updateFeature', id: 'K', patch: { operation: 'union' } });
    expect(union.document.features.find((f) => f.id === 'K')).not.toHaveProperty('clearance');
    engine.undo();
    expect(engine.getState().document.features.find((f) => f.id === 'K')).toMatchObject({ operation: 'difference', clearance: 0.5 });
  });
});

describe('the clearance: every face of a tool moved outwards along its own surface', () => {
  it('a box in a block: the pocket is the box grown by the clearance, its faces exact and tagged, a sketch on its floor', () => {
    const { engine } = built(...box('A', 0, 0, 40, 30, 0, 20), ...box('B', 10, 10, 20, 20, 10, 25));
    const state = run(engine, combine('K', { operation: 'difference', target: 'A', tools: ['B'], keepTools: true, clearance: 0.5 }));
    const floor: FaceName = { feature: 'B', role: 'startCap', copy: [{ pattern: 'K', index: 1 }] };
    const wall: FaceName = { feature: 'B', role: 'side', curve: 'BL1', copy: [{ pattern: 'K', index: 1 }] };
    expect(surfaceOf(state, floor)).toMatchObject({ kind: 'plane', normal: [0, 0, 1] });
    expect((surfaceOf(state, floor) as { origin: number[] }).origin[2]).toBeCloseTo(9.5, 12);
    expect((surfaceOf(state, wall) as { origin: number[] }).origin[0]).toBeCloseTo(20.5, 12);
    expect(volumeOf(state, 'A')).toBeCloseTo(24000 - 11 * 11 * 10.5, 6);
    // the box itself is not changed
    expect(volumeOf(state, 'B')).toBeCloseTo(1500, 6);
    const onFloor = done(engine.preview(batch(...sketchOn('F', onFace('A', floor)))));
    expect(onFloor.evaluation.features.F.plane?.origin[2]).toBeCloseTo(9.5, 9);
    // a measure between the box and the pocket is the clearance, exactly
    const measured = engine.query('measure', { from: { kind: 'face', body: 'B', face: { feature: 'B', role: 'startCap' } }, to: { kind: 'face', body: 'A', face: floor } });
    expect(measured.ok && measured.result.distance).toBeCloseTo(0.5, 9);
  });

  it('a pin in a plate: the hole is a cylinder of the radius plus the clearance; a tool with tags already gets one more', () => {
    const { engine } = built(...box('A', 0, 0, 40, 40, 0, 10), ...cylinder('pin', 10, 10, 3, -5, 15), { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'pin' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 20 } } } });
    const state = run(engine, combine('K', { operation: 'difference', target: 'A', tools: ['pin', 'P/1'], keepTools: true, clearance: 0.25 }));
    const hole: FaceName = { feature: 'pin', role: 'side', curve: 'pinCircle', copy: [{ pattern: 'P', index: 1 }, { pattern: 'K', index: 2 }] };
    expect(surfaceOf(state, hole)).toMatchObject({ kind: 'cylinder', radius: 3.25 });
    expect((surfaceOf(state, hole) as { origin: number[] }).origin[0]).toBeCloseTo(30, 9);
    expect(hasFace(state, 'A', hole)).toBe(true);
  });

  it('a tool that cannot be moved: invalidClearance with the tool and the faces, or a clearance too small', () => {
    // a C whose tips are 0.4 apart: their moved faces would meet at a clearance of 0.3
    const C: [number, number][] = [[0, 0], [10, 0], [10, 4.8], [2, 4.8], [2, 5.2], [10, 5.2], [10, 10], [0, 10]];
    const { engine } = built(...box('A', -5, -5, 20, 20, 0, 10), ...prism('c', C, 2, 8), ...cylinder('pin', 15, 15, 2, 2, 8));
    const near = done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['c'], keepTools: true, clearance: 0.3 }))).evaluation.features.K.error;
    expect(near?.code).toBe('invalidClearance');
    expect(near?.refs?.[0]).toBe('c');
    expect(near?.message).toMatch(/nearer than the clearance/);
    expect(done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['c'], keepTools: true, clearance: 0.1 }))).evaluation.features.K.status).toBe('ok');
    // not more than twice the chord tolerance (0.01) on a tool with a round face: too small, no faces
    const small = done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['pin'], keepTools: true, clearance: 0.015 }))).evaluation.features.K.error;
    expect(small).toMatchObject({ code: 'invalidClearance', refs: ['pin'] });
    // a tool of planar faces only has no polygons
    expect(done(engine.preview(combine('K', { operation: 'difference', target: 'A', tools: ['c'], keepTools: true, clearance: 0.015 }))).evaluation.features.K.status).toBe('ok');
  });

  it('a countersink made by hand (a cone that ends on its bore): the crescent between the two polygons has no face in the pocket', () => {
    const { state } = built(...box('A', -5, -5, 5, 5, 0, 4), ...cylinder('sink', 0, 0, 1, 2, 4.0001, 'cut', ['A'], 'deg(44.98)'), ...cylinder('bore', 0, 0, 1, -1, 5, 'cut', ['A']));
    const crescent = faceNumber(state, { feature: 'sink', role: 'startCap' });
    expect(solidOf(state, 'A').faceIds.includes(crescent)).toBe(true);
    const moved = movedOutwards(solidOf(state, 'A'), infosOf(state), state.evaluation.faceNames, 0.3, 0.01, port);
    if (isMoveProblem(moved)) throw new Error(`${moved.reason}: ${moved.detail}`);
    expect(moved.infos.has(crescent)).toBe(false);
    expect(moved.solid.faceIds.includes(crescent)).toBe(false);
    // every face the moved body has is described
    expect([...new Set(moved.solid.faceIds)].every((face) => moved.infos.has(face))).toBe(true);
  });

  it('the memo: the same tool, clearance and chord tolerance give the same moved body', () => {
    const { state } = built(...cylinder('pin', 0, 0, 3, 0, 10));
    const infos = infosOf(state);
    const first = movedOutwards(solidOf(state, 'pin'), infos, state.evaluation.faceNames, 0.2, 0.01, port);
    expect(isMoveProblem(first)).toBe(false);
    expect(movedOutwards(solidOf(state, 'pin'), infos, state.evaluation.faceNames, 0.2, 0.01, port)).toBe(first);
    expect(movedOutwards(solidOf(state, 'pin'), infos, state.evaluation.faceNames, 0.3, 0.01, port)).not.toBe(first);
  });
});

describe('split: a body cut by a plane into two', () => {
  it('both sides; one cut face on both bodies, a sketch on either; the new body takes after the body', () => {
    const { engine } = built(...box('A', 0, 0, 20, 10, 0, 10), plane('mid', 'XY', 4), { type: 'setBodyMaterial', body: 'A', material: 'PLA' });
    const state = run(engine, split('S', { body: 'A', plane: { kind: 'plane', feature: 'mid' }, side: 'forward' }));
    expect(state.evaluation.features.S.bodies).toEqual(['S']);
    expect(volumeOf(state, 'A')).toBeCloseTo(800, 6);
    expect(volumeOf(state, 'S')).toBeCloseTo(1200, 6);
    const cut: FaceName = { feature: 'S', role: 'splitFace' };
    expect(hasFace(state, 'A', cut) && hasFace(state, 'S', cut)).toBe(true);
    const sketches = done(engine.preview(batch(...sketchOn('onA', onFace('A', cut)), ...sketchOn('onS', onFace('S', cut)))));
    expect(sketches.evaluation.features.onA.plane?.normal[2]).toBeCloseTo(1, 12);
    expect(sketches.evaluation.features.onS.plane?.normal[2]).toBeCloseTo(-1, 12);
    expect(state.evaluation.bodyProperties.S).toMatchObject({ from: 'A', material: 'PLA' });
    const other = done(engine.preview({ type: 'updateFeature', id: 'S', patch: { side: 'backward' } }));
    expect([volumeOf(other, 'A'), volumeOf(other, 'S')].map((v) => Math.round(v))).toEqual([1200, 800]);
  });

  it('a face of the body as the plane; a plane beside the body; a body of two pieces with the plane between them', () => {
    const { engine } = built(...box('A', 0, 0, 20, 10, 0, 10), ...box('step', 10, -1, 21, 11, 6, 11, 'cut', ['A']), ...box('far', 40, 0, 50, 10, 0, 10, 'add', ['A']));
    // the floor of the step (z = 6), a face of A, cuts A across at that height: above it the part
    // left of the step and the upper part of the far piece
    const atStep = done(engine.preview(split('S', { body: 'A', plane: onFace('A', { feature: 'step', role: 'startCap' }), side: 'forward' })));
    expect(volumeOf(atStep, 'S')).toBeCloseTo(10 * 10 * 4 + 10 * 10 * 4, 6);
    expect(codeOf(done(engine.preview(split('S', { body: 'A', plane: { kind: 'base', plane: 'XY' }, side: 'forward' }))), 'S')).toBe('emptyResult');
    // the plane x = 30 lies between the two pieces: taken apart, without a cut face
    const apart = done(engine.preview(batch(plane('x30', 'YZ', 30), split('S', { body: 'A', plane: { kind: 'plane', feature: 'x30' }, side: 'forward' }))));
    expect(apart.evaluation.features.S.status).toBe('ok');
    expect(volumeOf(apart, 'S')).toBeCloseTo(1000, 6);
    expect(hasFace(apart, 'S', { feature: 'S', role: 'splitFace' })).toBe(false);
  });

  it('a pattern of the new body; a split put before a cut leaves the cut on the part that kept the ID', () => {
    const { engine } = built(...box('A', 0, 0, 20, 10, 0, 10), plane('mid', 'XY', 5), ...cylinder('hole', 5, 5, 1, -1, 11, 'cut', ['A']));
    const before = engine.getState().document.features.findIndex((f) => f.id === 'hole');
    const state = run(engine, split('S', { body: 'A', plane: { kind: 'plane', feature: 'mid' }, side: 'forward' }, before));
    // the hole went through the part that kept the ID only
    expect(volumeOf(state, 'S')).toBeCloseTo(20 * 10 * 5, 6);
    expect(volumeOf(state, 'A')).toBeLessThan(20 * 10 * 5);
    const copies = run(engine, { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'S' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 30 } } } });
    expect(volumeOf(copies, 'P/1')).toBeCloseTo(1000, 6);
  });
});

describe('the checks of the result (booleanOfBodies)', () => {
  it('a union that changes nothing, an intersection of bodies that only touch, the numbers of the tool put back', () => {
    const { state } = built(...box('A', 0, 0, 40, 30, 0, 20), ...box('in', 5, 5, 10, 10, 5, 10), ...box('touch', 40, 0, 50, 30, 0, 20));
    const [A, inside, touch] = [solidOf(state, 'A'), solidOf(state, 'in'), solidOf(state, 'touch')];
    const first = state.evaluation.faceNames.length;
    expect(booleanOfBodies(port, 'union', A, inside, first, 0.01)).toEqual({ solid: A, changed: false });
    expect(booleanOfBodies(port, 'intersection', A, touch, first, 0.01).solid.triangles.length).toBe(0);
    const difference = booleanOfBodies(port, 'difference', A, inside, first, 0.01);
    expect(difference.changed).toBe(true);
    // the tool's numbers are put back in the result
    expect(new Set(difference.solid.faceIds).has(solidOf(state, 'in').faceIds[0])).toBe(true);
  });
});

describe('the reasons of a refusal of the move, with their faces (the rest are pinned in spikes/moved-fuzz.spike.ts)', () => {
  const move = (state: EngineState, body: string, c: number, infos = infosOf(state), solid = solidOf(state, body)) => movedOutwards(solid, infos, state.evaluation.faceNames, c, 0.01, port);
  const reasonOf = (moved: ReturnType<typeof movedOutwards>): string => (isMoveProblem(moved) ? moved.reason : 'accepted');

  it('closes: a hole no wider than the clearance, named', () => {
    const { state } = built(...box('A', 0, 0, 20, 20, 0, 10), ...cylinder('hole', 10, 10, 1, -1, 11, 'cut', ['A']));
    const moved = move(state, 'A', 1);
    expect(isMoveProblem(moved) && [moved.reason, moved.faces]).toEqual(['closes', [{ feature: 'hole', role: 'side', curve: 'holeCircle' }]]);
    expect(reasonOf(move(state, 'A', 0.5))).toBe('accepted');
  });

  it('noSurface: a face without a description; bothSides: one face number on a pin and on a hole', () => {
    const { state } = built(...box('A', 0, 0, 20, 20, 0, 10), ...cylinder('hole', 5, 5, 1, -1, 11, 'cut', ['A']), ...cylinder('pin', 15, 15, 1, 10, 14, 'add', ['A']));
    const pin = faceNumber(state, { feature: 'pin', role: 'side', curve: 'pinCircle' });
    const hole = faceNumber(state, { feature: 'hole', role: 'side', curve: 'holeCircle' });
    const infos = infosOf(state);
    const unknown = move(state, 'A', 0.2, infos.map((info, face) => (face === pin ? (undefined as never) : info)));
    expect(isMoveProblem(unknown) && [unknown.reason, unknown.faces]).toEqual(['noSurface', [{ feature: 'pin', role: 'side', curve: 'pinCircle' }]]);
    // the hole's side renumbered as the pin's: one number with material inside and outside its cylinder
    const solid = solidOf(state, 'A');
    const merged = { ...solid, faceIds: solid.faceIds.map((face) => (face === hole ? pin : face)) };
    const both = move(state, 'A', 0.2, infos.map((info, face) => (face === pin ? { ...info } : info)), merged);
    expect(reasonOf(both)).toBe('bothSides');
  });

  it('tooSmall without faces; tooNear with the two faces', () => {
    const { state } = built(...prism('c', [[0, 0], [10, 0], [10, 4.8], [2, 4.8], [2, 5.2], [10, 5.2], [10, 10], [0, 10]], 0, 5), ...cylinder('pin', 20, 20, 2, 0, 5));
    const small = move(state, 'c', 1e-5);
    expect(isMoveProblem(small) && [small.reason, small.faces]).toEqual(['tooSmall', []]);
    const near = move(state, 'c', 0.3);
    expect(isMoveProblem(near) && near.reason).toBe('tooNear');
    expect(isMoveProblem(near) && near.faces.length).toBe(2);
  });

  it('a cone moves by its apex: the pocket of a tapered pin is a cone of the same angle', () => {
    const { engine } = built(...box('A', -10, -10, 10, 10, 0, 10), ...cylinder('pin', 0, 0, 3, 2, 12, 'new', undefined, 'deg(-5)'));
    const state = run(engine, combine('K', { operation: 'difference', target: 'A', tools: ['pin'], keepTools: true, clearance: 0.4 }));
    const [tool, pocket] = [surfaceOf(state, { feature: 'pin', role: 'side', curve: 'pinCircle' }), surfaceOf(state, { feature: 'pin', role: 'side', curve: 'pinCircle', copy: [{ pattern: 'K', index: 1 }] })];
    expect(tool?.kind === 'cone' && pocket?.kind === 'cone').toBe(true);
    if (tool?.kind !== 'cone' || pocket?.kind !== 'cone') return;
    expect(pocket.halfAngle).toBeCloseTo(tool.halfAngle, 12);
    // the apex moved along the axis by c over the sine of the half angle
    expect(Math.hypot(...[0, 1, 2].map((k) => pocket.apex[k] - tool.apex[k]))).toBeCloseTo(0.4 / Math.sin(tool.halfAngle), 9);
  });
});

describe('the checks of the result: the cases the design measured', () => {
  const first = (state: EngineState): number => state.evaluation.faceNames.length;

  it('a slab 1e-4 from flush on the target: the range of the shared volume lets the right answer pass', () => {
    const { state } = built(...box('A', 0, 0, 40, 30, 0, 20), ...box('slab', 5, 5, 15, 15, 20.0001, 25), ...box('sunk', 5, 5, 15, 15, 19.9999, 25), ...box('cube', 25, 15, 30, 20, 5, 10));
    const [A, slab, sunk] = [solidOf(state, 'A'), solidOf(state, 'slab'), solidOf(state, 'sunk')];
    // a difference with a slab above the top changes nothing; a union is the two together
    expect(booleanOfBodies(port, 'difference', A, slab, first(state), 0.01).changed).toBe(false);
    // as a union the adapter leaves the band its shift opened as material (a silent defect of the
    // adapter, design "Verified", 2): the volume check turns it into a refusal
    expect(() => booleanOfBodies(port, 'union', A, slab, first(state), 0.01)).toThrow(/volume of the result of the union is off/);
    // a slab sunk 1e-4 into the top, together with a cube inside: the cube is cut, the slab a sliver within the band
    const both = { ...sunk, positions: Float32Array.from([...sunk.positions, ...solidOf(state, 'cube').positions]), triangles: Uint32Array.from([...sunk.triangles, ...Array.from(solidOf(state, 'cube').triangles, (v) => v + sunk.positions.length / 3)]), faceIds: Uint32Array.from([...sunk.faceIds, ...solidOf(state, 'cube').faceIds]) };
    const cut = booleanOfBodies(port, 'difference', A, both, first(state), 0.01);
    expect(cut.changed).toBe(true);
  });

  it('an intersection that is a slab thinner than the sheet tolerance yet holds more than 0.001 mm³ is refused, not dropped', () => {
    // 0.0002 thick, 0.24 mm³: its two large faces lie back to back (the sheet tolerance is 0.0004 here)
    const { state } = built(...box('A', 0, 0, 40, 30, 0, 10), ...box('B', 0, 0, 40, 30, 9.9998, 20));
    expect(() => booleanOfBodies(port, 'intersection', solidOf(state, 'A'), solidOf(state, 'B'), first(state), 0.01)).toThrow(/back to back|thinner than the kernel can tell/);
  });

  it('an intersection with a tool around the target changes nothing; one that trims a sliver off changes it', () => {
    const { state } = built(...box('A', 0, 0, 40, 30, 0, 10), ...box('around', -1, -1, 41, 31, -1, 11), ...box('trim', -1, -1, 39.9, 31, -1, 11));
    const A = solidOf(state, 'A');
    expect(booleanOfBodies(port, 'intersection', A, solidOf(state, 'around'), first(state), 0.01).changed).toBe(false);
    const trimmed = booleanOfBodies(port, 'intersection', A, solidOf(state, 'trim'), first(state), 0.01);
    expect(trimmed.changed).toBe(true);
  });
});

describe('what a used-up tool and a split leave behind', () => {
  it('the entry of body properties of a used-up tool stays in the document without its body', () => {
    const { engine } = built(...box('A', 0, 0, 20, 10, 0, 10), ...box('B', 10, 0, 30, 10, 0, 10), { type: 'setBodyProperties', body: 'B', patch: { name: 'Lid' } });
    const state = run(engine, combine('K', { operation: 'union', target: 'A', tools: ['B'], keepTools: false }));
    expect(state.document.bodyProperties.B).toEqual({ name: 'Lid' });
    expect('B' in state.evaluation.bodyProperties).toBe(false);
  });

  it('a face of the body named on the part that lost it is a broken reference; on the part that has it, a plane', () => {
    const { engine } = built(...box('A', 0, 0, 20, 10, 0, 10), plane('mid', 'XY', 4), split('S', { body: 'A', plane: { kind: 'plane', feature: 'mid' }, side: 'forward' }));
    const top: FaceName = { feature: 'A', role: 'endCap' };
    const state = done(engine.preview(batch(...sketchOn('lost', onFace('A', top)), ...sketchOn('kept', onFace('S', top)))));
    expect(codeOf(state, 'lost')).toBe('brokenReference');
    expect(state.evaluation.features.kept.plane?.origin[2]).toBeCloseTo(10, 9);
  });
});
