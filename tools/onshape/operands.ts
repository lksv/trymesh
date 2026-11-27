import { solvedCurves as solvedCurvesOf } from '../../packages/engine/src/index';
// What an external operand of an Onshape sketch constraint is (design of 6h, "External operands").
// A constraint names it by one deterministic ID and nothing else. The ID decodes (read off a dump,
// not documented by Onshape): after the first character, the second is the operation that made the
// entity, and the rest is a number in base 64, least significant digit first, whose low two bits
// are the kind (0 a vertex, 1 an edge, 2 a face, 3 a body) and the rest an index. `created` of the
// dump (fs.json) lists the bodies and faces every feature created, so the owner of an operation is
// known; what it is decides by the type of that feature.

export type EntityKind = 'vertex' | 'edge' | 'face' | 'body';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const KINDS: EntityKind[] = ['vertex', 'edge', 'face', 'body'];

export interface Decoded {
  op: string;
  kind: EntityKind;
  index: number;
}

// undefined: not an ID of this shape (a character outside base 64, shorter than two).
export function decode(id: string): Decoded | undefined {
  if (id.length < 2) return undefined;
  const digits = [...id.slice(1)].map((c) => B64.indexOf(c));
  if (digits.some((d) => d < 0)) return undefined;
  let n = 0;
  for (let i = digits.length - 1; i >= 1; i--) n = n * 64 + digits[i];
  return { op: id[1], kind: KINDS[n & 3], index: n >> 2 };
}

// The inverse, for fixtures: an ID of an operation, a kind and an index.
export function encode(op: string, kind: EntityKind, index: number, first = 'J'): string {
  let n = index * 4 + KINDS.indexOf(kind);
  let rest = '';
  while (n > 0) {
    rest += B64[n % 64];
    n = Math.floor(n / 64);
  }
  return first + op + rest;
}

// Onshape's origin and default planes by their IDs (from knowledge of Onshape, supported by the
// decode: vertex 0 of operation B, face 0 of the operations C, D, E before the first feature F).
// The normal of each plane in the world.
export const ORIGIN_ID = 'IB';
export const DEFAULT_PLANES: Record<string, { name: string; normal: [number, number, number] }> = {
  JCC: { name: 'Front', normal: [0, -1, 0] },
  JDC: { name: 'Top', normal: [0, 0, 1] },
  JEC: { name: 'Right', normal: [1, 0, 0] },
};

// The rows of the table of "What an external ID is": the type of the feature that owns an operation.
export type OwnerRow = 'sketch' | 'derived' | 'solid' | 'plane' | 'other';
// Feature types that make or change solids: those the converter converts. Not "everything else".
export const SOLID_FEATURES = new Set(['extrude', 'fillet', 'chamfer']);
const rowOf = (featureType: string | undefined): OwnerRow =>
  featureType === 'newSketch' ? 'sketch' : featureType === 'importDerived' ? 'derived' : SOLID_FEATURES.has(featureType ?? '') ? 'solid' : featureType === 'cPlane' ? 'plane' : 'other';

// What an ID is, by the decode and the studio's `created`.
export type IdClass =
  | { what: 'origin' }
  | { what: 'plane'; name: string; normal: [number, number, number] } // a default plane
  | { what: 'sketch'; decoded: Decoded; feature: string } // an entity of the sketch made from that Onshape feature
  | { what: 'derived'; decoded: Decoded; feature: string } // an entity of a copy that importDerived brings
  | { what: 'solid'; decoded: Decoded; features: string[] } // an edge or a vertex of a body
  | { what: 'planeFeature'; decoded: Decoded; feature: string } // a face of a plane feature
  | { what: 'unknown'; decoded?: Decoded; why: string };

// The operations of one studio. The self-test at its start: every ID `created` lists has to decode
// to the kind it is listed under (bodies and faces only: `created` lists no vertex and no edge).
export class StudioOperations {
  readonly owners = new Map<string, string[]>(); // operation -> the features that list it
  readonly typeOf = new Map<string, string>(); // feature ID -> its type
  readonly failures: string[] = []; // IDs of `created` that do not decode to their kind

  constructor(features: { featureId: string; featureType: string }[], created: Record<string, { bodies?: string[]; faces?: string[] }>) {
    for (const f of features) this.typeOf.set(f.featureId, f.featureType);
    for (const [fid, v] of Object.entries(created ?? {})) {
      for (const [list, kind] of [[v.bodies ?? [], 'body'], [v.faces ?? [], 'face']] as const)
        for (const id of list) {
          const d = decode(id);
          if (!d || d.kind !== kind) { this.failures.push(id); continue; }
          const owners = this.owners.get(d.op) ?? [];
          if (!owners.includes(fid)) owners.push(fid);
          this.owners.set(d.op, owners);
        }
    }
  }

  get selfTestPassed(): boolean {
    return this.failures.length === 0;
  }

  classify(id: string): IdClass {
    if (id === ORIGIN_ID) return { what: 'origin' };
    const plane = DEFAULT_PLANES[id];
    if (plane) return { what: 'plane', ...plane };
    if (!this.selfTestPassed) return { what: 'unknown', why: 'the decode failed its self-test in this studio' };
    const d = decode(id);
    if (!d) return { what: 'unknown', why: 'the ID does not decode' };
    const owners = this.owners.get(d.op);
    if (!owners?.length) return { what: 'unknown', decoded: d, why: `no feature of the studio lists the operation ${d.op}` };
    const rows = new Set(owners.map((f) => rowOf(this.typeOf.get(f))));
    if (rows.size > 1) return { what: 'unknown', decoded: d, why: `the operation ${d.op} is listed under features of several kinds (${[...rows].join(', ')})` };
    const row = [...rows][0];
    if (row === 'other') return { what: 'unknown', decoded: d, why: `the operation ${d.op} belongs to a ${this.typeOf.get(owners[0])}, which the converter does not know` };
    if (row === 'plane') return d.kind === 'face' ? { what: 'planeFeature', decoded: d, feature: owners[0] } : { what: 'unknown', decoded: d, why: 'a vertex or an edge of a plane feature' };
    if (d.kind === 'face' || d.kind === 'body') return { what: 'unknown', decoded: d, why: `a ${d.kind}, where a vertex or an edge is asked` };
    if (row === 'solid') return { what: 'solid', decoded: d, features: owners };
    if (owners.length > 1) return { what: 'unknown', decoded: d, why: `the operation ${d.op} is listed under ${owners.length} sketches` };
    return { what: row, decoded: d, feature: owners[0] };
  }
}

// The category of an external operand (a column of the record, not the cause).
export type ExternalCategory = 'origin' | 'plane' | 'sketch' | 'edge' | 'unknown';
export function categoryOf(c: IdClass): ExternalCategory {
  switch (c.what) {
    case 'origin':
      return 'origin';
    case 'plane':
    case 'planeFeature':
      return 'plane';
    case 'sketch':
    case 'derived':
      return 'sketch';
    case 'solid':
      return 'edge';
    default:
      return 'unknown';
  }
}

const an = (kind: string) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);
export function classText(c: IdClass): string {
  switch (c.what) {
    case 'origin':
      return 'the origin';
    case 'plane':
      return `the ${c.name} plane`;
    case 'sketch':
      return `${an(c.decoded.kind)} of the sketch ${c.feature}`;
    case 'derived':
      return `${an(c.decoded.kind)} of a sketch derived by ${c.feature}`;
    case 'solid':
      return `${an(c.decoded.kind)} of a body (operation ${c.decoded.op} of ${c.features.join(', ')})`;
    case 'planeFeature':
      return `a face of the plane feature ${c.feature}`;
    default:
      return `unknown: ${c.why}`;
  }
}

// ---------------------------------------------------------------- found operands

type V2 = [number, number];
type V3 = [number, number, number];
// A candidate for an external operand: an entity of a sketch (an entry `sketch`) or an edge of a body
// (an entry `edge`), with its place in the sketch being converted.
export interface Candidate {
  ref: any; // the entry: { type: 'sketch', sketch, entity, kind } or { type: 'edge', body, edge, kind }
  sub?: 'a' | 'b' | 'center'; // a point of an edge entry
  kind: 'point' | 'line' | 'circle' | 'arc';
  at?: V2;
  ends?: [V2, V2];
  center?: V2;
  radius?: number;
  span?: [number, number]; // an arc: from the angle of its start counter-clockwise to its end
  beyond?: boolean; // holds the point on its extension only
  side?: string; // a circular edge: the key of its side face
  order?: [number, number]; // a circular edge: the place of its other face's feature on the timeline, start cap first
  tapered?: boolean;
  whole?: boolean; // a circular edge: the whole circle, not an arc of it
  piecesOf?: string; // a curve of a sketch the cut made pieces of: the curve it was before the cut
  text: string;
}
const fmt = (v: number) => v.toFixed(6);

// The points and curves of a converted sketch, own and the copies of its entries `pattern`, in its 2D
// (the converter's sketches on parallel planes share the 2D of their base plane). Its projections
// are no candidates: an Onshape entity of a sketch is an own entity of the sketch converted from it.
// `pieces`: the pieces of the sketch's cut, by the curve each was before the cut.
export function sketchCandidates(engine: any, sketch: string, kind: 'vertex' | 'edge', pieces?: Map<string, string>): Candidate[] {
  const st = engine.getState();
  const f = st.document.features.find((x: any) => x.id === sketch);
  const res = st.evaluation.features[sketch]?.sketch;
  if (!f || !res) return [];
  const sc = solvedCurvesOf(f, res);
  const P = (i: string): V2 => [sc.geometry.points[i].x, sc.geometry.points[i].y];
  // own, or of an entry `pattern` (its copies); an entry's IDs are `<entry>` or `<entry>/…`
  const taken = (id: string, own: Record<string, unknown>) => !!own[id] || f.external?.[id.split('/')[0]]?.type === 'pattern';
  const out: Candidate[] = [];
  if (kind === 'vertex') {
    const ids = new Set<string>(Object.keys(res.points));
    for (const [, c] of sc.curves) for (const k of ['a', 'b', 'center', 'start', 'end']) if (typeof (c.shape as any)[k] === 'string') ids.add((c.shape as any)[k]);
    for (const pid of ids) {
      if (pid === 'origin' || pid.startsWith('origin/') || !sc.geometry.points[pid] || !taken(pid, f.points)) continue;
      const at = P(pid);
      out.push({ ref: { type: 'sketch', sketch, entity: pid, kind: 'point' }, kind: 'point', at, text: `point ${pid} at ${at.map(fmt).join(',')}` });
    }
    return out;
  }
  for (const [cid, c] of sc.curves) {
    if (cid.startsWith('origin/') || !taken(cid, f.curves)) continue;
    const sh: any = c.shape;
    const of = pieces?.get(cid);
    const piece = of ? { piecesOf: of } : {};
    if (sh.type === 'line') { const ends: [V2, V2] = [P(sh.a), P(sh.b)]; out.push({ ref: { type: 'sketch', sketch, entity: cid, kind: 'line' }, kind: 'line', ends, ...piece, text: `line ${cid} ${ends.flat().map(fmt).join(',')}` }); }
    else if (sh.type === 'circle') { const center = P(sh.center); const radius = sc.geometry.radii[cid]; out.push({ ref: { type: 'sketch', sketch, entity: cid, kind: 'circle' }, kind: 'circle', center, radius, ...piece, text: `circle ${cid} at ${center.map(fmt).join(',')} r ${fmt(radius)}` }); }
    else if (sh.type === 'arc') {
      const [center, s, e] = [P(sh.center), P(sh.start), P(sh.end)];
      const radius = Math.hypot(s[0] - center[0], s[1] - center[1]);
      out.push({ ref: { type: 'sketch', sketch, entity: cid, kind: 'arc' }, kind: 'arc', center, radius, span: [Math.atan2(s[1] - center[1], s[0] - center[0]), Math.atan2(e[1] - center[1], e[0] - center[0])], ...piece, text: `arc ${cid} at ${center.map(fmt).join(',')} r ${fmt(radius)}` });
    }
  }
  return out;
}

// The edges of the bodies of the state before the sketch, seen in the sketch: a circle only with its
// axis along the sketch's normal (1e-4 rad); a straight edge perpendicular to the sketch is a point
// and no candidate. A vertex is an end of a straight edge.
export function edgeCandidates(engine: any, toBase: (w: V3) => V2, normal: V3, kind: 'vertex' | 'edge'): Candidate[] {
  const st = engine.getState();
  const out: Candidate[] = [];
  const index = new Map<string, number>(st.document.features.map((f: any, i: number) => [f.id, i]));
  for (const body of Object.keys(st.evaluation.bodies)) {
    const answer = engine.query('body', { body });
    if (!answer.ok) continue;
    for (const e of answer.result.edges as any[]) {
      if (e.kind === 'line') {
        const ends: [V2, V2] = [toBase(e.from), toBase(e.to)];
        if (Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]) < 1e-6) continue;
        const ref = { type: 'edge', body, edge: e.name, kind: 'line' };
        if (kind === 'edge') out.push({ ref, kind: 'line', ends, text: `edge ${JSON.stringify(e.name)} line ${ends.flat().map(fmt).join(',')}` });
        else for (const [sub, at] of [['a', ends[0]], ['b', ends[1]]] as const) out.push({ ref, sub, kind: 'point', at, text: `end ${sub} of edge ${JSON.stringify(e.name)} at ${at.map(fmt).join(',')}` });
      } else if (e.kind === 'circle' && kind === 'edge') {
        const axis = e.circle.axis as V3;
        if (Math.abs(Math.abs(axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2]) - 1) > 5e-9) continue; // 1e-4 rad
        const center = toBase(e.circle.center);
        // a whole circle: its length that of a regular polygon of its segments around the circle (an
        // arc of a side face, split by another face, is shorter)
        const n = e.segments as number;
        const whole = n >= 3 && Math.abs(e.length - 2 * n * e.circle.radius * Math.sin(Math.PI / n)) <= 1e-3 * e.length;
        const faces = [e.name.a, e.name.b];
        const side = faces.find((x: any) => x.role === 'side');
        const other = faces.find((x: any) => x !== side);
        const feature = st.document.features.find((f: any) => f.id === side?.feature);
        out.push({
          ref: { type: 'edge', body, edge: e.name, kind: 'circle' }, kind: 'circle', center, radius: e.circle.radius,
          side: side && feature?.type === 'extrude' ? JSON.stringify(side) : undefined, tapered: !!feature?.extent?.taper, whole,
          order: [index.get(other?.feature) ?? 1e9, other?.role === 'startCap' ? 0 : 1],
          text: `edge ${JSON.stringify(e.name)} circle at ${center.map(fmt).join(',')} r ${fmt(e.circle.radius)}`,
        });
      }
    }
  }
  return out;
}

// The candidates that fit every use: a point at the place of the local point it is coincident
// with; a curve through it (within its extent when any candidate holds it so); a round curve of the
// radius of the one it is equal to; a line in the direction a parallel or a perpendicular asks.
// Of a midpoint of two points (D75): the middle (`MIDPOINT`, beside the two ends) at their mean;
// an end (`MIDPOINT_END`, beside the middle and then the other end when it is known) at the image
// of the other end about the middle, and with the other end unknown the first of every pair of
// candidates that are images of each other about the middle (by x, then y), so that one pair
// gives one candidate and the second end is then fitted as the image of the first.
export function fitting(cands: Candidate[], type: string, locals: { k: string; at?: V2; ends?: [V2, V2]; radius?: number }[]): Candidate[] {
  const points = locals.filter((l) => l.k === 'point' && l.at).map((l) => l.at as V2);
  // an image about the middle carries the error of the middle twice
  const near = (a: V2, b: V2, tolerance = 1e-6) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
  const pt = locals.find((l) => l.k === 'point')?.at;
  const round = locals.find((l) => l.k === 'circle' || l.k === 'arc');
  const line = locals.find((l) => l.k === 'line')?.ends;
  const out: Candidate[] = [];
  for (const c of cands) {
    let ok = true;
    let beyond = false;
    if (type === 'COINCIDENT' && pt) {
      if (c.kind === 'point') ok = Math.hypot(c.at![0] - pt[0], c.at![1] - pt[1]) <= 1e-6;
      else if (c.kind === 'line') {
        const [a, b] = c.ends!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const t = ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / (L * L);
        ok = Math.abs((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])) / L <= 1e-6;
        beyond = t < -1e-9 || t > 1 + 1e-9;
      } else {
        ok = Math.abs(Math.hypot(pt[0] - c.center![0], pt[1] - c.center![1]) - c.radius!) <= 1e-6;
        if (c.kind === 'arc') { const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); const t = Math.atan2(pt[1] - c.center![1], pt[0] - c.center![0]); beyond = norm(t - c.span![0]) > norm(c.span![1] - c.span![0]) + 1e-9; }
      }
    } else if (type === 'MIDPOINT' && points.length === 2) ok = c.kind === 'point' && near(c.at!, [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]);
    else if (type === 'MIDPOINT_END' && points.length >= 1) {
      const image: V2 | undefined = c.kind === 'point' ? [2 * points[0][0] - c.at![0], 2 * points[0][1] - c.at![1]] : undefined;
      if (!image) ok = false;
      else if (points.length === 2) ok = near(image, points[1], 3e-6);
      else ok = (c.at![0] < image[0] - 1e-6 || (Math.abs(c.at![0] - image[0]) <= 1e-6 && c.at![1] < image[1] - 1e-6)) && cands.some((o) => o.kind === 'point' && near(o.at!, image, 3e-6));
    } else if (type === 'EQUAL' && round) ok = (c.kind === 'circle' || c.kind === 'arc') && Math.abs(c.radius! - round.radius!) <= 1e-6;
    else if (type === 'EQUAL' && line) ok = c.kind === 'line' && Math.abs(Math.hypot(c.ends![1][0] - c.ends![0][0], c.ends![1][1] - c.ends![0][1]) - Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1])) <= 1e-6;
    else if ((type === 'PARALLEL' || type === 'PERPENDICULAR') && line) {
      if (c.kind !== 'line') ok = false;
      else {
        const [u, v] = [[c.ends![1][0] - c.ends![0][0], c.ends![1][1] - c.ends![0][1]], [line[1][0] - line[0][0], line[1][1] - line[0][1]]];
        const [cr, dt] = [Math.abs(u[0] * v[1] - u[1] * v[0]), Math.abs(u[0] * v[0] + u[1] * v[1])];
        ok = (type === 'PARALLEL' ? cr : dt) <= 1e-9 * Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
      }
    }
    if (ok) out.push({ ...c, beyond });
  }
  return out.some((c) => !c.beyond) ? out.filter((c) => !c.beyond) : out;
}

// The pick: one candidate; several only when they are the same by construction: one written entity,
// circular edges on one side face of one untapered extrusion under a constraint that uses the edge
// as a curve (the first by the timeline, the start cap first; whole or arcs of the face's circle:
// pointOnCurve and equalRadius read only the circle, which every rim of the face carries), or the pieces the cut made
// of one curve of a sketch under a constraint that reads only their line or circle (EQUAL of round
// curves, PARALLEL, PERPENDICULAR: the piece that kept the curve's ID, else the first). Anything
// else is not chosen.
export function pickCandidate(cands: Candidate[], type: string): { pick?: Candidate; why: string; others: Candidate[] } {
  const seen = new Map<string, Candidate>();
  for (const c of cands) seen.set(JSON.stringify([c.ref, c.sub ?? '']), c);
  const list = [...seen.values()];
  if (!list.length) return { why: 'no candidate fits', others: [] };
  if (list.length === 1) return { pick: list[0], why: 'one candidate', others: [] };
  const round = (c: Candidate) => c.kind === 'circle' || c.kind === 'arc';
  const carrierUse = (type === 'EQUAL' && list.every(round)) || ((type === 'PARALLEL' || type === 'PERPENDICULAR') && list.every((c) => c.kind === 'line'));
  if (carrierUse && list.every((c) => c.ref.type === 'sketch' && !c.sub && c.piecesOf && c.piecesOf === list[0].piecesOf && c.ref.sketch === list[0].ref.sketch)) {
    const keeper = list.find((c) => c.ref.entity === c.piecesOf) ?? list[0];
    return { pick: keeper, why: `${list.length} pieces of one curve the cut made: the same line or circle by construction`, others: list.filter((c) => c !== keeper) };
  }
  const curveUse = type === 'COINCIDENT' || type === 'EQUAL';
  if (curveUse && list.every((c) => c.kind === 'circle' && c.side && !c.tapered && c.side === list[0].side)) {
    const sorted = [...list].sort((a, b) => a.order![0] - b.order![0] || a.order![1] - b.order![1]);
    const what = list.every((c) => c.whole) ? 'whole circular edges' : 'circular edges (arcs of its circle)';
    return { pick: sorted[0], why: `${list.length} ${what} on one side face of an untapered extrusion: the same by construction, the first by the timeline`, others: sorted.slice(1) };
  }
  return { why: `${list.length} candidates that are not the same by construction`, others: list };
}

