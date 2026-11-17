// The feature `split` (D56): a body cut by a plane into two. The body keeps its ID and the part on
// one side; the part on the side `side` is a new body with the ID of the feature. Both get the cut
// face. The design is docs/d36/3d-body-boolean/design.md.
import { ResultCheckFailed, halfSpaceBox, precisionOf, volumeSlack } from '../recompute/body-boolean';
import { frame, lookup } from '../recompute/services';
import type { Step, StepContext } from '../recompute/state';
import { type FaceInfo, areaOf, volumeOf } from '../solid';
import type { FaceName, Solid, SplitFeature } from '../types';
import { faceKey } from '../util';
import { type Dict, type ValidationContext, base, oneOf, planeRef, planeRefs, string } from '../validation';
import type { FeatureModule } from './module';

function splitFeature(o: Dict, what: string, context: ValidationContext): SplitFeature {
  const body = string(o.body, `${what}.body`);
  context.requireRef({ id: body, kind: 'body' }, `${what}.body`);
  return { ...base(o, what), type: 'split', body, plane: planeRef(context, o.plane, `${what}.plane`), side: oneOf(o.side, ['forward', 'backward'] as const, `${what}.side`) };
}

const NOT_CUT = 'the plane does not cut the body: one part would be nothing';

// Two differences with the boxes on the two sides of the plane (each with its face in the plane
// numbered as the cut face): the body less the box on the side `side` keeps the ID, the body less
// the other box is the new body.
function step(feature: SplitFeature, { state, deps, done, failed }: StepContext): Step {
  const body = lookup(state.bodies, feature.body);
  if (!body) return failed('brokenReference', [feature.body]);
  const plane = frame(feature.plane, state);
  if (typeof plane === 'string') return failed(plane, [feature.plane]);
  const first = state.faceNames.length;
  const other = feature.side === 'forward' ? 'backward' : 'forward';
  const [away, rest] = [halfSpaceBox(body, plane, feature.side, first), halfSpaceBox(body, plane, other, first)];
  if (!away || !rest) return failed('emptyResult', [feature.body], NOT_CUT);
  let kept: Solid;
  let made: Solid;
  try {
    kept = deps.kernel.boolean('difference', body, away);
    made = deps.kernel.boolean('difference', body, rest);
    if (kept.triangles.length === 0 || made.triangles.length === 0) return failed('emptyResult', [feature.body], NOT_CUT);
    // the five other faces of a box lie outside the body, and the two parts make the body
    if ([kept, made].some((part) => part.faceIds.some((face) => face > first))) throw new ResultCheckFailed('a part of the split holds a face of the box outside the body');
    const volume = volumeOf(body);
    const off = Math.abs(volumeOf(kept) + volumeOf(made) - volume);
    const slack = volumeSlack(Math.abs(volume), areaOf(body), precisionOf(body));
    if (off > slack) throw new ResultCheckFailed(`the volumes of the two parts add up to that of the body only within ${off.toPrecision(3)} mm³ (tolerance ${slack.toPrecision(3)} mm³)`);
  } catch (error) {
    return failed('kernelFailure', [feature.body], error instanceof Error ? error.message : String(error));
  }
  const name: FaceName = { feature: feature.id, role: 'splitFace' };
  const info: FaceInfo = { planar: true, origin: plane.origin, y: plane.y, normal: plane.normal };
  return {
    state: done(
      { status: 'ok', warnings: [], bodies: [feature.id] },
      {
        bodies: { ...state.bodies, [feature.body]: kept, [feature.id]: made },
        faceNames: [...state.faceNames, name],
        faceInfos: [...state.faceInfos, info],
        faceIds: new Map([...state.faceIds, [faceKey(name), first]]),
      },
    ),
  };
}

export const split: FeatureModule<SplitFeature> = {
  info: {
    title: 'Split',
    summary:
      'Splits a body by a plane (a base plane, a plane feature or the plane of a planar face). The body keeps its ID and the part on one side; the part on the side `side` (`forward`: where the normal of the plane points) becomes a new body with the ID of the feature. Both get the cut face `{ feature, role: "splitFace" }`, a plane a sketch can stand on. A later feature that names the body works on the part that kept the ID; one meant for both parts lists both bodies.',
    fields: [],
    bodies: 'self',
  },
  validate: splitFeature,
  refs: (f) => [{ path: 'body', id: f.body, kind: 'body' }, ...planeRefs(f.plane, 'plane')],
  createsBody: (_f, local) => local === undefined,
  // the new body takes after the body it was cut from (body properties, D48)
  bodySource: (f) => f.body,
  namesFaces: true,
  producesTool: () => false,
  patch: { fields: ['body', 'plane', 'side'] },
  step,
};
