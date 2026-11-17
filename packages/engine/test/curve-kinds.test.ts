// The kinds of a sketch curve (D64, part 3): the validator accepts the kinds of the table of curve
// points, and the end of an exhaustive switch throws when a value it was not written for reaches it.
import { describe, expect, it } from 'vitest';
import { CURVE_KINDS, CURVE_POINTS } from '../src/sketch-content';
import { unreachable } from '../src/util';

describe('the kinds of a sketch curve', () => {
  it('are the keys of CURVE_POINTS, in its order', () => {
    expect(CURVE_KINDS).toEqual(['line', 'circle', 'arc']);
    expect(CURVE_KINDS).toEqual(Object.keys(CURVE_POINTS));
  });

  it('a switch that meets a kind it has no case for throws', () => {
    expect(() => unreachable({ type: 'spline' } as never, 'curve')).toThrow('curve: unexpected {"type":"spline"}');
  });
});
