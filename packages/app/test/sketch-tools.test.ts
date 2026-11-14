// Kreslicí nástroje a vazby z výběru proti skutečnému enginu: příkazy, které UI sestaví, musí
// engine přijmout a výsledek musí odpovídat tomu, co uživatel nakreslil.
import { CONSTRAINTS, type Command, type Constraint, type DimensionShape, type Engine, type ExtrudeFeature, type Id, type SketchFeature, type SketchResult, createEngine, emptySketch } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { describe, expect, it } from 'vitest';
import { type Anchor, GEOMETRIC_KINDS, arcCommands, asConstruction, changeExtrude, circleCommands, deleteCommands, dimensionFor, draftCommand, geometricFor, lineCommands, normalizeAngle, pointCommands, rectangleCommands } from '../src/sketch-commands';
import { type SketchView, anchorOf, closestOn, hitCurve, hitPoint, insideLoop, kindOf, measure, operandsOf, polyline, sketchView } from '../src/sketch-view';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };

// Engine se skicou `s` na rovině XY a čítačem ID jako v aplikaci.
function setup(): { engine: Engine; newId: (prefix: string) => Id; run: (commands: Command[] | undefined) => void; view: () => SketchView; sketch: () => SketchFeature; result: () => SketchResult } {
  const engine = createEngine(deps);
  let counter = 0;
  const newId = (prefix: string) => `${prefix}${++counter}`;
  const execute = (command: Command) => {
    const outcome = engine.execute(command);
    if (!outcome.ok) throw new Error(outcome.error.message);
  };
  execute({ type: 'addFeature', feature: emptySketch('s', 'Skica', { kind: 'base', plane: 'XY' }) });
  const sketch = () => engine.getState().document.features.find((f) => f.id === 's') as SketchFeature;
  const result = () => engine.getState().evaluation.features.s.sketch as SketchResult;
  return {
    engine,
    newId,
    run: (commands) => {
      expect(commands).toBeDefined();
      execute({ type: 'batch', commands: commands as Command[] });
    },
    view: () => sketchView(sketch(), result()),
    sketch,
    result,
  };
}
const free = (x: number, y: number): Anchor => ({ at: [x, y] });
const onPoint = (view: SketchView, id: Id): Anchor => ({ at: view.points.get(id)!.at, snap: { kind: 'point', id } });
const types = (sketch: SketchFeature): string[] => Object.values(sketch.constraints).map((c) => c.type).sort();

describe('kreslicí nástroje', () => {
  it('obdélník od počátku: čtyři úsečky, jedna oblast, volná jen šířka a výška', () => {
    const t = setup();
    t.run(rectangleCommands('s', t.view(), onPoint(t.view(), 'origin'), free(30, 20), t.newId));
    expect(Object.keys(t.sketch().points)).toHaveLength(3); // čtvrtý roh je počátek
    expect(Object.keys(t.sketch().curves)).toHaveLength(4);
    expect(types(t.sketch())).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(t.result().regions).toHaveLength(1);
    expect(t.result().degreesOfFreedom).toBe(2);
  });

  it('konstrukční režim: křivky nástroje jsou pomocné, vazby vznikají stejně a profil netvoří', () => {
    const t = setup();
    t.run(asConstruction(rectangleCommands('s', t.view(), onPoint(t.view(), 'origin'), free(30, 20), t.newId)!));
    expect(Object.values(t.sketch().curves).map((curve) => curve.construction)).toEqual([true, true, true, true]);
    expect(types(t.sketch())).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(t.result().regions).toHaveLength(0);
    expect(t.result().degreesOfFreedom).toBe(2);
    expect([...t.view().curves.values()].every((curve) => curve.construction)).toBe(true);
    // kružnice a oblouk; běžná křivka nakreslená potom konstrukční není
    t.run(asConstruction(circleCommands('s', t.view(), free(50, 0), free(55, 0), t.newId)!));
    t.run(asConstruction(arcCommands('s', t.view(), free(80, 0), free(90, 0), free(80, 10), t.newId)!));
    t.run(lineCommands('s', t.view(), free(0, 40), free(10, 40), t.newId)!.commands);
    expect(Object.values(t.sketch().curves).map((curve) => curve.construction === true)).toEqual([true, true, true, true, true, true, false]);
    // příkazy bez křivek zůstávají beze změny
    const point = pointCommands('s', t.view(), free(5, 5), t.newId) as Command[];
    expect(asConstruction(point)).toEqual(point);
  });

  it('obdélník s nulovou šířkou nebo ze dvou stejných bodů nevznikne', () => {
    const t = setup();
    expect(rectangleCommands('s', t.view(), free(1, 1), free(1, 5), t.newId)).toBeUndefined();
    expect(rectangleCommands('s', t.view(), onPoint(t.view(), 'origin'), onPoint(t.view(), 'origin'), t.newId)).toBeUndefined();
  });

  it('řetěz úseček sdílí body a uzavře se na první bod', () => {
    const t = setup();
    const first = lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId, 'horizontal');
    t.run(first?.commands);
    const start = Object.keys(t.sketch().points)[0];
    const second = lineCommands('s', t.view(), onPoint(t.view(), first!.end), free(10, 12), t.newId, 'vertical');
    t.run(second?.commands);
    const third = lineCommands('s', t.view(), onPoint(t.view(), second!.end), onPoint(t.view(), start), t.newId);
    t.run(third?.commands);
    expect(third!.end).toBe(start);
    expect(Object.keys(t.sketch().points)).toHaveLength(3);
    expect(Object.keys(t.sketch().curves)).toHaveLength(3);
    expect(types(t.sketch())).toEqual(['horizontal', 'vertical']);
    expect(t.result().regions).toHaveLength(1);
    // úsečka z bodu do téhož bodu nevznikne
    expect(lineCommands('s', t.view(), onPoint(t.view(), start), onPoint(t.view(), start), t.newId)).toBeUndefined();
  });

  it('přichycení na křivku přidá vazbu bodu na křivce a bod leží na ní', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0.5), free(20, 0.5), t.newId)?.commands);
    const line = Object.keys(t.sketch().curves)[0];
    t.run(lineCommands('s', t.view(), { at: [8, 0.7], snap: { kind: 'curve', id: line } }, free(8, 10), t.newId)?.commands);
    expect(types(t.sketch())).toEqual(['pointOnCurve']);
    const added = Object.values(t.sketch().constraints)[0] as Extract<Constraint, { type: 'pointOnCurve' }>;
    expect(t.result().points[added.point].y).toBeCloseTo(0.5, 6);
    // samotný bod: na křivce s vazbou, na existujícím bodě nic
    expect(pointCommands('s', t.view(), onPoint(t.view(), 'origin'), t.newId)).toBeUndefined();
    t.run(pointCommands('s', t.view(), { at: [15, 0.4], snap: { kind: 'curve', id: line } }, t.newId));
    expect(types(t.sketch())).toEqual(['pointOnCurve', 'pointOnCurve']);
  });

  it('kružnice: poloměr z druhého kliknutí; přichycení obvodu na bod přidá vazbu', () => {
    const t = setup();
    t.run(pointCommands('s', t.view(), free(10, 0), t.newId));
    const point = Object.keys(t.sketch().points)[0];
    t.run(circleCommands('s', t.view(), free(4, 0), onPoint(t.view(), point), t.newId));
    const circle = Object.keys(t.sketch().curves)[0];
    expect(t.result().radii[circle]).toBeCloseTo(6, 6);
    expect(types(t.sketch())).toEqual(['pointOnCurve']);
    expect(circleCommands('s', t.view(), free(4, 0), free(4, 0), t.newId)).toBeUndefined();
  });

  it('oblouk: volný konec se posune na poloměr začátku a oblouk vede proti směru hodin', () => {
    const t = setup();
    t.run(arcCommands('s', t.view(), free(0, 0), free(10, 0), free(0, 25), t.newId));
    const arc = [...t.view().curves.values()][0];
    expect(arc.shape).toMatchObject({ type: 'arc', radius: expect.closeTo(10, 6), from: expect.closeTo(0, 6), sweep: expect.closeTo(Math.PI / 2, 6) });
    expect(t.result().points[arc.points[2]]).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(10, 6) });
    expect(t.result().conflicting).toEqual([]);
    expect(arcCommands('s', t.view(), free(0, 0), free(0, 0), free(5, 5), t.newId)).toBeUndefined();
  });

  it('konec na promítnutém bodě: nový vlastní bod s vazbou totožnosti', () => {
    const t = setup();
    // kvádr 30 × 20 × 10 a skica na jeho horní stěně s promítnutou hranou
    t.run(rectangleCommands('s', t.view(), onPoint(t.view(), 'origin'), free(30, 20), t.newId));
    const loop = Object.keys(t.sketch().curves).sort();
    const execute = (command: Command) => expect(t.engine.execute(command)).toMatchObject({ ok: true });
    execute({ type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', sketch: 's', regions: [{ outerLoop: loop }], distance: 10, operation: 'new' } });
    const top = { feature: 'e', role: 'endCap' as const };
    const edge = t.engine.getState().evaluation.bodies.e.edges.find((e) => e.kind === 'line' && JSON.stringify(e.name).includes('endCap'))!;
    execute({ type: 'addFeature', feature: emptySketch('s2', 'Skica 2', { kind: 'face', body: 'e', face: top }) });
    execute({ type: 'addExternal', sketch: 's2', id: 'x', ref: { type: 'edge', body: 'e', edge: edge.name, kind: 'line' } });
    const state = () => t.engine.getState();
    const sketch2 = () => state().document.features.find((f) => f.id === 's2') as SketchFeature;
    const view = sketchView(sketch2(), state().evaluation.features.s2.sketch!);
    expect(view.curves.get('x')).toMatchObject({ own: false, points: ['x/a', 'x/b'] });
    const corner = view.points.get('x/a')!;
    const line = lineCommands('s2', view, { at: corner.at, snap: { kind: 'point', id: 'x/a' } }, free(corner.at[0] + 3, corner.at[1] + 4), t.newId);
    execute({ type: 'batch', commands: line!.commands });
    expect(types(sketch2())).toEqual(['coincident']);
    const curve = Object.values(sketch2().curves)[0] as { a: Id };
    expect(curve.a).not.toBe('x/a'); // křivka na promítnutý bod neodkazuje
    expect(state().evaluation.features.s2.sketch!.points[curve.a]).toMatchObject({ x: expect.closeTo(corner.at[0], 6), y: expect.closeTo(corner.at[1], 6) });
  });
});

describe('vazby a kóty z výběru', () => {
  // trojúhelník p1 (0,0) – p2 (12,0) – p3 (12,9), kružnice a oblouk stranou
  function shapes() {
    const t = setup();
    const a = lineCommands('s', t.view(), free(1, 1), free(13, 1), t.newId)!;
    t.run(a.commands);
    const b = lineCommands('s', t.view(), onPoint(t.view(), a.end), free(13, 10), t.newId)!;
    t.run(b.commands);
    t.run(circleCommands('s', t.view(), free(30, 5), free(34, 5), t.newId));
    t.run(arcCommands('s', t.view(), free(-20, 0), free(-15, 0), free(-20, 5), t.newId));
    const view = t.view();
    const curves = [...view.curves.values()];
    const [bottom, right] = curves.filter((c) => c.shape.type === 'line').map((c) => c.id);
    return { t, view, bottom, right, circle: curves.find((c) => c.shape.type === 'circle')!.id, arc: curves.find((c) => c.shape.type === 'arc')!.id, corner: a.end, start: view.curves.get(bottom)!.points[0], top: b.end };
  }

  it('typ kóty podle výběru odpovídá tabulce v docs/ui.md', () => {
    const s = shapes();
    const kind = (ids: Id[], variant: 'auto' | 'horizontal' | 'vertical' = 'auto') => dimensionFor(variant, s.view, ids);
    expect(kind([s.start, s.top])).toMatchObject({ type: 'distance', a: s.start, b: s.top, value: 15, driving: true });
    expect(kind([s.bottom])).toMatchObject({ type: 'distance', a: s.start, b: s.corner, value: 12 });
    expect(kind([s.top, s.bottom])).toMatchObject({ type: 'distancePointLine', point: s.top, line: s.bottom, value: 9 });
    expect(kind([s.bottom, s.right])).toMatchObject({ type: 'angle', a: s.bottom, b: s.right, value: expect.closeTo(Math.PI / 2, 9) });
    expect(kind([s.circle])).toMatchObject({ type: 'diameter', curve: s.circle, value: 8 });
    expect(kind([s.arc])).toMatchObject({ type: 'radius', curve: s.arc, value: 5 });
    expect(kind([s.top, s.start], 'horizontal')).toMatchObject({ type: 'horizontalDistance', a: s.top, b: s.start, value: -12 }); // orientovaná: b − a
    expect(kind([s.right], 'vertical')).toMatchObject({ type: 'verticalDistance', value: 9 });
    expect(kind([s.circle], 'horizontal')).toBeUndefined();
    expect(kind([s.start, s.top, s.corner])).toBeUndefined();
    expect(kind([])).toBeUndefined();
  });

  it('kóty z výběru engine přijme a skica zůstane bez konfliktu', () => {
    const s = shapes();
    for (const ids of [[s.start, s.top], [s.bottom], [s.bottom, s.right], [s.circle], [s.arc]]) {
      const d = dimensionFor('auto', s.t.view(), ids);
      s.t.run([{ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint: d! }]);
    }
    expect(s.t.result().conflicting).toEqual([]);
    expect(s.t.engine.getState().evaluation.features.s.status).toBe('ok');
  });

  it('měření v UI používá stejné konvence jako referenční kóty enginu', () => {
    const s = shapes();
    const dimensions: DimensionShape[] = [
      { type: 'distance', a: s.start, b: s.top },
      { type: 'horizontalDistance', a: s.top, b: s.start },
      { type: 'verticalDistance', a: s.top, b: s.start },
      { type: 'distancePointLine', point: s.top, line: s.bottom },
      { type: 'angle', a: s.right, b: s.bottom },
      { type: 'angle', a: s.bottom, b: s.right },
      { type: 'radius', curve: s.arc },
      { type: 'diameter', curve: s.circle },
    ];
    s.t.run(dimensions.map((shape, i): Command => ({ type: 'addConstraint', sketch: 's', id: `ref${i}`, constraint: { ...shape, value: 1, driving: false } })));
    const view = s.t.view();
    dimensions.forEach((shape, i) => expect(measure(shape, view), shape.type).toBeCloseTo(s.t.result().measurements[`ref${i}`], 9));
    expect(measure({ type: 'distance', a: s.start, b: 'chybí' }, view)).toBeUndefined();
  });

  it('vazby bez zvláštního pravidla se nabízejí podle katalogu enginu: souměrnost a střed úsečky', () => {
    // seznam geometrických vazeb je katalog bez kót, takže nová vazba enginu v něm je sama
    expect(GEOMETRIC_KINDS).toEqual(['coincident', 'pointOnCurve', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equalLength', 'tangent', 'symmetric', 'midpoint']);
    expect(Object.keys(CONSTRAINTS).filter((type) => !GEOMETRIC_KINDS.includes(type as (typeof GEOMETRIC_KINDS)[number]))).toEqual(['distance', 'distancePointLine', 'horizontalDistance', 'verticalDistance', 'angle', 'radius', 'diameter']);

    const t = setup();
    t.run([
      { type: 'addPoint', sketch: 's', id: 'top', x: 0.4, y: 30 },
      { type: 'addCurve', sketch: 's', id: 'axis', curve: { type: 'line', a: 'origin', b: 'top', construction: true } },
      { type: 'addPoint', sketch: 's', id: 'l', x: -12, y: 8 },
      { type: 'addPoint', sketch: 's', id: 'r', x: 15, y: 11 },
      { type: 'addPoint', sketch: 's', id: 'm', x: 2, y: 13 },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'm' }, radius: 3 },
      { type: 'addConstraint', sketch: 's', id: 'v', constraint: { type: 'vertical', line: 'axis' } },
    ]);
    const offer = (kind: Parameters<typeof geometricFor>[0], ids: Id[]) => geometricFor(kind, t.view(), ids);
    // operandy se přiřadí podle druhu, na pořadí výběru osy a bodů nezáleží
    expect(offer('symmetric', ['l', 'r', 'axis'])).toEqual([{ type: 'symmetric', a: 'l', b: 'r', line: 'axis' }]);
    expect(offer('symmetric', ['axis', 'r', 'l'])).toEqual([{ type: 'symmetric', a: 'r', b: 'l', line: 'axis' }]);
    expect(offer('symmetric', ['l', 'r'])).toBeUndefined();
    expect(offer('symmetric', ['l', 'axis', 'k'])).toBeUndefined(); // kružnice místo druhého bodu
    expect(offer('symmetric', ['l', 'r', 'm', 'axis'])).toBeUndefined();
    expect(offer('midpoint', ['axis', 'm'])).toEqual([{ type: 'midpoint', point: 'm', line: 'axis' }]);
    expect(offer('midpoint', ['m', 'k'])).toBeUndefined();
    expect(offer('midpoint', ['m'])).toBeUndefined();
    // výběr, který by engine odmítl vlastním pravidlem vazby, se nenabízí
    expect(offer('symmetric', ['origin', 'r', 'axis'])).toBeUndefined(); // souměrný bod je koncem osy
    expect(offer('symmetric', ['top', 'r', 'axis'])).toBeUndefined();
    expect(offer('midpoint', ['top', 'axis'])).toBeUndefined(); // středem by byl konec úsečky
    expect(offer('symmetric', ['l', 'l', 'axis'])).toBeUndefined();
    // engine nabídnuté vazby přijme a geometrie jim odpovídá
    t.run([...offer('symmetric', ['l', 'r', 'axis'])!, ...offer('midpoint', ['axis', 'm'])!].map((constraint): Command => ({ type: 'addConstraint', sketch: 's', id: t.newId('k'), constraint })));
    const p = t.result().points;
    expect(t.result().conflicting).toEqual([]);
    expect(p.l.x).toBeCloseTo(-p.r.x, 6);
    expect(p.l.y).toBeCloseTo(p.r.y, 6);
    expect([p.m.x, p.m.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(p.top.y / 2, 6)]);
    // popisek vazby v pohledu leží u jejích operandů: souměrnost na ose mezi body, střed v bodě
    const anchor = (type: Constraint['type']) => anchorOf(Object.values(t.sketch().constraints).find((c) => c.type === type)!, t.view())!;
    expect(anchor('symmetric')[0]).toBeCloseTo(0, 6);
    expect(anchor('symmetric')[1]).toBeGreaterThan(p.l.y);
    expect(anchor('symmetric')[1]).toBeLessThan(p.top.y);
    expect(anchor('midpoint')).toEqual([expect.closeTo(p.m.x, 6), expect.closeTo(p.m.y, 6)]);
    expect(operandsOf({ type: 'symmetric', a: 'l', b: 'r', line: 'axis' })).toEqual(['l', 'r', 'axis']);
  });

  it('geometrické vazby se nabízejí jen pro vhodný výběr', () => {
    const s = shapes();
    const offer = (kind: Parameters<typeof geometricFor>[0], ids: Id[]) => geometricFor(kind, s.view, ids);
    expect(offer('coincident', [s.start, s.top])).toEqual([{ type: 'coincident', a: s.start, b: s.top }]);
    expect(offer('coincident', [s.start, s.bottom])).toBeUndefined();
    expect(offer('pointOnCurve', [s.circle, s.top])).toEqual([{ type: 'pointOnCurve', point: s.top, curve: s.circle }]);
    expect(offer('horizontal', [s.bottom, s.right])).toEqual([{ type: 'horizontal', line: s.bottom }, { type: 'horizontal', line: s.right }]);
    expect(offer('vertical', [s.circle])).toBeUndefined();
    expect(offer('parallel', [s.bottom, s.right])).toEqual([{ type: 'parallel', a: s.bottom, b: s.right }]);
    expect(offer('equalLength', [s.bottom])).toBeUndefined();
    expect(offer('tangent', [s.bottom, s.circle])).toEqual([{ type: 'tangent', a: s.bottom, b: s.circle }]);
    expect(offer('tangent', [s.arc, s.circle])).toEqual([{ type: 'tangent', a: s.arc, b: s.circle }]);
    expect(offer('tangent', [s.bottom, s.right])).toBeUndefined(); // dvě úsečky
    // každou nabídnutou vazbu engine přijme
    for (const kind of ['horizontal', 'perpendicular', 'tangent'] as const) {
      const ids = kind === 'tangent' ? [s.bottom, s.circle] : kind === 'horizontal' ? [s.bottom] : [s.bottom, s.right];
      s.t.run(offer(kind, ids)!.map((constraint): Command => ({ type: 'addConstraint', sketch: 's', id: s.t.newId('k'), constraint })));
    }
    expect(s.t.result().conflicting).toEqual([]);
  });
});

describe('test zásahu', () => {
  it('bod má dosah, při shodě vyhrává vlastní bod; křivka se bere nejbližší', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0), free(10, 0), t.newId)?.commands); // začíná volným bodem přesně na počátku
    const view = t.view();
    const own = [...view.points.values()].find((p) => p.own && p.at[0] === 0)!;
    expect(hitPoint(view, [0.2, 0.1], 0.5)?.id).toBe(own.id); // počátek leží na stejném místě, vlastní bod má přednost
    expect(hitPoint(view, [0.2, 0.1], 0.5, (id) => id === own.id)?.id).toBe('origin');
    expect(hitPoint(view, [5, 3], 0.5)).toBeUndefined();
    expect(hitCurve(view, [5, 0.3], 0.5)?.id).toBe([...view.curves.keys()][0]);
    expect(hitCurve(view, [5, 0.6], 0.5)).toBeUndefined();
    expect(hitCurve(view, [11, 0], 0.5)).toBeUndefined(); // za koncem úsečky
  });

  it('nejbližší bod oblouku mimo jeho rozsah je bližší konec', () => {
    const arc = { type: 'arc' as const, center: [0, 0] as [number, number], radius: 10, from: 0, sweep: Math.PI / 2 };
    expect(closestOn(arc, [20, 20])).toEqual([expect.closeTo(7.0711, 3), expect.closeTo(7.0711, 3)]);
    expect(closestOn(arc, [5, -8])).toEqual([expect.closeTo(10, 9), expect.closeTo(0, 9)]);
    expect(closestOn(arc, [-8, 5])).toEqual([expect.closeTo(0, 9), expect.closeTo(10, 9)]);
    const points = polyline(arc);
    expect(points[0]).toEqual([10, 0]);
    expect(points[points.length - 1]).toEqual([expect.closeTo(0, 9), expect.closeTo(10, 9)]);
    expect(polyline({ type: 'circle', center: [1, 1], radius: 2 })).toHaveLength(97); // uzavřená
  });
});

describe('nálezy z revize aplikace', () => {
  it('dvojklik nástrojem Úsečka nevytvoří úsečku nulové délky', () => {
    const t = setup();
    // dvě kliknutí na stejné prázdné místo
    expect(lineCommands('s', t.view(), free(3, 3), free(3, 3), t.newId)).toBeUndefined();
    // druhé kliknutí na konci právě nakreslené úsečky: přichytí se na její konec a řetěz skončí
    const first = lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId)!;
    t.run(first.commands);
    expect(lineCommands('s', t.view(), onPoint(t.view(), first.end), onPoint(t.view(), first.end), t.newId)).toBeUndefined();
    // i bez přichycení (kurzor spočítaný před vznikem bodu) úsečka do stejného místa nevznikne
    expect(lineCommands('s', t.view(), onPoint(t.view(), first.end), free(10, 5), t.newId)).toBeUndefined();
    expect(Object.keys(t.sketch().curves)).toHaveLength(1);
    expect(t.result().valid).toBe(true);
    expect(arcCommands('s', t.view(), free(0, 0), free(5, 0), free(9, 0), t.newId)).toBeUndefined(); // konec na začátku
  });

  it('úhlová kóta těsně u −180° se uloží jako 180° a engine ji přijme', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 5), free(10, 5), t.newId)?.commands);
    t.run(lineCommands('s', t.view(), free(10, 8), free(0, 8.02), t.newId)?.commands); // skoro protisměrná
    const [first, second] = Object.keys(t.sketch().curves);
    for (const pair of [[first, second], [second, first]]) {
      const d = dimensionFor('auto', t.view(), pair)!;
      expect(d).toMatchObject({ type: 'angle', value: Math.PI });
      t.run([{ type: 'addConstraint', sketch: 's', id: t.newId('k'), constraint: { ...d, driving: false } }]);
    }
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
    expect(normalizeAngle((270 * Math.PI) / 180)).toBeCloseTo(-Math.PI / 2, 12);
    expect(normalizeAngle(0.5)).toBe(0.5);
  });

  it('nová kóta má hodnotu zaokrouhlenou bez desetinného šumu', () => {
    const t = setup();
    t.run(lineCommands('s', t.view(), free(0, 0.5), free(4.3512, 0.5), t.newId)?.commands);
    expect(dimensionFor('auto', t.view(), Object.keys(t.sketch().curves))?.value).toBe(4.35);
  });

  it('smazání: sdílené body zůstanou, osiřelé zmizí; promítnutí bez geometrie jde zrušit', () => {
    const t = setup();
    t.run(rectangleCommands('s', t.view(), free(5, 5), free(15, 12), t.newId));
    t.run(lineCommands('s', t.view(), free(30, 0.5), free(40, 0.5), t.newId)?.commands);
    const lone = Object.keys(t.sketch().curves)[4];
    const sideOfRectangle = Object.keys(t.sketch().curves)[0];
    t.run(deleteCommands('s', t.sketch(), t.view(), [sideOfRectangle]));
    expect([Object.keys(t.sketch().curves).length, Object.keys(t.sketch().points).length]).toEqual([4, 6]); // rohy drží sousední strany
    t.run(deleteCommands('s', t.sketch(), t.view(), [lone]));
    expect([Object.keys(t.sketch().curves).length, Object.keys(t.sketch().points).length]).toEqual([3, 4]);
    // bod sdílený dvěma stranami vezme obě a s nimi roh, který zůstal sám
    const corner = t.view().curves.get(Object.keys(t.sketch().curves)[0])!.points[1];
    t.run(deleteCommands('s', t.sketch(), t.view(), [corner]));
    expect(Object.keys(t.sketch().curves)).toHaveLength(1);
    expect(deleteCommands('s', t.sketch(), t.view(), ['origin'])).toEqual([]);
    // promítnutí, které přepočet nedokázal promítnout, v pohledu není, ale smazat jde
    const broken: SketchFeature = { ...t.sketch(), external: { x: { type: 'edge', body: 'e', edge: { a: { feature: 'e', role: 'endCap' }, b: { feature: 'e', role: 'startCap' } }, kind: 'line' } } };
    expect(sketchView(broken, t.result()).curves.has('x')).toBe(false);
    expect(deleteCommands('s', broken, sketchView(broken, t.result()), ['x'])).toEqual([{ type: 'removeExternal', sketch: 's', id: 'x' }]);
  });

  it('promítnutá kružnice je v pohledu jako pevná křivka se středem', () => {
    const t = setup();
    const feature: SketchFeature = { ...t.sketch(), external: { x: { type: 'edge', body: 'e', edge: { a: { feature: 'e', role: 'endCap' }, b: { feature: 'e', role: 'side', curve: 'k' } }, kind: 'circle' } } };
    const view = sketchView(feature, { ...t.result(), points: { ...t.result().points, 'x/center': { x: 3, y: 4 } }, radii: { x: 2 } });
    expect(view.curves.get('x')).toEqual({ id: 'x', own: false, construction: false, points: ['x/center'], shape: { type: 'circle', center: [3, 4], radius: 2 } });
    expect(view.points.get('x/center')).toEqual({ id: 'x/center', at: [3, 4], own: false });
    expect([kindOf(view, 'x'), kindOf(view, 'x/center'), kindOf(view, 'origin'), kindOf(view, 'není')]).toEqual(['circle', 'point', 'point', undefined]);
    const diameter: Constraint = { type: 'diameter', curve: 'x', value: 4, driving: false };
    expect(operandsOf(diameter)).toEqual(['x']);
    expect(anchorOf(diameter, view)).toEqual([expect.closeTo(3 + Math.SQRT2, 9), expect.closeTo(4 + Math.SQRT2, 9)]);
    expect(anchorOf({ type: 'distance', a: 'origin', b: 'x/center', value: 5, driving: false }, view)).toEqual([1.5, 2]);
    expect(anchorOf({ type: 'distance', a: 'origin', b: 'není', value: 5, driving: false }, view)).toBeUndefined();
    expect(operandsOf({ type: 'pointOnCurve', point: 'p', curve: 'c' })).toEqual(['p', 'c']);
  });

  it('rozpracované vysunutí: chybějící cíl se sám nepřepíše', () => {
    const draft: ExtrudeFeature = { id: 'e2', name: 'e2', suppressed: false, type: 'extrude', sketch: 's', regions: [{ outerLoop: ['c1'] }], distance: 5, operation: 'add', target: 'smazané' };
    expect(changeExtrude(draft, { distance: 8 }, ['e1'])).toMatchObject({ distance: 8, target: 'smazané' });
    expect(changeExtrude(draft, { target: 'e1' }, ['e1']).target).toBe('e1');
    expect(changeExtrude(draft, { operation: 'new' }, ['e1'])).not.toHaveProperty('target');
    const fresh = changeExtrude({ ...draft, operation: 'new', target: undefined }, { operation: 'cut' }, ['e0', 'e1']);
    expect(fresh).toMatchObject({ operation: 'cut', target: 'e1' });
    expect(changeExtrude({ ...draft, target: undefined }, {}, [])).toMatchObject({ operation: 'add', target: undefined });

    expect(draftCommand(draft, false, 3)).toEqual({ type: 'addFeature', feature: draft, index: 3 });
    expect(draftCommand(draft, true, 3)).toEqual({ type: 'updateExtrude', id: 'e2', sketch: 's', regions: draft.regions, distance: 5, operation: 'add', target: 'smazané' });
    expect(draftCommand({ ...draft, operation: 'new' }, true, 3)).not.toHaveProperty('target');
    expect(draftCommand({ id: 'r', name: 'r', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 4 }, true, 0)).toEqual({ type: 'updatePlane', id: 'r', base: { kind: 'base', plane: 'XY' }, offset: 4 });
  });

  it('bod uvnitř smyčky', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect([insideLoop(square, [5, 5]), insideLoop(square, [15, 5]), insideLoop(square, [5, -1]), insideLoop(new Float64Array(square), [9.9, 0.1])]).toEqual([true, false, false, true]);
  });
});
