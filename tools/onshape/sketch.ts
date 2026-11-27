// An Onshape sketch as a sketch of trymesh: its points, lines and circles in the frame of a base plane,
// the curves split where they cross, and the constraints that have a counterpart.
import type { Command, Engine, Id, PlaneRef, RegionRef } from '../../packages/engine/src/index';
import { type SketchToolResult, constraintKey, emptySketch, expressionValue, freshIds, sketchTool, solvedCurves, splineBeziers } from '../../packages/engine/src/index';
import { type Report, type V2, type V3, dot, exec, expression, sane } from './common';
import { type Expected, type Pair, TOLERANCE, impliedConstraints, impliedLines, ladder, probeSketch, sketchChanges, strip } from './check';
import { type ExternalResolver, type MapContext, horizontalOf, instanceRows, knownOperand, mapConstraints, numberConstraints, onshapeKind, params, twiceByMeaning } from './constraints';
import { type Cause, type ConstraintRecord, FATES, type Fate, type SketchSummary, finalFate, sketchLines } from './fates';
import { type EntryPlan, copiesMatch, planEntries } from './derived';
import { SPLINE_BUDGET, distanceToPolyline, isSpline, planSpline, sampleChain } from './splines';
import { type Candidate, type IdClass, ORIGIN_ID, type StudioOperations, classText, decode, edgeCandidates, fitting, pickCandidate, sketchCandidates } from './operands';

// The frame of an Onshape sketch (world, mm) and the base plane of trymesh it is drawn on.
export interface SketchFrame {
  origin: V3;
  x: V3;
  y: V3;
  normal: V3; // the normal of the Onshape sketch
  base: { plane: 'XY' | 'XZ' | 'YZ'; x: V3; y: V3; normal: V3 };
  offset: number; // of the base plane, along its normal
  sign: 1 | -1; // +1 when the Onshape normal is the normal of the base plane, −1 against it
}
const BASES = [
  { plane: 'XY', x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  { plane: 'XZ', x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  { plane: 'YZ', x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
] as const;

// `sketchMatrix` of the endpoint `sketches`: row-major 4×4 in metres, the columns the X, Y and
// normal of the sketch and its origin. Only sketches parallel to a base plane are taken: trymesh
// has tilted planes (D60), but this converter does not build them.
export function sketchFrame(matrix: number[]): SketchFrame | undefined {
  const col = (c: number): V3 => [matrix[c], matrix[4 + c], matrix[8 + c]];
  const [x, y, normal] = [col(0), col(1), col(2)];
  const origin = col(3).map((v) => v * 1000) as V3;
  for (const b of BASES) {
    const d = dot(normal, b.normal as V3);
    if (Math.abs(Math.abs(d) - 1) < 1e-9) return { origin, x, y, normal, base: b as SketchFrame['base'], offset: dot(origin, b.normal as V3), sign: d > 0 ? 1 : -1 };
  }
  return undefined;
}
// A point of the Onshape sketch (its own 2D, mm) in the 2D of the base plane.
export const toBase = (f: SketchFrame, [u, v]: V2): V2 => {
  const w: V3 = [f.origin[0] + u * f.x[0] + v * f.y[0], f.origin[1] + u * f.x[1] + v * f.y[1], f.origin[2] + u * f.x[2] + v * f.y[2]];
  return [dot(w, f.base.x as V3), dot(w, f.base.y as V3)];
};
// A point of the model (mm) in the 2D of the base plane.
export const worldToBase = (f: SketchFrame, w: V3): V2 => [dot(w, f.base.x as V3), dot(w, f.base.y as V3)];

export interface Converted {
  id: Id;
  frame: SketchFrame;
  kind: Map<string, 'point' | 'line' | 'circle' | 'arc'>; // Onshape entity -> what it is
  rep: Map<string, Id>; // Onshape point -> point of trymesh
  chains?: Map<string, { curves: Id[]; points: Id[] }>; // Onshape spline -> its curves in order and their points
  pieces?: Map<Id, Id>; // a curve after the cut -> the curve it is a piece of (itself when it kept its ID)
}

type C = { id: string; src: string; construction: boolean; line?: [string, string]; circle?: { c: string; r: number }; arc?: [string, string, string]; spline?: string[] };

// Where a sketch is converted: its studio, the decode of external IDs there, and its key.
export interface SketchPlace {
  studio: string;
  ops: StudioOperations; // the operations of the studio that holds the Onshape feature
  helper: boolean;
  onshapeRegions?: number; // the faces the Onshape sketch feature created
  derivedFrom?: string; // `<source studio>/<source feature>` of a derived copy
  sketchesFor?: (cls: IdClass & { what: 'sketch' | 'derived' }) => Id[]; // the trymesh sketches made from what an ID decodes to
  sketchOf?: (sketch: Id) => Converted | undefined; // a sketch converted before in the studio (its frame, its cut)
}

// Points of Onshape within this distance of each other, in chains, are one point of trymesh.
export const WELD = 1e-6;

export function convertSketch(engine: Engine, report: Report, id: Id, name: string, plane: PlaneRef, frame: SketchFrame, feature: any, geom: any, place: SketchPlace, forbidden = new Set<number>()): Converted | undefined {
  const P = (s: string) => `${id}.${sane(s)}`; // entity IDs are unique in the whole document
  // what the report holds before the sketch: a build again starts from it
  const mark = { lines: report.lines.length, tail: Object.fromEntries(Object.entries(report.tail).map(([k, v]) => [k, v.length])) };
  // The patterns and mirrors that become entries (derived.ts): their images are not made.
  const known = (x: string) => { const k = knownOperand(x, frame); return k && !('lost' in k) ? k : undefined; };
  const plans = planEntries(feature, geom, forbidden, {
    axisOf: (x) => { const k = known(x); return k?.ext === 'axis' ? (k.id as 'origin/x' | 'origin/y') : undefined; },
    pivotKnown: (x) => known(x)?.k === 'point',
    toBase: (p) => toBase(frame, p),
  });
  const copies = new Set<string>(plans.filter((x) => !x.why).flatMap((x) => [...x.images]));
  // Onshape gives every curve its own end points, held together by coincident constraints; points
  // at one place become one point (that is what trymesh needs to close a region).
  const welded = weldPoints((geom.entities as any[]).filter((e) => e.sketchEntityType === 'skPoint' && !copies.has(e.sketchEntityId)).map((e) => ({ src: e.sketchEntityId as string, id: P(e.sketchEntityId), at: toBase(frame, [e.position2d.x * 1000, e.position2d.y * 1000]) })));
  const { pos, rep } = welded;
  for (const w of welded.wide) report.later('Welds', `${place.studio}, ${name}: a cluster of welded points wider than ${WELD} mm: ${w}`);
  const kind = new Map<string, 'point' | 'line' | 'circle' | 'arc'>();
  for (const e of geom.entities) if (e.sketchEntityType === 'skPoint' && !copies.has(e.sketchEntityId)) kind.set(e.sketchEntityId, 'point');
  const curves: C[] = [];
  const skipped: Record<string, number> = {};
  const splines: any[] = [];
  // An exact duplicate (the same kind over the same points with the same construction flag; a
  // circle: the same centre and radius) is written once; its Onshape entity points at the first, a
  // line drawn the other way as "the same line, reversed".
  const curveOf = new Map<string, { id: Id; reversed: boolean }>();
  const same = (c: C, x: C) => c.construction === x.construction && (c.line && x.line ? (c.line[0] === x.line[0] && c.line[1] === x.line[1]) || (c.line[0] === x.line[1] && c.line[1] === x.line[0]) : c.circle && x.circle ? c.circle.c === x.circle.c && Math.abs(c.circle.r - x.circle.r) <= WELD : c.arc && x.arc ? c.arc.join() === x.arc.join() : false);
  for (const e of geom.entities) {
    if (copies.has(e.sketchEntityId)) continue;
    const cid = P(e.sketchEntityId);
    let c: C | undefined;
    if (e.sketchEntityType === 'skLineSegment') {
      const [a, b] = [rep.get(e.startPointId)!, rep.get(e.endPointId)!];
      if (a === b) continue;
      kind.set(e.sketchEntityId, 'line');
      c = { id: cid, src: e.sketchEntityId, line: [a, b], construction: e.isConstruction };
    } else if (e.sketchEntityType === 'skCircle' && !e.startPointId) {
      kind.set(e.sketchEntityId, 'circle');
      c = { id: cid, src: e.sketchEntityId, circle: { c: rep.get(e.centerId)!, r: e.geometry.radius * 1000 }, construction: e.isConstruction };
    } else if (e.sketchEntityType === 'skCircle' || e.sketchEntityType === 'skArc') {
      // an arc: centre, start and end; trymesh turns counter-clockwise from the start
      const [s, t] = [rep.get(e.startPointId)!, rep.get(e.endPointId)!];
      const turned = e.geometry?.clockWise !== (frame.sign < 0);
      kind.set(e.sketchEntityId, 'arc');
      c = { id: cid, src: e.sketchEntityId, arc: [rep.get(e.centerId)!, turned ? t : s, turned ? s : t], construction: e.isConstruction };
    } else if (isSpline(e)) {
      splines.push(e);
      continue;
    } else if (e.sketchEntityType !== 'skPoint') skipped[e.sketchEntityType] = (skipped[e.sketchEntityType] ?? 0) + 1;
    if (!c) continue;
    const first = curves.find((x) => same(c!, x));
    if (first) {
      curveOf.set(c.src, { id: first.id, reversed: !!(c.line && first.line && c.line[0] !== first.line[0]) });
      report.later('Duplicates', `${place.studio}, ${name}: ${c.src} is ${first.src}${c.line && first.line && c.line[0] !== first.line[0] ? ', reversed' : ''}`);
      continue;
    }
    curves.push(c);
  }
  // Splines (rules 1 to 5): planned all, then written all or none of the sketch's.
  const chains = new Map<string, { curves: Id[]; points: Id[] }>();
  {
    const at = (pid?: string): V2 | undefined => { const q = (geom.entities as any[]).find((x) => x.sketchEntityId === pid); return q?.position2d ? [q.position2d.x * 1000, q.position2d.y * 1000] : undefined; };
    const plans = splines.map((e) => ({ e, plan: planSpline(e, (feature.entities ?? []).find((x: any) => x.entityId === e.sketchEntityId), [at(e.startPointId), at(e.endPointId)]) }));
    const total = plans.reduce((n, x) => n + (x.plan.ok ? x.plan.points : 0), 0);
    for (const { e, plan } of plans) {
      const cid = P(e.sketchEntityId);
      if (!plan.ok) { report.later('Splines', `${place.studio}, ${name}: ${e.sketchEntityId}: not converted (${plan.why})`); skipped.spline = (skipped.spline ?? 0) + 1; continue; }
      if (total > SPLINE_BUDGET) { report.later('Splines', `${place.studio}, ${name}: ${e.sketchEntityId}: ${plan.points} control points to write, ${total} in the sketch, over the budget of ${SPLINE_BUDGET}: none of the sketch's splines is written`); skipped.spline = (skipped.spline ?? 0) + 1; continue; }
      const [a, b] = [rep.get(e.startPointId)!, rep.get(e.endPointId)!];
      let q = 0;
      const fresh = (v: V2): Id => { const pid = `${cid}.q${++q}`; pos.set(pid, toBase(frame, v)); return pid; };
      const chain = { curves: [] as Id[], points: [a] as Id[] };
      const construction = !!e.isConstruction;
      if (plan.whole) {
        const inner = plan.control.slice(1, -1).map(fresh);
        curves.push({ id: cid, src: e.sketchEntityId, construction, spline: [a, ...inner, b] });
        chain.curves.push(cid);
        chain.points.push(...inner, b);
      } else {
        plan.pieces.forEach((piece, k) => {
          const last = k === plan.pieces.length - 1;
          const ids = [chain.points[chain.points.length - 1], ...piece.slice(1, -1).map(fresh), last ? b : fresh(piece[piece.length - 1])];
          const id = plan.pieces.length === 1 ? cid : `${cid}.b${k}`;
          curves.push(plan.degree === 1 ? { id, src: e.sketchEntityId, construction, line: [ids[0], ids[1]] } : { id, src: e.sketchEntityId, construction, spline: ids });
          chain.curves.push(id);
          chain.points.push(...ids.slice(1));
        });
      }
      chains.set(e.sketchEntityId, chain);
      report.knowledge('a spline under the budget', `${place.studio}, ${name}, ${e.sketchEntityId}`);
      report.later('Splines', `${place.studio}, ${name}: ${e.sketchEntityId}: ${plan.whole ? `one spline over ${plan.points} control points` : `${plan.pieces.length} piece(s) of degree ${plan.degree}, ${plan.points} control points`}`);
    }
  }
  if (Object.keys(skipped).length) report.note(`${name}: entities without a counterpart, left out: ${JSON.stringify(skipped)}`);
  const base: Command[] = [
    { type: 'addFeature', feature: emptySketch(id, name, plane) },
    ...[...pos].map(([pid, [x, y]]): Command => ({ type: 'addPoint', sketch: id, id: pid, x, y })),
    ...curves.map((c): Command => ({
      type: 'addCurve',
      sketch: id,
      id: c.id,
      curve: { ...(c.spline ? { type: 'spline', points: c.spline } : c.line ? { type: 'line', a: c.line[0], b: c.line[1] } : c.arc ? { type: 'arc', center: c.arc[0], start: c.arc[1], end: c.arc[2] } : { type: 'circle', center: c.circle!.c }), ...(c.construction ? { construction: true } : {}) } as any,
      ...(c.circle ? { radius: c.circle.r } : {}),
    })),
  ];
  const conv: Converted = { id, frame, kind, rep, chains };
  // the entries: the sources are the seed curves, and seed points no seed curve has
  const entryOf = new Map<EntryPlan, Id>();
  const curveId = (v: string) => curveOf.get(v)?.id ?? P(v);
  for (const plan of plans) {
    if (plan.why) continue;
    const xid = `${id}.pattern${entryOf.size}`;
    const seedPoints = new Set(plan.seeds.flatMap((v) => (geom.entities as any[]).filter((e) => e.sketchEntityId === v && e.sketchEntityType !== 'skPoint').flatMap((e) => [e.startPointId, e.endPointId, e.centerId].filter(Boolean))));
    const sources = [...new Set(plan.seeds.map((v) => (kind.get(v) === 'point' ? (seedPoints.has(v) ? undefined : rep.get(v)) : curveId(v))).filter(Boolean) as Id[])];
    let transform: any;
    if (plan.type === 'pattern') {
      const center = plan.pivot ? rep.get(plan.pivot) : (() => { const k = plan.pivotExternal ? knownOperand(plan.pivotExternal, frame) : undefined; return k && !('lost' in k) && k.k === 'point' ? k.id : undefined; })();
      // planEntries kept out every plan whose pivot is no point here: its images are left out already
      if (!center) throw new Error(`${place.studio}, ${name}: the pivot of the entry of CIRCULAR_PATTERN #${plan.index} is no point of the sketch, after its images were left out`);
      transform = { type: 'circular', center, count: plan.count, span: { type: 'full' } };
    } else {
      const axis = plan.axisExternal ? (knownOperand(plan.axis!, frame) as any).id : curveId(plan.axis!);
      transform = { type: 'mirror', axis };
    }
    entryOf.set(plan, xid);
    base.push({ type: 'addExternal', sketch: id, id: xid, ref: { type: 'pattern', sources, transform } } as Command);
  }
  const entityType = new Map<string, string>((geom.entities as any[]).map((e) => [e.sketchEntityId, onshapeKind(e)]));
  // An external operand: the origin, a default plane; else what the decode says (an entity of
  // another sketch, an edge of a body), found by geometry among the candidates the decode allows,
  // and entered once per source entity.
  const entries = new Map<string, Id>();
  const resolve: ExternalResolver = (eid, op, locals, type) => {
    const known = knownOperand(eid, frame);
    if (known) return known;
    const cls = place.ops.classify(eid);
    let cands: Candidate[];
    const lostAs: Cause = cls.what === 'solid' ? 'edge' : 'sketch';
    if (cls.what === 'sketch' || cls.what === 'derived') {
      const all = place.sketchesFor?.(cls) ?? [];
      if (!all.length) return { lost: 'sketch', detail: `${classText(cls)}: the sketch is not in this document` };
      // the converter's sketches share the 2D of their base plane: a source on another one is not
      // compared in this sketch's 2D (a source on a parallel offset plane is)
      const ids = all.filter((sid) => { const f = place.sketchOf?.(sid)?.frame; return !f || f.base.plane === frame.base.plane; });
      if (!ids.length) return { lost: 'sketch', detail: `${classText(cls)}: the sketch is on another base plane` };
      cands = ids.flatMap((sid) => sketchCandidates(engine, sid, cls.decoded.kind as 'vertex' | 'edge', place.sketchOf?.(sid)?.pieces));
    } else if (cls.what === 'solid' && place.derivedFrom) return { lost: 'edge', detail: `${classText(cls)}: a body of another studio (the source of the derived sketch)` };
    else if (cls.what === 'solid') cands = edgeCandidates(engine, (w) => worldToBase(frame, w), frame.base.normal as V3, cls.decoded.kind as 'vertex' | 'edge');
    else if (cls.what === 'planeFeature') return { lost: 'plane', detail: classText(cls) };
    else return { lost: 'unknown', detail: classText(cls) };
    const fit = fitting(cands, type, locals);
    const p = pickCandidate(fit, type);
    op.candidates = fit.map((c) => c.text);
    if (!p.pick) return { lost: lostAs, detail: `${classText(cls)}: ${p.why}` };
    op.inferred = true;
    if (p.others.length) op.note = `${p.why}; the other: ${p.others.map((c) => c.text).join('; ')}`;
    if (cls.what === 'solid' && cls.decoded.kind === 'vertex') report.knowledge('a vertex of a body', `${place.studio}, ${name}, ${eid}`);
    const c = p.pick;
    const key = JSON.stringify(c.ref);
    let xid = entries.get(key);
    if (!xid) {
      xid = `${id}.ref${entries.size}`;
      entries.set(key, xid);
      base.push({ type: 'addExternal', sketch: id, id: xid, ref: c.ref } as Command);
    }
    const entity = c.sub ? `${xid}/${c.sub}` : xid;
    return { k: c.kind, id: entity, ext: c.ref.type === 'edge' ? 'edge' : 'sketch', at: c.at, ends: c.ends, center: c.center, radius: c.radius };
  };
  const ctx: MapContext = { studio: place.studio, sketch: id, name, helper: place.helper, kind, rep, pos, curves, curveOf, entityType, split: new Set(), ops: place.ops, frame, parameters: engine.getState().document.parameters, resolve, plans, chains, spokes: new Set(), entities: new Map((geom.entities as any[]).map((e) => [e.sketchEntityId, e])) };
  const { records } = mapConstraints(ctx, feature.constraints ?? []);
  for (const x of plans) if (x.type === 'pattern' && (x.constraint.constraintType !== 'CIRCULAR_PATTERN' || params(x.constraint).openPattern?.value)) report.knowledge(`${x.constraint.constraintType === 'CIRCULAR_PATTERN' ? 'an open' : 'a linear'} pattern`, `${place.studio}, ${name}, #${x.index}`);
  if (!horizontalOf(frame)) report.knowledge('a sketch turned in its plane', `${place.studio}, ${name}`);
  for (const r of records) if (r.fate !== 'lost' && r.operands.some((o) => !o.external && entityType.get(o.id) === 'arc')) report.knowledge('an arc under a constraint', `${place.studio}, ${name}, ${r.type} #${r.index}`);
  report.records.push(...records);
  twiceByMeaning(records, engine.getState().document.parameters);
  numberConstraints(records, id);
  // The check: every unit with its expressions; else one by one (check.ts).
  const expected: Expected = { points: new Map(pos), radii: new Map(curves.filter((c) => c.circle).map((c) => [c.id, c.circle!.r])) };
  const units = records.filter((r) => !r.fate);
  // an entry of a projection or an edge that no unit names (its constraint was lost on another
  // operand, or says what another says) is not written
  {
    const named = JSON.stringify(units.map((u) => u.commands.map(strip)));
    for (let i = base.length - 1; i >= 0; i--) {
      const c: any = base[i];
      if (c.type === 'addExternal' && c.ref.type !== 'pattern' && !named.includes(`"${c.id}"`) && !named.includes(`"${c.id}/`)) base.splice(i, 1);
    }
  }
  // what the probes leave alone, and what they assert
  const promises = report.promisesOf(place.studio);
  const pairs: Pair[] = [];
  for (const u of units) for (const c of u.commands as any[]) {
    if (c.spoke) promises.notChanged.push(`${id} ${c.id}`);
    if (c.pair) pairs.push({ a: c.pair[0], b: c.pair[1], label: `${u.what} (${c.id})`, record: u, command: c });
  }
  const saved = entryOf.size ? engine.save() : undefined;
  // an entry that rule 5 or 6 blames is dropped and the sketch is built again from the entities
  const again = (plan: EntryPlan, why: string) => {
    report.lines.length = mark.lines;
    for (const k of Object.keys(report.tail)) { if (k in mark.tail) report.tail[k].length = mark.tail[k]; else delete report.tail[k]; }
    report.note(`${name}: the entry of ${plan.constraint.constraintType} #${plan.index} is dropped (${why}); the sketch is built again with its instances as own curves`);
    engine.load(saved!);
    report.records.splice(report.records.length - records.length, records.length);
    promises.notChanged.splice(0, promises.notChanged.length, ...promises.notChanged.filter((x) => !x.startsWith(`${id} `)));
    return convertSketch(engine, report, id, name, plane, frame, feature, geom, place, new Set([...forbidden, plan.index]));
  };
  const lad = ladder(engine, id, base, units, expected);
  if (!exec(engine, report, { type: 'batch', commands: [...base, ...lad.commands] }, name)) return undefined;
  // rule 5: the copies are Onshape's images, both ways
  for (const [plan, xid] of entryOf) {
    const why = copiesMatch(engine, id, xid, plan, geom, (p) => toBase(frame, p));
    if (why) return again(plan, `rule 5: ${why}`);
  }
  // Crossing curves: the sketch tool `split` once, its batch checked before it stays.
  const cut = cutSketch(engine, report, id, name, base, units.filter((u) => u.fate === 'written'), expected, skipped, place.onshapeRegions, curves);
  conv.pieces = cut.pieces;
  // rule 6: the engine accepts the contacts of the copies
  if (entryOf.size) {
    const st = engine.getState().evaluation.features[id]?.sketch;
    const contacts: any = engine.query('sketchContacts', { sketch: id, max: 100_000 } as any);
    for (const [plan, xid] of entryOf) {
      const named = contacts.ok ? (contacts.result.contacts as any[]).filter((c) => c.curves.some((k: Id) => k.startsWith(`${xid}/`))) : [];
      if (!st?.valid && named.length) return again(plan, `rule 6: ${named.length} contact(s) of its copies`);
    }
  }
  // A distance of two lines keeps them parallel in Onshape, one point–line distance does not: the
  // sketch's probe asks whether they stay parallel. A pair that parts gets the distance of two
  // lines of the engine (`distanceLineLine`, D75), which holds them parallel itself, in place of
  // the distance of a point, under the same ID and with its value or expression. A pair that
  // other constraints hold parallel keeps the one distance of a point: `distanceLineLine` beside
  // them would be a redundant set (its parallelism follows from theirs), which is what the
  // sketches of 6h could not always follow. Should the engine refuse the change or the sketch not
  // be solved with it, the pair gets `parallel` in its unit, as before D75.
  const livePairs = pairs.filter((x) => x.record.fate === 'written' && x.record.ids.includes(x.command.id));
  if (livePairs.length) {
    const notChanged = new Set(promises.notChanged);
    const p = probeSketch(engine, id, sketchChanges(engine, id, notChanged), [], livePairs);
    const sketchNow = (): any => engine.getState().document.features.find((f) => f.id === id);
    // the next number after the last one written
    let next = 1 + Math.max(-1, ...Object.keys(sketchNow().constraints).map((k) => Number(/\.c(\d+)$/.exec(k)?.[1] ?? -1)));
    for (const x of livePairs) {
      if (![...p.breaks].some((b) => b.includes(x.label))) continue;
      const cid: Id = x.command.id;
      const stored = sketchNow().constraints[cid];
      const value = sketchNow().expressions?.[`constraints/${cid}/value`] ?? stored?.value;
      const constraint = { type: 'distanceLineLine', a: x.a, b: x.b, value, driving: true };
      const swap = { type: 'batch', commands: [{ type: 'removeConstraint', sketch: id, id: cid }, { type: 'addConstraint', sketch: id, id: cid, constraint }] } as Command;
      if (stored?.type === 'distancePointLine' && exec(engine, report, swap, `${name}: the distance of two lines for ${x.label}`)) {
        const after = engine.getState().evaluation.features[id];
        if (after?.status === 'ok' && !after.sketch?.conflicting.length) {
          x.command.constraint = constraint;
          x.record.detail = 'as `distanceLineLine`: the pair parted in the probe';
          continue;
        }
        engine.undo(); // the sketch did not take it: back to the distance of a point, and `parallel` below
      }
      const pid = `${id}.c${String(next++).padStart(3, '0')}`;
      const cmd: any = { type: 'addConstraint', sketch: id, id: pid, constraint: { type: 'parallel', a: x.a, b: x.b }, record: x.record };
      if (exec(engine, report, strip(cmd), `${name}: parallel for ${x.label}`)) { x.record.commands.push(cmd); x.record.ids.push(pid); x.record.detail = 'with `parallel`: the pair parted in the probe'; }
    }
    for (const x of livePairs) promises.pairs.push({ sketch: id, a: x.a, b: x.b, constraint: x.record.key });
  }
  // Implied constraints, where the sketch's probe shows it cannot follow.
  const implied = impliedConstraints(engine, id, records.filter((r) => r.fate === 'written'), expected, { notChanged: new Set(promises.notChanged), pairs: livePairs });
  // the constraint as the document had it when it was removed (a cut may have moved it to a piece)
  for (const r of implied.removed) report.promisesOf(place.studio).removed.push({ sketch: id, id: r.id, constraint: r.constraint });
  for (const line of impliedLines(`${place.studio}, ${name}`, implied)) report.later('Redundant constraints', line);
  const entrySummary = plans.map((x) => ({ constraint: `${place.studio}/${id}#${x.index}`, type: x.type, entry: entryOf.has(x), ...(x.why ? { why: x.why } : {}) }));
  for (const e of entrySummary) report.later('Entries', `${place.studio}, ${name}: ${e.type} #${e.constraint.split('#')[1]}: ${e.entry ? 'an entry' : `no entry: ${e.why}`}`);
  finishSketch(engine, report, conv, name, place, geom, feature, records, cut.step ?? lad.step, pos.size, curves.length, { drift: { before: lad.drift, after: cut.drift }, cut: cut.info, probe: { ...implied, removed: implied.removed.map(({ constraint, ...r }) => r) } as any, entries: entrySummary });
  return conv;
}

// ---------------------------------------------------------------- crossing curves

interface CutOutcome {
  info: Record<string, unknown>;
  drift?: number;
  step?: string; // when the cut forced the units one by one
  pieces?: Map<Id, Id>; // the curves of the cut, each by the curve it is a piece of
}

// What a cut did (the tool's IDs and batch), for the check after it.
type CutDone = { ids: Record<string, Id[]>; commands: Command[] };

const dist = (a?: V2, b?: V2) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity);

// The pieces of a cut, each by the curve it was before the cut (`before`, at Onshape's places in
// `expected`): a curve that keeps its ID is its own; a new piece is of a curve the cut touched (it
// kept its ID or was removed) and that is no construction curve: a new arc of the circle or the arc
// with its centre whose span holds the piece (of those, the radius nearest), a new line of the line
// whose stretch holds both its ends. And the check of the geometry the cut made, within 1e-6 mm:
// every arc of a cut curve has the radius of that curve, every line piece lies on the line of its
// curve, every point the batch adds is where the batch put it. (The areas of the regions are not compared: the polygon of an arc piece
// is not that part of the polygon of the whole circle.)
export function cutPieces(engine: Engine, sketch: Id, before: C[], expected: Expected, done: CutDone): { of: Map<Id, Id>; problems: string[] } {
  const st = engine.getState();
  const f: any = st.document.features.find((x) => x.id === sketch);
  const res = st.evaluation.features[sketch]?.sketch;
  const of = new Map<Id, Id>();
  const problems: string[] = [];
  if (!f || !res) return { of, problems: ['the sketch is not evaluated'] };
  const now = (p: Id): V2 | undefined => { const q = res.points[p]; return q ? [q.x, q.y] : undefined; };
  const was = (p: Id): V2 | undefined => expected.points.get(p);
  const radiusBefore = (c: C) => (c.circle ? c.circle.r : c.arc ? dist(was(c.arc[0]), was(c.arc[1])) : Infinity);
  const offLine = (a: V2, b: V2, p: V2 | undefined): number => {
    if (!p) return Infinity;
    const L = dist(a, b);
    const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L;
    const off = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L;
    return t < -TOLERANCE || t > L + TOLERANCE ? Infinity : off;
  };
  const byId = new Map(before.map((c) => [c.id, c]));
  // a new piece is of a curve the cut touched, never of a construction curve (the cut leaves those)
  const touched = new Set([...(done.ids.changed ?? []), ...(done.ids.removed ?? [])]);
  const carriers = before.filter((x) => touched.has(x.id) && !x.construction);
  // the turn from a to b counter-clockwise about o, in [0, 2π)
  const turn = (o: V2, a: V2, b: V2) => { const t = Math.atan2(b[1] - o[1], b[0] - o[0]) - Math.atan2(a[1] - o[1], a[0] - o[0]); return t < 0 ? t + 2 * Math.PI : t; };
  // an arc before the cut holds the piece: both ends of the piece within its span (a circle holds any)
  const spans = (x: C, c: any): boolean => {
    if (!x.arc) return true;
    const [o, s, e] = [was(x.arc[0]), was(x.arc[1]), was(x.arc[2])];
    const [ps, pe] = [now(c.start), now(c.end)];
    if (!o || !s || !e || !ps || !pe) return false;
    const span = turn(o, s, e) || 2 * Math.PI;
    const slack = TOLERANCE / Math.max(dist(o, s), TOLERANCE);
    // where a point is along the arc from its start (a point a hair before the start is at it)
    const along = (p: V2) => { const t = turn(o, s, p); return t >= 2 * Math.PI - slack ? 0 : t; };
    // the piece runs counter-clockwise from its start to its end, both within the span, in that order
    const [ts, te] = [along(ps), along(pe)];
    return ts <= span + slack && te <= span + slack && ts <= te + slack;
  };
  for (const cid of [...(done.ids.changed ?? []), ...(done.ids.added ?? [])]) {
    const c = f.curves[cid];
    if (!c || (c.type !== 'line' && c.type !== 'arc')) continue;
    let orig = byId.get(cid);
    if (!orig && c.type === 'arc') {
      const r = dist(now(c.center), now(c.start));
      orig = carriers.filter((x) => (x.circle?.c ?? x.arc?.[0]) === c.center && spans(x, c)).sort((a, b) => Math.abs(radiusBefore(a) - r) - Math.abs(radiusBefore(b) - r))[0];
    } else if (!orig) orig = carriers.find((x) => x.line && Math.max(offLine(was(x.line[0])!, was(x.line[1])!, now(c.a)), offLine(was(x.line[0])!, was(x.line[1])!, now(c.b))) <= TOLERANCE);
    if (!orig) { problems.push(`the piece ${cid} lies on no curve of the sketch before the cut`); continue; }
    of.set(cid, orig.id);
    if (c.type === 'arc' && (orig.circle || orig.arc)) {
      const [o, r0] = [now(c.center), radiusBefore(orig)];
      const off = Math.max(Math.abs(dist(o, now(c.start)) - r0), Math.abs(dist(o, now(c.end)) - r0));
      if (!(off <= TOLERANCE)) problems.push(`the arc ${cid} is off the radius of ${orig.id} by ${off.toExponential(1)} mm`);
    } else if (c.type === 'line' && orig.line) {
      const [a, b] = [was(orig.line[0])!, was(orig.line[1])!];
      const off = Math.max(offLine(a, b, now(c.a)), offLine(a, b, now(c.b)));
      if (!(off <= TOLERANCE)) problems.push(`the line ${cid} is off the line of ${orig.id} by ${off.toExponential(1)} mm`);
    } else problems.push(`the piece ${cid} is a ${c.type}, its curve ${orig.id} is not`);
  }
  for (const cmd of done.commands as any[]) {
    if (cmd.type !== 'addPoint') continue;
    const off = dist(now(cmd.id), [cmd.x, cmd.y]);
    if (!(off <= TOLERANCE)) problems.push(`the point ${cmd.id} of the cut moved by ${off.toExponential(1)} mm`);
  }
  return { of, problems };
}

// The check after the cut (or of a sketch the cut leaves alone, `done` undefined): what passes, the
// pieces where their curves were, a valid profile, nothing uncut, no contact without a fix, and
// Onshape's number of regions wherever every curve of the sketch was converted.
function afterCut(engine: Engine, sketch: Id, expected: Expected, done: CutDone | undefined, regions: number | undefined, before: C[]): { ok: boolean; why?: string; drift: number; pieces?: Map<Id, Id> } {
  const r = engine.getState().evaluation.features[sketch];
  if (r.status !== 'ok' || !r.sketch) return { ok: false, why: `${r.status} ${r.warnings.map((w) => w.code).join(',')}`, drift: Infinity };
  if (r.sketch.conflicting.length) return { ok: false, why: `conflicting: ${r.sketch.conflicting.join(', ')}`, drift: Infinity };
  let drift = 0;
  for (const [pid, [x, y]] of expected.points) { const q = r.sketch.points[pid]; if (q) drift = Math.max(drift, Math.hypot(q.x - x, q.y - y)); }
  for (const [cid, r0] of expected.radii) { const v = r.sketch.radii[cid]; if (v !== undefined) drift = Math.max(drift, Math.abs(v - r0)); }
  if (drift > TOLERANCE) return { ok: false, why: `a point or a radius moved by ${drift.toExponential(1)} mm`, drift };
  const cut = done ? cutPieces(engine, sketch, before, expected, done) : undefined;
  if (cut?.problems.length) return { ok: false, why: cut.problems.slice(0, 3).join('; '), drift };
  if (!r.sketch.valid) return { ok: false, why: 'the profile is invalid', drift };
  if (done?.ids.uncut?.length) return { ok: false, why: `uncut: ${done.ids.uncut.join(', ')}`, drift };
  const contacts: any = engine.query('sketchContacts', { sketch, max: 100_000 } as any);
  const none = contacts.ok ? (contacts.result.contacts as any[]).filter((c) => c.fix === 'none') : [];
  if (none.length) return { ok: false, why: `${none.length} contact(s) without a fix`, drift };
  if (regions !== undefined && r.sketch.regions.length !== regions) return { ok: false, why: `${r.sketch.regions.length} regions, Onshape ${regions}`, drift };
  return { ok: true, drift, pieces: cut?.of };
}

function runCut(engine: Engine, sketch: Id): { tool: ReturnType<typeof sketchTool>; ms: number } {
  const st = engine.getState();
  const sk = st.document.features.find((f) => f.id === sketch) as any;
  const t0 = performance.now();
  const tool = sketchTool('split', { sketch: sk, result: st.evaluation.features[sketch]?.sketch, parameters: st.evaluation.parameters, document: st.document, features: st.evaluation.features }, {}, freshIds(st.document, `${sketch}.cut.`));
  return { tool, ms: performance.now() - t0 };
}

function contactRows(engine: Engine, sketch: Id): string {
  const c: any = engine.query('sketchContacts', { sketch, max: 5 } as any);
  if (!c.ok) return '';
  return `${c.result.total} contact(s)${c.result.reason ? ` (${c.result.reason})` : ''}: ${(c.result.contacts as any[]).map((x) => `${x.curves.join(' × ')} at ${x.at.map((v: number) => v.toFixed(3)).join(',')} ${x.kind} fix ${x.fix}`).join('; ')}`;
}

// Cuts every contact of two outline curves (D65), checked after; when the check fails, the units
// are settled one by one with the cut inside the test of each; a sketch whose bare geometry does
// not pass after the cut stays as written and is reported. Sets the fates of what the cut removes.
// A sketch the tool leaves alone (nothing to cut, or refused) gets the same check, reported when it
// fails.
function cutSketch(engine: Engine, report: Report, sketch: Id, name: string, base: Command[], written: ConstraintRecord[], expected: Expected, skipped: Record<string, number>, onshapeRegions: number | undefined, before: C[]): CutOutcome {
  const regions = Object.keys(skipped).length ? undefined : onshapeRegions;
  const first = runCut(engine, sketch);
  if (!first.tool.ok || !first.tool.commands.length) {
    const j = afterCut(engine, sketch, expected, undefined, regions, before);
    if (!first.tool.ok) report.later('Cuts', `${name}: split refused: ${first.tool.message.slice(0, 300)}; ${contactRows(engine, sketch)}`);
    else if (!j.ok) report.later('Cuts', `${name}: nothing to cut, and the sketch does not pass the check after the cut (${j.why}); ${contactRows(engine, sketch)}`);
    return { info: { ...(first.tool.ok ? { commands: 0 } : { refused: first.tool.message }), ...(j.ok ? {} : { failed: j.why }) } };
  }
  const counts = (ids: Record<string, Id[]>) => Object.fromEntries(Object.entries(ids).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
  // the cut executed and checked; undone when it does not pass (`applied`: it stays)
  const tryCut = (tool: SketchToolResult): { ok: boolean; why?: string; drift: number; applied: boolean; pieces?: Map<Id, Id> } => {
    if (!tool.ok) return { ok: false, why: `split refused: ${tool.message}`, drift: Infinity, applied: false };
    if (!tool.commands.length) return { ...afterCut(engine, sketch, expected, undefined, regions, before), applied: false };
    const r = engine.execute({ type: 'batch', commands: tool.commands });
    if (!r.ok) return { ok: false, why: `the batch is refused: ${r.error.message.slice(0, 200)}`, drift: Infinity, applied: false };
    const j = afterCut(engine, sketch, expected, tool, regions, before);
    if (!j.ok) engine.undo();
    return { ...j, applied: j.ok };
  };
  const j = tryCut(first.tool);
  if (j.ok) {
    settleRemoved(engine, sketch, written, first.tool.ids, j.pieces ?? new Map(), before);
    report.note(`${name}: cut by split: ${JSON.stringify(counts(first.tool.ids))}, ${first.tool.commands.length} commands, ${first.ms.toFixed(0)} ms`);
    return { info: { ...counts(first.tool.ids), commands: first.tool.commands.length, ms: first.ms }, drift: j.drift, pieces: j.pieces };
  }
  engine.undo(); // the sketch as written goes
  // the bare geometry first: when it does not pass after the cut, no unit is to blame
  engine.execute({ type: 'batch', commands: base });
  const bare = tryCut(runCut(engine, sketch).tool);
  if (!bare.ok) {
    engine.undo();
    engine.execute({ type: 'batch', commands: [...base, ...written.flatMap((u) => u.commands.map(strip))] });
    report.later('Cuts', `${name}: the bare geometry does not pass after the cut (${bare.why}); left as written; ${contactRows(engine, sketch)}`);
    return { info: { failed: bare.why }, step: 'the cut does not pass' };
  }
  if (bare.applied) engine.undo();
  engine.undo();
  // write, cut, check: the unit that breaks the cut is the one refused
  report.note(`${name}: the cut does not pass (${j.why}); the units one by one with the cut`);
  const kept: Command[] = [];
  for (const u of written) {
    const own = u.commands.map(strip);
    const r = engine.execute({ type: 'batch', commands: [...base, ...kept, ...own] });
    let k: { ok: boolean; why?: string } = { ok: false, why: r.ok ? undefined : r.error.message.slice(0, 200) };
    if (r.ok) {
      const t = tryCut(runCut(engine, sketch).tool);
      k = t;
      if (t.applied) engine.undo();
      engine.undo();
    }
    if (k.ok) kept.push(...own);
    else Object.assign(u, { fate: 'lost', cause: 'refused', ids: [], detail: `breaks the cut: ${k.why}` });
  }
  engine.execute({ type: 'batch', commands: [...base, ...kept] });
  const last = runCut(engine, sketch);
  const l = tryCut(last.tool);
  if (!l.ok) {
    report.later('Cuts', `${name}: the bare geometry does not pass after the cut (${l.why}); left as written; ${contactRows(engine, sketch)}`);
    return { info: { failed: l.why }, step: 'the cut does not pass' };
  }
  if (last.tool.ok) settleRemoved(engine, sketch, written.filter((u) => u.fate === 'written'), last.tool.ids, l.pieces ?? new Map(), before);
  return { info: last.tool.ok ? { ...counts(last.tool.ids), commands: last.tool.commands.length, ms: last.ms } : {}, drift: l.drift, step: 'one by one with the cut', pieces: l.pieces };
}

// The constraints the cut removed, each by the reason read off the sketch after it: the point it
// held on a curve became an end of a piece of that curve (shared); moved onto pieces of its own
// curves it would repeat one the sketch has (twice) or name one curve twice (refused); else lost
// with the reason not identified. A unit all of whose constraints went takes the worst reason (lost,
// then twice, then shared); a unit that keeps some stays written and its detail names what went.
// `before`: the curves before the cut (a removed ID that was none of them is no curve).
export function settleRemoved(engine: Engine, sketch: Id, written: ConstraintRecord[], ids: Record<string, Id[]>, pieces: Map<Id, Id>, before: C[]) {
  const removed = new Set(ids.removed ?? []);
  const curvesBefore = new Set(before.map((c) => c.id));
  if (!removed.size) return;
  const f: any = engine.getState().document.features.find((x) => x.id === sketch);
  const keyOwner = new Map<string, Id>();
  for (const [cid, c] of Object.entries(f.constraints) as [Id, any][]) keyOwner.set(constraintKey(c), cid);
  const recordOf = (cid: Id) => written.find((r) => r.ids.includes(cid));
  // a curve after the cut: itself if it stays, and the other pieces of the curve it is a piece of
  const piecesOf = (cid: Id): Id[] => { const orig = pieces.get(cid) ?? cid; return [...new Set([...(f.curves[cid] ? [cid] : []), ...[...pieces].filter(([, o]) => o === orig).map(([p]) => p)])]; };
  const endOf = (p: Id, curve: any) => curve && (curve.a === p || curve.b === p || curve.start === p || curve.end === p);
  const reasonOf = (c: any): Partial<ConstraintRecord> => {
    if (!c) return { fate: 'lost', cause: 'refused', detail: 'removed by the cut (reason not identified)' };
    if (c.type === 'pointOnCurve' && f.points[c.point] && piecesOf(c.curve).some((k) => endOf(c.point, f.curves[k]))) return { fate: 'shared', detail: 'by the cut' };
    const curveFields = Object.keys(c).filter((k) => k !== 'type' && typeof c[k] === 'string' && (f.curves[c[k]] || pieces.has(c[k]) || (removed.has(c[k]) && curvesBefore.has(c[k]))));
    let twiceOf: Id | undefined;
    let selfRef = false;
    const variants = (i: number, acc: any) => {
      if (twiceOf) return;
      if (i === curveFields.length) {
        const ops = curveFields.map((k) => acc[k]);
        if (new Set(ops).size < ops.length) { selfRef = true; return; }
        const k = keyOwner.get(constraintKey(acc));
        if (k) twiceOf = k;
        return;
      }
      const field = curveFields[i];
      for (const v of new Set([c[field], ...piecesOf(c[field])])) variants(i + 1, { ...acc, [field]: v });
    };
    if (curveFields.length && curveFields.length <= 2) variants(0, { ...c });
    if (twiceOf) { const of = recordOf(twiceOf); return { fate: 'twice', ...(of ? { twiceOf: of.key } : {}), detail: `the cut: it repeats ${twiceOf}` }; }
    if (selfRef) return { fate: 'lost', cause: 'refused', detail: 'removed by the cut: it would name one curve twice' };
    if (curveFields.some((k) => removed.has(c[k]) && !piecesOf(c[k]).length)) return { fate: 'lost', cause: 'refused', detail: 'removed by the cut: its curve went' };
    return { fate: 'lost', cause: 'refused', detail: 'removed by the cut (reason not identified)' };
  };
  for (const r of written) {
    const gone = r.ids.filter((x) => removed.has(x));
    if (!gone.length) continue;
    const reasons = gone.map((g) => ({ id: g, ...reasonOf((r.commands as any[]).find((x) => x.id === g)?.constraint) }));
    r.ids = r.ids.filter((x) => !removed.has(x));
    if (r.ids.length) {
      const lost = reasons.filter((x) => x.fate === 'lost');
      r.extra = { ...(r.extra ?? {}), cut: reasons.map((x) => `${x.id}: ${x.fate}${x.detail ? ` (${x.detail})` : ''}`) };
      if (lost.length) r.detail = `${r.detail ? `${r.detail}; ` : ''}the cut removed ${lost.map((x) => `${x.id} (${x.detail})`).join(', ')}`;
      continue;
    }
    const { id: _, ...worst } = reasons.find((x) => x.fate === 'lost') ?? reasons.find((x) => x.fate === 'twice') ?? reasons[0];
    Object.assign(r, worst);
  }
}

// Points at one place: joined when a chain of steps of at most WELD links them (single linkage).
// The point of a cluster is its first by the order of Onshape's entities, at that one's place; a
// cluster wider than WELD is reported (a distance is not transitive).
export function weldPoints(points: { src: string; id: Id; at: V2 }[]): { pos: Map<Id, V2>; rep: Map<string, Id>; wide: string[] } {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = points.map((_, i) => i).sort((a, b) => points[a].at[0] - points[b].at[0]);
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length && points[order[j]].at[0] - points[order[i]].at[0] <= WELD; j++) {
      const [p, q] = [points[order[i]].at, points[order[j]].at];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= WELD) { const [a, b] = [find(order[i]), find(order[j])]; if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    }
  const pos = new Map<Id, V2>();
  const rep = new Map<string, Id>();
  const members = new Map<number, number[]>();
  points.forEach((p, i) => { const r = find(i); members.set(r, [...(members.get(r) ?? []), i]); });
  const wide: string[] = [];
  for (const [r, list] of members) {
    pos.set(points[r].id, points[r].at);
    for (const i of list) rep.set(points[i].src, points[r].id);
    let w = 0;
    for (const i of list) for (const j of list) w = Math.max(w, Math.hypot(points[i].at[0] - points[j].at[0], points[i].at[1] - points[j].at[1]));
    if (w > WELD) wide.push(`${points[r].id}: ${list.length} points over ${w.toExponential(2)} mm`);
  }
  return { pos, rep, wide };
}

// What a converted sketch reports and records: its line, the summary, the welds, the promises.
function finishSketch(engine: Engine, report: Report, conv: Converted, name: string, place: SketchPlace, geom: any, feature: any, records: ConstraintRecord[], ladder: string, points: number, curves: number, extra: Partial<SketchSummary> = {}) {
  const id = conv.id;
  const res = engine.getState().evaluation.features[id];
  const sk = res.sketch;
  const all = new Map(report.records.map((r) => [r.key, r]));
  for (const line of sketchLines(name, points, curves, records, all, sk?.degreesOfFreedom)) report.note(line);
  let diagnosis: number | undefined;
  try { diagnosis = engine.diagnoseSketch(id).redundant.length; } catch { diagnosis = undefined; }
  const counts = Object.fromEntries(FATES.map((f) => [f, records.filter((r) => finalFate(r, all).fate === f).length])) as Record<Fate, number>;
  const welds = weldsOf(conv, geom, feature);
  for (const w of welds.listed) report.later('Welds', `${place.studio}, ${name}: ${w}`);
  const key = `${place.studio}/${id}`;
  report.sketches[key] = {
    key, studio: place.studio, id, name, helper: place.helper, status: res.status, warnings: res.warnings.map((w) => w.code), freedom: sk?.degreesOfFreedom, redundant: sk?.redundant ?? [], diagnosisRedundant: diagnosis, valid: sk?.valid,
    regions: sk?.regions.length ?? 0, onshapeRegions: place.onshapeRegions, areas: (sk?.regions ?? []).map((r) => regionArea(r.loops)).sort((a, b) => a - b), welds, ladder, entries: [], counts, ...extra,
  };
  // what the probe asserts: every Onshape pattern's instances are its seeds turned (the points Onshape
  // lists, and the start, end and centre of the curves it lists); a pattern that asserts nothing is
  // listed with the reason
  const pr = report.promisesOf(place.studio);
  if (place.helper) pr.helpers.push(id);
  if (place.derivedFrom) pr.derived[id] = place.derivedFrom;
  const E = new Map<string, any>((geom.entities as any[]).map((e) => [e.sketchEntityId, e]));
  const parameters = engine.getState().document.parameters as any;
  for (const [index, c] of (feature.constraints ?? []).entries()) {
    if (c.constraintType !== 'CIRCULAR_PATTERN') continue;
    const key = `${place.studio}/${id}#${index}`;
    const p = params(c);
    const e = expression(p.patternc1?.expression);
    const count = e === undefined ? undefined : expressionValue(e, parameters);
    const ext = p.externalPivot?.queries?.[0]?.deterministicIds?.[0];
    const known = ext ? knownOperand(ext, conv.frame) : undefined;
    const pivot = p.localPivot?.value ? conv.rep.get(p.localPivot.value) : known && !('lost' in known) && known.k === 'point' ? known.id : undefined;
    const pointRows = instanceRows(c).filter((r) => E.get(r[0])?.sketchEntityType === 'skPoint');
    const curveRows = instanceRows(c).flatMap((r) => ['startPointId', 'endPointId', 'centerId'].map((k) => r.map((v) => E.get(v)?.[k])).filter((x) => x.every(Boolean)));
    const rows = [...pointRows, ...curveRows].map((r) => r.map((v) => conv.rep.get(v) ?? ''));
    const pairs = rows.reduce((n, r) => n + (r[0] === pivot ? 0 : r.slice(1).filter((v, j) => v && r[j]).length), 0);
    const why = extra.entries?.find((x) => x.constraint === key)?.entry
      ? 'an entry: the engine turns its sources, and no image is a point of the sketch'
      : p.openPattern?.value ? 'an open pattern (its angle is not in the dump)'
      : !pivot ? 'the pivot is not a point of the sketch or the origin'
      : count === undefined || !Number.isInteger(count) || count < 2 ? `the count ${p.patternc1?.expression} is no whole number of at least 2`
      : !pairs ? 'no two points of neighbouring instances are points of the sketch' : undefined;
    if (why) report.later('Pattern assertions', `${place.studio}, ${name}: CIRCULAR_PATTERN #${index} asserts nothing: ${why}`);
    else pr.patterns.push({ sketch: id, constraint: key, pivot: pivot!, count: count!, rows });
  }
}

// The places where the converter made one point of several Onshape points, and whether a constraint
// ties them. A weld without a constraint is a relation the converter adds; it is classed by what it
// joins: points of the instances of one pattern or mirror, an instance and an entity outside, two
// plain entities. The last two classes are listed one by one.
export function weldsOf(conv: Converted, geom: any, feature: any): SketchSummary['welds'] {
  const E = new Map<string, any>((geom.entities as any[]).map((e) => [e.sketchEntityId, e]));
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!; return x; };
  const join = (a: string, b: string) => { const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(x, y); };
  const pointsOf = (v: string): string[] => { const e = E.get(v); if (!e) return []; if (e.sketchEntityType === 'skPoint') return [v]; return ['startPointId', 'endPointId', 'centerId'].map((k) => e[k]).filter(Boolean); };
  // groups of a pattern or mirror: its seeds and images, with the points of their curves
  const groups: { members: Set<string>; images: Set<string> }[] = [];
  for (const c of feature.constraints ?? []) {
    const p = params(c);
    if (c.constraintType === 'COINCIDENT' && E.get(p.localFirst?.value)?.sketchEntityType === 'skPoint' && E.get(p.localSecond?.value)?.sketchEntityType === 'skPoint') join(p.localFirst.value, p.localSecond.value);
    // two points that are mirror images of each other at one place are tied by the mirror
    if (c.constraintType === 'MIRROR' && E.get(p.localFirst?.value)?.sketchEntityType === 'skPoint' && E.get(p.localSecond?.value)?.sketchEntityType === 'skPoint') join(p.localFirst.value, p.localSecond.value);
    // two points held on one external point (the origin) are tied too
    if (c.constraintType === 'COINCIDENT') {
      const local = [p.localFirst, p.localSecond].find((q) => E.get(q?.value)?.sketchEntityType === 'skPoint')?.value;
      const ext = [p.externalFirst, p.externalSecond].flatMap((q) => (q?.queries ?? []).flatMap((x: any) => x.deterministicIds ?? []))[0];
      if (local && ext && (ext === ORIGIN_ID || decode(ext)?.kind === 'vertex')) join(local, `external ${ext}`);
    }
    if (c.constraintType === 'CONCENTRIC') { const [a, b] = [E.get(p.localFirst?.value)?.centerId, E.get(p.localSecond?.value)?.centerId]; if (a && b) join(a, b); }
    if (/PATTERN/.test(c.constraintType)) {
      const rows = instanceRows(c);
      const members = new Set<string>(), images = new Set<string>();
      for (const r of rows) r.forEach((v, j) => { for (const q of pointsOf(v)) { members.add(q); if (j) images.add(q); } });
      groups.push({ members, images });
    } else if (c.constraintType === 'MIRROR' && p.localFirst && p.localSecond && E.get(p.localFirst.value)?.sketchEntityType !== 'skPoint') {
      groups.push({ members: new Set([...pointsOf(p.localFirst.value), ...pointsOf(p.localSecond.value)]), images: new Set(pointsOf(p.localSecond.value)) });
    }
  }
  const byPlace = new Map<Id, string[]>();
  for (const e of geom.entities as any[]) if (e.sketchEntityType === 'skPoint') { const r = conv.rep.get(e.sketchEntityId); if (r) byPlace.set(r, [...(byPlace.get(r) ?? []), e.sketchEntityId]); }
  const out: SketchSummary['welds'] = { places: 0, tied: 0, untied: {}, listed: [], wide: [] };
  for (const [place, pts] of byPlace) {
    if (pts.length < 2) continue;
    out.places++;
    if (pts.every((q) => find(q) === find(pts[0]))) { out.tied++; continue; }
    const images = pts.filter((q) => groups.some((g) => g.images.has(q)));
    const cls = !images.length ? 'two plain entities' : groups.some((g) => pts.every((q) => g.members.has(q))) ? 'among the instances of one pattern or mirror' : 'an instance and an entity outside';
    out.untied[cls] = (out.untied[cls] ?? 0) + 1;
    if (cls !== 'among the instances of one pattern or mirror') out.listed.push(`${cls}: ${place} (${pts.join(', ')})`);
  }
  return out;
}

// ---------------------------------------------------------------- regions

const loopArea = (l: Float64Array) => { let s = 0; for (let i = 0; i < l.length; i += 2) { const j = (i + 2) % l.length; s += l[i] * l[j + 1] - l[j] * l[i + 1]; } return Math.abs(s / 2); };
export const regionArea = (loops: Float64Array[]) => loops.reduce((s, l, i) => s + (i === 0 ? loopArea(l) : -loopArea(l)), 0);

// The region of a trymesh sketch that is the Onshape region (a face of the sketch body, as the dump
// gives it, in model coordinates): the area agrees (to 2 % or 0.05 mm², the polygons of circles
// are smaller), the middle of every curve of its outer loop lies on an edge of the Onshape region,
// and the middle of every edge of the Onshape region lies on the boundary of the region.
export function matchRegion(engine: Engine, conv: Converted, region: any): RegionRef | undefined {
  const st = engine.getState();
  const res = st.evaluation.features[conv.id]?.sketch;
  const doc = st.document.features.find((f) => f.id === conv.id) as any;
  if (!res || !doc) return undefined;
  // every curve of a loop, own (pieces of a cut too) or a copy of an entry
  const solved = solvedCurves(doc, res);
  const pt = (id: Id): V2 => { const q = solved.geometry.points[id]; return [q.x, q.y]; };
  const edges = (region.edges as any[]).map((e) => ({ ...e, a2: worldToBase(conv.frame, e.a), m2: worldToBase(conv.frame, e.m), b2: worldToBase(conv.frame, e.b), c2: e.center && worldToBase(conv.frame, e.center) }));
  const middle = (cid: Id): V2 | undefined => {
    const c: any = solved.curves.get(cid)?.shape;
    if (!c) return undefined;
    if (c.type === 'line') { const [a, b] = [pt(c.a), pt(c.b)]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    if (c.type === 'arc') {
      const [o, s, e] = [pt(c.center), pt(c.start), pt(c.end)];
      const t0 = Math.atan2(s[1] - o[1], s[0] - o[0]);
      let t1 = Math.atan2(e[1] - o[1], e[0] - o[0]);
      while (t1 <= t0) t1 += 2 * Math.PI;
      const r = Math.hypot(s[0] - o[0], s[1] - o[1]);
      return [o[0] + r * Math.cos((t0 + t1) / 2), o[1] + r * Math.sin((t0 + t1) / 2)];
    }
    return undefined;
  };
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const onEdge = (e: any, [x, y]: V2): boolean => {
    if (e.curve === 'line') {
      const [a, b] = [e.a2, e.b2];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / L2;
      return Math.abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.sqrt(L2) < 1e-3 && t > -1e-6 && t < 1 + 1e-6;
    }
    if (e.curve !== 'circle' || Math.abs(Math.hypot(x - e.c2[0], y - e.c2[1]) - e.radius) > 1e-3) return false;
    if (Math.hypot(e.a2[0] - e.b2[0], e.a2[1] - e.b2[1]) < 1e-6) return true; // a whole circle
    const ang = (p: V2) => Math.atan2(p[1] - e.c2[1], p[0] - e.c2[0]);
    const [ta, tm, tb, tp] = [ang(e.a2), ang(e.m2), ang(e.b2), ang([x, y])];
    return norm(tm - ta) < norm(tb - ta) ? norm(tp - ta) <= norm(tb - ta) + 1e-9 : norm(ta - tp) <= norm(ta - tb) + 1e-9;
  };
  // a curve of a spline's chain: the whole chain in the loop, and an edge of the kind `other` with
  // the chain's ends whose middle lies on the chain (sampled finer than the engine's polyline)
  const chainOf = (cid: Id) => [...(conv.chains?.values() ?? [])].find((x) => x.curves.includes(cid));
  const sampled = new Map<object, V2[]>();
  const onChain = (chain: { curves: Id[]; points: Id[] }, loop: Id[]): boolean => {
    if (!chain.curves.every((x) => loop.includes(x))) return false;
    let line = sampled.get(chain);
    if (!line) {
      const pieces = chain.curves.flatMap((x): V2[][] => { const s: any = solved.curves.get(x)?.shape; return s?.type === 'spline' ? splineBeziers(s.points.map(pt)) : s?.type === 'line' ? [[pt(s.a), pt(s.b)]] : []; });
      line = sampleChain(pieces);
      sampled.set(chain, line);
    }
    const [s, z] = [pt(chain.points[0]), pt(chain.points[chain.points.length - 1])];
    const near = (u: V2, v: V2) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-3;
    return edges.some((e) => e.curve === 'other' && ((near(e.a2, s) && near(e.b2, z)) || (near(e.a2, z) && near(e.b2, s))) && distanceToPolyline(line!, e.m2) < 1e-3);
  };
  const curveOnRegion = (cid: Id, loop: Id[]): boolean => {
    const chain = chainOf(cid);
    if (chain) return onChain(chain, loop);
    const c: any = solved.curves.get(cid)?.shape;
    if (!c) return false;
    if (c.type === 'circle') return edges.some((e) => e.curve === 'circle' && Math.hypot(pt(c.center)[0] - e.c2[0], pt(c.center)[1] - e.c2[1]) < 1e-3 && Math.abs(solved.geometry.radii[cid] - e.radius) < 1e-3);
    const m = middle(cid);
    return !!m && edges.some((e) => onEdge(e, m));
  };
  const nearLoops = (loops: Float64Array[], [x, y]: V2) =>
    loops.some((l) => {
      for (let i = 0; i < l.length; i += 2) {
        const j = (i + 2) % l.length;
        const [ax, ay, bx, by] = [l[i], l[i + 1], l[j], l[j + 1]];
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
        if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < 0.1) return true;
      }
      return false;
    });
  let best: { ref: RegionRef; err: number } | undefined;
  for (const r of res.regions) {
    const err = Math.abs(regionArea(r.loops) - region.area);
    if (err > Math.max(0.02 * region.area, 0.05) || !r.ref.outerLoop.every((cid) => curveOnRegion(cid, r.ref.outerLoop)) || !edges.every((e) => nearLoops(r.loops, e.m2))) continue;
    if (!best || err < best.err) best = { ref: r.ref, err };
  }
  return best?.ref;
}
