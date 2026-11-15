// The query `catalog`: a table of data of the engine (hardware, materials) for a caller that is
// not typed. Code of the engine and of the app reads `DATA_CATALOGS` directly.
import { type CatalogTable, DATA_CATALOGS, catalogTable } from '../data-catalogs';
import type { ArgSpecs } from './args';
import { QueryFailure, type QuerySpec } from './spec';

export const CATALOG_ARGS = {
  name: { kind: 'text', title: 'Catalog', summary: 'The name of the catalog; the section Catalogs of the API description lists them.' },
  key: { kind: 'text', title: 'Row', summary: 'The key of one row, such as "M3"; without it all rows.', optional: true },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface Queries {
    catalog: { spec: typeof CATALOG_ARGS; result: CatalogTable };
  }
}

export const catalog: QuerySpec<typeof CATALOG_ARGS, CatalogTable> = {
  title: 'Data catalog',
  summary: 'A table of data the engine carries, such as sizes of hardware or densities of materials. A catalog fills in fields; the document stores the numbers, not a reference to the row.',
  returns: '`title`, `summary`, `source` (the standard or data sheet the rows come from), `columns` (each with a title and a unit, or `text`) and `rows` by key, each with a value per column.',
  args: CATALOG_ARGS,
  run: (_context, { name, key }) => {
    const table = catalogTable(DATA_CATALOGS, name, key);
    if (!('missing' in table)) return table;
    const names = Object.keys(DATA_CATALOGS);
    if (table.missing === 'name') throw new QueryFailure('notAvailable', `name: there is no catalog "${name}"; ${names.length ? `the catalogs are ${names.join(', ')}` : 'the engine has no catalog yet'}`, ['name']);
    throw new QueryFailure('notAvailable', `key: the catalog "${name}" has no row "${String(key)}"`, ['key']);
  },
};
