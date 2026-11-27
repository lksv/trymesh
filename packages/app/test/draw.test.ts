// What a cut of the model leaves of a line, and whether a point lies in a filled region (D38).
import { describe, expect, it } from 'vitest';
import { THREAD_POINTS, insideFill, keptSegments, threadLines } from '../src/draw';

describe('a cut model', () => {
  const clip = { origin: [0, 0, 5] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

  it('a line that belongs to a body is cut by the half-space: kept below, gone above, ended at the plane', () => {
    const below = [0, 0, 0, 10, 0, 4];
    const above = [0, 0, 6, 10, 0, 9];
    const up = [0, 0, 0, 10, 0, 10]; // crosses at (5, 0, 5)
    const down = [4, 2, 9, 4, 2, 1];
    const inPlane = [1, 1, 5, 2, 2, 5]; // a line in the plane itself is kept
    expect(Array.from(keptSegments([...below, ...above, ...up, ...down, ...inPlane], clip))).toEqual([...below, 0, 0, 0, 5, 0, 5, 4, 2, 5, 4, 2, 1, ...inPlane]);
    // seen from the other side the other parts are left
    expect(Array.from(keptSegments([...below, ...above, ...up], { origin: clip.origin, normal: [0, 0, -1] }))).toEqual([...above, 5, 0, 5, 10, 0, 10]);
    // an end exactly in the plane: the segment is kept whole from below and leaves nothing from above
    expect(Array.from(keptSegments([0, 0, 5, 3, 0, 2, 0, 0, 5, 3, 0, 8, 7, 7, 9, 7, 7, 5], clip))).toEqual([0, 0, 5, 3, 0, 2]);
    // without a cut the segments are handed on as they are
    const segments = Float64Array.from(up);
    expect(keptSegments(segments, undefined)).toBe(segments);
  });

  it('a point is in a fill when it is inside its outer loop and in none of its holes', () => {
    const plate = [0, 0, 40, 0, 40, 30, 0, 30];
    const hole = [5, 5, 5, 15, 15, 15, 15, 5];
    expect(insideFill([20, 20], [plate, hole])).toBe(true);
    expect(insideFill([10, 10], [plate, hole])).toBe(false); // in the hole
    expect(insideFill([10, 10], [plate])).toBe(true);
    expect(insideFill([50, 10], [plate, hole])).toBe(false);
    expect(insideFill([20, -1], [plate, hole])).toBe(false);
    expect(insideFill([1, 1], [])).toBe(false);
  });
});

describe('the lines of a thread (D76)', () => {
  // the datum of the record: the middle of the crest at origin + s · axis + r · (zero turned by θ)
  const thread = { origin: [1, 2, 3] as [number, number, number], axis: [0, 0, -1] as [number, number, number], zero: [0, 1, 0] as [number, number, number], radius: 2.5, internal: true, pitch: 1, starts: 2, hand: 'left' as const, from: 1, to: 5 };
  it('one line per start, on the helix of the datum, lifted into the bore, from `from` to `to`', () => {
    const segments = threadLines(thread);
    const side = [thread.axis[1] * thread.zero[2] - thread.axis[2] * thread.zero[1], thread.axis[2] * thread.zero[0] - thread.axis[0] * thread.zero[2], thread.axis[0] * thread.zero[1] - thread.axis[1] * thread.zero[0]];
    const lead = 2;
    const along: number[] = [];
    for (let i = 0; i < segments.length; i += 3) {
      const d = [segments[i] - 1, segments[i + 1] - 2, segments[i + 2] - 3];
      const s = -d[2];
      along.push(s);
      expect(Math.hypot(d[0], d[1])).toBeCloseTo(2.5 * 0.99, 9);
      const theta = Math.atan2(d[0] * side[0] + d[1] * side[1], d[0] * thread.zero[0] + d[1] * thread.zero[1]);
      // s = turn · lead · θ / 2π + k · pitch, turn −1: the rest is a whole number of pitches
      const k = (s + (lead * theta) / (2 * Math.PI)) / thread.pitch;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
    expect(Math.min(...along)).toBeCloseTo(1, 12);
    expect(Math.max(...along)).toBeCloseTo(5, 12);
  });
  it('a short thread gets 48 points a turn; a long fine one fewer, down to eight a turn', () => {
    expect(threadLines({ ...thread, starts: 1, from: 0, to: 10 }).length / 6).toBe(10 * 48);
    expect(threadLines({ ...thread, starts: 1, from: 0, to: 200 }).length / 6).toBe(200 * Math.floor(THREAD_POINTS / 200));
    expect(threadLines({ ...thread, starts: 1, pitch: 0.2, from: 0, to: 1000 }).length / 6).toBe(8 * 5000);
  });
});
