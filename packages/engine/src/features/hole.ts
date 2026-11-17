// The hole feature (D46): the same hole at every listed point of one sketch, along the normal of the
// sketch plane, cut out of its targets by one tool, a stack of sections per point.
import type { FieldSpec, NumberSpec } from '../catalog';
import { type ExactCurve, planeLevel, resolveStart, throughAll } from '../recompute/extent';
import { applyTool, frame as frameOf, lookup, toolResult } from '../recompute/services';
import type { BuiltTool, Done, FaceRole, Step, StepContext, ToolRecipe } from '../recompute/state';
import { type Ring, type Section, buildStack } from '../recompute/tool-stack';
import { type Loop, type Region, segments } from '../sketch';
import { type FaceInfo, toWorld, transformFrame } from '../solid';
import type { Facts, Frame, HoleExtent, HoleFeature, HoleShape, Id, Solid, Vec2 } from '../types';
import { LENGTH_TOLERANCE, ORIGIN, has } from '../util';
import { type Dict, type FeatureRef, type Fields, type ValidationContext, base, fail, object, oneOf, onlyFields, string } from '../validation';
import { EXTENT_FIELD_SPECS, extentOf, extentRefs } from './extent';
import type { FeatureModule } from './module';

// ---------------------------------------------------------------- the document

const POSITIVE = { unit: 'mm', min: { value: 0, open: true } } as const;
// The numeric fields of a shape (`shape/<name>`). None has a default: a hole is all its numbers.
export const HOLE_FIELDS = {
  diameter: { title: 'Diameter', ...POSITIVE },
  headDiameter: { title: 'Head diameter', ...POSITIVE },
  headDepth: { title: 'Head depth', ...POSITIVE },
  angle: { title: 'Angle of the countersink', unit: 'rad', min: { value: 0, open: true }, max: { value: Math.PI, open: true } },
  acrossFlats: { title: 'Across flats', ...POSITIVE },
  rotation: { title: 'Rotation', unit: 'rad' },
} as const satisfies Record<string, NumberSpec>;
type ShapeField = keyof typeof HOLE_FIELDS;
// The fields of each kind, in the order a form shows them.
export const HOLE_SHAPES: { [K in HoleShape['type']]: readonly Exclude<keyof Extract<HoleShape, { type: K }>, 'type'>[] } = {
  plain: ['diameter'],
  counterbore: ['diameter', 'headDiameter', 'headDepth'],
  countersink: ['diameter', 'headDiameter', 'angle'],
  nutPocket: ['diameter', 'acrossFlats', 'headDepth', 'rotation'],
};
const KINDS = Object.keys(HOLE_SHAPES) as HoleShape['type'][];
export const MAX_LABEL = 200;

function holeShape(fields: Fields, v: unknown, what: string): HoleShape {
  const given = object(v, what);
  const type = oneOf(given.type, KINDS, `${what}.type`);
  const names = HOLE_SHAPES[type] as readonly ShapeField[];
  onlyFields(given, ['type', ...names], what, `a hole of the type ${type}`);
  return { type, ...Object.fromEntries(names.map((name) => [name, fields.number(given[name], `shape/${name}`, HOLE_FIELDS[name], `${what}.${name}`)])) } as HoleShape;
}

function holeFeature(o: Dict, what: string, context: ValidationContext): HoleFeature {
  const sketch = string(o.sketch, `${what}.sketch`);
  context.requireRef({ id: sketch, kind: 'sketch' }, `${what}.sketch`);
  if (!Array.isArray(o.points) || o.points.length === 0) return fail(`${what}.points: a non-empty list of point IDs is expected`);
  const points = (o.points as unknown[]).map((point, i) => string(point, `${what}.points[${i}]`));
  if (new Set(points).size < points.length) fail(`${what}.points: a point is listed twice`);
  for (const point of points) context.requireRef({ id: point, kind: 'entity', sketch, accepts: ['point'], notProjected: true }, `${what}.points`);
  const shape = holeShape(context.fields, o.shape, `${what}.shape`);
  const extent = extentOf(context, o.extent, `${what}.extent`, { throughAll: true, upTo: false, noTaper: 'a hole has no taper', noBoth: 'a hole has a mouth, so through all goes forward or backward' }) as HoleExtent;
  if (!Array.isArray(o.targets) || o.targets.length === 0) return fail(`${what}.targets: a hole needs at least one target body`);
  const targets = (o.targets as unknown[]).map((target, i) => string(target, `${what}.targets[${i}]`));
  if (new Set(targets).size < targets.length) fail(`${what}.targets: a target body is listed twice`);
  for (const target of targets) context.requireRef({ id: target, kind: 'body' }, `${what}.targets`);
  const feature: HoleFeature = { ...base(o, what), type: 'hole', sketch, points, shape, extent, targets };
  if (o.label === undefined) return feature;
  const label = string(o.label, `${what}.label`);
  if (label.trim() === '') fail(`${what}.label: the label is not empty; leave it out for none`);
  if (label.length > MAX_LABEL) fail(`${what}.label: at most ${MAX_LABEL} characters`);
  return { ...feature, label };
}

// The numeric fields of a hole, as the registry lists them: those of each kind of shape, then the
// extent of a distance (a hole has no taper).
const SHAPE_FIELD_SPECS: FieldSpec[] = KINDS.flatMap((kind) => (HOLE_SHAPES[kind] as readonly ShapeField[]).map((name): FieldSpec => ({ path: `shape/${name}`, spec: HOLE_FIELDS[name], when: { path: 'shape/type', equals: kind } })));
const HOLE_EXTENT_FIELD_SPECS = EXTENT_FIELD_SPECS.filter((field) => field.when?.equals === 'distance' && field.path !== 'extent/taper');

// ---------------------------------------------------------------- the recompute

const mm = (value: number): string => String(Number(value.toPrecision(6)) + 0);

// What the numbers of a shape give: the depth of the head (zero for a plain hole), the largest
// radius of a hole (for a hexagon the circle through its corners), or why they make no hole.
function measured(shape: HoleShape): { head: number; outer: number } | { detail: string } {
  const bore = shape.diameter;
  if (shape.type === 'plain') return { head: 0, outer: bore / 2 };
  if (shape.type === 'nutPocket') {
    if (shape.acrossFlats <= bore + LENGTH_TOLERANCE) return { detail: `the bore of ${mm(bore)} mm does not fit between the flats, ${mm(shape.acrossFlats)} mm apart` };
    return { head: shape.headDepth, outer: shape.acrossFlats / Math.sqrt(3) };
  }
  if (shape.headDiameter <= bore + LENGTH_TOLERANCE) return { detail: `the head of ${mm(shape.headDiameter)} mm is not wider than the bore of ${mm(bore)} mm` };
  const head = shape.type === 'counterbore' ? shape.headDepth : (shape.headDiameter - bore) / 2 / Math.tan(shape.angle / 2);
  return { head, outer: shape.headDiameter / 2 };
}

// A closed polyline around `center`: a circle of `count` points from the X axis of the sketch, or
// the hexagon of a nut pocket from the corner `rotation` points to; counter-clockwise.
function loop(center: Vec2, radius: number, count: number, start: number, curve: (k: number) => string): Loop {
  const xy: number[] = [];
  const keys: string[] = [];
  const curves: string[] = [];
  for (let k = 0; k < count; k++) {
    const angle = start + (2 * Math.PI * k) / count;
    xy.push(center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle));
    keys.push(`${curve(k)}#${k}`);
    curves.push(curve(k));
  }
  return { xy, keys, curves };
}
const region = (outer: Loop): Region => ({ ref: { outerLoop: [outer.curves[0]] }, outer, holes: [] });

// The keys of the side faces in `Loop.curves`, and the names they stand for. The parts are
// separated by a slash, which no ID of a point the hole takes holds (an own point or `origin`); any
// other character may be in an ID.
const BORE = 'b';
const HEAD = 'h';
const FLAT = 'f';
const sideKey = (part: string, point: Id, flat?: number): string => (flat === undefined ? `${part}/${point}` : `${part}/${point}/${flat}`);

// The scale of the guards against the resolution of the kernel adapter (a head and a blind bore
// have to be longer than `1e-4 · scale`): the largest coordinate of the targets, of the sketch plane
// and of the tool itself, its mouth and its far end (levels along the normal, D66). A mouth far
// from the targets raises the resolution the adapter has, which the targets alone do not show.
function toolScale(frame: Frame, targets: Solid[], mouth: number, far: number): number {
  const at = (level: number): number => Math.max(...toWorld(frame, 0, 0, level).map(Math.abs));
  return Math.max(throughAll('both', frame, targets, 0).scale, at(mouth), at(far));
}

function step(feature: HoleFeature, { state, settings, deps, done: finish, failed }: StepContext): Step {
  const sketch = lookup(state.sketches, feature.sketch);
  if (!sketch) return failed('brokenReference', [feature.sketch]);
  // the positions of the points: own points and the origin of the sketch, as solved
  const centers = new Map<Id, Vec2>();
  for (const point of feature.points) {
    const at = point === ORIGIN || has(sketch.feature.points, point) ? lookup(sketch.geometry.points, point) : undefined;
    if (!at) return failed('brokenReference', [point]);
    centers.set(point, [at.x, at.y]);
  }
  const { shape } = feature;
  const size = measured(shape);
  if ('detail' in size) return failed('invalidHole', undefined, size.detail);
  const { head, outer } = size;
  const boreR = shape.diameter / 2;
  const headR = shape.type === 'counterbore' || shape.type === 'countersink' ? shape.headDiameter / 2 : 0;
  // The mouth from a plane (D66): resolved in the state before the feature, its level measured once
  // over the exact outline of the hole at the mouth (the circles of the bore and of the head, the
  // corners of a hexagon), before the guards below, whose scale includes the mouth.
  const { from } = feature.extent;
  let level = 0;
  if (from) {
    const resolved = frameOf(from, state);
    if (typeof resolved === 'string') return failed(resolved, [from]);
    // the corners of the hexagon of a nut pocket, as `loop` puts them
    const corners = (cx: number, cy: number, r: number, rotation: number): number[] => [0, 1, 2, 3, 4, 5].flatMap((k) => [cx + r * Math.cos(rotation + (k * Math.PI) / 3), cy + r * Math.sin(rotation + (k * Math.PI) / 3)]);
    const outline = [...centers.values()].flatMap(([cx, cy]): ExactCurve[] => [
      { type: 'circle', center: [cx, cy], radius: boreR },
      ...(headR > 0 ? [{ type: 'circle', center: [cx, cy], radius: headR } satisfies ExactCurve] : []),
      ...(shape.type === 'nutPocket' ? [{ type: 'points', xy: corners(cx, cy, outer, shape.rotation) } satisfies ExactCurve] : []),
    ]);
    const measuredLevel = planeLevel({ point: resolved.origin, normal: resolved.normal }, sketch.frame, outline, 'hole');
    if ('detail' in measuredLevel) return failed('invalidExtent', [from], measuredLevel.detail);
    level = measuredLevel.level;
  }
  const extent = resolveStart(feature.extent, level);
  // the mouth: the start of a distance, or the level of the plane for "through all"
  const mouth = extent.type === 'distance' ? extent.start : level;
  const bodies = feature.targets.flatMap((target) => lookup(state.bodies, target) ?? []);
  // A head and a blind bore have to be longer than the resolution of the kernel adapter, the δ
  // "through all" compares its head with (1e-4 of the largest coordinate of the targets, of the
  // sketch plane and of the tool): shorter, the adapter takes their two ends for one plane and drops
  // the face between them without an error.
  const resolution = 1e-4 * Math.max(1, toolScale(sketch.frame, bodies, mouth, extent.type === 'distance' ? mouth + extent.distance : mouth));
  const kernel = `the resolution of the kernel at the size of this model is ${mm(resolution)} mm`;
  if (head > 0 && head <= resolution) return failed('invalidHole', undefined, `the head is ${mm(head)} mm deep, not more than ${kernel}`);
  if (extent.type === 'distance' && Math.abs(extent.distance) - head <= resolution)
    return failed(
      'invalidHole',
      undefined,
      head === 0
        ? `the hole is ${mm(Math.abs(extent.distance))} mm deep, not more than ${kernel}`
        : `the head is ${mm(head)} mm deep and the hole ${mm(Math.abs(extent.distance))} mm: ${head >= Math.abs(extent.distance) ? 'the head has to be shallower than the hole' : `the bore below the head has to be longer than ${mm(resolution)} mm, ${kernel}`}`,
    );
  // the holes of one tool must not overlap
  const points = [...centers];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const apart = Math.hypot(points[i][1][0] - points[j][1][0], points[i][1][1] - points[j][1][1]);
      if (apart < 2 * outer + LENGTH_TOLERANCE) return failed('invalidHole', [points[i][0], points[j][0]], `the holes at the points "${points[i][0]}" and "${points[j][0]}" overlap: they are ${mm(apart)} mm apart and a hole is ${mm(2 * outer)} mm wide`);
    }
  }

  // The outlines in the coordinates of the sketch, computed once: every circle has the number of
  // sides of the largest circle of the hole; the hexagon has six.
  const sign = extent.type === 'distance' ? Math.sign(extent.distance) : extent.side === 'forward' ? 1 : -1;
  const count = segments(2 * Math.PI, Math.max(boreR, headR), settings.chordTolerance);
  const bores = points.map(([point, center]) => region(loop(center, boreR, count, 0, () => sideKey(BORE, point))));
  const heads =
    shape.type === 'nutPocket'
      ? points.map(([point, center]) => region(loop(center, shape.acrossFlats / Math.sqrt(3), 6, shape.rotation, (k) => sideKey(FLAT, point, k + 1))))
      : headR > 0
        ? points.map(([point, center]) => region(loop(center, headR, count, 0, () => sideKey(HEAD, point))))
        : [];
  // The surfaces of the sides, in the coordinates of the sketch (z along the normal).
  const sideOf = (key: string): { name: FaceRole; info: FaceInfo } => {
    const [part, point, flat] = key.split('/');
    const [cx, cy] = centers.get(point) as Vec2;
    if (part === BORE) return { name: { role: 'holeBore', point }, info: { planar: false, surface: 'cylinder', center: [cx, cy, 0], axis: [0, 0, 1], radius: boreR, along: [0, 0, 1] } };
    if (part === FLAT) {
      // a flat starts at its corner in the sketch plane, as the side of a line of an extrusion does
      const corner = (k: number): Vec2 => {
        const angle = (shape as Extract<HoleShape, { type: 'nutPocket' }>).rotation + (k * Math.PI) / 3;
        const r = (shape as Extract<HoleShape, { type: 'nutPocket' }>).acrossFlats / Math.sqrt(3);
        return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      };
      const [a, b] = [corner(Number(flat) - 1), corner(Number(flat))];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { name: { role: 'holeFlat', point, flat: Number(flat) }, info: { planar: true, origin: [a[0], a[1], 0], y: [0, 0, 1], normal: [(b[1] - a[1]) / length, -(b[0] - a[0]) / length, 0] } };
    }
    if (shape.type === 'counterbore') return { name: { role: 'holeHead', point }, info: { planar: false, surface: 'cylinder', center: [cx, cy, 0], axis: [0, 0, 1], radius: headR, along: [0, 0, 1] } };
    // the cone of a countersink: its apex beyond the mouth along the hole, its axis back to the mouth
    const half = (shape as Extract<HoleShape, { type: 'countersink' }>).angle / 2;
    return { name: { role: 'holeHead', point }, info: { planar: false, surface: 'cone', apex: [cx, cy, mouth + (sign * headR) / Math.tan(half)], axis: [0, 0, -sign], halfAngle: half, along: [0, 0, 1] } };
  };
  // The sections of a tool `length` long from the mouth.
  const sections = (length: number): Section[] => {
    const at = (regions: Region[], depth: number): Ring => ({ w: mouth + sign * depth, regions });
    const bore = (from: number, seat: boolean): Section => ({ rings: [at(bores, from), at(bores, length)], sideOf, ...(seat ? { step: { role: 'holeSeat' } as FaceRole } : {}) });
    if (shape.type === 'plain') return [bore(0, false)];
    if (shape.type === 'countersink') return [{ rings: [at(heads, 0), at(bores, head)], sideOf }, bore(head, false)];
    return [{ rings: [at(heads, 0), at(heads, head)], sideOf }, bore(head, true)];
  };

  // The tool: "through all" is measured against the targets it is built for, and a copy of
  // a pattern is built in its own position. The planar triangulations are shared by all builds.
  const caps = new Map<Region, Uint32Array>();
  const steps = new Map<Region, Uint32Array>();
  const build: ToolRecipe['build'] = (targets, firstFaceId, placement) => {
    const frame = placement ? transformFrame(placement.transform, sketch.frame) : sketch.frame;
    let length = Math.abs(extent.type === 'distance' ? extent.distance : 0);
    let refuse: BuiltTool['refuseChange'];
    if (extent.type === 'throughAll') {
      // A head has to leave more of the reach than the resolution of the kernel adapter for its
      // bore. A head as deep as the reach or deeper is built as long as the head and the overshoot,
      // and must not change a target: it may only touch targets that do not pass the mouth.
      const through = throughAll(extent.side, frame, targets, mouth);
      const resolution = 1e-4 * Math.max(1, through.scale);
      if (head === 0 || through.reach > head + resolution) length = through.reach + through.overshoot;
      else {
        length = head + through.overshoot;
        refuse = { code: 'invalidHole', detail: `the head is ${mm(head)} mm deep and the targets reach only ${mm(through.reach)} mm from the mouth: the head has to be shallower than the hole` };
      }
    }
    const tool = buildStack(feature.id, sections(length), frame, firstFaceId, deps.kernel, caps, steps);
    const placed = placement ? { ...tool, faces: tool.faces.map((face) => ({ ...face, name: { ...face.name, copy: [placement.copy] } })) } : tool;
    return refuse ? { ...placed, refuseChange: refuse } : placed;
  };
  const recipe: ToolRecipe = { operation: 'cut', targets: feature.targets, build };
  // The depth of the head and of the hole for the feature itself: "through all" measured from the
  // mouth on the targets as they are before the feature; the level of the mouth with a plane `from`.
  const depth = extent.type === 'distance' ? Math.abs(extent.distance) : throughAll(extent.side, sketch.frame, bodies, mouth).reach;
  const facts: Facts = { ...(head > 0 ? { headDepth: head } : {}), depth, ...(from ? { startLevel: mouth } : {}) };
  const done: Done = (result, change) => finish({ ...result, facts }, change);
  return toolResult(feature.id, recipe, applyTool(recipe, state, deps.kernel), state, done, failed);
}

export const hole: FeatureModule<HoleFeature> = {
  info: {
    title: 'Hole',
    summary:
      'The same hole at every listed point of a sketch, along the normal of the sketch plane, cut out of the target bodies: plain, counterbore, countersink or a hexagon pocket for a nut, with the extent of a distance or through all forward or backward. ' +
      'Ask the query hardwareHole for the shape and the label of a hole for a screw, a nut or a heat-set insert of a size; the feature stores the numbers. A pattern repeats a hole like a cut. ' +
      'The mouth may start from a plane or a planar face parallel to the sketch (extent.from): a counterbore at the top of a part whose sketch is at the bottom is from that face, through all backward.',
    fields: [...SHAPE_FIELD_SPECS, ...HOLE_EXTENT_FIELD_SPECS],
    bodies: 'none',
  },
  validate: holeFeature,
  refs: (f) => [
    { path: 'sketch', id: f.sketch, kind: 'sketch' },
    ...f.points.map((id): FeatureRef => ({ path: 'points', id, kind: 'entity', sketch: f.sketch, accepts: ['point'], notProjected: true })),
    ...f.targets.map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' })),
    ...extentRefs(f.extent),
  ],
  createsBody: () => false,
  namesFaces: true,
  producesTool: () => true,
  patch: {
    fields: ['sketch', 'points', 'shape', 'extent', 'targets', 'label'],
    // `null` removes the label, also where the feature has none (a form sends it whenever its label
    // is empty); so the plane the extent starts from (a form sends it whenever there is none)
    removable: (_f, path) => (path.length === 1 && path[0] === 'label') || (path.length === 2 && path[0] === 'extent' && path[1] === 'from'),
  },
  step,
};
