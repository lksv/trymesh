// Sketch tools (D35, point 7): pure functions that turn a few inputs into a batch of sketch
// commands. The app calls them from its drawing tools and the MCP server offers them as one tool
// whose description is generated from the catalog below, so a tool added here is at both places.
// Nothing here touches the recompute: a tool only reads the sketch and its solved positions.
import { MAX_NUMBER, type NumberSpec, checkNumber } from './catalog';
import { documentIds, entityOf } from './document';
import { evaluateNumber } from './expression';
import type { Command, Document, Expr, Id, ParameterResult, SketchFeature, SketchResult, Vec2 } from './types';
import { ORIGIN, dist2, has } from './util';

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

export interface SketchToolInputs {
  rectangle: { first: Anchor; opposite: Anchor };
  // `vertex` gives the size and the rotation. `sizeKind` and `size` add a dimension: the diameter
  // of the circumscribed circle, or the size across flats (an even number of sides only).
  polygon: { center: Anchor; vertex: Anchor; sides: number; sizeKind?: 'circumscribed' | 'acrossFlats'; size?: number | Expr };
}
export type SketchToolName = keyof SketchToolInputs;

export type SketchToolInput =
  | { kind: 'anchor' }
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
      'A regular polygon: a construction circle around it, the vertices on the circle and all sides of the same length. Position, size and rotation stay free (4 degrees of freedom) unless the anchors snap or a size is given. `sizeKind` with `size` adds a dimension: the diameter of the circumscribed circle, or the size across flats (the wrench size of a nut; an even number of sides only). `sizeKind` alone dimensions the size as drawn. The direction from `center` to `vertex` is the rotation: draw the polygon turned as it should be (with `vertex` straight right of the centre, `lines[1]` of a hexagon is horizontal) and add a constraint on a side only to hold it there. The same constraints also hold for folded polygons, and the solver may end in one when a later constraint or a change of the size asks for a big jump (a turn over about 30°, the size across flats several times larger or smaller): the sketch then has no region (`regions: 0`); undo the step and make it smaller. The dimension of the circumscribed circle takes any change.',
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

// The inputs against the catalog; the first problem as text.
function inputProblem(spec: SketchToolSpec, context: SketchToolContext, input: unknown): string | undefined {
  if (!isObject(input)) return 'the input of a tool must be an object';
  for (const key of Object.keys(input)) if (!has(spec.inputs, key)) return `${spec.title} has no input "${key}"; it takes ${Object.keys(spec.inputs).join(', ')}`;
  for (const [name, kind] of Object.entries(spec.inputs)) {
    const value = input[name];
    if (value === undefined) {
      if (kind.kind === 'anchor' || !kind.optional) return `the input "${name}" is missing`;
      continue;
    }
    if (kind.kind === 'anchor') {
      const problem = anchorProblem(context, value);
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
  const [pc, pv] = [anchorPosition(context, input.center), anchorPosition(context, input.vertex)];
  let radius = dist2(pc, pv);
  if (!(radius > SAME_PLACE)) return failed('the centre and the vertex are at the same place');
  // The size across flats of the polygon with the circumradius 1.
  const flats = 2 * Math.cos(Math.PI / sides);
  // The value of the dimension and the size the polygon is drawn at.
  // - A size that is given (a number, or an expression the parameters give a value to) is also
  //   the drawn size: the solver then starts from a polygon that already holds, and a start far
  //   from the dimension is what folds a polygon. A vertex that snaps keeps its place; the solver
  //   brings it and the rest together, or reports the conflict when the vertex cannot move.
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
    if (size !== undefined && size > 0) radius = size / across;
  }
  // a side shorter than what counts as one place would be a line without length
  if (!(2 * radius * Math.sin(Math.PI / sides) > SAME_PLACE)) return failed('the polygon is too small: its sides would have no length');
  if (Math.abs(pc[0]) + radius > MAX_NUMBER || Math.abs(pc[1]) + radius > MAX_NUMBER) return failed(`the polygon reaches out of the range ±${MAX_NUMBER}`);
  const direction = Math.atan2(pv[1] - pc[1], pv[0] - pc[0]);
  const corner = (i: number): Vec2 => [pc[0] + radius * Math.cos(direction + (TAU * i) / sides), pc[1] + radius * Math.sin(direction + (TAU * i) / sides)];

  const center = placeAnchor(context, input.center, newId);
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
  // every vertex on the circle and every side as long as the first one: only the regular polygon is left
  for (const point of points) constraints.push(constrain({ type: 'pointOnCurve', point, curve: circle }));
  for (const line of lines.slice(1)) constraints.push(constrain({ type: 'equalLength', a: lines[0], b: line }));
  const ids: Record<string, Id[]> = { center: [center.id], circle: [circle], points, lines, constraints };
  if (sizeKind && value !== undefined) {
    // across flats: from the first vertex to the line of the opposite side
    ids.size = [constrain(sizeKind === 'circumscribed' ? { type: 'diameter', curve: circle, value, driving: true } : { type: 'distancePointLine', point: points[0], line: lines[sides / 2], value, driving: true })];
  }
  return { ok: true, commands, ids };
}

// Runs a tool: checks the inputs against the catalog and returns the batch with the IDs of what it
// makes, or says why the input cannot be drawn. The commands are not executed here.
export function sketchTool<K extends SketchToolName>(tool: K, context: SketchToolContext, input: SketchToolInputs[K], newId: NewId): SketchToolResult {
  if (typeof tool !== 'string' || !has(SKETCH_TOOLS, tool)) return failed(`unknown sketch tool "${String(tool)}"; the tools are ${Object.keys(SKETCH_TOOLS).join(', ')}`);
  const problem = inputProblem(SKETCH_TOOLS[tool], context, input);
  if (problem) return failed(problem);
  return tool === 'rectangle' ? rectangle(context, input as SketchToolInputs['rectangle'], newId) : polygon(context, input as SketchToolInputs['polygon'], newId);
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
// curve was removed, stays taken.
export function freshIds(doc: Document, prefix = ''): NewId {
  const used = textsOf(doc.features, documentIds(doc));
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
