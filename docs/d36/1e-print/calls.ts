// Package 1e written out as calls: its part of validation scenario 11 (the printability of the
// housing of the robot joint of scenario 9 in two orientations), the entry of the query over the
// context, and the view of the app. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract. Lines marked `@ts-expect-error`
// are calls that must not compile.
//
// The numbers in the comments were measured by a prototype of the pass over the model of
// scenario 9 (chord tolerance 0.01 mm); they become the expectations of the test in
// packages/scenarios.

import type { Frame, Vec3 } from '../../../packages/engine/src/index';
import type { EngineAfter, FaceNameAfter, QueryArgs, QueryContext, QueryOutcome, QueryToolInput, RunArgsOf } from '../00-prep/contract';
import { QUERIES, QueryFailure } from '../00-prep/contract';
import type { QueryView, SceneAdditions } from '../1b-measure/contract';
import { QUERY_VIEWS } from '../1b-measure/contract';
import type { PrintFrame, PrintOrientation, PrintReport } from './contract';
import { PRINT_ARGS, printPass } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const cap = (feature: string, role: 'startCap' | 'endCap'): FaceNameAfter => ({ feature, role });
const BED: Vec3 = [220, 220, 250];

// ---------------------------------------------------------------- a. scenario 11: the housing in two orientations

// The housing on its seating face and on its front face, in one call, each by the face that
// lies on the bed.
// - On the seating face (`housing/startCap`, up +Z): size 109.99 by 109.995 by 46, it fits;
//   contact 2801.28 mm2 (the ring around the motor recess less six bolt holes); overhang
//   3330.69 mm2, all of it `motorBore/endCap`, the ceiling of the motor recess, 28 mm up.
// - On the front face (`housing/endCap`, up −Z): contact 6028.84 mm2; overhang 103.13 mm2 on six
//   faces, the floors of the nut pockets (`nutPocket/startCap` and its five copies, 17.19 each),
//   3 mm up.
// So the front face goes on the bed, and the face to change if even that is too much is named.
export function housingTwoWays(): { better: 'seating' | 'front'; worst: FaceNameAfter | undefined } {
  const report: PrintReport = unwrap(
    engine.query('print', {
      bodies: ['housing'],
      orientations: [{ by: { onBed: { kind: 'face', body: 'housing', face: cap('housing', 'startCap') } } }, { by: { onBed: { kind: 'face', body: 'housing', face: cap('housing', 'endCap') } } }],
      bed: BED,
    }),
  );
  const [seating, front]: PrintOrientation[] = report.bodies[0].orientations;
  if (seating.fits !== true || front.fits !== true) return fail('110 by 110 by 46 fits a bed of 220');
  // the face named really is the contact: nothing of the housing reaches below it
  if (seating.contact.faces[0]?.face.role !== 'startCap') return fail('the seating face lies on the bed');
  return { better: front.overhang.area < seating.overhang.area ? 'front' : 'seating', worst: seating.overhang.faces[0]?.face };
}

// By a direction: on its side. A cylinder touches the bed in a line: contact 0. Overhang
// 8612.84 mm2 on 21 faces, the largest the outer wall itself (3949.79, from the bed up).
export function housingOnItsSide(): { contact: number; faces: number } {
  const side = unwrap(engine.query('print', { bodies: ['housing'], orientations: [{ by: { up: [1, 0, 0] } }] })).bodies[0].orientations[0];
  return { contact: side.contact.area, faces: side.overhang.count }; // `fits` is absent: no bed was given
}

// All printed parts, both ways along the axis, in one call: an AI picks per part.
// carrier: pins up, contact 2826.18 and no overhang; pins down, the disc overhangs (2767.58,
// from 12.5). sun: flange down, no overhang; teeth down, the flange overhangs (1021.44, from 15.5).
export function everyPart(): Record<string, number[]> {
  const report = unwrap(engine.query('print', { bodies: ['sun', 'planet', 'housing', 'plate', 'carrier'], orientations: [{ by: { up: [0, 0, 1] } }, { by: { up: [0, 0, -1] } }], bed: BED }));
  return Object.fromEntries(report.bodies.map((body) => [body.body, body.orientations.map((orientation) => orientation.overhang.area)]));
}

// A stricter printer (overhangs from 30°), a turn about the vertical, and through MCP.
export const stricter = (): PrintReport => unwrap(engine.query('print', { bodies: ['housing'], orientations: [{ by: { up: [0, 0, -1] }, turn: Math.PI / 4 }], overhang: Math.PI / 6, minArea: 5 }));
export const overMcp: QueryToolInput = { query: 'print', args: { bodies: ['housing'], orientations: [{ by: { up: [0, 0, -1] } }], bed: BED } };

// A face that is not planar cannot lie on the bed; the path names the orientation.
export function onARoundFace(): string {
  const outcome = engine.query('print', { bodies: ['housing'], orientations: [{ by: { up: [0, 0, 1] } }, { by: { onBed: { kind: 'face', body: 'housing', face: { feature: 'housing', role: 'side', curve: 'ho' } } } }] });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // failed in orientations,1,by,onBed
}

engine.query('print', {
  // @ts-expect-error an orientation is a direction or a face, not both
  orientations: [{ by: { up: [0, 0, 1], onBed: { kind: 'face', body: 'housing', face: cap('housing', 'startCap') } } }],
});
// @ts-expect-error at least the orientations are required
engine.query('print', { bodies: ['housing'] });
// @ts-expect-error a body is not a face that can lie on the bed
engine.query('print', { orientations: [{ by: { onBed: { kind: 'body', body: 'housing' } } }] });

// ---------------------------------------------------------------- b. the entry, over the context

type Orientation = RunArgsOf<typeof PRINT_ARGS>['orientations'][number];
// The frame of a direction, and a frame turned about its vertical (contract.ts, `PrintFrame`).
declare function frameOfDirection(up: Vec3): PrintFrame;
declare function turned(frame: PrintFrame, turn: number): PrintFrame;

// What is up in an orientation. A face is resolved through the context, so its frame is in the
// pose the query is asked about and its normal points out of the body.
function frameOf(context: QueryContext, orientation: Orientation, index: number): PrintFrame {
  const { by } = orientation;
  if (by.up) {
    if (!(Math.hypot(...by.up) > 0)) throw new QueryFailure('failed', 'a direction needs a length', ['orientations', index, 'by', 'up']);
    return turned(frameOfDirection(by.up), orientation.turn);
  }
  const face: Frame | { problem: string } = context.frame({ kind: 'face', body: by.onBed.body, face: by.onBed.face });
  if ('problem' in face) throw new QueryFailure(face.problem === 'nonPlanarFace' ? 'failed' : 'notAvailable', face.problem === 'nonPlanarFace' ? 'only a planar face can lie on the bed' : 'the face is not in this state', ['orientations', index, 'by', 'onBed']);
  const up: Vec3 = [-face.normal[0], -face.normal[1], -face.normal[2]];
  const y: Vec3 = [up[1] * face.x[2] - up[2] * face.x[1], up[2] * face.x[0] - up[0] * face.x[2], up[0] * face.x[1] - up[1] * face.x[0]];
  return turned({ x: face.x, y, up }, orientation.turn);
}

export const print: (typeof QUERIES)['print'] = {
  title: 'Print check',
  summary: 'How a body prints in given orientations: its size against the bed, the area that lies on the bed and the area that overhangs, per named face. Several orientations in one call can be compared. It does not know bridges, wall thickness or supports.',
  returns:
    'angle: the overhang angle used (rad). bodies: for every body its orientations in the order asked, each with up (unit vector), size (mm: x, y, height in the print frame), fits (with a bed; the footprint either way round), contact (area in mm2 and the planar faces on the bed with their areas) and overhang (area in mm2 and count of all overhanging faces; faces: those of at least minArea, the largest first, each with area and from, the height in mm above the bed where it starts). truncated when maxFaces cut a list.',
  args: PRINT_ARGS,
  run(context, args) {
    if (args.bed && args.bed.some((length) => !(length > 0))) throw new QueryFailure('failed', 'the bed has three lengths above zero', ['bed']);
    const frames = args.orientations.map((orientation, index) => frameOf(context, orientation, index));
    const names = context.state.evaluation.faceNames;
    let [shown, total] = [0, 0];
    const bodies = (args.bodies ?? Object.keys(context.bodies)).map((id) => {
      const body = context.bodies[id]; // from the context: the same code answers for a pose
      const planar = (face: number): boolean => context.surface(id, names[face])?.kind === 'plane';
      const orientations = frames.map((frame): PrintOrientation => {
        const pass = printPass(body.solid, frame, args.overhang, planar);
        const [width, depth, height] = pass.size;
        const fits = args.bed && height <= args.bed[2] && ((width <= args.bed[0] && depth <= args.bed[1]) || (width <= args.bed[1] && depth <= args.bed[0]));
        const contact = [...pass.contact].map(([face, area]) => ({ face: names[face], area })).sort((a, b) => b.area - a.area);
        const over = [...pass.overhang].map(([face, value]) => ({ face: names[face], ...value })).sort((a, b) => b.area - a.area);
        const large = over.filter((entry) => entry.area >= args.minArea);
        shown += Math.min(large.length, args.maxFaces);
        total += large.length;
        return {
          up: frame.up,
          size: pass.size,
          ...(fits === undefined ? {} : { fits }),
          contact: { area: contact.reduce((sum, entry) => sum + entry.area, 0), faces: contact.slice(0, args.maxFaces) },
          overhang: { area: over.reduce((sum, entry) => sum + entry.area, 0), count: over.length, faces: large.slice(0, args.maxFaces) },
        };
      });
      return { body: id, orientations };
    });
    return { angle: args.overhang, bodies, ...(shown < total ? { truncated: { shown, total } } : {}) };
  },
};
export const registered: Pick<typeof QUERIES, 'print'> = { print };
export const FIXTURE: { args: QueryArgs<'print'> } = { args: { orientations: [{ by: { up: [0, 0, 1] } }] } };

// ---------------------------------------------------------------- c. the view of the app

// A row per body and orientation with what decides: fits, the height, the contact and the
// overhang. A picked row paints the overhanging faces of that orientation and its contact faces.
// Rows are counted through all bodies, in the order of the answer.
export const printView: QueryView<'print'> = {
  answer(result, _args, panel) {
    const rows = result.bodies.flatMap((body) => body.orientations.map((orientation) => ({ body: body.body, orientation })));
    return rows.map(({ body, orientation }, index) => {
      const text = `${panel.bodyName(body)}, up ${orientation.up.map((value) => Math.round(value * 100) / 100).join(' ')}: ${orientation.fits === false ? 'does not fit, ' : ''}height ${panel.number(orientation.size[2], 'mm')}, on the bed ${panel.number(orientation.contact.area, 'mm2')}, overhang ${panel.number(orientation.overhang.area, 'mm2')} on ${orientation.overhang.count} face(s)`;
      const row = Object.assign(document.createElement('div'), { className: `row ${panel.picked === index ? 'selected' : ''}`, textContent: text });
      row.onclick = () => panel.pick(panel.picked === index ? undefined : index);
      return row;
    });
  },
  scene(result, _args, panel): Partial<SceneAdditions> {
    const rows = result.bodies.flatMap((body) => body.orientations.map((orientation) => ({ body: body.body, orientation })));
    const picked = panel.picked === undefined ? undefined : rows[panel.picked];
    if (!picked) return {};
    const paint = (faces: { face: FaceNameAfter }[], color: number) => faces.map(({ face }) => ({ body: picked.body, face, color, opacity: 0.6 }));
    return { faces: [...paint(picked.orientation.overhang.faces, 0xd9480f), ...paint(picked.orientation.contact.faces, 0x2b8a3e)] };
  },
};
export const views: Pick<typeof QUERY_VIEWS, 'print'> = { print: printView };
