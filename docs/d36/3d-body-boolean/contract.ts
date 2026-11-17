// Contract of package 3d (D56): the boolean of bodies, the subtraction with a clearance and the
// split by a plane. A draft for review, only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// It imports the real types of the engine and the shared types of the preparatory step and states
// what the package adds: two feature types with their patches, a face role, an issue code, one
// optional member of a feature module, and the three functions of the recompute the two steps are
// made of. The kernel port stays as it is (design.md, "The kernel port stays as it is").

import type { BooleanOp, Feature, FeatureBase, Frame, Id, NumberSpec, Patch, Solid, SolidKernel } from '../../../packages/engine/src/index';
import type { FeatureTypeInfo } from '../../../packages/engine/src/features/module';
// Internal to the engine, not exported from its index: the exact description of a face.
import type { FaceInfo } from '../../../packages/engine/src/solid';
import type { FaceNameAfter, PlaneRefAfter } from '../00-prep/contract';
import { FACE_ROLES } from '../00-prep/contract';

// ================================================================ the feature `combine`

// A boolean of finished bodies. The target is changed and keeps its ID, its place in the model,
// its properties and its link; the tools are used up or kept.
// - `operation`: `union` (the target with the tools joined to it), `difference` (the target less
//   the tools), `intersection` (what the target shares with every tool). With several tools the
//   operation is made with one after another, in the order of the list.
// - `target`: a body. `tools`: one or more bodies, none twice, none the target.
// - `keepTools`: false: the tool bodies leave the model with this feature; a later feature that
//   names one ends in `brokenReference`, and an entry of body properties or of a link that names
//   one is left without its body (it is listed as such, as after a removed feature). True: they
//   stay as they are (a motor subtracted from its mount stays a body). There is no default.
// - `clearance` (numeric field `clearance`, millimetres, 0 or more, optional; only with
//   `difference`): every tool is taken moved outwards by that much before it is subtracted, so
//   the pocket is wider than the tool by the clearance. The tool body itself does not change.
//   Absent or 0 (also an expression that gives 0) is a plain difference.
//   - Every face of the tool is moved along its own surface: a plane along its normal,
//     a cylinder and a cone by their radius; neighbours meet where the moved surfaces meet, so an
//     outer corner of the tool stays sharp (the pocket is up to 1.73 times the clearance away
//     from it) and no face is added or lost.
//   - How exact it is: the moved surfaces are exact, and between two planar faces so is the
//     pocket. A round face is a polygon in the mesh: there the pocket may be nearer to the tool
//     than the clearance by the chord tolerance of the document, and next to an edge where a round
//     face meets another face at a slant by up to `ROUND_ALLOWANCE` of the clearance more (0.87
//     of the clearance was measured where two cylinders cross). `gap` measures what it is.
//   - A tool that cannot be moved that way is the error `invalidClearance`.
//   - `setField` reaches the field also while the feature does not have it (its description has
//     the default 0, the rule of D44); `updateFeature` with `{ clearance: null }` removes it,
//     and a patch to another operation removes it by itself.
// - Faces. Without a clearance a face of the result keeps the name it had on the target or on the
//   tool, whichever it comes from; where a face of a tool lies flush on a face of the target and
//   the two overlap, the overlapped part carries the name of the tool's face (for an
//   intersection: of the target's). A face may then lie on two bodies, the target and a kept
//   tool. With a clearance above 0 the faces the tools leave on the target are new faces: the
//   name of the face of the tool with a copy tag appended, `{ pattern: <this feature>, index:
//   <the number of the tool in `tools`, from 1> }`; their surfaces are the moved ones, exact.
//   The number follows the place in `tools`: a tool put before others renumbers the tags.
// - The feature creates no body and leaves no tool a pattern could repeat.
// - Errors: `brokenReference` (the target or a tool is not in the state before the feature),
//   `emptyResult` (nothing of the target would be left; for an intersection: the target and
//   a tool share nothing), `invalidClearance`, `kernelFailure` (the kernel refused, or its
//   result did not pass the checks of the engine: see `booleanOfBodies`). The warning `noEffect`
//   names the tools that did not change the target; tools that are not kept leave the model all
//   the same. The feature is atomic: in error it changes nothing, and no tool leaves.
export interface CombineFeature extends FeatureBase {
  type: 'combine';
  operation: BooleanOp;
  target: Id;
  tools: Id[];
  keepTools: boolean;
  clearance?: number;
}
// What `updateFeature` may change. `tools` is a list and is replaced whole.
export type CombinePatch = Patch<Pick<CombineFeature, 'operation' | 'target' | 'tools' | 'keepTools' | 'clearance'>>;

// The default is what an absent field means (D44, "An optional numeric field"): no clearance.
export const CLEARANCE = { title: 'Clearance', unit: 'mm', min: { value: 0 }, default: 0 } as const satisfies NumberSpec;

// ================================================================ the feature `split`

// A split of a body by a plane: a cut that keeps what it cuts off.
// - `body`: the body that is split. It keeps its ID, its properties and its link, and what lies
//   on the other side of the plane than `side`.
// - `plane`: a base plane, a plane feature or a planar face of a body, as the plane of a sketch;
//   for a face the whole plane it lies in. Resolved in the state before the feature.
// - `side`: the part of the body that becomes the new body: `forward` is the part the normal of
//   the plane points to (for a face: out of the body the face belongs to; XY: +Z, XZ: -Y, YZ:
//   +X; a plane feature: as its base), `backward` the other. The new body has the ID of the
//   feature.
// - Where the plane passes through material, both bodies get the cut face `{ feature: <this
//   feature>, role: 'splitFace' }`, one name on two bodies. It is a plane: a sketch stands on it,
//   with the origin and the Y axis of the plane that cut and the normal out of the body it stands
//   on. A body of several pieces that lie on both sides of a plane between them is taken apart
//   without a cut face. A face of the body that lies in the plane keeps its name, with one
//   exception: where such a face is the underside of an overhang and the plane also cuts material
//   beside it, the part of it the cut face lies on takes the name of the cut face.
// - Later features that name the body keep naming the part that stays under its ID: a cut that
//   went through the whole body goes through that part only, without a word. A feature that is
//   to reach both parts lists both bodies.
// - The new body takes after the body it was cut from (body properties, D48): colour, material,
//   use, and the density and the mass as a pair; its name is that of the feature. It is in no
//   link until one lists it.
// - A part may be several pieces (a plane across a U): it is still one body.
// - Errors: `brokenReference` (the body or the plane), `nonPlanarFace`, `emptyResult` (the plane
//   does not cut the body: one of the two parts would be nothing), `kernelFailure`. In error the
//   body stays whole and there is no new body.
export interface SplitFeature extends FeatureBase {
  type: 'split';
  body: Id;
  plane: PlaneRefAfter;
  side: 'forward' | 'backward';
}
// A plane is a reference and is replaced whole.
export type SplitPatch = Patch<Pick<SplitFeature, 'body' | 'plane' | 'side'>>;

// ================================================================ the unions

declare module '../00-prep/contract' {
  interface FeatureTypes {
    combine: CombineFeature;
    split: SplitFeature;
  }
  interface FeaturePatches {
    combine: CombinePatch;
    split: SplitPatch;
  }
  // The face a split cuts: one face of the feature, on both bodies.
  interface FaceRoles {
    splitFace: {};
  }
  // `invalidClearance`, an error of a combine: a tool cannot be moved outwards by the clearance
  // without a change of its shape. `refs` start with the tool body and name the faces concerned.
  // - a face would vanish or turn over (a hole no wider than twice the clearance closes);
  // - two parts of the tool are nearer to each other than twice the clearance (a slot, two pins,
  //   the tips of a C), so their moved faces would meet;
  // - more than three faces meet at a vertex in a way their moved surfaces do not;
  // - a face has material on both sides of its surface (one name on a hole and on a pin, which
  //   a body put together of others can have);
  // - a face of the tool has no description at all (a general surface; no feature makes one yet).
  interface IssueCodes {
    invalidClearance: true;
  }
}

export const SPLIT_ROLE: Pick<typeof FACE_ROLES, 'splitFace'> = { splitFace: { title: 'cut face of a split', parts: {} } };

// What the registry says of the two types (`info` of their modules); the summaries are what
// `describe_api` prints.
export const COMBINE_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Combine',
  summary:
    'A boolean of finished bodies: the target is joined with the tools (`union`), has them subtracted (`difference`) or keeps what it shares with them (`intersection`). The target keeps its ID; with `keepTools: false` the tool bodies leave the model. ' +
    'A difference may have a `clearance`: every tool is subtracted moved outwards by that much on every face (a pocket for a motor or a board shaped by the part itself); the faces of the pocket are then the faces of the tool with a copy tag of this feature.',
  fields: [{ path: 'clearance', spec: CLEARANCE, when: { path: 'operation', equals: 'difference' } }],
  bodies: 'none',
};
export const SPLIT_INFO: Omit<FeatureTypeInfo, 'updatable'> = {
  title: 'Split',
  summary:
    'Splits a body by a plane (a base plane, a plane feature or the plane of a planar face). The body keeps its ID and the part on one side; the part on the side `side` (`forward`: where the normal of the plane points) becomes a new body with the ID of the feature. Both get the cut face `{ feature, role: "splitFace" }`, a plane a sketch can stand on.',
  fields: [],
  bodies: 'self',
};

// ================================================================ the registry of feature types

// One optional member is added to a feature module. A copy tag of a face name (`CopyTag`) names
// the feature that made the copy: until now always a pattern, now also a combine with a clearance.
// The reference of the kind `pattern` (`requireFace`, `faceRefs` in validation.ts) asks this member
// instead of the type of the feature: a pattern answers true, a combine whether it is a difference
// (structurally: whether a clearance is there and above 0 is known only to the recompute, and
// a tag that names no face is a broken reference there). The field of the tag keeps its name,
// `pattern`.
declare module '../../../packages/engine/src/features/module' {
  interface FeatureModule<F extends Feature> {
    tagsFaces?: (f: F) => boolean;
  }
}
// What the two modules answer where the registry asks every type (features/module.ts):
// - combine: `createsBody` false, `namesFaces` false, `producesTool` false, `tagsFaces` for
//   a difference; `refs`: the target and the tools as bodies.
// - split: `createsBody` for its own ID (no local name), `bodySource` the body it splits,
//   `namesFaces` true, `producesTool` false; `refs`: the body and the plane.

// ================================================================ the recompute

// The three functions the two steps are made of (design.md, "Recompute"). They live in
// `recompute/`, next to the tool builds; the modules of the two types call them.

// A boolean of two solids of one face table through the port.
// - Numbers of its own for the tool. The adapter of the kernel tells the faces of the tool from
//   those of the body by their numbers, and two bodies of a model may share numbers (the two
//   parts of a split, two bodies cut by one feature, a body and the pocket a kept tool left in
//   another): measured, a union of two such bodies comes out with a wrong volume without a word
//   in about half the cases tried (design.md, "Measured", D). So every face number of `tool` is
//   replaced by a number from `firstFree` on for the call and put back in the result. The
//   adapter itself is to refuse a union or a difference whose operands share a number, so that
//   a caller that forgets it gets an exception and not a wrong body.
// - `changed`: false when the tool had no effect on the target: the volume is what it was (the
//   tolerance of `applyTool`) and, for a difference, every face of the tool in the result lies on
//   the surface the target had (`onSurface` of solid.ts, the rule of a pattern copy that
//   lands on what is cut already). Decided on the temporary numbers, before they are put back:
//   afterwards a face the target had from that tool cannot be told from one it got now.
// - The checks of the engine on a union and a difference (design.md, "The engine checks the
//   result"), each an exception the feature reports as `kernelFailure`:
//   - the volume: that of the result against vol(target) + vol(tool) - vol(shared) for a union
//     and vol(target) - vol(shared) for a difference, with the shared volume from the port's
//     intersection; they may differ by `VOLUME_TOLERANCE` of the two volumes together, and by
//     0.001 mm³ at least;
//   - sheets: the result has no more area in triangles that lie back to back within
//     `SHEET_TOLERANCE` precisions of the coordinates than the two operands had (`areaOf` with
//     and without its tolerance): a wall of the tool left inside the result, a face that should
//     be gone.
// - An intersection: the port keeps no tolerance for flush faces, and two bodies that only touch
//   leave sheets (measured: every such leftover is all sheet). A connected piece of the result
//   whose whole surface is sheet at `SHEET_TOLERANCE` is dropped; a piece with any other surface
//   stays, however small, and so does the shell of a cavity.
// It throws what the port throws.
export interface BodyBoolean {
  solid: Solid;
  changed: boolean;
}
export declare function booleanOfBodies(kernel: SolidKernel, op: BooleanOp, target: Solid, tool: Solid, firstFree: number): BodyBoolean;
export const VOLUME_TOLERANCE = 1e-6; // a share of the two volumes together; the floor is `INTERFERENCE_THRESHOLD`, 0.001 mm³
export const SHEET_TOLERANCE = 10; // in precisions of the coordinates (`coordinatePrecision` over the two operands)

// The box on one side of a plane that holds everything of `body` on that side: one face in the
// plane, numbered `first`, and five faces outside the body by `SPLIT_MARGIN`, numbered from
// `first + 1`, which no result may hold. Undefined when the body has nothing on that side.
// The split is two differences with such boxes: the body less the box on the side `side` stays
// the body, the body less the other box is the new body.
export declare function halfSpaceBox(body: Solid, plane: Pick<Frame, 'origin' | 'x' | 'y' | 'normal'>, side: 'forward' | 'backward', first: number): Solid | undefined;
// How far the five other faces of the box are from the body: the larger of 1 mm and this share of
// the diagonal of the body. Small on purpose: the tolerances of the kernel follow the size of the
// two solids together.
export const SPLIT_MARGIN = 0.05;

// A body with every face moved outwards by `clearance` along its own surface.
// - `solid`: the same vertices, moved; the triangles of round faces as they were, the planar
//   faces triangulated again from their moved outline. The face numbers are those of the body:
//   the caller gives the moved faces numbers and names of their own.
// - `infos`: the moved description of every face of the body, by its number.
export interface MovedBody {
  solid: Solid;
  infos: ReadonlyMap<number, FaceInfo>;
}
// Why a body cannot be moved; the error `invalidClearance` of the feature carries it.
// - `noSurface`: a face has no description (a general surface).
// - `bothSides`: triangles of one face lie on both sides of its surface.
// - `closes`: a hole (a cylinder with the material outside) has a radius no larger than the
//   clearance.
// - `vertex`: a vertex cannot lie on all the moved surfaces of its faces.
// - `outline`: the moved outline of a planar face crosses itself.
// - `turned`: a triangle of a round face turned over.
// - `crosses`: an edge of the moved mesh goes through a triangle of it.
// - `tooNear`: a point of the moved surface is nearer to the body than the clearance.
export interface MoveProblem {
  reason: 'noSurface' | 'bothSides' | 'closes' | 'vertex' | 'outline' | 'turned' | 'crosses' | 'tooNear';
  faces: FaceNameAfter[];
  detail: string;
}
// Kept by the identity of the solid of the tool, the clearance and the chord tolerance (as
// `analyzeBody` keeps what it computes for a solid): a recompute that changes neither does not
// move the tool again.
export declare function movedOutwards(body: Solid, faceInfos: readonly FaceInfo[], faceNames: readonly FaceNameAfter[], clearance: number, chordTolerance: number, kernel: Pick<SolidKernel, 'triangulate'>): MovedBody | MoveProblem;
// The share of the clearance a point of the moved surface may lack against the face it came from
// and the faces next to that one, when one of the two is round, on top of the chord tolerance.
// A vertex on an edge of a round face and another face moves to where the two moved surfaces
// meet, which is along the round face when the two meet at a slant; the sides of the polygon of
// the round face then span a wider angle than the chord tolerance gave them (design.md, "The
// checks of the moved tool").
export const ROUND_ALLOWANCE = 0.15;

// ================================================================ what the package does not add

// - No member of the kernel port: a split is two differences, the clearance is computed by the
//   engine from the exact faces, and an intersection is the port's. The comment of `SolidKernel`
//   gets the precondition of a union and a difference (no number in both operands), which the
//   adapter enforces.
// - No upgrade step: a build without the package refuses a feature of a type it does not know,
//   and a face name in a role it does not know.
// - No command, no query, no section of the document.
