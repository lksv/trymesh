// The intersection as computed (D50, `intersectionAsComputed` of the port): the raw intersection of
// the library, checked for one thing, that it is closed by its indices. The poses the adapter
// refuses are pinned in packages/scenarios/test/second-opinion.test.ts, which builds them through
// the engine (a refusal depends on the exact polygons of the model); here are the guarantees on
// solids of the kit.
import { describe, expect, it } from 'vitest';
import type { Solid } from '@trymesh/engine';
import { isClosed } from '../src/clean';
import { IDENTITY, circle, idsOf, kernel, prism, rect, rotated } from './testkit';

const block = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, first: number): Solid =>
  prism(IDENTITY, rect(x0, y0, x1, y1), z0, z1, { start: first, end: first + 1, sides: [first + 2, first + 3, first + 4, first + 5] });
const signedVolume = (s: Solid): number => {
  let volume = 0;
  const p = s.positions;
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [3 * s.triangles[t], 3 * s.triangles[t + 1], 3 * s.triangles[t + 2]];
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return volume / 6;
};
const message = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw');
};

describe('the intersection as computed', () => {
  it('is the common part, closed by its indices, with the face numbers of both inputs, wrapped', () => {
    const a = block(0, 0, 40, 30, 0, 10, 1);
    const b = block(30, 20, 50, 40, 5, 15, 11);
    const computed = kernel.intersectionAsComputed(a, b);
    expect(Object.keys(computed)).toEqual(['unverified']);
    const mesh = computed.unverified;
    expect(isClosed(mesh)).toBe(true);
    expect(signedVolume(mesh)).toBeCloseTo(500, 3);
    const faces = idsOf(mesh);
    expect(faces.some((id) => id < 10)).toBe(true);
    expect(faces.some((id) => id > 10)).toBe(true);
    // the same as the verified answer where the adapter answers
    expect(signedVolume(kernel.boolean('intersection', a, b))).toBeCloseTo(signedVolume(mesh), 6);
  });

  it('two solids apart give a mesh without triangles; the same input gives the same arrays', () => {
    const a = block(0, 0, 10, 10, 0, 10, 1);
    expect(kernel.intersectionAsComputed(a, block(20, 0, 30, 10, 0, 10, 11)).unverified.triangles.length).toBe(0);
    // a pin turned in a hole of the same circle, askew to the axes: a mesh of slivers
    const frame = rotated();
    const plate = prism(frame, rect(-20, -20, 20, 20), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
    const hole = prism(frame, circle(0, 0, 4, 31), -1, 11, { start: 7, end: 8, sides: Array(31).fill(9) });
    const holed = kernel.boolean('difference', plate, hole);
    const turned = { ...frame, x: frame.y.map((v) => -v) as typeof frame.x, y: frame.x };
    const pin = prism(turned, circle(0, 0, 4, 31), 0, 10, { start: 21, end: 22, sides: Array(31).fill(23) });
    const first = kernel.intersectionAsComputed(holed, pin).unverified;
    const second = kernel.intersectionAsComputed(holed, pin).unverified;
    expect(first.triangles.length).toBeGreaterThan(0);
    expect(isClosed(first)).toBe(true);
    expect([...second.positions]).toEqual([...first.positions]);
    expect([...second.triangles]).toEqual([...first.triangles]);
    expect([...second.faceIds]).toEqual([...first.faceIds]);
  });

  it('refuses the inputs `boolean` refuses, with the same message', () => {
    const good = block(0, 0, 10, 10, 0, 10, 1);
    const open: Solid = { ...good, triangles: good.triangles.slice(3), faceIds: good.faceIds.slice(1) };
    const inside: Solid = { ...good, triangles: Uint32Array.from(good.triangles).reverse() };
    const notANumber: Solid = { ...good, positions: Float32Array.from(good.positions, (v, i) => (i === 0 ? Number.NaN : v)) };
    for (const bad of [open, inside, notANumber]) {
      const refused = message(() => kernel.boolean('intersection', good, bad));
      expect(message(() => kernel.intersectionAsComputed(good, bad))).toBe(refused);
      expect(message(() => kernel.intersectionAsComputed(bad, good))).toBe(message(() => kernel.boolean('intersection', bad, good)));
    }
  });
});
