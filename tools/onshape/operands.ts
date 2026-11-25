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

export function classText(c: IdClass): string {
  switch (c.what) {
    case 'origin':
      return 'the origin';
    case 'plane':
      return `the ${c.name} plane`;
    case 'sketch':
      return `a ${c.decoded.kind} of the sketch ${c.feature}`;
    case 'derived':
      return `a ${c.decoded.kind} of a sketch derived by ${c.feature}`;
    case 'solid':
      return `a ${c.decoded.kind} of a body (operation ${c.decoded.op} of ${c.features.join(', ')})`;
    case 'planeFeature':
      return `a face of the plane feature ${c.feature}`;
    default:
      return `unknown: ${c.why}`;
  }
}
