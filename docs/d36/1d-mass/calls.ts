// Package 1d written out as calls: its part of validation scenario 11 (the mass of the carrier
// beyond the output of the robot joint of scenario 9) and the entry of the query over the
// context. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be
// written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that must
// not compile.
//
// The numbers in the comments were measured by a prototype of the pass over the model of
// scenario 9 (chord tolerance 0.01 mm); they become the expectations of the test in
// packages/scenarios.

import type { Id, Vec3 } from '../../../packages/engine/src/index';
import type { EngineAfter, QueryArgs, QueryOutcome, QueryToolInput } from '../00-prep/contract';
import { QUERIES, QueryFailure } from '../00-prep/contract';
import { QUERY_UNITS } from '../1b-measure/contract';
import type { MassIntegrals, MassProperties } from './contract';
import { MASS_ARGS, MASS_UNITS, massIntegrals, massSourceOf } from './contract';

declare const engine: EngineAfter; // with the joint of scenario 9, as packages/scenarios/test/scenario9.test.ts builds it
declare function fail(message: string): never;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
const PLA = 1.24; // g/cm3; from the catalog of materials once 3a has one

// ---------------------------------------------------------------- a. scenario 11: the mass beyond the output

// The carrier alone, printed solid: 14863.496 mm3, so 18.431 g; its centre of mass on the axis
// at z = 48.569; about the axis 8256.9 g·mm2, about a line across it 4242.9. (With exact circles
// the volume would be 14873.478: the polygons are inscribed, 0.07 % less.)
export function carrierAlone(): { mass: number; onTheAxis: boolean; aboutTheAxis: number } {
  const carrier: MassProperties = unwrap(engine.query('mass', { bodies: ['carrier'], density: PLA }));
  const [x, y] = carrier.centerOfMass;
  return { mass: carrier.mass, onTheAxis: Math.hypot(x, y) < 1e-3, aboutTheAxis: carrier.inertia[2][2] };
}

// What turns with the output: the carrier and the three planets on its pins, as one piece.
// 30393.134 mm3, 37.687 g, the centre of mass on the axis at z = 44.191 (three planets a third
// of a turn apart cancel out), and 17639 g·mm2 about the axis of the joint.
export function beyondTheOutput(): { mass: number; height: number; moment: number; offTheAxis: number } {
  const planets: Id[] = engine.getState().evaluation.features['planets'].bodies; // planets/1, planets/2
  const link = unwrap(engine.query('mass', { bodies: ['carrier', 'planet', ...planets], density: PLA, about: { kind: 'base', axis: 'Z' } }));
  if (!link.about) return fail('an axis was given');
  return { mass: link.mass, height: link.centerOfMass[2], moment: link.about.moment, offTheAxis: link.about.distance }; // 0: balanced
}

// One planet about the axis of the joint: its own inertia and its mass times the square of the
// centre distance (20.25). Its centre of mass is that far from the axis.
export function planetAboutTheJoint(): number | undefined {
  return unwrap(engine.query('mass', { bodies: ['planet'], density: PLA, about: { kind: 'sketchPoint', sketch: 'skGears', point: 'origin' } })).about?.distance; // 20.25
}

// A density per body and a fill factor: the motor is not printed, the carrier is printed with
// 40 % of its volume as material. The fill factor goes with `density`: the carrier comes back
// with density 1.24 and fill 0.4 (7.372 g), the motor with 2.9 and fill 1.
export const mixed = (): MassProperties => unwrap(engine.query('mass', { bodies: ['carrier', 'motor'], densities: { motor: 2.9 }, density: PLA, fill: 0.4 }));
export const sparse = (): number => unwrap(engine.query('mass', { bodies: ['carrier'], density: PLA, fill: 0.4 })).mass; // 7.372
// A body may be called anything a record has by inheritance: on a model with a body of the ID
// `constructor` (the joint has none; a test of the query builds one), `densities: {}` gives it
// no density and the fallback is used.
export const oddName: QueryToolInput = { query: 'mass', args: { bodies: ['constructor'], densities: {}, density: PLA } };
export const overMcp: QueryToolInput = { query: 'mass', args: { bodies: ['carrier'], density: PLA }, at: 'carrier' }; // the disc before its pins
// A fill factor that reaches no body is refused, not ignored: the motor has its own density here.
export function fillForNothing(): string {
  const outcome = engine.query('mass', { bodies: ['motor'], densities: { motor: 2.9 }, fill: 0.4 });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // failed in fill
}

// Until body properties exist a body has no density of its own, so one has to be given.
export function noDensity(): string {
  const outcome = engine.query('mass', { bodies: ['carrier'] });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // failed in density (see "Needs from the preparatory step" of 1b)
}
// A density for a body that is not in the state is found before `run`, like any other ID.
export function unknownBody(): string {
  const outcome = engine.query('mass', { bodies: ['carrier'], densities: { nope: 1 } });
  return outcome.ok ? fail('expected an error') : `${outcome.error.code} in ${String(outcome.error.arg)}`; // notAvailable in densities,nope
}

// @ts-expect-error the bodies are required
engine.query('mass', { density: PLA });
// @ts-expect-error a density is a number, not the name of a material
engine.query('mass', { bodies: ['carrier'], density: 'PLA' });

// ---------------------------------------------------------------- b. the entry, over the context

const GRAMS_PER_MM3 = 1e-3; // a density in g/cm3 times this is in g/mm3
// The tensor about a point from the second moments about the origin, a mass and that point.
declare function tensorAbout(second: MassIntegrals['second'], mass: number, point: Vec3): [Vec3, Vec3, Vec3];
// The moment about an axis from the tensor about the centre of mass, and how far that centre lies from the axis.
declare function aboutAxis(inertia: [Vec3, Vec3, Vec3], mass: number, center: Vec3, axis: { origin: Vec3; direction: Vec3 }): { moment: number; distance: number };

export const mass: (typeof QUERIES)['mass'] = {
  title: 'Mass properties',
  summary: 'Mass, centre of mass and inertia of one body or of several taken as one rigid piece, from the volume and a density. A fill factor scales a printed part with infill.',
  returns:
    'mass (g), volume (mm3), centerOfMass (mm, model coordinates), inertia (g·mm2; the tensor about the centre of mass in the axes of the model, three rows; off the diagonal the negative products of inertia, as URDF writes them; 1 g·mm2 = 1e-9 kg·m2), about (with an axis: moment in g·mm2 and the perpendicular distance of the centre of mass from the axis in mm), bodies (each body with its mass, volume, the density of its material in g/cm3, the fill factor applied to it and its centre of mass; mass in g = density × fill × volume in mm3 / 1000).',
  args: MASS_ARGS,
  significant: { mass: 6, inertia: 6, moment: 6 },
  run(context, args) {
    const total = { mass: 0, volume: 0, first: [0, 0, 0] as Vec3, second: [0, 0, 0, 0, 0, 0] as MassIntegrals['second'] };
    const bodies: MassProperties['bodies'] = [];
    // a body named twice counts once
    for (const id of new Set(args.bodies)) {
      const solid = context.bodies[id].solid; // from the context: the same code answers for a pose
      const unit = context.memo([solid], 'integrals', () => massIntegrals(solid));
      if (!(unit.volume > 0)) throw new QueryFailure('failed', `the body "${id}" has no volume`, ['bodies', args.bodies.indexOf(id)]); // the place in the argument, not in the set
      // Whose density: the call's by body, then the body's own (3a), then the call's for all.
      // An own key of the record only: a body may have the ID `constructor`, which every object
      // has by inheritance (the engine guards its own records the same way: `has` in util.ts,
      // used by `lookup` in evaluate.ts).
      const named = args.densities !== undefined && Object.prototype.hasOwnProperty.call(args.densities, id) ? { density: args.densities[id] } : undefined;
      const own = named ?? massSourceOf(context, id);
      const source = own ?? (args.density === undefined ? undefined : { density: args.density });
      if (!source) throw new QueryFailure('failed', `the body "${id}" has no density: give \`density\``, ['density']);
      const density = 'mass' in source ? source.mass / unit.volume / GRAMS_PER_MM3 : source.density; // g/cm3, of the material
      const fill = own ? 1 : args.fill; // the fill factor goes with the fallback `density` only
      const perVolume = density * GRAMS_PER_MM3 * fill; // g per mm3
      const weight = perVolume * unit.volume;
      total.mass += weight;
      total.volume += unit.volume;
      total.first = total.first.map((value, k) => value + perVolume * unit.first[k]) as Vec3;
      total.second = total.second.map((value, k) => value + perVolume * unit.second[k]) as MassIntegrals['second'];
      bodies.push({ body: id, mass: weight, volume: unit.volume, density, fill, centerOfMass: unit.first.map((value) => value / unit.volume) as Vec3 });
    }
    // a fill factor that reached no body was meant for something: say so instead of ignoring it
    if (args.fill !== 1 && bodies.every((body) => body.fill === 1)) throw new QueryFailure('failed', 'the fill factor applies to bodies that take `density`, and none of the listed bodies does: give their densities as effective ones', ['fill']);
    const centerOfMass = total.first.map((value) => value / total.mass) as Vec3;
    const inertia = tensorAbout(total.second, total.mass, centerOfMass);
    const result: MassProperties = { mass: total.mass, volume: total.volume, centerOfMass, inertia, bodies };
    if (!args.about) return result;
    const axis = context.axis(args.about); // a base axis or a sketch point: never posed
    if ('problem' in axis) throw new QueryFailure('notAvailable', 'the axis is not in this state', ['about']);
    return { ...result, about: aboutAxis(inertia, total.mass, centerOfMass, axis) };
  },
};
export const registered: Pick<typeof QUERIES, 'mass'> = { mass };
export const FIXTURE: { args: QueryArgs<'mass'> } = { args: { bodies: ['a'], density: 1 } };

// No view in the app: the generic form of 1b shows the answer as a tree, with the units below.
export const units: (typeof QUERY_UNITS)['mass'] = MASS_UNITS;
