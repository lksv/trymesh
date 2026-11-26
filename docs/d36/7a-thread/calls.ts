// Validation scenario 18 (threads: a plate of tapped holes, a stud in a collar, a jar and its lid),
// written as calls against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract.
//
// Stage 1 (cosmetic threads) is sections a and b and the refusals of e; stage 2 (modelled threads)
// is c and d. No dimension of a thread is written here: every one comes from the catalog, and the
// printed thread of the jar from parameters of the document.

import type { Expr, Id, Input } from '../../../packages/engine/src/index';
import type { ArgsOf, CommandAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { DATA_CATALOGS } from '../00-prep/contract';
import { XY, done, engine, onFace, pointAt, rectangle, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import type { HardwareHoleArgsD75, HardwareHoleD75, ThreadFeature, ThreadResult } from './contract';
import { METRIC_THREAD_ROWS, THREAD_FACTS, THREAD_ROLES } from './contract';

const near = (value: number | undefined, expected: number, tolerance = 1e-6): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => ['ok', 'warning'].includes(state.evaluation.features[feature.id].status));
const threadsOf = (state: StateAfter, feature: Id): ThreadResult[] => state.evaluation.threads.filter((thread) => thread.feature === feature);
const codeOf = (command: CommandAfter, id: Id): string | undefined => done(engine.preview(command)).evaluation.features[id]?.error?.code;
const side = (feature: Id, curve: Id): FaceNameAfter => ({ feature, role: 'side', curve });
// A thread as a command, in the input form of the contract's type.
const thread = (id: Id, rest: Omit<Input<ThreadFeature>, 'id' | 'name' | 'suppressed' | 'type'>): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'thread', ...rest } });
// A circle with its own centre point at (x, y) of the sketch and a radius, all expressions.
const circleAt = (sketch: Id, id: Id, x: Expr, y: Expr, radius: Expr): CommandAfter[] => [
  ...pointAt(sketch, `${id}c`, x, y),
  { type: 'addCurve', sketch, id, curve: { type: 'circle', center: `${id}c` }, radius: 1 },
  { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];
const region = (...curves: Id[]) => ({ outerLoop: [...curves].sort() });

// ================================================================ a. the catalog

// Code reads the catalog with its row type; a column that does not exist does not compile.
export const tapDrillOf = (size: string): number => DATA_CATALOGS.metricThreads.rows[size].tapDrill;
// @ts-expect-error the catalog of threads has no head
export const noSuchColumn = (size: string): number => DATA_CATALOGS.metricThreads.rows[size].headDiameter;
// An AI reads a row through the query `catalog`, and where the numbers come from with it.
export const forAi = (): string => unwrap(engine.query('catalog', { name: 'metricThreads', key: 'M8x1' })).source;

// What holds of the rows without a source, and what the test of the catalog pins beside the rows
// themselves: the two diameters are the formulae of ISO 724 rounded to the third decimal place;
// a bore at the tap drill leaves a thread (wider than the minor diameter, and more than half of
// the depth is left); the key says what the row holds; a fine pitch is finer than the coarse one
// of its diameter; every diameter has exactly one coarse row.
export function catalogChecks(): boolean {
  const rows = Object.entries(METRIC_THREAD_ROWS);
  const rounded = (value: number): number => Math.round(value * 1000) / 1000;
  return rows.every(([key, row]) => {
    const depth = (5 * row.pitch) / (16 * Math.tan(Math.PI / 6));
    const coarse = rows.find(([, other]) => other.diameter === row.diameter && other.series === 'coarse');
    return (
      near(row.minorDiameter, rounded(row.diameter - 2 * depth), 1e-9) &&
      near(row.pitchDiameter, rounded(row.diameter - (3 * Math.sqrt(3) * row.pitch) / 8), 1e-9) &&
      row.tapDrill >= row.minorDiameter &&
      row.tapDrill <= row.diameter - depth &&
      key === (row.series === 'coarse' ? `M${row.diameter}` : `M${row.diameter}x${row.pitch}`) &&
      coarse !== undefined &&
      (row.series === 'coarse' ? rows.filter(([, other]) => other.diameter === row.diameter && other.series === 'coarse').length === 1 : row.pitch < coarse[1].pitch) &&
      (row.choice === 1 || row.choice === 2)
    );
  });
}

// ================================================================ b. a plate of tapped holes (stage 1)

// `hardwareHole` with the use `tapped`, as it answers after this package (the contract says why
// the registered description is not restated).
declare function tappedHole(args: ArgsOf<HardwareHoleArgsD75>): HardwareHoleD75;

const PLATE_TOP: FaceNameAfter = { feature: 'plate', role: 'endCap' };
const bore = (point: Id): FaceNameAfter => ({ feature: 'taps', role: 'holeBore', point });

// A plate 60 x 30 x 8 with two M6 holes and a row of three of each along X: one hole feature for
// two points, a linear pattern of it, and one thread feature that names the two bores and takes
// their copies.
export function tappedPlate(): StateAfter {
  const preset = tappedHole({ use: 'tapped', size: 'M6' });
  if (!preset.thread) throw new Error('the use `tapped` answers with the thread');
  return run(
    ...sketchOn('plateS', XY),
    ...rectangle('plateS', 'o', '60', '30'),
    { type: 'addFeature', feature: { id: 'plate', type: 'extrude', profile: { type: 'regions', sketch: 'plateS', regions: [region('oa', 'ob', 'oc', 'od')] }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' } },
    ...sketchOn('tapsS', onFace('plate', PLATE_TOP)),
    ...pointAt('tapsS', 'h1', '10', '10'),
    ...pointAt('tapsS', 'h2', '10', '20'),
    // the hole at the tap-drill diameter of the catalog, through the plate from its top
    { type: 'addFeature', feature: { id: 'taps', type: 'hole', sketch: 'tapsS', points: ['h1', 'h2'], shape: preset.shape, extent: { type: 'throughAll', side: 'backward' }, targets: ['plate'], label: preset.label } },
    { type: 'addFeature', feature: { id: 'row', type: 'pattern', source: { type: 'features', features: ['taps'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 15 } } } },
    // cosmetic, from the mouths (the sketch of the hole stands on the top, so its bores point out of the plate)
    thread('m6', { body: 'plate', faces: [bore('h1'), bore('h2')], copies: true, modelled: false, ...preset.thread, hand: 'right', direction: 'backward' }),
  );
}
export function tappedPlateChecks(before: StateAfter, state: StateAfter): boolean {
  const row = DATA_CATALOGS.metricThreads.rows['M6'];
  const threads = threadsOf(state, 'm6');
  // six threads: the two listed bores and their two copies each, in that order
  const six = threads.length === 6 && sameName(threads[0].face, bore('h1')) && sameName(threads[1].face, bore('h2')) && threads.slice(2).every((t) => t.face.role === 'holeBore' && t.face.copy?.[0].pattern === 'row');
  // each: internal, cosmetic, on the plate, the wall at the tap drill, the numbers of the catalog, the defaults filled in
  const each = threads.every(
    (t) => t.internal && !t.modelled && t.bodies.length === 1 && t.bodies[0] === 'plate' && near(2 * t.radius, row.tapDrill) && t.diameter === row.diameter && t.pitch === row.pitch && near(t.flankAngle, Math.PI / 3, 1e-12) && near(t.depth, (row.diameter - row.minorDiameter) / 2, 1e-3) && t.starts === 1 && t.clearance === 0 && t.hand === 'right' && t.label === 'M6',
  );
  // from the mouth down through the plate: the axis points into the plate, the thread is as long as the plate is thick
  const placed = threads.every((t) => near(t.axis[2], -1) && near(t.origin[2], 8, 1e-5) && t.from === 0 && near(t.to, 8, 1e-5) && near(Math.hypot(...t.zero), 1) && near(t.zero[2], 0));
  // the geometry is what it was: the same mesh, the same faces
  const unchanged = state.evaluation.bodies['plate'].solid === before.evaluation.bodies['plate'].solid;
  // get_body lists them; the facts say what was used
  const described = unwrap(engine.query('body', { body: 'plate' })).threads?.length === 6;
  const facts = state.evaluation.features['m6'].facts ?? {};
  const factsOk = facts.threads === 6 && near(facts.lead as number, row.pitch) && near(facts.crestFlat as number, row.pitch / 8, 1e-9) && near(facts.rootFlat as number, row.pitch / 4, 1e-9) && Object.keys(THREAD_FACTS).includes('minorDiameter');
  return six && each && placed && unchanged && described && factsOk && allOk(state);
}
// The count of the pattern changes and the thread feature is not touched: eight threads.
export const fourInARow = (): number => threadsOf(done(engine.preview({ type: 'updateFeature', id: 'row', patch: { transform: { count: 4 } } })), 'm6').length;

// A screw in a tapped hole: a plain rod of the nominal diameter through the bore at h1. The two
// overlap by design, and the check of collisions says so instead of calling it a collision.
export function boltInPlate(): StateAfter {
  const row = DATA_CATALOGS.metricThreads.rows['M6'];
  return run(
    { type: 'setParameter', name: 'boltD', expr: String(row.diameter) },
    ...sketchOn('boltS', XY),
    ...circleAt('boltS', 'shank', '10', '10', 'boltD / 2'),
    { type: 'addFeature', feature: { id: 'bolt', type: 'extrude', profile: { type: 'regions', sketch: 'boltS', regions: [region('shank')] }, extent: { type: 'distance', start: -2, distance: 14 }, operation: 'new' } },
  );
}
export function boltChecks(): boolean {
  const report = unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }));
  const entry = report.threaded?.[0];
  const excused = report.pairs.length === 0 && report.fits.length === 0 && report.threaded?.length === 1 && entry?.a === 'bolt' && entry.b === 'plate' && entry.thread.feature === 'm6' && entry.thread.body === 'plate' && sameName(entry.thread.face, bore('h1')) && entry.mismatch === undefined && entry.volume > 0;
  // a rod too thick for the thread reaches beyond its major diameter: a collision as before
  const tooThick = unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }, { state: done(engine.preview({ type: 'setParameter', name: 'boltD', expr: '8' })) }));
  // the bolt gets its own cosmetic thread: still excused; with another pitch (that of M5) the entry says so
  const boltThread = (pitch: number): CommandAfter => thread('boltThread', { body: 'bolt', faces: [side('bolt', 'shank')], modelled: false, diameter: 'boltD', pitch, hand: 'right', direction: 'forward' });
  const same = unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }, { state: done(engine.preview(boltThread(DATA_CATALOGS.metricThreads.rows['M6'].pitch))) }));
  const other = unwrap(engine.query('interference', { bodies: ['bolt', 'plate'] }, { state: done(engine.preview(boltThread(DATA_CATALOGS.metricThreads.rows['M5'].pitch))) }));
  return excused && tooThick.pairs.length === 1 && tooThick.threaded === undefined && same.threaded?.[0].mismatch === undefined && typeof other.threaded?.[0].mismatch === 'string';
}

// ================================================================ c. a stud in a collar (stage 2)

// An M10 stud 20 long standing at (100, 15), threaded 14 down from its top, in a collar 8 high
// around it from z = 8 to z = 16. Both threads are modelled; the collar's bore is the tap drill
// widened by the clearance, and its thread is cut with that clearance.
const STUD: FaceNameAfter = side('stud', 'rod');
const COLLAR: FaceNameAfter = side('collar', 'hole');
export function studAndCollar(): StateAfter {
  const row = DATA_CATALOGS.metricThreads.rows['M10'];
  return run(
    { type: 'setParameter', name: 'clr', expr: '0.2' },
    { type: 'setParameter', name: 'studD', expr: String(row.diameter) },
    { type: 'setParameter', name: 'studP', expr: String(row.pitch) },
    { type: 'setParameter', name: 'collarTop', expr: '16' },
    ...sketchOn('studS', XY),
    ...circleAt('studS', 'rod', '100', '15', 'studD / 2'),
    { type: 'addFeature', feature: { id: 'stud', type: 'extrude', profile: { type: 'regions', sketch: 'studS', regions: [region('rod')] }, extent: { type: 'distance', start: 0, distance: 20 }, operation: 'new' } },
    ...sketchOn('collarS', XY),
    ...circleAt('collarS', 'outer', '100', '15', '12'),
    ...circleAt('collarS', 'hole', '100', '15', `(${row.tapDrill} + 2 * clr) / 2`),
    { type: 'addFeature', feature: { id: 'collar', type: 'extrude', profile: { type: 'regions', sketch: 'collarS', regions: [region('outer')] }, extent: { type: 'distance', start: 'collarTop - 8', distance: 8 }, operation: 'new' } },
    // The stud: from its top (the high end of its face: `backward`) 14 down, no clearance.
    thread('studThread', { body: 'stud', faces: [STUD], modelled: true, diameter: 'studD', pitch: 'studP', hand: 'right', direction: 'backward', length: 14, label: 'M10' }),
    // The collar: from its top down through it, with the clearance. Its helix starts 4 below that
    // of the stud (20 against 16) along the same direction, so it is turned by the angle the
    // thread travels 4 in: `ThreadResult` gives the formula.
    thread('collarThread', { body: 'collar', faces: [COLLAR], modelled: true, diameter: 'studD', pitch: 'studP', clearance: 'clr', hand: 'right', direction: 'backward', phase: '2 * pi * (20 - collarTop) / studP', label: 'M10' }),
  );
}
export function studChecks(plain: StateAfter, state: StateAfter): boolean {
  const row = DATA_CATALOGS.metricThreads.rows['M10'];
  const names = (body: Id): FaceNameAfter[] => state.evaluation.bodies[body].faces.map((face) => state.evaluation.faceNames[face.id]);
  const has = (body: Id, name: FaceNameAfter): boolean => names(body).some((other) => sameName(other, name));
  const surface = (body: Id, name: FaceNameAfter) => state.evaluation.faceSurfaces[state.evaluation.bodies[body].faces.find((face) => sameName(state.evaluation.faceNames[face.id], name))?.id ?? -1];
  // the faces of the stud: both flanks, the root (the minor cylinder), a flat end where the thread
  // stops 14 down; none at the top, where it runs out. The wall is still there, the same cylinder.
  const root = surface('stud', { feature: 'studThread', role: 'threadRoot', face: 0 });
  const studFaces =
    has('stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'start' }) &&
    has('stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'end' }) &&
    root?.kind === 'cylinder' &&
    near(2 * root.radius, row.minorDiameter, 1e-3) &&
    surface('stud', { feature: 'studThread', role: 'threadFlank', face: 0, side: 'start' })?.kind === 'general' &&
    has('stud', { feature: 'studThread', role: 'threadEnd', face: 0, end: 'end' }) &&
    !has('stud', { feature: 'studThread', role: 'threadEnd', face: 0, end: 'start' }) &&
    surface('stud', STUD)?.kind === 'cylinder';
  // the collar: through, so no flat end; its root is the major cylinder grown by the clearance
  const collarRoot = surface('collar', { feature: 'collarThread', role: 'threadRoot', face: 0 });
  const collarFaces = collarRoot?.kind === 'cylinder' && near(2 * collarRoot.radius, row.diameter + 2 * 0.2, 1e-9) && !names('collar').some((name) => name.role === 'threadEnd') && has('collar', COLLAR);
  // every edge of a flank is a helix or an end of one: of the kind `other`
  const edges = state.evaluation.bodies['stud'].edges.filter((edge) => edge.name.a.role === 'threadFlank' || edge.name.b.role === 'threadFlank').every((edge) => edge.kind === 'other');
  // the records: how the ends end, and where the helices lie
  const [studThread] = threadsOf(state, 'studThread');
  const [collarThread] = threadsOf(state, 'collarThread');
  const ends = studThread.ends?.start === 'open' && studThread.ends.end === 'inside' && collarThread.ends?.start === 'open' && collarThread.ends.end === 'open' && !studThread.internal && collarThread.internal && studThread.modelled && collarThread.modelled;
  const placed = near(studThread.origin[2], 20, 1e-5) && near(collarThread.origin[2], 16, 1e-5) && near(studThread.axis[2], -1) && near(studThread.to, 14);
  // material was cut from both, and less than the whole band of the thread
  const cut = (body: Id): number => plain.evaluation.bodies[body].volume - state.evaluation.bodies[body].volume;
  const volumes = cut('stud') > 0 && cut('stud') < Math.PI * 14 * ((row.diameter / 2) ** 2 - (row.minorDiameter / 2) ** 2) && cut('collar') > 0;
  // the two are free of each other: nothing to report, and nothing excused either
  const report = unwrap(engine.query('interference', { bodies: ['stud', 'collar'] }));
  const free = report.pairs.length === 0 && report.fits.length === 0 && report.failed.length === 0 && report.threaded === undefined;
  return studFaces && collarFaces && edges && ends && placed && volumes && free && allOk(state) && Object.keys(THREAD_ROLES).length === 3;
}
// Two modelled threads are judged as the meshes are: the collar turned by half a pitch collides.
export function wrongPhase(): boolean {
  const turned = done(engine.preview({ type: 'updateFeature', id: 'collarThread', patch: { phase: '2 * pi * (20 - collarTop) / studP + pi' } }));
  const report = unwrap(engine.query('interference', { bodies: ['stud', 'collar'] }, { state: turned }));
  return report.pairs.length === 1 && report.threaded === undefined;
}
// The flag changes the mesh and nothing else: cosmetic again, both bodies are the plain ones, the
// threads are still recorded, and the pair is excused by the thread.
export function cosmeticAgain(plain: StateAfter): boolean {
  const state = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'studThread', patch: { modelled: false } }, { type: 'updateFeature', id: 'collarThread', patch: { modelled: false } }] }));
  const same = near(state.evaluation.bodies['stud'].volume, plain.evaluation.bodies['stud'].volume, 1e-9) && near(state.evaluation.bodies['collar'].volume, plain.evaluation.bodies['collar'].volume, 1e-9);
  const report = unwrap(engine.query('interference', { bodies: ['stud', 'collar'] }, { state }));
  return same && threadsOf(state, 'studThread').length === 1 && !threadsOf(state, 'collarThread')[0].modelled && report.pairs.length === 0 && report.threaded?.length === 1;
}

// ================================================================ d. a jar and its lid (stage 2)

// A printed thread: 40 across, pitch 4, two starts, flanks at 90° so that none overhangs by more
// than 45°, a clearance of 0.3 on the lid. The neck of the jar stands on its base (a shoulder) and
// ends free; the socket of the lid is open below and blind above.
const NECK: FaceNameAfter = side('neckUp', 'neck');
const SOCKET: FaceNameAfter = side('socketCut', 'socket');
export function jarAndLid(): StateAfter {
  // the depth of the profile at 90°: 5 P / 16 (the default of the feature); the socket is the minor diameter and the clearance
  const socket: Expr = '(neck - 2 * 5 * lidP / 16) / 2 + lidClr';
  const common = { diameter: 'neck', pitch: 'lidP', flankAngle: 'deg(90)', starts: 2, hand: 'right', modelled: true, label: 'lid 40 x 4' } as const;
  return run(
    { type: 'setParameter', name: 'neck', expr: '40' },
    { type: 'setParameter', name: 'lidP', expr: '4' },
    { type: 'setParameter', name: 'lidClr', expr: '0.3' },
    ...sketchOn('jarS', XY),
    ...circleAt('jarS', 'foot', '200', '30', '25'),
    ...circleAt('jarS', 'neck', '200', '30', 'neck / 2'),
    { type: 'addFeature', feature: { id: 'jar', type: 'extrude', profile: { type: 'regions', sketch: 'jarS', regions: [region('foot'), region('neck')] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
    { type: 'addFeature', feature: { id: 'neckUp', type: 'extrude', profile: { type: 'regions', sketch: 'jarS', regions: [region('neck')] }, extent: { type: 'distance', start: 5, distance: 15 }, operation: 'add', targets: ['jar'] } },
    ...sketchOn('lidS', XY),
    ...circleAt('lidS', 'rim', '200', '30', '24'),
    ...circleAt('lidS', 'socket', '200', '30', socket),
    { type: 'addFeature', feature: { id: 'lid', type: 'extrude', profile: { type: 'regions', sketch: 'lidS', regions: [region('rim'), region('socket')] }, extent: { type: 'distance', start: 12, distance: 10 }, operation: 'new' } },
    { type: 'addFeature', feature: { id: 'socketCut', type: 'extrude', profile: { type: 'regions', sketch: 'lidS', regions: [region('socket')] }, extent: { type: 'distance', start: 12, distance: 8.5 }, operation: 'cut', targets: ['lid'] } },
    // the neck: from its free end (z = 20) 10 down
    thread('jarThread', { body: 'jar', faces: [NECK], ...common, direction: 'backward', length: 10 }),
    // the socket: from its bottom (z = 20.5, a shoulder) down to its mouth, with the clearance; its
    // helix starts 0.5 above that of the neck, so it is turned back by what the thread travels in 0.5
    thread('lidThread', { body: 'lid', faces: [SOCKET], ...common, clearance: 'lidClr', direction: 'backward', phase: '-2 * pi * 0.5 / (lidP * 2)' }),
  );
}
export function jarChecks(state: StateAfter): boolean {
  const [jar] = threadsOf(state, 'jarThread');
  const [lid] = threadsOf(state, 'lidThread');
  // the profile: the depth of the ISO proportion at 90°, a lead of two pitches
  const facts = state.evaluation.features['jarThread'].facts ?? {};
  const profile = near(facts.depth as number, (5 * 4) / 16) && near(facts.lead as number, 8) && near(jar.depth, 1.25) && jar.starts === 2 && near(jar.flankAngle, Math.PI / 2, 1e-12);
  // the ends: the neck runs out at its free end and ends inside; the socket ends flat just short
  // of its bottom and runs out at its mouth
  const ends = jar.ends?.start === 'open' && jar.ends.end === 'inside' && lid.ends?.start === 'shoulder' && lid.ends.end === 'open' && lid.internal && !jar.internal;
  const lidEnd = state.evaluation.bodies['lid'].faces.some((face) => sameName(state.evaluation.faceNames[face.id], { feature: 'lidThread', role: 'threadEnd', face: 0, end: 'start' }));
  // the lid screwed on: free of the jar
  const report = unwrap(engine.query('interference', { bodies: ['jar', 'lid'] }));
  const free = report.pairs.length === 0 && report.failed.length === 0 && report.threaded === undefined;
  return profile && ends && lidEnd && free && allOk(state);
}
// A mirrored copy of the lid is the mirror image: its thread is left-handed, and says so.
export function mirroredLid(): boolean {
  const state = done(engine.preview({ type: 'addFeature', feature: { id: 'twin', type: 'pattern', source: { type: 'body', body: 'lid' }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } }));
  const copy = state.evaluation.threads.find((t) => t.feature === 'lidThread' && t.bodies.includes('twin/1'));
  const original = state.evaluation.threads.find((t) => t.feature === 'lidThread' && t.bodies.includes('lid'));
  return copy?.hand === 'left' && original?.hand === 'right' && copy.modelled && near(copy.origin[0], -(original?.origin[0] ?? NaN), 1e-5) && copy.face.copy?.[0].pattern === 'twin';
}

// ================================================================ e. refusals

export function refusals(): (string | undefined | boolean)[] {
  const m6 = { modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'backward' } as const;
  return [
    // a face that is not a cylinder
    codeOf(thread('onTop', { body: 'plate', faces: [PLATE_TOP], ...m6 }), 'onTop'), // invalidThread
    // a face the body does not have
    codeOf(thread('nowhere', { body: 'plate', faces: [bore('h9')], ...m6 }), 'nowhere'), // brokenReference
    // the bores drilled too narrow for the thread: the thread, not the hole, is in error
    done(engine.preview({ type: 'updateFeature', id: 'taps', patch: { shape: { diameter: 4 } } })).evaluation.features['m6'].error?.code, // invalidThread
    // longer than the plate is thick
    done(engine.preview({ type: 'updateFeature', id: 'm6', patch: { length: 20 } })).evaluation.features['m6'].error?.code, // invalidThread
    // a second thread on a bore that has one
    codeOf(thread('again', { body: 'plate', faces: [bore('h1')], ...m6 }), 'again'), // invalidThread
    // a profile that does not fit into its pitch: flanks at 150° with the depth of a 60° thread
    done(engine.preview({ type: 'updateFeature', id: 'm6', patch: { flankAngle: 'deg(150)', depth: 0.54 } })).evaluation.features['m6'].error?.code, // invalidThread
    // a thread is no source of a pattern: the command is refused
    engine.execute({ type: 'addFeature', feature: { id: 'more', type: 'pattern', source: { type: 'features', features: ['m6'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing: 5 } } } }).ok === false,
  ];
}

// What must not compile.
export const wrong = (): void => {
  // @ts-expect-error a thread has no kind: whether it is internal is read from the body
  thread('w1', { body: 'plate', faces: [bore('h1')], modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'backward', internal: true });
  // @ts-expect-error the hand is right or left
  thread('w2', { body: 'plate', faces: [bore('h1')], modelled: false, diameter: 6, pitch: 1, hand: 'both', direction: 'backward' });
  // @ts-expect-error a flank is named by its face and its side
  const flank: FaceNameAfter = { feature: 'studThread', role: 'threadFlank', face: 0 };
  void flank;
};

// ================================================================ the scenario in its order

export function scenario18(): boolean {
  const catalog = catalogChecks() && tapDrillOf('M6') > 0 && forAi().length > 0;
  // stage 1
  // (`getState(at)`: the model as it is after that feature, here before the thread)
  const plate = tappedPlate();
  const stage1 = tappedPlateChecks(engine.getState('row'), plate) && fourInARow() === 8 && (boltInPlate(), boltChecks());
  const refused = refusals();
  const refusedOk = refused[0] === 'invalidThread' && refused[1] === 'brokenReference' && refused.slice(2, 6).every((code) => code === 'invalidThread') && refused[6] === true;
  // stage 2
  const built = studAndCollar();
  const stage2a = studChecks(engine.getState('collar'), built) && wrongPhase() && cosmeticAgain(engine.getState('collar'));
  const stage2b = jarChecks(jarAndLid()) && mirroredLid();
  return catalog && stage1 && refusedOk && stage2a && stage2b;
}
