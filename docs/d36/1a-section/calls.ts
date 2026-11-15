// Package 1a written out as calls: its part of validation scenario 11 (a section through the
// gears of the robot joint of scenario 9), the entry of the query over the context, and the
// section view of the app. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that
// cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls
// that must not compile.
//
// The numbers in the comments were measured by a prototype of the pass over the model of
// scenario 9 (chord tolerance 0.01 mm); they become the expectations of the test in
// packages/scenarios.

import type { Frame, Id, PlaneRef, Vec2, Vec3 } from '../../../packages/engine/src/index';
import type { EngineAfter, FaceNameAfter, QueryArgs, QueryOutcome, QueryToolInput, Surface } from '../00-prep/contract';
import { QUERIES, QueryFailure } from '../00-prep/contract';
import type { QueryView, SceneAdditions } from '../1b-measure/contract';
import { QUERY_VIEWS } from '../1b-measure/contract';
import type { CutLoop, SectionLoop, SectionOfBody, SectionRegion, SectionResult, SectionSpan } from './contract';
import { SECTION_ARGS, cut } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const sameFace = (a: FaceNameAfter, b: FaceNameAfter): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- a. scenario 11: a section through the gears

// Across the axis at z = 40: through the teeth of the sun, the three planets and the ring gear,
// and through the pins of the carrier. The motor and the plate lie below and are not listed.
export function throughTheGears(): { cut: Id[]; planetArea: number; shown: number; total: number } {
  const section: SectionResult = unwrap(engine.query('section', { plane: XY, offset: 40 }));
  // bodies: sun, planet, planets/1, planets/2, housing, carrier
  // areas: sun 190.354, each planet 431.379 (its volume over its height of 12), housing 6131.972,
  //   carrier 58.606 (three pins of 19.535)
  // the teeth are curves of 540 (sun), 810 (a planet) and 1440 (ring) points; none fits the
  //   default of 500, so truncated is { shown: 0, total: 4410 } and the curves come with their
  //   count and length only
  const planet = section.bodies.find((body) => body.body === 'planet') ?? fail('the plane cuts the planet');
  return { cut: section.bodies.map((body) => body.body), planetArea: planet.area, shown: section.truncated?.shown ?? 0, total: section.truncated?.total ?? 0 };
}

// What an AI reads out of the housing in that section: one region, its outer loop the circle of
// the outer wall, and seven holes: six bolt holes as whole circles and the ring gear as a curve.
export function boltCircle(): { radius: number; holes: number[]; ringPoints: number } {
  const housing = unwrap(engine.query('section', { plane: XY, offset: 40, bodies: ['housing'] })).bodies[0];
  const region: SectionRegion = housing.regions[0];
  const outer = region.outer.spans?.[0];
  if (outer?.kind !== 'arc' || Math.abs(outer.sweep) !== 2 * Math.PI) return fail('the outer wall is one whole circle'); // radius 55, on housing/side/ho
  const circles = region.holes.flatMap((hole) => (hole.spans?.length === 1 && hole.spans[0].kind === 'arc' ? [hole.spans[0]] : []));
  const ring = region.holes.flatMap((hole) => (hole.spans ?? []).filter((span) => span.kind === 'curve' && sameFace(span.face, { feature: 'ring', role: 'side', curve: 'teeth' })));
  // holes: six of radius 1.7 whose centres are 50.5 from the origin; the ring: 1440 points
  return { radius: outer.radius, holes: circles.map((circle) => Math.hypot(circle.center[0], circle.center[1])), ringPoints: ring[0]?.kind === 'curve' ? ring[0].count : 0 };
}

// The teeth of one planet as points: the budget is raised and the bodies narrowed.
export function planetTeeth(): Vec2[] {
  const planet = unwrap(engine.query('section', { plane: XY, offset: 40, bodies: ['planet'], maxPoints: 2000 })).bodies[0];
  const teeth = planet.regions[0].outer.spans?.[0];
  return teeth?.kind === 'curve' ? (teeth.points ?? fail('810 points fit a budget of 2000')) : fail('the teeth are a curve');
}

// Along the axis: the base plane XZ. Everything is lines here (planes, and cylinders and teeth
// cut along their axis), so nothing is truncated. The motor is one rectangle of 90 by 26.5 (area
// 2385), the carrier one loop of 362.5; the housing has four regions.
export function alongTheAxis(): { areas: Record<Id, number>; onlyLines: boolean } {
  const section = unwrap(engine.query('section', { plane: { kind: 'base', plane: 'XZ' } }));
  const spans = section.bodies.flatMap((body) => body.regions.flatMap((region) => [region.outer, ...region.holes].flatMap((loop) => loop.spans ?? [])));
  return { areas: Object.fromEntries(section.bodies.map((body) => [body.body, body.area])), onlyLines: spans.every((span) => span.kind === 'line') && section.truncated === undefined };
}

// A plane given by a face, cutting into the body: 1.5 mm below the front face of the housing,
// through the nut pockets (3 mm deep). With no offset the plane lies in that face, and in the
// end caps of the planets and of the sun teeth: `inPlane` says so.
export function belowTheFrontFace(): { pockets: number; inPlane: number } {
  const front: PlaneRef = { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'endCap' } };
  const below = unwrap(engine.query('section', { plane: front, offset: -1.5, bodies: ['housing'] }));
  const flush = unwrap(engine.query('section', { plane: front }));
  const hexagons = below.bodies[0].regions[0].holes.filter((hole) => (hole.spans ?? []).every((span) => span.kind === 'line')); // six, of six lines each
  return { pockets: hexagons.length, inPlane: flush.inPlane.length };
}

// Earlier on the timeline (before the ring gear is cut), and through MCP.
export const beforeTheRing = (): SectionOfBody[] => unwrap(engine.query('section', { plane: XY, offset: 40 }, { at: 'motorBore' })).bodies;
export const overMcp: QueryToolInput = { query: 'section', args: { plane: XY, offset: 40, bodies: ['housing', 'planet'] } };

// A face that is not planar cannot be the cutting plane.
export function notAPlane(): string {
  const outcome = engine.query('section', { plane: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'side', curve: 'ho' } } });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // failed in plane
}

// @ts-expect-error the plane is required
engine.query('section', { offset: 40 });
// @ts-expect-error the form of a loop is one of the two
engine.query('section', { plane: XY, outline: 'triangles' });

// ---------------------------------------------------------------- b. the entry, over the context

// The cutting plane as it is used: moved by the offset along its normal, then turned round.
declare function placed(frame: Frame, offset: number, flip: boolean): Frame;
// Does a planar surface lie in the cutting plane (parallel and at the same height, within the tolerances)?
declare function liesIn(surface: Extract<Surface, { kind: 'plane' }>, frame: Frame): boolean;
// Outer loops with the holes that lie in them.
declare function nested(loops: CutLoop[]): { outer: CutLoop; holes: CutLoop[] }[];
// The runs of segments of one face of a loop as spans, by the table of contract.ts.
declare function spansOf(loop: CutLoop, surfaceOf: (face: number) => Surface | undefined, nameOf: (face: number) => FaceNameAfter, frame: Frame): SectionSpan[];
declare function lengthOf(loop: CutLoop): number;

export const section: (typeof QUERIES)['section'] = {
  title: 'Section',
  summary: 'What a plane cuts out of the bodies: closed loops with their areas and, for every piece of a loop, the face it lies on.',
  returns:
    'frame: the cutting plane (origin, x, y, normal); points are [u, v] in its x and y. bodies: for every body the plane cuts, area (mm2) and regions, each with area, an outer loop and holes. A loop has area, length and spans: line, arc (center, radius, sweep in rad, positive counter-clockwise; a whole circle has from equal to to) or curve (count, length, and points while they fit maxPoints), each with the face it lies on and from and to. With outline polylines a loop has points instead of spans. inPlane: faces of the bodies that lie in the cutting plane (move the offset). truncated: how many points were listed of how many.',
  args: SECTION_ARGS,
  run(context, args) {
    const base = context.frame(args.plane);
    if ('problem' in base) throw new QueryFailure(base.problem === 'nonPlanarFace' ? 'failed' : 'notAvailable', base.problem === 'nonPlanarFace' ? 'the face is not planar' : 'the plane is not in this state', ['plane']);
    const frame = placed(base, args.offset, args.flip === true);
    const names = context.state.evaluation.faceNames;
    const points = { left: args.maxPoints, shown: 0, total: 0 };
    // a list of points, when it still fits the budget
    const listed = (list: Vec2[]): Vec2[] | undefined => {
      points.total += list.length;
      if (list.length > points.left) return undefined;
      points.left -= list.length;
      points.shown += list.length;
      return list;
    };
    const result: SectionResult = { frame, bodies: [], inPlane: [] };
    for (const id of args.bodies ?? Object.keys(context.bodies)) {
      const body = context.bodies[id]; // geometry only from the context: the same code answers for a pose
      for (const face of body.faces) {
        const surface = context.surface(id, names[face.id]);
        if (surface?.kind === 'plane' && liesIn(surface, frame)) result.inPlane.push({ body: id, face: names[face.id] });
      }
      const loops = cut(body.solid, frame);
      if (loops.length === 0) continue;
      const write = (loop: CutLoop): SectionLoop => {
        const head = { area: Math.abs(loop.area), length: lengthOf(loop) };
        if (args.outline === 'polylines') return { ...head, points: listed(loop.points) };
        const spans = spansOf(loop, (face) => context.surface(id, names[face]), (face) => names[face], frame);
        return { ...head, spans: spans.map((span) => (span.kind === 'curve' ? { ...span, points: listed(span.points ?? []) } : span)) };
      };
      const regions = nested(loops).map(({ outer, holes }) => ({ area: outer.area + holes.reduce((sum, hole) => sum + hole.area, 0), outer: write(outer), holes: holes.map(write) }));
      result.bodies.push({ body: id, area: regions.reduce((sum, region) => sum + region.area, 0), regions });
    }
    return points.shown < points.total ? { ...result, truncated: { shown: points.shown, total: points.total } } : result;
  },
};
export const registered: Pick<typeof QUERIES, 'section'> = { section };
export const FIXTURE: { args: QueryArgs<'section'> } = { args: { plane: XY } };

// ---------------------------------------------------------------- c. the section view of the app

// The view asks for polylines without a limit that matters, cuts the scene away on the side the
// normal points to and fills the cut: one fill per region, the outer loop first and its holes
// after it, which is the shape `fills` of the scene takes today.
const flat = (list: Vec2[]): number[] => list.flatMap((point) => [point[0], point[1]]);
const inModel = (frame: Frame, point: Vec2): Vec3 => [0, 1, 2].map((k) => frame.origin[k] + point[0] * frame.x[k] + point[1] * frame.y[k]) as Vec3;
export const drawnArgs = (args: QueryArgs<'section'>): QueryArgs<'section'> => ({ ...args, outline: 'polylines', maxPoints: 1_000_000 });

export const sectionView: QueryView<'section'> = {
  prepare: drawnArgs,
  answer(result, args, panel) {
    const row = (text: string): HTMLElement => Object.assign(document.createElement('p'), { textContent: text });
    // stepping the plane along its normal asks again; the form follows
    const step = (by: number): HTMLElement => {
      const button = Object.assign(document.createElement('button'), { textContent: by > 0 ? '+1 mm' : '−1 mm' });
      button.onclick = () => panel.ask({ ...args, offset: (args.offset ?? 0) + by });
      return button;
    };
    return [...result.bodies.map((body) => row(`${panel.bodyName(body.body)}: ${panel.number(body.area, 'mm2')} in ${body.regions.length} piece(s)`)), ...result.inPlane.map((entry) => row(`${panel.faceLabel(entry.face)} lies in the cutting plane`)), step(-1), step(1)];
  },
  scene(result): Partial<SceneAdditions> {
    const { frame } = result;
    const regions = result.bodies.flatMap((body) => body.regions);
    const loops = regions.flatMap((region) => [region.outer, ...region.holes]);
    const outline = loops.flatMap((loop) => (loop.points ?? []).flatMap((point, i, list) => [...inModel(frame, point), ...inModel(frame, list[(i + 1) % list.length])]));
    return {
      clip: { origin: frame.origin, normal: frame.normal },
      fills: regions.filter((region) => region.outer.points).map((region) => ({ frame, loops: [region.outer, ...region.holes].map((loop) => flat(loop.points ?? [])), color: 0x7a8794, opacity: 1 })),
      lines: [{ segments: outline, color: 0x20262d, width: 1.5 }],
    };
  },
};
export const views: Pick<typeof QUERY_VIEWS, 'section'> = { section: sectionView };
