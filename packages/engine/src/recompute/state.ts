// The state of the recompute between features and the types a step of a feature works with.
import type { SketchAnalysis } from '../analysis';
import type { OutlineCurve, Profile, Region, SketchGeometry } from '../sketch';
import type { FaceInfo, RigidTransform } from '../solid';
import type { CopyTag, Document, FaceName, Facts, Feature, FeatureResult, FieldPath, Frame, Id, Issue, IssueCode, Point2, SketchFeature, SketchSolver, Solid, SolidKernel, SolveInput, SolveResult, Vec2 } from '../types';

export interface Deps {
  solver: SketchSolver;
  kernel: SolidKernel;
}
export interface DragTarget {
  sketch: Id;
  point: Id;
  target: Point2;
}

// Stav modelu po feature. Neměnný; nezměněné části sdílí s předchozím stavem.
export interface State {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, Solid>;
  faceNames: FaceName[]; // společná tabulka, index = číslo stěny
  faceInfos: FaceInfo[];
  faceIds: Map<string, number>; // jméno stěny → číslo
  planes: Record<Id, Frame>; // vyhodnocené vlastní roviny
  sketches: Record<Id, SketchState>;
  tools: Record<Id, ToolRecipe>; // recepty nástrojů vysunutí s operací add a cut
  // The chord tolerance of the document (D58), for the analysis of a body: of two circles two
  // surfaces meet in, the points of an edge choose within a reach that grows with it. Set where the
  // evaluator builds the state before the first feature; a change of the setting recomputes all.
  chordTolerance: number;
}

// Recept nástroje: jak z vyhodnoceného profilu a rozsahu postavit síť nástroje a jeho stěny.
// Ukládá se do stavu, aby pozdější feature (pole) mohla tentýž nástroj postavit znovu; hotová síť
// nestačí, protože čísla stěn i poloha nástroje se při opakování liší. Recept zůstává i tehdy, když
// vysunutí samo skončilo varováním „bez účinku".
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
  faces: { name: FaceName; info: FaceInfo }[]; // nové stěny; číslo stěny = firstFaceId + index
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

// Křivka skici, ze které vzniká boční stěna. `general`: a side of a generated profile.
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

// Vyhodnocený profil vysunutí: oblasti v rovině skici a popis křivek, ze kterých vznikají boční stěny.
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

// `input`: vstup solveru s použitými polohami; `solve`: jak řešení dopadlo; `analysis`: rozbor
// určenosti (jen u vyřešené skici). Z nich vychází diagnostika skici.
export interface SketchState {
  feature: SketchFeature;
  frame: Frame;
  geometry: SketchGeometry;
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
}
