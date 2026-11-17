// The import of a mesh (D55) against the real kernel: what the checks of a stored mesh promise about
// what the kernel adapter then does with it (design.md, "Measured", 1, 3, 6 and 8). Every body of
// the arm goes through STL and back and the kernel takes it with its volume; a shell inside out
// beside a solid is taken by the kernel and hides a collision, which is why the checks refuse it;
// solids stacked on one outline are one solid to the kernel once the walls are left out.
import { type Id, type IndexedMesh, type Solid, importMesh, indexedMesh, meshProblem, shellsOf } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { beforeAll, describe, expect, it } from 'vitest';
import { arm } from './arm';
import { newEngine, run } from './kit';

const kernel = await createManifoldKernel();
const solidOf = (mesh: IndexedMesh, face = 0): Solid => ({ positions: mesh.positions, triangles: mesh.triangles, faceIds: new Uint32Array(mesh.triangles.length / 3).fill(face) });
const volume = (s: Solid): number => {
  let sum = 0;
  const p = s.positions;
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [3 * s.triangles[t], 3 * s.triangles[t + 1], 3 * s.triangles[t + 2]];
    sum += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return sum / 6;
};
// an axis-aligned box as a solid of the face `face`, every face cut along the diagonal from its lowest corner
function boxCorners(min: number[], max: number[], outward = true): number[] {
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const [u, v] = [(k + 1) % 3, (k + 2) % 3];
    for (const high of [false, true]) {
      const at = (a: boolean, b: boolean): number[] => {
        const p = [0, 0, 0];
        p[k] = high ? max[k] : min[k];
        p[u] = a ? max[u] : min[u];
        p[v] = b ? max[v] : min[v];
        return p;
      };
      const [p00, p10, p11, p01] = [at(false, false), at(true, false), at(true, true), at(false, true)];
      out.push(...(high === outward ? [p00, p10, p11, p00, p11, p01] : [p00, p11, p10, p00, p01, p11]).flat());
    }
  }
  return out;
}
const stlOf = (corners: number[]): Uint8Array => {
  const count = corners.length / 9;
  const bytes = new Uint8Array(84 + 50 * count);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) view.setFloat32(84 + 50 * t + 12 + 4 * k, corners[9 * t + k], true);
  return bytes;
};
const imported = (bytes: Uint8Array): IndexedMesh => {
  const outcome = importMesh('stl', bytes);
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return indexedMesh(outcome.mesh);
};
// a box with the face 1, welded by the import
const probe = (min: number[], max: number[]): Solid => solidOf(imported(stlOf(boxCorners(min, max))), 1);

describe('a stored mesh and the kernel (D55)', () => {
  let bodies: Record<Id, { volume: number; stl: Uint8Array }>;
  beforeAll(() => {
    const engine = newEngine();
    const state = run(engine, arm());
    bodies = Object.fromEntries(Object.entries(state.evaluation.bodies).map(([id, body]) => [id, { volume: body.volume, stl: engine.exportMesh('stl', [id]) }]));
  });

  it('every body of the arm through STL and back: closed, one shell, its volume to the last digit; the kernel takes it with that volume', () => {
    expect(Object.keys(bodies)).toHaveLength(8);
    for (const [id, body] of Object.entries(bodies)) {
      const outcome = importMesh('stl', body.stl);
      if (!outcome.ok) throw new Error(`${id}: ${outcome.error.message}`);
      expect(outcome.report, id).toMatchObject({ dropped: 0, walls: 0, shells: 1, turned: 0, nested: 0 });
      expect(outcome.report.volume, id).toBe(body.volume);
      const solid = solidOf(indexedMesh(outcome.mesh));
      const all = kernel.boolean('intersection', solid, probe([-1000, -1000, -1000], [1000, 1000, 1000]));
      expect(volume(all), id).toBeCloseTo(body.volume, 3);
    }
  });

  it('a cube inside out beside a solid: the kernel takes it and a probe in it shares nothing, so the check refuses it', () => {
    const mesh: IndexedMesh = imported(stlOf([...boxCorners([0, 0, 0], [20, 20, 20]), ...boxCorners([30, 0, 0], [40, 10, 10])]));
    // the second cube turned over by hand: the importer would have turned it back
    expect(shellsOf(mesh).map((shell) => shell.kind)).toEqual(['solid', 'solid']);
    const triangles = Uint32Array.from(mesh.triangles);
    for (let t = 12; t < 24; t++) [triangles[3 * t + 1], triangles[3 * t + 2]] = [triangles[3 * t + 2], triangles[3 * t + 1]];
    const insideOut: IndexedMesh = { positions: mesh.positions, triangles };
    const solid = solidOf(insideOut);
    expect(volume(solid)).toBeCloseTo(7000, 6); // closed and of a positive volume: the adapter takes it
    expect(volume(kernel.boolean('intersection', solid, probe([1, 1, 1], [3, 3, 3])))).toBeCloseTo(8, 6);
    // a collision there is hidden: what comes back has no positive volume (measured: −8, the probe turned inside out)
    expect(volume(kernel.boolean('intersection', solid, probe([32, 2, 2], [34, 4, 4])))).toBeLessThan(1e-9);
    expect(meshProblem(insideOut)?.message).toMatch(/the shell 2 \(of 2\) faces inwards/);
  });

  it('three boxes stacked on one outline are one solid to the kernel: a probe across both seams shares all of its volume', () => {
    const stack = [boxCorners([0, 0, 0], [10, 10, 10]), boxCorners([0, 0, 10], [10, 10, 20]), boxCorners([0, 0, 20], [10, 10, 30])].flat();
    const outcome = importMesh('stl', stlOf(stack));
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.report).toMatchObject({ walls: 4, shells: 1 });
    const solid = solidOf(indexedMesh(outcome.mesh));
    expect(volume(kernel.boolean('intersection', solid, probe([2, 2, 5], [8, 8, 25])))).toBeCloseTo(720, 6);
  });
});
