// Contract of package 6f (D72): the import of an outline. A draft for review, only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). Every package before 6f in the sequence of step 6 is
// implemented and merged (6a D64, 6a2 D71, 6e D65, 6c D68, 6b D69, 6d D70), so this file imports
// the real types of the engine and states what 6f adds or changes. The design is design.md, the
// calls are calls.ts, the prototypes behind the numbers are in probes/.
//
// What changes:
// 1. A reference kind of entry of `external`, `outline`: the curves of a file, stored in the entry,
//    placed by three numeric fields and an anchor, with the flag `regions` (default true).
//    `ExternalRef` gets the member; the commands get its two input forms.
// 2. `Projected`, the stored value of reference geometry, gets a fifth form: the placement an
//    outline was solved with and the fingerprint of its curves. No positions are stored twice.
// 3. What the registry's spec gains: one ID asked of a reference kind (`entity`), the solver given
//    only the entities the constraints name (`narrow`), an update that may leave fields out
//    (`partial`). The rule of an update gets its third part.
// 4. The import: a second catalog of formats, `OUTLINE_FORMATS` (`dxf`, `svg`), beside
//    `IMPORT_FORMATS`, and the function `importOutline` with what follows the reading for every
//    format: the weld, the arcs made exact, the limits, the local IDs, the report.
// 5. What 6f adds at the plug-in points of 6e and in the code of 6b and 6c: three texts and two
//    lines.
// 6. A query `entryCurves`: the curves of one entry with their places, a page at a time.
// 7. MCP: the tool `import_outline`; what `get_sketch` and `get_document` say of an outline.
// 8. The app: the button of the sketch panel, the row of the kind.
// No command, no feature type, no face role, no issue code, no section, no schema step.

import type { Command, Document, EntityKind, ExternalRef, Expr, Id, NumberSpec, Projected, SketchFeature, Vec2 } from '../../../packages/engine/src/index';
import type { ArgSpecs, ArgsOf, RunArgsOf } from '../../../packages/engine/src/index';
import type { EntryGeometry, ReferenceKindSpec, ResolvedReference } from '../../../packages/engine/src/references/spec';
import type { SketchCurve } from '../../../packages/engine/src/sketch';

// ================================================================ 1. the entry

// A curve of a stored outline, in the coordinates of its file, in millimetres. Positions are pairs
// `[x, y]`; none of them is a numeric field (a string there is an invalid command).
// - `line`: from `a` to `b`, at least the length tolerance long.
// - `circle`: `radius` at least the length tolerance.
// - `arc`: counter-clockwise from `start` to `end` about `center`; the two ends on one radius within
//   `OUTLINE_LIMITS.arc`; `start` equal to `end` is no arc (a whole turn is a `circle`).
// - `spline`: the control points of a spline of the sketch (CurveShape `spline`, D70): 3 to 64, the
//   first again as the last closes it (then at least 4).
export type OutlineCurve =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2 }
  | { type: 'spline'; points: Vec2[] };

// An imported outline (D72): the curves of a drawing (a board outline, a laser-cut plate) stored in
// the entry and placed in the sketch. Reference geometry: fixed for the solver, so constraints and
// dimensions of the sketch may name its entities, a later sketch may project them, and nothing
// moves it but its own fields. In types.ts this comment is read by the AI.
// - Usually not written by hand: the MCP tool import_outline reads a DXF or SVG file and sends the
//   command; the app has "Import an outline…" in the panel of a sketch.
// - `curves`: the curves by their local ID (letters, digits, underscores), 1 to 2000. The readers
//   number them by kind in the order of the file: `l1`, `l2`, … lines, `a1` … arcs, `c1` … circles,
//   `s1` … splines.
// - IDs: the curve `<entry>/<local>` (`board/l3`); its points as an own curve of that kind names
//   them: `<entry>/<local>/a` and `/b` of a line, `/center` of a circle, `/center`, `/start`, `/end`
//   of an arc, and `/0`, `/1`, … the control points of a spline. The entry itself is no entity.
// - `x`, `y`, `turn`: where the outline stands, numeric fields (`external/<entry>/x`, …: they take
//   expressions, and setField with the sketch as the feature changes one). The anchor of the
//   outline lands at (`x`, `y`) and the outline is turned about it by `turn` (rad, counter-clockwise).
// - `anchor`: which place of the file is put at (`x`, `y`): `origin`, the origin of the file (the
//   coordinates of the file are kept, a revised file moves nothing that did not move in it), or
//   `center`, the centre of the box of the curves (the outline stays centred when a revised file is
//   larger).
// - `regions`: whether the curves bound regions of the sketch as own curves that are not
//   construction do (default true: a board is extruded from its outline directly). Then the ends
//   of the curves join the curve ends at their place within 1e-6 mm, each other's and that of an own
//   curve that forms regions, and the side face of a curve is `{ feature, role: 'side', curve:
//   '<entry>/<local>' }`. With `false` the curves are reference only, as a projected edge.
// - A curve of an outline is never cut by the sketch tools. An own curve that crosses an outline
//   that forms regions makes the profile invalid for good: switch `regions` off and draw the
//   outline as own curves in a later sketch (the sketch tool projectSketch with `as: 'own'`), then
//   cut that.
// - `name`: for people, the name of the file.
// - A revised file: `updateExternal` with the new `curves` (the tool import_outline with
//   `replace`). An entity keeps its ID when the file lists it at the same place among the curves of
//   its kind; nothing is matched by geometry. Refused while a constraint of the sketch names an
//   entity the new curves do not have; a later feature that names one becomes a broken reference
//   (a projection keeps its last place, an extrusion has no profile).
// - The values never fail: an outline has no source that can go away.
export interface SketchOutline {
  type: 'outline';
  name?: string;
  curves: Record<Id, OutlineCurve>;
  x: number;
  y: number;
  turn: number;
  anchor: 'origin' | 'center';
  regions: boolean;
}
export const OUTLINE_ANCHORS = ['origin', 'center'] as const satisfies readonly SketchOutline['anchor'][];
// The flag of an outline when a command leaves it out (the convention of a flag of an entry, D69:
// the document always holds it, the kind has the default; owner, answer 2).
export const OUTLINE_REGIONS_DEFAULT = true;

// The input form of `addExternal`: the curves, and what a command may leave out with its default
// (`x`, `y`, `turn` 0; `anchor` `origin`; `regions` true). A numeric field may be an expression.
export interface OutlineInput {
  type: 'outline';
  name?: string;
  curves: Record<Id, OutlineCurve>;
  x?: number | Expr;
  y?: number | Expr;
  turn?: number | Expr;
  anchor?: SketchOutline['anchor'];
  regions?: boolean;
}
// The input form of `updateExternal` of an outline: every field but `type` may be left out and
// then keeps what the entry has, an expression too (`partial` of the kind, section 3). `curves`
// given replaces the stored outline whole. So the flag is switched, or the outline moved, without
// sending the curves again: `{ type: 'outline', regions: false }`.
export type OutlineUpdate = Partial<Omit<OutlineInput, 'type'>> & { type: 'outline' };

export type ExternalRefAfter = ExternalRef | SketchOutline;
// The two commands as they take an outline; every other command is the engine's.
export type CommandAfter =
  | Command
  | { type: 'addExternal'; sketch: Id; id: Id; ref: OutlineInput }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: OutlineUpdate }
  | { type: 'batch'; commands: CommandAfter[] };
export type SketchFeatureAfter = Omit<SketchFeature, 'external' | 'solved'> & { external: Record<Id, ExternalRefAfter>; solved: { inputs: string; external: Record<Id, ProjectedAfter> } };

// ---------------------------------------------------------------- the numbers

// - `curves`: the most curves of one outline (an import beyond it is `tooLarge`, an entry beyond it
//   an invalid command). Measured (design.md, C1, F1): 2000 curves that form regions cost 120 ms at
//   the first evaluation and 100 ms at every change of their sketch, and 140,000 characters of the
//   document.
// - `note`: from this many curves on the report of an import says what a change in the sketch costs.
// - `splinePoints`: of one spline, the limit of a spline of the sketch (D70).
// - `arc`: how far the two ends of a stored arc may lie off one radius, mm. The readers leave
//   under 1e-12; the placement then puts the end on the circle of the start (6b's `exactArc`).
// - `listed`: how many curves `get_sketch` lists of one outline, and above how many `get_document`
//   leaves the curves out.
export const OUTLINE_LIMITS = { curves: 2000, note: 500, splinePoints: 64, arc: 1e-9, listed: 50 } as const;
export const OUTLINE_PLACE: NumberSpec = { title: 'Place', unit: 'mm', default: 0 };
export const OUTLINE_TURN: NumberSpec = { title: 'Turn', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, default: 0 };

// ================================================================ 2. the stored value

// The value of an outline in `solved.external`: where the origin of its file lands (`at`, after the
// anchor), the turn, and the fingerprint of its curves (`fingerprint(stableStringify(curves))`). It
// is what the stamp of the sketch holds of the outline: the sketch is solved again when the outline
// moves or its curves change. The positions are computed from the entry and this value at every
// recompute and are stored nowhere a second time.
export interface PlacedOutline {
  kind: 'outline';
  at: Vec2;
  turn: number;
  data: string;
}
export type ProjectedAfter = Projected | PlacedOutline;

// A point p of the file stands at `at + R(turn) · p`. With the anchor `center`, `at` is
// `(x, y) − R(turn) · c` for the centre `c` of the box of the curves (`outlineBox`): the outline
// turns about its centre.
export declare function placeOutline(ref: SketchOutline): PlacedOutline;
// The box of a list of curves: the ends of a line, a circle whole, an arc with the points of its
// circle furthest along x and y that it passes, a spline by the box of its curve (`splineBox`).
// Undefined for no curve.
export declare function outlineBox(curves: Iterable<OutlineCurve>): { min: Vec2; max: Vec2 } | undefined;
// The geometry of an entry from its value: every curve placed, an arc with its end put on the
// circle of its start; `regions` every curve, or none. A turn of exactly 0 moves no digit of the
// file but by the addition of `at`. Kept by the object of `curves` and the value (the document is
// immutable), so a drag in the sketch does not place the outline again.
export declare function outlineGeometry(id: Id, ref: SketchOutline, value: PlacedOutline): EntryGeometry;
// Every entity of an entry in the order of its curves, a curve before its points. A closed spline
// lists its first point once.
export declare function outlineEntities(id: Id, ref: SketchOutline): Record<Id, EntityKind>;
// One ID under an entry, with one look-up: `<entry>/<local>` is the kind of that curve,
// `<entry>/<local>/<name>` a point when the curve has a point of that name.
export declare function outlineEntity(id: Id, ref: SketchOutline, entry: Id): EntityKind | undefined;

// ================================================================ 3. the registry

// What a reference kind may say beyond 6b's spec (references/spec.ts). All three are optional, and
// the kinds of today say none of them.
// - `entity`: what one ID under the entry is, with one look-up, as the derived half has since 6c.
//   `entityOf` asks it when it is there, and `entities` (a listing) otherwise: an outline of 2000
//   curves has 5000 entities, which every validation of a constraint would otherwise list.
// - `narrow`: the solver gets of the entry only the entities a constraint of the sketch names (a
//   curve with its points; a point alone), as it gets the axes of the origin only when one is named
//   (D71). Everything else of the entry is fixed anyway and no equation reads it. Measured: with a
//   whole outline of 2000 curves in its input the adapter runs out of memory (C4). The positions
//   the solver did not get are put into the geometry of the step after it, as the far points of the
//   axes are.
// - `partial`: `updateExternal` may leave fields of the entry out; they keep what the entry has
//   (`{ ...entryInput(sketch, id), ...command.ref }`, so an expression stays an expression).
export interface ReferenceKindAfter<R, V> extends ReferenceKindSpec<R, V> {
  entity?(id: Id, ref: R, sketch: SketchFeature, entry: Id): EntityKind | undefined;
  narrow?: true;
  partial?: true;
}
// A resolved reference of a kind with `narrow`: `geometry` whole (the curves of the sketch, the
// profile, the result), `solver` what the input of the solver gets.
export interface ResolvedReferenceAfter extends ResolvedReference {
  solver?: EntryGeometry;
}
// The part of a geometry that the operands of the constraints name: a named curve with its points
// and its radius, a named point alone; `regions` and `hidden` empty.
export declare function narrowed(geometry: EntryGeometry, named: ReadonlySet<Id>): EntryGeometry;

// The kind (references/outline.ts). `refs` and `faces` are empty: an outline reads nothing of the
// model. `compute` never fails. `keepsValue` is always true: the stored value is never a frozen one
// (the recompute writes the fresh one whenever it differs), so an update has nothing to drop, and
// an update that changes neither the place nor the curves (the flag, the name) leaves the stamp and
// the stored value as they are.
export declare const outline: ReferenceKindAfter<SketchOutline, PlacedOutline>;

// The rule of an update, with its third part (6a's design, "The commands"; the slot in
// `updateProblem` of references/index.ts says "refused by the package that can reach it, 6f"):
// an update under which an entity that a constraint of the sketch names goes away is refused,
// naming the constraints and the entities. For every kind; only an outline can reach it (an edge
// and a projection keep their entities, no constraint names a copy). Measured before the rule (B5):
// the update is accepted, and the document it leaves does not load.
export declare function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRefAfter, after: ExternalRefAfter): string | undefined;
export const ENTITY_TAKEN = (entry: Id, gone: { entity: Id; constraints: Id[] }[]): string =>
  `the update takes away ${gone.map((g) => `"${g.entity}" (named by ${g.constraints.join(', ')})`).join(', ')} of "${entry}": remove ${gone.length === 1 && gone[0].constraints.length === 1 ? 'that constraint' : 'those constraints'} first, in the same batch, or keep the ${gone.length === 1 ? 'curve' : 'curves'}`;

// The texts of the validator of the kind.
export const OUTLINE_REFUSALS = {
  count: (what: string, n: number): string => `${what}.curves: an outline has 1 to ${OUTLINE_LIMITS.curves} curves, not ${n}`,
  localId: (what: string, key: string): string => `${what}.curves: "${key}" is no local ID of a curve (letters, digits and underscores)`,
  expression: (what: string): string => `${what}: a position of a stored outline is a number; an expression goes into x, y or turn of the entry`,
  noLength: (what: string): string => `${what}: the line has no length`,
  noRadius: (what: string): string => `${what}: the radius is under the length tolerance`,
  arcEnds: (what: string, off: number): string => `${what}: the start and the end of the arc are ${off} mm off one radius about its centre (at most ${OUTLINE_LIMITS.arc}); move the centre onto the bisector of the two`,
  arcWhole: (what: string): string => `${what}: the start and the end of the arc are one place; a whole turn is a circle`,
  missingCurves: (what: string): string => `${what}.curves: the curves of the outline are expected (the tool import_outline reads them from a file)`,
};

// ================================================================ 4. the import

// What a format reads of a file: its curves in millimetres in the order of the file, each with the
// layer it is on, and what it has to say about the file.
// - `unit`: what one unit of the file was taken as (`mm`, `in`, … or `0.5 mm per unit` for an SVG);
//   `unitFrom`: where that came from (`option`, `file`, or `default`: the file does not say).
// - `layers`: every layer of the file with the number of its entities, read or not, by type.
// - `skipped`: what was left out of the layers asked for, by reason, with the count: an entity of
//   a type the format does not read (`ELLIPSE`, `TEXT`, `INSERT`, an elliptical arc of a path), a
//   rational spline, a transform with a shear.
export interface ReadOutline {
  curves: { curve: OutlineCurve; layer: string }[];
  about: { unit: string; unitFrom: 'option' | 'file' | 'default'; layers: Record<string, Record<string, number>>; skipped: Record<string, number> };
}
// An entry of the catalog: the shape of an import format of D55 (import/spec.ts) with another
// result; `ImportFormatSpec<S, R = ReadTriangles>` gets the second parameter. `read` throws
// `ImportFailure` (`unreadable`, `tooLarge`) as a mesh format does.
export interface OutlineFormatSpec<S> {
  title: string;
  summary: string;
  extensions: readonly string[];
  options: S;
  read(bytes: Uint8Array, options: RunArgsOf<S>): ReadOutline;
}

// The options the two formats share, described like the options of any format.
const SHARED = {
  layers: { kind: 'list', of: { kind: 'text' }, min: 1, title: 'Layers', summary: 'Only the curves on these layers, by name (DXF: the layer of an entity; SVG: the `id` or the `inkscape:label` of a group the element is in). Without it every layer; the report of an import lists the layers of the file with what they hold.', optional: true },
  weld: {
    kind: 'number',
    title: 'Weld',
    summary: 'Ends of curves this close are put at one place, so that an outline written with few digits closes; the report says how many ends were moved and how far, and which ends stayed open with another end near.',
    optional: true,
    spec: { title: 'Weld tolerance', unit: 'mm', min: { value: 0 }, max: { value: 1 }, default: 0.01 },
  },
} as const satisfies ArgSpecs;
export const DXF_OPTIONS = {
  ...SHARED,
  unit: { kind: 'choice', options: ['mm', 'cm', 'm', 'in', 'ft', 'mil'], title: 'Unit of the file', summary: 'What one unit of the file is. Without it the header says (`$INSUNITS`: inches, feet, millimetres, centimetres, metres, mils); a file that does not say is read in millimetres, and the report says so.', optional: true },
} as const satisfies ArgSpecs;
export const SVG_OPTIONS = {
  ...SHARED,
  unit: { kind: 'choice', options: ['mm', 'cm', 'in', 'pt', 'px'], title: 'User unit', summary: 'What one user unit of the drawing is. Without it `width`, `height` and `viewBox` of the root say; a root without them is read at 96 units per inch (px).', optional: true },
} as const satisfies ArgSpecs;
export interface OutlineFormats {
  dxf: typeof DXF_OPTIONS;
  svg: typeof SVG_OPTIONS;
}
export type OutlineFormat = keyof OutlineFormats;
export type OutlineOptions<F extends OutlineFormat> = ArgsOf<OutlineFormats[F]>;
// The catalog (import/outline.ts), beside `IMPORT_FORMATS`: a format is a module of `import/` and
// one line. `importFormatOf(path, OUTLINE_FORMATS)` and `importAccept(OUTLINE_FORMATS)` of D55 pick
// a format by the extension and make the list of a file input; both take a catalog already.
export declare const OUTLINE_FORMATS: { [F in OutlineFormat]: OutlineFormatSpec<OutlineFormats[F]> };

// What an import says about the outline it read.
// - `curves`, `byKind`: what the outline holds after the weld.
// - `welded`: ends moved onto another end; `moved`: the furthest one was moved, mm.
// - `dropped`: curves left out because the weld left them no extent.
// - `open`: ends that are the end of no other curve; `gaps`: at most 20 of them that have another
//   end within a hundred weld tolerances, the nearest first, with the distance: a larger `weld`
//   closes them.
// - `bounds`: mm, in the coordinates of the file.
// - `notes`: in words, for the caller to read (the unit when the file did not say, the gaps, the
//   size, the cost of many curves).
export interface OutlineReport {
  format: OutlineFormat;
  about: ReadOutline['about'];
  curves: number;
  byKind: Record<OutlineCurve['type'], number>;
  welded: number;
  moved: number;
  dropped: number;
  open: number;
  gaps: { at: Vec2; distance: number }[];
  bounds: { min: Vec2; max: Vec2 };
  notes: string[];
}
// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a file of the format (a binary DXF among them).
// - `empty`: the file, or the layers asked for, hold no curve the format reads; the message lists
//   the layers of the file and what was skipped.
// - `tooLarge`: more curves than an outline holds.
export type OutlineOutcome =
  | { ok: true; curves: Record<Id, OutlineCurve>; report: OutlineReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'empty' | 'tooLarge'; message: string; arg?: (string | number)[]; about?: ReadOutline['about'] } };

// Reads a file into the curves of an outline. A function without a state, as `importMesh`: the
// curves enter a document by `addExternal` or `updateExternal`.
// 1. The options are checked against the description of the format and the format reads the bytes.
// 2. The weld (`weldOutline`).
// 3. The limit, and `empty`.
// 4. The local IDs: by kind, in the order of the file, from 1 (`outlineIds`).
// 5. The report.
// The same bytes and options give the same curves under the same IDs.
export declare function importOutline<F extends OutlineFormat>(format: F, bytes: Uint8Array, options?: OutlineOptions<F>): OutlineOutcome;

// The weld. Ends (of a line, an arc, a spline) within `tolerance` of each other, transitively, are
// put at the position of the first of them in the order of the file; then an arc gets its centre
// moved onto the bisector of its chord (the nearest point of it), so that both ends are on one
// radius to the last digits; a line or an arc whose two ends became one place is dropped. With a
// tolerance of 0 only the arcs are made exact.
export declare function weldOutline(curves: readonly OutlineCurve[], tolerance: number): { curves: OutlineCurve[]; welded: number; moved: number; dropped: number; open: number; gaps: OutlineReport['gaps'] };
export declare function outlineIds(curves: readonly OutlineCurve[]): Record<Id, OutlineCurve>;

// What a revised outline does to the entities of the one before it, for the answer of a tool and
// the status line of the app: the local IDs that stay, come and go.
export declare function outlineRevision(before: Record<Id, OutlineCurve>, after: Record<Id, OutlineCurve>): { kept: number; added: Id[]; removed: Id[] };

// What the reader of DXF takes (design.md, "The readers"), as data for its tests and its summary.
export const DXF_READS = {
  entities: ['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'],
  insunits: { 0: 'mm', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 9: 'mil' },
  unitInMm: { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, mil: 0.0254 },
} as const;

// ================================================================ 5. the packages before it

// 6e, `contactFix` (sketch-cut.ts): a curve of an outline that forms regions is "flagged" as a
// projection of 6b is. With the ends of another curve it is not listed (6b's rule: the join of
// the own ends there cures it); any other contact is `fix: 'none'` with this reason.
export const OUTLINE_NOT_CUT = (curve: Id, entry: Id): string =>
  `${curve} is a curve of the imported outline ${entry}, which forms regions and is not cut: switch \`regions\` of ${entry} off (updateExternal { type: "outline", regions: false }) and draw the outline as own curves in a later sketch (the sketch tool projectSketch with as: "own"), then cut that; or remove the curve that meets it`;
// 6e, an extension that would end on or cross such a curve keeps 6e's text of a curve that forms
// regions and is not own. `curvePredicates`, `readersOf`, `repairsByDefault`, `sketchWorld`: nothing
// (an outline's curves are reference curves of the base with `regions`; an update is no cut).

// 6b (references/projection.ts): `isSplineOf` answers for a spline of an outline as well, so the
// refusal of a projection of one says 6d's text, not "is a spline, expected line".
export declare function isSplineOf(sketch: SketchFeatureAfter, entity: Id): boolean;

// 6c and the app (packages/mcp/src/tools.ts, `openEndAdvice`): the cure of an open end of an outline.
export const OUTLINE_OPEN_END = 'Curves of an imported outline close where their ends are within 1e-6 mm: import the file again with a larger `weld` (the report of the import lists the gaps), or end an own curve at the open end';

// features/sketch.ts, `ruleProblem`: the points of a curve of an entry are the point entities under
// `<curve>/`, for every kind (an edge `e/a`, a curve of an outline `o/l1/a`), so the own rule of a
// constraint (a point on its own curve, a tangency of curves that do not meet) reads them.
export declare function entryCurvePoints(sketch: SketchFeatureAfter, curve: Id): Id[];

// ================================================================ 6. the query `entryCurves`

// The curves of one entry of a sketch with their places, a page at a time: what `get_sketch` lists
// only the first `OUTLINE_LIMITS.listed` of. For every kind of entry (the copies of a pattern too).
export const ENTRY_CURVES_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  entry: { kind: 'text', title: 'Entry', summary: 'The ID of an entry of `external` of the sketch.' },
  kind: { kind: 'choice', options: ['line', 'arc', 'circle', 'spline'], title: 'Kind', summary: 'Only the curves of this kind.', optional: true },
  from: { kind: 'number', title: 'From', summary: 'How many curves to pass over, for the next page.', optional: true, spec: { title: 'Curves to pass over', unit: 'count', integer: true, min: { value: 0 }, default: 0 } },
  max: { kind: 'number', title: 'Most curves', summary: 'The most curves to list; `total` counts them all.', optional: true, spec: { title: 'Most curves to list', unit: 'count', integer: true, min: { value: 1 }, max: { value: 500 }, default: 100 } },
} as const satisfies ArgSpecs;
// A curve as the query and `get_sketch` list it, at its place in the sketch (mm, rounded as
// positions are): a line by its ends, a circle by its centre and radius, an arc by its centre, its
// ends and its sweep (rad, counter-clockwise), a spline by where it runs (`through` and `box`, D70).
export type ListedCurve = { id: Id; regions: boolean } & (
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2; sweep: number }
  | { type: 'spline'; through: Vec2[]; box: [number, number, number, number] }
);
// - `status`: `unavailable` when the sketch did not evaluate, `noEntry` when it has no such entry;
//   `curves` is then empty.
// - `total`: the curves of the entry of the kind asked for; `from`: the number passed over.
export interface EntryCurvesResult {
  status: 'ok' | 'unavailable' | 'noEntry';
  total: number;
  from: number;
  curves: ListedCurve[];
}
export declare function listedCurve(curve: SketchCurve, geometry: { points: Record<Id, { x: number; y: number }>; radii: Record<Id, number> }): ListedCurve | undefined;

// ================================================================ 7. MCP

// The tool `import_outline` (packages/mcp/src/server.ts, beside `import_mesh`: it needs a disk).
// - Without `sketch` nothing is changed: the answer is the report, so the layers and the size of a
//   file are seen before it is placed.
// - With `sketch`: one command, one undo step. `addExternal` under `id` (by default the name of the
//   file reduced to an ID, numbered while taken), with the placement and the flag given; or, with
//   `replace`, `updateExternal` of the entry `id` with the new curves and nothing else unless given,
//   so the placement, the flag and their expressions stay.
// - The answer never holds the curves.
export interface ImportOutlineArgs {
  path: string;
  format?: OutlineFormat; // by default the extension of the path decides
  options?: Record<string, unknown>; // of the format: layers, unit, weld
  sketch?: Id;
  id?: Id;
  replace?: boolean;
  name?: string;
  x?: number | Expr;
  y?: number | Expr;
  turn?: number | Expr;
  anchor?: SketchOutline['anchor'];
  regions?: boolean;
}
// - `entry`: `<sketch>` and the ID, when something was placed; `ids`: how to name what was read
//   (the prefix and the counts: `board/l1` … `board/l4`).
// - `revision`, with `replace`: what stayed, came and went.
// - `sketch`: the brief of the sketch after the command, as `execute` gives it (status, valid,
//   regions, open ends), and `problems`: the features that are not ok after it.
// - `next`: in words, what to do now (extrude a region, constrain to an entity, project it).
export interface ImportOutlineAnswer {
  file: string;
  report: OutlineReport;
  entry?: { sketch: Id; id: Id };
  ids?: { prefix: string; lines: number; arcs: number; circles: number; splines: number };
  revision?: { kept: number; added: Id[]; removed: Id[] };
  sketch?: unknown;
  problems?: unknown;
  next: string;
}

// What `get_sketch` says of an outline, in the place of the generic row of an entry (which would
// spread the stored curves and list every entity): the fields with their expressions, without
// `curves`; what it holds; where it stands; the first curves. The rest is the query `entryCurves`.
export interface OutlineDetail {
  id: Id;
  type: 'outline';
  source: 'reference';
  name?: string;
  x: number | Expr;
  y: number | Expr;
  turn: number | Expr;
  anchor: SketchOutline['anchor'];
  regions: boolean;
  counts: Record<OutlineCurve['type'], number>;
  box: [number, number, number, number]; // in the sketch, as placed
  curves: ListedCurve[]; // at most OUTLINE_LIMITS.listed, in the order of the entry
  listed: number;
  total: number;
  more?: string; // when `listed` is under `total`: the query that gives the rest
}
// What `get_document` prints of an outline of more than `OUTLINE_LIMITS.listed` curves, in the place
// of its `curves` (`documentShown`, as for a stored mesh); `save_document` writes them.
export const OUTLINE_OMITTED = (count: number): string => `${count} curves; get_sketch lists the first ${OUTLINE_LIMITS.listed}, the query entryCurves the rest, and save_document writes them`;

// ================================================================ 8. the app

// The row of the kind (`REFERENCE_UI.outline`, packages/app/src/references/outline.ts): the form of
// 6c's rows for the three numbers and the anchor, 6b's flag and `inModel`, and one new member.
// - `file`: a button of the row that reads a file again into the entry (a hidden file input of
//   `accept`); `read` answers with the command to run and what to say, or with a refusal. Data and
//   one function over the engine: the panel reads the file and runs the command, and the row
//   imports nothing of the sketch mode.
export interface ReferenceUiAfter<R> {
  file?: {
    title: string;
    accept: string;
    read(name: string, bytes: Uint8Array, sketch: Id, entry: Id, ref: R): { command: CommandAfter; said: string } | { refused: string };
  };
}
// What the panel of a sketch holds while a file is being placed (`SketchState.outline`): the file
// as read once, the layers chosen, the unit and the weld, the anchor and the flag. *Place* sends
// `addExternal`; a change of a layer, the unit or the weld reads the bytes again.
export interface OutlineDraft {
  name: string;
  bytes: Uint8Array;
  format: OutlineFormat;
  layers: string[] | undefined;
  unit: string | undefined;
  weld: number | undefined;
  anchor: SketchOutline['anchor'];
  regions: boolean;
  outcome: OutlineOutcome;
}
export declare function outlineId(document: Document, file: string): Id; // `idFromFile` among the IDs of the document
