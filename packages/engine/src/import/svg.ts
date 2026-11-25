// The reader of SVG of the import of an outline (D72): SVG 1.1, the subset of shapes a drawing
// program writes for a cut outline, read by hand.
// - XML: a tokenizer over the text (elements, attributes in either quote, comments, processing
//   instructions, CDATA, a DOCTYPE without an internal subset). A file that is not well formed (a
//   tag cut short, a closing tag that matches nothing, an element left open, a second root, an
//   attribute twice) is `unreadable` with the character it stopped at; it is never read "as far as
//   it goes".
// - `path`: a scanner of the path grammar (numbers with exponents and without separators, the two
//   flags of an arc as one character each). M, L, H, V, Z, C, S, Q, T, A with equal radii, and
//   their relative forms. Data that does not parse is `unreadable`; a well-formed path with an
//   elliptical arc is left out whole and listed. The scanner is lazy, so the limits stop a huge path
//   where they are reached.
// - `rect` (with `rx` equal to `ry` once each is clamped to half its side), `circle`, `ellipse`
//   with equal radii, `line`, `polyline`, `polygon`; lengths with `px`, `mm`, `cm`, `in`, `pt`,
//   `pc` at 96 user units per inch.
// - `transform` (translate, rotate, scale, skewX, skewY, matrix) on any element; lines and splines
//   take any of them with an inverse, a circle or an arc only a similarity.
// - Millimetres from the option `unit`, or `width`, `height` and the `viewBox` of the root. The y of
//   SVG points down: every place is read as (x, −y).
// - Everything left out is counted in `about.skipped`.
// docs/d36/6f-outline-import/design.md, "The readers: SVG".
import { MAX_NUMBER } from '../catalog';
import { OUTLINE_LIMITS } from '../imported-curve';
import type { ArgSpecs, RunArgsOf } from '../query/args';
import type { ImportedCurve, Vec2 } from '../types';
import { LENGTH_TOLERANCE } from '../util';
import { ImportFailure, OUTLINE_SHARED_OPTIONS, type OutlineFormatSpec, type ReadOutline } from './spec';

export const SVG_OPTIONS = {
  ...OUTLINE_SHARED_OPTIONS,
  unit: {
    kind: 'choice',
    options: ['mm', 'cm', 'in', 'pt', 'px'],
    title: 'User unit',
    summary: 'What one user unit of the drawing is. Without it `width`, `height` and `viewBox` of the root say; a root without them is read at 96 units per inch (px). A length of a shape written with a unit (`r="10mm"`) is user units at 96 per inch, as SVG says.',
    optional: true,
  },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface OutlineFormats {
    svg: typeof SVG_OPTIONS;
  }
}

type ReadCurve = ReadOutline['curves'][number];
const unreadable = (why: string): Error => new ImportFailure('unreadable', why);
// a number as written; one that is not finite (`1e999`) is no number of a drawing
const finiteNumber = (text: string, what: string): number => {
  const value = Number(text);
  if (!Number.isFinite(value)) throw unreadable(`${what}: the number "${text}" is not finite`);
  return value;
};

// a 2 × 3 matrix [a, b, c, d, e, f]: (x, y) to (a·x + c·y + e, b·x + d·y + f)
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: Matrix, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const det = (m: Matrix): number => m[0] * m[3] - m[1] * m[2];
// a similarity: the two columns of the same length and at a right angle
const similar = (m: Matrix): boolean => {
  const [l1, l2] = [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])];
  return l1 > 0 && l2 > 0 && Math.abs(l1 - l2) <= 1e-9 * Math.max(l1, l2) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * l1 * l2;
};

// unambiguous (the digits before a point are one run), so that no pattern built on it backtracks
// over the ways to split a run of digits: a text of 40,000 digits is read in linear time
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
// A list of numbers separated by white space and commas, and nothing else (`viewBox`, `points`, the
// arguments of a transform). Numbers may follow each other without a separator (`1-2`, `.5.5`).
function numberList(text: string, what: string): number[] {
  const out: number[] = [];
  const one = new RegExp(NUMBER, 'y');
  let i = 0;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length) return out;
    one.lastIndex = i;
    const found = one.exec(text);
    if (!found) throw unreadable(`${what}: a number is expected at character ${i} ("${text.slice(i, i + 12)}")`);
    out.push(finiteNumber(found[0], `${what}, at character ${i}`));
    i += found[0].length;
  }
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
// One transform of a list, read where the last one ended (sticky): a text that is no list fails at
// its first place that does not fit, after one pass over it.
const TRANSFORM = /[\s,]*([A-Za-z]+)\s*\(([^)]*)\)/y;
function transformOf(text: string | undefined, what: string): Matrix {
  let m = IDENTITY;
  const list = text ?? '';
  let i = 0;
  for (;;) {
    TRANSFORM.lastIndex = i;
    const found = TRANSFORM.exec(list);
    if (!found) break;
    i = TRANSFORM.lastIndex;
    const [, name, args] = found;
    const v = numberList(args, `${what}, the transform ${name}`);
    const count = (...allowed: number[]): void => {
      if (!allowed.includes(v.length)) throw unreadable(`${what}: the transform ${name} takes ${allowed.join(' or ')} numbers, not ${v.length}`);
    };
    if (name === 'translate') {
      count(1, 2);
      m = times(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    } else if (name === 'scale') {
      count(1, 2);
      m = times(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    } else if (name === 'rotate') {
      count(1, 3);
      const [c, s] = [Math.cos(rad(v[0])), Math.sin(rad(v[0]))];
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = times(m, times(times([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]));
    } else if (name === 'skewX') {
      count(1);
      m = times(m, [1, 0, Math.tan(rad(v[0])), 1, 0, 0]);
    } else if (name === 'skewY') {
      count(1);
      m = times(m, [1, Math.tan(rad(v[0])), 0, 1, 0, 0]);
    } else if (name === 'matrix') {
      count(6);
      m = times(m, v as Matrix);
    } else throw unreadable(`${what}: the transform ${name} is not one of SVG`);
  }
  // what the last transform left: white space and commas only
  if (/[^\s,]/.test(list.slice(i))) throw unreadable(`${what}: the transform "${list.slice(0, 80)}" is not a list of transforms`);
  return m;
}

// A table that is looked up by text of the file or of the caller has no prototype: `constructor`
// and `__proto__` are then names like any other, found in no table.
const table = <T>(rows: Record<string, T>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, rows);
// the root's `width` and `height`, in millimetres
const UNIT_MM: Record<string, number> = table({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 });
const LENGTH = new RegExp(`^(${NUMBER})\\s*([A-Za-z%]*)$`);
function length(text: string | undefined, what: string): number | undefined {
  const found = text?.trim().match(LENGTH);
  if (!found || !(found[2] in UNIT_MM)) return undefined;
  return finiteNumber(found[1], what) * UNIT_MM[found[2]];
}
// a length of a basic shape in user units: 96 of them an inch (SVG 1.1, 7.10)
const USER: Record<string, number> = table({ '': 1, px: 1, in: 96, mm: 96 / 25.4, cm: 960 / 25.4, pt: 96 / 72, pc: 16 });

// ---------------------------------------------------------------- XML

interface Tag {
  name: string;
  attributes: Record<string, string>;
  open: boolean; // an opening tag (not self-closing)
  close: boolean;
  at: number;
}
const ENTITIES: Record<string, string> = table({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });
function decoded(value: string, at: number): string {
  return value.replace(/&([^;&\s]*);?/g, (whole, name: string) => {
    if (!whole.endsWith(';')) throw unreadable(`an "&" that starts no entity (in the tag at character ${at})`);
    if (name in ENTITIES) return ENTITIES[name];
    const code = /^#x[0-9a-fA-F]+$/.test(name) ? Number.parseInt(name.slice(2), 16) : /^#\d+$/.test(name) ? Number(name.slice(1)) : Number.NaN;
    if (!(code >= 0 && code <= 0x10ffff)) throw unreadable(`the entity &${name}; is not one of the five of XML (in the tag at character ${at})`);
    return String.fromCodePoint(code);
  });
}
// The tags of a well-formed text, in order. Text between tags is passed over inside the root; a
// document has one root element, and outside it only white space, comments, processing
// instructions and a DOCTYPE.
function* tags(text: string): Generator<Tag> {
  const NAME = /[A-Za-z_][\w:.-]*/y;
  const open: string[] = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let rooted = false; // a root element was opened
  // text between two tags, or after the last: outside the root it is white space
  const between = (from: number, to: number): void => {
    if (open.length > 0) return;
    const stray = text.slice(from, to).search(/\S/);
    if (stray >= 0) throw unreadable(`text outside the root element (at character ${from + stray}: "${text.slice(from + stray, from + stray + 12)}")`);
  };
  const until = (from: number, end: string, what: string): number => {
    const found = text.indexOf(end, from);
    if (found < 0) throw unreadable(`${what} that starts at character ${from} is not closed: the file is cut short`);
    return found + end.length;
  };
  for (;;) {
    const lt = text.indexOf('<', i);
    between(i, lt < 0 ? n : lt);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) i = until(lt, '-->', 'a comment');
    else if (text.startsWith('<?', lt)) i = until(lt, '?>', 'a processing instruction');
    else if (text.startsWith('<![CDATA[', lt)) {
      // character data: text, which outside the root element is no part of a document
      if (open.length === 0) throw unreadable(`a CDATA section outside the root element (at character ${lt})`);
      i = until(lt, ']]>', 'a CDATA section');
    }
    else if (text.startsWith('<!DOCTYPE', lt)) {
      const end = until(lt, '>', 'a DOCTYPE');
      if (text.slice(lt, end).includes('[')) throw unreadable(`a DOCTYPE with declarations of its own (at character ${lt}) is not read`);
      i = end;
    } else if (text[lt + 1] === '/') {
      NAME.lastIndex = lt + 2;
      const name = NAME.exec(text)?.[0];
      let j = lt + 2 + (name?.length ?? 0);
      while (j < n && /\s/.test(text[j])) j++;
      if (name === undefined || text[j] !== '>') throw unreadable(`a closing tag is cut short or is no tag (at character ${lt})`);
      const expected = open.pop();
      if (expected !== name) throw unreadable(expected === undefined ? `</${name}> closes nothing (at character ${lt})` : `</${name}> where </${expected}> is expected (at character ${lt})`);
      yield { name, attributes: {}, open: false, close: true, at: lt };
      i = j + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const name = NAME.exec(text)?.[0];
      if (name === undefined) throw unreadable(`a "<" that starts no tag (at character ${lt})`);
      if (open.length === 0 && rooted) throw unreadable(`a second root element <${name}> (at character ${lt}): a document has one`);
      rooted = true;
      const attributes: Record<string, string> = Object.create(null);
      const seen = new Set<string>();
      let j = lt + 1 + name.length;
      let selfClosing = false;
      for (;;) {
        const before = j;
        while (j < n && /\s/.test(text[j])) j++;
        if (j >= n) throw unreadable(`the tag <${name} that starts at character ${lt} is not closed: the file is cut short`);
        if (text[j] === '>') break;
        if (text[j] === '/' && text[j + 1] === '>') {
          selfClosing = true;
          j++;
          break;
        }
        NAME.lastIndex = j;
        const key = NAME.exec(text)?.[0];
        if (key === undefined || j === before) throw unreadable(`the tag <${name}: an attribute is expected at character ${j}`);
        j += key.length;
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] !== '=') throw unreadable(`the tag <${name}: the attribute ${key} has no value (at character ${j})`);
        j++;
        while (j < n && /\s/.test(text[j])) j++;
        const quote = text[j];
        if (quote !== '"' && quote !== "'") throw unreadable(`the tag <${name}: the value of ${key} is not quoted (at character ${j})`);
        const end = text.indexOf(quote, j + 1);
        if (end < 0) throw unreadable(`the tag <${name}: the value of ${key} that starts at character ${j} is not closed: the file is cut short`);
        const value = text.slice(j + 1, end);
        if (value.includes('<')) throw unreadable(`the tag <${name}: a "<" in the value of ${key} (at character ${j})`);
        if (seen.has(key)) throw unreadable(`the tag <${name}: the attribute ${key} is given twice (at character ${j})`);
        seen.add(key);
        attributes[key] = decoded(value, lt);
        j = end + 1;
      }
      if (!selfClosing) open.push(name);
      yield { name, attributes, open: !selfClosing, close: false, at: lt };
      i = j + 1;
    }
  }
  if (open.length > 0) throw unreadable(`the element <${open[open.length - 1]}> is not closed at the end of the text (character ${n}): the file is cut short`);
}

// ---------------------------------------------------------------- path data

interface Segment {
  command: 'M' | 'L' | 'H' | 'V' | 'Z' | 'C' | 'S' | 'Q' | 'T' | 'A';
  relative: boolean;
  args: number[];
}
const ARITY: Record<string, number> = table({ M: 2, L: 2, H: 1, V: 1, Z: 0, C: 6, S: 4, Q: 4, T: 2, A: 7 });
// The segments of path data (SVG 1.1, 8.3.9). Groups of arguments after the first are the command
// again; after M they are L. The two flags of an arc are one character each.
// A generator: a segment is handed on as it is read, so that the limits of the reader stop a huge
// path at once and no list of its segments is built.
function* scanPath(d: string, what: string): Generator<Segment> {
  let first = true;
  const one = new RegExp(NUMBER, 'y');
  let i = 0;
  const bad = (why: string): Error => unreadable(`${what}: ${why} at character ${i} of d ("${d.slice(i, i + 12)}")`);
  const space = (): void => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = (): number => {
    one.lastIndex = i;
    const found = one.exec(d);
    if (!found) throw bad(i >= d.length ? 'the data ends where a number is expected' : 'a number is expected');
    const value = Number(found[0]);
    if (!Number.isFinite(value)) throw bad(`the number "${found[0]}" is not finite`);
    i += found[0].length;
    return value;
  };
  const flag = (): number => {
    if (d[i] !== '0' && d[i] !== '1') throw bad('a flag 0 or 1 is expected');
    return Number(d[i++]);
  };
  space();
  while (i < d.length) {
    const letter = d[i];
    const command = letter.toUpperCase();
    if (!/[A-Za-z]/.test(letter) || !(command in ARITY)) throw bad(`"${letter}" is no path command`);
    if (first && command !== 'M') throw bad('a path starts with M');
    first = false;
    const relative = letter !== command;
    i++;
    space();
    if (command === 'Z') {
      yield { command: 'Z', relative, args: [] };
      continue;
    }
    let groups = 0;
    do {
      const args: number[] = [];
      for (let k = 0; k < ARITY[command]; k++) {
        args.push(command === 'A' && (k === 3 || k === 4) ? flag() : number());
        space();
      }
      yield { command: (command === 'M' && groups > 0 ? 'L' : command) as Segment['command'], relative, args };
      groups++;
    } while (i < d.length && /[0-9+\-.]/.test(d[i]));
  }
}

// An arc of SVG from `p` to `q` (not one place) with the radius `r` (not 0) and the two flags, in
// the axes of its element: `sweep` 1 runs towards growing angles of those axes. Its centre (SVG
// 1.1, F.6.5; a radius under half the chord is raised to it, F.6.6), and the arc as one that runs
// towards growing angles from `start` to `end`. Undefined when the arc is a small arc that lies
// within `flat` (the tolerance of a join, in the units of the element) of its chord (its sagitta `r − √(r² − d²)`, d half the chord, as
// `d² / (r + √(r² − d²))`): it is read as a line, not as a circle whose centre may lie beyond the
// range of the engine (`A1e12 1e12` over 10 mm).
function svgArc(p: Vec2, q: Vec2, radius: number, large: boolean, sweep: boolean, flat: number): { center: Vec2; start: Vec2; end: Vec2 } | undefined {
  const half: Vec2 = [(p[0] - q[0]) / 2, (p[1] - q[1]) / 2];
  const d = Math.hypot(half[0], half[1]);
  const r = Math.max(Math.abs(radius), d);
  const root = Math.sqrt(Math.max(0, r * r - d * d));
  if (!large && (d * d) / (r + root) <= flat) return undefined;
  const k = (large !== sweep ? 1 : -1) * (root / d);
  const center: Vec2 = [(p[0] + q[0]) / 2 + k * half[1], (p[1] + q[1]) / 2 - k * half[0]];
  return sweep ? { center, start: p, end: q } : { center, start: q, end: p };
}

const SKIPPED_CONTENT = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'metadata', 'style', 'title', 'desc', 'namedview', 'sodipodi:namedview']);
const LISTED = new Set(['text', 'image', 'use', 'tspan', 'textPath', 'foreignObject']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

export function readSvg(bytes: Uint8Array, options: RunArgsOf<typeof SVG_OPTIONS>): ReadOutline {
  if (bytes.length > OUTLINE_LIMITS.bytes) throw new ImportFailure('tooLarge', `the file has ${bytes.length} bytes, more than ${OUTLINE_LIMITS.bytes}`);
  const text = new TextDecoder('utf-8').decode(bytes);
  const curves: ReadCurve[] = [];
  // per layer, its elements by tag (shapes and what is listed), read or not
  // dictionaries without a prototype: the name of a group or of a tag comes from the file (`__proto__`, `constructor`)
  const layers: Record<string, Record<string, number>> = Object.create(null);
  const notes: string[] = [];
  let unitFrom: 'option' | 'file' | 'default' = 'default';
  let control = 0; // the control points of the splines taken
  const skipped: Record<string, number> = Object.create(null);
  const skip = (what: string): void => void (skipped[what] = (skipped[what] ?? 0) + 1);
  // The stack of open elements: the transform into millimetres with y up, the layer (the innermost
  // named group, '' outside any), whether a layer asked for holds it, and whether its content is
  // skipped. Nothing is copied per level, so the memory follows the depth, not its square.
  const stack: { matrix: Matrix; layer: string; selected: boolean; skipped: boolean }[] = [];
  const asked = options.layers;
  let root: Matrix | undefined;
  let unit = 'px';
  let paths = 0;
  for (const tag of tags(text)) {
    if (tag.close) {
      stack.pop();
      continue;
    }
    const a = tag.attributes;
    const tagName = tag.name.startsWith('svg:') ? tag.name.slice(4) : tag.name;
    const top = stack[stack.length - 1];
    if (tagName === 'svg' && !root) {
      const box = a.viewBox ? numberList(a.viewBox, 'the viewBox of the root') : undefined;
      if (box && (box.length !== 4 || !(box[2] > 0) || !(box[3] > 0))) throw unreadable('the viewBox of the root is four numbers with a width and a height above 0');
      const [w, h] = [length(a.width, 'the width of the root'), length(a.height, 'the height of the root')];
      if ((w !== undefined && !(w > 0)) || (h !== undefined && !(h > 0))) throw unreadable(`the root has no size: width="${a.width ?? ''}" height="${a.height ?? ''}" (both above 0 when given)`);
      let scale = UNIT_MM.px;
      if (options.unit !== undefined) {
        scale = UNIT_MM[options.unit];
        unitFrom = 'option';
      } else if (box && w !== undefined && h !== undefined) {
        // The two scales of the root. A viewer fits the box into the size (`meet`): the smaller;
        // with `slice` it fills the size: the larger. Equal within 1e-6: one scale. Otherwise the
        // one a viewer takes, with a note; stretched on purpose (`preserveAspectRatio="none"`) by
        // more than a thousandth, the drawing has no one scale.
        const [sx, sy] = [w / box[2], h / box[3]];
        const apart = Math.abs(sx - sy) / Math.max(sx, sy);
        const fit = (a.preserveAspectRatio ?? '').trim().split(/\s+/);
        const slice = fit.includes('slice');
        if (apart > 1e-3 && fit[0] === 'none') throw unreadable('width, height and viewBox give an uneven scale with preserveAspectRatio="none"; give the option unit');
        scale = slice ? Math.max(sx, sy) : Math.min(sx, sy);
        if (apart > 1e-6) notes.push(`width over the viewBox gives ${Number(sx.toPrecision(9))} mm per unit and height ${Number(sy.toPrecision(9))}; the ${slice ? 'larger is taken, as a viewer fills the size with the drawing (slice)' : 'smaller is taken, as a viewer fits the drawing'}${apart > 1e-3 ? ' (they differ by more than a thousandth: give the option unit if the size is wrong)' : ''}`);
        unitFrom = 'file';
      } else if (a.width === undefined && a.height === undefined && !box) notes.push('the root gives no size (width, height and viewBox): read at 96 units per inch; give the option unit if the drawing is in another unit');
      else {
        // what the root gives is not enough for millimetres: say what is missing, not "no size"
        const given = [a.width !== undefined ? `width="${a.width}"` : '', a.height !== undefined ? `height="${a.height}"` : '', box ? 'a viewBox' : ''].filter((part) => part !== '').join(', ');
        const percent = [a.width, a.height].some((v) => v !== undefined && v.trim().endsWith('%'));
        const why = percent ? 'a width or height in % is a share of the page, not a size, so the viewBox alone gives no millimetres' : !box ? 'without a viewBox a user unit is a px' : 'millimetres need a width and a height in a unit beside the viewBox';
        notes.push(`the root gives ${given}: ${why}; read at 96 units per inch; give the option unit if the drawing is in another unit`);
      }
      unit = options.unit ?? (unitFrom === 'file' ? `${Number(scale.toPrecision(9))} mm per unit` : 'px');
      // millimetres, y up; the user space as it is: the origin of the viewBox moves nothing
      root = [scale, 0, 0, -scale, 0, 0];
      if (tag.open) stack.push({ matrix: root, layer: '', selected: asked === undefined, skipped: false });
      continue;
    }
    if (!root) throw unreadable(`not an SVG file: the first element is <${tag.name}>, not <svg> (at character ${tag.at})`);
    if (!top) continue;
    const label = a.id !== undefined ? `<${tagName} id="${a.id}">` : `the <${tagName}> at character ${tag.at}`;
    const hidden = top.skipped || SKIPPED_CONTENT.has(tagName);
    if (hidden) {
      if (tag.open) stack.push({ ...top, skipped: true });
      continue;
    }
    const matrix = times(top.matrix, transformOf(a.transform, label));
    const name = a['inkscape:label'] ?? a.id;
    const named = tagName === 'g' && name !== undefined;
    const layer = named ? name : top.layer;
    // a group asked for holds everything in it
    const selected = top.selected || (named && asked !== undefined && asked.includes(name));
    const nested = tagName === 'svg';
    const shape = SHAPES.has(tagName);
    const listed = LISTED.has(tagName) || nested;
    // the content of what is listed (the tspan of a text) is counted with it, not on its own
    if (tag.open) stack.push({ matrix, layer, selected, skipped: listed });
    if (tagName === 'g') continue;
    if (shape || listed) {
      layers[layer] ??= Object.create(null) as Record<string, number>;
      layers[layer][tagName] = (layers[layer][tagName] ?? 0) + 1;
    }
    // '' asks for what is in no named group (the layer the report lists it under)
    if (!selected && !(layer === '' && asked?.includes(''))) continue;
    if (listed) {
      skip(nested ? 'svg (nested)' : tagName);
      continue;
    }
    if (!shape) continue;
    const round = similar(matrix); // circles and arcs stay circles and arcs
    const flips = det(matrix) < 0;
    const scale = Math.hypot(matrix[0], matrix[1]);
    const at = (p: Vec2): Vec2 => apply(matrix, p);
    const [before, controlBefore] = [curves.length, control];
    const take = (curve: ImportedCurve): void => {
      if (curves.length >= OUTLINE_LIMITS.read) throw new ImportFailure('tooLarge', `more than ${OUTLINE_LIMITS.read} curves on the layers read; an outline holds ${OUTLINE_LIMITS.curves}`);
      // after the transforms every place and radius is a finite number within the engine's range
      const places = curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'circle' ? [curve.center, [curve.radius, 0] as Vec2] : curve.type === 'arc' ? [curve.center, curve.start, curve.end] : curve.points;
      if (!places.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) throw unreadable(`${label}: its transform gives a place that is no finite number`);
      if (!places.every((p) => Math.abs(p[0]) <= MAX_NUMBER && Math.abs(p[1]) <= MAX_NUMBER)) throw unreadable(`${label}: it gives a place or a radius beyond ±${MAX_NUMBER} mm, the range of the engine`);
      if (curve.type === 'spline') {
        control += curve.points.length;
        if (control > OUTLINE_LIMITS.readControl) throw new ImportFailure('tooLarge', `more than ${OUTLINE_LIMITS.readControl} control points of splines on the layers read; the splines of an outline hold ${OUTLINE_LIMITS.control} together`);
      }
      curves.push({ curve, layer });
    };
    const leaveOut = (why: string): void => {
      curves.length = before;
      control = controlBefore;
      skip(`${tagName} (${why})`);
    };
    // finite numbers can multiply to one that is not (`scale(1e200)` twice)
    if (!matrix.every(Number.isFinite)) throw unreadable(`${label}: its transform is no finite number`);
    // a transform without an inverse (`scale(2, 0)`) flattens the shape onto a line or a point
    const flat = !(Math.abs(det(matrix)) > 1e-12 * Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])) ** 2);
    if (flat) {
      // the data of a path is still read: one that does not parse is a broken file
      if (tagName === 'path') for (const _ of scanPath(a.d ?? '', a.id !== undefined ? `the path "${a.id}"` : `the path at character ${tag.at}`));
      skip(`${tagName} (flat transform)`);
      continue;
    }
    const line = (p: Vec2, q: Vec2): void => {
      if (p[0] !== q[0] || p[1] !== q[1]) take({ type: 'line', a: at(p), b: at(q) });
    };
    // an arc that runs towards growing angles in the axes of the element; mirrored, it runs the other way
    const arc = (made: { center: Vec2; start: Vec2; end: Vec2 }): void => take({ type: 'arc', center: at(made.center), start: at(flips ? made.end : made.start), end: at(flips ? made.start : made.end) });
    // a length of the element in user units; a unit that needs the viewport or the font is remembered
    let odd: string | undefined;
    const n = (key: string): number => {
      if (a[key] === undefined) return 0;
      const found = a[key].trim().match(LENGTH);
      if (!found) throw unreadable(`${label}: ${key}="${a[key]}" is no length`);
      if (!(found[2] in USER)) {
        odd ??= found[2];
        return 0;
      }
      return finiteNumber(found[1], `${label}, ${key}`) * USER[found[2]];
    };
    const same = (p: number, q: number): boolean => Math.abs(p - q) <= 1e-9 * Math.max(Math.abs(p), Math.abs(q));
    if (tagName === 'circle' || tagName === 'ellipse') {
      const [cx, cy] = [n('cx'), n('cy')];
      const [rx, ry] = tagName === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')];
      if (odd !== undefined) leaveOut(`length in ${odd}`);
      else if (rx < 0 || ry < 0) throw unreadable(`${label}: a radius under 0`);
      else if (rx === 0 || ry === 0) skip(`${tagName} (no radius)`);
      else if (!same(rx, ry)) leaveOut('two radii');
      else if (!round) leaveOut('uneven transform');
      else take({ type: 'circle', center: at([cx, cy]), radius: rx * scale });
    } else if (tagName === 'line') {
      const [p, q]: [Vec2, Vec2] = [[n('x1'), n('y1')], [n('x2'), n('y2')]];
      if (odd !== undefined) leaveOut(`length in ${odd}`);
      else line(p, q);
    } else if (tagName === 'polyline' || tagName === 'polygon') {
      const v = numberList(a.points ?? '', `${label}, points`);
      if (v.length % 2 !== 0) throw unreadable(`${label}: points holds ${v.length} numbers, not pairs`);
      const points: Vec2[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
      for (let i = 0; i + 1 < points.length; i++) line(points[i], points[i + 1]);
      if (tagName === 'polygon' && points.length > 2) line(points[points.length - 1], points[0]);
    } else if (tagName === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      const [rx, ry] = [a.rx === undefined ? n('ry') : n('rx'), a.ry === undefined ? n('rx') : n('ry')];
      if (odd !== undefined) leaveOut(`length in ${odd}`);
      else if (w < 0 || h < 0 || rx < 0 || ry < 0) throw unreadable(`${label}: a size under 0`);
      else if (w === 0 || h === 0) skip('rect (no size)');
      // SVG clamps each radius to its half of the side (1.1, 9.2): rx="10" on a rect 10 wide and 40
      // high gives elliptical corners 5 by 10, which are no arcs of a sketch
      else if (!same(Math.min(rx, w / 2), Math.min(ry, h / 2))) leaveOut('rx and ry differ: elliptical corners');
      else if (rx > 0 && !round) leaveOut('uneven transform');
      else {
        const r = Math.min(rx, w / 2);
        line([x + r, y], [x + w - r, y]);
        line([x + w, y + r], [x + w, y + h - r]);
        line([x + w - r, y + h], [x + r, y + h]);
        line([x, y + h - r], [x, y + r]);
        if (r > 0) {
          arc({ center: [x + w - r, y + r], start: [x + w - r, y], end: [x + w, y + r] });
          arc({ center: [x + w - r, y + h - r], start: [x + w, y + h - r], end: [x + w - r, y + h] });
          arc({ center: [x + r, y + h - r], start: [x + r, y + h], end: [x, y + h - r] });
          arc({ center: [x + r, y + r], start: [x, y + r], end: [x + r, y] });
        }
      }
    } else if (tagName === 'path') {
      paths++;
      const segments = scanPath(a.d ?? '', a.id !== undefined ? `the path "${a.id}"` : `the path ${paths} (at character ${tag.at})`);
      let unsupported = '';
      let [here, start]: [Vec2, Vec2] = [[0, 0], [0, 0]];
      // the control point before `here` of the last C or S, and of the last Q or T
      let [cubic, quad]: [Vec2 | undefined, Vec2 | undefined] = [undefined, undefined];
      for (const { command, relative, args: p } of segments) {
        // after a segment that is not read the rest is only checked: data that does not parse is a broken file
        if (unsupported) continue;
        const to = (x: number, y: number): Vec2 => (relative ? [here[0] + x, here[1] + y] : [x, y]);
        const mirror = (c: Vec2 | undefined): Vec2 => (c ? [2 * here[0] - c[0], 2 * here[1] - c[1]] : here);
        let [nextCubic, nextQuad]: [Vec2 | undefined, Vec2 | undefined] = [undefined, undefined];
        if (command === 'Z') {
          line(here, start);
          here = start;
        } else if (command === 'M') start = here = to(p[0], p[1]);
        else if (command === 'L' || command === 'H' || command === 'V') {
          const next: Vec2 = command === 'L' ? to(p[0], p[1]) : command === 'H' ? [relative ? here[0] + p[0] : p[0], here[1]] : [here[0], relative ? here[1] + p[0] : p[0]];
          line(here, next);
          here = next;
        } else if (command === 'A') {
          const next = to(p[5], p[6]);
          const [rx, ry] = [Math.abs(p[0]), Math.abs(p[1])];
          // SVG 1.1, F.6.2: equal ends omit the segment; a radius of 0 is a straight line
          if (next[0] === here[0] && next[1] === here[1]) {
            // nothing
          } else if (rx === 0 || ry === 0) line(here, next);
          else if (!same(rx, ry)) unsupported = 'A with two radii (an elliptical arc)';
          else if (!round) unsupported = 'uneven transform';
          else {
            const made = svgArc(here, next, rx, p[3] !== 0, p[4] !== 0, LENGTH_TOLERANCE / scale);
            if (made) arc(made);
            else line(here, next);
          }
          here = next;
        } else if (command === 'C' || command === 'S') {
          const c1 = command === 'C' ? to(p[0], p[1]) : mirror(cubic);
          const [c2, next] = command === 'C' ? [to(p[2], p[3]), to(p[4], p[5])] : [to(p[0], p[1]), to(p[2], p[3])];
          take({ type: 'spline', points: [here, c1, c2, next].map(at) });
          nextCubic = c2;
          here = next;
        } else {
          const c: Vec2 = command === 'Q' ? to(p[0], p[1]) : mirror(quad);
          const next = command === 'Q' ? to(p[2], p[3]) : to(p[0], p[1]);
          take({ type: 'spline', points: [here, c, next].map(at) });
          nextQuad = c;
          here = next;
        }
        [cubic, quad] = [nextCubic, nextQuad];
      }
      // a path with a segment that is not read is left out whole
      if (unsupported) leaveOut(unsupported);
    }
  }
  if (!root) throw unreadable('not an SVG file (no svg element)');
  return { curves, about: { unit, unitFrom, layers, skipped, notes } };
}

export const svg: OutlineFormatSpec<typeof SVG_OPTIONS> = {
  title: 'SVG',
  summary:
    'SVG 1.1 as a drawing program writes it: path (M, L, H, V, Z, C, S, Q, T and A with equal radii, absolute and relative), rect (round corners whose rx and ry, each clamped to half its side, are equal), circle, ellipse with equal radii, line, polyline, polygon, under any transform (a circle or an arc only under one that keeps it round). The y of SVG points down, so a place is read as (x, −y). Millimetres from width, height and viewBox of the root, or the option unit. Layers are the groups an element is in, by inkscape:label or id. Text, images, use, a nested svg, elliptical arcs and lengths in % or em are left out and listed; CSS, fills and strokes are not read (a filled shape is its outline, a hidden one is read). A file that is not well formed is refused.',
  extensions: ['svg'],
  options: SVG_OPTIONS,
  read: readSvg,
};
