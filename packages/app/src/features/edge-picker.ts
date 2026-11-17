// The chamfer and the fillet of edges in the app (D63): one form for both types. The edges are
// picked in the view from the body as it is before the feature: while the button "Pick edges" is
// armed the view shows that state (`picks` answers `before`), the picked edges are drawn over it,
// a click on an edge adds it and a click on a picked one removes it. Disarmed, the view shows the
// preview, in which the picked edges are gone.
import { type ChamferFeature, type Command, type EdgeName, type FaceName, type Feature, type FilletFeature, type Id, type Input, faceKey } from '@trymesh/engine';
import { fmt, h } from '../dom';
import { COLOR } from '../draw';
import type { PanelHost } from '../host';
import { edgeLabel } from '../issue-text';
import { shownValue } from '../labels';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

type Blend = ChamferFeature | FilletFeature;
type Kind = Blend['type'];
type BlendDraft = Input<Blend>;
interface Extra {
  picking?: boolean; // the button "Pick edges" is armed
}
type BlendMode = DraftMode<Blend, Extra>;

const SIZE: Record<Kind, { field: 'distance' | 'radius'; label: string; title: string; prefix: string; edges: string }> = {
  chamfer: { field: 'distance', label: 'Distance (mm, along both faces)', title: 'Chamfer', prefix: 'chamfer', edges: 'Click straight or circular edges of one body in the view: a click on a picked edge removes it.' },
  fillet: { field: 'radius', label: 'Radius (mm)', title: 'Fillet', prefix: 'fillet', edges: 'Click straight or circular edges of one body in the view: a click on a picked edge removes it.' },
};
const KINDS: Record<string, string> = { line: 'straight', circle: 'circular', coplanar: 'between flush faces', other: 'a general curve' };

export const edgeKeyOf = (edge: EdgeName): string => `${faceKey(edge.a)}|${faceKey(edge.b)}`;
// The edges of a draft as the engine names them (the input form would let a number of a face name
// be an expression, which no edge picked in the view has).
const edgesOf = (draft: BlendDraft): EdgeName[] => draft.edges as unknown as EdgeName[];
const sizeOf = (draft: BlendDraft): number | string => (draft.type === 'chamfer' ? draft.distance : draft.radius);
const bodiesBefore = (host: PanelHost, index: number): Id[] => Object.keys(host.stateBefore(index).evaluation.bodies);

// The command of the draft: a new feature, or the change of its body, its edges and its size.
function blendCommand(draft: BlendDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  return { type: 'updateFeature', id: draft.id, patch: draft.type === 'chamfer' ? { body: draft.body, edges: draft.edges, distance: draft.distance } : { body: draft.body, edges: draft.edges, radius: draft.radius } };
}

// Later features that name a face of this feature: a change of the list renames the faces of the
// edges that move in it.
function namingLater(host: PanelHost, m: BlendMode): Feature[] {
  const names = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(names);
    if (typeof value !== 'object' || value === null) return false;
    const face = value as Partial<FaceName>;
    if (face.feature === m.draft.id && face.role === m.draft.type) return true;
    return Object.values(value).some(names);
  };
  return host.doc.features.slice(m.index + 1).filter(names);
}

// The edge picked in the view, as the engine names it, with its kind; undefined when the state
// before the feature has no such edge.
function kindOf(host: PanelHost, index: number, body: Id, edge: EdgeName): string | undefined {
  const found = host.stateBefore(index).evaluation.bodies[body]?.edges.find((candidate) => edgeKeyOf(candidate.name) === edgeKeyOf(edge));
  return found?.kind;
}

function blendPanel(m: BlendMode, host: PanelHost): HTMLElement[] {
  const kind = m.draft.type;
  const spec = SIZE[kind];
  const typeOf = (id: Id) => host.feature(id)?.type;
  const arm = () => {
    m.extra.picking = !m.extra.picking;
    host.say(m.extra.picking ? spec.edges : `${m.draft.edges.length} edge${m.draft.edges.length === 1 ? '' : 's'} picked.`);
    draftChanged(host);
  };
  const remove = (i: number) => {
    m.draft = { ...m.draft, edges: m.draft.edges.filter((_, k) => k !== i) };
    draftChanged(host);
  };
  const original = m.editing ? (host.feature(m.draft.id) as Blend | undefined) : undefined;
  const edges = edgesOf(m.draft);
  const moved = original !== undefined && original.edges.some((edge, i) => edges[i] === undefined || edgeKeyOf(edges[i]) !== edgeKeyOf(edge));
  const later = moved ? namingLater(host, m) : [];
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : `New ${spec.title.toLowerCase()}`),
    h('p', {}, `Body: ${m.draft.edges.length ? host.bodyName(m.draft.body) : 'the body of the first edge picked'}`),
    h(
      'ol',
      { className: 'edges' },
      ...edges.map((edge, i) =>
        h('li', {}, `${edgeLabel(edge, host.featureNames, typeOf)} (${KINDS[kindOf(host, m.index, m.draft.body, edge) ?? ''] ?? 'not on the body'}) `, h('small', {}, `${faceKey(edge.a)} × ${faceKey(edge.b)} `), h('button', { textContent: 'Remove', title: 'Take the edge out of the list', onclick: () => remove(i) })),
      ),
    ),
    m.draft.edges.length === 0 ? h('p', { className: 'hint' }, 'No edge picked yet.') : null,
    h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking ? 'Picking… (click to stop)' : 'Pick edges', onclick: arm })),
    draftField(host, m, spec.label, spec.field, (value) => {
      m.draft = { ...m.draft, [spec.field]: value } as BlendDraft;
      draftChanged(host, false);
    }),
    h('p', { className: 'hint' }, 'Each edge gets a face of its own, named by its place in the list. An edge that runs on smoothly into another (a line into the arc of a round corner) needs that one too; a convex and a concave edge that meet go into two features.'),
    later.length ? h('p', { className: 'issue warning' }, `The list changed: the faces of the edges that moved in it are renamed, and ${later.map((f) => host.nameOf(f.id)).join(', ')} name${later.length === 1 ? 's' : ''} a face of this feature.`) : null,
    h('p', { id: 'draft-facts', className: 'hint' }, factsText(m.preview?.evaluation.features[m.draft.id]?.facts, m.draft.edges.length)),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

// The setbacks of the facts, for a human: "setbacks 2, 2.31 mm".
function factsText(facts: Record<string, unknown> | undefined, count: number): string {
  const setbacks = Array.from({ length: count }, (_, i) => facts?.[`setback/${i}`]).filter((value): value is number => typeof value === 'number');
  if (setbacks.length === 0) return '';
  const added = Array.from({ length: count }, (_, i) => facts?.[`cut/${i}`]).filter((value) => value === false).length;
  return `Setback${setbacks.length === 1 ? '' : 's'} ${[...new Set(setbacks.map(fmt))].join(', ')} mm${added ? `; material added at ${added} concave edge${added === 1 ? '' : 's'}` : ''}.`;
}

function form(kind: Kind): FeatureForm<Blend, Extra> {
  const spec = SIZE[kind];
  return {
    // A new chamfer or fillet: on an edge selected in the view, if it can take one; the edges are
    // then picked in the view.
    draft(host, at) {
      const bodies = bodiesBefore(host, at.index);
      if (bodies.length === 0) return { problem: `A ${kind} needs a body with edges. Create one first.` };
      // the edge selected in the view, when the body has it before the feature and it can take one
      const selected = host.selected?.kind === 'edge' ? host.selected : undefined;
      const before = selected && bodies.includes(selected.body) ? kindOf(host, at.index, selected.body, selected.name) : undefined;
      const picked = selected && (before === 'line' || before === 'circle') ? selected : undefined;
      const body = picked?.body ?? (host.selected && host.selected.kind !== 'plane' && bodies.includes(host.selected.body) ? host.selected.body : bodies[bodies.length - 1]);
      const id = host.newId(spec.prefix);
      const common = { id, name: `${spec.title} ${id.slice(spec.prefix.length)}`, suppressed: false, body, edges: picked ? [picked.name] : [] };
      return { draft: kind === 'chamfer' ? { ...common, type: 'chamfer', distance: 1 } : { ...common, type: 'fillet', radius: 1 }, extra: { picking: true }, say: spec.edges };
    },
    command: blendCommand,
    incomplete: (draft) => draft.edges.length === 0,
    panel: blendPanel,
    live(m) {
      const facts = document.getElementById('draft-facts');
      if (facts) facts.textContent = factsText(m.preview?.evaluation.features[m.draft.id]?.facts, m.draft.edges.length);
    },
    picks: (m) => (m.extra.picking ? { edges: true, before: true } : undefined),
    // While "Pick edges" is armed a click on an edge adds it, or removes it when it is in the list.
    // The first edge sets the body; an edge of another body or of another kind is refused here.
    click(m, _event, pick, host) {
      if (!m.extra.picking) return;
      if (pick?.kind !== 'edge') return host.say(`Click an edge. ${spec.edges}`, true);
      if (pick.edgeKind !== 'line' && pick.edgeKind !== 'circle') return host.say(`That edge is ${KINDS[pick.edgeKind]}: only a straight or a circular edge can take a ${kind}.`, true);
      // the body first: two bodies can have edges of the same name (the halves of a split)
      if (m.draft.edges.length && pick.body !== m.draft.body) return host.say(`The edges of one ${kind} belong to one body (${host.bodyName(m.draft.body)}); another body is another feature.`, true);
      const key = edgeKeyOf(pick.name);
      const at = edgesOf(m.draft).findIndex((edge) => edgeKeyOf(edge) === key);
      if (at >= 0) m.draft = { ...m.draft, edges: m.draft.edges.filter((_, i) => i !== at) };
      else m.draft = { ...m.draft, body: pick.body, edges: [...m.draft.edges, pick.name] };
      host.say(`${m.draft.edges.length} edge${m.draft.edges.length === 1 ? '' : 's'} picked.`);
      draftChanged(host);
    },
    // the picked edges over the state before the feature
    overlay(m, scene, host) {
      const body = host.stateBefore(m.index).evaluation.bodies[m.draft.body];
      if (!body) return;
      const keys = new Set(edgesOf(m.draft).map(edgeKeyOf));
      for (const edge of body.edges) if (keys.has(edgeKeyOf(edge.name))) scene.lines.push({ segments: Array.from(edge.segments), color: COLOR.select, width: 4, onTop: true });
    },
  };
}

// The entry of one of the two types in the registry of the app.
export function blendUi<K extends Kind>(kind: K): FeatureUi<Extract<Blend, { type: K }>, Extra> {
  const spec = SIZE[kind];
  const blendForm = form(kind) as unknown as FeatureForm<Extract<Blend, { type: K }>, Extra>;
  return {
    button: { label: spec.title, title: kind === 'chamfer' ? 'Chamfer edges of a body by a distance' : 'Round edges of a body by a radius' },
    create: { run: (host, at) => startDraft(host, blendForm, at) },
    edit: (host, feature) => editDraft(host, blendForm, feature, {}),
    summary(host, f, result) {
      const size = shownValue(f, spec.field, sizeOf(f as BlendDraft) as number);
      const out = [h('p', { className: 'hint' }, `${spec.title} of ${f.edges.length} edge${f.edges.length === 1 ? '' : 's'} of ${host.bodyName(f.body)}, ${spec.field} ${size} mm.`)];
      const facts = factsText(result?.facts, f.edges.length);
      if (facts) out.push(h('p', { className: 'hint' }, facts));
      return out;
    },
    ownsFace: (feature, name) => name.feature === feature.id && name.role === kind,
    hideable: () => false,
    form: blendForm,
  };
}
