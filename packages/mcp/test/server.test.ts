// The MCP server over the protocol: an MCP client in memory, files on disk and the bridge to the "app" (a second engine).
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONSTRAINTS, type Command } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readZip } from '../../engine/test/zip-reader';
import { type Bridge, startBridge } from '../src/bridge';
import { type BridgeStatus, connectBridge } from '../src/bridge-client';
import { connect, newEngine } from './kit';

// File operations of the server can be made to fail: a test sets a hook that sees every write and
// every rename before it happens and may throw. The real operation runs otherwise.
const disk = vi.hoisted(() => ({
  beforeWrite: undefined as ((path: string) => void) | undefined,
  beforeRename: undefined as ((from: string, to: string) => void) | undefined,
  beforeRemove: undefined as ((path: string) => void) | undefined,
}));
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return {
    ...real,
    writeFile: async (...args: Parameters<typeof real.writeFile>) => {
      disk.beforeWrite?.(String(args[0]));
      return real.writeFile(...args);
    },
    rename: async (from: string, to: string) => {
      disk.beforeRename?.(from, to);
      return real.rename(from, to);
    },
    rm: async (...args: Parameters<typeof real.rm>) => {
      disk.beforeRemove?.(String(args[0]));
      return real.rm(...args);
    },
  };
});

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const emptySketch = (id: string, plane: unknown): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } as never });
const until = async (condition: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!condition()) throw new Error(`timed out waiting for: ${what}`);
};

describe('MCP server', () => {
  it('the list of tools: the general tools of the engine and the tools for files, with an input schema', async () => {
    const session = await connect();
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['describe_api', 'get_model', 'get_document', 'get_sketch', 'get_parameters', 'explain_constraint', 'get_body', 'check_interference', 'query', 'execute', 'preview', 'sketch_tool', 'undo', 'redo', 'session_status', 'open_document', 'save_document', 'import_outline', 'import_mesh', 'insert_document', 'export_stl', 'export', 'view_image']); // the last: the operations of the app
    for (const tool of tools) {
      expect(tool.description, tool.name).not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
    // internal tools cannot be called from outside
    expect(await session.call('_load', { json: '{}' })).toEqual({ error: 'unknown tool "_load"' });
    expect(await session.call('nope')).toEqual({ error: 'unknown tool "nope"' });
    const api = await session.text('describe_api');
    for (const type of Object.keys(CONSTRAINTS)) expect(api, type).toContain(`- ${type} (`);
    expect(api).toContain('```ts');
    await session.close();
  });

  it('scenario: the AI builds a plate with a hole, asks about the freedom of the sketch, saves it and opens it elsewhere', async () => {
    const session = await connect();
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', file: null, bridge: null });

    // 1. a freehand sketch with dimensions, without an anchor
    const corners: [string, number, number][] = [
      ['a', 1, -1],
      ['b', 41, 1],
      ['c', 39, 31],
      ['d', -1, 29],
    ];
    const first = await session.call('execute', {
      command: {
        type: 'batch',
        commands: [
          emptySketch('s1', { kind: 'base', plane: 'XY' }),
          ...corners.map(([id, x, y]) => ({ type: 'addPoint', sketch: 's1', id, x, y })),
          ...corners.map(([id], i) => ({ type: 'addCurve', sketch: 's1', id: `${id}${corners[(i + 1) % 4][0]}`, curve: { type: 'line', a: id, b: corners[(i + 1) % 4][0] } })),
          { type: 'addConstraint', sketch: 's1', id: 'h1', constraint: { type: 'horizontal', line: 'ab' } },
          { type: 'addConstraint', sketch: 's1', id: 'v1', constraint: { type: 'vertical', line: 'bc' } },
          { type: 'addConstraint', sketch: 's1', id: 'h2', constraint: { type: 'horizontal', line: 'cd' } },
          { type: 'addConstraint', sketch: 's1', id: 'v2', constraint: { type: 'vertical', line: 'da' } },
          { type: 'addConstraint', sketch: 's1', id: 'w', constraint: { type: 'distance', a: 'a', b: 'b', value: 40, driving: true } },
          { type: 'addConstraint', sketch: 's1', id: 'h', constraint: { type: 'distance', a: 'b', b: 'c', value: 30, driving: true } },
        ],
      },
    });
    expect(first).toMatchObject({ ok: true, sketches: [{ id: 's1', degreesOfFreedom: 2 }] });

    // 2. "why does the sketch have two degrees of freedom?"
    let sketch = await session.call('get_sketch', { sketch: 's1' });
    expect(sketch.diagnosis.degreesOfFreedom).toBe(2);
    expect(sketch.advice.join(' ')).toMatch(/position of one of the points a, b, c, d is set/);

    // 3. anchoring as advised
    expect(await session.call('execute', { command: { type: 'addConstraint', sketch: 's1', id: 'fix', constraint: { type: 'coincident', a: 'a', b: 'origin' } } })).toMatchObject({ ok: true, sketches: [{ degreesOfFreedom: 0 }] });
    sketch = await session.call('get_sketch', { sketch: 's1' });
    expect(sketch.advice).toEqual(['The sketch is fully constrained.']);

    // 4. an extrusion of the region get_sketch offered
    expect(await session.call('execute', { command: { type: 'addFeature', feature: { id: 'e1', name: 'Plate', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's1', regions: [sketch.regions[0].ref] }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' } } })).toMatchObject({ ok: true, bodies: ['e1'], problems: [] });

    // 5. a hole on the top face dimensioned to a projected edge: the names of the face and the edge from get_body
    const body = await session.call('get_body', { body: 'e1' });
    const top = body.faces.find((face: { label: string }) => face.label === 'e1/endCap');
    const edge = body.edges.find((candidate: { label: string }) => candidate.label === 'e1/endCap | e1/side/bc');
    expect(top && edge).toBeTruthy();
    const hole = await session.call('execute', {
      command: {
        type: 'batch',
        commands: [
          emptySketch('s2', { kind: 'face', body: 'e1', face: top.name }),
          { type: 'addExternal', sketch: 's2', id: 'right', ref: { type: 'edge', body: 'e1', edge: edge.name, kind: 'line' } },
          { type: 'addPoint', sketch: 's2', id: 'm', x: 30, y: 14 },
          { type: 'addCurve', sketch: 's2', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 4 },
          { type: 'addConstraint', sketch: 's2', id: 'fromRight', constraint: { type: 'distancePointLine', point: 'm', line: 'right', value: 10, driving: true } },
          { type: 'addConstraint', sketch: 's2', id: 'y', constraint: { type: 'verticalDistance', a: 'origin', b: 'm', value: 15, driving: true } },
          { type: 'addConstraint', sketch: 's2', id: 'r', constraint: { type: 'radius', curve: 'k', value: 5, driving: true } },
          { type: 'addFeature', feature: { id: 'e2', name: 'Hole', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's2', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: -8 }, operation: 'cut', targets: ['e1'] } },
        ],
      },
    });
    expect(hole).toMatchObject({ ok: true, problems: [] });
    const detail = await session.call('get_sketch', { sketch: 's2' });
    expect(detail.external).toEqual([expect.objectContaining({ id: 'right', kind: 'line', entities: ['right', 'right/a', 'right/b'] })]);
    expect(detail.points).toEqual([{ id: 'm', at: [expect.closeTo(30, 5), expect.closeTo(15, 5)] }]);
    const model = await session.call('get_model');
    expect(model.problems).toEqual([]);
    expect(model.bodies[0].volume).toBeLessThan(40 * 30 * 8 - 0.95 * Math.PI * 25 * 8);
    expect(model.bodies[0].volume).toBeGreaterThan(40 * 30 * 8 - Math.PI * 25 * 8);

    // 6. a change of a dimension in the first sketch: the hole keeps its distance from the right edge
    expect(await session.call('execute', { command: { type: 'setConstraintValue', sketch: 's1', id: 'w', value: 60 } })).toMatchObject({ ok: true, problems: [] });
    expect((await session.call('get_sketch', { sketch: 's2' })).points[0].at[0]).toBeCloseTo(50, 5);

    // 7. saving, export and opening in another server
    const file = join(dir, 'plate.json');
    expect(await session.call('save_document')).toEqual({ error: 'the document has no file; give "path"' });
    expect(await session.call('save_document', { path: file })).toMatchObject({ file });
    expect(await session.call('save_document')).toMatchObject({ file }); // the second time without a path
    expect(await session.call('save_document', { path: null })).toMatchObject({ file }); // null counts as not given
    expect(await session.call('session_status')).toMatchObject({ file });
    const exported = await session.call('export_stl', { path: join(dir, 'out', 'plate.stl') });
    expect(exported.files).toEqual([{ path: join(dir, 'out', 'plate.stl'), bodies: ['e1'], triangles: expect.any(Number), bytes: expect.any(Number) }]);
    const stl = { file: exported.files[0].path as string, bytes: exported.files[0].bytes as number };
    expect((await readFile(stl.file)).length).toBe(stl.bytes);
    expect(stl.bytes).toBe(84 + 50 * exported.files[0].triangles);

    const other = await connect();
    expect(await other.call('export_stl', { path: join(dir, 'nope.stl') })).toEqual({ error: 'the model has no body to export' });
    expect((await other.call('open_document', { path: file })).model.bodies).toEqual((await session.call('get_model')).bodies);
    expect(await other.call('get_document')).toEqual(JSON.parse(await readFile(file, 'utf8')));
    expect(await other.call('open_document', { path: join(dir, 'missing.json') })).toEqual({ error: expect.stringMatching(/the file cannot be read/) });
    expect(await other.call('open_document', { path: stl.file })).toEqual({ error: expect.any(String) }); // it is not a document
    expect((await other.call('get_model')).bodies).toHaveLength(1); // the failed open did not change the document
    await Promise.all([session.close(), other.close()]);
  });
});

describe('MCP server: bodies', () => {
  const disc = (id: string, sketch: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 5 }, operation: 'new' } });
  // two discs that overlap by 2 mm of height and three copies of the second one
  const build = async (session: Awaited<ReturnType<typeof connect>>, ids = ['base', 'Wheel']) => {
    const result = await session.call('execute', {
      command: {
        type: 'batch',
        commands: [
          emptySketch('s1', { kind: 'base', plane: 'XY' }),
          { type: 'addPoint', sketch: 's1', id: 'm', x: 20, y: 0 },
          { type: 'addCurve', sketch: 's1', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 5 },
          disc(ids[0], 's1', 0),
          disc(ids[1], 's1', 3),
          { type: 'addFeature', feature: { id: 'planets', name: 'planets', suppressed: false, type: 'pattern', source: { type: 'body', body: ids[1] }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } as never },
        ],
      },
    });
    expect(result).toMatchObject({ ok: true, bodies: [ids[0], ids[1], 'planets/1', 'planets/2'] });
  };

  it('check_interference names the colliding pairs; get_model has volume and bounds of every body', async () => {
    const session = await connect();
    await build(session);
    const report = await session.call('check_interference');
    // the wheel goes 2 mm down into the base; the answer carries the tolerance fits are judged by
    expect(report).toEqual({ pairs: [{ a: 'Wheel', b: 'base', volume: expect.any(Number), depth: expect.closeTo(2, 3) }], fits: [], failed: [], checked: 6, tolerance: 0.01 });
    expect(report.pairs[0].volume).toBeGreaterThan(0.99 * Math.PI * 25 * 2);
    expect(report.pairs[0].volume).toBeLessThan(Math.PI * 25 * 2);
    expect(await session.call('check_interference', { bodies: ['base', 'planets/1'] })).toEqual({ pairs: [], fits: [], failed: [], checked: 1, tolerance: 0.01 });
    expect((await session.call('check_interference', { threshold: 1000 })).pairs).toEqual([]);
    // nothing to compare is said, not left to read as "no collisions"
    expect(await session.call('check_interference', { at: 'base' })).toEqual({ pairs: [], fits: [], failed: [], checked: 0, tolerance: 0.01, note: 'The model has fewer than two bodies: nothing was checked.' });
    expect(await session.call('check_interference', { bodies: ['base'] })).toEqual({ error: expect.stringContaining('at least two different bodies') });
    expect(await session.call('check_interference', { bodies: ['base', 'base'] })).toEqual({ error: expect.stringContaining('at least two different bodies') });
    expect(await session.call('check_interference', { bodies: [] })).toEqual({ error: expect.stringContaining('at least two different bodies') });
    // an argument the tool does not have is refused, not ignored (it would check all bodies instead)
    expect(await session.call('check_interference', { body: 'base' })).toEqual({ error: 'unknown argument "body"; the tool takes bodies, threshold, at' });
    expect(await session.call('check_interference', { threshold: '0.5' })).toEqual({ error: 'argument "threshold": a number is expected' });
    expect(await session.call('check_interference', { bodies: { 0: 'base' } })).toEqual({ error: 'argument "bodies": a list is expected' });
    expect(await session.call('execute', { command: 'undo' })).toEqual({ error: 'argument "command": an object is expected' });
    expect(await session.call('check_interference', { bodies: ['base', 'nope'] })).toEqual({ error: expect.stringContaining('the body "nope" does not exist') });
    expect(await session.call('check_interference', { bodies: ['Wheel'], at: 'base' })).toEqual({ error: expect.stringContaining('after the feature "base"') });
    expect(await session.call('check_interference', { threshold: -1 })).toEqual({ error: expect.stringContaining('threshold') });
    expect(await session.call('check_interference', { at: 'nope' })).toEqual({ error: expect.stringContaining('feature "nope"') });
    const model = await session.call('get_model');
    expect(model.bodies.map((body: { id: string }) => body.id)).toEqual(['base', 'Wheel', 'planets/1', 'planets/2']);
    expect(model.bodies[1]).toMatchObject({ id: 'Wheel', min: [15, expect.closeTo(-5, 1), 3], max: [25, expect.closeTo(5, 1), 8] }); // the circle is a polygon
    expect(model.bodies[2].volume).toBeCloseTo(model.bodies[1].volume, 2);
    expect((await session.call('get_body', { body: 'planets/2' })).volume).toBeCloseTo(model.bodies[1].volume, 2);
    await session.close();
  });

  it('a query in a pose prints the pose as a second text beside the answer (D49); without a pose there is one text', async () => {
    const session = await connect();
    await build(session);
    await session.call('execute', { command: { type: 'batch', commands: [{ type: 'setLink', id: 'wheel', bodies: ['Wheel'] }, { type: 'setLink', id: 'ground', bodies: ['base'] }, { type: 'setJoint', id: 'lift', joint: { type: 'prismatic', parent: 'ground', child: 'wheel', axis: { kind: 'base', axis: 'Z' }, lower: 0, upper: 10, value: 0 } }] } });
    const texts = async (args: Record<string, unknown>) => ((await session.client.callTool({ name: 'query', arguments: args })) as { content: { text: string }[] }).content.map((item) => item.text);
    const lifted = await texts({ query: 'interference', after: { type: 'setPose', values: { lift: 5 } } });
    expect(lifted).toHaveLength(2);
    expect(JSON.parse(lifted[0]).pairs).toEqual([]); // lifted by 5 the wheel clears the base
    expect(JSON.parse(lifted[1])).toEqual({ pose: { lift: 5 } });
    expect(await texts({ query: 'interference' })).toHaveLength(1);
    expect(await texts({ query: 'interference', after: { type: 'setPose', values: { lift: 5 } }, geometry: 'modelled' })).toHaveLength(1);
    await session.close();
  });

  it('export_stl without a list takes the printed bodies (D48); a listed reference body is written', async () => {
    const session = await connect();
    await build(session);
    // the wheel is a reference part: its copies take it over
    expect((await session.call('execute', { command: { type: 'setBodyProperties', body: 'Wheel', patch: { use: 'reference', mass: 12 } } })).ok).toBe(true);
    const printed = await session.call('export_stl', { path: join(dir, 'printed.stl') });
    expect(printed.files.map((file: { bodies: string[] }) => file.bodies)).toEqual([['base']]);
    const parts = await session.call('export_stl', { path: join(dir, 'printed'), perBody: true });
    expect(parts.files.map((file: { bodies: string[] }) => file.bodies)).toEqual([['base']]);
    const listed = await session.call('export_stl', { path: join(dir, 'wheel.stl'), bodies: ['planets/1'] });
    expect(listed.files.map((file: { bodies: string[] }) => file.bodies)).toEqual([['planets/1']]);
    // nothing printed: said, and how to export the bodies anyway
    expect((await session.call('execute', { command: { type: 'setBodyProperties', body: 'base', patch: { use: 'auxiliary' } } })).ok).toBe(true);
    expect(await session.call('export_stl', { path: join(dir, 'none.stl') })).toEqual({ error: expect.stringContaining('the model has no printed body (every body is a reference or auxiliary body)') });
    await session.close();
  });

  it('export_stl: chosen bodies in one file, or one file per body with an unambiguous name', async () => {
    const session = await connect();
    await build(session);
    const triangles = (await session.call('export_stl', { path: join(dir, 'all.stl') })).files[0].triangles;
    // chosen bodies in one file; the file is overwritten as before
    const some = await session.call('export_stl', { path: join(dir, 'all.stl'), bodies: ['Wheel', 'planets/1'] });
    expect(some.files).toEqual([{ path: join(dir, 'all.stl'), bodies: ['Wheel', 'planets/1'], triangles: triangles / 2, bytes: 84 + 25 * triangles }]);
    expect((await readFile(join(dir, 'all.stl'))).length).toBe(84 + 25 * triangles);
    expect(await session.call('export_stl', { path: join(dir, 'x.stl'), bodies: ['nope'] })).toEqual({ error: expect.stringContaining('the body "nope" does not exist') });
    expect(await session.call('export_stl', { path: join(dir, 'x.stl'), bodies: [] })).toEqual({ error: expect.stringContaining('the list is empty') });
    // arguments that are not what the schema says: refused, nothing written
    expect(await session.call('export_stl', { path: join(dir, 'pb'), perBody: 'true' })).toEqual({ error: 'argument "perBody": true or false is expected' });
    expect(await session.call('export_stl', { path: join(dir, 'pb'), perbody: true })).toEqual({ error: 'unknown argument "perbody"; the tool takes path, bodies, perBody, overwrite' });
    expect(await session.call('export_stl', { path: join(dir, 'pb'), perBody: true, overwrite: 1 })).toEqual({ error: 'argument "overwrite": true or false is expected' });
    await expect(readdir(join(dir, 'pb'))).rejects.toThrow();

    // one file per body: the directory is created, the names are the escaped IDs
    const parts = join(dir, 'parts');
    const perBody = await session.call('export_stl', { path: parts, perBody: true });
    expect(perBody.files.map((file: { path: string; bodies: string[] }) => [file.path, file.bodies])).toEqual([
      [join(parts, 'base.stl'), ['base']],
      [join(parts, 'Wheel.stl'), ['Wheel']],
      [join(parts, 'planets%2F1.stl'), ['planets/1']],
      [join(parts, 'planets%2F2.stl'), ['planets/2']],
    ]);
    expect((await readdir(parts)).sort()).toEqual(['Wheel.stl', 'base.stl', 'planets%2F1.stl', 'planets%2F2.stl']);
    for (const file of perBody.files) expect((await readFile(file.path)).length).toBe(84 + 50 * file.triangles);
    // a second export into the same directory writes nothing, unless it may overwrite
    const again = await session.call('export_stl', { path: parts, perBody: true, bodies: ['planets/1', 'base'] });
    expect(again).toEqual({ error: expect.stringMatching(/nothing was written, these files already exist: .*planets%2F1\.stl, .*base\.stl/) });
    expect((await session.call('export_stl', { path: parts, perBody: true, bodies: ['planets/1'], overwrite: true })).files).toHaveLength(1);
    // chosen bodies into a new directory
    const two = await session.call('export_stl', { path: join(dir, 'two'), perBody: true, bodies: ['planets/2', 'Wheel'] });
    expect(two.files.map((file: { bodies: string[] }) => file.bodies)).toEqual([['planets/2'], ['Wheel']]);
    expect((await readdir(join(dir, 'two'))).sort()).toEqual(['Wheel.stl', 'planets%2F2.stl']);
    // A body whose file name is too long for a file system: nothing is written, not even the
    // files of the bodies before it, and no temporary file stays behind.
    const long = 'L'.repeat(252);
    expect((await session.call('execute', { command: disc(long, 's1', 20) })).ok).toBe(true);
    const tooLong = await session.call('export_stl', { path: join(dir, 'long'), perBody: true, bodies: ['base', long] });
    expect(tooLong).toEqual({ error: expect.stringMatching(/nothing was written, the file names of these bodies are longer than 255 bytes: L+ /) });
    await expect(readdir(join(dir, 'long'))).rejects.toThrow();
    // a directory stands where a file should go: found before anything is written, also with overwrite
    await mkdir(join(dir, 'blocked', 'Wheel.stl'), { recursive: true });
    const blocked = await session.call('export_stl', { path: join(dir, 'blocked'), perBody: true, bodies: ['base', 'Wheel'], overwrite: true });
    expect(blocked).toEqual({ error: expect.stringMatching(/nothing was written, .*Wheel\.stl exists and is not a file/) });
    expect(await readdir(join(dir, 'blocked'))).toEqual(['Wheel.stl']);
    // the path of a per-body export is a directory: a file of that name says so
    const asFile = await session.call('export_stl', { path: join(dir, 'all.stl'), perBody: true, bodies: ['base'] });
    expect(asFile).toEqual({ error: expect.stringMatching(/nothing was written, the directory .*all\.stl cannot be created/) });
    expect((await readFile(join(dir, 'all.stl'))).length).toBe(84 + 25 * triangles);
    await session.close();
  });

  it('export: a format of the catalog into a file or a directory, of the state now, after a feature or after a previewed command', async () => {
    const session = await connect();
    await build(session);
    // one file: the same bytes as export_stl, and the file is overwritten
    const one = join(dir, 'export', 'all.stl');
    const all = await session.call('export', { format: 'stl', path: one });
    expect(all.files).toEqual([{ path: one, bodies: ['base', 'Wheel', 'planets/1', 'planets/2'], triangles: expect.any(Number), bytes: expect.any(Number) }]);
    await session.call('export_stl', { path: join(dir, 'export', 'old.stl') });
    expect(await readFile(one)).toEqual(await readFile(join(dir, 'export', 'old.stl')));
    const some = await session.call('export', { format: 'stl', path: one, options: { bodies: ['Wheel'] } });
    expect(some.files).toEqual([{ path: one, bodies: ['Wheel'], triangles: all.files[0].triangles / 4, bytes: 84 + 50 * (all.files[0].triangles / 4) }]);
    expect((await readFile(one)).length).toBe(some.files[0].bytes);
    // a set of files: the directory is created, nothing is replaced without `overwrite`
    const parts = join(dir, 'export', 'parts');
    const set = await session.call('export', { format: 'stl', path: parts, options: { perBody: true } });
    expect(set.files.map((file: { path: string; bodies: string[] }) => [file.path, file.bodies])).toEqual([
      [join(parts, 'base.stl'), ['base']],
      [join(parts, 'Wheel.stl'), ['Wheel']],
      [join(parts, 'planets%2F1.stl'), ['planets/1']],
      [join(parts, 'planets%2F2.stl'), ['planets/2']],
    ]);
    expect((await readdir(parts)).sort()).toEqual(['Wheel.stl', 'base.stl', 'planets%2F1.stl', 'planets%2F2.stl']);
    for (const file of set.files) expect((await readFile(file.path)).length).toBe(file.bytes);
    expect(await session.call('export', { format: 'stl', path: parts, options: { perBody: true, bodies: ['base'] } })).toEqual({ error: expect.stringMatching(/nothing was written, these files already exist: .*base\.stl/) });
    expect((await session.call('export', { format: 'stl', path: parts, options: { perBody: true, bodies: ['base'] }, overwrite: true })).files).toHaveLength(1);
    // the state after a feature
    expect((await session.call('export', { format: 'stl', path: join(dir, 'export', 'at.stl'), at: 'base' })).files[0].bodies).toEqual(['base']);
    // the model after a command that is only previewed: the document stays
    const without = await session.call('export', { format: 'stl', path: join(dir, 'export', 'after'), options: { perBody: true }, after: { type: 'removeFeature', id: 'planets' } });
    expect(without.files.map((file: { bodies: string[] }) => file.bodies)).toEqual([['base'], ['Wheel']]);
    expect((await readdir(join(dir, 'export', 'after'))).sort()).toEqual(['Wheel.stl', 'base.stl']);
    expect((await session.call('get_model')).bodies).toHaveLength(4);
    // a file name too long for a file system: nothing of the set is written
    const long = 'L'.repeat(252);
    const tooLong = await session.call('export', { format: 'stl', path: join(dir, 'export', 'long'), options: { perBody: true }, after: disc(long, 's1', 20) });
    expect(tooLong).toEqual({ error: expect.stringMatching(/nothing was written, these file names are longer than 255 bytes: L+\.stl$/) });
    await expect(readdir(join(dir, 'export', 'long'))).rejects.toThrow();

    // refusals: of the server (its own arguments), then of the engine (the format and its options)
    const nowhere = join(dir, 'export', 'nowhere');
    expect(await session.call('export', { format: 'stl' })).toEqual({ error: expect.stringContaining('path') });
    expect(await session.call('export', { path: nowhere })).toEqual({ error: expect.stringContaining('format') });
    expect(await session.call('export', { format: 'stl', path: nowhere, perBody: true })).toEqual({ error: 'unknown argument "perBody"; the tool takes format, path, options, overwrite, at, after' });
    expect(await session.call('export', { format: 'stl', path: nowhere, options: ['perBody'] })).toEqual({ error: 'argument "options": an object is expected' });
    expect(await session.call('export', { format: 'stl', path: nowhere, overwrite: 'yes' })).toEqual({ error: 'argument "overwrite": true or false is expected' });
    expect(await session.call('export', { format: 'step', path: nowhere })).toEqual({ error: 'invalidArguments: there is no export format "step"; the formats are stl, 3mf, dxf, svg, partsCsv, urdf, mjcf' });
    expect(await session.call('export', { format: 'stl', path: nowhere, options: { perbody: true } })).toEqual({ error: 'invalidArguments: stl: perbody: there is no such argument' });
    expect(await session.call('export', { format: 'stl', path: nowhere, options: { bodies: ['nope'] } })).toEqual({ error: 'notAvailable: stl: bodies[0]: the body "nope" is not in the state asked about' });
    expect(await session.call('export', { format: 'stl', path: nowhere, at: 'nope' })).toEqual({ error: 'notAvailable: stl: `at`: the feature "nope" is not in the document' });
    expect(await session.call('export', { format: 'stl', path: nowhere, after: { type: 'removeFeature', id: 'nope' } })).toEqual({ error: expect.stringMatching(/^after: /) });
    expect(await session.call('export', { format: 'stl', path: nowhere, options: { bodies: [] } })).toEqual({ error: 'invalidArguments: stl: bodies: at least 1 item is expected' });
    await expect(readdir(nowhere)).rejects.toThrow();
    const other = await connect();
    expect(await other.call('export', { format: 'stl', path: nowhere })).toEqual({ error: 'the model has no body to export' });
    // the parts list as a file (D57): one CSV table; a model with nothing to list is refused
    const csv = await session.call('export', { format: 'partsCsv', path: join(dir, 'export', 'parts.csv') });
    expect(csv.files).toEqual([expect.objectContaining({ path: join(dir, 'export', 'parts.csv'), rows: expect.any(Number) })]);
    expect((await readFile(join(dir, 'export', 'parts.csv'), 'utf8')).startsWith('Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs\r\n')).toBe(true);
    expect(await other.call('export', { format: 'partsCsv', path: nowhere })).toEqual({ error: 'the model has no part and no labelled hole to list' });
    await expect(readdir(nowhere)).rejects.toThrow();
    await Promise.all([session.close(), other.close()]);
  });

  it('export: a 3MF and the outline as DXF written to disk (D54)', async () => {
    const session = await connect();
    await build(session);
    const model = join(dir, 'export-2g', 'model.3mf');
    const written = await session.call('export', { format: '3mf', path: model });
    expect(written.files).toEqual([{ path: model, bodies: ['base', 'Wheel', 'planets/1', 'planets/2'], triangles: expect.any(Number), bytes: expect.any(Number) }]);
    const bytes = await readFile(model);
    expect(bytes.length).toBe(written.files[0].bytes);
    // a ZIP of three items, each deflated by the compressor of the engine (the engine of the kit,
    // composed as the server's `main.ts` composes its own), read back by the reader of the tests
    const items = readZip(new Uint8Array(bytes));
    expect(items.map((item) => [item.name, item.method])).toEqual([
      ['[Content_Types].xml', 8],
      ['_rels/.rels', 8],
      ['3D/3dmodel.model', 8],
    ]);
    expect(new TextDecoder().decode(items[2].bytes)).toContain('<object id="1" type="model" name="base" partnumber="base">');
    // the base disc cut a millimetre above the plane it stands on: one circle, of radius 5 about (20, 0)
    const outline = join(dir, 'export-2g', 'base.dxf');
    const drawn = await session.call('export', { format: 'dxf', path: outline, options: { plane: { kind: 'base', plane: 'XY' }, offset: 1 } });
    expect(drawn.files).toEqual([expect.objectContaining({ path: outline, bodies: ['base'], loops: 1, circles: 1, below: expect.any(Number), frame: expect.any(Object), bytes: expect.any(Number) })]);
    const text = await readFile(outline, 'utf8');
    expect(text).toContain(['0', 'CIRCLE', '8', 'OUTER', '10', '20', '20', '0', '30', '0', '40', '5'].join('\r\n'));
    expect(text.endsWith('0\r\nEOF\r\n')).toBe(true);
    // a plane the base only stands on: refused with the text of the format, nothing written
    expect(await session.call('export', { format: 'svg', path: join(dir, 'export-2g', 'none.svg'), options: { plane: { kind: 'base', plane: 'XY' } } })).toEqual({ error: expect.stringContaining('the plane cuts none of the bodies; "base" has a face in the plane') });
    await expect(readFile(join(dir, 'export-2g', 'none.svg'))).rejects.toThrow();
    await session.close();
  });

  it('export: a robot as URDF and as MJCF into one folder, the meshes shared, the second with overwrite (5b)', async () => {
    const session = await connect();
    const disc = (id: string, start: number) => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
    const built = await session.call('execute', {
      command: {
        type: 'batch',
        commands: [
          { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
          { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
          disc('low', 0),
          disc('high', 10),
          { type: 'setBodyMaterial', body: 'low', material: 'PLA' },
          { type: 'setBodyMaterial', body: 'high', material: 'PLA' },
          { type: 'setLink', id: 'base', bodies: ['low'] },
          { type: 'setLink', id: 'top', bodies: ['high'] },
          { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0 } },
        ],
      },
    });
    expect(built.error).toBeUndefined();
    const folder = join(dir, 'export-5b', 'robot');
    // URDF needs the drive: refused with the joint named, nothing written
    expect(await session.call('export', { format: 'urdf', path: folder })).toEqual({ error: 'failed: urdf: URDF requires an effort and a velocity of every revolute and prismatic joint (setJoint with `effort` and `velocity`): turn (effort, velocity)' });
    await expect(readdir(folder)).rejects.toThrow();
    // the drive given in the state previewed: written, with `about` of every file
    const after = { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2 } };
    const urdf = await session.call('export', { format: 'urdf', path: folder, options: { name: 'discs', meshPrefix: 'package://discs/' }, after });
    expect(urdf.files.map((file: { path: string }) => file.path)).toEqual(['robot.urdf', 'low.stl', 'high.stl'].map((name) => join(folder, name)));
    expect(urdf.files[0]).toMatchObject({ root: 'base', links: ['base', 'top'], joints: ['turn'] });
    expect(urdf.files[1]).toMatchObject({ bodies: ['low'], link: 'base' });
    expect(await readFile(join(folder, 'robot.urdf'), 'utf8')).toContain('<mesh filename="package://discs/low.stl"/>');
    // the MJCF into the same folder: the meshes are the same files, so it needs `overwrite`
    expect(await session.call('export', { format: 'mjcf', path: folder })).toEqual({ error: expect.stringMatching(/nothing was written, these files already exist: .*low\.stl/) });
    const mjcf = await session.call('export', { format: 'mjcf', path: folder, overwrite: true });
    expect(mjcf.files).toHaveLength(3);
    expect((await readdir(folder)).sort()).toEqual(['high.stl', 'low.stl', 'robot.urdf', 'robot.xml']);
    expect(await readFile(join(folder, 'robot.xml'), 'utf8')).toContain('<mujoco model="robot">');
    // a document without a mechanism
    const other = await connect();
    expect(await other.call('export', { format: 'mjcf', path: folder })).toEqual({ error: 'the model has no mechanism: a robot description needs links and joints (setLink, setJoint)' });
    await Promise.all([session.close(), other.close()]);
  });

  it('export_stl per body: a failure midway leaves the directory as it was, exports at once do not mix their files', async () => {
    const session = await connect();
    await build(session);
    // what every body looks like on disk, from an export of each one alone
    const alone = join(dir, 'alone');
    await session.call('export_stl', { path: alone, perBody: true });
    const bytesOf = async (name: string) => (await readFile(join(alone, `${name}.stl`))).toString('base64');
    const [base, wheel, planet] = [await bytesOf('base'), await bytesOf('Wheel'), await bytesOf('planets%2F1')];
    expect(new Set([base, wheel, planet]).size).toBe(3);

    // a failure while the second file is written: an old file of the set and a file of the user stay, nothing else appears
    const failing = join(dir, 'failing');
    await mkdir(failing);
    await writeFile(join(failing, 'base.stl'), 'old');
    await writeFile(join(failing, `.trymesh-export-${process.pid}-0.tmp`), 'mine'); // the name an earlier version wrote under
    let writes = 0;
    disk.beforeWrite = () => {
      if (++writes === 2) throw new Error('disk full');
    };
    const midway = await session.call('export_stl', { path: failing, perBody: true, bodies: ['Wheel', 'base'], overwrite: true });
    disk.beforeWrite = undefined;
    expect(midway).toEqual({ error: 'the export failed: disk full. Nothing of it was left in the directory' });
    expect((await readdir(failing)).sort()).toEqual([`.trymesh-export-${process.pid}-0.tmp`, 'base.stl']);
    expect(await readFile(join(failing, 'base.stl'), 'utf8')).toBe('old');
    expect(await readFile(join(failing, `.trymesh-export-${process.pid}-0.tmp`), 'utf8')).toBe('mine');

    // a failure while the files are moved to their names: a new file that replaced nothing is
    // removed again, one that replaced an old file is named
    let moves = 0;
    disk.beforeRename = () => {
      if (++moves === 3) throw new Error('no permission');
    };
    const moving = await session.call('export_stl', { path: failing, perBody: true, bodies: ['Wheel', 'base', 'planets/1'], overwrite: true });
    disk.beforeRename = undefined;
    expect(moving).toEqual({ error: `the export failed: no permission. The set is not complete; these files had already been replaced by new ones: ${join(failing, 'base.stl')}` });
    expect((await readdir(failing)).sort()).toEqual([`.trymesh-export-${process.pid}-0.tmp`, 'base.stl']);
    expect((await readFile(join(failing, 'base.stl'))).toString('base64')).toBe(base);
    // without an old file in the way nothing is left at all
    moves = 0;
    disk.beforeRename = () => {
      if (++moves === 2) throw new Error('no permission');
    };
    const clean = join(dir, 'clean');
    expect(await session.call('export_stl', { path: clean, perBody: true, bodies: ['Wheel', 'base'] })).toEqual({ error: 'the export failed: no permission. Nothing of it was left in the directory' });
    disk.beforeRename = undefined;
    // not even the directory the export had to create, nor its parents
    await expect(readdir(clean)).rejects.toThrow();
    writes = 0;
    disk.beforeWrite = () => {
      if (++writes === 1) throw new Error('disk full');
    };
    expect(await session.call('export_stl', { path: join(dir, 'made', 'for', 'this'), perBody: true, bodies: ['Wheel'] })).toEqual({ error: 'the export failed: disk full. Nothing of it was left in the directory' });
    writes = 0;
    expect(await session.call('export_stl', { path: join(dir, 'made2', 'one.stl'), bodies: ['Wheel'] })).toEqual({ error: 'the export failed: disk full' });
    disk.beforeWrite = undefined;
    await expect(readdir(join(dir, 'made'))).rejects.toThrow();
    await expect(readdir(join(dir, 'made2'))).rejects.toThrow();
    // a directory that was there before stays, with what it holds
    writes = 0;
    disk.beforeWrite = () => {
      if (++writes === 1) throw new Error('disk full');
    };
    expect(await session.call('export_stl', { path: join(failing, 'sub'), perBody: true, bodies: ['Wheel'] })).toEqual({ error: 'the export failed: disk full. Nothing of it was left in the directory' });
    disk.beforeWrite = undefined;
    expect((await readdir(failing)).sort()).toEqual([`.trymesh-export-${process.pid}-0.tmp`, 'base.stl']);
    // the directory of the call cannot be removed: the answer says so, after a success and after a failure
    disk.beforeRemove = (path) => {
      if (path.includes('.trymesh-export-') && !path.endsWith('.tmp') && !path.endsWith('.stl')) throw new Error('busy');
    };
    const kept = join(dir, 'kept');
    const leftover = await session.call('export_stl', { path: kept, perBody: true, bodies: ['Wheel'] });
    expect(leftover.files).toHaveLength(1);
    expect(leftover.note).toMatch(/^the temporary directory .*kept.\.trymesh-export-\w+ could not be removed$/);
    writes = 0;
    disk.beforeWrite = () => {
      if (++writes === 1) throw new Error('disk full');
    };
    const twice = await session.call('export_stl', { path: join(dir, 'kept2'), perBody: true, bodies: ['base'] });
    disk.beforeWrite = undefined;
    disk.beforeRemove = undefined;
    expect(twice.error).toMatch(/^the export failed: disk full\. Nothing of it was left in the directory; the temporary directory .*\.trymesh-export-\w+ could not be removed$/);
    expect(await readdir(join(dir, 'kept2'))).toHaveLength(1); // the directory that could not be removed keeps its parent
    // and the export works again afterwards
    expect((await session.call('export_stl', { path: clean, perBody: true, bodies: ['Wheel', 'base'] })).files).toHaveLength(2);

    // exports sent at once into one directory: every file holds the body it is named after
    const shared = join(dir, 'shared');
    const [first, second] = await Promise.all([session.call('export_stl', { path: shared, perBody: true, bodies: ['base'] }), session.call('export_stl', { path: shared, perBody: true, bodies: ['Wheel'] })]);
    expect([first.files.length, second.files.length]).toEqual([1, 1]);
    expect((await readdir(shared)).sort()).toEqual(['Wheel.stl', 'base.stl']);
    expect((await readFile(join(shared, 'base.stl'))).toString('base64')).toBe(base);
    expect((await readFile(join(shared, 'Wheel.stl'))).toString('base64')).toBe(wheel);
    // the same set in another order, replacing the files: one of the two wins as a whole
    const both = await Promise.all([
      session.call('export_stl', { path: shared, perBody: true, bodies: ['base', 'Wheel', 'planets/1'], overwrite: true }),
      session.call('export_stl', { path: shared, perBody: true, bodies: ['planets/1', 'Wheel', 'base'], overwrite: true }),
    ]);
    expect(both.map((answer) => answer.files.length)).toEqual([3, 3]);
    expect((await readdir(shared)).sort()).toEqual(['Wheel.stl', 'base.stl', 'planets%2F1.stl']);
    expect((await readFile(join(shared, 'base.stl'))).toString('base64')).toBe(base);
    expect((await readFile(join(shared, 'Wheel.stl'))).toString('base64')).toBe(wheel);
    expect((await readFile(join(shared, 'planets%2F1.stl'))).toString('base64')).toBe(planet);
    await session.close();
  });

  it('names of bodies that differ only in the case of letters are not exported per body together', async () => {

    // names that differ only in the case of letters: nothing is written
    const other = await connect();
    await build(other, ['wheel', 'Wheel']);
    const clash = await other.call('export_stl', { path: join(dir, 'clash'), perBody: true });
    expect(clash).toEqual({ error: expect.stringContaining('differ only in the case of letters') });
    await expect(readdir(join(dir, 'clash'))).rejects.toThrow();
    expect((await other.call('export_stl', { path: join(dir, 'clash'), perBody: true, bodies: ['wheel', 'planets/1'] })).files).toHaveLength(2);
    await other.close();
  });
});

describe('MCP server: errors and files', () => {
  it('an invalid command comes back with the error flag and does not change the document', async () => {
    const session = await connect();
    const result = (await session.client.callTool({ name: 'execute', arguments: { command: { type: 'nope' } } })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^invalidCommand: /);
    expect((await session.call('get_model')).features).toEqual([]);
    await session.close();
  });

  it('a file with a leading BOM is loaded, an empty file is an understandable error', async () => {
    const session = await connect();
    await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XY' }) });
    const saved = join(dir, 'bom.json');
    await session.call('save_document', { path: saved });
    await writeFile(saved, `\uFEFF${await readFile(saved, 'utf8')}`);
    await writeFile(join(dir, 'empty.json'), '  \n');
    const other = await connect();
    expect((await other.call('open_document', { path: saved })).model.features).toHaveLength(1);
    expect(await other.call('open_document', { path: join(dir, 'empty.json') })).toEqual({ error: 'the file is empty' });
    await Promise.all([session.close(), other.close()]);
  });

  it('a large result is printed compactly, a small one indented', async () => {
    const session = await connect();
    const points = Array.from({ length: 1500 }, (_, i) => ({ type: 'addPoint', sketch: 's', id: `p${i}`, x: i, y: i % 7 }));
    await session.call('execute', { command: { type: 'batch', commands: [emptySketch('s', { kind: 'base', plane: 'XY' }), ...points] } });
    expect(await session.text('get_document')).not.toContain('\n');
    expect(await session.text('session_status')).toContain('\n');
    await session.close();
  });
});

describe('the bridge to the running app', () => {
  let bridge: Bridge;
  beforeAll(async () => {
    bridge = await startBridge(0);
  });
  afterAll(async () => {
    await bridge.close();
  });

  it('the tools work over the engine of the app while it is connected; then over the server\'s own engine', async () => {
    const session = await connect({ bridge });
    const app = newEngine(); // the engine of the "app"
    const seen: string[] = [];
    let status: BridgeStatus = 'off';
    const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next), onCall: (name) => seen.push(name) });
    await until(() => status === 'connected' && bridge.connected(), 'the app connected');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', bridge: { port: bridge.port, appConnected: true } });

    // a command from the AI runs in the app and the app knows of it (a listener of the engine)
    let notified = 0;
    app.subscribe(() => notified++);
    expect(await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XZ' }) })).toMatchObject({ ok: true, features: 1 });
    expect(app.getState().document.features.map((feature) => feature.id)).toEqual(['s']);
    expect(session.engine.getState().document.features).toEqual([]);
    expect(notified).toBe(1);
    expect(seen).toEqual(['_ping', 'execute']); // _ping: the server's query for the document during session_status
    // an error of a tool and the result of a query pass through the bridge unchanged
    expect(await session.call('get_sketch', { sketch: 'nope' })).toEqual({ error: 'the sketch "nope" is not in the document' });
    expect((await session.call('get_model')).features).toEqual([expect.objectContaining({ id: 's', status: 'ok' })]);
    // files: the document of the app is saved by the server
    const file = join(dir, 'from-app.json');
    await session.call('save_document', { path: file });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(app.getState().document);
    // bodies of the app: the collision query runs there and the server writes the files it gets back
    const disc = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 5 }, operation: 'new' } });
    const built = await session.call('execute', { command: { type: 'batch', commands: [{ type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 }, disc('low', 0), disc('high', 3)] } });
    expect(built).toMatchObject({ ok: true, bodies: ['low', 'high'] });
    expect(await session.call('check_interference')).toMatchObject({ pairs: [{ a: 'high', b: 'low' }], fits: [], failed: [], checked: 1 });
    expect(await session.call('check_interference', { bodies: ['low', 'nope'] })).toEqual({ error: expect.stringContaining('the body "nope" does not exist') });
    const parts = await session.call('export_stl', { path: join(dir, 'from-app'), perBody: true, bodies: ['high'] });
    expect(parts.files).toEqual([{ path: join(dir, 'from-app', 'high.stl'), bodies: ['high'], triangles: expect.any(Number), bytes: expect.any(Number) }]);
    expect((await readFile(parts.files[0].path)).length).toBe(84 + 50 * parts.files[0].triangles);
    // a format of the catalog is exported by the engine of the app; a previewed command stays a preview there
    const viaCatalog = await session.call('export', { format: 'stl', path: join(dir, 'from-app', 'low.stl'), after: { type: 'removeFeature', id: 'high' } });
    expect(viaCatalog.files).toEqual([{ path: join(dir, 'from-app', 'low.stl'), bodies: ['low'], triangles: parts.files[0].triangles, bytes: 84 + 50 * parts.files[0].triangles }]);
    expect(Object.keys(app.getState().evaluation.bodies)).toEqual(['low', 'high']);
    expect(session.engine.getState().document.features).toEqual([]);

    // after the disconnect the tools work over the server's own engine
    connection.stop();
    await until(() => !bridge.connected(), 'the app disconnected');
    expect(status).toBe('off');
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', bridge: { appConnected: false } });
    expect((await session.call('get_model')).features).toEqual([]);
    await session.close();
  });

  it('a save without a path belongs to the document being worked on: the file of the server and the file of the app are not mixed up', async () => {
    const serverPath = join(dir, 'server-model.json');
    const appPath = join(dir, 'app-model.json');
    const session = await connect({ bridge });
    // the server's own document with a file
    await session.call('execute', { command: emptySketch('server_only', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document', { path: serverPath });
    const ids = async (path: string) => JSON.parse(await readFile(path, 'utf8')).features.map((feature: { id: string }) => feature.id);

    // an app with another document connects: it has no file, a save without a path must not overwrite the file of the server
    const app = newEngine();
    expect(app.execute(emptySketch('app_only', { kind: 'base', plane: 'XZ' })).ok).toBe(true);
    let status: BridgeStatus = 'off';
    let connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'the app connected');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    expect(await session.call('save_document')).toEqual({ error: 'the document has no file; give "path"' });
    expect(await ids(serverPath)).toEqual(['server_only']);
    // the document of the app gets a file of its own
    await session.call('save_document', { path: appPath });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: appPath });
    await session.call('execute', { command: emptySketch('app_second', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document');
    expect(await ids(appPath)).toEqual(['app_only', 'app_second']);
    expect(await ids(serverPath)).toEqual(['server_only']);

    // after the disconnect the file of the server applies again; the file of the app stays untouched
    connection.stop();
    await until(() => !bridge.connected(), 'the app disconnected');
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', file: serverPath });
    await session.call('save_document');
    expect(await ids(serverPath)).toEqual(['server_only']);
    expect(await ids(appPath)).toEqual(['app_only', 'app_second']);

    // a new connection of the app is a new document: the file of the previous connection does not carry over to it
    connection = connectBridge(newEngine(), { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'the app connected a second time');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    connection.stop();
    await until(() => !bridge.connected(), 'disconnected');
    await session.close();
  });

  it('the document replaced in the app: the file of the previous document does not belong to the new one', async () => {
    const first = join(dir, 'first-document.json');
    const second = join(dir, 'second-document.json');
    const session = await connect({ bridge });
    const app = newEngine();
    let status: BridgeStatus = 'off';
    const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'the app connected');
    const ids = async (path: string) => JSON.parse(await readFile(path, 'utf8')).features.map((feature: { id: string }) => feature.id);

    await session.call('execute', { command: emptySketch('a', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document', { path: first });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: first });
    // the user clicks New (or Open) in the app: the connection stays, the document is another one
    expect(app.load(JSON.stringify({ ...app.getState().document, features: [] })).ok).toBe(true);
    connection.documentReplaced();
    await session.call('execute', { command: emptySketch('b', { kind: 'base', plane: 'XY' }) });
    expect(await session.call('save_document')).toEqual({ error: 'the document has no file; give "path"' });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    expect(await ids(first)).toEqual(['a']);
    // the new document gets a file of its own and a save without a path then belongs to it
    await session.call('save_document', { path: second });
    await session.call('execute', { command: emptySketch('c', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document');
    expect(await ids(second)).toEqual(['b', 'c']);
    expect(await ids(first)).toEqual(['a']);

    // a replacement just before the status query, with no other call in between: the status does not show the old file
    app.load(JSON.stringify({ ...app.getState().document, features: [] }));
    connection.documentReplaced();
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    // a document the server opened into the app has its file
    expect(await session.call('open_document', { path: first })).toMatchObject({ file: first });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: first });
    await session.call('save_document');
    expect(await ids(first)).toEqual(['a']);
    expect(await ids(second)).toEqual(['b', 'c']);
    connection.stop();
    await until(() => !bridge.connected(), 'disconnected');
    await session.close();
  });

  it('the handler of the app: the clean-up before a change gets the arguments; an exception in it or after it does not leave the caller without an answer', async () => {
    const session = await connect({ bridge });
    const app = newEngine();
    const before: [string, unknown][] = [];
    let status: BridgeStatus = 'off';
    let failAfter = false;
    const connection = connectBridge(app, {
      url: `http://127.0.0.1:${bridge.port}`,
      retryMs: 20,
      onStatus: (next) => (status = next),
      beforeCall: (name, args) => before.push([name, args]),
      onCall: () => {
        if (failAfter) throw new Error('an error in the handler');
      },
    });
    await until(() => status === 'connected' && bridge.connected(), 'the app connected');
    const command = emptySketch('s', { kind: 'base', plane: 'XY' });
    await session.call('execute', { command });
    await session.call('get_model');
    expect(before).toEqual([['execute', { command }], ['get_model', {}]]);
    // a call the tools refuse outright never reaches the app: it must not cancel what the user is doing
    expect(await session.call('execute', { command: emptySketch('x', { kind: 'base', plane: 'XY' }), extra: 1 })).toEqual({ error: 'unknown argument "extra"; the tool takes command' });
    expect(await session.call('undo', { steps: 2 })).toEqual({ error: 'unknown argument "steps"; the tool takes no arguments' });
    expect(before).toHaveLength(2);
    // a sketch tool runs in the engine of the app and returns the IDs it generated there
    const input = { first: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, opposite: { at: [40, 30] } };
    expect(await session.call('sketch_tool', { sketch: 's', tool: 'rectangle', input })).toMatchObject({ ok: true, ids: { points: ['origin', 'p2', 'p1', 'p3'], lines: ['c1', 'c2', 'c3', 'c4'] }, sketches: [{ id: 's', regions: 1 }] });
    expect(before[2]).toEqual(['sketch_tool', { sketch: 's', tool: 'rectangle', input }]);
    expect(Object.keys((app.getState().document.features[0] as { curves: object }).curves)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(await session.call('sketch_tool', { sketch: 's', tool: 'rectangle', input: { first: input.first } })).toEqual({ error: 'rectangle: the input "opposite" is missing' });
    await session.call('undo');
    // an exception after the run: the answer arrives and the connection stays
    failAfter = true;
    expect(await session.call('execute', { command: emptySketch('s2', { kind: 'base', plane: 'XY' }) })).toMatchObject({ ok: true, features: 2 });
    expect(bridge.connected()).toBe(true);
    failAfter = false;
    // an exception of a listener of the engine: the change is written and the report says so
    const unsubscribe = app.subscribe(() => {
      throw new Error('the listener crashed');
    });
    const failed = await session.call('execute', { command: emptySketch('s3', { kind: 'base', plane: 'XY' }) });
    expect(failed.error).toMatch(/an error occurred in the app \(the change may already have been made, check the state\): the listener crashed/);
    unsubscribe();
    expect((await session.call('get_model')).features).toHaveLength(3);
    connection.stop();
    await until(() => !bridge.connected(), 'disconnected');
    await session.close();
  });

  it('only a page from this computer may connect; a second app replaces the first', async () => {
    const url = `http://127.0.0.1:${bridge.port}`;
    const header = { 'x-trymesh-bridge': '1' };
    expect((await fetch(`${url}/events`, { headers: { ...header, Origin: 'https://example.com' } })).status).toBe(403);
    // without the custom header (an image or a request without CORS from a foreign page) it cannot connect
    expect((await fetch(`${url}/events`)).status).toBe(403);
    expect((await fetch(`${url}/reply`, { method: 'POST', body: '{}' })).status).toBe(403);
    expect(bridge.connected()).toBe(false);
    // a foreign name in the Host header (DNS rebinding) is refused even with the custom header
    const status = (host: string) =>
      new Promise<number>((done, fail) => {
        request({ host: '127.0.0.1', port: bridge.port, path: '/events', headers: { ...header, Host: host } }, (response) => {
          done(response.statusCode ?? 0);
          response.destroy();
        })
          .on('error', fail)
          .end();
      });
    expect(await status(`evil.example:${bridge.port}`)).toBe(403);
    expect(await status(`localhost:${bridge.port + 1}`)).toBe(403);
    expect(bridge.connected()).toBe(false);
    // permission for a page from this computer, including the custom header
    const preflight = await fetch(`${url}/reply`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Headers': 'x-trymesh-bridge' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-trymesh-bridge');
    expect((await fetch(`${url}/reply`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } })).status).toBe(403);
    const local = await fetch(`${url}/status`, { headers: { Origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(await local.json()).toEqual({ service: 'trymesh-mcp-bridge', connected: false });

    // A displaced app does not reconnect: otherwise the two connections would keep taking over from
    // each other and a command from the AI could change the wrong document.
    const [first, second] = [newEngine(), newEngine()];
    const states: Record<string, BridgeStatus[]> = { one: [], two: [] };
    let displaced = 0;
    const one = connectBridge(first, { url, retryMs: 10, onStatus: (next) => states.one.push(next), onDisplaced: () => displaced++ });
    await until(() => states.one.at(-1) === 'connected', 'the first app');
    const two = connectBridge(second, { url, retryMs: 10, onStatus: (next) => states.two.push(next), onDisplaced: () => displaced++ });
    await until(() => states.two.at(-1) === 'connected' && states.one.at(-1) === 'off', 'the second app replaces the first');
    await new Promise((resolve) => setTimeout(resolve, 150)); // many times the delay between attempts
    expect(states.one).toEqual(['connecting', 'connected', 'off']);
    expect(states.two).toEqual(['connecting', 'connected']);
    expect(displaced).toBe(1);
    const session = await connect({ bridge });
    await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XY' }) });
    expect(second.getState().document.features).toHaveLength(1);
    expect(first.getState().document.features).toHaveLength(0);
    // a displaced app can reconnect only explicitly (by the AI button): then it takes over the connection
    const again = connectBridge(first, { url, retryMs: 10, onStatus: (next) => states.one.push(next) });
    await until(() => states.one.at(-1) === 'connected' && states.two.at(-1) === 'off', 'the first app reconnects');
    await session.call('execute', { command: emptySketch('t', { kind: 'base', plane: 'XY' }) });
    expect(first.getState().document.features.map((feature) => feature.id)).toEqual(['t']);
    again.stop();
    one.stop();
    two.stop();
    await until(() => !bridge.connected(), 'disconnected');
    await session.close();
  });

  it('a port in use: the bridge does not open and the server can run without it', async () => {
    await expect(startBridge(bridge.port)).rejects.toThrow();
  });
});
