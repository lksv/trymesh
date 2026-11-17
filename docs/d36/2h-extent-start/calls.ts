// Validation scenario 16 (a part from one layout sketch), the package 2h (D66), written as calls
// against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`); after the
// implementation it becomes packages/scenarios/test/scenario16.test.ts. Lines marked
// `@ts-expect-error` are calls that must not compile.
//
// Every outline of the part is in one sketch on the base plane XY, the way a model converted from
// Onshape or built by an AI through MCP has it: a plate, a boss on the plate with a pocket in its
// top, a post from the plate up to a lid, a counterbored hole from the top of the plate, and the
// boss with its pocket mirrored under the plate. No sketch stands on a face; the heights come from
// the faces the features start at, so a thicker plate moves everything that stands on it.
//
// The numbers in the comments are from the parameters (base 4, bossH 12, lidH 30). The same part
// with the starts written as numbers (`start: 'base'`, `start: 'base + bossH'`, the hole as a
// distance from 'base' by '-base'), which is what the package resolves `from` to, was run through
// the real engine on 2026-11-17 (design.md, "Measured"); the package itself was not.

import type { Frame, Id, Input, RegionRef } from '../../../packages/engine/src/index';
import { emptySketch } from '../../../packages/engine/src/index';
import type { CommandAfter, EngineAfter, FaceNameAfter, PlaneRefAfter, StateAfter } from '../00-prep/contract';
import type { ExtentH, HoleExtentH } from './contract';
import { START_FACTS } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const done = (result: ReturnType<EngineAfter['execute']>): StateAfter => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
const run = (...commands: CommandAfter[]): StateAfter => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const preview = (...commands: CommandAfter[]): StateAfter => done(engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const near = (a: number | undefined, b: number, within = 1e-9): boolean => a !== undefined && Math.abs(a - b) <= within;
const codeOf = (state: StateAfter, id: Id): string | undefined => state.evaluation.features[id]?.error?.code;
const fact = (state: StateAfter, id: Id, name: string): number | undefined => {
  const value = state.evaluation.features[id]?.facts?.[name];
  return typeof value === 'number' ? value : undefined;
};
const startLevel = (state: StateAfter, id: Id): number | undefined => fact(state, id, Object.keys(START_FACTS)[0]); // startLevel

const onFace = (body: Id, face: FaceNameAfter): PlaneRefAfter => ({ kind: 'face', body, face });
const PLATE_TOP = onFace('plate', { feature: 'plate', role: 'endCap' });
const BOSS_TOP = onFace('plate', { feature: 'boss', role: 'endCap' });

// ---------------------------------------------------------------- the layout sketch

const point = (id: Id, x: number, y: number): CommandAfter[] => [
  { type: 'addPoint', sketch: 'layout', id, x, y },
  { type: 'addConstraint', sketch: 'layout', id: `${id}Fix`, constraint: { type: 'fixed', point: id, x, y } },
];
const line = (id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: 'layout', id, curve: { type: 'line', a, b } });
const circle = (id: Id, center: Id, radius: number): CommandAfter[] => [
  { type: 'addCurve', sketch: 'layout', id, curve: { type: 'circle', center }, radius },
  { type: 'addConstraint', sketch: 'layout', id: `${id}R`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];

// A plate 80 × 50; the circle of the boss (radius 8) with the circle of the pocket (radius 4) at
// (20, 25); the circle of the post (radius 4) at (60, 38); the point of the screw hole at (60, 12).
// (An ID is unique in the whole document, so a curve is not named as the feature it makes.)
export function layout(): StateAfter {
  return run(
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
}
const PLATE: RegionRef[] = [{ outerLoop: ['e1', 'e2', 'e3', 'e4'] }, { outerLoop: ['bossC'] }, { outerLoop: ['pocketC'] }, { outerLoop: ['postC'] }];
const BOSS: RegionRef[] = [{ outerLoop: ['bossC'] }, { outerLoop: ['pocketC'] }];

const extrude = (id: Id, regions: RegionRef[], extent: Input<ExtentH>, operation: 'new' | 'add' | 'cut'): CommandAfter => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'layout', regions }, extent, operation, ...(operation === 'new' ? {} : { targets: ['plate'] }) },
});

// ---------------------------------------------------------------- the part

// The plate from the sketch plane; the boss starts at the top of the plate, the pocket 5 mm down
// from the top of the boss; the post from the top of the plate up to the lid, a plane feature (a
// feature between two planes); the hole from the top of the plate through all of it, with its
// counterbore at the top (without `from` the mouth would be the sketch plane, the underside).
export function part(): StateAfter {
  layout();
  return run(
    extrude('plate', PLATE, { type: 'distance', start: 0, distance: 'base' }, 'new'),
    extrude('boss', BOSS, { type: 'distance', from: PLATE_TOP, start: 0, distance: 'bossH' }, 'add'),
    extrude('pocket', [{ outerLoop: ['pocketC'] }], { type: 'distance', from: BOSS_TOP, start: 0, distance: -5 }, 'cut'),
    { type: 'addFeature', feature: { id: 'lid', name: 'lid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 'lidH' } },
    extrude('post', [{ outerLoop: ['postC'] }], { type: 'upTo', from: PLATE_TOP, start: 0, plane: { kind: 'plane', feature: 'lid' } }, 'add'),
    hole({ type: 'throughAll', side: 'backward', from: PLATE_TOP }),
  );
}
const hole = (extent: HoleExtentH): CommandAfter => ({
  type: 'addFeature',
  feature: { id: 'screwHole', name: 'screwHole', suppressed: false, type: 'hole', sketch: 'layout', points: ['screw'], shape: { type: 'counterbore', diameter: 3.4, headDiameter: 6.5, headDepth: 2 }, extent, targets: ['plate'], label: 'M3 socket head screw' },
});

// What the result says: where each start ended up, and what is measured from it.
export function heights(state: StateAfter): boolean {
  return (
    near(startLevel(state, 'boss'), 4) && // the top of the plate
    near(startLevel(state, 'pocket'), 16) && // the top of the boss: base + bossH
    near(startLevel(state, 'post'), 4) &&
    near(fact(state, 'post', 'lengthMin'), 26) && // lidH − base, measured from the start
    near(fact(state, 'screwHole', 'depth'), 4) && // the targets reach 4 mm below the mouth
    startLevel(state, 'plate') === undefined // no `from`, no fact
  );
}

// A thicker plate: nothing that stands on it is changed, and everything follows. The post gets
// shorter, because its end is the lid.
export function thickerPlate(): boolean {
  const state = preview({ type: 'setParameter', name: 'base', expr: '6' });
  return near(startLevel(state, 'boss'), 6) && near(startLevel(state, 'pocket'), 18) && near(fact(state, 'post', 'lengthMin'), 24) && near(fact(state, 'screwHole', 'depth'), 6) && near(startLevel(state, 'screwHole'), 6);
}

// ---------------------------------------------------------------- a mirrored copy carries its start

// The boss and its pocket mirrored in the middle plane of the plate: the copy starts at the mirror
// image of the top of the plate, which is its underside, and its top is 12 mm under it. (A copy
// that started at the top of the plate itself, as each copy of `upTo` runs to its plane, would run
// down through the plate.)
export function mirrored(): Frame | undefined {
  run(
    { type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 'base / 2' } },
    { type: 'addFeature', feature: { id: 'flip', name: 'flip', suppressed: false, type: 'pattern', source: { type: 'features', features: ['boss', 'pocket'] }, transform: { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } } } },
    // a sketch on the top of the mirrored boss, to read where it is
    { type: 'addFeature', feature: emptySketch('under', 'under', { kind: 'base', plane: 'XY' }) },
    { type: 'setSketchPlane', sketch: 'under', plane: onFace('plate', { feature: 'boss', role: 'endCap', copy: [{ pattern: 'flip', index: 1 }] }) },
  );
  return engine.getState().evaluation.features['under'].plane; // origin z = −12, normal (0, 0, −1)
}

// ---------------------------------------------------------------- the face moves, tilts, goes

export function refusals(): (string | undefined)[] {
  const from = (plane: PlaneRefAfter): string | undefined => codeOf(preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: plane } } }), 'boss');
  return [
    // a side of the plate is parallel to the direction of the boss
    from(onFace('plate', { feature: 'plate', role: 'side', curve: 'e1' })), // invalidExtent
    // a plane tilted by 10° about X: a tilted start is not built
    codeOf(
      preview(
        { type: 'addFeature', feature: { id: 'slope', name: 'slope', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 0, tilt: { axis: { kind: 'base', axis: 'X' }, angle: 'deg(10)' } }, index: 1 },
        { type: 'updateFeature', id: 'boss', patch: { extent: { from: { kind: 'plane', feature: 'slope' } } } },
      ),
      'boss',
    ), // invalidExtent
    // the side of the post is round
    codeOf(preview({ type: 'updateFeature', id: 'screwHole', patch: { extent: { from: onFace('plate', { feature: 'post', role: 'side', curve: 'postC' }) } } }), 'screwHole'), // nonPlanarFace
    // the boss is suppressed, so the top the pocket starts at is not there
    codeOf(preview({ type: 'setSuppressed', id: 'boss', suppressed: true }), 'pocket'), // brokenReference
  ];
}

// A reference is verified by the command: a face of a feature after the boss is an invalid command.
export const faceFromLater = (): boolean => engine.preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: onFace('plate', { feature: 'post', role: 'endCap' }) } } }).ok; // false
// "Through all" to both sides has no start to take.
export const bothSides = (): boolean => engine.preview({ type: 'updateFeature', id: 'pocket', patch: { extent: { type: 'throughAll', side: 'both', from: BOSS_TOP } } }).ok; // false: the validator refuses it
// `null` removes the start plane: the boss then starts at the sketch plane, inside the plate.
export const backToTheSketch = (): number | undefined => {
  const state = preview({ type: 'updateFeature', id: 'boss', patch: { extent: { from: null } } });
  return state.evaluation.features['boss'].status === 'ok' ? (startLevel(state, 'boss') ?? 0) : undefined; // 0
};

export const wrong = (): void => {
  // @ts-expect-error the start plane is a reference, not an ID
  engine.execute({ type: 'updateFeature', id: 'boss', patch: { extent: { from: 'plate' } } });
  // @ts-expect-error "through all" from a plane goes to one side (the rule of the validator)
  const both: StrictThroughAll = { type: 'throughAll', side: 'both', from: PLATE_TOP };
  void both;
};

// The rule the validator keeps, written as a type: `ExtentH` (as types.ts) has `from` optional on
// every variant, so that `extent.from` reads everywhere.
type StrictThroughAll = { type: 'throughAll'; side: 'forward' | 'backward'; from: PlaneRefAfter } | { type: 'throughAll'; side: 'forward' | 'backward' | 'both'; from?: undefined };
const strict: StrictThroughAll = { type: 'throughAll', side: 'backward', from: PLATE_TOP };
const asExtent: ExtentH = strict; // every strict extent is one of types.ts
void asExtent;

// ---------------------------------------------------------------- the scenario

export function scenario16(): boolean {
  const built = part();
  const ok = ['plate', 'boss', 'pocket', 'post', 'screwHole'].every((id) => built.evaluation.features[id].status === 'ok');
  const follows = thickerPlate();
  const under = mirrored();
  const [side, slope, round, gone] = refusals();
  return (
    ok &&
    heights(built) &&
    follows &&
    under !== undefined &&
    near(under.origin[2], -12, 1e-6) &&
    near(under.normal[2], -1, 1e-9) &&
    side === 'invalidExtent' &&
    slope === 'invalidExtent' &&
    round === 'nonPlanarFace' &&
    gone === 'brokenReference' &&
    !faceFromLater() &&
    !bothSides() &&
    backToTheSketch() === 0
  );
}
