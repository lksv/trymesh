// Vektory, roviny stěn a tolerance adaptéru.
import type { Solid } from '@trymesh/engine';

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / len(a));

// poloha vrcholu i
export const vertex = (s: Solid, i: number): V3 => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];
export const triangleCount = (s: Solid): number => s.triangles.length / 3;
export const corners = (s: Solid, t: number): [V3, V3, V3] => [
  vertex(s, s.triangles[3 * t]),
  vertex(s, s.triangles[3 * t + 1]),
  vertex(s, s.triangles[3 * t + 2]),
];

// Šířka trojúhelníku: výška na nejdelší stranu. `normal` je neznormovaný vektorový součin stran.
export function triWidth(v: [V3, V3, V3], normal: V3): number {
  const longest = Math.max(len(sub(v[1], v[0])), len(sub(v[2], v[1])), len(sub(v[0], v[2])));
  return longest === 0 ? 0 : len(normal) / longest;
}

// Tolerance adaptéru, vše odvozené z rozměru D: úhlopříčka obálky obou těles, nejméně však
// dvojnásobek největší souřadnice.
export interface Tolerances {
  tol: number; // co se ještě bere jako "v jedné rovině"
  overlap: number; // o kolik se stěna posune
  sliver: number; // užší trojúhelník zakřivené stěny se pro určení roviny nepoužije
  onPlane: number; // vrchol "leží v posunuté rovině"
  weld: number; // vrcholy blíž než tohle se sloučí
}

export function tolerances(...solids: Solid[]): Tolerances {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    for (let i = 0; i < s.positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], s.positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], s.positions[i]);
    }
  }
  // Přesnost float32 klesá se vzdáleností od počátku. Model daleko od počátku proto dostane
  // tolerance podle největší souřadnice, ne jen podle svého rozměru.
  const D = Math.max(len(sub(hi, lo)), 2 * Math.max(...lo.map(Math.abs), ...hi.map(Math.abs)));
  return { tol: D * 1e-5, overlap: D * 4e-5, sliver: D * 8e-5, onPlane: D * 5e-6, weld: D * 1e-6 };
}

export interface FaceTriangle {
  v: [V3, V3, V3];
  n: V3; // neznormovaná normála
}

export interface FittedFace {
  id: number;
  n: V3; // jednotková normála proložené roviny
  d: number; // rovina n·x = d
  planar: boolean;
  width: number; // šířka nejširšího trojúhelníku
  tris: FaceTriangle[];
}

// Proloží rovinu každé stěně (podle čísla stěny). Rovinná je stěna, jejíž vrcholy leží do `tol`
// od proložené roviny. Podle normál jednotlivých trojúhelníků se rozhodovat nesmí: úzký trojúhelník
// vzniklý booleanem má normálu nespolehlivou a celou stěnu by označil za nerovinnou.
export function fitFaces(s: Solid, tol: number): Map<number, FittedFace> {
  const groups = new Map<number, { tris: FaceTriangle[]; sum: V3 }>();
  for (let t = 0; t < triangleCount(s); t++) {
    const v = corners(s, t);
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    let g = groups.get(s.faceIds[t]);
    if (!g) groups.set(s.faceIds[t], (g = { tris: [], sum: [0, 0, 0] }));
    g.tris.push({ v, n });
    g.sum = add(g.sum, n);
  }
  const out = new Map<number, FittedFace>();
  for (const [id, g] of groups) {
    if (len(g.sum) === 0) continue;
    const n = unit(g.sum);
    let area = 0;
    let d = 0;
    let width = 0;
    for (const tri of g.tris) {
      const a = len(tri.n) / 2;
      area += a;
      d += a * dot(n, mul(add(add(tri.v[0], tri.v[1]), tri.v[2]), 1 / 3));
      width = Math.max(width, triWidth(tri.v, tri.n));
    }
    if (area === 0) continue;
    d /= area;
    let deviation = 0;
    for (const tri of g.tris) for (const p of tri.v) deviation = Math.max(deviation, Math.abs(dot(n, p) - d));
    // Stěna složená jen z úzkých zbytků nemá spolehlivou normálu; proto se vrací i `width`.
    out.set(id, { id, n, d, planar: deviation <= tol, width, tris: g.tris });
  }
  return out;
}
