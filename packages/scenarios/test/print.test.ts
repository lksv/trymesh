// The query `print` (D42) against the real adapters: orientations by a direction and by a face,
// what lies on the bed and what overhangs on a small model, the bed, the limits of the answer,
// a state asked about, and the errors.
import type { Engine, FaceName, Id, PrintOrientation, PrintReport, QueryArgs, QueryOptions } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, cap, circle, expectAllOk, newEngine, onFace, rectLoop, rectangle, run, side } from './kit';

function print(engine: Engine, args: QueryArgs<'print'>, options: QueryOptions = {}): PrintReport {
  const answer = engine.query('print', args, options);
  if (!answer.ok) throw new Error(`${answer.error.code}: ${answer.error.message}`);
  return answer.result;
}
const one = (engine: Engine, args: QueryArgs<'print'>, options: QueryOptions = {}): PrintOrientation => {
  const report = print(engine, args, options);
  expect(report.bodies).toHaveLength(1);
  expect(report.bodies[0].orientations).toHaveLength(1);
  return report.bodies[0].orientations[0];
};
const up = (x: number, y: number, z: number): { by: { up: [number, number, number] } } => ({ by: { up: [x, y, z] } });
const lying = (body: Id, face: FaceName): { by: { onBed: { kind: 'face'; body: Id; face: FaceName } } } => ({ by: { onBed: { kind: 'face', body, face } } });
const near = (values: number[], digits = 6) => values.map((value) => expect.closeTo(value, digits));
const curveOf = (name: FaceName): Id | undefined => ('curve' in name ? name.curve : undefined); // the curve of a side face
// the area of a regular polygon of `sides` corners inscribed in a circle
const polygon = (sides: number, radius: number): number => (sides / 2) * radius * radius * Math.sin((2 * Math.PI) / sides);
const sidesOf = (radius: number): number => Math.ceil(Math.PI / Math.acos(1 - 0.01 / radius)); // as the engine divides a circle at the chord tolerance 0.01

// A plate 40 × 30 × 10 (E1) with a hole of radius 4 through it at (10, 10) and a pin of radius 3,
// 5 high, on its top at (30, 20), one body; and a bar 10 × 30 × 10 beside it (BAR).
function model(): Engine {
  const engine = newEngine();
  run(
    engine,
    addSketch('S1', XY),
    rectangle('S1', 'r', 0, 0, 40, 30),
    circle('S1', 'h', 10, 10, 4),
    rectangle('S1', 'q', 50, 0, 10, 30, null),
    addExtrude('E1', 'S1', [rectLoop('r')], 10),
    addExtrude('BAR', 'S1', [rectLoop('q')], 10),
    addSketch('S2', onFace('E1', cap('E1'))),
    circle('S2', 'k', 30, 20, 3),
    addExtrude('PIN', 'S2', [['k']], 5, 'add', 'E1'),
  );
  expectAllOk(engine.getState());
  return engine;
}
const HOLE = polygon(sidesOf(4), 4);
const PIN = polygon(sidesOf(3), 3);

describe('the query print', () => {
  const engine = model();

  it('the plate as modelled: on its bottom, nothing overhangs; upside down it stands on its pin and its top overhangs', () => {
    const report = print(engine, { bodies: ['E1'], orientations: [up(0, 0, 1), up(0, 0, -1)] });
    expect(report.angle).toBeCloseTo(Math.PI / 4, 12);
    expect(report.truncated).toBeUndefined();
    const [standing, flipped] = report.bodies[0].orientations;
    expect(standing.up).toEqual([0, 0, 1]);
    expect(standing.size).toEqual(near([40, 30, 15], 4));
    expect(standing.fits).toBeUndefined();
    expect(standing.onBed).toBeUndefined(); // the orientation was not given by a face
    expect(standing.contact).toEqual({ area: expect.closeTo(1200 - HOLE, 3), count: 1, faces: [{ face: cap('E1', 'startCap'), area: expect.closeTo(1200 - HOLE, 3) }] });
    expect(standing.overhang).toEqual({ area: 0, count: 0, small: 0, faces: [] });
    // upside down: the end of the pin is on the bed, the top of the plate around it hangs 5 mm up
    expect(flipped.up).toEqual([0, 0, -1]);
    expect(flipped.size).toEqual(near([40, 30, 15], 4));
    expect(flipped.contact).toEqual({ area: expect.closeTo(PIN, 3), count: 1, faces: [{ face: cap('PIN'), area: expect.closeTo(PIN, 3) }] });
    expect(flipped.overhang).toEqual({ area: expect.closeTo(1200 - HOLE - PIN, 3), count: 1, small: 0, faces: [{ face: cap('E1'), area: expect.closeTo(1200 - HOLE - PIN, 3), from: expect.closeTo(5, 5) }] });
  });

  it('by a face: up is against its normal; the answer says whether the face named lies on the bed', () => {
    // the top of the plate named to lie on the bed: the pin reaches below it
    const onTop = one(engine, { bodies: ['E1'], orientations: [lying('E1', cap('E1'))] });
    expect(onTop.up).toEqual([0, 0, -1]);
    expect(onTop.onBed).toBe(false);
    expect(onTop.contact.faces.map((entry) => entry.face)).toEqual([cap('PIN')]);
    // the end of the pin does lie on the bed
    expect(one(engine, { bodies: ['E1'], orientations: [lying('E1', cap('PIN'))] }).onBed).toBe(true);
    // a side of the plate: up is +Y; it lies on that side, and the upper part of the wall of the hole overhangs
    const onSide = one(engine, { bodies: ['E1'], orientations: [lying('E1', side('E1', 'ra'))] });
    expect(onSide.up).toEqual(near([0, 1, 0], 9));
    expect(onSide.onBed).toBe(true);
    expect(onSide.size[2]).toBeCloseTo(30, 4);
    expect(onSide.contact.faces).toEqual([{ face: side('E1', 'ra'), area: expect.closeTo(400, 3) }]);
    // a horizontal hole of diameter 8 through 10 mm: about a quarter of its wall, π·d·t/4, from above its middle
    const hole = onSide.overhang.faces.find((entry) => curveOf(entry.face) === 'h');
    expect(hole?.area).toBeGreaterThan(0.9 * ((Math.PI * 8 * 10) / 4));
    expect(hole?.area).toBeLessThan(1.1 * ((Math.PI * 8 * 10) / 4));
    expect(hole?.from).toBeGreaterThan(10 + 4 * Math.SQRT1_2 - 0.5);
    expect(hole?.from).toBeLessThan(10 + 4 * Math.SQRT1_2 + 0.5);
    // the pin sticks out sideways: its lower quarter overhangs as well, the largest first
    expect(onSide.overhang.faces.map((entry) => curveOf(entry.face))).toEqual(['h', 'k']);
    expect(onSide.overhang.count).toBe(2);
    // the face of one body gives the direction for another, which has no `onBed`
    const bar = one(engine, { bodies: ['BAR'], orientations: [lying('E1', cap('E1'))] });
    expect(bar.up).toEqual([0, 0, -1]);
    expect(bar.onBed).toBeUndefined();
    expect(bar.contact.faces).toEqual([{ face: cap('BAR'), area: expect.closeTo(300, 3) }]);
  });

  it('all bodies without a list, each a print of its own; a body named twice is judged once; the order is that of the list', () => {
    const all = print(engine, { orientations: [up(0, 0, 1)] });
    expect(all.bodies.map((body) => body.body)).toEqual(['E1', 'BAR']);
    expect(all.bodies[1].orientations[0]).toMatchObject({ size: near([10, 30, 10], 4), contact: { area: expect.closeTo(300, 3), count: 1 }, overhang: { area: 0 } });
    expect(print(engine, { bodies: ['BAR', 'E1', 'BAR'], orientations: [up(0, 0, 1)] }).bodies.map((body) => body.body)).toEqual(['BAR', 'E1']);
    // before the pin was added the plate is 10 high and flat on both sides
    const before = print(engine, { bodies: ['E1'], orientations: [up(0, 0, -1)] }, { at: 'BAR' }).bodies[0].orientations[0];
    expect(before.size[2]).toBeCloseTo(10, 4);
    expect(before.overhang.area).toBe(0);
  });

  it('the bed: the footprint either way round, the height, and a turn about the vertical', () => {
    const fits = (bed: { x: number; y: number; height: number }, turn = 0): boolean | undefined => one(engine, { bodies: ['E1'], orientations: [{ ...up(0, 0, 1), turn }], bed }).fits;
    expect(fits({ x: 40, y: 30, height: 15 })).toBe(true); // exactly its size
    expect(fits({ x: 30, y: 40, height: 15 })).toBe(true); // a quarter turn is free
    expect(fits({ x: 39.9, y: 39.9, height: 15 })).toBe(false); // too short either way round
    expect(fits({ x: 100, y: 29.9, height: 15 })).toBe(false);
    expect(fits({ x: 40, y: 30, height: 14.9 })).toBe(false);
    // turned by 45° the box of the plate is (40 + 30)/√2 both ways
    const diagonal = one(engine, { bodies: ['E1'], orientations: [{ ...up(0, 0, 1), turn: Math.PI / 4 }] });
    expect(diagonal.size).toEqual(near([70 * Math.SQRT1_2, 70 * Math.SQRT1_2, 15], 4));
    expect(fits({ x: 45, y: 45, height: 20 })).toBe(true);
    expect(fits({ x: 45, y: 45, height: 20 }, Math.PI / 4)).toBe(false);
    // a turn changes neither the contact nor the overhang
    expect(diagonal.contact.area).toBeCloseTo(1200 - HOLE, 3);
  });

  it('the overhang angle and the limits of the answer', () => {
    // on its side, with a stricter printer more of the two round walls overhangs
    const usual = one(engine, { bodies: ['E1'], orientations: [up(0, 1, 0)] });
    const strict = one(engine, { bodies: ['E1'], orientations: [up(0, 1, 0)], overhang: Math.PI / 6 });
    expect(strict.overhang.area).toBeGreaterThan(1.2 * usual.overhang.area);
    expect(one(engine, { bodies: ['E1'], orientations: [up(0, 1, 0)], overhang: Math.PI / 2 }).overhang.area).toBe(0);
    // the smaller of the two overhangs is below the smallest area listed: counted, not listed
    const pin = usual.overhang.faces[1].area;
    const hidden = one(engine, { bodies: ['E1'], orientations: [up(0, 1, 0)], minArea: pin + 1 });
    expect(hidden.overhang).toMatchObject({ area: expect.closeTo(usual.overhang.area, 9), count: 2, small: 1 });
    expect(hidden.overhang.faces.map((entry) => curveOf(entry.face))).toEqual(['h']);
    // one face a list: each list is cut by itself, and the answer counts what was listed of what there was
    const cut = print(engine, { orientations: [up(0, 1, 0), up(0, 0, 1)], maxFaces: 1 });
    const [side1, flat] = cut.bodies[0].orientations;
    expect(side1.overhang).toMatchObject({ count: 2, small: 0 });
    expect(side1.overhang.faces).toHaveLength(1);
    expect(side1.contact.faces).toHaveLength(1);
    expect(flat.contact.count).toBe(1);
    // E1: 1 + 1 of 1 + 2 on its side, 1 of 1 flat; BAR: 1 of 1 twice
    expect(cut.truncated).toEqual({ shown: 5, total: 6 });
    expect(print(engine, { orientations: [up(0, 1, 0), up(0, 0, 1)], maxFaces: 2 }).truncated).toBeUndefined();
  });

  it('review: a body on two faces in one plane under a direction a hair off; a direction of any length; a turn of a face', () => {
    // a plate 40 × 30 × 10 and a block 60 × 30 × 20 added beside it from the same plane: one body with two bottom faces
    const joined = newEngine();
    run(joined, addSketch('S1', XY), rectangle('S1', 'r', 0, 0, 40, 30), addExtrude('E1', 'S1', [rectLoop('r')], 10), addSketch('S2', XY), rectangle('S2', 'q', 40, 0, 60, 30, null), addExtrude('BLOCK', 'S2', [rectLoop('q')], 20, 'add', 'E1'));
    expectAllOk(joined.getState());
    // 5e-6 rad off: along that direction the block starts 2e-4 mm above the lowest corner, twice
    // the precision of coordinates up to 100; both faces are still on the bed
    const off = one(joined, { orientations: [up(5e-6, 0, 1)] });
    expect(off.contact).toEqual({
      area: expect.closeTo(3000, 3),
      count: 2,
      faces: [
        { face: cap('BLOCK', 'startCap'), area: expect.closeTo(1800, 3) },
        { face: cap('E1', 'startCap'), area: expect.closeTo(1200, 3) },
      ],
    });
    expect(off.overhang).toEqual({ area: 0, count: 0, small: 0, faces: [] });
    // the smaller of the two named to lie on the bed, with one face listed: the totals and `onBed` are of all faces
    const cut = print(joined, { orientations: [lying('E1', cap('E1', 'startCap'))], maxFaces: 1 });
    expect(cut.bodies[0].orientations[0]).toMatchObject({ onBed: true, contact: { area: expect.closeTo(3000, 3), count: 2 } });
    expect(cut.bodies[0].orientations[0].contact.faces).toEqual([{ face: cap('BLOCK', 'startCap'), area: expect.closeTo(1800, 3) }]);
    expect(cut.truncated).toEqual({ shown: 1, total: 2 });
    // directions whose length a double barely holds. On its end x = 0 the step between the plate
    // and the block looks straight down, 40 up
    const onEnd = one(joined, { orientations: [up(1e-320, 0, 0)] });
    expect(onEnd.up).toEqual([1, 0, 0]);
    expect(onEnd.contact.faces).toEqual([{ face: side('E1', 'rd'), area: expect.closeTo(300, 3) }]);
    expect(onEnd.overhang.faces).toEqual([{ face: side('BLOCK', 'qd'), area: expect.closeTo(300, 3), from: expect.closeTo(40, 4) }]);
    expect(one(joined, { orientations: [up(0, 0, 5e-324)] }).up).toEqual([0, 0, 1]);
    expect(one(joined, { orientations: [up(1.7e308, 1.7e308, 1.7e308)] }).up).toEqual(near([Math.sqrt(1 / 3), Math.sqrt(1 / 3), Math.sqrt(1 / 3)], 12));
    // by a face a turn turns the box as it does by a direction, and the body stays on that face
    const [flat, quarter] = print(joined, { orientations: [lying('E1', side('E1', 'ra')), { ...lying('E1', side('E1', 'ra')), turn: Math.PI / 2 }] }).bodies[0].orientations;
    expect(flat.size).toEqual(near([100, 20, 30], 4));
    expect(quarter.size).toEqual(near([20, 100, 30], 4));
    expect([flat.onBed, quarter.onBed]).toEqual([true, true]);
    expect(quarter.contact).toEqual(flat.contact);
  });

  it('errors: an orientation that says nothing, a face that cannot lie on the bed, numbers out of their ranges', () => {
    const fails = (args: unknown) => engine.query('print', args as QueryArgs<'print'>);
    expect(fails({ bodies: ['E1'] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations'] } });
    expect(fails({ orientations: [] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations'] } });
    expect(fails({ orientations: Array.from({ length: 13 }, () => up(0, 0, 1)) })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations'] } });
    expect(fails({ orientations: [{ by: { up: [0, 0, 1], onBed: lying('E1', cap('E1')).by.onBed } }] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations', 0, 'by'] } });
    expect(fails({ orientations: [up(0, 0, 0)] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations', 0, 'by', 'up'], message: 'print: orientations[0].by.up: a direction needs a length' } });
    // a round face, the second orientation
    expect(fails({ orientations: [up(0, 0, 1), lying('E1', side('E1', 'h'))] })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['orientations', 1, 'by', 'onBed'], message: expect.stringContaining('only a planar face can lie on the bed') } });
    expect(fails({ orientations: [lying('E1', side('nope', 'x'))] })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['orientations', 0, 'by', 'onBed', 'face'] } });
    expect(fails({ orientations: [{ by: { onBed: { kind: 'body', body: 'E1' } } }] })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['orientations', 0, 'by', 'onBed'] } });
    expect(fails({ orientations: [up(0, 0, 1)], bed: { x: 220, y: 220, height: 0 } })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['bed', 'height'] } });
    expect(fails({ orientations: [up(0, 0, 1)], bed: { x: 220, y: 220 } })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['bed', 'height'] } });
    expect(fails({ orientations: [up(0, 0, 1)], overhang: 2 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['overhang'] } });
    expect(fails({ orientations: [up(0, 0, 1)], maxFaces: 0 })).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['maxFaces'] } });
    expect(fails({ bodies: ['nope'], orientations: [up(0, 0, 1)] })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['bodies', 0] } });
    // the pin is not there yet after the bar
    expect(engine.query('print', { orientations: [lying('E1', cap('PIN'))] }, { at: 'BAR' })).toMatchObject({ ok: false, error: { code: 'notAvailable' } });
  });
});
