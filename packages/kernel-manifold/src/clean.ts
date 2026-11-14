// Úklid sítě po booleanu a kontrola, že výsledek je uzavřená plocha.
import type { Solid } from '@trymesh/engine';
import { type Tolerances, type V3, add, cross, dot, fitFaces, len, mul, sub, triWidth, triangleCount, unit } from './geometry';

type Tri = [number, number, number, number]; // tři vrcholy a číslo stěny

const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

// Vyčistí síť po booleanu. Pás, o který byla stěna posunutá, má po návratu nulovou šířku a zůstaly
// by po něm nulové trojúhelníky, které by dál nesly číslo zaniklé stěny.
//  1. Vrcholy blíž než eps se sloučí a trojúhelníky, které tím ztratily vrchol, se zahodí.
//  2. Nulové trojúhelníky (vrcholy v přímce) a blány (dvojice trojúhelníků na stejných vrcholech
//     s opačnou orientací) se zahodí.
//  3. Hrany, které tím zůstaly bez protějšku, se dorovnají: trojúhelník s takovou hranou a–b se
//     rozdělí ve vrcholu m, který na ní leží a ve kterém protější strana navazuje (T-spoj).
//     Kroky 2 a 3 se opakují, dokud nějaká hrana bez protějšku zbývá.
//     The two steps can undo each other: a split leaves a piece that step 2 takes for a null
//     triangle and drops, which opens the same edge again. The loop therefore remembers the
//     states it has split already and stops after splitting a repeated one (the split state is
//     the closed one of the two; without this the loop ran all its passes, seconds per boolean).
//  4. Kde sloučením srostly části povrchu, které se jen dotýkají, se vrcholy zase rozdělí.
// Dělí se jen hrany bez protějšku. Hrana, která protějšek má, je v pořádku, i když těsně u ní leží
// cizí vrchol; dělit ji podle vzdálenosti vrcholu od přímky vedlo ke střídání dvou neuzavřených stavů.
// Slučuje se podle polohy, ne jen po hranách: jinak by se nenašly blány ze dvou listů, které na
// sebe po návratu dolehly, a jádro by je při načtení sbalilo špatně. Cenou je krok 4.
// (Vyčištění průchodem přes Manifold se neosvědčilo: nulové trojúhelníky sbalil špatným směrem.)
export function clean(s: Solid, eps: number): Solid {
  const pos = s.positions;
  const vertexCount = pos.length / 3;
  const at = (i: number): V3 => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };

  // 1. sloučení podle polohy (mřížka s buňkou 4·eps, hledá se v sousedních buňkách)
  const grid = new Map<string, number[]>();
  for (let i = 0; i < vertexCount; i++) {
    const c = [0, 1, 2].map((k) => Math.floor(pos[3 * i + k] / (eps * 4)));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
            if (len(sub(at(i), at(j))) <= eps) parent[find(i)] = find(j);
          }
        }
      }
    }
    const key = c.join(',');
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }
  let tris: Tri[] = [];
  for (let t = 0; t < triangleCount(s); t++) {
    const tri: Tri = [find(s.triangles[3 * t]), find(s.triangles[3 * t + 1]), find(s.triangles[3 * t + 2]), s.faceIds[t]];
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[2] !== tri[0]) tris.push(tri);
  }

  // Nulový je trojúhelník, jehož vrcholy leží v přímce. Užší než eps/4 (přesnost float32) je nulový
  // vždy. Do šířky eps jen tehdy, když jeho prostřední vrchol leží zřetelně uvnitř nejdelší strany.
  // Tenký trojúhelník s krátkou základnou (jehla) nulový není: jeho dva blízké vrcholy zůstávají
  // různé a po zahození by po něm zbyla díra.
  const flat = (t: Tri): boolean => {
    const v: [V3, V3, V3] = [at(t[0]), at(t[1]), at(t[2])];
    const width = triWidth(v, cross(sub(v[1], v[0]), sub(v[2], v[0])));
    if (width < eps / 4) return true;
    if (width >= eps) return false;
    let k = 0; // nejdelší strana vede z v[k] do v[k + 1]
    for (let i = 1; i < 3; i++) if (len(sub(v[(i + 1) % 3], v[i])) > len(sub(v[(k + 1) % 3], v[k]))) k = i;
    const side = sub(v[(k + 1) % 3], v[k]);
    const along = dot(sub(v[(k + 2) % 3], v[k]), side) / len(side);
    return along > 8 * eps && along < len(side) - 8 * eps;
  };
  const directed = (a: number, b: number) => a * 4294967296 + b;
  const seen = new Set<string>(); // signatures of the states step 3 has split

  for (let pass = 0; pass < 1000; pass++) {
    // 2. nulové trojúhelníky a blány
    tris = dropMembranes(tris.filter((t) => !flat(t)));

    // 3. hrany bez protějšku
    const count = new Map<number, number>();
    for (const t of tris) for (let k = 0; k < 3; k++) count.set(directed(t[k], t[(k + 1) % 3]), (count.get(directed(t[k], t[(k + 1) % 3])) ?? 0) + 1);
    const unpaired = (a: number, b: number) => (count.get(directed(a, b)) ?? 0) > (count.get(directed(b, a)) ?? 0);
    const into = new Map<number, number[]>(); // vrchol → začátky hran bez protějšku, které do něj vedou
    const outOf = new Map<number, number[]>(); // vrchol → konce hran bez protějšku, které z něj vedou
    const note = (map: Map<number, number[]>, key: number, value: number) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    let open = false;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const a = t[k];
        const b = t[(k + 1) % 3];
        if (!unpaired(a, b)) continue;
        open = true;
        note(into, b, a);
        note(outOf, a, b);
      }
    }
    if (!open) break;
    const state = signature(tris);
    const repeated = seen.has(state);
    seen.add(state);
    const next: Tri[] = [];
    let split = false;
    for (const t of tris) {
      let done = false;
      for (let k = 0; k < 3 && !done; k++) {
        const a = t[k];
        const b = t[(k + 1) % 3];
        const c = t[(k + 2) % 3];
        if (!unpaired(a, b)) continue;
        // Protější strana vede z b do a po kratších hranách; její vrchol uvnitř a–b, nejbližší k a.
        const A = at(a);
        const ab = sub(at(b), A);
        const length = len(ab);
        let best = -1;
        let bestAlong = Infinity;
        for (const m of [...(into.get(a) ?? []), ...(outOf.get(b) ?? [])]) {
          if (m === a || m === b || m === c) continue;
          const am = sub(at(m), A);
          const along = dot(am, ab) / length;
          if (along <= 0 || along >= length || along >= bestAlong) continue;
          if (len(sub(am, mul(ab, along / length))) > eps) continue;
          best = m;
          bestAlong = along;
        }
        if (best < 0) continue;
        next.push([a, best, c, t[3]], [best, b, c, t[3]]);
        done = split = true;
      }
      if (!done) next.push(t);
    }
    tris = next;
    if (!split) break; // zbylé hrany dorovnat nejde; výsledek nebude uzavřený a adaptér skončí chybou
    if (repeated) break; // steps 2 and 3 alternate between two states; this is the split one
  }

  return splitNonManifold(pos, tris);
}


// A signature of a set of triangles that does not depend on their order nor on which vertex
// a triangle starts with: two sums of mixed hashes and the count.
function signature(tris: Tri[]): string {
  let first = 0;
  let second = 0;
  for (const t of tris) {
    const k = t[0] < t[1] ? (t[0] < t[2] ? 0 : 2) : t[1] < t[2] ? 1 : 2;
    let x = Math.imul(t[k] + 1, 0x9e3779b1) ^ Math.imul(t[(k + 1) % 3] + 1, 0x85ebca6b) ^ Math.imul(t[(k + 2) % 3] + 1, 0xc2b2ae35) ^ Math.imul(t[3] + 1, 0x27d4eb2f);
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x ^= x >>> 12;
    first = (first + x) | 0;
    second = (second + Math.imul(x ^ (x >>> 7), 0x297a2d39)) | 0;
  }
  return `${tris.length}:${first}:${second}`;
}

// Blány: dvojice trojúhelníků na stejných vrcholech s opačnou orientací.
function dropMembranes(tris: Tri[]): Tri[] {
  const byVertices = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const key = [t[0], t[1], t[2]].sort((x, y) => x - y).join('_');
    const group = byVertices.get(key);
    if (group) group.push(i);
    else byVertices.set(key, [i]);
  });
  const cycle = (t: Tri): string => {
    const k = t.indexOf(Math.min(t[0], t[1], t[2]));
    return `${t[k]}_${t[(k + 1) % 3]}_${t[(k + 2) % 3]}`;
  };
  const dead = new Set<number>();
  for (const group of byVertices.values()) {
    const free = [...group];
    while (free.length > 1) {
      const i = free.pop() as number;
      const j = free.findIndex((o) => cycle(tris[o]) !== cycle(tris[i]));
      if (j >= 0) {
        dead.add(i);
        dead.add(free[j]);
        free.splice(j, 1);
      }
    }
  }
  return dead.size ? tris.filter((_, i) => !dead.has(i)) : tris;
}

// Sloučením vrcholů mohou dvě části povrchu srůst v hraně (těleso, které se samo sebe dotýká jen
// hranou). Hrana pak má čtyři trojúhelníky a jádro takovou síť nepřijme správně. Povrch se v ní
// zase rozdělí. Trojúhelníky kolem hrany se spárují po klínech materiálu a pak:
//  - když se okolí některého konce hrany po klínech rozpadne na víc částí, zdvojí se tento vrchol
//    (každá část dostane vlastní, na stejném místě);
//  - jinak dostane každý pár uprostřed hrany vlastní nový vrchol. Je to potřeba, když úsek dotyku
//    na obou koncích přechází do běžného povrchu a konce rozdělit nejdou.
// Při dalším booleanu se zdvojené vrcholy zase sloučí a dělí se znovu. Pak už ale jde zdvojit
// vrchol uprostřed úseku a nové trojúhelníky nepřibývají.
// Vrcholy, ve kterých se povrch dotýká jen bodem, si jádro rozdělí samo.
function splitNonManifold(pos: Float32Array, input: Tri[]): Solid {
  const positions = Array.from(pos);
  const at = (i: number): V3 => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  let tris = input.map((t): Tri => [t[0], t[1], t[2], t[3]]);
  for (let round = 0; round < 100; round++) {
    interface Use {
      t: number; // trojúhelník
      k: number; // kterou hranou
      forward: boolean; // jde po hraně od menšího čísla vrcholu k většímu
    }
    const byEdge = new Map<string, Use[]>();
    tris.forEach((tri, t) => {
      for (let k = 0; k < 3; k++) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        const list = byEdge.get(edgeKey(a, b));
        if (list) list.push({ t, k, forward: a < b });
        else byEdge.set(edgeKey(a, b), [{ t, k, forward: a < b }]);
      }
    });
    // Páry po klínech: úhel třetího vrcholu kolem hrany; klín materiálu jde od trojúhelníku proti
    // směru hrany k nejbližšímu po směru.
    const pairs = new Map<string, [Use, Use][]>();
    for (const [key, list] of byEdge) {
      if (list.length === 2) continue;
      const [a, b] = key.split('_').map(Number);
      const A = at(a);
      const u = unit(sub(at(b), A));
      const e1 = unit(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
      const e2 = cross(u, e1);
      const sorted = list
        .map((use) => {
          const c = sub(at(tris[use.t][(use.k + 2) % 3]), A);
          return { use, angle: Math.atan2(dot(c, e2), dot(c, e1)) };
        })
        .sort((x, y) => x.angle - y.angle);
      const used = new Set<number>();
      const found: [Use, Use][] = [];
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].use.forward || used.has(i)) continue;
        for (let step = 1; step < sorted.length; step++) {
          const j = (i + step) % sorted.length;
          if (!sorted[j].use.forward || used.has(j)) continue;
          used.add(i);
          used.add(j);
          found.push([sorted[i].use, sorted[j].use]);
          break;
        }
      }
      pairs.set(key, found);
    }
    if (pairs.size === 0) break;

    const touched = new Set<number>();
    let changed = false;
    // 1. zdvojení vrcholu, jehož okolí se po klínech rozpadá
    const star = new Map<number, number[]>();
    const ends = new Set<number>();
    for (const key of pairs.keys()) for (const v of key.split('_').map(Number)) ends.add(v);
    tris.forEach((tri, t) => {
      for (let k = 0; k < 3; k++) {
        if (!ends.has(tri[k])) continue;
        const list = star.get(tri[k]);
        if (list) list.push(t);
        else star.set(tri[k], [t]);
      }
    });
    for (const v of [...ends].sort((x, y) => x - y)) {
      const around = star.get(v) ?? [];
      if (around.some((t) => touched.has(t))) continue;
      const group = new Map<number, number>(around.map((t) => [t, t]));
      const root = (t: number): number => {
        while (group.get(t) !== t) t = group.get(t) as number;
        return t;
      };
      const join = (p: number, q: number) => group.set(root(p), root(q));
      for (const t of around) {
        for (let k = 0; k < 3; k++) {
          const a = tris[t][k];
          const b = tris[t][(k + 1) % 3];
          if (a !== v && b !== v) continue;
          const key = edgeKey(a, b);
          const wedges = pairs.get(key);
          if (!wedges) for (const use of byEdge.get(key) ?? []) join(t, use.t);
          else for (const [p, q] of wedges) if (p.t === t || q.t === t) join(p.t, q.t);
        }
      }
      const parts = [...new Set(around.map(root))];
      if (parts.length < 2) continue;
      for (const part of parts.slice(1)) {
        const copy = positions.length / 3;
        positions.push(...at(v));
        for (const t of around) if (root(t) === part) tris[t] = tris[t].map((i, k) => (k < 3 && i === v ? copy : i)) as Tri;
      }
      for (const t of around) touched.add(t);
      changed = true;
    }
    // 2. nový vrchol uprostřed hrany pro každý pár
    const gone = new Set<number>();
    const added: Tri[] = [];
    if (!changed) {
      for (const [key, wedges] of pairs) {
        if (wedges.some(([p, q]) => touched.has(p.t) || touched.has(q.t))) continue;
        const [a, b] = key.split('_').map(Number);
        for (const pair of wedges) {
          const m = positions.length / 3;
          positions.push(...mul(add(at(a), at(b)), 0.5));
          for (const use of pair) {
            const tri = tris[use.t];
            touched.add(use.t);
            gone.add(use.t);
            added.push([tri[use.k], m, tri[(use.k + 2) % 3], tri[3]], [m, tri[(use.k + 1) % 3], tri[(use.k + 2) % 3], tri[3]]);
          }
          changed = true;
        }
      }
      tris = tris.filter((_, i) => !gone.has(i)).concat(added);
    }
    if (!changed) break;
  }
  return {
    positions: Float32Array.from(positions),
    triangles: Uint32Array.from(tris.flatMap((t) => [t[0], t[1], t[2]])),
    faceIds: Uint32Array.from(tris.map((t) => t[3])),
  };
}

// Je síť uzavřená plocha? Každá hrana musí být právě ve dvou trojúhelnících, jednou v každém směru.
// Jádro by jinou síť při dalším booleanu načetlo bez chyby, ale potichu z ní část zahodilo.
export function isClosed(s: Solid): boolean {
  const count = new Map<number, number>();
  for (let t = 0; t < triangleCount(s); t++) {
    for (let k = 0; k < 3; k++) {
      const a = s.triangles[3 * t + k];
      const b = s.triangles[3 * t + ((k + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      count.set(key, (count.get(key) ?? 0) + (a < b ? 1 : 1000));
    }
  }
  for (const c of count.values()) if (c !== 1001) return false;
  return true;
}

// Má některá rovinná stěna trojúhelník otočený proti své normále (přeloženou síť)?
export function isFolded(s: Solid, t: Tolerances): boolean {
  for (const face of fitFaces(s, t.tol).values()) {
    if (!face.planar) continue;
    for (const tri of face.tris) if (triWidth(tri.v, tri.n) >= t.weld && dot(unit(tri.n), face.n) < 0.99) return true;
  }
  return false;
}
