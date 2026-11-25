// The tool *From sketch* (D69): projects a point or a curve of an earlier sketch on a parallel plane
// into the open sketch, or a whole sketch by the engine's sketch tool projectSketch. Its picker is
// the view of the query sketchSources: the candidates are the entities of the earlier sketches on
// parallel planes, where a projection would put them, drawn dashed while the tool is active. With
// one projection from a sketch selected, or one being repaired from its row, a pick replaces its
// source and keeps its ID.
import { type Id, type SketchSource, type SourceEntity, type Vec2, degreesText, sketchTool } from '@trymesh/engine';
import { h } from '../dom';
import { PICK_REACH } from '../host';
import type { SketchContext, SketchHost } from '../sketch-mode';
import { type Shape, closestOn, dist, polyline } from '../sketch-view';
import type { SketchPlaceTool } from './spec';

export interface ProjectSketchOptions {
  regions: boolean; // a single pick: the flag of the new entry
  whole: boolean; // a pick projects the whole sketch it lies in
  as: 'source' | 'reference' | 'regions' | 'own'; // with `whole`
  from?: Id; // one sketch only; absent: any
}
const AS: { value: ProjectSketchOptions['as']; label: string }[] = [
  { value: 'source', label: 'as in its source' },
  { value: 'reference', label: 'reference only' },
  { value: 'regions', label: 'forming regions' },
  { value: 'own', label: 'own curves over them' },
];

// One candidate: an entity of an earlier sketch with its place in the open sketch.
export interface Candidate {
  sketch: Id;
  id: Id;
  kind: Exclude<SourceEntity['kind'], 'spline'>; // a spline is not projected (D70)
  at?: Vec2; // a point
  shape?: Shape; // a curve
}
interface Candidates {
  sources: SketchSource[];
  entities: Candidate[]; // the latest sketch first
}

const TAU = 2 * Math.PI;
function shapeOf(entity: SourceEntity): Shape | undefined {
  if ('problem' in entity) return undefined;
  switch (entity.kind) {
    case 'point':
      return undefined;
    case 'line':
      return { type: 'line', a: entity.a, b: entity.b };
    case 'circle':
      return { type: 'circle', center: entity.center, radius: entity.radius };
    case 'arc': {
      const from = Math.atan2(entity.start[1] - entity.center[1], entity.start[0] - entity.center[0]);
      const to = Math.atan2(entity.end[1] - entity.center[1], entity.end[0] - entity.center[0]);
      return { type: 'arc', center: entity.center, radius: dist(entity.start, entity.center), from, sweep: (((to - from) % TAU) + TAU) % TAU || TAU };
    }
  }
}

// The candidates of the open sketch, asked of the engine once per shown state of the sketch: the
// sketches before it, and for each on a parallel plane all its entities.
const asked = new WeakMap<SketchContext, Candidates>();
export function candidatesOf(host: Pick<SketchHost, 'engine'>, context: SketchContext): Candidates {
  const known = asked.get(context);
  if (known) return known;
  const all = host.engine.query('sketchSources', { sketch: context.feature.id });
  const sources = all.ok ? all.result.sources : [];
  const entities: Candidate[] = [];
  for (const source of [...sources].reverse()) {
    if (source.status !== 'parallel') continue;
    const one = host.engine.query('sketchSources', { sketch: context.feature.id, from: source.sketch, max: 1e6 });
    if (!one.ok) continue;
    for (const entity of one.result.entities ?? []) {
      // an entity that cannot be projected: no extent, or a spline (D70: its control points are offered)
      if ('problem' in entity || entity.kind === 'spline') continue;
      entities.push({ sketch: source.sketch, id: entity.id, kind: entity.kind, ...(entity.kind === 'point' ? { at: (entity as { at: Vec2 }).at } : { shape: shapeOf(entity) }) });
    }
  }
  const made = { sources, entities };
  asked.set(context, made);
  return made;
}

// The candidate under the pointer: points before curves, the latest sketch first among equally near.
export function candidateAt(candidates: readonly Candidate[], p: Vec2, reach: number, from?: Id): { candidate: Candidate; at: Vec2 } | undefined {
  const pool = candidates.filter((c) => from === undefined || c.sketch === from);
  let best: { candidate: Candidate; at: Vec2; d: number } | undefined;
  for (const candidate of pool) {
    if (!candidate.at) continue;
    const d = dist(candidate.at, p);
    if (d <= reach && (!best || d < best.d)) best = { candidate, at: candidate.at, d };
  }
  if (best) return best;
  for (const candidate of pool) {
    if (!candidate.shape) continue;
    const at = closestOn(candidate.shape, p);
    const d = dist(at, p);
    if (d <= reach && (!best || d < best.d)) best = { candidate, at, d };
  }
  return best;
}

const optionsOf = (host: SketchHost): ProjectSketchOptions => (host.sketching.tools.projectSketch as ProjectSketchOptions | undefined) ?? INITIAL;
// The option *From* as it holds for the open sketch: a sketch that is no parallel source of it (the
// option was set in another sketch, or the source is gone, tilted or not evaluated now) is "any",
// as the select shows it.
export const fromOf = (sources: readonly SketchSource[], from: Id | undefined): Id | undefined => (from !== undefined && sources.some((source) => source.sketch === from && source.status === 'parallel') ? from : undefined);
const INITIAL: ProjectSketchOptions = { regions: false, whole: false, as: 'source' };

export const projectSketch: SketchPlaceTool<ProjectSketchOptions> = {
  label: 'From sketch',
  hint: 'Click a point or a curve of an earlier sketch (dashed) to project it; the options are in the panel.',
  atClick: true,
  picks: {
    pick: (host, event, context) => {
      const p = host.planePoint(event, context.frame)?.at;
      if (!p) return undefined;
      const candidates = candidatesOf(host, context);
      const found = candidateAt(candidates.entities, p, PICK_REACH * host.pixelSize(), fromOf(candidates.sources, optionsOf(host).from));
      return found ? { at: found.at, snap: { kind: 'foreign', sketch: found.candidate.sketch, id: found.candidate.id } } : { at: p };
    },
  },
  click: (host, m, places, context, options) => {
    const snap = places[places.length - 1]?.snap;
    if (snap?.kind !== 'foreign') return host.say('Click a point or a curve of an earlier sketch (dashed).', true);
    if (options.whole) {
      const made = sketchTool('projectSketch', context.tool, { sketch: snap.sketch, as: options.as }, host.newId);
      if (!made.ok) return host.say(`From sketch: ${made.message}`, true);
      const { entries, taken, curves, patched, skipped, doubled } = made.ids;
      const left = skipped.length + doubled.length;
      // an entry taken over is counted apart from the new ones (its flag switched off), and the
      // features renamed to its own curve are named
      host.run(
        { type: 'batch', commands: made.commands },
        `${host.nameOf(snap.sketch)} projected: ${entries.length - taken.length} entities${taken.length ? `, ${taken.length} taken over` : ''}${curves.length ? `, ${curves.length} own curves over them` : ''}${left ? `, ${left} left out (projected already or at a place taken)` : ''}${patched.length ? `; renamed to the own curves in ${patched.map((id) => host.nameOf(id)).join(', ')}` : ''}.`,
      );
      return;
    }
    const candidate = candidatesOf(host, context).entities.find((c) => c.sketch === snap.sketch && c.id === snap.id);
    if (!candidate) return;
    const selected = m.selection.length === 1 && context.feature.external[m.selection[0]]?.type === 'sketch' ? m.selection[0] : undefined;
    const repaired = m.repair ?? selected;
    // a repair keeps the flag of the entry it repairs (a curve's); a new entry takes the option
    const old = repaired === undefined ? undefined : context.feature.external[repaired];
    const ref = { type: 'sketch' as const, sketch: snap.sketch, entity: snap.id, kind: candidate.kind, regions: (old?.type === 'sketch' ? old.regions : options.regions) && candidate.kind !== 'point' };
    if (repaired) {
      if (host.run({ type: 'updateExternal', sketch: m.id, id: repaired, ref }, 'Projection repaired.')) m.repair = undefined;
    } else host.run({ type: 'addExternal', sketch: m.id, id: host.newId('x'), ref }, `${snap.id} of ${host.nameOf(snap.sketch)} projected.`);
  },
  draw: (_places, _cursor, context, options) => {
    const known = asked.get(context);
    if (!known) return [];
    const from = fromOf(known.sources, options.from);
    return known.entities.filter((c) => c.shape && (from === undefined || c.sketch === from)).map((c) => polyline(c.shape as Shape));
  },
  options: {
    initial: INITIAL,
    panel: (host, value, store) => {
      const context = host.sketchContext();
      const sources = context ? candidatesOf(host, context).sources : [];
      const chosen = fromOf(sources, value.from);
      const set = (next: ProjectSketchOptions): void => {
        store(next);
        host.renderPanel();
        host.renderScene();
      };
      const check = (label: string, title: string, on: boolean, change: (on: boolean) => ProjectSketchOptions): HTMLElement => {
        const box = h('input', { type: 'checkbox', checked: on, onchange: () => set(change(box.checked)) });
        return h('label', { className: 'check', title }, box, label);
      };
      const as = h(
        'select',
        { disabled: !value.whole, onchange: () => set({ ...value, as: as.value as ProjectSketchOptions['as'] }) },
        ...AS.map((option) => h('option', { value: option.value, selected: option.value === value.as }, option.label)),
      );
      const from = h(
        'select',
        { onchange: () => set({ ...value, from: from.value === '' ? undefined : from.value }) },
        h('option', { value: '', selected: chosen === undefined }, 'any earlier sketch'),
        ...sources.map((source) =>
          h('option', { value: source.sketch, selected: source.sketch === chosen, disabled: source.status !== 'parallel' }, source.status === 'parallel' ? source.name : source.status === 'tilted' ? `${source.name} (at ${degreesText((source.angle * 180) / Math.PI)})` : `${source.name} (not evaluated)`),
        ),
      );
      return [
        h('h2', {}, 'From sketch'),
        check('Forms regions', 'The projected curve bounds regions of this sketch (a point never does)', value.regions, (on) => ({ ...value, regions: on })),
        check('Whole sketch', 'A click projects the whole sketch it lies in, by the role below', value.whole, (on) => ({ ...value, whole: on })),
        h('label', {}, 'As', as),
        h('label', {}, 'From', from),
        h('p', { className: 'hint' }, 'The points and curves of the earlier sketches on parallel planes are drawn dashed where a projection puts them. A projection follows its source; one that forms regions is never trimmed: for an outline to cut, project the whole sketch as own curves over them.'),
      ];
    },
  },
};
