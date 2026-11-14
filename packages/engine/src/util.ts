// Společné pomůcky: vektory, tolerance, kanonický zápis a otisk.
import type { EdgeName, FaceName, Vec2, Vec3 } from './types';

// Tolerance enginu (docs/architecture.md, Konvence). Tolerance booleanů jsou věcí jádra.
export const LENGTH_TOLERANCE = 1e-6; // mm
export const ANGLE_TOLERANCE = 1e-4; // rad

export const ORIGIN = 'origin';

// ---------------------------------------------------------------- vektory

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit3 = (a: Vec3): Vec3 => mul3(a, 1 / len3(a));

export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- jména

// Zápis jména stěny pro porovnání a řazení: feature/role/curve.
export const faceKey = (name: FaceName): string => (name.role === 'side' ? `${name.feature}/side/${name.curve}` : `${name.feature}/${name.role}`);

// Jméno hrany v kanonickém pořadí stěn.
export function canonicalEdge(edge: EdgeName): EdgeName {
  return faceKey(edge.a) <= faceKey(edge.b) ? edge : { a: edge.b, b: edge.a };
}
export const edgeKey = (edge: EdgeName): string => {
  const c = canonicalEdge(edge);
  return `${faceKey(c.a)}|${faceKey(c.b)}`;
};

// ---------------------------------------------------------------- kanonický zápis a otisk

// JSON s klíči seřazenými lexikograficky; stejná data dají vždy stejný řetězec.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

// Otisk řetězce (dvakrát FNV-1a s různým základem, 64 bitů šestnáctkově). Není kryptografický.
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) + 0x9e3779b9;
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
  return hex(h1) + hex(h2);
}

export const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
