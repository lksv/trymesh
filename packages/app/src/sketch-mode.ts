// The sketch mode: its tools, what a press, a move and a click in the view mean, the drag of
// a point, and what the mode draws. The app keeps the pointer and key handlers and hands the events
// over; the panel of the mode is panels/sketch.ts.
import { type Command, type CommandResult, type Constraint, type ConstraintExplanation, type EngineState, type Frame, type Id, type SketchDiagnosis, type SketchFeature, type SketchResult, type QueryResult, type SketchToolCall, constraintKey, derivedOrigin, duplicateOf, isDimension, isOriginAxis } from '@trymesh/engine';
import { fmt } from './dom';
import { COLOR, pushPolyline, toWorld } from './draw';
import { PICK_REACH, type PanelHost, type ViewPick, pickKey } from './host';
import { deleteCommands } from './sketch-commands';
import { freeEntities } from './sketch-diagnosis';
import { type Place, SKETCH_TOOL_UI, type SketchPlaceTool, type SketchToolName, placePosition } from './sketch-tools';
import { type SketchView, anchorOf, closestOn, hitCurve, hitPoint, kindOf, operandsOf, polyline, sketchView } from './sketch-view';
import { hoverMarks } from './references';
import type { SceneModel } from './viewport';

export interface SketchMode {
  kind: 'sketch';
  id: Id;
  tool: SketchToolName; // a tool of the bar (SKETCH_TOOL_UI)
  clicks: Place[]; // dosud zadané body rozpracovaného tvaru
  cursor?: Place;
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
  entry?: Id; // the entry of `external` whose form is open in the panel (a mirror or pattern, D68)
}
export const sketchMode = (id: Id): SketchMode => ({ kind: 'sketch', id, tool: 'select', clicks: [], selection: [] });

// The open sketch as it is shown: the feature, its solution, its plane and the view of both, and
// what the sketch tools of the engine take: the sketch with the document and the values of the
// parameters (D52).
export interface SketchContext {
  feature: SketchFeature;
  result: SketchResult;
  frame: Frame;
  view: SketchView;
  tool: SketchToolCall;
}
export function sketchContextOf(state: EngineState, id: Id): SketchContext | undefined {
  const feature = state.document.features.find((f) => f.id === id);
  const result = state.evaluation.features[id];
  if (feature?.type !== 'sketch' || !result?.sketch || !result.plane) return undefined;
  const view = sketchView(feature, result.sketch);
  return { feature, result: result.sketch, frame: result.plane, view, tool: { ...view.source, parameters: state.evaluation.parameters, document: state.document } };
}

// What the mode remembers beyond one sketch. The app holds it; the mode and its panel read and write it.
export interface SketchState {
  tools: Partial<Record<SketchToolName, unknown>>; // the options of a tool once set (SketchToolUi.options); its `initial` until then
  explained?: { diagnosis: SketchDiagnosis; id: Id; value: ConstraintExplanation }; // the explanation asked last
}

// What the sketch mode and its panel use of the app beyond what every panel does.
export interface SketchHost extends PanelHost {
  readonly sketch: SketchMode | undefined; // the open sketch, if one is open
  readonly sketching: SketchState;
  sketchContext(): SketchContext | undefined; // of the open sketch; kept until the shown state changes
  pick(event: PointerEvent, want: { edges?: boolean; faces?: boolean; planes?: boolean }): ViewPick | undefined; // what is under the pointer in the model
}

// The entry of the active tool when it picks places (every tool but Project).
const placeTool = (m: SketchMode): SketchPlaceTool<unknown> | undefined => {
  const tool = SKETCH_TOOL_UI[m.tool];
  return tool.picks === 'edge' ? undefined : tool;
};

// The options of a tool: what was set last, else the start value of its entry.
export function toolOptions(host: SketchHost, tool: SketchToolName): unknown {
  return tool in host.sketching.tools ? host.sketching.tools[tool] : SKETCH_TOOL_UI[tool].options?.initial;
}

export function setTool(host: SketchHost, tool: SketchToolName): void {
  if (!host.sketch) return;
  Object.assign(host.sketch, { tool, clicks: [], cursor: undefined, infer: undefined, hover: undefined, hoverEdge: undefined, repair: undefined });
  host.say(SKETCH_TOOL_UI[tool].hint);
  host.refresh();
}

// After a change of the document: what the mode holds of things the sketch no longer has is dropped.
export function settleSketch(m: SketchMode, context: SketchContext | undefined): void {
  const view = context?.view;
  m.selection = m.selection.filter((id) => view && kindOf(view, id));
  m.clicks = m.clicks.filter((a) => !a.snap || a.snap.kind === 'foreign' || (view && kindOf(view, a.snap.id)));
  if (m.repair && !context?.feature.external[m.repair]) m.repair = undefined;
  if (m.entry && !context?.feature.external[m.entry]) m.entry = undefined;
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

// A press on a point of the sketch with a tool that drags (Select) starts its drag. True: the app captures the pointer.
export function sketchDown(host: SketchHost, m: SketchMode, event: PointerEvent): boolean {
  if (!placeTool(m)?.drags) return false;
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

// Místo pod kurzorem ve skice a přichycení: bod má přednost před křivkou. A copy of a mirror or
// pattern (D68) is snapped to only with `copies` (the select tool, to find its entry): a new point
// cannot be tied to a copy.
function anchorAt(host: SketchHost, event: { clientX: number; clientY: number }, context: SketchContext, copies = false): Place | undefined {
  const p = host.planePoint(event, context.frame)?.at;
  if (!p) return undefined;
  const reach = PICK_REACH * host.pixelSize();
  const skip = copies ? undefined : (id: Id): boolean => context.view.points.get(id)?.derived === true || context.view.curves.get(id)?.derived === true;
  const point = hitPoint(context.view, p, reach, skip);
  if (point) return { at: point.at, snap: { kind: 'point', id: point.id } };
  const curve = hitCurve(context.view, p, reach, skip);
  if (curve) return { at: closestOn(curve.shape, p), snap: { kind: 'curve', id: curve.id } };
  return { at: p };
}

// The place under the pointer as the tool picks it: in the sketch, points first (`sketch`); on the
// curves the tool takes, the nearest point of the nearest one, else the bare pointer (`curve`); or
// by the tool's own picker. Exported for the tests.
export function placeAt(host: SketchHost, tool: SketchPlaceTool<unknown>, event: { clientX: number; clientY: number }, context: SketchContext): Place | undefined {
  const picks = tool.picks ?? 'sketch';
  if (picks === 'sketch') return anchorAt(host, event, context, tool.hovers === true);
  if (picks !== 'curve') return picks.pick(host, event, context);
  const p = host.planePoint(event, context.frame)?.at;
  if (!p) return undefined;
  const curve = hitCurve(context.view, p, PICK_REACH * host.pixelSize(), (id) => tool.eligible?.(id, context) === false);
  return curve ? { at: closestOn(curve.shape, p), snap: { kind: 'curve', id: curve.id } } : { at: p };
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
  const tool = placeTool(m);
  if (!tool) {
    const edge = host.pick(event, { edges: true });
    if (pickKey(edge) === pickKey(m.hoverEdge)) return undefined;
    m.hoverEdge = edge;
    return 'scene';
  }
  const anchor = placeAt(host, tool, event, context);
  m.hover = tool.hovers && anchor?.snap?.kind !== 'foreign' ? anchor?.snap?.id : undefined;
  m.infer = undefined;
  // odvozená vazba: volný konec úsečky skoro vodorovně nebo svisle od začátku
  if (anchor && !anchor.snap && tool.infer && m.clicks.length === 1) {
    const from = placePosition(context.view, m.clicks[0]);
    const reach = PICK_REACH * host.pixelSize();
    const [dx, dy] = [Math.abs(anchor.at[0] - from[0]), Math.abs(anchor.at[1] - from[1])];
    if (dy <= reach && dx > reach) [anchor.at, m.infer] = [[anchor.at[0], from[1]], 'horizontal'];
    else if (dx <= reach && dy > reach) [anchor.at, m.infer] = [[from[0], anchor.at[1]], 'vertical'];
  }
  m.cursor = anchor;
  return 'scene';
}

// A click: the entry of the tool gets it. A shape of several places keeps the places before the
// last; the last one runs the tool with all of them. A tool without `clicks` gets every click and
// keeps what `click` returns; the mode redraws the scene when places were kept before or are now.
export function sketchClick(host: SketchHost, m: SketchMode, event: PointerEvent): void {
  const context = host.sketchContext();
  if (!context) return;
  const entry = SKETCH_TOOL_UI[m.tool];
  if (entry.picks === 'edge') return entry.click(host, m, host.pick(event, { edges: true }), context);
  const tool: SketchPlaceTool<unknown> = entry;
  // místo kliknutí včetně odvozené vazby spočítal poslední pohyb myši; bez něj se dopočítá
  const place = m.cursor && !tool.atClick ? m.cursor : placeAt(host, tool, event, context);
  if (!place) return;
  if (tool.clicks !== undefined && m.clicks.length + 1 < tool.clicks) {
    m.clicks = [...m.clicks, place];
    return host.renderScene();
  }
  const places = [...m.clicks, place];
  m.clicks = [];
  keep(host, m, tool.click(host, m, places, context, toolOptions(host, m.tool), event));
  if (tool.clicks === undefined) {
    // the tools of today without `clicks` keep nothing and redraw what they change themselves
    if (places.length > 1 || m.clicks.length > 0) host.renderScene();
    return;
  }
  m.infer = undefined;
  host.renderScene();
}

// The places a tool returned are kept, while its sketch is still the one open.
function keep(host: SketchHost, m: SketchMode, kept: Place[] | void): void {
  if (kept && kept.length > 0 && host.sketch === m) m.clicks = kept;
}

// The key Enter: a tool that collects places (6d: the control points of a spline) finishes with
// them, and keeps what `finish` returns (too few places for its shape: they stay). With no place
// kept, or a tool without `finish`, it does nothing. True when the tool got the key, so the app
// keeps it from the element in focus.
export function sketchFinish(host: SketchHost, m: SketchMode): boolean {
  const context = host.sketchContext();
  const tool = placeTool(m);
  if (!context || !tool?.finish || m.clicks.length === 0) return false;
  const places = m.clicks;
  m.clicks = [];
  keep(host, m, tool.finish(host, m, places, context, toolOptions(host, m.tool)));
  host.renderScene();
  return true;
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
  // a copy of a mirror or pattern (D68) is not deleted: it goes with its entry or its source
  const copy = m.selection.find((id) => context.view.points.get(id)?.derived === true || context.view.curves.get(id)?.derived === true);
  const entry = copy === undefined ? undefined : derivedOrigin(context.feature, copy)?.entry;
  const copyHint = entry === undefined ? '' : `"${copy}" is a copy of the mirror or pattern "${entry}" and is not deleted by itself: remove "${entry}" by ✕ in its row, or change its sources in its form.`;
  if (commands.length === 0) return host.say(copyHint || 'Počátek a body promítnuté geometrie smazat nejdou; promítnutí se maže výběrem jeho křivky.', true);
  m.selection = [];
  host.run({ type: 'batch', commands }, copyHint ? `Deleted the own entities of the selection; ${copyHint}` : 'Smazáno.');
}

// Vysvětlení označené vazby. Pamatuje se podle diagnostiky, aby se při každém překreslení
// pohledu nepočítalo znovu.
export function explain(host: SketchHost, sketch: Id, id: Id, diagnosis: SketchDiagnosis): ConstraintExplanation {
  if (host.sketching.explained?.diagnosis !== diagnosis || host.sketching.explained.id !== id) host.sketching.explained = { diagnosis, id, value: host.engine.explainConstraint(sketch, id) };
  return host.sketching.explained.value;
}

// Where the curves of a sketch that form regions meet (the query sketchContacts, D65); the engine
// keeps the answer by the solved sketch, so asking at every redraw costs nothing.
export function contactsOf(host: PanelHost, sketch: Id): QueryResult<'sketchContacts'> | undefined {
  const outcome = host.engine.query('sketchContacts', { sketch });
  return outcome.ok && outcome.result.status === 'ok' ? outcome.result : undefined;
}

// What the open sketch adds to the scene of the model.
export function sketchScene(host: SketchHost, m: SketchMode, model: SceneModel): void {
  const context = host.sketchContext();
  if (!context) return;
  const { feature, view, result, frame } = context;
  const selected = new Set(m.selection);
  const hovered = new Set(m.hoverConstraint && feature.constraints[m.hoverConstraint] ? operandsOf(feature.constraints[m.hoverConstraint]) : m.hover ? hoverMarks(feature, m.hover) : []);
  // Diagnostika: volné entity modře, určené tmavě; označená vazba a vazby, ze kterých plyne.
  const diagnosis = host.engine.diagnoseSketch(m.id);
  const free = freeEntities(diagnosis, view);
  const focus = m.focus && feature.constraints[m.focus] ? m.focus : undefined;
  const focused = new Set(focus ? operandsOf(feature.constraints[focus]) : []);
  const implying = new Set(focus ? explain(host, m.id, focus, diagnosis).impliedBy.flatMap((id) => operandsOf(feature.constraints[id])) : []);

  if (result.valid) for (const region of result.regions) model.fills.push({ frame, loops: region.loops, color: COLOR.region, opacity: 0.1 });
  // D65: while the profile is invalid, where its curves meet apart from common points: the answer of
  // the query sketchContacts, whose view draws the same marks
  else model.points.push({ positions: (contactsOf(host, m.id)?.contacts ?? []).flatMap((contact) => toWorld(frame, contact.at[0], contact.at[1])), color: COLOR.clash, size: 9 });

  // `unknown`: skica není vyřešená a o volnosti se nedá nic říct
  const lines: Record<'own' | 'determined' | 'unknown' | 'construction' | 'external' | 'derived' | 'derivedConstruction' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], construction: [], external: [], derived: [], derivedConstruction: [], selected: [], hover: [], focus: [], implying: [] };
  // The axes of the origin (D71) in a bucket of their own: thin lines in the colour of a plane,
  // drawn by the view as their stretch inside what it shows.
  const axes: NonNullable<SceneModel['axes']> = [];
  for (const curve of view.curves.values()) {
    if (isOriginAxis(curve.id)) {
      const marked = selected.has(curve.id) ? COLOR.select : hovered.has(curve.id) || focused.has(curve.id) ? COLOR.hover : implying.has(curve.id) ? COLOR.implied : undefined;
      axes.push({ frame, direction: curve.id === 'origin/x' ? [1, 0] : [0, 1], color: marked ?? COLOR.plane, width: marked === undefined ? 1 : 3 });
      continue;
    }
    const bucket = selected.has(curve.id)
      ? 'selected'
      : hovered.has(curve.id)
        ? 'hover'
        : focused.has(curve.id)
          ? 'focus'
          : implying.has(curve.id)
            ? 'implying'
            : curve.derived
              ? curve.construction
                ? 'derivedConstruction'
                : 'derived'
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
  model.axes = [...(model.axes ?? []), ...axes];
  model.lines.push(
    { segments: lines.determined, color: COLOR.determined, width: 2, onTop: true },
    { segments: lines.own, color: COLOR.sketch, width: 2, onTop: true },
    { segments: lines.unknown, color: COLOR.idle, width: 2, onTop: true },
    { segments: lines.construction, color: COLOR.construction, width: 1.5, dashed: true, onTop: true },
    { segments: lines.external, color: COLOR.external, width: 2, onTop: true },
    // copies of mirrors and patterns (D68): derived geometry, dashed in the colour of projections
    ...(lines.derived.length > 0 ? [{ segments: lines.derived, color: COLOR.external, width: 1.5, dashed: true, onTop: true }] : []),
    // copies of construction curves: thinner, as construction curves are thinner than outlines
    ...(lines.derivedConstruction.length > 0 ? [{ segments: lines.derivedConstruction, color: COLOR.external, width: 1, dashed: true, onTop: true }] : []),
    { segments: lines.implying, color: COLOR.implied, width: 3, onTop: true },
    { segments: lines.focus, color: COLOR.hover, width: 4, onTop: true },
    { segments: lines.hover, color: COLOR.hover, width: 3, onTop: true },
    { segments: lines.selected, color: COLOR.select, width: 3, onTop: true },
  );

  const points: Record<'own' | 'determined' | 'unknown' | 'fixed' | 'selected' | 'hover' | 'focus' | 'implying', number[]> = { own: [], determined: [], unknown: [], fixed: [], selected: [], hover: [], focus: [], implying: [] };
  for (const point of view.points.values()) {
    // the points of copies have no handles: drawn only when selected or hovered
    if (point.derived && !selected.has(point.id) && !hovered.has(point.id)) continue;
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

  // rozpracovaný tvar: what the tool draws, the marker of a snap and the inferred direction
  const cursor = m.cursor;
  const tool = placeTool(m);
  if (cursor && tool && !tool.hovers) {
    const rubber: number[] = [];
    const at = cursor.at;
    const places = m.clicks.map((place) => placePosition(view, place));
    for (const points of tool.draw?.(places, cursor, context, toolOptions(host, m.tool)) ?? []) pushPolyline(rubber, frame, points);
    model.lines.push({ segments: rubber, color: m.infer ? COLOR.select : m.construction ? COLOR.construction : COLOR.rubber, width: 1.5, dashed: true, onTop: true });
    if (cursor.snap) model.points.push({ positions: toWorld(frame, at[0], at[1]), color: 0x16a34a, size: 12 });
    if (m.infer) model.labels.push({ at: toWorld(frame, at[0], at[1]), text: m.infer === 'horizontal' ? 'vodorovně' : 'svisle', tone: 'reference' });
  }
}
