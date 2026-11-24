// The view of the query `sketchContacts` (D65): the places where the outline curves of a sketch
// meet, as rows (the place, the kind, the two curves, what Split crossings would do there) and as
// marks in the view, the marks the sketch mode draws while the profile of the open sketch is
// invalid; then why the profile is invalid when no cut repairs it.
import { h } from '../dom';
import { COLOR, toWorld } from '../draw';
import type { QueryView } from './index';

const FIX: Record<'cut' | 'join' | 'none', string> = { cut: 'split cuts it', join: 'split joins the ends', none: 'no cut' };

export const sketchContactsView: QueryView<'sketchContacts'> = {
  immediate: true,
  answer(result, _args, panel) {
    if (result.status === 'unavailable') return [h('p', { className: 'hint' }, 'The sketch did not evaluate.')];
    const place = (at: [number, number]): string => `[${at.map((v) => panel.number(v, 'mm')).join(', ')}]`;
    return [
      h('p', { className: result.valid ? 'hint' : 'issue error' }, result.valid ? 'The profile is valid: no curves meet apart from common points.' : `The profile is invalid; ${result.total} contact(s).`),
      ...result.contacts.map((contact, index) =>
        h(
          'div',
          { className: `row ${panel.picked === index ? 'selected' : ''}`, title: contact.why ?? '', onclick: () => panel.pick(panel.picked === index ? undefined : index) },
          h('span', { className: 'name', textContent: `${contact.kind}: ${contact.curves.join(' × ')}` }),
          h('small', {}, `${place(contact.at)}, ${FIX[contact.fix]}`),
        ),
      ),
      ...(result.contacts.length < result.total ? [h('p', { className: 'hint' }, `Listed: ${result.contacts.length} of ${result.total}. Raise "Most contacts" to see the rest.`)] : []),
      ...result.lying.map(([a, b]) => h('p', { className: 'issue warning' }, `${a} and ${b} lie on each other.`)),
      ...result.degenerate.map((id) => h('p', { className: 'issue warning' }, `${id} has no length.`)),
      ...(result.reason ? [h('p', { className: 'issue warning' }, result.reason)] : []),
    ];
  },
  scene(result, args, panel) {
    const frame = panel.state.evaluation.features[args.sketch]?.plane;
    if (!frame || result.contacts.length === 0) return {};
    const picked = panel.picked === undefined ? undefined : result.contacts[panel.picked];
    return {
      points: [
        { positions: result.contacts.flatMap((contact) => toWorld(frame, contact.at[0], contact.at[1])), color: COLOR.clash, size: 9 },
        ...(picked ? [{ positions: toWorld(frame, picked.at[0], picked.at[1]), color: COLOR.select, size: 13 }] : []),
      ],
    };
  },
  note(result) {
    if (result.status === 'unavailable') return { text: 'Contacts: the sketch did not evaluate.', error: true };
    return result.valid ? { text: 'Contacts: the profile is valid.', error: false } : { text: `Contacts: ${result.total}${result.reason ? `; ${result.reason}` : ''}.`, error: false };
  },
};
