// The operation `view_image` (D43): a picture of the model for the AI, drawn by the app that is
// connected. An operation of the app, not a query: the engine has no renderer.
// - What the app gives to it is one capability of its view (`AppHost.view`): a picture of a given
//   model from a given camera at a given size, drawn off the screen.
// - The operation turns its arguments into a request for that capability: the state, the bodies,
//   the camera, and the cut of the model, which it takes from the query `section`. So a picture
//   of a cut model and the section view of the app are drawn from one answer.
//
// This module has no dependency on Node or on a browser: the server and the app share it.
import { type EngineState, type Frame, type Id, type QueryOutcome, type RunArgsOf, SECTION_ARGS, type SectionResult, type Vec3, argText, blockingJoints, completeRegions, poseNote, poseOfBody, takenAt } from '@trymesh/engine';
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
  // `model` (D73): a body in the colour of its body properties, else in that of the palette
  colors?: 'palette' | 'model';
  width: number; // pixels
  height: number;
}
export interface RenderedImage {
  base64: string; // PNG
  width: number;
  height: number;
  scale: number; // mm per pixel
  // `#rrggbb` and what a person calls it; with the colours of the model, `colorFrom` says whether
  // the body has a colour of its own (`model`) or one of the palette
  bodies: { body: Id; color: string; colorName: string; cutColor?: string; colorFrom?: 'model' | 'palette' }[];
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
// The state is not an argument: `at` and `after` are on the path of every operation (5b, host.ts).
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
  width: { kind: 'number', title: 'Width', optional: true, spec: { title: 'Width in pixels', unit: 'count', integer: true, min: { value: 64 }, max: { value: 1600 }, default: 800 } },
  height: { kind: 'number', title: 'Height', optional: true, spec: { title: 'Height in pixels', unit: 'count', integer: true, min: { value: 64 }, max: { value: 1600 }, default: 600 } },
  colors: { kind: 'choice', options: ['palette', 'model'], title: 'Colours', summary: 'palette without it: every body in a colour of a fixed palette, so bodies are told apart. model: every body in the colour its body properties give it (`color`), and a body without one in that of the palette; the legend says which (`colorFrom`).', optional: true },
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

// The model to draw: the state the path of the operation asked about (`at`, `after`), the bodies
// looked up in it, and the cut taken from the query `section`, which resolves the plane in that
// state and gives the loops the cut is filled with.
// - The path checked the arguments in the same state; the bodies are looked up again here for
//   a caller that hands a state of its own.
// - A refusal names its argument as the check of the arguments does (`bodies[1]`,
//   `section.plane`): a tool answers with a text, and the text is what a caller reads.
// - With a section, a drawn body whose pose is not known (a link beyond a joint without a motion)
//   is refused with the operation's own text: the section is a query, posed, and a cut drawn from
//   another pose than the body would be wrong. Without one such a body is drawn with the joint at
//   zero, as the view of the app draws it, and the answer says so.
// - `budget`: the points the section is asked with.
export function imageRequest(host: Host, args: ViewImageArgs, state: EngineState, budget = SECTION_POINTS, after?: unknown): ImageRequest | Refusal {
  const { engine } = host;
  const missing = (args.bodies ?? []).findIndex((id) => !Object.prototype.hasOwnProperty.call(state.evaluation.bodies, id));
  if (missing >= 0) return refused('notAvailable', `bodies[${missing}]: the body "${args.bodies?.[missing]}" is not in the state asked about`, ['bodies', missing]);
  const camera = args.view === undefined ? VIEWS.iso : args.view === 'current' ? 'current' : VIEWS[args.view];
  const request: ImageRequest = { state, camera, width: args.width, height: args.height, ...(args.bodies ? { bodies: args.bodies } : {}), ...(args.colors === 'model' ? { colors: 'model' } : {}) };
  if (!args.section) return request;
  const blocked = blockedBodies(state, args.bodies ?? Object.keys(state.evaluation.bodies));
  if (blocked.length) return refused('failed', blockedSectionText(state, blocked, args.bodies ?? Object.keys(state.evaluation.bodies), after), ['section']);
  const { plane, offset, flip } = args.section;
  const section = engine.query('section', { plane, offset, ...(flip ? { flip } : {}), ...(args.bodies ? { bodies: [...args.bodies] } : {}), outline: 'polylines', maxPoints: budget }, { state });
  if (!section.ok) {
    // An error of the query names its own argument, and its text starts with the name of the
    // query and often with that argument. Here the plane, the offset and the flip sit under
    // `section`; `bodies` is an argument of the operation as well.
    const { code, message, arg = [] } = section.error;
    const path = arg[0] === 'bodies' ? [...arg] : ['section', ...arg];
    const said = message.replace(/^section: /, '');
    const own = arg.length && said.startsWith(`${argText(arg)}: `) ? said.slice(argText(arg).length + 2) : said;
    return refused(code, `${argText(path)}: ${own}`, path);
  }
  // a section with more points than the budget is not drawn half filled
  const cut = cutOf(section.result);
  if (!cut) return refused('failed', `section: the section has ${section.result.truncated?.total} loops and points, too many to draw; name fewer bodies`, ['section']);
  return { ...request, cut };
}

// The bodies of a list whose pose is not known in the state: a link beyond a joint without a motion.
function blockedBodies(state: EngineState, bodies: readonly Id[]): Id[] {
  return bodies.filter((body) => {
    const pose = poseOfBody(state.evaluation.mechanism, body);
    return pose !== undefined && 'blockedBy' in pose;
  });
}

// The refusal of a section through bodies whose pose is not known: the joints that block, and the
// ways out of a picture: the bodies without them, and the joints at zero (with the caller's own
// `after` in one batch) only where each can stand there: its only fault is its axis and its limits
// allow zero, as the text of a query offers it.
function blockedSectionText(state: EngineState, blocked: Id[], drawn: readonly Id[], after: unknown): string {
  const { mechanism } = state.evaluation;
  const section = state.document.mechanism;
  const joints = [...new Set(blocked.flatMap((body) => blockingJoints(section, mechanism, body)))];
  const faultOf = (joint: Id): string => {
    const error = mechanism.joints[joint]?.error;
    return error ? `${error.code}: ${error.message}` : 'in error';
  };
  const zeroable = joints.length > 0 && joints.every((joint) => {
    const result = mechanism.joints[joint];
    return result?.error?.code === 'brokenReference' && !((result.lower ?? 0) > 0) && !((result.upper ?? 0) < 0);
  });
  const others = drawn.filter((body) => !blocked.includes(body));
  const pose = { type: 'setPose', values: Object.fromEntries(joints.map((joint) => [joint, 0])) };
  const command = after === undefined || after === null ? pose : { type: 'batch', commands: [after, pose] };
  return (
    `section: the pose of ${blocked.length === 1 ? 'the body' : 'the bodies'} ${blocked.map((body) => `"${body}"`).join(', ')} is not known, so the section cannot be cut through ${blocked.length === 1 ? 'it' : 'them'}: ` +
    `${joints.map((joint) => `the joint "${joint}" has no motion (${faultOf(joint)})`).join('; ')}. ` +
    `Without a section the picture draws ${blocked.length === 1 ? 'it' : 'them'} with the joint at zero` +
    (others.length ? `; a section of the other bodies: bodies: ${JSON.stringify(others)}` : '') +
    (zeroable ? `; or the joints at zero, which writes nothing: after: ${JSON.stringify(command)}` : '')
  );
}

// What a picture of a posed state says beside it: the joints that move the model with their values
// (as the tools `query` and `get_body` put it), and the joints without a motion with the drawn
// bodies beyond them, which are drawn with the joint standing at zero.
function poseAbout(state: EngineState, drawn: readonly Id[]): { pose?: Record<Id, number>; blocked?: { joint: Id; bodies: Id[] }[] } {
  const note = poseNote(state.evaluation.mechanism, state.document.mechanism);
  const blocked = new Map<Id, Id[]>();
  for (const body of drawn) {
    const pose = poseOfBody(state.evaluation.mechanism, body);
    if (pose !== undefined && 'blockedBy' in pose) blocked.set(pose.blockedBy, [...(blocked.get(pose.blockedBy) ?? []), body]);
  }
  return { ...(note ? { pose: note.pose } : {}), ...(blocked.size ? { blocked: [...blocked].map(([joint, bodies]) => ({ joint, bodies })) } : {}) };
}

export const viewImage: HostOperation<typeof VIEW_IMAGE_ARGS> = {
  title: 'View image',
  summary:
    'A picture of the model, to check its shape by eye: a named view fitted to the bodies drawn, optionally only some bodies (leave out a housing to see inside), optionally cut by a plane; with `at` the model as it was after a feature, with `after` a state that is not written (a pose: `after: { type: "setPose", values: { … } }`). Every body has its own colour from a palette, listed with the picture, or with `colors: "model"` the colour of its body properties. It shows the model, not the screen of the user: no selection, sketches, planes or dimensions.',
  returns:
    'a PNG image, and next to it as text: `width` and `height` in pixels, `scale` in millimetres per pixel, and `bodies`: the bodies of which something is drawn, each with its colour (`color` as #rrggbb and `colorName`, the name of the nearest named colour; with `colors: "model"` also `colorFrom`: `model` for the colour of its body properties, `palette` for a body without one) and, when the section goes through it, the colour its cut is filled with (`cutColor`, a darker shade of its colour). The edges of the bodies are drawn. With a section also `section.cut`, the bodies the plane goes through, and `section.cutAway`, the bodies it removes whole: a picture with nothing in it usually has the offset or the flip the wrong way round. A body of the palette has the colour of its place among the bodies of the state drawn, so a legend belongs to its own picture. In a pose also `pose`, the joints that move the model with their values, and `blocked`: each joint without a motion with the drawn bodies beyond it, which are drawn with the joint at zero (with a section such a body is refused).',
  args: VIEW_IMAGE_ARGS,
  async run(host, args, state, path) {
    if (!host.view) return refused('notAvailable', 'the app that is connected has no view to draw a picture with. The queries section and body describe the shape in numbers without it.');
    const request = imageRequest(host, args, state, SECTION_POINTS, path.after);
    if ('ok' in request) return request;
    const image = await host.view.image(request);
    if (image.base64.length > MAX_IMAGE_BASE64) return refused('failed', `the picture is too large to send (${image.base64.length} characters of ${MAX_IMAGE_BASE64}); ask for a smaller width and height`, ['width']);
    const round = (value: number): number => Number(value.toPrecision(6));
    const about: { [key: string]: Json } = { width: image.width, height: image.height, scale: round(image.scale), bodies: image.bodies.map((entry) => ({ ...entry })) };
    // which bodies the plane goes through is in the answer of the section; which it removes whole, the view knows
    if (request.cut) about.section = { cut: [...new Set(request.cut.regions.map((region) => region.body))], cutAway: image.cutAway };
    Object.assign(about, poseAbout(state, image.bodies.map((entry) => entry.body)));
    return { ok: true, result: { kind: 'image', mediaType: 'image/png', base64: image.base64, about } };
  },
};
