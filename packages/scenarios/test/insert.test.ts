// Inserting another document as a part (D62) against the real adapters: the recompute of a stored
// document through the state, the faces and bodies it brings, what they inherit, the warning of an
// insertion, features on an inserted body, and the cases "To verify" of the design
// (docs/d36/3c-document-insert/design.md). The scenario is in the part of 3c of scenario 13.
import { type Command, type Document, type Engine, type EngineState, type FaceName, type Id, emptySketch, faceKey, importMesh } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Evaluator } from '../../engine/src/evaluate';
import { validateDocument } from '../../engine/src/document';
import { cylinder } from './arm';
import { XY, newEngine } from './kit';
import { chamfer, fillet } from './blend-kit';

const exec = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const preview = (engine: Engine, ...commands: Command[]): EngineState => {
  const result = engine.preview(commands.length === 1 ? commands[0] : { type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
};
const insertion = (id: Id, document: Id, more: object = {}): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'insert', document, placement: { frame: XY }, ...more } as never });
const parsed = (engine: Engine): Document => JSON.parse(engine.save());

// A ring of the outer radius `R` (a parameter) and the bore 4, 7 high, about the origin, as the
// part `ring`; a check that the wall is there; a reference part of 12 g.
function ringPart(extra: Command[] = []): Document {
  const shop = newEngine();
  exec(
    shop,
    { type: 'setParameter', name: 'R', expr: '11' },
    { type: 'setCheck', name: 'wall', expr: 'R > 6' },
    ...cylinder('ring', 0, 0, 11, 0, 7),
    { type: 'setConstraintValue', sketch: 'ringSketch', id: 'ringRadius', value: 'R' },
    ...cylinder('bore', 0, 0, 4, -1, 8, 'cut', 'ring'),
    { type: 'setBodyProperties', body: 'ring', patch: { name: 'Bearing', use: 'reference', mass: 12 } },
    ...extra,
  );
  return parsed(shop);
}

describe('the recompute of an insertion', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    exec(engine, { type: 'addDocument', id: 'ring', document: ringPart() });
  });

  it('two insertions with one environment share one recompute through the state; another environment is another', async () => {
    const evaluator = new Evaluator({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    const doc = (values: [Record<string, unknown>, Record<string, unknown>]): Document =>
      validateDocument({ ...parsed(engine), features: [JSON.parse(JSON.stringify((insertion('a', 'ring', values[0]) as { feature: object }).feature)), JSON.parse(JSON.stringify((insertion('b', 'ring', { ...values[1], placement: { frame: XY, x: 40 } }) as { feature: object }).feature))] });
    const same = evaluator.evaluate(doc([{ parameters: { R: 11 } }, {}])).state;
    expect(same.insertions.b.recompute).toBe(same.insertions.a.recompute);
    const other = evaluator.evaluate(doc([{ parameters: { R: 12 } }, {}])).state;
    expect(other.insertions.b.recompute).not.toBe(other.insertions.a.recompute);
    expect(other.insertions.a.environment).toBe(JSON.stringify([['R', '12']]));
  });

  // A value of a field is never −0 (a field holds no negative zero), but a stored expression may
  // give one: 0 set by an insertion against a stored −0 is another environment, against a stored 0
  // the same.
  it('0 against a stored −0 is another environment, against a stored 0 the same', async () => {
    const evaluator = new Evaluator({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    const withStored = (stored: string): Document => {
      const base = parsed(engine);
      const ring = base.documents.ring.document;
      const document = { ...ring, parameters: [...ring.parameters, { name: 'z', expr: stored }] };
      return validateDocument({ ...base, documents: { ring: { document } }, features: [{ id: 'a', name: 'a', suppressed: false, type: 'insert', document: 'ring', placement: { frame: XY }, parameters: { z: 0 } }, { id: 'b', name: 'b', suppressed: false, type: 'insert', document: 'ring', placement: { frame: XY, x: 40 } }] });
    };
    const negative = evaluator.evaluate(withStored('-0')).state;
    expect([negative.insertions.a.environment, negative.insertions.b.environment]).toEqual([JSON.stringify([['R', '11'], ['z', '0']]), JSON.stringify([['R', '11'], ['z', '-0']])]);
    expect(negative.insertions.b.recompute).not.toBe(negative.insertions.a.recompute);
    const positive = evaluator.evaluate(withStored('0')).state;
    expect(positive.insertions.b.recompute).toBe(positive.insertions.a.recompute);
  });

  it('a value set: the stored document follows it for this insertion only; its own value stays in the result of the section', () => {
    const state = preview(engine, insertion('a', 'ring', { parameters: { R: 15 } }), insertion('b', 'ring', { placement: { frame: XY, x: 40 } }));
    expect(state.evaluation.bodies['a/ring'].volume).toBeGreaterThan(state.evaluation.bodies['b/ring'].volume);
    expect(state.evaluation.documents.ring.parameters).toEqual([{ name: 'R', expr: '11', value: 11 }]);
    expect(state.evaluation.documents.ring.usedBy).toEqual(['a', 'b']);
  });

  it('the faces: one new number per face of the chosen bodies, the names prefixed, the surfaces moved', () => {
    const state = preview(engine, insertion('a', 'ring', { placement: { frame: XY, x: 100, z: 5 } }));
    const body = state.evaluation.bodies['a/ring'];
    const names = body.faces.map((face) => faceKey(state.evaluation.faceNames[face.id])).sort();
    expect(names).toEqual(['a/"bore/side/boreCircle"', 'a/"ring/endCap"', 'a/"ring/side/ringCircle"', 'a/"ring/startCap"']);
    const boreFace = body.faces.find((face) => state.evaluation.faceNames[face.id].feature === 'a/bore');
    const surface = state.evaluation.faceSurfaces[boreFace?.id as number];
    expect(surface).toMatchObject({ kind: 'cylinder', radius: 4 });
    expect(surface.kind === 'cylinder' && surface.origin.slice(0, 2)).toEqual([100, 0]);
    expect(body.bounds.min[0]).toBeCloseTo(89, 4);
    expect(body.bounds.min[2]).toBeCloseTo(5, 6);
  });

  // the axis of a round face (D60) of an inserted body: its surface moved with the placement, the
  // name compared after the lookup by key
  it('the axis of a round face of an inserted body: a pattern about it; a face it does not have', () => {
    const face = { feature: 'a/ring', role: 'side', curve: 'ringCircle' } as const;
    const pattern = (name: FaceName): Command => ({ type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'a/ring' }, transform: { type: 'circular', axis: { kind: 'face', body: 'a/ring', face: name }, count: 2, span: { type: 'full' } } } as never });
    const state = preview(engine, insertion('a', 'ring', { placement: { frame: XY, x: 100, ry: Math.PI / 2 } }), pattern(face));
    expect(state.evaluation.features.p.status).toBe('ok');
    // a turn by π about the axis of the ring, now along X through (100, 0, 0), leaves its bounds where they were
    const [one, two] = [state.evaluation.bodies['a/ring'].bounds, state.evaluation.bodies['p/1'].bounds];
    for (const i of [0, 1, 2]) {
      expect(two.min[i]).toBeCloseTo(one.min[i], 3);
      expect(two.max[i]).toBeCloseTo(one.max[i], 3);
    }
    expect(one.min[0]).toBeCloseTo(100, 3);
    // a face the inserted body does not have is the recompute's broken reference
    const missing = preview(engine, insertion('a', 'ring'), pattern({ ...face, curve: 'nope' }));
    expect(missing.evaluation.features.p.error).toMatchObject({ code: 'brokenReference' });
  });

  it('a listed body the revision lost, a document with no body, a parameter the revision lost', () => {
    // a body no feature there can make is refused by the command (the review of 3c); one the
    // revision lost is the recompute's broken reference
    const refused = engine.preview(insertion('a', 'ring', { bodies: ['ring/2'] }));
    expect(refused.ok ? undefined : refused.error.message).toMatch(/the stored document "ring" cannot make the body "ring\/2"/);
    const missing = preview(engine, insertion('a', 'ring', { bodies: ['ring'] }), { type: 'replaceDocument', id: 'ring', document: parsed(newEngine()) });
    expect(missing.evaluation.features.a).toMatchObject({ status: 'error', error: { code: 'brokenReference', refs: [{ body: 'ring' }] } });
    const empty = preview(engine, { type: 'addDocument', id: 'nothing', document: parsed(newEngine()) }, insertion('a', 'nothing'));
    expect(empty.evaluation.features.a.error).toMatchObject({ code: 'emptyResult', message: expect.stringContaining('the inserted document has no body to bring') });
    const set = exec(engine, insertion('lost', 'ring', { parameters: { R: 12 } }));
    expect(set.evaluation.features.lost.status).toBe('ok');
    const revised = preview(engine, { type: 'replaceDocument', id: 'ring', document: { ...parsed(newEngine()), parameters: [{ name: 'Q', expr: '1' }] } });
    expect(revised.evaluation.features.lost.error).toMatchObject({ code: 'brokenReference', refs: [{ parameter: 'R' }] });
    // the value stays and does not block a change of another field
    expect(preview(engine, { type: 'replaceDocument', id: 'ring', document: { ...parsed(newEngine()), parameters: [{ name: 'Q', expr: '1' }] } }, { type: 'setField', feature: 'lost', path: 'placement/x', value: 3 }).document.features.at(-1)).toMatchObject({ parameters: { R: 12 }, placement: { x: 3 } });
    engine.undo();
  });

  it('the warning: a feature in error and a failed check of the inserted document, carried up from an insertion inside it', () => {
    // a radius 3 under the bore of radius 4: the cut would take the whole ring, so the bore is in
    // error there and the ring comes in without it
    const state = preview(engine, insertion('a', 'ring', { parameters: { R: 3 } }));
    expect(state.evaluation.features.a.warnings).toEqual([expect.objectContaining({ code: 'insertedIssues', refs: [{ feature: 'a/bore', code: 'emptyResult' }, { check: 'wall' }] })]);
    expect(state.evaluation.features.a.bodies).toEqual(['a/ring']);
    const thin = preview(engine, insertion('a', 'ring', { parameters: { R: 5 } }));
    expect(thin.evaluation.features.a.warnings).toEqual([expect.objectContaining({ code: 'insertedIssues', refs: [{ check: 'wall' }] })]);
    // a kit: the ring inserted with a value that fails, plus a feature of the kit itself in error
    const kit = newEngine();
    exec(kit, { type: 'addDocument', id: 'ring', document: ringPart() }, insertion('r', 'ring', { parameters: { R: 5 } }), ...cylinder('gone', 0, 0, 30, -1, 8, 'cut', 'r/ring'));
    const outer = preview(engine, { type: 'addDocument', id: 'kit', document: parsed(kit) }, insertion('k', 'kit'));
    expect(outer.evaluation.features.k.warnings[0].refs).toEqual([{ check: 'wall', in: 'k/r' }, { feature: 'k/gone', code: 'emptyResult' }]);
    expect(outer.evaluation.features.k.bodies).toEqual(['k/r/ring']);
  });
});

describe('what an inserted body inherits, and features on it', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    exec(engine, { type: 'addDocument', id: 'ring', document: ringPart() });
  });

  it('the query body filtered by the insert: every face of the inserted document, whose names start with the insert (review of the filter)', () => {
    exec(engine, insertion('q', 'ring'));
    const whole = engine.query('body', { body: 'q/ring' });
    const filtered = engine.query('body', { body: 'q/ring', feature: 'q' });
    if (!whole.ok || !filtered.ok) throw new Error('the query failed');
    expect(filtered.result.faces.length).toBe(whole.result.faces.length);
    expect(filtered.result.faces.every((face) => face.name.feature.startsWith('q/'))).toBe(true);
    expect(filtered.result.edges.length).toBe(whole.result.edges.length);
    engine.undo();
  });

  it('a stated pair of an auxiliary body passes on: made a reference part here it weighs what its document says', () => {
    const auxiliary = ringPart([{ type: 'setBodyProperties', body: 'ring', patch: { use: 'auxiliary' } }]);
    const state = preview(engine, { type: 'addDocument', id: 'keepOut', document: auxiliary }, insertion('k', 'keepOut'), { type: 'setBodyProperties', body: 'k/ring', patch: { use: 'reference' } });
    expect(state.evaluation.bodyProperties['k/ring']).toMatchObject({ use: 'reference', mass: 12, massFrom: 'mass', fromDocument: 'keepOut' });
    // as auxiliary it has no mass
    const plain = preview(engine, { type: 'addDocument', id: 'keepOut', document: auxiliary }, insertion('k', 'keepOut'));
    expect(plain.evaluation.bodyProperties['k/ring'].use).toBe('auxiliary');
    expect(plain.evaluation.bodyProperties['k/ring'].mass).toBeUndefined();
  });

  it('a mass by a density is that density times the volume here; an entry here overrides; a pattern of the body inherits through its source', () => {
    const printed = ringPart([{ type: 'setBodyProperties', body: 'ring', patch: { use: 'part', mass: null, density: 'R / 10', color: '#112233' } }]);
    const state = preview(
      engine,
      { type: 'addDocument', id: 'printed', document: printed },
      insertion('p', 'printed', { parameters: { R: 12 } }),
      { type: 'addFeature', feature: { id: 'copies', name: 'Copies', suppressed: false, type: 'pattern', source: { type: 'body', body: 'p/ring' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 50 } } } },
      { type: 'setBodyProperties', body: 'copies/1', patch: { color: '#445566' } },
    );
    const own = state.evaluation.bodyProperties['p/ring'];
    expect(own).toMatchObject({ name: 'p / Bearing', use: 'part', density: 1.2, massFrom: 'density', color: '#112233', fromDocument: 'printed' });
    expect(own.mass).toBeCloseTo((1.2 * state.evaluation.bodies['p/ring'].volume) / 1000, 9);
    expect(state.evaluation.bodyProperties['copies/1']).toMatchObject({ name: 'Copies / 1', color: '#445566', density: 1.2, from: 'p/ring', fromDocument: 'printed' });
  });

  it('a hole into an inserted body; a sketch on its face; a body with a face of an imported mesh stays refused', () => {
    const state = preview(
      engine,
      insertion('a', 'ring', { placement: { frame: XY, x: 50 } }),
      ...cylinder('pin', 57, 0, 1, -1, 8, 'cut', 'a/ring'),
      { type: 'addFeature', feature: emptySketch('onTop', 'onTop', { kind: 'face', body: 'a/ring', face: { feature: 'a/ring', role: 'endCap' } }) },
    );
    expect(state.evaluation.features.pin.status).toBe('ok');
    expect(state.evaluation.features.onTop.plane?.origin).toEqual([50, 0, 7]);
    // a stored document that places a mesh: its body is imported wherever it comes from
    const shop = newEngine();
    exec(shop, ...cylinder('can', 0, 0, 5, 0, 5));
    const mesh = shop.exportMesh('stl', ['can']);
    const meshShop = newEngine();
    const outcome = importMesh('stl', mesh, {}, 'can.stl');
    if (!outcome.ok) throw new Error(outcome.error.message);
    exec(meshShop, { type: 'addMesh', id: 'can', mesh: outcome.mesh }, { type: 'addFeature', feature: { id: 'can', name: 'Can', suppressed: false, type: 'mesh', mesh: 'can', placement: { frame: XY } } });
    const imported = preview(engine, { type: 'addDocument', id: 'motor', document: parsed(meshShop) }, insertion('m', 'motor', { placement: { frame: XY, x: -50 } }), ...cylinder('drill', -50, 0, 1, -1, 8, 'cut', 'm/can'));
    expect(imported.evaluation.features.m.status).toBe('ok');
    expect(imported.evaluation.features.drill.error?.code).toBe('importedTarget');
  });

  it('the results of the sections of the host stay the same objects across an insertion', () => {
    const before = exec(engine, ...cylinder('plate', 0, 0, 30, -5, 0));
    const after = exec(engine, insertion('a', 'ring', { placement: { frame: XY, x: 80 } }));
    expect(after.evaluation.bodyProperties.plate).toBe(before.evaluation.bodyProperties.plate);
    engine.undo();
    engine.undo();
  });
});

describe('a name that reads like a copy of a real one is no reference to it', () => {
  let engine: Engine;
  // a ring and a copy of it by a pattern: the copy's side is `ring/side/ringCircle/@p:1`, which the
  // name with the curve `ringCircle/@p:1` keyed like until D68 quoted a text with a slash
  const real: FaceName = { feature: 'ring', role: 'side', curve: 'ringCircle', copy: [{ pattern: 'p', index: 1 }] };
  const alias: FaceName = { feature: 'ring', role: 'side', curve: 'ringCircle/@p:1' };
  const cap: FaceName = { feature: 'ring', role: 'endCap', copy: [{ pattern: 'p', index: 1 }] };
  beforeAll(() => {
    engine = newEngine();
    exec(engine, ...cylinder('ring', 0, 0, 11, 0, 7), { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'ring' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 40 } } } });
  });

  it('an edge with one aliased face projects nothing; the real one projects', () => {
    expect(faceKey(alias)).not.toBe(faceKey(real));
    const project = (a: FaceName) => preview(engine, { type: 'addFeature', feature: emptySketch('s', 's', XY) }, { type: 'addExternal', sketch: 's', id: 'rim', ref: { type: 'edge', body: 'p/1', edge: { a, b: cap }, kind: 'circle' } });
    expect(project(real).evaluation.features.s.status).toBe('ok');
    expect(project(alias).evaluation.features.s.warnings.map((w) => w.code)).toEqual(['brokenProjection']);
  });

  it('a plane on an aliased face is a broken reference; a query refuses it', () => {
    const state = preview(engine, { type: 'addFeature', feature: emptySketch('s', 's', { kind: 'face', body: 'p/1', face: { ...alias, role: 'side' } }) });
    expect(state.evaluation.features.s.error?.code).toBe('brokenReference');
    const asked = engine.query('measure', { from: { kind: 'face', body: 'p/1', face: alias }, to: { kind: 'face', body: 'p/1', face: cap } });
    expect(asked).toMatchObject({ ok: false, error: { code: 'notAvailable' } });
    expect(engine.query('measure', { from: { kind: 'face', body: 'p/1', face: real }, to: { kind: 'face', body: 'p/1', face: cap } }).ok).toBe(true);
  });
});

// Where 3c meets 4b (D63): a chamfer or a fillet on an edge of an inserted body, and an inserted
// document that holds one.
describe('chamfers and fillets of edges and inserted documents', () => {
  let engine: Engine;
  const top = (prefix: string): { a: FaceName; b: FaceName } => ({ a: { feature: `${prefix}ring`, role: 'endCap' } as FaceName, b: { feature: `${prefix}ring`, role: 'side', curve: 'ringCircle' } as FaceName });
  beforeAll(() => {
    engine = newEngine();
    exec(engine, { type: 'addDocument', id: 'ring', document: ringPart() }, { type: 'addDocument', id: 'cut', document: ringPart([chamfer('c', 'ring', [top('')], 1)]) });
  });

  it('a chamfer of the outer top edge of an inserted ring: the edge found by its prefixed faces, the volume of the cut', () => {
    const plain = preview(engine, insertion('a', 'ring'));
    const state = preview(engine, insertion('a', 'ring'), chamfer('k', 'a/ring', [top('a/')], 1));
    expect(state.evaluation.features.k.status).toBe('ok');
    // a ring of the radius 11 loses a triangle of 1 × 1 swept about the axis at the radius 11 − 1/3
    expect(plain.evaluation.bodies['a/ring'].volume - state.evaluation.bodies['a/ring'].volume).toBeCloseTo(Math.PI * (11 - 1 / 3), 0);
    expect(state.evaluation.faceNames.some((name) => name.feature === 'k' && name.role === 'chamfer')).toBe(true);
    // a fillet of the same edge
    expect(preview(engine, insertion('a', 'ring'), fillet('f', 'a/ring', [top('a/')], 1)).evaluation.features.f.status).toBe('ok');
  });

  it('an edge whose name reads like a real one is no edge of the body', () => {
    // a copy `p/1` of the ring by a pattern: its side is `{ ring, side, ringCircle, copy p:1 }`; the
    // name `{ ring, side, curve: 'ringCircle/@p:1' }`, which no feature makes, keyed like it until
    // D68 quoted a text with a slash
    const shop = newEngine();
    const doc = { ...ringPart(), features: [...ringPart().features, { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'ring' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 2, span: { type: 'spacing', spacing: 30 } } }] };
    expect(shop.load(JSON.stringify(doc)).ok).toBe(true);
    const copy = (name: object): FaceName => ({ ...name, copy: [{ pattern: 'p', index: 1 }] }) as FaceName;
    const real = { a: copy({ feature: 'ring', role: 'endCap' }), b: copy({ feature: 'ring', role: 'side', curve: 'ringCircle' }) };
    const alias = { a: real.a, b: { feature: 'ring', role: 'side', curve: 'ringCircle/@p:1' } as FaceName };
    expect(faceKey(alias.b)).not.toBe(faceKey(real.b));
    expect(preview(shop, chamfer('k', 'p/1', [real], 1)).evaluation.features.k.status).toBe('ok');
    expect(preview(shop, chamfer('k', 'p/1', [alias], 1)).evaluation.features.k.error).toMatchObject({ code: 'brokenReference' });
  });

  it('an inserted document that holds a chamfer: its face prefixed, referenced from the host as the axis of a pattern', () => {
    const state = preview(engine, insertion('a', 'cut', { placement: { frame: XY, x: 50 } }));
    expect(state.evaluation.features.a.status).toBe('ok');
    const cone: FaceName = { feature: 'a/c', role: 'chamfer', edge: 0 } as FaceName;
    expect(state.evaluation.faceNames.map((name) => faceKey(name))).toContain(faceKey(cone));
    expect(faceKey(cone)).toBe('a/"c/chamfer/0"');
    const patterned = preview(engine, insertion('a', 'cut', { placement: { frame: XY, x: 50 } }), { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'a/ring' }, transform: { type: 'circular', axis: { kind: 'face', body: 'a/ring', face: cone }, count: 2, span: { type: 'full' } } } as never });
    expect(patterned.evaluation.features.p.status).toBe('ok');
    expect(patterned.evaluation.bodies['p/1'].bounds.min[0]).toBeCloseTo(patterned.evaluation.bodies['a/ring'].bounds.min[0], 3);
    // a chamfer in the host of an edge of the inserted chamfer face
    const bottom = preview(engine, insertion('a', 'cut'), chamfer('k', 'a/ring', [{ a: { feature: 'a/ring', role: 'startCap' } as FaceName, b: { feature: 'a/ring', role: 'side', curve: 'ringCircle' } as FaceName }], 0.5));
    expect(bottom.evaluation.features.k.status).toBe('ok');
  });
});

