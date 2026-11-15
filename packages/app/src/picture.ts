// A picture of the model (D43): the capability the view of the app gives to its operations
// (`AppHost.view`, behind the tool `view_image` of the AI), and the same capability behind the
// button that saves a picture. A picture is of a model, not of the screen: the bodies with their
// edges, each body in its own colour, optionally cut; no selection, sketches, planes or labels.
import type { EngineState, Id, SectionResult } from '@trymesh/engine';
import { type ImageRequest, type RenderedImage, type ViewCapability, cutOf } from '@trymesh/mcp/view-image';
import { COLOR, keptSegments, loopSegments } from './draw';
import type { PictureModel, View } from './viewport';

// The colours of bodies, in the order of the bodies of the state; after the last the first
// again. Of one lightness, so that the dark edges show on all of them, and named, so that an
// answer can say which body is which to a reader who sees "the orange part".
export const PALETTE: readonly { color: number; name: string }[] = [
  { color: 0x4e79a7, name: 'blue' },
  { color: 0xf28e2b, name: 'orange' },
  { color: 0xe15759, name: 'red' },
  { color: 0x76b7b2, name: 'teal' },
  { color: 0x59a14f, name: 'green' },
  { color: 0xedc948, name: 'yellow' },
  { color: 0xb07aa1, name: 'purple' },
  { color: 0xff9da7, name: 'pink' },
  { color: 0x9c755f, name: 'brown' },
  { color: 0xbab0ac, name: 'grey' },
];
const SHADE = 0.7; // the cut of a body is its colour this much darker
const shaded = (color: number): number => (Math.round(((color >> 16) & 255) * SHADE) << 16) | (Math.round(((color >> 8) & 255) * SHADE) << 8) | Math.round((color & 255) * SHADE);
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

// What a request draws: the bodies asked for (all without `bodies`) in the order of the state,
// their edges, and the cut: the bodies and their edges clipped, the regions filled and outlined.
// A body keeps its colour whatever else is drawn: the colour goes by its place in the state.
export function pictureModel(request: ImageRequest): { model: PictureModel; bodies: RenderedImage['bodies'] } {
  const all = Object.keys(request.state.evaluation.bodies);
  const drawn = request.bodies ? all.filter((id) => request.bodies?.includes(id)) : all;
  const colorOf = (id: Id): { color: number; name: string } => PALETTE[Math.max(0, all.indexOf(id)) % PALETTE.length];
  const clip = request.cut ? { origin: request.cut.frame.origin, normal: request.cut.frame.normal } : undefined;
  const edges: number[] = [];
  for (const id of drawn) for (const edge of request.state.evaluation.bodies[id].edges) if (edge.kind !== 'coplanar') for (let i = 0; i < edge.segments.length; i++) edges.push(edge.segments[i]);
  const regions = request.cut?.regions ?? [];
  const frame = request.cut?.frame;
  const model: PictureModel = {
    bodies: drawn.map((id) => ({ solid: request.state.evaluation.bodies[id].solid, color: colorOf(id).color })),
    lines: [
      { segments: keptSegments(edges, clip), color: COLOR.edge, width: 1.5 },
      ...(frame ? [{ segments: regions.flatMap((region) => region.loops.flatMap((loop) => loopSegments(frame, loop))), color: COLOR.edge, width: 1.5, overFills: true }] : []),
    ],
    fills: frame ? regions.map((region) => ({ frame, loops: region.loops, color: shaded(colorOf(region.body).color), opacity: 1 })) : [],
    ...(clip ? { clip } : {}),
  };
  return { model, bodies: drawn.map((id) => ({ body: id, color: hex(colorOf(id).color), colorName: colorOf(id).name })) };
}

export const viewCapability = (view: View): ViewCapability => ({
  async image(request) {
    const { model, bodies } = pictureModel(request);
    const { base64, scale } = await view.image(model, request.camera, request.width, request.height);
    return { base64, width: request.width, height: request.height, scale, bodies };
  },
});

// The size of a picture saved by the button of the app.
export const SAVED = { width: 1600, height: 1200 };

// The picture behind the button of the app: the model as the user has it, from the camera of
// the view, at a fixed size.
// - `visible`: the bodies the user has not hidden; the others are not in the picture, and neither
//   are the fills of their cuts.
// - `shown`: the answer of the query `section` the query panel shows at the moment, if it shows
//   one (asked with polylines, as the section view asks). The picture is then cut as the view
//   is. An answer that is not complete cannot be drawn as a cut (the view clips it without
//   a fill and says so): nothing is saved then, because an uncut picture of a view that shows
//   a cut would be the wrong picture.
// The answer is what the status bar says.
export async function savePicture(capability: ViewCapability, state: EngineState, visible: Id[], shown: SectionResult | undefined, save: (name: string, base64: string) => void): Promise<{ text: string; error: boolean }> {
  const cut = shown && cutOf(shown, visible);
  if (shown && !cut) return { text: 'The section is too large to draw, so no picture was saved. Close the section or cut fewer bodies.', error: true };
  const image = await capability.image({ state, bodies: visible, camera: 'current', ...SAVED, ...(cut ? { cut } : {}) });
  save('model.png', image.base64);
  return { text: `Picture of the model saved (${image.width} × ${image.height}): the bodies shown, without the selection, sketches, planes and dimensions.`, error: false };
}
