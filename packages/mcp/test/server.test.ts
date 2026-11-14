// MCP server přes protokol: klient MCP v paměti, soubory na disku a most do „aplikace" (druhý engine).
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONSTRAINTS, type Command } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Bridge, startBridge } from '../src/bridge';
import { type BridgeStatus, connectBridge } from '../src/bridge-client';
import { connect, newEngine } from './kit';

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
  if (!condition()) throw new Error(`nedočkal jsem se: ${what}`);
};

describe('MCP server', () => {
  it('seznam nástrojů: obecné nástroje enginu a nástroje pro soubory, se schématem vstupu', async () => {
    const session = await connect();
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['describe_api', 'get_model', 'get_document', 'get_sketch', 'get_parameters', 'explain_constraint', 'get_body', 'check_interference', 'execute', 'preview', 'undo', 'redo', 'session_status', 'open_document', 'save_document', 'export_stl']);
    for (const tool of tools) {
      expect(tool.description, tool.name).not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
    }
    // vnitřní nástroje zvenku volat nejdou
    expect(await session.call('_load', { json: '{}' })).toEqual({ error: 'neznámý nástroj "_load"' });
    expect(await session.call('nic')).toEqual({ error: 'neznámý nástroj "nic"' });
    const api = await session.text('describe_api');
    for (const type of Object.keys(CONSTRAINTS)) expect(api, type).toContain(`- ${type} (`);
    expect(api).toContain('```ts');
    await session.close();
  });

  it('scénář: AI postaví desku s dírou, zeptá se na volnost skici, uloží a jinde otevře', async () => {
    const session = await connect();
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', file: null, bridge: null });

    // 1. skica od ruky s rozměry, bez ukotvení
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

    // 2. „proč má skica dva stupně volnosti?"
    let sketch = await session.call('get_sketch', { sketch: 's1' });
    expect(sketch.diagnosis.degreesOfFreedom).toBe(2);
    expect(sketch.advice.join(' ')).toMatch(/určení polohy jednoho z bodů a, b, c, d/);

    // 3. ukotvení podle rady
    expect(await session.call('execute', { command: { type: 'addConstraint', sketch: 's1', id: 'fix', constraint: { type: 'coincident', a: 'a', b: 'origin' } } })).toMatchObject({ ok: true, sketches: [{ degreesOfFreedom: 0 }] });
    sketch = await session.call('get_sketch', { sketch: 's1' });
    expect(sketch.advice).toEqual(['Skica je plně určená.']);

    // 4. vysunutí oblasti, kterou get_sketch nabídl
    expect(await session.call('execute', { command: { type: 'addFeature', feature: { id: 'e1', name: 'Deska', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's1', regions: [sketch.regions[0].ref] }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' } } })).toMatchObject({ ok: true, bodies: ['e1'], problems: [] });

    // 5. díra na horní stěně okótovaná k promítnuté hraně: jména stěny a hrany z get_body
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
          { type: 'addFeature', feature: { id: 'e2', name: 'Díra', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's2', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: -8 }, operation: 'cut', targets: ['e1'] } },
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

    // 6. změna kóty v první skice: díra drží vzdálenost od pravé hrany
    expect(await session.call('execute', { command: { type: 'setConstraintValue', sketch: 's1', id: 'w', value: 60 } })).toMatchObject({ ok: true, problems: [] });
    expect((await session.call('get_sketch', { sketch: 's2' })).points[0].at[0]).toBeCloseTo(50, 5);

    // 7. uložení, export a otevření v jiném serveru
    const file = join(dir, 'deska.json');
    expect(await session.call('save_document')).toEqual({ error: 'dokument nemá soubor; zadejte "path"' });
    expect(await session.call('save_document', { path: file })).toMatchObject({ file });
    expect(await session.call('save_document')).toMatchObject({ file }); // podruhé už bez cesty
    expect(await session.call('session_status')).toMatchObject({ file });
    const exported = await session.call('export_stl', { path: join(dir, 'out', 'deska.stl') });
    expect(exported.files).toEqual([{ path: join(dir, 'out', 'deska.stl'), bodies: ['e1'], triangles: expect.any(Number), bytes: expect.any(Number) }]);
    const stl = { file: exported.files[0].path as string, bytes: exported.files[0].bytes as number };
    expect((await readFile(stl.file)).length).toBe(stl.bytes);
    expect(stl.bytes).toBe(84 + 50 * exported.files[0].triangles);

    const other = await connect();
    expect(await other.call('export_stl', { path: join(dir, 'nic.stl') })).toEqual({ error: 'model nemá žádné těleso' });
    expect((await other.call('open_document', { path: file })).model.bodies).toEqual((await session.call('get_model')).bodies);
    expect(await other.call('get_document')).toEqual(JSON.parse(await readFile(file, 'utf8')));
    expect(await other.call('open_document', { path: join(dir, 'chybi.json') })).toEqual({ error: expect.stringMatching(/soubor nejde přečíst/) });
    expect(await other.call('open_document', { path: stl.file })).toEqual({ error: expect.any(String) }); // není to dokument
    expect((await other.call('get_model')).bodies).toHaveLength(1); // neúspěšné otevření dokument nezměnilo
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
    expect(report).toEqual({ pairs: [{ a: 'Wheel', b: 'base', volume: expect.any(Number) }], failed: [], checked: 6 });
    expect(report.pairs[0].volume).toBeGreaterThan(0.99 * Math.PI * 25 * 2);
    expect(report.pairs[0].volume).toBeLessThan(Math.PI * 25 * 2);
    expect(await session.call('check_interference', { bodies: ['base', 'planets/1'] })).toEqual({ pairs: [], failed: [], checked: 1 });
    expect((await session.call('check_interference', { threshold: 1000 })).pairs).toEqual([]);
    expect(await session.call('check_interference', { at: 'base' })).toEqual({ pairs: [], failed: [], checked: 0 });
    expect(await session.call('check_interference', { bodies: ['base', 'nic'] })).toEqual({ error: expect.stringContaining('the body "nic" does not exist') });
    expect(await session.call('check_interference', { bodies: ['Wheel'], at: 'base' })).toEqual({ error: expect.stringContaining('after the feature "base"') });
    expect(await session.call('check_interference', { threshold: -1 })).toEqual({ error: expect.stringContaining('threshold') });
    expect(await session.call('check_interference', { at: 'nic' })).toEqual({ error: expect.stringContaining('feature "nic"') });
    const model = await session.call('get_model');
    expect(model.bodies.map((body: { id: string }) => body.id)).toEqual(['base', 'Wheel', 'planets/1', 'planets/2']);
    expect(model.bodies[1]).toMatchObject({ id: 'Wheel', min: [15, expect.closeTo(-5, 1), 3], max: [25, expect.closeTo(5, 1), 8] }); // the circle is a polygon
    expect(model.bodies[2].volume).toBeCloseTo(model.bodies[1].volume, 2);
    expect((await session.call('get_body', { body: 'planets/2' })).volume).toBeCloseTo(model.bodies[1].volume, 2);
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
    expect(await session.call('export_stl', { path: join(dir, 'x.stl'), bodies: ['nic'] })).toEqual({ error: expect.stringContaining('the body "nic" does not exist') });
    expect(await session.call('export_stl', { path: join(dir, 'x.stl'), bodies: [] })).toEqual({ error: 'model nemá žádné těleso' });

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
    await session.close();

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

describe('MCP server: chyby a soubory', () => {
  it('neplatný příkaz se vrací s příznakem chyby a dokument nemění', async () => {
    const session = await connect();
    const result = (await session.client.callTool({ name: 'execute', arguments: { command: { type: 'nic' } } })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^invalidCommand: /);
    expect((await session.call('get_model')).features).toEqual([]);
    await session.close();
  });

  it('soubor s úvodní značkou BOM se načte, prázdný soubor je srozumitelná chyba', async () => {
    const session = await connect();
    await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XY' }) });
    const saved = join(dir, 'bom.json');
    await session.call('save_document', { path: saved });
    await writeFile(saved, `\uFEFF${await readFile(saved, 'utf8')}`);
    await writeFile(join(dir, 'empty.json'), '  \n');
    const other = await connect();
    expect((await other.call('open_document', { path: saved })).model.features).toHaveLength(1);
    expect(await other.call('open_document', { path: join(dir, 'empty.json') })).toEqual({ error: 'soubor je prázdný' });
    await Promise.all([session.close(), other.close()]);
  });

  it('velký výsledek se vypíše úsporně, malý s odsazením', async () => {
    const session = await connect();
    const points = Array.from({ length: 1500 }, (_, i) => ({ type: 'addPoint', sketch: 's', id: `p${i}`, x: i, y: i % 7 }));
    await session.call('execute', { command: { type: 'batch', commands: [emptySketch('s', { kind: 'base', plane: 'XY' }), ...points] } });
    expect(await session.text('get_document')).not.toContain('\n');
    expect(await session.text('session_status')).toContain('\n');
    await session.close();
  });
});

describe('most do běžící aplikace', () => {
  let bridge: Bridge;
  beforeAll(async () => {
    bridge = await startBridge(0);
  });
  afterAll(async () => {
    await bridge.close();
  });

  it('nástroje pracují nad enginem aplikace, dokud je připojená; pak nad vlastním enginem serveru', async () => {
    const session = await connect({ bridge });
    const app = newEngine(); // engine „aplikace"
    const seen: string[] = [];
    let status: BridgeStatus = 'off';
    const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next), onCall: (name) => seen.push(name) });
    await until(() => status === 'connected' && bridge.connected(), 'připojení aplikace');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', bridge: { port: bridge.port, appConnected: true } });

    // příkaz od AI se provede v aplikaci a aplikace o něm ví (posluchač enginu)
    let notified = 0;
    app.subscribe(() => notified++);
    expect(await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XZ' }) })).toMatchObject({ ok: true, features: 1 });
    expect(app.getState().document.features.map((feature) => feature.id)).toEqual(['s']);
    expect(session.engine.getState().document.features).toEqual([]);
    expect(notified).toBe(1);
    expect(seen).toEqual(['_ping', 'execute']); // _ping: dotaz serveru na dokument při session_status
    // chyba nástroje a výsledek dotazu projdou mostem beze změny
    expect(await session.call('get_sketch', { sketch: 'nic' })).toEqual({ error: 'skica "nic" v dokumentu není' });
    expect((await session.call('get_model')).features).toEqual([expect.objectContaining({ id: 's', status: 'ok' })]);
    // soubory: dokument aplikace se uloží serverem
    const file = join(dir, 'z-aplikace.json');
    await session.call('save_document', { path: file });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(app.getState().document);

    // po odpojení pracují nástroje nad vlastním enginem serveru
    connection.stop();
    await until(() => !bridge.connected(), 'odpojení aplikace');
    expect(status).toBe('off');
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', bridge: { appConnected: false } });
    expect((await session.call('get_model')).features).toEqual([]);
    await session.close();
  });

  it('uložení bez cesty patří dokumentu, se kterým se pracuje: soubor serveru a soubor aplikace se nepletou', async () => {
    const serverPath = join(dir, 'server-model.json');
    const appPath = join(dir, 'app-model.json');
    const session = await connect({ bridge });
    // vlastní dokument serveru se souborem
    await session.call('execute', { command: emptySketch('server_only', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document', { path: serverPath });
    const ids = async (path: string) => JSON.parse(await readFile(path, 'utf8')).features.map((feature: { id: string }) => feature.id);

    // připojí se aplikace s jiným dokumentem: ten soubor nemá, uložení bez cesty nesmí přepsat soubor serveru
    const app = newEngine();
    expect(app.execute(emptySketch('app_only', { kind: 'base', plane: 'XZ' })).ok).toBe(true);
    let status: BridgeStatus = 'off';
    let connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'připojení aplikace');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    expect(await session.call('save_document')).toEqual({ error: 'dokument nemá soubor; zadejte "path"' });
    expect(await ids(serverPath)).toEqual(['server_only']);
    // dokument aplikace dostane vlastní soubor
    await session.call('save_document', { path: appPath });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: appPath });
    await session.call('execute', { command: emptySketch('app_second', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document');
    expect(await ids(appPath)).toEqual(['app_only', 'app_second']);
    expect(await ids(serverPath)).toEqual(['server_only']);

    // po odpojení platí zase soubor serveru; soubor aplikace zůstane nedotčený
    connection.stop();
    await until(() => !bridge.connected(), 'odpojení aplikace');
    expect(await session.call('session_status')).toMatchObject({ engine: 'server', file: serverPath });
    await session.call('save_document');
    expect(await ids(serverPath)).toEqual(['server_only']);
    expect(await ids(appPath)).toEqual(['app_only', 'app_second']);

    // nové připojení aplikace je nový dokument: soubor z minulého připojení se na něj nepřenáší
    connection = connectBridge(newEngine(), { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'druhé připojení aplikace');
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    connection.stop();
    await until(() => !bridge.connected(), 'odpojení');
    await session.close();
  });

  it('výměna dokumentu v aplikaci: soubor předchozího dokumentu novému nepatří', async () => {
    const first = join(dir, 'prvni-dokument.json');
    const second = join(dir, 'druhy-dokument.json');
    const session = await connect({ bridge });
    const app = newEngine();
    let status: BridgeStatus = 'off';
    const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next) });
    await until(() => status === 'connected' && bridge.connected(), 'připojení aplikace');
    const ids = async (path: string) => JSON.parse(await readFile(path, 'utf8')).features.map((feature: { id: string }) => feature.id);

    await session.call('execute', { command: emptySketch('a', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document', { path: first });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: first });
    // uživatel v aplikaci klikne na Nový (nebo Otevřít): spojení zůstává, dokument je jiný
    expect(app.load(JSON.stringify({ ...app.getState().document, features: [] })).ok).toBe(true);
    connection.documentReplaced();
    await session.call('execute', { command: emptySketch('b', { kind: 'base', plane: 'XY' }) });
    expect(await session.call('save_document')).toEqual({ error: 'dokument nemá soubor; zadejte "path"' });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    expect(await ids(first)).toEqual(['a']);
    // nový dokument dostane vlastní soubor a ukládání bez cesty pak patří jemu
    await session.call('save_document', { path: second });
    await session.call('execute', { command: emptySketch('c', { kind: 'base', plane: 'XY' }) });
    await session.call('save_document');
    expect(await ids(second)).toEqual(['b', 'c']);
    expect(await ids(first)).toEqual(['a']);

    // výměna těsně před dotazem na stav, bez jiného volání mezi tím: stav starý soubor neukáže
    app.load(JSON.stringify({ ...app.getState().document, features: [] }));
    connection.documentReplaced();
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: null });
    // dokument otevřený serverem do aplikace svůj soubor má
    expect(await session.call('open_document', { path: first })).toMatchObject({ file: first });
    expect(await session.call('session_status')).toMatchObject({ engine: 'app', file: first });
    await session.call('save_document');
    expect(await ids(first)).toEqual(['a']);
    expect(await ids(second)).toEqual(['b', 'c']);
    connection.stop();
    await until(() => !bridge.connected(), 'odpojení');
    await session.close();
  });

  it('obsluha aplikace: úklid před změnou dostane argumenty; výjimka v ní ani po ní nenechá volajícího bez odpovědi', async () => {
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
        if (failAfter) throw new Error('chyba v obsluze');
      },
    });
    await until(() => status === 'connected' && bridge.connected(), 'připojení aplikace');
    const command = emptySketch('s', { kind: 'base', plane: 'XY' });
    await session.call('execute', { command });
    await session.call('get_model');
    expect(before).toEqual([['execute', { command }], ['get_model', {}]]);
    // výjimka po provedení: odpověď dorazí a spojení zůstane
    failAfter = true;
    expect(await session.call('execute', { command: emptySketch('s2', { kind: 'base', plane: 'XY' }) })).toMatchObject({ ok: true, features: 2 });
    expect(bridge.connected()).toBe(true);
    failAfter = false;
    // výjimka posluchače enginu: změna je zapsaná a hlášení to říká
    const unsubscribe = app.subscribe(() => {
      throw new Error('posluchač spadl');
    });
    const failed = await session.call('execute', { command: emptySketch('s3', { kind: 'base', plane: 'XY' }) });
    expect(failed.error).toMatch(/v aplikaci nastala chyba \(změna už mohla být provedena, ověř stav\): posluchač spadl/);
    unsubscribe();
    expect((await session.call('get_model')).features).toHaveLength(3);
    connection.stop();
    await until(() => !bridge.connected(), 'odpojení');
    await session.close();
  });

  it('připojit se smí jen stránka z tohoto počítače; druhá aplikace nahradí první', async () => {
    const url = `http://127.0.0.1:${bridge.port}`;
    const header = { 'x-trymesh-bridge': '1' };
    expect((await fetch(`${url}/events`, { headers: { ...header, Origin: 'https://example.com' } })).status).toBe(403);
    // bez vlastní hlavičky (obrázek nebo požadavek bez CORS z cizí stránky) se připojit nejde
    expect((await fetch(`${url}/events`)).status).toBe(403);
    expect((await fetch(`${url}/reply`, { method: 'POST', body: '{}' })).status).toBe(403);
    expect(bridge.connected()).toBe(false);
    // cizí jméno v hlavičce Host (přesměrování DNS) se odmítne i s hlavičkou
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
    // svolení pro stránku z tohoto počítače včetně vlastní hlavičky
    const preflight = await fetch(`${url}/reply`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Headers': 'x-trymesh-bridge' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-trymesh-bridge');
    expect((await fetch(`${url}/reply`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } })).status).toBe(403);
    const local = await fetch(`${url}/status`, { headers: { Origin: 'http://localhost:5173' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(await local.json()).toEqual({ service: 'trymesh-mcp-bridge', connected: false });

    // Vytlačená aplikace se znovu nepřipojuje: jinak by si obě spojení přebíraly dokola
    // a příkaz od AI by mohl změnit nesprávný dokument.
    const [first, second] = [newEngine(), newEngine()];
    const states: Record<string, BridgeStatus[]> = { one: [], two: [] };
    let displaced = 0;
    const one = connectBridge(first, { url, retryMs: 10, onStatus: (next) => states.one.push(next), onDisplaced: () => displaced++ });
    await until(() => states.one.at(-1) === 'connected', 'první aplikace');
    const two = connectBridge(second, { url, retryMs: 10, onStatus: (next) => states.two.push(next), onDisplaced: () => displaced++ });
    await until(() => states.two.at(-1) === 'connected' && states.one.at(-1) === 'off', 'druhá aplikace nahradí první');
    await new Promise((resolve) => setTimeout(resolve, 150)); // mnohonásobek prodlevy mezi pokusy
    expect(states.one).toEqual(['connecting', 'connected', 'off']);
    expect(states.two).toEqual(['connecting', 'connected']);
    expect(displaced).toBe(1);
    const session = await connect({ bridge });
    await session.call('execute', { command: emptySketch('s', { kind: 'base', plane: 'XY' }) });
    expect(second.getState().document.features).toHaveLength(1);
    expect(first.getState().document.features).toHaveLength(0);
    // vytlačenou aplikaci jde připojit znovu jen výslovně (tlačítkem AI): pak převezme spojení ona
    const again = connectBridge(first, { url, retryMs: 10, onStatus: (next) => states.one.push(next) });
    await until(() => states.one.at(-1) === 'connected' && states.two.at(-1) === 'off', 'první aplikace se připojí znovu');
    await session.call('execute', { command: emptySketch('t', { kind: 'base', plane: 'XY' }) });
    expect(first.getState().document.features.map((feature) => feature.id)).toEqual(['t']);
    again.stop();
    one.stop();
    two.stop();
    await until(() => !bridge.connected(), 'odpojení');
    await session.close();
  });

  it('obsazený port: most se neotevře a server může běžet bez něj', async () => {
    await expect(startBridge(bridge.port)).rejects.toThrow();
  });
});
