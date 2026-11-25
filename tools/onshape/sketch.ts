// An Onshape sketch as a sketch of trymesh: its points, lines and circles in the frame of a base plane,
// the curves split where they cross, and the constraints that have a counterpart.
import type { Command, Engine, Id, PlaneRef, RegionRef } from '../../packages/engine/src/index';
import { type SketchToolResult, constraintKey, emptySketch, freshIds, sketchTool, solvedCurves } from '../../packages/engine/src/index';
import { type Report, type V2, type V3, dot, exec, expression, sane } from './common';
import { type Expected, type Pair, TOLERANCE, impliedConstraints, impliedLines, ladder, probeSketch, sketchChanges, strip } from './check';
import { type ExternalResolver, type MapContext, knownOperand, mapConstraints, numberConstraints, onshapeKind, params, twiceByMeaning } from './constraints';
import { type Cause, type ConstraintRecord, FATES, type Fate, type SketchSummary, finalFate, sketchLines } from './fates';
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
}

type C = { id: string; src: string; construction: boolean; line?: [string, string]; circle?: { c: string; r: number }; arc?: [string, string, string] };

// Where a sketch is converted: its studio, the decode of external IDs there, and its key.
export interface SketchPlace {
  studio: string;
  ops: StudioOperations; // the operations of the studio that holds the Onshape feature
  helper: boolean;
  onshapeRegions?: number; // the faces the Onshape sketch feature created
  derivedFrom?: string; // `<source studio>/<source feature>` of a derived copy
  sketchesFor?: (cls: IdClass & { what: 'sketch' | 'derived' }) => Id[]; // the trymesh sketches made from what an ID decodes to
}

// Points of Onshape within this distance of each other, in chains, are one point of trymesh.
export const WELD = 1e-6;

export function convertSketch(engine: Engine, report: Report, id: Id, name: string, plane: PlaneRef, frame: SketchFrame, feature: any, geom: any, place: SketchPlace): Converted | undefined {
  const P = (s: string) => `${id}.${sane(s)}`; // entity IDs are unique in the whole document
  // Onshape gives every curve its own end points, held together by coincident constraints; points
  // at one place become one point (that is what trymesh needs to close a region).
  const welded = weldPoints((geom.entities as any[]).filter((e) => e.sketchEntityType === 'skPoint').map((e) => ({ src: e.sketchEntityId as string, id: P(e.sketchEntityId), at: toBase(frame, [e.position2d.x * 1000, e.position2d.y * 1000]) })));
  const { pos, rep } = welded;
  for (const w of welded.wide) report.later('Welds', `${place.studio}, ${name}: a cluster of welded points wider than ${WELD} mm: ${w}`);
  const kind = new Map<string, 'point' | 'line' | 'circle' | 'arc'>();
  for (const e of geom.entities) if (e.sketchEntityType === 'skPoint') kind.set(e.sketchEntityId, 'point');
  const curves: C[] = [];
  const skipped: Record<string, number> = {};
  // An exact duplicate (the same kind over the same points with the same construction flag; a
  // circle: the same centre and radius) is written once; its Onshape entity points at the first, a
  // line drawn the other way as "the same line, reversed".
  const curveOf = new Map<string, { id: Id; reversed: boolean }>();
  const same = (c: C, x: C) => c.construction === x.construction && (c.line && x.line ? (c.line[0] === x.line[0] && c.line[1] === x.line[1]) || (c.line[0] === x.line[1] && c.line[1] === x.line[0]) : c.circle && x.circle ? c.circle.c === x.circle.c && Math.abs(c.circle.r - x.circle.r) <= WELD : c.arc && x.arc ? c.arc.join() === x.arc.join() : false);
  for (const e of geom.entities) {
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
  if (Object.keys(skipped).length) report.note(`${name}: entities without a counterpart, left out: ${JSON.stringify(skipped)}`);
  const base: Command[] = [
    { type: 'addFeature', feature: emptySketch(id, name, plane) },
    ...[...pos].map(([pid, [x, y]]): Command => ({ type: 'addPoint', sketch: id, id: pid, x, y })),
    ...curves.map((c): Command => ({
      type: 'addCurve',
      sketch: id,
      id: c.id,
      curve: { ...(c.line ? { type: 'line', a: c.line[0], b: c.line[1] } : c.arc ? { type: 'arc', center: c.arc[0], start: c.arc[1], end: c.arc[2] } : { type: 'circle', center: c.circle!.c }), ...(c.construction ? { construction: true } : {}) } as any,
      ...(c.circle ? { radius: c.circle.r } : {}),
    })),
  ];
  const conv: Converted = { id, frame, kind, rep };
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
      const ids = place.sketchesFor?.(cls) ?? [];
      if (!ids.length) return { lost: 'sketch', detail: `${classText(cls)}: the sketch is not in this document` };
      cands = ids.flatMap((sid) => sketchCandidates(engine, sid, cls.decoded.kind as 'vertex' | 'edge'));
    } else if (cls.what === 'solid') cands = edgeCandidates(engine, (w) => worldToBase(frame, w), frame.base.normal as V3, cls.decoded.kind as 'vertex' | 'edge');
    else if (cls.what === 'planeFeature') return { lost: 'plane', detail: classText(cls) };
    else return { lost: 'unknown', detail: classText(cls) };
    const fit = fitting(cands, type, locals);
    const p = pickCandidate(fit, type);
    op.candidates = fit.map((c) => c.text);
    if (!p.pick) return { lost: lostAs, detail: `${classText(cls)}: ${p.why}` };
    op.inferred = true;
    if (p.others.length) op.note = `${p.why}; the other: ${p.others.map((c) => c.text).join('; ')}`;
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
  const ctx: MapContext = { studio: place.studio, sketch: id, name, helper: place.helper, kind, rep, pos, curves, curveOf, entityType, split: new Set(), ops: place.ops, frame, parameters: engine.getState().document.parameters, resolve };
  const { records } = mapConstraints(ctx, feature.constraints ?? []);
  report.records.push(...records);
  twiceByMeaning(records, engine.getState().document.parameters);
  numberConstraints(records, id);
  // The check: every unit with its expressions; else one by one (check.ts).
  const expected: Expected = { points: new Map(pos), radii: new Map(curves.filter((c) => c.circle).map((c) => [c.id, c.circle!.r])) };
  const units = records.filter((r) => !r.fate);
  // what the probes leave alone, and what they assert
  const promises = report.promisesOf(place.studio);
  const pairs: Pair[] = [];
  for (const u of units) for (const c of u.commands as any[]) {
    if (c.zero) promises.notChanged.push(`${id} ${c.id}`);
    if (c.pair) pairs.push({ a: c.pair[0], b: c.pair[1], label: `${u.what} (${c.id})`, record: u, command: c });
  }
  const lad = ladder(engine, id, base, units, expected);
  if (!exec(engine, report, { type: 'batch', commands: [...base, ...lad.commands] }, name)) return undefined;
  // Crossing curves: the sketch tool `split` once, its batch checked before it stays.
  const cut = cutSketch(engine, report, id, name, base, units.filter((u) => u.fate === 'written'), expected, skipped, place.onshapeRegions);
  // A distance of two lines keeps them parallel in Onshape, one point–line distance does not: the
  // sketch's probe asks whether they stay parallel, and a pair that parts gets `parallel` in its unit.
  const livePairs = pairs.filter((x) => x.record.fate === 'written' && x.record.ids.includes(x.command.id));
  if (livePairs.length) {
    const notChanged = new Set(promises.notChanged);
    const p = probeSketch(engine, id, sketchChanges(engine, id, notChanged), [], livePairs);
    // the next number after the last one written
    let next = 1 + Math.max(-1, ...Object.keys((engine.getState().document.features.find((f) => f.id === id) as any).constraints).map((k) => Number(/\.c(\d+)$/.exec(k)?.[1] ?? -1)));
    for (const x of livePairs) {
      if (![...p.breaks].some((b) => b.includes(x.label))) continue;
      const pid = `${id}.c${String(next++).padStart(3, '0')}`;
      const cmd: any = { type: 'addConstraint', sketch: id, id: pid, constraint: { type: 'parallel', a: x.a, b: x.b }, record: x.record };
      if (exec(engine, report, strip(cmd), `${name}: parallel for ${x.label}`)) { x.record.commands.push(cmd); x.record.ids.push(pid); x.record.detail = 'with `parallel`: the pair parted in the probe'; }
    }
    for (const x of livePairs) promises.pairs.push({ sketch: id, a: x.a, b: x.b, constraint: x.record.key });
  }
  // Implied constraints, where the sketch's probe shows it cannot follow.
  const implied = impliedConstraints(engine, id, records.filter((r) => r.fate === 'written'), expected, { notChanged: new Set(promises.notChanged), pairs: livePairs });
  for (const r of implied.removed) report.promisesOf(place.studio).removed.push({ sketch: id, id: r.id, constraint: (records.flatMap((x) => x.commands as any[]).find((c) => c.id === r.id) as any).constraint });
  for (const line of impliedLines(`${place.studio}, ${name}`, implied)) report.later('Redundant constraints', line);
  finishSketch(engine, report, conv, name, place, geom, feature, records, cut.step ?? lad.step, pos.size, curves.length, { drift: { before: lad.drift, after: cut.drift }, cut: cut.info, probe: implied });
  return conv;
}

// ---------------------------------------------------------------- crossing curves

interface CutOutcome {
  info: Record<string, unknown>;
  drift?: number;
  step?: string; // when the cut forced the units one by one
}

// The check after the cut: what passes, a valid profile, nothing uncut, no contact without a fix,
// and Onshape's number of regions wherever every curve of the sketch was converted.
function afterCut(engine: Engine, sketch: Id, expected: Expected, ids: Record<string, Id[]>, regions: number | undefined): { ok: boolean; why?: string; drift: number } {
  const r = engine.getState().evaluation.features[sketch];
  if (r.status !== 'ok' || !r.sketch) return { ok: false, why: `${r.status} ${r.warnings.map((w) => w.code).join(',')}`, drift: Infinity };
  if (r.sketch.conflicting.length) return { ok: false, why: `conflicting: ${r.sketch.conflicting.join(', ')}`, drift: Infinity };
  let drift = 0;
  for (const [pid, [x, y]] of expected.points) { const q = r.sketch.points[pid]; if (q) drift = Math.max(drift, Math.hypot(q.x - x, q.y - y)); }
  for (const [cid, r0] of expected.radii) { const v = r.sketch.radii[cid]; if (v !== undefined) drift = Math.max(drift, Math.abs(v - r0)); }
  if (drift > TOLERANCE) return { ok: false, why: `a point or a radius moved by ${drift.toExponential(1)} mm`, drift };
  if (!r.sketch.valid) return { ok: false, why: 'the profile is invalid', drift };
  if (ids.uncut?.length) return { ok: false, why: `uncut: ${ids.uncut.join(', ')}`, drift };
  const contacts: any = engine.query('sketchContacts', { sketch } as any);
  const none = contacts.ok ? (contacts.result.contacts as any[]).filter((c) => c.fix === 'none') : [];
  if (none.length) return { ok: false, why: `${none.length} contact(s) without a fix`, drift };
  if (regions !== undefined && r.sketch.regions.length !== regions) return { ok: false, why: `${r.sketch.regions.length} regions, Onshape ${regions}`, drift };
  return { ok: true, drift };
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
function cutSketch(engine: Engine, report: Report, sketch: Id, name: string, base: Command[], written: ConstraintRecord[], expected: Expected, skipped: Record<string, number>, onshapeRegions: number | undefined): CutOutcome {
  const regions = Object.keys(skipped).length ? undefined : onshapeRegions;
  const first = runCut(engine, sketch);
  if (!first.tool.ok) {
    report.later('Cuts', `${name}: split refused: ${first.tool.message.slice(0, 300)}; ${contactRows(engine, sketch)}`);
    return { info: { refused: first.tool.message } };
  }
  if (!first.tool.commands.length) return { info: { commands: 0 } };
  const counts = (ids: Record<string, Id[]>) => Object.fromEntries(Object.entries(ids).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
  // the cut executed and checked; undone when it does not pass (`applied`: it stays)
  const tryCut = (tool: SketchToolResult): { ok: boolean; why?: string; drift: number; applied: boolean } => {
    if (!tool.ok) return { ok: false, why: `split refused: ${tool.message}`, drift: Infinity, applied: false };
    if (!tool.commands.length) return { ...afterCut(engine, sketch, expected, tool.ids, regions), applied: false };
    const r = engine.execute({ type: 'batch', commands: tool.commands });
    if (!r.ok) return { ok: false, why: `the batch is refused: ${r.error.message.slice(0, 200)}`, drift: Infinity, applied: false };
    const j = afterCut(engine, sketch, expected, tool.ids, regions);
    if (!j.ok) engine.undo();
    return { ...j, applied: j.ok };
  };
  const j = tryCut(first.tool);
  if (j.ok) {
    settleRemoved(engine, sketch, written, first.tool.ids);
    report.note(`${name}: cut by split: ${JSON.stringify(counts(first.tool.ids))}, ${first.tool.commands.length} commands, ${first.ms.toFixed(0)} ms`);
    return { info: { ...counts(first.tool.ids), commands: first.tool.commands.length, ms: first.ms }, drift: j.drift };
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
  if (last.tool.ok) settleRemoved(engine, sketch, written.filter((u) => u.fate === 'written'), last.tool.ids);
  return { info: last.tool.ok ? { ...counts(last.tool.ids), commands: last.tool.commands.length, ms: last.ms } : {}, drift: l.drift, step: 'one by one with the cut' };
}

// A constraint the cut removed, by the reason read off the sketch after it: the point it held on a
// curve became the shared point of the pieces (shared); it would repeat one the sketch has (twice);
// it went with a curve the tool removed, or would name one curve twice (lost, refused).
function settleRemoved(engine: Engine, sketch: Id, written: ConstraintRecord[], ids: Record<string, Id[]>) {
  const removed = new Set(ids.removed ?? []);
  if (!removed.size) return;
  const f: any = engine.getState().document.features.find((x) => x.id === sketch);
  const pieces = [...new Set([...(ids.changed ?? []), ...(ids.added ?? [])])];
  const keyOwner = new Map<string, Id>();
  for (const [cid, c] of Object.entries(f.constraints) as [Id, any][]) keyOwner.set(constraintKey(c), cid);
  const recordOf = (cid: Id) => written.find((r) => r.ids.includes(cid));
  for (const r of written) {
    const gone = r.ids.filter((x) => removed.has(x));
    if (!gone.length) continue;
    r.ids = r.ids.filter((x) => !removed.has(x));
    if (r.ids.length) continue;
    const c: any = (r.commands as any[]).find((x) => x.id === gone[0])?.constraint;
    let fate: Partial<ConstraintRecord> = { fate: 'lost', cause: 'refused', detail: 'removed by the cut: its curve went' };
    const endOf = (p: Id, curve: any) => curve && (curve.a === p || curve.b === p || curve.start === p || curve.end === p);
    if (c?.type === 'pointOnCurve' && f.points[c.point] && [c.curve, ...pieces].some((k) => endOf(c.point, f.curves[k]))) fate = { fate: 'shared', detail: 'by the cut' };
    else if (c) {
      const fields = Object.keys(c).filter((k) => typeof c[k] === 'string' && f.curves[c[k]] === undefined && (removed.has(c[k]) || pieces.length));
      // the constraint moved onto the pieces: does it repeat one, or name one curve twice?
      const curveFields = Object.keys(c).filter((k) => k !== 'type' && typeof c[k] === 'string' && (f.curves[c[k]] || pieces.includes(c[k]) || removed.has(c[k])));
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
        for (const v of [c[field], ...pieces]) variants(i + 1, { ...acc, [field]: v });
      };
      if (curveFields.length && curveFields.length <= 2) variants(0, { ...c });
      void fields;
      if (twiceOf) { const of = recordOf(twiceOf); fate = { fate: 'twice', ...(of ? { twiceOf: of.key } : {}), detail: `the cut: it repeats ${twiceOf}` }; }
      else if (selfRef) fate = { fate: 'lost', cause: 'refused', detail: 'removed by the cut: it would name one curve twice' };
    }
    Object.assign(r, fate);
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
  // what the probe asserts: every Onshape pattern's instances are its seeds turned
  const pr = report.promisesOf(place.studio);
  if (place.helper) pr.helpers.push(id);
  if (place.derivedFrom) pr.derived[id] = place.derivedFrom;
  for (const [index, c] of (feature.constraints ?? []).entries()) {
    if (c.constraintType !== 'CIRCULAR_PATTERN') continue;
    const p = params(c);
    const count = Number(expression(p.patternc1?.expression));
    const pivot = conv.rep.get(p.localPivot?.value);
    if (p.openPattern?.value || !pivot || !Number.isFinite(count)) continue;
    const isPoint = (v: string) => (geom.entities as any[]).some((e) => e.sketchEntityId === v && e.sketchEntityType === 'skPoint');
    const rows = instanceRows(c).filter((r) => r && isPoint(r[0])).map((r) => r.map((v) => conv.rep.get(v) ?? ''));
    pr.patterns.push({ sketch: id, constraint: `${place.studio}/${id}#${index}`, pivot, count, rows });
  }
}

// The rows of an Onshape pattern: rows[i][j] is entity i of instance j (0 the seed).
export function instanceRows(c: any): string[][] {
  const rows: string[][] = [];
  for (const q of c.parameters) { const m = /^localInstance(\d+),(\d+)$/.exec(q.parameterId); if (m) (rows[+m[1]] ??= [])[+m[2]] = q.value; }
  return rows.filter(Boolean);
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
  const curveOnRegion = (cid: Id): boolean => {
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
    if (err > Math.max(0.02 * region.area, 0.05) || !r.ref.outerLoop.every(curveOnRegion) || !edges.every((e) => nearLoops(r.loops, e.m2))) continue;
    if (!best || err < best.err) best = { ref: r.ref, err };
  }
  return best?.ref;
}
