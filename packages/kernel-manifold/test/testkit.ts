// Pomůcky pro testy adaptéru: souřadné soustavy, stavba hranolů, popis výsledku.
import type { Solid } from '@trymesh/engine';
import { type ManifoldKernel, createManifoldKernel } from '../src/index';
import { type V3, corners, cross, dot, fitFaces, len, sub, tolerances, triWidth, triangleCount, unit } from '../src/geometry';

export const kernel: ManifoldKernel = await createManifoldKernel();

export type Loop = [number, number][];
export interface TestFrame {
  o: V3;
  x: V3;
  y: V3;
  n: V3;
}
export interface PrismIds {
  start: number; // víko ve výšce w0
  end: number; // víko ve výšce w1
  sides: number[]; // bok pro každou hranu obrysu
}

export const IDENTITY: TestFrame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };

export function rotation(a: number, b: number, c: number): (v: V3) => V3 {
  const rx = (v: V3): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v: V3): V3 => [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
  const rz = (v: V3): V3 => [v[0] * Math.cos(c) - v[1] * Math.sin(c), v[0] * Math.sin(c) + v[1] * Math.cos(c), v[2]];
  return (v) => rz(ry(rx(v)));
}
export function rotated(): TestFrame {
  const r = rotation((30 * Math.PI) / 180, (20 * Math.PI) / 180, (10 * Math.PI) / 180);
  return { o: [3.7, -1.3, 2.9], x: r([1, 0, 0]), y: r([0, 1, 0]), n: r([0, 0, 1]) };
}

export const rect = (x0: number, y0: number, x1: number, y1: number): Loop => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
export const circle = (cx: number, cy: number, r: number, n = 32): Loop =>
  Array.from({ length: n }, (_, i): [number, number] => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

// Hranol nad obrysem `loop` (proti směru hodin) mezi výškami w0 < w1 v soustavě `frame`.
export function prism(frame: TestFrame, loop: Loop, w0: number, w1: number, ids: PrismIds): Solid {
  const n = loop.length;
  const positions: number[] = [];
  const triangles: number[] = [];
  const faceIds: number[] = [];
  for (const w of [w0, w1]) {
    for (const [u, v] of loop) for (let k = 0; k < 3; k++) positions.push(frame.o[k] + u * frame.x[k] + v * frame.y[k] + w * frame.n[k]);
  }
  const cap = kernel.triangulate([Float64Array.from(loop.flat())]);
  for (let t = 0; t < cap.length; t += 3) {
    triangles.push(cap[t], cap[t + 2], cap[t + 1]);
    faceIds.push(ids.start);
  }
  for (let t = 0; t < cap.length; t += 3) {
    triangles.push(n + cap[t], n + cap[t + 1], n + cap[t + 2]);
    faceIds.push(ids.end);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triangles.push(i, j, n + j, i, n + j, n + i);
    faceIds.push(ids.sides[i], ids.sides[i]);
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: Uint32Array.from(faceIds) };
}

export interface FaceInfo {
  area: number;
  wMin: number; // rozsah výšek nad rovinou soustavy
  wMax: number;
}
export interface Description {
  faces: Map<number, FaceInfo>;
  volume: number;
  area: number;
  closed: boolean; // každá hrana právě ve dvou trojúhelnících
  sound: boolean; // žádná rovinná stěna nemá trojúhelník otočený proti své normále (přeložená síť)
}

export function describe(s: Solid, frame: TestFrame): Description {
  const faces = new Map<number, FaceInfo>();
  const edges = new Map<string, number>();
  let volume = 0;
  let area = 0;
  for (let t = 0; t < triangleCount(s); t++) {
    const v = corners(s, t);
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    volume += dot(v[0], n) / 6;
    area += len(n) / 2;
    let f = faces.get(s.faceIds[t]);
    if (!f) faces.set(s.faceIds[t], (f = { area: 0, wMin: Infinity, wMax: -Infinity }));
    f.area += len(n) / 2;
    for (const p of v) {
      const w = dot(sub(p, frame.o), frame.n);
      f.wMin = Math.min(f.wMin, w);
      f.wMax = Math.max(f.wMax, w);
    }
    for (let k = 0; k < 3; k++) {
      const p = s.triangles[3 * t + k];
      const q = s.triangles[3 * t + ((k + 1) % 3)];
      const key = p < q ? `${p}_${q}` : `${q}_${p}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const tol = tolerances(s);
  let sound = true;
  for (const face of fitFaces(s, tol.tol).values()) {
    if (!face.planar) continue;
    for (const tri of face.tris) if (triWidth(tri.v, tri.n) >= tol.weld && dot(unit(tri.n), face.n) < 0.99) sound = false;
  }
  return { faces, volume, area, closed: [...edges.values()].every((c) => c === 2), sound };
}

// Sousedí v síti trojúhelníky se stěnami p a q (mají společnou hranu)?
export function adjacent(s: Solid, p: number, q: number): boolean {
  const byEdge = new Map<string, number[]>();
  for (let t = 0; t < triangleCount(s); t++) {
    for (let k = 0; k < 3; k++) {
      const a = s.triangles[3 * t + k];
      const b = s.triangles[3 * t + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      byEdge.set(key, [...(byEdge.get(key) ?? []), s.faceIds[t]]);
    }
  }
  for (const ids of byEdge.values()) if (ids.includes(p) && ids.includes(q)) return true;
  return false;
}

export const idsOf = (s: Solid): number[] => [...new Set(s.faceIds)].sort((x, y) => x - y);
export const sorted = (ids: number[]): number[] => [...ids].sort((x, y) => x - y);

// Počet souvislých částí a objem podle jádra; objekty knihovny se uvolní.
export function inspect(s: Solid): { status: string; volume: number; components: number } {
  const m = kernel.toManifold(s);
  try {
    const parts = m.decompose();
    const result = { status: m.status(), volume: m.volume(), components: parts.length };
    for (const part of parts) part.delete();
    return result;
  } finally {
    m.delete();
  }
}
