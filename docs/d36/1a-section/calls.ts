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
import { QUERY_VIEWS, coordinatePrecision } from '../1b-measure/contract';
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
  // 19 loops of one span each: 14 whole circles and five curves on the faces of teeth, of 270
  //   (sun), 405 (a planet) and 720 (ring) points, 2205 together
  // the default budget of 500 takes the 19 spans and the teeth of the sun, the first that fit:
  //   truncated is { shown: 289, total: 2224 }; the other curves come with their count and
  //   length only
  const planet = section.bodies.find((body) => body.body === 'planet') ?? fail('the plane cuts the planet');
  return { cut: section.bodies.map((body) => body.body), planetArea: planet.area, shown: section.truncated?.shown ?? 0, total: section.truncated?.total ?? 0 };
}

// What an AI reads out of the housing in that section: one region, its outer loop the circle of
// the outer wall, and seven holes: six bolt holes as whole circles and the ring gear as a curve.
export function boltCircle(): { radius: number; holes: number[]; ringPoints: number } {
  const housing = unwrap(engine.query('section', { plane: XY, offset: 40, bodies: ['housing'] })).bodies[0];
  const region: SectionRegion = housing.regions?.[0] ?? fail('eight spans fit the budget');
  const outer = region.outer.spans?.[0];
  if (outer?.kind !== 'arc' || Math.abs(outer.sweep) !== 2 * Math.PI) return fail('the outer wall is one whole circle'); // radius 55, on housing/side/ho
  const circles = region.holes.flatMap((hole) => (hole.spans?.length === 1 && hole.spans[0].kind === 'arc' ? [hole.spans[0]] : []));
  const ring = region.holes.flatMap((hole) => (hole.spans ?? []).filter((span) => span.kind === 'curve' && sameFace(span.face, { feature: 'ring', role: 'side', curve: 'teeth' })));
  // holes: six of radius 1.7 whose centres are 50.5 from the origin; the ring: 720 points, not
  //   listed (8 spans and 720 points do not fit 500)
  return { radius: outer.radius, holes: circles.map((circle) => Math.hypot(circle.center[0], circle.center[1])), ringPoints: ring[0]?.kind === 'curve' ? ring[0].count : 0 };
}

// The teeth of one gear as points: the bodies are narrowed. The 405 points of a planet fit the
// default budget; the 720 of the ring gear need it raised.
export function teethAsPoints(): { planet: Vec2[]; ring: Vec2[] } {
  const curveOf = (loop: SectionLoop | undefined): Vec2[] => {
    const teeth = loop?.spans?.[0];
    return teeth?.kind === 'curve' ? (teeth.points ?? fail('the points fit the budget')) : fail('the teeth are a curve');
  };
  const planet = unwrap(engine.query('section', { plane: XY, offset: 40, bodies: ['planet'] })).bodies[0];
  const housing = unwrap(engine.query('section', { plane: XY, offset: 40, bodies: ['housing'], maxPoints: 1000 })).bodies[0];
  const ring = housing.regions?.[0].holes.find((hole) => hole.spans?.[0].kind === 'curve');
  return { planet: curveOf(planet.regions?.[0].outer), ring: curveOf(ring) };
}

// Along the axis: the base plane XZ. Everything is lines here (planes, and cylinders and teeth
// cut along their axis): 92 spans, so nothing is truncated. The motor is one rectangle of 90 by
// 26.5 (area 2385), the carrier one loop of 362.5; the housing has four regions.
export function alongTheAxis(): { areas: Record<Id, number>; onlyLines: boolean } {
  const section = unwrap(engine.query('section', { plane: { kind: 'base', plane: 'XZ' } }));
  const spans = section.bodies.flatMap((body) => (body.regions ?? []).flatMap((region) => [region.outer, ...region.holes].flatMap((loop) => loop.spans ?? [])));
  return { areas: Object.fromEntries(section.bodies.map((body) => [body.body, body.area])), onlyLines: spans.every((span) => span.kind === 'line') && section.truncated === undefined };
}

// A plane given by a face, cutting into the body: 1.5 mm below the front face of the housing,
// through the nut pockets (3 mm deep): 38 spans, the outer wall, the ring gear and six hexagons.
// With no offset the plane lies in that face and in the end caps of the planets and of the sun
// teeth. The section is taken just below the plane, so each of those bodies shows that face
// (the housing 6028.838, the front face with its pockets), and `inPlane` names the five bodies.
// Seen from the other side (`flip`), "below" is outside those bodies and none of them is cut.
export function belowTheFrontFace(): { pockets: number; inPlane: number; front: number; fromOutside: number } {
  const front: PlaneRef = { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'endCap' } };
  const below = unwrap(engine.query('section', { plane: front, offset: -1.5, bodies: ['housing'] }));
  const flush = unwrap(engine.query('section', { plane: front }));
  const flipped = unwrap(engine.query('section', { plane: front, flip: true, bodies: ['housing'] }));
  const holes = below.bodies[0].regions?.[0].holes ?? fail('38 spans fit the budget');
  const hexagons = holes.filter((hole) => (hole.spans ?? []).every((span) => span.kind === 'line')); // six, of six lines each
  const housing = flush.bodies.find((body) => body.body === 'housing') ?? fail('the housing ends in the plane from below');
  return { pockets: hexagons.length, inPlane: flush.inPlane.length, front: housing.area, fromOutside: flipped.bodies.length }; // 6, 5, 6028.838, 0
}

// Earlier on the timeline (before the ring gear is cut), and through MCP.
export const beforeTheRing = (): SectionOfBody[] => unwrap(engine.query('section', { plane: XY, offset: 40 }, { at: 'motorBore' })).bodies;
export const overMcp: QueryToolInput = { query: 'section', args: { plane: XY, offset: 40, bodies: ['housing', 'planet'] } };

// A budget of nothing: the answer is the bodies with their areas and the number of their loops.
export function onlyAreas(): { regions: boolean; loops: number } {
  const section = unwrap(engine.query('section', { plane: XY, offset: 40, maxPoints: 0 }));
  return { regions: section.bodies.some((body) => body.regions !== undefined), loops: section.bodies.reduce((sum, body) => sum + body.loops, 0) }; // false, 19
}
// A small budget goes to the outlines first: with 30, every body has its spans (19 of them, so
// the six bolt circles of the housing are there) and no curve has its points; truncated is
// { shown: 19, total: 2224 }. The teeth of the sun (270 points) do not take the housing's place.
export function outlinesFirst(): boolean {
  const section = unwrap(engine.query('section', { plane: XY, offset: 40, maxPoints: 30 }));
  return section.bodies.every((body) => body.regions !== undefined) && section.truncated?.shown === 19;
}

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
// Does a planar surface lie in the cutting plane: parallel within `ANGLE_TOLERANCE` and at its
// height within `precision`?
declare function liesIn(surface: Extract<Surface, { kind: 'plane' }>, frame: Frame, precision: number): boolean;
// Outer loops with the holes that lie in them.
declare function nested(loops: CutLoop[]): { outer: CutLoop; holes: CutLoop[] }[];
// The runs of segments of one face of a loop as spans, by the table of contract.ts; a curve
// comes with its points, and with its length summed from `lengths` of the loop (the length along
// the mesh polygon, as the length of the loop is).
declare function spansOf(loop: CutLoop, surfaceOf: (face: number) => Surface | undefined, nameOf: (face: number) => FaceNameAfter, frame: Frame): SectionSpan[];

// The plane a section was really taken at: the frame of the answer moved `below` against its
// normal. Whoever draws the cut (the section view of the app, the picture of 1f) clips the model
// at this plane and lays the fills into it, so the edge of the clipped mesh and the loops belong
// to one plane and meet. Clipping at the plane asked for would leave the two `below` apart, and
// on a wall that leans the outlines would differ by `below` times its slope. A function of the
// engine, next to the query, like `completeRegions`.
export function takenAt(result: SectionResult): Frame {
  const { frame, below } = result;
  return { ...frame, origin: [frame.origin[0] - below * frame.normal[0], frame.origin[1] - below * frame.normal[1], frame.origin[2] - below * frame.normal[2]] };
}

// The regions of a complete answer, each with its body; undefined when anything was left out.
// A caller that fills a cut (the section view of the app, the picture of 1f) fills only from
// this: a region filled without one of its holes would show material across a cavity. It is
// a function of the engine, next to the query and exported from the index of the package: the
// operation of 1f lives in packages/mcp, which cannot import the app.
export function completeRegions(result: SectionResult): { body: Id; region: SectionRegion }[] | undefined {
  if (result.truncated) return undefined;
  return result.bodies.flatMap((body) => (body.regions ?? []).map((region) => ({ body: body.body, region })));
}

export const section: (typeof QUERIES)['section'] = {
  title: 'Section',
  summary: 'What a plane cuts out of the bodies: closed loops with their areas and, for every piece of a loop, the face it lies on.',
  returns:
    'frame: the cutting plane (origin, x, y, normal); points are [u, v] in its x and y. below: how far under the plane, against its normal, the section was taken (mm; the precision of the coordinates of the bodies asked about). bodies: for every body the plane cuts, area (mm2), loops (how many) and regions, each with area, an outer loop and holes. The points of a loop are the corners of the polygon the mesh gives (points in line with their neighbours are left out, within the precision of the coordinates of the body); area and length are of that polygon before points are left out. A loop has area, length and spans: line, arc (center and radius of the exact surface, sweep in rad, positive counter-clockwise; a whole circle has from equal to to) or curve (count, length, and points while they fit; a curve that is a whole loop lists its corners once), each with the face it lies on and from and to (points of the mesh; an end of an arc where another face cuts it lies inside its circle, by no more than the chord tolerance on a model of ordinary size). With outline polylines a loop has points instead of spans. inPlane: bodies with a face that lies in the cutting plane, one face each (such a body shows that face or nothing: move the offset). maxPoints is the budget of the answer: a span is one, a point is one, a loop written as a polyline is one; the outlines of all bodies are taken first, then the lists of points; what does not fit is left out whole (a body keeps area and loops, a curve count and length), and truncated says how much was listed of how much.',
  args: SECTION_ARGS,
  run(context, args) {
    const base = context.frame(args.plane);
    if ('problem' in base) throw new QueryFailure(base.problem === 'nonPlanarFace' ? 'failed' : 'notAvailable', base.problem === 'nonPlanarFace' ? 'the face is not planar' : 'the plane is not in this state', ['plane']);
    const frame = placed(base, args.offset, args.flip === true);
    const ids = args.bodies ?? Object.keys(context.bodies);
    const names = context.state.evaluation.faceNames;
    // How far under the plane the cut is taken: one number for the call, over all bodies asked
    // about. (Geometry only from the context: the same code answers for a pose.)
    const below = coordinatePrecision(...ids.map((id) => context.bodies[id]));
    const polylines = args.outline === 'polylines';
    const budget = { left: args.maxPoints, shown: 0, total: 0 };
    // `count` items of the answer, when they still fit the budget
    const fits = (count: number): boolean => {
      budget.total += count;
      if (count > budget.left) return false;
      budget.left -= count;
      budget.shown += count;
      return true;
    };
    const result: SectionResult = { frame, below, bodies: [], inPlane: [] };
    // The first round, over the bodies in their order: the cut of each, and its outline (its
    // spans, or with polylines its loops) against the budget.
    const outlined: { entry: SectionOfBody; loops: CutLoop[]; spansIn: (loop: CutLoop) => SectionSpan[] }[] = [];
    for (const id of ids) {
      const body = context.bodies[id];
      const flush = body.faces.find((face) => {
        const surface = context.surface(id, names[face.id]);
        return surface?.kind === 'plane' && liesIn(surface, frame, below);
      });
      if (flush) result.inPlane.push({ body: id, face: names[flush.id] }); // at most one per body
      // the corners of a body are decided by its own precision, whatever else was asked about
      const loops = cut(body.solid, frame, below, coordinatePrecision(body));
      if (loops.length === 0) continue; // also a body of which only slivers under three corners were left
      const entry: SectionOfBody = { body: id, area: loops.reduce((sum, loop) => sum + loop.area, 0), loops: loops.length }; // holes are negative
      result.bodies.push(entry);
      const spans = new Map(loops.map((loop) => [loop, polylines ? [] : spansOf(loop, (face) => context.surface(id, names[face]), (face) => names[face], frame)]));
      const spansIn = (loop: CutLoop): SectionSpan[] => spans.get(loop) ?? [];
      if (fits(polylines ? loops.length : loops.reduce((sum, loop) => sum + spansIn(loop).length, 0))) outlined.push({ entry, loops, spansIn });
      // a body without its outline lists no points either; they are still counted
      else budget.total += loops.reduce((sum, loop) => sum + (polylines ? loop.points.length : spansIn(loop).reduce((points, span) => points + (span.kind === 'curve' ? span.count : 0), 0)), 0);
    }
    // The second round, in the same order: the lists of points, each whole or not at all. The
    // points of an early body can no longer cost a later body its outline.
    for (const { entry, loops, spansIn } of outlined) {
      const write = (loop: CutLoop): SectionLoop => {
        const head = { area: Math.abs(loop.area), length: loop.lengths.reduce((sum, length) => sum + length, 0) };
        if (polylines) return fits(loop.points.length) ? { ...head, points: loop.points } : head;
        return { ...head, spans: spansIn(loop).map((span) => (span.kind === 'curve' && !fits(span.count) ? { ...span, points: undefined } : span)) };
      };
      entry.regions = nested(loops).map(({ outer, holes }) => ({ area: outer.area + holes.reduce((sum, hole) => sum + hole.area, 0), outer: write(outer), holes: holes.map(write) }));
    }
    return budget.shown < budget.total ? { ...result, truncated: { shown: budget.shown, total: budget.total } } : result;
  },
};
export const registered: Pick<typeof QUERIES, 'section'> = { section };
export const FIXTURE: { args: QueryArgs<'section'> } = { args: { plane: XY } };

// ---------------------------------------------------------------- c. the section view of the app

// The view asks for polylines with a budget far above any model the app can show, cuts the
// scene away on the side the normal points to and fills the cut: one fill per region, the outer
// loop first and its holes after it, which is the shape `fills` of the scene takes today.
// - The model is clipped at the plane the section was taken at (`takenAt`), and the fills and
//   the outline are laid into that plane.
// - A cut is filled only from a complete answer. If the answer was truncated, a loop is missing
//   somewhere, and a region filled without one of its holes would show material across
//   a cavity. The view then clips the model, fills nothing and says so.
// - Every fill and every outline names its body, so the scene leaves out those of a body the
//   user has hidden (1b), as it leaves out the body.
// - The view gets the arguments of the form (1b), so a step of the offset asks with those and
//   what `prepare` adds never shows in the form.
const flat = (list: Vec2[]): number[] => list.flatMap((point) => [point[0], point[1]]);
const inModel = (frame: Frame, point: Vec2): Vec3 => [0, 1, 2].map((k) => frame.origin[k] + point[0] * frame.x[k] + point[1] * frame.y[k]) as Vec3;
export const drawnArgs = (args: QueryArgs<'section'>): QueryArgs<'section'> => ({ ...args, outline: 'polylines', maxPoints: 1_000_000 });

export const sectionView: QueryView<'section'> = {
  prepare: drawnArgs,
  answer(result, args, panel) {
    const row = (text: string): HTMLElement => Object.assign(document.createElement('p'), { textContent: text });
    // stepping the plane along its normal asks again with the arguments of the form
    const step = (by: number): HTMLElement => {
      const button = Object.assign(document.createElement('button'), { textContent: by > 0 ? '+1 mm' : '−1 mm' });
      button.onclick = () => panel.ask({ ...args, offset: (args.offset ?? 0) + by });
      return button;
    };
    return [
      ...result.bodies.map((body) => row(`${panel.bodyName(body.body)}: ${panel.number(body.area, 'mm2')} in ${body.regions?.length ?? body.loops} ${body.regions ? 'piece(s)' : 'loop(s)'}`)),
      ...result.inPlane.map((entry) => row(`${panel.bodyName(entry.body)}: ${panel.faceLabel(entry.face)} lies in the cutting plane`)),
      ...(result.truncated ? [row('The section is too large to draw: the cut is not filled.')] : []),
      step(-1),
      step(1),
    ];
  },
  scene(result): Partial<SceneAdditions> {
    const frame = takenAt(result);
    const clip = { origin: frame.origin, normal: frame.normal };
    const regions = completeRegions(result);
    if (!regions) return { clip };
    const loopsOf = (region: SectionRegion): SectionLoop[] => [region.outer, ...region.holes];
    const outline = (region: SectionRegion): number[] => loopsOf(region).flatMap((loop) => (loop.points ?? []).flatMap((point, i, list) => [...inModel(frame, point), ...inModel(frame, list[(i + 1) % list.length])]));
    return {
      clip,
      fills: regions.map(({ body, region }) => ({ frame, loops: loopsOf(region).map((loop) => flat(loop.points ?? [])), color: 0x7a8794, opacity: 1, body })),
      lines: regions.map(({ body, region }) => ({ segments: outline(region), color: 0x20262d, width: 1.5, body })),
    };
  },
};
export const views: Pick<typeof QUERY_VIEWS, 'section'> = { section: sectionView };
