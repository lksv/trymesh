// Náhodné testy adaptéru. Generuje posloupnosti sjednocení a rozdílů kvádrů, trojbokých hranolů
// a válců, jejichž stěny často lícují, dosedají nebo se částečně překrývají, v obecně natočené
// poloze. Výsledek porovnává se dvěma nezávislými orákuly:
//   - mřížkový model (jen kvádry): přesný objem a očekávaná čísla stěn s jejich plochami,
//   - 2D řezy (všechny případy): objem a povrch z průřezů po vrstvách.
import type { Solid } from '@trymesh/engine';
import { IDENTITY, type Loop, type PrismIds, type TestFrame, circle, describe, idsOf, inspect, kernel, prism, rect, rotation } from './testkit';

export type Random = () => number;
export function rng(seed: number): Random {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Random, items: T[]): T => items[Math.floor(r() * items.length)];

export function randomFrame(r: Random): TestFrame {
  if (r() < 0.2) return IDENTITY;
  const rotate = rotation(r() * 2 * Math.PI, r() * 2 * Math.PI, r() * 2 * Math.PI);
  return { o: [r() * 40 - 20, r() * 40 - 20, r() * 40 - 20], x: rotate([1, 0, 0]), y: rotate([0, 1, 0]), n: rotate([0, 0, 1]) };
}

// ---------------------------------------------------------------- mřížkový model

const X = [-10, 0, 10, 20, 30, 40, 50];
const Y = [-10, 0, 10, 20, 30, 40];
const Z = [-5, 0, 5, 10, 15, 20, 25];
const NX = X.length - 1;
const NY = Y.length - 1;
const NZ = Z.length - 1;
const cellIndex = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (k * NY + j) * NX + i);
const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]; // +x −x +y −y +z −z
const OPPOSITE = [1, 0, 3, 2, 5, 4];
const cellFaceArea = (i: number, j: number, k: number, d: number) =>
  d < 2 ? (Y[j + 1] - Y[j]) * (Z[k + 1] - Z[k]) : d < 4 ? (X[i + 1] - X[i]) * (Z[k + 1] - Z[k]) : (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]);
// číslo stěny nástroje podle směru vnější normály: pořadí stran hranolu je −y, +x, +y, −x
const toolLabel = (ids: PrismIds, d: number) => [ids.sides[1], ids.sides[3], ids.sides[2], ids.sides[0], ids.end, ids.start][d];

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}
// solid: buňky s materiálem; labels: pro každou hraniční stěnu buňky množina možných čísel stěn
interface Model {
  solid: Uint8Array;
  labels: Map<number, number[]>;
}

const eachCell = (fn: (i: number, j: number, k: number, c: number) => void) => {
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) fn(i, j, k, cellIndex(i, j, k));
};
const filled = (grid: Uint8Array, i: number, j: number, k: number) => {
  const c = cellIndex(i, j, k);
  return c >= 0 && grid[c] === 1;
};
function boxCells(b: Box): Uint8Array {
  const inside = new Uint8Array(NX * NY * NZ);
  eachCell((i, j, k, c) => {
    if (X[i] >= b.x0 && X[i + 1] <= b.x1 && Y[j] >= b.y0 && Y[j + 1] <= b.y1 && Z[k] >= b.z0 && Z[k + 1] <= b.z1) inside[c] = 1;
  });
  return inside;
}

function initialModel(box: Box, ids: PrismIds): Model {
  const solid = boxCells(box);
  const labels = new Map<number, number[]>();
  eachCell((i, j, k, c) => {
    if (!solid[c]) return;
    DIRS.forEach((d, q) => {
      if (!filled(solid, i + d[0], j + d[1], k + d[2])) labels.set(c * 6 + q, [toolLabel(ids, q)]);
    });
  });
  return { solid, labels };
}

function applyOp(model: Model, op: 'union' | 'difference', box: Box, ids: PrismIds): Model {
  const T = boxCells(box);
  const solid = new Uint8Array(model.solid.length);
  const labels = new Map<number, number[]>();
  for (let c = 0; c < solid.length; c++) solid[c] = op === 'union' ? model.solid[c] | T[c] : model.solid[c] & ~T[c] & 1;
  eachCell((i, j, k, c) => {
    if (!solid[c]) return;
    DIRS.forEach((d, q) => {
      const n = cellIndex(i + d[0], j + d[1], k + d[2]);
      if (n >= 0 && solid[n]) return;
      const old = model.labels.get(c * 6 + q);
      const neighbourInTool = n >= 0 && T[n] === 1;
      let possible: number[];
      if (op === 'union') {
        const fromOld = model.solid[c] === 1 ? (old ?? []) : [];
        const fromTool = T[c] === 1 ? [toolLabel(ids, q)] : [];
        possible = [...fromOld, ...fromTool];
      } else {
        const wasEmpty = !(n >= 0 && model.solid[n] === 1);
        // nástroj jen dosedá zvenku, nebo nová stěna po nástroji
        possible = wasEmpty ? [...(old ?? []), ...(neighbourInTool ? [toolLabel(ids, OPPOSITE[q])] : [])] : [toolLabel(ids, OPPOSITE[q])];
      }
      labels.set(c * 6 + q, [...new Set(possible)]);
    });
  });
  return { solid, labels };
}

function modelStats(model: Model) {
  let volume = 0;
  const sure = new Map<number, number>(); // plocha, kterou stěna jistě má
  const maybe = new Map<number, number>(); // plocha, o kterou se dělí s jinou stěnou v téže rovině
  eachCell((i, j, k, c) => {
    if (!model.solid[c]) return;
    volume += (X[i + 1] - X[i]) * (Y[j + 1] - Y[j]) * (Z[k + 1] - Z[k]);
    for (let q = 0; q < 6; q++) {
      const ids = model.labels.get(c * 6 + q);
      if (!ids) continue;
      const target = ids.length === 1 ? sure : maybe;
      for (const id of ids) target.set(id, (target.get(id) ?? 0) + cellFaceArea(i, j, k, q));
    }
  });
  return { volume, sure, maybe };
}

// Těleso, které se dotýká samo sebe jen hranou nebo vrcholem, není uzavřená plocha: takové případy
// se u kvádrů negenerují.
function isManifold(solid: Uint8Array): boolean {
  for (let k = 0; k <= NZ; k++) {
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const cells: { p: number[]; s: boolean }[] = [];
        for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) cells.push({ p: [di, dj, dk], s: filled(solid, i + di, j + dj, k + dk) });
        for (const want of [true, false]) {
          const group = cells.filter((c) => c.s === want);
          if (group.length === 0 || group.length === 8) continue;
          const seen = new Set([0]);
          const stack = [0];
          while (stack.length) {
            const a = group[stack.pop() as number];
            group.forEach((b, bi) => {
              if (!seen.has(bi) && Math.abs(a.p[0] - b.p[0]) + Math.abs(a.p[1] - b.p[1]) + Math.abs(a.p[2] - b.p[2]) === 1) {
                seen.add(bi);
                stack.push(bi);
              }
            });
          }
          if (seen.size !== group.length) return false;
        }
      }
    }
  }
  return solid.includes(1);
}

// ---------------------------------------------------------------- generátor

export interface FuzzOp {
  op: 'union' | 'difference';
  kind: 'box' | 'circle' | 'triangle';
  ids: PrismIds;
  loop: Loop;
  nominal?: Loop; // obrys bez odchylky boku
  z0: number;
  z1: number;
}
export interface FuzzCase {
  frame: TestFrame;
  ops: FuzzOp[];
  model: Model | null; // jen když jsou všechny nástroje kvádry
  // Odchylka boku nad přesností float32 (3e-5) je mimo rozsah, pro který je adaptér navržený:
  // takový případ smí skončit chybou, ale ne potichu špatným výsledkem.
  mayReject: boolean;
}

function randomBox(r: Random): Box {
  const two = (levels: number[]) => {
    const a = Math.floor(r() * levels.length);
    let b = Math.floor(r() * levels.length);
    while (a === b) b = Math.floor(r() * levels.length);
    return [levels[Math.min(a, b)], levels[Math.max(a, b)]];
  };
  const [x0, x1] = two(X);
  const [y0, y1] = two(Y);
  const [z0, z1] = two(Z);
  return { x0, x1, y0, y1, z0, z1 };
}

export function generate(seed: number): FuzzCase {
  const r = rng(seed);
  const frame = randomFrame(r);
  const kindRoll = r();
  const withCircles = kindRoll < 0.3;
  const withTriangles = kindRoll >= 0.3 && kindRoll < 0.5;
  const base: Box = { x0: 0, x1: 40, y0: 0, y1: 30, z0: 0, z1: 10 };
  const baseIds: PrismIds = { start: 1, end: 2, sides: [3, 4, 5, 6] };
  let model = initialModel(base, baseIds);
  const ops: FuzzOp[] = [{ op: 'union', kind: 'box', ids: baseIds, loop: rect(0, 0, 40, 30), z0: 0, z1: 10 }];
  const count = 1 + Math.floor(r() * 4);
  const usedCircles: { cx: number; cy: number; radius: number; z0: number; z1: number }[] = [];
  let mayReject = false;
  for (let n = 1; n <= count; n++) {
    const ids: PrismIds = { start: 100 * n + 1, end: 100 * n + 2, sides: [100 * n + 3, 100 * n + 4, 100 * n + 5, 100 * n + 6] };
    const op = r() < 0.5 ? 'union' : 'difference';
    if (withCircles && r() < 0.5) {
      const cx = pick(r, [0, 10, 20, 30, 40]);
      const cy = pick(r, [0, 10, 20, 30]);
      const radius = pick(r, [4, 7]);
      const segments = pick(r, [16, 24]);
      const a = Math.floor(r() * Z.length);
      let b = Math.floor(r() * Z.length);
      if (a === b) b = (a + 1) % Z.length;
      const z0 = Z[Math.min(a, b)];
      const z1 = Z[Math.max(a, b)];
      // shodné válcové plochy (stejný střed i poloměr, překryv ve výšce) adaptér neřeší: negenerovat
      if (usedCircles.some((u) => u.cx === cx && u.cy === cy && u.radius === radius && u.z0 < z1 && z0 < u.z1)) {
        n--;
        continue;
      }
      usedCircles.push({ cx, cy, radius, z0, z1 });
      ops.push({ op, kind: 'circle', ids: { ...ids, sides: Array<number>(segments).fill(ids.sides[0]) }, loop: circle(cx, cy, radius, segments), z0, z1 });
      continue;
    }
    if (withTriangles && r() < 0.6) {
      // trojboký hranol: tři ze čtyř rohů obdélníku na mřížce; přepona dává šikmou stěnu,
      // která s přeponou jiného hranolu na stejné úhlopříčce lícuje nebo na ni dosedá
      const b = randomBox(r);
      const skip = Math.floor(r() * 4);
      ops.push({ op, kind: 'triangle', ids: { ...ids, sides: ids.sides.slice(0, 3) }, loop: rect(b.x0, b.y0, b.x1, b.y1).filter((_, i) => i !== skip), z0: b.z0, z1: b.z1 });
      continue;
    }
    let box: Box;
    let next: Model;
    let tries = 0;
    do {
      box = randomBox(r);
      next = applyOp(model, op, box, ids);
      tries++;
    } while (!isManifold(next.solid) && tries < 50);
    if (tries >= 50) break;
    model = next;
    // odchylka boku: 3e-6 napodobuje přichycení na bod s přesností float32, 3e-5 leží mezi
    // přesností float32 a tolerancí jádra
    const jitter = r() < 0.3 ? pick(r, [3e-6, -3e-6, 3e-5, -3e-5]) : 0;
    if (Math.abs(jitter) > 1e-5) mayReject = true;
    ops.push({ op, kind: 'box', ids, loop: rect(box.x0, box.y0, box.x1 + jitter, box.y1), nominal: rect(box.x0, box.y0, box.x1, box.y1), z0: box.z0, z1: box.z1 });
  }
  return { frame, ops, model: ops.some((o) => o.kind !== 'box') ? null : model, mayReject };
}

// ---------------------------------------------------------------- orákulum z 2D řezů

export function sliceOracle(ops: FuzzOp[]): { volume: number; area: number } {
  const { CrossSection } = kernel.wasm;
  type Section = InstanceType<typeof CrossSection>;
  const owned: Section[] = [];
  const keep = (s: Section) => {
    owned.push(s);
    return s;
  };
  // simplify: sjednocení mnohoúhelníků, které se dotýkají kolineárními hranami, nechává v obrysu
  // štěrbinu nulové šířky
  const perimeter = (section: Section) =>
    keep(section.simplify(1e-6))
      .toPolygons()
      .reduce((sum, polygon) => sum + polygon.reduce((t, p, i) => t + Math.hypot(polygon[(i + 1) % polygon.length][0] - p[0], polygon[(i + 1) % polygon.length][1] - p[1]), 0), 0);
  try {
    let volume = 0;
    let area = 0;
    let previous: Section | null = null;
    for (let k = 0; k < NZ; k++) {
      let section: Section | null = null;
      for (const op of ops) {
        if (!(op.z0 <= Z[k] && op.z1 >= Z[k + 1])) continue;
        const p = keep(new CrossSection([op.nominal ?? op.loop])); // bez odchylky: ta je pod tolerancí jádra
        section = section === null ? (op.op === 'difference' ? null : p) : keep(op.op === 'union' ? section.add(p) : section.subtract(p));
      }
      const height = Z[k + 1] - Z[k];
      const a = section ? section.area() : 0;
      volume += a * height;
      if (section) area += perimeter(section) * height;
      // vodorovné plochy mezi vrstvami: co je v jedné a není ve druhé
      if (previous || section) {
        const both = previous && section ? keep(previous.intersect(section)).area() : 0;
        area += (previous ? previous.area() : 0) + a - 2 * both;
      }
      previous = section;
    }
    if (previous) area += previous.area();
    return { volume, area };
  } finally {
    for (const s of owned) s.delete();
  }
}

// ---------------------------------------------------------------- běh a kontrola

export function run(ops: FuzzOp[], frame: TestFrame): Solid {
  let body: Solid | null = null;
  for (const op of ops) {
    const tool = prism(frame, op.loop, op.z0, op.z1, op.ids);
    body = body === null ? tool : kernel.boolean(op.op, body, tool);
  }
  return body as Solid;
}

// Kolik případů adaptér odmítl chybou místo výsledku: `strict` v návrhovém rozsahu, `loose` mimo něj.
export interface Rejections {
  strict: number;
  loose: number;
}

// Vrátí seznam nálezů; prázdný = případ prošel nebo ho adaptér odmítl vlastní chybou (neuzavřená
// nebo přeložená síť). Odmítnutí není špatný výsledek, ale počítá se a test hlídá, jak je časté.
export function check(seed: number, rejected?: Rejections): string[] {
  const c = generate(seed);
  let out: Solid;
  try {
    out = run(c.ops, c.frame);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (rejected && /not a closed surface|folded triangle/.test(message)) {
      rejected[c.mayReject ? 'loose' : 'strict']++;
      return [];
    }
    return [`výjimka: ${message}`];
  }
  const problems: string[] = [];
  const d = describe(out, c.frame);
  if (!d.closed) problems.push('síť není uzavřená');
  // Jádro síť načte, i když není v pořádku, a potichu ji změní. Proto se porovnává, co z ní udělalo.
  try {
    const loaded = inspect(out);
    if (loaded.status !== 'NoError') problems.push(`jádro výsledek nepřijme: ${loaded.status}`);
    else if (Math.abs(loaded.volume - d.volume) > 0.05) problems.push(`jádro výsledek načte jinak: objem ${loaded.volume.toFixed(3)} místo ${d.volume.toFixed(3)}`);
  } catch (error) {
    problems.push(`jádro výsledek nepřijme: ${String(error)}`);
  }
  if (!d.sound) problems.push('přeložený trojúhelník');
  const oracle = sliceOracle(c.ops);
  if (Math.abs(d.volume - oracle.volume) > 0.1) problems.push(`objem ${d.volume.toFixed(3)}, řezy dávají ${oracle.volume.toFixed(3)}`);
  if (Math.abs(d.area - oracle.area) > 0.1) problems.push(`povrch ${d.area.toFixed(3)}, řezy dávají ${oracle.area.toFixed(3)}`);
  if (c.model) {
    const m = modelStats(c.model);
    if (Math.abs(d.volume - m.volume) > 0.1) problems.push(`objem ${d.volume.toFixed(3)}, mřížka dává ${m.volume}`);
    for (const id of new Set([...d.faces.keys(), ...m.sure.keys(), ...m.maybe.keys()])) {
      const got = d.faces.get(id)?.area ?? 0;
      const lo = m.sure.get(id) ?? 0;
      const hi = lo + (m.maybe.get(id) ?? 0);
      if (got < lo - 0.05 || got > hi + 0.05) problems.push(`stěna ${id}: plocha ${got.toFixed(3)}, čekáno ${lo === hi ? lo : `${lo} až ${hi}`}`);
    }
  } else if (c.frame !== IDENTITY) {
    // s válci a trojbokými hranoly: čísla stěn se musí shodovat s během v osové poloze
    try {
      const reference = idsOf(run(c.ops, IDENTITY));
      const got = idsOf(out);
      if (JSON.stringify(reference) !== JSON.stringify(got)) problems.push(`stěny ${JSON.stringify(got)}, osově ${JSON.stringify(reference)}`);
    } catch (error) {
      problems.push(`výjimka v osové poloze: ${String(error)}`);
    }
  }
  return problems;
}

export const describeOps = (ops: FuzzOp[]): string =>
  ops.map((o) => `${o.op === 'union' ? '+' : '−'} ${o.kind} ${JSON.stringify(o.kind === 'circle' ? o.loop.length : o.loop)} z ${o.z0}..${o.z1} [${o.ids.start}..]`).join('; ');
