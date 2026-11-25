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
// 2. The stored value of an entry may be an outline's: the placement it was solved with and the
//    fingerprint of its curves (`StoredValue`). `Projected` stays positions. No position is stored
//    twice.
// 3. What the registry's spec gains: one ID asked of a reference kind (`entity`), the solver given
//    only the entities the constraints name (`narrow`), an update that may leave fields out
//    (`partial`). The rule of an update gets its third part. The solver adapter takes two fixed
//    points at one place for one end.
// 4. The import: a second catalog of formats, `OUTLINE_FORMATS` (`dxf`, `svg`), beside
//    `IMPORT_FORMATS`, and the function `importOutline` with what follows the reading for every
//    format: the local IDs, the weld (bounded), the limits, the report.
// 5. What 6f adds at the plug-in points of 6e and in the code of 6b and 6c: three texts and four
//    conditions.
// 6. A query `entryCurves`: the curves of one entry with their places, a page at a time.
// 7. MCP: the tool `import_outline`; what `get_sketch` and `get_document` say of an outline.
// 8. The app: the button of the sketch panel, the row of the kind.
// No command, no feature type, no face role, no issue code, no section, no schema step.
//
// Revised 2026-11-25 after the three reviews of the design (design.md, "Reviews"): the curve type
// is `ImportedCurve` (`ImportedCurve` is taken, sketch.ts), the weld is bounded, the options of the
// import are stored in the entry, the limits count more than curves.

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
//   first again as the last closes it (then at least 4). Neighbours at least the length tolerance
//   apart.
export type ImportedCurve =
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
// - `curves`: the curves by their local ID (letters, digits, underscores, at most 32, and no name
//   every object has, such as `constructor`), 1 to 2000, their splines with at most 2000 control
//   points together. The readers number them by kind in the order of the file: `l1`, `l2`, … lines,
//   `a1` … arcs, `c1` … circles, `s1` … splines; a curve the import left out (one that lay on
//   another, or had no extent) leaves its number unused.
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
// - `name`: for people, the name of the file. An empty one is no name.
// - `source`: what the file was read with (the format, the layers, the unit, the weld), written by
//   the import and repeated by a replacement, so that a revised file is read as the first was.
// - A revised file: `updateExternal` with the new `curves` (the tool import_outline with
//   `replace`). An entity keeps its ID when the file lists it at the same place among the curves of
//   its kind; nothing is matched by geometry (the tool says which IDs a file gave to other curves).
//   Refused while a constraint of the sketch names an entity the new curves do not have (the tool
//   takes `remove`, the constraints to remove with it); a mirror or pattern of the sketch, or a
//   later feature, that names one becomes a broken reference (copies are lost with a warning, a
//   projection keeps its last place, an extrusion has no profile).
// - The values never fail: an outline has no source that can go away.
export interface SketchOutline {
  type: 'outline';
  name?: string;
  source?: OutlineSource;
  curves: Record<Id, ImportedCurve>;
  x: number;
  y: number;
  turn: number;
  anchor: 'origin' | 'center';
  regions: boolean;
}
// What an outline was imported with: the key of the format and its options as they were given
// (`layers`, `unit`, `weld`; one left out was the format's default). Checked by its form only (the
// kind does not import the catalog of formats); a replacement checks it against the format again.
export interface OutlineSource {
  format: string;
  layers?: string[];
  unit?: string;
  weld?: number;
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
  source?: OutlineSource;
  curves: Record<Id, ImportedCurve>;
  x?: number | Expr;
  y?: number | Expr;
  turn?: number | Expr;
  anchor?: SketchOutline['anchor'];
  regions?: boolean;
}
// The input form of `updateExternal` of an outline: every field but `type` may be left out and
// then keeps what the entry has, an expression too (`partial` of the kind, section 3). `curves`
// given replaces the stored outline whole. So the flag is switched, or the outline moved, without
// sending the curves again: `{ type: 'outline', regions: false }`. A field given as `undefined` is
// a field left out. `name: ''` and `source: null` clear the two optional fields.
export type OutlineUpdate = Partial<Omit<OutlineInput, 'type' | 'source'>> & { type: 'outline'; source?: OutlineSource | null };

export type ExternalRefAfter = ExternalRef | SketchOutline;
// The two commands as they take an outline; every other command is the engine's.
export type CommandAfter =
  | Command
  | { type: 'addExternal'; sketch: Id; id: Id; ref: OutlineInput }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: OutlineUpdate }
  | { type: 'batch'; commands: CommandAfter[] };
export type SketchFeatureAfter = Omit<SketchFeature, 'external' | 'solved'> & { external: Record<Id, ExternalRefAfter>; solved: { inputs: string; external: Record<Id, StoredValue> } };

// ---------------------------------------------------------------- the numbers

// - `curves`: the most curves of one outline (an import beyond it is `tooLarge`, an entry beyond it
//   an invalid command). Measured (design.md, C1, F1): 2000 lines and circles that form regions cost
//   120 ms at the first evaluation and 100 ms at every change of their sketch, and 140,000
//   characters of the document.
// - `control`: the most control points of all the splines of one outline together. A spline costs
//   by its samples, not by its count (J12: 2000 splines of 4 points, 420 ms a change; 500, 67 ms).
// - `splinePoints`: of one spline, the limit of a spline of the sketch (D70).
// - `localId`: the most characters of a local ID.
// - `note`: from this many curves on the report of an import says what a change in the sketch costs.
// - `arc`: how far the two ends of a stored arc may lie off one radius, in mm per mm of the
//   largest coordinate of the arc (at least 1): 1e-9 mm for a board, 1e-4 for coordinates of 1e5
//   (6b's `ARC_STORED_TOLERANCE * scale`). The readers leave under 1e-12; the placement then puts
//   the end on the circle of the start (6b's `exactArc`).
// - `listed`: how many curves `get_sketch` lists of one outline, and above how many `get_document`
//   leaves the curves out.
// - `characters`, `read`, `readControl`: what a reader takes before it refuses with `tooLarge`,
//   checked while it reads and before the weld: the characters of the file, the curves read from
//   the layers asked for (four outlines' worth: the weld and the duplicates may bring a file under
//   the limit), the control points of the splines read.
export const OUTLINE_LIMITS = { curves: 2000, control: 2000, splinePoints: 64, localId: 32, note: 500, arc: 1e-9, listed: 50, characters: 8_000_000, read: 8000, readControl: 8000 } as const;
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
// What `solved.external` holds per entry (`SolveStamp.external`): positions, or an outline's
// placement. `Projected` itself stays the four forms of positions, so the code of 6b that holds a
// `Projected` (`ReferenceValues.sketch`, `projectSketch`) never meets a form it cannot have (the
// review, fable 11). `storedValue` (the reader, in the place of `projected`) reads both.
export type StoredValue = Projected | PlacedOutline;
export declare function storedValue(value: unknown, what: string): StoredValue;

// A point p of the file stands at `at + R(turn) · p`. With the anchor `center`, `at` is
// `(x, y) − R(turn) · c` for the centre `c` of the box of the curves (`outlineBox`): the outline
// turns about its centre.
export declare function placeOutline(ref: SketchOutline): PlacedOutline;
// The box of a list of curves: the ends of a line, a circle whole, an arc with the points of its
// circle furthest along x and y that it passes, a spline by the box of its curve (`splineBox`).
// Undefined for no curve.
export declare function outlineBox(curves: Iterable<ImportedCurve>): { min: Vec2; max: Vec2 } | undefined;
// The geometry of an entry from its value: every curve placed, an arc with its end put on the
// circle of its start; `regions` every curve, or none. A turn of exactly 0 moves no digit of the
// file but by the addition of `at`. Kept per entry object (a `WeakMap` by `ref`, with the ID and
// the value it was made for), so a drag in the sketch does not place the outline again and two
// entries that share one object of curves do not push each other out (the review, agy 10).
export declare function outlineGeometry(id: Id, ref: SketchOutline, value: PlacedOutline): EntryGeometry;
// Every entity of an entry in the order of its curves, a curve before its points. A closed spline
// lists its first point once.
export declare function outlineEntities(id: Id, ref: SketchOutline): Record<Id, EntityKind>;
// One ID under an entry, with one look-up: `<entry>/<local>` is the kind of that curve,
// `<entry>/<local>/<name>` a point when the curve has a point of that name. The curve is looked up
// as an own property (`Object.hasOwn`), never through the prototype.
export declare function outlineEntity(id: Id, ref: SketchOutline, entry: Id): EntityKind | undefined;

// ================================================================ 3. the registry

// What a reference kind may say beyond 6b's spec (references/spec.ts). All three are optional, and
// the kinds of today say none of them.
// - `entity`: what one ID under the entry is, with one look-up, as the derived half has since 6c.
//   `entityOf` asks it when it is there, and `entities` (a listing) otherwise: an outline of 2000
//   curves has 5000 entities, which every validation of a constraint would otherwise list.
// - `narrow`: the solver gets of the entry only the entities a constraint of the sketch names (a
//   curve with its points and its radius; a point alone), as it gets the axes of the origin only
//   when one is named (D71). Everything else of the entry is fixed anyway and no equation reads it.
//   Measured: with a whole outline of 2000 curves in its input the adapter runs out of memory (C4).
//   The points AND the radii the solver did not get are put into the geometry of the step after
//   it, as the far points of the axes are, on each of its three paths: solved with a new stamp,
//   the stamp kept (the geometry is then the input), and a failed solve. The merged records are
//   built in one order (own geometry, then the entries by ID), whatever is named.
// - `partial`: `updateExternal` may leave fields of the entry out; they keep what the entry has.
//   Only when the command's `type` is the type of the entry it updates. The command's entry,
//   checked for its own fields and with its `undefined` fields dropped, is laid over
//   `entryInput(sketch, id)` BEFORE the loop of `updateExternal` that keeps unchanged expressions
//   (document.ts), so a field left out arrives there as the expression the entry has, is found
//   unchanged, and is not evaluated again: an expression that is in error today stays.
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
// model. `compute` never fails. `keepsValue`: the stored value is kept when the update changes
// neither the place (`x`, `y`, `turn`, `anchor`) nor the object of `curves` (the flag, the name, the
// source), and dropped otherwise, as 6b's kind does: a document saved while its sketch is in
// conflict then holds no value of a placement the entry no longer has (the review, agy 8).
export declare const outline: ReferenceKindAfter<SketchOutline, PlacedOutline>;

// The rule of an update, with its third part (6a's design, "The commands"; the slot in
// `updateProblem` of references/index.ts says "refused by the package that can reach it, 6f"):
// an update under which an entity that a constraint of the sketch names goes away is refused,
// naming the constraints and the entities. For every kind; only an outline can reach it (an edge
// and a projection keep their entities, no constraint names a copy). Measured before the rule (B5):
// the update is accepted, and the document it leaves does not load. It asks `entity` of the new
// entry for each operand under `<id>/` of each constraint (driving or reference), and lists nothing.
// Not covered, on purpose: an operand of a mirror or pattern of the sketch (its axis, direction or
// centre). That entry loses its copies with the warning `brokenCopies` and the document loads (the
// review, fable 6, measured there).
export declare function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRefAfter, after: ExternalRefAfter): string | undefined;
export const ENTITY_TAKEN = (entry: Id, gone: { entity: Id; constraints: Id[] }[]): string =>
  `the update takes away ${gone.map((g) => `"${g.entity}" (named by ${g.constraints.join(', ')})`).join(', ')} of "${entry}": remove ${gone.length === 1 && gone[0].constraints.length === 1 ? 'that constraint' : 'those constraints'} in the same batch before it (the tool import_outline: \`remove\`), or keep the ${gone.length === 1 ? 'curve' : 'curves'}`;

// The solver adapter (packages/solver-planegcs, `commonEnd`): two fixed points within this distance
// are one end, as two points joined by a coincident are. The points of an outline belong to their
// curves, so at a corner the end of a line and the start of an arc are two IDs at one place; an own
// line held on one of them and tangent to the other curve then gets the form of a tangency at a
// common end. Without it the general form is solved at its double root (J10: the line 4e-5 mm off
// the tangent, and a drag along it does not move).
export const FIXED_JOIN = 1e-6;

// The texts of the validator of the kind.
export const OUTLINE_REFUSALS = {
  count: (what: string, n: number): string => `${what}.curves: an outline has 1 to ${OUTLINE_LIMITS.curves} curves, not ${n}`,
  localId: (what: string, key: string): string => `${what}.curves: "${key}" is no local ID of a curve (letters, digits and underscores, at most ${OUTLINE_LIMITS.localId}, and no name every object has)`,
  control: (what: string, n: number): string => `${what}.curves: the splines of an outline have at most ${OUTLINE_LIMITS.control} control points together, not ${n}`,
  splinePoints: (what: string): string => `${what}: a spline has 3 to ${OUTLINE_LIMITS.splinePoints} control points, a closed one at least 4, each at least the length tolerance from the next`,
  expression: (what: string): string => `${what}: a position of a stored outline is a number; an expression goes into x, y or turn of the entry`,
  noLength: (what: string): string => `${what}: the line has no length`,
  noRadius: (what: string): string => `${what}: the radius is under the length tolerance`,
  arcEnds: (what: string, off: number, most: number): string => `${what}: the start and the end of the arc are ${off} mm off one radius about its centre (at most ${most}); move the centre onto the bisector of the two`,
  arcWhole: (what: string): string => `${what}: the start and the end of the arc are one place; a whole turn is a circle`,
  missingCurves: (what: string): string => `${what}.curves: the curves of the outline are expected (the tool import_outline reads them from a file)`,
};

// ================================================================ 4. the import

// What a format reads of a file: its curves in millimetres in the order of the file, each with the
// layer it is on, and what it has to say about the file.
// - `unit`: what one unit of the file was taken as (`mm`, `in`, … or `0.5 mm per unit` for an SVG);
//   `unitFrom`: where that came from (`option`, `file`, or `default`: the file does not say).
// - `layers`: every layer of the file with the number of its entities, read or not, by type.
// - `skipped`: what was left out of the layers asked for, by reason, with the count: a complete
//   entity of a type the format does not read (`ELLIPSE`, `TEXT`, `INSERT`, `text`, `use`), or one
//   it reads only in part (`SPLINE (rational)`, `SPLINE (periodic or unclamped)`, `ARC (tilted
//   extrusion)`, `path (A with two radii)`, `circle (uneven transform)`, `rect (length in em)`).
// - `notes`: what the reader found worth saying of the file (no unit in it, `$MEASUREMENT` 0
//   without `$INSUNITS`, entities off z = 0).
// What is not a complete file of the format is not read in part: the reader throws `unreadable`
// with the place (a group code without its value, no `EOF`, a section or a polyline that does not
// end, a tag that does not close, path data that does not parse, a number that is none).
export interface ReadOutline {
  curves: { curve: ImportedCurve; layer: string }[];
  about: { unit: string; unitFrom: 'option' | 'file' | 'default'; layers: Record<string, Record<string, number>>; skipped: Record<string, number>; notes: string[] };
}
// An entry of the catalog: the shape of an import format of D55 (import/spec.ts) with another
// result; `ImportFormatSpec<S, R = ReadTriangles>` gets the second parameter. `read` throws
// `ImportFailure` (`unreadable`, `tooLarge`) as a mesh format does; `tooLarge` as soon as it has
// read more than `OUTLINE_LIMITS.characters`, `.read` or `.readControl`, before any weld.
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
    summary: 'An open end of a curve is put on an end of another curve this close, so that an outline written with few digits closes. No end moves further than this and ends that meet already are left alone; the report says how many ends were moved and how far, what could not be closed within it, and which ends stayed open with another end near.',
    optional: true,
    spec: { title: 'Weld tolerance', unit: 'mm', min: { value: 0 }, max: { value: 1 }, default: 0.01 },
  },
} as const satisfies ArgSpecs;
export const DXF_OPTIONS = {
  ...SHARED,
  unit: { kind: 'choice', options: ['mm', 'cm', 'm', 'in', 'ft', 'mil', 'um', 'dm'], title: 'Unit of the file', summary: 'What one unit of the file is. Without it the header says (`$INSUNITS`: inches, feet, millimetres, centimetres, metres, microinches, mils, yards, microns, decimetres; any other value needs this option); a file that does not say is read in millimetres, and the report says so.', optional: true },
} as const satisfies ArgSpecs;
export const SVG_OPTIONS = {
  ...SHARED,
  unit: { kind: 'choice', options: ['mm', 'cm', 'in', 'pt', 'px'], title: 'User unit', summary: 'What one user unit of the drawing is. Without it `width`, `height` and `viewBox` of the root say; a root without them is read at 96 units per inch (px). A length of a shape written with a unit (`r="10mm"`) is user units at 96 per inch, as SVG says.', optional: true },
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
// - `welded`: ends moved onto another end; `moved`: the furthest any end was moved, mm, measured
//   from where the file had it: never more than the weld.
// - `shifted`: the furthest the centre of an arc was moved, mm: never more than the weld.
// - `closed`: arcs of nearly a whole turn read as circles, and splines closed onto their start.
// - `dropped`: curves left out because they have no extent; `duplicates`: curves left out because
//   they lie on an earlier curve of the file. Their local IDs stay unused.
// - `blocked`: welds not made, because the end or its arc would have gone further than the weld
//   from where the file had it (the third end of a chain, an arc of a large radius and a short
//   chord). Those ends are open and in `gaps`.
// - `open`: ends that are the end of no other curve; `gaps`: at most 20 of them that have another
//   end within a hundred weld tolerances, the nearest first, with the distance.
// - `bounds`: mm, in the coordinates of the file.
// - `notes`: in words, for the caller to read: the reader's (`about.notes`), then the gaps and the
//   weld that would close them, what was blocked, bounds under 1 mm or over 10 m ("is the unit
//   right?"), the cost of many curves or of many splines, curves that cross or lie on each other
//   when the caller placed the outline and its sketch says so.
export interface OutlineReport {
  format: OutlineFormat;
  source: OutlineSource; // what the entry stores, for the next replacement
  about: ReadOutline['about'];
  curves: number;
  byKind: Record<ImportedCurve['type'], number>;
  welded: number;
  moved: number;
  shifted: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  open: number;
  gaps: { at: Vec2; distance: number }[];
  bounds: { min: Vec2; max: Vec2 };
  notes: string[];
}
// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a whole file of the format (a binary DXF, a file cut short, a
//   malformed entity or path among them); the message has the place.
// - `empty`: the file, or the layers asked for, hold no curve the format reads; the message lists
//   the layers of the file and what was skipped.
// - `tooLarge`: more characters, curves or control points than a reader takes, or after the weld
//   more than an outline holds.
export type OutlineOutcome =
  | { ok: true; curves: Record<Id, ImportedCurve>; report: OutlineReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'empty' | 'tooLarge'; message: string; arg?: (string | number)[]; about?: ReadOutline['about'] } };

// Reads a file into the curves of an outline. A function without a state, as `importMesh`: the
// curves enter a document by `addExternal` or `updateExternal`.
// 1. The options are checked against the description of the format and the format reads the bytes
//    (its limits apply while it reads).
// 2. The local IDs: by kind, in the order of the file, from 1 (`outlineIds`). Before the weld, so
//    that what the weld leaves out leaves a gap and renames nothing, and the IDs do not depend on
//    the weld. (An arc the weld reads as a circle is numbered among the circles, at its place.)
// 3. The weld (`weldOutline`).
// 4. `empty`, and the limits of an outline (`tooLarge`).
// 5. The report.
// The same bytes and options give the same curves under the same IDs.
export declare function importOutline<F extends OutlineFormat>(format: F, bytes: Uint8Array, options?: OutlineOptions<F>): OutlineOutcome;

// The weld (design.md, "The weld"). Bounded: nothing is merged transitively, no end moves further
// than `tolerance` from where the file had it, and no arc's centre or radius changes by more.
// 1. An arc of more than a half turn whose own two ends are within the tolerance, with no end of
//    another curve near them, becomes a circle; an open spline of four points or more likewise is
//    closed onto its start. The two ends of one curve are never welded otherwise.
// 2. An end is met when an end of another curve is within 1e-6 mm of it (the join of the sketch).
//    Met ends never move: a file whose ends meet is not changed, however short its curves.
// 3. The pairs of an open end and an end of another curve within the tolerance, the nearest first
//    (then by the order of the file). Of two open ends one moves onto the other: an end of a line
//    or a spline before an end of an arc, otherwise the later in the file. An open end moves onto
//    an end that is settled already only when that keeps it within the tolerance of where the file
//    had it; otherwise the weld is counted in `blocked` and the end stays open.
// 4. An arc whose end moves gets its centre put on the bisector of its chord, at the nearest point.
//    The move is made only when, against the arc of the file, the centre and the radius change by
//    no more than the tolerance and the sweep by less than a half turn; otherwise the other end of
//    the pair is tried, and then the weld is blocked. An arc whose ends stayed keeps its digits.
// 5. A line or an arc whose two ends are then one place is left out (`dropped`); a spline end is
//    not moved onto its own neighbour point. A curve that lies on an earlier one (the same places
//    within 1e-6 mm; a line or a spline either way round) is left out (`duplicates`).
// With a tolerance of 0 only step 5 runs. The result is aligned with the input: undefined where a
// curve was left out.
export declare function weldOutline(curves: readonly ImportedCurve[], tolerance: number): { curves: (ImportedCurve | undefined)[]; welded: number; moved: number; shifted: number; closed: number; dropped: number; duplicates: number; blocked: number; open: number; gaps: OutlineReport['gaps'] };
export declare function outlineIds(curves: readonly ImportedCurve[]): Id[];

// What a revised outline does to the entities of the one before it, for the answer of a tool and
// the status line of the app: the local IDs that stay, come and go, and `renamed`: an ID whose
// curve is, in the new file, where the old file had the curve of another ID of its kind (two holes
// listed the other way round, J11). Found by the places rounded to 1e-6 mm: it finds a swap of
// curves that did not move, not a renumbering of curves that did.
export interface OutlineRevision {
  kept: number;
  added: Id[];
  removed: Id[];
  renamed: { id: Id; was: Id }[];
}
export declare function outlineRevision(before: Record<Id, ImportedCurve>, after: Record<Id, ImportedCurve>): OutlineRevision;

// What the reader of DXF takes (design.md, "The readers"), as data for its tests and its summary.
export const DXF_READS = {
  entities: ['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'],
  // in the coordinates of their own plane (mirrored when 230 is negative); LINE and SPLINE are in
  // world coordinates and are never mirrored
  ocs: ['ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE'],
  insunits: { 0: 'mm', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 8: 'uin', 9: 'mil', 10: 'yd', 13: 'um', 14: 'dm' },
  unitInMm: { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, uin: 2.54e-5, mil: 0.0254, yd: 914.4, um: 0.001, dm: 100 },
  knots: 1e-9, // of the span of the knots: closer knots are one; the ends are clamped within it
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
// Two conditions more in 6e's code (the review, agy 11, read in the code):
// - `contactFix` asks for a flagged curve before it asks for a spline, so a spline of an outline
//   gets this reason and not "move its control points", which nobody can.
// - `reachOf` and `extendSpec` find a spline in the way by the shape of the curve
//   (`world.curves.get(C)?.shape.type`), not by `sketch.curves[C]`, which knows own curves only.
// And one in the collection of names (`namedOutside`): the texts of `external` are read through
// the references of each kind (`refs`), not by walking the entries, so the curves of an outline
// are not walked at every cut (the review, agy 13).

// 6c's stage (`positionJoins`, references/derive.ts): an end of a curve that is not own and forms
// regions is open when no other curve ends there. A closed spline of an outline ends on itself
// (its two ends are one point entity), which the stage counts as open (J9: a valid region and
// `openEnds` 1 with distance 0). The condition: a curve whose two ends are one place is closed and
// has no open end.

// 6b (references/projection.ts): `isSplineOf` answers for a spline of an outline as well, so the
// refusal of a projection of one says 6d's text, not "is a spline, expected line".
export declare function isSplineOf(sketch: SketchFeatureAfter, entity: Id): boolean;

// 6c and the app (packages/mcp/src/tools.ts, `openEndAdvice`): the cure of an open end of an outline.
export const OUTLINE_OPEN_END = 'Curves of an imported outline close where their ends are within 1e-6 mm: import the file again with a larger `weld` (the report of the import lists the gaps), or end an own curve at the open end';

// features/sketch.ts, `ruleProblem`: the points of a curve of an entry are the point entities under
// `<curve>/`, for every kind (an edge `e/a`, a curve of an outline `o/l1/a`), so the own rule of a
// constraint (a point on its own curve, a tangency of curves that do not meet) reads them. Asked
// of `entityOf` by the names a curve of that kind can have (`a`, `b`, `center`, `start`, `end`),
// five look-ups, never a listing of the entry (the review, agy 12).
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
// ends and its sweep (rad, counter-clockwise), a spline by where it runs (`through` and `box`, D70)
// and by its control points in order (`control`: the point `<id>/<i>` stands at `control[i]`; they
// are entities a constraint or a projection may name, and `through` is not them).
export type ListedCurve = { id: Id; regions: boolean } & (
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; start: Vec2; end: Vec2; sweep: number }
  | { type: 'spline'; through: Vec2[]; box: [number, number, number, number]; control: Vec2[]; closed: boolean }
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
// The server reads the file and runs `importOutline`; what follows runs where the engine is, by one
// function of tools.ts (`outlineInto`: the server's own engine, or the app's over the bridge), so
// both give the same answer and the revision is computed from the document, not from an answer
// of `get_sketch` or `get_document`, which leave curves out.
// - Without `sketch` nothing is changed: the answer is the report, so the layers and the size of a
//   file are seen before it is placed.
// - With `sketch`: one command or one batch, one undo step. `addExternal` under `id` (by default
//   the name of the file reduced to an ID, numbered while taken), with the placement and the flag
//   given, and `source` as the file was read.
// - With `replace`: `id` is required. The options left out are those the entry stores (`source`),
//   so the revised file is read with the layers, the unit and the weld of the first; `format` too.
//   Then `updateExternal` of the entry with the new curves and the new `source`, and nothing else
//   unless given, so the placement, the flag and their expressions stay.
// - `remove`, with `replace`: IDs of constraints of the sketch to remove in the same batch, before
//   the update: the way past the rule of an update. A refusal changes nothing, the constraints
//   stay; its message names the constraints, and the caller repeats the call with them.
// - The answer never holds the curves. A refusal of the command still carries the report.
export interface ImportOutlineArgs {
  path: string;
  format?: OutlineFormat; // by default the extension of the path decides; with `replace`, the entry's
  options?: Record<string, unknown>; // of the format: layers, unit, weld
  sketch?: Id;
  id?: Id;
  replace?: boolean;
  remove?: Id[];
  name?: string;
  x?: number | Expr;
  y?: number | Expr;
  turn?: number | Expr;
  anchor?: SketchOutline['anchor'];
  regions?: boolean;
}
// - `entry`: `<sketch>` and the ID, when something was placed; `ids`: how to name what was read
//   (the prefix and the counts: `board/l1` … `board/l4`).
// - `revision`, with `replace`: what stayed, came and went, and what a swap renamed.
// - `refused`: the message of the command that was refused; nothing was changed.
// - `sketch`: the brief of the sketch after the command, as `execute` gives it (status, valid,
//   regions, open ends), and `problems`: the features that are not ok after it (a mirror that lost
//   its axis, a later projection that lost its entity, an extrusion without its region).
// - `next`: in words, what to do now (extrude a region, constrain to an entity, project it).
export interface ImportOutlineAnswer {
  file: string;
  report: OutlineReport;
  entry?: { sketch: Id; id: Id };
  ids?: { prefix: string; lines: number; arcs: number; circles: number; splines: number };
  revision?: OutlineRevision;
  refused?: string;
  sketch?: unknown;
  problems?: unknown;
  next: string;
}
// What runs where the engine is: the curves as read, and the arguments of the tool but the path.
export declare function outlineInto(engine: { execute(command: CommandAfter): unknown }, curves: Record<Id, ImportedCurve>, report: OutlineReport, args: Omit<ImportOutlineArgs, 'path' | 'options' | 'format'>): ImportOutlineAnswer;

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
  counts: Record<ImportedCurve['type'], number>;
  box: [number, number, number, number]; // in the sketch, as placed
  curves: ListedCurve[]; // at most OUTLINE_LIMITS.listed, in the order of the entry
  listed: number;
  total: number;
  more?: string; // when `listed` is under `total`: the query that gives the rest
}
// What `get_document` prints of an outline of more than `OUTLINE_LIMITS.listed` curves, in the place
// of its `curves`, on each of its paths: the whole document (`documentShown`), one feature
// (`get_document { feature }`), and a feature of a stored document. One helper for the three (the
// reviews, fable 4 and codex 14). `save_document` writes the curves.
export const OUTLINE_OMITTED = (count: number): string => `${count} curves; get_sketch lists the first ${OUTLINE_LIMITS.listed}, the query entryCurves the rest, and save_document writes them`;

// The rows `regions` of `get_sketch` (`regionRows`), capped: at most `regions` rows and a count of
// the rest; an outer loop of more than `loop` IDs is printed as its count, its first `loop` IDs
// and the entries its IDs are under, in the place of `ref`. Measured before the cap (the review,
// fable 4): 33,841 characters of `regions` for an outline of 1000 curves. A region is still named
// to a command by its whole loop, which the query `regions` of the sketch gives.
export const SKETCH_SHOWN = { regions: 50, loop: 20 } as const;
export type ShownLoop = { outerLoop: Id[] } | { count: number; first: Id[]; entries: Id[] };

// ================================================================ 8. the app

// The row of the kind (`REFERENCE_UI.outline`, packages/app/src/references/outline.ts): the form of
// 6c's rows for the three numbers and the anchor, 6b's flag and `inModel`, and one new member.
// - `file`: a button of the row that opens the draft of the panel on this entry (a hidden file
//   input of `accept`), with the options the entry stores (`source`). Data only: the panel reads the
//   file and runs the command, and the row imports nothing of the sketch mode.
export interface ReferenceUiAfter<R> {
  file?: {
    title: string;
    accept: string;
    source(ref: R): OutlineSource | undefined;
  };
}
// What the panel of a sketch holds while a file is being placed or replaced (`SketchState.outline`):
// the file as read once, the layers chosen, the unit and the weld, the anchor and the flag.
// - `replaces`: the entry a replacement is for. The draft then starts from the options that entry
//   stores, shows the revision (kept, added, removed, renamed) and the constraints the rule of an
//   update names, with a checkbox to remove them, and *Replace* sends one batch. An entry without
//   `source` (written by hand, or by a command) starts from the defaults and says so.
// *Place* sends `addExternal`; a change of a layer, the unit or the weld reads the bytes again.
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
  replaces?: { entry: Id; revision: OutlineRevision; held: { entity: Id; constraints: Id[] }[]; remove: boolean };
}
// The pickers of the app (packages/app/src/references/index.ts): `PICKER_LIMIT` (100) applies to
// every entry with more entities than that, not to derived entries only; the note of what was left
// out says "entities" for an outline. An entity beyond the limit is picked in the view.
export declare function outlineId(document: Document, file: string): Id; // `idFromFile` among the IDs of the document
