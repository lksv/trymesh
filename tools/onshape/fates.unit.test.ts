// The count by cause, the summary and its comparator (design of 6h, "Tests the implementation
// owes", 1). Fixtures only; no downloaded data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { newEngine } from './common';
import { type ConstraintRecord, type Summary, compareSummaries, fingerprint, finalFate, sketchLines, tally, tallyTables } from './fates';
import { SketchKit, StudioKit, polygonArea, polygonEdges, writeDump } from './kit';
import { encode } from './operands';
import { convertStudio } from './studio';

const rec = (over: Partial<ConstraintRecord>): ConstraintRecord => ({ key: 'S/s#0', studio: 'S', sketch: 's', sketchName: 's', helper: false, index: 0, type: 'COINCIDENT', what: 'COINCIDENT', operands: [], commands: [], ids: [], ...over });

describe('the tally', () => {
  test('the fates of a sketch add up to its constraints, the reason apart from the category', () => {
    const records = [
      rec({ key: 'S/s#0', fate: 'written' }),
      rec({ key: 'S/s#1', fate: 'shared', detail: 'by a point' }),
      rec({ key: 'S/s#2', fate: 'lost', cause: 'refused', category: 'origin', what: 'HORIZONTAL' }),
      rec({ key: 'S/s#3', fate: 'lost', cause: 'kind', what: 'MIDPOINT of two points' }),
      rec({ key: 'S/s#4', fate: 'twice', twiceOf: 'S/s#0' }),
    ];
    const t = tally(records);
    expect(Object.values(t.fates).reduce((a, b) => a + b, 0)).toBe(records.length);
    expect(t.fates).toMatchObject({ written: 1, shared: 1, lost: 2, twice: 1 });
    expect(t.causes.refused).toBe(1);
    expect(t.causes.origin).toBe(0); // the category is a column, not the cause
    const lines = sketchLines('Sketch 2', 6, 4, records, new Map(records.map((r) => [r.key, r])), 5);
    expect(lines[0]).toBe('Sketch 2: 6 points, 4 curves; of 5 constraints 1 written, 1 shared, 1 twice, 2 lost; 5 degrees of freedom');
    expect(lines).toContain('Sketch 2: lost: 1 HORIZONTAL (refused, on origin)');
    expect(lines).toContain('Sketch 2: lost: 1 MIDPOINT of two points (kind)');
    const text = tallyTables(t).join('\n');
    expect(text).toContain('| Refused by the check (`refused`) | 1 | HORIZONTAL 1 |');
    expect(text).toContain('| Lost | 2 |');
  });

  test('a twice follows the fate of the constraint it repeats when that one is consumed', () => {
    const records = [rec({ key: 'a', fate: 'shared', detail: 'by the cut' }), rec({ key: 'b', fate: 'twice', twiceOf: 'a' })];
    const byKey = new Map(records.map((r) => [r.key, r]));
    expect(finalFate(records[1], byKey)).toMatchObject({ fate: 'shared', detail: 'as a: by the cut' });
    expect(tally(records).fates.shared).toBe(2);
  });
});

const summary = (over: Partial<Summary> = {}): Summary => ({
  run: { commit: 'x', dirty: false, fingerprint: 'f', settings: {} },
  tally: tally([]),
  helperTally: tally([]),
  perSketch: {},
  constraints: [],
  sketches: {},
  parts: { 'S/Part': { studio: 'S', part: 'Part', body: 'b', volume: 100, onshape: 100 } },
  outcomes: { 'S/Chamfer 1': { studio: 'S', feature: 'Chamfer 1', type: 'chamfer', asked: 2, converted: [0] } },
  loaded: { loads: true, inError: [], bodies: 1 },
  parametersInUse: { S: ['A'] },
  promises: {},
  ...over,
});

describe('the comparator', () => {
  test('strict: a missing part, a volume that is not finite, the other edge of a chamfer', () => {
    const base = summary();
    expect(compareSummaries(base, summary()).strict).toEqual([]);
    expect(compareSummaries(base, summary({ parts: {} })).strict[0]).toMatch(/missing/);
    expect(compareSummaries(base, summary({ parts: { 'S/Part': { studio: 'S', part: 'Part', body: 'b', volume: NaN, onshape: 100 } } })).strict[0]).toMatch(/not finite/);
    expect(compareSummaries(base, summary({ parts: { 'S/Part': { studio: 'S', part: 'Part', body: 'b', volume: 100.0005, onshape: 100 } } })).strict).toEqual([]);
    // the same number of edges, the opposite one
    expect(compareSummaries(base, summary({ outcomes: { 'S/Chamfer 1': { studio: 'S', feature: 'Chamfer 1', type: 'chamfer', asked: 2, converted: [1] } } })).strict[0]).toMatch(/edges converted/);
  });

  test('allowed to grow: a helper copy, a parameter in use; expected to change: the fates', () => {
    const sk = (helper: boolean) => ({ key: 'S/h', studio: 'S', id: 'h', name: 'h', helper, status: 'ok', warnings: [], redundant: [], regions: 0, areas: [], welds: { places: 0, tied: 0, untied: {}, listed: [], wide: [] }, ladder: '', entries: [], counts: {} as any });
    const t = tally([rec({ fate: 'written' })]);
    const c = compareSummaries(summary(), summary({ sketches: { 'S/h': sk(true) }, parametersInUse: { S: ['A', 'B'] }, tally: t }));
    expect(c.strict).toEqual([]);
    expect(c.grown).toEqual(['sketch S/h: new (a helper copy)', 'parameter in use: S/B']);
    expect(c.changed).toEqual(['written: 0 -> 1']);
    expect(compareSummaries(summary(), summary({ sketches: { 'S/h': sk(false) } })).strict).toEqual(['sketch S/h: new']);
  });

  test('the fingerprint is that of the input files, not of an output folder inside the dump', () => {
    const { dir } = writeDump([new StudioKit()]);
    const before = fingerprint(dir);
    mkdirSync(join(dir, 'trymesh'));
    writeFileSync(join(dir, 'trymesh', 'report.md'), 'anything');
    expect(fingerprint(dir)).toBe(before);
    writeFileSync(join(dir, 'meta.json'), '{}');
    expect(fingerprint(dir)).not.toBe(before);
  });
});

describe('a studio converted with records', () => {
  test('every constraint has a fate, an operand of another sketch is named by the decode, the document loads', async () => {
    const studio = new StudioKit('Box');
    const s1 = new SketchKit('Sketch 1', 'F1');
    const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const ls = square.map((a, i) => s1.line(a, square[(i + 1) % 4]));
    ls.forEach((l, i) => s1.constrain('COINCIDENT', { localFirst: l.end, localSecond: ls[(i + 1) % 4].start }));
    s1.constrain('HORIZONTAL', { localFirst: ls[0].id });
    s1.constrain('COINCIDENT', { localFirst: ls[0].start, externalSecond: { ext: 'IB' } });
    const { faces } = studio.sketch(s1, 1);
    const s2 = new SketchKit('Sketch 2', 'F2');
    const c = s2.circle([10, 10], 2);
    // the centre on a vertex of Sketch 1 (operation F, its bodies)
    s2.constrain('COINCIDENT', { localFirst: c.center, externalSecond: { ext: encode('F', 'vertex', 2) } });
    studio.sketch(s2, 1);
    studio.extrude('F3', 'Extrude 1', [{ id: faces[0], area: polygonArea(square), edges: polygonEdges(square) }], '5 mm');
    const { input, report } = writeDump([studio]);
    await newEngine();
    const result = await convertStudio(input, studio.eid, report);
    expect(report.records.length).toBe(7);
    expect(report.records.every((r) => r.fate)).toBe(true);
    const t = tally(report.records);
    expect(Object.values(t.fates).reduce((a, b) => a + b, 0)).toBe(7);
    const onSketch = report.records.find((r) => r.sketch === 'Sketch_2')!;
    expect(onSketch.operands[1]).toMatchObject({ external: true, category: 'sketch' });
    expect(onSketch.operands[1].decoded).toBe('a vertex of the sketch F1');
    // the summary of the sketch: regions against Onshape's
    expect(report.sketches['Box/Sketch_1']).toMatchObject({ regions: 1, onshapeRegions: 1, valid: true });
    expect(report.parts['Box/Extrude 1'].volume).toBeCloseTo(500, 6);
    const engine = await newEngine();
    expect(engine.load(JSON.stringify(result.document)).ok).toBe(true);
    expect(Object.keys(engine.getState().evaluation.bodies)).toHaveLength(1);
  });
});
