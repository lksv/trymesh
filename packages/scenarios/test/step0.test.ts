// D35 krok 0: dokument verze 1 po převodu dává stejný model a rozsah vysunutí může začínat mimo
// rovinu skici. Proti skutečným adaptérům.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Document, Engine, ExtrudeFeature } from '@trymesh/engine';
import { XY, addExtrude, addSketch, cap, expectAllOk, extrude, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, status, volume } from './kit';

const FIXTURE = readFileSync(new URL('./fixtures/v1-plate.json', import.meta.url), 'utf8');
const stl = (engine: Engine) => Array.from(engine.exportMesh('stl'));

describe('krok 0: dokument verze 1', () => {
  // Soubor uložil engine před změnou schématu: deska s kapsou, nálitkem na vlastní rovině a druhým
  // tělesem. Objemy a jména stěn spočítal tentýž engine.
  it('načte se, přepočte se na stejný model a uloží se ve verzi 2', () => {
    const engine = newEngine();
    expect(JSON.parse(FIXTURE).schemaVersion).toBe(1);
    expect(engine.load(FIXTURE).ok).toBe(true);
    const state = engine.getState();
    expectAllOk(state);
    expect(Object.keys(state.evaluation.bodies)).toEqual(['E1', 'E4']);
    expect(volume(state.evaluation.bodies.E1.solid)).toBe(11678.215946678962);
    expect(volume(state.evaluation.bodies.E4.solid)).toBe(548.3328490844433);
    expect(faceNames(state, 'E1')).toEqual(['E1/endCap', 'E1/side/k', 'E1/side/ra', 'E1/side/rb', 'E1/side/rc', 'E1/side/rd', 'E1/startCap', 'E2/endCap', 'E2/side/hole', 'E3/endCap', 'E3/side/na', 'E3/side/nb', 'E3/side/nc', 'E3/side/nd', 'E3/startCap']);
    expect(faceNames(state, 'E4')).toEqual(['E4/endCap', 'E4/side/q', 'E4/startCap']);

    const old = JSON.parse(FIXTURE) as { features: Record<string, unknown>[] };
    const saved = JSON.parse(engine.save()) as Document;
    expect(saved).toMatchObject({ schemaVersion: 2, parameters: [], checks: [] });
    saved.features.forEach((f, i) => {
      const before = old.features[i];
      if (f.type !== 'extrude') return expect(f).toEqual(before); // skici se neřešily znovu
      expect(f).toEqual({
        id: before.id,
        name: before.name,
        suppressed: before.suppressed,
        type: 'extrude',
        profile: { type: 'regions', sketch: before.sketch, regions: before.regions },
        extent: { type: 'distance', start: 0, distance: before.distance },
        operation: before.operation,
        ...(before.target === undefined ? {} : { targets: [before.target] }),
      });
    });

    // uložený dokument verze 2 dává bitově stejný model
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(state.evaluation);
    expect(stl(other)).toEqual(stl(engine));
    expect(other.getState()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('dokument s parametry nebo kontrolami engine zatím odmítne a původní dokument nechá být', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY));
    const doc = JSON.parse(engine.save());
    for (const extra of [{ parameters: [{ id: 'a', name: 'a', value: 1 }] }, { checks: [{ id: 'c' }] }, { parameters: undefined }]) {
      const result = engine.load(JSON.stringify({ ...doc, ...extra }));
      expect(result.ok).toBe(false);
      expect(engine.getState().document.features.map((f) => f.id)).toEqual(['S1']);
    }
  });
});

describe('krok 0: začátek rozsahu vysunutí', () => {
  const plate = (start: number, distance: number): Engine => {
    const engine = newEngine();
    const feature: ExtrudeFeature = { ...extrude('E1', 'S1', [rectLoop('r')], distance), extent: { type: 'distance', start, distance } };
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), { type: 'addFeature', feature });
    return engine;
  };
  const z = (engine: Engine, body: string, role: 'startCap' | 'endCap', feature = body) => {
    const box = faceBox(engine.getState(), body, cap(feature, role))!;
    return [box.min[2], box.max[2]];
  };

  it('těleso začíná v posunu od roviny skici; víka se jmenují podle začátku a konce rozsahu', () => {
    for (const [start, distance] of [[5, 10], [5, -8], [-5, 3], [-5, -3], [2, -2]]) {
      const engine = plate(start, distance);
      expectAllOk(engine.getState());
      expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(1200 * Math.abs(distance), 6);
      expect(z(engine, 'E1', 'startCap')).toEqual([start, start]);
      expect(z(engine, 'E1', 'endCap')).toEqual([start + distance, start + distance]);
    }
  });

  it('nulový začátek dává bitově stejné těleso jako dřív; změna začátku těleso posune a undo vrátí', () => {
    const engine = plate(0, 10);
    const before = stl(engine);
    const moved = run(engine, { type: 'updateFeature', id: 'E1', patch: { extent: { start: 4 } } });
    expect((moved.document.features[1] as ExtrudeFeature).extent).toEqual({ type: 'distance', start: 4, distance: 10 });
    expect([z(engine, 'E1', 'startCap'), z(engine, 'E1', 'endCap')]).toEqual([[4, 4], [14, 14]]);
    engine.undo();
    expect(stl(engine)).toEqual(before);
    expect(stl(plate(0, 10))).toEqual(before);
  });

  it('skica na víku posunutého tělesa leží na víku, i když víko míří proti normále skici', () => {
    const engine = plate(5, 10);
    run(engine, addSketch('S2', onFace('E1', cap('E1', 'startCap'))), rectangle('S2', 'q', 2, 2, 6, 6, null), addExtrude('E2', 'S2', [rectLoop('q')], 3, 'add', 'E1'));
    expectAllOk(engine.getState());
    // nálitek ze spodního víka roste ven z tělesa, tedy dolů
    expect(z(engine, 'E1', 'startCap', 'E2')).toEqual([5, 5]);
    expect(z(engine, 'E1', 'endCap', 'E2')).toEqual([2, 2]);
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000 + 108, 6);
  });

  it('výřez s posunutým začátkem vyřízne dutinu uvnitř tělesa a obě jeho víka jsou stěny tělesa', () => {
    const engine = plate(0, 10);
    const pocket: ExtrudeFeature = { ...extrude('E2', 'S2', [rectLoop('q')], 4, 'cut', 'E1'), extent: { type: 'distance', start: 3, distance: 4 } };
    run(engine, addSketch('S2', XY), rectangle('S2', 'q', 10, 10, 10, 10, null), { type: 'addFeature', feature: pocket });
    expectAllOk(engine.getState());
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000 - 400, 6);
    expect(faceNames(engine.getState(), 'E1')).toEqual(expect.arrayContaining(['E2/startCap', 'E2/endCap', 'E2/side/qa']));
    expect([z(engine, 'E1', 'startCap', 'E2'), z(engine, 'E1', 'endCap', 'E2')]).toEqual([[3, 3], [7, 7]]);
    // výřez posunutý celý mimo těleso nemá účinek
    const outside = run(engine, { type: 'updateFeature', id: 'E2', patch: { extent: { start: 12 } } });
    expect(status(outside).E2).toMatch(/noEffect/);
    expect(volume(outside.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 6);
    // a výřez začínající přesně na stěně se od ní odečte čistě
    const flush = run(engine, { type: 'updateFeature', id: 'E2', patch: { extent: { start: 10, distance: -4 } } });
    expectAllOk(flush);
    expect(volume(flush.evaluation.bodies.E1.solid)).toBeCloseTo(12000 - 400, 6);
    expect(faceNames(flush, 'E1')).not.toContain('E2/startCap');
  });
});
