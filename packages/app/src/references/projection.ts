// The row of a projection from a sketch (D69): a point, a line, a circle or an arc of an earlier
// sketch, repaired by the tool From sketch; a curve has the checkbox of its flag `regions`, and the
// curves are drawn in the model view.
import type { SketchProjection } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

const TITLES: Record<SketchProjection['kind'], string> = { point: 'Point', line: 'Line', circle: 'Circle', arc: 'Arc' };

export const projection: ReferenceUi<SketchProjection> = {
  title: (ref) => TITLES[ref.kind],
  detail: (ref, host) => `${host.nameOf(ref.sketch)}: ${ref.entity}`,
  tag: 'projected',
  repair: () => ({
    title: 'Project again: then click the new point or curve of an earlier sketch',
    tool: 'projectSketch',
    hint: 'Click the point or curve of an earlier sketch that replaces the source of the projection (Esc cancels).',
  }),
  flag: {
    label: 'regions',
    title: 'The projected curve bounds regions of this sketch',
    get: (ref) => (ref.kind === 'point' ? undefined : ref.regions),
    set: (ref, on) => ({ ...ref, regions: on }),
  },
  inModel: true,
};
