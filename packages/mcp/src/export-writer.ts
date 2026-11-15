// Writes the files of an export to disk, for the tools of the server that export (`export_stl`,
// `export`). The engine may run in the app, so the files arrive as base64 and are written here.
//
// One file (`layout: 'file'`) is written to the caller's path and replaces what is there. A set
// (`layout: 'directory'`) goes into the folder the caller named, and its file names were not chosen
// by the caller one by one, so:
// - nothing is written unless every file can be: a name longer than the file system allows, two
//   names that differ only in the case of letters, a name taken by something that is not a file,
//   and a file that already exists without `overwrite` are found first;
// - the files are first written into a folder of this call inside the target and moved once all of
//   them are on disk, so a failure while writing leaves the target as it was instead of a part of
//   the set;
// - a folder this call had to create is taken away again when the export fails.
// A set knows only files directly in the target folder: a path with a folder is refused before
// this is called.
import { lstat, mkdir, mkdtemp, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// A failure the caller of a tool can do something about; its message is the answer of the tool.
export class Failure extends Error {}

export interface OutFile {
  name: string; // the name of the file in the target folder; not used for one file
  subject: string; // what a message calls the file: the body it holds, or its name
  base64: string;
  about: Record<string, unknown>; // what the answer says about the file next to its path and its size
}
// The two messages that speak of what the files hold.
export interface Wording {
  tooLong(subjects: string[], limit: number): string;
  sameName(first: string, second: string): string;
}
export type Written = { path: string; bytes: number } & Record<string, unknown>;

const MAX_FILE_NAME = 255; // bytes: the limit of a file name on the common file systems
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function writeExport(target: string, layout: 'file' | 'directory', given: OutFile[], overwrite: boolean, wording: Wording): Promise<{ files: Written[]; note?: string }> {
  const perFile = layout === 'directory';
  const files = given.map((file) => ({ ...file, path: perFile ? join(target, file.name) : target }));
  const existing: string[] = []; // files of the set that are on disk already
  if (perFile) {
    // a file name is limited to 255 bytes on the common file systems; found before anything is written
    const long = files.filter((file) => Buffer.byteLength(file.name) > MAX_FILE_NAME);
    if (long.length) throw new Failure(wording.tooLong(long.map((file) => file.subject), MAX_FILE_NAME));
    // File names were not named by the caller one by one: nothing is written unless every file
    // can be written without replacing or shadowing another.
    const seen = new Map<string, string>();
    for (const file of files) {
      const folded = file.path.toLowerCase();
      const other = seen.get(folded);
      if (other !== undefined) throw new Failure(wording.sameName(other, file.subject));
      seen.set(folded, file.subject);
    }
    for (const file of files) {
      const found = await lstat(file.path).catch(() => undefined);
      // something that is not a file (a directory of that name) cannot be replaced by one
      if (found && !found.isFile()) throw new Failure(`nothing was written, ${file.path} exists and is not a file`);
      if (found) existing.push(file.path);
    }
    if (existing.length && !overwrite) throw new Failure(`nothing was written, these files already exist: ${existing.join(', ')} (choose another directory or pass overwrite: true)`);
  }
  const directory = perFile ? target : dirname(target);
  // the first directory this call had to create, if any: taken away again when the export fails
  const created = await mkdir(directory, { recursive: true }).catch((error) => {
    throw new Failure(`nothing was written, the directory ${directory} cannot be created: ${reason(error)}`);
  });
  const tidy = async (): Promise<void> => {
    if (created === undefined) return;
    // only directories that are still empty, from the target up to the first one created
    for (let at = directory; at.length >= created.length; at = dirname(at)) {
      if (!(await rmdir(at).then(() => true, () => false)) || at === created) break;
    }
  };
  const written: Written[] = [];
  if (!perFile) {
    try {
      for (const file of files) {
        const bytes = Buffer.from(file.base64, 'base64');
        await writeFile(file.path, bytes);
        written.push({ path: file.path, ...file.about, bytes: bytes.length });
      }
    } catch (error) {
      await tidy();
      throw new Failure(`the export failed: ${reason(error)}`);
    }
    return { files: written };
  }
  // The files are first written into a directory of this call inside the target, under their
  // final names, and moved once all of them are on disk. A failure while writing (a full disk,
  // a name or a path the file system refuses) leaves the target as it was instead of a part of the
  // set. The directory is new for every call (mkdtemp), so two exports, or a file of the user,
  // cannot get in each other's way.
  let staging: string | undefined;
  const moved: string[] = [];
  let failure: string | undefined;
  let nothingLeft = false;
  try {
    staging = await mkdtemp(join(target, '.trymesh-export-'));
    for (const file of files) {
      const bytes = Buffer.from(file.base64, 'base64');
      await writeFile(join(staging, file.name), bytes);
      written.push({ path: file.path, ...file.about, bytes: bytes.length });
    }
    for (const file of files) {
      await rename(join(staging, file.name), file.path);
      moved.push(file.path);
    }
  } catch (error) {
    // A move that fails after others succeeded: the new files that replaced nothing are removed
    // again; a file that replaced an old one cannot be brought back and is named.
    const added = moved.filter((file) => !existing.includes(file));
    const replaced = moved.filter((file) => existing.includes(file));
    const kept = (await Promise.all(added.map((file) => rm(file, { force: true }).then(() => undefined, () => file)))).filter((file) => file !== undefined);
    const left = [
      replaced.length ? `these files had already been replaced by new ones: ${replaced.join(', ')}` : '',
      kept.length ? `these new files could not be removed again: ${kept.join(', ')}` : '',
    ].filter((text) => text !== '');
    nothingLeft = left.length === 0;
    failure = `the export failed: ${reason(error)}. ${nothingLeft ? 'Nothing of it was left in the directory' : `The set is not complete; ${left.join('; ')}`}`;
  }
  // the directory of the call goes in every case; one that cannot be removed is said, not hidden
  const stale = staging === undefined ? undefined : await rm(staging, { recursive: true, force: true }).then(() => undefined, () => staging);
  const leftover = stale === undefined ? '' : `the temporary directory ${stale} could not be removed`;
  if (failure !== undefined) {
    if (nothingLeft && stale === undefined) await tidy();
    throw new Failure(leftover ? `${failure}; ${leftover}` : failure);
  }
  return { files: written, ...(leftover ? { note: leftover } : {}) };
}
