// D56 at the document level (no recompute): the feature types `combine` and `split`, the role
// `splitFace`, the copy tag of a combine, and the box a split is made of.
import { describe, expect, it } from 'vitest';
import type { Command, CombineFeature, Document, ExtrudeFeature, FaceName, Feature, FeaturePatch, Input, PlaneRef, SplitFeature } from '../src/types';
import { applyCommand, emptyDocument, emptySketch, featureInput, featureRefs, fieldsOf, validateDocument } from '../src/document';
import { FEATURE_TYPE_INFO, bodyProblem, bodySource } from '../src/features/index';
import { halfSpaceBox } from '../src/recompute/body-boolean';
import { volumeOf } from '../src/solid';
import { faceKey } from '../src/util';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const extrude = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] },
  extent: { type: 'distance', start: 0, distance: 10 },
  operation: 'new',
  ...extra,
});
const combine = (id: string, extra: Partial<Input<CombineFeature>> = {}): Input<CombineFeature> => ({ id, name: id, suppressed: false, type: 'combine', operation: 'difference', target: 'A', tools: ['B'], keepTools: true, ...extra });
const split = (id: string, extra: Partial<Input<SplitFeature>> = {}): Input<SplitFeature> => ({ id, name: id, suppressed: false, type: 'split', body: 'A', plane: XY, side: 'backward', ...extra });
const add = (feature: Input<ExtrudeFeature> | Input<CombineFeature> | Input<SplitFeature>, index?: number): Command => ({ type: 'addFeature', feature, ...(index === undefined ? {} : { index }) });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
const featureOf = <F extends Feature = Feature>(doc: Document, id: string): F => doc.features.find((f) => f.id === id) as F;

// A sketch with a circle, the parameter `fit`, the bodies A, B and C (C a cut, no body).
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 'fit', expr: '0.3' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    add(extrude('A')),
    add(extrude('B')),
    add(extrude('C', { operation: 'cut', targets: ['A'] })),
  );
}

describe('the feature combine (D56)', () => {
  it('a boolean of finished bodies; the registry describes it and its references', () => {
    const doc = run(base(), add(combine('K', { tools: ['B'], clearance: 'fit' })));
    expect(featureOf(doc, 'K')).toEqual({ ...combine('K'), clearance: 0.3, expressions: { clearance: 'fit' } });
    expect(featureRefs(featureOf(doc, 'K'))).toEqual(['A', 'B']);
    expect(FEATURE_TYPE_INFO.combine).toMatchObject({ title: 'Combine', bodies: 'none', updatable: ['operation', 'target', 'tools', 'keepTools', 'clearance'] });
    expect(FEATURE_TYPE_INFO.combine.fields).toEqual([{ path: 'clearance', spec: { title: 'Clearance', unit: 'mm', min: { value: 0 }, default: 0 }, when: { path: 'operation', equals: 'difference' } }]);
    expect(fieldsOf(featureOf(doc, 'K')).map((f) => [f.path, f.value, f.expr])).toEqual([['clearance', 0.3, 'fit']]);
    expect(featureInput(featureOf(doc, 'K'))).toEqual({ ...combine('K'), clearance: 'fit' });
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // a combine creates no body and leaves no tool a pattern could repeat
    expect(bodyProblem(doc, 'K')).toMatch(/does not create a body "K"/);
    invalid(doc, add({ id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'features', features: ['K'] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } as never), /not a feature that applies a tool/);
  });

  it('what the command refuses', () => {
    const doc = base();
    invalid(doc, add(combine('K', { operation: 'union', clearance: 0.3 })), /only a difference has a clearance/);
    invalid(doc, add(combine('K', { clearance: -0.1 })), /clearance/);
    invalid(doc, add(combine('K', { tools: ['A'] })), /is not its own tool/);
    invalid(doc, add(combine('K', { tools: ['B', 'B'] })), /listed twice/);
    invalid(doc, add(combine('K', { tools: [] })), /non-empty list/);
    invalid(doc, add(combine('K', { tools: ['C'] })), /není těleso/); // a cut creates no body
    invalid(doc, add(combine('K', { target: 'X' })), /neexistuje/);
    invalid(doc, add(combine('K', { operation: 'xor' as never })), /operation/);
    invalid(doc, add({ ...combine('K'), keepTools: undefined } as never), /keepTools: say whether/);
    // a body is one a feature before this one creates
    invalid(doc, add(combine('K'), 1), /musí ležet před/);
  });

  it('the clearance is an optional field: setField reaches it while absent, null removes it, another operation drops it', () => {
    const doc = run(base(), add(combine('K')));
    expect(featureOf<CombineFeature>(doc, 'K').clearance).toBeUndefined();
    const set = run(doc, { type: 'setField', feature: 'K', path: 'clearance', value: 'fit' });
    expect(featureOf(set, 'K')).toMatchObject({ clearance: 0.3, expressions: { clearance: 'fit' } });
    expect(featureOf<CombineFeature>(run(doc, { type: 'setField', feature: 'K', path: 'clearance', value: 0 }), 'K').clearance).toBe(0);
    const removed = run(set, update('K', { clearance: null }));
    expect(featureOf(removed, 'K')).toEqual(combine('K'));
    expect(featureOf(run(doc, update('K', { clearance: null })), 'K')).toEqual(combine('K')); // also where there is none
    const union = run(set, update('K', { operation: 'union' }));
    expect(featureOf(union, 'K')).toEqual(combine('K', { operation: 'union' }));
    invalid(union, { type: 'setField', feature: 'K', path: 'clearance', value: 0.3 }, /is not a numeric field/);
    invalid(doc, update('K', { tools: ['A'] }), /is not its own tool/);
    expect(featureOf(run(doc, update('K', { tools: ['B'], keepTools: false })), 'K')).toEqual(combine('K', { keepTools: false }));
  });
});

describe('the feature split (D56)', () => {
  it('a body by a plane; the new body has the ID of the feature and takes after the body', () => {
    const doc = run(base(), add(split('L')));
    expect(featureOf(doc, 'L')).toEqual(split('L'));
    expect(featureRefs(featureOf(doc, 'L'))).toEqual(['A']);
    expect(FEATURE_TYPE_INFO.split).toMatchObject({ title: 'Split', bodies: 'self', fields: [], updatable: ['body', 'plane', 'side'] });
    expect(bodyProblem(doc, 'L')).toBeUndefined();
    expect(bodyProblem(doc, 'L/1')).toMatch(/does not create a body/);
    expect(bodySource(doc, 'L')).toBe('A');
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // the new body can be a target, a pattern source, named by body properties
    const later = run(doc, add(combine('K', { target: 'L', tools: ['B'] })), { type: 'setBodyProperties', body: 'L', patch: { name: 'Lower shell' } });
    expect(later.bodyProperties.L).toEqual({ name: 'Lower shell' });
  });

  it('what the command refuses', () => {
    const doc = base();
    invalid(doc, add(split('L', { side: 'both' as never })), /side/);
    invalid(doc, add(split('L', { plane: 'P' as never })), /plane/);
    invalid(doc, add(split('L', { body: 'C' })), /není těleso/);
    invalid(doc, add(split('L', { plane: { kind: 'plane', feature: 'X' } })), /neexistuje/);
  });

  it('the cut face is a role of its own; a copy tag of a combine names a difference before it', () => {
    const cut: FaceName = { feature: 'L', role: 'splitFace' };
    expect(faceKey(cut)).toBe('L/splitFace');
    const doc = run(base(), add(split('L')), add(combine('K', { tools: ['B'] })), add(combine('U', { operation: 'union', tools: ['B'] })));
    const onCut = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'S2', { kind: 'face', body: 'L', face: cut }) });
    expect(featureRefs(featureOf(onCut, 'S2'))).toEqual(['L']);
    const tagged: FaceName = { feature: 'B', role: 'endCap', copy: [{ pattern: 'K', index: 1 }] };
    expect(() => run(doc, { type: 'addFeature', feature: emptySketch('S3', 'S3', { kind: 'face', body: 'A', face: tagged }) })).not.toThrow();
    // a union tags nothing, nor does a feature after the reference
    invalid(doc, { type: 'addFeature', feature: emptySketch('S3', 'S3', { kind: 'face', body: 'A', face: { ...tagged, copy: [{ pattern: 'U', index: 1 }] } }) }, /a pattern, or a combine as a difference/);
  });

  it('the box of a split: one face in the plane numbered first, five outside the body', () => {
    const body = { positions: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10]), triangles: Uint32Array.from([0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]), faceIds: new Uint32Array(12) };
    const plane = { origin: [0, 0, 4] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    const forward = halfSpaceBox(body, plane, 'forward', 7) as NonNullable<ReturnType<typeof halfSpaceBox>>;
    const backward = halfSpaceBox(body, plane, 'backward', 7) as NonNullable<ReturnType<typeof halfSpaceBox>>;
    // margin max(1, 5 % of the diagonal of the body in the frame)
    expect(volumeOf(forward)).toBeCloseTo(12 * 12 * 7, 4);
    expect(volumeOf(backward)).toBeCloseTo(12 * 12 * 5, 4);
    expect([...new Set(forward.faceIds)]).toEqual([7, 8, 9, 10, 11, 12]);
    // the face numbered first lies in the plane
    for (let t = 0; t < 12; t++) if (forward.faceIds[t] === 7) for (let k = 0; k < 3; k++) expect(forward.positions[3 * forward.triangles[3 * t + k] + 2]).toBe(4);
    expect(halfSpaceBox(body, { ...plane, origin: [0, 0, 10] }, 'forward', 7)).toBeUndefined();
    expect(halfSpaceBox(body, { ...plane, origin: [0, 0, -1] }, 'backward', 7)).toBeUndefined();
  });
});
