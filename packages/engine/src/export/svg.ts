// The format `svg` (D54): the outline a plane cuts out of bodies as SVG 1.1 (second edition), one
// user unit per millimetre. UTF-8, no DTD.
//
// - The root: `width` and `height` in mm and a `viewBox` of the same numbers (7.7): the box of the
//   drawing with a margin on every side. A drawing of nothing has the margin about the origin.
// - The y of SVG points down (7.3) and that of the plane up: a point (u, v) is written (u, −v),
//   with no transform. The drawing then looks as the section does seen against the normal.
// - A group with `fill="none"` and the stroke; in it a group per body, in the order of the
//   outline, with a `title` that holds the name of the body (5.4).
// - A whole circle is a `circle` (9.3). Any other loop is one `path` (8.3): `M` to the first
//   corner, then per piece `L x y` or `A r r 0 0 f x y` to the next corner, and `Z`; the last
//   straight piece is the `Z` itself. `r` is the radius of the piece; the large-arc flag is 0 (a
//   piece turns by less than a half turn); the sweep flag is 1 for a piece that turns clockwise in
//   the plane: SVG calls the direction of growing angle in its own axes positive (8.3.8), and with
//   y down that is clockwise in the plane.
// - `class="outer"` or `class="hole"` on every circle and path.
import type { Id, Vec2 } from '../types';
import { OUTLINE_OPTIONS, type Outline, outlineOf } from './outline';
import type { ExportFormatSpec } from './spec';
import { plain, xmlText } from './text';

declare module './spec' {
  interface ExportFormats {
    svg: typeof OUTLINE_OPTIONS;
  }
}

export const SVG = {
  namespace: 'http://www.w3.org/2000/svg',
  margin: 1, // mm around the box of the drawing, so a line on its edge is not cut in half
  stroke: { color: '#000000', width: 0.1 }, // mm; nothing is filled
} as const;

export function svgText(outline: Outline, nameOf: (body: Id) => string): string {
  const { margin } = SVG;
  const { min, max } = outline.about.bounds ?? { min: [0, 0], max: [0, 0] };
  const [width, height] = [max[0] - min[0] + 2 * margin, max[1] - min[1] + 2 * margin];
  const at = (p: Vec2): string => `${plain(p[0])} ${plain(-p[1])}`;
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG.namespace}" version="1.1" width="${plain(width)}mm" height="${plain(height)}mm" viewBox="${plain(min[0] - margin)} ${plain(-max[1] - margin)} ${plain(width)} ${plain(height)}">\n`,
    `<g fill="none" stroke="${SVG.stroke.color}" stroke-width="${SVG.stroke.width}">\n`,
  ];
  for (const body of [...new Set(outline.loops.map((loop) => loop.body))]) {
    parts.push(`<g><title>${xmlText(nameOf(body))}</title>\n`);
    for (const loop of outline.loops.filter((one) => one.body === body)) {
      const kind = loop.hole ? 'hole' : 'outer';
      if (loop.circle) {
        parts.push(`<circle class="${kind}" cx="${plain(loop.circle.center[0])}" cy="${plain(-loop.circle.center[1])}" r="${plain(loop.circle.radius)}"/>\n`);
        continue;
      }
      const d: string[] = [`M ${at(loop.pieces[0].at)}`];
      loop.pieces.forEach((piece, i) => {
        const next = loop.pieces[(i + 1) % loop.pieces.length].at;
        if (piece.radius !== undefined) d.push(`A ${plain(piece.radius)} ${plain(piece.radius)} 0 0 ${piece.turn < 0 ? 1 : 0} ${at(next)}`);
        else if (i < loop.pieces.length - 1) d.push(`L ${at(next)}`); // the last straight piece is the `Z`
      });
      d.push('Z');
      parts.push(`<path class="${kind}" d="${d.join(' ')}"/>\n`);
    }
    parts.push('</g>\n');
  }
  parts.push('</g>\n</svg>\n');
  return parts.join('');
}

export const svg: ExportFormatSpec<typeof OUTLINE_OPTIONS> = {
  title: 'SVG (outline)',
  summary:
    'The outline a plane cuts out of bodies as an SVG drawing with one user unit per millimetre (the same cut as the query section). A whole circle is a `circle` with the centre and radius of its surface; every other loop is one closed `path` with lines and arcs; class `outer` or `hole`, a group per body. ' +
    'The y of the plane points up and that of SVG down: a point (u, v) of the plane is written (u, −v). Stroked, not filled. One file.',
  options: OUTLINE_OPTIONS,
  run: (context, options) => {
    const outline = outlineOf(context, options);
    const properties = context.state.evaluation.bodyProperties;
    const nameOf = (body: Id): string => properties[body]?.name ?? body;
    const file = { path: 'outline.svg', mediaType: 'image/svg+xml', bytes: new TextEncoder().encode(svgText(outline, nameOf)), about: outline.about };
    return { layout: 'file', files: [file], ...(outline.empty === undefined ? {} : { empty: outline.empty }) };
  },
};
