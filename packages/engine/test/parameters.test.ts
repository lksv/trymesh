// Parameters, checks and expressions in numeric fields at the document level (no recompute).
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Document, ExtrudeFeature, Feature, Input, PlaneRef, SketchFeature } from '../src/types';
import { CommandError, FEATURE_TYPE_INFO, applyCommand, emptyDocument, emptySketch, featureInput, fieldsOf, validateDocument } from '../src/document';
import { CONSTRAINTS } from '../src/catalog';

type DistanceExtent = Extract<ExtrudeFeature['extent'], { type: 'distance' }>;
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const feature = <F extends Feature>(doc: Document, id: string): F => doc.features.find((f) => f.id === id) as F;
const param = (name: string, expr: string, index?: number): Command => ({ type: 'setParameter', name, expr, ...(index === undefined ? {} : { index }) });
const extrude = (id: string, extent: Input<ExtrudeFeature['extent']>, extra: object = {}): Input<ExtrudeFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] },
  extent,
  operation: 'new',
  ...extra,
});
const rejected = (doc: Document, command: Command): CommandError => {
  try {
    applyCommand(doc, command);
  } catch (error) {
    if (error instanceof CommandError) return error;
    throw error;
  }
  throw new Error('the command should have been rejected');
};

// Parameters h = 12 and d = 8, a sketch with the circle `c` and the line `l`.
function base(): Document {
  return run(
    emptyDocument(),
    param('h', '12'),
    param('d', '2 * 4'),
    { type: 'addFeature', feature: emptySketch('S1', 'Sketch', XY) },
    { type: 'addPoint', sketch: 'S1', id: 'p1', x: 0, y: 0 },
    { type: 'addPoint', sketch: 'S1', id: 'p2', x: 30, y: 1 },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 5 },
    { type: 'addCurve', sketch: 'S1', id: 'l', curve: { type: 'line', a: 'p1', b: 'p2' } },
  );
}

describe('parameters and checks', () => {
  it('create, change, order, rename and remove', () => {
    let doc = run(emptyDocument(), param('a', '1'), param('b', 'a + 1'), param('c', '3', 0));
    expect(doc.parameters.map((p) => p.name)).toEqual(['c', 'a', 'b']);
    doc = run(doc, param('a', ' 5 '));
    expect(doc.parameters).toEqual([
      { name: 'c', expr: '3' },
      { name: 'a', expr: '5' },
      { name: 'b', expr: 'a + 1' },
    ]);
    doc = run(doc, param('a', '6', 2));
    expect(doc.parameters.map((p) => p.name)).toEqual(['c', 'b', 'a']);
    // an unknown name and a cycle are accepted: the state shows up in the recompute result
    doc = run(doc, param('Zr', 'Zs + 2 * Zp'), param('x', 'y'), param('y', 'x'));
    doc = run(doc, { type: 'removeParameter', name: 'x' }, { type: 'removeParameter', name: 'y' });
    expect(doc.parameters.map((p) => p.name)).toEqual(['c', 'b', 'a', 'Zr']);
    expect(() => applyCommand(doc, { type: 'removeParameter', name: 'x' })).toThrow(/is not in the document/);
    expect(() => applyCommand(doc, param('a', '1', 9))).toThrow(/mimo rozsah/);
  });

  it('only a syntax error and a disallowed name make the command invalid', () => {
    const doc = emptyDocument();
    expect(rejected(doc, param('a', '1 +')).expression).toEqual({ parameter: 'a', error: { code: 'syntax', message: 'the expression is incomplete', position: 3 } });
    expect(rejected(doc, param('a', '1 < 2')).expression).toMatchObject({ parameter: 'a', error: { code: 'type' } });
    expect(() => applyCommand(doc, param('pi', '3'))).toThrow(/name of a constant/);
    expect(() => applyCommand(doc, param('2a', '3'))).toThrow(/a parameter name may contain/);
    expect(() => applyCommand(doc, param('toString', '3'))).toThrow(/is not allowed/);
    expect(rejected(doc, { type: 'setCheck', name: 'k', expr: '1 + 1' }).expression).toMatchObject({ check: 'k', error: { code: 'type' } });
    expect(() => applyCommand(doc, { type: 'setCheck', name: ' k', expr: '1 < 2' })).toThrow(/is not allowed/);
    expect(() => applyCommand(doc, { type: 'setCheck', name: '', expr: '1 < 2' })).toThrow(/is not allowed/);
  });

  it('renaming a parameter rewrites expressions of parameters, checks and fields', () => {
    let doc = run(base(), { type: 'setCheck', name: 'tall enough', expr: 'h > d' }, { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 'h + d' }) }, param('double', 'h * 2'));
    const sketch = feature(doc, 'S1');
    doc = run(doc, { type: 'renameParameter', name: 'h', to: 'height' });
    expect(doc.parameters).toEqual([
      { name: 'height', expr: '12' },
      { name: 'd', expr: '2 * 4' },
      { name: 'double', expr: 'height * 2' },
    ]);
    expect(doc.checks).toEqual([{ name: 'tall enough', expr: 'height > d' }]);
    expect(feature<ExtrudeFeature>(doc, 'E1').expressions).toEqual({ 'extent/distance': 'height + d' });
    expect(feature(doc, 'S1')).toBe(sketch); // a feature without an affected expression does not change
    expect(() => applyCommand(doc, { type: 'renameParameter', name: 'height', to: 'd' })).toThrow(/is already in the document/);
    expect(() => applyCommand(doc, { type: 'renameParameter', name: 'h', to: 'x' })).toThrow(/is not in the document/);
    expect(applyCommand(doc, { type: 'renameParameter', name: 'd', to: 'd' })).toBe(doc);
  });

  it('checks: create, order, rename, remove', () => {
    let doc = run(emptyDocument(), { type: 'setCheck', name: 'gears fit', expr: 'a < b' }, { type: 'setCheck', name: 'divisible by three', expr: 'Zs % 3 == 0', index: 0 });
    expect(doc.checks.map((c) => c.name)).toEqual(['divisible by three', 'gears fit']);
    doc = run(doc, { type: 'renameCheck', name: 'gears fit', to: 'fits' }, { type: 'setCheck', name: 'fits', expr: 'a <= b' });
    expect(doc.checks[1]).toEqual({ name: 'fits', expr: 'a <= b' });
    expect(() => applyCommand(doc, { type: 'renameCheck', name: 'fits', to: 'divisible by three' })).toThrow(/is already in the document/);
    doc = run(doc, { type: 'removeCheck', name: 'fits' });
    expect(doc.checks).toHaveLength(1);
  });
});

describe('expression in a numeric field', () => {
  it('a command with an expression evaluates it, fills in the number and stores the expression', () => {
    const doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: '-h / 2', distance: 'h' }) }, { type: 'addFeature', feature: { id: 'P1', name: 'P1', suppressed: false, type: 'plane', base: XY, offset: ' d + 1 ' } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { type: 'distance', start: -6, distance: 12 }, expressions: { 'extent/distance': 'h', 'extent/start': '-h / 2' } });
    expect(feature(doc, 'P1')).toMatchObject({ offset: 9, expressions: { offset: 'd + 1' } });
    expect(Object.keys(feature(doc, 'E1')).at(-1)).toBe('expressions');
    // a document with expressions passes validation unchanged
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(JSON.stringify(validateDocument(JSON.parse(JSON.stringify(doc))))).toBe(JSON.stringify(doc));
  });

  it('an expression that cannot be evaluated or is out of range is an invalid command with a structured error', () => {
    const doc = base();
    const add = (extent: Input<ExtrudeFeature['extent']>): Command => ({ type: 'addFeature', feature: extrude('E1', extent) });
    expect(rejected(doc, add({ type: 'distance', start: 0, distance: 'h - 12' })).expression).toMatchObject({ path: 'extent/distance', error: { code: 'outOfRange' } });
    expect(rejected(doc, add({ type: 'distance', start: 0, distance: 'height' })).expression).toMatchObject({ path: 'extent/distance', error: { code: 'unknownName', position: 0 } });
    expect(rejected(doc, add({ type: 'distance', start: 'h *', distance: 5 })).expression).toMatchObject({ path: 'extent/start', error: { code: 'syntax' } });
    expect(rejected(doc, add({ type: 'distance', start: '1 / (h - 12)', distance: 5 })).expression).toMatchObject({ path: 'extent/start', error: { code: 'notFinite' } });
    // a string outside numeric fields is not an expression
    expect(() => applyCommand(doc, { type: 'addPoint', sketch: 'S1', id: 'p9', x: 'h' as never, y: 0 })).toThrow(/konečné číslo/);
    expect(() => applyCommand(doc, { type: 'addCurve', sketch: 'S1', id: 'c9', curve: { type: 'circle', center: 'p1' }, radius: 'h' as never })).toThrow(/konečné číslo/);
  });

  it('a feature in the document form (a number and the expression map) is evaluated when created; both at once is an error', () => {
    const doc = base();
    const stored = { ...extrude('E1', { type: 'distance', start: 0, distance: 99 }), expressions: { 'extent/distance': 'h' } };
    expect(feature<ExtrudeFeature>(run(doc, { type: 'addFeature', feature: stored }), 'E1')).toMatchObject({ extent: { distance: 12 }, expressions: { 'extent/distance': 'h' } });
    const both = { ...extrude('E1', { type: 'distance', start: 0, distance: 'h' }), expressions: { 'extent/distance': 'h' } };
    expect(() => applyCommand(doc, { type: 'addFeature', feature: both })).toThrow(/both in the field and in expressions/);
    const unknown = { ...extrude('E1', { type: 'distance', start: 0, distance: 5 }), expressions: { 'extent/depth': 'h' } };
    expect(() => applyCommand(doc, { type: 'addFeature', feature: unknown })).toThrow(/is not a numeric field/);
    const broken = { ...extrude('E1', { type: 'distance', start: 0, distance: 5 }), expressions: { 'extent/distance': 'nothing' } };
    expect(rejected(doc, { type: 'addFeature', feature: broken }).expression).toMatchObject({ path: 'extent/distance', error: { code: 'unknownName' } });
  });

  it('updateFeature: a number removes the expression, a string sets one, other fields keep theirs', () => {
    let doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 'd', distance: 'h' }) });
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 20 } } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { start: 8, distance: 20 }, expressions: { 'extent/start': 'd' } });
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 'h * 2' }, operation: 'new' } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { start: 8, distance: 24 }, expressions: { 'extent/distance': 'h * 2', 'extent/start': 'd' } });
    // a whole variant with numbers removes both expressions
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { type: 'distance', start: 1, distance: 2 } } });
    expect(feature<ExtrudeFeature>(doc, 'E1').expressions).toBeUndefined();
    expect(rejected(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 'h - 12' } } }).expression).toMatchObject({ path: 'extent/distance', error: { code: 'outOfRange' } });
    expect(() => applyCommand(doc, { type: 'updateFeature', id: 'E1', patch: { expressions: { 'extent/start': 'h' } } as never })).toThrow(/takové pole nemá/);
  });

  it('changing another field does not trip over an expression that stopped being valid meanwhile', () => {
    let doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 'h' }) }, { type: 'removeParameter', name: 'h' });
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { start: 3 } } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { start: 3, distance: 12 }, expressions: { 'extent/distance': 'h' } });
    doc = run(doc, { type: 'setField', feature: 'E1', path: 'extent/start', value: 'd' });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { start: 8, distance: 12 }, expressions: { 'extent/distance': 'h', 'extent/start': 'd' } });
  });

  it('a repeated expression that stopped evaluating does not block a change of another field', () => {
    // both fields have an expression; the parameter of one of them is removed
    let doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 'd', distance: 'h' }) }, { type: 'removeParameter', name: 'h' });
    const input = featureInput(feature<ExtrudeFeature>(doc, 'E1'));
    expect(input.extent).toEqual({ type: 'distance', start: 'd', distance: 'h' });
    // a form sends the whole feature: the broken `h` is repeated, the start is fixed to a number
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { profile: input.profile, extent: { ...(input.extent as Input<DistanceExtent>), start: 2 }, operation: 'new' } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { start: 2, distance: 12 }, expressions: { 'extent/distance': 'h' } });
    // repeated with different spacing is still the same expression
    doc = run(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: ' h ' } } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { distance: 12 }, expressions: { 'extent/distance': 'h' } });
    // a different expression that cannot be evaluated is still rejected, and so is the single-field command
    expect(rejected(doc, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 'h + 1' } } }).expression).toMatchObject({ path: 'extent/distance', error: { code: 'unknownName' } });
    expect(rejected(doc, { type: 'setField', feature: 'E1', path: 'extent/distance', value: 'h' }).expression).toMatchObject({ error: { code: 'unknownName' } });
    // a repeated expression that evaluates keeps its stored number until the recompute
    doc = run(doc, { type: 'setParameter', name: 'h', expr: '20' }, { type: 'updateFeature', id: 'E1', patch: { extent: { distance: 'h' } } });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { distance: 12 }, expressions: { 'extent/distance': 'h' } });
  });

  it('a form that sends the whole feature starts from the input form', () => {
    const doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 'h' }) });
    const stored = feature<ExtrudeFeature>(doc, 'E1');
    const input = featureInput(stored);
    expect(input).toEqual(extrude('E1', { type: 'distance', start: 0, distance: 'h' }));
    expect(input).not.toHaveProperty('expressions');
    // changing the operation with the whole input form keeps the expression; numbers from the document would remove it
    const kept = run(doc, { type: 'updateFeature', id: 'E1', patch: { profile: input.profile, extent: input.extent, operation: 'new' } });
    expect(feature<ExtrudeFeature>(kept, 'E1')).toEqual(stored);
    const lost = run(doc, { type: 'updateFeature', id: 'E1', patch: { profile: stored.profile, extent: stored.extent, operation: 'new' } });
    expect(feature<ExtrudeFeature>(lost, 'E1').expressions).toBeUndefined();
    // creating from the input form gives the same feature
    const again = run(run(doc, { type: 'removeFeature', id: 'E1' }), { type: 'addFeature', feature: input });
    expect(feature(again, 'E1')).toEqual(stored);
  });

  it('setField: a number, an expression, an unknown address', () => {
    let doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 5 }) });
    doc = run(doc, { type: 'setField', feature: 'E1', path: 'extent/distance', value: 'h / 2' });
    expect(feature<ExtrudeFeature>(doc, 'E1')).toMatchObject({ extent: { distance: 6 }, expressions: { 'extent/distance': 'h / 2' } });
    doc = run(doc, { type: 'setField', feature: 'E1', path: 'extent/distance', value: 7 });
    expect(feature<ExtrudeFeature>(doc, 'E1').extent).toMatchObject({ distance: 7 });
    expect(feature<ExtrudeFeature>(doc, 'E1').expressions).toBeUndefined();
    expect(() => applyCommand(doc, { type: 'setField', feature: 'E1', path: 'extent/depth', value: 1 })).toThrow(/is not a numeric field/);
    expect(() => applyCommand(doc, { type: 'setField', feature: 'E1', path: 'operation', value: 1 })).toThrow(/is not a numeric field/);
    expect(() => applyCommand(doc, { type: 'setField', feature: 'E1', path: 'extent/distance', value: 0 })).toThrow(/must not be zero/);
    expect(() => applyCommand(doc, { type: 'setField', feature: 'E1', path: 'extent/distance', value: true as never })).toThrow(/a number or an expression is expected/);
    expect(() => applyCommand(doc, { type: 'setField', feature: 'S1', path: 'points/p1/x', value: 1 })).toThrow(/is not a numeric field/);
  });
});

describe('expression in a dimension', () => {
  const dim = (id: string, shape: object, value: number | string, driving = true): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint: { ...shape, value, driving } as Input<Constraint> });
  const sketch = (doc: Document): SketchFeature => feature<SketchFeature>(doc, 'S1');

  it('a dimension with an expression, changing the value and switching to reference', () => {
    let doc = run(base(), dim('dc', { type: 'diameter', curve: 'c' }, 'd'), dim('len', { type: 'distance', a: 'p1', b: 'p2' }, 30));
    expect(sketch(doc).constraints.dc).toEqual({ type: 'diameter', curve: 'c', value: 8, driving: true });
    expect(sketch(doc).expressions).toEqual({ 'constraints/dc/value': 'd' });
    expect(Object.keys(sketch(doc)).at(-1)).toBe('expressions');
    // without a value the expression does not change
    doc = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', driving: true });
    expect(sketch(doc).expressions).toEqual({ 'constraints/dc/value': 'd' });
    // a number removes the expression, a string sets one
    doc = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', value: 10 });
    expect(sketch(doc).expressions).toBeUndefined();
    doc = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', value: 'd + h' }, { type: 'setConstraintValue', sketch: 'S1', id: 'len', value: 'h * 3' });
    expect(sketch(doc).constraints.dc).toMatchObject({ value: 20 });
    expect(sketch(doc).expressions).toEqual({ 'constraints/dc/value': 'd + h', 'constraints/len/value': 'h * 3' });
    // setField does the same
    doc = run(doc, { type: 'setField', feature: 'S1', path: 'constraints/len/value', value: 'h' });
    expect(sketch(doc).constraints.len).toMatchObject({ value: 12 });
    // a reference dimension loses its expression and cannot be given one
    doc = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', driving: false });
    expect(sketch(doc).expressions).toEqual({ 'constraints/len/value': 'h' });
    expect(() => applyCommand(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', value: 'd' })).toThrow(/a reference dimension cannot have an expression/);
    expect(() => applyCommand(doc, dim('ref', { type: 'radius', curve: 'c' }, 'd', false))).toThrow(/a reference dimension cannot have an expression/);
    expect(() => applyCommand(doc, { type: 'setField', feature: 'S1', path: 'constraints/dc/value', value: 3 })).toThrow(/is not a numeric field/);
    // back to driving with an expression in one command
    doc = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'dc', value: 'd', driving: true });
    expect(sketch(doc).expressions).toEqual({ 'constraints/dc/value': 'd', 'constraints/len/value': 'h' });
  });

  it('the value of the expression follows the range of the dimension', () => {
    const doc = base();
    expect(rejected(doc, dim('dc', { type: 'diameter', curve: 'c' }, 'd - 8')).expression).toMatchObject({ path: 'constraints/dc/value', error: { code: 'outOfRange' } });
    expect(rejected(doc, dim('dc', { type: 'diameter', curve: 'c' }, '-d')).expression).toMatchObject({ error: { code: 'outOfRange' } });
  });

  it('removing a constraint and the cascade from removing entities drop the expression', () => {
    let doc = run(base(), dim('dc', { type: 'diameter', curve: 'c' }, 'd'), dim('len', { type: 'distance', a: 'p1', b: 'p2' }, 'h'));
    expect(sketch(run(doc, { type: 'removeConstraint', sketch: 'S1', id: 'dc' })).expressions).toEqual({ 'constraints/len/value': 'h' });
    expect(sketch(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'c' })).expressions).toEqual({ 'constraints/len/value': 'h' });
    doc = run(doc, { type: 'removeEntity', sketch: 'S1', id: 'p2' });
    expect(sketch(doc).expressions).toEqual({ 'constraints/dc/value': 'd' });
    doc = run(doc, { type: 'removeEntity', sketch: 'S1', id: 'p1' });
    expect(sketch(doc)).not.toHaveProperty('expressions');
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('a document with an expression on a reference dimension or a removed constraint is invalid', () => {
    const doc = run(base(), dim('dc', { type: 'diameter', curve: 'c' }, 'd'), dim('ref', { type: 'radius', curve: 'c' }, 4, false));
    const bad = (change: (d: any) => void, pattern: RegExp) => {
      const copy = JSON.parse(JSON.stringify(doc));
      change(copy);
      expect(() => validateDocument(copy)).toThrow(pattern);
    };
    bad((d) => (d.features[0].expressions['constraints/ref/value'] = 'd'), /is not a numeric field/);
    bad((d) => (d.features[0].expressions['constraints/gone/value'] = 'd'), /is not a numeric field/);
    bad((d) => (d.features[0].expressions['constraints/dc/value'] = 5), /čeká se řetězec/);
    bad((d) => (d.features[0].constraints.dc.value = 'd'), /an expression belongs in expressions/);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe('catalog of numeric fields', () => {
  it('fieldsOf returns driving inputs with description, value and expression', () => {
    const doc = run(
      base(),
      { type: 'addConstraint', sketch: 'S1', id: 'dc', constraint: { type: 'diameter', curve: 'c', value: 'd', driving: true } },
      { type: 'addConstraint', sketch: 'S1', id: 'ref', constraint: { type: 'radius', curve: 'c', value: 4, driving: false } },
      { type: 'addConstraint', sketch: 'S1', id: 'hor', constraint: { type: 'horizontal', line: 'l' } },
      { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 'h' }) },
      { type: 'addFeature', feature: { id: 'P1', name: 'P1', suppressed: false, type: 'plane', base: XY, offset: 3 } },
    );
    expect(fieldsOf(feature(doc, 'S1'))).toEqual([{ path: 'constraints/dc/value', spec: CONSTRAINTS.diameter.values?.value, value: 8, expr: 'd' }]);
    expect(fieldsOf(feature(doc, 'E1')).map(({ path, value, expr }) => ({ path, value, expr }))).toEqual([
      { path: 'extent/start', value: 0, expr: undefined },
      { path: 'extent/distance', value: 12, expr: 'h' },
    ]);
    expect(fieldsOf(feature(doc, 'P1'))).toMatchObject([{ path: 'offset', value: 3, spec: { unit: 'mm' } }]);
    expect(fieldsOf(feature(doc, 'E1'))).toBe(fieldsOf(feature(doc, 'E1'))); // pamatuje se podle feature
  });

  it('the static field description matches what validation reads', () => {
    expect(FEATURE_TYPE_INFO.plane.fields.map((f) => f.path)).toEqual(['offset']);
    expect(FEATURE_TYPE_INFO.extrude.fields.map((f) => f.path)).toEqual(['extent/start', 'extent/distance']);
    expect(FEATURE_TYPE_INFO.sketch.fields).toEqual([]);
    const doc = run(base(), { type: 'addFeature', feature: extrude('E1', { type: 'distance', start: 0, distance: 5 }) }, { type: 'addFeature', feature: { id: 'P1', name: 'P1', suppressed: false, type: 'plane', base: XY, offset: 3 } });
    for (const id of ['E1', 'P1']) {
      const f = feature(doc, id);
      const listed = FEATURE_TYPE_INFO[f.type].fields;
      expect(fieldsOf(f).map((field) => [field.path, field.spec])).toEqual(listed.map((field) => [field.path, field.spec]));
    }
    // dimensions: exactly the constraints with the dimension flag have the value `value`
    for (const spec of Object.values(CONSTRAINTS)) expect(Boolean(spec.dimension)).toBe(spec.values?.value !== undefined);
  });
});
