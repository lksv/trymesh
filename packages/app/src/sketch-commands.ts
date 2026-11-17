// Příkazy, které posílají kreslicí nástroje a tlačítka vazeb. Čisté funkce: z kliknutí a výběru
// sestaví příkazy enginu; ID nových entit dodává volající (viz docs/ui.md, bod 9).
import {
  type AxisRef,
  CONSTRAINTS,
  type Command,
  type Constraint,
  type Dimension,
  type DimensionShape,
  type Expr,
  type ExtrudeFeature,
  type FaceName,
  GENERATORS,
  type GeneratorName,
  type GeometricConstraint,
  type Id,
  type Input,
  type PatternFeature,
  type PlaneFeature,
  type PlaneRef,
  type ProfileSource,
  type RegionRef,
  type SketchFeature,
  type Anchor,
  type NewId,
  type Placed,
  type SketchToolCall,
  type SketchToolInputs,
  type SketchToolResult,
  type CurvePointName,
  type Vec2,
  anchorPosition,
  isFlag,
  placeAnchor,
  referenceEntities,
  sketchTool,
} from '@trymesh/engine';
import { type EntityKind, ORIGIN, type PointView, type SketchView, dist, kindOf, measure, unreachable } from './sketch-view';

// The place of a click in the sketch with what it snapped to, and the supplier of new IDs: both
// are the types of the sketch tools of the engine (D35, point 7), which the app shares with MCP.
export type { Anchor, NewId };

// Body blíž než tohle jsou pro kreslení tentýž bod: křivka mezi nimi by měla nulovou délku
// a zneplatnila by profil skici.
const SAME_PLACE = 1e-6;

// The point for an end of a curve: the rule of the engine's sketch tools (an own point and the
// origin are used again, a projected point gets a new point with a coincident constraint, a curve
// a point-on-curve constraint). The view carries the sketch it was made of.
export const place = (_sketch: Id, view: SketchView, anchor: Anchor, newId: NewId): Placed => placeAnchor(view.source, anchor, newId);

export function pointCommands(sketch: Id, view: SketchView, anchor: Anchor, newId: NewId): Command[] | undefined {
  if (anchor.snap?.kind === 'point') return undefined; // bod tam už je
  return place(sketch, view, anchor, newId).commands;
}

// Úsečka mezi dvěma kliknutími; `infer` přidá vazbu vodorovnosti nebo svislosti.
export function lineCommands(sketch: Id, view: SketchView, from: Anchor, to: Anchor, newId: NewId, infer?: 'horizontal' | 'vertical'): { commands: Command[]; end: Id } | undefined {
  if (dist(positionOf(view, from), positionOf(view, to)) <= SAME_PLACE) return undefined; // dvojklik na stejné místo
  const a = place(sketch, view, from, newId);
  const b = place(sketch, view, to, newId);
  if (a.id === b.id) return undefined;
  const line = newId('c');
  const commands: Command[] = [...a.commands, ...b.commands, { type: 'addCurve', sketch, id: line, curve: { type: 'line', a: a.id, b: b.id } }];
  if (infer) commands.push({ type: 'addConstraint', sketch, id: newId('k'), constraint: { type: infer, line } });
  return { commands, end: b.id };
}

// The rectangle, the regular polygon and the fillet are sketch tools of the engine, shared with
// MCP; here they only get the clicks. `context` is the open sketch with the document
// (`SketchContext.tool`). undefined = the clicks cannot be drawn (both at one place).
export function rectangleCommands(_sketch: Id, context: SketchToolCall, first: Anchor, opposite: Anchor, newId: NewId): Command[] | undefined {
  const made = sketchTool('rectangle', context, { first, opposite }, newId);
  return made.ok ? made.commands : undefined;
}

// What the fillet tool of the app remembers between corners: the radius, a number or an expression.
export interface FilletOptions {
  radius: number | Expr;
}
export const DEFAULT_FILLET: FilletOptions = { radius: 2 };

// The fillet of a corner (D52): the batch as the tool made it, or the reason it refuses.
export function filletCommands(context: SketchToolCall, corner: Id, options: FilletOptions, newId: NewId): SketchToolResult {
  return sketchTool('fillet', context, { corner, radius: options.radius }, newId);
}

// The points of a curve by its kind, with their labels: what the row Re-point offers.
export const CURVE_POINT_LABELS: Record<CurvePointName, string> = { a: 'Start', b: 'End', center: 'Centre', start: 'Start', end: 'End' };

// A selection that a curve can be re-pointed by: one own curve and one own point (or the origin)
// that is not a point of the curve already (a re-point onto it would change nothing or be refused).
export function repointSelection(view: SketchView, selection: Id[]): { curve: Id; to: Id } | undefined {
  if (selection.length !== 2) return undefined;
  const curve = selection.find((id) => view.curves.get(id)?.own);
  const to = selection.find((id) => id !== curve && view.points.has(id) && (view.points.get(id)?.own || id === ORIGIN));
  return curve && to && !view.curves.get(curve)?.points.includes(to) ? { curve, to } : undefined;
}

// What the polygon tool of the app remembers between clicks: the number of sides and whether the
// drawn size gets a dimension.
export interface PolygonOptions {
  sides: number;
  sizeKind: 'none' | NonNullable<SketchToolInputs['polygon']['sizeKind']>;
}
export const DEFAULT_POLYGON: PolygonOptions = { sides: 6, sizeKind: 'none' };

// The size across flats exists for an even number of sides only; an odd polygon falls back to the circle.
export const polygonSizeKind = (options: PolygonOptions): PolygonOptions['sizeKind'] => (options.sizeKind === 'acrossFlats' && options.sides % 2 === 1 ? 'circumscribed' : options.sizeKind);

export function polygonCommands(_sketch: Id, context: SketchToolCall, center: Anchor, vertex: Anchor, options: PolygonOptions, newId: NewId): Command[] | undefined {
  const sizeKind = polygonSizeKind(options);
  const made = sketchTool('polygon', context, { center, vertex, sides: options.sides, ...(sizeKind === 'none' ? {} : { sizeKind }) }, newId);
  return made.ok ? made.commands : undefined;
}

// Kružnice: střed a bod na obvodu. Přichycení obvodu na bod přidá vazbu bodu na křivce.
export function circleCommands(sketch: Id, view: SketchView, center: Anchor, rim: Anchor, newId: NewId): Command[] | undefined {
  const radius = dist(positionOf(view, center), positionOf(view, rim));
  if (!(radius > SAME_PLACE)) return undefined;
  const c = place(sketch, view, center, newId);
  const circle = newId('c');
  const commands: Command[] = [...c.commands, { type: 'addCurve', sketch, id: circle, curve: { type: 'circle', center: c.id }, radius }];
  if (rim.snap?.kind === 'point' && rim.snap.id !== c.id) commands.push({ type: 'addConstraint', sketch, id: newId('k'), constraint: { type: 'pointOnCurve', point: rim.snap.id, curve: circle } });
  return commands;
}

// Oblouk: střed, začátek, konec (proti směru hodin). Volný konec se posune na poloměr začátku.
export function arcCommands(sketch: Id, view: SketchView, center: Anchor, start: Anchor, end: Anchor, newId: NewId): Command[] | undefined {
  const [pc, ps, pe] = [positionOf(view, center), positionOf(view, start), positionOf(view, end)];
  const radius = dist(pc, ps);
  const reach = dist(pc, pe);
  if (!(radius > 0) || !(reach > 0)) return undefined;
  const onRadius: Anchor = end.snap ? end : { at: [pc[0] + ((pe[0] - pc[0]) * radius) / reach, pc[1] + ((pe[1] - pc[1]) * radius) / reach] };
  if (radius <= SAME_PLACE || dist(ps, positionOf(view, onRadius)) <= SAME_PLACE) return undefined;
  const c = place(sketch, view, center, newId);
  const s = place(sketch, view, start, newId);
  const e = place(sketch, view, onRadius, newId);
  if (c.id === s.id || c.id === e.id || s.id === e.id) return undefined;
  return [...c.commands, ...s.commands, ...e.commands, { type: 'addCurve', sketch, id: newId('c'), curve: { type: 'arc', center: c.id, start: s.id, end: e.id } }];
}

// Kde přichycené kliknutí skutečně leží: the rule of the engine's sketch tools.
export const positionOf = (view: SketchView, anchor: Anchor): Vec2 => anchorPosition(view.source, anchor);

// ---------------------------------------------------------------- vazby z výběru

export type GeometricKind = GeometricConstraint['type'];

// Geometrické vazby, které engine zná (vazby bez hodnoty), v pořadí katalogu. Nová vazba enginu
// se tu objeví sama.
export const GEOMETRIC_KINDS: GeometricKind[] = (Object.keys(CONSTRAINTS) as Constraint['type'][]).filter((type) => !CONSTRAINTS[type].dimension) as GeometricKind[];

interface Sorted {
  points: Id[];
  lines: Id[];
  round: Id[]; // kružnice a oblouky
}
function sort(view: SketchView, ids: Id[]): Sorted {
  const out: Sorted = { points: [], lines: [], round: [] };
  for (const id of ids) {
    const kind: EntityKind | undefined = kindOf(view, id);
    switch (kind) {
      case 'point':
        out.points.push(id);
        break;
      case 'line':
        out.lines.push(id);
        break;
      case 'circle':
      case 'arc':
        out.round.push(id);
        break;
      case undefined:
        break;
      default:
        unreachable(kind, 'entity');
    }
  }
  return out;
}

// Geometrické vazby pro výběr; undefined = výběr se pro vazbu nehodí.
export function geometricFor(kind: GeometricKind, view: SketchView, selection: Id[]): Constraint[] | undefined {
  const { points, lines, round } = sort(view, selection);
  const only = (p: number, l: number, r: number) => points.length === p && lines.length === l && round.length === r;
  switch (kind) {
    case 'coincident':
      return only(2, 0, 0) ? [{ type: kind, a: points[0], b: points[1] }] : undefined;
    case 'pointOnCurve':
      return points.length === 1 && lines.length + round.length === 1 ? [{ type: kind, point: points[0], curve: [...lines, ...round][0] }] : undefined;
    case 'horizontal':
    case 'vertical':
      return lines.length > 0 && points.length === 0 && round.length === 0 ? lines.map((line) => ({ type: kind, line })) : undefined;
    case 'parallel':
    case 'perpendicular':
    case 'equalLength':
      return only(0, 2, 0) ? [{ type: kind, a: lines[0], b: lines[1] }] : undefined;
    case 'tangent':
      return points.length === 0 && lines.length + round.length === 2 && round.length >= 1 ? [{ type: kind, a: [...lines, ...round][0], b: [...lines, ...round][1] }] : undefined;
    case 'fixed': {
      // Every selected own point is fixed where it is (unrounded: a rounded coordinate could clash
      // with what already holds the point); the coordinates are then edited in the constraint list.
      const own = points.map((id) => view.points.get(id)).filter((point) => point?.own) as PointView[];
      return points.length > 0 && own.length === selection.length ? own.map((point) => ({ type: kind, point: point.id, x: point.at[0], y: point.at[1] })) : undefined;
    }
    default:
      return fromCatalog(kind, view, selection);
  }
}

// Vazba bez zvláštního pravidla: výběr se rozdělí mezi operandy podle katalogu enginu. Operandy
// se obsazují v pořadí výběru entitami přípustného druhu; vazba vznikne, jen když se takto
// rozdělí celý výběr a projde vlastní pravidlo vazby z katalogu (souměrný bod není koncem osy).
function fromCatalog(kind: GeometricKind, view: SketchView, selection: Id[]): Constraint[] | undefined {
  const spec = CONSTRAINTS[kind];
  if (selection.length !== spec.operands.length || new Set(selection).size !== selection.length) return undefined;
  const fits = (id: Id, index: number): boolean => {
    const entity = kindOf(view, id);
    return entity !== undefined && spec.operands[index].kinds.includes(entity);
  };
  const assign = (index: number, left: Id[]): Id[] | undefined => {
    if (index === spec.operands.length) return [];
    for (const id of left) {
      const rest = fits(id, index) ? assign(index + 1, left.filter((other) => other !== id)) : undefined;
      if (rest) return [id, ...rest];
    }
    return undefined;
  };
  const ids = assign(0, selection);
  if (!ids) return undefined;
  const pointsOf = (curve: Id): Id[] => view.curves.get(curve)?.points ?? [];
  if (spec.check?.(ids.map((id) => kindOf(view, id) as EntityKind), ids, pointsOf) !== undefined) return undefined;
  return [Object.fromEntries([['type', kind], ...spec.operands.map((operand, index) => [operand.field, ids[index]])]) as unknown as Constraint];
}

export type DimensionVariant = 'auto' | 'horizontal' | 'vertical';

// The dimension of a round curve: a circle gets its diameter, an arc its radius.
function roundDimension(kind: EntityKind | undefined): 'diameter' | 'radius' {
  switch (kind) {
    case 'circle':
      return 'diameter';
    case 'arc':
    case 'point': // `sort` puts only circles and arcs among the round entities
    case 'line':
    case undefined:
      return 'radius';
    default:
      return unreachable(kind, 'entity');
  }
}

// Kóta podle výběru (tabulka v docs/ui.md); hodnota je současná míra zaokrouhlená na setiny.
export function dimensionFor(variant: DimensionVariant, view: SketchView, selection: Id[]): Dimension | undefined {
  const { points, lines, round } = sort(view, selection);
  const count = points.length + lines.length + round.length;
  let shape: DimensionShape | undefined;
  // dva body, nebo koncové body jedné úsečky
  const pair = count === 2 && points.length === 2 ? points : count === 1 && lines.length === 1 ? lineEnds(view, lines[0]) : undefined;
  if (pair) shape = { type: variant === 'auto' ? 'distance' : variant === 'horizontal' ? 'horizontalDistance' : 'verticalDistance', a: pair[0], b: pair[1] };
  else if (variant !== 'auto') return undefined;
  else if (count === 2 && points.length === 1 && lines.length === 1) shape = { type: 'distancePointLine', point: points[0], line: lines[0] };
  else if (count === 2 && lines.length === 2) shape = { type: 'angle', a: lines[0], b: lines[1] };
  else if (count === 1 && round.length === 1) shape = { type: roundDimension(kindOf(view, round[0])), curve: round[0] };
  if (!shape) return undefined;
  const value = measure(shape, view);
  if (value === undefined) return undefined;
  // úhel na celé stupně, délky na setiny; nulu engine u vzdálenosti, poloměru a úhlu nechce nebo nedává smysl
  const rounded = shape.type === 'angle' ? normalizeAngle((Math.round((value * 180) / Math.PI) * Math.PI) / 180) : Math.round(value * 100) / 100;
  return { ...shape, value: rounded === 0 && shape.type !== 'horizontalDistance' && shape.type !== 'verticalDistance' ? value : rounded, driving: true };
}

// Úhel v intervalu (−π, π], který engine u úhlové kóty vyžaduje.
export function normalizeAngle(angle: number): number {
  const turn = 2 * Math.PI;
  const wrapped = (((angle % turn) + turn) % turn); // [0, 2π)
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

// Smazání výběru: s křivkou zmizí i její body, které už nic dalšího nepoužívá; promítnutí se maže
// celé. Počátek a body promítnuté geometrie smazat nejdou.
export function deleteCommands(sketch: Id, feature: SketchFeature, view: SketchView, selection: Id[]): Command[] {
  const selected = new Set(selection);
  const points = new Set(selection.filter((id) => view.points.get(id)?.own));
  const curves = Object.keys(feature.curves).filter((id) => selected.has(id) || view.curves.get(id)?.points.some((p) => points.has(p)));
  const surviving = new Set(Object.keys(feature.curves).filter((id) => !curves.includes(id)).flatMap((id) => view.curves.get(id)?.points ?? []));
  for (const id of curves) for (const p of view.curves.get(id)?.points ?? []) if (p !== ORIGIN && !surviving.has(p)) points.add(p);
  return [
    ...curves.map((id): Command => ({ type: 'removeEntity', sketch, id })),
    ...[...points].map((id): Command => ({ type: 'removeEntity', sketch, id })),
    ...selection.filter((id) => feature.external[id]).map((id): Command => ({ type: 'removeExternal', sketch, id })),
  ];
}

// ---------------------------------------------------------------- rozpracované vysunutí a rovina

// A feature draft is in the input form (featureInput): a numeric field holds a number or an
// expression. When an existing feature is edited the form therefore sends its expressions back
// instead of removing them with numbers.
export type ExtrudeDraft = Input<ExtrudeFeature>;
type ProfileSourcePatch =
  | (Omit<Input<Extract<ProfileSource, { type: 'regions' }>>, 'offset'> & { offset: number | Expr | null })
  | Input<Extract<ProfileSource, { type: 'wall' }>>
  | (Omit<Input<Extract<ProfileSource, { type: 'generated' }>>, 'refs' | 'params'> & { params: Record<string, number | Expr | boolean | null>; refs: Record<string, Id | null> });
// A generated profile as a patch: every reference and every optional parameter of the catalog the
// draft does not have is removed by name.
function generatedPatch(profile: Extract<ExtrudeDraft['profile'], { type: 'generated' }>): ProfileSourcePatch {
  const spec = GENERATORS[profile.generator];
  const optional = Object.entries(spec.params).flatMap(([name, param]) => (!isFlag(param) && param.optional && profile.params[name] === undefined ? [[name, null] as const] : []));
  return { ...profile, params: { ...profile.params, ...Object.fromEntries(optional) }, refs: Object.fromEntries(Object.keys(spec.refs).map((name) => [name, profile.refs?.[name] ?? null])) };
}
export type PlaneDraft = Input<PlaneFeature>;

// A change of an extrusion draft.
// - A new body has no target; an addition and a cut without one get the last existing body. A target
//   that no longer exists is not rewritten on its own: the user should see it and change it.
// - An addition has exactly one target, so switching to it keeps the first one. A cut may have
//   several: `toggleTarget` adds or removes one of them.
// - "Through all" exists only for a cut: another operation turns it back into a distance. A new
//   "through all" goes to both sides (D35, decision 13). `distance` is the distance extent to return
//   to: the form passes the one the draft had last, so that switching the extent there and back
//   does not lose the start, the distance and their expressions.
// - `start`, `distance` and `taper` belong to the distance extent, `side` to "through all", and
//   `start`, `plane` and `gap` to an extent up to a plane (D47); a change for another variant is
//   ignored. The taper and the gap are optional fields (`null` removes them), and a generated
//   profile has no taper: a draft whose profile becomes generated drops it.
// - "Up to a plane" exists for every operation. `upTo` is the extent of that kind to return to (the
//   form passes the one the draft had last); a new one starts at the start of the distance and has
//   no plane until one is picked, and the draft is incomplete until then (`noPlane`).
// - `source` switches the profile between regions of the sketch, a wall along its curves and
//   a profile generator. A new generated profile gets the operands the form found in the sketch and
//   the defaults of the catalog; a new wall has no curves yet and the thickness `WALL_THICKNESS`.
//   `operands`, `params` and `refs` change entries of a generated profile (`null` removes a
//   reference or an optional parameter); `regions` and `offset` belong to a profile of regions (`null` removes the offset,
//   an optional field); `curves` and `thickness` belong to a wall.
// - `from` (D66) sets the plane the extent starts from, `null` removes it (the start is then the
//   sketch plane). The draft keeps its `from` across every change of the variant; the remembered
//   extents bring back their numbers, never a `from`. "Through all" from a plane goes forward or
//   backward: a new one, or one to both sides that gets a plane, goes backward.
export type ProfileKind = 'regions' | 'wall' | GeneratorName;
export const profileKind = (profile: ExtrudeDraft['profile']): ProfileKind => (profile.type === 'generated' ? profile.generator : profile.type);
export type ExtentKind = ExtrudeFeature['extent']['type'];
export type ExtentSide = Extract<ExtrudeFeature['extent'], { type: 'throughAll' }>['side'];
export interface ExtrudeChange {
  source?: ProfileKind;
  sketch?: Id;
  regions?: RegionRef[];
  offset?: number | Expr | null;
  curves?: Id[];
  thickness?: number | Expr;
  operands?: Record<string, Id>;
  params?: Record<string, number | Expr | boolean | null>;
  refs?: Record<string, Id | null>;
  extent?: ExtentKind;
  start?: number | Expr;
  distance?: number | Expr;
  taper?: number | Expr | null;
  side?: ExtentSide;
  plane?: PlaneRef;
  gap?: number | Expr | null;
  from?: PlaneRef | null;
  operation?: ExtrudeFeature['operation'];
  target?: Id;
  toggleTarget?: Id;
}
const DEFAULT_DISTANCE: ExtrudeDraft['extent'] = { type: 'distance', start: 0, distance: 10 };
export const WALL_THICKNESS = 2; // mm: what a new wall starts with
// A new generated profile: the example of the catalog entry for the required parameters and the
// defaults for the others, except an optional parameter, which a draft holds only while it has
// a value; the operands are filled in by the caller.
export function generatedProfile(generator: GeneratorName, sketch: Id, operands: Record<string, Id>): Extract<ExtrudeDraft['profile'], { type: 'generated' }> {
  const spec = GENERATORS[generator];
  const params = Object.fromEntries(Object.entries(spec.params).flatMap(([name, param]): [string, number | boolean][] => (isFlag(param) ? [[name, param.default]] : param.optional ? [] : [[name, param.default ?? spec.example[name] ?? 0]])));
  return { type: 'generated', generator, sketch, operands, params };
}

// The profile of each kind the draft had last. Switching the source and back returns to it instead
// of resetting regions, parameters and references, as long as the sketch is still the same.
export type RememberedProfiles = Partial<Record<ProfileKind, ExtrudeDraft['profile']>>;
export const rememberedProfile = (remembered: RememberedProfiles, source: ProfileKind, sketch: Id): ExtrudeDraft['profile'] | undefined => (remembered[source]?.sketch === sketch ? remembered[source] : undefined);

function changeProfile(profile: ExtrudeDraft['profile'], change: ExtrudeChange, remembered: RememberedProfiles): ExtrudeDraft['profile'] {
  const sketch = change.sketch ?? profile.sketch;
  let next = profile;
  if (change.source !== undefined && change.source !== profileKind(profile))
    next =
      rememberedProfile(remembered, change.source, sketch) ??
      (change.source === 'regions' ? { type: 'regions', sketch, regions: [] } : change.source === 'wall' ? { type: 'wall', sketch, curves: [], thickness: WALL_THICKNESS } : generatedProfile(change.source, sketch, {}));
  if (next.type === 'regions') {
    // the offset is an optional field: it is in the draft only while it has a value
    const { offset: old, ...rest } = next;
    const offset = change.offset === undefined ? old : change.offset;
    return { ...rest, sketch, ...(change.regions === undefined ? {} : { regions: change.regions }), ...(offset === undefined || offset === null ? {} : { offset }) };
  }
  if (next.type === 'wall') return { ...next, sketch, ...(change.curves === undefined ? {} : { curves: [...change.curves].sort() }), ...(change.thickness === undefined ? {} : { thickness: change.thickness }) };
  const refs = Object.fromEntries(Object.entries({ ...next.refs, ...change.refs }).filter((entry): entry is [string, Id] => entry[1] !== null));
  const params = Object.fromEntries(Object.entries({ ...next.params, ...change.params }).filter((entry): entry is [string, number | Expr | boolean] => entry[1] !== null));
  const { refs: _old, ...rest } = next;
  return { ...rest, sketch, operands: { ...next.operands, ...change.operands }, params, ...(Object.keys(refs).length ? { refs } : {}) };
}
export type UpToDraft = Extract<ExtrudeDraft['extent'], { type: 'upTo' }>;
// An extent up to a plane without a plane yet: the draft of the form holds it so until one is
// picked, and nothing is computed or sent meanwhile.
export const noPlane = (extent: ExtrudeDraft['extent']): boolean => extent.type === 'upTo' && extent.plane === undefined;
// The extent of a draft without its start plane, and with the one given or none (D66); the same
// object when it has that one already.
export const withoutFrom = <E extends { from?: PlaneRef }>(extent: E): Omit<E, 'from'> => {
  const { from: _from, ...rest } = extent;
  return rest;
};
export const withFrom = <E extends { from?: PlaneRef }>(extent: E, from: PlaneRef | undefined): E => (extent.from === from ? extent : ({ ...withoutFrom(extent), ...(from ? { from } : {}) } as E));

export function changeExtrude(draft: ExtrudeDraft, change: ExtrudeChange, bodies: Id[], lastDistance: ExtrudeDraft['extent'] = DEFAULT_DISTANCE, remembered: RememberedProfiles = {}, lastUpTo?: UpToDraft): ExtrudeDraft {
  const operation = change.operation ?? draft.operation;
  // the start plane of the draft wins over any a remembered extent had
  const from = change.from === undefined ? draft.extent.from : (change.from ?? undefined);
  const distance = withoutFrom(lastDistance) as ExtrudeDraft['extent'];
  const upTo = lastUpTo && (withoutFrom(lastUpTo) as UpToDraft);
  let extent = draft.extent;
  if (extent.type === 'throughAll' && operation !== 'cut') extent = distance;
  // a request for "through all" outside a cut is ignored: the draft keeps the distance it has
  if (change.extent === 'distance' && extent.type !== 'distance') extent = distance;
  if (change.extent === 'throughAll' && extent.type !== 'throughAll' && operation === 'cut') extent = { type: 'throughAll', side: 'both' };
  if (change.extent === 'upTo' && extent.type !== 'upTo') extent = upTo ?? ({ type: 'upTo', start: extent.type === 'distance' ? extent.start : 0 } as UpToDraft);
  const profile = changeProfile(draft.profile, change, remembered);
  if (extent.type === 'distance') {
    const { taper: old, ...rest } = extent;
    const taper = profile.type === 'generated' ? undefined : change.taper === undefined ? old : change.taper;
    extent = { ...rest, ...(change.start === undefined ? {} : { start: change.start }), ...(change.distance === undefined ? {} : { distance: change.distance }), ...(taper === undefined || taper === null ? {} : { taper }) };
  } else if (extent.type === 'upTo') {
    const { gap: old, ...rest } = extent;
    const gap = change.gap === undefined ? old : change.gap;
    extent = { ...rest, ...(change.start === undefined ? {} : { start: change.start }), ...(change.plane === undefined ? {} : { plane: change.plane }), ...(gap === undefined || gap === null ? {} : { gap }) };
  } else if (change.side !== undefined) extent = { ...extent, side: change.side };
  extent = withFrom(extent, from);
  if (extent.type === 'throughAll' && extent.from && extent.side === 'both') extent = { ...extent, side: 'backward' };
  let targets = change.target === undefined ? draft.targets : [change.target];
  if (change.toggleTarget !== undefined) targets = targets?.includes(change.toggleTarget) ? targets.filter((id) => id !== change.toggleTarget) : [...(targets ?? []), change.toggleTarget];
  if (operation === 'add' && targets && targets.length > 1) targets = targets.slice(0, 1);
  // An empty list (the user unticked every target of a cut) stays empty for a cut; the engine says
  // what is missing. An addition shows a select, which always displays some body, so it gets one.
  if (operation === 'add' && targets?.length === 0) targets = undefined;
  if (operation !== 'new' && targets === undefined && bodies.length > 0) targets = [bodies[bodies.length - 1]];
  const { targets: _old, ...rest } = draft;
  return {
    ...rest,
    profile,
    extent,
    operation,
    ...(operation === 'new' || targets === undefined ? {} : { targets }),
  };
}

// ---------------------------------------------------------------- pattern

export type PatternDraft = Input<PatternFeature>;
export type PatternTransformDraft = PatternDraft['transform'];
export type PatternKind = PatternTransformDraft['type'];
type CircularDraft = Extract<PatternTransformDraft, { type: 'circular' }>;
type LinearDraft = Extract<PatternTransformDraft, { type: 'linear' }>;
export type PatternSpan = CircularDraft['span'];
export type LinearSpan = LinearDraft['span'];
export type AxisKind = 'X' | 'Y' | 'Z' | 'sketchPoint' | 'sketchLine' | 'face';
export const axisKind = (axis: AxisRef): AxisKind => (axis.kind === 'base' ? axis.axis : axis.kind);
// The lines of a sketch an axis may run along (D58): its own lines, construction or not, then its
// projected ones.
export const lineIds = (sketch: SketchFeature): Id[] => [
  ...Object.entries(sketch.curves).filter(([, curve]) => curve.type === 'line').map(([id]) => id),
  ...Object.keys(sketch.external).flatMap((entry) => Object.entries(referenceEntities(sketch, entry)).filter(([, kind]) => kind === 'line').map(([id]) => id)),
];
// One change of the picker of an axis (the form of a pattern, the form of a joint of the mechanism,
// the form of a revolve): a base axis; `sketchPoint` (the origin of the latest of `sketches` until
// `sketch` and `point` say otherwise; another sketch starts at its origin); or `sketchLine` (the
// first line of the latest of `sketches` that has one, by `lines`, until `sketch` and `line` say
// otherwise; another sketch starts at its first line). Without a sketch that has a line the kind
// `sketchLine` changes nothing. The axis of a round face (D60) comes only with `face`, the face
// picked in the view; the kind `face` alone changes nothing.
export interface AxisChange {
  axis?: AxisKind;
  sketch?: Id;
  point?: Id;
  line?: Id;
  face?: { body: Id; face: FaceName };
}
export function changeAxis(axis: AxisRef, change: AxisChange, sketches: Id[], lines: (sketch: Id) => Id[] = () => []): AxisRef {
  let out = axis;
  if (change.face !== undefined) return { kind: 'face', body: change.face.body, face: change.face.face };
  if (change.axis !== undefined && change.axis !== axisKind(out) && change.axis !== 'face') {
    const sketch = sketches[sketches.length - 1];
    const withLine = [...sketches].reverse().find((id) => lines(id).length > 0);
    if (change.axis === 'sketchLine') {
      if (withLine !== undefined) out = { kind: 'sketchLine', sketch: withLine, line: lines(withLine)[0] };
    } else if (change.axis !== 'sketchPoint') out = { kind: 'base', axis: change.axis };
    else if (sketch !== undefined) out = { kind: 'sketchPoint', sketch, point: 'origin' };
  }
  if (change.sketch !== undefined && out.kind === 'sketchPoint' && change.sketch !== out.sketch) out = { kind: 'sketchPoint', sketch: change.sketch, point: 'origin' };
  if (change.sketch !== undefined && out.kind === 'sketchLine' && change.sketch !== out.sketch) out = { kind: 'sketchLine', sketch: change.sketch, line: lines(change.sketch)[0] ?? out.line };
  if (change.point !== undefined && out.kind === 'sketchPoint') out = { ...out, point: change.point };
  if (change.line !== undefined && out.kind === 'sketchLine') out = { ...out, line: change.line };
  return out;
}
// An axis in a sentence: "the axis Z", "the normal through p1 of Sketch 1", "the line ka of knob",
// "the axis of the face <label>" (`faceText` names the face with its body).
export const axisText = (axis: AxisRef, nameOf: (id: Id) => string, faceText: (body: Id, face: FaceName) => string): string =>
  axis.kind === 'base'
    ? `the axis ${axis.axis}`
    : axis.kind === 'sketchPoint'
      ? `the normal through ${axis.point} of ${nameOf(axis.sketch)}`
      : axis.kind === 'sketchLine'
        ? `the line ${axis.line} of ${nameOf(axis.sketch)}`
        : `the axis of ${faceText(axis.body, axis.face)}`;
// One change of the pattern form.
// - `source`: the other kind of source, filled with the latest choice of that kind.
// - `toggleFeature`: adds a source feature or removes it; the list keeps the order of the timeline.
// - `kind`: another kind of the transform: the transform the draft had in that kind before, or
//   a new one (a linear pattern along X, a count of 3 and a spacing of 10; a mirror in the base
//   plane YZ; a circular pattern around Z, a count of 4 over the full circle).
// - `axis`, `sketch`, `point`: the axis of a circular pattern or the direction of a linear one
//   (`sketchPoint`: the origin of the latest sketch until `sketch` and `point` say otherwise).
// - `span`: of a circular pattern `full` or `angle`, of a linear one `spacing` or `length`; the
//   span the draft had last of that type comes back.
// - `plane`: the plane of a mirror.
// - `grid`: a linear pattern gets a second direction (D53): the one the draft had last, or a new one
//   (a base axis other than the first direction, a count of 2 and a spacing of 10); `false`
//   removes it.
// - `second`: a change of the second direction: its axis, count and span, as for the first.
export interface PatternChange extends AxisChange {
  source?: 'features' | 'body';
  toggleFeature?: Id;
  body?: Id;
  kind?: PatternKind;
  count?: number | Expr;
  span?: PatternSpan['type'] | LinearSpan['type'];
  angle?: number | Expr;
  spacing?: number | Expr;
  length?: number | Expr;
  plane?: PlaneRef;
  grid?: boolean;
  second?: DirectionChange;
}
// One change of a direction of a linear pattern: its axis, its count, the type of its span and
// the value of the span.
export interface DirectionChange extends AxisChange {
  count?: number | Expr;
  span?: LinearSpan['type'];
  spacing?: number | Expr;
  length?: number | Expr;
}
export type SecondDraft = NonNullable<LinearDraft['second']>;
// What the form remembers beyond the draft, to return to: the transform the draft had in each
// kind, and the span of each type it had last. The second direction of a grid has slots of its
// own: `second`, the second direction the draft had last (written only while the draft has one, so
// that clearing the checkbox, changing the first direction or another kind does not lose it), and
// `secondSpacing`, `secondLength`, the span of each type it had last (`spacing` and `length` are
// those of the first direction).
export interface PatternMemory {
  kinds?: Partial<Record<PatternKind, PatternTransformDraft>>;
  angle?: PatternSpan;
  spacing?: LinearSpan;
  length?: LinearSpan;
  second?: SecondDraft;
  secondSpacing?: LinearSpan;
  secondLength?: LinearSpan;
}
// The memory with what the draft has now.
export function rememberPattern(memory: PatternMemory, draft: PatternDraft): PatternMemory {
  const t = draft.transform;
  const span = t.type === 'circular' && t.span.type === 'angle' ? { angle: t.span } : t.type === 'linear' ? { [t.span.type]: t.span } : {};
  const second = t.type === 'linear' && t.second ? { second: t.second, [t.second.span.type === 'spacing' ? 'secondSpacing' : 'secondLength']: t.second.span } : {};
  return { ...memory, ...span, ...second, kinds: { ...memory.kinds, [t.type]: t } };
}
// What the form offers at the place of the pattern on the timeline, in the order of the timeline:
// extrusions that add or cut, bodies and sketches.
export interface PatternChoices {
  tools: Id[];
  bodies: Id[];
  sketches: Id[];
  lines?: (sketch: Id) => Id[]; // the lines of a sketch an axis may run along
}
const DEFAULT_ANGLE: PatternSpan = { type: 'angle', angle: Math.PI / 2 };
const DEFAULT_SPAN: Record<LinearSpan['type'], LinearSpan> = { spacing: { type: 'spacing', spacing: 10 }, length: { type: 'length', length: 20 } };
export const NEW_TRANSFORM: Record<PatternKind, PatternTransformDraft> = {
  circular: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } },
  linear: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: DEFAULT_SPAN.spacing },
  mirror: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } },
};
const last = <T>(items: T[]): T | undefined => items[items.length - 1];

// The first source of a new pattern: `preferred` (the feature selected on the timeline) when it is
// a tool or made a body, otherwise the latest tool, otherwise the latest body.
export function patternSource(choices: PatternChoices, preferred?: Id): PatternDraft['source'] | undefined {
  if (preferred !== undefined && choices.tools.includes(preferred)) return { type: 'features', features: [preferred] };
  if (preferred !== undefined && choices.bodies.includes(preferred)) return { type: 'body', body: preferred };
  const tool = last(choices.tools);
  if (tool !== undefined) return { type: 'features', features: [tool] };
  const body = last(choices.bodies);
  return body === undefined ? undefined : { type: 'body', body };
}

// A pattern draft the engine has nothing to compute for yet: no source feature, or no body.
export const patternIncomplete = (draft: PatternDraft): boolean => (draft.source.type === 'features' ? draft.source.features.length === 0 : draft.source.body === '');

export function changePattern(draft: PatternDraft, change: PatternChange, choices: PatternChoices, memory: PatternMemory = {}): PatternDraft {
  let { source } = draft;
  if (change.source !== undefined && change.source !== source.type) {
    const tool = last(choices.tools);
    source = change.source === 'features' ? { type: 'features', features: tool === undefined ? [] : [tool] } : { type: 'body', body: last(choices.bodies) ?? '' };
  }
  if (change.toggleFeature !== undefined && source.type === 'features') {
    const id = change.toggleFeature;
    const picked = source.features.includes(id) ? source.features.filter((other) => other !== id) : [...source.features, id];
    // a feature that is no longer on offer (removed, moved behind the pattern) stays where it was: in front
    const order = (other: Id): number => choices.tools.indexOf(other);
    source = { type: 'features', features: [...picked].sort((a, b) => order(a) - order(b)) };
  }
  if (change.body !== undefined && source.type === 'body') source = { type: 'body', body: change.body };
  return { ...draft, source, transform: changeTransform(draft.transform, change, choices, memory) };
}

function changeTransform(given: PatternTransformDraft, change: PatternChange, choices: PatternChoices, memory: PatternMemory): PatternTransformDraft {
  const transform = change.kind !== undefined && change.kind !== given.type ? (memory.kinds?.[change.kind] ?? NEW_TRANSFORM[change.kind]) : given;
  if (transform.type === 'mirror') return change.plane ? { ...transform, plane: change.plane } : transform;
  const count = change.count ?? transform.count;
  if (transform.type === 'linear') {
    const { second: had, ...rest } = transform;
    const span = change.span === 'spacing' || change.span === 'length' ? change.span : undefined;
    const first = changeDirection(rest, { ...change, span }, choices.sketches, memory, choices.lines);
    let second = change.grid === false ? undefined : (had ?? (change.grid ? (memory.second ?? newSecond(first.direction)) : undefined));
    if (second && change.second) second = changeDirection(second, change.second, choices.sketches, { spacing: memory.secondSpacing, length: memory.secondLength }, choices.lines);
    return second ? { ...first, second } : first;
  }
  let { span } = transform;
  if ((change.span === 'full' || change.span === 'angle') && change.span !== span.type) span = change.span === 'full' ? { type: 'full' } : (memory.angle ?? DEFAULT_ANGLE);
  if (change.angle !== undefined && span.type === 'angle') span = { type: 'angle', angle: change.angle };
  return { ...transform, axis: changeAxis(transform.axis, change, choices.sketches, choices.lines), count, span };
}

// A direction of a linear pattern changed: the axis, the count, the span of another type (the one
// of that type it had last, from `spans`), the value of the span.
function changeDirection<D extends { direction: AxisRef; count: number | Expr; span: LinearSpan }>(d: D, change: DirectionChange, sketches: Id[], spans: { spacing?: LinearSpan; length?: LinearSpan }, lines?: (sketch: Id) => Id[]): D {
  let { span } = d;
  if (change.span !== undefined && change.span !== span.type) span = spans[change.span] ?? DEFAULT_SPAN[change.span];
  if (change.spacing !== undefined && span.type === 'spacing') span = { type: 'spacing', spacing: change.spacing };
  if (change.length !== undefined && span.type === 'length') span = { type: 'length', length: change.length };
  return { ...d, direction: changeAxis(d.direction, change, sketches, lines), count: change.count ?? d.count, span };
}
// A new second direction: a base axis other than the first direction (Y, or X when the first is
// Y), a count of 2 and a spacing of 10. It may still lie along a first direction that is the
// normal of a sketch; the preview then says which copies meet.
const newSecond = (first: AxisRef): SecondDraft => ({ direction: { kind: 'base', axis: first.kind === 'base' && first.axis === 'Y' ? 'X' : 'Y' }, count: 2, span: DEFAULT_SPAN.spacing });

// Příkaz, kterým se rozpracovaná feature založí nebo (při úpravě existující) změní.
export function draftCommand(draft: ExtrudeDraft | PlaneDraft | PatternDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  // a second plane or a tilt the draft no longer has is removed by name (D60)
  if (draft.type === 'plane') return { type: 'updateFeature', id: draft.id, patch: { base: draft.base, offset: draft.offset, midplaneWith: draft.midplaneWith ?? null, tilt: draft.tilt ?? null } };
  // The draft holds every field of the source and the transform, so merging them replaces both; a
  // second direction the draft no longer has is removed by name (a patch of the same type merges).
  if (draft.type === 'pattern') {
    const transform = draft.transform.type === 'linear' && !draft.transform.second ? { ...draft.transform, second: null } : draft.transform;
    return { type: 'updateFeature', id: draft.id, patch: { source: draft.source, transform } };
  }
  const { id, operation, targets } = draft;
  // The patch merges with the feature, so what the draft no longer has must be removed explicitly:
  // the offset of regions, a reference and an optional parameter of a generated profile, the taper
  // of a distance, the gap of an extent up to a plane and the start plane of any extent. Every other
  // entry of the profile and of the extent is in the draft.
  const from = { from: draft.extent.from ?? null };
  const extent = draft.extent.type === 'distance' ? { ...draft.extent, taper: draft.extent.taper ?? null, ...from } : draft.extent.type === 'upTo' ? { ...draft.extent, gap: draft.extent.gap ?? null, ...from } : { ...draft.extent, ...from };
  const profile: ProfileSourcePatch = draft.profile.type === 'regions' ? { ...draft.profile, offset: draft.profile.offset ?? null } : draft.profile.type === 'wall' ? draft.profile : generatedPatch(draft.profile);
  return { type: 'updateFeature', id, patch: { profile, extent, operation, ...(operation === 'new' || targets === undefined ? {} : { targets }) } };
}

// ID koncových bodů úsečky (u promítnuté jsou odvozené).
function lineEnds(view: SketchView, line: Id): [Id, Id] | undefined {
  const curve = view.curves.get(line);
  return curve?.shape.type === 'line' ? [curve.points[0], curve.points[1]] : undefined;
}

// Příkazy kreslicího nástroje v konstrukčním režimu: nové křivky jsou pomocné a netvoří profil.
export const asConstruction = (commands: Command[]): Command[] =>
  commands.map((command) => (command.type === 'addCurve' ? { ...command, curve: { ...command.curve, construction: true } } : command));
