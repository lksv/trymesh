// The catalog of export formats: a format is a module in this directory and one line here.
// `Engine.export` and the MCP tool `export` reach every entry.
import { checkArgs } from '../query/check';
import { type ContextDeps, type Internals, queryContext } from '../query/context';
import { QueryFailure } from '../query/spec';
import type { ArgPath, Evaluation, ExportFile, Exported, QueryOutcome } from '../types';
import { has } from '../util';
import type { AnyExportFormat, ExportCatalog } from './spec';
import { stl } from './stl';

export const EXPORT_FORMATS: ExportCatalog = { stl };

// The form of the paths of an export, which the engine guarantees to a writer: relative, with
// forward slashes, every segment non-empty and not `.` or `..`, no backslash, and no path that is
// also a folder of another. What depends on the disk (the length of a name, names that differ only
// in the case of letters) is the writer's to refuse. Returns the problem, if there is one.
export function exportPathProblem(files: readonly Pick<ExportFile, 'path'>[]): string | undefined {
  const paths = new Set<string>();
  for (const { path } of files) {
    const segments = path.split('/');
    if (path.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return `"${path}" is not a relative path with forward slashes`;
    if (paths.has(path)) return `"${path}" is in the export twice`;
    paths.add(path);
  }
  for (const path of paths) for (let slash = path.indexOf('/'); slash >= 0; slash = path.indexOf('/', slash + 1)) if (paths.has(path.slice(0, slash))) return `"${path.slice(0, slash)}" is both a file and a folder`;
  return undefined;
}

const refused = (code: 'invalidArguments' | 'notAvailable' | 'failed', message: string, arg?: ArgPath): QueryOutcome<never> => ({ ok: false, error: { code, message, ...(arg ? { arg } : {}) } });

// Exports one state in the format `format`: checks the options against the description of the
// format, fills in the defaults and runs it. Both come from callers that are not typed.
export function runExport(format: string, options: unknown, evaluation: Evaluation, internals: Internals, deps: ContextDeps, formats: Record<string, AnyExportFormat> = EXPORT_FORMATS): QueryOutcome<Exported> {
  if (typeof format !== 'string' || !has(formats, format)) return refused('invalidArguments', `there is no export format ${typeof format === 'string' ? `"${format}"` : 'of that name (a text is expected)'}; the formats are ${Object.keys(formats).join(', ')}`, ['format']);
  const spec = formats[format];
  const checked = checkArgs(spec.options, options, { document: internals.document, evaluation });
  if (!checked.ok) return refused(checked.code, `${format}: ${checked.message}`, checked.arg);
  let exported: Exported;
  try {
    // an export always gets the bodies as modelled, whatever the pose
    exported = spec.run(queryContext(`export:${format}`, evaluation, internals, deps, 'modelled'), checked.value as never);
  } catch (error) {
    if (error instanceof QueryFailure) return refused(error.code, `${format}: ${error.message}`, error.arg);
    throw error;
  }
  // a format that breaks the form of its paths is a defect of the format, not a mistake of the caller
  const problem = exportPathProblem(exported.files);
  if (problem) throw new Error(`export ${format}: ${problem}`);
  if (exported.layout === 'file' && exported.files.length !== 1) throw new Error(`export ${format}: the layout \`file\` is one file, not ${exported.files.length}`);
  return { ok: true, result: exported };
}
