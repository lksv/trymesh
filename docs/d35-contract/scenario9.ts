// NÁVRH: validační scénář 9 (docs/requirements.md) zapsaný jako příkazy proti návrhu kontraktu.
// Nespouští se, jen se typově kontroluje: npx tsc -p docs/d35-contract/tsconfig.json
// Účel: prověřit kontrakt. Krok, který nejde zapsat, je díra v návrhu. Po implementaci se z něj
// stane skutečný test v packages/scenarios. Očekávání jsou v komentářích „čekáme".
// Úhly jsou v radiánech v čísle i ve výrazu; stupně se píšou funkcí deg().
import { sketchTool } from './contract';
import type { BodyId, Command, Constraint, Engine, EngineState, Extent, FixedInput, Id, Input, PatternFeature, PlaneRef, ProfileSource, SketchFeature } from './contract';

declare const engine: Engine;

// ---------------------------------------------------------------- pomůcky

const XY: PlaneRef = { kind: 'base', plane: 'XY' };

function run(...commands: Command[]): EngineState {
  let state = engine.getState();
  for (const command of commands) {
    const result = engine.execute(command);
    if (!result.ok) throw new Error(`${command.type}: ${result.error.message}`);
    state = result.state;
  }
  return state;
}
const batch = (...commands: Command[]): Command => ({ type: 'batch', commands });

const sketch = (id: Id): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'sketch', plane: XY, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } },
});
const point = (sk: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: sk, id, x, y });
const circle = (sk: Id, id: Id, center: Id, radius: number, construction = false): Command => ({
  type: 'addCurve',
  sketch: sk,
  id,
  curve: { type: 'circle', center, ...(construction ? { construction: true } : {}) },
  radius,
});
const constrain = (sk: Id, id: Id, constraint: Input<Constraint> | FixedInput): Command => ({ type: 'addConstraint', sketch: sk, id, constraint });
// kóta: číslo, nebo výraz
const dim = (sk: Id, id: Id, shape: object, value: number | string): Command => constrain(sk, id, { ...shape, value, driving: true } as Input<Constraint>);
// bod na souřadnicích vůči počátku skici
const at = (sk: Id, p: Id, x: number | string, y: number | string): Command[] => [
  dim(sk, `${p}x`, { type: 'horizontalDistance', a: 'origin', b: p }, x),
  dim(sk, `${p}y`, { type: 'verticalDistance', a: 'origin', b: p }, y),
];

const regions = (sk: Id, ...loops: Id[][]): ProfileSource => ({ type: 'regions', sketch: sk, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
const span = (start: number | string, distance: number | string): Input<Extent> => ({ type: 'distance', start, distance });
const through = (side: 'forward' | 'backward' | 'both'): Extent => ({ type: 'throughAll', side });

function extrude(id: Id, operation: 'new' | 'add' | 'cut', profile: Input<ProfileSource>, extent: Input<Extent>, targets?: BodyId[]): Command {
  return { type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) } };
}
// ozubení nad roztečnou kružnicí skici kol
function gear(circleId: Id, teeth: string, internal: boolean, meshWith?: Id): Input<ProfileSource> {
  return {
    type: 'generated',
    generator: 'involuteGear',
    sketch: 'skGears',
    operands: { circle: circleId },
    params: { teeth, pressureAngle: 'deg(20)', backlash: 'vule', rotation: 0, internal },
    ...(meshWith ? { refs: { meshWith } } : {}),
  };
}
// kruhové pole po celém kruhu kolem osy Z modelu
function around(id: Id, source: PatternFeature['source'], count: number | string): Command {
  return {
    type: 'addFeature',
    feature: { id, name: id, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count, span: { type: 'full' } } },
  };
}
const sketchOf = (id: Id): SketchFeature => engine.getState().document.features.find((f): f is SketchFeature => f.id === id && f.type === 'sketch') as SketchFeature;
// ID musí být jedinečná v celém dokumentu (features i entity všech skic), proto vlastní předpona
let counter = 0;
const newId = (prefix: string): Id => `hex_${prefix}${++counter}`;

// ---------------------------------------------------------------- a) parametry, kontroly, skica kol

export function parametersAndGearSketch(): void {
  run(
    { type: 'setParameter', name: 'modul', expr: '0.9' },
    { type: 'setParameter', name: 'Zs', expr: '18' },
    { type: 'setParameter', name: 'Zp', expr: '27' },
    { type: 'setParameter', name: 'Zr', expr: 'Zs + 2 * Zp' },
    { type: 'setParameter', name: 'vule', expr: '0.05' },
    { type: 'setParameter', name: 'osa', expr: 'modul * (Zs + Zp) / 2' },
    { type: 'setCheck', name: 'šrouby do rotoru jdou zasunout', expr: 'modul * (Zs / 2 + 1) < 12.75' },
    { type: 'setCheck', name: 'kopie satelitu v záběru se sluncem', expr: 'Zs % 3 == 0' },
    { type: 'setCheck', name: 'kopie satelitu v záběru s korunou', expr: 'Zr % 3 == 0' },
    // středy sousedních satelitů jsou od sebe osa · √3, hlavový průměr satelitu je modul · (Zp + 2)
    { type: 'setCheck', name: 'sousední satelity se nepotkají', expr: 'osa * sqrt(3) > modul * (Zp + 2)' },
  );
  // Roztečné kružnice jsou konstrukční (dotýkají se). Běžné křivky: díra satelitu `ph`, čep `pin`
  // (soustředný, o 0,15 mm menší) a díra pro středicí čep `sb`.
  const state = run(
    sketch('skGears'),
    batch(
      point('skGears', 'cp', 20, 1),
      circle('skGears', 's', 'origin', 8, true),
      circle('skGears', 'p', 'cp', 12, true),
      circle('skGears', 'r', 'origin', 32, true),
      circle('skGears', 'ph', 'cp', 2.6),
      circle('skGears', 'pin', 'cp', 2.4),
      circle('skGears', 'sb', 'origin', 1.5),
      constrain('skGears', 'tsp', { type: 'tangent', a: 's', b: 'p' }),
      dim('skGears', 'cpy', { type: 'verticalDistance', a: 'origin', b: 'cp' }, 0),
      dim('skGears', 'ds', { type: 'diameter', curve: 's' }, 'modul * Zs'),
      dim('skGears', 'dp', { type: 'diameter', curve: 'p' }, 'modul * Zp'),
      dim('skGears', 'dr', { type: 'diameter', curve: 'r' }, 'modul * Zr'),
      dim('skGears', 'dph', { type: 'diameter', curve: 'ph' }, 5.3),
      dim('skGears', 'dpin', { type: 'diameter', curve: 'pin' }, 5),
      dim('skGears', 'dsb', { type: 'diameter', curve: 'sb' }, 3.2),
    ),
  );
  // čekáme: skica plně určená, profil platný, oblasti [ph], [pin], [sb]; střed satelitu x = 20,25
  void state.evaluation.features.skGears.sketch?.degreesOfFreedom;
  // čekáme: všechny čtyři kontroly 'ok'; parametr Zr má hodnotu 72, osa 20,25
  void state.evaluation.checks['šrouby do rotoru jdou zasunout'].status;
  void state.evaluation.parameters.Zr;
  // čekáme: výraz kóty je v dokumentu pod adresou pole a číslo je vyhodnocená hodnota
  void sketchOf('skGears').expressions?.['constraints/ds/value'];
}

// ---------------------------------------------------------------- f) zadní deska, h) motor

export function plateAndMotor(): void {
  run(sketch('skPlate'), batch(circle('skPlate', 'pl', 'origin', 50), dim('skPlate', 'dpl', { type: 'diameter', curve: 'pl' }, 110)), extrude('plate', 'new', regions('skPlate', ['pl']), span(-5, 5)));
  run(sketch('skMotor'), batch(circle('skMotor', 'mo', 'origin', 40), dim('skMotor', 'dmo', { type: 'diameter', curve: 'mo' }, 90)), extrude('motor', 'new', regions('skMotor', ['mo']), span(0, 26.5)));

  // díry v desce: jedna M4 pro pole, středový otvor a šest děr řídicí jednotky
  const left: [Id, number, number][] = [
    ['k1', -28.3, 25.75],
    ['k2', -28.3, 1.75],
    ['k3', -28.3, -25.75],
  ];
  run(
    sketch('skPlateHoles'),
    batch(
      point('skPlateHoles', 'c4', 19, 1),
      circle('skPlateHoles', 'm4', 'c4', 2),
      ...at('skPlateHoles', 'c4', 20, 0),
      dim('skPlateHoles', 'dm4', { type: 'diameter', curve: 'm4' }, 4.5),
      circle('skPlateHoles', 'c20', 'origin', 9),
      dim('skPlateHoles', 'dc20', { type: 'diameter', curve: 'c20' }, 20),
      // svislá osa souměrnosti: konec drží pevný bod
      point('skPlateHoles', 'ax', 0.5, 39),
      { type: 'addCurve', sketch: 'skPlateHoles', id: 'axis', curve: { type: 'line', a: 'origin', b: 'ax', construction: true } },
      constrain('skPlateHoles', 'fax', { type: 'fixed', point: 'ax', x: 0, y: 40 }),
      // levá trojice: pevné body na souřadnicích z výkresu
      ...left.flatMap(([id, x, y], i): Command[] => [
        point('skPlateHoles', id, x + 0.4, y - 0.3),
        circle('skPlateHoles', `q${i + 1}`, id, 1.5),
        constrain('skPlateHoles', `f${id}`, { type: 'fixed', point: id, x, y }),
      ]),
      // pravá trojice: souměrně podle osy
      ...left.flatMap(([id, x, y], i): Command[] => [
        point('skPlateHoles', `k${i + 4}`, -x + 0.3, y + 0.2),
        circle('skPlateHoles', `q${i + 4}`, `k${i + 4}`, 1.5),
        constrain('skPlateHoles', `s${i + 4}`, { type: 'symmetric', a: id, b: `k${i + 4}`, line: 'axis' }),
      ]),
      ...[2, 3, 4, 5, 6].map((i) => constrain('skPlateHoles', `e${i}`, { type: 'equalRadius', a: 'q1', b: `q${i}` })),
      dim('skPlateHoles', 'dq', { type: 'diameter', curve: 'q1' }, 3.3),
    ),
  );
  // čekáme: skica plně určená (volnost 0), žádná vazba navíc
  void engine.diagnoseSketch('skPlateHoles').degreesOfFreedom;

  // deska leží pod rovinou skici, proto 'backward'
  run(
    extrude('m4hole', 'cut', regions('skPlateHoles', ['m4']), through('backward'), ['plate']),
    around('m4holes', { type: 'features', features: ['m4hole'] }, 4),
    extrude('plateHoles', 'cut', regions('skPlateHoles', ['c20'], ['q1'], ['q2'], ['q3'], ['q4'], ['q5'], ['q6']), through('backward'), ['plate']),
  );
}

// ---------------------------------------------------------------- d) centrální kolo, b) c) satelity

export function sunAndPlanets(): void {
  run(
    sketch('skFlange'),
    batch(circle('skFlange', 'fl', 'origin', 19), dim('skFlange', 'dfl', { type: 'diameter', curve: 'fl' }, 40)),
    extrude('sun', 'new', regions('skFlange', ['fl']), span(26.5, 4)),
    // ozubení přidané k přírubě; první kolo v řetězu, natočení číslem
    extrude('sunTeeth', 'add', gear('s', 'Zs', false), span(30.5, 15.5), ['sun']),
    extrude('sunBore', 'cut', regions('skGears', ['sb']), through('forward'), ['sun']),
    sketch('skFlangeHoles'),
    batch(point('skFlangeHoles', 'c3', 15, 1), circle('skFlangeHoles', 'h3', 'c3', 1.5), ...at('skFlangeHoles', 'c3', 15.5, 0), dim('skFlangeHoles', 'dh3', { type: 'diameter', curve: 'h3' }, 3.4)),
    extrude('flangeHole', 'cut', regions('skFlangeHoles', ['h3']), through('forward'), ['sun']),
    around('flangeHoles', { type: 'features', features: ['flangeHole'] }, 4),
  );
  const state = run(
    // satelit: natočení ze záběru s centrálním kolem; díra je mezikruží [ph] a kruh [pin] dohromady
    extrude('planet', 'new', gear('p', 'Zp', false, 'sunTeeth'), span(34, 12)),
    extrude('planetHole', 'cut', regions('skGears', ['ph'], ['pin']), through('forward'), ['planet']),
    around('planets', { type: 'body', body: 'planet' }, 3),
  );
  // čekáme: pole vytvořilo tělesa planets/1 a planets/2; originál planet zůstává
  void state.evaluation.features.planets.bodies;
  // čekáme: boční stěna ozubení má jméno { feature: 'planet', role: 'side', curve: 'teeth' },
  // u kopie navíc copy: [{ pattern: 'planets', index: 1 }]
  void state.evaluation.faceNames;
}

// ---------------------------------------------------------------- e) pouzdro s korunou, spoj s deskou

export function housingAndBolts(): void {
  run(
    sketch('skHousing'),
    batch(
      circle('skHousing', 'ho', 'origin', 54),
      circle('skHousing', 'hb', 'origin', 45),
      dim('skHousing', 'dho', { type: 'diameter', curve: 'ho' }, 110),
      dim('skHousing', 'dhb', { type: 'diameter', curve: 'hb' }, 92),
    ),
    // plný válec = mezikruží [ho] a kruh [hb]; pak vybrání pro motor
    extrude('housing', 'new', regions('skHousing', ['ho'], ['hb']), span(0, 46)),
    extrude('motorBore', 'cut', regions('skHousing', ['hb']), span(0, 28), ['housing']),
    // koruna: vnitřní profil skrz vše do plného materiálu nad motorem, natočení ze záběru se satelitem
    extrude('ring', 'cut', gear('r', 'Zr', true, 'planet'), through('forward'), ['housing']),
  );

  // šroub M3 skrz desku i pouzdro a zapuštění matice na čele pouzdra
  run(sketch('skBolts'), batch(point('skBolts', 'cb', 50, 1), circle('skBolts', 'bh', 'cb', 1.5), ...at('skBolts', 'cb', 50.5, 0), dim('skBolts', 'dbh', { type: 'diameter', curve: 'bh' }, 3.4)));
  const hex = sketchTool(
    'polygon',
    { sketch: sketchOf('skBolts'), result: engine.getState().evaluation.features.skBolts.sketch },
    { center: { at: [50.5, 0], snap: { kind: 'point', id: 'cb' } }, vertex: { at: [53.7, 0.2] }, sides: 6, sizeKind: 'acrossFlats', size: 5.5 },
    newId,
  );
  if (!hex.ok) throw new Error(hex.message);
  run(
    // points[0] je bod `vertex` (vpravo od středu), lines[1] vede z points[1] do points[2]: horní strana
    batch(...hex.commands, constrain('skBolts', 'hexDirection', { type: 'horizontal', line: hex.ids.lines[1] })),
    // rovina skici leží mezi deskou a pouzdrem, proto 'both' a dva cíle
    extrude('boltHole', 'cut', regions('skBolts', ['bh']), through('both'), ['plate', 'housing']),
    extrude('nutPocket', 'cut', regions('skBolts', hex.ids.lines, ['bh']), span(43, 3), ['housing']),
    around('bolts', { type: 'features', features: ['boltHole', 'nutPocket'] }, 6),
  );
}

// ---------------------------------------------------------------- g) unašeč

export function carrier(): void {
  run(
    sketch('skCarrier'),
    batch(circle('skCarrier', 'cd', 'origin', 29), dim('skCarrier', 'dcd', { type: 'diameter', curve: 'cd' }, 60)),
    extrude('carrier', 'new', regions('skCarrier', ['cd']), span(46.5, 5)),
    // čep ze skici kol: leží ve středu satelitu, tedy na poloměru osové vzdálenosti
    extrude('carrierPin', 'add', regions('skGears', ['pin']), span(34, 12.5), ['carrier']),
    around('carrierPins', { type: 'features', features: ['carrierPin'] }, 3),
  );
}

// ---------------------------------------------------------------- i) změna převodu, j) kolize, k) export

// Všechny features jsou 'ok': žádná chyba, žádné varování (noEffect by znamenalo díru, která
// neprochází, gearMesh kola mimo záběr). Skici smějí mít jen stav 'ok'.
const allOk = (state: EngineState): boolean => Object.values(state.evaluation.features).every((f) => f.status === 'ok');
const noCollision = (): boolean => {
  const report = engine.interference();
  return report.pairs.length === 0 && report.failed.length === 0;
};

export function changesAndChecks(): void {
  // čekáme: žádná kolize ve výchozím stavu a žádná dvojice, kterou se nepodařilo spočítat
  void noCollision();

  // převod 5 → 4 se stejnou korunou
  let state = run(batch({ type: 'setParameter', name: 'Zs', expr: '24' }, { type: 'setParameter', name: 'Zp', expr: '24' }));
  // čekáme: vše 'ok', kontroly 'ok', žádná kolize, střed satelitu x = 21,6
  void allOk(state);
  void noCollision();

  // převod 5 → 6 s větší korunou
  state = run(batch({ type: 'setParameter', name: 'Zs', expr: '18' }, { type: 'setParameter', name: 'Zp', expr: '36' }));
  // čekáme: Zr = 90, koruna se vejde do pouzdra, vše 'ok', žádná kolize
  void state.evaluation.parameters.Zr;
  void allOk(state);
  void noCollision();
  // čekáme: údaje ozubení jsou ve výsledku feature (modul 0,9; roztečný průměr koruny 81)
  void state.evaluation.features.ring.facts;

  // kontrola parametrů: modul 1 při Zs = 24 dá hlavový poloměr 13 mm
  state = run(batch({ type: 'setParameter', name: 'Zs', expr: '24' }, { type: 'setParameter', name: 'Zp', expr: '24' }, { type: 'setParameter', name: 'modul', expr: '1' }));
  // čekáme: kontrola 'failed', model se přepočítal
  void state.evaluation.checks['šrouby do rotoru jdou zasunout'].status;
  engine.undo();

  // záměrně příliš velký satelit: roztečná kružnice o 1 mm větší, než odpovídá počtu zubů
  run({ type: 'setField', feature: 'skGears', path: 'constraints/dp/value', value: 'modul * Zp + 1' });
  // čekáme: kolize satelitu s korunou; varování gearMesh u satelitu (jeho modul se liší od modulu
  // centrálního kola) i u koruny (kružnice nejsou tečné, moduly se liší)
  void engine.interference({ bodies: ['planet', 'housing'] }).pairs;
  engine.undo();

  // chybný výraz u vysunutí: smazaný parametr dá chybu feature, která jde opravit
  state = run({ type: 'removeParameter', name: 'vule' });
  // čekáme: vysunutí s ozubením ve stavu error (invalidExpression), fieldErrors u pole profile/params/backlash
  void state.evaluation.features.sunTeeth.fieldErrors?.['profile/params/backlash'];
  engine.undo();

  // chybný výraz u skici: varování, skica se spočítá s poslední platnou hodnotou a jde otevřít
  state = run({ type: 'removeParameter', name: 'modul' });
  // čekáme: skGears ve stavu warning (invalidExpression), má rovinu i vyřešenou skicu; kontroly a
  // parametr osa ve stavu error (dependsOnError); tělesa beze změny
  void state.evaluation.features.skGears.sketch;
  void state.evaluation.parameters.osa;
  engine.undo();

  // export po tělesech: odvozená ID kopií se čtou z výsledku pole
  state = engine.getState();
  const bodies: BodyId[] = ['sun', 'planet', ...state.evaluation.features.planets.bodies, 'housing', 'plate', 'carrier'];
  for (const body of bodies) void engine.exportMesh('stl', [body]);
  const saved = engine.save();
  void engine.load(saved);
  // čekáme: po načtení stejný dokument i stejný výsledek přepočtu
}

// ---------------------------------------------------------------- co scénář 9 nepotřebuje, ale kontrakt slibuje

// Není součástí slovního scénáře. Zkouší zápis příkazů, které by jinak zůstaly neověřené.
declare const documentVersion1: string;

export function contractCoverage(): void {
  // slučovací změna: jen tloušťka příruby, začátek 26,5 zůstává
  run({ type: 'updateFeature', id: 'sun', patch: { extent: { distance: 5 } } });
  // jen natočení ozubení; výrazy počtu zubů a vůle zůstávají
  run({ type: 'updateFeature', id: 'sunTeeth', patch: { profile: { params: { rotation: 'deg(5)' } } } });
  // jiná varianta rozsahu nahrazuje dosavadní a musí být úplná; výraz pole extent/distance zaniká
  void engine.preview({ type: 'updateFeature', id: 'motorBore', patch: { extent: { type: 'throughAll', side: 'forward' } } });
  // změna na nové těleso odebere cíle sama; null odebírá nepovinné pole výslovně
  void engine.preview({ type: 'updateFeature', id: 'carrierPin', patch: { operation: 'new' } });
  void engine.preview({ type: 'updateFeature', id: 'carrierPin', patch: { operation: 'new', targets: null } });
  // null ve slovníku odebere jeden odkaz; koruna pak použije číslo natočení
  void engine.preview({ type: 'updateFeature', id: 'ring', patch: { profile: { refs: { meshWith: null } } } });
  // odkaz (osa, rovina) se nahrazuje vždy celý
  void engine.preview({ type: 'updateFeature', id: 'planets', patch: { transform: { axis: { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' } } } });
  // jméno kontroly je volný text; přejmenování zachová pořadí
  void engine.preview({ type: 'renameCheck', name: 'sousední satelity se nepotkají', to: 'odstup satelitů' });

  // přejmenování parametru přepíše výrazy, které ho používají
  let state = run({ type: 'renameParameter', name: 'vule', to: 'vuleZubu' });
  void state.document.features.find((f) => f.id === 'sunTeeth')?.expressions?.['profile/params/backlash']; // čekáme: 'vuleZubu'

  // počet kopií výrazem; necelý počet je chyba pole, ne zaokrouhlení
  state = run({ type: 'setParameter', name: 'N', expr: '3' }, { type: 'setField', feature: 'planets', path: 'transform/count', value: 'N' });
  state = run({ type: 'setParameter', name: 'N', expr: '2.5' });
  void state.evaluation.features.planets.fieldErrors?.['transform/count']; // čekáme: notInteger; kopie těles zmizely
  engine.undo();

  // cyklus mezi parametry se přijme a ohlásí ve výsledku
  state = run({ type: 'setParameter', name: 'a', expr: 'b + 1' }, { type: 'setParameter', name: 'b', expr: 'a + 1' });
  void state.evaluation.parameters.a; // čekáme: chyba s kódem cycle
  run({ type: 'removeParameter', name: 'a' }, { type: 'removeParameter', name: 'b' });

  // syntaktická chyba je neplatný příkaz se strukturovanou chybou
  const bad = engine.execute({ type: 'setParameter', name: 'c', expr: '2 *' });
  if (!bad.ok) void bad.error.expression?.error.position;

  // pevný bod bez souřadnic: zamkne bod tam, kde je
  void engine.preview(batch(point('skCarrier', 'lock', 12, 7), constrain('skCarrier', 'flock', { type: 'fixed', point: 'lock' })));

  // náhled jednoho pole: hodnota je ve výsledku, dokument se nemění
  const preview = engine.preview({ type: 'setField', feature: 'carrier', path: 'extent/distance', value: 'modul * 6' });
  if (preview.ok) void preview.state.evaluation.features.carrier.values?.['extent/distance'];

  // pole kolem osy mimo osu modelu a s úhlem mezi první a poslední kopií
  void engine.preview({
    type: 'addFeature',
    feature: {
      id: 'holesAroundPlanet',
      name: 'holesAroundPlanet',
      suppressed: false,
      type: 'pattern',
      source: { type: 'features', features: ['flangeHole'] },
      transform: { type: 'circular', axis: { kind: 'sketchPoint', sketch: 'skGears', point: 'cp' }, count: 3, span: { type: 'angle', angle: 'deg(90)' } },
    },
  });

  // kopie tělesa je těleso jako každé jiné: skica na víku kopie
  void engine.preview({
    type: 'addFeature',
    feature: {
      id: 'skOnCopy',
      name: 'skOnCopy',
      suppressed: false,
      type: 'sketch',
      plane: { kind: 'face', body: 'planets/1', face: { feature: 'planet', role: 'endCap', copy: [{ pattern: 'planets', index: 1 }] } },
      points: {},
      radii: {},
      curves: {},
      constraints: {},
      external: {},
      solved: { inputs: '', external: {} },
    },
  });

  // dokument verze 1 se při načtení převede
  void engine.load(documentVersion1);
}
