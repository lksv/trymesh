// Nálezy z revize enginu ověřené proti skutečným adaptérům, a chybové kódy, které dosud neměly test.
import type { Command, EngineState, FaceName, SketchFeature } from '@trymesh/engine';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { booleanOfBodies, sheetTriangles } from '../../engine/src/recompute/body-boolean';
import { isMoveProblem, movedOutwards } from '../../engine/src/recompute/moved-body';
import { volumeOf as volumeOf56 } from '../../engine/src/solid';
import { box as box56, cylinder as cylinder56, faceNumber as faceNumber56, infosOf as infosOf56, solidOf as solidOf56 } from './combine-kit';
import { faceKey } from '@trymesh/engine';
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
