// Nálezy z revize enginu ověřené proti skutečným adaptérům, a chybové kódy, které dosud neměly test.
import type { Command, SketchFeature } from '@trymesh/engine';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, batch, cap, circle, constrain, dimension, expectAllOk, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

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
    expect(failure(engine.export(JSON.parse('{"toString":null}') as never, {} as never))).toEqual(['invalidArguments', ['format'], 'there is no export format of that name (a text is expected); the formats are stl, 3mf, dxf, svg']);
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
