// What a panel or a form may use of the app. `App` implements it; a module of a panel imports
// this interface and never app.ts, so the modules do not import each other in a circle.
import type { Command, Document, EdgeKind, EdgeName, Engine, EngineState, FaceName, Feature, FeatureResult, Frame, Id, Issue, PlaneRef, Vec2 } from '@trymesh/engine';
import type { AnyDraft, DraftState } from './features/draft';

// What is picked in the view: a face or an edge of a body, or a plane.
export type ViewPick =
  | { kind: 'face'; body: Id; faceId: number; name: FaceName; planar: boolean }
  | { kind: 'edge'; body: Id; index: number; name: EdgeName; edgeKind: EdgeKind }
  | { kind: 'plane'; key: string; ref: PlaneRef; frame: Frame };

// The same thing picked twice has the same key.
export const pickKey = (pick: ViewPick | undefined): string => (!pick ? '' : pick.kind === 'face' ? `f/${pick.body}/${pick.faceId}` : pick.kind === 'edge' ? `e/${pick.body}/${pick.index}` : `p/${pick.key}`);
export const PICK_REACH = 7; // px: how near the pointer has to be to an edge, a point or a curve

// What the status line shows. A panel that keeps the note of its answer compares it by identity.
export interface Note {
  text: string;
  error: boolean;
}

export interface PanelHost {
  // The part of the engine a panel may call. Undo, redo and load stay with the app, which blocks
  // them while a draft is open and tells the bridge about a replaced document.
  readonly engine: Pick<Engine, 'getState' | 'preview' | 'execute' | 'diagnoseSketch' | 'explainConstraint' | 'interference' | 'exportMesh' | 'query' | 'export'>;

  // ----- the shown state and names
  readonly doc: Document;
  view(): EngineState; // the state that is shown: after the marker, after the edited feature, or a preview
  stateBefore(index: number): EngineState; // the model before the feature at this place of the timeline
  feature(id: Id | undefined | null): Feature | undefined;
  readonly featureNames: (id: Id) => string | undefined;
  nameOf(id: Id): string;
  bodyName(body: Id): string;
  issueText(issue: Issue): string;
  issues(result: FeatureResult | undefined): HTMLElement[];
  describe(pick: ViewPick): string;

  // ----- the selection
  readonly selectedFeature?: Id; // on the timeline
  readonly selected?: ViewPick; // in the view
  planeRefOf(pick: ViewPick | undefined): PlaneRef | undefined;
  readonly pending?: Feature['type']; // a new feature of this type waits for its plane to be picked
  usePlane(ref: PlaneRef): boolean;
  cancelPending(): void;
  readonly marker: Id | null; // the feature after which new ones go; null: the end of the timeline
  insertIndex(): number; // the place on the timeline a new feature goes to
  // A feature was added at the marker: the marker follows it. The caller goes on to something
  // that refreshes the app (it enters the sketch, or closes its form).
  inserted(id: Id): void;
  newId(prefix: string): Id; // an ID that the document does not have yet; the counter of a prefix never goes back

  // ----- the view
  planePoint(event: { clientX: number; clientY: number }, frame: Frame): { at: Vec2; depth: number } | undefined; // where the ray under the pointer meets a plane
  planeSize(state: EngineState): number; // the side of the square a plane is drawn as
  pixelSize(): number; // millimetres per pixel of the view

  // ----- the mode
  readonly draft: AnyDraft | undefined; // the open form, if one is open
  readonly drafting: DraftState;
  openDraft(mode: AnyDraft): void;
  closeDraft(deselect: boolean): void; // back to the model; `deselect`: the feature selected on the timeline is dropped too
  enterSketch(id: Id): void; // also turns the view to the sketch and fits it
  invalidate(): void; // the shown state changed without a refresh (a new preview of a draft)

  // ----- actions
  readonly note: Note; // the note the status line shows now
  say(text: string, error?: boolean): void;
  run(command: Command, done?: string): boolean; // executes; a refused command is said in the status line
  refresh(): void;
  renderPanel(): void;
  renderScene(): void;
  edit(id: Id): void;
}
