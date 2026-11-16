// The export of the form (D54) over an engine of the test: what is asked (`at` only when the marker
// is after a feature), what is saved, and a set whose ZIP cannot be built shown as a refusal. The
// form as a user drives it is in app.test.ts (snapshot `export.txt`).
import { type Engine, type Exported, type QueryOutcome, ZIP_NAME_LIMIT } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import type { PanelHost } from '../src/host';
import { type SaveFile, runExportForm } from '../src/panels/export';
import type { QueryPanel } from '../src/panels/query';
import { readZip } from '../../engine/test/zip-reader';

const stl = (path: string) => ({ path, mediaType: 'model/stl', bytes: new Uint8Array([1, 2, 3]) });
function harness(answer: QueryOutcome<Exported>, marker: string | null) {
  const asked: unknown[][] = [];
  const said: string[] = [];
  const saved: [string, Uint8Array, string][] = [];
  const host = {
    engine: { export: (...args: unknown[]) => (asked.push(args), answer) } as unknown as Pick<Engine, 'export'>,
    marker,
    say: (text: string, error = false) => void said.push(`${text}${error ? ' [error]' : ''}`),
    refresh: () => undefined,
  } as unknown as PanelHost;
  const save: SaveFile = (name, bytes, mediaType) => void saved.push([name, bytes, mediaType]);
  const panel: QueryPanel = { exporting: { format: 'stl', draft: { perBody: true } } };
  runExportForm(panel, host, save);
  return { asked, said, saved, problem: panel.exporting?.problem };
}

describe('the export of the form', () => {
  it('asks about the state at the marker: with `at` after a feature, without it at the end of the timeline', () => {
    const one: QueryOutcome<Exported> = { ok: true, result: { layout: 'file', files: [stl('model.stl')] } };
    expect(harness(one, 'e1').asked).toEqual([['stl', { perBody: true }, { at: 'e1' }]]);
    const atEnd = harness(one, null);
    expect(atEnd.asked).toEqual([['stl', { perBody: true }, {}]]);
    expect(atEnd.saved).toEqual([['model.stl', new Uint8Array([1, 2, 3]), 'model/stl']]);
    expect(atEnd.said).toEqual(['Exported model.stl (3 bytes).']);
  });

  it('a set is saved as one ZIP of the files under their paths', () => {
    const { saved } = harness({ ok: true, result: { layout: 'directory', files: [stl('a.stl'), stl('meshes/b.stl')] } }, null);
    expect(saved.map(([name, , mediaType]) => [name, mediaType])).toEqual([['stl.zip', 'application/zip']]);
    expect(readZip(saved[0][1]).map((entry) => [entry.name, [...entry.bytes]])).toEqual([
      ['a.stl', [1, 2, 3]],
      ['meshes/b.stl', [1, 2, 3]],
    ]);
  });

  it('a set with a path too long for the ZIP: the refusal of the ZIP in the form, nothing saved', () => {
    const { saved, problem, said } = harness({ ok: true, result: { layout: 'directory', files: [stl('a.stl'), stl(`${'L'.repeat(ZIP_NAME_LIMIT)}.stl`)] } }, null);
    expect(saved).toEqual([]);
    expect(problem?.message).toMatch(/^the files do not fit a ZIP without ZIP64: the name "L+…" has 65493 bytes, the most is 65489$/);
    expect(said).toEqual([`${problem?.message} [error]`]);
  });

  it('a refusal at an option, and the text of an export with nothing in it, stay in the form; nothing is saved', () => {
    const refused = harness({ ok: false, error: { code: 'notAvailable', message: 'stl: bodies[0]: the body "x" is not in the state asked about', arg: ['bodies', 0] } }, null);
    expect([refused.problem, refused.saved]).toEqual([{ message: 'stl: bodies[0]: the body "x" is not in the state asked about', arg: ['bodies', 0] }, []]);
    const empty = harness({ ok: true, result: { layout: 'file', files: [stl('model.stl')], empty: 'the model has no body to export' } }, null);
    expect([empty.problem, empty.saved]).toEqual([{ message: 'the model has no body to export' }, []]);
  });
});
