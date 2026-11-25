// Probe E: the subset of SVG. Rows E1 to E3 of design.md.
import { describe, it, vi } from 'vitest';
import type { Command } from '../../../../packages/engine/src/index';
import { standInBoard } from '../../../../packages/scenarios/test/board-kit';
import { XY, addSketch, newEngine, run } from '../../../../packages/scenarios/test/kit';
import { addOutline, dxfOf, regionArea, resultOf } from './kit';
import { assemble, importOutline, installOutlineKind, outlineEntry } from './proto';
import { readSvg } from './svg';

installOutlineKind();
vi.mock('../../../../packages/engine/src/references/spec', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../packages/engine/src/references/spec')>();
  return { ...original, projected: (v: unknown, what: string) => ((v as { kind?: string } | null)?.kind === 'outline' ? v : original.projected(v, what)) };
});

describe('E: the subset of SVG', () => {
  it('E1: the engine\'s own SVG of the board read back: the curves of its DXF', () => {
    const engine = newEngine();
    standInBoard(engine);
    const exported = engine.export('svg', { plane: XY, offset: 0.8, bodies: ['pcb'] });
    if (!exported.ok) throw new Error(exported.error.message);
    const text = new TextDecoder().decode((exported.result as { files: { bytes: Uint8Array }[] }).files[0].bytes);
    const svg = assemble(readSvg(text));
    const dxf = importOutline(dxfOf(engine, 'pcb', 0.8).text);
    console.log('E1 svg', JSON.stringify({ byKind: svg.report.byKind, bounds: svg.report.bounds, unit: svg.report.about.unit, layers: svg.report.about.layers, welded: svg.report.welded, open: svg.report.open }));
    let far = 0;
    const flat = (curves: object): number[] => JSON.stringify(curves).match(/-?\d+\.?\d*(e-?\d+)?/g)?.map(Number) ?? [];
    const [a, b] = [flat(Object.values(svg.curves)), flat(Object.values(dxf.curves))];
    for (let i = 0; i < a.length; i++) far = Math.max(far, Math.abs(a[i] - b[i]));
    console.log('E1 same keys', JSON.stringify(Object.keys(svg.curves)) === JSON.stringify(Object.keys(dxf.curves)), 'numbers', a.length, b.length, 'the furthest apart', far.toExponential(2));
    const state = run(engine, addSketch('back', XY), addOutline('back', 'o', outlineEntry(svg.curves)));
    console.log('E1 regions', resultOf(state, 'back').regions.length, 'valid', resultOf(state, 'back').valid, 'area', regionArea(state, 'back'));
  });

  it('E2: a drawing as a drawing program writes one: px with a viewBox, groups with transforms, Beziers, a rect with round corners', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100mm" height="50mm" viewBox="0 0 200 100">
  <defs><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>
  <g inkscape:groupmode="layer" inkscape:label="cut" id="layer1" transform="translate(20,10)">
    <rect x="0" y="0" width="80" height="40" rx="6"/>
    <g transform="rotate(90 40 20) scale(0.5)">
      <path d="M 60,30 c 10,-20 30,-20 40,0 q -20,25 -40,0 z"/>
    </g>
    <circle cx="10" cy="10" r="3" style="fill:none"/>
    <path d="m 100 0 h 20 v 20 H 100 Z"/>
    <path d="M 0 60 A 10 10 0 0 1 20 60 A 10 10 0 1 1 0 60"/>
    <ellipse cx="5" cy="5" rx="2" ry="1"/>
    <path d="M 0 0 A 4 2 0 0 1 8 0"/>
  </g>
  <g id="engrave"><text x="1" y="1">REV A</text><line x1="0" y1="0" x2="10" y2="0"/></g>
</svg>`;
    const all = readSvg(text);
    console.log('E2 about', JSON.stringify(all.about));
    const { curves, report } = assemble(readSvg(text, { layers: ['cut'] }));
    console.log('E2 cut', JSON.stringify({ byKind: report.byKind, bounds: report.bounds, welded: report.welded, open: report.open, skipped: report.about.skipped }));
    console.log('E2 a1', JSON.stringify(curves.a1), 's1', JSON.stringify(curves.s1), 'c1', JSON.stringify(curves.c1));
    const engine = newEngine();
    const state = run(engine, addSketch('s', XY), addOutline('s', 'o', outlineEntry(curves)));
    const result = resultOf(state, 's');
    console.log('E2 sketch', state.evaluation.features.s.status, 'valid', result.valid, 'regions', JSON.stringify(result.regions.map((r) => [r.ref.outerLoop.join(' '), r.loops.length - 1])), 'openEnds', result.openEnds?.count ?? 0);
    const rounded = result.regions.find((r) => r.ref.outerLoop.length === 8);
    if (rounded) {
      const made = run(engine, { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [rounded.ref] }, extent: { type: 'distance', start: 0, distance: 1 }, operation: 'new' } } as Command);
      // the rect 80 × 40 user units is 40 × 20 mm with corners of 3; less the disc of 1.5, the lens and nothing else inside
      console.log('E2 extruded', made.evaluation.features.e.status, made.evaluation.bodies.e?.volume.toFixed(3), 'the rounded rect alone by hand', (40 * 20 - (4 - Math.PI) * 9).toFixed(3));
    }
  });
});
