// The projection of an edge of a body into a sketch (the kind `edge` of `external`): a line or
// a circle by `kind`. The entry is its curve; its points are `<id>/a`, `<id>/b` of a line and
// `<id>/center` of a circle.
import { lookup } from '../recompute/services';
import { analyzeBody, projectEdge } from '../solid';
import type { EdgeProjection, Projected } from '../types';
import { edgeName, faceRefs, fail, finite, object, oneOf, requireFace, string } from '../validation';
import type { ReferenceKindSpec } from './spec';

// A stored value of a projection by its form: a line or a circle, whatever the entry it belongs to.
export function projected(v: unknown, what: string): Projected {
  const o = object(v, what);
  const vec2 = (value: unknown, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2) fail(`${what}.${name}: čeká se dvojice čísel`);
    const pair = value as unknown[];
    return [finite(pair[0], `${what}.${name}`), finite(pair[1], `${what}.${name}`)];
  };
  if (o.kind === 'line') return { kind: 'line', a: vec2(o.a, 'a'), b: vec2(o.b, 'b') };
  if (o.kind === 'circle') {
    const radius = finite(o.radius, `${what}.radius`);
    if (radius <= 0) fail(`${what}.radius: poloměr musí být kladný`);
    return { kind: 'circle', center: vec2(o.center, 'center'), radius };
  }
  return fail(`${what}.kind: čeká se line nebo circle`);
}

export const edge: ReferenceKindSpec<EdgeProjection, Projected> = {
  source: 'reference',
  title: 'Projection of an edge',
  summary:
    'An edge of a body made before the sketch, projected onto the plane of the sketch: a fixed curve of the sketch, `kind` `line` or `circle` (the edge has to be one). A line has the derived points `<id>/a` and `<id>/b`, a circle `<id>/center`. It is reference geometry: computed before the sketch is solved, so constraints and dimensions of the sketch may name the curve and its points; it bounds no region. The edge is named by its two faces as the query `body` lists it.',
  example: { id: 'pr', ref: { type: 'edge', body: 'box', edge: { a: { feature: 'box', role: 'endCap' }, b: { feature: 'box', role: 'side', curve: 'b1' } }, kind: 'line' } },
  validate: (context, _sketch, _id, o, what) => {
    const body = string(o.body, `${what}.body`);
    context.requireRef({ id: body, kind: 'body' }, what);
    const edge = edgeName(o.edge, `${what}.edge`);
    for (const face of [edge.a, edge.b]) requireFace(context, face, `${what}.edge`);
    return { type: 'edge', body, edge, kind: oneOf(o.kind, ['line', 'circle'] as const, `${what}.kind`) };
  },
  refs: (ref, path) => [{ path, id: ref.body, kind: 'body' }, ...faceRefs(ref.edge.a, path), ...faceRefs(ref.edge.b, path)],
  faces: (ref) => [ref.edge.a, ref.edge.b],
  entities: (id, ref) => (ref.kind === 'line' ? { [id]: 'line', [`${id}/a`]: 'point', [`${id}/b`]: 'point' } : { [id]: 'circle', [`${id}/center`]: 'point' }),
  compute: (ref, { state, frame }) => {
    const solid = lookup(state.bodies, ref.body);
    return solid ? projectEdge(analyzeBody(solid, state.faceNames, state.faceInfos, state.chordTolerance), ref.edge, ref.kind, frame, state.faceInfos, state.chordTolerance) : 'brokenProjection';
  },
  // the stored object itself, once its form is checked: it is what load made of it
  value: (stored, ref, what) => (projected(stored, what).kind === ref.kind ? (stored as Projected) : undefined),
  geometry: (id, _ref, value) =>
    value.kind === 'line'
      ? { points: { [`${id}/a`]: { x: value.a[0], y: value.a[1] }, [`${id}/b`]: { x: value.b[0], y: value.b[1] } }, curves: { [id]: { type: 'line', a: `${id}/a`, b: `${id}/b` } }, radii: {}, regions: [] }
      : { points: { [`${id}/center`]: { x: value.center[0], y: value.center[1] } }, curves: { [id]: { type: 'circle', center: `${id}/center` } }, radii: { [id]: value.radius }, regions: [] },
};
