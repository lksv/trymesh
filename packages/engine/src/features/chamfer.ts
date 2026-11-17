// The feature `chamfer` (D63): edges of one body chamfered by one distance along both faces.
import type { NumberSpec } from '../catalog';
import { blendStep } from '../recompute/edge-blend';
import type { ChamferFeature } from '../types';
import { base } from '../validation';
import { BLEND_SUMMARY, blendFields, blendRefs } from './edge-blend';
import type { FeatureModule } from './module';

export const CHAMFER_DISTANCE: NumberSpec = { title: 'Distance', unit: 'mm', min: { value: 0, open: true } };

export const chamfer: FeatureModule<ChamferFeature> = {
  info: {
    title: 'Chamfer',
    summary: `Chamfers edges of one body by one distance along both faces of each edge. ${BLEND_SUMMARY} The face of a straight edge is a plane a sketch can stand on; of a circular edge a cone, or a plane across its axis or a cylinder.`,
    fields: [{ path: 'distance', spec: CHAMFER_DISTANCE }],
    bodies: 'none',
  },
  validate: (o, what, context) => {
    const { body, edges, size } = blendFields(o, what, context, 'distance', CHAMFER_DISTANCE);
    return { ...base(o, what), type: 'chamfer', body, edges, distance: size };
  },
  refs: blendRefs,
  createsBody: () => false,
  namesFaces: true,
  producesTool: () => false,
  patch: { fields: ['body', 'edges', 'distance'] },
  step: (feature, context) => blendStep('chamfer', feature.id, feature.body, feature.edges, feature.distance, context),
};
