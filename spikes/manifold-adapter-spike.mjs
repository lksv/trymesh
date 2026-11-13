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

// Rovinné stěny tělesa: pro každé číslo stěny proloží rovinu.
function planarFaces(s) {
  const groups = new Map();
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const v = [0, 1, 2].map((k) => P(s, s.triangles[3 * t + k]));
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    const g = groups.get(s.faceIds[t]) ?? { id: s.faceIds[t], tris: [], sum: [0, 0, 0] };
    g.tris.push({ t, v, n });
    g.sum = add(g.sum, n);
    groups.set(s.faceIds[t], g);
  }
  const out = [];
  for (const g of groups.values()) {
    if (len(g.sum) === 0) continue;
    const n = unit(g.sum);
    let planar = true, area = 0, d = 0;
    for (const tri of g.tris) {
      const a = len(tri.n) / 2;
      if (a > 0 && dot(unit(tri.n), n) < 1 - 1e-5) planar = false;
      area += a;
      d += a * dot(n, mul(add(add(tri.v[0], tri.v[1]), tri.v[2]), 1 / 3));
    }
    if (planar && area > 0) out.push({ id: g.id, n, d: d / area, tris: g.tris });
  }
  return out;
}

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

// Posune vrcholy tak, aby stěna s číslem id dostala posun shiftOf(id) podél své normály
// a ostatní stěny zůstaly ve své rovině (vrchol jede po průsečnici sousedních stěn).
function moveVertices(b, shiftOf) {
  const constraints = new Map();   // vrchol → [{n, r}]
  for (let t = 0; t < b.triangles.length / 3; t++) {
    const idx = [0, 1, 2].map((k) => b.triangles[3 * t + k]);
    const v = idx.map((i) => P(b, i));
    const nRaw = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    if (len(nRaw) === 0) continue;
    const n = unit(nRaw), r = shiftOf(b.faceIds[t], n);
    for (const i of idx) {
      const list = constraints.get(i) ?? [];
      if (!list.some((c) => dot(c.n, n) > 1 - 1e-9 && c.r === r)) list.push({ n, r });
      constraints.set(i, list);
    }
  }
  const positions = Float32Array.from(b.positions);
  for (const [i, list] of constraints) {
    if (!list.some((c) => c.r !== 0)) continue;
    // Nejmenší čtverce s minimální normou: (AᵀA + λI) d = Aᵀr
    const M = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]], rhs = [0, 0, 0];
    for (const { n, r } of list) for (let p = 0; p < 3; p++) { rhs[p] += n[p] * r; for (let q = 0; q < 3; q++) M[p][q] += n[p] * n[q]; }
    const det = dot(M[0], cross(M[1], M[2]));
    const col = (k) => M.map((row, p) => row.map((x, q) => (q === k ? rhs[p] : x)));
    const d = [0, 1, 2].map((k) => { const C = col(k); return dot(C[0], cross(C[1], C[2])) / det; });
    for (let k = 0; k < 3; k++) positions[3 * i + k] = b.positions[3 * i + k] + d[k];
  }
  return positions;
}

// Vrátí kopii nástroje `b` s posunutými stěnami, které leží v rovině stěn tělesa `a`.
function prepareTool(op, a, b, log) {
  if (op === 'intersection') return { tool: b, shifts: new Map() };
  const D = bboxDiagonal(a, b);
  const tol = D * 1e-5;        // co se ještě bere jako "v jedné rovině"
  const overlap = D * 4e-5;    // o kolik se stěna posune
  const shifts = new Map();    // číslo stěny nástroje → posun podél její normály
  const fa = planarFaces(a), fb = planarFaces(b);
  for (const B of fb) {
    for (const A of fa) {
      const c = dot(A.n, B.n);
      if (Math.abs(c) < 1 - 1e-6) continue;                       // nejsou rovnoběžné
      if (Math.abs(B.d - c * A.d) > tol) continue;                // nejsou v jedné rovině
      if (!facesOverlap(A, B, tol)) continue;                     // jsou, ale jinde
      const same = c > 0;
      let shift = 0;
      if (op === 'difference') shift = same ? overlap : -overlap; // lícuje → ven z tělesa; dosedá zvenku → od tělesa
      if (op === 'union' && !same) shift = overlap;               // dosedá → dovnitř tělesa
      if (shift !== 0) { shifts.set(B.id, { r: shift, n: B.n }); log?.push(`stěna ${B.id} ~ ${A.id}: posun ${shift > 0 ? '+' : '−'}`); }
      break;
    }
  }
  if (shifts.size === 0) return { tool: b, shifts };

  return { tool: { ...b, positions: moveVertices(b, (id) => shifts.get(id)?.r ?? 0) }, shifts };
}

const toManifold = (s) => new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(s.positions), triVerts: s.triangles, faceID: s.faceIds }));
function fromManifold(m) { const g = m.getMesh(); return { positions: g.vertProperties, triangles: g.triVerts, faceIds: g.faceID }; }

// Sloučí vrcholy, které po návratu stěn splynuly, a zahodí trojúhelníky, které tím zanikly.
// (Vyčištění průchodem přes Manifold se neosvědčilo: nulové trojúhelníky sbalil špatným směrem.)
function weld(s, eps) {
  const n = s.positions.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cell = (i) => [0, 1, 2].map((k) => Math.floor(s.positions[3 * i + k] / (eps * 4)));
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const c = cell(i);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of grid.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
        if (len(sub(P(s, i), P(s, j))) <= eps) parent[find(i)] = find(j);
      }
    }
    const key = c.join(','); grid.set(key, [...(grid.get(key) ?? []), i]);
  }
  const tris = [], ids = [];
  for (let t = 0; t < s.triangles.length / 3; t++) {
    const [p, q, r] = [0, 1, 2].map((k) => find(s.triangles[3 * t + k]));
    if (p === q || q === r || r === p) continue;
    tris.push(p, q, r); ids.push(s.faceIds[t]);
  }
  return { positions: s.positions, triangles: Uint32Array.from(tris), faceIds: Uint32Array.from(ids) };
}

// restore: po booleanu vrátí zbytky posunutých stěn do původní roviny a síť vyčistí.
function boolean(op, a, b, { prepare = true, restore = true, log } = {}) {
  const { tool, shifts } = prepare ? prepareTool(op, a, b, log) : { tool: b, shifts: new Map() };
  const A = toManifold(a), B = toManifold(tool);
  let out = fromManifold(op === 'union' ? A.add(B) : op === 'difference' ? A.subtract(B) : A.intersect(B));
  if (restore && shifts.size > 0 && [...out.faceIds].some((id) => shifts.has(id))) {
    if (process.env.DEBUG) console.log('   před návratem:', faceSummary(out));
    out = { ...out, positions: moveVertices(out, (id, n) => { const sh = shifts.get(id); return sh ? -sh.r * Math.sign(dot(n, sh.n)) : 0; }) };
    if (process.env.DEBUG) console.log('   po návratu:   ', faceSummary(out));
    out = weld(out, bboxDiagonal(a, b) * 1e-6);
    if (process.env.DEBUG) console.log('   po vyčištění: ', faceSummary(out));
    log?.push('zbytek posunuté stěny vrácen do roviny');
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
  return { faces, vol, closed: [...edges.values()].every((c) => c === 2) };
}

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
    const ok = idsOk && volOk && d.closed && extraOk;
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
    const okH = ch === 1 && Math.abs(dh.vol - (17000 + 108)) < 0.5 && !dh.faces.has(202) && dh.closed;
    const cutUp = boolean('difference', tunnel, prism(f, rect(12, 12, 18, 18), 10, 12, { start: 211, end: 212, sides: [213, 214, 215, 216] }), { restore });
    const dc = describe(cutUp, f);
    const okC = Math.abs(dc.vol - (17000 - 72)) < 0.5 && !dc.faces.has(211) && dc.closed;
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
    const okF = cf === 1 && Math.abs(df.vol - (12000 + 500 + 250)) < 0.5 && !df.faces.has(31) && !df.faces.has(222) && df.closed;
    console.log(`== Y ${label}: nálitek přes okraj a blok pod jeho převisem, ${tag}`);
    console.log(`   spodek převisu: plocha ${under.area.toFixed(2)} (čekáno 50), výška ${under.wMin.toFixed(5)}–${under.wMax.toFixed(5)} (zadáno 10)`);
    console.log(`   blok pod převisem: komponent ${cf}, objem ${df.vol.toFixed(3)} (čekáno 12750), zbytky dosedacích stěn ${df.faces.has(31) || df.faces.has(222) ? 'ANO' : 'ne'} → ${okF ? 'OK' : 'SELHAL'}`);
    results.push([`Y ${label}: blok pod převisem, ${tag}`, okF, !restore]);
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
