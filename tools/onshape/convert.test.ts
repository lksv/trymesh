// Converts what fetch.ts downloaded into one document of trymesh, with a report.
//
//   ONSHAPE_IN=<folder of fetch.ts> [ONSHAPE_OUT=<folder>] [ONSHAPE_OVERRIDES=<module>] \
//     [ONSHAPE_PROBE=0] [ONSHAPE_BASELINE=<summary.json of another run>] \
//     npx vitest run --config tools/onshape/vitest.config.ts
//
// Writes <out>/<name>.json (the document; the studios and subassemblies are stored inside it and
// inserted), <out>/report.md (what was converted, how, what was left out, the volumes against
// Onshape, the count of the constraints by cause, the document's probe), <out>/summary.json (what
// the acceptance compares; ONSHAPE_BASELINE compares it with another run's) and
// <out>/section-xz.svg (the model cut by the plane XZ, for a look). ONSHAPE_PROBE=0 leaves out the
// document's probe (minutes on a large model).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { AssemblyConverter } from './assembly';
import { Input, Report, engineNow, newEngine, sane, settings } from './common';
import { type Summary, compareSummaries, fingerprint, finalFate, recordForSummary, sourceFingerprint, tally, tallyTables } from './fates';
import { FAILING, documentProbe, probeLines } from './probe';
import { type Overrides, convertStudio } from './studio';

test('convert', async () => {
  const dir = process.env.ONSHAPE_IN;
  if (!dir) throw new Error('ONSHAPE_IN: the folder fetch.ts wrote');
  const t0 = performance.now();
  const input = new Input(resolve(dir));
  const out = resolve(process.env.ONSHAPE_OUT ?? join(dir, 'trymesh'));
  const overrides: Overrides = process.env.ONSHAPE_OVERRIDES ? (await import(resolve(process.env.ONSHAPE_OVERRIDES))).default : {};
  const report = new Report();
  const meta = input.meta;
  report.lines.push(`# ${meta.name}`, '', `Converted from ${meta.url} (downloaded ${meta.fetched}).`);
  const document = meta.type === 'ASSEMBLY' ? await new AssemblyConverter(input, report, overrides).root() : (await convertStudio(input, meta.element, report, overrides)).document;
  const seconds = (performance.now() - t0) / 1000;
  mkdirSync(out, { recursive: true });
  const file = join(out, `${sane(meta.name)}.json`);
  writeFileSync(file, JSON.stringify(document));

  // the document as a fresh engine loads it, and a section for a look
  const engine = await newEngine();
  const loaded = engine.load(JSON.stringify(document));
  const result = { loads: loaded.ok, inError: [] as string[], bodies: 0 };
  report.section('Result');
  if (!loaded.ok) report.note(`the document does not load: ${loaded.error.message}`);
  else {
    const ev = engine.getState().evaluation;
    result.bodies = Object.keys(ev.bodies).length;
    report.note(`${Object.keys(ev.bodies).length} bodies, ${document.features.length} features at the top, ${Object.keys(document.documents ?? {}).length} stored documents, ${Object.keys(document.meshes ?? {}).length} stored meshes`);
    for (const [id, r] of Object.entries(ev.features)) {
      if (r.status !== 'ok') report.note(`${id}: ${r.status} ${r.error?.code ?? ''} ${r.warnings.map((w) => w.code).join(', ')}`);
      if (r.status === 'error') result.inError.push(`${id}:${r.error?.code}`);
    }
    const svg = engine.export('svg', { plane: { kind: 'base', plane: 'XZ' }, bodies: Object.keys(ev.bodies) } as any);
    if (svg.ok) writeFileSync(join(out, 'section-xz.svg'), svg.result.files[0].bytes);
  }

  // the count by cause
  const main = report.records.filter((r) => !r.helper);
  const helpers = report.records.filter((r) => r.helper);
  const all = new Map(report.records.map((r) => [r.key, r]));
  const t = tally(main);
  report.section('Sketch constraints');
  report.lines.push(...tallyTables(t, tally(helpers)));
  report.section('External operands');
  for (const r of report.records) for (const o of r.operands) if (o.external) report.note(`${r.studio}, ${r.sketchName}, ${r.what} (#${r.index}): \`${o.id}\` is ${o.decoded}${o.resolved ? `; resolved to ${o.resolved}${o.inferred ? ' (inferred)' : ''}` : ''}${o.candidates ? `; candidates: ${o.candidates.join('; ') || 'none'}` : ''}${o.note ? `; ${o.note}` : ''} — ${finalFate(r, all).fate}`);
  for (const [section, lines] of Object.entries(report.tail)) {
    report.section(section);
    for (const l of lines) report.note(l);
  }
  report.section('Expressions dropped');
  for (const r of report.records) for (const n of r.numbers ?? []) report.note(`${r.studio}, ${r.sketchName}, ${r.what} (#${r.index}): ${n}`);

  // the document's probe
  let probe;
  if (process.env.ONSHAPE_PROBE !== '0' && loaded.ok) {
    probe = documentProbe(engineNow, document, report.promises);
    const { lines, totals } = probeLines(probe);
    report.section('Probe');
    report.lines.push('| Group | Changes | Verdicts |', '|---|---|---|');
    for (const [g, v] of Object.entries(totals)) report.lines.push(`| ${g} | ${v.changes} | ${Object.entries(v).filter(([k]) => k !== 'changes').map(([k, n]) => `${k} ${n}`).join(', ')} |`);
    report.lines.push('');
    for (const l of lines) report.note(l);
    const failing = probe.changes.filter((c) => c.group === 'parameters' && c.verdicts.some((v) => FAILING.includes(v)));
    report.note(`changes of a parameter that fail the acceptance: ${failing.length}`);
  }

  // summary.json
  const git = (cmd: string) => { try { return execSync(cmd, { cwd: resolve(__dirname, '../..'), encoding: 'utf8' }).trim(); } catch { return '?'; } };
  const perSketch: Summary['perSketch'] = {};
  for (const s of Object.values(report.sketches)) perSketch[s.key] = s.counts;
  const summary: Summary = {
    run: { commit: git('git rev-parse HEAD'), dirty: git('git status --porcelain -- tools/onshape') !== '', source: sourceFingerprint(__dirname), fingerprint: fingerprint(resolve(dir)), overrides: process.env.ONSHAPE_OVERRIDES, settings: { probe: process.env.ONSHAPE_PROBE !== '0', ...settings }, seconds },
    tally: t,
    helperTally: tally(helpers),
    perSketch,
    constraints: report.records.map((r) => ({ ...recordForSummary(r), final: finalFate(r, all) }) as any),
    sketches: report.sketches,
    parts: report.parts,
    outcomes: report.outcomes,
    loaded: result,
    parametersInUse: report.parametersInUse,
    promises: report.promises,
    probe,
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
  if (process.env.ONSHAPE_BASELINE) {
    const c = compareSummaries(JSON.parse(readFileSync(resolve(process.env.ONSHAPE_BASELINE), 'utf8')), summary);
    report.section('Against the baseline');
    report.note(`strict: ${c.strict.length ? '' : 'no difference'}`);
    for (const l of c.strict) report.note(`  ${l}`);
    report.note(`grown: ${c.grown.length}`);
    for (const l of c.grown) report.note(`  ${l}`);
    report.note(`changed fates and causes: ${c.changed.join('; ') || 'none'}`);
    writeFileSync(join(out, 'comparison.json'), JSON.stringify(c, null, 1));
    writeFileSync(join(out, 'report.md'), report.text());
    // the acceptance: nothing of the strict scope differs from the baseline
    expect(c.strict).toEqual([]);
  }
  writeFileSync(join(out, 'report.md'), report.text());
  console.log(`${file}\n${join(out, 'report.md')}\n${join(out, 'summary.json')}\nlost ${t.fates.lost} of ${t.constraints}: ${JSON.stringify(t.fates)} ${JSON.stringify(Object.fromEntries(Object.entries(t.causes).filter(([, n]) => n)))}`);
});
