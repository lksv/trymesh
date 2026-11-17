// The import format `stl` (D55): a triangle mesh as binary or ASCII STL.
// - Binary: 80 bytes of header, the number of triangles as a 32-bit unsigned integer, then 50 bytes
//   per triangle (a normal, three corners as 32-bit floats, two bytes of attributes), all
//   little-endian. A file is binary when its length is exactly 84 + 50 · that number; the rule comes
//   first, because a binary file may begin with the word `solid`.
// - ASCII: otherwise, when the text begins with `solid` after white space and holds a `vertex`. Every
//   `vertex x y z` is a corner, three to a triangle; several `solid` blocks are read as one mesh.
// - Anything else is not an STL file; the message gives the length of the file and the length its
//   count would need, so a binary file cut short says so.
// - The normals and the attributes are not read: a triangle faces the way its corners run.
// - The file has no unit; `unit` says what one unit of the file is, and the corners are in
//   millimetres, rounded to float32 after the scale.
import { MESH_LIMITS } from '../mesh';
import type { ArgSpecs } from '../query/args';
import { ImportFailure, type ImportFormatSpec } from './spec';

export const STL_IMPORT_OPTIONS = {
  unit: {
    kind: 'choice',
    options: ['mm', 'cm', 'm', 'in'],
    title: 'Unit of the file',
    summary: 'What one unit of the file is: mm (the default), cm, m or in (25.4 mm). An STL file does not say; the report of the import gives the bounds in millimetres.',
    optional: true,
  },
} as const satisfies ArgSpecs;
export const UNIT_IN_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;

declare module './spec' {
  interface ImportFormats {
    stl: typeof STL_IMPORT_OPTIONS;
  }
}

const tooLarge = (count: number): ImportFailure => new ImportFailure('tooLarge', `the file has ${count} triangles, more than the ${MESH_LIMITS.triangles} an import reads; simplify the mesh outside`);

function binary(bytes: Uint8Array, scale: number): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (count > MESH_LIMITS.triangles) throw tooLarge(count);
  const corners = new Float32Array(9 * count);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) {
      const value = view.getFloat32(84 + 50 * t + 12 + 4 * k, true);
      if (!Number.isFinite(value)) throw new ImportFailure('unreadable', `the triangle ${t} of the file has a coordinate that is not a finite number`);
      corners[9 * t + k] = value * scale;
    }
  }
  return corners;
}

const SOLID = [115, 111, 108, 105, 100]; // `solid`
// The text of an ASCII STL as corners, or undefined when the bytes are not one.
function ascii(bytes: Uint8Array, scale: number): Float32Array | undefined {
  let at = 0;
  const n = bytes.length;
  const next = (): string | undefined => {
    while (at < n && bytes[at] <= 32) at++;
    if (at >= n) return undefined;
    const start = at;
    while (at < n && bytes[at] > 32) at++;
    return at - start > 64 ? '' : String.fromCharCode(...bytes.subarray(start, at));
  };
  while (at < n && bytes[at] <= 32) at++;
  if (!SOLID.every((code, i) => bytes[at + i] === code)) return undefined;
  const corners: number[] = [];
  for (let word = next(); word !== undefined; word = next()) {
    if (word.toLowerCase() !== 'vertex') continue;
    for (let k = 0; k < 3; k++) {
      const token = next();
      const value = token === undefined || token === '' ? NaN : Number(token);
      if (!Number.isFinite(value)) throw new ImportFailure('unreadable', `the vertex ${corners.length / 3} of the text has a coordinate ${JSON.stringify(token ?? '')} that is not a finite number`);
      corners.push(value * scale);
    }
    if (corners.length > 9 * MESH_LIMITS.triangles) throw tooLarge(Math.ceil(corners.length / 9));
  }
  if (corners.length === 0) return undefined;
  if (corners.length % 9 !== 0) throw new ImportFailure('unreadable', `the text has ${corners.length / 3} vertices, which are not whole triangles of three`);
  return Float32Array.from(corners);
}

export const stl: ImportFormatSpec<typeof STL_IMPORT_OPTIONS> = {
  title: 'STL',
  summary:
    'A triangle mesh as binary or ASCII STL (told apart by the file itself). The file has to hold a closed solid: every edge shared by exactly two triangles. Its normals are not read, and it has no unit: `unit` says what one unit of the file is (mm by default).',
  extensions: ['stl'],
  options: STL_IMPORT_OPTIONS,
  read: (bytes, { unit }) => {
    const scale = UNIT_IN_MM[unit ?? 'mm'];
    const about = { unit: unit ?? 'mm' };
    const count = bytes.length >= 84 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) : undefined;
    if (count !== undefined && bytes.length === 84 + 50 * count) return { corners: binary(bytes, scale), about: { encoding: 'binary', ...about } };
    const corners = ascii(bytes, scale);
    if (corners) return { corners, about: { encoding: 'ascii', ...about } };
    throw new ImportFailure(
      'unreadable',
      count === undefined
        ? `not an STL file: it has ${bytes.length} bytes, fewer than the 84 of the header of a binary STL, and is not a text that begins with "solid" and holds vertices`
        : `not an STL file: it has ${bytes.length} bytes, where a binary STL of the ${count} triangles its header counts has ${84 + 50 * count} (a file cut short?), and it is not a text that begins with "solid" and holds vertices`,
    );
  },
};
