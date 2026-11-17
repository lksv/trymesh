// Package 3e written out as calls: its part of validation scenario 13 (an arm with joints,
// materials and a motor), "what to print and what to buy". Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. The first part writes the entry of the query and the writer of the file out against
// the real context of a query, so that the contract is shown to be enough for them; after the
// implementation they are `query/parts-list.ts` and `export/parts-csv.ts`, and the rest becomes
// a test in packages/scenarios.
//
// The numbers in the comments were measured on 2026-11-17 with a prototype of this entry over the
// arm as `packages/scenarios/test/arm.ts` builds it, with the real adapters (design.md,
// "Measured"). They become the expectations of the test.

import type { ArgsOf, BodyPropertiesResult, Command, EngineState, ExportFile, Exported, FaceName, HoleShape, Id, Input, PatternFeature, QueryContext, QueryOutcome, Solid } from '../../../packages/engine/src/index';
import { DATA_CATALOGS, coordinatePrecision, emptySketch } from '../../../packages/engine/src/index';
import { arm, cylinder } from '../../../packages/scenarios/test/arm';
import type { BodyCopy, EngineAfter3e, ExportFormatsAfter3e, FeatureModuleAfter3e, HardwareRow, HoleCount, PartFamily, PartRow, PartsCsvAbout, PartsList, PartsListView, PartsSum, QueriesAfter3e, ShapeOfBody } from './contract';
import { CONVENTION, PARTS_CSV, PARTS_CSV_OPTIONS, PARTS_CSV_TEXTS, PARTS_LIST_ARGS, PARTS_LIST_SIGNIFICANT, PARTS_LIST_TEXTS, PARTS_LIST_UNITS, bodyCopy, type csvField, type holeCounts, type partFamily, type partsCsv, type partsList, type sameShape } from './contract';

declare const engine: EngineAfter3e;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: Command[]): EngineState {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
function preview(...commands: Command[]): EngineState {
  const result = engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  return result.ok ? result.state : fail(result.error.message);
}
const near = (actual: number | undefined, expected: number, tolerance = 1e-3): boolean => actual !== undefined && Math.abs(actual - expected) <= tolerance;
const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

// ================================================================ the entry, written out

// ---------------------------------------------------------------- the registry

// The one line of `features/pattern.ts`.
export const copyOfPattern: NonNullable<FeatureModuleAfter3e<PatternFeature>['copyOf']> = (f) => (f.source.type === 'body' ? { body: f.source.body, mirrored: f.transform.type === 'mirror' } : undefined);

// `partFamily` of `features/index.ts`, over `bodyCopy`.
export const familyAsWritten: typeof partFamily = (doc, body) => {
  const seen: Id[] = [body];
  let mirrored = false;
  for (let copy: BodyCopy | undefined = bodyCopy(doc, body); copy !== undefined && !seen.includes(copy.body); copy = bodyCopy(doc, copy.body)) {
    mirrored = mirrored !== copy.mirrored;
    seen.push(copy.body);
  }
  return { root: seen[seen.length - 1], mirrored };
};

// ---------------------------------------------------------------- the same shape

export const sameShapeAsWritten: typeof sameShape = (a, b) => a.triangles === b.triangles && Math.abs(a.volume - b.volume) <= Math.max(a.precision, b.precision) * Math.max(a.surface, b.surface);
// The surface of a mesh: one pass over its triangles.
function surfaceOf({ positions: p, triangles: t }: Solid): number {
  let area = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [3 * t[i], 3 * t[i + 1], 3 * t[i + 2]];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return area;
}
const shapeOf = (context: QueryContext, body: Id): ShapeOfBody => {
  const result = context.bodies[body];
  return { triangles: result.solid.triangles.length / 3, volume: result.volume, surface: context.memo([result.solid], 'surface', () => surfaceOf(result.solid)), precision: coordinatePrecision(result) };
};

// ---------------------------------------------------------------- the holes of the model

const SIDES: readonly FaceName['role'][] = ['holeBore', 'holeHead', 'holeFlat'];
export const holeCountsAsWritten: typeof holeCounts = (doc, bodies, faceNames, counted) => {
  const holes = new Set(doc.features.filter((f) => f.type === 'hole').map((f) => f.id));
  const ofFeatures = (pattern: Id): boolean => doc.features.some((f) => f.id === pattern && f.type === 'pattern' && f.source.type === 'features');
  // feature → application (its point and the copy of a pattern of features) → family → the names
  // the faces of the application have in that family beyond the tag of the application
  const seen = new Map<Id, Map<string, Map<Id, Set<string>>>>();
  const at = <K, V>(map: Map<K, V>, key: K, make: () => V): V => map.get(key) ?? (map.set(key, make()), map.get(key) as V);
  for (const [id, body] of Object.entries(bodies)) {
    if (!counted(id)) continue;
    const { root } = familyAsWritten(doc, id);
    for (const face of body.faces) {
      const name = faceNames[face.id];
      if (!holes.has(name.feature) || !SIDES.includes(name.role) || !('point' in name)) continue;
      const tags = name.copy ?? [];
      const applied = tags.length > 0 && ofFeatures(tags[0].pattern) ? 1 : 0;
      const application = JSON.stringify([name.point, tags.slice(0, applied)]);
      at(at(at(seen, name.feature, () => new Map()), application, () => new Map()), root, () => new Set()).add(JSON.stringify(tags.slice(applied)));
    }
  }
  return new Map([...seen].map(([feature, applications]) => [feature, [...applications.values()].reduce((sum, families) => sum + Math.max(...[...families.values()].map((names) => names.size)), 0)]));
};

// ---------------------------------------------------------------- the rows

// What a body weighs by, as a text: bodies of one row say the same.
const weighsBy = (p: BodyPropertiesResult): string => (p.fieldErrors?.mass || p.fieldErrors?.density ? 'error' : p.massFrom === 'mass' ? `mass ${p.mass}` : p.massFrom === 'density' ? `density ${p.density}` : 'none');

const runAsWritten: (typeof partsList)['run'] = (context) => {
  const { document: doc, evaluation } = context.state;
  const properties = evaluation.bodyProperties;
  interface Group {
    key: string;
    bodies: Id[];
    family: PartFamily;
    shape: ShapeOfBody;
  }
  const groups: Group[] = [];
  const auxiliary: Id[] = [];
  for (const id of Object.keys(context.bodies)) {
    const result = properties[id];
    if (result.use === 'auxiliary') {
      auxiliary.push(id);
      continue;
    }
    const family = familyAsWritten(doc, id);
    // the name of the root names the row; a name of its own on a copy makes it another part
    const named = id === family.root ? '' : (own(doc.bodyProperties, id)?.name ?? '');
    const key = JSON.stringify([family.root, family.mirrored, result.use, result.material ?? null, result.color ?? null, weighsBy(result), named]);
    const shape = shapeOf(context, id);
    const group = groups.find((candidate) => candidate.key === key && sameShapeAsWritten(candidate.shape, shape));
    if (group) group.bodies.push(id);
    else groups.push({ key, bodies: [id], family, shape });
  }
  const row = ({ bodies, family, shape }: Group): PartRow => {
    const first = properties[bodies[0]];
    const masses = bodies.map((id) => properties[id].mass);
    const total = masses.every((mass) => mass !== undefined) ? masses.reduce<number>((sum, mass) => sum + (mass as number), 0) : undefined;
    return {
      name: own(doc.bodyProperties, bodies[0])?.name ?? own(properties, family.root)?.name ?? first.name,
      count: bodies.length,
      bodies,
      ...(first.material === undefined ? {} : { material: first.material }),
      ...(first.color === undefined ? {} : { color: first.color }),
      volume: shape.volume,
      ...(first.density === undefined ? {} : { density: first.density }),
      ...(first.mass === undefined || first.massFrom === undefined ? { noMass: first.fieldErrors ? ('inError' as const) : ('notStated' as const) } : { mass: first.mass, massFrom: first.massFrom }),
      ...(total === undefined ? {} : { totalMass: total }),
      ...(bodies.includes(family.root) ? {} : { copyOf: family.root }),
      ...(family.mirrored ? { mirrored: true as const } : {}),
    };
  };
  const rowsOf = (use: 'part' | 'reference'): PartRow[] => groups.filter((group) => properties[group.bodies[0]].use === use).map(row);
  const sum = (rows: PartRow[]): PartsSum => ({
    count: rows.reduce((total, r) => total + r.count, 0),
    mass: rows.reduce((total, r) => total + (r.totalMass ?? 0), 0),
    withoutMass: rows.reduce((total, r) => total + (r.totalMass === undefined ? r.count : 0), 0),
  });
  const [printed, bought] = [rowsOf('part'), rowsOf('reference')];

  // the hardware: the holes the bodies that are parts have, by the label of their feature
  const counts = holeCountsAsWritten(doc, context.bodies, evaluation.faceNames, (body) => properties[body].use !== 'auxiliary');
  const hardware: HardwareRow[] = [];
  const unlabelled: HoleCount[] = [];
  for (const feature of doc.features) {
    const count = feature.type === 'hole' ? (counts.get(feature.id) ?? 0) : 0;
    if (feature.type !== 'hole' || count === 0) continue;
    const hole: HoleCount = { feature: feature.id, count };
    const { label } = feature;
    if (label === undefined) {
      unlabelled.push(hole);
      continue;
    }
    const existing = hardware.find((candidate) => candidate.label === label);
    if (existing) {
      existing.count += count;
      existing.holes.push(hole);
    } else hardware.push({ label, count, holes: [hole] });
  }
  return {
    printed,
    bought,
    hardware,
    ...(unlabelled.length ? { unlabelled } : {}),
    ...(auxiliary.length ? { auxiliary } : {}),
    totals: { printed: sum(printed), bought: sum(bought), hardware: { count: hardware.reduce((total, r) => total + r.count, 0) } },
  };
};
export const entry: typeof partsList = { ...PARTS_LIST_TEXTS, args: PARTS_LIST_ARGS, significant: PARTS_LIST_SIGNIFICANT, units: PARTS_LIST_UNITS, geometry: 'modelled', run: runAsWritten };

// ---------------------------------------------------------------- the file

export const csvFieldAsWritten: typeof csvField = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
// A mass as the tools print it: six significant digits, no exponent, no trailing zeros.
const grams = (value: number | undefined): string => (value === undefined ? '' : String(Number(value.toPrecision(6)) + 0));
export function csvOf(list: PartsList): string {
  const body = (kind: string, r: PartRow): string[] => [kind, r.mirrored ? `${r.name}${PARTS_CSV.mirrored}` : r.name, String(r.count), r.material ?? '', r.color ?? '', grams(r.mass), grams(r.totalMass), r.bodies.join(' ')];
  const records: string[][] = [
    [...PARTS_CSV.header],
    ...list.printed.map((r) => body('printed', r)),
    ...list.bought.map((r) => body('bought', r)),
    ...list.hardware.map((r) => ['hardware', r.label, String(r.count), '', '', '', '', r.holes.map((hole) => hole.feature).join(' ')]),
  ];
  return records.map((record) => `${record.map(csvFieldAsWritten).join(',')}\r\n`).join('');
}
export const format: typeof partsCsv = {
  ...PARTS_CSV_TEXTS,
  options: PARTS_CSV_OPTIONS,
  // the context of an export has the bodies as modelled, which is what the entry asks for itself
  run: (context) => {
    const list = runAsWritten(context, {});
    const rows = list.printed.length + list.bought.length + list.hardware.length;
    const about: PartsCsvAbout = { rows, printed: list.printed.length, bought: list.bought.length, hardware: list.hardware.length };
    return { layout: 'file', files: [{ path: PARTS_CSV.path, mediaType: PARTS_CSV.mediaType, bytes: new TextEncoder().encode(csvOf(list)), about }], ...(rows === 0 ? { empty: PARTS_CSV.empty } : {}) };
  },
};

// ================================================================ the scenario

// ---------------------------------------------------------------- a. the arm, and what holds it together

// The arm of scenario 13 as `arm()` builds it (the bodies `base`, `upper`, `forearm`, `motor`,
// `screw` and the three copies `screws/1` to `screws/3` of the pattern `screws`), with the
// properties of the part of 3a: materials from the catalog, the motor and the screws as bought
// parts with the masses of their data sheets.
const dressed: Command = {
  type: 'batch',
  commands: [
    { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
    { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17 motor', color: '#30343a', use: 'reference', mass: 280 } },
    { type: 'setBodyProperties', body: 'screw', patch: { name: 'M3x6 screw', use: 'reference', material: 'steel', mass: 0.9 } },
  ],
};
// What this package adds to the model, with the commands of today:
// - a heat-set insert in `upper` under each of the four screws: one hole feature at the point
//   under the first screw (80, 0), from the top of `upper` (z = 8) down, and a pattern of it about
//   the centre of the motor, as the screws are a pattern of a body about it;
// - three feet under the base, each with an insert for a levelling screw: a body `foot` below the
//   base, a hole into it from below, and then a pattern of the body, so every copy has the hole.
// No size of an insert is written here: the shape, the label and the depth are answers of the
// query `hardwareHole` (D46). The sizes are the first M3 and the first M4 row of the catalog.
const insertOf = (thread: number) => {
  const rows = DATA_CATALOGS.heatSetInserts.rows;
  const size = Object.keys(rows).find((key) => rows[key].thread === thread) ?? fail(`the catalog heatSetInserts has no insert M${thread}`);
  const answer = unwrap(engine.query('hardwareHole', { use: 'heatSetInsert', size, allowance: 'holeComp' }));
  return { shape: answer.shape, label: answer.label, depth: answer.depth ?? fail('an insert has a depth') };
};
const XY = { kind: 'base', plane: 'XY' } as const;
const hole = (id: Id, sketch: Id, point: Id, target: Id, shape: Input<HoleShape>, start: number, distance: number, label: string): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'hole', sketch, points: [point], shape, extent: { type: 'distance', start, distance }, targets: [target], label },
});
export function build(): { m3: string; m4: string } {
  run(arm(), dressed);
  const [m3, m4] = [insertOf(3), insertOf(4)];
  run(
    { type: 'setParameter', name: 'holeComp', expr: '0.2' },
    { type: 'addFeature', feature: emptySketch('insertSketch', 'insertSketch', XY) },
    { type: 'addPoint', sketch: 'insertSketch', id: 'i1', x: 80, y: 0 },
    { type: 'addConstraint', sketch: 'insertSketch', id: 'i1Fix', constraint: { type: 'fixed', point: 'i1', x: 80, y: 0 } },
    hole('inserts', 'insertSketch', 'i1', 'upper', m3.shape, 8, -m3.depth, m3.label),
    { type: 'addFeature', feature: { id: 'insertPattern', name: 'insertPattern', suppressed: false, type: 'pattern', source: { type: 'features', features: ['inserts'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'motorSketch', point: 'motorCentre' }, count: 4, span: { type: 'full' } } } },
    // the foot: a cylinder of radius 6 under the base, from z = −20 to −10, with its hole from below
    ...cylinder('foot', 20, 0, 6, -20, -10),
    hole('footHole', 'footSketch', 'footCentre', 'foot', m4.shape, -20, m4.depth, m4.label),
    { type: 'addFeature', feature: { id: 'feet', name: 'Feet', suppressed: false, type: 'pattern', source: { type: 'body', body: 'foot' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } },
    { type: 'setBodyMaterial', body: 'foot', material: 'TPU' },
  );
  return { m3: m3.label, m4: m4.label }; // "M3x3x4.5 heat-set insert", "M4x3x5 heat-set insert" with the catalog of today
}

// ---------------------------------------------------------------- b. what to print and what to buy

const list = (state?: EngineState): PartsList => unwrap(engine.query('partsList', {}, state ? { state } : {}));
const told = (r: PartRow): string => `${r.name} × ${r.count}: ${r.bodies.join(' ')}`;

export function wholeList(labels: { m3: string; m4: string }): boolean {
  const { printed, bought, hardware, totals, unlabelled, auxiliary } = list();
  return (
    // four kinds of printed parts; the three feet are one row, named by the body they are copies of
    printed.map(told).join('; ') === 'base × 1: base; upper × 1: upper; forearm × 1: forearm; foot × 3: foot feet/1 feet/2' &&
    printed.map((r) => r.material).join() === 'PETG,PETG,PLA,TPU' &&
    // density times volume: 36.4016 g, 155.046 g (the four insert holes are out of it), 153.175 g, 1.31686 g a foot
    printed.every((r) => r.massFrom === 'density' && near(r.mass, ((r.density ?? 0) * r.volume) / 1000, 1e-9)) &&
    near(printed[1].volume, 122083.556) &&
    near(printed[3].totalMass, 3.95059, 1e-5) &&
    // the motor and the four screws, with the masses of their data sheets
    bought.map(told).join('; ') === 'NEMA 17 motor × 1: motor; M3x6 screw × 4: screw screws/1 screws/2 screws/3' &&
    bought[0].mass === 280 &&
    bought[0].color === '#30343a' &&
    bought[1].massFrom === 'mass' &&
    near(bought[1].totalMass, 3.6, 1e-9) &&
    // four inserts under the screws (the hole and the three copies of its pattern), three in the feet
    // (one hole, in the body and in its two copies)
    JSON.stringify(hardware) === JSON.stringify([{ label: labels.m3, count: 4, holes: [{ feature: 'inserts', count: 4 }] }, { label: labels.m4, count: 3, holes: [{ feature: 'footHole', count: 3 }] }]) &&
    // 6 printed bodies of 348.573 g, 5 bought ones of 283.6 g, 7 pieces of hardware
    totals.printed.count === 6 &&
    near(totals.printed.mass, 348.573) &&
    totals.printed.withoutMass === 0 &&
    totals.bought.count === 5 &&
    near(totals.bought.mass, 283.6, 1e-9) &&
    totals.hardware.count === 7 &&
    unlabelled === undefined &&
    auxiliary === undefined
  );
}

// ---------------------------------------------------------------- c. copies that are not the same part

// A copy in another colour is another row, named like its source and pointing at it; a copy with
// a name of its own is a row of that name. Nothing is written: each is asked of a preview.
export function copiesThatDiffer(): boolean {
  const black = list(preview({ type: 'setBodyProperties', body: 'screws/2', patch: { color: '#000000' } })).bought;
  const spare = list(preview({ type: 'setBodyProperties', body: 'screws/3', patch: { name: 'spare screw' } })).bought;
  return (
    black.map(told).join('; ') === 'NEMA 17 motor × 1: motor; M3x6 screw × 3: screw screws/1 screws/3; M3x6 screw × 1: screws/2' &&
    black[2].color === '#000000' &&
    black[2].copyOf === 'screw' &&
    near(black[1].totalMass, 2.7, 1e-9) &&
    spare.map(told).join('; ') === 'NEMA 17 motor × 1: motor; M3x6 screw × 3: screw screws/1 screws/2; spare screw × 1: screws/3'
  );
}
// The count of a pattern is a numeric field: six screws are one change, and the list then says
// six screws for four inserts, which is the thing a reader should see.
export function sixScrews(): boolean {
  const six = list(preview({ type: 'setField', feature: 'screws', path: 'transform/count', value: 6 }));
  return six.bought[1].count === 6 && near(six.bought[1].totalMass, 5.4, 1e-9) && six.hardware[0].count === 4;
}
// A mirror image is another part: the feet mirrored in the plane YZ instead of turned. One foot,
// one mirror image of it, and two inserts.
export function mirroredFoot(): boolean {
  const mirrored = list(preview({ type: 'updateFeature', id: 'feet', patch: { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } }));
  const [, , , foot, image] = mirrored.printed;
  return told(foot) === 'foot × 1: foot' && told(image) === 'foot × 1: feet/1' && image.mirrored === true && image.copyOf === 'foot' && foot.mirrored === undefined && mirrored.hardware[1].count === 2;
}
// A copy that a later feature changed is no longer the part its source is: a notch of radius 2
// cut into `feet/1` alone (at (−10, 17.32), where the pattern put it). Its volume is 1041.004 mm3
// against 1053.490; the number of its triangles changed as well (484 against 356).
export function changedCopy(): boolean {
  const notched = list(preview(...cylinder('notch', -10, 17.32, 2, -21, -15, 'cut', 'feet/1'))).printed;
  const [, , , feet, one] = notched;
  return told(feet) === 'foot × 2: foot feet/2' && told(one) === 'foot × 1: feet/1' && one.copyOf === 'foot' && one.mirrored === undefined && near(one.volume, 1041.004) && near(feet.volume, 1053.49);
}

// ---------------------------------------------------------------- d. a part without a mass, and a body that is no part

export function withoutMass(): boolean {
  // the forearm with no properties: it is still a printed part, and the sum says one body is not in it
  const bare = list(preview({ type: 'removeBodyProperties', body: 'forearm' }));
  // a density that cannot be evaluated is not "nothing stated"
  const broken = list(
    preview({ type: 'setParameter', name: 'rho', expr: '1.2' }, { type: 'setBodyProperties', body: 'forearm', patch: { density: 'rho' } }, { type: 'setParameter', name: 'rho', expr: 'nope' }),
  );
  return (
    bare.printed[2].noMass === 'notStated' &&
    bare.printed[2].mass === undefined &&
    bare.printed[2].totalMass === undefined &&
    bare.totals.printed.withoutMass === 1 &&
    near(bare.totals.printed.mass, 195.398) && // 348.573 less the forearm
    bare.totals.printed.count === 6 &&
    broken.printed[2].noMass === 'inError' &&
    broken.totals.printed.withoutMass === 1
  );
}
// An auxiliary body (kept-free space, an envelope) is no part: listed apart, in no row and no sum.
export function auxiliaryBody(): boolean {
  const kept = list(preview({ type: 'setBodyProperties', body: 'base', patch: { use: 'auxiliary' } }));
  return kept.auxiliary?.join() === 'base' && kept.printed.every((r) => !r.bodies.includes('base')) && kept.totals.printed.count === 5 && near(kept.totals.printed.mass, 312.171);
}

// ---------------------------------------------------------------- e. the hardware follows the model and the labels

export function hardwareFollows(labels: { m3: string; m4: string }): boolean {
  // the pattern of the inserts suppressed: one insert is left
  const one = list(preview({ type: 'setSuppressed', id: 'insertPattern', suppressed: true })).hardware;
  // a hole without a label holds nothing the list could name: it is listed apart, with its holes
  const bare = list(preview({ type: 'updateFeature', id: 'footHole', patch: { label: null } }));
  // the label is the name of the piece: what the catalog does not know is typed into it
  const brass = list(preview({ type: 'updateFeature', id: 'inserts', patch: { label: 'M3 insert, brass' } })).hardware;
  // one screw through the link and the forearm is one hole feature with both as targets, and one piece
  const through = list(
    preview(
      { type: 'addFeature', feature: emptySketch('throughSketch', 'throughSketch', XY) },
      { type: 'addPoint', sketch: 'throughSketch', id: 't1', x: 125, y: 20 },
      { type: 'addConstraint', sketch: 'throughSketch', id: 't1Fix', constraint: { type: 'fixed', point: 't1', x: 125, y: 20 } },
      { type: 'addFeature', feature: { id: 'through', name: 'through', suppressed: false, type: 'hole', sketch: 'throughSketch', points: ['t1'], shape: { type: 'plain', diameter: 3.4 }, extent: { type: 'distance', start: 16, distance: -16 }, targets: ['upper', 'forearm'], label: 'M3x16 screw' } },
    ),
  ).hardware;
  return (
    one[0].count === 1 &&
    one[1].count === 3 &&
    bare.hardware.map((r) => r.label).join() === labels.m3 &&
    JSON.stringify(bare.unlabelled) === JSON.stringify([{ feature: 'footHole', count: 3 }]) &&
    bare.totals.hardware.count === 4 &&
    brass[0].label === 'M3 insert, brass' &&
    brass[0].count === 4 &&
    through[2].label === 'M3x16 screw' &&
    through[2].count === 1 // the bore is a face of `upper` and of `forearm`: one hole
  );
}

// ---------------------------------------------------------------- f. another state, and the pose

// The state after a feature: after the motor there are no screws, no feet and no hole yet, and
// `upper` weighs 155.353 g, the four insert holes not yet cut.
export function afterTheMotor(): boolean {
  const early = unwrap(engine.query('partsList', {}, { at: 'motor' }));
  return early.printed.map(told).join('; ') === 'base × 1: base; upper × 1: upper; forearm × 1: forearm' && near(early.printed[1].mass, 155.353) && early.bought.map(told).join() === 'NEMA 17 motor × 1: motor' && early.hardware.length === 0 && early.totals.hardware.count === 0;
}
// A parts list does not depend on a pose. With a mechanism bent, and even with a joint whose axis
// is gone, so that a posed query cannot read the bodies beyond it (the mass of the forearm fails:
// "the pose of the body "forearm" is not known"), the list is what it was.
export function inAnyPose(): boolean {
  const state = preview(
    { type: 'setLink', id: 'ground', bodies: ['base'] },
    { type: 'setLink', id: 'arm', bodies: ['upper', 'motor'] },
    { type: 'setLink', id: 'fore', bodies: ['forearm'] },
    { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'ground', child: 'arm', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' }, lower: -3, upper: 3, value: 0.5 } },
    { type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'arm', child: 'fore', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, lower: -3, upper: 3, value: 0.7 } },
    { type: 'removeFeature', id: 'layout' },
  );
  const posed = engine.query('mass', { bodies: ['forearm'] }, { state });
  const parts = list(state);
  return !posed.ok && posed.error.code === 'failed' && parts.totals.printed.count === 6 && near(parts.totals.printed.mass, 348.573) && parts.totals.hardware.count === 7;
}

// ---------------------------------------------------------------- g. the list as a file

const only = (exported: Exported): ExportFile => (exported.layout === 'file' && exported.files.length === 1 && exported.empty === undefined ? exported.files[0] : fail(exported.empty ?? 'one file is expected'));
export function asCsv(labels: { m3: string; m4: string }): boolean {
  const file = only(unwrap(engine.export('partsCsv', {})));
  const about = file.about as PartsCsvAbout;
  const expected = [
    'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),IDs',
    'printed,base,1,PETG,,36.4016,36.4016,base',
    'printed,upper,1,PETG,,155.046,155.046,upper',
    'printed,forearm,1,PLA,,153.175,153.175,forearm',
    'printed,foot,3,TPU,,1.31686,3.95059,foot feet/1 feet/2',
    'bought,NEMA 17 motor,1,,#30343a,280,280,motor',
    'bought,M3x6 screw,4,steel,,0.9,3.6,screw screws/1 screws/2 screws/3',
    `hardware,${labels.m3},4,,,,,inserts`,
    `hardware,${labels.m4},3,,,,,footHole`,
  ];
  // a label with a comma is one field in quotes, and a mirror image says so in its name
  const quoted = new TextDecoder().decode(only(unwrap(engine.export('partsCsv', {}, { state: preview({ type: 'updateFeature', id: 'inserts', patch: { label: 'M3 insert, brass' } }, { type: 'updateFeature', id: 'feet', patch: { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } }) }))).bytes);
  return (
    file.path === PARTS_CSV.path &&
    file.mediaType === 'text/csv' &&
    new TextDecoder().decode(file.bytes) === expected.map((record) => `${record}\r\n`).join('') &&
    about.rows === 8 &&
    about.printed === 4 &&
    about.bought === 2 &&
    about.hardware === 2 &&
    quoted.includes('hardware,"M3 insert, brass",4,,,,,inserts\r\n') &&
    quoted.includes('printed,foot (mirror image),1,TPU,,1.31686,1.31686,feet/1\r\n')
  );
}
// A model with nothing to list says so in `empty`, and a tool that writes files refuses with the
// text: here the state before the first body.
export const nothingToList = (): string | undefined => unwrap(engine.export('partsCsv', {}, { at: 'baseSketch' })).empty; // PARTS_CSV.empty

// ---------------------------------------------------------------- h. through MCP

// Nothing of the tools changes. The inputs of the tool `query` (`{ query, args?, at?, after? }`)
// and of the tool `export` (`{ format, path, options?, overwrite?, at?, after? }`):
export const overMcp = [
  { query: 'partsList' },
  // what the list would be with six screws, nothing written to the document
  { query: 'partsList', after: { type: 'setField', feature: 'screws', path: 'transform/count', value: 6 } },
  { format: 'partsCsv', path: 'out/arm-parts.csv' },
] as const;
// The rows of the two typed tables of `packages/mcp/test/queries.test.ts` and of
// `packages/mcp/test/export-formats.test.ts` (there over every entry of the catalogs).
export const FIXTURES: { partsList: ArgsOf<QueriesAfter3e['partsList']['spec']>; partsCsv: ArgsOf<ExportFormatsAfter3e['partsCsv']> } = { partsList: {}, partsCsv: {} };
// Every argument of the query and every option of the format, and whether a caller may leave it
// out: there is none.
export const ARGUMENTS: { partsList: { [K in keyof (typeof PARTS_LIST_ARGS)]: 'optional' | 'required' }; partsCsv: { [K in keyof (typeof PARTS_CSV_OPTIONS)]: 'optional' | 'required' } } = { partsList: {}, partsCsv: {} };
// An argument the query does not have is refused when it is asked, by the check of every query
// (`invalidArguments`, "the query has no such argument"); the type of no arguments takes any object.
export function noSuchArgument(): string {
  const outcome = engine.query('partsList', { bodies: ['base'] } as {});
  return outcome.ok ? 'ok' : outcome.error.code; // invalidArguments
}
// The paragraph of the conventions of `describe_api` that tells an AI what to write into a label.
export const said: string = CONVENTION;

// ---------------------------------------------------------------- i. the view of the app

const SELECT = 0x2f80ed; // the colour of a selection (`COLOR.select` of the app)
const allRows = (result: PartsList): (PartRow | HardwareRow)[] => [...result.printed, ...result.bought, ...result.hardware];
export const view: PartsListView = {
  immediate: true,
  answer(result, panel) {
    const each = (r: PartRow): string => (r.mass === undefined ? (r.noMass === 'inError' ? 'the mass cannot be evaluated' : 'no mass: set a material or a mass') : r.count === 1 ? panel.number(r.mass, 'g') : `${panel.number(r.mass, 'g')} each, ${panel.number(r.totalMass ?? 0, 'g')}`);
    const rows = allRows(result).map((r, index) =>
      'label' in r
        ? { text: `${r.label} × ${r.count}`, detail: r.holes.map((hole) => hole.feature).join(', '), picked: panel.picked === index }
        : { text: `${r.name}${r.mirrored ? ' (mirror image)' : ''} × ${r.count}`, detail: [r.material, each(r)].filter((part) => part !== undefined).join(' · '), picked: panel.picked === index },
    );
    const { printed, bought } = result.totals;
    const hints = [
      `To print: ${printed.count} bodies, ${panel.number(printed.mass, 'g')}${printed.withoutMass ? ` without the ${printed.withoutMass} that state no mass` : ''}. To buy: ${bought.count}, ${panel.number(bought.mass, 'g')}${bought.withoutMass ? ` without the ${bought.withoutMass} that state no mass` : ''}.`,
      ...(result.unlabelled ? [`Holes without a label: ${result.unlabelled.map((hole) => `${hole.feature} (${hole.count})`).join(', ')}. Label a hole with the piece that goes into it.`] : []),
      ...(result.auxiliary ? [`No parts (auxiliary): ${result.auxiliary.map((body) => panel.bodyName(body)).join(', ')}.`] : []),
    ];
    return { rows, hints };
  },
  scene(result, panel) {
    const picked = panel.picked === undefined ? undefined : allRows(result)[panel.picked];
    if (!picked) return {};
    if (!('label' in picked)) return { bodies: picked.bodies.map((body) => ({ body, color: SELECT })) };
    // the side faces of the hole features of the row, in the bodies of the state the answer is of:
    // the faces a selected hole feature shows, looked up, not computed
    const features = new Set(picked.holes.map((hole) => hole.feature));
    const { bodies, faceNames } = panel.state.evaluation;
    return { faces: Object.entries(bodies).flatMap(([body, result]) => result.faces.map((face) => faceNames[face.id]).filter((name) => features.has(name.feature)).map((face) => ({ body, face, color: SELECT, opacity: 0.6 }))) };
  },
  note: (result) => ({ text: `Parts list: ${result.totals.printed.count} to print, ${result.totals.bought.count} to buy, ${result.totals.hardware.count} pieces of hardware. Pick a row to see it.`, error: false }),
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario13(): boolean {
  const labels = build();
  return wholeList(labels) && copiesThatDiffer() && sixScrews() && mirroredFoot() && changedCopy() && withoutMass() && auxiliaryBody() && hardwareFollows(labels) && afterTheMotor() && inAnyPose() && asCsv(labels) && nothingToList() === PARTS_CSV.empty;
}
