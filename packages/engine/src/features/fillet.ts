// The feature `fillet` (D63): edges of one body rounded by one radius.
import type { NumberSpec } from '../catalog';
import { blendStep } from '../recompute/edge-blend';
import type { FilletFeature } from '../types';
import { base } from '../validation';
import { BLEND_SUMMARY, blendFields, blendRefs } from './edge-blend';
import type { FeatureModule } from './module';

export const FILLET_RADIUS: NumberSpec = { title: 'Radius', unit: 'mm', min: { value: 0, open: true } };

export const fillet: FeatureModule<FilletFeature> = {
  info: {
    title: 'Fillet',
    summary: `Rounds edges of one body by one radius. ${BLEND_SUMMARY} The face of a straight edge is a cylinder, of a circular edge a torus, or a sphere where the centre of its arc lies on the axis. Where three fillets meet at a corner the corner is a crease, not a ball.`,
    fields: [{ path: 'radius', spec: FILLET_RADIUS }],
    bodies: 'none',
  },
  validate: (o, what, context) => {
    const { body, edges, size } = blendFields(o, what, context, 'radius', FILLET_RADIUS);
    return { ...base(o, what), type: 'fillet', body, edges, radius: size };
  },
  refs: blendRefs,
  createsBody: () => false,
  namesFaces: true,
  producesTool: () => false,
  patch: { fields: ['body', 'edges', 'radius'] },
  step: (feature, context) => blendStep('fillet', feature.id, feature.body, feature.edges, feature.radius, context),
};
