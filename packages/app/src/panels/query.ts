// The generic form of a query (D39): every query of the catalog of the engine can be asked from
// the app, with a form built from the description of its arguments. One query is open at a time,
// in the model panel. Its state is one object the app holds and only this module reads and writes.
import { type AnyQuery, type ArgPath, type FaceName, type Id, QUERIES, type QueryName, type QueryOptions, type QueryOutcome, type ResultUnit, faceKey } from '@trymesh/engine';
import { h } from '../dom';
import { plainNumber, resultText } from '../fields';
import type { Note, PanelHost, ViewPick } from '../host';
import { faceLabel } from '../issue-text';
import { holdsPose } from '../pose';
import { QUERY_VIEWS, type SceneAdditions, type ViewPanel } from '../queries/index';
import { argRows, isRecord, nextToArm, takeInto } from './args';
import type { OpenExport } from './export';

// - `draft`: the arguments being filled in, in the shape of the description; a value not given yet
//   is undefined. It survives a change of the document; an ID in it that is gone is found by the
//   engine when the query is asked.
// - `armed`: the path of the control that takes the next selection in the view.
// - `answer`: belongs to the document and to the place on the timeline it was asked at: shown
//   while the marker is `at`, hidden while it is elsewhere, dropped when the engine reports
//   a change of the document. It keeps the arguments of the form it was asked from (`args`), so
//   that a view draws what was asked and not what the form shows meanwhile, and the arguments
//   the engine really got (`asked`: those of the form after `prepare` of the view), and whether it
//   was asked about the model as modelled (`modelled`, D49).
// - `modelled`: the box *As modelled* of the form is ticked; it is offered while the shown state
//   holds a pose of the mechanism.
export interface OpenQuery {
  name: QueryName;
  draft: Record<string, unknown>;
  armed?: ArgPath;
  modelled?: boolean;
  answer?: { at: Id | null; args: Record<string, unknown>; asked: unknown; outcome: QueryOutcome<unknown>; picked?: number; modelled: boolean };
}
// `note`: the note of the last answer, while it is the one the status line shows. `exporting`: the
// form of an export (D54, `export.ts`), which shares the place of the query form: one of the two
// is open at a time.
export interface QueryPanel {
  open?: OpenQuery;
  note?: Note;
  exporting?: OpenExport;
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

// ---------------------------------------------------------------- opening, asking, the life of an answer

// The answer is shown only for the state it was asked about.
export function shownAnswer(panel: QueryPanel, host: PanelHost): OpenQuery['answer'] {
  const answer = panel.open?.answer;
  return answer && answer.at === host.marker ? answer : undefined;
}

export function openQuery(panel: QueryPanel, host: PanelHost, name: QueryName): void {
  const entry = entryOf(name);
  panel.exporting = undefined; // one form at a time
  panel.open = { name, draft: {}, armed: nextToArm(entry.args, {}) };
  // a query whose view asks at once, when nothing it needs is missing (the collisions: one click)
  if (viewOf(name)?.immediate && Object.values(entry.args).every((arg) => arg.optional)) return askQuery(panel, host);
  host.refresh();
}

// The choice of the geometry is offered while the state shown holds a pose of the mechanism (a link
// moved or blocked), for a query that does not answer as modelled anyway (D49).
const offersModelled = (entry: AnyQuery, host: PanelHost): boolean => entry.geometry === undefined && holdsPose(host.view().evaluation.mechanism);

// Is the answer that is shown one about the model as modelled: asked so, or of a query that always
// answers so? The view then shows the model as modelled too, so that what it highlights is where the
// answer found it.
export function answeredAsModelled(panel: QueryPanel, host: PanelHost): boolean {
  const answer = shownAnswer(panel, host);
  return panel.open !== undefined && answer !== undefined && (answer.modelled || entryOf(panel.open.name).geometry === 'modelled');
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
  // in the pose of the state at the marker, or as modelled when the form asks so (D49)
  const modelled = open.modelled === true && offersModelled(entryOf(open.name), host);
  const options: QueryOptions = { ...(host.marker ? { at: host.marker } : {}), ...(modelled ? { geometry: 'modelled' as const } : {}) };
  const outcome = host.engine.query(open.name, asked as never, options) as QueryOutcome<unknown>;
  open.answer = { at: host.marker, args, asked, outcome, modelled };
  open.armed = undefined;
  const note = outcome.ok ? view?.note?.(outcome.result as never, viewPanel(panel, host, open.answer)) : { text: outcome.error.message, error: true };
  if (note) {
    host.say(note.text, note.error);
    panel.note = host.note; // the note states a fact about the model: it goes when the answer goes
  } else if (panel.note) {
    // an answer without a note of its own: the note of the answer before it no longer holds
    if (host.note === panel.note) host.say('');
    panel.note = undefined;
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
  return open !== undefined && takeInto(entryOf(open.name).args, open, pick);
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
// the entry gives for their key; a face name is written as the lists of the form write one (its
// label and its key, because the sides of a body share a label), a body by its name.
// `named`: the key that gives the numbers their unit and digits. The items of a list are labelled
// by their place and keep the key of the list, as the tool does: the rows of a tensor under
// `inertia` have its unit.
function tree(value: unknown, key: string, entry: AnyQuery, host: PanelHost, named = key): HTMLElement[] {
  const number = (one: number): string => {
    const digits = entry.significant?.[named];
    const unit: ResultUnit | undefined = entry.units?.[named];
    // rounded once, as it is shown: an angle after it became degrees (a whole turn is 360°, not
    // the 359.999982° of six decimal places of radians), and to the significant digits of the
    // entry where it gives them, not to six decimal places after them
    return unit ? resultText(one, unit, digits) : digits === undefined ? plainNumber(one) : String(Number(one.toPrecision(digits)) + 0);
  };
  const line = (text: string): HTMLElement => h('p', { className: 'answer' }, `${key}: ${text}`);
  if (typeof value === 'number') return [line(number(value))];
  if (typeof value === 'string') return [line(key === 'body' ? host.bodyName(value) : value)];
  if (typeof value === 'boolean') return [line(value ? 'yes' : 'no')];
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'number')) return [line(`[${value.map((item) => number(item as number)).join(', ')}]`)];
    const rows = value.slice(0, LONG).flatMap((item, index) => tree(item, `${index + 1}`, entry, host, named));
    return [h('div', { className: 'tree' }, h('p', { className: 'answer' }, `${key} (${value.length})`), ...rows, value.length > LONG ? h('p', { className: 'hint' }, `… and ${value.length - LONG} more`) : null)];
  }
  if (isRecord(value)) {
    if (typeof value.feature === 'string' && typeof value.role === 'string') return [line(`${faceLabel(value as unknown as FaceName, host.featureNames)} · ${faceKey(value as unknown as FaceName)}`)];
    return [h('div', { className: 'tree' }, h('p', { className: 'answer' }, key), ...Object.entries(value).flatMap(([name, item]) => tree(item, name, entry, host)))];
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
  // an error names its argument by its path: the row of that argument is marked
  const rows = argRows(entry.args, open, host, failed);
  // the model as modelled instead of the pose of the mechanism (D49)
  if (offersModelled(entry, host)) {
    const box = h('input', { type: 'checkbox', checked: open.modelled === true, onchange: () => (open.modelled = box.checked) });
    rows.push(h('label', { className: 'check', title: 'Ask about the bodies where they are modelled, not where the pose of the mechanism puts them' }, box, 'As modelled'));
  } else if (entry.geometry === 'modelled' && holdsPose(host.view().evaluation.mechanism)) rows.push(h('p', { className: 'hint' }, 'This query answers for the model as modelled, whatever the pose of the mechanism.'));
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
