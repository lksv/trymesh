// Modelled threads (D76, stage 2) against the real adapters: the tool cut into a pin and a bore,
// the faces left and the faces gone at every kind of end, what stands in the way, two tools that
// cross, the face `general` through its consumers, a pin with a clearance, a screw in a nut and the
// seat of two that are turned against each other, the switch between the modes, the notes of an
// export and the parts list, and the measurements of "Performance".
import { createPakoDeflater } from '@trymesh/deflate-pako';
import { type Command, type EngineState, type FaceName, type Id, type SolidKernel, createEngine, emptyDocument } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { XY, newEngine, run } from './kit';
import { blindHole, bodyPattern, bore, box, chamfer, combine, hole, messageOf, mirrorIn, rod, rodSide, statusOf, thread, threadsOf, top } from './thread-kit';

type Engine = ReturnType<typeof newEngine>;
const M10 = { diameter: 10, pitch: 1.5, hand: 'right', direction: 'backward' } as const;
const names = (state: EngineState, body: Id): string[] => [...new Set(state.evaluation.bodies[body].faces.map((f) => { const n = state.evaluation.faceNames[f.id]; return `${n.feature}/${n.role}${n.role === 'threadFlank' ? `/${n.side}` : ''}${'end' in n ? `/${n.end}` : ''}`; }))].sort();
const surfaceOf = (state: EngineState, body: Id, name: Partial<FaceName>) => {
  const face = state.evaluation.bodies[body].faces.find((f) => Object.entries(name).every(([k, v]) => (state.evaluation.faceNames[f.id] as Record<string, unknown>)[k] === v));
  return face === undefined ? undefined : state.evaluation.faceSurfaces[face.id];
};
const interference = (engine: Engine, bodies: Id[], state?: EngineState) => {
  const outcome = engine.query('interference', { bodies }, state ? { state } : {});
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.result;
};
const preview = (engine: Engine, command: Command): EngineState => {
  const outcome = engine.preview(command);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.state;
};
const timed = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const value = f();
  return [value, performance.now() - t0];
};

describe('the tool cut into the body', () => {
  it('a pin standing on a plate and a through bore: the faces, the ends, the volume, the wall kept as the crest', () => {
    const engine = newEngine();
    const plain = run(engine, box('plate', -10, -10, 10, 10, -5, 0), rod('pin', 0, 0, 5, 0, 20, 'add', 'plate'), box('nut', 20, -10, 40, 10, 0, 12), hole('nh', [['h', 30, 0]], 10 - 2 * 0.811899, 'nut'));
    const state = run(engine, thread('pt', { body: 'plate', faces: [rodSide('pin')], modelled: true, ...M10 }), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10 }));
    expect([statusOf(state, 'pt'), statusOf(state, 'nt')]).toEqual(['ok', 'ok']);
    // the pin: from its free end (open, a run-out into the air) down to the plate (a shoulder: a flat end)
    const [pin] = threadsOf(state, 'pt');
    expect(pin).toMatchObject({ modelled: true, internal: false, ends: { start: 'open', end: 'shoulder' } });
    expect(names(state, 'plate')).toEqual(expect.arrayContaining(['pin/side', 'pt/threadFlank/start', 'pt/threadFlank/end', 'pt/threadRoot', 'pt/threadEnd/end']));
    expect(names(state, 'plate')).not.toContain('pt/threadEnd/start');
    expect(surfaceOf(state, 'plate', { feature: 'pt', role: 'threadFlank' })?.kind).toBe('general');
    expect(surfaceOf(state, 'plate', { feature: 'pin', role: 'side' })).toMatchObject({ kind: 'cylinder', radius: 5 });
    const root = surfaceOf(state, 'plate', { feature: 'pt', role: 'threadRoot' });
    expect(root?.kind === 'cylinder' && 2 * root.radius).toBeCloseTo(10 - 2 * 0.811899, 5);
    // the bore: open at both ends, no flat end; its root the major cylinder
    expect(names(state, 'nut')).toEqual(expect.arrayContaining(['nh/holeBore', 'nt/threadFlank/start', 'nt/threadFlank/end', 'nt/threadRoot']));
    expect(names(state, 'nut').filter((n) => n.startsWith('nt/threadEnd'))).toEqual([]);
    const nutRoot = surfaceOf(state, 'nut', { feature: 'nt', role: 'threadRoot' });
    expect(nutRoot?.kind === 'cylinder' && nutRoot.radius).toBeCloseTo(5, 9);
    // the volume taken: the grooves alone, less than the band of the thread
    const taken = (body: Id) => plain.evaluation.bodies[body].volume - state.evaluation.bodies[body].volume;
    expect(taken('plate')).toBeGreaterThan(0);
    expect(taken('plate')).toBeLessThan(Math.PI * 20 * (25 - (5 - 0.811899) ** 2));
    expect(taken('nut')).toBeGreaterThan(0);
    // every edge of a flank is of the kind other
    const flankEdges = state.evaluation.bodies.plate.edges.filter((e) => e.name.a.role === 'threadFlank' || e.name.b.role === 'threadFlank');
    expect(flankEdges.length).toBeGreaterThan(0);
    expect(flankEdges.every((e) => e.kind === 'other')).toBe(true);
    expect(state.evaluation.features.pt.facts?.triangles).toBeGreaterThan(1000);
  });

  it('a blind tapped hole: a flat end the lift short of the bottom, a run-out at the mouth', () => {
    const engine = newEngine();
    run(engine, box('block', -10, -10, 10, 10, 0, 15), blindHole('bh', 0, 0, 6.8, 15, -10, 'block'));
    const state = run(engine, thread('bt', { body: 'block', faces: [bore('bh', 'p')], modelled: true, diameter: 8, pitch: 1.25, hand: 'right', direction: 'backward' }));
    expect(statusOf(state, 'bt')).toBe('ok');
    expect(threadsOf(state, 'bt')[0].ends).toEqual({ start: 'open', end: 'shoulder' });
    expect(names(state, 'block')).toContain('bt/threadEnd/end');
    expect(names(state, 'block')).not.toContain('bt/threadEnd/start');
  });

  it('a thread that ends inside the wall by its length, and one through a chamfered tip', () => {
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 20), chamfer('ch', 'pin', [{ a: top('pin'), b: rodSide('pin') }], 1));
    const state = run(engine, thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10, length: 12 }));
    expect(statusOf(state, 'pt')).toBe('ok');
    const [t] = threadsOf(state, 'pt');
    expect(t.ends).toEqual({ start: 'open', end: 'inside' });
    expect(t.runOut.start).toBeGreaterThan(0.5);
    expect(names(state, 'pin')).toEqual(expect.arrayContaining(['pt/threadEnd/end', 'ch/chamfer']));
    expect(names(state, 'pin')).not.toContain('pt/threadEnd/start');
  });
});

describe('a refused cut: the next mesh of the tool (the review of stage 2)', () => {
  it('one refusal: the second mesh is taken and the facts say so; four: kernelFailure after the four meshes', async () => {
    // a kernel that refuses the next `refuse` differences, as the adapter refuses about 1.5 % of the tools
    const real = await createManifoldKernel();
    let refuse = 0;
    const kernel: SolidKernel = { ...real, boolean: (op, a, b) => {
      if (op === 'difference' && refuse > 0) {
        refuse--;
        throw new Error('refused on purpose');
      }
      return real.boolean(op, a, b);
    } };
    const engine = createEngine({ solver: await createPlanegcsSolver(), kernel, deflater: createPakoDeflater() });
    run(engine, rod('pin', 0, 0, 5, 0, 20));
    refuse = 1;
    const once = run(engine, thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10 }));
    expect(statusOf(once, 'pt')).toBe('ok');
    expect(once.evaluation.features.pt.facts).toMatchObject({ attempt: 2 });
    expect(refuse).toBe(0);
    refuse = 4;
    const always = run(engine, { type: 'updateFeature', id: 'pt', patch: { phase: 0.1 } } as Command);
    expect(statusOf(always, 'pt')).toBe('error:kernelFailure');
    expect(messageOf(always, 'pt')).toContain('(after 4 meshes of the tool)');
    expect(refuse).toBe(0);
  });
});

describe('more ends and walls ("To verify" 4 and 5 of the design)', () => {
  it('a pin of two extrusions: the thread on the upper face ends inside at the joint, with a flat end there', () => {
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 10), rod('top', 0, 0, 5, 10, 20, 'add', 'pin'));
    const state = run(engine, thread('pt', { body: 'pin', faces: [rodSide('top')], modelled: true, ...M10 }));
    expect(statusOf(state, 'pt')).toBe('ok');
    expect(threadsOf(state, 'pt')[0].ends).toEqual({ start: 'open', end: 'inside' });
    expect(names(state, 'pin')).toEqual(expect.arrayContaining(['pt/threadEnd/end', 'pin/side']));
  });

  it('a bore crossed by a hole and a bore with a slot in its wall: the tool passes the air', () => {
    const engine = newEngine();
    run(engine, box('block', -10, -10, 10, 10, 0, 16), hole('h', [['p', 0, 0]], 8.4, 'block'), hole('cross', [['q', 0, 8]], 3, 'block', 'forward', { kind: 'base', plane: 'YZ' }));
    const crossed = run(engine, thread('t', { body: 'block', faces: [bore('h', 'p')], modelled: true, ...M10 }));
    expect(statusOf(crossed, 't')).toBe('ok');
    const slotted = newEngine();
    run(slotted, box('block', -10, -10, 10, 10, 0, 16), hole('h', [['p', 0, 0]], 8.4, 'block'), box('slot', 0, -1, 12, 1, 6, 10, 'cut', 'block'));
    expect(statusOf(run(slotted, thread('t', { body: 'block', faces: [bore('h', 'p')], modelled: true, ...M10 })), 't')).toBe('ok');
  });

  it('copies: the bores of a row of holes, each tool named by the listed face with the copy tags of the copy', () => {
    const engine = newEngine();
    run(engine, box('plate', -10, -10, 40, 10, 0, 10), hole('h', [['p', 0, 0]], 8.4, 'plate'), { type: 'addFeature', feature: { id: 'row', name: 'row', suppressed: false, type: 'pattern', source: { type: 'features', features: ['h'] }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 15 } } } } as Command);
    const state = run(engine, thread('t', { body: 'plate', faces: [bore('h', 'p')], copies: true, modelled: true, ...M10 }));
    expect(statusOf(state, 't')).toBe('ok');
    const roots = state.evaluation.bodies.plate.faces.map((f) => state.evaluation.faceNames[f.id]).filter((n) => n.role === 'threadRoot');
    expect(roots.map((n) => JSON.stringify(n.copy ?? []))).toEqual(['[]', '[{"pattern":"row","index":1}]', '[{"pattern":"row","index":2}]']);
  });
});

describe('what stands in the way, and two tools that cross', () => {
  it('a post in the middle of a bore is left alone; a key in the bore and a rib on a pin refuse the thread', () => {
    const engine = newEngine();
    // a blind bore 8.4 with a post of 3 in its middle
    run(engine, box('cup', -10, -10, 10, 10, 0, 15), blindHole('bh', 0, 0, 8.4, 15, -10, 'cup'), rod('post', 0, 0, 1.5, 5, 15, 'add', 'cup'));
    const post = run(engine, thread('bt', { body: 'cup', faces: [bore('bh', 'p')], modelled: true, ...M10 }));
    expect(statusOf(post, 'bt')).toBe('ok');
    expect(names(post, 'cup')).toContain('post/side');
    // a key 2 × 2 standing into the wall of a bore
    const keyed = newEngine();
    run(keyed, box('block', -10, -10, 10, 10, 0, 15), hole('h', [['p', 0, 0]], 8.4, 'block'), box('key', 3.8, -1, 5.5, 1, 5, 9, 'add', 'block'));
    const key = run(keyed, thread('kt', { body: 'block', faces: [bore('h', 'p')], modelled: true, ...M10 }));
    expect(statusOf(key, 'kt')).toBe('error:invalidThread');
    expect(messageOf(key, 'kt')).toMatch(/stands in the way/);
    // a rib on a pin
    const ribbed = newEngine();
    run(ribbed, rod('pin', 0, 0, 5, 0, 20), box('rib', 4.5, -1, 7, 1, 8, 12, 'add', 'pin'));
    const rib = run(ribbed, thread('rt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10 }));
    expect(statusOf(rib, 'rt')).toBe('error:invalidThread');
  });

  it('two bores of one feature whose tools would cross are refused; side by side they are fine', () => {
    const engine = newEngine();
    run(engine, box('block', -20, -10, 20, 10, 0, 10), hole('h', [['a', -6, 0], ['b', 6, 0]], 8.4, 'block'));
    expect(statusOf(run(engine, thread('t', { body: 'block', faces: [bore('h', 'a'), bore('h', 'b')], modelled: true, ...M10 })), 't')).toBe('ok');
    const near = newEngine();
    run(near, box('block', -20, -10, 20, 10, 0, 10), hole('h', [['a', -4.6, 0], ['b', 4.6, 0]], 8.4, 'block'));
    // the bores are 0.8 apart: their tools (to the major radius) meet
    const crossing = run(near, thread('t', { body: 'block', faces: [bore('h', 'a'), bore('h', 'b')], modelled: true, ...M10 }));
    expect(statusOf(crossing, 't')).toBe('error:invalidThread');
    expect(messageOf(crossing, 't')).toMatch(/would cross/);
    // cosmetic, the same two are fine
    expect(statusOf(preview(near, { type: 'updateFeature', id: 't', patch: { modelled: false } } as Command), 't')).toBe('ok');
  });
});

describe('the face general through its consumers', () => {
  it('a chamfer of an edge of a flank is refused; a combine with a clearance whose tool has a modelled thread is refused; a section cuts it', () => {
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 20), thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10 }));
    const state = engine.getState();
    const edge = state.evaluation.bodies.pin.edges.find((e) => e.name.a.role === 'threadFlank' || e.name.b.role === 'threadFlank');
    expect(edge).toBeDefined();
    const chamfered = preview(engine, chamfer('ch', 'pin', [edge!.name], 0.2));
    expect(statusOf(chamfered, 'ch')).toBe('error:unsupportedEdge');
    run(engine, box('block', -10, -10, 10, 10, 5, 15));
    const cleared = preview(engine, { type: 'addFeature', feature: { id: 'cb', name: 'cb', suppressed: false, type: 'combine', operation: 'difference', target: 'block', tools: ['pin'], keepTools: true, clearance: 0.2 } } as Command);
    expect(statusOf(cleared, 'cb')).toMatch(/^error:/);
    expect(messageOf(cleared, 'cb')).toMatch(/modelled thread/);
    // a section along the axis cuts the flanks: spans on the faces of the thread
    const section = engine.query('section', { bodies: ['pin'], plane: { kind: 'base', plane: 'XZ' } });
    if (!section.ok) throw new Error(section.error.message);
    expect(JSON.stringify(section.result)).toMatch(/threadFlank/);
  });
});

describe('a screw in a nut', () => {
  // an M10 stud 20 long, threaded 14 down from its top; a nut 8 high from z = 8 to 16 with the
  // clearance 0.2 and its bore widened by twice it; the helix of the nut starts 4 below the stud's
  const studAndNut = (engine: Engine, nutPhase: (base: number) => number = (b) => b, hand: 'right' | 'left' = 'right', starts = 1) => {
    const base = (hand === 'left' ? -1 : 1) * (2 * Math.PI * 4) / (1.5 * starts);
    run(
      engine,
      rod('stud', 0, 0, 5, 0, 20),
      box('nut', -10, -10, 10, 10, 8, 16),
      hole('nh', [['h', 0, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'),
      thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, hand, starts, length: 14 }),
      thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, hand, starts, clearance: 0.2, phase: nutPhase(base) }),
    );
    return base;
  };

  it('seated, free of each other; turned by half a pitch, a collision whose entry says how to seat either; seated so, free again', { timeout: 120_000 }, () => {
    const engine = newEngine();
    const base = studAndNut(engine);
    expect(interference(engine, ['stud', 'nut'])).toMatchObject({ pairs: [], fits: [], failed: [] });
    const turned = preview(engine, { type: 'updateFeature', id: 'nt', patch: { phase: base + Math.PI } } as Command);
    const report = interference(engine, ['stud', 'nut'], turned);
    expect(report.pairs).toHaveLength(1);
    expect(report.threaded).toBeUndefined();
    const seat = report.pairs[0].seat ?? [];
    expect(seat.map((s) => s.feature).sort()).toEqual(['nt', 'st']);
    const forNut = seat.find((s) => s.feature === 'nt')!;
    const forStud = seat.find((s) => s.feature === 'st')!;
    expect(Math.abs(forNut.addToPhase)).toBeCloseTo(Math.PI, 6);
    for (const [id, add, phase] of [['nt', forNut.addToPhase, base + Math.PI], ['st', forStud.addToPhase, 0]] as const) {
      const seated = preview(engine, { type: 'batch', commands: [{ type: 'updateFeature', id: 'nt', patch: { phase: base + Math.PI } }, { type: 'updateFeature', id, patch: { phase: phase + add } }] } as Command);
      expect(interference(engine, ['stud', 'nut'], seated).pairs, id).toEqual([]);
    }
  });

  // The other seats in a document of the chord tolerance 0.05 (the clearance 0.2 is above it), so
  // that a colliding pair is measured in about a second; the values for the hands, the starts and
  // the two ways are also tested without meshes (packages/engine/test/seat.test.ts).
  const coarse = (): Engine => {
    const engine = newEngine();
    const loaded = engine.load(JSON.stringify({ ...emptyDocument(), settings: { chordTolerance: 0.05 } }));
    if (!loaded.ok) throw new Error(loaded.error.message);
    return engine;
  };
  // applying either entry of `seat` frees the pair
  const eitherFrees = (engine: Engine, a: Id, b: Id, base: Command[]): void => {
    const report = interference(engine, [a, b], base.length ? preview(engine, { type: 'batch', commands: base } as Command) : undefined);
    expect(report.pairs).toHaveLength(1);
    const seat = report.pairs[0].seat ?? [];
    expect(seat).toHaveLength(2);
    for (const entry of seat) {
      const phase = (engine.getState().document.features.find((f) => f.id === entry.feature) as { phase?: number }).phase ?? 0;
      const patched = base.find((c) => c.type === 'updateFeature' && c.id === entry.feature) as { patch?: { phase?: number } } | undefined;
      const seated = preview(engine, { type: 'batch', commands: [...base, { type: 'updateFeature', id: entry.feature, patch: { phase: (patched?.patch?.phase ?? phase) + entry.addToPhase } }] } as Command);
      expect(interference(engine, [a, b], seated).pairs, entry.feature).toEqual([]);
    }
  };

  it('a turn of 1 radian in both hands and with two starts, and the nut threaded the other way (chord tolerance 0.05)', { timeout: 120_000 }, () => {
    for (const [hand, starts] of [['right', 1], ['left', 1], ['right', 2]] as const) {
      const engine = coarse();
      const base = studAndNut(engine, (b) => b + 1, hand, starts);
      const forNut = interference(engine, ['stud', 'nut']).pairs[0]?.seat?.find((s) => s.feature === 'nt');
      expect(forNut?.addToPhase, `${hand} ${starts}`).toBeCloseTo(-1, 6);
      expect(interference(engine, ['stud', 'nut'], preview(engine, { type: 'updateFeature', id: 'nt', patch: { phase: base } } as Command)).pairs, `${hand} ${starts}`).toEqual([]);
    }
    const engine = coarse();
    studAndNut(engine);
    eitherFrees(engine, 'nut', 'stud', [{ type: 'updateFeature', id: 'nt', patch: { direction: 'forward', phase: -(2 * Math.PI * 12) / 1.5 + 0.7 } } as Command]);
  });

  // the review of stage 2: a phase turns a record that went through a mirror the other way
  it('a stud and a nut both mirrored by patterns of the bodies: the seat of the mirrored pair frees it (chord tolerance 0.05)', { timeout: 120_000 }, () => {
    const engine = coarse();
    run(engine, rod('stud', 20, 0, 5, 0, 20), box('nut', 10, -10, 30, 10, 8, 16), hole('nh', [['h', 20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, clearance: 0.2, phase: (2 * Math.PI * 4) / 1.5 + 1 }), bodyPattern('ms', 'stud', mirrorIn('YZ')), bodyPattern('mn', 'nut', mirrorIn('YZ')));
    const mirrored = interference(engine, ['ms/1', 'mn/1']).pairs[0]?.seat;
    expect(mirrored?.find((s) => s.feature === 'nt')?.addToPhase).toBeCloseTo(-1, 6);
    eitherFrees(engine, 'mn/1', 'ms/1', []);
  });

  it('only one of the two went through a mirror: a mirrored stud in a left-hand nut; and a nut threaded through a mirror pattern of features (chord tolerance 0.05)', { timeout: 120_000 }, () => {
    const engine = coarse();
    run(engine, rod('stud', 20, 0, 5, 0, 20), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), bodyPattern('ms', 'stud', mirrorIn('YZ')), box('nut', -30, -10, -10, 10, 8, 16), hole('nh', [['h', -20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, hand: 'left', clearance: 0.2, phase: 0.4 }));
    eitherFrees(engine, 'ms/1', 'nut', []);
    const copies = coarse();
    run(copies, rod('stud', -20, 0, 5, 0, 20), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), box('nut', -30, -10, 30, 10, 8, 16), hole('nh', [['h', 20, 0]], 10 - 2 * 0.811899 + 0.4, 'nut'), { type: 'addFeature', feature: { id: 'mf', name: 'mf', suppressed: false, type: 'pattern', source: { type: 'features', features: ['nh'] }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } } } as Command, thread('nt', { body: 'nut', faces: [bore('nh', 'h')], copies: true, modelled: true, ...M10, clearance: 0.2, phase: 0.4 }));
    eitherFrees(copies, 'nut', 'stud', []);
  });

  it('a modelled thread excuses a plain rod and a cosmetic thread; the flag changes the mesh and nothing else', () => {
    const engine = newEngine();
    studAndNut(engine);
    const plainRod = preview(engine, { type: 'setSuppressed', id: 'st', suppressed: true } as Command);
    expect(interference(engine, ['stud', 'nut'], plainRod)).toMatchObject({ pairs: [], threaded: [{ a: 'nut', b: 'stud' }] });
    const cosmeticStud = preview(engine, { type: 'updateFeature', id: 'st', patch: { modelled: false } } as Command);
    expect(interference(engine, ['stud', 'nut'], cosmeticStud)).toMatchObject({ pairs: [], threaded: [{ a: 'nut', b: 'stud' }] });
    expect(cosmeticStud.evaluation.bodies.stud.volume).toBe(engine.getState('nh').evaluation.bodies.stud.volume);
    expect(threadsOf(cosmeticStud, 'st')[0].modelled).toBe(false);
  });
});

describe('a pin with a clearance (M of spike.md)', () => {
  it('at the nominal diameter a clearance of 0.1 is taken and 0.2 is not; made at the diameter less twice it, 0.2 is taken with its root shifted', () => {
    const at = (radius: number, clearance: number) => {
      const engine = newEngine();
      run(engine, rod('pin', 0, 0, radius, 0, 20));
      return run(engine, thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10, clearance }));
    };
    expect(statusOf(at(5, 0.1), 'pt')).toBe('ok');
    expect(statusOf(at(5, 0.2), 'pt')).toBe('error:invalidThread');
    const made = at(4.8, 0.2);
    expect(statusOf(made, 'pt')).toBe('ok');
    const root = surfaceOf(made, 'pin', { feature: 'pt', role: 'threadRoot' });
    expect(root?.kind === 'cylinder' && 2 * root.radius).toBeCloseTo(10 - 2 * 0.811899 - 0.4, 5);
  });
});

describe('the notes of an export and the parts list (the point between the stages)', () => {
  it('a modelled thread is in the mesh: no note; the row of the parts list says modelled; a copy of the body keeps it', () => {
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 20), thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10, label: 'M10' }), bodyPattern('pins', 'pin', { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 20 } }));
    const stl = engine.export('stl', {});
    expect(stl.ok && stl.result.notes).toBeUndefined();
    const parts = engine.query('partsList', {});
    expect(parts.ok && parts.result.printed).toMatchObject([{ count: 2, bodies: ['pin', 'pins/1'], threads: [{ label: 'M10', internal: false, modelled: true, count: 1 }] }]);
    const print = engine.query('print', { orientations: [{ by: { up: [0, 0, 1] } }] });
    expect(print.ok && print.result.cosmeticThreads).toBeUndefined();
    // a mirrored copy of a modelled thread: left-hand, the mirrored mesh
    const mirrored = run(engine, bodyPattern('mir', 'pin', mirrorIn('YZ')));
    expect(threadsOf(mirrored, 'pt').find((t) => t.bodies.includes('mir/1'))).toMatchObject({ hand: 'left', modelled: true });
    expect(statusOf(mirrored, 'mir')).toBe('warning:mirroredThread');
  });
});

describe('measured (design.md, "Performance")', () => {
  it('M10x1.5 20 long at 0.01, eight M8 in one boolean, a lid thread 40 x 4: the triangles and the times', () => {
    const rows: string[] = [];
    const engine = newEngine();
    run(engine, rod('pin', 0, 0, 5, 0, 20));
    const [m10, m10ms] = timed(() => run(engine, thread('pt', { body: 'pin', faces: [rodSide('pin')], modelled: true, ...M10 })));
    expect(statusOf(m10, 'pt')).toBe('ok');
    rows.push(`M10x1.5 x 20 pin: tool ${m10.evaluation.features.pt.facts?.triangles} triangles (counted), the body ${m10.evaluation.bodies.pin.solid.triangles.length / 3} triangles, ${m10ms.toFixed(0)} ms`);
    const plate = newEngine();
    const points: [string, number, number][] = Array.from({ length: 8 }, (_, i) => [`p${i}`, -42 + 12 * i, 0]);
    run(plate, box('plate', -50, -10, 50, 10, 0, 10), hole('h', points, 6.8, 'plate'));
    const [eight, eightMs] = timed(() => run(plate, thread('t', { body: 'plate', faces: points.map(([p]) => bore('h', p)), modelled: true, diameter: 8, pitch: 1.25, hand: 'right', direction: 'backward' })));
    expect(statusOf(eight, 't')).toBe('ok');
    rows.push(`eight M8x1.25 through 10: tools ${eight.evaluation.features.t.facts?.triangles} triangles, ${eightMs.toFixed(0)} ms`);
    const lid = newEngine();
    run(lid, box('cap', -25, -25, 25, 25, 0, 20), blindHole('s', 0, 0, 40 - 2.5 + 0.6, 0, 15, 'cap'));
    const [lidState, lidMs] = timed(() => run(lid, thread('lt', { body: 'cap', faces: [bore('s', 'p')], modelled: true, diameter: 40, pitch: 4, flankAngle: Math.PI / 2, starts: 2, clearance: 0.3, hand: 'right', direction: 'forward' })));
    expect(statusOf(lidState, 'lt')).toBe('ok');
    rows.push(`lid 40 x 4, two starts, 90°, 15 deep: tool ${lidState.evaluation.features.lt.facts?.triangles} triangles, ${lidMs.toFixed(0)} ms`);
    // a screw in a nut, each modelled, at the default tolerance 0.01: the clearance of the nut
    for (const clearance of [0.2, 0.02]) {
      const pair = newEngine();
      run(pair, rod('stud', 0, 0, 5, 0, 20), box('nut', -10, -10, 10, 10, 8, 16), hole('nh', [['h', 0, 0]], 10 - 2 * 0.811899 + 2 * clearance, 'nut'), thread('st', { body: 'stud', faces: [rodSide('stud')], modelled: true, ...M10, length: 14 }), thread('nt', { body: 'nut', faces: [bore('nh', 'h')], modelled: true, ...M10, clearance, phase: (2 * Math.PI * 4) / 1.5 }));
      const [report, ms] = timed(() => interference(pair, ['stud', 'nut']));
      rows.push(`an M10 screw in a nut with the clearance ${clearance}: ${report.pairs.length} collisions, ${report.fits.length} fits, ${ms.toFixed(0)} ms`);
      expect(report).toMatchObject({ pairs: [], fits: [], failed: [] });
    }
    console.log(rows.join('\n'));
  });
});
