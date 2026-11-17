// What the forms of the feature types share: the entry of a type in the registry of the app
// (`FeatureUi`, features/index.ts), the mode of a draft, and the code around a draft that is the
// same for every type: its preview and the pause of a slow one, its numeric fields, its buttons.
//
// A draft is the input form of a feature that is not in the document until confirmed. Every
// change of it is previewed by the engine, and the preview is the state the view shows.
import { type Command, type EngineState, type Expr, FEATURE_TYPE_INFO, type FaceName, type Feature, type FeatureResult, type Input, type PlaneRef, type Unit, atPath, featureInput } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldNote, fieldText, parseField } from '../fields';
import type { PanelHost, ViewPick } from '../host';
import { angleProblem } from '../issue-text';
import { FEATURE_TYPES } from '../labels';
import type { SceneModel } from '../viewport';

// Where a new feature goes: its place on the timeline, and the plane picked for it when its type
// starts by picking one.
export interface Start {
  index: number;
  plane?: PlaneRef;
}

// The form of a feature type.
export interface FeatureForm<F extends Feature, Extra> {
  // The draft of a new feature with its defaults, or why there cannot be one yet.
  draft(host: PanelHost, at: Start): { draft: Input<F>; extra: Extra; say?: string } | { problem: string };
  // `extra`: what the form remembers (the mesh feature makes a new body a reference part by it)
  command(draft: Input<F>, editing: boolean, index: number, extra?: Extra): Command;
  incomplete?(draft: Input<F>): boolean; // nothing to compute or to confirm yet
  panel(mode: DraftMode<F, Extra>, host: PanelHost): HTMLElement[];
  live?(mode: DraftMode<F, Extra>, host: PanelHost): void; // the parts of the panel that follow the preview without a rebuild
  // What the form wants picked in the view now, asked at every pointer event. Without an answer the
  // app picks nothing and hands over the bare event (the extrusion finds its region with
  // `host.planePoint`); the extrusion asks for a face or a plane while its button "Pick" is armed.
  // `edges`: edges are picked (a chamfer and a fillet, D63). `before`: while it is asked for, the
  // view shows the state before the feature instead of the preview, so that what is picked is what
  // the feature will work on (a picked edge is gone from the preview).
  picks?(mode: DraftMode<F, Extra>): { faces?: true; planes?: true; edges?: true; before?: true } | undefined;
  hover?(mode: DraftMode<F, Extra>, event: PointerEvent, pick: ViewPick | undefined, host: PanelHost): boolean; // true: redraw the scene
  click?(mode: DraftMode<F, Extra>, event: PointerEvent, pick: ViewPick | undefined, host: PanelHost): void;
  overlay?(mode: DraftMode<F, Extra>, scene: SceneModel, host: PanelHost): void; // what the draft draws
}

// The entry of a feature type in the registry of the app.
export interface FeatureUi<F extends Feature, Extra = unknown> {
  button?: { label: string; title: string };
  // How a new feature starts. `plane`: a plane or a planar face is picked first and handed over;
  // `header` is the title of the panel that waits for the pick. `run` answers false when it
  // refused; the app then keeps waiting for another plane.
  create?: { plane?: { header: string }; run(host: PanelHost, at: Start): boolean };
  edit(host: PanelHost, feature: F): void; // a sketch enters its mode, the others open their form
  summary(host: PanelHost, feature: F, result: FeatureResult | undefined): HTMLElement[]; // the lines of the model panel about a selected feature
  ownsFace?(feature: F, name: FaceName): boolean; // the faces a selected feature highlights
  hideable(feature: F): boolean; // is its eye on the timeline enabled
  form?: FeatureForm<F, Extra>;
}

export interface DraftMode<F extends Feature = Feature, Extra = unknown> {
  kind: 'draft';
  form: FeatureForm<F, Extra>;
  editing: boolean;
  index: number; // the place of the feature on the timeline
  draft: Input<F>; // input form: a numeric field holds a number or an expression
  extra: Extra; // what the form remembers beyond the draft
  preview?: EngineState;
  problem?: string;
  warning?: boolean; // the problem is a warning of the preview, not an error
}
// A draft of any type, as the code that is the same for every type reads it.
export type AnyDraft = DraftMode<any, any>;

// The state of drafts that outlives one mode: the cost of the last preview, the timer of
// a delayed one, and the flag that a draft is being confirmed (no preview in between).
export interface DraftState {
  cost: number; // ms the last preview took
  timer?: number;
  confirming: boolean;
}

const SLOW_PREVIEW = 150; // ms; a preview slower than this is not recomputed on every keystroke
const PREVIEW_PAUSE = 500; // ms without typing before such a preview is computed

// Opens the form of a new feature. Answers false when the form has no draft to offer.
export function startDraft<F extends Feature, Extra>(host: PanelHost, form: FeatureForm<F, Extra>, at: Start): boolean {
  const start = form.draft(host, at);
  if ('problem' in start) {
    host.say(start.problem, true);
    return false;
  }
  host.openDraft({ kind: 'draft', form, editing: false, index: at.index, draft: start.draft, extra: start.extra });
  if (start.say !== undefined) host.say(start.say);
  return true;
}

// Opens the form of a feature of the document.
export function editDraft<F extends Feature, Extra>(host: PanelHost, form: FeatureForm<F, Extra>, feature: F, extra: Extra): void {
  host.openDraft({ kind: 'draft', form, editing: true, index: host.doc.features.findIndex((f) => f.id === feature.id), draft: featureInput(feature), extra });
}

// Náhled: příkaz se spočítá po upravovanou feature a dokument se nemění.
export function updatePreview(host: PanelHost): void {
  const state = host.drafting;
  window.clearTimeout(state.timer);
  state.timer = undefined;
  const m = host.draft;
  if (!m) return;
  host.invalidate();
  // An angle typed in degrees and out of range is reported in degrees here; the engine would
  // report the radians it was converted to.
  const angle = FEATURE_TYPE_INFO[(m.draft as Feature).type].fields.map((field) => angleProblem(draftValue(m, field.path), field.spec)).find((problem) => problem !== undefined);
  if (angle !== undefined) {
    m.preview = undefined;
    m.problem = angle;
    m.warning = false;
    state.cost = 0; // nothing was computed
    return;
  }
  // a draft with nothing to compute yet (an extrusion without regions, a pattern without a source): the panel says so itself
  if (m.form.incomplete?.(m.draft)) {
    m.preview = undefined;
    m.problem = undefined;
    m.warning = false;
    state.cost = 0; // nothing was computed
    return;
  }
  const started = performance.now();
  const result = host.engine.preview(m.form.command(m.draft, m.editing, m.index, m.extra), m.draft.id);
  state.cost = performance.now() - started;
  m.preview = result.ok ? result.state : undefined;
  const outcome = result.ok ? result.state.evaluation.features[m.draft.id] : undefined;
  m.problem = result.ok ? (outcome?.error ? host.issueText(outcome.error) : outcome?.warnings.map((w) => host.issueText(w)).join(' ')) || undefined : result.error.message;
  // a warning does not stop the feature from being confirmed; it is shown as one
  m.warning = result.ok && !outcome?.error;
  host.invalidate();
}

// A change of the draft shows in the preview at once. When the last preview was slow (a pattern
// with many copies takes seconds), a change typed into a field waits for a pause in the typing
// instead: every keystroke would otherwise block the app for that long.
export function draftChanged(host: PanelHost, rebuild = true): void {
  const state = host.drafting;
  if (!rebuild && state.cost > SLOW_PREVIEW) {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => host.draft && showDraft(host, false), PREVIEW_PAUSE);
    const problem = document.getElementById('draft-problem');
    if (problem) {
      problem.textContent = 'The preview takes a while; it follows after a pause in typing.';
      problem.className = 'issue warning';
    }
    return;
  }
  showDraft(host, rebuild);
}
function showDraft(host: PanelHost, rebuild: boolean): void {
  updatePreview(host);
  if (rebuild) host.renderPanel();
  else {
    const m = host.draft as AnyDraft;
    const problem = document.getElementById('draft-problem');
    if (problem) {
      problem.textContent = m.problem ?? '';
      problem.className = `issue ${m.warning ? 'warning' : 'error'}`;
    }
    // expression values next to the fields
    for (const note of Array.from(document.querySelectorAll<HTMLElement>('#panel [data-field]'))) note.textContent = draftNote(m, note.dataset.field as string, note.dataset.unit as Unit);
    m.form.live?.(m, host);
  }
  host.renderScene();
}

function confirmDraft(host: PanelHost, m: AnyDraft): void {
  // The form is left as soon as the command is in: the refresh the engine triggers must not
  // preview the same change once more on top of the changed document (seconds for a slow pattern).
  host.drafting.confirming = true;
  const done = host.run(m.form.command(m.draft, m.editing, m.index, m.extra), m.editing ? 'Změna uložena.' : `${FEATURE_TYPES[(m.draft as Feature).type]} přidáno.`);
  host.drafting.confirming = false;
  if (!done) return;
  if (!m.editing) host.inserted(m.draft.id);
  host.closeDraft(true);
}

// The problem of the preview, and the buttons that confirm the draft or leave it.
export function draftButtons(host: PanelHost, m: AnyDraft): HTMLElement[] {
  return [
    h('p', { id: 'draft-problem', className: `issue ${m.warning ? 'warning' : 'error'}` }, m.problem ?? ''),
    h(
      'div',
      { className: 'buttons' },
      h('button', { textContent: 'OK', className: 'primary', disabled: m.form.incomplete?.(m.draft) === true, onclick: () => confirmDraft(host, m) }),
      h('button', { textContent: 'Zrušit', onclick: () => host.closeDraft(false) }),
    ),
  ];
}

// A numeric field of a feature draft: a number or an expression. Next to an expression is its value from the preview.
export function draftField(host: PanelHost, m: AnyDraft, label: string, path: string, change: (value: number | Expr) => void): HTMLElement {
  // the field of the variant the draft is (several generators have a parameter of one name)
  const unit = FEATURE_TYPE_INFO[(m.draft as Feature).type].fields.find((field) => field.path === path && (!field.when || atPath(m.draft, field.when.path) === field.when.equals))?.spec.unit ?? 'mm';
  const names = host.doc.parameters.map((p) => p.name);
  const input = h('input', {
    value: fieldText(draftValue(m, path), unit),
    oninput: () => {
      const parsed = parseField(input.value, unit);
      markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
      change(parsed ?? NaN); // the engine rejects an empty field and the preview says so
    },
  });
  const note = h('small', { className: 'computed' }, draftNote(m, path, unit));
  note.dataset.field = path;
  note.dataset.unit = unit;
  return h('label', {}, label, h('span', { className: 'field' }, input, note));
}
function draftValue(m: AnyDraft, path: string): number | Expr {
  return path.split('/').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], m.draft) as number | Expr;
}
function draftNote(m: AnyDraft, path: string, unit: Unit): string {
  return fieldNote(draftValue(m, path), m.preview?.evaluation.features[m.draft.id]?.values?.[path], unit);
}
