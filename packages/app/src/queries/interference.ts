// The view of the query `interference` (D39): what the collisions panel showed before the generic
// form of a query existed. The query is asked as soon as its form opens; the collisions and then
// the fits are rows, a fit marked as one; the pairs the kernel could not compute are listed with
// the reason; a picked row draws its two bodies in two colours; the note counts the fits and the
// failures.
import type { Interference } from '@trymesh/engine';
import { fmt, h } from '../dom';
import { COLOR } from '../draw';
import type { QueryView } from './index';

export const interferenceView: QueryView<'interference'> = {
  immediate: true,
  answer(result, _args, panel) {
    // collisions first, then the fits; `picked` counts through both lists
    const row = (pair: Interference, index: number, fit: boolean): HTMLElement =>
      h(
        'div',
        { className: `row ${panel.picked === index ? 'selected' : ''}`, title: `Highlight the two bodies. One reaches ${fmt(pair.depth)} mm into the other`, onclick: () => panel.pick(panel.picked === index ? undefined : index) },
        h('span', { className: 'name', textContent: `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}` }),
        h('small', {}, `${fit ? 'fit, ' : ''}${fmt(pair.volume)} mm³`),
      );
    return [
      ...(result.pairs.length === 0 && result.failed.length === 0 ? [h('p', { className: 'hint' }, `No two bodies collide; ${result.checked} pair(s) checked. Bodies that only touch do not count.`)] : []),
      ...result.pairs.map((pair, index) => row(pair, index, false)),
      ...(result.fits.length
        ? [h('p', { className: 'hint' }, 'Fits: round faces that reach into each other by no more than the chord tolerance. Round faces are polygons, so a pin in a hole of the same diameter overlaps its wall by slivers; that is not a collision of the design.')]
        : []),
      ...result.fits.map((pair, index) => row(pair, result.pairs.length + index, true)),
      ...result.failed.map((pair) => h('p', { className: 'issue warning' }, `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: could not be computed (${pair.message})`)),
    ];
  },
  scene(result, _args, panel) {
    const pair = panel.picked === undefined ? undefined : [...result.pairs, ...result.fits][panel.picked];
    return pair ? { bodies: [{ body: pair.a, color: COLOR.select }, { body: pair.b, color: COLOR.clash }] } : {};
  },
  note(result) {
    const failed = result.failed.length ? ` ${result.failed.length} pair(s) could not be computed.` : '';
    const fits = result.fits.length ? ` ${result.fits.length} fit(s) within the chord tolerance.` : '';
    return result.pairs.length ? { text: `Collisions: ${result.pairs.length} pair(s) of bodies share a volume.${fits}${failed}`, error: true } : { text: `No collisions: ${result.checked} pair(s) checked.${fits}${failed}`, error: result.failed.length > 0 };
  },
};
