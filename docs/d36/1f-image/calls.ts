// Package 1f written out as calls: its part of validation scenario 11 (pictures of the robot
// joint of scenario 9: the whole joint, the gears with the housing hidden, the joint cut through
// the gears), the operation itself over the host, what happens without a connected app, and the
// app's own use of the capability. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract. Lines marked `@ts-expect-error`
// are calls that must not compile.

import type { Id } from '../../../packages/engine/src/index';
import type { ArgsOf, EngineAfter, HostOperation, QueryOutcome, ToolAnswer } from '../00-prep/contract';
import { HOST_OPERATIONS } from '../00-prep/contract';
import type { SectionResult } from '../1a-section/contract';
import { completeRegions } from '../1a-section/calls';
import type { ImageRequest, OperationHost, RenderedImage, ViewCapability, ViewImageArgs } from './contract';
import { MAX_IMAGE_BASE64, VIEWS, VIEW_IMAGE_ARGS, callOperation } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare const viewport: ViewCapability; // of the running app
declare function fail(message: string): never;
const app: OperationHost = { engine, view: viewport };
const server: OperationHost = { engine }; // a document from a file: no renderer

// ---------------------------------------------------------------- a. scenario 11: pictures of the joint

type Call = ArgsOf<typeof VIEW_IMAGE_ARGS>;
// The whole joint as the app starts with it; the gears alone, seen from above; and the joint cut
// across the axis through the gears, seen from above.
// - The gears alone: the housing, the plate and the motor are left out, and so is the carrier:
//   its disc (radius 30, z from 46.5 to 51.5) lies over the gears, which end at z = 46, and
//   would hide the sun and most of the planets from above.
export const wholeJoint: Call = {};
export const gearsOnly: Call = { view: 'top', bodies: ['sun', 'planet', 'planets/1', 'planets/2'], width: 1024, height: 768 };
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

// The cut of a request from an answer of the query `section` asked with polylines: the frame
// and, per region, its loops. Undefined when the answer is not complete: a region filled without
// one of its holes would show material across a cavity (the rule of 1a and its function, which
// lives in the engine next to the query). With `only`, the regions of other bodies are left
// out: the cut of a body that is not drawn is not filled.
export function cutOf(section: SectionResult, only?: readonly Id[]): ImageRequest['cut'] | undefined {
  const regions = completeRegions(section);
  if (!regions) return undefined;
  const drawn = only ? regions.filter(({ body }) => only.includes(body)) : regions;
  return { frame: section.frame, regions: drawn.map(({ region }) => ({ loops: [region.outer, ...region.holes].map((loop) => (loop.points ?? []).flat()) })) };
}

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
  // a section with more points than the budget is not drawn half filled
  const cut = cutOf(section.result);
  if (!cut) return refused('failed', `the section has ${section.result.truncated?.total} points, too many to draw; name fewer bodies`, ['section']);
  return { ...request, cut };
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

// The same capability behind a button of the app: the user saves a picture of the model from
// the camera of the view, at a fixed size. Nothing of this goes through the bridge.
// - `shown`: the answer of the query `section` the query panel shows at the moment, if it shows
//   one (the answer the section view asked for, with polylines). The picture is then cut as the
//   view is. An answer that is not complete cannot be drawn as a cut (the view clips it without
//   a fill and says so): nothing is saved then, and the app is told why, as the operation
//   answers `failed`. An uncut picture of a view that shows a cut would be the wrong picture.
// - `visible`: the bodies the user has not hidden; the others are not in the picture, and
//   neither are the fills of their cuts.
// - What the picture leaves out is what the capability leaves out: the selection, the sketches,
//   the planes and the labels. The button is labelled "Save picture of the model", not of the
//   view.
// The answer is what the status bar says.
export async function saveImage(state: ImageRequest['state'], visible: Id[], shown: SectionResult | undefined, save: (name: string, base64: string) => void): Promise<{ text: string; error: boolean }> {
  const cut = shown && cutOf(shown, visible);
  if (shown && !cut) return { text: 'The section is too large to draw, so no picture was saved. Close the section or cut fewer bodies.', error: true };
  const image = await viewport.image({ state, bodies: visible, camera: 'current', width: 1600, height: 1200, ...(cut ? { cut } : {}) });
  save('view.png', image.base64);
  return { text: 'Picture saved.', error: false };
}
