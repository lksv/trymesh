// An import format as an entry of the catalog `IMPORT_FORMATS` (import/index.ts), the counterpart
// of an export format (D55): a module in this directory with the description of its options and its
// entry, and a line in the map `ImportFormats` added by declaration merging. A format only turns
// bytes into the corners of triangles in millimetres; the weld, the walls, the shells, the checks and
// the report are the same for every format.
import type { ArgSpecs, ArgsOf, RunArgsOf } from '../query/args';

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

export interface ImportFormatSpec<S> {
  title: string;
  summary: string; // what files it reads and what it takes from them; goes to the description for the AI
  extensions: readonly string[]; // without the dot, lower case: how a tool picks the format of a path
  options: S; // described like the options of an export format: checked, described, shown by a form
  read: (bytes: Uint8Array, options: RunArgsOf<S>) => ReadTriangles;
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
