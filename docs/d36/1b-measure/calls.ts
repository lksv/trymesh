// Package 1b written out as calls: its part of validation scenario 11 (the queries asked about
// the robot joint of scenario 9), the entry of the query over the context of the preparatory
// step, and the generic form of a query in the app with two views. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. Lines marked `@ts-expect-error` are calls that must not compile.
//
// The numbers in the comments were measured by a prototype of the passes over the model of
// scenario 9 (chord tolerance 0.01 mm); they become the expectations of the test in
// packages/scenarios.

import type { Id, Vec3 } from '../../../packages/engine/src/index';
import type { ArgPath, EdgeNameAfter, EngineAfter, FaceNameAfter, QueryArgs, QueryContext, QueryName, QueryOutcome, QueryToolInput } from '../00-prep/contract';
import { QUERIES, QueryFailure } from '../00-prep/contract';
import type { BodyEdgeExact, EntityShape, MeshPart, Measurement, QueryPanelState, QueryView, SceneAdditions, Selection, ShapedRef } from './contract';
import { CONTROLS, MEASURE_ARGS, MEASURE_UNITS, QUERY_UNITS, QUERY_VIEWS, askQuery, closest, entityShape, takeSelection } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));

const side = (feature: Id, curve: Id, copy?: { pattern: Id; index: number }): FaceNameAfter => ({ feature, role: 'side', curve, ...(copy ? { copy: [copy] } : {}) });
const face = (body: Id, name: FaceNameAfter): Extract<ShapedRef, { kind: 'face' }> => ({ kind: 'face', body, face: name });

// ---------------------------------------------------------------- a. scenario 11: the wall between the ring gear and the bolt holes

// The ring gear is a face of gear teeth (`swept`): it has no exact form, so the pair has no
// `distance`. It still has the smallest distance on the mesh, with what it is good to.
export function wallOnTheMesh(): { wall: number; accuracy: number; parallel: boolean } {
  const measured: Measurement = unwrap(engine.query('measure', { from: face('housing', side('ring', 'teeth')), to: face('housing', side('boltHole', 'bh')) }));
  // smallest.distance 15.2837 between (33.526, 0, 28) and (48.810, 0, 28); accuracy 0.02; angle 0
  return { wall: measured.smallest.distance, accuracy: measured.smallest.accuracy, parallel: measured.angle === 0 && measured.distance === undefined };
}

// The same wall exactly: the bolt hole is a cylinder, the axis of the gear goes through the
// origin of the gear sketch, and the root circle is a fact the generator published.
export function wallExactly(): number {
  const hole = unwrap(engine.query('measure', { from: { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' }, to: face('housing', side('boltHole', 'bh')) }));
  if (hole.to.is !== 'cylinder' || hole.distance === undefined) return fail('the bolt hole is a cylinder');
  const root = engine.getState().evaluation.features['ring'].facts?.rootDiameter;
  if (typeof root !== 'number') return fail('the ring gear publishes its root diameter');
  return hole.distance - hole.to.radius - root / 2; // 50.5 - 1.7 - 33.525 = 15.275
}

// Two holes of the pattern: the distance of their axes, exact (50.5: a sixth of the bolt circle).
export function pitchOfBoltHoles(): number | undefined {
  return unwrap(engine.query('measure', { from: face('housing', side('boltHole', 'bh')), to: face('housing', side('boltHole', 'bh', { pattern: 'bolts', index: 1 })) })).distance;
}

// Two planar faces that look away from each other: the solid part of the housing above the
// motor recess. distance 18, angle π, facing `away`: a wall 18 mm thick.
export function floorAboveTheMotor(): { thickness: number | undefined; wall: boolean } {
  const measured = unwrap(engine.query('measure', { from: face('housing', { feature: 'motorBore', role: 'endCap' }), to: face('housing', { feature: 'housing', role: 'endCap' }) }));
  return { thickness: measured.distance, wall: measured.facing === 'away' };
}

// A circular edge is read from its two surfaces: the mouth of a bolt hole in the seating face of
// the housing. Centre (50.5, 0, 0), radius 1.7, axis along Z, however few vertices the edge has.
export function mouthOfBoltHole(): EntityShape {
  const edge: EdgeNameAfter = { a: side('boltHole', 'bh'), b: { feature: 'housing', role: 'startCap' } };
  return unwrap(engine.query('measure', { from: { kind: 'edge', body: 'housing', edge }, to: { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' } })).from;
}
// The description of a body carries the same circle.
export const circleOfEdge = (edge: BodyEdgeExact): Vec3 | undefined => (edge.kind === 'circle' ? edge.circle.center : undefined);

// Through MCP: the general tool, also at a place on the timeline (before the pattern of the bolt
// holes only the first hole is there).
export const overMcp: QueryToolInput = { query: 'measure', args: { from: face('housing', side('ring', 'teeth')), to: face('housing', side('boltHole', 'bh')) }, at: 'boltHole' };

// A face that is not in the state asked about: the engine finds it before `run` and names the argument.
export function missingFace(): string {
  const outcome = engine.query('measure', { from: face('housing', side('nope', 'x')), to: face('housing', side('boltHole', 'bh')) });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // notAvailable in from,face
}

// @ts-expect-error a whole body is not measured here: that is the smallest gap of 1c
engine.query('measure', { from: { kind: 'body', body: 'housing' }, to: face('housing', side('boltHole', 'bh')) });
// @ts-expect-error both entities are required
engine.query('measure', { from: face('housing', side('boltHole', 'bh')) });

// ---------------------------------------------------------------- b. the entry, over the context

// The exact part: the table of contract.ts (reference and direction of each shape).
declare function exact(from: EntityShape, to: EntityShape): Pick<Measurement, 'distance' | 'angle' | 'facing'>;
declare function sameEdge(a: EdgeNameAfter, b: EdgeNameAfter): boolean; // `edgeKey` of util.ts

// The part of the mesh an entity is: read from the bodies of the context, so the same code
// answers for a pose.
function partOf(context: QueryContext, ref: ShapedRef, shape: EntityShape, arg: ArgPath): MeshPart {
  if (ref.kind === 'sketchPoint') return shape.is === 'point' ? { point: shape.at } : fail('a sketch point is a point');
  const body = context.bodies[ref.body]; // exists: checked before `run`
  if (ref.kind === 'face') {
    const number = context.face(ref.face);
    if (number === undefined) throw new QueryFailure('notAvailable', 'the face is not in this state', arg);
    return { solid: body.solid, face: number };
  }
  const edge = body.edges.find((candidate) => sameEdge(candidate.name, ref.edge));
  if (!edge) throw new QueryFailure('notAvailable', 'the edge is not in this state', arg);
  return { segments: edge.segments };
}

export const measure: (typeof QUERIES)['measure'] = {
  title: 'Measure',
  summary: 'Distance and angle between two faces, edges or sketch points. Exact for planes, cylinders, cones, straight and circular edges and sketch points; the smallest distance on the mesh for every pair.',
  returns:
    'from, to: what each entity is (plane with origin and normal out of the body, cylinder with a point of its axis, axis, radius and convex, circle with center, axis and radius, line with from, to and direction, point). distance (mm, exact): between the plane, the axis, the line, the centre or the point of the two; for two planes or a line and a plane only when parallel. angle (rad, exact): two planes 0 to π between the normals out of the bodies, a plane and an axis or a line 0 to π/2 between the line and the plane, otherwise 0 to π/2. facing: away (the two sides of a wall) or towards (the two walls of a slot), for planes that look opposite ways. smallest: the smallest distance between the two as they are on the bodies, measured on the mesh, with the two points and accuracy (mm).',
  args: MEASURE_ARGS,
  run(context, args) {
    const [from, to] = [entityShape(context, args.from, ['from']), entityShape(context, args.to, ['to'])];
    const found = closest(partOf(context, args.from, from, ['from']), partOf(context, args.to, to, ['to']));
    if (!found) throw new QueryFailure('failed', 'an entity has no geometry in this state');
    const onBody = [args.from, args.to].filter((ref) => ref.kind !== 'sketchPoint').length;
    const accuracy = onBody * context.state.document.settings.chordTolerance;
    return { from, to, ...exact(from, to), smallest: { distance: found.distance, from: found.a, to: found.b, accuracy } };
  },
};
export const registered: Pick<typeof QUERIES, 'measure'> = { measure };

// The fixture of the guard test: arguments of the query's own type.
export const FIXTURE: { args: QueryArgs<'measure'> } = { args: { from: face('a', { feature: 'a', role: 'startCap' }), to: face('a', { feature: 'a', role: 'endCap' }) } };

// The units of the result, where the generic form reads them (a stand-in, see contract.ts).
export const units: (typeof QUERY_UNITS)['measure'] = MEASURE_UNITS;

// ---------------------------------------------------------------- c. the generic form of a query in the app

// Asking by a name known at run time: the arguments are whatever the form holds, and the engine
// checks them. This is the one cast.
export const ask: typeof askQuery = (engine, name, args, at) => engine.query(name, args as never, at === null ? {} : { at });

// The form walked through for `measure`: opened from the menu of queries, both entities taken
// from selections in the view, asked at the marker, and what happens to the answer afterwards.
export function walk(marker: Id | null): string {
  const panel: QueryPanelState = { name: 'measure', draft: {}, armed: ['from'] };
  // the menu lists every query of the catalog; a query needs no entry anywhere to be there
  const menu: string[] = (Object.keys(QUERIES) as QueryName[]).map((name) => QUERIES[name].title);
  // every argument has a control, by its kind
  const controls = Object.values(MEASURE_ARGS).map((spec) => CONTROLS[spec.kind]); // selectionOrLists twice
  // a click on a face while `from` is armed fills it and arms the next entity; the app keeps no
  // selection of its own for a click the form took
  const first: Selection = { kind: 'face', body: 'housing', face: side('ring', 'teeth') };
  if (!takeSelection(panel, first)) return fail('the armed control takes a face');
  const second: Selection = { kind: 'face', body: 'housing', face: side('boltHole', 'bh') };
  takeSelection(panel, second);
  // the answer is kept with the place on the timeline it was asked at and with its arguments
  panel.answer = { at: marker, args: panel.draft, outcome: ask(engine, panel.name, panel.draft, marker) };
  // an error names the argument by its path; the control at that path is marked
  const marked: ArgPath | undefined = panel.answer.outcome.ok ? undefined : panel.answer.outcome.error.arg;
  // shown while the marker is where it was asked; dropped when the engine reports another document
  const shown = (now: Id | null): boolean => panel.answer !== undefined && panel.answer.at === now;
  const forget = engine.subscribe(() => (panel.answer = undefined));
  forget();
  return `${menu.length} queries, ${controls.join(' and ')}, ${shown(marker) ? 'shown' : 'hidden'}, ${marked === undefined ? 'no argument marked' : marked.join('/')}`;
}

// The view of `measure`: the two points of the smallest distance joined by a line with its
// length, the two entities highlighted, and the numbers with their units.
export const measureView: QueryView<'measure'> = {
  answer(result, _args, panel) {
    const row = (name: string, value: string): HTMLElement => Object.assign(document.createElement('p'), { textContent: `${name}: ${value}` });
    return [
      ...(result.distance === undefined ? [] : [row(result.facing === 'away' ? 'Thickness' : 'Distance', panel.number(result.distance, 'mm'))]),
      ...(result.angle === undefined ? [] : [row('Angle', panel.number(result.angle, 'rad'))]),
      row('Smallest distance', `${panel.number(result.smallest.distance, 'mm')} ± ${panel.number(result.smallest.accuracy, 'mm')}`),
    ];
  },
  scene(result, args, panel): Partial<SceneAdditions> {
    const { from, to, distance } = result.smallest;
    const faces = [args.from, args.to].flatMap((ref) => (ref.kind === 'face' ? [{ body: ref.body, face: ref.face, color: 0xffa000, opacity: 0.5 }] : []));
    return { lines: [{ segments: [...from, ...to], color: 0xffa000, width: 2, onTop: true }], points: [{ positions: [...from, ...to], color: 0xffa000, size: 6 }], labels: [{ at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], text: panel.number(distance, 'mm'), tone: 'reference' }], faces };
  },
};

// The collisions panel of today becomes the view of `interference`: the query is asked as soon
// as the form opens, the pairs are rows, a picked row highlights its two bodies, and the note in
// the status bar is the one of today.
export const interferenceView: QueryView<'interference'> = {
  immediate: true,
  answer(result, _args, panel) {
    return [...result.pairs, ...result.fits].map((pair, index) => {
      const row = Object.assign(document.createElement('div'), { className: `row ${panel.picked === index ? 'selected' : ''}`, textContent: `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: ${panel.number(pair.volume, 'mm3')}` });
      row.onclick = () => panel.pick(panel.picked === index ? undefined : index);
      return row;
    });
  },
  scene(result, _args, panel) {
    const pair = panel.picked === undefined ? undefined : [...result.pairs, ...result.fits][panel.picked];
    return pair ? { bodies: [pair.a, pair.b] } : {};
  },
  note: (result) => (result.pairs.length ? { text: `Collisions: ${result.pairs.length} pair(s) of bodies share a volume.`, error: true } : { text: `No collisions: ${result.checked} pair(s) checked.`, error: result.failed.length > 0 }),
};
export const views: Pick<typeof QUERY_VIEWS, 'measure' | 'interference'> = { measure: measureView, interference: interferenceView };
// @ts-expect-error a view is typed by the result of its query
export const misplaced: Pick<typeof QUERY_VIEWS, 'measure'> = { measure: interferenceView };
