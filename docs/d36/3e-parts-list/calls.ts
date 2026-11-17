// Package 3e written out as calls: its part of validation scenario 13 (an arm with joints,
// materials and a motor), "what to print and what to buy". Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. The first part writes the entry of the query and the writer of the file out against
// the real context of a query, so that the contract is shown to be enough for them; after the
// implementation they are `query/parts-list.ts` and `export/parts-csv.ts`, and the rest becomes
// a test in packages/scenarios.
//
// The numbers in the comments were measured on 2026-11-17 with a prototype of this entry over the
// arm as `packages/scenarios/test/arm.ts` builds it, with the real adapters and, for
// `shapeOrigin`, a copy of the repository with the twenty lines of `solid.ts` applied (design.md,
// "Measured"). They become the expectations of the test.

import type { ArgsOf, BodyPropertiesResult, Command, EngineState, ExportFile, Exported, HoleShape, Id, Input, QueryContext, QueryOutcome, Solid, Vec3 } from '../../../packages/engine/src/index';
import { DATA_CATALOGS, bodyOwner, emptySketch } from '../../../packages/engine/src/index';
import { plain } from '../../../packages/engine/src/export/text';
import { bodySource } from '../../../packages/engine/src/features/index';
import { arm, cylinder } from '../../../packages/scenarios/test/arm';
import type { EngineAfter3e, ExportFormatsAfter3e, HardwareRow, HoleCount, PartRow, PartsCsvAbout, PartsList, PartsListView, PartsSum, QueriesAfter3e, ViewGroup } from './contract';
import { CONVENTION, PARTS_CSV, PARTS_CSV_OPTIONS, PARTS_CSV_TEXTS, PARTS_LIST_ARGS, PARTS_LIST_SIGNIFICANT, PARTS_LIST_TEXTS, PARTS_LIST_UNITS, type csvField, type holeCounts, type partName, type partsCsv, type partsList, shapeOrigin, type sourceRoot } from './contract';

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

// ---------------------------------------------------------------- the root of a chain of sources

// The chain of sources of a body, the body first, over `bodySource` (D48); it stops at a body it
// has seen. `sourceRoot` of `features/index.ts` is its last body.
const chainOf = (doc: Parameters<typeof sourceRoot>[0], body: Id): Id[] => {
  const seen: Id[] = [body];
  for (let source = bodySource(doc, body); source !== undefined && !seen.includes(source); source = bodySource(doc, source)) seen.push(source);
  return seen;
};
export const rootAsWritten: typeof sourceRoot = (doc, body) => chainOf(doc, body).at(-1) ?? body;

// `partName` of `sections/body-properties.ts`: the nearest name of its own on the chain, else the
// default name of the root (`defaultName` there: after its feature, a copy with its number).
export const partNameAsWritten: typeof partName = (doc, body) => {
  const chain = chainOf(doc, body);
  for (const id of chain) {
    const name = own(doc.bodyProperties, id)?.name;
    if (name !== undefined) return name;
  }
  const { feature, local } = bodyOwner(chain.at(-1) ?? body);
  const name = doc.features.find((f) => f.id === feature)?.name ?? feature;
  return local === undefined ? name : `${name} / ${local}`;
};

// ---------------------------------------------------------------- the holes of the model

const LENGTH_TOLERANCE = 1e-6; // of `util.ts`
const ANGLE_TOLERANCE = 1e-4; // of `util.ts`
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const largest = (a: Vec3): number => Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]));
// One cut: its line, and the stretch of it its faces cover (from `point` along `direction`).
interface Cut {
  point: Vec3;
  direction: Vec3; // a unit vector
  from: number;
  to: number;
  reach: number; // the largest coordinate of its triangles
}
// One line: parallel within the angle tolerance, the point of one on the other. The surfaces are
// moved in double precision; the bound does not grow with the distance along the line.
function sameLine(a: Cut, b: Cut): boolean {
  if (length(cross(a.direction, b.direction)) > ANGLE_TOLERANCE) return false;
  const precision = Math.max(LENGTH_TOLERANCE, 1e-9 * Math.max(largest(a.point), largest(b.point)));
  return length(cross(minus(b.point, a.point), a.direction)) <= precision;
}
// The stretches of two cuts on one line touch or overlap, within the precision of float32.
function touch(a: Cut, b: Cut): boolean {
  const offset = dot(minus(b.point, a.point), a.direction);
  const [from, to] = dot(a.direction, b.direction) > 0 ? [offset + b.from, offset + b.to] : [offset - b.to, offset - b.from];
  const precision = 1e-6 * Math.max(1, a.reach, b.reach);
  return from <= a.to + precision && a.from <= to + precision;
}
export const holeCountsAsWritten: typeof holeCounts = (doc, bodies, faceNames, surface) => {
  const holes = new Set(doc.features.filter((f) => f.type === 'hole').map((f) => f.id));
  // feature → cut (its point and its copy tags) → where it is
  const cuts = new Map<Id, Map<string, Cut>>();
  for (const [id, body] of Object.entries(bodies)) {
    const mine = new Map<number, Cut>(); // the faces of this body that are bores and heads, and their cuts
    for (const face of body.faces) {
      const name = faceNames[face.id];
      if (!holes.has(name.feature) || (name.role !== 'holeBore' && name.role !== 'holeHead')) continue;
      const shape = surface(id, face.id);
      if (shape?.kind !== 'cylinder' && shape?.kind !== 'cone') continue;
      const ofFeature = cuts.get(name.feature) ?? new Map<string, Cut>();
      cuts.set(name.feature, ofFeature);
      const key = JSON.stringify([name.point ?? null, name.copy ?? []]);
      const cut = ofFeature.get(key) ?? { point: shape.kind === 'cylinder' ? shape.origin : shape.apex, direction: shape.axis.map((part) => part / length(shape.axis)) as Vec3, from: Infinity, to: -Infinity, reach: 0 };
      ofFeature.set(key, cut);
      mine.set(face.id, cut);
    }
    if (mine.size === 0) continue;
    const { positions, triangles, faceIds } = body.solid;
    for (let t = 0; t < faceIds.length; t++) {
      const cut = mine.get(faceIds[t]);
      if (cut === undefined) continue;
      for (let corner = 0; corner < 3; corner++) {
        const v = 3 * triangles[3 * t + corner];
        const at: Vec3 = [positions[v], positions[v + 1], positions[v + 2]];
        const along = dot(minus(at, cut.point), cut.direction);
        cut.from = Math.min(cut.from, along);
        cut.to = Math.max(cut.to, along);
        cut.reach = Math.max(cut.reach, largest(at));
      }
    }
  }
  const counts = new Map<Id, number>();
  for (const [feature, ofFeature] of cuts) {
    const list = [...ofFeature.values()].filter((cut) => cut.from <= cut.to);
    // cuts on one line whose stretches touch are one hole: joined one after the other
    const group = list.map((_, index) => index);
    const find = (index: number): number => (group[index] === index ? index : (group[index] = find(group[index])));
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (sameLine(list[a], list[b]) && touch(list[a], list[b])) group[find(a)] = find(b);
    counts.set(feature, new Set(list.map((_, index) => find(index))).size);
  }
  return counts;
};

// ---------------------------------------------------------------- the rows

// What a body weighs by, as a text: the mass the properties resolved, by its source and its
// number; without one, whether a field is in error or nothing is stated. (A mass that is stated
// beside a density in error is a mass.)
const weighsBy = (p: BodyPropertiesResult): string => (p.mass !== undefined ? (p.massFrom === 'mass' ? `mass ${p.mass}` : `density ${p.density}`) : p.fieldErrors ? 'error' : 'none');

const runAsWritten: (typeof partsList)['run'] = (context) => {
  const { document: doc, evaluation } = context.state;
  const properties = evaluation.bodyProperties;
  // a number per mesh, for the key of a row
  const meshes = new Map<Solid, number>();
  const numberOf = (solid: Solid): number => meshes.get(solid) ?? (meshes.set(solid, meshes.size), meshes.size - 1);
  const groups = new Map<string, Id[]>(); // in the order of their first bodies
  const auxiliary: Id[] = [];
  for (const [id, body] of Object.entries(context.bodies)) {
    const result = properties[id];
    if (result.use === 'auxiliary') {
      auxiliary.push(id);
      continue;
    }
    const origin = shapeOrigin(body.solid);
    const key = JSON.stringify([numberOf(origin.solid), origin.mirrored, result.use, result.material ?? null, result.color ?? null, result.density ?? null, weighsBy(result), partNameAsWritten(doc, id)]);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const row = (bodies: Id[]): PartRow => {
    const first = properties[bodies[0]];
    const root = rootAsWritten(doc, bodies[0]);
    // what the row comes from, when that body is in the state and not in the row, and whether the
    // row is still its mesh
    const origin = shapeOrigin(context.bodies[bodies[0]].solid);
    const source = bodies.includes(root) || !Object.hasOwn(context.bodies, root) ? undefined : shapeOrigin(context.bodies[root].solid);
    const same = source !== undefined && source.solid === origin.solid;
    return {
      name: partNameAsWritten(doc, bodies[0]),
      count: bodies.length,
      bodies,
      ...(first.material === undefined ? {} : { material: first.material }),
      ...(first.color === undefined ? {} : { color: first.color }),
      volume: context.bodies[bodies[0]].volume,
      ...(first.density === undefined ? {} : { density: first.density }),
      // the bodies of a row weigh by the same, so all of them have a mass or none has
      ...(first.mass === undefined || first.massFrom === undefined
        ? { noMass: first.fieldErrors ? ('inError' as const) : ('notStated' as const) }
        : { mass: first.mass, massFrom: first.massFrom, totalMass: bodies.reduce((sum, id) => sum + (properties[id].mass ?? 0), 0) }),
      ...(source === undefined ? {} : { copyOf: root }),
      ...(same && source.mirrored !== origin.mirrored ? { mirrored: true as const } : {}),
      ...(source !== undefined && !same ? { differs: true as const } : {}),
    };
  };
  const rowsOf = (use: 'part' | 'reference'): PartRow[] => [...groups.values()].filter((bodies) => properties[bodies[0]].use === use).map(row);
  const sum = (rows: PartRow[]): PartsSum => ({
    count: rows.reduce((total, r) => total + r.count, 0),
    mass: rows.reduce((total, r) => total + (r.totalMass ?? 0), 0),
    withoutMass: rows.reduce((total, r) => total + (r.totalMass === undefined ? r.count : 0), 0),
  });
  const [printed, bought] = [rowsOf('part'), rowsOf('reference')];

  // the hardware: the holes the bodies that are parts have, by the label of their feature
  const parts = Object.fromEntries(Object.entries(context.bodies).filter(([id]) => properties[id].use !== 'auxiliary'));
  const counts = holeCountsAsWritten(doc, parts, evaluation.faceNames, (body, face) => context.surface(body, evaluation.faceNames[face]));
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

export const csvFieldAsWritten: typeof csvField = (value) => {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
// A mass: six significant digits, as the tools print it, then written by `plain` of
// `export/text.ts`: at most nine decimals, no exponent (also from 1e21 on), no trailing zeros.
const grams = (value: number | undefined): string => (value === undefined ? '' : plain(Number(value.toPrecision(6))));
export function csvOf(list: PartsList): string {
  const note = (r: PartRow): string => (r.copyOf === undefined ? '' : `${r.differs ? PARTS_CSV.differs : r.mirrored ? PARTS_CSV.mirror : PARTS_CSV.copy}${r.copyOf}`);
  const body = (kind: string, r: PartRow): string[] => [kind, r.name, String(r.count), r.material ?? '', r.color ?? '', grams(r.mass), grams(r.totalMass), note(r), r.bodies.join(' ')];
  const records: string[][] = [
    [...PARTS_CSV.header],
    ...list.printed.map((r) => body('printed', r)),
    ...list.bought.map((r) => body('bought', r)),
    ...list.hardware.map((r) => ['hardware', r.label, String(r.count), '', '', '', '', '', r.holes.map((hole) => hole.feature).join(' ')]),
  ];
  return records.map((record) => `${record.map(csvFieldAsWritten).join(',')}\r\n`).join('');
}
export const format: typeof partsCsv = {
  ...PARTS_CSV_TEXTS,
  options: PARTS_CSV_OPTIONS,
  // the context of an export has the bodies as modelled, which is what the entry asks for itself
  run: (context: QueryContext) => {
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
  return told(foot) === 'foot × 1: foot' && told(image) === 'foot × 1: feet/1' && image.mirrored === true && image.copyOf === 'foot' && image.differs === undefined && foot.mirrored === undefined && mirrored.hardware[1].count === 2;
}
// A copy that a later feature changed is no longer the part its source is: a notch of radius 2
// cut into `feet/1` alone (at (−10, 17.32), where the pattern put it). Its solid is a new one, so
// it is a copy of no mesh any more, and its row says that it differs from `foot`; its volume is
// 1041.004 mm3 against 1053.490.
export function changedCopy(): boolean {
  const notched = list(preview(...cylinder('notch', -10, 17.32, 2, -21, -15, 'cut', 'feet/1'))).printed;
  const [, , , feet, one] = notched;
  return told(feet) === 'foot × 2: foot feet/2' && told(one) === 'foot × 1: feet/1' && one.copyOf === 'foot' && one.differs === true && one.mirrored === undefined && near(one.volume, 1041.004) && near(feet.volume, 1053.49);
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
  // one screw through the link and the forearm is one hole feature with both as targets, and one
  // piece. Its clearance hole is the catalog's; its label is the screw, with the length the hole
  // is deep, in place of the label of the catalog, which names the hole
  const clearance = unwrap(engine.query('hardwareHole', { use: 'clearance', size: 'M3' }));
  const through = list(
    preview(
      { type: 'addFeature', feature: emptySketch('throughSketch', 'throughSketch', XY) },
      { type: 'addPoint', sketch: 'throughSketch', id: 't1', x: 125, y: 20 },
      { type: 'addConstraint', sketch: 'throughSketch', id: 't1Fix', constraint: { type: 'fixed', point: 't1', x: 125, y: 20 } },
      { type: 'addFeature', feature: { id: 'through', name: 'through', suppressed: false, type: 'hole', sketch: 'throughSketch', points: ['t1'], shape: clearance.shape, extent: { type: 'distance', start: 16, distance: -16 }, targets: ['upper', 'forearm'], label: 'M3x16 screw' } },
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
    through[2].count === 1 // the bore is a face of `upper` and of `forearm`, on one axis: one hole
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
    'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs',
    'printed,base,1,PETG,,36.4016,36.4016,,base',
    'printed,upper,1,PETG,,155.046,155.046,,upper',
    'printed,forearm,1,PLA,,153.175,153.175,,forearm',
    'printed,foot,3,TPU,,1.31686,3.95059,,foot feet/1 feet/2',
    'bought,NEMA 17 motor,1,,#30343a,280,280,,motor',
    'bought,M3x6 screw,4,steel,,0.9,3.6,,screw screws/1 screws/2 screws/3',
    `hardware,${labels.m3},4,,,,,,inserts`,
    `hardware,${labels.m4},3,,,,,,footHole`,
  ];
  // a label with a comma is one field in quotes; a tab in a name is a space; a row of copies that
  // differ from their source says so in its note
  const changed = preview(
    { type: 'updateFeature', id: 'inserts', patch: { label: 'M3 insert, brass' } },
    { type: 'setBodyProperties', body: 'motor', patch: { name: 'NEMA 17\tmotor' } },
    { type: 'updateFeature', id: 'feet', patch: { transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } },
  );
  const quoted = new TextDecoder().decode(only(unwrap(engine.export('partsCsv', {}, { state: changed }))).bytes);
  return (
    file.path === PARTS_CSV.path &&
    file.mediaType === 'text/csv' &&
    new TextDecoder().decode(file.bytes) === expected.map((record) => `${record}\r\n`).join('') &&
    about.rows === 8 &&
    about.printed === 4 &&
    about.bought === 2 &&
    about.hardware === 2 &&
    quoted.includes('hardware,"M3 insert, brass",4,,,,,,inserts\r\n') &&
    quoted.includes('bought,NEMA 17 motor,1,,#30343a,280,280,,motor\r\n') &&
    quoted.includes('printed,foot,1,TPU,,1.31686,1.31686,,foot\r\n') &&
    quoted.includes('printed,foot,1,TPU,,1.31686,1.31686,mirror image of foot,feet/1\r\n')
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
// (`invalidArguments`, "there is no such argument"); the type of no arguments takes any object.
export function noSuchArgument(): string {
  const outcome = engine.query('partsList', { bodies: ['base'] } as {});
  return outcome.ok ? 'ok' : outcome.error.code; // invalidArguments
}
// The paragraph of the conventions of `describe_api` that tells an AI what to write into a label.
export const said: string = CONVENTION;

// ---------------------------------------------------------------- i. the view of the app

declare const SELECT: number; // the colour of a selection (`COLOR.select` of `packages/app/src/draw.ts`)
const allRows = (result: PartsList): (PartRow | HardwareRow)[] => [...result.printed, ...result.bought, ...result.hardware];
export const view: PartsListView = {
  immediate: true,
  answer(result, _args, panel) {
    const weighs = (r: PartRow): string => (r.mass === undefined ? (r.noMass === 'inError' ? 'the mass cannot be evaluated' : 'no mass: set a material or a mass') : r.count === 1 ? panel.number(r.mass, 'g') : `${panel.number(r.mass, 'g')} each, ${panel.number(r.totalMass ?? 0, 'g')}`);
    const source = (r: PartRow): string | undefined => (r.copyOf === undefined ? undefined : `${r.differs ? 'differs from' : r.mirrored ? 'mirror image of' : 'copy of'} ${panel.bodyName(r.copyOf)}`);
    // rows are counted through the three groups, in the order of `allRows`
    let index = 0;
    const bodies = (heading: string, rows: PartRow[]): ViewGroup => ({
      heading,
      rows: rows.map((r) => ({ text: `${r.name} × ${r.count}`, detail: [r.material, weighs(r), source(r)].filter((part) => part !== undefined).join(' · '), ...(r.color === undefined ? {} : { swatch: r.color }), picked: panel.picked === index++ })),
    });
    const groups: ViewGroup[] = [bodies('To print', result.printed), bodies('To buy', result.bought)];
    groups.push({ heading: 'Hardware', rows: result.hardware.map((r) => ({ text: `${r.label} × ${r.count}`, detail: r.holes.map((hole) => `${hole.feature} (${hole.count})`).join(', '), picked: panel.picked === index++ })) });
    const { printed, bought } = result.totals;
    const without = (count: number): string => (count ? `, not counting ${count} without a mass` : '');
    const hints = [
      `To print: ${printed.count} bodies, ${panel.number(printed.mass, 'g')}${without(printed.withoutMass)}. To buy: ${bought.count}, ${panel.number(bought.mass, 'g')}${without(bought.withoutMass)}.`,
      ...(result.unlabelled ? [`Holes without a label: ${result.unlabelled.map((hole) => `${hole.feature} (${hole.count})`).join(', ')}. Label a hole with the piece that goes into it.`] : []),
      ...(result.auxiliary ? [`No parts (auxiliary): ${result.auxiliary.map((body) => panel.bodyName(body)).join(', ')}.`] : []),
    ];
    return { groups: groups.filter((group) => group.rows.length > 0), hints };
  },
  scene(result, _args, panel) {
    const picked = panel.picked === undefined ? undefined : allRows(result)[panel.picked];
    if (!picked) return {};
    if (!('label' in picked)) return { bodies: picked.bodies.map((body) => ({ body, color: SELECT })) };
    // The faces the count was taken from: the bores and the heads of the hole features of the row,
    // in the bodies of the state that are parts. Looked up, not computed.
    const features = new Set(picked.holes.map((hole) => hole.feature));
    const { bodies, faceNames, bodyProperties } = panel.state.evaluation;
    return {
      faces: Object.entries(bodies)
        .filter(([body]) => bodyProperties[body].use !== 'auxiliary')
        .flatMap(([body, shape]) => shape.faces.map((face) => faceNames[face.id]).filter((name) => features.has(name.feature) && (name.role === 'holeBore' || name.role === 'holeHead')).map((face) => ({ body, face, color: SELECT, opacity: 0.6 }))),
    };
  },
  note: (result) => ({ text: `Parts list: ${result.totals.printed.count} to print, ${result.totals.bought.count} to buy, ${result.totals.hardware.count} pieces of hardware. Pick a row to see it.`, error: false }),
};

// ---------------------------------------------------------------- the part of the scenario

export function scenario13(): boolean {
  const labels = build();
  return wholeList(labels) && copiesThatDiffer() && sixScrews() && mirroredFoot() && changedCopy() && withoutMass() && auxiliaryBody() && hardwareFollows(labels) && afterTheMotor() && inAnyPose() && asCsv(labels) && nothingToList() === PARTS_CSV.empty;
}
