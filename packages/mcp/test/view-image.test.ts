// The operation `view_image` (D43): what it asks of the view of the app for given arguments (the
// state, the bodies, the camera, the cut taken from the query `section`), its refusals, and the
// way of a picture from the app through the bridge and the server to a client. The view here
// draws nothing: it writes down what it was asked for.
import { type Command, type Engine, SECTION_ARGS, type SectionResult, completeRegions, takenAt } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Bridge, startBridge } from '../src/bridge';
import { type BridgeStatus, connectBridge } from '../src/bridge-client';
import { HOST_OPERATIONS, type Host, callHostOperation } from '../src/host';
import type { ToolAnswer } from '../src/tools';
import { type ImageRequest, MAX_IMAGE_BASE64, type RenderedImage, VIEWS, cutOf } from '../src/view-image';
import { connect, newEngine } from './kit';

// A disc of radius 5 and height 10 at the origin (`disc`), a pin of radius 3 and height 20 at
// x = 20 (`pin`), and after them a block 4 × 4 × 4 far along Y (`late`).
const sketch = (id: string): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } });
const extrude = (id: string, from: string, loop: string[], distance: number): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: from, regions: [{ outerLoop: loop }] }, extent: { type: 'distance', start: 0, distance }, operation: 'new' },
});
const MODEL: Command = {
  type: 'batch',
  commands: [
    sketch('s'),
    { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    { type: 'addPoint', sketch: 's', id: 'p', x: 20, y: 0 },
    { type: 'addCurve', sketch: 's', id: 'm', curve: { type: 'circle', center: 'p' }, radius: 3 },
    extrude('disc', 's', ['k'], 10),
    extrude('pin', 's', ['m'], 20),
    sketch('t'),
    { type: 'addPoint', sketch: 't', id: 'a', x: 0, y: 50 },
    { type: 'addPoint', sketch: 't', id: 'b', x: 4, y: 50 },
    { type: 'addPoint', sketch: 't', id: 'c', x: 4, y: 54 },
    { type: 'addPoint', sketch: 't', id: 'd', x: 0, y: 54 },
    { type: 'addCurve', sketch: 't', id: 'ab', curve: { type: 'line', a: 'a', b: 'b' } },
    { type: 'addCurve', sketch: 't', id: 'bc', curve: { type: 'line', a: 'b', b: 'c' } },
    { type: 'addCurve', sketch: 't', id: 'cd', curve: { type: 'line', a: 'c', b: 'd' } },
    { type: 'addCurve', sketch: 't', id: 'da', curve: { type: 'line', a: 'd', b: 'a' } },
    extrude('late', 't', ['ab', 'bc', 'cd', 'da'], 4),
  ],
};
function model(): Engine {
  const engine = newEngine();
  const done = engine.execute(MODEL);
  if (!done.ok) throw new Error(done.error.message);
  expect(Object.keys(engine.getState().evaluation.bodies)).toEqual(['disc', 'pin', 'late']);
  return engine;
}

// A host whose view writes down every request and answers with a picture of `base64`.
function hostOf(engine: Engine, base64 = 'UE5H'): { host: Host; requests: ImageRequest[] } {
  const requests: ImageRequest[] = [];
  const view = {
    async image(request: ImageRequest): Promise<RenderedImage> {
      requests.push(request);
      const drawn = Object.keys(request.state.evaluation.bodies).filter((id) => !request.bodies || request.bodies.includes(id));
      return { base64, width: request.width, height: request.height, scale: 0.123456789, bodies: drawn.map((body, index) => ({ body, color: `#00000${index}`, colorName: `colour ${index}` })) };
    },
  };
  return { host: { engine, view }, requests };
}
const ask = (host: Host, args: unknown) => callHostOperation(host, 'view_image', args);
const pictureOf = async (host: Host, args: unknown): Promise<Extract<ToolAnswer, { kind: 'image' }>> => {
  const outcome = await ask(host, args);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result as Extract<ToolAnswer, { kind: 'image' }>;
};
const XZ = { kind: 'base', plane: 'XZ' };

describe('the operation view_image', () => {
  const engine = model();

  it('without arguments: the whole model as it is now, from the direction the app starts with, 800 by 600', async () => {
    const { host, requests } = hostOf(engine);
    const picture = await pictureOf(host, {});
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({ state: engine.getState(), camera: VIEWS.iso, width: 800, height: 600 });
    expect(requests[0].state.document).toBe(engine.getState().document);
    // the picture, and next to it what pixels do not say: the scale to six digits and the colour of every body
    expect(picture).toEqual({
      kind: 'image',
      mediaType: 'image/png',
      base64: 'UE5H',
      about: { width: 800, height: 600, scale: 0.123457, bodies: [{ body: 'disc', color: '#000000', colorName: 'colour 0' }, { body: 'pin', color: '#000001', colorName: 'colour 1' }, { body: 'late', color: '#000002', colorName: 'colour 2' }] },
    });
  });

  it('a named view, some bodies, a size; `current` is the camera of the user', async () => {
    const { host, requests } = hostOf(engine);
    await pictureOf(host, { view: 'top', bodies: ['pin', 'disc'], width: 1024, height: 768 });
    expect(requests[0]).toMatchObject({ camera: { from: [0, 0, 1], up: [0, 1, 0] }, bodies: ['pin', 'disc'], width: 1024, height: 768 });
    expect(requests[0].cut).toBeUndefined();
    await pictureOf(host, { view: 'current' });
    expect(requests[1].camera).toBe('current');
    for (const view of ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom'] as const) {
      await pictureOf(host, { view });
      expect(requests[requests.length - 1].camera).toBe(VIEWS[view]);
    }
    // every named view looks along its direction with something else up
    for (const camera of Object.values(VIEWS)) expect(Math.abs(camera.from[0] * camera.up[0] + camera.from[1] * camera.up[1] + camera.from[2] * camera.up[2])).toBeLessThan(0.5);
    expect(VIEWS.front).toEqual({ from: [0, -1, 0], up: [0, 0, 1] });
    expect(VIEWS.left).toEqual({ from: [-1, 0, 0], up: [0, 0, 1] });
  });

  it('the model as it was after a feature: the state and the bodies of that state', async () => {
    const { host, requests } = hostOf(engine);
    const picture = await pictureOf(host, { at: 'pin' });
    expect(requests[0].state).toEqual(engine.getState('pin'));
    expect(Object.keys(requests[0].state.evaluation.bodies)).toEqual(['disc', 'pin']);
    expect((picture.about?.bodies as { body: string }[]).map((entry) => entry.body)).toEqual(['disc', 'pin']);
    // a body of the document that the earlier state does not have yet
    expect(await ask(host, { at: 'pin', bodies: ['disc', 'late'] })).toEqual({ ok: false, error: 'notAvailable: view_image: bodies: the body "late" is not in the state after "pin"' });
    expect(requests).toHaveLength(1);
  });

  it('a section: the cut is the answer of the query section, in the plane it was taken at, a region per body', async () => {
    const { host, requests } = hostOf(engine);
    // the plane y = 1 (the normal of XZ is −Y): what lies at y < 1 is cut away
    await pictureOf(host, { section: { plane: XZ, offset: -1 } });
    const asked = engine.query('section', { plane: { kind: 'base', plane: 'XZ' }, offset: -1, outline: 'polylines', maxPoints: 1_000_000 });
    if (!asked.ok) throw new Error(asked.error.message);
    const cut = requests[0].cut;
    expect(cut?.frame).toEqual(takenAt(asked.result));
    expect(cut?.frame.normal).toEqual([0, -1, 0]);
    expect(cut?.frame.origin[1]).toBeGreaterThan(1); // just below the plane asked for, against its normal
    expect(cut?.frame.origin[1]).toBeLessThan(1.001);
    // the disc and the pin are cut, the block far along Y is not
    expect(cut?.regions.map((region) => region.body)).toEqual(['disc', 'pin']);
    expect(cut?.regions.map((region) => region.loops.length)).toEqual([1, 1]);
    // a rectangle each: four corners, flat as x and y of the frame
    expect(cut?.regions.map((region) => region.loops[0].length)).toEqual([8, 8]);
    const [low, high] = [Math.min(...(cut?.regions[1].loops[0].filter((_, index) => index % 2 === 1) ?? [])), Math.max(...(cut?.regions[1].loops[0].filter((_, index) => index % 2 === 1) ?? []))];
    expect([low, high]).toEqual([expect.closeTo(0, 6), expect.closeTo(20, 6)]); // the pin is 20 high
    expect(cut).toEqual(cutOf(asked.result));
    // seen from the other side, and only of the bodies drawn
    await pictureOf(host, { section: { plane: XZ, offset: -1, flip: true }, bodies: ['pin'] });
    expect(requests[1].cut?.frame.normal).toEqual([expect.closeTo(0, 12), 1, expect.closeTo(0, 12)]);
    expect(requests[1].cut?.regions.map((region) => region.body)).toEqual(['pin']);
    // in an earlier state the plane cuts what was there then
    await pictureOf(host, { section: { plane: XZ, offset: -52 }, at: 'pin' });
    expect(requests[2].cut?.regions).toEqual([]);
    await pictureOf(host, { section: { plane: XZ, offset: -52 } });
    expect(requests[3].cut?.regions.map((region) => region.body)).toEqual(['late']);
  });

  it('a cut is taken only from a complete answer, and only of the bodies named', () => {
    const asked = engine.query('section', { plane: { kind: 'base', plane: 'XZ' }, offset: -1, outline: 'polylines', maxPoints: 1_000_000 });
    if (!asked.ok) throw new Error(asked.error.message);
    const whole: SectionResult = asked.result;
    expect(cutOf(whole)?.regions).toHaveLength(completeRegions(whole)?.length ?? -1);
    expect(cutOf(whole, ['pin'])?.regions.map((region) => region.body)).toEqual(['pin']);
    expect(cutOf(whole, [])?.regions).toEqual([]);
    // an answer that left something out is not drawn half filled
    expect(cutOf({ ...whole, truncated: { shown: 3, total: 9 } })).toBeUndefined();
    const short = engine.query('section', { plane: { kind: 'base', plane: 'XZ' }, offset: -1, outline: 'polylines', maxPoints: 5 });
    expect(short.ok && cutOf(short.result)).toBeUndefined();
  });

  it('refusals: a host without a view, what is not in the model, a plane that is not one, a picture too large', async () => {
    const { host, requests } = hostOf(engine);
    expect(await ask({ engine }, {})).toEqual({ ok: false, error: 'notAvailable: view_image: the app that is connected has no view to draw a picture with. The queries section and body describe the shape in numbers without it.' });
    // the arguments are checked before the operation runs, in the state of the document
    expect(await ask(host, { bodies: ['disc', 'nope'] })).toEqual({ ok: false, error: 'notAvailable: view_image: bodies[1]: the body "nope" is not in the state asked about' });
    expect(await ask(host, { at: 'nope' })).toMatchObject({ ok: false, error: expect.stringMatching(/^notAvailable: view_image: at: /) });
    expect(await ask(host, { view: 'isometric' })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidArguments: view_image: view: /) });
    expect(await ask(host, { section: { offset: 4 } })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidArguments: view_image: section\.plane: /) });
    expect(await ask(host, { width: 63 })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidArguments: view_image: width: /) });
    expect(await ask(host, { height: 1601 })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidArguments: view_image: height: /) });
    expect(await ask(host, { bodies: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/^invalidArguments: view_image: bodies: /) });
    // the round wall of the disc is no plane: the query section says so, and the operation passes it on
    const round = await ask(host, { section: { plane: { kind: 'face', body: 'disc', face: { feature: 'disc', role: 'side', curve: 'k' } } } });
    expect(round).toMatchObject({ ok: false, error: expect.stringMatching(/^notAvailable: view_image: section: the face is not planar/) });
    expect(requests).toEqual([]);
    // a picture over the limit is not sent
    const large = hostOf(engine, 'A'.repeat(MAX_IMAGE_BASE64 + 1));
    expect(await ask(large.host, {})).toEqual({ ok: false, error: `failed: view_image: the picture is too large to send (${MAX_IMAGE_BASE64 + 1} characters of ${MAX_IMAGE_BASE64}); ask for a smaller width and height` });
    const fits = hostOf(engine, 'A'.repeat(MAX_IMAGE_BASE64));
    expect((await ask(fits.host, {})).ok).toBe(true);
  });

  it('the registry has the operation, described for the AI', () => {
    expect(Object.keys(HOST_OPERATIONS)).toEqual(['view_image']);
    // the three arguments of a section are the descriptions of the query themselves
    expect(HOST_OPERATIONS.view_image.args.section.fields).toEqual({ plane: SECTION_ARGS.plane, offset: SECTION_ARGS.offset, flip: SECTION_ARGS.flip });
    expect(HOST_OPERATIONS.view_image.args.section.fields.offset).toBe(SECTION_ARGS.offset);
    expect(HOST_OPERATIONS.view_image.args.width.spec).toMatchObject({ min: { value: 64 }, max: { value: 1600 }, default: 800 });
    expect(HOST_OPERATIONS.view_image.args.height.spec).toMatchObject({ min: { value: 64 }, max: { value: 1600 }, default: 600 });
  });
});

describe('a picture on its way to a client', () => {
  let bridge: Bridge;
  beforeAll(async () => {
    bridge = await startBridge(0);
  });
  afterAll(async () => {
    await bridge.close();
  });
  const until = async (condition: () => boolean, what: string) => {
    for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!condition()) throw new Error(`waited in vain for ${what}`);
  };

  it('the server lists the tool; the app draws; the client gets image content and the text about it', async () => {
    const session = await connect({ bridge });
    const tool = (await session.client.listTools()).tools.find((entry) => entry.name === 'view_image');
    expect(tool?.description).toMatch(/^A picture of the model, to check its shape by eye/);
    expect(tool?.description).toMatch(/It runs in the app: without a connected app it answers notAvailable\.$/);
    expect(Object.keys((tool?.inputSchema as { properties: object }).properties)).toEqual(['view', 'bodies', 'section', 'at', 'width', 'height']);
    expect((tool?.inputSchema as { required: string[] }).required).toEqual([]);
    // no app: nothing to draw with, whatever the document of the server holds
    session.engine.execute(MODEL);
    expect(await session.call('view_image')).toEqual({ error: expect.stringMatching(/^notAvailable: view_image: the operation runs in the app and no app is connected/) });

    const app = model();
    const { host, requests } = hostOf(app);
    let status: BridgeStatus = 'off';
    const served: string[] = [];
    const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next), host, onCall: (name, outcome) => served.push(`${name} ${outcome.ok ? 'ok' : outcome.error}`) });
    await until(() => status === 'connected' && bridge.connected(), 'the app to connect');
    const answer = await session.client.callTool({ name: 'view_image', arguments: { view: 'front', bodies: ['pin'], section: { plane: XZ, offset: -1 }, width: 320, height: 240 } });
    expect(answer.isError).toBeUndefined();
    const content = answer.content as { type: string; data?: string; mimeType?: string; text?: string }[];
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'image', data: 'UE5H', mimeType: 'image/png' });
    expect(JSON.parse(content[1].text ?? '')).toEqual({ width: 320, height: 240, scale: 0.123457, bodies: [{ body: 'pin', color: '#000000', colorName: 'colour 0' }] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ camera: VIEWS.front, bodies: ['pin'], width: 320, height: 240 });
    expect(requests[0].cut?.regions.map((region) => region.body)).toEqual(['pin']);
    // a refusal comes back as the text of an error; the app is told of both calls
    expect(await session.call('view_image', { bodies: ['nope'] })).toEqual({ error: 'notAvailable: view_image: bodies[0]: the body "nope" is not in the state asked about' });
    expect(served).toEqual(['view_image ok', 'view_image notAvailable: view_image: bodies[0]: the body "nope" is not in the state asked about']);
    expect(app.getState().canUndo).toBe(true);
    connection.stop();
    await until(() => !bridge.connected(), 'the app to disconnect');
    await session.close();
  });
});
