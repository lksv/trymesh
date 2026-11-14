// Tělesa: stavba sítě extrude, stěny a hrany tělesa, rovina na stěně, promítnutí hrany.
// Pravidla jsou v docs/architecture.md, sekce Pojmenování a Extrude.
import type { Region } from './sketch';
import type { BodyResult, EdgeKind, EdgeName, FaceName, Frame, Id, IssueCode, Projected, ProjectionKind, Solid, SolidKernel, Vec2, Vec3 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, add3, cross3, dot3, edgeKey, faceKey, len3, mul3, sub3, unit3 } from './util';

// Analytický popis stěny; plyne z definice feature, ne ze sítě.
export type FaceInfo =
  | { planar: true; origin: Vec3; y: Vec3; normal: Vec3 } // rovina bodem `origin`; `normal` bez znaménka směru ven
  | { planar: false; center: Vec3; axis: Vec3; radius: number }; // válec

// Křivka skici, ze které vzniká boční stěna.
export type SideCurve = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'round'; center: Vec2; radius: number };

export const toWorld = (frame: Frame, u: number, v: number, w = 0): Vec3 => [
  frame.origin[0] + u * frame.x[0] + v * frame.y[0] + w * frame.normal[0],
  frame.origin[1] + u * frame.x[1] + v * frame.y[1] + w * frame.normal[1],
  frame.origin[2] + u * frame.x[2] + v * frame.y[2] + w * frame.normal[2],
];
export const toPlane = (frame: Frame, p: Vec3): Vec2 => [dot3(sub3(p, frame.origin), frame.x), dot3(sub3(p, frame.origin), frame.y)];

// ---------------------------------------------------------------- extrude

export interface Prism {
  solid: Solid;
  faces: { name: FaceName; info: FaceInfo }[]; // nové stěny; číslo stěny = firstFaceId + index
}

// Postaví uzavřenou síť nad vybranými oblastmi: dvě víka a boční stěny. Boční stěna vznikne jen
// z křivky na hranici právě jedné vybrané oblasti; křivka sdílená dvěma oblastmi se vyruší.
export function buildPrism(feature: Id, regions: Region[], frame: Frame, distance: number, curveOf: (id: Id) => SideCurve, firstFaceId: number, kernel: SolidKernel): Prism {
  // 2D síť sjednocení oblastí. Vrcholy se sdílejí podle klíče, takže sousední oblasti na sebe navazují.
  const index = new Map<string, number>();
  const xy: number[] = [];
  const triangles: number[] = [];
  const curveAt = new Map<string, Id>(); // hrana (neorientovaná dvojice vrcholů) → křivka
  const pair = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  for (const region of regions) {
    const loops = [region.outer, ...region.holes];
    const local: number[] = [];
    for (const loop of loops) {
      const count = loop.keys.length;
      const ids = loop.keys.map((key, k) => {
        let i = index.get(key);
        if (i === undefined) {
          i = xy.length / 2;
          index.set(key, i);
          xy.push(loop.xy[2 * k], loop.xy[2 * k + 1]);
        }
        return i;
      });
      ids.forEach((i, k) => curveAt.set(pair(i, ids[(k + 1) % count]), loop.curves[k]));
      local.push(...ids);
    }
    for (const i of kernel.triangulate(loops.map((loop) => Float64Array.from(loop.xy)))) triangles.push(local[i]);
  }

  // Kde se oblast dotýká sama sebe nebo jiné vybrané oblasti jen v bodě, by svislá hrana nesla čtyři
  // boční stěny. Vrchol se proto zdvojí: každý vějíř trojúhelníků kolem něj dostane vlastní.
  const original: number[] = Array.from({ length: xy.length / 2 }, (_, i) => i);
  const count = triangles.length / 3;
  const around = new Map<number, number[]>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) around.set(triangles[3 * t + k], [...(around.get(triangles[3 * t + k]) ?? []), t]);
  for (const [v, list] of around) {
    const group = new Map<number, number>(list.map((t) => [t, t]));
    const root = (t: number): number => {
      while (group.get(t) !== t) t = group.get(t) as number;
      return t;
    };
    const byNeighbour = new Map<number, number[]>(); // druhý vrchol hrany → trojúhelníky vějíře
    for (const t of list) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] !== v) byNeighbour.set(triangles[3 * t + k], [...(byNeighbour.get(triangles[3 * t + k]) ?? []), t]);
    for (const shared of byNeighbour.values()) if (shared.length === 2) group.set(root(shared[0]), root(shared[1]));
    const fans = [...new Set(list.map(root))];
    for (const fan of fans.slice(1)) {
      const copy = xy.length / 2;
      xy.push(xy[2 * v], xy[2 * v + 1]);
      original.push(original[v]);
      for (const t of list) if (root(t) === fan) for (let k = 0; k < 3; k++) if (triangles[3 * t + k] === v) triangles[3 * t + k] = copy;
    }
  }

  // Stěny: víka a boky. Boční stěny podle křivek, v pořadí ID křivky.
  const directed = new Set<string>();
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) directed.add(`${triangles[3 * t + k]}>${triangles[3 * t + ((k + 1) % 3)]}`);
  const boundary: [number, number, Id][] = [];
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const [i, j] = [triangles[3 * t + k], triangles[3 * t + ((k + 1) % 3)]];
      if (directed.has(`${j}>${i}`)) continue;
      const curve = curveAt.get(pair(original[i], original[j]));
      if (curve === undefined) throw new Error('extrude: hrana obrysu bez křivky');
      boundary.push([i, j, curve]);
    }
  }
  const faces: Prism['faces'] = [
    { name: { feature, role: 'startCap' }, info: { planar: true, origin: frame.origin, y: frame.y, normal: frame.normal } },
    { name: { feature, role: 'endCap' }, info: { planar: true, origin: toWorld(frame, 0, 0, distance), y: frame.y, normal: frame.normal } },
  ];
  const sideId = new Map<Id, number>();
  for (const curve of [...new Set(boundary.map((edge) => edge[2]))].sort()) {
    sideId.set(curve, firstFaceId + faces.length);
    const shape = curveOf(curve);
    if (shape.type === 'line') {
      const direction = sub3(toWorld(frame, shape.b[0], shape.b[1]), toWorld(frame, shape.a[0], shape.a[1]));
      faces.push({ name: { feature, role: 'side', curve }, info: { planar: true, origin: toWorld(frame, shape.a[0], shape.a[1]), y: frame.normal, normal: unit3(cross3(direction, frame.normal)) } });
    } else {
      faces.push({ name: { feature, role: 'side', curve }, info: { planar: false, center: toWorld(frame, shape.center[0], shape.center[1]), axis: frame.normal, radius: shape.radius } });
    }
  }

  // 3D síť: spodní a horní hladina podle normály roviny skici; startCap je víko v rovině skici.
  const n = xy.length / 2;
  const [low, high] = [Math.min(0, distance), Math.max(0, distance)];
  const positions = new Float32Array(6 * n);
  for (let i = 0; i < n; i++) {
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], low), 3 * i);
    positions.set(toWorld(frame, xy[2 * i], xy[2 * i + 1], high), 3 * (n + i));
  }
  const [lowId, highId] = distance > 0 ? [firstFaceId, firstFaceId + 1] : [firstFaceId + 1, firstFaceId];
  const out: number[] = [];
  const ids: number[] = [];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    out.push(a, c, b, n + a, n + b, n + c);
    ids.push(lowId, highId);
  }
  for (const [i, j, curve] of boundary) {
    out.push(i, j, n + j, i, n + j, n + i);
    ids.push(sideId.get(curve) as number, sideId.get(curve) as number);
  }
  return { solid: { positions, triangles: Uint32Array.from(out), faceIds: Uint32Array.from(ids) }, faces };
}

export function volumeOf(s: Solid): number {
  let volume = 0;
  const p = s.positions;
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [3 * s.triangles[t], 3 * s.triangles[t + 1], 3 * s.triangles[t + 2]];
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return volume / 6;
}

// ---------------------------------------------------------------- stěny a hrany tělesa

interface EdgeData {
  a: number; // čísla stěn v kanonickém pořadí jmen
  b: number;
  name: EdgeName;
  kind: EdgeKind;
  segments: number[];
}
export interface BodyData {
  result: BodyResult;
  normalSum: Map<number, Vec3>; // součet normál trojúhelníků stěny vážený plochou: směr ven z tělesa
  edges: Map<string, EdgeData>;
}

const cache = new WeakMap<Solid, BodyData>();

// Stěny a hrany tělesa. Výsledek závisí jen na síti a na tabulce stěn, která se pro existující
// čísla nemění, takže se pamatuje podle identity sítě.
export function analyzeBody(solid: Solid, faceNames: FaceName[], faceInfos: FaceInfo[]): BodyData {
  const cached = cache.get(solid);
  if (cached) return cached;
  const p = solid.positions;
  const at = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const normalSum = new Map<number, Vec3>();
  const byEdge = new Map<number, number>(); // orientovaná hrana → číslo stěny trojúhelníku
  const vertexCount = p.length / 3;
  for (let t = 0; t < solid.triangles.length / 3; t++) {
    const [i, j, k] = [solid.triangles[3 * t], solid.triangles[3 * t + 1], solid.triangles[3 * t + 2]];
    const id = solid.faceIds[t];
    normalSum.set(id, add3(normalSum.get(id) ?? [0, 0, 0], cross3(sub3(at(j), at(i)), sub3(at(k), at(i)))));
    byEdge.set(i * vertexCount + j, id).set(j * vertexCount + k, id).set(k * vertexCount + i, id);
  }
  const edges = new Map<string, EdgeData>();
  for (const [key, id] of byEdge) {
    const [i, j] = [Math.floor(key / vertexCount), key % vertexCount];
    if (i > j) continue; // každou hranu jednou
    const other = byEdge.get(j * vertexCount + i);
    if (other === undefined || other === id) continue;
    const [a, b] = faceKey(faceNames[id]) <= faceKey(faceNames[other]) ? [id, other] : [other, id];
    const name: EdgeName = { a: faceNames[a], b: faceNames[b] };
    let edge = edges.get(edgeKey(name));
    if (!edge) edges.set(edgeKey(name), (edge = { a, b, name, kind: edgeKind(faceInfos[a], faceInfos[b]), segments: [] }));
    edge.segments.push(...at(i), ...at(j));
  }
  const sorted = [...edges.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const data: BodyData = {
    result: {
      solid,
      faces: [...normalSum.keys()].sort((x, y) => x - y).map((id) => ({ id, planar: faceInfos[id].planar })),
      edges: sorted.map(([, e]) => ({ name: e.name, kind: e.kind, segments: Float64Array.from(e.segments) })),
    },
    normalSum,
    edges: new Map(sorted),
  };
  cache.set(solid, data);
  return data;
}

function edgeKind(a: FaceInfo, b: FaceInfo): EdgeKind {
  if (a.planar && b.planar) return len3(cross3(a.normal, b.normal)) <= Math.sin(ANGLE_TOLERANCE) ? 'coplanar' : 'line';
  if (a.planar === b.planar) return 'other';
  const [plane, cylinder] = a.planar ? [a, b as Extract<FaceInfo, { planar: false }>] : [b as Extract<FaceInfo, { planar: true }>, a as Extract<FaceInfo, { planar: false }>];
  return len3(cross3(plane.normal, cylinder.axis)) <= Math.sin(ANGLE_TOLERANCE) ? 'circle' : 'other';
}

// Normála rovinné stěny ven z tělesa: analytický směr, znaménko ze sítě. undefined = stěna v tělese není.
function outward(body: BodyData, id: number, info: Extract<FaceInfo, { planar: true }>): Vec3 | undefined {
  const sum = body.normalSum.get(id);
  if (!sum) return undefined;
  const side = dot3(sum, info.normal);
  if (side === 0) return undefined;
  const flipped = mul3(info.normal, Math.sign(side));
  return [flipped[0] + 0, flipped[1] + 0, flipped[2] + 0]; // bez záporné nuly
}

// Souřadný systém skici na stěně: počátek a osa Y analyticky, normála ven z tělesa, X = Y × N.
export function faceFrame(body: BodyData, id: number, info: FaceInfo): Frame | IssueCode {
  if (!body.normalSum.has(id)) return 'brokenReference';
  if (!info.planar) return 'nonPlanarFace';
  const normal = outward(body, id, info);
  if (!normal) return 'brokenReference';
  return { origin: info.origin, x: cross3(info.y, normal), y: info.y, normal };
}

// Promítne hranu tělesa do roviny skici. Přímka hrany se počítá analyticky z rovin obou stěn,
// ze sítě se bere jen rozsah; kružnice celá analyticky.
export function projectEdge(body: BodyData, name: EdgeName, kind: ProjectionKind, frame: Frame, faceInfos: FaceInfo[]): Projected | IssueCode {
  const edge = body.edges.get(edgeKey(name));
  if (!edge) return 'brokenProjection';
  if (edge.kind !== kind) return 'unsupportedProjection'; // coplanar, other, nebo jiný druh, než se uložilo
  const [a, b] = [faceInfos[edge.a], faceInfos[edge.b]];
  if (edge.kind === 'line' && a.planar && b.planar) {
    const [na, nb] = [outward(body, edge.a, a), outward(body, edge.b, b)];
    if (!na || !nb) return 'brokenProjection';
    // Orientace n_a × n_b; bod `<id>/a` je konec s menším parametrem v tomto směru.
    const d = cross3(na, nb);
    const [da, db] = [dot3(na, a.origin), dot3(nb, b.origin)];
    const point = mul3(add3(mul3(cross3(nb, d), da), mul3(cross3(d, na), db)), 1 / dot3(d, d));
    const direction = unit3(d);
    let [low, high] = [Infinity, -Infinity];
    for (let i = 0; i < edge.segments.length; i += 3) {
      const t = dot3(sub3([edge.segments[i], edge.segments[i + 1], edge.segments[i + 2]], point), direction);
      low = Math.min(low, t);
      high = Math.max(high, t);
    }
    const [start, end] = [toPlane(frame, add3(point, mul3(direction, low))), toPlane(frame, add3(point, mul3(direction, high)))];
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= LENGTH_TOLERANCE) return 'degenerateProjection'; // hrana kolmá na rovinu
    return { kind: 'line', a: start, b: end };
  }
  if (edge.kind === 'circle') {
    const [plane, cylinder] = a.planar ? [a, b as Extract<FaceInfo, { planar: false }>] : [b as Extract<FaceInfo, { planar: true }>, a as Extract<FaceInfo, { planar: false }>];
    if (len3(cross3(cylinder.axis, frame.normal)) > Math.sin(ANGLE_TOLERANCE)) return 'unsupportedProjection'; // elipsa nebo úsečka
    const t = dot3(plane.normal, sub3(plane.origin, cylinder.center)) / dot3(plane.normal, cylinder.axis);
    return { kind: 'circle', center: toPlane(frame, add3(cylinder.center, mul3(cylinder.axis, t))), radius: cylinder.radius };
  }
  return 'unsupportedProjection';
}

// ---------------------------------------------------------------- export

// Binární STL všech těles.
export function toStl(solids: Solid[]): Uint8Array {
  const count = solids.reduce((sum, s) => sum + s.triangles.length / 3, 0);
  const bytes = new Uint8Array(84 + 50 * count);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  let offset = 84;
  for (const s of solids) {
    const at = (i: number): Vec3 => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
    for (let t = 0; t < s.triangles.length; t += 3) {
      const v = [at(s.triangles[t]), at(s.triangles[t + 1]), at(s.triangles[t + 2])];
      const raw = cross3(sub3(v[1], v[0]), sub3(v[2], v[0]));
      const normal = len3(raw) > 0 ? unit3(raw) : raw;
      for (const vector of [normal, ...v]) for (const value of vector) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      offset += 2;
    }
  }
  return bytes;
}
