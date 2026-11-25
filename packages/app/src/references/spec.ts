// What the app says of one kind of entry of `external` of a sketch (D64, part 5). The rest of the
// row of an entry, the pickers and the view read the entities of the entry (`referenceEntities`
// of the engine), not its fields.
import type { Id, NumberSpec } from '@trymesh/engine';
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
// - `form`: the controls of the entry, by its input form; absent where the entry has no fields to
//   change in the panel.
export interface ReferenceUi<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string }): string;
  tag: string;
  repair?(ref: R): EntryRepair | undefined;
  form?(input: R): EntryControl[];
}
