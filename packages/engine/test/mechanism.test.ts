// The mechanism (D49) without the kernel: the section of the document and its upgrade step, the five
// commands, the result of the recompute (transforms, joints in error, what is written back), the
// readers of the pose (`poseOfBody`, `carriedBy`, `poseNote`) and the posed bodies of a context with
// a pair in the frame of its first body, over meshes written by hand. The same against the real
// adapters is in packages/scenarios/test/scenario13.test.ts.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { evaluateParameters } from '../src/expression';
import { namedBySections, takenOver } from '../src/index';
import { movedBody, pairInFrame, poseOf } from '../src/query/pose';
import { QueryFailure } from '../src/query/spec';
import { BASE } from '../src/recompute/services';
import type { State } from '../src/recompute/state';
import { UPGRADES } from '../src/schema';
import { DOCUMENT_SECTIONS } from '../src/sections/index';
import { carriedBy, poseNote, poseOfBody } from '../src/sections/mechanism';
import { type FaceInfo, IDENTITY, analyzeBody, compose, inverse, rotation, shift, transformPoint } from '../src/solid';
import type { BodyResult, Command, Document, Engine, Id, Joint, Mechanism, MechanismResult, SketchSolver, SolidKernel, Vec3 } from '../src/types';
import { prism } from './section-kit';

// A document with what creates bodies, loaded as a file is: the extrusions `base`, `upper`,
// `forearm`, `motor`, and a sketch `layout` with the points `shoulder` and `elbow`.
const extrusion = (id: Id) => ({ id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' });
const layout = {
  id: 'layout',
  name: 'layout',
  suppressed: false,
  type: 'sketch',
  plane: { kind: 'base', plane: 'XY' },
  points: { shoulder: { x: 0, y: 0 }, elbow: { x: 120, y: 0 } },
  radii: {},
  curves: {},
  constraints: {},
  external: {},
  solved: { inputs: '', external: {} },
};
const base = (mechanism: unknown = { links: {}, joints: {} }, parameters: object[] = []): Document =>
  validateDocument({ ...JSON.parse(JSON.stringify(emptyDocument())), parameters, features: [extrusion('base'), extrusion('upper'), extrusion('forearm'), extrusion('motor'), layout], mechanism });
const apply = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const refused = (doc: Document, command: Command, message: RegExp): CommandError => {
  let caught: unknown;
  try {
    applyCommand(doc, command);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CommandError);
  expect((caught as Error).message).toMatch(message);
  return caught as CommandError;
};
const Z = { kind: 'base', axis: 'Z' } as const;
const ELBOW = { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' } as const;
const revolute = (parent: Id, child: Id, extra: object = {}): Joint => ({ type: 'revolute', parent, child, axis: Z, lower: -1, upper: 1, value: 0, ...extra }) as Joint;
// Three links and two joints: the arm of scenario 13 without its geometry.
const ARM: Mechanism = {
  links: { base: { bodies: ['base'] }, upper: { name: 'Upper arm', bodies: ['upper', 'motor'] }, forearm: { bodies: ['forearm'] } },
  joints: { shoulder: revolute('base', 'upper'), elbow: revolute('upper', 'forearm', { axis: ELBOW, lower: -2, upper: 2 }) },
};
const arm = (): Document => base(ARM);
const setJoint = (id: Id, joint: object): Command => ({ type: 'setJoint', id, joint }) as Command;
const pose = (values: Record<Id, number | string>): Command => ({ type: 'setPose', values });

// The state of the recompute an axis is read from: the sketch `layout` on XY with its two points.
const STATE = { sketches: { layout: { frame: BASE.XY, geometry: { points: { shoulder: { x: 0, y: 0 }, elbow: { x: 120, y: 0 } } } } } } as unknown as State;
const NO_SKETCH = { sketches: {} } as unknown as State;
const BODIES = (...ids: Id[]): Record<Id, BodyResult> => Object.fromEntries(ids.map((id) => [id, { volume: 1 } as BodyResult]));
const evaluated = (doc: Document, bodies = BODIES('base', 'upper', 'forearm', 'motor'), state = STATE) => DOCUMENT_SECTIONS.mechanism.evaluate(doc.mechanism, doc, bodies, evaluateParameters(doc.parameters), state);
const near = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 9));

describe('the section and its upgrade step', () => {
  it('is always in the document, after body properties; an empty one has no link and no joint', () => {
    expect(emptyDocument().mechanism).toEqual({ links: {}, joints: {} });
    expect(Object.keys(emptyDocument()).slice(-3)).toEqual(['bodyProperties', 'mechanism', 'meshes']);
  });

  it('the step gives an older document the empty section and leaves a field that is there to the validation', () => {
    const step = UPGRADES.find((entry) => entry.name === '5a-mechanism');
    expect(UPGRADES.indexOf(step as never)).toBe(4); // the fifth of the list (3b-mesh-import follows)
    const older = { schemaVersion: 5, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [], bodyProperties: {} };
    expect(step?.run(older)).toEqual({ ...older, mechanism: { links: {}, joints: {} } });
    expect(step?.run({ ...older, mechanism: null })).toEqual({ ...older, mechanism: null });
    // a document of master with 3a (version 5, no names) loads with the empty section
    expect(validateDocument(older).mechanism).toEqual({ links: {}, joints: {} });
    expect(() => validateDocument({ ...older, mechanism: null })).toThrow(/document\.mechanism: čeká se objekt/);
    // a document of version 1 goes through every step
    expect(validateDocument({ schemaVersion: 1, settings: { chordTolerance: 0.01 }, features: [] }).mechanism).toEqual({ links: {}, joints: {} });
  });

  it('a load keeps a valid section in its canonical form and the expressions with their numbers', () => {
    const doc = base({ ...ARM, joints: { ...ARM.joints, shoulder: { value: 0.5, upper: 1, lower: -1, axis: Z, child: 'upper', parent: 'base', type: 'revolute', expressions: { value: 'q / 2' } } } }, [{ name: 'q', expr: '1' }]);
    expect(Object.keys(doc.mechanism.joints.shoulder)).toEqual(['type', 'parent', 'child', 'axis', 'lower', 'upper', 'value', 'expressions']);
    expect(doc.mechanism.joints.shoulder.expressions).toEqual({ value: 'q / 2' });
    // a reference out of the section is not resolved on a load (the axis of a removed sketch loads)
    expect(() => base({ ...ARM, joints: { ...ARM.joints, elbow: { ...ARM.joints.elbow, axis: { kind: 'sketchPoint', sketch: 'gone', point: 'p' } } } })).not.toThrow();
    expect(() => base({ links: { forearm: { bodies: ['nope', 'screws/2'] } }, joints: {} })).not.toThrow();
  });

  it('a load is strict and checks the section whole', () => {
    const joints = (elbow: object) => ({ ...ARM, joints: { ...ARM.joints, elbow } });
    const cases: [unknown, RegExp][] = [
      [{ ...ARM, poses: {} }, /document\.mechanism\.poses: the mechanism has no such field/],
      [{ links: { a: { bodies: [], colour: 'red' } }, joints: {} }, /links\.a\.colour: a link has no such field/],
      [{ links: { a: { bodies: ['x', 'x'] } }, joints: {} }, /links\.a\.bodies\[1\]: the body "x" is in the list twice/],
      [{ links: { 'a/b': { bodies: [] } }, joints: {} }, /ID "a\/b" není přípustné/],
      [joints({ ...ARM.joints.elbow, effort: 2.5 }), /joints\.elbow\.effort: a joint of the type revolute has no such field/],
      [joints({ type: 'fixed', parent: 'upper', child: 'forearm', axis: Z }), /joints\.elbow\.axis: a joint of the type fixed has no such field/],
      [joints({ type: 'spherical', parent: 'upper', child: 'forearm' }), /joints\.elbow\.type/],
      [joints({ type: 'revolute', parent: 'upper', child: 'forearm', axis: Z, value: 0 }), /joints\.elbow\.lower: a joint of the type revolute has `lower`, `upper`, `value`/],
      [joints({ ...ARM.joints.elbow, lower: -90 }), /joints\.elbow\.lower: the value -90 is not in the interval/],
      [joints({ ...ARM.joints.elbow, value: '1' }), /an expression belongs in expressions/],
      [joints({ ...ARM.joints.elbow, expressions: { value: '2 *' } }), /joints\.elbow\.value: expression "2 \*"/],
      [joints({ type: 'fixed', parent: 'upper', child: 'forearm', expressions: {} }), /joints\.elbow\.expressions: a joint of the type fixed has no such field/],
      [{ links: { a: { bodies: ['x'] }, b: { bodies: ['x'] } }, joints: {} }, /the body "x" is in the links "a" and "b"/],
      [joints({ ...ARM.joints.elbow, child: 'nope' }), /the child of the joint "elbow" is "nope", which is not a link of the mechanism/],
      [joints({ ...ARM.joints.elbow, child: 'upper' }), /the joint "elbow" has the link "upper" as its parent and its child/],
      [joints({ ...ARM.joints.elbow, child: 'upper', parent: 'forearm' }), /the link "upper" is the child of the joints "shoulder" and "elbow"/],
      [joints({ ...ARM.joints.elbow, child: 'base' }), /would hang on itself/],
    ];
    for (const [mechanism, message] of cases) expect(() => base(mechanism)).toThrow(message);
  });
});

describe('the commands', () => {
  it('setLink creates and changes a link; only the bodies it did not have are checked; a command that changes nothing returns the document', () => {
    let doc = apply(base(), { type: 'setLink', id: 'upper', name: 'Upper arm', bodies: ['upper', 'motor'] });
    expect(doc.mechanism.links.upper).toEqual({ name: 'Upper arm', bodies: ['upper', 'motor'] });
    doc = apply(doc, { type: 'setLink', id: 'upper', name: null });
    expect(doc.mechanism.links.upper).toEqual({ bodies: ['upper', 'motor'] });
    expect(apply(doc, { type: 'setLink', id: 'upper', bodies: ['upper', 'motor'] })).toBe(doc);
    expect(apply(doc, { type: 'setLink', id: 'gripper' }).mechanism.links.gripper).toEqual({ bodies: [] });
    // the feature of `upper` removed: the link keeps it, and changing the list does not check it again
    const removed = apply(doc, { type: 'removeFeature', id: 'upper' });
    expect(apply(removed, { type: 'setLink', id: 'upper', bodies: ['motor', 'upper'] }).mechanism.links.upper.bodies).toEqual(['motor', 'upper']);
    refused(removed, { type: 'setLink', id: 'other', bodies: ['upper'] }, /setLink\.bodies\[0\]: no feature of the document creates the body "upper"/);
    refused(doc, { type: 'setLink', id: 'forearm', bodies: ['forearm', 'motor'] }, /setLink\.bodies\[1\]: the body "motor" is in the link "upper"; a body is in at most one link: take it out there first, in the same batch/);
    refused(doc, { type: 'setLink', id: 'x', bodies: ['base'], colour: 'red' } as never, /setLink\.colour: the command setLink has no such field/);
    // out of one link and into another in one batch
    const moved = apply(doc, { type: 'batch', commands: [{ type: 'setLink', id: 'upper', bodies: ['upper'] }, { type: 'setLink', id: 'base', bodies: ['base', 'motor'] }] });
    expect(moved.mechanism.links.base.bodies).toEqual(['base', 'motor']);
  });

  it('removeLink is refused while a joint names the link; removeJoint removes a joint', () => {
    const doc = arm();
    refused(doc, { type: 'removeLink', id: 'upper' }, /the link "upper" is named by the joints "shoulder", "elbow"/);
    refused(doc, { type: 'removeLink', id: 'nope' }, /the mechanism has no link "nope"; its links are base, upper, forearm/);
    const without = apply(doc, { type: 'removeJoint', id: 'elbow' }, { type: 'removeLink', id: 'forearm' });
    expect(Object.keys(without.mechanism.links)).toEqual(['base', 'upper']);
    refused(doc, { type: 'removeJoint', id: 'nope' }, /the mechanism has no joint "nope"; its joints are shoulder, elbow/);
  });

  it('setJoint takes the whole joint in the input form; an expression is evaluated now; a string equal to the stored expression is kept', () => {
    const doc = apply(arm(), { type: 'setParameter', name: 'reach', expr: '1.5' }, setJoint('elbow', { type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower: '-reach', upper: 'reach', value: 0 }));
    expect(doc.mechanism.joints.elbow).toEqual({ type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower: -1.5, upper: 1.5, value: 0, expressions: { lower: '-reach', upper: 'reach' } });
    // an expression that stopped evaluating, sent back by a form, does not stop a change of another field
    const broken = apply(doc, { type: 'removeParameter', name: 'reach' });
    const renamed = apply(broken, setJoint('elbow', { type: 'revolute', name: 'Elbow', parent: 'upper', child: 'forearm', axis: ELBOW, lower: '-reach', upper: 'reach', value: 0.5 }));
    expect(renamed.mechanism.joints.elbow).toMatchObject({ name: 'Elbow', lower: -1.5, upper: 1.5, value: 0.5, expressions: { lower: '-reach', upper: 'reach' } });
    // `expressions` of the input stand for their fields
    expect(apply(arm(), setJoint('shoulder', { ...ARM.joints.shoulder, expressions: { value: '0.25' } })).mechanism.joints.shoulder).toMatchObject({ value: 0.25, expressions: { value: '0.25' } });
    refused(arm(), setJoint('shoulder', { ...ARM.joints.shoulder, value: '0.2', expressions: { value: '0.25' } }), /both in the field and in expressions/);
    const error = refused(arm(), setJoint('elbow', { ...ARM.joints.elbow, value: 'nope' }), /setJoint\.joint\.value: expression "nope": unknown name "nope"/);
    expect(error.expression?.path).toBe('elbow/value');
  });

  it('setJoint keeps the section a forest of known links, and checks an axis it did not have', () => {
    const doc = arm();
    refused(doc, setJoint('loop', { type: 'fixed', parent: 'forearm', child: 'base' }), /setJoint: the link "\w+" would hang on itself through the joints/);
    refused(doc, setJoint('second', { type: 'fixed', parent: 'base', child: 'forearm' }), /the link "forearm" is the child of the joints "elbow" and "second"/);
    refused(doc, setJoint('wrist', revolute('forearm', 'nope')), /the child of the joint "wrist" is "nope", which is not a link of the mechanism/);
    refused(doc, setJoint('elbow', { ...ARM.joints.elbow, axis: { kind: 'sketchPoint', sketch: 'layout', point: 'wrist' } }), /setJoint\.joint\.axis\.point: the sketch "layout" has no entity "wrist"/);
    refused(doc, setJoint('elbow', { ...ARM.joints.elbow, axis: { kind: 'sketchPoint', sketch: 'upper', point: 'x' } }), /setJoint\.joint\.axis\.sketch: feature "upper" není skica/);
    // the sketch removed: the joint keeps its axis, and a change of another field passes
    const removed = apply(doc, { type: 'removeFeature', id: 'layout' });
    expect(apply(removed, setJoint('elbow', { ...ARM.joints.elbow, value: 0.5 })).mechanism.joints.elbow).toMatchObject({ axis: ELBOW, value: 0.5 });
    refused(removed, setJoint('wrist', { type: 'continuous', parent: 'forearm', child: 'base', axis: ELBOW, value: 0 }), /setJoint\.joint\.axis\.sketch/);
  });

  it('the limits: lower not above upper and the value within them, to a tolerance; a value within it is stored as the limit', () => {
    refused(arm(), setJoint('shoulder', revolute('base', 'upper', { lower: 1, upper: -1 })), /setJoint\.joint: the lower limit 1 rad is above the upper limit -1 rad/);
    refused(arm(), setJoint('shoulder', revolute('base', 'upper', { value: 1.01 })), /setJoint\.joint: the value 1\.01 rad is outside the limits of the joint, -1 to 1 rad \(radians: write degrees as deg\(x\)\); the nearest value allowed is 1/);
    expect(apply(arm(), pose({ shoulder: 1 + 5e-5 })).mechanism.joints.shoulder).toMatchObject({ value: 1 });
    refused(arm(), pose({ shoulder: 1 + 2e-4 }), /setPose\.values\.shoulder: the value 1\.0002 rad is outside the limits/);
    const slide = apply(arm(), setJoint('shoulder', { type: 'prismatic', parent: 'base', child: 'upper', axis: Z, lower: 0, upper: 10, value: 10 + 5e-7 }));
    expect(slide.mechanism.joints.shoulder).toMatchObject({ value: 10 });
    refused(slide, pose({ shoulder: 10.00001 }), /the value 10\.00001 mm is outside the limits/);
    // compared with the limits as they are for the document the command is applied to: in one batch
    let doc = apply(arm(), { type: 'setParameter', name: 'reach', expr: '1' }, setJoint('elbow', { ...ARM.joints.elbow, lower: '-reach', upper: 'reach' }));
    doc = apply(doc, { type: 'batch', commands: [{ type: 'setParameter', name: 'reach', expr: '2' }, pose({ elbow: 1.5 })] });
    expect(doc.mechanism.joints.elbow).toMatchObject({ upper: 1, value: 1.5 }); // the number of the limit is written by the recompute
    // a limit whose expression does not evaluate takes no part
    doc = apply(doc, { type: 'removeParameter', name: 'reach' });
    expect(apply(doc, pose({ elbow: 3 })).mechanism.joints.elbow).toMatchObject({ value: 3 });
  });

  it('setPose sets the values named; a number removes the expression, a string sets one; a fixed joint has none', () => {
    let doc = apply(arm(), { type: 'setParameter', name: 'q', expr: '0.25' }, pose({ shoulder: 'q', elbow: '-2 * q' }));
    expect(doc.mechanism.joints.shoulder).toMatchObject({ value: 0.25, expressions: { value: 'q' } });
    expect(doc.mechanism.joints.elbow).toMatchObject({ value: -0.5, expressions: { value: '-2 * q' } });
    doc = apply(doc, pose({ elbow: 0 }));
    expect(doc.mechanism.joints.elbow).not.toHaveProperty('expressions');
    expect(apply(doc, pose({ elbow: 0 }))).toBe(doc);
    refused(doc, pose({ nope: 0 }), /setPose\.values\.nope: the mechanism has no joint "nope"; its joints are shoulder, elbow/);
    const error = refused(doc, pose({ elbow: 'nope' }), /setPose\.values\.elbow: expression "nope"/);
    expect(error.expression?.path).toBe('elbow/value');
    const fixed = apply(doc, setJoint('elbow', { type: 'fixed', parent: 'upper', child: 'forearm' }));
    refused(fixed, pose({ elbow: 0 }), /the joint "elbow" is fixed and has no value/);
    refused(doc, pose({ elbow: true } as never), /setPose\.values\.elbow/);
    // the expressions of the joints follow a renamed parameter
    expect(apply(doc, { type: 'renameParameter', name: 'q', to: 'angle' }).mechanism.joints.shoulder.expressions).toEqual({ value: 'angle' });
  });

  it('the IDs the section names: the bodies (and the feature of a derived one), the sketch and the point of an axis', () => {
    const doc = apply(arm(), { type: 'setLink', id: 'upper', bodies: ['upper', 'motor'] });
    const withCopy = base({ links: { a: { bodies: ['screws/2'] }, b: { bodies: [] } }, joints: { j: { type: 'continuous', parent: 'a', child: 'b', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'x1/center' }, value: 0 } } });
    expect(namedBySections(doc)).toEqual(expect.arrayContaining(['base', 'upper', 'motor', 'forearm', 'layout', 'elbow']));
    expect(namedBySections(withCopy)).toEqual(expect.arrayContaining(['screws/2', 'screws', 'x1/center', 'x1']));
    expect(takenOver(apply(doc, { type: 'removeFeature', id: 'layout' }), { type: 'addFeature', feature: { ...layout } as never })).toEqual(['layout', 'elbow']); // the shoulder turns about Z here
  });
});

describe('the result of the recompute', () => {
  it('the transform of a link: T(child) = T(parent) ∘ M, in double precision from the modelled configuration', () => {
    // a chain of three: a turn about Z through (10, 0) by π/2, then a shift along X by 5
    const doc = base({
      links: { a: { bodies: ['base'] }, b: { bodies: ['upper'] }, c: { bodies: ['forearm'] } },
      joints: {
        turn: { type: 'continuous', parent: 'a', child: 'b', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, value: Math.PI / 2 },
        slide: { type: 'prismatic', parent: 'b', child: 'c', axis: { kind: 'base', axis: 'X' }, lower: 0, upper: 10, value: 5 },
      },
    });
    const { result } = evaluated(doc, BODIES('base', 'upper', 'forearm', 'motor'));
    expect(result.links.a.transform).toBe(IDENTITY);
    const p: Vec3 = [130, 0, 4];
    // first the slide where it is modelled, then the turn of the parent: (130,0) → (135,0) → (120,15)
    near(transformPoint(result.links.c.transform, p), [120, 15, 4]);
    near(transformPoint(result.links.b.transform, p), [120, 10, 4]);
    expect(result.joints.slide.axis).toEqual({ origin: [0, 0, 0], direction: [1, 0, 0] });
    near(result.joints.slide.axisInPose?.direction as Vec3, [0, 1, 0]);
    expect([result.roots, result.unassigned]).toEqual([['a'], ['motor']]);
    expect(result.links.c).toMatchObject({ bodies: ['forearm'], missing: [] });
    expect(evaluated(doc, BODIES('base')).result.links.c).toMatchObject({ bodies: [], missing: ['forearm'] });
    // what hangs on the turn, and the note of a pose
    expect(carriedBy(doc.mechanism, result, 'turn')).toEqual({ joint: 'turn', links: ['b', 'c'], bodies: ['upper', 'forearm'], missing: [] });
    expect(poseNote(result, doc.mechanism)).toEqual({ pose: { turn: Math.PI / 2, slide: 5 } });
    expect(poseOfBody(result, 'base')).toBeUndefined();
    expect(poseOfBody(result, 'motor')).toBeUndefined();
    expect(poseOfBody(result, 'forearm')).toBe(result.links.c.transform);
  });

  it('a joint whose axis does not resolve: in error; at zero it blocks nothing, turned it blocks what hangs on it', () => {
    const atZero = evaluated(arm(), undefined, NO_SKETCH).result;
    expect(atZero.joints.elbow).toMatchObject({ status: 'error', error: { code: 'brokenReference', refs: ['layout'] }, value: 0 });
    expect(atZero.links.forearm.blockedBy).toBeUndefined();
    expect(poseNote(atZero, arm().mechanism)).toBeUndefined();
    const doc = apply(arm(), pose({ shoulder: 0.5, elbow: 1 }));
    const turned = evaluated(doc, undefined, NO_SKETCH).result;
    expect(turned.links.forearm).toMatchObject({ blockedBy: 'elbow' });
    // the blocked link is carried by its parent with the joint at zero; its axis in the pose is gone
    expect(turned.links.forearm.transform).toEqual(turned.links.upper.transform);
    expect(turned.joints.elbow).not.toHaveProperty('axisInPose');
    expect(poseOfBody(turned, 'forearm')).toEqual({ blockedBy: 'elbow' });
    expect(poseOfBody(turned, 'upper')).toBe(turned.links.upper.transform);
  });

  it('a limit or an expression in error blocks also at zero; what is written back', () => {
    const params = [{ name: 'q', expr: '0.5' }];
    const doc = apply(base(ARM, params), setJoint('shoulder', revolute('base', 'upper', { lower: 'q - 1', upper: 'q', value: 'q' })));
    // the value taken out of the limits by its expression: in error, not written; the limits are written
    const out = apply(doc, setJoint('elbow', { ...ARM.joints.elbow, value: 'q * 2' }));
    const moved = { ...out, parameters: [{ name: 'q', expr: '1.5' }] };
    const { result, written } = evaluated(moved);
    expect(result.joints.elbow).toMatchObject({ status: 'error', error: { code: 'jointOutOfLimits' }, value: 3 });
    expect(result.links.forearm.blockedBy).toBe('elbow');
    expect(written?.joints.elbow).toMatchObject({ value: 1 });
    expect(written?.joints.shoulder).toMatchObject({ lower: 0.5, upper: 1.5, value: 1.5 });
    // the limits crossed: written, and the joint in error, also at zero
    const crossed = apply(base(ARM, [{ name: 'a', expr: '0.5' }]), setJoint('elbow', { ...ARM.joints.elbow, lower: 'a', upper: '1', value: 0.5 }));
    const atZero = { ...apply(crossed, pose({ elbow: 0.5 })), parameters: [{ name: 'a', expr: '2' }] };
    const resolved = evaluated(atZero);
    expect(resolved.result.joints.elbow.error).toMatchObject({ code: 'jointLimits' });
    expect(resolved.written?.joints.elbow).toMatchObject({ lower: 2, upper: 1 });
    // an expression that does not evaluate: in error and blocks, the field keeps its number
    const missing = evaluated({ ...out, parameters: [] }).result;
    expect(missing.joints.elbow).toMatchObject({ status: 'error', error: { code: 'invalidExpression', refs: ['elbow/value'] }, fieldErrors: { value: { code: 'unknownName' } } });
    expect(missing.joints.elbow).not.toHaveProperty('value');
    expect([missing.links.upper.blockedBy, missing.links.forearm.blockedBy]).toEqual(['shoulder', 'elbow']); // the nearest
  });

  it('through the engine: a pose is one undo step, written numbers in the same step; results stay the same objects', () => {
    const solver = { solve: () => ({ status: 'failed', points: {}, radii: {}, degreesOfFreedom: 0, conflicting: [], redundant: [] }) } as SketchSolver;
    const engine: Engine = createEngine({ solver, kernel: {} as SolidKernel });
    engine.load(JSON.stringify(base({ links: ARM.links, joints: { shoulder: ARM.joints.shoulder, elbow: { ...ARM.joints.elbow, axis: Z } } })));
    const before = engine.getState();
    const after = engine.execute(pose({ elbow: 0.5 }));
    if (!after.ok) throw new Error(after.error.message);
    expect(after.state.canUndo).toBe(true);
    // the joint and the link the pose did not change are the same objects
    expect(after.state.evaluation.mechanism.joints.shoulder).toBe(before.evaluation.mechanism.joints.shoulder);
    expect(after.state.evaluation.mechanism.links.upper).toBe(before.evaluation.mechanism.links.upper);
    expect(after.state.evaluation.mechanism.links.forearm).not.toBe(before.evaluation.mechanism.links.forearm);
    engine.undo();
    expect(engine.getState().evaluation.mechanism.joints.elbow.value).toBe(0);
    // a coupled motion: the values are written back by the recompute
    engine.execute({ type: 'batch', commands: [{ type: 'setParameter', name: 'q', expr: '0.1' }, pose({ shoulder: 'q', elbow: '-2 * q' })] });
    engine.execute({ type: 'setParameter', name: 'q', expr: '0.3' });
    expect(engine.getState().document.mechanism.joints.elbow).toMatchObject({ value: -0.6 });
    // the options of a query
    expect(engine.query('mechanism', {}, { geometry: 'posed' } as never)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['geometry'] } });
    expect(engine.query('mechanism', { beyond: 'nope' })).toMatchObject({ ok: false, error: { code: 'notAvailable', arg: ['beyond'] } });
    expect(engine.query('mechanism', { beyond: 'shoulder' })).toMatchObject({ ok: true, result: { beyond: { links: ['upper', 'forearm'], missing: ['upper', 'motor', 'forearm'] } } });
  });
});

describe('posed bodies and a pair in the frame of its first body', () => {
  // Two boxes, `a` from x 0 to 10 and `b` from x 10 to 20, each 10 × 10 × 10, with the faces 0 to 5
  // of `a` and 6 to 11 of `b`.
  const infos: FaceInfo[] = Array.from({ length: 12 }, () => ({ planar: true, origin: [0, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }));
  const names = infos.map((_, i) => ({ feature: i < 6 ? 'a' : 'b', role: 'side', curve: String(i) }));
  const box = (x: number, first: number): BodyResult => analyzeBody(prism([[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]], 0, 10, (side) => first + 2 + side), names as never, infos).result;
  const modelled = { a: box(0, 0), b: box(10, 6), c: box(30, 6) };
  const mechanismOf = (values: Record<Id, number>, axis = Z): { section: Mechanism; result: MechanismResult } => {
    const section: Mechanism = {
      links: { first: { bodies: ['a'] }, second: { bodies: ['b'] }, third: { bodies: ['c'] } },
      joints: {
        one: { type: 'continuous', parent: 'first', child: 'second', axis, value: values.one ?? 0 },
        two: { type: 'continuous', parent: 'second', child: 'third', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, value: values.two ?? 0 },
      },
    };
    const doc = { ...emptyDocument(), mechanism: section };
    return { section, result: DOCUMENT_SECTIONS.mechanism.evaluate(section, doc, modelled, {}, STATE).result };
  };

  it('nothing moves: no pose, the context is the model as modelled', () => {
    const { section, result } = mechanismOf({});
    expect(poseOf(section, result, modelled)).toBeUndefined();
  });

  it('a body is posed when it is read, and remembered by its solid and the numbers of the transform', () => {
    const { section, result } = mechanismOf({ one: Math.PI / 2 });
    const pose = poseOf(section, result, modelled);
    if (!pose) throw new Error('expected a pose');
    expect(Object.keys(pose.bodies)).toEqual(['a', 'b', 'c']);
    expect(pose.bodies.a).toBe(modelled.a);
    const b = pose.bodies.b;
    expect(b).not.toBe(modelled.b);
    near(b.bounds.min, [-10, 10, 0]);
    near(b.bounds.max, [0, 20, 10]);
    expect([b.volume, b.faces, b.solid.triangles]).toEqual([modelled.b.volume, modelled.b.faces, modelled.b.solid.triangles]);
    // another context of the same pose hands out the same object
    expect(poseOf(section, mechanismOf({ one: Math.PI / 2 }).result, modelled)?.bodies.b).toBe(b);
    expect(movedBody(modelled.b, result.links.second.transform)).toBe(b);
    expect(movedBody(modelled.b, IDENTITY)).toBe(modelled.b);
  });

  it('a pair is computed in the frame of its first body: the joints both hang on cancel, the motion between them is composed of the joints between them', () => {
    const turned = mechanismOf({ one: 0.3, two: 0.7 });
    const pose = poseOf(turned.section, turned.result, modelled);
    if (!pose) throw new Error('expected a pose');
    // `b` and `c` both hang on `one`: in the frame of `b`, `b` is as modelled and `c` turned by `two` only
    const bc = pairInFrame(pose.bodies.b, pose.bodies.c);
    expect(bc?.a).toBe(modelled.b);
    expect(bc?.b).toBe(movedBody(modelled.c, rotation([120, 0, 0], [0, 0, 1], 0.7)));
    expect(bc?.back).toBe(turned.result.links.second.transform);
    // the same two joints with another value of `one`: the same moved body, so what is remembered by it is found again
    const other = mechanismOf({ one: 1.1, two: 0.7 });
    const again = poseOf(other.section, other.result, modelled);
    expect(again && pairInFrame(again.bodies.b, again.bodies.c)?.b).toBe(bc?.b);
    // the first body as modelled, the second moved back by `one` and on by `two`
    const ac = pairInFrame(pose.bodies.a, pose.bodies.c);
    expect(ac?.a).toBe(modelled.a);
    expect(ac?.back).toBe(IDENTITY);
    near(ac?.b.bounds.min as Vec3, pose.bodies.c.bounds.min);
    const ca = pairInFrame(pose.bodies.c, pose.bodies.a);
    expect(ca?.a).toBe(modelled.c);
    const expected = compose(inverse(compose(rotation([0, 0, 0], [0, 0, 1], 0.3), rotation([120, 0, 0], [0, 0, 1], 0.7))), IDENTITY);
    near(ca?.b.bounds.min as Vec3, movedBody(modelled.a, expected).bounds.min);
    // neither moved: nothing to compute in another frame
    expect(pairInFrame(modelled.a, modelled.b)).toBeUndefined();
  });

  it('a body beyond a joint without a motion cannot be read: the failure names the joint and the ways to it', () => {
    const { section, result } = mechanismOf({ one: 0.3, two: 0.7 });
    const blocked = DOCUMENT_SECTIONS.mechanism.evaluate(section, { ...emptyDocument(), mechanism: section }, modelled, {}, NO_SKETCH).result;
    const pose = poseOf(section, blocked, modelled);
    if (!pose) throw new Error('expected a pose');
    expect(pose.bodies.b.bounds).not.toEqual(modelled.b.bounds);
    let caught: unknown;
    try {
      void pose.bodies.c;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryFailure);
    expect((caught as QueryFailure).code).toBe('failed');
    expect((caught as Error).message).toMatch(/the pose of the body "c" is not known: the joint "two" has no motion \(brokenReference: .*\)\. The bodies beyond it can be read with the joint at zero, which writes nothing: after: \{ "type": "setPose", "values": \{ "two": 0 \} \}; or as modelled with geometry: 'modelled'/);
    expect(() => pose.transformOf('c')).toThrow(QueryFailure);
    expect(result.links.third.blockedBy).toBeUndefined();
    expect(shift([2, 0, 0], 3).translation).toEqual([3, 0, 0]);
  });
});
