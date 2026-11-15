// The sketch mode: its tools, what a press, a move and a click in the view mean, the drag of
// a point, and what the mode draws. The app keeps the pointer and key handlers and hands the events
// over; the panel of the mode is panels/sketch.ts.
import { type Command, type CommandResult, type Constraint, type ConstraintExplanation, type EngineState, type Frame, type Id, type SketchDiagnosis, type SketchFeature, type SketchResult, type Vec2, constraintKey, duplicateOf, isDimension } from '@trymesh/engine';
import { fmt } from './dom';
import { COLOR, pushPolyline, toWorld } from './draw';
import { PICK_REACH, type PanelHost, type ViewPick, pickKey } from './host';
import { type Anchor, type PolygonOptions, arcCommands, asConstruction, circleCommands, deleteCommands, lineCommands, pointCommands, polygonCommands, positionOf, rectangleCommands } from './sketch-commands';
import { freeEntities } from './sketch-diagnosis';
import { type Shape, type SketchView, anchorOf, closestOn, hitCurve, hitPoint, kindOf, operandsOf, polyline, sketchView } from './sketch-view';
import type { SceneModel } from './viewport';

export type Tool = 'select' | 'point' | 'line' | 'rect' | 'polygon' | 'circle' | 'arc' | 'project';

export interface SketchMode {
  kind: 'sketch';
  id: Id;
  tool: Tool;
  clicks: Anchor[]; // dosud zadané body rozpracovaného tvaru
  cursor?: Anchor;
  infer?: 'horizontal' | 'vertical';
  selection: Id[];
  hover?: Id;
  hoverConstraint?: Id;
  focus?: Id; // vazba označená v seznamu: pohled ukáže ji a vazby, ze kterých plyne
  construction?: boolean; // kreslicí nástroje zakládají konstrukční křivky
  hoverEdge?: ViewPick;
  drag?: { point: Id; moved: boolean };
  preview?: EngineState; // stav při tažení bodu
  repair?: Id; // promítnutí, které další kliknutí nástrojem Promítnout opraví
}
export const sketchMode = (id: Id): SketchMode => ({ kind: 'sketch', id, tool: 'select', clicks: [], selection: [] });

// The open sketch as it is shown: the feature, its solution, its plane and the view of both.
export interface SketchContext {
  feature: SketchFeature;
  result: SketchResult;
  frame: Frame;
  view: SketchView;
}
export function sketchContextOf(state: EngineState, id: Id): SketchContext | undefined {
  const feature = state.document.features.find((f) => f.id === id);
  const result = state.evaluation.features[id];
  if (feature?.type !== 'sketch' || !result?.sketch || !result.plane) return undefined;
  return { feature, result: result.sketch, frame: result.plane, view: sketchView(feature, result.sketch) };
}

// What the mode remembers beyond one sketch. The app holds it; the mode and its panel read and write it.
export interface SketchState {
  polygon: PolygonOptions; // what the polygon tool draws
  explained?: { diagnosis: SketchDiagnosis; id: Id; value: ConstraintExplanation }; // the explanation asked last
}

// What the sketch mode and its panel use of the app beyond what every panel does.
export interface SketchHost extends PanelHost {
  readonly sketch: SketchMode | undefined; // the open sketch, if one is open
  readonly sketching: SketchState;
  sketchContext(): SketchContext | undefined; // of the open sketch; kept until the shown state changes
  pick(event: PointerEvent, want: { edges?: boolean; faces?: boolean; planes?: boolean }): ViewPick | undefined; // what is under the pointer in the model
  pixelSize(): number; // millimetres per pixel of the view
}

export const TOOLS: [Tool, string, string][] = [
  ['select', 'Výběr', 'Klikněte na bod nebo křivku (Shift přidává). Bod lze táhnout.'],
  ['point', 'Bod', 'Klikněte na místo bodu.'],
  ['line', 'Úsečka', 'Klikejte na konce úseček; řetěz ukončí Esc nebo napojení na existující bod.'],
  ['rect', 'Obdélník', 'Klikněte na dva protilehlé rohy.'],
  ['polygon', 'Polygon', 'Click the centre and then a vertex; the number of sides is set in the panel.'],
  ['circle', 'Kružnice', 'Klikněte na střed a pak na bod obvodu.'],
  ['arc', 'Oblouk', 'Klikněte na střed, začátek a konec (proti směru hodin).'],
  ['project', 'Promítnout', 'Klikněte na hranu tělesa (úsečku nebo kružnici).'],
];

export function setTool(host: SketchHost, tool: Tool): void {
  if (!host.sketch) return;
  Object.assign(host.sketch, { tool, clicks: [], cursor: undefined, infer: undefined, hover: undefined, hoverEdge: undefined, repair: undefined });
  host.say(TOOLS.find(([name]) => name === tool)?.[2] ?? '');
  host.refresh();
}

// After a change of the document: what the mode holds of things the sketch no longer has is dropped.
export function settleSketch(m: SketchMode, context: SketchContext | undefined): void {
  const view = context?.view;
  m.selection = m.selection.filter((id) => view && kindOf(view, id));
  m.clicks = m.clicks.filter((a) => !a.snap || (view && kindOf(view, a.snap.id)));
  if (m.repair && !context?.feature.external[m.repair]) m.repair = undefined;
  // místo pod kurzorem se po změně skici počítá znovu: přichycení mohlo vzniknout nebo zaniknout
  m.cursor = undefined;
  m.infer = undefined;
  m.hover = undefined;
}

// Escape takes one step back: the shape in progress, the repair, the tool, the selection, the focus.
export function sketchEscape(m: SketchMode): void {
  if (m.clicks.length > 0) m.clicks = [];
  else if (m.repair) m.repair = undefined;
  else if (m.tool !== 'select') m.tool = 'select';
  else if (m.selection.length > 0) m.selection = [];
  else m.focus = undefined;
}

// A press with the select tool on a point of the sketch starts its drag. True: the app captures the pointer.
export function sketchDown(host: SketchHost, m: SketchMode, event: PointerEvent): boolean {
  if (m.tool !== 'select') return false;
  const context = host.sketchContext();
  const anchor = context && anchorAt(host, event, context);
  const id = anchor?.snap?.kind === 'point' ? anchor.snap.id : undefined;
  if (!id || !context?.view.points.get(id)?.own) return false;
  m.drag = { point: id, moved: false };
  return true;
}

// The end of a drag that moved its point: the preview goes and the command runs.
export function dropPoint(host: SketchHost, m: SketchMode, point: Id, event: PointerEvent): void {
  const frame = host.sketchContext()?.frame;
  const p = frame && host.planePoint(event, frame)?.at;
  m.preview = undefined;
  host.invalidate();
  if (!p || !host.run({ type: 'dragPoint', sketch: m.id, point, x: p[0], y: p[1] })) host.refresh();
}

// Místo pod kurzorem ve skice a přichycení: bod má přednost před křivkou.
function anchorAt(host: SketchHost, event: { clientX: number; clientY: number }, context: SketchContext): Anchor | undefined {
  const p = host.planePoint(event, context.frame)?.at;
  if (!p) return undefined;
  const reach = PICK_REACH * host.pixelSize();
  const point = hitPoint(context.view, p, reach);
  if (point) return { at: point.at, snap: { kind: 'point', id: point.id } };
  const curve = hitCurve(context.view, p, reach);
  if (curve) return { at: closestOn(curve.shape, p), snap: { kind: 'curve', id: curve.id } };
  return { at: p };
}

// A move of the pointer. `down`: where the button went down, while it is held. The answer says what
// the app redraws: after a step of a drag the status of the sketch and the scene, or the scene only.
export function sketchMove(host: SketchHost, m: SketchMode, event: PointerEvent, down: { x: number; y: number } | undefined): 'drag' | 'scene' | undefined {
  const context = host.sketchContext();
  if (!context) return undefined;
  if (m.drag) {
    const p = host.planePoint(event, context.frame)?.at;
    if (!p || !down) return undefined;
    if (!m.drag.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 4) return undefined;
    m.drag.moved = true;
    // náhled počítá jen po upravovanou skicu a dokument nemění
    const result = host.engine.preview({ type: 'dragPoint', sketch: m.id, point: m.drag.point, x: p[0], y: p[1] }, m.id);
    if (!result.ok) return undefined;
    m.preview = result.state;
    host.invalidate();
    return 'drag';
  }
  if (m.tool === 'project') {
    const edge = host.pick(event, { edges: true });
    if (pickKey(edge) === pickKey(m.hoverEdge)) return undefined;
    m.hoverEdge = edge;
    return 'scene';
  }
  const anchor = anchorAt(host, event, context);
  m.hover = m.tool === 'select' ? anchor?.snap?.id : undefined;
  m.infer = undefined;
  // odvozená vazba: volný konec úsečky skoro vodorovně nebo svisle od začátku
  if (anchor && !anchor.snap && m.tool === 'line' && m.clicks.length === 1) {
    const from = positionOf(context.view, m.clicks[0]);
    const reach = PICK_REACH * host.pixelSize();
    const [dx, dy] = [Math.abs(anchor.at[0] - from[0]), Math.abs(anchor.at[1] - from[1])];
    if (dy <= reach && dx > reach) [anchor.at, m.infer] = [[anchor.at[0], from[1]], 'horizontal'];
    else if (dx <= reach && dy > reach) [anchor.at, m.infer] = [[from[0], anchor.at[1]], 'vertical'];
  }
  m.cursor = anchor;
  return 'scene';
}

export function sketchClick(host: SketchHost, m: SketchMode, event: PointerEvent): void {
  const context = host.sketchContext();
  if (!context) return;
  if (m.tool === 'project') return projectEdge(host, m, event, context);
  // místo kliknutí včetně odvozené vazby spočítal poslední pohyb myši; bez něj se dopočítá
  const anchor = m.cursor && m.tool !== 'select' ? m.cursor : anchorAt(host, event, context);
  if (!anchor) return;
  const { view } = context;
  const batch = (commands: Command[] | undefined): boolean => commands !== undefined && commands.length > 0 && host.run({ type: 'batch', commands: m.construction ? asConstruction(commands) : commands });

  if (m.tool === 'select') {
    const id = anchor.snap?.id;
    if (!id) m.selection = event.shiftKey ? m.selection : [];
    else if (!event.shiftKey) m.selection = [id];
    else m.selection = m.selection.includes(id) ? m.selection.filter((other) => other !== id) : [...m.selection, id];
    host.renderPanel();
    return host.renderScene();
  }
  if (m.tool === 'point') {
    batch(pointCommands(m.id, view, anchor, host.newId));
    return;
  }
  const needed = m.tool === 'arc' ? 3 : 2;
  if (m.clicks.length + 1 < needed) {
    m.clicks = [...m.clicks, anchor];
    return host.renderScene();
  }
  const clicks = m.clicks;
  m.clicks = [];
  if (m.tool === 'line') {
    const line = lineCommands(m.id, view, clicks[0], anchor, host.newId, m.infer);
    // řetěz pokračuje z konce, dokud se nenapojí na existující bod
    if (line && batch(line.commands) && anchor.snap?.kind !== 'point' && host.sketch === m) m.clicks = [{ at: anchor.at, snap: { kind: 'point', id: line.end } }];
  } else if (m.tool === 'rect') batch(rectangleCommands(m.id, view, clicks[0], anchor, host.newId));
  else if (m.tool === 'polygon') batch(polygonCommands(m.id, view, clicks[0], anchor, host.sketching.polygon, host.newId));
  else if (m.tool === 'circle') batch(circleCommands(m.id, view, clicks[0], anchor, host.newId));
  else batch(arcCommands(m.id, view, clicks[0], clicks[1], anchor, host.newId));
  m.infer = undefined;
  host.renderScene();
}

// Promítne hranu tělesa; je-li vybrané jedno promítnutí, opraví ho (ID zůstane, vazby drží).
function projectEdge(host: SketchHost, m: SketchMode, event: PointerEvent, context: SketchContext): void {
  const edge = host.pick(event, { edges: true });
  if (edge?.kind !== 'edge') return;
  if (edge.edgeKind !== 'line' && edge.edgeKind !== 'circle') return host.say('Promítnout jde jen hrana, která je úsečka nebo kružnice.', true);
  const ref = { type: 'edge' as const, body: edge.body, edge: edge.name, kind: edge.edgeKind };
  const repaired = m.repair ?? (m.selection.length === 1 && context.feature.external[m.selection[0]] ? m.selection[0] : undefined);
  if (repaired) {
    if (host.run({ type: 'updateExternal', sketch: m.id, id: repaired, ref }, 'Promítnutí opraveno.')) m.repair = undefined;
  } else host.run({ type: 'addExternal', sketch: m.id, id: host.newId('x'), ref }, 'Hrana promítnuta.');
}

export function addConstraints(host: SketchHost, m: SketchMode, constraints: Constraint[] | undefined): void {
  if (!constraints) return;
  // Vazbu, kterou skica už má, engine odmítne; ze sady se přidá jen to, co chybí.
  const feature = host.sketchContext()?.feature;
  const fresh = feature ? constraints.filter((c) => duplicateOf(feature, c) === undefined) : constraints;
  if (fresh.length === 0) return host.say(constraints.some(isDimension) ? 'Tuhle kótu už skica má; její hodnotu upravíte v seznamu vazeb.' : 'Tuhle vazbu už skica má.', true);
  constraints = fresh;
  const commands = (list: Constraint[]): Command => ({ type: 'batch', commands: list.map((constraint): Command => ({ type: 'addConstraint', sketch: m.id, id: host.newId('k'), constraint })) });
  const result: CommandResult = host.engine.execute(commands(constraints));
  if (result.ok) return host.say('Vazba přidána.');
  // kótu jen mezi pevnými entitami engine odmítne jako řídicí; nabídne se jako referenční
  const reference = constraints.map((c) => (isDimension(c) ? { ...c, driving: false } : c));
  // stejná referenční kóta už ve skice je: engine duplicity hlídá jen u řídicích vazeb
  const keys = new Set(Object.values(feature?.constraints ?? {}).map(constraintKey));
  if (reference.every((c) => isDimension(c) && keys.has(constraintKey(c)))) return host.say('Tuhle kótu už skica má.', true);
  if (constraints.some(isDimension) && host.engine.execute(commands(reference)).ok) return host.say('Kóta je mezi pevnými entitami, proto je jen referenční.');
  host.say(result.error.message, true);
}

// Smaže vybrané entity; s křivkou zmizí i její body, které už nic dalšího nepoužívá.
export function deleteSelection(host: SketchHost, m: SketchMode): void {
  const context = host.sketchContext();
  if (!context || m.selection.length === 0) return;
  const commands = deleteCommands(m.id, context.feature, context.view, m.selection);
  if (commands.length === 0) return host.say('Počátek a body promítnuté geometrie smazat nejdou; promítnutí se maže výběrem jeho křivky.', true);
  m.selection = [];
  host.run({ type: 'batch', commands }, 'Smazáno.');
}

// Vysvětlení označené vazby. Pamatuje se podle diagnostiky, aby se při každém překreslení
// pohledu nepočítalo znovu.
export function explain(host: SketchHost, sketch: Id, id: Id, diagnosis: SketchDiagnosis): ConstraintExplanation {
  if (host.sketching.explained?.diagnosis !== diagnosis || host.sketching.explained.id !== id) host.sketching.explained = { diagnosis, id, value: host.engine.explainConstraint(sketch, id) };
  return host.sketching.explained.value;
}

// What the open sketch adds to the scene of the model.
export function sketchScene(host: SketchHost, m: SketchMode, model: SceneModel): void {
  const context = host.sketchContext();
  if (!context) return;
  const { feature, view, result, frame } = context;
  const selected = new Set(m.selection);
  const hovered = new Set(m.hoverConstraint && feature.constraints[m.hoverConstraint] ? operandsOf(feature.constraints[m.hoverConstraint]) : m.hover ? [m.hover] : []);
  // Diagnostika: volné entity modře, určené tmavě; označená vazba a vazby, ze kterých plyne.
  const diagnosis = host.engine.diagnoseSketch(m.id);
  const free = freeEntities(diagnosis, view);
  const focus = m.focus && feature.constraints[m.focus] ? m.focus : undefined;
  const focused = new Set(focus ? operandsOf(feature.constraints[focus]) : []);
  const implying = new Set(focus ? explain(host, m.id, focus, diagnosis).impliedBy.flatMap((id) => operandsOf(feature.constraints[id])) : []);

  if (result.valid) for (const region of result.regions) model.fills.push({ frame, loops: region.loops, color: COLOR.region, opacity: 0.1 });

  // `unknown`: skica není vyřešená a o volnosti se nedá nic říct
  const lines: Record<'own' | 'determined' | 'unknown' | 'construction' | 'external' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], construction: [], external: [], selected: [], hover: [], focus: [], implying: [] };
  for (const curve of view.curves.values()) {
    const bucket = selected.has(curve.id)
      ? 'selected'
      : hovered.has(curve.id)
        ? 'hover'
        : focused.has(curve.id)
          ? 'focus'
          : implying.has(curve.id)
            ? 'implying'
            : !curve.own
              ? 'external'
              : curve.construction
                ? 'construction'
                : !free
                  ? 'unknown'
                  : free.curves.has(curve.id)
                    ? 'own'
                    : 'determined';
    pushPolyline(lines[bucket], frame, polyline(curve.shape));
  }
  model.lines.push(
    { segments: lines.determined, color: COLOR.determined, width: 2, onTop: true },
    { segments: lines.own, color: COLOR.sketch, width: 2, onTop: true },
    { segments: lines.unknown, color: COLOR.idle, width: 2, onTop: true },
    { segments: lines.construction, color: COLOR.construction, width: 1.5, dashed: true, onTop: true },
    { segments: lines.external, color: COLOR.external, width: 2, onTop: true },
    { segments: lines.implying, color: COLOR.implied, width: 3, onTop: true },
    { segments: lines.focus, color: COLOR.hover, width: 4, onTop: true },
    { segments: lines.hover, color: COLOR.hover, width: 3, onTop: true },
    { segments: lines.selected, color: COLOR.select, width: 3, onTop: true },
  );

  const points: Record<'own' | 'determined' | 'unknown' | 'fixed' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], fixed: [], selected: [], hover: [], focus: [], implying: [] };
  for (const point of view.points.values()) {
    const bucket = selected.has(point.id)
      ? 'selected'
      : hovered.has(point.id)
        ? 'hover'
        : focused.has(point.id)
          ? 'focus'
          : implying.has(point.id)
            ? 'implying'
            : !point.own
              ? 'fixed'
              : !free
                ? 'unknown'
                : free.points.has(point.id)
                  ? 'own'
                  : 'determined';
    points[bucket].push(...toWorld(frame, point.at[0], point.at[1]));
  }
  model.points.push(
    { positions: points.determined, color: COLOR.determined, size: 7 },
    { positions: points.unknown, color: COLOR.idle, size: 7 },
    { positions: points.own, color: COLOR.sketch, size: 7 },
    { positions: points.fixed, color: COLOR.external, size: 7 },
    { positions: points.implying, color: COLOR.implied, size: 10 },
    { positions: points.focus, color: COLOR.hover, size: 11 },
    { positions: points.hover, color: COLOR.hover, size: 10 },
    { positions: points.selected, color: COLOR.select, size: 10 },
  );

  // kóty jako popisky u svých operandů
  for (const [id, c] of Object.entries(feature.constraints)) {
    if (!isDimension(c)) continue;
    const at = anchorOf(c, view);
    if (!at) continue;
    const value = c.driving ? c.value : (result.measurements[id] ?? c.value);
    const text = c.type === 'angle' ? `${fmt((value * 180) / Math.PI)}°` : `${c.type === 'radius' ? 'R' : c.type === 'diameter' ? '⌀' : ''}${fmt(value)}`;
    model.labels.push({ at: toWorld(frame, at[0], at[1]), text: c.driving ? text : `(${text})`, tone: result.conflicting.includes(id) ? 'problem' : c.driving ? 'driving' : 'reference' });
  }

  // rozpracovaný tvar
  const cursor = m.cursor;
  if (cursor && m.tool !== 'select' && m.tool !== 'project') {
    const rubber: number[] = [];
    const at = cursor.at;
    const first = m.clicks[0] && positionOf(view, m.clicks[0]);
    const shape = (s: Shape) => pushPolyline(rubber, frame, polyline(s));
    if (first && m.tool === 'line') shape({ type: 'line', a: first, b: at });
    if (first && m.tool === 'rect') pushPolyline(rubber, frame, [first, [at[0], first[1]], at, [first[0], at[1]], first]);
    if (first && m.tool === 'circle') shape({ type: 'circle', center: first, radius: Math.hypot(at[0] - first[0], at[1] - first[1]) });
    if (first && m.tool === 'polygon') {
      // the circumscribed circle and the polygon with its first vertex at the cursor
      const [radius, direction, sides] = [Math.hypot(at[0] - first[0], at[1] - first[1]), Math.atan2(at[1] - first[1], at[0] - first[0]), host.sketching.polygon.sides];
      shape({ type: 'circle', center: first, radius });
      pushPolyline(rubber, frame, Array.from({ length: sides + 1 }, (_, i): Vec2 => [first[0] + radius * Math.cos(direction + (2 * Math.PI * i) / sides), first[1] + radius * Math.sin(direction + (2 * Math.PI * i) / sides)]));
    }
    if (first && m.tool === 'arc') {
      const start = m.clicks[1] ? positionOf(view, m.clicks[1]) : at;
      shape({ type: 'line', a: first, b: start });
      if (m.clicks[1]) {
        const from = Math.atan2(start[1] - first[1], start[0] - first[0]);
        const sweep = (Math.atan2(at[1] - first[1], at[0] - first[0]) - from + 4 * Math.PI) % (2 * Math.PI);
        shape({ type: 'arc', center: first, radius: Math.hypot(start[0] - first[0], start[1] - first[1]), from, sweep: sweep || 2 * Math.PI });
      }
    }
    model.lines.push({ segments: rubber, color: m.infer ? COLOR.select : m.construction ? COLOR.construction : COLOR.rubber, width: 1.5, dashed: true, onTop: true });
    if (cursor.snap) model.points.push({ positions: toWorld(frame, at[0], at[1]), color: 0x16a34a, size: 12 });
    if (m.infer) model.labels.push({ at: toWorld(frame, at[0], at[1]), text: m.infer === 'horizontal' ? 'vodorovně' : 'svisle', tone: 'reference' });
  }
}
