// The tool Split (D65): a click on a curve cuts it at every place another curve crosses or touches
// it (the other curves of the outline there too). Its panel has the button Split crossings, which
// cuts every crossing of the outline in the sketch at once: the repair of an invalid profile.
import { h } from '../dom';
import { ownCurve, runCut } from './cut';
import { type SketchPlaceTool, anchor } from './spec';

export const split: SketchPlaceTool<undefined> = {
  label: 'Split',
  hint: 'Click a curve to cut it where other curves cross it; Split crossings in the panel cuts every crossing of the outline.',
  picks: 'curve',
  eligible: ownCurve,
  click: (host, _m, places, context) => {
    const place = anchor(places[places.length - 1]);
    if (place.snap?.kind !== 'curve') return host.say('Click a curve to split, or Split crossings in the panel.', true);
    runCut(host, context, 'split', { curve: place.snap.id }, 'Split', 'Split');
  },
  options: {
    initial: undefined,
    panel: (host) => [
      h('h2', {}, 'Split'),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Split crossings', title: 'Every crossing of the outline curves becomes a common point; the features keep their regions', onclick: () => {
        const context = host.sketchContext();
        if (context) runCut(host, context, 'split', {}, 'Split crossings', 'Crossings split');
      } })),
      h('p', { className: 'hint' }, 'Click a curve to cut it where other curves cross it. Each piece is a curve of its own with its own regions; the constraints stay with the piece they describe. Then trim the pieces that should go.'),
    ],
  },
};
