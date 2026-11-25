// The reader of SVG of the import of an outline (D72) without adapters: path data and its scanner,
// the shapes, lengths and units, the transforms, the layers, what is left out, and the files that
// are not whole. The engine's own SVG read back is in packages/scenarios/test/outline-import.test.ts.
import { describe, expect, it } from 'vitest';
import { type OutlineOutcome, importOutline } from '../src/import/outline-formats';
import { readSvg } from '../src/import/svg';
import { curveProblem } from '../src/imported-curve';
import type { ImportedCurve, Vec2 } from '../src/types';

type Arc = Extract<ImportedCurve, { type: 'arc' }>;
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const svg = (body: string, root = 'width="100mm" height="100mm" viewBox="0 0 100 100"'): string => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;
const read = (text: string, options: Record<string, unknown> = {}) => readSvg(bytes(text), options as never);
const curves = (text: string, options: Record<string, unknown> = {}): ImportedCurve[] => read(text, options).curves.map((c) => c.curve);
const refusal = (run: () => unknown): string => {
  try {
    run();
    return 'read';
  } catch (error) {
    return `${(error as { code?: string }).code}: ${(error as Error).message}`;
  }
};
const outcome = (text: string, options: Record<string, unknown> = {}): OutlineOutcome => importOutline('svg', bytes(text), options as never);
const close = (a: Vec2, b: Vec2, digits = 9): void => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};

describe('the path data of SVG (D72)', () => {
  it('numbers with exponents and without separators, relative commands, Z', () => {
    expect(curves(svg('<path d="M0 0 L1e1 0 L10 10 Z"/>')).map((c) => c.type)).toEqual(['line', 'line', 'line']);
    const short = curves(svg('<path d="M.5.5l1-2 2.5E-1,1e0z"/>'));
    expect(short).toHaveLength(3);
    close((short[0] as { b: Vec2 }).b, [1.5, 1.5]);
    close((short[1] as { b: Vec2 }).b, [1.75, 0.5]);
  });

  it('H, V, and the implied L after M', () => {
    const c = curves(svg('<path d="M0 0 10 0 V10 H0 z"/>'));
    expect(c.map((x) => x.type)).toEqual(['line', 'line', 'line', 'line']);
    close((c[1] as { b: Vec2 }).b, [10, -10]);
  });

  it('arcs with their flags unseparated, by SVG 1.1, F.6', () => {
    const spaced = curves(svg('<path d="M100 100 a25 25 0 0 1 50 -25"/>'))[0] as Arc;
    const packed = curves(svg('<path d="M100 100 a25,25 0 0150,-25"/>'))[0] as Arc;
    expect(packed).toEqual(spaced);
    // the radius 25 is under half the chord (27.95): raised to it, the centre is the middle of the chord
    close(spaced.center, [125, -87.5]);
    const quarter = curves(svg('<path d="M0 0 A 10 10 0 01 20 10"/>'))[0] as Arc;
    expect(Math.hypot(quarter.start[0] - quarter.center[0], quarter.start[1] - quarter.center[1])).toBeGreaterThan(0);
  });

  it('an arc with equal ends is no segment; a radius of 0 is a line; a radius under half the chord is raised to it', () => {
    expect(curves(svg('<path d="M0 0 A5 5 0 0 1 0 0 L1 0"/>')).map((c) => c.type)).toEqual(['line']);
    expect(curves(svg('<path d="M0 0 A0 5 0 0 1 4 0"/>')).map((c) => c.type)).toEqual(['line']);
    const raised = curves(svg('<path d="M0 0 A1 1 0 0 1 8 0"/>'))[0] as Arc;
    expect(Math.hypot(raised.start[0] - raised.center[0], raised.start[1] - raised.center[1])).toBeCloseTo(4, 9);
  });

  it('C and S, Q and T: the smooth forms reflect the control point before', () => {
    const explicit = curves(svg('<path d="M0 0 C1 2 3 2 4 0 C5 -2 7 -2 8 0"/>'));
    const smooth = curves(svg('<path d="M0 0 C1 2 3 2 4 0 S7 -2 8 0"/>'));
    expect(smooth).toEqual(explicit);
    expect(curves(svg('<path d="M0 0 Q2 2 4 0 T8 0"/>'))).toEqual(curves(svg('<path d="M0 0 Q2 2 4 0 Q6 -2 8 0"/>')));
    expect((explicit[0] as { points: Vec2[] }).points).toHaveLength(4);
    // S after L: its first control point on its start
    close((curves(svg('<path d="M0 0 L1 0 S3 2 4 0"/>'))[1] as { points: Vec2[] }).points[1], [1, 0]);
  });

  it('a path with an elliptical arc is left out whole and listed', () => {
    const r = read(svg('<path d="M0 0 L5 0 A5 3 0 0 1 10 0"/>'));
    expect(r.curves).toEqual([]);
    expect({ ...r.about.skipped }).toEqual({ 'path (A with two radii (an elliptical arc))': 1 });
  });

  it.each([
    ['a number that is none', '<path d="M0 0 L1 x"/>'],
    ['a count of arguments that is wrong', '<path d="M0 0 L1"/>'],
    ['a flag that is not 0 or 1', '<path d="M0 0 A5 5 0 2 1 10 0"/>'],
    ['a letter that is no command', '<path d="M0 0 K1 1"/>'],
    ['no M first', '<path d="L0 0 1 1"/>'],
  ])('path data with %s is unreadable', (_what, body) => {
    expect(refusal(() => read(svg(body)))).toContain('unreadable');
  });
});

describe('the shapes, lengths and units of SVG (D72)', () => {
  it('a rect with round corners: four lines and four arcs, the first arc where the corner is', () => {
    const c = curves(svg('<rect x="0" y="0" width="40" height="20" rx="3"/>', 'width="40mm" height="20mm" viewBox="0 0 40 20"'));
    expect(c.map((x) => x.type)).toEqual(['line', 'line', 'line', 'line', 'arc', 'arc', 'arc', 'arc']);
    const first = c[4] as Arc;
    close(first.center, [37, -3]);
  });

  it('circle, ellipse with equal radii, line, polyline, polygon; an ellipse of two radii is listed', () => {
    const r = read(svg('<circle cx="5" cy="5" r="2"/><ellipse cx="5" cy="5" rx="3" ry="3"/><ellipse rx="3" ry="2"/><line x1="0" y1="0" x2="1" y2="1"/><polyline points="0,0 1,0 1,1"/><polygon points="0 0 2 0 2 2"/>'));
    expect(r.curves.map((c) => c.curve.type)).toEqual(['circle', 'circle', 'line', 'line', 'line', 'line', 'line', 'line']);
    expect({ ...r.about.skipped }).toEqual({ 'ellipse (two radii)': 1 });
  });

  it('a length with a unit is user units at 96 per inch; % and em are listed; a value that is no number is unreadable', () => {
    const radius = (text: string): number => (curves(text)[0] as { radius: number }).radius;
    expect(radius(svg('<circle r="10mm"/>', ''))).toBeCloseTo(10, 9);
    expect(radius(svg('<circle r="1in"/>', ''))).toBeCloseTo(25.4, 9);
    expect(radius(svg('<circle r="72pt"/>', ''))).toBeCloseTo(25.4, 9);
    expect(radius(svg('<circle r="6pc"/>', ''))).toBeCloseTo(25.4, 9);
    // with a viewBox of 1 mm a unit, 10 mm is 37.8 units
    expect(radius(svg('<circle r="10mm"/>'))).toBeCloseTo(37.795, 3);
    expect({ ...read(svg('<circle r="50%"/><rect width="2em" height="1"/>')).about.skipped }).toEqual({ 'circle (length in %)': 1, 'rect (length in em)': 1 });
    expect(refusal(() => read(svg('<circle r="ten"/>')))).toContain('unreadable');
  });

  it('the units of the root: width and height over the viewBox, the smaller of two scales with a note, slice, none, no size', () => {
    expect(read(svg('<circle r="1"/>', 'width="50mm" height="25mm" viewBox="0 0 100 50"')).about.unit).toBe('0.5 mm per unit');
    const a4 = read(svg('<circle r="1"/>', 'width="210mm" height="297mm" viewBox="0 0 793.7 1122.52"'));
    expect(a4.about.unitFrom).toBe('file');
    expect(a4.about.notes.join(' ')).toContain('smaller is taken');
    const sized = (fit: string) => (curves(svg('<circle cx="5" cy="5" r="1"/>', `width="20mm" height="10mm" viewBox="0 0 10 10" ${fit}`))[0] as { radius: number }).radius;
    expect([sized(''), sized('preserveAspectRatio="xMidYMid slice"')]).toEqual([1, 2]);
    expect(refusal(() => sized('preserveAspectRatio="none"'))).toContain('unreadable');
    expect(refusal(() => read(svg('<circle r="1"/>', 'width="0" height="10mm" viewBox="0 0 10 10"')))).toContain('unreadable');
    const bare = read(svg('<circle r="96"/>', ''));
    expect((bare.curves[0].curve as { radius: number }).radius).toBeCloseTo(25.4, 9);
    expect(bare.about.notes.join(' ')).toContain('96 units per inch');
    expect((curves(svg('<circle r="2"/>', ''), { unit: 'mm' })[0] as { radius: number }).radius).toBe(2);
  });

  it('y points down: a place is read as (x, −y)', () => {
    expect((curves(svg('<line x1="1" y1="2" x2="3" y2="4"/>'))[0] as { a: Vec2 }).a).toEqual([1, -2]);
  });

  it('text, image, use and a nested svg are listed; defs and their content are passed over', () => {
    const r = read(svg('<defs><circle r="5"/></defs><text>x</text><image href="a.png"/><use href="#a"/><svg><circle r="1"/></svg><circle r="2"/>'));
    expect(r.curves).toHaveLength(1);
    expect({ ...r.about.skipped }).toEqual({ text: 1, image: 1, use: 1, 'svg (nested)': 1 });
  });
});

describe('the transforms of SVG (D72)', () => {
  it('translate, rotate about a point, scale, matrix, composed down the tree', () => {
    const c = curves(svg('<g transform="translate(10 0)"><g transform="rotate(90 0 0)"><line x1="0" y1="0" x2="1" y2="0" transform="scale(2)"/></g></g>'));
    const l = c[0] as { a: Vec2; b: Vec2 };
    close(l.a, [10, -0]);
    close(l.b, [10, -2]);
    close((curves(svg('<line x1="0" y1="0" x2="1" y2="0" transform="matrix(1 0 0 1 5 5)"/>'))[0] as { a: Vec2 }).a, [5, -5]);
  });

  it('an uneven transform over a circle, an arc or a rounded rect is listed; over a polygon, a spline, a plain rect and a line read', () => {
    const r = read(svg('<g transform="scale(2,1)"><circle r="1"/><path d="M0 0 A1 1 0 0 1 2 0"/><rect width="4" height="4" rx="1"/><polygon points="0 0 1 0 1 1"/><path d="M0 0 C1 1 2 1 3 0"/><rect width="4" height="4"/><line x2="1"/></g>'));
    expect({ ...r.about.skipped }).toEqual({ 'circle (uneven transform)': 1, 'path (uneven transform)': 1, 'rect (uneven transform)': 1 });
    expect(r.curves.map((c) => c.curve.type)).toEqual(['line', 'line', 'line', 'spline', 'line', 'line', 'line', 'line', 'line']);
    expect({ ...read(svg('<circle r="1" transform="skewX(30)"/>')).about.skipped }).toEqual({ 'circle (uneven transform)': 1 });
  });

  it('a reflection is a similarity: an arc under it runs the other way, its ends on one radius', () => {
    const a = curves(svg('<path d="M10 0 A10 10 0 0 1 0 10" transform="scale(-1,1)"/>'))[0] as Arc;
    const [rs, re] = [Math.hypot(a.start[0] - a.center[0], a.start[1] - a.center[1]), Math.hypot(a.end[0] - a.center[0], a.end[1] - a.center[1])];
    expect(Math.abs(rs - re)).toBeLessThan(1e-12);
    // the quarter from (−10, 0) to (0, −10) seen with y up, counter-clockwise from (0, −10)
    close(a.start, [-10, -0]);
  });

  it('a flat transform leaves the shape out and lists it', () => {
    expect({ ...read(svg('<circle r="1" transform="scale(2,0)"/><line x2="1" transform="scale(0)"/><path d="M0 0 L1 1" transform="matrix(1 1 1 1 0 0)"/>')).about.skipped }).toEqual({ 'circle (flat transform)': 1, 'line (flat transform)': 1, 'path (flat transform)': 1 });
  });

  it('a transform that is not of SVG is unreadable', () => {
    expect(refusal(() => read(svg('<line x2="1" transform="shear(2)"/>')))).toContain('unreadable');
  });
});

describe('the layers of SVG (D72)', () => {
  it('the groups an element is in by inkscape:label or id; the option takes an element when one of its groups is named', () => {
    const text = svg('<g inkscape:label="cut"><circle r="1"/><g id="inner"><circle r="2"/></g></g><g id="engrave"><line x2="1"/></g>');
    const r = read(text);
    expect(Object.keys(r.about.layers)).toEqual(['cut', 'inner', 'engrave']);
    expect(read(text, { layers: ['cut'] }).curves).toHaveLength(2);
    expect(read(text, { layers: ['inner'] }).curves).toHaveLength(1);
  });

  it('names of Object.prototype are layers like any other; Object.prototype stays as it was', () => {
    const r = read(svg('<g id="__proto__"><circle r="1"/></g><g id="constructor"><circle r="2"/><toString/></g>'));
    expect(Object.keys(r.about.layers)).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>).circle).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(refusal(() => read(svg('<g id="&constructor;"/>')))).toContain('unreadable');
  });
});

describe('an SVG that is not whole is refused (D72)', () => {
  it.each([
    ['cut short in a path', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/><path d="M0 0 L'],
    ['tags that do not match', svg('<g><circle r="1"/></h>')],
    ['no </svg>', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/>'],
    ['an attribute without quotes', svg('<circle r=1/>')],
    ['a stray <', svg('<circle r="1"/> < ')],
    ['a DOCTYPE with a subset', `<!DOCTYPE svg [<!ENTITY a "b">]>${svg('<circle r="1"/>')}`],
    ['an unknown entity', svg('<circle id="&nbsp;" r="1"/>')],
    ['two roots', `${svg('<circle r="1"/>')}${svg('<circle r="2"/>')}`],
    ['text after the root', `${svg('<circle r="1"/>')} more`],
    ['an attribute twice', svg('<circle r="1" r="2"/>')],
    ['a number that is not finite in a length', svg('<circle r="1e999"/>')],
    ['a number that is not finite in path data', svg('<path d="M0 0 L1e999 0"/>')],
    ['a number that is not finite in points', svg('<polygon points="0 0 1e999 0 1 1"/>')],
    ['a number that is not finite in a transform', svg('<circle r="1" transform="translate(1e999)"/>')],
    ['no svg element', '<g><circle r="1"/></g>'],
  ])('%s', (_what, text) => {
    expect(refusal(() => read(text))).toContain('unreadable');
  });
});

describe('what the reader of SVG gives against the validator (D72)', () => {
  it('control points at one place: C on its start or its end, S and T after L, kept; Q back to its start and C of one place left out', () => {
    const made = outcome(svg('<path d="M0 0 C0 0 5 5 10 0 C15 5 20 0 20 0 L25 0 S30 5 35 0 L40 0 T50 0 Q55 5 50 0 C50 0 50 0 50 0"/>'));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    for (const curve of Object.values(made.curves)) expect(curveProblem(curve, 'c')).toBeUndefined();
    expect(made.report.byKind.spline).toBe(4);
    expect(made.report.dropped).toBe(2);
  });

  it('the property: nothing the import answers is refused by the validator, over 400 generated paths whose points fall on each other', () => {
    let [refused, kept] = [0, 0];
    for (let seed = 1; seed <= 400; seed++) {
      let s = seed >>> 0;
      const next = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
      const at = (): string => `${Math.floor(next() * 4)} ${Math.floor(next() * 4)}`;
      const parts = [`M${at()}`];
      for (let i = 0, n = 2 + Math.floor(next() * 8); i < n; i++) {
        const k = Math.floor(next() * 9);
        parts.push(['L', 'H', 'V', 'C', 'S', 'Q', 'T', 'A', 'Z'][k] + (k === 0 ? at() : k === 1 || k === 2 ? `${Math.floor(next() * 4)}` : k === 3 ? `${at()} ${at()} ${at()}` : k === 4 || k === 5 ? `${at()} ${at()}` : k === 6 ? at() : k === 7 ? `2 2 0 ${next() < 0.5 ? 0 : 1} ${next() < 0.5 ? 0 : 1} ${at()}` : ''));
      }
      const made = outcome(svg(`<path d="${parts.join(' ')}"/>`), { weld: seed % 2 ? 0 : 0.01 });
      if (!made.ok) continue;
      for (const curve of Object.values(made.curves)) {
        kept++;
        if (curveProblem(curve, 'c')) refused++;
      }
    }
    expect(kept).toBeGreaterThan(500);
    expect(refused).toBe(0);
  });
});

describe('the limits of the reader of SVG (D72)', () => {
  it('a path of 8000 lines is read, of 8001 refused; 2100 C are too many control points; a huge path is refused where the limit is reached', () => {
    const path = (n: number, seg: (i: number) => string): string => svg(`<path d="M0 0 ${Array.from({ length: n }, (_, i) => seg(i)).join(' ')}"/>`);
    expect(read(path(8000, (i) => `L${i + 1} ${i % 2}`)).curves).toHaveLength(8000);
    expect(refusal(() => read(path(8001, (i) => `L${i + 1} ${i % 2}`)))).toContain('tooLarge');
    expect(refusal(() => read(path(2100, (i) => `C${i} 1 ${i + 0.5} 1 ${i + 1} 0`)))).toContain('tooLarge');
    expect(refusal(() => read(`${svg('')}`.replace('</svg>', `<path d="M0 0 ${'L1 1 L0 0 '.repeat(100_000)} L"/></svg>`)))).toContain('tooLarge');
  });

  it('through the import: the IDs, the report, and empty', () => {
    const made = outcome(svg('<g id="cut"><rect width="40" height="20" rx="3"/><circle cx="20" cy="10" r="2"/></g><g id="engrave"><line x2="5"/></g>'), { layers: ['cut'] });
    expect(made.ok && Object.keys(made.curves)).toEqual(['l1', 'l2', 'l3', 'l4', 'a1', 'a2', 'a3', 'a4', 'c1']);
    expect(made.ok && made.report.open).toBe(0);
    expect(outcome(svg('<text>x</text>')).ok).toBe(false);
  });
});
