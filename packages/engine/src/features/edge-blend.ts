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

// What both summaries of the registry say after their first sentence.
export const BLEND_SUMMARY =
  'The edges are named by their two faces, as the query `body` lists them: a straight edge between two planes, or a circular edge between a plane, a cylinder and a cone about one axis. A convex edge is cut, a concave one gets material added. ' +
  'An edge that runs on smoothly into another (a line of an outline with round corners) needs that edge in the same feature, and the error names it; a convex and a concave edge that meet at a vertex go into two features. ' +
  'Each edge gets one new face `{ feature, role, edge: <its place in edges, from 0> }`; the faces of the edge keep their names. The facts `setback/<i>` (how far from edge i the new face meets its faces) and `cut/<i>` (true where material was cut).';
