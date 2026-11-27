// Data catalogs (D37): a table with typed rows for code, and without its row type for a query.
import { describe, expect, it } from 'vitest';
import { DATA_CATALOGS, type DataCatalog, catalogTable } from '../src/data-catalogs';

// A catalog as a package writes one: the row type is an interface.
interface ScrewRow {
  clearance: number;
  head: number;
  drive: string;
}
const SCREWS: DataCatalog<ScrewRow> = {
  title: 'Socket head cap screws',
  summary: 'Clearance holes and heads.',
  source: 'ISO 4762, ISO 273 medium',
  columns: { clearance: { title: 'Clearance hole', unit: 'mm' }, head: { title: 'Head diameter', unit: 'mm' }, drive: { title: 'Drive', unit: 'text' } },
  rows: { M3: { clearance: 3.4, head: 5.5, drive: 'hex 2.5' }, M4: { clearance: 4.5, head: 7, drive: 'hex 3' } },
};
// @ts-expect-error a column of numbers has a unit, not `text`
const wrongUnit: DataCatalog<ScrewRow>['columns'] = { ...SCREWS.columns, head: { title: 'Head', unit: 'text' } };
// @ts-expect-error every column of the row type is described
const missingColumn: DataCatalog<ScrewRow>['columns'] = { clearance: SCREWS.columns.clearance, head: SCREWS.columns.head };

describe('data catalogs', () => {
  it('code reads a row with its type', () => {
    const clearance: number = SCREWS.rows.M3.clearance;
    const drive: string = SCREWS.rows.M3.drive;
    // @ts-expect-error there is no such column
    const none = SCREWS.rows.M3.pitch;
    expect([clearance, drive, none, wrongUnit, missingColumn].length).toBe(5);
  });

  it('the table of a catalog: all rows or one, copied, and what is missing otherwise', () => {
    const catalogs = { screws: SCREWS as DataCatalog<never> };
    const all = catalogTable(catalogs, 'screws');
    expect(all).toEqual({ title: SCREWS.title, summary: SCREWS.summary, source: SCREWS.source, columns: SCREWS.columns, rows: SCREWS.rows });
    expect('rows' in all && all.rows.M3).not.toBe(SCREWS.rows.M3);
    expect(catalogTable(catalogs, 'screws', 'M4')).toMatchObject({ rows: { M4: { clearance: 4.5, head: 7, drive: 'hex 3' } } });
    expect(Object.keys((catalogTable(catalogs, 'screws', 'M4') as { rows: object }).rows)).toEqual(['M4']);
    expect(catalogTable(catalogs, 'screws', 'M5')).toEqual({ missing: 'key' });
    expect(catalogTable(catalogs, 'nuts')).toEqual({ missing: 'name' });
    expect(catalogTable(catalogs, 'constructor')).toEqual({ missing: 'name' });
    expect(catalogTable(catalogs, 'screws', 'toString')).toEqual({ missing: 'key' });
  });

  it('the catalogs of the engine: the hardware of D46, the materials of D48 and the threads of D76', () => {
    expect(Object.keys(DATA_CATALOGS)).toEqual(['clearanceHoles', 'socketHeadScrews', 'countersunkScrews', 'hexNuts', 'heatSetInserts', 'materials', 'metricThreads']);
    // the query `catalog` takes the map as it is, with the rows copied
    expect(catalogTable(DATA_CATALOGS, 'hexNuts')).toMatchObject({ title: DATA_CATALOGS.hexNuts.title, columns: DATA_CATALOGS.hexNuts.columns });
  });
});
