// Podání diagnostiky skici pro panel a pohled, proti skutečnému enginu.
import { type Command, type Constraint, type Engine, type Id, type SketchFeature, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { anchorPoints, duplicateTwins, explanationText, freeEntities, markOf } from '../src/sketch-diagnosis';
import { sketchView } from '../src/sketch-view';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

// Obdélník a..d od ruky se směry stran; další vazby přidává test.
function rectangle(): Engine {
  const engine = createEngine(deps);
  const points: [Id, number, number][] = [
    ['a', 0.3, -0.2],
    ['b', 39.5, 0.4],
    ['c', 40.6, 29.7],
    ['d', -0.4, 30.5],
  ];
  const commands: Command[] = [
    { type: 'addFeature', feature: emptySketch('s', 'Skica', { kind: 'base', plane: 'XY' }) },
    ...points.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 's', id, x, y })),
    ...points.map(([id], i): Command => ({ type: 'addCurve', sketch: 's', id: `${id}${points[(i + 1) % 4][0]}`, curve: { type: 'line', a: id, b: points[(i + 1) % 4][0] } })),
  ];
  for (const command of commands) expect(engine.execute(command).ok).toBe(true);
  add(engine, 'h1', { type: 'horizontal', line: 'ab' });
  add(engine, 'v1', { type: 'vertical', line: 'bc' });
  add(engine, 'h2', { type: 'horizontal', line: 'cd' });
  add(engine, 'v2', { type: 'vertical', line: 'da' });
  return engine;
}
function add(engine: Engine, id: Id, constraint: Constraint): void {
  const result = engine.execute({ type: 'addConstraint', sketch: 's', id, constraint });
  if (!result.ok) throw new Error(result.error.message);
}
const featureOf = (engine: Engine) => engine.getState().document.features[0] as SketchFeature;
const viewOf = (engine: Engine) => sketchView(featureOf(engine), engine.getState().evaluation.features.s.sketch!);
const label = (id: Id) => `<${id}>`;
const explainText = (engine: Engine, id: Id) => explanationText(featureOf(engine).constraints[id], id, engine.explainConstraint('s', id), engine.diagnoseSketch('s'), label);

describe('volné a určené entity', () => {
  it('obdélník bez rozměrů: všechno volné, žádný bod skicu sám neurčí', () => {
    const engine = rectangle();
    const d = engine.diagnoseSketch('s');
    expect(d.degreesOfFreedom).toBe(4);
    const free = freeEntities(d, viewOf(engine))!;
    expect([...free.points].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...free.curves].sort()).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(anchorPoints(d)).toEqual([]);
  });

  it('obdélník s rozměry bez ukotvení: skicu určí kterýkoli bod; po ukotvení není volné nic', () => {
    const engine = rectangle();
    add(engine, 'w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    add(engine, 'hgt', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true });
    expect(anchorPoints(engine.diagnoseSketch('s'))).toEqual(['a', 'b', 'c', 'd']);
    add(engine, 'fix', { type: 'coincident', a: 'a', b: 'origin' });
    const d = engine.diagnoseSketch('s');
    expect(freeEntities(d, viewOf(engine))).toEqual({ points: new Set(), curves: new Set() });
    expect(anchorPoints(d)).toEqual([]);
  });

  it('ukotvený obdélník bez šířky: volná je pravá strana a úsečky, které se jí dotýkají; kružnice s volným poloměrem', () => {
    const engine = rectangle();
    add(engine, 'hgt', { type: 'verticalDistance', a: 'b', b: 'c', value: 30, driving: true });
    add(engine, 'fix', { type: 'coincident', a: 'a', b: 'origin' });
    expect(engine.execute({ type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 }).ok).toBe(true);
    const d = engine.diagnoseSketch('s');
    const free = freeEntities(d, viewOf(engine))!;
    expect([...free.points].sort()).toEqual(['b', 'c']);
    expect([...free.curves].sort()).toEqual(['ab', 'bc', 'cd', 'k']); // levá strana je určená
    expect(anchorPoints(d)).toEqual([]); // šířka a poloměr jsou dvě nezávislé volnosti
  });

  it('skica v konfliktu: o volnosti se nedá nic říct', () => {
    const engine = rectangle();
    add(engine, 'w', { type: 'horizontalDistance', a: 'a', b: 'b', value: 40, driving: true });
    add(engine, 'w2', { type: 'horizontalDistance', a: 'd', b: 'c', value: 50, driving: true });
    const d = engine.diagnoseSketch('s');
    expect(d.status).not.toBe('solved');
    expect(freeEntities(d, viewOf(engine))).toBeUndefined();
    expect(anchorPoints(d)).toEqual([]);
    expect(explainText(engine, 'w2')).toMatch(/není vyřešená/);
  });
});

describe('označení a vysvětlení vazeb', () => {
  it('odvozená vazba je navíc a vysvětlení jmenuje vazby, ze kterých plyne', () => {
    const engine = rectangle();
    add(engine, 'par', { type: 'parallel', a: 'ab', b: 'cd' });
    const d = engine.diagnoseSketch('s');
    expect(markOf(d, 'par')).toBe('surplus');
    expect(markOf(d, 'h1')).toBeUndefined(); // starší vazby zůstávají neoznačené
    expect(duplicateTwins(d)).toEqual([]);
    expect(explainText(engine, 'par')).toBe('Vazba plyne z vazeb: <h1>; <h2>. Odebrat jde ona nebo kterákoli z nich, geometrie se tím nezmění.');
    expect(explainText(engine, 'h1')).toMatch(/^Vazba plyne z vazeb: <h2>; <par>\./);
    expect(explainText(engine, 'v1')).toBe('Vazba je potřebná: z ostatních neplyne.');
  });

  it('duplicita z dokumentu starší verze: označí se novější dvojče a vysvětlení ji pojmenuje', () => {
    const engine = rectangle();
    const document = JSON.parse(engine.save());
    document.features[0].constraints.h1again = { type: 'horizontal', line: 'ab' };
    expect(engine.load(JSON.stringify(document)).ok).toBe(true);
    const d = engine.diagnoseSketch('s');
    expect(duplicateTwins(d)).toEqual(['h1again']);
    expect(markOf(d, 'h1again')).toBe('duplicate');
    expect(markOf(d, 'h1')).toBeUndefined();
    expect(explainText(engine, 'h1again')).toBe('Vazba je duplicita vazby <h1>.');
    expect(explainText(engine, 'h1')).toBe('Vazba je duplicita vazby <h1again>.');
  });

  it('referenční kóta a vazba plynoucí z definice oblouku', () => {
    const engine = rectangle();
    add(engine, 'ref', { type: 'distance', a: 'a', b: 'c', value: 50, driving: false });
    expect(explainText(engine, 'ref')).toBe('Referenční kóta jen měří, geometrii neurčuje.');
    for (const command of [
      { type: 'addPoint', sketch: 's', id: 'm', x: 60, y: 0 },
      { type: 'addPoint', sketch: 's', id: 's1', x: 70, y: 0 },
      { type: 'addPoint', sketch: 's', id: 'e1', x: 50, y: 0.5 },
      { type: 'addCurve', sketch: 's', id: 'arc', curve: { type: 'arc', center: 'm', start: 's1', end: 'e1' } },
    ] as Command[]) expect(engine.execute(command).ok).toBe(true);
    add(engine, 'onArc', { type: 'pointOnCurve', point: 'e1', curve: 'arc' });
    expect(markOf(engine.diagnoseSketch('s'), 'onArc')).toBe('surplus');
    expect(explainText(engine, 'onArc')).toBe('Vazba je navíc: plyne už z definice křivky.');
  });
});
