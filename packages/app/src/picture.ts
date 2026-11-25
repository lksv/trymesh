// A picture of the model (D43): the capability the view of the app gives to its operations
// (`AppHost.view`, behind the tool `view_image` of the AI), and the same capability behind the
// button that saves a picture. A picture is of a model, not of the screen: the bodies with their
// edges, each body in its own colour, optionally cut; no selection, sketches, planes or labels.
import type { EngineState, Id, SectionResult } from '@trymesh/engine';
import { type ImageRequest, type RenderedImage, type ViewCapability, cutOf } from '@trymesh/mcp/view-image';
import { COLOR, keptSegments, loopSegments } from './draw';
import { type Pose, placedCorners, placedSegments, poseOf } from './pose';
import type { PictureModel, View } from './viewport';

// The colours of bodies, in the order of the bodies of the state; after the last the first
// again. None is dark, so that the dark edges show on all of them, and each has a name, so that
// an answer can say which body is which to a reader who sees "the orange part".
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
// The name of a colour of the model (D73): the nearest of the palette, black, white and grey.
const NAMED: readonly { color: number; name: string }[] = [...PALETTE, { color: 0x000000, name: 'black' }, { color: 0xffffff, name: 'white' }, { color: 0x808080, name: 'grey' }];
const channels = (color: number): number[] => [(color >> 16) & 255, (color >> 8) & 255, color & 255];
export function colorName(color: number): string {
  const distance = (other: number): number => channels(other).reduce((sum, value, i) => sum + (value - channels(color)[i]) ** 2, 0);
  return NAMED.reduce((best, entry) => (distance(entry.color) < distance(best.color) ? entry : best)).name;
}

// What a request draws: the bodies asked for (all without `bodies`) in the order of the state,
// their edges, and the cut: the bodies and their edges clipped, the regions filled and outlined.
// - A body keeps its colour whatever else is drawn: the colour goes by its place in the state.
// - A body the cut leaves nothing of (its box lies in the half-space that is cut away) is not
//   drawn and is listed in `cutAway`, so that an answer does not name a colour nobody can see.
// - A body is drawn where `pose` puts it (D49), with its edges and its box: by default the pose of
//   the mechanism of the state, as the view draws it in the model mode. The cut of a section is in
//   the pose already (the query answers there).
export function pictureModel(request: ImageRequest, pose: Pose = poseOf(request.state.evaluation.mechanism)): { model: PictureModel; bodies: RenderedImage['bodies']; cutAway: Id[] } {
  const all = Object.keys(request.state.evaluation.bodies);
  const asked = request.bodies ? all.filter((id) => request.bodies?.includes(id)) : all;
  // the palette by the place in the state; with the colours of the model the colour of the body
  // properties first (D73)
  const own = (id: Id): string | undefined => (request.colors === 'model' ? request.state.evaluation.bodyProperties?.[id]?.color : undefined);
  const colorOf = (id: Id): { color: number; name: string } => {
    const stated = own(id);
    if (stated === undefined) return PALETTE[Math.max(0, all.indexOf(id)) % PALETTE.length];
    const color = Number.parseInt(stated.slice(1), 16);
    return { color, name: colorName(color) };
  };
  const clip = request.cut ? { origin: request.cut.frame.origin, normal: request.cut.frame.normal } : undefined;
  // the lowest corner of the box of a body above the plane of the cut, along its normal (the
  // corners of the box as modelled, moved to the pose)
  const gone = (id: Id): boolean => {
    if (!clip) return false;
    const corners = placedCorners(request.state.evaluation.bodies[id].bounds, pose(id).transform);
    const lowest = Math.min(...corners.map((corner) => [0, 1, 2].reduce((sum, axis) => sum + clip.normal[axis] * (corner[axis] - clip.origin[axis]), 0)));
    return lowest >= 0;
  };
  const cutAway = asked.filter(gone);
  const drawn = asked.filter((id) => !cutAway.includes(id));
  const edges: number[] = [];
  for (const id of drawn) {
    for (const edge of request.state.evaluation.bodies[id].edges) {
      if (edge.kind === 'coplanar') continue;
      const segments = placedSegments(edge.segments, pose(id).transform);
      for (let i = 0; i < segments.length; i++) edges.push(segments[i]);
    }
  }
  const regions = request.cut?.regions ?? [];
  const frame = request.cut?.frame;
  const model: PictureModel = {
    bodies: drawn.map((id) => {
      const { transform } = pose(id);
      return { solid: request.state.evaluation.bodies[id].solid, color: colorOf(id).color, ...(transform ? { transform } : {}) };
    }),
    lines: [
      { segments: keptSegments(edges, clip), color: COLOR.edge, width: 1.5 },
      ...(frame ? [{ segments: regions.flatMap((region) => region.loops.flatMap((loop) => loopSegments(frame, loop))), color: COLOR.edge, width: 1.5, overFills: true }] : []),
    ],
    fills: frame ? regions.map((region) => ({ frame, loops: region.loops, color: shaded(colorOf(region.body).color), opacity: 1 })) : [],
    ...(clip ? { clip } : {}),
  };
  const cut = new Set(regions.map((region) => region.body));
  return {
    model,
    bodies: drawn.map((id) => ({ body: id, color: hex(colorOf(id).color), colorName: colorOf(id).name, ...(cut.has(id) ? { cutColor: hex(shaded(colorOf(id).color)) } : {}), ...(request.colors === 'model' ? { colorFrom: own(id) === undefined ? ('palette' as const) : ('model' as const) } : {}) })),
    cutAway,
  };
}

// A picture drawn by a view. `pose`: where the bodies go, by default the pose of the mechanism of
// the state (the operation `view_image` draws the pose the document holds); the button of the app
// draws them where its view does.
export async function drawPicture(view: View, request: ImageRequest, pose?: Pose): Promise<RenderedImage> {
  const { model, bodies, cutAway } = pictureModel(request, pose);
  const { base64, scale } = await view.image(model, request.camera, request.width, request.height);
  return { base64, width: request.width, height: request.height, scale, bodies, cutAway };
}

export const viewCapability = (view: View): ViewCapability => ({ image: (request) => drawPicture(view, request) });

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
