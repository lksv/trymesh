// Downloads what the converter needs from an Onshape document: the element the URL points to (an
// assembly or a part studio), the part studios it uses from the same document, the variable
// studios, the geometry behind the queries of the features (through FeatureScript), the volumes
// for the check, and an STL of every part that comes from another document.
//
//   node tools/onshape/fetch.ts <onshape url> <output folder>
//
// Needs ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY (API keys of the account), ONSHAPE_API
// (default https://cad.onshape.com). Only Node built-ins; Node 23.6+ runs the file as it is.
// A file that is already in the output folder is not downloaded again, so a run that stopped on the
// rate limit can be repeated.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/onshape/fetch.ts <onshape url> <output folder>');
  process.exit(2);
}
const API = process.env.ONSHAPE_API ?? 'https://cad.onshape.com';
const AUTH = 'Basic ' + Buffer.from(`${process.env.ONSHAPE_ACCESS_KEY}:${process.env.ONSHAPE_SECRET_KEY}`).toString('base64');
const m = /documents\/([0-9a-f]+)\/([wvm])\/([0-9a-f]+)\/e\/([0-9a-f]+)/.exec(url);
if (!m) throw new Error(`not an URL of an Onshape element: ${url}`);
const [, did, wvmKind, wvmId, eid] = m;
const WVM = `${wvmKind}/${wvmId}`;

// ---------------------------------------------------------------- requests

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Onshape answers 429 when a rate limit is reached; the FeatureScript endpoint has a budget of its
// own that runs out long before the others, and its cool-down can take tens of minutes.
// An export (STL) answers with a redirect to another host; fetch drops the Authorization header on
// such a redirect, so redirects are followed here, with the header.
async function request(path: string, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let target = API + path;
    let res: Response;
    for (let hops = 0; ; hops++) {
      res = await fetch(target, {
        method: init.method ?? 'GET',
        headers: { Authorization: AUTH, Accept: init.accept ?? 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location || hops > 5) break;
      target = new URL(location, target).toString();
    }
    if (res.status !== 429 || attempt >= 10) {
      if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
      return res;
    }
    const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 15_000 * (attempt + 1);
    console.error(`rate limit, waiting ${Math.round(wait / 1000)} s (${path.slice(0, 80)})`);
    await sleep(wait);
  }
}
const getJson = async (path: string) => (await request(path)).json();
function save(file: string, data: unknown) {
  mkdirSync(join(out, file, '..'), { recursive: true });
  writeFileSync(join(out, file), typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 1));
}
const have = (file: string) => existsSync(join(out, file));
async function cached(file: string, get: () => Promise<unknown>): Promise<any> {
  if (!have(file)) save(file, await get());
  return JSON.parse(readFileSync(join(out, file), 'utf8'));
}

// ---------------------------------------------------------------- FeatureScript

// A value of FeatureScript comes as a tree of typed nodes; this makes plain JSON of it.
function plain(v: any): any {
  const t: string = v?.btType ?? '';
  if (t.endsWith('BTFSValueArray')) return v.value.map(plain);
  if (t.endsWith('BTFSValueMap')) return Object.fromEntries(v.value.map((e: any) => [plain(e.key), plain(e.value)]));
  if (t.endsWith('BTFSValueWithUnits')) return v.value; // SI units: metres, square metres
  if (t.endsWith('BTFSValueUndefined')) return null;
  return v?.value;
}
async function evalFs(studio: string, script: string, rollback?: number): Promise<any> {
  const q = rollback === undefined ? '' : `?rollbackBarIndex=${rollback}`;
  const res = await (await request(`/api/v10/partstudios/d/${did}/${WVM}/e/${studio}/featurescript${q}`, { method: 'POST', body: { script, queries: {} } })).json();
  for (const n of res.notices ?? []) if (n.level === 'ERROR') throw new Error(`FeatureScript: ${n.message}`);
  return plain(res.result);
}

// For every deterministic ID: what it is and its geometry in millimetres (a face: area, plane,
// boundary edges; an edge: curve and ends; a body: its owner). For every feature: the bodies and
// faces it created (a region of a sketch is a face created by the sketch). The final bodies with
// their bounds.
const DUMP = String.raw`
function(context is Context, queries) {
  var mm = function(v) { return v / millimeter; };
  var curve = function(e) {
    var c = evCurveDefinition(context, { "edge" : e });
    var ends = evEdgeTangentLines(context, { "edge" : e, "parameters" : [0, 0.5, 1] });
    var x = { "id" : transientQueriesToStrings(e), "a" : mm(ends[0].origin), "m" : mm(ends[1].origin), "b" : mm(ends[2].origin) };
    if (c is Circle) { x.curve = "circle"; x.center = mm(c.coordSystem.origin); x.radius = mm(c.radius); x.axis = c.coordSystem.zAxis; }
    else if (c is Line) { x.curve = "line"; } else { x.curve = "other"; }
    return x;
  };
  var out = {};
  for (var id in IDS) {
    var q = qTransient(id);
    if (size(evaluateQuery(context, q)) == 0) { out[id] = { "missing" : true }; continue; }
    var r = {};
    var faces = evaluateQuery(context, qEntityFilter(q, EntityType.FACE));
    var edges = evaluateQuery(context, qEntityFilter(q, EntityType.EDGE));
    if (size(evaluateQuery(context, qEntityFilter(q, EntityType.BODY))) > 0) { r.kind = "body"; }
    if (size(edges) > 0) { r = curve(edges[0]); r.kind = "edge"; r.owner = transientQueriesToStrings(evaluateQuery(context, qOwnerBody(edges[0]))); }
    if (size(faces) > 0) {
      var f = faces[0];
      r.kind = "face";
      r.sketch = !isQueryEmpty(context, qSketchFilter(f, SketchObject.YES));
      r.area = evArea(context, { "entities" : f }) / (millimeter * millimeter);
      r.owner = transientQueriesToStrings(evaluateQuery(context, qOwnerBody(f)));
      try silent { var p = evPlane(context, { "face" : f }); r.plane = { "origin" : mm(p.origin), "normal" : p.normal }; }
      var es = [];
      for (var e in evaluateQuery(context, qAdjacent(f, AdjacencyType.EDGE, EntityType.EDGE))) { es = append(es, curve(e)); }
      r.edges = es;
    }
    out[id] = r;
  }
  var created = {};
  for (var fid in FEATURES) {
    created[fid] = { "bodies" : transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId(fid), EntityType.BODY))),
                     "faces" : transientQueriesToStrings(evaluateQuery(context, qCreatedBy(makeId(fid), EntityType.FACE))) };
  }
  var parts = {};
  for (var b in evaluateQuery(context, qAllModifiableSolidBodies())) {
    var bb = evBox3d(context, { "topology" : b });
    parts[transientQueriesToStrings(b)] = { "min" : mm(bb.minCorner), "max" : mm(bb.maxCorner) };
  }
  return { "ids" : out, "created" : created, "parts" : parts };
}`;
const dumpScript = (ids: string[], features: string[]) => DUMP.replace('IDS', JSON.stringify(ids)).replace('FEATURES', JSON.stringify(features));
const queryIds = (f: any): string[] =>
  (f.parameters ?? []).filter((p: any) => p.btType.startsWith('BTMParameterQueryList') && p.parameterId !== 'parts').flatMap((p: any) => p.queries.flatMap((q: any) => q.deterministicIds ?? []));

// One call at the end of the timeline answers most IDs. An ID that a later feature consumed (the
// cap face an extrusion starts from, an edge a chamfer removed) is missing there and is asked again
// with the timeline rolled back to just before its feature: one call per such feature.
async function dump(studio: string, features: any[]) {
  const all = [...new Set(features.flatMap(queryIds))];
  const res = await evalFs(studio, dumpScript(all, features.map((f) => f.featureId)));
  const at: Record<string, any> = {};
  for (const [i, f] of features.entries()) {
    const ids = queryIds(f);
    if (!ids.length) continue;
    if (ids.every((id) => !res.ids[id]?.missing)) { at[f.featureId] = { ids: Object.fromEntries(ids.map((id) => [id, res.ids[id]])) }; continue; }
    const r = await evalFs(studio, dumpScript(ids, []), i);
    at[f.featureId] = { ids: r.ids, parts: r.parts };
  }
  return { created: res.created, parts: res.parts, at };
}

// ---------------------------------------------------------------- the document

const elements: any[] = await cached('elements.json', () => getJson(`/api/v10/documents/d/${did}/${WVM}/elements`));
const root = elements.find((e) => e.id === eid);
if (!root) throw new Error(`the document has no element ${eid}`);
save('meta.json', { url, document: did, wvm: WVM, element: eid, name: root.name, type: root.elementType, fetched: new Date().toISOString() });

const studios = new Set<string>();
const external = new Map<string, any>(); // key -> part instance of another document
const partKey = (i: any) => createHash('sha1').update(JSON.stringify([i.documentId, i.documentVersion ?? i.documentMicroversion, i.elementId, i.partId, i.configuration ?? 'default'])).digest('hex').slice(0, 12);
if (root.elementType === 'ASSEMBLY') {
  const asm = await cached('assembly.json', () => getJson(`/api/v10/assemblies/d/${did}/${WVM}/e/${eid}?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false`));
  for (const i of [...asm.rootAssembly.instances, ...asm.subAssemblies.flatMap((s: any) => s.instances)]) {
    if (i.type !== 'Part' || i.suppressed) continue;
    if (i.documentId === did) studios.add(i.elementId);
    else external.set(partKey(i), i);
  }
} else if (root.elementType === 'PARTSTUDIO') studios.add(eid);
else throw new Error(`the element is a ${root.elementType}; an assembly or a part studio is expected`);

// variable studios: their variables become parameters
for (const e of elements.filter((e) => e.elementType === 'VARIABLESTUDIO')) await cached(`variables/${e.id}.json`, () => getJson(`/api/v10/variables/d/${did}/${WVM}/e/${e.id}/variables`));

// part studios, with the studios they derive from (`importDerived`; namespace `e<element>::m<microversion>`)
const queue = [...studios];
while (queue.length) {
  const s = queue.shift()!;
  const features = (await cached(`studios/${s}/features.json`, () => getJson(`/api/v10/partstudios/d/${did}/${WVM}/e/${s}/features`))).features as any[];
  for (const f of features.filter((f) => f.featureType === 'importDerived')) {
    const ns: string = f.parameters.find((p: any) => p.parameterId === 'buildFunction')?.namespace ?? '';
    const src = /^e([0-9a-f]+)::/.exec(ns)?.[1];
    if (src && !studios.has(src)) { studios.add(src); queue.push(src); }
    if (!src) console.error(`${s}: ${f.name} derives from another document (${ns}); not supported`);
  }
}
for (const s of studios) {
  const name = elements.find((e) => e.id === s)?.name;
  console.error(`part studio ${name}`);
  const features = (await cached(`studios/${s}/features.json`, () => getJson(`/api/v10/partstudios/d/${did}/${WVM}/e/${s}/features`))).features as any[];
  await cached(`studios/${s}/sketches.json`, () => getJson(`/api/v10/partstudios/d/${did}/${WVM}/e/${s}/sketches?includeGeometry=true`));
  await cached(`studios/${s}/parts.json`, () => getJson(`/api/v10/parts/d/${did}/${WVM}/e/${s}`));
  await cached(`studios/${s}/mass.json`, () => getJson(`/api/v10/partstudios/d/${did}/${WVM}/e/${s}/massproperties?massAsGroup=false&useMassPropertyOverrides=false`));
  await cached(`studios/${s}/fs.json`, () => dump(s, features));
}

// parts of other documents (standard content, bought parts): an STL each, in the frame of its studio
for (const [key, i] of external) {
  if (have(`stl/${key}.stl`)) continue;
  const v = i.documentVersion ? `v/${i.documentVersion}` : `m/${i.documentMicroversion}`;
  const q = new URLSearchParams({ units: 'millimeter', mode: 'binary', configuration: i.configuration ?? 'default', linkDocumentId: did });
  const res = await request(`/api/v10/parts/d/${i.documentId}/${v}/e/${i.elementId}/partid/${encodeURIComponent(i.partId)}/stl?${q}`, { accept: 'application/vnd.onshape.v1+octet-stream' });
  save(`stl/${key}.stl`, new Uint8Array(await res.arrayBuffer()));
  console.error(`stl ${i.name}`);
}
console.error(`done: ${studios.size} part studios, ${external.size} parts of other documents`);
