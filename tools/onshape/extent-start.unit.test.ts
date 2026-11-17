// The converter's part of D66 without Onshape data: which trymesh face an Onshape face is, and the
// extent written for each kind of end and start.
import { describe, expect, it } from 'vitest';
import type { PlaneRef } from '../../packages/engine/src/index';
import { type ExtentInput, type FaceCandidate, extentFor, faceOf } from './extent-start';

const cap = (feature: string, role: 'startCap' | 'endCap', z: number, out: 1 | -1, body = 'plate'): FaceCandidate => ({ body, name: { feature, role }, origin: [0, 0, z], normal: [0, 0, 1], meshNormal: [0, 0, out] });
const TOP = { origin: [5, 5, 0.0005] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };

describe('the trymesh face of an Onshape face', () => {
  it('the two caps of an extrusion 0.0005 mm long lie in one plane within 1e-3 mm: the normal out of the body tells them apart', () => {
    const caps = [cap('shim', 'startCap', 0, -1), cap('shim', 'endCap', 0.0005, 1)];
    expect(faceOf(caps, TOP, ['shim'])).toEqual({ ref: { kind: 'face', body: 'plate', face: { feature: 'shim', role: 'endCap' } } });
    expect(faceOf(caps, { ...TOP, normal: [0, 0, -1] }, ['shim'])).toEqual({ ref: { kind: 'face', body: 'plate', face: { feature: 'shim', role: 'startCap' } } });
  });

  it('only caps of the features made for the Onshape feature that created the face, in its plane', () => {
    const others = [cap('other', 'endCap', 0.0005, 1), { ...cap('shim', 'endCap', 0.0005, 1), name: { feature: 'shim', role: 'side', curve: 'c' } } as FaceCandidate, cap('shim', 'endCap', 0.01, 1), { ...cap('shim', 'endCap', 0.0005, 1), normal: [0, 0.01 / Math.hypot(0.01, 1), 1 / Math.hypot(0.01, 1)] } as FaceCandidate];
    expect(faceOf(others, TOP, ['shim'])).toEqual({ reason: expect.stringMatching(/no cap/) });
  });

  it('several caps of the extrusions made for one Onshape extrusion: the first by ID, with a note', () => {
    const found = faceOf([cap('boss_2', 'endCap', 0.0005, 1, 'b2'), cap('boss_1', 'endCap', 0.0005, 1, 'b1')], TOP, ['boss_1', 'boss_2']);
    expect(found).toEqual({ ref: { kind: 'face', body: 'b1', face: { feature: 'boss_1', role: 'endCap' } }, note: expect.stringMatching(/2 faces in its plane \(boss_1\/endCap, boss_2\/endCap\), the first taken/) });
  });
});

describe('the extent of a converted extrusion', () => {
  const FACE: PlaneRef = { kind: 'face', body: 'plate', face: { feature: 'plate', role: 'endCap' } };
  const DECK: PlaneRef = { kind: 'plane', feature: 'plane_XY_4' };
  const base: ExtentInput = { endBound: 'BLIND', symmetric: false, dir: 1, s: 1, start: 4, depth: 12, startPlane: () => DECK };

  it('blind from a face: start 0; symmetric: half of the depth back, with the expression of the depth', () => {
    expect(extentFor({ ...base, from: FACE })).toEqual({ type: 'distance', from: FACE, start: 0, distance: 12 });
    expect(extentFor({ ...base, from: FACE, symmetric: true })).toEqual({ type: 'distance', from: FACE, start: -6, distance: 12 });
    expect(extentFor({ ...base, from: FACE, symmetric: true, depth: 'h', s: -1 })).toEqual({ type: 'distance', from: FACE, start: '(h) / 2', distance: '-(h)' });
    // the face not found: the number as before
    expect(extentFor({ ...base, symmetric: true })).toEqual({ type: 'distance', start: -2, distance: 12 });
  });

  it('a symmetric "through all" becomes both sides without a start, from an entity or a numeric offset alike', () => {
    expect(extentFor({ ...base, endBound: 'THROUGH_ALL', symmetric: true, from: FACE })).toEqual({ type: 'throughAll', side: 'both' });
    expect(extentFor({ ...base, endBound: 'THROUGH_ALL', symmetric: true })).toEqual({ type: 'throughAll', side: 'both' });
  });

  it('one-sided "through all" from a face, or from a plane feature at a numeric offset', () => {
    expect(extentFor({ ...base, endBound: 'THROUGH_ALL', dir: -1, from: FACE })).toEqual({ type: 'throughAll', side: 'backward', from: FACE });
    expect(extentFor({ ...base, endBound: 'THROUGH_ALL' })).toEqual({ type: 'throughAll', side: 'forward', from: DECK });
    expect(extentFor({ ...base, endBound: 'THROUGH_ALL', start: 0 })).toEqual({ type: 'throughAll', side: 'forward' });
  });

  it('up to a face: upTo when its face was found, the length otherwise; from a face, both', () => {
    expect(extentFor({ ...base, endBound: 'UP_TO', end: { plane: DECK, level: 30 } })).toEqual({ type: 'upTo', start: 4, plane: DECK });
    expect(extentFor({ ...base, endBound: 'UP_TO', from: FACE, end: { plane: DECK, level: 30 } })).toEqual({ type: 'upTo', from: FACE, start: 0, plane: DECK });
    expect(extentFor({ ...base, endBound: 'UP_TO', end: { level: 30 } })).toEqual({ type: 'distance', start: 4, distance: 26 });
    expect(extentFor({ ...base, endBound: 'UP_TO', from: FACE, end: { level: 30 } })).toEqual({ type: 'distance', from: FACE, start: 0, distance: 26 });
  });
});
