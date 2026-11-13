// Spike: může adaptér Manifoldu sám zaručit toleranci ke koplanárním stěnám?
// Core staví nástroj přesně, adaptér ho před booleanem upraví (posune stěny ležící
// v rovině stěn druhého tělesa). Spuštění: node manifold-adapter-spike.mjs
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh, triangulate } = wasm;

// ---------- vektory ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / len(a));

// =====================================================================
// ADAPTÉR: tohle by žilo v balíčku kernel-manifold
// =====================================================================

const P = (s, i) => [s.positions[3 * i], s.positions[3 * i + 1], s.positions[3 * i + 2]];

function bboxDiagonal(...solids) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) for (let i = 0; i < s.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], s.positions[i]); hi[i % 3] = Math.max(hi[i % 3], s.positions[i]);
  }
  return len(sub(hi, lo));
}

// Šířka trojúhelníku: výška na nejdelší stranu.
const triWidth = (v, nRaw) => {
  const longest = Math.max(len(sub(v[1], v[0])), len(sub(v[2], v[1])), len(sub(v[0], v[2])));
  return longest === 0 ? 0 : len(nRaw) / longest;
};

// Proloží rovinu každé stěně (podle čísla stěny). Rovinná je stěna, jejíž vrcholy leží do `tol`
// od proložené roviny. Podle normál jednotlivých trojúhelníků se rozhodovat nesmí: úzký trojúhelník
// vzniklý booleanem má normálu nespolehlivou a celou stěnu by označil za nerovinnou.
function fitFaces(s, tol) {
  const groups = new Map();
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const v = [0, 1, 2].map((k) => P(s, s.triangles[3 * t + k]));
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const g = groups.get(s.faceIds[t]) ?? { id: s.faceIds[t], tris: [], sum: [0, 0, 0] };
    g.tris.push({ t, v, n });
    g.sum = add(g.sum, n);
    groups.set(s.faceIds[t], g);
  }
  const out = new Map();
  for (const g of groups.values()) {
    if (len(g.sum) === 0) continue;
    const n = unit(g.sum);
    let area = 0, d = 0, width = 0;
    for (const tri of g.tris) {
      const a = len(tri.n) / 2;
      area += a;
      d += a * dot(n, mul(add(add(tri.v[0], tri.v[1]), tri.v[2]), 1 / 3));
      width = Math.max(width, triWidth(tri.v, tri.n));
    }
    if (area === 0) continue;
    d /= area;
    let dev = 0;
    for (const tri of g.tris) for (const p of tri.v) dev = Math.max(dev, Math.abs(dot(n, p) - d));
    // width: šířka nejširšího trojúhelníku. Stěna složená jen z úzkých zbytků nemá spolehlivou normálu.
    out.set(g.id, { id: g.id, n, d, planar: dev <= tol, width, tris: g.tris });
  }
  return out;
}
const planarFaces = (s, t) => [...fitFaces(s, t.tol).values()].filter((f) => f.planar && f.width >= t.sliver);

// Překrývají se dva trojúhelníky v rovině kladnou plochou? (test oddělující osou)
function trianglesOverlap2D(A, B, margin) {
  for (const [S, T] of [[A, B], [B, A]]) {
    for (let i = 0; i < 3; i++) {
      const p = S[i], q = S[(i + 1) % 3];
      const ax = [-(q[1] - p[1]), q[0] - p[0]];
      const l = Math.hypot(ax[0], ax[1]);
      if (l === 0) continue;
      const proj = (pts) => pts.map((r) => (r[0] * ax[0] + r[1] * ax[1]) / l);
      const s = proj(S), t = proj(T);
      if (Math.min(Math.max(...s), Math.max(...t)) - Math.max(Math.min(...s), Math.min(...t)) <= margin) return false;
    }
  }
  return true;
}

function facesOverlap(fa, fb, margin) {
  const u = unit(Math.abs(fb.n[0]) < 0.9 ? cross(fb.n, [1, 0, 0]) : cross(fb.n, [0, 1, 0]));
  const v = cross(fb.n, u);
  const to2 = (tri) => tri.v.map((p) => [dot(p, u), dot(p, v)]);
  const A = fa.tris.map(to2), B = fb.tris.map(to2);
  for (const ta of A) for (const tb of B) if (trianglesOverlap2D(ta, tb, margin)) return true;
  return false;
}

// Nejkratší posun d, který splní podmínky n·d = r (ve smyslu nejmenších čtverců).
// Počítá se v ortonormální bázi prostoru normál, takže je stabilní i pro jedinou rovinu
// v obecné poloze; skoro rovnoběžné normály se berou jako jedna.
function minimalShift(list) {
  const basis = [];
  for (const { n } of list) {
    let v = n;
    for (const e of basis) v = sub(v, mul(e, dot(v, e)));
    if (len(v) > 1e-3) basis.push(unit(v));
    if (basis.length === 3) break;
  }
  const k = basis.length;
  const G = Array.from({ length: k }, () => Array(k + 1).fill(0));   // rozšířená matice normálních rovnic
  for (const { n, r } of list) {
    const a = basis.map((e) => dot(n, e));
    for (let p = 0; p < k; p++) { G[p][k] += a[p] * r; for (let q = 0; q < k; q++) G[p][q] += a[p] * a[q]; }
  }
  for (let c = 0; c < k; c++) {                                      // Gaussova eliminace s výběrem pivotu
    let piv = c;
    for (let p = c + 1; p < k; p++) if (Math.abs(G[p][c]) > Math.abs(G[piv][c])) piv = p;
    [G[c], G[piv]] = [G[piv], G[c]];
    for (let p = 0; p < k; p++) if (p !== c) { const m = G[p][c] / G[c][c]; for (let q = c; q <= k; q++) G[p][q] -= m * G[c][q]; }
  }
  let d = [0, 0, 0];
  for (let c = 0; c < k; c++) d = add(d, mul(basis[c], G[c][k] / G[c][c]));
  return d;
}

// Posune vrcholy tak, aby stěna s číslem id dostala posun shiftOf(id, n) podél své normály
// a ostatní stěny zůstaly ve své rovině (vrchol jede po průsečnici sousedních stěn).
// Rovinná stěna vstupuje svou proloženou normálou. U zakřivené stěny se bere normála trojúhelníku.
// Trojúhelníky a stěny užší než `sliver` se vynechají: vznikají posunem a jejich normála je šum.
// `extra` přidá vrcholům další podmínky (rovina, která ve výsledku nemá žádný trojúhelník).
function moveVertices(b, faces, sliver, shiftOf, extra = new Map()) {
  const constraints = new Map();   // vrchol → [{n, r}]
  const push = (i, n, r) => {
    const list = constraints.get(i) ?? [];
    if (!list.some((c) => Math.abs(dot(c.n, n)) > 1 - 1e-9 && c.r === r * Math.sign(dot(c.n, n)))) list.push({ n, r });
    constraints.set(i, list);
  };
  for (let t = 0; t < b.triangles.length / 3; t++) {
    const idx = [0, 1, 2].map((k) => b.triangles[3 * t + k]);
    const f = faces.get(b.faceIds[t]);
    let n;
    if (f?.known) n = f.n;                         // rovina zadaná zvenku (posunutá stěna)
    else if (f?.planar) { if (f.width < sliver) continue; n = f.n; }
    else {
      const v = idx.map((i) => P(b, i));
      const nRaw = cross(sub(v[1], v[0]), sub(v[2], v[0]));
      if (triWidth(v, nRaw) < sliver) continue;
      n = unit(nRaw);
    }
    const r = shiftOf(b.faceIds[t], n);
    for (const i of idx) push(i, n, r);
  }
  for (const [i, list] of extra) for (const c of list) push(i, c.n, c.r);
  const positions = Float32Array.from(b.positions);
  for (const [i, list] of constraints) {
    if (!list.some((c) => c.r !== 0)) continue;
    const d = minimalShift(list);
    for (let k = 0; k < 3; k++) positions[3 * i + k] = b.positions[3 * i + k] + d[k];
  }
  return positions;
}

// Tolerance adaptéru, vše odvozené z rozměru modelu.
function tolerances(a, b) {
  const D = bboxDiagonal(a, b);
  return {
    tol: D * 1e-5,       // co se ještě bere jako "v jedné rovině"
    overlap: D * 4e-5,   // o kolik se stěna posune
    sliver: D * 8e-5,    // užší trojúhelník zakřivené stěny se pro určení roviny nepoužije
    onPlane: D * 5e-6,   // vrchol "leží v posunuté rovině"
    weld: D * 1e-6,      // vrcholy blíž než tohle se sloučí
  };
}

// Vrátí kopii nástroje `b`, ve které jsou stěny ležící v rovině stěn tělesa `a` posunuté o přesah.
// Cílem je, aby se stěny nástroje a tělesa nikde jen nedotýkaly: každý styk se změní na skutečný
// průnik, se kterým si jádro poradí, a po booleanu se posunuté stěny vrátí zpět (restoreShifted).
//   rozdíl:      lícuje (stejná orientace) → nástroj se zvětší;  dosedá zvenku → nástroj se zmenší
//   sjednocení:  lícuje i dosedá → nástroj se zvětší
function prepareTool(op, a, b, log) {
  const none = { tool: b, shifts: new Map() };
  if (op === 'intersection') return none;
  const t = tolerances(a, b);
  const shifts = new Map();    // číslo stěny nástroje → { r: posun podél normály, n, d: původní rovina }
  const fa = planarFaces(a, t), facesB = fitFaces(b, t.tol);
  for (const B of facesB.values()) {
    if (!B.planar || B.width < t.sliver) continue;
    let chosen = null;
    for (const A of fa) {
      const c = dot(A.n, B.n);
      if (Math.abs(c) < 1 - 1e-6) continue;                       // nejsou rovnoběžné
      if (Math.abs(B.d - c * A.d) > t.tol) continue;              // nejsou v jedné rovině
      const same = c > 0;
      const shift = op === 'difference' && !same ? -t.overlap : t.overlap;
      // Jsou v jedné rovině, ale jinde? Stačí dotyk nebo mezera do dvou přesahů: bok nálitku se
      // boku tělesa dotýká jen hranou, a stěna, která se sama neposouvá, se posunem sousedních
      // stěn o přesah protáhne a dotkla by se až potom.
      if (!facesOverlap(A, B, -2 * t.overlap)) continue;
      // Stěna nástroje může ve stejné rovině potkat dvě opačně orientované stěny tělesa (horní
      // stěna a spodek převisu). Zvětšení má přednost: zmenšení by na lícující části nechalo blánu.
      if (shift > 0) { chosen = { shift, A }; break; }
      chosen ??= { shift, A };
    }
    if (!chosen) continue;
    shifts.set(B.id, { r: chosen.shift, n: B.n, d: B.d });
    log?.push(`stěna ${B.id} ~ ${chosen.A.id}: posun ${chosen.shift > 0 ? '+' : '−'}`);
  }
  if (shifts.size === 0) return none;
  return { tool: { ...b, positions: moveVertices(b, facesB, t.sliver, (id) => shifts.get(id)?.r ?? 0) }, shifts };
}

const toManifold = (s) => new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(s.positions), triVerts: s.triangles, faceID: s.faceIds }));
function fromManifold(m) { const g = m.getMesh(); return { positions: g.vertProperties, triangles: g.triVerts, faceIds: g.faceID }; }

// Vyčistí síť po návratu stěn. Pás, o který byla stěna posunutá, má po návratu nulovou šířku a
// zůstaly by po něm nulové trojúhelníky, které by dál nesly číslo zaniklé stěny. Tři kroky, dokud
// se něco mění:
//  1. vrcholy blíž než eps se sloučí a trojúhelníky, které tím ztratily vrchol, se zahodí,
//  2. dvojice trojúhelníků na stejných vrcholech s opačnou orientací (blána nulové tloušťky) se zahodí,
//  3. trojúhelník užší než eps, jehož vrcholy leží skoro v přímce, se zruší a soused přes jeho
//     nejdelší hranu se v prostředním vrcholu rozdělí (plocha připadne sousedovi i s jeho číslem).
// (Vyčištění průchodem přes Manifold se neosvědčilo: nulové trojúhelníky sbalil špatným směrem.)
function clean(s, eps) {
  const pos = s.positions, nv = pos.length / 3;
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cell = (i) => [0, 1, 2].map((k) => Math.floor(pos[3 * i + k] / (eps * 4)));
  const grid = new Map();
  for (let i = 0; i < nv; i++) {
    const c = cell(i);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
        if (len(sub(P(s, i), P(s, j))) <= eps) parent[find(i)] = find(j);
      }
    }
    const key = c.join(','); grid.set(key, [...(grid.get(key) ?? []), i]);
  }
  let tris = [];   // [a, b, c, číslo stěny]
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const [p, q, r] = [0, 1, 2].map((k) => find(s.triangles[3 * t + k]));
    if (p !== q && q !== r && r !== p) tris.push([p, q, r, s.faceIds[t]]);
  }
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    // 2. blány
    const byVerts = new Map(), dead = new Set();
    tris.forEach((t, i) => { const k = [t[0], t[1], t[2]].sort((x, y) => x - y).join('_'); byVerts.set(k, [...(byVerts.get(k) ?? []), i]); });
    const cyc = (t) => { const m = Math.min(t[0], t[1], t[2]), k = t.indexOf(m); return `${t[k]}_${t[(k + 1) % 3]}_${t[(k + 2) % 3]}`; };
    for (const group of byVerts.values()) {
      const free = [...group];
      while (free.length > 1) {
        const i = free.pop(), j = free.findIndex((o) => cyc(tris[o]) !== cyc(tris[i]));
        if (j >= 0) { dead.add(i); dead.add(free[j]); free.splice(j, 1); }
      }
    }
    if (dead.size) { tris = tris.filter((_, i) => !dead.has(i)); changed = true; }
    // 3. trojúhelníky s vrcholy v přímce
    const edge = new Map();
    tris.forEach((t, i) => { for (let k = 0; k < 3; k++) edge.set(`${t[k]}_${t[(k + 1) % 3]}`, i); });
    const touched = new Set(), gone = new Set(), added = [];
    tris.forEach((t, i) => {
      if (touched.has(i)) return;
      const v = [0, 1, 2].map((k) => [pos[3 * t[k]], pos[3 * t[k] + 1], pos[3 * t[k] + 2]]);
      if (triWidth(v, cross(sub(v[1], v[0]), sub(v[2], v[0]))) >= eps) return;
      let k = 0, best = -1;
      for (let q = 0; q < 3; q++) { const l = len(sub(v[(q + 1) % 3], v[q])); if (l > best) { best = l; k = q; } }
      const a = t[k], b = t[(k + 1) % 3], m = t[(k + 2) % 3];     // nejdelší hrana a→b, m leží mezi nimi
      const j = edge.get(`${b}_${a}`);
      if (j === undefined || j === i || touched.has(j)) return;
      const n = tris[j], c = n[(n.indexOf(a) + 1) % 3];           // soused (b, a, c)
      if (c === m) return;                                         // blána, vyřeší krok 2
      touched.add(i); touched.add(j); gone.add(i); gone.add(j);
      added.push([b, m, c, n[3]], [m, a, c, n[3]]);
    });
    if (gone.size) { tris = tris.filter((_, i) => !gone.has(i)).concat(added); changed = true; }
    if (!changed) break;
  }
  return { positions: pos, triangles: Uint32Array.from(tris.flatMap((t) => t.slice(0, 3))), faceIds: Uint32Array.from(tris.map((t) => t[3])) };
}

// Po booleanu vrátí do původní roviny vše, co po posunu stěn nástroje ve výsledku zůstalo:
//  - zbytek samotné posunuté stěny (stěna lícovala jen zčásti),
//  - hranici sousedních stěn nástroje, která s posunutou stěnou odjela, i když posunutá stěna
//    sama zanikla (bok nálitku lícující s bokem tělesa sahá o přesah pod dosedací rovinu).
// Druhý případ se pozná podle polohy: vrchol leží v posunuté rovině a dotýká se stěny nástroje.
function restoreShifted(out, shifts, toolIds, t) {
  const nv = out.positions.length / 3, touchesTool = new Uint8Array(nv);
  let remnant = false;
  for (let k = 0; k < out.triangles.length / 3; k++) {
    if (shifts.has(out.faceIds[k])) remnant = true;
    if (toolIds.has(out.faceIds[k])) for (let q = 0; q < 3; q++) touchesTool[out.triangles[3 * k + q]] = 1;
  }
  const extra = new Map();
  for (let i = 0; i < nv; i++) {
    if (!touchesTool[i]) continue;
    const p = P(out, i);
    for (const sh of shifts.values()) {
      if (Math.abs(dot(sh.n, p) - (sh.d + sh.r)) > t.onPlane) continue;
      extra.set(i, [...(extra.get(i) ?? []), { n: sh.n, r: -sh.r }]);
    }
  }
  if (!remnant && extra.size === 0) return null;
  // Rovina posunuté stěny je známá z nástroje. Z jejího zbytku ve výsledku se neprokládá:
  // bývá to pár úzkých trojúhelníků.
  const faces = fitFaces(out, t.tol);
  for (const [id, sh] of shifts) faces.set(id, { known: true, n: sh.n });
  const positions = moveVertices(out, faces, t.sliver, (id) => (shifts.has(id) ? -shifts.get(id).r : 0), extra);
  return clean({ ...out, positions }, t.weld);
}

// restore: po booleanu vrátí zbytky posunutých stěn do původní roviny a síť vyčistí.
function boolean(op, a, b, { prepare = true, restore = true, log } = {}) {
  const { tool, shifts } = prepare ? prepareTool(op, a, b, log) : { tool: b, shifts: new Map() };
  const A = toManifold(a), B = toManifold(tool);
  let out = fromManifold(op === 'union' ? A.add(B) : op === 'difference' ? A.subtract(B) : A.intersect(B));
  if (restore && shifts.size > 0) {
    if (process.env.DEBUG) console.log('   před návratem:', faceSummary(out));
    const back = restoreShifted(out, shifts, new Set(b.faceIds), tolerances(a, b));
    if (back) { out = back; log?.push('posunuté stěny vráceny do roviny'); }
    if (process.env.DEBUG) console.log('   po návratu:   ', faceSummary(out));
  }
  return out;
}
function faceSummary(s) {
  const m = new Map();
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const v = [0, 1, 2].map((k) => P(s, s.triangles[3 * t + k]));
    const e = m.get(s.faceIds[t]) ?? { t: 0, a: 0 }; e.t++; e.a += len(cross(sub(v[1], v[0]), sub(v[2], v[0]))) / 2; m.set(s.faceIds[t], e);
  }
  return [...m].sort((x, y) => x[0] - y[0]).map(([id, e]) => `${id}:${e.t}t/${e.a.toFixed(2)}`).join(' ');
}
const components = (s) => toManifold(s).decompose().length;

// =====================================================================
// TESTY
// =====================================================================

const IDENTITY = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
function rotated() {
  const [a, b, c] = [30, 20, 10].map((d) => (d * Math.PI) / 180);
  const rx = (v) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v) => [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
  const rz = (v) => [v[0] * Math.cos(c) - v[1] * Math.sin(c), v[0] * Math.sin(c) + v[1] * Math.cos(c), v[2]];
  const r = (v) => rz(ry(rx(v)));
  return { o: [3.7, -1.3, 2.9], x: r([1, 0, 0]), y: r([0, 1, 0]), n: r([0, 0, 1]) };
}
const toWorld = (f, u, v, w) => [0, 1, 2].map((k) => f.o[k] + u * f.x[k] + v * f.y[k] + w * f.n[k]);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const circle = (cx, cy, r, n = 32) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

function prism(frame, loop, w0, w1, { start, end, sides }) {
  const n = loop.length, pos = [], tris = [], ids = [];
  for (const w of [w0, w1]) for (const [u, v] of loop) pos.push(...toWorld(frame, u, v, w));
  const cap = triangulate([loop]);
  for (const [a, b, c] of cap) { tris.push(a, c, b); ids.push(start); }
  for (const [a, b, c] of cap) { tris.push(n + a, n + b, n + c); ids.push(end); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; tris.push(i, j, n + j, i, n + j, n + i); ids.push(sides[i], sides[i]); }
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tris), faceIds: Uint32Array.from(ids) };
}

function describe(s, frame) {
  const faces = new Map(), edges = new Map();
  let vol = 0;
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const idx = [0, 1, 2].map((k) => s.triangles[3 * t + k]);
    const v = idx.map((i) => P(s, i));
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    vol += dot(v[0], n) / 6;
    const f = faces.get(s.faceIds[t]) ?? { area: 0, wMin: Infinity, wMax: -Infinity };
    f.area += len(n) / 2;
    for (const p of v) { const w = dot(sub(p, frame.o), frame.n); f.wMin = Math.min(f.wMin, w); f.wMax = Math.max(f.wMax, w); }
    faces.set(s.faceIds[t], f);
    for (const [p, q] of [[idx[0], idx[1]], [idx[1], idx[2]], [idx[2], idx[0]]]) { const k = p < q ? `${p}_${q}` : `${q}_${p}`; edges.set(k, (edges.get(k) ?? 0) + 1); }
  }
  // sound: žádná rovinná stěna nemá trojúhelník otočený proti své normále (přeložená síť)
  const t = tolerances(s, s);
  let sound = true;
  for (const fc of fitFaces(s, t.tol).values()) {
    if (!fc.planar) continue;
    for (const tri of fc.tris) if (triWidth(tri.v, tri.n) >= t.weld && dot(unit(tri.n), fc.n) < 0.99) sound = false;
  }
  return { faces, vol, closed: [...edges.values()].every((c) => c === 2), sound };
}

// Sousedí v síti trojúhelníky se stěnami p a q (mají společnou hranu)?
function adjacent(s, p, q) {
  const m = new Map();
  for (let t = 0; t < s.triangles.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = s.triangles[3 * t + k], b = s.triangles[3 * t + (k + 1) % 3], key = a < b ? `${a}_${b}` : `${b}_${a}`;
    m.set(key, [...(m.get(key) ?? []), s.faceIds[t]]);
  }
  for (const f of m.values()) if (f.includes(p) && f.includes(q)) return true;
  return false;
}
const idsOf = (s) => [...new Set(s.faceIds)].sort((x, y) => x - y);
const sameIds = (s, ids) => JSON.stringify(idsOf(s)) === JSON.stringify([...ids].sort((x, y) => x - y));

const results = [];
function run(title, frame, op, a, b, expect) {
  const lines = [];
  for (const prepare of [false, true]) {
    const log = [];
    const out = boolean(op, a, b, { prepare, log });
    const d = describe(out, frame);
    const ids = [...d.faces.keys()].sort((x, y) => x - y);
    const idsOk = JSON.stringify(ids) === JSON.stringify([...expect.ids].sort((x, y) => x - y));
    const volOk = Math.abs(d.vol - expect.volume) < 0.5;
    let extraOk = true, extra = '';
    if (prepare && expect.check) { const r = expect.check(d); extraOk = r.ok; extra = ' | ' + r.text; }
    const ok = idsOk && volOk && d.closed && d.sound && extraOk;
    lines.push(`   ${prepare ? 's úpravou ' : 'bez úpravy'}: ${ok ? 'OK    ' : 'SELHAL'} objem ${d.vol.toFixed(3)} (čekáno ${expect.volume}), stěny ${idsOk ? 'sedí' : 'NESEDÍ ' + JSON.stringify(ids)}${prepare && log.length ? ' | ' + log.join(', ') : ''}${extra}`);
    if (prepare) results.push([title, ok]);
    else results.push([title + ' (bez úpravy, jen pro srovnání)', ok, true]);
    if (prepare) run.last = out;
  }
  console.log(`\n== ${title}\n${lines.join('\n')}`);
  return run.last;
}

for (const [label, f] of [['osově', IDENTITY], ['šikmo', rotated()]]) {
  const box = prism(f, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
  const B = [1, 2, 3, 4, 5, 6];

  run(`A ${label}: nálitek přesně na horní stěně`, f, 'union', box,
    prism(f, rect(10, 10, 20, 20), 10, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }),
    { ids: [...B, 32, 33, 34, 35, 36], volume: 12500 });

  run(`B ${label}: slepá kapsa přesně od horní stěny`, f, 'difference', box,
    prism(f, rect(10, 10, 20, 20), 5, 10, { start: 21, end: 22, sides: [23, 24, 25, 26] }),
    { ids: [...B, 21, 23, 24, 25, 26], volume: 11500 });

  const cylArea = 0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32);
  run(`K ${label}: slepá válcová díra přesně od horní stěny`, f, 'difference', box,
    prism(f, circle(20, 15, 5), 4, 10, { start: 11, end: 12, sides: Array(32).fill(10) }),
    { ids: [...B, 10, 11], volume: 12000 - cylArea * 6,
      check: (d) => { const w = d.faces.get(10); return { ok: Math.abs(w.wMin - 4) < 1e-4 && Math.abs(w.wMax - 10) < 1e-4, text: `stěna díry: výška ${w.wMin.toFixed(5)}–${w.wMax.toFixed(5)} (zadáno 4–10)` }; } });

  run(`L ${label}: válcový čep přesně na horní stěně`, f, 'union', box,
    prism(f, circle(20, 15, 5), 10, 16, { start: 11, end: 12, sides: Array(32).fill(10) }),
    { ids: [...B, 10, 12], volume: 12000 + cylArea * 6 });

  run(`C ${label}: kapsa s bokem v rovině boku tělesa`, f, 'difference', box,
    prism(f, rect(30, 10, 40, 20), 5, 10, { start: 41, end: 42, sides: [43, 44, 45, 46] }),
    { ids: [...B, 41, 43, 45, 46], volume: 11500 });

  run(`D ${label}: výřez přesně na tloušťku`, f, 'difference', box,
    prism(f, rect(10, 10, 20, 20), 0, 10, { start: 51, end: 52, sides: [53, 54, 55, 56] }),
    { ids: [...B, 53, 54, 55, 56], volume: 11000 });

  for (const delta of [3e-6, -3e-6]) {
    run(`F ${label}: bok kapsy mimo rovinu boku o ${delta} (přichycení na float32 bod)`, f, 'difference', box,
      prism(f, rect(30, 10, 40 + delta, 20), 5, 10, { start: 41, end: 42, sides: [43, 44, 45, 46] }),
      { ids: [...B, 41, 43, 45, 46], volume: 11500 });
  }

  run(`G ${label}: kontrola – bok kapsy 0,05 od boku tělesa se posunout nesmí`, f, 'difference', box,
    prism(f, rect(30, 10, 39.95, 20), 5, 10, { start: 41, end: 42, sides: [43, 44, 45, 46] }),
    { ids: [...B, 41, 43, 44, 45, 46], volume: 12000 - 9.95 * 10 * 5 });

  run(`J ${label}: nástroj dosedá na těleso zvenku, výřez nemá nic ubrat`, f, 'difference', box,
    prism(f, rect(40, 10, 50, 20), 0, 10, { start: 91, end: 92, sides: [93, 94, 95, 96] }),
    { ids: B, volume: 12000 });

  run(`I ${label}: sjednocení lícujících těles (horní stěny v jedné rovině)`, f, 'union', box,
    prism(f, rect(30, 5, 60, 25), 0, 10, { start: 61, end: 62, sides: [63, 64, 65, 66] }),
    { ids: [...B, 61, 62, 63, 64, 65], volume: 16000 });

  // Stupňovité těleso: na kvádr se přidá schod (0..20)×(0..30)×(10..20).
  const stepped = run(`S ${label}: stavba stupňovitého tělesa (schod dosedá na horní stěnu)`, f, 'union', box,
    prism(f, rect(0, 0, 20, 30), 10, 20, { start: 81, end: 82, sides: [83, 84, 85, 86] }),
    { ids: [...B, 82, 83, 84, 85, 86], volume: 12000 + 6000 });
  const S = [1, 2, 3, 4, 5, 6, 82, 83, 84, 85, 86];

  // E: kapsa (10..30)×(10..20)×(5..10). Její koncové víko leží zčásti v rovině horní stěny (x 20..30)
  // a zčásti prochází materiálem schodu (x 10..20). Tam vznikne strop tunelu.
  run(`E ${label}: částečný překryv – strop pod schodem`, f, 'difference', stepped,
    prism(f, rect(10, 10, 30, 20), 5, 10, { start: 21, end: 22, sides: [23, 24, 25, 26] }),
    { ids: [...S, 21, 22, 23, 24, 25, 26], volume: 17000,
      check: (d) => { const c = d.faces.get(22); return { ok: !!c && Math.abs(c.area - 100) < 1 && Math.abs(c.wMin - 10) < 1e-4 && Math.abs(c.wMax - 10) < 1e-4, text: c ? `strop: plocha ${c.area.toFixed(2)} (čekáno 100), výška ${c.wMin.toFixed(5)}–${c.wMax.toFixed(5)} (zadáno 10)` : 'strop chybí' }; } });

  // ---- Řetězené případy: další operace na stěně, která je zbytkem posunuté stěny nástroje ----
  for (const restore of [false, true]) {
    const tag = restore ? 's návratem do roviny' : 'bez návratu';
    const tunnel = boolean('difference', stepped, prism(f, rect(10, 10, 30, 20), 5, 10, { start: 21, end: 22, sides: [23, 24, 25, 26] }), { restore });
    const ceil = describe(tunnel, f).faces.get(22);
    const hung = boolean('union', tunnel, prism(f, rect(12, 12, 18, 18), 7, 10, { start: 201, end: 202, sides: [203, 204, 205, 206] }), { restore });
    const dh = describe(hung, f), ch = components(hung);
    const okH = ch === 1 && Math.abs(dh.vol - (17000 + 108)) < 0.5 && !dh.faces.has(202) && dh.closed && dh.sound;
    const cutUp = boolean('difference', tunnel, prism(f, rect(12, 12, 18, 18), 10, 12, { start: 211, end: 212, sides: [213, 214, 215, 216] }), { restore });
    const dc = describe(cutUp, f);
    const okC = Math.abs(dc.vol - (17000 - 72)) < 0.5 && !dc.faces.has(211) && dc.closed && dc.sound;
    console.log(`\n== X ${label}: řetězení na stropě tunelu, ${tag}`);
    console.log(`   strop: výška ${ceil.wMin.toFixed(5)}–${ceil.wMax.toFixed(5)} (zadáno 10)`);
    console.log(`   nálitek zavěšený na stropě: komponent ${ch}, objem ${dh.vol.toFixed(3)} (čekáno 17108), zbytek dosedací stěny ${dh.faces.has(202) ? 'ANO' : 'ne'} → ${okH ? 'OK' : 'SELHAL'}`);
    console.log(`   kapsa do stropu: objem ${dc.vol.toFixed(3)} (čekáno 16928), zbytek víka ${dc.faces.has(211) ? 'ANO' : 'ne'} → ${okC ? 'OK' : 'SELHAL'}`);
    results.push([`X ${label}: nálitek na stropě tunelu, ${tag}`, okH, !restore], [`X ${label}: kapsa do stropu tunelu, ${tag}`, okC, !restore]);

    // Nálitek přesahující přes okraj horní stěny: zbytek jeho spodního víka visí ve vzduchu.
    const over = boolean('union', box, prism(f, rect(35, 10, 45, 20), 10, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }), { restore });
    const under = describe(over, f).faces.get(31);
    const filled = boolean('union', over, prism(f, rect(40, 10, 45, 20), 5, 10, { start: 221, end: 222, sides: [223, 224, 225, 226] }), { restore });
    const df = describe(filled, f), cf = components(filled);
    const okF = cf === 1 && Math.abs(df.vol - (12000 + 500 + 250)) < 0.5 && !df.faces.has(31) && !df.faces.has(222) && df.closed && df.sound;
    console.log(`== Y ${label}: nálitek přes okraj a blok pod jeho převisem, ${tag}`);
    console.log(`   spodek převisu: plocha ${under.area.toFixed(2)} (čekáno 50), výška ${under.wMin.toFixed(5)}–${under.wMax.toFixed(5)} (zadáno 10)`);
    console.log(`   blok pod převisem: komponent ${cf}, objem ${df.vol.toFixed(3)} (čekáno 12750), zbytky dosedacích stěn ${df.faces.has(31) || df.faces.has(222) ? 'ANO' : 'ne'} → ${okF ? 'OK' : 'SELHAL'}`);
    results.push([`Y ${label}: blok pod převisem, ${tag}`, okF, !restore]);
  }

  // ---- Případy ze čtvrté revize ----
  const report = (title, ok, text) => { console.log(`\n== ${title}\n   ${ok ? 'OK    ' : 'SELHAL'} ${text}`); results.push([title, ok]); };

  // Q: schod přidaný sjednocením se zase celý odřízne. Boky schodu lícují s boky kvádru; po prvním
  // kroku nesmí sahat pod dosedací rovinu, jinak po nich při odříznutí zůstanou proužky.
  {
    const cut = boolean('difference', stepped, prism(f, rect(0, 0, 20, 30), 10, 20, { start: 301, end: 302, sides: [303, 304, 305, 306] }));
    const d = describe(cut, f), side = describe(stepped, f).faces.get(83);
    report(`Q ${label}: odříznutí dříve přidaného schodu`, sameIds(cut, [...B, 301]) && Math.abs(d.vol - 12000) < 0.5 && d.closed && d.sound && Math.abs(side.wMin - 10) < 1e-4,
      `stěny ${JSON.stringify(idsOf(cut))}, objem ${d.vol.toFixed(3)} (čekáno 12000), bok schodu před odříznutím od výšky ${side.wMin.toFixed(5)} (zadáno 10)`);
  }

  // U: nálitek, jehož bok lícuje s bokem kvádru, s odchylkou ±3e-6 (přichycení na float32 bod).
  // Boky musí sousedit přímo (hrana druhu coplanar), horní stěna musí zůstat rovinná a další
  // operace na ní musí projít.
  for (const delta of [3e-6, -3e-6]) {
    const boss = boolean('union', box, prism(f, rect(30, 10, 40 + delta, 20), 10, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }));
    const d = describe(boss, f), top = fitFaces(boss, tolerances(boss, boss).tol).get(2);
    const pocket = boolean('difference', boss, prism(f, rect(5, 5, 15, 15), 5, 10, { start: 41, end: 42, sides: [43, 44, 45, 46] }));
    const dp = describe(pocket, f);
    const ok = sameIds(boss, [...B, 32, 33, 34, 35, 36]) && Math.abs(d.vol - 12500) < 0.5 && d.closed && d.sound
      && adjacent(boss, 4, 34) && !adjacent(boss, 2, 34) && top.planar
      && Math.abs(dp.vol - 12000) < 0.5 && !dp.faces.has(42) && dp.closed && dp.sound;
    report(`U ${label}: lícující nálitek s odchylkou boku ${delta}`, ok,
      `objem ${d.vol.toFixed(3)} (čekáno 12500), boky sousedí ${adjacent(boss, 4, 34)}, proužek horní stěny mezi nimi ${adjacent(boss, 2, 34)}, horní stěna rovinná ${top.planar}; kapsa do horní stěny potom: objem ${dp.vol.toFixed(3)} (čekáno 12000), zbytek víka ${dp.faces.has(42) ? 'ANO' : 'ne'}`);
  }

  // V: válcový výřez pod schodem. Dva vrcholy válce leží přesně v rovině boku schodu, takže se
  // v nich stýkají čtyři roviny a booleanem tam vznikají úzké trojúhelníky.
  {
    const n = 16, area = 0.5 * n * 25 * Math.sin((2 * Math.PI) / n);
    const cyl = boolean('difference', stepped, prism(f, circle(20, 15, 5, n), 5, 10, { start: 11, end: 12, sides: Array(n).fill(10) }));
    const d = describe(cyl, f), c = d.faces.get(12);
    const ok = !!c && sameIds(cyl, [...S, 10, 11, 12]) && Math.abs(d.vol - (18000 - area * 5)) < 0.5 && d.closed && d.sound
      && Math.abs(c.wMin - 10) < 2e-5 && Math.abs(c.wMax - 10) < 2e-5 && Math.abs(c.area - area / 2) < 0.01;
    report(`V ${label}: válcový výřez pod schodem`, ok, c ? `strop: výška ${c.wMin.toFixed(6)}–${c.wMax.toFixed(6)} (zadáno 10), plocha ${c.area.toFixed(3)} (čekáno ${(area / 2).toFixed(3)})` : 'strop chybí');
  }

  // W, Z: stěna nástroje potká ve své rovině dvě opačně orientované stěny tělesa (horní stěnu
  // kvádru a spodek převisu nálitku).
  {
    const over = boolean('union', box, prism(f, rect(35, 10, 45, 20), 10, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }));
    // Z: blok pod převisem, širší než nálitek: jeho horní stěna lícuje s horní stěnou kvádru a zároveň dosedá na spodek převisu.
    const block = boolean('union', over, prism(f, rect(35, 5, 45, 25), 5, 10, { start: 221, end: 222, sides: [223, 224, 225, 226] }));
    const db = describe(block, f), cb = components(block);
    report(`Z ${label}: blok pod převisem lícující s horní stěnou`, cb === 1 && sameIds(block, [...B, 32, 33, 34, 35, 36, 221, 222, 223, 224, 225]) && Math.abs(db.vol - 13000) < 0.5 && db.closed && db.sound,
      `komponent ${cb}, stěny ${JSON.stringify(idsOf(block))}, objem ${db.vol.toFixed(3)} (čekáno 13000)`);
    // W: drážka do nálitku od jeho spodku; nástroj zároveň leží na horní stěně kvádru.
    const slot = boolean('difference', over, prism(f, rect(30, 12, 43, 18), 10, 13, { start: 311, end: 312, sides: [313, 314, 315, 316] }));
    const ds = describe(slot, f), floor = ds.faces.get(311);
    report(`W ${label}: drážka od spodku převisu, nástroj leží na horní stěně`, !!floor && sameIds(slot, [...B, 31, 32, 33, 34, 35, 36, 311, 312, 313, 314, 315]) && Math.abs(ds.vol - 12356) < 0.5 && ds.closed && ds.sound
      && Math.abs(floor.wMin - 10) < 2e-5 && Math.abs(floor.wMax - 10) < 2e-5,
      `stěny ${JSON.stringify(idsOf(slot))}, objem ${ds.vol.toFixed(3)} (čekáno 12356)${floor ? `, dno drážky ve výšce ${floor.wMin.toFixed(6)}–${floor.wMax.toFixed(6)}` : ''}`);
  }

  // H: dutina zespodu pod schodem (5..15)×(10..20)×(0..10). Koncové víko je v rovině horní stěny,
  // ale ta leží jinde (x > 20). Posunout se nesmí.
  run(`H ${label}: stejná rovina, ale bez překryvu – strop se posunout nesmí`, f, 'difference', stepped,
    prism(f, rect(5, 10, 15, 20), 0, 10, { start: 51, end: 52, sides: [53, 54, 55, 56] }),
    { ids: [...S, 52, 53, 54, 55, 56], volume: 18000 - 1000,
      check: (d) => { const c = d.faces.get(52); return { ok: !!c && Math.abs(c.wMax - 10) < 1e-4 && Math.abs(c.wMin - 10) < 1e-4, text: c ? `strop: výška ${c.wMin.toFixed(5)}–${c.wMax.toFixed(5)} (zadáno 10)` : 'strop chybí' }; } });
}

console.log('\n==== SOUHRN (s úpravou v adaptéru) ====');
for (const [name, ok, baseline] of results) if (!baseline) console.log(`${ok ? 'OK    ' : 'SELHAL'} ${name}`);
const base = results.filter((r) => r[2]);
console.log(`\nSrovnávací běhy (bez úpravy nebo bez návratu do roviny): ${base.filter((r) => r[1]).length}/${base.length} případů prošlo.`);
console.log('Selhaly bez úpravy: ' + base.filter((r) => !r[1]).map((r) => r[0].replace(' (bez úpravy, jen pro srovnání)', '')).join('; '));
