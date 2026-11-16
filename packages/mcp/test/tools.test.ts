// Nástroje pro AI nad skutečným enginem: popis API vychází ze zdrojů enginu, dotazy na model
// a skicu vracejí to, co engine spočítal, a příkazy procházejí beze změny.
import { CONSTRAINTS, FEATURE_TYPE_INFO, GENERATORS, SKETCH_TOOLS, type Command, type Constraint, type Engine, type SolidKernel, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { apiDescription, apiText, constraintCatalog, engineTypes, sketchToolCatalog } from '../src/api';
import { MUTATING, callTool, changesDocument, tools } from '../src/tools';
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
    // the mesh the kernel did not verify is the port's (D50); what the collisions report of it is not
    expect(types).not.toContain('ComputedMesh');
    expect(types).toContain('cleared?: Cleared[];');
    expect(types).toContain('export interface Cleared');
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
    expect(listed).toEqual(['describe_api', 'get_model', 'get_document', 'get_sketch', 'get_parameters', 'explain_constraint', 'get_body', 'check_interference', 'query', 'execute', 'preview', 'sketch_tool', 'undo', 'redo']);
    // popis execute vyjmenuje vazby z katalogu
    const executeTool = tools().find((tool) => tool.name === 'execute')!;
    for (const type of Object.keys(CONSTRAINTS)) expect(executeTool.description).toContain(type);
  });
});

describe('sketch tools', () => {
  const hexagon = { center: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, vertex: { at: [3.1, 0.4] }, sides: 6, sizeKind: 'acrossFlats', size: 5.5 };

  it('the description lists every tool of the engine with its inputs and IDs, and every example is accepted', () => {
    const catalog = sketchToolCatalog();
    expect(catalog.map((entry) => entry.tool)).toEqual(Object.keys(SKETCH_TOOLS));
    const text = apiText();
    expect(text).toContain('# Sketch tools');
    for (const entry of catalog) {
      const spec = SKETCH_TOOLS[entry.tool as keyof typeof SKETCH_TOOLS];
      expect(entry.inputs.map((input) => input.name)).toEqual(Object.keys(spec.inputs));
      expect(entry.ids.map((id) => id.name)).toEqual(Object.keys(spec.ids));
      expect(text).toContain(`- ${entry.tool} (${spec.title}): ${spec.summary}`);
      expect(text).toContain(`  example of input: ${JSON.stringify(entry.example)}`);
      const engine = newEngine();
      execute(engine, sketch('s'));
      const made = ok(engine, 'sketch_tool', { sketch: 's', tool: entry.tool, input: entry.example });
      expect(made, entry.tool).toMatchObject({ ok: true, problems: [], sketches: [{ id: 's', solved: true }] });
      // the IDs the description promises are the IDs the tool returns (`size` only with a dimension)
      expect(Object.keys(made.ids).sort()).toEqual(Object.keys(spec.ids).filter((name) => name !== 'size' || 'size' in entry.example).sort());
    }
    const polygon = catalog.find((entry) => entry.tool === 'polygon')!;
    expect(polygon.inputs).toEqual([
      { name: 'center', description: 'anchor `{ at: [x, y], snap? }`', required: true },
      { name: 'vertex', description: 'anchor `{ at: [x, y], snap? }`', required: true },
      { name: 'sides', description: 'a number, an integer, in the interval [3, 64]', required: true },
      { name: 'sizeKind', description: 'one of "circumscribed", "acrossFlats"', required: false },
      { name: 'size', description: 'a number, positive, mm, or an expression', required: false },
    ]);
    expect(text).toContain('  - size (optional): a number, positive, mm, or an expression');
    const tool = tools().find((candidate) => candidate.name === 'sketch_tool')!;
    expect((tool.inputSchema as any).properties.tool.enum).toEqual(Object.keys(SKETCH_TOOLS));
  });

  it('a hexagon: the returned IDs are usable in the next commands and one undo takes the shape back', () => {
    const engine = newEngine();
    execute(engine, sketch('s'));
    const empty = engine.save();
    const made = ok(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon });
    expect(made.ids).toEqual({
      center: ['origin'],
      circle: ['c1'],
      points: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      lines: ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
      constraints: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10', 'k11'],
      size: ['k12'],
    });
    // centred on the origin and with a size: only the rotation is left
    expect(made).toMatchObject({ ok: true, problems: [], sketches: [{ id: 's', solved: true, degreesOfFreedom: 1, profileValid: true, regions: 1 }] });
    const turned = execute(engine, constrain('flat', { type: 'horizontal', line: made.ids.lines[1] }));
    expect(turned.sketches[0]).toMatchObject({ degreesOfFreedom: 0 });
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    // a regular hexagon 5.5 across flats: area = (√3 / 2) · s²
    expect(detail.regions).toEqual([{ ref: { outerLoop: expect.arrayContaining(made.ids.lines) }, area: expect.closeTo((Math.sqrt(3) / 2) * 5.5 ** 2, 4), holes: 0 }]);
    expect(detail.constraints.find((c: { id: string }) => c.id === made.ids.size[0])).toMatchObject({ type: 'distancePointLine', point: 'p1', line: 'c5', value: 5.5, driving: true });
    // the size is an ordinary dimension
    execute(engine, { type: 'setConstraintValue', sketch: 's', id: made.ids.size[0], value: 8 });
    expect(ok(engine, 'get_sketch', { sketch: 's' }).regions[0].area).toBeCloseTo((Math.sqrt(3) / 2) * 64, 4);
    ok(engine, 'undo');
    ok(engine, 'undo');
    ok(engine, 'undo');
    expect(engine.save()).toBe(empty);
  });

  it('the generated IDs avoid every ID of the document; a prefix names them', () => {
    const engine = newEngine();
    // `p1` is a point of another sketch, `c1` a feature, `k2` a constraint
    execute(engine, {
      type: 'batch',
      commands: [
        sketch('c1'),
        { type: 'addPoint', sketch: 'c1', id: 'p1', x: 1, y: 1 },
        { type: 'addPoint', sketch: 'c1', id: 'q', x: 5, y: 1 },
        { type: 'addConstraint', sketch: 'c1', id: 'k2', constraint: { type: 'horizontalDistance', a: 'p1', b: 'q', value: 4, driving: true } },
        sketch('s'),
      ],
    });
    const first = ok(engine, 'sketch_tool', { sketch: 's', tool: 'rectangle', input: { first: { at: [0, 0] }, opposite: { at: [40, 30] } } });
    expect(first.ids).toEqual({ points: ['p2', 'p4', 'p3', 'p5'], lines: ['c2', 'c3', 'c4', 'c5'], constraints: ['k1', 'k3', 'k4', 'k5'] });
    const second = ok(engine, 'sketch_tool', { sketch: 's', tool: 'rectangle', prefix: 'slot_', input: { first: { at: [5, 5] }, opposite: { at: [9, 8] } } });
    expect(second.ids).toEqual({ points: ['slot_p1', 'slot_p3', 'slot_p2', 'slot_p4'], lines: ['slot_c1', 'slot_c2', 'slot_c3', 'slot_c4'], constraints: ['slot_k1', 'slot_k2', 'slot_k3', 'slot_k4'] });
    // the same prefix again goes on counting
    const third = ok(engine, 'sketch_tool', { sketch: 's', tool: 'rectangle', prefix: 'slot_', input: { first: { at: [15, 5] }, opposite: { at: [19, 8] } } });
    expect(third.ids.points).toEqual(['slot_p5', 'slot_p7', 'slot_p6', 'slot_p8']);
    expect(third).toMatchObject({ ok: true, problems: [], sketches: [{ id: 'c1' }, { id: 's', solved: true, regions: 3 }] });
  });

  it('snapping uses the solved sketch: a corner on the end of a projected edge', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = ok(engine, 'get_sketch', { sketch: 's' }).regions[0].ref;
    execute(engine, { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    execute(engine, { type: 'addFeature', feature: { ...(sketch('top') as Extract<Command, { type: 'addFeature' }>).feature, plane: { kind: 'face', body: 'e', face: { feature: 'e', role: 'endCap' } } } as never });
    execute(engine, { type: 'addExternal', sketch: 'top', id: 'x', ref: { type: 'edge', body: 'e', edge: { a: { feature: 'e', role: 'endCap' }, b: { feature: 'e', role: 'side', curve: 'bc' } }, kind: 'line' } });
    const corner = ok(engine, 'get_sketch', { sketch: 'top' }).external[0].at[0];
    const made = ok(engine, 'sketch_tool', { sketch: 'top', tool: 'rectangle', input: { first: { at: [99, 99], snap: { kind: 'point', id: 'x/a' } }, opposite: { at: [20, 15] } } });
    expect(made).toMatchObject({ ok: true, problems: [] });
    const detail = ok(engine, 'get_sketch', { sketch: 'top' });
    const first = detail.points.find((point: { id: string }) => point.id === made.ids.points[0]);
    expect(first.at).toEqual([expect.closeTo(corner[0], 6), expect.closeTo(corner[1], 6)]);
    expect(detail.constraints.find((c: { id: string }) => c.id === made.ids.constraints[0])).toMatchObject({ type: 'coincident', a: made.ids.points[0], b: 'x/a' });
  });

  it('a call that cannot be drawn says why and leaves the document as it was', () => {
    const engine = newEngine();
    execute(engine, sketch('s'));
    const before = engine.save();
    const error = (args: Record<string, unknown>) => {
      const outcome = callTool(engine, 'sketch_tool', args);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
      return outcome.ok ? '' : outcome.error;
    };
    expect(error({ tool: 'polygon', input: hexagon })).toMatch(/argument "sketch"/);
    expect(error({ sketch: 'nic', tool: 'polygon', input: hexagon })).toBe('the document has no sketch "nic"');
    expect(error({ sketch: '', tool: 'polygon', input: hexagon })).toBe('argument "sketch": a text that is not empty is expected');
    // what an anchor and a size may be
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, center: { at: [0, 0], snap: { kind: 'point', id: 'origin', extra: 1 } } } })).toMatch(/center: `snap` must be/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, center: { snap: { kind: 'point', id: 'origin' } } } })).toMatch(/center: `at` must be two finite numbers/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, vertex: { at: [1e9 + 1, 0] } } })).toMatch(/vertex: `at` is out of the range ±1000000000/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, size: 1e-9 } })).toBe('polygon: the polygon is too small: its sides would have no length');
    expect(error({ sketch: 's', tool: 'polygon', input: { center: { at: [0, 0] }, vertex: { at: [2e-6, 0] }, sides: 64 } })).toMatch(/too small/);
    expect(error({ sketch: 's', tool: 'polygon', input: { center: { at: [9e8, 9e8] }, vertex: { at: [-1e9, -1e9] }, sides: 6 } })).toMatch(/reaches out of the range/);
    // each of the four sides of the range by itself
    for (const [x, y] of [[999999999, 0], [-999999999, 0], [0, 999999999], [0, -999999999]]) {
      expect(error({ sketch: 's', tool: 'polygon', input: { center: { at: [x, y] }, vertex: { at: [x * (1 - 1e-9), y * (1 - 1e-9)] }, sides: 6, size: 10 } }), `${x} ${y}`).toMatch(/reaches out of the range/);
    }
    expect(error({ sketch: 's', input: hexagon })).toMatch(/argument "tool"/);
    expect(error({ sketch: 's', tool: 'star', input: hexagon })).toBe('star: unknown sketch tool "star"; the tools are rectangle, polygon');
    expect(error({ sketch: 's', tool: 'toString', input: hexagon })).toMatch(/unknown sketch tool "toString"/);
    expect(error({ sketch: 's', tool: 'polygon' })).toMatch(/argument "input": an object/);
    expect(error({ sketch: 's', tool: 'polygon', input: [hexagon] })).toMatch(/argument "input"/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, sides: 2 } })).toMatch(/^polygon: sides: the value 2 is not/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, sides: 5 } })).toMatch(/even number of sides/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, radius: 3 } })).toMatch(/Regular polygon has no input "radius"/);
    expect(error({ sketch: 's', tool: 'rectangle', input: { first: { at: [1, 1] }, opposite: { at: [1, 5] } } })).toMatch(/^rectangle: .*must differ/);
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, vertex: { at: [3, 0], snap: { kind: 'point', id: 'nowhere' } } } })).toMatch(/nowhere/);
    expect(error({ sketch: 's', tool: 'polygon', input: hexagon, prefix: 'a/b' })).toMatch(/argument "prefix"/);
    expect(error({ sketch: 's', tool: 'polygon', input: hexagon, prefix: 5 })).toMatch(/argument "prefix": a string is expected/);
    expect(error({ sketch: 's', tool: 'polygon', input: hexagon, preview: 'yes' })).toMatch(/argument "preview": true or false is expected/);
    expect(error({ sketch: 's', tool: 'polygon', input: hexagon, dryRun: true })).toMatch(/unknown argument "dryRun"/);
    // a preview computes the shape and writes nothing; the same IDs come back when it is then written
    const previewed = ok(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon, preview: true });
    expect(previewed).toMatchObject({ ok: true, ids: { points: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] }, sketches: [{ id: 's', solved: true, degreesOfFreedom: 1, regions: 1 }] });
    // an expression the document cannot evaluate is refused by the engine with the whole batch
    expect(error({ sketch: 's', tool: 'polygon', input: { ...hexagon, size: 'nut * 2' } })).toMatch(/^invalidCommand: .*nut/);
    expect(engine.save()).toBe(before);
    expect(engine.getState().canUndo).toBe(true); // only the sketch itself
    ok(engine, 'undo');
    expect(engine.getState().canUndo).toBe(false);
  });

  it('an ID that a feature still refers to is not handed out again, though its entity is gone', () => {
    const engine = newEngine();
    execute(engine, sketch('s'));
    const first = ok(engine, 'sketch_tool', { sketch: 's', tool: 'rectangle', prefix: '', input: { first: { at: [0, 0] }, opposite: { at: [40, 30] } } });
    expect(first.ids.lines).toEqual(['c1', 'c2', 'c3', 'c4']); // an empty prefix is the default
    execute(engine, { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: first.ids.lines }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    expect(ok(engine, 'get_model').bodies[0].volume).toBeCloseTo(12000, 2);
    // the rectangle is removed; the extrusion keeps the names of its lines and is in error
    execute(engine, { type: 'batch', commands: [...first.ids.lines, ...first.ids.points].map((id: string): Command => ({ type: 'removeEntity', sketch: 's', id })) });
    expect(ok(engine, 'get_model').bodies).toEqual([]);
    // a new rectangle elsewhere must not become the profile of that extrusion
    const second = ok(engine, 'sketch_tool', { sketch: 's', tool: 'rectangle', input: { first: { at: [100, 100] }, opposite: { at: [105, 103] } } });
    expect(second.ids.lines).toEqual(['c5', 'c6', 'c7', 'c8']);
    expect(second.ids.points).toEqual(['p1', 'p3', 'p2', 'p4']); // nothing refers to the removed points, their IDs are free
    expect(second.problems).toEqual([expect.objectContaining({ id: 'e' })]);
    expect(ok(engine, 'get_model').bodies).toEqual([]);
  });

  it('a size given as an expression is drawn at its value', () => {
    const engine = newEngine();
    execute(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'nut', expr: '5.5' }, sketch('s')] });
    // the vertex is clicked eight times too far out: the drawn size comes from the parameter
    const made = ok(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: { center: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, vertex: { at: [25, 1] }, sides: 12, sizeKind: 'acrossFlats', size: 'nut' } });
    expect(made).toMatchObject({ ok: true, problems: [], sketches: [{ id: 's', solved: true, degreesOfFreedom: 1, profileValid: true, regions: 1 }] });
    const detail = ok(engine, 'get_sketch', { sketch: 's' });
    // a regular dodecagon 5.5 across flats: area = 3 · s² · tan(15°)
    expect(detail.regions[0].area).toBeCloseTo(3 * 5.5 ** 2 * Math.tan(Math.PI / 12), 4);
    expect(detail.constraints.find((c: { id: string }) => c.id === made.ids.size[0])).toMatchObject({ value: 5.5, expressions: { value: 'nut' } });
    // the tool knows the value of the expression: it refuses a size too small to draw by itself
    const tiny = callTool(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', prefix: 't', input: { center: { at: [50, 0] }, vertex: { at: [52, 0] }, sides: 6, size: 'nut * 1e-9' } });
    expect(tiny).toEqual({ ok: false, error: 'polygon: the polygon is too small: its sides would have no length' });
  });

  it('changesDocument: only a call that would be written counts', () => {
    const engine = newEngine();
    expect(changesDocument(engine, 'undo', {})).toBe(false);
    expect(changesDocument(engine, 'execute', { command: sketch('s') })).toBe(true);
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon })).toBe(false); // no such sketch yet
    execute(engine, sketch('s'));
    expect(changesDocument(engine, 'undo', {})).toBe(true);
    expect(changesDocument(engine, 'redo', {})).toBe(false);
    expect(changesDocument(engine, 'execute', { command: sketch('s') })).toBe(false);
    expect(changesDocument(engine, 'execute', {})).toBe(false);
    const before = engine.save();
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon })).toBe(true);
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon, preview: true })).toBe(false);
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: { ...hexagon, sides: 1 } })).toBe(false);
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: { ...hexagon, size: 'nut' } })).toBe(false);
    expect(changesDocument(engine, '_load', {})).toBe(true);
    expect(changesDocument(engine, 'get_model', {})).toBe(false);
    // accepted, and nothing to write; refused before it runs
    expect(changesDocument(engine, 'execute', { command: { type: 'batch', commands: [] } })).toBe(false);
    expect(changesDocument(engine, 'execute', { command: sketch('other'), extra: 1 })).toBe(false);
    expect(changesDocument(engine, 'sketch_tool', { sketch: 's', tool: 'polygon', input: hexagon, dryRun: true })).toBe(false);
    expect(changesDocument(engine, 'undo', { steps: 2 })).toBe(false);
    expect(MUTATING).toEqual(['execute', 'sketch_tool', 'undo', 'redo', '_load']);
    expect(engine.save()).toBe(before);
  });

  it('changesDocument answers as the call then does: a drag changes, a command that leaves the content does not', () => {
    const engine = newEngine();
    execute(engine, sketch('s'));
    execute(engine, { type: 'addPoint', sketch: 's', id: 'q', x: 1, y: 2 });
    const would = (command: Command): boolean => changesDocument(engine, 'execute', { command });
    // what the call does: whether the saved document is another one afterwards
    const does = (command: Command): boolean => {
      const before = engine.save();
      expect(engine.execute(command).ok).toBe(true);
      return engine.save() !== before;
    };
    // a drag moves the point through the solver, which a preview does not write into the document
    const drag: Command = { type: 'dragPoint', sketch: 's', point: 'q', x: 50, y: 60 };
    expect(would(drag)).toBe(true);
    expect(does(drag)).toBe(true);
    // accepted commands that leave the content as it is
    const name = engine.getState().document.features[0].name;
    for (const same of [
      { type: 'renameFeature', id: 's', name },
      { type: 'setSuppressed', id: 's', suppressed: false },
      { type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'gone', x: 0, y: 0 }, { type: 'removeEntity', sketch: 's', id: 'gone' }] },
    ] as Command[]) {
      expect(would(same), JSON.stringify(same)).toBe(false);
      expect(does(same), JSON.stringify(same)).toBe(false);
    }
    expect(would({ type: 'renameFeature', id: 's', name: 'another' })).toBe(true);
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

  it('a fixed point and equal radii: coordinates as fields with expressions, explained when a dimension repeats them', () => {
    const engine = newEngine();
    execute(engine, { type: 'setParameter', name: 'margin', expr: '6' });
    execute(engine, {
      type: 'batch',
      commands: [
        sketch('s'),
        { type: 'addPoint', sketch: 's', id: 'c1', x: 5, y: 5 },
        { type: 'addPoint', sketch: 's', id: 'c2', x: 30, y: 4 },
        { type: 'addCurve', sketch: 's', id: 'q1', curve: { type: 'circle', center: 'c1' }, radius: 2 },
        { type: 'addCurve', sketch: 's', id: 'q2', curve: { type: 'circle', center: 'c2' }, radius: 3 },
      ],
    });
    // the coordinates may be expressions; without them the point is fixed where it is
    const added = execute(engine, { type: 'batch', commands: [constrain('f1', { type: 'fixed', point: 'c1', x: 'margin', y: 'margin * 2' } as never), constrain('f2', { type: 'fixed', point: 'c2' } as never), constrain('eq', { type: 'equalRadius', a: 'q1', b: 'q2' })] });
    expect(added.sketches[0]).toMatchObject({ id: 's', solved: true, degreesOfFreedom: 1 });
    let detail = ok(engine, 'get_sketch', { sketch: 's' });
    const constraintOf = (id: string) => detail.constraints.find((c: { id: string }) => c.id === id);
    expect(constraintOf('f1')).toEqual({ id: 'f1', label: 'Fixed point (c1)', type: 'fixed', point: 'c1', x: 6, y: 12, expressions: { x: 'margin', y: 'margin * 2' } });
    expect(constraintOf('f2')).toEqual({ id: 'f2', label: 'Fixed point (c2)', type: 'fixed', point: 'c2', x: 30, y: 4 });
    expect(constraintOf('eq')).toEqual({ id: 'eq', label: 'Equal radius (q1, q2)', type: 'equalRadius', a: 'q1', b: 'q2' });
    expect(detail.points.find((p: { id: string }) => p.id === 'c1')).toEqual({ id: 'c1', at: [6, 12] });
    expect(detail.curves.map((c: { radius: number }) => c.radius)).toEqual([expect.closeTo(detail.curves[0].radius, 6), expect.closeTo(detail.curves[0].radius, 6)]);
    // one coordinate is changed by setField; the parameter moves the other
    execute(engine, { type: 'setField', feature: 's', path: 'constraints/f1/x', value: 9.5 });
    execute(engine, { type: 'setParameter', name: 'margin', expr: '10' });
    detail = ok(engine, 'get_sketch', { sketch: 's' });
    expect(constraintOf('f1')).toMatchObject({ x: 9.5, y: 20, expressions: { y: 'margin * 2' } });
    expect(ok(engine, 'get_model').features[0].expressions).toEqual({ 'constraints/f1/y': 'margin * 2' });
    expect(callTool(engine, 'execute', { command: { type: 'setConstraintValue', sketch: 's', id: 'f1', value: 3 } })).toMatchObject({ ok: false, error: expect.stringContaining('není kóta') });
    // a dimension that repeats a coordinate is surplus and explained by the fixed point
    execute(engine, constrain('dx', { type: 'horizontalDistance', a: 'origin', b: 'c1', value: 9.5, driving: true }));
    expect(ok(engine, 'explain_constraint', { sketch: 's', constraint: 'dx' })).toMatchObject({ redundant: true, impliedBy: [{ id: 'f1', label: 'Fixed point (c1)' }] });
    // one that contradicts it is a conflict the outcome names
    const clash = execute(engine, { type: 'setConstraintValue', sketch: 's', id: 'dx', value: 12 });
    expect(clash.sketches[0]).toMatchObject({ solved: false });
    expect(clash.problems[0]).toMatchObject({ id: 's', warnings: [{ code: 'sketchConflict', refs: expect.arrayContaining(['dx', 'f1']) }] });
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
  it('get_model summarises a feature by its type, with the keys in the order the tools always printed', () => {
    const engine = newEngine();
    execute(engine, sketch('s'));
    execute(engine, { type: 'addCurve', sketch: 's', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 });
    const profile = { type: 'regions' as const, sketch: 's', regions: [{ outerLoop: ['c'] }] };
    const common = { suppressed: false, extent: { type: 'distance' as const, start: 0, distance: 10 } };
    execute(engine, { type: 'addFeature', feature: { ...common, id: 'a', name: 'a', type: 'extrude', profile, operation: 'new' } });
    execute(engine, { type: 'addFeature', feature: { ...common, id: 'h', name: 'h', type: 'extrude', profile, extent: { type: 'distance', start: 5, distance: 10 }, operation: 'cut', targets: ['a'] } });
    execute(engine, { type: 'addFeature', feature: { id: 'pl', name: 'pl', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 5 } });
    execute(engine, { type: 'addFeature', feature: { id: 'p', name: 'p', suppressed: false, type: 'pattern', source: { type: 'body', body: 'a' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } });
    execute(engine, { type: 'addFeature', feature: { ...common, id: 'g', name: 'g', type: 'extrude', profile: { type: 'generated', generator: 'involuteGear', sketch: 's', operands: { circle: 'c' }, params: { teeth: 10 } }, operation: 'new' } });
    const keys = Object.fromEntries((ok(engine, 'get_model').features as { id: string }[]).map((feature) => [feature.id, Object.keys(feature).join(' ')]));
    expect(keys).toEqual({
      s: 'id name type status plane points curves constraints solved degreesOfFreedom profileValid regions',
      a: 'id name type status bodies profile extent operation',
      h: 'id name type status profile extent operation targets',
      pl: 'id name type status base offset',
      p: 'id name type status bodies source transform',
      g: 'id name type status bodies profile extent operation facts',
    });
  });

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
    // A hole another face cuts short is an arc: its two ends lie on a chord of the polygon, not on
    // the circle, and must not pull the centre. A hole of radius 50 that nicks the corner (40, 30)
    // of the plate, and a half hole of radius 3 on its lower edge.
    const cut = (id: string, x: number, y: number, radius: number): Command => ({
      type: 'batch',
      commands: [
        sketch(`s${id}`),
        { type: 'addPoint', sketch: `s${id}`, id: `m${id}`, x, y },
        { type: 'addCurve', sketch: `s${id}`, id: `k${id}`, curve: { type: 'circle', center: `m${id}` }, radius },
        { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: `s${id}`, regions: [{ outerLoop: [`k${id}`] }] }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['plate'] } },
      ],
    });
    execute(engine, cut('nick', 75, 60, 50.2));
    execute(engine, cut('half', 12, 0, 3));
    const arcs = ok(engine, 'get_body', { body: 'plate' }).edges.filter((edge: { kind: string; name: { a: { feature: string }; b: { feature: string } } }) => edge.kind === 'circle' && [edge.name.a.feature, edge.name.b.feature].some((feature) => feature === 'nick' || feature === 'half'));
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) {
      const nick = [arc.name.a.feature, arc.name.b.feature].includes('nick');
      expect(arc.radius).toBeCloseTo(nick ? 50.2 : 3, 2);
      expect([arc.center[0], arc.center[1]]).toEqual(nick ? [expect.closeTo(75, 2), expect.closeTo(60, 2)] : [expect.closeTo(12, 2), expect.closeTo(0, 2)]);
    }
    execute(engine, { type: 'removeFeature', id: 'half' });
    execute(engine, { type: 'removeFeature', id: 'nick' });
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

  it('check_interference: a tiny overlap under threshold 0 keeps its digits; planar bodies collide however shallow', () => {
    const engine = newEngine();
    // two boxes that share 0.002 × 0.002 × 0.1 mm at a corner; the corners are held by fixed points
    const box = (id: string, x: number, y: number, size: number, start: number): Command[] => {
      const corners: [number, number][] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
      return [
        sketch(`s${id}`),
        ...corners.map(([px, py], i): Command => ({ type: 'addPoint', sketch: `s${id}`, id: `${id}p${i}`, x: px, y: py })),
        ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: `s${id}`, id: `${id}l${i}`, curve: { type: 'line', a: `${id}p${i}`, b: `${id}p${(i + 1) % 4}` } })),
        ...corners.map(([px, py], i): Command => ({ type: 'addConstraint', sketch: `s${id}`, id: `${id}f${i}`, constraint: { type: 'fixed', point: `${id}p${i}`, x: px, y: py } })),
        { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: `s${id}`, regions: [{ outerLoop: [0, 1, 2, 3].map((i) => `${id}l${i}`) }] }, extent: { type: 'distance', start, distance: 1 }, operation: 'new' } },
      ];
    };
    expect(execute(engine, { type: 'batch', commands: [...box('A', 0, 0, 10, 0), ...box('B', 9.998, 9.998, 10, 0.9)] })).toMatchObject({ ok: true, bodies: ['A', 'B'], problems: [] });
    // below the default threshold nothing is reported
    expect(ok(engine, 'check_interference')).toEqual({ pairs: [], fits: [], failed: [], checked: 1, tolerance: 0.01 });
    const tiny = ok(engine, 'check_interference', { threshold: 0 });
    expect(tiny).toEqual({ pairs: [{ a: 'A', b: 'B', volume: expect.any(Number), depth: expect.any(Number) }], fits: [], failed: [], checked: 1, tolerance: 0.01 });
    // 4e-7 mm³: six decimal places would have made it zero
    expect(tiny.pairs[0].volume).toBeGreaterThan(3.5e-7);
    expect(tiny.pairs[0].volume).toBeLessThan(4.5e-7);
    // 0.002 mm into each other, far below the chord tolerance, and still a collision: no round face
    expect(tiny.pairs[0].depth).toBeGreaterThan(0.0015);
    expect(tiny.pairs[0].depth).toBeLessThan(0.0025);
  });

  it('check_interference and query: a pair the kernel refuses is cleared or failed by its intersection as computed (D50), rounded like the others', async () => {
    // the real kernel, which refuses every intersection: the second opinion decides every pair
    const real = await createManifoldKernel();
    const kernel: SolidKernel = { ...real, triangulate: (loops) => real.triangulate(loops), boolean: (op, a, b) => (op === 'intersection' ? (() => { throw new Error('the kernel gave up'); })() : real.boolean(op, a, b)), intersectionAsComputed: (a, b) => real.intersectionAsComputed(a, b) };
    const engine = createEngine({ solver: await createPlanegcsSolver(), kernel });
    const box = (id: string, x: number, y: number, size: number, start: number): Command[] => {
      const corners: [number, number][] = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
      return [
        sketch(`s${id}`),
        ...corners.map(([px, py], i): Command => ({ type: 'addPoint', sketch: `s${id}`, id: `${id}p${i}`, x: px, y: py })),
        ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: `s${id}`, id: `${id}l${i}`, curve: { type: 'line', a: `${id}p${i}`, b: `${id}p${(i + 1) % 4}` } })),
        ...corners.map(([px, py], i): Command => ({ type: 'addConstraint', sketch: `s${id}`, id: `${id}f${i}`, constraint: { type: 'fixed', point: `${id}p${i}`, x: px, y: py } })),
        { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: `s${id}`, regions: [{ outerLoop: [0, 1, 2, 3].map((i) => `${id}l${i}`) }] }, extent: { type: 'distance', start, distance: 1 }, operation: 'new' } },
      ];
    };
    // the two boxes of the test above: 0.002 × 0.002 × 0.1 mm at a corner
    expect(execute(engine, { type: 'batch', commands: [...box('A', 0, 0, 10, 0), ...box('B', 9.998, 9.998, 10, 0.9)] })).toMatchObject({ ok: true, bodies: ['A', 'B'], problems: [] });
    const cleared = ok(engine, 'check_interference');
    expect(cleared).toEqual({ pairs: [], fits: [], failed: [], cleared: [{ a: 'A', b: 'B', kind: 'nothing', volume: expect.any(Number), depth: expect.any(Number) }], checked: 1, tolerance: 0.01 });
    // significant digits, as for `pairs` and `fits`: 4e-7 mm³ is not rounded to zero
    expect(cleared.cleared[0].volume).toBeGreaterThan(3.5e-7);
    expect(cleared.cleared[0].volume).toBe(Number(cleared.cleared[0].volume.toPrecision(6)));
    expect(cleared.cleared[0].depth).toBe(Number(cleared.cleared[0].depth.toPrecision(4)));
    expect(ok(engine, 'query', { query: 'interference', args: {} })).toEqual({ pairs: [], fits: [], failed: [], cleared: cleared.cleared, checked: 1 });
    // with the threshold 0 the same mesh is a collision, which the second opinion cannot report: failed, with what it measured
    const failed = ok(engine, 'check_interference', { threshold: 0 });
    expect(failed).toEqual({ pairs: [], fits: [], failed: [{ a: 'A', b: 'B', message: expect.stringMatching(/^the kernel gave up; as computed the two share 4(\.\d+)?e-7 mm³, 0\.002\d* mm deep, which the kernel could not verify$/) }], checked: 1, tolerance: 0.01 });
    expect(tools().find((tool) => tool.name === 'check_interference')?.description).toContain('`cleared`');
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

  it('body properties (D48): get_model per body, errors and entries without a body; execute names what it took over', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = ok(engine, 'get_sketch', { sketch: 's' }).regions[0].ref;
    const plate = (id: string): Command => ({ type: 'addFeature', feature: { id, name: 'Plate', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } });
    execute(engine, plate('e'));
    let answer = execute(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'w', expr: '280' }, { type: 'setBodyProperties', body: 'e', patch: { name: 'Motor', color: '#30343A', use: 'reference', material: 'steel', mass: 'w' } }] });
    expect(answer).not.toHaveProperty('takenOver');
    expect(ok(engine, 'get_model').bodies[0]).toEqual({ id: 'e', volume: expect.closeTo(12000, 2), min: [0, 0, 0], max: [40, 30, 10], faces: 6, edges: 12, name: 'Motor', color: '#30343a', material: 'steel', use: 'reference', mass: 280, massFrom: 'mass' });
    execute(engine, { type: 'setBodyMaterial', body: 'e', material: 'PETG' });
    execute(engine, { type: 'setBodyProperties', body: 'e', patch: { mass: null, use: null, name: null, color: null } });
    expect(ok(engine, 'get_model').bodies[0]).toMatchObject({ material: 'PETG', density: 1.27, mass: 15.24, massFrom: 'density' });
    expect(ok(engine, 'get_model').bodies[0]).not.toHaveProperty('use');
    // a mass that cannot be evaluated: in every answer that lists problems
    execute(engine, { type: 'setBodyProperties', body: 'e', patch: { mass: 'w' } });
    answer = execute(engine, { type: 'removeParameter', name: 'w' });
    expect(answer.bodyPropertyErrors).toEqual([{ body: 'e', field: 'mass', message: 'unknown name "w"' }]);
    expect(ok(engine, 'get_model').bodyPropertyErrors).toEqual([{ body: 'e', field: 'mass', message: 'unknown name "w"' }]);
    expect(ok(engine, 'preview', { command: { type: 'setBodyProperties', body: 'e', patch: { mass: 1 } } })).not.toHaveProperty('bodyPropertyErrors');
    // the feature removed: its entry stays and is listed, but not for a state after a feature
    answer = execute(engine, { type: 'removeFeature', id: 'e' });
    expect(answer.bodyPropertiesWithoutBody).toEqual(['e']);
    expect(ok(engine, 'get_model').bodyPropertiesWithoutBody).toEqual(['e']);
    expect(ok(engine, 'get_model', { at: 's' })).not.toHaveProperty('bodyPropertiesWithoutBody');
    // made again under the ID: execute says that it took the entry over
    answer = execute(engine, plate('e'));
    expect(answer.takenOver).toEqual(['e']);
    expect(ok(engine, 'get_model').bodies[0]).toMatchObject({ id: 'e', material: 'PETG' });
    // the generated description: the section, its commands and its fields
    const text = apiText();
    expect(text).toContain('# Sections of the document');
    expect(text).toContain('- bodyProperties (Body properties): ');
    expect(text).toContain('  commands: setBodyProperties, setBodyMaterial, removeBodyProperties');
    expect(text).toContain('- body properties of a body: <body>/density (Density, g/cm3, in the interval (0, 25])');
    expect(text).toContain('- materials (Printing materials): ');
    expect(text).toContain('setBodyMaterial (it copies the density, do not type a density from memory)');
  });

  it('the mechanism (D49): get_model, the problems, a query in the pose with the note beside it, a blocked body, as modelled', () => {
    const engine = newEngine();
    rectangle(engine, true);
    const region = ok(engine, 'get_sketch', { sketch: 's' }).regions[0].ref;
    const plate = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [region] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
    // two plates of 40 × 30 stacked, the upper one turns about the vertical axis through the corner (40, 30)
    execute(engine, { type: 'batch', commands: [plate('e', 0), plate('f', 10), plate('g', 30), sketch('axes'), { type: 'addPoint', sketch: 'axes', id: 'pivot', x: 40, y: 30 }, { type: 'addConstraint', sketch: 'axes', id: 'pin', constraint: { type: 'fixed', point: 'pivot', x: 40, y: 30 } }] });
    let answer = execute(engine, {
      type: 'batch',
      commands: [
        { type: 'setLink', id: 'base', bodies: ['e'] },
        { type: 'setLink', id: 'arm', name: 'Arm', bodies: ['f'] },
        { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'arm', axis: { kind: 'sketchPoint', sketch: 'axes', point: 'pivot' }, lower: 'deg(-180)', upper: 'deg(180)', value: 0 } },
      ],
    });
    expect(answer.bodiesInNoLink).toEqual(['g']);
    const model = ok(engine, 'get_model');
    expect(model.mechanism).toEqual({
      links: [
        { id: 'base', bodies: ['e'] },
        { id: 'arm', name: 'Arm', bodies: ['f'] },
      ],
      joints: [{ id: 'turn', type: 'revolute', parent: 'base', child: 'arm', axis: { kind: 'sketchPoint', sketch: 'axes', point: 'pivot' }, lower: -3.141593, upper: 3.141593, value: 0, expressions: { lower: 'deg(-180)', upper: 'deg(180)' } }],
    });
    expect(model.bodiesInNoLink).toEqual(['g']);
    // a limit read from get_model is accepted as a value (the tolerance is wider than the rounding)
    expect(callTool(engine, 'preview', { command: { type: 'setPose', values: { turn: model.mechanism.joints[0].upper } } }).ok).toBe(true);

    // a query in a pose that is not written: the answer is posed and the note says for which pose
    const bent = callTool(engine, 'query', { query: 'body', args: { body: 'f' }, after: { type: 'setPose', values: { turn: 'deg(90)' } } });
    if (!bent.ok) throw new Error(bent.error);
    expect(bent.about).toEqual({ pose: { turn: 1.570796 } });
    expect((bent.result as any).bounds).toEqual({ min: [40, -10, 10], max: [70, 30, 20] });
    const modelled = callTool(engine, 'query', { query: 'body', args: { body: 'f' }, after: { type: 'setPose', values: { turn: 'deg(90)' } }, geometry: 'modelled' });
    expect(modelled.ok && [modelled.about, (modelled.result as any).bounds]).toEqual([undefined, { min: [0, 0, 10], max: [40, 30, 20] }]);
    expect(callTool(engine, 'query', { query: 'body', args: { body: 'f' } })).not.toHaveProperty('about');
    expect(callTool(engine, 'query', { query: 'body', args: { body: 'f' }, geometry: 'posed' })).toEqual({ ok: false, error: 'argument "geometry": "modelled" or nothing is expected' });
    const beyond = ok(engine, 'query', { query: 'mechanism', args: { beyond: 'turn' } });
    expect(beyond.beyond).toEqual({ joint: 'turn', links: ['arm'], bodies: ['f'], missing: [] });

    // written: get_body and check_interference answer in the pose with the note; get_model stays as modelled
    execute(engine, { type: 'setPose', values: { turn: 'deg(90)' } });
    const body = callTool(engine, 'get_body', { body: 'f' });
    expect(body.ok && [body.about, (body.result as any).min, (body.result as any).max]).toEqual([{ pose: { turn: 1.570796 } }, [40, -10, 10], [70, 30, 20]]);
    const collisions = callTool(engine, 'check_interference', {});
    expect(collisions.ok && [collisions.about, (collisions.result as any).pairs]).toEqual([{ pose: { turn: 1.570796 } }, []]);
    expect(ok(engine, 'get_model').bodies.find((entry: { id: string }) => entry.id === 'f')).toMatchObject({ min: [0, 0, 10], max: [40, 30, 20] });
    // a query that reads no geometry of bodies says nothing of the pose (review of D49)
    for (const [query, args] of [['catalog', { name: 'materials' }], ['mechanism', {}], ['sketchDiagnosis', { sketch: 's' }]] as const) expect(callTool(engine, 'query', { query, args })).not.toHaveProperty('about');

    // the sketch of the axis removed while the arm is turned: the joint is in error and blocks the arm
    answer = execute(engine, { type: 'removeFeature', id: 'axes' });
    expect(answer.jointErrors).toEqual([{ joint: 'turn', code: 'brokenReference', message: expect.stringContaining('the axis of the joint "turn"') }]);
    // the state of a joint goes with jointErrors: at the end of the timeline, not at a point of the construction
    expect(ok(engine, 'get_model').mechanism.joints[0].status).toBe('error');
    expect(ok(engine, 'get_model', { at: 'g' }).mechanism.joints[0]).not.toHaveProperty('status');
    expect(callTool(engine, 'check_interference', {})).toEqual({ ok: false, error: expect.stringContaining('failed: the pose of the body "f" is not known: the joint "turn" has no motion') });
    expect(callTool(engine, 'get_body', { body: 'f' })).toEqual({ ok: false, error: expect.stringContaining("geometry: 'modelled'") });
    expect(callTool(engine, 'query', { query: 'body', args: { body: 'f' }, after: { type: 'setPose', values: { turn: 0 } } }).ok).toBe(true);
    expect(callTool(engine, 'get_body', { body: 'e' }).ok).toBe(true);
    // the sketch made again under its ID: execute says that it became the axis again
    answer = execute(engine, { type: 'batch', commands: [sketch('axes'), { type: 'addPoint', sketch: 'axes', id: 'pivot', x: 40, y: 30 }] });
    expect(answer.takenOver).toEqual(['axes', 'pivot']);
    expect(answer).not.toHaveProperty('jointErrors');
    // a body the link lists and the model does not have
    answer = execute(engine, { type: 'setSuppressed', id: 'f', suppressed: true });
    expect(answer.linksMissingBodies).toEqual([{ link: 'arm', missing: ['f'] }]);
    expect(ok(engine, 'get_model', { at: 'f' })).not.toHaveProperty('linksMissingBodies');
    // the description for the AI
    const text = apiText();
    expect(text).toContain('- mechanism (Mechanism): ');
    expect(text).toContain('  commands: setLink, removeLink, setJoint, removeJoint, setPose');
    expect(text).toContain('after: { type: "setPose", values: { elbow: 1.2 } }');
    expect(text).toContain("{ type: 'setPose'; values: Record<Id, number | Expr> }");
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
    // every value of a constraint in the catalog has its field: the value of a dimension, the coordinates of a fixed point
    const fields = apiDescription().numericFields;
    for (const [type, spec] of Object.entries(CONSTRAINTS)) expect(fields.some((field) => field.owner === `sketch, constraint ${type}`), type).toBe(spec.values !== undefined);
    expect(fields.filter((field) => field.owner === 'sketch, constraint fixed').map((field) => [field.path, field.description])).toEqual([
      ['constraints/<id>/x', 'X, mm, any'],
      ['constraints/<id>/y', 'Y, mm, any'],
    ]);
    expect(description).toContain('- fixed (Fixed point) { point: point; x: any, mm; y: any, mm }');
    expect(description).toContain('- equalRadius (Equal radius) { a: circle | arc, b: circle | arc }');
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
