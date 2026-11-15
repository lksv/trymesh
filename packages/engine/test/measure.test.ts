// The exact part of a measurement (D39): the table of references and directions, on shapes
// written by hand.
import { describe, expect, it } from 'vitest';
import type { EntityShape } from '../src/query/entity';
import { exactBetween } from '../src/query/measure';
import type { Vec3 } from '../src/types';

const point = (at: Vec3): EntityShape => ({ is: 'point', at });
const line = (from: Vec3, to: Vec3): EntityShape => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  return { is: 'line', from, to, direction: [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length] };
};
const plane = (origin: Vec3, normal: Vec3): EntityShape => ({ is: 'plane', origin, normal });
const cylinder = (origin: Vec3, axis: Vec3, radius = 2): EntityShape => ({ is: 'cylinder', origin, axis, radius, convex: false });
const exact = (from: EntityShape, to: EntityShape) => exactBetween(from, to, 1e-6);
const Z: Vec3 = [0, 0, 1];
const HALF = Math.PI / 2;

describe('the exact part of a measurement', () => {
  it('distances between references, the same both ways', () => {
    const cases: [EntityShape, EntityShape, number | undefined][] = [
      [point([0, 0, 0]), point([3, 4, 12]), 13],
      [point([5, 3, 4]), line([0, 0, 0], [1, 0, 0]), 5], // to the line, not to its end
      [point([1, 2, 7]), plane([0, 0, 3], Z), 4],
      [point([1, 2, -7]), plane([0, 0, 3], [0, 0, -1]), 10], // never negative, whichever way the face looks
      [point([3, 4, 9]), cylinder([0, 0, 0], Z), 5], // to the axis
      [point([3, 4, 9]), { is: 'cone', apex: [0, 0, 1], axis: Z, halfAngle: 0.5, convex: true }, 5],
      [point([0, 0, 0]), { is: 'circle', center: [3, 4, 0], axis: Z, radius: 9 }, 5], // to the centre
      [line([0, 0, 0], [5, 0, 0]), line([9, 3, 4], [20, 3, 4]), 5], // parallel
      [line([0, 0, 0], [5, 0, 0]), line([2, -7, 6], [2, 8, 6]), 6], // skew: the common perpendicular
      [line([0, 0, 0], [5, 0, 0]), line([20, -7, 0], [20, 8, 0]), 0], // they cross beyond the end of the first
      [cylinder([0, 0, 0], Z), cylinder([50.5, 0, 9], [0, 0, -1]), 50.5], // the axes of two holes
      [cylinder([0, 0, 0], Z), plane([10, 0, 0], [1, 0, 0]), 10], // a hole beside a wall
      [cylinder([0, 0, 0], Z), plane([0, 0, 5], Z), undefined], // the axis goes through the plane
      [line([0, 0, 2], [9, 0, 2]), plane([0, 0, 5], Z), 3],
      [line([0, 0, 2], [9, 0, 3]), plane([0, 0, 5], Z), undefined],
      [plane([0, 0, 0], Z), plane([7, 7, 18], [0, 0, -1]), 18],
      [plane([0, 0, 0], Z), plane([7, 7, 18], [1, 0, 0]), undefined], // they cross somewhere
      [plane([0, 0, 0], Z), { is: 'swept', axis: Z }, undefined], // no reference
      [point([0, 0, 0]), { is: 'other' }, undefined],
    ];
    for (const [from, to, distance] of cases) {
      for (const found of [exact(from, to).distance, exact(to, from).distance]) {
        if (distance === undefined) expect(found, `${from.is} and ${to.is}`).toBeUndefined();
        else expect(found, `${from.is} and ${to.is}`).toBeCloseTo(distance, 12);
      }
    }
  });

  it('angles: two planes by their normals, a plane and a line by the line, two lines without a sign', () => {
    const cases: [EntityShape, EntityShape, number | undefined][] = [
      [plane([0, 0, 0], Z), plane([0, 0, 5], Z), 0], // two steps
      [plane([0, 0, 0], Z), plane([0, 0, 5], [0, 0, -1]), Math.PI], // the two sides of a wall
      [plane([0, 0, 0], Z), plane([0, 0, 5], [1, 0, 0]), HALF],
      [plane([0, 0, 0], Z), plane([0, 0, 5], [Math.SQRT1_2, 0, -Math.SQRT1_2]), (3 * Math.PI) / 4],
      [plane([0, 0, 0], Z), cylinder([4, 4, 0], Z), HALF], // a hole stands on the face
      [plane([0, 0, 0], [1, 0, 0]), cylinder([4, 4, 0], [0, 0, -1]), 0], // it runs along the wall
      [plane([0, 0, 0], Z), line([0, 0, 0], [1, 0, 1]), Math.PI / 4],
      [plane([0, 0, 0], Z), { is: 'swept', axis: [0, 0, -1] }, HALF],
      [line([0, 0, 0], [1, 0, 0]), line([5, 5, 5], [4, 5, 5]), 0], // opposite senses are one line
      [line([0, 0, 0], [1, 0, 0]), line([5, 5, 5], [5, 6, 5]), HALF],
      [cylinder([0, 0, 0], Z), { is: 'circle', center: [1, 1, 1], axis: [0, 0, -1], radius: 3 }, 0],
      [cylinder([0, 0, 0], Z), { is: 'swept', axis: Z }, 0], // a hole beside gear teeth
      [point([0, 0, 0]), plane([0, 0, 5], Z), undefined],
      [{ is: 'other' }, plane([0, 0, 5], Z), undefined],
    ];
    for (const [from, to, angle] of cases) {
      for (const found of [exact(from, to).angle, exact(to, from).angle]) {
        if (angle === undefined) expect(found, `${from.is} and ${to.is}`).toBeUndefined();
        else expect(found, `${from.is} and ${to.is}`).toBeCloseTo(angle, 12);
      }
    }
    // exactly parallel directions give exactly zero
    expect(exact(cylinder([0, 0, 0], Z), { is: 'swept', axis: Z }).angle).toBe(0);
  });

  it('facing: a wall and a slot of the same width are told apart', () => {
    const [up, down] = [plane([0, 0, 10], Z), plane([0, 0, 0], [0, 0, -1])];
    // the top and the bottom of a plate: each lies behind the other
    expect(exact(up, down)).toEqual({ distance: 10, angle: Math.PI, facing: 'away' });
    expect(exact(down, up)).toEqual({ distance: 10, angle: Math.PI, facing: 'away' });
    // the floor of a slot and its ceiling look at each other
    const [floor, ceiling] = [plane([0, 0, 0], Z), plane([0, 0, 10], [0, 0, -1])];
    expect(exact(floor, ceiling)).toEqual({ distance: 10, angle: Math.PI, facing: 'towards' });
    expect(exact(ceiling, floor)).toEqual({ distance: 10, angle: Math.PI, facing: 'towards' });
    // faces that look the same way, across, or lie in one plane have none
    expect(exact(plane([0, 0, 0], Z), plane([0, 0, 10], Z)).facing).toBeUndefined();
    expect(exact(plane([0, 0, 0], Z), plane([0, 0, 10], [1, 0, 0])).facing).toBeUndefined();
    expect(exact(plane([0, 0, 0], Z), plane([5, 5, 0], [0, 0, -1]))).toEqual({ distance: 0, angle: Math.PI });
    // within the precision of the coordinates two planes are one
    expect(exactBetween(plane([0, 0, 0], Z), plane([5, 5, 4e-5], [0, 0, -1]), 55e-6).facing).toBeUndefined();
    expect(exactBetween(plane([0, 0, 0], Z), plane([5, 5, 4e-5], [0, 0, -1]), 1e-6).facing).toBe('towards');
  });
});
