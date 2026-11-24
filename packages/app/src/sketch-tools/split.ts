// The tool Split (D65): a click on a curve cuts it at every place another curve crosses or touches
// it (the other curves of the outline there too), or with the option at the crossing nearest to the
// click only. Its panel has the button Split crossings, which cuts every contact of the outline in
// the sketch at once: the repair of an invalid profile.
import { curveUnder } from '@trymesh/engine';
import { h } from '../dom';
import { type SplitOptions, bound, boundRows, ownCurve, runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const split: SketchPlaceTool<SplitOptions> = {
  label: 'Split',
  hint: 'Click a curve to cut it where other curves cross it.',
  picks: 'curve',
  eligible: ownCurve,
  click: (host, _m, places, context, options) => {
    const place = anchor(places[places.length - 1]);
    if (place.snap?.kind !== 'curve') return host.say('Click a curve to split, or Split crossings in the panel.', true);
    runCut(host, context, 'split', { curve: curveUnder(context.tool, place.at, place.snap.id), with: bound(context, options.with), ...(options.nearest ? { at: place.at } : {}) }, 'Split', 'Split');
  },
  options: {
    initial: { nearest: false },
    panel: (host, value, set) => {
      const nearest = h('input', {
        type: 'checkbox',
        checked: value.nearest,
        onchange: () => {
          set({ ...value, nearest: nearest.checked });
          host.renderPanel();
        },
      });
      return [
        h('h2', {}, 'Split'),
        h(
          'div',
          { className: 'buttons' },
          h('button', {
            textContent: 'Split crossings',
            title: 'Every crossing of the outline curves becomes a common point; the features keep their regions',
            onclick: () => {
              const context = host.sketchContext();
              if (context) runCut(host, context, 'split', {}, 'Split crossings', 'Crossings split');
            },
          }),
        ),
        ...boundRows(host, value, set),
        h('label', { className: 'check' }, nearest, 'Only at the crossing nearest to the click'),
        h('p', { className: 'hint' }, 'Click a curve to cut it where other curves cross it. Each piece is a curve of its own with its own regions; the constraints stay with the piece they describe. Then trim the pieces that should go.'),
      ];
    },
  },
};
