// The modules of the engine import one way (docs/architecture.md, "Modules of the engine"). A cycle
// between them can load in one import order and break in another: a module that reads a binding of
// the other at its top level gets it before it is set. The tests of the engine all start from
// document.ts or engine.ts, so they would not see it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : []));
const MODULES = files(SRC).sort();
const name = (file: string): string => relative(SRC, file);

// The modules a file imports at run time. `import type` and `export type` statements are erased, and
// so is a statement whose every name is marked `type` (the project compiles with verbatimModuleSyntax).
function valueImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(/^(import|export)\s+(type\s+)?([^;]*?)\s+from\s+'(\.[^']*)'/gm)) {
    const [, , wholeType, names, target] = match;
    if (wholeType) continue;
    const braces = /\{([^}]*)\}/s.exec(names);
    const onlyTypes = braces !== null && names.trim().startsWith('{') && braces[1].split(',').every((part) => part.trim() === '' || part.trim().startsWith('type '));
    if (onlyTypes) continue;
    const base = resolve(dirname(file), target);
    const hit = [`${base}.ts`, join(base, 'index.ts')].find((candidate) => MODULES.includes(candidate));
    if (hit) found.push(hit);
  }
  return found;
}

describe('modules of the engine', () => {
  it('found the modules', () => {
    expect(MODULES.map(name)).toContain('document.ts');
    expect(valueImports(join(SRC, 'engine.ts')).map(name)).toContain('document.ts');
  });

  it('import one way: no cycle among the imports that exist at run time', () => {
    const graph = new Map(MODULES.map((file) => [file, valueImports(file)]));
    const state = new Map<string, 'open' | 'done'>();
    const cycles: string[] = [];
    const visit = (file: string, path: string[]): void => {
      if (state.get(file) === 'done') return;
      if (state.get(file) === 'open') {
        cycles.push([...path.slice(path.indexOf(file)), file].map(name).join(' → '));
        return;
      }
      state.set(file, 'open');
      for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
      state.set(file, 'done');
    };
    for (const file of MODULES) visit(file, []);
    expect(cycles).toEqual([]);
  });

  it.each(MODULES.map((file) => [name(file), file]))('%s loads as the first module', async (_name, file) => {
    vi.resetModules();
    await expect(import(/* @vite-ignore */ file)).resolves.toBeDefined();
  });
});
