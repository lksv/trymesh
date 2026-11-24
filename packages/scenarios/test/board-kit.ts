// The stand-in board of validation scenario 15, step 1 (D36 6a2, D71): drawn by hand until 6f
// imports one, placed symmetric about the axes of the origin and fully determined. A module of its
// own, not a test file, so that the tests of 6c and 6b import it without registering the tests of
// scenario15.test.ts again. Its names differ from docs/d36/6a2-origin-axes/calls.ts: `board` there
// is `standInBoard` here, `OUTLINE` is `BOARD_OUTLINE`, `pcbByHand` keeps its name, and the check
// `boardDetermined` is `expectDetermined` of scenario15.test.ts.
import type { Command, Engine, EngineState, Id } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, constrain, run } from './kit';

// The board 60 × 40, corners of radius 3, holes of 3.2 at 3.5 from the edges, 1.6 thick.
const CORNERS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const; // corner i, counter-clockwise from +x +y
export const BOARD_OUTLINE = ['ba0', 'ba1', 'ba2', 'ba3', 'bl0', 'bl1', 'bl2', 'bl3'];
// A rounded rectangle W × H with corners R: its area.
const rounded = (W: number, H: number, R: number): number => W * H - (4 - Math.PI) * R * R;
// The board with its four holes: 3776.17 mm³ by hand for W = 60.
export const pcbByHand = (W: number): number => (rounded(W, 40, 3) - Math.PI * 1.6 * 1.6 * 4) * 1.6;

const PARAMETERS: [string, string][] = [
  ['boardW', '60'],
  ['boardH', '40'],
  ['boardR', '3'],
  ['holeInset', '3.5'],
  ['holeD', '3.2'],
];

export const point = (s: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
const dimension = (s: Id, id: Id, shape: object, value: number | string): Command => ({ type: 'addConstraint', sketch: s, id, constraint: { ...shape, value, driving: true } }) as Command;

// The board on XY: corner arcs `ba<i>` over `bc<i>` (centre), from `bs<i>` to `be<i>`; lines `bl<i>`
// from `be<i>` to `bs<i+1>`; holes `bh<i>` at `hc<i>`. Every point is placed by a linear
// constraint, so the sketch has one solution: the two ends of the first corner by four dimensions
// from the origin; the ends of the other corners by `symmetric` about `origin/y` and `origin/x`;
// each centre by one distance of 0 to the end of its arc (the rule of the arc gives its other
// coordinate); the first hole by two dimensions, the others by `symmetric`; one diameter and
// `equalRadius`. Extruded 1.6 into the body `pcb`.
export function standInBoard(engine: Engine): EngineState {
  const b = 'board';
  run(engine, ...PARAMETERS.map(([name, expr]): Command => ({ type: 'setParameter', name, expr })));
  const commands: Command[] = [];
  CORNERS.forEach(([sx, sy], i) => {
    const turn = (i * Math.PI) / 2;
    const s = [Math.round(Math.cos(turn)), Math.round(Math.sin(turn))];
    const e = [Math.round(Math.cos(turn + Math.PI / 2)), Math.round(Math.sin(turn + Math.PI / 2))];
    const [cx, cy] = [sx * 27, sy * 17];
    commands.push(
      point(b, `bc${i}`, cx, cy),
      point(b, `bs${i}`, cx + 3 * s[0], cy + 3 * s[1]),
      point(b, `be${i}`, cx + 3 * e[0], cy + 3 * e[1]),
      { type: 'addCurve', sketch: b, id: `ba${i}`, curve: { type: 'arc', center: `bc${i}`, start: `bs${i}`, end: `be${i}` } },
      point(b, `hc${i}`, sx * 26.5, sy * 16.5),
      { type: 'addCurve', sketch: b, id: `bh${i}`, curve: { type: 'circle', center: `hc${i}` }, radius: 1.6 },
    );
  });
  for (let i = 0; i < 4; i++) commands.push({ type: 'addCurve', sketch: b, id: `bl${i}`, curve: { type: 'line', a: `be${i}`, b: `bs${(i + 1) % 4}` } });
  commands.push(
    dimension(b, 'bw', { type: 'horizontalDistance', a: 'origin', b: 'bs0' }, 'boardW / 2'),
    dimension(b, 'bwy', { type: 'verticalDistance', a: 'origin', b: 'bs0' }, 'boardH / 2 - boardR'),
    dimension(b, 'bhx', { type: 'horizontalDistance', a: 'origin', b: 'be0' }, 'boardW / 2 - boardR'),
    dimension(b, 'bh', { type: 'verticalDistance', a: 'origin', b: 'be0' }, 'boardH / 2'),
    constrain(b, 'bsy0', { type: 'symmetric', a: 'be0', b: 'bs1', line: 'origin/y' }),
    constrain(b, 'bsy1', { type: 'symmetric', a: 'bs0', b: 'be1', line: 'origin/y' }),
    constrain(b, 'bsx0', { type: 'symmetric', a: 'be1', b: 'bs2', line: 'origin/x' }),
    constrain(b, 'bsx1', { type: 'symmetric', a: 'bs1', b: 'be2', line: 'origin/x' }),
    constrain(b, 'bsx2', { type: 'symmetric', a: 'be0', b: 'bs3', line: 'origin/x' }),
    constrain(b, 'bsx3', { type: 'symmetric', a: 'bs0', b: 'be3', line: 'origin/x' }),
    dimension(b, 'bc0x', { type: 'horizontalDistance', a: 'bc0', b: 'be0' }, 0),
    dimension(b, 'bc1y', { type: 'verticalDistance', a: 'bc1', b: 'be1' }, 0),
    dimension(b, 'bc2x', { type: 'horizontalDistance', a: 'bc2', b: 'be2' }, 0),
    dimension(b, 'bc3y', { type: 'verticalDistance', a: 'bc3', b: 'be3' }, 0),
    dimension(b, 'hw', { type: 'horizontalDistance', a: 'origin', b: 'hc0' }, 'boardW / 2 - holeInset'),
    dimension(b, 'hh', { type: 'verticalDistance', a: 'origin', b: 'hc0' }, 'boardH / 2 - holeInset'),
    constrain(b, 'hsy', { type: 'symmetric', a: 'hc0', b: 'hc1', line: 'origin/y' }),
    constrain(b, 'hsx0', { type: 'symmetric', a: 'hc0', b: 'hc3', line: 'origin/x' }),
    constrain(b, 'hsx1', { type: 'symmetric', a: 'hc1', b: 'hc2', line: 'origin/x' }),
    dimension(b, 'hd', { type: 'diameter', curve: 'bh0' }, 'holeD'),
    constrain(b, 'he1', { type: 'equalRadius', a: 'bh0', b: 'bh1' }),
    constrain(b, 'he2', { type: 'equalRadius', a: 'bh0', b: 'bh2' }),
    constrain(b, 'he3', { type: 'equalRadius', a: 'bh0', b: 'bh3' }),
  );
  run(engine, addSketch(b, XY), batch(...commands));
  return run(engine, addExtrude('pcb', b, [BOARD_OUTLINE], 1.6));
}
