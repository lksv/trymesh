// Dokument: validace a provedení příkazů. Vše pracuje jen se strukturou dokumentu, bez přepočtu.
// Pravidla jsou v docs/architecture.md, sekce Příkazy.
import type {
  Command,
  Constraint,
  Curve,
  Document,
  EdgeName,
  ExternalRef,
  ExtrudeFeature,
  FaceName,
  Feature,
  Id,
  PlaneFeature,
  PlaneRef,
  Projected,
  RegionRef,
  SketchFeature,
} from './types';
import { CONSTRAINTS, type EntityKind, VALUE_RULES } from './catalog';
import { ORIGIN, canonicalEdge, faceKey, has } from './util';

export const SCHEMA_VERSION = 2;

export const emptyDocument = (): Document => ({ schemaVersion: SCHEMA_VERSION, settings: { chordTolerance: 0.01 }, parameters: [], checks: [], features: [] });

export const emptySketch = (id: Id, name: string, plane: PlaneRef): SketchFeature => ({
  id,
  name,
  suppressed: false,
  type: 'sketch',
  plane,
  points: {},
  radii: {},
  curves: {},
  constraints: {},
  external: {},
  solved: { inputs: '', external: {} },
});

// Neplatný příkaz nebo dokument. `commandIndex` říká, který příkaz dávky to byl.
export class CommandError extends Error {
  commandIndex?: number;
}
const fail = (message: string): never => {
  throw new CommandError(message);
};

// ---------------------------------------------------------------- základní kontroly

type Dict = Record<string, unknown>;
const isObject = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const object = (v: unknown, what: string): Dict => (isObject(v) ? v : fail(`${what}: čeká se objekt`));
const string = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(`${what}: čeká se řetězec`));
// Čísla dokumentu: konečná a v rozumném rozsahu (souřadnice tělesa jsou float32). Záporná nula
// se ukládá jako nula, aby se uložený a znovu načtený dokument nelišil.
const MAX_NUMBER = 1e9;
const finite = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${what}: čeká se konečné číslo`);
  if (Math.abs(v) > MAX_NUMBER) return fail(`${what}: číslo je mimo rozsah ±${MAX_NUMBER}`);
  return v + 0;
};
const boolean = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(`${what}: čeká se true nebo false`));
const oneOf = <T extends string>(v: unknown, options: readonly T[], what: string): T =>
  options.includes(v as T) ? (v as T) : fail(`${what}: čeká se jedna z hodnot ${options.join(', ')}`);

// ID generuje volající. Nesmí obsahovat `/` (odvozená ID promítnuté geometrie), nesmí být `origin`
// ani jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…): ID jsou klíče záznamů.
function newId(v: unknown, what: string): Id {
  const id = string(v, what);
  if (id === '' || id.includes('/') || id === ORIGIN || id in Object.prototype) fail(`${what}: ID "${id}" není přípustné`);
  return id;
}

// Všechna ID v dokumentu: features a entity všech skic.
function allIds(doc: Document): Set<Id> {
  const ids = new Set<Id>();
  for (const f of doc.features) {
    ids.add(f.id);
    if (f.type === 'sketch') for (const group of [f.points, f.curves, f.constraints, f.external]) for (const id of Object.keys(group)) ids.add(id);
  }
  return ids;
}
const sketchIds = (s: SketchFeature): Id[] => [s.points, s.curves, s.constraints, s.external].flatMap((group) => Object.keys(group));

// ---------------------------------------------------------------- jména a odkazy mezi features

function faceName(v: unknown, what: string): FaceName {
  const o = object(v, what);
  const feature = string(o.feature, `${what}.feature`);
  const role = oneOf(o.role, ['side', 'startCap', 'endCap'] as const, `${what}.role`);
  return role === 'side' ? { feature, role, curve: string(o.curve, `${what}.curve`) } : { feature, role };
}

function edgeName(v: unknown, what: string): EdgeName {
  const o = object(v, what);
  const edge = { a: faceName(o.a, `${what}.a`), b: faceName(o.b, `${what}.b`) };
  if (faceKey(edge.a) === faceKey(edge.b)) fail(`${what}: hrana je rozhraní dvou různých stěn`);
  return canonicalEdge(edge);
}

// Odkaz jedné feature na jinou. `path` je místo odkazu uvnitř feature (cesta oddělená lomítky).
export type RefKind = 'plane' | 'sketch' | 'body' | 'faceSource';
export interface FeatureRef {
  path: string;
  id: Id; // u `body` ID tělesa, jinak ID feature
  kind: RefKind;
}
const REF_LABEL: Record<RefKind, string> = { plane: 'rovina', sketch: 'skica', body: 'těleso', faceSource: 'extrude' };

// ID tělesa je ID feature, která ho vytvořila, nebo `<feature>/<místní jméno>`, když jich feature
// vytváří víc. Lomítko v ID zadaném volajícím být nesmí, takže rozklad je jednoznačný.
export function bodyOwner(body: Id): { feature: Id; local?: string } {
  const slash = body.indexOf('/');
  return slash < 0 ? { feature: body } : { feature: body.slice(0, slash), local: body.slice(slash + 1) };
}

// Kde odkaz nastavuje příkaz (`before` je index odkazující feature), musí cíl existovat, mít
// správný druh a ležet před ní. Při načítání dokumentu (`before` není) se ověřuje jen tvar:
// odkaz na feature, která v dokumentu není, vzniká povoleným smazáním.
function requireRef(doc: Document, before: number | undefined, ref: Pick<FeatureRef, 'id' | 'kind'>, what: string): void {
  if (before === undefined) return;
  const { feature, local } = ref.kind === 'body' ? bodyOwner(ref.id) : { feature: ref.id, local: undefined };
  const index = doc.features.findIndex((f) => f.id === feature);
  if (index < 0) fail(`${what}: feature "${ref.id}" neexistuje`);
  const target = doc.features[index];
  const spec = FEATURE_TYPES[target.type] as FeatureTypeSpec<Feature>;
  const accepted = ref.kind === 'body' ? spec.createsBody(target, local) : ref.kind === 'faceSource' ? spec.namesFaces : target.type === ref.kind;
  if (!accepted) fail(`${what}: feature "${ref.id}" není ${REF_LABEL[ref.kind]}`);
  if (index >= before) fail(`${what}: feature "${ref.id}" musí ležet před odkazující feature`);
}

function planeRef(doc: Document, before: number | undefined, v: unknown, what: string): PlaneRef {
  const o = object(v, what);
  const kind = oneOf(o.kind, ['base', 'plane', 'face'] as const, `${what}.kind`);
  if (kind === 'base') return { kind, plane: oneOf(o.plane, ['XY', 'XZ', 'YZ'] as const, `${what}.plane`) };
  if (kind === 'plane') {
    const feature = string(o.feature, `${what}.feature`);
    requireRef(doc, before, { id: feature, kind: 'plane' }, what);
    return { kind, feature };
  }
  const body = string(o.body, `${what}.body`);
  requireRef(doc, before, { id: body, kind: 'body' }, what);
  const face = faceName(o.face, `${what}.face`);
  requireRef(doc, before, { id: face.feature, kind: 'faceSource' }, `${what}.face`);
  return { kind, body, face };
}

function externalRef(doc: Document, before: number | undefined, v: unknown, what: string): ExternalRef {
  const o = object(v, what);
  if (o.type !== 'edge') fail(`${what}: promítnout jde jen hranu`);
  const body = string(o.body, `${what}.body`);
  requireRef(doc, before, { id: body, kind: 'body' }, what);
  const edge = edgeName(o.edge, `${what}.edge`);
  for (const face of [edge.a, edge.b]) requireRef(doc, before, { id: face.feature, kind: 'faceSource' }, `${what}.edge`);
  return { type: 'edge', body, edge, kind: oneOf(o.kind, ['line', 'circle'] as const, `${what}.kind`) };
}

function regions(v: unknown, what: string): RegionRef[] {
  if (!Array.isArray(v) || v.length === 0) fail(`${what}: čeká se neprázdný seznam oblastí`);
  const seen = new Set<string>();
  const out: RegionRef[] = [];
  (v as unknown[]).forEach((r, i) => {
    const loop = object(r, `${what}[${i}]`).outerLoop;
    if (!Array.isArray(loop) || loop.length === 0) fail(`${what}[${i}].outerLoop: čeká se neprázdný seznam ID křivek`);
    const ids = [...new Set((loop as unknown[]).map((id, k) => string(id, `${what}[${i}].outerLoop[${k}]`)))].sort();
    const key = JSON.stringify(ids);
    if (!seen.has(key)) out.push({ outerLoop: ids }); // tatáž oblast dvakrát je jedna oblast
    seen.add(key);
  });
  return out;
}

// ---------------------------------------------------------------- entity skici

export type { EntityKind };
export interface Entity {
  kind: EntityKind;
  own: boolean; // false = počátek nebo promítnutá geometrie: solver s ní nehýbe
}

// Odvozené entity promítnuté geometrie plynou z `kind`: `<id>`, `<id>/a`, `<id>/b` u úsečky,
// `<id>`, `<id>/center` u kružnice.
export function derivedPoints(id: Id, ref: ExternalRef): Id[] {
  return ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`];
}

export function entityOf(sketch: SketchFeature, id: Id): Entity | undefined {
  if (id === ORIGIN) return { kind: 'point', own: false };
  if (has(sketch.points, id)) return { kind: 'point', own: true };
  if (has(sketch.curves, id)) return { kind: sketch.curves[id].type, own: true };
  if (has(sketch.external, id)) return { kind: sketch.external[id].kind, own: false };
  const slash = id.indexOf('/');
  if (slash > 0) {
    const parent = id.slice(0, slash);
    if (has(sketch.external, parent) && derivedPoints(parent, sketch.external[parent]).includes(id)) return { kind: 'point', own: false };
  }
  return undefined;
}

export function curvePoints(curve: Curve): Id[] {
  if (curve.type === 'line') return [curve.a, curve.b];
  if (curve.type === 'circle') return [curve.center];
  return [curve.center, curve.start, curve.end];
}

// Operandy vazby v pořadí katalogu.
export function constraintOperands(c: Constraint): Id[] {
  return CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
}

export const isDimension = (c: Constraint): c is Extract<Constraint, { value: number }> => 'value' in c;

// Vazby, které dostává solver: geometrické a řídicí kóty.
export const isDriving = (c: Constraint): boolean => !isDimension(c) || c.driving;

// Klíč vazby pro hledání duplicit: typ a operandy. Operandy, které katalog označuje za
// zaměnitelné (u orientovaných kót a úhlu záměna jen obrací znaménko hodnoty), se seřadí.
export function constraintKey(c: Constraint): string {
  const spec = CONSTRAINTS[c.type];
  const value = (field: string): Id => (c as unknown as Record<string, Id>)[field];
  const unordered = (spec.unordered ?? []).map(value).sort();
  const ordered = spec.operands.filter((operand) => !spec.unordered?.includes(operand.field)).map((operand) => value(operand.field));
  return JSON.stringify([c.type, ...unordered, ...ordered]);
}

// Řídicí vazba se stejným typem a operandy, která už ve skice je (kromě vazby `except`).
export function duplicateOf(sketch: SketchFeature, c: Constraint, except?: Id): Id | undefined {
  if (!isDriving(c)) return undefined;
  const key = constraintKey(c);
  return Object.keys(sketch.constraints).find((id) => id !== except && isDriving(sketch.constraints[id]) && constraintKey(sketch.constraints[id]) === key);
}

// Křivka smí odkazovat jen na vlastní body skici a na počátek.
function curve(sketch: SketchFeature, v: unknown, what: string): Curve {
  const o = object(v, what);
  const type = oneOf(o.type, ['line', 'circle', 'arc'] as const, `${what}.type`);
  const point = (field: string): Id => {
    const id = string(o[field], `${what}.${field}`);
    if (id !== ORIGIN && !has(sketch.points, id)) fail(`${what}.${field}: "${id}" není vlastní bod skici ani počátek`);
    return id;
  };
  const construction = o.construction === undefined ? {} : { construction: boolean(o.construction, `${what}.construction`) };
  if (type === 'line') {
    const [a, b] = [point('a'), point('b')];
    if (a === b) fail(`${what}: úsečka potřebuje dva různé body`);
    return { ...construction, type, a, b };
  }
  if (type === 'circle') return { ...construction, type, center: point('center') };
  const [center, start, end] = [point('center'), point('start'), point('end')];
  if (center === start || center === end || start === end) fail(`${what}: oblouk potřebuje tři různé body`);
  return { ...construction, type, center, start, end };
}

// Vazba podle katalogu: operandy existují, mají správný druh a jsou navzájem různé, hodnota
// splňuje konvenci znamének a aspoň jedním operandem může solver hýbat (řídicí vazbu jen mezi
// pevnými entitami solver tiše ignoruje).
function constraint(sketch: SketchFeature, v: unknown, what: string): Constraint {
  const o = object(v, what);
  const type = string(o.type, `${what}.type`);
  if (!has(CONSTRAINTS, type)) return fail(`${what}.type: neznámá vazba "${type}"`);
  const spec = CONSTRAINTS[type as Constraint['type']];
  const operands: Record<string, Id> = {};
  const kinds: EntityKind[] = [];
  for (const { field, kinds: accepted } of spec.operands) {
    const id = string(o[field], `${what}.${field}`);
    const entity = entityOf(sketch, id);
    if (!entity) return fail(`${what}.${field}: entita "${id}" ve skice není`);
    if (!accepted.includes(entity.kind)) fail(`${what}.${field}: "${id}" je ${entity.kind}, čeká se ${accepted.join(' nebo ')}`);
    operands[field] = id;
    kinds.push(entity.kind);
  }
  if (new Set(Object.values(operands)).size < spec.operands.length) fail(`${what}: vazba potřebuje ${spec.operands.length === 2 ? 'dvě' : spec.operands.length} různé entity`);
  const pointsOf = (id: Id): Id[] => (has(sketch.curves, id) ? curvePoints(sketch.curves[id]) : has(sketch.external, id) ? derivedPoints(id, sketch.external[id]) : []);
  const problem = spec.check?.(kinds, Object.values(operands), pointsOf);
  if (problem) fail(`${what}: ${problem}`);
  let dimension = {};
  if (spec.value) {
    const value = finite(o.value, `${what}.value`);
    const rule = VALUE_RULES[spec.value.rule];
    if (!rule.check(value)) fail(`${what}.value: ${rule.message}`);
    dimension = { value, driving: boolean(o.driving, `${what}.driving`) };
  }
  const result = { type, ...operands, ...dimension } as Constraint;
  if (isDriving(result) && !constraintOperands(result).some((id) => entityOf(sketch, id)?.own)) {
    fail(`${what}: vazba jen mezi pevnými entitami (počátek, promítnutá geometrie) by se nikdy neprojevila`);
  }
  return result;
}

function projected(v: unknown, what: string): Projected {
  const o = object(v, what);
  const vec2 = (value: unknown, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) fail(`${what}.${name}: čeká se dvojice čísel`);
    const pair = value as unknown[];
    return [finite(pair[0], `${what}.${name}`), finite(pair[1], `${what}.${name}`)];
  };
  if (o.kind === 'line') return { kind: 'line', a: vec2(o.a, 'a'), b: vec2(o.b, 'b') };
  if (o.kind === 'circle') {
    const radius = finite(o.radius, `${what}.radius`);
    if (radius <= 0) fail(`${what}.radius: poloměr musí být kladný`);
    return { kind: 'circle', center: vec2(o.center, 'center'), radius };
  }
  return fail(`${what}.kind: čeká se line nebo circle`);
}

// ---------------------------------------------------------------- features

function base(o: Dict, what: string): { id: Id; name: string; suppressed: boolean } {
  return { id: newId(o.id, `${what}.id`), name: string(o.name, `${what}.name`), suppressed: boolean(o.suppressed, `${what}.suppressed`) };
}

function planeFeature(doc: Document, before: number | undefined, o: Dict, what: string): PlaneFeature {
  return { ...base(o, what), type: 'plane', base: planeRef(doc, before, o.base, `${what}.base`), offset: finite(o.offset, `${what}.offset`) };
}

function extrudeFeature(doc: Document, before: number | undefined, o: Dict, what: string): ExtrudeFeature {
  const profile = object(o.profile, `${what}.profile`);
  if (profile.type !== 'regions') fail(`${what}.profile.type: čeká se regions`);
  const sketch = string(profile.sketch, `${what}.profile.sketch`);
  requireRef(doc, before, { id: sketch, kind: 'sketch' }, `${what}.profile.sketch`);
  const extent = object(o.extent, `${what}.extent`);
  if (extent.type !== 'distance') fail(`${what}.extent.type: čeká se distance`);
  const start = finite(extent.start, `${what}.extent.start`);
  const distance = finite(extent.distance, `${what}.extent.distance`);
  if (distance === 0) fail(`${what}.extent.distance: vzdálenost nesmí být nula`);
  const operation = oneOf(o.operation, ['new', 'add', 'cut'] as const, `${what}.operation`);
  const feature: ExtrudeFeature = {
    ...base(o, what),
    type: 'extrude',
    profile: { type: 'regions', sketch, regions: regions(profile.regions, `${what}.profile.regions`) },
    extent: { type: 'distance', start, distance },
    operation,
  };
  if (operation === 'new') {
    if (o.targets !== undefined) fail(`${what}.targets: nové těleso nemá cíl`);
    return feature;
  }
  if (!Array.isArray(o.targets) || o.targets.length !== 1) return fail(`${what}.targets: operace ${operation} potřebuje právě jedno cílové těleso`);
  const target = string(o.targets[0], `${what}.targets[0]`);
  requireRef(doc, before, { id: target, kind: 'body' }, `${what}.targets`);
  return { ...feature, targets: [target] };
}

function sketchFeature(doc: Document, before: number | undefined, o: Dict, what: string): SketchFeature {
  const sketch = emptySketch(newId(o.id, `${what}.id`), string(o.name, `${what}.name`), planeRef(doc, before, o.plane, `${what}.plane`));
  sketch.suppressed = boolean(o.suppressed, `${what}.suppressed`);
  const seen = new Set<Id>();
  const entries = (v: unknown, name: string): [Id, unknown][] =>
    Object.entries(object(v, `${what}.${name}`)).map(([key, value]) => {
      const id = newId(key, `${what}.${name}`);
      if (seen.has(id)) fail(`${what}.${name}: ID "${id}" je ve skice dvakrát`);
      seen.add(id);
      return [id, value];
    });
  for (const [id, value] of entries(o.points, 'points')) {
    const p = object(value, `${what}.points.${id}`);
    sketch.points[id] = { x: finite(p.x, `${what}.points.${id}.x`), y: finite(p.y, `${what}.points.${id}.y`) };
  }
  for (const [id, value] of entries(o.external, 'external')) sketch.external[id] = externalRef(doc, before, value, `${what}.external.${id}`);
  for (const [id, value] of entries(o.curves, 'curves')) sketch.curves[id] = curve(sketch, value, `${what}.curves.${id}`);
  for (const [id, value] of Object.entries(object(o.radii, `${what}.radii`))) {
    if (!has(sketch.curves, id) || sketch.curves[id].type !== 'circle') fail(`${what}.radii: "${id}" není kružnice`);
    sketch.radii[id] = finite(value, `${what}.radii.${id}`);
    if (sketch.radii[id] <= 0) fail(`${what}.radii.${id}: poloměr musí být kladný`);
  }
  for (const [id, c] of Object.entries(sketch.curves)) if (c.type === 'circle' && !has(sketch.radii, id)) fail(`${what}.radii: kružnice "${id}" nemá poloměr`);
  for (const [id, value] of entries(o.constraints, 'constraints')) sketch.constraints[id] = constraint(sketch, value, `${what}.constraints.${id}`);
  const solved = object(o.solved, `${what}.solved`);
  sketch.solved.inputs = string(solved.inputs, `${what}.solved.inputs`);
  for (const [id, value] of Object.entries(object(solved.external, `${what}.solved.external`))) {
    const stored = projected(value, `${what}.solved.external.${id}`);
    if (!has(sketch.external, id) || sketch.external[id].kind !== stored.kind) fail(`${what}.solved.external: "${id}" neodpovídá promítnuté geometrii skici`);
    sketch.solved.external[id] = stored;
  }
  return sketch;
}

// ---------------------------------------------------------------- registr typů features

// Veřejný popis typu feature (pro UI a popis API).
export interface FeatureTypeInfo {
  title: string;
  summary: string;
  bodies: 'none' | 'self'; // self: feature může vytvořit těleso se svým ID
  updatable: readonly string[]; // pole, která mění příkaz updateFeature; prázdné = má vlastní příkazy
}

// Typ feature jako položka registru: vše, co o něm dokument potřebuje vědět. Krok přepočtu typu
// je v evaluate.ts; úplnost obou míst hlídá překladač (záznam podle `Feature['type']`).
interface FeatureTypeSpec<F extends Feature> {
  info: Omit<FeatureTypeInfo, 'updatable'>;
  // Ověří feature a vrátí její kanonickou kopii. `before`: viz requireRef.
  validate(doc: Document, before: number | undefined, o: Dict, what: string): F;
  // Odkazy na jiné features s místem, kde ve feature leží.
  refs(f: F): FeatureRef[];
  // Vytváří feature těleso s tímto ID? `local` je část ID za lomítkem (bez lomítka chybí).
  createsBody(f: F, local: string | undefined): boolean;
  namesFaces: boolean; // pojmenovává feature stěny těles?
  // Pole, která smí měnit updateFeature; bez nich feature tímto příkazem měnit nejde.
  patch?: { fields: readonly string[]; normalize?(merged: Dict, patch: Dict): void };
}

const planeRefs = (ref: PlaneRef, path: string): FeatureRef[] =>
  ref.kind === 'plane'
    ? [{ path, id: ref.feature, kind: 'plane' }]
    : ref.kind === 'face'
      ? [
          { path, id: ref.body, kind: 'body' },
          { path, id: ref.face.feature, kind: 'faceSource' },
        ]
      : [];

const FEATURE_TYPES: { [K in Feature['type']]: FeatureTypeSpec<Extract<Feature, { type: K }>> } = {
  plane: {
    info: { title: 'Rovina', summary: 'Vlastní rovina posunutá od základní roviny, jiné vlastní roviny nebo rovinné stěny tělesa.', bodies: 'none' },
    validate: planeFeature,
    refs: (f) => planeRefs(f.base, 'base'),
    createsBody: () => false,
    namesFaces: false,
    patch: { fields: ['base', 'offset'] },
  },
  sketch: {
    info: { title: 'Skica', summary: 'Rovinná skica: body, křivky, vazby a kóty; její uzavřené oblasti se vysouvají.', bodies: 'none' },
    validate: sketchFeature,
    refs: (f) => [
      ...planeRefs(f.plane, 'plane'),
      ...Object.entries(f.external).flatMap(([id, ref]): FeatureRef[] => [
        { path: `external/${id}`, id: ref.body, kind: 'body' },
        { path: `external/${id}`, id: ref.edge.a.feature, kind: 'faceSource' },
        { path: `external/${id}`, id: ref.edge.b.feature, kind: 'faceSource' },
      ]),
    ],
    createsBody: () => false,
    namesFaces: false,
  },
  extrude: {
    info: { title: 'Vysunutí', summary: 'Vysune profil ve směru normály roviny skici: nové těleso, přidání k tělesu, nebo odebrání z tělesa.', bodies: 'self' },
    validate: extrudeFeature,
    refs: (f) => [{ path: 'profile/sketch', id: f.profile.sketch, kind: 'sketch' }, ...(f.targets ?? []).map((id): FeatureRef => ({ path: 'targets', id, kind: 'body' }))],
    createsBody: (f, local) => local === undefined && f.operation === 'new',
    namesFaces: true,
    patch: {
      fields: ['profile', 'extent', 'operation', 'targets'],
      // změna na nové těleso ruší cíle, pokud je změna sama neuvádí
      normalize: (merged, patch) => {
        if (merged.operation === 'new' && !has(patch, 'targets')) delete merged.targets;
      },
    },
  },
};

// Veřejná část registru.
export const FEATURE_TYPE_INFO: Record<Feature['type'], FeatureTypeInfo> = Object.fromEntries(
  Object.entries(FEATURE_TYPES).map(([type, spec]) => [type, { ...spec.info, updatable: (spec as FeatureTypeSpec<Feature>).patch?.fields ?? [] }]),
) as Record<Feature['type'], FeatureTypeInfo>;

const specOf = (f: Feature): FeatureTypeSpec<Feature> => FEATURE_TYPES[f.type] as FeatureTypeSpec<Feature>;

// Ověří feature a vrátí její kanonickou kopii. `before`: viz requireRef.
function feature(doc: Document, before: number | undefined, v: unknown, what: string): Feature {
  const o = object(v, what);
  const type = oneOf(o.type, Object.keys(FEATURE_TYPES) as Feature['type'][], `${what}.type`);
  return (FEATURE_TYPES[type] as FeatureTypeSpec<Feature>).validate(doc, before, o, what);
}

// Features, na které feature odkazuje: rovina, skica, feature, která vytvořila těleso, a extrude,
// které pojmenovaly stěnu (stěna i hrana existují až po feature, která je vytvořila).
export function featureRefs(f: Feature): Id[] {
  return [...new Set(specOf(f).refs(f).map((ref) => (ref.kind === 'body' ? bodyOwner(ref.id).feature : ref.id)))];
}

// Slučovací změna (příkaz updateFeature): varianta se stejným `type` se slučuje po polích, jiná
// varianta, odkaz (objekt s `kind`) a seznam dosavadní hodnotu nahradí, `null` pole odebere.
function mergePatch(old: unknown, patch: unknown, what: string): unknown {
  if (!isObject(patch) || has(patch, 'kind')) return patch;
  // odkaz se po polích neslučuje: půlka odkazu by vybrala jinou stěnu téhož tělesa
  if (isObject(old) && has(old, 'kind')) fail(`${what}: odkaz se nahrazuje celý, čeká se objekt s polem kind`);
  if (!isObject(old)) return patch;
  if (patch.type !== undefined && patch.type !== old.type) return patch;
  const out: Dict = { ...old };
  for (const [key, value] of Object.entries(patch)) {
    if (key in Object.prototype) fail(`${what}.${key}: takové pole feature nemá`);
    if (value === null) delete out[key];
    else out[key] = mergePatch(old[key], value, `${what}.${key}`);
  }
  return out;
}

// Cesty k hodnotám, které změna nastavuje: listy, seznamy a odkazy (odebraná pole ne).
function patchPaths(patch: Dict, prefix: string[] = []): string[][] {
  return Object.entries(patch).flatMap(([key, value]) => (value === null ? [] : isObject(value) && !has(value, 'kind') ? patchPaths(value, [...prefix, key]) : [[...prefix, key]]));
}

// Změna bez polí s hodnotou `undefined`: v JSON nejsou a volající z kódu jimi myslí „neměnit".
const withoutUndefined = (value: unknown): unknown =>
  isObject(value)
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, withoutUndefined(item)]),
      )
    : value;

const hasPath = (value: unknown, path: string[]): boolean => path.length === 0 || (isObject(value) && has(value, path[0]) && hasPath(value[path[0]], path.slice(1)));
const refKey = (ref: FeatureRef): string => JSON.stringify([ref.path, ref.kind, ref.id]);

// ---------------------------------------------------------------- načtení dokumentu

// Ověří celý dokument stejnými pravidly jako příkazy. Odkazy na features, které v dokumentu nejsou
// nebo leží jinde, jsou přípustné: projeví se až při přepočtu.
export function validateDocument(value: unknown): Document {
  const o = upgrade(object(value, 'dokument'));
  if (o.schemaVersion !== SCHEMA_VERSION) fail(`dokument: verze schématu ${String(o.schemaVersion)} není podporovaná (čeká se ${SCHEMA_VERSION})`);
  const chordTolerance = finite(object(o.settings, 'dokument.settings').chordTolerance, 'dokument.settings.chordTolerance');
  if (chordTolerance <= 0) fail('dokument.settings.chordTolerance: musí být kladná');
  // Parametry a kontroly do schématu verze 2 patří, engine je ale zatím neumí (D35 bod 1).
  for (const name of ['parameters', 'checks'] as const) {
    if (!Array.isArray(o[name])) fail(`dokument.${name}: čeká se seznam`);
    if ((o[name] as unknown[]).length > 0) fail(`dokument.${name}: parametry a kontroly engine zatím neumí`);
  }
  if (!Array.isArray(o.features)) fail('dokument.features: čeká se seznam');
  const doc: Document = { schemaVersion: SCHEMA_VERSION, settings: { chordTolerance }, parameters: [], checks: [], features: [] };
  const ids = new Set<Id>();
  (o.features as unknown[]).forEach((item, i) => {
    const f = feature(doc, undefined, item, `features[${i}]`);
    for (const id of [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])]) {
      if (ids.has(id)) fail(`features[${i}]: ID "${id}" je v dokumentu dvakrát`);
      ids.add(id);
    }
    doc.features.push(f);
  });
  return doc;
}

// Převod staršího dokumentu na současné schéma. Mění jen tvar; obsah ověří validace po něm.
// Verze 1 → 2: vysunutí má zdroj profilu, rozsah a seznam cílů; dokument má parametry a kontroly.
function upgrade(o: Dict): Dict {
  if (o.schemaVersion !== 1) return o;
  const extrude = (f: Dict): Dict => {
    const { sketch, regions: list, distance, target, ...rest } = f;
    return {
      ...rest,
      profile: { type: 'regions', sketch, regions: list },
      extent: { type: 'distance', start: 0, distance },
      ...(target === undefined ? {} : { targets: [target] }),
    };
  };
  const features = Array.isArray(o.features) ? o.features.map((f: unknown) => (isObject(f) && f.type === 'extrude' ? extrude(f) : f)) : o.features;
  // parametry a kontroly verze 1 neměla; co tam přesto je, se nezahodí a posoudí to validace
  return { ...o, schemaVersion: 2, parameters: o.parameters ?? [], checks: o.checks ?? [], features };
}

// ---------------------------------------------------------------- příkazy

function indexOf(doc: Document, id: unknown, what: string): number {
  const index = doc.features.findIndex((f) => f.id === id);
  return index < 0 ? fail(`${what}: feature "${String(id)}" neexistuje`) : index;
}
const replaceAt = (doc: Document, index: number, f: Feature): Document =>
  doc.features[index] === f ? doc : { ...doc, features: doc.features.map((old, i) => (i === index ? f : old)) };

function unique(doc: Document, v: unknown, what: string): Id {
  const id = newId(v, what);
  if (allIds(doc).has(id)) fail(`${what}: ID "${id}" už v dokumentu je`);
  return id;
}

function editSketch(doc: Document, id: unknown, edit: (sketch: SketchFeature, index: number) => SketchFeature): Document {
  const index = indexOf(doc, id, 'sketch');
  const f = doc.features[index];
  if (f.type !== 'sketch') return fail(`sketch: feature "${f.id}" není skica`);
  return replaceAt(doc, index, edit(f, index));
}

// Příkaz, který zapisuje řešené proměnné přímo (nový bod, nová křivka), zruší razítko: uložené
// hodnoty už neodpovídají poslednímu řešení, i kdyby se otisk vstupů solveru shodoval (bod smazaný
// a přidaný znovu pod stejným ID na jiném místě).
const unsolved = (s: SketchFeature): SketchFeature['solved'] => ({ ...s.solved, inputs: '' });

const without = <T>(record: Record<Id, T>, drop: (id: Id, value: T) => boolean): Record<Id, T> =>
  Object.fromEntries(Object.entries(record).filter(([id, value]) => !drop(id, value)));

// Provede příkaz a vrátí nový dokument; původní se nemění. Neplatný příkaz vyhodí CommandError.
// Příkaz `dragPoint` dokument nemění (cíl tažení dostane přepočet), jen se ověří.
export function applyCommand(doc: Document, command: Command): Document {
  const cmd = object(command, 'příkaz') as Dict & { type?: unknown };
  switch (cmd.type) {
    case 'batch': {
      if (!Array.isArray(cmd.commands)) return fail('batch.commands: čeká se seznam příkazů');
      let current = doc;
      (cmd.commands as Command[]).forEach((inner, i) => {
        try {
          if (isObject(inner) && inner.type === 'dragPoint') fail('dragPoint: tažení nejde zařadit do dávky');
          current = applyCommand(current, inner);
        } catch (error) {
          if (error instanceof CommandError) error.commandIndex = i;
          throw error;
        }
      });
      return current;
    }

    case 'addFeature': {
      const index = cmd.index === undefined ? doc.features.length : finite(cmd.index, 'addFeature.index');
      if (!Number.isInteger(index) || index < 0 || index > doc.features.length) fail('addFeature.index: mimo rozsah časové osy');
      const f = feature(doc, index, cmd.feature, 'addFeature.feature');
      const ids = allIds(doc);
      const added = [f.id, ...(f.type === 'sketch' ? sketchIds(f) : [])];
      for (const id of added) if (ids.has(id) || added.indexOf(id) !== added.lastIndexOf(id)) fail(`addFeature: ID "${id}" už v dokumentu je`);
      return { ...doc, features: [...doc.features.slice(0, index), f, ...doc.features.slice(index)] };
    }

    case 'removeFeature': {
      const index = indexOf(doc, cmd.id, 'removeFeature');
      return { ...doc, features: doc.features.filter((_, i) => i !== index) };
    }

    case 'moveFeature': {
      const from = indexOf(doc, cmd.id, 'moveFeature');
      const to = finite(cmd.index, 'moveFeature.index');
      if (!Number.isInteger(to) || to < 0 || to >= doc.features.length) fail('moveFeature.index: mimo rozsah časové osy');
      const moved = doc.features[from];
      const features = doc.features.filter((_, i) => i !== from);
      features.splice(to, 0, moved);
      const position = new Map(features.map((f, i) => [f.id, i]));
      for (const ref of featureRefs(moved)) {
        if ((position.get(ref) ?? -1) > to) fail(`moveFeature: "${moved.id}" by se dostala před feature "${ref}", na kterou odkazuje`);
      }
      for (const f of features) {
        if (f !== moved && featureRefs(f).includes(moved.id) && (position.get(f.id) as number) < to) {
          fail(`moveFeature: "${moved.id}" by se dostala za feature "${f.id}", která na ni odkazuje`);
        }
      }
      return from === to ? doc : { ...doc, features };
    }

    case 'renameFeature': {
      const index = indexOf(doc, cmd.id, 'renameFeature');
      return replaceAt(doc, index, { ...doc.features[index], name: string(cmd.name, 'renameFeature.name') });
    }

    case 'setSuppressed': {
      const index = indexOf(doc, cmd.id, 'setSuppressed');
      return replaceAt(doc, index, { ...doc.features[index], suppressed: boolean(cmd.suppressed, 'setSuppressed.suppressed') });
    }

    case 'updateFeature': {
      const index = indexOf(doc, cmd.id, 'updateFeature');
      const f = doc.features[index];
      const spec = specOf(f);
      if (!spec.patch) return fail(`updateFeature: feature "${f.id}" je ${spec.info.title.toLowerCase()}; její obsah mění vlastní příkazy`);
      const title = spec.info.title.toLowerCase();
      const patch = withoutUndefined(object(cmd.patch, 'updateFeature.patch')) as Dict;
      for (const key of Object.keys(patch)) if (!spec.patch.fields.includes(key)) fail(`updateFeature.patch.${key}: ${title} takové pole nemá`);
      const merged = mergePatch(f, patch, 'updateFeature.patch') as Dict;
      spec.patch.normalize?.(merged, patch);
      const checked = spec.validate(doc, undefined, merged, 'updateFeature.patch');
      // Validace neznámá pole zahazuje; ve změně je to překlep nebo pole jiné varianty, které by
      // jinak skončilo úspěchem bez účinku.
      for (const path of patchPaths(patch)) if (!hasPath(checked, path)) fail(`updateFeature.patch.${path.join('.')}: ${title} takové pole nemá`);
      // Tvar se ověří celý, odkazy jen ty, které feature dosud neměla: oprava jedné rozbité
      // reference nesmí narazit na jinou, kterou změna nechává být (i když ji zopakuje).
      const kept = new Set(spec.refs(f).map(refKey));
      for (const ref of spec.refs(checked)) if (!kept.has(refKey(ref))) requireRef(doc, index, ref, `updateFeature.patch.${ref.path.split('/').join('.')}`);
      return replaceAt(doc, index, checked);
    }

    case 'setSketchPlane':
      return editSketch(doc, cmd.sketch, (s, index) => ({ ...s, plane: planeRef(doc, index, cmd.plane, 'setSketchPlane.plane') }));

    case 'addPoint':
      return editSketch(doc, cmd.sketch, (s) => ({
        ...s,
        points: { ...s.points, [unique(doc, cmd.id, 'addPoint.id')]: { x: finite(cmd.x, 'addPoint.x'), y: finite(cmd.y, 'addPoint.y') } },
        solved: unsolved(s),
      }));

    case 'addCurve':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = unique(doc, cmd.id, 'addCurve.id');
        const c = curve(s, cmd.curve, 'addCurve.curve');
        if (c.type !== 'circle') {
          if (cmd.radius !== undefined) fail('addCurve.radius: poloměr se zadává jen u kružnice');
          return { ...s, curves: { ...s.curves, [id]: c }, solved: unsolved(s) };
        }
        const radius = finite(cmd.radius, 'addCurve.radius');
        if (radius <= 0) fail('addCurve.radius: poloměr musí být kladný');
        return { ...s, curves: { ...s.curves, [id]: c }, radii: { ...s.radii, [id]: radius }, solved: unsolved(s) };
      });

    case 'removeEntity':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeEntity.id');
        const entity = entityOf(s, id);
        if (!entity?.own) fail(`removeEntity: "${id}" není vlastní bod ani křivka skici (počátek a promítnutou geometrii smazat nejde)`);
        // Mazání kaskáduje: bod vezme křivky, které na něm stojí; bod i křivka vezmou své vazby.
        const gone = new Set<Id>([id]);
        for (const [curveId, c] of Object.entries(s.curves)) if (curvePoints(c).includes(id)) gone.add(curveId);
        return {
          ...s,
          points: without(s.points, (p) => gone.has(p)),
          curves: without(s.curves, (c) => gone.has(c)),
          radii: without(s.radii, (c) => gone.has(c)),
          constraints: without(s.constraints, (_, c) => constraintOperands(c).some((operand) => gone.has(operand))),
        };
      });

    case 'setConstruction':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setConstruction.id');
        if (!has(s.curves, id)) fail(`setConstruction: "${id}" není křivka skici`);
        const { construction: _old, ...rest } = s.curves[id];
        // pořadí klíčů jako při načtení dokumentu, aby se uložený a znovu načtený dokument nelišil
        const flagged = boolean(cmd.construction, 'setConstruction.construction') ? { construction: true, ...rest } : rest;
        return { ...s, curves: { ...s.curves, [id]: flagged as Curve } };
      });

    case 'addConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = unique(doc, cmd.id, 'addConstraint.id');
        const added = constraint(s, cmd.constraint, 'addConstraint.constraint');
        const twin = duplicateOf(s, added);
        if (twin !== undefined) fail(`addConstraint: stejná vazba už ve skice je ("${twin}")`);
        return { ...s, constraints: { ...s.constraints, [id]: added } };
      });

    case 'removeConstraint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeConstraint.id');
        if (!has(s.constraints, id)) fail(`removeConstraint: vazba "${id}" ve skice není`);
        return { ...s, constraints: without(s.constraints, (c) => c === id) };
      });

    case 'setConstraintValue':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'setConstraintValue.id');
        if (!has(s.constraints, id)) fail(`setConstraintValue: vazba "${id}" ve skice není`);
        const old = s.constraints[id];
        if (!isDimension(old)) return fail(`setConstraintValue: vazba "${id}" není kóta`);
        const changed = { ...old, value: cmd.value === undefined ? old.value : cmd.value, driving: cmd.driving === undefined ? old.driving : cmd.driving };
        const next = constraint(s, changed, 'setConstraintValue');
        // Duplicitu smí vyrobit jen přepnutí referenční kóty na řídicí. Změna hodnoty projde
        // i u kót, které jsou duplicitní už z načteného dokumentu.
        const twin = old.driving ? undefined : duplicateOf(s, next, id);
        if (twin !== undefined) fail(`setConstraintValue: stejnou řídicí kótu už skica má ("${twin}")`);
        return { ...s, constraints: { ...s.constraints, [id]: next } };
      });

    case 'dragPoint':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.point, 'dragPoint.point');
        if (!has(s.points, id)) fail(`dragPoint: "${id}" není vlastní bod skici (počátkem a promítnutou geometrií táhnout nejde)`);
        finite(cmd.x, 'dragPoint.x');
        finite(cmd.y, 'dragPoint.y');
        return s;
      });

    case 'addExternal':
      return editSketch(doc, cmd.sketch, (s, index) => ({
        ...s,
        external: { ...s.external, [unique(doc, cmd.id, 'addExternal.id')]: externalRef(doc, index, cmd.ref, 'addExternal.ref') },
      }));

    case 'updateExternal':
      return editSketch(doc, cmd.sketch, (s, index) => {
        const id = string(cmd.id, 'updateExternal.id');
        if (!has(s.external, id)) fail(`updateExternal: promítnutí "${id}" ve skice není`);
        const ref = externalRef(doc, index, cmd.ref, 'updateExternal.ref');
        // Změna druhu by změnila odvozená ID; kdo chce jiný druh, promítnutí smaže a založí nové.
        if (ref.kind !== s.external[id].kind) fail('updateExternal: druh promítnutí změnit nejde');
        // Zmrazené hodnoty patřily původní hraně.
        return { ...s, external: { ...s.external, [id]: ref }, solved: { ...s.solved, external: without(s.solved.external, (e) => e === id) } };
      });

    case 'removeExternal':
      return editSketch(doc, cmd.sketch, (s) => {
        const id = string(cmd.id, 'removeExternal.id');
        if (!has(s.external, id)) fail(`removeExternal: promítnutí "${id}" ve skice není`);
        const derived = (operand: Id) => operand === id || operand.startsWith(`${id}/`);
        return {
          ...s,
          external: without(s.external, (e) => e === id),
          constraints: without(s.constraints, (_, c) => constraintOperands(c).some(derived)),
          solved: { ...s.solved, external: without(s.solved.external, (e) => e === id) },
        };
      });

    default:
      return fail(`neznámý příkaz "${String(cmd.type)}"`);
  }
}
