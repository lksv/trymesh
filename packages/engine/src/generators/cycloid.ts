// The cycloidal disc of the generator catalog (D61, docs/d36/5d-generators/design.md): the disc of
// a cycloidal drive over the circle of its ring pins, in mesh with the pins at an input angle.
//
// Sources (design.md, "Sources", [S1]): the profile of Shin & Kwon (2006) as W. Roozing and
// G. Roozing (2023, Eq. 1–3) give it, written with atan2 as O. Younis gives it; the condition
// E N / R < 1 of Chianca (2018) and Miao et al. No source gives the undercut condition in closed
// form: the rule here (the radius of the pins below the smallest radius of curvature of the curve of
// the pin centres where it bends towards the disc) was checked numerically against a self-crossing
// test (design.md, "Measured", `undercut`), and the frame of the equations against the envelope of
// the pins over a full turn of the input (`cycloid`).
import type { GeneratedProfile, GeneratorInput, GeneratorResult, GeneratorSpec } from '../generators';
import type { Facts, Vec2 } from '../types';
import { MAX_PROFILE_POINTS, TAU, fail, round, toModel, tooLarge } from './common';

export const CYCLOIDAL_DISC: GeneratorSpec = {
  title: 'Cycloidal disc',
  summary:
    'The disc of a cycloidal drive over the circle of its ring pins (a construction or a projected circle of radius R; its centre is the axis of the input and of the ring). ' +
    'The generator does not make the pins: draw a pin of radius `pinRadius` at the angle `pinAngle` on the circle and repeat it by a circular pattern of `pins` copies. ' +
    'The disc has pins − 1 lobes and stands where it meshes at the input angle `rotation`: its centre is `eccentricity` from the centre of the circle in that direction (the eccentric bore goes there; read `center` from the facts), and it is turned by pinAngle − (rotation − pinAngle) / (pins − 1). A second disc of a two-disc drive is the same profile with `rotation` larger by π. ' +
    '`clearance` moves the profile inwards (the disc for pins larger by it). The polygon lies inside the exact profile, so a disc without clearance does not enter its pins. ' +
    'It cannot be built when eccentricity · pins ≥ R, when the pins overlap one another (pinRadius ≥ R sin(π / pins)), when the profile would turn back on itself (undercut: pins too large for the curvature) or when the circle of the bottoms reaches the centre; each is the error invalidProfile with the reason. ' +
    'The example needs a circle of radius 20 or more. No bore, no output holes.',
  operands: [{ field: 'circle', kinds: ['circle'] }],
  params: {
    pins: { title: 'Number of ring pins', unit: 'count', integer: true, min: { value: 3 }, max: { value: 500 } },
    pinRadius: { title: 'Radius of a ring pin', unit: 'mm', min: { value: 0, open: true } },
    eccentricity: { title: 'Eccentricity', unit: 'mm', min: { value: 0, open: true } },
    clearance: { title: 'Clearance (the profile moved inwards)', unit: 'mm', min: { value: 0 }, default: 0 },
    rotation: { title: 'Input angle', unit: 'rad', default: 0 },
    pinAngle: { title: 'Angle of the first pin', unit: 'rad', default: 0 },
  },
  refs: {},
  sides: ['lobes'],
  facts: {
    pins: 'number of ring pins N',
    lobes: 'number of lobes of the disc, N − 1',
    ratio: 'turns of the input per turn of the disc, the ring fixed: N − 1 (the disc turns against the input)',
    pinCircleDiameter: 'diameter of the circle of the pin centres, 2R',
    pinDiameter: 'diameter of a ring pin, 2 Rr',
    eccentricity: 'eccentricity E',
    clearance: 'clearance the profile was moved inwards by',
    outerDiameter: 'diameter of the circle the tips of the lobes reach, 2 (R − Rr − clearance + E)',
    innerDiameter: 'diameter of the circle of the bottoms between the lobes, 2 (R − Rr − clearance − E)',
    rotation: 'input angle used, radians',
    pinAngle: 'angle of the first pin from the x axis of the sketch',
    discRotation: 'angle the disc is turned by, pinAngle − (rotation − pinAngle) / (N − 1)',
    center: 'centre of the disc in model coordinates (the eccentric bore goes here)',
    ringCenter: 'centre of the circle of the pins in model coordinates',
    axis: 'direction of the axis in model coordinates',
  },
  example: { pins: 12, pinRadius: 2.5, eccentricity: 1 },
};

// A point of the profile for the pin radius `rr` in the frame of the disc at the input angle 0: the
// disc centred at the origin, the centre of the ring at (−E, 0), the pins at the angles 2πk/N about
// it. The curve runs clockwise from (R − rr − E, 0), the bottom where the pin on the x axis sits.
export function discPoint(R: number, rr: number, E: number, N: number, t: number): Vec2 {
  const psi = Math.atan2(Math.sin((1 - N) * t), R / (E * N) - Math.cos((1 - N) * t));
  return [R * Math.cos(t) - rr * Math.cos(t + psi) - E * Math.cos(N * t), -R * Math.sin(t) + rr * Math.sin(t + psi) + E * Math.sin(N * t)];
}

// The smallest radius of curvature of the curve of the pin centres, z(t) = R e^(−it) − E e^(−iNt),
// where it bends towards the disc. With c = cos((N − 1) t) its speed is |z'|² = A − B c and the
// cross product of z' and z'' is −(C − D c); it bends towards the disc (to the right of a curve that
// runs clockwise) where C − D c > 0, and the radius of curvature there is (A − B c)^(3/2) / (C − D c).
// That function of c has one critical point, c* = (3 B C − 2 D A) / (B D), so its smallest value on
// the part of [−1, 1] where it is defined is at c* or at an end.
export function smallestCurvatureRadius(R: number, E: number, N: number): number {
  const [A, B, C, D] = [R * R + E * E * N * N, 2 * R * E * N, R * R + E * E * N ** 3, R * E * N * (N + 1)];
  const radius = (c: number): number => (C - D * c > 0 ? (A - B * c) ** 1.5 / (C - D * c) : Infinity);
  const critical = (3 * B * C - 2 * D * A) / (B * D);
  return Math.min(radius(-1), radius(1), critical > -1 && critical < 1 ? radius(critical) : Infinity);
}

// The largest distance of the curve between ta and tb (pin radius rr) from the chord between its
// ends. Sampled first, then a ternary search about the largest sample: along a short chord the
// distance has one maximum.
function deviation(R: number, rr: number, E: number, N: number, ta: number, tb: number): number {
  const [a, b] = [discPoint(R, rr, E, N, ta), discPoint(R, rr, E, N, tb)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length === 0) return 0;
  const distance = (t: number): number => {
    const p = discPoint(R, rr, E, N, t);
    return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / length;
  };
  const SAMPLES = 8;
  let best = 1;
  for (let k = 2; k < SAMPLES; k++) if (distance(ta + ((tb - ta) * k) / SAMPLES) > distance(ta + ((tb - ta) * best) / SAMPLES)) best = k;
  let [low, high] = [ta + ((tb - ta) * (best - 1)) / SAMPLES, ta + ((tb - ta) * (best + 1)) / SAMPLES];
  for (let i = 0; i < 30; i++) {
    const [m1, m2] = [low + (high - low) / 3, high - (high - low) / 3];
    if (distance(m1) < distance(m2)) low = m1;
    else high = m2;
  }
  return Math.max(distance((low + high) / 2), distance(ta + ((tb - ta) * best) / SAMPLES));
}

// The points of one lobe, as values of t from 0 up to (not including) 2π/(N − 1), such that every
// chord lies within `target` of the curve for the pin radius `rr`: a chord that does not is halved,
// so the points gather where the curve bends sharply (the bottoms between the lobes, and the tips
// of a disc near undercut). The curve repeats every lobe turned (t → t + 2π/(N − 1)), so one lobe
// is all of it. undefined: more than `limit` points.
const START_CHORDS = 16;
function lobePoints(R: number, rr: number, E: number, N: number, target: number, limit: number): number[] | undefined {
  const lobe = TAU / (N - 1);
  const out: number[] = [];
  const split = (ta: number, tb: number, depth: number): boolean => {
    if (out.length > limit) return false;
    if (depth >= 40 || deviation(R, rr, E, N, ta, tb) <= target) {
      out.push(ta);
      return true;
    }
    const middle = (ta + tb) / 2;
    return split(ta, middle, depth + 1) && split(middle, tb, depth + 1);
  };
  for (let k = 0; k < START_CHORDS; k++) if (!split((lobe * k) / START_CHORDS, (lobe * (k + 1)) / START_CHORDS, 0)) return undefined;
  return out.length > limit ? undefined : out;
}
// The largest deviation of the chords between the points of a lobe from the curve for `rr`.
function largestDeviation(R: number, rr: number, E: number, N: number, points: number[]): number {
  const lobe = TAU / (N - 1);
  return points.reduce((worst, t, k) => Math.max(worst, deviation(R, rr, E, N, t, k + 1 < points.length ? points[k + 1] : lobe)), 0);
}

const MARGIN = 1.001; // the compensation of the chords is taken larger by this, for rounding

export function cycloidalDisc(input: GeneratorInput): GeneratorResult {
  const circle = input.operands.circle;
  if (circle?.kind !== 'circle') return fail('the operand circle is not a circle');
  const { frame, chordTolerance } = input;
  const N = input.params.pins as number;
  const Rr = input.params.pinRadius as number;
  const E = input.params.eccentricity as number;
  const clearance = input.params.clearance as number;
  const rotation = input.params.rotation as number;
  const pinAngle = input.params.pinAngle as number;
  const R = circle.radius;
  const drive = `the pin circle of radius ${round(R)}, ${N} pins of radius ${round(Rr)} and the eccentricity ${round(E)}`;

  // The conditions on the drive itself.
  if (E * N >= R) return fail(`the eccentricity times the number of pins (${round(E * N)}) is not below the radius of the pin circle ${round(R)}: the curve of the pin centres loops, so the disc has no profile; lower the eccentricity or the number of pins, or enlarge the circle`);
  if (Rr >= R * Math.sin(Math.PI / N)) return fail(`the pins overlap one another: with ${drive} a pin may have a radius below ${round(R * Math.sin(Math.PI / N))}`);
  const limit = smallestCurvatureRadius(R, E, N);
  const undercut = (radius: number): boolean => radius >= limit;
  const noBottom = (radius: number): boolean => R - radius - E <= 0;
  const r1 = Rr + clearance;
  const withClearance = clearance > 0 ? ` with the clearance ${round(clearance)}` : '';
  if (undercut(r1)) return fail(`the profile turns back on itself (undercut): with ${drive}${withClearance} the pins as built may have a radius below ${round(limit)}; lower the pin radius or the eccentricity`);
  if (noBottom(r1)) return fail(`the circle of the bottoms between the lobes reaches the centre of the disc: with ${drive}${withClearance} it has the radius ${round(R - r1 - E)}`);

  // The polygon lies inside the exact disc: it is built on the curve for pins larger by the largest
  // deviation of its chords (a chord of a bottom lies outside its curve by up to that). The checks of
  // the profile see that radius, so the chords are taken fine enough that it passes them, with
  // room: within the chord tolerance, and within half the distance of the exact disc from the limit
  // of undercut and from the centre. A disc that needs more points than the limit for that is
  // refused, and the message says which condition it is near.
  const lobes = N - 1;
  const maxPerLobe = Math.floor(MAX_PROFILE_POINTS / lobes);
  const room = Math.min((limit - r1) / 2, (R - E - r1) / 2) / MARGIN;
  const target = Math.min(chordTolerance, room);
  const near = (limit - r1 <= R - E - r1 ? `the limit of undercut (the pins as built may have a radius below ${round(limit)})` : 'the centre of the disc (the circle of the bottoms)');
  const nearCondition = `the disc is within the chord tolerance of ${near}: with ${drive}${withClearance} its polygon cannot be built inside the exact profile`;
  const points = lobePoints(R, r1, E, N, target, maxPerLobe);
  if (!points)
    return fail(
      target < chordTolerance
        ? `${nearCondition} within ${MAX_PROFILE_POINTS} points; lower the pin radius or the eccentricity`
        : `the disc would need more than ${MAX_PROFILE_POINTS} points to keep its chords within the chord tolerance; raise the chord tolerance${N > 3 ? ' or lower the number of pins' : ''}`,
    );
  // The curve for larger pins is the exact one moved inwards; its chords deviate a little more, so
  // the radius is found again until its own chords are covered. It converges in a round or two (the
  // deviation changes to second order); a radius that does not cover its chords is never built.
  let built = r1 + largestDeviation(R, r1, E, N, points) * MARGIN + 1e-12;
  let covered = false;
  for (let i = 0; i < 8 && !covered; i++) {
    const own = largestDeviation(R, built, E, N, points);
    covered = built - r1 >= own * MARGIN;
    if (!covered) built = r1 + own * MARGIN + 1e-12;
  }
  if (!covered) return fail(`${nearCondition}: the compensation of its chords does not settle`);
  if (undercut(built) || noBottom(built)) return fail(nearCondition);

  // Placement: the centre of the disc is E from the centre of the ring in the direction of the
  // input angle, and the disc is turned by pinAngle − (rotation − pinAngle) / (N − 1).
  const discRotation = pinAngle - (rotation - pinAngle) / lobes;
  const center: Vec2 = [circle.center[0] + E * Math.cos(rotation), circle.center[1] + E * Math.sin(rotation)];
  const [cos, sin] = [Math.cos(discRotation), Math.sin(discRotation)];
  const lobe = TAU / lobes;
  const ts = Array.from({ length: lobes }, (_, j) => points.map((t) => j * lobe + t)).flat();
  const xy: number[] = [];
  // the curve runs clockwise; the loop is counter-clockwise, so t runs backwards from 0 (the bottom
  // on the x axis of the disc)
  for (let i = 0; i < ts.length; i++) {
    const [x, y] = discPoint(R, built, E, N, ts[(ts.length - i) % ts.length]);
    xy.push(center[0] + x * cos - y * sin, center[1] + x * sin + y * cos);
  }

  const facts: Facts = {
    pins: N,
    lobes,
    ratio: lobes,
    pinCircleDiameter: 2 * R,
    pinDiameter: 2 * Rr,
    eccentricity: E,
    clearance,
    outerDiameter: 2 * (R - r1 + E),
    innerDiameter: 2 * (R - r1 - E),
    rotation,
    pinAngle,
    discRotation,
    center: toModel(frame, center[0], center[1]),
    ringCenter: toModel(frame, circle.center[0], circle.center[1]),
    axis: frame.normal,
  };
  const profile: GeneratedProfile = { regions: [{ outer: { xy, side: 'lobes' }, holes: [] }], facts, warnings: [] };
  return { ok: true, ...profile };
}
