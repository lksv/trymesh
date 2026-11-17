// The precondition of the port for a union and a difference (D56): the operands share no face
// number. And the band of guarantee 3 the engine's checks of a boolean of bodies rely on (faces
// within 1e-5 D are one plane), pinned.
import { describe as suite, expect, it } from 'vitest';
import { tolerances } from '../src/geometry';
import { IDENTITY, describe, kernel, prism, rect } from './testkit';

const block = prism(IDENTITY, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
const own = { start: 11, end: 12, sides: [13, 14, 15, 16] };

suite('the precondition: no face number in both operands of a union or a difference', () => {
  it('a union and a difference whose operands share a number throw, naming the number', () => {
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 5, 15, { ...own, end: 2 });
    expect(() => kernel.boolean('union', block, tool)).toThrow(/share the face number 2/);
    expect(() => kernel.boolean('difference', block, tool)).toThrow(/share the face number 2/);
  });

  it('a body with itself is refused too (every number shared)', () => {
    expect(() => kernel.boolean('union', block, block)).toThrow(/share the face number/);
  });

  it('an intersection takes shared numbers (the collisions ask it so)', () => {
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 5, 15, { ...own, end: 2 });
    const out = kernel.boolean('intersection', block, tool);
    expect(describe(out, IDENTITY).volume).toBeCloseTo(500, 3);
  });

  it('operands with numbers of their own pass', () => {
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 5, 15, own);
    expect(describe(kernel.boolean('union', block, tool), IDENTITY).volume).toBeCloseTo(12000 + 500, 3);
    expect(describe(kernel.boolean('difference', block, tool), IDENTITY).volume).toBeCloseTo(12000 - 500, 3);
  });
});

suite('the band of guarantee 3, which the checks of a boolean of bodies take as given', () => {
  it('is 1e-5 of D, the diagonal of the box of both solids but at least twice their largest coordinate', () => {
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 10, 15, own);
    expect(tolerances(block, tool).tol).toBeCloseTo(1e-5 * Math.max(Math.hypot(40, 30, 15), 2 * 40), 12);
    const far = prism({ ...IDENTITY, o: [1000, 0, 0] }, rect(0, 0, 1, 1), 0, 1, own);
    expect(tolerances(far).tol).toBeCloseTo(1e-5 * 2 * 1001, 12);
    const large = prism(IDENTITY, rect(0, 0, 400, 300), 0, 10, own);
    expect(tolerances(large).tol).toBeCloseTo(1e-5 * Math.max(Math.hypot(400, 300, 10), 800), 12);
  });

  // Within the band a box above or into the top is joined without a gap or a wall between, but the
  // volume is not exact: the band the adapter's shift opened is left as material (D56, "Verified",
  // 2: a silent defect of the union, up to the shift times the area of the contact, which the
  // volume check of `booleanOfBodies` turns into a refusal).
  for (const fraction of [0.5, -0.5]) {
    it(`a box ${fraction > 0 ? 'half a band above' : 'half a band into'} the top of the block is joined to it, closed, with no wall left`, () => {
      const probe = prism(IDENTITY, rect(10, 10, 20, 20), 10, 15, own);
      const t = tolerances(block, probe);
      const gap = fraction * t.tol;
      const tool = prism(IDENTITY, rect(10, 10, 20, 20), 10 + gap, 15, own);
      const result = kernel.boolean('union', block, tool);
      const out = describe(result, IDENTITY);
      expect(out.closed).toBe(true);
      expect(result.faceIds.includes(11)).toBe(false); // the bottom of the box is gone
      expect(Math.abs(out.volume - (12000 + 500))).toBeLessThanOrEqual(100 * t.overlap);
    });
  }
});
