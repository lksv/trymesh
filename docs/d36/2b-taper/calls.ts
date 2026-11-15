// Validation scenario 12 (a box with a lid and screw posts), the part of package 2b, written as
// calls against the contract. Only type-checked. It continues the model of 2a-offset/calls.ts:
// a draft on the rib, a lead-in on the lip of the lid, and one countersink made by hand from
// a tapered cut and a straight one (the hole feature of 2c makes the ones for the screws).

import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, EdgeNameAfter, FaceNameAfter, StateAfter, Surface } from '../00-prep/contract';
import { UPGRADES } from '../00-prep/contract';
import { RIB_LEFT, done, engine, onFace, pointAt, run, sameName, sketchOn, unwrap, XY } from '../2a-offset/calls';
import { TAPER_UPGRADE, circleBetween } from './contract';

// ---------------------------------------------------------------- a draft and a lead-in

// The rib gets a draft of three degrees: narrower at its top. The taper is a field of the extent
// like the distance; a patch merges it into the extent the feature has.
export function ribDraft(): boolean {
  const before = engine.getState().evaluation.bodies['box'].volume;
  const state = run({ type: 'updateFeature', id: 'rib', patch: { extent: { taper: 'deg(-3)' } } });
  const rib = state.document.features.find((f) => f.id === 'rib');
  const stored = rib?.type === 'extrude' && rib.extent.type === 'distance' ? rib.extent.taper : undefined; // -0.05236
  // the sides are still planes with the names they had, and a sketch still stands on one
  const side = state.evaluation.faceNames.findIndex((name) => sameName(name, RIB_LEFT));
  const planar = side >= 0 && state.evaluation.faceSurfaces[side].kind === 'plane';
  const onSide = done(engine.preview({ type: 'batch', commands: sketchOn('onDraft', onFace('box', RIB_LEFT)) }));
  return stored !== undefined && stored < 0 && planar && onSide.evaluation.features['onDraft'].status === 'ok' && state.evaluation.bodies['box'].volume < before;
}

// A lead-in on the lip so that the lid finds the box: the lip narrows towards its free end. The
// field was absent; `setField` adds it.
export const lipLeadIn = (): StateAfter => run({ type: 'setField', feature: 'lip', path: 'extent/taper', value: 'deg(-10)' });

// ---------------------------------------------------------------- a countersink by hand

// Two concentric circles on the top of the lid, in its middle. Their sizes and the angle of the
// cone are made up for the geometry (8 and 5 mm, 45° a side); they are no screw. Real sizes and
// angles come from the catalogs of 2c.
const circle = (sketch: Id, id: Id, radius: string): CommandAfter[] => [
  { type: 'addCurve', sketch, id, curve: { type: 'circle', center: 'lidMid' }, radius: 1 },
  { type: 'addConstraint', sketch, id: `${id}r`, constraint: { type: 'radius', curve: id, value: radius, driving: true } },
];
export const LID_TOP: FaceNameAfter = { feature: 'lid', role: 'endCap' };
const CONE: FaceNameAfter = { feature: 'sink', role: 'side', curve: 'wide' };
const BORE: FaceNameAfter = { feature: 'bore', role: 'side', curve: 'narrow' };

export function countersinkByHand(): StateAfter {
  return run(
    { type: 'setParameter', name: 'wideD', expr: '8' },
    { type: 'setParameter', name: 'narrowD', expr: '5' },
    ...sketchOn('middle', onFace('lid', LID_TOP)),
    ...pointAt('middle', 'lidMid', 'L / 2', 'W / 2'),
    ...circle('middle', 'wide', 'wideD / 2'),
    ...circle('middle', 'narrow', 'narrowD / 2'),
    // The cone: the wide circle at the mouth, narrowing by 45 degrees down to the narrow one. The
    // disc of the wide circle is two regions of the sketch (the ring and the disc inside it); they
    // are taken together, so the circle between them is not part of the outline that tapers.
    {
      type: 'addFeature',
      feature: {
        id: 'sink',
        name: 'sink',
        suppressed: false,
        type: 'extrude',
        profile: { type: 'regions', sketch: 'middle', regions: [{ outerLoop: ['wide'] }, { outerLoop: ['narrow'] }] },
        extent: { type: 'distance', start: 0, distance: '-(wideD - narrowD) / 2', taper: 'deg(-45)' },
        operation: 'cut',
        targets: ['lid'],
      },
    },
    { type: 'addFeature', feature: { id: 'bore', name: 'bore', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'middle', regions: [{ outerLoop: ['narrow'] }] }, extent: { type: 'throughAll', side: 'backward' }, operation: 'cut', targets: ['lid'] } },
  );
}

// The side of the tapered cut is a cone, a hole and not a pin, with the half angle of the taper.
export function coneOfTheSink(): boolean {
  const cone = unwrap(engine.query('body', { body: 'lid' })).faces.find((face) => sameName(face.name, CONE));
  return cone?.surface.kind === 'cone' && Math.abs(cone.surface.halfAngle - Math.PI / 4) < 1e-9 && cone.convex === false;
}

// Both rims of the countersink are circles: the mouth (the top of the lid and the cone) and the
// lower rim (the cone and the cylinder of the bore, two features). They are projected into
// a sketch as circles, which is what a later feature dimensions against.
const MOUTH: EdgeNameAfter = { a: LID_TOP, b: CONE };
const LOWER: EdgeNameAfter = { a: BORE, b: CONE };
export function rims(): boolean {
  const state = run(
    ...sketchOn('rims', XY),
    { type: 'addExternal', sketch: 'rims', id: 'mouth', ref: { type: 'edge', body: 'lid', edge: MOUTH, kind: 'circle' } },
    { type: 'addExternal', sketch: 'rims', id: 'lower', ref: { type: 'edge', body: 'lid', edge: LOWER, kind: 'circle' } },
  );
  // Every edge of the cone is a circle. (There may be a third one: the bore is a polygon with
  // another number of sides than the lower ring of the cone, so slivers of the end cap of the
  // tapered cut can stay between them. The hole feature of 2c builds both in one tool and has none.)
  const kinds = state.evaluation.bodies['lid'].edges.filter((edge) => sameName(edge.name.a, CONE) || sameName(edge.name.b, CONE)).map((edge) => edge.kind);
  const radii = state.evaluation.features['rims'].sketch?.radii;
  const projected = state.evaluation.features['rims'].status === 'ok';
  return kinds.length >= 2 && kinds.every((kind) => kind === 'circle') && projected && radii !== undefined && Math.abs(radii['mouth'] - 4) < 1e-9 && Math.abs(radii['lower'] - 2.5) < 1e-9;
}
// The same circle from the two surfaces, as a query of step 1 will read it.
export const mouthOf = (top: Surface, cone: Surface): number | undefined => circleBetween(top, cone)?.radius;

// ---------------------------------------------------------------- refusals

// A taper under which the far profile vanishes is an error of the feature.
export function tooSteep(): string | undefined {
  const preview = done(engine.preview({ type: 'setField', feature: 'sink', path: 'extent/taper', value: 'deg(-80)' }));
  return preview.evaluation.features['sink'].error?.code; // invalidProfile
}
// A taper on an extrusion with a generated profile is an invalid command (`gear`: such a feature).
export const taperOnGear = (gear: Id): boolean => engine.preview({ type: 'setField', feature: gear, path: 'extent/taper', value: 0.1 }).ok; // false
// "Through all" has no taper: a patch that changes the extent of the tapered cut has to drop it,
// which another `type` does by replacing the variant.
export const throughInstead = (): boolean => engine.preview({ type: 'updateFeature', id: 'sink', patch: { extent: { type: 'throughAll', side: 'backward' } } }).ok; // true
export const wrong = (): void => {
  // @ts-expect-error through all has no taper
  engine.execute({ type: 'updateFeature', id: 'sink', patch: { extent: { type: 'throughAll', side: 'backward', taper: 0.1 } } });
};

// ---------------------------------------------------------------- the version of the schema

// The step is in the list; a document with a taper is refused by a build that does not have it.
export const stepIsThere = (): boolean => UPGRADES.some((step) => step.name === TAPER_UPGRADE.name);

// ---------------------------------------------------------------- the part of the scenario

export function scenario12b(): boolean {
  const drafted = ribDraft();
  lipLeadIn();
  countersinkByHand();
  return drafted && coneOfTheSink() && rims() && tooSteep() === 'invalidProfile' && throughInstead() && stepIsThere();
}
