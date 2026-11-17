// Sketch tools (D35, point 7): pure functions that turn a few inputs into a batch of sketch
// commands. The app calls them from its drawing tools and the MCP server offers them as one tool
// whose description is generated from the catalog below, so a tool added here is at both places.
// Nothing here touches the recompute: a tool reads the sketch, its solved positions and, to change
// the features that name its curves in the same batch (the fillet), the document.
import { MAX_NUMBER, type NumberSpec, checkNumber } from './catalog';
import { documentIds } from './document';
import { CURVE_POINTS, constraintOperands, duplicateOf, entityOf } from './sketch-content';
import { evaluateNumber } from './expression';
import { namedBySections } from './sections/index';
import { pointJoins } from './sketch';
import type { Command, Constraint, Curve, CurvePointName, Document, Expr, FaceName, Feature, FeaturePatch, Id, ParameterResult, PlaneRef, Point2, ProfileSource, RegionRef, SketchFeature, SketchResult, Vec2 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, ORIGIN, cross2, dist2, dot2, has, sub2 } from './util';

// A place in a sketch and what it should snap to. The app passes a click after snapping, an AI
// client coordinates or an existing point.
export interface Anchor {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}

// The sketch a tool draws into, with its solved state: positions of points come from the result
// (projected geometry has them only there), otherwise from the document.
// `parameters` are the values of the parameters of the document (`evaluation.parameters`): with
// them a size given as an expression is drawn at its value, without them as clicked.
export interface SketchToolContext {
  sketch: SketchFeature;
  result?: SketchResult;
  parameters?: Record<string, ParameterResult>;
}

// Supplies IDs for new entities by a kind prefix (`p` point, `c` curve, `k` constraint). It must
// return IDs the whole document does not have; see `freshIds`.
export type NewId = (prefix: string) => Id;

// What `sketchTool` takes: the context of a sketch with the document it is in (D52). A tool that
// changes curves other features name (the fillet) reads the document to change those features in
// the same batch; the other tools do not read it. It is required, so that a fillet cannot be drawn
// without its patches. The functions that never read a document (`placeAnchor`, `anchorPosition`,
// `nearestCurvePoint`) take the plain context.
export interface SketchToolCall extends SketchToolContext {
  document: Document;
}

export interface SketchToolInputs {
  rectangle: { first: Anchor; opposite: Anchor };
  // `vertex` gives the size and the rotation. `sizeKind` and `size` add a dimension: the diameter
  // of the circumscribed circle, or the size across flats (an even number of sides only).
  polygon: { center: Anchor; vertex: Anchor; sides: number; sizeKind?: 'circumscribed' | 'acrossFlats'; size?: number | Expr };
  // `corner`: the point where two lines meet; `radius`: a number or an expression (D52).
  fillet: { corner: Id; radius: number | Expr };
}
export type SketchToolName = keyof SketchToolInputs;

export type SketchToolInput =
  | { kind: 'anchor' }
  // a point of the sketch by its ID: an own point or `origin`, not a point of projected geometry
  | { kind: 'point' }
  // `expression`: an expression over parameters is accepted too (it ends up in a dimension)
  | { kind: 'number'; spec: NumberSpec; optional?: boolean; expression?: boolean }
  | { kind: 'option'; options: readonly string[]; optional?: boolean };

export interface SketchToolSpec {
  title: string;
  summary: string;
  inputs: Record<string, SketchToolInput>;
  ids: Record<string, string>; // what the tool returns in `ids`, and in which order
}

export type SketchToolResult =
  | { ok: true; commands: Command[]; ids: Record<string, Id[]> } // the commands are sent as one batch
  | { ok: false; message: string }; // an input the tool cannot draw (both corners at one place)

export const MAX_POLYGON_SIDES = 64;

// The catalog: the single source of truth about the tools, their inputs and what they return.
export const SKETCH_TOOLS: Record<SketchToolName, SketchToolSpec> = {
  rectangle: {
    title: 'Rectangle',
    summary: 'A rectangle from two opposite corners: four lines, two horizontal and two vertical. Its width and height stay free.',
    inputs: { first: { kind: 'anchor' }, opposite: { kind: 'anchor' } },
    ids: {
      points: 'the corners: `first`, the corner beside it along x, `opposite`, the corner beside `first` along y',
      lines: '`lines[i]` goes from `points[i]` to `points[i + 1]`, the last one back to `points[0]`; even ones are horizontal',
      constraints: 'the constraints the tool added (horizontal, vertical and those of snapping)',
    },
  },
  polygon: {
    title: 'Regular polygon',
    summary:
      'A regular polygon: a construction circle around it, the vertices on the circle and all sides of the same length. Position, size and rotation stay free (4 degrees of freedom) unless the anchors snap or a size is given. `sizeKind` with `size` adds a dimension: the diameter of the circumscribed circle, or the size across flats (the wrench size of a nut; an even number of sides only). `sizeKind` alone dimensions the size as drawn. With a `size` the polygon is drawn at that size around `center`; when `vertex` snaps, the vertex keeps its place and a `center` that does not snap is drawn where the size holds, on the line from the vertex towards it. With both anchors snapped and a size far from their distance (ten times) the polygon may come out folded: give anchors that are about the size apart. The direction from `center` to `vertex` is the rotation: draw the polygon turned as it should be (with `vertex` straight right of the centre, `lines[1]` of a hexagon is horizontal) and add a constraint on a side only to hold it there. The same constraints also hold for folded polygons, and the solver may end in one when a later constraint or a change of the size asks for a big jump (a turn over about 30°, the size across flats several times larger or smaller): the sketch then has no region (`regions: 0`); undo the step and make it smaller. The dimension of the circumscribed circle takes any change.',
    inputs: {
      center: { kind: 'anchor' },
      vertex: { kind: 'anchor' },
      sides: { kind: 'number', spec: { title: 'Sides', unit: 'count', min: { value: 3 }, max: { value: MAX_POLYGON_SIDES }, integer: true } },
      sizeKind: { kind: 'option', options: ['circumscribed', 'acrossFlats'], optional: true },
      size: { kind: 'number', spec: { title: 'Size', unit: 'mm', min: { value: 0, open: true } }, optional: true, expression: true },
    },
    ids: {
      center: 'the centre point',
      circle: 'the circumscribed construction circle',
      points: 'the vertices: `points[0]` is `vertex`, the others follow counter-clockwise',
      lines: '`lines[i]` goes from `points[i]` to `points[i + 1]`, the last one back to `points[0]`',
      constraints: 'the constraints the tool added, without the size dimension',
      size: 'the size dimension, when one was asked for',
    },
  },
  fillet: {
    title: 'Fillet',
    summary:
      'A fillet of the corner where two lines meet: an arc of the given radius, tangent to both lines. The lines are shortened to the ends of the arc and keep their IDs, so the faces made from them keep their names. The corner point stays as the virtual corner, held on both lines: dimensions and constraints on it mean what they did, and a size of the outline is still measured between its sharp corners. `radius` becomes a radius dimension (`ids.radius`), a number or an expression; change it there. The arc is added to every region and wall of the document that passes the corner (`ids.patched`), in the same batch, so the features built on the sketch keep their profiles and get the round face named by the arc: `side` of an extrusion (a cylinder, or a cone when the extrusion is tapered), `wallSide` left and right of a wall. A region that has the corner only on the rim of a hole (a plate around a pocket) needs no patch, since a region is named by its outer loop: a feature that reads the corner through holes alone gets the round corner too and is in no list. Two lists name what reads the corner directly and is not patched; check them. `ids.moved`: sketches and plane features on a side face that starts at the corner (a side face starts where its line starts, at `a`); their plane has moved along the line, with everything dimensioned from its origin. `ids.shortened`: extrusions whose wall runs along one of the two lines only (the wall ends at the arc now), and sketches that project an edge of a side face of either line (the end of the projection at the corner has moved). Only features that read the corner directly are listed, by the names in the document: what is built on them follows them, and a listed feature may also be among the problems of the result. Refused: a point that is not the common end of exactly two lines (ends joined by a coincident constraint are two points: re-point one line onto the other point first, setCurvePoint), parallel lines, a radius the lines are too short for or one too small to draw, a line with an equalLength or midpoint constraint (it would measure the shortened line). A profile offset or a wall has to leave the arc a radius: an inward offset as large as the fillet is an error of that feature. Nothing keeps the arc a fillet afterwards: a later change that leaves it no room (a radius too large, a side too short) is often a conflict of the sketch or an invalid profile, but it can also be solved into an arc that runs past the end of a line, with no message and a body made from it, so look at the sketch after such a change. Of the curves that end at the corner the ones that are not construction curves are filleted; if there are none, the construction ones.',
    inputs: { corner: { kind: 'point' }, radius: { kind: 'number', spec: { title: 'Radius', unit: 'mm', min: { value: 0, open: true } }, expression: true } },
    ids: {
      arc: 'the arc',
      center: 'the centre point of the arc',
      lines: 'the two lines that were shortened, in the order of their IDs',
      ends: 'the ends of the arc: `ends[i]` is the new end of `lines[i]`',
      constraints: 'the constraints the tool added, without the radius dimension: the tangency of `lines[0]`, of `lines[1]`, the corner on `lines[0]`, on `lines[1]` (a corner already held on a line keeps that constraint, and it is the one named)',
      radius: 'the radius dimension',
      patched: 'the features whose region or wall named both lines and was given the arc, in the order of the timeline (empty when there are none; a feature that reads the corner only through the hole of a region needs no patch and is not here)',
      moved: 'sketches and plane features on a side face that starts at the corner: their plane moved with the start of its line (empty when there are none)',
      shortened: 'features that read a line of the two by itself: extrusions whose wall runs along one of them, sketches that project an edge of a side face of either (empty when there are none)',
    },
  },
};

// Points closer than this are one point for drawing: a curve between them would have no length
// and would make the profile of the sketch invalid.
const SAME_PLACE = 1e-6;
const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- geometry of the sketch

type Shape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'circle'; center: Vec2; radius: number } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number };

function pointAt(context: SketchToolContext, id: Id): Vec2 | undefined {
  const solved = context.result?.points;
  const p = solved && has(solved, id) ? solved[id] : id === ORIGIN ? { x: 0, y: 0 } : has(context.sketch.points, id) ? context.sketch.points[id] : undefined;
  return p ? [p.x, p.y] : undefined;
}

// The shape of an own or a projected curve; undefined when the sketch has no position for it.
function shapeOf(context: SketchToolContext, id: Id): Shape | undefined {
  const { sketch, result } = context;
  if (has(sketch.curves, id)) {
    const curve = sketch.curves[id];
    if (curve.type === 'line') {
      const [a, b] = [pointAt(context, curve.a), pointAt(context, curve.b)];
      return a && b ? { type: 'line', a, b } : undefined;
    }
    const center = pointAt(context, curve.center);
    if (!center) return undefined;
    if (curve.type === 'circle') {
      const radius = result && has(result.radii, id) ? result.radii[id] : sketch.radii[id];
      return radius === undefined ? undefined : { type: 'circle', center, radius };
    }
    const [start, end] = [pointAt(context, curve.start), pointAt(context, curve.end)];
    if (!start || !end) return undefined;
    const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const turn = (((Math.atan2(end[1] - center[1], end[0] - center[0]) - from) % TAU) + TAU) % TAU;
    return { type: 'arc', center, radius: dist2(center, start), from, sweep: turn || TAU };
  }
  if (has(sketch.external, id)) {
    if (sketch.external[id].kind === 'line') {
      const [a, b] = [pointAt(context, `${id}/a`), pointAt(context, `${id}/b`)];
      return a && b ? { type: 'line', a, b } : undefined;
    }
    const center = pointAt(context, `${id}/center`);
    return center && result && has(result.radii, id) ? { type: 'circle', center, radius: result.radii[id] } : undefined;
  }
  return undefined;
}

function closestOn(shape: Shape, p: Vec2): Vec2 {
  if (shape.type === 'line') {
    const [dx, dy] = [shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]];
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - shape.a[0]) * dx + (p[1] - shape.a[1]) * dy) / length2));
    return [shape.a[0] + t * dx, shape.a[1] + t * dy];
  }
  const { center, radius } = shape;
  let angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
  if (shape.type === 'arc') {
    const along = (((angle - shape.from) % TAU) + TAU) % TAU;
    // outside the arc: the nearer of its two ends
    if (along > shape.sweep) angle = along - shape.sweep < TAU - along ? shape.from + shape.sweep : shape.from;
  }
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

// Where a snapped anchor really lies: on the point or on the curve it snapped to.
export function anchorPosition(context: SketchToolContext, anchor: Anchor): Vec2 {
  if (anchor.snap?.kind === 'point') return pointAt(context, anchor.snap.id) ?? anchor.at;
  if (anchor.snap?.kind === 'curve') {
    const shape = shapeOf(context, anchor.snap.id);
    return shape ? closestOn(shape, anchor.at) : anchor.at;
  }
  return anchor.at;
}

export interface Placed {
  id: Id; // the point a curve may refer to
  commands: Command[];
  constraints: Id[]; // the constraints among the commands
}

// The point for an end of a curve. An own point and the origin are used again. A curve must not
// refer to a point of projected geometry, so a new point with a coincident constraint is made
// there. Snapping to a curve adds a point-on-curve constraint.
export function placeAnchor(context: SketchToolContext, anchor: Anchor, newId: NewId): Placed {
  const sketch = context.sketch.id;
  const snap = anchor.snap;
  if (snap?.kind === 'point' && (snap.id === ORIGIN || has(context.sketch.points, snap.id))) return { id: snap.id, commands: [], constraints: [] };
  const id = newId('p');
  const at = anchorPosition(context, anchor);
  const commands: Command[] = [{ type: 'addPoint', sketch, id, x: at[0], y: at[1] }];
  if (!snap) return { id, commands, constraints: [] };
  const constraint = newId('k');
  commands.push({ type: 'addConstraint', sketch, id: constraint, constraint: snap.kind === 'point' ? { type: 'coincident', a: id, b: snap.id } : { type: 'pointOnCurve', point: id, curve: snap.id } });
  return { id, commands, constraints: [constraint] };
}

// ---------------------------------------------------------------- checking the inputs

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function anchorProblem(context: SketchToolContext, v: unknown): string | undefined {
  if (!isObject(v)) return 'an anchor `{ at: [x, y], snap? }` is expected';
  for (const key of Object.keys(v)) if (key !== 'at' && key !== 'snap') return `an anchor has no field "${key}"`;
  const at = v.at;
  if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number' && Number.isFinite(n))) return '`at` must be two finite numbers `[x, y]`';
  if (!at.every((n) => Math.abs(n) <= MAX_NUMBER)) return `\`at\` is out of the range ±${MAX_NUMBER}`;
  if (v.snap === undefined) return undefined;
  const snap = v.snap;
  if (!isObject(snap) || (snap.kind !== 'point' && snap.kind !== 'curve') || typeof snap.id !== 'string' || Object.keys(snap).some((key) => key !== 'kind' && key !== 'id')) return '`snap` must be `{ kind: "point" | "curve", id }`';
  const entity = entityOf(context.sketch, snap.id);
  if (!entity) return `the sketch has no entity "${snap.id}" to snap to`;
  if ((entity.kind === 'point') !== (snap.kind === 'point')) return `"${snap.id}" is a ${entity.kind}, not a ${snap.kind}`;
  const known = snap.kind === 'point' ? pointAt(context, snap.id) : shapeOf(context, snap.id);
  return known ? undefined : `"${snap.id}" has no solved position to snap to`;
}

// A point given by its ID, checked like the snap of an anchor: the sketch has the entity, it is
// a point, it is not a point of projected geometry, and it has a solved position.
function pointProblem(context: SketchToolContext, v: unknown): string | undefined {
  if (typeof v !== 'string') return 'the ID of a point of the sketch is expected';
  const entity = entityOf(context.sketch, v);
  if (!entity) return `the sketch has no point "${v}"`;
  if (entity.kind !== 'point') return `"${v}" is a ${entity.kind}, not a point`;
  if (!entity.own && v !== ORIGIN) return `"${v}" is a point of projected geometry; give an own point of the sketch`;
  return pointAt(context, v) ? undefined : `"${v}" has no solved position`;
}

// The inputs against the catalog; the first problem as text.
function inputProblem(spec: SketchToolSpec, context: SketchToolContext, input: unknown): string | undefined {
  if (!isObject(input)) return 'the input of a tool must be an object';
  for (const key of Object.keys(input)) if (!has(spec.inputs, key)) return `${spec.title} has no input "${key}"; it takes ${Object.keys(spec.inputs).join(', ')}`;
  for (const [name, kind] of Object.entries(spec.inputs)) {
    const value = input[name];
    if (value === undefined) {
      if (kind.kind === 'anchor' || kind.kind === 'point' || !kind.optional) return `the input "${name}" is missing`;
      continue;
    }
    if (kind.kind === 'anchor') {
      const problem = anchorProblem(context, value);
      if (problem) return `${name}: ${problem}`;
    } else if (kind.kind === 'point') {
      const problem = pointProblem(context, value);
      if (problem) return `${name}: ${problem}`;
    } else if (kind.kind === 'option') {
      if (typeof value !== 'string' || !kind.options.includes(value)) return `${name}: one of ${kind.options.join(', ')} is expected`;
    } else if (typeof value === 'string') {
      if (!kind.expression) return `${name}: a number is expected, not an expression`;
      if (value.trim() === '') return `${name}: the expression is empty`;
    } else {
      if (typeof value !== 'number') return `${name}: a number is expected`;
      const checked = checkNumber(value, kind.spec);
      if (!checked.ok) return `${name}: ${checked.message}`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- the tools

const failed = (message: string): SketchToolResult => ({ ok: false, message });

function rectangle(context: SketchToolContext, input: SketchToolInputs['rectangle'], newId: NewId): SketchToolResult {
  const sketch = context.sketch.id;
  const a = placeAnchor(context, input.first, newId);
  const c = placeAnchor(context, input.opposite, newId);
  const [pa, pc] = [anchorPosition(context, input.first), anchorPosition(context, input.opposite)];
  if (a.id === c.id || Math.abs(pa[0] - pc[0]) <= SAME_PLACE || Math.abs(pa[1] - pc[1]) <= SAME_PLACE) return failed('the two corners must differ in both coordinates');
  const [b, d] = [newId('p'), newId('p')];
  const points = [a.id, b, c.id, d];
  const commands: Command[] = [...a.commands, ...c.commands, { type: 'addPoint', sketch, id: b, x: pc[0], y: pa[1] }, { type: 'addPoint', sketch, id: d, x: pa[0], y: pc[1] }];
  const lines: Id[] = [];
  const constraints: Id[] = [...a.constraints, ...c.constraints];
  points.forEach((corner, i) => {
    const [line, constraint] = [newId('c'), newId('k')];
    lines.push(line);
    constraints.push(constraint);
    commands.push({ type: 'addCurve', sketch, id: line, curve: { type: 'line', a: corner, b: points[(i + 1) % 4] } });
    commands.push({ type: 'addConstraint', sketch, id: constraint, constraint: { type: i % 2 === 0 ? 'horizontal' : 'vertical', line } });
  });
  return { ok: true, commands, ids: { points, lines, constraints } };
}

function polygon(context: SketchToolContext, input: SketchToolInputs['polygon'], newId: NewId): SketchToolResult {
  const sketch = context.sketch.id;
  const sides = Math.round(input.sides);
  const sizeKind = input.sizeKind ?? (input.size === undefined ? undefined : 'circumscribed');
  if (sizeKind === 'acrossFlats' && sides % 2 === 1) return failed('the size across flats needs an even number of sides; an odd polygon is sized by its circumscribed circle');
  let pc = anchorPosition(context, input.center);
  const pv = anchorPosition(context, input.vertex);
  let centre = input.center;
  let radius = dist2(pc, pv);
  if (!(radius > SAME_PLACE)) return failed('the centre and the vertex are at the same place');
  // The size across flats of the polygon with the circumradius 1.
  const flats = 2 * Math.cos(Math.PI / sides);
  // The value of the dimension and the size the polygon is drawn at.
  // - A size that is given (a number, or an expression the parameters give a value to) is also
  //   the drawn size: the solver then starts from a polygon that already holds, and a start far
  //   from the dimension is what folds a polygon.
  // - A vertex that snaps keeps its place. With a centre that does not snap the centre is drawn
  //   where the size holds, on the line from the vertex to where it was given. With both
  //   snapping the start cannot hold: the other vertices are drawn at the larger of the two
  //   sizes, the given one and the drawn one, which is the start that did not fold in the runs
  //   of the review; the solver brings the rest together, or reports the conflict when neither
  //   place can move.
  // - Without a size the dimension takes the size as drawn. With a free vertex it is rounded and
  //   the polygon drawn at the rounded size; a vertex that snaps is where it is, so the dimension
  //   is not rounded (a rounded one would contradict a vertex that cannot move).
  let value: number | Expr | undefined;
  if (sizeKind) {
    const across = sizeKind === 'circumscribed' ? 2 : flats;
    const drawn = across * radius;
    const rounded = Math.round(drawn * 100) / 100;
    value = input.size ?? (input.vertex.snap || !(rounded > 0) ? drawn : rounded);
    const known = typeof value === 'number' ? value : context.parameters ? evaluateNumber(value, context.parameters) : undefined;
    const size = typeof known === 'number' ? known : known?.ok ? known.value : undefined;
    if (size !== undefined && size > 0) {
      const wanted = size / across;
      if (input.vertex.snap && !input.center.snap) {
        pc = [pv[0] + (wanted / radius) * (pc[0] - pv[0]), pv[1] + (wanted / radius) * (pc[1] - pv[1])];
        centre = { at: pc };
      }
      if (!input.vertex.snap || !input.center.snap || wanted > radius) radius = wanted;
    }
  }
  // a side shorter than what counts as one place would be a line without length
  if (!(2 * radius * Math.sin(Math.PI / sides) > SAME_PLACE)) return failed('the polygon is too small: its sides would have no length');
  if (Math.abs(pc[0]) + radius > MAX_NUMBER || Math.abs(pc[1]) + radius > MAX_NUMBER) return failed(`the polygon reaches out of the range ±${MAX_NUMBER}`);
  const direction = Math.atan2(pv[1] - pc[1], pv[0] - pc[0]);
  const corner = (i: number): Vec2 => [pc[0] + radius * Math.cos(direction + (TAU * i) / sides), pc[1] + radius * Math.sin(direction + (TAU * i) / sides)];

  const center = placeAnchor(context, centre, newId);
  let first: Placed;
  if (input.vertex.snap) first = placeAnchor(context, input.vertex, newId);
  else {
    const id = newId('p');
    first = { id, commands: [{ type: 'addPoint', sketch, id, x: corner(0)[0], y: corner(0)[1] }], constraints: [] };
  }
  const commands: Command[] = [...center.commands, ...first.commands];
  const points: Id[] = [first.id];
  for (let i = 1; i < sides; i++) {
    const id = newId('p');
    points.push(id);
    commands.push({ type: 'addPoint', sketch, id, x: corner(i)[0], y: corner(i)[1] });
  }
  const circle = newId('c');
  commands.push({ type: 'addCurve', sketch, id: circle, curve: { type: 'circle', center: center.id, construction: true }, radius });
  const lines = points.map(() => newId('c'));
  lines.forEach((line, i) => commands.push({ type: 'addCurve', sketch, id: line, curve: { type: 'line', a: points[i], b: points[(i + 1) % sides] } }));
  const constraints: Id[] = [...center.constraints, ...first.constraints];
  const constrain = (constraint: Extract<Command, { type: 'addConstraint' }>['constraint']): Id => {
    const id = newId('k');
    commands.push({ type: 'addConstraint', sketch, id, constraint });
    return id;
  };
  // every vertex on the circle and every side as long as the first one: the regular polygon holds
  // these, and so do its folded forms (see the summary of the tool)
  for (const point of points) constraints.push(constrain({ type: 'pointOnCurve', point, curve: circle }));
  for (const line of lines.slice(1)) constraints.push(constrain({ type: 'equalLength', a: lines[0], b: line }));
  const ids: Record<string, Id[]> = { center: [center.id], circle: [circle], points, lines, constraints };
  if (sizeKind && value !== undefined) {
    // across flats: from the first vertex to the line of the opposite side
    ids.size = [constrain(sizeKind === 'circumscribed' ? { type: 'diameter', curve: circle, value, driving: true } : { type: 'distancePointLine', point: points[0], line: lines[sides / 2], value, driving: true })];
  }
  return { ok: true, commands, ids };
}

// ---------------------------------------------------------------- the fillet (D52)

// Which features read a profile from a sketch, by feature type: a feature type added later does
// not compile until it says whether it has a profile source (the fillet patches its regions and
// walls).
const PROFILE_SOURCES: { [T in Feature['type']]: (feature: Extract<Feature, { type: T }>) => ProfileSource | undefined } = {
  plane: () => undefined,
  sketch: () => undefined,
  extrude: (feature) => feature.profile,
  pattern: () => undefined,
  hole: () => undefined,
  combine: () => undefined,
  split: () => undefined,
};
const profileSourceOf = (feature: Feature): ProfileSource | undefined => (PROFILE_SOURCES[feature.type] as (f: Feature) => ProfileSource | undefined)(feature);

type LineCurve = Extract<Curve, { type: 'line' }>;

// The positions the tool reads: the solved ones (the origin and projected points included), or
// those of the document when the sketch has no solved state.
const positionsOf = (context: SketchToolContext): Record<Id, Point2> => context.result?.points ?? { [ORIGIN]: { x: 0, y: 0 }, ...context.sketch.points };

// The two lines of a corner, or why the corner is not one. The curves that count are the own
// curves whose end (a line by `a` or `b`, an arc by `start` or `end`) is in the vertex of the
// corner: the class of points the profile joins with it (`pointJoins`). Of them the curves that
// are not construction curves are taken, or if there are none the construction ones; they have to
// be exactly two lines, both ending at the corner point itself.
function cornerLines(context: SketchToolContext, corner: Id): [Id, Id] | string {
  const { sketch } = context;
  const vertex = pointJoins(sketch, { points: positionsOf(context), radii: {} });
  const at = vertex(corner);
  const ends = (curve: Curve): Id[] => (curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'arc' ? [curve.start, curve.end] : []);
  const ending = Object.keys(sketch.curves).filter((id) => ends(sketch.curves[id]).some((p) => vertex(p) === at));
  const real = ending.filter((id) => !sketch.curves[id].construction);
  const taken = real.length > 0 ? real : ending;
  const lines = taken.filter((id) => sketch.curves[id].type === 'line');
  if (taken.length !== 2 || lines.length !== 2) {
    const what = taken.map((id) => `"${id}" (${sketch.curves[id].type})`).join(', ');
    return `"${corner}" is not the common end of exactly two lines: ${taken.length === 0 ? 'no curve ends there' : `what ends there is ${what}`}`;
  }
  for (const id of lines) {
    const line = sketch.curves[id] as LineCurve;
    if (line.a !== corner && line.b !== corner) {
      const other = vertex(line.a) === at ? line.a : line.b;
      return `the corner is two points: "${id}" ends at "${other}", which a coincident constraint joins to "${corner}"; re-point one line onto the other point first (setCurvePoint)`;
    }
  }
  return [lines[0], lines[1]].sort() as [Id, Id];
}

// The side faces of a line and of a wall along it are named by the curve.
const sideOf = (face: FaceName, curves: readonly Id[]): boolean => (face.role === 'side' || face.role === 'wallSide') && curves.includes(face.curve);
const planeOn = (plane: PlaneRef, curves: readonly Id[]): boolean => plane.kind === 'face' && sideOf(plane.face, curves);

function fillet(context: SketchToolCall, input: SketchToolInputs['fillet'], newId: NewId): SketchToolResult {
  const { sketch, document } = context;
  const corner = input.corner;
  const found = cornerLines(context, corner);
  if (typeof found === 'string') return failed(found);
  const lines = found;
  for (const [id, c] of Object.entries(sketch.constraints)) {
    if ((c.type === 'equalLength' || c.type === 'midpoint') && constraintOperands(c).some((operand) => lines.includes(operand))) {
      return failed(`the ${c.type} constraint "${id}" is on a line of the corner; after the fillet it would measure the shortened line, so remove it first`);
    }
  }
  // the radius: a number, or an expression the parameters give a value to
  let radius: number;
  if (typeof input.radius === 'number') radius = input.radius;
  else {
    if (!context.parameters) return failed('radius: the expression cannot be evaluated without the values of the parameters');
    const known = evaluateNumber(input.radius, context.parameters);
    if (!known.ok) return failed(`radius: ${known.error.message}`);
    const checked = checkNumber(known.value, SKETCH_TOOLS.fillet.inputs.radius.kind === 'number' ? SKETCH_TOOLS.fillet.inputs.radius.spec : { title: 'Radius', unit: 'mm' });
    if (!checked.ok) return failed(`radius: ${checked.message}`);
    radius = checked.value;
  }

  const p = pointAt(context, corner) as Vec2;
  const curves = lines.map((id) => sketch.curves[id] as LineCurve);
  const far = curves.map((line): Vec2 => pointAt(context, line.a === corner ? line.b : line.a) as Vec2);
  const lengths = far.map((q) => dist2(p, q));
  for (const [i, length] of lengths.entries()) if (!(length > LENGTH_TOLERANCE)) return failed(`the line "${lines[i]}" is shorter than ${LENGTH_TOLERANCE} mm and has no direction`);
  const u = far.map((q, i): Vec2 => [(q[0] - p[0]) / lengths[i], (q[1] - p[1]) / lengths[i]]);
  const angle = Math.atan2(Math.abs(cross2(u[0], u[1])), dot2(u[0], u[1]));
  if (angle <= ANGLE_TOLERANCE || angle >= Math.PI - ANGLE_TOLERANCE) return failed(`the lines "${lines[0]}" and "${lines[1]}" are parallel: there is no corner to round`);
  const half = Math.tan(angle / 2);
  const along = radius / half; // from the corner to an end of the arc
  const chord = 2 * radius * Math.cos(angle / 2);
  if (Math.min(...lengths) - along <= LENGTH_TOLERANCE) {
    return failed(`the radius ${radius} does not fit: the lines are ${lengths.map((l) => fmt(l)).join(' and ')} long at an angle of ${fmt((angle * 180) / Math.PI)}°, so the radius has to be below ${fmt(Math.min(...lengths) * half)}`);
  }
  if (!(radius > LENGTH_TOLERANCE) || !(along > LENGTH_TOLERANCE) || !(chord > LENGTH_TOLERANCE)) return failed(`the radius ${radius} is too small to draw: the arc would have no length`);
  const ends = u.map((dir): Vec2 => [p[0] + along * dir[0], p[1] + along * dir[1]]);
  const bisector: Vec2 = [u[0][0] + u[1][0], u[0][1] + u[1][1]];
  const reach = radius / Math.sin(angle / 2) / Math.hypot(bisector[0], bisector[1]);
  const center: Vec2 = [p[0] + reach * bisector[0], p[1] + reach * bisector[1]];
  if ([...ends, center].some((q) => Math.abs(q[0]) > MAX_NUMBER || Math.abs(q[1]) > MAX_NUMBER)) return failed(`the fillet reaches out of the range ±${MAX_NUMBER}`);

  const id = sketch.id;
  const [end0, end1, centre, arc] = [newId('p'), newId('p'), newId('p'), newId('c')];
  const endIds = [end0, end1];
  // counter-clockwise from start to end, the short way round
  const ccw = cross2(sub2(ends[0], center), sub2(ends[1], center)) > 0;
  const construction = curves[0].construction === true;
  const commands: Command[] = [
    ...endIds.map((point, i): Command => ({ type: 'addPoint', sketch: id, id: point, x: ends[i][0], y: ends[i][1] })),
    { type: 'addPoint', sketch: id, id: centre, x: center[0], y: center[1] },
    ...lines.map((line, i): Command => ({ type: 'setCurvePoint', sketch: id, id: line, point: curves[i].a === corner ? 'a' : 'b', to: endIds[i] })),
    { type: 'addCurve', sketch: id, id: arc, curve: { ...(construction ? { construction: true } : {}), type: 'arc', center: centre, start: ccw ? end0 : end1, end: ccw ? end1 : end0 } },
  ];
  const constrain = (constraint: Constraint): Id => {
    const constraintId = newId('k');
    commands.push({ type: 'addConstraint', sketch: id, id: constraintId, constraint });
    return constraintId;
  };
  const constraints = [
    ...lines.map((line) => constrain({ type: 'tangent', a: line, b: arc })),
    // the corner stays on both lines; a pointOnCurve the sketch has already is the one named
    ...lines.map((line) => {
      const held: Constraint = { type: 'pointOnCurve', point: corner, curve: line };
      return duplicateOf(sketch, held) ?? constrain(held);
    }),
  ];
  const radiusId = newId('k');
  commands.push({ type: 'addConstraint', sketch: id, id: radiusId, constraint: { type: 'radius', curve: arc, value: input.radius, driving: true } });

  // the features of the document
  const both = (list: readonly Id[]): boolean => lines.every((line) => list.includes(line));
  const starting = lines.filter((_, i) => curves[i].a === corner);
  const patched: Id[] = [];
  const moved: Id[] = [];
  const shortened: Id[] = [];
  for (const feature of document.features) {
    const source = profileSourceOf(feature);
    if (source?.sketch === id && source.type === 'regions' && source.regions.some((region) => both(region.outerLoop))) {
      const regions = source.regions.map((region): RegionRef => (both(region.outerLoop) ? { ...region, outerLoop: [...region.outerLoop, arc].sort() } : region));
      commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { regions } } as FeaturePatch });
      patched.push(feature.id);
    } else if (source?.sketch === id && source.type === 'wall' && both(source.curves)) {
      commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { curves: [...source.curves, arc].sort() } } as FeaturePatch });
      patched.push(feature.id);
    } else if (source?.sketch === id && source.type === 'wall' && lines.some((line) => source.curves.includes(line))) shortened.push(feature.id);
    if ((feature.type === 'sketch' && planeOn(feature.plane, starting)) || (feature.type === 'plane' && planeOn(feature.base, starting))) moved.push(feature.id);
    if (feature.type === 'sketch' && Object.values(feature.external).some((ref) => sideOf(ref.edge.a, lines) || sideOf(ref.edge.b, lines))) shortened.push(feature.id);
  }
  return { ok: true, commands, ids: { arc: [arc], center: [centre], lines: [...lines], ends: endIds, constraints, radius: [radiusId], patched, moved, shortened } };
}

// A short text of a number for a message.
const fmt = (value: number): string => String(Math.round(value * 1e4) / 1e4);

// Which point of an own curve is nearest to a point of the sketch, by the solved positions: what
// the app offers first when it re-points a curve (setCurvePoint). Undefined when the sketch has no
// such curve or point, or no position for them.
export function nearestCurvePoint(context: SketchToolContext, curve: Id, to: Id): CurvePointName | undefined {
  if (!has(context.sketch.curves, curve)) return undefined;
  const shape = context.sketch.curves[curve];
  const target = pointAt(context, to);
  if (!target) return undefined;
  let best: CurvePointName | undefined;
  let distance = Infinity;
  for (const name of CURVE_POINTS[shape.type]) {
    const at = pointAt(context, (shape as unknown as Record<string, Id>)[name]);
    if (at && dist2(at, target) < distance) [best, distance] = [name, dist2(at, target)];
  }
  return best;
}

// Runs a tool: checks the inputs against the catalog and returns the batch with the IDs of what it
// makes, or says why the input cannot be drawn. The commands are not executed here.
export function sketchTool<K extends SketchToolName>(tool: K, context: SketchToolCall, input: SketchToolInputs[K], newId: NewId): SketchToolResult {
  if (typeof tool !== 'string' || !has(SKETCH_TOOLS, tool)) return failed(`unknown sketch tool "${String(tool)}"; the tools are ${Object.keys(SKETCH_TOOLS).join(', ')}`);
  const problem = inputProblem(SKETCH_TOOLS[tool], context, input);
  if (problem) return failed(problem);
  const run: { [T in SketchToolName]: (context: SketchToolCall, input: SketchToolInputs[T], newId: NewId) => SketchToolResult } = { rectangle, polygon, fillet };
  return (run[tool] as (context: SketchToolCall, input: SketchToolInputs[K], newId: NewId) => SketchToolResult)(context, input, newId);
}

// Every text in a document: IDs, and also references to entities that are gone. A feature may
// refer to a removed entity on purpose (it is then in error until the reference is repaired); an
// entity made anew under that ID would quietly take the reference over.
function textsOf(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) textsOf(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      textsOf(item, into);
    }
  }
  return into;
}

// A supplier of IDs the document does not have: `<prefix><kind><number>`, counted up from 1 for
// every kind. IDs it has handed out are not handed out again, and neither is any text the
// features of the document contain: an ID that a region of a profile still names, though its
// curve was removed, stays taken; so does an ID a section of the document names (the feature of an
// entry of body properties whose body is gone, D48).
export function freshIds(doc: Document, prefix = ''): NewId {
  // an ID a section of the document still names (an entry of body properties) is not handed out
  const used = textsOf(doc.features, new Set([...documentIds(doc), ...namedBySections(doc)]));
  const counters = new Map<string, number>();
  return (kind) => {
    let n = counters.get(kind) ?? 1;
    while (used.has(`${prefix}${kind}${n}`)) n++;
    counters.set(kind, n + 1);
    const id = `${prefix}${kind}${n}`;
    used.add(id);
    return id;
  };
}
