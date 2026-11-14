// Validační scénář 8 (docs/requirements.md): souměrný díl s konstrukční osou.
import { describe, expect, it } from 'vitest';
import type { Command, Id } from '@trymesh/engine';
import { XY, addExtrude, addSketch, batch, constrain, dimension, expectAllOk, newEngine, run, volume } from './kit';

describe('scénář 8: souměrný díl s konstrukční osou', () => {
  it('lichoběžník souměrný podle osy s dírou v jejím středu: změny rozměrů souměrnost drží', () => {
    const engine = newEngine();
    const point = (id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: 'S1', id, x, y });
    const line = (id: Id, a: Id, b: Id, construction = false): Command => ({ type: 'addCurve', sketch: 'S1', id, curve: { type: 'line', a, b, ...(construction ? { construction: true } : {}) } });
    const at = (id: Id) => engine.getState().evaluation.features.S1.sketch!.points[id];
    const sketch = () => engine.getState().evaluation.features.S1.sketch!;
    const diagnose = () => engine.diagnoseSketch('S1');

    // 1. konstrukční osa z počátku: svislá, s danou délkou
    run(engine, addSketch('S1', XY), batch(point('top', 1.5, 37), line('axis', 'origin', 'top', true), constrain('S1', 'axisV', { type: 'vertical', line: 'axis' }), dimension('S1', 'height', { type: 'distance', a: 'origin', b: 'top' }, 40)));
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 0 });
    expect(sketch().regions).toHaveLength(0); // konstrukční křivka profil netvoří

    // 2. obrys od ruky, zatím bez vazeb
    run(engine, batch(point('bl', -27, 2), point('br', 33, -1), point('tr', 13, 38), point('tl', -17, 41), line('bottom', 'bl', 'br'), line('right', 'br', 'tr'), line('upper', 'tr', 'tl'), line('left', 'tl', 'bl')));
    expect(diagnose().degreesOfFreedom).toBe(8);

    // 3. souměrnost podle osy: každá vazba ubere dva stupně volnosti
    run(engine, constrain('S1', 'symBottom', { type: 'symmetric', a: 'bl', b: 'br', line: 'axis' }));
    expect(diagnose().degreesOfFreedom).toBe(6);
    run(engine, constrain('S1', 'symTop', { type: 'symmetric', a: 'tr', b: 'tl', line: 'axis' }));
    expect(diagnose().degreesOfFreedom).toBe(4);
    expect([at('bl').x + at('br').x, at('bl').y - at('br').y, at('tl').x + at('tr').x, at('tl').y - at('tr').y].map(Math.abs).every((value) => value < 1e-7)).toBe(true);
    // volný je každý roh, ale jen ve dvojici se svým protějškem
    expect(Object.fromEntries(diagnose().free.map((entity) => [entity.id, entity.freedom]))).toEqual({ bl: 2, br: 2, tr: 2, tl: 2 });

    // 4. základna prochází počátkem, horní hrana koncem osy; šířky kótami
    run(
      engine,
      constrain('S1', 'baseOnOrigin', { type: 'pointOnCurve', point: 'origin', curve: 'bottom' }),
      constrain('S1', 'upperOnAxis', { type: 'pointOnCurve', point: 'top', curve: 'upper' }),
      dimension('S1', 'wide', { type: 'distance', a: 'bl', b: 'br' }, 60),
      dimension('S1', 'narrow', { type: 'distance', a: 'tl', b: 'tr' }, 30),
    );
    expect(diagnose()).toEqual({ status: 'solved', degreesOfFreedom: 0, conflicting: [], duplicates: [], redundant: [], removable: [], free: [] });
    expect([at('bl').x, at('bl').y, at('br').x, at('tl').x, at('tl').y, at('tr').x]).toEqual([-30, 0, 30, -15, 40, 15].map((value) => expect.closeTo(value, 6)));

    // 5. díra ve středu osy
    run(engine, batch(point('hc', 2, 17), { type: 'addCurve', sketch: 'S1', id: 'hole', curve: { type: 'circle', center: 'hc' }, radius: 5 }, constrain('S1', 'holeMid', { type: 'midpoint', point: 'hc', line: 'axis' }), dimension('S1', 'holeR', { type: 'radius', curve: 'hole' }, 6)));
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [] });
    expect([at('hc').x, at('hc').y]).toEqual([expect.closeTo(0, 6), expect.closeTo(20, 6)]);
    expect(sketch().valid).toBe(true);
    expect(sketch().regions.map((region) => region.ref.outerLoop)).toEqual(expect.arrayContaining([['bottom', 'left', 'right', 'upper'], ['hole']]));

    // 6. vazba navíc: vodorovnost základny plyne ze souměrnosti podle svislé osy
    run(engine, constrain('S1', 'baseH', { type: 'horizontal', line: 'bottom' }));
    expect(diagnose()).toMatchObject({ degreesOfFreedom: 0, removable: ['baseH'] });
    expect(engine.explainConstraint('S1', 'baseH')).toEqual({ redundant: true, impliedBy: ['axisV', 'symBottom'] });
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'baseH' });

    // 7. těleso: lichoběžník bez díry
    run(engine, addExtrude('E1', 'S1', [['bottom', 'left', 'right', 'upper']], 5));
    expectAllOk(engine.getState());
    const plate = (wide: number, narrow: number, height: number) => ((wide + narrow) / 2) * height * 5;
    const holeAtMost = Math.PI * 36 * 5;
    const solid = () => volume(engine.getState().evaluation.bodies.E1.solid);
    expect(solid()).toBeLessThan(plate(60, 30, 40) - 0.99 * holeAtMost);
    expect(solid()).toBeGreaterThan(plate(60, 30, 40) - holeAtMost);

    // 8. změna šířky a výšky: souměrnost i střed drží, díra zůstává uprostřed
    run(engine, { type: 'setConstraintValue', sketch: 'S1', id: 'wide', value: 80 }, { type: 'setConstraintValue', sketch: 'S1', id: 'height', value: 50 });
    expectAllOk(engine.getState());
    expect([at('bl').x, at('br').x, at('tl').y, at('hc').x, at('hc').y]).toEqual([-40, 40, 50, 0, 25].map((value) => expect.closeTo(value, 6)));
    expect(solid()).toBeGreaterThan(plate(80, 30, 50) - holeAtMost);
    expect(solid()).toBeLessThan(plate(80, 30, 50) - 0.99 * holeAtMost);
    expect(diagnose()).toMatchObject({ status: 'solved', degreesOfFreedom: 0, redundant: [] });

    // 9. bez kóty šířky jde rohem táhnout a protější roh ho zrcadlí
    run(engine, { type: 'removeConstraint', sketch: 'S1', id: 'wide' });
    expect(diagnose().free).toEqual([
      { id: 'bl', kind: 'point', freedom: 1 },
      { id: 'br', kind: 'point', freedom: 1 },
    ]);
    run(engine, { type: 'dragPoint', sketch: 'S1', point: 'br', x: 55, y: 3 });
    expect([at('br').x, at('br').y, at('bl').x, at('bl').y]).toEqual([55, 0, -55, 0].map((value) => expect.closeTo(value, 5)));

    // 10. uložení a načtení: dokument s novými vazbami dá stejný model
    const [saved, bodies] = [engine.save(), solid()];
    const other = newEngine();
    expect(other.load(saved).ok).toBe(true);
    expect(other.save()).toBe(saved);
    expect(volume(other.getState().evaluation.bodies.E1.solid)).toBe(bodies);
    expect(other.diagnoseSketch('S1')).toEqual(diagnose());
  });
});
