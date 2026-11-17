// What the app says of one kind of entry of `external` of a sketch (D64, part 5). The rest of the
// row of an entry, the pickers and the view read the entities of the entry (`referenceEntities`
// of the engine), not its fields.
import type { Id } from '@trymesh/engine';
import type { SketchToolName } from '../sketch-tools';

// - `title`: the name of the row of an entry in the panel of the sketch, `detail` what follows its ID.
// - `tag`: the word the pickers add after an entity of the entry.
// - `repair`: the button that replaces the source of the entry and keeps its ID: the tool that picks
//   the new source, with the entry to repair (`SketchMode.repair`), and what the status line says;
//   absent where there is nothing to pick again.
export interface ReferenceUi<R> {
  title(ref: R): string;
  detail(ref: R, host: { bodyName(id: Id): string }): string;
  tag: string;
  repair?: { title: string; tool: SketchToolName; hint: string };
}
