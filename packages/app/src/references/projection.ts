// The row of a projection from a sketch (D69): a point, a line, a circle or an arc of an earlier
// sketch.
import type { SketchProjection } from '@trymesh/engine';
import type { ReferenceUi } from './spec';

const TITLES: Record<SketchProjection['kind'], string> = { point: 'Point', line: 'Line', circle: 'Circle', arc: 'Arc' };

export const projection: ReferenceUi<SketchProjection> = {
  title: (ref) => TITLES[ref.kind],
  detail: (ref) => `${ref.sketch}: ${ref.entity}`,
  tag: 'projected',
};
