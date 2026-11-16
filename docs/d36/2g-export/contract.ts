// Contract of package 2g of D36 (decision D54): three export formats, `3mf`, `dxf` and `svg`, as
// entries of the catalog `EXPORT_FORMATS` (D37), and what they are built from. A draft, only
// type-checked (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine of
// master and states what the package adds. The design is design.md; the calls are calls.ts.
//
// Every detail of a file format below is taken from the specification named beside it (the full
// list with the versions read is in design.md, "Sources"); the prototype of the spike wrote files
// with exactly these values and independent readers took them (design.md, "Measured").

import type { ArgSpecs, ArgsOf, Engine, ExportFormatSpec, ExportFormats, Exported, FaceName, Frame, Id, QueryContext, QueryOptions, QueryOutcome, RunArgsOf, Vec2 } from '../../../packages/engine/src/index';

// ================================================================ the options

// `3mf`: the bodies as objects of one 3MF document.
// - `bodies`: as for `stl`. Each once, in the order of the list, whatever their use; without it
//   the printed bodies (the use `part` of the body properties, D48).
export const THREE_MF_OPTIONS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'The bodies to export, each once, in this order, whatever their use; without it the printed bodies (use `part`: not the reference and auxiliary bodies of the body properties).', optional: true },
} as const satisfies ArgSpecs;

// `dxf` and `svg`: the outline a plane cuts out of bodies, as a drawing in millimetres.
// - `plane`: a base plane, a plane feature or a planar face, as the query `section` takes it.
//   The drawing is seen against the normal of the plane: a face is seen from outside its body.
// - `offset`: the plane is moved by this along its normal. A face has its normal pointing out of
//   the body, so a negative offset cuts into it. Without an offset a face gives what lies just
//   under it (see `outlineOf`).
// - `bodies`: only these, each once, whatever their use. Without it: for a face, the body of the
//   face; for a base plane or a plane feature, the printed bodies.
// The names are those of the arguments of `section`, so a refusal of the section names the same
// option (`['plane']`).
export const OUTLINE_OPTIONS = {
  plane: { kind: 'plane', title: 'Plane', summary: 'A base plane, a plane feature or a planar face. The drawing is what the plane cuts out of the bodies, seen against its normal (a face is seen from outside its body).' },
  offset: { kind: 'number', title: 'Offset', summary: 'Moves the plane along its normal; for a face a negative offset cuts into the body. Without it a face gives the cut just under it, and a body that only stands on the plane gives nothing.', optional: true, spec: { title: 'Offset along the normal', unit: 'mm', default: 0 } },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Only these, each once, whatever their use. Without it: the body of the face when the plane is a face, otherwise the printed bodies (use `part`).', optional: true },
} as const satisfies ArgSpecs;

// ================================================================ the catalog

// In the code a format adds its line to the map `ExportFormats` of `export/spec.ts` by
// declaration merging, in its own module, and its line to `EXPORT_FORMATS` of `export/index.ts`.
// The draft cannot merge into the map of the engine: the catalog of master would then lack three
// entries and the engine itself would stop compiling in this program. So the draft states the
// map as it is after the package, and the engine with it.
export interface ExportFormatsAfter extends ExportFormats {
  '3mf': typeof THREE_MF_OPTIONS;
  dxf: typeof OUTLINE_OPTIONS;
  svg: typeof OUTLINE_OPTIONS;
}
export type ExportFormatAfter = keyof ExportFormatsAfter;
export type ExportOptionsAfter<F extends ExportFormatAfter> = ArgsOf<ExportFormatsAfter[F]>;
// `Engine` of master with the three formats. Nothing else of it changes: no method, no command,
// no query, no type of the document.
export interface EngineAfter2g extends Omit<Engine, 'export'> {
  export<F extends ExportFormatAfter>(format: F, options: ExportOptionsAfter<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}

// The texts of the entries: they go to the description for the AI (`describe_api`, section
// Export formats) and to the menu of the app.
export const FORMAT_TEXTS = {
  '3mf': {
    title: '3MF',
    summary:
      'Bodies as the objects of one 3MF document, for a slicer: each body is an object with its name (the name of the body properties), its ID as the part number and, when the body has a colour, a base material with that colour, named by the material of the body. ' +
      'One file, in millimetres, the bodies where they are modelled. The file is a ZIP that is not compressed, about a quarter larger than the STL of the same bodies.',
  },
  dxf: {
    title: 'DXF (outline)',
    summary:
      'The outline a plane cuts out of bodies as a DXF drawing in millimetres, for laser cutting and drilling templates (the same cut as the query section). A whole circle is a CIRCLE with the centre and radius of its surface; every other loop is one closed POLYLINE with lines and arcs. ' +
      'Outer loops are on the layer OUTER, holes on the layer HOLES. The coordinates are the x and y of the plane, as the query section reports them. One file in the form of DXF release 12.',
  },
  svg: {
    title: 'SVG (outline)',
    summary:
      'The outline a plane cuts out of bodies as an SVG drawing with one user unit per millimetre (the same cut as the query section). A whole circle is a `circle` with the centre and radius of its surface; every other loop is one closed `path` with lines and arcs; class `outer` or `hole`, a group per body. ' +
      'The y of the plane points up and that of SVG down: a point (u, v) of the plane is written (u, −v). Stroked, not filled. One file.',
  },
} as const satisfies { [F in Exclude<ExportFormatAfter, 'stl'>]: { title: string; summary: string } };

// The entries (`export/threemf.ts`, `export/dxf.ts`, `export/svg.ts`). Each returns one file,
// layout `file`:
//
// format | path          | mediaType       | about
// 3mf    | model.3mf     | model/3mf       | MeshAbout
// dxf    | outline.dxf   | image/vnd.dxf   | OutlineAbout
// svg    | outline.svg   | image/svg+xml   | OutlineAbout
//
// The media types are the registered ones (IANA, Media Types; `model/3mf` also in appendix C.1 of
// the 3MF core specification, `image/svg+xml` in SVG 1.1). The path of a file of the layout
// `file` is a suggested name only: the caller names the file.
export declare const threeMf: ExportFormatSpec<typeof THREE_MF_OPTIONS>;
export declare const dxf: ExportFormatSpec<typeof OUTLINE_OPTIONS>;
export declare const svg: ExportFormatSpec<typeof OUTLINE_OPTIONS>;

// What `about` of the file says, as plain JSON for the answer of the tool `export`. Type aliases,
// not interfaces: an alias of an object type is assignable to `Record<string, unknown>`, the type
// of `ExportFile.about`, and an interface is not.
export type MeshAbout = {
  bodies: Id[]; // the bodies written, in their order
  triangles: number;
};
// - `bodies`: the bodies the plane cuts, in the order they were taken.
// - `loops`: all closed loops of the drawing; `circles`: how many of them are whole circles.
// - `area`: mm², of the section as the mesh gives it (the number of the query `section`), so
//   a circle counts a little less than the circle that is drawn.
// - `bounds`: the box of what is drawn, in the x and y of `frame`; absent when nothing is cut.
// - `frame`: the plane as it was asked for, after the offset (`frame` of the answer of `section`).
// - `below`: how far under that plane the cut was taken (`below` of `section`: the precision of
//   the coordinates of the bodies taken). A point (u, v) of the drawing stands for the point
//   `origin + x·u + y·v − normal·below` of the model.
// - `inPlane`: bodies with a planar face in the plane, as the query `section` reports them; only
//   when there are some. Such a body shows the cut just under that face, or nothing when it lies
//   on the other side of the plane.
export type OutlineAbout = {
  bodies: Id[];
  loops: number;
  circles: number;
  area: number;
  bounds?: { min: Vec2; max: Vec2 };
  frame: Frame;
  below: number;
  inPlane?: { body: Id; face: FaceName }[];
};

// When an export holds nothing worth writing, `Exported.empty` says why (D37); a tool that writes
// files refuses with the text. `3mf` uses the two texts of `stl`; the outline adds two.
export const EMPTY = {
  noBody: 'the model has no body to export',
  noPrintedBody: 'the model has no printed body (every body is a reference or auxiliary body); list the bodies to export them anyway',
  // the plane misses every body taken
  notCut: 'the plane cuts none of the bodies',
  // ... and at least one of them has a face in the plane (the first such body is named): the cut
  // is taken under the plane, and the body lies above it
  notCutInPlane: (body: Id): string => `the plane cuts none of the bodies; "${body}" has a face in the plane and lies on the side the normal of the plane points to: move \`offset\` into the body`,
} as const;
// A format returns its one file also when the export is empty (the layout `file` is one file,
// and `runExport` holds a format to it). What that file is:
// - `3mf`: the package with a model that has no object and no build item. The schema takes it
//   (`item` may occur zero times); the text of 3.4.3 speaks of "one or more items", so it is not
//   a file to hand on, which is what `empty` says. `lib3mf` reads it without a warning.
// - `dxf`: the HEADER and an ENTITIES section with nothing in it.
// - `svg`: the root with the two groups' outer one and no drawing; its box is the margin alone
//   (2 × 2 mm about the origin), because there are no bounds.
// No caller of this project writes such a file: the tool `export` and the form of the app refuse
// with the text.

// What `run` of a format refuses, beyond what the check of the options refuses before it:
//
// code         | arg       | when
// notAvailable | ['plane'] | the plane is not in the state asked about, or the face is not planar (from `section`)
// failed       |           | the mesh of a body is not a closed surface (from `section`)
// failed       |           | a triangle of a body names one vertex twice, or a coordinate is not a finite number (`3mf`; a defect of the mesh)
// failed       |           | the file does not fit a ZIP without ZIP64, or a name is too long for one (`storedZip`, below)
//
// The outline resolves its plane also when no body is taken, so `about.frame` is always there.
// All three formats are exported as modelled, like every export (D49).

// ================================================================ the list of bodies of a print export

// `export/bodies.ts`: the bodies a print export writes, and why it writes none. Moved out of
// `export/stl.ts` without a change (the format `stl` calls it); `3mf` and the outline of a plane
// that is not a face use it.
// - With a list: the list, each body once, in its order, whatever the use of a body.
// - Without: `printedBodies` of the body properties (D48).
// - `empty`: `EMPTY.noPrintedBody` when there is no list and the model has bodies but none is
//   printed; `EMPTY.noBody` when the list that results is empty for any other reason.
export declare function chosenBodies(context: QueryContext, bodies: readonly Id[] | undefined): { chosen: Id[]; empty?: string };

// ================================================================ numbers and texts of a file

// `export/text.ts`. The three functions are shared by the formats of this package and are what
// the robot description of 5b (two XML formats) will write its numbers and names with.

// A number of a drawing (DXF, SVG): at most nine decimals, no exponent, no trailing zeros, and
// never "-0". Writing no exponent is a choice of the writer, not a rule of the formats (the
// grammar of SVG path data takes one; the DXF reference does not say): a plain decimal is what
// every reader takes. Nine decimals of a millimetre is a millionth of a micron, far under the
// precision of the coordinates (float32). Throws for a number that is not finite.
export declare function plain(value: number): string;

// A coordinate of a mesh in 3MF: the shortest decimal text that reads back as the same float32
// (`Math.fround(Number(text)) === value`), so a reader gets the very numbers of the mesh and the
// STL of the same body, and no digits beyond them (the 3MF core specification, 4.1.3.1: "Producers
// SHOULD NOT use more precision than the error generated in their calculations"). It may use an
// exponent ("1e-7"), which the type of a coordinate allows (ST_Number, appendix B.1.1:
// `((\-|\+)?(([0-9]+(\.[0-9]+)?)|(\.[0-9]+))((e|E)(\-|\+)?[0-9]+)?)`), and never writes "-0",
// "NaN" or "Infinity", which it does not allow. Throws for a number that is not finite.
export declare function float32Text(value: number): string;

// A text as character data or as the value of an attribute in double quotes (XML 1.0, fifth
// edition):
// - `&`, `<`, `>` and `"` as `&amp;`, `&lt;`, `&gt;` and `&quot;` (2.4, and production 10
//   `AttValue`);
// - tab, line feed and carriage return as `&#9;`, `&#10;` and `&#13;`: written as they are, an
//   attribute would have them turned into spaces (3.3.3, attribute-value normalization);
// - what a document may not hold at all is left out (production 2, `Char`): the other control
//   characters under U+0020, a surrogate without its pair, U+FFFE and U+FFFF.
// The names of bodies come from the user and may hold anything (`label` of the body properties
// limits only the length and the spaces at the ends).
export declare function xmlText(text: string): string;

// ================================================================ a ZIP that is not compressed

// `export/zip.ts`, exported from the index of the engine: the container of 3MF, and what the app
// downloads a set of files as (an export of the layout `directory`: STL per body, later the
// robot description of 5b with its folder of meshes). No library and no compression: every file
// is stored (.ZIP File Format Specification 6.3.10, PKWARE, 4.4.5: method 0).
export interface ZipEntry {
  // Relative, with forward slashes, no leading slash (4.4.17.1); the paths of `ExportFile` have
  // this form. At most 65 535 bytes as UTF-8: its length is a field of two bytes (4.4.10).
  name: string;
  bytes: Uint8Array;
}
// The values of the records, by the sections of the specification:
// - local file header (4.3.7, signature 0x04034b50), the bytes of the file (4.3.8), for every
//   entry in the order given; then the central directory (4.3.12, signature 0x02014b50), a header
//   per entry in the same order; then the end of central directory record (4.3.16, 0x06054b50).
//   All numbers little-endian (4.4.1.1).
// - version needed to extract 10 (4.4.3.2: "1.0 - Default value"); version made by 10, with the
//   upper byte 0 (4.4.2: MS-DOS attributes, the specification version 1.0).
// - general purpose bit flag 0; bit 11 (0x0800) set for an entry whose name is not ASCII, the
//   name is then UTF-8 (4.4.4 and appendix D). The parts of a 3MF package have ASCII names, as the
//   Open Packaging Conventions ask (ECMA-376 part 2, 7.3.3), so their flag is 0.
// - compression method 0; compressed size equal to uncompressed size.
// - time 0 and date 0x0021: 1 January 1980, 0:00:00 (4.4.6: MS-DOS format; the bits of the two
//   words are in Microsoft's description of `DosDateTimeToFileTime`: day in bits 0 to 4, month in
//   5 to 8, years since 1980 in 9 to 15). The engine has no clock, and the same model gives the
//   same bytes.
// - CRC-32 (4.4.7: register preset to all ones, the result complemented), with the polynomial
//   0xedb88320 of the sample code of RFC 1952, section 8.
// - no extra field, no comment, no data descriptor, one disk; internal and external attributes 0.
// - No ZIP64. The values 0xFFFF and 0xFFFFFFFF of a field of the end record mean "see the ZIP64
//   record" (4.4.1.4), which is not written, so they must not come up as real values. It throws
//   `QueryFailure('failed')`, before anything is laid out, for
//   - 65 535 entries or more;
//   - an entry of 0xFFFFFFFF bytes or more, or an archive in which an offset or the size of the
//     central directory would reach 0xFFFFFFFF (4 GiB less one byte);
//   - a name longer than 65 535 bytes (it would be written with a wrong length).
//   The 3MF core specification asks producers for a plain ZIP when the data fits (1.1).
export declare function crc32(bytes: Uint8Array): number;
export declare function storedZip(entries: readonly ZipEntry[]): Uint8Array;

// ================================================================ the 3MF package

// 3MF Core Specification 1.4.0 (3MF Consortium, 6 February 2025) and the Open Packaging
// Conventions (ECMA-376 part 2, fifth edition, December 2021). Three ZIP items, in this order:
export const THREE_MF = {
  // The Media Types stream of the package (OPC 7.3.7: an item of this name; 7.2.3.2: a `Types`
  // element with `Default` elements by extension; schema `opc-contentTypes.xsd`). It does not
  // have to cover a Relationships part (7.2.3.2.1); the default for `rels` is there all the same,
  // with the media type of 6.5.2.1.
  contentTypes: {
    item: '[Content_Types].xml',
    namespace: 'http://schemas.openxmlformats.org/package/2006/content-types',
    defaults: { rels: 'application/vnd.openxmlformats-package.relationships+xml', model: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }, // 3MF appendix C.1: the 3D Model part
  },
  // The package Relationships part (OPC 6.5.2.2: its name is "/_rels/.rels"; schema
  // `opc-relationships.xsd`), with the one relationship a 3MF document must have: the StartPart
  // relationship to the 3D Model part (3MF 2.1.1; the type is appendix C.2). `Id` is an XML ID.
  relationships: {
    item: '_rels/.rels',
    namespace: 'http://schemas.openxmlformats.org/package/2006/relationships',
    startPart: { id: 'rel0', type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel', target: '/3D/3dmodel.model' },
  },
  // The 3D Model part, named as 2.2.3 recommends ("/3D/" and the extension ".model"); a ZIP item
  // name has no leading slash (OPC 7.3.4).
  model: {
    item: '3D/3dmodel.model',
    namespace: 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02', // appendix C.3
    unit: 'millimeter', // 3.4: the attribute `unit` of `model`
    application: 'trymesh', // the metadata `Application` (3.4.1, table 3-1)
  },
} as const;

// The 3D Model part is UTF-8 XML without a DTD (2.3.2), with elements in the order the schema
// gives (appendix B.1.1) and every resource defined before it is referred to (3.4):
//
//   <model unit="millimeter" xmlns="…core/2015/02">
//     <metadata name="Application">trymesh</metadata>
//     <resources>
//       <basematerials id="1">                              only when a body has a colour
//         <base name="PETG" displaycolor="#FF8800"/>        one per pair of a material and a colour
//       </basematerials>
//       <object id="2" type="model" name="Lid" partnumber="lid" pid="1" pindex="0">
//         <mesh>
//           <vertices> <vertex x="…" y="…" z="…"/> … </vertices>
//           <triangles> <triangle v1="…" v2="…" v3="…"/> … </triangles>
//         </mesh>
//       </object>
//       …                                                   an object per body, in the order of the bodies
//     </resources>
//     <build> <item objectid="2"/> … </build>               an item per object, without a transform
//   </model>
//
// What a body gives its object (`object`, chapter 4):
// - `id`: resource IDs are positive integers, unique in the model (3.4.2; ST_ResourceID): 1 is
//   the group of base materials when there is one, the objects follow from the next number.
// - `type`: `model`. A mesh of that type has to be a closed, consistently oriented surface with
//   the normals outwards (4.1): what the kernel port guarantees of a body, and how `Solid` winds
//   its triangles. `v1`, `v2`, `v3` have to be distinct (4.1.4.1): checked, `failed` otherwise.
// - `name`: the name of the body (`evaluation.bodyProperties[body].name`: its own name, else that
//   of the feature that made it; a copy adds its number).
// - `partnumber`: the ID of the body, which stays the same when the name changes (chapter 4: "a
//   way to keep track of objects").
// - `pid`, `pindex`: the base material of the body, when it has a colour.
// - `vertices`: the positions of the mesh that a triangle names, in their order, in millimetres,
//   by `float32Text`; the triangles index them by their new numbers. A mesh of the kernel may
//   hold positions no triangle uses (the lid of scenario 12: 148 of 883, each a copy of a used
//   one), and 4.1.3 asks a producer not to write duplicate vertices.
// A base material (chapter 5) needs a name and a display colour, so only a body with a colour
// gets one: `displaycolor` is its colour (`#RRGGBB`, 5.1.1), `name` its material label, or the
// colour itself when it has none. Two bodies with the same pair share the entry. Names of base
// materials should differ (5.1): when one label comes with several colours, each of those names
// is the label, a space and the colour. (A label that itself ends in a colour can still meet
// such a name; "should", and not chased further.) The colour is for display only (5.1, the note):
// it does not tell a printer what to print with, and the format does not claim it.
export interface ThreeMfObject {
  body: Id;
  name: string;
  color?: string; // `#rrggbb`, as the body properties hold it
  material?: string;
}
export interface BaseMaterial {
  name: string;
  displaycolor: string; // `#RRGGBB`
}
// The base materials of a list of objects, and for every object the index of its entry (or
// undefined). Its own function, so the rule of the names has a test without a mesh.
export declare function baseMaterials(objects: readonly ThreeMfObject[]): { bases: BaseMaterial[]; indexOf: (number | undefined)[] };

// ================================================================ the outline of a plane

// `export/outline.ts`: the cut of a plane as loops a drawing can be written from. One function for
// both formats, so DXF and SVG always show the same shape.
//
// A piece of a loop starts at the corner `at` and runs to the corner of the next piece (the last
// one to the first corner: a loop is closed).
// - `turn` 0: a straight piece.
// - otherwise one arc: the arc of the radius `radius` between the two corners, on the side that
//   makes it turn the way the span does and by less than a half turn. `radius` is that of the
//   surface the arc lies on. `turn` is the angle that arc turns by about its own centre, derived
//   from the two corners and the radius (`±2·asin(chord / (2·radius))`): radians, positive
//   counter-clockwise in the x and y of the frame, a quarter turn at most (`QUARTER`; an end
//   piece differs by a hair from its share of the sweep when its end is inside the circle).
// Both numbers describe the same arc, so the two formats draw one curve: DXF writes the turn (as
// a bulge), SVG the radius.
export interface OutlinePiece {
  at: Vec2;
  turn: number;
  radius?: number; // with a `turn` other than 0
}
// - `circle`: the loop is a whole circle; it has no pieces. Centre and radius are those of the
//   exact surface (a cylinder or a cone cut across its axis).
// - otherwise `pieces`, at least two (a loop of one line and one arc is three: an arc is never
//   one piece).
// - `hole`: a hole of a region; an outer loop runs counter-clockwise and a hole clockwise, as in
//   the answer of `section`.
export interface OutlineLoop {
  body: Id;
  hole: boolean;
  circle?: { center: Vec2; radius: number };
  pieces: OutlinePiece[];
}
// The loops in the order of the answer of `section`: body by body, region by region, the outer
// loop of a region before its holes. `about` is what both formats report.
export interface Outline {
  loops: OutlineLoop[];
  about: OutlineAbout;
  empty?: string; // `EMPTY.notCut` or `EMPTY.notCutInPlane(body)` when there is no loop, or a text of `chosenBodies`
}
export const QUARTER = Math.PI / 2;
// A turn this close to a whole number of quarters gets no extra piece: the sweep of a half turn
// comes out of the sum of its angles as π give or take the last digit, and the number of its
// pieces must not depend on that digit.
export const TURN_SLACK = 1e-9; // of a quarter turn

// The outline for the options of a format.
// 1. The bodies: the list; without one, the body of the face when `plane` is a face, else
//    `chosenBodies(context, undefined)`, which may be none.
// 2. The cut: `run` of the query `section` with the same context (a query that builds on another
//    calls its `run`), with those bodies (also when there are none: `run` takes an empty list,
//    and the plane is then still resolved), `outline: 'spans'` and a budget no model reaches
//    (`Number.MAX_SAFE_INTEGER`; `run` is called directly, so the check of the arguments does not
//    limit it), so nothing is left out. Its refusals pass through as they are. What `section`
//    says about where the cut is taken holds here: `below` the plane by the precision of the
//    coordinates, so a face as the plane gives all the material of its body just under the face,
//    not the face alone. `empty`: the text of `chosenBodies` when no body was taken; else, when
//    no loop was cut, `EMPTY.notCutInPlane` with the first body of `inPlane`, or `EMPTY.notCut`.
// 3. The loops, from the spans of `section` (a span is a line, an arc or a curve, and its ends
//    are corners of the mesh, so the spans of a loop join exactly):
//    - a loop of one arc span is a whole circle: `circle`, with the centre and radius of the span;
//    - a line: one straight piece;
//    - an arc: `max(2, ceil(|sweep| / QUARTER − TURN_SLACK))` pieces. Their corners: the first is
//      `from` of the span, a corner of the mesh; the others are computed on the circle of the
//      surface, at equal steps of the sweep from the angle of `from` (centre, radius, angle). The
//      last piece ends at the next span, at a corner of the mesh again. Every piece is the arc of
//      the radius of the surface between its two corners.
//      Why at least two, and a quarter turn at most: a corner of the mesh lies on the circle or
//      inside it, by up to the sagitta of the polygon where another face cuts the round face.
//      With at least two pieces no piece has both its ends at such corners, and a piece of
//      a quarter turn at most with one end on the circle and the other `s` inside it stays within
//      `s` of the circle everywhere, the furthest at that corner itself. One arc of a quarter turn
//      with both ends `s` inside is 1.41·`s` off in its middle; one arc of a half turn has its
//      centre off by the root of twice the radius times `s` (0.32 mm for 0.01 mm on a radius of 5).
//      Both measured; design.md, "Measured".
//    - a curve (what has no exact form: a tooth flank, an ellipse): straight pieces through its
//      points.
// 4. `about.bounds`: the box of what is drawn: the corners, for an arc piece the points of the
//    circle of that piece (not of the surface) furthest along x and y that it passes, and the box
//    of a whole circle.
export declare function outlineOf(context: QueryContext, options: RunArgsOf<typeof OUTLINE_OPTIONS>): Outline;

// ================================================================ the DXF file

// `export/dxf.ts`. DXF Reference, AutoCAD 2012 (Autodesk). The file is the minimal one the
// reference describes under "Writing a DXF File": no TABLES and no BLOCKS (both may be left out,
// and a layer an entity names without a LAYER table is created by the reader), and ENTITIES
// written as the example program of that chapter writes them: the type, the layer and the
// coordinates, nothing else.
// What the reference does not say, and the design takes on (design.md, "Known limits"):
// - Its tables of POLYLINE and VERTEX list a subclass marker (group 100) and its common groups
//   a handle (group 5), which the files of its own release carry. The example program writes
//   neither, and the reference states no rule for when they may be left out. The file names the
//   release of the old-style polyline, AC1009, and leaves both out; `ezdxf` reads it as a file
//   of that release and its audit finds nothing.
// - It says the HEADER "can be omitted if you don't set header variables", not that a HEADER may
//   hold three variables only. `ezdxf` takes it.
// A group is two lines: the code, then the value. The reference does not name the end of a line;
// CR LF is written. The text is ASCII: nothing of the model is written but numbers.
export const DXF = {
  // HEADER: `$ACADVER` (group 1) names the release the file follows: AC1009 is R11 and R12,
  // whose polyline is POLYLINE with VERTEX and SEQEND. `$INSUNITS` (group 70) 4 is millimetres;
  // `$MEASUREMENT` (group 70) 1 is metric. The reference lists both among the variables of its
  // own release and does not say what a reader does with them in a file of release 12; one that
  // skips them has a drawing in bare units, which are millimetres.
  version: 'AC1009',
  insunits: 4,
  measurement: 1,
  // group 8, the layer of an entity
  layers: { outer: 'OUTER', hole: 'HOLES' },
} as const;
// ENTITIES, a loop after another in the order of the outline:
// - a whole circle: CIRCLE with 8 (layer), 10, 20, 30 (centre; z is 0) and 40 (radius);
// - any other loop: POLYLINE with 8, 66 = 1 (vertices follow; obsolete since, "ignore if
//   present"), 10, 20, 30 = 0 (the dummy point) and 70 = 1 (closed); then a VERTEX per piece with
//   8, 10, 20, 30 (the corner; z is 0) and, for an arc piece, 42: the bulge, `tan(turn / 4)` ("the
//   tangent of one fourth the included angle for an arc segment, made negative if the arc goes
//   clockwise from the start point to the endpoint"); then SEQEND with 8. The first corner is not
//   repeated: the flag closes the loop, and the piece of the last vertex runs to the first.
// The file ends with ENDSEC and EOF. Coordinates and radii by `plain`; a bulge with twelve
// decimals. A drawing of nothing is the HEADER and an empty ENTITIES section.
export declare function dxfText(outline: Outline): string;

// ================================================================ the SVG file

// `export/svg.ts`. Scalable Vector Graphics (SVG) 1.1, second edition (W3C Recommendation,
// 16 August 2011). UTF-8, no DTD.
export const SVG = {
  namespace: 'http://www.w3.org/2000/svg',
  margin: 1, // mm around the box of the drawing, so a line on its edge is not cut in half
  stroke: { color: '#000000', width: 0.1 }, // mm; nothing is filled
} as const;
// - The root: `width` and `height` in `mm` and a `viewBox` of the same two numbers (7.7), so one
//   user unit is one millimetre whatever a reader takes a pixel for: the box of the drawing and
//   the margin on every side. A drawing of nothing has no box: the margin about the origin.
// - The y axis of SVG points down (7.3) and that of the plane up: a point (u, v) is written
//   (u, −v), with no transform. The drawing is then not mirrored: it looks as the section does in
//   the app seen against the normal.
// - A group `g` with `fill="none"` and the stroke; in it a group per body, in the order of the
//   outline, with a `title` that holds the name of the body (5.4; by `xmlText`).
// - A whole circle: `circle` with `cx`, `cy`, `r` (9.3). Any other loop: one `path` (8.3):
//   `M` to the first corner, then per piece `L x y` or `A r r 0 0 f x y` to the next corner, and
//   `Z`; the last straight piece is the `Z` itself. `r` is the radius of the piece. The large-arc
//   flag is always 0 (a piece turns by less than a half turn). The sweep flag `f` is 1 for a piece that
//   turns clockwise in the plane (`turn < 0`) and 0 otherwise: SVG calls the direction of
//   growing angle in its own axes positive (8.3.8), and with y down that is clockwise in the
//   plane.
// - `class="outer"` or `class="hole"` on every circle and path.
// Numbers by `plain`.
export declare function svgText(outline: Outline, nameOf: (body: Id) => string): string;

// ================================================================ the app

// The app's types cannot be imported into a draft (packages/app imports three.js; see the
// contract of 1b). What the package adds there, as stand-ins; in the code it is
// `packages/app/src/panels/export.ts`, with the handling of a draft of arguments moved out of
// `panels/query.ts` into a module both panels use (`panels/args.ts`: `specAt`, `withValue`,
// `selected`, `given`, `nextToArm` and the rows built from `ArgSpecs`; code moved, no behaviour
// changes).
//
// The form of an export is the generic form of a query (D39) over the options of a format: the
// same controls by kind of argument (`queries/controls.ts`), the same picking of a plane or
// a face in the view, the same marking of the option a refusal names.
// - `draft`: the options being filled in, in the shape of their description.
// - `armed`: the control that takes the next selection of the view.
// - `problem`: the last refusal or the text of `empty`, shown until the form changes.
export interface OpenExport {
  format: ExportFormatAfter;
  draft: Record<string, unknown>;
  armed?: (string | number)[];
  problem?: { message: string; arg?: (string | number)[] };
}
// One export form or one query is open in the model panel at a time: they share the place and the
// selection of the view. Opening one closes the other.
export interface ExportPanel {
  open?: OpenExport;
}
// What *Export* of the form does: `engine.export(format, draft, marker === null ? {} : { at: marker })`
// (the marker is null at the end of the timeline, and `at` takes no null: the form of a query
// does the same), and then
// - refused: `problem` from the error;
// - `empty`: `problem` with that text, nothing is saved;
// - one file (`layout: 'file'`): saved under its suggested name;
// - a set (`layout: 'directory'`): saved as one ZIP, `<format>.zip`, built by `storedZip` from the
//   files under their paths.
// The stand-in of the save of the app (`download` of `dom.ts`).
export type SaveFile = (name: string, bytes: Uint8Array, mediaType: string) => void;
export declare function runExportForm(panel: ExportPanel, engine: EngineAfter2g, marker: Id | null, save: SaveFile): void;
