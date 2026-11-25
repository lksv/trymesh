// D35 step 0: a document of version 1 gives the same model after the upgrade, and the extent of an
// extrusion can start off the plane of the sketch. Against the real adapters.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Document, type Engine, type ExtrudeFeature, SCHEMA_PENDING, SCHEMA_VERSION, UPGRADES } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, cap, circle, expectAllOk, extrude, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, status, volume } from './kit';

const FIXTURE = readFileSync(new URL('./fixtures/v1-plate.json', import.meta.url), 'utf8');
const stl = (engine: Engine) => Array.from(engine.exportMesh('stl'));
// The fingerprint of the STL export of the same file from the engine before the change of the schema (commit bf51cd3).
const FIXTURE_STL = { bytes: 28384, sha256: '58c340068c782b14df2d97a9980e3529b1313aeef7f1d7f60e4a45507711087b' };

describe('step 0: a document of version 1', () => {
  // The file was saved by the engine before the change of the schema: a plate with a pocket, a boss
  // on a custom plane and a second body. The volumes, the face names and the fingerprint of the export
  // were computed by the same engine.
  it('it loads, recomputes to the same model and saves in the current version', () => {
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
    const exported = engine.exportMesh('stl');
    expect({ bytes: exported.length, sha256: createHash('sha256').update(exported).digest('hex') }).toEqual(FIXTURE_STL);

    const old = JSON.parse(FIXTURE) as { features: Record<string, unknown>[] };
    const saved = JSON.parse(engine.save()) as Document;
    // the head this build writes: on master the version alone, on a branch with a pending step its name too
    expect(saved).toMatchObject({ schemaVersion: SCHEMA_VERSION, parameters: [], checks: [] });
    expect(saved.schemaSteps).toEqual(SCHEMA_PENDING ? UPGRADES.slice(-SCHEMA_PENDING).map((step) => step.name) : undefined);
    saved.features.forEach((f, i) => {
      const before = old.features[i];
      if (f.type !== 'extrude') return expect(f).toEqual(before); // the sketches were not solved again
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

    // the saved document of version 2 gives a bit for bit identical model
    const other = newEngine();
    expect(other.load(engine.save()).ok).toBe(true);
    expect(other.save()).toBe(engine.save());
    expect(other.getState().evaluation).toEqual(state.evaluation);
    expect(stl(other)).toEqual(stl(engine));
    expect(other.getState()).toMatchObject({ canUndo: false, canRedo: false });
  });

  it('the engine refuses a document with parameters or checks for now and leaves the original document alone', () => {
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

describe('step 0: the start of the extent of an extrusion', () => {
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

  it('the body starts at an offset from the plane of the sketch; the caps are named by the start and the end of the extent', () => {
    for (const [start, distance] of [[5, 10], [5, -8], [-5, 3], [-5, -3], [2, -2]]) {
      const engine = plate(start, distance);
      expectAllOk(engine.getState());
      expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(1200 * Math.abs(distance), 6);
      expect(z(engine, 'E1', 'startCap')).toEqual([start, start]);
      expect(z(engine, 'E1', 'endCap')).toEqual([start + distance, start + distance]);
    }
  });

  it('a change of the start moves the body, undo moves it back; an empty change and an invalid batch create no undo step', () => {
    const engine = plate(0, 10);
    const before = stl(engine);
    const moved = run(engine, { type: 'updateFeature', id: 'E1', patch: { extent: { start: 4 } } });
    expect((moved.document.features[1] as ExtrudeFeature).extent).toEqual({ type: 'distance', start: 4, distance: 10 });
    expect([z(engine, 'E1', 'startCap'), z(engine, 'E1', 'endCap')]).toEqual([[4, 4], [14, 14]]);
    engine.undo();
    expect(stl(engine)).toEqual(before);
    expect(engine.getState()).toMatchObject({ canUndo: true, canRedo: true });
    // an empty change does not change the document: the history stays as it was
    const document = engine.save();
    expect(engine.execute({ type: 'updateFeature', id: 'E1', patch: {} }).ok).toBe(true);
    expect(engine.save()).toBe(document);
    expect(engine.getState().canRedo).toBe(true);
    // a batch is atomic and reports which command failed
    const failed = engine.execute(batch({ type: 'updateFeature', id: 'E1', patch: { extent: { start: 2 } } }, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 0 } } }));
    expect(failed).toMatchObject({ ok: false, error: { code: 'invalidCommand', commandIndex: 1 } });
    expect(engine.save()).toBe(document);
    expect(engine.getState().canRedo).toBe(true);
    // a suppressed feature is changed the same way and the change shows after it is restored
    run(engine, { type: 'setSuppressed', id: 'E1', suppressed: true }, { type: 'updateFeature', id: 'E1', patch: { extent: { start: -3, distance: -2 } } }, { type: 'setSuppressed', id: 'E1', suppressed: false });
    expect([z(engine, 'E1', 'startCap'), z(engine, 'E1', 'endCap')]).toEqual([[-3, -3], [-5, -5]]);
  });

  it('a sketch on either cap points out of the body for every combination of the start and the direction', () => {
    for (const [start, distance] of [[5, 10], [5, -8], [-5, -3], [0, -4]]) {
      for (const role of ['startCap', 'endCap'] as const) {
        const engine = plate(start, distance);
        run(engine, addSketch('S2', onFace('E1', cap('E1', role))), rectangle('S2', 'q', 2, 2, 6, 6, null), addExtrude('E2', 'S2', [rectLoop('q')], 3, 'add', 'E1'));
        expectAllOk(engine.getState());
        const at = role === 'startCap' ? start : start + distance;
        const outward = (role === 'endCap') === distance > 0 ? 1 : -1;
        expect(z(engine, 'E1', 'endCap', 'E2'), `${start}/${distance}/${role}`).toEqual([at + 3 * outward, at + 3 * outward]);
        expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(1200 * Math.abs(distance) + 108, 6);
      }
    }
  });

  it('a circular edge of a shifted body has its centre on the cap and can be projected into a sketch', () => {
    const engine = newEngine();
    const feature: ExtrudeFeature = { ...extrude('E1', 'S1', [['k']], -6), extent: { type: 'distance', start: 4, distance: -6 } };
    run(engine, addSketch('S1', XY), circle('S1', 'k', 10, 20, 5), { type: 'addFeature', feature });
    // the centre of the edge as the mean of the vertices of its segments (each vertex is in the list twice)
    const centre = (segments: Float64Array) => [0, 1, 2].map((axis) => segments.reduce((sum, value, i) => (i % 3 === axis ? sum + value : sum), 0) / (segments.length / 3));
    const rims = engine.getState().evaluation.bodies.E1.edges.filter((edge) => edge.kind === 'circle');
    expect(rims.map((edge) => centre(edge.segments)[2]).sort((a, b) => a - b)).toEqual([expect.closeTo(-2, 9), expect.closeTo(4, 9)]);
    for (const rim of rims) expect(centre(rim.segments).slice(0, 2)).toEqual([expect.closeTo(10, 3), expect.closeTo(20, 3)]);
    const rim = rims.find((edge) => Math.abs(centre(edge.segments)[2] + 2) < 1e-9)!;
    const state = run(engine, addSketch('S2', onFace('E1', cap('E1'))), { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'E1', edge: rim.name, kind: 'circle' } });
    expectAllOk(state);
    // the projected circle has an analytic radius and centre, in space on the axis of the cylinder
    const { plane, sketch } = state.evaluation.features.S2;
    expect(sketch!.radii.x).toBeCloseTo(5, 6);
    const c = sketch!.points['x/center'];
    expect([0, 1, 2].map((axis) => plane!.origin[axis] + c.x * plane!.x[axis] + c.y * plane!.y[axis])).toEqual([expect.closeTo(10, 6), expect.closeTo(20, 6), expect.closeTo(-2, 9)]);
    expect(state.evaluation.features.S2.plane!.origin[2]).toBeCloseTo(-2, 9);
  });

  it('a sketch on a cap of a shifted body lies on the cap even when the cap points against the normal of the sketch', () => {
    const engine = plate(5, 10);
    run(engine, addSketch('S2', onFace('E1', cap('E1', 'startCap'))), rectangle('S2', 'q', 2, 2, 6, 6, null), addExtrude('E2', 'S2', [rectLoop('q')], 3, 'add', 'E1'));
    expectAllOk(engine.getState());
    // a boss from the bottom cap grows out of the body, so down
    expect(z(engine, 'E1', 'startCap', 'E2')).toEqual([5, 5]);
    expect(z(engine, 'E1', 'endCap', 'E2')).toEqual([2, 2]);
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000 + 108, 6);
  });

  it('a cut with a shifted start cuts a cavity inside the body and both its caps are faces of the body', () => {
    const engine = plate(0, 10);
    const pocket: ExtrudeFeature = { ...extrude('E2', 'S2', [rectLoop('q')], 4, 'cut', 'E1'), extent: { type: 'distance', start: 3, distance: 4 } };
    run(engine, addSketch('S2', XY), rectangle('S2', 'q', 10, 10, 10, 10, null), { type: 'addFeature', feature: pocket });
    expectAllOk(engine.getState());
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo(12000 - 400, 6);
    expect(faceNames(engine.getState(), 'E1')).toEqual(expect.arrayContaining(['E2/startCap', 'E2/endCap', 'E2/side/qa']));
    expect([z(engine, 'E1', 'startCap', 'E2'), z(engine, 'E1', 'endCap', 'E2')]).toEqual([[3, 3], [7, 7]]);
    // a cut shifted entirely outside the body has no effect
    const outside = run(engine, { type: 'updateFeature', id: 'E2', patch: { extent: { start: 12 } } });
    expect(status(outside).E2).toMatch(/noEffect/);
    expect(volume(outside.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 6);
    // and a cut that starts exactly on a face is subtracted from it cleanly
    const flush = run(engine, { type: 'updateFeature', id: 'E2', patch: { extent: { start: 10, distance: -4 } } });
    expectAllOk(flush);
    expect(volume(flush.evaluation.bodies.E1.solid)).toBeCloseTo(12000 - 400, 6);
    expect(faceNames(flush, 'E1')).not.toContain('E2/startCap');
  });
});
