// An Onshape assembly as a document of trymesh: every instance is a feature placed where the
// assembly has it. A part of a studio of this document is an insertion of the converted studio
// (D62), a subassembly an insertion of its own converted document, a part of another document
// (standard content, a bought part) a stored mesh placed as a reference body (D55).
import { createHash } from 'node:crypto';
import type { Id } from '../../packages/engine/src/index';
import { importMesh } from '../../packages/engine/src/index';
import { type Input, type Report, exec, identity, invert, multiply, newEngine, placementOf, sane, transform } from './common';
import { type Overrides, type StudioResult, convertStudio } from './studio';

const hash = (v: unknown) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
// The same key as fetch.ts gives the STL of a part of another document.
const partKey = (i: any) => hash([i.documentId, i.documentVersion ?? i.documentMicroversion, i.elementId, i.partId, i.configuration ?? 'default']);

export class AssemblyConverter {
  private readonly asm: any;
  private readonly occurrences = new Map<string, number[][]>(); // path of instance IDs -> transform (mm)
  private readonly instances = new Map<string, any>();
  private readonly studios = new Map<string, StudioResult>();
  private readonly subassemblies = new Map<string, { document: any; name: string }>();

  constructor(private readonly input: Input, private readonly report: Report, private readonly overrides: Overrides) {
    this.asm = input.json('assembly.json');
    for (const o of this.asm.rootAssembly.occurrences) this.occurrences.set(o.path.join('/'), transform(o.transform));
    for (const i of [...this.asm.rootAssembly.instances, ...this.asm.subAssemblies.flatMap((s: any) => s.instances)]) this.instances.set(i.id, i);
  }

  async root(): Promise<any> {
    return (await this.convert([], this.asm.rootAssembly, this.input.meta.name)).document;
  }

  private async studio(eid: string): Promise<StudioResult> {
    if (!this.studios.has(eid)) this.studios.set(eid, await convertStudio(this.input, eid, this.report, this.overrides));
    return this.studios.get(eid)!;
  }

  // `path`: the instance IDs down to the assembly being converted ([] for the root). Positions are
  // taken relative to it: Onshape gives every occurrence in the frame of the root.
  private async convert(path: string[], def: any, name: string): Promise<{ document: any; name: string }> {
    const engine = await newEngine();
    const report = this.report;
    report.section(`Assembly ${name}`);
    for (const v of this.input.variables()) exec(engine, report, { type: 'setParameter', name: v.name, expr: v.expr }, `parameter ${v.name}`);
    const frame = path.length ? invert(this.occurrences.get(path.join('/'))!) : identity();
    const stored = new Set<Id>();
    const used = new Set<Id>();
    const featureId = (instanceName: string) => { let id = sane(instanceName); for (let n = 2; used.has(id); n++) id = `${sane(instanceName)}_${n}`; used.add(id); return id; };
    for (const i of def.instances) {
      if (i.suppressed) { report.note(`${i.name}: suppressed, left out`); continue; }
      const placement = { frame: { kind: 'base', plane: 'XY' }, ...placementOf(multiply(frame, this.occurrences.get([...path, i.id].join('/'))!)) };
      const id = featureId(i.name);
      if (i.type === 'Part' && i.documentId === this.input.meta.document) {
        const studio = await this.studio(i.elementId);
        const body = studio.bodies.get(i.partId);
        if (!body) { report.note(`${i.name}: the part has no body in the converted studio, left out`); continue; }
        const doc = `studio_${sane(this.input.elementName(i.elementId))}`;
        if (!stored.has(doc)) { exec(engine, report, { type: 'addDocument', id: doc, name: this.input.elementName(i.elementId), document: studio.document }, `document ${doc}`); stored.add(doc); }
        exec(engine, report, { type: 'addFeature', feature: { id, name: i.name, suppressed: false, type: 'insert', document: doc, placement, bodies: [body] } as any }, i.name);
      } else if (i.type === 'Part') {
        const key = partKey(i);
        const mesh = `mesh_${key}`;
        if (!stored.has(mesh)) {
          const out = importMesh('stl', this.input.bytes(`stl/${key}.stl`), { unit: 'mm' } as any, i.name.replace(/ <\d+>$/, ''));
          if (!out.ok) { report.note(`${i.name}: the mesh is refused: ${out.error.message.slice(0, 200)}`); continue; }
          exec(engine, report, { type: 'addMesh', id: mesh, mesh: out.mesh }, `mesh ${i.name}`);
          stored.add(mesh);
          if (out.report.triangles > 20000) report.note(`${i.name}: a mesh of ${out.report.triangles} triangles`);
        }
        exec(engine, report, { type: 'batch', commands: [
          { type: 'addFeature', feature: { id, name: i.name, suppressed: false, type: 'mesh', mesh, placement } as any },
          { type: 'setBodyProperties', body: id, patch: { name: i.name, use: 'reference' } },
        ] }, i.name);
      } else if (i.type === 'Assembly') {
        const sub = this.asm.subAssemblies.find((s: any) => s.documentId === i.documentId && s.elementId === i.elementId && (s.fullConfiguration ?? s.configuration) === (i.fullConfiguration ?? i.configuration));
        if (!sub) { report.note(`${i.name}: the subassembly is not in the download, left out`); continue; }
        const converted = await this.subassembly([...path, i.id], sub, i.name.replace(/ <\d+>$/, ''));
        const doc = `asm_${sane(converted.name)}_${converted.key.slice(0, 6)}`;
        if (!stored.has(doc)) { exec(engine, report, { type: 'addDocument', id: doc, name: converted.name, document: converted.document }, `document ${doc}`); stored.add(doc); }
        exec(engine, report, { type: 'addFeature', feature: { id, name: i.name, suppressed: false, type: 'insert', document: doc, placement } as any }, i.name);
      } else report.note(`${i.name}: an instance of the type ${i.type}, left out`);
    }
    const ev = engine.getState().evaluation;
    for (const [fid, r] of Object.entries(ev.features)) if (r.status !== 'ok') report.note(`feature ${fid}: ${r.status} ${r.error?.code ?? ''} ${r.error?.message?.slice(0, 200) ?? ''} ${r.warnings.map((w) => `${w.code}: ${w.message.slice(0, 120)}`).join('; ')}`);
    report.note(`${Object.keys(ev.bodies).length} bodies`);
    return { document: JSON.parse(engine.save()), name };
  }

  // A subassembly is converted once per layout. Onshape positions the parts of a subassembly that is
  // not rigid by the mates of the parent, so two instances of one subassembly may hold their parts
  // differently: those are two documents.
  private async subassembly(path: string[], def: any, name: string): Promise<{ document: any; name: string; key: string }> {
    const prefix = path.join('/') + '/';
    const frame = invert(this.occurrences.get(path.join('/'))!);
    const layout = [...this.occurrences].filter(([p]) => p.startsWith(prefix)).map(([p, t]) => [p.slice(prefix.length).split('/').map((x) => this.instances.get(x)?.name), multiply(frame, t).flat().map((v) => Math.round(v * 1e6) / 1e6)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const key = hash([def.documentId, def.elementId, def.configuration, layout]);
    if (!this.subassemblies.has(key)) this.subassemblies.set(key, await this.convert(path, def, name));
    return { ...this.subassemblies.get(key)!, key };
  }
}

