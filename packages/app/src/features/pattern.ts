// The pattern in the app: its form (what to repeat, the axis, the count and the span), its
// summary, and the faces of its copies.
import { type Id, type PatternFeature, type Unit, producesTool } from '@trymesh/engine';
import { h } from '../dom';
import { valueText } from '../fields';
import type { PanelHost } from '../host';
import { bodyName } from '../issue-text';
import { type AxisKind, type PatternChange, type PatternChoices, type PatternSpan, axisKind, changePattern, draftCommand, patternIncomplete, patternSource } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

// What the form remembers beyond the draft.
interface Extra {
  angle?: PatternSpan; // the angle span the draft had last, to return to from the full circle
}
type PatternMode = DraftMode<PatternFeature, Extra>;

const AXES: Record<AxisKind, string> = { X: 'Axis X', Y: 'Axis Y', Z: 'Axis Z', sketchPoint: 'Through a point of a sketch' };

// What a pattern at this place of the timeline can repeat and turn around.
function patternChoices(host: PanelHost, index: number): PatternChoices {
  const before = host.doc.features.slice(0, index);
  return {
    tools: before.filter(producesTool).map((f) => f.id),
    bodies: Object.keys(host.stateBefore(index).evaluation.bodies),
    sketches: before.filter((f) => f.type === 'sketch').map((f) => f.id),
  };
}

// The pattern form: what to repeat (extrusions that add or cut, or one body), the axis and the
// count with the span. The preview shows the result; a source or an axis that no longer exists
// stays in the form marked as missing, so that it can be replaced.
function patternPanel(m: PatternMode, host: PanelHost): HTMLElement[] {
  const choices = patternChoices(host, m.index);
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const set = (change: PatternChange, rebuild = true) => {
    if (m.draft.transform.span.type === 'angle') m.extra.angle = m.draft.transform.span;
    m.draft = changePattern(m.draft, change, choices, m.extra.angle);
    draftChanged(host, rebuild);
  };
  const { source } = m.draft;
  const { axis, span } = m.draft.transform;
  const out: (HTMLElement | null)[] = [
    h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'New pattern'),
    select('Repeat', (value) => set({ source: value as 'features' | 'body' }), option('features', 'Features (extrusions that add or cut)', source.type === 'features'), option('body', 'A body', source.type === 'body')),
  ];
  if (source.type === 'features') {
    const missing = source.features.filter((id) => !choices.tools.includes(id));
    out.push(
      h(
        'fieldset',
        {},
        h('legend', {}, 'Features'),
        ...[...missing, ...choices.tools].map((id) =>
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: source.features.includes(id), onchange: () => set({ toggleFeature: id }) }), choices.tools.includes(id) ? host.nameOf(id) : `${host.nameOf(id)} (missing)`),
        ),
        choices.tools.length === 0 && missing.length === 0 ? h('p', { className: 'hint' }, 'There is no extrusion that adds or cuts before this place of the timeline.') : null,
      ),
      h('p', { className: 'hint' }, 'Every copy is built again in its place and applied to the targets of its feature, in the order of the timeline. A cut through all is measured for every copy.'),
    );
  } else {
    out.push(
      select(
        'Body',
        (value) => set({ body: value }),
        ...choices.bodies.map((body) => option(body, host.bodyName(body), body === source.body)),
        choices.bodies.includes(source.body) ? null : option(source.body, source.body === '' ? '(no body yet)' : `${source.body} (missing)`, true),
      ),
      h('p', { className: 'hint' }, 'The copies are new bodies; what is added to the source after the pattern is not copied.'),
    );
  }
  out.push(select('Axis', (value) => set({ axis: value as AxisKind }), ...(Object.keys(AXES) as AxisKind[]).map((kind) => option(kind, AXES[kind], kind === axisKind(axis)))));
  if (axis.kind === 'sketchPoint') {
    const sketch = host.feature(axis.sketch);
    const points = sketch?.type === 'sketch' && choices.sketches.includes(axis.sketch) ? ['origin', ...Object.keys(sketch.points), ...Object.entries(sketch.external).flatMap(([id, ref]) => (ref.kind === 'line' ? [`${id}/a`, `${id}/b`] : [`${id}/center`]))] : [];
    out.push(
      select(
        'Sketch',
        (value) => set({ sketch: value }),
        ...choices.sketches.map((id) => option(id, host.nameOf(id), id === axis.sketch)),
        choices.sketches.includes(axis.sketch) ? null : option(axis.sketch, `${host.nameOf(axis.sketch)} (missing)`, true),
      ),
      select('Point', (value) => set({ point: value }), ...points.map((id) => option(id, id === 'origin' ? 'origin of the sketch' : id, id === axis.point)), points.includes(axis.point) ? null : option(axis.point, `${axis.point} (missing)`, true)),
      h('p', { className: 'hint' }, 'The axis is the normal of the sketch plane through the point.'),
    );
  } else if (choices.sketches.length === 0) out.push(h('p', { className: 'hint' }, 'An axis through a point needs a sketch before this place of the timeline.'));
  out.push(
    draftField(host, m, 'Count with the original (a whole number or an expression)', 'transform/count', (count) => set({ count }, false)),
    select('Span', (value) => set({ span: value as PatternSpan['type'] }), option('full', 'Full circle', span.type === 'full'), option('angle', 'Angle between the first and the last copy', span.type === 'angle')),
    span.type === 'angle' ? draftField(host, m, 'Angle (° or an expression in radians)', 'transform/span/angle', (angle) => set({ angle }, false)) : null,
    h('p', { id: 'draft-bodies', className: 'hint' }, patternBodies(m, host)),
    ...draftButtons(host, m),
  );
  return out.filter((element): element is HTMLElement => element !== null);
}
// The bodies the previewed pattern creates, for the form.
function patternBodies(m: PatternMode, host: PanelHost): string {
  const bodies = m.preview?.evaluation.features[m.draft.id]?.bodies ?? [];
  // a new pattern is not in the document yet: its copies take the name of the draft
  const nameOf = (id: Id): string | undefined => (id === m.draft.id ? m.draft.name : host.featureNames(id));
  return bodies.length ? `New bodies: ${bodies.map((body) => bodyName(body, nameOf)).join(', ')}.` : '';
}

const form: FeatureForm<PatternFeature, Extra> = {
  // A new pattern: its source is the feature selected on the timeline when it can be one, otherwise
  // the latest extrusion that adds or cuts, otherwise the latest body.
  draft(host, at) {
    const source = patternSource(patternChoices(host, at.index), host.selectedFeature);
    if (!source) return { problem: 'A pattern needs an extrusion that adds or cuts, or a body. Create one first.' };
    const id = host.newId('n');
    return {
      draft: { id, name: `Pattern ${id.slice(1)}`, suppressed: false, type: 'pattern', source, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 4, span: { type: 'full' } } },
      extra: {},
      say: 'Choose what to repeat, the axis and the count.',
    };
  },
  command: draftCommand,
  incomplete: patternIncomplete,
  panel: patternPanel,
  live(m, host) {
    const bodies = document.getElementById('draft-bodies');
    if (bodies) bodies.textContent = patternBodies(m, host);
  },
  picks: () => ({ faces: true, planes: true }),
  // a click on a body picks it as the source of a pattern of a body (not a copy of the preview itself)
  click(m, _event, pick, host) {
    const choices = patternChoices(host, m.index);
    if (m.draft.source.type !== 'body' || !pick || pick.kind === 'plane' || !choices.bodies.includes(pick.body)) return;
    m.draft = changePattern(m.draft, { body: pick.body }, choices, m.extra.angle);
    draftChanged(host);
  },
};

export const pattern: FeatureUi<PatternFeature, Extra> = {
  button: { label: 'Pattern', title: 'Repeat extrusions that add or cut, or a body, around an axis' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const { axis, count, span } = f.transform;
    const field = (path: string, value: number, unit: Unit): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${valueText(value, unit)}` : valueText(value, unit));
    const source = f.source.type === 'features' ? `features: ${f.source.features.map((id) => host.nameOf(id)).join(', ')}` : `body: ${host.bodyName(f.source.body)}`;
    const around = axis.kind === 'base' ? `axis ${axis.axis}` : `the point ${axis.point} of ${host.nameOf(axis.sketch)}`;
    const extent = span.type === 'full' ? 'the full circle' : `an angle of ${field('transform/span/angle', span.angle, 'rad')}`;
    return [h('p', { className: 'hint' }, `Count ${field('transform/count', count, 'count')} with the original, around ${around}, ${extent}; ${source}.`)];
  },
  // the faces of the copies the pattern made
  ownsFace: (feature, name) => (name.copy ?? []).some((tag) => tag.pattern === feature.id),
  // a pattern of features has no body of its own; a pattern of a body hides all its copies
  hideable: (feature) => feature.source.type !== 'features',
  form,
};
