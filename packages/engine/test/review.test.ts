// Nálezy z revize enginu: případy, které dřív dávaly špatný výsledek nebo výjimku.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, emptySketch, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { type SketchGeometry, detectProfile } from '../src/sketch';
import type { Command, Curve, Document, EngineState, ExtrudeFeature, SketchFeature, SketchSolver, SolidKernel } from '../src/types';

type Entry = [id: string, curve: Curve, radius?: number];
const apply = (commands: Command[], doc: Document = emptyDocument()): Document => commands.reduce<Document>(applyCommand, doc);
function sketch(points: Record<string, [number, number]>, curves: Entry[]): SketchFeature {
  return apply([
    { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
    ...Object.entries(points).map(([id, [x, y]]): Command => ({ type: 'addPoint', sketch: 'S', id, x, y })),
    ...curves.map(([id, curve, radius]): Command => ({ type: 'addCurve', sketch: 'S', id, curve, ...(radius === undefined ? {} : { radius }) })),
  ]).features[0] as SketchFeature;
}
const geometry = (s: SketchFeature): SketchGeometry => ({ points: { origin: { x: 0, y: 0 }, ...s.points }, radii: { ...s.radii } });
const profile = (s: SketchFeature, tolerance = 0.01) => detectProfile(s, geometry(s), tolerance);
const line = (a: string, b: string): Curve => ({ type: 'line', a, b });
const outer = (s: SketchFeature) => profile(s).regions.map((r) => r.ref.outerLoop.join(','));

describe('profil', () => {
  it('úsečka a oblouk vycházející z vrcholu tečně stejným směrem: oblasti nezávisí na natočení', () => {
    // čtvrtkruh se středem v počátku a dvě tečny, které ho doplňují na čtverec
    for (let i = 0; i < 200; i++) {
      const angle = 0.0137 + i * 0.0314;
      const turn = (x: number, y: number): [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
      const s = sketch({ v: turn(10, 0), w: turn(0, 10), z: turn(10, 10) }, [
        ['arc', { type: 'arc', center: 'origin', start: 'v', end: 'w' }],
        ['wc', line('w', 'origin')],
        ['cv', line('origin', 'v')],
        ['vz', line('v', 'z')],
        ['zw', line('z', 'w')],
      ]);
      expect(outer(s), `natočení ${angle}`).toEqual(['arc,cv,wc', 'arc,vz,zw']);
    }
  });

  it('obří poloměr se dělí nejvýš na 4096 úseček', () => {
    const s = sketch({}, [['k', { type: 'circle', center: 'origin' }, 1e9]]);
    expect(profile(s).regions[0].outer.keys).toHaveLength(4096);
    expect(() => sketch({}, [['k', { type: 'circle', center: 'origin' }, 1e15]])).toThrow(CommandError);
  });

  it('křivka blíž k oblouku, než rozliší jeho dělení, zneplatní profil', () => {
    const square = (radius: number): SketchFeature => {
      const corners = [0, 1, 2, 3].map((i): [number, number] => [radius * Math.cos(0.02 + (i * Math.PI) / 2), radius * Math.sin(0.02 + (i * Math.PI) / 2)]);
      return sketch(Object.fromEntries(corners.map((p, i) => [`q${i}`, p])), [['k', { type: 'circle', center: 'origin' }, 10], ...corners.map((_, i): Entry => [`s${i}`, line(`q${i}`, `q${(i + 1) % 4}`)])]);
    };
    // rohy čtverce 0,003 pod kružnicí: přesné křivky se nedotýkají, ale lomená čára kružnice je protne
    expect(profile(square(9.997))).toEqual({ valid: false, regions: [] });
    expect(outer(square(9.9))).toEqual(['k', 's0,s1,s2,s3']);
    expect(profile(square(9.9)).regions[0].holes).toHaveLength(1);
  });

  it('oblast tenčí než tolerance dělení oblouku zneplatní profil', () => {
    const at = (angle: number): [number, number] => [100 * Math.cos(angle), 100 * Math.sin(angle)];
    const lens = (half: number) => sketch({ s: at(-half), e: at(half) }, [['arc', { type: 'arc', center: 'origin', start: 's', end: 'e' }], ['chord', line('e', 's')]]);
    expect(profile(lens(0.01))).toEqual({ valid: false, regions: [] }); // výška úseče 0,005 < 0,01
    expect(outer(lens(0.1))).toEqual(['arc,chord']);
  });
});

describe('dokument', () => {
  const rejects = (run: () => unknown) => expect(run).toThrow(CommandError);
  const base = sketch({ a: [0, 0.5], b: [5, 0.5] }, [['l', line('a', 'b')]]);
  const doc: Document = { ...emptyDocument(), features: [base] };

  it('ID nesmí být jméno vlastnosti každého objektu', () => {
    for (const id of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      rejects(() => apply([{ type: 'addFeature', feature: emptySketch(id, 'x', { kind: 'base', plane: 'XY' }) }]));
      rejects(() => apply([{ type: 'addPoint', sketch: 'S', id, x: 0, y: 0 }], doc));
    }
  });

  it('konstrukční příznak nemění pořadí klíčů: uložení, načtení a uložení dá stejný text', () => {
    const flagged = apply([{ type: 'setConstruction', sketch: 'S', id: 'l', construction: true }], doc);
    expect(JSON.stringify(validateDocument(JSON.parse(JSON.stringify(flagged))))).toBe(JSON.stringify(flagged));
  });

  it('záporná nula se ukládá jako nula a čísla mimo rozsah se odmítnou', () => {
    const s = apply([{ type: 'addPoint', sketch: 'S', id: 'n', x: -0, y: 3 }], doc).features[0] as SketchFeature;
    expect(Object.is(s.points.n.x, 0)).toBe(true);
    rejects(() => apply([{ type: 'addPoint', sketch: 'S', id: 'n', x: 1e300, y: 0 }], doc));
    rejects(() => apply([{ type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 2e9 } }], doc));
  });

  it('nový bod a nová křivka ruší razítko řešení', () => {
    const solved: Document = { ...doc, features: [{ ...base, solved: { inputs: 'otisk', external: {} } }] };
    const stamp = (commands: Command[]) => (apply(commands, solved).features[0] as SketchFeature).solved.inputs;
    expect(stamp([{ type: 'addPoint', sketch: 'S', id: 'n', x: 1, y: 1 }])).toBe('');
    expect(stamp([{ type: 'addCurve', sketch: 'S', id: 'k', curve: { type: 'circle', center: 'a' }, radius: 2 }])).toBe('');
    expect(stamp([{ type: 'setConstruction', sketch: 'S', id: 'l', construction: true }])).toBe('otisk');
  });

  it('tatáž oblast dvakrát je jedna oblast', () => {
    const extrude: ExtrudeFeature = { id: 'E', name: 'E', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['l', 'm'] }, { outerLoop: ['m', 'l', 'l'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' };
    expect(apply([{ type: 'addFeature', feature: extrude }], doc).features[1]).toMatchObject({ profile: { regions: [{ outerLoop: ['l', 'm'] }] } });
  });

  it('zmrazená promítnutá kružnice musí mít kladný poloměr', () => {
    const frozen = { ...base, solved: { inputs: '', external: { x: { kind: 'circle', center: [0, 0], radius: -5 } } } };
    rejects(() => validateDocument(JSON.parse(JSON.stringify({ ...doc, features: [frozen] }))));
  });

  it('skica na stěně nesmí ležet před extrude, který stěnu vytvořil', () => {
    const extrude = (id: string, sketchId: string, rest: Partial<ExtrudeFeature> = {}): ExtrudeFeature => ({ id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: sketchId, regions: [{ outerLoop: ['l'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new', ...rest });
    const pocket = { kind: 'face' as const, body: 'E1', face: { feature: 'E2', role: 'endCap' as const } };
    const model = apply(
      [
        { type: 'addFeature', feature: extrude('E1', 'S') },
        { type: 'addFeature', feature: emptySketch('S2', 'S2', { kind: 'base', plane: 'XY' }) },
        { type: 'addFeature', feature: extrude('E2', 'S2', { operation: 'cut', targets: ['E1'] }) },
        { type: 'addFeature', feature: emptySketch('S3', 'S3', pocket) },
      ],
      doc,
    );
    expect(model.features.map((f) => f.id)).toEqual(['S', 'E1', 'S2', 'E2', 'S3']);
    rejects(() => apply([{ type: 'moveFeature', id: 'S3', index: 3 }], model)); // před E2
    rejects(() => apply([{ type: 'moveFeature', id: 'E2', index: 4 }], model)); // E2 za skicu na své stěně
    rejects(() => apply([{ type: 'addFeature', feature: emptySketch('S4', 'S4', pocket), index: 3 }], model));
    rejects(() => apply([{ type: 'setSketchPlane', sketch: 'S2', plane: pocket }], model));
    const edge = { type: 'edge' as const, body: 'E1', edge: { a: { feature: 'E1', role: 'endCap' as const }, b: { feature: 'E2', role: 'side' as const, curve: 'l' } }, kind: 'line' as const };
    rejects(() => apply([{ type: 'addExternal', sketch: 'S2', id: 'x', ref: edge }], model));
    expect(() => apply([{ type: 'addExternal', sketch: 'S3', id: 'x', ref: edge }], model)).not.toThrow();
  });
});

// Náhradní adaptéry: solver vrací vstup beze změny, při tažení bod přesune nebo selže.
function mockEngine(options: { failDrag?: boolean } = {}) {
  const solver: SketchSolver = {
    solve: (input) => {
      const result = { points: input.points, radii: input.radii, degreesOfFreedom: 2, conflicting: [], redundant: [] };
      if (!input.drag) return { status: 'solved', ...result };
      if (options.failDrag) return { status: 'failed', ...result };
      return { status: 'solved', ...result, points: { ...input.points, [input.drag.point]: input.drag.target } };
    },
  };
  const kernel: SolidKernel = {
    boolean: () => {
      throw new Error('náhradní jádro booleany neumí');
    },
    triangulate: () => new Uint32Array(),
  };
  const engine = createEngine({ solver, kernel });
  const run = (...commands: Command[]) => commands.forEach((command) => expect(engine.execute(command)).toMatchObject({ ok: true }));
  run(
    { type: 'addFeature', feature: emptySketch('S', 'S', { kind: 'base', plane: 'XY' }) },
    { type: 'addPoint', sketch: 'S', id: 'a', x: 1, y: 2 },
    { type: 'addPoint', sketch: 'S', id: 'b', x: 5, y: 2 },
    { type: 'addCurve', sketch: 'S', id: 'l', curve: { type: 'line', a: 'a', b: 'b' } },
    { type: 'addConstraint', sketch: 'S', id: 'd', constraint: { type: 'distance', a: 'a', b: 'b', value: 4, driving: true } },
    { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'XY' }, offset: 3 } },
  );
  expect(engine.load(engine.save())).toMatchObject({ ok: true }); // prázdná historie
  return { engine, run };
}

describe('fasáda enginu', () => {
  it('tažení, které solver nevyřeší, nezanechá ve stavu konflikt', () => {
    const { engine } = mockEngine({ failDrag: true });
    const before = engine.getState();
    const seen: EngineState[] = [];
    engine.subscribe((state) => seen.push(state));
    expect(engine.execute({ type: 'dragPoint', sketch: 'S', point: 'a', x: 9, y: 9 })).toMatchObject({ ok: true });
    const after = engine.getState();
    expect(after.document).toBe(before.document);
    expect(after.evaluation).toBe(before.evaluation);
    expect(after.evaluation.features.S.status).toBe('ok');
    expect(after.canUndo).toBe(false);
    expect(seen).toHaveLength(1);
    // náhled téhož tažení konflikt ukáže, stav enginu se nemění
    const preview = engine.preview({ type: 'dragPoint', sketch: 'S', point: 'a', x: 9, y: 9 }, 'S');
    expect(preview.ok && preview.state.evaluation.features.S.warnings.map((w) => w.code)).toEqual(['sketchConflict']);
  });

  it('krok undo vzniká jen změnou obsahu dokumentu', () => {
    const { engine } = mockEngine();
    const noop: Command[] = [
      { type: 'renameFeature', id: 'P', name: 'P' },
      { type: 'setSuppressed', id: 'P', suppressed: false },
      { type: 'updateFeature', id: 'P', patch: {} },
      { type: 'setConstraintValue', sketch: 'S', id: 'd', value: 4 },
      { type: 'setConstruction', sketch: 'S', id: 'l', construction: false },
      { type: 'moveFeature', id: 'P', index: 1 },
      { type: 'batch', commands: [] },
      { type: 'dragPoint', sketch: 'S', point: 'a', x: 1, y: 2 }, // na místo, kde bod už je
    ];
    for (const command of noop) {
      expect(engine.execute(command), command.type).toMatchObject({ ok: true });
      expect(engine.getState().canUndo, command.type).toBe(false);
    }
    expect(engine.execute({ type: 'dragPoint', sketch: 'S', point: 'a', x: 2, y: 2 })).toMatchObject({ ok: true });
    expect(engine.getState().canUndo).toBe(true);
    expect((engine.getState().document.features[0] as SketchFeature).points.a).toEqual({ x: 2, y: 2 });
  });

  it('výjimka posluchače nepřipraví ostatní o zprávu; vnořená změna dorazí všem ve správném pořadí', () => {
    const { engine } = mockEngine();
    const names = (state: EngineState) => state.document.features[1].name;
    const first: string[] = [];
    const last: string[] = [];
    let nested = false;
    engine.subscribe((state) => {
      first.push(names(state));
      if (!nested) {
        nested = true;
        engine.execute({ type: 'renameFeature', id: 'P', name: 'vnořená' });
      }
    });
    engine.subscribe(() => {
      throw new Error('posluchač selhal');
    });
    engine.subscribe((state) => last.push(names(state)));
    expect(() => engine.execute({ type: 'renameFeature', id: 'P', name: 'vnější' })).toThrow('posluchač selhal');
    expect(first).toEqual(['vnější', 'vnořená']);
    expect(last).toEqual(['vnější', 'vnořená']);
    expect(names(engine.getState())).toBe('vnořená');
    expect(engine.getState().canUndo).toBe(true);
  });

  it('neznámá feature v getState a preview je chyba, ne tichý přepočet celé osy', () => {
    const { engine } = mockEngine();
    expect(() => engine.getState('není')).toThrow('neexistuje');
    expect(engine.preview({ type: 'renameFeature', id: 'P', name: 'x' }, 'není')).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    expect(engine.preview({ type: 'removeFeature', id: 'P' }, 'P')).toMatchObject({ ok: false, error: { code: 'invalidCommand' } });
    expect(engine.preview({ type: 'renameFeature', id: 'P', name: 'x' }, 'S')).toMatchObject({ ok: true });
  });

  it('odkaz na chybějící feature se jménem vlastnosti objektu je brokenReference, ne výjimka', () => {
    const { engine } = mockEngine();
    const doc = JSON.parse(engine.save()) as Document;
    doc.features.push(
      { id: 'E', name: 'E', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'toString', regions: [{ outerLoop: ['l'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'cut', targets: ['valueOf'] },
      { id: 'Q', name: 'Q', suppressed: false, type: 'plane', base: { kind: 'plane', feature: 'hasOwnProperty' }, offset: 1 },
      { ...emptySketch('T', 'T', { kind: 'face', body: 'constructor', face: { feature: 'E', role: 'endCap' } }) },
    );
    expect(engine.load(JSON.stringify(doc))).toMatchObject({ ok: true });
    const features = engine.getState().evaluation.features;
    expect([features.E.error?.code, features.Q.error?.code, features.T.error?.code]).toEqual(['brokenReference', 'brokenReference', 'brokenReference']);
  });
});
