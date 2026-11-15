// The format `stl`: bodies as binary STL, in one file or in a file per body.
import { bodyFileName } from '../interference';
import type { ArgSpecs } from '../query/args';
import { toStl } from '../solid';
import type { ExportFile, Id } from '../types';
import type { ExportFormatSpec } from './spec';

export const STL_OPTIONS = {
  bodies: { kind: 'list', of: { kind: 'body' }, title: 'Bodies', summary: 'The bodies to export, each once, in this order; without it all bodies.', optional: true },
  perBody: { kind: 'flag', title: 'A file per body', summary: 'A folder with one file per body, named by the body ID, instead of one file with all of them.', optional: true },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface ExportFormats {
    stl: typeof STL_OPTIONS;
  }
}

export const stl: ExportFormatSpec<typeof STL_OPTIONS> = {
  title: 'STL',
  summary: 'Bodies as triangle meshes in binary STL, for a slicer. One file with the chosen bodies, or with `perBody` a folder with a file per body (one printable part per file).',
  options: STL_OPTIONS,
  run: (context, { bodies, perBody }) => {
    const chosen: Id[] = bodies === undefined ? Object.keys(context.bodies) : [...new Set(bodies)];
    const file = (path: string, ids: Id[]): ExportFile => ({
      path,
      mediaType: 'model/stl',
      bytes: toStl(ids.map((id) => context.bodies[id].solid)),
      about: { bodies: ids, triangles: ids.reduce((sum, id) => sum + context.bodies[id].solid.triangles.length / 3, 0) },
    });
    const empty = chosen.length === 0 ? { empty: 'the model has no body to export' } : {};
    return perBody ? { layout: 'directory', files: chosen.map((id) => file(`${bodyFileName(id)}.stl`, [id])), ...empty } : { layout: 'file', files: [file('model.stl', chosen)], ...empty };
  },
};
