// The guards of the catalog of export formats (D37), like those of the queries.
// - A format added to the catalog without a row in the two tables below does not compile.
// - The test runs every format through the tool that hands its files to the server, and compares
//   what the types let through: the names of the options of an entry and which are optional.
import { type AnyExportFormat, type Command, EXPORT_FORMATS, type Engine, type ExportFormat, type ExportOptions, exportPathProblem, specProblems } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { apiDescription, apiText } from '../src/api';
import { type ToolAnswer, callTool, changesDocument, tools } from '../src/tools';
import { newEngine } from './kit';

// A disc `low`, and a disc `high` standing on it; each a link of a mechanism, `high` turning on
// `low` about Z (for the robot descriptions), both of a density.
function model(): Engine {
  const engine = newEngine();
  const disc = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
  const outcome = callTool(engine, 'execute', {
    command: {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
        { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
        disc('low', 0),
        disc('high', 10),
        { type: 'setBodyProperties', body: 'low', patch: { density: 1.2 } },
        { type: 'setBodyProperties', body: 'high', patch: { density: 1.2 } },
        { type: 'setLink', id: 'base', bodies: ['low'] },
        { type: 'setLink', id: 'top', bodies: ['high'] },
        { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2 } },
      ],
    },
  });
  if (!outcome.ok) throw new Error(outcome.error);
  return engine;
}
const exported = (engine: Engine, args: Record<string, unknown>): any => {
  const outcome = callTool(engine, '_export', args);
  return outcome.ok ? outcome.result : { error: outcome.error };
};

// Options of every format, of the format's own type, that it exports `model()` with.
const FIXTURES: { [F in ExportFormat]: ExportOptions<F> } = {
  stl: { bodies: ['low'], perBody: true },
  '3mf': { bodies: ['low'] },
  dxf: { plane: { kind: 'base', plane: 'XY' }, offset: 5 },
  svg: { plane: { kind: 'base', plane: 'XY' }, offset: 5 },
  partsCsv: {},
  urdf: { name: 'discs', meshPrefix: 'package://discs/' },
  mjcf: { name: 'discs', root: 'base', collision: 'none' },
};
// Every option of every format and whether a caller may leave it out, as the type says.
const OPTIONS: { [F in ExportFormat]: { [K in keyof Required<ExportOptions<F>>]: {} extends Pick<ExportOptions<F>, K> ? 'optional' : 'required' } } = {
  stl: { bodies: 'optional', perBody: 'optional' },
  '3mf': { bodies: 'optional' },
  dxf: { plane: 'required', offset: 'optional', bodies: 'optional' },
  svg: { plane: 'required', offset: 'optional', bodies: 'optional' },
  partsCsv: {},
  urdf: { name: 'optional', root: 'optional', collision: 'optional', meshPrefix: 'optional' },
  mjcf: { name: 'optional', root: 'optional', collision: 'optional' },
};
const ENTRIES = Object.entries(EXPORT_FORMATS as Record<string, AnyExportFormat>);

describe('the catalog of export formats', () => {
  it.each(ENTRIES)('%s: the options of the entry are those of its type', (name, spec) => {
    const described = Object.fromEntries(Object.entries(spec.options).map(([option, description]) => [option, description.optional ? 'optional' : 'required']));
    expect(described).toEqual(OPTIONS[name as ExportFormat]);
    expect(specProblems(spec.options)).toEqual([]);
    expect(spec.title && spec.summary).toBeTruthy();
    for (const [option, description] of Object.entries(spec.options)) expect(description.summary, option).toBeTruthy();
  });

  it.each(ENTRIES)('%s is reached through the tools and described to the AI', (name) => {
    const engine = model();
    const before = engine.save();
    const answer = exported(engine, { format: name, options: FIXTURES[name as ExportFormat] }) as Extract<ToolAnswer, { kind: 'files' }>;
    expect((answer as { error?: string }).error).toBeUndefined();
    expect(answer.kind).toBe('files');
    expect(answer.files.length).toBeGreaterThan(0);
    expect(exportPathProblem(answer.files)).toBeUndefined();
    for (const file of answer.files) expect(Buffer.from(file.base64, 'base64').length, file.path).toBeGreaterThan(0);
    expect(answer).toEqual(JSON.parse(JSON.stringify(answer))); // plain JSON: it crosses the bridge to the app
    expect(engine.save()).toBe(before);
    const described = apiDescription().exports.find((entry) => entry.format === name);
    expect(described?.options.map((option) => option.name)).toEqual(Object.keys(EXPORT_FORMATS[name as ExportFormat].options));
    expect(apiText()).toContain(`- ${name} (`);
  });

  it('the description has the options in words', () => {
    const text = apiText();
    expect(text).toContain('# Export formats');
    expect(text).toContain('- stl (STL): Bodies as triangle meshes in binary STL');
    expect(text).toContain('  - bodies: a list, at least 1, each item the ID of a body. The bodies to export, each once, in this order, whatever their use; without it the printed bodies (use `part`: not the reference and auxiliary bodies of the body properties).');
    expect(text).toContain('  - perBody: true or false. A folder with one file per body');
    expect(text).toContain('export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;');
  });

  it('the description of 5b: the robot formats with their options, the drive of a joint by its kind, `at` and `after` of every operation', () => {
    const text = apiText();
    expect(text).toContain('- urdf (URDF (robot)): The mechanism as a URDF robot description');
    expect(text).toContain('  - meshPrefix: a text. Put before every mesh file name');
    expect(text).toContain('- mjcf (MJCF (MuJoCo)): The mechanism as a MuJoCo model');
    expect(text).toContain('  - collision: one of "meshes", "none". meshes (the default)');
    expect(text).toContain('- mechanism of a joint: <joint>/effort (Effort, N·mm, positive (only when type is revolute))');
    expect(text).toContain('- mechanism of a joint: <joint>/velocity (Velocity, mm/s, positive (only when type is prismatic))');
    expect(text).toContain('- mechanism of a joint: <joint>/rotorInertia (Rotor inertia, g·mm2, non-negative (only when type is continuous))');
    expect(text).not.toContain('<joint>/rotorInertia (Rotor inertia, g·mm2, non-negative (only when type is prismatic))');
    expect(text).toContain('A robot description is the export format `urdf` or `mjcf`');
    expect(text).toContain('setJoint keeps a drive field it is not given');
    expect(text).toContain('  - at (optional): a feature ID. The model as it was after this feature.');
    expect(text).toContain('  - after (optional): a command (as for execute) to preview first;');
  });
});

describe('the tool that hands the files of an export to the server', () => {
  it('is hidden, changes nothing, and answers with the files as base64', () => {
    expect(tools().find((tool) => tool.name === '_export')?.hidden).toBe(true);
    const engine = model();
    expect(changesDocument(engine, '_export', { format: 'stl', after: { type: 'removeFeature', id: 'low' } })).toBe(false);
    const one = exported(engine, { format: 'stl' });
    expect(one).toEqual({ kind: 'files', layout: 'file', files: [{ path: 'model.stl', mediaType: 'model/stl', base64: expect.any(String), about: { bodies: ['low', 'high'], triangles: expect.any(Number) } }] });
    expect(Buffer.from(one.files[0].base64, 'base64')).toEqual(Buffer.from(engine.exportMesh('stl')));
    expect(exported(engine, { format: 'stl', options: { perBody: true } })).toMatchObject({ layout: 'directory', files: [{ path: 'low.stl' }, { path: 'high.stl' }] });
    // the state: after a feature, or after a command that is only previewed
    expect(exported(engine, { format: 'stl', at: 'low' }).files[0].about.bodies).toEqual(['low']);
    // `null` counts as not given, as for the arguments of every tool; only at the top level of the options
    expect(exported(engine, { format: 'stl', options: { bodies: null, perBody: null }, at: null, after: null })).toEqual(one);
    expect(exported(engine, { format: 'stl', options: null })).toEqual(one);
    expect(exported(engine, { format: 'stl', options: { bodies: [null] } })).toEqual({ error: 'invalidArguments: stl: bodies[0]: the ID of a body is expected' });
    const before = engine.save();
    expect(exported(engine, { format: 'stl', after: { type: 'removeFeature', id: 'low' } }).files[0].about.bodies).toEqual(['high']);
    expect(exported(engine, { format: 'stl', after: { type: 'removeFeature', id: 'high' }, at: 'low' }).files[0].about.bodies).toEqual(['low']);
    expect(engine.save()).toBe(before);
  });

  it('3mf and an outline of the state after a command that is only previewed, or after a feature (the review of D54)', () => {
    const engine = model();
    const before = engine.save();
    expect(exported(engine, { format: '3mf', after: { type: 'removeFeature', id: 'high' } }).files[0].about).toMatchObject({ bodies: ['low'] });
    expect(exported(engine, { format: '3mf', at: 'low' }).files[0].about).toMatchObject({ bodies: ['low'] });
    // the disc `high` stands on `low` from z = 10: cut at 15 it is there, and not with `high` removed
    const plane = { kind: 'base', plane: 'XY' };
    expect(exported(engine, { format: 'dxf', options: { plane, offset: 15 } }).files[0].about).toMatchObject({ bodies: ['high'], loops: 1, circles: 1 });
    expect(exported(engine, { format: 'svg', options: { plane, offset: 15 }, after: { type: 'removeFeature', id: 'high' } })).toEqual({ error: 'the plane cuts none of the bodies' });
    expect(engine.save()).toBe(before);
  });

  it('refuses in words: an unknown format or option, a body that is not there, a command that is not valid, an empty model', () => {
    const engine = model();
    expect(exported(engine, { format: 'step' })).toEqual({ error: 'invalidArguments: there is no export format "step"; the formats are stl, 3mf, dxf, svg, partsCsv, urdf, mjcf' });
    expect(exported(engine, {})).toEqual({ error: expect.stringContaining('format') });
    expect(exported(engine, { format: 'stl', options: { perbody: true } })).toEqual({ error: 'invalidArguments: stl: perbody: there is no such argument' });
    expect(exported(engine, { format: 'stl', options: { bodies: ['nope'] } })).toEqual({ error: 'notAvailable: stl: bodies[0]: the body "nope" is not in the state asked about' });
    expect(exported(engine, { format: 'stl', at: 'nope' })).toEqual({ error: 'notAvailable: stl: `at`: the feature "nope" is not in the document' });
    expect(exported(engine, { format: 'stl', after: { type: 'removeFeature', id: 'nope' } })).toEqual({ error: expect.stringMatching(/^after: /) });
    expect(exported(engine, { format: 'stl', after: { type: 'batch', commands: [{ type: 'removeFeature', id: 'high' }, { type: 'removeFeature', id: 'low' }] } })).toEqual({ error: 'the model has no body to export' });
    expect(exported(newEngine(), { format: 'stl' })).toEqual({ error: 'the model has no body to export' });
    expect(exported(newEngine(), { format: 'stl', options: { perBody: true } })).toEqual({ error: 'the model has no body to export' });
  });
});
