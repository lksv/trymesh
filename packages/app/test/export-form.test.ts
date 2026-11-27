// The export of the form (D54) over an engine of the test: what is asked (`at` only when the marker
// is after a feature), what is saved, and a set whose ZIP cannot be built shown as a refusal. The
// form as a user drives it is in app.test.ts (snapshot `export.txt`).
import { type Command, type Engine, type Exported, type QueryOutcome, ZIP_NAME_LIMIT, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import type { PanelHost } from '../src/host';
import { type SaveFile, runExportForm } from '../src/panels/export';
import type { QueryPanel } from '../src/panels/query';
import { readZip } from '../../engine/test/zip-reader';

const stl = (path: string) => ({ path, mediaType: 'model/stl', bytes: new Uint8Array([1, 2, 3]) });
function harness(answer: QueryOutcome<Exported>, marker: string | null, format = 'stl', draft: Record<string, unknown> = { perBody: true }) {
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
  const panel: QueryPanel = { exporting: { format, draft } } as QueryPanel;
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

  it('the notes of the export follow the file in the status bar (D76)', () => {
    const noted = harness({ ok: true, result: { layout: 'file', files: [stl('model.stl')], notes: ['body "a": 2 cosmetic threads (M6), not in the mesh: tap or cut them after printing', 'body "b": 1 cosmetic thread (M3), not in the mesh: tap or cut it after printing'] } }, null);
    expect(noted.said).toEqual(['Exported model.stl (3 bytes). body "a": 2 cosmetic threads (M6), not in the mesh: tap or cut them after printing; body "b": 1 cosmetic thread (M3), not in the mesh: tap or cut it after printing.']);
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

  it('the set of a robot (5b) is saved as one ZIP: the description and a mesh per body', async () => {
    const engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    const disc = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
    const done = engine.execute({
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
        { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
        disc('low', 0),
        disc('high', 10),
        { type: 'setBodyProperties', body: 'low', patch: { density: 1.2 } },
        { type: 'setBodyProperties', body: 'high', patch: { density: 1.2 } },
        { type: 'setLink', id: 'base', bodies: ['low'] },
        { type: 'setLink', id: 'top', bodies: ['high'] },
        { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0 } },
      ],
    });
    expect(done.ok).toBe(true);
    const { saved, said } = harness(engine.export('mjcf', {}), null, 'mjcf', {});
    expect(saved.map(([name, , mediaType]) => [name, mediaType])).toEqual([['mjcf.zip', 'application/zip']]);
    expect(readZip(saved[0][1]).map((entry) => entry.name)).toEqual(['robot.xml', 'low.stl', 'high.stl']);
    expect(said).toHaveLength(1);
  });
});
