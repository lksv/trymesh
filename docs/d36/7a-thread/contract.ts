// Contract of package 7a (D75): threads. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and the shared
// types of the preparatory step and states what the package adds: a feature type with its patch
// and fields, three face roles, two issue codes, a data catalog with its rows, what the evaluation,
// the description of a body, the context of a query, the report of collisions, the smallest gap and
// the query `hardwareHole` gain, and the parts of the recompute the step is made of. No command, no
// section of the document, no member of the kernel port, no new query, no schema step.
//
// Second version, after the first round of reviews (design.md, "Reviews"): the clearance is a radial
// shift, the tool of a bore is a ring, the zone of the collisions is judged per piece by three
// rules, a copy carries the datum of its listed face, the ends are read in both modes.
//
// Two stages (design.md, "Stages"): stage 1 ships everything here that a cosmetic thread needs and
// refuses `modelled: true` in the validator; stage 2 ships the tool, the faces and the checks of
// a modelled thread. What belongs to stage 2 alone is marked.

import type { FeatureBase, Id, Input, InterferenceReport, Patch, Solid, Vec3 } from '../../../packages/engine/src/index';
import type { NumberSpec } from '../../../packages/engine/src/catalog';
import type { FeatureTypeInfo } from '../../../packages/engine/src/features/module';
import type { State } from '../../../packages/engine/src/recompute/state';
import type { FaceInfo, RigidTransform } from '../../../packages/engine/src/solid';
import type { DataCatalog, FaceNameAfter } from '../00-prep/contract';
import type { Gap } from '../1c-gap/contract';
import { FACE_ROLES } from '../00-prep/contract';
import type { HARDWARE_HOLE_ARGS, HardwareHole } from '../2c-hole/contract';

// ================================================================ the feature

// A thread on cylindrical faces of one body (D75): on a bore an internal thread, on a pin an
// external one. The face gives the axis, the two ends and the radius of the wall, which is the
// crest of the thread as made (the minor diameter of an internal thread, the major diameter of an
// external one); the feature states the profile. Whether a face is a bore or a pin is read from
// the body (the side its material is on), never stated.
// - `body`, `faces`: at least one face of that body, none twice. Each has to be a whole cylinder:
//   a `Surface` of the kind `cylinder` whose triangles cover every angle about its axis (a rounded
//   corner, the end of a slot and a bore slit along its whole length are refused; a bore crossed
//   by a hole passes). Every face gets the same thread. A face on which the body has both a bore
//   and a pin (one cylinder used both ways by a combine) is refused.
// - `copies`: when true, the thread is also made on every face of the body whose name is a listed
//   name with further copy tags of patterns of this document (the bores a pattern of a hole made;
//   a tag of a pattern inside an inserted document is not followed: list such a face). A listed
//   face is never taken as a copy, and a copy of two listed names belongs to the one with the most
//   tags in common. A count of the pattern that changes then needs no change here. The thread has
//   to stand after the pattern; one that finds no copy has the warning `noCopies`. Absent: false.
// - `modelled`: false is a cosmetic thread: the geometry does not change (a bore stays at its
//   tap-drill diameter, a pin at the diameter it was made with) and the evaluation records the
//   thread (`Evaluation.threads`). True cuts the helix: one tool for all faces, one boolean.
//   The checks of the fields and of the faces are the same in both modes; a modelled thread adds
//   the checks that exist because of the mesh (see `IssueCodes`).
// - The basic profile, in the axial plane: a trapezoid ridge per pitch.
//   - `diameter`: the nominal diameter, which is the major diameter of the basic profile (8 for
//     M8), mm.
//   - `pitch`: from ridge to ridge along the axis, mm. The lead is `pitch · starts`.
//   - `flankAngle`: the angle between the two flanks, radians; absent: `deg(60)`, the ISO metric
//     profile. Printed threads take more (`deg(90)`: no flank overhangs by more than 45°).
//   - `depth`: the radial height of the basic profile, from the major to the minor diameter, mm.
//     Absent: 5/8 of the height of the sharp V of the pitch and the angle,
//     `5 · pitch / (16 · tan(flankAngle / 2))`, which for 60° is 0.541266 · pitch, the ISO profile
//     (ISO 68-1; the minor diameter is then D − 1.082532 · P as in ISO 724).
//   - The flats follow: what the two flanks leave of a pitch, `pitch − 2 · depth · tan(flankAngle / 2)`,
//     is divided 1 : 2 between the flat at the major diameter and the flat at the minor diameter
//     (P/8 and P/4 for the ISO profile). Less than nothing left is `invalidThread`.
// - `clearance`: a radial shift away from the mate, mm, zero or more; absent: 0. The thread made
//   is the basic thread of a diameter smaller by twice the clearance (on a pin) or larger by twice
//   it (in a bore): its flanks and its root move radially by the clearance. Between the flanks of
//   this thread and a basic mate that leaves `clearance · sin(flankAngle / 2)` (half of it at 60°).
//   The crest is the wall as it was made and does not move, so the wall has to suit the clearance:
//   make a pin at `diameter − 2 · clearance` and a bore at the tap drill plus `2 · clearance`
//   (the query hardwareHole with the use `tapped` and an allowance does the latter). A pin left at
//   the nominal diameter takes a clearance up to about 0.108 · pitch at 60°; beyond that the
//   grooves would leave nothing of the wall, which is `invalidThread` with the size to make.
//   A modelled screw and a modelled nut are free of each other when their clearances add up to
//   at least the chord tolerance of the document; below it the check of collisions lists the
//   pair as a fit and takes seconds over it.
// - `starts`: the number of ridges, a whole number from 1 to 16; absent: 1.
// - `hand`: `right` or `left`. The copy of a face a mirror made (`copies`) gets this hand as well;
//   a mirrored copy of the body is the mirror image and has the other one (`ThreadResult.hand`
//   says what came out). For the other hand on a mirrored copy of a face, list that copy in
//   a second thread feature.
// - `direction`, `offset`, `length`: where along the face the thread is. `forward` starts at the
//   end of the face its axis points away from and runs along the axis of the face (the sense of
//   `AxisRef` of the kind `face`: for an extrusion and a hole the normal of the sketch); `backward`
//   starts at the other end and runs against it. For a hole or a cut made from a sketch on a face,
//   whose normal points out of the body, a thread from the mouth is `backward`, as the hole itself
//   is. The thread starts `offset` (mm, zero or more; absent: 0) from that end and is `length`
//   long (mm, above 0); absent: to the other end of the face. A thread that would pass the other
//   end is `invalidThread`. An end nearer to an end of the face than `threadLift` (0.05 mm at the
//   least) is taken to be at that end.
// - `phase`: turns the thread about its axis, radians by the right-hand rule about the direction
//   of the thread; absent: 0. See `ThreadResult` for where the helix lies.
// - `label`: free text for people ("M8", "M8x1", "lid 40 x 4"), at most 200 characters; the
//   engine reads nothing out of it.
// - Faces of a modelled thread (stage 2): see `FaceRoles` below. The faces the thread was placed
//   on keep their names and their exact cylinders, so what refers to them (a sketch's projection,
//   an axis of the kind `face`, a joint) holds whether the thread is modelled or not.
// - The feature creates no body and leaves no tool a pattern could repeat: a pattern of the body
//   copies its threads with it, and the bores a pattern of a hole made are reached by `copies`.
// - Errors: `brokenReference` (the body, or a face it does not have, in `refs`), `invalidThread`
//   (see `IssueCodes`), `invalidExpression` (a field), and for a modelled thread `importedTarget`,
//   `emptyResult` and `kernelFailure`. A feature in error changes nothing and records no thread.
export interface ThreadFeature extends FeatureBase {
  type: 'thread';
  body: Id;
  faces: FaceNameAfter[];
  copies?: boolean;
  modelled: boolean;
  diameter: number;
  pitch: number;
  depth?: number;
  flankAngle?: number;
  clearance?: number;
  starts?: number;
  hand: 'right' | 'left';
  direction: 'forward' | 'backward';
  offset?: number;
  length?: number;
  phase?: number;
  label?: string;
}
// What `updateFeature` may change. `faces` is a list and is replaced whole. `null` removes
// `copies`, `depth`, `length` and `label`, and the fields with a default (`flankAngle`,
// `clearance`, `starts`, `offset`, `phase`), also where the feature has none.
export type ThreadPatch = Patch<Pick<ThreadFeature, 'body' | 'faces' | 'copies' | 'modelled' | 'diameter' | 'pitch' | 'depth' | 'flankAngle' | 'clearance' | 'starts' | 'hand' | 'direction' | 'offset' | 'length' | 'phase' | 'label'>>;

// The numeric fields, as the registry describes them. A field with `default` may be absent
// (`setField` can add it); `depth` and `length` have no fixed default and are added by
// `updateFeature`.
export const MAX_THREAD_STARTS = 16;
const POSITIVE = { unit: 'mm', min: { value: 0, open: true } } as const;
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

// What the result of the feature publishes in `facts`. What differs from face to face is in
// `Evaluation.threads`, typed.
export const THREAD_FACTS = {
  depth: 'the depth of the basic profile used, mm (the field, or the ISO proportion when it is absent)',
  minorDiameter: 'the minor diameter of the basic profile, mm: diameter − 2 · depth',
  lead: 'pitch · starts, mm',
  crestFlat: 'the flat of the basic profile at the major diameter, mm',
  rootFlat: 'the flat of the basic profile at the minor diameter, mm',
  threads: 'the number of threads made: the listed faces and, with `copies`, their copies',
  copies: 'with `copies`: the number of copies found (zero comes with the warning noCopies)',
  triangles: 'modelled: the triangles of the tool',
} as const;

// ================================================================ the unions

declare module '../00-prep/contract' {
  interface FeatureTypes {
    thread: ThreadFeature;
  }
  interface FeaturePatches {
    thread: ThreadPatch;
  }
  // The faces a modelled thread adds (stage 2). `face` is the place of its face in `faces` of the
  // feature, from 0; the thread on a copy of that face (`copies`) carries the further copy tags of
  // the copy. One face per role whatever the number of starts.
  // - `threadFlank`: a flank, a helical surface (`Surface` of the kind `general`). `side` is
  //   `start` for the flank whose normal out of the body points towards the start of the thread
  //   and `end` for the other. With the axis upright and the thread starting at the top, the flanks
  //   `end` of a pin and `start` of a bore face down: they are the ones a printer has to bridge.
  // - `threadRoot`: the bottom of the groove that was cut, a cylinder about the axis of the wall:
  //   the minor cylinder of an external thread, the major cylinder of an internal one, each
  //   shifted by the clearance. A profile with no flat at its root has none.
  // - `threadEnd`: a flat end of the groove, a plane across the axis; `end` is `start` or `end` of
  //   the thread. Where the thread ends inside the wall or just short of a shoulder, and where an
  //   end that was read as open met material after all. An end that runs out into the air has
  //   none.
  // The crest is the face the thread was placed on, under its own name. The edges of a flank are of
  // the kind `other` (helices): they are not projected, chamfered or filleted.
  interface FaceRoles {
    threadFlank: { face: number; side: 'start' | 'end' };
    threadRoot: { face: number };
    threadEnd: { face: number; end: 'start' | 'end' };
  }
  // `invalidThread`, an error: the fields and the faces do not make a thread. `refs`: the face
  // concerned, or the paths of the fields. The detail gives the numbers. In both modes:
  // - a face is not a cylinder (a face that stopped being one after a change before the feature
  //   too), is only a part of one, or the body has it both as a bore and as a pin;
  // - the profile does not fit into a pitch (the flanks would cross: a depth too large for the
  //   pitch and the angle);
  // - a bore narrower than the minor diameter of the thread (the detail names the tap-drill size
  //   the thread has: its minor diameter, and the bore's), or so wide that less than half of the
  //   depth is left; a pin wider than the major diameter, or so narrow that less than half of the
  //   depth is left. The bound on the side the clearance shifts the thread to moves with it
  //   (a bore up to `diameter + 2 · clearance − depth`, a pin down to `diameter − 2 · clearance −
  //   depth`);
  // - the clearance leaves no crest on the wall: the grooves would take the whole face. The detail
  //   names the size the wall would have to be (`diameter − 2 · clearance` for a pin) and the
  //   largest clearance the wall as it is takes;
  // - the thread would pass the far end of its face, or has no length;
  // - a face already has a thread over a part of that length (of an earlier feature, in `refs`).
  // Modelled only (stage 2):
  // - the depth left on a face is below five chord tolerances of the document: not a thread at
  //   that tolerance (make it cosmetic, or lower the chord tolerance);
  // - the flat left on the wall is so narrow that the flanks of the tool meet within one chord
  //   tolerance beyond the wall;
  // - two threads of the feature would cross (the cylinders that hold their tools meet): put them
  //   into two features;
  // - something stands in the way of the tool within two lifts of the wall on its air side: a rib
  //   or a boss on a pin, a key or a wide post in a bore (found after the cut, which is undone);
  // - the tool would have more than `MAX_THREAD_TRIANGLES` triangles.
  // `noCopies`, a warning: `copies` is true and the body has no copy of a listed face (the thread
  // stands before its pattern, or the pattern is gone). `refs`: `copies`.
  interface IssueCodes {
    invalidThread: true;
    noCopies: true;
  }
  interface Catalogs {
    metricThreads: MetricThreadRow;
  }
  // The threads of the state: see `ThreadResult`.
  interface EvaluationAfter {
    threads: ThreadResult[];
  }
  // What the query `body` (the tool get_body) adds: the threads on the faces of that body, in
  // a posed query where the pose puts them. Present only when the body has one. Not part of what
  // the query keeps by the mesh: a cosmetic thread changes no mesh.
  interface BodyDescription {
    threads?: ThreadResult[];
  }
  // A query does not read `Evaluation.threads` (the context takes it out of the evaluation it
  // hands on, as it takes `bodies` and `faceSurfaces`): it asks for the threads of a body, which
  // come with their datum where the pose of the query puts the body.
  interface QueryContext {
    threads: (body: Id) => ThreadResult[];
  }
}

export const THREAD_ROLES: Pick<typeof FACE_ROLES, 'threadFlank' | 'threadRoot' | 'threadEnd'> = {
  threadFlank: { title: 'flank of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' }, side: { title: 'the end of the thread the flank faces (start or end)', kind: 'text' } } },
  threadRoot: { title: 'root of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' } } },
  threadEnd: { title: 'flat end of a thread', parts: { face: { title: 'the place of the face in the list of the feature, from 0', kind: 'integer' }, end: { title: 'the end of the thread (start or end)', kind: 'text' } } },
};

export const THREAD_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Thread',
  summary:
    'A thread on cylindrical faces of one body: on a bore an internal thread, on a pin an external one (read from the body, not stated). The face gives the axis, the ends and the wall, which is the crest of the thread; `diameter` (nominal = major), `pitch` and optionally `flankAngle` (deg(60) when absent) and `depth` (the ISO proportion when absent) give the profile. ' +
    'A size of the catalog metricThreads fills them: `diameter` and `pitch` of its row; a bore has to be at the tap-drill size (`tapDrill` of the row; the query hardwareHole with the use `tapped` makes such a hole and answers with the fields of its thread) and a pin at the nominal diameter, else `invalidThread` says what the face would have to be. ' +
    '`modelled: false` is a cosmetic thread: the mesh stays and the thread is recorded (`threads` of get_model and get_body; the check of collisions lists a screw in such a bore under `threaded`, not as a collision). `modelled: true` cuts the helix, for printing. ' +
    '`clearance` shifts the thread radially away from its mate (the thread of a diameter smaller or larger by twice it; the flanks are then clearance · sin(flankAngle / 2) from a basic mate); the wall is not moved, so make a pin at diameter − 2 · clearance and a bore wider by 2 · clearance, or the feature is refused once no crest is left (a pin at the nominal diameter takes about 0.1 · pitch). A printed pair is free in the check of collisions when its two clearances add up to the chord tolerance or more; a `flankAngle` of deg(90) suits large printed threads. ' +
    '`direction`, `offset` and `length` place the thread along the face (`backward` from the mouth of a hole made from a sketch on a face); `phase` turns it, and `threads` of get_body says where each helix lies. `copies: true` threads the copies of the faces a pattern of this document made as well, each with the helix of its source carried along. `hand` is kept on the mirrored copy of a face and turned over on a mirrored body. The feature is no source of a pattern.',
  fields: (Object.keys(THREAD_FIELDS) as (keyof typeof THREAD_FIELDS)[]).map((path) => ({ path, spec: THREAD_FIELDS[path] })),
  bodies: 'none',
};

// ================================================================ what the evaluation records

// How an end of a thread ends, read from the mesh of the body before the feature at every
// recompute, in both modes (design.md, "The ends"):
// - `open`: at an end of the wall beyond which the bore goes on into the open (a mouth in a face,
//   a counterbore, a chamfer or a countersink) or the pin ends (its free end, a chamfered tip).
//   The thread runs out there, through a chamfer as a tap cuts it.
// - `shoulder`: at an end of the wall where material stands in the way (the bottom of a blind
//   hole, a narrower bore, the plate a pin stands on, a wider step, a fillet at its foot).
//   A modelled thread ends flat `threadLift` short of it.
// - `inside`: within the wall, by `offset` or `length`, or at an end of the wall where the wall
//   goes on at the same radius under another name. A modelled thread ends flat there.
export type ThreadEnd = 'open' | 'shoulder' | 'inside';

// One thread on one face, as the evaluation publishes it (`Evaluation.threads`, in the order of
// the features and of their faces, copies after the listed faces).
// - `feature`, `face`: the thread feature and the face it is on (for a copy the name of the copy;
//   for a thread an insertion brought, both prefixed as the faces of an insertion are).
// - `bodies`: the bodies that have that face in this state with the material on the side the
//   thread was made for. A later feature may move the face to another body (a union), leave it
//   on two (a split) or remove it; a difference leaves the face in its target with the other
//   sense (the bore of a tool becomes a pin), and the thread is not listed there. A thread on no
//   body is not listed.
// - `internal`: on a bore. `modelled`: cut into the mesh.
// - `diameter`, `pitch`, `depth`, `flankAngle`, `clearance`, `starts`, `label`: as the feature
//   gives them, with the defaults filled in. `radius`: of the wall.
// - `hand`: the hand the thread has where it lies: the stated one on the faces of the feature and
//   on their copies (also a mirrored copy of a face), the other one on a mirrored copy of the
//   body, cosmetic and modelled alike.
// - Where the helix lies. `origin` is the point of the axis in the plane of the end of the face the
//   thread starts from (the extreme point of the face along the axis, read from its mesh);
//   `axis` is the unit direction the thread runs in; `zero` is a unit vector across the axis. The
//   thread is between `from` and `to`, distances from `origin` along `axis` (`offset` and
//   `offset + length`). The centre of the crest of a ridge of the basic profile (of an external
//   thread the middle of its ridge, of an internal one the middle of its groove: one curve for
//   both) is at `origin + s · axis + (diameter / 2) · (zero turned by θ about axis)` with
//   `s = turn · lead · θ / 2π + k · pitch`, θ by the right-hand rule about `axis`, `turn` +1 for
//   a right-hand thread and −1 for a left-hand one (by `hand` here), k any whole number.
//   - `zero` of a listed face is the model's X axis made perpendicular to `axis` (the model's
//     Y axis when `axis` is within about 26° of X: |x of the axis| above 0.9), turned by `phase`.
//   - `zero` of a copy (`copies`) is that of its listed face moved by the transforms of the
//     patterns that made the copy, made perpendicular to the axis of the copy again. So the
//     helices of a circle of threaded holes are turned with their holes, as the helices of
//     a circle of screws are that a pattern of a body made.
//   - It does not depend on `offset` or `length`: changing them trims the same helix.
//   So a screw sits in a nut when their axes lie on one line and their helices are one curve:
//   with the same hand, pitch and starts, and with `origin`, `axis` and `zero` of the two
//   satisfying the formula above. Two threads that start from one plane in one direction with the
//   same `phase` do. A second thread that runs the same way with its origin `g` further along
//   that direction needs the phase `turn · 2π · g / lead` more; one that runs the other way (a bolt
//   from above into a nut threaded from below), with its origin `L` from the first one's along the
//   first direction, needs `−turn · 2π · L / lead`.
// - `ends`: how each end ends. `runOut`: how far beyond `from` (start) and `to` (end) the thread
//   runs out through what follows an open end (the axial depth of a chamfer or a countersink
//   until it is as wide as the major diameter); zero at every other end.
// The span is the one the feature gave: a later feature that shortens the wall, or splits the
// body, does not shorten `from` and `to`.
export interface ThreadResult {
  feature: Id;
  face: FaceNameAfter;
  bodies: Id[];
  internal: boolean;
  modelled: boolean;
  diameter: number;
  pitch: number;
  depth: number;
  flankAngle: number;
  clearance: number;
  starts: number;
  hand: 'right' | 'left';
  label?: string;
  radius: number;
  origin: Vec3;
  axis: Vec3;
  zero: Vec3;
  from: number;
  to: number;
  ends: { start: ThreadEnd; end: ThreadEnd };
  runOut: { start: number; end: number };
}

// What the state of the recompute keeps (internal): the published thread without `bodies`, with
// the number of its face. `State.threads` shares unchanged records between states.
export interface ThreadRecord extends Omit<ThreadResult, 'bodies' | 'face'> {
  face: number;
}
// - `threads`: the records, appended by the step of a thread feature in both modes.
// - `copyTransforms`: by the copy tag of a pattern (`<pattern>:<index>` as in a face name), the
//   transform of that copy, of a pattern of features and of bodies alike. The pattern step writes
//   it; the thread step reads it for the datum of a copy.
export interface StateD75 extends State {
  threads: readonly ThreadRecord[];
  copyTransforms: ReadonlyMap<string, RigidTransform>;
}
// A record moved with its body (a copy of a pattern of a body, the placement of an insertion, the
// pose of a query): `origin` as a point, `axis` and `zero` as directions by the transform;
// a transform that mirrors turns `hand` over, and the curve the record then describes is the
// mirror image of the source's. `face` is the number of the face of the copy. `prefix`: of an
// insertion, put before `feature` as it is put before the feature of a face name.
export declare function movedThread(record: ThreadRecord, transform: RigidTransform, face: number, prefix?: string): ThreadRecord;
// The published list: for every record, the bodies of the state that have its face with the
// material on the side `internal` says (the pass of `threadWall` over the triangles of the face in
// that body, kept by the mesh); a record with no such body is left out.
export declare function threadResults(state: StateD75): ThreadResult[];

// ================================================================ the check of collisions

// A pair of bodies of which a part of what they share is what a thread accounts for: a screw in
// a bore with a cosmetic thread, a plain rod in a modelled nut. Such a pair is in `threaded` of
// the report; what is left of its shared volume is judged as that of every pair is, so it is in
// `threaded` alone (nothing left), also in `fits` (the head in its counterbore) or in `pairs`
// instead (a screw too long for a blind bore).
// - The zone of a thread on a body: between the wall and the root of that thread (a bore: from
//   `radius` to `diameter / 2 + clearance`; a pin: from `diameter / 2 − depth − clearance` to
//   `radius`) and along the axis from `from − runOut.start` to `to + runOut.end`.
// - The rule, on every connected piece of what the two bodies share, within the chord tolerance
//   of the document and the precision of the coordinates. A piece is excused by a thread when:
//   1. every vertex of it lies within the outer radius and the two ends of the zone;
//   2. no triangle of it comes nearer to the axis than the inner radius (the least distance of
//      the triangle from the axis, not of its corners: a shared volume has vertices only on its
//      rim, and a pin through a solid block has them all at the radius of the pin);
//   3. the angles of its vertices about the axis leave no gap of half a turn or more (a body
//      pushed into the thread from one side is no mate).
// - Not excused: a piece between two modelled threads about one axis. Their meshes are the truth.
// - Not excused: a piece between two threads about one axis that disagree in pitch, starts, hand
//   as each lies, or nominal diameter. The pair is then in `pairs`, with `mismatch` saying what
//   differs. "About one axis": the directions within the angle tolerance, the lines no further
//   apart than the chord tolerance over the stretch the two zones share.
// - The other body need not carry a thread: a bought screw is a plain cylinder.
// - `volume`: of the excused pieces. No depth: its measure is the slow part (a second for
//   a thread) and is taken only of what is left.
// - `threads`: every thread that excused a piece (one body in several threaded bores; of two
//   agreeing threads on one piece, both).
// - In a pose a pair is computed in the frame of its first body: the zones of the second are
//   moved by the transform that puts it there.
// - What the query keeps: the mesh the two share by the two meshes, as before; the judgement by
//   the two meshes and the records on the two bodies (a cosmetic thread changes no mesh).
export interface Threaded {
  a: Id; // the smaller ID, as in the other lists
  b: Id;
  volume: number; // mm³
  threads: { feature: Id; face: FaceNameAfter; body: Id }[];
}
declare module '../../../packages/engine/src/types' {
  interface InterferenceReport {
    threaded?: Threaded[]; // present only when it has an entry
  }
}
// What the other lists of the report gain (a draft cannot widen a member of an engine type, so
// these stand for the entries after this package):
// - an entry of `pairs` between two threads that disagree carries `mismatch`, in words
//   ("pitch 1.5 against 1.25", "a left-hand thread in a right-hand one");
// - an entry of `cleared` (a pair the kernel refused, judged on the mesh as computed, D50) may be
//   of the kind `threaded`: every piece excused, or what is left nothing or a fit.
export type PairD75 = InterferenceReport['pairs'][number] & { mismatch?: string };
export type ClearedKindD75 = 'threaded';
// The smallest gap (D40) asks `interference` what a pair at a distance of zero shares, and reads
// `pairs` and `fits`. A pair in `threaded` alone has the contact `threaded` (not `touching`, and
// no distance between a set screw and the wall of its bore).
export type GapD75 = Gap | { a: Id; b: Id; distance: 0; contact: 'threaded' };

// The zone of a record, in the frame the pair is computed in (`transform`: of the record's body
// into that frame, absent for the first body of a pair and for a query without a pose).
export interface ThreadZone {
  origin: Vec3;
  axis: Vec3;
  low: number; // radii
  high: number;
  from: number; // along the axis, the run-outs included
  to: number;
}
export declare function threadZone(record: ThreadRecord, transform?: RigidTransform): ThreadZone;
// The three rules on one connected piece (a solid of `pieceSolids`).
export declare function withinZone(piece: Solid, zone: ThreadZone, slack: number): boolean;
// Whether two records are about one axis, and what differs between them when they are.
export declare function threadsAgree(a: ThreadRecord, b: ThreadRecord, transformOfB: RigidTransform | undefined, chordTolerance: number): 'apart' | 'agree' | { mismatch: string };

// ================================================================ the catalog

// The ISO metric threads of ISO 262 (the sizes selected for screws, bolts and nuts) from M2 to
// M64: every coarse thread and every fine one that standard selects. Keyed by the designation: the
// coarse thread of a diameter "M8", a fine one with its pitch "M8x1". Lengths in mm.
// - `diameter`, `pitch`: what goes into the fields of a thread feature.
// - `pitchDiameter`, `minorDiameter`: D2 and D1 of the basic profile (ISO 724): D − 0.649519 · P
//   and D − 1.082532 · P, rounded to the third decimal place as the standard rounds them. For
//   reading; a thread feature computes its profile from the pitch.
// - `tapDrill`: the drill before tapping (ISO 2306), the diameter of a bore that takes this
//   thread.
// - `series`: `coarse` or `fine`. `choice`: 1 or 2, the column of ISO 262 the diameter is in.
export interface MetricThreadRow {
  diameter: number;
  pitch: number;
  pitchDiameter: number;
  minorDiameter: number;
  tapDrill: number;
  series: string;
  choice: number;
}
// The rows, checked against their sources on 2026-11-26 (design.md, "The catalog"): every
// `pitchDiameter` and `minorDiameter` is the formula of ISO 724 rounded and was read in its Table
// 1 and in a second table; every `tapDrill` up to M56 (coarse) and M52x4 (fine) was read in Tables
// 1 and 2 of ISO 2306:1972 and in a second table; the five larger ones (M56x4, M60, M60x4, M64,
// M64x4), which ISO 2306 does not list, are the nominal diameter less the pitch, the rule of its
// scope, as a second table has them.
export const METRIC_THREAD_ROWS: Record<string, MetricThreadRow> = {
  M2: { diameter: 2, pitch: 0.4, pitchDiameter: 1.74, minorDiameter: 1.567, tapDrill: 1.6, series: 'coarse', choice: 1 },
  'M2.5': { diameter: 2.5, pitch: 0.45, pitchDiameter: 2.208, minorDiameter: 2.013, tapDrill: 2.05, series: 'coarse', choice: 1 },
  M3: { diameter: 3, pitch: 0.5, pitchDiameter: 2.675, minorDiameter: 2.459, tapDrill: 2.5, series: 'coarse', choice: 1 },
  'M3.5': { diameter: 3.5, pitch: 0.6, pitchDiameter: 3.11, minorDiameter: 2.85, tapDrill: 2.9, series: 'coarse', choice: 2 },
  M4: { diameter: 4, pitch: 0.7, pitchDiameter: 3.545, minorDiameter: 3.242, tapDrill: 3.3, series: 'coarse', choice: 1 },
  M5: { diameter: 5, pitch: 0.8, pitchDiameter: 4.48, minorDiameter: 4.134, tapDrill: 4.2, series: 'coarse', choice: 1 },
  M6: { diameter: 6, pitch: 1, pitchDiameter: 5.35, minorDiameter: 4.917, tapDrill: 5, series: 'coarse', choice: 1 },
  M7: { diameter: 7, pitch: 1, pitchDiameter: 6.35, minorDiameter: 5.917, tapDrill: 6, series: 'coarse', choice: 2 },
  M8: { diameter: 8, pitch: 1.25, pitchDiameter: 7.188, minorDiameter: 6.647, tapDrill: 6.8, series: 'coarse', choice: 1 },
  M8x1: { diameter: 8, pitch: 1, pitchDiameter: 7.35, minorDiameter: 6.917, tapDrill: 7, series: 'fine', choice: 1 },
  M10: { diameter: 10, pitch: 1.5, pitchDiameter: 9.026, minorDiameter: 8.376, tapDrill: 8.5, series: 'coarse', choice: 1 },
  'M10x1.25': { diameter: 10, pitch: 1.25, pitchDiameter: 9.188, minorDiameter: 8.647, tapDrill: 8.8, series: 'fine', choice: 1 },
  M10x1: { diameter: 10, pitch: 1, pitchDiameter: 9.35, minorDiameter: 8.917, tapDrill: 9, series: 'fine', choice: 1 },
  M12: { diameter: 12, pitch: 1.75, pitchDiameter: 10.863, minorDiameter: 10.106, tapDrill: 10.2, series: 'coarse', choice: 1 },
  'M12x1.5': { diameter: 12, pitch: 1.5, pitchDiameter: 11.026, minorDiameter: 10.376, tapDrill: 10.5, series: 'fine', choice: 1 },
  'M12x1.25': { diameter: 12, pitch: 1.25, pitchDiameter: 11.188, minorDiameter: 10.647, tapDrill: 10.8, series: 'fine', choice: 1 },
  M14: { diameter: 14, pitch: 2, pitchDiameter: 12.701, minorDiameter: 11.835, tapDrill: 12, series: 'coarse', choice: 2 },
  'M14x1.5': { diameter: 14, pitch: 1.5, pitchDiameter: 13.026, minorDiameter: 12.376, tapDrill: 12.5, series: 'fine', choice: 2 },
  M16: { diameter: 16, pitch: 2, pitchDiameter: 14.701, minorDiameter: 13.835, tapDrill: 14, series: 'coarse', choice: 1 },
  'M16x1.5': { diameter: 16, pitch: 1.5, pitchDiameter: 15.026, minorDiameter: 14.376, tapDrill: 14.5, series: 'fine', choice: 1 },
  M18: { diameter: 18, pitch: 2.5, pitchDiameter: 16.376, minorDiameter: 15.294, tapDrill: 15.5, series: 'coarse', choice: 2 },
  M18x2: { diameter: 18, pitch: 2, pitchDiameter: 16.701, minorDiameter: 15.835, tapDrill: 16, series: 'fine', choice: 2 },
  'M18x1.5': { diameter: 18, pitch: 1.5, pitchDiameter: 17.026, minorDiameter: 16.376, tapDrill: 16.5, series: 'fine', choice: 2 },
  M20: { diameter: 20, pitch: 2.5, pitchDiameter: 18.376, minorDiameter: 17.294, tapDrill: 17.5, series: 'coarse', choice: 1 },
  M20x2: { diameter: 20, pitch: 2, pitchDiameter: 18.701, minorDiameter: 17.835, tapDrill: 18, series: 'fine', choice: 1 },
  'M20x1.5': { diameter: 20, pitch: 1.5, pitchDiameter: 19.026, minorDiameter: 18.376, tapDrill: 18.5, series: 'fine', choice: 1 },
  M22: { diameter: 22, pitch: 2.5, pitchDiameter: 20.376, minorDiameter: 19.294, tapDrill: 19.5, series: 'coarse', choice: 2 },
  M22x2: { diameter: 22, pitch: 2, pitchDiameter: 20.701, minorDiameter: 19.835, tapDrill: 20, series: 'fine', choice: 2 },
  'M22x1.5': { diameter: 22, pitch: 1.5, pitchDiameter: 21.026, minorDiameter: 20.376, tapDrill: 20.5, series: 'fine', choice: 2 },
  M24: { diameter: 24, pitch: 3, pitchDiameter: 22.051, minorDiameter: 20.752, tapDrill: 21, series: 'coarse', choice: 1 },
  M24x2: { diameter: 24, pitch: 2, pitchDiameter: 22.701, minorDiameter: 21.835, tapDrill: 22, series: 'fine', choice: 1 },
  M27: { diameter: 27, pitch: 3, pitchDiameter: 25.051, minorDiameter: 23.752, tapDrill: 24, series: 'coarse', choice: 2 },
  M27x2: { diameter: 27, pitch: 2, pitchDiameter: 25.701, minorDiameter: 24.835, tapDrill: 25, series: 'fine', choice: 2 },
  M30: { diameter: 30, pitch: 3.5, pitchDiameter: 27.727, minorDiameter: 26.211, tapDrill: 26.5, series: 'coarse', choice: 1 },
  M30x2: { diameter: 30, pitch: 2, pitchDiameter: 28.701, minorDiameter: 27.835, tapDrill: 28, series: 'fine', choice: 1 },
  M33: { diameter: 33, pitch: 3.5, pitchDiameter: 30.727, minorDiameter: 29.211, tapDrill: 29.5, series: 'coarse', choice: 2 },
  M33x2: { diameter: 33, pitch: 2, pitchDiameter: 31.701, minorDiameter: 30.835, tapDrill: 31, series: 'fine', choice: 2 },
  M36: { diameter: 36, pitch: 4, pitchDiameter: 33.402, minorDiameter: 31.67, tapDrill: 32, series: 'coarse', choice: 1 },
  M36x3: { diameter: 36, pitch: 3, pitchDiameter: 34.051, minorDiameter: 32.752, tapDrill: 33, series: 'fine', choice: 1 },
  M39: { diameter: 39, pitch: 4, pitchDiameter: 36.402, minorDiameter: 34.67, tapDrill: 35, series: 'coarse', choice: 2 },
  M39x3: { diameter: 39, pitch: 3, pitchDiameter: 37.051, minorDiameter: 35.752, tapDrill: 36, series: 'fine', choice: 2 },
  M42: { diameter: 42, pitch: 4.5, pitchDiameter: 39.077, minorDiameter: 37.129, tapDrill: 37.5, series: 'coarse', choice: 1 },
  M42x3: { diameter: 42, pitch: 3, pitchDiameter: 40.051, minorDiameter: 38.752, tapDrill: 39, series: 'fine', choice: 1 },
  M45: { diameter: 45, pitch: 4.5, pitchDiameter: 42.077, minorDiameter: 40.129, tapDrill: 40.5, series: 'coarse', choice: 2 },
  M45x3: { diameter: 45, pitch: 3, pitchDiameter: 43.051, minorDiameter: 41.752, tapDrill: 42, series: 'fine', choice: 2 },
  M48: { diameter: 48, pitch: 5, pitchDiameter: 44.752, minorDiameter: 42.587, tapDrill: 43, series: 'coarse', choice: 1 },
  M48x3: { diameter: 48, pitch: 3, pitchDiameter: 46.051, minorDiameter: 44.752, tapDrill: 45, series: 'fine', choice: 1 },
  M52: { diameter: 52, pitch: 5, pitchDiameter: 48.752, minorDiameter: 46.587, tapDrill: 47, series: 'coarse', choice: 2 },
  M52x4: { diameter: 52, pitch: 4, pitchDiameter: 49.402, minorDiameter: 47.67, tapDrill: 48, series: 'fine', choice: 2 },
  M56: { diameter: 56, pitch: 5.5, pitchDiameter: 52.428, minorDiameter: 50.046, tapDrill: 50.5, series: 'coarse', choice: 1 },
  M56x4: { diameter: 56, pitch: 4, pitchDiameter: 53.402, minorDiameter: 51.67, tapDrill: 52, series: 'fine', choice: 1 },
  M60: { diameter: 60, pitch: 5.5, pitchDiameter: 56.428, minorDiameter: 54.046, tapDrill: 54.5, series: 'coarse', choice: 2 },
  M60x4: { diameter: 60, pitch: 4, pitchDiameter: 57.402, minorDiameter: 55.67, tapDrill: 56, series: 'fine', choice: 2 },
  M64: { diameter: 64, pitch: 6, pitchDiameter: 60.103, minorDiameter: 57.505, tapDrill: 58, series: 'coarse', choice: 1 },
  M64x4: { diameter: 64, pitch: 4, pitchDiameter: 61.402, minorDiameter: 59.67, tapDrill: 60, series: 'fine', choice: 1 },
};
export const METRIC_THREADS: DataCatalog<MetricThreadRow> = {
  title: 'ISO metric threads',
  summary: 'The ISO metric threads selected for screws, bolts and nuts, M2 to M64, coarse ("M8") and fine ("M8x1"): the nominal diameter and the pitch for a thread feature, the pitch and minor diameters of the basic profile, and the tap-drill diameter for the bore.',
  source:
    'Sizes, pitches, series and choice: ISO 262:1998, Table 1, as reproduced identically in IS 4218 (Part 4):2001 (Bureau of Indian Standards); checked against the table of the English Wikipedia, ISO metric screw thread (which also lists fine pitches of ISO 261 below M8 that ISO 262 does not select). ' +
    'Pitch and minor diameter: ISO 724:1993, Table 1 and its formulae (D2 = D − 0.6495 P, D1 = D − 1.0825 P, rounded to the third decimal place), as reproduced identically in IS 4218 (Part 3):1999; checked against the metric thread chart of Get It Made (get-it-made.co.uk) and, for M45, of Optimas. ' +
    'Tap drill: ISO 2306:1972, Tables 1 and 2 (coarse to M56, fine to M52x4); checked against the charts of Get It Made, Optimas and Engineers Edge and the DIN 336 column of the German Wikipedia, Metrisches ISO-Gewinde. ISO 2306 does not list M56x4, M60, M60x4, M64 and M64x4: their drill is the nominal diameter less the pitch, the rule of its scope, as the chart of Get It Made has them. ' +
    'The basic profile is that of ISO 68-1:1998 (IS 4218 (Part 1):2001). A drilled hole in metal; a printed bore usually needs an allowance.',
  columns: {
    diameter: { title: 'Nominal (major) diameter', unit: 'mm' },
    pitch: { title: 'Pitch', unit: 'mm' },
    pitchDiameter: { title: 'Pitch diameter of the basic profile (D2)', unit: 'mm' },
    minorDiameter: { title: 'Minor diameter of the basic profile (D1)', unit: 'mm' },
    tapDrill: { title: 'Tap drill diameter', unit: 'mm' },
    series: { title: 'Series (coarse or fine)', unit: 'text' },
    choice: { title: 'Choice of the diameter in ISO 262 (1 or 2)', unit: 'none' },
  },
  rows: METRIC_THREAD_ROWS,
};

// ================================================================ the query `hardwareHole`

// The query of D46 gains one use, `tapped`: a plain hole at the tap-drill diameter of a size of
// `metricThreads`, and the fields of the thread to put on its bores. No field of the hole feature
// changes; a tapped hole is a hole and a thread, two features (design.md, "The hole").
// - `size`: a key of `metricThreads` ("M6", "M8x1").
// - `shape`: `{ type: 'plain', diameter }`, the tap drill, with the allowance added as for every
//   use.
// - `label`: absent. The parts list counts a piece of hardware per labelled hole, and a tapped
//   hole takes the screw that is counted at the clearance hole it comes through; the hole is
//   listed among the `unlabelled` holes of the parts list.
// - `thread`: `diameter`, `pitch` and `label` ("M6") for a feature of the type thread whose
//   `faces` are the bores of the hole, `{ feature: <hole>, role: 'holeBore', point }`; with an
//   allowance also `clearance`, half of the allowance (as an expression when the allowance is
//   one): the thread of a bore widened by the allowance is the thread of the diameter larger by
//   it, and the bore stays inside the window of the thread.
// - `fit` is not read. `from`: `['metricThreads']`.
// A draft cannot change the description of a registered query, so the two types below stand for
// the description and the answer after this package.
export type HardwareHoleArgsD75 = Omit<typeof HARDWARE_HOLE_ARGS, 'use'> & {
  use: { kind: 'choice'; options: readonly ['clearance', 'socketHead', 'countersunk', 'nutPocket', 'heatSetInsert', 'tapped']; title: string };
};
export interface HardwareHoleD75 extends Omit<HardwareHole, 'label'> {
  label?: string; // absent for the use `tapped`
  thread?: Input<Pick<ThreadFeature, 'diameter' | 'pitch' | 'clearance'>> & { label: string };
}

// ================================================================ the recompute

// The basic profile from the fields (both stages): radii and flats, or why there is none. With
// a clearance the thread made is this profile with `major` and `minor` smaller (a pin) or larger
// (a bore) by the clearance; the flats stay.
export interface ThreadProfile {
  major: number; // radii
  minor: number;
  pitch: number;
  lead: number;
  starts: number;
  hand: 1 | -1; // 1: right
  halfAngle: number; // flankAngle / 2
  crestFlat: number; // at the major radius
  rootFlat: number; // at the minor radius
}
export declare function threadProfile(feature: Pick<ThreadFeature, 'diameter' | 'pitch' | 'depth' | 'flankAngle' | 'starts' | 'hand'>): ThreadProfile | { detail: string };

// The wall a thread is made on (both stages): the cylinder of the face, the side of its material,
// and its two ends along the axis, read from the triangles of the face in the body. Refused with
// the reason: a face that is no cylinder, one whose triangles leave a gap of angle about the axis
// (a part of a cylinder), and one the body has both as a bore and as a pin.
export interface ThreadWall {
  face: number;
  center: Vec3; // a point of the axis
  axis: Vec3; // unit, in the sense of the face (`along`)
  radius: number;
  internal: boolean;
  low: number; // the ends of the face along `axis`, from `center`
  high: number;
}
export declare function threadWall(solid: Solid, face: number, info: FaceInfo): ThreadWall | { detail: string };

// The flat the grooves leave on the wall between them (both stages): the flat of the shifted
// profile at its crest, wider by 2 · tan(halfAngle) per unit the wall truncates the thread and
// narrower per unit the wall stands proud of it. Zero or less: the grooves would take the whole
// wall (`invalidThread`). Measured in spike.md, M.
export const wallFlat = (profile: ThreadProfile, wall: Pick<ThreadWall, 'radius' | 'internal'>, clearance: number): number =>
  wall.internal
    ? profile.rootFlat + 2 * (wall.radius - (profile.minor + clearance)) * Math.tan(profile.halfAngle)
    : profile.crestFlat + 2 * (profile.major - clearance - wall.radius) * Math.tan(profile.halfAngle);
// The window of the wall (both stages), radii: a bore from the minor radius of the basic thread
// to half of the depth of the shifted one; a pin from half of the depth of the shifted one to
// the major radius of the basic thread. Compared with `LENGTH_TOLERANCE`.
export const wallWindow = (profile: ThreadProfile, internal: boolean, clearance: number): { low: number; high: number } => {
  const half = (profile.major - profile.minor) / 2;
  return internal ? { low: profile.minor, high: profile.major + clearance - half } : { low: profile.major - clearance - half, high: profile.major };
};

// How far a tool keeps from what it must not lie in (its hidden faces from the wall, its flat end
// from a shoulder), how far it runs past an open end, and how near to an end of the wall an end
// of a thread is taken to be at it. Above the sagitta of the polygons and above two bands of the
// kernel adapter (`bandOf` of the body and the tool, 10⁻⁵ of their size), as the lift of a blend
// is (D63); spike.md, C, H, J and P.
export const threadLift = (chordTolerance: number, band: number): number => Math.max(0.05, 2 * chordTolerance, 2 * band);
// A thread shallower than this many chord tolerances is not modelled (spike.md, H).
export const MIN_THREAD_DEPTH_TOLERANCES = 5;
// The most triangles the tool of one feature may have. By the rate of the spike (31 000 triangles
// of eight tools in 0.45 s) about three seconds of the boolean; to be confirmed by the
// implementation.
export const MAX_THREAD_TRIANGLES = 200_000;
// The triangles of the tool of one wall, before it is built (stage 2): two per strip of the
// profile (four strips) per line of the turn, per pitch of `length`, which is the span of the
// tool (the thread with its run-outs and what it runs past an open end), and the two ends.
export declare function threadTriangles(profile: ThreadProfile, wall: ThreadWall, length: number, chordTolerance: number): number;

// An end of a thread at an end of its wall, read from the mesh of the body (both stages): the
// triangles of other faces across the rim of the wall there. Each has one vertex that is not on
// the rim; its distance from the axis is compared with the radius of the wall to the precision of
// the coordinates (the vertices of a face lie on its exact surface, so the answer does not depend
// on the size of the triangles). In this order:
// 1. `shoulder`: one of those vertices lies on the air side of the wall (inside the radius of
//    a bore, outside that of a pin).
// 2. `inside`: otherwise, one of them lies on the cylinder of the wall: the wall goes on under
//    another name.
// 3. `open`: otherwise, with `runOut`: the faces next to the rim are walked across their edges
//    for as long as they lie beyond the end and between the wall and the root cylinder of the
//    shifted thread (a bore: within `major + clearance` of the axis; a pin: beyond
//    `minor − clearance`); the largest distance beyond the end they reach inside that band, their
//    edges cut where they leave it. Zero for a mouth in a plane; the axial depth of a chamfer or
//    a countersink until it is as wide as the major diameter, and of a chamfered tip of a pin
//    until it is as narrow as the minor one. A walk that meets a vertex on the air side of the
//    wall ends there.
export declare function threadEndAt(solid: Solid, wall: ThreadWall, end: 'low' | 'high', profile: ThreadProfile, clearance: number): { kind: 'shoulder' | 'inside' } | { kind: 'open'; runOut: number };

// The tool of one wall (stage 2): the sweep of the axial profile along the helix between two
// planes across the axis, cut flat at both while it is built (the spike's `buildSwept`; the same
// triangles serve both hands, spike.md, L).
// - A bore: a ring between a cylinder two lifts inside the wall and the thread surface of the
//   shifted profile; between the grooves the ring ends one lift inside the wall, the flanks run
//   on to there (the spike's kind `ridge`). A post in the middle of the bore is left alone.
// - A pin: between the thread surface of the shifted profile and a cylinder two lifts outside the
//   wall; between the grooves it starts one lift outside the wall (the spike's kind `groove`).
// - `from`, `to`: along the axis from the datum, already moved past an open end (by the run-out
//   and the lift) or short of a shoulder (by the lift). `datum`: `origin`, `axis` and `zero` of
//   the record.
// - Faces: `threadFlank` start and end, `threadRoot`, `threadEnd` start and end, numbered from
//   `firstFaceId` in that order. Both flat ends of every tool are `threadEnd`, whatever the end
//   was read as; one in the air leaves no triangle.
// - The hidden faces (the cylinder beside the wall and the strips between the grooves) carry
//   `guardFaceId`, a number that is no face of the model. A triangle of it in the body after the
//   boolean means that something stood in the way of the tool: `invalidThread`.
export declare function buildThreadTool(profile: ThreadProfile, wall: ThreadWall, datum: { origin: Vec3; axis: Vec3; zero: Vec3 }, clearance: number, from: number, to: number, chordTolerance: number, lift: number, firstFaceId: number, guardFaceId: number): Solid;

// The description of a flank: an exact surface the engine does not describe further. Published as
// `Surface` of the kind `general`, as the surface of an imported mesh is, but it is not one: the
// body can be changed by later features (`isImported` asks for `mesh`).
export type FaceInfoD75 = FaceInfo | { planar: false; surface: 'general' };

// ================================================================ what the package does not add

// - No upgrade step: a build without the package refuses a feature of a type it does not know, and
//   a build of stage 1 refuses `modelled: true` in the validator, which lists the values it takes.
// - No command and no section of the document: the thread is a feature; what the evaluation
//   records is derived.
// - No member of the kernel port: one `boolean('difference')` per body.
// - No query: the catalog is read by `catalog`, the threads of a body by `body`, a tapped hole is
//   composed by `hardwareHole`.
