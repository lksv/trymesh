// Scenario 15 assembled as one model (D72, point 7 of 6f): the calls of
// docs/d36/6f-outline-import/calls.ts carried over against the engine as implemented, with the
// harness the calls declare (the engine of one document at a time, `fresh`, `fail`). The board
// is imported from the DXF a PCB tool would write (`boardDxf` of outline-kit.ts), the skeleton,
// the base, the lid, the vents and the notches are the calls of 6b, 6c, 6d and 6e over it, and the
// checks of step 7 read the revised file into the entry. The placement and the flag run on models of
// their own. scenario15.test.ts runs them.
import { type Command, type CommandResult, type Engine, type EngineState, type Expr, type Id, type QueryOutcome, type SketchFeature as SketchFeatureAfter, type SketchOutline, type SketchResult, type SketchToolInputs, type Vec2, freshIds, importOutline, outlineRevision, sketchTool } from '@trymesh/engine';
import type { OutlineAbout } from '../../engine/src/export/outline';
import { OUTLINE_NOT_CUT } from '../../engine/src/sketch-cut';
import type { ImportedCurve, OutlineInput, PlacedOutline } from '../../engine/src/types';
import type { OutlineOutcome, OutlineReport } from '@trymesh/engine';
import { boardDxf } from '../../engine/test/outline-kit';
import { newEngine } from './kit';

type CommandAfter = Command;
export let engine: Engine = newEngine();
// a new document in the engine: the cases that are not steps of the scenario start from one
export function fresh(): void {
  engine = newEngine();
}
export function fail(message: string): never {
  throw new Error(message);
}

export const done = (result: CommandResult): EngineState => (result.ok ? result.state : fail(`${result.error.code}: ${result.error.message}`));
export const run = (...commands: CommandAfter[]): EngineState => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
export const refused = (command: CommandAfter, text: string): boolean => {
  const result = engine.preview(command);
  return !result.ok && result.error.message.includes(text);
};
export const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
export const read = (outcome: OutlineOutcome): { curves: Record<Id, ImportedCurve>; report: OutlineReport } => (outcome.ok ? outcome : fail(`${outcome.error.code}: ${outcome.error.message}`));
export const unreadable = (outcome: OutlineOutcome): boolean => !outcome.ok && outcome.error.code === 'unreadable';
export const near = (value: number | undefined, expected: number, tolerance: number): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const sketchOf = (state: EngineState, id: Id): SketchFeatureAfter => (state.document.features.find((f) => f.id === id) as unknown as SketchFeatureAfter | undefined) ?? fail(`no sketch "${id}"`);
export const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch ?? fail(`no result of "${id}"`);
export const loopsOf = (state: EngineState, sketch: Id): Id[][] => resultOf(state, sketch).regions.map((region) => region.ref.outerLoop);
export const volumeOf = (state: EngineState, body: Id): number => state.evaluation.bodies[body]?.volume ?? fail(`no body "${body}"`);
export const allOk = (state: EngineState): boolean => state.document.features.every((f) => state.evaluation.features[f.id].status === 'ok');
export const outlineOf = (state: EngineState, sketch: Id, entry: Id): SketchOutline => sketchOf(state, sketch).external[entry] as SketchOutline;

const XY = { kind: 'base', plane: 'XY' } as const;
const set = (name: string, expr: string): Command => ({ type: 'setParameter', name, expr });
const sketch = (id: Id, plane: object): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'sketch', plane, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } }) as Command;
const plane = (id: Id, offset: Expr): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: XY, offset } }) as Command;
const on = (feature: Id) => ({ kind: 'plane', feature }) as const;
const pt = (s: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
const ln = (s: Id, id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b, ...(construction ? { construction } : {}) } });
const ac = (s: Id, id: Id, center: Id, start: Id, end: Id): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'arc', center, start, end } });
const constrain = (s: Id, id: Id, constraint: object): Command => ({ type: 'addConstraint', sketch: s, id, constraint }) as Command;
const dim = (s: Id, id: Id, type: 'horizontalDistance' | 'verticalDistance', a: Id, b: Id, value: number | Expr): Command => constrain(s, id, { type, a, b, value, driving: true });
// the distance of a point from a line, driving
const off = (s: Id, id: Id, point: Id, line: Id, value: number | Expr): Command => constrain(s, id, { type: 'distancePointLine', point, line, value, driving: true });
const project = (s: Id, id: Id, source: Id, entity: Id, kind: 'point' | 'line' | 'circle' | 'arc', regions?: boolean): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'sketch', sketch: source, entity, kind, ...(regions === undefined ? {} : { regions }) } });
const extrude = (id: Id, s: Id, regions: Id[][], distance: Expr, operation: 'new' | 'add' | 'cut', more: { offset?: Expr; targets?: Id[] } = {}): Command =>
  ({
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: regions.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })), ...(more.offset === undefined ? {} : { offset: more.offset }) }, extent: { type: 'distance', start: 0, distance }, operation, ...(more.targets ? { targets: more.targets } : {}) },
  }) as Command;
const contextOf = (state: EngineState, s: Id) => ({ sketch: state.document.features.find((f) => f.id === s) as never, result: resultOf(state, s), parameters: state.evaluation.parameters, document: state.document, features: state.evaluation.features });
// a sketch tool of the engine, its batch run; the lists of IDs it made
function tool<K extends keyof SketchToolInputs>(name: K, s: Id, input: SketchToolInputs[K], prefix: string): Record<string, Id[]> {
  const state = engine.getState();
  const made = sketchTool(name, contextOf(state, s), input, freshIds(state.document, prefix));
  if (!made.ok) return fail(`${name}: ${made.message}`);
  run(...made.commands);
  return made.ids;
}
const outline = (s: Id, id: Id, ref: OutlineInput): CommandAfter => ({ type: 'addExternal', sketch: s, id, ref });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

// ================================================================ the file of the board

// `boardDxf` (outline-kit.ts): the board 60 × 40 as a PCB tool writes it; the import names the
// bottom side `l1`, the right `l2`, the top `l3`, the left `l4`, the corners `a1` (lower right) to
// `a4` (lower left), the holes `c1` (lower left), `c2` (lower right), `c3`, `c4`.
const EDGE = { layers: ['Edge.Cuts'] };
export const boardFile = (W: number) => read(importOutline('dxf', bytes(boardDxf(W)), EDGE));

// ---------------------------------------------------------------- the numbers

const rounded = (W: number, H: number, R: number, o: number): number => (W + 2 * o) * (H + 2 * o) - (4 - Math.PI) * (R + o) ** 2;
// The board with its four holes, 1.6 thick: 3776.17 mm³ by hand for W = 60 (measured 3776.38).
export const pcbByHand = (W: number): number => (rounded(W, 40, 3, 0) - Math.PI * 1.6 * 1.6 * 4) * 1.6;
// The base: the floor (offset 2.5, 2 thick), the rim (offset 2.5 less 0.5, 4 high), four rings
// (6 outside, 3.2 inside, 5 high): 7836.90 for W = 60 (measured 7835.04); less the notch of the
// floor, 8 wide and 5 deep after the offset, 80.
export const baseByHand = (W: number): number => rounded(W, 40, 3, 2.5) * 2 + (rounded(W, 40, 3, 2.5) - rounded(W, 40, 3, 0.5)) * 4 + ((4 * Math.PI * (6 * 6 - 3.2 * 3.2)) / 4) * 5;
// The lid: 12 beyond the board's sides and 7 beyond its bottom and top (84 × 54 for the board
// 60 × 40), corners of 5, a grip of 4 on each flank (9.8 · 4 mm² each, 6d), 2 thick: 8872.28 by
// hand, measured 8871.81; a slot 12 × 3 with round ends; the round notch of radius 4, half of it.
export const lidByHand = (W: number): number => ((W + 24) * 54 - (4 - Math.PI) * 25 - 2 * 9.8 * 4) * 2;
export const SLOT = 3 * 9 + Math.PI * 1.5 * 1.5;
const ALLOWANCE = 3; // mm³: the polygons of the arcs and circles of the base
export const LID_ALLOWANCE = (0.2 + 2 * 0.06 + 9 * 0.06) * 2; // mm³: the corners, the grips, the slots and the notch of the lid
const OUTLINE = ['a1', 'a2', 'a3', 'a4', 'l1', 'l2', 'l3', 'l4'].map((local) => `pcbo/${local}`);
const FRAME_OUTLINE = ['fa1', 'fa2', 'fa3', 'fa4', 'fl1', 'fl2', 'fl3', 'fl4'];
const RIM = ['ra1', 'ra2', 'ra3', 'ra4', 'rl1', 'rl2', 'rl3', 'rl4'];
const LID_REGION = ['c1', 'c2', 'c3', 'm/1/c1', 'm/1/c2', 'm/1/c3', 'm/1/r1', 'm/1/r2', 'r1', 'r2'];

// ================================================================ step 1: the board

// The file read (only the layer of the outline), stored in the sketch `board` as the entry `pcbo`
// and placed with the centre of its box on the origin: the file's own coordinates (100 to 160,
// 80 to 120) do not matter, and the hole pairs are symmetric about both axes because the board is.
// It forms regions (the default): the outline with its four holes is extruded 1.6 directly.
export function board(): EngineState {
  const { curves, report } = boardFile(60);
  // the report: 12 curves (4 lines, 4 arcs, 4 circles), nothing welded, nothing open; the layers
  // of the file with what they hold, the courtyard and the text among them
  if (report.curves !== 12 || report.open !== 0 || !same(report.byKind, { line: 4, arc: 4, circle: 4, spline: 0 }) || !same(Object.keys(report.about.layers), ['Edge.Cuts', 'F.CrtYd', 'F.SilkS'])) fail('the report');
  // `readWith` is what the file was read with ({ format: 'dxf', layers: ['Edge.Cuts'] }): a
  // replacement repeats it
  run(sketch('board', XY), outline('board', 'pcbo', { type: 'outline', name: 'board.dxf', readWith: report.readWith, curves, anchor: 'center' }));
  return run(extrude('pcb', 'board', [OUTLINE], '1.6', 'new'));
}
// What the board is after step 1: no own geometry, no freedom, one region of the eight outline
// curves with four holes and four discs; the holes at (∓26.5, ∓16.5); the side faces named by the
// curves of the entry; the document holds the placement and a fingerprint, not the positions twice.
export function boardChecks(state: EngineState): boolean {
  const result = resultOf(state, 'board');
  const hole = (local: Id): Vec2 => [result.points[`pcbo/${local}/center`].x, result.points[`pcbo/${local}/center`].y];
  const stored = sketchOf(state, 'board').solved.external.pcbo as PlacedOutline;
  const sides = state.evaluation.bodies.pcb.faces.map((face) => state.evaluation.faceNames[face.id]).filter((name) => name.role === 'side');
  return (
    result.valid &&
    result.degreesOfFreedom === 0 &&
    result.openEnds === undefined &&
    same(loopsOf(state, 'board').find((loop) => loop.length === 8), OUTLINE) &&
    loopsOf(state, 'board').length === 5 &&
    near(hole('c1')[0], -26.5, 1e-9) &&
    near(hole('c2')[0], 26.5, 1e-9) &&
    near(hole('c1')[1], -16.5, 1e-9) &&
    near(hole('c4')[1], 16.5, 1e-9) &&
    stored.kind === 'outline' &&
    same(stored.at, [-130, -100]) &&
    sides.length === 12 &&
    sides.some((name) => same(name, { feature: 'pcb', role: 'side', curve: 'pcbo/a1' })) &&
    Math.abs(volumeOf(state, 'pcb') - pcbByHand(60)) < 0.5
  );
}

// ================================================================ steps 2 and 3: the skeleton and the base (6b)

const COVER: [string, string][] = [['standoffH', '5'], ['baseT', '2'], ['clearance', '0.5'], ['wall', '2'], ['rimH', '4'], ['standoffD', '6']];
export let FLOOR: Id[] = [];
// The skeleton projects the eight curves of the outline and the four holes, entities of the entry
// `pcbo` of `board` (slashed IDs, 6b), and measures the lower hole pair from `origin/y`. The floor
// is one call of `projectSketch` with `as: 'own'`; the rim the outline with the flag; the standoffs
// own circles around the projected holes.
export function skeletonAndBase(): EngineState {
  run(...COVER.map(([name, expr]) => set(name, expr)));
  const f = 'frame';
  run(plane('framePl', '-standoffH'), sketch(f, on('framePl')));
  run(...[1, 2, 3, 4].flatMap((i) => [project(f, `fa${i}`, 'board', `pcbo/a${i}`, 'arc'), project(f, `fl${i}`, 'board', `pcbo/l${i}`, 'line'), project(f, `fh${i}`, 'board', `pcbo/c${i}`, 'circle')]));
  run(constrain(f, 'm1', { type: 'distancePointLine', point: 'fh1/center', line: 'origin/y', value: 1, driving: false }), constrain(f, 'm2', { type: 'distancePointLine', point: 'fh2/center', line: 'origin/y', value: 1, driving: false }));
  run(plane('basePl', '-(standoffH + baseT)'), sketch('baseSk', on('basePl')));
  FLOOR = tool('projectSketch', 'baseSk', { sketch: 'frame', entities: FRAME_OUTLINE, as: 'own' }, 'o').curves;
  run(extrude('base', 'baseSk', [FLOOR], 'baseT', 'new', { offset: 'clearance + wall' }));
  run(sketch('rimSk', on('framePl')), ...[1, 2, 3, 4].flatMap((i) => [project('rimSk', `ra${i}`, 'frame', `fa${i}`, 'arc', true), project('rimSk', `rl${i}`, 'frame', `fl${i}`, 'line', true)]));
  run(extrude('rim', 'rimSk', [RIM], 'rimH', 'add', { offset: 'clearance + wall', targets: ['base'] }), extrude('pocket', 'rimSk', [RIM], 'rimH', 'cut', { offset: 'clearance', targets: ['base'] }));
  const t = 'standSk';
  const commands: Command[] = [sketch(t, on('framePl'))];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], k) => {
    const i = k + 1;
    commands.push(
      project(t, `sh${i}`, 'frame', `fh${i}`, 'circle', true),
      pt(t, `sc${i}`, sx * 26.4, sy * 16.6),
      { type: 'addCurve', sketch: t, id: `so${i}`, curve: { type: 'circle', center: `sc${i}` }, radius: 2.9 },
      constrain(t, `sk${i}`, { type: 'coincident', a: `sc${i}`, b: `sh${i}/center` }),
      i === 1 ? constrain(t, 'sd', { type: 'diameter', curve: 'so1', value: 'standoffD', driving: true }) : constrain(t, `se${i}`, { type: 'equalRadius', a: 'so1', b: `so${i}` }),
    );
  });
  run(...commands);
  return run(extrude('standoffs', t, [['so1'], ['so2'], ['so3'], ['so4']], 'standoffH', 'add', { targets: ['base'] }));
}
// Measured: both holes 26.5 from `origin/y`; the floor's sketch with no freedom and no redundant
// constraint, one region of its eight own curves; the rim one region of eight entries; the base
// 7835.04 against 7836.90 by hand.
export function baseChecks(state: EngineState): boolean {
  const diagnosis = engine.diagnoseSketch('baseSk');
  return (
    near(resultOf(state, 'frame').measurements.m1, 26.5, 1e-9) &&
    near(resultOf(state, 'frame').measurements.m2, 26.5, 1e-9) &&
    diagnosis.degreesOfFreedom === 0 &&
    diagnosis.redundant.length === 0 &&
    same(loopsOf(state, 'baseSk'), [[...FLOOR].sort()]) &&
    same(loopsOf(state, 'rimSk'), [RIM]) &&
    Math.abs(volumeOf(state, 'base') - baseByHand(60)) < ALLOWANCE
  );
}

// ================================================================ step 4: the lid (6c, 6d)

// The lid stands over the board, so its half is dimensioned from the board, not from parameters of
// its own size: its sketch projects the bottom, right and top side of the board from the skeleton
// (`xb`, `xr`, `xt`), and the half of 6d's calls (a bottom line, a corner, the spline flank with
// its two legs, a corner, the top line ending on `origin/y`) is held `overX` beyond the right side
// and `overY` beyond the bottom and the top. Mirrored about `origin/y` by 6c. Fully determined;
// the region and the faces have 6c's names. Measured: 8871.81 against 8872.28 by hand.
export function lid(): EngineState {
  run(...([['lidZ', '6'], ['overX', '12'], ['overY', '7'], ['R', '5'], ['T', '2'], ['grip', '4'], ['reach', '10']] as const).map(([name, expr]) => set(name, expr)));
  const s = 'lidSketch';
  run(plane('lidPl', 'lidZ'), sketch(s, on('lidPl')));
  run(project(s, 'xb', 'frame', 'fl1', 'line'), project(s, 'xr', 'frame', 'fl2', 'line'), project(s, 'xt', 'frame', 'fl3', 'line'));
  run(
    pt(s, 'a0', 0.4, -27.3),
    pt(s, 'a1', 37.3, -26.8),
    pt(s, 'q1', 36.8, -21.9),
    pt(s, 'a2', 42.2, -22.3),
    pt(s, 'g1', 42.4, -11.7),
    pt(s, 'g2', 37.6, 0.4),
    pt(s, 'g3', 41.7, 11.6),
    pt(s, 'a3', 41.9, 22.4),
    pt(s, 'q2', 37.3, 21.8),
    pt(s, 'a4', 36.8, 27.3),
    pt(s, 'a5', 0.7, 26.8),
    ln(s, 'c1', 'a0', 'a1'),
    ac(s, 'r1', 'q1', 'a1', 'a2'),
    { type: 'addCurve', sketch: s, id: 'c2', curve: { type: 'spline', points: ['a2', 'g1', 'g2', 'g3', 'a3'] } },
    ac(s, 'r2', 'q2', 'a3', 'a4'),
    ln(s, 'c3', 'a4', 'a5'),
    ln(s, 'l1', 'a2', 'g1', true),
    ln(s, 'l2', 'g3', 'a3', true),
  );
  run(
    constrain(s, 'k0', { type: 'pointOnCurve', point: 'a0', curve: 'origin/y' }),
    constrain(s, 'k1', { type: 'horizontal', line: 'c1' }),
    constrain(s, 'k3', { type: 'horizontal', line: 'c3' }),
    constrain(s, 'k4', { type: 'tangent', a: 'c1', b: 'r1' }),
    constrain(s, 'k7', { type: 'tangent', a: 'r2', b: 'c3' }),
    constrain(s, 'k8', { type: 'radius', curve: 'r1', value: 'R', driving: true }),
    constrain(s, 'k9', { type: 'equalRadius', a: 'r1', b: 'r2' }),
    off(s, 'k10', 'a2', 'xr', 'overX'),
    off(s, 'k11', 'a5', 'xt', 'overY'),
    off(s, 'k13', 'a0', 'xb', 'overY'),
    constrain(s, 'k12', { type: 'pointOnCurve', point: 'a5', curve: 'origin/y' }),
    constrain(s, 't1', { type: 'vertical', line: 'l1' }),
    constrain(s, 't2', { type: 'tangent', a: 'r1', b: 'l1' }),
    constrain(s, 't3', { type: 'vertical', line: 'l2' }),
    constrain(s, 't4', { type: 'tangent', a: 'l2', b: 'r2' }),
    off(s, 't5', 'a3', 'xr', 'overX'),
    dim(s, 't6', 'verticalDistance', 'a2', 'g1', 'reach'),
    dim(s, 't7', 'verticalDistance', 'g3', 'a3', 'reach'),
    dim(s, 't8', 'horizontalDistance', 'g2', 'a2', 'grip'),
    dim(s, 't9', 'verticalDistance', 'origin', 'g2', 0),
  );
  const diagnosis = engine.diagnoseSketch(s);
  if (diagnosis.degreesOfFreedom !== 0 || diagnosis.redundant.length !== 0) fail('the half of the lid is not determined');
  run({ type: 'addExternal', sketch: s, id: 'm', ref: { type: 'pattern', sources: ['c1', 'r1', 'c2', 'r2', 'c3'], transform: { type: 'mirror', axis: 'origin/y' } } });
  return run(extrude('lid', s, [LID_REGION], 'T', 'new'));
}

// ================================================================ step 5: the vents (6c, 6b)

// a slot 12 × 3 (the centres 9 apart) at (x, y): arcs `${p}g1`, `${p}g2`, lines `${p}e1`, `${p}e2`
const slot = (s: Id, p: string, x: number, y: number): Command[] => [
  pt(s, `${p}o1`, x, y - 4.5),
  pt(s, `${p}o2`, x, y + 4.5),
  pt(s, `${p}s1`, x - 1.5, y - 4.5),
  pt(s, `${p}s2`, x + 1.5, y - 4.5),
  pt(s, `${p}s3`, x + 1.5, y + 4.5),
  pt(s, `${p}s4`, x - 1.5, y + 4.5),
  ac(s, `${p}g1`, `${p}o1`, `${p}s1`, `${p}s2`),
  ln(s, `${p}e1`, `${p}s2`, `${p}s3`),
  ac(s, `${p}g2`, `${p}o2`, `${p}s3`, `${p}s4`),
  ln(s, `${p}e2`, `${p}s4`, `${p}s1`),
];
const row = (s: Id, id: Id, sources: Id[]): Command => ({ type: 'addExternal', sketch: s, id, ref: { type: 'pattern', sources, transform: { type: 'linear', direction: 'origin/x', count: 'vents', span: { type: 'spacing', spacing: 'ventPitch' } } } });
const copyRegion = (copy: number): Id[] => ['we1', 'we2', 'wg1', 'wg2'].map((curve) => `vb/${copy}/${curve}`);
// A row of slots in the lid's sketch (holes of its region), and a second row in a sketch of its
// own, cut through the lid by the regions of copies 1 and 3. The second sketch projects a copy of
// the lid's mirror and is dimensioned from it: the copy of the top line, `m/1/c3`. (6b's calls
// project the copied flank `m/1/c2`; since 6d the flank is a spline, which is not projected.)
// Measured: the lid 8531.72 with the first row (8531.59 by hand), 8395.68 with both (8395.32).
export function vents(): EngineState {
  run(set('vents', '5'), set('ventPitch', '6'));
  run(...slot('lidSketch', 'v', -12, -10), row('lidSketch', 'va', ['vg1', 've1', 'vg2', 've2']));
  run(sketch('ventSketch', on('lidPl')), project('ventSketch', 'lf', 'lidSketch', 'm/1/c3', 'line'), ...slot('ventSketch', 'w', -12, 10));
  run(off('ventSketch', 'lfd', 'wo2', 'lf', '12.5'), row('ventSketch', 'vb', ['wg1', 'we1', 'wg2', 'we2']));
  return run(extrude('ventCut', 'ventSketch', [copyRegion(1), copyRegion(3)], 'T', 'cut', { targets: ['lid'] }));
}

// ================================================================ step 6: the cable notches (6e, 6c, 6d)

// The notch of the floor, rectangular (owner, answer 20): three lines across the bottom side of the
// floor's own outline, 8 wide plus twice the offset, 5 deep, dimensioned from that side. The
// profile is invalid until three trims leave one loop; the base is patched in the batch of the
// first. The first trim names the curve: its place lies on the own side and on the projection
// under it alike (6b's design, "From 6e", 7). Measured: the base 80.00 less, its sketch still
// determined. The rim bridges the notch: it is a projection with the flag, which nothing cuts, and
// the cable passes under it.
export function floorNotch(): EngineState {
  run(set('slotW', '8'), set('slotD', '5'));
  const b = 'baseSk';
  const bottom = FLOOR[4]; // the own curve over `fl1`, the fifth entity named to the tool
  run(
    pt(b, 'u1', -6.4, -15.2),
    pt(b, 'sa', -6.6, -23.1),
    pt(b, 'u2', 6.6, -14.9),
    pt(b, 'sc', 6.4, -22.8),
    ln(b, 'ua', 'sa', 'u1'),
    ln(b, 'ub', 'u1', 'u2'),
    ln(b, 'uc', 'u2', 'sc'),
    constrain(b, 'uav', { type: 'vertical', line: 'ua' }),
    constrain(b, 'ubh', { type: 'horizontal', line: 'ub' }),
    constrain(b, 'ucv', { type: 'vertical', line: 'uc' }),
    dim(b, 'ux', 'horizontalDistance', 'u1', 'origin', 'slotW / 2 + clearance + wall'),
    dim(b, 'uw', 'horizontalDistance', 'u1', 'u2', 'slotW + 2 * (clearance + wall)'),
    off(b, 'ud', 'u1', bottom, 'slotD'),
    off(b, 'say', 'sa', bottom, '3'),
    off(b, 'scy', 'sc', bottom, '3'),
  );
  if (engine.getState().evaluation.features.base.error?.code !== 'invalidProfile') fail('the three lines leave the profile valid');
  const first = tool('trim', b, { curve: bottom, at: [0, -20] }, 's1_');
  if (!same(first.patched, ['base'])) fail('the base is not patched');
  tool('trim', b, { at: [-6.5, -21.5] }, 's2_');
  tool('trim', b, { at: [6.5, -21.5] }, 's3_');
  return engine.getState();
}
// The second notch, a round one, in the top line of the lid's source half: a circle on `c3`, two
// trims; the entry of the mirror is patched and the copy is notched with it; the lid's region
// passes both splines through the cut (6d). The second trim lists the lid in `dropped` (the half
// discs it read after the first, as in 6d's own test); it keeps its one region.
export function lidNotch(): EngineState {
  const s = 'lidSketch';
  run(set('cableD', '8'));
  run(pt(s, 'nc', 20, 27), { type: 'addCurve', sketch: s, id: 'nk', curve: { type: 'circle', center: 'nc' }, radius: 4 }, constrain(s, 'nkc', { type: 'pointOnCurve', point: 'nc', curve: 'c3' }), dim(s, 'nkx', 'horizontalDistance', 'origin', 'nc', 20), constrain(s, 'nkd', { type: 'diameter', curve: 'nk', value: 'cableD', driving: true }));
  tool('trim', s, { curve: 'nk', at: [20, 31] }, 'n1_');
  tool('trim', s, { at: [20, 27] }, 'n2_');
  return engine.getState();
}
const regionsOfFeature = (state: EngineState, feature: Id): Id[][] => {
  const f = state.document.features.find((g) => g.id === feature);
  return f?.type === 'extrude' && f.profile.type === 'regions' ? f.profile.regions.map((r) => r.outerLoop) : [];
};
export function notchChecks(state: EngineState): boolean {
  const region = regionsOfFeature(state, 'lid');
  return (
    allOk(state) &&
    engine.diagnoseSketch('baseSk').degreesOfFreedom === 0 &&
    engine.diagnoseSketch('baseSk').redundant.length === 0 &&
    loopsOf(state, 'baseSk').length === 1 &&
    near(volumeOf(state, 'base'), baseByHand(60) - 8 * 5 * 2, ALLOWANCE) &&
    region.length === 1 &&
    ['c2', 'm/1/c2', 'nk', 'm/1/nk'].every((curve) => region[0].includes(curve)) &&
    near(volumeOf(state, 'lid'), lidByHand(60) - 7 * SLOT * 2 - Math.PI * 16 * 2, LID_ALLOWANCE)
  );
}

// ================================================================ step 7: the checks

// `vents` 7: two more holes of the lid, the cut keeps its regions and its references. 3, executed
// and not previewed: the cut is `noProfile` naming the region of copy 3, and its feature is as it
// was. 5 brings it back from that state (the review, codex 15; measured, H4).
export function ventCount(): boolean {
  const before = engine.getState();
  const cut = before.document.features.find((f) => f.id === 'ventCut');
  const seven = run(set('vents', '7'));
  const three = run(set('vents', '3'));
  const five = run(set('vents', '5'));
  return (
    allOk(seven) &&
    same(seven.document.features.find((f) => f.id === 'ventCut'), cut) &&
    near(volumeOf(seven, 'lid') - volumeOf(before, 'lid'), -2 * SLOT * 2, 0.5) &&
    three.evaluation.features.ventCut.error?.code === 'noProfile' &&
    same(three.evaluation.features.ventCut.error?.refs, [{ outerLoop: copyRegion(3) }]) &&
    same(three.document.features.find((f) => f.id === 'ventCut'), cut) &&
    allOk(five) &&
    same(five.document.features.find((f) => f.id === 'ventCut'), cut) &&
    near(volumeOf(five, 'lid'), volumeOf(before, 'lid'), 1e-6)
  );
}

// The revised file of the board, 2 mm wider, replaces the stored outline: one `updateExternal`
// with the new curves and nothing else. Every curve keeps its ID (the file lists them in the same
// order), so the projections of the skeleton follow, the own outline of the floor follows them,
// the rim, the standoffs, the lid and its mirror, the vents and both notches follow, and no
// feature is in error. The placement by the centre keeps the board on the axes: both holes of the
// pair now measure 27.5. Measured: the board +128.000, the base +212.000, the lid +216.000 mm³,
// 175 ms for the 17 features.
export function revisedFile(): boolean {
  const before = engine.getState();
  const { curves } = boardFile(62);
  const revision = outlineRevision(outlineOf(before, 'board', 'pcbo').curves, curves);
  const state = run({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { type: 'outline', curves } });
  const entry = outlineOf(state, 'board', 'pcbo');
  return (
    revision.kept === 12 &&
    revision.added.length === 0 &&
    revision.removed.length === 0 &&
    revision.renamed.length === 0 &&
    same(entry.readWith, { format: 'dxf', layers: ['Edge.Cuts'] }) &&
    revision.changed === 7 &&
    entry.anchor === 'center' &&
    entry.name === 'board.dxf' &&
    allOk(state) &&
    near(volumeOf(state, 'pcb') - volumeOf(before, 'pcb'), pcbByHand(62) - pcbByHand(60), 1e-3) &&
    near(volumeOf(state, 'base') - volumeOf(before, 'base'), baseByHand(62) - baseByHand(60), 1e-3) &&
    near(volumeOf(state, 'lid') - volumeOf(before, 'lid'), lidByHand(62) - lidByHand(60), 1e-3) &&
    near(resultOf(state, 'frame').measurements.m1, 27.5, 1e-9) &&
    near(resultOf(state, 'frame').measurements.m2, 27.5, 1e-9) &&
    engine.diagnoseSketch('baseSk').degreesOfFreedom === 0 &&
    engine.diagnoseSketch('baseSk').redundant.length === 0 &&
    near(resultOf(state, 'lidSketch').points.a2.x, 43, 1e-6) &&
    near(resultOf(state, 'lidSketch').points['m/1/a2'].x, -43, 1e-6)
  );
}

// The volumes by the query `mass` against the values by hand, for the parts without a spline: the
// board and the base (the lid is checked against its polygon, 6d).
export function volumes(): boolean {
  const answer = unwrap(engine.query('mass', { bodies: ['pcb', 'base'], density: 1.24e-3 }));
  const of = (body: Id): number => answer.bodies.find((b) => b.body === body)?.volume ?? Number.NaN;
  return near(of('pcb'), pcbByHand(62), 0.5) && near(of('base'), baseByHand(62) - 80, ALLOWANCE);
}

// The section of the lid at half its thickness, exported as DXF (D54) and read back: closed
// polylines of lines and arcs on the layers OUTER and HOLES, the loops of the lid and its seven
// slots. The region of the outer loop with its holes has the area of the section. Measured: 96
// lines and 40 arcs, nothing welded, 8 regions, 4255.743 against 4255.729 mm²: the section's area
// is of the mesh, the region's of the arcs divided again within the chord tolerance.
export function lidSection(): boolean {
  const exported = unwrap(engine.export('dxf', { plane: XY, offset: 7, bodies: ['lid'] }));
  const file = exported.files[0];
  const about = file.about as OutlineAbout;
  const { curves, report } = read(importOutline('dxf', file.bytes));
  const state = run(sketch('lidBack', XY), outline('lidBack', 'o', { type: 'outline', curves }));
  const regions = resultOf(state, 'lidBack').regions;
  const area = (loop: Float64Array): number => {
    let sum = 0;
    for (let i = 0; i < loop.length; i += 2) sum += loop[i] * loop[(i + 3) % loop.length] - loop[(i + 2) % loop.length] * loop[i + 1];
    return Math.abs(sum) / 2;
  };
  const outer = regions.find((region) => region.loops.length === 8) ?? fail('no region with seven holes');
  const withHoles = outer.loops.reduce((sum, loop, i) => sum + (i === 0 ? 1 : -1) * area(loop), 0);
  return about.loops === 8 && report.welded === 0 && report.open === 0 && same(Object.keys(report.about.layers), ['OUTER', 'HOLES']) && resultOf(state, 'lidBack').valid && regions.length === 8 && near(withHoles, about.area, 0.1);
}

// ================================================================ the placement and the flag

// The anchor of the file keeps the file's coordinates: the same board with `anchor: 'origin'` and
// the place `(-130, -100)` stands where the centred one stood, and the wider file then grows to
// the right only (measured: the holes 26.5 and 28.5 from `origin/y`). The three numbers are fields:
// an expression in the command, `setField`, a rename of the parameter; a turn by a quarter gives
// the board 40 wide and 62 high and every feature after it follows.
// On a model of its own: the board of the wider file, the skeleton and the base (steps 1 to 3),
// which are held on projections of the board alone and so turn with it (measured, B3). Not in the
// assembled model: the lid and the notch of the floor are dimensioned from the axes of their
// sketches, which do not turn, and a quarter turn there leaves `baseSk` and `lidSketch` unsolved
// (the review, codex 11; measured, H6). A cover that turns with its board is not what scenario 15
// asks for.
export function placement(): boolean {
  fresh();
  const { curves, report } = boardFile(62);
  run(sketch('board', XY), outline('board', 'pcbo', { type: 'outline', name: 'board.dxf', readWith: report.readWith, curves, anchor: 'center' }), extrude('pcb', 'board', [OUTLINE], '1.6', 'new'));
  skeletonAndBase();
  const byOrigin = run({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { type: 'outline', anchor: 'origin', x: -130, y: -100 } });
  const measured = resultOf(byOrigin, 'frame').measurements;
  run({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { type: 'outline', anchor: 'center', x: 0, y: 0 } });
  const turned = run(set('boardTurn', 'deg(90)'), { type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { type: 'outline', turn: 'boardTurn' } });
  const expression = sketchOf(turned, 'board').expressions?.['external/pcbo/turn'];
  const renamed = run({ type: 'renameParameter', name: 'boardTurn', to: 'turnOfBoard' });
  const back = run(set('turnOfBoard', '0'));
  const moved = done(engine.preview({ type: 'setField', feature: 'board', path: 'external/pcbo/x', value: 5 }));
  return (
    near(measured.m1, 26.5, 1e-9) &&
    near(measured.m2, 28.5, 1e-9) &&
    expression === 'boardTurn' &&
    allOk(turned) &&
    near(turned.evaluation.bodies.pcb.bounds.max[1], 31, 1e-4) &&
    sketchOf(renamed, 'board').expressions?.['external/pcbo/turn'] === 'turnOfBoard' &&
    allOk(back) &&
    near(resultOf(moved, 'board').points['pcbo/c1/center'].x, -22.5, 1e-9) &&
    outlineOf(back, 'board', 'pcbo').turn === 0
  );
}

// The flag: an own line across the bottom side of an outline that forms regions makes the profile
// invalid, the query says why and split refuses with the same text. With the flag switched off (the
// update sends two fields, not the curves) the sketch has no region and the own line is free: a
// trim with the side as `with` cuts it there, an extend reaches another side. The stored value and
// the stamp are kept by the switch (the positions of the own points are those stored; the solver
// still runs for the diagnosis, as at every step).
export function flag(): boolean {
  const { curves } = boardFile(60);
  const before = run(sketch('flagSk', XY), outline('flagSk', 'o', { type: 'outline', curves, anchor: 'center' }), pt('flagSk', 'n1', 0, -25), pt('flagSk', 'n2', 0, -15), ln('flagSk', 'n', 'n1', 'n2'));
  const contacts = unwrap(engine.query('sketchContacts', { sketch: 'flagSk' }));
  const state = engine.getState();
  const split = sketchTool('split', contextOf(state, 'flagSk'), {}, freshIds(state.document, 'x_'));
  const stamp = sketchOf(before, 'flagSk').solved.inputs;
  const off2 = run({ type: 'updateExternal', sketch: 'flagSk', id: 'o', ref: { type: 'outline', regions: false } });
  tool('trim', 'flagSk', { curve: 'n', at: [0, -23], with: 'o/l1' }, 't_');
  tool('extend', 'flagSk', { curve: 'n', end: 'b', with: 'o/l3' }, 'e_');
  const after = engine.getState();
  return (
    !resultOf(before, 'flagSk').valid &&
    contacts.contacts.length === 1 &&
    contacts.contacts[0].fix === 'none' &&
    contacts.contacts[0].why === OUTLINE_NOT_CUT('o/l1', 'o') &&
    !split.ok &&
    split.message.includes(OUTLINE_NOT_CUT('o/l1', 'o')) &&
    resultOf(off2, 'flagSk').valid &&
    loopsOf(off2, 'flagSk').length === 0 &&
    sketchOf(off2, 'flagSk').solved.inputs === stamp &&
    Object.keys(outlineOf(off2, 'flagSk', 'o').curves).length === 12 &&
    resultOf(after, 'flagSk').valid
  );
}

// An outline with one side left out, closed by own lines with a notch: the own ends are put on the
// open ends of the outline by `coincident` and join them; one region of own and imported curves.
// Before the own lines the two ends are in `openEnds` (`apart`, with the nearest end and how far).
export function mixedLoop(): boolean {
  const { l1: _bottom, ...rest } = boardFile(60).curves;
  const open = run(sketch('mixSk', XY), outline('mixSk', 'o', { type: 'outline', curves: rest, x: -130, y: -100 }));
  const s = 'mixSk';
  const closed = run(pt(s, 'e1', -27, -20), pt(s, 'e2', 27, -20), pt(s, 'm1', -5, -20), pt(s, 'm2', -5, -14), pt(s, 'm3', 5, -14), pt(s, 'm4', 5, -20), constrain(s, 'k1', { type: 'coincident', a: 'e1', b: 'o/a4/end' }), constrain(s, 'k2', { type: 'coincident', a: 'e2', b: 'o/a1/start' }), ln(s, 'b1', 'e1', 'm1'), ln(s, 'b2', 'm1', 'm2'), ln(s, 'b3', 'm2', 'm3'), ln(s, 'b4', 'm3', 'm4'), ln(s, 'b5', 'm4', 'e2'));
  return resultOf(open, s).openEnds?.count === 2 && resultOf(open, s).openEnds?.ends[0].reason === 'apart' && resultOf(closed, s).valid && resultOf(closed, s).openEnds === undefined && loopsOf(closed, s).some((loop) => loop.length === 12 && loop.includes('b3') && loop.includes('o/l3'));
}


// ================================================================ the scenario

export function scenario(): boolean {
  const steps: (() => boolean)[] = [
    () => boardChecks(board()),
    () => baseChecks(skeletonAndBase()),
    () => allOk(lid()) && near(volumeOf(engine.getState(), 'lid'), lidByHand(60), LID_ALLOWANCE),
    () => allOk(vents()) && near(volumeOf(engine.getState(), 'lid'), lidByHand(60) - 7 * SLOT * 2, LID_ALLOWANCE),
    () => allOk(floorNotch()),
    () => notchChecks(lidNotch()),
    ventCount,
    revisedFile,
    volumes,
    lidSection,
  ];
  return steps.every((step) => step());
}
