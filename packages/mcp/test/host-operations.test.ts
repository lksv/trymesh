// Operations of the app (D37): the registry and its guards, and the way of a call from a client
// through the server and the bridge into the app and back, with operations made up for the test.
// - An operation added to the registry without a row in the two tables below does not compile.
import { type ArgSpecs, type Command, type Engine, type QueryOutcome, checkArgs, specProblems } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiDescription, apiText, hostOperations } from '../src/api';
import { type Bridge, startBridge } from '../src/bridge';
import { type BridgeStatus, connectBridge } from '../src/bridge-client';
import { type AnyHostOperation, type AppHost, HOST_OPERATIONS, type Host, type HostOperationArgs, type HostOperationName, type HostOperationSet, callHostOperation, hostOperationProblems, isHostOperation } from '../src/host';
import type { AppSelection } from '../src/get-selection';
import { type ToolAnswer, tools } from '../src/tools';
import { connect, newEngine } from './kit';

// ---------------------------------------------------------------- the guards

// Arguments of every operation, of the operation's own type, that are valid over `model()` below.
// The test checks them against the description; the operation itself needs the app to run, so
// its package tests it there (`view_image`: view-image.test.ts).
const FIXTURES: { [N in HostOperationName]: HostOperationArgs<N> } = {
  view_image: { view: 'top', bodies: ['disc'], section: { plane: { kind: 'base', plane: 'XY' }, offset: 5, flip: true }, width: 640, height: 480, colors: 'model' },
  get_selection: {},
};
// Every argument of every operation and whether a caller may leave it out, as the type says.
const ARGUMENTS: { [N in HostOperationName]: { [K in keyof Required<HostOperationArgs<N>>]: {} extends Pick<HostOperationArgs<N>, K> ? 'optional' : 'required' } } = {
  view_image: { view: 'optional', bodies: 'optional', section: 'optional', width: 'optional', height: 'optional', colors: 'optional' },
  get_selection: {},
};
const ENTRIES = Object.entries(HOST_OPERATIONS as Record<string, AnyHostOperation>);

describe('the registry of operations of the app', () => {
  it('every operation is described, its arguments are those of its type, and its name is free', async () => {
    expect(Object.keys(ARGUMENTS)).toEqual(Object.keys(HOST_OPERATIONS));
    expect(Object.keys(FIXTURES)).toEqual(Object.keys(HOST_OPERATIONS));
    const session = await connect({ operations: {} });
    const taken = (await session.client.listTools()).tools.map((tool) => tool.name);
    await session.close();
    for (const [name, spec] of ENTRIES) {
      const described = Object.fromEntries(Object.entries(spec.args).map(([arg, description]) => [arg, description.optional ? 'optional' : 'required']));
      expect(described, name).toEqual((ARGUMENTS as Record<string, unknown>)[name]);
      expect(specProblems(spec.args), name).toEqual([]);
      expect(spec.title && spec.summary && spec.returns, name).toBeTruthy();
      const { document, evaluation } = model().getState();
      expect(checkArgs(spec.args, (FIXTURES as Record<string, unknown>)[name], { document, evaluation }), name).toMatchObject({ ok: true });
      expect(apiText()).toContain(`- ${name} (`);
    }
    // an operation is a tool by its name: not one a tool has, and not an internal one
    expect(hostOperationProblems(HOST_OPERATIONS, [...taken, ...tools().map((tool) => tool.name)])).toEqual([]);
    expect(apiDescription().operations.map((entry) => entry.query)).toEqual(Object.keys(HOST_OPERATIONS));
    expect(apiText()).toContain('# Operations of the app');
  });
});

// ---------------------------------------------------------------- the way of a call

const model = (): Engine => {
  const engine = newEngine();
  engine.execute(disc);
  return engine;
};

// What the app of the test offers to its operations, besides the engine.
type TestHost = AppHost & { picture(width: number): Promise<string> };
const ARGS = {
  body: { kind: 'body', title: 'Body', summary: 'The body to look at.' },
  width: { kind: 'number', title: 'Width', spec: { title: 'Width', unit: 'count', min: { value: 1 }, integer: true, default: 320 }, summary: 'Width of the picture in pixels.', optional: true },
} as const satisfies ArgSpecs;
const seen: unknown[] = [];
const OPERATIONS: HostOperationSet = {
  view_image: {
    title: 'Picture of the view',
    summary: 'Renders what the user sees.',
    returns: 'a PNG image.',
    args: ARGS,
    run: async (host: Host, args: { body: string; width: number }): Promise<QueryOutcome<ToolAnswer>> => {
      seen.push(args);
      return { ok: true, result: { kind: 'image', mediaType: 'image/png', base64: await (host as Host & TestHost).picture(args.width) } };
    },
  },
  count_bodies: { title: 'Bodies', summary: 'Counts the bodies of the app.', returns: 'the number of bodies.', args: {}, run: async (host: Host) => ({ ok: true, result: { kind: 'data', data: { bodies: Object.keys(host.engine.getState().evaluation.bodies).length } } }) },
  busy: { title: 'Busy', summary: 'Refuses.', returns: 'nothing.', args: {}, run: async () => ({ ok: false, error: { code: 'failed', message: 'the view is not ready' } }) },
  broken: {
    title: 'Broken',
    summary: 'Throws.',
    returns: 'nothing.',
    args: {},
    run: async () => {
      throw new Error('no canvas');
    },
  },
  files: { title: 'Files', summary: 'Answers with files.', returns: 'files.', args: {}, run: async () => ({ ok: true, result: { kind: 'files', layout: 'file', files: [] } }) },
};

const disc: Command = {
  type: 'batch',
  commands: [
    { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
    { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    { type: 'addFeature', feature: { id: 'disc', name: 'disc', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
  ],
};
const until = async (condition: () => boolean, what: string) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!condition()) throw new Error(`waited in vain for ${what}`);
};

describe('an operation of the app', () => {
  let bridge: Bridge;
  beforeAll(async () => {
    bridge = await startBridge(0);
  });
  afterAll(async () => {
    await bridge.close();
  });
  const appWith = async (engine: Engine, host: (Host & TestHost) | undefined, operations: HostOperationSet = OPERATIONS) => {
    let status: BridgeStatus = 'off';
    const before: string[] = [];
    const calls: string[] = [];
    const connection = connectBridge(engine, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next), host, operations, beforeCall: (name) => before.push(name), onCall: (name) => calls.push(name) });
    await until(() => status === 'connected' && bridge.connected(), 'the app to connect');
    return { connection, before, calls };
  };

  it('is a tool of the server; the app runs it and the answer comes back as data or as an image', async () => {
    const session = await connect({ bridge, operations: OPERATIONS });
    const listed = (await session.client.listTools()).tools;
    expect(listed.map((tool) => tool.name).slice(-5)).toEqual(['view_image', 'count_bodies', 'busy', 'broken', 'files']);
    expect(listed.find((tool) => tool.name === 'view_image')).toMatchObject({
      description: 'Renders what the user sees. Returns a PNG image. It runs in the app: without a connected app it answers notAvailable.',
      inputSchema: { type: 'object', properties: { body: { description: 'the ID of a body. The body to look at.' }, width: { description: expect.stringMatching(/^a number, .*default 320\. Width of the picture in pixels\.$/) } }, required: ['body'], additionalProperties: false },
    });
    expect(hostOperations(OPERATIONS)[0]).toMatchObject({ query: 'view_image', args: [{ name: 'body', required: true }, { name: 'width', required: false }, { name: 'at', required: false }, { name: 'after', required: false }], returns: 'a PNG image.' });
    // no app: the operation has nothing to run in, whatever the document of the server holds
    session.engine.execute(disc);
    expect(await session.call('count_bodies')).toEqual({ error: expect.stringMatching(/^notAvailable: count_bodies: the operation runs in the app and no app is connected/) });

    const app = model();
    const widths: number[] = [];
    // the host is an instance of a class: an operation gets the object itself, with the methods of its prototype
    class AppOfTheTest {
      constructor(readonly engine: Engine) {}
      async picture(width: number): Promise<string> {
        widths.push(width);
        return Buffer.from(`png ${width}`).toString('base64');
      }
    }
    const { connection, before, calls } = await appWith(app, new AppOfTheTest(app));
    expect(await session.call('count_bodies')).toEqual({ bodies: 1 });
    // an image is image content of the protocol, not text
    const image = await session.client.callTool({ name: 'view_image', arguments: { body: 'disc' } });
    expect(image).toMatchObject({ content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('png 320').toString('base64') }] });
    expect(image.isError).toBeUndefined();
    expect((await session.client.callTool({ name: 'view_image', arguments: { body: 'disc', width: 64 } })).content).toEqual([{ type: 'image', mimeType: 'image/png', data: Buffer.from('png 64').toString('base64') }]);
    expect(seen).toEqual([{ body: 'disc', width: 320 }, { body: 'disc', width: 64 }]); // checked, the default filled in
    expect(widths).toEqual([320, 64]);
    // the arguments are checked by the app in the state of its document, before the operation runs
    expect(await session.call('view_image', {})).toEqual({ error: 'invalidArguments: view_image: body: the argument is required' });
    expect(await session.call('view_image', { body: 'disc', height: 3 })).toEqual({ error: 'invalidArguments: view_image: height: there is no argument "height"; the arguments are: body, width' });
    expect(await session.call('view_image', { body: 'disc', width: 0 })).toEqual({ error: expect.stringMatching(/^invalidArguments: view_image: width: /) });
    expect(await session.call('view_image', { body: 'nope' })).toEqual({ error: 'notAvailable: view_image: body: the body "nope" is not in the state asked about' });
    expect(seen).toHaveLength(2);
    // a refusal of the operation, a defect inside it, and an answer the tool cannot pass on
    expect(await session.call('busy')).toEqual({ error: 'failed: busy: the view is not ready' });
    expect(await session.call('broken')).toEqual({ error: 'the app failed to answer broken (nothing was changed): no canvas' });
    expect(await session.call('files')).toEqual({ error: 'the operation files answered with files, which this tool has no path to write to' });
    expect(bridge.connected()).toBe(true);
    // the app is told of every call it served, and is not asked to tidy up before an operation
    expect(calls).toEqual(['count_bodies', 'view_image', 'view_image', 'view_image', 'view_image', 'view_image', 'view_image', 'busy', 'broken', 'files']);
    expect(before).toEqual([]);
    expect(app.getState().canUndo).toBe(true);
    connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    await session.close();
  });

  it('an app without a host, or one that does not know the operation, answers in words', async () => {
    const session = await connect({ bridge, operations: OPERATIONS });
    const first = await appWith(newEngine(), undefined);
    expect(await session.call('count_bodies')).toEqual({ error: 'notAvailable: count_bodies: the connected app does not offer operations of the host' });
    first.connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    // an older app: the server offers an operation the app does not have
    const older = newEngine();
    const second = await appWith(older, { engine: older, picture: async () => '' }, {});
    expect(await session.call('count_bodies')).toEqual({ error: 'unknown tool "count_bodies"' });
    second.connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    await session.close();
  });

  it('a question that fails in the app says that nothing was changed; a command keeps its warning', async () => {
    const session = await connect({ bridge });
    const app = newEngine();
    const failing: Engine = { ...app, query: () => { throw new Error('the kernel fell over'); } };
    const { connection } = await appWith(failing, undefined);
    expect(await session.call('query', { query: 'interference' })).toEqual({ error: 'the app failed to answer query (nothing was changed): the kernel fell over' });
    const unsubscribe = app.subscribe(() => {
      throw new Error('a listener fell over');
    });
    expect((await session.call('execute', { command: disc })).error).toMatch(/an error occurred in the app \(the change may already have been made, check the state\): a listener fell over/);
    unsubscribe();
    connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    await session.close();
  });

  it('an operation cannot take the name of a tool: the server and the bridge client refuse to start', async () => {
    const entry = OPERATIONS.count_bodies;
    expect(hostOperationProblems(OPERATIONS, ['get_model', '_load'])).toEqual([]);
    expect(hostOperationProblems({ get_model: entry, _mine: entry, '': entry }, ['get_model'])).toEqual(['the operation "get_model" has the name of a tool', 'the operation "_mine" has the name of an internal tool (a leading underscore)', 'an operation has no name']);
    // a tool of the engine, an internal one, and a file tool of the server
    await expect(connect({ operations: { get_model: entry } })).rejects.toThrow('createTrymeshServer: the operation "get_model" has the name of a tool');
    await expect(connect({ operations: { _load: entry } })).rejects.toThrow(/the operation "_load" has the name of a tool; the operation "_load" has the name of an internal tool/);
    await expect(connect({ operations: { export: entry } })).rejects.toThrow('the operation "export" has the name of a tool');
    expect(() => connectBridge(newEngine(), { operations: { execute: entry } })).toThrow('connectBridge: the operation "execute" has the name of a tool');
    // a host of another engine than the one connected is a mistake of the app
    expect(() => connectBridge(newEngine(), { host: { engine: newEngine() }, operations: OPERATIONS })).toThrow('connectBridge: the host has another engine than the one connected');
  });

  it('get_selection (D74): no app, an app without the capability, the answer of one with it; it takes no at and no after', async () => {
    const session = await connect({ bridge });
    const tool = (await session.client.listTools()).tools.find((entry) => entry.name === 'get_selection');
    // an operation about the app as it is now: neither its schema nor describe_api offers a state path
    expect(tool?.inputSchema).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false });
    expect(hostOperations().find((entry) => entry.query === 'get_selection')?.args).toEqual([]);
    expect(hostOperations().find((entry) => entry.query === 'view_image')?.args.map((arg) => arg.name).slice(-2)).toEqual(['at', 'after']);
    expect(await session.call('get_selection')).toEqual({ error: expect.stringMatching(/^notAvailable: get_selection: the operation runs in the app and no app is connected/) });

    const app = model();
    const older = await appWith(app, { engine: app, picture: async () => '' }, HOST_OPERATIONS);
    expect(await session.call('get_selection')).toEqual({ error: 'notAvailable: get_selection: the app that is connected does not report its selection (an older app: reload it)' });
    older.connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');

    const selection: AppSelection = {
      mode: { kind: 'model' },
      pick: { body: 'disc', face: { feature: 'disc', role: 'endCap' }, planar: true },
      click: { point: [1 / 3, 0, 10], hit: { body: 'disc', face: { feature: 'disc', role: 'endCap' }, planar: true, normal: [0, 0, 1] } },
    };
    const asked: number[] = [];
    const host = { engine: app, picture: async () => '', selection: { selection: () => (asked.push(1), selection) } };
    const { connection } = await appWith(app, host, HOST_OPERATIONS);
    // the answer as data, its numbers rounded to six decimal places
    expect(await session.call('get_selection')).toEqual({ ...selection, click: { ...selection.click, point: [0.333333, 0, 10] } });
    expect(await session.call('get_selection', { at: null, after: null })).toMatchObject({ mode: { kind: 'model' } });
    // the selection exists only in the app as it is now
    expect(await session.call('get_selection', { at: 'disc' })).toEqual({ error: 'invalidArguments: get_selection: at: the operation answers about the app as it is now, so it takes no at and no after' });
    expect(await session.call('get_selection', { after: { type: 'setParameter', name: 'a', expr: '1' } })).toEqual({ error: 'invalidArguments: get_selection: after: the operation answers about the app as it is now, so it takes no at and no after' });
    expect(await session.call('get_selection', { what: 1 })).toEqual({ error: 'invalidArguments: get_selection: what: there is no argument "what"; there are no arguments' });
    expect(asked).toHaveLength(2);
    expect(app.getState().document.parameters).toEqual([]);
    connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    await session.close();
  });

  it('callHostOperation: the entry next to callTool', async () => {
    const engine = newEngine();
    engine.execute(disc);
    const host = { engine, picture: async () => 'AAAA' } as Host;
    expect(await callHostOperation(host, 'count_bodies', {}, OPERATIONS)).toEqual({ ok: true, result: { kind: 'data', data: { bodies: 1 } } });
    expect(await callHostOperation(host, 'view_image', { body: 'disc' }, OPERATIONS)).toEqual({ ok: true, result: { kind: 'image', mediaType: 'image/png', base64: 'AAAA' } });
    expect(await callHostOperation(host, 'nope', {}, OPERATIONS)).toEqual({ ok: false, error: 'there is no operation "nope"' });
    expect(await callHostOperation(host, 'constructor', {}, OPERATIONS)).toEqual({ ok: false, error: 'there is no operation "constructor"' });
    expect(await callHostOperation(host, 'count_bodies', {})).toEqual({ ok: false, error: 'there is no operation "count_bodies"' }); // not one of the registry
    await expect(callHostOperation(host, 'broken', {}, OPERATIONS)).rejects.toThrow('no canvas');
    expect(isHostOperation('view_image', OPERATIONS)).toBe(true);
    expect(isHostOperation('toString', OPERATIONS)).toBe(false);
    expect(isHostOperation('view_image')).toBe(true); // the one operation of the registry
    expect(isHostOperation('count_bodies')).toBe(false);
  });
});
