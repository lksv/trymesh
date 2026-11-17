// Contract of package 3e of D36 (decision D57): the parts list. A query `partsList` in the catalog
// of queries (D37), an export format `partsCsv` in the catalog of export formats, one optional
// member of the registry of feature types (`copyOf`), and the view of the query in the app.
// A draft, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of
// the engine of master and states what the package adds. The design is design.md; the calls, with
// the entry of the query and the writer of the file written out, are calls.ts.
//
// The package adds nothing to the document: no field, no section, no command, no feature type,
// no face role, no issue code, no upgrade step.

import type { ArgSpecs, ArgsOf, Document, Engine, EngineState, ExportFormatSpec, ExportFormats, Exported, FaceName, Feature, Id, Queries, QueryOptions, QueryOutcome, QuerySpec, ResultUnits } from '../../../packages/engine/src/index';
import type { FeatureModule } from '../../../packages/engine/src/features/module';

// ================================================================ the registry: a copy of a body

// What a feature type says about a body it creates, next to `bodySource` (D48): the body it is
// a copy of AS A SHAPE. The same solid moved, or, with `mirrored`, its mirror image.
// - A pattern of a body answers with its source body; `mirrored` for the transform `mirror`.
// - A type that derives a body from another without keeping its shape (a split, a boolean of
//   bodies: package 3d) answers `bodySource`, for the properties its body inherits, and not this.
// - Asked only for a body the feature creates, like `bodySource`.
// `bodySource` stays as it is and keeps its one reader (the body properties).
export interface BodyCopy {
  body: Id; // the body it was copied from
  mirrored: boolean; // the copy is the mirror image of that body
}
// `FeatureModule` of `features/module.ts` with the member added.
export interface FeatureModuleAfter3e<F extends Feature> extends FeatureModule<F> {
  copyOf?(f: F, local: string | undefined): BodyCopy | undefined;
}

// `features/index.ts`, next to `bodySource(doc, body)`: what the registry answers for the body, or
// undefined when its feature is not in the document, does not create it, or copies it from none.
export declare function bodyCopy(doc: Document, body: Id): BodyCopy | undefined;

// The family of a body: the body its chain of copies starts at, and whether the body is the mirror
// image of that one (an odd number of mirrors on the way; two mirrors give the shape back, turned).
// - A body that is no copy is its own family: `{ root: body, mirrored: false }`.
// - The chain stops at a body it has seen (a document edited by hand may hold a cycle).
// - The root need not be a body of the state asked about.
// This is the one place that says "these bodies are the same part": a later package that knows it
// of bodies that are not copies of one another (two imports of one mesh, two insertions of one
// document: 3b, 3c) answers here.
export interface PartFamily {
  root: Id;
  mirrored: boolean;
}
export declare function partFamily(doc: Document, body: Id): PartFamily;

// ================================================================ the query

// No argument: the parts list is of the whole state asked about (now, `at` a feature, or a state
// a preview returned).
export const PARTS_LIST_ARGS = {} as const satisfies ArgSpecs;

// One kind of part and the bodies that are it.
// - `name`: the name of the part. The name of its own that the first body of the row has (body
//   properties), else the name of the body the family starts at, else the name of the first body.
//   So the three copies of "M3x6 screw" are a row "M3x6 screw", not "Screws / 1".
// - `count`, `bodies`: how many, and which, in the order of the model.
// - `material`, `color`: of the body properties, own or inherited; the same for every body of the row.
// - `volume`: mm3, of the first body of the row.
// - `density`: g/cm3, when the properties state one.
// - `mass`, `massFrom`: g, of the first body, and where it came from (`mass`: a weighed part or
//   a data sheet; `density`: density times volume), as `evaluation.bodyProperties` has them.
// - `noMass`, in place of `mass`: `notStated` (the properties state neither a mass nor a density)
//   or `inError` (the one they state cannot be evaluated; `get_model` has the message).
// - `totalMass`: g, the sum over the bodies of the row; absent with `noMass`.
// - `copyOf`: the body the family starts at, when it is not in this row (another shape, other
//   properties, the other hand, or not in the state).
// - `mirrored`: the bodies of the row are mirror images of that body.
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

// ---------------------------------------------------------------- the rules of the rows of bodies

// Two bodies are in one row when all of this holds:
// 1. they have the same family (`partFamily`: the same root) and the same hand (`mirrored`);
// 2. their properties say the same: `use`, `material`, `color`, and what they weigh by (the same
//    stated mass, or the same density, or both nothing, or both in error);
// 3. neither is a copy with a name of its own, unless both have the same one (the name of the root
//    names the row and splits nothing);
// 4. they have the same shape (`sameShape` below), compared with the first body of the row.
// The rows are in the order of their first bodies in the model.
//
// "The same shape" of a copy and its source is asked of the model, because a feature after the
// pattern may have changed one of them: the same number of triangles, and volumes that differ by
// no more than the precision of the coordinates of the two bodies (`coordinatePrecision`) times
// the larger of their two surfaces. (Measured: copies differ from their source by at most 0.0093
// of that bound; design.md, "Measured".) The surface of a mesh is one pass over its triangles,
// kept by the mesh (`context.memo`).
export interface ShapeOfBody {
  triangles: number;
  volume: number; // mm3
  surface: number; // mm2
  precision: number; // `coordinatePrecision` of the body
}
export declare function sameShape(a: ShapeOfBody, b: ShapeOfBody): boolean;

// ---------------------------------------------------------------- the rule of the holes

// Holes are counted from the model, not from the document: a hole is there when a side face of it
// (`holeBore`, `holeHead`, `holeFlat`) is a face of a body of the state that is not auxiliary.
// - An application of a hole feature is one of its points, cut by the feature itself or by one
//   copy of a pattern of features (the first copy tag of the face, when that pattern has features
//   as its source).
// - In a family of bodies an application counts once per name its faces have there beyond that
//   tag: once in the bodies it was cut into, and once more in every copy of such a body made
//   afterwards (a pattern of a body appends its tag to every face).
// - Across families the largest count is taken: a hole through two bodies is one hole, and so is
//   one through a plate and its copy laid on it.
// - The count of a feature is the sum over its applications.
// So a point whose hole missed every body, a copy of a pattern that ran off the part, a hole
// a later cut removed whole and a suppressed feature count nothing, and three copies of a lid
// have three times its holes.
export declare function holeCounts(doc: Document, bodies: Readonly<Record<Id, { faces: { id: number }[] }>>, faceNames: readonly FaceName[], counted: (body: Id) => boolean): Map<Id, number>;

// ---------------------------------------------------------------- the entry

// The texts of the entry: they go to the description for the AI (`describe_api`, section Queries)
// and to the menu of the app.
export const PARTS_LIST_TEXTS = {
  title: 'Parts list',
  summary:
    'What to print and what to buy: the bodies of the model as rows of parts, and the hardware of the hole features. A printed part is a body with the use `part`, a bought part one with the use `reference` (body properties); auxiliary bodies are no parts. ' +
    'A body and its copies made by a pattern are one row with a count, unless a copy differs: a mirror image is another part, and so is a copy with another material, colour, mass or name, or one a later feature changed. ' +
    'Hardware is counted from the labels of the hole features: one piece per hole the model has (a hole through several bodies is one hole; copies of a body have its holes too; a hole that missed or was cut away is not counted). ' +
    'So the label of a hole should name the piece that goes into it, with what the catalog does not know ("M3x10 countersunk screw"), and a hole that takes no piece of its own should have none. The answer is for the model as modelled, whatever the pose.',
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
// - a field that holds a comma, a double quote, CR or LF is put in double quotes, and a double
//   quote inside it is doubled; no other field is quoted;
// - a header record, then a record per row of `printed`, of `bought` and of `hardware`, in the
//   order of the answer of the query;
// - a number is written with a decimal point and without an exponent; a mass to six significant
//   digits, as the tools print it.
// The columns:
//
// column         | printed, bought                                     | hardware
// Kind           | `printed`, `bought`                                 | `hardware`
// Name           | `name`; a mirrored row adds " (mirror image)"        | `label`
// Count          | `count`                                             | `count`
// Material       | `material`, or empty                                | empty
// Colour         | `color`, or empty                                   | empty
// Mass each (g)  | `mass`, or empty                                    | empty
// Mass total (g) | `totalMass`, or empty                               | empty
// IDs            | the bodies, separated by a space                    | the hole features, separated by a space
export const PARTS_CSV = {
  path: 'parts.csv', // a suggested name: the caller names the file of the layout `file`
  mediaType: 'text/csv', // RFC 4180, section 3; RFC 7111
  header: ['Kind', 'Name', 'Count', 'Material', 'Colour', 'Mass each (g)', 'Mass total (g)', 'IDs'],
  mirrored: ' (mirror image)',
  // `Exported.empty`: the list has no row at all (no printed part, no bought part, no labelled hole)
  empty: 'the model has no part and no labelled hole to list',
} as const;
// One field of a record, quoted when it has to be. Exported from `export/text.ts`.
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
    'The parts list of the model (the query partsList) as one CSV table for a spreadsheet: a record per kind of printed part, of bought part and of hardware, with its count, material, colour, the mass of one and of all in grams, and the IDs of its bodies or hole features. ' +
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
  'Hardware is counted from the labels of the hole features, one piece per hole of the model, so write into `label` the piece that goes into the hole and add what the catalog does not know, such as the length of the screw ("M3x10 countersunk screw"); ' +
  'a hole that takes no piece of its own (the clearance hole under a counterbore of another feature) should have no label, and one screw through two parts is best one hole feature with both bodies as targets. ' +
  'A screw modelled as a body with the use `reference` is a bought part; do not label its hole as well, or it is listed twice. Copies of a body made by a pattern are one row with a count; give a material to the source and the copies follow.';

// ================================================================ the app

// The app's types cannot be imported into a draft (packages/app imports three.js; see the contract
// of 1b). What the package adds there, as stand-ins; in the code it is
// `packages/app/src/queries/parts-list.ts` and one line of `QUERY_VIEWS`.
//
// The view of the query (`QueryView<'partsList'>`):
// - `immediate`: the query has no argument, so it is asked as soon as its form opens.
// - `answer`: three groups, *To print*, *To buy* and *Hardware*, each a row per row of the answer
//   ("M3x6 screw × 4", with the material, the mass of one and of all), then the sums, the bodies
//   without a mass, the hole features without a label and the auxiliary bodies, each only when
//   there is something to say. Rows are counted through the three groups for `picked`.
// - `scene`: a picked row of bodies draws its bodies in the colour of a selection; a picked row of
//   hardware paints the side faces of its hole features (the faces a selected hole feature shows).
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
  picked: boolean;
}
export interface PartsListView {
  immediate: true;
  answer(result: PartsList, panel: ViewPanelStandIn): { rows: ViewRow[]; hints: string[] };
  scene(result: PartsList, panel: ViewPanelStandIn): Partial<SceneAdditionsStandIn>;
  note(result: PartsList, panel: ViewPanelStandIn): { text: string; error: boolean };
}
