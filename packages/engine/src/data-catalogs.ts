// Tables of data the engine carries (hardware, materials, threads). The rule is decided in D36:
// a catalog fills fields, the document stores the numbers.
// - Every catalog has its own columns; a kind of part with other columns is another catalog.
// - Code reads `DATA_CATALOGS` directly and gets the row type of the catalog it names; a column
//   that does not exist does not compile, and a column of numbers has a unit.
// - An untyped caller (MCP) uses the query `catalog`, which answers with the table without its row
//   type. The description for the AI lists the catalogs by name and summary only, so it does not
//   grow with the tables.
// A package adds a catalog as a module with its row type in `catalogs/` (the hardware of D46 in
// `catalogs/hardware.ts`), one line in the map `Catalogs` (by declaration merging) and one entry of
// `DATA_CATALOGS`.
import type { Unit } from './catalog';
import { clearanceHoles, countersunkScrews, heatSetInserts, hexNuts, socketHeadScrews } from './catalogs/hardware';
import { MATERIALS } from './catalogs/materials';
import { has } from './util';

export interface DataCatalog<Row extends { [K in keyof Row]: number | string }> {
  title: string;
  summary: string;
  source: string; // the standard or the data sheet the rows come from; "typical values" when there is none
  columns: { [K in keyof Row]: { title: string; unit: Row[K] extends number ? Unit : 'text' } };
  rows: Record<string, Row>; // by key, such as "M3"
}

// A catalog without its row type: what the query `catalog` answers with.
export interface CatalogTable {
  title: string;
  summary: string;
  source: string;
  columns: Record<string, { title: string; unit: Unit | 'text' }>;
  rows: Record<string, { readonly [column: string]: number | string }>;
}

// The row type of every catalog by name.
export interface Catalogs {}
export type CatalogSet = { [N in keyof Catalogs]: Catalogs[N] extends { [K in keyof Catalogs[N]]: number | string } ? DataCatalog<Catalogs[N]> : never };

export const DATA_CATALOGS: CatalogSet = { clearanceHoles, socketHeadScrews, countersunkScrews, hexNuts, heatSetInserts, materials: MATERIALS };

// The table of the catalog `name`, with all its rows or with the one row `key`. A row type written
// as an interface is not a dictionary to the compiler, so a catalog is taken with its columns and
// rows as objects and the rows are copied. Returns what is
// missing instead of a table: the name or the key.
export function catalogTable(catalogs: { readonly [name: string]: { title: string; summary: string; source: string; columns: object; rows: object } }, name: string, key?: string): CatalogTable | { missing: 'name' | 'key' } {
  if (!has(catalogs, name)) return { missing: 'name' };
  const catalog = catalogs[name] as CatalogTable;
  if (key !== undefined && !has(catalog.rows, key)) return { missing: 'key' };
  const rows = Object.fromEntries((key === undefined ? Object.keys(catalog.rows) : [key]).map((row) => [row, { ...catalog.rows[row] }]));
  return { title: catalog.title, summary: catalog.summary, source: catalog.source, columns: { ...catalog.columns }, rows };
}
