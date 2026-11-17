// The combine in the app (D56): its form (the operation, the target, the tools, whether they stay,
// the clearance of a difference), its summary and the faces of its pockets.
import type { Command, CombineFeature, Id, Input } from '@trymesh/engine';
import { h } from '../dom';
import type { PanelHost } from '../host';
import { shownValue } from '../labels';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

type CombineDraft = Input<CombineFeature>;
type Extra = Record<string, never>; // the form remembers nothing beyond the draft
type CombineMode = DraftMode<CombineFeature, Extra>;

export const OPERATIONS: Record<CombineFeature['operation'], string> = { union: 'Union (join the tools to the target)', difference: 'Difference (subtract the tools)', intersection: 'Intersection (keep what the target shares with the tools)' };
const SHORT: Record<CombineFeature['operation'], string> = { union: 'Union', difference: 'Difference', intersection: 'Intersection' };

// The bodies of the model before the feature.
const bodiesBefore = (host: PanelHost, index: number): Id[] => Object.keys(host.stateBefore(index).evaluation.bodies);

function combineCommand(draft: CombineDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  const { operation, target, tools, keepTools, clearance } = draft;
  return { type: 'updateFeature', id: draft.id, patch: { operation, target, tools, keepTools, clearance: clearance ?? null } };
}

// The draft with another target, tools or operation: the target is never a tool, and only
// a difference keeps a clearance.
function changed(m: CombineMode, change: Partial<CombineDraft>): CombineDraft {
  const next = { ...m.draft, ...change };
  const tools = next.tools.filter((tool) => tool !== next.target);
  const { clearance, ...rest } = next;
  return next.operation === 'difference' && clearance !== undefined ? { ...rest, tools, clearance } : { ...rest, tools };
}

function combinePanel(m: CombineMode, host: PanelHost): HTMLElement[] {
  const bodies = bodiesBefore(host, m.index);
  const set = (change: Partial<CombineDraft>, rebuild = true) => {
    m.draft = changed(m, change);
    draftChanged(host, rebuild);
  };
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const { operation, target, tools, keepTools } = m.draft;
  const missing = [target, ...tools].filter((id) => id !== '' && !bodies.includes(id));
  const listed = [...bodies, ...missing];
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New combine'),
    h('label', {}, 'Operation', h('select', { onchange: (event: Event) => set({ operation: (event.target as HTMLSelectElement).value as CombineFeature['operation'] }) }, ...(Object.keys(OPERATIONS) as CombineFeature['operation'][]).map((op) => option(op, OPERATIONS[op], op === operation)))),
    h(
      'label',
      {},
      'Target',
      h(
        'select',
        { onchange: (event: Event) => set({ target: (event.target as HTMLSelectElement).value }) },
        target === '' ? option('', '(choose a body)', true) : null,
        ...listed.map((body) => option(body, bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`, body === target)),
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Tools'),
      ...listed
        .filter((body) => body !== target)
        .map((body) =>
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: tools.includes(body), onchange: () => set({ tools: tools.includes(body) ? tools.filter((tool) => tool !== body) : [...tools, body] }) }), bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`),
        ),
      listed.length < 2 ? h('p', { className: 'hint' }, 'A combine needs a second body before this place of the timeline.') : null,
    ),
    h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: keepTools, onchange: () => set({ keepTools: !keepTools }) }), 'Keep the tools (unticked: the tool bodies leave the model)'),
    operation === 'difference'
      ? draftField(host, m, 'Clearance (mm or an expression; empty for none)', 'clearance', (value) => set(Number.isNaN(value) ? { clearance: undefined } : { clearance: value }, false))
      : null,
    operation === 'difference' ? h('p', { className: 'hint' }, 'With a clearance every face of a tool is moved outwards by it before the tool is subtracted; the faces of the pocket are named after the faces of the tool.') : null,
    h('p', { className: 'hint' }, 'A click on a body in the view adds it to the tools or takes it out; the first click of a new combine sets the target.'),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

const form: FeatureForm<CombineFeature, Extra> = {
  // A new combine: a difference that keeps its tools, the target the body selected in the view when
  // there is one; the tools are ticked in the form or clicked in the view.
  draft(host, at) {
    const bodies = bodiesBefore(host, at.index);
    if (bodies.length < 2) return { problem: 'A combine needs two bodies. Create them first.' };
    const picked = host.selected && host.selected.kind !== 'plane' && bodies.includes(host.selected.body) ? host.selected.body : '';
    const id = host.newId('c');
    return {
      draft: { id, name: `Combine ${id.slice(1)}`, suppressed: false, type: 'combine', operation: 'difference', target: picked, tools: [], keepTools: true },
      extra: {},
      say: picked === '' ? 'Click the target body, then the tools.' : 'Click the tools in the view or tick them in the form.',
    };
  },
  command: combineCommand,
  incomplete: (draft) => draft.target === '' || draft.tools.length === 0,
  panel: combinePanel,
  // a click on a body: the first one of a new combine sets the target, the others toggle a tool
  click(m, _event, pick, host) {
    if (!pick || pick.kind === 'plane' || !bodiesBefore(host, m.index).includes(pick.body)) return;
    const body = pick.body;
    if (m.draft.target === '') m.draft = changed(m, { target: body });
    else if (body !== m.draft.target) m.draft = changed(m, { tools: m.draft.tools.includes(body) ? m.draft.tools.filter((tool) => tool !== body) : [...m.draft.tools, body] });
    draftChanged(host);
  },
};

export const combine: FeatureUi<CombineFeature, Extra> = {
  button: { label: 'Combine', title: 'Join, subtract or intersect finished bodies; subtract with a clearance' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const clearance = f.operation === 'difference' && (f.clearance !== undefined || f.expressions?.clearance) ? `, clearance ${shownValue(f, 'clearance', f.clearance ?? 0)} mm` : '';
    return [h('p', { className: 'hint' }, `${SHORT[f.operation]} of ${host.bodyName(f.target)} with ${f.tools.map((id) => host.bodyName(id)).join(', ')} (${f.keepTools ? 'kept' : 'used up'})${clearance}.`)];
  },
  // the faces its tools left with a clearance carry its tag
  ownsFace: (feature, name) => (name.copy ?? []).some((tag) => tag.pattern === feature.id),
  // a combine has no body of its own
  hideable: () => false,
  form,
};
