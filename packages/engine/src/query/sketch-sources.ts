// The query `sketchSources` (D69): what a sketch can project from the sketches before it. Without
// `from`, those sketches with whether their planes are parallel; with `from`, every entity of that
// sketch a projection may name, placed in the coordinates of the asking sketch as a projection
// would put it. The picker of the app's tool *From sketch* is its view.
import { projectFromSketch, sketchMap } from '../references/projection';
import type { SketchState } from '../recompute/state';
import { wholeSketch } from '../sketch-project';
import type { Id, Projected, SketchFeature } from '../types';
import { underOrigin } from '../util';
import type { ArgSpecs } from './args';
import { QueryFailure, type QuerySpec } from './spec';

export const SKETCH_SOURCES_ARGS = {
  sketch: { kind: 'sketch', title: 'Sketch', summary: 'The sketch that would project.' },
  from: { kind: 'sketch', title: 'From', summary: 'One earlier sketch, to list its entities; without it the earlier sketches are listed.', optional: true },
  max: { kind: 'number', title: 'Most entities', summary: 'The most entities to list; `total` counts them all.', optional: true, spec: { title: 'Most entities to list', unit: 'count', integer: true, min: { value: 1 }, default: 200 } },
} as const satisfies ArgSpecs;

// One earlier sketch as a source.
// - `status`: `parallel` (it can be projected), `tilted` (its plane is at `angle` rad to the plane
//   of the asking sketch: a projection would be `unsupportedProjection`), `notEvaluated`
//   (suppressed or in error: a projection would be `brokenProjection`).
// - `flips`: the normals are opposite, so a projection reflects (an arc swaps its ends).
// - `curves`, `points`: how many entities a projection may name (as `entities` lists them).
export interface SketchSource {
  sketch: Id;
  name: string;
  status: 'parallel' | 'tilted' | 'notEvaluated';
  angle: number;
  flips: boolean;
  curves: number;
  points: number;
}
// One entity of `from` a projection may name: its own curves (construction ones too) and those of
// its entries, its points (own points, the ends and centres of its curves, `origin`, the points of
// its entries); nothing under `origin/`.
// - `whole`: the sketch tool projectSketch takes it without `entities`.
// - `regions`: it forms regions in its own sketch (the role projectSketch keeps by default).
// - `construction`: an own construction curve. `entry`: the entry of the asking sketch that
//   projects it already.
// - its place in the coordinates of the asking sketch: `at` of a point; `a`, `b` of a line;
//   `center`, `radius` of a circle; `center`, `start`, `end` of an arc (the ends swapped when the
//   map flips). `problem` instead of a place when it cannot be projected as it stands (no extent).
// - A spline (D70) is listed with its kind, `whole: false` and no place: a spline is not projected
//   yet; its control points are entities of the same list, as points.
export type SourceEntity = { id: Id; whole: boolean; regions: boolean; construction?: true; entry?: Id } & (
  | { kind: 'point'; at: [number, number] }
  | { kind: 'line'; a: [number, number]; b: [number, number] }
  | { kind: 'circle'; center: [number, number]; radius: number }
  | { kind: 'arc'; center: [number, number]; start: [number, number]; end: [number, number] }
  | { kind: 'point' | 'line' | 'circle' | 'arc'; problem: string }
  | { kind: 'spline'; whole: false }
);
// `sources`: without `from` the sketches before `sketch` in the order of the timeline; with it the
// one. `entities` and `total` only with `from`, and only when that sketch is `parallel`.
export interface SketchSourcesResult {
  sources: SketchSource[];
  entities?: SourceEntity[];
  total?: number;
}

declare module './spec' {
  interface Queries {
    sketchSources: { spec: typeof SKETCH_SOURCES_ARGS; result: SketchSourcesResult };
  }
}

// The entities of a solved sketch a projection may name, in the order the query lists them: those
// projectSketch takes whole, in its order, then the other curves, then the other points.
type EntityKind4 = 'point' | 'line' | 'circle' | 'arc' | 'spline';
function entitiesOf(state: SketchState): { id: Id; kind: EntityKind4; whole: boolean }[] {
  const curves = new Map([...state.curves].filter(([id]) => !underOrigin(id)));
  const whole = wholeSketch(state.feature, curves);
  const taken = new Set(whole);
  const kindOf = (id: Id): EntityKind4 => curves.get(id)?.shape.type ?? 'point';
  const others = [...[...curves.keys()].filter((id) => !taken.has(id)), ...Object.keys(state.geometry.points).filter((id) => !underOrigin(id) && !curves.has(id) && !taken.has(id))];
  return [...whole.map((id) => ({ id, kind: kindOf(id), whole: true })), ...others.map((id) => ({ id, kind: kindOf(id), whole: false }))];
}

const placeOf = (value: Projected): object => {
  switch (value.kind) {
    case 'point':
      return { at: value.at };
    case 'line':
      return { a: value.a, b: value.b };
    case 'circle':
      return { center: value.center, radius: value.radius };
    case 'arc':
      return { center: value.center, start: value.start, end: value.end };
  }
};

export const sketchSources: QuerySpec<typeof SKETCH_SOURCES_ARGS, SketchSourcesResult> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'What a sketch can project from earlier sketches',
  summary:
    'The sketches before a sketch on the timeline and whether each lies on a parallel plane, and, for one of them, every point and curve a projection may name, placed in the coordinates of the asking sketch. Ask it before addExternal with `type: "sketch"` or the sketch tool projectSketch.',
  returns:
    '`sources` (each `sketch`, `name`, `status`: parallel, tilted or notEvaluated; `angle` in rad; `flips`; `curves` and `points`, the counts) and, with `from` on a parallel plane, `entities`: each `id`, `kind`, `whole` (the sketch tool projectSketch takes it without `entities`), `regions` (it forms regions in its own sketch), `construction`, `entry` (the entry of the asking sketch that projects it already) and its place in mm in the asking sketch (`at`; `a`, `b`; `center`, `radius`; `center`, `start`, `end`), those projectSketch takes whole first; a spline has its kind and no place (a spline is not projected; its control points are listed as points); at most `max`, with `total`.',
  units: { angle: 'rad', at: 'mm', a: 'mm', b: 'mm', center: 'mm', radius: 'mm', start: 'mm', end: 'mm' },
  args: SKETCH_SOURCES_ARGS,
  run: (context, { sketch, from, max }) => {
    const document = context.state.document;
    const index = document.features.findIndex((f) => f.id === sketch);
    const target = context.sketch(sketch);
    if (!target) throw new QueryFailure('notAvailable', `the sketch "${sketch}" did not evaluate (suppressed, or its plane is broken): its plane is not known`, ['sketch']);
    const earlier = document.features.slice(0, index).filter((f): f is SketchFeature => f.type === 'sketch');
    if (from !== undefined && !earlier.some((f) => f.id === from)) throw new QueryFailure('invalidArguments', `"${from}" is not a sketch before "${sketch}" on the timeline`, ['from']);
    const listed = from === undefined ? earlier : earlier.filter((f) => f.id === from);
    const describe = (feature: SketchFeature): { source: SketchSource; state?: SketchState } => {
      const state = context.sketch(feature.id);
      if (!state) return { source: { sketch: feature.id, name: feature.name, status: 'notEvaluated', angle: 0, flips: false, curves: 0, points: 0 } };
      const map = sketchMap(state.frame, target.frame);
      const entities = context.memo([state], 'sketchSources entities', () => entitiesOf(state));
      const curves = entities.filter((entity) => entity.kind !== 'point').length;
      return { source: { sketch: feature.id, name: feature.name, status: map.parallel ? 'parallel' : 'tilted', angle: map.angle, flips: map.flips, curves, points: entities.length - curves }, state };
    };
    const sources = listed.map(describe);
    if (from === undefined) return { sources: sources.map((s) => s.source) };
    const [{ source, state }] = sources;
    if (source.status !== 'parallel' || !state) return { sources: [source] };
    const answer = context.memo([state, target, target.feature], 'sketchSources places', () => {
      const projects = new Map<Id, Id>();
      for (const [entry, ref] of Object.entries(target.feature.external)) if (ref.type === 'sketch' && ref.sketch === from) projects.set(ref.entity, entry);
      return entitiesOf(state).map((entity): SourceEntity => {
        const curve = state.curves.get(entity.id);
        const construction = curve?.source === 'own' && state.feature.curves[entity.id]?.construction === true;
        if (entity.kind === 'spline') return { id: entity.id, kind: 'spline', whole: false, regions: curve?.regions ?? false, ...(construction ? { construction: true as const } : {}) };
        const value = projectFromSketch({ type: 'sketch', sketch: from, entity: entity.id, kind: entity.kind, regions: false }, state, target.frame);
        const entry = projects.get(entity.id);
        return {
          id: entity.id,
          kind: entity.kind,
          whole: entity.whole,
          regions: curve?.regions ?? false,
          ...(construction ? { construction: true as const } : {}),
          ...(entry === undefined ? {} : { entry }),
          ...('code' in value ? { problem: value.detail } : placeOf(value)),
        } as SourceEntity;
      });
    });
    return { sources: [source], entities: answer.slice(0, max), total: answer.length };
  },
};
