// D46 (package 2c of D36): the hardware catalogs pinned row by row, what holds of them without
// a source, and the query `hardwareHole` over them. The numbers were typed from the tables the
// `source` of each catalog names and checked against a second table (design.md, "As implemented").
import { describe, expect, it } from 'vitest';
import { DATA_CATALOGS } from '../src/data-catalogs';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import { createEngine } from '../src/engine';
import { evaluateNumber } from '../src/expression';
import type { Command, Document, HoleFeature, Input, SolidKernel } from '../src/types';

const engine = createEngine({ solver: { solve: () => ({ status: 'ok', points: {}, radii: {} }) } as never, kernel: {} as SolidKernel });
const ask = (args: Parameters<typeof engine.query<'hardwareHole'>>[1]) => {
  const answer = engine.query('hardwareHole', args);
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.result;
};
const increasing = (values: number[]): boolean => values.every((value, i) => i === 0 || value > values[i - 1]);

describe('the hardware catalogs', () => {
  it('the rows, pinned', () => {
    expect(DATA_CATALOGS.clearanceHoles.rows).toEqual({
      M2: { thread: 2, fine: 2.2, medium: 2.4, coarse: 2.6 },
      'M2.5': { thread: 2.5, fine: 2.7, medium: 2.9, coarse: 3.1 },
      M3: { thread: 3, fine: 3.2, medium: 3.4, coarse: 3.6 },
      'M3.5': { thread: 3.5, fine: 3.7, medium: 3.9, coarse: 4.2 },
      M4: { thread: 4, fine: 4.3, medium: 4.5, coarse: 4.8 },
    });
    expect(DATA_CATALOGS.socketHeadScrews.rows).toEqual({
      M2: { thread: 2, headDiameter: 3.98, headHeight: 2 },
      'M2.5': { thread: 2.5, headDiameter: 4.68, headHeight: 2.5 },
      M3: { thread: 3, headDiameter: 5.68, headHeight: 3 },
      M4: { thread: 4, headDiameter: 7.22, headHeight: 4 },
    });
    expect(DATA_CATALOGS.countersunkScrews.rows).toEqual({
      M2: { thread: 2, headDiameter: 4.7, headAngle: Math.PI / 2 },
      'M2.5': { thread: 2.5, headDiameter: 5.88, headAngle: Math.PI / 2 },
      M3: { thread: 3, headDiameter: 6.72, headAngle: Math.PI / 2 },
      M4: { thread: 4, headDiameter: 8.96, headAngle: Math.PI / 2 },
    });
    expect(DATA_CATALOGS.hexNuts.rows).toEqual({
      M2: { thread: 2, acrossFlats: 4, thickness: 1.6 },
      'M2.5': { thread: 2.5, acrossFlats: 5, thickness: 2 },
      M3: { thread: 3, acrossFlats: 5.5, thickness: 2.4 },
      'M3.5': { thread: 3.5, acrossFlats: 6, thickness: 2.8 },
      M4: { thread: 4, acrossFlats: 7, thickness: 3.2 },
    });
    // thread × length × outer diameter, as sold; the hole by the rule of the source
    const inserts = Object.entries(DATA_CATALOGS.heatSetInserts.rows).map(([key, row]) => `${key} ${row.thread} ${row.length} ${row.outerDiameter} ${row.holeDiameter} ${row.holeDepth}`);
    expect(inserts).toEqual([
      'M3x3x4.5 3 3 4.5 4.2 4',
      'M3x4x4.5 3 4 4.5 4.2 5',
      'M3x5x4.5 3 5 4.5 4.2 6',
      'M3x6x4.5 3 6 4.5 4.2 7',
      'M3x8x4.5 3 8 4.5 4.2 9',
      'M3x10x4.5 3 10 4.5 4.2 11',
      'M3x3x5 3 3 5 4.7 4',
      'M3x4x5 3 4 5 4.7 5',
      'M3x5x5 3 5 5 4.7 6',
      'M3x6x5 3 6 5 4.7 7',
      'M3x8x5 3 8 5 4.7 9',
      'M4x3x5 4 3 5 4.7 4',
      'M4x4x5.5 4 4 5.5 5.2 5',
      'M4x5x5.5 4 5 5.5 5.2 6',
      'M4x6x5.5 4 6 5.5 5.2 7',
      'M4x4x6 4 4 6 5.7 5',
      'M4x5x6 4 5 6 5.7 6',
      'M4x6x6 4 6 6 5.7 7',
      'M4x8x6 4 8 6 5.7 9',
      'M4x10x6 4 10 6 5.7 11',
    ]);
    for (const catalog of Object.values(DATA_CATALOGS)) expect(catalog.source.length).toBeGreaterThan(40);
  });

  it('what holds without a source: the keys, the columns grow with the thread, the series in order, heads and nuts wider than the thread', () => {
    for (const catalog of [DATA_CATALOGS.clearanceHoles, DATA_CATALOGS.socketHeadScrews, DATA_CATALOGS.countersunkScrews, DATA_CATALOGS.hexNuts]) {
      const rows = Object.entries(catalog.rows) as [string, Record<string, number>][];
      for (const [key, row] of rows) expect(key).toBe(`M${row.thread}`);
      for (const column of Object.keys(catalog.columns)) if (column !== 'headAngle') expect(increasing(rows.map(([, row]) => row[column])), column).toBe(true);
    }
    for (const row of Object.values(DATA_CATALOGS.clearanceHoles.rows)) expect(row.thread < row.fine && row.fine < row.medium && row.medium < row.coarse).toBe(true);
    for (const row of Object.values(DATA_CATALOGS.socketHeadScrews.rows)) expect(row.headDiameter).toBeGreaterThan(row.thread);
    for (const row of Object.values(DATA_CATALOGS.countersunkScrews.rows)) expect(row.headDiameter).toBeGreaterThan(row.thread);
    for (const row of Object.values(DATA_CATALOGS.hexNuts.rows)) expect(row.acrossFlats).toBeGreaterThan(row.thread);
    // the inserts: the key is what the row says, the hole narrower than the insert and wider than its thread, deeper than it is long
    for (const [key, row] of Object.entries(DATA_CATALOGS.heatSetInserts.rows)) {
      expect(key).toBe(`M${row.thread}x${row.length}x${row.outerDiameter}`);
      expect(row.thread < row.holeDiameter && row.holeDiameter < row.outerDiameter).toBe(true);
      expect(row.holeDepth).toBeGreaterThan(row.length);
    }
  });
});

describe('the query hardwareHole', () => {
  it('every use: the shape, the label, the catalogs used; the series; an insert has its depth', () => {
    expect(ask({ use: 'clearance', size: 'M3' })).toEqual({ shape: { type: 'plain', diameter: 3.4 }, label: 'M3 clearance hole', from: ['clearanceHoles'] });
    expect(ask({ use: 'clearance', size: 'M3', fit: 'fine' }).shape).toEqual({ type: 'plain', diameter: 3.2 });
    expect(ask({ use: 'socketHead', size: 'M3' })).toEqual({ shape: { type: 'counterbore', diameter: 3.4, headDiameter: 5.68, headDepth: 3 }, label: 'M3 socket head cap screw', from: ['clearanceHoles', 'socketHeadScrews'] });
    expect(ask({ use: 'countersunk', size: 'M4', fit: 'coarse' })).toEqual({ shape: { type: 'countersink', diameter: 4.8, headDiameter: 8.96, angle: 'deg(90)' }, label: 'M4 countersunk screw', from: ['clearanceHoles', 'countersunkScrews'] });
    expect(ask({ use: 'nutPocket', size: 'M2.5' })).toEqual({ shape: { type: 'nutPocket', diameter: 2.9, acrossFlats: 5, headDepth: 2, rotation: 0 }, label: 'M2.5 hex nut', from: ['clearanceHoles', 'hexNuts'] });
    expect(ask({ use: 'heatSetInsert', size: 'M4x5x6' })).toEqual({ shape: { type: 'plain', diameter: 5.7 }, label: 'M4x5x6 heat-set insert', depth: 6, from: ['heatSetInserts'] });
  });

  it('a size missing in one catalog and present in another is missing for the uses of that catalog only', () => {
    // M3.5 has a clearance hole and a nut, and no socket head screw in ISO 4762
    expect(ask({ use: 'clearance', size: 'M3.5' }).shape).toEqual({ type: 'plain', diameter: 3.9 });
    expect(ask({ use: 'nutPocket', size: 'M3.5' }).shape).toMatchObject({ acrossFlats: 6 });
    expect(engine.query('hardwareHole', { use: 'socketHead', size: 'M3.5' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['size'], message: expect.stringMatching(/the catalog socketHeadScrews has no size "M3.5"; it has M2, M2.5, M3, M4/) } });
    // an insert is not asked for a clearance hole
    expect(engine.query('hardwareHole', { use: 'clearance', size: 'M3x3x4.5' })).toMatchObject({ ok: false, error: { code: 'notAvailable' } });
  });

  it('the allowance: every diameter and the size across flats as an expression the feature accepts; the depths stay numbers', () => {
    const nut = ask({ use: 'nutPocket', size: 'M3', allowance: ' holeComp ' });
    expect(nut.shape).toEqual({ type: 'nutPocket', diameter: '3.4 + holeComp', acrossFlats: '5.5 + holeComp', headDepth: 2.4, rotation: 0 });
    const sink = ask({ use: 'countersunk', size: 'M3', allowance: '2 * holeComp' });
    expect(sink.shape).toEqual({ type: 'countersink', diameter: '3.4 + 2 * holeComp', headDiameter: '6.72 + 2 * holeComp', angle: 'deg(90)' });
    // the angle comes back as the angle of the catalog
    const angle = evaluateNumber('deg(90)', { parameters: {} } as never);
    expect(angle.ok && angle.value).toBeCloseTo(DATA_CATALOGS.countersunkScrews.rows.M3.headAngle, 15);
    // into a feature as it comes
    const commands: Command[] = [
      { type: 'setParameter', name: 'holeComp', expr: '0.2' },
      { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
      { type: 'addFeature', feature: { id: 'A', name: 'A', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
    ];
    const doc: Document = commands.reduce(applyCommand, emptyDocument());
    const hole = (shape: Input<HoleFeature>['shape']) => applyCommand(doc, { type: 'addFeature', feature: { id: 'H', name: 'H', suppressed: false, type: 'hole', sketch: 'S', points: ['origin'], shape, extent: { type: 'throughAll', side: 'backward' }, targets: ['A'], label: sink.label } });
    const built = hole(sink.shape).features.at(-1) as HoleFeature;
    expect(built.shape).toEqual({ type: 'countersink', diameter: 3.8, headDiameter: expect.closeTo(7.12, 12), angle: Math.PI / 2 });
    expect(built.expressions).toEqual({ 'shape/angle': 'deg(90)', 'shape/diameter': '3.4 + 2 * holeComp', 'shape/headDiameter': '6.72 + 2 * holeComp' });
    expect((hole(nut.shape).features.at(-1) as HoleFeature).shape).toMatchObject({ acrossFlats: expect.closeTo(5.7, 12) });
  });
});
