// The generic form of a query (D39): every query of the catalog of the engine can be asked from
// the app, with a form built from the description of its arguments. One query is open at a time,
// in the model panel. Its state is one object the app holds and only this module reads and writes.
import { type AnyQuery, type ArgKind, type ArgPath, type ArgSpecs, type FaceName, type Id, QUERIES, type QueryName, type QueryOutcome, type ResultUnit } from '@trymesh/engine';
import { h } from '../dom';
import { resultText } from '../fields';
import type { Note, PanelHost, ViewPick } from '../host';
import { faceLabel } from '../issue-text';
import { CONTROLS, type Form } from '../queries/controls';
import { QUERY_VIEWS, type SceneAdditions, type ViewPanel } from '../queries/index';

// - `draft`: the arguments being filled in, in the shape of the description; a value not given yet
//   is undefined. It survives a change of the document; an ID in it that is gone is found by the
//   engine when the query is asked.
// - `armed`: the path of the control that takes the next selection in the view.
// - `answer`: belongs to the document and to the place on the timeline it was asked at: shown
//   while the marker is `at`, hidden while it is elsewhere, dropped when the engine reports
//   a change of the document. It keeps the arguments of the form it was asked from (`args`), so
//   that a view draws what was asked and not what the form shows meanwhile, and the arguments
//   the engine really got (`asked`: those of the form after `prepare` of the view).
export interface OpenQuery {
  name: QueryName;
  draft: Record<string, unknown>;
  armed?: ArgPath;
  answer?: { at: Id | null; args: Record<string, unknown>; asked: unknown; outcome: QueryOutcome<unknown>; picked?: number };
}
// `note`: the note of the last answer, while it is the one the status line shows.
export interface QueryPanel {
  open?: OpenQuery;
  note?: Note;
}

// A view as code that handles any query reads it: the values are of types only the view knows.
interface AnyView {
  immediate?: boolean;
  prepare?(args: never): unknown;
  answer?(result: never, args: never, panel: ViewPanel<never>): HTMLElement[];
  scene?(result: never, args: never, panel: ViewPanel<never>): Partial<SceneAdditions>;
  note?(result: never, panel: ViewPanel<never>): { text: string; error: boolean };
}
const entryOf = (name: QueryName): AnyQuery => (QUERIES as Record<string, AnyQuery>)[name];
const viewOf = (name: QueryName): AnyView | undefined => (QUERY_VIEWS as Record<string, AnyView | undefined>)[name];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------- the draft

// The description of the argument at `path`.
function specAt(specs: ArgSpecs, path: ArgPath): ArgKind | undefined {
  let spec: ArgKind | undefined = specs[String(path[0])];
  for (const part of path.slice(1)) {
    if (!spec) return undefined;
    if (spec.kind === 'list' || spec.kind === 'record') spec = spec.of;
    else if (spec.kind === 'oneOf') spec = spec.options[String(part)];
    else if (spec.kind === 'fields') spec = spec.fields[String(part)];
    else return undefined;
  }
  return spec;
}
// The draft with `value` at `path`; what is on the way is copied, not changed.
function withValue(draft: unknown, path: ArgPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [part, ...rest] = path;
  if (typeof part === 'number') {
    const list: unknown[] = Array.isArray(draft) ? [...draft] : [];
    list[part] = withValue(list[part], rest, value);
    return list;
  }
  const record = isRecord(draft) ? draft : {};
  return { ...record, [part]: withValue(record[part], rest, value) };
}

// What a selection in the view is for the argument described by `spec`, or undefined when the
// argument does not take it.
function selected(spec: ArgKind, pick: ViewPick): unknown {
  if (spec.kind === 'entity' && pick.kind !== 'plane') {
    if (pick.kind === 'face' && spec.accepts.includes('face')) return { kind: 'face', body: pick.body, face: pick.name };
    if (pick.kind === 'edge' && spec.accepts.includes('edge')) return { kind: 'edge', body: pick.body, edge: pick.name };
    return spec.accepts.includes('body') ? { kind: 'body', body: pick.body } : undefined; // the body of what was clicked
  }
  if (spec.kind === 'plane') {
    if (pick.kind === 'plane') return pick.ref;
    return pick.kind === 'face' && pick.planar ? { kind: 'face', body: pick.body, face: pick.name } : undefined;
  }
  return undefined;
}
// Is the reference complete enough to stand for the argument? (A body chosen without its face is not.)
function given(spec: ArgKind, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (spec.kind === 'plane') return value.kind !== undefined;
  return value.kind === 'body' ? value.body !== undefined : value.kind === 'face' ? value.face !== undefined : value.kind === 'edge' ? value.edge !== undefined : value.kind === 'sketchPoint' ? value.point !== undefined : false;
}
// The first argument that takes a selection of the view and is still empty.
function nextToArm(specs: ArgSpecs, draft: Record<string, unknown>): ArgPath | undefined {
  const takes = (spec: ArgKind): boolean => spec.kind === 'plane' || (spec.kind === 'entity' && spec.accepts.some((kind) => kind !== 'sketchPoint'));
  const name = Object.keys(specs).find((key) => takes(specs[key]) && !given(specs[key], draft[key]));
  return name === undefined ? undefined : [name];
}

// ---------------------------------------------------------------- opening, asking, the life of an answer

// The answer is shown only for the state it was asked about.
export function shownAnswer(panel: QueryPanel, host: PanelHost): OpenQuery['answer'] {
  const answer = panel.open?.answer;
  return answer && answer.at === host.marker ? answer : undefined;
}

export function openQuery(panel: QueryPanel, host: PanelHost, name: QueryName): void {
  const entry = entryOf(name);
  panel.open = { name, draft: {}, armed: nextToArm(entry.args, {}) };
  // a query whose view asks at once, when nothing it needs is missing (the collisions: one click)
  if (viewOf(name)?.immediate && Object.values(entry.args).every((arg) => arg.optional)) return askQuery(panel, host);
  host.refresh();
}

export function closeQuery(panel: QueryPanel, host: PanelHost): void {
  panel.open = undefined;
  host.refresh();
}

// A change of the document: the answer belonged to the document as it was. The arguments stay.
export function dropAnswer(panel: QueryPanel): void {
  if (panel.open) panel.open.answer = undefined;
}

function viewPanel(panel: QueryPanel, host: PanelHost, answer: NonNullable<OpenQuery['answer']>): ViewPanel<never> {
  return {
    state: host.view(),
    bodyName: (body) => host.bodyName(body),
    faceLabel: (name) => faceLabel(name, host.featureNames),
    number: resultText,
    picked: answer.picked,
    pick: (row) => {
      answer.picked = row;
      host.renderPanel();
      host.renderScene();
    },
    ask: (args) => {
      if (panel.open) panel.open.draft = args;
      askQuery(panel, host);
    },
  };
}

// Asks the open query about the state at the marker. The name is known only at run time, so the
// arguments are whatever the form holds and the engine checks them: this is the one cast.
export function askQuery(panel: QueryPanel, host: PanelHost): void {
  const open = panel.open;
  if (!open) return;
  const view = viewOf(open.name);
  const args = structuredClone(open.draft);
  const asked = view?.prepare ? view.prepare(args as never) : args;
  const outcome = host.engine.query(open.name, asked as never, host.marker ? { at: host.marker } : {}) as QueryOutcome<unknown>;
  open.answer = { at: host.marker, args, asked, outcome };
  open.armed = undefined;
  const note = outcome.ok ? view?.note?.(outcome.result as never, viewPanel(panel, host, open.answer)) : { text: outcome.error.message, error: true };
  if (note) {
    host.say(note.text, note.error);
    panel.note = host.note; // the note states a fact about the model: it goes when the answer goes
  }
  host.refresh();
}

// The note of an answer goes with it: when the document changed, the marker moved to another
// state or the query was closed. The app calls this on every refresh.
export function followQueries(panel: QueryPanel, host: PanelHost): void {
  if (!panel.note || shownAnswer(panel, host)) return;
  if (host.note === panel.note) host.say('');
  panel.note = undefined;
}

// What the panel does with a selection in the view: true when the armed control took it (the app
// then keeps no selection of its own for that click). The next argument that takes a selection
// and is still empty is armed.
export function takeSelection(panel: QueryPanel, pick: ViewPick): boolean {
  const open = panel.open;
  if (!open?.armed) return false;
  const specs = entryOf(open.name).args;
  const spec = specAt(specs, open.armed);
  const value = spec && selected(spec, pick);
  if (value === undefined) return false;
  open.draft = withValue(open.draft, open.armed, value) as Record<string, unknown>;
  open.armed = nextToArm(specs, open.draft);
  return true;
}

// What the shown answer adds to the scene.
export function queryScene(panel: QueryPanel, host: PanelHost): Partial<SceneAdditions> {
  const answer = shownAnswer(panel, host);
  if (!panel.open || !answer || !answer.outcome.ok) return {};
  return viewOf(panel.open.name)?.scene?.(answer.outcome.result as never, answer.args as never, viewPanel(panel, host, answer)) ?? {};
}

// ---------------------------------------------------------------- the panel

// The menu of the toolbar: every query of the catalog by its title. A query needs no entry
// anywhere to be there.
export function queryMenu(panel: QueryPanel, host: PanelHost): HTMLElement {
  const menu: HTMLSelectElement = h(
    'select',
    {
      title: 'Ask a query about the model',
      onchange: () => {
        const name = menu.value;
        menu.value = '';
        if (name !== '') openQuery(panel, host, name as QueryName);
      },
    },
    h('option', { value: '', textContent: 'Queries…', selected: true }),
    ...Object.entries(QUERIES as Record<string, AnyQuery>).map(([name, entry]) => h('option', { value: name, textContent: entry.title, title: entry.summary })),
  );
  return menu;
}

const LONG = 30; // items of a list the tree shows before it cuts it

// An answer without a view: a tree of names and values. Numbers are rounded as the tool `query`
// rounds them (six decimal places, or the significant digits the entry gives) and get the unit
// the entry gives for their key; a face name is written as the app writes one, a body by its name.
function tree(value: unknown, key: string, entry: AnyQuery, host: PanelHost): HTMLElement[] {
  const number = (one: number): string => {
    const digits = entry.significant?.[key];
    const rounded = digits === undefined ? Math.round(one * 1e6) / 1e6 + 0 : Number(one.toPrecision(digits));
    const unit: ResultUnit | undefined = entry.units?.[key];
    return unit ? resultText(rounded, unit) : String(rounded);
  };
  const line = (text: string): HTMLElement => h('p', { className: 'answer' }, `${key}: ${text}`);
  if (typeof value === 'number') return [line(number(value))];
  if (typeof value === 'string') return [line(key === 'body' ? host.bodyName(value) : value)];
  if (typeof value === 'boolean') return [line(value ? 'yes' : 'no')];
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) return [line(`[${value.map((item) => number(item as number)).join(', ')}]`)];
    const rows = value.slice(0, LONG).flatMap((item, index) => tree(item, `${index + 1}`, entry, host));
    return [h('div', { className: 'group' }, h('p', { className: 'answer' }, `${key} (${value.length})`), ...rows, value.length > LONG ? h('p', { className: 'hint' }, `… and ${value.length - LONG} more`) : null)];
  }
  if (isRecord(value)) {
    if (typeof value.feature === 'string' && typeof value.role === 'string') return [line(faceLabel(value as unknown as FaceName, host.featureNames))];
    return [h('div', { className: 'group' }, h('p', { className: 'answer' }, key), ...Object.entries(value).flatMap(([name, item]) => tree(item, name, entry, host)))];
  }
  return [];
}

// The open query: its arguments, the buttons, and the answer when it is shown.
export function queryPanel(panel: QueryPanel, host: PanelHost): HTMLElement[] {
  const open = panel.open;
  if (!open) return [];
  const entry = entryOf(open.name);
  const answer = shownAnswer(panel, host);
  const failed = answer && !answer.outcome.ok ? answer.outcome.error : undefined;
  const form: Form = {
    host,
    state: host.view(),
    armed: open.armed,
    arm: (path) => {
      open.armed = path;
      host.renderPanel();
    },
    set: (path, value, rebuild = false) => {
      open.draft = withValue(open.draft, path, value) as Record<string, unknown>;
      if (rebuild) host.renderPanel();
    },
    title: (spec, name) => (spec as { title?: string }).title ?? name,
  };
  // an error names its argument by its path: the row of that argument is marked
  const rows = Object.entries(entry.args).map(([name, arg]) => {
    const wrong = failed?.arg?.[0] === name;
    return h('label', { className: wrong ? 'invalid' : '', title: wrong ? (failed?.message ?? '') : (arg.summary ?? '') }, `${arg.title}${arg.optional ? ' (optional)' : ''}`, ...CONTROLS[arg.kind](arg as never, open.draft[name], [name], form, open.draft));
  });
  const out: HTMLElement[] = [
    h('h2', { title: entry.summary }, entry.title),
    ...rows,
    h('div', { className: 'buttons' }, h('button', { className: 'primary', textContent: answer ? 'Ask again' : 'Ask', onclick: () => askQuery(panel, host) }), h('button', { textContent: 'Close', onclick: () => closeQuery(panel, host) })),
  ];
  if (!answer) return out;
  if (!answer.outcome.ok) return [...out, h('p', { className: 'issue error' }, answer.outcome.error.message)];
  const view = viewOf(open.name);
  const result = answer.outcome.result;
  if (view?.answer) return [...out, ...view.answer(result as never, answer.args as never, viewPanel(panel, host, answer))];
  return [...out, ...(isRecord(result) ? Object.entries(result).flatMap(([name, value]) => tree(value, name, entry, host)) : tree(result, 'answer', entry, host))];
}
