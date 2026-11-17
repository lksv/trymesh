// Contract of package 5d (D61): two profile generators, the cycloidal disc and the GT2 pulley, and
// the profile shift of the involute gear. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real catalog of generators and states what
// the package adds to it: two entries, one parameter and one fact of the gear, a point as an
// operand, and the example of an entry. The document does not change shape: a generated profile
// already holds any generator, operands, parameters and facts by the names of the catalog.

import type { GeneratorInput, GeneratorResult, GeneratorSpec } from '../../../packages/engine/src/generators';
import type { GeneratorName, NumberSpec, Vec2 } from '../../../packages/engine/src/index';

// ================================================================ what the catalog gets

// `GeneratorName` of types.ts gets two members.
export type GeneratorNameAfter = GeneratorName | 'cycloidalDisc' | 'gt2Pulley';

// An operand may be a point of the sketch (its own point, the origin, or a point of projected
// geometry such as the centre of a projected circle): the generator gets its solved position.
// `OperandSpec.kinds` takes `point` already (`EntityKind`); what is new is the resolved form and
// its resolution in recompute/profile.ts.
export type ResolvedOperandAfter = { kind: 'circle'; center: Vec2; radius: number } | { kind: 'point'; at: Vec2 };
// What a build function gets: `GeneratorInput` with operands of either kind.
export type GeneratorInputAfter = Omit<GeneratorInput, 'operands'> & { operands: Record<string, ResolvedOperandAfter> };

// An entry gets `example`: the required parameters of a profile that builds, for the example of the
// description for the AI (in place of "the minimum, at least 18") and for a new draft in the app
// (in place of the table `FORM_DEFAULTS` of sketch-commands.ts). The other parameters have defaults.
export type GeneratorSpecAfter = GeneratorSpec & { example: Record<string, number> };

// ================================================================ the profile shift of the gear

// `involuteGear` gets the parameter `shift`: the profile shift coefficient x (a number, not mm; the
// shift is x · module), default 0, which is the gear of today to the last digit.
// - External gear: tooth thickness on the pitch circle s = m (π/2 + 2 x tan α) (less the
//   backlash), tip circle r + m (1 + x), root circle r − m (1.25 − x).
// - Ring gear (`internal`): the same sign rule seen from the teeth of the ring, which point
//   inwards: the space width of the ring on the pitch circle e = m (π/2 + 2 x tan α) (plus the
//   backlash), its tip circle (the inner one) r − m (1 − x), its root circle r + m (1.25 + x).
//   A positive x moves the profile away from the axis of the gear in both cases.
// - In mesh (`meshWith`): the centre distance stays the reference one (the pitch circles touch), so
//   the shifts must keep it: x1 + x2 = 0 for two external gears, x_ring = x_gear for a gear inside
//   a ring (to 1e-9). Otherwise the warning `gearMesh` says by how much they differ and the
//   parameter `rotation` is used, as for any other mesh that does not hold. A shifted centre
//   distance (x1 + x2 ≠ 0) is not supported.
// - Failures: the tooth is pointed at its tip, the teeth overlap at the root (both as today, now
//   with the shift in the message); the outer circle of the loop (the tip of a gear, the root of
//   a ring) is not above the base circle (no involute flank); the inner circle of the loop (the
//   root of a gear r − m (1.25 − x), the tip of a ring r − m (1 − x)) is not above 0. These are the
//   bounds of the coefficient; the catalog gives it none.
export const GEAR_SHIFT = { title: 'Profile shift coefficient', unit: 'none', default: 0 } as const satisfies NumberSpec;
export const GEAR_SHIFT_FACT = { shift: 'profile shift coefficient x; the profile is moved by x · module away from the axis' } as const;

// ================================================================ the cycloidal disc

// `cycloidalDisc`: the disc of a cycloidal drive over the circle of its ring pins.
// - Operand `circle`: the circle the centres of the ring pins lie on (radius R); its centre is the
//   axis of the input and of the ring. A construction circle, or a projected one.
// - The generator does not make the pins; it takes them at the angles of `pinAngle` (a pin there
//   and a circular pattern of it).
// - Parameters: `pins` N (a whole number, 3 to 500; the disc has N − 1 lobes), `pinRadius` Rr (mm,
//   above 0), `eccentricity` E (mm, above 0), `clearance` (mm, 0 or more, default 0: the profile
//   is moved inwards by it, which is the profile for pins larger by it), `rotation` (radians,
//   default 0: the input angle, the direction of the eccentric from the centre of the ring),
//   `pinAngle` (radians, default 0: the pins stand at pinAngle + 2πk/N from the x axis of the
//   sketch about the centre of the circle).
// - The disc stands where it is in mesh at that input angle: its centre is E from the centre of the
//   ring in the direction `rotation`, and it is turned by pinAngle − (rotation − pinAngle) / (N − 1)
//   (the reduction of a drive whose ring is fixed, for pins turned by pinAngle). A second disc of a two-disc drive is the same profile with
//   `rotation` larger by π.
// - The profile, in the frame of the disc (its centre at the origin, at the input angle 0), as
//   published (design.md, "Sources"): x = R cos t − Rr' cos(t + ψ) − E cos(N t),
//   y = −R sin t + Rr' sin(t + ψ) + E sin(N t), ψ = atan2(sin((1 − N) t), R / (E N) − cos((1 − N) t)),
//   t over a full turn, with Rr' = Rr + clearance; the curve runs clockwise and is reversed.
// - The polygon lies inside the exact profile everywhere: it is built for Rr' larger by the largest
//   distance of its chords from the curve (with a margin), so a disc without clearance does not
//   overlap its pins. It is smaller than the exact disc by at most twice the chord tolerance.
// - Every failure is checked with the radius that is built (Rr' and the compensation of the chords);
//   when only the compensation fails a check, more points are taken, within the limit of points.
// - Failures (`invalidProfile` with the message): E · N ≥ R (the curve of the pin centres loops);
//   Rr' not below the smallest radius of curvature of the curve of the pin centres where it bends
//   towards the disc (the profile would turn back on itself: undercut); the pins overlap one
//   another (Rr ≥ R sin(π / N)); the inner circle of the disc R − Rr' − E not above 0; the profile
//   above the limit of points.
// - One side face, `lobes`.
export const CYCLOIDAL_DISC_PARAMS = {
  pins: { title: 'Number of ring pins', unit: 'count', integer: true, min: { value: 3 }, max: { value: 500 } },
  pinRadius: { title: 'Radius of a ring pin', unit: 'mm', min: { value: 0, open: true } },
  eccentricity: { title: 'Eccentricity', unit: 'mm', min: { value: 0, open: true } },
  clearance: { title: 'Clearance (the profile moved inwards)', unit: 'mm', min: { value: 0 }, default: 0 },
  rotation: { title: 'Input angle', unit: 'rad', default: 0 },
  pinAngle: { title: 'Angle of the first pin', unit: 'rad', default: 0 },
} as const satisfies Record<string, NumberSpec>;
export const CYCLOIDAL_DISC_FACTS = {
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
} as const;
export const CYCLOIDAL_DISC_EXAMPLE = { pins: 12, pinRadius: 2.5, eccentricity: 1 } as const;

// ================================================================ the GT2 pulley

// `gt2Pulley`: a timing pulley for the belt GT2 of 2 mm pitch.
// - Operand `center`: a point of the sketch, the axis of the pulley.
// - Parameters: `teeth` (the number of grooves, a whole number, 12 to 500: Gates' tables of 2 mm
//   sprockets start at 12), `allowance` (mm, default 0: the outline moved outwards by it, as
//   a print compensation; negative moves it inwards), `rotation` (radians, default 0: the direction
//   of the axis of one groove).
// - The pitch diameter is teeth · 2 / π; the outside diameter is that less twice the pitch line
//   differential of the belt (design.md, "Sources"). The groove is the arc construction of design.md,
//   "The GT2 pulley" (bottom r 0.555, flanks r 1.0, fillets r 0.15, 0.75 deep), repeated `teeth`
//   times. `allowance` moves every arc about its own centre.
// - The polygon lies inside the exact outline: points on convex arcs, corners of tangents on
//   concave ones (the bottom of a groove), so a belt modelled exactly does not overlap it.
// - One side face, `grooves`.
export const GT2_PULLEY_PARAMS = {
  teeth: { title: 'Number of grooves', unit: 'count', integer: true, min: { value: 12 }, max: { value: 500 } },
  allowance: { title: 'Allowance (the outline moved outwards)', unit: 'mm', default: 0 },
  rotation: { title: 'Rotation', unit: 'rad', default: 0 },
} as const satisfies Record<string, NumberSpec>;
export const GT2_PULLEY_FACTS = {
  teeth: 'number of grooves',
  pitch: 'belt pitch, 2 mm',
  pitchDiameter: 'pitch diameter, teeth · 2 / π (on the pitch line of the belt, outside the pulley)',
  outsideDiameter: 'outside diameter of the pulley (with the allowance)',
  rootDiameter: 'diameter of the circle of the bottoms of the grooves (with the allowance)',
  allowance: 'allowance used',
  rotation: 'rotation used, radians',
  center: 'centre in model coordinates',
  axis: 'direction of the axis in model coordinates',
} as const;
export const GT2_PULLEY_EXAMPLE = { teeth: 20 } as const;

// ================================================================ the entries, as the catalog will hold them

// The operands of the two entries.
export const CYCLOIDAL_DISC_OPERANDS = [{ field: 'circle', kinds: ['circle'] }] as const;
export const GT2_PULLEY_OPERANDS = [{ field: 'center', kinds: ['point'] }] as const;

// The build functions of the two entries, pure functions like `involuteGear`: the solved operands,
// the parameters, the frame and the chord tolerance in; regions, facts and warnings, or a failure
// with a message, out.
export declare function cycloidalDisc(input: GeneratorInputAfter): GeneratorResult;
export declare function gt2Pulley(input: GeneratorInputAfter): GeneratorResult;
// A pulley at a point of a sketch on XY, as the recompute hands it over.
export const gt2At = (frame: GeneratorInput['frame']): GeneratorResult =>
  gt2Pulley({ operands: { center: { kind: 'point', at: [60, 0] } }, params: { teeth: 20, allowance: 0, rotation: 0 }, refs: {}, frame, chordTolerance: 0.01 });

// ================================================================ what the package does not add

// - No upgrade step. A build without the package refuses a generator it does not know and
//   a parameter of a known generator it does not know (`profileSource` lists the names of the
//   catalog), so nothing is dropped without a word. A document saved by a build with the package
//   holds `shift: 0` in every gear (a parameter left out is stored with its default), so an older
//   build refuses every document with a gear, with the name of the parameter in the message.
// - No feature type, no face role (the sides are `side` faces named by the catalog: `lobes`,
//   `grooves`), no issue code, no command, no query.
