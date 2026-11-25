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
// 6. Two queries: `entryCurves`, the curves of one entry with their places, and `sketchRegions`,
//    the regions of a sketch with their whole loops, each a page at a time.
// 7. MCP: the tool `import_outline`; what `get_sketch` and `get_document` say of an outline.
// 8. The app: the button of the sketch panel, the row of the kind.
// No command, no feature type, no face role, no issue code, no section, no schema step.
//
// Revised 2026-11-25 after the three reviews of the design (design.md, "Reviews"): the curve type
// is `ImportedCurve` (`OutlineCurve` is taken, sketch.ts), the weld is bounded, the options of the
// import are stored in the entry, the limits count more than curves.
// Revised again the same day after the second round (design.md, "Reviews"): the IDs are the
// reader's and nothing after renames a curve, an arc gives way to an arc only, the limits are
// enforced where they are named, the query `sketchRegions`, the bridge of the tool, the entry's
// field `readWith` (it was `source`, the word of `get_sketch` for the kind of an entry).

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
//   `OUTLINE_LIMITS.arc` by the size of its coordinates, and never more than `.arcMost` mm; `start`
//   equal to `end` is no arc (a whole turn is a `circle`).
// - `spline`: the control points of a spline of the sketch (CurveShape `spline`, D70): 3 to 64, the
//   first again as the last closes it (then at least 4). Control points may stand at one place (a
//   node without a handle); the spline as a whole has an extent.
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
//   points together. The readers number them by the kind the file gave and its order: `l1`, `l2`, …
//   lines, `a1` … arcs, `c1` … circles, `s1` … splines. Nothing after the reader renames a curve: one
//   the import left out (it lay on another, or had no extent) leaves its number unused, and an arc
//   of nearly a whole turn that was read as a circle keeps the ID of an arc (`a3` is then a circle:
//   the `type` of the curve says what it is, the letter what the file had).
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
// - `readWith`: what the file was read with (the format, the layers, the unit, the weld), written by
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
  readWith?: OutlineReadWith;
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
export interface OutlineReadWith {
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
  readWith?: OutlineReadWith;
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
// a field left out. `name: ''` and `readWith: null` clear the two optional fields.
export type OutlineUpdate = Partial<Omit<OutlineInput, 'type' | 'readWith'>> & { type: 'outline'; readWith?: OutlineReadWith | null };

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
// - `arc`, `arcMost`: how far the two ends of a stored arc may lie off one radius: `arc` mm per mm
//   of the largest coordinate of the arc (at least 1), and never more than `arcMost` mm, a tenth of
//   the tolerance of a join. The placement puts the end on the circle of the start (6b's
//   `exactArc`), which moves it by that difference: bounded by the size of the coordinates alone
//   (6b's `ARC_STORED_TOLERANCE * scale`, 1e-4 mm for coordinates of 1e5), an end of an outline far
//   from the origin of its file left its join (the third review: L2). The readers leave under
//   1e-12 near the origin and the last bit of a coordinate far from it (1.5e-8 mm at 100 km).
// - `listed`, `listedPoints`: how many curves `get_sketch` lists of one outline (and above how many
//   `get_document` leaves the curves out), and how many positions those curves may hold together:
//   a spline of 64 control points is 64 positions, so curves alone do not bound an answer.
// - `bytes`, `read`, `readControl`, `readSpline`: what a reader takes before it refuses with
//   `tooLarge`, checked while it reads and before the weld: the bytes of the file (one number for
//   the server's check of the size, for the base64 text of the bridge before it is decoded, and
//   for the text a reader gets, which has no more characters than the file has bytes); the curves read from the layers asked for (four outlines' worth: the
//   weld and the duplicates may bring a file under the limit); the control points of all the spline
//   curves it has made so far (a spline kept whole counts its control points, a Bezier piece its
//   three or four); the control points of one DXF `SPLINE` (its conversion is quadratic: 2000 take
//   0.2 s, 8000 would take 4 s).
export const OUTLINE_LIMITS = { curves: 2000, control: 2000, splinePoints: 64, localId: 32, note: 500, arc: 1e-9, arcMost: 1e-7, listed: 50, listedPoints: 500, bytes: 8_000_000, read: 8000, readControl: 8000, readSpline: 2000 } as const;
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
// neither the place (`x`, `y`, `turn`, `anchor`) nor the object of `curves` (the flag, the name,
// `readWith`), and dropped otherwise, as 6b's kind does: a document saved while its sketch is in
// conflict then holds no value of a placement the entry no longer has (the review, agy 8).
export declare const outline: ReferenceKindAfter<SketchOutline, PlacedOutline>;

// The rule of an update, with its third part (6a's design, "The commands"; the slot in
// `updateProblem` of references/index.ts says "refused by the package that can reach it, 6f"):
// an update under which an entity that a constraint of the sketch names goes away is refused,
// naming the constraints and the entities. For every kind; only an outline can reach it (an edge
// and a projection keep their entities, no constraint names a copy). Measured before the rule (B5):
// the update is accepted, and the document it leaves does not load. It asks `entity` of the new
// entry for each operand of each constraint (driving or reference) that is the entry's ID or
// under it (`operand === id || operand.startsWith(id + '/')`), and lists nothing.
// Not covered, on purpose: an operand of a mirror or pattern of the sketch (its axis, direction or
// centre). That entry loses its copies with the warning `brokenCopies` and the document loads (the
// review, fable 6, measured there).
export declare function updateProblem(sketch: SketchFeature, id: Id, before: ExternalRefAfter, after: ExternalRefAfter): string | undefined;
export const ENTITY_TAKEN = (entry: Id, gone: { entity: Id; constraints: Id[] }[]): string =>
  `the update takes away ${gone.map((g) => `"${g.entity}" (named by ${g.constraints.join(', ')})`).join(', ')} of "${entry}": remove ${gone.length === 1 && gone[0].constraints.length === 1 ? 'that constraint' : 'those constraints'} in the same batch before it (the tool import_outline: \`remove\`), or keep the ${gone.length === 1 ? 'curve' : 'curves'}`;

// The solver adapter (packages/solver-planegcs, `commonEnd`). Two ends are one end when they are
// one ID, or two fixed points at one place (`sameEnd`): at most `FIXED_JOIN` mm apart, and, when
// the arc of the tangency is fixed too, within `FIXED_JOIN` of its radius. A common end of a line
// and an arc is then: an end of the line and an end of the arc that are one end, or one coincident
// whose two operands are one end with an end of the line and one end with an end of the arc. So
// the rule reads the same from either side: an own line held on the outline's point of the other
// curve, an own arc held on it, an own line that starts at `origin` where a fixed arc starts. A
// chain of two coincidents is not read, as today (D52).
// - Measured (J10, K12): without it the general form is solved at its double root (an own line
//   3.7e-5 mm off the tangent, stiff under a drag; an own arc 1e-7 off, and 1e-3 from a rougher
//   estimate; a fixed point 5e-7 inside the start of an arc of radius 3: not solved at all).
// - By the radius when the arc is fixed, so that a point that is near in millimetres and far by
//   the size of the arc is not taken (the review, codex 3: an arc of radius 1e-4 and a point 5e-7
//   inside its start; K12: as today). Whenever the adapter takes the common end, the analysis
//   does too: the point is within `SHARED` (1e-6) of the size of the curves from the circle, and
//   held on it.
// - By `FIXED_JOIN` mm alone when the arc is own: its radius is a variable, read from the estimate,
//   and a rule that measured by it changed the form of the tangency while the arc was dragged
//   through a radius of 0.8 (the third review, fable 7). The two fixed points are both held and at
//   most 1e-6 mm apart, so the common-end form is off the exact tangent by no more than that,
//   whatever the radius becomes.
// - So the function reads positions, and a radius, of fixed entities only: numbers of the input,
//   never a variable of the estimate. It gets the points, the radius of the arc when the arc is
//   fixed, and the fixed set.
export const FIXED_JOIN = 1e-6;
export declare function sameEnd(p: Id, q: Id, arc: { fixed: true; radius: number } | { fixed: false }, points: Record<Id, { x: number; y: number }>, fixed: ReadonlySet<Id>): boolean;

// The texts of the validator of the kind.
export const OUTLINE_REFUSALS = {
  count: (what: string, n: number): string => `${what}.curves: an outline has 1 to ${OUTLINE_LIMITS.curves} curves, not ${n}`,
  localId: (what: string, key: string): string => `${what}.curves: "${key}" is no local ID of a curve (letters, digits and underscores, at most ${OUTLINE_LIMITS.localId}, and no name every object has)`,
  control: (what: string, n: number): string => `${what}.curves: the splines of an outline have at most ${OUTLINE_LIMITS.control} control points together, not ${n}`,
  splinePoints: (what: string): string => `${what}: a spline has 3 to ${OUTLINE_LIMITS.splinePoints} control points, a closed one at least 4`,
  splineEnds: (what: string): string => `${what}: the ends of the spline are within the length tolerance and not one place: close it by its first point again`,
  noExtent: (what: string): string => `${what}: the spline has no extent`,
  points: (what: string): string => `${what}.points: a list of positions is expected`,
  expression: (what: string): string => `${what}: a position of a stored outline is a number; an expression goes into x, y or turn of the entry`,
  noLength: (what: string): string => `${what}: the line has no length`,
  noRadius: (what: string): string => `${what}: the radius is under the length tolerance`,
  arcEnds: (what: string, off: number, most: number): string => `${what}: the start and the end of the arc are ${off} mm off one radius about its centre (at most ${most}); move the centre onto the bisector of the two`,
  arcWhole: (what: string): string => `${what}: the start and the end of the arc are one place; a whole turn is a circle`,
  missingCurves: (what: string): string => `${what}.curves: the curves of the outline are expected (the tool import_outline reads them from a file)`,
};

// The property the import is held to, tested over generated files: whatever `importOutline`
// answers is accepted by the validator of the kind (`curveProblem` is its rule for one curve). The
// validator's copy is frozen (the record, each curve, each position), so an object it remembers
// as its own cannot be written into and sent back unchecked.
export declare function curveProblem(curve: ImportedCurve, what: string): string | undefined;

// The rule of an update when the kind of either entry, the one before or the one after, answers
// `entity` (an outline; an edge updated into an outline, or back), parts 2 and 3 as one pass
// over the constraints of the sketch, with no listing of either entry: for each operand that is
// the entry's ID or under it (`operand === id || operand.startsWith(id + '/')`), the kind before
// and the kind after. Gone: part 3 (`ENTITY_TAKEN`). Another kind: part 2, with this text. An
// entity no constraint names may change its kind (an arc of nearly a whole turn that one revision
// reads as a circle and the next as an arc): what names it from outside its sketch breaks aloud at
// the recompute, as for an entity that went. The kinds without `entity` keep part 2 as it is.
export const ENTITY_KIND_CHANGED = (entity: Id, was: EntityKind, will: EntityKind, constraints: Id[]): string =>
  `the update makes "${entity}" ${will === 'arc' ? 'an' : 'a'} ${will} where it was ${was === 'arc' ? 'an' : 'a'} ${was}, and ${constraints.join(', ')} ${constraints.length === 1 ? 'names' : 'name'} it: remove ${constraints.length === 1 ? 'that constraint' : 'those constraints'} in the same batch before it`;

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
// read more than `OUTLINE_LIMITS.bytes`, `.read` or `.readControl`, before any weld.
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
// The catalog (import/outline-formats.ts), beside `IMPORT_FORMATS`: a format is a module of `import/` and
// one line. `importFormatOf(path, OUTLINE_FORMATS)` and `importAccept(OUTLINE_FORMATS)` of D55 pick
// a format by the extension and make the list of a file input; both take a catalog already.
export declare const OUTLINE_FORMATS: { [F in OutlineFormat]: OutlineFormatSpec<OutlineFormats[F]> };

// What an import says about the outline it read.
// - `curves`, `byKind`, `control`: what the outline holds after the weld (by the `type` of each
//   curve), and the control points of its splines.
// - `ids`: the last number given of each kind, and the numbers not used (at most 20, and their
//   count): `l1` to `l<lines>` but for `unused`. A count of curves does not say their IDs. When
//   `unusedCount` is over the list, `ids.more` names the call that lists every ID (the query
//   `entryCurves`, once the outline is in a sketch). `otherKind`: the IDs whose letter is not their
//   type, at most 20: an arc of nearly a whole turn read as a circle keeps `a<n>`, so "the circles"
//   are not `c1` to `c<circles>` alone.
// - `welded`: ends moved onto another end; `moved`: the furthest any end was moved, mm, measured
//   from where the file had it: never more than the weld (and its slack of 1e-9 mm).
// - `reshaped`: arcs whose end was moved onto an end of another arc; `bent`: the furthest the arc
//   of the file lies off the new circle of such an arc, mm, over the whole arc and not at sampled
//   places: never more than the weld; `radius`: the largest change of a radius among them, mm. It
//   has no bound: an arc whose sagitta is under the weld has no radius the digits of its file hold
//   (L9). `reshapedArcs`: those arcs by their IDs with the radius before and after, at most 20, the
//   largest change first: the centre of each (`<entry>/<id>/center`) moved with its radius.
// - `closed`: arcs of nearly a whole turn read as circles, and splines closed onto their start.
// - `dropped`: curves left out because they have no extent, in the file or after the weld (each
//   counted once); `duplicates`: curves left out because they lie on an earlier curve of the file.
// - `blocked`: open ends that have another end within the weld and could not be put on it (it
//   would have gone further than the weld from its place in the file, or it is an end of an arc
//   beside a line, or of an arc that cannot give way); `crowded`: open ends that the weld leaves
//   alone because it cannot tell their partner: more than eight other open ends within the weld,
//   or more than 64 ends in the cells around (a search that is cut short proves nothing). Met ends
//   around an end do not make a crowd. Both are open and in `gaps`.
// - `open`: ends that are the end of no other curve; `gaps`: at most 20 of them that have another
//   end within a hundred weld tolerances, the nearest first, with the distance to the nearest
//   other end. `atMost`: the search around that end was cut short, so a nearer end may exist.
// - `bounds`: mm, in the coordinates of the file.
// - `notes`: in words, for the caller to read: the reader's (`about.notes`), then the gaps (with
//   the weld that would close them only when the gap is beyond the weld), what was blocked or
//   crowded, the arcs whose radius changed by more than the weld, by their IDs ("a3: 500 to 512;
//   its centre moved with it"), bounds under 1 mm or over 10 m ("is
//   the unit right?"), the cost of many curves or of many splines.
export interface OutlineReport {
  format: OutlineFormat;
  readWith: OutlineReadWith; // what the entry stores, for the next replacement
  about: ReadOutline['about'];
  curves: number;
  byKind: Record<ImportedCurve['type'], number>;
  control: number;
  ids: { lines: number; arcs: number; circles: number; splines: number; unused: Id[]; unusedCount: number; otherKind: { id: Id; type: ImportedCurve['type'] }[]; more?: string };
  welded: number;
  moved: number;
  reshaped: number;
  reshapedArcs: { id: Id; was: number; radius: number }[];
  bent: number;
  radius: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  crowded: number;
  open: number;
  gaps: { at: Vec2; distance: number; atMost?: true }[];
  bounds: { min: Vec2; max: Vec2 };
  notes: string[];
}
// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a whole file of the format (a binary DXF, a file cut short, a
//   malformed entity or path among them); the message has the place.
// - `empty`: the file, or the layers asked for, hold no curve the format reads; the message lists
//   the layers of the file and what was skipped.
// - `tooLarge`: more bytes, curves or control points than a reader takes, or after the weld
//   more than an outline holds.
export type OutlineOutcome =
  | { ok: true; curves: Record<Id, ImportedCurve>; report: OutlineReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'empty' | 'tooLarge'; message: string; arg?: (string | number)[]; about?: ReadOutline['about'] } };

// Reads a file into the curves of an outline. A function without a state, as `importMesh`: the
// curves enter a document by `addExternal` or `updateExternal`.
// 1. The size of the bytes; the options checked against the description of the format; the format
//    reads (its limits apply while it reads).
// 2. The local IDs (`outlineIds`): from the curves as the reader gave them, by the kind of the file
//    and its order, from 1. Nothing after this step renames a curve, so the IDs depend on the file
//    and the layers alone: not on the weld, and not on what is left out.
// 3. The weld (`weldOutline`), which begins and ends by leaving out what has no extent and what
//    lies on an earlier curve.
// 4. `empty`, and the limits of an outline (`tooLarge`: curves, control points), before anything
//    is computed for the report.
// 5. The report (the open ends and the gaps by a search that is bounded: `openEnds`).
// The same bytes and options give the same curves under the same IDs.
export declare function importOutline<F extends OutlineFormat>(format: F, bytes: Uint8Array, options?: OutlineOptions<F>): OutlineOutcome;

// The weld (design.md, "The weld"). Bounded in what it moves and in what it costs.
// 0. Left out: a curve with no extent (a line or a control polygon under 1e-6 mm, a radius under
//    it whatever the sweep, a quadratic that returns to its start). Then closed, whatever the
//    tolerance: an arc of more than a half turn whose ends are within 1e-6 mm (a circle), a spline
//    of four points or more likewise. Until nothing changes, and a curve is counted once. Left out:
//    a curve that lies on an earlier one (the same places within 1e-6 mm by distance, a line or a
//    spline either way round), BEFORE the ends are looked at: a twin would make every end of its
//    curve met.
// 1. With a tolerance: an arc of more than a half turn, or a spline of four points or more, whose
//    own two ends are within it, with no end of another curve near them, is closed. A search that
//    was cut short has not shown that no end is near: the curve is then left as it is. Otherwise
//    the two ends of one curve are never welded to each other, and an end never goes to the place
//    its own other end stands at.
// 2. An end is met when an end of another curve is within 1e-6 mm of it. Met ends never move.
// 3. The pairs of an open end and an end of another curve within the tolerance, the nearest first
//    by their distance in units of 1e-9 mm, then by the order of the file. The partners of an open
//    end are the open ends around it and the nearest met end. An end of a line or a spline goes
//    onto the other end. **An end of an arc goes only onto an end of another arc** (of two open
//    ends of arcs, the arc whose radius changes less in proportion gives way; then the later in the
//    file); beside a line or a spline the arc keeps the digits of its file, and when the other end
//    cannot come to it the weld is not made. No end goes further than the tolerance from where the
//    file had it. "Within the tolerance" has a slack of 1e-9 mm everywhere, so a gap equal to the
//    weld is closed wherever the file stands.
// 4. An arc whose end went onto another arc's is the circle through its two ends and the middle
//    of the arc of the file, computed relative to one of the three points. The move is made only
//    when: the three points are not nearly in one line (the middle more than 1e-6 mm off the chord,
//    the radius at most a million chords); the arc it gives is one the validator takes (its two
//    ends on one radius); the middle lies between the new ends the same way round; and the whole
//    arc of the file is within the tolerance of the new circle (the exact maximum: at its ends and
//    where it is nearest to and furthest from the new centre). The centre and the radius are not
//    bounded otherwise: for a shallow arc they change much while the arc moves little, and the
//    report names the arcs. An arc whose ends stayed is the arc of the file, to the digit.
// 5. Step 0 again; and, as the last thing, a curve the validator of the kind would refuse is left
//    out (`dropped`): whatever the weld answers, the validator takes.
// The cost: every search for ends is in the cells around a place and looks at no more than 64
// candidates, whatever they are (`crowded` when cut short); an open end with more than 8 other
// open ends within the tolerance is `crowded` and left alone, so the pairs are at most 9 per end
// (the review, codex 7: 64 million pairs for 8000 lines between two clusters). A twin is looked for
// among the curves that share all that places it (both ends; the centre and the radius; the ends
// and the centre; the ends, the count and the mean of the control points), so curves that share
// one point only are not compared (L7). With a tolerance under 1e-6 only steps 0 and 5 run. The
// result is aligned with the input: undefined where a curve was left out.
export interface Welded {
  curves: (ImportedCurve | undefined)[];
  welded: number;
  moved: number;
  reshaped: number;
  reshapedArcs: { index: number; was: number; radius: number }[]; // every one, the largest change first
  bent: number;
  radius: number;
  closed: number;
  dropped: number;
  duplicates: number;
  blocked: number;
  crowded: number;
}
export declare function weldOutline(curves: readonly ImportedCurve[], tolerance: number): Welded;
// The IDs of the curves of a reader, in their order; before the weld, and not changed by it.
export declare function outlineIds(curves: readonly ImportedCurve[]): Id[];
// The ends that are the end of no other curve, and at most 20 of them with another end within a
// hundred tolerances, the nearest first. The nearest other end is looked for outward: in cells of
// one tolerance, then of ten, then of a hundred, and the first size that has one gives it, so a
// dense place a millimetre away does not hide the gap beside an end (the third review: L4). Every
// search has the bound of 64 candidates; one that was cut short gives a distance that is an upper
// bound (`atMost`). After the limits of an outline are checked (the review, fable 3: 3.5 ms per
// open end before; K6).
export declare function openEnds(curves: Iterable<ImportedCurve>, tolerance: number): { open: number; gaps: OutlineReport['gaps'] };

// What a revised outline does to the entities of the one before it, for the answer of a tool and
// the draft of the app.
// - `kept`: the IDs both have; `changed`: of them, those whose curve is at no place a curve of the
//   old outline had (it moved, or it is a new curve under an old ID, or it changed its kind).
// - `added`, `removed`: the IDs only the new, only the old outline has.
// - `renamed`: an ID, old or new, whose curve is where the old outline had the curve of another ID
//   (two holes listed the other way round; a hole put in first, which gives every later one the
//   next number: K10). An ID can be in `added` and in `renamed`: `c5` is new, and its curve is the
//   old `c4`.
// Places are compared by distance (within 1e-6 mm, in the cells around them, never by one
// rounding), a line or a spline either way round. It finds curves that did not move; one that
// moved and changed its place in the file at once is `changed`.
export interface OutlineRevision {
  kept: number;
  changed: number;
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
  // declared counts, checked against what was read when the file has them: the vertices of an
  // LWPOLYLINE; the knots, the control points and the fit points of a SPLINE
  counts: { LWPOLYLINE: [90], SPLINE: [72, 73, 74] },
  comment: 999, // a group passed over wherever it stands
  paperSpace: 67, // 1: the entity is left out and listed, a POLYLINE with its vertices
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

// The regions of a sketch with their whole references, a page at a time: what `get_sketch` prints
// short (`SKETCH_SHOWN`). A command names a region by its whole sorted outer loop and there is no
// other form, so without this query a region of more than `SKETCH_SHOWN.loop` curves could not be
// named through MCP at all (the second round of reviews, all three).
// - `curve`: only the regions whose outer loop or one of whose holes holds this curve: the way from
//   a curve of an outline (`board/l1`) to the region to extrude.
// - `index`: only the region at this place among the regions of the sketch (`RegionRow.index`):
//   what a capped row of `get_sketch` names, since the rows there are grouped and capped and their
//   place is not this number.
// - `holes`: list the loops of the holes too (`RegionRow.holeLoops`); without it a row has their
//   count. No command needs them: a region is named by its outer loop.
// - `from`, `max`: of the regions that match (`curve`, `index`), in their order in the sketch, how
//   many are passed over and the most listed; `total` counts those that match. A page also ends
//   when it has listed `REGION_PAGE_IDS` IDs (outer loops, and holes when listed), but never before
//   its first region, however long its loop.
export const SKETCH_REGIONS_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch' },
  curve: { kind: 'text', title: 'Curve', summary: 'Only the regions bounded by this curve, by its ID in the sketch (own, of an entry, or a copy).', optional: true },
  // no default (corrected after the implementation): the check of the arguments fills a default in,
  // so with `default: 0` every call would have listed the first region alone
  index: { kind: 'number', title: 'Region', summary: 'Only the region at this place among the regions of the sketch, as a row of get_sketch gives it.', optional: true, spec: { title: 'Place of the region', unit: 'count', integer: true, min: { value: 0 } } },
  holes: { kind: 'flag', title: 'Holes', summary: 'List the curves of the holes of each region too; without it only their count.', optional: true },
  from: { kind: 'number', title: 'From', summary: 'How many of the regions that match to pass over, for the next page.', optional: true, spec: { title: 'Regions to pass over', unit: 'count', integer: true, min: { value: 0 }, default: 0 } },
  max: { kind: 'number', title: 'Most regions', summary: 'The most regions to list; `total` counts all that match.', optional: true, spec: { title: 'Most regions to list', unit: 'count', integer: true, min: { value: 1 }, max: { value: 100 }, default: 20 } },
} as const satisfies ArgSpecs;
export const REGION_PAGE_IDS = 2000;
// - `ref`: the reference of the region as a command takes it, whole: `{ outerLoop: [...] }`.
// - `index`: the place of the region among `SketchResult.regions`, whatever the filter and the page.
// - `holes`: how many loops lie inside it; `holeLoops`, when asked for: each by the IDs of its
//   curves. `area`: mm², less the holes; `box`: of the outer loop, in the sketch.
// The IDs of the holes, and the filter by a curve of a hole, come from the kept profile of the
// sketch (`context.sketch(sketch).profile.regions[i].holes[j].curves`, one ID per edge, made
// unique), which the query `sketchContacts` reads already: `SketchResult.regions` holds the loops
// as polylines, without IDs. No type of the result changes.
export interface RegionRow {
  index: number;
  ref: { outerLoop: Id[] };
  area: number;
  box: [number, number, number, number];
  holes: number;
  holeLoops?: Id[][];
}
// - `status`: `unavailable` when the sketch did not evaluate; `invalid` when its profile is (then
//   it has no regions; the query `sketchContacts` says why).
export interface SketchRegionsResult {
  status: 'ok' | 'unavailable' | 'invalid';
  total: number;
  from: number;
  regions: RegionRow[];
}

// ================================================================ 7. MCP

// The tool `import_outline` (packages/mcp/src/server.ts, beside `import_mesh`: it needs a disk).
// The server reads the bytes of the file (refusing by their size before anything) and hands them,
// with the arguments, to one function of tools.ts, `outlineInto`, which runs where the engine is:
// on the server's own engine, or in the app over the bridge, as the internal tool `_outline` (as
// `_load` carries a document). There the file is read by `importOutline` and the command sent. So
// a replacement reads what the entry stores (`readWith`) from the document it is about to change,
// and both routes give one answer; nothing is read back through `get_sketch` or `get_document`.
// - Without `sketch` nothing is changed: the answer is the report, so the layers and the size of a
//   file are seen before it is placed. `replace` and `remove` without `sketch` are refused.
// - With `sketch`: one command or one batch, one undo step. `addExternal` under `id` (by default
//   the name of the file reduced to an ID, numbered while taken), with the placement and the flag
//   given, and `readWith` as the file was read.
// - With `replace`: `id` is required. The format: what the extension of the path names; the
//   entry's when it names none. The options: those given, whole; when `options` is left out and the
//   format is the entry's, those the entry stores, so the revised file is read with the layers, the
//   unit and the weld of the first (`options: {}` reads every layer with the defaults). The answer
//   says in `next` when the stored options were not used. Then `updateExternal` of the entry with
//   the new curves and the new `readWith`, and nothing else unless given, so the placement, the
//   flag and their expressions stay.
// - `remove`, with `replace`: IDs of constraints of the sketch to remove in the same batch, before
//   the update: the way past the rule of an update. A refusal changes nothing, the constraints
//   stay; its message names the constraints, and the caller repeats the call with them.
// - The answer never holds the curves. A refusal of the command still carries the report.
export interface ImportOutlineArgs {
  path: string;
  format?: OutlineFormat;
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
// - `entry`: `<sketch>` and the ID, when something was placed; how its entities are named is in
//   `report.ids` (`board/l1` … by the last numbers and the unused ones).
// - `revision`, with `replace`: what stayed, changed, came and went, and what was renamed.
// - `refused`: the message of the command that was refused; nothing was changed.
// - `sketch`: the brief of the sketch after the command, as `execute` gives it (status, valid,
//   regions, open ends), and `problems`: the features that are not ok after it (a mirror that lost
//   its axis, a later projection that lost its entity, an extrusion without its region).
// - `next`: in words, what to do now (the query sketchRegions for the region to extrude, a
//   constraint to an entity, a projection of it).
export interface ImportOutlineAnswer {
  file: string;
  report: OutlineReport;
  entry?: { sketch: Id; id: Id };
  revision?: OutlineRevision;
  refused?: string;
  sketch?: unknown;
  problems?: unknown;
  next: string;
}
// What runs where the engine is, in two steps (the third review: the app asks whether a call
// changes the document BEFORE the call, so the question cannot read the answer).
// - `prepareOutline` changes nothing: it resolves the options (for a replacement from `readWith`
//   of the entry in the document of this engine), reads the file with `importOutline` and makes
//   the command. It throws `ToolError` for what is refused before any command (a file that cannot
//   be read, `replace` of an entry the sketch does not have).
// - `outlineInto` is `prepareOutline`, then `execute` of that command when a sketch was named.
// In the bridge it is the internal tool `OUTLINE_BRIDGE_TOOL` (as `_load` carries a document),
// listed in `MUTATING`. Its arguments are JSON: the file travels as base64 (`FileEnvelope` of
// tools.ts, which export uses the other way), since a `Uint8Array` does not survive
// `JSON.stringify`. `outlineBytes` refuses a text of more than `4 * ceil(OUTLINE_LIMITS.bytes / 3)`
// characters before it decodes anything (`tooLarge`), and decodes with what both Node and a
// browser have (`atob`, as `base64` of tools.ts uses `btoa`).
// - `changesDocument` answers for it as it does for `sketch_tool`: false without `sketch`;
//   otherwise it prepares the command and asks its own `changes(command)` (a preview), false when
//   the preparation throws. So a look, a file that cannot be read and a replacement the engine
//   would refuse do not end a draft of the user. The file is then read twice, and only while a
//   draft is open (the app asks `isDraft` first).
// - A refused command comes back inside an answer that is `ok` (it carries the report), so the
//   status line of the app reads the answer, not the outcome alone (`outlineSaid`): nothing for a
//   look (as for a query), "AI: imported the outline <id> into <sketch>" when `entry` is there, and
//   the refusal as an error when `refused` is.
export const OUTLINE_BRIDGE_TOOL = '_outline';
export type OutlineBridgeArgs = Omit<ImportOutlineArgs, 'path'> & { file: { name: string; base64: string } };
export interface PreparedOutline {
  report: OutlineReport;
  id?: Id; // the entry, when a sketch was named
  command?: CommandAfter; // `addExternal`, `updateExternal`, or the batch with the constraints of `remove`
  revision?: OutlineRevision;
}
export declare function outlineBytes(base64: string): Uint8Array;
export declare function prepareOutline(engine: { getState(): unknown }, file: { name: string; bytes: Uint8Array }, args: Omit<ImportOutlineArgs, 'path'>): PreparedOutline;
export declare function outlineInto(engine: { getState(): unknown; execute(command: CommandAfter): unknown }, file: { name: string; bytes: Uint8Array }, args: Omit<ImportOutlineArgs, 'path'>): ImportOutlineAnswer;
// The branch of `changesDocument` (tools.ts) for the internal tool; `changes` is that function's own.
export declare function outlineChangesDocument(engine: { getState(): unknown }, args: OutlineBridgeArgs, changes: (command: CommandAfter) => boolean): boolean;
export declare function outlineSaid(answer: ImportOutlineAnswer): { text: string; error: boolean } | undefined;

// What `get_sketch` says of an outline, in the place of the generic row of an entry (which would
// spread the stored curves and list every entity): the fields with their expressions, without
// `curves`; what it was read with; what it holds; where it stands; the first curves. The rest is
// the query `entryCurves`. The curves listed are at most `OUTLINE_LIMITS.listed` and hold at most
// `OUTLINE_LIMITS.listedPoints` positions together (the first curve is listed whatever it holds);
// a spline is listed without `through` here (the query gives it). The query bounds its page by
// positions the same way (five times as many).
export interface OutlineDetail {
  id: Id;
  type: 'outline';
  source: 'reference';
  name?: string;
  readWith?: OutlineReadWith;
  x: number | Expr;
  y: number | Expr;
  turn: number | Expr;
  anchor: SketchOutline['anchor'];
  regions: boolean;
  counts: Record<ImportedCurve['type'], number>;
  box: [number, number, number, number]; // in the sketch, as placed
  curves: (ListedCurve | Omit<Extract<ListedCurve, { type: 'spline' }>, 'through'>)[]; // in the order of the entry
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
// the rest; an outer loop of more than `loop` IDs is printed as its count, its first `loop` IDs,
// the entries its IDs are under, its `index` among the regions of the sketch, and the call that
// gives it whole (`query sketchRegions` with that `index`). Measured before the cap (the review, fable 4): 33,841
// characters of `regions` for an outline of 1000 curves.
export const SKETCH_SHOWN = { regions: 50, loop: 20 } as const;
export type ShownLoop = { outerLoop: Id[] } | { count: number; first: Id[]; entries: Id[]; index: number; whole: string };

// ================================================================ 8. the app

// The row of the kind (`REFERENCE_UI.outline`, packages/app/src/references/outline.ts): the form of
// 6c's rows for the three numbers and the anchor, 6b's flag and `inModel`, and one new member.
// - `file`: a button of the row that opens the draft of the panel on this entry (a hidden file
//   input of `accept`), with the options the entry stores (`readWith`). Data only: the panel reads the
//   file and runs the command, and the row imports nothing of the sketch mode.
export interface ReferenceUiAfter<R> {
  file?: {
    title: string;
    accept: string;
    readWith(ref: R): OutlineReadWith | undefined;
  };
}
// What the panel of a sketch holds while a file is being placed or replaced (`SketchState.outline`):
// the file as read once, the layers chosen, the unit and the weld, the anchor and the flag.
// - `replaces`: the entry a replacement is for. The draft then starts from the options that entry
//   stores, shows the revision (kept, added, removed, renamed) and the constraints the rule of an
//   update names, with a checkbox to remove them, and *Replace* sends one batch. An entry without
//   `readWith` (written by hand, or by a command) starts from the defaults and says so.
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
// The pickers of the app. `PICKER_LIMIT` (100) applies to every entry with more entities than that,
// not to derived entries only, and **after** the entities are filtered by the kind the picker
// asks for (`entryEntities(feature, kind?)`), so 34 lines do not hide the circles behind them. The
// list of an axis, a direction and a centre in the form of an entry (`entryForm`,
// packages/app/src/panels/sketch.ts) reads the same function; today it walks the index itself. A
// picker that left entities out says how many and has a field to narrow it by a part of an ID
// (`c12`); in the sketch mode an entity is picked in the view as well. The row of an outline shows
// the count of its open ends, as the row of a mirror does.
export declare function entryEntities(feature: SketchFeatureAfter, entry: Id, kind?: EntityKind, contains?: string): { listed: Id[]; left: number };
export declare function outlineId(document: Document, file: string): Id; // `idFromFile` among the IDs of the document
