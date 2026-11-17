// Converts what fetch.ts downloaded into one document of trymesh, with a report.
//
//   ONSHAPE_IN=<folder of fetch.ts> [ONSHAPE_OUT=<folder>] [ONSHAPE_OVERRIDES=<module>] \
//     npx vitest run --config tools/onshape/vitest.config.ts
//
// Writes <out>/<name>.json (the document; the studios and subassemblies are stored inside it and
// inserted), <out>/report.md (what was converted, how, what was left out, the volumes against
// Onshape) and <out>/section-xz.svg (the model cut by the plane XZ, for a look).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { AssemblyConverter } from './assembly';
import { Input, Report, newEngine, sane } from './common';
import { type Overrides, convertStudio } from './studio';

test('convert', async () => {
  const dir = process.env.ONSHAPE_IN;
  if (!dir) throw new Error('ONSHAPE_IN: the folder fetch.ts wrote');
  const input = new Input(resolve(dir));
  const out = resolve(process.env.ONSHAPE_OUT ?? join(dir, 'trymesh'));
  const overrides: Overrides = process.env.ONSHAPE_OVERRIDES ? (await import(resolve(process.env.ONSHAPE_OVERRIDES))).default : {};
  const report = new Report();
  const meta = input.meta;
  report.lines.push(`# ${meta.name}`, '', `Converted from ${meta.url} (downloaded ${meta.fetched}).`);
  const document = meta.type === 'ASSEMBLY' ? await new AssemblyConverter(input, report, overrides).root() : (await convertStudio(input, meta.element, report, overrides)).document;
  mkdirSync(out, { recursive: true });
  const file = join(out, `${sane(meta.name)}.json`);
  writeFileSync(file, JSON.stringify(document));

  // the document as a fresh engine loads it, and a section for a look
  const engine = await newEngine();
  const loaded = engine.load(JSON.stringify(document));
  report.section('Result');
  if (!loaded.ok) report.note(`the document does not load: ${loaded.error.message}`);
  else {
    const ev = engine.getState().evaluation;
    report.note(`${Object.keys(ev.bodies).length} bodies, ${document.features.length} features at the top, ${Object.keys(document.documents ?? {}).length} stored documents, ${Object.keys(document.meshes ?? {}).length} stored meshes`);
    for (const [id, r] of Object.entries(ev.features)) if (r.status !== 'ok') report.note(`${id}: ${r.status} ${r.error?.code ?? ''} ${r.warnings.map((w) => w.code).join(', ')}`);
    const svg = engine.export('svg', { plane: { kind: 'base', plane: 'XZ' }, bodies: Object.keys(ev.bodies) } as any);
    if (svg.ok) writeFileSync(join(out, 'section-xz.svg'), svg.result.files[0].bytes);
  }
  writeFileSync(join(out, 'report.md'), report.text());
  console.log(`${file}\n${join(out, 'report.md')}`);
});
