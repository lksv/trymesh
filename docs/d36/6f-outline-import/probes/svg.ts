// A prototype of the reader of the SVG subset of 6f (D72), for the probes of its design: elements
// and attributes without a DTD; `path` (M, L, H, V, Z, A with equal radii, C, Q and their relative
// forms), `rect` (with `rx`), `circle`, `line`, `polyline`, `polygon`; `transform` (translate,
// rotate, uniform scale, matrix without shear) on any element; millimetres from `width` and the
// `viewBox`. The y of SVG points down: every place is mirrored, (x, y) to (x, −y).
import type { OutlineCurve, ReadCurve, ReadOutline, Vec2 } from './proto';

// a 2 × 3 matrix [a, b, c, d, e, f]: (x, y) to (a·x + c·y + e, b·x + d·y + f)
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: Matrix, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const det = (m: Matrix): number => m[0] * m[3] - m[1] * m[2];
// a similarity: the two columns of the same length and at a right angle
const similar = (m: Matrix): boolean => {
  const [l1, l2] = [Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])];
  return Math.abs(l1 - l2) <= 1e-9 * Math.max(l1, l2) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * l1 * l2;
};

const numbers = (text: string): number[] => (text.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);

function transformOf(text: string | undefined): Matrix {
  let m = IDENTITY;
  for (const [, name, args] of (text ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = numbers(args);
    if (name === 'translate') m = times(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (name === 'scale') m = times(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (name === 'rotate') {
      const [c, s] = [Math.cos((v[0] * Math.PI) / 180), Math.sin((v[0] * Math.PI) / 180)];
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = times(m, times(times([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]));
    } else if (name === 'matrix') m = times(m, v as Matrix);
    else throw new Error(`unreadable: the transform ${name} is not read`);
  }
  return m;
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
function length(text: string | undefined): number | undefined {
  const found = text?.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z%]*)$/);
  if (!found || !(found[2] in UNIT_MM)) return undefined;
  return Number(found[1]) * UNIT_MM[found[2]];
}

interface Tag {
  name: string;
  attributes: Record<string, string>;
  open: boolean; // an opening tag (not self-closing)
  close: boolean;
}
function* tags(text: string): Generator<Tag> {
  const pattern = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const found of text.matchAll(pattern)) {
    if (found[0].startsWith('<!DOCTYPE') && found[1]) throw new Error('unreadable: a DTD with declarations of its own is not read');
    if (found[2]) yield { name: found[2], attributes: {}, open: false, close: true };
    else if (found[3]) {
      const attributes: Record<string, string> = {};
      for (const [, key, , double, single] of found[4].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attributes[key] = double ?? single;
      yield { name: found[3], attributes, open: found[5] !== '/', close: false };
    }
  }
}

// An arc of SVG from `p` to `q` with the radius `r` and the two flags, in the axes of its element:
// `sweep` 1 runs towards growing angles of those axes. Its centre (SVG 1.1, F.6.5), and the arc as
// one that runs towards growing angles from `start` to `end`.
function svgArc(p: Vec2, q: Vec2, radius: number, large: boolean, sweep: boolean): { center: Vec2; start: Vec2; end: Vec2 } {
  const half: Vec2 = [(p[0] - q[0]) / 2, (p[1] - q[1]) / 2];
  const d = Math.hypot(half[0], half[1]);
  const r = Math.max(Math.abs(radius), d);
  const k = (large !== sweep ? 1 : -1) * (Math.sqrt(Math.max(0, r * r - d * d)) / d);
  const center: Vec2 = [(p[0] + q[0]) / 2 + k * half[1], (p[1] + q[1]) / 2 - k * half[0]];
  return sweep ? { center, start: p, end: q } : { center, start: q, end: p };
}

const SKIPPED_CONTENT = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'metadata', 'style', 'title', 'desc', 'namedview', 'sodipodi:namedview']);
const LISTED = new Set(['ellipse', 'text', 'image', 'use', 'tspan', 'textPath', 'foreignObject']);

export function readSvg(text: string, options: { layers?: string[]; unit?: string } = {}): ReadOutline {
  const curves: ReadCurve[] = [];
  const layers: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const skip = (what: string): void => void (skipped[what] = (skipped[what] ?? 0) + 1);
  // the stack of open elements: the transform into millimetres with y up, the layers, whether its content is skipped
  const stack: { matrix: Matrix; layers: string[]; skipped: boolean }[] = [];
  let root: Matrix | undefined;
  let unit = 'px';
  for (const tag of tags(text)) {
    if (tag.close) {
      stack.pop();
      continue;
    }
    const a = tag.attributes;
    const top = stack[stack.length - 1];
    if (tag.name === 'svg' && !root) {
      const box = a.viewBox ? numbers(a.viewBox) : undefined;
      const [w, h] = [length(a.width), length(a.height)];
      let scale = UNIT_MM.px;
      if (options.unit !== undefined) scale = UNIT_MM[options.unit];
      else if (box && w !== undefined && h !== undefined) {
        const [sx, sy] = [w / box[2], h / box[3]];
        if (Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) throw new Error('unreadable: width, height and viewBox give an uneven scale; give the option unit');
        scale = sx;
      }
      unit = options.unit ?? (box && w !== undefined ? `${Number(scale.toPrecision(9))} mm per unit` : 'px');
      // millimetres, y up; the user space as it is: the origin of the viewBox moves nothing
      root = [scale, 0, 0, -scale, 0, 0];
      if (tag.open) stack.push({ matrix: root, layers: [], skipped: false });
      continue;
    }
    if (!root || !top) continue;
    const matrix = times(top.matrix, transformOf(a.transform));
    const name = a['inkscape:label'] ?? a.id;
    const on = tag.name === 'g' && name !== undefined ? [...top.layers, name] : top.layers;
    const hidden = top.skipped || SKIPPED_CONTENT.has(tag.name);
    if (tag.open) stack.push({ matrix, layers: on, skipped: hidden });
    if (hidden || tag.name === 'g' || tag.name === 'svg') continue;
    const layer = on[on.length - 1] ?? '';
    const shape = ['path', 'rect', 'circle', 'line', 'polyline', 'polygon'].includes(tag.name);
    if (shape || LISTED.has(tag.name)) layers[layer] = (layers[layer] ?? 0) + 1;
    if (options.layers !== undefined && !on.some((l) => options.layers?.includes(l))) continue;
    if (LISTED.has(tag.name)) {
      skip(tag.name);
      continue;
    }
    if (!shape) continue;
    if (!similar(matrix)) {
      skip(`${tag.name} (a transform with an uneven scale or a shear)`);
      continue;
    }
    const flips = det(matrix) < 0;
    const scale = Math.hypot(matrix[0], matrix[1]);
    const at = (p: Vec2): Vec2 => apply(matrix, p);
    const take = (curve: OutlineCurve): void => void curves.push({ curve, layer });
    const line = (p: Vec2, q: Vec2): void => {
      if (p[0] !== q[0] || p[1] !== q[1]) take({ type: 'line', a: at(p), b: at(q) });
    };
    // an arc that runs towards growing angles in the axes of the element; mirrored, it runs the other way
    const arc = (made: { center: Vec2; start: Vec2; end: Vec2 }): void => take({ type: 'arc', center: at(made.center), start: at(flips ? made.end : made.start), end: at(flips ? made.start : made.end) });
    const n = (key: string): number => Number(a[key] ?? 0);
    if (tag.name === 'circle') take({ type: 'circle', center: at([n('cx'), n('cy')]), radius: n('r') * scale });
    else if (tag.name === 'line') line([n('x1'), n('y1')], [n('x2'), n('y2')]);
    else if (tag.name === 'polyline' || tag.name === 'polygon') {
      const v = numbers(a.points ?? '');
      const points: Vec2[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
      for (let i = 0; i + 1 < points.length; i++) line(points[i], points[i + 1]);
      if (tag.name === 'polygon' && points.length > 2) line(points[points.length - 1], points[0]);
    } else if (tag.name === 'rect') {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      const [rx, ry] = [a.rx === undefined ? n('ry') : n('rx'), a.ry === undefined ? n('rx') : n('ry')];
      if (rx !== ry) skip('rect (rx and ry differ: elliptical corners)');
      else {
        const r = Math.min(rx, w / 2, h / 2);
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
    } else if (tag.name === 'path') {
      let unsupported = '';
      let [here, start]: [Vec2, Vec2] = [[0, 0], [0, 0]];
      const before = curves.length;
      for (const [, letter, args] of (a.d ?? '').matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
        const v = numbers(args);
        const relative = letter === letter.toLowerCase();
        const to = (x: number, y: number): Vec2 => (relative ? [here[0] + x, here[1] + y] : [x, y]);
        const command = letter.toUpperCase();
        const size = { M: 2, L: 2, H: 1, V: 1, Z: 0, A: 7, C: 6, Q: 4 }[command];
        if (size === undefined) {
          unsupported = command;
          break;
        }
        if (command === 'Z') {
          line(here, start);
          here = start;
          continue;
        }
        for (let i = 0; i + size <= v.length; i += size) {
          const p = v.slice(i, i + size);
          if (command === 'M') {
            // the pairs after the first are lines
            if (i === 0) start = here = to(p[0], p[1]);
            else {
              const next = to(p[0], p[1]);
              line(here, next);
              here = next;
            }
          } else if (command === 'L' || command === 'H' || command === 'V') {
            const next: Vec2 = command === 'L' ? to(p[0], p[1]) : command === 'H' ? [relative ? here[0] + p[0] : p[0], here[1]] : [here[0], relative ? here[1] + p[0] : p[0]];
            line(here, next);
            here = next;
          } else if (command === 'A') {
            const next = to(p[5], p[6]);
            if (p[0] !== p[1]) unsupported = 'A with two radii (an elliptical arc)';
            else if (p[0] === 0) line(here, next);
            else arc(svgArc(here, next, p[0], p[3] !== 0, p[4] !== 0));
            here = next;
          } else {
            const points: Vec2[] = [here];
            for (let k = 0; k + 1 < size; k += 2) points.push(to(p[k], p[k + 1]));
            take({ type: 'spline', points: points.map(at) });
            here = points[points.length - 1];
          }
        }
        if (unsupported) break;
      }
      if (unsupported) {
        // a path with a command that is not read is left out whole
        curves.length = before;
        skip(`path (${unsupported})`);
      }
    }
  }
  if (!root) throw new Error('unreadable: not an SVG file (no svg element)');
  return { curves, about: { unit, layers, skipped } };
}
