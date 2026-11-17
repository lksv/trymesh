// The parts list (D57) against the real adapters: every case of the two tables of "Measured" in
// docs/d36/3e-parts-list/design.md (the rows of bodies and the count of holes, the cases of the
// three rounds of reviews of the design among them, the known limits marked as such), the file,
// and the finished box of validation scenario 12. The arm of scenario 13 is in scenario13.test.ts.
// The sizes of the holes of the small models are made up (a plain hole of 4, a counterbore of 4
// with a head of 7 by 3); they are no size of any piece.
import { type Command, DATA_CATALOGS, type Engine, type EngineState, type HoleFeature, type Id, type PartRow, type PartsList } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { cylinder } from './arm';
import { POST_TOP, box, brace, bracket, cavity, countersinkByHand, insertHoles, lid, lidsInARow, lipLeadIn, midPlanes, pads, parameters, posts, rib, ribDraft, ribMirror, screwHoles, sketchOn, vents } from './box';
import { addExtrude, addSketch, expectAllOk, newEngine, onFace, rectangle, rectLoop, run, status } from './kit';

const XY = { kind: 'base', plane: 'XY' } as const;
const fixedPoint = (sketch: Id, point: Id, x: number, y: number): Command[] => [
  { type: 'addPoint', sketch, id: point, x, y },
  { type: 'addConstraint', sketch, id: `${point}Fix`, constraint: { type: 'fixed', point, x, y } },
];
const points = (sketch: Id, ...at: [Id, number, number][]): Command => ({ type: 'batch', commands: at.flatMap(([id, x, y]) => fixedPoint(sketch, id, x, y)) });
const pattern = (id: Id, source: object, transform: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform } as never });
const bodyRow = (id: Id, body: Id, axis: 'X' | 'Y' | 'Z', count: number, spacing: number): Command => pattern(id, { type: 'body', body }, { type: 'linear', direction: { kind: 'base', axis }, count, span: { type: 'spacing', spacing } });
const features = (id: Id, list: Id[], transform: object): Command => pattern(id, { type: 'features', features: list }, transform);
const hole = (id: Id, sketch: Id, at: Id[], targets: Id[], shape: object, extent: object, label?: string): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', sketch, points: at, shape, extent, targets, ...(label ? { label } : {}) } as never });
const slab = (id: Id, sketch: Id, p: string, from: number, height: number, operation: 'new' | 'add' | 'cut' = 'new', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: rectLoop(p).sort() }] }, extent: { type: 'distance', start: from, distance: height }, operation, ...(targets ? { targets } : {}) },
});
const plane = (id: Id, offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } });
const preview = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.preview({ type: 'batch', commands });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const listOf = (engine: Engine, state?: EngineState): PartsList => {
  const outcome = engine.query('partsList', {}, state ? { state } : {});
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result;
};
const told = (r: PartRow): string => `${r.name} × ${r.count}: ${r.bodies.join(' ')}${r.copyOf ? ` (${r.differs ? 'differs from' : r.mirrored ? 'mirror image of' : 'copy of'} ${r.copyOf})` : ''}`;
const rows = (engine: Engine, state?: EngineState): string[] => {
  const list = listOf(engine, state);
  return [...list.printed, ...list.bought].map(told);
};
const hardware = (engine: Engine, state?: EngineState): string[] => listOf(engine, state).hardware.map((r) => `${r.label} × ${r.count}`);
const notOk = (state: EngineState): Record<Id, string> => Object.fromEntries(Object.entries(status(state)).filter(([, s]) => s !== 'ok'));
const PLAIN = { type: 'plain', diameter: 4 };
const HEADED = { type: 'counterbore', diameter: 4, headDiameter: 7, headDepth: 3 };

// ---------------------------------------------------------------- the rows

describe('the rows of bodies: one mesh, moved, with the same properties and name', () => {
  // a plate 60 × 40 × 5 and a sketch of points
  const plate = (): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), addExtrude('plate', 's', [rectLoop('r')], 5), addSketch('p', XY));
    return engine;
  };
  const blind = { type: 'distance', start: 5, distance: -6 };

  it('a row of three; a hole cut before the row; a cut that misses a copy (noEffect)', () => {
    let engine = plate();
    expect(rows(engine, run(engine, bodyRow('row', 'plate', 'X', 3, 100)))).toEqual(['plate × 3: plate row/1 row/2']);
    engine = plate();
    run(engine, points('p', ['a', 10, 10]), hole('h', 'p', ['a'], ['plate'], PLAIN, blind));
    expect(rows(engine, run(engine, bodyRow('row', 'plate', 'X', 3, 100)))).toEqual(['plate × 3: plate row/1 row/2']);
    engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 3, 100), points('p', ['far', 500, 500]));
    const missed = run(engine, hole('h', 'p', ['far'], ['row/1'], PLAIN, blind));
    expect(status(missed).h).toBe('warning:noEffect');
    expect(rows(engine, missed)).toEqual(['plate × 3: plate row/1 row/2']);
  });

  it('a feature after the pattern: into the source, into one copy, into each copy alike (the limit: three rows)', () => {
    let engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 3, 100), points('p', ['a', 10, 10], ['b', 110, 10], ['c', 210, 10]));
    expect(rows(engine, preview(engine, hole('h', 'p', ['a'], ['plate'], PLAIN, blind)))).toEqual(['plate × 1: plate', 'plate × 2: row/1 row/2 (differs from plate)']);
    expect(rows(engine, preview(engine, hole('h', 'p', ['b'], ['row/1'], PLAIN, blind)))).toEqual(['plate × 2: plate row/2', 'plate × 1: row/1 (differs from plate)']);
    expect(rows(engine, preview(engine, hole('h', 'p', ['a', 'b', 'c'], ['plate', 'row/1', 'row/2'], PLAIN, blind)))).toEqual(['plate × 1: plate', 'plate × 1: row/1 (differs from plate)', 'plate × 1: row/2 (differs from plate)']);
  });

  it('a mirror image is a row of its own; a hole into it makes it differ and it says no hand', () => {
    const engine = plate();
    run(engine, pattern('m', { type: 'body', body: 'plate' }, { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } }), points('p', ['pa', -10, 10]));
    expect(rows(engine)).toEqual(['plate × 1: plate', 'plate × 1: m/1 (mirror image of plate)']);
    expect(rows(engine, preview(engine, hole('h', 'p', ['pa'], ['m/1'], PLAIN, blind)))).toEqual(['plate × 1: plate', 'plate × 1: m/1 (differs from plate)']);
  });

  it('a copy named "special", then a row of three of it; the name removed again', () => {
    const engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 2, 100), { type: 'setBodyProperties', body: 'row/1', patch: { name: 'special' } });
    expect(rows(engine, run(engine, bodyRow('more', 'row/1', 'Y', 3, 100)))).toEqual(['plate × 1: plate', 'special × 3: row/1 more/1 more/2 (copy of plate)']);
    expect(rows(engine, preview(engine, { type: 'removeBodyProperties', body: 'row/1' }))).toEqual(['plate × 4: plate row/1 more/1 more/2']);
  });

  it('the reviewers\' cases a fingerprint took for one part: holes at other places of a copy, a left and a right pocket', () => {
    let engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 2, 100), points('p', ['a', 10, 10], ['b', 130, 25]));
    const elsewhere = run(engine, hole('h', 'p', ['a', 'b'], ['plate', 'row/1'], PLAIN, blind));
    expect(elsewhere.evaluation.bodies.plate.solid.triangles.length).toBe(elsewhere.evaluation.bodies['row/1'].solid.triangles.length);
    expect(rows(engine, elsewhere)).toEqual(['plate × 1: plate', 'plate × 1: row/1 (differs from plate)']);
    engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 2, 100), addSketch('q', XY), rectangle('q', 'a', 0, 0, 10, 10, null), rectangle('q', 'b', 150, 0, 10, 10, null));
    expect(rows(engine, run(engine, slab('pocketA', 'q', 'a', 3, 3, 'cut', ['plate']), slab('pocketB', 'q', 'b', 3, 3, 'cut', ['row/1'])))).toEqual(['plate × 1: plate', 'plate × 1: row/1 (differs from plate)']);
  });

  it('a block and a copy 5000 away, then 0.01 trimmed off the source: two rows', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 10, 10, 40, 30, null), addExtrude('block', 's', [rectLoop('r')], 20), bodyRow('row', 'block', 'X', 2, 5000), addSketch('t', XY), rectangle('t', 'q', 0, 0, 60, 50, null));
    const trimmed = run(engine, slab('trim', 't', 'q', 19.99, 5, 'cut', ['block']));
    expect(trimmed.evaluation.bodies.block.volume).toBeCloseTo(23988, 2);
    expect(rows(engine, trimmed)).toEqual(['block × 1: block', 'block × 1: row/1 (differs from block)']);
  });

  it('a pin copied 100 000 away and back is one row; copied 10⁸ away float32 loses it and the copies are rows of their own', () => {
    let engine = newEngine();
    run(engine, { type: 'batch', commands: cylinder('pin', 30, 0, 6, 0, 10) });
    const back = run(engine, bodyRow('away', 'pin', 'X', 2, 100000), bodyRow('back', 'away/1', 'X', 2, -99950));
    expect(rows(engine, back)).toEqual(['pin × 3: pin away/1 back/1']);
    engine = newEngine();
    run(engine, { type: 'batch', commands: cylinder('pin', 0, 0, 2, 0, 10) });
    const lost = run(engine, bodyRow('away', 'pin', 'X', 2, 1e8), bodyRow('back', 'away/1', 'X', 2, -1e8 + 50));
    expect(Object.values(lost.evaluation.bodies).map((body) => body.volume > 0)).toEqual([true, false, false]);
    expect(notOk(lost)).toEqual({});
    expect(rows(engine, lost)).toEqual(['pin × 1: pin', 'pin × 1: away/1 (differs from pin)', 'pin × 1: back/1 (differs from pin)']);
    // the mass of a row is never the source's times copies that have none
    const weighed = listOf(engine, preview(engine, { type: 'setBodyMaterial', body: 'pin', material: 'PLA' }));
    expect(weighed.printed.map((r) => r.totalMass === r.mass)).toEqual([true, true, true]);
  });

  it('what a body weighs by: two masses beside a density in error, one mass in error, one mass with two densities', () => {
    const engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 3, 100), { type: 'setParameter', name: 'rho', expr: '1.2' });
    const summary = (list: PartsList) => list.printed.map((r) => [r.bodies.join(' '), r.mass, r.totalMass, r.noMass, r.density]);
    let list = listOf(engine, preview(engine, { type: 'setBodyProperties', body: 'plate', patch: { mass: 10, density: 'rho' } }, { type: 'setBodyProperties', body: 'row/1', patch: { mass: 20, density: 'rho' } }, { type: 'setParameter', name: 'rho', expr: 'nope' }));
    expect(summary(list)).toEqual([
      ['plate row/2', 10, 20, undefined, undefined],
      ['row/1', 20, 20, undefined, undefined],
    ]);
    expect(list.totals.printed).toEqual({ count: 3, mass: 40, withoutMass: 0 });
    list = listOf(engine, preview(engine, { type: 'setBodyProperties', body: 'plate', patch: { mass: 10 } }, { type: 'setBodyProperties', body: 'row/1', patch: { mass: 'rho' } }, { type: 'setBodyProperties', body: 'row/2', patch: { mass: 10 } }, { type: 'setParameter', name: 'rho', expr: 'nope' }));
    expect(summary(list)).toEqual([
      ['plate row/2', 10, 20, undefined, undefined],
      ['row/1', undefined, undefined, 'inError', undefined],
    ]);
    expect(list.totals.printed).toEqual({ count: 3, mass: 20, withoutMass: 1 });
    list = listOf(engine, preview(engine, { type: 'setBodyProperties', body: 'plate', patch: { mass: 10, density: 1 } }, { type: 'setBodyProperties', body: 'row/1', patch: { mass: 10, density: 2 } }));
    expect(summary(list)).toEqual([
      ['plate row/2', 10, 20, undefined, 1],
      ['row/1', 10, 10, undefined, 2],
    ]);
  });

  it('a function of the document: the state after the pattern while a later feature changed a copy; after a load and after undo', () => {
    const engine = plate();
    run(engine, bodyRow('row', 'plate', 'X', 3, 100), points('p', ['a', 110, 10]), hole('h', 'p', ['a'], ['row/1'], PLAIN, blind));
    const now = ['plate × 2: plate row/2', 'plate × 1: row/1 (differs from plate)'];
    expect(rows(engine)).toEqual(now);
    const atPattern = engine.query('partsList', {}, { at: 'row' });
    expect(atPattern.ok && atPattern.result.printed.map(told)).toEqual(['plate × 3: plate row/1 row/2']);
    const loaded = newEngine();
    expect(loaded.load(engine.save()).ok).toBe(true);
    expect(rows(loaded)).toEqual(now);
    run(engine, { type: 'setBodyProperties', body: 'plate', patch: { color: '#000000' } });
    engine.undo();
    expect(rows(engine)).toEqual(now);
  });
});

// ---------------------------------------------------------------- the holes

describe('the holes: one piece per hole the model has, by its line and how far along it it reaches', () => {
  // two plates 60 × 40 × 5, one on the other, and a sketch of points
  const plates = (upper = 5): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), addExtrude('lower', 's', [rectLoop('r')], 5), slab('upper', 's', 'r', 5, upper), addSketch('p', XY), points('p', ['a', 10, 10], ['b', 50, 10], ['out', 200, 10]));
    return engine;
  };
  const through = (top = 10): Command => hole('screw', 'p', ['a', 'b'], ['upper', 'lower'], HEADED, { type: 'distance', start: top, distance: -(top + 0.5) }, 'screw');
  const more = (spacing: number): Command => features('more', ['screw'], { type: 'linear', direction: { kind: 'base', axis: 'Y' }, count: 2, span: { type: 'spacing', spacing } });

  it('a counterbore through two plates at two points, and the plates and the hole copied', () => {
    const engine = plates();
    expect(hardware(engine, run(engine, through()))).toEqual(['screw × 2']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 3, 70)))).toEqual(['screw × 6']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 3, 70), bodyRow('lowers', 'lower', 'X', 3, 70)))).toEqual(['screw × 6']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 3, 70), pattern('lowers', { type: 'body', body: 'lower' }, { type: 'mirror', plane: { kind: 'base', plane: 'XZ' } })))).toEqual(['screw × 8']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 2, 100), bodyRow('lowers', 'lower', 'X', 2, -100)))).toEqual(['screw × 6']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 3, 70), bodyRow('lowers', 'lower', 'Y', 3, 50)))).toEqual(['screw × 10']);
    expect(hardware(engine, preview(engine, more(20)))).toEqual(['screw × 4']);
    const offThePlates = preview(engine, more(200));
    expect(notOk(offThePlates)).toEqual({ more: 'warning:noEffect' });
    expect(hardware(engine, offThePlates)).toEqual(['screw × 2']);
    expect(hardware(engine, preview(engine, more(20), bodyRow('uppers', 'upper', 'X', 3, 70), bodyRow('lowers', 'lower', 'X', 3, 70)))).toEqual(['screw × 12']);
    expect(hardware(engine, preview(engine, bodyRow('uppers', 'upper', 'X', 2, 70), more(20)))).toEqual(['screw × 6']);
  });

  it('what is not there: a point outside the plates, a hole cut away later, a hole in an auxiliary body alone', () => {
    const engine = plates();
    run(engine, through());
    const outside = preview(engine, { type: 'updateFeature', id: 'screw', patch: { points: ['a', 'b', 'out'] } });
    expect(notOk(outside)).toEqual({});
    expect(hardware(engine, outside)).toEqual(['screw × 2']);
    const pocket = cylinder('pocket', 10, 10, 5, -1, 11, 'cut', 'upper');
    expect(hardware(engine, preview(engine, ...pocket.slice(0, -1), { type: 'addFeature', feature: { id: 'pocket', name: 'pocket', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'pocketSketch', regions: [{ outerLoop: ['pocketCircle'] }] }, extent: { type: 'distance', start: -1, distance: 12 }, operation: 'cut', targets: ['upper', 'lower'] } }))).toEqual(['screw × 1']);
    const ghost = preview(engine, ...cylinder('keep', 100, 10, 8, 0, 10), ...fixedPoint('p', 'c', 100, 10), hole('ghost', 'p', ['c'], ['keep'], PLAIN, { type: 'distance', start: 10, distance: -4 }, 'ghost'), { type: 'setBodyProperties', body: 'keep', patch: { use: 'auxiliary' } });
    expect(hardware(engine, ghost)).toEqual(['screw × 2']);
    expect(listOf(engine, ghost).unlabelled).toBeUndefined();
  });

  it('another feature with two targets, a point in each; a nut pocket from below; a countersink deeper than a thin upper plate', () => {
    const engine = plates();
    run(engine, through());
    expect(hardware(engine, preview(engine, ...cylinder('boss', 100, 10, 8, 0, 10), ...fixedPoint('p', 'c', 100, 10), hole('inserts', 'p', ['a', 'c'], ['upper', 'boss'], PLAIN, { type: 'distance', start: 10, distance: -4 }, 'insert')))).toEqual(['screw × 2', 'insert × 2']);
    expect(hardware(engine, preview(engine, hole('nut', 'p', ['a'], ['lower'], { type: 'nutPocket', diameter: 4, acrossFlats: 7, headDepth: 2.5, rotation: 0 }, { type: 'distance', start: 0, distance: 4 }, 'nut')))).toEqual(['screw × 2', 'nut × 1']);
    const deep = plates(1);
    expect(hardware(deep, run(deep, hole('screw', 'p', ['a'], ['upper', 'lower'], { type: 'countersink', diameter: 4, headDiameter: 9, angle: Math.PI / 2 }, { type: 'distance', start: 6, distance: -6.5 }, 'countersunk')))).toEqual(['countersunk × 1']);
  });

  // one plate 60 × 40 × 5 and a point
  const one = (): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), addExtrude('plate', 's', [rectLoop('r')], 5), addSketch('p', XY), points('p', ['a', 10, 10]));
    return engine;
  };

  it('a copy that continues the hole is the same hole: a stack, a plate mirrored in its top face; two blind holes on one axis are two', () => {
    let engine = one();
    run(engine, bodyRow('stack', 'plate', 'Z', 2, 5));
    expect(hardware(engine, run(engine, hole('screw', 'p', ['a'], ['plate', 'stack/1'], PLAIN, { type: 'distance', start: 10, distance: -10.5 }, 'screw')))).toEqual(['screw × 1']);
    engine = one();
    run(engine, hole('screw', 'p', ['a'], ['plate'], PLAIN, { type: 'distance', start: 5, distance: -5.5 }, 'screw'));
    expect(hardware(engine, preview(engine, bodyRow('stack', 'plate', 'Z', 3, 5)))).toEqual(['screw × 1']);
    expect(hardware(engine, preview(engine, pattern('half', { type: 'body', body: 'plate' }, { type: 'mirror', plane: onFace('plate', { feature: 'plate', role: 'endCap' }) })))).toEqual(['screw × 1']);
    engine = one();
    run(engine, bodyRow('stack', 'plate', 'Z', 3, 5));
    expect(hardware(engine, run(engine, hole('screw', 'p', ['a'], ['plate', 'stack/1', 'stack/2'], PLAIN, { type: 'distance', start: 15, distance: -15.5 }, 'screw')))).toEqual(['screw × 1']);
    // a blind hole, the plate mirrored in its bottom face: two blind holes on one axis
    engine = one();
    run(engine, hole('insert', 'p', ['a'], ['plate'], PLAIN, { type: 'distance', start: 5, distance: -3 }, 'insert'));
    expect(hardware(engine, preview(engine, pattern('half', { type: 'body', body: 'plate' }, { type: 'mirror', plane: XY })))).toEqual(['insert × 2']);
    // a blind hole 3 deep, the plate mirrored in its top face: one hole 6 long
    expect(hardware(engine, preview(engine, pattern('half', { type: 'body', body: 'plate' }, { type: 'mirror', plane: onFace('plate', { feature: 'plate', role: 'endCap' }) })))).toEqual(['insert × 1']);
    // the same two blind holes in one plate by a mirror of the hole feature
    engine = one();
    run(engine, slab('thick', 's', 'r', 0, 10), plane('mid', 5), hole('insert', 'p', ['a'], ['thick'], PLAIN, { type: 'distance', start: 10, distance: -3 }, 'insert'));
    expect(hardware(engine, run(engine, features('both', ['insert'], { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } })))).toEqual(['insert × 2']);
  });

  // a plate 60 × 40 × `thick` from `from`, a point at its centre and one 12 beside it
  const centred = (thick = 5, from = 0): Engine => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('plate', 's', 'r', from, thick), addSketch('p', XY), points('p', ['pc', 30, 20], ['p1', 42, 20]));
    return engine;
  };
  const about = (count: number, span: object = { type: 'full' }) => ({ type: 'circular', axis: { kind: 'sketchPoint', sketch: 'p', point: 'pc' }, count, span });
  const throughFive = { type: 'distance', start: 5, distance: -6 };

  it('a copy of a pattern of the feature that cuts its own hole again is the same hole', () => {
    let engine = centred();
    run(engine, hole('h', 'p', ['pc'], ['plate'], PLAIN, throughFive, 'screw'));
    const own = run(engine, features('fp', ['h'], about(3)));
    expect(notOk(own)).toEqual({});
    expect(hardware(engine, own)).toEqual(['screw × 1']);
    for (const shape of [PLAIN, HEADED]) {
      engine = centred();
      run(engine, hole('h', 'p', ['pc', 'p1'], ['plate'], shape, throughFive, 'screw'));
      expect([2, 3, 4, 5, 6].map((count) => hardware(engine, preview(engine, features('fp', ['h'], about(count))))[0])).toEqual(['screw × 3', 'screw × 4', 'screw × 5', 'screw × 6', 'screw × 7']);
    }
    engine = centred();
    run(engine, hole('nut', 'p', ['pc'], ['plate'], { type: 'nutPocket', diameter: 4, acrossFlats: 7, headDepth: 2.5, rotation: 0 }, { type: 'distance', start: 0, distance: 6 }, 'nut'));
    expect(hardware(engine, run(engine, features('fp', ['nut'], about(2, { type: 'angle', angle: Math.PI / 6 }))))).toEqual(['nut × 1']);
  });

  it('holes on one line that touch are one hole: a blind hole continued by a copy of the feature; with material between, two', () => {
    let engine = centred();
    run(engine, hole('h', 'p', ['pc'], ['plate'], PLAIN, { type: 'distance', start: 5, distance: -2 }, 'insert'));
    const down = (spacing: number): Command => features('fp', ['h'], { type: 'linear', direction: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'spacing', spacing } });
    expect(hardware(engine, preview(engine, down(-2)))).toEqual(['insert × 1']);
    expect(hardware(engine, preview(engine, down(-3)))).toEqual(['insert × 2']);
    // a slab from −5 to 5, a blind hole from the top, the feature mirrored in its sketch plane
    engine = centred(10, -5);
    run(engine, hole('h', 'p', ['pc'], ['plate'], PLAIN, { type: 'distance', start: 5, distance: -3 }, 'insert'));
    expect(hardware(engine, run(engine, features('fp', ['h'], { type: 'mirror', plane: XY })))).toEqual(['insert × 2']);
  });

  it('copies of a body on the line of the hole have holes of their own unless they touch', () => {
    let engine = centred();
    run(engine, hole('h', 'p', ['pc'], ['plate'], PLAIN, throughFive, 'insert'), plane('mid', -50));
    expect(hardware(engine, preview(engine, pattern('other', { type: 'body', body: 'plate' }, { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } })))).toEqual(['insert × 2']);
    expect(hardware(engine, preview(engine, bodyRow('walls', 'plate', 'Z', 3, 200)))).toEqual(['insert × 3']);
    expect(hardware(engine, preview(engine, bodyRow('walls', 'plate', 'Z', 3, 5.001)))).toEqual(['insert × 3']);
    expect(hardware(engine, preview(engine, bodyRow('walls', 'plate', 'Z', 3, 5)))).toEqual(['insert × 1']);
    // two flanges of one body, one hole through both: one bolt
    engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('flanges', 's', 'r', 0, 5), slab('top', 's', 'r', 25, 5, 'add', ['flanges']), addSketch('p', XY), points('p', ['pc', 30, 20]));
    expect(hardware(engine, run(engine, hole('bolt', 'p', ['pc'], ['flanges'], PLAIN, { type: 'distance', start: 30, distance: -31 }, 'bolt')))).toEqual(['bolt × 1']);
    // the limit: one flange with its hole, mirrored to make the second flange 20 above it
    engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('flange', 's', 'r', 0, 5), addSketch('p', XY), points('p', ['pc', 30, 20]), hole('bolt', 'p', ['pc'], ['flange'], PLAIN, { type: 'distance', start: 5, distance: -6 }, 'bolt'), plane('mid', 15));
    expect(hardware(engine, run(engine, pattern('other', { type: 'body', body: 'flange' }, { type: 'mirror', plane: { kind: 'plane', feature: 'mid' } })))).toEqual(['bolt × 2']);
  });

  it('a hole through two bodies with a gap: one hole; the pair copied counts two per copy (the limit)', () => {
    let engine = centred();
    run(engine, slab('upper', 's', 'r', 6, 5), hole('h', 'p', ['pc'], ['plate', 'upper'], PLAIN, { type: 'distance', start: 11, distance: -12 }, 'screw'));
    expect(hardware(engine)).toEqual(['screw × 1']);
    expect(hardware(engine, run(engine, bodyRow('plates', 'plate', 'X', 2, 100), bodyRow('uppers', 'upper', 'X', 2, 100)))).toEqual(['screw × 3']);
    // a clearance of 0.5 and a counterbore, both in rows of three
    engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('lower', 's', 'r', 0, 5), slab('upper', 's', 'r', 5.5, 5), addSketch('p', XY), points('p', ['a', 30, 20]));
    run(engine, hole('h', 'p', ['a'], ['lower', 'upper'], HEADED, { type: 'distance', start: 10.5, distance: -11 }, 'screw'));
    expect(hardware(engine)).toEqual(['screw × 1']);
    expect(hardware(engine, preview(engine, bodyRow('ls', 'lower', 'X', 3, 100), bodyRow('us', 'upper', 'X', 3, 100)))).toEqual(['screw × 5']);
  });

  it('a copy in the gap of a cut through two bodies, and a blind hole of a copy with material above it, are holes of their own', () => {
    let engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('lower', 's', 'r', 0, 5), slab('upper', 's', 'r', 100, 5), addSketch('p', XY), points('p', ['a', 30, 20]));
    run(engine, hole('h', 'p', ['a'], ['lower', 'upper'], PLAIN, { type: 'distance', start: 105, distance: -106 }, 'screw'));
    expect(hardware(engine)).toEqual(['screw × 1']);
    expect(hardware(engine, preview(engine, bodyRow('mid', 'lower', 'Z', 2, 50)))).toEqual(['screw × 2']);
    expect(hardware(engine, preview(engine, bodyRow('mid', 'lower', 'Z', 2, 200)))).toEqual(['screw × 2']);
    engine = newEngine();
    run(engine, { type: 'batch', commands: [...cylinder('low', 0, 0, 6, 0, 5), ...cylinder('high', 0, 0, 6, 100, 110)] }, addSketch('p', XY), points('p', ['a', 0, 0]), hole('h', 'p', ['a'], ['low', 'high'], PLAIN, { type: 'distance', start: 105, distance: -106 }, 'screw'));
    expect(hardware(engine, run(engine, bodyRow('down', 'high', 'Z', 2, -50)))).toEqual(['screw × 2']);
  });

  it('a gap of a thousandth is a gap wherever the plates stand across the hole', () => {
    for (const x of [0, 1000, 2000, 5000]) {
      const engine = newEngine();
      run(engine, addSketch('s', XY), rectangle('s', 'r', x, 0, 60, 40, null), slab('plate', 's', 'r', 0, 5), addSketch('p', XY), points('p', ['a', x + 30, 20]), hole('h', 'p', ['a'], ['plate'], PLAIN, { type: 'distance', start: 5, distance: -5.5 }, 'screw'));
      expect([5.001, 5.01, 5].map((spacing) => hardware(engine, preview(engine, bodyRow('st', 'plate', 'Z', 2, spacing)))[0]), `x = ${x}`).toEqual(['screw × 2', 'screw × 2', 'screw × 1']);
    }
  });

  it('far from the origin: a pin copied 10⁷ along Z and that copy 5 along X; pins 0.5 apart copied to z = 10⁹', () => {
    let engine = newEngine();
    run(engine, { type: 'batch', commands: cylinder('pin', 0, 0, 2, 0, 10) }, addSketch('p', XY), points('p', ['pc', 0, 0]), hole('h', 'p', ['pc'], ['pin'], { type: 'plain', diameter: 1 }, { type: 'distance', start: 10, distance: -11 }, 'screw'));
    // the copies inherit the use of their source (D48), so they are made parts by their own entries
    const parts = (sources: Id[], copies: Id[]): Command[] => [...sources.map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'auxiliary' } })), ...copies.map((body): Command => ({ type: 'setBodyProperties', body, patch: { use: 'part' } }))];
    expect(hardware(engine, run(engine, bodyRow('away', 'pin', 'Z', 2, 1e7), bodyRow('beside', 'away/1', 'X', 2, 5), ...parts(['pin'], ['away/1', 'beside/1'])))).toEqual(['screw × 2']);
    engine = newEngine();
    run(engine, { type: 'batch', commands: [...cylinder('pa', 0, 0, 0.2, 0, 10), ...cylinder('pb', 0.5, 0, 0.2, 0, 10)] }, addSketch('p', XY), points('p', ['a', 0, 0], ['b', 0.5, 0]), hole('h', 'p', ['a', 'b'], ['pa', 'pb'], { type: 'plain', diameter: 0.1 }, { type: 'distance', start: 10, distance: -11 }, 'screw'));
    expect(hardware(engine, run(engine, bodyRow('fa', 'pa', 'Z', 2, 1e9), bodyRow('fb', 'pb', 'Z', 2, 1e9), ...parts(['pa', 'pb'], ['fa/1', 'fb/1'])))).toEqual(['screw × 2']);
  });

  it('a bore split by a slot cut later stays one hole', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), slab('plate', 's', 'r', 0, 20), addSketch('p', XY), points('p', ['a', 30, 20]), hole('h', 'p', ['a'], ['plate'], PLAIN, { type: 'distance', start: 20, distance: -21 }, 'bolt'));
    run(engine, addSketch('q', { kind: 'base', plane: 'XZ' }), rectangle('q', 'w', -10, 5, 80, 10, null));
    expect(hardware(engine, preview(engine, slab('slot', 'q', 'w', -50, 100, 'cut', ['plate'])))).toEqual(['bolt × 1']);
  });

  it('a hole feature without a label is listed apart with its holes; one that made no hole is in neither list', () => {
    const engine = plates();
    run(engine, hole('screw', 'p', ['a', 'b'], ['upper', 'lower'], HEADED, { type: 'distance', start: 10, distance: -10.5 }));
    expect(listOf(engine).unlabelled).toEqual([{ feature: 'screw', count: 2 }]);
    expect(listOf(engine).hardware).toEqual([]);
    const suppressed = listOf(engine, preview(engine, { type: 'setSuppressed', id: 'screw', suppressed: true }));
    expect(suppressed.unlabelled).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the file

describe('the file partsCsv', () => {
  it('a name with a tab, a comma and quotes; a tiny mass; a copy in another colour', () => {
    const engine = newEngine();
    run(engine, addSketch('s', XY), rectangle('s', 'r', 0, 0, 60, 40, null), addExtrude('lower', 's', [rectLoop('r')], 5), slab('upper', 's', 'r', 5, 5), addSketch('p', XY), points('p', ['a', 10, 10], ['b', 50, 10]));
    run(engine, hole('screw', 'p', ['a', 'b'], ['upper', 'lower'], HEADED, { type: 'distance', start: 10, distance: -10.5 }, 'screw'));
    const state = preview(engine, { type: 'setBodyProperties', body: 'upper', patch: { name: 'top,\tplate "A"', mass: 1.2e-7 } }, bodyRow('uppers', 'upper', 'X', 2, 100), { type: 'setBodyProperties', body: 'uppers/1', patch: { color: '#000000' } });
    const exported = engine.export('partsCsv', {}, { state });
    if (!exported.ok) throw new Error(exported.error.message);
    expect(exported.result.empty).toBeUndefined();
    expect(new TextDecoder().decode(exported.result.files[0].bytes)).toBe(
      'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs\r\nprinted,lower,1,,,,,,lower\r\nprinted,"top, plate ""A""",1,,,0.00000012,0.00000012,,upper\r\nprinted,"top, plate ""A""",1,,#000000,0.00000012,0.00000012,copy of upper,uppers/1\r\nhardware,screw,4,,,,,,screw\r\n',
    );
  });
});

// ---------------------------------------------------------------- the box of scenario 12

describe('the finished box of scenario 12', () => {
  it('the box, three lids in a row, the pads and their mirror images; twelve screws for four inserts', () => {
    const engine = newEngine();
    const answer = (args: object) => {
      const outcome = engine.query('hardwareHole', args as never);
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.result as { shape: HoleFeature['shape']; label: string; depth?: number };
    };
    run(engine, parameters(), box(), cavity(), lid(), rib(), bracket(), ribDraft(), lipLeadIn(), countersinkByHand(), posts(), sketchOn('tops', onFace('box', POST_TOP)), brace());
    const screw = DATA_CATALOGS.countersunkScrews.rows.M3;
    const countersunk = answer({ use: 'countersunk', size: 'M3', allowance: 'holeComp' });
    run(engine, screwHoles(countersunk.shape, countersunk.label, String(Math.max(3, screw.headDiameter / 2 / Math.tan(screw.headAngle / 2) + 1))));
    const size = Object.keys(DATA_CATALOGS.heatSetInserts.rows).find((key) => DATA_CATALOGS.heatSetInserts.rows[key].thread === 3) as string;
    const insert = answer({ use: 'heatSetInsert', size, allowance: 'holeComp' });
    run(engine, insertHoles(insert.shape, insert.label, insert.depth as number));
    const state = run(engine, vents(), midPlanes(), ribMirror(), pads(), lidsInARow());
    expectAllOk(state);
    const list = listOf(engine);
    expect(list.printed.map(told)).toEqual(['box × 1: box', 'lid × 3: lid lids/1 lids/2', 'pad × 2: pad padXY/1', 'pad × 2: padX/1 padY/1 (mirror image of pad)']);
    expect(list.printed.map((r) => r.noMass ?? r.material)).toEqual(['notStated', 'notStated', 'TPU', 'TPU']);
    expect(list.printed[2].mass).toBeCloseTo(0.15, 6);
    expect(list.hardware.map((r) => `${r.label} × ${r.count}`)).toEqual([`${countersunk.label} × 12`, `${insert.label} × 4`]);
    expect(list.totals).toMatchObject({ printed: { count: 8, withoutMass: 4 }, hardware: { count: 16 } });
    expect(list.bought).toEqual([]);
  });
});
