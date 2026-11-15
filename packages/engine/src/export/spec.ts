// An export format as an entry of the catalog `EXPORT_FORMATS` (export/index.ts). A format is
// a module in this directory: the description of its options and its entry, with a line in the map
// `ExportFormats` added by declaration merging, like a query.
//
// A format returns files, because a robot description is several files in folders and an outline
// is not a mesh. Its context is the context of a query with one difference: it always has the
// bodies as modelled, whatever pose was asked about last (a robot description writes the joints,
// not one pose of them).
import type { ArgSpecs, ArgsOf, RunArgsOf } from '../query/args';
import type { QueryContext } from '../query/spec';
import type { Exported } from '../types';

export interface ExportFormatSpec<S> {
  title: string;
  summary: string; // what the format is for and what it writes; goes to the description for the AI
  options: S;
  // Throws `QueryFailure` for what only the computation finds out, like `run` of a query.
  run: (context: QueryContext, options: RunArgsOf<S>) => Exported;
}

// The description of the options of every format, by name.
export interface ExportFormats {}
export type ExportFormat = keyof ExportFormats;
export type ExportOptions<F extends ExportFormat> = ArgsOf<ExportFormats[F]>;
export type ExportCatalog = { [F in ExportFormat]: ExportFormatSpec<ExportFormats[F]> };
// An entry as code that handles any format reads it.
export interface AnyExportFormat {
  title: string;
  summary: string;
  options: ArgSpecs;
  run: (context: QueryContext, options: never) => Exported;
}

// A description in the map that is not a valid `ArgSpecs` stops the type check here; the message
// lists the names.
type InvalidSpecs = { [F in keyof ExportFormats]: ExportFormats[F] extends ArgSpecs ? never : F }[keyof ExportFormats];
export const FORMATS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [F in InvalidSpecs]: 'is not a valid description' } = true;
