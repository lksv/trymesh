// The stored documents of the document (D62) in the panel of the model: a line per stored document
// with its features and the features that insert it, a revision read from a file in its place, and
// the removal of one that nothing inserts.
import { h } from '../dom';
import { documentFileControl, readDocumentFile } from '../features/insert';
import type { PanelHost } from '../host';

export function documentsPanel(host: PanelHost): HTMLElement[] {
  const { documents } = host.engine.getState().evaluation;
  const ids = Object.keys(documents);
  if (ids.length === 0) return [];
  return [
    h('h2', {}, 'Stored documents'),
    ...ids.map((id) => {
      const stored = documents[id];
      const used = stored.usedBy.length ? `inserted by ${stored.usedBy.map((feature) => host.nameOf(feature)).join(', ')}` : 'not inserted';
      return h(
        'div',
        { className: 'row document' },
        h('span', {}, `${stored.name ?? id} (${id}): ${stored.features} ${stored.features === 1 ? 'feature' : 'features'}; ${used}.`),
        ...documentFileControl(host, 'Replace…', 'Read a revision of the part from a document file in the place of this stored document', (file) => void readDocumentFile(host, file, id)),
        stored.usedBy.length ? null : h('button', { textContent: 'Remove', title: 'Remove the stored document from the document', onclick: () => host.run({ type: 'removeDocument', id }, `The stored document ${id} was removed.`) }),
      );
    }),
  ];
}
