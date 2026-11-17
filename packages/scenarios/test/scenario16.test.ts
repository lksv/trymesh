// Validation scenario 16 (docs/requirements.md), the part of package 2h (D66): a part from one
// layout sketch. Written from docs/d36/2h-extent-start/calls.ts.
//
// Every outline of the part is in one sketch on the base plane XY, the way a model converted from
// Onshape or built by an AI through MCP has it: a plate, a boss on the plate with a pocket in its
// top, a post from the plate up to a lid, a counterbored hole from the top of the plate, and the
// boss with its pocket mirrored under the plate. No sketch stands on a face; the heights come from
// the faces the features start at, so a thicker plate moves everything that stands on it. The
// numbers in the comments are from the parameters (base 4, bossH 12, lidH 30). The steps share one
// engine and run in order.
import { type Command, type CommandResult, type EngineState, type ExtrudeFeature, type FaceName, type HoleExtent, type Id, type Input, type PlaneRef, type RegionRef, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine } from './kit';

const engine = newEngine();
const done = (result: CommandResult): EngineState => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const run = (...commands: Command[]): EngineState => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const preview = (...commands: Command[]): EngineState => done(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const near = (value: number | undefined, expected: number, tolerance = 1e-9): void => {
  expect(value, `${value} is not ${expected}`).toBeDefined();
  expect(Math.abs((value as number) - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(tolerance);
};
const codeOf = (state: EngineState, id: Id): string | undefined => state.evaluation.features[id]?.error?.code;
const fact = (state: EngineState, id: Id, name: string): number | undefined => {
  const value = state.evaluation.features[id]?.facts?.[name];
  return typeof value === 'number' ? value : undefined;
};
const startLevel = (state: EngineState, id: Id): number | undefined => fact(state, id, 'startLevel');

const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
const PLATE_TOP = onFace('plate', { feature: 'plate', role: 'endCap' });
const BOSS_TOP = onFace('plate', { feature: 'boss', role: 'endCap' });

// ---------------------------------------------------------------- the layout sketch

const point = (id: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch: 'layout', id, x, y },
  { type: 'addConstraint', sketch: 'layout', id: `${id}Fix`, constraint: { type: 'fixed', point: id, x, y } },
];
const line = (id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch: 'layout', id, curve: { type: 'line', a, b } });
const circle = (id: Id, center: Id, radius: number): Command[] => [
  { type: 'addCurve', sketch: 'layout', id, curve: { type: 'circle', center }, radius },
  { type: 'addConstraint', sketch: 'layout', id: `${id}R`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];
const PLATE: RegionRef[] = [{ outerLoop: ['e1', 'e2', 'e3', 'e4'] }, { outerLoop: ['bossC'] }, { outerLoop: ['pocketC'] }, { outerLoop: ['postC'] }];
const BOSS: RegionRef[] = [{ outerLoop: ['bossC'] }, { outerLoop: ['pocketC'] }];
const extrude = (id: Id, regions: RegionRef[], extent: Input<ExtrudeFeature>['extent'], operation: 'new' | 'add' | 'cut'): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'layout', regions }, extent, operation, ...(operation === 'new' ? {} : { targets: ['plate'] }) },
});
const hole = (extent: Input<HoleExtent>): Command => ({
  type: 'addFeature',
  feature: { id: 'screwHole', name: 'screwHole', suppressed: false, type: 'hole', sketch: 'layout', points: ['screw'], shape: { type: 'counterbore', diameter: 3.4, headDiameter: 6.5, headDepth: 2 }, extent, targets: ['plate'], label: 'M3 socket head screw' },
});

describe('scenario 16: a part from one layout sketch, its features starting at faces (2h, D66)', () => {
  it('a. the plate, the boss on its top, the pocket under the top of the boss, the post up to the lid and the hole from the top', () => {
    run(
      { type: 'setParameter', name: 'base', expr: '4' },
      { type: 'setParameter', name: 'bossH', expr: '12' },
      { type: 'setParameter', name: 'lidH', expr: '30' },
      { type: 'addFeature', feature: emptySketch('layout', 'layout', { kind: 'base', plane: 'XY' }) },
      ...point('c1', 0, 0),
      ...point('c2', 80, 0),
      ...point('c3', 80, 50),
      ...point('c4', 0, 50),
      line('e1', 'c1', 'c2'),
      line('e2', 'c2', 'c3'),
      line('e3', 'c3', 'c4'),
      line('e4', 'c4', 'c1'),
      ...point('bc', 20, 25),
      ...circle('bossC', 'bc', 8),
      ...circle('pocketC', 'bc', 4),
      ...point('pc', 60, 38),
      ...circle('postC', 'pc', 4),
      ...point('screw', 60, 12),
    );
    const state = run(
      extrude('plate', PLATE, { type: 'distance', start: 0, distance: 'base' }, 'new'),
      extrude('boss', BOSS, { type: 'distance', from: PLATE_TOP, start: 0, distance: 'bossH' }, 'add'),
      extrude('pocket', [{ outerLoop: ['pocketC'] }], { type: 'distance', from: BOSS_TOP, start: 0, distance: -5 }, 'cut'),
      { type: 'addFeature', feature: { id: 'lid', name: 'lid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 'lidH' } },
      extrude('post', [{ outerLoop: ['postC'] }], { type: 'upTo', from: PLATE_TOP, start: 0, plane: { kind: 'plane', feature: 'lid' } }, 'add'),
      hole({ type: 'throughAll', side: 'backward', from: PLATE_TOP }),
    );
    for (const id of ['plate', 'boss', 'pocket', 'post', 'screwHole']) expect(state.evaluation.features[id].status, id).toBe('ok');
    near(startLevel(state, 'boss'), 4); // the top of the plate
    near(startLevel(state, 'pocket'), 16); // the top of the boss: base + bossH
    near(startLevel(state, 'post'), 4);
    near(fact(state, 'post', 'lengthMin'), 26); // lidH − base, measured from the start
    near(fact(state, 'screwHole', 'depth'), 4, 1e-6); // the targets reach 4 mm below the mouth
    near(startLevel(state, 'screwHole'), 4);
    expect(startLevel(state, 'plate')).toBeUndefined(); // no `from`, no fact
    // the head of the counterbore is at the top: its seat 2 under the top of the plate
    const seat = state.evaluation.faceSurfaces[state.evaluation.faceNames.findIndex((name) => name.feature === 'screwHole' && name.role === 'holeSeat')];
    expect(seat).toMatchObject({ kind: 'plane', normal: [0, 0, 1] });
    near(seat.kind === 'plane' ? seat.origin[2] : undefined, 2, 1e-6);
  });

  it('b. a thicker plate: nothing that stands on it is changed, and everything follows; the post gets shorter', () => {
    const state = preview({ type: 'setParameter', name: 'base', expr: '6' });
    near(startLevel(state, 'boss'), 6);
    near(startLevel(state, 'pocket'), 18);
    near(fact(state, 'post', 'lengthMin'), 24);
    near(fact(state, 'screwHole', 'depth'), 6, 1e-6);
    near(startLevel(state, 'screwHole'), 6);
  });

  it('c. the boss and its pocket mirrored in the middle plane of the plate: the copy starts at the underside', () => {
    run(
      { type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 'base / 2' } },
      { type: 'addFeature', feature: { id: 'flip', name: 'flip', suppressed: false, type: 'pattern', source: { type: 'features', features: ['boss', 'pocket'] }, transform: { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } } } },
      // a sketch on the top of the mirrored boss, to read where it is
      { type: 'addFeature', feature: emptySketch('under', 'under', { kind: 'base', plane: 'XY' }) },
      { type: 'setSketchPlane', sketch: 'under', plane: onFace('plate', { feature: 'boss', role: 'endCap', copy: [{ pattern: 'flip', index: 1 }] }) },
    );
    const state = engine.getState();
    expect(state.evaluation.features.flip.status).toBe('ok');
    const under = state.evaluation.features.under.plane;
    near(under?.origin[2], -12, 1e-6); // 12 under the underside of the plate
    near(under?.normal[2], -1);
  });

  it('d. the refusals: a side wall, a tilted plane, a round face, a top that is not there', () => {
    const from = (plane: PlaneRef): string | undefined => codeOf(preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: plane } } }), 'boss');
    // a side of the plate is parallel to the direction of the boss
    expect(from(onFace('plate', { feature: 'plate', role: 'side', curve: 'e1' }))).toBe('invalidExtent');
    // a plane tilted by 10° about X: a tilted start is not built
    const slope = preview(
      { type: 'addFeature', feature: { id: 'slope', name: 'slope', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 'deg(10)' } }, index: 1 },
      { type: 'updateFeature', id: 'boss', patch: { extent: { from: { kind: 'plane', feature: 'slope' } } } },
    );
    expect(codeOf(slope, 'boss')).toBe('invalidExtent');
    expect(slope.evaluation.features.boss.error?.refs).toEqual([{ kind: 'plane', feature: 'slope' }]);
    expect(slope.evaluation.features.boss.error?.message).toMatch(/tilted against the sketch plane by 0\.175 rad/);
    // the side of the post is round
    expect(codeOf(preview({ type: 'updateFeature', id: 'screwHole', patch: { extent: { from: onFace('plate', { feature: 'post', role: 'side', curve: 'postC' }) } } }), 'screwHole')).toBe('nonPlanarFace');
    // the boss is suppressed, so the top the pocket starts at is not there
    const gone = preview({ type: 'setSuppressed', id: 'boss', suppressed: true });
    expect(codeOf(gone, 'pocket')).toBe('brokenReference');
    expect(gone.evaluation.features.pocket.error?.refs).toEqual([BOSS_TOP]);
  });

  it('e. invalid commands: a face of a later feature, "through all" to both sides from a face; null goes back to the sketch plane', () => {
    expect(engine.preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: onFace('plate', { feature: 'post', role: 'endCap' }) } } }).ok).toBe(false);
    expect(engine.preview({ type: 'updateFeature', id: 'pocket', patch: { extent: { type: 'throughAll', side: 'both', from: BOSS_TOP } } }).ok).toBe(false);
    // `null` removes the start plane: the boss then starts at the sketch plane, inside the plate
    const state = preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: null } } });
    expect(state.evaluation.features.boss.status).toBe('ok');
    expect(startLevel(state, 'boss')).toBeUndefined();
  });

  it('f. the document saved with its starts loads to the same model', () => {
    const before = engine.getState();
    const after = done(engine.load(engine.save()));
    expect(after.document).toEqual(before.document);
    for (const id of ['boss', 'pocket', 'post', 'screwHole']) expect(after.evaluation.features[id].facts).toEqual(before.evaluation.features[id].facts);
  });
});
