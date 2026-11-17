// The format `3mf` (D54): the bodies as objects of one 3MF document, for a slicer. 3MF Core
// Specification 1.4.0 (3MF Consortium) and the Open Packaging Conventions (ECMA-376 part 2).
//
// The package is a ZIP (`zip.ts`) of three items, in this order, each deflated by the compressor
// of the context when the engine has one (and its stream is shorter), stored otherwise:
// - `[Content_Types].xml`, the Media Types stream (OPC 7.3.7, 7.2.3.2), with the defaults for
//   `rels` and `model` (3MF appendix C.1);
// - `_rels/.rels`, the package Relationships part (OPC 6.5.2.2), with the StartPart relationship
//   to the model (3MF 2.1.1, appendix C.2);
// - `3D/3dmodel.model`, the 3D Model part (2.2.3), UTF-8 XML without a DTD (2.3.2).
//
// The model, in millimetres with the metadata `Application`:
// - a group of base materials (chapter 5), ID 1, when a body has a colour;
// - an object of the type `model` per body (chapter 4), from the next ID, in the order of the
//   bodies: `name` the name of the body properties, `partnumber` the body ID, `pid` and `pindex`
//   its base material; the mesh of the body with the positions a triangle names, in the order of
//   `positions`, renumbered (4.1.3 asks for no duplicate vertices, and a mesh of the kernel may
//   hold positions no triangle uses);
// - a build item per object without a transform: the bodies are where they are modelled.
// A mesh of the type `model` has to be closed and consistently oriented with the normals outwards
// (4.1): what the kernel port guarantees of a body. The three vertices of a triangle have to be
// distinct (4.1.4.1), which nothing else guarantees: checked, `failed` otherwise.
import type { ArgSpecs } from '../query/args';
import { QueryFailure } from '../query/spec';
import type { Deflater, Id, Solid } from '../types';
import { chosenBodies } from './bodies';
import type { ExportFormatSpec } from './spec';
import { float32Text, xmlText } from './text';
import { zip } from './zip';

export const THREE_MF_OPTIONS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies', summary: 'The bodies to export, each once, in this order, whatever their use; without it the printed bodies (use `part`: not the reference and auxiliary bodies of the body properties).', optional: true },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface ExportFormats {
    '3mf': typeof THREE_MF_OPTIONS;
  }
}

// What `about` of the file says. A type alias, so it is assignable to `ExportFile.about`.
export type MeshAbout = {
  bodies: Id[]; // the bodies written, in their order
  triangles: number;
};

export const THREE_MF = {
  contentTypes: {
    item: '[Content_Types].xml',
    namespace: 'http://schemas.openxmlformats.org/package/2006/content-types',
    defaults: { rels: 'application/vnd.openxmlformats-package.relationships+xml', model: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' },
  },
  relationships: {
    item: '_rels/.rels',
    namespace: 'http://schemas.openxmlformats.org/package/2006/relationships',
    startPart: { id: 'rel0', type: 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel', target: '/3D/3dmodel.model' },
  },
  model: {
    item: '3D/3dmodel.model',
    namespace: 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02',
    unit: 'millimeter',
    application: 'trymesh',
  },
} as const;

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const CONTENT_TYPES = `${XML}<Types xmlns="${THREE_MF.contentTypes.namespace}"><Default Extension="rels" ContentType="${THREE_MF.contentTypes.defaults.rels}"/><Default Extension="model" ContentType="${THREE_MF.contentTypes.defaults.model}"/></Types>\n`;
const { startPart } = THREE_MF.relationships;
const RELATIONSHIPS = `${XML}<Relationships xmlns="${THREE_MF.relationships.namespace}"><Relationship Target="${startPart.target}" Id="${startPart.id}" Type="${startPart.type}"/></Relationships>\n`;

// What a body gives its object.
export interface ThreeMfObject {
  body: Id;
  name: string;
  color?: string; // `#rrggbb`, as the body properties hold it
  material?: string;
}
export interface BaseMaterial {
  name: string;
  displaycolor: string; // `#RRGGBB`
}

// The base materials of a list of objects, and for every object the index of its entry (or
// undefined). Only a body with a colour gets one: `displaycolor` is the colour, `name` the material
// label, or the colour itself without one. Two bodies with the same pair share the entry. Names of
// base materials should differ (5.1): when one label comes with several colours, each of those
// names is the label, a space and the colour. The colour is for display only (5.1, the note).
export function baseMaterials(objects: readonly ThreeMfObject[]): { bases: BaseMaterial[]; indexOf: (number | undefined)[] } {
  const pairs: { label: string; color: string }[] = [];
  const indexOf = objects.map((object) => {
    if (object.color === undefined) return undefined;
    const label = object.material ?? object.color;
    const found = pairs.findIndex((pair) => pair.label === label && pair.color === object.color);
    if (found >= 0) return found;
    pairs.push({ label, color: object.color });
    return pairs.length - 1;
  });
  const bases = pairs.map(({ label, color }) => ({
    name: pairs.filter((other) => other.label === label).length > 1 ? `${label} ${color}` : label,
    displaycolor: color.toUpperCase(),
  }));
  return { bases, indexOf };
}

// The 3D Model part of the bodies, in their order.
export function modelText(objects: readonly (ThreeMfObject & { solid: Solid })[]): string {
  const { bases, indexOf } = baseMaterials(objects);
  const parts: string[] = [`${XML}<model unit="${THREE_MF.model.unit}" xmlns="${THREE_MF.model.namespace}">\n<metadata name="Application">${THREE_MF.model.application}</metadata>\n<resources>\n`];
  if (bases.length) parts.push('<basematerials id="1">', ...bases.map((base) => `<base name="${xmlText(base.name)}" displaycolor="${base.displaycolor}"/>`), '</basematerials>\n');
  const first = bases.length ? 2 : 1; // resource IDs are positive and unique in the model (3.4.2)
  objects.forEach((object, i) => {
    const { positions, triangles } = object.solid;
    const base = indexOf[i];
    parts.push(`<object id="${first + i}" type="model" name="${xmlText(object.name)}" partnumber="${xmlText(object.body)}"${base === undefined ? '' : ` pid="1" pindex="${base}"`}><mesh><vertices>\n`);
    // the positions a triangle names, in the order of `positions`, renumbered
    const numbers = new Int32Array(positions.length / 3).fill(-1);
    for (let t = 0; t < triangles.length; t++) numbers[triangles[t]] = 0;
    const vertices: string[] = [];
    for (let v = 0; v < numbers.length; v++) {
      if (numbers[v] < 0) continue;
      numbers[v] = vertices.length;
      vertices.push(`<vertex x="${float32Text(positions[3 * v])}" y="${float32Text(positions[3 * v + 1])}" z="${float32Text(positions[3 * v + 2])}"/>`);
    }
    parts.push(vertices.join('\n'), '\n</vertices><triangles>\n');
    const faces: string[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
      if (a === b || b === c || a === c) throw new QueryFailure('failed', `a triangle of the body "${object.body}" names one vertex twice, which 3MF does not allow`);
      faces.push(`<triangle v1="${numbers[a]}" v2="${numbers[b]}" v3="${numbers[c]}"/>`);
    }
    parts.push(faces.join('\n'), '\n</triangles></mesh></object>\n');
  });
  parts.push('</resources>\n<build>', ...objects.map((_, i) => `<item objectid="${first + i}"/>`), '</build>\n</model>\n');
  return parts.join('');
}

// The whole package, its items deflated by `deflater` when one is given.
export function threeMfPackage(objects: readonly (ThreeMfObject & { solid: Solid })[], deflater?: Deflater): Uint8Array {
  const encoder = new TextEncoder();
  const items = [
    { name: THREE_MF.contentTypes.item, bytes: encoder.encode(CONTENT_TYPES) },
    { name: THREE_MF.relationships.item, bytes: encoder.encode(RELATIONSHIPS) },
    { name: THREE_MF.model.item, bytes: encoder.encode(modelText(objects)) },
  ];
  return zip(items, deflater);
}

export const threeMf: ExportFormatSpec<typeof THREE_MF_OPTIONS> = {
  title: '3MF',
  summary:
    'Bodies as the objects of one 3MF document, for a slicer: each body is an object with its name (the name of the body properties), its ID as the part number and, when the body has a colour, a base material with that colour, named by the material of the body. ' +
    'One file, in millimetres, the bodies where they are modelled. The file is a ZIP, compressed when the engine has a compressor: about a fifth of the size of the STL of the same bodies; otherwise about a quarter larger than the STL.',
  options: THREE_MF_OPTIONS,
  run: (context, { bodies }) => {
    const { chosen, empty } = chosenBodies(context, bodies);
    const properties = context.state.evaluation.bodyProperties;
    const objects = chosen.map((body) => {
      const { name, color, material } = properties[body];
      return { body, name, ...(color === undefined ? {} : { color }), ...(material === undefined ? {} : { material }), solid: context.bodies[body].solid };
    });
    const about: MeshAbout = { bodies: chosen, triangles: objects.reduce((sum, object) => sum + object.solid.triangles.length / 3, 0) };
    return { layout: 'file', files: [{ path: 'model.3mf', mediaType: 'model/3mf', bytes: threeMfPackage(objects, context.deflater), about }], ...(empty === undefined ? {} : { empty }) };
  },
};
