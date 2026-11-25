// The reader of DXF of the prototype of 6f (D72): groups, the header, the entities. Moved out of
// proto.ts so that the reader and the kind can be changed apart. Revised after the reviews of the
// design: a file that is not whole or not well formed is refused (`unreadable`), an entity the
// reader does not take is listed (`skipped`), and the limits are checked while reading.
import { bsplineBeziers } from '../../../../packages/engine/src/spline';
import type { ImportedCurve, Vec2 } from './proto';

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export interface ReadCurve {
  curve: ImportedCurve;
  layer: string;
}
export interface ReadOutline {
  curves: ReadCurve[];
  about: { unit: string; unitFrom?: 'option' | 'file' | 'default'; insunits?: number; layers: Record<string, number>; skipped: Record<string, number>; notes?: string[] };
}

// The limits of a read, checked before any weld.
// - `characters`: of the text of the file.
// - `curves`: read from the chosen layers; four times what an outline holds, so that a file whose
//   weld drops curves can still come under the limit of an outline.
// - `splinePoints`: the control points of one SPLINE.
export const DXF_MAX_CHARACTERS = 8_000_000;
export const DXF_MAX_CURVES = 8000;
export const DXF_MAX_SPLINE_POINTS = 2000;
// How near two knots are one knot, and how even the knots of a uniform spline are: relative to the
// span of the knots.
const KNOT_TOLERANCE = 1e-9;
// Under this total length of its control polygon a piece of a spline has no extent, mm.
const NO_EXTENT = 1e-6;

const INSUNITS: Record<number, [string, number]> = {
  1: ['in', 25.4],
  2: ['ft', 304.8],
  4: ['mm', 1],
  5: ['cm', 10],
  6: ['m', 1000],
  8: ['microinch', 2.54e-5],
  9: ['mil', 0.0254],
  10: ['yd', 914.4],
  13: ['um', 0.001],
  14: ['dm', 100],
};
const UNITS: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, mil: 0.0254, um: 0.001, dm: 100 };

// A group: its code, its value (trimmed) and the line of its code in the file, from 1.
type Group = [number, string, number];
// The groups of the file up to the group `0 EOF`, which has to be there: what follows it is not
// read, and a file without it is cut short.
function groups(text: string): Group[] {
  if (text.length > DXF_MAX_CHARACTERS) throw new Error(`tooLarge: the file has ${text.length} characters, more than ${DXF_MAX_CHARACTERS}`);
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('unreadable: a binary DXF; save it as ASCII (text) DXF');
  if (text.startsWith('AC10')) throw new Error('unreadable: a DWG file, not a DXF; save it as ASCII (text) DXF');
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Group[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const written = lines[i].trim();
    if (written === '' && lines.slice(i).every((line) => line.trim() === '')) break; // blank lines at the end
    const code = Number(written);
    if (written === '' || !Number.isInteger(code)) throw new Error(`unreadable: line ${i + 1}: a group code is expected, not "${lines[i].slice(0, 20)}"`);
    if (i + 1 >= lines.length) throw new Error(`unreadable: line ${i + 1}: the group code ${code} has no value; the file is cut short`);
    const value = lines[i + 1].trim();
    out.push([code, value, i + 1]);
    if (code === 0 && value === 'EOF') return out;
  }
  if (!out.some(([code]) => code === 0)) throw new Error('unreadable: not a DXF file (no entity and no EOF)');
  throw new Error('unreadable: the file is cut short: no EOF');
}

// The number of a group, never an empty value read as 0.
function numberOf([code, value, line]: Group, of: string): number {
  const number = value === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) throw new Error(`unreadable: line ${line + 1}: the group ${code} of ${of} is "${value}", not a number`);
  return number;
}

// An arc from `p` to `q` with the bulge `b` (the tangent of a quarter of the angle it turns by,
// positive counter-clockwise), as a counter-clockwise arc.
function bulgeArc(p: Vec2, q: Vec2, b: number): ImportedCurve {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const k = (1 - b * b) / (4 * b);
  const center: Vec2 = [(p[0] + q[0]) / 2 - k * dy, (p[1] + q[1]) / 2 + k * dx];
  return b > 0 ? { type: 'arc', center, start: p, end: q } : { type: 'arc', center, start: q, end: p };
}

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

// A SPLINE as curves, or the reason it is left out. `control` in mm; `knots` as written.
// - Kept whole: a cubic of 4 to 64 control points whose knots are clamped and uniform is the spline
//   of a sketch over the same control points (D70: clamped, uniform, of degree min(3, n − 1)); so is
//   a quadratic of exactly 3.
// - Otherwise its Bezier pieces (`bsplineBeziers`), a line each for degree 1; a piece without
//   extent is dropped and counted in `dropped`.
export function splineCurves(control: Vec2[], written: number[], degree: number): { curves: ImportedCurve[]; dropped: number } | { skipped: string } {
  const p = degree;
  const n = control.length;
  for (let i = 1; i < written.length; i++) if (written[i] < written[i - 1]) throw new Error(`unreadable: SPLINE: its knots are out of order (${written[i - 1]}, then ${written[i]})`);
  const span = written[written.length - 1] - written[0];
  if (!(span > 0)) return { skipped: 'SPLINE (no extent)' };
  // knots that differ in their last digits are one knot
  const knots: number[] = [];
  for (const u of written) knots.push(knots.length > 0 && u - knots[knots.length - 1] <= KNOT_TOLERANCE * span ? knots[knots.length - 1] : u);
  if (knots[p] !== knots[0] || knots[n] !== knots[n + p]) return { skipped: 'SPLINE (periodic or unclamped)' };
  const [low, high] = [knots[p], knots[n]];
  if (!(high > low)) return { skipped: 'SPLINE (no extent)' };
  const count = new Map<number, number>();
  for (const u of knots) count.set(u, (count.get(u) ?? 0) + 1);
  // a knot more often than the degree inside, or more often than the degree + 1 at an end: the
  // curve breaks there, or a control point is used by no span
  for (const [u, times] of count) if (times > (u === low || u === high ? p + 1 : p)) return { skipped: 'SPLINE (discontinuous)' };
  const polygon = (points: Vec2[]): number => points.slice(1).reduce((sum, q, i) => sum + dist(points[i], q), 0);
  const inner = [...count.keys()].filter((u) => u > low && u < high);
  const step = (high - low) / (inner.length + 1);
  const uniform = inner.every((u, i) => count.get(u) === 1 && Math.abs(u - (low + (i + 1) * step)) <= KNOT_TOLERANCE * span);
  if (uniform && ((p === 3 && n >= 4 && n <= 64) || (p === 2 && n === 3))) return polygon(control) < NO_EXTENT ? { skipped: 'SPLINE (no extent)' } : { curves: [{ type: 'spline', points: control }], dropped: 0 };
  const pieces = bsplineBeziers(control, knots, p);
  const kept = pieces.filter((piece) => polygon(piece) >= NO_EXTENT);
  return { curves: kept.map((piece): ImportedCurve => (p === 1 ? { type: 'line', a: piece[0], b: piece[1] } : { type: 'spline', points: piece })), dropped: pieces.length - kept.length };
}

export function readDxf(text: string, options: { layers?: string[]; unit?: string } = {}): ReadOutline {
  if (options.unit !== undefined && UNITS[options.unit] === undefined) throw new Error(`invalidArguments: unit: one of ${Object.keys(UNITS).join(', ')} is expected, not "${options.unit}"`);
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
      if (section !== undefined) throw new Error(`unreadable: line ${line}: a SECTION inside the section that starts at line ${opened} (no ENDSEC)`);
      section = all[i + 1]?.[0] === 2 ? all[i + 1][1] : '';
      opened = line;
      i++;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      if (section === undefined || bare) throw new Error(`unreadable: line ${line}: ENDSEC without a SECTION`);
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
  if (!bare && section !== undefined) throw new Error(`unreadable: the section that starts at line ${opened} has no ENDSEC`);
  const fromHeader = insunits !== undefined ? INSUNITS[insunits] : undefined;
  if (options.unit === undefined && insunits !== undefined && insunits !== 0 && !fromHeader) throw new Error(`unreadable: the unit $INSUNITS ${insunits} is not read; give the option unit (${Object.keys(UNITS).join(', ')})`);
  const [unit, scale, unitFrom]: [string, number, 'option' | 'file' | 'default'] = options.unit !== undefined ? [options.unit, UNITS[options.unit], 'option'] : fromHeader ? [...fromHeader, 'file'] : ['mm', 1, 'default'];
  const notes: string[] = [];
  if (unitFrom === 'default') notes.push(measurement === 0 ? 'The header states no unit ($INSUNITS) and says imperial ($MEASUREMENT 0): the file is read in millimetres; give the option unit "in" if it is drawn in inches.' : 'The file states no unit ($INSUNITS): it is read in millimetres.');
  const mm = (v: number): number => v * scale;
  const curves: ReadCurve[] = [];
  const layers: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const skip = (what: string, times = 1): void => void (skipped[what] = (skipped[what] ?? 0) + times);
  const number = (entity: Group[], code: number, fallback?: number): number => {
    const found = entity.find(([c]) => c === code);
    if (!found) {
      if (fallback !== undefined) return fallback;
      throw new Error(`unreadable: line ${entity[0][2]}: ${entity[0][1]} without the group ${code}`);
    }
    return numberOf(found, entity[0][1]);
  };
  const every = (entity: Group[], code: number): number[] => entity.filter(([c]) => c === code).map((group) => numberOf(group, entity[0][1]));
  const take = (layer: string, made: ImportedCurve[]): void => {
    for (const curve of made) {
      if (curves.length >= DXF_MAX_CURVES) throw new Error(`tooLarge: more than ${DXF_MAX_CURVES} curves on the layers read; an outline holds 2000`);
      curves.push({ curve, layer });
    }
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
      if (!polyline) throw new Error(`unreadable: line ${at}: a VERTEX outside a POLYLINE`);
      // a control point of the frame of a spline-fit polyline is not on the curve
      if (polyline.wanted && (number(entity, 70, 0) & 16) === 0) {
        polyline.vertices.push({ at: [polyline.sx * mm(number(entity, 10)), mm(number(entity, 20))], bulge: polyline.sx * number(entity, 42, 0) });
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
    if (polyline) throw new Error(`unreadable: line ${at}: ${type} inside the POLYLINE that starts at line ${polyline.line} (no SEQEND)`);
    layers[layer] = (layers[layer] ?? 0) + 1;
    const wanted = options.layers === undefined || options.layers.includes(layer);
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
        // equal angles, or a whole turn apart: a circle
        const turn = (((d1 - d0) % 360) + 360) % 360;
        z(entity);
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
            if (last && !last.y) throw new Error(`unreadable: line ${group[2]}: a vertex of LWPOLYLINE without its y (group 20)`);
            vertices.push({ at: [sx * mm(numberOf(group, type)), 0], bulge: 0, y: false });
          } else if (group[0] === 20 && last && !last.y) {
            last.at[1] = mm(numberOf(group, type));
            last.y = true;
          } else if (group[0] === 42 && last) last.bulge = sx * numberOf(group, type);
        }
        if (vertices.length > 0 && !vertices[vertices.length - 1].y) throw new Error(`unreadable: line ${at}: a vertex of LWPOLYLINE without its y (group 20)`);
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
        if (xs.length !== ys.length) throw new Error(`unreadable: line ${at}: SPLINE with ${xs.length} x and ${ys.length} y of its control points`);
        if (xs.length > DXF_MAX_SPLINE_POINTS) throw new Error(`tooLarge: line ${at}: a SPLINE of ${xs.length} control points, more than ${DXF_MAX_SPLINE_POINTS}`);
        const control = xs.map((x, i): Vec2 => [mm(x), mm(ys[i])]);
        if (control.length === 0 && entity.some(([c]) => c === 11)) skip('SPLINE (fit points only)');
        else if (flags & 4 || weights.some((w) => w !== weights[0])) skip('SPLINE (rational)');
        else if (!Number.isInteger(degree) || degree > 3 || degree < 1) skip(`SPLINE (degree ${degree})`);
        else if (control.length < degree + 1 || knots.length !== control.length + degree + 1) throw new Error(`unreadable: line ${at}: SPLINE of degree ${degree} over ${control.length} control points needs ${control.length + degree + 1} knots, and at least ${degree + 1} points; it has ${knots.length} knots`);
        else {
          let made: ReturnType<typeof splineCurves>;
          try {
            made = splineCurves(control, knots, degree);
          } catch (error) {
            throw new Error(`${(error as Error).message.replace('SPLINE:', `line ${at}: SPLINE:`)}`);
          }
          if ('skipped' in made) skip(made.skipped);
          else {
            take(layer, made.curves);
            if (made.dropped > 0) skip('SPLINE piece (no extent)', made.dropped);
            z(entity);
          }
        }
        break;
      }
      default:
        if (wanted) skip(type);
    }
  }
  if (polyline) throw new Error(`unreadable: the POLYLINE that starts at line ${polyline.line} has no SEQEND`);
  if (lifted) notes.push('Some entities are not at z = 0; their z is not read, the outline is their plan.');
  return { curves, about: { unit, unitFrom, ...(insunits === undefined ? {} : { insunits }), layers, skipped, notes } };
}
