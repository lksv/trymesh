// What the probes of 6f share: readers of a state, the engine's DXF of a section, and a board file
// written as a PCB tool writes one.
import type { Command, Engine, EngineState, Id, SketchResult } from '../../../../packages/engine/src/index';
import { XY } from '../../../../packages/scenarios/test/kit';

export const resultOf = (state: EngineState, id: Id): SketchResult => state.evaluation.features[id].sketch as SketchResult;
export const loopArea = (loop: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 2) {
    const j = (i + 2) % loop.length;
    sum += loop[i] * loop[j + 1] - loop[j] * loop[i + 1];
  }
  return sum / 2;
};
// the area of the regions of a sketch: outer loops less their holes
export const regionArea = (state: EngineState, sketch: Id): number => resultOf(state, sketch).regions.reduce((sum, region) => sum + region.loops.reduce((part, loop, i) => part + (i === 0 ? 1 : -1) * Math.abs(loopArea(loop)), 0), 0);
export const dxfOf = (engine: Engine, body: Id, offset: number): { text: string; about: { area: number; loops: number; circles: number } } => {
  const exported = engine.export('dxf', { plane: XY, offset, bodies: [body] });
  if (!exported.ok) throw new Error(exported.error.message);
  const file = (exported.result as { files: { bytes: Uint8Array; about?: unknown }[] }).files[0];
  return { text: new TextDecoder().decode(file.bytes), about: file.about as { area: number; loops: number; circles: number } };
};
export const addOutline = (sketch: Id, id: Id, ref: object): Command => ({ type: 'addExternal', sketch, id, ref }) as unknown as Command;

// A board outline as a PCB tool writes it: separate LINE and ARC entities on the layer Edge.Cuts,
// the holes as CIRCLE entities, in page coordinates (the corner of the board at (100, 80), y up
// here), and a few entities on other layers. `digits`: the decimals of every number.
// `skew` (degrees) turns the whole board about the corner of the page, so that no coordinate is a round number.
export function boardDxf(W: number, H: number, R: number, digits = 6, skew = 0, holes: [number, number][] = [[3.5, 3.5], [W - 3.5, 3.5], [W - 3.5, H - 3.5], [3.5, H - 3.5]], at: [number, number] = [100, 80]): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number): void => void lines.push(String(code), typeof value === 'number' ? value.toFixed(digits) : value);
  const [x0, y0] = at;
  const [co, si] = [Math.cos((skew * Math.PI) / 180), Math.sin((skew * Math.PI) / 180)];
  const px = (x: number, y: number): number => co * (x0 + x) - si * (y0 + y);
  const py = (x: number, y: number): number => si * (x0 + x) + co * (y0 + y);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$INSUNITS');
  lines.push('70', '4');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const line = (ax: number, ay: number, bx: number, by: number, layer = 'Edge.Cuts'): void => {
    g(0, 'LINE');
    g(8, layer);
    g(10, px(ax, ay));
    g(20, py(ax, ay));
    g(11, px(bx, by));
    g(21, py(bx, by));
  };
  const arc = (cx: number, cy: number, from: number, to: number): void => {
    g(0, 'ARC');
    g(8, 'Edge.Cuts');
    g(10, px(cx, cy));
    g(20, py(cx, cy));
    g(40, R);
    g(50, (from + skew) % 360);
    g(51, (to + skew) % 360);
  };
  line(R, 0, W - R, 0);
  arc(W - R, R, 270, 0);
  line(W, R, W, H - R);
  arc(W - R, H - R, 0, 90);
  line(W - R, H, R, H);
  arc(R, H - R, 90, 180);
  line(0, H - R, 0, R);
  arc(R, R, 180, 270);
  for (const [hx, hy] of holes) {
    g(0, 'CIRCLE');
    g(8, 'Edge.Cuts');
    g(10, px(hx, hy));
    g(20, py(hx, hy));
    g(40, 1.6);
  }
  // what a board file also holds: a courtyard on another layer, a text
  line(10, 10, 20, 10, 'F.CrtYd');
  line(20, 10, 20, 20, 'F.CrtYd');
  g(0, 'TEXT');
  g(8, 'F.SilkS');
  g(10, px(5, 5));
  g(20, py(5, 5));
  g(40, 1);
  g(1, 'REV A');
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

// A DXF of `n` entities as separate LINE and CIRCLE entities: a gear-like closed outline of n/2
// lines (the radius alternating between 90 and 100) and n/2 holes of radius 0.4 on a grid inside it.
export function bigDxf(n: number): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number): void => void lines.push(String(code), typeof value === 'number' ? value.toFixed(6) : value);
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const teeth = n / 2;
  const at = (i: number): [number, number] => {
    const r = i % 2 ? 100 : 90;
    const a = (2 * Math.PI * (i % teeth)) / teeth;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  for (let i = 0; i < teeth; i++) {
    const [p, q] = [at(i), at(i + 1)];
    g(0, 'LINE');
    g(8, 'CUT');
    g(10, p[0]);
    g(20, p[1]);
    g(11, q[0]);
    g(21, q[1]);
  }
  const side = Math.ceil(Math.sqrt(teeth));
  for (let i = 0; i < teeth; i++) {
    g(0, 'CIRCLE');
    g(8, 'CUT');
    g(10, -55 + (110 * (i % side)) / side);
    g(20, -55 + (110 * Math.floor(i / side)) / side);
    g(40, 0.4);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${lines.join('\r\n')}\r\n`;
}

