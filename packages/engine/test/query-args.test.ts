// The description of the arguments of a query (D37): the type that follows from it, the check
// against a state with its defaults and paths, and the store of results kept by their owners.
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import type { ArgSpecs, ArgsOf, RunArgsOf } from '../src/query/args';
import { type CheckScope, argText, checkArgs, specProblems } from '../src/query/check';
import { Memo } from '../src/query/context';
import type { Command, Document, EdgeName, Evaluation, FaceName } from '../src/types';

// ---------------------------------------------------------------- a state to check against

const XY = { kind: 'base', plane: 'XY' } as const;
const cap: FaceName = { feature: 'E1', role: 'endCap' };
const wall: FaceName = { feature: 'E1', role: 'side', curve: 'c' };
const rim: EdgeName = { a: cap, b: wall };
// The document: a sketch S1 with a circle and a dimension, a body E1, a plane PL, and a sketch S9
// that the state asked about does not reach.
const document: Document = (
  [
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addPoint', sketch: 'S1', id: 'p', x: 3, y: 4 },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p' }, radius: 5 },
    { type: 'addConstraint', sketch: 'S1', id: 'r', constraint: { type: 'radius', curve: 'c', value: 5, driving: true } },
    { type: 'addFeature', feature: { id: 'E1', name: 'E1', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
    { type: 'addFeature', feature: { id: 'PL', name: 'PL', suppressed: false, type: 'plane', base: XY, offset: 5 } },
    { type: 'addFeature', feature: emptySketch('S9', 'S9', XY) },
  ] as Command[]
).reduce(applyCommand, emptyDocument());
// The state after PL: what the checker reads of an evaluation.
const evaluation = {
  features: { S1: {}, E1: {}, PL: {} },
  bodies: { E1: { faces: [{ id: 0, planar: true }, { id: 1, planar: false }], edges: [{ name: rim, kind: 'circle', segments: new Float64Array() }] } },
  faceNames: [cap, wall],
} as unknown as Evaluation;
const scope: CheckScope = { document, evaluation };

const check = (specs: ArgSpecs, args: unknown) => checkArgs(specs, args, scope);
const value = (specs: ArgSpecs, args: unknown) => {
  const checked = check(specs, args);
  if (!checked.ok) throw new Error(checked.message);
  return checked.value;
};
const problem = (specs: ArgSpecs, args: unknown) => {
  const checked = check(specs, args);
  if (checked.ok) throw new Error('the arguments were accepted');
  return [checked.code, argText(checked.arg), checked.message];
};

describe('arguments of a query: the check against a state', () => {
  it('scalars: numbers by their own description, flags, texts, choices, vectors', () => {
    const specs = {
      depth: { kind: 'number', title: 'Depth', spec: { title: 'Depth', unit: 'mm', min: { value: 0, open: true } } },
      count: { kind: 'number', title: 'Count', optional: true, spec: { title: 'Count', unit: 'count', integer: true, min: { value: 1 }, default: 3 } },
      limit: { kind: 'number', title: 'Limit', optional: true, spec: { title: 'Limit', unit: 'mm3' } },
      deep: { kind: 'flag', title: 'Deep', optional: true },
      note: { kind: 'text', title: 'Note', optional: true },
      mode: { kind: 'choice', options: ['fast', 'exact'], title: 'Mode', optional: true },
      up: { kind: 'vector', title: 'Up', optional: true },
    } as const satisfies ArgSpecs;
    // a default is filled in; an optional argument without one stays out
    expect(value(specs, { depth: 2 })).toEqual({ depth: 2, count: 3 });
    expect(value(specs, { depth: 2, count: 4.0000000001, limit: 1e12, deep: false, note: '', mode: 'exact', up: [0, -0, 1] })).toEqual({ depth: 2, count: 4, limit: 1e12, deep: false, note: '', mode: 'exact', up: [0, 0, 1] });
    expect(Object.is((value(specs, { depth: 2, up: [0, -0, 1] }).up as number[])[1], 0)).toBe(true);
    expect(value(specs, { depth: 2, count: undefined, note: undefined })).toEqual({ depth: 2, count: 3 }); // undefined is not given
    expect(problem(specs, {})).toEqual(['invalidArguments', 'depth', 'depth: the argument is required']);
    expect(problem(specs, { depth: 0 })).toEqual(['invalidArguments', 'depth', 'depth: the value must be positive']);
    expect(problem(specs, { depth: '2' })).toEqual(['invalidArguments', 'depth', 'depth: a number is expected']);
    expect(problem(specs, { depth: Number.NaN })[2]).toMatch(/not a finite number/);
    expect(problem(specs, { depth: 1, count: 2.5 })[2]).toMatch(/count: the value 2.5 is not an integer/);
    expect(problem(specs, { depth: 1, deep: 'yes' })).toEqual(['invalidArguments', 'deep', 'deep: true or false is expected']);
    expect(problem(specs, { depth: 1, note: 3 })[2]).toBe('note: a text is expected');
    expect(problem(specs, { depth: 1, mode: 'slow' })[2]).toBe('mode: one of fast, exact is expected');
    expect(problem(specs, { depth: 1, up: [0, 1] })[2]).toBe('up: three finite numbers are expected');
    expect(problem(specs, { depth: 1, dpeth: 2 })).toEqual(['invalidArguments', 'dpeth', 'dpeth: there is no argument "dpeth"; the arguments are: depth, count, limit, deep, note, mode, up']);
    expect(problem(specs, [1])[0]).toBe('invalidArguments');
    expect(problem(specs, 'depth')[2]).toBe('arguments: an object with the named arguments is expected');
  });

  it('IDs: a body in the bodies of the state, a feature and a sketch among the features it evaluated', () => {
    const specs = { body: { kind: 'body', title: 'Body', optional: true }, feature: { kind: 'feature', title: 'Feature', optional: true }, sketch: { kind: 'sketch', title: 'Sketch', optional: true } } as const satisfies ArgSpecs;
    expect(value(specs, { body: 'E1', feature: 'PL', sketch: 'S1' })).toEqual({ body: 'E1', feature: 'PL', sketch: 'S1' });
    expect(problem(specs, { body: 'S1' })).toEqual(['notAvailable', 'body', 'body: the body "S1" is not in the state asked about']);
    expect(problem(specs, { body: 7 })).toEqual(['invalidArguments', 'body', 'body: the ID of a body is expected']);
    // a mistyped ID and one that comes after the state asked about are the same answer
    expect(problem(specs, { feature: 'nope' })[0]).toBe('notAvailable');
    expect(problem(specs, { feature: 'S9' })).toEqual(['notAvailable', 'feature', 'feature: the feature "S9" is not in the state asked about']);
    expect(problem(specs, { sketch: 'S9' })[0]).toBe('notAvailable');
    expect(problem(specs, { sketch: 'E1' })).toEqual(['notAvailable', 'sketch', 'sketch: the sketch "E1" is not in the state asked about']);
    expect(problem(specs, { sketch: 'constructor' })[0]).toBe('notAvailable');
  });

  it('a constraint is looked up in the sketch named next to it', () => {
    const specs = { constraint: { kind: 'constraint', of: 'sketch', title: 'Constraint' }, sketch: { kind: 'sketch', title: 'Sketch' } } as const satisfies ArgSpecs;
    expect(value(specs, { sketch: 'S1', constraint: 'r' })).toEqual({ constraint: 'r', sketch: 'S1' });
    expect(problem(specs, { sketch: 'S1', constraint: 'q' })).toEqual(['notAvailable', 'constraint', 'constraint: the sketch "S1" has no constraint "q"']);
    // the constraint is described first, so its sketch is what is reported
    expect(problem(specs, { sketch: 'S9', constraint: 'r' })).toEqual(['notAvailable', 'sketch', 'sketch: the sketch "S9" is not in the state asked about']);
    // inside fields the sketch is another of those fields
    const nested = { pair: { kind: 'fields', title: 'Pair', fields: { sketch: { kind: 'sketch' }, constraint: { kind: 'constraint', of: 'sketch' } } } } as const satisfies ArgSpecs;
    expect(value(nested, { pair: { sketch: 'S1', constraint: 'r' } })).toEqual({ pair: { sketch: 'S1', constraint: 'r' } });
    expect(problem(nested, { pair: { sketch: 'S1', constraint: 'q' } })[1]).toBe('pair.constraint');
    // a name a record of fields does not have is told with the names it has (D73)
    expect(problem(nested, { pair: { sketch: 'S1', constrain: 'r' } })).toEqual(['invalidArguments', 'pair.constrain', 'pair.constrain: there is no field "constrain"; the fields are: sketch, constraint']);
  });

  it('entities, planes and axes: the shape by the validators of the document, the thing by the state', () => {
    const specs = {
      what: { kind: 'entity', accepts: ['body', 'face', 'edge', 'sketchPoint'], title: 'What', optional: true },
      face: { kind: 'entity', accepts: ['face'], title: 'Face', optional: true },
      plane: { kind: 'plane', title: 'Plane', optional: true },
      axis: { kind: 'axis', title: 'Axis', optional: true },
    } as const satisfies ArgSpecs;
    expect(value(specs, { what: { kind: 'body', body: 'E1', extra: 1 } })).toEqual({ what: { kind: 'body', body: 'E1' } });
    expect(value(specs, { what: { kind: 'face', body: 'E1', face: { role: 'endCap', feature: 'E1', copy: [] } } })).toEqual({ what: { kind: 'face', body: 'E1', face: cap } }); // the canonical name
    expect(value(specs, { what: { kind: 'edge', body: 'E1', edge: { a: wall, b: cap } } })).toEqual({ what: { kind: 'edge', body: 'E1', edge: rim } }); // the canonical order
    expect(value(specs, { what: { kind: 'sketchPoint', sketch: 'S1', point: 'origin' } })).toEqual({ what: { kind: 'sketchPoint', sketch: 'S1', point: 'origin' } });
    expect(problem(specs, { what: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'startCap' } } })).toEqual(['notAvailable', 'what.face', 'what.face: the body "E1" has no face E1/startCap']);
    expect(problem(specs, { what: { kind: 'face', body: 'nope', face: cap } })[1]).toBe('what.body');
    expect(problem(specs, { what: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'top' } } })).toEqual(['invalidArguments', 'what.face', expect.stringMatching(/^what\.face\.role: /)]);
    expect(problem(specs, { what: { kind: 'edge', body: 'E1', edge: { a: cap, b: { feature: 'E1', role: 'startCap' } } } })[0]).toBe('notAvailable');
    expect(problem(specs, { what: { kind: 'sketchPoint', sketch: 'S1', point: 'c' } })).toEqual(['notAvailable', 'what.point', 'what.point: the sketch "S1" has no point "c"']);
    expect(problem(specs, { what: { kind: 'sketchPoint', sketch: 'S9', point: 'origin' } })[1]).toBe('what.sketch');
    expect(problem(specs, { face: { kind: 'body', body: 'E1' } })).toEqual(['invalidArguments', 'face', 'face: an entity of the kind face is expected, as { kind, ... }']);
    expect(problem(specs, { what: 'E1' })[0]).toBe('invalidArguments');

    expect(value(specs, { plane: { kind: 'base', plane: 'XZ' } })).toEqual({ plane: { kind: 'base', plane: 'XZ' } });
    expect(value(specs, { plane: { kind: 'plane', feature: 'PL' } })).toEqual({ plane: { kind: 'plane', feature: 'PL' } });
    expect(value(specs, { plane: { kind: 'face', body: 'E1', face: cap } })).toEqual({ plane: { kind: 'face', body: 'E1', face: cap } });
    expect(problem(specs, { plane: { kind: 'plane', feature: 'E1' } })).toEqual(['notAvailable', 'plane.feature', 'plane.feature: the plane "E1" is not in the state asked about']);
    expect(problem(specs, { plane: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'startCap' } } })[1]).toBe('plane.face');
    expect(problem(specs, { plane: { kind: 'base', plane: 'ZZ' } })).toEqual(['invalidArguments', 'plane', expect.stringMatching(/^plane\.plane: /)]);

    expect(value(specs, { axis: { kind: 'base', axis: 'Z' } })).toEqual({ axis: { kind: 'base', axis: 'Z' } });
    expect(value(specs, { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } })).toEqual({ axis: { kind: 'sketchPoint', sketch: 'S1', point: 'p' } });
    expect(problem(specs, { axis: { kind: 'sketchPoint', sketch: 'S1', point: 'nope' } })[0]).toBe('notAvailable');
    expect(problem(specs, { axis: { kind: 'base', axis: 'Z', sketch: 'S1' } })[0]).toBe('invalidArguments');
  });

  it('structure: lists, exactly one alternative, records by key, fields; defaults and paths at every depth', () => {
    const specs = {
      orientations: {
        kind: 'list',
        min: 1,
        max: 3,
        title: 'Orientations',
        of: {
          kind: 'fields',
          fields: {
            by: { kind: 'oneOf', options: { up: { kind: 'vector' }, onBed: { kind: 'entity', accepts: ['face'] } } },
            spin: { kind: 'number', optional: true, spec: { title: 'Spin', unit: 'rad', default: 0 } },
          },
        },
      },
      densities: { kind: 'record', keys: 'body', of: { kind: 'number', spec: { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true } } }, title: 'Densities', optional: true },
      names: { kind: 'record', keys: 'text', of: { kind: 'text' }, title: 'Names', optional: true },
      steps: { kind: 'record', keys: 'feature', of: { kind: 'flag' }, title: 'Steps', optional: true },
    } as const satisfies ArgSpecs;
    const onBed = { kind: 'face', body: 'E1', face: cap };
    expect(value(specs, { orientations: [{ by: { up: [0, 0, 1] } }, { by: { onBed }, spin: 1 }], densities: { E1: 1.24 }, names: { anything: 'x' }, steps: { PL: true } })).toEqual({
      orientations: [
        { by: { up: [0, 0, 1] }, spin: 0 },
        { by: { onBed }, spin: 1 },
      ],
      densities: { E1: 1.24 },
      names: { anything: 'x' },
      steps: { PL: true },
    });
    expect(problem(specs, { orientations: [] })).toEqual(['invalidArguments', 'orientations', 'orientations: at least 1 item is expected']);
    expect(problem(specs, { orientations: [1, 2, 3, 4] })[2]).toBe('orientations: at most 3 items are expected');
    expect(problem(specs, { orientations: { 0: {} } })[2]).toBe('orientations: a list is expected');
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] } }, { by: { up: [0, 0, 1], onBed } }] })).toEqual(['invalidArguments', 'orientations[1].by', 'orientations[1].by: an object with exactly one of up, onBed is expected']);
    expect(problem(specs, { orientations: [{ by: {} }] })[1]).toBe('orientations[0].by');
    expect(problem(specs, { orientations: [{ by: { down: [0, 0, 1] } }] })[1]).toBe('orientations[0].by');
    expect(problem(specs, { orientations: [{ by: { onBed: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'startCap' } } } }] })).toEqual(['notAvailable', 'orientations[0].by.onBed.face', expect.any(String)]);
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] }, spni: 1 }] })[1]).toBe('orientations[0].spni');
    expect(problem(specs, { orientations: [{}] })).toEqual(['invalidArguments', 'orientations[0].by', 'orientations[0].by: the argument is required']);
    // a key of a record is one segment of the path, and an ID like any other
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] } }], densities: { E1: 1, E2: 2 } })).toEqual(['notAvailable', 'densities.E2', 'densities.E2: the body "E2" is not in the state asked about']);
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] } }], densities: { E1: 0 } })[1]).toBe('densities.E1');
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] } }], steps: { S9: true } })[0]).toBe('notAvailable');
    expect(problem(specs, { orientations: [{ by: { up: [0, 0, 1] } }], names: JSON.parse('{ "__proto__": "x" }') })[0]).toBe('invalidArguments');
  });

  it('what the types let through: `of` of a constraint must name a required sketch next to it', () => {
    expect(specProblems({ sketch: { kind: 'sketch' }, constraint: { kind: 'constraint', of: 'sketch' } })).toEqual([]);
    expect(specProblems({ sketch: { kind: 'sketch', optional: true }, constraint: { kind: 'constraint', of: 'sketch' } })).toHaveLength(1);
    expect(specProblems({ body: { kind: 'body' }, constraint: { kind: 'constraint', of: 'body' } })).toHaveLength(1);
    expect(specProblems({ constraint: { kind: 'constraint', of: 'sketch' } })[0]).toMatch(/^constraint: `of` must name/);
    expect(specProblems({ sketch: { kind: 'sketch' }, all: { kind: 'list', of: { kind: 'constraint', of: 'sketch' } } })).toEqual([]);
    // inside fields the sketch has to be among those fields, not outside
    expect(specProblems({ sketch: { kind: 'sketch' }, pair: { kind: 'fields', fields: { constraint: { kind: 'constraint', of: 'sketch' } } } })).toEqual(['pair.constraint: `of` must name a required argument of the kind sketch next to it, not "sketch"']);
  });
});

describe('arguments of a query: the type that follows from the description', () => {
  const specs = {
    body: { kind: 'body', title: 'Body' },
    threshold: { kind: 'number', title: 'Threshold', optional: true, spec: { title: 'Threshold', unit: 'mm3', default: 0.001 } },
    limit: { kind: 'number', title: 'Limit', optional: true, spec: { title: 'Limit', unit: 'count' } },
    mode: { kind: 'choice', options: ['fast', 'exact'], title: 'Mode', optional: true },
    target: { kind: 'entity', accepts: ['face', 'edge'], title: 'Target', optional: true },
    by: { kind: 'oneOf', options: { up: { kind: 'vector' }, onBed: { kind: 'entity', accepts: ['face'] } }, title: 'By', optional: true },
    rows: { kind: 'list', of: { kind: 'fields', fields: { name: { kind: 'text' }, spin: { kind: 'number', optional: true, spec: { title: 'Spin', unit: 'rad', default: 0 } } } }, title: 'Rows', optional: true },
  } as const satisfies ArgSpecs;
  type Given = ArgsOf<typeof specs>;
  type Run = RunArgsOf<typeof specs>;

  it('what a caller may write and what run receives', () => {
    const minimal: Given = { body: 'E1' };
    const full: Given = { body: 'E1', threshold: 1, limit: 2, mode: 'exact', target: { kind: 'edge', body: 'E1', edge: rim }, by: { up: [0, 0, 1] }, rows: [{ name: 'a' }, { name: 'b', spin: 1 }] };
    // @ts-expect-error a required argument is missing
    const missing: Given = { threshold: 1 };
    // @ts-expect-error there is no such argument
    const unknown: Given = { body: 'E1', bodies: [] };
    // @ts-expect-error not one of the options
    const choice: Given = { body: 'E1', mode: 'slow' };
    // @ts-expect-error a body is not among the kinds the argument accepts
    const kind: Given = { body: 'E1', target: { kind: 'body', body: 'E1' } };
    // @ts-expect-error both alternatives at once
    const both: Given = { body: 'E1', by: { up: [0, 0, 1], onBed: { kind: 'face', body: 'E1', face: cap } } };
    // run: a number with a default is always there, at every depth; one without may be missing
    const run = value(specs, full) as Run;
    const threshold: number = run.threshold;
    const spin: number | undefined = run.rows?.[0].spin;
    // @ts-expect-error an optional number without a default may be missing
    const limit: number = run.limit;
    expect([minimal, missing, unknown, choice, kind, both].length).toBe(6);
    expect([threshold, spin, limit]).toEqual([1, 0, 2]);
  });
});

describe('results kept by their owners', () => {
  it('the same owners and key give the stored result, in any order; another owner or key computes again', () => {
    const memo = new Memo();
    const [a, b, c] = [{}, {}, {}];
    let runs = 0;
    const ask = (owners: object[], key: string) => memo.get(owners, key, () => ++runs);
    expect(ask([a, b], 'k')).toBe(1);
    expect(ask([a, b], 'k')).toBe(1);
    expect(ask([b, a], 'k')).toBe(1);
    expect(ask([a, b, a], 'k')).toBe(1); // an owner named twice is one owner
    expect(ask([a, b], 'other')).toBe(2);
    expect(ask([a], 'k')).toBe(3);
    expect(ask([a, c], 'k')).toBe(4);
    expect(ask([c, b, a], 'k')).toBe(5);
    expect(ask([a, c, b], 'k')).toBe(5);
    expect(() => ask([], 'k')).toThrow(/at least one owner/);
    // a result that is undefined is still a result
    let empty = 0;
    for (let i = 0; i < 2; i++) memo.get([a], 'empty', () => void empty++);
    expect(empty).toBe(1);
  });
});
