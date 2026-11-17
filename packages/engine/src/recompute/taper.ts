// The section of a tapered extrusion (D45): the rings of its outline and the surfaces of its sides,
// in the coordinates of the sketch. Computed once per recompute step; a tool build only places it
// in a frame (`buildStack`). The rule is in docs/architecture/extrude.md, "Taper".
import type { FaceInfo } from '../solid';
import type { Extent, Vec3 } from '../types';
import { LENGTH_TOLERANCE, cross3, unit3 } from '../util';
import { type Move, shown, sideShape, taperRings } from './outline';
import type { ProfileProblem, ResolvedProfile } from './state';
import type { Section } from './tool-stack';

type Distance = Extract<Extent, { type: 'distance' }>;

// The move of the outline at the far end of a tapered extent. A taper whose move is not above the
// length tolerance changes nothing that could be measured and is built as the prism: a cone with
// its apex kilometres away would only lose its precision (an expression meant to give zero leaves
// a rounding remainder).
export const taperShift = (extent: Distance): number => Math.abs(extent.distance) * Math.tan(extent.taper ?? 0);
export const tapers = (extent: Extent): extent is Distance & { taper: number } => extent.type === 'distance' && Math.abs(taperShift(extent)) > LENGTH_TOLERANCE;

// The section of a profile that has an exact outline, for an extent that `tapers`. `wall`: the
// profile is a wall, whose refusals say what to do about its thickness.
export function taperedSection(profile: ResolvedProfile, extent: Distance & { taper: number }, chordTolerance: number, wall: boolean): Section | ProfileProblem {
  const near = profile.outline?.();
  if (!near) return { code: 'invalidProfile', refs: [], message: 'The profile has no exact curves (a generated profile), so it cannot taper.' };
  if ('code' in near) return near;
  const { start, distance, taper } = extent;
  const shift = taperShift(extent);
  const degrees = shown((taper * 180) / Math.PI);
  const moved = `${shown(Math.abs(shift))} mm`;
  const cure = wall
    ? `Use a smaller taper or a shorter distance, or make the wall thicker or its bends wider: at the far end every side moves by ${moved}.`
    : `Use a smaller taper or a shorter distance, or make the profile wider and its corner radii larger than ${moved} (the move of the outline at the far end), or draw the far outline in a sketch.`;
  // The ring at the start is the profile itself, which may still fail the tests of a moved outline
  // (two selected regions that meet in a point): no taper cures that.
  const moveAt = (t: number): Move =>
    t === 0
      ? { subject: 'At the start of the extrusion, the profile', cure: 'A tapered profile has to be one outline whose loops do not touch: select regions that do not meet in a point, or extrude them without a taper.' }
      : { subject: t === 1 ? `At the far end of the extrusion, the taper of ${degrees}°` : `At ${shown(t * Math.abs(distance))} mm from the start of the extrusion, the taper of ${degrees}°`, cure };
  const rings = taperRings(near, shift, taper, chordTolerance, moveAt, profile.curveOf);
  if ('code' in rings) return rings;

  // the surfaces of the sides, by the curves at the start
  const sign = Math.sign(distance);
  const tangent = Math.tan(taper);
  const surfaces = new Map<string, FaceInfo>();
  for (const curve of rings[0].outline.regions.flatMap((region) => [region.outer, ...region.holes]).flat()) {
    const key = curve.key;
    if (curve.type === 'line') {
      // The plane through the near line and the far one. A loop moves to the right of its travel,
      // by `sign · tan(taper)` for every unit along the normal. `origin`: the start of the sketch
      // curve where the plane meets the sketch plane; `y` across the line, on the side of the normal.
      const travel = unit3([curve.to[0] - curve.from[0], curve.to[1] - curve.from[1], 0]);
      const right: Vec3 = [travel[1], -travel[0], 0];
      // the line as the straight extrusion describes its side (a wall gives its ends itself)
      const shape = profile.sideOf(key).shape;
      const { a, b } = shape.type === 'line' ? shape : (sideShape(curve) as Extract<typeof shape, { type: 'line' }>);
      const across = -start * sign * tangent;
      const y = unit3([right[0] * sign * tangent, right[1] * sign * tangent, 1]);
      surfaces.set(key, { planar: true, origin: [a[0] + right[0] * across, a[1] + right[1] * across, 0], y, normal: unit3(cross3([b[0] - a[0], b[1] - a[1], 0], y)) });
      continue;
    }
    // A cone about the normal through the centre: the radius is linear in the level and zero at
    // the apex; `axis` points from the apex towards the face. A loop moves to the right of its
    // travel, so the radius of a curve run counter-clockwise grows by the move and of one run
    // clockwise shrinks by it: the change over the extent is `turn · shift`, exactly, without the
    // difference of two radii that are nearly equal.
    const turn = curve.type === 'circle' ? (curve.ccw ? 1 : -1) : Math.sign(curve.sweep);
    const apex = start - (curve.radius * distance) / (turn * shift);
    surfaces.set(key, { planar: false, surface: 'cone', apex: [curve.center[0], curve.center[1], apex], axis: [0, 0, Math.sign(start - apex)], halfAngle: Math.abs(taper), along: [0, 0, 1] });
  }
  return {
    rings: rings.map((ring) => ({ w: start + ring.t * distance, regions: ring.regions })),
    sideOf: (key) => ({ name: profile.sideOf(key).name, info: surfaces.get(key) as FaceInfo }),
  };
}
