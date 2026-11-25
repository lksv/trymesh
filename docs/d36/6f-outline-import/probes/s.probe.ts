// Probe S: the reader of the SVG subset after the review of the design (codex 5 and 7, agy 5): a
// tokenizer of XML and of path data, the degenerate arcs, lengths with units, S and T, a round
// ellipse, transforms that are no similarity, files that are not well formed, the early limits.
// After the second round (codex 6 and 9, agy 4 and 11, fable 16), S10 to S14: one root, no
// attribute twice, finite numbers, the size and the two scales of the root, the limit of control
// points with a path scanned as it is read, what `about` says, a transform without an inverse.
import { describe, expect, it } from 'vitest';
import type { ImportedCurve, Vec2 } from './proto';
import { SVG_MAX_CHARACTERS, SVG_MAX_CONTROL, SVG_MAX_CURVES, readSvg } from './svg';

// 1 mm per user unit
const mm = (body: string, more = ''): string => `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"${more}>${body}</svg>`;
const curvesOf = (text: string, options: { layers?: string[]; unit?: string } = {}): ImportedCurve[] => readSvg(text, options).curves.map((c) => c.curve);
const refusal = (text: string): string => {
  try {
    readSvg(text);
  } catch (error) {
    return (error as Error).message;
  }
  return 'read';
};
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a: Vec2, b: Vec2, tolerance = 1e-9): boolean => dist(a, b) <= tolerance;
type Arc = Extract<ImportedCurve, { type: 'arc' }>;
// counter-clockwise from start to end about the centre, rad
const sweep = (arc: Arc): number => {
  const angle = (p: Vec2): number => Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
  return (((angle(arc.end) - angle(arc.start)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
};

describe('S: the reader of SVG, hardened', () => {
  it('S1: numbers with an exponent, and numbers without separators', () => {
    const curves = curvesOf(mm('<path d="M0 0 L1e1 0 L10 10 Z"/>'));
    console.log('S1 exponent', JSON.stringify(curves));
    expect(curves).toEqual([
      { type: 'line', a: [0, 0], b: [10, 0] },
      { type: 'line', a: [10, 0], b: [10, -10] },
      { type: 'line', a: [10, -10], b: [0, 0] },
    ]);
    const tight = curvesOf(mm('<path d="M.5.5l1-2 2.5E-1,1e0z"/>'));
    console.log('S1 tight', JSON.stringify(tight));
    expect(tight.length).toBe(3);
    expect(tight[0]).toEqual({ type: 'line', a: [0.5, -0.5], b: [1.5, 1.5] });
    expect(tight[1]).toEqual({ type: 'line', a: [1.5, 1.5], b: [1.75, 0.5] });
  });

  it('S2: the flags of an arc as one character each, without separators', () => {
    // from (50, 50): radius 25, large-arc 0, sweep 1, by (50, -25): the flags and the x written as "0150"
    const [compact, spaced] = [curvesOf(mm('<path d="M50,50 a25,25 0 0150,-25"/>')), curvesOf(mm('<path d="M50,50 a25,25 0 0 1 50,-25"/>'))];
    console.log('S2 compact', JSON.stringify(compact[0]));
    expect(compact).toEqual(spaced);
    const arc = compact[0] as Arc;
    // the chord is 55.9 long and the radius 25: raised to half the chord, the centre its middle
    expect(near(arc.center, [75, -37.5])).toBe(true);
    expect(Math.abs(dist(arc.start, arc.center) - dist(arc.end, arc.center))).toBeLessThan(1e-12);
    const quarter = curvesOf(mm('<path d="M 10 0 A 10 10 0 01 20 10"/>'))[0] as Arc;
    console.log('S2 quarter', JSON.stringify(quarter), 'sweep', sweep(quarter).toFixed(6));
    // sweep 1 runs clockwise on a screen with y down; with y up it is the arc from (20, -10) to (10, 0) about (10, -10)
    expect(near(quarter.center, [10, -10])).toBe(true);
    expect(near(quarter.start, [20, -10]) && near(quarter.end, [10, 0])).toBe(true);
    expect(Math.abs(sweep(quarter) - Math.PI / 2)).toBeLessThan(1e-12);
    const large = curvesOf(mm('<path d="M 10 0 A 10 10 0 1120 10"/>'))[0] as Arc;
    console.log('S2 large', JSON.stringify(large), 'sweep', sweep(large).toFixed(6));
    expect(near(large.center, [20, 0])).toBe(true);
    expect(Math.abs(sweep(large) - 1.5 * Math.PI)).toBeLessThan(1e-12);
  });

  it('S3: the arcs with nothing to draw: equal ends are omitted, a radius of 0 is a line, a small radius is raised', () => {
    const same = readSvg(mm('<path d="M 5 5 A 10 10 0 1 1 5 5 L 9 5"/>'));
    console.log('S3 equal ends', JSON.stringify(same.curves.map((c) => c.curve)), JSON.stringify(same.about.skipped));
    expect(same.curves.map((c) => c.curve)).toEqual([{ type: 'line', a: [5, -5], b: [9, -5] }]);
    const zero = curvesOf(mm('<path d="M 0 0 A 0 0 0 0 1 8 0"/>'));
    console.log('S3 radius 0', JSON.stringify(zero));
    expect(zero).toEqual([{ type: 'line', a: [0, 0], b: [8, 0] }]);
    const small = curvesOf(mm('<path d="M 0 0 A 1 1 0 0 1 8 0"/>'))[0] as Arc;
    console.log('S3 raised', JSON.stringify(small));
    expect(near(small.center, [4, 0])).toBe(true);
    expect(Math.abs(dist(small.start, small.center) - 4)).toBeLessThan(1e-12);
  });

  it('S4: lengths with units, at 96 user units an inch', () => {
    // no viewBox: a user unit is a px, so 10mm is 10 mm
    const px = readSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm"><circle cx="1in" cy="0" r="10mm"/><rect x="0" y="0" width="72pt" height="6pc"/></svg>');
    const circle = px.curves[0].curve as Extract<ImportedCurve, { type: 'circle' }>;
    console.log('S4 px document', px.about.unit, JSON.stringify(circle), JSON.stringify(px.curves[2].curve));
    expect(Math.abs(circle.radius - 10)).toBeLessThan(1e-12);
    expect(Math.abs(circle.center[0] - 25.4)).toBeLessThan(1e-12);
    // 72pt and 6pc are an inch each
    expect(px.curves.slice(1).map((c) => c.curve)).toHaveLength(4);
    const right = px.curves[2].curve as Extract<ImportedCurve, { type: 'line' }>;
    expect(Math.abs(right.a[0] - 25.4) + Math.abs(right.b[1] + 25.4)).toBeLessThan(1e-12);
    // a viewBox of 1 mm per unit: 10mm is 37.795 user units (the rule of SVG), so 37.795 mm
    const scaled = curvesOf(mm('<circle r="10mm"/>'))[0] as Extract<ImportedCurve, { type: 'circle' }>;
    console.log('S4 with a viewBox of 1 mm per unit, r="10mm" is', scaled.radius);
    expect(Math.abs(scaled.radius - 960 / 25.4)).toBeLessThan(1e-12);
    const percent = readSvg(mm('<circle r="50%"/><rect width="2em" height="3"/><line x1="0" y1="0" x2="5" y2="0"/>'));
    console.log('S4 other units', JSON.stringify(percent.about.skipped), 'curves', percent.curves.length);
    expect(percent.about.skipped).toEqual({ 'circle (length in %)': 1, 'rect (length in em)': 1 });
    expect(percent.curves).toHaveLength(1);
    const none = refusal(mm('<circle r="ten"/>'));
    console.log('S4 no number:', none);
    expect(none).toMatch(/^unreadable: .*r="ten" is no length/);
  });

  it('S5: files that are not well formed are refused, with the place', () => {
    const cases: Record<string, string> = {
      'cut short in a tag (codex 5)': '<svg><circle r="10"/><path d="M0 0 L',
      'cut short after a tag': '<svg><circle r="10"/><g>',
      'no closing svg': '<svg><circle r="10"/>',
      'mismatched tags': '<svg><g><circle r="10"/></svg></g>',
      'a closing tag alone': '<svg></g></svg>',
      'an attribute without quotes': '<svg><circle r=10/></svg>',
      'an attribute without a value': '<svg><circle r/></svg>',
      'a stray <': '<svg> 1 < 2 <circle r="10"/></svg>',
      'a comment not closed': '<svg><!-- <circle r="10"/></svg>',
      'a DOCTYPE with a subset': '<!DOCTYPE svg [<!ENTITY r "10">]><svg><circle r="&r;"/></svg>',
      'an unknown entity': '<svg><circle r="&r;"/></svg>',
      'not SVG': '<html><body/></html>',
      'path: a bad number': mm('<path id="p1" d="M0 0 L 1 x"/>'),
      'path: a wrong count': mm('<path d="M0 0 L 1 2 3 Z"/>'),
      'path: a flag of 2': mm('<path d="M0 0 A 5 5 0 2 1 10 0"/>'),
      'path: no command': mm('<path d="M0 0 B 1 2"/>'),
      'path: no M first': mm('<path d="L 1 2"/>'),
      'points: an odd count': mm('<polygon points="0,0 1,1 2"/>'),
      'a transform that is none': mm('<g transform="spin(3)"><circle r="1"/></g>'),
    };
    for (const [name, text] of Object.entries(cases)) {
      const message = refusal(text);
      console.log(`S5 ${name}:`, message);
      expect(message).toMatch(/^unreadable: /);
    }
    // what stays readable: a DOCTYPE without a subset, CDATA, entities, either quote, an svg: prefix
    const fine = readSvg(`<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width='10mm' height='10mm' viewBox='0 0 10 10'><style><![CDATA[ a < b ]]></style><svg:g id="a&amp;b&#x41;&#66;"><svg:circle r="1"/></svg:g></svg:svg>`);
    console.log('S5 fine', JSON.stringify(fine.about));
    expect(fine.about.layers).toEqual({ 'a&bAB': { circle: 1 } });
    expect(fine.curves).toHaveLength(1);
  });

  it('S6: S and T against the explicit C and Q', () => {
    const smooth = curvesOf(mm('<path d="M 0 0 C 1 2 3 2 4 0 S 7 -2 8 0 s 3 2 4 0 Q 14 3 16 0 T 20 0 t 4 0 S 30 5 32 0 T 40 0"/>'));
    const explicit = curvesOf(mm('<path d="M 0 0 C 1 2 3 2 4 0 C 5 -2 7 -2 8 0 C 9 2 11 2 12 0 Q 14 3 16 0 Q 18 -3 20 0 Q 22 3 24 0 C 24 0 30 5 32 0 Q 32 0 40 0"/>'));
    console.log('S6 smooth', JSON.stringify(smooth.map((c) => (c.type === 'spline' ? c.points.length : c.type))));
    expect(smooth).toEqual(explicit);
    expect(smooth.map((c) => (c.type === 'spline' ? c.points.length : 0))).toEqual([4, 4, 4, 3, 3, 3, 4, 3]);
  });

  it('S7: an ellipse with equal radii is a circle; a rect with two corner radii is listed', () => {
    const read = readSvg(mm('<ellipse cx="5" cy="6" rx="2" ry="2"/><ellipse cx="5" cy="6" rx="2" ry="1"/><rect width="10" height="8" rx="2" ry="1"/><rect width="10" height="8" ry="2"/>'));
    console.log('S7', JSON.stringify(read.curves.map((c) => c.curve.type)), JSON.stringify(read.about.skipped));
    expect(read.curves[0].curve).toEqual({ type: 'circle', center: [5, -6], radius: 2 });
    expect(read.about.skipped).toEqual({ 'ellipse (two radii)': 1, 'rect (rx and ry differ: elliptical corners)': 1 });
    // the rect with `ry` alone has round corners of 2: four lines and four arcs
    expect(read.curves.slice(1).map((c) => c.curve.type).sort()).toEqual(['arc', 'arc', 'arc', 'arc', 'line', 'line', 'line', 'line']);
  });

  it('S8: transforms: lines and splines take any, a circle and an arc a similarity only', () => {
    const uneven = readSvg(mm('<g transform="scale(2,1)"><circle cx="5" cy="5" r="2"/><polygon points="0,0 4,0 4,3"/><path d="M0 0 C 1 1 2 1 3 0"/><path d="M0 0 L 5 0 A 5 5 0 0 1 10 5"/><rect width="4" height="2"/><rect width="4" height="2" rx="1"/></g><g transform="skewX(30)"><line x1="0" y1="0" x2="0" y2="10"/><circle r="1"/></g>'));
    console.log('S8 uneven', JSON.stringify(uneven.about.skipped), JSON.stringify(uneven.curves.map((c) => c.curve.type)));
    expect(uneven.about.skipped).toEqual({ 'circle (uneven transform)': 2, 'path (uneven transform)': 1, 'rect (uneven transform)': 1 });
    const kinds = uneven.curves.map((c) => c.curve);
    // the polygon, the spline, the plain rect and the skewed line
    expect(kinds.map((c) => c.type)).toEqual(['line', 'line', 'line', 'spline', 'line', 'line', 'line', 'line', 'line']);
    expect(kinds[1]).toEqual({ type: 'line', a: [8, 0], b: [8, -3] });
    expect(kinds[3]).toEqual({ type: 'spline', points: [[0, 0], [2, -1], [4, -1], [6, 0]] });
    const skewed = kinds[8] as Extract<ImportedCurve, { type: 'line' }>;
    expect(Math.abs(skewed.b[0] - 10 * Math.tan(Math.PI / 6))).toBeLessThan(1e-12);

    // a reflection is a similarity: the arc runs the other way, so its ends swap
    const plain = curvesOf(mm('<path d="M 10 0 A 10 10 0 0 1 20 10"/>'))[0] as Arc;
    const flipped = curvesOf(mm('<g transform="scale(-1,1)"><path d="M 10 0 A 10 10 0 0 1 20 10"/></g>'))[0] as Arc;
    console.log('S8 reflected', JSON.stringify(flipped), 'sweep', sweep(flipped).toFixed(6), 'radii apart', Math.abs(dist(flipped.start, flipped.center) - dist(flipped.end, flipped.center)));
    expect(near(flipped.center, [-plain.center[0], plain.center[1]])).toBe(true);
    expect(near(flipped.start, [-plain.end[0], plain.end[1]]) && near(flipped.end, [-plain.start[0], plain.start[1]])).toBe(true);
    expect(Math.abs(sweep(flipped) - Math.PI / 2)).toBeLessThan(1e-12);
    expect(Math.abs(dist(flipped.start, flipped.center) - dist(flipped.end, flipped.center))).toBeLessThan(1e-12);
    // a rotation with a scale stays a similarity: a circle of radius 2 scaled by 1.5
    const turned = curvesOf(mm('<g transform="rotate(30) scale(1.5)"><circle cx="4" cy="0" r="2"/></g>'))[0] as Extract<ImportedCurve, { type: 'circle' }>;
    expect(Math.abs(turned.radius - 3)).toBeLessThan(1e-12);
    expect(near(turned.center, [6 * Math.cos(Math.PI / 6), -6 * Math.sin(Math.PI / 6)], 1e-12)).toBe(true);
  });

  it('S9: the early limits: curves and characters', () => {
    const path = (lines: number): string => mm(`<path d="M0 0${Array.from({ length: lines }, (_, i) => ` L${i + 1} ${i % 2}`).join('')}"/>`);
    let started = performance.now();
    const most = readSvg(path(SVG_MAX_CURVES));
    const read = performance.now() - started;
    started = performance.now();
    let message = 'read';
    try {
      readSvg(path(SVG_MAX_CURVES + 1));
    } catch (error) {
      message = (error as Error).message;
    }
    console.log(`S9 ${SVG_MAX_CURVES} lines read in ${read.toFixed(1)} ms (${most.curves.length} curves); one more:`, message, `in ${(performance.now() - started).toFixed(1)} ms`);
    expect(most.curves).toHaveLength(SVG_MAX_CURVES);
    expect(message).toMatch(/^tooLarge: /);
    // on a layer that is not asked for the curves do not count
    const other = readSvg(mm(`<g id="a">${path(SVG_MAX_CURVES + 1).replace(/<\/?svg[^>]*>/g, '')}</g><g id="b"><line x1="0" y1="0" x2="1" y2="0"/></g>`), { layers: ['b'] });
    expect(other.curves).toHaveLength(1);
    started = performance.now();
    const big = refusal(`<svg>${' '.repeat(SVG_MAX_CHARACTERS)}</svg>`);
    console.log('S9 characters:', big, `in ${(performance.now() - started).toFixed(1)} ms`);
    expect(big).toMatch(/^tooLarge: /);
  });

  it('S10: one root, no attribute twice, numbers that are finite', () => {
    const cases: Record<string, string> = {
      'two roots (codex 9)': '<svg><circle r="10"/></svg><svg><circle cx="50" r="5"/></svg>',
      'an element after the root': '<svg><circle r="10"/></svg><g/>',
      'text after the root': '<svg><circle r="10"/></svg> tail',
      'text before the root': 'junk <svg><circle r="10"/></svg>',
      'an attribute twice': '<svg><circle r="10" r="20"/></svg>',
      'an attribute twice on the root': '<svg width="10mm" width="20mm"><circle r="10"/></svg>',
      'a length that is not finite': mm('<circle r="1e999"/>'),
      'a coordinate of a path that is not finite': mm('<path d="M0 0 L1e999 0"/>'),
      'points that are not finite': mm('<polygon points="0,0 1e999,1 2,2"/>'),
      'a viewBox that is not finite': '<svg width="10mm" height="10mm" viewBox="0 0 1e999 10"><circle r="1"/></svg>',
      'a transform that is not finite': mm('<g transform="scale(1e999)"><line x1="0" y1="0" x2="1" y2="0"/></g>'),
      'finite numbers whose product is not': mm('<g transform="scale(1e200)"><g transform="scale(1e200)"><line x1="0" y1="0" x2="1" y2="0"/></g></g>'),
    };
    for (const [name, text] of Object.entries(cases)) {
      const message = refusal(text);
      console.log(`S10 ${name}:`, message);
      expect(message).toMatch(/^unreadable: /);
    }
    // what stays readable around the root: a declaration, comments, white space, a byte-order mark
    const fine = readSvg(`\uFEFF<?xml version="1.0"?>\n<!-- before -->\n${mm('<circle r="1"/>')}\n<!-- after -->\n`);
    expect(fine.curves).toHaveLength(1);
    // an empty root that closes itself is a root too
    expect(refusal('<svg/><svg/>')).toMatch(/^unreadable: a second root/);
  });

  it('S11: the size of the root and its two scales', () => {
    const root = (attributes: string): string => `<svg ${attributes}><circle cx="100" cy="100" r="10"/></svg>`;
    const one = (attributes: string): string => {
      try {
        const read = readSvg(root(attributes));
        const c = read.curves[0].curve as Extract<ImportedCurve, { type: 'circle' }>;
        return `${read.about.unit}, from ${read.about.unitFrom}, radius ${c.radius.toFixed(6)} mm, notes ${JSON.stringify(read.about.notes)}`;
      } catch (error) {
        return (error as Error).message;
      }
    };
    // fable 16: an optimiser's rounded viewBox of an A4 page (was refused as an uneven scale)
    const a4 = one('width="210mm" height="297mm" viewBox="0 0 793.7 1122.52"');
    console.log('S11 A4 with a rounded viewBox:', a4);
    expect(a4).toMatch(/^0\.26458\d* mm per unit, from file/);
    expect(a4).toMatch(/the smaller is taken/);
    const exact = one('width="100mm" height="50mm" viewBox="0 0 200 100"');
    console.log('S11 equal scales:', exact);
    expect(exact).toBe('0.5 mm per unit, from file, radius 5.000000 mm, notes []');
    const stretched = one('width="100mm" height="100mm" viewBox="0 0 200 100"');
    console.log('S11 scales 0.5 and 1 (a viewer fits):', stretched);
    expect(stretched).toMatch(/^0\.5 mm per unit, from file, radius 5\.000000 mm/);
    expect(stretched).toMatch(/more than a thousandth/);
    const none = one('width="100mm" height="100mm" viewBox="0 0 200 100" preserveAspectRatio="none"');
    console.log('S11 the same with preserveAspectRatio none:', none);
    expect(none).toMatch(/^unreadable: .*give the option unit/);
    const nearNone = one('width="210mm" height="297mm" viewBox="0 0 793.7 1122.52" preserveAspectRatio="none"');
    console.log('S11 the rounded A4 with preserveAspectRatio none:', nearNone);
    expect(nearNone).toMatch(/from file/);
    for (const size of ['width="0" height="10mm" viewBox="0 0 100 100"', 'width="10mm" height="0mm" viewBox="0 0 100 100"', 'width="-5mm" height="10mm"']) {
      const message = one(size);
      console.log(`S11 ${size}:`, message);
      expect(message).toMatch(/^unreadable: the root has no size/);
    }
    const bare = one('');
    console.log('S11 no size:', bare);
    expect(bare).toMatch(/^px, from default, radius 2\.645833 mm, notes \["the root gives no size/);
    const given = readSvg(root('width="210mm" height="297mm" viewBox="0 0 793.7 1122.52"'), { unit: 'mm' });
    expect(given.about.unitFrom).toBe('option');
    expect(given.about.notes).toEqual([]);
  });

  it('S12: the limit of control points, and a path scanned as it is read', () => {
    const cubics = (n: number): string => mm(`<path d="M0 0${Array.from({ length: n }, (_, i) => ` C${i} 1 ${i} 2 ${i + 1} 0`).join('')}"/>`);
    const timed = (text: string): string => {
      const started = performance.now();
      let outcome: string;
      try {
        const read = readSvg(text);
        outcome = `read, ${read.curves.length} curves`;
      } catch (error) {
        outcome = (error as Error).message;
      }
      return `${outcome} in ${(performance.now() - started).toFixed(1)} ms`;
    };
    const within = timed(cubics(1900));
    const most = timed(cubics(SVG_MAX_CONTROL / 4));
    const over = timed(cubics(2100)); // codex 6: 8400 control points were read
    console.log('S12 1900 C:', within, '|', `${SVG_MAX_CONTROL / 4} C:`, most, '| 2100 C:', over);
    expect(within).toMatch(/^read, 1900 curves/);
    expect(most).toMatch(/^read, 2000 curves/);
    expect(over).toMatch(/^tooLarge: the splines/);
    // quadratics count three each; lines none
    const quads = (n: number): string => mm(`<path d="M0 0${Array.from({ length: n }, (_, i) => ` Q${i} 1 ${i + 1} 0`).join('')}"/>`);
    expect(timed(quads(2666))).toMatch(/^read, 2666 curves/);
    expect(timed(quads(2667))).toMatch(/^tooLarge: the splines/);
    // a huge path stops at the limit and is not scanned to its end: 200,000 lines, and the same
    // with data that does not parse at its very end (never reached)
    const lines = (n: number, tail = ''): string => mm(`<path d="M0 0${' L1 0 L0 0'.repeat(n / 2)}${tail}"/>`);
    const huge = timed(lines(200_000));
    const hugeBroken = timed(lines(200_000, ' L 1 x'));
    console.log('S12 200,000 lines:', huge, '| with a broken end:', hugeBroken);
    expect(huge).toMatch(/^tooLarge: /);
    expect(hugeBroken).toMatch(/^tooLarge: /);
    // a path that is left out gives its control points back
    const elliptical = `<path d="M0 0${' C1 1 2 1 3 0'.repeat(1500)} A 5 3 0 0 1 10 0"/>`;
    const both = readSvg(mm(elliptical + elliptical + `<path d="M0 0${' C1 1 2 1 3 0'.repeat(1500)}"/>`));
    console.log('S12 two paths of 1500 C left out, a third read:', both.curves.length, JSON.stringify(both.about.skipped));
    expect(both.curves).toHaveLength(1500);
    // after a segment that is not read the rest of the data is still checked
    expect(refusal(mm('<path d="M0 0 A 5 3 0 0 1 10 0 L 1 x"/>'))).toMatch(/^unreadable: /);
  });

  it('S13: what about says: where the unit came from, notes, the layers by tag', () => {
    const read = readSvg(mm('<g id="cut"><rect width="10" height="5"/><circle r="1"/><circle cx="5" r="1"/><text>A</text></g><g inkscape:label="engrave" id="g7"><path d="M0 0 L1 1"/><svg width="1" height="1"/></g><line x1="0" y1="0" x2="1" y2="0"/>'), { layers: ['cut'] });
    console.log('S13 about', JSON.stringify(read.about));
    expect(read.about.layers).toEqual({ cut: { rect: 1, circle: 2, text: 1 }, engrave: { path: 1, svg: 1 }, '': { line: 1 } });
    expect(read.about.unitFrom).toBe('file');
    expect(read.about.notes).toEqual([]);
    expect(read.about.skipped).toEqual({ text: 1 });
    expect(read.curves).toHaveLength(6);
  });

  it('S14: a transform without an inverse', () => {
    const read = readSvg(mm('<g transform="scale(2,0)"><circle r="5"/><rect width="10" height="5"/><path d="M0 0 L5 5 C1 1 2 2 3 3"/><polygon points="0,0 4,0 4,3"/></g><g transform="matrix(1 2 2 4 0 0)"><line x1="0" y1="0" x2="1" y2="1"/></g><g transform="scale(0)"><circle r="1"/></g><circle r="1"/>'));
    console.log('S14', read.curves.length, 'curves;', JSON.stringify(read.about.skipped));
    expect(read.curves).toHaveLength(1);
    expect(read.about.skipped).toEqual({ 'circle (flat transform)': 2, 'rect (flat transform)': 1, 'path (flat transform)': 1, 'polygon (flat transform)': 1, 'line (flat transform)': 1 });
    // a broken path under such a transform is still a broken file
    expect(refusal(mm('<g transform="scale(2,0)"><path d="M0 0 L 1 x"/></g>'))).toMatch(/^unreadable: /);
    // a tiny but whole scale is no flat transform
    expect(readSvg(mm('<g transform="scale(1e-6)"><circle r="5"/></g>')).curves).toHaveLength(1);
  });
});
