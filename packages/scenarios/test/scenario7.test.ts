// Validační scénář 7 (docs/requirements.md): skica krok za krokem s diagnostikou.
import { describe, expect, it } from 'vitest';
import type { Command, Id } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, constrain, dimension, expectAllOk, newEngine, run, volume } from './kit';

describe('scénář 7: skica krok za krokem s diagnostikou', () => {
  it('úhelník od ruky: diagnostika po každém kroku říká, co je volné a co navíc', () => {
    const engine = newEngine();
    const diagnose = () => engine.diagnoseSketch('S1');
    const freedoms = () => Object.fromEntries(diagnose().free.map((entity) => [entity.id, entity.freedom]));
    const all = (value: number) => Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, value]));

    // 1. obrys od ruky: šest bodů a šest úseček, žádná vazba
    const corners: [Id, number, number][] = [
      ['a', 0.6, -0.4],
      ['b', 29.1, 0.7],
      ['c', 30.8, 7.2],
      ['d', 8.9, 8.6],
      ['e', 7.4, 19.1],
      ['f', -0.8, 20.9],
    ];
    run(
      engine,
      addSketch('S1', XY),
      batch(
        ...corners.map(([id, x, y]): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y })),
        ...corners.map(([id], i): Command => ({ type: 'addCurve', sketch: 'S1', id: `${id}${corners[(i + 1) % 6][0]}`, curve: { type: 'line', a: id, b: corners[(i + 1) % 6][0] } })),
      ),
    );
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 12, redundant: [], duplicates: [] });
    expect(freedoms()).toEqual(all(2));

    // 2. směry stran: každá vazba ubere jeden stupeň volnosti
    const directions: [Id, 'horizontal' | 'vertical'][] = [
      ['ab', 'horizontal'],
      ['bc', 'vertical'],
      ['cd', 'horizontal'],
      ['de', 'vertical'],
      ['ef', 'horizontal'],
      ['fa', 'vertical'],
    ];
    directions.forEach(([line, type], i) => {
      run(engine, constrain('S1', `dir-${line}`, { type, line }));
      expect(diagnose().degreesOfFreedom).toBe(11 - i);
    });
    expect(freedoms()).toEqual(all(2)); // každý bod se ještě hýbe ve dvou směrech

    // 3. rozměry: šířka, výška a tloušťka obou ramen
    run(
      engine,
      dimension('S1', 'width', { type: 'horizontalDistance', a: 'a', b: 'b' }, 30),
      dimension('S1', 'height', { type: 'verticalDistance', a: 'a', b: 'f' }, 20),
      dimension('S1', 'foot', { type: 'verticalDistance', a: 'b', b: 'c' }, 8),
      dimension('S1', 'leg', { type: 'horizontalDistance', a: 'f', b: 'e' }, 8),
    );
    // tvar je určený, volná je jen poloha: volnost každého bodu se rovná volnosti skici,
    // takže skicu určí zafixování kteréhokoli z nich
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 2, redundant: [] });
    expect(freedoms()).toEqual(all(2));

    // 4. ukotvení k počátku
    run(engine, constrain('S1', 'anchor', { type: 'coincident', a: 'a', b: 'origin' }));
    expect(diagnose()).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
    const points = engine.getState().evaluation.features.S1.sketch!.points;
    expect([points.d.x, points.d.y, points.e.y]).toEqual([expect.closeTo(8, 6), expect.closeTo(8, 6), expect.closeTo(20, 6)]);

    // 5. vazby navíc: přesnou duplicitu engine odmítne, odvozenou vazbu a kótu přijme a diagnostika je ukáže
    const duplicate = engine.execute(constrain('S1', 'again', { type: 'horizontal', line: 'ab' }));
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    run(engine, constrain('S1', 'par', { type: 'parallel', a: 'cd', b: 'ab' }), dimension('S1', 'inner', { type: 'verticalDistance', a: 'd', b: 'e' }, 12));
    expectAllOk(engine.getState()); // nadbytečné vazby nejsou chyba ani varování
    const extra = diagnose();
    expect(extra).toMatchObject({ status: 'solved', degreesOfFreedom: 0, duplicates: [], removable: ['par', 'inner'], free: [] });
    expect(extra.redundant).toEqual(expect.arrayContaining(['par', 'inner', 'dir-ab', 'dir-cd', 'height', 'foot']));
    expect(extra.redundant).not.toContain('anchor');
    expect(extra.redundant).not.toContain('width');
    expect(engine.explainConstraint('S1', 'par')).toEqual({ redundant: true, impliedBy: ['dir-ab', 'dir-cd'] });
    expect(engine.explainConstraint('S1', 'width')).toEqual({ redundant: false, impliedBy: [] });
    // vnitřní výška plyne z celkové výšky, tloušťky paty a směrů stran mezi nimi
    const inner = engine.explainConstraint('S1', 'inner').impliedBy;
    expect(inner).toEqual(expect.arrayContaining(['height', 'foot']));
    expect(inner).not.toContain('width');

    // 6. úklid podle návrhu diagnostiky
    run(engine, batch(...extra.removable.map((id): Command => ({ type: 'removeConstraint', sketch: 'S1', id }))));
    expect(diagnose()).toMatchObject({ degreesOfFreedom: 0, redundant: [], removable: [] });

    // 7. těleso a změna kóty: diagnostika platí pro nový stav
    run(engine, addExtrude('E1', 'S1', [['ab', 'bc', 'cd', 'de', 'ef', 'fa']], 10));
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo((30 * 8 + 8 * 12) * 10, 3);
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'foot', value: 10 });
    expectAllOk(engine.getState());
    expect(volume(engine.getState().evaluation.bodies.E1.solid)).toBeCloseTo((30 * 10 + 8 * 10) * 10, 3);
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [] });

    // 8. bez ukotvení je zase volná jen poloha; undo vrátí určenou skicu
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'anchor' });
    expect(diagnose().degreesOfFreedom).toBe(2);
    expect(freedoms()).toEqual(all(2));
    engine.undo();
    expect(diagnose()).toMatchObject({ degreesOfFreedom: 0, free: [] });
  });
});
