// The extent of a tool along the normal of its sketch plane.
import type { ExtrudeFeature, Frame, Solid } from '../types';

// The interval of the tool along the normal of the sketch plane, measured from the plane: [start,
// end]. "Through all" takes the extent of all targets together along the normal (their vertices
// projected onto it) and adds an overshoot, so that the cap of the tool does not lie in a face of
// a body. The overshoot follows the largest coordinate of the targets and of the sketch plane, so
// it normally stays far above the resolution of the kernel adapter (about 1e-4 of the largest
// coordinate of body and tool). Where it does not (a profile much larger than the targets), the
// adapter takes the cap as flush with the face, which it handles like any flush face.
// A side on which the targets do not reach gets just the overshoot: the tool then misses them and
// the feature reports `noEffect`.
export function toolSpan(extent: ExtrudeFeature['extent'], frame: Frame, targets: Solid[]): [number, number] {
  if (extent.type === 'distance') return [extent.start, extent.start + extent.distance];
  let [low, high, reach] = [0, 0, Math.max(...frame.origin.map(Math.abs))];
  for (const solid of targets) {
    const p = solid.positions;
    for (let i = 0; i < p.length; i += 3) {
      const along = (p[i] - frame.origin[0]) * frame.normal[0] + (p[i + 1] - frame.origin[1]) * frame.normal[1] + (p[i + 2] - frame.origin[2]) * frame.normal[2];
      low = Math.min(low, along);
      high = Math.max(high, along);
      reach = Math.max(reach, Math.abs(p[i]), Math.abs(p[i + 1]), Math.abs(p[i + 2]));
    }
  }
  const overshoot = Math.max(1, 0.01 * reach);
  if (extent.side === 'forward') return [0, high + overshoot];
  if (extent.side === 'backward') return [0, low - overshoot];
  return [low - overshoot, high + overshoot];
}
