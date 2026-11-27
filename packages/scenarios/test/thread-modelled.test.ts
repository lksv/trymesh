// Modelled threads (D76, stage 2) against the real adapters: the tool cut into a pin and a bore,
// the faces left and the faces gone at every kind of end, a refused cut, what stands in the way,
// two tools that cross, the face `general` through its consumers, a pin with a clearance, the
// notes of an export and the parts list. A screw in a nut, the seat and the measurements of
// "Performance" are in thread-mate.test.ts.
import { createPakoDeflater } from '@trymesh/deflate-pako';
import { type Command, type EngineState, type FaceName, type Id, type SolidKernel, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { newEngine, run } from './kit';
import { M10, blindHole, bodyPattern, bore, box, chamfer, combine, hole, messageOf, mirrorIn, preview, rod, rodSide, statusOf, thread, threadsOf, top } from './thread-kit';

const names = (state: EngineState, body: Id): string[] => [...new Set(state.evaluation.bodies[body].faces.map((f) => { const n = state.evaluation.faceNames[f.id]; return `${n.feature}/${n.role}${n.role === 'threadFlank' ? `/${n.side}` : ''}${'end' in n ? `/${n.end}` : ''}`; }))].sort();
const surfaceOf = (state: EngineState, body: Id, name: Partial<FaceName>) => {
  const face = state.evaluation.bodies[body].faces.find((f) => Object.entries(name).every(([k, v]) => (state.evaluation.faceNames[f.id] as Record<string, unknown>)[k] === v));
  return face === undefined ? undefined : state.evaluation.faceSurfaces[face.id];
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
