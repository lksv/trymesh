// Catalog of profile generators (D35, point 3). A generator turns a few entities of a sketch and
// a few parameters into the closed loops an extrusion sweeps: a gear from its pitch circle today,
// a cycloidal disc, a pulley or text later. Like the constraint catalog, the catalog is the single
// source of truth: validation, expressions in parameters, the app's form and the API description
// follow it. A new generator is an entry here and a build function; the document shape does not
// change.
import type { NumberSpec, OperandSpec } from './catalog';
import type { Facts, Frame, GeneratorName, Vec2, Vec3, WarningCode } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, cross3, dot3, len3, sub3 } from './util';

// ---------------------------------------------------------------- catalog

// A parameter that is a flag. Options from a list and text will be further kinds; the document
// already allows a string in `params` for them.
export interface FlagSpec {
  title: string;
  flag: true;
  default: boolean;
}
export type ParamSpec = NumberSpec | FlagSpec;
export const isFlag = (spec: ParamSpec): spec is FlagSpec => 'flag' in spec;

export interface GeneratorSpec {
  title: string;
  summary: string;
  operands: OperandSpec[]; // entities of the sketch the generator needs, by name
  // A number without `default` is required. Numbers are numeric fields at `profile/params/<name>`.
  params: Record<string, ParamSpec>;
  // References to earlier features: an extrusion whose profile comes from one of `generators`.
  refs: Record<string, { title: string; summary: string; generators: readonly GeneratorName[] }>;
  sides: readonly string[]; // names of the side faces the generator creates (`FaceName.curve`)
  facts: Record<string, string>; // what the generator publishes about the profile (`FeatureResult.facts`)
}

const DEGREE = Math.PI / 180;
export const MAX_TEETH = 500;
// A profile above this size would block the synchronous engine in triangulation and booleans.
export const MAX_PROFILE_POINTS = 50_000;

export const GENERATORS: Record<GeneratorName, GeneratorSpec> = {
  involuteGear: {
    title: 'Involute gear',
    summary:
      'Involute gear teeth over a pitch circle of the sketch (it may be a construction or a projected circle). The module is not entered: it follows from the diameter of the circle and the number of teeth. ' +
      'An external profile is the shape of a gear (tip circle r + m, root circle r − 1.25 m). An internal profile (`internal: true`) is the shape that is cut out of a body to make a ring gear: ' +
      'it reaches from the tip circle of the ring r − m to its root circle r + 1.25 m and removes the centre as well, so it is cut into solid material. No profile shift.',
    operands: [{ field: 'circle', kinds: ['circle'] }],
    params: {
      teeth: { title: 'Number of teeth', unit: 'count', integer: true, min: { value: 4 }, max: { value: MAX_TEETH } },
      pressureAngle: { title: 'Pressure angle', unit: 'rad', min: { value: 0, open: true }, max: { value: Math.PI / 2, open: true }, default: 20 * DEGREE },
      backlash: { title: 'Backlash', unit: 'mm', min: { value: 0 }, default: 0 },
      rotation: { title: 'Rotation', unit: 'rad', default: 0 },
      internal: { title: 'Internal (the cut that makes a ring gear)', flag: true, default: false },
    },
    refs: {
      meshWith: {
        title: 'In mesh with',
        summary:
          'An earlier extrusion with gear teeth. The rotation is then computed so that a tooth of one gear faces a tooth space of the other on the line of centres, and the parameter `rotation` is not used. ' +
          'The gears must have the same module and pressure angle, parallel axes and tangent pitch circles (two external gears from outside, an external gear inside an internal one); otherwise the feature reports the warning gearMesh and uses `rotation`.',
        generators: ['involuteGear'],
      },
    },
    sides: ['teeth'],
    facts: {
      module: 'module in mm: pitch diameter divided by the number of teeth',
      teeth: 'number of teeth',
      pressureAngle: 'pressure angle in radians',
      backlash: 'thinning of the tooth of this gear on the pitch circle, mm along the arc',
      internal: 'true for the cut that makes a ring gear',
      pitchDiameter: 'diameter of the pitch circle',
      baseDiameter: 'diameter of the base circle',
      tipDiameter: 'diameter of the tip circle of the gear (for a ring gear the inner one)',
      rootDiameter: 'diameter of the root circle of the gear (for a ring gear the outer one)',
      rotation: 'rotation used, radians in sketch coordinates: the direction of the axis of one tooth (for a ring gear of one tooth space)',
      meshed: 'true when the rotation was computed from the gear in `meshWith`',
      center: 'centre of the pitch circle in model coordinates',
      axis: 'direction of the gear axis in model coordinates',
      toothDirection: 'direction of the axis of one tooth (for a ring gear of one tooth space) in model coordinates',
    },
  },
};

// ---------------------------------------------------------------- build

export type ResolvedOperand = { kind: 'circle'; center: Vec2; radius: number };

export interface GeneratorInput {
  operands: Record<string, ResolvedOperand>;
  params: Record<string, number | boolean | string>;
  refs: Record<string, Facts | undefined>; // undefined: the referenced feature is missing, in error or has no facts
  frame: Frame;
  chordTolerance: number;
}
// A closed polyline in sketch coordinates; `side` is the name of the side face it creates.
export interface GeneratedLoop {
  xy: number[];
  side: string;
}
export interface GeneratedProfile {
  // Regions like those of a sketch profile: the outer loop counter-clockwise, holes clockwise.
  regions: { outer: GeneratedLoop; holes: GeneratedLoop[] }[];
  facts: Facts;
  warnings: { code: WarningCode; detail: string; refs?: unknown[] }[];
}
// A generator may fail for numbers that are otherwise allowed (a pointed tooth); the extrusion then
// ends with the error `invalidProfile` and this message.
export type GeneratorResult = ({ ok: true } & GeneratedProfile) | { ok: false; message: string };

const tooLarge = (points: number): string => `the generated profile has ${points} points, more than ${MAX_PROFILE_POINTS}; lower the number of teeth or raise the chord tolerance`;

// The limit on the number of points holds for every generator; one that knows the size of its
// profile beforehand refuses it before building (the gear does).
export function generateProfile(generator: GeneratorName, input: GeneratorInput): GeneratorResult {
  const result = BUILD[generator](input);
  if (!result.ok) return result;
  const points = result.regions.reduce((sum, region) => sum + [region.outer, ...region.holes].reduce((n, loop) => n + loop.xy.length / 2, 0), 0);
  if (points > MAX_PROFILE_POINTS) return { ok: false, message: tooLarge(points) };
  return result;
}

// ---------------------------------------------------------------- involute gear

const TAU = 2 * Math.PI;
const involute = (angle: number): number => Math.tan(angle) - angle;
const frac = (x: number): number => x - Math.floor(x);
const fail = (message: string): GeneratorResult => ({ ok: false, message });

// Number of chords for an arc of the given sweep, the same rule as for arcs of a sketch, with the
// same cap: a tolerance far below the radius must not ask for an endless arc.
const MAX_ARC_STEPS = 4096;
const MAX_FLANK_STEPS = 256; // chords of one flank; a finer tolerance is not met
function arcSteps(sweep: number, radius: number, chordTolerance: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(chordTolerance / radius, 1)), Math.PI / 4);
  return Math.min(MAX_ARC_STEPS, Math.max(1, Math.ceil(sweep / step - 1e-9)));
}

// What one gear needs to know about the other one to mesh with it; read from its facts.
interface Mate {
  center: Vec2; // in the coordinates of this sketch
  rotation: number; // direction of a tooth axis in the coordinates of this sketch
  teeth: number;
  module: number;
  pressureAngle: number;
  pitchRadius: number;
  tipRadius: number;
  internal: boolean;
}

// Reads the facts of the gear in `meshWith` in the coordinates of this sketch. A text = why the
// reference cannot be used.
function mate(facts: Facts | undefined, frame: Frame): Mate | string {
  if (!facts) return 'the feature in meshWith has no gear to mesh with: it is missing, suppressed, in error or not a gear';
  const number = (name: string): number => facts[name] as number;
  const vector = (name: string): Vec3 => facts[name] as Vec3;
  if (len3(cross3(vector('axis'), frame.normal)) > Math.sin(ANGLE_TOLERANCE)) return 'the axes of the two gears are not parallel';
  const inPlane = (v: Vec3): Vec2 => [dot3(v, frame.x), dot3(v, frame.y)];
  const direction = inPlane(vector('toothDirection'));
  return {
    center: inPlane(sub3(vector('center'), frame.origin)),
    rotation: Math.atan2(direction[1], direction[0]),
    teeth: number('teeth'),
    module: number('module'),
    pressureAngle: number('pressureAngle'),
    pitchRadius: number('pitchDiameter') / 2,
    tipRadius: number('tipDiameter') / 2,
    internal: facts.internal === true,
  };
}

interface GearShape {
  center: Vec2;
  teeth: number;
  module: number;
  pressureAngle: number;
  pitchRadius: number;
  tipRadius: number; // of the gear: for a ring gear the inner circle
  internal: boolean;
}

// The rotation of `gear` in mesh with `other`, or the reason they do not mesh.
// The phase of a gear in a direction from its centre is the fractional part of
// (direction − rotation) · teeth / 2π; zero means the axis of a tooth points that way.
// - Two external gears: at the pitch point the phases of the two add up to 1/2 (a tooth faces a space).
// - An external gear inside a ring: the pitch point lies in the same direction from both centres and
//   the phases are equal (a tooth of the gear points into a tooth space of the ring).
function meshRotation(gear: GearShape, other: Mate): { rotation: number; distance: number } | string {
  const relative = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);
  if (relative(gear.module, other.module) > 1e-6) return `the modules differ (${round(gear.module)} and ${round(other.module)})`;
  if (Math.abs(gear.pressureAngle - other.pressureAngle) > 1e-9) return 'the pressure angles differ';
  if (gear.internal && other.internal) return 'two internal gears cannot mesh';
  const phase = (direction: number): number => frac(((direction - other.rotation) * other.teeth) / TAU);
  const distance = Math.hypot(gear.center[0] - other.center[0], gear.center[1] - other.center[1]);
  const tolerance = 1e-6 * Math.max(1, gear.pitchRadius + other.pitchRadius);
  if (!gear.internal && !other.internal) {
    if (Math.abs(distance - (gear.pitchRadius + other.pitchRadius)) > tolerance) return `the pitch circles are not tangent from outside (centre distance ${round(distance)}, sum of the radii ${round(gear.pitchRadius + other.pitchRadius)})`;
    const toGear = Math.atan2(gear.center[1] - other.center[1], gear.center[0] - other.center[0]);
    return { rotation: toGear + Math.PI - (frac(0.5 - phase(toGear)) * TAU) / gear.teeth, distance };
  }
  const [ring, planet] = gear.internal ? [gear, other] : [other, gear];
  const expected = ring.pitchRadius - planet.pitchRadius;
  if (expected <= tolerance || Math.abs(distance - expected) > tolerance) return `the pitch circle of the gear does not touch the pitch circle of the ring from inside (centre distance ${round(distance)}, difference of the radii ${round(expected)})`;
  const toPlanet = Math.atan2(planet.center[1] - ring.center[1], planet.center[0] - ring.center[0]);
  return { rotation: toPlanet - (phase(toPlanet) * TAU) / gear.teeth, distance };
}

// Does the tip of one gear of the pair run into the root of the other below its base circle? For
// centres `distance` apart the limit is √(rb² + (distance · sin α)²) with rb the base radius of the
// gear whose tip is judged. An external gear must not have a tip above it; for a ring gear the
// inequality is reversed (its teeth point inwards). Other kinds of interference of an internal mesh
// (a small difference of tooth counts) are not covered; the interference query finds those.
function tipInterference(gear: GearShape, other: GearShape, distance: number): string[] {
  const out: string[] = [];
  const slack = 1e-9 * Math.max(1, gear.pitchRadius + other.pitchRadius);
  const judge = (g: GearShape, name: string) => {
    const limit = Math.hypot(g.pitchRadius * Math.cos(g.pressureAngle), distance * Math.sin(g.pressureAngle));
    if (g.internal ? g.tipRadius < limit - slack : g.tipRadius > limit + slack) out.push(`the tip circle of ${name} (radius ${round(g.tipRadius)}) is ${g.internal ? 'below' : 'above'} the limit ${round(limit)}`);
  };
  if (gear.internal || other.internal) judge(gear.internal ? gear : other, gear.internal ? 'this ring gear' : 'the ring gear in meshWith');
  else {
    judge(gear, `this gear with ${gear.teeth} teeth`);
    judge(other, `the gear in meshWith with ${other.teeth} teeth`);
  }
  return out;
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function involuteGear(input: GeneratorInput): GeneratorResult {
  const circle = input.operands.circle;
  const { frame, chordTolerance } = input;
  const teeth = input.params.teeth as number;
  const pressureAngle = input.params.pressureAngle as number;
  const backlash = input.params.backlash as number;
  const internal = input.params.internal === true;
  const r = circle.radius;
  const module = (2 * r) / teeth;
  const rb = r * Math.cos(pressureAngle);
  // The loop is the gear, or the tool that cuts a ring gear. The "tooth" of the tool is a tooth
  // space of the ring: it starts at the tip circle of the ring and reaches to its root circle.
  const [inner, outer] = internal ? [r - module, r + 1.25 * module] : [r - 1.25 * module, r + module];
  // Half-angle of the tooth of the loop on the pitch circle: an external tooth is thinner by the
  // backlash, a tooth space of a ring wider by it.
  const psi = Math.PI / (2 * teeth) + ((internal ? 1 : -1) * backlash) / (2 * r);
  const halfAt = (rho: number): number => psi + involute(pressureAngle) - involute(Math.acos(Math.min(1, rb / rho)));
  // the width of the tooth at the outer circle, as a length: an edge shorter than the tolerance is no edge
  if (2 * halfAt(outer) * outer <= LENGTH_TOLERANCE) return fail(`the tooth is pointed: with ${teeth} teeth, the pressure angle ${round(pressureAngle / DEGREE)}° and the backlash ${round(backlash)} mm it has no width at the ${internal ? 'root' : 'tip'} circle`);

  // The flank is an involute from the base circle (or from the inner circle, if that is larger) to
  // the outer circle, divided evenly in arc length until the chords stay within the tolerance.
  const from = Math.max(rb, inner);
  const rollAt = (rho: number): number => Math.sqrt(Math.max(0, (rho / rb) ** 2 - 1));
  const [t0, t1] = [rollAt(from), rollAt(outer)];
  const roll = (k: number, n: number): number => Math.sqrt(t0 * t0 + ((t1 * t1 - t0 * t0) * k) / n);
  const polar = (t: number): Vec2 => {
    const rho = rb * Math.sqrt(1 + t * t);
    return [rho, halfAt(rho)];
  };
  const point = ([rho, angle]: Vec2): Vec2 => [rho * Math.cos(angle), rho * Math.sin(angle)];
  // The largest distance of the flank from its chord between two roll angles. The curvature of an
  // involute changes along the chord (it is infinite at the base circle), so the farthest point is
  // not the middle one; the distance has a single maximum, which a ternary search finds.
  const deviation = (ta: number, tb: number): number => {
    const [a, b] = [point(polar(ta)), point(polar(tb))];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) return 0;
    const distance = (t: number): number => {
      const p = point(polar(t));
      return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / length;
    };
    // 24 rounds narrow the interval to 6e-5 of the chord; the distance is flat at its maximum, so
    // the error is far below the margin the offset gets
    let [low, high] = [ta, tb];
    for (let i = 0; i < 24; i++) {
      const [m1, m2] = [low + (high - low) / 3, high - (high - low) / 3];
      if (distance(m1) < distance(m2)) low = m1;
      else high = m2;
    }
    return distance((low + high) / 2);
  };
  let [steps, sagitta] = [1, 0];
  for (;;) {
    sagitta = 0;
    for (let k = 0; k < steps; k++) sagitta = Math.max(sagitta, deviation(roll(k, steps), roll(k + 1, steps)));
    if (sagitta <= chordTolerance || steps >= MAX_FLANK_STEPS) break;
    // The deviation falls with the square of the number of chords: jump just below the estimate,
    // then go on by one. Trying every count on the way would cost the square of the final one.
    steps = Math.min(MAX_FLANK_STEPS, Math.max(steps + 1, Math.floor(0.95 * steps * Math.sqrt(sagitta / chordTolerance))));
  }
  // Chords lie inside the exact tooth. For a gear that is the safe side: the tooth is thinner by at
  // most the tolerance. For the tool of a ring it is not: the ring's teeth would be thicker and gears
  // with zero backlash would overlap. The flank of the tool is therefore moved outwards by the
  // largest deviation of its chords (with a margin for rounding); a curve parallel to an involute is
  // the same involute turned by distance / base radius.
  const widen = internal ? (sagitta * 1.001 + 1e-12) / rb : 0;
  const flank: Vec2[] = []; // [radius, half-angle], from the inner circle outwards
  for (let k = 0; k <= steps; k++) {
    const [rho, angle] = polar(roll(k, steps));
    flank.push([rho, angle + widen]);
  }
  if (inner < rb) flank.unshift([inner, flank[0][1]]); // below the base circle the flank is radial
  const pitch = TAU / teeth;
  const [innerHalf, outerHalf] = [flank[0][1], flank[flank.length - 1][1]];
  if ((pitch - 2 * innerHalf) * inner <= LENGTH_TOLERANCE) return fail(`the teeth overlap at the ${internal ? 'tip' : 'root'} circle: with ${teeth} teeth, the pressure angle ${round(pressureAngle / DEGREE)}° and the backlash ${round(backlash)} mm no space is left between them`);

  // rotation: from the gear in mesh, or the parameter
  const shape: GearShape = { center: circle.center, teeth, module, pressureAngle, pitchRadius: r, tipRadius: internal ? inner : outer, internal };
  const warnings: GeneratedProfile['warnings'] = [];
  let rotation = input.params.rotation as number;
  let meshed = false;
  if ('meshWith' in input.refs) {
    const other = mate(input.refs.meshWith, frame);
    const mesh = typeof other === 'string' ? other : meshRotation(shape, other);
    if (typeof mesh === 'string') warnings.push({ code: 'gearMesh', detail: `${mesh}; the parameter rotation is used` });
    else {
      rotation = mesh.rotation;
      meshed = true;
      const hits = tipInterference(shape, other as Mate, mesh.distance);
      if (hits.length) warnings.push({ code: 'gearInterference', detail: hits.join('; ') });
    }
  }

  // the loop, counter-clockwise: right flank up, tip arc, left flank down, root arc to the next tooth
  const xy: number[] = [];
  const push = (rho: number, angle: number) => xy.push(circle.center[0] + rho * Math.cos(angle), circle.center[1] + rho * Math.sin(angle));
  const outerSteps = arcSteps(2 * outerHalf, outer, chordTolerance);
  const innerSweep = pitch - 2 * innerHalf;
  const innerSteps = arcSteps(innerSweep, inner, chordTolerance);
  // The size of the loop is known before it is built: a profile that is too large is refused here,
  // not after millions of points exist.
  const points = teeth * (2 * flank.length + outerSteps + innerSteps - (internal ? 0 : 2));
  if (points > MAX_PROFILE_POINTS) return fail(tooLarge(points));
  // The points between the ends of an arc. A gear gets points on the circle, so the chords lie
  // inside the exact shape. The tool of a ring gets the corners of the tangents instead (the first
  // and the last chord leave the ends along the tangent), so that it lies outside the exact shape
  // on its arcs as it does on its flanks.
  const arc = (radius: number, start: number, sweep: number, n: number) => {
    if (internal) for (let i = 0; i < n; i++) push(radius / Math.cos(sweep / (2 * n)), start + (sweep * (i + 0.5)) / n);
    else for (let i = 1; i < n; i++) push(radius, start + (sweep * i) / n);
  };
  for (let k = 0; k < teeth; k++) {
    const axis = rotation + k * pitch;
    for (const [rho, angle] of flank) push(rho, axis - angle);
    arc(outer, axis - outerHalf, 2 * outerHalf, outerSteps);
    for (let i = flank.length - 1; i >= 0; i--) push(flank[i][0], axis + flank[i][1]);
    arc(inner, axis + innerHalf, innerSweep, innerSteps);
  }

  const toModel = (u: number, v: number): Vec3 => [frame.origin[0] + u * frame.x[0] + v * frame.y[0], frame.origin[1] + u * frame.x[1] + v * frame.y[1], frame.origin[2] + u * frame.x[2] + v * frame.y[2]];
  const direction: Vec3 = [0, 1, 2].map((i) => Math.cos(rotation) * frame.x[i] + Math.sin(rotation) * frame.y[i]) as Vec3;
  const facts: Facts = {
    module,
    teeth,
    pressureAngle,
    backlash,
    internal,
    pitchDiameter: 2 * r,
    baseDiameter: 2 * rb,
    tipDiameter: 2 * (internal ? inner : outer),
    rootDiameter: 2 * (internal ? outer : inner),
    rotation,
    meshed,
    center: toModel(circle.center[0], circle.center[1]),
    axis: frame.normal,
    toothDirection: direction,
  };
  return { ok: true, regions: [{ outer: { xy, side: 'teeth' }, holes: [] }], facts, warnings };
}

const BUILD: Record<GeneratorName, (input: GeneratorInput) => GeneratorResult> = { involuteGear };
