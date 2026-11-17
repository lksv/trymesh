// Contract of package 3e of D36 (decision D57): the parts list. A query `partsList` in the catalog
// of queries (D37), an export format `partsCsv` in the catalog of export formats, the origin of
// a copied mesh (`shapeOrigin` in `solid.ts`), and the view of the query in the app.
// A draft, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of
// the engine of master and states what the package adds. The design is design.md; the calls, with
// the entry of the query and the writer of the file written out, are calls.ts.
//
// The package adds nothing to the document: no field, no section, no command, no feature type,
// no member of the registry of feature types, no face role, no issue code, no upgrade step.

import type { ArgSpecs, ArgsOf, Document, Engine, EngineState, ExportFormatSpec, ExportFormats, Exported, FaceName, Id, Queries, QueryOptions, QueryOutcome, QuerySpec, ResultUnits, Solid, Surface } from '../../../packages/engine/src/index';

// ================================================================ the mesh a solid is a copy of

// `solid.ts`. `transformSolid(t, solid, faceId)`, which a pattern of a body makes its copies with
// (its one caller), remembers of the solid it returns which solid it was made from and whether
// `t` mirrors; the record is kept by the identity of the copy, weakly, as `analyzeBody` keeps its
// result by the identity of a mesh.
//
// `shapeOrigin(solid)` follows the records: the solid the chain of copies starts at, and whether
// `solid` is its mirror image (an odd number of mirrors on the way; two mirrors give the shape
// back, turned). A solid that is no copy is its own origin.
//
// What it rests on, and what a step of the recompute has to keep to: a body keeps its `Solid`
// object for as long as no feature changes it (`applyTool` leaves the object of a target it did not
// change, a pattern of a body leaves its source, every step carries the other bodies over), and
// a feature that changes a body gives it a new object. So two bodies whose solids have one origin
// ARE the same mesh, moved: the question is answered by what was computed, with no tolerance.
// It errs one way only: bodies changed after the copy are never called the same, also when they
// were changed alike.
export interface MeshOrigin {
  solid: Solid; // the mesh the chain of copies starts at
  mirrored: boolean; // the solid asked about is the mirror image of it
}
export declare function shapeOrigin(solid: Solid): MeshOrigin;

// `features/index.ts`, beside `bodySource(doc, body)` (D48): the body the chain of sources of
// a body starts at; the body itself when it has no source. The chain stops at a body it has seen
// (a document edited by hand may hold a cycle). The root need not be a body of the state.
export declare function sourceRoot(doc: Document, body: Id): Id;

// ================================================================ the query

// No argument: the parts list is of the whole state asked about (now, `at` a feature, or a state
// a preview returned).
export const PARTS_LIST_ARGS = {} as const satisfies ArgSpecs;

// One kind of part and the bodies that are it.
// - `name`: the name of the part: the name of its own that a body has (body properties), else the
//   name of the body its chain of sources starts at (`sourceRoot`), else its name in the state.
//   So the three copies of "M3x6 screw" are "M3x6 screw", not "Screws / 1". Every body of a row
//   has the name of the row.
// - `count`, `bodies`: how many, and which, in the order of the model.
// - `material`, `color`, `density` (g/cm3): of the body properties, own or inherited; the same for
//   every body of the row.
// - `volume`: mm3, of the first body of the row (the bodies are one mesh, moved).
// - `mass`, `massFrom`: g, of the first body, and where it came from (`mass`: a weighed part or
//   a data sheet; `density`: density times volume), as `evaluation.bodyProperties` has them.
// - `noMass`, in place of `mass`: `notStated` (the properties state neither a mass nor a density)
//   or `inError` (the one that would be used cannot be evaluated; `get_model` has the message).
// - `totalMass`: g, the sum over the bodies of the row; absent with `noMass`.
// - `copyOf`: the body the chain of sources of the bodies starts at, when it is not in this row
//   (it was changed, or they were; other properties; another name; the other hand).
// - `mirrored`: the bodies of the row are mirror images of the mesh they are copies of.
export interface PartRow {
  name: string;
  count: number;
  bodies: Id[];
  material?: string;
  color?: string;
  volume: number;
  density?: number;
  mass?: number;
  massFrom?: 'mass' | 'density';
  noMass?: 'notStated' | 'inError';
  totalMass?: number;
  copyOf?: Id;
  mirrored?: true;
}

// A hole feature and the holes of it that the model has.
export interface HoleCount {
  feature: Id;
  count: number;
}
// The holes that carry one label: a piece of hardware per hole.
// - `label`: the label of the hole features, as it is written (rows are joined by the exact text).
// - `count`: the holes of the model with that label.
// - `holes`: the hole features with the label and the holes of each, in the order of the timeline.
export interface HardwareRow {
  label: string;
  count: number;
  holes: HoleCount[];
}

// The sums of a list of rows of bodies.
// - `count`: bodies.
// - `mass`: g, of the bodies that have one.
// - `withoutMass`: how many bodies have none and are not in `mass`.
export interface PartsSum {
  count: number;
  mass: number;
  withoutMass: number;
}

// The answer. Every body of the state is in exactly one place: a row of `printed`, a row of
// `bought`, or `auxiliary`.
// - `printed`: the bodies with the use `part` (the default), what is to be printed.
// - `bought`: the bodies with the use `reference`: bought or given parts, with the mass of their
//   data sheet.
// - `hardware`: what goes into the labelled holes: screws, nuts, inserts. No masses.
// - `unlabelled`: hole features without a label that made holes; only when there are some.
// - `auxiliary`: the bodies with the use `auxiliary`, which are no parts; only when there are some.
// - `totals`: the sums; `hardware.count` is the number of labelled holes.
export interface PartsList {
  printed: PartRow[];
  bought: PartRow[];
  hardware: HardwareRow[];
  unlabelled?: HoleCount[];
  auxiliary?: Id[];
  totals: { printed: PartsSum; bought: PartsSum; hardware: { count: number } };
}

// ---------------------------------------------------------------- the rule of the rows of bodies

// Two bodies are in one row when all of this holds:
// 1. their solids have the same origin (`shapeOrigin`: one mesh, moved) and the same hand
//    (`mirrored`);
// 2. their properties say the same: `use`, `material`, `color`, `density`, and what they weigh by:
//    the mass the properties resolved, by its source and its number (a stated mass, or a density);
//    else, without a mass, whether a field is in error or nothing is stated;
// 3. they have the same name (the rule of `PartRow.name`).
// The rows are in the order of their first bodies in the model. Nothing is measured.

// ---------------------------------------------------------------- the rule of the holes

// Holes are counted from the model, not from the document, and by where they are.
// - A hole is there when its bore or its head (`holeBore`, `holeHead`: a cylinder or a cone, so
//   a face with an axis) is a face of a body of the state that is not auxiliary.
// - An application of a hole feature is one of its points, cut by the feature itself or by one
//   copy of a pattern of features (the first copy tag of the face, when that pattern has features
//   as its source).
// - An application counts once per axis its faces lie on. Its faces in the bodies it was cut into
//   have one axis, so a hole through two bodies is one hole; a copy of such a body made afterwards
//   has the face with its surface moved, so a copy at another place is another hole, and a copy
//   that continues the hole (a plate copied onto itself, a half mirrored in the parting plane) is
//   the same one.
// - Two axes are one line when they are parallel within `ANGLE_TOLERANCE` and a point of one is
//   within the precision of the coordinates of the other (a millionth of the largest coordinate,
//   a millionth of a millimetre at least). The surfaces are exact (double precision), so lines
//   that are meant to be one differ by far less and lines that are not by a hole's width.
// - The count of a feature is the sum over its applications.
// So a point whose hole missed every body, a copy of a pattern that ran off the part, a hole
// a later cut removed whole and a suppressed feature count nothing, and three lids in a row have
// three times the holes of one.
//
// `bodies` are the bodies to look in (the caller leaves the auxiliary ones out); `surface` answers
// the surface of a face of a body by its number, as `context.surface` does by its name.
export declare function holeCounts(doc: Document, bodies: Readonly<Record<Id, { faces: { id: number }[] }>>, faceNames: readonly FaceName[], surface: (body: Id, face: number) => Surface | undefined): Map<Id, number>;

// ---------------------------------------------------------------- the entry

// The texts of the entry: they go to the description for the AI (`describe_api`, section Queries)
// and to the menu of the app.
export const PARTS_LIST_TEXTS = {
  title: 'Parts list',
  summary:
    'What to print and what to buy: the bodies of the model as rows of parts, and the hardware of the hole features. A printed part is a body with the use `part`, a bought part one with the use `reference` (body properties); auxiliary bodies are no parts. ' +
    'A body and its copies made by a pattern are one row with a count while they are the same part: a mirror image is another part, and so is a copy with another material, colour, mass or name, and a body that a feature changed after the pattern (so model what every copy should have before the pattern). ' +
    'Hardware is counted from the labels of the hole features: one piece per hole the model has, by where the holes are (a hole through several bodies is one hole; a copy of a body at another place has its holes too; a hole that missed or was cut away is not counted). ' +
    'So the label of a hole should name the piece that goes into it, with what the catalog does not know ("M3x10 countersunk screw"), and a hole that takes no piece of its own should have none. Every copy counts, also one laid out for printing. The answer is for the model as modelled, whatever the pose.',
  returns:
    '`printed` and `bought` (rows: `name`, `count`, `bodies`, `material`, `color`, `volume` in mm3 of one, `density` in g/cm3, `mass` in g of one with `massFrom` (`mass` or `density`), or `noMass` (`notStated`, `inError`), `totalMass` in g, `copyOf` (the source when it is in another row), `mirrored`), ' +
    '`hardware` (rows: `label`, `count`, `holes`: the hole features with the label and the holes of each), `unlabelled` (hole features without a label, with their holes), `auxiliary` (bodies that are no parts), ' +
    '`totals` (`printed` and `bought`: `count` of bodies, `mass` in g of those that have one, `withoutMass`: how many have none; `hardware.count`). Hardware has no mass.',
} as const;
export const PARTS_LIST_SIGNIFICANT = { mass: 6, totalMass: 6 } as const;
export const PARTS_LIST_UNITS = { volume: 'mm3', density: 'g/cm3', mass: 'g', totalMass: 'g' } as const satisfies ResultUnits;

// `query/parts-list.ts`. `geometry: 'modelled'`: a parts list does not depend on a pose, and with
// it the entry reads every body, also one whose pose is not known (D49).
export declare const partsList: QuerySpec<typeof PARTS_LIST_ARGS, PartsList> & { geometry: 'modelled' };

// In the code the module adds its line to the map `Queries` of `query/spec.ts` by declaration
// merging and its line to `QUERIES`. The draft cannot merge into the map of the engine (the
// catalog of master would then lack an entry and the engine would stop compiling in this
// program), so it states the map as it is after the package.
export interface QueriesAfter3e extends Queries {
  partsList: { spec: typeof PARTS_LIST_ARGS; result: PartsList };
}
export type QueryNameAfter3e = keyof QueriesAfter3e;

// ================================================================ the export format

// `partsCsv`: the parts list of the state as one table, for a spreadsheet or a shop. No option.
export const PARTS_CSV_OPTIONS = {} as const satisfies ArgSpecs;
export interface ExportFormatsAfter3e extends ExportFormats {
  partsCsv: typeof PARTS_CSV_OPTIONS;
}

// The file. CSV as RFC 4180 describes it:
// - UTF-8 without a byte order mark; every record ends with CR LF, the last one too;
// - a control character of a text (U+0000 to U+001F, U+007F: a tab, a line break) is written as
//   a space, so no field holds one;
// - a field that holds a comma or a double quote is put in double quotes, and a double quote
//   inside it is doubled; no other field is quoted;
// - a header record, then a record per row of `printed`, of `bought` and of `hardware`, in the
//   order of the answer of the query; every record has the nine fields;
// - a number is written with a decimal point and without an exponent (`plain` of `export/text.ts`:
//   at most nine decimals); a mass is rounded to six significant digits first, as the tools print it.
// The columns:
//
// column         | printed, bought                                        | hardware
// Kind           | `printed`, `bought`                                    | `hardware`
// Name           | `name`                                                 | `label`
// Count          | `count`                                                | `count`
// Material       | `material`, or empty                                   | empty
// Colour         | `color`, or empty                                      | empty
// Mass each (g)  | `mass`, or empty                                       | empty
// Mass total (g) | `totalMass`, or empty                                  | empty
// Note           | with `copyOf`: "copy of <copyOf>", or for a mirrored   | empty
//                | row "mirror image of <copyOf>"; else empty             |
// IDs            | the bodies, separated by a space                       | the hole features, separated by a space
//
// `IDs` is for a reader who looks for the bodies in the model: an ID may itself hold a space, so
// a program takes the bodies from the query, not from this column.
export const PARTS_CSV = {
  path: 'parts.csv', // a suggested name: the caller names the file of the layout `file`
  mediaType: 'text/csv', // RFC 4180, section 3; RFC 7111
  header: ['Kind', 'Name', 'Count', 'Material', 'Colour', 'Mass each (g)', 'Mass total (g)', 'Note', 'IDs'],
  copy: 'copy of ',
  mirror: 'mirror image of ',
  // `Exported.empty`: the list has no row at all (no printed part, no bought part, no labelled hole)
  empty: 'the model has no part and no labelled hole to list',
} as const;
// One field of a record: control characters as spaces, quoted when it has to be. Exported from
// `export/text.ts`.
export declare function csvField(value: string): string;
// What `about` of the file says (a type alias: an alias of an object type is assignable to
// `Record<string, unknown>`, the type of `ExportFile.about`, and an interface is not).
export type PartsCsvAbout = {
  rows: number; // records after the header
  printed: number; // rows of each kind
  bought: number;
  hardware: number;
};
export const PARTS_CSV_TEXTS = {
  title: 'Parts list (CSV)',
  summary:
    'The parts list of the model (the query partsList) as one CSV table for a spreadsheet: a record per kind of printed part, of bought part and of hardware, with its count, material, colour, the mass of one and of all in grams, a note for a row of copies that differ from their source, and the IDs of its bodies or hole features. ' +
    'Comma separated, UTF-8, a decimal point. One file.',
} as const;
// `export/parts-csv.ts`: it runs the entry `partsList` with the context of the export and writes
// its answer; nothing is computed twice or differently.
export declare const partsCsv: ExportFormatSpec<typeof PARTS_CSV_OPTIONS>;

// ================================================================ the engine

// `Engine` of master with the query and the format. No method is added, so the guard of
// `packages/mcp/test/coverage.test.ts` needs no row; the two typed tables of `queries.test.ts` and
// of `export-formats.test.ts` each get one (calls.ts, `FIXTURES`).
export interface EngineAfter3e extends Omit<Engine, 'query' | 'export'> {
  query<N extends QueryNameAfter3e>(name: N, args: ArgsOf<QueriesAfter3e[N]['spec']>, options?: QueryOptions): QueryOutcome<QueriesAfter3e[N]['result']>;
  export<F extends keyof ExportFormatsAfter3e>(format: F, options: ArgsOf<ExportFormatsAfter3e[F]>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}

// ================================================================ MCP

// Nothing of `packages/mcp/src` changes but one paragraph of `CONVENTIONS` in `api.ts`: the query
// is reached by the tool `query`, the format by the tool `export`, and both are described from
// their entries. The paragraph:
export const CONVENTION =
  'The parts list is the query `partsList` (no arguments) and, as a file, the export format `partsCsv`: printed parts (bodies with the use `part`), bought parts (use `reference`, with the mass of their data sheet) and hardware. ' +
  'Hardware is counted from the labels of the hole features, one piece per hole of the model, so `label` should name the piece that goes into the hole. The label the query `hardwareHole` gives is a start: add what the catalog does not know, such as the length of the screw ("M3x10 countersunk screw"). ' +
  'For a plain clearance hole it names the hole ("M3 clearance hole"), not a piece: write the screw into it when its head sits on the surface, and remove the label when the screw is counted by the hole of its head or of its nut. One screw through two parts is best one hole feature with both bodies as targets. ' +
  'A screw modelled as a body with the use `reference` is a bought part; do not label its hole as well, or it is listed twice. Copies of a body made by a pattern are one row with a count while no feature after the pattern changes one of them: model what every copy should have before the pattern, and give a material to the source. ' +
  'Every copy counts, also copies laid out for printing, with their holes.';

// ================================================================ the app

// The app's types cannot be imported into a draft (packages/app imports three.js; see the contract
// of 1b). What the package adds there, as stand-ins; in the code it is
// `packages/app/src/queries/parts-list.ts` and one line of `QUERY_VIEWS`.
//
// The view of the query (`QueryView<'partsList'>` of `queries/index.ts`; `answer` and `scene` get
// the arguments of the form as their second parameter, of which this query has none, and `answer`
// returns the elements of the panel, for which the groups below stand):
// - `immediate`: the query has no argument, so it is asked as soon as its form opens.
// - `answer`: three groups under their headings, *To print*, *To buy* and *Hardware*, each a row
//   per row of the answer ("M3x6 screw × 4", with the material, the colour, the mass of one and of
//   all, and what the row is a copy of), then the sums, the hole features without a label and the
//   auxiliary bodies, each only when there is something to say. Rows are counted through the three
//   groups for `picked`.
// - `scene`: a picked row of bodies draws its bodies in the colour of a selection; a picked row of
//   hardware paints the bores and heads of its hole features in the bodies that are parts: the
//   faces the count was taken from.
// - `note`: the line of the status bar.
// The export `partsCsv` needs nothing: the menu *Export…* lists every format of the catalog, and
// a format without options has a form with its button alone.
export interface ViewPanelStandIn {
  state: EngineState; // the state the answer was asked about
  bodyName(body: Id): string;
  number(value: number, unit: 'g' | 'mm3' | 'g/cm3'): string;
  picked: number | undefined;
  pick(row: number | undefined): void;
}
export interface SceneAdditionsStandIn {
  bodies: { body: Id; color: number }[];
  faces: { body: Id; face: FaceName; color: number; opacity: number }[];
}
export interface ViewRow {
  text: string; // the line of the row
  detail: string; // the smaller text beside it
  swatch?: string; // the colour of the bodies of the row, `#rrggbb`, shown as a patch
  picked: boolean;
}
export interface ViewGroup {
  heading: string;
  rows: ViewRow[];
}
export interface PartsListView {
  immediate: true;
  answer(result: PartsList, args: {}, panel: ViewPanelStandIn): { groups: ViewGroup[]; hints: string[] };
  scene(result: PartsList, args: {}, panel: ViewPanelStandIn): Partial<SceneAdditionsStandIn>;
  note(result: PartsList, panel: ViewPanelStandIn): { text: string; error: boolean };
}
