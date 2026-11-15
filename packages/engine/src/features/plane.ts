// The plane feature: a plane of its own, offset from a base plane, another plane or a planar face.
import type { NumberSpec } from '../catalog';
import { frame as frameOf } from '../recompute/services';
import type { Step, StepContext } from '../recompute/state';
import { toWorld } from '../solid';
import type { Frame, PlaneFeature } from '../types';
import { type Dict, type ValidationContext, base, planeRef, planeRefs } from '../validation';
import type { FeatureModule } from './module';

const OFFSET: NumberSpec = { title: 'Offset', unit: 'mm' };

function planeFeature(o: Dict, what: string, context: ValidationContext): PlaneFeature {
  return { ...base(o, what), type: 'plane', base: planeRef(context, o.base, `${what}.base`), offset: context.fields.number(o.offset, 'offset', OFFSET, `${what}.offset`) };
}

function step(feature: PlaneFeature, { state, done, failed }: StepContext): Step {
  const base = frameOf(feature.base, state);
  if (typeof base === 'string') return failed(base, [feature.base]);
  const frame: Frame = { ...base, origin: toWorld(base, 0, 0, feature.offset) };
  return { state: done({ status: 'ok', warnings: [], plane: frame }, { planes: { ...state.planes, [feature.id]: frame } }) };
}

export const plane: FeatureModule<PlaneFeature> = {
  info: { title: 'Rovina', summary: 'Vlastní rovina posunutá od základní roviny, jiné vlastní roviny nebo rovinné stěny tělesa.', fields: [{ path: 'offset', spec: OFFSET }], bodies: 'none' },
  validate: planeFeature,
  refs: (f) => planeRefs(f.base, 'base'),
  createsBody: () => false,
  namesFaces: false,
  producesTool: () => false,
  patch: { fields: ['base', 'offset'] },
  step,
};
