// Contract of package 3c of D36 (decision D62): inserting another document as a part. A draft, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine of
// master and the draft of 3b, which it builds on (the placement, `input` of a feature module), and
// states what the package adds or changes. The design is design.md; the scenario written as calls
// is calls.ts.
//
// Where the types will live: what a caller of the engine or an AI reads goes to `types.ts`, into
// the parts `describe_api` prints: the section, the stored document, the feature and the rule of
// the names of inserted faces before the marker `// --- porty`; the result, the warning, the
// commands and the patch after the marker `// --- přepočet`.
//
// In the code the feature is a member of `Feature`, the commands members of `Command`, the warning
// a member of `WarningCode`. The draft cannot add to those unions, so it states each of them as it
// is after the package (`FeatureAfter3c`, …), on top of the same after 3b.

import type { BodyPropertiesResult, Engine, ExportFormat, ExportOptions, Exported, FeatureBase, FeatureResult, Issue, IssueCode, FieldSpec, Id, Input, NumberSpec, Parameter, Patch, QueryArgs, QueryName, QueryOutcome, QueryResult, UpgradeStep, Vec3, WarningCode } from '../../../packages/engine/src/index';
import type { State } from '../../../packages/engine/src/recompute/state';
import type { BodyPlacement, CommandAfter3b, DocumentAfter3b, EvaluationAfter3b, FaceNameAfter3b, FeatureAfter3b, MeshPatch } from '../3b-mesh-import/contract';
import { PLACEMENT_FIELDS } from '../3b-mesh-import/contract';

// ================================================================ the stored document

// A document kept inside another one, to be inserted as a part (a bearing, a motor, a bracket made
// elsewhere). `document` is a whole document: its timeline, parameters, checks and every section,
// stored documents of its own included.
// - It is a copy. The file it came from may change afterwards; the copy changes only by the command
//   `replaceDocument`. `name` is for people: usually the name of the file (the rules of a body name).
// - It is validated as a document is on a load (`validateDocument`): an older one is brought to the
//   schema of this build from its own `schemaVersion` by the same upgrade steps, and the stored copy
//   is the upgraded one. So every later upgrade step reaches a stored document without a word.
// - At most `MAX_INSERT_DEPTH` levels of documents inside documents (a guard against a stack
//   overflow from a file written by hand; a cycle cannot be written, a copy cannot hold itself).
// - Strict: `name` and `document`, nothing else, on a command and on a load.
export interface StoredDocument {
  name?: string;
  document: DocumentAfter3c;
}
export const MAX_INSERT_DEPTH = 8;

// The section: stored documents by ID. Always present, `{}` when there is none. The IDs are a
// namespace of their own (the document `bearing` may be inserted by the feature `bearing`). An
// entry no feature inserts is kept and does nothing (`usedBy` is empty).
export type Documents = Record<Id, StoredDocument>;

// What the description for the AI and the forms read about the section (`SECTION_INFO.documents`).
export const DOCUMENTS_INFO = {
  title: 'Stored documents',
  summary:
    'Other documents kept inside this one, to be inserted as parts (the tool insert_document, or "Insert a document" in the app). A feature of the type `insert` places one; the same document may be inserted several times, each time with parameters of its own. ' +
    'A stored document is a copy: it changes only by replaceDocument. `removeDocument` is refused while a feature inserts it.',
  commands: ['addDocument', 'replaceDocument', 'removeDocument'],
  fields: [],
} as const;

// ================================================================ the feature

// Another document inserted as a part: the bodies at the end of its timeline, recomputed from its
// features with the parameters this feature sets, placed as one rigid piece.
// - `document`: a key of the section `documents`. A command that sets it checks that the section
//   has it (`addFeature`; `updateFeature` only when it is another one than before); a load checks its
//   form only, and a document that is not there is the error `brokenReference` with
//   `refs: [{ document: <id> }]`.
// - `placement`: where the origin and the axes of the inserted document stand (the placement of 3b:
//   a frame, three offsets, three turns; numeric fields `placement/x` … `placement/rz`).
// - `parameters`: values for parameters of the inserted document by their names, each a numeric
//   field `parameters/<name>` (unit none) that takes an expression over the parameters of this
//   document. The value replaces the expression of that parameter in the inserted document for this
//   insertion only; what depends on it there follows. A command that names a parameter the stored
//   document does not have is invalid; a stored document replaced since is the error
//   `brokenReference` with `refs: [{ parameter: <name> }]`. Optional; `null` in a patch removes one.
// - `bodies`: which bodies of the inserted document come in, by their IDs there; without it every
//   body at the end of its timeline, in its order. A listed body the inserted document does not have
//   (in this recompute, with these parameters) is the error `brokenReference` with
//   `refs: [{ body: <id there> }]`. Optional; `null` in a patch removes the list.
// - The bodies are `<feature>/<body there>`: `bearing/ring`, `kit/screws/2`, `kit/b/ring` for a body
//   of a document inserted into the inserted one. No body has the ID of the feature alone.
// - Every face keeps its name with the IDs of the features and the patterns of the inserted
//   document prefixed by `<feature>/` (see `insertedFaceName`), so a sketch, a plane, a placement or
//   an extent may stand on a planar face of an inserted body, an edge of one may be projected, and
//   `measure` takes them, as for any body. Its exact surface comes along.
// - The body properties of an inserted body are those of the inserted document (resolved there,
//   with the parameters of this insertion) unless an entry of this document states them; see
//   `BodyPropertiesResultAfter3c`.
// - Features of this document may change an inserted body like any body (a hole into an inserted
//   bracket); a body with a face of an imported mesh (3b) stays `importedTarget`.
// - The entry of the registry: `createsBody` answers for every local name that is the form of a body
//   ID (or for the listed ones only, with `bodies`); `namesFaces` is true; `producesTool` false;
//   `bodySource` none (what an inserted body inherits comes from the inserted document, not from a
//   body of this one); `refs` those of the frame and the document (the kind `document`); `input` the
//   entry of the section; `patch.fields` are `document`, `placement`, `parameters`, `bodies`, and
//   `patch.removable` answers for the six numbers of the placement, every `parameters/<name>` and
//   `bodies`.
// - `facts` of the result: `origin`, `axisX`, `axisY`, `axisZ` (as for a mesh feature of 3b).
// - Errors: `brokenReference` (the document, a parameter, a listed body; the frame), `nonPlanarFace`
//   (the frame), `invalidExpression` (a field), `emptyResult` (the inserted document has no body to
//   bring). Warning: `insertedIssues`.
export interface InsertFeature extends FeatureBase {
  type: 'insert';
  document: Id;
  placement: BodyPlacement;
  parameters?: Record<string, number>;
  bodies?: Id[];
}
export type InsertPatch = Patch<Pick<InsertFeature, 'document' | 'placement' | 'parameters' | 'bodies'>>;

// The numeric fields of the type: the placement of 3b and one per parameter that is set (the
// address with `*` in place of the name, as the catalog writes a field under an ID).
const PARAMETER_VALUE: NumberSpec = { title: 'Value of a parameter of the inserted document', unit: 'none' };
export const INSERT_FIELDS = [...PLACEMENT_FIELDS, { path: 'parameters/*', spec: PARAMETER_VALUE }] as const satisfies readonly FieldSpec[];

export const INSERT_TEXTS = {
  title: 'Inserted document',
  summary:
    'Another document (a stored document of the section `documents`) inserted as a part: the bodies at the end of its timeline, recomputed from its features, placed by `placement` (a frame: a base plane, a plane feature, a planar face, or a sketch point; turns rx, ry, rz about the X axis, the Y axis and the normal of the frame, then offsets x, y, z in it). ' +
    '`parameters` sets parameters of the inserted document for this insertion (a value or an expression over the parameters of this document); `bodies` chooses which of its bodies come in (all without it). A body is `<feature>/<its ID there>`; its faces keep their names with the feature IDs prefixed `<feature>/`, so sketches, planes and projections may use them. ' +
    'Its body properties (name, colour, material, use, density or mass) come from the inserted document unless this document sets them for the body.',
} as const;

// ================================================================ names inside an insertion

// The name of a face of an inserted body: the name it has in the inserted document with every ID of
// a feature in it prefixed: `feature`, and `pattern` of every copy tag. The fields of the role (a
// curve, a point) stay as they are, being IDs inside that feature. The copy tags of patterns of this
// document that copy the body afterwards are appended after them, unprefixed.
//   { feature: 'ring', role: 'side', curve: 'outer' }  in the document `bearing`, inserted by `b1`:
//   { feature: 'b1/ring', role: 'side', curve: 'outer' }
// The key of such a face (`faceKey`) is unambiguous: an insertion names no face under its own ID
// alone, so a key that starts with `b1/` is a face of `b1`, and the tags of the inserted document
// (prefixed) come before those of this one (not).
export declare function insertedFaceName(name: FaceNameAfter3b, insertion: Id): FaceNameAfter3b;

// The feature and the rest of a derived ID: the part before the first slash, as for a body ID
// (`bodyOwner` of sketch-content.ts, which this is). A reference to a face checks the owner: the
// feature of the face (`faceSource`) and the pattern of every copy tag (`pattern`); for a prefixed
// ID the owner is the insertion, of the kind `faceSource` in both places. Nothing inside the inserted
// document is checked by a command: whether the face is there is the recompute's question, as for
// every face.
//   faceRefs({ feature: 'b1/ring', role: 'endCap', copy: [{ pattern: 'b1/p', index: 1 }, { pattern: 'q', index: 2 }] })
//   → [{ id: 'b1', kind: 'faceSource' }, { id: 'b1', kind: 'faceSource' }, { id: 'q', kind: 'pattern' }]

// A feature of the document or of a document it inserts, by its ID as this document names it
// (`b1/ring`, `kit/b/ring`), with the document it is in: the readers that need the feature behind
// a prefixed name (the label of an inserted hole for the parts list, the name of an inserted
// feature in a text of the app). Undefined when an insertion or its stored document is not there.
export declare function insertedFeature(doc: DocumentAfter3c, id: Id): { feature: FeatureAfter3c; document: DocumentAfter3c } | undefined;

// ================================================================ the recompute

// One member is added to what a step gets (`StepContext` in recompute/state.ts), besides `input` of
// 3b: the recompute of another document by the same evaluator (its memo, its adapters). It returns
// the state at the end of that document's timeline and its evaluation (the results of its features
// and checks, its body properties). Nothing it computes is written back: the stored document is
// never changed by a recompute. Its sections keep their results apart from those of this document.
export interface StepContextAddition3c {
  insertion(doc: DocumentAfter3c): { state: State; evaluation: EvaluationAfter3c };
}

// One member is added to the state of the recompute (`State`): what an inserted body inherits, by
// the ID of the body in this document. The step of an insertion sets it for the bodies it brings;
// a pattern of an inserted body does not (its copies inherit from their source, which does). The
// body properties of the section read it after the timeline.
export interface InsertedBody {
  feature: Id; // the insertion
  document: Id; // the key of the stored document
  body: Id; // the ID of the body there
  properties: BodyPropertiesResult; // resolved in the inserted document, with the parameters of the insertion
}
export interface StateAddition3c {
  inserted: Record<Id, InsertedBody>;
}

// One kind is added to the references of a feature (`RefKind` in validation.ts): `document`, a key
// of the section `documents`. `requireRef` checks that the section has the entry; `featureRefs`
// leaves it out (no feature, no order on the timeline); `REF_LABEL` gets "stored document".
export type RefKindAddition3c = 'document';

// The warning of an insertion whose document did not recompute cleanly: `refs` are
// `{ feature: <prefixed ID>, code }` for every feature of it in error, and `{ check: <name> }` for
// every check of it that failed or cannot be evaluated, with the parameters of this insertion.
// The bodies that are there come in.
export type WarningCodeAfter3c = WarningCode | 'insertedIssues';
export interface IssueAfter3c extends Omit<Issue, 'code'> {
  code: IssueCode | 'insertedIssues';
}
export interface FeatureResultAfter3c extends Omit<FeatureResult, 'warnings'> {
  warnings: IssueAfter3c[];
}

// ================================================================ body properties

// What an inserted body inherits (D48 continued): its own entry and the entries of its chain of
// sources in this document come first, as for every body; at the end of the chain, when the body it
// starts at is an inserted body, the properties of that body as the inserted document resolved them
// (`InsertedBody.properties`) take the place of one more entry: colour, material, use, and the
// density and the mass as a pair (a mass the inserted document derived from a density is taken as
// that density, times the volume of the body here). The name is not inherited, as for a copy: an
// inserted body without a name of its own is `<name of the insertion> / <its name there>`.
// `fromDocument` is set when a field of the result comes from the inserted document: the key of the
// stored document. `partName` (the parts list) of an inserted body without a name of its own in this
// document is its part name in the inserted document, so two insertions of one document name one
// part.
export interface BodyPropertiesResultAfter3c extends BodyPropertiesResult {
  fromDocument?: Id;
}

// ================================================================ commands

// - addDocument: stores a document under `id`. `document` is a document as a file holds it, of any
//   version this build reads: it is upgraded and validated in full (an invalid one is an invalid
//   command, with the message of the load). An ID the section already has is an invalid command.
// - replaceDocument: puts another document in the place of a stored one (a new revision of a part),
//   validated the same way; `name` replaces the name, absent keeps it, `null` removes it. Every
//   feature that inserts it is recomputed; a reference to a face the new revision does not have
//   breaks as any reference does, and a parameter or a listed body it does not have is an error of
//   the insertion.
// - removeDocument: refused while a feature of the document inserts it (suppressed or not; the
//   message lists the features).
export type DocumentCommand =
  | { type: 'addDocument'; id: Id; document: unknown; name?: string }
  | { type: 'replaceDocument'; id: Id; document: unknown; name?: string | null }
  | { type: 'removeDocument'; id: Id };

// ================================================================ the result

// What the recompute says about a stored document without recomputing it: `evaluation.documents[id]`.
// - `parameters`: its parameters with their expressions and values (its own, without the values an
//   insertion sets); `undefined` value when the expression does not evaluate there.
// - `features`: the number of features of its timeline; `bodies` is not here, because it takes
//   a recompute: the feature of an insertion lists the bodies it brought (`FeatureResult.bodies`).
// - `usedBy`: the features that insert it, in the order of the timeline, suppressed ones included.
export interface StoredDocumentResult {
  name?: string;
  parameters: { name: string; expr: string; value?: number }[];
  features: number;
  usedBy: Id[];
}

// ================================================================ the schema

// The upgrade step of the section. It reads and changes only `documents`: a document without the
// field gets the empty section; a field that is there is left to the validation. A build without
// the step would drop the section on load without a word. A stored document gets the step like any
// document when it is validated (its own `schemaVersion`).
export const DOCUMENT_INSERT_STEP: UpgradeStep = { name: '3c-document-insert', run: (o) => ('documents' in o ? o : { ...o, documents: {} }) };

// ================================================================ the document and the engine after the package

export type FeatureAfter3c = FeatureAfter3b | InsertFeature;
export interface DocumentAfter3c extends Omit<DocumentAfter3b, 'features'> {
  features: FeatureAfter3c[];
  documents: Documents;
}
export interface EvaluationAfter3c extends Omit<EvaluationAfter3b, 'bodyProperties' | 'features'> {
  features: Record<Id, FeatureResultAfter3c>;
  bodyProperties: Record<Id, BodyPropertiesResultAfter3c>;
  documents: Record<Id, StoredDocumentResult>;
}
export interface EngineStateAfter3c {
  document: DocumentAfter3c;
  evaluation: EvaluationAfter3c;
  canUndo: boolean;
  canRedo: boolean;
}
export type CommandAfter3c =
  | Exclude<CommandAfter3b, { type: 'batch' } | { type: 'addFeature' } | { type: 'updateFeature' }>
  | DocumentCommand
  | { type: 'addFeature'; feature: Input<FeatureAfter3c>; index?: number }
  | { type: 'updateFeature'; id: Id; patch: InsertPatch | MeshPatch | Extract<CommandAfter3b, { type: 'updateFeature' }>['patch'] }
  | { type: 'batch'; commands: CommandAfter3c[] };
export type CommandResultAfter3c = { ok: true; state: EngineStateAfter3c } | { ok: false; error: { code: string; message: string } };
export type QueryOptionsAfter3c = ({ at?: Id; state?: never } | { state: EngineStateAfter3c; at?: never }) & { geometry?: 'modelled' };

// `Engine` of master with the document of this package. No method is added: a stored document
// enters by a command, and what reads a file is the tool of the server and the file input of the app.
export interface EngineAfter3c extends Omit<Engine, 'execute' | 'preview' | 'getState' | 'load' | 'query' | 'export'> {
  execute(cmd: CommandAfter3c): CommandResultAfter3c;
  preview(cmd: CommandAfter3c, at?: Id): CommandResultAfter3c;
  getState(at?: Id): EngineStateAfter3c;
  load(json: string): CommandResultAfter3c;
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptionsAfter3c): QueryOutcome<QueryResult<N>>;
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptionsAfter3c): QueryOutcome<Exported>;
}

// ================================================================ the parts list (3e, changed)

// `partsList` reads the hole features of the inserted documents as well: a face of an inserted hole
// (`holeBore`, `holeHead` with a prefixed feature) is counted under the label of that feature in its
// document (`insertedFeature`), and the row lists it under its prefixed ID (`HoleCount.feature`:
// `clip/insertHole`). Two insertions of one document are two hole features with one label, so one
// row. The rows of bodies need no change: two insertions of one stored document with the same
// parameters are made from the same solids of the inserted document (the evaluator remembers its
// recompute), so their bodies have one origin (`shapeOrigin`), the same inherited properties and one
// part name: one row with a count of two.

// ================================================================ MCP

// The tool `insert_document` of the server (server.ts, next to `open_document`): it reads a file of
// a document (JSON, as the app or save_document writes it) and sends `addDocument`, or
// `replaceDocument` with `replace`, through `execute` to the engine the other tools use (the app's,
// when connected).
// - `id`: the ID of the stored document; without it the name of the file without its extensions,
//   reduced to letters, digits and underscores (`document` when that is no ID by the rule of
//   `newId`), with `_2`, `_3`, … when the section has it (read from `get_model`). With `replace` the
//   ID is required and must be in the section.
// - `name`: the name of the stored document; without it the name of the file.
export interface InsertDocumentArgs {
  path: string;
  id?: Id;
  name?: string;
  replace?: boolean;
}
// The answer: the stored document, its parameters, and the command that inserts it, written out
// for the caller to change and send: `addFeature` of an insertion on the base plane XY. The tool
// previews that command and reports what it would bring: the bodies with the use, the material and
// the mass they inherit, and the warning of the insertion when there is one. `say` tells the caller
// that a body inherited as `part` is printed, and that a bought part is `use: 'reference'` (in the
// inserted document or by setBodyProperties here) with the mass of its data sheet.
export interface InsertDocumentAnswer {
  document: Id;
  file: string;
  parameters: StoredDocumentResult['parameters'];
  bodies: { id: Id; use: BodyPropertiesResult['use']; material?: string; mass?: number }[];
  warning?: string;
  next: { say: string; command: CommandAfter3c };
}

// `get_document` prints a stored document shortened: its name, its parameters, the number of its
// features and of its stored documents, and the size of the full text; `get_document { stored: id }`
// prints that one in full, and `save_document` writes all.
export interface StoredDocumentShown {
  name?: string;
  parameters: Parameter[];
  features: number;
  documents: number;
  omitted: string; // "the timeline and the sections: 7 552 characters; get_document with `stored` prints them"
}

// What `get_model` adds when the section has entries.
export interface StoredDocumentSummary {
  id: Id;
  name?: string;
  parameters: Record<string, number | null>;
  features: number;
  usedBy: Id[];
}

// The facts of an insertion, as for a mesh feature.
export interface InsertFacts {
  origin: Vec3;
  axisX: Vec3;
  axisY: Vec3;
  axisZ: Vec3;
}
