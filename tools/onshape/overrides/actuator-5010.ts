// Overrides for the cycloidal actuator 5010 (Onshape document 192ab9c484f00d0dd33b8f01): the disc is
// drawn in Onshape by four imported splines, which trymesh does not have; the generator
// `cycloidalDisc` (D61) builds the same profile from the parameters of the variable studio
// (E, N, Phi_R, Phi_r). In the frame of the studio the disc is centred at the origin and the ring of
// pins at (−E, 0), the first pin on +X. The bore and the six holes come from the converted sketch.
import type { Overrides } from '../studio';

export default {
  'Cycloidal Disk': {
    'Extrude 1': ({ engine, report, feature, id, sketches, bodies, dump }) => {
      const s = [...sketches.values()][0].id; // the studio has one sketch
      const holes = engine.getState().evaluation.features[s].sketch!.regions.filter((r) => r.ref.outerLoop.length === 1).map((r) => r.ref);
      const r = engine.execute({ type: 'batch', commands: [
        { type: 'addPoint', sketch: s, id: `${s}.ring`, x: -1.25, y: 0 },
        { type: 'addConstraint', sketch: s, id: `${s}.ringAt`, constraint: { type: 'fixed', point: `${s}.ring`, x: '-E', y: 0 } as any },
        { type: 'addCurve', sketch: s, id: `${s}.pins`, curve: { type: 'circle', center: `${s}.ring`, construction: true }, radius: 29 },
        { type: 'addConstraint', sketch: s, id: `${s}.pinsD`, constraint: { type: 'diameter', curve: `${s}.pins`, value: 'Phi_R', driving: true } as any },
        { type: 'addFeature', feature: { id, name: feature.name, suppressed: false, type: 'extrude', profile: { type: 'generated', generator: 'cycloidalDisc', sketch: s, operands: { circle: `${s}.pins` }, params: { pins: 'N', pinRadius: 'Phi_r / 2', eccentricity: 'E' } }, extent: { type: 'distance', start: 0, distance: 4 }, operation: 'new' } as any },
        { type: 'addFeature', feature: { id: `${id}_holes`, name: `${feature.name} holes`, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: holes }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: [id] } as any },
      ] });
      if (!r.ok) { report.note(`override ${feature.name}: refused: ${r.error.message}`); return false; }
      for (const b of dump.created[feature.featureId].bodies) bodies.set(b, id);
      report.note(`${feature.name}: the disc by the generator cycloidalDisc (override; Onshape has splines), the bore and ${holes.length - 1} holes cut`);
      return true;
    },
  },
} satisfies Overrides;
