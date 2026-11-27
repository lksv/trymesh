// Threads (D76, stage 1) without the adapters: the catalog pinned, the profile, the window and the
// flat on the wall, the validator, the base direction of the helix, a record moved, the zone and
// the test of going around, whether two threads agree, the use `tapped` of `hardwareHole`.
import { describe, expect, it } from 'vitest';
import { DATA_CATALOGS } from '../src/data-catalogs';
import { applyCommand, emptyDocument, emptySketch, featureInput, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { THREAD_AROUND, type ThreadZone, goesAround, joinedZones, threadZone, threadsAgree } from '../src/interference';
import { type ThreadRecord, baseZero, defaultDepth, movedThread, threadProfile, turned, wallFlat, wallWindow } from '../src/recompute/thread';
import type { Command, Document, Solid, SolidKernel, ThreadFeature, ThreadResult, Vec3 } from '../src/types';

const ROWS = DATA_CATALOGS.metricThreads.rows;

describe('the catalog metricThreads', () => {
  it('the 55 rows, pinned', () => {
    const line = (key: string) => {
      const r = ROWS[key];
      return `${key} ${r.diameter} ${r.pitch} ${r.pitchDiameter} ${r.minorDiameter} ${r.tapDrill} ${r.series} ${r.choice}`;
    };
    expect(Object.keys(ROWS).map(line)).toEqual([
      'M2 2 0.4 1.74 1.567 1.6 coarse 1',
      'M2.5 2.5 0.45 2.208 2.013 2.05 coarse 1',
      'M3 3 0.5 2.675 2.459 2.5 coarse 1',
      'M3.5 3.5 0.6 3.11 2.85 2.9 coarse 2',
      'M4 4 0.7 3.545 3.242 3.3 coarse 1',
      'M5 5 0.8 4.48 4.134 4.2 coarse 1',
      'M6 6 1 5.35 4.917 5 coarse 1',
      'M7 7 1 6.35 5.917 6 coarse 2',
      'M8 8 1.25 7.188 6.647 6.8 coarse 1',
      'M8x1 8 1 7.35 6.917 7 fine 1',
      'M10 10 1.5 9.026 8.376 8.5 coarse 1',
      'M10x1.25 10 1.25 9.188 8.647 8.8 fine 1',
      'M10x1 10 1 9.35 8.917 9 fine 1',
      'M12 12 1.75 10.863 10.106 10.2 coarse 1',
      'M12x1.5 12 1.5 11.026 10.376 10.5 fine 1',
      'M12x1.25 12 1.25 11.188 10.647 10.8 fine 1',
      'M14 14 2 12.701 11.835 12 coarse 2',
      'M14x1.5 14 1.5 13.026 12.376 12.5 fine 2',
      'M16 16 2 14.701 13.835 14 coarse 1',
      'M16x1.5 16 1.5 15.026 14.376 14.5 fine 1',
      'M18 18 2.5 16.376 15.294 15.5 coarse 2',
      'M18x2 18 2 16.701 15.835 16 fine 2',
      'M18x1.5 18 1.5 17.026 16.376 16.5 fine 2',
      'M20 20 2.5 18.376 17.294 17.5 coarse 1',
      'M20x2 20 2 18.701 17.835 18 fine 1',
      'M20x1.5 20 1.5 19.026 18.376 18.5 fine 1',
      'M22 22 2.5 20.376 19.294 19.5 coarse 2',
      'M22x2 22 2 20.701 19.835 20 fine 2',
      'M22x1.5 22 1.5 21.026 20.376 20.5 fine 2',
      'M24 24 3 22.051 20.752 21 coarse 1',
      'M24x2 24 2 22.701 21.835 22 fine 1',
      'M27 27 3 25.051 23.752 24 coarse 2',
      'M27x2 27 2 25.701 24.835 25 fine 2',
      'M30 30 3.5 27.727 26.211 26.5 coarse 1',
      'M30x2 30 2 28.701 27.835 28 fine 1',
      'M33 33 3.5 30.727 29.211 29.5 coarse 2',
      'M33x2 33 2 31.701 30.835 31 fine 2',
      'M36 36 4 33.402 31.67 32 coarse 1',
      'M36x3 36 3 34.051 32.752 33 fine 1',
      'M39 39 4 36.402 34.67 35 coarse 2',
      'M39x3 39 3 37.051 35.752 36 fine 2',
      'M42 42 4.5 39.077 37.129 37.5 coarse 1',
      'M42x3 42 3 40.051 38.752 39 fine 1',
      'M45 45 4.5 42.077 40.129 40.5 coarse 2',
      'M45x3 45 3 43.051 41.752 42 fine 2',
      'M48 48 5 44.752 42.587 43 coarse 1',
      'M48x3 48 3 46.051 44.752 45 fine 1',
      'M52 52 5 48.752 46.587 47 coarse 2',
      'M52x4 52 4 49.402 47.67 48 fine 2',
      'M56 56 5.5 52.428 50.046 50.5 coarse 1',
      'M56x4 56 4 53.402 51.67 52 fine 1',
      'M60 60 5.5 56.428 54.046 54.5 coarse 2',
      'M60x4 60 4 57.402 55.67 56 fine 2',
      'M64 64 6 60.103 57.505 58 coarse 1',
      'M64x4 64 4 61.402 59.67 60 fine 1',
    ]);
  });

  it('what holds of every row: the formulas of ISO 724 rounded, the tap drill within the window of a bore, the key, one coarse pitch per diameter', () => {
    const rows = Object.entries(ROWS);
    expect(rows).toHaveLength(55);
    const rounded = (value: number): number => Math.round(value * 1000) / 1000;
    for (const [key, row] of rows) {
      const depth = defaultDepth(row.pitch, Math.PI / 3);
      expect(row.minorDiameter, key).toBeCloseTo(rounded(row.diameter - 2 * depth), 9);
      expect(row.pitchDiameter, key).toBeCloseTo(rounded(row.diameter - (3 * Math.sqrt(3) * row.pitch) / 8), 9);
      expect(row.tapDrill, key).toBeGreaterThanOrEqual(row.minorDiameter);
      expect(row.tapDrill, key).toBeLessThanOrEqual(row.diameter - depth);
      expect(key).toBe(row.series === 'coarse' ? `M${row.diameter}` : `M${row.diameter}x${row.pitch}`);
      const coarse = rows.filter(([, other]) => other.diameter === row.diameter && other.series === 'coarse');
      expect(coarse, key).toHaveLength(1);
      if (row.series === 'fine') expect(row.pitch, key).toBeLessThan(coarse[0][1].pitch);
      expect([1, 2]).toContain(row.choice);
    }
  });
});

describe('the profile, the window and the flat', () => {
  it('ISO 68-1 at the defaults: 0.541266 P deep, P/8 and P/4 flats; at 90°: 0.3125 P', () => {
    const iso = threadProfile({ diameter: 8, pitch: 1.25, hand: 'right' });
    if ('detail' in iso) throw new Error(iso.detail);
    expect(iso.depth / 1.25).toBeCloseTo(0.541266, 6);
    expect(iso.crestFlat).toBeCloseTo(1.25 / 8, 12);
    expect(iso.rootFlat).toBeCloseTo(1.25 / 4, 12);
    expect([iso.major, iso.minor, iso.lead, iso.hand]).toEqual([4, 4 - iso.depth, 1.25, 1]);
    const printed = threadProfile({ diameter: 8, pitch: 2, flankAngle: Math.PI / 2, starts: 2, hand: 'left' });
    if ('detail' in printed) throw new Error(printed.detail);
    expect(printed.depth).toBeCloseTo(0.3125 * 2, 12);
    expect([printed.lead, printed.hand]).toEqual([4, -1]);
    expect(printed.crestFlat + printed.rootFlat + 2 * printed.depth).toBeCloseTo(2, 12);
  });

  it('refused: flanks that cross, a depth that leaves no minor diameter', () => {
    expect(threadProfile({ diameter: 8, pitch: 1, depth: 0.9, hand: 'right' })).toMatchObject({ refs: ['depth', 'pitch', 'flankAngle'], detail: expect.stringMatching(/would cross; the largest depth this pitch and angle take is 0\.866/) });
    expect(threadProfile({ diameter: 1, pitch: 2, depth: 0.5, hand: 'right' })).toMatchObject({ refs: ['depth', 'diameter'], detail: 'a profile 0.5 deep leaves no minor diameter of a thread of 1' });
  });

  it('the window: a bore from the minor radius to half of the depth of the shifted thread, a pin the other way', () => {
    const p = threadProfile({ diameter: 6, pitch: 1, hand: 'right' });
    if ('detail' in p) throw new Error(p.detail);
    expect(wallWindow(p, true, 0)).toEqual({ low: p.minor, high: 3 - p.depth / 2 });
    expect(wallWindow(p, true, 0.15)).toEqual({ low: p.minor, high: 3.15 - p.depth / 2 });
    expect(wallWindow(p, false, 0.1)).toEqual({ low: 2.9 - p.depth / 2, high: 3 });
  });

  it('the flat on the wall: a pin at the nominal diameter keeps a crest up to (P/8) / (2 tan 30°) of clearance; a tapped M3 with an allowance of 0.3', () => {
    const p = threadProfile({ diameter: 10, pitch: 1.5, hand: 'right' });
    if ('detail' in p) throw new Error(p.detail);
    const largest = 1.5 / 8 / (2 * Math.tan(Math.PI / 6));
    expect(wallFlat(p, { radius: 5, internal: false }, largest)).toBeCloseTo(0, 12);
    expect(wallFlat(p, { radius: 5, internal: false }, largest + 0.01)).toBeLessThan(0);
    expect(wallFlat(p, { radius: 5 - 0.2, internal: false }, 0.2)).toBeCloseTo(p.crestFlat, 12);
    // M3: the tap drill 2.5 plus 0.3, the clearance half of it; the flat on the wall is the root
    // flat widened by what the bore truncates of the thread
    const m3 = threadProfile({ diameter: 3, pitch: 0.5, hand: 'right' });
    if ('detail' in m3) throw new Error(m3.detail);
    const wall = { radius: 2.8 / 2, internal: true };
    expect(wall.radius).toBeGreaterThanOrEqual(wallWindow(m3, true, 0.15).low);
    expect(wall.radius).toBeLessThanOrEqual(wallWindow(m3, true, 0.15).high);
    expect(wallFlat(m3, wall, 0.15)).toBeCloseTo(m3.rootFlat + 2 * (1.4 - (m3.minor + 0.15)) * Math.tan(Math.PI / 6), 12);
    expect(wallFlat(m3, wall, 0.15)).toBeGreaterThan(0);
  });
});

describe('the validator', () => {
  // a document with the extrusion `b` of the circle `c`, a body to put the thread on
  const base = (): Document =>
    [
      { type: 'addFeature', feature: emptySketch('S1', 'S1', { kind: 'base', plane: 'XY' }) },
      { type: 'addPoint', sketch: 'S1', id: 'o', x: 0, y: 0 },
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'o' }, radius: 3 },
      { type: 'addFeature', feature: { id: 'b', name: 'b', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
    ].reduce((doc, command) => applyCommand(doc, command as Command), emptyDocument());
  const add = (feature: Record<string, unknown>): Command => ({ type: 'addFeature', feature: { id: 't', name: 't', suppressed: false, type: 'thread', body: 'b', faces: [{ feature: 'b', role: 'side', curve: 'c' }], modelled: false, diameter: 6, pitch: 1, hand: 'right', direction: 'backward', ...feature } as never });
  const refused = (feature: Record<string, unknown>) => {
    try {
      applyCommand(base(), add(feature));
    } catch (error) {
      return (error as Error).message;
    }
    return 'accepted';
  };
  it('a thread of every field accepted; the defaults stay absent', () => {
    const doc = applyCommand(base(), add({ copies: true, depth: 0.5, flankAngle: 'deg(90)', clearance: 0.1, starts: 2, offset: 1, length: 4, phase: 'pi / 2', label: 'M6' }));
    const t = doc.features.find((f) => f.id === 't') as ThreadFeature;
    expect(t).toMatchObject({ copies: true, flankAngle: Math.PI / 2, phase: Math.PI / 2, starts: 2 });
    expect(t.expressions).toEqual({ flankAngle: 'deg(90)', phase: 'pi / 2' });
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const plain = applyCommand(base(), add({})).features.find((f) => f.id === 't') as ThreadFeature;
    expect(['depth', 'flankAngle', 'clearance', 'starts', 'offset', 'length', 'phase', 'copies', 'label'].filter((k) => k in plain)).toEqual([]);
    expect(featureInput(t)).toMatchObject({ flankAngle: 'deg(90)' });
  });

  it('the refusals: the faces, the fields out of range, a word misspelt; modelled true is taken (stage 2)', () => {
    expect(refused({ modelled: true })).toBe('accepted');
    expect(refused({ modelled: undefined })).toMatch(/modelled/);
    expect(refused({ modelled: 'yes' })).toMatch(/modelled/);
    expect(refused({ faces: [] })).toMatch(/faces/);
    expect(refused({ faces: [{ feature: 'b', role: 'side', curve: 'c' }, { feature: 'b', role: 'side', curve: 'c' }] })).toMatch(/twice/);
    expect(refused({ diameter: 0 })).toMatch(/diameter/);
    expect(refused({ pitch: -1 })).toMatch(/pitch/);
    expect(refused({ flankAngle: Math.PI })).toMatch(/flankAngle/);
    expect(refused({ clearance: -0.1 })).toMatch(/clearance/);
    expect(refused({ starts: 1.5 })).toMatch(/starts/);
    expect(refused({ starts: 17 })).toMatch(/starts/);
    expect(refused({ offset: -1 })).toMatch(/offset/);
    expect(refused({ length: 0 })).toMatch(/length/);
    expect(refused({ hand: 'Right' })).toMatch(/hand/);
    expect(refused({ direction: 'up' })).toMatch(/direction/);
    expect(refused({ copies: 'yes' })).toMatch(/copies/);
    expect(refused({ label: '' })).toMatch(/label/);
    expect(refused({ pich: 1 })).toMatch(/pich/);
    expect(refused({ body: undefined })).toMatch(/body/);
  });

  it('a document with modelled: true is valid (stage 2); updateFeature switches the mode and removes the optional fields with null', () => {
    const doc = applyCommand(base(), add({ copies: true, clearance: 0.1, label: 'M6' }));
    expect(() => validateDocument(JSON.parse(JSON.stringify({ ...doc, features: doc.features.map((f) => (f.id === 't' ? { ...f, modelled: true } : f)) })))).not.toThrow();
    const patched = applyCommand(doc, { type: 'updateFeature', id: 't', patch: { copies: null, clearance: null, label: null, pitch: '2 * 0.75' } } as never);
    const t = patched.features.find((f) => f.id === 't') as ThreadFeature;
    expect(['copies', 'clearance', 'label'].filter((k) => k in t)).toEqual([]);
    expect([t.pitch, t.expressions]).toEqual([1.5, { pitch: '2 * 0.75' }]);
    expect((applyCommand(doc, { type: 'updateFeature', id: 't', patch: { modelled: true } } as never).features.find((f) => f.id === 't') as ThreadFeature).modelled).toBe(true);
    expect(() => applyCommand(doc, { type: 'updateFeature', id: 't', patch: { diameter: null } } as never)).toThrow();
  });
});

describe('the datum', () => {
  it('the base direction: X made perpendicular, Y when the axis is within about 26° of X', () => {
    expect(baseZero([0, 0, 1])).toEqual([1, 0, 0]);
    expect(baseZero([0, 1, 0])).toEqual([1, 0, 0]);
    expect(baseZero([1, 0, 0])).toEqual([0, 1, 0]);
    expect(baseZero([-1, 0, 0])).toEqual([0, 1, 0]);
    const at = (degrees: number): Vec3 => [Math.cos((degrees * Math.PI) / 180), 0, Math.sin((degrees * Math.PI) / 180)];
    // 25° from X: |x| 0.906 above 0.9, Y; 27°: 0.891, X made perpendicular
    expect(baseZero(at(25))).toEqual([0, 1, 0]);
    const z27 = baseZero(at(27));
    expect(z27[1]).toBe(0);
    expect(z27[0] * at(27)[0] + z27[2] * at(27)[2]).toBeCloseTo(0, 12);
    expect(z27[0]).toBeGreaterThan(0);
    expect(turned([1, 0, 0], [0, 0, 1], Math.PI / 2).map((v) => Number(v.toFixed(12)))).toEqual([0, 1, 0]);
  });

  it('a record moved by a mirror turns its hand; by an insertion it gets the prefix', () => {
    const record: ThreadRecord = { feature: 'm6', face: 3, stated: 'right', internal: true, modelled: false, diameter: 6, pitch: 1, depth: 0.54, flankAngle: Math.PI / 3, clearance: 0, starts: 1, hand: 'right', radius: 2.5, origin: [1, 2, 3], axis: [0, 0, 1], zero: [1, 0, 0], from: 0, to: 8, ends: { start: 'open', end: 'open' }, runOut: { start: 0, end: 0 } };
    const mirror = { matrix: [[1, 0, 0], [0, -1, 0], [0, 0, 1]], translation: [0, 0, 0] } as never;
    const m = movedThread(record, mirror, 7);
    expect([m.face, m.hand, m.stated, m.origin, m.zero, m.feature]).toEqual([7, 'left', 'right', [1, -2, 3], [1, 0, 0], 'm6']);
    expect(movedThread(m, mirror, 9).hand).toBe('right');
    const placed = movedThread(record, { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [100, 0, 0] } as never, 11, 'ins/');
    expect([placed.feature, placed.origin, placed.hand]).toEqual(['ins/m6', [101, 2, 3], 'right']);
  });
});

// A published thread for the tests of zones: M6 on the axis Z from the origin.
function published(more: Partial<ThreadResult> = {}): ThreadResult {
  return { feature: 't', face: { feature: 'h', role: 'holeBore', point: 'p' }, bodies: ['b'], internal: true, modelled: false, diameter: 6, pitch: 1, depth: 0.541, flankAngle: Math.PI / 3, clearance: 0, starts: 1, hand: 'right', radius: 2.5, origin: [0, 0, 0], axis: [0, 0, 1], zero: [1, 0, 0], from: 0, to: 8, ends: { start: 'open', end: 'shoulder' }, runOut: { start: 0.5, end: 0 }, walls: [{ from: 0, to: 8 }], ...more };
}
// A closed piece of a ring about Z from the angle 0 to `span`, radii 2.5 to 3, height 1.
function ringPiece(span: number, n = 64): Solid {
  const positions: number[] = [];
  const triangles: number[] = [];
  const at = (r: number, a: number, z: number) => (positions.push(r * Math.cos(a), r * Math.sin(a), z), positions.length / 3 - 1);
  const k = Math.max(2, Math.ceil((n * span) / (2 * Math.PI)));
  const ring = (r: number, z: number) => Array.from({ length: k + 1 }, (_, i) => at(r, (span * i) / k, z));
  const [ib, it, ob, ot] = [ring(2.5, 0), ring(2.5, 1), ring(3, 0), ring(3, 1)];
  for (let i = 0; i < k; i++) {
    const j = i + 1;
    triangles.push(ob[i], ob[j], ot[j], ob[i], ot[j], ot[i]); // outside
    triangles.push(ib[i], it[j], ib[j], ib[i], it[i], it[j]); // inside
    triangles.push(ob[i], ib[i], ib[j], ob[i], ib[j], ob[j]); // bottom
    triangles.push(ot[i], ot[j], it[j], ot[i], it[j], it[i]); // top
  }
  triangles.push(ib[0], ob[0], ot[0], ib[0], ot[0], it[0], ib[k], it[k], ot[k], ib[k], ot[k], ob[k]); // the two cut ends
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), faceIds: new Uint32Array(triangles.length / 3) };
}

describe('zones and the rule', () => {
  it('the zone: the run-out at an open end the body still has, the span cut where it does not', () => {
    expect(threadZone(published(), 'b', 0.05)).toMatchObject({ low: 2.5, high: 3, from: -0.5, to: 8 });
    expect(threadZone(published(), 'other', 0.05)).toBeUndefined();
    // the body has only the far part of the wall: no run-out at the start
    expect(threadZone(published({ walls: [{ from: 3, to: 8 }] }), 'b', 0.05)).toMatchObject({ from: 3, to: 8 });
    // a pin with a clearance: from the root of the shifted thread to the wall
    expect(threadZone(published({ internal: false, radius: 2.9, clearance: 0.1 }), 'b', 0.05)).toMatchObject({ low: 3 - 0.541 - 0.1, high: 2.9 });
    // two stretches of one wall with the same thread are one zone; another thread on it is not
    const a = threadZone(published({ to: 4, walls: [{ from: 0, to: 4 }], ends: { start: 'open', end: 'inside' } }), 'b', 0.05)!;
    const b = threadZone(published({ from: 4, walls: [{ from: 4, to: 8 }], runOut: { start: 0, end: 0 } }), 'b', 0.05)!;
    expect(joinedZones([a, b], 0.05)).toMatchObject([{ from: -0.5, to: 8 }]);
    const c = threadZone(published({ from: 4, pitch: 1.25, walls: [{ from: 4, to: 8 }], runOut: { start: 0, end: 0 } }), 'b', 0.05)!;
    expect(joinedZones([a, c], 0.05)).toHaveLength(2);
  });

  it('going around: a whole ring and a half do, a third is the bound, a quarter does not', () => {
    const zone = { origin: [0, 0, 0] as Vec3, axis: [0, 0, 1] as Vec3 };
    expect(goesAround(ringPiece(2 * Math.PI - 0.01), zone)).toBe(true);
    expect(goesAround(ringPiece(Math.PI), zone)).toBe(true);
    expect(goesAround(ringPiece((2 * Math.PI) / 3 + 0.1), zone)).toBe(true);
    expect(goesAround(ringPiece((2 * Math.PI) / 3 - 0.1), zone)).toBe(false);
    expect(goesAround(ringPiece(Math.PI / 2), zone)).toBe(false);
    expect(THREAD_AROUND).toBeCloseTo(0.827, 3);
  });

  it('whether two threads agree: apart along the axis or across it, agree, or what differs', () => {
    const zone = (more: Partial<ThreadResult>, body = 'b'): ThreadZone => threadZone(published({ bodies: [body], ...more }), body, 0.05)!;
    const nut = zone({});
    const never = () => {
      throw new Error('on one line no ring is built');
    };
    const pin = (more: Partial<ThreadResult> = {}) => zone({ internal: false, radius: 3, runOut: { start: 0, end: 0 }, ...more });
    expect(threadsAgree(nut, pin(), 0.01, never)).toBe('agree');
    // a bolt from above: the axis the other way, the origin at the top
    expect(threadsAgree(nut, pin({ origin: [0, 0, 8], axis: [0, 0, -1] }), 0.01, never)).toBe('agree');
    expect(threadsAgree(nut, pin({ origin: [0, 0, 20] }), 0.01, never)).toBe('apart');
    // the external M10 of a bushing and the internal M6 of its plate do not overlap across
    expect(threadsAgree(nut, pin({ diameter: 10, radius: 5, depth: 0.812 }), 0.01, never)).toBe('apart');
    expect(threadsAgree(nut, pin({ hand: 'left' }), 0.01, never)).toEqual({ mismatch: 'a left-hand thread in a right-hand one' });
    expect(threadsAgree(nut, zone({}), 0.01, never)).toEqual({ mismatch: 'two internal threads' });
    expect(threadsAgree(nut, pin({ starts: 2 }), 0.01, never)).toEqual({ mismatch: '1 starts against 2' });
    expect(threadsAgree(nut, pin({ depth: 0.6 }), 0.01, never)).toEqual({ mismatch: 'depth 0.541 against 0.6' });
    expect(threadsAgree(nut, pin({ diameter: 6.2 }), 0.01, never)).toEqual({ mismatch: 'diameter 6 against 6.2' });
    // off one line: apart when the rings do not meet, else what is off
    expect(threadsAgree(nut, pin({ origin: [0.3, 0, 0] }), 0.01, () => false)).toBe('apart');
    expect(threadsAgree(nut, pin({ origin: [0.3, 0, 0] }), 0.01, () => true)).toEqual({ mismatch: 'the axes are 0.3 apart' });
    expect(threadsAgree(nut, pin({ axis: [Math.sin(0.01), 0, Math.cos(0.01)] }), 0.01, () => true)).toEqual({ mismatch: 'the axes meet at 0.573°' });
  });
});

describe('the use tapped of hardwareHole', () => {
  const engine = createEngine({ solver: { solve: () => ({ status: 'ok', points: {}, radii: {} }) } as never, kernel: {} as SolidKernel });
  it('a plain hole at the tap drill and the fields of the thread; with an allowance the clearance is half of it', () => {
    const plain = engine.query('hardwareHole', { use: 'tapped', size: 'M6' });
    expect(plain.ok && plain.result).toEqual({ shape: { type: 'plain', diameter: 5 }, thread: { diameter: 6, pitch: 1, label: 'M6' }, from: ['metricThreads'] });
    const fine = engine.query('hardwareHole', { use: 'tapped', size: 'M8x1', allowance: 'print' });
    expect(fine.ok && fine.result).toEqual({ shape: { type: 'plain', diameter: '7 + print' }, thread: { diameter: 8, pitch: 1, clearance: '(print) / 2', label: 'M8x1' }, from: ['metricThreads'] });
    const unknown = engine.query('hardwareHole', { use: 'tapped', size: 'M7x9' });
    expect(unknown.ok).toBe(false);
  });
});
