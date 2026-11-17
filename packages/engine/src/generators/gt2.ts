// The GT2 pulley of the generator catalog (D61, docs/d36/5d-generators/design.md): a timing pulley
// for the belt GT2 of 2 mm pitch, at a point of the sketch.
//
// Sources (design.md, "Sources" and "The GT2 pulley"): the outside diameter teeth · 2/π − 2 · 0.254
// is the table of Gates' 2 mm sprockets ([S4], P.D. − O.D. = 0.51 mm on every row; the formula gives
// it to the last digit, "Measured", `gt2`). Gates do not publish the groove. The groove here is the
// construction of four arcs with named radii of the gear workbench of FreeCAD ([S5]: h 0.75, r0 0.555,
// r1 1.0, rs 0.15, offset 0.40), whose numbers cite no source: only the numbers and the construction
// are taken, written anew from the words of the design. A known limit: the depth 0.75 against the
// tooth height 0.76 of Gates' belt, and one groove for every count where Gates vary it.
import type { GeneratorInput, GeneratorResult, GeneratorSpec } from '../generators';
import type { Facts, Vec2 } from '../types';
import { TAU, arcSteps, fail, round, toModel } from './common';

export const GT2_PITCH = 2; // mm
export const GT2_GROOVE = {
  pitchLineDifferential: 0.254, // mm per side between the pitch circle and the outside circle
  depth: 0.75, // h
  bottom: 0.555, // r0, the radius of the bottom of the groove
  flank: 1.0, // r1, the radius of a flank
  fillet: 0.15, // rs, the radius of the fillet between a flank and the tip circle
  offset: 0.4, // the centre of a flank lies this far to the other side of the axis of the groove
} as const;

export const GT2_PULLEY: GeneratorSpec = {
  title: 'GT2 pulley',
  summary:
    'A timing pulley for the GT2 belt of 2 mm pitch, centred at a point of the sketch (an own point, `origin` or a point of projected geometry such as the centre of a projected circle). ' +
    'The pitch diameter is teeth · 2 / π and the outside diameter 0.508 mm less (Gates\' tables of 2 mm sprockets). The groove is a construction of four arcs (bottom radius 0.555, flanks 1.0, fillets 0.15, 0.75 deep) from the gear workbench of FreeCAD, the same for every number of grooves; Gates do not publish theirs. ' +
    '`allowance` moves the outline outwards (negative: inwards), the print compensation of a pulley that comes out too tight or too loose on its belt. `rotation` is the direction of the axis of one groove. The polygon lies inside the exact outline. Flanges are plain extrusions.',
  operands: [{ field: 'center', kinds: ['point'] }],
  params: {
    teeth: { title: 'Number of grooves', unit: 'count', integer: true, min: { value: 12 }, max: { value: 500 } },
    allowance: { title: 'Allowance (the outline moved outwards)', unit: 'mm', default: 0 },
    rotation: { title: 'Rotation', unit: 'rad', default: 0 },
  },
  refs: {},
  sides: ['grooves'],
  facts: {
    teeth: 'number of grooves',
    pitch: 'belt pitch, 2 mm',
    pitchDiameter: 'pitch diameter, teeth · 2 / π (on the pitch line of the belt, outside the pulley)',
    outsideDiameter: 'outside diameter of the pulley (with the allowance)',
    rootDiameter: 'diameter of the circle of the bottoms of the grooves (with the allowance)',
    allowance: 'allowance used',
    rotation: 'rotation used, radians',
    center: 'centre in model coordinates',
    axis: 'direction of the axis in model coordinates',
  },
  example: { teeth: 20 },
};

// One arc of the outline: its centre, its radius as built, the angles of its ends about the centre
// and the sense the outline runs along it. A convex arc (its centre in the material: the tip circle,
// a fillet) is run counter-clockwise and gets points on the arc, so its chords lie inside; a concave
// one (its centre in the groove: the bottom, a flank) is run clockwise and gets the corners of its
// tangents, `radius / cos(step / 2)` from the centre, so no chord enters the groove.
interface Arc {
  center: Vec2;
  radius: number;
  from: number;
  to: number;
  convex: boolean;
}
const angleOf = (p: Vec2, c: Vec2): number => Math.atan2(p[1] - c[1], p[0] - c[0]);
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const sweepOf = (arc: Arc): number => (arc.convex ? positive(arc.to - arc.from) : -positive(arc.from - arc.to));

// The arcs of one groove whose axis points along +y, for the tip radius `tip` and the allowance
// `a`: right fillet, right flank, bottom, left flank, left fillet, the order of a counter-clockwise
// run (from x > 0 to x < 0 at the top). The centres do not depend on the allowance; the radii move
// by it, so every joint stays tangent. A text = why the groove cannot be built.
export function grooveArcs(tip: number, a: number): Arc[] | string {
  const { depth, bottom, flank, fillet, offset } = GT2_GROOVE;
  const [r0, r1, rs] = [bottom - a, flank - a, fillet + a];
  if (r0 <= 0 || r1 <= 0) return `an allowance of ${round(a)} mm makes the ${r0 <= 0 ? 'bottom' : 'flanks'} of the grooves vanish; it must stay below ${round(Math.min(bottom, flank))} mm`;
  if (rs <= 0) return `an allowance of ${round(a)} mm makes the fillets at the tips vanish; it must stay above ${round(-fillet)} mm`;
  // the bottom about a point of the axis; a flank about a point `offset` to the other side of the
  // axis, which touches the bottom from outside it (its circle contains the bottom's)
  const c0: Vec2 = [0, tip - depth + bottom];
  const c1: Vec2 = [-offset, c0[1] + Math.sqrt((flank - bottom) ** 2 - offset ** 2)];
  // the fillet: its centre `fillet` below the tip circle and `flank + fillet` from the centre of the
  // flank, on the side of the flank (x > 0): the meeting point of two circles
  const [rf, d] = [tip - fillet, flank + fillet];
  const dc = Math.hypot(c1[0], c1[1]);
  const along = (rf * rf - d * d + dc * dc) / (2 * dc);
  const across = rf * rf - along * along;
  if (across <= 0) return 'the pulley is too small for the groove';
  const [ux, uy] = [c1[0] / dc, c1[1] / dc];
  // of the two meeting points the one right of the axis of the groove
  const cf: Vec2 = [along * ux + Math.sqrt(across) * uy, along * uy - Math.sqrt(across) * ux];
  if (cf[0] <= 0) return 'the pulley is too small for the groove';
  const mirror = (p: Vec2): Vec2 => [-p[0], p[1]];
  // the tangent points as angles about each centre; they do not depend on the allowance
  const toward = (from: Vec2, to: Vec2): number => angleOf(to, from);
  const right = {
    fillet: { center: cf, from: angleOf(cf, [0, 0]), to: toward(cf, c1) },
    flank: { center: c1, from: toward(c1, cf), to: toward(c1, c0) },
  };
  const left = {
    fillet: { center: mirror(cf), from: Math.PI - right.fillet.to, to: Math.PI - right.fillet.from },
    flank: { center: mirror(c1), from: Math.PI - right.flank.to, to: Math.PI - right.flank.from },
  };
  return [
    { ...right.fillet, radius: rs, convex: true },
    { ...right.flank, radius: r1, convex: false },
    { center: c0, radius: r0, from: right.flank.to, to: Math.PI - right.flank.to, convex: false },
    { ...left.flank, radius: r1, convex: false },
    { ...left.fillet, radius: rs, convex: true },
  ];
}

export function gt2Pulley(input: GeneratorInput): GeneratorResult {
  const operand = input.operands.center;
  if (operand?.kind !== 'point') return fail('the operand center is not a point');
  const { frame, chordTolerance } = input;
  const teeth = input.params.teeth as number;
  const allowance = input.params.allowance as number;
  const rotation = input.params.rotation as number;
  const pitchRadius = (teeth * GT2_PITCH) / TAU;
  const tip = pitchRadius - GT2_GROOVE.pitchLineDifferential;
  const arcs = grooveArcs(tip, allowance);
  if (typeof arcs === 'string') return fail(arcs);
  // the land between two grooves: the tip circle from the left fillet of one groove to the right
  // fillet of the next, counter-clockwise
  const pitch = TAU / teeth;
  const halfGroove = Math.PI / 2 - arcs[0].from; // the angle of the end of the right fillet from the axis
  if (pitch - 2 * halfGroove <= 0) return fail('the grooves overlap: no land is left between them');
  const tipRadius = tip + allowance;

  const xy: number[] = [];
  for (let k = 0; k < teeth; k++) {
    // the local frame of the groove (its axis along +y) turned so that the axis points at the angle
    // `rotation + k · pitch` about the centre
    const turn = rotation + k * pitch - Math.PI / 2;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    const push = (x: number, y: number) => xy.push(operand.at[0] + x * cos - y * sin, operand.at[1] + x * sin + y * cos);
    const at = (center: Vec2, radius: number, angle: number) => push(center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle));
    for (const arc of arcs) {
      const sweep = sweepOf(arc);
      const n = arcSteps(Math.abs(sweep), arc.radius, chordTolerance);
      at(arc.center, arc.radius, arc.from); // the joint with the arc before, a point of both
      if (arc.convex) for (let i = 1; i < n; i++) at(arc.center, arc.radius, arc.from + (sweep * i) / n);
      else for (let i = 0; i < n; i++) at(arc.center, arc.radius / Math.cos(sweep / (2 * n)), arc.from + (sweep * (i + 0.5)) / n);
    }
    // the end of the left fillet, then the land on the tip circle to the next groove
    const last = arcs[arcs.length - 1];
    at(last.center, last.radius, last.to);
    const landFrom = Math.PI / 2 + halfGroove;
    const landSweep = pitch - 2 * halfGroove;
    const n = arcSteps(landSweep, tipRadius, chordTolerance);
    for (let i = 1; i < n; i++) at([0, 0], tipRadius, landFrom + (landSweep * i) / n);
  }

  const facts: Facts = {
    teeth,
    pitch: GT2_PITCH,
    pitchDiameter: 2 * pitchRadius,
    outsideDiameter: 2 * tipRadius,
    rootDiameter: 2 * (tip - GT2_GROOVE.depth + allowance),
    allowance,
    rotation,
    center: toModel(frame, operand.at[0], operand.at[1]),
    axis: frame.normal,
  };
  return { ok: true, regions: [{ outer: { xy, side: 'grooves' }, holes: [] }], facts, warnings: [] };
}
