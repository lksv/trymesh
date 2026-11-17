// Exact outlines of profiles: the outline of selected regions, an outline moved by an offset, the
// outline of a wall along a chain of curves, and their division into the polylines a tool is built
// from. The design is docs/d36/2a-offset/design.md; the rules are in docs/architecture/extrude.md.
//
// An outline is closed loops of exact curves (`OutlineCurve` of sketch.ts) with the material on the
// left of the travel: an outer loop runs counter-clockwise, a hole clockwise. A move never changes
// the topology: every curve maps to one curve, and what cannot be kept (a curve that vanishes,
// neighbours that no longer meet, loops that touch) is refused with a text that names the curves.
import { type CurveEnd, type Loop, type OutlineCurve, type Region, type SketchCurve, type SketchGeometry, curveEnds, placedCurve, pointJoins, polygonNesting, polygonProblem, segments, sketchCurves, soundTessellation, touchingCurves } from '../sketch';
import type { FaceName, Id, SketchFeature, Vec2 } from '../types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, cross2, dist2, dot2, has, len2, sub2, unreachable } from '../util';
import type { Outline, ProfileProblem, SideCurve } from './state';

const TAU = 2 * Math.PI;
type Open = Exclude<OutlineCurve, { type: 'circle' }>;

// What moves an outline, for the texts of the refusals: `subject` starts the sentence ("The offset
// of -3 mm"), `cure` says what to do about it.
export interface Move {
  subject: string;
  cure: string;
}
const refusal = (refs: Id[], message: string): ProfileProblem => ({ code: 'invalidProfile', refs: [...new Set(refs)], message });
const quoted = (ids: Id[]): string => [...new Set(ids)].map((id) => `"${id}"`).join(', ');
const isProblem = (value: object): value is ProfileProblem => 'code' in value;
// A number of a message: six digits are enough to recognise the value.
export const shown = (value: number): string => String(Number(value.toPrecision(6)));

// ---------------------------------------------------------------- geometry of a curve

const along = (p: Vec2, direction: Vec2, distance: number): Vec2 => [p[0] + direction[0] * distance, p[1] + direction[1] * distance];
const onCircle = (center: Vec2, radius: number, angle: number): Vec2 => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
// The direction of travel at the start or at the end of a curve, and the normal to its right.
function tangent(curve: Open, atEnd: boolean): Vec2 {
  if (curve.type === 'line') {
    const d = sub2(curve.to, curve.from);
    const length = len2(d);
    return [d[0] / length, d[1] / length];
  }
  const angle = curve.start + (atEnd ? curve.sweep : 0);
  const sense = Math.sign(curve.sweep);
  return [-sense * Math.sin(angle), sense * Math.cos(angle)];
}
const rightOf = (direction: Vec2): Vec2 => [direction[1], -direction[0]];
// An angle brought into (-π, π].
const wrapped = (angle: number): number => {
  const turned = ((angle % TAU) + TAU) % TAU;
  return turned > Math.PI ? turned - TAU : turned;
};
// The same curve passed the other way.
function reversed(curve: OutlineCurve): OutlineCurve {
  if (curve.type === 'circle') return { ...curve, forward: !curve.forward, ccw: !curve.ccw };
  const turned = { ...curve, forward: !curve.forward, from: curve.to, to: curve.from, ends: [curve.ends[1], curve.ends[0]] as [string, string] };
  return turned.type === 'arc' ? { ...turned, start: turned.start + turned.sweep, sweep: -turned.sweep } : turned;
}
// A loop with its vertices numbered by position: one per corner.
const numbered = (loop: OutlineCurve[]): OutlineCurve[] => loop.map((curve, i) => (curve.type === 'circle' ? curve : { ...curve, ends: [String(i), String((i + 1) % loop.length)] as [string, string] }));
const midpoint = (curve: OutlineCurve): Vec2 =>
  curve.type === 'circle' ? onCircle(curve.center, curve.radius, 0) : curve.type === 'line' ? [(curve.from[0] + curve.to[0]) / 2, (curve.from[1] + curve.to[1]) / 2] : onCircle(curve.center, curve.radius, curve.start + curve.sweep / 2);

// The signed area of a loop: the polygon of its corners plus the circular segments of its arcs.
function areaOf(loop: OutlineCurve[]): number {
  let area = 0;
  for (const curve of loop) {
    if (curve.type === 'circle') area += (curve.ccw ? 1 : -1) * Math.PI * curve.radius * curve.radius;
    else {
      area += cross2(curve.from, curve.to) / 2;
      if (curve.type === 'arc') area += (curve.radius * curve.radius * (curve.sweep - Math.sin(curve.sweep))) / 2;
    }
  }
  return area;
}

// Does a point lie inside a loop of exact curves? A ray in the direction +x; a curve is taken by
// pieces monotone in y with a half-open rule, so a pass through a vertex is not counted twice (the
// rule `detectProfile` finds holes by). The point must not lie on the loop.
function inside(p: Vec2, loop: OutlineCurve[]): boolean {
  let count = 0;
  const piece = (from: Vec2, to: Vec2, xAt: () => number): void => {
    if (from[1] > p[1] !== to[1] > p[1] && xAt() > p[0]) count++;
  };
  // an arc counter-clockwise from the angle `start`; the cuts are the top and the bottom of the circle
  const arc = (center: Vec2, radius: number, start: number, sweep: number, from: Vec2, to: Vec2): void => {
    const cuts = [Math.PI / 2, (3 * Math.PI) / 2].map((angle) => (((angle - start) % TAU) + TAU) % TAU).filter((offset) => offset > 0 && offset < sweep).sort((x, y) => x - y);
    const stops = [0, ...cuts, sweep];
    for (let i = 0; i + 1 < stops.length; i++) {
      const at = (offset: number): Vec2 => (offset === 0 ? from : offset === sweep ? to : onCircle(center, radius, start + offset));
      const right = Math.cos(start + (stops[i] + stops[i + 1]) / 2) > 0;
      piece(at(stops[i]), at(stops[i + 1]), () => center[0] + (right ? 1 : -1) * Math.sqrt(Math.max(0, radius * radius - (p[1] - center[1]) ** 2)));
    }
  };
  for (const curve of loop) {
    if (curve.type === 'line') piece(curve.from, curve.to, () => curve.from[0] + ((p[1] - curve.from[1]) / (curve.to[1] - curve.from[1])) * (curve.to[0] - curve.from[0]));
    else if (curve.type === 'circle') {
      const [top, bottom]: Vec2[] = [onCircle(curve.center, curve.radius, Math.PI / 2), onCircle(curve.center, curve.radius, (3 * Math.PI) / 2)];
      arc(curve.center, curve.radius, Math.PI / 2, Math.PI, top, bottom);
      arc(curve.center, curve.radius, (3 * Math.PI) / 2, Math.PI, bottom, top);
    } else if (curve.sweep > 0) arc(curve.center, curve.radius, curve.start, curve.sweep, curve.from, curve.to);
    else arc(curve.center, curve.radius, curve.start + curve.sweep, -curve.sweep, curve.to, curve.from);
  }
  return count % 2 === 1;
}

const loopsOf = (outline: Outline): OutlineCurve[][] => outline.regions.flatMap((region) => [region.outer, ...region.holes]);

// Which loop of an outline lies inside which, by the exact curves: `[i][j]` says that loop i lies
// inside loop j. The point asked about is the middle of a curve, which no other loop passes through
// (loops of a valid profile meet at joined points only).
export function nestingOf(outline: Outline): boolean[][] {
  const loops = loopsOf(outline);
  return loops.map((loop, i) => loops.map((other, j) => i !== j && inside(midpoint(loop[0]), other)));
}

// ---------------------------------------------------------------- the outline of a selection

// The outline of regions taken together, as a prism takes them for its side faces.
// 1. A curve that two of the regions have (once each, in opposite directions) is not part of it.
// 2. The rest is chained by vertices. Where several curves leave a vertex (regions that meet in
//    a point), the chain goes on along the loop it came by; when that curve was dropped as well,
//    the outline is refused.
// 3. A loop with a positive area is an outer loop; the others are holes of the smallest outer loop
//    that contains them.
export function selectionOutline(regions: Region[]): Outline | ProfileProblem {
  interface Piece {
    curve: OutlineCurve;
    loop: number;
    index: number;
    count: number;
  }
  const pieces: Piece[] = [];
  let loops = 0;
  for (const region of regions) {
    for (const loop of [region.outer, ...region.holes]) {
      const exact = loop.exact;
      if (!exact) return refusal([], 'The profile has no exact curves (a generated profile), so it has no outline that can be moved.');
      exact.forEach((curve, index) => pieces.push({ curve, loop: loops, index, count: exact.length }));
      loops++;
    }
  }
  const times = new Map<string, number>();
  for (const piece of pieces) times.set(piece.curve.key, (times.get(piece.curve.key) ?? 0) + 1);
  const kept = pieces.filter((piece) => times.get(piece.curve.key) === 1);
  const leaving = new Map<string, Piece[]>();
  for (const piece of kept) if (piece.curve.type !== 'circle') leaving.set(piece.curve.ends[0], [...(leaving.get(piece.curve.ends[0]) ?? []), piece]);

  const used = new Set<Piece>();
  const chains: OutlineCurve[][] = [];
  for (const first of kept) {
    if (used.has(first)) continue;
    const chain: OutlineCurve[] = [];
    for (let piece = first; ; ) {
      used.add(piece);
      chain.push(piece.curve);
      if (piece.curve.type === 'circle') break;
      const options = leaving.get(piece.curve.ends[1]) ?? [];
      const here: Piece = piece;
      const next = options.length === 1 ? options[0] : options.find((option) => option.loop === here.loop && option.index === (here.index + 1) % here.count);
      if (next === first) break;
      if (!next || used.has(next)) {
        return refusal([piece.curve.key, ...options.map((option) => option.curve.key)], `The selected regions meet in a point at the end of the curve ${quoted([piece.curve.key])} in a way their common outline cannot be followed through. Select regions that share whole curves, or draw the outline in the sketch.`);
      }
      piece = next;
    }
    chains.push(chain);
  }
  const outers = chains.filter((chain) => areaOf(chain) > 0).map((outer) => ({ outer, holes: [] as OutlineCurve[][], area: areaOf(outer) }));
  for (const hole of chains) {
    if (areaOf(hole) > 0) continue;
    const point = midpoint(hole[0]);
    const owner = outers.filter((region) => inside(point, region.outer)).sort((p, q) => p.area - q.area)[0];
    if (!owner) return refusal(hole.map((curve) => curve.key), `The outline of the selected regions has a hole (${quoted(hole.map((curve) => curve.key))}) that lies in none of its outer loops.`);
    owner.holes.push(hole);
  }
  return { regions: outers.map(({ outer, holes }) => ({ outer, holes })) };
}

// ---------------------------------------------------------------- the move of a chain

// Where two moved neighbours meet: the new corner between `before` (which ends at the corner) and
// `after` (which starts there). `radii` are the new radii of the two.
// - Tangent neighbours: the old corner moved along the common normal; no intersection is computed,
//   a tangent contact is a double root.
// - Two lines: the intersection of the moved lines.
// - A line and a circle, two circles: of the two intersections of the moved carriers the one on the
//   branch of the old corner (the same one in the order along the line; the one on the same side of
//   the line of centres). It is the corner that moves continuously with the distance.
// - A cusp (the neighbours touch and the loop turns back at the corner): the old corner is the
//   point of contact, which lies on the axis the two intersections mirror about, so it is on no
//   branch and its side would be read from noise. The wedge of material between the two curves
//   lies where the loop goes on, so the corner is the intersection in the direction of travel of
//   the curve that starts there.
function corner(before: Open, after: Open, d: number, radii: [number, number]): Vec2 | undefined {
  const [tb, ta] = [tangent(before, true), tangent(after, false)];
  const old = after.from;
  const touching = Math.abs(cross2(tb, ta)) <= Math.sin(ANGLE_TOLERANCE);
  const cusp = touching && dot2(tb, ta) < 0;
  if (touching && !cusp) {
    // the normal of a line where there is one: the moved line then passes through the corner exactly
    const normal = before.type === 'line' ? rightOf(tb) : after.type === 'line' ? rightOf(ta) : rightOf([(tb[0] + ta[0]) / 2, (tb[1] + ta[1]) / 2]);
    return along(old, normal, d / len2(normal));
  }
  if (before.type === 'line' && after.type === 'line') {
    const [pb, pa] = [along(before.from, rightOf(tb), d), along(after.from, rightOf(ta), d)];
    const denominator = cross2(tb, ta);
    if (Math.abs(denominator) <= 1e-12) return undefined;
    return along(pb, tb, cross2(sub2(pa, pb), ta) / denominator);
  }
  if (before.type === 'line' || after.type === 'line') {
    const [line, direction, round, radius] = before.type === 'line' ? [before, tb, after as Extract<Open, { type: 'arc' }>, radii[1]] : [after as Extract<Open, { type: 'line' }>, ta, before, radii[0]];
    const start = along(line.from, rightOf(direction), d);
    const foot = along(start, direction, dot2(sub2(round.center, start), direction));
    const half = radius * radius - dist2(foot, round.center) ** 2;
    if (half < 0) return undefined;
    const oldFoot = along(line.from, direction, dot2(sub2(round.center, line.from), direction));
    return along(foot, direction, Math.sign(cusp ? dot2(direction, ta) : dot2(sub2(old, oldFoot), direction)) * Math.sqrt(half));
  }
  const [p, q] = [before as Extract<Open, { type: 'arc' }>, after as Extract<Open, { type: 'arc' }>];
  const delta = sub2(q.center, p.center);
  const distance = len2(delta);
  if (distance <= LENGTH_TOLERANCE) return undefined;
  const u: Vec2 = [delta[0] / distance, delta[1] / distance];
  const reach = (distance * distance + radii[0] * radii[0] - radii[1] * radii[1]) / (2 * distance);
  const half = radii[0] * radii[0] - reach * reach;
  if (half < 0) return undefined;
  const across: Vec2 = [-u[1], u[0]];
  const side = Math.sign(cusp ? dot2(across, ta) : dot2(across, sub2(old, p.center)));
  const foot = along(p.center, u, reach);
  return along(foot, across, side * Math.sqrt(half));
}

// A chain of curves moved to the right of its travel by `d` (a negative `d` moves it to the left).
// A closed chain is a loop; an open one has a first and a last curve with one neighbour, whose free
// end moves along its own normal. The curves keep their keys; the vertices are numbered again, one
// per corner. `curveOf`: the sketch curve a key stands for, in the texts of a refusal. Refused:
// - a radius that is not above the length tolerance;
// - neighbours whose moved carriers do not meet;
// - a curve that turned round or has no length left: a line whose new ends are not in its old
//   direction by more than the tolerance; an arc whose new sweep has lost the sign of the old one,
//   is not longer than the tolerance along the arc, or exceeds a full turn.
export function movedChain(chain: OutlineCurve[], d: number, closed: boolean, move: Move, curveOf: (key: string) => Id = (key) => key): OutlineCurve[] | ProfileProblem {
  const refuse = (keys: string[], message: string): ProfileProblem => refusal(keys.map(curveOf), message);
  const shownAs = (keys: string[]): string => quoted(keys.map(curveOf));
  const [only] = chain;
  if (only.type === 'circle') {
    const radius = only.radius + (only.ccw ? d : -d);
    if (!(radius > LENGTH_TOLERANCE)) return refuse([only.key], `${move.subject} leaves no radius for the circle ${shownAs([only.key])} (its radius is ${shown(only.radius)} mm). ${move.cure}`);
    return [{ ...only, radius }];
  }
  const curves = chain as Open[];
  const n = curves.length;
  const radii = curves.map((curve) => (curve.type === 'arc' ? curve.radius + Math.sign(curve.sweep) * d : 0));
  const flat = curves.filter((curve, i) => curve.type === 'arc' && !(radii[i] > LENGTH_TOLERANCE));
  if (flat.length) {
    const smallest = Math.min(...flat.map((curve) => (curve.type === 'arc' ? curve.radius : Infinity)));
    return refuse(flat.map((curve) => curve.key), `${move.subject} leaves no radius for ${flat.length === 1 ? 'the arc' : 'the arcs'} ${shownAs(flat.map((curve) => curve.key))} (the smallest radius is ${shown(smallest)} mm), so ${flat.length === 1 ? 'it vanishes' : 'they vanish'}. ${move.cure}`);
  }
  // corners[i] is the new start of curve i; an open chain has one more, the end of its last curve
  const corners: Vec2[] = [];
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const before = closed ? curves[(i + n - 1) % n] : curves[i - 1];
    const after = closed ? curves[i] : curves[i];
    if (!before) corners.push(along(after.from, rightOf(tangent(after, false)), d));
    else if (!after) corners.push(along(before.to, rightOf(tangent(before, true)), d));
    else {
      const at = corner(before, after, d, [radii[(i + n - 1) % n], radii[i % n]]);
      if (!at) return refuse([before.key, after.key], `${move.subject} moves the curves ${shownAs([before.key, after.key])} so that they no longer meet. ${move.cure}`);
      corners.push(at);
    }
  }
  const out: OutlineCurve[] = [];
  const gone: Id[] = [];
  curves.forEach((curve, i) => {
    const [from, to] = [corners[i], corners[closed ? (i + 1) % n : i + 1]];
    const ends: [string, string] = [String(i), String(closed ? (i + 1) % n : i + 1)];
    if (curve.type === 'line') {
      if (!(dot2(sub2(to, from), tangent(curve, false)) > LENGTH_TOLERANCE)) gone.push(curve.key);
      out.push({ ...curve, from, to, ends });
      return;
    }
    const angleOf = (p: Vec2): number => Math.atan2(p[1] - curve.center[1], p[0] - curve.center[0]);
    const turnedStart = wrapped(angleOf(from) - curve.start);
    const sweep = curve.sweep + wrapped(angleOf(to) - (curve.start + curve.sweep)) - turnedStart;
    if (Math.sign(sweep) !== Math.sign(curve.sweep) || !(Math.abs(sweep) * radii[i] > LENGTH_TOLERANCE) || Math.abs(sweep) > TAU) gone.push(curve.key);
    out.push({ ...curve, from, to, ends, radius: radii[i], start: curve.start + turnedStart, sweep });
  });
  if (gone.length) return refuse(gone, `${move.subject} leaves no length for ${gone.length === 1 ? 'the curve' : 'the curves'} ${shownAs(gone)}: ${gone.length === 1 ? 'its' : 'their'} neighbours meet before ${gone.length === 1 ? 'it' : 'them'}, so ${gone.length === 1 ? 'it vanishes' : 'they vanish'}. ${move.cure}`);
  return out;
}

// An outline with every loop moved by `d`: positive grows the profile (outer loops move outwards,
// holes shrink), because the material is on the left of every loop and a loop moves to its right.
export function movedOutline(outline: Outline, d: number, move: Move, curveOf: (key: string) => Id = (key) => key): Outline | ProfileProblem {
  const regions: Outline['regions'] = [];
  for (const region of outline.regions) {
    const loops: OutlineCurve[][] = [];
    for (const loop of [region.outer, ...region.holes]) {
      const moved = movedChain(loop, d, true, move, curveOf);
      if (isProblem(moved)) return moved;
      loops.push(moved);
    }
    regions.push({ outer: loops[0], holes: loops.slice(1) });
  }
  return { regions };
}

// ---------------------------------------------------------------- polylines of an outline

// The number of pieces a curve is divided into by the rule of a sketch profile (`segments`, by the
// radius the curve has now): the points of a circle, the intervals of an arc, one for a line.
const piecesOf = (curve: OutlineCurve, chordTolerance: number): number =>
  curve.type === 'circle' ? segments(TAU, curve.radius, chordTolerance) : curve.type === 'arc' ? segments(Math.abs(curve.sweep), curve.radius, chordTolerance) : 1;

// A loop divided into a polyline, every curve into `counts[i]` pieces when given, otherwise by the
// rule of a sketch profile. Every vertex has a key of its own under `tag`.
function polyline(curves: OutlineCurve[], tag: string, chordTolerance: number, counts?: number[]): Loop {
  const out: Loop = { xy: [], keys: [], curves: [], exact: curves };
  curves.forEach((curve, i) => {
    const add = (p: Vec2, key: string): void => {
      out.xy.push(p[0], p[1]);
      out.keys.push(key);
      out.curves.push(curve.key);
    };
    const n = counts?.[i] ?? piecesOf(curve, chordTolerance);
    if (curve.type === 'circle') {
      for (let step = 0; step < n; step++) {
        const k = curve.ccw ? step : (n - step) % n;
        add(onCircle(curve.center, curve.radius, (TAU * k) / n), `${tag}:${i}:${k}`);
      }
      return;
    }
    add(curve.from, `${tag}:${i}`);
    if (curve.type !== 'arc') return;
    for (let step = 1; step < n; step++) add(onCircle(curve.center, curve.radius, curve.start + (curve.sweep * step) / n), `${tag}:${i}:${step}`);
  });
  return out;
}

// The regions a tool is built from, for an outline that was moved or put together here, or why
// they cannot be built. `nesting` is which loop has to lie inside which (`nestingOf` of the outline
// before the move). The tests, in this order:
// - the exact curves touch only at the corners they share, and the polylines do not cross (the two
//   checks of a sketch profile);
// - clearance, area and nesting of the polylines (`polygonProblem`, `polygonNesting` of sketch.ts).
// What passes is simple polygons, none without area, none touching another, every hole inside its
// outer loop.
// `curveOf`: the sketch curve a key of the outline stands for, for the texts and the references of
// a refusal. The keys of regions are the curves themselves; a wall has keys of its own.
// `counts`: the number of pieces of every curve, by loop (in the order of `loopsOf`) and curve, when
// it is not the rule of a sketch profile (the rings of a taper share their counts).
export function outlineRegions(outline: Outline, nesting: boolean[][], chordTolerance: number, move: Move, curveOf: (key: string) => Id = (key) => key, counts?: number[][]): Region[] | ProfileProblem {
  const named = (keys: string[]): Id[] => [...new Set(keys.map(curveOf))];
  const touching = touchingCurves(loopsOf(outline));
  if (touching) {
    const curves = named(touching.map((curve) => curve.key));
    // both sides of one curve of a wall: the wall is too thin, or folds onto itself along the curve
    const what = curves.length === 1 ? `the two sides of the curve ${quoted(curves)}` : `the curves ${quoted(curves)}`;
    return refusal(curves, `${move.subject} makes ${what} touch or cross where they are not joined. ${move.cure}`);
  }
  let at = 0;
  const regions = outline.regions.map((region, r): Region => ({
    ref: { outerLoop: [...new Set(region.outer.map((curve) => curve.key))].sort() },
    outer: polyline(region.outer, `o:${r}`, chordTolerance, counts?.[at++]),
    holes: region.holes.map((hole, h) => polyline(hole, `o:${r}:h${h}`, chordTolerance, counts?.[at++])),
  }));
  const loops = regions.flatMap((region) => [region.outer, ...region.holes]);
  const bad = polygonProblem(loops, regions.flatMap((region) => [1, ...region.holes.map(() => -1)]));
  if (bad) {
    const curves = named(bad.curves);
    const where = `${curves.length === 1 ? 'the curve' : 'the curves'} ${quoted(curves)}`;
    const text = bad.what === 'clearance' ? `brings the outline onto itself at ${where} (two stretches of it touch, cross or fold back)` : `leaves no area inside the loop of ${where}`;
    return refusal(curves, `${move.subject} ${text}. ${move.cure}`);
  }
  if (!soundTessellation(regions)) return refusal([], `${move.subject} makes the outline cross itself. ${move.cure}`);
  const after = polygonNesting(loops);
  const changed = after.findIndex((row, i) => row.some((value, j) => value !== nesting[i][j]));
  if (changed >= 0) return refusal(named(loops[changed].curves), `${move.subject} moves the loop of ${quoted(named(loops[changed].curves))} out of the loop it lay in, or into another. ${move.cure}`);
  return regions;
}

// The description of the side a curve of an outline makes: its surface is exact, a plane for a line
// (given in the direction of the sketch curve, whose start is the origin of a sketch on the face)
// and a cylinder for an arc and a circle.
export function sideShape(curve: OutlineCurve): SideCurve {
  if (curve.type !== 'line') return { type: 'round', center: curve.center, radius: curve.radius };
  return curve.forward ? { type: 'line', a: curve.from, b: curve.to } : { type: 'line', a: curve.to, b: curve.from };
}

// ---------------------------------------------------------------- the rings of a taper

// The outline of a tapered extrusion at the levels the tool is built from (D45; the rule is in
// docs/architecture/extrude.md, "Taper"). `near` holds at the start of the extent (level 0); the
// outline at the level `t` is `near` moved by `t · shift`, the far one (level 1) by all of it.
// - Every curve has one number of pieces in all rings: the largest the rule of a sketch profile
//   gives for it over the rings.
// - An arc whose start or sweep differs between the near and the far ring (a corner slides along
//   it) is divided for a quarter of the chord tolerance, and the number of intervals between the
//   two ends doubles until the centroid of every triangle of the sides of such arcs lies within
//   a third of the tolerance of its exact cone, at most `MAX_INTERVALS`. A third at the centroid
//   bounds the whole triangle by the tolerance (the deviation from a cone is convex over a flat
//   triangle with its corners on the cone). Other outlines have the two rings.
// - Every ring is checked like an outline moved by an offset.
// `moveAt(t)`: the texts of a refusal at the level `t`; `taper` the angle, for the measure.
export interface TaperRing {
  t: number;
  outline: Outline;
  regions: Region[];
}
export const MAX_INTERVALS = 64;
const SAME_ANGLE = 1e-9;
export function taperRings(near: Outline, shift: number, taper: number, chordTolerance: number, moveAt: (t: number) => Move, curveOf: (key: string) => Id = (key) => key): TaperRing[] | ProfileProblem {
  const nesting = nestingOf(near);
  const outlines = new Map<number, Outline>([[0, near]]);
  const outlineAt = (t: number): Outline | ProfileProblem => {
    const known = outlines.get(t);
    if (known) return known;
    const moved = movedOutline(near, t * shift, moveAt(t), curveOf);
    if (!isProblem(moved)) outlines.set(t, moved);
    return moved;
  };
  const far = outlineAt(1);
  if (isProblem(far)) return far;
  const nearLoops = loopsOf(near);
  const farLoops = loopsOf(far);
  // arcs whose corners slide: by loop and curve
  const sliding = nearLoops.map((loop, l) =>
    loop.map((curve, c) => {
      const other = farLoops[l][c];
      return curve.type === 'arc' && other.type === 'arc' && (Math.abs(wrapped(other.start - curve.start)) > SAME_ANGLE || Math.abs(other.sweep - curve.sweep) > SAME_ANGLE);
    }),
  );
  const anySliding = sliding.some((loop) => loop.some(Boolean));
  let levels: number[] = [0, 1];
  let rings: Outline[] = [near, far];
  let counts: number[][] = [];
  for (let intervals = 1; ; intervals *= 2) {
    levels = Array.from({ length: intervals + 1 }, (_, j) => j / intervals);
    const found = levels.map(outlineAt);
    const problem = found.find(isProblem);
    if (problem) return problem;
    rings = found as Outline[];
    counts = nearLoops.map((loop, l) => loop.map((_, c) => Math.max(...rings.map((ring) => piecesOf(loopsOf(ring)[l][c], sliding[l][c] ? chordTolerance / 4 : chordTolerance)))));
    if (!anySliding || intervals >= MAX_INTERVALS || deepest(rings, levels, sliding, counts, taper) <= chordTolerance / 3) break;
  }
  const out: TaperRing[] = [];
  for (let j = 0; j < levels.length; j++) {
    const regions = outlineRegions(rings[j], nesting, chordTolerance, moveAt(levels[j]), curveOf, counts);
    if (isProblem(regions)) return regions;
    out.push({ t: levels[j], outline: rings[j], regions });
  }
  return out;
}

// The largest distance of the centroid of a side triangle of a sliding arc from its exact cone, over
// every interval between two rings. The triangles are those the stack builds (`buildStack`): for
// the points P of the nearer ring and Q of the other, (P[k], P[k+1], Q[k+1]) and (P[k], Q[k+1], Q[k]).
// The distance is (r − R) · cos(taper) for the distance r of the centroid from the axis and the
// radius R of the cone at its level, which is linear in the level.
function deepest(rings: Outline[], levels: number[], sliding: boolean[][], counts: number[][], taper: number): number {
  const loops = rings.map(loopsOf);
  let worst = 0;
  sliding.forEach((loop, l) =>
    loop.forEach((slides, c) => {
      if (!slides) return;
      const n = counts[l][c];
      const pointsOf = (ring: number): Vec2[] => {
        const arc = loops[ring][l][c] as Extract<OutlineCurve, { type: 'arc' }>;
        return Array.from({ length: n + 1 }, (_, k) => (k === 0 ? arc.from : k === n ? arc.to : onCircle(arc.center, arc.radius, arc.start + (arc.sweep * k) / n)));
      };
      const [first, last] = [loops[0][l][c], loops[loops.length - 1][l][c]] as Extract<OutlineCurve, { type: 'arc' }>[];
      const radiusAt = (t: number): number => first.radius + t * (last.radius - first.radius);
      let p = pointsOf(0);
      for (let j = 0; j + 1 < rings.length; j++) {
        const q = pointsOf(j + 1);
        const [s, u] = [levels[j], levels[j + 1]];
        const measure = (a: Vec2, b: Vec2, d: Vec2, t: number): void => {
          const centroid: Vec2 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3];
          worst = Math.max(worst, Math.abs(dist2(centroid, first.center) - radiusAt(t)) * Math.cos(taper));
        };
        for (let k = 0; k < n; k++) {
          measure(p[k], p[k + 1], q[k + 1], (2 * s + u) / 3);
          measure(p[k], q[k + 1], q[k], (s + 2 * u) / 3);
        }
        p = q;
      }
    }),
  );
  return worst;
}

// ---------------------------------------------------------------- a wall along a chain

type SideName = Omit<Extract<FaceName, { role: 'wallSide' }>, 'feature' | 'copy'> | Omit<Extract<FaceName, { role: 'wallEnd' }>, 'feature' | 'copy'>;
export interface WallOutline {
  outline: Outline;
  nesting: boolean[][];
  sides: Map<string, { name: SideName; shape: SideCurve }>; // by the key of a curve of the outline
  // The sketch curve a key of the outline stands for: the curve of a side, the end curve of an end.
  curveOf: (key: string) => Id;
}

// The outline of a wall: own curves of a sketch that form one chain, moved by half the thickness to
// each side.
// - The curves are chained by joined end points (`pointJoins`, the rule of a sketch profile). An
//   open chain is walked from the free end with the smaller vertex key, a closed one
//   counter-clockwise.
// - Open: the right side forwards, a straight end, the left side backwards, a straight end. Closed
//   (a loop of curves, a circle): the right side is the outer loop and the left side its hole.
// - A side is named by its curve and by the side of the curve in the curve's own direction (a line
//   from `a` to `b`, an arc and a circle counter-clockwise, so `left` is the side of the centre);
//   an end by the point the end curve names there. The names do not depend on the order of the
//   curves or on the end the chain is walked from.
// A curve that is not in the sketch is a broken reference; curves that do not form one chain are
// an invalid profile.
export function wallOutline(sketch: SketchFeature, geometry: SketchGeometry, ids: Id[], thickness: number, move: Move): WallOutline | ProfileProblem {
  return wallOfCurves(new Map(sketchCurves(sketch, {}).map((curve) => [curve.id, curve])), pointJoins(sketch, geometry), geometry, ids, thickness, move);
}

// The wall over the curves of a sketch (`SketchState.curves`, D64) and its joins (`joinsOf`); only
// its own curves can be the curves of a wall.
export function wallOfCurves(sketchCurve: ReadonlyMap<Id, SketchCurve>, joins: (id: Id) => Id, geometry: SketchGeometry, ids: Id[], thickness: number, move: Move): WallOutline | ProfileProblem {
  const missing = ids.filter((id) => sketchCurve.get(id)?.source !== 'own');
  if (missing.length) return { code: 'brokenReference', refs: missing };
  const find = joins;
  const vertex = (id: Id): CurveEnd | undefined => (has(geometry.points, find(id)) ? { key: find(id), p: [geometry.points[find(id)].x, geometry.points[find(id)].y] } : undefined);
  const centre = (id: Id): Vec2 | undefined => (has(geometry.points, id) ? [geometry.points[id].x, geometry.points[id].y] : undefined);
  const chainHelp = 'A wall follows one chain of curves: each joined to the next at an end point, without a branch.';
  // the curves in their own direction, and the points they name at their two ends
  const own: OutlineCurve[] = [];
  const named = new Map<Id, [Id, Id]>();
  for (const id of ids) {
    const curve = sketchCurve.get(id) as SketchCurve;
    // the ends at their joined vertices, a centre as it is
    const placed = placedCurve(curve, geometry.radii, vertex, centre);
    if (!placed) return { code: 'brokenReference', refs: [id] };
    if (placed.type === 'circle') {
      if (!(placed.radius > LENGTH_TOLERANCE)) return refusal([id], `The circle ${quoted([id])} of the wall has no radius.`);
      own.push({ key: id, forward: true, type: 'circle', center: placed.center, radius: placed.radius, ccw: true });
      continue;
    }
    const { a, b } = placed;
    if (a.key === b.key || dist2(a.p, b.p) <= LENGTH_TOLERANCE) return refusal([id], `The curve ${quoted([id])} of the wall has no length.`);
    named.set(id, curveEnds(curve.shape) as [Id, Id]);
    const travel = { key: id, forward: true, from: a.p, to: b.p, ends: [a.key, b.key] as [string, string] };
    switch (placed.type) {
      case 'line':
        own.push({ ...travel, type: 'line' });
        break;
      case 'arc':
        if (!(placed.radius > LENGTH_TOLERANCE)) return refusal([id], `The arc ${quoted([id])} of the wall has no radius.`);
        own.push({ ...travel, type: 'arc', center: placed.center, radius: placed.radius, start: placed.start, sweep: placed.sweep });
        break;
      default:
        return unreachable(placed, 'curve');
    }
  }
  if (own.some((curve) => curve.type === 'circle') && own.length > 1) return refusal(ids, `A circle makes a wall by itself; the curves ${quoted(ids)} hold a circle and something else. ${chainHelp}`);

  // the chain: the curves in the order and the direction of the walk
  let chain: OutlineCurve[] = own;
  let closed = true;
  if (own[0].type !== 'circle') {
    const open = own as Open[];
    const at = new Map<string, Open[]>();
    for (const curve of open) for (const end of curve.ends) at.set(end, [...(at.get(end) ?? []), curve]);
    for (const [, list] of at) if (list.length > 2) return refusal(list.map((curve) => curve.key), `The curves ${quoted(list.map((curve) => curve.key))} of the wall meet in one point. ${chainHelp}`);
    const free = [...at.entries()].filter(([, list]) => list.length === 1).map(([key]) => key).sort();
    closed = free.length === 0;
    const first = closed ? [...open].sort((p, q) => (p.key < q.key ? -1 : 1))[0] : (at.get(free[0]) as Open[])[0];
    const walk: OutlineCurve[] = [];
    const seen = new Set<Open>();
    let from = closed ? first.ends[0] : free[0];
    for (let curve: Open | undefined = first; curve && !seen.has(curve); ) {
      seen.add(curve);
      const turned: Open = curve.ends[0] === from ? curve : (reversed(curve) as Open);
      walk.push(turned);
      from = turned.ends[1];
      const here: Open = curve;
      curve = (at.get(from) ?? []).find((other) => other !== here);
    }
    if (walk.length < open.length || free.length > 2) {
      const apart = open.filter((curve) => !seen.has(curve)).map((curve) => curve.key);
      return refusal(ids, `The curves of the wall are not connected: ${quoted(apart)} ${apart.length === 1 ? 'is' : 'are'} not joined to the chain of ${quoted(walk.map((curve) => curve.key))}. ${chainHelp}`);
    }
    chain = closed && areaOf(walk) < 0 ? walk.map(reversed).reverse() : walk;
  }

  const half = thickness / 2;
  const [right, left] = [movedChain(chain, half, closed, move), movedChain(chain, -half, closed, move)];
  if (isProblem(right)) return right;
  if (isProblem(left)) return left;
  // the keys of the faces: the side of a curve in its own direction, and the point of an end
  const sides: WallOutline['sides'] = new Map();
  const curves = new Map<string, Id>();
  const curveOf = (key: string): Id => curves.get(key) ?? key;
  const side = (curve: OutlineCurve, travelRight: boolean): OutlineCurve => {
    const name: SideName = { role: 'wallSide', curve: curve.key, side: travelRight === curve.forward ? 'right' : 'left' };
    const keyed = { ...curve, key: `${name.side === 'right' ? 'R' : 'L'}|${curve.key}` };
    sides.set(keyed.key, { name, shape: sideShape(keyed) });
    curves.set(keyed.key, curve.key);
    return keyed;
  };
  const outer = right.map((curve) => side(curve, true));
  const inner = left.map((curve) => side(curve, false));
  if (closed) return { outline: { regions: [{ outer, holes: [numbered(inner.map(reversed).reverse())] }] }, nesting: [[false, false], [true, false]], sides, curveOf };
  // A straight end, from the side of the travel it starts on to the other one. Its face is given
  // from the left of the end curve to its right in the curve's own direction, whichever way the
  // chain is walked.
  const end = (curve: Open, atEnd: boolean, from: Vec2, to: Vec2): OutlineCurve => {
    const point = (named.get(curve.key) as [Id, Id])[atEnd === curve.forward ? 1 : 0];
    const [leftCorner, rightCorner] = atEnd === curve.forward ? [to, from] : [from, to];
    const key = `E|${point}`;
    sides.set(key, { name: { role: 'wallEnd', point }, shape: { type: 'line', a: leftCorner, b: rightCorner } });
    curves.set(key, curve.key);
    return { key, forward: true, type: 'line', from, to, ends: ['', ''] };
  };
  const [firstRight, lastRight, firstLeft, lastLeft] = [outer[0] as Open, outer[outer.length - 1] as Open, inner[0] as Open, inner[inner.length - 1] as Open];
  const walk = chain as Open[];
  const loop = [...outer, end(walk[walk.length - 1], true, lastRight.to, lastLeft.to), ...inner.map(reversed).reverse(), end(walk[0], false, firstLeft.from, firstRight.from)];
  return { outline: { regions: [{ outer: numbered(loop), holes: [] }] }, nesting: [[false]], sides, curveOf };
}
