// Files of outlines written by the tests of the import (D72), without adapters: the engine's tests
// and the scenarios (through board-kit.ts) read the same board.

// A board outline as a PCB tool writes it: separate LINE and ARC entities on the layer Edge.Cuts,
// the holes as CIRCLE entities, in page coordinates, a courtyard and a text on other layers.
// `digits`: the decimals of every number; `skew` (degrees) turns the whole board about the corner of
// the page, so that no coordinate is a round number.
export function boardDxf(W: number, H = 40, R = 3, digits = 6, skew = 0): string {
  const lines: string[] = [];
  const g = (code: number, value: string | number): void => void lines.push(String(code), typeof value === 'number' ? value.toFixed(digits) : value);
  const [x0, y0] = [100, 80];
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
  const ln = (ax: number, ay: number, bx: number, by: number, layer = 'Edge.Cuts'): void => {
    g(0, 'LINE');
    g(8, layer);
    g(10, px(ax, ay));
    g(20, py(ax, ay));
    g(11, px(bx, by));
    g(21, py(bx, by));
  };
  const ar = (cx: number, cy: number, from: number, to: number): void => {
    g(0, 'ARC');
    g(8, 'Edge.Cuts');
    g(10, px(cx, cy));
    g(20, py(cx, cy));
    g(40, R);
    g(50, (from + skew) % 360);
    g(51, (to + skew) % 360);
  };
  ln(R, 0, W - R, 0);
  ar(W - R, R, 270, 0);
  ln(W, R, W, H - R);
  ar(W - R, H - R, 0, 90);
  ln(W - R, H, R, H);
  ar(R, H - R, 90, 180);
  ln(0, H - R, 0, R);
  ar(R, R, 180, 270);
  for (const [hx, hy] of [[3.5, 3.5], [W - 3.5, 3.5], [W - 3.5, H - 3.5], [3.5, H - 3.5]]) {
    g(0, 'CIRCLE');
    g(8, 'Edge.Cuts');
    g(10, px(hx, hy));
    g(20, py(hx, hy));
    g(40, 1.6);
  }
  ln(10, 10, 20, 10, 'F.CrtYd');
  ln(20, 10, 20, 20, 'F.CrtYd');
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
