// The sketch in the app. It has no form: it is created on a picked plane with a batch, and
// edited in the sketch mode.
import { type Command, type PlaneRef, type SketchFeature, emptySketch, faceKey } from '@trymesh/engine';
import { h } from '../dom';
import type { PanelHost } from '../host';
import type { FeatureUi } from './draft';

// Založí skicu; na stěně rovnou promítne její obrys (hrany druhu úsečka a kružnice).
function createSketch(host: PanelHost, ref: PlaneRef, index: number): boolean {
  const id = host.newId('s');
  const commands: Command[] = [{ type: 'addFeature', feature: emptySketch(id, `Skica ${id.slice(1)}`, ref), index }];
  if (ref.kind === 'face') {
    const key = faceKey(ref.face);
    for (const edge of host.view().evaluation.bodies[ref.body]?.edges ?? []) {
      if ((edge.kind === 'line' || edge.kind === 'circle') && (faceKey(edge.name.a) === key || faceKey(edge.name.b) === key)) {
        commands.push({ type: 'addExternal', sketch: id, id: host.newId('x'), ref: { type: 'edge', body: ref.body, edge: edge.name, kind: edge.kind } });
      }
    }
  }
  if (!host.run({ type: 'batch', commands })) return false;
  host.inserted(id);
  host.enterSketch(id);
  return true;
}

export const sketch: FeatureUi<SketchFeature> = {
  button: { label: 'Skica', title: 'Nová skica na rovině nebo rovinné stěně' },
  create: { plane: { header: 'Nová skica' }, run: (host, at) => at.plane !== undefined && createSketch(host, at.plane, at.index) },
  edit: (host, feature) => host.enterSketch(feature.id),
  summary(host, f) {
    const ref = host.planeRefOf(host.selected);
    return [h('button', { textContent: 'Přenést skicu na vybranou rovinu', disabled: !ref, title: 'Nejdřív vyberte v pohledu rovinu nebo rovinnou stěnu', onclick: () => ref && host.run({ type: 'setSketchPlane', sketch: f.id, plane: ref }, 'Rovina skici změněna.') })];
  },
  hideable: () => true,
};
