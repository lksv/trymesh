// The reader of DXF of the import of an outline (D72): ASCII DXF of any release, read by hand. The
// groups, the header (`$INSUNITS`, `$MEASUREMENT`), the entities `LINE`, `ARC`, `CIRCLE`,
// `LWPOLYLINE`, `POLYLINE` with its `VERTEX` entities, and `SPLINE`. A file that is not a whole DXF
// is refused (`unreadable`, with the line); a complete entity the reader does not take is left out
// and listed (`skipped`); the limits are checked while it reads. A curve without extent is read as
// it is written: it takes its place in the order of the file (its local ID) and is left out by the
// weld. docs/d36/6f-outline-import/design.md, "The readers: DXF".
import { OUTLINE_LIMITS } from '../imported-curve';
import type { ArgSpecs, RunArgsOf } from '../query/args';
import { bsplineBeziers } from '../spline';
import type { ImportedCurve, Vec2 } from '../types';
import { ImportFailure, OUTLINE_SHARED_OPTIONS, type OutlineFormatSpec, type ReadOutline } from './spec';

export const DXF_OPTIONS = {
  ...OUTLINE_SHARED_OPTIONS,
  unit: {
    kind: 'choice',
    options: ['mm', 'cm', 'm', 'in', 'ft', 'mil', 'um', 'dm'],
    title: 'Unit of the file',
    summary:
      'What one unit of the file is. Without it the header says (`$INSUNITS`: inches, feet, millimetres, centimetres, metres, microinches, mils, yards, microns, decimetres; any other value needs this option); a file that does not say is read in millimetres, and the report says so.',
    optional: true,
  },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface OutlineFormats {
    dxf: typeof DXF_OPTIONS;
  }
}

// What the reader takes, as data for its tests and its summary.
export const DXF_READS = {
  entities: ['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'],
  // in the coordinates of their own plane (mirrored when 230 is negative); LINE and SPLINE are in
  // world coordinates and are never mirrored
  ocs: ['ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE'],
  insunits: { 0: 'mm', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 8: 'uin', 9: 'mil', 10: 'yd', 13: 'um', 14: 'dm' },
  unitInMm: { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, uin: 2.54e-5, mil: 0.0254, yd: 914.4, um: 0.001, dm: 100 },
  knots: 1e-9, // of the span of the knots: closer knots are one; the ends are clamped within it
  counts: { LWPOLYLINE: [90], SPLINE: [72, 73, 74] },
  comment: 999, // a group passed over wherever it stands
  paperSpace: 67, // 1: the entity is left out and listed, a POLYLINE with its vertices
} as const;

// A table that is looked up by text of the file or of the caller has no prototype: `constructor`
// and `__proto__` are then names like any other, found in no table.
const table = <T>(rows: Record<string, T>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, rows);
const UNITS: Record<string, number> = table({ ...DXF_READS.unitInMm });
const INSUNITS: Record<string, string> = table(Object.fromEntries(Object.entries(DXF_READS.insunits).filter(([code]) => code !== '0')));

const unreadable = (message: string): never => {
  throw new ImportFailure('unreadable', message);
};
const tooLarge = (message: string): never => {
  throw new ImportFailure('tooLarge', message);
};
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

// A group: its code, its value (trimmed) and the line of its code in the file, from 1.
type Group = [number, string, number];
// The groups of the file up to the group `0 EOF`, which has to be there: what follows it is not
// read, and a file without it is cut short. A comment (the group 999 with its value) is passed
// over wherever it stands, so the group after `0 SECTION` is its name and the group after
// `9 $INSUNITS` its value, whatever a writer put between them.
function groups(text: string): Group[] {
  if (text.startsWith('AutoCAD Binary DXF')) unreadable('a binary DXF; save it as ASCII (text) DXF');
  if (text.startsWith('AC10')) unreadable('a DWG file, not a DXF; save it as ASCII (text) DXF');
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Group[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const written = lines[i].trim();
    if (written === '' && lines.slice(i).every((line) => line.trim() === '')) break; // blank lines at the end
    const code = Number(written);
    if (written === '' || !Number.isInteger(code)) unreadable(`line ${i + 1}: a group code is expected, not "${lines[i].slice(0, 20)}"`);
    if (i + 1 >= lines.length) unreadable(`line ${i + 1}: the group code ${code} has no value; the file is cut short`);
    const value = lines[i + 1].trim();
    if (code === DXF_READS.comment) continue;
    out.push([code, value, i + 1]);
    if (code === 0 && value === 'EOF') return out;
  }
  if (!out.some(([code]) => code === 0)) unreadable('not a DXF file (no entity and no EOF)');
  return unreadable('the file is cut short: no EOF');
}

// The number of a group, never an empty value read as 0.
function numberOf([code, value, line]: Group, of: string): number {
  const number = value === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) unreadable(`line ${line + 1}: the group ${code} of ${of} is "${value}", not a number`);
  return number;
}

// An arc from `p` to `q` with the bulge `b` (the tangent of a quarter of the angle it turns by,
// positive counter-clockwise), as a counter-clockwise arc: its centre is
// `(p + q) / 2 + ((1 − b²) / (4b)) · perp(q − p)`.
function bulgeArc(p: Vec2, q: Vec2, b: number): ImportedCurve {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const k = (1 - b * b) / (4 * b);
  const center: Vec2 = [(p[0] + q[0]) / 2 - k * dy, (p[1] + q[1]) / 2 + k * dx];
  return b > 0 ? { type: 'arc', center, start: p, end: q } : { type: 'arc', center, start: q, end: p };
}

// The segments of a polyline: a line per pair of vertices, or the arc of its bulge; vertices at one
// place make no segment.
function chain(vertices: { at: Vec2; bulge: number }[], closed: boolean): ImportedCurve[] {
  const out: ImportedCurve[] = [];
  const n = vertices.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [v, w] = [vertices[i], vertices[(i + 1) % n]];
    if (dist(v.at, w.at) === 0) continue;
    out.push(v.bulge === 0 ? { type: 'line', a: v.at, b: w.at } : bulgeArc(v.at, w.at, v.bulge));
  }
  return out;
}

// A SPLINE as curves, or the reason it is left out. `control` in mm; `written` the knots as written.
// - Kept whole: a cubic of 4 to 64 control points whose knots are clamped and even is the spline
//   of a sketch over the same control points (D70: clamped, uniform, of degree min(3, n − 1)); so is
//   a quadratic of exactly 3.
// - Otherwise its Bezier pieces (`bsplineBeziers`), a line each for degree 1. A piece without
//   extent is read as it is and left out by the weld; knots a digit apart are one knot, so they make
//   no such piece.
// `bsplineBeziers` checks neither the order of the knots nor that they are clamped: this does,
// before it.
export function splineCurves(control: Vec2[], written: number[], degree: number, line: number): { curves: ImportedCurve[] } | { skipped: string } {
  const p = degree;
  const n = control.length;
  for (let i = 1; i < written.length; i++) if (written[i] < written[i - 1]) unreadable(`line ${line}: SPLINE: its knots are out of order (${written[i - 1]}, then ${written[i]})`);
  const span = written[written.length - 1] - written[0];
  if (!(span > 0)) return { skipped: 'SPLINE (no extent)' };
  const knots: number[] = [];
  for (const u of written) knots.push(knots.length > 0 && u - knots[knots.length - 1] <= DXF_READS.knots * span ? knots[knots.length - 1] : u);
  if (knots[p] !== knots[0] || knots[n] !== knots[n + p]) return { skipped: 'SPLINE (periodic or unclamped)' };
  const [low, high] = [knots[p], knots[n]];
  if (!(high > low)) return { skipped: 'SPLINE (no extent)' };
  const count = new Map<number, number>();
  for (const u of knots) count.set(u, (count.get(u) ?? 0) + 1);
  // a knot more often than the degree inside, or more often than the degree + 1 at an end: the
  // curve breaks there, or a control point is used by no span
  for (const [u, times] of count) if (times > (u === low || u === high ? p + 1 : p)) return { skipped: 'SPLINE (discontinuous)' };
  const inner = [...count.keys()].filter((u) => u > low && u < high);
  const step = (high - low) / (inner.length + 1);
  const even = inner.every((u, i) => count.get(u) === 1 && Math.abs(u - (low + (i + 1) * step)) <= DXF_READS.knots * span);
  if (even && ((p === 3 && n >= 4 && n <= OUTLINE_LIMITS.splinePoints) || (p === 2 && n === 3))) return { curves: [{ type: 'spline', points: control }] };
  return { curves: bsplineBeziers(control, knots, p).map((piece): ImportedCurve => (p === 1 ? { type: 'line', a: piece[0], b: piece[1] } : { type: 'spline', points: piece })) };
}

type DxfOptions = RunArgsOf<typeof DXF_OPTIONS>;

export function readDxf(bytes: Uint8Array, options: DxfOptions): ReadOutline {
  if (bytes.length > OUTLINE_LIMITS.bytes) tooLarge(`the file has ${bytes.length} bytes, more than ${OUTLINE_LIMITS.bytes}`);
  const text = new TextDecoder('utf-8').decode(bytes);
  const all = groups(text);
  let insunits: number | undefined;
  let measurement: number | undefined;
  // a file without sections is a bare list of entities up to EOF
  const bare = !all.some(([code, value]) => code === 0 && value === 'SECTION');
  let section: string | undefined = bare ? 'ENTITIES' : undefined;
  let opened = 0;
  const entities: Group[][] = [];
  for (let i = 0; i < all.length; i++) {
    const [code, value, line] = all[i];
    if (code === 0 && value === 'EOF') break;
    if (code === 0 && value === 'SECTION') {
      if (section !== undefined) unreadable(`line ${line}: a SECTION inside the section that starts at line ${opened} (no ENDSEC)`);
      section = all[i + 1]?.[0] === 2 ? all[i + 1][1] : '';
      opened = line;
      i++;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      if (section === undefined || bare) unreadable(`line ${line}: ENDSEC without a SECTION`);
      section = undefined;
      continue;
    }
    if (section === 'HEADER' && code === 9 && all[i + 1]?.[0] === 70) {
      if (value === '$INSUNITS') insunits = numberOf(all[i + 1], '$INSUNITS');
      if (value === '$MEASUREMENT') measurement = numberOf(all[i + 1], '$MEASUREMENT');
    }
    if (section === 'ENTITIES') {
      if (code === 0) entities.push([all[i]]);
      else entities[entities.length - 1]?.push(all[i]);
    }
  }
  if (!bare && section !== undefined) unreadable(`the section that starts at line ${opened} has no ENDSEC`);
  const fromHeader = insunits !== undefined ? INSUNITS[String(insunits)] : undefined;
  if (options.unit === undefined && insunits !== undefined && insunits !== 0 && fromHeader === undefined) unreadable(`the unit $INSUNITS ${insunits} is not read; give the option unit (${Object.keys(UNITS).filter((u) => u !== 'uin' && u !== 'yd').join(', ')})`);
  const [unit, unitFrom]: [string, 'option' | 'file' | 'default'] = options.unit !== undefined ? [options.unit, 'option'] : fromHeader !== undefined ? [fromHeader, 'file'] : ['mm', 'default'];
  const scale = UNITS[unit];
  const notes: string[] = [];
  if (unitFrom === 'default') notes.push(measurement === 0 ? 'The header states no unit ($INSUNITS) and says imperial ($MEASUREMENT 0): the file is read in millimetres; give the option unit "in" if it is drawn in inches.' : 'The file states no unit ($INSUNITS): it is read in millimetres.');
  const mm = (v: number): number => v * scale;
  const curves: ReadOutline['curves'] = [];
  // counted in dictionaries without a prototype: a layer of the file may be named `__proto__` or
  // `constructor`, and a name of the file is never looked up on `Object.prototype` nor written to it
  const layers: Record<string, Record<string, number>> = Object.create(null);
  const skipped: Record<string, number> = Object.create(null);
  const skip = (what: string): void => void (skipped[what] = (skipped[what] ?? 0) + 1);
  const number = (entity: Group[], code: number, fallback?: number): number => {
    const found = entity.find(([c]) => c === code);
    if (!found) return fallback !== undefined ? fallback : unreadable(`line ${entity[0][2]}: ${entity[0][1]} without the group ${code}`);
    return numberOf(found, entity[0][1]);
  };
  const every = (entity: Group[], code: number): number[] => entity.filter(([c]) => c === code).map((group) => numberOf(group, entity[0][1]));
  let control = 0;
  const take = (layer: string, made: ImportedCurve[]): void => {
    for (const curve of made) {
      if (curves.length >= OUTLINE_LIMITS.read) tooLarge(`more than ${OUTLINE_LIMITS.read} curves on the layers read; an outline holds ${OUTLINE_LIMITS.curves}`);
      if (curve.type === 'spline') {
        control += curve.points.length;
        if (control > OUTLINE_LIMITS.readControl) tooLarge(`more than ${OUTLINE_LIMITS.readControl} control points of splines on the layers read; the splines of an outline hold ${OUTLINE_LIMITS.control} together`);
      }
      curves.push({ curve, layer });
    }
  };
  // What an entity declares of itself against what it holds; a count that is not written (an old
  // writer) is no error.
  const declared = (entity: Group[], code: number, read: number, what: string): void => {
    const found = entity.find(([c]) => c === code);
    if (!found) return;
    const count = numberOf(found, entity[0][1]);
    if (count !== read) unreadable(`line ${entity[0][2]}: ${entity[0][1]} declares ${count} ${what} (group ${code}) and holds ${read}`);
  };
  // The extrusion direction of an entity of its own plane (CIRCLE, ARC, LWPOLYLINE, a 2D POLYLINE):
  // (0, 0, 1) as it is, (0, 0, −1) mirrors x, any other is not read.
  const plane = (entity: Group[]): 'up' | 'down' | 'tilted' => (Math.abs(number(entity, 210, 0)) > 1e-9 || Math.abs(number(entity, 220, 0)) > 1e-9 ? 'tilted' : number(entity, 230, 1) < 0 ? 'down' : 'up');
  let lifted = false;
  const z = (entity: Group[]): void => {
    if (entity.some((group) => (group[0] === 30 || group[0] === 31 || group[0] === 38) && numberOf(group, entity[0][1]) !== 0)) lifted = true;
  };
  let polyline: { layer: string; closed: boolean; vertices: { at: Vec2; bulge: number }[]; wanted: boolean; sx: number; line: number } | undefined;
  for (const entity of entities) {
    const type = entity[0][1];
    const at = entity[0][2];
    const layer = entity.find(([c]) => c === 8)?.[1] ?? '0';
    if (type === 'VERTEX') {
      if (!polyline) unreadable(`line ${at}: a VERTEX outside a POLYLINE`);
      const open = polyline as NonNullable<typeof polyline>;
      // a control point of the frame of a spline-fit polyline is not on the curve
      if (open.wanted && (number(entity, 70, 0) & 16) === 0) {
        open.vertices.push({ at: [open.sx * mm(number(entity, 10)), mm(number(entity, 20))], bulge: open.sx * number(entity, 42, 0) });
        z(entity);
      }
      continue;
    }
    if (type === 'SEQEND') {
      // also the end of the attributes of an INSERT, which is no polyline
      if (polyline?.wanted) take(polyline.layer, chain(polyline.vertices, polyline.closed));
      polyline = undefined;
      continue;
    }
    if (polyline) unreadable(`line ${at}: ${type} inside the POLYLINE that starts at line ${polyline.line} (no SEQEND)`);
    layers[layer] ??= Object.create(null) as Record<string, number>;
    layers[layer][type] = (layers[layer][type] ?? 0) + 1;
    const wanted = options.layers === undefined || options.layers.includes(layer);
    // An entity of paper space (a layout) is no part of the model: left out and listed, before its
    // type is looked at; a POLYLINE decides for its vertices.
    if (number(entity, DXF_READS.paperSpace, 0) === 1) {
      if (wanted) skip(`${type} (paper space)`);
      if (type === 'POLYLINE') polyline = { layer, closed: false, vertices: [], wanted: false, sx: 1, line: at };
      continue;
    }
    switch (type) {
      case 'LINE':
        // in world coordinates: an extrusion direction neither mirrors it nor leaves it out
        if (!wanted) break;
        take(layer, [{ type: 'line', a: [mm(number(entity, 10)), mm(number(entity, 20))], b: [mm(number(entity, 11)), mm(number(entity, 21))] }]);
        z(entity);
        break;
      case 'CIRCLE': {
        if (!wanted) break;
        const side = plane(entity);
        if (side === 'tilted') {
          skip('CIRCLE (tilted extrusion)');
          break;
        }
        take(layer, [{ type: 'circle', center: [(side === 'down' ? -1 : 1) * mm(number(entity, 10)), mm(number(entity, 20))], radius: mm(number(entity, 40)) }]);
        z(entity);
        break;
      }
      case 'ARC': {
        if (!wanted) break;
        const side = plane(entity);
        if (side === 'tilted') {
          skip('ARC (tilted extrusion)');
          break;
        }
        const center: Vec2 = [(side === 'down' ? -1 : 1) * mm(number(entity, 10)), mm(number(entity, 20))];
        const r = mm(number(entity, 40));
        const [d0, d1] = [number(entity, 50), number(entity, 51)];
        z(entity);
        // equal angles, or a whole turn apart: a circle
        const turn = (((d1 - d0) % 360) + 360) % 360;
        if (turn < 1e-9 || 360 - turn < 1e-9) {
          take(layer, [{ type: 'circle', center, radius: r }]);
          break;
        }
        const [a0, a1] = [(d0 * Math.PI) / 180, (d1 * Math.PI) / 180];
        // mirrored, the arc runs the other way: counter-clockwise from the image of its end
        const [from, to] = side === 'down' ? [Math.PI - a1, Math.PI - a0] : [a0, a1];
        take(layer, [{ type: 'arc', center, start: [center[0] + r * Math.cos(from), center[1] + r * Math.sin(from)], end: [center[0] + r * Math.cos(to), center[1] + r * Math.sin(to)] }]);
        break;
      }
      case 'LWPOLYLINE': {
        if (!wanted) break;
        const side = plane(entity);
        if (side === 'tilted') {
          skip('LWPOLYLINE (tilted extrusion)');
          break;
        }
        const sx = side === 'down' ? -1 : 1;
        const vertices: { at: Vec2; bulge: number; y: boolean }[] = [];
        for (const group of entity) {
          const last = vertices[vertices.length - 1];
          if (group[0] === 10) {
            if (last && !last.y) unreadable(`line ${group[2]}: a vertex of LWPOLYLINE without its y (group 20)`);
            vertices.push({ at: [sx * mm(numberOf(group, type)), 0], bulge: 0, y: false });
          } else if (group[0] === 20 && last && !last.y) {
            last.at[1] = mm(numberOf(group, type));
            last.y = true;
          } else if (group[0] === 42 && last) last.bulge = sx * numberOf(group, type);
        }
        if (vertices.length > 0 && !vertices[vertices.length - 1].y) unreadable(`line ${at}: a vertex of LWPOLYLINE without its y (group 20)`);
        declared(entity, 90, vertices.length, 'vertices');
        take(layer, chain(vertices, (number(entity, 70, 0) & 1) === 1));
        z(entity);
        break;
      }
      case 'POLYLINE': {
        const flags = number(entity, 70, 0);
        const side = flags & (8 | 16 | 32 | 64) ? 'solid' : plane(entity);
        if (side === 'solid' || side === 'tilted') {
          if (wanted) skip(side === 'solid' ? 'POLYLINE (3D or mesh)' : 'POLYLINE (tilted extrusion)');
          polyline = { layer, closed: false, vertices: [], wanted: false, sx: 1, line: at };
        } else {
          polyline = { layer, closed: (flags & 1) === 1, vertices: [], wanted, sx: side === 'down' ? -1 : 1, line: at };
          if (wanted) z(entity);
        }
        break;
      }
      case 'SPLINE': {
        // in world coordinates, as a LINE
        if (!wanted) break;
        const flags = number(entity, 70, 0);
        const degree = number(entity, 71);
        const knots = every(entity, 40);
        const weights = every(entity, 41);
        const [xs, ys] = [every(entity, 10), every(entity, 20)];
        if (xs.length !== ys.length) unreadable(`line ${at}: SPLINE with ${xs.length} x and ${ys.length} y of its control points`);
        declared(entity, 72, knots.length, 'knots');
        declared(entity, 73, xs.length, 'control points');
        declared(entity, 74, every(entity, 11).length, 'fit points');
        if (xs.length > OUTLINE_LIMITS.readSpline) tooLarge(`line ${at}: a SPLINE of ${xs.length} control points, more than ${OUTLINE_LIMITS.readSpline}`);
        const points = xs.map((x, i): Vec2 => [mm(x), mm(ys[i])]);
        if (points.length === 0 && entity.some(([c]) => c === 11)) skip('SPLINE (fit points only)');
        else if (flags & 4 || weights.some((w) => w !== weights[0])) skip('SPLINE (rational)');
        else if (!Number.isInteger(degree) || degree > 3 || degree < 1) skip(`SPLINE (degree ${degree})`);
        else if (points.length < degree + 1 || knots.length !== points.length + degree + 1)
          unreadable(`line ${at}: SPLINE of degree ${degree} over ${points.length} control points needs ${points.length + degree + 1} knots, and at least ${degree + 1} points; it has ${knots.length} knots`);
        else {
          const made = splineCurves(points, knots, degree, at);
          if ('skipped' in made) skip(made.skipped);
          else {
            take(layer, made.curves);
            z(entity);
          }
        }
        break;
      }
      default:
        if (wanted) skip(type);
    }
  }
  if (polyline) unreadable(`the POLYLINE that starts at line ${polyline.line} has no SEQEND`);
  if (lifted) notes.push('Some entities are not at z = 0; their z is not read, the outline is their plan.');
  return { curves, about: { unit, unitFrom, layers, skipped, notes } };
}

export const dxf: OutlineFormatSpec<typeof DXF_OPTIONS> = {
  title: 'DXF',
  summary:
    'ASCII DXF of any release (a binary DXF or a DWG is refused). Read: LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE with bulges (arcs), SPLINE of degree 1 to 3 that is not rational (a cubic with even, clamped knots and 4 to 64 control points is one spline, any other its Bezier pieces). In the plane z = 0: an entity drawn from below (extrusion direction (0, 0, −1)) is mirrored; one on a tilted plane, of paper space, INSERT (blocks), ELLIPSE, TEXT, HATCH, DIMENSION and every other type are left out and listed in the report. Layers by the group 8; the unit by `$INSUNITS` or the option.',
  extensions: ['dxf'],
  options: DXF_OPTIONS,
  read: readDxf,
};
