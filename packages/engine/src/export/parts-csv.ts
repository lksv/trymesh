// The export format `partsCsv` (D57): the parts list of the state (the query `partsList`) as one
// table, for a spreadsheet or a shop. It runs the entry of the query with the context of the export,
// so the file and the query cannot disagree.
//
// The file is CSV as RFC 4180 describes it:
// - UTF-8 without a byte order mark; every record ends with CR LF, the last one too;
// - a control character of a text is written as a space, and a field with a comma or a double quote
//   is quoted (`csvField`);
// - a header record, then a record per row of `printed`, of `bought` and of `hardware`, in the
//   order of the answer of the query; every record has the nine fields;
// - a number is written with a decimal point and without an exponent (`plain`); a mass is rounded
//   to six significant digits first, as the tools print it.
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
// Note           | with `copyOf`: "copy of <copyOf>", "mirror image of    | empty
//                | <copyOf>" (`mirrored`) or "differs from <copyOf>"      |
//                | (`differs`); with `threads` (D76), after a "; ", the   |
//                | threads of each body ("threads: 6 × M6 internal,       |
//                | cosmetic"); else empty                                 |
// IDs            | the bodies, separated by a space                       | the hole features, separated by a space
//
// `IDs` is for a reader who looks for the bodies in the model: an ID may itself hold a space, so
// a program takes the bodies from the query, not from this column.
import type { ArgSpecs } from '../query/args';
import { type PartRow, type PartsList, partsList } from '../query/parts-list';
import type { ExportFormatSpec } from './spec';
import { csvField, plain } from './text';

export const PARTS_CSV_OPTIONS = {} as const satisfies ArgSpecs;

declare module './spec' {
  interface ExportFormats {
    partsCsv: typeof PARTS_CSV_OPTIONS;
  }
}

export const PARTS_CSV = {
  path: 'parts.csv', // a suggested name: the caller names the file of the layout `file`
  mediaType: 'text/csv', // RFC 4180, section 3; RFC 7111
  header: ['Kind', 'Name', 'Count', 'Material', 'Colour', 'Mass each (g)', 'Mass total (g)', 'Note', 'IDs'],
  copy: 'copy of ',
  mirror: 'mirror image of ',
  differs: 'differs from ',
  // `Exported.empty`: the list has no row at all (no printed part, no bought part, no labelled hole)
  empty: 'the model has no part and no labelled hole to list',
} as const;

// What `about` of the file says (a type alias, so it is assignable to `ExportFile.about`): the
// records after the header, and the rows of each kind.
export type PartsCsvAbout = {
  rows: number;
  printed: number;
  bought: number;
  hardware: number;
};

// A mass: six significant digits, as the tools print it, then written by `plain`: at most nine
// decimals, no exponent (also from 1e21 on), no trailing zeros. Empty without one. Below a
// milligram the nine decimals keep fewer than six digits, and below 5e-10 g it is written 0.
export const grams = (value: number | undefined): string => (value === undefined ? '' : plain(Number(value.toPrecision(6))));

// The note of a row of bodies: what the row comes from, when it says.
export const partNote = (row: PartRow): string =>
  [row.copyOf === undefined ? '' : `${row.differs ? PARTS_CSV.differs : row.mirrored ? PARTS_CSV.mirror : PARTS_CSV.copy}${row.copyOf}`, row.threads ? `threads: ${threadsText(row.threads)}` : ''].filter((part) => part !== '').join('; ');
// The threads of a row for people: "6 × M6 internal, cosmetic; 1 × M10 external, cosmetic".
export const threadsText = (threads: NonNullable<PartRow['threads']>): string => threads.map((t) => `${t.count} × ${t.label} ${t.internal ? 'internal' : 'external'}, ${t.modelled ? 'modelled' : 'cosmetic'}`).join('; ');

// The text of the file for an answer of the query.
export function partsCsvText(list: PartsList): string {
  const body = (kind: string, row: PartRow): string[] => [kind, row.name, String(row.count), row.material ?? '', row.color ?? '', grams(row.mass), grams(row.totalMass), partNote(row), row.bodies.join(' ')];
  const records: string[][] = [
    [...PARTS_CSV.header],
    ...list.printed.map((row) => body('printed', row)),
    ...list.bought.map((row) => body('bought', row)),
    ...list.hardware.map((row) => ['hardware', row.label, String(row.count), '', '', '', '', '', row.holes.map((hole) => hole.feature).join(' ')]),
  ];
  return records.map((record) => `${record.map(csvField).join(',')}\r\n`).join('');
}

export const partsCsv: ExportFormatSpec<typeof PARTS_CSV_OPTIONS> = {
  title: 'Parts list (CSV)',
  summary:
    'The parts list of the model (the query partsList) as one CSV table for a spreadsheet: a record per kind of printed part, of bought part and of hardware, with its count, material, colour, the mass of one and of all in grams, a note for a row of copies that are not in the row of their source, and the IDs of its bodies or hole features. ' +
    'Comma separated, UTF-8, a decimal point. One file.',
  options: PARTS_CSV_OPTIONS,
  // the context of an export has the bodies as modelled, which is what the entry asks for itself
  run(context) {
    const list = partsList.run(context, {});
    const rows = list.printed.length + list.bought.length + list.hardware.length;
    const about: PartsCsvAbout = { rows, printed: list.printed.length, bought: list.bought.length, hardware: list.hardware.length };
    return { layout: 'file', files: [{ path: PARTS_CSV.path, mediaType: PARTS_CSV.mediaType, bytes: new TextEncoder().encode(partsCsvText(list)), about }], ...(rows === 0 ? { empty: PARTS_CSV.empty } : {}) };
  },
};
