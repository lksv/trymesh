// The query `hardwareHole` (D46): the shape and the label of a hole for a screw, a nut or a heat-set
// insert of a size, from the hardware catalogs. It is the tool that composes a hole feature, as a
// query, so that the form of the app and an AI through the tool `query` fill the fields the same
// way. It reads no state.
import { type Catalogs, DATA_CATALOGS } from '../data-catalogs';
import { analyzeExpression } from '../expression';
import type { HoleShape, Input } from '../types';
import { has } from '../util';
import type { ArgSpecs } from './args';
import { QueryFailure, type QuerySpec } from './spec';

export const HARDWARE_HOLE_ARGS = {
  use: {
    kind: 'choice',
    options: ['clearance', 'socketHead', 'countersunk', 'nutPocket', 'heatSetInsert', 'tapped'],
    title: 'What the hole is for',
    summary:
      'clearance: a plain hole the screw passes through; socketHead: a counterbore for a socket head cap screw; countersunk: a countersink for a countersunk screw; nutPocket: a hexagon pocket for a nut with a clearance hole; heatSetInsert: a plain blind hole for an insert, with its depth; tapped: a plain hole at the tap-drill diameter of a thread of the catalog metricThreads, with the fields of the thread to put on its bores (D76).',
  },
  size: { kind: 'text', title: 'Size', summary: 'A row of the catalogs: the thread for a screw or a nut ("M3"), the size as sold for a heat-set insert (the keys of the catalog heatSetInserts), a thread of the catalog metricThreads for a tapped hole ("M6", "M8x1").' },
  fit: { kind: 'choice', options: ['fine', 'medium', 'coarse'], title: 'Clearance series of the through hole', summary: 'Without it medium.', optional: true },
  allowance: { kind: 'text', title: 'Allowance', summary: 'An expression added to every diameter and to the size across flats, such as the name of a parameter that compensates the printer. Without it the fields are numbers.', optional: true },
} as const satisfies ArgSpecs;

// - `label`: absent for the use `tapped`. The parts list counts a piece of hardware per labelled
//   hole, and a tapped hole takes the screw that is counted at the clearance hole it comes through;
//   the parts list leaves a hole whose bore carries a thread out of its `unlabelled` holes.
// - `thread` (the use `tapped`, D76): `diameter`, `pitch` and `label` ("M6") for a feature of the
//   type thread whose `faces` are the bores of the hole (`{ feature: <hole>, role: 'holeBore',
//   point }`); with an allowance also `clearance`, half of the allowance (an expression): the
//   thread of a bore widened by the allowance is the thread of the diameter larger by it, and the
//   bore stays inside the window of the thread.
export interface HardwareHole {
  shape: Input<HoleShape>; // goes into `shape` of a hole feature as it is
  label?: string; // "M3 countersunk screw"
  depth?: number; // heatSetInsert: the least depth of the hole in mm, for `extent.distance`
  thread?: { diameter: number; pitch: number; clearance?: number | string; label: string };
  from: (keyof Catalogs)[]; // the catalogs the numbers came from, by name
}

declare module './spec' {
  interface Queries {
    hardwareHole: { spec: typeof HARDWARE_HOLE_ARGS; result: HardwareHole };
  }
}

// The row of a size, or `notAvailable` that names the catalog without it.
function rowOf<N extends keyof Catalogs>(catalog: N, size: string): Catalogs[N] {
  const rows = DATA_CATALOGS[catalog].rows as Record<string, Catalogs[N]>;
  if (!has(rows, size)) throw new QueryFailure('notAvailable', `size: the catalog ${catalog} has no size "${size}"; it has ${Object.keys(rows).join(', ') || 'no rows'}`, ['size']);
  return rows[size];
}
// An angle goes out as an expression in degrees: the tool `query` rounds numbers to six decimal
// places, which an angle in radians rarely survives, and a person reads the degrees a standard prints.
const degrees = (radians: number): string => `deg(${Number(((radians * 180) / Math.PI).toFixed(9))})`;

export const hardwareHole: QuerySpec<typeof HARDWARE_HOLE_ARGS, HardwareHole> = {
  geometry: 'none', // reads no geometry of bodies (D49)
  title: 'Hole for a piece of hardware',
  summary:
    'The shape of a hole for a screw, a nut or a heat-set insert of a size, from the hardware catalogs: put `shape` and `label` of the answer into a feature of the type hole (and for an insert `depth` into its extent). A tapped hole (the use `tapped`) is a plain hole at the tap drill of the catalog metricThreads and a feature of the type thread on its bores: put `shape` into the hole (it has no label: the screw is counted at the hole it comes through) and the fields of `thread` into the thread feature. ' +
    'The heads and the nut are the largest sizes the standards allow and nothing is added to them; room for the printer is the allowance, best a parameter. The catalogs are clearanceHoles, socketHeadScrews, countersunkScrews, hexNuts, heatSetInserts and metricThreads; the query `catalog` shows their rows and sources.',
  returns: '`shape` (a hole shape with its numeric fields in mm, expressions when an allowance was given; the angle of a countersink is always an expression in degrees), `label` (not for `tapped`), `depth` in mm for an insert, `thread` for `tapped` (`diameter`, `pitch`, `label`, and with an allowance `clearance`, half of it, for a thread feature on the bores of the hole), and `from` (the names of the catalogs used).',
  args: HARDWARE_HOLE_ARGS,
  run(_context, { use, size, fit, allowance }) {
    if (allowance !== undefined) {
      const syntax = analyzeExpression(allowance);
      if (!syntax.ok) throw new QueryFailure('invalidArguments', `allowance: "${allowance}" is not an expression of a number: ${syntax.error.message}`, ['allowance']);
    }
    const plus = (value: number): number | string => (allowance === undefined ? value : `${value} + ${allowance.trim()}`);
    // the use first: each asks only the catalogs it reads
    if (use === 'tapped') {
      const thread = rowOf('metricThreads', size);
      return {
        shape: { type: 'plain', diameter: plus(thread.tapDrill) },
        thread: { diameter: thread.diameter, pitch: thread.pitch, ...(allowance === undefined ? {} : { clearance: `(${allowance.trim()}) / 2` }), label: size },
        from: ['metricThreads'],
      };
    }
    if (use === 'heatSetInsert') {
      const insert = rowOf('heatSetInserts', size);
      return { shape: { type: 'plain', diameter: plus(insert.holeDiameter) }, label: `${size} heat-set insert`, depth: insert.holeDepth, from: ['heatSetInserts'] };
    }
    const diameter = plus(rowOf('clearanceHoles', size)[fit ?? 'medium']);
    if (use === 'socketHead') {
      const screw = rowOf('socketHeadScrews', size);
      return { shape: { type: 'counterbore', diameter, headDiameter: plus(screw.headDiameter), headDepth: screw.headHeight }, label: `${size} socket head cap screw`, from: ['clearanceHoles', 'socketHeadScrews'] };
    }
    if (use === 'countersunk') {
      const screw = rowOf('countersunkScrews', size);
      return { shape: { type: 'countersink', diameter, headDiameter: plus(screw.headDiameter), angle: degrees(screw.headAngle) }, label: `${size} countersunk screw`, from: ['clearanceHoles', 'countersunkScrews'] };
    }
    if (use === 'nutPocket') {
      const nut = rowOf('hexNuts', size);
      return { shape: { type: 'nutPocket', diameter, acrossFlats: plus(nut.acrossFlats), headDepth: nut.thickness, rotation: 0 }, label: `${size} hex nut`, from: ['clearanceHoles', 'hexNuts'] };
    }
    return { shape: { type: 'plain', diameter }, label: `${size} clearance hole`, from: ['clearanceHoles'] };
  },
};
