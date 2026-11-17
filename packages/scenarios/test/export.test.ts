// `Engine.export` against the real adapters (D37): the files of the format `stl`, the state that
// is exported, the refusals, and `exportMesh` sharing the entry of the catalog.
import type { Engine, Exported, QueryOutcome } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, circle, newEngine, rectLoop, rectangle, run } from './kit';

// A plate 40 × 30 × 10, a pin apart from it, and two more pins made by a pattern of the pin.
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'k', 100, 0, 4),
    addExtrude('PLATE', 'S1', [rectLoop('r')], 10),
    addExtrude('PIN', 'S1', [['k']], 10),
    { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'PIN' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } },
  );
  return engine;
}
const files = (outcome: QueryOutcome<Exported>) => {
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result.files;
};
const failure = (outcome: QueryOutcome<Exported>) => (outcome.ok ? 'ok' : [outcome.error.code, outcome.error.arg, outcome.error.message]);
const triangles = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);

describe('Engine.export', () => {
  it('stl: one file with all bodies or the chosen ones, the bytes of exportMesh', () => {
    const engine = model();
    const all = engine.export('stl', {});
    expect(all).toEqual({ ok: true, result: { layout: 'file', files: [{ path: 'model.stl', mediaType: 'model/stl', bytes: engine.exportMesh('stl'), about: { bodies: ['PLATE', 'PIN', 'P/1', 'P/2'], triangles: expect.any(Number) } }] } });
    const [whole] = files(all);
    expect(whole.bytes.length).toBe(84 + 50 * (whole.about?.triangles as number));
    expect(triangles(whole.bytes)).toBe(whole.about?.triangles);
    // chosen bodies: in the order of the list, each once
    const [some] = files(engine.export('stl', { bodies: ['P/1', 'PLATE', 'P/1'] }));
    expect(some.about).toEqual({ bodies: ['P/1', 'PLATE'], triangles: triangles(some.bytes) });
    expect(some.bytes).toEqual(engine.exportMesh('stl', ['P/1', 'PLATE']));
    expect(some.bytes.length).toBeLessThan(whole.bytes.length);
    expect(engine.export('stl', { perBody: false })).toEqual(all);
  });

  it('stl per body: a set of files named by the body, each body alone in its file', () => {
    const engine = model();
    const set = engine.export('stl', { perBody: true });
    expect(set).toMatchObject({ ok: true, result: { layout: 'directory' } });
    expect(files(set).map((file) => [file.path, file.about?.bodies])).toEqual([
      ['PLATE.stl', ['PLATE']],
      ['PIN.stl', ['PIN']],
      ['P%2F1.stl', ['P/1']], // the name of a file has no folder in it
      ['P%2F2.stl', ['P/2']],
    ]);
    for (const file of files(set)) expect(file.bytes).toEqual(engine.exportMesh('stl', file.about?.bodies as string[]));
    expect(files(engine.export('stl', { perBody: true, bodies: ['PIN', 'PIN'] })).map((file) => file.path)).toEqual(['PIN.stl']);
  });

  it('the state exported: now, after a feature, or one that preview returned', () => {
    const engine = model();
    expect(files(engine.export('stl', {}, { at: 'PLATE' }))[0].about?.bodies).toEqual(['PLATE']);
    expect(failure(engine.export('stl', { bodies: ['PIN'] }, { at: 'PLATE' }))).toEqual(['notAvailable', ['bodies', 0], 'stl: bodies[0]: the body "PIN" is not in the state asked about']);
    // a preview: the plate twice as thick; nothing is written
    const before = engine.save();
    const previewed = engine.preview({ type: 'setField', feature: 'PLATE', path: 'extent/distance', value: 20 });
    if (!previewed.ok) throw new Error(previewed.error.message);
    const thick = files(engine.export('stl', { bodies: ['PLATE'] }, { state: previewed.state }))[0].bytes;
    const thin = files(engine.export('stl', { bodies: ['PLATE'] }))[0].bytes;
    const top = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      let z = -Infinity;
      for (let t = 0; t < view.getUint32(80, true); t++) for (let v = 0; v < 3; v++) z = Math.max(z, view.getFloat32(84 + 50 * t + 12 + 12 * v + 8, true));
      return z;
    };
    expect([top(thin), top(thick)]).toEqual([10, 20]);
    expect(engine.save()).toBe(before);
  });

  it('a model with no body: the export says so and a writer writes nothing', () => {
    const engine = newEngine();
    const empty = engine.export('stl', {});
    expect(empty).toMatchObject({ ok: true, result: { layout: 'file', empty: 'the model has no body to export', files: [{ path: 'model.stl', about: { bodies: [], triangles: 0 } }] } });
    expect(engine.export('stl', { perBody: true })).toEqual({ ok: true, result: { layout: 'directory', files: [], empty: 'the model has no body to export' } });
    // an empty list is not "all bodies" and not "no body in the model": it is refused
    expect(failure(model().export('stl', { bodies: [] }))).toEqual(['invalidArguments', ['bodies'], 'stl: bodies: at least 1 item is expected']);
    expect(model().export('stl', {})).not.toHaveProperty('result.empty');
  });

  it('refuses with a code and the place of the option instead of throwing; exportMesh keeps its texts', () => {
    const engine = model();
    expect(failure(engine.export('stl', { bodies: ['PLATE', 'nope'] }))).toEqual(['notAvailable', ['bodies', 1], 'stl: bodies[1]: the body "nope" is not in the state asked about']);
    expect(failure(engine.export('stl', { bodies: 'PLATE' } as never))).toEqual(['invalidArguments', ['bodies'], 'stl: bodies: a list is expected']);
    expect(failure(engine.export('stl', { perBody: 1 } as never))).toEqual(['invalidArguments', ['perBody'], 'stl: perBody: true or false is expected']);
    expect(failure(engine.export('stl', { perbody: true } as never))).toEqual(['invalidArguments', ['perbody'], 'stl: perbody: there is no such argument']);
    expect(failure(engine.export('step' as never, {} as never))).toEqual(['invalidArguments', ['format'], 'there is no export format "step"; the formats are stl, 3mf, dxf, svg, partsCsv, urdf, mjcf']);
    expect(() => engine.exportMesh('stl', ['nope'])).toThrow('exportMesh: the body "nope" does not exist');
    expect(() => engine.exportMesh('stl', 'PLATE' as never)).toThrow('exportMesh: bodies is a list of body IDs');
    expect(() => engine.exportMesh('step' as never)).toThrow('export: formát step není podporovaný');
    expect(engine.exportMesh('stl', [])).toHaveLength(84); // an empty mesh, as before the catalog
  });
});
