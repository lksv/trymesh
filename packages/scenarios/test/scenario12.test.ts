// Validation scenario 12 (docs/requirements.md): a box with a lid and screw posts, built by the
// packages of track B of D36 against the real adapters. Each package adds its part:
// - 2a (D44), the profile offset and a wall from a line: the box and its cavity from one outline,
//   the lid with a lip that fits with a print clearance, a rib and a bracket from construction lines.
// - 2b (D45), the taper: a draft on the rib, a lead-in on the lip, and a countersink by hand from
//   a tapered cut and a straight bore.
import { type Command, type Engine, type EngineState, type ExtrudeFeature, type FaceName, type Id, type PlaneRef, type Surface, UPGRADES } from '@trymesh/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { BORE, CONE, FLOOR, LID_TOP, OUTLINE, RIB_LEFT, box, bracket, cavity, countersinkByHand, lid, lipLeadIn, parameters, rib, ribDraft, sketchOn } from './box';
import { XY, expectAllOk, faceBox, faceNames, newEngine, run, status, volume } from './kit';

const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const featureOf = (state: EngineState, id: Id): ExtrudeFeature => state.document.features.find((f) => f.id === id) as ExtrudeFeature;
const preview = (engine: Engine, command: Command): EngineState => {
  const result = engine.preview(command);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
// the block less the cavity, for the wall `w` of the box 80 × 50 × 30 with a floor of 2
const hollow = (w: number): number => 80 * 50 * 30 - (80 - 2 * w) * (50 - 2 * w) * 28;

describe('scenario 12, the part of 2a: a box, its lid and its ribs from offsets and walls', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box());
  });

  it('the cavity is the outline of the box moved inwards by the wall', () => {
    const state = run(engine, cavity());
    expectAllOk(state);
    // the field is in the document with its expression, and the value used is in the result
    expect(featureOf(state, 'cavity').profile).toMatchObject({ type: 'regions', offset: -2 });
    expect(featureOf(state, 'cavity').expressions).toMatchObject({ 'profile/offset': '-wall' });
    expect(state.evaluation.features.cavity.values).toMatchObject({ 'profile/offset': -2 });
    near(volumeOf(state, 'box'), hollow(2));
    // every side face of the cavity keeps the name of its curve and is a plane: a sketch can stand on it
    for (const curve of OUTLINE) {
      const face = state.evaluation.faceNames.findIndex((name) => name.feature === 'cavity' && name.role === 'side' && name.curve === curve);
      expect(state.evaluation.faceSurfaces[face]).toMatchObject({ kind: 'plane' });
    }
    expect(faceBox(state, 'box', { feature: 'cavity', role: 'side', curve: 'oa' })).toMatchObject({ min: [2, 2, 2], max: [78, 2, 30] });
    // the box itself has no offset: its feature is the one of a document before D44
    expect('offset' in featureOf(state, 'box').profile).toBe(false);
  });

  it('the wall follows its parameter, and an offset that makes the outline vanish is an error of the feature', () => {
    near(volumeOf(preview(engine, { type: 'setParameter', name: 'wall', expr: '3' }), 'box'), hollow(3));
    const vanished = preview(engine, { type: 'setField', feature: 'cavity', path: 'profile/offset', value: -30 });
    // the box is 50 wide: moved in by 30, its long sides pass each other and the short ones have no length left
    expect(vanished.evaluation.features.cavity.error).toMatchObject({ code: 'invalidProfile', refs: ['ob', 'od'] });
    expect(vanished.evaluation.features.cavity.error?.message).toMatch(/^The offset of -30 mm leaves no length for the curves "ob", "od".* draw the moved outline in the sketch and extrude that\.$/);
    // the preview changed nothing
    near(volumeOf(engine.getState(), 'box'), hollow(2));
  });

  it('the lid: a plate, a lip with the print clearance and its inside, all from the outline of the box', () => {
    const state = run(engine, lid());
    expectAllOk(state);
    // the plate, plus the ring of the lip: outer 75.6 × 45.6, inner 72.6 × 42.6, 4 high
    near(volumeOf(state, 'lid'), 80 * 50 * 3 + (75.6 * 45.6 - 72.6 * 42.6) * 4);
    expect(faceBox(state, 'lid', { feature: 'lip', role: 'side', curve: 'ob' })).toMatchObject({ min: [expect.closeTo(77.8, 5), expect.closeTo(2.2, 5), 26], max: [expect.closeTo(77.8, 5), expect.closeTo(47.8, 5), 30] });
    // the lid does not collide with the box, and the gap between the lip and the wall is the clearance
    const report = engine.query('interference', { bodies: ['box', 'lid'] });
    expect(report).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
    const gap = engine.query('measure', { from: { kind: 'face', body: 'lid', face: { feature: 'lip', role: 'side', curve: 'ob' } }, to: { kind: 'face', body: 'box', face: { feature: 'cavity', role: 'side', curve: 'ob' } } });
    expect(gap).toMatchObject({ ok: true, result: { distance: expect.closeTo(0.2, 5) } });
  });

  it('the offset is an optional field: setField adds it, updateFeature changes and removes it', () => {
    const added = preview(engine, { type: 'setField', feature: 'lid', path: 'profile/offset', value: '-clearance' });
    expect(status(added)).toMatchObject({ lid: 'ok', lip: 'ok', lipInside: 'ok' });
    expect(featureOf(added, 'lid').profile).toMatchObject({ offset: -0.2 });
    near(volumeOf(added, 'lid'), 79.6 * 49.6 * 3 + (75.6 * 45.6 - 72.6 * 42.6) * 4);
    const changed = preview(engine, { type: 'updateFeature', id: 'lip', patch: { profile: { offset: -2.5 } } });
    expect(status(changed)).toMatchObject({ lip: 'ok' });
    const removed = preview(engine, { type: 'updateFeature', id: 'lip', patch: { profile: { offset: null } } });
    expect(status(removed)).toMatchObject({ lip: 'ok' });
    expect('offset' in featureOf(removed, 'lip').profile).toBe(false);
    expect(featureOf(removed, 'lip').expressions).toEqual({ 'extent/distance': '-lipH', 'extent/start': 'H' });
  });

  it('a rib from one construction line: two sides, a free end, and a sketch on its side', () => {
    const state = run(engine, rib());
    expectAllOk(state);
    // the rib is 1.6 thick and 12 high, from inside the wall (y = 1) to y = 22; one millimetre of it is in the wall
    near(volumeOf(state, 'box'), hollow(2) + 1.6 * 20 * 12);
    const names = state.evaluation.faceNames.filter((name) => name.feature === 'rib');
    expect(names.flatMap((name) => (name.role === 'wallSide' ? [name.side] : [])).sort()).toEqual(['left', 'right']);
    expect(names).toContainEqual({ feature: 'rib', role: 'wallEnd', point: 'r1b' });
    // the end inside the wall is swallowed by the union; the free end and both sides are faces of the box
    expect(faceNames(state, 'box').filter((name) => name.startsWith('rib/'))).toEqual(['rib/endCap', 'rib/wallEnd/r1b', 'rib/wallSide/r1/left', 'rib/wallSide/r1/right']);
    // the sketch stands on the floor of the cavity, so its coordinates are those of the outline, 2 up
    expect(state.evaluation.features.ribs.plane).toMatchObject({ origin: [0, 0, 2], normal: [0, 0, 1] });
    expect(faceBox(state, 'box', RIB_LEFT)).toMatchObject({ min: [expect.closeTo(39.2, 5), 2, 2], max: [expect.closeTo(39.2, 5), 22, 14] });
    expect(FLOOR).toEqual({ feature: 'cavity', role: 'startCap' });
    const onSide = preview(engine, sketchOn('onRib', onFace('box', RIB_LEFT)));
    expect(onSide.evaluation.features.onRib.status).toBe('ok');
    expect(onSide.evaluation.features.onRib.plane?.normal).toEqual([-1, 0, 0]);
  });

  it('a bracket from a chain of two lines: a mitred corner, the thickness a field', () => {
    const state = run(engine, bracket());
    expectAllOk(state);
    expect(featureOf(state, 'bracket').profile).toEqual({ type: 'wall', sketch: 'ribs', curves: ['b12', 'b23'], thickness: 2 });
    expect(featureOf(state, 'bracket').expressions).toEqual({ 'extent/distance': 'ribH' });
    // the centre line runs from (66, 1) over (66, 12) to (79, 12); a mitred band 2 wide has the area
    // of its centre line times its width, less what lies inside the two walls (1 at each end)
    near(volumeOf(state, 'box'), hollow(2) + 1.6 * 20 * 12 + (10 + 12) * 2 * 12, 1e-2);
    expect(faceNames(state, 'box').filter((name) => name.startsWith('bracket/wall'))).toEqual(['bracket/wallSide/b12/left', 'bracket/wallSide/b12/right', 'bracket/wallSide/b23/left', 'bracket/wallSide/b23/right']);
  });

  it('curves that do not form one chain are an error of the feature; a curve that is not in the sketch is an invalid command', () => {
    const apart = preview(engine, { type: 'updateFeature', id: 'bracket', patch: { profile: { curves: ['b12', 'r1'] } } });
    expect(apart.evaluation.features.bracket.error).toMatchObject({ code: 'invalidProfile', refs: ['b12', 'r1'] });
    expect(apart.evaluation.features.bracket.error?.message).toMatch(/not connected/);
    expect(engine.preview({ type: 'updateFeature', id: 'bracket', patch: { profile: { curves: ['b12', 'nope'] } } })).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    // the model stands as it was built
    expectAllOk(engine.getState());
  });

  it('the document of the box loads to the same model', () => {
    const before = engine.getState();
    const other = newEngine();
    const loaded = other.load(engine.save());
    expect(loaded.ok).toBe(true);
    const after = other.getState();
    expect(after.document).toEqual(before.document);
    expectAllOk(after);
    near(volumeOf(after, 'box'), volumeOf(before, 'box'), 1e-9);
  });
});

describe('scenario 12, the part of 2b: a draft, a lead-in and a countersink by hand from tapers', () => {
  let engine: Engine;
  const same = (a: FaceName, b: FaceName): boolean => JSON.stringify(a) === JSON.stringify(b);
  const surfaceOf = (state: EngineState, name: FaceName): Surface => state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((other) => same(other, name))];
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket());
  });

  it('a draft on the rib: the sides are still planes, narrower at the top, and a sketch stands on one', () => {
    const before = volumeOf(engine.getState(), 'box');
    const state = run(engine, ribDraft());
    expectAllOk(state);
    expect(featureOf(state, 'rib').extent).toMatchObject({ type: 'distance', taper: expect.closeTo(-Math.PI / 60, 12) });
    expect(featureOf(state, 'rib').expressions).toMatchObject({ 'extent/taper': 'deg(-3)' });
    expect(surfaceOf(state, RIB_LEFT).kind).toBe('plane');
    // 1.6 at the floor, 1.6 − 2 · 12 tan 3° = 0.342 at the top; the free end leans too
    expect(volumeOf(state, 'box')).toBeLessThan(before);
    const top = faceBox(state, 'box', { feature: 'rib', role: 'endCap' });
    expect((top?.max[0] ?? 0) - (top?.min[0] ?? 0)).toBeCloseTo(1.6 - 24 * Math.tan(Math.PI / 60), 4);
    const onSide = preview(engine, sketchOn('onDraft', onFace('box', RIB_LEFT)));
    expect(onSide.evaluation.features.onDraft.status).toBe('ok');
    near(Math.abs(onSide.evaluation.features.onDraft.plane?.normal[2] ?? 0), Math.sin(Math.PI / 60), 1e-9);
  });

  it('a lead-in on the lip: setField adds the taper, the lip is 0.79 thick at its free end and still clears the box', () => {
    const state = run(engine, lipLeadIn());
    expectAllOk(state);
    expect(featureOf(state, 'lip').extent).toMatchObject({ taper: expect.closeTo(-Math.PI / 18, 12) });
    // the lip narrows by 4 tan 10° on every side towards its free end; its inside does not
    const free = 1.5 - 4 * Math.tan(Math.PI / 18);
    expect(free).toBeCloseTo(0.795, 3);
    expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('a countersink by hand: a cone between the top of the lid and the bore, its rims circles', () => {
    const before = volumeOf(engine.getState(), 'lid');
    const state = run(engine, countersinkByHand());
    expectAllOk(state);
    // the cone: a hole, with the half angle of the taper; its apex below the mouth by the radius of the mouth
    const body = engine.query('body', { body: 'lid' });
    if (!body.ok) throw new Error(body.error.message);
    const cone = (body.result as { faces: { name: FaceName; surface: Surface; convex?: boolean }[] }).faces.find((face) => same(face.name, CONE));
    expect(cone?.surface).toMatchObject({ kind: 'cone', halfAngle: expect.closeTo(Math.PI / 4, 9), axis: [0, 0, 1] });
    expect(cone?.convex).toBe(false);
    near((cone?.surface as Extract<Surface, { kind: 'cone' }>).apex[2], 33 - 4, 1e-9);
    // the volume taken: the frustum of 1.5 from radius 4 to 2.5, then the bore of 2.5 through the rest
    expect(volumeOf(state, 'lid')).toBeLessThan(before);
    // both rims are circles, and a sketch projects them
    const rims = run(
      engine,
      sketchOn('rims', XY),
      { type: 'addExternal', sketch: 'rims', id: 'mouth', ref: { type: 'edge', body: 'lid', edge: { a: LID_TOP, b: CONE }, kind: 'circle' } },
      { type: 'addExternal', sketch: 'rims', id: 'lower', ref: { type: 'edge', body: 'lid', edge: { a: BORE, b: CONE }, kind: 'circle' } },
    );
    expect(rims.evaluation.features.rims.status).toBe('ok');
    const radii = rims.evaluation.features.rims.sketch?.radii ?? {};
    near(radii.mouth, 4, 1e-9);
    near(radii.lower, 2.5, 1e-9);
    const kinds = rims.evaluation.bodies.lid.edges.filter((edge) => same(edge.name.a, CONE) || same(edge.name.b, CONE)).map((edge) => edge.kind);
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(kinds.every((kind) => kind === 'circle')).toBe(true);
  });

  it('refusals: a taper under which the far profile vanishes, and a taper on through all', () => {
    const steep = preview(engine, { type: 'setField', feature: 'sink', path: 'extent/taper', value: 'deg(-80)' });
    expect(steep.evaluation.features.sink.error).toMatchObject({ code: 'invalidProfile', refs: ['wide'] });
    expect(steep.evaluation.features.sink.error?.message).toMatch(/^At the far end of the extrusion/);
    // another variant of the extent replaces it, the taper with it; a taper on through all is refused
    expect(engine.preview({ type: 'updateFeature', id: 'sink', patch: { extent: { type: 'throughAll', side: 'backward' } } }).ok).toBe(true);
    expect(engine.preview({ type: 'updateFeature', id: 'sink', patch: { extent: { type: 'throughAll', side: 'backward', taper: 0.1 } as never } })).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
  });

  it('the step of the schema is in the list, and the document loads to the same model', () => {
    expect(UPGRADES.some((step) => step.name === '2b-taper')).toBe(true);
    const before = engine.getState();
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    near(volumeOf(other.getState(), 'lid'), volumeOf(before, 'lid'), 1e-9);
  });
});
