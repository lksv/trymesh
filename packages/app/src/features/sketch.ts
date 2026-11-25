// The sketch in the app. It has no form: it is created on a picked plane with a batch, and
// edited in the sketch mode.
import { type Command, type PlaneRef, type SketchFeature, emptySketch, faceKey } from '@trymesh/engine';
import { h } from '../dom';
import type { PanelHost } from '../host';
import type { FeatureUi } from './draft';

// Creates a sketch; on a face it projects its outline right away (edges of the kinds line and circle).
function createSketch(host: PanelHost, ref: PlaneRef, index: number): boolean {
  const id = host.newId('s');
  const commands: Command[] = [{ type: 'addFeature', feature: emptySketch(id, `Sketch ${id.slice(1)}`, ref), index }];
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
  button: { label: 'Sketch', title: 'A new sketch on a plane or a planar face' },
  create: { plane: { header: 'New sketch' }, run: (host, at) => at.plane !== undefined && createSketch(host, at.plane, at.index) },
  edit: (host, feature) => host.enterSketch(feature.id),
  summary(host, f) {
    const ref = host.planeRefOf(host.selected);
    return [h('button', { textContent: 'Move the sketch to the selected plane', disabled: !ref, title: 'First select a plane or a planar face in the view', onclick: () => ref && host.run({ type: 'setSketchPlane', sketch: f.id, plane: ref }, 'Sketch plane changed.') })];
  },
  hideable: () => true,
};
