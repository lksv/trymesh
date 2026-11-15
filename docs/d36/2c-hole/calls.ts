// Validation scenario 12 (a box with a lid and screw posts), the part of package 2c and the
// whole scenario in its order, written as calls against the contract. Only type-checked. It
// continues the model of 2a (the box, the lid, the rib), 2f (the posts) and 2b (the taper): the
// lid is screwed to the posts with countersunk screws, and the posts take heat-set inserts.
// No dimension of a screw is written here: every one comes from the catalogs.

import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, FeatureAfter, QueryToolInput, StateAfter } from '../00-prep/contract';
import { DATA_CATALOGS, QUERIES, QueryFailure } from '../00-prep/contract';
import { done, engine, onFace, pointAt, run, scenario12a, sketchOn, unwrap } from '../2a-offset/calls';
import { LID_TOP, scenario12b } from '../2b-taper/calls';
import { INSET, braceLengths, scenario12f } from '../2f-upto/calls';
import type { HardwareHole, HoleFeature, HoleShape } from './contract';
import { HARDWARE_HOLE_ARGS, HOLE_FACTS, HOLE_ROLES } from './contract';

// ---------------------------------------------------------------- the catalogs and the query

// Code reads a catalog with its row type; a column that does not exist does not compile.
export const clearanceOf = (size: string): number => DATA_CATALOGS.clearanceHoles.rows[size].medium;
// @ts-expect-error the catalog of clearance holes has no head
export const noSuchColumn = (size: string): number => DATA_CATALOGS.clearanceHoles.rows[size].headDiameter;
// An AI reads a row through the query `catalog` of the preparatory step, and where the numbers
// come from with it.
export const forAi = (): string => unwrap(engine.query('catalog', { name: 'countersunkScrews', key: 'M3' })).source;

// The query that composes a hole, as an entry of the registry (shortened to two uses). It reads
// the catalogs with their types and no state.
const plus = (value: number, allowance: string | undefined): number | string => (allowance === undefined ? value : `${value} + ${allowance}`);
export const hardwareHole: (typeof QUERIES)['hardwareHole'] = {
  title: 'Hole for a piece of hardware',
  summary: 'The shape of a hole for a screw, a nut or a heat-set insert of a size, from the hardware catalogs: put `shape` and `label` of the answer into a feature of the type hole. The catalogs are clearanceHoles, socketHeadScrews, countersunkScrews, hexNuts and heatSetInserts; the query `catalog` shows their rows and sources.',
  returns: 'shape (a hole shape with its numeric fields in mm and rad, expressions when an allowance was given), label, depth in mm for an insert, and from (the names of the catalogs used).',
  args: HARDWARE_HOLE_ARGS,
  run(_context, args) {
    const hole = DATA_CATALOGS.clearanceHoles.rows[args.size];
    if (!hole) throw new QueryFailure('notAvailable', `the catalog clearanceHoles has no size "${args.size}"`, ['size']);
    const diameter = plus(hole[args.fit ?? 'medium'], args.allowance);
    if (args.use === 'countersunk') {
      const screw = DATA_CATALOGS.countersunkScrews.rows[args.size];
      if (!screw) throw new QueryFailure('notAvailable', `the catalog countersunkScrews has no size "${args.size}"`, ['size']);
      return { shape: { type: 'countersink', diameter, headDiameter: plus(screw.headDiameter, args.allowance), angle: screw.headAngle }, label: `${args.size} countersunk screw`, from: ['clearanceHoles', 'countersunkScrews'] };
    }
    if (args.use === 'heatSetInsert') {
      const insert = DATA_CATALOGS.heatSetInserts.rows[args.size];
      if (!insert) throw new QueryFailure('notAvailable', `the catalog heatSetInserts has no size "${args.size}"`, ['size']);
      return { shape: { type: 'plain', diameter: plus(insert.holeDiameter, args.allowance) }, label: `${args.size} heat-set insert`, depth: insert.holeDepth, from: ['heatSetInserts'] };
    }
    return { shape: { type: 'plain', diameter }, label: `${args.size} clearance hole`, from: ['clearanceHoles'] };
  },
};

// A size the catalogs do not have names the argument.
export function unknownSize(): string {
  const outcome = engine.query('hardwareHole', { use: 'socketHead', size: 'M7' });
  return outcome.ok ? 'ok' : `${outcome.error.code} in ${outcome.error.arg?.join('/')}`; // notAvailable in size
}
// Over MCP it is the general tool `query`, like every query.
export const overMcp: QueryToolInput = { query: 'hardwareHole', args: { use: 'countersunk', size: 'M3', allowance: 'holeComp' } };

// ---------------------------------------------------------------- the screws through the lid

const hole = (id: Id, rest: Pick<HoleFeature, 'sketch' | 'points' | 'targets'> & { shape: HardwareHole['shape']; extent: CommandExtent; label?: string }): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', ...rest } });
type CommandExtent = { type: 'distance'; start: number | string; distance: number | string } | { type: 'throughAll'; side: 'forward' | 'backward' };
const POINTS = ['s1', 's2', 's3', 's4'];

// Four points on the top of the lid over the posts, and one hole feature for all four: countersunk
// for M3 from the catalog, with the print compensation as a parameter, through the lid.
export function screwHoles(): StateAfter {
  const preset = unwrap(engine.query('hardwareHole', { use: 'countersunk', size: 'M3', allowance: 'holeComp' }));
  const far = (axis: 'L' | 'W'): string => `${axis} - (${INSET})`;
  return run(
    { type: 'setParameter', name: 'holeComp', expr: '0.2' },
    ...sketchOn('screws', onFace('lid', LID_TOP)),
    ...pointAt('screws', 's1', INSET, INSET),
    ...pointAt('screws', 's2', far('L'), INSET),
    ...pointAt('screws', 's3', far('L'), far('W')),
    ...pointAt('screws', 's4', INSET, far('W')),
    hole('screwHoles', { sketch: 'screws', points: POINTS, shape: preset.shape, extent: { type: 'throughAll', side: 'backward' }, targets: ['lid'], label: preset.label }),
  );
}

const named = (state: StateAfter, feature: Id, role: FaceNameAfter['role']): FaceNameAfter[] => state.evaluation.faceNames.filter((name) => name.feature === feature && name.role === role);

// What the scenario asserts about them.
export function screwChecks(state: StateAfter): boolean {
  // the document holds expressions and numbers and a label, not a size
  const feature = state.document.features.find((f) => f.id === 'screwHoles');
  if (feature?.type !== 'hole' || feature.shape.type !== 'countersink') return false;
  const fromCatalog = feature.label === 'M3 countersunk screw' && feature.expressions?.['shape/headDiameter']?.endsWith('+ holeComp') === true && feature.shape.angle === DATA_CATALOGS.countersunkScrews.rows['M3'].headAngle;
  // one cone and one bore per point, named by the point
  const heads = named(state, 'screwHoles', 'holeHead').map((name) => (name.role === 'holeHead' ? name.point : '')).sort();
  const walls = named(state, 'screwHoles', 'holeWall').length;
  // the cones are cones, holes and not pins, and every edge of a cone is a circle: its mouth with
  // the top of the lid and its lower rim with the bore of the same tool
  const body = unwrap(engine.query('body', { body: 'lid' }));
  const cones = body.faces.filter((face) => face.name.feature === 'screwHoles' && face.name.role === 'holeHead');
  const conical = cones.length === 4 && cones.every((face) => face.surface.kind === 'cone' && face.convex === false);
  const rims = body.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'screwHoles' && name.role === 'holeHead'));
  const circles = rims.length === 8 && rims.every((edge) => edge.kind === 'circle');
  // the depth of the cone is published, so a caller can see that the head sinks in
  const facts = state.evaluation.features['screwHoles'].facts;
  const sunk = facts !== undefined && Object.keys(HOLE_FACTS).every((name) => typeof facts[name] === 'number');
  return fromCatalog && heads.join() === POINTS.join() && walls === 4 && conical && circles && sunk;
}

// Another screw is another answer of the query: socket head screws instead. The bores keep their
// names (they are named by what they are), the heads become cylinders and a seat appears, on
// which a sketch can stand.
export function socketHeadsInstead(): boolean {
  const before = named(engine.getState(), 'screwHoles', 'holeWall');
  const preset = unwrap(engine.query('hardwareHole', { use: 'socketHead', size: 'M3' }));
  const preview = done(engine.preview({ type: 'batch', commands: [{ type: 'updateFeature', id: 'screwHoles', patch: { shape: preset.shape, label: preset.label } }, ...sketchOn('onSeat', onFace('lid', { feature: 'screwHoles', role: 'holeSeat' }))] }));
  const sameWalls = JSON.stringify(named(preview, 'screwHoles', 'holeWall')) === JSON.stringify(before);
  return sameWalls && named(preview, 'screwHoles', 'holeSeat').length === 1 && preview.evaluation.features['onSeat'].status === 'ok';
}
// A nut pocket has six flats per point, numbered from the corner the rotation points to.
export function nutPockets(shape: Extract<HoleShape, { type: 'nutPocket' }>): number[] {
  const preview = done(engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { shape } }));
  return named(preview, 'screwHoles', 'holeFlat').flatMap((name) => (name.role === 'holeFlat' && name.point === 's1' ? [name.flat] : [])); // 1..6
}

// ---------------------------------------------------------------- the inserts in the posts

// Two points on the tops of the two posts of 2f and a hole for a heat-set insert at each, as
// deep as the catalog says; the holes in the two copied posts are a pattern of the hole feature.
export function insertHoles(): StateAfter {
  const preset = unwrap(engine.query('hardwareHole', { use: 'heatSetInsert', size: 'M3', allowance: 'holeComp' }));
  if (preset.depth === undefined) return done({ ok: false, error: { code: 'invalidCommand', message: 'an insert has a depth' } });
  return run(
    ...pointAt('tops', 'i1', INSET, INSET),
    ...pointAt('tops', 'i2', `L - (${INSET})`, INSET),
    ...pointAt('tops', 'center', 'L / 2', 'W / 2'),
    hole('inserts', { sketch: 'tops', points: ['i1', 'i2'], shape: preset.shape, extent: { type: 'distance', start: 0, distance: -preset.depth }, targets: ['box'], label: preset.label }),
    { type: 'addFeature', feature: { id: 'insertPattern', name: 'insertPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['inserts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'tops', point: 'center' }, count: 2, span: { type: 'full' } } } },
  );
}
// A hole is a source of a pattern by its entry of the registry. `producesTool` is one of the two
// functions part 2 of the preparatory step adds to the index of the engine; it has no declaration
// in the contract, so this is a stand-in (design.md, "Needs from the preparatory step").
declare function producesTool(feature: FeatureAfter): boolean;
export function insertChecks(state: StateAfter): boolean {
  const feature = state.document.features.find((f) => f.id === 'inserts');
  const copies = state.evaluation.faceNames.filter((name) => name.feature === 'inserts' && name.role === 'holeWall' && name.copy?.[0]?.pattern === 'insertPattern').length;
  return feature !== undefined && producesTool(feature) && state.evaluation.features['insertPattern'].status === 'ok' && named(state, 'inserts', 'holeWall').length === 4 && copies === 2;
}

// ---------------------------------------------------------------- refusals

export function refusals(): (string | undefined | boolean)[] {
  const errorOf = (command: CommandAfter): string | undefined => done(engine.preview(command)).evaluation.features['screwHoles'].error?.code;
  return [
    // a head narrower than the bore
    errorOf({ type: 'setField', feature: 'screwHoles', path: 'shape/headDiameter', value: 2 }), // invalidHole
    // a point that is not in the sketch is an invalid command
    engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { points: ['s1', 'nope'] } }).ok, // false
    // a hole that misses its target is the warning of a cut that does
    done(engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { targets: ['box'], extent: { type: 'distance', start: 5, distance: 10 } } })).evaluation.features['screwHoles'].warnings[0]?.code, // noEffect
  ];
}
export const wrong = (): void => {
  // @ts-expect-error a hole has no taper
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'plain', diameter: 3 }, extent: { type: 'distance', start: 0, distance: -5, taper: 0.1 }, targets: ['lid'] }));
  // @ts-expect-error a hole has a mouth: not through all to both sides
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'plain', diameter: 3 }, extent: { type: 'throughAll', side: 'both' }, targets: ['lid'] }));
  // @ts-expect-error a counterbore needs the depth of its head
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'counterbore', diameter: 3, headDiameter: 6 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['lid'] }));
  // @ts-expect-error the seat of a hole has no point
  onFace('lid', { feature: 'screwHoles', role: 'holeSeat', point: 's1' });
};
// The catalog of roles has the four; the flat of a nut pocket is told apart by two fields.
export const flatParts: { readonly point: { kind: 'text' }; readonly flat: { kind: 'integer' } } = HOLE_ROLES.holeFlat.parts;

// ---------------------------------------------------------------- the whole scenario

// The order of the model: 2a (the box, its cavity, the lid and its lip, a rib and a bracket), 2f
// (the posts up to the lid, a brace up to the rib), 2b (a draft on the rib, a lead-in on the lip,
// a countersink by hand), 2c (the screws and the inserts).
export function scenario12(): boolean {
  const offsetAndWall = scenario12a();
  const upTo = scenario12f();
  const taper = scenario12b();
  // the brace of 2f ends on the side of the rib, which the draft of 2b tilted: its length now
  // differs across its profile, with nothing about the brace changed
  const lengths = braceLengths(engine.getState());
  const followsTheDraft = lengths !== undefined && lengths[0] < lengths[1];
  const screws = screwChecks(screwHoles()) && socketHeadsInstead();
  const inserts = insertChecks(insertHoles());
  const [narrowHead, unknownPoint, missed] = refusals();
  // the finished parts: the lid does not collide with the box, with the posts under it
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  const apart = report.pairs.length === 0 && report.failed.length === 0;
  return offsetAndWall && upTo && taper && followsTheDraft && screws && inserts && narrowHead === 'invalidHole' && unknownPoint === false && missed === 'noEffect' && unknownSize() === 'notAvailable in size' && apart;
}
