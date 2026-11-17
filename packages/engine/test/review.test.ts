// Nálezy z revize enginu: případy, které dřív dávaly špatný výsledek nebo výjimku.
import { describe, expect, it } from 'vitest';
import { CommandError, applyCommand, emptyDocument, emptySketch, validateDocument } from '../src/document';
import { createEngine } from '../src/engine';
import { type Deps, type DragTarget, type EvaluateOptions, Evaluator, type Placement, type SketchState, type ToolRecipe, type Trace, type WriteBack } from '../src/evaluate';
import { FEATURE_TYPE_INFO, MAX_PATTERN_COUNT, atPath, bodyOwner, constraintKey, constraintOperands, constraintPath, curvePoints, derivedPoints, documentIds, duplicateOf, entityOf, featureInput, featureRefs, fieldsOf, isDimension, isDriving, withPath, SCHEMA_VERSION } from '../src/document';
import type { Entity, EntityKind, FeatureRef, FeatureTypeInfo, FieldInfo, RefKind } from '../src/document';
import { generatorOf, producesTool } from '../src/index';
import { DATA_CATALOGS, catalogTable } from '../src/data-catalogs';
import { type Move, movedOutline, nestingOf, outlineRegions, selectionOutline, wallOutline } from '../src/recompute/outline';
import type { Outline, ProfileProblem } from '../src/recompute/state';
import { type Region, type SketchGeometry, detectProfile } from '../src/sketch';
import { holeCounts } from '../src/query/parts-list';
import type { ArgSpecs } from '../src/query/args';
import { checkArgs } from '../src/query/check';
import type { EntityShape } from '../src/query/entity';
import { exactBetween } from '../src/query/measure';
import { closest } from '../src/mesh-distance';
import { type CutLoop, corners, nested } from '../src/query/section';
import { box, cutOf, moved, planeAt, regular, together, turned, prism } from './section-kit';
import { evaluateParameters } from '../src/expression';
import { piecesOfArc, sweepSlack } from '../src/export/outline';
import { QueryFailure } from '../src/query/spec';
import { decimals, float32Text, xmlText } from '../src/export/text';
import { BASE } from '../src/recompute/services';
import { Memo, queryContext } from '../src/query/context';
import { QUERIES } from '../src/query/index';
import { MAX_PROFILE_POINTS, generateProfile } from '../src/generators';
import { smallestCurvatureRadius } from '../src/generators/cycloid';
import type { Frame } from '../src/types';
import { POSE_STATS } from '../src/query/pose';
import type { QueryName } from '../src/query/spec';
import type { State } from '../src/recompute/state';
import { DOCUMENT_SECTIONS } from '../src/sections/index';
import { blockedText, poseNote } from '../src/sections/mechanism';
import { type FaceInfo, IDENTITY, analyzeBody } from '../src/solid';
import { interferenceReport, sharedBy } from '../src/interference';
import type { BodyResult, Id, Joint, Mechanism } from '../src/types';
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
    intersectionAsComputed: () => {
      throw new Error('the stand-in kernel has no intersection');
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
    refused(doc, to('A', 'PL'), /feature "PL" není a feature that names faces/);
    expect((feature(applyCommand(doc, to('A', 'H')), 'S2') as SketchFeature).external.x.edge.a.feature).toBe('H');
  });

  it('only an extrusion that adds or cuts is a source of a pattern or says so', () => {
    const doc = model();
    for (const id of ['PL', 'P', 'S1', 'A', 'G']) refused(doc, { type: 'addFeature', feature: pattern('P2', [id]) }, new RegExp(`feature "${id}" is not a feature that applies a tool \\(an extrusion with the operation add or cut, a hole\\)`));
    expect(doc.features.filter(producesTool).map((f) => f.id)).toEqual(['H']);
    expect(doc.features.map((f) => [f.id, generatorOf(f)]).filter(([, generator]) => generator !== undefined)).toEqual([['G', 'involuteGear']]);
  });

  it('the order of the registry and of the fields of a type is what clients were told', () => {
    expect(Object.keys(FEATURE_TYPE_INFO)).toEqual(['plane', 'sketch', 'extrude', 'pattern', 'hole']);
    refused(emptyDocument(), { type: 'addFeature', feature: { ...planeFeature, type: 'nope' } as unknown as PlaneFeature }, /čeká se jedna z hodnot plane, sketch, extrude, pattern, hole/);
    const paths = FEATURE_TYPE_INFO.extrude.fields.map((field) => field.path);
    expect(paths.slice(-5)).toEqual(['extent/start', 'extent/distance', 'extent/taper', 'extent/start', 'extent/gap']);
    // the offset of regions and the thickness of a wall (D44) come first, then the parameters of the generators
    expect(paths.slice(0, 2)).toEqual(['profile/offset', 'profile/thickness']);
    expect(paths.slice(2, -5).every((path) => path.startsWith('profile/params/'))).toBe(true);
    expect(paths.length).toBeGreaterThan(7);
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

// The review of D46 (package 2c of D36), what needs no adapter.
describe('the hardware catalogs: the review of D46', () => {
  it('catalogTable takes catalogs, not any object', () => {
    // @ts-expect-error a map of numbers is no map of catalogs
    const wrong = (): unknown => catalogTable({ nuts: 7 }, 'nuts');
    expect(typeof wrong).toBe('function');
    expect(catalogTable(DATA_CATALOGS, 'hexNuts', 'M3')).toMatchObject({ rows: { M3: { acrossFlats: 5.5 } } });
    // the source of the inserts says where its check differs and where it has none
    expect(DATA_CATALOGS.heatSetInserts.source).toMatch(/0\.1 mm smaller at 5 \(M3\) and 6 \(M4\)/);
    expect(DATA_CATALOGS.heatSetInserts.source).toMatch(/for M4 with an outer diameter of 5 and 5\.5 no second source/);
  });
});

describe('the mechanism: the review of D49', () => {
  // Boxes 10 × 10 × 10 from meshes written by hand, one link each, in a chain of continuous joints
  // about Z (or of prismatic joints along Z), asked through the context of a query with a kernel
  // that counts its booleans and finds nothing shared.
  const infos: FaceInfo[] = Array.from({ length: 6 }, () => ({ planar: true, origin: [0, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] }));
  const names = infos.map((_, i) => ({ feature: 'b', role: 'side', curve: String(i) }));
  const boxAt = (x: number, y: number): BodyResult => analyzeBody(prism([[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]], 0, 10, (side) => 2 + side), names as never, infos).result;
  const EMPTY: Solid = { positions: new Float32Array(0), triangles: new Uint32Array(0), faceIds: new Uint32Array(0) };
  let booleans = 0;
  const kernel = { boolean: () => (booleans++, EMPTY) } as unknown as SolidKernel;
  const memo = new Memo();
  // `ids` are the bodies, `perLink` how many bodies a link has; the joint `j<k>` moves the link `L<k>`
  const world = (ids: Id[], placed: (i: number) => BodyResult, perLink: number, joint: (k: number) => Joint) => {
    const bodies = Object.fromEntries(ids.map((id, i) => [id, placed(i)]));
    const links = Array.from({ length: Math.ceil(ids.length / perLink) }, (_, k) => `L${k}`);
    const section: Mechanism = {
      links: Object.fromEntries(links.map((link, k) => [link, { bodies: ids.slice(k * perLink, (k + 1) * perLink) }])),
      joints: Object.fromEntries(links.slice(1).map((link, k) => [`j${k + 1}`, { ...joint(k + 1), parent: links[k], child: link } as Joint])),
    };
    const document = { ...emptyDocument(), mechanism: section };
    const mechanism = DOCUMENT_SECTIONS.mechanism.evaluate(section, document, bodies, {}, { sketches: {} } as unknown as State).result;
    const evaluation = { bodies, faceSurfaces: [], faceNames: names, features: {}, parameters: {}, checks: {}, bodyProperties: {}, mechanism } as unknown as Evaluation;
    const internals = { document, state: { faceIds: new Map(), sketches: {} } as unknown as State };
    return (name: QueryName, args: object) => QUERIES[name].run(queryContext(name, evaluation, internals, { kernel, memo }), args as never);
  };

  it('a state asked again computes nothing, also with more links than eight (the memory of moved copies is sized by the links)', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `b${String(i).padStart(2, '0')}`);
    const ask = world(ids, () => boxAt(0, 0), 1, () => ({ type: 'continuous', parent: '', child: '', axis: { kind: 'base', axis: 'Z' }, value: 0.05 }) as Joint);
    booleans = 0;
    expect(ask('interference', { threshold: 0.001 })).toMatchObject({ checked: 66, pairs: [] });
    expect(booleans).toBe(66); // every pair overlaps
    booleans = 0;
    ask('interference', { threshold: 0.001 });
    expect(booleans).toBe(0);
  });

  it('a pair whose bodies are far apart in the pose builds no moved mesh, for the collisions and for the gap', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `b${String(i).padStart(2, '0')}`);
    const ask = world(ids, (i) => boxAt((i % 8) * 50, Math.floor(i / 8) * 50), 4, () => ({ type: 'prismatic', parent: '', child: '', axis: { kind: 'base', axis: 'Z' }, lower: 0, upper: 1000, value: 500 }) as Joint);
    const built = POSE_STATS.meshesMoved;
    booleans = 0;
    expect(ask('interference', { threshold: 0.001 })).toMatchObject({ checked: 780, pairs: [] });
    expect(ask('gap', { within: 5, maxPairs: 50 })).toMatchObject({ checked: 780, apart: 780 });
    expect([POSE_STATS.meshesMoved - built, booleans]).toEqual([0, 0]);
  });

  it('the note of a pose lists the joints that move the model, with the values they move it by', () => {
    const doc = base9({ ...ARM9, joints: { ...ARM9.joints, shoulder: { ...ARM9.joints.shoulder, value: 0.5 }, elbow: { ...ARM9.joints.elbow, value: 0.3 } } }, [{ name: 'q', expr: '3' }]);
    const layout = { sketches: { layout: { frame: BASE.XY, geometry: { points: { shoulder: { x: 0, y: 0 }, elbow: { x: 120, y: 0 } } } } } } as unknown as State;
    const of = (d: Document) => DOCUMENT_SECTIONS.mechanism.evaluate(d.mechanism, d, {}, evaluateParameters(d.parameters), layout).result;
    expect(poseNote(of(doc), doc.mechanism)).toEqual({ pose: { shoulder: 0.5, elbow: 0.3 } });
    // the elbow out of its limits by a parameter: in error, it moves nothing; the out-of-range number is not listed
    const out = { ...doc, mechanism: { ...doc.mechanism, joints: { ...doc.mechanism.joints, elbow: { ...doc.mechanism.joints.elbow, expressions: { value: 'q' } } } } };
    expect(poseNote(of(out), out.mechanism)).toEqual({ pose: { shoulder: 0.5 } });
    // the shoulder out of its limits: the elbow beyond it moves nothing a query reads either
    const blocked = { ...doc, mechanism: { ...doc.mechanism, joints: { ...doc.mechanism.joints, shoulder: { ...doc.mechanism.joints.shoulder, expressions: { value: 'q' } } } } };
    expect(poseNote(of(blocked), blocked.mechanism)).toBeUndefined();
  });

  it('a body beyond two joints without a motion: the text names both, the nearest the root first, and one step of its hint reads the body', () => {
    const turned = base9({ links: ARM9.links, joints: { shoulder: { ...ARM9.joints.elbow, parent: 'base', child: 'upper', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' }, value: 0.5 }, elbow: { ...ARM9.joints.elbow, value: 0.3 } } });
    const of = (d: Document) => DOCUMENT_SECTIONS.mechanism.evaluate(d.mechanism, d, {}, {}, { sketches: {} } as unknown as State).result;
    const text = blockedText(turned.mechanism, of(turned), 'forearm');
    expect(text).toMatch(/^the pose of the body "forearm" is not known: the joints "shoulder", "elbow" have no motion \("shoulder": brokenReference: .*; "elbow": brokenReference: .*\)\. The bodies beyond them can be read with these joints at zero, which writes nothing: after: \{ "type": "setPose", "values": \{ "shoulder": 0, "elbow": 0 \} \}; or as modelled/);
    const atZero = applyCommand(turned, { type: 'setPose', values: { shoulder: 0, elbow: 0 } });
    expect(of(atZero).links.forearm.blockedBy).toBeUndefined();
    // a joint whose limits do not allow zero: no hint of a pose, only the model as modelled
    const away = base9({ links: ARM9.links, joints: { shoulder: { ...ARM9.joints.elbow, parent: 'base', child: 'upper', lower: 0.2, upper: 1, value: 0.5 } } });
    expect(blockedText(away.mechanism, of(away), 'upper')).toMatch(/The bodies beyond it can be read as modelled with geometry: 'modelled'$/);
  });

  it('setPose with the expression the value already has keeps it without evaluation, as setJoint does', () => {
    const doc = applyCommand(base9(ARM9, [{ name: 'q', expr: '0.5' }]), { type: 'setPose', values: { elbow: 'q' } });
    const broken = applyCommand(doc, { type: 'removeParameter', name: 'q' });
    expect(applyCommand(broken, { type: 'setPose', values: { elbow: ' q ' } })).toBe(broken);
    expect(() => applyCommand(broken, { type: 'setPose', values: { elbow: 'q * 2' } })).toThrow(/unknown name "q"/);
  });

  it('the identity every root link shares as its transform cannot be changed', () => {
    expect([Object.isFrozen(IDENTITY), Object.isFrozen(IDENTITY.matrix), Object.isFrozen(IDENTITY.matrix[0]), Object.isFrozen(IDENTITY.translation)]).toEqual([true, true, true, true]);
    expect(() => {
      IDENTITY.translation[0] = 5;
    }).toThrow(TypeError);
  });
});

// The arm of the engine test of the mechanism: the extrusions `base`, `upper`, `forearm`, the sketch
// `layout`, and three links with two revolute joints, the elbow about a point of `layout`.
const extrusion9 = (id: string) => ({ id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 8 }, operation: 'new' });
const ARM9: Mechanism = {
  links: { base: { bodies: ['base'] }, upper: { bodies: ['upper'] }, forearm: { bodies: ['forearm'] } },
  joints: {
    shoulder: { type: 'revolute', parent: 'base', child: 'upper', axis: { kind: 'base', axis: 'Z' }, lower: -1, upper: 1, value: 0 },
    elbow: { type: 'revolute', parent: 'upper', child: 'forearm', axis: { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' }, lower: -2, upper: 2, value: 0 },
  },
};
const base9 = (mechanism: unknown, parameters: object[] = []): Document =>
  validateDocument({ ...JSON.parse(JSON.stringify(emptyDocument())), parameters, features: [extrusion9('base'), extrusion9('upper'), extrusion9('forearm'), { ...emptySketch('layout', 'layout', { kind: 'base', plane: 'XY' }), points: { shoulder: { x: 0, y: 0 }, elbow: { x: 120, y: 0 } } }], mechanism });

describe('the second opinion of the kernel: the review of D50', () => {
  // Two blocks 10 mm apart along X that overlap by 1 mm, from meshes written by hand, and a kernel
  // whose intersection answers with the block they share and counts its calls.
  const block = (x: number, width: number, face: number): Solid => prism([[x, 0], [x + width, 0], [x + width, 10], [x, 10]], 0, 10, () => face);
  const bodyOf = (solid: Solid, face: number): BodyResult => ({ solid, faces: [0, 1, face].map((id) => ({ id, planar: true })), edges: [], volume: 0, bounds: { min: [Math.min(...solid.positions.filter((_, i) => i % 3 === 0)), 0, 0], max: [Math.max(...solid.positions.filter((_, i) => i % 3 === 0)), 10, 10] } });
  const [a, b] = [bodyOf(block(0, 10, 2), 2), bodyOf(block(9, 10, 3), 3)];
  const calls = { boolean: 0, asComputed: 0 };
  const answering: SolidKernel = {
    boolean: () => (calls.boolean++, block(9, 1, 3)),
    intersectionAsComputed: () => (calls.asComputed++, { unverified: block(9, 1, 3) }),
    triangulate: () => new Uint32Array(),
  };
  const ask = (threshold: number) => interferenceReport({ A: a, B: b }, undefined, threshold, 0.01, () => ({ a, b }), (x, y) => sharedBy(answering, x, y, 0.01));

  it('a report of a pair the kernel answers has no field `cleared`, and the threshold moves the pair between no list and `pairs` without the second opinion', () => {
    const colliding = ask(0.001);
    expect(Object.keys(colliding)).toEqual(['pairs', 'fits', 'failed', 'checked']);
    expect(colliding.pairs).toEqual([{ a: 'A', b: 'B', volume: expect.closeTo(100, 4), depth: expect.closeTo(1, 4) }]);
    const below = ask(200);
    expect(Object.keys(below)).toEqual(['pairs', 'fits', 'failed', 'checked']);
    expect([below.pairs, below.fits, below.failed]).toEqual([[], [], []]);
    expect(calls).toEqual({ boolean: 2, asComputed: 0 });
  });
});

describe('the numbers, texts and arcs of an export: the review of D54', () => {
  it('decimals with no places keeps the zeros of a whole number', () => {
    expect([100, 1050, 0, -0, 2.5, -7].map((value) => decimals(value, 0))).toEqual(['100', '1050', '0', '0', '3', '-7']);
    expect(decimals(1.5, 3)).toBe('1.5');
  });

  it('float32Text refuses a finite number beyond the range of a float32 instead of writing "Infinity"', () => {
    for (const value of [1e39, -1e39]) expect(() => float32Text(value)).toThrow(QueryFailure);
  });

  it('a tab, a line feed or a carriage return in a name is written as a space, which lib3mf reads', () => {
    expect(xmlText('Lid\tA\nB\rC')).toBe('Lid A B C');
    expect(xmlText('x\ty')).not.toContain('&#');
  });

  it('the number of pieces of an arc allows for the precision of its ends', () => {
    const slack = sweepSlack(8.5e-5, 5); // a slot about 85 mm from the origin, radius 5
    for (const off of [-6.45e-7, 5.87e-7]) expect(piecesOfArc(Math.PI + off, slack)).toBe(2);
    expect(piecesOfArc(Math.PI + 5.87e-7)).toBe(3); // without it, as before the review
    expect(piecesOfArc(Math.PI + 0.01, slack)).toBe(3);
    expect(sweepSlack(1e-6, 0)).toBe(0);
  });
});

describe('the grid: the review of D53', () => {
  const XY = { kind: 'base', plane: 'XY' } as const;
  const X = { kind: 'base', axis: 'X' } as const;
  const Y = { kind: 'base', axis: 'Y' } as const;
  // a body A and a pattern P of it with the given transform
  const withPattern = (transform: object): Document => {
    const commands: Command[] = [
      { type: 'addFeature', feature: emptySketch('S', 'S', XY) },
      { type: 'addCurve', sketch: 'S', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      { type: 'addFeature', feature: { id: 'A', name: 'A', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'S', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } },
      { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'pattern', source: { type: 'body', body: 'A' }, transform } as never },
    ];
    return commands.reduce(applyCommand, emptyDocument());
  };
  const row = { type: 'linear', direction: X, count: 3, span: { type: 'spacing', spacing: 5 } };

  // the test of the fields checked only that each read field is listed, not the conditions
  it('the conditions of the registry give exactly the fields the validator reads, for every kind and both spans of a grid', () => {
    for (const transform of [
      row,
      { ...row, span: { type: 'length', length: 20 } },
      { ...row, second: { direction: Y, count: 2, span: { type: 'spacing', spacing: 7 } } },
      { ...row, span: { type: 'length', length: 20 }, second: { direction: Y, count: 2, span: { type: 'length', length: 30 } } },
      { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'angle', angle: 1 } },
      { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } },
    ]) {
      const f = withPattern(transform).features[2];
      const listed = FEATURE_TYPE_INFO.pattern.fields.filter((field) => !field.when || atPath(f, field.when.path) === field.when.equals);
      expect(fieldsOf(f).map((field) => [field.path, field.spec])).toEqual(listed.map((field) => [field.path, field.spec]));
    }
  });

  // `second: null` in a feature was refused with the Czech message of a generic object
  it('a feature with `second: null` is refused in English: a row leaves the field out', () => {
    expect(() => withPattern({ ...row, second: null })).toThrow(/transform\.second: an object \{ direction, count, span \} is expected; leave the field out for a row/);
    const doc = withPattern(row);
    const saved = JSON.parse(JSON.stringify(doc));
    saved.features[2].transform.second = null;
    expect(() => validateDocument(saved)).toThrow(/leave the field out for a row/);
    // removing it by a patch stays accepted
    expect(applyCommand(doc, { type: 'updateFeature', id: 'P', patch: { transform: { second: null } } } as Command).features[2]).toEqual(doc.features[2]);
  });
});

// ---------------------------------------------------------------- the parts list (D57)

describe('the review of D57: the count of holes', () => {
  type V = [number, number, number];
  const unit = (v: V): V => {
    const length = Math.hypot(...v);
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const crossOf = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const plus = (a: V, b: V, by = 1): V => [a[0] + by * b[0], a[1] + by * b[1], a[2] + by * b[2]];
  const doc = { ...emptyDocument(), features: [{ id: 'h', name: 'h', suppressed: false, type: 'hole' } as never] };
  // One cut per body: a triangle with two corners on the line and a surface of the given kind.
  interface Given {
    surface: { kind: 'cylinder'; origin: V; axis: V; radius: number } | { kind: 'cone'; apex: V; axis: V; halfAngle: number };
    corners: V[];
  }
  const inputs = (cuts: Given[]) => ({
    bodies: Object.fromEntries(cuts.map((cut, i) => [`b${i}`, { solid: { positions: Float32Array.from(cut.corners.flat()), triangles: Uint32Array.from([0, 1, 2]), faceIds: Uint32Array.from([i]) }, faces: [{ id: i }] }])),
    names: cuts.map((_, i) => ({ feature: 'h', role: 'holeBore' as const, point: `p${i}` })),
    surface: (_body: string, face: number) => cuts[face].surface,
  });
  const counted = (cuts: Given[]): number | undefined => {
    const { bodies, names, surface } = inputs(cuts);
    return holeCounts(doc, bodies, names, surface).get('h');
  };

  it('a surface point that is not finite is no cut, and the others are still joined', () => {
    const along = (z0: number): V[] => [[1, 0, z0], [1, 0, z0 + 5], [2, 0, z0 + 5]];
    for (const bad of [Infinity, NaN]) {
      const cuts: Given[] = [
        { surface: { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 1 }, corners: along(0) },
        { surface: { kind: 'cylinder', origin: [0, 0, 5], axis: [0, 0, 1], radius: 1 }, corners: along(5) },
        { surface: { kind: 'cylinder', origin: [bad, 0, 0], axis: [1, 0, 0], radius: 1 }, corners: along(0) },
      ];
      // before the fix the cut at infinity made the bound NaN and nothing was joined: 3
      expect(counted(cuts), String(bad)).toBe(1);
    }
  });

  it('the comparison of sorted lines counts as the comparison of all pairs: random near lines, leaning up to the tolerance, far along, far out', () => {
    // all pairs, written out as calls.ts of the design has them
    const reference = (cuts: Given[]): number => {
      const lines = cuts.map((cut) => {
        const point = cut.surface.kind === 'cylinder' ? cut.surface.origin : cut.surface.apex;
        const direction = unit(cut.surface.axis);
        let [from, to] = [Infinity, -Infinity];
        const reach: V = [0, 0, 0];
        for (const corner of cut.corners) {
          const at: V = [Math.fround(corner[0]), Math.fround(corner[1]), Math.fround(corner[2])];
          const t = (at[0] - point[0]) * direction[0] + (at[1] - point[1]) * direction[1] + (at[2] - point[2]) * direction[2];
          [from, to] = [Math.min(from, t), Math.max(to, t)];
          for (let axis = 0; axis < 3; axis++) reach[axis] = Math.max(reach[axis], Math.abs(at[axis]));
        }
        return { point, direction, from, to, reach };
      });
      type Line = (typeof lines)[number];
      const length = (v: V): number => Math.hypot(...v);
      const sameLine = (a: Line, b: Line): boolean => length(crossOf(a.direction, b.direction)) <= 1e-4 && length(crossOf(plus(b.point, a.point, -1), a.direction)) <= Math.max(1e-6, 1e-9 * Math.max(length(crossOf(a.point, a.direction)), length(crossOf(b.point, b.direction))));
      const touch = (a: Line, b: Line): boolean => {
        const offset = (b.point[0] - a.point[0]) * a.direction[0] + (b.point[1] - a.point[1]) * a.direction[1] + (b.point[2] - a.point[2]) * a.direction[2];
        const alike = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2] > 0;
        const [from, to] = alike ? [offset + b.from, offset + b.to] : [offset - b.to, offset - b.from];
        const precision = Math.max(1e-6, 1e-6 * a.direction.reduce((sum, part, axis) => sum + Math.abs(part) * Math.max(a.reach[axis], b.reach[axis]), 0));
        return from <= a.to + precision && a.from <= to + precision;
      };
      const group = lines.map((_, i) => i);
      const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
      for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) if (sameLine(lines[a], lines[b]) && touch(lines[a], lines[b])) group[find(a)] = find(b);
      return new Set(lines.map((_, i) => find(i))).size;
    };
    let seed = 1;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const direction = (): V => unit([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]);
    let joined = 0;
    for (let trial = 0; trial < 1500; trial++) {
      const far = [1, 1e3, 1e5, 1e7, 1e9][trial % 5];
      const base = direction();
      const middle: V = [(random() * 2 - 1) * far, (random() * 2 - 1) * far, (random() * 2 - 1) * far];
      const cuts: Given[] = Array.from({ length: 2 + Math.floor(random() * 8) }, (_, i) => {
        const lean = i === 0 || random() < 0.3 ? 0 : (random() < 0.5 ? 0.9999 : random()) * 1e-4;
        const about = unit(crossOf(base, direction()));
        let axis = plus([base[0] * Math.cos(lean), base[1] * Math.cos(lean), base[2] * Math.cos(lean)], crossOf(about, base), Math.sin(lean));
        if (random() < 0.5) axis = [-axis[0], -axis[1], -axis[2]];
        const precision = Math.max(1e-6, 1e-9 * far);
        const point = plus(plus(middle, base, (random() * 2 - 1) * far * 3), unit(crossOf(base, direction())), (random() < 0.5 ? 0.5 : random()) * precision);
        const half = far * 10 + 10;
        const corners = [plus(middle, axis, -half), plus(middle, axis, half), plus(plus(middle, axis, half), unit(crossOf(axis, [0.3, 0.5, 0.7])))];
        return { surface: random() < 0.5 ? { kind: 'cylinder', origin: point, axis, radius: 1 } : { kind: 'cone', apex: point, axis, halfAngle: 0.5 }, corners };
      });
      const expected = reference(cuts);
      if (expected < cuts.length) joined++;
      expect(counted(cuts), `trial ${trial}`).toBe(expected);
    }
    // the test tests something: most features join some of their cuts
    expect(joined).toBeGreaterThan(1000);
  });
});

describe('the review of D61: the generators of 5d', () => {
  const XY: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
  const disc = (params: Record<string, number>, chordTolerance = 0.01) => generateProfile('cycloidalDisc', { operands: { circle: { kind: 'circle', center: [0, 0], radius: params.R ?? 25 } }, params: { pins: 12, pinRadius: 2.5, eccentricity: 1, ...params }, refs: {}, frame: XY, chordTolerance });
  const pulley = (teeth: number, chordTolerance: number) => generateProfile('gt2Pulley', { operands: { center: { kind: 'point', at: [0, 0] } }, params: { teeth }, refs: {}, frame: XY, chordTolerance });

  it('a pulley too large is refused before its polygon exists, with the count it would have', () => {
    for (const tolerance of [1e-6, 1e-9, 1e-12]) {
      const started = performance.now();
      const result = pulley(500, tolerance);
      expect(performance.now() - started).toBeLessThan(50);
      expect(result.ok ? '' : result.message).toMatch(new RegExp(`the generated profile has \\d+ points, more than ${MAX_PROFILE_POINTS}; lower the number of grooves`));
    }
    // the count told beforehand is that of the polygon: the same points in every groove, and the
    // polygon at a tolerance where it is built has the count of its grooves times that
    const refused = pulley(500, 1e-4);
    expect(refused.ok ? 0 : Number(refused.message.match(/has (\d+) points/)?.[1]) % 500).toBe(0);
  });

  it('the disc at the edge of undercut builds; a hair closer it is refused near the limit, not past it', () => {
    const limit = smallestCurvatureRadius(25, 2, 12);
    const edge = disc({ eccentricity: 2, pinRadius: 2.5737 });
    expect(edge.ok).toBe(true);
    if (edge.ok) expect(25 - edge.regions[0].outer.xy[0]).toBeLessThan(limit);
    for (const hair of [1e-6, 1e-7, 1e-9]) {
      const result = disc({ eccentricity: 2, pinRadius: limit - hair });
      expect(result.ok ? '' : result.message).toMatch(/the disc is within the chord tolerance of the limit of undercut .* within 50000 points; lower the pin radius or the eccentricity/);
    }
  });

  it('a disc too fine for the limit of points says so without a count it did not reach, and without fewer than three pins', () => {
    const three = disc({ pins: 3, R: 10, pinRadius: 1, eccentricity: 0.5 }, 1e-9);
    expect(three.ok ? '' : three.message).toBe('the disc would need more than 50000 points to keep its chords within the chord tolerance; raise the chord tolerance');
    const many = disc({ pins: 500, R: 600, pinRadius: 2, eccentricity: 1 }, 1e-7);
    expect(many.ok ? '' : many.message).toMatch(/would need more than 50000 points .*raise the chord tolerance or lower the number of pins$/);
  });
});
