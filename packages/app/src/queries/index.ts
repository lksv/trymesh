// The views of queries (D39). A query needs no view: without one its answer is shown as a tree of
// names and values. A view replaces the tree with rows of its own, adds to the scene, and words
// the note of the status line.
import type { EngineState, FaceName, Frame, Id, QueryArgs, QueryName, QueryResult, ResultUnit, Vec3 } from '@trymesh/engine';
import { gapView } from './gap';
import { interferenceView } from './interference';
import { measureView } from './measure';
import { partsListView } from './parts-list';
import { printView } from './print';
import { sectionView } from './section';
import { sketchContactsView } from './sketch-contacts';

// What a view adds to the scene while its answer is shown: the fields of `SceneModel`, with
// a face given by its name (the scene resolves the mesh), and bodies drawn in a colour of the
// view's choice. What an addition says about a body the user has hidden is not drawn: a face,
// a coloured body, and a fill or a line that names its `body`.
export interface SceneAdditions {
  lines: { segments: ArrayLike<number>; color: number; width: number; dashed?: boolean; onTop?: boolean; overFills?: boolean; body?: Id }[];
  points: { positions: number[]; color: number; size: number }[];
  fills: { frame: Frame; loops: ArrayLike<number>[]; color: number; opacity: number; onTop?: boolean; body?: Id }[];
  faces: { body: Id; face: FaceName; color: number; opacity: number }[];
  labels: { at: Vec3; text: string; tone?: 'driving' | 'reference' | 'problem' }[];
  bodies: { body: Id; color: number }[];
  // The model is cut: what lies on the side the normal points to is neither drawn nor picked
  // (the bodies, their edges, a highlighted face or edge). The fills given with a cut are the
  // filled cut: they lie in its plane, and a click that meets one before anything that is drawn
  // picks nothing, because behind it is the inside of a body.
  clip: { origin: Vec3; normal: Vec3 };
}

// What a view gets of the panel and of the app.
export interface ViewPanel<N extends QueryName> {
  state: EngineState; // the state the answer was asked about
  bodyName(body: Id): string;
  faceLabel(name: FaceName): string;
  number(value: number, unit: ResultUnit): string; // a number with its unit as the app writes it: "16.2 mm", "30°"
  picked: number | undefined; // a row of the answer the user picked; what a row is belongs to the view
  pick(row: number | undefined): void; // redraws the panel and the scene
  // Ask again with other arguments of the form (a section stepped along its normal). The form
  // shows them; `prepare` is applied again.
  ask(args: QueryArgs<N>): void;
}

// A view of one query. Every member is optional: a view may only draw, or only list.
// - `immediate`: the query is asked as soon as its form opens, when no required argument is
//   missing (the collisions: one click).
// - `prepare`: the arguments the query is asked with, from the arguments of the form. A view that
//   draws may need more of the answer than a reader would ask for. What it adds never reaches the
//   form: the other members get the arguments of the form, not the prepared ones.
// - `answer`: the rows of the panel for an answer, in place of the tree. A view that replaces the
//   tree shows everything the answer has that a reader needs, failures and cut lists included;
//   nothing else will.
// - `scene`: what the answer adds to the scene.
// - `note`: the line for the status bar; it goes when the answer goes.
export interface QueryView<N extends QueryName> {
  immediate?: boolean;
  prepare?(args: QueryArgs<N>): QueryArgs<N>;
  answer?(result: QueryResult<N>, args: QueryArgs<N>, panel: ViewPanel<N>): HTMLElement[];
  scene?(result: QueryResult<N>, args: QueryArgs<N>, panel: ViewPanel<N>): Partial<SceneAdditions>;
  note?(result: QueryResult<N>, panel: ViewPanel<N>): { text: string; error: boolean };
}

export const QUERY_VIEWS: { [N in QueryName]?: QueryView<N> } = { measure: measureView, interference: interferenceView, section: sectionView, gap: gapView, print: printView, partsList: partsListView, sketchContacts: sketchContactsView };
