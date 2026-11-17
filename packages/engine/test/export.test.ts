// The catalog of export formats (D37): the form of the paths an export guarantees to a writer, and
// what `runExport` does around the entry of a format.
import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/document';
import { EXPORT_FORMATS, exportPathProblem, runExport } from '../src/export/index';
import type { AnyExportFormat } from '../src/export/spec';
import { Memo } from '../src/query/context';
import { QueryFailure } from '../src/query/spec';
import type { State } from '../src/recompute/state';
import type { Evaluation, Exported, SolidKernel } from '../src/types';

const paths = (...names: string[]) => exportPathProblem(names.map((path) => ({ path })));
const file = (path: string) => ({ path, mediaType: 'text/plain', bytes: new Uint8Array([1]) });

// A state with nothing in it: the formats below do not read it.
const evaluation = { features: {}, bodies: {}, faceNames: [], faceSurfaces: [] } as unknown as Evaluation;
const run = (format: string, options: unknown, formats: Record<string, AnyExportFormat>) => runExport(format, options, evaluation, { document: emptyDocument(), state: {} as State }, { kernel: {} as SolidKernel, memo: new Memo() }, formats);
const format = (result: () => Exported, options: AnyExportFormat['options'] = {}): AnyExportFormat => ({ title: 'T', summary: 'S', options, run: result });

describe('export formats', () => {
  it('the paths of an export: relative, with forward slashes, unique, no file that is also a folder', () => {
    expect(paths('model.stl')).toBeUndefined();
    expect(paths('robot.urdf', 'meshes/base.stl', 'meshes/arm.stl', 'meshes/visual/arm.stl')).toBeUndefined();
    expect(paths()).toBeUndefined();
    expect(paths('/abs.stl')).toBe('"/abs.stl" is not a relative path with forward slashes');
    expect(paths('a//b.stl')).toMatch(/not a relative path/);
    expect(paths('a/')).toMatch(/not a relative path/);
    expect(paths('')).toMatch(/not a relative path/);
    expect(paths('../out.stl')).toMatch(/not a relative path/);
    expect(paths('a/./b.stl')).toMatch(/not a relative path/);
    expect(paths('a\\b.stl')).toMatch(/not a relative path/);
    expect(paths('a.stl', 'b.stl', 'a.stl')).toBe('"a.stl" is in the export twice');
    expect(paths('meshes', 'meshes/base.stl')).toBe('"meshes" is both a file and a folder');
    expect(paths('a/b/c.stl', 'a/b')).toBe('"a/b" is both a file and a folder');
    expect(paths('a.stl', 'A.stl')).toBeUndefined(); // the case of letters depends on the disk: the writer's to refuse
  });

  it('the catalog has STL, 3MF, the outline as DXF and SVG and the parts list as CSV, described', () => {
    expect(Object.keys(EXPORT_FORMATS)).toEqual(['stl', '3mf', 'dxf', 'svg', 'partsCsv']);
    expect(Object.keys(EXPORT_FORMATS.stl.options)).toEqual(['bodies', 'perBody']);
  });

  it('runExport checks the format and the options, and turns a failure of the format into an answer', () => {
    const one = format(() => ({ layout: 'file', files: [file('out.txt')] }), { size: { kind: 'number', title: 'Size', spec: { title: 'Size', unit: 'mm', default: 2 }, optional: true } });
    const seen: unknown[] = [];
    const formats = { one: { ...one, run: (_context: unknown, options: never) => (seen.push(options), one.run(_context as never, options)) }, failing: format(() => { throw new QueryFailure('failed', 'the body is not closed'); }) };
    expect(run('one', {}, formats)).toEqual({ ok: true, result: { layout: 'file', files: [file('out.txt')] } });
    expect(run('one', undefined, formats)).toMatchObject({ ok: true });
    expect(run('one', { size: 3 }, formats)).toMatchObject({ ok: true });
    expect(seen).toEqual([{ size: 2 }, { size: 2 }, { size: 3 }]); // the defaults are filled in before the format runs
    expect(run('one', { sizes: 3 }, formats)).toEqual({ ok: false, error: { code: 'invalidArguments', message: 'one: sizes: there is no such argument', arg: ['sizes'] } });
    expect(run('one', { size: '3' }, formats)).toEqual({ ok: false, error: { code: 'invalidArguments', message: 'one: size: a number is expected', arg: ['size'] } });
    expect(run('two', {}, formats)).toEqual({ ok: false, error: { code: 'invalidArguments', message: 'there is no export format "two"; the formats are one, failing', arg: ['format'] } });
    expect(run('constructor', {}, formats)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['format'] } });
    expect(run(7 as never, {}, formats)).toMatchObject({ ok: false, error: { code: 'invalidArguments', arg: ['format'] } });
    expect(run('failing', {}, formats)).toEqual({ ok: false, error: { code: 'failed', message: 'failing: the body is not closed' } });
  });

  it('a format that breaks the form of its result is a defect, not an answer', () => {
    expect(() => run('f', {}, { f: format(() => ({ layout: 'directory', files: [file('../out.txt')] })) })).toThrow('export f: "../out.txt" is not a relative path with forward slashes');
    expect(() => run('f', {}, { f: format(() => ({ layout: 'file', files: [file('a.txt'), file('b.txt')] })) })).toThrow('export f: the layout `file` is one file, not 2');
    expect(() => run('f', {}, { f: format(() => ({ layout: 'file', files: [] })) })).toThrow('export f: the layout `file` is one file, not 0');
    expect(() => run('f', {}, { f: format(() => { throw new Error('a bug'); }) })).toThrow('a bug'); // not swallowed
    expect(run('f', {}, { f: format(() => ({ layout: 'directory', files: [] })) })).toEqual({ ok: true, result: { layout: 'directory', files: [] } });
  });
});
