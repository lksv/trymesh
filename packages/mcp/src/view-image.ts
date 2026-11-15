// The operation `view_image` (D43): a picture of the model for the AI, drawn by the app that is
// connected. An operation of the app, not a query: the engine has no renderer.
// - What the app gives to it is one capability of its view (`AppHost.view`): a picture of a given
//   model from a given camera at a given size, drawn off the screen.
// - The operation turns its arguments into a request for that capability: the state, the bodies,
//   the camera, and the cut of the model, which it takes from the query `section`. So a picture
//   of a cut model and the section view of the app are drawn from one answer.
//
// This module has no dependency on Node or on a browser: the server and the app share it.
import { type EngineState, type Frame, type Id, type QueryOutcome, type RunArgsOf, SECTION_ARGS, type SectionResult, type Vec3, argText, completeRegions, takenAt } from '@trymesh/engine';
import type { ArgSpecs } from '@trymesh/engine';
import type { Host, HostOperation } from './host';
import type { Json, ToolAnswer } from './tools';

// ---------------------------------------------------------------- the views

// A camera: where it stands seen from what it looks at (a direction, not a position: the view is
// parallel and fitted to what is drawn), and what points up in the picture. The model has Z up.
export interface ViewCamera {
  from: Vec3;
  up: Vec3;
}
// The named views. `iso` is the direction the app starts with. `front` is seen from −Y with X
// to the right; `left` from −X; `top` from above with Y up in the picture.
export const VIEWS = {
  iso: { from: [0.55, -0.7, 0.45], up: [0, 0, 1] },
  front: { from: [0, -1, 0], up: [0, 0, 1] },
  back: { from: [0, 1, 0], up: [0, 0, 1] },
  left: { from: [-1, 0, 0], up: [0, 0, 1] },
  right: { from: [1, 0, 0], up: [0, 0, 1] },
  top: { from: [0, 0, 1], up: [0, 1, 0] },
  bottom: { from: [0, 0, -1], up: [0, 1, 0] },
} as const satisfies { readonly [name: string]: ViewCamera };

// ---------------------------------------------------------------- the capability of the host

// What the view of a running app gives to the host: a picture of a model from a camera, without
// touching what the user sees (it is drawn off the screen, at the size asked for, whatever the
// size of the window). The picture depends only on the request: the camera of the picture
// carries its own light, set as the light of the user's camera is, so the same request gives
// the same picture wherever the user happens to look.
// - `state`: the model to draw: its bodies with their edges, as the app draws a model, without
//   the selection, the sketches, the planes and the labels of the user's view.
// - `bodies`: only these are drawn, and the picture is fitted to them.
// - `camera`: a camera fitted to what is drawn, or `current`: the user's camera as it stands
//   (where it looks from, what it looks at, and at least all it shows).
// - `cut`: the half-space that is cut away and what fills the cut, as the section view draws
//   them: the frame of the plane the section was taken at (`takenAt`: the model is clipped there
//   and the fills lie in it) and, per region of the section, its body and its loops in the
//   x and y of that frame, the outer one first. The regions are all of them: a caller that has
//   only a part of a section does not ask for a cut.
// The answer says what it drew, so that a caller can relate pixels to millimetres and colours to
// bodies:
// - `scale` is millimetres per pixel;
// - `bodies`: the bodies of which something is drawn. Every body has its own colour, from
//   a fixed palette by its place among the bodies of the state (so a body keeps its colour when
//   others are left out, and the legend belongs to the state of its picture). The cut of a body
//   is filled with a darker shade of its colour, `cutColor`, given for a body the cut goes
//   through;
// - `cutAway`: the bodies asked for of which the cut leaves nothing.
export interface ImageCut {
  frame: Frame;
  regions: { body: Id; loops: number[][] }[];
}
export interface ImageRequest {
  state: EngineState;
  bodies?: readonly Id[];
  camera: ViewCamera | 'current';
  cut?: ImageCut;
  width: number; // pixels
  height: number;
}
export interface RenderedImage {
  base64: string; // PNG
  width: number;
  height: number;
  scale: number; // mm per pixel
  bodies: ({ body: Id; color: string; colorName: string } | { body: Id; color: string; colorName: string; cutColor: string })[]; // `#rrggbb` and what a person calls it
  cutAway: Id[];
}
export interface ViewCapability {
  image(request: ImageRequest): Promise<RenderedImage>;
}

declare module './host' {
  interface AppHost {
    // Absent in a host without a view (a test, an app that draws nothing): the operation then
    // answers `notAvailable`.
    view?: ViewCapability;
  }
  interface HostOperations {
    view_image: typeof VIEW_IMAGE_ARGS;
  }
}

// ---------------------------------------------------------------- the operation

// - `view`: a named view, `iso` without the argument; `current` is the camera of the user.
// - `bodies`: only these; the picture is fitted to them. Leaving out the housing shows the gears.
// - `section`: the model cut by a plane, as the query `section` takes it (a plane, an offset
//   along its normal, a flip). What lies on the side the normal points to is cut away and the
//   cut is filled. The three arguments are the descriptions of `SECTION_ARGS` themselves, with
//   their titles and defaults.
// - `at`: the model as it was after this feature. An argument here because the path of an
//   operation has no `at` of its own (the tool `query` has).
// - `width`, `height`: the size of the picture in pixels.
export const VIEW_IMAGE_ARGS = {
  view: { kind: 'choice', options: ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom', 'current'], title: 'View', summary: 'iso without it. front is seen from −Y, left from −X, top from above. current is the camera of the app as the user left it, and only the camera: the picture is not fitted to the bodies, bodies hidden in the app are drawn, and a section shown in the app is not applied.', optional: true },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Only these are drawn, and a named view is fitted to them; without it all bodies.', optional: true },
  section: {
    kind: 'fields',
    title: 'Section',
    summary: 'Cuts the model by a plane; what lies on the side its normal points to is not drawn, and the cut is filled. The cut is seen from the side that is removed: a base plane without a flip from the top (XY), from the front (XZ) or from the right (YZ). The answer says which bodies the plane goes through and which it removes whole.',
    optional: true,
    fields: { plane: SECTION_ARGS.plane, offset: SECTION_ARGS.offset, flip: SECTION_ARGS.flip },
  },
  at: { kind: 'feature', title: 'After the feature', summary: 'The model as it was after this feature.', optional: true },
  width: { kind: 'number', title: 'Width', optional: true, spec: { title: 'Width in pixels', unit: 'count', integer: true, min: { value: 64 }, max: { value: 1600 }, default: 800 } },
  height: { kind: 'number', title: 'Height', optional: true, spec: { title: 'Height in pixels', unit: 'count', integer: true, min: { value: 64 }, max: { value: 1600 }, default: 600 } },
} as const satisfies ArgSpecs;
export type ViewImageArgs = RunArgsOf<typeof VIEW_IMAGE_ARGS>;

// A picture larger than this (the length of its base64 text) is not sent: the answer is
// `failed` and says to ask for a smaller one. A picture of a shaded model compresses well; this
// is a guard against a tool answer of megabytes, not a size expected in use.
export const MAX_IMAGE_BASE64 = 2_000_000;
// The budget the section of a picture is asked with, as the section view of the app asks.
const SECTION_POINTS = 1_000_000;

type Refusal = Extract<QueryOutcome<ToolAnswer>, { ok: false }>;
const refused = (code: Refusal['error']['code'], message: string, arg?: (string | number)[]): Refusal => ({ ok: false, error: { code, message, ...(arg ? { arg } : {}) } });

// The cut of a request from an answer of the query `section` asked with polylines: the frame the
// section was taken at and, per region, its body and its loops. Undefined when the answer is not
// complete: a region filled without one of its holes would show material across a cavity (the
// rule of the section and its function in the engine). With `only`, the regions of other bodies
// are left out: the cut of a body that is not drawn is not filled.
export function cutOf(section: SectionResult, only?: readonly Id[]): ImageCut | undefined {
  const regions = completeRegions(section);
  if (!regions) return undefined;
  const drawn = only ? regions.filter(({ body }) => only.includes(body)) : regions;
  return { frame: takenAt(section), regions: drawn.map(({ body, region }) => ({ body, loops: [region.outer, ...region.holes].map((loop) => (loop.points ?? []).flatMap((point) => [point[0], point[1]])) })) };
}

// The model to draw: the state after `at`, the bodies checked against it, and the cut taken from
// the query `section`, which resolves the plane in the state asked about and gives the loops
// the cut is filled with.
// - The arguments were checked against the state of the document now (the path of an operation
//   has no other state). With `at` the bodies are looked up again here, in the state they are
//   drawn from.
// - A refusal names its argument as the check of the arguments does (`bodies[1]`,
//   `section.plane`): a tool answers with a text, and the text is what a caller reads.
// - `budget`: the points the section is asked with.
export function imageRequest(host: Host, args: ViewImageArgs, budget = SECTION_POINTS): ImageRequest | Refusal {
  const { engine } = host;
  const state = engine.getState(args.at);
  const missing = (args.bodies ?? []).findIndex((id) => !Object.prototype.hasOwnProperty.call(state.evaluation.bodies, id));
  if (missing >= 0) return refused('notAvailable', `bodies[${missing}]: the body "${args.bodies?.[missing]}" is not in the state after "${args.at}"`, ['bodies', missing]);
  const camera = args.view === undefined ? VIEWS.iso : args.view === 'current' ? 'current' : VIEWS[args.view];
  const request: ImageRequest = { state, camera, width: args.width, height: args.height, ...(args.bodies ? { bodies: args.bodies } : {}) };
  if (!args.section) return request;
  const { plane, offset, flip } = args.section;
  const section = engine.query('section', { plane, offset, ...(flip ? { flip } : {}), ...(args.bodies ? { bodies: [...args.bodies] } : {}), outline: 'polylines', maxPoints: budget }, args.at === undefined ? {} : { at: args.at });
  if (!section.ok) {
    // An error of the query names its own argument, and its text starts with the name of the
    // query and often with that argument. Here the plane, the offset and the flip sit under
    // `section`; `bodies` and `at` are arguments of the operation as well.
    const { code, message, arg = [] } = section.error;
    const path = arg[0] === 'bodies' || arg[0] === 'at' ? [...arg] : ['section', ...arg];
    const said = message.replace(/^section: /, '');
    const own = arg.length && said.startsWith(`${argText(arg)}: `) ? said.slice(argText(arg).length + 2) : said;
    return refused(code, `${argText(path)}: ${own}`, path);
  }
  // a section with more points than the budget is not drawn half filled
  const cut = cutOf(section.result);
  if (!cut) return refused('failed', `section: the section has ${section.result.truncated?.total} loops and points, too many to draw; name fewer bodies`, ['section']);
  return { ...request, cut };
}

export const viewImage: HostOperation<typeof VIEW_IMAGE_ARGS> = {
  title: 'View image',
  summary:
    'A picture of the model, to check its shape by eye: a named view fitted to the bodies drawn, optionally only some bodies (leave out a housing to see inside), optionally cut by a plane, optionally the model as it was after a feature. Every body has its own colour, listed with the picture. It shows the model, not the screen of the user: no selection, sketches, planes or dimensions.',
  returns:
    'a PNG image, and next to it as text: `width` and `height` in pixels, `scale` in millimetres per pixel, and `bodies`: the bodies of which something is drawn, each with its colour (`color` as #rrggbb and `colorName`) and, when the section goes through it, the colour its cut is filled with (`cutColor`, a darker shade of its colour). The edges of the bodies are drawn. With a section also `section.cut`, the bodies the plane goes through, and `section.cutAway`, the bodies it removes whole: a picture with nothing in it usually has the offset or the flip the wrong way round. A body has the colour of its place among the bodies of the state drawn, so a legend belongs to its own picture.',
  args: VIEW_IMAGE_ARGS,
  async run(host, args) {
    if (!host.view) return refused('notAvailable', 'the app that is connected has no view to draw a picture with. The queries section and body describe the shape in numbers without it.');
    const request = imageRequest(host, args);
    if ('ok' in request) return request;
    const image = await host.view.image(request);
    if (image.base64.length > MAX_IMAGE_BASE64) return refused('failed', `the picture is too large to send (${image.base64.length} characters of ${MAX_IMAGE_BASE64}); ask for a smaller width and height`, ['width']);
    const round = (value: number): number => Number(value.toPrecision(6));
    const about: { [key: string]: Json } = { width: image.width, height: image.height, scale: round(image.scale), bodies: image.bodies.map((entry) => ({ ...entry })) };
    // which bodies the plane goes through is in the answer of the section; which it removes whole, the view knows
    if (request.cut) about.section = { cut: [...new Set(request.cut.regions.map((region) => region.body))], cutAway: image.cutAway };
    return { ok: true, result: { kind: 'image', mediaType: 'image/png', base64: image.base64, about } };
  },
};
