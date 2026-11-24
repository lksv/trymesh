// What the two feature types of edges, the chamfer and the fillet (D63), share in the document:
// the body, the list of edges, no edge twice, the references. The recompute is
// recompute/edge-blend.ts; the design is docs/d36/4b-edge-chamfer-fillet/design.md.
import type { NumberSpec } from '../catalog';
import type { EdgeName, Id } from '../types';
import { edgeKey } from '../util';
import { type Dict, type FeatureRef, type ValidationContext, edgeName, faceRefs, fail, requireFace, string } from '../validation';

// The body, the edges and the size of a chamfer or a fillet, validated. `field` is the name of the
// numeric field of the size (`distance` or `radius`).
export function blendFields(o: Dict, what: string, context: ValidationContext, field: string, spec: NumberSpec): { body: Id; edges: EdgeName[]; size: number } {
  const body = string(o.body, `${what}.body`);
  context.requireRef({ id: body, kind: 'body' }, `${what}.body`);
  if (!Array.isArray(o.edges) || o.edges.length === 0) return fail(`${what}.edges: a non-empty list of edges is expected, each named by its two faces { a, b } as the query body lists them`);
  const seen = new Map<string, number>();
  const edges = (o.edges as unknown[]).map((given, i) => {
    const edge = edgeName(given, `${what}.edges[${i}]`);
    for (const face of [edge.a, edge.b]) requireFace(context, face, `${what}.edges[${i}]`);
    const key = edgeKey(edge);
    const earlier = seen.get(key);
    if (earlier !== undefined) fail(`${what}.edges[${i}]: the edge is listed twice, also at ${earlier}`);
    seen.set(key, i);
    return edge;
  });
  return { body, edges, size: context.fields.number(o[field], field, spec, `${what}.${field}`) };
}

// The references: the body, and the two faces of every edge.
export const blendRefs = (f: { body: Id; edges: EdgeName[] }): FeatureRef[] => [
  { path: 'body', id: f.body, kind: 'body' },
  ...f.edges.flatMap((edge, i) => [...faceRefs(edge.a, `edges/${i}/a`), ...faceRefs(edge.b, `edges/${i}/b`)]),
];

// What both summaries of the registry say after their first sentence (D63, with the run-outs of
// D67).
export const BLEND_SUMMARY =
  'The edges are named by their two faces, as the query `body` lists them: a straight edge between two planes, or a circular edge between a plane, a cylinder and a cone about one axis. A convex edge is cut, a concave one gets material added. ' +
  'An edge may end at a plane, at another edge of the feature, or run out past a round face it crosses at 10° or more: into a hole, a pocket or a boss (the rim of a bore into a pin pocket, an edge into a hole, the foot of a rib into a boss), out through a round wall into the air outside it (a slot through a shaft), and a circular edge also past a plane parallel to its axis (the rim of a bore into a keyway); the chamfer or fillet then ends on that face. ' +
  'Refused, with a detail that says what to do: an edge that would have to stop at a round face (a convex edge into a wall, a concave edge past a rim), a chamfer or fillet whose corner passes behind the round face before crossing it (a hole that notches the edge less deep than the size: blend before the feature that makes the hole, or use a smaller size), and a run-out that would cut or add material beyond that face (a pin in the pocket, a pocket shallower than the size). An edge that runs on smoothly into another needs that edge in the same feature; a convex and a concave edge that meet at a vertex go into two features. ' +
  'Each edge gets one new face `{ feature, role, edge: <its place in edges, from 0> }`; the faces of the edge keep their names. The facts `setback/<i>` (how far from edge i the new face meets its faces) and `cut/<i>` (true where material was cut).';
