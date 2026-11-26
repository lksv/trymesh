// The geometry of the selection the AI reads (D74, selection.ts): the normal of a face where its
// body is posed, the point of an edge under the pointer, and the entity of a sketch nearest to a
// place.
import type { Solid, SketchFeature, SketchResult } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { entityOf, nearestEntity, nearestOnSegments, triangleNormal } from '../src/selection';
import type { SketchView } from '../src/sketch-view';

describe('the selection for the AI', () => {
  it('the normal of a triangle, out of its body, turned by the pose of the body', () => {
    // one triangle in z = 0, counter-clockwise seen from +Z
    const solid = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: new Uint32Array([0, 1, 2]), faceIds: new Uint32Array([0]) } as unknown as Solid;
    expect(triangleNormal(solid, 0)).toEqual([0, 0, 1]);
    // a quarter turn about X takes +Z to −Y
    const turn = { matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]], translation: [5, 5, 5] };
    expect(triangleNormal(solid, 0, turn)).toEqual([0, -1, 0]);
  });

  it('the point of an edge the view shows nearest to the pointer', () => {
    // a view straight down with one pixel per millimetre: the window is the plane XY
    const project = (x: number, y: number, z: number) => ({ x, y, depth: -z });
    const segments = [0, 0, 5, 10, 0, 5, 10, 0, 5, 10, 10, 5];
    expect(nearestOnSegments(segments, project, 4, 3)).toEqual([4, 0, 5]);
    expect(nearestOnSegments(segments, project, 13, 6)).toEqual([10, 6, 5]);
    expect(nearestOnSegments([], project, 0, 0)).toBeUndefined();
  });

  it('the entity of a sketch nearest to a place: a point within the snap, else the nearer of a point and a curve', () => {
    const view: SketchView = {
      points: new Map([
        ['origin', { id: 'origin', at: [0, 0], own: false }],
        ['p1', { id: 'p1', at: [10, 0], own: true }],
        ['p2', { id: 'p2', at: [10, 10], own: true }],
        ['q1', { id: 'q1', at: [30, 0], own: false, derived: true }],
      ]),
      curves: new Map([
        ['c1', { id: 'c1', own: true, construction: true, shape: { type: 'line', a: [10, 0], b: [10, 10] }, points: ['p1', 'p2'] }],
        ['e1', { id: 'e1', own: false, construction: false, shape: { type: 'circle', center: [30, 30], radius: 5 }, points: [] }],
      ]),
      source: { sketch: {} as SketchFeature, result: {} as SketchResult },
    };
    expect(entityOf(view, 'c1')).toEqual({ id: 'c1', kind: 'line', source: 'own', construction: true });
    expect(entityOf(view, 'origin')).toEqual({ id: 'origin', kind: 'point', source: 'reference' });
    expect(entityOf(view, 'q1')).toEqual({ id: 'q1', kind: 'point', source: 'derived' });
    expect(entityOf(view, 'e1')).toEqual({ id: 'e1', kind: 'circle', source: 'reference' });
    expect(entityOf(view, 'nope')).toBeUndefined();
    // on the line, 4 mm from its end: the line, not the point a drawing tool would not snap to
    expect(nearestEntity(view, [10, 4], 2, 20)).toEqual({ id: 'c1', kind: 'line', source: 'own', construction: true, distance: 0 });
    // within the snap of an end: the point
    expect(nearestEntity(view, [11, 1], 2, 20)).toMatchObject({ id: 'p1', distance: Math.SQRT2 });
    // nearer to the circle than to any point
    expect(nearestEntity(view, [30, 23], 2, 20)).toEqual({ id: 'e1', kind: 'circle', source: 'reference', distance: 2 });
    expect(nearestEntity(view, [60, 60], 2, 20)).toBeUndefined();
  });
});
