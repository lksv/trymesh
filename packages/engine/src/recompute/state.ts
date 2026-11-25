// The state of the recompute between features and the types a step of a feature works with.
import type { SketchAnalysis } from '../analysis';
import type { OutlineCurve, Profile, Region, SketchCurve, SketchGeometry } from '../sketch';
import type { FaceInfo, RigidTransform } from '../solid';
import type { CheckResult, CopyTag, Document, ExpressionError, FaceName, Facts, Feature, FeatureResult, FieldPath, Frame, Id, Issue, IssueCode, Point2, SketchFeature, SketchSolver, Solid, SolidKernel, SolveInput, SolveResult, StoredDocument, Vec2 } from '../types';

export interface Deps {
  solver: SketchSolver;
  kernel: SolidKernel;
}
export interface DragTarget {
  sketch: Id;
  point: Id;
  target: Point2;
}

// The state of the model after a feature. Immutable; it shares unchanged parts with the previous state.
export interface State {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, Solid>;
  faceNames: FaceName[]; // a shared table, index = the number of the face
  faceInfos: FaceInfo[];
  faceIds: Map<string, number>; // the name of a face → its number
  planes: Record<Id, Frame>; // evaluated own planes
  sketches: Record<Id, SketchState>;
  tools: Record<Id, ToolRecipe>; // recipes of the tools of extrusions with the operation add and cut
  // The chord tolerance of the document (D58), for the analysis of a body: of two circles two
  // surfaces meet in, the points of an edge choose within a reach that grows with it. Set where the
  // evaluator builds the state before the first feature; a change of the setting recomputes all.
  chordTolerance: number;
  // The insertions so far (D62), by the ID of the feature: the entry of the section `documents` it
  // inserted, the environment of its parameters and its recompute. A later insertion of the same
  // entry object with the same environment takes this recompute instead of asking the evaluator,
  // so the two are made from the same solids whatever the memo of the evaluator kept.
  insertions: Record<Id, InsertionRecord>;
  // Per body an insertion brought: what it inherits from its document. A pattern of an inserted
  // body adds nothing (its copies inherit through their source). The body properties read it
  // after the timeline.
  inserted: Record<Id, InsertedBody>;
}

// What an inserted body passes on to the body properties here (D62): what its chain in the inserted
// document states, before the use is applied (an auxiliary body there has no mass in its result,
// but a stated pair passes on): the first colour, material and use along its chain there, and the
// pair that chain uses with the numbers its expressions gave there (with the values of the
// insertion) and their errors. Names are not passed on: they are read from the documents.
export interface InheritedProperties {
  color?: string;
  material?: string;
  use?: 'part' | 'reference' | 'auxiliary';
  pair?: { density?: number; mass?: number; errors?: { density?: ExpressionError; mass?: ExpressionError } };
}
// The recompute of a stored document (D62): the state at the end of its timeline, the results of
// its checks, and what each of its bodies passes on.
export interface InsertedRecompute {
  state: State;
  checks: Record<string, CheckResult>;
  inherited: Record<Id, InheritedProperties>;
}
export interface InsertionRecord {
  stored: StoredDocument;
  environment: string; // what the parameters of the stored document evaluate to, as text without loss
  recompute: InsertedRecompute;
}
export interface InsertedBody {
  feature: Id; // the insertion
  document: Id; // the key of the stored document
  body: Id; // the ID of the body there
  inherited: InheritedProperties;
}

// The recipe of a tool: how to build the mesh of the tool and its faces from the evaluated profile
// and extent. It is stored in the state so that a later feature (a pattern) can build the same tool
// again; a finished mesh is not enough, because the numbers of the faces and the position of the
// tool differ when it is repeated. The recipe stays even when the extrusion itself ended with the
// warning "no effect".
export interface ToolRecipe {
  operation: 'add' | 'cut';
  targets: Id[];
  // `targets`: the bodies the tool is about to be applied to, in the state it is applied in. An
  // extent that depends on them ("through all") is measured here, every time the tool is built.
  // `placement`: where a copy made by a pattern stands and how its faces are tagged. The tool is
  // built there, not moved afterwards, so that what depends on the targets is measured in the
  // direction the copy points in. A build places every vertex by the frame it is given and winds
  // its triangles as for a right-handed frame, without looking at the handedness; the frame of
  // a mirrored copy is left-handed, and `applyTool` turns such a tool over (D53).
  build(targets: Solid[], firstFaceId: number, placement?: Placement): BuiltTool;
}
// What a tool build returns, whatever the tool is (recompute/tool-*.ts).
// `refuseChange`: the tool must not change a target (D46: a hole whose head is as deep as the
// targets reach, which only a tool that misses them may be). `applyTool` applies it like any tool
// and then reads the mark: every target unchanged is the usual `noEffect`; a target changed is the
// error with this code and detail, and no body is changed.
export interface BuiltTool {
  solid: Solid;
  faces: { name: FaceName; info: FaceInfo }[]; // new faces; the number of a face = firstFaceId + index
  refuseChange?: { code: IssueCode; detail: string };
}
export interface Placement {
  transform: RigidTransform;
  copy: CopyTag;
}

// The part of the state a tool changes: bodies and the face table.
export type Model = Pick<State, 'bodies' | 'faceNames' | 'faceInfos' | 'faceIds'>;
// The model after a tool was applied and the targets it did not change, or why it could not be applied.
export type Applied = { ok: true; model: Model; unchanged: Id[] } | { ok: false; code: IssueCode; refs?: unknown[]; detail?: string };
// A tool build that fails with a code of its own (a copy of a pattern that cannot reach the plane
// of an extent `upTo`, D47). The two places that call `build` (`applyTool`, and the step of an
// extrusion with the operation `new`) turn it into the error of the feature with that code; every
// other exception of a build is `kernelFailure`.
export class ToolProblem extends Error {
  constructor(
    readonly code: IssueCode,
    readonly refs?: unknown[],
    readonly detail?: string,
  ) {
    super(detail ?? code);
  }
}

// A curve of a sketch that a side face is made from. `general`: a side of a generated profile.
export type SideCurve = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'round'; center: Vec2; radius: number } | { type: 'general' };

// The exact outline of a profile: closed loops of curves with the material on their left, an outer
// loop and its holes per region (recompute/outline.ts).
export interface Outline {
  regions: { outer: OutlineCurve[]; holes: OutlineCurve[][] }[];
}
// Why a profile could not be resolved. A generator, an offset and a wall explain their failure
// themselves (`message`); the general text of the code is about sketch curves.
export type ProfileProblem = { code: IssueCode; refs: unknown[]; message?: string };
// The name of a face without what the tool build adds (the feature, the tag of a copy).
export type FaceRole = FaceName extends infer Name ? (Name extends FaceName ? Omit<Name, 'feature' | 'copy'> : never) : never;

// The evaluated profile of an extrusion: regions in the plane of the sketch and a description of
// the curves the side faces are made from.
// - `sideOf`: the side face an edge of a loop belongs to, by what `Loop.curves` holds for the edge.
//   For regions that is the curve ID and the name is `{ role: 'side', curve }`; a wall names its
//   sides itself.
// - `outline`: the exact outline the regions were divided from, after an offset. Asked for by
//   a tool build that has to move it again. A generated profile has none.
// - `curveOf`: the sketch curve a key of the outline stands for, in the texts and references of
//   a refusal of such a move; absent when the keys are the curves (a wall has keys of its own).
// A generated profile adds what its generator published and warned about.
export interface ResolvedProfile {
  regions: Region[];
  frame: Frame;
  sideOf: (key: string) => { name: FaceRole; shape: SideCurve };
  outline?: () => Outline | ProfileProblem;
  curveOf?: (key: string) => Id;
  facts?: Facts;
  warnings?: Issue[];
}

// `input`: the input of the solver with the positions used; `solve`: how solving turned out;
// `analysis`: the analysis of how determined it is (only for a solved sketch). The diagnosis of a
// sketch comes from them.
export interface SketchState {
  feature: SketchFeature;
  frame: Frame;
  geometry: SketchGeometry; // every used position: own, the origin, the entries of `external`
  // Every curve of the sketch (own and of the entries, D64): what the profile, the sides, the wall,
  // an axis on a line and the circle of a generator read, not the input of the solver.
  curves: ReadonlyMap<Id, SketchCurve>;
  joins: (id: Id) => Id; // the vertex of a point (`joinsOf`)
  profile: Profile;
  input: SolveInput;
  solve: { status: SolveResult['status']; conflicting: Id[] };
  analysis?: SketchAnalysis;
}

// A sketch solved during the recompute: solved variables and the stamp to write back to the document.
export type SolvedSketch = Pick<SketchFeature, 'points' | 'radii' | 'solved'>;
// What the recompute writes back to the document: the feature with expression values substituted
// into its fields and, for a sketch, the solved variables.
export interface WriteBack {
  feature: Feature;
  solved?: SolvedSketch;
}

export interface Step {
  state: State;
  writeBack?: SolvedSketch;
}

// `bodies` of a result may be left out: most steps create none.
export type Done = (result: Omit<FeatureResult, 'bodies'> & { bodies?: Id[] }, change?: Partial<State>) => State;
export type Failed = (code: IssueCode, refs?: unknown[], detail?: string) => Step;

// What the step of a feature gets besides the feature itself.
export interface StepContext {
  state: State; // before the feature
  settings: Document['settings'];
  deps: Deps;
  // The state after the feature with its result (`done`), or with its error and nothing else changed (`failed`).
  done: Done;
  failed: Failed;
  drag?: DragTarget; // read by the sketch only
  badFields: FieldPath[]; // fields whose expression failed; read by a type that keeps the last valid values
  input?: object; // what `input` of the module answered for the document (D55); read by the mesh feature and the insertion
  // The recompute of another document (D62) by the same evaluator (its memo, its adapters); `doc`
  // is passed with the settings of this one already. Nothing it computes is written back.
  insertion(doc: Document): InsertedRecompute;
}
