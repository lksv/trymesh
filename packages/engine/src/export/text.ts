// Numbers and texts of a file (D54): what the formats of 2g write their numbers and names with,
// and what a robot description (5b) will. A number that is not finite is a defect of the mesh and
// is refused as `failed`, so a format that meets one refuses like a query.
import { QueryFailure } from '../query/spec';

const notFinite = (value: number): never => {
  throw new QueryFailure('failed', `a number to write is not finite (${value})`);
};

// A number with at most `places` decimals, no exponent, no trailing zeros and never "-0".
export function decimals(value: number, places: number): string {
  if (!Number.isFinite(value)) return notFinite(value);
  // `toFixed` writes an exponent from 1e21 on; a number that large is a whole number
  if (Math.abs(value) >= 1e21) return BigInt(value).toString();
  const text = value.toFixed(places).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

// A number of a drawing (DXF, SVG): at most nine decimals, no exponent, no trailing zeros, never
// "-0". Writing no exponent is a choice of the writer: a plain decimal is what every reader takes.
// Nine decimals of a millimetre are far under the precision of the coordinates (float32).
export const plain = (value: number): string => decimals(value, 9);

// A coordinate of a mesh in 3MF: the shortest decimal text that reads back as the same float32
// (`Math.fround(Number(text)) === value`), so a reader gets the very numbers of the mesh and of the
// STL of the same body, and no digits beyond them (3MF core 4.1.3.1). It may use an exponent
// ("1e-7"), which ST_Number takes (appendix B.1.1), and never writes "-0", "NaN" or "Infinity".
// Nine significant digits always read back as the same float32.
export function float32Text(value: number): string {
  if (!Number.isFinite(value)) return notFinite(value);
  const single = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(single.toPrecision(digits)));
    if (Math.fround(Number(text)) === single) return text === '-0' ? '0' : text;
  }
  return String(single); // not reached: nine digits always suffice
}

// A text as character data or as the value of an attribute in double quotes (XML 1.0, fifth
// edition): `&`, `<`, `>` and `"` as entities (2.4, production 10); tab, line feed and carriage
// return as character references, because written as they are an attribute would have them turned
// into spaces (3.3.3); and what a document may not hold at all left out (production 2): the other
// control characters under U+0020, a surrogate without its pair, U+FFFE and U+FFFF.
export function xmlText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (char === '"') out += '&quot;';
    else if (code === 0x9 || code === 0xa || code === 0xd) out += `&#${code};`;
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) continue;
    else out += char;
  }
  return out;
}
