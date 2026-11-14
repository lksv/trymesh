// Příkazy, které posílají kreslicí nástroje a tlačítka vazeb. Čisté funkce: z kliknutí a výběru
// sestaví příkazy enginu; ID nových entit dodává volající (viz docs/ui.md, bod 9).
import { CONSTRAINTS, type Command, type Constraint, type Dimension, type DimensionShape, type ExtrudeFeature, type GeometricConstraint, type Id, type PlaneFeature, type RegionRef, type SketchFeature, type Vec2 } from '@trymesh/engine';
import { type EntityKind, ORIGIN, type SketchView, closestOn, dist, kindOf, measure } from './sketch-view';

// Místo kliknutí ve skice a to, k čemu se přichytilo.
export interface Anchor {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}
export type NewId = (prefix: string) => Id;

// Body blíž než tohle jsou pro kreslení tentýž bod: křivka mezi nimi by měla nulovou délku
// a zneplatnila by profil skici.
const SAME_PLACE = 1e-6;

interface Placed {
  id: Id; // bod, na který může odkazovat křivka
  commands: Command[];
}

// Bod pro konec křivky. Vlastní bod a počátek se použijí znovu; na promítnutý bod křivka odkazovat
// nesmí, proto vznikne nový bod s vazbou totožnosti. Přichycení na křivku přidá vazbu bodu na křivce.
export function place(sketch: Id, view: SketchView, anchor: Anchor, newId: NewId): Placed {
  const snap = anchor.snap;
  if (snap?.kind === 'point' && (snap.id === ORIGIN || view.points.get(snap.id)?.own)) return { id: snap.id, commands: [] };
  const id = newId('p');
  const at = snap?.kind === 'point' ? (view.points.get(snap.id)?.at ?? anchor.at) : snap?.kind === 'curve' ? closestOnCurve(view, snap.id, anchor.at) : anchor.at;
  const commands: Command[] = [{ type: 'addPoint', sketch, id, x: at[0], y: at[1] }];
  if (snap?.kind === 'point') commands.push({ type: 'addConstraint', sketch, id: newId('k'), constraint: { type: 'coincident', a: id, b: snap.id } });
  if (snap?.kind === 'curve') commands.push({ type: 'addConstraint', sketch, id: newId('k'), constraint: { type: 'pointOnCurve', point: id, curve: snap.id } });
  return { id, commands };
}

const closestOnCurve = (view: SketchView, curve: Id, p: Vec2): Vec2 => {
  const shape = view.curves.get(curve)?.shape;
  return shape ? closestOn(shape, p) : p;
};

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

// Obdélník ze dvou protilehlých rohů: čtyři body, čtyři úsečky, dvě vodorovné a dvě svislé.
export function rectangleCommands(sketch: Id, view: SketchView, first: Anchor, opposite: Anchor, newId: NewId): Command[] | undefined {
  const a = place(sketch, view, first, newId);
  const c = place(sketch, view, opposite, newId);
  const [pa, pc] = [positionOf(view, first), positionOf(view, opposite)];
  if (a.id === c.id || Math.abs(pa[0] - pc[0]) <= SAME_PLACE || Math.abs(pa[1] - pc[1]) <= SAME_PLACE) return undefined;
  const [b, d] = [newId('p'), newId('p')];
  const corners = [a.id, b, c.id, d];
  const commands: Command[] = [...a.commands, ...c.commands, { type: 'addPoint', sketch, id: b, x: pc[0], y: pa[1] }, { type: 'addPoint', sketch, id: d, x: pa[0], y: pc[1] }];
  corners.forEach((corner, i) => {
    const line = newId('c');
    commands.push({ type: 'addCurve', sketch, id: line, curve: { type: 'line', a: corner, b: corners[(i + 1) % 4] } });
    commands.push({ type: 'addConstraint', sketch, id: newId('k'), constraint: { type: i % 2 === 0 ? 'horizontal' : 'vertical', line } });
  });
  return commands;
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

// Kde přichycené kliknutí skutečně leží.
export function positionOf(view: SketchView, anchor: Anchor): Vec2 {
  if (anchor.snap?.kind === 'point') return view.points.get(anchor.snap.id)?.at ?? anchor.at;
  if (anchor.snap?.kind === 'curve') return closestOnCurve(view, anchor.snap.id, anchor.at);
  return anchor.at;
}

// ---------------------------------------------------------------- vazby z výběru

export type GeometricKind = GeometricConstraint['type'];

// Geometrické vazby, které engine zná (vazby bez hodnoty), v pořadí katalogu. Nová vazba enginu
// se tu objeví sama.
export const GEOMETRIC_KINDS: GeometricKind[] = (Object.keys(CONSTRAINTS) as Constraint['type'][]).filter((type) => !CONSTRAINTS[type].value) as GeometricKind[];

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

// Změna rozpracovaného vysunutí. Nové těleso cíl nemá; přidání a výřez bez cíle dostanou poslední
// existující těleso. Cíl, který už neexistuje, se sám nepřepisuje: má ho vidět a změnit uživatel.
export interface ExtrudeChange {
  sketch?: Id;
  regions?: RegionRef[];
  distance?: number;
  operation?: ExtrudeFeature['operation'];
  target?: Id;
}
export function changeExtrude(draft: ExtrudeFeature, change: ExtrudeChange, bodies: Id[]): ExtrudeFeature {
  const next: ExtrudeFeature = {
    ...draft,
    profile: { ...draft.profile, ...(change.sketch === undefined ? {} : { sketch: change.sketch }), ...(change.regions === undefined ? {} : { regions: change.regions }) },
    extent: { ...draft.extent, ...(change.distance === undefined ? {} : { distance: change.distance }) },
    operation: change.operation ?? draft.operation,
    ...(change.target === undefined ? {} : { targets: [change.target] }),
  };
  if (next.operation === 'new') delete next.targets;
  else if (next.targets === undefined && bodies.length > 0) next.targets = [bodies[bodies.length - 1]];
  return next;
}

// Příkaz, kterým se rozpracovaná feature založí nebo (při úpravě existující) změní.
export function draftCommand(draft: ExtrudeFeature | PlaneFeature, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  if (draft.type === 'plane') return { type: 'updateFeature', id: draft.id, patch: { base: draft.base, offset: draft.offset } };
  const { id, profile, extent, operation, targets } = draft;
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
