// A picture of the model (D43): what a request draws (the bodies in their colours, their edges,
// the cut) and the button that saves a picture, over states written by hand. No view draws here.
import type { EngineState, Frame, MechanismResult, RigidTransform, SectionResult, Solid, Vec3 } from '@trymesh/engine';
import type { ImageRequest, RenderedImage, ViewCapability } from '@trymesh/mcp/view-image';
import { describe, expect, it } from 'vitest';
import { COLOR } from '../src/draw';
import { PALETTE, SAVED, pictureModel, savePicture } from '../src/picture';

// A state of `count` bodies named b0, b1, …: each has one edge along X at the height of its
// number, from y = −1 to y = 1, and one edge that is coplanar and is not drawn. Its box is that
// edge; `boxes` gives a body another one.
const SOLIDS: Solid[] = [];
function stateOf(count: number, boxes: { [body: string]: { min: number[]; max: number[] } } = {}): EngineState {
  const bodies = Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const solid: Solid = (SOLIDS[index] ??= { positions: new Float32Array(), triangles: new Uint32Array(), faceIds: new Uint32Array() });
      const edges = [
        { kind: 'sharp', segments: Float64Array.from([0, -1, index, 0, 1, index]) },
        { kind: 'coplanar', segments: Float64Array.from([5, 5, index, 6, 6, index]) },
      ];
      return [`b${index}`, { solid, edges, bounds: boxes[`b${index}`] ?? { min: [0, -1, index], max: [0, 1, index] } }];
    }),
  );
  return { evaluation: { bodies } } as unknown as EngineState;
}
const request = (parts: Partial<ImageRequest>): ImageRequest => ({ state: stateOf(3), camera: 'current', width: 800, height: 600, ...parts });
// the plane y = 0 seen along −Y: x of the frame is X, y of the frame is Z
const FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] };

describe('what a picture draws', () => {
  it('every body in its own colour, by its place in the state; its edges without the coplanar ones', () => {
    const { model, bodies, cutAway } = pictureModel(request({}));
    expect(cutAway).toEqual([]);
    expect(model.bodies).toEqual([{ solid: SOLIDS[0], color: PALETTE[0].color }, { solid: SOLIDS[1], color: PALETTE[1].color }, { solid: SOLIDS[2], color: PALETTE[2].color }]);
    expect(bodies).toEqual([{ body: 'b0', color: '#4e79a7', colorName: 'blue' }, { body: 'b1', color: '#f28e2b', colorName: 'orange' }, { body: 'b2', color: '#e15759', colorName: 'red' }]);
    expect(model.lines).toEqual([{ segments: [0, -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0, -1, 2, 0, 1, 2], color: COLOR.edge, width: 1.5 }]);
    expect(model.fills).toEqual([]);
    expect(model.clip).toBeUndefined();
  });

  // D73: `colors: 'model'`
  it('with the colours of the model: a body in the colour of its properties, the others in that of the palette, and the legend says which', () => {
    const state = stateOf(3);
    (state.evaluation as { bodyProperties: object }).bodyProperties = { b0: { name: 'b0', use: 'part', color: '#ff0000' }, b1: { name: 'b1', use: 'part' }, b2: { name: 'b2', use: 'part', color: '#101010' } };
    const { model, bodies } = pictureModel(request({ state, colors: 'model' }));
    expect(model.bodies.map((body) => body.color)).toEqual([0xff0000, PALETTE[1].color, 0x101010]);
    expect(bodies).toEqual([
      { body: 'b0', color: '#ff0000', colorName: 'red', colorFrom: 'model' },
      { body: 'b1', color: '#f28e2b', colorName: 'orange', colorFrom: 'palette' },
      { body: 'b2', color: '#101010', colorName: 'black', colorFrom: 'model' },
    ]);
    // the cut of a body is a darker shade of the colour it is drawn in
    const section = pictureModel(request({ state, colors: 'model', cut: { frame: FRAME, regions: [{ body: 'b0', loops: [[0, 0, 1, 0, 1, 1]] }] } }));
    expect(section.bodies[0]).toEqual({ body: 'b0', color: '#ff0000', colorName: 'red', cutColor: '#b30000', colorFrom: 'model' });
    // without it the palette, whatever the properties say
    expect(pictureModel(request({ state })).bodies.map((entry) => entry.color)).toEqual(['#4e79a7', '#f28e2b', '#e15759']);
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
    expect(pictureModel(request({ state: stateOf(0) }))).toEqual({ model: { bodies: [], lines: [{ segments: [], color: COLOR.edge, width: 1.5 }], fills: [] }, bodies: [], cutAway: [] });
  });

  it('a cut: the edges end at the plane, each region is filled in the shade of its body and outlined over the fills', () => {
    const square = [0, 0, 2, 0, 2, 2, 0, 2];
    const hole = [0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5, 1.5];
    const { model, bodies, cutAway } = pictureModel(request({ cut: { frame: FRAME, regions: [{ body: 'b1', loops: [square, hole] }, { body: 'b0', loops: [square] }] } }));
    expect(model.clip).toEqual({ origin: [0, 0, 0], normal: [0, -1, 0] });
    // a body the cut goes through says the colour of its cut; one it does not go through has none
    expect(bodies).toEqual([
      { body: 'b0', color: '#4e79a7', colorName: 'blue', cutColor: '#375575' },
      { body: 'b1', color: '#f28e2b', colorName: 'orange', cutColor: '#a9631e' },
      { body: 'b2', color: '#e15759', colorName: 'red' },
    ]);
    expect(cutAway).toEqual([]);
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

describe('a body the cut leaves nothing of', () => {
  // the cut takes away y < 0 (the normal of the frame is −Y)
  const cut = { frame: FRAME, regions: [] };
  const at = (low: number, high: number) => ({ min: [0, low, 0], max: [1, high, 1] });

  it('is not drawn and not in the legend, and is named as cut away; a body that reaches the plane stays', () => {
    const state = stateOf(4, { b0: at(-5, -1), b1: at(-5, 0), b2: at(-5, 0.001), b3: at(1, 5) });
    const { model, bodies, cutAway } = pictureModel(request({ state, cut }));
    expect(cutAway).toEqual(['b0', 'b1']); // wholly on the side that is cut away, or only touching the plane from it
    expect(bodies.map((entry) => entry.body)).toEqual(['b2', 'b3']);
    expect(bodies.map((entry) => entry.colorName)).toEqual(['red', 'teal']); // each keeps the colour of its place
    expect(model.bodies.map((body) => body.color)).toEqual([PALETTE[2].color, PALETTE[3].color]);
    // of the bodies asked for only
    expect(pictureModel(request({ state, cut, bodies: ['b0', 'b3'] })).cutAway).toEqual(['b0']);
    // without a cut nothing is cut away
    expect(pictureModel(request({ state })).cutAway).toEqual([]);
  });

  it('a plane that leans: the lowest corner of the box along its normal decides', () => {
    const lean: Frame = { origin: [0, 0, 0], x: [0, 1, 0], y: [Math.SQRT1_2, 0, -Math.SQRT1_2], normal: [Math.SQRT1_2, 0, Math.SQRT1_2] };
    const box = (min: number[], max: number[]) => ({ min, max });
    const state = stateOf(3, { b0: box([1, 0, 1], [2, 1, 2]), b1: box([-1, 0, -1], [2, 1, 2]), b2: box([-3, 0, 1], [-2, 1, 2.5]) });
    // b0 lies above the plane x + z = 0; b1 crosses it; the box of b2 reaches below it at (−3, 1)
    expect(pictureModel(request({ state, cut: { frame: lean, regions: [] } })).cutAway).toEqual(['b0']);
  });
});

describe('a picture of a model in a pose (D49)', () => {
  // a turn by a quarter about Z: x' = −y, y' = x
  const QUARTER: RigidTransform = { matrix: [[0, -1, 0], [1, 0, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3], translation: [0, 0, 0] };
  const IDENTITY: RigidTransform = { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3], translation: [0, 0, 0] };
  // b1 in a link that is turned, b0 in a root link, b2 in no link
  const posed = (link: Partial<MechanismResult['links'][string]>): EngineState => {
    const state = stateOf(3);
    const mechanism: MechanismResult = { links: { base: { bodies: ['b0'], missing: [], transform: IDENTITY }, arm: { bodies: ['b1'], missing: [], transform: QUARTER, ...link } }, joints: {}, roots: ['base'], unassigned: ['b2'] };
    return { evaluation: { ...state.evaluation, mechanism } } as unknown as EngineState;
  };

  it('a body of a moved link carries its transform, its edges and its box are moved; the others as modelled', () => {
    const { model } = pictureModel(request({ state: posed({}) }));
    expect(model.bodies).toEqual([{ solid: SOLIDS[0], color: PALETTE[0].color }, { solid: SOLIDS[1], color: PALETTE[1].color, transform: QUARTER }, { solid: SOLIDS[2], color: PALETTE[2].color }]);
    // the edge of b1 from (0, −1, 1) to (0, 1, 1) turned: from (1, 0, 1) to (−1, 0, 1)
    expect(Array.from(model.lines[0].segments).slice(6, 12)).toEqual([1, 0, 1, -1, 0, 1]);
    // its box is turned too: as modelled at −3 ≤ x ≤ −1 and y > 0, turned to y' = x < 0, which a cut
    // of y < 0 takes away whole
    const state = posed({});
    (state.evaluation.bodies as unknown as Record<string, { bounds: unknown }>).b1.bounds = { min: [-3, 1, 1], max: [-1, 2, 1] };
    expect(pictureModel(request({ state, cut: { frame: FRAME, regions: [] } })).cutAway).toEqual(['b1']);
    expect(pictureModel(request({ state, cut: { frame: FRAME, regions: [] } }), () => ({})).cutAway).toEqual([]);
  });

  it('a blocked link is drawn by its transform; another pose can be asked for, as the view of a sketch shows the model as modelled', () => {
    expect(pictureModel(request({ state: posed({ blockedBy: 'elbow' }) })).model.bodies[1]).toEqual({ solid: SOLIDS[1], color: PALETTE[1].color, transform: QUARTER });
    expect(pictureModel(request({ state: posed({}) }), () => ({})).model.bodies[1]).toEqual({ solid: SOLIDS[1], color: PALETTE[1].color });
  });
});

describe('the button that saves a picture', () => {
  const capability = (asked: ImageRequest[]): ViewCapability => ({
    async image(given): Promise<RenderedImage> {
      asked.push(given);
      return { base64: 'UE5H', width: given.width, height: given.height, scale: 1, bodies: [], cutAway: [] };
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
