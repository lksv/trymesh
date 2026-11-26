// The rows of the panels that what lies under the pointer in the view belongs to (the reverse of
// a row hovered in the sketch panel, which marks its entity in the view). A row is tagged with the
// keys of what it shows when it is built; the app works out the keys of what is under the pointer
// and marks the rows that carry one, without building a panel again.
//
// Keys: `feature:<id>` (a row of the timeline), `body:<id>` (the line of a body in the model
// panel), `entity:<id>` (a row of the sketch panel that names an entity of the sketch, or an entry
// of `external`).
import { type Id, type SketchFeature, bodyOwner, entityIndex } from '@trymesh/engine';
import type { ViewPick } from './host';

export type RowKey = `${'feature' | 'body' | 'entity'}:${string}`;

// The class of a marked row (style.css gives it the look of a row under the mouse).
export const HOVERED = 'hovered';
// The elements that may carry keys; only these are looked at when the marks change.
const ROWS = '.row, .body, .constraint';
const tags = new WeakMap<Element, RowKey[]>();

// Tags a row with the keys of what it shows; returns the row.
export function hoverRow<T extends HTMLElement>(row: T, keys: RowKey[]): T {
  tags.set(row, keys);
  return row;
}

// The row of the timeline an ID of a feature lands on: a feature an insertion brought
// (`<insertion>/<feature>`, at any depth) on the row of the insertion.
const featureRow = (id: Id): RowKey => `feature:${bodyOwner(id).feature}`;

// The rows of a pick of the view:
// - a face: the feature that made it (FaceName.feature) and every feature that copied it (the
//   `pattern` of each copy tag: a pattern, or a combine with a clearance), and the feature that
//   made the body it lies on (a split, a pattern of a body, a mesh, an insertion), and the body;
// - an edge: the same of both its faces;
// - a plane: the row of a plane feature (the base planes have no row).
export function pickRows(pick: ViewPick | undefined): RowKey[] {
  if (!pick) return [];
  if (pick.kind === 'plane') return pick.ref.kind === 'plane' ? [featureRow(pick.ref.feature)] : [];
  const faces = pick.kind === 'face' ? [pick.name] : [pick.name.a, pick.name.b];
  const features = [...faces.flatMap((face) => [face.feature, ...(face.copy ?? []).map((tag) => tag.pattern)]), pick.body];
  return [...new Set<RowKey>([...features.map(featureRow), `body:${pick.body}`])];
}

// The rows of an entity of a sketch (an own point or curve, an entity of an entry, or an entry):
// the constraints that name it and the entry it belongs to.
export function sketchRows(sketch: SketchFeature | undefined, entity: Id | undefined): RowKey[] {
  if (!sketch || entity === undefined) return [];
  const entry = entityIndex(sketch).entities.get(entity)?.entry;
  return entry !== undefined && entry !== entity ? [`entity:${entity}`, `entity:${entry}`] : [`entity:${entity}`];
}

// Marks the rows under `roots` that carry one of the keys and unmarks the others. When `scroll`,
// a root none of whose marked rows lies wholly inside its visible part is scrolled by the smallest
// move that shows the first of them; a root that shows one does not move.
export function markRows(roots: HTMLElement[], keys: ReadonlySet<RowKey>, scroll: boolean): void {
  for (const root of roots) {
    const marked: HTMLElement[] = [];
    for (const row of Array.from(root.querySelectorAll<HTMLElement>(ROWS))) {
      const on = tags.get(row)?.some((key) => keys.has(key)) === true;
      if (row.classList.contains(HOVERED) !== on) row.classList.toggle(HOVERED, on);
      if (on) marked.push(row);
    }
    if (scroll && marked.length > 0 && !marked.some((row) => shownIn(row, root))) marked[0].scrollIntoView({ block: 'nearest' });
  }
}

// Whether a row lies wholly inside the visible part of the panel that scrolls it.
function shownIn(row: HTMLElement, root: HTMLElement): boolean {
  const [r, c] = [row.getBoundingClientRect(), root.getBoundingClientRect()];
  return r.top >= c.top && r.bottom <= c.bottom;
}
