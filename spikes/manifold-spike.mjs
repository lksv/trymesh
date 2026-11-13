// Spike: ověření předpokladů o Manifoldu (viz docs/architecture.md, Předpoklady k ověření).
// Spuštění: node manifold-spike.mjs
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh, triangulate } = wasm;

// ---------- pomocné funkce ----------

const IDENTITY = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };

function rotated() {
  // Obecná rotace (30°, 20°, 10°), aby žádná stěna nebyla rovnoběžná s osami.
  const [a, b, c] = [30, 20, 10].map((d) => (d * Math.PI) / 180);
  const rx = (v) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v) => [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
  const rz = (v) => [v[0] * Math.cos(c) - v[1] * Math.sin(c), v[0] * Math.sin(c) + v[1] * Math.cos(c), v[2]];
  const r = (v) => rz(ry(rx(v)));
  return { o: [3.7, -1.3, 2.9], x: r([1, 0, 0]), y: r([0, 1, 0]), n: r([0, 0, 1]) };
}

const toWorld = (f, u, v, w) => [0, 1, 2].map((k) => f.o[k] + u * f.x[k] + v * f.y[k] + w * f.n[k]);

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const circle = (cx, cy, r, n = 32) =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

// Hranol z 2D smyčky (CCW). sideIds: číslo stěny pro každou hranu smyčky.
function prism(frame, loop, w0, w1, { start, end, sides }) {
  const n = loop.length;
  const pos = [];
  for (const w of [w0, w1]) for (const [u, v] of loop) pos.push(...toWorld(frame, u, v, w));
  const tris = [];
  const ids = [];
  const cap = triangulate([loop]);
  for (const [a, b, c] of cap) { tris.push(a, c, b); ids.push(start); }            // dolní víko, normála -n
  for (const [a, b, c] of cap) { tris.push(n + a, n + b, n + c); ids.push(end); }  // horní víko
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const id = Array.isArray(sides) ? sides[i] : sides;
    tris.push(i, j, n + j, i, n + j, n + i);
    ids.push(id, id);
  }
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tris), faceIds: Uint32Array.from(ids) };
}

function toManifold(solid) {
  const mesh = new Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(solid.positions),
    triVerts: solid.triangles,
    faceID: solid.faceIds,
  });
  const m = new Manifold(mesh);
  if (m.status() !== 'NoError' && m.status() !== 0) throw new Error('status ' + JSON.stringify(m.status()));
  return m;
}

function fromManifold(m) {
  const mesh = m.getMesh();
  return {
    positions: Float64Array.from(mesh.vertProperties),
    triangles: mesh.triVerts,
    faceIds: mesh.faceID,
    _vertType: mesh.vertProperties.constructor.name,
    _numProp: mesh.numProp,
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(...a);

function stats(solid) {
  const P = (i) => [solid.positions[3 * i], solid.positions[3 * i + 1], solid.positions[3 * i + 2]];
  const perFace = new Map();
  let slivers = 0;
  const edgeUse = new Map();
  for (let t = 0; t < solid.triangles.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => solid.triangles[3 * t + k]);
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const nrm = cross(sub(pb, pa), sub(pc, pa));
    const area = len(nrm) / 2;
    const longest = Math.max(len(sub(pb, pa)), len(sub(pc, pb)), len(sub(pa, pc)));
    const altitude = longest > 0 ? (2 * area) / longest : 0;
    if (altitude < 1e-3) slivers++;
    const id = solid.faceIds[t];
    const f = perFace.get(id) ?? { tris: 0, area: 0, n: [0, 0, 0] };
    f.tris++; f.area += area; f.n = [f.n[0] + nrm[0], f.n[1] + nrm[1], f.n[2] + nrm[2]];
    perFace.set(id, f);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  const closed = [...edgeUse.values()].every((c) => c === 2);
  return { tris: solid.triangles.length / 3, slivers, closed, perFace };
}

function report(title, m, frame, expectIds, expectVolume) {
  const solid = fromManifold(m);
  const s = stats(solid);
  const ids = [...s.perFace.keys()].sort((a, b) => a - b);
  const idsOk = JSON.stringify(ids) === JSON.stringify([...expectIds].sort((a, b) => a - b));
  const vol = m.volume();
  const volOk = expectVolume === undefined || Math.abs(vol - expectVolume) < 1e-2 * Math.max(1, Math.abs(expectVolume)) * 0.05;
  console.log(`\n== ${title}`);
  console.log(`   trojúhelníků ${s.tris}, úzkých ${s.slivers}, uzavřené ${s.closed}, objem ${vol.toFixed(4)}` +
    (expectVolume !== undefined ? ` (čekáno ${expectVolume.toFixed(4)}) ${volOk ? 'OK' : 'NESEDÍ'}` : ''));
  console.log(`   čísla stěn ${JSON.stringify(ids)} ${idsOk ? 'OK' : 'NESEDÍ, čekáno ' + JSON.stringify(expectIds)}`);
  return { solid, s, ok: idsOk && volOk && s.closed };
}

// Základní kvádr 40×30×10: stěny 1 (start), 2 (end/top), 3–6 (boky).
const box = (f) => prism(f, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
const results = [];

for (const [label, f] of [['osově', IDENTITY], ['šikmo', rotated()]]) {
  const B = toManifold(box(f));

  // T1: průchozí válcová díra s přesahem na obou stranách.
  {
    const tool = toManifold(prism(f, circle(20, 15, 5), -1, 11, { start: 11, end: 12, sides: 10 }));
    const r = report(`T1 ${label}: průchozí válcová díra (nástroj přesahuje)`, B.subtract(tool), f, [1, 2, 3, 4, 5, 6, 10], 12000 - Math.PI * 25 * 10 * (Math.sin(Math.PI / 32) * Math.cos(Math.PI / 32) * 32 / Math.PI));
    // Normála stěny díry má mířit ven z materiálu, tedy k ose díry.
    const solid = r.solid;
    let inward = 0, total = 0;
    for (let t = 0; t < solid.triangles.length / 3; t++) {
      if (solid.faceIds[t] !== 10) continue;
      const P = (i) => [solid.positions[3 * i], solid.positions[3 * i + 1], solid.positions[3 * i + 2]];
      const [pa, pb, pc] = [0, 1, 2].map((k) => P(solid.triangles[3 * t + k]));
      const nrm = cross(sub(pb, pa), sub(pc, pa));
      const centroid = [0, 1, 2].map((k) => (pa[k] + pb[k] + pc[k]) / 3);
      const axisPoint = toWorld(f, 20, 15, 5);
      total++;
      if (dot(nrm, sub(axisPoint, centroid)) > 0) inward++;
    }
    console.log(`   normály stěny díry mířící k ose: ${inward}/${total}`);
    results.push([`T1 ${label}`, r.ok && inward === total]);
  }

  // T2: slepá kapsa začínající přesně na horní stěně, bez přesahu a s přesahem.
  for (const [ov, name] of [[0, 'bez přesahu'], [0.01, 'přesah 0.01']]) {
    const tool = toManifold(prism(f, rect(10, 10, 20, 20), 5, 10 + ov, { start: 21, end: 22, sides: [23, 24, 25, 26] }));
    const r = report(`T2 ${label}: slepá kapsa od horní stěny, ${name}`, B.subtract(tool), f, [1, 2, 3, 4, 5, 6, 21, 23, 24, 25, 26], 12000 - 500);
    results.push([`T2 ${label} ${name}`, r.ok]);
  }

  // T3: přidání nálitku začínajícího přesně na horní stěně, bez přesahu a s přesahem.
  for (const [ov, name] of [[0, 'bez přesahu'], [0.01, 'přesah 0.01']]) {
    const tool = toManifold(prism(f, rect(10, 10, 20, 20), 10 - ov, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }));
    const r = report(`T3 ${label}: nálitek na horní stěně, ${name}`, B.add(tool), f, [1, 2, 3, 4, 5, 6, 32, 33, 34, 35, 36], 12000 + 500);
    results.push([`T3 ${label} ${name}`, r.ok]);
  }

  // T4: boční stěna nástroje v rovině boční stěny tělesa (kapsa otevřená do boku).
  {
    const tool = toManifold(prism(f, rect(30, 10, 40, 20), 5, 10.01, { start: 41, end: 42, sides: [43, 44, 45, 46] }));
    const r = report(`T4 ${label}: kapsa s bokem v rovině boku tělesa`, B.subtract(tool), f, [1, 2, 3, 4, 5, 6, 41, 43, 45, 46], 12000 - 500);
    results.push([`T4 ${label}`, r.ok]);
  }

  // T5: výřez přesně na tloušťku (koncové víko v rovině spodní stěny), start s přesahem.
  {
    const tool = toManifold(prism(f, rect(10, 10, 20, 20), 0, 10.01, { start: 51, end: 52, sides: [53, 54, 55, 56] }));
    const r = report(`T5 ${label}: výřez přesně na tloušťku`, B.subtract(tool), f, [1, 2, 3, 4, 5, 6, 53, 54, 55, 56], 12000 - 1000);
    results.push([`T5 ${label}`, r.ok]);
  }

  // T6: dvě tělesa s horní stěnou v jedné rovině – jména nesmí splynout.
  {
    const other = toManifold(prism(f, rect(30, 5, 60, 25), 0, 10, { start: 61, end: 62, sides: [63, 64, 65, 66] }));
    const r = report(`T6 ${label}: sjednocení se společnou rovinou horních stěn`, B.add(other), f, [1, 2, 3, 4, 5, 6, 61, 62, 63, 64, 65], 12000 + 20 * 20 * 10);
    results.push([`T6 ${label}`, r.ok]);
  }

  // T7: drážka přes celou šířku rozdělí horní stěnu na dvě části – obě si nechají číslo 2.
  {
    const tool = toManifold(prism(f, rect(15, -1, 25, 31), 5, 10.01, { start: 71, end: 72, sides: [73, 74, 75, 76] }));
    const r = report(`T7 ${label}: drážka rozdělí horní stěnu`, B.subtract(tool), f, [1, 2, 3, 4, 5, 6, 71, 74, 76], 12000 - 10 * 30 * 5);
    results.push([`T7 ${label}`, r.ok]);
  }

  // T8: opakované booleany přes Solid (float32 round-trip) – drift horní roviny.
  {
    let solid = box(f);
    for (let i = 0; i < 12; i++) {
      const x = 2 + i * 3;
      const tool = prism(f, rect(x, 12, x + 2, 18), 8, 10.01, { start: 100 + i * 10, end: 101 + i * 10, sides: 102 + i * 10 });
      solid = fromManifold(toManifold(solid).subtract(toManifold(tool)));
    }
    // Všechny vrcholy trojúhelníků stěny 2 mají ležet v rovině w = 10.
    let maxDev = 0;
    const planePoint = toWorld(f, 0, 0, 10);
    for (let t = 0; t < solid.triangles.length / 3; t++) {
      if (solid.faceIds[t] !== 2) continue;
      for (let k = 0; k < 3; k++) {
        const i = solid.triangles[3 * t + k];
        const p = [solid.positions[3 * i], solid.positions[3 * i + 1], solid.positions[3 * i + 2]];
        maxDev = Math.max(maxDev, Math.abs(dot(sub(p, planePoint), f.n)));
      }
    }
    const s = stats(solid);
    console.log(`\n== T8 ${label}: 12 výřezů za sebou přes round-trip`);
    console.log(`   typ vrcholů na výstupu: ${solid._vertType}, numProp ${solid._numProp}`);
    console.log(`   trojúhelníků ${s.tris}, úzkých ${s.slivers}, uzavřené ${s.closed}`);
    console.log(`   max. odchylka vrcholů horní stěny od roviny: ${maxDev.toExponential(2)}`);
    results.push([`T8 ${label}`, s.closed && maxDev < 1e-4]);
  }
}

// T9: triangulace polygonu s dírou.
{
  const outer = rect(0, 0, 10, 10);
  const hole = circle(5, 5, 2, 16).reverse();
  const tris = triangulate([outer, hole]);
  const pts = [...outer, ...hole];
  let area = 0;
  for (const [a, b, c] of tris) {
    area += ((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])) / 2;
  }
  const expected = 100 - 0.5 * 16 * 4 * Math.sin((2 * Math.PI) / 16);
  console.log(`\n== T9: triangulace čtverce s dírou: ${tris.length} trojúhelníků, plocha ${area.toFixed(4)} (čekáno ${expected.toFixed(4)})`);
  results.push(['T9 triangulace', Math.abs(area - expected) < 1e-6]);
}

console.log('\n==== SOUHRN ====');
for (const [name, ok] of results) console.log(`${ok ? 'OK    ' : 'SELHAL'} ${name}`);
