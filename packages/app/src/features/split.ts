// The split in the app (D56): its form (the body, the plane picked in the view, which part becomes
// the new body), its summary with the later features that still name only the body, and the cut face.
import { type Command, type Feature, type Id, type Input, type PlaneRef, type SplitFeature, bodyRefs } from '@trymesh/engine';
import { h } from '../dom';
import type { PanelHost } from '../host';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, editDraft, startDraft } from './draft';
import { planeText } from './plane';

type SplitDraft = Input<SplitFeature>;
interface Extra {
  picking?: boolean; // the button "Pick" is armed: the next click in the view takes a plane or a planar face
}
type SplitMode = DraftMode<SplitFeature, Extra>;
const SIDES: Record<SplitFeature['side'], string> = { forward: 'in front of the plane (where its normal points)', backward: 'behind the plane' };

const bodiesBefore = (host: PanelHost, index: number): Id[] => Object.keys(host.stateBefore(index).evaluation.bodies);

function splitCommand(draft: SplitDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  return { type: 'updateFeature', id: draft.id, patch: { body: draft.body, plane: draft.plane, side: draft.side } };
}

function splitPanel(m: SplitMode, host: PanelHost): HTMLElement[] {
  const bodies = bodiesBefore(host, m.index);
  const set = (change: Partial<SplitDraft>) => {
    m.draft = { ...m.draft, ...change };
    draftChanged(host);
  };
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const arm = () => {
    m.extra.picking = !m.extra.picking;
    host.say(m.extra.picking ? 'Click a plane or a planar face in the view: the body is split by its plane.' : `Plane: ${planeText(host, m.draft.plane)}.`);
    draftChanged(host);
  };
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New split'),
    h('label', {}, 'Body', h('select', { onchange: (event: Event) => set({ body: (event.target as HTMLSelectElement).value }) }, ...bodies.map((body) => option(body, host.bodyName(body), body === m.draft.body)), bodies.includes(m.draft.body) ? null : option(m.draft.body, `${m.draft.body} (missing)`, true))),
    h('p', {}, `Plane: ${planeText(host, m.draft.plane)}`),
    h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking ? 'Picking… (click to stop)' : 'Pick', onclick: arm })),
    h('label', {}, 'New body', h('select', { onchange: (event: Event) => set({ side: (event.target as HTMLSelectElement).value as SplitFeature['side'] }) }, ...(Object.keys(SIDES) as SplitFeature['side'][]).map((side) => option(side, `The part ${SIDES[side]}`, side === m.draft.side)))),
    h('p', { className: 'hint' }, 'The body keeps its ID and the other part; later features that name it reach that part only.'),
    ...draftButtons(host, m),
  ];
}

const form: FeatureForm<SplitFeature, Extra> = {
  // A new split: the body selected in the view or the latest one, by the plane XY until another is picked.
  draft(host, at) {
    const bodies = bodiesBefore(host, at.index);
    if (bodies.length === 0) return { problem: 'A split needs a body. Create one first.' };
    const body = host.selected && host.selected.kind !== 'plane' && bodies.includes(host.selected.body) ? host.selected.body : bodies[bodies.length - 1];
    const id = host.newId('s');
    return {
      draft: { id, name: `Split ${id.slice(1)}`, suppressed: false, type: 'split', body, plane: at.plane ?? { kind: 'base', plane: 'XY' }, side: 'backward' },
      extra: { picking: true },
      say: 'Click a plane or a planar face in the view: the body is split by its plane.',
    };
  },
  command: splitCommand,
  panel: splitPanel,
  picks: (m) => (m.extra.picking ? { faces: true, planes: true } : undefined),
  // While "Pick" is armed a click takes a plane or a planar face; otherwise a click on a body picks the body.
  click(m, _event, pick, host) {
    if (m.extra.picking) {
      const plane = host.planeRefOf(pick);
      if (!plane) return host.say('A split is made by a plane or a planar face.', true);
      if (plane.kind === 'face' && (plane.body === m.draft.id || plane.face.feature === m.draft.id)) return host.say('The plane cannot be a face the split itself makes; pick one that exists before it.', true);
      m.extra.picking = false;
      m.draft = { ...m.draft, plane: plane as Input<PlaneRef> };
      host.say(`Plane: ${planeText(host, plane)}.`);
      draftChanged(host);
      return;
    }
    if (!pick || pick.kind === 'plane' || !bodiesBefore(host, m.index).includes(pick.body)) return;
    m.draft = { ...m.draft, body: pick.body };
    draftChanged(host);
  },
};

// The later features that name the body of a split and not its new body: they reach the part that
// kept the ID only.
function stillOnBody(host: PanelHost, f: SplitFeature): Feature[] {
  const after = host.doc.features.slice(host.doc.features.findIndex((other) => other.id === f.id) + 1);
  const names = (other: Feature, id: Id): boolean => bodyRefs(other).includes(id);
  return after.filter((other) => names(other, f.body) && !names(other, f.id));
}

export const split: FeatureUi<SplitFeature, Extra> = {
  button: { label: 'Split', title: 'Cut a body into two by a plane; both parts get the cut face' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const later = stillOnBody(host, f);
    return [
      h('p', { className: 'hint' }, `${host.bodyName(f.body)} split by ${planeText(host, f.plane)}; the part ${SIDES[f.side]} is the new body ${host.bodyName(f.id)}.`),
      ...(later.length ? [h('p', { className: 'hint' }, `Still on the part that kept the ID only: ${later.map((other) => host.nameOf(other.id)).join(', ')}.`)] : []),
    ];
  },
  ownsFace: (feature, name) => name.feature === feature.id && name.role === 'splitFace',
  hideable: () => true,
  form,
};
