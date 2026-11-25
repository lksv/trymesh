// An import format as an entry of the catalog `IMPORT_FORMATS` (import/index.ts), the counterpart
// of an export format (D55): a module in this directory with the description of its options and its
// entry, and a line in the map `ImportFormats` added by declaration merging. A format only turns
// bytes into the corners of triangles in millimetres; the weld, the walls, the shells, the checks and
// the report are the same for every format.
import { OUTLINE_LIMITS } from '../imported-curve';
import type { ArgSpecs, ArgsOf, RunArgsOf } from '../query/args';
import type { ImportedCurve } from '../types';

// A file as a format reads it: the corners of its triangles in millimetres, nine numbers per
// triangle, in the order of the file; and what the format has to say about the file.
export interface ReadTriangles {
  corners: Float32Array;
  about: Record<string, unknown>; // STL: `{ encoding: 'binary' | 'ascii', unit }`
}

// What `read` throws for a file it cannot take: `unreadable`, not a file of the format; `tooLarge`,
// more triangles than an import reads (decided from the count of the file, before the weld).
export class ImportFailure extends Error {
  constructor(
    readonly code: 'unreadable' | 'tooLarge',
    message: string,
  ) {
    super(message);
  }
}

// `R`: what `read` gives, the corners of triangles for a mesh format, curves for an outline format
// (`ReadOutline`, D72).
export interface ImportFormatSpec<S, R = ReadTriangles> {
  title: string;
  summary: string; // what files it reads and what it takes from them; goes to the description for the AI
  extensions: readonly string[]; // without the dot, lower case: how a tool picks the format of a path
  options: S; // described like the options of an export format: checked, described, shown by a form
  read: (bytes: Uint8Array, options: RunArgsOf<S>) => R;
}

// The description of the options of every format, by name.
export interface ImportFormats {}
export type ImportFormat = keyof ImportFormats;
export type ImportOptions<F extends ImportFormat> = ArgsOf<ImportFormats[F]>;
export type ImportCatalog = { [F in ImportFormat]: ImportFormatSpec<ImportFormats[F]> };
// An entry as code that handles any format reads it.
export interface AnyImportFormat {
  title: string;
  summary: string;
  extensions: readonly string[];
  options: ArgSpecs;
  read: (bytes: Uint8Array, options: never) => ReadTriangles;
}

// A description in the map that is not a valid `ArgSpecs` stops the type check here.
type InvalidSpecs = { [F in keyof ImportFormats]: ImportFormats[F] extends ArgSpecs ? never : F }[keyof ImportFormats];
export const IMPORT_FORMATS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [F in InvalidSpecs]: 'is not a valid description' } = true;

// ---------------------------------------------------------------- outline formats (D72)

// What an outline format reads of a file: its curves in millimetres in the order of the file, each
// with the layer it is on, and what it has to say about the file.
// - `unit`: what one unit of the file was taken as (`mm`, `in`, … or `0.5 mm per unit` for an SVG);
//   `unitFrom`: where that came from (`option`, `file`, or `default`: the file does not say).
// - `layers`: every layer of the file with the number of its entities, read or not, by type.
// - `skipped`: what was left out of the layers asked for, by reason, with the count.
// - `notes`: what the reader found worth saying of the file.
// What is not a complete file of the format is not read in part: the reader throws `unreadable`
// with the place.
export interface ReadOutline {
  curves: { curve: ImportedCurve; layer: string }[];
  about: { unit: string; unitFrom: 'option' | 'file' | 'default'; layers: Record<string, Record<string, number>>; skipped: Record<string, number>; notes: string[] };
}
// An entry of the catalog of outline formats (`OUTLINE_FORMATS`, import/outline-formats.ts): the
// shape of an import format with another result. `read` throws `ImportFailure` (`unreadable`,
// `tooLarge`) as a mesh format does, `tooLarge` as soon as it has read more than the limits of
// `OUTLINE_LIMITS` (`bytes`, `read`, `readControl`, `readSpline`), before any weld.
export type OutlineFormatSpec<S> = ImportFormatSpec<S, ReadOutline>;
// The description of the options of every outline format, by name (declaration merging, as
// `ImportFormats`).
export interface OutlineFormats {}
export type OutlineFormat = keyof OutlineFormats;
export type OutlineOptions<F extends OutlineFormat> = ArgsOf<OutlineFormats[F]>;
export type OutlineCatalog = { [F in OutlineFormat]: OutlineFormatSpec<OutlineFormats[F]> };
export interface AnyOutlineFormat {
  title: string;
  summary: string;
  extensions: readonly string[];
  options: ArgSpecs;
  read: (bytes: Uint8Array, options: never) => ReadOutline;
}
// The options every outline format takes: the layers and the weld.
export const OUTLINE_SHARED_OPTIONS = {
  layers: {
    kind: 'list',
    of: { kind: 'text' },
    min: 1,
    max: OUTLINE_LIMITS.layers,
    title: 'Layers',
    summary: 'Only the curves on these layers, by name (DXF: the layer of an entity; SVG: the `id` or the `inkscape:label` of a group the element is in). Without it every layer; the report of an import lists the layers of the file with what they hold.',
    optional: true,
  },
  weld: {
    kind: 'number',
    title: 'Weld',
    summary:
      'An open end of a curve is put on an end of another curve this close, so that an outline written with few digits closes. No end moves further than this and ends that meet already are left alone; the report says how many ends were moved and how far, what could not be closed within it, and which ends stayed open with another end near.',
    optional: true,
    spec: { title: 'Weld tolerance', unit: 'mm', min: { value: 0 }, max: { value: 1 }, default: 0.01 },
  },
} as const satisfies ArgSpecs;
type InvalidOutlineSpecs = { [F in keyof OutlineFormats]: OutlineFormats[F] extends ArgSpecs ? never : F }[keyof OutlineFormats];
export const OUTLINE_FORMATS_ARE_VALID: [InvalidOutlineSpecs] extends [never] ? true : { [F in InvalidOutlineSpecs]: 'is not a valid description' } = true;
