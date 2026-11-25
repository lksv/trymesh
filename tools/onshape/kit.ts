// Fixtures in the shape of Onshape's JSON, for the unit tests of the converter: sketches with their
// entities and constraints, part studios with `created` and the regions of their extrusions,
// written to a folder in the layout of fetch.ts. Nothing here is copied from a real document; the
// IDs are made up (deterministic IDs by `encode`, operations counted from F as Onshape's are).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Input, Report } from './common';
import { encode } from './operands';

type V2 = [number, number];
const M = (v: number) => v / 1000; // mm -> m
const vec = ([x, y]: V2) => ({ btType: 'BTVector2d-1812', x: M(x), y: M(y) });

// A value of a constraint's parameter: a local entity (a string under a `local…` key), a quantity
// (`{ q: '10 mm' }`), an external operand (`{ ext: 'IB' }`), or a plain value (an enum, a flag).
export type ParamValue = string | number | boolean | { q: string } | { ext: string | string[] };

export class SketchKit {
  readonly entities: any[] = []; // as the geometry endpoint (sketches.json) has them
  readonly featureEntities: any[] = []; // as the feature has them (features.json), for splines
  readonly constraints: any[] = [];
  private n = 0;
  constructor(readonly name: string, readonly featureId: string, readonly matrix: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {}

  private id(prefix: string) {
    return `${prefix}${++this.n}`;
  }
  point(at: V2, opts: { id?: string; construction?: boolean } = {}): string {
    const id = opts.id ?? this.id('p');
    this.entities.push({ jsonType: 'BTSketchPointInfo', sketchEntityId: id, sketchEntityType: 'skPoint', isConstruction: !!opts.construction, position2d: vec(at) });
    return id;
  }
  line(a: V2, b: V2, opts: { id?: string; construction?: boolean } = {}): { id: string; start: string; end: string } {
    const id = opts.id ?? this.id('l');
    const [start, end] = [this.point(a, { id: `${id}.start` }), this.point(b, { id: `${id}.end` })];
    this.entities.push({ jsonType: 'BTSketchCurveSegmentInfo', sketchEntityId: id, sketchEntityType: 'skLineSegment', isConstruction: !!opts.construction, startPointId: start, endPointId: end });
    return { id, start, end };
  }
  circle(c: V2, r: number, opts: { id?: string; construction?: boolean } = {}): { id: string; center: string } {
    const id = opts.id ?? this.id('c');
    const center = this.point(c, { id: `${id}.center`, construction: true });
    this.entities.push({ jsonType: 'BTSketchCurveInfo', sketchEntityId: id, sketchEntityType: 'skCircle', isConstruction: !!opts.construction, centerId: center, geometry: { clockWise: false, center2d: vec(c), radius: M(r) } });
    return { id, center };
  }
  // An arc counter-clockwise from the angle `from` to `to` (radians) in the Onshape sketch.
  arc(c: V2, r: number, from: number, to: number, opts: { id?: string; construction?: boolean } = {}): { id: string; center: string; start: string; end: string } {
    const id = opts.id ?? this.id('a');
    const center = this.point(c, { id: `${id}.center`, construction: true });
    const start = this.point([c[0] + r * Math.cos(from), c[1] + r * Math.sin(from)], { id: `${id}.start` });
    const end = this.point([c[0] + r * Math.cos(to), c[1] + r * Math.sin(to)], { id: `${id}.end` });
    this.entities.push({ jsonType: 'BTSketchCurveSegmentInfo', sketchEntityId: id, sketchEntityType: 'skArc', isConstruction: !!opts.construction, centerId: center, startPointId: start, endPointId: end, geometry: { clockWise: false, center2d: vec(c), radius: M(r) } });
    return { id, center, start, end };
  }
  // A B-spline as Onshape's feature holds it (control points flat in metres), with its two end
  // points in the geometry endpoint.
  spline(control: V2[], knots: number[], degree: number, opts: { id?: string; rational?: boolean; periodic?: boolean; ends?: [V2, V2] } = {}): { id: string; start: string; end: string } {
    const id = opts.id ?? this.id('s');
    const ends = opts.ends ?? [control[0], control[control.length - 1]];
    const [start, end] = [this.point(ends[0], { id: `${id}.start` }), this.point(ends[1], { id: `${id}.end` })];
    this.entities.push({ jsonType: 'BTSketchCurveSegmentInfo', sketchEntityId: id, sketchEntityType: 'skSpline', isConstruction: false, startPointId: start, endPointId: end });
    this.featureEntities.push({ btType: 'BTMSketchCurveSegment-155', entityId: id, isConstruction: false, startPointId: start, endPointId: end, startParam: knots[0], endParam: knots[knots.length - 1], geometry: { btType: 'BTCurveGeometryControlPointSpline-2197', degree, isRational: !!opts.rational, isPeriodic: !!opts.periodic, controlPointCount: control.length, controlPoints: control.flatMap(([x, y]) => [M(x), M(y)]), knots } });
    return { id, start, end };
  }
  constrain(type: string, parameters: Record<string, ParamValue>, id?: string): string {
    const entityId = id ?? this.id('k');
    this.constraints.push({ btType: 'BTMSketchConstraint-2', constraintType: type, entityId, parameters: Object.entries(parameters).map(([parameterId, v]) => param(parameterId, v)) });
    return entityId;
  }
  // A circular pattern: `rows[i][j]` is entity i of instance j (0 the seed).
  pattern(pivot: string, count: string, rows: string[][], opts: { open?: boolean; pivotExternal?: string } = {}): string {
    const extra: Record<string, ParamValue> = {};
    rows.forEach((r, i) => r.forEach((v, j) => { extra[`localInstance${i},${j}`] = v; }));
    return this.constrain('CIRCULAR_PATTERN', { patternc1: { q: count }, openPattern: !!opts.open, ...(opts.pivotExternal ? { externalPivot: { ext: opts.pivotExternal } } : { localPivot: pivot }), ...extra });
  }
  feature(): any {
    return { btType: 'BTMSketch-151', featureType: 'newSketch', featureId: this.featureId, name: this.name, suppressed: false, parameters: [], constraints: this.constraints, entities: this.featureEntities };
  }
  geometry(): any {
    return { jsonType: 'BTSketchInfoEntry', name: this.name, featureId: this.featureId, sketchMatrix: this.matrix, entities: this.entities };
  }
}

function param(parameterId: string, v: ParamValue): any {
  if (typeof v === 'object' && 'q' in v) return { btType: 'BTMParameterQuantity-147', parameterId, value: 0, expression: v.q };
  if (typeof v === 'object' && 'ext' in v) return { btType: 'BTMParameterQueryList-148', parameterId, queries: (Array.isArray(v.ext) ? v.ext : [v.ext]).map((d) => ({ btType: 'BTMIndividualQuery-138', deterministicIds: [d] })) };
  return { btType: typeof v === 'string' ? 'BTMParameterString-149' : 'BTMParameterEnum-145', parameterId, value: v };
}

// An Onshape edge of a region (`at` of fs.json): a line by its ends, a circle or an arc by its
// centre, radius and ends; `m` the middle. In model coordinates, mm.
export type RegionEdge = { curve: 'line'; a: number[]; b: number[]; m: number[] } | { curve: 'circle'; a: number[]; b: number[]; m: number[]; center: number[]; radius: number } | { curve: 'other'; a: number[]; b: number[]; m: number[] };

export class StudioKit {
  readonly features: any[] = [];
  readonly sketches: any[] = [];
  readonly created: Record<string, { bodies: string[]; faces: string[] }> = {};
  readonly at: Record<string, { ids: Record<string, any> }> = {};
  readonly parts: any[] = [];
  readonly mass: Record<string, any> = {};
  private op = 5; // operations are counted from F
  constructor(readonly name = 'Studio', readonly eid = 'e00000000000000000000001') {}

  nextOp(): string {
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[this.op++];
  }
  // A sketch with `regions` faces (the regions Onshape made) and `bodies` sketch bodies. Returns the
  // two operations: of its bodies (its vertices and edges decode to this one) and of its faces.
  sketch(s: SketchKit, regions = 0, bodies = 1): { op: string; faceOp: string; faces: string[] } {
    const [op, faceOp] = [this.nextOp(), this.nextOp()];
    this.features.push(s.feature());
    this.sketches.push(s.geometry());
    const faces = Array.from({ length: regions }, (_, i) => encode(faceOp, 'face', i));
    this.created[s.featureId] = { bodies: Array.from({ length: bodies }, (_, i) => encode(op, 'body', i)), faces };
    return { op, faceOp, faces };
  }
  // A feature the converter does not convert, which owns an operation (a plane, a mate connector).
  other(featureType: string, featureId: string, name: string, faces = 1): string {
    const op = this.nextOp();
    this.features.push({ featureType, featureId, name, suppressed: false, parameters: [] });
    this.created[featureId] = { bodies: [], faces: Array.from({ length: faces }, (_, i) => encode(op, 'face', i)) };
    return op;
  }
  // An importDerived of sketches of another studio of the document; it owns two operations per
  // sketch it brings (their bodies and faces), as Onshape's does.
  derive(featureId: string, name: string, source: StudioKit, sketches: string[], regions = 0): { faces: string[] } {
    this.features.push({ featureType: 'importDerived', featureId, name, suppressed: false, parameters: [
      { parameterId: 'buildFunction', namespace: `e${source.eid}::mABC`, value: 'build' },
      { parameterId: 'parts', queries: sketches.map((f) => ({ queryString: `query=qCreatedBy(id + "${f}", EntityType.BODY);` })) },
    ] });
    const faces: string[] = [];
    const bodies: string[] = [];
    for (let i = 0; i < sketches.length; i++) {
      const [op, faceOp] = [this.nextOp(), this.nextOp()];
      bodies.push(encode(op, 'body', 0));
      for (let k = 0; k < regions; k++) faces.push(encode(faceOp, 'face', k));
    }
    this.created[featureId] = { bodies, faces };
    return { faces };
  }
  // A blind extrusion of regions (their Onshape faces, with the geometry of `at`), new body.
  extrude(featureId: string, name: string, regions: { id: string; area: number; edges: RegionEdge[] }[], depth: string, opts: { operation?: 'NEW' | 'ADD' | 'REMOVE'; part?: string; scope?: string[] } = {}): { op: string; body: string } {
    const op = this.nextOp();
    const body = encode(op, 'body', 0);
    this.features.push({
      featureType: 'extrude', featureId, name, suppressed: false,
      parameters: [
        { parameterId: 'entities', queries: [{ deterministicIds: regions.map((r) => r.id) }] },
        { parameterId: 'bodyType', value: 'SOLID' },
        { parameterId: 'operationType', value: opts.operation ?? 'NEW' },
        { parameterId: 'endBound', value: 'BLIND' },
        { parameterId: 'depth', value: 0, expression: depth },
        { parameterId: 'defaultScope', value: !opts.scope },
        ...(opts.scope ? [{ parameterId: 'booleanScope', queries: [{ deterministicIds: opts.scope }] }] : []),
      ],
    });
    this.at[featureId] = { ids: Object.fromEntries(regions.map((r) => [r.id, { kind: 'face', sketch: true, area: r.area, edges: r.edges }])) };
    if ((opts.operation ?? 'NEW') === 'NEW') {
      this.created[featureId] = { bodies: [body], faces: [encode(op, 'face', 0)] };
      this.parts.push({ partId: body, name: opts.part ?? name });
    } else this.created[featureId] = { bodies: [], faces: [encode(op, 'face', 0)] };
    return { op, body };
  }
}

// A folder in the layout of fetch.ts with the studios given (the first is the element converted)
// and the variables of one variable studio.
export function writeDump(studios: StudioKit[], variables: { name: string; expression: string }[] = [], dir = mkdtempSync(join(tmpdir(), 'onshape-kit-'))): { dir: string; input: Input; report: Report } {
  const w = (file: string, value: unknown) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(value));
  };
  w('meta.json', { name: studios[0].name, type: 'PARTSTUDIO', element: studios[0].eid, url: 'https://example.invalid/', fetched: '2026-01-01T00:00:00Z' });
  w('elements.json', [...studios.map((s) => ({ id: s.eid, elementType: 'PARTSTUDIO', name: s.name })), { id: 'v0000000000000000000000', elementType: 'VARIABLESTUDIO', name: 'Variables' }]);
  w('variables/v0000000000000000000000.json', [{ variables: variables }]);
  for (const s of studios) {
    w(`studios/${s.eid}/features.json`, { features: s.features });
    w(`studios/${s.eid}/sketches.json`, { sketches: s.sketches });
    w(`studios/${s.eid}/fs.json`, { created: s.created, at: s.at, parts: {} });
    w(`studios/${s.eid}/parts.json`, s.parts);
    w(`studios/${s.eid}/mass.json`, { bodies: s.mass });
  }
  return { dir, input: new Input(dir), report: new Report() };
}

// The edges of an Onshape region of a polygon (closed) and of a whole circle, in the XY plane.
export const polygonEdges = (pts: V2[]): RegionEdge[] => pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return { curve: 'line', a: [a[0], a[1], 0], b: [b[0], b[1], 0], m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0] }; });
export const circleEdge = (c: V2, r: number): RegionEdge => ({ curve: 'circle', a: [c[0] + r, c[1], 0], b: [c[0] + r, c[1], 0], m: [c[0] - r, c[1], 0], center: [c[0], c[1], 0], radius: r });
export const polygonArea = (pts: V2[]) => Math.abs(pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
