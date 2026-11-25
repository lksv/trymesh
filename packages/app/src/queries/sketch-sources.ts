// The view of the query `sketchSources` (D69): the earlier sketches a sketch can project from, each
// with its plane, and with `from` the entities of one of them; a picked entity is marked where
// a projection would put it. The tool From sketch reads the same answers as its candidates.
import { h } from '../dom';
import { COLOR, toWorld } from '../draw';
import type { QueryView } from './index';

const STATUS = { parallel: 'parallel', tilted: 'tilted', notEvaluated: 'not evaluated' } as const;

export const sketchSourcesView: QueryView<'sketchSources'> = {
  answer(result, _args, panel) {
    const rows = result.sources.map((source) =>
      h('div', { className: 'row' }, h('span', { className: 'name', textContent: source.name }), h('small', {}, `${STATUS[source.status]}${source.status === 'tilted' ? ` at ${panel.number(source.angle, 'rad')}` : ''}${source.flips ? ', the other side' : ''}; ${source.curves} curves, ${source.points} points`)),
    );
    const entities = (result.entities ?? []).map((entity, index) =>
      h(
        'div',
        { className: `row ${panel.picked === index ? 'selected' : ''}`, onclick: () => panel.pick(panel.picked === index ? undefined : index) },
        h('span', { className: 'name', textContent: `${entity.id} (${entity.kind})` }),
        h('small', {}, [entity.whole ? 'whole' : '', entity.regions ? 'regions' : '', entity.entry ? `projected as ${entity.entry}` : '', 'problem' in entity ? entity.problem : ''].filter(Boolean).join(', ')),
      ),
    );
    return [
      ...(result.sources.length === 0 ? [h('p', { className: 'hint' }, 'No sketch lies before this one.')] : rows),
      ...entities,
      ...(result.total !== undefined && entities.length < result.total ? [h('p', { className: 'hint' }, `Listed: ${entities.length} of ${result.total}. Raise "Most entities" to see the rest.`)] : []),
    ];
  },
  scene(result, args, panel) {
    const frame = panel.state.evaluation.features[args.sketch]?.plane;
    const entity = panel.picked === undefined ? undefined : result.entities?.[panel.picked];
    if (!frame || !entity || 'problem' in entity) return {};
    const at = entity.kind === 'point' ? entity.at : entity.kind === 'line' ? entity.a : entity.kind === 'circle' ? entity.center : entity.start;
    return { points: [{ positions: toWorld(frame, at[0], at[1]), color: COLOR.select, size: 11 }] };
  },
  note: (result) => ({ text: result.entities ? `${result.total} entities to project.` : `Earlier sketches: ${result.sources.length}, parallel: ${result.sources.filter((s) => s.status === 'parallel').length}.`, error: false }),
};
