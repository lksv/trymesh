// Nálezy z revize enginu: případy, které dřív dávaly špatný výsledek nebo výjimku.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, emptySketch, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { type Deps, type DragTarget, type EvaluateOptions, Evaluator, type Placement, type SketchState, type ToolRecipe, type Trace, type WriteBack } from '../src/evaluate';
import { FEATURE_TYPE_INFO, MAX_PATTERN_COUNT, atPath, bodyOwner, constraintKey, constraintOperands, constraintPath, curvePoints, derivedPoints, documentIds, duplicateOf, entityOf, featureInput, featureRefs, fieldsOf, isDimension, isDriving, withPath, SCHEMA_VERSION } from '../src/document';
import type { Entity, EntityKind, FeatureRef, FeatureTypeInfo, FieldInfo, RefKind } from '../src/document';
import { generatorOf, producesTool } from '../src/index';
import { type Move, movedOutline, nestingOf, outlineRegions, selectionOutline, wallOutline } from '../src/recompute/outline';
import type { Outline, ProfileProblem } from '../src/recompute/state';
import { type Region, type SketchGeometry, detectProfile } from '../src/sketch';
import type { ArgSpecs } from '../src/query/args';
import { checkArgs } from '../src/query/check';
import type { EntityShape } from '../src/query/entity';
import { exactBetween } from '../src/query/measure';
import { closest } from '../src/mesh-distance';
import { type CutLoop, corners, nested } from '../src/query/section';
import { box, cutOf, moved, planeAt, regular, together, turned } from './section-kit';
import type { Command, Curve, Document, EngineState, Evaluation, ExtrudeFeature, Feature, Input, PatternFeature, PlaneFeature, SketchFeature, SketchSolver, Solid, SolidKernel, Vec3 } from '../src/types';

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

// The review of the move of the feature types into modules (D37, part 2) found no change of
// behaviour, and named what no test would have caught had there been one.
describe('a module per feature type (D37): what the move could have changed unseen', () => {
  const XY = { kind: 'base', plane: 'XY' } as const;
  const extrusion = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({
    id,
    name: id,
    suppressed: false,
    type: 'extrude',
    profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] },
    extent: { type: 'distance', start: 0, distance: 10 },
    operation: 'new',
    ...extra,
  });
  const planeFeature: PlaneFeature = { id: 'PL', name: 'PL', suppressed: false, type: 'plane', base: XY, offset: 5 };
  const pattern = (id: string, features: string[]): Input<PatternFeature> => ({ id, name: id, suppressed: false, type: 'pattern', source: { type: 'features', features }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } });
  const rim = (feature: string) => ({ a: { feature, role: 'side', curve: 'c' }, b: { feature, role: 'endCap' } }) as const;
  // S1 with a circle; the body A, a cut H into it, a plane, a pattern of the cut, a gear G; then
  // the sketch S2 with the rim of A projected, and a body Z after it.
  const model = (): Document =>
    apply([
      { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      { type: 'addFeature', feature: extrusion('A') },
      { type: 'addFeature', feature: extrusion('H', { operation: 'cut', targets: ['A'] }) },
      { type: 'addFeature', feature: planeFeature },
      { type: 'addFeature', feature: pattern('P', ['H']) },
      { type: 'addFeature', feature: extrusion('G', { profile: { type: 'generated', generator: 'involuteGear', sketch: 'S1', operands: { circle: 'c' }, params: { teeth: 10 } } }) },
      { type: 'addFeature', feature: emptySketch('S2', 'S2', XY) },
      { type: 'addExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body: 'A', edge: rim('A'), kind: 'circle' } },
      { type: 'addFeature', feature: extrusion('Z') },
    ]);
  const refused = (doc: Document, command: Command, message: RegExp) => expect(() => applyCommand(doc, command)).toThrow(message);
  const feature = (doc: Document, id: string): Feature => doc.features.find((f) => f.id === id) as Feature;

  it('updateExternal checks the reference against the place of its sketch', () => {
    const doc = model();
    const to = (body: string, source = body): Command => ({ type: 'updateExternal', sketch: 'S2', id: 'x', ref: { type: 'edge', body, edge: rim(source), kind: 'circle' } });
    refused(doc, to('Z'), /feature "Z" musí ležet před odkazující feature/);
    refused(doc, to('nope'), /feature "nope" neexistuje/);
    refused(doc, to('S1', 'A'), /feature "S1" není těleso/);
    refused(doc, to('A', 'PL'), /feature "PL" není extrude/);
    expect((feature(applyCommand(doc, to('A', 'H')), 'S2') as SketchFeature).external.x.edge.a.feature).toBe('H');
  });

  it('only an extrusion that adds or cuts is a source of a pattern or says so', () => {
    const doc = model();
    for (const id of ['PL', 'P', 'S1', 'A', 'G']) refused(doc, { type: 'addFeature', feature: pattern('P2', [id]) }, new RegExp(`feature "${id}" is not an extrusion with the operation add or cut`));
    expect(doc.features.filter(producesTool).map((f) => f.id)).toEqual(['H']);
    expect(doc.features.map((f) => [f.id, generatorOf(f)]).filter(([, generator]) => generator !== undefined)).toEqual([['G', 'involuteGear']]);
  });

  it('the order of the registry and of the fields of a type is what clients were told', () => {
    expect(Object.keys(FEATURE_TYPE_INFO)).toEqual(['plane', 'sketch', 'extrude', 'pattern']);
    refused(emptyDocument(), { type: 'addFeature', feature: { ...planeFeature, type: 'nope' } as unknown as PlaneFeature }, /čeká se jedna z hodnot plane, sketch, extrude, pattern/);
    const paths = FEATURE_TYPE_INFO.extrude.fields.map((field) => field.path);
    expect(paths.slice(-3)).toEqual(['extent/start', 'extent/distance', 'extent/taper']);
    // the offset of regions and the thickness of a wall (D44) come first, then the parameters of the generators
    expect(paths.slice(0, 2)).toEqual(['profile/offset', 'profile/thickness']);
    expect(paths.slice(2, -3).every((path) => path.startsWith('profile/params/'))).toBe(true);
    expect(paths.length).toBeGreaterThan(5);
    expect(FEATURE_TYPE_INFO.extrude.updatable).toEqual(['profile', 'extent', 'operation', 'targets']);
    expect(FEATURE_TYPE_INFO.plane.updatable).toEqual(['base', 'offset']);
    expect(FEATURE_TYPE_INFO.pattern.updatable).toEqual(['source', 'transform']);
    expect(FEATURE_TYPE_INFO.sketch.updatable).toEqual([]);
  });

  it('what document.ts and evaluate.ts exported before the move is still exported there', () => {
    // the types are checked by the compiler: this file imports each of them from its old path
    type Kept = [Deps, DragTarget, EvaluateOptions, Placement, SketchState, ToolRecipe, Trace, WriteBack, Entity, EntityKind, FeatureRef, FeatureTypeInfo, FieldInfo, RefKind];
    const kept: Kept | undefined = undefined;
    expect(kept).toBeUndefined();
    const values = { Evaluator, FEATURE_TYPE_INFO, MAX_PATTERN_COUNT, SCHEMA_VERSION, CommandError, applyCommand, atPath, bodyOwner, constraintKey, constraintOperands, constraintPath, curvePoints, derivedPoints, documentIds, duplicateOf, emptyDocument, emptySketch, entityOf, featureInput, featureRefs, fieldsOf, isDimension, isDriving, validateDocument, withPath };
    for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
  });
});

// Findings of the review of the registries (D37, parts 1 and 4).
describe('the checker of arguments', () => {
  const XY = { kind: 'base', plane: 'XY' } as const;
  const document = (
    [
      { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
      { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      { type: 'addConstraint', sketch: 'S1', id: 'r', constraint: { type: 'radius', curve: 'c', value: 5, driving: true } },
    ] as Command[]
  ).reduce(applyCommand, emptyDocument());
  const scope = { document, evaluation: { features: { S1: {} }, bodies: {}, faceNames: [] } as unknown as Evaluation };
  const problem = (specs: ArgSpecs, args: unknown) => {
    const checked = checkArgs(specs, args, scope);
    return checked.ok ? checked.value : [checked.code, checked.arg, checked.message];
  };
  const CONSTRAINT = { kind: 'constraint', of: 'sketch', title: 'C' } as const;
  const SKETCH = { kind: 'sketch', title: 'S' } as const;

  it('the sketch of a constraint inside a list, a record or an alternative is the argument next to that list', () => {
    const inList: ArgSpecs = { all: { kind: 'list', of: CONSTRAINT, title: 'All' }, sketch: SKETCH };
    expect(problem(inList, { all: ['r'], sketch: 'S1' })).toEqual({ all: ['r'], sketch: 'S1' });
    expect(problem(inList, { all: ['r'], sketch: 'nope' })).toEqual(['notAvailable', ['sketch'], 'sketch: the sketch "nope" is not in the state asked about']);
    expect(problem(inList, { all: ['r'] })).toEqual(['invalidArguments', ['sketch'], 'sketch: the argument is required']);
    expect(problem(inList, { all: ['nope'], sketch: 'S1' })).toEqual(['notAvailable', ['all', 0], 'all[0]: the sketch "S1" has no constraint "nope"']);
    const inRecord: ArgSpecs = { by: { kind: 'record', keys: 'text', of: CONSTRAINT, title: 'By' }, sketch: SKETCH };
    expect(problem(inRecord, { by: { a: 'r' }, sketch: 'nope' })).toEqual(['notAvailable', ['sketch'], expect.any(String)]);
    const inChoice: ArgSpecs = { pick: { kind: 'oneOf', options: { one: CONSTRAINT }, title: 'Pick' }, sketch: SKETCH };
    expect(problem(inChoice, { pick: { one: 'r' }, sketch: 'nope' })).toEqual(['notAvailable', ['sketch'], expect.any(String)]);
    // inside fields the sketch is among those fields, also when the constraint sits in a list of them
    const inRows: ArgSpecs = { rows: { kind: 'list', of: { kind: 'fields', fields: { cs: { kind: 'list', of: CONSTRAINT }, sketch: { kind: 'sketch' } } }, title: 'Rows' } };
    expect(problem(inRows, { rows: [{ cs: ['r'], sketch: 'S1' }] })).toEqual({ rows: [{ cs: ['r'], sketch: 'S1' }] });
    expect(problem(inRows, { rows: [{ cs: ['r'], sketch: 'nope' }] })).toEqual(['notAvailable', ['rows', 0, 'sketch'], 'rows[0].sketch: the sketch "nope" is not in the state asked about']);
  });

  it('a hole in a list or in a vector is refused', () => {
    expect(problem({ f: { kind: 'list', of: { kind: 'flag' }, title: 'F' } }, { f: [true, , false] })).toEqual(['invalidArguments', ['f', 1], 'f[1]: true or false is expected']);
    expect(problem({ v: { kind: 'vector', title: 'V' } }, { v: [1, , 3] })).toEqual(['invalidArguments', ['v'], 'v: three finite numbers are expected']);
    expect(problem({ v: { kind: 'vector', title: 'V' } }, { v: [1, 2, 3] })).toEqual({ v: [1, 2, 3] });
  });
});

// Findings of the review of D39 (the query `measure` and the distances on the mesh).
describe('measuring: the review of D39', () => {
  type Triangle = [Vec3, Vec3, Vec3];
  const mesh = (triangles: Triangle[], faces: number[]): Solid => ({
    positions: Float32Array.from(triangles.flat(2)),
    triangles: Uint32Array.from(triangles.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2])),
    faceIds: Uint32Array.from(faces),
  });
  const plane = (origin: Vec3, normal: Vec3): EntityShape => ({ is: 'plane', origin, normal });
  const line = (from: Vec3, direction: Vec3): EntityShape => ({ is: 'line', from, to: [from[0] + direction[0], from[1] + direction[1], from[2] + direction[2]], direction });
  const tilt = (angle: number): Vec3 => [Math.sin(angle), 0, Math.cos(angle)];

  it('what counts as parallel is measured the same whichever entity is named first', () => {
    // two planes 5e-5 rad apart whose origins lie a metre apart sideways
    for (const gap of [10, 0.01]) {
      const [a, b] = [plane([0, 0, 0], [0, 0, 1]), plane([1000, 0, gap], tilt(Math.PI - 5e-5))];
      const [there, back] = [exactBetween(a, b, 1e-6), exactBetween(b, a, 1e-6)];
      expect(back.distance).toBeCloseTo(there.distance as number, 9);
      expect(back.facing).toBe(there.facing);
      expect(there.facing).toBeDefined();
    }
    // two lines 5e-5 rad apart
    const [first, second] = [line([0, 0, 0], [0, 0, 1]), line([5, 0, 1000], tilt(5e-5))];
    expect(exactBetween(second, first, 1e-6).distance).toBeCloseTo(exactBetween(first, second, 1e-6).distance as number, 9);
    // the tolerance from both sides: at half of it two planes have a distance, at twice it they cross
    expect(exactBetween(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], tilt(5e-5)), 1e-6).distance).toBeCloseTo(5, 6);
    expect(exactBetween(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], tilt(2e-4)), 1e-6).distance).toBeUndefined();
    // planes that look opposite ways only roughly have no facing, and no distance
    expect(exactBetween(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], tilt((5 * Math.PI) / 6)), 1e-6)).toEqual({ angle: expect.closeTo((5 * Math.PI) / 6, 12) });
    // skew lines that are not at a right angle: the common perpendicular, not the offset of their points
    const skew = exactBetween(line([0, 0, 0], [1, 0, 0]), line([3, 7, 6], [Math.SQRT1_2, Math.SQRT1_2, 0]), 1e-6);
    expect(skew).toEqual({ distance: expect.closeTo(6, 12), angle: expect.closeTo(Math.PI / 4, 12) });
  });

  it('`within` is a bound: a pair further than it is not found, one exactly that far is', () => {
    const [low, high] = [mesh([[[0, 0, 0], [4, 0, 0], [0, 4, 0]]], [0]), mesh([[[0, 0, 3], [4, 0, 3], [0, 4, 3]]], [0])];
    expect(closest({ solid: low }, { solid: high }, 3 - 5e-7)).toBeUndefined();
    expect(closest({ solid: low }, { solid: high }, 3)?.distance).toBe(3);
  });

  it('the face named is among the pairs as close as the answer, whatever the order of the triangles', () => {
    // above the point: a triangle of face 1 that faces it, a hair further than the two that stand
    // edge-on over it (faces 2 and 3); the improvements are each smaller than the tolerance
    const facing: Triangle = [[-1, -1, 1.0000016], [0, 1, 1.0000016], [1, -1, 1.0000016]];
    const upright = (height: number): Triangle => [[0, 0, height], [1, 0, height + 1], [-1, 0, height + 1]];
    const found = closest({ point: [0, 0, 0] }, { solid: mesh([facing, upright(1.0000008), upright(1)], [1, 2, 3]) });
    expect(found?.distance).toBe(1);
    expect(found?.faceB).toBe(2); // faces 2 and 3 are equally edge-on: the smaller number; face 1 is too far
    // parts that touch: the faces of the pair at zero, not of one that was merely close before it
    const near: Triangle = [[-1, -1, 5e-7], [1, -1, 5e-7], [0, 1, 5e-7]];
    const touching: Triangle = [[0, 0, 0], [1, 0, 1], [-1, 0, 1]];
    expect(closest({ point: [0, 0, 0] }, { solid: mesh([near, touching], [9, 4]) })).toMatchObject({ distance: 0, faceB: 4 });
    // two faces that face the point equally (it lies on the bisector of their edge)
    const top: Triangle = [[0, 0, 10], [10, 0, 10], [10, 10, 10]];
    const side: Triangle = [[10, 0, 10], [10, 0, 0], [10, 10, 10]];
    expect(closest({ solid: mesh([top, side], [1, 5]) }, { point: [13, 5, 13] })?.faceA).toBe(1);
    expect(closest({ solid: mesh([side, top], [5, 1]) }, { point: [13, 5, 13] })?.faceA).toBe(1);
  });

  it('a triangle without an area is as close as its sides', () => {
    // two corners in one place: the closest point is on the side that is left
    expect(closest({ point: [2, 1, 0] }, { solid: mesh([[[0, 0, 0], [0, 0, 0], [5, 0, 0]]], [0]) })).toMatchObject({ distance: 1, b: [2, 0, 0] });
    // three corners in a line
    expect(closest({ point: [3, 0, 2] }, { solid: mesh([[[0, 0, 0], [2, 0, 0], [5, 0, 0]]], [0]) })).toMatchObject({ distance: 2, b: [3, 0, 0] });
    expect(closest({ point: [7, 0, 0] }, { solid: mesh([[[0, 0, 0], [2, 0, 0], [5, 0, 0]]], [0]) })?.distance).toBe(2);
  });
});

describe('the section: the review of D38', () => {
  type Vec2 = [number, number];
  const cornersOf = (chain: Vec2[], faces: number[], precision: number): Vec2[] | undefined => corners(chain, faces, precision)?.points as Vec2[] | undefined;

  it('a long straight run and a large loop on one face take a time that grows with their points, not with the square', () => {
    // a square of four faces with 5000 points on every side: 3.4 s before
    const side = (from: Vec2, to: Vec2): Vec2[] => Array.from({ length: 5000 }, (_, i): Vec2 => [from[0] + ((to[0] - from[0]) * i) / 5000, from[1] + ((to[1] - from[1]) * i) / 5000]);
    const straight = [...side([0, 0], [90, 0]), ...side([90, 0], [90, 90]), ...side([90, 90], [0, 90]), ...side([0, 90], [0, 0])];
    let started = performance.now();
    expect(cornersOf(straight, straight.map((_, i) => Math.floor(i / 5000)), 1e-6)).toEqual([[0, 0], [90, 0], [90, 90], [0, 90]]);
    expect(performance.now() - started).toBeLessThan(1000);
    // a loop on one face where every point is a corner (the teeth of a gear): 1.6 s for 20 000 points before
    const teeth = regular(20000, 100).map(([x, y], i): Vec2 => (i % 2 ? [x * 0.99, y * 0.99] : [x, y]));
    started = performance.now();
    expect(cornersOf(teeth, teeth.map(() => 0), 1e-6)).toHaveLength(20000);
    expect(performance.now() - started).toBeLessThan(1000);
    // and a loop of more points than a call takes arguments is no exception
    const fine = regular(130_000, 100);
    expect(cornersOf(fine, fine.map(() => 0), 1e-6)?.length).toBeGreaterThan(1000);
  });

  it('a point of the mesh in line beside a corner is never a corner, also where a loop on one face starts', () => {
    // a polygon of 36 sides with a point on every side just beside its corner: that point is as
    // far from the middle as the corner within the precision, and was taken as the start and kept
    const polygon = regular(36, 2.5);
    const withPointsBeside = (beside: number): Vec2[] =>
      polygon.flatMap((corner, i): Vec2[] => {
        const next = polygon[(i + 1) % 36];
        const length = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
        return [corner, [corner[0] + ((next[0] - corner[0]) * beside) / length, corner[1] + ((next[1] - corner[1]) * beside) / length]];
      });
    // 4.4e-4 beside: a corner is further than the precision from the segment past it, so the
    // corners are the 36 of the polygon (37 before, with the point the list started at)
    const chain = withPointsBeside(4.4e-4);
    for (const by of [0, 1, 17, 40]) {
      const kept = cornersOf(turned(chain, by), chain.map(() => 0), 5e-5) ?? [];
      expect(kept).toHaveLength(36);
      for (const point of kept) expect(polygon).toContainEqual(point);
    }
    // 2.2e-4 beside: a corner is within the precision of the segment to the point after it, so
    // that point may stand for it; still 36, and the same 36 wherever the chain starts
    const closer = withPointsBeside(2.2e-4);
    const kept = cornersOf(closer, closer.map(() => 0), 5e-5) ?? [];
    expect(kept).toHaveLength(36);
    for (const point of kept) expect(Math.min(...polygon.map((corner) => Math.hypot(corner[0] - point[0], corner[1] - point[1])))).toBeLessThan(2.3e-4);
    for (const by of [1, 17, 40]) expect(cornersOf(turned(closer, by), closer.map(() => 0), 5e-5)).toEqual(kept);
    // the start does not follow how a side is divided: a square, and the same with three points on its left side
    const square: Vec2[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const divided: Vec2[] = [[1, 1], [-1, 1], [-1, 0.5], [-1, 0], [-1, -0.5], [-1, -1], [1, -1]];
    expect(cornersOf(square, [0, 0, 0, 0], 1e-6)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
    expect(cornersOf(divided, divided.map(() => 0), 1e-6)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  });

  it('the corners do not depend on where the mesh starts the chain, also where points lie nearer than the precision', () => {
    // a corner of three points 0.7 of the precision apart, each on a face of its own: four corners
    // from one start and five from the others before
    const chain: Vec2[] = [[0, 0], [10, 0], [10.0007, 0], [10.0014, 0], [10, 10], [0, 10]];
    const faces = [0, 1, 2, 3, 4, 5];
    const loop = corners(chain, faces, 1e-3) as CutLoop;
    expect(loop.points).toEqual([[0, 0], [10, 0], [10.0014, 0], [10, 10], [0, 10]]);
    for (let by = 1; by < 6; by++) expect(corners(turned(chain, by), turned(faces, by), 1e-3)).toEqual(loop); // to the last digit, the area included
  });

  it('the furthest point is decided by the distances from the segment, not by the first point that fails or by the line', () => {
    // a later point holds after an earlier one fails
    expect(cornersOf([[0, 0], [1, 0.0007], [2, -0.0007], [3, 0], [3, 5], [0, 5]], [0, 0, 0, 1, 2, 3], 1e-3)).toEqual([[0, 0], [3, 0], [3, 5], [0, 5]]);
    // a spike: the point at its tip lies on the line of the segment back, and far from the segment
    expect(cornersOf([[0, 0], [5, 0], [2, 0.0005], [2, 3], [0, 3]], [0, 0, 1, 2, 3], 1e-3)).toEqual([[0, 0], [5, 0], [2, 0.0005], [2, 3], [0, 3]]);
    expect(cornersOf([[0, 0], [5, 0], [2, 0.0001], [3, 0.0001], [3, 3], [0, 3]], [0, 0, 0, 1, 2, 3], 1e-3)).toHaveLength(6); // the run doubles back twice
    // a change of face in line with its neighbours is kept
    expect(cornersOf([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]], [0, 1, 2, 3, 4], 1e-6)).toEqual([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]);
    // a point a rounding error over the precision from the kept one: the directions alone ruled
    // out the point after it, which the distances accept
    expect(cornersOf([[0, 0], [0.0010000000000000002, 0], [5.4e-11, -0.003], [10, 10], [-10, 10]], [0, 0, 0, 1, 2], 1e-3)).toHaveLength(4);
  });

  it('what is thinner than the precision is not a loop, and such a chain cannot fail the query as a hole in nothing', () => {
    // three corners in a line, each a change of face: an area of zero, taken for a hole before
    expect(corners([[0, 0], [5, 0], [10, 0]], [0, 1, 2], 1e-6)).toBeUndefined();
    expect(corners([[0, 0], [5, 2e-7], [10, 0], [5, -2e-7]], [0, 1, 2, 3], 1e-6)).toBeUndefined(); // a diamond 4e-7 wide
    expect(corners([[0, 0], [5, 2e-6], [10, 0], [5, -2e-6]], [0, 1, 2, 3], 1e-6)?.points).toHaveLength(4); // and one 4e-6 wide
    // a hole whose first point lies a rounding error outside its outer loop still finds it
    const outer: CutLoop = { points: [[0, 0], [10, 0], [10, 10], [0, 10]], faces: [0, 1, 2, 3], lengths: [10, 10, 10, 10], area: 100 };
    const hole: CutLoop = { points: [[-1e-12, 5], [3, 7], [3, 3]], faces: [4, 5, 6], lengths: [3.6, 4, 3.6], area: -6 };
    expect(nested([hole, outer])).toEqual([{ outer, holes: [hole] }]);
  });

  it('the loops of a body are in one order however the mesh lists them, also where their first points are a hair apart', () => {
    // three boxes whose first corners differ in u by 0.6 of the precision each, written in the six
    // possible orders: three different orders came back when two points were compared with a tolerance
    const boxes = [moved(box(), [0, 20, 0]), moved(box(), [1.8e-5, 10, 0]), moved(box(), [3.6e-5, 0, 0])];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const seen = orders.map((order) => cutOf(together(...order.map((i) => boxes[i])), planeAt(5)).map((loop) => Math.round(loop.points[0][1])));
    // the precision is 3e-5 (the boxes reach 30 mm): the first two are level in u, so the lower one
    // comes first; the third is further in u than the precision
    for (const order of seen) expect(order).toEqual([10, 20, 0]);
  });
});

// The review of D44 (package 2a of D36): the offset of a profile and a wall along curves.
describe('the offset of a profile and a wall (D44): findings of the review', () => {
  const MOVE: Move = { subject: 'The move', cure: 'Do something else.' };
  const flat = (points: Record<string, [number, number]>, curves: [string, Curve][]): SketchFeature => sketch(points, curves.map(([id, curve]): Entry => [id, curve]));
  const moved = (s: SketchFeature, d: number): Region[] | ProfileProblem => {
    const found = profile(s);
    expect(found.valid).toBe(true);
    const outline = selectionOutline(found.regions) as Outline;
    const there = movedOutline(outline, d, MOVE);
    return 'code' in there ? there : outlineRegions(there, nestingOf(outline), 0.01, MOVE);
  };
  const areaOf = (regions: Region[]): number => {
    const { xy } = regions[0].outer;
    let sum = 0;
    for (let i = 0; i < xy.length / 2; i++) {
      const j = (i + 1) % (xy.length / 2);
      sum += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1];
    }
    return sum / 2;
  };

  // A cusp: a line that ends where an arc touches it and the loop turns back. The old corner is the
  // point of contact, which lies on the axis the two candidates for the new corner mirror about; its
  // side was read from noise, so the offset was refused for an end point at y = 0 and at y = -1e-9
  // and built for y = +1e-9.
  it('a cusp between a line and an arc: the corner is on the side the loop goes on to', () => {
    for (const y of [0, 1e-9, -1e-9]) {
      // the wedge between the line y = 0 and a circle of radius 5 that touches it at the origin
      const s = flat({ a: [-8, 0], o: [0, y], c: [0, 5], q: [-5, 5] }, [['l', { type: 'line', a: 'a', b: 'o' }], ['r', { type: 'arc', center: 'c', start: 'q', end: 'o' }], ['back', { type: 'line', a: 'q', b: 'a' }]]);
      for (const d of [-0.2, -0.05]) {
        const regions = moved(s, d);
        expect('code' in regions ? regions.message : '', `y ${y}, d ${d}`).toBe('');
        if ('code' in regions) continue;
        // the new corner is where the line y = |d| meets the circle of radius 5 + |d|, on the side of the wedge
        const corner = -Math.sqrt((5 - d) ** 2 - (5 + d) ** 2);
        const at = regions[0].outer.exact?.find((curve) => curve.key === 'r');
        expect(at).toMatchObject({ type: 'arc', radius: 5 - d });
        expect(at?.type === 'arc' ? at.from[0] : NaN).toBeCloseTo(corner, 6);
        expect(areaOf(regions)).toBeGreaterThan(0);
        expect(areaOf(regions)).toBeLessThan(areaOf(moved(s, d / 2) as Region[]));
      }
      // outwards the line and the circle part
      expect(moved(s, 0.2)).toMatchObject({ code: 'invalidProfile', refs: ['l', 'r'], message: expect.stringMatching(/no longer meet/) });
    }
  });

  it('a cusp between two arcs', () => {
    // two circles of radius 5 that touch at the origin from both sides of the y axis, closed far above
    const s = flat({ o: [0, 0], cl: [-5, 0], cr: [5, 0], tl: [-5, 5], tr: [5, 5] }, [['left', { type: 'arc', center: 'cl', start: 'o', end: 'tl' }], ['right', { type: 'arc', center: 'cr', start: 'tr', end: 'o' }], ['top', { type: 'line', a: 'tl', b: 'tr' }]]);
    const regions = moved(s, -0.2);
    expect('code' in regions ? regions.message : '').toBe('');
    if ('code' in regions) return;
    // the loop passes both arcs clockwise, so they grow to 5.2 and meet at x = 0, y = +sqrt(5.2² − 5²),
    // above the old corner: the end of `left` as the loop passes it
    const corner = regions[0].outer.exact?.find((curve) => curve.key === 'left');
    expect(corner).toMatchObject({ type: 'arc', radius: 5.2, forward: false });
    expect(corner?.type === 'arc' ? corner.to : []).toEqual([expect.closeTo(0, 9), expect.closeTo(Math.sqrt(5.2 ** 2 - 25), 9)]);
    // outwards the circles shrink away from each other, and from the line above them
    expect(moved(s, 0.2)).toMatchObject({ code: 'invalidProfile', message: expect.stringMatching(/no longer meet/) });
  });

  // A wall refused by the tests of its polylines named the keys of its outline (`R|ab`, `E|e`) in the
  // message and in `refs`, where a caller expects curves of the sketch.
  it('a wall refused for its polylines names the curves of the sketch', () => {
    const wall = (s: SketchFeature, ids: string[], thickness: number): Region[] | ProfileProblem => {
      const found = wallOutline(s, geometry(s), ids, thickness, MOVE);
      return 'code' in found ? found : outlineRegions(found.outline, found.nesting, 0.01, MOVE, found.curveOf);
    };
    const line = (a: string, b: string): Curve => ({ type: 'line', a, b });
    // the last line crosses the first
    const cross = flat({ a: [0, 0], b: [20, 0], c: [20, 10], d: [10, 10], e: [10, -10] }, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['cd', line('c', 'd')], ['de', line('d', 'e')]]);
    expect(wall(cross, ['ab', 'bc', 'cd', 'de'], 1)).toMatchObject({ refs: ['ab', 'de'], message: expect.stringMatching(/makes the curves "ab", "de" touch or cross/) });
    // the free end of the chain comes back to within the thickness of its start: an end is named by its curve
    const back = flat({ a: [0, 0], b: [20, 0], c: [20, 10], d: [0.5, 10], e: [0.5, 0.9] }, [['ab', line('a', 'b')], ['bc', line('b', 'c')], ['cd', line('c', 'd')], ['de', line('d', 'e')]]);
    const refused = wall(back, ['ab', 'bc', 'cd', 'de'], 2) as ProfileProblem;
    expect(refused.code).toBe('invalidProfile');
    expect(refused.refs.every((ref) => ['ab', 'bc', 'cd', 'de'].includes(ref as string))).toBe(true);
    expect(refused.message).not.toMatch(/[RLE]\|/);
    // a wall thinner than the tolerance: the two sides of its one curve
    const thin = flat({ a: [0, 0], b: [20, 0] }, [['ab', line('a', 'b')]]);
    expect(wall(thin, ['ab'], 1e-7)).toMatchObject({ refs: ['ab'], message: expect.stringMatching(/the (two sides of the )?curve "ab"/) });
  });
});
