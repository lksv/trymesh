// What a panel or a form may use of the app. `App` implements it; a module of a panel imports
// this interface and never app.ts, so the modules do not import each other in a circle.
import type { Command, Document, EdgeKind, EdgeName, Engine, EngineState, FaceName, Feature, FeatureResult, Frame, Id, PlaneRef } from '@trymesh/engine';

// What is picked in the view: a face or an edge of a body, or a plane.
export type ViewPick =
  | { kind: 'face'; body: Id; faceId: number; name: FaceName; planar: boolean }
  | { kind: 'edge'; body: Id; index: number; name: EdgeName; edgeKind: EdgeKind }
  | { kind: 'plane'; key: string; ref: PlaneRef; frame: Frame };

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
  feature(id: Id | undefined | null): Feature | undefined;
  nameOf(id: Id): string;
  bodyName(body: Id): string;
  issues(result: FeatureResult | undefined): HTMLElement[];
  describe(pick: ViewPick): string;

  // ----- the selection
  readonly selectedFeature?: Id; // on the timeline
  readonly selected?: ViewPick; // in the view
  planeRefOf(pick: ViewPick | undefined): PlaneRef | undefined;
  readonly pending?: 'sketch' | 'plane'; // a new sketch or plane waits for its plane to be picked
  usePlane(ref: PlaneRef): boolean;
  cancelPending(): void;
  readonly marker: Id | null; // the feature after which new ones go; null: the end of the timeline

  // ----- actions
  readonly note: Note; // the note the status line shows now
  say(text: string, error?: boolean): void;
  run(command: Command, done?: string): boolean; // executes; a refused command is said in the status line
  refresh(): void;
  renderPanel(): void;
  renderScene(): void;
  edit(id: Id): void;
}
