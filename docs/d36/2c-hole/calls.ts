// Validation scenario 12 (a box with a lid and screw posts), the part of package 2c and the
// whole scenario in its order, written as calls against the contract. Only type-checked. It
// continues the model of 2a (the box, the lid, the rib), 2f (the posts) and 2b (the taper): the
// lid is screwed to the posts with countersunk screws, and the posts take heat-set inserts.
// No dimension of a screw is written here: every one comes from the catalogs. The few bare
// diameters below are in calls that only have to fail to compile; they are made up and are no
// size of any part.

import type { Id, Input } from '../../../packages/engine/src/index';
import type { Catalogs, CommandAfter, FaceNameAfter, FeatureAfter, QueryToolInput, StateAfter } from '../00-prep/contract';
import { DATA_CATALOGS, QUERIES, QueryFailure } from '../00-prep/contract';
import { done, engine, onFace, pointAt, run, sameName, scenario12a, sketchOn, unwrap } from '../2a-offset/calls';
import { LID_TOP, scenario12b } from '../2b-taper/calls';
import { INSET, braceLengths, scenario12f } from '../2f-upto/calls';
import type { HoleExtent, HoleFeature, HoleShape } from './contract';
import { HARDWARE_HOLE_ARGS, HOLE_FACTS, HOLE_ROLES } from './contract';

// ---------------------------------------------------------------- the catalogs and the query

// Code reads a catalog with its row type; a column that does not exist does not compile.
export const clearanceOf = (size: string): number => DATA_CATALOGS.clearanceHoles.rows[size].medium;
// @ts-expect-error the catalog of clearance holes has no head
export const noSuchColumn = (size: string): number => DATA_CATALOGS.clearanceHoles.rows[size].headDiameter;
// An AI reads a row through the query `catalog` of the preparatory step, and where the numbers
// come from with it.
export const forAi = (): string => unwrap(engine.query('catalog', { name: 'countersunkScrews', key: 'M3' })).source;

// The query that composes a hole, as an entry of the registry. It reads the catalogs with their
// types and no state. It looks at `use` first and asks only the catalogs that use needs, so
// a size one catalog lacks is missing for the uses of that catalog only.
const rowOf = <Row>(catalog: keyof Catalogs, rows: Record<string, Row>, size: string): Row => {
  const row: Row | undefined = rows[size];
  if (row === undefined) throw new QueryFailure('notAvailable', `the catalog ${catalog} has no size "${size}"`, ['size']);
  return row;
};
const plus = (value: number, allowance: string | undefined): number | string => (allowance === undefined ? value : `${value} + ${allowance}`);
// An angle goes out as an expression in degrees: a tool rounds numbers to six decimal places,
// which an angle in radians rarely survives, and a person reads degrees ("deg(…)").
const degrees = (radians: number): string => `deg(${Number(((radians * 180) / Math.PI).toFixed(9))})`;
export const hardwareHole: (typeof QUERIES)['hardwareHole'] = {
  title: 'Hole for a piece of hardware',
  summary: 'The shape of a hole for a screw, a nut or a heat-set insert of a size, from the hardware catalogs: put `shape` and `label` of the answer into a feature of the type hole. The catalogs are clearanceHoles, socketHeadScrews, countersunkScrews, hexNuts and heatSetInserts; the query `catalog` shows their rows and sources.',
  returns: 'shape (a hole shape with its numeric fields in mm, expressions when an allowance was given; the angle of a countersink is always an expression in degrees), label, depth in mm for an insert, and from (the names of the catalogs used).',
  args: HARDWARE_HOLE_ARGS,
  run(_context, { use, size, fit, allowance }) {
    if (use === 'heatSetInsert') {
      const insert = rowOf('heatSetInserts', DATA_CATALOGS.heatSetInserts.rows, size);
      return { shape: { type: 'plain', diameter: plus(insert.holeDiameter, allowance) }, label: `${size} heat-set insert`, depth: insert.holeDepth, from: ['heatSetInserts'] };
    }
    const diameter = plus(rowOf('clearanceHoles', DATA_CATALOGS.clearanceHoles.rows, size)[fit ?? 'medium'], allowance);
    if (use === 'socketHead') {
      const screw = rowOf('socketHeadScrews', DATA_CATALOGS.socketHeadScrews.rows, size);
      return { shape: { type: 'counterbore', diameter, headDiameter: plus(screw.headDiameter, allowance), headDepth: screw.headHeight }, label: `${size} socket head cap screw`, from: ['clearanceHoles', 'socketHeadScrews'] };
    }
    if (use === 'countersunk') {
      const screw = rowOf('countersunkScrews', DATA_CATALOGS.countersunkScrews.rows, size);
      return { shape: { type: 'countersink', diameter, headDiameter: plus(screw.headDiameter, allowance), angle: degrees(screw.headAngle) }, label: `${size} countersunk screw`, from: ['clearanceHoles', 'countersunkScrews'] };
    }
    if (use === 'nutPocket') {
      const nut = rowOf('hexNuts', DATA_CATALOGS.hexNuts.rows, size);
      return { shape: { type: 'nutPocket', diameter, acrossFlats: plus(nut.acrossFlats, allowance), headDepth: nut.thickness, rotation: 0 }, label: `${size} hex nut`, from: ['clearanceHoles', 'hexNuts'] };
    }
    return { shape: { type: 'plain', diameter }, label: `${size} clearance hole`, from: ['clearanceHoles'] };
  },
};

// A size the catalogs do not have names the argument. The key is one no catalog can have: which
// sizes the catalogs cover is not known before the standards are read.
export function unknownSize(): string {
  const outcome = engine.query('hardwareHole', { use: 'socketHead', size: 'nope' });
  return outcome.ok ? 'ok' : `${outcome.error.code} in ${outcome.error.arg?.join('/')}`; // notAvailable in size
}
// Over MCP it is the general tool `query`, like every query.
export const overMcp: QueryToolInput = { query: 'hardwareHole', args: { use: 'countersunk', size: 'M3', allowance: 'holeComp' } };

// ---------------------------------------------------------------- the screws through the lid

// A hole as a command: the shape and the extent in the input form of the contract's own types.
const hole = (id: Id, rest: Pick<HoleFeature, 'sketch' | 'points' | 'targets'> & { shape: Input<HoleShape>; extent: Input<HoleExtent>; label?: string }): CommandAfter => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', ...rest } });
const POINTS = ['s1', 's2', 's3', 's4'];

// Four points on the top of the lid over the posts, and one hole feature for all four: countersunk
// for M3 from the catalog, with the print compensation as a parameter, through the lid.
export function screwHoles(): StateAfter {
  const preset = unwrap(engine.query('hardwareHole', { use: 'countersunk', size: 'M3', allowance: 'holeComp' }));
  const far = (axis: 'L' | 'W'): string => `${axis} - (${INSET})`;
  // The bores have to be in the lid, so its plate has to be thicker than the cone is deep. How
  // deep that is follows from numbers of a standard, and none is written here: the plate is set
  // from the row of the catalog. The cone of the head down to its point is deeper than any
  // countersink for it, whatever the bore and the allowance; the plate gets that and
  // a millimetre, and never less than the 3 mm the parts before were built with.
  const screw = DATA_CATALOGS.countersunkScrews.rows['M3'];
  const plate = Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1);
  return run(
    { type: 'setParameter', name: 'lidT', expr: String(plate) },
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
const sameNames = (a: FaceNameAfter[], b: FaceNameAfter[]): boolean => a.length === b.length && a.every((name) => b.some((other) => sameName(name, other)));
const about = (value: number, expected: number): boolean => Math.abs(value - expected) < 1e-9;

// What the scenario asserts about them. One assumption about the widths of the parts stays, to
// be checked against the rows when the catalogs are typed in: the heads, with the allowance, fit
// into the top of the lid around their points, which are INSET from its edges (design.md,
// "Tests the implementation owes"). If it fails, a parameter of the box changes.
export function screwChecks(state: StateAfter): boolean {
  // the document holds expressions and numbers and a label, not a size
  const feature = state.document.features.find((f) => f.id === 'screwHoles');
  if (feature?.type !== 'hole' || feature.shape.type !== 'countersink') return false;
  const expressions = feature.expressions ?? {};
  const fromCatalog =
    feature.label === 'M3 countersunk screw' &&
    expressions['shape/headDiameter']?.endsWith('+ holeComp') === true &&
    expressions['shape/angle']?.startsWith('deg(') === true &&
    about(feature.shape.angle, DATA_CATALOGS.countersunkScrews.rows['M3'].headAngle);
  // one cone and one bore per point, named by the point
  const heads = named(state, 'screwHoles', 'holeHead').map((name) => (name.role === 'holeHead' ? name.point : '')).sort();
  // the cones are cones, holes and not pins, and every edge of a cone is a circle: its mouth with
  // the top of the lid and its lower rim with the bore of the same tool
  const body = unwrap(engine.query('body', { body: 'lid' }));
  const ofRole = (role: FaceNameAfter['role']) => body.faces.filter((face) => face.name.feature === 'screwHoles' && face.name.role === role);
  const cones = ofRole('holeHead');
  const conical = cones.length === 4 && cones.every((face) => face.surface.kind === 'cone' && face.convex === false);
  const bores = ofRole('holeBore').length;
  const rims = body.edges.filter((edge) => [edge.name.a, edge.name.b].some((name) => name.feature === 'screwHoles' && name.role === 'holeHead'));
  const circles = rims.length === 8 && rims.every((edge) => edge.kind === 'circle');
  // The depth of the cone is published, and so is the depth of the hole: "through all" of the
  // lid reaches to the lower edge of its lip, so the depth is the plate and the lip, without the
  // overshoot of the tool. That depth is measured on the mesh (float32), so it is compared at
  // the resolution of the mesh and not of a double.
  const facts = state.evaluation.features['screwHoles'].facts;
  const [headDepth, depth] = Object.keys(HOLE_FACTS).map((name) => facts?.[name]); // headDepth, depth
  const [plate, lip] = ['lidT', 'lipH'].map((name) => state.evaluation.parameters[name]);
  if (typeof headDepth !== 'number' || typeof depth !== 'number' || !plate?.ok || !lip?.ok) return false;
  // the cone is shallower than the plate: `screwHoles` made the plate thick enough for it
  const sunk = headDepth < plate.value && Math.abs(depth - (plate.value + lip.value)) < 1e-4;
  return fromCatalog && heads.join() === POINTS.join() && bores === 4 && conical && circles && sunk;
}

// Another screw is another answer of the query: socket head screws instead. The bores keep their
// names (they are named by what they are), the heads become cylinders and a seat appears, on
// which a sketch can stand.
export function socketHeadsInstead(): boolean {
  const before = named(engine.getState(), 'screwHoles', 'holeBore');
  const preset = unwrap(engine.query('hardwareHole', { use: 'socketHead', size: 'M3' }));
  // without an allowance the depth of the head is a number
  if (preset.shape.type !== 'counterbore' || typeof preset.shape.headDepth !== 'number') return false;
  const preview = done(
    engine.preview({
      type: 'batch',
      commands: [
        // The seat is in the lid only if its plate is thicker than the head is deep; the depth
        // is the catalog's, so the plate is set from it. ("Through all" would not refuse
        // a thinner plate: the lid reaches deeper at its lip. design.md, "Recompute".)
        { type: 'setParameter', name: 'lidT', expr: `${preset.shape.headDepth} + 2` },
        { type: 'updateFeature', id: 'screwHoles', patch: { shape: preset.shape, label: preset.label } },
        ...sketchOn('onSeat', onFace('lid', { feature: 'screwHoles', role: 'holeSeat' })),
      ],
    }),
  );
  return sameNames(named(preview, 'screwHoles', 'holeBore'), before) && named(preview, 'screwHoles', 'holeSeat').length === 1 && preview.evaluation.features['onSeat'].status === 'ok';
}
// A nut pocket has six flats per point, numbered from the corner the rotation points to.
export function nutPockets(): number[] {
  const preset = unwrap(engine.query('hardwareHole', { use: 'nutPocket', size: 'M3' }));
  if (preset.shape.type !== 'nutPocket' || typeof preset.shape.headDepth !== 'number') return [];
  // the plate from the thickness of the nut, as for the socket heads
  const preview = done(engine.preview({ type: 'batch', commands: [{ type: 'setParameter', name: 'lidT', expr: `${preset.shape.headDepth} + 2` }, { type: 'updateFeature', id: 'screwHoles', patch: { shape: preset.shape } }] }));
  return named(preview, 'screwHoles', 'holeFlat')
    .flatMap((name) => (name.role === 'holeFlat' && name.point === 's1' ? [name.flat] : []))
    .sort((a, b) => a - b); // 1..6
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
// The other assumption about widths: the hole of the insert, with the allowance, is narrower
// than a post (`postR`), so that its bore is in the post.
export function insertChecks(state: StateAfter): boolean {
  const feature = state.document.features.find((f) => f.id === 'inserts');
  const copies = state.evaluation.faceNames.filter((name) => name.feature === 'inserts' && name.role === 'holeBore' && name.copy?.[0]?.pattern === 'insertPattern').length;
  return feature !== undefined && producesTool(feature) && state.evaluation.features['insertPattern'].status === 'ok' && named(state, 'inserts', 'holeBore').length === 4 && copies === 2;
}

// ---------------------------------------------------------------- refusals

export function refusals(): (string | undefined | boolean)[] {
  const errorOf = (command: CommandAfter): string | undefined => done(engine.preview(command)).evaluation.features['screwHoles'].error?.code;
  return [
    // a head narrower than the bore: narrower than any bore a catalog can give
    errorOf({ type: 'setField', feature: 'screwHoles', path: 'shape/headDiameter', value: 0.001 }), // invalidHole
    // a point that is not in the sketch is an invalid command
    engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { points: ['s1', 'nope'] } }).ok, // false
    // a hole that misses its target is the warning of a cut that does: the box is below the lid
    // and the hole now runs up from the top of the lid (deeper than the plate is thick, so
    // deeper than its cone, whatever the catalog says)
    done(engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { targets: ['box'], extent: { type: 'distance', start: 5, distance: 'lidT + 5' } } })).evaluation.features['screwHoles'].warnings[0]?.code, // noEffect
    // "through all" away from the target: the lid does not reach above its own top. The tool
    // is built with the mark that it must not change a target; it only touches the lid, so the
    // feature has the warning and the recipe stays for a pattern; not `invalidHole`
    done(engine.preview({ type: 'updateFeature', id: 'screwHoles', patch: { extent: { type: 'throughAll', side: 'forward' } } })).evaluation.features['screwHoles'].warnings[0]?.code, // noEffect
  ];
}
export const wrong = (): void => {
  // The diameters in these four calls are made up; the calls only have to fail to compile.
  // @ts-expect-error a hole has no taper
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'plain', diameter: 1 }, extent: { type: 'distance', start: 0, distance: -5, taper: 0.1 }, targets: ['lid'] }));
  // @ts-expect-error a hole has a mouth: not through all to both sides
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'plain', diameter: 1 }, extent: { type: 'throughAll', side: 'both' }, targets: ['lid'] }));
  // @ts-expect-error a counterbore needs the depth of its head
  engine.execute(hole('h', { sketch: 'screws', points: ['s1'], shape: { type: 'counterbore', diameter: 1, headDiameter: 2 }, extent: { type: 'throughAll', side: 'backward' }, targets: ['lid'] }));
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
  const screws = screwChecks(screwHoles()) && socketHeadsInstead() && nutPockets().join() === '1,2,3,4,5,6';
  const inserts = insertChecks(insertHoles());
  const [narrowHead, unknownPoint, missed, away] = refusals();
  // the finished parts: the lid does not collide with the box, with the posts under it
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  const apart = report.pairs.length === 0 && report.failed.length === 0;
  return offsetAndWall && upTo && taper && followsTheDraft && screws && inserts && narrowHead === 'invalidHole' && unknownPoint === false && missed === 'noEffect' && away === 'noEffect' && unknownSize() === 'notAvailable in size' && apart;
}
