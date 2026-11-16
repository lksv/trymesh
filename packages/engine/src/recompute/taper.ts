// The section of a tapered extrusion (D45): the rings of its outline and the surfaces of its sides,
// in the coordinates of the sketch. Computed once per recompute step; a tool build only places it
// in a frame (`buildStack`). The rule is in docs/architecture/extrude.md, "Taper".
import type { OutlineCurve } from '../sketch';
import type { FaceInfo } from '../solid';
import type { Extent, Vec3 } from '../types';
import { cross3, unit3 } from '../util';
import { type Move, shown, sideShape, taperRings } from './outline';
import type { Outline, ProfileProblem, ResolvedProfile } from './state';
import type { Section } from './tool-stack';

type Distance = Extract<Extent, { type: 'distance' }>;
const loopsOf = (outline: Outline): OutlineCurve[][] => outline.regions.flatMap((region) => [region.outer, ...region.holes]);

// The section of a profile that has an exact outline, for an extent with a taper that is not zero.
export function taperedSection(profile: ResolvedProfile, extent: Distance & { taper: number }, chordTolerance: number): Section | ProfileProblem {
  const near = profile.outline?.();
  if (!near) return { code: 'invalidProfile', refs: [], message: 'The profile has no exact curves (a generated profile), so it cannot taper.' };
  if ('code' in near) return near;
  const { start, distance, taper } = extent;
  const shift = Math.abs(distance) * Math.tan(taper);
  const degrees = shown((taper * 180) / Math.PI);
  const cure = `Use a smaller taper or a shorter distance, or give the corners radii larger than ${shown(Math.abs(shift))} mm (the move of the outline at the far end), or draw the far outline in a sketch.`;
  const moveAt = (t: number): Move => ({
    subject: t === 1 ? `At the far end of the extrusion, the taper of ${degrees}°` : `At ${shown(t * Math.abs(distance))} mm from the start of the extrusion, the taper of ${degrees}°`,
    cure,
  });
  const rings = taperRings(near, shift, taper, chordTolerance, moveAt, profile.curveOf);
  if ('code' in rings) return rings;

  // the surfaces of the sides, by the curves at the near end and at the far end
  const [nearCurves, farCurves] = [rings[0].outline, rings[rings.length - 1].outline].map((outline) => new Map(loopsOf(outline).flat().map((curve) => [curve.key, curve])));
  const sign = Math.sign(distance);
  const tangent = Math.tan(taper);
  const surfaces = new Map<string, FaceInfo>();
  for (const [key, curve] of nearCurves) {
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
    // the apex; `axis` points from the apex towards the face.
    const far = farCurves.get(key) as Extract<OutlineCurve, { type: 'arc' | 'circle' }>;
    const [r0, r1] = [curve.radius, far.radius];
    const apex = start - (r0 * distance) / (r1 - r0);
    surfaces.set(key, { planar: false, surface: 'cone', apex: [curve.center[0], curve.center[1], apex], axis: [0, 0, Math.sign(start - apex)], halfAngle: Math.abs(taper) });
  }
  return {
    rings: rings.map((ring) => ({ w: start + ring.t * distance, regions: ring.regions })),
    sideOf: (key) => ({ name: profile.sideOf(key).name, info: surfaces.get(key) as FaceInfo }),
  };
}
