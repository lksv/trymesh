// The format `3mf` (D54) over a small model of its own: the whole package pinned, the names, the
// colours and their base materials, the renumbered vertices, the refusals, the empty package. The
// box of scenario 12 is in packages/scenarios.
import { describe, expect, it } from 'vitest';
import { NO_BODY, NO_PRINTED_BODY } from '../src/export/bodies';
import { THREE_MF, baseMaterials, threeMf } from '../src/export/threemf';
import type { QueryContext } from '../src/query/spec';
import { QueryFailure } from '../src/query/spec';
import type { BodyPropertiesResult, Id, Solid } from '../src/types';
import { readZip } from './zip-reader';

// A tetrahedron with its corners at the origin and on the three axes, wound outwards.
const tetrahedron = (size: number, spare = false): Solid => ({
  // `spare`: a position no triangle names, between the others (a mesh of the kernel can hold one)
  positions: Float32Array.from(spare ? [0, 0, 0, 9, 9, 9, size, 0, 0, 0, size, 0, 0, 0, size] : [0, 0, 0, size, 0, 0, 0, size, 0, 0, 0, size]),
  triangles: Uint32Array.from(spare ? [0, 3, 2, 0, 2, 4, 0, 4, 3, 2, 3, 4] : [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  faceIds: Uint32Array.from([0, 1, 2, 3]),
});
type Properties = Partial<BodyPropertiesResult> & { name: string };
const contextOf = (bodies: Record<Id, { solid: Solid; properties: Properties }>): QueryContext =>
  ({
    state: { evaluation: { bodyProperties: Object.fromEntries(Object.entries(bodies).map(([id, body]) => [id, { use: 'part', ...body.properties }])) } },
    bodies: Object.fromEntries(Object.entries(bodies).map(([id, body]) => [id, { solid: body.solid }])),
  }) as unknown as QueryContext;
const modelOf = (context: QueryContext, bodies?: Id[]) => {
  const exported = threeMf.run(context, bodies ? { bodies } : {});
  const items = readZip(exported.files[0].bytes);
  return { exported, items, model: new TextDecoder().decode(items[2].bytes) };
};

describe('the format 3mf', () => {
  it('a small model, the whole package: three items, the model with its object, vertices, triangles and build', () => {
    const context = contextOf({ t: { solid: tetrahedron(1.5), properties: { name: 'Tetra' } } });
    const { exported, items, model } = modelOf(context);
    expect(exported.layout).toBe('file');
    expect(exported.empty).toBeUndefined();
    expect(exported.files.map(({ path, mediaType, about }) => ({ path, mediaType, about }))).toEqual([{ path: 'model.3mf', mediaType: 'model/3mf', about: { bodies: ['t'], triangles: 4 } }]);
    expect(items.map((item) => [item.name, item.flags])).toEqual([
      [THREE_MF.contentTypes.item, 0],
      [THREE_MF.relationships.item, 0],
      [THREE_MF.model.item, 0],
    ]);
    const text = (i: number) => new TextDecoder().decode(items[i].bytes);
    expect(text(0)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n',
    );
    expect(text(1)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n',
    );
    expect(model).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
        '<metadata name="Application">trymesh</metadata>',
        '<resources>',
        '<object id="1" type="model" name="Tetra" partnumber="t"><mesh><vertices>',
        '<vertex x="0" y="0" z="0"/>',
        '<vertex x="1.5" y="0" z="0"/>',
        '<vertex x="0" y="1.5" z="0"/>',
        '<vertex x="0" y="0" z="1.5"/>',
        '</vertices><triangles>',
        '<triangle v1="0" v2="2" v3="1"/>',
        '<triangle v1="0" v2="1" v3="3"/>',
        '<triangle v1="0" v2="3" v3="2"/>',
        '<triangle v1="1" v2="2" v3="3"/>',
        '</triangles></mesh></object>',
        '</resources>',
        '<build><item objectid="1"/></build>',
        '</model>',
        '',
      ].join('\n'),
    );
    // the same model gives the same bytes: no clock
    expect(threeMf.run(context, {}).files[0].bytes).toEqual(exported.files[0].bytes);
  });

  it('names and colours: a base material per pair of a label and a colour, the objects after the group', () => {
    const context = contextOf({
      a: { solid: tetrahedron(1), properties: { name: 'Lid <A&B>', color: '#ff8800', material: 'PETG' } },
      b: { solid: tetrahedron(2), properties: { name: 'b', color: '#30343a' } },
      c: { solid: tetrahedron(3), properties: { name: 'c' } },
      d: { solid: tetrahedron(4), properties: { name: 'd', color: '#ff8800', material: 'PETG' } },
    });
    const { model, exported } = modelOf(context);
    expect(model).toContain('<resources>\n<basematerials id="1"><base name="PETG" displaycolor="#FF8800"/><base name="#30343a" displaycolor="#30343A"/></basematerials>\n<object id="2"');
    expect(model).toContain('<object id="2" type="model" name="Lid &lt;A&amp;B&gt;" partnumber="a" pid="1" pindex="0">');
    expect(model).toContain('<object id="3" type="model" name="b" partnumber="b" pid="1" pindex="1">');
    expect(model).toContain('<object id="4" type="model" name="c" partnumber="c">'); // no colour, no property
    expect(model).toContain('<object id="5" type="model" name="d" partnumber="d" pid="1" pindex="0">'); // the same pair shares the entry
    expect(model).toContain('<build><item objectid="2"/><item objectid="3"/><item objectid="4"/><item objectid="5"/></build>');
    expect(exported.files[0].about).toEqual({ bodies: ['a', 'b', 'c', 'd'], triangles: 16 });
  });

  it('baseMaterials: shared entries, one label with two colours, no colour', () => {
    expect(baseMaterials([{ body: 'a', name: 'a' }])).toEqual({ bases: [], indexOf: [undefined] });
    expect(
      baseMaterials([
        { body: 'a', name: 'a', color: '#ff8800', material: 'PETG' },
        { body: 'b', name: 'b', color: '#000000', material: 'PETG' },
        { body: 'c', name: 'c', material: 'PLA' }, // a label without a colour is not written
        { body: 'd', name: 'd', color: '#ff8800', material: 'PETG' },
        { body: 'e', name: 'e', color: '#ffffff' },
        { body: 'f', name: 'f', color: '#ffffff', material: 'PLA' },
      ]),
    ).toEqual({
      bases: [
        { name: 'PETG #ff8800', displaycolor: '#FF8800' },
        { name: 'PETG #000000', displaycolor: '#000000' },
        { name: '#ffffff', displaycolor: '#FFFFFF' },
        { name: 'PLA', displaycolor: '#FFFFFF' },
      ],
      indexOf: [0, 1, undefined, 0, 2, 3],
    });
  });

  it('the mesh: only the positions a triangle names, in the order of `positions`, renumbered; read back equal to the solid', () => {
    const solid = tetrahedron(2, true);
    const { model } = modelOf(contextOf({ t: { solid, properties: { name: 't' } } }));
    expect(model).not.toContain('x="9"');
    const vertices = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((match) => [match[1], match[2], match[3]].map(Number));
    const corners = [...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap((match) => [match[1], match[2], match[3]].map(Number));
    expect(vertices).toEqual([[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]]);
    expect(corners).toEqual([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    expect(corners.every((vertex, i) => [0, 1, 2].every((k) => Math.fround(vertices[vertex][k]) === solid.positions[3 * solid.triangles[i] + k]))).toBe(true);
  });

  it('refuses a triangle that names a vertex twice and a coordinate that is not finite', () => {
    const twice = { ...tetrahedron(1), triangles: Uint32Array.from([0, 2, 1, 0, 1, 1, 0, 3, 2, 1, 2, 3]) };
    expect(() => threeMf.run(contextOf({ t: { solid: twice, properties: { name: 't' } } }), {})).toThrow(new QueryFailure('failed', 'a triangle of the body "t" names one vertex twice, which 3MF does not allow'));
    const wild = tetrahedron(1);
    wild.positions[4] = Number.NaN;
    expect(() => threeMf.run(contextOf({ t: { solid: wild, properties: { name: 't' } } }), {})).toThrow(QueryFailure);
  });

  it('which bodies: a list in its order whatever the use, the printed ones without; the file of an empty export is a package without an object', () => {
    const context = contextOf({ a: { solid: tetrahedron(1), properties: { name: 'a' } }, b: { solid: tetrahedron(1), properties: { name: 'b', use: 'reference' } } });
    expect(modelOf(context).exported.files[0].about).toEqual({ bodies: ['a'], triangles: 4 });
    expect(modelOf(context, ['b', 'a', 'b']).exported.files[0].about).toEqual({ bodies: ['b', 'a'], triangles: 8 });
    const unprinted = contextOf({ b: { solid: tetrahedron(1), properties: { name: 'b', use: 'reference' } } });
    const { exported, items, model } = modelOf(unprinted);
    expect(exported.empty).toBe(NO_PRINTED_BODY);
    expect(items.length).toBe(3);
    expect(model).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">trymesh</metadata>\n<resources>\n</resources>\n<build></build>\n</model>\n');
    expect(modelOf(contextOf({})).exported.empty).toBe(NO_BODY);
  });
});
