// The tool Extend (D65): a click on a line or an arc moves its end nearest to the click to the next
// curve its extension meets; the extension is drawn dashed while the pointer is over the curve.
import { extendEnd, extendReach } from '@trymesh/engine';
import { runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const extend: SketchPlaceTool<undefined> = {
  label: 'Extend',
  hint: 'Click a line or an arc near the end to extend; it grows to the next curve.',
  picks: 'curve',
  eligible: (curve, context) => curve in context.feature.curves && context.feature.curves[curve].type !== 'circle',
  click: (host, _m, places, context) => {
    const place = anchor(places[places.length - 1]);
    const end = place.snap?.kind === 'curve' ? extendEnd(context.tool, place.snap.id, place.at) : undefined;
    if (place.snap?.kind !== 'curve' || !end) return host.say('Click a line or an arc near the end to extend.', true);
    runCut(host, context, 'extend', { curve: place.snap.id, end }, 'Extend', 'Extended');
  },
  draw: (_places, cursor, context) => {
    const place = anchor(cursor);
    if (place.snap?.kind !== 'curve') return [];
    const curve = place.snap.id;
    const end = extendEnd(context.tool, curve, place.at);
    const reach = end && extendReach(context.tool, { curve, end });
    const shape = context.feature.curves[curve];
    if (!end || !reach || !shape) return [];
    const from = context.view.points.get((shape as unknown as Record<string, string>)[end])?.at;
    if (!from) return [];
    if (shape.type !== 'arc') return [[from, reach]];
    // the extension of an arc: along its circle from the end to the place it reaches
    const center = context.view.points.get(shape.center)?.at;
    if (!center) return [[from, reach]];
    const radius = Math.hypot(from[0] - center[0], from[1] - center[1]);
    const [a, b] = [Math.atan2(from[1] - center[1], from[0] - center[0]), Math.atan2(reach[1] - center[1], reach[0] - center[0])];
    const turn = end === 'end' ? (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : -((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 32)));
    return [Array.from({ length: steps + 1 }, (_, i): [number, number] => [center[0] + radius * Math.cos(a + (turn * i) / steps), center[1] + radius * Math.sin(a + (turn * i) / steps)])];
  },
};
