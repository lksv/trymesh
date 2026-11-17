// Validation scenario 13 (a link of an arm between two joints), the part of package 3d, written as
// calls against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`); after the
// implementation it becomes a part of packages/scenarios/test/scenario13.test.ts. Lines marked
// `@ts-expect-error` are calls that must not compile.
//
// It continues the arm of 3a-body-properties/calls.ts (`build`): the link `upper` is a plate from
// z = 0 to 8, the motor a cylinder of radius 14 on top of it (z = 8 to 38, at (60, 0)), and four
// screws of radius 1.5 stand around the motor (z = 8 to 14; the body `screw` and the copies
// `screws/1` to `screws/3`). The part of 3d: a mount around the motor with a pocket shaped by the
// motor and the screws themselves, with a print clearance; the mount joined to the link; and the
// link split into two shells for printing. The arm stands as it is modelled: no pose is set, so
// the queries read the bodies where the features made them.

import type { Id, Input, Surface, Vec3 } from '../../../packages/engine/src/index';
import type { CommandAfter, CommandResultAfter, EngineAfter, FaceNameAfter, PlaneRefAfter, QueryOutcome, QueryToolInput, StateAfter } from '../00-prep/contract';
import { SCHEMA_PENDING, UPGRADES } from '../00-prep/contract';
import { build, materials as setMaterials, motor as describeMotor } from '../3a-body-properties/calls';
import type { CombineFeature, SplitFeature } from './contract';
import { CLEARANCE, COMBINE_INFO, SPLIT_INFO, SPLIT_ROLE } from './contract';

declare const engine: EngineAfter;
declare function fail(message: string): never;
const done = (result: CommandResultAfter): StateAfter => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
const run = (...commands: CommandAfter[]): StateAfter => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const about = (value: number | undefined, expected: number, within = 1e-6): boolean => value !== undefined && Math.abs(value - expected) <= within;

// ---------------------------------------------------------------- helpers over existing commands

const onFace = (body: Id, face: FaceNameAfter): PlaneRefAfter => ({ kind: 'face', body, face });
const nameKey = (name: FaceNameAfter): string => JSON.stringify(Object.entries(name).sort(([a], [b]) => (a < b ? -1 : 1)));
// The number of a named face in a state, and its surface.
const faceNumber = (state: StateAfter, name: FaceNameAfter): number => state.evaluation.faceNames.findIndex((other) => nameKey(other) === nameKey(name));
const surfaceOf = (state: StateAfter, name: FaceNameAfter): Surface | undefined => state.evaluation.faceSurfaces[faceNumber(state, name)];
// Does the body have a triangle of that face?
const hasFace = (state: StateAfter, body: Id, name: FaceNameAfter): boolean => state.evaluation.bodies[body]?.faces.some((face) => face.id === faceNumber(state, name)) ?? false;
const volume = (state: StateAfter, body: Id): number => state.evaluation.bodies[body].volume;
const codeOf = (state: StateAfter, feature: Id): string | undefined => state.evaluation.features[feature].error?.code;

const emptySketch = (id: Id, plane: PlaneRefAfter): CommandAfter[] => [
  { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
  ...(plane.kind === 'base' && plane.plane === 'XY' ? [] : [{ type: 'setSketchPlane', sketch: id, plane } as CommandAfter]),
];
// A cylinder along Z: the feature `id` from the circle of its own sketch on XY.
function cylinder(id: Id, x: number, y: number, radius: number, from: number, to: number, operation: 'new' | 'cut' = 'new', targets?: Id[]): CommandAfter[] {
  const [sketch, circle] = [`${id}Sketch`, `${id}Circle`];
  return [
    ...emptySketch(sketch, { kind: 'base', plane: 'XY' }),
    { type: 'addPoint', sketch, id: `${id}Centre`, x, y },
    { type: 'addConstraint', sketch, id: `${id}Fix`, constraint: { type: 'fixed', point: `${id}Centre`, x, y } },
    { type: 'addCurve', sketch, id: circle, curve: { type: 'circle', center: `${id}Centre` }, radius },
    { type: 'addConstraint', sketch, id: `${id}Radius`, constraint: { type: 'radius', curve: circle, value: radius, driving: true } },
    { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [circle] }] }, extent: { type: 'distance', start: from, distance: to - from }, operation, ...(targets ? { targets } : {}) } },
  ];
}
// The two features of the package as commands, in the input form of the contract's own types.
type Fields<F> = Omit<Input<F>, 'id' | 'name' | 'suppressed' | 'type' | 'expressions'>;
const combine = (id: Id, fields: Fields<CombineFeature>, index?: number): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'combine', ...fields }, ...(index === undefined ? {} : { index }) });
const split = (id: Id, name: string, fields: Fields<SplitFeature>): CommandAfter => ({ type: 'addFeature', feature: { id, name, suppressed: false, type: 'split', ...fields } });

// ---------------------------------------------------------------- a mount around the motor

const TOOLS: Id[] = ['motor', 'screw', 'screws/1', 'screws/2', 'screws/3'];
const AROUND: Id[] = ['mount', ...TOOLS];

// A ring that stands on the link around the motor: a new body, modelled without a thought for
// what it has to leave room for. It runs through the motor and the four screws.
// Before it the scenario has what 3a and 5a give the arm: the printed bodies have their material
// (`upper` is PETG), the motor is a reference part of 280 g, and the link `upper` lists its bodies.
export function mount(): number {
  build();
  setMaterials();
  describeMotor();
  run({ type: 'setParameter', name: 'fit', expr: '0.3' }, ...cylinder('mount', 60, 0, 24, 8, 18), { type: 'setLink', id: 'upper', bodies: ['upper', 'mount', ...TOOLS] });
  const report = unwrap(engine.query('interference', { bodies: AROUND }));
  return report.failed.length === 0 ? report.pairs.length : fail('a pair could not be checked'); // 5: the mount with the motor and with each screw
}

// The pocket: the motor and the screws subtracted from the mount, each moved outwards by the print
// clearance. The tools are bought parts and stay.
export const pocket = (): StateAfter => run(combine('pocket', { operation: 'difference', target: 'mount', tools: TOOLS, keepTools: true, clearance: 'fit' }));

// The faces of the pocket are the faces of the tools, tagged with the feature and the number of the
// tool in its list.
const MOTOR_SIDE: FaceNameAfter = { feature: 'motor', role: 'side', curve: 'motorCircle' };
export const POCKET_WALL: FaceNameAfter = { ...MOTOR_SIDE, copy: [{ pattern: 'pocket', index: 1 }] };
const SCREW_TOP: FaceNameAfter = { feature: 'screw', role: 'endCap' };
export const POCKET_CEILING: FaceNameAfter = { ...SCREW_TOP, copy: [{ pattern: 'pocket', index: 2 }] };
// a copy of the screw made by the pattern carries the tag of the pattern first, then that of the pocket
export const COPY_CEILING: FaceNameAfter = { ...SCREW_TOP, copy: [{ pattern: 'screws', index: 2 }, { pattern: 'pocket', index: 4 }] };

export function pocketIsExact(state: StateAfter): boolean {
  const [wall, ceiling] = [surfaceOf(state, POCKET_WALL), surfaceOf(state, POCKET_CEILING)];
  // the wall is the cylinder of the motor with its radius larger by the clearance, to the last digit
  const round = wall?.kind === 'cylinder' && about(wall.radius, 14.3, 1e-12) && about(wall.origin[0], 60, 1e-12);
  // the ceiling of a screw pocket is the plane of the top of the screw (z = 14) moved up by it
  const flat = ceiling?.kind === 'plane' && about(ceiling.origin[2], 14.3, 1e-12);
  // the mount lost the motor's hole right through and four blind pockets, open below (the screws
  // stand on the link: their moved floors lie 0.3 under the mount). Round faces are polygons, so
  // the volume is right to their chord tolerance.
  const expected = Math.PI * (24 * 24 - 14.3 * 14.3) * 10 - 4 * Math.PI * 1.8 * 1.8 * 6.3;
  return round && flat && hasFace(state, 'mount', POCKET_WALL) && hasFace(state, 'mount', COPY_CEILING) && Math.abs(volume(state, 'mount') - expected) < 0.01 * expected;
}

// What the pocket is for: nothing collides any more, nothing is a fit, and the smallest gap between
// the mount and the motor is the clearance (to the accuracy of two polygons of one circle).
export function clearanceMeasured(): { collisions: number; fits: number; unchecked: number; gap: number | undefined } {
  const report = unwrap(engine.query('interference', { bodies: AROUND }));
  // 0.2998: the two are polygons of one circle, so the gap is short of 0.3 by less than the chord tolerance
  const gap = unwrap(engine.query('gap', { bodies: ['mount', 'motor'] })).pairs[0]?.distance;
  return { collisions: report.pairs.length, fits: report.fits.length, unchecked: report.failed.length, gap };
}
// Between two planes the clearance is exact: the top of a screw and the ceiling of its pocket.
export const ceilingOverScrew = (): number | undefined => unwrap(engine.query('measure', { from: { kind: 'face', body: 'screw', face: SCREW_TOP }, to: { kind: 'face', body: 'mount', face: POCKET_CEILING } })).distance; // 0.3
export const overMcp: QueryToolInput = { query: 'gap', args: { bodies: ['mount', 'motor'] }, at: 'pocket' };

// The tools stay what they were: the motor is in the model, a reference part with the mass of its
// data sheet (3a), and the feature created no body.
export const toolsKept = (state: StateAfter): boolean => TOOLS.every((tool) => tool in state.evaluation.bodies) && state.evaluation.bodyProperties['motor'].mass === 280 && state.evaluation.features['pocket'].bodies.length === 0;

// The clearance is a numeric field with an expression: another printer is one parameter.
export function looserFit(): boolean {
  const preview = done(engine.preview({ type: 'setParameter', name: 'fit', expr: '0.5' }));
  const wall = surfaceOf(preview, POCKET_WALL);
  return wall?.kind === 'cylinder' && about(wall.radius, 14.5, 1e-12) && preview.evaluation.features['pocket'].values?.['clearance'] === 0.5;
}
// The field is optional. Without it the pocket is the tools as they are: its faces carry the very
// names of the tools' faces (one face on two bodies, the motor and the mount), the motor fills its
// hole, and nothing has a tag of the pocket.
export function withoutClearance(): boolean {
  const preview = done(engine.preview({ type: 'updateFeature', id: 'pocket', patch: { clearance: null } }));
  return hasFace(preview, 'mount', MOTOR_SIDE) && hasFace(preview, 'motor', MOTOR_SIDE) && faceNumber(preview, POCKET_WALL) < 0 && unwrap(engine.query('gap', { bodies: ['mount', 'motor'] }, { state: preview })).pairs[0]?.distance === 0;
}
// and `setField` gives it back to a feature that does not have it (the field has the default 0)
export const clearanceBySetField: CommandAfter = { type: 'setField', feature: 'pocket', path: 'clearance', value: 'fit' };
export const backBySetField = (): boolean => {
  const preview = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'pocket', patch: { clearance: null } }, clearanceBySetField] }));
  return hasFace(preview, 'mount', POCKET_WALL);
};
// A clearance of 0 is a valid command and computes as none: no face gets a tag.
export function zeroIsNone(): boolean {
  const preview = done(engine.preview({ type: 'setField', feature: 'pocket', path: 'clearance', value: 0 }));
  return preview.evaluation.features['pocket'].status === 'ok' && hasFace(preview, 'mount', MOTOR_SIDE) && faceNumber(preview, POCKET_WALL) < 0;
}

// A sketch stands on a face of the pocket like on any planar face: a cable hole above a screw.
export const onCeiling = (): boolean => engine.preview({ type: 'batch', commands: emptySketch('cable', onFace('mount', POCKET_CEILING)) }).ok;

// A tool that cannot be moved outwards by the clearance is an error of the feature, with the tool
// and the faces in `refs`: the link has holes of radius 4, which a clearance of 5 would close.
export function holeTooNarrow(): { code: string | undefined; names: unknown[] | undefined } {
  const preview = done(engine.preview(combine('tooWide', { operation: 'difference', target: 'mount', tools: ['upper'], keepTools: true, clearance: 5 })));
  const error = preview.evaluation.features['tooWide'].error;
  return { code: error?.code, names: error?.refs }; // invalidClearance; ['upper', { feature: 'shoulderHole', role: 'side', curve: 'shoulderHoleCircle' }, ...]
}
// A tool that misses the target is the warning of every cut that misses; the model stays as it was.
export function missed(): { status: string; refs: unknown[] | undefined } {
  const preview = done(engine.preview(combine('beside', { operation: 'difference', target: 'forearm', tools: ['motor'], keepTools: true })));
  const result = preview.evaluation.features['beside'];
  return { status: result.status, refs: result.warnings[0]?.refs }; // warning; ['motor']
}

// What the commands refuse (invalid commands, nothing changes).
export const refused = (): boolean[] => [
  // a clearance belongs to a difference
  engine.preview(combine('a', { operation: 'union', target: 'mount', tools: ['motor'], keepTools: true, clearance: 0.3 })).ok,
  // a clearance is not negative
  engine.preview(combine('b', { operation: 'difference', target: 'mount', tools: ['motor'], keepTools: true, clearance: -0.1 })).ok,
  // the target is not its own tool, and a tool is listed once
  engine.preview(combine('c', { operation: 'difference', target: 'mount', tools: ['mount'], keepTools: true })).ok,
  engine.preview(combine('d', { operation: 'difference', target: 'mount', tools: ['motor', 'motor'], keepTools: true })).ok,
  engine.preview(combine('e', { operation: 'difference', target: 'mount', tools: [], keepTools: true })).ok,
  // a body is one a feature before this one creates: `pocket` creates none, and `lower` comes later
  engine.preview(combine('f', { operation: 'union', target: 'mount', tools: ['pocket'], keepTools: false })).ok,
  // a combine is no tool a pattern of features could repeat
  engine.preview({ type: 'addFeature', feature: { id: 'g', name: 'g', suppressed: false, type: 'pattern', source: { type: 'features', features: ['pocket'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } }).ok,
]; // all false

// An intersection, as a question about the model before the pocket: what the mount and the motor
// share is a disc of the motor ten high. Previewed in its place on the timeline; nothing is written.
export function shared(): number {
  const before = engine.getState().document.features.findIndex((feature) => feature.id === 'pocket');
  const preview = done(engine.preview(combine('probe', { operation: 'intersection', target: 'mount', tools: ['motor'], keepTools: true }, before), 'probe'));
  return volume(preview, 'mount'); // the area of the polygon of the motor times 10, about pi 14² 10
}

// ---------------------------------------------------------------- the mount joined to the link

// The union: the link takes the mount in, pocket and all, and the body `mount` leaves the model.
export function join(): { gone: boolean; grown: boolean; faces: boolean; motorSits: boolean } {
  const before = engine.getState();
  const state = run(combine('join', { operation: 'union', target: 'upper', tools: ['mount'], keepTools: false }));
  return {
    // the body is gone after the feature and there before it; the link that lists it says so (5a)
    gone: !('mount' in state.evaluation.bodies) && 'mount' in engine.getState('pocket').evaluation.bodies && state.evaluation.mechanism.links['upper'].missing.join() === 'mount',
    // the mount stood flush on the link: nothing is counted twice and nothing is lost
    grown: about(volume(state, 'upper'), volume(before, 'upper') + volume(before, 'mount'), 1e-3),
    // the faces of the mount are faces of the link now, under their names
    faces: hasFace(state, 'upper', { feature: 'mount', role: 'endCap' }) && hasFace(state, 'upper', POCKET_WALL),
    // the motor still sits on the face of the link it was modelled on: the two touch and share nothing
    motorSits: unwrap(engine.query('gap', { bodies: ['upper', 'motor'] })).pairs[0]?.distance === 0 && unwrap(engine.query('interference', { bodies: ['upper', 'motor'] })).pairs.length === 0,
  };
}
// A body that was used up is a broken reference for what comes after, like a body of a removed
// feature: the command is valid, the feature is in error.
export const afterItIsGone = (): string | undefined => codeOf(done(engine.preview({ type: 'batch', commands: cylinder('late', 60, 20, 1, 0, 30, 'cut', ['mount']) })), 'late'); // brokenReference
// The link and the motor share nothing, thanks to the pocket: their intersection is no body.
export const nothingShared = (): string | undefined => codeOf(done(engine.preview(combine('none', { operation: 'intersection', target: 'motor', tools: ['upper'], keepTools: true }))), 'none'); // emptyResult

// ---------------------------------------------------------------- the link in two shells

export const CUT: FaceNameAfter = { feature: 'lower', role: 'splitFace' };

// The link is split at half its thickness for printing: the part under the plane becomes the body
// `lower`, the link keeps the rest (with the mount) and its ID.
export function shells(): { made: Id[]; volumes: boolean; cut: boolean } {
  const before = engine.getState();
  const state = run({ type: 'addFeature', feature: { id: 'mid', name: 'mid', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 4 } }, split('lower', 'Lower shell', { body: 'upper', plane: { kind: 'plane', feature: 'mid' }, side: 'backward' }));
  const surface = surfaceOf(state, CUT);
  return {
    made: state.evaluation.features['lower'].bodies, // ['lower']
    // the lower shell is half the plate; together they are the link of before
    volumes: about(volume(state, 'lower') + volume(state, 'upper'), volume(before, 'upper'), 1e-3) && volume(state, 'lower') < volume(state, 'upper'),
    // one face, on both bodies, in the plane that cut
    cut: surface?.kind === 'plane' && about(surface.origin[2], 4, 1e-12) && hasFace(state, 'upper', CUT) && hasFace(state, 'lower', CUT),
  };
}

// A sketch stands on the cut face of either shell: the same origin and Y axis (those of the plane
// that cut), the normal out of the body it stands on.
export function onTheCut(): [Vec3 | undefined, Vec3 | undefined] {
  const state = done(engine.preview({ type: 'batch', commands: [...emptySketch('onLower', onFace('lower', CUT)), ...emptySketch('onUpper', onFace('upper', CUT))] }));
  return [state.evaluation.features['onLower'].plane?.normal, state.evaluation.features['onUpper'].plane?.normal]; // [0, 0, 1] and [0, 0, -1]
}

// The new shell takes after the link it was cut from (3a): printed in the same material with the
// same density, weighed by its own volume; the mechanism says that no link has it yet (5a).
export function takesAfter(): { from: Id | undefined; material: string | undefined; sameDensity: boolean; name: string; unassigned: boolean } {
  const state = engine.getState();
  const [properties, link] = [state.evaluation.bodyProperties['lower'], state.evaluation.bodyProperties['upper']];
  // 'upper', 'PETG', the density of the link, 'Lower shell', and true: the link `upper` does not list it yet
  return { from: properties.from, material: properties.material, sameDensity: properties.density !== undefined && properties.density === link.density, name: properties.name, unassigned: state.evaluation.mechanism.unassigned.includes('lower') };
}
// It moves with the link once the link lists it.
export const intoTheLink = (): StateAfter => run({ type: 'setLink', id: 'upper', bodies: ['upper', 'lower', ...TOOLS] });

// Screws through both shells: a cut with two targets, as through any two bodies. A cut that names
// only `upper` goes through the upper shell alone, also one that was there before the split was
// put in front of it: the price of a body that keeps its ID.
export const throughBoth = (): StateAfter => run(...cylinder('bolt', 60, 40, 1.6, -1, 9, 'cut', ['upper', 'lower']));

// The other part by a patch of one field: the link then keeps what lies under the plane.
export function otherSide(): boolean {
  const state = engine.getState();
  const preview = done(engine.preview({ type: 'updateFeature', id: 'lower', patch: { side: 'forward' } }));
  return about(volume(preview, 'lower'), volume(state, 'upper'), 1e-3) && about(volume(preview, 'upper'), volume(state, 'lower'), 1e-3);
}

// What a split cannot do is an error of the feature, and the link stays whole.
export function cannot(): (string | undefined)[] {
  return [
    // a plane beside the body cuts nothing
    codeOf(done(engine.preview({ type: 'setField', feature: 'mid', path: 'offset', value: 100 })), 'lower'), // emptyResult
    // a round face is no plane
    codeOf(done(engine.preview({ type: 'updateFeature', id: 'lower', patch: { plane: onFace('motor', MOTOR_SIDE) } })), 'lower'), // nonPlanarFace
    // a plane that is gone
    codeOf(done(engine.preview({ type: 'removeFeature', id: 'mid' })), 'lower'), // brokenReference
  ];
}
// A plane in a face of the body itself, where the mount stands on the plate (z = 8, the top of the
// plate): the mount comes off again as a body of its own.
export function alongAFace(): boolean {
  const preview = done(engine.preview(split('ring', 'Ring', { body: 'upper', plane: onFace('upper', { feature: 'upper', role: 'endCap' }), side: 'forward' })));
  return about(volume(preview, 'ring'), Math.PI * (24 * 24 - 14.3 * 14.3) * 10 - 4 * Math.PI * 1.8 * 1.8 * 6.3, 0.01 * Math.PI * 24 * 24 * 10);
}

// ---------------------------------------------------------------- the document

// No upgrade step: the list of steps has none of this package, and nothing is pending for it.
export const noStep = (): boolean => SCHEMA_PENDING === 0 && !UPGRADES.some((step) => step.name.startsWith('3d'));
// Saved and loaded, the document gives the same model.
export function roundTrip(): boolean {
  const before = engine.getState();
  const after = done(engine.load(engine.save()));
  return ['upper', 'lower', 'motor'].every((body) => about(volume(after, body), volume(before, body), 1e-9)) && !('mount' in after.evaluation.bodies);
}
// What the description for the AI gets from the registry.
export const described = (): string[] => [COMBINE_INFO.summary, SPLIT_INFO.summary, `${COMBINE_INFO.fields[0].path} (${CLEARANCE.unit})`, SPLIT_ROLE.splitFace.title];

export const wrong = (): void => {
  // @ts-expect-error there is no default for the tools: kept or used up has to be said
  engine.execute(combine('x', { operation: 'difference', target: 'mount', tools: ['motor'] }));
  // @ts-expect-error a split has one side
  engine.execute(split('y', 'y', { body: 'upper', plane: { kind: 'base', plane: 'XY' }, side: 'both' }));
  // @ts-expect-error the plane is a reference, not an ID
  engine.execute(split('z', 'z', { body: 'upper', plane: 'mid', side: 'forward' }));
  // @ts-expect-error the cut face has no further field
  engine.execute({ type: 'setSketchPlane', sketch: 'cable', plane: onFace('lower', { feature: 'lower', role: 'splitFace', curve: 'c' }) });
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario13d(): boolean {
  const collided = mount() === 5;
  const state = pocket();
  const measured = clearanceMeasured();
  const pocketed = pocketIsExact(state) && toolsKept(state) && measured.collisions === 0 && measured.fits === 0 && measured.unchecked === 0 && about(measured.gap, 0.3, 0.01) && about(ceilingOverScrew(), 0.3, 1e-9);
  const field = looserFit() && withoutClearance() && backBySetField() && zeroIsNone() && onCeiling();
  const errors = holeTooNarrow().code === 'invalidClearance' && missed().status === 'warning' && refused().every((ok) => !ok);
  const disc = about(shared(), Math.PI * 14 * 14 * 10, 0.01 * Math.PI * 14 * 14 * 10);
  const joined = join();
  const union = joined.gone && joined.grown && joined.faces && joined.motorSits && afterItIsGone() === 'brokenReference' && nothingShared() === 'emptyResult';
  const two = shells();
  const [onLower, onUpper] = onTheCut();
  const cut = two.made.join() === 'lower' && two.volumes && two.cut && onLower?.[2] === 1 && onUpper?.[2] === -1;
  const after = takesAfter();
  const inherits = after.from === 'upper' && after.material === 'PETG' && after.sameDensity && after.unassigned;
  intoTheLink();
  throughBoth();
  const [beside, round, gone] = cannot();
  const split2 = otherSide() && beside === 'emptyResult' && round === 'nonPlanarFace' && gone === 'brokenReference' && alongAFace();
  return collided && pocketed && field && errors && disc && union && cut && inherits && split2 && noStep() && roundTrip();
}
