// The view of the query `interference` (D39): what the collisions panel showed before the generic
// form of a query existed. The query is asked as soon as its form opens; the collisions and then
// the fits are rows, a fit marked as one; the pairs the kernel could not verify are listed with
// the reason (and, since D50, what it computed); a picked row draws its two bodies in two colours; the note counts the fits and the
// failures. The pairs the kernel refused and its intersection as computed cleared (D50) are rows
// of their own after the fits, and the note counts them. The pairs a thread accounts for (D76) are
// a third group after those, and a collision of two threads that do not agree says what differs;
// one of two modelled threads that agree says how to seat them, or names the ring a groove leaves
// under a shoulder that the mate stands in.
import type { Cleared, Interference, Seat, ShortOfShoulder, Threaded } from '@trymesh/engine';
import { fmt, h } from '../dom';
import { COLOR } from '../draw';
import type { QueryView } from './index';

export const interferenceView: QueryView<'interference'> = {
  immediate: true,
  answer(result, _args, panel) {
    // collisions first, then the fits, then the cleared pairs; `picked` counts through the three lists
    // two modelled threads turned against each other: what to add to the phase of either (D76); the
    // ring a groove leaves under a shoulder that the wall of the mate stands in, named instead of
    // "another cause" (and beside a turn)
    const ringText = (entry: ShortOfShoulder): string =>
      `; the groove of ${entry.feature}${entry.inserted ? ' (in its inserted document)' : ''} stops ${fmt(entry.height)} mm short of its shoulder, where ${entry.mate.feature} still stands: chamfer the end of the mate before its thread, or let the mate stop more than that short of the shoulder (a deeper socket)`;
    const seatText = (pair: Interference & { seat?: Seat[]; shortOfShoulder?: ShortOfShoulder[] }): string => {
      if (!pair.seat) return '';
      const rings = (pair.shortOfShoulder ?? []).map(ringText).join('');
      // an entry this document can apply first (one of an inserted document is changed there)
      const turn = pair.seat.find((entry) => entry.addToPhase !== 0 && !entry.inserted) ?? pair.seat.find((entry) => entry.addToPhase !== 0);
      if (!turn) return rings || '; the threads are seated, the collision has another cause';
      const other = pair.seat.some((entry) => entry !== turn && !entry.inserted);
      return `; the threads are turned against each other: add ${fmt((turn.addToPhase * 180) / Math.PI)}° to the phase of ${turn.feature}${turn.inserted ? ' (in its inserted document)' : other ? ' (or turn the other)' : ''}${rings}`;
    };
    const row = (pair: Interference & { mismatch?: string; seat?: Seat[]; shortOfShoulder?: ShortOfShoulder[] }, index: number, fit: boolean): HTMLElement =>
      h(
        'div',
        { className: `row ${panel.picked === index ? 'selected' : ''}`, title: `Highlight the two bodies. One reaches ${fmt(pair.depth)} mm into the other`, onclick: () => panel.pick(panel.picked === index ? undefined : index) },
        h('span', { className: 'name', textContent: `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}` }),
        h('small', {}, `${fit ? 'fit, ' : ''}${fmt(pair.volume)} mm³${pair.mismatch ? `; the threads do not agree: ${pair.mismatch}` : ''}${seatText(pair)}`),
      );
    const threaded = result.threaded ?? [];
    const threadedRow = (pair: Threaded, index: number): HTMLElement =>
      h(
        'div',
        { className: `row ${panel.picked === index ? 'selected' : ''}`, title: 'Highlight the two bodies. What they share within the zone of a thread is what the thread accounts for', onclick: () => panel.pick(panel.picked === index ? undefined : index) },
        h('span', { className: 'name', textContent: `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}` }),
        h('small', {}, `threaded, ${fmt(pair.volume)} mm³ excused`),
      );
    const cleared = result.cleared ?? [];
    const clearedRow = (pair: Cleared, index: number): HTMLElement =>
      h(
        'div',
        { className: `row ${panel.picked === index ? 'selected' : ''}`, title: 'Highlight the two bodies. The kernel did not verify their intersection; the mesh it computed shows no collision', onclick: () => panel.pick(panel.picked === index ? undefined : index) },
        h('span', { className: 'name', textContent: `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}` }),
        h('small', {}, pair.kind === 'fit' ? `cleared: a fit, ${fmt(pair.volume)} mm³` : 'cleared: shares nothing'),
      );
    return [
      ...(result.pairs.length === 0 && result.failed.length === 0 ? [h('p', { className: 'hint' }, `No two bodies collide; ${result.checked} pair(s) checked. Bodies that only touch do not count.`)] : []),
      ...result.pairs.map((pair, index) => row(pair, index, false)),
      ...(result.fits.length
        ? [h('p', { className: 'hint' }, 'Fits: round faces that reach into each other by no more than the chord tolerance. Round faces are polygons, so a pin in a hole of the same diameter overlaps its wall by slivers; that is not a collision of the design.')]
        : []),
      ...result.fits.map((pair, index) => row(pair, result.pairs.length + index, true)),
      ...(cleared.length ? [h('p', { className: 'hint' }, 'Cleared by a mesh the kernel did not verify: the kernel refused to verify the intersection of these pairs, and the intersection as it computed it shows no collision.')] : []),
      ...cleared.map((pair, index) => clearedRow(pair, result.pairs.length + result.fits.length + index)),
      ...(threaded.length ? [h('p', { className: 'hint' }, 'Threaded: a part of what these pairs share is what a thread accounts for (a screw in a tapped hole); what is left of a pair is judged as every pair, above (a pair whose rest collides is listed there alone).')] : []),
      ...threaded.map((pair, index) => threadedRow(pair, result.pairs.length + result.fits.length + cleared.length + index)),
      ...result.failed.map((pair) => h('p', { className: 'issue warning' }, `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: not verified, neither colliding nor clear (${pair.message})`)),
    ];
  },
  scene(result, _args, panel) {
    const pair = panel.picked === undefined ? undefined : [...result.pairs, ...result.fits, ...(result.cleared ?? []), ...(result.threaded ?? [])][panel.picked];
    return pair ? { bodies: [{ body: pair.a, color: COLOR.select }, { body: pair.b, color: COLOR.clash }] } : {};
  },
  note(result) {
    const failed = result.failed.length ? ` ${result.failed.length} pair(s) could not be verified.` : '';
    const fits = result.fits.length ? ` ${result.fits.length} fit(s) within the chord tolerance.` : '';
    const cleared = result.cleared?.length ? ` ${result.cleared.length} pair(s) cleared by a mesh the kernel did not verify.` : '';
    const threaded = result.threaded?.length ? ` ${result.threaded.length} pair(s) threaded.` : '';
    return result.pairs.length
      ? { text: `Collisions: ${result.pairs.length} pair(s) of bodies share a volume.${fits}${cleared}${threaded}${failed}`, error: true }
      : { text: `No collisions: ${result.checked} pair(s) checked.${fits}${cleared}${threaded}${failed}`, error: result.failed.length > 0 };
  },
};
