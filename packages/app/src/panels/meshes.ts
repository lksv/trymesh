// The stored meshes of the document (D55) in the panel of the model: a line per stored mesh with its
// triangles, its size and the features that place it, and the removal of one that nothing uses.
import { h } from '../dom';
import { valueText } from '../fields';
import type { PanelHost } from '../host';

export function meshesPanel(host: PanelHost): HTMLElement[] {
  const { meshes } = host.engine.getState().evaluation;
  const ids = Object.keys(meshes);
  if (ids.length === 0) return [];
  return [
    h('h2', {}, 'Stored meshes'),
    ...ids.map((id) => {
      const mesh = meshes[id];
      const size = mesh.bounds.max.map((high, axis) => valueText(high - mesh.bounds.min[axis], 'mm')).join(' × ');
      const used = mesh.usedBy.length ? `placed by ${mesh.usedBy.map((feature) => host.nameOf(feature)).join(', ')}` : 'not placed';
      return h(
        'div',
        { className: 'row mesh' },
        h('span', {}, `${mesh.name ?? id} (${id}): ${mesh.triangles} triangles, ${size}; ${used}.`),
        mesh.usedBy.length ? null : h('button', { textContent: 'Remove', title: 'Remove the stored mesh from the document', onclick: () => host.run({ type: 'removeMesh', id }, `The stored mesh ${id} was removed.`) }),
      );
    }),
  ];
}
