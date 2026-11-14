// Nástroje pro AI nad skutečným enginem: popis API vychází ze zdrojů enginu, dotazy na model
// a skicu vracejí to, co engine spočítal, a příkazy procházejí beze změny.
import { CONSTRAINTS, FEATURE_TYPE_INFO, GENERATORS, type Command, type Constraint, type Engine } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { apiDescription, apiText, constraintCatalog, engineTypes } from '../src/api';
import { callTool, tools } from '../src/tools';
import { newEngine } from './kit';

const ok = (engine: Engine, name: string, args: Record<string, unknown> = {}): any => {
  const outcome = callTool(engine, name, args);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
};
const execute = (engine: Engine, command: Command) => ok(engine, 'execute', { command });
const sketch = (id: string): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
const constrain = (id: string, constraint: Constraint): Command => ({ type: 'addConstraint', sketch: 's', id, constraint });

// Obdélník 40 × 30 od ruky; `anchored` ho přichytí k počátku.
function rectangle(engine: Engine, anchored: boolean) {
  const corners: [string, number, number][] = [
    ['a', 0.4, -0.3],
    ['b', 39.2, 0.6],
    ['c', 40.7, 29.5],
    ['d', -0.6, 30.4],
  ];
  return execute(engine, {
    type: 'batch',
    commands: [
      sketch('s'),
      ...corners.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 's', id, x, y })),
      ...corners.map(([id], i): Command => ({ type: 'addCurve', sketch: 's', id: `${id}${corners[(i + 1) % 4][0]}`, curve: { type: 'line', a: id, b: corners[(i + 1) % 4][0] } })),
      constrain('h1', { type: 'horizontal', line: 'ab' }),
      constrain('v1', { type: 'vertical', line: 'bc' }),
      constrain('h2', { type: 'horizontal', line: 'cd' }),
      constrain('v2', { type: 'vertical', line: 'da' }),
      constrain('w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true }),
      constrain('h', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true }),
      ...(anchored ? [constrain('fix', { type: 'coincident', a: 'a', b: 'origin' })] : []),
    ],
  });
}

describe('popis API', () => {
  it('katalog vazeb obsahuje každou vazbu enginu a každý příklad engine přijme', () => {
    const catalog = constraintCatalog();
    expect(catalog.map((entry) => entry.type).sort()).toEqual(Object.keys(CONSTRAINTS).sort());
    // Skica s entitami všech druhů; příklad z katalogu se doplní skutečnými ID a pošle enginu.
    const engine = newEngine();
    execute(engine, {
      type: 'batch',
      commands: [
        sketch('s'),
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((i): Command => ({ type: 'addPoint', sketch: 's', id: `p${i}`, x: 10 * i, y: 3 * i * (i % 2 ? 1 : -1) })),
        { type: 'addCurve', sketch: 's', id: 'l1', curve: { type: 'line', a: 'p1', b: 'p2' } },
        { type: 'addCurve', sketch: 's', id: 'l2', curve: { type: 'line', a: 'p3', b: 'p4' } },
        { type: 'addCurve', sketch: 's', id: 'k1', curve: { type: 'circle', center: 'p5' }, radius: 4 },
        { type: 'addCurve', sketch: 's', id: 'k2', curve: { type: 'circle', center: 'p6' }, radius: 6 },
      ],
    });
    const pick: Record<string, string[]> = { point: ['p7', 'p8'], line: ['l1', 'l2'], circle: ['k1', 'k2'], arc: [] };
    for (const entry of catalog) {
      const used: Record<string, number> = {};
      const example = { ...entry.example };
      for (const operand of entry.operands) {
        // první druh, pro který ještě zbývá entita; tečnost dvou úseček engine nebere, proto u ní kružnice
        const kind = (entry.type === 'tangent' ? ['circle'] : operand.kinds).find((candidate) => (used[candidate] ?? 0) < pick[candidate].length) as string;
        example[operand.field] = pick[kind][used[kind] ?? 0];
        used[kind] = (used[kind] ?? 0) + 1;
      }
      const result = callTool(engine, 'preview', { command: { type: 'addConstraint', sketch: 's', id: `x-${entry.type}`, constraint: example } });
      expect(result, entry.type).toMatchObject({ ok: true, result: { ok: true } });
    }
  });

  it('typy se berou ze zdroje enginu: obsahují příkazy a dokument, neobsahují porty', () => {
    const types = engineTypes();
    expect(types).toContain('export type Command =');
    expect(types).toContain('export interface SketchFeature');
    expect(types).toContain('export interface SketchDiagnosis');
    expect(types).not.toContain('interface SolidKernel');
    expect(types).not.toContain('interface SketchSolver');
    // každý typ vazby z katalogu je i v typech
    for (const type of Object.keys(CONSTRAINTS)) expect(types, type).toContain(`'${type}'`);
  });

  it('describe_api vrací konvence, katalog a typy; seznam nástrojů neukazuje vnitřní nástroje', () => {
    const description: string = ok(newEngine(), 'describe_api');
    expect(description).toBe(apiText());
    expect(description).toMatch(/^# Konvence\n- Délky jsou v milimetrech/);
    expect(description).toContain('export type Command =');
    for (const [type, spec] of Object.entries(CONSTRAINTS)) expect(description, type).toContain(`- ${type} (${spec.title}) {`);
    expect(description).toContain('- distance (Vzdálenost) { a: point, b: point; value: non-negative, mm }');
    // typy features jsou z registru enginu
    for (const [type, info] of Object.entries(FEATURE_TYPE_INFO)) expect(description, type).toContain(`- ${type} (${info.title}): `);
    expect(description).toContain('updateFeature mění pole: profile, extent, operation, targets.');
    expect(description).toMatch(/- sketch \(Skica\): .* Obsah mění vlastní příkazy, ne updateFeature\./);
    const listed = tools().filter((tool) => !tool.hidden).map((tool) => tool.name);
    expect(listed).toEqual(['describe_api', 'get_model', 'get_document', 'get_sketch', 'get_parameters', 'explain_constraint', 'get_body', 'execute', 'preview', 'undo', 'redo']);
    // popis execute vyjmenuje vazby z katalogu
    const executeTool = tools().find((tool) => tool.name === 'execute')!;
    for (const type of Object.keys(CONSTRAINTS)) expect(executeTool.description).toContain(type);
  });
});

describe('dotazy na skicu', () => {
  it('get_sketch u neukotveného obdélníku řekne, co je volné a čím skicu dourčit', () => {
    const engine = newEngine();
    expect(rectangle(engine, false)).toMatchObject({ ok: true, problems: [], sketches: [{ id: 's', degreesOfFreedom: 2, profileValid: true, regions: 1 }] });
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    expect(detail.status).toBe('ok');
    expect(detail.diagnosis).toMatchObject({ status: 'solved', degreesOfFreedom: 2, redundant: [], removable: [] });
    expect(detail.points).toEqual(['a', 'b', 'c', 'd'].map((id) => ({ id, at: [expect.any(Number), expect.any(Number)], freedom: 2 })));
    expect(detail.curves[0]).toEqual({ id: 'ab', type: 'line', a: 'a', b: 'b' });
    expect(detail.constraints.find((c: { id: string }) => c.id === 'w')).toEqual({ id: 'w', label: 'Vodorovná vzdálenost (a, b)', type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    expect(detail.regions).toEqual([{ ref: { outerLoop: ['ab', 'bc', 'cd', 'da'] }, area: expect.closeTo(1200, 4), holes: 0 }]);
    expect(detail.advice.join(' ')).toMatch(/2 stupně volnosti/);
    expect(detail.advice.join(' ')).toMatch(/určení polohy jednoho z bodů a, b, c, d \(například vodorovnou a svislou kótou od počátku\)/);
  });

  it('rada při jednom stupni volnosti nenavrhuje totožnost, která by skončila konfliktem', () => {
    const engine = newEngine();
    rectangle(engine, true);
    execute(engine, { type: 'removeConstraint', sketch: 's', id: 'h' });
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    expect(detail.diagnosis.degreesOfFreedom).toBe(1);
    const advice = detail.advice.join(' ');
    expect(advice).toMatch(/1 stupeň volnosti/);
    expect(advice).toMatch(/určení polohy jednoho z bodů c, d \(jednou kótou nebo vazbou/);
    expect(advice).not.toMatch(/například vazbou coincident/);
    // totožnost s počátkem je opravdu konflikt, jedna kóta skicu určí
    expect(ok(engine, 'preview', { command: constrain('bad', { type: 'coincident', a: 'c', b: 'origin' }) }).sketches[0]).toMatchObject({ solved: false });
    expect(execute(engine, constrain('fixed', { type: 'verticalDistance', a: 'origin', b: 'c', value: 30, driving: true })).sketches[0]).toEqual({ id: 's', solved: true, degreesOfFreedom: 0, profileValid: true, regions: 1 });
  });

  it('počet stupňů volnosti se skloňuje', () => {
    const engine = newEngine();
    execute(engine, { type: 'batch', commands: [sketch('s'), { type: 'addPoint', sketch: 's', id: 'p', x: 1, y: 1 }, { type: 'addPoint', sketch: 's', id: 'q', x: 5, y: 1 }, { type: 'addPoint', sketch: 's', id: 'r', x: 9, y: 4 }] });
    expect(ok(engine, 'get_sketch', { sketch: 's' }).advice[0]).toMatch(/^Skica má 6 stupňů volnosti/);
  });

  it('po ukotvení je skica určená; vazba navíc se označí a explain_constraint ji vysvětlí', () => {
    const engine = newEngine();
    rectangle(engine, true);
    expect(ok(engine, 'get_sketch', { sketch: 's' }).advice).toEqual(['Skica je plně určená.']);
    execute(engine, constrain('par', { type: 'parallel', a: 'ab', b: 'cd' }));
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    expect(detail.constraints.find((c: { id: string }) => c.id === 'par')).toMatchObject({ surplus: true, label: 'Rovnoběžně (ab, cd)' });
    expect(detail.advice.join(' ')).toMatch(/Vazby navíc: par\./);
    expect(ok(engine, 'explain_constraint', { sketch: 's', constraint: 'par' })).toEqual({
      constraint: { id: 'par', label: 'Rovnoběžně (ab, cd)' },
      redundant: true,
      impliedBy: [
        { id: 'h1', label: 'Vodorovně (ab)', removableInstead: true },
        { id: 'h2', label: 'Vodorovně (cd)', removableInstead: true },
      ],
      note: 'Odebrat jde vazba sama nebo kterákoli z vazeb v impliedBy; geometrie se nezmění.',
    });
    expect(ok(engine, 'explain_constraint', { sketch: 's', constraint: 'w' })).toMatchObject({ redundant: false, impliedBy: [] });
  });

  it('explain_constraint neradí odebrat vazbu, bez které by se skica uvolnila', () => {
    // bod na úsečce plyne ze středu úsečky, ale střed určuje i polohu bodu podél úsečky
    const engine = newEngine();
    rectangle(engine, false);
    execute(engine, { type: 'addPoint', sketch: 's', id: 'm', x: 18, y: 1 });
    execute(engine, constrain('mid', { type: 'midpoint', point: 'm', line: 'ab' }));
    execute(engine, constrain('on', { type: 'pointOnCurve', point: 'm', curve: 'ab' }));
    const freedom = () => ok(engine, 'get_sketch', { sketch: 's' }).diagnosis.degreesOfFreedom;
    const before = freedom();
    const explained = ok(engine, 'explain_constraint', { sketch: 's', constraint: 'on' });
    expect(explained).toMatchObject({ redundant: true, impliedBy: [{ id: 'mid', removableInstead: false }] });
    expect(explained.note).toBe('Odebrat jde jen vazba sama; geometrie se nezmění. Vazby v impliedBy odebrat nejde: určují víc než tuhle vazbu a skica by se uvolnila.');
    // rada platí: bez `on` se volnost nezmění, bez `mid` vzroste
    expect(ok(engine, 'preview', { command: { type: 'removeConstraint', sketch: 's', id: 'on' } }).sketches[0].degreesOfFreedom).toBe(before);
    expect(ok(engine, 'preview', { command: { type: 'removeConstraint', sketch: 's', id: 'mid' } }).sketches[0].degreesOfFreedom).toBe(before + 1);
    // smíšený případ: jedna z vazeb, ze kterých plyne, je sama navíc, druhá ne
    execute(engine, constrain('co', { type: 'coincident', a: 'a', b: 'origin' }));
    execute(engine, constrain('hd', { type: 'horizontalDistance', a: 'origin', b: 'a', value: 0, driving: true }));
    expect(ok(engine, 'explain_constraint', { sketch: 's', constraint: 'hd' })).toMatchObject({ impliedBy: [{ id: 'co', removableInstead: false }] });
  });

  it('konflikt a referenční kóta', () => {
    const engine = newEngine();
    rectangle(engine, true);
    execute(engine, constrain('ref', { type: 'distance', a: 'a', b: 'c', value: 1, driving: false }));
    expect(ok(engine, 'get_sketch', { sketch: 's' }).constraints.find((c: { id: string }) => c.id === 'ref').measured).toBeCloseTo(50, 5);
    const result = execute(engine, constrain('bad', { type: 'distance', a: 'a', b: 'd', value: 31, driving: true }));
    expect(result.problems).toEqual([expect.objectContaining({ id: 's', status: 'warning', warnings: [expect.objectContaining({ code: 'sketchConflict' })] })]);
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    expect(detail.diagnosis.status).toBe('conflict');
    // přehledy u nevyřešené skici stupně volnosti neuvádějí
    expect(result.sketches).toEqual([{ id: 's', solved: false, conflicting: expect.arrayContaining(['bad']), profileValid: true, regions: 1 }]);
    expect(ok(engine, 'get_model').features[0]).toMatchObject({ id: 's', solved: false });
    expect(ok(engine, 'get_model').features[0]).not.toHaveProperty('degreesOfFreedom');
    expect(detail.constraints.find((c: { id: string }) => c.id === 'bad').conflicting).toBe(true);
    expect(detail.advice[0]).toMatch(/konfliktu/);
  });
});

describe('hrany tělesa', () => {
  it('kruhová hrana má střed a poloměr, hrana přerušená výřezem krajní body a příznak mezery', () => {
    const engine = newEngine();
    rectangle(engine, true);
    execute(engine, {
      type: 'batch',
      commands: [
        { type: 'addPoint', sketch: 's', id: 'm', x: 12, y: 14 },
        { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 5 },
        constrain('mx', { type: 'horizontalDistance', a: 'origin', b: 'm', value: 12, driving: true }),
        constrain('my', { type: 'verticalDistance', a: 'origin', b: 'm', value: 14, driving: true }),
        constrain('kr', { type: 'radius', curve: 'k', value: 5, driving: true }),
        { type: 'addFeature', feature: { id: 'e', name: 'Deska', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['ab', 'bc', 'cd', 'da'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
      ],
    });
    let body = ok(engine, 'get_body', { body: 'e' });
    const rim = body.edges.find((edge: { label: string }) => edge.label === 'e/endCap | e/side/k');
    expect(rim).toMatchObject({ kind: 'circle', center: [expect.closeTo(12, 4), expect.closeTo(14, 4), 10], radius: expect.closeTo(5, 4) });
    expect(rim.length).toBeGreaterThan(2 * Math.PI * 5 * 0.999);
    expect(rim.length).toBeLessThan(2 * Math.PI * 5);
    expect(rim).not.toHaveProperty('from');

    // zářez uprostřed přední hrany: hrana má dva kusy
    const top = body.faces.find((face: { label: string }) => face.label === 'e/endCap').name;
    const notch: [string, number, number][] = [['n1', 15, -2], ['n2', 25, -2], ['n3', 25, 4], ['n4', 15, 4]];
    execute(engine, {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { ...(sketch('s2') as Extract<Command, { type: 'addFeature' }>).feature, plane: { kind: 'face', body: 'e', face: top } } as never },
        ...notch.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 's2', id, x, y })),
        ...notch.map(([id], i): Command => ({ type: 'addCurve', sketch: 's2', id: `nl${i}`, curve: { type: 'line', a: id, b: notch[(i + 1) % 4][0] } })),
        { type: 'addFeature', feature: { id: 'cut', name: 'Zářez', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's2', regions: [{ outerLoop: ['nl0', 'nl1', 'nl2', 'nl3'] }] }, extent: { type: 'distance', start: 0, distance: -10 }, operation: 'cut', targets: ['e'] } },
      ],
    });
    body = ok(engine, 'get_body', { body: 'e' });
    const split = body.edges.find((edge: { label: string }) => edge.label === 'e/endCap | e/side/ab');
    expect(split).toMatchObject({ kind: 'line', gaps: true, length: expect.closeTo(30, 4) });
    expect([split.from, split.to].sort()).toEqual([[0, 0, 10], [40, 0, 10]]);
  });
});

describe('model, tělesa a příkazy', () => {
  it('gears: the generator catalog is in the description, its example is accepted, get_model returns the facts', () => {
    const description = apiDescription();
    expect(description.generators.map((entry) => entry.generator)).toEqual(Object.keys(GENERATORS));
    const text = apiText();
    expect(text).toContain('# Profile generators');
    expect(text).toContain('- involuteGear (Involute gear): ');
    expect(text).toContain('  - teeth (required): Number of teeth, count, an integer, in the interval [4, 500]');
    expect(text).toContain('  - pressureAngle: Pressure angle, rad, in the interval (0, π/2), default 0.3490658503988659');
    expect(text).toContain('  - internal: Internal (the cut that makes a ring gear): true or false, default false');
    expect(text).toContain('  - meshWith (In mesh with): ');
    expect(text).toContain('- extrude: profile/params/teeth (Number of teeth, count, an integer, in the interval [4, 500] (only when profile/generator is involuteGear))');
    for (const fact of Object.keys(GENERATORS.involuteGear.facts)) expect(text, fact).toContain(`  - ${fact}: `);

    const engine = newEngine();
    execute(engine, {
      type: 'batch',
      commands: [
        { type: 'setParameter', name: 'Zs', expr: '18' },
        sketch('s'),
        { type: 'addPoint', sketch: 's', id: 'cp', x: 20.25, y: 0 },
        { type: 'addCurve', sketch: 's', id: 'sun', curve: { type: 'circle', center: 'origin', construction: true }, radius: 8.1 },
        { type: 'addCurve', sketch: 's', id: 'planet', curve: { type: 'circle', center: 'cp', construction: true }, radius: 12.15 },
      ],
    });
    // the example of the catalog with real IDs in place of the placeholders
    const example = description.generators[0].example as { operands: Record<string, string>; params: Record<string, number> };
    const gear = (id: string, circle: string, params: object, refs?: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { ...example, sketch: 's', operands: { circle }, params: { ...example.params, ...params }, ...(refs ? { refs } : {}) }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' } as never });
    expect(execute(engine, gear('g1', 'sun', {}))).toMatchObject({ ok: true, bodies: ['g1'], problems: [] });
    expect(execute(engine, gear('g2', 'planet', { teeth: 27 }, { meshWith: 'g1' }))).toMatchObject({ ok: true, bodies: ['g1', 'g2'], problems: [] });
    const model = ok(engine, 'get_model');
    const [g1, g2] = ['g1', 'g2'].map((id) => model.features.find((f: { id: string }) => f.id === id));
    expect(g1).toMatchObject({ profile: { generator: 'involuteGear', params: { teeth: 18, backlash: 0 } }, facts: { module: 0.9, teeth: 18, pitchDiameter: 16.2, tipDiameter: 18, rootDiameter: 13.95, meshed: false, center: [0, 0, 0], axis: [0, 0, 1] } });
    expect(g2.facts).toMatchObject({ module: 0.9, teeth: 27, meshed: true, center: [20.25, 0, 0] });
    // an expression in a parameter and one changed entry
    expect(execute(engine, { type: 'updateFeature', id: 'g1', patch: { profile: { params: { teeth: 'Zs', backlash: 0.05 } } } })).toMatchObject({ ok: true, problems: [] });
    expect(ok(engine, 'get_model').features.find((f: { id: string }) => f.id === 'g1')).toMatchObject({ expressions: { 'profile/params/teeth': 'Zs' }, facts: { backlash: 0.05 } });
    // a mesh that does not hold is a warning in `problems`, with the reason
    const off = execute(engine, { type: 'setParameter', name: 'Zs', expr: '20' });
    expect(off.problems).toEqual([{ id: 'g2', name: 'g2', status: 'warning', warnings: [{ code: 'gearMesh', message: expect.stringContaining('the modules differ') }] }]);
    // a tooth count out of range is an invalid command with the range in the message
    expect(callTool(engine, 'execute', { command: gear('g3', 'sun', { teeth: 2 }) })).toMatchObject({ ok: false, error: expect.stringContaining('params.teeth: the value 2 is not in the interval [4, 500]') });
    // the side of the teeth is one face that is not planar
    expect(ok(engine, 'get_body', { body: 'g1' }).faces.map((face: { label: string; planar: boolean }) => [face.label, face.planar])).toEqual([['g1/startCap', true], ['g1/endCap', true], ['g1/side/teeth', false]]);
  });

  it('a cut through all with two targets: the result names the target the tool missed', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = { outerLoop: ['ab', 'bc', 'cd', 'da'] };
    const plate = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start, distance: 5 }, operation: 'new' } });
    execute(engine, { type: 'batch', commands: [plate('low', -5), plate('high', 10), sketch('s2'), { type: 'addPoint', sketch: 's2', id: 'm', x: 12, y: 14 }, { type: 'addCurve', sketch: 's2', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 5 }] });
    const hole = (side: string): Command => ({ type: 'addFeature', feature: { id: 'hole', name: 'hole', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's2', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'throughAll', side }, operation: 'cut', targets: ['low', 'high'] } as never });
    // both sides: both plates are cut
    expect(execute(engine, hole('both'))).toMatchObject({ ok: true, bodies: ['low', 'high'], problems: [] });
    const volumes = () => Object.fromEntries(ok(engine, 'get_model').bodies.map((body: { id: string; volume: number }) => [body.id, Math.round(body.volume)]));
    expect(volumes()).toEqual({ low: 5608, high: 5608 });
    // forward only: the lower plate is on the other side and the warning names it
    const result = execute(engine, { type: 'updateFeature', id: 'hole', patch: { extent: { side: 'forward' } } });
    expect(result.problems).toEqual([{ id: 'hole', name: 'hole', status: 'warning', warnings: [{ code: 'noEffect', message: expect.any(String), refs: ['low'] }] }]);
    expect(volumes()).toEqual({ low: 6000, high: 5608 });
    expect(ok(engine, 'get_model').features.find((f: { id: string }) => f.id === 'hole')).toMatchObject({ extent: { type: 'throughAll', side: 'forward' }, targets: ['low', 'high'] });
    // through all outside a cut is an invalid command
    const add = callTool(engine, 'execute', { command: { type: 'updateFeature', id: 'hole', patch: { operation: 'add', targets: ['low'] } } });
    expect(add).toMatchObject({ ok: false, error: expect.stringContaining('throughAll is only for the operation cut') });
    // an error names what it is about as well: the target that is missing
    const broken = execute(engine, { type: 'removeFeature', id: 'low' });
    expect(broken.problems).toEqual([{ id: 'hole', name: 'hole', status: 'error', error: { code: 'brokenReference', message: expect.any(String), refs: ['low'] } }]);
    expect(ok(engine, 'get_model').features.find((f: { id: string }) => f.id === 'hole').error).toMatchObject({ code: 'brokenReference', refs: ['low'] });
    // the description of the API mentions both
    expect(apiText()).toContain('{ type: "throughAll", side }');
    expect(apiText()).toContain('one or more for `cut`');
  });

  it('a pattern: copies of features and of a body, derived body IDs and face names of copies', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = { outerLoop: ['ab', 'bc', 'cd', 'da'] };
    const pattern = (id: string, source: object, count: number | string): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 's2', point: 'mid' }, count, span: { type: 'full' } } } as never });
    execute(engine, {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 'plate', name: 'plate', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' } },
        sketch('s2'),
        { type: 'addPoint', sketch: 's2', id: 'mid', x: 20, y: 15 },
        { type: 'addPoint', sketch: 's2', id: 'm', x: 30, y: 15 },
        { type: 'addCurve', sketch: 's2', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 2 },
        { type: 'addFeature', feature: { id: 'hole', name: 'hole', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's2', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['plate'] } },
      ],
    });
    // four holes around the middle of the plate
    expect(execute(engine, pattern('holes', { type: 'features', features: ['hole'] }, 4))).toMatchObject({ ok: true, bodies: ['plate'], problems: [] });
    const summary = (id: string) => ok(engine, 'get_model').features.find((f: { id: string }) => f.id === id);
    expect(summary('holes')).toEqual({ id: 'holes', name: 'holes', type: 'pattern', status: 'ok', source: { type: 'features', features: ['hole'] }, transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 's2', point: 'mid' }, count: 4, span: { type: 'full' } } });
    expect(summary('plate')).toMatchObject({ bodies: ['plate'] });
    expect(summary('hole')).not.toHaveProperty('bodies');
    const labels = (body: string): string[] => ok(engine, 'get_body', { body }).faces.map((face: { label: string }) => face.label);
    expect(labels('plate').filter((label) => label.startsWith('hole/'))).toEqual(['hole/side/k', 'hole/side/k@holes:1', 'hole/side/k@holes:2', 'hole/side/k@holes:3']);
    const copied = ok(engine, 'get_body', { body: 'plate' }).faces.find((face: { label: string }) => face.label === 'hole/side/k@holes:2');
    expect(copied.name).toEqual({ feature: 'hole', role: 'side', curve: 'k', copy: [{ pattern: 'holes', index: 2 }] });
    // every circular edge of a hole and of its copies has a centre and the radius of the hole,
    // whatever the order of its segments (six holes around the middle; `mid` is at (20, 15))
    execute(engine, { type: 'updateFeature', id: 'holes', patch: { transform: { count: 6 } } });
    const rims = ok(engine, 'get_body', { body: 'plate' }).edges.filter((edge: { kind: string }) => edge.kind === 'circle');
    expect(rims).toHaveLength(12);
    for (const rim of rims) {
      expect(rim.radius).toBeCloseTo(2, 4);
      expect(Math.hypot(rim.center[0] - 20, rim.center[1] - 15)).toBeCloseTo(10, 4);
      expect([0, 5]).toContain(rim.center[2]);
    }
    execute(engine, { type: 'updateFeature', id: 'holes', patch: { transform: { count: 4 } } });
    // a copy that misses is named in the warning; a count that is not an integer is rejected
    expect(execute(engine, { type: 'updateFeature', id: 'holes', patch: { transform: { axis: { kind: 'base', axis: 'Z' }, count: 2 } } }).problems).toEqual([
      { id: 'holes', name: 'holes', status: 'warning', warnings: [{ code: 'noEffect', message: expect.any(String), refs: [{ copy: 1, feature: 'hole', targets: ['plate'] }] }] },
    ]);
    expect(callTool(engine, 'execute', { command: { type: 'updateFeature', id: 'holes', patch: { transform: { count: 2.5 } } } })).toMatchObject({ ok: false, error: expect.stringContaining('transform.count') });

    // copies of the plate: the pattern lists them, get_body takes the derived ID
    const result = execute(engine, pattern('plates', { type: 'body', body: 'plate' }, 3));
    expect(result).toMatchObject({ ok: true, bodies: ['plate', 'plates/1', 'plates/2'] });
    expect(summary('plates')).toMatchObject({ type: 'pattern', bodies: ['plates/1', 'plates/2'], source: { type: 'body', body: 'plate' } });
    expect(ok(engine, 'get_model').bodies.map((body: { id: string }) => body.id)).toEqual(['plate', 'plates/1', 'plates/2']);
    const top = ok(engine, 'get_body', { body: 'plates/1' }).faces.find((face: { label: string }) => face.label === 'plate/endCap@plates:1');
    expect(top).toMatchObject({ name: { feature: 'plate', role: 'endCap', copy: [{ pattern: 'plates', index: 1 }] }, planar: true, normal: [0, 0, 1] });
    // the name of a face of a copy is a plane for the next sketch, and the copy a target of a cut
    const onCopy = execute(engine, { type: 'addFeature', feature: { ...(sketch('s3') as { feature: object }).feature, plane: { kind: 'face', body: 'plates/1', face: top.name } } as never });
    expect(onCopy.problems.map((problem: { id: string }) => problem.id)).toEqual(['holes']); // the warning from above; the sketch is fine
    expect(callTool(engine, 'get_body', { body: 'plates/3' })).toMatchObject({ ok: false, error: expect.stringContaining('<pattern>/<number>') });
    expect(callTool(engine, 'execute', { command: { type: 'addFeature', feature: { ...(sketch('s4') as { feature: object }).feature, plane: { kind: 'face', body: 'plates/1', face: { ...top.name, copy: [{ pattern: 'holes', index: 0 }] } } } } })).toMatchObject({ ok: false, error: expect.stringContaining('the number of a copy is an integer from 1') });
    // the description of the API covers the feature, the derived IDs and the copy tags
    const text = apiText();
    expect(text).toContain('- pattern (Pattern)');
    expect(text).toContain('`<pattern>/<number>`');
    expect(text).toContain('copy: [{ pattern, index }]');
    expect(text).toContain('{ kind: "sketchPoint", sketch, point }');
    expect(text).toContain('PatternFeature');
    expect(apiDescription().numericFields.filter((entry) => entry.owner === 'pattern').map((entry) => entry.path)).toEqual(['transform/count', 'transform/span/angle']);
  });

  it('vysunutí: get_model a get_body popíšou těleso a jména stěn jdou použít pro další skicu', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = ok(engine, 'get_sketch', { sketch: 's' }).regions[0].ref;
    const result = execute(engine, { type: 'addFeature', feature: { id: 'e', name: 'Deska', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    expect(result).toMatchObject({ ok: true, bodies: ['e'], problems: [] });
    const model = ok(engine, 'get_model');
    expect(model.features.map((f: { id: string; status: string }) => [f.id, f.status])).toEqual([['s', 'ok'], ['e', 'ok']]);
    expect(model.bodies).toEqual([{ id: 'e', volume: expect.closeTo(12000, 2), min: [0, 0, 0], max: [40, 30, 10], faces: 6, edges: 12 }]);
    expect(ok(engine, 'get_model', { at: 's' }).bodies).toEqual([]);

    const body = ok(engine, 'get_body', { body: 'e' });
    const top = body.faces.find((face: { label: string }) => face.label === 'e/endCap');
    expect(top).toMatchObject({ name: { feature: 'e', role: 'endCap' }, planar: true, area: expect.closeTo(1200, 3), normal: [0, 0, 1] });
    expect(body.edges.every((edge: { kind: string }) => edge.kind === 'line')).toBe(true);
    // přímá hrana: délka a krajní body
    const front = body.edges.find((edge: { label: string }) => edge.label === 'e/endCap | e/side/ab');
    expect(front).toMatchObject({ segments: 1, length: 40 });
    expect([front.from, front.to].sort()).toEqual([[0, 0, 10], [40, 0, 10]]);
    expect(front).not.toHaveProperty('gaps');
    // jméno stěny z get_body jako rovina další skici
    const onTop = execute(engine, { type: 'addFeature', feature: { ...(sketch('s2') as Extract<Command, { type: 'addFeature' }>).feature, plane: { kind: 'face', body: 'e', face: top.name } } as never });
    expect(onTop).toMatchObject({ ok: true, problems: [] });
    expect(ok(engine, 'get_sketch', { sketch: 's2' }).frame).toMatchObject({ origin: [0, 0, 10], normal: [0, 0, 1] });
  });

  it('neplatný příkaz dokument nezmění a vrátí důvod; preview nezapisuje; undo a redo', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const before = engine.save();
    // neplatný příkaz je chyba volání: klient ji dostane s příznakem chyby
    expect(callTool(engine, 'execute', { command: constrain('h1', { type: 'vertical', line: 'ab' }) })).toEqual({ ok: false, error: 'invalidCommand: addConstraint.id: ID "h1" už v dokumentu je' });
    expect(callTool(engine, 'execute', { command: { type: 'batch', commands: [constrain('x', { type: 'parallel', a: 'ab', b: 'cd' }), constrain('y', { type: 'nic', a: 'ab' } as never)] } })).toEqual({
      ok: false,
      error: expect.stringMatching(/^invalidCommand: .*neznámá vazba "nic" \(příkaz dávky s indexem 1\)$/),
    });
    expect(callTool(engine, 'preview', { command: { type: 'nic' } })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidCommand: /) });
    expect(ok(engine, 'preview', { command: { type: 'setConstraintValue', sketch: 's', id: 'w', value: 55 } })).toMatchObject({ ok: true });
    expect(engine.save()).toBe(before);
    execute(engine, { type: 'setConstraintValue', sketch: 's', id: 'w', value: 55 });
    expect(ok(engine, 'undo').canRedo).toBe(true);
    expect(engine.save()).toBe(before);
    ok(engine, 'redo');
    expect(JSON.parse(engine.save()).features[0].constraints.w.value).toBe(55);
  });

  it('parameters and checks: get_parameters, expressions in fields and what execute reports in addition', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const param = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
    expect(execute(engine, { type: 'batch', commands: [param('width', '40'), param('height', 'width / 2'), { type: 'setCheck', name: 'wider than tall', expr: 'width > height' }] })).not.toHaveProperty('failedChecks');
    execute(engine, { type: 'setConstraintValue', sketch: 's', id: 'w', value: 'width' });
    expect(ok(engine, 'get_parameters')).toEqual({
      parameters: [
        { name: 'width', expr: '40', value: 40 },
        { name: 'height', expr: 'width / 2', value: 20 },
      ],
      checks: [{ name: 'wider than tall', expr: 'width > height', status: 'ok' }],
    });
    // the dimension's expression shows on the constraint and on the feature
    expect(ok(engine, 'get_sketch', { sketch: 's' }).constraints.find((c: { id: string }) => c.id === 'w')).toMatchObject({ value: 40, expressions: { value: 'width' } });
    expect(ok(engine, 'get_model').features[0].expressions).toEqual({ 'constraints/w/value': 'width' });
    expect(ok(engine, 'get_sketch', { sketch: 's' }).constraints.find((c: { id: string }) => c.id === 'h')).not.toHaveProperty('expressions');
    expect(ok(engine, 'get_model').parameters).toEqual({ width: 40, height: 20 });

    // a failed check and a parameter in error are not a feature state: execute reports them separately
    const failed = execute(engine, param('height', 'width * 2'));
    expect(failed.failedChecks).toEqual([{ name: 'wider than tall', expr: 'width > height', status: 'failed' }]);
    expect(failed.problems).toEqual([]);
    const broken = execute(engine, { type: 'removeParameter', name: 'width' });
    expect(broken.parameterErrors).toEqual([{ name: 'height', expr: 'width * 2', error: 'unknown name "width"' }]);
    expect(broken.failedChecks).toMatchObject([{ status: 'error' }]);
    expect(broken.problems).toMatchObject([{ id: 's', status: 'warning', warnings: [{ code: 'invalidExpression' }], fieldErrors: { 'constraints/w/value': 'unknown name "width"' } }]);
    expect(ok(engine, 'get_model').parameterErrors).toHaveLength(1);
    expect(ok(engine, 'undo')).not.toHaveProperty('parameterErrors');

    // a rejected expression says where the error is
    expect(callTool(engine, 'execute', { command: { type: 'setConstraintValue', sketch: 's', id: 'w', value: 'width *' } })).toEqual({
      ok: false,
      error: 'invalidCommand: setConstraintValue.value: expression "width *": the expression is incomplete (character 8 of the expression)',
    });
    expect(callTool(engine, 'execute', { command: { type: 'setConstraintValue', sketch: 's', id: 'w', value: 'nothing' } })).toMatchObject({ ok: false, error: expect.stringMatching(/unknown name "nothing"/) });
  });

  it('the API description contains the expression syntax and numeric fields from the engine catalogs', () => {
    const description = apiText();
    expect(description).toContain('# Expressions');
    expect(description).toContain('- deg(x): Degrees to radians');
    expect(description).toContain('- atan2(y, x): ');
    expect(description).toContain('- min(a, b, …): ');
    expect(description).toContain('- pi: ');
    expect(description).toContain('- extrude: extent/distance (Distance, mm, non-zero (only when extent/type is distance))');
    expect(description).toContain('- plane: offset (Offset, mm, any)');
    expect(description).toContain('- sketch, constraint angle: constraints/<id>/value (Angle, rad, in the interval (−π, π] (driving dimension only))');
    expect(description).toContain("| { type: 'setParameter'; name: string; expr: Expr; index?: number }");
    // every dimension in the catalog has its field
    const fields = apiDescription().numericFields;
    for (const [type, spec] of Object.entries(CONSTRAINTS)) expect(fields.some((field) => field.owner === `sketch, constraint ${type}`), type).toBe(spec.dimension === true);
  });

  it('chyby volání se vracejí jako text, ne jako výjimka', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const error = (name: string, args: Record<string, unknown> = {}) => {
      const outcome = callTool(engine, name, args);
      expect(outcome.ok, name).toBe(false);
      return outcome.ok ? '' : outcome.error;
    };
    expect(error('nic')).toMatch(/neznámý nástroj/);
    expect(error('get_sketch', {})).toMatch(/argument "sketch"/);
    expect(error('get_sketch', { sketch: 'nic' })).toMatch(/skica "nic"/);
    expect(error('get_sketch', { sketch: 'constructor' })).toMatch(/skica "constructor"/);
    expect(error('explain_constraint', { sketch: 's', constraint: 'toString' })).toMatch(/vazba "toString"/);
    expect(error('get_body', { body: 'e' })).toMatch(/the body "e"/);
    expect(error('get_model', { at: 'nic' })).toMatch(/feature "nic"/);
    expect(error('get_document', { feature: 'nic' })).toMatch(/feature "nic"/);
    expect(error('execute', {})).toMatch(/argument "command"/);
    expect(error('execute', { command: 'addPoint' })).toMatch(/argument "command"/);
    expect(callTool(newEngine(), 'undo')).toEqual({ ok: false, error: 'není co vracet' });
    expect(callTool(newEngine(), 'redo')).toEqual({ ok: false, error: 'není co opakovat' });
  });
});
