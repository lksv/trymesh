// The point between the stages of D76 against the real adapters: the notes of an export about
// cosmetic threads, the bodies with them in the print check, and the threads of a row of the
// parts list (a body with a cosmetic thread and its copy without one are two rows).
import type { Command, Engine, Exported, PartRow } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine, run } from './kit';
import { bodyPattern, bore, box, hole, m6, mirrorIn, along, rod, rodSide, thread } from './thread-kit';

const exported = (engine: Engine, format: string, options: object = {}): Exported => {
  const outcome = engine.export(format as never, options as never);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const rows = (engine: Engine): PartRow[] => {
  const outcome = engine.query('partsList', {});
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result.printed;
};
// a plate with two tapped M6 holes (one thread feature) and a plain rod beside it
const plate = (): Command[] => [box('plate', 0, 0, 40, 20, 0, 8), hole('taps', [['h1', 10, 10], ['h2', 30, 10]], 5, 'plate'), thread('m6', { ...m6('plate', [bore('taps', 'h1'), bore('taps', 'h2')]), label: 'M6' }), rod('pin', 60, 10, 3, 0, 20)];
const NOTE = 'body "plate": 2 cosmetic threads (M6), not in the mesh: tap or cut them after printing';

describe('the notes of an export', () => {
  it('every format that writes the mesh of a body names the written bodies with cosmetic threads; the others and a body without one have none', () => {
    const engine = newEngine();
    run(engine, ...plate(), { type: 'setLink', id: 'base', bodies: ['plate'] }, { type: 'setLink', id: 'top', bodies: ['pin'] }, { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0, effort: 5, velocity: 2 } } as Command, { type: 'setBodyProperties', body: 'plate', patch: { density: 1.2 } }, { type: 'setBodyProperties', body: 'pin', patch: { density: 1.2 } });
    expect(exported(engine, 'stl').notes).toEqual([NOTE]);
    expect(exported(engine, 'stl', { perBody: true }).notes).toEqual([NOTE]);
    expect(exported(engine, '3mf').notes).toEqual([NOTE]);
    expect(exported(engine, 'urdf').notes).toEqual([NOTE]);
    expect(exported(engine, 'mjcf').notes).toEqual([NOTE]);
    expect(exported(engine, 'stl', { bodies: ['pin'] }).notes).toBeUndefined();
    expect(exported(engine, 'dxf', { plane: { kind: 'base', plane: 'XY' }, offset: 4 }).notes).toBeUndefined();
    expect(exported(engine, 'partsCsv').notes).toBeUndefined();
    // a thread without a label is named by its diameter and pitch; one thread is "it"
    run(engine, rod('stud', 100, 0, 4, 0, 10), thread('m8', { ...m6('stud', [rodSide('stud')]), diameter: 8, pitch: 1.25 }));
    expect(exported(engine, 'stl', { bodies: ['stud'] }).notes).toEqual(['body "stud": 1 cosmetic thread (8 x 1.25), not in the mesh: tap or cut it after printing']);
  });
});

describe('the print check', () => {
  it('names the bodies judged that have cosmetic threads, with how many', () => {
    const engine = newEngine();
    run(engine, ...plate());
    const outcome = engine.query('print', { orientations: [{ by: { up: [0, 0, 1] } }] });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.result.cosmeticThreads).toEqual([{ body: 'plate', threads: 2 }]);
    const pin = engine.query('print', { bodies: ['pin'], orientations: [{ by: { up: [0, 0, 1] } }] });
    expect(pin.ok && pin.result.cosmeticThreads).toBeUndefined();
  });
});

describe('the threads of the parts list', () => {
  it('a row says the threads of each body; a thread put on the source after its copy splits the row', () => {
    const engine = newEngine();
    run(engine, ...plate());
    expect(rows(engine).find((row) => row.bodies.includes('plate'))?.threads).toEqual([{ label: 'M6', internal: true, modelled: false, count: 2 }]);
    expect(rows(engine).find((row) => row.bodies.includes('pin'))?.threads).toBeUndefined();
    // a copy of the pin made before its thread: the copy has no thread, two rows
    run(engine, bodyPattern('pins', 'pin', along('Y', 2, 20)), thread('pt', { ...m6('pin', [rodSide('pin')]), label: 'M6' }));
    const pins = rows(engine).filter((row) => row.name === 'pin' || row.bodies.includes('pin') || row.bodies.includes('pins/1'));
    expect(pins.map((row) => [row.bodies, row.threads?.map((t) => [t.label, t.internal, t.count])])).toEqual([[['pin'], [['M6', false, 1]]], [['pins/1'], undefined]]);
  });

  it('a pattern of the body carries the threads and stays one row; a mirrored copy is a row of its own with its hand turned', () => {
    const engine = newEngine();
    run(engine, ...plate(), bodyPattern('plates', 'plate', along('Y', 3, 30)));
    const row = rows(engine).find((r) => r.bodies.includes('plate'));
    expect(row).toMatchObject({ count: 3, bodies: ['plate', 'plates/1', 'plates/2'], threads: [{ label: 'M6', internal: true, modelled: false, count: 2 }] });
    run(engine, bodyPattern('mirrored', 'plate', mirrorIn('XZ')));
    const image = rows(engine).find((r) => r.bodies.includes('mirrored/1'));
    expect(image).toMatchObject({ count: 1, mirrored: true, copyOf: 'plate', threads: [{ label: 'M6', count: 2 }] });
    expect(engine.getState().evaluation.threads.filter((t) => t.bodies.includes('mirrored/1')).map((t) => t.hand)).toEqual(['left', 'left']);
  });

  it('the file of the parts list says the threads in the note of a row', () => {
    const engine = newEngine();
    run(engine, ...plate());
    const csv = new TextDecoder().decode(exported(engine, 'partsCsv').files[0].bytes);
    expect(csv).toContain('threads: 2 × M6 internal, cosmetic');
  });
});
