// Geometrie skici pro vykreslení a test zásahu: polohy z výsledku přepočtu, tvar křivek, měření.
// Čisté funkce bez závislosti na prohlížeči.
import { type Constraint, type CurveShape, type DimensionShape, type Id, type SketchFeature, type SketchResult, type SketchToolContext, type Vec2, constraintOperands, curvePoints, referenceEntities } from '@trymesh/engine';

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
export type EntityKind = 'point' | Shape['type'];

// The end of a switch over the kinds of a curve (D64): a kind added to `Shape` or to the curves of
// the engine does not compile until the switch has its case. At run time it throws, which a sketch
// the engine validated never reaches.
export function unreachable(value: never, what: string): never {
  throw new Error(`${what}: unexpected ${JSON.stringify(value)}`);
}

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

  // the shape of a curve over the positions of its points (the radius of a circle given)
  const shapeOf = (curve: CurveShape, radius: number): Shape => {
    switch (curve.type) {
      case 'line':
        return { type: 'line', a: at(curve.a) as Vec2, b: at(curve.b) as Vec2 };
      case 'circle':
        return { type: 'circle', center: at(curve.center) as Vec2, radius };
      case 'arc': {
        const [center, start, end] = [at(curve.center) as Vec2, at(curve.start) as Vec2, at(curve.end) as Vec2];
        const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const sweep = positive(Math.atan2(end[1] - center[1], end[0] - center[0]) - from) || TAU;
        return { type: 'arc', center, radius: dist(center, start), from, sweep };
      }
      default:
        return unreachable(curve, 'curve');
    }
  };
  for (const [id, curve] of Object.entries(feature.curves)) {
    curves.set(id, { id, own: true, construction: curve.construction === true, points: curvePoints(curve), shape: shapeOf(curve, result.radii[id] ?? feature.radii[id]) });
  }
  // The entries of `external` (projected geometry): their points with a position and their curves
  // the result has, in the order of the document and of the kind of each entry.
  for (const entry of Object.keys(feature.external)) {
    const entities = Object.entries(referenceEntities(feature, entry));
    for (const [id, kind] of entities) {
      const p = kind === 'point' ? at(id) : undefined;
      if (p) points.set(id, { id, at: p, own: false });
    }
    for (const [id, kind] of entities) {
      const curve = kind === 'point' ? undefined : result.curves[id];
      if (curve) curves.set(id, { id, own: false, construction: false, points: curvePoints(curve.shape), shape: shapeOf(curve.shape, result.radii[id]) });
    }
  }
  return { points, curves, source: { sketch: feature, result } };
}

export const kindOf = (view: SketchView, id: Id): EntityKind | undefined => (view.points.has(id) ? 'point' : view.curves.get(id)?.shape.type);

// Lomená čára křivky; kružnice je uzavřená (poslední bod = první).
export function polyline(shape: Shape): Vec2[] {
  let [from, sweep] = [0, TAU];
  switch (shape.type) {
    case 'line':
      return [shape.a, shape.b];
    case 'circle':
      break;
    case 'arc':
      [from, sweep] = [shape.from, shape.sweep];
      break;
    default:
      return unreachable(shape, 'shape');
  }
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
  switch (shape.type) {
    case 'line': {
      const [dx, dy] = [shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]];
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - shape.a[0]) * dx + (p[1] - shape.a[1]) * dy) / length2));
      return [shape.a[0] + t * dx, shape.a[1] + t * dy];
    }
    case 'circle': {
      const { center, radius } = shape;
      const angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    case 'arc': {
      const { center, radius } = shape;
      let angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      const along = positive(angle - shape.from);
      // mimo oblouk: bližší z koncových bodů
      if (along > shape.sweep) angle = along - shape.sweep < TAU - along ? shape.from + shape.sweep : shape.from;
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    default:
      return unreachable(shape, 'shape');
  }
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
      if (!curve) return undefined;
      switch (curve.type) {
        case 'line':
          return undefined;
        case 'circle':
        case 'arc':
          return shape.type === 'radius' ? curve.radius : 2 * curve.radius;
        default:
          return unreachable(curve, 'shape');
      }
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
    else if (!shape) return undefined;
    else {
      switch (shape.type) {
        case 'line':
          spots.push([(shape.a[0] + shape.b[0]) / 2, (shape.a[1] + shape.b[1]) / 2]);
          break;
        case 'circle':
        case 'arc': {
          const angle = shape.type === 'arc' ? shape.from + shape.sweep / 2 : Math.PI / 4;
          spots.push([shape.center[0] + shape.radius * Math.cos(angle), shape.center[1] + shape.radius * Math.sin(angle)]);
          break;
        }
        default:
          unreachable(shape, 'shape');
      }
    }
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
