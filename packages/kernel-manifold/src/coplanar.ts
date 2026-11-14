// Záruka č. 3 portu SolidKernel: tolerance ke stěnám v jedné rovině (docs/architecture.md).
// Stěny nástroje a tělesa v jedné rovině se nikde nesmějí jen dotýkat. Každý styk se před booleanem
// změní na skutečný průnik posunem stěny nástroje (prepareTool) a po booleanu se vše, co se posunulo,
// vrátí přesně na místo (restoreShifted).
import type { BooleanOp, Solid } from '@trymesh/engine';
import { clean } from './clean';
import {
  type FittedFace,
  type Tolerances,
  type V3,
  add,
  corners,
  cross,
  dot,
  fitFaces,
  len,
  mul,
  sub,
  triWidth,
  triangleCount,
  unit,
  vertex,
} from './geometry';

// Posun stěny nástroje: o kolik podél normály a z jaké původní roviny n·x = d.
export interface Shift {
  r: number;
  n: V3;
  d: number;
}

type Point2 = [number, number];

// Překrývají se dva trojúhelníky v rovině? (test oddělující osou; záporná rezerva = stačí i mezera)
function trianglesOverlap2D(A: Point2[], B: Point2[], margin: number): boolean {
  for (const [S, T] of [
    [A, B],
    [B, A],
  ]) {
    for (let i = 0; i < 3; i++) {
      const p = S[i];
      const q = S[(i + 1) % 3];
      const axis: Point2 = [-(q[1] - p[1]), q[0] - p[0]];
      const l = Math.hypot(axis[0], axis[1]);
      if (l === 0) continue;
      const project = (points: Point2[]) => points.map((r) => (r[0] * axis[0] + r[1] * axis[1]) / l);
      const s = project(S);
      const t = project(T);
      if (Math.min(Math.max(...s), Math.max(...t)) - Math.max(Math.min(...s), Math.min(...t)) <= margin) return false;
    }
  }
  return true;
}

function facesOverlap(fa: FittedFace, fb: FittedFace, margin: number): boolean {
  const u = unit(Math.abs(fb.n[0]) < 0.9 ? cross(fb.n, [1, 0, 0]) : cross(fb.n, [0, 1, 0]));
  const v = cross(fb.n, u);
  const flatten = (face: FittedFace) => face.tris.map((tri) => tri.v.map((p): Point2 => [dot(p, u), dot(p, v)]));
  const A = flatten(fa);
  const B = flatten(fb);
  for (const ta of A) for (const tb of B) if (trianglesOverlap2D(ta, tb, margin)) return true;
  return false;
}

// Nejkratší posun d, který splní podmínky n·d = r (ve smyslu nejmenších čtverců).
// Počítá se v ortonormální bázi prostoru normál, takže je stabilní i pro jedinou rovinu
// v obecné poloze; skoro rovnoběžné normály se berou jako jedna.
function minimalShift(list: { n: V3; r: number }[]): V3 {
  const basis: V3[] = [];
  for (const { n } of list) {
    let v = n;
    for (const e of basis) v = sub(v, mul(e, dot(v, e)));
    if (len(v) > 1e-3) basis.push(unit(v));
    if (basis.length === 3) break;
  }
  const k = basis.length;
  const G = Array.from({ length: k }, () => Array<number>(k + 1).fill(0)); // rozšířená matice normálních rovnic
  for (const { n, r } of list) {
    const a = basis.map((e) => dot(n, e));
    for (let p = 0; p < k; p++) {
      G[p][k] += a[p] * r;
      for (let q = 0; q < k; q++) G[p][q] += a[p] * a[q];
    }
  }
  for (let c = 0; c < k; c++) {
    // Gaussova eliminace s výběrem pivotu
    let pivot = c;
    for (let p = c + 1; p < k; p++) if (Math.abs(G[p][c]) > Math.abs(G[pivot][c])) pivot = p;
    [G[c], G[pivot]] = [G[pivot], G[c]];
    for (let p = 0; p < k; p++) {
      if (p === c) continue;
      const m = G[p][c] / G[c][c];
      for (let q = c; q <= k; q++) G[p][q] -= m * G[c][q];
    }
  }
  let d: V3 = [0, 0, 0];
  for (let c = 0; c < k; c++) d = add(d, mul(basis[c], G[c][k] / G[c][c]));
  return d;
}

// Posune vrcholy tak, aby stěna s číslem id dostala posun shiftOf(id) podél své normály
// a ostatní stěny zůstaly ve své rovině (vrchol jede po průsečnici sousedních stěn).
// Rovinná stěna vstupuje svou proloženou normálou. U zakřivené stěny se bere normála trojúhelníku.
// Trojúhelníky a stěny užší než `sliver` se vynechají: jejich normála je šum.
function moveVertices(b: Solid, faces: Map<number, FittedFace>, sliver: number, shiftOf: (id: number) => number): Float32Array {
  const constraints = new Map<number, { n: V3; r: number }[]>(); // vrchol → podmínky
  const push = (i: number, n: V3, r: number) => {
    let list = constraints.get(i);
    if (!list) constraints.set(i, (list = []));
    if (!list.some((c) => Math.abs(dot(c.n, n)) > 1 - 1e-9 && c.r === r * Math.sign(dot(c.n, n)))) list.push({ n, r });
  };
  for (let t = 0; t < triangleCount(b); t++) {
    const face = faces.get(b.faceIds[t]);
    let n: V3;
    if (face?.planar) {
      if (face.width < sliver) continue;
      n = face.n;
    } else {
      const v = corners(b, t);
      const normal = cross(sub(v[1], v[0]), sub(v[2], v[0]));
      if (triWidth(v, normal) < sliver) continue;
      n = unit(normal);
    }
    const r = shiftOf(b.faceIds[t]);
    for (let k = 0; k < 3; k++) push(b.triangles[3 * t + k], n, r);
  }
  const positions = Float32Array.from(b.positions);
  for (const [i, list] of constraints) {
    if (!list.some((c) => c.r !== 0)) continue;
    const d = minimalShift(list);
    for (let k = 0; k < 3; k++) positions[3 * i + k] = b.positions[3 * i + k] + d[k];
  }
  return positions;
}

// Vrátí kopii nástroje `b`, ve které jsou stěny ležící v rovině stěn tělesa `a` posunuté o přesah.
//   rozdíl:      lícuje (stejná orientace) → nástroj se zvětší;  dosedá zvenku → nástroj se zmenší
//   sjednocení:  lícuje i dosedá → nástroj se zvětší
// Průnik se neupravuje.
export function prepareTool(op: BooleanOp, a: Solid, b: Solid, t: Tolerances): { tool: Solid; shifts: Map<number, Shift> } {
  const shifts = new Map<number, Shift>(); // číslo stěny nástroje → posun
  if (op === 'intersection') return { tool: b, shifts };
  const bodyFaces = [...fitFaces(a, t.tol).values()].filter((f) => f.planar && f.width >= t.sliver);
  const toolFaces = fitFaces(b, t.tol);
  for (const B of toolFaces.values()) {
    if (!B.planar || B.width < t.sliver) continue;
    let chosen: number | null = null;
    let behind = Infinity; // vzdálenost nejbližší rovnoběžné stěny tělesa těsně za stěnou nástroje (směrem do nástroje)
    for (const A of bodyFaces) {
      const c = dot(A.n, B.n);
      if (Math.abs(c) < 1 - 1e-6) continue; // nejsou rovnoběžné
      const offset = c * A.d - B.d; // poloha stěny tělesa vůči stěně nástroje podél její normály
      if (Math.abs(offset) > t.tol) {
        // není v jedné rovině, ale zmenšený nástroj by ji mohl přeskočit
        if (offset < 0 && -offset <= t.overlap + t.tol && facesOverlap(A, B, -2 * t.overlap)) behind = Math.min(behind, -offset);
        continue;
      }
      const shift = op === 'difference' && c < 0 ? -t.overlap : t.overlap;
      // Jsou v jedné rovině, ale jinde? Stačí dotyk nebo mezera do dvou přesahů: bok nálitku se
      // boku tělesa dotýká jen hranou, a stěna, která se sama neposouvá, se posunem sousedních
      // stěn o přesah protáhne a dotkla by se až potom.
      if (!facesOverlap(A, B, -2 * t.overlap)) continue;
      // Stěna nástroje může ve stejné rovině potkat dvě opačně orientované stěny tělesa (horní
      // stěna a spodek převisu). Zvětšení má přednost: zmenšení by na lícující části nechalo blánu.
      if (shift > 0) {
        chosen = shift;
        break;
      }
      chosen ??= shift;
    }
    if (chosen === null) continue;
    // Zmenšený nástroj nesmí přeskočit stěnu tělesa, která leží těsně za jeho stěnou: materiál mezi
    // nimi by zůstal jako blána. Posune se jen do poloviny mezery.
    if (chosen < 0 && behind < Infinity) chosen = -Math.min(t.overlap, behind / 2);
    shifts.set(B.id, { r: chosen, n: B.n, d: B.d });
  }
  if (shifts.size === 0) return { tool: b, shifts };
  return { tool: { ...b, positions: moveVertices(b, toolFaces, t.sliver, (id) => shifts.get(id)?.r ?? 0) }, shifts };
}

interface Plane {
  v: [V3, V3, V3];
  n: V3;
  d: number;
}

// Po booleanu vrátí zpět vše, co po posunu stěn nástroje ve výsledku zůstalo, a síť vyčistí.
// Polohy se neodhadují z okolí, ale dopočítají přesně z původní, neposunuté geometrie. Každý vrchol
// výsledku je totiž buď vrchol jednoho z těles, nebo průsečík hrany jednoho tělesa se stěnou druhého:
//  - posunutý vrchol nástroje → původní vrchol nástroje,
//  - průsečík hrany nástroje, jejíž konec se posunul (včetně úhlopříček triangulace), se stěnou
//    tělesa → průsečík původní hrany s rovinou té stěny,
//  - průsečík hrany tělesa s posunutou stěnou nástroje, nebo jiný vrchol v pásu mezi původní
//    a posunutou rovinou → průsečík té hrany tělesa s původní rovinou.
// Průsečík, který by na původní hraně ležel mimo její konce, v přesné geometrii neexistuje;
// stáhne se do bližšího konce a čištění sítě ho pak sloučí.
// `original` je nástroj před posunem, `shifted` po posunu, `body` těleso, `out` výsledek booleanu.
export function restoreShifted(out: Solid, shifts: Map<number, Shift>, original: Solid, shifted: Solid, body: Solid, t: Tolerances): Solid {
  const toolIds = new Set(original.faceIds);
  const param = (p: V3, a: V3, b: V3): number => {
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    return l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
  };
  const clamp = (s: number) => Math.min(1, Math.max(0, s));
  const pointAt = (a: V3, b: V3, s: number): V3 => add(a, mul(sub(b, a), s));
  const eachEdge = (mesh: Solid, each: (i: number, j: number) => void) => {
    const seen = new Set<number>();
    for (let k = 0; k < triangleCount(mesh); k++) {
      for (let q = 0; q < 3; q++) {
        const i = mesh.triangles[3 * k + q];
        const j = mesh.triangles[3 * k + ((q + 1) % 3)];
        const key = i < j ? i * 4294967296 + j : j * 4294967296 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        each(i, j);
      }
    }
  };
  // Bod těsně u konce hrany se bere jako ten konec: u hrany, která rovinu protíná pod malým úhlem,
  // má poloha podél hrany chybu mnohem větší než přesnost souřadnic a vedle skutečného vrcholu by
  // vznikl druhý, příliš daleko na sloučení a příliš blízko na to, aby síť zůstala nepřeložená.
  const snapToEnd = (p: V3, a: V3, b: V3): V3 => (len(sub(p, a)) <= t.onPlane ? a : len(sub(p, b)) <= t.onPlane ? b : p);
  // průsečík úsečky a–b s rovinou n·x = d; mimo úsečku se bere bližší konec
  const hit = (a: V3, b: V3, n: V3, d: number): V3 | null => {
    const dir = sub(b, a);
    const den = dot(n, dir);
    if (Math.abs(den) < 1e-4 * len(dir)) return null; // hrana leží v rovině (nebo skoro): průsečík není určený
    return snapToEnd(pointAt(a, b, clamp((d - dot(n, a)) / den)), a, b);
  };

  const movedVertices: { now: V3; was: V3 }[] = [];
  for (let i = 0; i < original.positions.length / 3; i++) {
    const was = vertex(original, i);
    const now = vertex(shifted, i);
    if (len(sub(now, was)) > 0) movedVertices.push({ now, was });
  }
  const movedEdges: { a0: V3; b0: V3; a1: V3; b1: V3 }[] = [];
  eachEdge(original, (i, j) => {
    const a0 = vertex(original, i);
    const b0 = vertex(original, j);
    const a1 = vertex(shifted, i);
    const b1 = vertex(shifted, j);
    if (len(sub(a1, a0)) > 0 || len(sub(b1, b0)) > 0) movedEdges.push({ a0, b0, a1, b1 });
  });

  let bodyEdges: [V3, V3][] | null = null;
  let bodyPlanes: Map<number, Plane[]> | null = null;
  // trojúhelníky tělesa (se stěnou z ids), ve kterých bod p leží
  const bodyPlanesAt = (p: V3, ids: number[]): Plane[] => {
    if (!bodyPlanes) {
      bodyPlanes = new Map();
      for (let k = 0; k < triangleCount(body); k++) {
        const v = corners(body, k);
        const normal = cross(sub(v[1], v[0]), sub(v[2], v[0]));
        if (triWidth(v, normal) < t.weld) continue;
        const n = unit(normal);
        const id = body.faceIds[k];
        const list = bodyPlanes.get(id);
        if (list) list.push({ v, n, d: dot(n, v[0]) });
        else bodyPlanes.set(id, [{ v, n, d: dot(n, v[0]) }]);
      }
    }
    const found: Plane[] = [];
    for (const id of ids) {
      for (const tri of bodyPlanes.get(id) ?? []) {
        if (Math.abs(dot(tri.n, p) - tri.d) > t.onPlane) continue;
        let inside = true; // uvnitř trojúhelníku (s rezervou)?
        for (let q = 0; q < 3 && inside; q++) {
          const e = sub(tri.v[(q + 1) % 3], tri.v[q]);
          if (dot(cross(e, sub(p, tri.v[q])), tri.n) < -t.onPlane * len(e)) inside = false;
        }
        if (inside) found.push(tri);
      }
    }
    return found;
  };

  const incident = new Map<number, Set<number>>(); // vrchol → čísla stěn, kterých se dotýká
  for (let k = 0; k < triangleCount(out); k++) {
    for (let q = 0; q < 3; q++) {
      const i = out.triangles[3 * k + q];
      const set = incident.get(i);
      if (set) set.add(out.faceIds[k]);
      else incident.set(i, new Set([out.faceIds[k]]));
    }
  }
  const positions = Float32Array.from(out.positions);
  for (const [i, ids] of incident) {
    if (![...ids].some((id) => toolIds.has(id))) continue;
    const p = vertex(out, i);
    let target: V3 | null = null;
    const moved = movedVertices.find((v) => len(sub(p, v.now)) <= t.onPlane);
    if (moved) target = moved.was;
    else {
      // Hrana nástroje, na které vrchol leží. Počítá se jen tam, kde se hrana opravdu posunula:
      // u jejího neposunutého konce leží i vrcholy jiných hran, které se nevracejí.
      let edge: (typeof movedEdges)[number] | null = null;
      let nearest = Infinity;
      for (const e of movedEdges) {
        const s = clamp(param(p, e.a1, e.b1));
        const off = len(sub(p, pointAt(e.a1, e.b1, s)));
        if (off > t.onPlane || off >= nearest) continue;
        if (len(sub(pointAt(e.a1, e.b1, s), pointAt(e.a0, e.b0, s))) > t.onPlane) {
          edge = e;
          nearest = off;
        }
      }
      if (edge) {
        // Rovina stěny tělesa, kterou hrana protíná. Vrchol může ležet na více stěnách tělesa a hrana
        // v některé z nich může ležet celá (svislá hrana válce v rovině boku); bere se ta nejpříčnější.
        const dir = unit(sub(edge.b0, edge.a0));
        let plane: Plane | null = null;
        for (const c of bodyPlanesAt(p, [...ids].filter((id) => !toolIds.has(id)))) {
          if (!plane || Math.abs(dot(c.n, dir)) > Math.abs(dot(plane.n, dir))) plane = c;
        }
        // Když hrana žádnou stěnu tělesa příčně neprotíná: nejbližší bod původní hrany.
        target =
          (plane && hit(edge.a0, edge.b0, plane.n, plane.d)) ??
          snapToEnd(pointAt(edge.a0, edge.b0, clamp(param(p, edge.a0, edge.b0))), edge.a0, edge.b0);
      } else {
        const bands = [...shifts.values()].filter((shift) => {
          const along = (dot(shift.n, p) - shift.d) * Math.sign(shift.r);
          return along > t.onPlane && along <= Math.abs(shift.r) + t.onPlane;
        });
        if (bands.length === 0) continue;
        if (!bodyEdges) {
          const edges: [V3, V3][] = [];
          eachEdge(body, (a, b) => edges.push([vertex(body, a), vertex(body, b)]));
          bodyEdges = edges;
        }
        let bodyEdge: [V3, V3] | null = null;
        let bodyEdgeOff = Infinity;
        for (const e of bodyEdges) {
          const off = len(sub(p, pointAt(e[0], e[1], clamp(param(p, e[0], e[1])))));
          if (off <= t.onPlane && off < bodyEdgeOff) {
            bodyEdge = e;
            bodyEdgeOff = off;
          }
        }
        target = bodyEdge ? hit(bodyEdge[0], bodyEdge[1], bands[0].n, bands[0].d) : null;
        if (!target) {
          // kolmo do původních rovin
          target = p;
          for (const shift of bands) target = sub(target, mul(shift.n, dot(shift.n, target) - shift.d));
        }
      }
    }
    for (let k = 0; k < 3; k++) positions[3 * i + k] = target[k];
  }
  return clean({ ...out, positions }, t.weld);
}
