// The tool `query` and the guards of the catalog of queries (D37).
// - A query added to the catalog without a row in the two tables below does not compile.
// - The test runs every query through the tool, and compares what the types let through: the names
//   of the arguments of an entry and which of them are optional.
import { type AnyQuery, type Command, DATA_CATALOGS, type Engine, QUERIES, type QueryArgs, type QueryName, specProblems } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { apiDescription, apiText, argumentText } from '../src/api';
import { callTool, changesDocument, tools } from '../src/tools';
import { newEngine } from './kit';

const call = (engine: Engine, args: Record<string, unknown>): any => {
  const outcome = callTool(engine, 'query', args);
  return outcome.ok ? outcome.result : { error: outcome.error };
};
const execute = (engine: Engine, command: Command) => {
  const outcome = callTool(engine, 'execute', { command });
  if (!outcome.ok) throw new Error(outcome.error);
};

// Two discs from one circle: `low` from 0 to 10 and `high` from 9.99 to 20, so they share a slice
// 0.01 thick. The sketch `s` has a radius `r` and a diameter `d` of the same circle.
function model(): Engine {
  const engine = newEngine();
  const disc = (id: string, start: number, distance: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance }, operation: 'new' } });
  execute(engine, {
    type: 'batch',
    commands: [
      { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      { type: 'addConstraint', sketch: 's', id: 'r', constraint: { type: 'radius', curve: 'k', value: 5, driving: true } },
      { type: 'addConstraint', sketch: 's', id: 'd', constraint: { type: 'diameter', curve: 'k', value: 10, driving: false } },
      disc('low', 0, 10),
      disc('high', 9.99, 10.01),
    ],
  });
  return engine;
}

// ---------------------------------------------------------------- the guards

// Arguments of every query, of the query's own type, that it answers over `model()`.
const FIXTURES: { [N in QueryName]: QueryArgs<N> } = {
  interference: { bodies: ['low', 'high'], threshold: 0 },
  sketchDiagnosis: { sketch: 's' },
  constraintExplanation: { sketch: 's', constraint: 'r' },
  body: { body: 'low' },
  catalog: { name: Object.keys(DATA_CATALOGS)[0] ?? 'none' },
  measure: { from: { kind: 'face', body: 'low', face: { feature: 'low', role: 'startCap' } }, to: { kind: 'face', body: 'low', face: { feature: 'low', role: 'endCap' } } },
  section: { plane: { kind: 'base', plane: 'XY' }, offset: 5 },
  gap: {},
  mass: { bodies: ['low'], density: 1 },
  print: { orientations: [{ by: { up: [0, 0, 1] } }] },
};
// Every argument of every query and whether a caller may leave it out, as the type says. The
// compiler asks for each name and for the right word; the test compares the entry of the catalog.
const ARGUMENTS: { [N in QueryName]: { [K in keyof Required<QueryArgs<N>>]: {} extends Pick<QueryArgs<N>, K> ? 'optional' : 'required' } } = {
  interference: { bodies: 'optional', threshold: 'optional' },
  sketchDiagnosis: { sketch: 'required' },
  constraintExplanation: { sketch: 'required', constraint: 'required' },
  body: { body: 'required' },
  catalog: { name: 'required', key: 'optional' },
  measure: { from: 'required', to: 'required' },
  section: { plane: 'required', offset: 'optional', flip: 'optional', bodies: 'optional', outline: 'optional', maxPoints: 'optional' },
  gap: { bodies: 'optional', within: 'optional', maxPairs: 'optional' },
  mass: { bodies: 'required', density: 'optional', densities: 'optional', fill: 'optional', about: 'optional' },
  print: { bodies: 'optional', orientations: 'required', bed: 'optional', overhang: 'optional', minArea: 'optional', maxFaces: 'optional' },
};
const ENTRIES = Object.entries(QUERIES as Record<string, AnyQuery>);

describe('the catalog of queries', () => {
  it.each(ENTRIES)('%s: the arguments of the entry are those of its type', (name, spec) => {
    const described = Object.fromEntries(Object.entries(spec.args).map(([arg, description]) => [arg, description.optional ? 'optional' : 'required']));
    expect(described).toEqual(ARGUMENTS[name as QueryName]);
    expect(specProblems(spec.args)).toEqual([]);
    expect(spec.title && spec.summary && spec.returns).toBeTruthy();
    for (const key of Object.keys(FIXTURES[name as QueryName])) expect(Object.keys(spec.args)).toContain(key);
  });

  it.each(ENTRIES)('%s is reached by the tool query and described to the AI', (name) => {
    const engine = model();
    const answer = call(engine, { query: name, args: FIXTURES[name as QueryName] });
    // the engine has no data catalog yet, so the query `catalog` has nothing to answer with; the
    // first catalog makes this branch fail, and its name is then the fixture by itself
    if (name === 'catalog' && Object.keys(DATA_CATALOGS).length === 0) {
      expect(answer).toEqual({ error: 'notAvailable: catalog: name: there is no catalog "none"; the engine has no catalog yet' });
      return;
    }
    expect(answer?.error, JSON.stringify(answer)).toBeUndefined();
    expect(answer).toEqual(JSON.parse(JSON.stringify(answer))); // plain JSON
    const described = apiDescription().queries.find((entry) => entry.query === name);
    expect(described?.args.map((arg) => arg.name)).toEqual(Object.keys(QUERIES[name as QueryName].args));
    expect(apiText()).toContain(`- ${name} (`);
  });

  it('the tool lists the queries and the description has their arguments in words', () => {
    const tool = tools().find((candidate) => candidate.name === 'query');
    expect((tool?.inputSchema as { properties: { query: { enum: string[] } } }).properties.query.enum).toEqual(Object.keys(QUERIES));
    for (const name of Object.keys(QUERIES)) expect(tool?.description).toContain(name);
    // `null` counts as not given, as for the arguments of every tool; only at the top level of `args`
    const engine = model();
    expect(call(engine, { query: 'interference', args: { bodies: null, threshold: null }, at: null, after: null })).toEqual(call(engine, { query: 'interference' }));
    expect(call(engine, { query: 'interference', args: null })).toEqual(call(engine, { query: 'interference' }));
    expect(call(engine, { query: 'interference', args: { bodies: ['low', null] } })).toEqual({ error: 'invalidArguments: interference: bodies[1]: the ID of a body is expected' });
    const text = apiText();
    expect(text).toContain('# Queries');
    expect(text).toContain('  - bodies (optional): a list, each item the ID of a body. The bodies to check against each other; without it all bodies.');
    expect(text).toContain('  - threshold (optional): a number, non-negative, mm3, default 0.001. The smallest shared volume that counts.');
    expect(text).toContain('  - constraint: the ID of a constraint of the sketch given in `sketch`');
    expect(text).toContain('- measure (Measure): Distance and angle between two faces, edges or sketch points.');
    expect(text).toContain('  - from: an entity of the model: { kind: "face", body, face: FaceName } or { kind: "edge", body, edge: EdgeName } or { kind: "sketchPoint", sketch, point } (the point `origin` is the origin of the sketch). A face or an edge of a body, or a sketch point.');
    // an alternative and a field may say what they are for (D39); the summary follows in brackets
    expect(argumentText({ kind: 'oneOf', options: { up: { kind: 'vector', title: 'Up', summary: 'The direction that points up.' }, turn: { kind: 'fields', fields: { about: { kind: 'vector' }, by: { kind: 'flag', optional: true, summary: 'A quarter turn' } } } } })).toBe(
      'an object with exactly one of these keys: up: three numbers [x, y, z] (The direction that points up); turn: an object { about: three numbers [x, y, z]; by (optional): true or false (A quarter turn) }',
    );
    expect(text).not.toMatch(/^import type/m); // the import of types.ts is not part of the description
    expect(text).toContain('query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;');
  });
});

// ---------------------------------------------------------------- the tool

describe('the tool query', () => {
  it('answers for the model, rounded: six decimal places, and the significant digits a query asks for', () => {
    const engine = model();
    const raw = engine.interference({ threshold: 0 });
    expect(raw.pairs).toHaveLength(1);
    const answer = call(engine, { query: 'interference', args: { threshold: 0 } });
    expect(answer).toEqual({ pairs: [{ a: 'high', b: 'low', volume: Number(raw.pairs[0].volume.toPrecision(6)), depth: Number(raw.pairs[0].depth.toPrecision(4)) }], fits: [], failed: [], checked: 1 });
    // what check_interference prints for the same pair
    const tool = callTool(engine, 'check_interference', { threshold: 0 });
    expect(tool.ok && (tool.result as { pairs: unknown[] }).pairs).toEqual(answer.pairs);
    expect(call(engine, { query: 'sketchDiagnosis', args: { sketch: 's' } })).toMatchObject({ status: 'solved', degreesOfFreedom: 0 });
    expect(call(engine, { query: 'constraintExplanation', args: { sketch: 's', constraint: 'd' } })).toEqual(engine.explainConstraint('s', 'd'));
    expect(call(engine, { query: 'interference' })).toMatchObject({ checked: 1 }); // no arguments at all
    // the gap (D40): the two discs share a slice, so their distance is zero and the kind of zero is said
    expect(call(engine, { query: 'gap' })).toEqual({ within: 5, pairs: [{ a: 'high', b: 'low', distance: 0, contact: 'collision' }], close: 1, apart: 0, failed: [], refused: 0, checked: 1 });
    // lifted by 0.1234567 mm above the lower disc: the distance is printed to six significant digits, the accuracy to three
    const lifted = call(engine, { query: 'gap', args: { bodies: ['low', 'high'] }, after: { type: 'setField', feature: 'high', path: 'extent/start', value: 10.1234567 } });
    expect(lifted.pairs).toMatchObject([{ a: 'high', b: 'low', distance: 0.123457, accuracy: 0.02 }]);
    // the mass (D41): six significant digits for the mass and the inertia, six decimal places for the rest
    const weighed = engine.query('mass', { bodies: ['low'], density: 1.24 });
    if (!weighed.ok) throw new Error(weighed.error.message);
    const printed = call(engine, { query: 'mass', args: { bodies: ['low'], density: 1.24 } });
    expect(printed.mass).toBe(Number(weighed.result.mass.toPrecision(6)));
    expect(printed.inertia[2][2]).toBe(Number(weighed.result.inertia[2][2].toPrecision(6)));
    expect(printed.volume).toBe(Math.round(weighed.result.volume * 1e6) / 1e6);
    expect(printed.bodies).toMatchObject([{ body: 'low', density: 1.24, fill: 1 }]);
    expect(call(engine, { query: 'mass', args: { bodies: ['low'] } })).toEqual({ error: expect.stringContaining('invalidArguments: mass: density: the body "low" has no density of its own') });
    expect(call(engine, { query: 'gap', args: { bodies: ['low', 'low'] } })).toEqual({ error: 'invalidArguments: gap: bodies: two different bodies are needed for a pair' });
  });

  it('`at` asks after a feature and `after` about a change that is not written', () => {
    const engine = model();
    const before = engine.save();
    expect(call(engine, { query: 'interference', at: 'low' })).toEqual({ pairs: [], fits: [], failed: [], checked: 0 });
    // the upper disc lifted by a millimetre: the discs no longer meet
    const lifted: Command = { type: 'setField', feature: 'high', path: 'extent/start', value: 11 };
    expect(call(engine, { query: 'interference', after: lifted })).toEqual({ pairs: [], fits: [], failed: [], checked: 1 });
    expect(call(engine, { query: 'interference' }).pairs).toHaveLength(1);
    // a batch, and both options: the document after the command, evaluated up to `at`
    expect(call(engine, { query: 'interference', after: { type: 'batch', commands: [lifted, { type: 'renameFeature', id: 'low', name: 'Low' }] }, at: 'low' })).toMatchObject({ checked: 0 });
    expect(call(engine, { query: 'sketchDiagnosis', args: { sketch: 's' }, after: { type: 'removeConstraint', sketch: 's', id: 'r' } })).toMatchObject({ status: 'solved', degreesOfFreedom: 1 });
    expect(engine.save()).toBe(before);
    expect(engine.getState().canUndo).toBe(true); // only the model itself
    expect(changesDocument(engine, 'query', { query: 'interference', after: lifted })).toBe(false);
  });

  it('an error is a text with its code; a call the schema does not allow does not reach the engine', () => {
    const engine = model();
    expect(call(engine, { query: 'interference', args: { bodies: ['low', 'nope'] } })).toEqual({ error: 'notAvailable: interference: bodies[1]: the body "nope" is not in the state asked about' });
    expect(call(engine, { query: 'interference', args: { threshold: -1 } })).toEqual({ error: 'invalidArguments: interference: threshold: the value must not be negative' });
    expect(call(engine, { query: 'interference', at: 'nope' })).toEqual({ error: 'notAvailable: interference: `at`: the feature "nope" is not in the document' });
    expect(call(engine, { query: 'nope' })).toEqual({ error: expect.stringContaining('invalidArguments: there is no query "nope"') });
    expect(call(engine, { query: 'interference', after: { type: 'removeFeature', id: 'nope' } })).toEqual({ error: expect.stringMatching(/^after: invalidCommand: /) });
    expect(call(engine, { query: 'interference', after: { type: 'renameFeature', id: 'low', name: 'x' }, at: 'nope' })).toEqual({ error: expect.stringMatching(/^after: invalidCommand: /) });
    expect(call(engine, {})).toEqual({ error: expect.stringContaining('"query"') });
    expect(call(engine, { query: 'interference', bodies: ['low'] })).toEqual({ error: 'unknown argument "bodies"; the tool takes query, args, at, after' });
    expect(call(engine, { query: 'interference', args: ['low'] })).toEqual({ error: 'argument "args": an object is expected' });
    expect(call(engine, { query: 'interference', after: 'undo' })).toEqual({ error: 'argument "after": an object is expected' });
  });
});
