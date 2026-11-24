// The shape of one tool of the sketch bar (D64, part 4). A tool is a file of this directory and
// one line of `SKETCH_TOOL_UI` (index.ts); the sketch mode (sketch-mode.ts) keeps what every tool
// shares (the place under the pointer and its snap, the inferred direction, the drag, the hover,
// the places kept, Escape, the marker of a snap, the hover of an edge) and hands the rest to the
// entry. A module of a tool imports only types of the mode, so the mode can import the table.
import type { Command, Id, Vec2 } from '@trymesh/engine';
import type { ViewPick } from '../host';
import { type Anchor, asConstruction, positionOf } from '../sketch-commands';
import type { SketchContext, SketchHost, SketchMode } from '../sketch-mode';
import type { SketchView } from '../sketch-view';

// A place of the sketch mode: an anchor (a place snapped to a point or a curve of the open sketch,
// or a bare place), or a place a tool's own picker made, whose snap may name an entity of another
// sketch (6b). The mode keeps a place as it is and drops a kept one only when its own snap is gone
// from the open sketch.
export type ForeignSnap = { kind: 'foreign'; sketch: Id; id: Id };
export interface Place {
  at: Vec2;
  snap?: Anchor['snap'] | ForeignSnap;
}

// The anchor of a place, for the tools that pick in the open sketch (`picks: 'sketch'` or
// `'curve'`): their places are anchors. A foreign snap (only a tool's own picker makes one) is
// dropped, leaving the bare place.
export const anchor = (place: Place): Anchor => (place.snap?.kind === 'foreign' ? { at: place.at } : (place as Anchor));

// Where a place is in the open sketch: the position of what it snapped to, or its bare place.
export const placePosition = (view: SketchView, place: Place): Vec2 => (place.snap?.kind === 'foreign' ? place.at : positionOf(view, place as Anchor));

// What a tool remembers between sketches, with its start value, and its part of the panel while
// the tool is active. The app keeps the value by tool (`SketchState.tools`); `set` stores a new
// value, and the panel redraws what it has to itself.
export interface ToolOptions<O> {
  initial: O;
  panel(host: SketchHost, value: O, set: (value: O) => void): HTMLElement[];
}

interface ToolBase<O> {
  label: string; // the button of the bar
  hint: string; // what the status line says when the tool is chosen
  options?: ToolOptions<O>;
}

// A tool that picks places.
// - `picks`: what the pointer looks for. `sketch` (the default): a place in the sketch, snapped to
//   a point or a curve, points first; `curve`: a place on a curve only, of the curves `eligible`
//   lets through, its `at` the point of the curve nearest the pointer, and the bare pointer without
//   a snap away from every such curve (a click near a crossing still gives the curve); or the tool's
//   own picker `pick` for what the mode does not know (6b: the geometry of another sketch).
// - `clicks`: how many places a shape takes (a line 2, an arc 3). The places before the last are
//   kept in the mode and drawn, and the mode redraws the scene when it keeps one; the last calls
//   `click` with all of them, and afterwards the mode drops the inferred direction and redraws the
//   scene. Without it `click` is called at every click with the places kept so far and this one,
//   and the mode redraws the scene when places were kept before the click or are kept after it
//   (6d: the control points of a spline).
// - `click` returns the places to keep for the next click; nothing means none (the line returns its
//   end, so the chain goes on). The mode keeps them after `click` returns, so a redraw inside
//   `click` would not show them. It makes the calls of the app the tool needs (`renderPanel`,
//   `renderScene` for what it changes), beyond those of the mode.
// - `finish`: what the key Enter does with the places kept, called only when some are kept; it
//   returns the places to keep as `click` does (too few for the shape: a message, and they stay),
//   and the mode redraws the scene. Escape drops them, for every tool.
// - `infer`: the second place snaps horizontal or vertical from the first (the line).
// - `hovers`: the point or curve under the pointer is highlighted, and the tool draws no snap
//   marker and no shape in progress (the select tool).
// - `drags`: a press on an own point starts its drag (the select tool).
// - `atClick`: the place of a click is the place under the click, not where the last move of the
//   pointer put the cursor (which carries the inferred direction of a line).
// - `draw`: what the tool draws while the pointer moves, as polylines in the coordinates of the
//   sketch, dashed (the shape in progress). `places` are the positions of the places kept.
// A drawing tool sends its batch through `drawn`, which applies the switch of construction curves;
// a tool whose batch must stay as the engine made it (the fillet) runs it with `host.run`.
export interface SketchPlaceTool<O> extends ToolBase<O> {
  picks?: 'sketch' | 'curve' | { pick(host: SketchHost, event: { clientX: number; clientY: number }, context: SketchContext): Place | undefined };
  eligible?(curve: Id, context: SketchContext): boolean; // with `picks: 'curve'`; without it every curve
  clicks?: number;
  infer?: boolean;
  hovers?: boolean;
  drags?: boolean;
  atClick?: boolean;
  click(host: SketchHost, m: SketchMode, places: Place[], context: SketchContext, options: O, event: { shiftKey: boolean }): Place[] | void;
  finish?(host: SketchHost, m: SketchMode, places: Place[], context: SketchContext, options: O): Place[] | void;
  draw?(places: Vec2[], cursor: Place, context: SketchContext, options: O): Vec2[][];
}

// A tool that picks an edge of the model (Project). The mode highlights the edge under the pointer.
export interface SketchEdgeTool<O> extends ToolBase<O> {
  picks: 'edge';
  click(host: SketchHost, m: SketchMode, pick: ViewPick | undefined, context: SketchContext): void;
}

export type SketchToolUi<O = undefined> = SketchPlaceTool<O> | SketchEdgeTool<O>;

// The batch of a drawing tool: the switch of construction curves applied, then run. True when the
// engine took it.
export const drawn = (host: SketchHost, m: SketchMode, commands: Command[] | undefined): boolean =>
  commands !== undefined && commands.length > 0 && host.run({ type: 'batch', commands: m.construction ? asConstruction(commands) : commands });
