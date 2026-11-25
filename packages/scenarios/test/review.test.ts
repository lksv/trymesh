// Nálezy z revize enginu ověřené proti skutečným adaptérům, a chybové kódy, které dosud neměly test.
import type { Command, EngineState, FaceName, ImportedCurve, SketchFeature, SketchOutline } from '@trymesh/engine';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, expectAllOk, extrude, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { booleanOfBodies, sheetTriangles } from '../../engine/src/recompute/body-boolean';
import { isMoveProblem, movedOutwards } from '../../engine/src/recompute/moved-body';
import { volumeOf as volumeOf56 } from '../../engine/src/solid';
import { box as box56, cylinder as cylinder56, faceNumber as faceNumber56, infosOf as infosOf56, solidOf as solidOf56 } from './combine-kit';
import { faceKey, freshIds, readersOf, sketchTool, updateHolds } from '@trymesh/engine';
import { addOutline } from './board-kit';
import { canonicalEdge } from '../../engine/src/util';
import { projection } from '../../engine/src/references/projection';
import { STEPPED, box, chamfer, edge, fillet, profileXZ } from './blend-kit';

const kernel56 = await createManifoldKernel();


const plate = (width = 40, height = 30, thickness = 10) => {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, width, height), addExtrude('E1', 'S1', [rectLoop('r')], thickness));
  return engine;
};

describe('profil ze solveru', () => {
  it('čtvrtkruh s tečnami: obě oblasti se najdou při každém natočení', () => {
    for (let i = 0; i < 24; i++) {
      const angle = 0.13 + i * 0.26;
      const turn = (x: number, y: number): [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
      const point = (id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: 'S1', id, x: turn(x, y)[0] + 0.2, y: turn(x, y)[1] - 0.1 });
      const engine = newEngine();
      const state = run(
        engine,
        addSketch('S1', XY),
        batch(
          point('v', 10, 0),
          point('w', 0, 10),
          point('z', 10, 10),
          { type: 'addCurve', sketch: 'S1', id: 'arc', curve: { type: 'arc', center: 'origin', start: 'v', end: 'w' } },
          { type: 'addCurve', sketch: 'S1', id: 'wc', curve: { type: 'line', a: 'w', b: 'origin' } },
          { type: 'addCurve', sketch: 'S1', id: 'cv', curve: { type: 'line', a: 'origin', b: 'v' } },
          { type: 'addCurve', sketch: 'S1', id: 'vz', curve: { type: 'line', a: 'v', b: 'z' } },
          { type: 'addCurve', sketch: 'S1', id: 'zw', curve: { type: 'line', a: 'z', b: 'w' } },
          dimension('S1', 'vx', { type: 'horizontalDistance', a: 'origin', b: 'v' }, turn(10, 0)[0]),
          dimension('S1', 'vy', { type: 'verticalDistance', a: 'origin', b: 'v' }, turn(10, 0)[1]),
          constrain('S1', 'perp', { type: 'perpendicular', a: 'cv', b: 'wc' }),
          constrain('S1', 'tan1', { type: 'tangent', a: 'vz', b: 'arc' }),
          constrain('S1', 'tan2', { type: 'tangent', a: 'zw', b: 'arc' }),
        ),
      );
      const regions = state.evaluation.features.S1.sketch!.regions.map((r) => r.ref.outerLoop.join(','));
      expect(regions, `natočení ${angle.toFixed(2)}`).toEqual(['arc,cv,wc', 'arc,vz,zw']);
    }
  });

  it('čtverec těsně pod kružnicí: profil je neplatný a extrude to řekne, místo aby vzniklo vadné těleso', () => {
    const engine = newEngine();
    const corners = [0, 1, 2, 3].map((i) => [9.997 * Math.cos(0.02 + (i * Math.PI) / 2), 9.997 * Math.sin(0.02 + (i * Math.PI) / 2)]);
    run(
      engine,
      addSketch('S1', XY),
      batch(
        { type: 'addCurve', sketch: 'S1', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 10 },
        ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch: 'S1', id: `q${i}`, x, y })),
        ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: 'S1', id: `s${i}`, curve: { type: 'line', a: `q${i}`, b: `q${(i + 1) % 4}` } })),
      ),
    );
    expect(engine.getState().evaluation.features.S1.sketch).toMatchObject({ valid: false, regions: [] });
    expect(status(run(engine, addExtrude('E1', 'S1', [['k']], 10))).E1).toBe('error:invalidProfile');
  });
});

describe('bez účinku', () => {
  it('drobný výstupek na velké desce účinek má', () => {
    const engine = plate(200, 200, 50);
    const state = run(engine, addSketch('S2', onFace('E1', cap('E1'))), rectangle('S2', 'b', 100, 100, 1, 1, null), addExtrude('E2', 'S2', [rectLoop('b')], 1, 'add', 'E1'));
    expectAllOk(state);
    expect(volume(state.evaluation.bodies.E1.solid) - 200 * 200 * 50).toBeCloseTo(1, 2);
    expect(faceNames(state, 'E1')).toContain('E2/endCap');
  });

  it('tenký kolík na desce účinek má; přidání uvnitř tělesa ne', () => {
    const engine = plate();
    const pin = run(engine, addSketch('S2', onFace('E1', cap('E1'))), circle('S2', 'k', 20, 15, 0.05), addExtrude('E2', 'S2', [['k']], 1, 'add', 'E1'));
    expect(status(pin).E2).toBe('ok');
    const inside = run(engine, addSketch('S3', XY), rectangle('S3', 'i', 5, 5, 2, 2, null), addExtrude('E3', 'S3', [rectLoop('i')], 3, 'add', 'E1'));
    expect(status(inside).E3).toBe('warning:noEffect');
  });
});

describe('razítko řešení', () => {
  it('bod smazaný a v téže dávce přidaný pod stejným ID jinde se vyřeší znovu', () => {
    const engine = plate();
    const sketch = engine.getState().document.features[0] as SketchFeature;
    const lost = Object.entries(sketch.constraints).filter(([, c]) => ['"r3"', '"rb"', '"rc"'].some((id) => JSON.stringify(c).includes(id)));
    const state = run(
      engine,
      batch(
        { type: 'removeEntity', sketch: 'S1', id: 'r3' },
        { type: 'addPoint', sketch: 'S1', id: 'r3', x: 70, y: 55 },
        { type: 'addCurve', sketch: 'S1', id: 'rb', curve: sketch.curves.rb },
        { type: 'addCurve', sketch: 'S1', id: 'rc', curve: sketch.curves.rc },
        ...lost.map(([id, constraint]): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint })),
      ),
    );
    expectAllOk(state);
    expect(state.evaluation.features.S1.sketch!.points.r3).toEqual({ x: expect.closeTo(40, 6), y: expect.closeTo(30, 6) });
    expect((state.document.features[0] as SketchFeature).points.r3.x).toBeCloseTo(40, 6);
    expect(volume(state.evaluation.bodies.E1.solid)).toBeCloseTo(12000, 3);
  });
});

describe('scénář 6b: nálitek přichycený na krajní bod promítnuté hrany', () => {
  // rozměry, které float32 neuloží přesně: krajní bod promítnuté hrany má přesnost sítě
  for (const [width, height, thickness] of [
    [40.1, 30.1, 10.1],
    [33.3, 27.7, 9.9],
    [123.456, 78.9, 12.34],
  ]) {
    it(`deska ${width} × ${height} × ${thickness}`, () => {
      const engine = plate(width, height, thickness);
      run(
        engine,
        addSketch('S3', onFace('E1', cap('E1'))),
        batch(
          { type: 'addExternal', sketch: 'S3', id: 'right', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1'), b: side('E1', 'rb') }, kind: 'line' } },
          rectangle('S3', 'n', width - 10, height - 10, 10, 10, null),
        ),
      );
      // pravý horní roh nálitku na krajní bod promítnuté hrany místo kót šířky a výšky
      run(engine, batch({ type: 'removeConstraint', sketch: 'S3', id: 'nw' }, { type: 'removeConstraint', sketch: 'S3', id: 'nh' }, constrain('S3', 'snap', { type: 'coincident', a: 'n3', b: 'right/b' })));
      const state = run(engine, addExtrude('E3', 'S3', [rectLoop('n')], 5, 'add', 'E1'));
      expectAllOk(state);
      expect(volume(state.evaluation.bodies.E1.solid) - width * height * thickness).toBeCloseTo(500, 0);
      for (const [body, boss] of [['rb', 'nb'], ['rc', 'nc']]) {
        const seam = state.evaluation.bodies.E1.edges.find((e) => JSON.stringify(e.name) === JSON.stringify({ a: side('E1', body), b: side('E3', boss) }));
        expect(seam?.kind, `${body}|${boss}`).toBe('coplanar');
      }
      expect(faceNames(state, 'E1')).not.toContain('E3/startCap');
      const next = run(engine, addSketch('S4', onFace('E1', cap('E1'))), rectangle('S4', 'm', 5, 5, 10, 10, null), addExtrude('E4', 'S4', [rectLoop('m')], -5, 'cut', 'E1'));
      expectAllOk(next);
    });
  }
});

describe('chybové kódy', () => {
  it('skica na válcové stěně: nonPlanarFace', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), circle('S1', 'k', 0, 0, 10), addExtrude('E1', 'S1', [['k']], 10));
    const state = run(engine, addSketch('S2', onFace('E1', side('E1', 'k'))));
    expect(status(state).S2).toBe('error:nonPlanarFace');
    expect(state.evaluation.features.S2.sketch).toBeUndefined();
  });

  it('promítnutí hrany kolmé na rovinu skici: degenerateProjection; úsečky jako kružnice: unsupportedProjection', () => {
    const engine = plate();
    const vertical = { a: side('E1', 'ra'), b: side('E1', 'rb') };
    const top = { a: cap('E1'), b: side('E1', 'rb') };
    const state = run(
      engine,
      addSketch('S2', onFace('E1', cap('E1'))),
      { type: 'addExternal', sketch: 'S2', id: 'up', ref: { type: 'edge', body: 'E1', edge: vertical, kind: 'line' } },
      { type: 'addExternal', sketch: 'S2', id: 'round', ref: { type: 'edge', body: 'E1', edge: top, kind: 'circle' } },
    );
    const result = state.evaluation.features.S2;
    expect(result.status).toBe('warning');
    expect(result.warnings.map((w) => [w.code, (w.refs as string[])[0]])).toEqual([
      ['unsupportedProjection', 'round'],
      ['degenerateProjection', 'up'],
    ]);
    // skica s nepoužitelným promítnutím dál funguje
    expect(status(run(engine, rectangle('S2', 'q', 5, 5, 4, 4, null), addExtrude('E2', 'S2', [rectLoop('q')], 2, 'add', 'E1'))).E2).toBe('ok');
  });
});

// Findings of the review of the registries (D37, parts 1 and 4).
describe('queries and exports: callers that are not typed', () => {
  const failure = (outcome: { ok: boolean; error?: { code: string; arg?: readonly (string | number)[]; message: string } }) => (outcome.ok ? 'ok' : [outcome.error?.code, outcome.error?.arg, outcome.error?.message]);

  it('a name that is not a text and options that are not an object are refused with a code, not thrown', () => {
    const engine = plate();
    expect(failure(engine.query(['interference'] as never, {} as never))).toEqual(['invalidArguments', ['query'], expect.stringMatching(/^there is no query of that name \(a text is expected\); the queries are /)]);
    expect(failure(engine.query(JSON.parse('{"toString":null}') as never, {} as never))).toEqual(['invalidArguments', ['query'], expect.any(String)]);
    expect(failure(engine.export(JSON.parse('{"toString":null}') as never, {} as never))).toEqual(['invalidArguments', ['format'], 'there is no export format of that name (a text is expected); the formats are stl, 3mf, dxf, svg, partsCsv, urdf, mjcf']);
    expect(failure(engine.query('interference', {}, null as never))).toEqual(['invalidArguments', ['options'], 'interference: the options are an object with `at` or `state`']);
    expect(failure(engine.query('interference', {}, 7 as never))).toEqual(['invalidArguments', ['options'], expect.any(String)]);
    expect(failure(engine.export('stl', {}, null as never))).toEqual(['invalidArguments', ['options'], 'stl: the options are an object with `at` or `state`']);
    expect(engine.query('interference', {}, undefined)).toMatchObject({ ok: true });
  });

  it('a hole in a list is an item that is not there, not one to skip', () => {
    const engine = plate();
    expect(failure(engine.query('interference', { bodies: new Array(2) }))).toEqual(['invalidArguments', ['bodies', 0], 'interference: bodies[0]: the ID of a body is expected']);
    expect(failure(engine.export('stl', { bodies: new Array(1) }))).toEqual(['invalidArguments', ['bodies', 0], 'stl: bodies[0]: the ID of a body is expected']);
  });

  it('an empty list of bodies to export is refused, not answered as a model without a body', () => {
    const engine = plate();
    expect(failure(engine.export('stl', { bodies: [] }))).toEqual(['invalidArguments', ['bodies'], 'stl: bodies: at least 1 item is expected']);
    expect(engine.exportMesh('stl', [])).toHaveLength(84); // the method of before keeps its answer
  });
});

// D44 (package 2a of D36) changed what a profile hands to the prism build (`sideOf` in place of
// `curveOf`, exact curves on every loop) and added an offset. A document that does not use the
// offset must not see any of it: the meshes of this model, their face numbers and the table of
// face names are, byte for byte, what the code before D44 built (the hash was computed with the
// engine of the commit before the package and with this one, and was the same).
describe('an extrusion without an offset (D44)', () => {
  it('builds the mesh it built before the offset existed', () => {
    const engine = newEngine();
    const extrude = (id: string, loops: string[][], start: number, distance: number, operation: 'new' | 'add' | 'cut', targets?: string[]): Command => ({
      type: 'addFeature',
      feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S1', regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) }, extent: { type: 'distance', start, distance }, operation, ...(targets ? { targets } : {}) },
    });
    // a plate 40 × 30 with two rounded corners, a round hole and a slot of two lines and two arcs
    const points: Record<string, [number, number]> = {
      p1: [0, 0], p2: [35, 0], p3: [40, 5], p4: [40, 25], p5: [35, 30], p6: [0, 30], c1: [35, 5], c2: [35, 25],
      k: [10, 15], s1: [20, 10], s2: [30, 10], s3: [30, 20], s4: [20, 20], sc1: [30, 15], sc2: [20, 15],
    };
    const curves: Record<string, SketchFeature['curves'][string]> = {
      a: { type: 'line', a: 'p1', b: 'p2' }, ra: { type: 'arc', center: 'c1', start: 'p2', end: 'p3' }, b: { type: 'line', a: 'p3', b: 'p4' },
      rb: { type: 'arc', center: 'c2', start: 'p4', end: 'p5' }, c: { type: 'line', a: 'p5', b: 'p6' }, d: { type: 'line', a: 'p6', b: 'p1' },
      sa: { type: 'line', a: 's1', b: 's2' }, sra: { type: 'arc', center: 'sc1', start: 's2', end: 's3' }, sb: { type: 'line', a: 's3', b: 's4' }, srb: { type: 'arc', center: 'sc2', start: 's4', end: 's1' },
    };
    const [OUTER, SLOT] = [['a', 'ra', 'b', 'rb', 'c', 'd'], ['sa', 'sra', 'sb', 'srb']];
    const state = run(
      engine,
      addSketch('S1', XY),
      ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y })),
      ...Object.entries(curves).map(([id, curve]): Command => ({ type: 'addCurve', sketch: 'S1', id, curve })),
      { type: 'addCurve', sketch: 'S1', id: 'hole', curve: { type: 'circle', center: 'k' }, radius: 4 },
      constrain('S1', 'fix', { type: 'coincident', a: 'p1', b: 'origin' }),
      extrude('A', [OUTER], 0, 10, 'new'),
      extrude('B', [OUTER, SLOT, ['hole']], 10, 3, 'add', ['A']),
      extrude('C', [SLOT], 2, 20, 'cut', ['A']),
      extrude('D', [['hole']], 20, 5, 'new'),
    );
    expectAllOk(state);
    const hash = createHash('sha256');
    const bytes = (array: Float32Array | Uint32Array): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const id of Object.keys(state.evaluation.bodies).sort()) {
      const { solid } = state.evaluation.bodies[id];
      hash.update(id).update(bytes(solid.positions)).update(bytes(solid.triangles)).update(bytes(solid.faceIds));
    }
    hash.update(JSON.stringify(state.evaluation.faceNames));
    expect(Object.values(state.evaluation.bodies).map((body) => body.solid.triangles.length / 3)).toEqual([828, 176]);
    expect(hash.digest('hex')).toBe('666e3a9c7aa781c5d11d058cb048f37175c7714bcf48de5b1bde7013fecc0911');
  });
});

// The review of D46 (package 2c of D36): the hole feature.
describe('the hole: the review of D46', () => {
  const COUNTERBORE = { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 3 } as const;
  const NUT = { type: 'nutPocket', diameter: 3.4, acrossFlats: 5.5, headDepth: 2.4, rotation: 0 } as const;
  const THROUGH = { type: 'throughAll', side: 'backward' } as const;
  const fixed = (sketch: string, id: string, x: number, y: number): Command => batch({ type: 'addPoint', sketch, id, x, y }, constrain(sketch, `f${id}`, { type: 'fixed', point: id, x, y }));
  // the plate E1 of 40 × 30 × 10 and a sketch T on its top with the given points
  const top = (...points: [string, number, number][]) => {
    const engine = plate();
    run(engine, addSketch('T', onFace('E1', cap('E1'))), ...points.map(([id, x, y]) => fixed('T', id, x, y)));
    return engine;
  };
  const hole = (sketch: string, points: string[], shape: object, extent: object, targets = ['E1']): Command =>
    ({ type: 'addFeature', feature: { id: 'H', name: 'H', suppressed: false, type: 'hole', sketch, points, shape, extent, targets } }) as Command;
  const ofHole = (state: ReturnType<typeof run>, body = 'E1') => faceNames(state, body).filter((name) => name.startsWith('H/'));

  it('a point whose ID holds a pipe: its own faces, also beside a point whose ID is its prefix', () => {
    const engine = top(['x|1', 10, 10], ['x', 30, 10]);
    const alone = run(engine, hole('T', ['x|1'], NUT, THROUGH));
    expect(status(alone).H).toBe('ok');
    expect(ofHole(alone)).toEqual(['H/holeBore/x|1', 'H/holeFlat/1/x|1', 'H/holeFlat/2/x|1', 'H/holeFlat/3/x|1', 'H/holeFlat/4/x|1', 'H/holeFlat/5/x|1', 'H/holeFlat/6/x|1', 'H/holeSeat']);
    const both = engine.preview({ type: 'updateFeature', id: 'H', patch: { points: ['x|1', 'x'] } });
    if (!both.ok) throw new Error(both.error.message);
    expect(status(both.state).H).toBe('ok');
    const bores = ofHole(both.state).filter((name) => name.startsWith('H/holeBore/'));
    expect(bores).toEqual(['H/holeBore/x', 'H/holeBore/x|1']);
    // each bore lies at its own point
    const surface = (point: string) => both.state.evaluation.faceSurfaces[both.state.evaluation.faceNames.findIndex((name) => name.feature === 'H' && name.role === 'holeBore' && name.point === point)];
    expect(surface('x|1')).toMatchObject({ kind: 'cylinder', origin: [10, 10, 10] });
    expect(surface('x')).toMatchObject({ kind: 'cylinder', origin: [30, 10, 10] });
  });

  it('a head or a blind bore not longer than the resolution of the kernel is refused, not built wrong', () => {
    // the largest coordinate is 40: the resolution is 0.004
    const engine = top(['p', 10, 10]);
    const errorOf = (shape: object, extent: object) => {
      const state = engine.preview(hole('T', ['p'], shape, extent));
      if (!state.ok) throw new Error(state.error.message);
      return state.state.evaluation.features.H.error;
    };
    expect(errorOf(COUNTERBORE, { type: 'distance', start: 0, distance: -3.00001 })).toMatchObject({ code: 'invalidHole', message: expect.stringMatching(/the bore below the head has to be longer than 0\.004 mm/) });
    expect(errorOf(COUNTERBORE, { type: 'distance', start: 0, distance: -3.003 })?.code).toBe('invalidHole');
    expect(errorOf(COUNTERBORE, { type: 'distance', start: 0, distance: -3.01 })).toBeUndefined();
    expect(errorOf({ ...COUNTERBORE, headDepth: 0.0005 }, THROUGH)).toMatchObject({ code: 'invalidHole', message: expect.stringMatching(/the head is 0\.0005 mm deep, not more than the resolution of the kernel/) });
    // a countersink of 179.9°: its cone is 0.0011 deep
    expect(errorOf({ type: 'countersink', diameter: 3.4, headDiameter: 6, angle: 'deg(179.9)' }, THROUGH)?.code).toBe('invalidHole');
    expect(errorOf({ type: 'plain', diameter: 3 }, { type: 'distance', start: 0, distance: -0.003 })).toMatchObject({ code: 'invalidHole', message: expect.stringMatching(/the hole is 0\.003 mm deep/) });
    expect(errorOf({ type: 'plain', diameter: 3 }, { type: 'distance', start: 0, distance: -0.01 })).toBeUndefined();
  });

  it('a target wholly inside a head marked to change nothing is invalidHole, not emptyResult', () => {
    const engine = plate();
    run(engine, addSketch('S2', XY), rectangle('S2', 'q', 9, 9, 2, 2, null), { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S2', regions: [{ outerLoop: rectLoop('q').sort() }] }, extent: { type: 'distance', start: 0, distance: -1 }, operation: 'new' } });
    run(engine, addSketch('T', XY), fixed('T', 'p', 10, 10));
    const state = run(engine, hole('T', ['p'], COUNTERBORE, THROUGH, ['Q']));
    expect(state.evaluation.features.H.error).toMatchObject({ code: 'invalidHole', refs: ['Q'] });
  });

  it('a head wholly outside the targets with through all is not detected (a limit, pinned)', () => {
    // the sketch 5 above a plate 10 thick: the reach is 15, the bore cuts the plate, the head is in the air
    const engine = plate();
    run(engine, { type: 'addFeature', feature: { id: 'PL', name: 'PL', suppressed: false, type: 'plane', base: XY, offset: 15 } }, addSketch('T', { kind: 'plane', feature: 'PL' }), fixed('T', 'p', 10, 10));
    const state = run(engine, hole('T', ['p'], COUNTERBORE, THROUGH));
    expect(status(state).H).toBe('ok');
    expect(ofHole(state)).toEqual(['H/holeBore/p']);
  });
});

describe('the linear pattern and the mirror: the review of D53', () => {
  const faceBoxOf = (state: EngineState, body: string, name: FaceName) => {
    const box = faceBox(state, body, name);
    if (!box) throw new Error(`no face ${JSON.stringify(name)}`);
    return box;
  };
  const pattern = (id: string, source: object, transform: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform } as never });
  const planeAt = (id: string, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset } });
  const tagged = (name: FaceName, index: number): FaceName => ({ ...name, copy: [{ pattern: 'M', index }] });
  const extrusion = (id: string, sketch: string, loop: string[], extent: object, operation: 'add' | 'cut'): Command => ({
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [...loop].sort() }] }, extent, operation, targets: ['E1'] } as never,
  });

  // A mirror plane parallel to the sketch plane reverses the normal of the frame of the copy: the
  // sign of a distance and the side of an extent then run the other way, and the copy is still the
  // image of its source. A plate 60 × 40 × 10, the sketch on its top (z = 10), the mirror in z = 5.
  it('a mirror in a plane parallel to the sketch: added, cut, tapered and holed copies are the images of their sources', () => {
    const tools: [string, Command[], number][] = [
      ['added', [extrusion('F', 'T', rectLoop('q'), { type: 'distance', start: 0, distance: 5 }, 'add')], -5],
      ['cut blind', [extrusion('F', 'T', rectLoop('q'), { type: 'distance', start: 0, distance: -3 }, 'cut')], 0],
      ['a tapered cut', [extrusion('F', 'T', rectLoop('q'), { type: 'distance', start: 0, distance: -3, taper: 'deg(5)' }, 'cut')], 0],
      ['a nut pocket', [{ type: 'addPoint', sketch: 'T', id: 'h', x: 30, y: 20 }, { type: 'addFeature', feature: { id: 'F', name: 'F', suppressed: false, type: 'hole', sketch: 'T', points: ['h'], shape: { type: 'nutPocket', diameter: 3, acrossFlats: 5.5, headDepth: 2.5, rotation: 0.1 }, extent: { type: 'distance', start: 0, distance: -4 }, targets: ['E1'] } }], 0],
    ];
    for (const [name, commands, low] of tools) {
      const engine = plate(60, 40, 10);
      run(engine, planeAt('top', 10), planeAt('low', 5), addSketch('T', { kind: 'plane', feature: 'top' }), rectangle('T', 'q', 5, 5, 10, 8, null));
      const before = volume(engine.getState().evaluation.bodies.E1.solid);
      const once = volume(run(engine, ...commands).evaluation.bodies.E1.solid);
      const state = run(engine, pattern('M', { type: 'features', features: ['F'] }, { type: 'mirror', plane: { kind: 'plane', feature: 'low' } }));
      expectAllOk(state);
      expect(Math.abs(volume(state.evaluation.bodies.E1.solid) - once - (once - before)), name).toBeLessThan(1e-3 * Math.abs(once - before));
      expect(state.evaluation.bodies.E1.bounds.min[2], name).toBeCloseTo(low, 5);
    }
  });

  it('a linear pattern of features along the normal of a sketch on a face', () => {
    // bosses on the top, shifted along the normal of a sketch on the side y = 0 (−Y, out of the
    // plate): a negative spacing runs into the plate, +Y
    const engine = plate(60, 40, 10);
    run(engine, planeAt('top', 10), addSketch('T', { kind: 'plane', feature: 'top' }), circle('T', 'b', 10, 10, 2), extrusion('boss', 'T', ['b'], { type: 'distance', start: 0, distance: 5 }, 'add'), addSketch('W', onFace('E1', side('E1', 'ra'))));
    const state = run(engine, pattern('P', { type: 'features', features: ['boss'] }, { type: 'linear', direction: { kind: 'sketchPoint', sketch: 'W', point: 'origin' }, count: 3, span: { type: 'spacing', spacing: -12 } }));
    expectAllOk(state);
    const middle = (index: number): number => {
      const box = faceBoxOf(state, 'E1', { feature: 'boss', role: 'endCap', copy: [{ pattern: 'P', index }] });
      return (box.min[1] + box.max[1]) / 2;
    };
    expect(middle(1)).toBeCloseTo(22, 4);
    expect(middle(2)).toBeCloseTo(34, 4);
  });

  it('a face tagged as copy 2 of a mirror in a projected edge: a valid command, the warning brokenProjection', () => {
    const engine = plate(60, 40, 10);
    run(engine, { type: 'addFeature', feature: { id: 'far', name: 'far', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'YZ' }, offset: 80 } }, pattern('M', { type: 'body', body: 'E1' }, { type: 'mirror', plane: { kind: 'plane', feature: 'far' } }), addSketch('Top', XY));
    const edge = (index: number) => ({ a: tagged(cap('E1'), index), b: tagged(side('E1', 'ra'), index) });
    let state = run(engine, { type: 'addExternal', sketch: 'Top', id: 'one', ref: { type: 'edge', body: 'M/1', edge: edge(1), kind: 'line' } });
    expect(status(state).Top).toBe('ok');
    state = run(engine, { type: 'addExternal', sketch: 'Top', id: 'two', ref: { type: 'edge', body: 'M/1', edge: edge(2), kind: 'line' } });
    expect(status(state).Top).toBe('warning:brokenProjection');
  });
});

describe('the export of an outline: the review of D54', () => {
  it('a half turn is two pieces wherever the part sits: slots at odd places, the sweep off π by what float32 does to its ends', () => {
    const counts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const engine = newEngine();
      const [x, y, r, length] = [10.3 + i * 1.37, 0.7 + i * 0.113, 2.3 + 0.17 * i, 13.1 + i * 0.71];
      expectAllOk(
        run(
          engine,
          addSketch('R', XY),
          rectangle('R', 's', x, y - r, length, 2 * r, null),
          addExtrude('SLOT', 'R', [rectLoop('s')], 5),
          addSketch('K', XY),
          circle('K', 'ka', x, y, r),
          circle('K', 'kb', x + length, y, r),
          addExtrude('SLOTA', 'K', [['ka']], 5, 'add', 'SLOT'),
          addExtrude('SLOTB', 'K', [['kb']], 5, 'add', 'SLOT'),
        ),
      );
      const answer = engine.export('dxf', { plane: XY, offset: 2, bodies: ['SLOT'] });
      if (!answer.ok) throw new Error(answer.error.message);
      counts.push(new TextDecoder().decode(answer.result.files[0].bytes).split('\r\n').filter((value, k) => value === '42' && k % 2 === 0).length);
    }
    expect(counts).toEqual(Array(12).fill(4)); // were 5 or 6 in eleven of them
  });
});

describe('the review of D59: the export of a robot', () => {
  const engine = newEngine();
  run(engine, addSketch('S1', XY), circle('S1', 'k', 0, 0, 5), addExtrude('low', 'S1', [['k']], 10), addExtrude('high', 'S1', [['k']], -10));
  run(engine, {
    type: 'batch',
    commands: [
      { type: 'setBodyProperties', body: 'low', patch: { density: 1.2 } },
      { type: 'setBodyProperties', body: 'high', patch: { density: 1.2 } },
      { type: 'setLink', id: 'base', bodies: [] },
      { type: 'setLink', id: 'frame', bodies: [] },
      { type: 'setLink', id: 'plate', bodies: ['low', 'high'] },
      { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'frame', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2 } },
      { type: 'setJoint', id: 'mount', joint: { type: 'fixed', parent: 'frame', child: 'plate' } },
    ],
  });
  const text = (format: 'urdf' | 'mjcf', options: object = {}): string => {
    const outcome = engine.export(format, options as never);
    if (!outcome.ok) throw new Error(outcome.error.message);
    return new TextDecoder().decode(outcome.result.files[0].bytes);
  };

  it('a link without mass (an empty root, a moving frame with its mass on a fixed child) states an inertial of zero in URDF', () => {
    const urdf = text('urdf');
    const zero = '\n    <inertial>\n      <origin xyz="0 0 0" rpy="0 0 0"/>\n      <mass value="0"/>\n      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>\n    </inertial>\n  </link>';
    expect(urdf).toContain(`<link name="base">${zero}`);
    expect(urdf).toContain(`<link name="frame">${zero}`);
    expect(text('mjcf')).toContain('<body name="frame" pos="0 0 0">\n        <joint name="turn"');
  });

  it('a link that lists a body the model does not have is refused with the link', () => {
    const state = engine.preview({ type: 'setSuppressed', id: 'high', suppressed: true });
    if (!state.ok) throw new Error(state.error.message);
    const outcome = engine.export('urdf', {}, { state: state.state });
    expect(outcome).toEqual({ ok: false, error: { code: 'failed', message: 'urdf: a link lists bodies the model does not have (a link would be written lighter than it is): plate: high' } });
  });

  it('a name or a mesh prefix that XML cannot hold as it is, and an empty name, are refused', () => {
    expect(engine.export('urdf', { name: 'a\u0001' })).toEqual({ ok: false, error: { code: 'invalidArguments', message: 'urdf: name: "a\\u0001" holds a character XML cannot hold', arg: ['name'] } });
    expect(engine.export('mjcf', { name: '' })).toEqual({ ok: false, error: { code: 'invalidArguments', message: 'mjcf: name: the name is empty', arg: ['name'] } });
    expect(engine.export('urdf', { meshPrefix: 'x\u0002/' })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['meshPrefix'] } });
    expect(text('urdf', { name: 'a & b' })).toContain('<robot name="a &amp; b">');
  });
});

// D56: cases the reviews of the design of the boolean of bodies and of its revision measured.
describe('the boolean of bodies and the clearance (D56): cases of the reviews', () => {
  const engineOf = (...commands: Command[]): EngineState => run(newEngine(), batch(...commands));

  it('a ledge 0.001 wide between a countersink and its bore (codex): refused, never moved with a description off its triangles', () => {
    // before the fix it was accepted and 48 triangles of the ledge lay 0.177 off the plane published for them
    const state = engineOf(...box56('A', -5, -5, 5, 5, 0, 4), ...cylinder56('sink', 0, 0, 1.001, 2, 4.0001, 'cut', ['A'], 'deg(44.98)'), ...cylinder56('bore', 0, 0, 1, -1, 5, 'cut', ['A']));
    const moved = movedOutwards(solidOf56(state, 'A'), infosOf56(state), state.evaluation.faceNames, 0.3, 0.01, kernel56);
    expect(isMoveProblem(moved) && moved.reason).toBe('vertex');
  });

  it('a riser 0.005 high between two parallel planes is no crescent: it is moved with its faces, and the pocket keeps its description', () => {
    const state = engineOf(...box56('A', 0, 0, 20, 10, 0, 5), ...box56('step', 10, -1, 21, 11, 4.995, 6, 'cut', ['A']), ...cylinder56('hole', 10, 5, 2, -1, 7, 'cut', ['A']));
    const riser = faceNumber56(state, { feature: 'step', role: 'side', curve: 'stepL3' });
    const moved = movedOutwards(solidOf56(state, 'A'), infosOf56(state), state.evaluation.faceNames, 0.2, 0.01, kernel56);
    if (isMoveProblem(moved)) throw new Error(`${moved.reason}: ${moved.detail}`);
    expect(moved.infos.has(riser) && moved.solid.faceIds.includes(riser)).toBe(true);
  });

  it('a slab thinner than the sheet tolerance whose two sides are strips across each other is all sheet, at 450 and 2000 mm, however narrow the strips', () => {
    for (const [z, eps] of [[450, 2.25e-4], [2000, 1e-3]]) {
      for (const n of [8, 100]) {
        const step = z === 450 ? 2 ** -15 : 2 ** -13; // a step of single precision there
        const positions: number[] = [];
        const at = (x: number, y: number, top: boolean, i: number): number => (positions.push(x, y, top ? z + 3 * step + (i % 2) * step : z + (i % 2) * step), positions.length / 3 - 1);
        const grid = (top: boolean): number[][] => Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => at((i * 0.2) / n, (j * 0.2) / n, top, top ? j : i)));
        const [T, B] = [grid(true), grid(false)];
        const triangles: number[] = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) triangles.push(T[i][j], T[i + 1][j], T[i + 1][j + 1], T[i][j], T[i + 1][j + 1], T[i][j + 1], B[i][j], B[i + 1][j + 1], B[i + 1][j], B[i][j], B[i][j + 1], B[i + 1][j + 1]);
        for (let k = 0; k < n; k++) for (const [a, b, c, d] of [[B[k][0], B[k + 1][0], T[k + 1][0], T[k][0]], [B[n][k], B[n][k + 1], T[n][k + 1], T[n][k]], [B[k + 1][n], B[k][n], T[k][n], T[k + 1][n]], [B[0][k + 1], B[0][k], T[0][k], T[0][k + 1]]]) triangles.push(a, b, c, a, c, d);
        const slab = { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: new Uint32Array(triangles.length / 3) };
        const sheet = sheetTriangles(slab, eps);
        expect(sheet.slice(0, 4 * n * n).every((flag) => flag === 1)).toBe(true);
      }
    }
  });

  it('a crescent between a pin and its hole turned by part of a polygon side is no sheet: the union of the two is right', () => {
    const state = engineOf(...box56('plate', -10, -10, 10, 10, 0, 5), ...cylinder56('hole', 0, 0, 3, -1, 6, 'cut', ['plate']), ...cylinder56('pin', 0, 0, 3, 0, 5));
    const turned = solidOf56(state, 'pin');
    // a turn of π/30 against a polygon of n sides is a turn by a fraction of a side (a whole side
    // turns the polygon into itself): the two polygons differ, their crescents are thin
    const angle = Math.PI / 30;
    const positions = Float32Array.from(turned.positions, (value, i) => (i % 3 === 0 ? value * Math.cos(angle) - turned.positions[i + 1] * Math.sin(angle) : i % 3 === 1 ? turned.positions[i - 1] * Math.sin(angle) + value * Math.cos(angle) : value));
    const [plate, pin] = [solidOf56(state, 'plate'), { ...turned, positions }];
    const result = booleanOfBodies(kernel56, 'union', plate, pin, state.evaluation.faceNames.length, 0.01);
    expect(result.changed).toBe(true);
    // the crescents between the two polygons are gaps through the plate: the union is the two less what they share
    const shared = kernel56.boolean('intersection', plate, { ...pin, faceIds: pin.faceIds.map((face) => face + 1000) });
    expect(volumeOf56(result.solid)).toBeCloseTo(volumeOf56(plate) + volumeOf56(pin) - volumeOf56(shared), 3);
  });
});

// The review of D36 4a (D58), the revolve.
describe('review of 4a (D58)', () => {
  const XZ = { kind: 'base', plane: 'XZ' } as const;
  const torus = (): ReturnType<typeof newEngine> => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XZ),
      { type: 'addPoint', sketch: 'S', id: 'c', x: 20, y: 0 },
      { type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'c' }, radius: 5 },
      { type: 'addFeature', feature: { id: 'T', name: 'T', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['k'] }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'full' }, operation: 'new' } },
    );
    return engine;
  };

  it('a section through the axis of a torus gives the two circles of its tube as arcs, though it is taken `below` the plane', () => {
    const engine = torus();
    for (const plane of [XZ, { kind: 'base', plane: 'YZ' } as const]) {
      const result = engine.query('section', { plane, bodies: ['T'] });
      if (!result.ok) throw new Error(result.error.message);
      const spans = result.result.bodies.flatMap((body) => body.regions ?? []).flatMap((region) => [region.outer, ...region.holes]).flatMap((loop) => loop.spans ?? []);
      expect(spans.map((span) => span.kind)).toEqual(['arc', 'arc']);
      for (const span of spans) if (span.kind === 'arc') expect(span.radius).toBeCloseTo(5, 6);
    }
  });

  it('a line of no length as the axis of a revolve, a pattern or a joint says so in the message', () => {
    const engine = torus();
    run(engine, { type: 'addPoint', sketch: 'S', id: 'z0', x: 50, y: 50 }, { type: 'addPoint', sketch: 'S', id: 'z1', x: 50, y: 50 }, { type: 'addCurve', sketch: 'S', id: 'zl', curve: { type: 'line', a: 'z0', b: 'z1', construction: true } });
    const line = { kind: 'sketchLine', sketch: 'S', line: 'zl' } as const;
    const revolve = engine.preview({ type: 'updateFeature', id: 'T', patch: { axis: line } });
    expect(revolve.ok && revolve.state.evaluation.features.T.error?.message).toMatch(/\(the line of the axis has no length\)$/);
    const pattern = engine.preview({ type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'T' }, transform: { type: 'circular', axis: line, count: 2, span: { type: 'full' } } } });
    expect(pattern.ok && pattern.state.evaluation.features.P.error?.message).toMatch(/the line of the axis has no length/);
    run(engine, { type: 'setLink', id: 'a', bodies: ['T'] }, { type: 'addFeature', feature: { id: 'T2', name: 'T2', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['k'] }] }, axis: { kind: 'base', axis: 'Z' }, extent: { type: 'full' }, operation: 'new' } }, { type: 'setLink', id: 'b', bodies: ['T2'] });
    const joint = run(engine, { type: 'setJoint', id: 'j', joint: { type: 'revolute', parent: 'a', child: 'b', axis: line, lower: -1, upper: 1, value: 0 } });
    expect(joint.evaluation.mechanism.joints.j.error?.message).toMatch(/the axis of the joint "j": the line of the axis has no length/);
  });
});

describe('the review of D63: the chamfer and the fillet of edges', () => {
  const applied = (state: EngineState, command: Command, body = 'E') => {
    const engine = newEngine();
    engine.load(JSON.stringify(state.document));
    const before = engine.getState().evaluation.bodies[body].volume;
    const result = engine.preview(command);
    if (!result.ok) throw new Error(result.error.message);
    const outcome = result.state.evaluation.features[(command as { feature: { id: string } }).feature.id];
    return { code: outcome.error?.code, message: outcome.error?.message ?? '', refs: outcome.error?.refs ?? [], change: result.state.evaluation.bodies[body].volume - before, state: result.state };
  };
  // the area of the triangles of a face whose normal points along (+) and against (−) a direction
  const facing = (state: EngineState, key: string, direction: [number, number, number]): [number, number] => {
    const s = state.evaluation.bodies.E.solid;
    const p = s.positions;
    const sums: [number, number] = [0, 0];
    for (let t = 0; t < s.faceIds.length; t++) {
      if (faceKey(state.evaluation.faceNames[s.faceIds[t]]) !== key) continue;
      const [i, j, k] = [s.triangles[3 * t], s.triangles[3 * t + 1], s.triangles[3 * t + 2]];
      const u = [0, 1, 2].map((d) => p[3 * j + d] - p[3 * i + d]);
      const v = [0, 1, 2].map((d) => p[3 * k + d] - p[3 * i + d]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const along = n[0] * direction[0] + n[1] * direction[1] + n[2] * direction[2];
      sums[along >= 0 ? 0 : 1] += Math.hypot(n[0], n[1], n[2]) / 2;
    }
    return sums;
  };
  const RISER_1: [number, number][] = [[0, 0], [60, 0], [60, 20], [30, 20], [30, 19], [0, 19]];
  const highTop = edge(side('E', 'l2'), cap('E', 'startCap'));

  it('a chamfer deeper than the riser its edge ends at: refused, the riser named; a smaller one keeps the riser facing its way', () => {
    // the cap of the tool left 60.5 mm² facing +x in the riser (outward −x), and a sketch on the riser turned round
    const S = profileXZ(RISER_1);
    for (const make of [chamfer, fillet]) {
      const deep = applied(S, make('c', 'E', [highTop], 12));
      expect(deep.code).toBe('blendDoesNotFit');
      expect(deep.message).toMatch(/reaches past the end face/);
      expect((deep.refs as object[]).filter((ref) => 'role' in ref).map((ref) => faceKey(ref as FaceName))).toContain('E/side/l3');
    }
    const small = applied(S, chamfer('c', 'E', [highTop], 0.5));
    expect(small.code).toBeUndefined();
    expect(facing(small.state, 'E/side/l3', [1, 0, 0])[0]).toBe(0);
    const sketched = applied(small.state, addSketch('on', onFace('E', side('E', 'l3'))));
    expect(sketched.state.evaluation.features.on.plane?.normal[0]).toBeCloseTo(-1, 9);
  });

  it('the riser of 10 of the step: a chamfer of 12 is refused, a fillet of 12 leaves a sliver that goes to the fillet', () => {
    const S = profileXZ(STEPPED);
    expect(applied(S, chamfer('c', 'E', [highTop], 12)).code).toBe('blendDoesNotFit');
    const round = applied(S, fillet('c', 'E', [highTop], 12));
    if (round.code === undefined) expect(facing(round.state, 'E/side/l3', [1, 0, 0])[0]).toBe(0);
    else expect(round.code).toBe('blendDoesNotFit');
  });

  it('an added blend at a concave edge that ends at a lower wall stands out over it: refused', () => {
    const engine = newEngine();
    box(engine, 60, 40, 5);
    const S = run(
      engine,
      addSketch('t', onFace('E', cap('E'))),
      rectangle('t', 'wa', 0, 0, 50, 5, null),
      addExtrude('A', 't', [rectLoop('wa')], 30, 'add', 'E'),
      addSketch('u', onFace('E', cap('E'))),
      rectangle('u', 'wb', 0, 5, 5, 35, null),
      addExtrude('B', 'u', [rectLoop('wb')], 1, 'add', 'E'),
    );
    for (const make of [chamfer, fillet]) {
      const out = applied(S, make('c', 'E', [edge(cap('E'), side('A', 'wac'))], 4));
      expect(out.code).toBe('blendDoesNotFit');
      expect(out.message).toMatch(/standing out over that face/);
    }
  });

  it('a concave edge whose ends are at a plate and a wall flush with it: the two planes are one end face', () => {
    const engine = newEngine();
    box(engine, 60, 40, 5);
    const S = run(engine, addSketch('t', onFace('E', cap('E'))), rectangle('t', 'wa', 0, 0, 60, 5, null), addExtrude('A', 't', [rectLoop('wa')], 30, 'add', 'E'));
    const inner = edge(cap('E'), side('A', 'wac'));
    const flat = applied(S, chamfer('c', 'E', [inner], 4));
    expect(flat.code).toBeUndefined();
    expect(flat.change).toBeCloseTo(0.5 * 16 * 60, 2);
    const round = applied(S, fillet('c', 'E', [inner], 4));
    expect(round.code).toBeUndefined();
    // the arc is a polygon inside the circle: a little more is added than the exact (1 − π/4) r² L
    expect(round.change - (1 - Math.PI / 4) * 16 * 60).toBeGreaterThan(0);
    expect(round.change - (1 - Math.PI / 4) * 16 * 60).toBeLessThan(2);
  });
});

describe('the start of an extent at a plane: the design review of D66, round 1', () => {
  // A circle of radius 0.1 tapered to 1 over a distance of 1, from a plane tilted about X by an angle
  // near the tolerance: the spread of the level over the circle is 0.2 · tan(angle).
  const tapered = (spread: number): EngineState => {
    const engine = newEngine();
    return run(
      engine,
      addSketch('S', XY),
      batch({ type: 'addCurve', sketch: 'S', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 0.1 }, constrain('S', 'cr', { type: 'radius', curve: 'c', value: 0.1, driving: true })),
      { type: 'addFeature', feature: { id: 'slant', name: 'slant', suppressed: false, type: 'plane', base: XY, offset: 0, tilt: { axis: { kind: 'base', axis: 'X' }, angle: Math.atan(spread / 0.2) } } },
      { type: 'addFeature', feature: { id: 'T', name: 'T', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', from: { kind: 'plane', feature: 'slant' }, start: 0, distance: 1, taper: Math.atan(0.9) }, operation: 'new' } },
    );
  };

  it('a real tapered extrusion: refused at a spread of 1.04e-6 over the exact circle; at 0.98e-6 every vertex of the start ring as built lies within half the tolerance of the plane', () => {
    expect(tapered(1.04e-6).evaluation.features.T.error).toMatchObject({ code: 'invalidExtent', message: expect.stringMatching(/its level differs by 1.04e-6 mm/) });
    const state = tapered(0.98e-6);
    expect(state.evaluation.features.T.status).toBe('ok');
    const plane = state.evaluation.features.slant.plane as { origin: number[]; normal: number[] };
    const solid = state.evaluation.bodies.T.solid;
    const id = state.evaluation.faceNames.findIndex((name) => name.feature === 'T' && name.role === 'startCap');
    const ring = new Set<number>();
    for (let t = 0; t < solid.faceIds.length; t++) if (solid.faceIds[t] === id) for (let k = 0; k < 3; k++) ring.add(solid.triangles[3 * t + k]);
    expect(ring.size).toBeGreaterThan(8); // the taper resamples the circle
    for (const v of ring) {
      const [x, y, z] = [0, 1, 2].map((axis) => solid.positions[3 * v + axis]);
      // the level of the plane under (x, y), along the normal of the sketch (Z)
      const level = plane.origin[2] - (plane.normal[0] * (x - plane.origin[0]) + plane.normal[1] * (y - plane.origin[1])) / plane.normal[2];
      expect(Math.abs(z - level)).toBeLessThanOrEqual(0.5e-6 + 1e-9);
    }
  });
});

describe('the start of an extent at a plane: the design review of D66, round 2', () => {
  it('a hole whose mouth is 1000 above a target 10 thick: the guards of the kernel resolution see the mouth (round 2)', () => {
    const engine = newEngine();
    const plane = (id: string, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } });
    const state = run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 40, 30),
      batch({ type: 'addPoint', sketch: 'S', id: 'h', x: 20, y: 15 }, { type: 'addConstraint', sketch: 'S', id: 'hFix', constraint: { type: 'fixed', point: 'h', x: 20, y: 15 } }),
      addExtrude('A', 'S', [rectLoop('r')], -10),
      plane('High', 1000),
      { type: 'addFeature', feature: { id: 'H', name: 'H', suppressed: false, type: 'hole', sketch: 'S', points: ['h'], shape: { type: 'counterbore', diameter: 3.4, headDiameter: 6, headDepth: 1000 }, extent: { type: 'distance', from: { kind: 'plane', feature: 'High' }, start: 0, distance: -1000.01 }, targets: ['A'] } },
    );
    expect(state.evaluation.features.H.error).toMatchObject({ code: 'invalidHole', message: expect.stringMatching(/the bore below the head has to be longer than 0\.1 mm/) });
  });
});

describe('the design review of D67: chamfers and fillets that run out into round faces', () => {
  // The housing of the actuator: a plate 80 × 80 × 8, a bore R 29.5, 16 pockets r 2.5 on the circle
  // 29, `depth` deep; `pins`: pins r 0.1 standing on the floor of the pocket at (29, 0).
  const housing = (chordTolerance: number, depth = 4, pins: [number, number][] = []): EngineState => {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify({ ...engine.getState().document, settings: { ...engine.getState().document.settings, chordTolerance } }));
    if (!loaded.ok) throw new Error(loaded.error.message);
    run(engine, addSketch('s', XY), rectangle('s', 'r', -40, -40, 80, 80, null), addExtrude('E', 's', [rectLoop('r')], 8), addSketch('b', onFace('E', cap('E'))), circle('b', 'h', 0, 0, 29.5), addExtrude('H', 'b', [['h']], -10, 'cut', 'E'));
    run(engine, addSketch('p', onFace('E', cap('E'))), ...Array.from({ length: 16 }, (_, k) => circle('p', `k${k}`, 29 * Math.cos((k * Math.PI) / 8), 29 * Math.sin((k * Math.PI) / 8), 2.5)), addExtrude('P', 'p', Array.from({ length: 16 }, (_, k) => [`k${k}`]), -depth, 'cut', 'E'));
    if (pins.length) {
      run(engine, addSketch('q', XY), ...pins.map(([x, y], i) => circle('q', `n${i}`, x, y, 0.1)), {
        type: 'addFeature',
        feature: { id: 'N', name: 'N', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'q', regions: pins.map((_, i) => ({ outerLoop: [`n${i}`] })) }, extent: { type: 'distance', start: 8 - depth, distance: depth }, operation: 'add', targets: ['E'] },
      });
    }
    return engine.getState();
  };
  const RIM = edge(cap('E'), side('H', 'h'));
  const applied = (state: EngineState, command: Command) => {
    const engine = newEngine();
    engine.load(JSON.stringify(state.document));
    const result = engine.preview(command);
    if (!result.ok) throw new Error(result.error.message);
    const outcome = result.state.evaluation.features[(command as { feature: { id: string } }).feature.id];
    return { code: outcome.error?.code, message: outcome.error?.message ?? '', refs: outcome.error?.refs ?? [], state: result.state };
  };
  const namesPocket = (refs: unknown[]): boolean => refs.some((ref) => typeof ref === 'object' && ref !== null && (ref as FaceName).feature === 'P');

  it('round 2: a pin standing in a pocket within the run-out was cut silently; the void check refuses it', () => {
    // the rim meets the wall of the pocket at (29, 0) at the angle 4.79°; a pin 0.6° back into the
    // pocket at the radius 29.9, under the corner of a chamfer of 1
    const at = (4.2 * Math.PI) / 180;
    const pinned = applied(housing(0.01, 4, [[29.9 * Math.cos(at), 29.9 * Math.sin(at)]]), chamfer('c', 'E', [RIM], 1));
    expect(pinned.code, pinned.message).toBe('blendDoesNotFit');
    expect(pinned.message).toMatch(/would take .* mm³ beyond the end face in refs within its run-out/);
    expect(namesPocket(pinned.refs)).toBe(true);
  });

  it('round 3: a pocket 0.3 deep under a fillet of 0.5 slipped under a bound with an area term; refused at 0.01 and 0.05', () => {
    for (const tolerance of [0.01, 0.05]) {
      const shallow = applied(housing(tolerance, 0.3), fillet('c', 'E', [RIM], 0.5));
      expect(shallow.code, shallow.message).toBe('blendDoesNotFit');
      expect(namesPocket(shallow.refs)).toBe(true);
    }
  });

  it('round 2: the cap of a run-out is renamed into the blend, never into the end face: every pocket keeps its cylinder, every vertex of the cone lies on it', () => {
    const result = applied(housing(0.05), chamfer('c', 'E', [RIM], 0.5));
    expect(result.message).toBe('');
    const ev = result.state.evaluation;
    const body = ev.bodies.E;
    for (const face of body.faces) {
      const name = ev.faceNames[face.id];
      if (name.feature !== 'P' || name.role !== 'side') continue;
      const surface = ev.faceSurfaces[face.id];
      expect(surface.kind === 'cylinder' && Math.abs(surface.radius - 2.5) < 1e-9, JSON.stringify(surface)).toBe(true);
    }
    const coneFace = body.faces.find((face) => faceKey(ev.faceNames[face.id]) === 'c/chamfer/0');
    const cone = coneFace ? ev.faceSurfaces[coneFace.id] : undefined;
    expect(cone?.kind).toBe('cone');
    if (cone?.kind !== 'cone' || !coneFace) return;
    const p = body.solid.positions;
    let off = 0;
    for (let t = 0; t < body.solid.faceIds.length; t++) {
      if (body.solid.faceIds[t] !== coneFace.id) continue;
      for (let k = 0; k < 3; k++) {
        const i = body.solid.triangles[3 * t + k];
        const d = [p[3 * i] - cone.apex[0], p[3 * i + 1] - cone.apex[1], p[3 * i + 2] - cone.apex[2]];
        const a = Math.hypot(...cone.axis);
        const z = (d[0] * cone.axis[0] + d[1] * cone.axis[1] + d[2] * cone.axis[2]) / a;
        const rho = Math.sqrt(Math.max(0, d[0] ** 2 + d[1] ** 2 + d[2] ** 2 - z * z));
        off = Math.max(off, Math.abs(rho * Math.cos(cone.halfAngle) - z * Math.sin(cone.halfAngle)));
      }
    }
    // the allowance of D63: the lift and the chord tolerance (0.075 + 0.05)
    expect(off).toBeLessThanOrEqual(0.125 + 1e-3);
  });

  it('round 1: an end at a cone (a tapered hole), a kind not taken, is refused naming it in refs', () => {
    const engine = newEngine();
    box(engine);
    const tapered = run(engine, addSketch('t', onFace('E', cap('E'))), circle('t', 'h', 30, 0, 4), {
      type: 'addFeature',
      feature: { id: 'H', name: 'H', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 't', regions: [{ outerLoop: ['h'] }] }, extent: { type: 'distance', start: 0, distance: -25, taper: 0.1 }, operation: 'cut', targets: ['E'] },
    });
    const cone = applied(tapered, chamfer('c', 'E', [edge(cap('E'), side('E', 'ra'))], 1));
    expect(cone.code).toBe('unsupportedEdge');
    expect(cone.message).toMatch(/ends at a round face \(H\/side\/h, a cone\) that does not continue a face of the edge, which this feature cannot run out into yet/);
    expect(cone.refs.some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && faceKey(ref as FaceName) === 'H/side/h')).toBe(true);
  });
});

describe('the review of the implementation of 6a (D64): the curves of a result that are not own', () => {
  it('in the order of `external` in the document and of the kind; none for an entry that never had values; a lost entry keeps its frozen curve', () => {
    const engine = plate(60, 40, 5);
    const hole = { feature: 'holes', role: 'side', curve: 'q' } as const;
    const edgeRef = (b: FaceName, kind: 'line' | 'circle', a: FaceName = cap('E1')) => ({ type: 'edge' as const, body: 'E1', edge: { a, b }, kind });
    run(
      engine,
      batch(addSketch('H', onFace('E1', cap('E1'))), { type: 'addPoint', sketch: 'H', id: 'qc', x: 20, y: 15 }, { type: 'addCurve', sketch: 'H', id: 'q', curve: { type: 'circle', center: 'qc' }, radius: 4 }),
      addExtrude('holes', 'H', [['q']], -5, 'cut', 'E1'),
      addSketch('S2', onFace('E1', cap('E1'))),
      // the IDs not in sorted order: the result follows the document, the solver the sorted IDs
      { type: 'addExternal', sketch: 'S2', id: 'zz', ref: edgeRef(side('E1', 'rb'), 'line') },
      { type: 'addExternal', sketch: 'S2', id: 'rim', ref: edgeRef(hole, 'circle') },
      { type: 'addExternal', sketch: 'S2', id: 'aa', ref: edgeRef(side('E1', 'rc'), 'line') },
      // two opposite sides never share an edge: this entry never has values
      { type: 'addExternal', sketch: 'S2', id: 'never', ref: edgeRef(side('E1', 'rc'), 'line', side('E1', 'ra')) },
    );
    const result = () => engine.getState().evaluation.features.S2;
    const line = (id: string) => ({ shape: { type: 'line', a: `${id}/a`, b: `${id}/b` }, source: 'reference', regions: false });
    const rim = { shape: { type: 'circle', center: 'rim/center' }, source: 'reference', regions: false };
    expect(result().sketch!.curves).toEqual({ zz: line('zz'), rim, aa: line('aa') });
    expect(Object.keys(result().sketch!.curves)).toEqual(['zz', 'rim', 'aa']);
    expect(result().sketch!.radii.rim).toBeCloseTo(4, 6);
    expect(Object.keys(result().sketch!.points).filter((id) => id.startsWith('never'))).toEqual([]);
    expect(result().warnings.map((w) => [w.code, w.refs])).toEqual([['brokenProjection', ['never']]]);

    // the hole suppressed: its edge is gone, the projection keeps its last valid value and its curve
    const before = result().sketch!.points['rim/center'];
    run(engine, { type: 'setSuppressed', id: 'holes', suppressed: true });
    expect(Object.keys(result().sketch!.curves)).toEqual(['zz', 'rim', 'aa']);
    expect(result().sketch!.curves.rim).toEqual(rim);
    expect(result().sketch!.points['rim/center']).toEqual(before);
    expect(result().warnings.map((w) => [w.code, w.refs]).sort()).toEqual([['brokenProjection', ['never']], ['brokenProjection', ['rim']]]);
  });
});

describe('the review of the implementation of 4c (D67): the void check beyond the outside of a cylinder', () => {
  // B1: the region beyond the outside of a cylinder was a box about the cylinder's axis, of half side
  // the chip's diagonal + 2, less the cylinder's polygon; outside a cylinder of a radius larger than
  // about that the region was empty and a post in the run-out was cut with the status ok. The box
  // is about the chip now.
  const engineAt = (chordTolerance: number) => {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify({ ...engine.getState().document, settings: { ...engine.getState().document.settings, chordTolerance } }));
    if (!loaded.ok) throw new Error(loaded.error.message);
    return engine;
  };
  const polygon = (s: string, prefix: string, points: [number, number][]): Command =>
    batch(
      ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch: s, id: `${prefix}p${i}`, x, y })),
      ...points.map((_, i): Command => ({ type: 'addCurve', sketch: s, id: `${prefix}l${i}`, curve: { type: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % points.length}` } })),
    );
  const loop = (prefix: string, n = 4): string[] => Array.from({ length: n }, (_, i) => `${prefix}l${i}`);
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const tried = (state: EngineState, command: Command) => {
    const engine = newEngine();
    engine.load(JSON.stringify(state.document));
    const result = engine.preview(command);
    if (!result.ok) throw new Error(result.error.message);
    const outcome = result.state.evaluation.features[(command as { feature: { id: string } }).feature.id];
    return { status: outcome.status, code: outcome.error?.code, message: outcome.error?.message ?? '', refs: outcome.error?.refs ?? [], taken: state.evaluation.bodies.E.volume - result.state.evaluation.bodies.E.volume };
  };
  const names = (refs: unknown[], name: FaceName): boolean => refs.some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && faceKey(ref as FaceName) === faceKey(name));

  it('a slot across a shaft R 40 out through its side, a post 0.3 × 0.3 outside the shaft where a chamfer of 2 runs on: refused (it was cut by 0.077 mm³)', () => {
    const R = 40;
    const shaft = (post: boolean): EngineState => {
      const engine = engineAt(0.01);
      run(engine, addSketch('s', XY), circle('s', 'c', 0, 0, R), addExtrude('E', 's', [['c']], 20), addSketch('t', onFace('E', cap('E'))), polygon('t', 't', square(-R - 5, R - 6, R + 5, R - 3)), addExtrude('S', 't', [loop('t')], -3, 'cut', 'E'));
      if (!post) return engine.getState();
      const x0 = Math.sqrt((R + 0.05) ** 2 - (R - 2) ** 2);
      return run(engine, addSketch('q', XY), polygon('q', 'q', square(x0, R - 2, x0 + 0.3, R - 1.7)), addExtrude('Q', 'q', [loop('q')], 20, 'add', 'E'));
    };
    const wall = edge(cap('E'), side('S', 'tl2'));
    const plain = tried(shaft(false), chamfer('k', 'E', [wall], 2));
    expect(plain.status, plain.message).toBe('ok');
    const posted = tried(shaft(true), chamfer('k', 'E', [wall], 2));
    expect(posted.code, posted.message).toBe('blendDoesNotFit');
    expect(posted.message).toMatch(/would take .* mm³ beyond the end face in refs within its run-out/);
    expect(names(posted.refs, side('E', 'c'))).toBe(true);
  });

  it('a hole broken out through the side of a disc R 50 and R 100, a post joined to the disc by a bar where a chamfer of 1 of its rim runs on: refused (it was cut by 0.013 mm³)', () => {
    for (const R of [50, 100]) {
      const disc = (post: boolean): EngineState => {
        const engine = engineAt(0.01);
        run(engine, addSketch('s', XY), circle('s', 'd', 0, 0, R), addExtrude('E', 's', [['d']], 10), addSketch('h', onFace('E', cap('E'))), circle('h', 'c', R - 2, 0, 3), addExtrude('H', 'h', [['c']], -12, 'cut', 'E'));
        if (!post) return engine.getState();
        // the rim leaves the disc at the angle thetaE about the hole's centre; the post 2.5° past it,
        // 0.5 outside the hole, 0.16 wide, and a bar 1 high from it into the disc
        const x = (R * R - 9 + (R - 2) ** 2) / (2 * (R - 2));
        const thetaE = Math.atan2(Math.sqrt(R * R - x * x), x - (R - 2));
        const th = thetaE + (2.5 * Math.PI) / 180;
        const [cx, cy, h] = [R - 2 + 3.5 * Math.cos(th), 3.5 * Math.sin(th), 0.08];
        return run(engine, addSketch('q', XY), polygon('q', 'q', square(cx - h, cy - h, cx + h, cy + h)), addExtrude('Q', 'q', [loop('q')], 10, 'add', 'E'), addSketch('w', XY), polygon('w', 'w', square(cx - 1.2, cy - h, cx + h, cy + h)), addExtrude('W', 'w', [loop('w')], 1, 'add', 'E'));
      };
      const rim = edge(cap('E'), side('H', 'c'));
      const plain = tried(disc(false), chamfer('k', 'E', [rim], 1));
      expect(plain.status, plain.message).toBe('ok');
      const posted = tried(disc(true), chamfer('k', 'E', [rim], 1));
      expect(posted.code, posted.message).toBe('blendDoesNotFit');
      expect(posted.message).toMatch(/would take .* mm³ beyond the end face in refs within its run-out/);
      expect(names(posted.refs, side('E', 'd'))).toBe(true);
    }
  });
});

describe('the review of the implementation of 6c (D68): copies under the sketch tools', () => {
  const S = 'S';
  const pt = (id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: S, id, x, y });
  const ln = (id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch: S, id, curve: { type: 'line', a, b } });
  // fixed where the point is (FixedInput without x and y)
  const fix = (p: string): Command => ({ type: 'addConstraint', sketch: S, id: `fx_${p}`, constraint: { type: 'fixed', point: p } }) as Command;
  const pattern = (id: string, ref: object): Command => ({ type: 'addExternal', sketch: S, id, ref } as Command);
  const sketchOf6c = (state: EngineState): SketchFeature => state.document.features.find((f) => f.id === S) as SketchFeature;
  type Made = { ids: Record<string, string[]>; state: EngineState };
  const tool = (engine: ReturnType<typeof newEngine>, name: 'trim' | 'extend' | 'split' | 'fillet', input: object, prefix: string): Made | string => {
    const state = engine.getState();
    const made = sketchTool(name, { sketch: sketchOf6c(state), result: state.evaluation.features[S].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input as never, freshIds(state.document, prefix));
    return made.ok ? { ids: made.ids as Record<string, string[]>, state: run(engine, batch(...made.commands)) } : made.message;
  };
  const pulley = (center: string): Command => ({ type: 'addFeature', feature: { id: 'G', name: 'G', suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'gt2Pulley', sketch: S, operands: { center }, params: { teeth: 12 } }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } } as Command);

  // finding 1: the rule of old ends did not count a copy named by a feature, so the trim removed
  // its source and the feature broke unreported
  it('a trim keeps the end a feature names a copy of, and the copy stays an entity', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('b', 2, 5), pt('e', 8, 5), ln('X', 'b', 'e'), pt('v1', 5, 0), pt('v2', 5, 10), ln('V', 'v1', 'v2'), fix('e'), fix('v1'), fix('v2'));
    run(engine, pattern('m', { type: 'pattern', sources: ['X'], transform: { type: 'mirror', axis: 'origin/y' } }), pulley('m/1/b'));
    const made = tool(engine, 'trim', { at: [3, 5], curve: 'X' }, 't_');
    if (typeof made === 'string') throw new Error(made);
    expect(sketchOf6c(made.state).points.b).toBeDefined();
    expect((sketchOf6c(made.state).external.m as { sources: string[] }).sources).toEqual(['X', 'b']);
    expect(made.ids.entries).toEqual(['m']);
    expect(made.ids.broken).toEqual([]);
    expect(made.state.evaluation.features.G.status).toBe('ok');
  });

  it('a fillet keeps a copy of its corner that a feature names', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('a', 2, 0), pt('c', 10, 0), pt('d', 10, 8), ln('A', 'a', 'c'), ln('B', 'c', 'd'), fix('a'), fix('c'), fix('d'));
    run(engine, pattern('m', { type: 'pattern', sources: ['A', 'B'], transform: { type: 'mirror', axis: 'origin/y' } }), pulley('m/1/c'));
    const made = tool(engine, 'fillet', { corner: 'c', radius: 2 }, 'f_');
    if (typeof made === 'string') throw new Error(made);
    expect((sketchOf6c(made.state).external.m as { sources: string[] }).sources).toEqual(['A', 'B', 'f_c1', 'c']);
    expect(made.state.evaluation.features.G.status).toBe('ok');
  });

  // finding 6: a stale copy name (the entry no longer lists its source) is not read as the source
  it('readersOf reads a copy as its source only when the entry lists it', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('q1', 2, 0), pt('q2', 12, 0), pt('q3', 12, 10), pt('q4', 2, 10), ln('qa', 'q1', 'q2'), ln('qb', 'q2', 'q3'), ln('qc', 'q3', 'q4'), ln('qd', 'q4', 'q1'));
    run(engine, pattern('m', { type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd'], transform: { type: 'mirror', axis: 'origin/y' } }));
    run(engine, { type: 'addFeature', feature: { id: 'rev', name: 'rev', suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: S, regions: [{ outerLoop: ['qa', 'qb', 'qc', 'qd'] }] }, axis: { kind: 'sketchLine', sketch: S, line: 'm/1/qd' }, extent: { type: 'full' }, operation: 'new' } } as Command);
    const changes = { changed: [], restarted: [], rekinded: [], removed: ['qd'], removedPoints: [], added: [], span: [], pieces: { qd: [] }, stretches: [] };
    expect(readersOf(engine.getState().document, S, changes).broken).toEqual(['rev']);
    const stale = run(engine, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: ['qa', 'qb', 'qc'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
    expect(readersOf(stale.document, S, changes).broken).toEqual([]);
  });

  // finding 2: the edges of a chamfer on a copy the count does not make were left as they were
  it('the edges of a chamfer on a copy above the count are rewritten by names through the source', () => {
    const engine = newEngine();
    const square = [pt('q1', 0, 0), pt('q2', 10, 0), pt('q3', 10, 10), pt('q4', 0, 10), ln('qa', 'q1', 'q2'), ln('qb', 'q2', 'q3'), ln('qc', 'q3', 'q4'), ln('qd', 'q4', 'q1')];
    const plate = [pt('b1', -5, -5), pt('b2', 100, -5), pt('b3', 100, 20), pt('b4', -5, 20), ln('ba', 'b1', 'b2'), ln('bb', 'b2', 'b3'), ln('bc', 'b3', 'b4'), ln('bd', 'b4', 'b1')];
    run(engine, { type: 'setParameter', name: 'n', expr: '3' }, addSketch(S, XY), ...plate, ...square, ...['b1', 'b2', 'b3', 'b4', 'q1', 'q2', 'q3', 'q4'].map(fix));
    run(engine, pattern('r', { type: 'pattern', sources: ['qa', 'qb', 'qc', 'qd'], transform: { type: 'linear', direction: 'origin/x', count: 'n', span: { type: 'spacing', spacing: 20 } } }));
    run(engine, addExtrude('E', S, [['r/2/qa', 'r/2/qb', 'r/2/qc', 'r/2/qd']], 5));
    const sideOf = (curve: string): FaceName => side('E', curve);
    const edges = [canonicalEdge({ a: sideOf('r/2/qa'), b: sideOf('r/2/qb') }), canonicalEdge({ a: cap('E'), b: sideOf('r/2/qc') })];
    run(engine, { type: 'addFeature', feature: { id: 'K', name: 'K', suppressed: false, type: 'chamfer', body: 'E', edges, distance: 0.5 } } as Command);
    run(engine, { type: 'setParameter', name: 'n', expr: '2' }, pt('rb0', 5, -2), pt('rb1', 5, 12), ln('rib', 'rb0', 'rb1'), fix('rb0'), fix('rb1'));
    const made = tool(engine, 'split', {}, 'r_');
    if (typeof made === 'string') throw new Error(made);
    expect(made.ids.broken).toEqual([]);
    const pieces = made.ids.added;
    const chamfer = made.state.document.features.find((f) => f.id === 'K') as { edges: { a: FaceName; b: FaceName }[] };
    const names = chamfer.edges.map((e) => [e.a, e.b].map((face) => ('curve' in face ? face.curve : face.role)).sort());
    // qa is cut at x = 5: its piece at q2 meets qb; qc is cut too: both of its pieces bound the cap
    const endingAt = (p: string) => pieces.find((id) => (sketchOf6c(made.state).curves[id] as { b?: string } | undefined)?.b === p);
    const [atQ2, qcPiece] = [endingAt('q2'), endingAt('q4')];
    expect(names).toEqual([[`r/2/${atQ2}`, 'r/2/qb'].sort(), ['endCap', 'r/2/qc'], ['endCap', `r/2/${qcPiece}`].sort()]);
    const three = run(engine, { type: 'setParameter', name: 'n', expr: '3' });
    expect(three.evaluation.features.E.status).toBe('ok');
    expect(three.evaluation.features.K.status).toBe('ok');
  });

  // round 2, finding 1: a copy of `origin` named by a feature was not kept by the fourth rule (the
  // trim cut `origin` off the listed line, and the pulley broke unreported)
  it('a trim keeps a named copy of `origin` by listing `origin`', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('p1', 10, 0), ln('c1', 'origin', 'p1'), fix('p1'), pt('v1', 3, -5), pt('v2', 3, 5), ln('V', 'v1', 'v2'), fix('v1'), fix('v2'));
    run(engine, pattern('r', { type: 'pattern', sources: ['c1'], transform: { type: 'linear', direction: 'origin/y', count: 2, span: { type: 'spacing', spacing: 20 } } }), pulley('r/1/origin'));
    const made = tool(engine, 'trim', { at: [1, 0], curve: 'c1' }, 't_');
    if (typeof made === 'string') throw new Error(made);
    expect((sketchOf6c(made.state).external.r as { sources: string[] }).sources).toEqual(['c1', 'origin']);
    expect(made.ids.entries).toEqual(['r']);
    expect(made.ids.broken).toEqual([]);
    expect(made.state.evaluation.features.G.status).toBe('ok');
  });

  // round 2, finding 2: the fallback "an entry left with none keeps its last" ran before the fourth
  // rule, so the removed curve stayed listed beside the kept point, and the sketch warned
  it('a listed curve trimmed away whole leaves the list when the fourth rule keeps its named end', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('b', 2, 5), pt('e', 8, 5), ln('X', 'b', 'e'), fix('e'));
    run(engine, pattern('m', { type: 'pattern', sources: ['X'], transform: { type: 'mirror', axis: 'origin/y' } }), pulley('m/1/b'));
    const made = tool(engine, 'trim', { at: [5, 5], curve: 'X' }, 't_');
    if (typeof made === 'string') throw new Error(made);
    expect(made.ids.removed).toContain('X');
    expect((sketchOf6c(made.state).external.m as { sources: string[] }).sources).toEqual(['b']);
    expect(made.ids.entries).toEqual(['m']);
    expect(made.state.evaluation.features[S].warnings ?? []).toEqual([]);
    expect(made.state.evaluation.features.G.status).toBe('ok');
  });

  // round 2, finding 3: the point check of readersOf read a copy as its source and asked whether the
  // source was removed, which the rule of old ends never lets happen; a named copy that is no longer
  // an entity after the batch (a gap of the rules of the entries) was not reported
  it('readersOf reports a feature whose named copy of a point is no longer an entity', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('b', 2, 5), pt('e', 8, 5), ln('X', 'b', 'e'), pt('v1', 5, 0), pt('v2', 5, 10), ln('V', 'v1', 'v2'), fix('e'), fix('v1'), fix('v2'));
    run(engine, pattern('m', { type: 'pattern', sources: ['X'], transform: { type: 'mirror', axis: 'origin/y' } }), pulley('m/1/b'));
    const before = sketchOf6c(engine.getState());
    const none = { changed: [], restarted: [], rekinded: [], removed: [], removedPoints: [], added: [], span: [], pieces: {}, stretches: [] };
    expect(readersOf(engine.getState().document, S, none, before).broken).toEqual([]);
    // a batch whose entry lost the source of the named copy: `m/1/b` is gone, `b` is not removed
    const after = run(engine, { type: 'updateExternal', sketch: S, id: 'm', ref: { type: 'pattern', sources: ['V'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command);
    expect(after.evaluation.features.G.status).toBe('error');
    expect(readersOf(after.document, S, none, before).broken).toEqual(['G']);
  });

  // finding 3: an extension onto a copy said "meets nothing", or 6e's text for a projection
  it('an extension onto a copy is refused with the reason of the copy', () => {
    for (const beyond of [false, true]) {
      const engine = newEngine();
      run(engine, addSketch(S, XY), pt('p1', 10, 0), pt('p2', 10, 10), pt('p3', 0, 10), ln('c1', 'origin', 'p1'), ln('c2', 'p1', 'p2'), ln('c3', 'p2', 'p3'), fix('p1'), fix('p2'), fix('p3'));
      run(engine, pattern('m', { type: 'pattern', sources: ['c1', 'c2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } }));
      const region = (engine.getState().evaluation.features[S].sketch as { regions: { ref: { outerLoop: string[] } }[] }).regions[0].ref.outerLoop;
      run(engine, addExtrude('E', S, [region], 2), pt('l1', -3, 5), pt('l2', -6, 5), ln('L', 'l1', 'l2'), fix('l1'), fix('l2'));
      if (beyond) run(engine, pt('w1', -12, 0), pt('w2', -12, 10), ln('W', 'w1', 'w2'), fix('w1'), fix('w2'));
      const refused = tool(engine, 'extend', { curve: 'L', end: 'b' }, 'x_');
      expect(refused).toContain('"m/1/c2" is a copy of the mirror or pattern "m"; change its source "c2", and the copies follow');
      expect(refused).not.toContain('meets nothing');
      expect(refused).not.toContain('draw an own curve over it');
    }
  });

  // round 2, nit 2: of two copies on the way the refusal named the first in the order of the curves
  it('an extension refused at copies names the nearest of them', () => {
    const engine = newEngine();
    run(engine, addSketch(S, XY), pt('p1', 10, 0), pt('p2', 10, 10), pt('p3', 0, 10), ln('c1', 'origin', 'p1'), ln('c2', 'p1', 'p2'), ln('c3', 'p2', 'p3'), fix('p1'), fix('p2'), fix('p3'));
    run(engine, pattern('m', { type: 'pattern', sources: ['c1', 'c2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } }));
    const region = (engine.getState().evaluation.features[S].sketch as { regions: { ref: { outerLoop: string[] } }[] }).regions[0].ref.outerLoop;
    run(engine, addExtrude('E', S, [region], 2), pt('l1', -3, 5), pt('l2', -6, 5), ln('L', 'l1', 'l2'), fix('l1'), fix('l2'));
    run(engine, pt('z1', 8, 2), pt('z2', 8, 8), ln('Z', 'z1', 'z2'), fix('z1'), fix('z2'), pattern('a', { type: 'pattern', sources: ['Z'], transform: { type: 'mirror', axis: 'origin/y' } }));
    run(engine, pt('w1', -12, 0), pt('w2', -12, 10), ln('W', 'w1', 'w2'), fix('w1'), fix('w2'));
    const refused = tool(engine, 'extend', { curve: 'L', end: 'b' }, 'x_');
    expect(refused).toContain('would meet "a/1/Z" at [-8, 5]');
  });
});

describe('the design review of D69 (6b): planes parallel only within the tolerance', () => {
  const pt6 = (s: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
  const fix6 = (s: string, p: string, x: number, y: number): Command => constrain(s, `f${p}`, { type: 'fixed', point: p, x, y });
  const tiltedPlane = (id: string, axis: 'X' | 'Y', angle: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset: 5, tilt: { axis: { kind: 'base', axis }, angle } } }) as Command;
  const projectOf = (s: string, id: string, source: string, entity: string, kind: 'line' | 'arc'): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'sketch', sketch: source, entity, kind, regions: true } }) as Command;

  // the second round, finding 3: every point projected along the normal and the arc's end then put
  // on its circle opened a quarter disc of radius 300 at 9e-5 rad by 1.2e-6 mm, the sketch `ok` and
  // `valid` with no region; the rigid map keeps its joints, its lengths and its radii
  it('a closed chain of lines and an arc keeps its joints and its region at tilts of 5e-5 and 9e-5 rad about each axis', () => {
    for (const radius of [300, 1000]) {
      const engine = newEngine();
      const s = 'disc';
      run(engine, addSketch(s, XY), pt6(s, 'c', 0, 0), pt6(s, 'a', radius, 0), pt6(s, 'b', 0, radius), { type: 'addCurve', sketch: s, id: 'q', curve: { type: 'arc', center: 'c', start: 'a', end: 'b' } }, { type: 'addCurve', sketch: s, id: 'l1', curve: { type: 'line', a: 'b', b: 'c' } }, { type: 'addCurve', sketch: s, id: 'l2', curve: { type: 'line', a: 'c', b: 'a' } }, fix6(s, 'c', 0, 0), fix6(s, 'a', radius, 0), fix6(s, 'b', 0, radius));
      for (const axis of ['X', 'Y'] as const) {
        for (const angle of [5e-5, 9e-5]) {
          const t = `t${axis}${angle}`.replace(/[.-]/g, '_');
          const state = run(engine, tiltedPlane(`${t}Pl`, axis, angle), addSketch(t, { kind: 'plane', feature: `${t}Pl` }), projectOf(t, `${t}q`, s, 'q', 'arc'), projectOf(t, `${t}1`, s, 'l1', 'line'), projectOf(t, `${t}2`, s, 'l2', 'line'));
          const r = state.evaluation.features[t].sketch as SketchResult6;
          expect(r.regions.map((region) => region.ref.outerLoop), `${radius} ${axis} ${angle}`).toEqual([[`${t}1`, `${t}2`, `${t}q`]]);
          const p = (id: string): [number, number] => [r.points[id.replace(/^x/, t)].x, r.points[id.replace(/^x/, t)].y];
          const d = (a: string, b: string): number => Math.hypot(p(a)[0] - p(b)[0], p(a)[1] - p(b)[1]);
          expect(d('xq/start', 'xq/center')).toBeCloseTo(radius, 9);
          expect(d('xq/end', 'xq/center')).toBeCloseTo(radius, 9);
          expect(d('x2/a', 'x2/b')).toBeCloseTo(radius, 9);
          expect(d('xq/end', 'x1/a')).toBe(0);
        }
      }
      const beyond = run(engine, tiltedPlane('farPl', 'X', 1.5e-4), addSketch('far', { kind: 'plane', feature: 'farPl' }), projectOf('far', 'farq', s, 'q', 'arc'));
      expect(beyond.evaluation.features.far.warnings.map((w) => w.code)).toEqual(['unsupportedProjection']);
    }
  });

  // the light read of the fixes, a nit: a projected edge goes along the normal, a projection from
  // a sketch by the rigid map; 1 m from the origin at 9e-5 rad they are d · θ² / 2 apart, more than
  // the joins take, and openEnds says so (a known limit)
  it('a projected edge and a projection from a sketch of one corner, 1 m out at 9e-5 rad, stay apart and openEnds says how far', () => {
    const engine = newEngine();
    run(engine, addSketch('S1', XY), rectangle('S1', 'r', 1000, 0, 10, 10, null), addExtrude('E1', 'S1', [rectLoop('r')], 5));
    run(engine, tiltedPlane('tPl', 'Y', 9e-5), addSketch('T', { kind: 'plane', feature: 'tPl' }));
    run(engine, { type: 'addExternal', sketch: 'T', id: 'e', ref: { type: 'edge', body: 'E1', edge: { a: cap('E1', 'startCap'), b: side('E1', 'ra') }, kind: 'line' } } as Command);
    run(engine, ...['rb', 'rc', 'rd'].map((l) => projectOf('T', `x${l}`, 'S1', l, 'line')));
    const [a, b] = ['e/a', 'e/b'].map((id) => (engine.getState().evaluation.features.T.sketch as SketchResult6).points[id]);
    const state = run(engine, pt6('T', 'n1', a.x, a.y), pt6('T', 'n2', b.x, b.y), { type: 'addCurve', sketch: 'T', id: 'n', curve: { type: 'line', a: 'n1', b: 'n2' } }, constrain('T', 'k1', { type: 'coincident', a: 'n1', b: 'e/a' }), constrain('T', 'k2', { type: 'coincident', a: 'n2', b: 'e/b' }));
    const r = state.evaluation.features.T.sketch as SketchResult6;
    expect(r.regions).toEqual([]);
    const apart = r.openEnds?.ends.filter((end) => end.reason === 'apart') ?? [];
    expect(apart.length).toBeGreaterThan(0);
    for (const end of apart) {
      expect(end.distance).toBeGreaterThan(1e-6);
      expect(end.distance).toBeLessThan((1010 * 9e-5 * 9e-5) / 2 + 1e-7);
    }
  });
});

describe('the design review of D69 (6b): the own outline of projectSketch', () => {
  const pt6 = (s: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
  const plane6 = (id: string, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } }) as Command;
  const result6 = (engine: ReturnType<typeof newEngine>, s: string): SketchResult6 => engine.getState().evaluation.features[s].sketch as unknown as SketchResult6;
  const project6 = (engine: ReturnType<typeof newEngine>, target: string, input: object, prefix: string): { commands: number; ids: Record<string, string[]> } | string => {
    const state = engine.getState();
    const made = sketchTool('projectSketch', { sketch: state.document.features.find((f) => f.id === target) as SketchFeature, result: state.evaluation.features[target].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input as never, freshIds(state.document, prefix));
    if (!made.ok) return made.message;
    run(engine, batch(...made.commands));
    return { commands: made.commands.length, ids: made.ids };
  };
  // a rounded rectangle 60 × 40 R 3 of fixed points, and `held` on a plane above it: the outline
  // projected without the flag and an own outline over it
  function rounded(engine: ReturnType<typeof newEngine>): string[] {
    const s = 'src';
    const commands: Command[] = [addSketch(s, XY)];
    const corners = [[27, 17], [-27, 17], [-27, -17], [27, -17]];
    corners.forEach(([cx, cy], i) => {
      const t = (i * Math.PI) / 2;
      const [sx, sy] = [cx + 3 * Math.round(Math.cos(t)), cy + 3 * Math.round(Math.sin(t))];
      const [ex, ey] = [cx + 3 * Math.round(Math.cos(t + Math.PI / 2)), cy + 3 * Math.round(Math.sin(t + Math.PI / 2))];
      commands.push(pt6(s, `c${i}`, cx, cy), pt6(s, `s${i}`, sx, sy), pt6(s, `e${i}`, ex, ey), { type: 'addCurve', sketch: s, id: `a${i}`, curve: { type: 'arc', center: `c${i}`, start: `s${i}`, end: `e${i}` } });
      for (const [p, x, y] of [[`c${i}`, cx, cy], [`s${i}`, sx, sy], [`e${i}`, ex, ey]] as const) commands.push(constrain(s, `f${p}`, { type: 'fixed', point: p, x, y }));
    });
    for (let i = 0; i < 4; i++) commands.push({ type: 'addCurve', sketch: s, id: `l${i}`, curve: { type: 'line', a: `e${i}`, b: `s${(i + 1) % 4}` } });
    run(engine, ...commands);
    return ['a0', 'l0', 'a1', 'l1', 'a2', 'l2', 'a3', 'l3'];
  }

  // the second round, finding 1: an own curve over every projected curve of a sketch that holds an
  // own outline over its projections gave 72 commands, two outlines on each other, the sketch `ok`
  // and determined, `valid: false` and no region; one own curve per place gives one outline
  it('the whole of a sketch that holds an own outline over its projections, as own: one outline, and again from the result; run again it makes nothing', () => {
    const engine = newEngine();
    const outline = rounded(engine);
    run(engine, plane6('p1', 3), addSketch('held', { kind: 'plane', feature: 'p1' }));
    const first = project6(engine, 'held', { sketch: 'src', entities: outline, as: 'own' }, 'o');
    expect(typeof first === 'object' && first.commands).toBe(44);
    for (const [source, target, prefix] of [['held', 'copyO', 'g'], ['copyO', 'copyP', 'j']]) {
      run(engine, plane6(`${target}Pl`, 6), addSketch(target, { kind: 'plane', feature: `${target}Pl` }));
      const answer = project6(engine, target, { sketch: source, as: 'own' }, prefix);
      if (typeof answer === 'string') throw new Error(answer);
      expect(answer.commands).toBe(44);
      expect([answer.ids.entries.length, answer.ids.curves.length, answer.ids.doubled.length]).toEqual([8, 8, 8]);
      const held = engine.getState().document.features.find((f) => f.id === source) as SketchFeature;
      expect(answer.ids.sources.every((id) => id in held.curves)).toBe(true);
      expect([engine.diagnoseSketch(target).degreesOfFreedom, engine.diagnoseSketch(target).redundant]).toEqual([0, []]);
      expect(result6(engine, target).regions.map((region) => region.ref.outerLoop)).toEqual([[...answer.ids.curves].sort()]);
    }
    // run again: the doubles are decided before the skip, so nothing is drawn twice
    expect(project6(engine, 'copyO', { sketch: 'held', as: 'own' }, 'k')).toBe('nothing to project: of held 8 entities are projected already, 8 at a place another curve has');
    // an outline from another source at the places this sketch holds is not drawn twice
    expect(project6(engine, 'copyO', { sketch: 'src', entities: outline, as: 'own' }, 'l')).toBe('nothing to project: of src 0 entities are projected already, 8 at a place another curve has');
  });

  // the hold of an own arc on a projected one (owner, answer 29): by its ends and a construction line
  // from its centre to its start with the projected centre on it; `equalRadius` there has a second
  // solution that a change of the sweep from 170° to 204° reaches (8.3 mm off, the sketch `ok`), and
  // a double root at a half turn (1 freedom and 1 redundant constraint)
  it('an own arc stays on its projection while the sweep of the source goes from 170° through 204° and 119°, turns, a half turn and 216°', () => {
    const engine = newEngine();
    const s = 'arcSrc';
    for (const [name, expr] of [['acx', '23'], ['acy', '7'], ['ar', '10'], ['at', '15'], ['aw', '170']]) run(engine, { type: 'setParameter', name, expr });
    run(
      engine,
      addSketch(s, XY),
      pt6(s, 'c', 23, 7),
      pt6(s, 's', 32.66, 9.59),
      pt6(s, 'e', 13.04, 6.13),
      { type: 'addCurve', sketch: s, id: 'a', curve: { type: 'arc', center: 'c', start: 's', end: 'e' } },
      constrain(s, 'kc', { type: 'fixed', point: 'c', x: 'acx', y: 'acy' } as never),
      constrain(s, 'ks', { type: 'fixed', point: 's', x: 'acx + ar * cos(deg(at))', y: 'acy + ar * sin(deg(at))' } as never),
      constrain(s, 'ke', { type: 'fixed', point: 'e', x: 'acx + ar * cos(deg(at + aw))', y: 'acy + ar * sin(deg(at + aw))' } as never),
      plane6('arcPl', 5),
      addSketch('arcOwn', { kind: 'plane', feature: 'arcPl' }),
    );
    const answer = project6(engine, 'arcOwn', { sketch: s, as: 'own' }, 'h');
    if (typeof answer === 'string') throw new Error(answer);
    const [own, entry] = [answer.ids.curves[0], answer.ids.entries[0]];
    const held = (label: string): void => {
      const diagnosis = engine.diagnoseSketch('arcOwn');
      expect(engine.getState().evaluation.features.arcOwn.status, label).toBe('ok');
      expect([diagnosis.degreesOfFreedom, diagnosis.redundant], label).toEqual([0, []]);
      const r = result6(engine, 'arcOwn');
      const curve = (engine.getState().document.features.find((f) => f.id === 'arcOwn') as SketchFeature).curves[own] as { center: string; start: string; end: string };
      const off = Math.max(...([[curve.center, 'center'], [curve.start, 'start'], [curve.end, 'end']] as const).map(([p, name]) => Math.hypot(r.points[p].x - r.points[`${entry}/${name}`].x, r.points[p].y - r.points[`${entry}/${name}`].y)));
      expect(off, label).toBeLessThan(1e-7);
    };
    held('170');
    for (const [name, expr] of [['aw', '204'], ['aw', '119'], ['at', '75'], ['ar', '20'], ['acx', '60'], ['at', '195'], ['aw', '180'], ['at', '15'], ['aw', '216'], ['ar', '10']]) {
      run(engine, { type: 'setParameter', name, expr });
      held(`${name} ${expr}`);
    }
  });
});
describe('the review of the implementation of 6b (D69)', () => {
  type E = ReturnType<typeof newEngine>;
  const pt6 = (s: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
  const ln6 = (s: string, id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
  const fix6 = (s: string, p: string, x: number, y: number): Command => constrain(s, `f${p}`, { type: 'fixed', point: p, x, y });
  const plane6 = (id: string, offset: number, tilt?: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset, ...(tilt === undefined ? {} : { tilt: { axis: { kind: 'base', axis: 'X' }, angle: tilt } }) } }) as Command;
  const project6 = (s: string, id: string, source: string, entity: string, kind: 'line' | 'arc', regions: boolean): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'sketch', sketch: source, entity, kind, regions } }) as Command;
  const sketch6 = (engine: E, s: string): SketchFeature => engine.getState().document.features.find((f) => f.id === s) as SketchFeature;
  const result6 = (engine: E, s: string): SketchResult6 => engine.getState().evaluation.features[s].sketch as unknown as SketchResult6;
  const regions6 = (engine: E, s: string): string[][] => result6(engine, s).regions.map((region) => region.ref.outerLoop);
  const tool6 = (engine: E, target: string, name: 'projectSketch' | 'split', input: object, prefix: string): { commands: Command[]; ids: Record<string, string[]> } | string => {
    const state = engine.getState();
    const made = sketchTool(name, { sketch: sketch6(engine, target), result: state.evaluation.features[target].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input as never, freshIds(state.document, prefix));
    if (!made.ok) return made.message;
    run(engine, batch(...made.commands));
    return { commands: made.commands, ids: made.ids };
  };
  const contacts6 = (engine: E, s: string) => {
    const outcome = engine.query('sketchContacts', { sketch: s });
    if (!outcome.ok) throw new Error(outcome.error.message);
    return outcome.result as { contacts: { curves: string[]; kind: string; fix: string; why?: string }[]; reason?: string };
  };
  // a rounded rectangle 60 × 40 R 3 of fixed points in `src`
  function rounded(engine: E): void {
    const s = 'src';
    const commands: Command[] = [addSketch(s, XY)];
    [[27, 17], [-27, 17], [-27, -17], [27, -17]].forEach(([cx, cy], i) => {
      const t = (i * Math.PI) / 2;
      const [sx, sy] = [cx + 3 * Math.round(Math.cos(t)), cy + 3 * Math.round(Math.sin(t))];
      const [ex, ey] = [cx + 3 * Math.round(Math.cos(t + Math.PI / 2)), cy + 3 * Math.round(Math.sin(t + Math.PI / 2))];
      commands.push(pt6(s, `c${i}`, cx, cy), pt6(s, `s${i}`, sx, sy), pt6(s, `e${i}`, ex, ey), { type: 'addCurve', sketch: s, id: `a${i}`, curve: { type: 'arc', center: `c${i}`, start: `s${i}`, end: `e${i}` } });
      commands.push(fix6(s, `c${i}`, cx, cy), fix6(s, `s${i}`, sx, sy), fix6(s, `e${i}`, ex, ey));
    });
    for (let i = 0; i < 4; i++) commands.push(ln6(s, `l${i}`, `e${i}`, `s${(i + 1) % 4}`));
    run(engine, ...commands);
  }

  // finding 1 (P1): only the ends made by the current run were pooled, so the second run of an
  // outline as own made new own points at the ends of the first, two vertices: no region
  it('projectSketch as own in two runs meets the own outline of the first run: the region of one run, determined, no redundancy', () => {
    const engine = newEngine();
    rounded(engine);
    run(engine, plane6('p1', 3), addSketch('held', { kind: 'plane', feature: 'p1' }), addSketch('once', { kind: 'plane', feature: 'p1' }));
    const first = tool6(engine, 'held', 'projectSketch', { sketch: 'src', entities: ['a0', 'l0', 'a1', 'l1'], as: 'own' }, 'o');
    if (typeof first === 'string') throw new Error(first);
    expect(regions6(engine, 'held')).toEqual([]);
    const second = tool6(engine, 'held', 'projectSketch', { sketch: 'src', entities: ['a2', 'l2', 'a3', 'l3'], as: 'own' }, 'q');
    if (typeof second === 'string') throw new Error(second);
    // the two places where the runs meet reuse the first run's points: no new point, no constraint
    expect(second.ids.points.filter((p) => first.ids.points.includes(p))).toEqual([]);
    const ends = second.commands.flatMap((c) => (c.type === 'addCurve' && c.curve.type !== 'circle' && !('construction' in c.curve && c.curve.construction) ? (c.curve.type === 'line' ? [c.curve.a, c.curve.b] : c.curve.type === 'arc' ? [c.curve.start, c.curve.end] : []) : []));
    expect(ends.filter((p) => first.ids.points.includes(p)).length).toBe(2);
    expect(second.commands.filter((c) => c.type === 'addConstraint' && c.constraint.type === 'coincident').length).toBe(3);
    expect([result6(engine, 'held').valid, regions6(engine, 'held').length]).toEqual([true, 1]);
    expect([engine.diagnoseSketch('held').degreesOfFreedom, engine.diagnoseSketch('held').redundant]).toEqual([0, []]);
    const once = tool6(engine, 'once', 'projectSketch', { sketch: 'src', entities: ['a0', 'l0', 'a1', 'l1', 'a2', 'l2', 'a3', 'l3'], as: 'own' }, 'w');
    if (typeof once === 'string') throw new Error(once);
    expect(regions6(engine, 'once').length).toBe(1);
    expect(once.ids.points.length).toBe(first.ids.points.length + second.ids.points.length);
  });

  // finding 3 (P2): an own end that is a second own vertex at the end of a flagged projection was
  // `fix: 'none'` with the reason of a crossing, and the reason of the profile said no cut could
  // repair it; joining the own ends (split without a curve) does
  it('two own vertices at the end of a flagged projection: only the join of the own ends is listed, the reason is not the flagged one, and split repairs it', () => {
    const engine = newEngine();
    run(engine, addSketch('edgeSk', XY), pt6('edgeSk', 'a', 0, 60), pt6('edgeSk', 'b', 20, 60), ln6('edgeSk', 's1', 'a', 'b'), fix6('edgeSk', 'a', 0, 60), fix6('edgeSk', 'b', 20, 60));
    run(engine, addSketch('loopSk', XY), project6('loopSk', 'x', 'edgeSk', 's1', 'line', true));
    run(engine, pt6('loopSk', 'u1', 0, 60), pt6('loopSk', 'u2', 20, 60), pt6('loopSk', 'u3', 10, 72), ln6('loopSk', 'n1', 'u1', 'u3'), ln6('loopSk', 'n2', 'u3', 'u2'), fix6('loopSk', 'u1', 0, 60), fix6('loopSk', 'u2', 20, 60), fix6('loopSk', 'u3', 10, 72));
    run(engine, pt6('loopSk', 'u4', 0, 60), pt6('loopSk', 'u5', -5, 68), ln6('loopSk', 'n3', 'u4', 'u5'), fix6('loopSk', 'u4', 0, 60), fix6('loopSk', 'u5', -5, 68));
    expect(result6(engine, 'loopSk').valid).toBe(false);
    const found = contacts6(engine, 'loopSk');
    expect(found.contacts.map((c) => [c.curves, c.kind, c.fix])).toEqual([[['n1', 'n3'], 'ends', 'join']]);
    expect(found.reason ?? '').not.toContain('is a projection that forms regions');
    const split = tool6(engine, 'loopSk', 'split', {}, 's');
    if (typeof split === 'string') throw new Error(split);
    expect(split.commands.filter((c) => c.type === 'addConstraint').length).toBe(1);
    expect(regions6(engine, 'loopSk')).toEqual([['n1', 'n2', 'x']]);
  });

  // finding 2 (P8): the advice said to run projectSketch as own, which skipped the entity as
  // projected already; now the tool takes a flagged entry over (its flag off, an own curve on it),
  // and the advice names the call
  it('the advice of a flagged projection that is not cut can be followed: projectSketch as own takes the entry over, and the crossing is cut', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), ...([['p0', 0, 0], ['p1', 20, 0], ['p2', 20, 10], ['p3', 0, 10]] as const).flatMap(([p, x, y]) => [pt6('src', p, x, y), fix6('src', p, x, y)]));
    run(engine, ...[0, 1, 2, 3].map((i) => ln6('src', `l${i}`, `p${i}`, `p${(i + 1) % 4}`)));
    run(engine, plane6('dstPl', 3), addSketch('dst', { kind: 'plane', feature: 'dstPl' }), ...[0, 1, 2, 3].map((i) => project6('dst', `x${i}`, 'src', `l${i}`, 'line', true)));
    expect(regions6(engine, 'dst').length).toBe(1);
    run(engine, pt6('dst', 'q1', 5, -5), pt6('dst', 'q2', 5, 5), ln6('dst', 'cross', 'q1', 'q2'), fix6('dst', 'q1', 5, -5), fix6('dst', 'q2', 5, 5));
    const before = contacts6(engine, 'dst');
    expect(before.contacts.map((c) => [c.curves, c.fix, c.why])).toEqual([[['cross', 'x0'], 'none', 'x0 is a projection that forms regions and is not cut: draw an own curve over it with the sketch tool projectSketch { sketch: "src", entities: ["l0"], as: "own" }, which also switches its flag off, then cut that; or remove the curve that meets it']]);
    // the call the advice names
    const taken = tool6(engine, 'dst', 'projectSketch', { sketch: 'src', entities: ['l0'], as: 'own' }, 'o');
    if (typeof taken === 'string') throw new Error(taken);
    expect([taken.ids.entries, taken.ids.sources, taken.ids.taken, taken.ids.skipped, taken.ids.curves.length]).toEqual([['x0'], ['l0'], ['x0'], [], 1]);
    expect(taken.commands[0]).toEqual({ type: 'updateExternal', sketch: 'dst', id: 'x0', ref: { type: 'sketch', sketch: 'src', entity: 'l0', kind: 'line', regions: false } });
    expect((sketch6(engine, 'dst').external.x0 as { regions: boolean }).regions).toBe(false);
    expect([engine.getState().evaluation.features.dst.status, engine.diagnoseSketch('dst').redundant]).toEqual(['ok', []]);
    const own = taken.ids.curves[0];
    const after = contacts6(engine, 'dst');
    expect(after.contacts.map((c) => [c.curves, c.fix])).toEqual([[['cross', own], 'cut']]);
    const split = tool6(engine, 'dst', 'split', {}, 's');
    expect(typeof split).toBe('object');
    // run again as own, nothing is left to take over or draw
    expect(tool6(engine, 'dst', 'projectSketch', { sketch: 'src', entities: ['l0'], as: 'own' }, 'r')).toBe('nothing to project: of src 1 entity is projected already');
  });

  // gap D of the engine's report: a removed point a later sketch projects. The tools never remove it
  // (a projected point is a name, so the rule of old ends keeps it), so the case is the function's
  // alone, given the changes by hand
  it('readersOf lists a sketch that projects a removed point in broken', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), pt6('src', 'a', 0, 0), pt6('src', 'b', 10, 0), ln6('src', 'l', 'a', 'b'), pt6('src', 'p', 5, 5));
    run(engine, plane6('up', 3), addSketch('dst', { kind: 'plane', feature: 'up' }), { type: 'addExternal', sketch: 'dst', id: 'xp', ref: { type: 'sketch', sketch: 'src', entity: 'p', kind: 'point' } } as Command);
    const changes = { changed: [], restarted: [], rekinded: [], removed: [], removedPoints: ['p'], added: [], span: [], pieces: {}, stretches: [] };
    expect(readersOf(engine.getState().document, 'src', changes)).toEqual({ moved: [], shortened: [], broken: ['dst'] });
    expect(readersOf(engine.getState().document, 'src', { ...changes, removedPoints: ['a'] }).broken).toEqual([]);
  });

  // nit 5: the angle of a tilt just above the tolerance read "0.0°"
  it('a tilt just above the tolerance is said with three significant digits', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), pt6('src', 'a', 0, 0), pt6('src', 'b', 10, 0), ln6('src', 'l', 'a', 'b'), fix6('src', 'a', 0, 0), fix6('src', 'b', 10, 0));
    run(engine, plane6('tPl', 3, 1.5e-4), addSketch('t', { kind: 'plane', feature: 'tPl' }));
    expect(tool6(engine, 't', 'projectSketch', { sketch: 'src' }, 'o')).toBe('the plane of src is at 0.00859° to this sketch; only a sketch on a parallel plane is projected');
    run(engine, project6('t', 'x', 'src', 'l', 'line', false));
    expect(engine.getState().evaluation.features.t.warnings[0].message).toContain('the plane of src is at 0.00859° to this sketch');
  });

  // nit 6: a stored arc was read without the checks compute makes; one whose end is off its circle
  // loaded as a fixed arc the solver may reject, one with no extent loaded at all
  it('a stored arc read back is made exact, and one with no extent is refused on load', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), pt6('src', 'c', 0, 0), pt6('src', 's', 10, 0), pt6('src', 'e', 0, 10), { type: 'addCurve', sketch: 'src', id: 'q', curve: { type: 'arc', center: 'c', start: 's', end: 'e' } }, fix6('src', 'c', 0, 0), fix6('src', 's', 10, 0), fix6('src', 'e', 0, 10));
    run(engine, plane6('up', 3), addSketch('dst', { kind: 'plane', feature: 'up' }), project6('dst', 'x', 'src', 'q', 'arc', false));
    run(engine, pt6('dst', 'k', 7, 7), constrain('dst', 'on', { type: 'pointOnCurve', point: 'k', curve: 'x' }));
    // the source gone: the projection is frozen at its stored value, which a hand moved off the circle
    const saved = JSON.parse(engine.save());
    const doc = saved.document ?? saved;
    doc.features = doc.features.filter((f: { id: string }) => f.id !== 'src');
    const dst = doc.features.find((f: { id: string }) => f.id === 'dst');
    dst.solved.external.x.end = [0, 10 + 1e-6];
    const other = newEngine();
    const loaded = other.load(JSON.stringify(saved));
    if (!loaded.ok) throw new Error(loaded.error.message);
    const r = loaded.state.evaluation.features.dst.sketch as unknown as SketchResult6;
    expect(Math.hypot(r.points['x/end'].x, r.points['x/end'].y)).toBeCloseTo(10, 12);
    expect(loaded.state.evaluation.features.dst.warnings.map((w) => w.code)).toEqual(['brokenProjection']);
    dst.solved.external.x.end = [0, 0];
    const refused = newEngine().load(JSON.stringify(saved));
    expect(refused.ok).toBe(false);
  });
});
describe('the second review of the implementation of 6b (D69)', () => {
  type E = ReturnType<typeof newEngine>;
  const pt7 = (s: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
  const ln7 = (s: string, id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
  const fix7 = (s: string, p: string, x: number, y: number): Command => constrain(s, `f${p}`, { type: 'fixed', point: p, x, y });
  const plane7 = (id: string, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } }) as Command;
  const project7 = (s: string, id: string, source: string, entity: string, kind: 'line' | 'arc' | 'circle', regions: boolean): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'sketch', sketch: source, entity, kind, regions } }) as Command;
  const sketch7 = (engine: E, s: string): SketchFeature => engine.getState().document.features.find((f) => f.id === s) as SketchFeature;
  const regions7 = (engine: E, s: string): string[][] => (engine.getState().evaluation.features[s].sketch as unknown as SketchResult6).regions.map((region) => region.ref.outerLoop);
  const volume7 = (engine: E, body: string): number => volume(engine.getState().evaluation.bodies[body].solid);
  const tool7 = (engine: E, target: string, input: object, prefix: string): { commands: Command[]; ids: Record<string, string[]> } | string => {
    const state = engine.getState();
    const made = sketchTool('projectSketch', { sketch: sketch7(engine, target), result: state.evaluation.features[target].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input as never, freshIds(state.document, prefix));
    if (!made.ok) return made.message;
    run(engine, batch(...made.commands));
    return { commands: made.commands, ids: made.ids };
  };
  // a fixed 20 × 10 rectangle `l0`–`l3` in `src`, projected with the flag into `dst` as `x0`–`x3`
  // on a plane 3 above, and an extrusion `ex` of its region
  function flagged(engine: E): void {
    run(engine, addSketch('src', XY), ...([['p0', 0, 0], ['p1', 20, 0], ['p2', 20, 10], ['p3', 0, 10]] as const).flatMap(([p, x, y]) => [pt7('src', p, x, y), fix7('src', p, x, y)]));
    run(engine, ...[0, 1, 2, 3].map((i) => ln7('src', `l${i}`, `p${i}`, `p${(i + 1) % 4}`)));
    run(engine, plane7('dstPl', 3), addSketch('dst', { kind: 'plane', feature: 'dstPl' }), ...[0, 1, 2, 3].map((i) => project7('dst', `x${i}`, 'src', `l${i}`, 'line', true)));
    run(engine, addExtrude('ex', 'dst', [['x0', 'x1', 'x2', 'x3']], 5));
  }

  // S1 (T1): a takeover renamed the region along the entry and its side face to the own curve, and
  // the features that read them ended in noProfile or with a face that is gone, in silence
  it('a takeover renames the region and the side face in what reads them in the same batch: the extrusion, a chamfer of its edge, a sketch on the face and a projected edge stay ok', () => {
    const engine = newEngine();
    flagged(engine);
    run(engine, { type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'ex', edges: [{ a: cap('ex'), b: side('ex', 'x0') }], distance: 1 } } as Command);
    run(engine, addSketch('onSide', onFace('ex', side('ex', 'x0'))));
    run(engine, addSketch('proj', XY), { type: 'addExternal', sketch: 'proj', id: 'e', ref: { type: 'edge', body: 'ex', edge: { a: side('ex', 'x0'), b: cap('ex', 'startCap') }, kind: 'line' } } as Command);
    expectAllOk(engine.getState());
    const before = volume7(engine, 'ex');
    // a run over the whole sketch takes nothing over: every entity is projected already
    expect(tool7(engine, 'dst', { sketch: 'src', as: 'own' }, 'w')).toBe('nothing to project: of src 4 entities are projected already');
    const taken = tool7(engine, 'dst', { sketch: 'src', entities: ['l0'], as: 'own' }, 'o');
    if (typeof taken === 'string') throw new Error(taken);
    const own = taken.ids.curves[0];
    expect([taken.ids.taken, taken.ids.patched]).toEqual([['x0'], ['ex', 'ch', 'onSide', 'proj']]);
    expectAllOk(engine.getState());
    expect(regions7(engine, 'dst')).toEqual([[own, 'x1', 'x2', 'x3']]);
    const features = engine.getState().document.features;
    const of = <T>(id: string): T => features.find((f) => f.id === id) as T;
    expect(of<{ profile: { regions: { outerLoop: string[] }[] } }>('ex').profile.regions).toEqual([{ outerLoop: [own, 'x1', 'x2', 'x3'] }]);
    expect(of<{ edges: unknown[] }>('ch').edges).toEqual([{ a: cap('ex'), b: side('ex', own) }]);
    expect(of<SketchFeature>('onSide').plane).toEqual(onFace('ex', side('ex', own)));
    expect((of<SketchFeature>('proj').external.e as { edge: unknown }).edge).toEqual({ a: side('ex', own), b: cap('ex', 'startCap') });
    expect(volume7(engine, 'ex')).toBeCloseTo(before, 9);
    expect([engine.diagnoseSketch('dst').degreesOfFreedom, engine.diagnoseSketch('dst').redundant]).toEqual([0, []]);
    // one undo restores the flag and every reader
    engine.undo();
    expect([(sketch7(engine, 'dst').external.x0 as { regions: boolean }).regions, (engine.getState().document.features.find((f) => f.id === 'ch') as { edges: unknown[] }).edges]).toEqual([true, [{ a: cap('ex'), b: side('ex', 'x0') }]]);
  });

  // S1 (T2): the rounded rectangle with a hole, its arc, the circle and a line taken over
  it('a takeover of an arc, a circle and a line of a rounded rectangle with a hole keeps the extrusion of its region ok and its volume', () => {
    const engine = newEngine();
    const s = 'src';
    const commands: Command[] = [addSketch(s, XY)];
    [[27, 17], [-27, 17], [-27, -17], [27, -17]].forEach(([cx, cy], i) => {
      const t = (i * Math.PI) / 2;
      const [sx, sy] = [cx + 3 * Math.round(Math.cos(t)), cy + 3 * Math.round(Math.sin(t))];
      const [ex, ey] = [cx + 3 * Math.round(Math.cos(t + Math.PI / 2)), cy + 3 * Math.round(Math.sin(t + Math.PI / 2))];
      commands.push(pt7(s, `c${i}`, cx, cy), pt7(s, `s${i}`, sx, sy), pt7(s, `e${i}`, ex, ey), { type: 'addCurve', sketch: s, id: `a${i}`, curve: { type: 'arc', center: `c${i}`, start: `s${i}`, end: `e${i}` } });
      commands.push(fix7(s, `c${i}`, cx, cy), fix7(s, `s${i}`, sx, sy), fix7(s, `e${i}`, ex, ey));
    });
    for (let i = 0; i < 4; i++) commands.push(ln7(s, `l${i}`, `e${i}`, `s${(i + 1) % 4}`));
    commands.push(pt7(s, 'hc', 0, 0), { type: 'addCurve', sketch: s, id: 'h', curve: { type: 'circle', center: 'hc' }, radius: 5 }, fix7(s, 'hc', 0, 0));
    run(engine, ...commands, plane7('dstPl', 3), addSketch('dst', { kind: 'plane', feature: 'dstPl' }));
    const all = tool7(engine, 'dst', { sketch: 'src' }, 'x');
    if (typeof all === 'string') throw new Error(all);
    const outer = regions7(engine, 'dst').find((loop) => loop.length === 8) as string[];
    run(engine, addExtrude('ex', 'dst', [outer], 5));
    const before = volume7(engine, 'ex');
    const taken = tool7(engine, 'dst', { sketch: 'src', entities: ['a0', 'h', 'l1'], as: 'own' }, 'o');
    if (typeof taken === 'string') throw new Error(taken);
    expect([taken.ids.taken.length, taken.ids.patched]).toEqual([3, ['ex']]);
    expectAllOk(engine.getState());
    expect(volume7(engine, 'ex')).toBeCloseTo(before, 6);
    expect([engine.diagnoseSketch('dst').degreesOfFreedom, engine.diagnoseSketch('dst').redundant]).toEqual([0, []]);
  });

  // S1: what the takeover cannot rename is refused, naming the readers, rather than broken
  it('a takeover is refused when a projected edge would swap its faces under the new name or a feature names the face elsewhere', () => {
    const engine = newEngine();
    flagged(engine);
    // a projected vertical edge of x0 and x1; an own curve `zc1` sorts after x1, so its ends would swap
    run(engine, addSketch('proj', { kind: 'base', plane: 'XZ' }), { type: 'addExternal', sketch: 'proj', id: 'e', ref: { type: 'edge', body: 'ex', edge: { a: side('ex', 'x0'), b: side('ex', 'x1') }, kind: 'line' } } as Command);
    expectAllOk(engine.getState());
    expect(tool7(engine, 'dst', { sketch: 'src', entities: ['l0'], as: 'own' }, 'z')).toBe('x0 is not taken over: the own curve would rename its side face, which proj names where the takeover cannot rename it (for example an extent up to the face, an axis or a frame on it, a section entry, or a projected edge whose faces would swap); make it name another face first');
    // with `oc1`, which sorts before x1, the edge keeps its order and is patched
    const taken = tool7(engine, 'dst', { sketch: 'src', entities: ['l0'], as: 'own' }, 'o');
    if (typeof taken === 'string') throw new Error(taken);
    expect(taken.ids.patched).toEqual(['ex', 'proj']);
    expectAllOk(engine.getState());
    engine.undo();
    // an extrusion up to the side face: its extent is not patched
    run(engine, { type: 'removeFeature', id: 'proj' } as Command, addSketch('up', XY), rectangle('up', 'u', 5, -20, 4, 4), { type: 'addFeature', feature: { ...extrude('far', 'up', [rectLoop('u')], 1), extent: { type: 'upTo', plane: onFace('ex', side('ex', 'x0')), start: 0 } } } as Command);
    expect(tool7(engine, 'dst', { sketch: 'src', entities: ['l0'], as: 'own' }, 'o')).toMatch(/^x0 is not taken over: .* which far names /);
  });

  // M3 (T5): an own curve drawn by hand over a flagged entry left the advice of the crossing naming
  // a call that refused with nothing to say
  it('a takeover where an own curve lies over the entry already says how to switch its flag off', () => {
    const engine = newEngine();
    flagged(engine);
    run(engine, pt7('dst', 'h1', 0, 0), pt7('dst', 'h2', 20, 0), ln7('dst', 'own0', 'h1', 'h2'), constrain('dst', 'k1', { type: 'coincident', a: 'h1', b: 'x0/a' }), constrain('dst', 'k2', { type: 'coincident', a: 'h2', b: 'x0/b' }));
    expect(tool7(engine, 'dst', { sketch: 'src', entities: ['l0'], as: 'own' }, 'o')).toBe(
      'nothing to project: of src 0 entities are projected already, 1 at a place another curve has; x0 has the own curve own0 over it already: switch the flag of x0 off instead, updateExternal { sketch: "dst", id: "x0", ref: { type: "sketch", sketch: "src", entity: "l0", kind: "line", regions: false } }; the regions along it and its side face are then named by own0, so rename them in ex',
    );
    run(engine, { type: 'updateExternal', sketch: 'dst', id: 'x0', ref: { type: 'sketch', sketch: 'src', entity: 'l0', kind: 'line', regions: false } } as Command);
    expect(regions7(engine, 'dst')).toEqual([['own0', 'x1', 'x2', 'x3']]);
  });

  // M1 (U2): exactArc is not idempotent in floating point, so a frozen arc read back through it
  // flipped by an ulp at each recompute, and a document saved, loaded and saved changed
  it('a frozen arc keeps its stored value bit for bit over commands, and save, load, save gives the same text', () => {
    let seed = 777;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 6; trial++) {
      const engine = newEngine();
      const [cx, cy, r] = [rnd() * 40 - 20, rnd() * 40 - 20, rnd() * 20 + 1];
      const [t0, t1] = [rnd() * 3, 3 + rnd() * 3];
      const [sx, sy, ex, ey] = [cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)];
      run(engine, addSketch('src', XY), pt7('src', 'c', cx, cy), pt7('src', 's', sx, sy), pt7('src', 'e', ex, ey), { type: 'addCurve', sketch: 'src', id: 'q', curve: { type: 'arc', center: 'c', start: 's', end: 'e' } }, fix7('src', 'c', cx, cy), fix7('src', 's', sx, sy), fix7('src', 'e', ex, ey));
      run(engine, plane7('up', 3), addSketch('dst', { kind: 'plane', feature: 'up' }), project7('dst', 'x', 'src', 'q', 'arc', false));
      run(engine, pt7('dst', 'k', cx + r * Math.cos((t0 + t1) / 2) + 0.3, cy + r * Math.sin((t0 + t1) / 2)), constrain('dst', 'on', { type: 'pointOnCurve', point: 'k', curve: 'x' }));
      const stored = (): string => JSON.stringify((sketch7(engine, 'dst').solved.external as Record<string, unknown>).x);
      const first = stored();
      run(engine, { type: 'removeEntity', sketch: 'src', id: 'q' } as Command);
      expect(engine.getState().evaluation.features.dst.warnings.map((w) => w.code)).toEqual(['brokenProjection']);
      for (let i = 0; i < 4; i++) {
        run(engine, pt7('dst', `z${i}`, i, i));
        expect(stored()).toBe(first);
      }
      const saved = engine.save();
      const other = newEngine();
      const loaded = other.load(saved);
      if (!loaded.ok) throw new Error(loaded.error.message);
      expect(other.save()).toBe(saved);
    }
  });

  // M5: a stored circle with a radius under the length tolerance was read back as it was
  it('a stored circle with a radius under the length tolerance is refused on load', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), circle('src', 'h', 0, 0, 5));
    run(engine, plane7('up', 3), addSketch('dst', { kind: 'plane', feature: 'up' }), project7('dst', 'x', 'src', 'h', 'circle', false));
    const saved = JSON.parse(engine.save());
    const doc = saved.document ?? saved;
    doc.features = doc.features.filter((f: { id: string }) => f.id !== 'src');
    const dst = doc.features.find((f: { id: string }) => f.id === 'dst');
    dst.solved.external.x.radius = 1e-6;
    expect(newEngine().load(JSON.stringify(saved)).ok).toBe(true);
    dst.solved.external.x.radius = 1e-7;
    expect(newEngine().load(JSON.stringify(saved)).ok).toBe(false);
  });
});
describe('the third review of the implementation of 6b (D69)', () => {
  type E = ReturnType<typeof newEngine>;
  const pt8 = (s: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
  const fix8 = (s: string, p: string, x: number, y: number): Command => constrain(s, `f${p}`, { type: 'fixed', point: p, x, y });
  const sketch8 = (engine: E, s: string): SketchFeature => engine.getState().document.features.find((f) => f.id === s) as SketchFeature;
  const tool8 = (engine: E, target: string, input: object, prefix: string): { ids: Record<string, string[]> } | string => {
    const state = engine.getState();
    const made = sketchTool('projectSketch', { sketch: sketch8(engine, target), result: state.evaluation.features[target].sketch, parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features }, input as never, freshIds(state.document, prefix));
    if (!made.ok) return made.message;
    run(engine, batch(...made.commands));
    return { ids: made.ids };
  };

  // S1: a chamfer of an edge whose two faces swapped their order under the new name refused the
  // takeover, though a blend is symmetric in them; with the default prefix (entries x1…x4, own
  // curves c…) every entry but the first of a chamfered rectangle was refused
  it('with the default prefix each of the four entries of a rectangle with four chamfered vertical edges is taken over, the chamfer renamed and the volume kept', () => {
    for (const which of ['l0', 'l1', 'l2', 'l3']) {
      const engine = newEngine();
      run(engine, addSketch('src', XY), ...([['p0', 0, 0], ['p1', 20, 0], ['p2', 20, 10], ['p3', 0, 10]] as const).flatMap(([p, x, y]) => [pt8('src', p, x, y), fix8('src', p, x, y)]));
      run(engine, ...[0, 1, 2, 3].map((i): Command => ({ type: 'addCurve', sketch: 'src', id: `l${i}`, curve: { type: 'line', a: `p${i}`, b: `p${(i + 1) % 4}` } })));
      run(engine, { type: 'addFeature', feature: { id: 'dstPl', name: 'dstPl', suppressed: false, type: 'plane', base: XY, offset: 3 } } as Command, addSketch('dst', { kind: 'plane', feature: 'dstPl' }));
      const all = tool8(engine, 'dst', { sketch: 'src', as: 'regions' }, '');
      if (typeof all === 'string') throw new Error(all);
      const xs = all.ids.entries;
      const loop = (engine.getState().evaluation.features.dst.sketch as unknown as SketchResult6).regions[0].ref.outerLoop;
      run(engine, addExtrude('ex', 'dst', [loop], 5));
      run(engine, { type: 'addFeature', feature: { id: 'ch', name: 'ch', suppressed: false, type: 'chamfer', body: 'ex', edges: [0, 1, 2, 3].map((i) => ({ a: side('ex', xs[i]), b: side('ex', xs[(i + 1) % 4]) })), distance: 1 } } as Command);
      expectAllOk(engine.getState());
      const before = volume(engine.getState().evaluation.bodies.ex.solid);
      const taken = tool8(engine, 'dst', { sketch: 'src', entities: [which], as: 'own' }, '');
      if (typeof taken === 'string') throw new Error(`${which}: ${taken}`);
      expect(taken.ids.patched).toEqual(['ex', 'ch']);
      expectAllOk(engine.getState());
      const own = taken.ids.curves[0];
      const edges = (engine.getState().document.features.find((f) => f.id === 'ch') as { edges: { a: FaceName; b: FaceName }[] }).edges;
      expect(edges.filter((edge) => [edge.a, edge.b].some((f) => 'curve' in f && f.curve === own))).toHaveLength(2);
      expect(edges.every((edge) => canonicalEdge(edge) === edge)).toBe(true);
      expect(volume(engine.getState().evaluation.bodies.ex.solid)).toBeCloseTo(before, 9);
    }
  });

  // M1: the tolerance relative to the radius flipped a small arc far from the origin by an ulp,
  // since the error of making an arc exact scales with its coordinates
  it('a stored arc as compute writes it is read back bit for bit, a small one far from the origin too', () => {
    let seed = 4242;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ref = { type: 'sketch', sketch: 's', entity: 'q', kind: 'arc', regions: false } as const;
    let replaced = 0;
    for (const [far, radius] of [[20, 10], [2000, 0.1], [10000, 0.5], [1e6, 1]] as const) {
      for (let i = 0; i < 2000; i++) {
        const c: [number, number] = [(rnd() * 2 - 1) * far, (rnd() * 2 - 1) * far];
        const r = radius * (0.5 + rnd());
        const [t0, t1] = [rnd() * 6, rnd() * 6];
        const s: [number, number] = [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)];
        const e: [number, number] = [c[0] + r * Math.cos(t1) * (1 + 1e-9 * (rnd() - 0.5)), c[1] + r * Math.sin(t1)];
        // the end put on the circle of the start, as `compute` writes it
        const [rs, re] = [Math.hypot(s[0] - c[0], s[1] - c[1]), Math.hypot(e[0] - c[0], e[1] - c[1])];
        const stored = { kind: 'arc', center: c, start: s, end: [c[0] + (rs * (e[0] - c[0])) / re, c[1] + (rs * (e[1] - c[1])) / re] };
        const read = projection.value(JSON.parse(JSON.stringify(stored)), ref, 'x') as { end: [number, number] };
        if (read.end[0] !== stored.end[0] || read.end[1] !== stored.end[1]) replaced++;
      }
    }
    expect(replaced).toBe(0);
    // a hand-written end off the circle is still made exact, far from the origin too
    const off = projection.value({ kind: 'arc', center: [5000, -5000], start: [5000.5, -5000], end: [5000, -5000 + 0.5 + 1e-6] }, ref, 'x') as { end: [number, number] };
    expect(off.end[1]).toBeCloseTo(-5000 + 0.5, 9);
    expect(off.end[1]).not.toBe(-5000 + 0.5 + 1e-6);
  });
});
type SketchResult6 = { valid: boolean; points: Record<string, { x: number; y: number }>; regions: { ref: { outerLoop: string[] } }[]; openEnds?: { ends: { end: string; reason: string; distance: number }[] } };

// The review of the implementation of 6d (D70): the texts and the listing of 6e's tools beside a spline.
describe('the review of the implementation of 6d (D70)', () => {
  type E = ReturnType<typeof newEngine>;
  const point = (sketch: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
  const line = (sketch: string, id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });
  const spline = (sketch: string, id: string, points: string[]): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'spline', points } });
  const tool = (engine: E, name: 'extend' | 'split', sketch: string, input: object) => {
    const state = engine.getState();
    const context = { sketch: state.document.features.find((f) => f.id === sketch) as SketchFeature, result: state.evaluation.features[sketch].sketch as never, document: state.document, features: state.evaluation.features };
    return sketchTool(name, context, input as never, freshIds(state.document, 't_'));
  };

  // F2: the refusal gave the text of a flagged projection ("is not own … change its source")
  it('an extend whose stretch crosses an own spline is refused with a text of the spline; one that meets only a spline says so', () => {
    const engine = newEngine();
    run(engine, addSketch('S', XY));
    run(
      engine,
      point('S', 'p1', 0, 0),
      point('S', 'p2', 40, 0),
      point('S', 'm', 50, 10),
      point('S', 'p3', 40, 20),
      point('S', 'p4', 0, 20),
      line('S', 'l1', 'p1', 'p2'),
      spline('S', 'sp', ['p2', 'm', 'p3']),
      line('S', 'l3', 'p3', 'p4'),
      line('S', 'l4', 'p4', 'p1'),
      point('S', 'v1', 60, -10),
      point('S', 'v2', 60, 30),
      line('S', 'v', 'v1', 'v2'),
      point('S', 'y2', 30, 10),
      line('S', 'y', 'p1', 'y2'),
    );
    // a feature reads the regions, so the repair is on and an extension that would leave the profile invalid is refused
    run(engine, addExtrude('E', 'S', [['l1', 'l3', 'l4', 'sp']], 2));
    expect((engine.getState().evaluation.features.S.sketch as unknown as SketchResult6).valid).toBe(true);
    for (const input of [{ curve: 'y', end: 'b' }, { curve: 'y', end: 'b', with: 'v' }]) {
      const made = tool(engine, 'extend', 'S', input);
      expect(!made.ok && made.message).toMatch(/^the extension of "y" would meet the spline "sp" at \[43\.9\d+, 14\.6\d+\], which is not cut and holds no point: the profile would become invalid; move the control points of "sp", or extend "y" to a curve it meets before the spline$/);
    }
    // without the line beyond, the extension meets only the spline
    run(engine, { type: 'removeEntity', sketch: 'S', id: 'v' });
    const alone = tool(engine, 'extend', 'S', { curve: 'y', end: 'b' });
    expect(!alone.ok && alone.message).toMatch(/^the extension of "y" beyond "y2" meets no curve it can stop at, only the spline "sp" at \[43\.9\d+, 14\.6\d+\]: a spline is not cut and holds no point/);
  });

  // F3: the spline was decided before 6b's flagged projection, so its end and the projection's were
  // listed and split tied them by a coincident
  it('ends of an own spline and a flagged projection are not listed, as for an arc; split re-points the own line alone', () => {
    for (const kind of ['spline', 'arc'] as const) {
      const engine = newEngine();
      run(engine, addSketch('S', XY));
      run(engine, point('S', 'a', 0, 0), point('S', 'b', 40, 0), line('S', 'l1', 'a', 'b'));
      run(engine, addSketch('T', XY));
      run(engine, { type: 'addExternal', sketch: 'T', id: 'e1', ref: { type: 'sketch', sketch: 'S', entity: 'l1', kind: 'line', regions: true } });
      const curve: Command = kind === 'spline' ? spline('T', 'c', ['A', 'M', 'B']) : { type: 'addCurve', sketch: 'T', id: 'c', curve: { type: 'arc', center: 'M', start: 'A', end: 'B' } };
      run(engine, point('T', 'A', 40, 0), point('T', 'M', 20, kind === 'arc' ? -10 : 20), point('T', 'B', 0, 0), curve, point('T', 'C', 40, 0), point('T', 'D', 40, 10), line('T', 'k', 'C', 'D'));
      const answer = engine.query('sketchContacts', { sketch: 'T' });
      if (!answer.ok) throw new Error(answer.error.message);
      expect(answer.result.contacts.map((c) => [c.kind, c.fix, c.curves])).toEqual([['ends', 'join', ['c', 'k']]]);
      const made = tool(engine, 'split', 'T', {});
      if (!made.ok) throw new Error(made.message);
      expect(made.commands).toEqual([
        { type: 'setCurvePoint', sketch: 'T', id: 'k', point: 'a', to: 'A' },
        { type: 'removeEntity', sketch: 'T', id: 'C' },
      ]);
    }
  });
});

describe('the review of the implementation of 6f (D72)', () => {
  const result = (state: EngineState, id: string) => state.evaluation.features[id].sketch as NonNullable<EngineState['evaluation']['features'][string]['sketch']>;
  const point = (sketch: string, id: string, x: number, y: number): Command => ({ type: 'addPoint', sketch, id, x, y });
  const line = (sketch: string, id: string, a: string, b: string): Command => ({ type: 'addCurve', sketch, id, curve: { type: 'line', a, b } });

  // kind 1: an own arc held on the start of a fixed line that lies 8e-7 mm from the end of the fixed
  // line it is tangent to. The adapter takes the two fixed points as one end (D72); the analysis read
  // the general form, which has a double root there, and counted 2 freedoms (the base build said 1)
  it('kind 1: an own arc under 1 mm at a fixed join keeps the freedoms of the base build', () => {
    for (const [d, L, r] of [
      [8e-7, 0.1, 0.05],
      [8e-7, 1, 0.5],
      [0, 0.1, 0.05],
    ]) {
      const engine = newEngine();
      const curves = { l1: { type: 'line', a: [-L, 0], b: [0, 0] }, l2: { type: 'line', a: [0, d], b: [0, L] } } as Record<string, ImportedCurve>;
      run(engine, addSketch('s', XY), addOutline('s', 'o', { curves, regions: false }));
      const state = run(
        engine,
        batch(point('s', 'c', 0.01 * r, r * 1.1), point('s', 'a', 0, d), point('s', 'e', r, r), { type: 'addCurve', sketch: 's', id: 'A', curve: { type: 'arc', center: 'c', start: 'a', end: 'e' } }),
        constrain('s', 'k', { type: 'coincident', a: 'a', b: 'o/l2/a' }),
        constrain('s', 'R', { type: 'radius', curve: 'A', value: r, driving: true }),
        constrain('s', 't', { type: 'tangent', a: 'A', b: 'o/l1' }),
      );
      const solved = result(state, 's');
      expect({ d, L, r, dof: solved.degreesOfFreedom, redundant: solved.redundant }).toEqual({ d, L, r, dof: 1, redundant: [] });
    }
  });

  // kind 1, at the boundary of the fixed arc: the adapter took dy = 1e-6 · r (≤) and the analysis was
  // one ulp over its own bound, so it counted 2
  it('kind 1: an own line on a fixed line beside a fixed arc, at the boundary of the join, has 1 freedom', () => {
    const near = (r: number, dy: number, L: number): number => {
      const engine = newEngine();
      const curves = { a1: { type: 'arc', center: [0, r], start: [0, 0], end: [r, r] }, l1: { type: 'line', a: [-10, dy], b: [0, dy] } } as Record<string, ImportedCurve>;
      run(engine, addSketch('s', XY), addOutline('s', 'o', { curves, regions: false }));
      const state = run(engine, batch(point('s', 'p', 0, 0), point('s', 'q', L, 0.1 * L), line('s', 'n', 'p', 'q')), constrain('s', 'k', { type: 'coincident', a: 'p', b: 'o/l1/b' }), constrain('s', 't', { type: 'tangent', a: 'n', b: 'o/a1' }));
      return result(state, 's').degreesOfFreedom;
    };
    for (const [r, dy, L] of [
      [0.5, 4.9e-7, 0.1],
      [0.5, 4.99e-7, 0.1],
      [0.5, 5e-7, 0.1],
      [0.5, -5e-7, 0.1],
      [0.3, 2.99e-7, 0.1],
      [0.3, 3e-7, 0.1],
      [0.5, 5e-7, 1],
    ])
      expect({ r, dy, L, dof: near(r, dy, L) }).toEqual({ r, dy, L, dof: 1 });
  });

  // kind 2: an arc whose ends are within the length tolerance and not one place had no length to the
  // profile and took every region of the sketch away without a word
  it('kind 2: an arc whose ends are within the length tolerance is refused, a near whole turn and a sliver', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY));
    const refused = (curves: Record<string, ImportedCurve>): string => {
      const outcome = engine.execute(addOutline('s', 'o', { curves }));
      return outcome.ok ? 'ok' : outcome.error.message;
    };
    const turn = 1e-9;
    expect(refused({ a1: { type: 'arc', center: [0, 0], start: [1, 0], end: [Math.cos(-turn), Math.sin(-turn)] } })).toContain('a whole turn is a circle');
    expect(refused({ a1: { type: 'arc', center: [0, 0], start: [1, 0], end: [Math.cos(turn), Math.sin(turn)] } })).toContain('a whole turn is a circle');
    // the margin of the placement: 1.05e-6 apart is still refused, 1.2e-6 is an arc
    expect(refused({ a1: { type: 'arc', center: [0, 0], start: [1, 0], end: [Math.cos(1.05e-6), Math.sin(1.05e-6)] } })).toContain('a whole turn is a circle');
    expect(refused({ a1: { type: 'arc', center: [0, 0], start: [1, 0], end: [Math.cos(1.2e-6), Math.sin(1.2e-6)] } })).toBe('ok');
  });

  // kind 3: the reorder in contactFix moved a flagged projection ahead of the spline rule, so a
  // projection crossed by an own spline got advice that leads to another dead end
  it('kind 3: a flagged projection crossed by an own spline keeps the advice of the spline (6b, 6d)', () => {
    const engine = newEngine();
    run(engine, addSketch('src', XY), point('src', 'a', 0, 0), point('src', 'b', 10, 0), line('src', 'l', 'a', 'b'));
    run(engine, addSketch('s', XY), { type: 'addExternal', sketch: 's', id: 'p', ref: { type: 'sketch', sketch: 'src', entity: 'l', kind: 'line', regions: true } } as Command);
    run(engine, point('s', 'q0', 2, -3), point('s', 'q1', 4, 3), point('s', 'q2', 6, 3), point('s', 'q3', 8, -3), { type: 'addCurve', sketch: 's', id: 'sp', curve: { type: 'spline', points: ['q0', 'q1', 'q2', 'q3'] } } as Command);
    const answer = engine.query('sketchContacts', { sketch: 's' });
    if (!answer.ok || answer.result.status !== 'ok') throw new Error('no contacts');
    expect(answer.result.contacts.length).toBe(2);
    for (const contact of answer.result.contacts) expect(contact.why).toContain('"sp" is a spline, which is not cut and holds no point');
  });

  // M6: the constraints that hold an entity a revised file takes away or changes in kind, as the rule
  // of the update reads them: a control point of a spline with fewer points, an arc that is now a circle
  it('M6: updateHolds names a control point that goes and an entity whose kind changes', () => {
    const engine = newEngine();
    const before = {
      s1: { type: 'spline', points: [[0, 0], [1, 2], [3, 2], [4, 0], [5, -1], [6, 0]] },
      a3: { type: 'arc', center: [20, 0], start: [21, 0], end: [20, 1] },
      l1: { type: 'line', a: [30, 0], b: [40, 0] },
    } as Record<string, ImportedCurve>;
    run(engine, addSketch('s', XY), addOutline('s', 'b', { curves: before, regions: false }), point('s', 'p', 50, 50), point('s', 'q', 60, 60), point('s', 'r', 70, 70));
    run(engine, constrain('s', 'k1', { type: 'coincident', a: 'p', b: 'b/s1/5' }), constrain('s', 'k2', { type: 'coincident', a: 'q', b: 'b/a3/start' }), constrain('s', 'k3', { type: 'pointOnCurve', point: 'r', curve: 'b/a3' }));
    const sketch = engine.getState().document.features.find((f) => f.id === 's') as SketchFeature;
    const after = { ...before, s1: { type: 'spline', points: [[0, 0], [1, 2], [3, 2], [4, 0]] }, a3: { type: 'circle', center: [20, 0], radius: 1 } } as Record<string, ImportedCurve>;
    const holds = updateHolds(sketch, 'b', sketch.external.b, { ...(sketch.external.b as SketchOutline), curves: after });
    // `a3/start` goes with the arc (a circle has no start), and `a3` itself becomes a circle
    expect(holds.gone).toEqual([
      { entity: 'b/s1/5', constraints: ['k1'] },
      { entity: 'b/a3/start', constraints: ['k2'] },
    ]);
    expect(holds.changed).toEqual([{ entity: 'b/a3', was: 'arc', will: 'circle', constraints: ['k3'] }]);
    expect(holds.constraints).toEqual(['k1', 'k2', 'k3']);
    // the update without them is refused by the same rule; with them removed in one batch it passes
    expect(engine.execute({ type: 'updateExternal', sketch: 's', id: 'b', ref: { type: 'outline', curves: after } } as Command).ok).toBe(false);
    expect(engine.execute({ type: 'batch', commands: [...holds.constraints.map((id): Command => ({ type: 'removeConstraint', sketch: 's', id })), { type: 'updateExternal', sketch: 's', id: 'b', ref: { type: 'outline', curves: after } } as Command] }).ok).toBe(true);
  });

  // M5: the query entryCurves answers where its next page starts
  it('M5: entryCurves gives the from of the next page, and the total at the end', () => {
    const engine = newEngine();
    const curves = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i + 1}`, { type: 'circle', center: [10 * i, 0], radius: 1 }])) as Record<string, ImportedCurve>;
    run(engine, addSketch('s', XY), addOutline('s', 'b', { curves }));
    const page = (from: number) => {
      const answer = engine.query('entryCurves', { sketch: 's', entry: 'b', from, max: 3 });
      if (!answer.ok) throw new Error(answer.error.message);
      return answer.result;
    };
    expect([page(0).next, page(3).next, page(6).next, page(9).next]).toEqual([3, 6, 7, 7]);
    expect(page(6).curves.map((curve) => curve.id)).toEqual(['b/c7']);
  });
});
