// Doplněk spiku: jak velké jsou "zbytkové" stěny u šikmých koplanárních případů a pomůže tolerance?
import Module from 'manifold-3d';
const wasm = await Module(); wasm.setup();
const { Manifold, Mesh, triangulate } = wasm;
const [a, b, c] = [30, 20, 10].map((d) => (d * Math.PI) / 180);
const rx = (v) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const ry = (v) => [v[0] * Math.cos(b) + v[2] * Math.sin(b), v[1], -v[0] * Math.sin(b) + v[2] * Math.cos(b)];
const rz = (v) => [v[0] * Math.cos(c) - v[1] * Math.sin(c), v[0] * Math.sin(c) + v[1] * Math.cos(c), v[2]];
const r = (v) => rz(ry(rx(v)));
const f = { o: [3.7, -1.3, 2.9], x: r([1, 0, 0]), y: r([0, 1, 0]), n: r([0, 0, 1]) };
const W = (u, v, w) => [0, 1, 2].map((k) => f.o[k] + u * f.x[k] + v * f.y[k] + w * f.n[k]);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function prism(loop, w0, w1, { start, end, sides }, tolerance) {
  const n = loop.length, pos = [], tris = [], ids = [];
  for (const w of [w0, w1]) for (const [u, v] of loop) pos.push(...W(u, v, w));
  const cap = triangulate([loop]);
  for (const [p, q, s] of cap) { tris.push(p, s, q); ids.push(start); }
  for (const [p, q, s] of cap) { tris.push(n + p, n + q, n + s); ids.push(end); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; tris.push(i, j, n + j, i, n + j, n + i); ids.push(sides[i], sides[i]); }
  const opts = { numProp: 3, vertProperties: Float32Array.from(pos), triVerts: Uint32Array.from(tris), faceID: Uint32Array.from(ids) };
  if (tolerance) opts.tolerance = tolerance;
  return new Manifold(new Mesh(opts));
}
function faces(m) {
  const mesh = m.getMesh(), P = (i) => [...mesh.vertProperties.slice(3 * i, 3 * i + 3)], out = new Map();
  for (let t = 0; t < mesh.triVerts.length / 3; t++) {
    const [pa, pb, pc] = [0, 1, 2].map((k) => P(mesh.triVerts[3 * t + k]));
    const u = pb.map((x, k) => x - pa[k]), v = pc.map((x, k) => x - pa[k]);
    const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    const e = out.get(mesh.faceID[t]) ?? { tris: 0, area: 0 }; e.tris++; e.area += area; out.set(mesh.faceID[t], e);
  }
  return [...out].sort((x, y) => x[0] - y[0]).map(([id, e]) => `${id}:${e.tris}t/${e.area.toExponential(1)}`).join('  ');
}
for (const tol of [0, 1e-5, 1e-4, 1e-3]) {
  const B = prism(rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] }, tol);
  console.log(`\n--- tolerance ${tol} (skutečná ${B.tolerance().toExponential(2)})`);
  const boss = prism(rect(10, 10, 20, 20), 10, 15, { start: 31, end: 32, sides: [33, 34, 35, 36] }, tol);
  console.log('T3 nálitek bez přesahu:   ', faces(B.add(boss)));
  const pocket = prism(rect(30, 10, 40, 20), 5, 10.01, { start: 41, end: 42, sides: [43, 44, 45, 46] }, tol);
  console.log('T4 bok v rovině boku:     ', faces(B.subtract(pocket)));
  console.log('T4 + simplify(1e-4):      ', faces(B.subtract(pocket).simplify(1e-4)));
  console.log('T4 + simplify(1e-3):      ', faces(B.subtract(pocket).simplify(1e-3)));
  console.log('T3 + simplify(1e-3):      ', faces(B.add(boss).simplify(1e-3)));
  const pocket2 = prism(rect(30, 10, 40.01, 20), 5, 10.01, { start: 41, end: 42, sides: [43, 44, 45, 46] }, tol);
  console.log('T4 s bočním přesahem 0.01:', faces(B.subtract(pocket2)));
  const other = prism(rect(30, 5, 60, 25), 0, 10, { start: 61, end: 62, sides: [63, 64, 65, 66] }, tol);
  console.log('T6 společná horní rovina: ', faces(B.add(other)));
}
