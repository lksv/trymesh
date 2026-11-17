// The catalog of import formats and the import of a mesh (D55). A format is a module in this
// directory and one line of the catalog; what follows the reading is shared: the weld, the walls
// between stacked solids, the shells turned over, the checks of a stored mesh and the report.
// `importMesh` is a function without a state: it needs no document, and the mesh enters one by the
// command addMesh.
import { emptyDocument } from '../document';
import { type IndexedMesh, type JudgedShell, type MeshDefects, MESH_LIMITS, MeshLimit, judgeShells, meshBounds, meshDefects, meshPieces, meshProblem, meshVolume, storedMesh, turned, weld, withoutWalls } from '../mesh';
import { checkArgs } from '../query/check';
import type { ArgPath, Evaluation, StoredMesh, Vec3 } from '../types';
import { TEXT_LIMIT } from '../sections/body-properties';
import { has } from '../util';
import { type AnyImportFormat, type ImportCatalog, type ImportFormat, ImportFailure, type ImportOptions } from './spec';
import { stl } from './stl';

export const IMPORT_FORMATS: ImportCatalog = { stl };
// The most rounds of turning shells over, one level of nesting each (a part inside out in the hollow
// of a solid inside out takes two).
const TURN_ROUNDS = 4;

// What an import says about the mesh it read.
export interface MeshReport {
  format: ImportFormat;
  about: Record<string, unknown>; // what the format said about the file
  facets: number; // triangles in the file
  dropped: number; // triangles left out: two of their corners are at one position
  walls: number; // pairs of triangles left out: the wall between two solids stacked in the file
  vertices: number;
  triangles: number;
  shells: number; // connected pieces of the surface
  cavities: number; // of them, hollows: pieces that face inwards inside another piece
  insideOut: boolean; // the whole mesh was inside out and was turned over first
  turned: number; // distinct shells turned over by groups after that
  nested: number; // outward shells in the material of others (a hollow written outwards, or an overlap); read
  volume: number; // mm³; an overlap of two shells counts twice
  bounds: { min: Vec3; max: Vec3 }; // mm, in the frame of the file
  notes: string[]; // in words, for the caller to read
}

// - `invalidArguments`: no such format, or an option of the wrong shape (`arg` names it).
// - `unreadable`: the bytes are not a file of the format.
// - `notASolid`: the triangles do not close a solid; `defects` has the counts when the edges are the reason.
// - `tooLarge`: more triangles than an import reads (decided from the count of the file, before the
//   weld), or more work than the bound of the check of the shells.
export type ImportOutcome =
  | { ok: true; mesh: StoredMesh; report: MeshReport }
  | { ok: false; error: { code: 'invalidArguments' | 'unreadable' | 'notASolid' | 'tooLarge'; message: string; arg?: ArgPath; defects?: MeshDefects } };

// The options of an import name nothing of a model, so they are checked against an empty one.
const NO_STATE = { document: emptyDocument(), evaluation: { features: {}, bodies: {}, faceNames: [] } as unknown as Evaluation };

// The format of a file by the extension of its name, lower case; undefined when no format has it.
export function importFormatOf(path: string, formats: Record<string, AnyImportFormat> = IMPORT_FORMATS): ImportFormat | undefined {
  const dot = path.lastIndexOf('.');
  const extension = dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
  return Object.keys(formats).find((format) => formats[format].extensions.includes(extension)) as ImportFormat | undefined;
}

// The parts of a path the import names things by (D55), shared by the tool import_mesh and the app.
// The name of the file: the last part of the path (either slash).
export const fileNameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
// The name of the file without its extension.
export const fileStemOf = (path: string): string => fileNameOf(path).replace(/\.[^.]*$/, '');
// The name a stored mesh gets from its file: the name of the file trimmed and cut to the length of
// a name; none when nothing is left.
export function meshNameOf(path: string): string | undefined {
  const name = fileNameOf(path).trim().slice(0, TEXT_LIMIT).trim();
  return name === '' ? undefined : name;
}
// An ID from the name of a file: its stem reduced to letters, digits and underscores; `fallback` when
// that is no ID (empty, `origin`, or a property every object has); with `_2`, `_3`, … while `taken`
// says it is taken.
export function idFromFile(path: string, taken: (id: string) => boolean, fallback = 'mesh'): string {
  const stem = fileStemOf(path).replace(/[^A-Za-z0-9_]/g, '_');
  const base = stem === '' || stem === 'origin' || stem in Object.prototype ? fallback : stem;
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
// What a file input accepts: the extensions of the formats.
export const importAccept = (formats: Record<string, AnyImportFormat> = IMPORT_FORMATS): string =>
  Object.values(formats)
    .flatMap((spec) => spec.extensions.map((extension) => `.${extension}`))
    .join(',');

// Reads a file into a stored mesh.
// 1. The options are checked against the description of the format and the format reads the bytes.
// 2. The weld: corners at the same float32 position (−0 taken as 0) become one vertex; triangles
//    that lose a corner by it are left out and counted. No tolerance.
// 3. A negative volume turns the whole mesh over (the pairs of the walls cancel in it), then the
//    walls between stacked solids are left out.
// 4. When the mesh is closed: the shells are judged; every shell that is inside out and has no
//    container that is inside out too (an outermost one, or a part inside out in the hollow of a
//    solid) is turned over together with the shells it contains; then the shells are judged again,
//    and again turned so, at most `TURN_ROUNDS` times; the report and the checks take the last
//    judgement.
// 5. The checks of a stored mesh with the limit of an import; their code and message are the refusal.
// 6. The report, and the mesh in its stored form with `name`.
// The same bytes and options give the same mesh.
export function importMesh<F extends ImportFormat>(format: F, bytes: Uint8Array, options?: ImportOptions<F>, name?: string, formats: Record<string, AnyImportFormat> = IMPORT_FORMATS): ImportOutcome {
  type Code = Extract<ImportOutcome, { ok: false }>['error']['code'];
  const refused = (code: Code, message: string, more: { arg?: ArgPath; defects?: MeshDefects } = {}): ImportOutcome => ({ ok: false, error: { code, message, ...more } });
  if (typeof format !== 'string' || !has(formats, format)) return refused('invalidArguments', `there is no import format ${typeof format === 'string' ? `"${format}"` : 'of that name (a text is expected)'}; the formats are ${Object.keys(formats).join(', ')}`, { arg: ['format'] });
  const spec = formats[format];
  const checked = checkArgs(spec.options, options, NO_STATE);
  if (!checked.ok) return refused('invalidArguments', `${format}: ${checked.message}`, { arg: checked.arg });
  if (!(bytes instanceof Uint8Array)) return refused('invalidArguments', 'the bytes of the file are expected', { arg: ['bytes'] });
  let read: ReturnType<AnyImportFormat['read']>;
  try {
    read = spec.read(bytes, checked.value as never);
  } catch (error) {
    if (error instanceof ImportFailure) return refused(error.code, `${format}: ${error.message}`);
    throw error;
  }
  const facets = read.corners.length / 9;
  const welded = weld(read.corners);
  let mesh: IndexedMesh = welded.mesh;
  const insideOut = meshVolume(mesh) < 0;
  if (insideOut) mesh = turned(mesh);
  const unwalled = withoutWalls(mesh);
  mesh = unwalled.mesh;
  let shells: JudgedShell[] | undefined;
  let turnedShells = 0;
  const defects = meshDefects(mesh);
  if (mesh.triangles.length > 0 && defects.open + defects.overused + defects.misoriented === 0) {
    try {
      let judged = judgeShells(mesh);
      const lists = judged.map((shell) => shell.list);
      const odd = new Set<number>(); // the shells turned an odd number of times
      for (let round = 0; round < TURN_ROUNDS; round++) {
        // a shell inside out none of whose containers is inside out is turned over with every
        // shell it contains (its hollows were inverted with it)
        const roots = new Set(judged.flatMap((shell, s) => (shell.kind === 'insideOut' && !shell.containers.some((c) => judged[c].kind === 'insideOut') ? [s] : [])));
        if (roots.size === 0) break;
        const flip = judged.flatMap((shell, s) => (roots.has(s) || shell.containers.some((c) => roots.has(c)) ? [s] : []));
        mesh = turned(
          mesh,
          flip.flatMap((s) => lists[s]),
        );
        for (const s of flip) if (!odd.delete(s)) odd.add(s);
        judged = judgeShells(mesh, lists);
      }
      turnedShells = odd.size;
      shells = judged;
    } catch (error) {
      if (error instanceof MeshLimit) return refused('tooLarge', `${format}: ${error.message}`);
      throw error;
    }
  }
  const problem = meshProblem(mesh, MESH_LIMITS.triangles, shells);
  if (problem) return refused(problem.code, `${format}: ${problem.message}`, problem.defects ? { defects: problem.defects } : {});
  const judged = shells ?? judgeShells(mesh, meshPieces(mesh));
  const volume = meshVolume(mesh);
  const bounds = meshBounds(mesh);
  const triangles = mesh.triangles.length / 3;
  const cavities = judged.filter((shell) => shell.kind === 'hollow').length;
  const nested = judged.filter((shell) => shell.kind === 'nested').length;
  const size = Math.max(...bounds.max.map((high, axis) => high - bounds.min[axis]));
  const notes = [
    welded.dropped ? `${welded.dropped} ${welded.dropped === 1 ? 'triangle was' : 'triangles were'} left out: two of its corners are at one position` : '',
    insideOut ? 'the file was written inside out (its volume was negative) and was turned over as a whole' : '',
    turnedShells ? `${turnedShells} ${turnedShells === 1 ? 'shell was' : 'shells were'} inside out and turned over` : '',
    judged.length > 1 ? `${judged.length} shells: shells that overlap are counted twice in the volume and in a collision with them, and an overlap is found only at one point of each shell` : '',
    nested ? `${nested} ${nested === 1 ? 'shell lies' : 'shells lie'} in the material of other shells (a hollow written facing outwards, or a part inside a part): read as material` : '',
    triangles > MESH_LIMITS.note ? `${triangles} triangles, more than ${MESH_LIMITS.note}: a real collision with this body takes seconds, and longer the deeper it is` : '',
    size < 1 || size > 10_000 ? `the largest side of the bounds is ${Number(size.toPrecision(4))} mm: is the unit of the file right (the option unit)?` : '',
  ].filter((note) => note !== '');
  return {
    ok: true,
    mesh: storedMesh(mesh, name),
    report: {
      format,
      about: read.about,
      facets,
      dropped: welded.dropped,
      walls: unwalled.walls,
      vertices: mesh.positions.length / 3,
      triangles,
      shells: judged.length,
      cavities,
      insideOut,
      turned: turnedShells,
      nested,
      volume,
      bounds,
      notes,
    },
  };
}
