// The view of the query `section` (D38): the model cut at the plane, the cut filled per region
// and outlined, the bodies with their areas, and two buttons that step the plane along its normal.
import { type Frame, type SectionLoop, type SectionRegion, type SectionResult, type Vec2, completeRegions, takenAt } from '@trymesh/engine';
import { h } from '../dom';
import { COLOR, toWorld } from '../draw';
import type { QueryView, SceneAdditions } from './index';

const STEP = 1; // mm, a step of the plane along its normal
const coarse = (value: number): number => Math.round(value * 1000) / 1000 + 0; // an area measured on the mesh
const loopsOf = (region: SectionRegion): SectionLoop[] => [region.outer, ...region.holes];
const flat = (points: Vec2[]): number[] => points.flatMap((point) => [point[0], point[1]]);
// The loops of a region as segments in the model.
function outline(frame: Frame, region: SectionRegion): number[] {
  const out: number[] = [];
  for (const loop of loopsOf(region)) {
    const points = loop.points ?? [];
    points.forEach((point, i) => {
      const next = points[(i + 1) % points.length];
      out.push(...toWorld(frame, point[0], point[1]), ...toWorld(frame, next[0], next[1]));
    });
  }
  return out;
}

// What an answer adds to the scene follows from the answer alone, and the app asks for it on
// every move of the pointer (what is cut away is not picked), so it is built once per answer.
const SCENES = new WeakMap<SectionResult, Partial<SceneAdditions>>();
function sceneOf(result: SectionResult): Partial<SceneAdditions> {
  // The model is clipped at the plane the section was taken at, and the fills and the outline
  // are laid into that plane, so the edge of the clipped mesh and the loops belong to one plane.
  const frame = takenAt(result);
  const clip = { origin: frame.origin, normal: frame.normal };
  // A cut is filled only from a complete answer: a region filled without one of its holes would
  // show material across a cavity.
  const regions = completeRegions(result);
  if (!regions) return { clip };
  return {
    clip,
    fills: regions.map(({ body, region }) => ({ frame, loops: loopsOf(region).map((loop) => flat(loop.points ?? [])), color: COLOR.cut, opacity: 1, body })),
    lines: regions.map(({ body, region }) => ({ segments: outline(frame, region), color: COLOR.edge, width: 1.5, overFills: true, body })),
  };
}

export const sectionView: QueryView<'section'> = {
  // The view draws, so it asks for every loop as its polygon, with a budget far above any model
  // the app can show. The form never shows either: the other members get the arguments of the form.
  prepare: (args) => ({ ...args, outline: 'polylines', maxPoints: 1_000_000 }),
  answer(result, args, panel) {
    const pieces = (count: number, what: string): string => `${count} ${what}${count === 1 ? '' : 's'}`;
    // stepping the plane along its normal asks again with the arguments of the form
    const step = (by: number): HTMLElement =>
      h('button', { textContent: `${by > 0 ? '+' : '−'}${Math.abs(by)} mm`, title: 'Move the plane along its normal and ask again', onclick: () => panel.ask({ ...args, offset: (args.offset ?? 0) + by }) });
    return [
      ...(result.bodies.length === 0 ? [h('p', { className: 'hint' }, 'The plane cuts no body.')] : []),
      ...result.bodies.map((body) => h('p', { className: 'answer' }, `${panel.bodyName(body.body)}: ${panel.number(coarse(body.area), 'mm2')} in ${body.regions ? pieces(body.regions.length, 'piece') : pieces(body.loops, 'loop')}`)),
      ...result.inPlane.map((entry) => h('p', { className: 'hint' }, `${panel.bodyName(entry.body)} has a face in the cutting plane (${panel.faceLabel(entry.face)}): it shows that face from one side and nothing from the other. Move the offset a little to cut through it.`)),
      ...(result.truncated ? [h('p', { className: 'issue warning' }, 'The section is too large to draw: the model is cut, but the cut is not filled.')] : []),
      h('div', { className: 'buttons' }, step(-STEP), step(STEP)),
    ];
  },
  scene(result) {
    let scene = SCENES.get(result);
    if (!scene) SCENES.set(result, (scene = sceneOf(result)));
    return scene;
  },
};
