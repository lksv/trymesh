// Záruka č. 3 portu SolidKernel: stěny nástroje v rovině stěn tělesa (lícování, dosednutí,
// částečný překryv), osově i v obecně natočené poloze. Případy pocházejí ze spiku a z revizí návrhu.
import { describe as suite, expect, it } from 'vitest';
import type { BooleanOp, Solid } from '@trymesh/engine';
import { fitFaces, tolerances } from '../src/geometry';
import { createManifoldKernel } from '../src/index';
import { IDENTITY, type Description, type TestFrame, adjacent, circle, describe, idsOf, inspect, kernel, prism, rect, rotated, sorted } from './testkit';

const BOX = [1, 2, 3, 4, 5, 6];
const ids4 = (base: number) => ({ start: base + 1, end: base + 2, sides: [base + 3, base + 4, base + 5, base + 6] });

for (const [label, f] of [
  ['osově', IDENTITY],
  ['natočeně', rotated()],
] as [string, TestFrame][]) {
  suite(`stěny v jedné rovině, ${label}`, () => {
    const box = prism(f, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
    // Stupňovité těleso: na kvádr se přidá schod (0..20)×(0..30)×(10..20).
    const step = () => kernel.boolean('union', box, prism(f, rect(0, 0, 20, 30), 10, 20, ids4(80)));
    const STEPPED = [...BOX, 82, 83, 84, 85, 86];
    // Nálitek přesahující přes okraj horní stěny: zbytek jeho spodního víka visí ve vzduchu.
    const overhang = () => kernel.boolean('union', box, prism(f, rect(35, 10, 45, 20), 10, 15, ids4(30)));

    // Výsledek musí být uzavřený, nepřeložený, se správným objemem a právě s danými stěnami.
    function check(out: Solid, ids: number[], volume: number): Description {
      const d = describe(out, f);
      expect(idsOf(out)).toEqual(sorted(ids));
      expect(Math.abs(d.volume - volume)).toBeLessThan(0.5);
      expect(d.closed).toBe(true);
      expect(d.sound).toBe(true);
      return d;
    }
    const run = (op: BooleanOp, a: Solid, b: Solid, ids: number[], volume: number) => check(kernel.boolean(op, a, b), ids, volume);
    const level = (d: Description, id: number, w: number, tolerance = 1e-4) => {
      const face = d.faces.get(id)!;
      expect(Math.abs(face.wMin - w)).toBeLessThan(tolerance);
      expect(Math.abs(face.wMax - w)).toBeLessThan(tolerance);
    };

    it('A: nálitek přesně na horní stěně', () => {
      run('union', box, prism(f, rect(10, 10, 20, 20), 10, 15, ids4(30)), [...BOX, 32, 33, 34, 35, 36], 12500);
    });

    it('B: slepá kapsa přesně od horní stěny', () => {
      run('difference', box, prism(f, rect(10, 10, 20, 20), 5, 10, ids4(20)), [...BOX, 21, 23, 24, 25, 26], 11500);
    });

    const cylinderArea = 0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32);
    it('K: slepá válcová díra přesně od horní stěny', () => {
      const tool = prism(f, circle(20, 15, 5), 4, 10, { start: 11, end: 12, sides: Array(32).fill(10) });
      const wall = run('difference', box, tool, [...BOX, 10, 11], 12000 - cylinderArea * 6).faces.get(10)!;
      expect(Math.abs(wall.wMin - 4)).toBeLessThan(1e-4);
      expect(Math.abs(wall.wMax - 10)).toBeLessThan(1e-4);
    });

    it('L: válcový čep přesně na horní stěně', () => {
      const tool = prism(f, circle(20, 15, 5), 10, 16, { start: 11, end: 12, sides: Array(32).fill(10) });
      run('union', box, tool, [...BOX, 10, 12], 12000 + cylinderArea * 6);
    });

    it('C: kapsa s bokem v rovině boku tělesa', () => {
      run('difference', box, prism(f, rect(30, 10, 40, 20), 5, 10, ids4(40)), [...BOX, 41, 43, 45, 46], 11500);
    });

    it('D: výřez přesně na tloušťku', () => {
      run('difference', box, prism(f, rect(10, 10, 20, 20), 0, 10, ids4(50)), [...BOX, 53, 54, 55, 56], 11000);
    });

    it.each([3e-6, -3e-6])('F: bok kapsy mimo rovinu boku o %f (přichycení na float32 bod)', (delta) => {
      run('difference', box, prism(f, rect(30, 10, 40 + delta, 20), 5, 10, ids4(40)), [...BOX, 41, 43, 45, 46], 11500);
    });

    it('G: bok kapsy 0,05 od boku tělesa se posunout nesmí', () => {
      run('difference', box, prism(f, rect(30, 10, 39.95, 20), 5, 10, ids4(40)), [...BOX, 41, 43, 44, 45, 46], 12000 - 9.95 * 10 * 5);
    });

    it('J: nástroj dosedá na těleso zvenku, výřez nemá nic ubrat', () => {
      run('difference', box, prism(f, rect(40, 10, 50, 20), 0, 10, ids4(90)), BOX, 12000);
    });

    it('I: sjednocení lícujících těles (horní stěny v jedné rovině)', () => {
      run('union', box, prism(f, rect(30, 5, 60, 25), 0, 10, ids4(60)), [...BOX, 61, 62, 63, 64, 65], 16000);
    });

    it('S: schod dosedá na horní stěnu', () => {
      check(step(), STEPPED, 18000);
    });

    // Kapsa (10..30)×(10..20)×(5..10). Její koncové víko leží zčásti v rovině horní stěny (x 20..30)
    // a zčásti prochází materiálem schodu (x 10..20). Tam vznikne strop tunelu.
    const tunnel = () => kernel.boolean('difference', step(), prism(f, rect(10, 10, 30, 20), 5, 10, ids4(20)));
    it('E: částečný překryv – strop pod schodem', () => {
      const d = check(tunnel(), [...STEPPED, 21, 22, 23, 24, 25, 26], 17000);
      expect(d.faces.get(22)!.area).toBeCloseTo(100, 0);
      level(d, 22, 10);
    });

    // Další operace na stěně, která je zbytkem posunuté stěny nástroje.
    it('X: nálitek zavěšený na stropě tunelu', () => {
      const out = kernel.boolean('union', tunnel(), prism(f, rect(12, 12, 18, 18), 7, 10, ids4(200)));
      const d = describe(out, f);
      expect(inspect(out).components).toBe(1);
      expect(Math.abs(d.volume - 17108)).toBeLessThan(0.5);
      expect(d.faces.has(202)).toBe(false);
      expect(d.closed && d.sound).toBe(true);
    });

    it('X: kapsa do stropu tunelu', () => {
      const out = kernel.boolean('difference', tunnel(), prism(f, rect(12, 12, 18, 18), 10, 12, ids4(210)));
      const d = describe(out, f);
      expect(Math.abs(d.volume - 16928)).toBeLessThan(0.5);
      expect(d.faces.has(211)).toBe(false);
      expect(d.closed && d.sound).toBe(true);
    });

    it('Y: blok pod převisem nálitku', () => {
      const over = overhang();
      const under = describe(over, f).faces.get(31)!;
      expect(under.area).toBeCloseTo(50, 1);
      const out = kernel.boolean('union', over, prism(f, rect(40, 10, 45, 20), 5, 10, ids4(220)));
      const d = describe(out, f);
      expect(inspect(out).components).toBe(1);
      expect(Math.abs(d.volume - 12750)).toBeLessThan(0.5);
      expect(d.faces.has(31) || d.faces.has(222)).toBe(false);
      expect(d.closed && d.sound).toBe(true);
    });

    // Boky schodu lícují s boky kvádru; po prvním kroku nesmí sahat pod dosedací rovinu, jinak po
    // nich při odříznutí zůstanou proužky.
    it('Q: odříznutí dříve přidaného schodu', () => {
      const stepped = step();
      expect(Math.abs(describe(stepped, f).faces.get(83)!.wMin - 10)).toBeLessThan(1e-4);
      run('difference', stepped, prism(f, rect(0, 0, 20, 30), 10, 20, ids4(300)), [...BOX, 301], 12000);
    });

    // Boky musí sousedit přímo (hrana druhu coplanar), horní stěna musí zůstat rovinná a další
    // operace na ní musí projít.
    it.each([3e-6, -3e-6])('U: lícující nálitek s odchylkou boku %f', (delta) => {
      const boss = kernel.boolean('union', box, prism(f, rect(30, 10, 40 + delta, 20), 10, 15, ids4(30)));
      check(boss, [...BOX, 32, 33, 34, 35, 36], 12500);
      expect(adjacent(boss, 4, 34)).toBe(true);
      expect(adjacent(boss, 2, 34)).toBe(false);
      expect(fitFaces(boss, tolerances(boss).tol).get(2)!.planar).toBe(true);
      const pocket = kernel.boolean('difference', boss, prism(f, rect(5, 5, 15, 15), 5, 10, ids4(40)));
      const d = describe(pocket, f);
      expect(Math.abs(d.volume - 12000)).toBeLessThan(0.5);
      expect(d.faces.has(42)).toBe(false);
      expect(d.closed && d.sound).toBe(true);
    });

    // Dva vrcholy válce leží přesně v rovině boku schodu, takže se v nich stýkají čtyři roviny
    // a booleanem tam vznikají úzké trojúhelníky.
    it('V: válcový výřez pod schodem', () => {
      const n = 16;
      const area = 0.5 * n * 25 * Math.sin((2 * Math.PI) / n);
      const tool = prism(f, circle(20, 15, 5, n), 5, 10, { start: 11, end: 12, sides: Array(n).fill(10) });
      const d = run('difference', step(), tool, [...STEPPED, 10, 11, 12], 18000 - area * 5);
      level(d, 12, 10, 2e-5);
      expect(Math.abs(d.faces.get(12)!.area - area / 2)).toBeLessThan(0.01);
    });

    // Stěna nástroje potká ve své rovině dvě opačně orientované stěny tělesa (horní stěnu kvádru
    // a spodek převisu nálitku).
    it('Z: blok pod převisem lícující s horní stěnou', () => {
      const out = kernel.boolean('union', overhang(), prism(f, rect(35, 5, 45, 25), 5, 10, ids4(220)));
      check(out, [...BOX, 32, 33, 34, 35, 36, 221, 222, 223, 224, 225], 13000);
      expect(inspect(out).components).toBe(1);
    });

    it('W: drážka od spodku převisu, nástroj leží na horní stěně', () => {
      const d = run('difference', overhang(), prism(f, rect(30, 12, 43, 18), 10, 13, ids4(310)), [...BOX, 31, 32, 33, 34, 35, 36, 311, 312, 313, 314, 315], 12356);
      level(d, 311, 10, 2e-5);
    });

    // Dutina zespodu pod schodem (5..15)×(10..20)×(0..10). Koncové víko je v rovině horní stěny,
    // ale ta leží jinde (x > 20).
    it('H: stejná rovina, ale bez překryvu – strop se posunout nesmí', () => {
      const d = run('difference', step(), prism(f, rect(5, 10, 15, 20), 0, 10, ids4(50)), [...STEPPED, 52, 53, 54, 55, 56], 17000);
      level(d, 52, 10);
    });

    // Proč adaptér upravuje vstup: samotné jádro na stejných případech selže.
    it('bez úpravy adaptérem jádro nechá zbytek dosedací stěny nebo díru', () => {
      const boss = prism(f, rect(10, 10, 20, 20), 10, 15, ids4(30));
      const raw = kernel.boolean('union', box, boss, { prepare: false });
      const fixed = kernel.boolean('union', box, boss);
      expect(idsOf(fixed)).not.toContain(31);
      if (f !== IDENTITY) expect(idsOf(raw).includes(31) || !describe(raw, f).closed || Math.abs(describe(raw, f).volume - 12500) > 0.5).toBe(true);
    });
  });
}

suite('port SolidKernel', () => {
  const box = prism(IDENTITY, rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });

  it('triangulate: obrys s dírou, indexy do vrcholů všech smyček za sebou', () => {
    const outer = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10]);
    const hole = Float64Array.from([3, 3, 3, 7, 7, 7, 7, 3]); // díra po směru hodin
    const tris = kernel.triangulate([outer, hole]);
    expect(tris.length % 3).toBe(0);
    const points = [...outer, ...hole];
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [points[2 * i], points[2 * i + 1]]);
      const signed = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      expect(signed).toBeGreaterThan(0); // proti směru hodin
      area += signed;
    }
    expect(area).toBeCloseTo(100 - 16, 9);
    expect(Math.max(...tris)).toBe(7);
  });

  it('průnik', () => {
    const out = kernel.boolean('intersection', box, prism(IDENTITY, rect(30, 20, 60, 50), 5, 20, ids4(10)));
    const d = describe(out, IDENTITY);
    expect(d.volume).toBeCloseTo(10 * 10 * 5, 3);
    expect(d.closed).toBe(true);
  });

  it('rozdíl, který nic nenechá, vrátí prázdné těleso', () => {
    const out = kernel.boolean('difference', box, prism(IDENTITY, rect(-5, -5, 45, 35), -5, 15, ids4(10)));
    expect(out.triangles.length).toBe(0);
  });

  it('vstupy se nemění a stejný vstup dá bitově stejný výstup', () => {
    const tool = prism(rotated(), rect(10, 10, 20, 20), 10, 15, ids4(30));
    const body = prism(rotated(), rect(0, 0, 40, 30), 0, 10, { start: 1, end: 2, sides: [3, 4, 5, 6] });
    const before = [Float32Array.from(body.positions), Float32Array.from(tool.positions)];
    const first = kernel.boolean('union', body, tool);
    const second = kernel.boolean('union', body, tool);
    expect(body.positions).toEqual(before[0]);
    expect(tool.positions).toEqual(before[1]);
    expect(second.positions).toEqual(first.positions);
    expect(second.triangles).toEqual(first.triangles);
    expect(second.faceIds).toEqual(first.faceIds);
  });

  it('vstup, který není uzavřené těleso, vyhodí výjimku', () => {
    const open: Solid = { ...box, triangles: box.triangles.slice(3), faceIds: box.faceIds.slice(1) };
    expect(() => kernel.boolean('union', open, prism(IDENTITY, rect(10, 10, 20, 20), 10, 15, ids4(30)))).toThrow(/the kernel did not accept the input/);
  });

  it('dva kvádry se společnou hranou: výsledek je uzavřená síť, kterou jádro přijme', () => {
    const out = kernel.boolean('union', box, prism(IDENTITY, rect(40, 30, 60, 50), 0, 10, ids4(10)));
    const d = describe(out, IDENTITY);
    expect(d.closed).toBe(true);
    expect(d.volume).toBeCloseTo(12000 + 4000, 2);
    expect(inspect(out)).toMatchObject({ status: 'NoError', components: 2 });
  });

  it('vadné vstupní těleso se odmítne dřív, než se dostane ke knihovně', () => {
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 10, 15, ids4(30));
    const inverted: Solid = { ...box, triangles: Uint32Array.from(box.triangles, (_, i) => box.triangles[i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i]) };
    expect(() => kernel.boolean('union', inverted, tool)).toThrow(/oriented inwards/);
    expect(() => kernel.boolean('union', box, { ...tool, faceIds: new Uint32Array(0) })).toThrow(/tool.*the count of face numbers/);
    expect(() => kernel.boolean('union', box, { ...tool, faceIds: tool.faceIds.map(() => 0x80000000) })).toThrow(/outside the range of the kernel/);
    expect(() => kernel.boolean('union', { ...box, positions: box.positions.map((v, i) => (i === 0 ? Number.NaN : v)) }, tool)).toThrow(/finite numbers/);
    expect(() => kernel.boolean('union', { ...box, triangles: box.triangles.map((v, i) => (i === 0 ? 99 : v)) }, tool)).toThrow(/out of range/);
  });

  it('triangulate: vadný vstup je chyba, prázdný seznam prázdný výsledek', () => {
    expect(kernel.triangulate([])).toEqual(new Uint32Array(0));
    expect(() => kernel.triangulate([Float64Array.from([0, 0, 1, 0])])).toThrow(/at least three points/);
    expect(() => kernel.triangulate([Float64Array.from([0, 0, 1, 0, 1, 1, 0])])).toThrow(/at least three points/);
    expect(() => kernel.triangulate([Float64Array.from([0, 0, 1, 0, Number.NaN, 1])])).toThrow(/finite numbers/);
  });

  it('triangulate a boolean nenechávají paměť WASM růst', async () => {
    // paměť modulu se zachytí při vytvoření nové instance jádra
    const memories: WebAssembly.Memory[] = [];
    const original = WebAssembly.instantiate;
    WebAssembly.instantiate = (async (...args: Parameters<typeof original>) => {
      const result = (await original(...args)) as unknown as WebAssembly.Instance | { instance: WebAssembly.Instance };
      const instance = 'instance' in result ? result.instance : result;
      for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) memories.push(value);
      return result;
    }) as typeof original;
    const fresh = await createManifoldKernel().finally(() => (WebAssembly.instantiate = original));
    expect(memories).toHaveLength(1);
    const heap = () => memories[0].buffer.byteLength;
    const big = Float64Array.from(circle(0, 0, 10, 256).flat());
    const tool = prism(IDENTITY, rect(10, 10, 20, 20), 10, 15, ids4(30));
    for (let i = 0; i < 300; i++) fresh.triangulate([big]);
    const before = heap();
    for (let i = 0; i < 6000; i++) fresh.triangulate([big]);
    for (let i = 0; i < 300; i++) fresh.boolean('union', box, tool);
    expect(heap() - before).toBeLessThan(4 * 1024 * 1024); // obalová funkce knihovny by tu přidala přes 40 MB
  });
});
