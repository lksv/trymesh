// An Onshape part studio as a document of trymesh, in the frame of the studio: sketches, extrusions,
// chamfers and fillets; derived sketches are copied in. The document says which of its bodies is
// which Onshape part, for the insertions of the assembly.
import type { Engine, EdgeName, Id, PlaneRef, RegionRef } from '../../packages/engine/src/index';
import { type Input, type Report, type V3, dot, exec, expression, near, newEngine, numberOr, sane, sub } from './common';
import { type FaceCandidate, type OnshapeFace, extentFor, faceOf } from './extent-start';
import { type Converted, convertSketch, matchRegion, sketchFrame } from './sketch';

// A hook that converts one Onshape feature in place of the converter (`overrides/`), by the name of
// the studio and of the feature. It returns false to leave the feature to the converter.
export type Override = (ctx: FeatureContext) => boolean | void;
export type Overrides = Record<string, Record<string, Override>>;
export interface FeatureContext {
  engine: Engine;
  report: Report;
  feature: any; // the Onshape feature
  id: Id; // the ID the converter would give its first trymesh feature
  sketches: Map<string, Converted>; // by the ID of the Onshape feature that made the sketch
  bodies: Map<string, Id>; // Onshape body (part ID) -> trymesh body
  dump: any; // what fetch.ts evaluated for the studio (`created`, `at`, `parts`)
  planeOf: (frame: ReturnType<typeof sketchFrame> & object) => PlaneRef;
}

export interface StudioResult {
  document: any; // the document as a file holds it
  bodies: Map<string, Id>; // Onshape part ID -> body
  names: Map<string, string>; // Onshape part ID -> name of the part
}

export async function convertStudio(input: Input, eid: string, report: Report, overrides: Overrides = {}): Promise<StudioResult> {
  const studioName = input.elementName(eid);
  report.section(`Part studio ${studioName}`);
  const engine = await newEngine();
  const features = input.json(`studios/${eid}/features.json`).features as any[];
  const sketchesOf = (s: string) => input.json(`studios/${s}/sketches.json`).sketches as any[];
  const dump = input.json(`studios/${eid}/fs.json`);
  const parts = input.json(`studios/${eid}/parts.json`) as any[];
  for (const v of input.variables()) exec(engine, report, { type: 'setParameter', name: v.name, expr: v.expr }, `parameter ${v.name}`);

  // planes: a base plane, or a plane feature offset from one (one per offset)
  const planes = new Map<string, PlaneRef>();
  const planeOf = (f: NonNullable<ReturnType<typeof sketchFrame>>): PlaneRef => {
    if (Math.abs(f.offset) < 1e-9) return { kind: 'base', plane: f.base.plane };
    const key = `${f.base.plane}:${f.offset.toFixed(6)}`;
    if (!planes.has(key)) {
      const id = `plane_${f.base.plane}_${String(Math.round(f.offset * 1000) / 1000).replace('-', 'm').replace('.', '_')}`;
      exec(engine, report, { type: 'addFeature', feature: { id, name: `${f.base.plane} ${f.offset}`, suppressed: false, type: 'plane', base: { kind: 'base', plane: f.base.plane }, offset: f.offset } as any }, `plane ${key}`);
      planes.set(key, { kind: 'plane', feature: id });
    }
    return planes.get(key)!;
  };
  const sketches = new Map<string, Converted>(); // Onshape feature that created the regions -> sketch
  const bodies = new Map<string, Id>();
  const made = new Map<string, Id[]>(); // Onshape extrusion -> the trymesh extrusions made for it
  const starts = { from: 0, number: 0 }; // starts at a face: written as `from`, as a number (D66)
  const owner = (face: string) => Object.entries(dump.created as Record<string, any>).find(([, v]) => v.faces.includes(face))?.[0];
  const sketchFrom = (fid: Id, id: Id, name: string, f: any, geom: any, by: string) => {
    const frame = sketchFrame(geom.sketchMatrix);
    if (!frame) { report.note(`${name}: the sketch plane is not parallel to a base plane, left out`); return; }
    const conv = convertSketch(engine, report, id, name, planeOf(frame), frame, f, geom);
    if (conv) sketches.set(by, conv);
  };

  for (const f of features) {
    const P = Object.fromEntries((f.parameters ?? []).map((p: any) => [p.parameterId, p]));
    const val = (k: string) => P[k]?.value;
    const num = (k: string) => { const e = expression(P[k]?.expression); return e === undefined ? undefined : numberOr(e); };
    const name = `${f.name}`;
    const id = sane(f.name);
    const hook = overrides[studioName]?.[f.name];
    if (hook && hook({ engine, report, feature: f, id, sketches, bodies, dump, planeOf: planeOf as any }) !== false) continue;
    if (f.suppressed) { report.note(`${name}: suppressed in Onshape, left out`); continue; }
    switch (f.featureType) {
      case 'newSketch':
        sketchFrom(f.featureId, id, name, f, sketchesOf(eid).find((s) => s.featureId === f.featureId), f.featureId);
        break;
      case 'importDerived': {
        // the sketches of another studio of the document: copied in (inserting a document, D62,
        // brings bodies, not sketches; a sketch projected from another one is step 6)
        const ns: string = P.buildFunction?.namespace ?? '';
        const src = /^e([0-9a-f]+)::/.exec(ns)?.[1];
        const from = (P.parts.queries as any[]).map((q) => /qCreatedBy\(id \+ "([^"]+)"/.exec(q.queryString ?? '')?.[1]).filter(Boolean) as string[];
        if (!src) { report.note(`${name}: derived from another document, left out`); break; }
        const srcFeatures = input.json(`studios/${src}/features.json`).features as any[];
        for (const sf of srcFeatures.filter((g) => from.includes(g.featureId))) {
          if (sf.featureType !== 'newSketch') { report.note(`${name}: derives the bodies of "${sf.name}"; only sketches are taken`); continue; }
          sketchFrom(f.featureId, `${id}_${sane(sf.name)}`, `${name} (${input.elementName(src)}: ${sf.name})`, sf, sketchesOf(src).find((s) => s.featureId === sf.featureId), f.featureId);
        }
        report.note(`${name}: sketches derived from "${input.elementName(src)}" copied in`);
        break;
      }
      case 'extrude':
        extrude(f, P, val, num, name, id);
        break;
      case 'chamfer':
      case 'fillet':
        edgeBlend(f, P, num, name, id);
        break;
      default:
        report.note(`${name}: ${f.featureType} has no counterpart, left out`);
    }
  }

  function extrude(f: any, P: any, val: (k: string) => any, num: (k: string) => number | string | undefined, name: string, id: Id) {
    const at = dump.at[f.featureId];
    const regionIds: string[] = (P.entities.queries as any[]).flatMap((q) => q.deterministicIds ?? []);
    if (val('bodyType') && val('bodyType') !== 'SOLID') { report.note(`${name}: a ${val('bodyType')} extrusion, left out`); return; }
    // regions by sketch
    const bySketch = new Map<Converted, RegionRef[]>();
    for (const r of regionIds) {
      const e = at.ids[r];
      const conv = sketches.get(owner(r) ?? '');
      if (!conv || e?.kind !== 'face' || !e.sketch) { report.note(`${name}: region ${r} is not a region of a converted sketch (a face of a body as a profile is not converted)`); continue; }
      const ref = matchRegion(engine, conv, e);
      if (!ref) { report.note(`${name}: region ${r} (${e.area.toFixed(2)} mm²) has no counterpart${e.edges.some((x: any) => x.curve === 'other') ? ' (bounded by a spline)' : ''}`); continue; }
      if (!bySketch.has(conv)) bySketch.set(conv, []);
      const list = bySketch.get(conv)!;
      if (!list.some((x) => x.outerLoop.join() === ref.outerLoop.join())) list.push(ref);
    }
    if (!bySketch.size) { report.note(`${name}: no region converted, left out`); return; }
    // the extent along the normal of the Onshape sketch, from the sketch plane
    const frame = [...bySketch.keys()][0].frame;
    const along = (p: V3) => dot(sub(p, frame.origin), frame.normal);
    let start = 0;
    let startEntity: any; // the Onshape face the extrusion starts at
    if (val('startOffset')) {
      if (val('startOffsetBound') === 'ENTITY') {
        const e = at.ids[P.startOffsetEntity.queries[0].deterministicIds[0]];
        start = along(e.plane?.origin ?? e.a);
        startEntity = { id: P.startOffsetEntity.queries[0].deterministicIds[0], e };
      } else start = (val('startOffsetOppositeDirection') ? -1 : 1) * Number(num('startOffsetDistance'));
    }
    const dir = val('oppositeDirection') ? -1 : 1;
    const depth = num('depth');
    const s = frame.sign;
    const symmetric = !!val('symmetric');
    // A symmetric "through all" goes to both sides of any start, which are all of the targets: no
    // start at all, whatever kind of start it has (both sides from a plane are refused, and one side
    // would lose half of the cut).
    const bothSides = val('endBound') === 'THROUGH_ALL' && symmetric;
    if (bothSides && start !== 0) report.note(`${name}: through all to both sides from a start: both sides of any start are all of the targets, the start is dropped`);
    // The start at a face (D66): the face by its provenance, the plane of `from`; a number when it is
    // not found (the offset of the face from the sketch).
    let from: PlaneRef | undefined;
    if (startEntity && !bothSides) {
      const found = trymeshFace(startEntity.id, startEntity.e);
      if ('ref' in found) {
        from = found.ref;
        if (found.note) report.note(`${name}: the face it starts at: ${found.note}`);
      } else report.note(`${name}: starts at a face, converted to the offset ${start.toFixed(3)} mm (${found.reason})`);
    }
    // The end of upTo at a face by the same lookup (the gap of D47 that 2h closes in passing): only
    // without an offset from the face, whose sense the converter does not map.
    let endFace: PlaneRef | undefined;
    let endLevel = 0; // the end at a face: its offset from the sketch less the gap
    // the extent with the start plane and the end plane it may use
    const extentOf = (useFrom: boolean, useEnd: boolean): any =>
      extentFor({
        endBound: val('endBound') === 'BLIND' || val('endBound') === 'THROUGH_ALL' ? val('endBound') : 'UP_TO',
        symmetric,
        dir,
        s,
        start: bothSides ? 0 : start,
        depth,
        from: useFrom ? from : undefined,
        end: { plane: useEnd ? endFace : undefined, level: endLevel },
        startPlane: () => planeOf({ ...frame, offset: frame.offset + s * start }),
      });
    switch (val('endBound')) {
      case 'BLIND':
        break;
      case 'THROUGH_ALL':
        if (!bothSides && !from && start !== 0) report.note(`${name}: through all from an offset start: from a plane feature at the start`);
        break;
      case 'UP_TO_SURFACE':
      case 'UP_TO_FACE':
      case 'UP_TO_PART': {
        const did = P.endBoundEntityFace.queries[0]?.deterministicIds?.[0];
        const e = at.ids[did];
        if (!e?.plane) { report.note(`${name}: up to a face that is not planar, left out`); return; }
        const gap = val('hasOffset') ? (val('offsetOppositeDirection') ? -1 : 1) * Number(num('offsetDistance')) : 0;
        endLevel = along(e.plane.origin) - gap;
        const found = gap === 0 ? trymeshFace(did, e) : { reason: 'an offset from the face is not converted' };
        if ('ref' in found) endFace = found.ref;
        else report.note(`${name}: up to a face, converted to the length ${(along(e.plane.origin) - start - gap).toFixed(3)} mm (${found.reason})`);
        break;
      }
      default:
        report.note(`${name}: the end ${val('endBound')} is not converted, left out`);
        return;
    }
    if (val('hasSecondDirection')) report.note(`${name}: the second direction is left out`);
    if (val('hasDraft')) report.note(`${name}: a draft (trymesh has a taper, D45, not converted here) left out`);
    const op = val('operationType');
    const scope: string[] = (P.booleanScope?.queries ?? []).flatMap((q: any) => q.deterministicIds ?? []);
    const targets = (val('defaultScope') ? [...new Set(bodies.values())] : scope.map((b) => bodies.get(b))).filter((b): b is Id => !!b);
    const operation = op === 'NEW' || (op === 'ADD' && !targets.length) ? 'new' : op === 'ADD' ? 'add' : op === 'REMOVE' ? 'cut' : undefined;
    if (!operation) { report.note(`${name}: the operation ${op} is not converted, left out`); return; }
    if (operation === 'cut' && !targets.length) { report.note(`${name}: a cut of no converted body, left out`); return; }
    if (operation === 'add' && targets.length > 1) report.note(`${name}: adds to ${targets.length} bodies; trymesh adds to one, the first is taken`);
    const created: string[] = dump.created[f.featureId]?.bodies ?? [];
    const featureOf = (gid: Id, featureName: string, conv: Converted, regions: RegionRef[], extent: any) => ({ id: gid, name: featureName, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: conv.id, regions }, extent, operation, ...(operation === 'new' ? {} : { targets: operation === 'add' ? targets.slice(0, 1) : targets }) });
    // Eligibility: a preview of the first feature with the start and the end planes; a plane the
    // extent cannot use (tilted, gone, not planar) gives way to the number.
    let [useFrom, useEnd] = [from !== undefined, endFace !== undefined];
    if (useFrom || useEnd) {
      const [conv, refs] = [...bySketch][0];
      const refused = (extent: any) => {
        const r = engine.preview({ type: 'addFeature', feature: featureOf(`${id}_probe`, name, conv, refs, extent) as any });
        const e = r.ok ? r.state.evaluation.features[`${id}_probe`]?.error : undefined;
        return e && ['invalidExtent', 'brokenReference', 'nonPlanarFace'].includes(e.code) ? e : undefined;
      };
      const problem = refused(extentOf(useFrom, useEnd));
      if (problem) {
        // the plane the error names; without `from` in its refs it is the end
        const which = useFrom && (!useEnd || JSON.stringify(problem.refs ?? []) === JSON.stringify([from])) ? 'start' : 'end';
        if (which === 'start') useFrom = false;
        else useEnd = false;
        report.note(`${name}: the ${which} at a face is refused (${problem.code}: ${problem.message.slice(0, 160)}), written as a number`);
        if (refused(extentOf(useFrom, useEnd))) [useFrom, useEnd] = [false, false];
      }
    }
    if (startEntity && !bothSides) {
      if (useFrom) starts.from++;
      else {
        starts.number++;
        if (from) report.note(`${name}: starts at a face, converted to the offset ${start.toFixed(3)} mm`);
      }
    }
    if (endFace && !useEnd) report.note(`${name}: up to a face, converted to a length`);
    const extent = extentOf(useFrom, useEnd);
    let k = 0;
    for (const [conv, refs] of bySketch) {
      const fid = bySketch.size === 1 ? id : `${id}_${k++}`;
      // One extrusion of Onshape with the operation new makes a part of every separate piece; trymesh
      // makes one body: an extrusion per group of touching regions, matched to the parts by bounds.
      const groups = operation === 'new' && created.length > 1 ? groupsOf(conv, refs) : [{ refs, centre: undefined }];
      for (const [j, g] of groups.entries()) {
        const gid = groups.length === 1 ? fid : `${fid}_${j + 1}`;
        const feature = featureOf(gid, groups.length === 1 ? f.name : `${f.name} (${j + 1})`, conv, g.refs, extent);
        if (!exec(engine, report, { type: 'addFeature', feature: feature as any }, name)) continue;
        made.set(f.featureId, [...(made.get(f.featureId) ?? []), gid]);
        const r = engine.getState().evaluation.features[gid];
        if (r.status !== 'ok') report.note(`${name}: ${r.status} ${r.error?.code ?? ''} ${r.error?.message?.slice(0, 200) ?? ''} ${r.warnings.map((w) => w.code).join(', ')}`);
        if (operation !== 'new') continue;
        if (groups.length === 1) for (const b of created) bodies.set(b, gid);
        else {
          const c = g.centre!;
          const hit = created.find((b) => { const bb = dump.parts[b]; return bb && c.every((v, a) => v > bb.min[a] - 1e-3 && v < bb.max[a] + 1e-3 || Math.abs(frame.normal[a]) > 0.5); });
          if (hit) bodies.set(hit, gid);
        }
      }
      if (groups.length > 1) report.note(`${name}: made ${created.length} parts in Onshape; ${groups.length} extrusions here`);
    }
    // the profile area as a check of the matching
    const os = regionIds.reduce((a, r) => a + (at.ids[r]?.area ?? 0), 0);
    let ts = 0;
    for (const [conv, refs] of bySketch) for (const ref of refs) ts += regionAreaOf(conv.id, ref);
    if (Math.abs(os - ts) > 0.01 * os) report.note(`${name}: the area of the profile differs: Onshape ${os.toFixed(2)} mm², here ${ts.toFixed(2)} mm²`);
  }

  // The trymesh face that is an Onshape face (D66): by the Onshape feature that created it (its
  // provenance, from the dump) among the faces of the trymesh extrusions made for that feature, in
  // the state before the feature being converted.
  function trymeshFace(did: string, e: any): { ref: PlaneRef; note?: string } | { reason: string } {
    if (e?.kind !== 'face' || !e.plane) return { reason: 'the entity is not a planar face' };
    const creator = owner(did);
    if (!creator) return { reason: 'the face is created by no feature at the end of the timeline' };
    const ids = made.get(creator);
    if (!ids?.length) return { reason: 'the feature that created it was not converted to an extrusion' };
    const candidates: FaceCandidate[] = [];
    for (const body of Object.keys(engine.getState().evaluation.bodies)) {
      const answer = engine.query('body', { body });
      if (!answer.ok) continue;
      for (const face of answer.result.faces) if (face.surface.kind === 'plane' && face.meshNormal) candidates.push({ body, name: face.name, origin: face.surface.origin as V3, normal: face.surface.normal as V3, meshNormal: face.meshNormal as V3 });
    }
    return faceOf(candidates, { origin: e.plane.origin, normal: e.plane.normal } as OnshapeFace, ids);
  }

  function regionAreaOf(sketch: Id, ref: RegionRef): number {
    const r = engine.getState().evaluation.features[sketch].sketch!.regions.find((x) => x.ref.outerLoop.join() === ref.outerLoop.join())!;
    return r.loops.reduce((s, l, i) => { let a = 0; for (let q = 0; q < l.length; q += 2) { const w = (q + 2) % l.length; a += l[q] * l[w + 1] - l[w] * l[q + 1]; } return s + (i === 0 ? 1 : -1) * Math.abs(a / 2); }, 0);
  }

  // regions whose bounds touch are one piece; the centre is in the model, for the bounds of the parts
  function groupsOf(conv: Converted, refs: RegionRef[]): { refs: RegionRef[]; centre: V3 }[] {
    const res = engine.getState().evaluation.features[conv.id].sketch!;
    const boxes = refs.map((ref) => {
      const l = res.regions.find((x) => x.ref.outerLoop.join() === ref.outerLoop.join())!.loops[0];
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < l.length; i += 2) { x0 = Math.min(x0, l[i]); x1 = Math.max(x1, l[i]); y0 = Math.min(y0, l[i + 1]); y1 = Math.max(y1, l[i + 1]); }
      return [x0, y0, x1, y1];
    });
    const parent = refs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < refs.length; i++) for (let j = i + 1; j < refs.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a[0] <= b[2] + 1e-6 && b[0] <= a[2] + 1e-6 && a[1] <= b[3] + 1e-6 && b[1] <= a[3] + 1e-6) parent[find(i)] = find(j);
    }
    const groups = new Map<number, number[]>();
    refs.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); });
    const { base, offset } = conv.frame;
    return [...groups.values()].map((g) => {
      const u = (Math.min(...g.map((i) => boxes[i][0])) + Math.max(...g.map((i) => boxes[i][2]))) / 2;
      const v = (Math.min(...g.map((i) => boxes[i][1])) + Math.max(...g.map((i) => boxes[i][3]))) / 2;
      const centre = [0, 1, 2].map((a) => u * base.x[a] + v * base.y[a] + offset * base.normal[a]) as V3;
      return { refs: g.map((i) => refs[i]), centre };
    });
  }

  // Chamfers and fillets of edges (D63). The Onshape edges are found among the edges of the trymesh
  // body by their geometry (a line by its ends, a circle by its centre and radius); a feature per body.
  // When the whole set is refused, each edge is tried alone, and what passes stays.
  function edgeBlend(f: any, P: any, num: (k: string) => number | string | undefined, name: string, id: Id) {
    const at = dump.at[f.featureId];
    const isChamfer = f.featureType === 'chamfer';
    if (isChamfer && P.chamferType?.value !== 'EQUAL_OFFSETS') { report.note(`${name}: chamfer ${P.chamferType?.value} (trymesh has one distance), left out`); return; }
    if (!isChamfer && (P.filletType?.value ?? 'CIRCULAR') !== 'CIRCULAR') report.note(`${name}: fillet ${P.filletType?.value} taken as circular`);
    const size = isChamfer ? num('width') : num('radius');
    const byBody = new Map<Id, EdgeName[]>();
    let missed = 0;
    for (const q of P.entities.queries as any[])
      for (const did of q.deterministicIds ?? []) {
        const e = at.ids[did];
        const body = e?.owner?.map((o: string) => bodies.get(o)).find(Boolean);
        if (e?.kind !== 'edge' || !body) { missed++; continue; }
        const st = engine.query('body', { body });
        if (!st.ok) { missed++; continue; }
        const found = st.result.edges.filter((x) => {
          if (x.kind === 'line' && e.curve === 'line') {
            const d = sub(x.to as V3, x.from as V3), L = Math.hypot(...d);
            const off = (p: V3) => Math.hypot(...sub(sub(p, x.from as V3), d.map((v) => (v * dot(sub(p, x.from as V3), d)) / (L * L)) as V3));
            const m: V3 = e.m ?? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
            const t = dot(sub(m, x.from as V3), d) / (L * L);
            return off(e.a) < 1e-3 && off(e.b) < 1e-3 && t > -1e-6 && t < 1 + 1e-6;
          }
          if (x.kind === 'circle' && e.curve === 'circle') return near(x.circle.center as V3, e.center) && Math.abs(x.circle.radius - e.radius) < 1e-3 && Math.abs(Math.abs(dot(x.circle.axis as V3, e.axis)) - 1) < 1e-6;
          return false;
        });
        if (!found.length) { missed++; continue; }
        if (!byBody.has(body)) byBody.set(body, []);
        const list = byBody.get(body)!;
        for (const x of found) if (!list.some((y) => JSON.stringify(y) === JSON.stringify(x.name))) list.push(x.name);
      }
    if (missed) report.note(`${name}: ${missed} edge(s) not found on the converted bodies (an edge of a spline, of a body not converted)`);
    let k = 0;
    for (const [body, edges] of byBody) {
      const make = (fid: Id, list: EdgeName[]) => ({ id: fid, name: f.name, suppressed: false, type: f.featureType, body, edges: list, ...(isChamfer ? { distance: size } : { radius: size }) }) as any;
      const fid = byBody.size === 1 ? id : `${id}_${k++}`;
      const ok = (fid2: Id) => engine.getState().evaluation.features[fid2]?.status === 'ok';
      if (exec(engine, report, { type: 'addFeature', feature: make(fid, edges) }, name) && ok(fid)) { report.note(`${name}: ${edges.length} edge(s) of ${body}`); continue; }
      const why = engine.getState().evaluation.features[fid]?.error;
      engine.execute({ type: 'removeFeature', id: fid });
      let kept = 0;
      const reasons = new Set<string>();
      edges.forEach((edge, j) => {
        const one = `${fid}_e${j + 1}`;
        if (exec(engine, report, { type: 'addFeature', feature: make(one, [edge]) }, name) && ok(one)) kept++;
        else { const e = engine.getState().evaluation.features[one]?.error; if (e) reasons.add(`${e.code}: ${e.message}`); engine.execute({ type: 'removeFeature', id: one }); }
      });
      report.note(`${name}: refused as one feature (${why?.code}); ${kept} of ${edges.length} edge(s) kept one by one${reasons.size ? '; why: ' + [...reasons].slice(0, 3).join(' | ') : ''}`);
    }
  }

  // names of the parts, and the check of the volume against Onshape
  const mass = input.json(`studios/${eid}/mass.json`).bodies ?? {};
  const names = new Map<string, string>();
  const ev = engine.getState().evaluation;
  for (const p of parts) {
    names.set(p.partId, p.name);
    const b = bodies.get(p.partId);
    if (!b || !ev.bodies[b]) { report.note(`part "${p.name}": no body`); bodies.delete(p.partId); continue; }
    exec(engine, report, { type: 'setBodyProperties', body: b, patch: { name: p.name, use: 'part' } }, `name of ${p.name}`);
    const ov = (mass[p.partId]?.volume?.[0] ?? NaN) * 1e9;
    const tv = (engine.getState().evaluation.bodies[b] as any).volume as number;
    report.note(`part "${p.name}" = ${b}: volume ${tv.toFixed(1)} mm³, Onshape ${ov.toFixed(1)} mm³ (${(((tv - ov) / ov) * 100).toFixed(2)} %)`);
  }
  for (const [fid, r] of Object.entries(engine.getState().evaluation.features)) if (r.status === 'error') report.note(`feature ${fid}: error ${r.error?.code} ${r.error?.message?.slice(0, 200)}`);
  if (starts.from + starts.number) report.note(`starts at a face (D66): ${starts.from} written as \`from\`, ${starts.number} as numbers`);
  return { document: JSON.parse(engine.save()), bodies, names };
}
