// Package 2g written out as calls: its part of validation scenario 12 (the box with a lid and
// screw posts), the three formats through `Engine.export`, the tool `export` of the server and
// the form of the app. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot
// be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that must
// not compile.
//
// The numbers in the comments were measured on 2026-11-16 with the prototype of the writers over
// the box as `packages/scenarios/test/scenario12.test.ts` builds it for the part of 2c (every step
// of `box.ts`, chord tolerance 0.01 mm), and the files were read back by independent readers
// (design.md, "Measured"). They become the expectations of the test in packages/scenarios.

import type { Command, ExportFile, Exported, FaceName, Id, PlaneRef, QueryOutcome, SketchSolver, SolidKernel } from '../../../packages/engine/src/index';
import type { Deflater, EngineAfter2g, ExportFormState, ExportFormatAfter, ExportHost, ExportOptionsAfter, ExportPanel, MeshAbout, OutlineAbout, SaveFile, ZipEntry } from './contract';
import { DXF, EMPTY, QUARTER, SVG, THREE_MF, TURN_ALLOWANCE, ZIP_ENTRY, createEngine, createPakoDeflater, runExportForm, runExportFormWith, storedZip, zip } from './contract';

// The box of scenario 12 after the part of 2c: the bodies `box` and `lid`; the lid 4.36 thick
// (the plate the countersinks of the M3 screws need), four countersunk screw holes over the posts,
// the countersink by hand and its bore in the middle; the box with its cavity, a drafted rib,
// a bracket, four posts with holes for inserts and a brace.
declare const engine: EngineAfter2g;
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
// The one file of an export of the layout `file`.
const only = (exported: Exported): ExportFile => (exported.layout === 'file' && exported.files.length === 1 && exported.empty === undefined ? exported.files[0] : fail(exported.empty ?? 'one file is expected'));
const text = (file: ExportFile): string => new TextDecoder().decode(file.bytes);
// `about` of a file is plain JSON to the catalog; a format knows its shape. The two shapes go into
// the field as they are (they are type aliases):
export const fits: ExportFile['about'][] = [{ bodies: ['box'], triangles: 1440 } satisfies MeshAbout, {} as OutlineAbout];
const meshAbout = (file: ExportFile): MeshAbout => file.about as MeshAbout;
const outlineAbout = (file: ExportFile): OutlineAbout => file.about as OutlineAbout;
const count = (whole: string, piece: string): number => whole.split(piece).length - 1;
const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const UNDER_LID = onFace('lid', { feature: 'lid', role: 'startCap' }); // the underside of the plate of the lid; its normal points down
const LID_TOP = onFace('lid', { feature: 'lid', role: 'endCap' });
const FLOOR = onFace('box', { feature: 'cavity', role: 'startCap' });

// What the test reads a stored ZIP back with: a few lines of its own over the three records
// (`storedZip` is not read by the code it tests), and `crc32` of `node:zlib` for the checksums.
declare function itemsOf(zip: Uint8Array): ZipEntry[];

// ---------------------------------------------------------------- a. the box and its lid as 3MF

// Without options: the printed bodies, as objects of one document.
export function boxAs3mf(): boolean {
  const file = only(unwrap(engine.export('3mf', {})));
  const about = meshAbout(file);
  const items = itemsOf(file.bytes);
  const model = new TextDecoder().decode(items[2].bytes);
  return (
    file.path === 'model.3mf' &&
    file.mediaType === 'model/3mf' &&
    about.bodies.join() === 'box,lid' &&
    about.triangles === 2926 && // 1440 and 1486
    // the three items of a package, in this order; the file is 1.21 times the STL of the same bodies (177 803 and 146 384 bytes)
    items.map((item) => item.name).join() === [THREE_MF.contentTypes.item, THREE_MF.relationships.item, THREE_MF.model.item].join() &&
    // an object per body: its name, its ID as the part number, no property (no body has a colour yet)
    model.includes('<object id="1" type="model" name="box" partnumber="box">') &&
    model.includes('<object id="2" type="model" name="lid" partnumber="lid">') &&
    !model.includes('<basematerials') &&
    // the vertices a triangle names: all 720 of the box, 735 of the 883 positions of the lid
    count(model, '<vertex ') === 720 + 735 &&
    count(model, '<triangle ') === 2926 &&
    model.includes('<build><item objectid="1"/><item objectid="2"/></build>')
  );
}
// The mesh of the file is the mesh of the body: every triangle of the file has the corners of
// the triangle of the solid, each coordinate read back as the very float32, so the file and the
// STL of the same body hold the same numbers. (The lid: its vertices are renumbered, because the
// positions no triangle names are left out.)
export function sameMesh(): boolean {
  const { positions, triangles } = engine.getState().evaluation.bodies['lid'].solid;
  const model = new TextDecoder().decode(itemsOf(only(unwrap(engine.export('3mf', { bodies: ['lid'] }))).bytes)[2].bytes);
  const vertices = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((vertex) => [vertex[1], vertex[2], vertex[3]].map(Number));
  const corners = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap((triangle) => [triangle[1], triangle[2], triangle[3]].map(Number));
  return corners.length === triangles.length && corners.every((vertex, i) => [0, 1, 2].every((k) => Math.fround(vertices[vertex][k]) === positions[3 * triangles[i] + k]));
}

// The body properties of 3a reach the file: the name, and the colour as a base material named by
// the material. A name is a text of the user: what XML does not take as it is, is escaped.
const dressed: Command = {
  type: 'batch',
  commands: [
    { type: 'setBodyProperties', body: 'lid', patch: { name: 'Lid <A&B>', color: '#ff8800', material: 'PETG' } },
    { type: 'setBodyProperties', body: 'box', patch: { color: '#30343a' } },
  ],
};
export function withProperties(): boolean {
  const state = engine.preview(dressed);
  if (!state.ok) return fail(state.error.message);
  // an export of a state that is only previewed: nothing is written to the document
  const model = new TextDecoder().decode(itemsOf(only(unwrap(engine.export('3mf', {}, { state: state.state }))).bytes)[2].bytes);
  return (
    // the box has a colour and no material: its base material is named by the colour
    model.includes('<basematerials id="1"><base name="#30343a" displaycolor="#30343A"/><base name="PETG" displaycolor="#FF8800"/></basematerials>') &&
    // the group of base materials took the ID 1, so the objects follow from 2
    model.includes('<object id="2" type="model" name="box" partnumber="box" pid="1" pindex="0">') &&
    model.includes('<object id="3" type="model" name="Lid &lt;A&amp;B&gt;" partnumber="lid" pid="1" pindex="1">')
  );
}

// Which bodies: the default follows the use of a body (D48), a list is taken as it is.
export function whichBodies(): (string | undefined)[] {
  const asReference = (bodies: Id[]) => {
    const state = engine.preview({ type: 'batch', commands: bodies.map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'reference' } })) });
    return state.ok ? { state: state.state } : fail(state.error.message);
  };
  const bodiesOf = (exported: Exported): string => meshAbout(only(exported)).bodies.join();
  return [
    bodiesOf(unwrap(engine.export('3mf', {}, asReference(['box'])))), // 'lid': the box is a bought part now
    bodiesOf(unwrap(engine.export('3mf', { bodies: ['box'] }, asReference(['box'])))), // 'box': listed, whatever its use
    unwrap(engine.export('3mf', {}, asReference(['box', 'lid']))).empty, // EMPTY.noPrintedBody
    bodiesOf(unwrap(engine.export('3mf', {}, { at: 'box' }))), // 'box': the state after the first extrusion, before the lid
  ];
}

// ---------------------------------------------------------------- b. the lid as a drawing for a laser

// The plate of the lid half a millimetre above its underside, where every hole has the diameter
// it goes through with. The plane is a face of the lid, so the lid is the body.
export function lidAsDxf(): boolean {
  const file = only(unwrap(engine.export('dxf', { plane: UNDER_LID, offset: -0.5 })));
  const about = outlineAbout(file);
  const drawing = text(file);
  const lines = drawing.split('\r\n');
  return (
    file.path === 'outline.dxf' &&
    file.mediaType === 'image/vnd.dxf' &&
    about.bodies.join() === 'lid' &&
    about.loops === 6 &&
    about.circles === 5 &&
    Math.abs(about.area - 3939.9012) < 1e-3 && // 80 × 50 less the five holes as the mesh has them
    // the frame of the underside looks down: its x runs against the X of the model
    about.bounds?.min.join() === '-80,0' &&
    about.bounds?.max.join() === '0,50' &&
    about.inPlane === undefined &&
    // the header: the release, millimetres, metric
    drawing.startsWith(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', DXF.version, '9', '$INSUNITS', '70', String(DXF.insunits), '9', '$MEASUREMENT', '70', String(DXF.measurement), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'].join('\r\n')) &&
    drawing.endsWith(['0', 'ENDSEC', '0', 'EOF', ''].join('\r\n')) &&
    // the outline: one closed polyline of four corners, no bulge
    count(drawing, 'POLYLINE') === 1 &&
    count(drawing, 'VERTEX') === 4 &&
    !lines.some((line, i) => line === '42' && i % 2 === 0) &&
    // the holes: the four bores of the screws (3.4 and the allowance of 0.2 across) over the posts, and the bore in the middle
    count(drawing, ['0', 'CIRCLE', '8', DXF.layers.hole, '10', '-71.3', '20', '8.7', '30', '0', '40', '1.8'].join('\r\n')) === 1 &&
    count(drawing, ['0', 'CIRCLE', '8', DXF.layers.hole, '10', '-40', '20', '25', '30', '0', '40', '2.5'].join('\r\n')) === 1 &&
    count(drawing, 'CIRCLE') === 5
  );
}
// The same cut as SVG: the same loops, y turned over.
export function lidAsSvg(): boolean {
  const file = only(unwrap(engine.export('svg', { plane: UNDER_LID, offset: -0.5 })));
  const drawing = text(file);
  return (
    file.path === 'outline.svg' &&
    file.mediaType === 'image/svg+xml' &&
    // the box of the drawing and a millimetre around it
    drawing.includes(`<svg xmlns="${SVG.namespace}" version="1.1" width="82mm" height="52mm" viewBox="-81 -51 82 52">`) &&
    drawing.includes('<title>lid</title>') &&
    drawing.includes('<path class="outer" d="M -80 0 L 0 0 L 0 -50 L -80 -50 Z"/>') &&
    drawing.includes('<circle class="hole" cx="-71.3" cy="-8.7" r="1.8"/>') &&
    drawing.includes('<circle class="hole" cx="-40" cy="-25" r="2.5"/>') &&
    count(drawing, '<circle ') === 5
  );
}
// The top face of the lid as the plane, without an offset: the cut just under the face, so the
// circles are the mouths of the countersinks (less the precision of the coordinates on a cone of
// 45°), and the lid is named in `inPlane`.
export function topOfTheLid(): boolean {
  const file = only(unwrap(engine.export('svg', { plane: LID_TOP })));
  const about = outlineAbout(file);
  return text(file).includes('<circle class="hole" cx="8.7" cy="-8.7" r="3.45992"/>') && text(file).includes('<circle class="hole" cx="40" cy="-25" r="3.99992"/>') && about.inPlane?.[0].body === 'lid';
}

// ---------------------------------------------------------------- c. the box across its cavity

// A base plane and an offset; without a list the printed bodies. The plane at z = 10 cuts the box
// (the lid starts at 30): the ring of the walls with the rib and the bracket, three free posts as
// whole circles, and the fourth post grown into the bracket, whose round side is an arc.
export function boxAcross(): boolean {
  const file = only(unwrap(engine.export('dxf', { plane: XY, offset: 10 })));
  const about = outlineAbout(file);
  const drawing = text(file);
  // every bulge is that of a piece of a quarter turn at most (give or take what the precision of
  // the coordinates of an end makes of it), and no arc is one piece
  const bulges = drawing.split('\r\n').flatMap((line, i, lines) => (line === '42' && i % 2 === 0 ? [Number(lines[i + 1])] : []));
  return (
    about.bodies.join() === 'box' &&
    about.loops === 6 && // four outer loops (the ring and three posts) and two holes (the cavity, and the cell the bracket closes)
    about.circles === 3 &&
    Math.abs(about.area - 755.5653) < 1e-3 &&
    count(drawing, ['0', 'POLYLINE', '8', DXF.layers.outer].join('\r\n')) === 1 && // the ring is the one outer polyline; the free posts are circles
    count(drawing, ['0', 'POLYLINE', '8', DXF.layers.hole].join('\r\n')) === 2 &&
    bulges.length === 3 && // the round side of the fourth post turns by 4.37 rad (250°): three pieces
    bulges.every((bulge) => Math.abs(bulge) <= Math.tan((QUARTER * (1 + TURN_ALLOWANCE)) / 4))
  );
}
// What a face as the plane means: the floor of the cavity gives the whole slab under it, 80 × 50,
// not the floor alone (76 × 46). The floor alone is cut a little above it, where the cavity is.
export function floorOfTheCavity(): [number, number] {
  const under = outlineAbout(only(unwrap(engine.export('svg', { plane: FLOOR }))));
  const above = outlineAbout(only(unwrap(engine.export('svg', { plane: FLOOR, offset: 0.5 }))));
  return [under.area, above.loops]; // 4000; the walls and what stands on the floor
}
// A body that only stands on the plane is not cut: the export holds nothing and says where the
// body is. The tool `export` refuses with that text; the form of the app shows it.
export const standsOnThePlane = (): boolean => unwrap(engine.export('dxf', { plane: XY })).empty === EMPTY.notCutInPlane('box');
// An export that holds nothing still returns its one file: a drawing without entities, a box of
// the margin alone, a package without objects. Its `about` is whole: the plane is resolved also
// when no body is taken.
export function nothingToWrite(): boolean {
  const unprinted = engine.preview({ type: 'batch', commands: ['box', 'lid'].map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'reference' } })) });
  if (!unprinted.ok) return fail(unprinted.error.message);
  const drawing = unwrap(engine.export('svg', { plane: XY }));
  const model = unwrap(engine.export('3mf', {}, { state: unprinted.state }));
  const noBody = unwrap(engine.export('dxf', { plane: XY, offset: 10 }, { state: unprinted.state }));
  return (
    drawing.empty === EMPTY.notCutInPlane('box') &&
    drawing.files.length === 1 &&
    new TextDecoder().decode(drawing.files[0].bytes).includes('width="2mm" height="2mm" viewBox="-1 -1 2 2"') &&
    outlineAbout(drawing.files[0]).bounds === undefined &&
    model.empty === EMPTY.noPrintedBody &&
    itemsOf(model.files[0].bytes).length === 3 &&
    noBody.empty === EMPTY.noPrintedBody &&
    !new TextDecoder().decode(noBody.files[0].bytes).includes('POLYLINE') &&
    outlineAbout(noBody.files[0]).frame.origin[2] === 10 &&
    outlineAbout(noBody.files[0]).loops === 0
  );
}
// The state: before the holes were made, the plate has its outline and nothing else.
export const beforeTheHoles = (): number => outlineAbout(only(unwrap(engine.export('dxf', { plane: UNDER_LID, offset: -0.5 }, { at: 'lipInside' })))).loops; // 1

// ---------------------------------------------------------------- d. refusals

export function refusals(): (string | undefined)[] {
  const code = (outcome: QueryOutcome<Exported>): string | undefined => (outcome.ok ? undefined : `${outcome.error.code} ${(outcome.error.arg ?? []).join('/')}`);
  return [
    // a round face is no plane: the refusal of the section, at the option of the same name
    code(engine.export('dxf', { plane: onFace('box', { feature: 'posts', role: 'side', curve: 'pa' }) })), // 'notAvailable plane'
    code(engine.export('svg', { plane: XY, bodies: ['nope'] })), // 'notAvailable bodies/0'
    code(engine.export('3mf', { bodies: [] })), // 'invalidArguments bodies'
    // an option the format does not have, from a caller that is not typed
    code(engine.export('dxf', { plane: XY, flip: true } as never)), // 'invalidArguments flip'
  ];
}
export const wrong = (): void => {
  // @ts-expect-error an outline needs its plane
  engine.export('dxf', {});
  // @ts-expect-error 3MF has no file per body: that is the format `stl`, or a list of one body
  engine.export('3mf', { perBody: true });
  // @ts-expect-error the plane is a reference, not the name of a face
  engine.export('svg', { plane: 'lid/endCap' });
  // @ts-expect-error a format that does not exist
  engine.export('step', {});
};

// ---------------------------------------------------------------- e. the tool `export` of the server

// Nothing of `packages/mcp/src` changes: the tool takes any format of the catalog and writes its
// files. These are its inputs (`{ format, path, options?, overwrite?, at?, after? }`); the rows
// of the two typed tables of `packages/mcp/test/export-formats.test.ts` are the fixtures below.
export const overMcp = [
  { format: '3mf', path: 'out/box.3mf' },
  { format: 'dxf', path: 'out/lid.dxf', options: { plane: UNDER_LID, offset: -0.5 } },
  // the lid as it would be with a thicker plate: a command previewed first, nothing written to the document
  { format: 'svg', path: 'out/lid.svg', options: { plane: UNDER_LID, offset: -0.5 }, after: { type: 'setParameter', name: 'lidT', expr: '6' } },
] as const;
// Over the model of that test (two discs, `low` from z = 0 and `high` on it), typed as the tables
// of the test are (there over every format of the catalog).
type Added = Exclude<ExportFormatAfter, 'stl'>;
export const FIXTURES: { [F in Added]: ExportOptionsAfter<F> } = {
  '3mf': { bodies: ['low'] },
  dxf: { plane: XY, offset: 5 },
  svg: { plane: XY, offset: 5 },
};
export const OPTIONS: { [F in Added]: { [K in keyof Required<ExportOptionsAfter<F>>]: {} extends Pick<ExportOptionsAfter<F>, K> ? 'optional' : 'required' } } = {
  '3mf': { bodies: 'optional' },
  dxf: { plane: 'required', offset: 'optional', bodies: 'optional' },
  svg: { plane: 'required', offset: 'optional', bodies: 'optional' },
};

// ---------------------------------------------------------------- f. the form of the app

// The menu *Export…* of the toolbar opens the form of a format; a click on the underside of the
// lid fills the armed option `plane`; *Export* saves the file under its suggested name.
export function fromTheApp(): string[] {
  const saved: string[] = [];
  const save: SaveFile = (name, bytes) => void saved.push(`${name} ${bytes.length}`);
  const panel: ExportPanel = { open: { format: 'dxf', draft: { plane: UNDER_LID, offset: -0.5 } } };
  runExportForm(panel, engine, null, save); // 'outline.dxf 682'; the marker is at the end of the timeline, so no `at` is passed
  // a set of files is saved as one ZIP: the STL per body of the format of D37
  const set = unwrap(engine.export('stl', { perBody: true }));
  if (set.layout === 'directory') save('stl.zip', storedZip(set.files.map((file) => ({ name: file.path, bytes: file.bytes }))), 'application/zip'); // box.stl, lid.stl
  // a refusal stays in the form, at its option
  const refused: ExportPanel = { open: { format: 'svg', draft: {} } };
  runExportForm(refused, engine, null, save);
  return [...saved, refused.open?.problem?.arg?.join('/') ?? '']; // …, 'plane'
}

// ---------------------------------------------------------------- the part of the scenario

export function scenario12g(): boolean {
  const [alone, listed, none, early] = whichBodies();
  const [under, above] = floorOfTheCavity();
  const [round, missing, emptyList, unknown] = refusals();
  return (
    boxAs3mf() &&
    sameMesh() &&
    withProperties() &&
    alone === 'lid' &&
    listed === 'box' &&
    none === EMPTY.noPrintedBody &&
    early === 'box' &&
    lidAsDxf() &&
    lidAsSvg() &&
    topOfTheLid() &&
    boxAcross() &&
    Math.abs(under - 4000) < 1e-6 &&
    above > 1 &&
    standsOnThePlane() &&
    nothingToWrite() &&
    beforeTheHoles() === 1 &&
    round === 'notAvailable plane' &&
    missing === 'notAvailable bodies/0' &&
    emptyList === 'invalidArguments bodies' &&
    unknown === 'invalidArguments flip'
  );
}

// ---------------------------------------------------------------- g. the addition: the package compressed (deflate.md)

// The numbers of this part were measured on 2026-11-17 with a prototype of the writer over the
// files the engine of master writes for the same box, compressed by `pako` 3.0.3 as the adapter
// calls it, and read back by independent readers (deflate.md, "Measured").

// The engine of the scenario is created with the compressor, as the app and the server create
// theirs: `packages/scenarios/test/kit.ts` gets the one line, and the box above is built in it.
declare const solver: SketchSolver;
declare const kernel: SolidKernel;
const deflater: Deflater = createPakoDeflater();
export const composed = (): EngineAfter2g => createEngine({ solver, kernel, deflater }); // what `newEngine()` of the kit returns; an engine starts with no body
declare const compressing: EngineAfter2g; // such an engine with the box of this file built in it: `engine` above, after the addition

// What the test reads a ZIP of the engine back with after the addition: the reader of the test
// (`packages/engine/test/zip-reader.ts`) takes an entry that is stored or deflated, and inflates
// a deflated one with `node:zlib`, which shares no code with the compressor. It still checks
// that the directory and the local headers agree and every checksum, and now also that the
// inflater read the whole stream of an entry and nothing after it.
interface ReadItem extends ZipEntry {
  method: number; // 0 or 8
  needed: number; // version needed to extract: 10 or 20
  compressed: number; // the bytes the entry takes in the archive
}
declare function readItems(zip: Uint8Array): ReadItem[];

// The box and its lid as 3MF, compressed: the same package, a sixth of the size.
export function boxAs3mfCompressed(): boolean {
  const file = only(unwrap(compressing.export('3mf', {})));
  const items = readItems(file.bytes);
  // the package an engine without a compressor writes: the same items, stored. The scenario needs
  // no second engine for it (the tests of the engine pin that equality against bytes of master)
  const stored = zip(items.map(({ name, bytes }) => ({ name, bytes })));
  const stl = only(unwrap(compressing.export('stl', {})));
  return (
    // the three items in their order, each deflated: 319 to 197 bytes, 260 to 178, 176 882 to 28 956
    items.map((item) => item.name).join() === [THREE_MF.contentTypes.item, THREE_MF.relationships.item, THREE_MF.model.item].join() &&
    items.every((item) => item.method === ZIP_ENTRY.deflated.method && item.needed === ZIP_ENTRY.deflated.version && item.compressed < item.bytes.length) &&
    readItems(stored).every((item, i) => item.method === ZIP_ENTRY.stored.method && item.needed === ZIP_ENTRY.stored.version && item.bytes.length === items[i].bytes.length) &&
    // 29 673 bytes where the stored file has 177 803: a fifth of the STL of the same bodies (146 384 bytes), not a fifth more
    stored.length === 177803 &&
    file.bytes.length < stored.length / 5 &&
    Math.abs(file.bytes.length / stl.bytes.length - 0.2) < 0.01 &&
    // nothing else of the answer changes
    file.path === 'model.3mf' &&
    file.mediaType === 'model/3mf' &&
    meshAbout(file).triangles === 2926 &&
    // the same model gives the same bytes
    only(unwrap(compressing.export('3mf', {}))).bytes.every((byte, k) => byte === file.bytes[k])
  );
}

// The writer by itself: which entry is deflated.
declare const noise: Uint8Array; // 4096 random bytes; the test asserts that the stream of the compressor for them is not shorter (4101 bytes in the spike)
export function whichEntries(): boolean {
  const text = (length: number) => new TextEncoder().encode('a'.repeat(length));
  const items = readItems(zip([{ name: 'a.txt', bytes: text(40) }, { name: 'empty', bytes: new Uint8Array(0) }, { name: 'noise.bin', bytes: noise }], deflater));
  return (
    items[0].method === 8 && items[0].needed === 20 && items[0].compressed === 6 && // forty letters `a` are the six bytes 4b 4c 24 0e 00 00, as zlib writes them at level 6
    items[1].method === 0 && items[1].needed === 10 && items[1].compressed === 0 && // an entry with no bytes is not given to the compressor
    items[2].method === 0 && items[2].compressed === 4096 && // a stream that is not shorter is not written
    // without a compressor the writer is `storedZip` (in the test: a fixture of bytes taken from master, since the name goes)
    zip([{ name: 'a.txt', bytes: text(40) }]).every((byte, k) => byte === storedZip([{ name: 'a.txt', bytes: text(40) }])[k])
  );
}

// The port in a test of the engine, which has no library: any compressor is one, and one that
// fails is a refusal of the export, not an exception. The engines of these calls have no body:
// the package of an empty model has its three items all the same (the model part: 229 bytes),
// so the compressor is called.
declare const byNodeZlib: Deflater; // { deflate: (bytes) => deflateRawSync(bytes) } of `node:zlib`: it compresses for a test only where any valid stream does; no test pins what it writes
const fromATable: Deflater = { deflate: () => new Uint8Array([0x4b, 0x4c, 0x24, 0x0e, 0x00, 0x00]) }; // answers the stream of forty letters `a`: pins the records of a deflated entry to the byte
const broken: Deflater = {
  deflate: () => {
    throw new Error('out of memory');
  },
};
const notBytes = { deflate: () => [1, 2, 3] } as unknown as Deflater;
export function doubles(): (string | number)[] {
  const message = (outcome: QueryOutcome<Exported>): string => (outcome.ok ? '' : `${outcome.error.code}: ${outcome.error.message}`);
  return [
    readItems(unwrap(createEngine({ solver, kernel, deflater: byNodeZlib }).export('3mf', {})).files[0].bytes)[2].method, // 8
    zip([{ name: 'a.txt', bytes: new TextEncoder().encode('a'.repeat(40)) }], fromATable).length, // 30 + 5 + 6 + 46 + 5 + 22 = 114
    message(createEngine({ solver, kernel, deflater: broken }).export('3mf', {})), // 'failed: 3mf: the compressor failed: out of memory'
    message(createEngine({ solver, kernel, deflater: notBytes }).export('3mf', {})), // 'failed: 3mf: the compressor failed: it answered with object where bytes are expected'
  ];
}

// The part of the scenario after the addition: everything of `scenario12g` holds for the engine
// with the compressor as well (the reader of the test inflates the items), and the file is small.
export function scenario12gCompressed(): boolean {
  const [byZlib, pinned, refused, wrong] = doubles();
  return boxAs3mfCompressed() && whichEntries() && byZlib === 8 && pinned === 114 && refused === 'failed: 3mf: the compressor failed: out of memory' && wrong === 'failed: 3mf: the compressor failed: it answered with object where bytes are expected';
}

// Only with a yes of the owner to the second question of deflate.md: a set of files is saved by
// the app as one ZIP compressed by the compressor the app was started with (the STL per body of
// the box: 146 670 bytes stored, 33 795 deflated). Without that yes the form saves `zip(files)`,
// the first line of each pair below.
export function setFromTheApp(): string[] {
  const saved: string[] = [];
  const save: SaveFile = (name, bytes) => void saved.push(`${name} ${readItems(bytes).map((item) => item.method).join()}`);
  const host: ExportHost = { engine: compressing, marker: null, say: () => undefined, refresh: () => undefined };
  runExportFormWith({ exporting: { format: 'stl', draft: { perBody: true } } }, host, save); // 'stl.zip 0,0': a host without a compressor saves the set stored, as today
  const panel: ExportFormState = { exporting: { format: 'stl', draft: { perBody: true } } };
  runExportFormWith(panel, { ...host, deflater }, save); // 'stl.zip 8,8'
  return saved;
}
