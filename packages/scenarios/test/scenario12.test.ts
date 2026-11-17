// Validation scenario 12 (docs/requirements.md): a box with a lid and screw posts, built by the
// packages of track B of D36 against the real adapters. Each package adds its part:
// - 2a (D44), the profile offset and a wall from a line: the box and its cavity from one outline,
//   the lid with a lip that fits with a print clearance, a rib and a bracket from construction lines.
// - 2b (D45), the taper: a draft on the rib, a lead-in on the lip, and a countersink by hand from
//   a tapered cut and a straight bore.
// - 2f (D47), the extent up to a plane: screw posts up to the underside of the lid, a brace up to
//   the drafted side of the rib.
// - 2c (D46), the hole feature and the hardware catalogs: the lid screwed to the posts with
//   countersunk screws (then socket heads and nut pockets instead, as previews), heat-set inserts in
//   the posts and a pattern of them. No size of a part is written here: every one comes from the
//   query `hardwareHole` and the catalogs.
// - 2e (D53), the linear pattern and the mirror: a row of vent slots in the long wall, the rib and
//   its brace mirrored to the other long wall, pads under the corners as mirrors of one body, and
//   the lid in a row for the print bed.
import { type Command, DATA_CATALOGS, type EdgeName, type Engine, type EngineState, type Exported, type ExportFile, type ExtrudeFeature, type FaceName, FEATURE_TYPE_INFO, type HoleFeature, type Id, type MeshAbout, type OutlineAbout, type PatternFeature, type PlaneRef, producesTool, type QueryOutcome, SCHEMA_VERSION, type SketchFeature, type SolveInput, type Surface, UPGRADES, faceKey, freshIds, sketchTool, zip } from '@trymesh/engine';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { readZip } from '../../engine/test/zip-reader';
import { NO_PRINTED_BODY } from '../../engine/src/export/bodies';
import { QUARTER, TURN_ALLOWANCE } from '../../engine/src/export/outline';
import { beforeAll, describe, expect, it } from 'vitest';
import { BORE, CONE, FLOOR, LID_TOP, MID_W, OUTLINE, PADS, POST_TOP, RIB_LEFT, RIB_LEFT_COPY, SCREW_POINTS, UNDER_LID, WALL_OUT, box, brace, bracket, cavity, countersinkByHand, insertHoles, lid, lidsInARow, lipLeadIn, midPlanes, pads, parameters, pointAt, posts, rib, ribDraft, ribMirror, screwHoles, secondDirection, sixLids, sketchOn, vents, ventsOnBothWalls, drains } from './box';
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
    // the lip narrows by 4 tan 10° on every side towards its free end (z = 26); its inside does not
    const lean = 4 * Math.tan(Math.PI / 18);
    const outer = faceBox(state, 'lid', { feature: 'lip', role: 'side', curve: 'ob' });
    expect(outer?.max[0]).toBeCloseTo(77.8, 4);
    expect(outer?.min[0]).toBeCloseTo(77.8 - lean, 4);
    const inner = faceBox(state, 'lid', { feature: 'lipInside', role: 'side', curve: 'ob' });
    expect(inner?.min[0]).toBeCloseTo(76.3, 4);
    // so the lip is 1.5 thick at the plate and 0.795 at its free end
    expect((outer?.min[0] ?? 0) - (inner?.max[0] ?? 0)).toBeCloseTo(0.795, 3);
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
    // the volume taken: the frustum of 1.5 from radius 4 to 2.5, then the bore of 2.5 through the
    // rest of the plate (1.5), each a regular polygon of the count for its larger radius
    const sides = (radius: number): number => Math.ceil((2 * Math.PI) / (2 * Math.acos(1 - 0.01 / radius)) - 1e-9);
    const area = (n: number, r: number): number => (n / 2) * Math.sin((2 * Math.PI) / n) * r * r;
    const frustum = (area(sides(4), 1) * 1.5 * (16 + 10 + 6.25)) / 3;
    near(before - volumeOf(state, 'lid'), frustum + area(sides(2.5), 2.5) * 1.5, 0.02);
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

describe('scenario 12, the part of 2f: screw posts up to the lid and a brace up to the rib', () => {
  let engine: Engine;
  const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn());
  });

  it('the posts stand on the floor and end at the underside of the lid; the pattern adds the other two', () => {
    const state = run(engine, posts());
    expectAllOk(state);
    // the lid is parallel to the floor: one length, from the floor to the lid
    expect(state.evaluation.features.posts.facts).toEqual({ lengthMin: 28, lengthMax: 28, forward: true });
    expect(faceBox(state, 'box', POST_TOP)).toMatchObject({ min: [expect.anything(), expect.anything(), 30], max: [expect.anything(), expect.anything(), 30] });
    const copy = faceBox(state, 'box', { ...POST_TOP, copy: [{ pattern: 'postPattern', index: 1 }] });
    expect(copy?.max[2]).toBeCloseTo(30, 9);
    // the posts touch the lid and do not collide with it
    expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('the posts follow the lid; a gap stops them short of it; a gap as large as the way is an error', () => {
    const higher = preview(engine, { type: 'setParameter', name: 'H', expr: '40' });
    expect(higher.evaluation.features.posts.facts).toEqual({ lengthMin: 38, lengthMax: 38, forward: true });
    expect(higher.evaluation.features.postPattern.status).toBe('ok');
    expect(engine.query('interference', { bodies: ['box', 'lid'] }, { state: higher })).toMatchObject({ ok: true, result: { pairs: [] } });
    const short = preview(engine, { type: 'setField', feature: 'posts', path: 'extent/gap', value: 0.2 });
    expect(short.evaluation.features.posts.facts?.lengthMin).toBeCloseTo(27.8, 9);
    expect(featureOf(short, 'posts').extent).toMatchObject({ type: 'upTo', gap: 0.2 });
    expect(errorOf(preview(engine, { type: 'setField', feature: 'posts', path: 'extent/gap', value: 100 }), 'posts')?.code).toBe('invalidExtent');
  });

  it('the top of a post is a face a sketch stands on', () => {
    const state = run(engine, sketchOn('tops', onFace('box', POST_TOP)));
    expect(state.evaluation.features.tops.status).toBe('ok');
    expect(state.evaluation.features.tops.plane).toMatchObject({ normal: [0, 0, 1] });
  });

  it('a brace from the wall of the cavity ends in the drafted side of the rib: two lengths', () => {
    const state = run(engine, brace());
    expectAllOk(state);
    const facts = state.evaluation.features.brace.facts;
    expect(facts?.forward).toBe(true);
    // the side of the rib leans by 3°: the brace of radius 1.5 is longer at its bottom than at its top
    expect((facts?.lengthMax as number) - (facts?.lengthMin as number)).toBeCloseTo(3 * Math.tan(Math.PI / 60), 2);
    expect((facts?.lengthMin as number) > 37 && (facts?.lengthMax as number) < 38).toBe(true);
  });

  it('refusals: a parallel wall, the floor the posts stand on, a face of a later feature, a round face; a base plane works', () => {
    const withPlane = (plane: PlaneRef) => errorOf(preview(engine, { type: 'updateFeature', id: 'posts', patch: { extent: { plane } } }), 'posts')?.code;
    expect(withPlane(onFace('box', { feature: 'cavity', role: 'side', curve: 'oa' }))).toBe('invalidExtent');
    expect(withPlane(onFace('box', FLOOR))).toBe('invalidExtent');
    // a face of a feature after the posts: an invalid command
    expect(engine.preview({ type: 'updateFeature', id: 'posts', patch: { extent: { plane: onFace('box', { feature: 'brace', role: 'side', curve: 'br' }) } } })).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    const stud = preview(engine, {
      type: 'addFeature',
      feature: { id: 'stud', name: 'stud', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'postSketch', regions: [{ outerLoop: ['pa'] }] }, extent: { type: 'upTo', plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pb' }), start: 0 }, operation: 'new' },
    });
    expect(errorOf(stud, 'stud')?.code).toBe('nonPlanarFace');
    // a distance becomes an extent up to a plane by a patch with the other type, complete
    const toBase = preview(engine, { type: 'updateFeature', id: 'rib', patch: { extent: { type: 'upTo', plane: { kind: 'base', plane: 'XY' }, start: 'ribH' } } });
    expect(toBase.evaluation.features.rib.status).not.toBe('error');
    expect(toBase.evaluation.features.rib.facts).toEqual({ lengthMin: 14, lengthMax: 14, forward: false });
  });

  it('the document loads to the same model', () => {
    const before = engine.getState();
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    near(volumeOf(other.getState(), 'box'), volumeOf(before, 'box'), 1e-9);
    expect(UNDER_LID).toEqual({ kind: 'face', body: 'lid', face: { feature: 'lid', role: 'startCap' } });
  });
});

describe('scenario 12, the part of 2c: screws through the lid and inserts in the posts, from the catalogs', () => {
  let engine: Engine;
  const errorOf = (state: EngineState, id: Id) => state.evaluation.features[id].error;
  const named = (state: EngineState, feature: Id, role: FaceName['role']): FaceName[] => state.evaluation.faceNames.filter((name) => name.feature === feature && name.role === role);
  const hardware = (args: Parameters<Engine['query']>[1] & object) => {
    const answer = engine.query('hardwareHole', args as never);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.result as { shape: HoleFeature['shape']; label: string; depth?: number; from: string[] };
  };
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
  });

  it('the screws: one hole feature of countersinks for M3 from the catalog, with the print compensation, through the lid', () => {
    const preset = hardware({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    // The bores have to be in the lid, so its plate has to be thicker than the cone is deep. The
    // plate is set from the row of the catalog: the cone of the head down to its point is deeper
    // than any countersink for it; that and a millimetre, never less than the 3 mm the parts
    // before were built with.
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const plate = Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1);
    const state = run(engine, screwHoles(preset.shape, preset.label, String(plate)));
    expectAllOk(state);
    // the document holds expressions, numbers and a label, not a size
    const feature = state.document.features.find((f) => f.id === 'screwHoles') as HoleFeature;
    expect(feature.label).toBe('M3 countersunk screw');
    expect(feature.expressions?.['shape/headDiameter']?.endsWith('+ holeComp')).toBe(true);
    expect(feature.expressions?.['shape/diameter']?.endsWith('+ holeComp')).toBe(true);
    expect(feature.expressions?.['shape/angle']?.startsWith('deg(')).toBe(true);
    expect(feature.shape.type === 'countersink' && feature.shape.angle).toBeCloseTo(screw.headAngle, 9);
    // one cone and one bore per point, named by the point; the cones are holes; every rim of a cone is a circle
    expect(named(state, 'screwHoles', 'holeHead').map((name) => (name.role === 'holeHead' ? name.point : '')).sort()).toEqual(SCREW_POINTS);
    const body = engine.query('body', { body: 'lid' });
    if (!body.ok) throw new Error(body.error.message);
    const ofRole = (role: FaceName['role']) => body.result.faces.filter((face) => face.name.feature === 'screwHoles' && face.name.role === role);
    expect(ofRole('holeHead').every((face) => face.surface.kind === 'cone' && face.convex === false)).toBe(true);
    expect(ofRole('holeHead').length).toBe(4);
    expect(ofRole('holeBore').length).toBe(4);
    const rims = body.result.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'screwHoles' && name.role === 'holeHead'));
    expect(rims.length).toBe(8);
    expect(rims.every((edge) => edge.kind === 'circle')).toBe(true);
    // the depth of the cone, and of the hole: "through all" of the lid reaches the lower edge of its lip
    const facts = state.evaluation.features.screwHoles.facts ?? {};
    expect(facts.headDepth as number).toBeLessThan(plate);
    near(facts.depth as number, plate + 4, 1e-4);
    // the assumption of the design about widths: the heads, with the allowance, fit into the top
    // of the lid around their points, which are INSET (8.7) from its edges
    if (feature.shape.type !== 'countersink') throw new Error('a countersunk screw is a countersink');
    expect(feature.shape.headDiameter / 2).toBeLessThan(8.7);
  });

  it('socket heads instead: the bores keep their names, the heads become cylinders and a seat appears that a sketch stands on', () => {
    const before = named(engine.getState(), 'screwHoles', 'holeBore');
    const preset = hardware({ use: 'socketHead', size: 'M3' });
    if (preset.shape.type !== 'counterbore') throw new Error('a socket head is a counterbore');
    const state = preview(engine, {
      type: 'batch',
      commands: [
        // the seat is in the lid only if its plate is thicker than the head is deep
        { type: 'setParameter', name: 'lidT', expr: `${preset.shape.headDepth} + 2` },
        { type: 'updateFeature', id: 'screwHoles', patch: { shape: preset.shape, label: preset.label } },
        sketchOn('onSeat', onFace('lid', { feature: 'screwHoles', role: 'holeSeat' })),
      ],
    });
    expect(named(state, 'screwHoles', 'holeBore')).toEqual(before);
    expect(named(state, 'screwHoles', 'holeSeat')).toEqual([{ feature: 'screwHoles', role: 'holeSeat' }]);
    expect(state.evaluation.features.onSeat.status).toBe('ok');
    expect(state.evaluation.features.screwHoles.status).toBe('ok');
  });

  it('nut pockets instead: six flats per point, numbered from the corner the rotation points to', () => {
    const preset = hardware({ use: 'nutPocket', size: 'M3' });
    if (preset.shape.type !== 'nutPocket') throw new Error('a nut is a nut pocket');
    const state = preview(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'lidT', expr: `${preset.shape.headDepth} + 2` }, { type: 'updateFeature', id: 'screwHoles', patch: { shape: preset.shape } }] });
    expect(state.evaluation.features.screwHoles.status).toBe('ok');
    const flats = named(state, 'screwHoles', 'holeFlat').flatMap((name) => (name.role === 'holeFlat' && name.point === 's1' ? [name.flat] : []));
    expect(flats.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('heat-set inserts in the posts, as deep as the catalog says; a pattern of the hole puts them into the copied posts', () => {
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const preset = hardware({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    expect(preset.depth).toBe(DATA_CATALOGS.heatSetInserts.rows[size].holeDepth);
    const state = run(engine, insertHoles(preset.shape, preset.label, preset.depth as number));
    expectAllOk(state);
    const feature = state.document.features.find((f) => f.id === 'inserts') as HoleFeature;
    expect(producesTool(feature)).toBe(true);
    // four bores in the posts, two of them copies; the hole with its allowance is narrower than a post
    const bores = state.evaluation.bodies.box.faces.map((face) => state.evaluation.faceNames[face.id]).filter((name) => name.feature === 'inserts' && name.role === 'holeBore');
    expect(bores.length).toBe(4);
    expect(bores.filter((name) => name.copy?.[0]?.pattern === 'insertPattern').length).toBe(2);
    expect(state.evaluation.features.inserts.facts).toEqual({ depth: preset.depth });
    // the other assumption: the hole of the insert, with its allowance, is narrower than a post (postR 4)
    if (feature.shape.type !== 'plain') throw new Error('an insert is a plain hole');
    expect(feature.shape.diameter).toBeLessThan(8);
  });

  it('refusals: a head narrower than the bore, a point not in the sketch; a hole that misses and one pointing away warn', () => {
    expect(errorOf(preview(engine, { type: 'setField', feature: 'screwHoles', path: 'shape/headDiameter', value: 0.001 }), 'screwHoles')?.code).toBe('invalidHole');
    expect(engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { points: ['s1', 'nope'] } }).ok).toBe(false);
    // the box is below the lid and the hole runs up from above its top: it misses
    const missed = preview(engine, { type: 'updateFeature', id: 'screwHoles', patch: { targets: ['box'], extent: { type: 'distance', start: 5, distance: 'lidT + 5' } } });
    expect(missed.evaluation.features.screwHoles.warnings[0]?.code).toBe('noEffect');
    // through all away from the lid: its top is the plane of the sketch; the tool only touches it
    const away = preview(engine, { type: 'updateFeature', id: 'screwHoles', patch: { extent: { type: 'throughAll', side: 'forward' } } });
    expect(away.evaluation.features.screwHoles.warnings[0]?.code).toBe('noEffect');
    expect(engine.query('hardwareHole', { use: 'socketHead', size: 'nope' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['size'] } });
  });

  it('the finished parts do not collide, and the document loads to the same model', () => {
    expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
    const before = engine.getState();
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    near(volumeOf(other.getState(), 'lid'), volumeOf(before, 'lid'), 1e-9);
  });
});

describe('scenario 12, the part of 2e: vent slots in a row, the rib mirrored, pads under the corners, lids for the bed', () => {
  let engine: Engine;
  let before = 0;
  const hasFace = (state: EngineState, body: Id, name: FaceName): boolean => state.evaluation.bodies[body].faces.some((face) => JSON.stringify(state.evaluation.faceNames[face.id]) === JSON.stringify(name));
  const hardware = (args: Parameters<Engine['query']>[1] & object) => {
    const answer = engine.query('hardwareHole', args as never);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.result as { shape: HoleFeature['shape']; label: string; depth?: number };
  };
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
    // the screws and the inserts of 2c, from the catalogs
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const countersunk = hardware({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    run(engine, screwHoles(countersunk.shape, countersunk.label, String(Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1))));
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const insert = hardware({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    expectAllOk(run(engine, insertHoles(insert.shape, insert.label, insert.depth as number)));
    before = volumeOf(engine.getState(), 'box');
  });

  it('five vent slots: a linear pattern of a cut through the long wall, the count and the spacing as parameters', () => {
    const state = run(engine, vents());
    expectAllOk(state);
    const row = state.document.features.find((f) => f.id === 'ventRow') as PatternFeature;
    expect(row.transform).toEqual({ type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 5, span: { type: 'spacing', spacing: 4 } });
    expect(row.expressions).toEqual({ 'transform/count': 'vents', 'transform/span/spacing': 'ventPitch' });
    // five times one slot 2 × 12 through the wall of 2
    near(before - volumeOf(state, 'box'), 5 * 2 * 12 * 2);
    const fourth: FaceName = { feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: 4 }] };
    expect(hasFace(state, 'box', fourth)).toBe(true);
    expect(hasFace(state, 'box', { ...fourth, copy: [{ pattern: 'ventRow', index: 5 }] })).toBe(false);
    // the slots stand where the sketch on the outer face puts them: x from 16, one every 4
    expect(faceBox(state, 'box', fourth)?.min[0]).toBeCloseTo(32, 5);
    expect(WALL_OUT).toEqual({ feature: 'box', role: 'side', curve: 'oa' });
  });

  it('a sixth slot is one parameter and moves none; eighteen run past the end and name the idle copies', () => {
    const six = preview(engine, { type: 'setParameter', name: 'vents', expr: '6' });
    near(before - volumeOf(six, 'box'), 6 * 2 * 12 * 2);
    expect(faceBox(six, 'box', { feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: 4 }] })?.min[0]).toBeCloseTo(32, 5);
    const many = preview(engine, { type: 'setParameter', name: 'vents', expr: '18' });
    expect(many.evaluation.features.ventRow.status).toBe('warning');
    expect(many.evaluation.features.ventRow.warnings[0]).toMatchObject({ code: 'noEffect', refs: [{ copy: 16, feature: 'vent', targets: ['box'] }, { copy: 17, feature: 'vent', targets: ['box'] }] });
  });

  it('the span as a length is a patch of the span alone; a spacing of zero is refused; the registry lists the fields of the kinds', () => {
    const byLength = preview(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'vents', expr: '3' }, { type: 'updateFeature', id: 'ventRow', patch: { transform: { span: { type: 'length', length: 16 } } } }] });
    expect(byLength.evaluation.features.ventRow.status).toBe('ok');
    // three slots over 16: 8 apart, the second copy where the fourth of the row was
    expect(faceBox(byLength, 'box', { feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: 2 }] })?.min[0]).toBeCloseTo(32, 5);
    expect(engine.preview({ type: 'setField', feature: 'ventRow', path: 'transform/span/spacing', value: 0 }).ok).toBe(false);
    // five fields of the kinds and four of the second direction of a grid
    expect(FEATURE_TYPE_INFO.pattern.fields.map((field) => field.path)).toEqual([
      'transform/count',
      'transform/span/angle',
      'transform/count',
      'transform/span/spacing',
      'transform/span/length',
      'transform/second/count',
      'transform/second/span/spacing',
      'transform/second/count',
      'transform/second/span/length',
    ]);
  });

  it('the rib and its brace mirrored to the other long wall: the copies add what the originals added, the brace ends on the copy of the rib', () => {
    run(engine, midPlanes());
    const withVents = volumeOf(engine.getState(), 'box');
    const state = run(engine, ribMirror());
    expectAllOk(state);
    const withoutBoth = preview(engine, { type: 'batch', commands: ['ribMirror', 'brace', 'rib'].map((id): Command => ({ type: 'setSuppressed', id, suppressed: true })) });
    near(volumeOf(state, 'box') - withVents, withVents - volumeOf(withoutBoth, 'box'), 1e-2);
    expect(hasFace(state, 'box', RIB_LEFT_COPY)).toBe(true);
    const braceCopy: FaceName = { feature: 'brace', role: 'side', curve: 'br', copy: [{ pattern: 'ribMirror', index: 1 }] };
    expect(hasFace(state, 'box', braceCopy)).toBe(true);
    // the brace of the copy runs to the plane its source ends in, which the mirror keeps: both reach the same x
    const source = faceBox(state, 'box', { feature: 'brace', role: 'side', curve: 'br' });
    const copy = faceBox(state, 'box', braceCopy);
    near(copy?.max[0] as number, source?.max[0] as number, 1e-3);
    near(((copy?.min[1] as number) + (copy?.max[1] as number)) / 2, 50 - ((source?.min[1] as number) + (source?.max[1] as number)) / 2, 1e-3);
    expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('a sketch on a face of the copy: a right-handed frame with its origin at the image of the source', () => {
    const state = preview(engine, sketchOn('onCopy', onFace('box', RIB_LEFT_COPY)));
    const frame = state.evaluation.features.onCopy.plane;
    const source = preview(engine, sketchOn('onSource', onFace('box', RIB_LEFT))).evaluation.features.onSource.plane;
    if (!frame || !source) throw new Error('no frame');
    expect(state.evaluation.features.onCopy.status).toBe('ok');
    const [x, y, n] = [frame.x, frame.y, frame.normal];
    near((x[1] * y[2] - x[2] * y[1]) * n[0] + (x[2] * y[0] - x[0] * y[2]) * n[1] + (x[0] * y[1] - x[1] * y[0]) * n[2], 1, 1e-9);
    near(frame.origin[1], 50 - source.origin[1], 1e-9);
    near(frame.origin[0], source.origin[0], 1e-9);
  });

  it('refusals: a removed plane, a round face; another kind is a complete patch', () => {
    const errorOf = (state: EngineState) => state.evaluation.features.ribMirror.error?.code;
    expect(errorOf(preview(engine, { type: 'removeFeature', id: 'midW' }))).toBe('brokenReference');
    expect(errorOf(preview(engine, { type: 'updateFeature', id: 'ribMirror', patch: { transform: { plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pa' }) } } }))).toBe('nonPlanarFace');
    expect(engine.preview({ type: 'updateFeature', id: 'ribMirror', patch: { transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 'W - 2 * wall - 21' } } } }).ok).toBe(true);
    expect(engine.preview({ type: 'updateFeature', id: 'ribMirror', patch: { transform: { type: 'linear' } } as never }).ok).toBe(false);
  });

  it('four pads under the corners: one body and three mirrors, one of a copy; the material said once', () => {
    const state = run(engine, pads());
    expectAllOk(state);
    for (const id of PADS) near(volumeOf(state, id), 120, 1e-3);
    const corner = (id: Id, x: number, y: number) => {
      near(state.evaluation.bodies[id].bounds.min[0], x, 1e-4);
      near(state.evaluation.bodies[id].bounds.min[1], y, 1e-4);
    };
    // the long leg stays along the long wall in every corner: 65 = L − 15, 42 = W − 8
    corner('pad', 0, 0);
    corner('padX/1', 65, 0);
    corner('padY/1', 0, 42);
    corner('padXY/1', 65, 42);
    expect(engine.query('interference', { bodies: ['box', 'lid', ...PADS] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
    // a copy takes after its source, and a copy of a copy after both
    expect(state.evaluation.bodyProperties['padXY/1']).toMatchObject({ material: 'TPU', from: 'padX/1' });
    expect(state.evaluation.bodyProperties['padX/1']).toMatchObject({ from: 'pad' });
    const mass = engine.query('mass', { bodies: ['padXY/1'] });
    if (!mass.ok) throw new Error(mass.error.message);
    near(mass.result.bodies[0].mass, 0.15, 1e-6);
  });

  it('a sketch on a face with two copy tags; no second copy of a mirror; a link lists the copies', () => {
    const under: FaceName = { feature: 'pad', role: 'endCap', copy: [{ pattern: 'padX', index: 1 }, { pattern: 'padXY', index: 1 }] };
    expect(preview(engine, sketchOn('under', onFace('padXY/1', under))).evaluation.features.under.status).toBe('ok');
    expect(engine.preview({ type: 'setBodyProperties', body: 'padX/2', patch: { color: '#000000' } }).ok).toBe(false);
    expect(preview(engine, { type: 'setLink', id: 'base', bodies: ['box', ...PADS] }).evaluation.mechanism.links.base.bodies).toEqual(['box', ...PADS]);
  });

  it('three lids in a row for the print bed: a linear pattern of a body', () => {
    const state = preview(engine, lidsInARow());
    expect(state.evaluation.features.lids.bodies).toEqual(['lids/1', 'lids/2']);
    near(state.evaluation.bodies['lids/2'].bounds.min[0], 170, 1e-4);
    near(volumeOf(state, 'lids/2'), volumeOf(state, 'lid'), 1e-3);
  });

  it('the document loads to the same model, with the schema version of this build', () => {
    const before = engine.getState();
    const saved = engine.save();
    expect((JSON.parse(saved) as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
    const other = newEngine();
    expect(other.load(saved).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    for (const id of PADS) near(volumeOf(other.getState(), id), 120, 1e-3);
    near(volumeOf(other.getState(), 'box'), volumeOf(before, 'box'), 1e-9);
    expect(MID_W).toEqual({ kind: 'plane', feature: 'midW' });
  });
});

describe('scenario 12, the grid (2e, D53, an addition): the vents of both walls, drain holes in the floor, six lids', () => {
  let engine: Engine;
  let walls = 0;
  let floor = 0;
  const X = { kind: 'base', axis: 'X' } as const;
  const Y = { kind: 'base', axis: 'Y' } as const;
  const hasFace = (state: EngineState, body: Id, name: FaceName): boolean => state.evaluation.bodies[body].faces.some((face) => JSON.stringify(state.evaluation.faceNames[face.id]) === JSON.stringify(name));
  const previewAll = (...commands: Command[]): EngineState => preview(engine, commands.length === 1 ? commands[0] : { type: 'batch', commands });
  const patternOf = (state: EngineState, id: Id): PatternFeature => state.document.features.find((f) => f.id === id) as PatternFeature;
  const vent = (i: number, j: number): FaceName => ({ feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: i + 1000 * j }] });
  const drainBore = (i: number, j: number): FaceName => ({ feature: 'drain', role: 'holeBore', point: 'd1', copy: [{ pattern: 'drains', index: i + 1000 * j }] });
  // Is the bore of the place (i, j) a cylinder whose axis passes (x, y)? The published surface of a
  // bore says where the hole is.
  const boreAt = (state: EngineState, i: number, j: number, x: number, y: number): boolean => {
    const face = state.evaluation.bodies.box.faces.find((candidate) => JSON.stringify(state.evaluation.faceNames[candidate.id]) === JSON.stringify(drainBore(i, j)));
    const surface = face && state.evaluation.faceSurfaces[face.id];
    return surface?.kind === 'cylinder' && Math.abs(surface.origin[0] - x) < 1e-6 && Math.abs(surface.origin[1] - y) < 1e-6;
  };
  // what one drain hole removes
  const oneDrain = (): number => floor - volumeOf(previewAll({ type: 'setSuppressed', id: 'drains', suppressed: true }), 'box');
  const hardware = (args: Parameters<Engine['query']>[1] & object) => {
    const answer = engine.query('hardwareHole', args as never);
    if (!answer.ok) throw new Error(answer.error.message);
    return answer.result as { shape: HoleFeature['shape']; label: string; depth?: number };
  };
  beforeAll(() => {
    // the model up to the part of 2e, as that part builds it
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const countersunk = hardware({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    run(engine, screwHoles(countersunk.shape, countersunk.label, String(Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1))));
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const insert = hardware({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    run(engine, insertHoles(insert.shape, insert.label, insert.depth as number), vents(), midPlanes(), ribMirror(), pads());
    expectAllOk(engine.getState());
    walls = volumeOf(engine.getState(), 'box');
  });

  it('the row of vents gets a second direction: the far wall loses what the near one lost, the row keeps its numbers', () => {
    const state = run(engine, ventsOnBothWalls());
    expectAllOk(state);
    const row = patternOf(state, 'ventRow');
    expect(row.transform).toEqual({ type: 'linear', direction: X, count: 5, span: { type: 'spacing', spacing: 4 }, second: { direction: Y, count: 2, span: { type: 'spacing', spacing: 47.5 } } });
    expect(row.expressions).toEqual({ 'transform/count': 'vents', 'transform/span/spacing': 'ventPitch', 'transform/second/span/spacing': 'W - wall - 0.5' });
    near(walls - volumeOf(state, 'box'), 5 * 2 * 12 * 2);
    // the copies of the row keep 1 to 4; the far wall has 1000 (across from the original) to 1004
    for (const [i, j] of [[4, 0], [0, 1], [4, 1]]) expect(hasFace(state, 'box', vent(i, j))).toBe(true);
    for (const [i, j] of [[5, 0], [5, 1]]) expect(hasFace(state, 'box', vent(i, j))).toBe(false);
    expect(faceBox(state, 'box', vent(4, 0))?.min[0]).toBeCloseTo(32, 5);
    expect(faceBox(state, 'box', vent(0, 1))?.min[0]).toBeCloseTo(16, 5);
    expect(faceBox(state, 'box', vent(4, 1))?.min[0]).toBeCloseTo(32, 5);
    near(faceBox(state, 'box', vent(0, 1))?.min[1] as number, 48, 1e-4);
    near(faceBox(state, 'box', vent(0, 1))?.max[1] as number, 50, 1e-4);
    // the lid still clears the box
    expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('a sketch on a slot of the far wall stays where it is when a sixth slot per wall is added; eighteen name the idle copies row by row', () => {
    const standing = run(engine, sketchOn('onFarVent', onFace('box', vent(4, 1))));
    const was = standing.evaluation.features.onFarVent.plane?.origin as number[];
    near(was[0], 32, 1e-6);
    near(was[1], 47.5, 1e-6);
    near(was[2], 22, 1e-6);
    const six = previewAll({ type: 'setParameter', name: 'vents', expr: '6' });
    expect(six.evaluation.features.onFarVent.status).toBe('ok');
    (six.evaluation.features.onFarVent.plane?.origin as number[]).forEach((value, axis) => near(value, was[axis], 1e-9));
    expect(hasFace(six, 'box', vent(5, 0))).toBe(true);
    expect(hasFace(six, 'box', vent(5, 1))).toBe(true);
    near(walls - volumeOf(six, 'box'), 7 * 2 * 12 * 2);
    const many = previewAll({ type: 'setParameter', name: 'vents', expr: '18' });
    expect(many.evaluation.features.ventRow.warnings[0]?.refs?.map((ref) => (ref as { copy: number }).copy)).toEqual([16, 17, 1016, 1017]);
    floor = volumeOf(engine.getState(), 'box');
  });

  it('drain holes: a grid 4 × 3 of a hole through the floor, every place where its number says', () => {
    const state = run(engine, drains());
    expect(state.evaluation.features.drains.status).toBe('ok');
    const one = oneDrain();
    near(one, 6.2053, 1e-3);
    near(floor - volumeOf(state, 'box'), 12 * one, 1e-4);
    expect(boreAt(state, 3, 2, 33, 22)).toBe(true);
    expect(boreAt(state, 2, 1, 28, 16)).toBe(true);
    expect(boreAt(state, 3, 0, 33, 10)).toBe(true);
    expect(hasFace(state, 'box', drainBore(4, 0))).toBe(false);
    expect(hasFace(state, 'box', drainBore(0, 3))).toBe(false);
    // one more column and one more row: eight more holes, every one that was there in its place
    const more = previewAll({ type: 'setParameter', name: 'drainCols', expr: '5' }, { type: 'setParameter', name: 'drainRows', expr: '4' });
    expect(more.evaluation.features.drains.status).toBe('ok');
    near(floor - volumeOf(more, 'box'), 20 * one, 1e-4);
    for (const [i, j, x, y] of [[3, 2, 33, 22], [2, 1, 28, 16], [4, 0, 38, 10], [4, 3, 38, 28]]) expect(boreAt(more, i, j, x, y)).toBe(true);
  });

  it('too many places, two places in one: the error invalidPattern of the pattern; parallel rows that stand apart are fine', () => {
    const one = oneDrain();
    const over = previewAll({ type: 'setParameter', name: 'drainCols', expr: '50' }, { type: 'setParameter', name: 'drainRows', expr: '5' });
    expect(over.evaluation.features.drains.error).toEqual({ code: 'invalidPattern', message: 'The counts, the directions and the spans do not make a pattern. (50 × 5 is 250 places; a pattern has at most 200, the original included)', refs: ['transform/count', 'transform/second/count'] });
    near(floor - volumeOf(over, 'box'), one, 1e-9);
    const twice = previewAll({ type: 'updateFeature', id: 'drains', patch: { transform: { second: { direction: X, span: { type: 'spacing', spacing: 5 } } } } });
    expect(twice.evaluation.features.drains.error).toMatchObject({
      code: 'invalidPattern',
      refs: ['transform/direction', 'transform/count', 'transform/span/spacing', 'transform/second/direction', 'transform/second/count', 'transform/second/span/spacing'],
    });
    expect(twice.evaluation.features.drains.error?.message).toContain('(the copies 1 and 1000 would stand in one place)');
    // two rows along X half a step apart: eight separate holes on one line
    const line = previewAll({ type: 'updateFeature', id: 'drains', patch: { transform: { second: { direction: X, count: 2, span: { type: 'spacing', spacing: 2.5 } } } } });
    expect(line.evaluation.features.drains.status).toBe('ok');
    near(floor - volumeOf(line, 'box'), 8 * one, 1e-4);
    expect(boreAt(line, 1, 1, 25.5, 10)).toBe(true);
    expect(boreAt(line, 3, 1, 35.5, 10)).toBe(true);
  });

  it('`second: null` makes a row again with its numbers; `second` on a mirror and half a second on a row are invalid commands', () => {
    const row = previewAll({ type: 'updateFeature', id: 'drains', patch: { transform: { second: null } } });
    expect(row.evaluation.features.drains.status).toBe('ok');
    near(floor - volumeOf(row, 'box'), 4 * oneDrain(), 1e-4);
    expect(patternOf(row, 'drains').expressions).toEqual({ 'transform/count': 'drainCols' });
    expect(hasFace(row, 'box', drainBore(3, 0))).toBe(true);
    expect(engine.preview(secondDirection('ribMirror', X, 2, 5)).ok).toBe(false);
    expect(engine.preview({ type: 'batch', commands: [lidsInARow(), { type: 'updateFeature', id: 'lids', patch: { transform: { second: { count: 2 } } } }] }).ok).toBe(false);
  });

  it('six lids for the print bed: a grid of a body, each a lid of PETG; a link and a sketch take copies of both rows; none collide', () => {
    const LIDS = ['lids/1', 'lids/2', 'lids/1000', 'lids/1001', 'lids/1002'];
    const state = run(engine, sixLids());
    expectAllOk(state);
    expect(state.evaluation.features.lids.bodies).toEqual(LIDS);
    const last = state.evaluation.bodies['lids/1002'];
    near(last.bounds.min[0], 170, 1e-4);
    near(last.bounds.min[1], 55, 1e-4);
    near(last.bounds.min[2], 26, 1e-4);
    near(volumeOf(state, 'lids/1002'), volumeOf(state, 'lid'), 1e-2);
    expect(state.evaluation.bodyProperties['lids/1002']).toMatchObject({ material: 'PETG', from: 'lid' });
    const mass = engine.query('mass', { bodies: ['lid', ...LIDS] });
    if (!mass.ok) throw new Error(mass.error.message);
    near(mass.result.mass, 6 * (mass.result.bodies[0].mass as number), 1e-3);
    near(mass.result.bodies[0].mass as number, 23.056, 1e-3);
    const linked = previewAll({ type: 'setLink', id: 'bed', bodies: ['lid', 'lids/1', 'lids/1000', 'lids/1002'] }).evaluation.mechanism.links.bed;
    expect(linked).toMatchObject({ bodies: ['lid', 'lids/1', 'lids/1000', 'lids/1002'], missing: [] });
    const under: FaceName = { feature: 'lid', role: 'startCap', copy: [{ pattern: 'lids', index: 1001 }] };
    expect(previewAll(sketchOn('underALid', onFace('lids/1001', under))).evaluation.features.underALid.status).toBe('ok');
    expect(engine.query('interference', { bodies: ['lid', ...LIDS] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('a fourth lid per row adds lids/3 and lids/1003 and moves none; one row leaves a link with lids/1002 under missing', () => {
    const four = previewAll({ type: 'setField', feature: 'lids', path: 'transform/count', value: 4 });
    expect(four.evaluation.features.lids.bodies).toEqual(['lids/1', 'lids/2', 'lids/3', 'lids/1000', 'lids/1001', 'lids/1002', 'lids/1003']);
    near(four.evaluation.bodies['lids/1002'].bounds.min[0], 170, 1e-4);
    const one = previewAll({ type: 'setLink', id: 'bed', bodies: ['lid', 'lids/1', 'lids/1002'] }, { type: 'setField', feature: 'lids', path: 'transform/second/count', value: 1 });
    expect(one.evaluation.features.lids.bodies).toEqual(['lids/1', 'lids/2']);
    expect(one.evaluation.mechanism.links.bed.missing).toEqual(['lids/1002']);
  });

  it('the document loads to the same model, with the schema version of this build', () => {
    const before = engine.getState();
    const saved = engine.save();
    expect((JSON.parse(saved) as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
    const other = newEngine();
    expect(other.load(saved).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    expect(other.getState().evaluation.features.lids.bodies).toEqual(['lids/1', 'lids/2', 'lids/1000', 'lids/1001', 'lids/1002']);
    near(volumeOf(other.getState(), 'box'), volumeOf(before, 'box'), 1e-9);
  });
});

describe('scenario 12, the part of 2g: the box and its lid as 3MF, the lid as a drawing for a laser', () => {
  let engine: Engine;
  const XY_PLANE: PlaneRef = XY;
  const LID_UNDERSIDE: PlaneRef = UNDER_LID;
  const unwrap = <T>(outcome: { ok: true; result: T } | { ok: false; error: { code: string; message: string } }): T => {
    if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
    return outcome.result;
  };
  // the one file of an export of the layout `file` that is not empty
  const only = (exported: Exported): ExportFile => {
    expect(exported.empty).toBeUndefined();
    expect(exported.layout).toBe('file');
    expect(exported.files.length).toBe(1);
    return exported.files[0];
  };
  const text = (file: ExportFile): string => new TextDecoder().decode(file.bytes);
  const modelOf = (file: ExportFile): string => new TextDecoder().decode(readZip(file.bytes)[2].bytes);
  const count = (whole: string, piece: string): number => whole.split(piece).length - 1;
  const meshAbout = (file: ExportFile) => file.about as MeshAbout;
  const outlineAbout = (file: ExportFile) => file.about as OutlineAbout;
  const asReference = (bodies: Id[]) => ({ state: preview(engine, { type: 'batch', commands: bodies.map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'reference' } })) }) });
  beforeAll(() => {
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
    const hardware = (args: object) => unwrap(engine.query('hardwareHole', args as never)) as { shape: HoleFeature['shape']; label: string; depth?: number };
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const countersunk = hardware({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    run(engine, screwHoles(countersunk.shape, countersunk.label, String(Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1))));
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const insert = hardware({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    expectAllOk(run(engine, insertHoles(insert.shape, insert.label, insert.depth as number)));
  });

  it('3MF: the printed bodies as objects of one package, the very coordinates of the mesh', () => {
    const file = only(unwrap(engine.export('3mf', {})));
    expect([file.path, file.mediaType]).toEqual(['model.3mf', 'model/3mf']);
    expect(meshAbout(file)).toEqual({ bodies: ['box', 'lid'], triangles: 2926 });
    const items = readZip(file.bytes);
    expect(items.map((item) => item.name)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const model = modelOf(file);
    expect(model).toContain('<object id="1" type="model" name="box" partnumber="box">');
    expect(model).toContain('<object id="2" type="model" name="lid" partnumber="lid">');
    expect(model).not.toContain('<basematerials');
    // the vertices a triangle names: all 720 of the box, 735 of the 883 positions of the lid
    expect(count(model, '<vertex ')).toBe(720 + 735);
    expect(count(model, '<triangle ')).toBe(2926);
    expect(model).toContain('<build><item objectid="1"/><item objectid="2"/></build>');
    // the items deflated, a fifth of the STL of the same bodies: the next test
    // the mesh of the file is the mesh of the body, the lid renumbered
    const { positions, triangles } = engine.getState().evaluation.bodies.lid.solid;
    const lid = modelOf(only(unwrap(engine.export('3mf', { bodies: ['lid'] }))));
    const vertices = [...lid.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((vertex) => [vertex[1], vertex[2], vertex[3]].map(Number));
    const corners = [...lid.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap((triangle) => [triangle[1], triangle[2], triangle[3]].map(Number));
    expect(corners.length).toBe(triangles.length);
    expect(corners.every((vertex, i) => [0, 1, 2].every((k) => Math.fround(vertices[vertex][k]) === positions[3 * triangles[i] + k]))).toBe(true);
  });

  it('3MF compressed (D54, the addition): the engine of the kit has the compressor; the three items deflated, a fifth of the STL', () => {
    const file = only(unwrap(engine.export('3mf', {})));
    const items = readZip(file.bytes); // inflated by `node:zlib`, which shares no code with the compressor
    expect(items.map((item) => item.name)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    expect(items.map((item) => [item.method, item.needed, item.madeBy])).toEqual([
      [8, 20, 20],
      [8, 20, 20],
      [8, 20, 20],
    ]);
    expect(items.every((item) => item.compressed < item.bytes.length)).toBe(true);
    // the package an engine without a compressor writes: the same items, stored (the tests of the
    // engine pin that equality against bytes of master), so the scenario needs no second engine
    const stored = zip(items.map(({ name, bytes }) => ({ name, bytes })));
    const storedItems = readZip(stored);
    expect(storedItems.map((item) => [item.method, item.needed, item.bytes.length])).toEqual(items.map((item) => [0, 10, item.bytes.length]));
    expect(stored.length).toBe(177803);
    // a fifth of the STL of the same bodies (146 384 bytes), where the stored package is a fifth more
    const stl = only(unwrap(engine.export('stl', {})));
    expect(file.bytes.length).toBeLessThan(stored.length / 5);
    expect(Math.abs(file.bytes.length / stl.bytes.length - 0.2)).toBeLessThan(0.01);
    expect(stored.length / stl.bytes.length).toBeCloseTo(1.21, 2);
    // nothing else of the answer changes
    expect([file.path, file.mediaType, meshAbout(file).triangles]).toEqual(['model.3mf', 'model/3mf', 2926]);
    // the same model gives the same bytes
    expect(only(unwrap(engine.export('3mf', {}))).bytes).toEqual(file.bytes);
  });

  it('3MF: the name and the colour of the body properties, the colour as a base material named by the material; a name is escaped', () => {
    const state = preview(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyProperties', body: 'lid', patch: { name: 'Lid <A&B>', color: '#ff8800', material: 'PETG' } },
        { type: 'setBodyProperties', body: 'box', patch: { color: '#30343a' } },
      ],
    });
    const model = modelOf(only(unwrap(engine.export('3mf', {}, { state }))));
    expect(model).toContain('<basematerials id="1"><base name="#30343a" displaycolor="#30343A"/><base name="PETG" displaycolor="#FF8800"/></basematerials>');
    expect(model).toContain('<object id="2" type="model" name="box" partnumber="box" pid="1" pindex="0">');
    expect(model).toContain('<object id="3" type="model" name="Lid &lt;A&amp;B&gt;" partnumber="lid" pid="1" pindex="1">');
    expect(engine.getState().document.bodyProperties).toEqual({}); // a preview: nothing written
  });

  it('3MF: which bodies, by their use and by a list; the state after a feature', () => {
    const bodiesOf = (exported: Exported): string => meshAbout(only(exported)).bodies.join();
    expect(bodiesOf(unwrap(engine.export('3mf', {}, asReference(['box']))))).toBe('lid');
    expect(bodiesOf(unwrap(engine.export('3mf', { bodies: ['box'] }, asReference(['box']))))).toBe('box');
    expect(unwrap(engine.export('3mf', {}, asReference(['box', 'lid']))).empty).toBe(NO_PRINTED_BODY);
    expect(bodiesOf(unwrap(engine.export('3mf', {}, { at: 'box' })))).toBe('box');
  });

  it('DXF: the plate of the lid half a millimetre above its underside, a polyline and five circles for a laser', () => {
    const file = only(unwrap(engine.export('dxf', { plane: LID_UNDERSIDE, offset: -0.5 })));
    expect([file.path, file.mediaType]).toEqual(['outline.dxf', 'image/vnd.dxf']);
    const about = outlineAbout(file);
    expect([about.bodies, about.loops, about.circles, about.inPlane]).toEqual([['lid'], 6, 5, undefined]);
    near(about.area, 3939.9012);
    // the frame of the underside looks down: its x runs against the X of the model
    expect(about.bounds).toEqual({ min: [-80, 0], max: [0, 50] });
    const drawing = text(file);
    expect(drawing.startsWith(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'].join('\r\n'))).toBe(true);
    expect(drawing.endsWith(['0', 'ENDSEC', '0', 'EOF', ''].join('\r\n'))).toBe(true);
    // the outline: one closed polyline of four corners, no bulge
    expect([count(drawing, 'POLYLINE'), count(drawing, 'VERTEX')]).toEqual([1, 4]);
    expect(drawing.split('\r\n').some((line, i) => line === '42' && i % 2 === 0)).toBe(false);
    // the holes: the four bores of the screws (3.4 and the allowance of 0.2 across) over the posts, and the bore in the middle
    expect(count(drawing, ['0', 'CIRCLE', '8', 'HOLES', '10', '-71.3', '20', '8.7', '30', '0', '40', '1.8'].join('\r\n'))).toBe(1);
    expect(count(drawing, ['0', 'CIRCLE', '8', 'HOLES', '10', '-40', '20', '25', '30', '0', '40', '2.5'].join('\r\n'))).toBe(1);
    expect(count(drawing, 'CIRCLE')).toBe(5);
    // before the holes were made the plate has its outline and nothing else
    expect(outlineAbout(only(unwrap(engine.export('dxf', { plane: LID_UNDERSIDE, offset: -0.5 }, { at: 'lipInside' })))).loops).toBe(1);
  });

  it('SVG: the same loops in millimetres with y turned over; the top face of the lid gives the mouths of the countersinks', () => {
    const file = only(unwrap(engine.export('svg', { plane: LID_UNDERSIDE, offset: -0.5 })));
    expect([file.path, file.mediaType]).toEqual(['outline.svg', 'image/svg+xml']);
    const drawing = text(file);
    expect(drawing).toContain('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="82mm" height="52mm" viewBox="-81 -51 82 52">');
    expect(drawing).toContain('<title>lid</title>');
    expect(drawing).toContain('<path class="outer" d="M -80 0 L 0 0 L 0 -50 L -80 -50 Z"/>');
    expect(drawing).toContain('<circle class="hole" cx="-71.3" cy="-8.7" r="1.8"/>');
    expect(drawing).toContain('<circle class="hole" cx="-40" cy="-25" r="2.5"/>');
    expect(count(drawing, '<circle ')).toBe(5);
    // just under the top face, the circles of a cone of 45° are smaller by the precision of the coordinates
    const top = only(unwrap(engine.export('svg', { plane: onFace('lid', LID_TOP) })));
    expect(text(top)).toContain('<circle class="hole" cx="8.7" cy="-8.7" r="3.45992"/>');
    expect(text(top)).toContain('<circle class="hole" cx="40" cy="-25" r="3.99992"/>');
    expect(outlineAbout(top).inPlane?.[0].body).toBe('lid');
  });

  it('DXF: the box at z = 10, the ring of its walls, three posts as circles and the fourth with its round side as an arc in three pieces', () => {
    const file = only(unwrap(engine.export('dxf', { plane: XY_PLANE, offset: 10 })));
    const about = outlineAbout(file);
    expect([about.bodies, about.loops, about.circles]).toEqual([['box'], 6, 3]);
    near(about.area, 755.5653);
    const drawing = text(file);
    expect(count(drawing, ['0', 'POLYLINE', '8', 'OUTER'].join('\r\n'))).toBe(1);
    expect(count(drawing, ['0', 'POLYLINE', '8', 'HOLES'].join('\r\n'))).toBe(2);
    const bulges = drawing.split('\r\n').flatMap((line, i, lines) => (line === '42' && i % 2 === 0 ? [Number(lines[i + 1])] : []));
    expect(bulges.length).toBe(3); // 250°: three pieces, never one
    for (const bulge of bulges) expect(Math.abs(bulge)).toBeLessThanOrEqual(Math.tan((QUARTER * (1 + TURN_ALLOWANCE)) / 4));
  });

  it('a face as the plane: the floor of the cavity gives the whole slab under it; a plane the box only stands on gives nothing and says so', () => {
    near(outlineAbout(only(unwrap(engine.export('svg', { plane: onFace('box', FLOOR) })))).area, 4000, 1e-6);
    expect(outlineAbout(only(unwrap(engine.export('svg', { plane: onFace('box', FLOOR), offset: 0.5 })))).loops).toBeGreaterThan(1);
    const standing = unwrap(engine.export('dxf', { plane: XY_PLANE }));
    expect(standing.empty).toBe('the plane cuts none of the bodies; "box" has a face in the plane and lies on the side the normal of the plane points to: move `offset` into the body');
    // the one file is still there: a drawing without entities, the box of the margin alone
    const drawing = unwrap(engine.export('svg', { plane: XY_PLANE }));
    expect(drawing.files.length).toBe(1);
    expect(text(drawing.files[0])).toContain('width="2mm" height="2mm" viewBox="-1 -1 2 2"');
    expect(outlineAbout(drawing.files[0]).bounds).toBeUndefined();
    // no printed body: the plane is resolved all the same, `about` has its frame
    const unprinted = asReference(['box', 'lid']);
    const model = unwrap(engine.export('3mf', {}, unprinted));
    expect(model.empty).toBe(NO_PRINTED_BODY);
    expect(readZip(model.files[0].bytes).length).toBe(3);
    const noBody = unwrap(engine.export('dxf', { plane: XY_PLANE, offset: 10 }, unprinted));
    expect(noBody.empty).toBe(NO_PRINTED_BODY);
    expect(text(noBody.files[0])).not.toContain('POLYLINE');
    expect(outlineAbout(noBody.files[0]).frame.origin[2]).toBe(10);
    expect(outlineAbout(noBody.files[0]).loops).toBe(0);
  });

  it('a face as the plane takes the body of the face alone; a list takes what it names (the review of D54)', () => {
    // half a millimetre under the underside of the lid, outside it: the lip of the lid and the walls of the box
    const alone = outlineAbout(only(unwrap(engine.export('dxf', { plane: LID_UNDERSIDE, offset: 0.5 }))));
    expect([alone.bodies, alone.loops]).toEqual([['lid'], 2]);
    const both = outlineAbout(only(unwrap(engine.export('dxf', { plane: LID_UNDERSIDE, offset: 0.5, bodies: ['box', 'lid'] }))));
    expect(both.bodies).toEqual(['box', 'lid']);
    expect(both.loops).toBeGreaterThan(alone.loops);
  });

  it('refusals: a round face as the plane, a body that is not there, an empty list, an option the format does not have', () => {
    const code = (outcome: QueryOutcome<Exported>): string | undefined => (outcome.ok ? undefined : `${outcome.error.code} ${(outcome.error.arg ?? []).join('/')}`);
    expect(code(engine.export('dxf', { plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pa' }) }))).toBe('notAvailable plane');
    expect(code(engine.export('svg', { plane: XY_PLANE, bodies: ['nope'] }))).toBe('notAvailable bodies/0');
    expect(code(engine.export('3mf', { bodies: [] }))).toBe('invalidArguments bodies');
    expect(code(engine.export('dxf', { plane: XY_PLANE, flip: true } as never))).toBe('invalidArguments flip');
  });
});

describe('scenario 12, the part of 2d: round corners by the fillet of the sketch, the bare command setCurvePoint', () => {
  let engine: Engine;
  let finished: EngineState;
  let fillets: Record<Id, Record<string, Id[]>>;
  const CORNERS: Id[] = ['o1', 'o2', 'o3', 'o4'];
  // the five features that read the one region of the outline
  const ON_OUTLINE: Id[] = ['box', 'cavity', 'lid', 'lip', 'lipInside'];
  const allOk = (state: EngineState): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');
  const facesOf = (state: EngineState, body: Id): string[] => state.evaluation.bodies[body].faces.map((face) => faceKey(state.evaluation.faceNames[face.id]));
  const keptFaces = (before: EngineState, after: EngineState): boolean => ['box', 'lid'].every((body) => facesOf(before, body).every((name) => facesOf(after, body).includes(name)));
  const contextOf = (state: EngineState, sketch: Id) => ({ sketch: state.document.features.find((f) => f.id === sketch) as SketchFeature, result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document });
  const filletCorner = (sketch: Id, corner: Id, radius: number | string, prefix: string): Record<string, Id[]> => {
    const state = engine.getState();
    const made = sketchTool('fillet', contextOf(state, sketch), { corner, radius }, freshIds(state.document, prefix));
    if (!made.ok) throw new Error(made.message);
    run(engine, { type: 'batch', commands: made.commands });
    return made.ids;
  };
  const refusal = (sketch: Id, corner: Id, radius: number | string): string | undefined => {
    const state = engine.getState();
    const made = sketchTool('fillet', contextOf(state, sketch), { corner, radius }, freshIds(state.document, 'x_'));
    return made.ok ? undefined : made.message;
  };
  const pointOf = (state: EngineState, sketch: Id, id: Id): [number, number] => {
    const p = state.evaluation.features[sketch].sketch!.points[id];
    return [p.x, p.y];
  };
  beforeAll(() => {
    // the finished model of 2a, 2b, 2f, 2c and 2e
    engine = newEngine();
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
    const hardware = (args: object) => {
      const answer = engine.query('hardwareHole', args as never);
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.result as { shape: HoleFeature['shape']; label: string; depth?: number };
    };
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const countersunk = hardware({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    run(engine, screwHoles(countersunk.shape, countersunk.label, String(Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1))));
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const insert = hardware({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    run(engine, insertHoles(insert.shape, insert.label, insert.depth as number), vents(), midPlanes(), ribMirror(), pads());
    finished = engine.getState();
    expectAllOk(finished);
  });

  it('the finished model: what reads the outline, and what stands on a side face of it', () => {
    // 33 features: 22 of 2a, 2b, 2f and 2c, 11 of 2e
    expect(finished.document.features).toHaveLength(33);
    const readers = finished.document.features.filter((f) => f.type === 'extrude' && f.profile.sketch === 'outline').map((f) => f.id);
    expect(readers).toEqual(ON_OUTLINE);
  });

  it('what reads one line of a corner alone is named in shortened (tried on previews, before the corners are rounded)', () => {
    // a sketch on the top of the lid projects the edge of the top with the side of `ob` (o2 to o3)
    const top: FaceName = { feature: 'lid', role: 'endCap' };
    const note: Command[] = [sketchOn('edgeNote', onFace('lid', top)), { type: 'addExternal', sketch: 'edgeNote', id: 'edge', ref: { type: 'edge', body: 'lid', edge: { a: top, b: { feature: 'lid', role: 'side', curve: 'ob' } }, kind: 'line' } }];
    const noted = preview(engine, { type: 'batch', commands: note });
    const fillet = (corner: Id) => sketchTool('fillet', contextOf(noted, 'outline'), { corner, radius: 6 }, freshIds(noted.document, 'n_'));
    const [near3, far] = [fillet('o3'), fillet('o1')];
    if (!near3.ok || !far.ok) throw new Error('refused');
    expect(near3.ids.shortened).toEqual(['edgeNote']);
    expect(far.ids.shortened).toEqual([]);
    const rounded = preview(engine, { type: 'batch', commands: [...note, ...near3.commands] });
    expect(rounded.evaluation.features.edgeNote).toMatchObject({ status: 'ok', warnings: [] });
    near(pointOf(rounded, 'edgeNote', 'edge/b')[1], 44, 1e-6);
    // a wall along `b12` alone, one of the two lines of the bracket: 7 long in place of 11
    const half: Command = { type: 'addFeature', feature: { id: 'half', name: 'half', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'ribs', curves: ['b12'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'new' } };
    const withHalf = preview(engine, half);
    const bend = sketchTool('fillet', contextOf(withHalf, 'ribs'), { corner: 'b2', radius: 4 }, freshIds(withHalf.document, 'n_'));
    if (!bend.ok) throw new Error(bend.message);
    expect(bend.ids).toMatchObject({ patched: ['bracket'], shortened: ['half'] });
    const bent = preview(engine, { type: 'batch', commands: [half, ...bend.commands] });
    expect(bent.evaluation.features.half.status).toBe('ok');
    near(volumeOf(withHalf, 'half'), 211.2, 1e-2);
    near(volumeOf(bent, 'half'), 134.4, 1e-2);
    const ends = bent.evaluation.bodies.half.faces.flatMap((face) => {
      const name = bent.evaluation.faceNames[face.id];
      return name.role === 'wallEnd' ? [name.point] : [];
    });
    expect(ends).toContain(bend.ids.ends[bend.ids.lines.indexOf('b12')]);
    expect(ends).not.toContain('b2');
  });

  it('refusals, before the bracket is rounded: the end of one line, a point no line ends at, an expression without a value, a radius the lines are too short for', () => {
    expect(refusal('ribs', 'b1', 2)).toMatch(/not the common end of exactly two lines: what ends there is "b12" \(line\)/);
    expect(refusal('postSketch', 'mid', 2)).toMatch(/no curve ends there/);
    expect(refusal('ribs', 'b2', 'noSuchParameter')).toMatch(/^radius: .*noSuchParameter/);
    // the lines are 11 and 13 long at a right angle: the radius has to be below 11
    expect(refusal('ribs', 'b2', 11)).toMatch(/has to be below 11$/);
    expect(refusal('ribs', 'b2', 4)).toBeUndefined();
  });

  it('four fillets of the outline by one parameter: every feature on it patched, no face lost, twenty round faces, the lid still fits', () => {
    run(engine, { type: 'setParameter', name: 'cornerR', expr: '6' });
    fillets = Object.fromEntries(CORNERS.map((corner, i) => [corner, filletCorner('outline', corner, 'cornerR', `f${i + 1}_`)]));
    const state = engine.getState();
    expectAllOk(state);
    const arcs = CORNERS.map((corner) => fillets[corner].arc[0]);
    for (const corner of CORNERS) expect(fillets[corner].patched).toEqual(ON_OUTLINE);
    for (const id of ON_OUTLINE) expect(featureOf(state, id).profile).toMatchObject({ regions: [{ outerLoop: [...OUTLINE, ...arcs].sort() }] });
    // as determined as before, its sizes still between the sharp corners
    const outline = state.evaluation.features.outline.sketch!;
    expect(outline.degreesOfFreedom).toBe(0);
    expect(outline.regions).toHaveLength(1);
    near(outline.points.o3.x, 80, 1e-9);
    near(outline.points.o3.y, 50, 1e-9);
    // sixteen cylinders (the box 6, the cavity 4, the plate of the lid and the lip) and four cones (the lip has a lead-in)
    const round = state.evaluation.faceNames.flatMap((name, i) => (name.role === 'side' && arcs.includes(name.curve) && !name.copy ? [{ name, surface: state.evaluation.faceSurfaces[i] }] : []));
    expect(round).toHaveLength(20);
    expect(round.filter((face) => face.surface.kind === 'cylinder')).toHaveLength(16);
    expect(round.filter((face) => face.surface.kind === 'cone')).toHaveLength(4);
    const radiusOf = (feature: Id): number => (round.find((face) => face.name.feature === feature)!.surface as { radius: number }).radius;
    near(radiusOf('box'), 6, 1e-9);
    near(radiusOf('cavity'), 4, 1e-9);
    expect(keptFaces(finished, state)).toBe(true);
    expect(engine.query('interference', { bodies: ['box', 'lid', ...PADS] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('what the fillets moved without an error: the brace at o4 and the vent slots at o1; nothing reads one line of the outline alone', () => {
    // `od` starts at o4 and the brace stands on its side face in the cavity; `oa` starts at o1 and the vents stand on its outer side
    expect(fillets.o4.moved).toEqual(['braceSketch']);
    expect(fillets.o1.moved).toEqual(['ventSketch']);
    expect(fillets.o2.moved).toEqual([]);
    expect(fillets.o3.moved).toEqual([]);
    for (const corner of CORNERS) expect(fillets[corner].shortened).toEqual([]);
    const state = engine.getState();
    // the face started at the corner of the cavity, y = W − wall; it starts where the moved arc ends, y = W − cornerR
    near(finished.evaluation.features.braceSketch.plane!.origin[1], 48, 1e-9);
    near(state.evaluation.features.braceSketch.plane!.origin[1], 44, 1e-9);
    // the vents start 6 mm further along the wall, the fourth at x = 38 in place of 32
    near(state.evaluation.features.ventSketch.plane!.origin[0], 6, 1e-9);
    const fourth: FaceName = { feature: 'vent', role: 'side', curve: 'vd', copy: [{ pattern: 'ventRow', index: 4 }] };
    expect(faceBox(finished, 'box', fourth)?.min[0]).toBeCloseTo(32, 5);
    expect(faceBox(state, 'box', fourth)?.min[0]).toBeCloseTo(38, 5);
    // both are put back by their dimensions from the origin of their sketch
    const back = run(engine, { type: 'setConstraintValue', sketch: 'braceSketch', id: 'brcx', value: '-(W - cornerR - wall - 16)' }, { type: 'batch', commands: ['v1x', 'v2x', 'v3x', 'v4x'].map((id, i): Command => ({ type: 'setConstraintValue', sketch: 'ventSketch', id, value: `${i === 1 || i === 2 ? '16 + 2' : '16'} - cornerR` })) });
    expectAllOk(back);
    expect(faceBox(back, 'box', fourth)?.min[0]).toBeCloseTo(32, 5);
    const brace: FaceName = { feature: 'brace', role: 'side', curve: 'br' };
    expect(faceBox(back, 'box', brace)?.min[1]).toBeCloseTo(faceBox(finished, 'box', brace)!.min[1], 6);
  });

  it('the radius is one parameter; an inward offset that uses it up is an error of that feature', () => {
    expect(allOk(preview(engine, { type: 'setParameter', name: 'cornerR', expr: '8' }))).toBe(true);
    // the inside of the lip is moved in by wall + clearance + lipT = 3.7
    const used = preview(engine, { type: 'setParameter', name: 'cornerR', expr: '3.7' });
    expect(used.evaluation.features.lipInside.error?.code).toBe('invalidProfile');
    expect(used.evaluation.features.cavity.status).toBe('ok');
    expect(allOk(preview(engine, { type: 'setParameter', name: 'L', expr: '120' }))).toBe(true);
  });

  it('the rim of a round corner on the top of the lid projects as a circle', () => {
    const top: FaceName = { feature: 'lid', role: 'endCap' };
    const state = preview(engine, { type: 'batch', commands: [sketchOn('roundRim', onFace('lid', top)), { type: 'addExternal', sketch: 'roundRim', id: 'rim', ref: { type: 'edge', body: 'lid', edge: { a: top, b: { feature: 'lid', role: 'side', curve: fillets.o3.arc[0] } }, kind: 'circle' } }] });
    expect(state.evaluation.features.roundRim.status).toBe('ok');
    near(state.evaluation.features.roundRim.sketch!.radii.rim, 6, 1e-6);
    const centre = pointOf(state, 'roundRim', 'rim/center');
    near(centre[0], 74, 1e-6);
    near(centre[1], 44, 1e-6);
  });

  it('a corner that was filleted is no corner any more', () => {
    expect(refusal('outline', 'o3', 2)).toBe('"o3" is not the common end of exactly two lines: no curve ends there');
  });

  it('the bracket gets a round bend: a construction arc added to the curves of its wall; a bend of 1 leaves the inner side no radius', () => {
    const before = engine.getState();
    const ids = filletCorner('ribs', 'b2', 4, 'bf_');
    const state = engine.getState();
    expectAllOk(state);
    expect(ids.patched).toEqual(['bracket']);
    const arc = ids.arc[0];
    expect((state.document.features.find((f) => f.id === 'ribs') as SketchFeature).curves[arc]).toMatchObject({ construction: true, type: 'arc' });
    expect(featureOf(state, 'bracket').profile).toMatchObject({ curves: ['b12', 'b23', arc].sort() });
    expect(state.evaluation.faceNames.filter((name, i) => name.feature === 'bracket' && name.role === 'wallSide' && name.curve === arc && facesOf(state, 'box').includes(faceKey(state.evaluation.faceNames[i])))).toHaveLength(2);
    expect(keptFaces(before, state)).toBe(true);
    const tight = preview(engine, { type: 'setConstraintValue', sketch: 'ribs', id: ids.radius[0], value: 1 });
    expect(tight.evaluation.features.bracket.error?.code).toBe('invalidProfile');
  });

  it('the bare command: the foot of the rib moved to a new point; its faces keep their names and the brace that ends in its side follows', () => {
    const before = engine.getState();
    const ribFaces = (state: EngineState): string[] => facesOf(state, 'box').filter((key) => state.evaluation.faceNames.some((name) => name.feature === 'rib' && faceKey(name) === key));
    const state = run(engine, pointAt('ribs', 'r1c', 'L / 2 + 6', 'wall / 2'), { type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'a', to: 'r1c' });
    expectAllOk(state);
    const sketch = state.document.features.find((f) => f.id === 'ribs') as SketchFeature;
    expect(sketch.curves.r1).toEqual({ construction: true, type: 'line', a: 'r1c', b: 'r1b' });
    // the point the line left is still there, with its two dimensions
    expect('r1a' in sketch.points && 'r1ax' in sketch.constraints).toBe(true);
    expect(ribFaces(state)).toEqual(ribFaces(before));
    expect(facesOf(state, 'box')).toContain(faceKey(RIB_LEFT));
    expect(state.evaluation.features.brace.facts?.lengthMin).toBeGreaterThan(38);
  });

  it('a gusset drawn as two lines with end points of their own is joined by re-pointing one onto the other, and its corner can then be filleted', () => {
    run(
      engine,
      pointAt('ribs', 'g1', '14', 'wall / 2'),
      pointAt('ribs', 'g2', '14', 'wall + 8'),
      pointAt('ribs', 'g2b', '14', 'wall + 8'),
      pointAt('ribs', 'g3', 'wall / 2', 'wall + 8'),
      { type: 'addCurve', sketch: 'ribs', id: 'g12', curve: { type: 'line', a: 'g1', b: 'g2', construction: true } },
      { type: 'addCurve', sketch: 'ribs', id: 'g23', curve: { type: 'line', a: 'g2b', b: 'g3', construction: true } },
    );
    const apart = run(engine, { type: 'addFeature', feature: { id: 'gusset', name: 'gusset', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'ribs', curves: ['g12', 'g23'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] } });
    expect(apart.evaluation.features.gusset.error?.code).toBe('invalidProfile');
    const joined = run(engine, { type: 'batch', commands: [{ type: 'setCurvePoint', sketch: 'ribs', id: 'g23', point: 'a', to: 'g2' }, { type: 'removeEntity', sketch: 'ribs', id: 'g2b' }] });
    expectAllOk(joined);
    // the lines are 9 and 13 long at a right angle: 2 fits, 20 does not
    expect(refusal('ribs', 'g2', 2)).toBeUndefined();
    expect(refusal('ribs', 'g2', 20)).toMatch(/has to be below 9$/);
  });

  it('refused re-points, each an invalid command that changes nothing; the point a curve has is no change', () => {
    const refused = (point: string, to: Id, id: Id = 'r1'): boolean => !engine.preview({ type: 'setCurvePoint', sketch: 'ribs', id, point, to } as Command).ok;
    expect(refused('b', 'r1c')).toBe(true); // both ends of the line at one point
    expect(refused('center', 'r1b')).toBe(true); // a line has no centre
    expect(refused('a', 'o1')).toBe(true); // a point of another sketch
    expect(refused('a', 'nope')).toBe(true);
    expect(refused('a', 'r1b', 'nope')).toBe(true);
    // the middle of a line cannot be its end: the batch is refused at its last command
    const middle: Command[] = [pointAt('ribs', 'r1m', 'L / 2', 'wall'), { type: 'addConstraint', sketch: 'ribs', id: 'r1mid', constraint: { type: 'midpoint', point: 'r1m', line: 'r1' } }, { type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'b', to: 'r1m' }];
    const result = engine.preview({ type: 'batch', commands: middle });
    expect(!result.ok && result.error.commandIndex).toBe(2);
    expect(engine.preview({ type: 'batch', commands: middle.slice(0, -1) }).ok).toBe(true);
    const before = engine.getState().document;
    expect(engine.execute({ type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'b', to: 'r1b' }).ok).toBe(true);
    expect(engine.getState().document).toBe(before);
  });

  it('at the port of the solver a fillet drawn exactly is solved again with another radius', async () => {
    const solver = await createPlanegcsSolver();
    const input = (radius: number): SolveInput => ({
      points: { origin: { x: 0, y: 0 }, p: { x: 0, y: 0 }, q1: { x: 40, y: 0 }, q2: { x: 0, y: 30 }, t1: { x: 6, y: 0 }, t2: { x: 0, y: 6 }, c: { x: 6, y: 6 } },
      radii: {},
      curves: { l1: { type: 'line', a: 't1', b: 'q1' }, l2: { type: 'line', a: 'q2', b: 't2' }, f: { type: 'arc', center: 'c', start: 't2', end: 't1' } },
      constraints: {
        fix: { type: 'coincident', a: 'p', b: 'origin' },
        h: { type: 'horizontal', line: 'l1' },
        v: { type: 'vertical', line: 'l2' },
        w: { type: 'distance', a: 'p', b: 'q1', value: 40, driving: true },
        d: { type: 'distance', a: 'p', b: 'q2', value: 30, driving: true },
        tan1: { type: 'tangent', a: 'l1', b: 'f' },
        tan2: { type: 'tangent', a: 'l2', b: 'f' },
        on1: { type: 'pointOnCurve', point: 'p', curve: 'l1' },
        on2: { type: 'pointOnCurve', point: 'p', curve: 'l2' },
        r: { type: 'radius', curve: 'f', value: radius, driving: true },
      },
      fixed: ['origin'],
    });
    expect(solver.solve(input(6)).status).toBe('solved');
    const changed = solver.solve(input(10));
    expect(changed.status).toBe('solved');
    near(changed.points.t1.x, 10, 1e-6);
    near(changed.points.t2.y, 10, 1e-6);
  });

  it('the document loads to the same model', () => {
    const before = engine.getState();
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.getState().document).toEqual(before.document);
    expectAllOk(other.getState());
    for (const body of ['box', 'lid']) near(volumeOf(other.getState(), body), volumeOf(before, body), 1e-9);
  });

  // The part of package 4b (D63), from docs/d36/4b-edge-chamfer-fillet/calls.ts: the loops of the
  // top of the lid and of the bottom of the box are chains of the four lines of the outline and the
  // four arcs of its round corners.
  describe('the part of 4b: a rounded lid and a chamfered foot of the box (D63)', () => {
    const edge = (a: FaceName, b: FaceName): EdgeName => ({ a, b });
    const sideOf = (body: Id, curve: Id): FaceName => ({ feature: body, role: 'side', curve });
    const loopOf = (body: Id, cap: FaceName): EdgeName[] => [...OUTLINE.map((curve) => edge(cap, sideOf(body, curve))), ...CORNERS.map((corner) => edge(cap, sideOf(body, fillets[corner].arc[0])))];
    const blend = (type: 'chamfer' | 'fillet', id: Id, body: Id, edges: EdgeName[], size: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type, body, edges, ...(type === 'chamfer' ? { distance: size } : { radius: size }) } as never });
    const surfaceOf = (state: EngineState, body: Id, name: FaceName): Surface | undefined => {
      const face = state.evaluation.bodies[body].faces.find((f) => faceKey(state.evaluation.faceNames[f.id]) === faceKey(name));
      return face ? state.evaluation.faceSurfaces[face.id] : undefined;
    };
    const TOP: FaceName = { feature: 'lid', role: 'endCap' };
    const BOTTOM: FaceName = { feature: 'box', role: 'startCap' };

    it('the lines of the top of the lid alone are half of a smooth chain: refused, the edge of an arc named', () => {
      const lines = loopOf('lid', TOP).slice(0, 4);
      const error = preview(engine, blend('fillet', 'e5', 'lid', lines, 1.5)).evaluation.features.e5.error;
      expect(error?.code).toBe('unsupportedEdge');
      const arcs = CORNERS.map((corner) => faceKey(sideOf('lid', fillets[corner].arc[0])));
      expect(error?.refs?.some((ref) => typeof ref === 'object' && ref !== null && 'a' in ref && [(ref as EdgeName).a, (ref as EdgeName).b].some((face) => arcs.includes(faceKey(face))))).toBe(true);
    });

    it('the top loop of the lid gets a fillet of 1.5 in one feature: four cylinders and four tori, and the lid still clears the box', () => {
      const state = run(engine, blend('fillet', 'lidRound', 'lid', loopOf('lid', TOP), 1.5));
      expectAllOk(state);
      const faces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => surfaceOf(state, 'lid', { feature: 'lidRound', role: 'fillet', edge: i }));
      for (const surface of faces.slice(0, 4)) expect(surface).toMatchObject({ kind: 'cylinder', radius: 1.5 });
      for (const surface of faces.slice(4)) {
        expect(surface?.kind).toBe('torus');
        if (surface?.kind !== 'torus') continue;
        near(surface.minorRadius, 1.5, 1e-9);
        near(surface.majorRadius, 4.5, 1e-9);
      }
      expect(engine.query('interference', { bodies: ['box', 'lid'] })).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
    });

    it('the bottom loop of the box gets a chamfer of 0.4 against elephant foot; a sketch stands on the chamfer of oa', () => {
      const state = run(engine, blend('chamfer', 'foot', 'box', loopOf('box', BOTTOM), 0.4), sketchOn('onFoot', onFace('box', { feature: 'foot', role: 'chamfer', edge: 0 })));
      expectAllOk(state);
      const faces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => surfaceOf(state, 'box', { feature: 'foot', role: 'chamfer', edge: i }));
      for (const surface of faces.slice(0, 4)) expect(surface?.kind).toBe('plane');
      for (const surface of faces.slice(4)) {
        expect(surface?.kind).toBe('cone');
        if (surface?.kind === 'cone') near(surface.halfAngle, Math.PI / 4, 1e-9);
      }
      const frame = state.evaluation.features.onFoot.plane!;
      [6, 0, 0.4].forEach((value, i) => near(frame.origin[i], value, 1e-6));
      [1, 0, 0].forEach((value, i) => near(frame.y[i], value, 1e-9));
      [0, -Math.SQRT1_2, -Math.SQRT1_2].forEach((value, i) => near(frame.normal[i], value, 1e-9));
    });

    it('the document with the rounded lid and the chamfered foot loads to the same model', () => {
      const before = engine.getState();
      const other = newEngine();
      expect(other.load(engine.save()).ok).toBe(true);
      expectAllOk(other.getState());
      for (const body of ['box', 'lid']) near(volumeOf(other.getState(), body), volumeOf(before, body), 1e-9);
    });
  });
});
