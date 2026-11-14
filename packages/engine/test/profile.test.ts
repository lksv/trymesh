// Detekce profilů a oblastí, referenční kóty, vstup solveru.
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Curve, Document, SketchFeature } from '../src/types';
import { applyCommand, emptyDocument, emptySketch } from '../src/document';
import { type Loop, type SketchGeometry, detectProfile, measure, solverSetup } from '../src/sketch';

type Entry = [id: string, curve: Curve, radius?: number];

function sketch(points: Record<string, [number, number]>, curves: Entry[], constraints: Record<string, Constraint> = {}): SketchFeature {
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: 'S', id, x, y })),
    ...curves.map(([id, curve, radius]): Command => ({ type: 'addCurve', sketch: 'S', id, curve, ...(radius === undefined ? {} : { radius }) })),
    ...Object.entries(constraints).map(([id, constraint]): Command => ({ type: 'addConstraint', sketch: 'S', id, constraint })),
  ];
  return commands.reduce<Document>(applyCommand, emptyDocument()).features[0] as SketchFeature;
}
const geometry = (s: SketchFeature): SketchGeometry => ({ points: { origin: { x: 0, y: 0 }, ...s.points }, radii: { ...s.radii } });
const profile = (s: SketchFeature, tolerance = 0.01) => detectProfile(s, geometry(s), tolerance);
const line = (a: string, b: string): Curve => ({ type: 'line', a, b });

function area(loop: Loop): number {
  let sum = 0;
  for (let i = 0; i < loop.xy.length / 2; i++) {
    const j = (i + 1) % (loop.xy.length / 2);
    sum += loop.xy[2 * i] * loop.xy[2 * j + 1] - loop.xy[2 * j] * loop.xy[2 * i + 1];
  }
  return sum / 2;
}
const outer = (s: SketchFeature) => profile(s).regions.map((r) => r.ref.outerLoop.join(','));

const RECT: Record<string, [number, number]> = { p1: [0, 0], p2: [40, 0], p3: [40, 30], p4: [0, 30] };
const RECT_LINES: Entry[] = [
  ['l1', line('p1', 'p2')],
  ['l2', line('p2', 'p3')],
  ['l3', line('p3', 'p4')],
  ['l4', line('p4', 'p1')],
];

describe('oblasti', () => {
  it('obdélník: jedna oblast, vnější smyčka proti směru hodin', () => {
    const result = profile(sketch(RECT, RECT_LINES));
    expect(result.valid).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].ref.outerLoop).toEqual(['l1', 'l2', 'l3', 'l4']);
    expect(area(result.regions[0].outer)).toBeCloseTo(1200, 9);
    expect(result.regions[0].holes).toEqual([]);
    expect(result.regions[0].outer.curves).toHaveLength(4);
  });

  it('směr kreslení úseček výsledek nemění', () => {
    const reversed: Entry[] = [
      ['l1', line('p2', 'p1')],
      ['l2', line('p2', 'p3')],
      ['l3', line('p4', 'p3')],
      ['l4', line('p4', 'p1')],
    ];
    const result = profile(sketch(RECT, reversed));
    expect(result.regions).toHaveLength(1);
    expect(area(result.regions[0].outer)).toBeCloseTo(1200, 9);
  });

  it('obdélník rozdělený příčkou má dvě oblasti, ne tři', () => {
    const s = sketch({ ...RECT, m1: [20, 0], m2: [20, 30] }, [
      ['a1', line('p1', 'm1')],
      ['a2', line('m1', 'p2')],
      ['l2', line('p2', 'p3')],
      ['b1', line('p3', 'm2')],
      ['b2', line('m2', 'p4')],
      ['l4', line('p4', 'p1')],
      ['mid', line('m1', 'm2')],
    ]);
    expect(outer(s)).toEqual(['a1,b2,l4,mid', 'a2,b1,l2,mid']);
    expect(profile(s).regions.map((r) => area(r.outer))).toEqual([expect.closeTo(600, 9), expect.closeTo(600, 9)]);
  });

  it('kružnice v obdélníku je díra obdélníku a zároveň vlastní oblast', () => {
    const s = sketch({ ...RECT, c: [10, 10] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]]);
    const result = profile(s, 0.001);
    expect(result.regions.map((r) => r.ref.outerLoop.join(','))).toEqual(['k', 'l1,l2,l3,l4']);
    const [disk, rect] = result.regions;
    expect(area(disk.outer)).toBeCloseTo(Math.PI * 16, 1);
    expect(rect.holes).toHaveLength(1);
    expect(area(rect.holes[0])).toBeCloseTo(-Math.PI * 16, 1); // díra jde po směru hodin
    expect(new Set(rect.holes[0].keys)).toEqual(new Set(disk.outer.keys)); // stejné vrcholy
    expect(disk.holes).toEqual([]);
  });

  it('vnořené díry patří nejmenší oblasti, která je obsahuje', () => {
    const s = sketch({ ...RECT, c: [20, 15] }, [...RECT_LINES, ['big', { type: 'circle', center: 'c' }, 10], ['small', { type: 'circle', center: 'c' }, 3]]);
    const byLoop = Object.fromEntries(profile(s).regions.map((r) => [r.ref.outerLoop.join(','), r]));
    expect(byLoop['l1,l2,l3,l4'].holes).toHaveLength(1);
    expect(byLoop.big.holes).toHaveLength(1);
    expect(byLoop.small.holes).toHaveLength(0);
    expect(Math.abs(area(byLoop.big.holes[0]))).toBeLessThan(Math.PI * 9 + 0.1);
  });

  it('konstrukční křivky a křivky, které nic neuzavírají, se ignorují', () => {
    const s = sketch({ ...RECT, q: [60, 40], r: [10, 5], t: [30, 25] }, [
      ...RECT_LINES,
      ['tail', line('p3', 'q')], // visí ven z rohu
      ['axis', { ...line('r', 't'), construction: true }], // kříží se s ničím, je konstrukční
      ['diag', { ...line('p1', 'p3'), construction: true }],
    ]);
    expect(profile(s).valid).toBe(true);
    expect(outer(s)).toEqual(['l1,l2,l3,l4']);
  });

  it('dva čtverce spojené úsečkou: spojka není hranicí žádné oblasti', () => {
    const s = sketch({ a1: [0, 0], a2: [10, 0], a3: [10, 10], a4: [0, 10], b1: [20, 0], b2: [30, 0], b3: [30, 10], b4: [20, 10] }, [
      ['a12', line('a1', 'a2')],
      ['a23', line('a2', 'a3')],
      ['a34', line('a3', 'a4')],
      ['a41', line('a4', 'a1')],
      ['b12', line('b1', 'b2')],
      ['b23', line('b2', 'b3')],
      ['b34', line('b3', 'b4')],
      ['b41', line('b4', 'b1')],
      ['bridge', line('a2', 'b1')],
    ]);
    expect(outer(s)).toEqual(['a12,a23,a34,a41', 'b12,b23,b34,b41']);
  });

  it('zaoblený roh: úsečky tečně napojené na oblouk', () => {
    // čtverec 20×20 s rohem (20,20) zaobleným poloměrem 5
    const s = sketch({ p1: [0, 0], p2: [20, 0], p3: [20, 15], p4: [15, 20], p5: [0, 20], c: [15, 15] }, [
      ['l1', line('p1', 'p2')],
      ['l2', line('p2', 'p3')],
      ['arc', { type: 'arc', center: 'c', start: 'p3', end: 'p4' }],
      ['l3', line('p4', 'p5')],
      ['l4', line('p5', 'p1')],
    ]);
    const result = profile(s, 0.001);
    expect(result.valid).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(area(result.regions[0].outer)).toBeCloseTo(400 - (25 - (Math.PI * 25) / 4), 1);
    expect(result.regions[0].outer.curves.filter((id) => id === 'arc').length).toBeGreaterThan(4);
  });

  it('oblouk a tětiva: dělení oblouku nezávisí na směru průchodu', () => {
    const s = sketch({ a: [-10, 0], b: [10, 0], c: [0, 0] }, [
      ['top', { type: 'arc', center: 'c', start: 'b', end: 'a' }], // horní půlkruh
      ['bottom', { type: 'arc', center: 'c', start: 'a', end: 'b' }], // dolní půlkruh
      ['chord', line('a', 'b')],
    ]);
    const result = profile(s, 0.001);
    expect(result.regions.map((r) => r.ref.outerLoop.join(','))).toEqual(['bottom,chord', 'chord,top']);
    for (const region of result.regions) expect(area(region.outer)).toBeCloseTo((Math.PI * 100) / 2, 0);
    // spojené body: konce tětivy a oblouků mají stejné klíče
    expect(result.regions[0].outer.keys.filter((k) => k.startsWith('v:')).sort()).toEqual(['v:a', 'v:b']);
  });

  it('body spojené splněnou vazbou coincident tvoří jeden vrchol; nesplněná vazba nespojuje', () => {
    const points: Record<string, [number, number]> = { a1: [0, 0], a2: [40, 0], b1: [40, 0], b2: [40, 30], c1: [40, 30], c2: [0, 30], d1: [0, 30], d2: [0, 0] };
    const lines: Entry[] = [
      ['l1', line('a1', 'a2')],
      ['l2', line('b1', 'b2')],
      ['l3', line('c1', 'c2')],
      ['l4', line('d1', 'd2')],
    ];
    const joined = { k1: { type: 'coincident', a: 'a2', b: 'b1' }, k2: { type: 'coincident', a: 'b2', b: 'c1' }, k3: { type: 'coincident', a: 'c2', b: 'd1' }, k4: { type: 'coincident', a: 'd2', b: 'a1' } } as const;
    expect(outer(sketch(points, lines, joined))).toEqual(['l1,l2,l3,l4']);
    // bez vazeb se konce jen dotýkají: profil je neplatný
    expect(profile(sketch(points, lines)).valid).toBe(false);
    // vazba, která není splněná (konfliktní), profil nezmění
    const extra = { ...joined, bad: { type: 'coincident', a: 'a1', b: 'b2' } } as const;
    expect(outer(sketch(points, lines, extra))).toEqual(['l1,l2,l3,l4']);
  });
});

describe('neplatný profil', () => {
  const invalid = (points: Record<string, [number, number]>, curves: Entry[]) => expect(profile(sketch(points, curves))).toEqual({ valid: false, regions: [] });

  it('křížící se úsečky', () => invalid({ a: [0, 0], b: [10, 10], c: [0, 10], d: [10, 0] }, [['x', line('a', 'b')], ['y', line('c', 'd')]]));
  it('konec úsečky leží na jiné úsečce (T-spoj bez společného bodu)', () => invalid({ ...RECT, t: [20, 0], u: [20, 10] }, [...RECT_LINES, ['stem', line('t', 'u')]]));
  it('dvě úsečky mezi stejnými body', () => invalid(RECT, [...RECT_LINES, ['dup', line('p1', 'p2')]]));
  it('kolineární úsečky, které se překrývají', () => invalid({ a: [0, 0], b: [10, 0], c: [5, 0], d: [20, 0] }, [['x', line('a', 'b')], ['y', line('c', 'd')]]));
  it('kružnice tečná k hraně obdélníku', () => invalid({ ...RECT, c: [10, 4] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]]));
  it('kružnice protínající obdélník', () => invalid({ ...RECT, c: [0, 15] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 5]]));
  it('dvě protínající se kružnice', () => invalid({ a: [0, 0], b: [6, 0] }, [['k1', { type: 'circle', center: 'a' }, 5], ['k2', { type: 'circle', center: 'b' }, 5]]));
  it('dvě stejné kružnice', () => invalid({ a: [0, 0] }, [['k1', { type: 'circle', center: 'a' }, 5], ['k2', { type: 'circle', center: 'a' }, 5]]));
  it('kružnice vnitřně tečná k jiné', () => invalid({ a: [0, 0], b: [2, 0] }, [['k1', { type: 'circle', center: 'a' }, 5], ['k2', { type: 'circle', center: 'b' }, 3]]));
  it('oblouk protínající úsečku', () => invalid({ c: [0, 0], s: [5, 0], e: [-5, 0], a: [0, 0], b: [0, 10] }, [['arc', { type: 'arc', center: 'c', start: 's', end: 'e' }], ['x', line('a', 'b')]]));
  it('úsečka nulové délky', () => invalid({ a: [1, 1], b: [1, 1] }, [['x', line('a', 'b')]]));

  it('soustředné kružnice a oddělené tvary platné jsou', () => {
    const s = sketch({ a: [0, 0], b: [20, 0] }, [['k1', { type: 'circle', center: 'a' }, 5], ['k2', { type: 'circle', center: 'a' }, 3], ['k3', { type: 'circle', center: 'b' }, 5]]);
    expect(profile(s).valid).toBe(true);
    expect(outer(s)).toEqual(['k1', 'k2', 'k3']);
  });
});

describe('referenční kóty a vstup solveru', () => {
  const dims = {
    width: { type: 'distance', a: 'p1', b: 'p2', value: 1, driving: false },
    dx: { type: 'horizontalDistance', a: 'p3', b: 'p1', value: 1, driving: false },
    dy: { type: 'verticalDistance', a: 'p1', b: 'p3', value: 1, driving: false },
    far: { type: 'distancePointLine', point: 'p3', line: 'l1', value: 1, driving: false },
    turn: { type: 'angle', a: 'l1', b: 'l2', value: 1, driving: false },
    back: { type: 'angle', a: 'l2', b: 'l1', value: 1, driving: false },
    r: { type: 'radius', curve: 'k', value: 1, driving: false },
    d: { type: 'diameter', curve: 'k', value: 1, driving: false },
    drive: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true },
    h: { type: 'horizontal', line: 'l1' },
  } as const;
  const s = sketch({ ...RECT, c: [10, 10] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]], dims);

  it('měří z použitých poloh, řídicí kóty neměří', () => {
    const values = measure(s, s.curves, geometry(s));
    expect(values).toEqual({ width: 40, dx: -40, dy: 30, far: 30, turn: expect.closeTo(Math.PI / 2, 12), back: expect.closeTo(-Math.PI / 2, 12), r: 4, d: 8 });
  });

  it('referenční kóty se solveru neposílají a razítko se s nimi nemění', () => {
    const setup = solverSetup(s, {});
    expect(Object.keys(setup.input.constraints).sort()).toEqual(['drive', 'h']);
    expect(setup.input.fixed).toEqual(['origin']);
    expect(setup.input.points.origin).toEqual({ x: 0, y: 0 });
    const plain = sketch({ ...RECT, c: [10, 10] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]], { drive: dims.drive, h: dims.h });
    expect(solverSetup(plain, {}).stamp).toBe(setup.stamp);
    const changed = sketch({ ...RECT, c: [10, 10] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]], { drive: { ...dims.drive, value: 50 }, h: dims.h });
    expect(solverSetup(changed, {}).stamp).not.toBe(setup.stamp);
    // polohy bodů do razítka nepatří
    const moved = sketch({ ...RECT, p3: [41, 31], c: [10, 10] }, [...RECT_LINES, ['k', { type: 'circle', center: 'c' }, 4]], dims);
    expect(solverSetup(moved, {}).stamp).toBe(setup.stamp);
  });
});
