// What the recompute of an insertion (D62) needs besides the state: the names of the faces it brings,
// the placed solids kept, and the environment of the parameters of the stored document as text.
import { type RigidTransform, transformSolid } from '../solid';
import type { FaceName, Id, ParameterResult, Solid } from '../types';

// The name of a face of an inserted body: the name it has in the inserted document with every ID of
// a feature in it prefixed by `<insertion>/`: `feature`, and `pattern` of every copy tag. The fields
// of the role stay as they are.
export function insertedFaceName(name: FaceName, insertion: Id): FaceName {
  const prefixed = { ...name, feature: `${insertion}/${name.feature}` };
  return name.copy ? { ...prefixed, copy: name.copy.map((tag) => ({ pattern: `${insertion}/${tag.pattern}`, index: tag.index })) } : prefixed;
}

// A number written as text without loss: the shortest text that reads back as the same number, and
// −0 as `-0` (`atan2` tells −0 from 0, so two environments that differ by it are two).
export const losslessNumber = (value: number): string => (Object.is(value, -0) ? '-0' : String(value));

// The environment of the parameters of a stored document after the values of an insertion are put
// in: every parameter by its name in sorted order with its value or its error (code and message).
// Two insertions with one environment compute alike (the expressions of the stored document read
// nothing else), so they share one recompute.
export function environmentText(parameters: Readonly<Record<string, ParameterResult>>): string {
  return JSON.stringify(
    Object.keys(parameters)
      .sort()
      .map((name) => {
        const result = parameters[name];
        return [name, result.ok ? losslessNumber(result.value) : [result.error.code, result.error.message]];
      }),
  );
}

// The placed solid of a body of an insertion: kept by the solid there, the ID of the feature, the
// transform by its numbers and the new number of every face number of that solid, the last few of
// each feature, so that a step run again for an edit before the insertion that keeps the face
// table gives the same object (what the queries remember by a solid stays). It is a copy of the
// solid there (`transformSolid`), so two insertions made from one recompute are one shape to the
// parts list.
const PLACED_KEPT = 4; // per feature
const FEATURES_KEPT = 256; // per solid there
const PLACED = new WeakMap<Solid, Map<string, Map<string, Solid>>>();
function kept<T>(map: Map<string, T>, key: string, size: number, make: () => T): T {
  let value = map.get(key);
  if (value !== undefined) map.delete(key);
  else value = make();
  map.set(key, value);
  if (map.size > size) map.delete(map.keys().next().value as string);
  return value;
}
export function placedSolid(there: Solid, transform: RigidTransform, renumbered: ReadonlyMap<number, number>, feature: Id): Solid {
  let byFeature = PLACED.get(there);
  if (!byFeature) PLACED.set(there, (byFeature = new Map()));
  const solids = kept(byFeature, feature, FEATURES_KEPT, () => new Map<string, Solid>());
  const faces = [...new Set(there.faceIds)].sort((a, b) => a - b).map((face) => renumbered.get(face) as number);
  return kept(solids, JSON.stringify([transform.matrix, transform.translation, faces]), PLACED_KEPT, () => transformSolid(transform, there, (face) => renumbered.get(face) as number));
}
