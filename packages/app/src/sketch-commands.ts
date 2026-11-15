// Příkazy, které posílají kreslicí nástroje a tlačítka vazeb. Čisté funkce: z kliknutí a výběru
// sestaví příkazy enginu; ID nových entit dodává volající (viz docs/ui.md, bod 9).
import {
  CONSTRAINTS,
  type Command,
  type Constraint,
  type Dimension,
  type DimensionShape,
  type Expr,
  type ExtrudeFeature,
  GENERATORS,
  type GeneratorName,
  type GeometricConstraint,
  type Id,
  type Input,
  type PatternFeature,
  type PlaneFeature,
  type ProfileSource,
  type RegionRef,
  type SketchFeature,
  type Anchor,
  type NewId,
  type Placed,
  type SketchToolInputs,
  type Vec2,
  anchorPosition,
  isFlag,
  placeAnchor,
  sketchTool,
} from '@trymesh/engine';
import { type EntityKind, ORIGIN, type PointView, type SketchView, dist, kindOf, measure } from './sketch-view';

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

// The rectangle and the regular polygon are sketch tools of the engine, shared with MCP; here they
// only get the clicks. undefined = the clicks cannot be drawn (both at one place).
export function rectangleCommands(_sketch: Id, view: SketchView, first: Anchor, opposite: Anchor, newId: NewId): Command[] | undefined {
  const made = sketchTool('rectangle', view.source, { first, opposite }, newId);
  return made.ok ? made.commands : undefined;
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

export function polygonCommands(_sketch: Id, view: SketchView, center: Anchor, vertex: Anchor, options: PolygonOptions, newId: NewId): Command[] | undefined {
  const sizeKind = polygonSizeKind(options);
  const made = sketchTool('polygon', view.source, { center, vertex, sides: options.sides, ...(sizeKind === 'none' ? {} : { sizeKind }) }, newId);
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
    if (kind === 'point') out.points.push(id);
    else if (kind === 'line') out.lines.push(id);
    else if (kind) out.round.push(id);
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
  else if (count === 1 && round.length === 1) shape = { type: kindOf(view, round[0]) === 'circle' ? 'diameter' : 'radius', curve: round[0] };
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
  | (Omit<Input<Extract<ProfileSource, { type: 'generated' }>>, 'refs'> & { refs: Record<string, Id | null> });
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
// - `start` and `distance` belong to the distance extent and `side` to "through all"; a change for
//   the other variant is ignored.
// - `source` switches the profile between regions of the sketch, a wall along its curves and
//   a profile generator. A new generated profile gets the operands the form found in the sketch and
//   the defaults of the catalog; a new wall has no curves yet and the thickness `WALL_THICKNESS`.
//   `operands`, `params` and `refs` change entries of a generated profile (`null` removes a
//   reference); `regions` and `offset` belong to a profile of regions (`null` removes the offset,
//   an optional field); `curves` and `thickness` belong to a wall.
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
  params?: Record<string, number | Expr | boolean>;
  refs?: Record<string, Id | null>;
  extent?: ExtentKind;
  start?: number | Expr;
  distance?: number | Expr;
  side?: ExtentSide;
  operation?: ExtrudeFeature['operation'];
  target?: Id;
  toggleTarget?: Id;
}
const DEFAULT_DISTANCE: ExtrudeDraft['extent'] = { type: 'distance', start: 0, distance: 10 };
export const WALL_THICKNESS = 2; // mm: what a new wall starts with
// What a new draft starts with where the catalog has no default (the parameter is required).
const FORM_DEFAULTS: Record<GeneratorName, Record<string, number>> = { involuteGear: { teeth: 18 } };

// A new generated profile: the defaults of the catalog; the operands are filled in by the caller.
export function generatedProfile(generator: GeneratorName, sketch: Id, operands: Record<string, Id>): Extract<ExtrudeDraft['profile'], { type: 'generated' }> {
  const params = Object.fromEntries(Object.entries(GENERATORS[generator].params).map(([name, spec]) => [name, isFlag(spec) ? spec.default : (spec.default ?? FORM_DEFAULTS[generator][name] ?? 0)]));
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
  const { refs: _old, ...rest } = next;
  return { ...rest, sketch, operands: { ...next.operands, ...change.operands }, params: { ...next.params, ...change.params }, ...(Object.keys(refs).length ? { refs } : {}) };
}
export function changeExtrude(draft: ExtrudeDraft, change: ExtrudeChange, bodies: Id[], distance: ExtrudeDraft['extent'] = DEFAULT_DISTANCE, remembered: RememberedProfiles = {}): ExtrudeDraft {
  const operation = change.operation ?? draft.operation;
  let extent = draft.extent;
  if (extent.type === 'throughAll' && operation !== 'cut') extent = distance;
  // a request for "through all" outside a cut is ignored: the draft keeps the distance it has
  if (change.extent === 'distance' && extent.type !== 'distance') extent = distance;
  if (change.extent === 'throughAll' && extent.type !== 'throughAll' && operation === 'cut') extent = { type: 'throughAll', side: 'both' };
  if (extent.type === 'distance') extent = { ...extent, ...(change.start === undefined ? {} : { start: change.start }), ...(change.distance === undefined ? {} : { distance: change.distance }) };
  else if (change.side !== undefined) extent = { ...extent, side: change.side };
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
    profile: changeProfile(draft.profile, change, remembered),
    extent,
    operation,
    ...(operation === 'new' || targets === undefined ? {} : { targets }),
  };
}

// ---------------------------------------------------------------- pattern

export type PatternDraft = Input<PatternFeature>;
export type PatternSpan = PatternDraft['transform']['span'];
export type AxisKind = 'X' | 'Y' | 'Z' | 'sketchPoint';
export const axisKind = (axis: PatternDraft['transform']['axis']): AxisKind => (axis.kind === 'base' ? axis.axis : 'sketchPoint');
// One change of the pattern form.
// - `source`: the other kind of source, filled with the latest choice of that kind.
// - `toggleFeature`: adds a source feature or removes it; the list keeps the order of the timeline.
// - `axis`: a base axis, or `sketchPoint` (the origin of the latest sketch until `sketch` and
//   `point` say otherwise).
// - `span`: `angle` returns to the angle the draft had last.
export interface PatternChange {
  source?: 'features' | 'body';
  toggleFeature?: Id;
  body?: Id;
  axis?: AxisKind;
  sketch?: Id;
  point?: Id;
  count?: number | Expr;
  span?: PatternSpan['type'];
  angle?: number | Expr;
}
// What the form offers at the place of the pattern on the timeline, in the order of the timeline:
// extrusions that add or cut, bodies and sketches.
export interface PatternChoices {
  tools: Id[];
  bodies: Id[];
  sketches: Id[];
}
const DEFAULT_ANGLE: PatternSpan = { type: 'angle', angle: Math.PI / 2 };
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

export function changePattern(draft: PatternDraft, change: PatternChange, choices: PatternChoices, angle: PatternSpan = DEFAULT_ANGLE): PatternDraft {
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

  let { axis, span } = draft.transform;
  if (change.axis !== undefined && change.axis !== axisKind(axis)) {
    const sketch = last(choices.sketches);
    if (change.axis !== 'sketchPoint') axis = { kind: 'base', axis: change.axis };
    else if (sketch !== undefined) axis = { kind: 'sketchPoint', sketch, point: 'origin' };
  }
  if (change.sketch !== undefined && axis.kind === 'sketchPoint' && change.sketch !== axis.sketch) axis = { kind: 'sketchPoint', sketch: change.sketch, point: 'origin' };
  if (change.point !== undefined && axis.kind === 'sketchPoint') axis = { ...axis, point: change.point };
  if (change.span !== undefined && change.span !== span.type) span = change.span === 'full' ? { type: 'full' } : angle;
  if (change.angle !== undefined && span.type === 'angle') span = { type: 'angle', angle: change.angle };
  return { ...draft, source, transform: { ...draft.transform, axis, count: change.count ?? draft.transform.count, span } };
}

// Příkaz, kterým se rozpracovaná feature založí nebo (při úpravě existující) změní.
export function draftCommand(draft: ExtrudeDraft | PlaneDraft | PatternDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  if (draft.type === 'plane') return { type: 'updateFeature', id: draft.id, patch: { base: draft.base, offset: draft.offset } };
  // the draft holds every field of the source and the transform, so merging them replaces both
  if (draft.type === 'pattern') return { type: 'updateFeature', id: draft.id, patch: { source: draft.source, transform: draft.transform } };
  const { id, extent, operation, targets } = draft;
  // The patch merges with the feature, so what the draft no longer has must be removed explicitly:
  // the offset of regions and a reference of a generated profile. Every other entry of the
  // profile is in the draft.
  const profile: ProfileSourcePatch =
    draft.profile.type === 'regions' ? { ...draft.profile, offset: draft.profile.offset ?? null } : draft.profile.type === 'wall' ? draft.profile : { ...draft.profile, refs: Object.fromEntries(Object.keys(GENERATORS[draft.profile.generator].refs).map((name) => [name, draft.profile.type === 'generated' ? (draft.profile.refs?.[name] ?? null) : null])) };
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
