// The tool Project: projects an edge of a body into the sketch. With one projection selected, or
// one being repaired from its row in the panel, the edge replaces its source (the ID stays, the
// constraints hold).
import type { SketchEdgeTool } from './spec';

export const project: SketchEdgeTool<undefined> = {
  label: 'Promítnout',
  hint: 'Klikněte na hranu tělesa (úsečku nebo kružnici).',
  picks: 'edge',
  click: (host, m, edge, context) => {
    if (edge?.kind !== 'edge') return;
    if (edge.edgeKind !== 'line' && edge.edgeKind !== 'circle') return host.say('Promítnout jde jen hrana, která je úsečka nebo kružnice.', true);
    const ref = { type: 'edge' as const, body: edge.body, edge: edge.name, kind: edge.edgeKind };
    const repaired = m.repair ?? (m.selection.length === 1 && context.feature.external[m.selection[0]] ? m.selection[0] : undefined);
    if (repaired) {
      if (host.run({ type: 'updateExternal', sketch: m.id, id: repaired, ref }, 'Promítnutí opraveno.')) m.repair = undefined;
    } else host.run({ type: 'addExternal', sketch: m.id, id: host.newId('x'), ref }, 'Hrana promítnuta.');
  },
};
