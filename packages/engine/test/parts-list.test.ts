// The parts list (D57) on documents and meshes written by hand: what a solid is a copy of, the
// chain of sources of a body and the name of a kind of part, the rows of the query over a context
// written by hand (what a row comes from), the count of holes on cuts written by hand, and the
// fields and numbers of the CSV file. The cases with the real adapters are in
// packages/scenarios/test/parts.test.ts.
import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/document';
import { PARTS_CSV, grams, partNote, partsCsvText } from '../src/export/parts-csv';
import { csvField } from '../src/export/text';
import { sourceChain, sourceRoot } from '../src/features/index';
import { type PartRow, type PartsList, holeCounts, partsList } from '../src/query/parts-list';
import type { QueryContext } from '../src/query/spec';
import { partName } from '../src/sections/body-properties';
import { reflection, shapeOrigin, shift, transformSolid, volumeOf } from '../src/solid';
import type { BodyPropertiesResult, BodyResult, Document, ExtrudeFeature, FaceName, Feature, Id, PatternFeature, Solid, Surface, Vec3 } from '../src/types';
import { box, prism, regular } from './section-kit';

const same = (face: number): number => face;
const plate = (id: Id, name = id): ExtrudeFeature => ({ id, name, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['a'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' });
const row = (id: Id, body: Id, name = id): PatternFeature => ({ id, name, suppressed: false, type: 'pattern', source: { type: 'body', body }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 100 } } });
const mirror = (id: Id, body: Id): PatternFeature => ({ id, name: id, suppressed: false, type: 'pattern', source: { type: 'body', body }, transform: { type: 'mirror', plane: { kind: 'base', plane: 'YZ' } } });
const documentOf = (features: Feature[], bodyProperties: Document['bodyProperties'] = {}): Document => ({ ...emptyDocument(), features, bodyProperties });

describe('the origin of a copied mesh (shapeOrigin)', () => {
  it('a solid that is no copy is its own origin', () => {
    const solid = box();
    expect(shapeOrigin(solid)).toEqual({ solid, mirrored: false });
  });

  it('a copy, a copy of a copy, a mirror image and two mirrors', () => {
    const source = box();
    const moved = transformSolid(shift([1, 0, 0], 100), source, same);
    const again = transformSolid(shift([0, 1, 0], 50), moved, same);
    const image = transformSolid(reflection([0, 0, 0], [1, 0, 0]), source, same);
    const back = transformSolid(reflection([0, 0, 0], [0, 1, 0]), image, same);
    expect(shapeOrigin(moved).solid).toBe(source);
    expect(shapeOrigin(moved).mirrored).toBe(false);
    expect(shapeOrigin(again).solid).toBe(source);
    expect(shapeOrigin(again).mirrored).toBe(false);
    expect(shapeOrigin(image)).toEqual({ solid: source, mirrored: true });
    expect(shapeOrigin(image).solid).toBe(source);
    // two mirrors give the shape back, turned
    expect(shapeOrigin(back).solid).toBe(source);
    expect(shapeOrigin(back).mirrored).toBe(false);
    // the copy is a new object with the moved mesh; the source is untouched
    expect(moved).not.toBe(source);
    expect(volumeOf(moved)).toBeCloseTo(volumeOf(source), 9);
    expect(volumeOf(image)).toBeCloseTo(volumeOf(source), 9);
  });

  it('a mesh made anew from a copy (as a feature that changes a body does) is a copy of nothing', () => {
    const copy = transformSolid(shift([1, 0, 0], 100), box(), same);
    const changed: Solid = { positions: copy.positions.slice(), triangles: copy.triangles.slice(), faceIds: copy.faceIds.slice() };
    expect(shapeOrigin(changed)).toEqual({ solid: changed, mirrored: false });
  });
});

describe('the chain of sources and the name of a kind of part', () => {
  it('sourceRoot: a chain, a body without a source, a cycle of a document edited by hand, a body whose feature is gone', () => {
    const doc = documentOf([plate('plate'), row('row', 'plate'), row('more', 'row/1')]);
    expect(sourceChain(doc, 'more/2')).toEqual(['more/2', 'row/1', 'plate']);
    expect(sourceRoot(doc, 'more/2')).toBe('plate');
    expect(sourceRoot(doc, 'plate')).toBe('plate');
    // a cycle: the chain stops at a body it has seen
    const cycle = documentOf([row('a', 'b/1'), row('b', 'a/1')]);
    expect(sourceChain(cycle, 'a/1')).toEqual(['a/1', 'b/1']);
    expect(sourceRoot(cycle, 'a/1')).toBe('b/1');
    // the pattern is gone: the body has no source
    expect(sourceRoot(documentOf([plate('plate')]), 'row/1')).toBe('row/1');
    // the source of the pattern is gone: the chain ends at it, though no feature makes it
    expect(sourceRoot(documentOf([row('row', 'gone')]), 'row/2')).toBe('gone');
  });

  it('partName: the name of the body, of its nearest source, else the default name of the root', () => {
    const features = [plate('plate', 'Plate'), row('row', 'plate', 'Row'), row('more', 'row/1', 'More')];
    expect(partName(documentOf(features), 'more/2')).toBe('Plate');
    expect(partName(documentOf(features), 'row/1')).toBe('Plate');
    expect(partName(documentOf(features, { 'row/1': { name: 'special' } }), 'more/2')).toBe('special');
    expect(partName(documentOf(features, { 'row/1': { name: 'special' }, 'more/2': { name: 'spare' } }), 'more/2')).toBe('spare');
    expect(partName(documentOf(features, { 'row/1': { color: '#000000' }, plate: { name: 'base plate' } }), 'more/1')).toBe('base plate');
    // a root that is a copy of a pattern whose source is gone: its default name, with its number
    expect(partName(documentOf([row('row', 'gone/1', 'Row')]), 'row/2')).toBe('gone / 1');
    // the root not in the state (a body a later feature used up, 3d): its name still comes from the document
    expect(partName(documentOf([plate('gone', 'Old'), row('row', 'gone')]), 'row/1')).toBe('Old');
  });
});

// ---------------------------------------------------------------- the rows over a context written by hand

interface Given {
  solid: Solid;
  properties?: Partial<BodyPropertiesResult>;
}
function contextOf(doc: Document, bodies: Record<Id, Given>): QueryContext {
  const results: Record<Id, BodyResult> = Object.fromEntries(Object.entries(bodies).map(([id, { solid }]) => [id, { solid, faces: [], edges: [], volume: volumeOf(solid), bounds: { min: [0, 0, 0], max: [0, 0, 0] } }]));
  const bodyProperties = Object.fromEntries(Object.entries(bodies).map(([id, { properties }]) => [id, { name: id, use: 'part', ...properties }]));
  return { state: { document: doc, evaluation: { faceNames: [], bodyProperties } }, bodies: results, surface: () => undefined, threadsAsModelled: () => [] } as unknown as QueryContext;
}
const ask = (context: QueryContext): PartsList => partsList.run(context, {});
const told = (r: PartRow): string => `${r.name} × ${r.count}: ${r.bodies.join(' ')}${r.copyOf ? ` (${r.differs ? 'differs from' : r.mirrored ? 'mirror image of' : 'copy of'} ${r.copyOf})` : ''}`;

describe('the rows of bodies', () => {
  const doc = documentOf([plate('plate'), row('row', 'plate'), mirror('m', 'plate')]);
  const source = box();
  const copy = (by: number): Solid => transformSolid(shift([1, 0, 0], by), source, same);

  it('copies of one mesh are one row; a mirror image is a row of its own, `mirrored`, pointing at its source', () => {
    const list = ask(contextOf(doc, { plate: { solid: source }, 'row/1': { solid: copy(100) }, 'row/2': { solid: copy(200) }, 'm/1': { solid: transformSolid(reflection([0, 0, 0], [1, 0, 0]), source, same) } }));
    expect(list.printed.map(told)).toEqual(['plate × 3: plate row/1 row/2', 'plate × 1: m/1 (mirror image of plate)']);
    expect(list.printed[1].mirrored).toBe(true);
    expect(list.printed[1].differs).toBeUndefined();
    expect(list.printed[0].volume).toBeCloseTo(120, 9);
  });

  it('a copy changed after the pattern `differs`; so do the copies when the source was changed; a changed mirror image says no hand', () => {
    const changed = (solid: Solid): Solid => ({ ...solid, positions: solid.positions.slice() });
    let list = ask(contextOf(doc, { plate: { solid: source }, 'row/1': { solid: changed(copy(100)) }, 'row/2': { solid: copy(200) } }));
    expect(list.printed.map(told)).toEqual(['plate × 2: plate row/2', 'plate × 1: row/1 (differs from plate)']);
    list = ask(contextOf(doc, { plate: { solid: changed(source) }, 'row/1': { solid: copy(100) }, 'row/2': { solid: copy(200) } }));
    expect(list.printed.map(told)).toEqual(['plate × 1: plate', 'plate × 2: row/1 row/2 (differs from plate)']);
    list = ask(contextOf(doc, { plate: { solid: source }, 'm/1': { solid: changed(transformSolid(reflection([0, 0, 0], [1, 0, 0]), source, same)) } }));
    expect(list.printed.map(told)).toEqual(['plate × 1: plate', 'plate × 1: m/1 (differs from plate)']);
    expect(list.printed[1].mirrored).toBeUndefined();
  });

  it('a copy with other properties is a row of its own that points at its source; a root that is not in the state is named and pointed at by nobody', () => {
    let list = ask(contextOf(doc, { plate: { solid: source }, 'row/1': { solid: copy(100), properties: { color: '#000000' } }, 'row/2': { solid: copy(200) } }));
    expect(list.printed.map(told)).toEqual(['plate × 2: plate row/2', 'plate × 1: row/1 (copy of plate)']);
    expect(list.printed[1].color).toBe('#000000');
    list = ask(contextOf(doc, { 'row/1': { solid: copy(100) }, 'row/2': { solid: copy(200) } }));
    expect(list.printed.map(told)).toEqual(['plate × 2: row/1 row/2']);
    // an auxiliary root is in the state: the row points at it
    list = ask(contextOf(doc, { plate: { solid: source, properties: { use: 'auxiliary' } }, 'row/1': { solid: copy(100) } }));
    expect(list.printed.map(told)).toEqual(['plate × 1: row/1 (copy of plate)']);
    expect(list.auxiliary).toEqual(['plate']);
  });

  it('a body whose volume is not above zero is taken for no copy', () => {
    const flat = prism(regular(4, 1), 0, 0, () => 2);
    const collapsed = transformSolid(shift([1, 0, 0], 100), flat, same);
    expect(volumeOf(collapsed)).toBeCloseTo(0, 12);
    const list = ask(contextOf(doc, { plate: { solid: flat }, 'row/1': { solid: collapsed } }));
    expect(list.printed.map(told)).toEqual(['plate × 1: plate', 'plate × 1: row/1 (differs from plate)']);
  });

  it('the mass: by its source and number; without one, whether it is in error; the sums', () => {
    const mass = (value: number): Partial<BodyPropertiesResult> => ({ mass: value, massFrom: 'mass' });
    const list = ask(
      contextOf(doc, {
        plate: { solid: source, properties: mass(10) },
        'row/1': { solid: copy(100), properties: { fieldErrors: { mass: { message: 'x' } } as never } },
        'row/2': { solid: copy(200), properties: mass(10) },
        'm/1': { solid: transformSolid(reflection([0, 0, 0], [1, 0, 0]), source, same), properties: { use: 'reference', mass: 20, massFrom: 'mass' } },
      }),
    );
    expect(list.printed.map((r) => [r.bodies.join(' '), r.mass, r.totalMass, r.noMass])).toEqual([
      ['plate row/2', 10, 20, undefined],
      ['row/1', undefined, undefined, 'inError'],
    ]);
    expect(list.bought.map(told)).toEqual(['plate × 1: m/1 (mirror image of plate)']);
    expect(list.totals).toEqual({ printed: { count: 3, mass: 20, withoutMass: 1 }, bought: { count: 1, mass: 20, withoutMass: 0 }, hardware: { count: 0 } });
  });
});

// ---------------------------------------------------------------- the holes on cuts written by hand

describe('the count of holes', () => {
  // A plate 20 × 20 from z0 to z1 with a square "bore" around (10, 10): the bore is face 9 of the
  // prism, a stand-in for the polygon of a cylinder; its surface is given by `surface`.
  const bored = (z0: number, z1: number, x = 0): Solid => prism([[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]], z0, z1, (side) => 2 + side, regular(4, 2).map(([u, v]) => [u + x + 10, v + 10]));
  const doc = documentOf([{ id: 'h', name: 'h', suppressed: false, type: 'hole', sketch: 'p', points: ['a'], shape: { type: 'plain', diameter: 4 }, extent: { type: 'distance', start: 0, distance: -5 }, targets: ['plate'] }]);
  const bore = (copy?: FaceName['copy']): FaceName => ({ feature: 'h', role: 'holeBore', point: 'a', ...(copy ? { copy } : {}) });
  const cylinder = (x = 0): Surface => ({ kind: 'cylinder', origin: [x + 10, 10, 0], axis: [0, 0, 1], radius: 2 });
  const count = (bodies: Record<Id, { solid: Solid; name: FaceName; x?: number }>): number | undefined => {
    const faceNames: FaceName[] = [];
    const given = Object.fromEntries(
      Object.entries(bodies).map(([id, { solid, name }]) => {
        let number = faceNames.findIndex((other) => JSON.stringify(other) === JSON.stringify(name));
        if (number < 0) number = faceNames.push(name) - 1;
        return [id, { solid: { ...solid, faceIds: solid.faceIds.map((face) => (face === 9 ? number : 100 + face)) }, faces: [{ id: number }] }];
      }),
    );
    return holeCounts(doc, given, faceNames, (body) => cylinder(bodies[body].x)).get('h');
  };
  const tag = (index: number): FaceName['copy'] => [{ pattern: 'row', index }];

  it('one build in two bodies is one hole, also with a gap between them', () => {
    expect(count({ low: { solid: bored(0, 5), name: bore() }, high: { solid: bored(100, 105), name: bore() } })).toBe(1);
  });

  it('copies on one line that touch are one hole, apart they are two; at another place another', () => {
    expect(count({ plate: { solid: bored(0, 5), name: bore() }, 'row/1': { solid: bored(5, 10), name: bore(tag(1)) } })).toBe(1);
    expect(count({ plate: { solid: bored(0, 5), name: bore() }, 'row/1': { solid: bored(5.001, 10.001), name: bore(tag(1)) } })).toBe(2);
    expect(count({ plate: { solid: bored(0, 5), name: bore() }, 'row/1': { solid: bored(0, 5, 100), name: bore(tag(1)), x: 100 } })).toBe(2);
    // a stack of three: joined one after the other
    expect(count({ plate: { solid: bored(0, 5), name: bore() }, 'row/1': { solid: bored(5, 10), name: bore(tag(1)) }, 'row/2': { solid: bored(10, 15), name: bore(tag(2)) } })).toBe(1);
  });

  it('a copy in the gap of a cut through two bodies is a hole of its own', () => {
    expect(count({ low: { solid: bored(0, 5), name: bore() }, high: { solid: bored(100, 105), name: bore() }, 'row/1': { solid: bored(50, 55), name: bore(tag(1)) } })).toBe(2);
  });

  it('a gap of a thousandth far from the origin across the hole is still a gap', () => {
    expect(count({ plate: { solid: bored(0, 5, 2000), name: bore(), x: 2000 }, 'row/1': { solid: bored(5.001, 10.001, 2000), name: bore(tag(1)), x: 2000 } })).toBe(2);
  });

  it('the comparison of sorted lines keeps a pair on one line whose surface point lies far along it and whose axis leans within the tolerance', () => {
    const lean = 0.9e-4; // within ANGLE_TOLERANCE
    const faceNames: FaceName[] = [bore(), bore(tag(1))];
    const surfaces: Surface[] = [
      { kind: 'cylinder', origin: [10, 10, 0], axis: [0, 0, 1], radius: 2 },
      { kind: 'cylinder', origin: [10, 10, 5000], axis: [0, Math.sin(lean), Math.cos(lean)], radius: 2 },
    ];
    const as = (solid: Solid, face: number): Solid => ({ ...solid, faceIds: solid.faceIds.map((f) => (f === 9 ? face : 100 + f)) });
    const bodies = { plate: { solid: as(bored(0, 5), 0), faces: [{ id: 0 }] }, 'row/1': { solid: as(bored(5, 10), 1), faces: [{ id: 1 }] } };
    expect(holeCounts(doc, bodies, faceNames, (body) => surfaces[body === 'plate' ? 0 : 1]).get('h')).toBe(1);
    // and many cuts of one feature on lines of a grid: each its own hole
    const many: FaceName[] = [];
    const grid: Record<Id, { solid: Solid; faces: { id: number }[] }> = {};
    const at: Surface[] = [];
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 30;
      const y = Math.floor(i / 20) * 30;
      many.push(bore(i ? tag(i) : undefined));
      at.push(cylinder(x));
      grid[`b${i}`] = { solid: as(bored(0, 5, x), i), faces: [{ id: i }] };
      (at[i] as { origin: Vec3 }).origin = [x + 10, 10 + y, 0];
      grid[`b${i}`].solid = { ...grid[`b${i}`].solid, positions: grid[`b${i}`].solid.positions.map((v, k) => (k % 3 === 1 ? v + y : v)) };
    }
    expect(holeCounts(doc, grid, many, (body) => at[Number(body.slice(1))]).get('h')).toBe(400);
  });

  it('no face of the feature, no count', () => {
    expect(holeCounts(doc, {}, [], () => undefined).get('h')).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the file

describe('the CSV file', () => {
  it('csvField: a comma, a quote, a tab, a line break, none', () => {
    expect(csvField('plain text')).toBe('plain text');
    expect(csvField('M3 insert, brass')).toBe('"M3 insert, brass"');
    expect(csvField('plate "A"')).toBe('"plate ""A"""');
    expect(csvField('top,\tplate "A"')).toBe('"top, plate ""A"""');
    expect(csvField('two\r\nlines')).toBe('two  lines');
    expect(csvField('bell\u0007\u007f')).toBe('bell  ');
    expect(csvField('')).toBe('');
  });

  it('a mass: six significant digits, a decimal point, no exponent', () => {
    expect(grams(1.2e-7)).toBe('0.00000012');
    expect(grams(1e21)).toBe('1000000000000000000000');
    expect(grams(123456.789)).toBe('123457');
    expect(grams(36.40164)).toBe('36.4016');
    expect(grams(-0)).toBe('0');
    expect(grams(undefined)).toBe('');
  });

  it('the records: the header, the rows of the three kinds, nine fields each, CR LF', () => {
    const body = (name: string, bodies: Id[], more: Partial<PartRow> = {}): PartRow => ({ name, count: bodies.length, bodies, volume: 1, ...more });
    const list: PartsList = {
      printed: [body('plate', ['plate', 'row/1'], { material: 'PETG', mass: 1.5, massFrom: 'density', totalMass: 3 }), body('plate', ['m/1'], { material: 'PETG', mass: 1.5, massFrom: 'density', totalMass: 1.5, copyOf: 'plate', mirrored: true }), body('bare', ['bare'], { noMass: 'notStated' })],
      bought: [body('motor', ['motor'], { color: '#30343a', mass: 280, massFrom: 'mass', totalMass: 280, copyOf: 'x', differs: true })],
      hardware: [{ label: 'M3 insert, brass', count: 4, holes: [{ feature: 'inserts', count: 3 }, { feature: 'more', count: 1 }] }],
      totals: { printed: { count: 4, mass: 4.5, withoutMass: 1 }, bought: { count: 1, mass: 280, withoutMass: 0 }, hardware: { count: 4 } },
    };
    const text = partsCsvText(list);
    expect(text.split('\r\n')).toEqual([
      'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs',
      'printed,plate,2,PETG,,1.5,3,,plate row/1',
      'printed,plate,1,PETG,,1.5,1.5,mirror image of plate,m/1',
      'printed,bare,1,,,,,,bare',
      'bought,motor,1,,#30343a,280,280,differs from x,motor',
      'hardware,"M3 insert, brass",4,,,,,,inserts more',
      '',
    ]);
    expect(text.includes('\n') && !/[^\r]\n/.test(text)).toBe(true);
    expect(PARTS_CSV.header).toHaveLength(9);
    expect(partNote(body('a', ['b'], { copyOf: 'c' }))).toBe('copy of c');
  });
});
