// Geometrie skici pro vykreslení a test zásahu: polohy z výsledku přepočtu, tvar křivek, měření.
// Čisté funkce bez závislosti na prohlížeči.
import { type Constraint, type DimensionShape, type Id, type SketchFeature, type SketchResult, type SketchToolContext, type Vec2, constraintOperands } from '@trymesh/engine';

export const ORIGIN = 'origin';
const TAU = 2 * Math.PI;

export type Shape =
  | { type: 'line'; a: Vec2; b: Vec2 }
  | { type: 'circle'; center: Vec2; radius: number }
  | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number }; // proti směru hodin

export interface PointView {
  id: Id;
  at: Vec2;
  own: boolean; // false = počátek nebo bod promítnuté geometrie
}
export interface CurveView {
  id: Id;
  own: boolean; // false = promítnutá hrana
  construction: boolean;
  shape: Shape;
  points: Id[]; // určující body: konce úsečky; střed kružnice; střed, začátek a konec oblouku
}
export interface SketchView {
  points: Map<Id, PointView>;
  curves: Map<Id, CurveView>;
  source: SketchToolContext; // the sketch and the solved state the view was made of, for the sketch tools of the engine
}
export type EntityKind = 'point' | 'line' | 'circle' | 'arc';

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

export function sketchView(feature: SketchFeature, result: SketchResult): SketchView {
  const points = new Map<Id, PointView>();
  const curves = new Map<Id, CurveView>();
  const at = (id: Id): Vec2 | undefined => {
    const p = result.points[id] ?? (id === ORIGIN ? { x: 0, y: 0 } : feature.points[id]);
    return p ? [p.x, p.y] : undefined;
  };
  points.set(ORIGIN, { id: ORIGIN, at: [0, 0], own: false });
  for (const id of Object.keys(feature.points)) points.set(id, { id, at: at(id) as Vec2, own: true });

  for (const [id, curve] of Object.entries(feature.curves)) {
    const construction = curve.construction === true;
    if (curve.type === 'line') {
      curves.set(id, { id, own: true, construction, points: [curve.a, curve.b], shape: { type: 'line', a: at(curve.a) as Vec2, b: at(curve.b) as Vec2 } });
    } else if (curve.type === 'circle') {
      curves.set(id, { id, own: true, construction, points: [curve.center], shape: { type: 'circle', center: at(curve.center) as Vec2, radius: result.radii[id] ?? feature.radii[id] } });
    } else {
      const [center, start, end] = [at(curve.center) as Vec2, at(curve.start) as Vec2, at(curve.end) as Vec2];
      const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
      const sweep = positive(Math.atan2(end[1] - center[1], end[0] - center[0]) - from) || TAU;
      curves.set(id, { id, own: true, construction, points: [curve.center, curve.start, curve.end], shape: { type: 'arc', center, radius: dist(center, start), from, sweep } });
    }
  }
  // Promítnutá geometrie: jen ta, pro kterou přepočet má hodnoty.
  for (const [id, ref] of Object.entries(feature.external)) {
    if (ref.kind === 'line') {
      const [a, b] = [at(`${id}/a`), at(`${id}/b`)];
      if (!a || !b) continue;
      points.set(`${id}/a`, { id: `${id}/a`, at: a, own: false });
      points.set(`${id}/b`, { id: `${id}/b`, at: b, own: false });
      curves.set(id, { id, own: false, construction: false, points: [`${id}/a`, `${id}/b`], shape: { type: 'line', a, b } });
    } else {
      const center = at(`${id}/center`);
      const radius = result.radii[id];
      if (!center || radius === undefined) continue;
      points.set(`${id}/center`, { id: `${id}/center`, at: center, own: false });
      curves.set(id, { id, own: false, construction: false, points: [`${id}/center`], shape: { type: 'circle', center, radius } });
    }
  }
  return { points, curves, source: { sketch: feature, result } };
}

export const kindOf = (view: SketchView, id: Id): EntityKind | undefined => (view.points.has(id) ? 'point' : view.curves.get(id)?.shape.type);

// Lomená čára křivky; kružnice je uzavřená (poslední bod = první).
export function polyline(shape: Shape): Vec2[] {
  if (shape.type === 'line') return [shape.a, shape.b];
  const [from, sweep] = shape.type === 'circle' ? [0, TAU] : [shape.from, shape.sweep];
  const count = Math.max(8, Math.ceil(sweep / (Math.PI / 48)));
  const out: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = from + (sweep * i) / count;
    out.push([shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)]);
  }
  return out;
}

// Nejbližší bod křivky k bodu p.
export function closestOn(shape: Shape, p: Vec2): Vec2 {
  if (shape.type === 'line') {
    const [dx, dy] = [shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]];
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - shape.a[0]) * dx + (p[1] - shape.a[1]) * dy) / length2));
    return [shape.a[0] + t * dx, shape.a[1] + t * dy];
  }
  const { center, radius } = shape;
  let angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
  if (shape.type === 'arc') {
    const along = positive(angle - shape.from);
    // mimo oblouk: bližší z koncových bodů
    if (along > shape.sweep) angle = along - shape.sweep < TAU - along ? shape.from + shape.sweep : shape.from;
  }
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
}

export const distanceTo = (shape: Shape, p: Vec2): number => dist(closestOn(shape, p), p);

// Nejbližší bod skici do vzdálenosti `reach`; při shodě má přednost vlastní bod.
export function hitPoint(view: SketchView, p: Vec2, reach: number, skip?: (id: Id) => boolean): PointView | undefined {
  let best: PointView | undefined;
  let bestDistance = reach;
  for (const point of view.points.values()) {
    if (skip?.(point.id)) continue;
    const d = dist(point.at, p);
    if (d > reach) continue;
    if (!best || d < bestDistance || (d === bestDistance && point.own && !best.own)) {
      best = point;
      bestDistance = d;
    }
  }
  return best;
}

export function hitCurve(view: SketchView, p: Vec2, reach: number, skip?: (id: Id) => boolean): CurveView | undefined {
  let best: CurveView | undefined;
  let bestDistance = reach;
  for (const curve of view.curves.values()) {
    if (skip?.(curve.id)) continue;
    const d = distanceTo(curve.shape, p);
    if (d <= bestDistance && (d < bestDistance || !best)) {
      best = curve;
      bestDistance = d;
    }
  }
  return best;
}

const endpoints = (view: SketchView, line: Id): [Vec2, Vec2] | undefined => {
  const shape = view.curves.get(line)?.shape;
  return shape?.type === 'line' ? [shape.a, shape.b] : undefined;
};

// Současná hodnota kóty podle poloh ve skice (stejné konvence jako engine); undefined = operand chybí.
export function measure(shape: DimensionShape, view: SketchView): number | undefined {
  const point = (id: Id) => view.points.get(id)?.at;
  switch (shape.type) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance': {
      const [a, b] = [point(shape.a), point(shape.b)];
      if (!a || !b) return undefined;
      return shape.type === 'distance' ? dist(a, b) : shape.type === 'horizontalDistance' ? b[0] - a[0] : b[1] - a[1];
    }
    case 'distancePointLine': {
      const [p, ends] = [point(shape.point), endpoints(view, shape.line)];
      if (!p || !ends) return undefined;
      const [a, b] = ends;
      const length = dist(a, b);
      return length === 0 ? dist(a, p) : Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / length;
    }
    case 'angle': {
      const [first, second] = [endpoints(view, shape.a), endpoints(view, shape.b)];
      if (!first || !second) return undefined;
      const direction = ([a, b]: [Vec2, Vec2]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
      const angle = positive(direction(second) - direction(first));
      return angle > Math.PI ? angle - TAU : angle; // (−π, π]
    }
    case 'radius':
    case 'diameter': {
      const curve = view.curves.get(shape.curve)?.shape;
      if (!curve || curve.type === 'line') return undefined;
      return shape.type === 'radius' ? curve.radius : 2 * curve.radius;
    }
  }
}

// Operandy vazby (ID entit skici), podle katalogu enginu.
export const operandsOf = constraintOperands;

// Místo pro popisek vazby: střed mezi operandy; u kružnice bod na obvodu.
export function anchorOf(c: Constraint, view: SketchView): Vec2 | undefined {
  const spots: Vec2[] = [];
  for (const id of operandsOf(c)) {
    const point = view.points.get(id);
    const shape = view.curves.get(id)?.shape;
    if (point) spots.push(point.at);
    else if (shape?.type === 'line') spots.push([(shape.a[0] + shape.b[0]) / 2, (shape.a[1] + shape.b[1]) / 2]);
    else if (shape) {
      const angle = shape.type === 'arc' ? shape.from + shape.sweep / 2 : Math.PI / 4;
      spots.push([shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)]);
    } else return undefined;
  }
  if (spots.length === 0) return undefined;
  return [spots.reduce((sum, s) => sum + s[0], 0) / spots.length, spots.reduce((sum, s) => sum + s[1], 0) / spots.length];
}

// Leží bod uvnitř smyčky (dvojice souřadnic za sebou)?
export function insideLoop(loop: ArrayLike<number>, p: Vec2): boolean {
  let inside = false;
  const count = loop.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const [xi, yi, xj, yj] = [loop[2 * i], loop[2 * i + 1], loop[2 * j], loop[2 * j + 1]];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
