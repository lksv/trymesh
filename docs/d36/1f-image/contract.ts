// Contract of package 1f of D36 (decision D43): a picture of a view for the AI. An operation of
// the app (`HostOperation` of the preparatory step), not a query: the engine has no renderer.
// A draft, only type-checked (`npx tsc -p docs/d36/tsconfig.json`). The design is design.md.
//
// Third version, after the second round of reviews (design.md, "Reviews").

import type { Frame, Id, Vec3 } from '../../../packages/engine/src/index';
import type { AppHost, ArgSpecs, EngineAfter, QueryOutcome, RunArgsOf, StateAfter, ToolAnswer } from '../00-prep/contract';
import { SECTION_ARGS } from '../1a-section/contract';

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
export type ViewName = keyof typeof VIEWS | 'current';

// ---------------------------------------------------------------- the capability of the host

// What the viewport of a running app gives to the host: a picture of a model from a camera,
// without touching what the user sees (it is drawn off the screen, at the size asked for,
// whatever the size of the window). The picture depends only on the request: the camera of the
// picture carries its own light, set as the light of the user's camera is, so the same request
// gives the same picture wherever the user happens to look.
// - `state`: the model to draw: its bodies with their edges, as the app draws a model, without
//   the selection, the sketches, the planes and the labels of the user's view.
// - `bodies`: only these are drawn, and the picture is fitted to them.
// - `camera`: a camera fitted to what is drawn, or `current`: the user's camera as it stands
//   (direction, target and scale).
// - `cut`: the half-space that is cut away and what fills the cut, as the section view of 1a
//   draws them: the frame of the cutting plane and, per region of the section, its loops in the
//   x and y of that frame, the outer one first. The regions are all of them: a caller that has
//   only a part of a section does not ask for a cut.
// The answer says what it drew, so that a caller can relate pixels to millimetres and colours to
// bodies: `scale` is millimetres per pixel; every body has its own colour, from a fixed palette
// in the order of the bodies of the state.
export interface ImageRequest {
  state: StateAfter;
  bodies?: Id[];
  camera: ViewCamera | 'current';
  cut?: { frame: Frame; regions: { loops: ArrayLike<number>[] }[] };
  width: number; // pixels
  height: number;
}
export interface RenderedImage {
  base64: string; // PNG
  width: number;
  height: number;
  scale: number; // mm per pixel
  bodies: { body: Id; color: string }[]; // `#rrggbb`
}
export interface ViewCapability {
  image(request: ImageRequest): Promise<RenderedImage>;
}

declare module '../00-prep/contract' {
  interface AppHost {
    view?: ViewCapability; // absent over a document from a file: the server has no renderer
  }
  interface HostOperations {
    view_image: typeof VIEW_IMAGE_ARGS;
  }
}

// ---------------------------------------------------------------- the operation

// - `view`: a named view, `iso` without the argument; `current` is the camera of the user.
// - `bodies`: only these; the picture is fitted to them. Hiding the housing shows the gears.
// - `section`: the model cut by a plane, as the query `section` of 1a takes it (a plane, an
//   offset along its normal, a flip). What lies on the side the normal points to is cut away and
//   the cut is filled. The three arguments are the descriptions of `SECTION_ARGS` themselves,
//   with their titles and defaults. (A title written here as a literal would not compile: the
//   type of an entry of `fields` has none. See design.md of 1b, "Needs".)
// - `at`: the model as it was after this feature. An argument here because the path of an
//   operation has no `at` and no `after` (design.md, "Needs").
// - `width`, `height`: the size of the picture in pixels.
export const VIEW_IMAGE_ARGS = {
  view: { kind: 'choice', options: ['iso', 'front', 'back', 'left', 'right', 'top', 'bottom', 'current'], title: 'View', summary: 'iso without it. front is seen from −Y, left from −X, top from above; current is the camera of the app as the user left it.', optional: true },
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'Only these are drawn; without it all bodies.', optional: true },
  section: {
    kind: 'fields',
    title: 'Section',
    summary: 'Cuts the model by a plane; what lies on the side its normal points to is not drawn.',
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

// ---------------------------------------------------------------- the path of an operation (a stand-in)

// Needs from the preparatory step (design.md): the contract there has the registry
// `HOST_OPERATIONS` and says that an operation "goes through an entry of its own next to"
// `callTool`, "which takes the host and is awaited", without a signature. Until it has one, this
// is what the calls of this package are written against: the server calls it with its own host
// (no `view`), the bridge client of the app with the host the app handed to it.
export type OperationHost = AppHost & { engine: EngineAfter };
export declare function callOperation(host: OperationHost, name: 'view_image', args: Record<string, unknown>): Promise<QueryOutcome<ToolAnswer>>;
