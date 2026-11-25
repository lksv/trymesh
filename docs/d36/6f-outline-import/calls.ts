// Validation scenario 15 (a cover for a controller board) as one model, and the cases of package
// 6f, written as calls against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// A step that cannot be written here is a hole in the contract.
//
// 6f is the last package of step 6 and assembles the scenario (owner, answer 3): step 1 with the
// board imported from a DXF the test writes as a PCB tool would, steps 2 to 6 of the packages before
// it built on that board in one document (their own tests run them on stand-ins), and the checks of
// step 7. Then the cases that are 6f's alone: the placement, the flag, a revised file, the rule of
// an update, the weld and its bounds, the units and the layers, splines, the engine's own DXF and
// SVG read back, a tangency at a corner, the limits and the listing of many curves, and the
// refusals. Revised after the reviews of the design (design.md, "Reviews").
//
// Written against the engine as it is (every package before 6f is implemented), so the calls of
// the earlier steps use the real commands and sketch tools. The numbers in the comments were
// measured (design.md, "Measured": prototypes of the kind and of the readers in the real engine,
// with the real planegcs and manifold adapters; probes/). The IDs differ from the stand-ins: the
// board's curves are `pcbo/l1` … (the entry `pcbo` of the sketch `board`), numbered by the file.

import type { Command, CommandResult, Engine, EngineState, Expr, Id, QueryOutcome, SketchResult, SketchToolInputs, Vec2 } from '../../../packages/engine/src/index';
import { freshIds, sketchTool } from '../../../packages/engine/src/index';
import type { OutlineAbout } from '../../../packages/engine/src/export/outline';
import type { CommandAfter, EntryCurvesResult, ImportOutlineAnswer, ImportOutlineArgs, ImportedCurve, OutlineDetail, OutlineInput, OutlineOutcome, OutlineReport, PlacedOutline, ShownLoop, SketchFeatureAfter, SketchOutline, SketchRegionsResult } from './contract';
import { ENTITY_KIND_CHANGED, ENTITY_TAKEN, OUTLINE_LIMITS, OUTLINE_NOT_CUT, OUTLINE_REFUSALS, SKETCH_SHOWN, importOutline, openEnds, outlineIds, outlineRevision, weldOutline } from './contract';

// ---------------------------------------------------------------- the engine with the kind

export interface EngineAfter extends Omit<Engine, 'execute' | 'preview'> {
  execute(command: CommandAfter): CommandResult;
  preview(command: CommandAfter, at?: Id): CommandResult;
}
export declare const engine: EngineAfter;
// a new document in the engine: the cases that are not steps of the scenario start from one
export declare function fresh(): void;
export declare function fail(message: string): never;
// the query of section 6 of the contract, the MCP tool and get_sketch, as the tests reach them
export declare function entryCurves(args: { sketch: Id; entry: Id; kind?: ImportedCurve['type']; from?: number; max?: number }): EntryCurvesResult;
export declare function importOutlineTool(args: ImportOutlineArgs): ImportOutlineAnswer;
export declare function getSketch(sketch: Id): { external: (OutlineDetail | { id: Id })[]; regions: { ref: ShownLoop; area: number; holes: number }[]; advice: string[] };
// the MCP tools `query` and `execute`, as an AI calls them: what it has is their answers alone
export declare function mcpQuery(query: 'sketchRegions', args: { sketch: Id; curve?: Id; index?: number; holes?: boolean; from?: number; max?: number }): SketchRegionsResult;
export declare function mcpExecute(command: CommandAfter): { ok: boolean; features?: Record<Id, { status: string }> };

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

// The board 60 × 40 with corners of 3 and four holes of 3.2 at 3.5 from its edges, as a PCB tool
// writes its outline: separate LINE and ARC entities and the holes as CIRCLE entities on the layer
// `Edge.Cuts`, in the coordinates of its page (the lower left corner of the board at (100, 80)),
// six decimals, millimetres in the header; and, as such a file has, things on other layers (a
// courtyard, a text). The entities in a fixed order: the bottom side, then counter-clockwise; the
// holes from the lower left, counter-clockwise. So the import names the bottom side `l1`, the right
// `l2`, the top `l3`, the left `l4`, the corners `a1` (lower right) to `a4` (lower left), the
// holes `c1` (lower left), `c2` (lower right), `c3`, `c4`.
export function boardDxf(W: number, H = 40, R = 3): string {
  const out: string[] = [];
  const g = (code: number, value: string | number): void => void out.push(String(code), typeof value === 'number' ? value.toFixed(6) : value);
  const [x0, y0] = [100, 80];
  const line = (ax: number, ay: number, bx: number, by: number, layer = 'Edge.Cuts'): void => {
    g(0, 'LINE');
    g(8, layer);
    g(10, x0 + ax);
    g(20, y0 + ay);
    g(11, x0 + bx);
    g(21, y0 + by);
  };
  const arc = (cx: number, cy: number, from: number, to: number): void => {
    g(0, 'ARC');
    g(8, 'Edge.Cuts');
    g(10, x0 + cx);
    g(20, y0 + cy);
    g(40, R);
    g(50, from);
    g(51, to);
  };
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  out.push('70', '4');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  line(R, 0, W - R, 0);
  arc(W - R, R, 270, 0);
  line(W, R, W, H - R);
  arc(W - R, H - R, 0, 90);
  line(W - R, H, R, H);
  arc(R, H - R, 90, 180);
  line(0, H - R, 0, R);
  arc(R, R, 180, 270);
  for (const [hx, hy] of [[3.5, 3.5], [W - 3.5, 3.5], [W - 3.5, H - 3.5], [3.5, H - 3.5]]) {
    g(0, 'CIRCLE');
    g(8, 'Edge.Cuts');
    g(10, x0 + hx);
    g(20, y0 + hy);
    g(40, 1.6);
  }
  line(10, 10, 20, 10, 'F.CrtYd');
  line(20, 10, 20, 20, 'F.CrtYd');
  g(0, 'TEXT');
  g(8, 'F.SilkS');
  g(10, x0 + 5);
  g(20, y0 + 5);
  g(40, 1);
  g(1, 'REV A');
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${out.join('\r\n')}\r\n`;
}
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
const SLOT = 3 * 9 + Math.PI * 1.5 * 1.5;
const ALLOWANCE = 3; // mm³: the polygons of the arcs and circles of the base
const LID_ALLOWANCE = (0.2 + 2 * 0.06 + 9 * 0.06) * 2; // mm³: the corners, the grips, the slots and the notch of the lid
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
  // of the file with what they hold, the courtyard and the text among them. (`byKind` in the order
  // the report gives its keys, line, arc, circle, spline: `same` compares JSON; corrected after the
  // implementation here and in the three other checks of `byKind`.)
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

// ================================================================ a revised file and the rule of an update

// A constraint on an entity of the outline (an own point on the centre of the fourth hole). A file
// without that hole: the update is refused, naming the constraint; with the constraint removed in
// the same batch it is accepted. A later sketch that projects the hole keeps it at its last place
// with `brokenProjection`: a reference to what was removed is valid in a document. An ID that
// stays may not change its kind (6a's rule, as for an edge).
export function updateRule(): boolean {
  const { curves } = boardFile(60);
  run(sketch('ruleSk', XY), outline('ruleSk', 'o', { type: 'outline', curves, anchor: 'center' }), pt('ruleSk', 'p', 5, 5), constrain('ruleSk', 'k', { type: 'coincident', a: 'p', b: 'o/c4/center' }));
  run(sketch('laterSk', XY), project('laterSk', 'x1', 'ruleSk', 'o/c4', 'circle'));
  const { c4: _gone, ...fewer } = curves;
  const update: CommandAfter = { type: 'updateExternal', sketch: 'ruleSk', id: 'o', ref: { type: 'outline', curves: fewer } };
  const refusedFirst = refused(update, ENTITY_TAKEN('o', [{ entity: 'o/c4/center', constraints: ['k'] }]));
  const kind = refused({ type: 'updateExternal', sketch: 'ruleSk', id: 'o', ref: { type: 'outline', curves: { ...curves, c4: { type: 'line', a: [0, 0], b: [1, 1] } } } }, 'updateExternal');
  const state = run({ type: 'removeConstraint', sketch: 'ruleSk', id: 'k' }, update);
  const later = state.evaluation.features.laterSk;
  const loaded = engine.load(engine.save());
  // What the rule does not cover: a mirror of the same sketch about a line of the outline. The
  // update that drops the line is accepted, the mirror loses its copies with `brokenCopies`, and
  // the document loads (the review, fable 6, measured there).
  run(pt('ruleSk', 'm1', 40, 0), pt('ruleSk', 'm2', 45, 5), ln('ruleSk', 'ml', 'm1', 'm2'), { type: 'addExternal', sketch: 'ruleSk', id: 'mir', ref: { type: 'pattern', sources: ['ml'], transform: { type: 'mirror', axis: 'o/l2' } } });
  const { l2: _axis, ...noAxis } = fewer;
  const mirrored = run({ type: 'updateExternal', sketch: 'ruleSk', id: 'o', ref: { type: 'outline', curves: noAxis } });
  const lost = mirrored.evaluation.features.ruleSk;
  return refusedFirst && kind && later.status === 'warning' && later.warnings[0].code === 'brokenProjection' && near(resultOf(state, 'laterSk').points['x1/center'].x, -26.5, 1e-9) && loaded.ok && lost.status === 'warning' && lost.warnings.some((w) => w.code === 'brokenCopies') && engine.load(engine.save()).ok;
}

// The IDs follow the order of the file, not the geometry: a file whose holes are listed in another
// order gives the same IDs to other holes (measured: `c1` at (103.5, 83.5) and at (156.5, 83.5)).
// The revision says nothing came or went, and that `c1` and `c2` are where each other was (`renamed`,
// J11): what named `c1` now names the other hole, and the caller is told. A known limit all the same:
// a curve that moved and changed its place in the file at once is not found.
export function orderOfTheFile(): boolean {
  const first = boardFile(60).curves;
  // the first two CIRCLE entities swapped
  const parts = boardDxf(60).split('0\r\nCIRCLE\r\n');
  const swapped = [parts[0], parts[2], parts[1], ...parts.slice(3)].join('0\r\nCIRCLE\r\n');
  const second = read(importOutline('dxf', bytes(swapped), EDGE)).curves;
  const revision = outlineRevision(first, second);
  return revision.kept === 12 && revision.changed === 0 && revision.added.length === 0 && same(revision.renamed, [{ id: 'c1', was: 'c2' }, { id: 'c2', was: 'c1' }]) && first.c1.type === 'circle' && second.c1.type === 'circle' && first.c1.center[0] !== second.c1.center[0];
}

// ================================================================ the readers

// The weld. The board turned by 17° about the corner of its page, so that no coordinate is a round
// number, written with fewer and fewer decimals. Measured (A3): with nine decimals the ends of
// neighbours are 9e-10 mm apart, with six 9e-7, with four 9e-5, with three 9e-4, with two 7e-3.
// Without a weld the outline of the files of four decimals and fewer does not close (16 open ends,
// the four discs of the holes the only regions); with the default (0.01 mm) each closes. The end of
// a line goes onto the end of the arc beside it (8 ends moved, never an arc), so every arc keeps
// the digits of the file and its two ends on one radius, and a point is held on it and a line made
// tangent to it by the solver (A4).
export declare function skewedBoardDxf(W: number, decimals: number, skew: number): string;
export function welded(): boolean {
  const closes = (decimals: number, weld: number): { regions: number; open: number; moved: number; welded: number } => {
    const { curves, report } = read(importOutline('dxf', bytes(skewedBoardDxf(60, decimals, 17)), { ...EDGE, weld }));
    const id = `weld${decimals}_${weld === 0 ? 0 : 1}`;
    const state = run(sketch(id, XY), outline(id, 'o', { type: 'outline', curves }));
    return { regions: loopsOf(state, id).length, open: resultOf(state, id).openEnds?.count ?? 0, moved: report.moved, welded: report.welded };
  };
  const exact = closes(4, 0);
  const four = closes(4, 0.01);
  const two = closes(2, 0.01);
  // the report of a file that stays open says which ends have another end near, and how near
  const gaps = read(importOutline('dxf', bytes(skewedBoardDxf(60, 2, 17)), { ...EDGE, weld: 0.001 })).report.gaps;
  return exact.regions === 4 && exact.open === 16 && four.regions === 5 && four.open === 0 && four.welded === 8 && four.moved < 1e-4 && two.regions === 5 && two.moved < 0.01 && gaps.length === 16 && near(gaps[0].distance, 0.0031, 1e-3);
}

// The bounds of the weld (the reviews of all three rounds), on curves given to `weldOutline`
// directly. Measured, J1 to J6, K2 to K5 and L3 to L8.
export function weldBounds(): boolean {
  const line = (a: Vec2, b: Vec2): ImportedCurve => ({ type: 'line', a, b });
  const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (c: Vec2, r: number, from: number, to: number): ImportedCurve => ({ type: 'arc', center: c, start: polar(c, r, from), end: polar(c, r, to) });
  const side = (gap: number): ImportedCurve[] => [line([0, 0], [20 - gap, 0]), line([20, 0], [20, 20 - gap]), line([20, 20], [gap, 20]), line([0, 20], [0, gap])];
  const square = side(0);
  const kept = (welded: { curves: (ImportedCurve | undefined)[] }): ImportedCurve[] => welded.curves.filter((c): c is ImportedCurve => c !== undefined);
  const open = (welded: { curves: (ImportedCurve | undefined)[] }): number => openEnds(kept(welded), 0.01).open;
  // a corner of radius 0.5 drawn as 200 lines of 0.0039 mm, whose ends meet: nothing is welded
  const corner = Array.from({ length: 201 }, (_, i) => polar([19.5, 0.5], 0.5, -90 + (90 * i) / 200));
  const fine = weldOutline([line([0, 0], corner[0]), ...corner.slice(1).map((p, i) => line(corner[i], p)), line(corner[200], [20, 20]), line([20, 20], [0, 20]), line([0, 20], [0, 0])], 0.01);
  // three ends at x = 0, 0.009 and 0.018: the second goes onto the first, the third would have to
  // go 0.018 and stays, counted and listed
  const chain = weldOutline([line([-5, 0], [0, 0]), line([0.009, 0], [0.009, 5]), line([0.018, 0], [5, 0.018])], 0.01);
  // a hole written as an arc from 0° to 359.9° (its ends 0.0028 mm apart) is a circle; to 359° an
  // arc; with a chord under the join (359.99999°) a circle whatever the weld
  const hole = weldOutline([...square, arc([10, 10], 1.6, 0, 359.9)], 0.01);
  const notHole = weldOutline([...square, arc([10, 10], 1.6, 0, 359)], 0.01);
  const tiny = weldOutline([...square, arc([10, 10], 1.6, 0, 359.99999)], 0);
  // two quarter arcs of radius 10 that miss each other by 0.005: one of them (the one whose radius
  // changes less in proportion) is the circle through its new ends and its old middle (measured:
  // the arc of the file at most 0.0025 off it, its radius changed by 0.0043, named in
  // `reshapedArcs`); by 0.02 they stay apart
  const pair = weldOutline([arc([1.2345, 2.3456], 10, 0, 90), arc([1.2395, 2.3431], 10, 90, 180)], 0.01);
  const apart = weldOutline([arc([1.2345, 2.3456], 10, 0, 90), arc([1.2545, 2.3356], 10, 90, 180)], 0.01);
  // an arc gives way to another arc only: two lines that meet 0.005 from the start of an arc
  // leave the arc where it is, and the joint open (the first revision moved the arc's centre 0.0035)
  const unit = arc([0, 0], 1, 0, 90);
  const beside = weldOutline([unit, line([1.005, 0], [3, 0]), line([1.005, 0], [1.005, -2])], 0.01);
  // a square with four gaps of 0.005 and each side twice: the twins go first, then it closes
  const twins = weldOutline([...side(0.005), ...side(0.005)], 0.01);
  // a line shorter than the gaps around it is not collapsed onto a third end
  const short = weldOutline([line([-5, 0], [0, 0]), line([0.003, 0], [0.006, 0]), line([0.0135, 0], [5, 0])], 0.01);
  // the third round of reviews: a line that should start at the end of a polyline of short
  // segments goes onto that end, not onto the vertex before it (the met ends around are no crowd)
  const bend = Array.from({ length: 61 }, (_, i) => polar([0, 0], 0.0764, (90 * i) / 60));
  const poly = weldOutline([...bend.slice(1).map((p, i) => line(bend[i], p)), line([bend[60][0] - 0.006, bend[60][1]], [-5, bend[60][1]])], 0.01);
  // a gap equal to the weld closes wherever the file stands (4.86 - 4.85 is more than 0.01 in doubles)
  const equal = weldOutline([line([-5, 0], [4.85, 0]), line([4.86, 0], [9, 3])], 0.01);
  // with no weld: an arc of three quarters of a turn and a radius of 4e-7 has no extent, as its
  // circle would have none; nothing leaves the weld that the validator refuses
  const under = weldOutline([...square, arc([5, 5], 4e-7, 90, 0)], 0);
  // an arc of nearly a whole turn with a line starting between its ends stays an arc, also with 65
  // other lines starting 0.014 away (a search that is cut short proves nothing)
  const nearly: ImportedCurve = { type: 'arc', center: [-1, 0], start: [0, 0], end: polar([-1, 0], 1, -0.0573) };
  const others = Array.from({ length: 65 }, (_, i) => line([-0.0099, -0.0099], polar([-0.0099, -0.0099], 5, 181 + i)));
  const cutShort = weldOutline([...others, nearly, line([0.001, 0], [3, 0])], 0.01);
  // the bottom side a second time, the other way round, and a hole twice
  const twice = weldOutline([...square, line([20, 0], [0, 0]), { type: 'circle', center: [5, 5], radius: 1 }, { type: 'circle', center: [5, 5], radius: 1 }], 0.01);
  return (
    fine.welded === 0 &&
    fine.curves.every((c) => c !== undefined) &&
    chain.welded === 1 &&
    chain.moved <= 0.01 &&
    chain.blocked === 1 &&
    open(chain) === 4 &&
    hole.closed === 1 &&
    hole.curves[4]?.type === 'circle' &&
    notHole.curves[4]?.type === 'arc' &&
    open(notHole) === 2 &&
    tiny.curves[4]?.type === 'circle' &&
    pair.welded === 1 &&
    pair.reshaped === 1 &&
    pair.reshapedArcs.length === 1 &&
    pair.bent <= 0.01 &&
    same(poly.curves[60], line(bend[60], [-5, bend[60][1]])) &&
    poly.crowded === 0 &&
    equal.welded === 1 &&
    under.curves[4] === undefined &&
    under.dropped === 1 &&
    under.closed === 0 &&
    cutShort.curves[65]?.type === 'arc' &&
    apart.welded === 0 &&
    same(beside.curves[0], unit) &&
    beside.reshaped === 0 &&
    beside.blocked === 1 &&
    twins.duplicates === 4 &&
    twins.welded === 4 &&
    open(twins) === 0 &&
    short.dropped === 0 &&
    open(short) === 2 &&
    twice.duplicates === 2 &&
    twice.curves[4] === undefined &&
    twice.curves[6] === undefined
  );
}

// The IDs are the reader's and the weld renames nothing (the second round of reviews; measured,
// K1). A file with a hole written as an arc of nearly a whole turn, between circles and arcs:
// whatever the weld, the IDs are `l1 l2 l3 l4 a1 c1 a2 c2 a3`; with the default weld `a1` is a
// circle, with none an arc. A revision that makes the entity `o/a1` another kind is taken when no
// constraint names it, and refused, naming the entity, both kinds and the constraint, when one does.
export function idsAndTheWeld(): boolean {
  const line = (a: Vec2, b: Vec2): ImportedCurve => ({ type: 'line', a, b });
  const polar = (c: Vec2, r: number, deg: number): Vec2 => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (c: Vec2, r: number, from: number, to: number): ImportedCurve => ({ type: 'arc', center: c, start: polar(c, r, from), end: polar(c, r, to) });
  const file: ImportedCurve[] = [line([0, 0], [40, 0]), line([40, 0], [40, 40]), line([40, 40], [0, 40]), line([0, 40], [0, 0]), arc([10, 10], 1.6, 0, 359.9), { type: 'circle', center: [20, 10], radius: 1 }, arc([30, 30], 3, 0, 90), { type: 'circle', center: [10, 30], radius: 1 }, arc([30, 10], 3, 180, 300)];
  const ids = outlineIds(file);
  const named = (weld: number): Record<Id, ImportedCurve> => Object.fromEntries(weldOutline(file, weld).curves.flatMap((curve, i) => (curve ? [[ids[i], curve]] : [])));
  const [asCircle, asArc] = [named(0.01), named(0)];
  run(sketch('idSk', XY), outline('idSk', 'o', { type: 'outline', curves: asCircle, regions: false }));
  const update: CommandAfter = { type: 'updateExternal', sketch: 'idSk', id: 'o', ref: { type: 'outline', curves: asArc } };
  const free = engine.preview(update).ok;
  run(pt('idSk', 'p', 12, 12), constrain('idSk', 'k', { type: 'coincident', a: 'p', b: 'o/a1/center' }), pt('idSk', 'q', 12, 10), constrain('idSk', 'kq', { type: 'pointOnCurve', point: 'q', curve: 'o/a1' }));
  // the centre is a point of a circle and of an arc alike and may stay named; the curve changes its kind
  return same(ids, ['l1', 'l2', 'l3', 'l4', 'a1', 'c1', 'a2', 'c2', 'a3']) && same(Object.keys(asCircle), Object.keys(asArc)) && asCircle.a1.type === 'circle' && asArc.a1.type === 'arc' && outlineRevision(asCircle, asArc).changed === 1 && free && refused(update, ENTITY_KIND_CHANGED('o/a1', 'circle', 'arc', ['kq']));
}

// Polylines with bulges, both forms, read as the engine writes them (D54: POLYLINE, VERTEX and
// SEQEND of release 12; a CIRCLE for a whole circle): the section of the board read back has the
// curves of the board (each corner in two arcs, as the writer divides a quarter turn), one region
// with four holes whose area is the section's within 1e-4 mm², and, extruded 1.6 again, the volume
// of the board to the last digit (measured: 3776.383089761619 both). The engine's SVG of the same
// section read back gives the same curves under the same IDs, within 1e-9 mm (measured 3e-10).
export function ownFiles(): boolean {
  const state = engine.getState();
  const options = { plane: XY, offset: 0.8, bodies: ['pcb'] };
  const dxf = unwrap(engine.export('dxf', options)).files[0];
  const svg = unwrap(engine.export('svg', options)).files[0];
  const [a, b] = [read(importOutline('dxf', dxf.bytes)), read(importOutline('svg', svg.bytes))];
  const far = (p: Vec2, q: Vec2): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const apart = Object.keys(a.curves).every((id) => {
    const [c, d] = [a.curves[id], b.curves[id]];
    return c.type === 'arc' && d.type === 'arc' ? far(c.start, d.start) < 1e-9 && far(c.center, d.center) < 1e-9 : c.type === d.type;
  });
  const back = run(sketch('pcbBack', XY), outline('pcbBack', 'o', { type: 'outline', curves: a.curves }), extrude('pcbAgain', 'pcbBack', [Object.keys(a.curves).filter((id) => id[0] !== 'c').map((id) => `o/${id}`)], '1.6', 'new'));
  return same(a.report.byKind, { line: 4, arc: 8, circle: 4, spline: 0 }) && same(Object.keys(a.curves), Object.keys(b.curves)) && apart && b.report.about.unit === '1 mm per unit' && near(volumeOf(back, 'pcbAgain'), volumeOf(state, 'pcb'), 1e-9);
}

// Units and layers. A file in inches without `layers` is read whole and scaled; the option `unit`
// overrides the header; a header that does not say is millimetres and the report says so. A layer
// the file does not have is `empty`, and the message lists the layers it has.
export declare function inchDxf(): string; // a line and a cubic SPLINE of three spans on the layer 0, $INSUNITS 1; a rational SPLINE and an ELLIPSE
export function unitsAndLayers(): boolean {
  const inches = read(importOutline('dxf', bytes(inchDxf())));
  const asMm = read(importOutline('dxf', bytes(inchDxf()), { unit: 'mm' }));
  const none = importOutline('dxf', bytes(boardDxf(60)), { layers: ['Edge_Cuts'] });
  return (
    inches.report.about.unit === 'in' &&
    inches.report.about.unitFrom === 'file' &&
    near(inches.report.bounds.max[0], 112.35, 0.01) &&
    asMm.report.about.unitFrom === 'option' &&
    near(asMm.report.bounds.max[0], 112.35 / 25.4, 0.01) &&
    !none.ok &&
    none.error.code === 'empty' &&
    none.error.message.includes('Edge.Cuts')
  );
}

// Splines. A cubic SPLINE of three spans with even knots is one spline of the sketch over its six
// control points (6d's spline is the cubic of even, clamped knots: measured, I6b, the same curve to
// the digit), `s1`, which closes with the line into one region; extruded, it is one swept face
// named by its curve. With uneven knots it is its Bezier pieces, three splines of four control
// points (6d's `bsplineBeziers`, exactly; over the same control points a spline of the sketch would
// run 0.88 mm off). A rational spline and an ellipse are left out and counted in `skipped`. A
// spline of an outline is no operand of a constraint and is not projected (its control points
// are: `o/s1/1`, and the query lists where they stand); the whole sketch projected leaves it out
// and lists it in `splines` (6b, 6d).
export declare function unevenSplineDxf(): string; // the same file with the knots 0,0,0,0,1,3,4,4,4,4
export function splines(): boolean {
  const { curves, report } = read(importOutline('dxf', bytes(inchDxf())));
  const state = run(sketch('splSk', XY), outline('splSk', 'o', { type: 'outline', curves }));
  const body = run(extrude('splBody', 'splSk', [['o/l1', 'o/s1']], '2', 'new'));
  run(sketch('splLater', XY));
  const whole = tool('projectSketch', 'splLater', { sketch: 'splSk' }, 'w');
  const s1 = curves.s1;
  const listed = entryCurves({ sketch: 'splSk', entry: 'o', kind: 'spline' }).curves[0];
  const pieces = read(importOutline('dxf', bytes(unevenSplineDxf()))).report.byKind;
  return (
    same(report.byKind, { line: 1, arc: 0, circle: 0, spline: 1 }) &&
    same(report.about.skipped, { 'SPLINE (rational)': 1, ELLIPSE: 1 }) &&
    s1.type === 'spline' &&
    s1.points.length === 6 &&
    same(loopsOf(state, 'splSk'), [['o/l1', 'o/s1']]) &&
    resultOf(state, 'splSk').curves['o/s1'].shape.type === 'spline' &&
    body.evaluation.features.splBody.status === 'ok' &&
    listed.type === 'spline' &&
    listed.control.length === 6 &&
    !listed.closed &&
    pieces.spline === 3 &&
    refused(constrain('splSk', 'k', { type: 'pointOnCurve', point: 'origin', curve: 'o/s1' }), 'spline') &&
    refused(project('splLater', 'x', 'splSk', 'o/s1', 'line'), 'a spline is not projected') &&
    done(engine.preview(project('splLater', 'x', 'splSk', 'o/s1/1', 'point'))).evaluation.features.splLater.status === 'ok' &&
    same(whole.splines, ['o/s1']) &&
    whole.entries.length === 1
  );
}

// A closed spline of an outline (its first control point again as its last) bounds a region by
// itself and has no open end: its two ends are one place (measured before the condition in 6c's
// stage, J9: the region is there, and `openEnds` lists `o/s1/0` with the distance 0).
export function closedSpline(): boolean {
  const state = run(sketch('clSk', XY), outline('clSk', 'o', { type: 'outline', curves: { s1: { type: 'spline', points: [[0, 0], [10, -5], [20, 0], [20, 10], [10, 15], [0, 10], [0, 0]] } } }));
  return resultOf(state, 'clSk').valid && same(loopsOf(state, 'clSk'), [['o/s1']]) && resultOf(state, 'clSk').openEnds === undefined && getSketch('clSk').advice.every((text) => !text.includes('open'));
}

// Nodes without a handle, and what has no extent (the second round of reviews; measured, K8). A
// `C` whose first control point is its start, an `S` after an `L` (its first control point is the
// current point, by SVG) and a `T` after an `L` are splines with two control points at one place:
// read, accepted by the validator and placed, one region. A `Q` that returns to its start and a
// `C` whose four points are one place have no extent: left out and counted, their numbers unused.
export function handles(): boolean {
  const file = (d: string): Uint8Array => bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="${d}"/></svg>`);
  const placed = ['M10 10 C10 10 30 0 40 10 L40 30 L10 30 Z', 'M10 30 L10 10 S30 0 40 10 L40 30 Z', 'M10 30 L10 10 T40 10 L40 30 Z'].every((d, i) => {
    const { curves, report } = read(importOutline('svg', file(d)));
    const state = run(sketch(`hSk${i}`, XY), outline(`hSk${i}`, 'o', { type: 'outline', curves }));
    return report.byKind.spline === 1 && resultOf(state, `hSk${i}`).valid && loopsOf(state, `hSk${i}`).length === 1;
  });
  const flat = read(importOutline('svg', file('M10 10 L40 10 L40 30 L10 30 Z M50 50 Q60 40 50 50 M70 70 C70 70 70 70 70 70'))).report;
  return placed && flat.dropped === 2 && flat.byKind.spline === 0 && same(flat.ids.unused, ['s1', 's2']) && flat.curves === 4;
}

// A tangency at a corner of an outline. The end of the bottom line (`o/l1/b`) and the start of
// the corner arc (`o/a1/start`) are two entities at one place. An own line that starts on either
// and is tangent to the arc is the tangent at their common end: horizontal, and its far end slides
// along it. Measured before the adapter took two fixed points at one place for one end (J10): held
// on `o/a1/start` exactly so; held on `o/l1/b` the solver took the general form at its double
// root, the far end 4e-5 mm off the line and not moved by a drag.
export function cornerTangent(): boolean {
  const { curves } = boardFile(60);
  return ['o/l1/b', 'o/a1/start'].every((corner, i) => {
    const s = `tanSk${i}`;
    run(sketch(s, XY), outline(s, 'o', { type: 'outline', curves, anchor: 'center' }), pt(s, 'p', 26.5, -19.5), pt(s, 'q', 35, -19), ln(s, 'n', 'p', 'q', true), constrain(s, 'k1', { type: 'coincident', a: 'p', b: corner }), constrain(s, 'k2', { type: 'tangent', a: 'n', b: 'o/a1' }));
    const dragged = run({ type: 'dragPoint', sketch: s, point: 'q', x: 36, y: -12 });
    const diagnosis = engine.diagnoseSketch(s);
    return near(resultOf(dragged, s).points.q.y, -20, 1e-9) && near(resultOf(dragged, s).points.q.x, 36, 1e-6) && diagnosis.degreesOfFreedom === 1 && diagnosis.redundant.length === 0;
  }) && cornerArc();
}
// The same from the other side (the review, fable 9; measured, K12): an own arc that ends at the
// corner, held on the start of the corner arc (`o/a1/start`) and tangent to the line of the outline
// (`o/l1`), whose end is that place under another ID. Its centre is then straight below the corner.
function cornerArc(): boolean {
  const { curves } = boardFile(60);
  const s = 'tanSkArc';
  run(sketch(s, XY), outline(s, 'o', { type: 'outline', curves, anchor: 'center' }), pt(s, 'c', 27.3, -24.8), pt(s, 'p', 27.2, -20.1), pt(s, 'e', 32, -25.2), { type: 'addCurve', sketch: s, id: 'n', curve: { type: 'arc', center: 'c', start: 'e', end: 'p', construction: true } }, constrain(s, 'k1', { type: 'coincident', a: 'p', b: 'o/a1/start' }), constrain(s, 'k2', { type: 'tangent', a: 'o/l1', b: 'n' }));
  const dragged = run({ type: 'dragPoint', sketch: s, point: 'e', x: 33, y: -26 });
  return near(resultOf(dragged, s).points.c.x, 27, 1e-9) && engine.diagnoseSketch(s).redundant.length === 0;
}

// The subset of SVG, as a drawing program writes one: a root of 100 mm × 50 mm over a viewBox of
// 200 × 100 (0.5 mm per unit), groups with transforms (a translation; a rotation about a point and
// a scale), a rect with round corners, a circle, paths with relative commands, `C` and `Q` (a
// spline of four and of three control points), arcs with their two flags, and what is not read: an
// ellipse, an elliptical arc (its whole path), a text. Measured (E2): the layer `cut` gives 8
// lines, 6 arcs, 1 circle and 2 splines in five regions, the rounded rect (40 × 20 mm, corners of
// 3) with the disc and the lens as its holes; y points up, so the drawing is below the x axis.
export declare function drawingSvg(): string;
export function svgSubset(): boolean {
  const all = read(importOutline('svg', bytes(drawingSvg())));
  const { curves, report } = read(importOutline('svg', bytes(drawingSvg()), { layers: ['cut'] }));
  const state = run(sketch('svgSk', XY), outline('svgSk', 'o', { type: 'outline', curves }));
  const a1 = curves.a1;
  return (
    same(Object.keys(all.report.about.layers), ['cut', 'engrave']) &&
    report.about.unit === '0.5 mm per unit' &&
    same(report.byKind, { line: 8, arc: 6, circle: 1, spline: 2 }) &&
    same(report.bounds, { min: [10, -40], max: [70, -5] }) &&
    a1.type === 'arc' &&
    same(a1, { type: 'arc', center: [47, -8], start: [50, -8], end: [47, -5] }) &&
    Object.keys(report.about.skipped).length === 2 &&
    resultOf(state, 'svgSk').valid &&
    loopsOf(state, 'svgSk').length === 5 &&
    resultOf(state, 'svgSk').regions.find((region) => region.ref.outerLoop.length === 8)?.loops.length === 3
  );
}

// ================================================================ many curves

// An outline of 1000 curves (a toothed closed outline of 500 lines and 500 holes), with an own
// point held on a hole centre and another on a tooth. Measured (C1, F1): 3 ms to read and weld, 61
// ms for `addExternal`, 40 ms for a drag in the sketch while it forms regions and 7 with the flag
// off; the solver gets 7 points, not 1503. `get_sketch` lists 50 of its curves (4000 characters, not
// 79,000) and names the query for the rest, and 50 of its 501 regions; the query pages through the
// curves by kind; `get_document` leaves the curves out, for the feature alone too. 2001 curves are
// refused.
export declare function toothedDxf(curves: number): string;
export function manyCurves(): boolean {
  const { curves } = read(importOutline('dxf', bytes(toothedDxf(1000))));
  const state = run(sketch('bigSk', XY), outline('bigSk', 'o', { type: 'outline', curves }), pt('bigSk', 'p', -50, -50), pt('bigSk', 'q', 20, 60), constrain('bigSk', 'k1', { type: 'coincident', a: 'p', b: 'o/c1/center' }), constrain('bigSk', 'k2', { type: 'pointOnCurve', point: 'q', curve: 'o/l1' }));
  const detail = getSketch('bigSk').external[0] as OutlineDetail;
  const circles = entryCurves({ sketch: 'bigSk', entry: 'o', kind: 'circle', from: 450, max: 100 });
  const tooMany = importOutline('dxf', bytes(toothedDxf(2002)));
  // the input of the solver: the origin, the two own points, the centre of `c1`, the two ends of `l1`
  const solved = state.evaluation.features.bigSk.status === 'ok' && near(resultOf(state, 'bigSk').points.p.x, resultOf(state, 'bigSk').points['o/c1/center'].x, 1e-9);
  return (
    solved &&
    loopsOf(state, 'bigSk').length === 501 &&
    detail.total === 1000 &&
    detail.listed === OUTLINE_LIMITS.listed &&
    detail.curves.length === OUTLINE_LIMITS.listed &&
    detail.more !== undefined &&
    !('points' in detail.curves[0]) &&
    circles.total === 500 &&
    circles.curves.length === 50 &&
    circles.curves[0].id === 'o/c451' &&
    !tooMany.ok &&
    tooMany.error.code === 'tooLarge' &&
    // read too: 8001 curves are refused while they are read, before any weld (measured, I8: 9000
    // lines in 19 ms), and 501 splines of four control points by the limit of control points
    !importOutline('dxf', bytes(toothedDxf(8002))).ok &&
    refused({ type: 'addExternal', sketch: 'bigSk', id: 'o3', ref: { type: 'outline', curves: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`s${i + 1}`, { type: 'spline', points: [[i, 0], [i + 0.3, 1], [i + 0.6, 1], [i + 1, 0]] } as ImportedCurve])) } }, OUTLINE_REFUSALS.control('addExternal.ref', 2004)) &&
    refused({ type: 'addExternal', sketch: 'bigSk', id: 'o2', ref: { type: 'outline', curves: {} } }, OUTLINE_REFUSALS.count('addExternal.ref', 0))
  );
}

// A region of more than twenty curves, extruded from the answers of MCP alone (the second round of
// reviews: the capped rows of `get_sketch` left no way to name it). `get_sketch` prints the loop
// of the toothed outline short, with the call that gives it whole; the query `sketchRegions` asked
// for the region of one of its curves answers with the whole reference, and that reference is what
// the extrusion takes.
export function regionThroughMcp(): boolean {
  const shown = getSketch('bigSk').regions;
  const long = shown.map((row) => row.ref).find((ref): ref is Extract<ShownLoop, { count: number }> => 'count' in ref);
  const answer = mcpQuery('sketchRegions', { sketch: 'bigSk', curve: 'o/l1' });
  // the capped row names its region by its place among the regions of the sketch
  const byIndex = mcpQuery('sketchRegions', { sketch: 'bigSk', index: long?.index ?? 0, holes: true });
  const region = answer.regions[0];
  const made = mcpExecute({ type: 'addFeature', feature: { id: 'bigBody', name: 'bigBody', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'bigSk', regions: [region.ref] }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } } as Command);
  // the pages: 501 regions, twenty at a time, and a page never cut inside a loop
  const second = mcpQuery('sketchRegions', { sketch: 'bigSk', from: 20, max: 20 });
  return shown.length === SKETCH_SHOWN.regions && long !== undefined && long.count === 500 && long.first.length === SKETCH_SHOWN.loop && long.whole.includes('sketchRegions') && answer.status === 'ok' && answer.total === 1 && region.ref.outerLoop.length === 500 && region.holes === 500 && region.holeLoops === undefined && byIndex.total === 1 && same(byIndex.regions[0].ref, region.ref) && byIndex.regions[0].holeLoops?.length === 500 && made.ok && made.features?.bigBody.status === 'ok' && second.total === 501 && second.from === 20 && second.regions.length === 20;
}

// ================================================================ the tool of MCP

// `import_outline` without a sketch only reports; with one it places; with `replace` it reads the
// file with the options the entry stores (here the layer `Edge.Cuts`: no `options` are given) and
// sends the curves alone, and the answer says what stayed, came, went and was renamed. A
// replacement that would take away a constrained entity is refused whole, with the report; with
// `remove` the constraint goes in the same batch, one undo step. No answer holds the curves.
export function throughMcp(): boolean {
  const look = importOutlineTool({ path: 'board.dxf' });
  const placed = importOutlineTool({ path: 'board.dxf', options: EDGE, sketch: 'mcpSk', id: 'pcbo', anchor: 'center' });
  const again = importOutlineTool({ path: 'board-rev-b.dxf', sketch: 'mcpSk', id: 'pcbo', replace: true });
  run(pt('mcpSk', 'p', 5, 5), constrain('mcpSk', 'k', { type: 'coincident', a: 'p', b: 'pcbo/c4/center' }));
  const held = importOutlineTool({ path: 'board-three-holes.dxf', sketch: 'mcpSk', id: 'pcbo', replace: true });
  const stillThere = 'k' in sketchOf(engine.getState(), 'mcpSk').constraints;
  const released = importOutlineTool({ path: 'board-three-holes.dxf', sketch: 'mcpSk', id: 'pcbo', replace: true, remove: ['k'] });
  return (
    look.entry === undefined &&
    Object.keys(look.report.about.layers).length === 3 &&
    same(placed.entry, { sketch: 'mcpSk', id: 'pcbo' }) &&
    same(placed.report.ids, { lines: 4, arcs: 4, circles: 4, splines: 0, unused: [], unusedCount: 0, otherKind: [] }) &&
    again.revision?.kept === 12 &&
    again.report.curves === 12 &&
    same(again.report.readWith, { format: 'dxf', layers: ['Edge.Cuts'] }) &&
    held.refused !== undefined &&
    held.refused.includes('pcbo/c4/center') &&
    held.report.curves === 11 &&
    stillThere &&
    released.refused === undefined &&
    same(released.revision?.removed, ['c4']) &&
    !('k' in sketchOf(engine.getState(), 'mcpSk').constraints) &&
    !JSON.stringify(placed).includes('"curves":{')
  );
}

// ================================================================ the refusals

export function refusals(): boolean {
  const { curves } = boardFile(60);
  const add = (ref: unknown): CommandAfter => ({ type: 'addExternal', sketch: 'board', id: 'bad', ref: ref as OutlineInput });
  return (
    // the form of the entry
    refused(add({ type: 'outline' }), OUTLINE_REFUSALS.missingCurves('addExternal.ref')) &&
    refused(add({ type: 'outline', curves: { 'a/b': curves.l1 } }), OUTLINE_REFUSALS.localId('addExternal.ref', 'a/b')) &&
    // a name every object has would vanish from the record (measured, J7): `__proto__` as a key of
    // parsed JSON, `constructor`, `toString`
    ['__proto__', 'constructor', 'toString'].every((key) => refused(add({ type: 'outline', curves: JSON.parse(`{"${key}":{"type":"line","a":[0,0],"b":[10,0]}}`) }), OUTLINE_REFUSALS.localId('addExternal.ref', key))) &&
    refused(add({ type: 'outline', curves: { l1: { type: 'line', a: [0, 0], b: [0, 0] } } }), OUTLINE_REFUSALS.noLength('addExternal.ref.curves.l1')) &&
    refused(add({ type: 'outline', curves: { a1: { type: 'arc', center: [0, 0], start: [3, 0], end: [0, 3.001] } } }), 'off one radius') &&
    refused(add({ type: 'outline', curves: { l1: { type: 'line', a: ['w', 0], b: [1, 0] } } }), OUTLINE_REFUSALS.expression('addExternal.ref.curves.l1.a')) &&
    refused(add({ type: 'outline', curves, anchor: 'corner' }), 'anchor') &&
    refused(add({ type: 'outline', curves, scale: 2 }), 'scale') &&
    // what an entity of an outline may not be
    refused(constrain('board', 'kk', { type: 'coincident', a: 'pcbo/c1/center', b: 'pcbo/c2/center' }), 'only between fixed entities') &&
    refused({ type: 'addCurve', sketch: 'board', id: 'cc', curve: { type: 'line', a: 'pcbo/l1/a', b: 'origin' } }, 'pcbo/l1/a') &&
    refused({ type: 'dragPoint', sketch: 'board', point: 'pcbo/l1/a', x: 0, y: 0 }, 'pcbo/l1/a') &&
    refused({ type: 'addExternal', sketch: 'board', id: 'mm', ref: { type: 'pattern', sources: ['pcbo/c1'], transform: { type: 'mirror', axis: 'origin/y' } } }, 'pcbo/c1') &&
    refused({ type: 'addFeature', feature: { id: 'hh', name: 'hh', suppressed: false, type: 'hole', sketch: 'board', points: ['pcbo/c1/center'], shape: { type: 'plain', diameter: 2 }, extent: { type: 'throughAll', side: 'forward' }, targets: ['pcb'] } }, 'an own point') &&
    // an outline does not become a mirror, and a file that is no file of the format
    refused({ type: 'updateExternal', sketch: 'board', id: 'pcbo', ref: { type: 'pattern', sources: ['x'], transform: { type: 'mirror', axis: 'origin/y' } } } as Command, 'cannot become derived geometry') &&
    !importOutline('dxf', bytes('AutoCAD Binary DXF\r\n')).ok &&
    !importOutline('svg', bytes('<html></html>')).ok &&
    // a file cut short is not read as far as it goes (measured, I1 and S5): no EOF; a path that does
    // not end; and an unsupported entity is not a refusal
    unreadable(importOutline('dxf', bytes(boardDxf(60).replace('0\r\nEOF\r\n', '')))) &&
    unreadable(importOutline('svg', bytes('<svg><circle r="10"/><path d="M0 0 L'))) &&
    unreadable(importOutline('svg', bytes('<svg><path d="M0 0 L1 2 3"/></svg>'))) &&
    importOutline('svg', bytes('<svg><circle r="10"/><text>A</text></svg>')).ok &&
    // the second round: two roots, an attribute twice, a number that is none (S10); a polyline that
    // declares four vertices and holds three (I10)
    unreadable(importOutline('svg', bytes('<svg><circle r="10"/></svg><svg><circle r="5"/></svg>'))) &&
    unreadable(importOutline('svg', bytes('<svg><circle r="10" r="5"/></svg>'))) &&
    unreadable(importOutline('svg', bytes('<svg><circle r="1e999"/></svg>'))) &&
    unreadable(importOutline('dxf', bytes(['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n'))))
  );
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
export const cases: (() => boolean)[] = [placement, flag, mixedLoop, updateRule, orderOfTheFile, welded, weldBounds, idsAndTheWeld, ownFiles, unitsAndLayers, splines, closedSpline, handles, cornerTangent, svgSubset, manyCurves, regionThroughMcp, throughMcp, refusals];
