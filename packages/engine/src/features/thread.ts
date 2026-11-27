// The feature `thread` (D76): a thread on cylindrical faces of one body. Cosmetic, it records the
// thread and leaves the mesh as it is; modelled (stage 2), it also cuts the grooves by one boolean
// (recompute/tool-thread.ts). The recompute is recompute/thread.ts; the design is
// docs/d36/7a-thread/design.md.
import type { NumberSpec } from '../catalog';
import { applyTool, issue, lookup } from '../recompute/services';
import { type ThreadRecord, threadRecords, threadToolPlan } from '../recompute/thread';
import type { Step, StepContext } from '../recompute/state';
import type { FaceName, ThreadFeature } from '../types';
import { faceKey } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, base, boolean, faceName, faceRefs, fail, oneOf, requireFace, string } from '../validation';
import { MAX_LABEL } from './hole';
import type { FeatureModule } from './module';

export const MAX_THREAD_STARTS = 16;
const POSITIVE = { unit: 'mm', min: { value: 0, open: true } } as const;
// The numeric fields. A field with `default` may be absent (`setField` can add it); `depth` and
// `length` have no fixed default and are added by `updateFeature`.
export const THREAD_FIELDS = {
  diameter: { title: 'Nominal (major) diameter', ...POSITIVE },
  pitch: { title: 'Pitch', ...POSITIVE },
  depth: { title: 'Depth of the profile', ...POSITIVE },
  flankAngle: { title: 'Angle between the flanks', unit: 'rad', min: { value: 0, open: true }, max: { value: Math.PI, open: true }, default: Math.PI / 3 },
  clearance: { title: 'Clearance', unit: 'mm', min: { value: 0 }, default: 0 },
  starts: { title: 'Starts', unit: 'none', min: { value: 1 }, max: { value: MAX_THREAD_STARTS }, integer: true, default: 1 },
  offset: { title: 'Offset from the end of the face', unit: 'mm', min: { value: 0 }, default: 0 },
  length: { title: 'Length', ...POSITIVE },
  phase: { title: 'Phase', unit: 'rad', default: 0 },
} as const satisfies Record<string, NumberSpec>;
type ThreadField = keyof typeof THREAD_FIELDS;
const OPTIONAL: readonly ThreadField[] = ['depth', 'flankAngle', 'clearance', 'starts', 'offset', 'length', 'phase'];
// What `null` in a patch removes, also where the feature has none.
const REMOVABLE = new Set<string>(['copies', 'label', ...OPTIONAL]);

function threadFeature(o: Dict, what: string, context: ValidationContext): ThreadFeature {
  const body = string(o.body, `${what}.body`);
  context.requireRef({ id: body, kind: 'body' }, `${what}.body`);
  if (!Array.isArray(o.faces) || o.faces.length === 0) return fail(`${what}.faces: a non-empty list of faces is expected, each a cylindrical face of the body named as the query body lists it`);
  const seen = new Map<string, number>();
  const faces = (o.faces as unknown[]).map((given, i): FaceName => {
    const face = faceName(given, `${what}.faces[${i}]`);
    requireFace(context, face, `${what}.faces[${i}]`);
    const key = faceKey(face);
    const earlier = seen.get(key);
    if (earlier !== undefined) fail(`${what}.faces[${i}]: the face is listed twice, also at ${earlier}`);
    seen.set(key, i);
    return face;
  });
  const copies = o.copies === undefined ? undefined : boolean(o.copies, `${what}.copies`);
  const modelled = boolean(o.modelled, `${what}.modelled`);
  const number = (field: ThreadField): number => context.fields.number(o[field], field, THREAD_FIELDS[field], `${what}.${field}`);
  const optional = (field: ThreadField): number | undefined => (o[field] === undefined ? undefined : number(field));
  const diameter = number('diameter');
  const pitch = number('pitch');
  const values: Partial<Record<ThreadField, number>> = {};
  for (const field of OPTIONAL) {
    const value = optional(field);
    if (value !== undefined) values[field] = value;
  }
  const hand = oneOf(o.hand, ['right', 'left'] as const, `${what}.hand`);
  const direction = oneOf(o.direction, ['forward', 'backward'] as const, `${what}.direction`);
  let label: string | undefined;
  if (o.label !== undefined) {
    label = string(o.label, `${what}.label`);
    if (label.trim() === '') fail(`${what}.label: the label is not empty; leave it out for none`);
    if (label.length > MAX_LABEL) fail(`${what}.label: at most ${MAX_LABEL} characters`);
  }
  return {
    ...base(o, what),
    type: 'thread',
    body,
    faces,
    ...(copies !== undefined ? { copies } : {}),
    modelled,
    diameter,
    pitch,
    ...(values.depth !== undefined ? { depth: values.depth } : {}),
    ...(values.flankAngle !== undefined ? { flankAngle: values.flankAngle } : {}),
    ...(values.clearance !== undefined ? { clearance: values.clearance } : {}),
    ...(values.starts !== undefined ? { starts: values.starts } : {}),
    hand,
    direction,
    ...(values.offset !== undefined ? { offset: values.offset } : {}),
    ...(values.length !== undefined ? { length: values.length } : {}),
    ...(values.phase !== undefined ? { phase: values.phase } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

function step(feature: ThreadFeature, context: StepContext): Step {
  const { state, done, failed, deps } = context;
  const solid = lookup(state.bodies, feature.body);
  if (!solid) return failed('brokenReference', [feature.body]);
  const made = threadRecords(feature, state, solid);
  if ('code' in made) return failed(made.code, made.refs, made.detail);
  const warnings = feature.copies && made.copies === 0 ? [issue('noCopies', ['copies'], 'no face of the body is a copy of a listed face by a pattern of this document before the thread')] : [];
  const threads: readonly ThreadRecord[] = [...state.threads, ...made.records];
  if (!feature.modelled) return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings, facts: made.facts }, { threads }) };

  // modelled: the tools of all walls in one solid, one boolean (design.md, "Recompute", step 7)
  const plan = threadToolPlan(feature, made, state, solid);
  if ('detail' in plan) return failed('invalidThread', plan.refs, plan.detail);
  const first = state.faceNames.length;
  const applied = applyTool({ operation: 'cut', targets: [feature.body], build: (_targets, firstFaceId) => plan.build(firstFaceId) }, state, deps.kernel);
  if (!applied.ok) return failed(applied.code, applied.refs, applied.code === 'kernelFailure' ? `${applied.detail ?? ''}; a small change of phase or offset gives another mesh` : applied.detail);
  const facts = { ...made.facts, triangles: plan.triangles };
  if (applied.unchanged.length) return { state: done({ status: 'warning', warnings: [...warnings, issue('noEffect', [feature.body])], facts }, { threads }) };
  // a hidden face of a tool left in the body: something crossed it within two lifts of the wall
  const cut = applied.model.bodies[feature.body];
  const guard = first + 5 * plan.walls;
  const crossed = new Set<number>();
  for (const face of cut.faceIds) if (face >= guard && face < guard + plan.walls) crossed.add(face - guard);
  if (crossed.size) {
    const walls = [...crossed].sort((a, b) => a - b).map((i) => made.walls[i].name);
    return failed('invalidThread', walls, 'something stands in the way of the tool within two lifts of the wall on its air side (a rib or a boss on a pin, a key or a post in a bore): shape the wall for the thread, or make it cosmetic');
  }
  return { state: done({ status: warnings.length ? 'warning' : 'ok', warnings, facts }, { ...applied.model, threads }) };
}

export const thread: FeatureModule<ThreadFeature> = {
  info: {
    title: 'Thread',
    summary:
      'A thread on cylindrical faces of one body: on a bore an internal thread, on a pin an external one (read from the body, not stated). The face gives the axis, the ends and the wall, which is the crest of the thread; `diameter` (nominal = major), `pitch` and optionally `flankAngle` (deg(60) when absent) and `depth` (the ISO proportion when absent) give the profile. ' +
      'A size of the catalog metricThreads fills them: `diameter` and `pitch` of its row; a bore has to be at the tap-drill size (`tapDrill` of the row; the query hardwareHole with the use `tapped` makes such a hole and answers with the fields of its thread) and a pin at the nominal diameter, else `invalidThread` says what the face would have to be. ' +
      '`modelled: false` is a cosmetic thread: the mesh stays and the thread is recorded (`threads` of get_model and get_body; the check of collisions lists a screw in such a bore under `threaded`, not as a collision). `modelled: true` cuts the helix, for printing: the faces `threadFlank`, `threadRoot` and `threadEnd` are added, the face the thread was placed on stays as its crest; two modelled threads are judged by their meshes, and an entry of `pairs` between two that agree and collide carries `seat` (what to add to a `phase`). A modelled thread belongs late in the timeline: its tool has thousands of triangles. ' +
      '`clearance` shifts the thread radially away from its mate (the thread of a diameter smaller or larger by twice it; the flanks are then clearance · sin(flankAngle / 2) from a basic mate); the wall is not moved, so make a pin at diameter − 2 · clearance and a bore wider by 2 · clearance, or the feature is refused once no crest is left (a pin at the nominal diameter takes about 0.1 · pitch). A printed pair made that way is free in the check of collisions when its two clearances add up to the chord tolerance or more; a `flankAngle` of deg(90) suits large printed threads. ' +
      '`direction`, `offset` and `length` place the thread along the face (`backward` from the mouth of a hole made from a sketch on a face); `phase` turns it, and `threads` of get_body says where each helix lies (a mate that runs the same way, its origin g further along: phase + turn · 2π · g / lead; one that runs the other way, its origin L along the first direction: −phase − turn · 2π · L / lead, turn 1 for a right-hand thread and −1 for a left-hand one). `copies: true` threads the copies of the faces a pattern of this document made as well, each with the helix of its source carried along. `hand` is kept on the mirrored copy of a face and turned over on a mirrored body. The feature is no source of a pattern.',
    fields: (Object.keys(THREAD_FIELDS) as ThreadField[]).map((path) => ({ path, spec: THREAD_FIELDS[path] })),
    bodies: 'none',
  },
  validate: threadFeature,
  refs: (f) => [{ path: 'body', id: f.body, kind: 'body' }, ...f.faces.flatMap((face, i): FeatureRef[] => faceRefs(face, `faces/${i}`))],
  createsBody: () => false,
  namesFaces: true,
  producesTool: () => false,
  patch: {
    fields: ['body', 'faces', 'copies', 'modelled', 'diameter', 'pitch', 'depth', 'flankAngle', 'clearance', 'starts', 'hand', 'direction', 'offset', 'length', 'phase', 'label'],
    removable: (_f, path) => path.length === 1 && REMOVABLE.has(path[0]),
  },
  step,
};
