// Numeric fields of forms: what the app converts and what it sends to the engine unchanged.
import { type ExtrudeFeature, type PlaneFeature, createEngine, emptySketch, featureInput } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { expressionProblem, fieldNote, fieldText, parseField, plainNumber, resultText, valueText } from '../src/fields';
import { changeExtrude, draftCommand } from '../src/sketch-commands';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

describe('numeric field text', () => {
  it('a bare number is a number, anything else is an expression', () => {
    expect(parseField('12.5', 'mm')).toBe(12.5);
    expect(parseField(' 12,5 ', 'mm')).toBe(12.5); // decimal comma
    expect(parseField('-3', 'mm')).toBe(-3);
    expect(parseField('1e2', 'mm')).toBe(100);
    expect(parseField('.5', 'mm')).toBe(0.5);
    expect(parseField('h * 2', 'mm')).toBe('h * 2');
    expect(parseField('2 * 3', 'mm')).toBe('2 * 3'); // arithmetic is left to the engine
    expect(parseField('  ', 'mm')).toBeUndefined();
  });

  it('an angle: a bare number is in degrees, an expression stays in engine units', () => {
    expect(parseField('30', 'rad')).toBeCloseTo(Math.PI / 6, 15);
    expect(parseField('deg(30)', 'rad')).toBe('deg(30)');
    expect(parseField('pi / 2', 'rad')).toBe('pi / 2'); // never wrapped into deg()
    expect(fieldText(Math.PI / 6, 'rad')).toBe('30');
    expect(fieldText('pi / 2', 'rad')).toBe('pi / 2');
    expect(fieldNote('pi / 2', Math.PI / 2, 'rad')).toBe('= 90°');
    // an expression that is a bare number is shown as that number, in degrees, not as typed
    expect(fieldText('0.5', 'rad')).toBe(plainNumber((0.5 * 180) / Math.PI));
    expect(fieldText(' 12.5 ', 'mm')).toBe('12.5');
    // a number shown and read back does not drift
    expect(parseField(fieldText(Math.PI / 6, 'rad'), 'rad')).toBeCloseTo(Math.PI / 6, 12);
  });

  it('what a field shows', () => {
    expect(fieldText(12.3456789, 'mm')).toBe('12.345679');
    expect(fieldText(NaN, 'mm')).toBe('');
    expect(fieldText('h / 2', 'mm')).toBe('h / 2');
    expect(plainNumber(-0)).toBe('0');
    expect(valueText(16.2, 'mm')).toBe('16.2 mm');
    expect(valueText(3, 'count')).toBe('3');
    // a number of a result: an angle is rounded after it became degrees, and the significant
    // digits a query asks for are kept where six decimal places would leave nothing
    expect(resultText(-2 * Math.PI, 'rad')).toBe('-360°');
    expect(resultText(Math.PI / 6, 'rad')).toBe('30°');
    expect(resultText(0.0000012345678, 'mm3')).toBe('0.000001 mm³');
    expect(resultText(0.0000012345678, 'mm3', 4)).toBe('0.000001235 mm³');
    expect(resultText(12.345678, 'mm', 4)).toBe('12.35 mm');
    expect(resultText(1234.5678, 'g·mm2', 6)).toBe('1234.57 g·mm²');
    expect(fieldNote(5, 5, 'mm')).toBe(''); // a number needs no note
    expect(fieldNote('h', 12, 'mm')).toBe('= 12 mm');
    expect(fieldNote('h', undefined, 'mm')).toBe('= ?');
  });

  it('problems reported while typing', () => {
    expect(expressionProblem('h * 2', 'number')).toBeUndefined();
    expect(expressionProblem('h *', 'number')).toBe('the expression is incomplete');
    expect(expressionProblem('h * 2', 'number', ['d'])).toBe('unknown name "h"');
    expect(expressionProblem('h * 2', 'check')).toMatch(/a comparison is expected/);
    expect(expressionProblem('h > 2', 'check', ['h'])).toBeUndefined();
  });
});

describe('drafts keep expressions', () => {
  it('editing an extrusion and a plane from the input form sends the expressions back', () => {
    const engine = createEngine(deps);
    const run = (...commands: Parameters<typeof engine.execute>[0][]) => {
      for (const command of commands) {
        const result = engine.execute(command);
        if (!result.ok) throw new Error(result.error.message);
      }
    };
    run(
      { type: 'setParameter', name: 'h', expr: '12' },
      { type: 'addFeature', feature: emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }) },
      { type: 'addCurve', sketch: 's', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 'h' }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 'h / 2' } },
    );
    const feature = <F>(id: string): F => engine.getState().document.features.find((f) => f.id === id) as F;
    const index = (id: string) => engine.getState().document.features.findIndex((f) => f.id === id);

    // confirming an untouched draft changes nothing
    const before = engine.save();
    run(draftCommand(featureInput(feature<ExtrudeFeature>('e')), true, index('e')), draftCommand(featureInput(feature<PlaneFeature>('p')), true, index('p')));
    expect(engine.save()).toBe(before);

    // changing another field keeps the expression of the distance
    const draft = changeExtrude(featureInput(feature<ExtrudeFeature>('e')), { regions: [{ outerLoop: ['c'] }] }, []);
    run(draftCommand(draft, true, index('e')));
    expect(feature<ExtrudeFeature>('e').expressions).toEqual({ 'extent/distance': 'h' });

    // a number typed into the field replaces the expression, an expression sets a new one
    run(draftCommand(changeExtrude(featureInput(feature<ExtrudeFeature>('e')), { distance: 7 }, []), true, index('e')));
    expect(feature<ExtrudeFeature>('e')).toMatchObject({ extent: { distance: 7 } });
    expect(feature<ExtrudeFeature>('e').expressions).toBeUndefined();
    run(draftCommand(changeExtrude(featureInput(feature<ExtrudeFeature>('e')), { distance: 'h * 2' }, []), true, index('e')));
    expect(feature<ExtrudeFeature>('e')).toMatchObject({ extent: { distance: 24 }, expressions: { 'extent/distance': 'h * 2' } });

    // an expression that stopped evaluating does not block the form: the start has no input in
    // the form, its broken expression is sent back unchanged
    run({ type: 'setField', feature: 'e', path: 'extent/start', value: 'h / 4' }, { type: 'setField', feature: 'e', path: 'extent/distance', value: 5 }, { type: 'removeParameter', name: 'h' });
    run(draftCommand(changeExtrude(featureInput(feature<ExtrudeFeature>('e')), { distance: 9 }, []), true, index('e')));
    expect(feature<ExtrudeFeature>('e')).toMatchObject({ extent: { start: 3, distance: 9 }, expressions: { 'extent/start': 'h / 4' } });
    run({ type: 'setParameter', name: 'h', expr: '12' }, { type: 'setField', feature: 'e', path: 'extent/start', value: 0 }, { type: 'setField', feature: 'e', path: 'extent/distance', value: 'h * 2' });

    // the preview of a draft reports the value of the expression being typed
    const preview = engine.preview(draftCommand(changeExtrude(featureInput(feature<ExtrudeFeature>('e')), { distance: 'h + 1' }, []), true, index('e')), 'e');
    expect(preview.ok && preview.state.evaluation.features.e.values).toEqual({ 'extent/distance': 13 });
  });
});
