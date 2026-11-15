// A picture of the model (D43): what a request draws (the bodies in their colours, their edges,
// the cut) and the button that saves a picture, over states written by hand. No view draws here.
import type { EngineState, Frame, SectionResult, Solid } from '@trymesh/engine';
import type { ImageRequest, RenderedImage, ViewCapability } from '@trymesh/mcp/view-image';
import { describe, expect, it } from 'vitest';
import { COLOR } from '../src/draw';
import { PALETTE, SAVED, pictureModel, savePicture } from '../src/picture';

// A state of `count` bodies named b0, b1, …: each has one edge along X at the height of its
// number, from y = −1 to y = 1, and one edge that is coplanar and is not drawn.
const SOLIDS: Solid[] = [];
function stateOf(count: number): EngineState {
  const bodies = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const solid: Solid = (SOLIDS[index] ??= { positions: new Float32Array(), triangles: new Uint32Array(), faceIds: new Uint32Array() });
      const edges = [
        { kind: 'sharp', segments: Float64Array.from([0, -1, index, 0, 1, index]) },
        { kind: 'coplanar', segments: Float64Array.from([5, 5, index, 6, 6, index]) },
      ];
      return [`b${index}`, { solid, edges }];
    }),
  );
  return { evaluation: { bodies } } as unknown as EngineState;
}
const request = (parts: Partial<ImageRequest>): ImageRequest => ({ state: stateOf(3), camera: 'current', width: 800, height: 600, ...parts });
// the plane y = 0 seen along −Y: x of the frame is X, y of the frame is Z
const FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] };

describe('what a picture draws', () => {
  it('every body in its own colour, by its place in the state; its edges without the coplanar ones', () => {
    const { model, bodies } = pictureModel(request({}));
    expect(model.bodies).toEqual([{ solid: SOLIDS[0], color: PALETTE[0].color }, { solid: SOLIDS[1], color: PALETTE[1].color }, { solid: SOLIDS[2], color: PALETTE[2].color }]);
    expect(bodies).toEqual([{ body: 'b0', color: '#4e79a7', colorName: 'blue' }, { body: 'b1', color: '#f28e2b', colorName: 'orange' }, { body: 'b2', color: '#e15759', colorName: 'red' }]);
    expect(model.lines).toEqual([{ segments: [0, -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, 2, 0, 1, 2], color: COLOR.edge, width: 1.5 }]);
    expect(model.fills).toEqual([]);
    expect(model.clip).toBeUndefined();
  });

  it('only the bodies asked for, in the order of the state, each with the colour it has among all', () => {
    const { model, bodies } = pictureModel(request({ bodies: ['b2', 'b0', 'nope'] }));
    expect(bodies.map((entry) => [entry.body, entry.colorName])).toEqual([['b0', 'blue'], ['b2', 'red']]);
    expect(model.bodies.map((body) => body.color)).toEqual([PALETTE[0].color, PALETTE[2].color]);
    expect(Array.from(model.lines[0].segments)).toEqual([0, -1, 0, 0, 1, 0, 0, -1, 2, 0, 1, 2]);
    // after the last colour of the palette the first again
    const many = pictureModel(request({ state: stateOf(12) }));
    expect(many.bodies.map((entry) => entry.colorName)).toEqual([...PALETTE.map((entry) => entry.name), 'blue', 'orange']);
    expect(new Set(PALETTE.map((entry) => entry.color)).size).toBe(PALETTE.length);
    expect(pictureModel(request({ state: stateOf(0) }))).toEqual({ model: { bodies: [], lines: [{ segments: [], color: COLOR.edge, width: 1.5 }], fills: [] }, bodies: [] });
  });

  it('a cut: the edges end at the plane, each region is filled in the shade of its body and outlined over the fills', () => {
    const square = [0, 0, 2, 0, 2, 2, 0, 2];
    const hole = [0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5, 1.5];
    const { model } = pictureModel(request({ cut: { frame: FRAME, regions: [{ body: 'b1', loops: [square, hole] }, { body: 'b0', loops: [square] }] } }));
    expect(model.clip).toEqual({ origin: [0, 0, 0], normal: [0, -1, 0] });
    // what lies on the side the normal points to (y < 0) is cut away: every edge keeps its half
    expect(Array.from(model.lines[0].segments)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0, 1, 2]);
    // blue 4e79a7 and orange f28e2b, seven tenths as light
    expect(model.fills).toEqual([{ frame: FRAME, loops: [square, hole], color: 0xa9631e, opacity: 1 }, { frame: FRAME, loops: [square], color: 0x375575, opacity: 1 }]);
    // three loops of four sides, in the model: the first side of the square runs along X at y = 0
    expect(model.lines[1]).toMatchObject({ color: COLOR.edge, width: 1.5, overFills: true });
    expect(model.lines[1].segments).toHaveLength(3 * 4 * 6);
    expect(Array.from(model.lines[1].segments).slice(0, 6)).toEqual([0, 0, 0, 2, 0, 0]);
    expect(Array.from(model.lines[1].segments).slice(6, 12)).toEqual([2, 0, 0, 2, 0, 2]);
  });
});

describe('the button that saves a picture', () => {
  const capability = (asked: ImageRequest[]): ViewCapability => ({
    async image(given): Promise<RenderedImage> {
      asked.push(given);
      return { base64: 'UE5H', width: given.width, height: given.height, scale: 1, bodies: [] };
    },
  });
  const section = (parts: Partial<SectionResult>): SectionResult => ({ frame: FRAME, below: 0.001, bodies: [], inPlane: [], ...parts });
  const region = { outer: { area: 4, points: [[0, 0], [2, 0], [2, 2], [0, 2]] }, holes: [], area: 4 };

  it('the bodies that are shown, from the camera of the view, at a fixed size', async () => {
    const [asked, saved]: [ImageRequest[], string[]] = [[], []];
    const state = stateOf(3);
    const said = await savePicture(capability(asked), state, ['b0', 'b2'], undefined, (name, base64) => saved.push(`${name} ${base64}`));
    expect(asked).toEqual([{ state, bodies: ['b0', 'b2'], camera: 'current', width: 1600, height: 1200 }]);
    expect(SAVED).toEqual({ width: 1600, height: 1200 });
    expect(saved).toEqual(['model.png UE5H']);
    expect(said).toEqual({ text: 'Picture of the model saved (1600 × 1200): the bodies shown, without the selection, sketches, planes and dimensions.', error: false });
  });

  it('with a section shown the picture is cut as the view is, without the cuts of hidden bodies', async () => {
    const [asked, saved]: [ImageRequest[], string[]] = [[], []];
    const shown = section({ bodies: [{ body: 'b0', area: 4, regions: [region] }, { body: 'b1', area: 4, regions: [region] }] } as unknown as Partial<SectionResult>);
    await savePicture(capability(asked), stateOf(3), ['b0', 'b2'], shown, (name) => saved.push(name));
    // clipped where the section was taken: `below` under the plane asked for, against its normal
    expect(asked[0].cut?.frame.origin).toEqual([0, 0.001, 0]);
    expect(asked[0].cut?.regions).toEqual([{ body: 'b0', loops: [[0, 0, 2, 0, 2, 2, 0, 2]] }]);
    expect(saved).toEqual(['model.png']);
  });

  it('a section that is not complete is not drawn half filled: nothing is saved, and the app says why', async () => {
    const [asked, saved]: [ImageRequest[], string[]] = [[], []];
    const said = await savePicture(capability(asked), stateOf(3), ['b0'], section({ truncated: { shown: 4, total: 9 } }), (name) => saved.push(name));
    expect(said).toEqual({ text: 'The section is too large to draw, so no picture was saved. Close the section or cut fewer bodies.', error: true });
    expect(asked).toEqual([]);
    expect(saved).toEqual([]);
  });
});
