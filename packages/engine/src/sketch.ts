// Skica: vstup solveru a razítko, referenční kóty, detekce profilů a oblastí.
// Pravidla jsou v docs/architecture.md, sekce Skica, Řešení skici a Profily a oblasti.
import { constraintOperands, derivedPoints, isDimension } from './sketch-content';
import type { Constraint, Curve, Id, Point2, Projected, RegionRef, SketchFeature, SolveInput, Vec2 } from './types';
import { LENGTH_TOLERANCE, ORIGIN, cross2, dist2, dot2, fingerprint, has, len2, stableStringify, sub2, unreachable } from './util';

// Použité polohy: vlastní body, počátek a body promítnuté geometrie; poloměry kružnic včetně promítnutých.
export interface SketchGeometry {
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
}

// ---------------------------------------------------------------- vstup solveru

export interface SolverSetup {
  input: SolveInput; // bez tažení
  stamp: string; // otisk vstupů: křivky, řídicí vazby, hodnoty promítnuté geometrie
  skipped: Id[]; // vazby vynechané, protože jejich promítnutá geometrie nemá žádné platné hodnoty
}

// `external`: hodnoty promítnuté geometrie, které jsou k dispozici (čerstvé nebo zmrazené).
export function solverSetup(sketch: SketchFeature, external: Record<Id, Projected>): SolverSetup {
  const points: Record<Id, Point2> = { [ORIGIN]: { x: 0, y: 0 }, ...sketch.points };
  const radii: Record<Id, number> = { ...sketch.radii };
  const curves: Record<Id, Curve> = {};
  const fixed: Id[] = [ORIGIN];
  for (const [id, c] of Object.entries(sketch.curves)) {
    const { construction: _construction, ...shape } = c;
    curves[id] = shape as Curve;
  }
  for (const id of Object.keys(sketch.external).sort()) {
    const value = external[id];
    if (!value) continue;
    if (value.kind === 'line') {
      points[`${id}/a`] = { x: value.a[0], y: value.a[1] };
      points[`${id}/b`] = { x: value.b[0], y: value.b[1] };
      curves[id] = { type: 'line', a: `${id}/a`, b: `${id}/b` };
      fixed.push(`${id}/a`, `${id}/b`);
    } else {
      points[`${id}/center`] = { x: value.center[0], y: value.center[1] };
      radii[id] = value.radius;
      curves[id] = { type: 'circle', center: `${id}/center` };
      fixed.push(`${id}/center`, id);
    }
  }
  const constraints: Record<Id, Constraint> = {};
  const skipped: Id[] = [];
  for (const [id, c] of Object.entries(sketch.constraints)) {
    const available = constraintOperands(c).every((operand) => has(points, operand) || has(curves, operand));
    if (!available) skipped.push(id);
    else if (!isDimension(c) || c.driving) constraints[id] = c; // referenční kóty počítá engine
  }
  const used: Record<Id, Projected> = {};
  for (const id of Object.keys(sketch.external)) if (external[id]) used[id] = external[id];
  const stamp = fingerprint(stableStringify({ curves, constraints, external: used }));
  return { input: { points, radii, curves, constraints, fixed }, stamp, skipped: skipped.sort() };
}

// Vlastní řešené proměnné skici z poloh, které vrátil solver.
export function ownVariables(sketch: SketchFeature, geometry: SketchGeometry): SketchGeometry {
  const points: Record<Id, Point2> = {};
  const radii: Record<Id, number> = {};
  for (const id of Object.keys(sketch.points)) points[id] = geometry.points[id];
  for (const id of Object.keys(sketch.radii)) radii[id] = geometry.radii[id];
  return { points, radii };
}

// ---------------------------------------------------------------- referenční kóty

const xy = (p: Point2): Vec2 => [p.x, p.y];

// Hodnoty referenčních kót (driving: false) z použitých poloh. Kóta, jejíž operand chybí, se vynechá.
export function measure(sketch: SketchFeature, curves: Record<Id, Curve>, geometry: SketchGeometry): Record<Id, number> {
  const out: Record<Id, number> = {};
  const point = (id: Id): Vec2 | undefined => (has(geometry.points, id) ? xy(geometry.points[id]) : undefined);
  const line = (id: Id): [Vec2, Vec2] | undefined => {
    const c = curves[id];
    if (!c || c.type !== 'line') return undefined;
    const [a, b] = [point(c.a), point(c.b)];
    return a && b ? [a, b] : undefined;
  };
  for (const [id, c] of Object.entries(sketch.constraints)) {
    if (!isDimension(c) || c.driving) continue;
    let value: number | undefined;
    if (c.type === 'distance' || c.type === 'horizontalDistance' || c.type === 'verticalDistance') {
      const [a, b] = [point(c.a), point(c.b)];
      if (a && b) value = c.type === 'distance' ? dist2(a, b) : c.type === 'horizontalDistance' ? b[0] - a[0] : b[1] - a[1];
    } else if (c.type === 'distancePointLine') {
      const [p, l] = [point(c.point), line(c.line)];
      if (p && l) value = Math.abs(cross2(sub2(l[1], l[0]), sub2(p, l[0]))) / dist2(l[0], l[1]);
    } else if (c.type === 'angle') {
      const [a, b] = [line(c.a), line(c.b)];
      if (a && b) {
        const [da, db] = [sub2(a[1], a[0]), sub2(b[1], b[0])];
        value = Math.atan2(cross2(da, db), dot2(da, db)); // od směru a ke směru b, proti směru hodin
      }
    } else if (c.type === 'radius' || c.type === 'diameter') {
      const curve = curves[c.curve];
      let radius: number | undefined;
      if (curve) {
        switch (curve.type) {
          case 'circle':
            radius = geometry.radii[c.curve];
            break;
          case 'arc': {
            const [center, start] = [point(curve.center), point(curve.start)];
            if (center && start) radius = dist2(center, start);
            break;
          }
          case 'line':
            break; // a line has no radius
          default:
            unreachable(curve, 'curve');
        }
      }
      if (radius !== undefined) value = c.type === 'radius' ? radius : 2 * radius;
    }
    if (value !== undefined && Number.isFinite(value)) out[id] = value;
  }
  return out;
}

// ---------------------------------------------------------------- profily a oblasti

// Uzavřená lomená čára v souřadnicích skici. Bod i má klíč keys[i]; hrana z bodu i do bodu i + 1
// pochází z křivky curves[i]. Vnější smyčka jde proti směru hodin, díra po směru.
// `exact`: the curves the polyline was divided from, in the order and direction the loop passes
// them (the loops of a sketch and of a moved outline have them; a generated loop has none).
export interface Loop {
  xy: number[];
  keys: string[];
  curves: Id[];
  exact?: OutlineCurve[];
}
// One curve of a closed loop as the loop passes it; the material is on the left of the travel.
// - `key` is what `Loop.curves` holds for its edges (the ID of the sketch curve for a region);
//   `forward` says that the loop passes the curve in its own direction (a line from `a` to `b`, an
//   arc and a circle counter-clockwise).
// - A line and an arc go `from` a point `to` a point; `ends` are the keys of the two vertices, by
//   which curves are chained. An arc starts at the angle `start` and turns by `sweep`, which is
//   signed: positive is counter-clockwise.
// - A circle is a loop by itself.
export type OutlineCurve = { key: string; forward: boolean } & (
  | { type: 'line'; from: Vec2; to: Vec2; ends: [string, string] }
  | { type: 'arc'; from: Vec2; to: Vec2; ends: [string, string]; center: Vec2; radius: number; start: number; sweep: number }
  | { type: 'circle'; center: Vec2; radius: number; ccw: boolean }
);
export interface Region {
  ref: RegionRef;
  outer: Loop;
  holes: Loop[];
}
export interface Profile {
  valid: boolean; // false = křivky se kříží nebo dotýkají mimo spojené body
  regions: Region[];
}

type Shape =
  | { id: Id; kind: 'line'; a: string; b: string; pa: Vec2; pb: Vec2 }
  | { id: Id; kind: 'arc'; a: string; b: string; pa: Vec2; pb: Vec2; c: Vec2; r: number; start: number; sweep: number }
  | { id: Id; kind: 'circle'; c: Vec2; r: number };
type Open = Exclude<Shape, { kind: 'circle' }>;

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;

// Vzdálenost bodu od křivky.
function distanceTo(p: Vec2, s: Shape): number {
  switch (s.kind) {
    case 'line': {
      const d = sub2(s.pb, s.pa);
      const t = Math.min(1, Math.max(0, dot2(sub2(p, s.pa), d) / dot2(d, d)));
      return dist2(p, [s.pa[0] + d[0] * t, s.pa[1] + d[1] * t]);
    }
    case 'circle':
      return Math.abs(dist2(p, s.c) - s.r);
    case 'arc': {
      const radial = Math.abs(dist2(p, s.c) - s.r);
      const angle = positive(Math.atan2(p[1] - s.c[1], p[0] - s.c[0]) - s.start);
      return angle <= s.sweep ? radial : Math.min(dist2(p, s.pa), dist2(p, s.pb));
    }
    default:
      return unreachable(s, 'shape');
  }
}

const midpoint = (s: Open): Vec2 => {
  switch (s.kind) {
    case 'line':
      return [(s.pa[0] + s.pb[0]) / 2, (s.pa[1] + s.pb[1]) / 2];
    case 'arc': {
      const angle = s.start + s.sweep / 2;
      return [s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle)];
    }
    default:
      return unreachable(s, 'shape');
  }
};

// A shape with a centre and a radius (a circle or an arc), or undefined for a line.
type Round = Exclude<Shape, { kind: 'line' }>;
function roundOf(s: Shape): Round | undefined {
  switch (s.kind) {
    case 'line':
      return undefined;
    case 'circle':
    case 'arc':
      return s;
    default:
      return unreachable(s, 'shape');
  }
}

// Průsečíky a body dotyku nosných křivek (přímka, kružnice), s tolerancí pro tečnost.
function carrierContacts(A: Shape, B: Shape, tol: number): Vec2[] {
  switch (A.kind) {
    case 'line':
      switch (B.kind) {
        case 'line':
          return lineContacts(A, B);
        case 'circle':
        case 'arc':
          return lineRoundContacts(A, B, tol);
        default:
          return unreachable(B, 'shape');
      }
    case 'circle':
    case 'arc':
      switch (B.kind) {
        case 'line':
          return lineRoundContacts(B, A, tol);
        case 'circle':
        case 'arc':
          return roundContacts(A, B, tol);
        default:
          return unreachable(B, 'shape');
      }
    default:
      return unreachable(A, 'shape');
  }
}
type LineShape = Extract<Shape, { kind: 'line' }>;
function lineContacts(A: LineShape, B: LineShape): Vec2[] {
  const [da, db] = [sub2(A.pb, A.pa), sub2(B.pb, B.pa)];
  const denominator = cross2(da, db);
  if (Math.abs(denominator) <= 1e-12 * len2(da) * len2(db)) return []; // rovnoběžné: stačí kontrola koncových bodů
  const t = cross2(sub2(B.pa, A.pa), db) / denominator;
  return [[A.pa[0] + da[0] * t, A.pa[1] + da[1] * t]];
}
function lineRoundContacts(line: LineShape, round: Round, tol: number): Vec2[] {
  {
    const d = sub2(line.pb, line.pa);
    const length = len2(d);
    const along = dot2(sub2(round.c, line.pa), d) / length;
    const foot: Vec2 = [line.pa[0] + (d[0] * along) / length, line.pa[1] + (d[1] * along) / length];
    const distance = dist2(foot, round.c);
    if (distance > round.r + tol) return [];
    if (distance >= round.r - tol) return [foot];
    const half = Math.sqrt(round.r * round.r - distance * distance) / length;
    return [
      [foot[0] + d[0] * half, foot[1] + d[1] * half],
      [foot[0] - d[0] * half, foot[1] - d[1] * half],
    ];
  }
}
function roundContacts(P: Round, Q: Round, tol: number): Vec2[] {
  const delta = sub2(Q.c, P.c);
  const D = len2(delta);
  if (D > P.r + Q.r + tol || D < Math.abs(P.r - Q.r) - tol) return [];
  if (D <= tol) return []; // soustředné se stejným poloměrem: řeší se zvlášť
  const u: Vec2 = [delta[0] / D, delta[1] / D];
  if (D >= P.r + Q.r - tol) return [[P.c[0] + u[0] * P.r, P.c[1] + u[1] * P.r]]; // vnější dotyk
  if (D <= Math.abs(P.r - Q.r) + tol) {
    const sign = P.r > Q.r ? 1 : -1; // vnitřní dotyk
    return [[P.c[0] + u[0] * P.r * sign, P.c[1] + u[1] * P.r * sign]];
  }
  const along = (D * D + P.r * P.r - Q.r * Q.r) / (2 * D);
  const half = Math.sqrt(Math.max(0, P.r * P.r - along * along));
  const foot: Vec2 = [P.c[0] + u[0] * along, P.c[1] + u[1] * along];
  return [
    [foot[0] - u[1] * half, foot[1] + u[0] * half],
    [foot[0] + u[1] * half, foot[1] - u[0] * half],
  ];
}

// Smějí se dvě křivky v profilu potkat? Dotýkat se smějí jen ve spojených bodech.
function compatible(A: Shape, B: Shape, tol: number): boolean {
  const curved = [A, B].flatMap((s) => roundOf(s) ?? []);
  // Soustředné kružnice nebo oblouky se stejným poloměrem leží na sobě.
  if (curved.length === 2 && dist2(curved[0].c, curved[1].c) <= tol && Math.abs(curved[0].r - curved[1].r) <= tol) {
    if (A.kind === 'circle' || B.kind === 'circle') return false;
  }
  // Společné vrcholy. U tečného napojení (zaoblení) leží křivky pod tolerancí i kus od vrcholu,
  // proto se dotyk bere jako dotyk ve vrcholu až do vzdálenosti dané poloměrem.
  const shared: Vec2[] = [];
  if (A.kind !== 'circle' && B.kind !== 'circle') {
    for (const [ka, pa] of [[A.a, A.pa], [A.b, A.pb]] as [string, Vec2][]) if (ka === B.a || ka === B.b) shared.push(pa);
  }
  const reach = 10 * tol + (curved.length ? Math.sqrt(8 * Math.max(...curved.map((s) => s.r)) * tol) : 0);
  const candidates: Vec2[] = carrierContacts(A, B, tol);
  for (const s of [A, B]) if (s.kind !== 'circle') candidates.push(s.pa, s.pb, midpoint(s));
  for (const p of candidates) {
    if (distanceTo(p, A) > tol || distanceTo(p, B) > tol) continue;
    if (!shared.some((v) => dist2(p, v) <= reach)) return false;
  }
  return true;
}

// Na kolik úseček se dělí oblouk. Strop brání tomu, aby obří poloměr nebo nepatrná tolerance
// vyžádaly milióny úseček (pro r/tolerance nad 1e16 vychází krok nula); nad ním už dělení
// toleranci nedodrží.
const MAX_SEGMENTS = 4096;
export function segments(sweep: number, radius: number, chordTolerance: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(chordTolerance / radius, 1)), Math.PI / 4);
  return Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(sweep / step - 1e-9)));
}

// Obstojí oblasti i po rozdělení oblouků na úsečky? Platnost profilu se ověřuje na přesných
// křivkách, ale těleso vzniká z lomených čar, které se od oblouku liší až o toleranci dělení.
// Křivka, která oblouk těsně míjí, pak jeho lomenou čáru protne, a oblast tenčí než tolerance
// splaskne do dvou bodů. Z takových smyček by nevzniklo uzavřené těleso.
export function soundTessellation(regions: Region[]): boolean {
  interface Segment {
    a: string;
    b: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    minX: number;
    maxX: number;
  }
  const seen = new Set<string>();
  const list: Segment[] = [];
  for (const region of regions) {
    for (const loop of [region.outer, ...region.holes]) {
      const count = loop.keys.length;
      if (count < 3) return false;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const [a, b] = [loop.keys[i], loop.keys[j]];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue; // hranu sdílejí sousední oblasti
        seen.add(key);
        const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
        list.push({ a, b, ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
      }
    }
  }
  // Na které straně úsečky p leží bod; úsečky se kříží, když konce každé leží na opačných stranách druhé.
  const side = (p: Segment, x: number, y: number): number => (p.bx - p.ax) * (y - p.ay) - (p.by - p.ay) * (x - p.ax);
  list.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length && list[j].minX <= p.maxX; j++) {
      const q = list[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue; // sousedé se dotýkají ve vrcholu
      if (Math.max(q.ay, q.by) < Math.min(p.ay, p.by) || Math.min(q.ay, q.by) > Math.max(p.ay, p.by)) continue;
      if (side(p, q.ax, q.ay) * side(p, q.bx, q.by) < 0 && side(q, p.ax, p.ay) * side(q, p.bx, p.by) < 0) return false;
    }
  }
  return true;
}

// Spojování bodů: tentýž bod, nebo vazba coincident, která je v použitých polohách splněná.
// Tranzitivní, jde i přes počátek a promítnuté body. Vrchol nese polohu bodu s nejmenším ID.
// The answer is the vertex of a point: the point with the smallest ID of those it is joined with.
// The profile of a sketch and the chain of a wall (recompute/outline.ts) join points by this rule.
export function pointJoins(sketch: SketchFeature, geometry: SketchGeometry): (id: Id) => Id {
  const parent = new Map<Id, Id>(Object.keys(geometry.points).map((id) => [id, id]));
  const find = (id: Id): Id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as Id;
    return root;
  };
  for (const c of Object.values(sketch.constraints)) {
    if (c.type !== 'coincident' || !parent.has(c.a) || !parent.has(c.b)) continue;
    if (dist2(xy(geometry.points[c.a]), xy(geometry.points[c.b])) > LENGTH_TOLERANCE) continue;
    const [ra, rb] = [find(c.a), find(c.b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  return find;
}

// Projde skicu a najde oblasti. Konstrukční a promítnuté křivky se ignorují.
export function detectProfile(sketch: SketchFeature, geometry: SketchGeometry, chordTolerance: number): Profile {
  const tol = LENGTH_TOLERANCE;
  const find = pointJoins(sketch, geometry);
  const vertex = (id: Id): { key: string; p: Vec2 } => ({ key: find(id), p: xy(geometry.points[find(id)]) });

  const shapes: Shape[] = [];
  let valid = true;
  for (const id of Object.keys(sketch.curves).sort()) {
    const c = sketch.curves[id];
    if (c.construction) continue;
    switch (c.type) {
      case 'circle': {
        const r = geometry.radii[id];
        if (!(r > tol)) valid = false;
        else shapes.push({ id, kind: 'circle', c: xy(geometry.points[c.center]), r });
        continue;
      }
      case 'line': {
        const [a, b] = [vertex(c.a), vertex(c.b)];
        if (a.key === b.key || dist2(a.p, b.p) <= tol) {
          valid = false; // křivka nulové délky
          continue;
        }
        shapes.push({ id, kind: 'line', a: a.key, b: b.key, pa: a.p, pb: b.p });
        continue;
      }
      case 'arc': {
        const [a, b] = [vertex(c.start), vertex(c.end)];
        if (a.key === b.key || dist2(a.p, b.p) <= tol) {
          valid = false; // křivka nulové délky
          continue;
        }
        const center = xy(geometry.points[c.center]);
        const r = dist2(a.p, center);
        if (!(r > tol)) {
          valid = false;
          continue;
        }
        const start = Math.atan2(a.p[1] - center[1], a.p[0] - center[0]);
        const sweep = positive(Math.atan2(b.p[1] - center[1], b.p[0] - center[0]) - start) || TAU;
        shapes.push({ id, kind: 'arc', a: a.key, b: b.key, pa: a.p, pb: b.p, c: center, r, start, sweep });
        continue;
      }
      default:
        unreachable(c, 'curve');
    }
  }
  for (let i = 0; i < shapes.length && valid; i++) for (let j = i + 1; j < shapes.length && valid; j++) if (!compatible(shapes[i], shapes[j], tol)) valid = false;
  if (!valid) return { valid: false, regions: [] };

  // ---- rovinný graf: půlhrany úseček a oblouků
  interface Half {
    shape: Open;
    forward: boolean; // ve směru křivky (u oblouku proti směru hodin)
    from: string;
    to: string;
    angle: number; // směr, kterým půlhrana opouští vrchol (po seřazení směr k blízkému bodu křivky)
    curvature: number; // se znaménkem: kladná zatáčí doleva
    twin: number;
    loop: number;
  }
  let open = shapes.filter((s): s is Open => s.kind !== 'circle');
  let halves: Half[] = [];
  let loops: number[][] = [];
  for (;;) {
    halves = [];
    for (const s of open) {
      const index = halves.length;
      switch (s.kind) {
        case 'line': {
          const angle = Math.atan2(s.pb[1] - s.pa[1], s.pb[0] - s.pa[0]);
          halves.push({ shape: s, forward: true, from: s.a, to: s.b, angle, curvature: 0, twin: index + 1, loop: -1 });
          halves.push({ shape: s, forward: false, from: s.b, to: s.a, angle: positive(angle + Math.PI), curvature: 0, twin: index, loop: -1 });
          break;
        }
        case 'arc':
          halves.push({ shape: s, forward: true, from: s.a, to: s.b, angle: s.start + Math.PI / 2, curvature: 1 / s.r, twin: index + 1, loop: -1 });
          halves.push({ shape: s, forward: false, from: s.b, to: s.a, angle: s.start + s.sweep - Math.PI / 2, curvature: -1 / s.r, twin: index, loop: -1 });
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    const outgoing = new Map<string, number[]>();
    halves.forEach((h, i) => outgoing.set(h.from, [...(outgoing.get(h.from) ?? []), i]));
    // Pořadí půlhran kolem vrcholu se bere podle směru k bodu křivky v malé vzdálenosti od vrcholu,
    // ne podle tečny: úsečka a oblouk, které z vrcholu vycházejí tečně stejným směrem, mají tečny
    // shodné až na šum solveru a pořadí by určovala náhoda. Vzdálenost je polovina nejkratší
    // křivky ve vrcholu; tětiva oblouku je od tečny odkloněná o asin(křivost · vzdálenost / 2).
    for (const list of outgoing.values()) {
      const distance = Math.min(...list.map((i) => dist2(halves[i].shape.pa, halves[i].shape.pb))) / 2;
      for (const i of list) halves[i].angle = positive(halves[i].angle + Math.asin(Math.max(-1, Math.min(1, (halves[i].curvature * distance) / 2))));
      list.sort((p, q) => halves[p].angle - halves[q].angle || halves[p].curvature - halves[q].curvature || p - q);
    }
    // Další půlhrana kolem stěny (stěna vlevo): ve vrcholu první po směru hodin od protisměrné půlhrany.
    const next = (i: number): number => {
      const list = outgoing.get(halves[i].to) as number[];
      const k = list.indexOf(halves[i].twin);
      return list[(k + list.length - 1) % list.length];
    };
    loops = [];
    halves.forEach((h, i) => {
      if (h.loop >= 0) return;
      const loop: number[] = [];
      for (let k = i; halves[k].loop < 0; k = next(k)) {
        halves[k].loop = loops.length;
        loop.push(k);
      }
      loops.push(loop);
    });
    // Křivka, která má po obou stranách stejnou stěnu, žádnou plochu neuzavírá: ignoruje se.
    const useless = new Set(halves.filter((h) => h.loop === halves[h.twin].loop).map((h) => h.shape));
    if (useless.size === 0) break;
    open = open.filter((s) => !useless.has(s));
  }

  // Plocha smyčky se znaménkem: mnohoúhelník vrcholů plus kruhové úseče oblouků.
  const position = new Map<string, Vec2>();
  for (const s of open) position.set(s.a, s.pa).set(s.b, s.pb);
  const areaOf = (loop: number[]): number => {
    let area = 0;
    for (const i of loop) {
      const h = halves[i];
      area += cross2(position.get(h.from) as Vec2, position.get(h.to) as Vec2) / 2;
      const s = h.shape;
      switch (s.kind) {
        case 'line':
          break;
        case 'arc':
          area += ((h.forward ? 1 : -1) * s.r * s.r * (s.sweep - Math.sin(s.sweep))) / 2; // the segment of the arc
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    return area;
  };

  // Lomená čára smyčky. Dělení oblouku nezávisí na směru průchodu, takže sousední oblasti sdílejí vrcholy.
  const polyline = (loop: number[]): Loop => {
    const exact: OutlineCurve[] = [];
    const out: Loop = { xy: [], keys: [], curves: [], exact };
    for (const i of loop) {
      const h = halves[i];
      const s = h.shape;
      const [start, end] = [position.get(h.from) as Vec2, position.get(h.to) as Vec2];
      out.xy.push(start[0], start[1]);
      out.keys.push(`v:${h.from}`);
      out.curves.push(s.id);
      const travel = { key: s.id, forward: h.forward, from: start, to: end, ends: [h.from, h.to] as [string, string] };
      switch (s.kind) {
        case 'line':
          exact.push({ ...travel, type: 'line' });
          continue;
        case 'arc':
          break;
        default:
          unreachable(s, 'shape');
      }
      exact.push({ ...travel, type: 'arc', center: s.c, radius: s.r, start: h.forward ? s.start : s.start + s.sweep, sweep: h.forward ? s.sweep : -s.sweep });
      const n = segments(s.sweep, s.r, chordTolerance);
      for (let step = 1; step < n; step++) {
        const k = h.forward ? step : n - step;
        const angle = s.start + (s.sweep * k) / n;
        out.xy.push(s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle));
        out.keys.push(`c:${s.id}:${k}`);
        out.curves.push(s.id);
      }
    }
    return out;
  };
  const circleLoop = (s: Extract<Shape, { kind: 'circle' }>, clockwise: boolean): Loop => {
    const n = segments(TAU, s.r, chordTolerance);
    const out: Loop = { xy: [], keys: [], curves: [], exact: [{ key: s.id, forward: !clockwise, type: 'circle', center: s.c, radius: s.r, ccw: !clockwise }] };
    for (let step = 0; step < n; step++) {
      const k = clockwise ? (n - step) % n : step;
      const angle = (TAU * k) / n;
      out.xy.push(s.c[0] + s.r * Math.cos(angle), s.c[1] + s.r * Math.sin(angle));
      out.keys.push(`c:${s.id}:${k}`);
      out.curves.push(s.id);
    }
    return out;
  };

  // Leží bod uvnitř hranice? Paprsek ve směru +x; křivky se berou po úsecích monotónních v y
  // s polootevřeným pravidlem, takže průchod vrcholem se nepočítá dvakrát.
  type Boundary = { halves: number[] } | { circle: Extract<Shape, { kind: 'circle' }> };
  const crossings = (p: Vec2, boundary: Boundary): number => {
    let count = 0;
    const piece = (from: Vec2, to: Vec2, xAt: () => number) => {
      if (from[1] > p[1] !== to[1] > p[1] && xAt() > p[0]) count++;
    };
    const arcPieces = (c: Vec2, r: number, start: number, sweep: number, from: Vec2, to: Vec2) => {
      // dělicí body: vrchol a spodek kružnice
      const cuts = [Math.PI / 2, (3 * Math.PI) / 2].map((angle) => positive(angle - start)).filter((offset) => offset > 0 && offset < sweep).sort((x, y) => x - y);
      const stops = [0, ...cuts, sweep];
      for (let i = 0; i + 1 < stops.length; i++) {
        const at = (offset: number): Vec2 => (offset === 0 ? from : offset === sweep ? to : [c[0] + r * Math.cos(start + offset), c[1] + r * Math.sin(start + offset)]);
        const right = Math.cos(start + (stops[i] + stops[i + 1]) / 2) > 0;
        piece(at(stops[i]), at(stops[i + 1]), () => c[0] + (right ? 1 : -1) * Math.sqrt(Math.max(0, r * r - (p[1] - c[1]) ** 2)));
      }
    };
    if ('circle' in boundary) {
      const s = boundary.circle;
      const [top, bottom]: Vec2[] = [[s.c[0], s.c[1] + s.r], [s.c[0], s.c[1] - s.r]];
      arcPieces(s.c, s.r, Math.PI / 2, Math.PI, top, bottom);
      arcPieces(s.c, s.r, (3 * Math.PI) / 2, Math.PI, bottom, top);
      return count;
    }
    for (const i of boundary.halves) {
      const s = halves[i].shape;
      switch (s.kind) {
        case 'line':
          piece(s.pa, s.pb, () => s.pa[0] + ((p[1] - s.pa[1]) / (s.pb[1] - s.pa[1])) * (s.pb[0] - s.pa[0]));
          break;
        case 'arc':
          arcPieces(s.c, s.r, s.start, s.sweep, s.pa, s.pb);
          break;
        default:
          unreachable(s, 'shape');
      }
    }
    return count;
  };

  // ---- souvislé části grafu: každá má omezené stěny a jednu vnější hranici
  interface Face {
    area: number;
    boundary: Boundary;
    region: Region;
    component: number;
  }
  interface Component {
    sample: Vec2; // bod části, podle kterého se hledá oblast, ve které leží
    hole: () => Loop; // vnější hranice po směru hodin
  }
  const faces: Face[] = [];
  const components: Component[] = [];
  const componentOf = new Map<string, number>();
  const group = new Map<string, string>([...position.keys()].map((k) => [k, k]));
  const rootOf = (k: string): string => {
    let r = k;
    while (group.get(r) !== r) r = group.get(r) as string;
    return r;
  };
  for (const s of open) group.set(rootOf(s.a), rootOf(s.b));
  loops.forEach((loop) => {
    const root = rootOf(halves[loop[0]].from);
    if (!componentOf.has(root)) {
      componentOf.set(root, components.length);
      components.push({ sample: position.get(root) as Vec2, hole: () => ({ xy: [], keys: [], curves: [] }) });
    }
    const component = componentOf.get(root) as number;
    const area = areaOf(loop);
    if (area > 0) {
      const outer = polyline(loop);
      faces.push({ area, boundary: { halves: loop }, region: { ref: { outerLoop: [...new Set(outer.curves)].sort() }, outer, holes: [] }, component });
    } else components[component].hole = () => polyline(loop);
  });
  for (const s of shapes) {
    if (s.kind !== 'circle') continue;
    faces.push({ area: Math.PI * s.r * s.r, boundary: { circle: s }, region: { ref: { outerLoop: [s.id] }, outer: circleLoop(s, false), holes: [] }, component: components.length });
    components.push({ sample: [s.c[0] + s.r, s.c[1]], hole: () => circleLoop(s, true) });
  }
  // Díry: část grafu vnořená do oblasti jiné části je její dírou; patří nejmenší oblasti, která ji obsahuje.
  components.forEach((component, index) => {
    let parentFace: Face | undefined;
    for (const face of faces) {
      if (face.component === index || crossings(component.sample, face.boundary) % 2 === 0) continue;
      if (!parentFace || face.area < parentFace.area) parentFace = face;
    }
    if (parentFace) parentFace.region.holes.push(component.hole());
  });
  const regions = faces.map((f) => f.region).sort((p, q) => (p.ref.outerLoop.join('|') < q.ref.outerLoop.join('|') ? -1 : 1));
  if (!soundTessellation(regions)) return { valid: false, regions: [] };
  return { valid: true, regions };
}

// ---------------------------------------------------------------- checks of an outline

// The checks of loops that did not come from `detectProfile`: an outline moved by an offset and the
// outline of a wall (recompute/outline.ts). The first two are the checks of a sketch profile (curves
// touch only where they are joined; the polylines do not cross). They are not enough: the crossing
// test of `soundTessellation` sees only edges whose ends lie strictly on opposite sides of each
// other, so an edge that ends on another, passes through its end or runs along it is no crossing
// to it. The polylines therefore get three more tests (clearance, area, nesting).

// Two curves of the loops that touch where they are not joined, if there are any. A corner is
// a vertex of its own in every loop: curves are joined only where they follow each other.
export function touchingCurves(loops: OutlineCurve[][]): [OutlineCurve, OutlineCurve] | undefined {
  const shapes: { shape: Shape; curve: OutlineCurve }[] = [];
  loops.forEach((loop, l) => {
    loop.forEach((curve, i) => {
      const id = `${l}:${i}`;
      const [a, b] = [`${l}:${i}`, `${l}:${(i + 1) % loop.length}`];
      if (curve.type === 'circle') shapes.push({ curve, shape: { id, kind: 'circle', c: curve.center, r: curve.radius } });
      else if (curve.type === 'line') shapes.push({ curve, shape: { id, kind: 'line', a, b, pa: curve.from, pb: curve.to } });
      // a shape runs counter-clockwise from `a` to `b`
      else if (curve.sweep > 0) shapes.push({ curve, shape: { id, kind: 'arc', a, b, pa: curve.from, pb: curve.to, c: curve.center, r: curve.radius, start: curve.start, sweep: curve.sweep } });
      else shapes.push({ curve, shape: { id, kind: 'arc', a: b, b: a, pa: curve.to, pb: curve.from, c: curve.center, r: curve.radius, start: curve.start + curve.sweep, sweep: -curve.sweep } });
    });
  });
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) if (!compatible(shapes[i].shape, shapes[j].shape, LENGTH_TOLERANCE)) return [shapes[i].curve, shapes[j].curve];
  return undefined;
}

// The distance of a point from a segment, and of two segments (zero when they meet in any way).
function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function segmentToSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const side = (px: number, py: number, qx: number, qy: number, x: number, y: number): number => (qx - px) * (y - py) - (qy - py) * (x - px);
  const [c, d, a, b] = [side(ax, ay, bx, by, cx, cy), side(ax, ay, bx, by, dx, dy), side(cx, cy, dx, dy, ax, ay), side(cx, cy, dx, dy, bx, by)];
  if (c * d < 0 && a * b < 0) return 0;
  return Math.min(pointToSegment(ax, ay, cx, cy, dx, dy), pointToSegment(bx, by, cx, cy, dx, dy), pointToSegment(cx, cy, ax, ay, bx, by), pointToSegment(dx, dy, ax, ay, bx, by));
}

// What is wrong with the polylines of loops, if anything; `curves` are the keys of the curves the
// place belongs to. `signs[i]` is the sign of the area loop i has to have (an outer loop positive,
// a hole negative).
// - `points`: a loop has fewer than three points.
// - `clearance`: two edges that do not follow each other in one loop are nearer than the length
//   tolerance, or an edge folds back onto the one it follows (its other end is nearer than the
//   tolerance to that edge). Edges follow each other by position in the loop, not by a common key:
//   a loop that returns to a point it has been at is refused. What passes is simple polygons with
//   no point in common.
// - `area`: a loop has lost the sign of its area, or has an area not above the tolerance times
//   its length.
export interface PolygonProblem {
  what: 'points' | 'clearance' | 'area';
  curves: Id[];
}
export function polygonProblem(loops: Loop[], signs: number[]): PolygonProblem | undefined {
  const tol = LENGTH_TOLERANCE;
  interface Edge {
    loop: number;
    index: number;
    count: number;
    curve: Id;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    minX: number;
    maxX: number;
  }
  const list: Edge[] = [];
  for (const [l, loop] of loops.entries()) {
    const count = loop.keys.length;
    if (count < 3) return { what: 'points', curves: [...new Set(loop.curves)] };
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
      list.push({ loop: l, index: i, count, curve: loop.curves[i], ax, ay, bx, by, minX: Math.min(ax, bx), maxX: Math.max(ax, bx) });
    }
  }
  // the sweep of `soundTessellation`, with the boxes widened by the tolerance
  list.sort((p, q) => p.minX - q.minX);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    for (let j = i + 1; j < list.length && list[j].minX <= p.maxX + tol; j++) {
      const q = list[j];
      if (Math.max(q.ay, q.by) < Math.min(p.ay, p.by) - tol || Math.min(q.ay, q.by) > Math.max(p.ay, p.by) + tol) continue;
      const [first, second] = p.loop !== q.loop ? [undefined, undefined] : (p.index + 1) % p.count === q.index ? [p, q] : (q.index + 1) % q.count === p.index ? [q, p] : [undefined, undefined];
      const near =
        first && second
          ? pointToSegment(first.ax, first.ay, second.ax, second.ay, second.bx, second.by) <= tol || pointToSegment(second.bx, second.by, first.ax, first.ay, first.bx, first.by) <= tol
          : segmentToSegment(p.ax, p.ay, p.bx, p.by, q.ax, q.ay, q.bx, q.by) <= tol;
      if (near) return { what: 'clearance', curves: [...new Set([p.curve, q.curve])] };
    }
  }
  for (const [l, loop] of loops.entries()) {
    const count = loop.keys.length;
    let [area, length] = [0, 0];
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      area += (loop.xy[2 * i] * loop.xy[2 * j + 1] - loop.xy[2 * j] * loop.xy[2 * i + 1]) / 2;
      length += Math.hypot(loop.xy[2 * j] - loop.xy[2 * i], loop.xy[2 * j + 1] - loop.xy[2 * i + 1]);
    }
    if (Math.sign(area) !== signs[l] || !(Math.abs(area) > tol * length)) return { what: 'area', curves: [...new Set(loop.curves)] };
  }
  return undefined;
}

// Which polyline lies inside which: `[i][j]` says that loop i lies inside loop j, decided by the
// first vertex of i against the polygon of j. One vertex decides for loops that passed the
// clearance: two simple polygons without a common point are either nested or apart.
export function polygonNesting(loops: Loop[]): boolean[][] {
  const inside = (x: number, y: number, loop: Loop): boolean => {
    const count = loop.keys.length;
    let odd = false;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const [ax, ay, bx, by] = [loop.xy[2 * i], loop.xy[2 * i + 1], loop.xy[2 * j], loop.xy[2 * j + 1]];
      if (ay > y !== by > y && ax + ((y - ay) / (by - ay)) * (bx - ax) > x) odd = !odd;
    }
    return odd;
  };
  return loops.map((loop, i) => loops.map((other, j) => i !== j && inside(loop.xy[0], loop.xy[1], other)));
}

export const sameRegion = (a: RegionRef, b: RegionRef): boolean => a.outerLoop.length === b.outerLoop.length && a.outerLoop.every((id, i) => id === b.outerLoop[i]);

// Promítnutá geometrie jako body a poloměry (pro výsledek skici).
export function externalGeometry(sketch: SketchFeature, external: Record<Id, Projected>): SketchGeometry {
  const points: Record<Id, Point2> = {};
  const radii: Record<Id, number> = {};
  for (const [id, ref] of Object.entries(sketch.external)) {
    const value = external[id];
    if (!value) continue;
    const ids = derivedPoints(id, ref);
    if (value.kind === 'line') {
      points[ids[0]] = { x: value.a[0], y: value.a[1] };
      points[ids[1]] = { x: value.b[0], y: value.b[1] };
    } else {
      points[ids[0]] = { x: value.center[0], y: value.center[1] };
      radii[id] = value.radius;
    }
  }
  return { points, radii };
}
