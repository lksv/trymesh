// The tool Select: a click selects the point or curve under it (Shift adds or removes), a press on
// an own point drags it, and what is under the pointer is highlighted.
import { type SketchPlaceTool, anchor } from './spec';

export const select: SketchPlaceTool<undefined> = {
  label: 'Výběr',
  hint: 'Klikněte na bod nebo křivku (Shift přidává). Bod lze táhnout.',
  hovers: true,
  drags: true,
  atClick: true,
  click: (host, m, places, _context, _options, event) => {
    const id = anchor(places[places.length - 1]).snap?.id;
    if (!id) m.selection = event.shiftKey ? m.selection : [];
    else if (!event.shiftKey) m.selection = [id];
    else m.selection = m.selection.includes(id) ? m.selection.filter((other) => other !== id) : [...m.selection, id];
    host.renderPanel();
    host.renderScene();
  },
};
