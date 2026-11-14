// Validace a provedení příkazů nad dokumentem (bez přepočtu).
import { describe, expect, it } from 'vitest';
import type { Command, Constraint, Document, ExtrudeFeature, Feature, PlaneRef, SketchFeature } from '../src/types';
import { CommandError, applyCommand, emptyDocument, emptySketch, validateDocument } from '../src/document';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const sketchOf = (doc: Document, id = 'S1') => doc.features.find((f) => f.id === id) as SketchFeature;
const extrude = (id: string, sketch: string, extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  sketch,
  regions: [{ outerLoop: ['l1', 'l2', 'l3', 'l4'] }],
  distance: 10,
  operation: 'new',
  ...extra,
});

// Skica s obdélníkem p1..p4, l1..l4 a těleso E1 z ní.
function base(): Document {
  const points: [string, number, number][] = [
    ['p1', 0, 0],
    ['p2', 40, 0],
    ['p3', 40, 30],
    ['p4', 0, 30],
  ];
  return run(
    emptyDocument(),
    { type: 'addFeature', feature: emptySketch('S1', 'Skica', XY) },
    ...points.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y })),
    ...points.map(([id], i): Command => ({ type: 'addCurve', sketch: 'S1', id: `l${i + 1}`, curve: { type: 'line', a: id, b: points[(i + 1) % 4][0] } })),
    { type: 'addFeature', feature: extrude('E1', 'S1') },
  );
}
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);

describe('příkazy časové osy', () => {
  it('přidání na konec a na pozici, dokument se nemění na místě', () => {
    const doc = base();
    const next = applyCommand(doc, { type: 'addFeature', feature: emptySketch('S2', 'Druhá', XY), index: 0 });
    expect(next.features.map((f) => f.id)).toEqual(['S2', 'S1', 'E1']);
    expect(doc.features.map((f) => f.id)).toEqual(['S1', 'E1']);
    expect(next.features[1]).toBe(doc.features[0]); // nezměněné části se sdílejí
  });

  it('ID musí být jedinečné v celém dokumentu a splňovat konvence', () => {
    const doc = base();
    invalid(doc, { type: 'addFeature', feature: emptySketch('E1', 'x', XY) }, /už v dokumentu je/);
    invalid(doc, { type: 'addFeature', feature: emptySketch('p1', 'x', XY) }, /už v dokumentu je/);
    invalid(doc, { type: 'addPoint', sketch: 'S1', id: 'l1', x: 0, y: 0 }, /už v dokumentu je/);
    for (const id of ['a/b', 'origin', '', '__proto__']) invalid(doc, { type: 'addPoint', sketch: 'S1', id, x: 0, y: 0 }, /není přípustné/);
  });

  it('odkaz na feature musí vést na existující feature správného typu, která leží před ní', () => {
    const doc = base();
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S9') }, /neexistuje/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'E1') }, /není skica/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1'), index: 0 }, /musí ležet před/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', target: 'S1' }) }, /není těleso/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut' }) }, /target/);
    invalid(doc, { type: 'addFeature', feature: extrude('E2', 'S1', { target: 'E1' }) }, /nové těleso nemá cíl/);
    invalid(doc, { type: 'addFeature', feature: emptySketch('S2', 'x', { kind: 'plane', feature: 'S1' }) }, /není rovina/);
    const face: PlaneRef = { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } };
    expect(run(doc, { type: 'addFeature', feature: emptySketch('S2', 'x', face) }).features).toHaveLength(3);
  });

  it('extrude: nulová vzdálenost a prázdné oblasti jsou neplatné, oblasti se uloží seřazené', () => {
    const doc = base();
    invalid(doc, { type: 'updateExtrude', id: 'E1', distance: 0 }, /nesmí být nula/);
    invalid(doc, { type: 'updateExtrude', id: 'E1', regions: [] }, /neprázdný seznam/);
    invalid(doc, { type: 'updateExtrude', id: 'E1', distance: Number.NaN }, /konečné číslo/);
    const next = run(doc, { type: 'updateExtrude', id: 'E1', regions: [{ outerLoop: ['l3', 'l1', 'l2', 'l1'] }], distance: -5 });
    expect(next.features[1]).toMatchObject({ regions: [{ outerLoop: ['l1', 'l2', 'l3'] }], distance: -5, id: 'E1' });
  });

  it('updateExtrude umí změnit zdrojovou skicu i operaci', () => {
    const doc = run(base(), { type: 'addFeature', feature: emptySketch('S2', 'x', XY), index: 1 }, { type: 'addFeature', feature: extrude('E2', 'S1', { operation: 'cut', target: 'E1' }) });
    expect(run(doc, { type: 'updateExtrude', id: 'E2', sketch: 'S2' }).features[3]).toMatchObject({ sketch: 'S2', target: 'E1' });
    expect(run(doc, { type: 'updateExtrude', id: 'E2', operation: 'new' }).features[3]).not.toHaveProperty('target');
    invalid(doc, { type: 'updateExtrude', id: 'E1', operation: 'add' }, /target/);
    invalid(doc, { type: 'updateExtrude', id: 'E1', operation: 'add', target: 'E2' }, /není těleso/);
    invalid(doc, { type: 'updateExtrude', id: 'E2', target: 'E2' }, /není těleso/);
  });

  it('removeFeature nekaskáduje a závislý extrude jde opravit beze změny ID', () => {
    const doc = run(base(), { type: 'removeFeature', id: 'S1' });
    expect(doc.features.map((f) => f.id)).toEqual(['E1']);
    // změna, která odkaz na skicu nenastavuje, projde i s odkazem do prázdna
    expect(run(doc, { type: 'updateExtrude', id: 'E1', distance: 20 }).features[0]).toMatchObject({ distance: 20, sketch: 'S1' });
    const repaired = run(doc, { type: 'addFeature', feature: emptySketch('S2', 'nová', XY), index: 0 }, { type: 'updateExtrude', id: 'E1', sketch: 'S2', regions: [{ outerLoop: ['c1'] }] });
    expect(repaired.features[1]).toMatchObject({ id: 'E1', sketch: 'S2' });
  });

  it('moveFeature hlídá pořadí závislostí', () => {
    const doc = run(base(), { type: 'addFeature', feature: emptySketch('S2', 'x', XY) });
    invalid(doc, { type: 'moveFeature', id: 'E1', index: 0 }, /před feature "S1"/);
    invalid(doc, { type: 'moveFeature', id: 'S1', index: 1 }, /za feature "E1"/);
    invalid(doc, { type: 'moveFeature', id: 'S1', index: 3 }, /mimo rozsah/);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 0 }).features.map((f) => f.id)).toEqual(['S2', 'S1', 'E1']);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 1 }).features.map((f) => f.id)).toEqual(['S1', 'S2', 'E1']);
    expect(run(doc, { type: 'moveFeature', id: 'S2', index: 2 })).toBe(doc);
  });

  it('přejmenování, potlačení a úprava roviny', () => {
    const plane: Feature = { id: 'P1', name: 'Rovina', suppressed: false, type: 'plane', base: XY, offset: 5 };
    const doc = run(base(), { type: 'addFeature', feature: plane, index: 0 }, { type: 'renameFeature', id: 'P1', name: 'Horní' }, { type: 'setSuppressed', id: 'E1', suppressed: true }, { type: 'updatePlane', id: 'P1', offset: 12 });
    expect(doc.features[0]).toMatchObject({ name: 'Horní', offset: 12, base: XY });
    expect(doc.features[2].suppressed).toBe(true);
    invalid(doc, { type: 'updatePlane', id: 'P1', base: { kind: 'plane', feature: 'P1' } }, /musí ležet před/);
    invalid(doc, { type: 'updatePlane', id: 'S1', offset: 1 }, /není rovina/);
    invalid(doc, { type: 'setSketchPlane', sketch: 'S1', plane: { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } } }, /musí ležet před/);
    expect(sketchOf(run(doc, { type: 'setSketchPlane', sketch: 'S1', plane: { kind: 'plane', feature: 'P1' } })).plane).toEqual({ kind: 'plane', feature: 'P1' });
  });
});

describe('příkazy skici', () => {
  it('křivka smí odkazovat jen na vlastní body a počátek', () => {
    const doc = base();
    expect(sketchOf(run(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'origin', b: 'p3', construction: true } })).curves.d).toEqual({ type: 'line', a: 'origin', b: 'p3', construction: true });
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'nope' } }, /není vlastní bod/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'p1' } }, /dva různé body/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' } }, /konečné číslo/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 0 }, /kladný/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'd', curve: { type: 'line', a: 'p1', b: 'p3' }, radius: 3 }, /jen u kružnice/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'a', curve: { type: 'arc', center: 'p1', start: 'p2', end: 'p2' } }, /tři různé body/);
    invalid(doc, { type: 'addCurve', sketch: 'S1', id: 'e', curve: { type: 'ellipse', center: 'p1' } as never }, /čeká se jedna z hodnot/);
    const withCircle = run(doc, { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 4 });
    expect(sketchOf(withCircle).radii).toEqual({ c: 4 });
  });

  it('vazby: druh operandů, hodnoty a pravidlo pohyblivého operandu', () => {
    const doc = run(base(), { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p1' }, radius: 4 });
    const add = (constraint: Constraint, id = 'k'): Command => ({ type: 'addConstraint', sketch: 'S1', id, constraint });
    expect(sketchOf(run(doc, add({ type: 'coincident', a: 'p1', b: 'origin' }))).constraints.k).toEqual({ type: 'coincident', a: 'p1', b: 'origin' });
    invalid(doc, add({ type: 'parallel', a: 'l1', b: 'c' }), /čeká se line/);
    invalid(doc, add({ type: 'parallel', a: 'l1', b: 'l1' }), /dvě různé entity/);
    invalid(doc, add({ type: 'horizontal', line: 'p1' }), /čeká se line/);
    invalid(doc, add({ type: 'tangent', a: 'l1', b: 'l2' }), /tečnost dvou úseček/);
    invalid(doc, add({ type: 'coincident', a: 'p1', b: 'ghost' }), /ve skice není/);
    invalid(doc, add({ type: 'distance', a: 'p1', b: 'p2', value: -1, driving: true }), /nesmí být záporná/);
    invalid(doc, add({ type: 'radius', curve: 'c', value: 0, driving: true }), /musí být kladné/);
    invalid(doc, add({ type: 'angle', a: 'l1', b: 'l2', value: 4, driving: true }), /\(−π, π\]/);
    invalid(doc, add({ type: 'radius', curve: 'l1', value: 3, driving: true }), /čeká se circle nebo arc/);
    invalid(doc, add({ type: 'frobnicate' } as never), /neznámá vazba/);
    expect(sketchOf(run(doc, add({ type: 'horizontalDistance', a: 'p2', b: 'p1', value: -40, driving: true }))).constraints.k).toMatchObject({ value: -40 });
    expect(sketchOf(run(doc, add({ type: 'tangent', a: 'c', b: 'l3' }))).constraints.k).toEqual({ type: 'tangent', a: 'c', b: 'l3' });
  });

  it('kóta: změna hodnoty a přepnutí na referenční', () => {
    const doc = run(base(), { type: 'addConstraint', sketch: 'S1', id: 'w', constraint: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true } }, { type: 'addConstraint', sketch: 'S1', id: 'h', constraint: { type: 'horizontal', line: 'l1' } });
    const next = run(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: 50 }, { type: 'setConstraintValue', sketch: 'S1', id: 'w', driving: false });
    expect(sketchOf(next).constraints.w).toEqual({ type: 'distance', a: 'p1', b: 'p2', value: 50, driving: false });
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'w', value: -1 }, /nesmí být záporná/);
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'h', value: 1 }, /není kóta/);
    invalid(doc, { type: 'setConstraintValue', sketch: 'S1', id: 'zzz', value: 1 }, /ve skice není/);
  });

  it('mazání kaskáduje: bod vezme křivky a vazby, křivka vazby', () => {
    const doc = run(
      base(),
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p3' }, radius: 4 },
      { type: 'addConstraint', sketch: 'S1', id: 'k1', constraint: { type: 'horizontal', line: 'l1' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k2', constraint: { type: 'coincident', a: 'p1', b: 'origin' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k3', constraint: { type: 'tangent', a: 'c', b: 'l1' } },
      { type: 'addConstraint', sketch: 'S1', id: 'k4', constraint: { type: 'vertical', line: 'l2' } },
    );
    const noCurve = sketchOf(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'l1' }));
    expect(Object.keys(noCurve.curves)).toEqual(['l2', 'l3', 'l4', 'c']);
    expect(Object.keys(noCurve.constraints)).toEqual(['k2', 'k4']);
    const noPoint = sketchOf(run(doc, { type: 'removeEntity', sketch: 'S1', id: 'p3' }));
    expect(Object.keys(noPoint.points)).toEqual(['p1', 'p2', 'p4']);
    expect(Object.keys(noPoint.curves)).toEqual(['l1', 'l4']);
    expect(noPoint.radii).toEqual({});
    expect(Object.keys(noPoint.constraints)).toEqual(['k1', 'k2']);
    // křivky v regions pozdějšího extrude zůstávají (extrude skončí v chybě až při přepočtu)
    expect((run(doc, { type: 'removeEntity', sketch: 'S1', id: 'l1' }).features[1] as ExtrudeFeature).regions[0].outerLoop).toContain('l1');
    invalid(doc, { type: 'removeEntity', sketch: 'S1', id: 'origin' }, /smazat nejde/);
    invalid(doc, { type: 'removeEntity', sketch: 'S1', id: 'k1' }, /smazat nejde/);
    expect(Object.keys(sketchOf(run(doc, { type: 'removeConstraint', sketch: 'S1', id: 'k1' })).constraints)).toEqual(['k2', 'k3', 'k4']);
  });

  it('konstrukční příznak a tažení', () => {
    const doc = base();
    const flagged = run(doc, { type: 'setConstruction', sketch: 'S1', id: 'l1', construction: true });
    expect(sketchOf(flagged).curves.l1).toEqual({ type: 'line', a: 'p1', b: 'p2', construction: true });
    expect(sketchOf(run(flagged, { type: 'setConstruction', sketch: 'S1', id: 'l1', construction: false })).curves.l1).toEqual({ type: 'line', a: 'p1', b: 'p2' });
    expect(run(doc, { type: 'dragPoint', sketch: 'S1', point: 'p3', x: 1, y: 2 })).toBe(doc);
    invalid(doc, { type: 'dragPoint', sketch: 'S1', point: 'origin', x: 1, y: 2 }, /táhnout nejde/);
    invalid(doc, { type: 'dragPoint', sketch: 'S1', point: 'p3', x: Infinity, y: 2 }, /konečné číslo/);
    invalid(doc, { type: 'addPoint', sketch: 'E1', id: 'q', x: 0, y: 0 }, /není skica/);
  });
});

describe('promítnutá geometrie', () => {
  const edge = { a: { feature: 'E1', role: 'side', curve: 'l2' }, b: { feature: 'E1', role: 'endCap' } } as const;
  const withSketch = () => run(base(), { type: 'addFeature', feature: emptySketch('S2', 'Na víku', { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } }) }, { type: 'addPoint', sketch: 'S2', id: 'q', x: 5, y: 5 });

  it('odvozené entity plynou z druhu promítnutí a jméno hrany se uloží kanonicky', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } });
    expect(sketchOf(doc, 'S2').external.x1.edge).toEqual({ a: edge.b, b: edge.a }); // E1/endCap < E1/side/l2
    const bound = run(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/a' } }, { type: 'addConstraint', sketch: 'S2', id: 'd', constraint: { type: 'distancePointLine', point: 'q', line: 'x1', value: 5, driving: true } });
    expect(Object.keys(sketchOf(bound, 'S2').constraints)).toEqual(['k', 'd']);
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/center' } }, /ve skice není/);
    invalid(doc, { type: 'addCurve', sketch: 'S2', id: 'l', curve: { type: 'line', a: 'q', b: 'x1/a' } }, /není vlastní bod/);
    invalid(doc, { type: 'removeEntity', sketch: 'S2', id: 'x1/a' }, /smazat nejde/);
    invalid(doc, { type: 'dragPoint', sketch: 'S2', point: 'x1/a', x: 0, y: 0 }, /táhnout nejde/);
  });

  it('řídicí vazba jen mezi pevnými entitami je neplatná, referenční kóta platná', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } });
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'horizontal', line: 'x1' } }, /nikdy neprojevila/);
    invalid(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'distance', a: 'origin', b: 'x1/a', value: 3, driving: true } }, /nikdy neprojevila/);
    const ref = run(doc, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'distance', a: 'origin', b: 'x1/a', value: 3, driving: false } });
    invalid(ref, { type: 'setConstraintValue', sketch: 'S2', id: 'k', driving: true }, /nikdy neprojevila/);
  });

  it('updateExternal zachová ID a nesmí změnit druh; removeExternal vezme vazby', () => {
    const doc = run(withSketch(), { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } }, { type: 'addConstraint', sketch: 'S2', id: 'k', constraint: { type: 'coincident', a: 'q', b: 'x1/a' } }, { type: 'addConstraint', sketch: 'S2', id: 'k2', constraint: { type: 'coincident', a: 'q', b: 'origin' } });
    const other = { a: { feature: 'E1', role: 'side', curve: 'l3' }, b: { feature: 'E1', role: 'endCap' } } as const;
    const updated = run(doc, { type: 'updateExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: other, kind: 'line' } });
    expect(sketchOf(updated, 'S2').external.x1.edge.b).toEqual(other.a);
    expect(Object.keys(sketchOf(updated, 'S2').constraints)).toEqual(['k', 'k2']);
    invalid(doc, { type: 'updateExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: other, kind: 'circle' } }, /druh promítnutí změnit nejde/);
    invalid(doc, { type: 'addExternal', sketch: 'S1', id: 'x2', ref: { type: 'edge', body: 'E1', edge, kind: 'line' } }, /musí ležet před/);
    invalid(doc, { type: 'addExternal', sketch: 'S2', id: 'x2', ref: { type: 'edge', body: 'E1', edge: { a: edge.a, b: edge.a }, kind: 'line' } }, /dvou různých stěn/);
    const removed = sketchOf(run(doc, { type: 'removeExternal', sketch: 'S2', id: 'x1' }), 'S2');
    expect(removed.external).toEqual({});
    expect(Object.keys(removed.constraints)).toEqual(['k2']);
  });
});

describe('dávka', () => {
  it('je atomická a hlásí index neplatného příkazu', () => {
    const doc = base();
    const batch: Command = {
      type: 'batch',
      commands: [
        { type: 'addPoint', sketch: 'S1', id: 'q1', x: 1, y: 1 },
        { type: 'addCurve', sketch: 'S1', id: 'n1', curve: { type: 'line', a: 'q1', b: 'p1' } }, // odkaz na bod z téže dávky
        { type: 'addCurve', sketch: 'S1', id: 'n2', curve: { type: 'line', a: 'q1', b: 'q9' } },
      ],
    };
    let error: unknown;
    try {
      applyCommand(doc, batch);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).commandIndex).toBe(2);
    const ok = run(doc, { type: 'batch', commands: (batch as Extract<Command, { type: 'batch' }>).commands.slice(0, 2) });
    expect(Object.keys(sketchOf(ok).curves)).toContain('n1');
    invalid(doc, { type: 'batch', commands: [{ type: 'dragPoint', sketch: 'S1', point: 'p1', x: 0, y: 0 }] }, /nejde zařadit do dávky/);
    invalid(doc, { type: 'explode' } as never, /neznámý příkaz/);
  });
});

describe('načtení dokumentu', () => {
  it('dokument vzniklý příkazy projde beze změny, i s odkazem na smazanou feature', () => {
    const doc = run(
      base(),
      { type: 'addConstraint', sketch: 'S1', id: 'w', constraint: { type: 'distance', a: 'p1', b: 'p2', value: 40, driving: true } },
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'p3' }, radius: 4 },
      { type: 'addFeature', feature: emptySketch('S2', 'x', { kind: 'face', body: 'E1', face: { feature: 'E1', role: 'endCap' } }) },
      { type: 'addExternal', sketch: 'S2', id: 'x1', ref: { type: 'edge', body: 'E1', edge: { a: { feature: 'E1', role: 'startCap' }, b: { feature: 'E1', role: 'endCap' } }, kind: 'circle' } },
    );
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const broken = run(doc, { type: 'removeFeature', id: 'S1' }, { type: 'removeFeature', id: 'E1' });
    expect(validateDocument(JSON.parse(JSON.stringify(broken)))).toEqual(broken);
  });

  it('neplatný dokument se odmítne', () => {
    const doc = JSON.parse(JSON.stringify(base()));
    const bad = (change: (d: any) => void, pattern: RegExp) => {
      const copy = JSON.parse(JSON.stringify(doc));
      change(copy);
      expect(() => validateDocument(copy)).toThrow(pattern);
    };
    bad((d) => (d.schemaVersion = 2), /verze schématu/);
    bad((d) => (d.settings.chordTolerance = 0), /musí být kladná/);
    bad((d) => (d.features[0].curves.l1.b = 'p9'), /není vlastní bod/);
    bad((d) => (d.features[0].points.p1.x = null), /konečné číslo/);
    bad((d) => (d.features[0].radii.l1 = 3), /není kružnice/);
    bad((d) => (d.features[0].constraints.k = { type: 'horizontal', line: 'p1' }), /čeká se line/);
    bad((d) => (d.features[0].solved.external.x9 = { kind: 'line', a: [0, 0], b: [1, 1] }), /neodpovídá promítnuté geometrii/);
    bad((d) => d.features.push({ ...d.features[1] }), /dvakrát/);
    bad((d) => (d.features[1].distance = 0), /nesmí být nula/);
    bad((d) => (d.features[1].type = 'revolve'), /čeká se jedna z hodnot/);
    expect(() => validateDocument(null)).toThrow(/čeká se objekt/);
  });
});
