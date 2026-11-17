// The texts the app makes of recompute issues: bodies, features and copies of a pattern are named.
import { type Issue, type NumberSpec, emptyDocument } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { angleProblem, bodyName, faceLabel, featureName, issueText, refName, takenOverText } from '../src/issue-text';

const NAMES: Record<string, string> = { plate: 'Plate', hole: 'Hole', P: 'Pattern 5', S1: 'Sketch 1' };
const nameOf = (id: string): string | undefined => (Object.hasOwn(NAMES, id) ? NAMES[id] : undefined);
const text = (issue: Issue): string => issueText(issue, nameOf);

describe('names for a human', () => {
  it('a feature by its name, a body after its feature, a copy with its number', () => {
    expect(featureName('plate', nameOf)).toBe('Plate');
    expect(featureName('gone', nameOf)).toBe('(gone)');
    expect(bodyName('plate', nameOf)).toBe('Plate');
    expect(bodyName('P/2', nameOf)).toBe('Pattern 5 / 2');
    expect(bodyName('gone/2', nameOf)).toBe('(gone) / 2');
    expect(featureName('constructor', nameOf)).toBe('(constructor)');
  });

  it('a body with a name of its own (D48) is named by it, in a line and in the refs of an issue', () => {
    const bodyNameOf = (id: string): string | undefined => (id === 'P/2' ? 'Odd screw' : undefined);
    expect(bodyName('P/2', nameOf, bodyNameOf)).toBe('Odd screw');
    expect(bodyName('P/3', nameOf, bodyNameOf)).toBe('Pattern 5 / 3');
    expect(refName('P/2', nameOf, bodyNameOf)).toBe('Odd screw');
    expect(issueText({ code: 'noEffect', message: 'missed', refs: ['P/2', 'plate'] }, nameOf, bodyNameOf)).toBe('missed (Odd screw, Plate)');
  });

  it('a face names its feature, its role and the copies it went through', () => {
    expect(faceLabel({ feature: 'plate', role: 'endCap' }, nameOf)).toBe('Plate – protější víko');
    expect(faceLabel({ feature: 'hole', role: 'side', curve: 'k', copy: [{ pattern: 'P', index: 2 }] }, nameOf)).toBe('Hole – bok, copy 2 of Pattern 5');
    expect(faceLabel({ feature: 'hole', role: 'side', curve: 'k', copy: [{ pattern: 'P', index: 2 }, { pattern: 'Q', index: 1 }] }, nameOf)).toBe('Hole – bok, copy 2 of Pattern 5, copy 1 of (Q)');
  });

  it('a string of refs is named only when the document knows it', () => {
    expect(refName('plate', nameOf)).toBe('Plate');
    expect(refName('P/3', nameOf)).toBe('Pattern 5 / 3');
    expect(refName('hole2', nameOf)).toBe('hole2'); // a feature that is gone: no parentheses inside parentheses
    expect(refName('x1/center', nameOf)).toBe('x1/center'); // a point of a projected circle
    expect(refName('origin', nameOf)).toBe('origin');
  });
});

describe('the text of an issue', () => {
  it('names the bodies and features of issues that refer to them', () => {
    expect(text({ code: 'noEffect', message: 'Operace těleso nezměnila.', refs: ['plate', 'P/1'] })).toBe('Operace těleso nezměnila. (Plate, Pattern 5 / 1)');
    expect(text({ code: 'brokenReference', message: 'Odkaz neplatí.', refs: ['hole2'] })).toBe('Odkaz neplatí. (hole2)');
    expect(text({ code: 'brokenReference', message: 'Odkaz neplatí.', refs: ['x1/center'] })).toBe('Odkaz neplatí. (x1/center)');
    expect(text({ code: 'emptyResult', message: 'Operace by odebrala celé těleso.' })).toBe('Operace by odebrala celé těleso.');
    // refs of other issues are constraints or field paths and stay out of the text
    expect(text({ code: 'sketchConflict', message: 'Vazby si odporují.', refs: ['plate', 'k2'] })).toBe('Vazby si odporují.');
    expect(text({ code: 'invalidExpression', message: 'Výraz nejde vyhodnotit.', refs: ['extent/distance'] })).toBe('Výraz nejde vyhodnotit.');
  });

  it('a pattern names the copy once, by the name of its feature, whatever the issue is', () => {
    expect(text({ code: 'emptyResult', message: 'Operace by odebrala celé těleso.', refs: [{ copy: 1, feature: 'hole' }, 'plate'] })).toBe('Operace by odebrala celé těleso. (copy 1 of Hole, Plate)');
    expect(text({ code: 'kernelFailure', message: 'Jádro selhalo. (not closed)', refs: [{ copy: 4, feature: 'hole' }] })).toBe('Jádro selhalo. (not closed) (copy 4 of Hole)');
    expect(text({ code: 'noEffect', message: 'Operace těleso nezměnila.', refs: [{ copy: 1, feature: 'hole', targets: ['plate'] }, { copy: 3, feature: 'gone', targets: ['plate'] }] })).toBe('Operace těleso nezměnila. (copy 1 of Hole, copy 3 of gone)');
    expect(text({ code: 'brokenReference', message: 'Odkaz neplatí.', refs: [{ copy: 2, feature: 'hole' }, 'P/9'] })).toBe('Odkaz neplatí. (copy 2 of Hole, Pattern 5 / 9)');
    // a grid (D53): the copies are named in the detail of the engine, the paths of refs stay out
    expect(text({ code: 'invalidPattern', message: 'The counts, the directions and the spans do not make a pattern. (the copies 1 and 1000 would stand in one place)', refs: ['transform/direction', 'transform/count', 'transform/span/spacing', 'transform/second/direction', 'transform/second/count', 'transform/second/span/spacing'] })).toBe(
      'The counts, the directions and the spans do not make a pattern. (the copies 1 and 1000 would stand in one place)',
    );
    expect(text({ code: 'invalidPattern', message: 'The counts, the directions and the spans do not make a pattern. (the copy 1001 would stand in the place of the original)', refs: ['transform/direction'] })).toBe('The counts, the directions and the spans do not make a pattern. (the copy 1001 would stand in the place of the original)');
    expect(text({ code: 'noEffect', message: 'Operace těleso nezměnila.', refs: [{ copy: 1002, feature: 'hole', targets: ['plate'] }] })).toBe('Operace těleso nezměnila. (copy 1002 of Hole)');
    // things that only look like a copy
    expect(text({ code: 'noEffect', message: 'm', refs: [{ copy: '1', feature: 'hole' }, null, 3, { outerLoop: ['a'] }] })).toBe('m');
  });
});

describe('an angle typed in degrees', () => {
  const ANGLE: NumberSpec = { title: 'Angle', unit: 'rad', min: { value: -2 * Math.PI }, max: { value: 2 * Math.PI }, nonZero: true };
  it('out of range is reported in degrees; the rest is left to the engine', () => {
    expect(angleProblem((400 * Math.PI) / 180, ANGLE)).toBe('Angle: 400° is not between -360° and 360°');
    expect(angleProblem((-361 * Math.PI) / 180, ANGLE)).toBe('Angle: -361° is not between -360° and 360°');
    expect(angleProblem(2 * Math.PI, ANGLE)).toBeUndefined();
    expect(angleProblem(-2 * Math.PI, ANGLE)).toBeUndefined();
    expect(angleProblem(0, ANGLE)).toBeUndefined(); // zero is the engine's to refuse
    expect(angleProblem('deg(400)', ANGLE)).toBeUndefined(); // an expression is in radians as written
    expect(angleProblem(NaN, ANGLE)).toBeUndefined();
    expect(angleProblem(undefined, ANGLE)).toBeUndefined();
    expect(angleProblem(4, { title: 'Helix', unit: 'rad', max: { value: Math.PI / 2, open: true } })).toBe('Helix: 229.183118° must be below 90°');
    expect(angleProblem(Math.PI / 2, { title: 'Helix', unit: 'rad', max: { value: Math.PI / 2, open: true } })).toBe('Helix: 90° must be below 90°');
    expect(angleProblem(500, { title: 'Count', unit: 'count', max: { value: 200 } })).toBeUndefined();
  });
});

describe('an ID a section of the document still names, used again', () => {
  it('body properties (D48) and the mechanism (D49) each say what they give to what was made under it', () => {
    const doc = { ...emptyDocument(), bodyProperties: { e1: { name: 'Plate' } }, mechanism: { links: { arm: { bodies: ['e1', 'e3'] } }, joints: { elbow: { type: 'continuous', parent: 'arm', child: 'arm2', axis: { kind: 'sketchPoint', sketch: 's2', point: 'p1' }, value: 0 } } } } as never;
    expect(takenOverText(doc, ['e3'])).toBe('An ID that the mechanism names is now used again: e3. A body made under it is in its link, and a sketch or a point made under it carries the axis of its joint; if it is another thing, change the mechanism in the model panel.');
    expect(takenOverText(doc, ['s2', 'p1'])).toContain('the mechanism names is now used again: s2, p1.');
    // an ID both name: both sentences
    expect(takenOverText(doc, ['e1'])).toBe(
      'An ID that body properties name is now used again: e1. A body made under it takes those properties; if it is another thing, remove them in the model panel. An ID that the mechanism names is now used again: e1. A body made under it is in its link, and a sketch or a point made under it carries the axis of its joint; if it is another thing, change the mechanism in the model panel.',
    );
  });
});
