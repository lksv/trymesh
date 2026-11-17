// A mesh as numbers (D55): the base64 codec of a stored mesh, the weld of the corners of a file,
// the wall between two solids stacked in one file, the shells of a mesh and what they are, and the
// checks of a stored mesh. One function judges a mesh (`meshProblem`) for the importer, for the
// command addMesh and for a load. Nothing here reads the recompute, the kernel or the document.
import { MAX_NUMBER } from './catalog';
import { closestOnTriangle } from './mesh-distance';
import type { StoredMesh, Vec3 } from './types';
import { cross3, dot3, len3, sub3 } from './util';
import { fail } from './validation';

// A mesh as code reads it.
export interface IndexedMesh {
  positions: Float32Array; // x, y, z per vertex
  triangles: Uint32Array; // three vertex numbers per triangle
}

export const MESH_LIMITS = {
  // The most triangles of a mesh that an import reads and `addMesh` stores. Provisional (it may be
  // lowered): it keeps a document, a load and a first look at a body within reason. It does not
  // keep a query under a given time: a real collision with a mesh of 38 000 triangles takes 3 to
  // 19 s by its depth, with 105 000 triangles 18 to 55 s.
  triangles: 100_000,
  // The most triangles of a stored mesh that a load accepts. Never lowered, so that a document saved
  // under a higher limit of an import still loads; at least `triangles`.
  stored: 100_000,
  // The fewest: a tetrahedron.
  fewest: 4,
  // An import adds a note to its report above this: seconds per real collision with the body.
  note: 20_000,
  // A shell encloses something when its mean thickness (twice its volume over its surface) is
  // above this part of its own size (the largest side of its own bounds). A policy.
  thinnest: 1e-6,
  // The most work of judging the shells of one mesh (`shellsOf`): every entry of the grid of their
  // bounds, every bounds tested, every distance and every solid angle. Never lowered: a load checks it.
  work: 10_000_000,
} as const;

// What is wrong with the edges of a mesh that is not closed.
export interface MeshDefects {
  open: number; // edges with one triangle: a hole, or a seam that is not welded
  overused: number; // edges with more than two triangles: two solids that share an edge
  misoriented: number; // edges whose two triangles run the same way: a part is turned over
}

// Why a mesh cannot be stored. The codes are those of a refused import.
export interface MeshProblem {
  code: 'tooLarge' | 'notASolid';
  message: string;
  defects?: MeshDefects; // when the edges are the reason
}

// A connected piece of the surface (triangles joined through shared edges) and what it is, by the
// winding of the other shells at a test point of it:
// - `solid`: faces outwards, no other shell around it;
// - `hollow`: faces inwards, inside the material of another shell;
// - `insideOut`: faces inwards with no shell around it (refused by a check; the importer turns it over);
// - `nested`: faces outwards inside the material of another shell (a hollow written outwards, or a
//   part inside a part; read and reported);
// - `undecided`: no test point away from the other shells, or a negative winding (refused).
export interface MeshShell {
  triangles: number;
  volume: number; // signed: negative when the shell faces inwards
  area: number;
  kind: 'solid' | 'hollow' | 'insideOut' | 'nested' | 'undecided';
}

// The work of judging the shells went above `MESH_LIMITS.work`.
export class MeshLimit extends Error {
  readonly problem: MeshProblem;
  constructor(message: string) {
    super(message);
    this.problem = { code: 'tooLarge', message };
  }
}

// ---------------------------------------------------------------- base64

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LETTERS = Uint8Array.from(ALPHABET, (letter) => letter.charCodeAt(0));
const VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUES[ALPHABET.charCodeAt(i)] = i;
const PAD = '='.charCodeAt(0);

// Bytes as base64 in the canonical form (RFC 4648, section 4, padded).
export function toBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(4 * Math.ceil(bytes.length / 3));
  let o = 0;
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = LETTERS[n >> 18];
    out[o++] = LETTERS[(n >> 12) & 63];
    out[o++] = LETTERS[(n >> 6) & 63];
    out[o++] = LETTERS[n & 63];
  }
  const rest = bytes.length - i;
  if (rest > 0) {
    const n = (bytes[i] << 16) | (rest === 2 ? bytes[i + 1] << 8 : 0);
    out[o++] = LETTERS[n >> 18];
    out[o++] = LETTERS[(n >> 12) & 63];
    out[o++] = rest === 2 ? LETTERS[(n >> 6) & 63] : PAD;
    out[o++] = PAD;
  }
  let text = '';
  for (let at = 0; at < out.length; at += 0x8000) text += String.fromCharCode(...out.subarray(at, at + 0x8000));
  return text;
}

// The bytes of a text in the canonical form of base64; anything else (white space, another
// alphabet, a padding that is missing or inside, bits set that no byte uses) is refused, so that one
// mesh has one spelling.
export function fromBase64(text: string, what: string): Uint8Array {
  const length = text.length;
  if (length % 4 !== 0) return fail(`${what}: base64 in its canonical form is expected (a length divisible by 4, padded with "="); the text has ${length} characters`);
  const pad = length === 0 ? 0 : text.charCodeAt(length - 1) === PAD ? (text.charCodeAt(length - 2) === PAD ? 2 : 1) : 0;
  const out = new Uint8Array((length / 4) * 3 - pad);
  const value = (at: number): number => {
    const code = text.charCodeAt(at);
    const found = code < 128 ? VALUES[code] : -1;
    return found >= 0 ? found : fail(`${what}: the character ${JSON.stringify(text[at])} at ${at} is not one of base64 (A–Z, a–z, 0–9, +, /, and "=" only at the end)`);
  };
  let o = 0;
  for (let at = 0; at < length; at += 4) {
    const last = at + 4 === length;
    const a = value(at);
    const b = value(at + 1);
    const c = last && pad === 2 ? 0 : value(at + 2);
    const d = last && pad >= 1 ? 0 : value(at + 3);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = n >> 16;
    if (!(last && pad === 2)) out[o++] = (n >> 8) & 255;
    if (!(last && pad >= 1)) out[o++] = n & 255;
    if (last && ((pad === 2 && (b & 15) !== 0) || (pad === 1 && (c & 3) !== 0))) fail(`${what}: the last characters of the base64 set bits that no byte uses (not the canonical form)`);
  }
  return out;
}

// ---------------------------------------------------------------- the two forms of a mesh

// A mesh in the form the document stores: the two arrays as little-endian bytes in base64.
export function storedMesh(mesh: IndexedMesh, name?: string): StoredMesh {
  const positions = new Uint8Array(4 * mesh.positions.length);
  const triangles = new Uint8Array(4 * mesh.triangles.length);
  const [p, t] = [new DataView(positions.buffer), new DataView(triangles.buffer)];
  for (let i = 0; i < mesh.positions.length; i++) p.setFloat32(4 * i, mesh.positions[i] + 0, true);
  for (let i = 0; i < mesh.triangles.length; i++) t.setUint32(4 * i, mesh.triangles[i], true);
  return { ...(name === undefined ? {} : { name }), positions: toBase64(positions), triangles: toBase64(triangles) };
}

const DECODED = new WeakMap<StoredMesh, IndexedMesh>();
// A stored mesh as numbers. Kept by the entry object, so an entry is decoded once. Throws
// `CommandError` for a text that is not canonical base64 or does not hold whole triples of numbers.
export function indexedMesh(stored: StoredMesh, what = 'mesh'): IndexedMesh {
  const known = DECODED.get(stored);
  if (known) return known;
  const [p, t] = [fromBase64(stored.positions, `${what}.positions`), fromBase64(stored.triangles, `${what}.triangles`)];
  if (p.length % 12 !== 0) fail(`${what}.positions: ${p.length} bytes are not whole triples of 4-byte numbers (x, y, z per vertex)`);
  if (t.length % 12 !== 0) fail(`${what}.triangles: ${t.length} bytes are not whole triples of 4-byte numbers (three vertex numbers per triangle)`);
  const [pv, tv] = [new DataView(p.buffer), new DataView(t.buffer)];
  const positions = new Float32Array(p.length / 4);
  const triangles = new Uint32Array(t.length / 4);
  for (let i = 0; i < positions.length; i++) positions[i] = pv.getFloat32(4 * i, true);
  for (let i = 0; i < triangles.length; i++) triangles[i] = tv.getUint32(4 * i, true);
  const mesh = { positions, triangles };
  DECODED.set(stored, mesh);
  return mesh;
}

// ---------------------------------------------------------------- measures

const corner = (mesh: IndexedMesh, t: number, k: number): Vec3 => {
  const v = 3 * mesh.triangles[3 * t + k];
  return [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]];
};

// The signed volume of triangles of a mesh (all of them without a list): positive when they face outwards.
export function meshVolume(mesh: IndexedMesh, triangles?: ArrayLike<number>): number {
  const p = mesh.positions;
  const count = triangles ? triangles.length : mesh.triangles.length / 3;
  let volume = 0;
  for (let i = 0; i < count; i++) {
    const t = triangles ? triangles[i] : i;
    const [a, b, c] = [3 * mesh.triangles[3 * t], 3 * mesh.triangles[3 * t + 1], 3 * mesh.triangles[3 * t + 2]];
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return volume / 6;
}

// The box of the vertices of a mesh along the axes.
export function meshBounds(mesh: IndexedMesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], mesh.positions[i]);
    max[i % 3] = Math.max(max[i % 3], mesh.positions[i]);
  }
  return { min: min.map((x) => x + 0) as Vec3, max: max.map((x) => x + 0) as Vec3 };
}

// The largest coordinate of a mesh.
const reachOf = (mesh: IndexedMesh): number => mesh.positions.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);

// The key of an undirected edge; `n` is above every vertex number.
const edgeKeyOf = (a: number, b: number, n: number): number => (a < b ? a * n + b : b * n + a);
const vertexBound = (mesh: IndexedMesh): number => Math.max(mesh.positions.length / 3, mesh.triangles.reduce((largest, v) => Math.max(largest, v + 1), 0));

// What is wrong with the edges of a mesh: every edge has to be in exactly two triangles, once each way.
export function meshDefects(mesh: IndexedMesh): MeshDefects {
  const n = vertexBound(mesh);
  // per edge: how many triangles run it from its smaller vertex, and how many the other way
  const forward = new Map<number, number>();
  const backward = new Map<number, number>();
  for (let t = 0; t < mesh.triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [mesh.triangles[3 * t + k], mesh.triangles[3 * t + ((k + 1) % 3)]];
      const key = edgeKeyOf(a, b, n);
      const counts = a < b ? forward : backward;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!(a < b ? backward : forward).has(key)) (a < b ? backward : forward).set(key, 0);
    }
  }
  const defects: MeshDefects = { open: 0, overused: 0, misoriented: 0 };
  for (const [key, ahead] of forward) {
    const back = backward.get(key) ?? 0;
    const total = ahead + back;
    if (total === 1) defects.open++;
    else if (total > 2) defects.overused++;
    else if (ahead !== 1) defects.misoriented++;
  }
  return defects;
}
const closed = (defects: MeshDefects): boolean => defects.open === 0 && defects.overused === 0 && defects.misoriented === 0;

// The connected pieces of a mesh, joined through shared edges (as the library and `pieces` of
// solid.ts count them: pieces that meet in a vertex only are two), each a list of triangles in
// the order of the mesh; the pieces in the order of their first triangles.
export function meshPieces(mesh: IndexedMesh): number[][] {
  const count = mesh.triangles.length / 3;
  const n = vertexBound(mesh);
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const first = new Map<number, number>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKeyOf(mesh.triangles[3 * t + k], mesh.triangles[3 * t + ((k + 1) % 3)], n);
      const other = first.get(key);
      if (other === undefined) first.set(key, t);
      else {
        const [x, y] = [find(t), find(other)];
        if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    const root = find(t);
    const group = groups.get(root);
    if (group) group.push(t);
    else groups.set(root, [t]);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- the weld

// Corners (nine numbers a triangle, in millimetres) welded into an indexed mesh: corners at the same
// float32 position (−0 taken as 0) are one vertex, numbered in the order they first appear. A
// triangle that loses a corner by it is left out and counted. No tolerance.
export function weld(corners: Float32Array): { mesh: IndexedMesh; dropped: number } {
  const bits = new Uint32Array(1);
  const one = new Float32Array(bits.buffer);
  const word = (value: number): number => {
    one[0] = value === 0 ? 0 : value;
    return bits[0];
  };
  const index = new Map<string, number>();
  const positions: number[] = [];
  const triangles: number[] = [];
  let dropped = 0;
  for (let t = 0; t < corners.length / 9; t++) {
    const v: number[] = [];
    for (let k = 0; k < 3; k++) {
      const at = 9 * t + 3 * k;
      const [x, y, z] = [corners[at] + 0, corners[at + 1] + 0, corners[at + 2] + 0];
      const key = `${word(x)},${word(y)},${word(z)}`;
      let found = index.get(key);
      if (found === undefined) {
        index.set(key, (found = positions.length / 3));
        positions.push(x, y, z);
      }
      v.push(found);
    }
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) dropped++;
    else triangles.push(...v);
  }
  // a vertex only a dropped triangle had is no vertex of the mesh
  return { mesh: compact({ positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles) }), dropped };
}

// The mesh without the positions no triangle names; the others keep their order.
export function compact(mesh: IndexedMesh): IndexedMesh {
  const vertices = mesh.positions.length / 3;
  const renumbered = new Int32Array(vertices).fill(-1);
  let next = 0;
  for (const v of mesh.triangles) if (renumbered[v] < 0) renumbered[v] = 0; // named
  for (let v = 0; v < vertices; v++) if (renumbered[v] === 0) renumbered[v] = next++ + 1;
  if (next === vertices) return mesh;
  const positions = new Float32Array(3 * next);
  for (let v = 0; v < vertices; v++) if (renumbered[v] > 0) positions.set(mesh.positions.subarray(3 * v, 3 * v + 3), 3 * (renumbered[v] - 1));
  return { positions, triangles: mesh.triangles.map((v) => renumbered[v] - 1) };
}

// The mesh with the triangles of the list (all of them without one) turned over: inwards becomes outwards.
export function turned(mesh: IndexedMesh, which?: Iterable<number>): IndexedMesh {
  const triangles = Uint32Array.from(mesh.triangles);
  const swap = (t: number) => {
    [triangles[3 * t + 1], triangles[3 * t + 2]] = [triangles[3 * t + 2], triangles[3 * t + 1]];
  };
  if (which) for (const t of which) swap(t);
  else for (let t = 0; t < triangles.length / 3; t++) swap(t);
  return { positions: mesh.positions, triangles };
}

// ---------------------------------------------------------------- the wall between two solids

// Does triangle `t` run the edge from `a` to `b`?
const runs = (mesh: IndexedMesh, t: number, a: number, b: number): boolean => {
  for (let k = 0; k < 3; k++) if (mesh.triangles[3 * t + k] === a && mesh.triangles[3 * t + ((k + 1) % 3)] === b) return true;
  return false;
};

// The wall between two solids written one after the other with the same cut (the end caps and the
// stack of a stepper motor): a pair of triangles on the same three vertices that face opposite ways
// is a candidate (a group of more than two triangles on one set of vertices is none); candidates
// joined through shared edges make a wall. An edge of a wall is a border when a triangle not in the
// wall has it, inside when only triangles of the wall have it. A wall is left out, both layers of
// it, only when it has a border and along every edge of its border there are exactly two other
// triangles, running the edge opposite ways, one on each side of the wall: the one that runs the
// edge as the partner of a wall triangle there does lies behind that triangle or in its plane, the
// other in front of it or in its plane, not both in the plane ("in the plane": within 1e-6 of the
// largest coordinate of the mesh). Then the wall separates two solids that both face outwards.
// Otherwise its pairs stay, and the checks refuse the mesh for its edges. `walls` is the number of
// pairs left out; the positions nothing names afterwards go with them.
export function withoutWalls(mesh: IndexedMesh): { mesh: IndexedMesh; walls: number } {
  const count = mesh.triangles.length / 3;
  const n = vertexBound(mesh);
  const tri = (t: number): [number, number, number] => [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
  // pairs on the same three vertices, facing opposite ways
  const bySet = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    const key = tri(t)
      .slice()
      .sort((x, y) => x - y)
      .join(',');
    const group = bySet.get(key);
    if (group) group.push(t);
    else bySet.set(key, [t]);
  }
  const partner = new Int32Array(count).fill(-1);
  for (const group of bySet.values()) {
    if (group.length !== 2) continue;
    const [s, t] = group;
    const [a, b] = tri(s);
    // opposite when `t` runs the edge a → b the other way
    if (runs(mesh, t, b, a)) [partner[s], partner[t]] = [t, s];
  }
  if (!partner.some((p) => p >= 0)) return { mesh, walls: 0 };
  // the triangles at every edge
  const atEdge = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const key = edgeKeyOf(mesh.triangles[3 * t + k], mesh.triangles[3 * t + ((k + 1) % 3)], n);
      const list = atEdge.get(key);
      if (list) list.push(t);
      else atEdge.set(key, [t]);
    }
  }
  // the walls: candidates joined through shared edges
  const parent = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (x: number, y: number) => {
    const [a, b] = [find(x), find(y)];
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (const list of atEdge.values()) {
    const candidates = list.filter((t) => partner[t] >= 0);
    for (let i = 1; i < candidates.length; i++) join(candidates[0], candidates[i]);
  }
  const walls = new Map<number, number[]>();
  for (let t = 0; t < count; t++) {
    if (partner[t] < 0) continue;
    const root = find(t);
    const wall = walls.get(root);
    if (wall) wall.push(t);
    else walls.set(root, [t]);
  }
  const eps = 1e-6 * reachOf(mesh);
  const third = (t: number, a: number, b: number): number => tri(t).find((v) => v !== a && v !== b) as number;
  const point = (v: number): Vec3 => [mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]];
  // the signed distance of a point from the plane of triangle `t` along its normal; undefined for a triangle without an area
  const side = (t: number, p: Vec3): number | undefined => {
    const [a, b, c] = tri(t).map(point);
    const normal = cross3(sub3(b, a), sub3(c, a));
    const length = len3(normal);
    return length > 0 ? dot3(sub3(p, a), normal) / length : undefined;
  };
  const left = new Uint8Array(count);
  let removed = 0;
  for (const wall of walls.values()) {
    const inWall = new Set(wall);
    let border = false;
    let separates = true;
    const seen = new Set<number>();
    for (const t of wall) {
      if (!separates) break;
      const [x, y, z] = tri(t);
      for (const [a, b] of [
        [x, y],
        [y, z],
        [z, x],
      ]) {
        const key = edgeKeyOf(a, b, n);
        if (seen.has(key)) continue;
        seen.add(key);
        const others = (atEdge.get(key) as number[]).filter((o) => !inWall.has(o));
        if (others.length === 0) continue; // an edge inside the wall
        border = true;
        if (others.length !== 2) {
          separates = false;
          break;
        }
        // the two others run the edge opposite ways
        const [o1, o2] = others;
        if (runs(mesh, o1, a, b) === runs(mesh, o2, a, b)) {
          separates = false;
          break;
        }
        // for every wall triangle at the edge: the other that runs the edge as its partner does lies
        // behind it or in its plane, the one that runs it as the wall triangle does in front of it or in its plane
        for (const w of (atEdge.get(key) as number[]).filter((o) => inWall.has(o))) {
          const [p, q] = runs(mesh, w, a, b) ? [a, b] : [b, a];
          const behind = runs(mesh, o1, q, p) ? o1 : o2; // runs the edge as the partner of `w` does
          const front = behind === o1 ? o2 : o1;
          const [db, df] = [side(w, point(third(behind, a, b))), side(w, point(third(front, a, b)))];
          if (db === undefined || df === undefined || db > eps || df < -eps || (Math.abs(db) <= eps && Math.abs(df) <= eps)) {
            separates = false;
            break;
          }
        }
        if (!separates) break;
      }
    }
    if (border && separates) {
      for (const t of wall) left[t] = 1;
      removed += wall.length / 2;
    }
  }
  if (removed === 0) return { mesh, walls: 0 };
  const kept: number[] = [];
  for (let t = 0; t < count; t++) if (!left[t]) kept.push(...tri(t));
  return { mesh: compact({ positions: mesh.positions, triangles: Uint32Array.from(kept) }), walls: removed };
}

// ---------------------------------------------------------------- the shells

// A shell with what judging it found out: its triangles, and the shells that wind once (or more)
// around its test point, which are the shells that contain it.
export interface JudgedShell extends MeshShell {
  list: number[]; // its triangles
  containers: number[]; // indexes of the shells around its test point
}

// The shells of a mesh and what each is. Per shell a test point: the centroid of one of its
// triangles (in their order) further than 1e-6 of the size of the shell from every triangle of the
// other shells whose bounds hold it; at that point each other shell winds ±1 or 0 times (the sum of
// the solid angles of its triangles over 4π), and the rounded sum gives the kind (MeshShell). Only
// the shells whose bounds hold the point count (a closed shell winds 0 times outside its bounds);
// they are found through a grid of the bounds of the shells. All the work is counted in one fixed
// order; above `MESH_LIMITS.work` it throws `MeshLimit`. Meant for a closed mesh.
export function judgeShells(mesh: IndexedMesh, pieces: number[][] = meshPieces(mesh)): JudgedShell[] {
  let work = 0;
  const spend = (amount: number): void => {
    work += amount;
    if (work > MESH_LIMITS.work) throw new MeshLimit(`there are too many shells around one another to check: judging them would take more than ${MESH_LIMITS.work} steps`);
  };
  const shells = pieces.map((list) => {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    let area = 0;
    for (const t of list) {
      const [a, b, c] = [corner(mesh, t, 0), corner(mesh, t, 1), corner(mesh, t, 2)];
      area += len3(cross3(sub3(b, a), sub3(c, a))) / 2;
      for (const p of [a, b, c])
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], p[axis]);
          max[axis] = Math.max(max[axis], p[axis]);
        }
    }
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return { list, volume: meshVolume(mesh, list), area, min, max, size };
  });
  const count = shells.length;
  // the grid of the bounds: about one cell per shell
  const low: Vec3 = [Infinity, Infinity, Infinity];
  const high: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const shell of shells)
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], shell.min[axis]);
      high[axis] = Math.max(high[axis], shell.max[axis]);
    }
  const largest = Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2], 1e-30);
  const extent = [0, 1, 2].map((axis) => Math.max(high[axis] - low[axis], largest * 1e-9));
  const cell = Math.cbrt((extent[0] * extent[1] * extent[2]) / Math.max(count, 1));
  const cells = extent.map((e) => Math.min(Math.max(1, Math.ceil(e / cell)), Math.max(count, 1)));
  const cellOf = (value: number, axis: number): number => Math.min(cells[axis] - 1, Math.max(0, Math.floor(((value - low[axis]) / extent[axis]) * cells[axis])));
  const grid = new Map<number, number[]>();
  const cellKey = (i: number, j: number, k: number): number => (i * cells[1] + j) * cells[2] + k;
  if (count > 1)
    shells.forEach((shell, s) => {
      const [from, to] = [shell.min.map(cellOf), shell.max.map(cellOf)];
      spend((to[0] - from[0] + 1) * (to[1] - from[1] + 1) * (to[2] - from[2] + 1));
      for (let i = from[0]; i <= to[0]; i++)
        for (let j = from[1]; j <= to[1]; j++)
          for (let k = from[2]; k <= to[2]; k++) {
            const key = cellKey(i, j, k);
            const list = grid.get(key);
            if (list) list.push(s);
            else grid.set(key, [s]);
          }
    });
  // the other shells whose bounds, grown by `grow`, hold the point, in the order of the shells
  const around = (p: Vec3, self: number, grow: number): number[] => {
    const [from, to] = [p.map((value, axis) => cellOf(value - grow, axis)), p.map((value, axis) => cellOf(value + grow, axis))];
    const found = new Set<number>();
    for (let i = from[0]; i <= to[0]; i++)
      for (let j = from[1]; j <= to[1]; j++)
        for (let k = from[2]; k <= to[2]; k++) {
          const list = grid.get(cellKey(i, j, k)) ?? [];
          spend(list.length);
          for (const s of list) if (s !== self && [0, 1, 2].every((axis) => p[axis] >= shells[s].min[axis] - grow && p[axis] <= shells[s].max[axis] + grow)) found.add(s);
        }
    return [...found].sort((x, y) => x - y);
  };
  // the corners of every triangle and its box, read once
  const corners = new Float64Array(9 * (mesh.triangles.length / 3));
  for (let i = 0; i < mesh.triangles.length; i++) for (let axis = 0; axis < 3; axis++) corners[3 * i + axis] = mesh.positions[3 * mesh.triangles[i] + axis];
  const cornerOf = (u: number, k: number): Vec3 => [corners[9 * u + 3 * k], corners[9 * u + 3 * k + 1], corners[9 * u + 3 * k + 2]];
  // is the point within `eps` of the triangle `u`?
  const touches = (p: Vec3, u: number, eps: number): boolean => {
    const c = 9 * u;
    for (let axis = 0; axis < 3; axis++) {
      const [x, y, z] = [corners[c + axis], corners[c + 3 + axis], corners[c + 6 + axis]];
      if (p[axis] < Math.min(x, y, z) - eps || p[axis] > Math.max(x, y, z) + eps) return false;
    }
    return len3(sub3(p, closestOnTriangle(p, cornerOf(u, 0), cornerOf(u, 1), cornerOf(u, 2)))) <= eps;
  };
  // the solid angle of the triangle `u` seen from the point (Van Oosterom and Strackee)
  const angleOf = (p: Vec3, u: number): number => {
    const c = 9 * u;
    const [ax, ay, az] = [corners[c] - p[0], corners[c + 1] - p[1], corners[c + 2] - p[2]];
    const [bx, by, bz] = [corners[c + 3] - p[0], corners[c + 4] - p[1], corners[c + 5] - p[2]];
    const [cx, cy, cz] = [corners[c + 6] - p[0], corners[c + 7] - p[1], corners[c + 8] - p[2]];
    const [la, lb, lc] = [Math.sqrt(ax * ax + ay * ay + az * az), Math.sqrt(bx * bx + by * by + bz * bz), Math.sqrt(cx * cx + cy * cy + cz * cz)];
    const num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (ax * cx + ay * cy + az * cz) * lb + (bx * cx + by * cy + bz * cz) * la;
    return 2 * Math.atan2(num, den);
  };
  return shells.map((shell, s): JudgedShell => {
    const eps = 1e-6 * shell.size;
    let test: { point: Vec3; others: number[] } | undefined;
    for (const t of shell.list) {
      if (count === 1) {
        test = { point: [0, 0, 0], others: [] };
        break;
      }
      const [a, b, c] = [cornerOf(t, 0), cornerOf(t, 1), cornerOf(t, 2)];
      const point: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const others = around(point, s, eps);
      let near = false;
      for (const other of others) {
        spend(shells[other].list.length);
        near = shells[other].list.some((u) => touches(point, u, eps));
        if (near) break;
      }
      if (!near) {
        test = { point, others };
        break;
      }
    }
    const outward = shell.volume >= 0;
    const base = { list: shell.list, triangles: shell.list.length, volume: shell.volume, area: shell.area };
    if (!test) return { ...base, kind: 'undecided', containers: [] };
    let sum = 0;
    const containers: number[] = [];
    for (const other of test.others) {
      spend(shells[other].list.length);
      let angle = 0;
      for (const u of shells[other].list) angle += angleOf(test.point, u);
      const winding = angle / (4 * Math.PI);
      sum += winding;
      if (Math.round(winding) !== 0) containers.push(other);
    }
    const total = Math.round(sum);
    const kind: MeshShell['kind'] = total < 0 ? 'undecided' : outward ? (total === 0 ? 'solid' : 'nested') : total === 0 ? 'insideOut' : 'hollow';
    return { ...base, kind, containers };
  });
}

// The shells of a mesh, each with its kind; the one operation of check 7. Throws `MeshLimit` above
// the bound of work. Meant for a closed mesh.
export const shellsOf = (mesh: IndexedMesh): MeshShell[] => judgeShells(mesh).map(({ triangles, volume, area, kind }) => ({ triangles, volume, area, kind }));

// ---------------------------------------------------------------- the checks of a stored mesh

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
export function defectsText(defects: MeshDefects): string {
  return [
    defects.open ? `${counted(defects.open, 'edge', 'edges')} with one triangle (a hole, or a seam that is not welded)` : '',
    defects.overused ? `${counted(defects.overused, 'edge', 'edges')} with more than two triangles (solids that share an edge)` : '',
    defects.misoriented ? `${counted(defects.misoriented, 'edge', 'edges')} whose two triangles run the same way (a part is turned over)` : '',
  ]
    .filter((part) => part !== '')
    .join(', ');
}

// Why a mesh cannot be stored; undefined when it can. `limit` is the most triangles:
// `MESH_LIMITS.triangles` for an import and addMesh, `MESH_LIMITS.stored` for a load. In this order:
// 1. more than `limit` triangles (`tooLarge`), fewer than a tetrahedron has, arrays that are not
//    whole triples;
// 2. a coordinate that is not finite or is beyond ±1e9;
// 3. an index without a position, a position no triangle names, a triangle that names a vertex twice;
// 4. not closed (`defects`);
// 5. a volume that is not positive;
// 6. a shell that encloses nothing: its mean thickness is not above `MESH_LIMITS.thinnest` of its size;
// 7. a shell inside out or undecided (`judgeShells`; more work than `MESH_LIMITS.work` is `tooLarge`).
// Every code but `tooLarge` is `notASolid`. `shells`: what the caller judged of this mesh already.
export function meshProblem(mesh: IndexedMesh, limit: number = MESH_LIMITS.triangles, shells?: JudgedShell[]): MeshProblem | undefined {
  const no = (message: string, defects?: MeshDefects): MeshProblem => ({ code: 'notASolid', message, ...(defects ? { defects } : {}) });
  const vertices = mesh.positions.length / 3;
  const count = mesh.triangles.length / 3;
  if (!Number.isInteger(vertices) || !Number.isInteger(count)) return no('the arrays of the mesh are not whole triples of numbers');
  if (count > limit) return { code: 'tooLarge', message: `the mesh has ${count} triangles, more than the ${limit} a mesh may have; simplify it outside` };
  if (count < MESH_LIMITS.fewest) return no(`the mesh has ${counted(count, 'triangle', 'triangles')}; a solid has at least ${MESH_LIMITS.fewest}`);
  for (let i = 0; i < mesh.positions.length; i++) {
    const value = mesh.positions[i];
    if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER) return no(`the coordinate ${'xyz'[i % 3]} of the vertex ${Math.floor(i / 3)} is ${value}, not a finite number within ±${MAX_NUMBER}`);
  }
  const named = new Uint8Array(vertices);
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [mesh.triangles[3 * t], mesh.triangles[3 * t + 1], mesh.triangles[3 * t + 2]];
    for (const v of [a, b, c]) {
      if (v >= vertices) return no(`the triangle ${t} names the vertex ${v}, and the mesh has ${vertices} vertices`);
      named[v] = 1;
    }
    if (a === b || b === c || a === c) return no(`the triangle ${t} names a vertex twice`);
  }
  const unnamed = named.indexOf(0);
  if (unnamed >= 0) return no(`the vertex ${unnamed} is in no triangle`);
  const defects = meshDefects(mesh);
  if (!closed(defects)) return no(`the mesh is not a closed solid: ${defectsText(defects)}`, defects);
  const volume = meshVolume(mesh);
  if (!(volume > 0)) return no(`the volume of the mesh is ${volume} mm³: its triangles face inwards (a solid has its corners counter-clockwise seen from outside)`);
  const pieces = shells ? shells.map((shell) => shell.list) : meshPieces(mesh);
  for (const [s, list] of pieces.entries()) {
    const size = boundsSize(mesh, list);
    const area = list.reduce((sum, t) => {
      const [a, b, c] = [corner(mesh, t, 0), corner(mesh, t, 1), corner(mesh, t, 2)];
      return sum + len3(cross3(sub3(b, a), sub3(c, a))) / 2;
    }, 0);
    const thickness = area > 0 ? (2 * Math.abs(meshVolume(mesh, list))) / area : 0;
    if (!(thickness > MESH_LIMITS.thinnest * size)) return no(`the shell ${s + 1} (of ${pieces.length}) encloses nothing: it is ${thickness.toPrecision(3)} mm thick on average, not more than a millionth of its size (${size.toPrecision(3)} mm)`);
  }
  let judged: JudgedShell[];
  try {
    judged = shells ?? judgeShells(mesh, pieces);
  } catch (error) {
    if (error instanceof MeshLimit) return error.problem;
    throw error;
  }
  for (const [s, shell] of judged.entries()) {
    if (shell.kind === 'insideOut') return no(`the shell ${s + 1} (of ${judged.length}) faces inwards and is not a hollow of another shell: it is inside out (a collision with it would be hidden)`);
    if (shell.kind === 'undecided') return no(`the shell ${s + 1} (of ${judged.length}) cannot be judged: no point of it lies away from the other shells, or the shells around it wind the wrong way`);
  }
  return undefined;
}

// The largest side of the bounds of triangles of a mesh.
function boundsSize(mesh: IndexedMesh, list: number[]): number {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const t of list)
    for (let k = 0; k < 3; k++) {
      const p = corner(mesh, t, k);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}
