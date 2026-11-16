// The outline of a plane as DXF and SVG (D54) against the real adapters: the three shapes the
// design made to stress the arcs (a flat on a shaft, a slot, two discs that overlap), read back
// from the DXF the engine writes and measured against the exact lines and circles; and the known
// limit in a notch between two round faces, pinned by its number.
import type { Engine, Id, Vec2 } from '@trymesh/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { XY, addExtrude, addSketch, circle, expectAllOk, newEngine, rectLoop, rectangle, run } from './kit';

const CHORD_TOLERANCE = 0.01; // of the document, by default

// What a reader of the DXF holds: the corners of every closed polyline with the bulge of each
// piece, and the circles.
interface Drawing {
  polylines: { at: Vec2; bulge: number }[][];
  circles: { center: Vec2; radius: number }[];
}
function readDxf(text: string): Drawing {
  const lines = text.split('\r\n');
  const groups: [string, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) groups.push([lines[i], lines[i + 1]]);
  const drawing: Drawing = { polylines: [], circles: [] };
  let entity: Record<string, string> | undefined;
  const flush = (): void => {
    if (!entity) return;
    if (entity.type === 'CIRCLE') drawing.circles.push({ center: [Number(entity['10']), Number(entity['20'])], radius: Number(entity['40']) });
    if (entity.type === 'POLYLINE') drawing.polylines.push([]);
    if (entity.type === 'VERTEX') drawing.polylines[drawing.polylines.length - 1].push({ at: [Number(entity['10']), Number(entity['20'])], bulge: Number(entity['42'] ?? 0) });
  };
  for (const [code, value] of groups) {
    if (code === '0') {
      flush();
      entity = { type: value };
    } else if (entity) entity[code] = value;
  }
  flush();
  return drawing;
}
// Points along every piece of every polyline, as a reader draws it from the corners and bulges.
function pointsOf(drawing: Drawing, steps = 100): Vec2[] {
  const points: Vec2[] = [];
  for (const polyline of drawing.polylines)
    polyline.forEach(({ at, bulge }, i) => {
      const next = polyline[(i + 1) % polyline.length].at;
      if (bulge === 0) {
        for (let k = 0; k <= steps; k++) points.push([at[0] + ((next[0] - at[0]) * k) / steps, at[1] + ((next[1] - at[1]) * k) / steps]);
        return;
      }
      const turn = 4 * Math.atan(bulge);
      const chord = Math.hypot(next[0] - at[0], next[1] - at[1]);
      const radius = chord / (2 * Math.sin(Math.abs(turn) / 2));
      const apothem = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
      const side = Math.sign(bulge);
      const center: Vec2 = [(at[0] + next[0]) / 2 - (side * (next[1] - at[1]) * apothem) / chord, (at[1] + next[1]) / 2 + (side * (next[0] - at[0]) * apothem) / chord];
      const from = Math.atan2(at[1] - center[1], at[0] - center[0]);
      for (let k = 0; k <= steps; k++) points.push([center[0] + radius * Math.cos(from + (turn * k) / steps), center[1] + radius * Math.sin(from + (turn * k) / steps)]);
    });
  for (const { center, radius } of drawing.circles) for (let k = 0; k < 4 * steps; k++) points.push([center[0] + radius * Math.cos((k * Math.PI) / (2 * steps)), center[1] + radius * Math.sin((k * Math.PI) / (2 * steps))]);
  return points;
}
type Exact = { line: [Vec2, Vec2] } | { circle: [Vec2, number] };
const fromExact = (p: Vec2, exact: Exact): number => {
  if ('circle' in exact) return Math.abs(Math.hypot(p[0] - exact.circle[0][0], p[1] - exact.circle[0][1]) - exact.circle[1]);
  const [a, b] = exact.line;
  return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
};
// The furthest any drawn point is from the nearest whole line or circle of the exact shape.
const furthest = (drawing: Drawing, exact: Exact[]): number => Math.max(...pointsOf(drawing).map((p) => Math.min(...exact.map((one) => fromExact(p, one)))));

const dxfOf = (engine: Engine, body: Id, offset: number): Drawing => {
  const answer = engine.export('dxf', { plane: XY, offset, bodies: [body] });
  if (!answer.ok) throw new Error(answer.error.message);
  return readDxf(new TextDecoder().decode(answer.result.files[0].bytes));
};

describe('the outline of the shapes made to stress the arcs, read back from the DXF', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    expectAllOk(
      run(
        engine,
        // a shaft of radius 10 with a flat 0.1 deep
        addSketch('S', XY),
        circle('S', 'shaft', 0, 0, 10),
        addExtrude('SHAFT', 'S', [['shaft']], 20),
        addSketch('F', XY),
        rectangle('F', 'f', 9.9, -20, 10, 40, null),
        addExtrude('FLAT', 'F', [rectLoop('f')], 20, 'cut', 'SHAFT'),
        // a slot: a rectangle 30 × 10 with a disc of radius 5 on each end
        addSketch('R', XY),
        rectangle('R', 's', 50, -5, 30, 10, null),
        addExtrude('SLOT', 'R', [rectLoop('s')], 5),
        addSketch('K', XY),
        circle('K', 'ka', 50, 0, 5),
        circle('K', 'kb', 80, 0, 5),
        addExtrude('SLOTA', 'K', [['ka']], 5, 'add', 'SLOT'),
        addExtrude('SLOTB', 'K', [['kb']], 5, 'add', 'SLOT'),
        // two discs of radius 8 whose centres are 10 apart
        addSketch('D', XY),
        circle('D', 'da', 120, 0, 8),
        addExtrude('LENS', 'D', [['da']], 5),
        addSketch('E', XY),
        circle('E', 'db', 130, 0, 8),
        addExtrude('LENSB', 'E', [['db']], 5, 'add', 'LENS'),
      ),
    );
  });

  it('the shaft with a flat: every piece within the chord tolerance; the flat drawn between the corners of the mesh', () => {
    const drawing = dxfOf(engine, 'SHAFT', 10);
    expect(drawing.circles).toEqual([]);
    expect(drawing.polylines.length).toBe(1);
    expect(furthest(drawing, [{ circle: [[0, 0], 10] }, { line: [[9.9, 0], [9.9, 1]] }])).toBeLessThan(CHORD_TOLERANCE);
    // the arc of almost a whole turn is four pieces; the flat ends where the mesh has its corners
    expect(drawing.polylines[0].filter((vertex) => vertex.bulge !== 0).length).toBe(4);
    const flat = drawing.polylines[0].filter((vertex) => Math.abs(vertex.at[0] - 9.9) < 1e-6).map((vertex) => vertex.at[1]);
    expect(flat.length).toBe(2);
    expect(Math.max(...flat) - Math.min(...flat)).toBeCloseTo(2.679, 3); // 2.821 in the exact shape (a known limit)
  });

  it('the slot: two half turns in two pieces each, every piece within the chord tolerance', () => {
    const drawing = dxfOf(engine, 'SLOT', 2);
    expect(drawing.polylines.length).toBe(1);
    const bulges = drawing.polylines[0].filter((vertex) => vertex.bulge !== 0);
    expect(bulges.length).toBe(4);
    expect(furthest(drawing, [{ line: [[50, -5], [80, -5]] }, { line: [[50, 5], [80, 5]] }, { circle: [[50, 0], 5] }, { circle: [[80, 0], 5] }])).toBeLessThan(CHORD_TOLERANCE);
  });

  it('two discs that overlap: every piece within the chord tolerance', () => {
    const drawing = dxfOf(engine, 'LENS', 2);
    expect(drawing.polylines.length).toBe(1);
    expect(furthest(drawing, [{ circle: [[120, 0], 8] }, { circle: [[130, 0], 8] }])).toBeLessThan(CHORD_TOLERANCE);
  });

  it('the SVG of the same cut states the radius a bulge of the DXF implies', () => {
    const answer = engine.export('svg', { plane: XY, offset: 2, bodies: ['SLOT'] });
    if (!answer.ok) throw new Error(answer.error.message);
    const radii = [...new TextDecoder().decode(answer.result.files[0].bytes).matchAll(/A ([\d.]+) /g)].map((match) => Number(match[1]));
    const drawing = dxfOf(engine, 'SLOT', 2);
    const implied = drawing.polylines[0].flatMap(({ at, bulge }, i, all) => {
      if (bulge === 0) return [];
      const next = all[(i + 1) % all.length].at;
      return [(Math.hypot(next[0] - at[0], next[1] - at[1]) * (1 + bulge * bulge)) / (4 * Math.abs(bulge))];
    });
    expect(radii).toEqual([5, 5, 5, 5]);
    expect(implied.length).toBe(4);
    for (const radius of implied) expect(Math.abs(radius - 5)).toBeLessThan(1e-8);
  });
});

describe('a known limit: the corner in a notch between two round faces', () => {
  it('two discs of radius 8 with their centres 12 apart: the drawing is 0.0113 from the exact outline at the corner of the notch', () => {
    const [r, d] = [8, 12];
    const engine = newEngine();
    expectAllOk(run(engine, addSketch('D', XY), circle('D', 'da', 0, 0, r), addExtrude('A', 'D', [['da']], 5), addSketch('E', XY), circle('E', 'db', d, 0, r), addExtrude('B', 'E', [['db']], 5, 'add', 'A')));
    const drawing = dxfOf(engine, 'A', 2);
    // the exact outline: the arcs of each circle outside the other, which meet at the crossings
    const centers: Vec2[] = [[0, 0], [d, 0]];
    const crossings: Vec2[] = [[d / 2, Math.sqrt(r * r - (d * d) / 4)], [d / 2, -Math.sqrt(r * r - (d * d) / 4)]];
    const fromOutline = (p: Vec2): number =>
      Math.min(
        ...centers.map((center, i) => {
          const away = Math.hypot(p[0] - center[0], p[1] - center[1]);
          const nearest: Vec2 = [center[0] + (r * (p[0] - center[0])) / away, center[1] + (r * (p[1] - center[1])) / away];
          const other = centers[1 - i];
          // the nearest point of this circle, when it is on the outline; else an end of the arc
          return Math.hypot(nearest[0] - other[0], nearest[1] - other[1]) >= r ? Math.abs(away - r) : Math.min(...crossings.map((crossing) => Math.hypot(p[0] - crossing[0], p[1] - crossing[1])));
        }),
      );
    const worst = Math.max(...pointsOf(drawing).map(fromOutline));
    expect(worst).toBeGreaterThan(CHORD_TOLERANCE); // it leaves the tolerance, by its corner
    expect(worst).toBeCloseTo(0.0113, 4);
  });
});
