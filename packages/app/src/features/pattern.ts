// The pattern in the app: its form (what to repeat, the kind of the transform, the axis or the
// direction, the count and the span, or the plane of a mirror), its summary, and the faces of its
// copies.
import { GRID_STRIDE, type Id, type Input, MAX_PATTERN_PLACES, type PatternFeature, type PlaneRef, type Unit, producesTool } from '@trymesh/engine';
import { h } from '../dom';
import { valueText } from '../fields';
import type { PanelHost } from '../host';
import { bodyName } from '../issue-text';
import { FIRST_DIRECTION, type FacePick, SECOND_DIRECTION, axisFaceText, axisRows, roundFaceOf } from '../axis-picker';
import { type LinearSpan, NEW_TRANSFORM, type PatternChange, type PatternChoices, type PatternKind, type PatternMemory, type PatternSpan, changePattern, draftCommand, lineIds, patternIncomplete, patternSource, rememberPattern } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';
import { planeText } from './plane';

// What the form remembers beyond the draft.
interface Extra {
  memory?: PatternMemory; // the transform the draft had in each kind and its spans, to return to
  picking?: boolean; // the button "Pick" of a mirror is armed: the next click in the view takes a plane or a planar face
  // the next click in the view takes a round face for the axis or the first direction (`first`) or
  // for the second direction of a grid (`second`) (D60)
  pickingAxis?: 'first' | 'second';
}
const KINDS: Record<PatternKind, string> = { circular: 'Around an axis', linear: 'Along a direction', mirror: 'Mirror in a plane' };
// The name of a new draft by its kind (`Pattern 7`, `Mirror 7`), while it has the default one.
const defaultName = (kind: PatternKind, id: Id): string => `${kind === 'mirror' ? 'Mirror' : 'Pattern'} ${id.slice(1)}`;
type PatternMode = DraftMode<PatternFeature, Extra>;

// What a pattern at this place of the timeline can repeat and turn around.
function patternChoices(host: PanelHost, index: number): PatternChoices {
  const before = host.doc.features.slice(0, index);
  return {
    tools: before.filter(producesTool).map((f) => f.id),
    bodies: Object.keys(host.stateBefore(index).evaluation.bodies),
    sketches: before.filter((f) => f.type === 'sketch').map((f) => f.id),
    lines: (sketch) => {
      const f = host.feature(sketch);
      return f?.type === 'sketch' ? lineIds(f) : [];
    },
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
    m.extra.memory = rememberPattern(m.extra.memory ?? {}, m.draft);
    const before = m.draft;
    m.draft = changePattern(m.draft, change, choices, m.extra.memory);
    // a new draft is named by its kind while its name is the default one
    if (!m.editing && before.name === defaultName(before.transform.type, before.id)) m.draft = { ...m.draft, name: defaultName(m.draft.transform.type, m.draft.id) };
    if (m.draft.transform.type !== 'mirror') m.extra.picking = false;
    if (change.kind !== undefined || change.axis !== undefined || change.second?.axis !== undefined || change.grid !== undefined || change.face !== undefined || change.second?.face !== undefined) m.extra.pickingAxis = undefined;
    draftChanged(host, rebuild);
  };
  // the pick of a round face for an axis (D60): one of the two directions at a time
  const facePick = (which: 'first' | 'second'): FacePick => ({
    armed: m.extra.pickingAxis === which,
    arm: () => {
      m.extra.pickingAxis = m.extra.pickingAxis === which ? undefined : which;
      m.extra.picking = false;
      if (m.extra.pickingAxis) host.say('Click a cylinder, a cone or a torus in the view: its axis.');
      draftChanged(host, true);
    },
  });
  const { source, transform } = m.draft;
  const out: (HTMLElement | null)[] = [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : transform.type === 'mirror' ? 'New mirror' : 'New pattern'),
    select('Repeat', (value) => set({ source: value as 'features' | 'body' }), option('features', 'Features (extrusions that add or cut)', source.type === 'features'), option('body', 'A body', source.type === 'body')),
    select('Kind', (value) => set({ kind: value as PatternKind }), ...(Object.keys(KINDS) as PatternKind[]).map((kind) => option(kind, KINDS[kind], kind === transform.type))),
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
  const count = (label = 'Count with the original (a whole number or an expression)') => draftField(host, m, label, 'transform/count', (value) => set({ count: value }, false));
  if (transform.type === 'circular') {
    const { axis, span } = transform;
    out.push(
      ...axisRows(host, axis, choices.sketches, set, 'An axis through a point needs a sketch before this place of the timeline.', undefined, facePick('first')),
      count(),
      select('Span', (value) => set({ span: value as PatternSpan['type'] }), option('full', 'Full circle', span.type === 'full'), option('angle', 'Angle between the first and the last copy', span.type === 'angle')),
      span.type === 'angle' ? draftField(host, m, 'Angle (° or an expression in radians)', 'transform/span/angle', (angle) => set({ angle }, false)) : null,
    );
  } else if (transform.type === 'linear') {
    const { direction, span, second } = transform;
    const noSketch = 'The normal of a sketch plane needs a sketch before this place of the timeline.';
    out.push(
      ...axisRows(host, direction, choices.sketches, set, noSketch, FIRST_DIRECTION, facePick('first')),
      count(second ? 'Count along the direction (a whole number or an expression)' : undefined),
      select('Span', (value) => set({ span: value as LinearSpan['type'] }), option('spacing', 'Spacing between neighbours', span.type === 'spacing'), option('length', 'Length between the first and the last copy', span.type === 'length')),
      span.type === 'spacing'
        ? draftField(host, m, 'Spacing (mm or an expression; negative = against the direction)', 'transform/span/spacing', (spacing) => set({ spacing }, false))
        : draftField(host, m, 'Length (mm or an expression; negative = against the direction)', 'transform/span/length', (length) => set({ length }, false)),
      h('p', { className: 'hint' }, span.type === 'spacing' ? 'A larger count adds copies at the far end and moves none.' : 'The copies divide the length evenly; a change of the count moves them all.'),
      // a grid (D53): the row repeated along a second direction
      h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: second !== undefined, onchange: () => set({ grid: second === undefined }) }), 'A second direction (a grid)'),
    );
    if (second) {
      const along = (change: Parameters<typeof set>[0]['second'], rebuild = true) => set({ second: change }, rebuild);
      out.push(
        // the hint that no sketch is there is shown once, by the first picker
        ...axisRows(host, second.direction, choices.sketches, (change) => along(change), '', SECOND_DIRECTION, facePick('second')),
        draftField(host, m, 'Count along the second direction (a whole number or an expression)', 'transform/second/count', (value) => along({ count: value }, false)),
        select('Second span', (value) => along({ span: value as LinearSpan['type'] }), option('spacing', 'Spacing between neighbouring rows', second.span.type === 'spacing'), option('length', 'Length between the first and the last row', second.span.type === 'length')),
        second.span.type === 'spacing'
          ? draftField(host, m, 'Second spacing (mm or an expression; negative = against the direction)', 'transform/second/span/spacing', (spacing) => along({ spacing }, false))
          : draftField(host, m, 'Second length (mm or an expression; negative = against the direction)', 'transform/second/span/length', (length) => along({ length }, false)),
        h('p', { className: 'hint' }, `Copy numbers: steps along the first direction + ${GRID_STRIDE} × steps along the second, so the second row starts at ${GRID_STRIDE}. At most ${MAX_PATTERN_PLACES} places.`),
      );
    }
  } else out.push(...mirrorRows(m, host, transform.plane, set));
  out.push(h('p', { id: 'draft-bodies', className: 'hint' }, patternBodies(m, host)), ...draftButtons(host, m));
  return out.filter((element): element is HTMLElement => element !== null);
}

// The plane of a mirror: a select with the base planes and the plane features before the pattern
// (and the face the draft has, by its label), and the button that arms a pick in the view.
function mirrorRows(m: PatternMode, host: PanelHost, plane: Input<PlaneRef>, set: (change: PatternChange) => void): HTMLElement[] {
  const planes = host.doc.features.slice(0, m.index).filter((f) => f.type === 'plane' && f.id !== m.draft.id).map((f) => f.id);
  const refs: PlaneRef[] = [...(['XY', 'XZ', 'YZ'] as const).map((name): PlaneRef => ({ kind: 'base', plane: name })), ...planes.map((feature): PlaneRef => ({ kind: 'plane', feature }))];
  const keyOf = (ref: Input<PlaneRef>): string => (ref.kind === 'base' ? `base:${ref.plane}` : ref.kind === 'plane' ? `plane:${ref.feature}` : 'face');
  const listed = refs.some((ref) => keyOf(ref) === keyOf(plane));
  const choose = (value: string) => {
    const ref = refs.find((candidate) => keyOf(candidate) === value);
    if (ref) set({ plane: ref });
  };
  const arm = () => {
    m.extra.picking = !m.extra.picking;
    m.extra.pickingAxis = undefined;
    host.say(m.extra.picking ? 'Click a plane or a planar face in the view: the copy is the mirror image in its plane.' : `Mirror plane: ${planeText(host, plane)}.`);
    draftChanged(host, true);
  };
  return [
    h(
      'label',
      {},
      'Mirror plane',
      h(
        'select',
        { onchange: (event: Event) => choose((event.target as HTMLSelectElement).value) },
        ...refs.map((ref) => h('option', { value: keyOf(ref), textContent: planeText(host, ref), selected: keyOf(ref) === keyOf(plane) })),
        listed ? null : h('option', { value: keyOf(plane), textContent: plane.kind === 'plane' ? `${planeText(host, plane)} (missing)` : planeText(host, plane), selected: true }),
      ),
    ),
    h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking ? 'Picking… (click to stop)' : 'Pick', onclick: arm })),
    h('p', { className: 'hint' }, 'One copy, the mirror image in the plane; for a face the whole plane it lies in. A plane of symmetry is best a base plane or a plane feature offset by an expression.'),
  ];
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
      draft: { id, name: defaultName('circular', id), suppressed: false, type: 'pattern', source, transform: NEW_TRANSFORM.circular },
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
  // While "Pick" of a mirror is armed a click takes a plane or a planar face (not one the previewed
  // pattern made); otherwise a click on a body picks it as the source of a pattern of a body (not
  // a copy of the preview itself).
  click(m, _event, pick, host) {
    const choices = patternChoices(host, m.index);
    // the axis of a round face before the pattern (not one of the copies the preview makes)
    if (m.extra.pickingAxis) {
      const face = roundFaceOf(host, pick);
      if (!face) return host.say('The axis of a face is the axis of a cylinder, a cone or a torus; click one of them.', true);
      if (face.body.startsWith(`${m.draft.id}/`) || (face.face.copy ?? []).some((tag) => tag.pattern === m.draft.id)) return host.say('The axis cannot be that of a face the pattern itself makes; pick a face that exists before it.', true);
      const which = m.extra.pickingAxis;
      m.extra.pickingAxis = undefined;
      m.extra.memory = rememberPattern(m.extra.memory ?? {}, m.draft);
      m.draft = changePattern(m.draft, which === 'second' ? { second: { face } } : { face }, choices, m.extra.memory);
      host.say(`Axis: ${axisFaceText(host, face.body, face.face)}.`);
      draftChanged(host, true);
      return;
    }
    if (m.extra.picking) {
      const plane = host.planeRefOf(pick);
      if (!plane) return host.say('A mirror plane is a plane or a planar face.', true);
      const own = plane.kind === 'face' && (plane.body.startsWith(`${m.draft.id}/`) || (plane.face.copy ?? []).some((tag) => tag.pattern === m.draft.id));
      if (own) return host.say('The mirror cannot be in a face the pattern itself makes; pick a plane or a face that exists before it.', true);
      m.extra.picking = false;
      m.extra.memory = rememberPattern(m.extra.memory ?? {}, m.draft);
      m.draft = changePattern(m.draft, { plane }, choices, m.extra.memory);
      host.say(`Mirror plane: ${planeText(host, plane)}.`);
      draftChanged(host, true);
      return;
    }
    if (m.draft.source.type !== 'body' || !pick || pick.kind === 'plane' || !choices.bodies.includes(pick.body)) return;
    m.draft = changePattern(m.draft, { body: pick.body }, choices, m.extra.memory);
    draftChanged(host);
  },
};

export const pattern: FeatureUi<PatternFeature, Extra> = {
  button: { label: 'Pattern', title: 'Repeat extrusions that add or cut, or a body: around an axis, along a direction, or mirrored in a plane' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const t = f.transform;
    const field = (path: string, value: number, unit: Unit): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${valueText(value, unit)}` : valueText(value, unit));
    const source = f.source.type === 'features' ? `features: ${f.source.features.map((id) => host.nameOf(id)).join(', ')}` : `body: ${host.bodyName(f.source.body)}`;
    if (t.type === 'mirror') return [h('p', { className: 'hint' }, `Mirrored in ${planeText(host, t.plane)}; ${source}.`)];
    if (t.type === 'linear') {
      // one direction: along what, and by which span, at `transform/` or `transform/second/`
      const way = (prefix: string, d: { direction: typeof t.direction; span: typeof t.span }): string => {
        const along =
          d.direction.kind === 'base'
            ? `axis ${d.direction.axis}`
            : d.direction.kind === 'sketchLine'
              ? `the line ${d.direction.line} of ${host.nameOf(d.direction.sketch)}`
              : d.direction.kind === 'face'
                ? `the axis of ${axisFaceText(host, d.direction.body, d.direction.face)}`
                : `the normal of ${host.nameOf(d.direction.sketch)}`;
        const extent = d.span.type === 'spacing' ? `spacing ${field(`${prefix}/span/spacing`, d.span.spacing, 'mm')}` : `length ${field(`${prefix}/span/length`, d.span.length, 'mm')}`;
        return `along ${along}, ${extent}`;
      };
      const count = field('transform/count', t.count, 'count');
      if (!t.second) return [h('p', { className: 'hint' }, `Count ${count} with the original, ${way('transform', t)}; ${source}.`)];
      return [h('p', { className: 'hint' }, `Count ${count} × ${field('transform/second/count', t.second.count, 'count')} with the original, ${way('transform', t)}, and ${way('transform/second', t.second)}; ${source}.`)];
    }
    const around =
      t.axis.kind === 'base'
        ? `axis ${t.axis.axis}`
        : t.axis.kind === 'sketchLine'
          ? `the line ${t.axis.line} of ${host.nameOf(t.axis.sketch)}`
          : t.axis.kind === 'face'
            ? `the axis of ${axisFaceText(host, t.axis.body, t.axis.face)}`
            : `the point ${t.axis.point} of ${host.nameOf(t.axis.sketch)}`;
    const extent = t.span.type === 'full' ? 'the full circle' : `an angle of ${field('transform/span/angle', t.span.angle, 'rad')}`;
    return [h('p', { className: 'hint' }, `Count ${field('transform/count', t.count, 'count')} with the original, around ${around}, ${extent}; ${source}.`)];
  },
  // the faces of the copies the pattern made
  ownsFace: (feature, name) => (name.copy ?? []).some((tag) => tag.pattern === feature.id),
  // a pattern of features has no body of its own; a pattern of a body hides all its copies
  hideable: (feature) => feature.source.type !== 'features',
  form,
};
