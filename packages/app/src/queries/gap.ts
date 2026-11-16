// The view of the query `gap` (D40): the pairs as rows, the closest first, each with its distance
// and accuracy or its kind of contact; the pairs that could not be measured with the reason; and
// a line that says when a list was cut. A picked row draws its two bodies in the two colours of
// a picked collision, highlights the two faces of the gap and joins its two points by a line
// with its length. It is the collisions view with a line more in the scene. A pair whose answer
// went through a pair the collisions cleared by a mesh the kernel did not verify (D50) is marked
// in its row, and the note counts such pairs.
import type { Gap } from '@trymesh/engine';
import { h } from '../dom';
import { COLOR } from '../draw';
import type { QueryView, ViewPanel } from './index';

// A number measured on the mesh is not known to more than a thousandth of a millimetre.
const coarse = (value: number): number => Math.round(value * 1000) / 1000 + 0;
// A gap that rounds to nothing is still a gap: a pair at zero says its contact instead.
const distanceText = (pair: Extract<Gap, { accuracy: number }>, panel: ViewPanel<'gap'>): string => (coarse(pair.distance) === 0 ? `under ${panel.number(0.001, 'mm')}` : panel.number(coarse(pair.distance), 'mm'));

const CONTACT: Record<Extract<Gap, { contact: string }>['contact'], { text: string; title: string }> = {
  touching: { text: 'touching', title: 'The two bodies touch and share no volume: flush faces' },
  fit: { text: 'fit', title: 'Round faces reach into each other by no more than the chord tolerance: a pin in a hole of the same diameter' },
  collision: { text: 'collision', title: 'The two bodies share a volume' },
  unknown: { text: 'touching or colliding', title: 'The surfaces meet, and the kernel could not verify what the two bodies share' },
};

export const gapView: QueryView<'gap'> = {
  answer(result, _args, panel) {
    const cleared = new Set((result.cleared ?? []).map((pair) => `${pair.a}\u0000${pair.b}`));
    const row = (pair: Gap, index: number): HTMLElement[] => {
      const picked = panel.picked === index;
      const names = `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}`;
      const open = 'between' in pair;
      const mark = cleared.has(`${pair.a}\u0000${pair.b}`) ? { text: ' (cleared)', title: ' The collisions cleared the pair by a mesh the kernel did not verify.' } : { text: '', title: '' };
      const line = h(
        'div',
        { className: `row ${picked ? 'selected' : ''}`, title: `${open ? 'Highlight the two bodies and show where the gap is' : `Highlight the two bodies. ${CONTACT[pair.contact].title}`}${mark.title}`, onclick: () => panel.pick(picked ? undefined : index) },
        h('span', { className: 'name', textContent: names }),
        // two bodies of planar faces are exact to the precision of the coordinates: nothing to add
        h('small', {}, `${open ? `${distanceText(pair, panel)}${coarse(pair.accuracy) > 0 ? ` ± ${panel.number(coarse(pair.accuracy), 'mm')}` : ''}` : CONTACT[pair.contact].text}${mark.text}`),
      );
      // where the gap is: the two faces are the features to change, in the order of the two bodies
      return picked && open ? [line, h('p', { className: 'hint' }, `Between ${panel.faceLabel(pair.between.faceA)} and ${panel.faceLabel(pair.between.faceB)}.`)] : [line];
    };
    // each of the two lists says that it was cut only when it was
    const cut = [
      ...(result.pairs.length < result.close ? [`${result.pairs.length} of ${result.close} pair(s) within the search distance`] : []),
      ...(result.failed.length < result.refused ? [`${result.failed.length} of ${result.refused} pair(s) that could not be measured`] : []),
    ];
    return [
      ...(result.close === 0 && result.refused === 0 ? [h('p', { className: 'hint' }, `No two bodies are within ${panel.number(result.within, 'mm')} of each other; ${result.checked} pair(s) checked.`)] : []),
      ...result.pairs.flatMap(row),
      ...result.failed.map((pair) => h('p', { className: 'issue warning' }, `${panel.bodyName(pair.a)} × ${panel.bodyName(pair.b)}: could not be measured (${pair.message})`)),
      ...(cut.length ? [h('p', { className: 'hint' }, `Listed: ${cut.join(' and ')}. Raise "Most pairs" to see the rest.`)] : []),
    ];
  },
  scene(result, _args, panel) {
    const pair = panel.picked === undefined ? undefined : result.pairs[panel.picked];
    if (!pair) return {};
    const bodies = [
      { body: pair.a, color: COLOR.select },
      { body: pair.b, color: COLOR.clash },
    ];
    if (!('between' in pair)) return { bodies };
    const { a, b, faceA, faceB } = pair.between;
    return {
      bodies,
      faces: [
        { body: pair.a, face: faceA, color: COLOR.hover, opacity: 0.4 },
        { body: pair.b, face: faceB, color: COLOR.hover, opacity: 0.4 },
      ],
      lines: [{ segments: [...a, ...b], color: COLOR.hover, width: 2, onTop: true }],
      points: [{ positions: [...a, ...b], color: COLOR.hover, size: 8 }],
      labels: [{ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], text: distanceText(pair, panel), tone: 'reference' }],
    };
  },
  note(result, panel) {
    const failed = result.refused ? ` ${result.refused} pair(s) could not be measured.` : '';
    const apart = result.apart ? ` ${result.apart} further apart.` : '';
    const cleared = result.cleared?.length ? ` ${result.cleared.length} pair(s) rest on a mesh the kernel did not verify.` : '';
    const within = panel.number(result.within, 'mm');
    return {
      text: result.close ? `Gaps: ${result.close} pair(s) of bodies within ${within} of each other.${apart}${cleared}${failed}` : `No two bodies within ${within} of each other: ${result.checked} pair(s) checked.${cleared}${failed}`,
      error: result.refused > 0,
    };
  },
};
