// Package 1f written out as calls: its part of validation scenario 11 (pictures of the robot
// joint of scenario 9: the whole joint, the gears with the housing hidden, the joint cut through
// the gears), the operation itself over the host, what happens without a connected app, and the
// app's own use of the capability. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract. Lines marked `@ts-expect-error`
// are calls that must not compile.

import type { Id } from '../../../packages/engine/src/index';
import type { ArgsOf, EngineAfter, HostOperation, QueryOutcome, ToolAnswer } from '../00-prep/contract';
import { HOST_OPERATIONS } from '../00-prep/contract';
import type { ImageRequest, OperationHost, RenderedImage, ViewCapability, ViewImageArgs } from './contract';
import { MAX_IMAGE_BASE64, VIEWS, VIEW_IMAGE_ARGS, callOperation } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare const viewport: ViewCapability; // of the running app
declare function fail(message: string): never;
const app: OperationHost = { engine, view: viewport };
const server: OperationHost = { engine }; // a document from a file: no renderer

// ---------------------------------------------------------------- a. scenario 11: pictures of the joint

type Call = ArgsOf<typeof VIEW_IMAGE_ARGS>;
// The whole joint as the app starts with it; the gears with the housing, the plate and the
// motor left out; and the joint cut across the axis through the gears, seen from above.
export const wholeJoint: Call = {};
export const gearsOnly: Call = { view: 'top', bodies: ['sun', 'planet', 'planets/1', 'planets/2', 'carrier'], width: 1024, height: 768 };
export const cutThroughTheGears: Call = { view: 'top', section: { plane: { kind: 'base', plane: 'XY' }, offset: 40 } };
export const beforeTheRing: Call = { view: 'front', section: { plane: { kind: 'base', plane: 'XZ' } }, at: 'motorBore' };
export const whatTheUserLooksAt: Call = { view: 'current' };

export async function picture(args: Call): Promise<string> {
  const outcome = await callOperation(app, 'view_image', args);
  if (!outcome.ok) return fail(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result.kind === 'image' ? outcome.result.base64 : fail('a picture is an image');
}

// Without a connected app there is no picture, and the answer says what to do instead.
export async function withoutAnApp(): Promise<string> {
  const outcome = await callOperation(server, 'view_image', {});
  return outcome.ok ? fail('expected an error') : outcome.error.code; // notAvailable
}

// What is named and is not in the state is answered like for a query, with the path of the argument.
export async function unknownBody(): Promise<string> {
  const outcome = await callOperation(app, 'view_image', { bodies: ['housing', 'nope'] });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // notAvailable in bodies,1
}
export async function roundCuttingPlane(): Promise<string> {
  const outcome = await callOperation(app, 'view_image', { section: { plane: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'side', curve: 'ho' } } } });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // failed in section,plane
}

// @ts-expect-error a view that has no name
export const noSuchView: Call = { view: 'isometric' };
// @ts-expect-error a section needs its plane
export const noPlane: Call = { section: { offset: 40 } };

// ---------------------------------------------------------------- b. the operation, over the host

const refused = (code: 'notAvailable' | 'failed', message: string, arg?: (string | number)[]): QueryOutcome<ToolAnswer> => ({ ok: false, error: { code, message, ...(arg ? { arg } : {}) } });

// The model to draw: the state after `at`, the bodies checked against it, and the cut taken from
// the query `section` of 1a, which resolves the plane (in the state asked about) and gives the
// loops the cut is filled with. So the picture of a cut model and the section view of the app
// are drawn from the same answer.
function requestOf(host: OperationHost, args: ViewImageArgs): ImageRequest | QueryOutcome<ToolAnswer> {
  const { engine } = host;
  if (args.at !== undefined && !engine.getState().document.features.some((feature) => feature.id === args.at)) return refused('notAvailable', `the document has no feature "${args.at}"`, ['at']);
  const state = engine.getState(args.at);
  const missing = (args.bodies ?? []).findIndex((id: Id) => !Object.prototype.hasOwnProperty.call(state.evaluation.bodies, id));
  if (missing >= 0) return refused('notAvailable', `the body "${args.bodies?.[missing]}" is not in this state`, ['bodies', missing]);
  const camera = args.view === undefined ? VIEWS.iso : args.view === 'current' ? 'current' : VIEWS[args.view];
  const request: ImageRequest = { state, camera, width: args.width, height: args.height, ...(args.bodies ? { bodies: args.bodies } : {}) };
  if (!args.section) return request;
  const { plane, offset, flip } = args.section;
  const section = engine.query('section', { plane, offset, ...(flip ? { flip } : {}), ...(args.bodies ? { bodies: args.bodies } : {}), outline: 'polylines', maxPoints: 1_000_000 }, args.at === undefined ? {} : { at: args.at });
  // an error of the query names its own argument; here that argument sits under `section`
  if (!section.ok) return refused(section.error.code === 'invalidArguments' ? 'failed' : section.error.code, section.error.message, section.error.arg?.[0] === 'bodies' ? [...section.error.arg] : ['section', ...(section.error.arg ?? [])]);
  const regions = section.result.bodies.flatMap((body) => body.regions).map((region) => ({ loops: [region.outer, ...region.holes].map((loop) => (loop.points ?? []).flat()) }));
  return { ...request, cut: { frame: section.result.frame, regions } };
}

export const viewImage: HostOperation<typeof VIEW_IMAGE_ARGS> = {
  title: 'View image',
  summary: 'A picture of the model: a named view fitted to the bodies drawn, optionally only some bodies, optionally cut by a plane. It needs the app connected; over a document from a file there is no picture.',
  returns: 'A PNG image. Each body has its own colour; the edges of the bodies are drawn; a cut is filled.',
  args: VIEW_IMAGE_ARGS,
  async run(host, args) {
    if (!host.view) return refused('notAvailable', 'a picture needs the app: no app is connected to this server (session_status says how to connect one). The queries section and body describe the shape in numbers without it.');
    const request = requestOf(host, args);
    if ('ok' in request) return request;
    const image: RenderedImage = await host.view.image(request);
    if (image.base64.length > MAX_IMAGE_BASE64) return refused('failed', 'the picture is too large to send; ask for a smaller width and height', ['width']);
    // `scale` and the colours of the bodies have no place in the answer yet: see "Needs from the preparatory step"
    return { ok: true, result: { kind: 'image', mediaType: 'image/png', base64: image.base64 } };
  },
};
// The operation goes into the registry as it is, by its tool name.
export const registered: Pick<typeof HOST_OPERATIONS, 'view_image'> = { view_image: viewImage };

// ---------------------------------------------------------------- c. the app's own use

// The same capability behind a button of the app: the user saves a picture of what the view
// shows, at the size they choose. Nothing of this goes through the bridge.
export async function saveImage(state: ImageRequest['state'], save: (name: string, base64: string) => void): Promise<void> {
  const image = await viewport.image({ state, camera: 'current', width: 1600, height: 1200 });
  save('view.png', image.base64);
}
