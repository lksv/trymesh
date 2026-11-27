// The rows a pick of the view or an entity of a sketch marks (hover.ts), for the kinds of objects
// the driven case of app.test.ts does not build.
import { type FaceName, type SketchFeature, type ThreadResult, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { pickRows, sketchRows } from '../src/hover';

const face = (body: string, name: FaceName) => ({ kind: 'face', body, faceId: 0, name, planar: true }) as const;

describe('the rows of a pick of the view', () => {
  it('a face of a split body: the feature of the face and the split that made the body', () => {
    expect(pickRows(face('split', { feature: 'e1', role: 'endCap' }))).toEqual(['feature:e1', 'feature:split', 'body:split']);
    expect(pickRows(face('e1', { feature: 'split', role: 'splitFace' }))).toEqual(['feature:split', 'feature:e1', 'body:e1']);
  });

  it('a face of a pocket of a combine with a clearance: the tool, the combine by its tag and the target', () => {
    expect(pickRows(face('plate', { feature: 'motor', role: 'side', curve: 'c', copy: [{ pattern: 'pocket', index: 1 }] }))).toEqual(['feature:motor', 'feature:pocket', 'feature:plate', 'body:plate']);
  });

  it('a face of an inserted body, two levels down and copied there and here: the insertion and the pattern of this document', () => {
    const name: FaceName = { feature: 'kit/b/ring', role: 'endCap', copy: [{ pattern: 'kit/b/p', index: 1 }, { pattern: 'row', index: 2 }] };
    expect(pickRows(face('kit/b/ring', name))).toEqual(['feature:kit', 'feature:row', 'body:kit/b/ring']);
  });

  it('a face with a thread (D76): the thread feature as well, not for another body or another face', () => {
    const bore: FaceName = { feature: 'taps', role: 'holeBore', point: 'h' };
    const threads = [{ feature: 'm6', face: bore, bodies: ['plate'] }, { feature: 'ins/m8', face: { feature: 'ins/taps', role: 'holeBore', point: 'h' }, bodies: ['ins/plate'] }] as unknown as ThreadResult[];
    expect(pickRows(face('plate', bore), threads)).toEqual(['feature:taps', 'feature:m6', 'feature:plate', 'body:plate']);
    expect(pickRows(face('other', bore), threads)).toEqual(['feature:taps', 'feature:other', 'body:other']);
    expect(pickRows(face('plate', { ...bore, point: 'k' }), threads)).toEqual(['feature:taps', 'feature:plate', 'body:plate']);
    expect(pickRows(face('ins/plate', { feature: 'ins/taps', role: 'holeBore', point: 'h' }), threads)).toEqual(['feature:ins', 'body:ins/plate']);
  });

  it('a face of a mesh: its feature', () => {
    expect(pickRows(face('m', { feature: 'm', role: 'mesh' }))).toEqual(['feature:m', 'body:m']);
  });

  it('an edge: the features of both faces; a plane: a plane feature, a base plane none', () => {
    const edge = { kind: 'edge', body: 'e1', index: 0, name: { a: { feature: 'e1', role: 'endCap' }, b: { feature: 'cut', role: 'side', curve: 'c' } }, edgeKind: 'line' } as const;
    expect(pickRows(edge)).toEqual(['feature:e1', 'feature:cut', 'body:e1']);
    const frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] } as const;
    expect(pickRows({ kind: 'plane', key: 'mid', ref: { kind: 'plane', feature: 'mid' }, frame: { ...frame } as never })).toEqual(['feature:mid']);
    expect(pickRows({ kind: 'plane', key: 'XY', ref: { kind: 'base', plane: 'XY' }, frame: { ...frame } as never })).toEqual([]);
    expect(pickRows(undefined)).toEqual([]);
  });
});

describe('the rows of an entity of a sketch', () => {
  const sketch: SketchFeature = {
    ...emptySketch('s', 'Sketch', { kind: 'base', plane: 'XY' }),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    curves: { l: { type: 'line', a: 'a', b: 'b' } },
    external: { pr: { type: 'sketch', sketch: 'other', entity: 'm', kind: 'line', regions: false } },
  };

  it('an own entity: the rows that name it; an entity of an entry: also the entry; none without a sketch or an entity', () => {
    expect(sketchRows(sketch, 'l')).toEqual(['entity:l']);
    expect(sketchRows(sketch, 'pr')).toEqual(['entity:pr']); // the projected line is the entry
    expect(sketchRows(sketch, 'pr/a')).toEqual(['entity:pr/a', 'entity:pr']); // its end
    expect(sketchRows(undefined, 'l')).toEqual([]);
    expect(sketchRows(sketch, undefined)).toEqual([]);
  });
});
