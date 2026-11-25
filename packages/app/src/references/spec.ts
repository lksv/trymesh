// What the app says of one kind of entry of `external` of a sketch (D64, part 5). The rest of the
// row of an entry, the pickers and the view read the entities of the entry (`referenceEntities`
// of the engine), not its fields.
import type { Id, Input, NumberSpec } from '@trymesh/engine';
import type { SketchToolName } from '../sketch-tools';

// What picking the source of an entry again does: the tool that picks it, with the entry to repair
// (`SketchMode.repair`), and what the button and the status line say.
export interface EntryRepair {
  title: string;
  tool: SketchToolName;
  hint: string;
}

// One control of the form of an entry (D68), with the path of its field in the entry's input form
// (`entryInput`, `/` between the keys). The panel draws the controls of any kind and sends
// `updateExternal` with the input form changed at the path; it imports nothing of the sketch mode.
// - `sources`: a list of IDs with the button *Use selection* (the own curves and points selected,
//   and `origin`).
// - `choice`: one of `options`; `set` makes the input form for a value (a new kind of transform
//   brings its own fields).
// - `entity`: a line or a point of the sketch that may serve (not a copy), as a select.
// - `number`: a numeric field that takes an expression, in the unit of `spec`.
// - `switch`: on, the field at the path is `on`; off, it is left out.
export type EntryControl =
  | { kind: 'sources'; path: string; title: string }
  | { kind: 'choice'; path: string; title: string; options: readonly { value: string; label: string }[]; set(input: unknown, value: string): unknown }
  | { kind: 'entity'; path: string; title: string; entity: 'line' | 'point' }
  | { kind: 'number'; path: string; title: string; spec: NumberSpec }
  | { kind: 'switch'; path: string; title: string; on: unknown };

// - `title`: the name of the row of an entry in the panel of the sketch, `detail` what follows its ID.
// - `tag`: the word the pickers add after an entity of the entry.
// - `repair`: the button that replaces the source of the entry and keeps its ID, by the entry
//   (one row serves three transforms); absent, or undefined for an entry, where there is nothing to
//   pick again.
// - `form`: the controls of the entry, by its input form (a numeric field may hold an expression); absent where the entry has no fields to
//   change in the panel.
// - `flag` (D69): a checkbox in the row: its label, its state for an entry (undefined: no checkbox
//   for that entry, a projected point), and the entry with it switched, sent by `updateExternal`.
// - `inModel` (D69): the curves of such an entry are drawn with the own curves of their sketch in
//   the model view, outside the sketch mode (a sketch of projections alone is seen); a projected
//   edge is not, the edge of the body lies there.
export interface ReferenceUi<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string; nameOf(id: Id): string }): string;
  tag: string;
  repair?(ref: R): EntryRepair | undefined;
  form?(input: Input<R>): EntryControl[];
  flag?: { label: string; title: string; get(ref: R): boolean | undefined; set(ref: R, on: boolean): R };
  inModel?: boolean;
  // `file` (D72): the button of a row that reads a revised file into the entry, through the draft of
  // the import of an outline.
  file?: { label: string; title: string };
}
