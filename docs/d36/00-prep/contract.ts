// Contract of the preparatory step of D36, parts 1 (registry of queries) and 4 (shared vocabulary).
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and states what
// is added or changed. Parts 2 and 3 (a module per feature type, panels of the app) change no
// public type and have no contract; their designs are part2-feature-modules.md and
// part3-app-panels.md.
//
// Sixth version, after five rounds of reviews (design.md, "Reviews").
//
// Where the types will live: what a caller of the engine or an AI reads goes to `types.ts`
// (`Surface`, `EntityRef`, `QueryOutcome`, the additions to `Evaluation` and `Engine`), because
// the description for the AI is cut out of the raw text of that file. The machinery (`ArgKind`,
// `ValueOf`, `ArgsOf`, `QuerySpec`, the registries) goes to modules of its own, so that it does
// not reach that description.

import type { AxisRef, BodyResult, Command, CommandResult, ConstraintExplanation, CopyTag, Document, Engine, ExternalRef, EngineState, Evaluation, FaceName, Feature, FeaturePatch, FeatureResult, Frame, Id, Input, InterferenceReport, Issue, IssueCode, NumberSpec, PlaneRef, SketchDiagnosis, SolidKernel, Unit, Vec3 } from '../../../packages/engine/src/index';
// Internal to the engine, not exported from its index: what the recompute keeps about a sketch.
import type { SketchState } from '../../../packages/engine/src/evaluate';

// ================================================================ what a package adds to the unions

// In the code a package adds a member to a union of types.ts (`Feature`, `FeaturePatch`,
// `Command`, `FaceName`, `IssueCode`) or a field to `Document`. A draft cannot edit that file, so
// these maps stand for that one line: a contract merges its addition into a map, and the types
// below are the unions with every addition. All contracts are type-checked together, so two
// packages that add the same name differently do not compile. calls.ts, section j, shows one of
// each.
// - A package that changes an existing feature type (the extrusion gets an offset, a taper,
//   a new extent) merges the changed interface under the name of the type: `extrude`. It then
//   stands in place of the interface of today, so a field it adds can be read from a feature of
//   the state. A name is taken once, so the packages of one track share that declaration: the
//   first one owns it and the others add to it there. The same holds for a face role.
// - What a section of the document adds to the result of the recompute (as `parameters` and
//   `checks` are there today) is merged into the interface `EvaluationAfter` below.
export interface FeatureTypes {} // type of the feature → its interface
export interface FeaturePatches {} // type of the feature → what `updateFeature` may change of it
export interface Commands {} // type of the command → the command
export interface DocumentSections {} // field of the document → its type
export interface FaceRoles {} // role → the fields of a face name beyond `feature`, `role` and `copy`
export interface IssueCodes {} // code → true
export type FeatureAfter = Exclude<Feature, { type: keyof FeatureTypes }> | FeatureTypes[keyof FeatureTypes];
export type FaceNameAfter = Exclude<FaceName, { role: keyof FaceRoles }> | { [R in keyof FaceRoles]: { feature: Id; role: R; copy?: CopyTag[] } & FaceRoles[R] }[keyof FaceRoles];
export interface EdgeNameAfter {
  a: FaceNameAfter;
  b: FaceNameAfter;
}
export type PlaneRefAfter = Exclude<PlaneRef, { kind: 'face' }> | { kind: 'face'; body: Id; face: FaceNameAfter };
export type ExternalRefAfter = Omit<ExternalRef, 'edge'> & { edge: EdgeNameAfter };
export type CommandAfter =
  | Exclude<Command, { type: 'batch' }>
  | { type: 'batch'; commands: CommandAfter[] }
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRefAfter } // a sketch on a face in a role of a package
  | { type: 'addExternal' | 'updateExternal'; sketch: Id; id: Id; ref: ExternalRefAfter } // an edge of such a face, projected
  | { type: 'addFeature'; feature: Input<FeatureTypes[keyof FeatureTypes]>; index?: number }
  | { type: 'updateFeature'; id: Id; patch: FeaturePatches[keyof FeaturePatches] }
  | Commands[keyof Commands];
export type DocumentAfter = Omit<Document, 'features'> & { features: FeatureAfter[] } & DocumentSections;
export type IssueAfter = Omit<Issue, 'code'> & { code: IssueCode | keyof IssueCodes };
export type FeatureResultAfter = Omit<FeatureResult, 'error' | 'warnings'> & { error?: IssueAfter; warnings: IssueAfter[] };
export type BodyResultAfter = Omit<BodyResult, 'edges'> & { edges: (Omit<BodyResult['edges'][number], 'name'> & { name: EdgeNameAfter })[] };
// Not rewritten by the draft: a reference inside a feature of today as `addFeature` sends it and
// as the document holds it (the plane of a sketch, the base of a plane feature) and the patches
// of today's types (`FeaturePatch`), beyond what `FeatureTypes` and `FeaturePatches` restate.
// A sketch is moved onto a face in a new role by `setSketchPlane`; a contract that needs more
// restates that feature type.
export type { FeaturePatch };

// ================================================================ shared vocabulary

// ---------------------------------------------------------------- units

// `Unit` in catalog.ts is `mm | rad | count | none`. A threshold of the interference query is
// a volume already, and density, mass and area follow. `Unit` grows to this; a numeric field of
// the document and an argument of a query use the same description.
export type QuantityUnit = Unit | 'mm2' | 'mm3' | 'g' | 'g/cm3';
export type QuantitySpec = Omit<NumberSpec, 'unit'> & { unit: QuantityUnit };

// ---------------------------------------------------------------- surfaces of faces

// What a face is, exactly. The engine has this as `FaceInfo` in solid.ts (a plane, a cylinder,
// a swept surface) and publishes only `planar`. `FaceInfo` stays internal and keeps what only the
// engine needs (the `y` direction of a planar face, from which the frame of a sketch on the face
// is built); it gets the two new kinds. `Surface` is what is published, derived from it.
//
// kind      | a sketch can stand on it | comes from
// plane     | yes                      | caps, sides from lines
// cylinder  | no                       | sides from arcs and circles
// cone      | no                       | taper of a circle, countersink, revolve of a line
// swept     | no                       | gear teeth, a spline side
// general   | no                       | revolve of an arc, twist, fillet of a circular edge
//
// A general surface says nothing more. A package that needs more of one (the revolve, for the rim
// of a revolved arc to be a circle) adds a kind with what identifies the surface: a sphere with
// its centre and radius, a torus with its axis and two radii.
//
// A surface has no side: `normal` of a plane and `axis` of a cylinder carry no sign. Which side
// the material is on belongs to the face of a body (BodyFace). The one exception is `axis` of
// a cone, which points from the apex towards the face, because a cone has two halves.
// Directions that do have a sign are frames (`Frame`): the frame of a face has its normal
// pointing out of the body, and the base planes have fixed normals (XZ: -Y).
export type Surface =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number } // origin: a point of the axis
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number } // radians, between the axis and the surface
  | { kind: 'swept'; axis: Vec3 } // a planar curve moved along `axis`
  | { kind: 'general' };

// The evaluation publishes the surfaces next to the names of the faces: the field is added to
// `Evaluation` itself, so every state the engine returns has it. The draft cannot change the real
// interface (the real engine is type-checked with it), so it writes the evaluation and the state
// after the step as types of their own, and `EngineAfter` below returns them.
// - The surfaces of the evaluation are where the model was modelled. A query does not read them:
//   it asks its context (`QueryContext.surface`), which answers in the pose it was asked about.
// - One number of a face can lie in two bodies: a cut through two targets leaves the faces of
//   the one tool in both. That is why a surface in a pose is asked by body and face.
export interface EvaluationAfter extends Omit<Evaluation, 'features' | 'bodies' | 'faceNames'> {
  features: Record<Id, FeatureResultAfter>;
  bodies: Record<Id, BodyResultAfter>;
  faceNames: FaceNameAfter[];
  faceSurfaces: Surface[]; // index = number of the face, like `faceNames`
}
export interface StateAfter extends Omit<EngineState, 'document' | 'evaluation'> {
  document: DocumentAfter;
  evaluation: EvaluationAfter;
}
export type CommandResultAfter = { ok: true; state: StateAfter } | Extract<CommandResult, { ok: false }>;
// One place outside the engine builds an evaluation by hand: `stateBefore(0)` in the app, the
// state before the first feature (the current evaluation with `features`, `bodies` and
// `faceNames` emptied). It empties `faceSurfaces` as well. Such a state is not one the engine
// handed out, so `query` refuses it (QueryOptions); the app asks nothing in that mode today.

// Kinds of edges (`EdgeKind` keeps its four values). `edgeKind` decides from the two `FaceInfo`s
// of an edge, and `projectEdge` computes the centre and the radius of a circle from them, so the
// rule has to be decidable from the two surfaces alone. Today a circle is "a plane and
// a cylinder". It becomes these pairs, both about one axis (within `ANGLE_TOLERANCE` and
// `LENGTH_TOLERANCE` of util.ts):
// - a plane across the axis and a cylinder (as today);
// - a plane across the axis and a cone: the mouth of a countersink;
// - a cylinder and a cone: the lower rim of a countersink;
// - two cones that differ in the apex or in the half angle.
// The circle the two surfaces meet in follows from them alone, and it has to have a radius above
// the tolerance: a plane through the apex of a cone gives none.
// Everything else stays as it is today:
// - Two faces of one surface (the same cylinder, the same cone) are `other`. A circle drawn as
//   two arcs gives two cylindrical faces whose seam is straight. Two stacked cylinders of one
//   radius from two features meet in a circle and are `other` too, today and after: the two
//   surfaces do not say where along the axis the edge is.
// - An edge with a general surface is `other`.

// ---------------------------------------------------------------- roles of faces

// A face is named by the feature that made it and its role there. The roles are a closed union in
// types.ts (`side` with the curve it came from, `startCap`, `endCap`), and five more places spell
// them out: the validator `faceName` (document.ts), `faceKey` (util.ts, and a copy of it in the
// app), `faceLabel` of the MCP tools and the texts `ROLES` of the app. A hole, a revolve,
// a chamfer, a fillet and a split all name faces in new roles.
// - The union stays in types.ts, one member per role, because it is what an AI reads.
// - The validator, the key and the label of MCP read a catalog. An entry says how the role is
//   called and names every field that tells apart the faces of that role within one feature, with
//   how that field is called (`curve` for `side`; none for a cap; the point and the step of
//   a counterbore for the wall of a hole). A package adds one member to the union and one entry.
// - A field that tells faces apart is a text (an ID) or a whole number, and is always there:
//   a key cannot be built from an object, and a field that may be missing would give two faces
//   one key. The entry says which of the two a field is, so the validator of a face name can
//   check it; it is what `faceName` in document.ts checks by hand today.
// - The compiler ties the union and the catalog: a role without an entry does not compile, nor
//   an entry that leaves out a field of the name or gives it the other kind. A role whose name
//   has a field of another type, or an optional one, stops the type check here; the message
//   lists the roles.
// - The key of a face is `<feature>/<role>`, then the values of those fields in the alphabetical
//   order of their names, then the copy tags as today. For the three roles of today it is the
//   key of today, which fingerprints of solved sketches and the face table depend on.
// - The app keeps its own table of texts for the roles (`ROLES` in issue-text.ts, tested). It is
//   typed by the union, so the compiler asks for its line as well.
type FaceParts<R extends FaceNameAfter['role']> = Omit<Extract<FaceNameAfter, { role: R }>, 'feature' | 'role' | 'copy'>;
export interface FaceRoleSpec<R extends FaceNameAfter['role']> {
  title: string;
  parts: { readonly [P in keyof FaceParts<R>]-?: { title: string; kind: FaceParts<R>[P] extends string ? 'text' : FaceParts<R>[P] extends number ? 'integer' : never } };
}
export declare const FACE_ROLES: { [R in FaceNameAfter['role']]: FaceRoleSpec<R> };
type BadParts<X> = { [P in keyof X]-?: [X[P]] extends [string] ? never : [X[P]] extends [number] ? never : P }[keyof X];
type InvalidRoles = { [R in keyof FaceRoles]: [BadParts<FaceRoles[R]>] extends [never] ? never : R }[keyof FaceRoles];
export const ROLES_ARE_VALID: [InvalidRoles] extends [never] ? true : { [R in InvalidRoles]: 'is not a valid role' } = true;

// ---------------------------------------------------------------- references to named entities

// One way to say "this thing of the model" in the arguments of a query. A query that takes
// a plane or an axis takes `PlaneRef` or `AxisRef` as they are (the argument kinds `plane` and
// `axis`), not wrapped.
export type EntityRef =
  | { kind: 'body'; body: Id }
  | { kind: 'face'; body: Id; face: FaceNameAfter }
  | { kind: 'edge'; body: Id; edge: EdgeNameAfter }
  | { kind: 'sketchPoint'; sketch: Id; point: Id }; // `origin` is the origin of the sketch

// ---------------------------------------------------------------- placement of a body

// Not in this contract. The first draft had a frame taken from a plane, three offsets and a turn
// about its normal; the reviews showed that it cannot turn a part upside down or tilt it. The
// package that needs a placement first (3b, import of a mesh, or 5a if the links of a mechanism
// need one) designs it, with these requirements: any orientation relative to a directed frame
// (three rotations in a stated order, or an equivalent), every number a numeric field with an
// expression, and a result that is a `RigidTransform`. `Placement` in evaluate.ts is the name
// of something else already.

// ---------------------------------------------------------------- data catalogs

// A table of data the engine carries (hardware, materials, threads). The rule is decided in D36:
// a catalog fills fields, the document stores the numbers.
// - Every catalog has its own columns; a kind of part with other columns is another catalog.
// - Code reads `DATA_CATALOGS` directly and gets the row type of the catalog it names; a column
//   that does not exist does not compile.
// - An untyped caller (MCP) uses the query `catalog`. The description for the AI lists the
//   catalogs by name and summary only, so it does not grow with the tables.
export interface DataCatalog<Row extends { [K in keyof Row]: number | string }> {
  title: string;
  summary: string;
  source: string; // the standard or the data sheet the rows come from; "typical values" when there is none
  columns: { [K in keyof Row]: { title: string; unit: Row[K] extends number ? QuantityUnit : 'text' } };
  rows: Record<string, Row>; // by key, such as "M3"
}
// What the query `catalog` answers with: the table without its row type. A row type written as
// an interface is not a dictionary to the compiler, so the entry copies the rows.
export interface CatalogTable {
  title: string;
  summary: string;
  source: string;
  columns: Record<string, { title: string; unit: QuantityUnit | 'text' }>;
  rows: Record<string, { readonly [column: string]: number | string }>;
}
// The row type of every catalog by name; a package adds its catalog by declaration merging.
export interface Catalogs {}
export declare const DATA_CATALOGS: { [N in keyof Catalogs]: Catalogs[N] extends { [K in keyof Catalogs[N]]: number | string } ? DataCatalog<Catalogs[N]> : never };

// ---------------------------------------------------------------- version of the document schema

// Today `SCHEMA_VERSION` is a constant and `upgrade` one function from version 1. It becomes
// a list of named steps; on `master` the version of a document is the length of the list plus
// one, as a number, as today.
// - A step is needed for a change of the shape of what older documents hold, and for anything
//   a build without the package would drop without a word. `validateDocument` rebuilds
//   a document from the fields it knows: an unknown section, an unknown field directly on
//   a feature and an unknown field of an extent (a taper) are not refused, they are gone after
//   the load. Such an addition gets a step even when the step has nothing to convert; a build
//   that does not have it then refuses the document.
//   No step is needed where a build without the package refuses by itself: a new feature type,
//   a new variant (an extent of a new type), and a field where the validator lists the fields it
//   allows (a profile source, the source, the transform, the span and the axis of a pattern).
// - A step reads and changes only what its package owns (its section, its fields), or what is on
//   `master` already. Steps of different packages therefore give the same document in either
//   order, which the rule below relies on; a test runs the pending steps of a branch before and
//   after the steps merged since it started and compares. A step that has to read what another
//   pending package adds waits for that package to be merged.
// - A branch of a package appends its steps and counts them in `SCHEMA_PENDING`: the steps at
//   the end of the list that `master` does not have yet. A build with pending steps saves
//   `schemaVersion` of the `master` it started from and the names of the pending steps the
//   document has, in a new optional field of `Document`, `schemaSteps`. The merge sets the
//   count to zero; `master` never writes the field.
// - Loading, in every build: take the steps from the version of the document on, leave out the
//   ones the document names, and run the rest in the order of the list. Refused, with a message
//   that says which: a version above the one this build saves (the length of the list plus one,
//   less the pending steps), and a name that is not among the steps after the version of the
//   document (a step this build does not have, or one the version already counts).
//   So a document saved on a branch loads on that branch after a rebase over another merged step
//   (the other step runs, its own does not run twice), and on `master` once the branch is merged.
//   A build of another branch, or `master` before the merge, refuses it.
export interface UpgradeStep {
  name: string; // stable and unique, the ID of the package: `3a-body-properties`
  run(document: Record<string, unknown>): Record<string, unknown>;
}
export declare const UPGRADES: readonly UpgradeStep[];
export declare const SCHEMA_PENDING: number;

// ================================================================ registry of queries

// ---------------------------------------------------------------- arguments

// The arguments of a query are named, and each is described: the checks, the input schema of the
// MCP tool and a form in the app come from the description. A value may have structure; the
// description is still data.
// - `list`: values of one kind, with an optional least and greatest count.
// - `oneOf`: exactly one of the named alternatives, written as an object with that one key:
//   `{ up: [0, 0, 1] }` or `{ onBed: { kind: 'face', ... } }`.
// - `record`: values by key, such as densities by body. The description says what the keys are
//   (IDs of bodies or of features, or free names), so that a mistyped ID is found by the same
//   rule as anywhere else and a form can offer the keys.
// - `fields`: named values of different kinds, for an element of a list or an alternative that
//   is more than one value (an orientation with a spin, a pair to measure).
// `of` of a constraint names a required argument of the kind `sketch` next to it: at the top
// level another argument, inside `fields` another of those fields.
// A number is checked against its own description only. The limit of ±1e9 that `checkNumber`
// puts on a number of the document (coordinates are float32) is not applied to an argument:
// `interference` takes any threshold that is finite and not negative, today and after.
// A description is written `as const satisfies ArgSpecs`; without `as const` the options of
// a choice and the accepted kinds of an entity widen to `string` and the derived type with them.
export type ArgKind =
  | { kind: 'number'; spec: QuantitySpec } // unit and range as for a numeric field
  | { kind: 'flag' }
  | { kind: 'text' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'body' | 'feature' | 'sketch' } // an ID of that kind
  | { kind: 'constraint'; of: string } // a constraint of the sketch named by the argument `of`
  | { kind: 'entity'; accepts: readonly EntityRef['kind'][] }
  | { kind: 'plane' } // PlaneRef, with the face names of every package
  | { kind: 'axis' } // AxisRef
  | { kind: 'vector' } // three numbers
  | { kind: 'list'; of: ArgKind; min?: number; max?: number }
  | { kind: 'oneOf'; options: { readonly [name: string]: ArgKind } }
  | { kind: 'record'; keys: 'body' | 'feature' | 'text'; of: ArgKind }
  | { kind: 'fields'; fields: { readonly [name: string]: ArgKind & { optional?: boolean } } };
export type ArgSpec = ArgKind & { title: string; summary?: string; optional?: boolean };
export type ArgSpecs = { readonly [name: string]: ArgSpec };

// The type of the arguments follows from their description, so the two cannot disagree. (The
// first draft wrote both by hand and tied only the names; a list of bodies described as a flag
// compiled.) `ValueOf` works on an exact description; applied to `ArgKind` itself it does not
// terminate, so code that handles any description (the checker, a generated form) treats values
// as unknown.
export type ValueOf<K> = K extends { kind: 'number' }
  ? number
  : K extends { kind: 'flag' }
    ? boolean
    : K extends { kind: 'text' }
      ? string
      : K extends { kind: 'choice'; options: readonly (infer O)[] }
        ? O
        : K extends { kind: 'body' | 'feature' | 'sketch' | 'constraint' }
          ? Id
          : K extends { kind: 'entity'; accepts: readonly (infer A)[] }
            ? Extract<EntityRef, { kind: A }>
            : K extends { kind: 'plane' }
              ? PlaneRefAfter
              : K extends { kind: 'axis' }
                ? AxisRef
                : K extends { kind: 'vector' }
                  ? Vec3
                  : K extends { kind: 'list'; of: infer E }
                    ? ValueOf<E>[]
                    : K extends { kind: 'oneOf'; options: infer O }
                      ? { [P in keyof O]: { -readonly [Q in P]: ValueOf<O[P]> } & { [Q in Exclude<keyof O, P>]?: never } }[keyof O]
                      : K extends { kind: 'record'; of: infer E }
                        ? Record<string, ValueOf<E>>
                        : K extends { kind: 'fields'; fields: infer F }
                          ? ArgsOf<F>
                          : never;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
// What a caller passes: an optional argument may be left out.
export type ArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { -readonly [K in OptionalKeys<S>]?: ValueOf<S[K]> };
// What `run` receives: the engine has filled in the default of every optional number that has
// one, at every depth (in an element of a list, in `fields`, in an alternative).
type DefaultedKeys<S> = { [K in keyof S]: S[K] extends { optional: true; spec: { default: number } } ? K : never }[keyof S];
export type RunValueOf<K> = K extends { kind: 'list'; of: infer E }
  ? RunValueOf<E>[]
  : K extends { kind: 'oneOf'; options: infer O }
    ? { [P in keyof O]: { -readonly [Q in P]: RunValueOf<O[P]> } & { [Q in Exclude<keyof O, P>]?: never } }[keyof O]
    : K extends { kind: 'record'; of: infer E }
      ? Record<string, RunValueOf<E>>
      : K extends { kind: 'fields'; fields: infer F }
        ? RunArgsOf<F>
        : ValueOf<K>;
export type RunArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>> | DefaultedKeys<S>]: RunValueOf<S[K]> } & { -readonly [K in Exclude<OptionalKeys<S>, DefaultedKeys<S>>]?: RunValueOf<S[K]> };

// ---------------------------------------------------------------- an entry

// What a query computes from. It answers for one state: the document and the evaluation in
// `state`, and what the recompute knew beyond them. The engine keeps, for every evaluation it
// hands out (execute, preview, getState), the internal state and the document it came from, by
// the identity of the evaluation and weakly, so it lives as long as the caller holds the state.
// A query never recomputes the document. A drag preview is therefore diagnosed as dragged, and
// expressions and failed projections are as the recompute saw them.
//
// The pose. With a mechanism (step 5) a query is asked about bodies moved to a pose, while the
// evaluation keeps them where they were modelled.
// - What belongs to a body is in the pose asked about: `bodies`, `surface`, the frame of a face,
//   a face or an edge given as an entity. A query reads the geometry of bodies nowhere else (the
//   state of the context has neither the bodies nor the surfaces), and then it answers for
//   a pose without a change.
// - What does not belong to a body is never posed: a sketch and its points, an axis through
//   a sketch point, a plane feature, a base plane or axis. They are where the model has them,
//   also for a sketch that stands on a face of a body that moved. A mechanism that needs
//   a point or an axis that moves with a link takes it from a face or an edge of a body, or
//   package 5a adds a reference of its own.
// - An export is the opposite of a query: its context always has the bodies as modelled (a robot
//   description writes the joints, not one pose of them).
export interface QueryContext {
  // The document and the evaluation as modelled, without the geometry of bodies.
  state: { document: DocumentAfter; evaluation: Omit<EvaluationAfter, 'bodies' | 'faceSurfaces'> };
  bodies: Readonly<Record<Id, BodyResultAfter>>;
  surface(body: Id, face: FaceNameAfter): Surface | undefined; // undefined: the body has no such face
  // Directed: for a face the normal points out of the body. The problem is the code the recompute
  // gives for the same reference, so `run` can tell "not in this state" from "not a plane".
  frame(ref: PlaneRefAfter): Frame | RefProblem;
  axis(ref: AxisRef): { origin: Vec3; direction: Vec3 } | RefProblem;
  // The number of a named face: the index into `faceNames`, and `id` of a face of a body.
  face(name: FaceNameAfter): number | undefined;
  // What the recompute kept about a sketch (solver input with the positions used, how the solve
  // ended, the analysis of freedom). Undefined: the sketch did not evaluate. `SketchState` stays
  // internal to the engine: query modules are engine modules, and no caller of the engine sees
  // a context.
  sketch(sketch: Id): SketchState | undefined;
  // An exception of the kernel inside a query becomes the answer `failed` (the port says that
  // `boolean` throws when the result is not a closed body).
  kernel: SolidKernel;
  // Results kept for as long as all `owners` live: the same question about the same things is
  // not computed twice.
  // - Name every object the answer depends on: both solids for a pair of bodies (as the cache of
  //   `interference` does today), the object of a section of the document for an answer that
  //   reads it. A body ID in `key` is not enough: the body behind an ID changes.
  // - Owners that live across recomputes: a `Solid`, a solved sketch, the document, a section or
  //   a feature of it. The state, its evaluation and the map of bodies are new objects on every
  //   recompute and never hit.
  // - At least one owner; their order does not matter. Keys of different queries do not meet:
  //   the engine keeps them apart.
  memo<T>(owners: readonly [object, ...object[]], key: string, compute: () => T): T;
}
export interface RefProblem {
  problem: 'brokenReference' | 'nonPlanarFace';
}

// `Result` is plain JSON (numbers, texts, lists, objects): it goes through the tool `query`, the
// bridge to the app and the generic form as it is. A query that has bytes is an export.
export interface QuerySpec<S, Result> {
  title: string;
  summary: string; // what it is for; goes to the description for the AI
  returns: string; // what the answer holds and in which units; goes there as well
  args: S;
  // Keys of the result, at any depth, whose numbers a tool prints rounded to that many
  // significant digits instead of six decimal places: values that are small on purpose, such as
  // a volume compared with a small threshold. `check_interference` prints the volume of
  // a collision to six and its depth to four today.
  significant?: { readonly [key: string]: number };
  // A property, not a method, so that its parameter is checked strictly against the map below.
  // A query that builds on another calls its `run` with the same context.
  run: (context: QueryContext, args: RunArgsOf<S>) => Result;
}

// The descriptions of the arguments of the queries of this step, written as a package writes its
// own: a value, and its type in the map.
export const INTERFERENCE_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', summary: 'Without it all bodies.', optional: true },
  threshold: { kind: 'number', title: 'Threshold', optional: true, spec: { title: 'Smallest shared volume that counts', unit: 'mm3', min: { value: 0 }, default: 0.001 } },
} as const satisfies ArgSpecs;
export const SKETCH_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' } } as const satisfies ArgSpecs;
export const CONSTRAINT_ARGS = { sketch: { kind: 'sketch', title: 'Sketch' }, constraint: { kind: 'constraint', of: 'sketch', title: 'Constraint' } } as const satisfies ArgSpecs;
export const BODY_ARGS = { body: { kind: 'body', title: 'Body' } } as const satisfies ArgSpecs;
export const CATALOG_ARGS = { name: { kind: 'text', title: 'Catalog' }, key: { kind: 'text', title: 'Row', summary: 'Without it all rows.', optional: true } } as const satisfies ArgSpecs;

// The description of the arguments and the result of every query, by name. A query module adds
// its line by declaration merging, so adding a query does not edit a shared type:
//   declare module '.../00-prep/contract' { interface Queries { gap: { spec: typeof gapArgs; result: GapResult } } }
export interface Queries {
  interference: { spec: typeof INTERFERENCE_ARGS; result: InterferenceReport };
  sketchDiagnosis: { spec: typeof SKETCH_ARGS; result: SketchDiagnosis };
  constraintExplanation: { spec: typeof CONSTRAINT_ARGS; result: ConstraintExplanation };
  body: { spec: typeof BODY_ARGS; result: BodyDescription };
  catalog: { spec: typeof CATALOG_ARGS; result: CatalogTable };
}
// A description in one of the maps that is not a valid `ArgSpecs` (a kind that does not exist)
// stops the type check here; the message lists the names. The registries themselves are not
// constrained this way: with a constraint on their entries the engine could not call `run` of
// an entry picked by name without a cast.
type InvalidSpecs = { [N in keyof Queries]: Queries[N]['spec'] extends ArgSpecs ? never : N }[keyof Queries] | { [F in keyof ExportFormats]: ExportFormats[F] extends ArgSpecs ? never : F }[keyof ExportFormats] | { [O in keyof HostOperations]: HostOperations[O] extends ArgSpecs ? never : O }[keyof HostOperations];
export const SPECS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [N in InvalidSpecs]: 'is not a valid description' } = true;
export type QueryName = keyof Queries;
export type QueryArgs<N extends QueryName> = ArgsOf<Queries[N]['spec']>;
export type QueryResult<N extends QueryName> = Queries[N]['result'];

// The catalog itself: an object with one entry per name, like `CONSTRAINTS` and `GENERATORS`.
// An entry is typed by the map. A test checks what the types let through:
// - every description is a valid `ArgSpecs`, and `of` of a constraint names a required argument
//   of the kind `sketch` next to it;
// - the names of the arguments of an entry and which of them are optional are those of a typed
//   fixture of the query. (A description handed over in a variable may carry an argument the map
//   does not have, or mark a required one optional, and still compile.)
export declare const QUERIES: { [N in QueryName]: QuerySpec<Queries[N]['spec'], QueryResult<N>> };

// ---------------------------------------------------------------- the answer

// A query does not throw for anything its caller can cause; it answers with a result or with
// a reason, like a command.
// - Before `run`, the engine checks every argument against its description and fills in the
//   defaults. An error from here names the argument by its path, a list of names and indexes
//   (`['orientations', 1, 'by', 'onBed']`; a key of a record is one segment, whatever it holds).
//   - `invalidArguments`: the shape or the range is wrong, or the query has no such argument.
//   - `notAvailable`: something named is not in the state asked about. One rule for every ID,
//     wherever it sits (an argument, an entity, a plane, an axis): a body, a face, an edge is
//     looked up in the bodies of the state; a feature, a sketch, a constraint, a sketch point
//     among the features the state evaluated. That is the document up to `at`, and the same for
//     a previewed state that was evaluated up to a feature: its document holds the later
//     features too, its evaluation does not. A mistyped ID and one that comes later are the same
//     answer.
//   - A sketch that did not evaluate is in the document, so it is a valid argument, and so is
//     a point of it; `context.sketch` then returns undefined.
// - `run` throws `QueryFailure` for what only the computation finds out, with the path of the
//   argument when there is one: a face that is not planar where a plane is asked for
//   (`context.frame` says which), a body that is empty, a limit.
// - An exception of another kind inside `run` is a defect and passes through, as it does for
//   commands (`invalid` in engine.ts).
// What was a successful answer stays one: a sketch that did not evaluate has the diagnosis
// `status: 'unavailable'`, a list of fewer than two bodies has no collisions (`checked: 0`).
export type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | {
      ok: false;
      error: {
        // invalidArguments: an argument fails its description; `state` is not a state of this engine
        // notAvailable: something named is not in the state asked about; `at` names no feature
        // failed: the computation gave up (the kernel, a limit)
        code: 'invalidArguments' | 'notAvailable' | 'failed';
        message: string;
        arg?: ArgPath; // the argument concerned; `['at']` and `['state']` for the options
      };
    };
export type ArgPath = readonly (string | number)[];
export declare class QueryFailure extends Error {
  constructor(code: 'notAvailable' | 'failed', message: string, arg?: ArgPath);
}

// An answer that can be large says so. A query with such an answer has an argument that limits
// it and returns how much there was; it never returns an unbounded list. The engine is
// synchronous and has no cancellation: a query that can be slow bounds its work by its
// arguments and says so in its summary.
export interface Truncated {
  truncated?: { shown: number; total: number };
}

// ---------------------------------------------------------------- the engine

// The state a query answers for: the current one, the one after a feature, or one that `preview`
// of this engine returned. With a previewed state nothing is written, so a parameter can be
// stepped and each step asked about (the pose sweep of step 5).
// A state this engine did not hand out (one put together by a caller, one of another engine) is
// refused with `invalidArguments`. The engine takes the document it kept with the evaluation,
// not `state.document`, so an evaluation cannot be paired with another document.
export type QueryOptions = { at?: Id; state?: never } | { state: StateAfter; at?: never };

// `query` and `export` are added. The four methods they cover (`diagnoseSketch`,
// `explainConstraint`, `interference`, `exportMesh`) stay as they are: each keeps its own checks
// of its arguments and its own texts (tests match them, Czech ones included), throws as D35
// decided and as about two hundred calls in the tests expect, and then calls `run` of the same
// entry that `query` calls. The computation is shared; the messages are not. No further method
// of this kind is added to `Engine`.
export interface EngineAfter extends Omit<Engine, 'getState' | 'execute' | 'preview' | 'load' | 'subscribe'> {
  // As today, with the surfaces in the evaluation and with what the packages add to the unions.
  getState(at?: Id): StateAfter;
  execute(cmd: CommandAfter): CommandResultAfter;
  preview(cmd: CommandAfter, at?: Id): CommandResultAfter;
  load(json: string): CommandResultAfter;
  subscribe(listener: (state: StateAfter) => void): () => void;
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}

// ---------------------------------------------------------------- description of a body

// What `get_body` computes in packages/mcp/src/tools.ts today (`bodyDetail`, `edgeShape`), moved
// into the engine as it is, so that the app and other queries can use it.
// - `meshNormal` is what `get_body` prints as the normal of a planar face: the sum of the
//   normals of its triangles, weighted by area.
// - The centre and the radius of a circular edge stay fitted to its vertices and may be missing.
//   Reading them from the surfaces instead is a change of numbers and belongs to package 1b.
// - New here are `surface` and `convex`. `convex` is one more pass over the triangles of the
//   face (the normals of a full cylinder sum to zero, so the sum does not tell).
export interface BodyFace {
  name: FaceNameAfter;
  surface: Surface;
  area: number; // mm2
  meshNormal?: Vec3; // planar faces: unit, pointing out of the body
  convex?: boolean; // cylinder and cone: true when the material is on the side of the axis (a pin), false for a hole
}
export type BodyEdge = { name: EdgeNameAfter; length: number; segments: number } & (
  | { kind: 'line'; from: Vec3; to: Vec3; gaps: boolean } // gaps: a cut interrupts the edge
  | { kind: 'circle'; circle?: { center: Vec3; radius: number } }
  | { kind: 'coplanar' | 'other' }
);
export interface BodyDescription {
  body: Id;
  volume: number; // mm3
  bounds: { min: Vec3; max: Vec3 };
  faces: BodyFace[];
  edges: BodyEdge[];
}

// ================================================================ export

// `Engine.exportMesh(format, bodies): Uint8Array` returns one file. A robot description is
// several files in folders, and an outline is not a mesh. A format becomes an entry of
// a registry and returns files.
export interface ExportFile {
  // Relative, with forward slashes: `meshes/arm.stl`. The engine guarantees the form, and the
  // writer checks it again: every segment is non-empty, is not `.` or `..` and has no backslash,
  // and no path is a folder of another. What depends on the disk is the writer's to refuse, as
  // today: a segment longer than 255 bytes, and two names in one folder that differ only in the
  // case of letters. With the layout `file` the path is only a suggested name; the caller's
  // path names the file.
  path: string;
  mediaType: string;
  bytes: Uint8Array;
  about?: Record<string, unknown>; // what the file holds, for the answer of a tool (STL: `bodies`, `triangles`)
}
// `file`: one file; the caller's path names the file. `directory`: the caller's path names
// a folder and `path` of each file is relative to it.
export interface Exported {
  layout: 'file' | 'directory';
  files: ExportFile[];
}
export interface ExportFormatSpec<S> {
  title: string;
  summary: string;
  options: S;
  // The context of a format has the bodies as modelled, whatever pose was asked about last.
  // No body to export is not an error of a format: STL of an empty list is a file without
  // triangles, as `exportMesh` gives today. The tools refuse it, as `export_stl` does.
  run: (context: QueryContext, options: RunArgsOf<S>) => Exported;
}
// The options of every format by name; 3MF, DXF, SVG, URDF and MJCF are added by their packages
// by declaration merging.
export interface ExportFormats {
  stl: {
    bodies: { kind: 'list'; of: { kind: 'body' }; title: string; optional: true };
    perBody: { kind: 'flag'; title: string; optional: true }; // layout `directory`, a file per body
  };
}
export type ExportFormat = keyof ExportFormats;
export type ExportOptions<F extends ExportFormat> = ArgsOf<ExportFormats[F]>;
export declare const EXPORT_FORMATS: { [F in ExportFormat]: ExportFormatSpec<ExportFormats[F]> };

// ================================================================ MCP and the app as hosts

// ---------------------------------------------------------------- the query tool

// One general tool `query` reaches every entry of the catalog, the way `execute` reaches every
// command and `sketch_tool` every sketch tool (D33: few general tools, not a tool per
// operation). Its description lists the queries from the catalog.
// - `at`: the state after this feature.
// - `after`: the state the document would have after this command. The preview and the query run
//   together where the engine is (in the app when one is connected); nothing is written. This is
//   how an AI steps a parameter or a pose and asks at each step, for every query, the existing
//   ones included.
// - Both: `engine.preview(after, at)`, the previewed document evaluated up to `at`, and the query
//   over that state. A command that does not apply answers with the error of the preview.
// - The answer is the result with numbers rounded to six decimal places, as the tools round
//   geometry today, and the keys an entry lists in `significant` to the significant digits it
//   gives; or the text of the error.
//
// No existing tool changes its name, its schema or its answers.
// - `check_interference`, `get_sketch`, `explain_constraint` and `export_stl` keep calling the
//   four methods of `Engine`, with their own checks and texts. The guard over the methods of
//   `Engine` (packages/mcp/test/coverage.test.ts) records which method a tool calls, and those
//   rows stay true.
// - `get_body` had no method of the engine to call. It keeps its own check that the body exists
//   and its text (a test matches it), reads the state as today, and takes the faces and edges
//   from `query('body')`.
// What does change in the tests is the guards:
// - the exact list of tools in packages/mcp/test/tools.test.ts gets `query`, the one in
//   server.test.ts gets `query` and `export` (`export` writes files, so it is a tool of the
//   server like `export_stl`);
// - the table of coverage gets rows for `query` (reached by `query` and by `get_body`) and for
//   `export`.
// `QUERIES` is exported from the index of the engine: the tool and the app's form read it.
export interface QueryToolInput {
  query: QueryName;
  args?: Record<string, unknown>; // checked by the engine against the description of the query
  at?: Id;
  after?: CommandAfter;
}
export declare const QUERY_TOOL: { name: 'query' };

// ---------------------------------------------------------------- what a tool may answer

// Today a tool returns JSON and the server prints it as text; a `Uint8Array` does not survive
// (`callTool` passes the result through JSON, and so does the bridge to the app). STL has its own
// base64 envelope in a hidden tool. That envelope becomes the general one. `ToolOutcome.result`
// stays JSON: a `ToolAnswer` is JSON. A tool says in its definition that it answers with one,
// and only then does the server act on `kind`; it does not guess from the shape of a result.
export interface FileEnvelope {
  path: string; // as in ExportFile
  mediaType: string;
  base64: string;
  about?: Record<string, unknown>;
}
export type ToolAnswer =
  | { kind: 'data'; data: unknown } // printed as text, as today
  | { kind: 'files'; layout: Exported['layout']; files: FileEnvelope[] } // the server writes them where the caller said
  | { kind: 'image'; mediaType: 'image/png'; base64: string }; // returned to the client as image content

// One export tool; `options` are checked against the description of the chosen format, and `at`
// and `after` mean what they mean for `query`. The server writes the files with the guarantees
// `export_stl` has today for a file per body (nothing is written unless every file can be, no
// file is replaced without `overwrite`, names that differ only in case are refused).
// `export_stl` stays as it is and uses the same writer.
//
// The writer of today knows only files directly in the target folder. For paths with folders it
// also creates the folders in its staging directory and in the target, refuses a path whose
// folder exists as something else than a folder, and on a failure removes the folders it
// created. That is work of the package that adds the first format with folders (5b), stated here
// so that `ExportFile.path` does not promise what the writer cannot do.
export interface ExportToolInput {
  format: ExportFormat;
  path: string; // a file for the layout `file`, a folder for `directory`
  options?: Record<string, unknown>;
  overwrite?: boolean;
  at?: Id;
  after?: CommandAfter;
}
export declare const EXPORT_TOOL: { name: 'export' };

// ---------------------------------------------------------------- operations of the app

// Something only a running app can do, such as a picture of the viewport. It is not a query: the
// engine has no renderer, and it is asynchronous. It is an operation of the host, described like
// a query and offered as a tool of its own; over a document from a file it answers
// `notAvailable`. (A tool per operation, unlike the queries: one operation is planned, 1f. If
// they multiply they get one general tool like `query`.)
// - The operations are a registry in the module the server and the app share (packages/mcp),
//   by tool name; a package adds one by declaration merging and one entry. The description for
//   the AI and a guard like the one for queries read the registry.
// - `Tool.run(engine, args)`, `callTool(engine, ...)` and `connectBridge(engine, ...)` stay as
//   they are and stay synchronous; the tests call them so. An operation of the host goes through
//   an entry of its own next to them, which takes the host and is awaited (the bridge and the
//   server await already).
// - An exception inside an operation or a query is reported over the bridge as a failed
//   question, not with today's text for commands ("the change may have been made").
export interface AppHost {}
export interface HostOperation<S> {
  title: string;
  summary: string;
  returns: string;
  args: S;
  run: (host: AppHost & { engine: EngineAfter }, args: RunArgsOf<S>) => Promise<QueryOutcome<ToolAnswer>>;
}
export interface HostOperations {}
export declare const HOST_OPERATIONS: { [N in keyof HostOperations]: HostOperation<HostOperations[N]> };

// Data going the other way (a mesh to import) does not fit into a tool call. A tool takes a path
// and the server reads the file; how the content reaches the engine of a connected app is
// designed by package 3b.

// ---------------------------------------------------------------- description for the AI

// `describe_api` cuts its types out of the raw text of types.ts, so types in query modules do
// not reach it by themselves. It gets four generated sections instead, like the one for
// constraints: the queries (name, summary, each argument from its description, `returns`), the
// operations of the app, the catalogs (name and summary) and the export formats (name, summary,
// options).
export declare function describedQueries(): { name: QueryName; summary: string; args: string[]; returns: string }[];
