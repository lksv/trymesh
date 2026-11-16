// The plane in the app: a form with its base, picked in the view, and its offset.
import type { FaceName, Input, PlaneFeature, PlaneRef } from '@trymesh/engine';
import { h } from '../dom';
import { COLOR, loopSegments, planeSquare } from '../draw';
import type { PanelHost } from '../host';
import { faceLabel } from '../issue-text';
import { shownValue } from '../labels';
import { draftCommand } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

type Extra = Record<string, never>; // the form remembers nothing beyond the draft
type PlaneMode = DraftMode<PlaneFeature, Extra>;

// A plane reference as the forms show it: a base plane, a plane feature, or a face of a body.
export const planeText = (host: PanelHost, ref: PlaneRef | Input<PlaneRef>): string =>
  ref.kind === 'base' ? `rovina ${ref.plane}` : ref.kind === 'plane' ? `rovina „${host.nameOf(ref.feature)}“` : `stěna ${faceLabel(ref.face as FaceName, host.featureNames)} (${host.bodyName(ref.body)})`;

function planePanel(m: PlaneMode, host: PanelHost): HTMLElement[] {
  const label = planeText(host, m.draft.base);
  return [
    h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'Nová rovina'),
    h('p', {}, `Základ: ${label}`),
    h('p', { className: 'hint' }, 'Jiný základ zvolíte kliknutím na rovinu nebo rovinnou stěnu v pohledu.'),
    draftField(host, m, 'Offset along the normal (mm or an expression)', 'offset', (offset) => {
      m.draft = { ...m.draft, offset };
      draftChanged(host, false);
    }),
    ...draftButtons(host, m),
  ];
}

const form: FeatureForm<PlaneFeature, Extra> = {
  draft(host, at) {
    if (!at.plane) return { problem: 'Vyberte rovinu nebo rovinnou stěnu.' };
    const id = host.newId('r');
    return { draft: { id, name: `Rovina ${id.slice(1)}`, suppressed: false, type: 'plane', base: at.plane, offset: 10 }, extra: {}, say: 'Zadejte posun; kliknutím v pohledu lze změnit základ.' };
  },
  command: draftCommand,
  panel: planePanel,
  picks: () => ({ faces: true, planes: true }),
  // a click on a plane or a planar face makes it the base
  click(m, _event, pick, host) {
    const ref = host.planeRefOf(pick);
    if (!ref) return host.say('Základem roviny může být rovina nebo rovinná stěna.', true);
    m.draft = { ...m.draft, base: ref };
    draftChanged(host);
  },
  overlay(m, scene, host) {
    const state = host.view();
    const frame = state.evaluation.features[m.draft.id]?.plane;
    if (!frame) return;
    const square = planeSquare(host.planeSize(state));
    scene.fills.push({ frame, loops: [square], color: COLOR.select, opacity: 0.3 });
    scene.lines.push({ segments: loopSegments(frame, square), color: COLOR.select, width: 2 });
  },
};

export const plane: FeatureUi<PlaneFeature, Extra> = {
  button: { label: 'Rovina', title: 'Rovina posunutá od roviny nebo rovinné stěny' },
  // the plane picked first is the base of the draft
  create: { plane: { header: 'Nová rovina' }, run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary: (_host, f) => [h('p', { className: 'hint' }, `Posun ${shownValue(f, 'offset', f.offset)} mm.`)],
  hideable: () => true,
  form,
};
