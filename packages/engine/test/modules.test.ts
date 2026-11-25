// The modules of the engine import one way (docs/architecture.md, "Struktura repozitáře"). A cycle
// between them can load in one import order and break in another: a module that reads a binding of
// the other at its top level gets it before it is set. The tests of the engine all start from
// document.ts or engine.ts, so they would not see it.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [join(dir, entry.name)] : []));
const MODULES = files(SRC).sort();
const name = (file: string): string => relative(SRC, file);

// The specifiers a module imports at run time, read with the TypeScript parser. Only a statement
// that is type-only as a whole (`import type`, `export type … from`) is erased. The project compiles
// with verbatimModuleSyntax, so a statement whose names are each marked `type` stays as an import of
// the module without names, and still loads it.
function runtimeSpecifiers(text: string): string[] {
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [target] = node.arguments;
      found.push(target && ts.isStringLiteralLike(target) ? target.text : './<not a literal>');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// The modules of the engine a file imports at run time. A relative specifier that names no module
// is an error, not an edge left out.
function runtimeImports(file: string, modules: readonly string[], read: (file: string) => string): string[] {
  return runtimeSpecifiers(read(file))
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => {
      const base = resolve(dirname(file), specifier);
      const hit = [base, `${base}.ts`, join(base, 'index.ts')].find((candidate) => modules.includes(candidate));
      if (!hit) throw new Error(`${file}: the import '${specifier}' names no module of the engine`);
      return hit;
    });
}

function cycles(modules: readonly string[], read: (file: string) => string): string[] {
  const graph = new Map(modules.map((file) => [file, runtimeImports(file, modules, read)]));
  const state = new Map<string, 'open' | 'done'>();
  const found: string[] = [];
  const visit = (file: string, path: string[]): void => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'open') {
      found.push([...path.slice(path.indexOf(file)), file].map((step) => relative(dirname(modules[0]), step)).join(' → '));
      return;
    }
    state.set(file, 'open');
    for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
    state.set(file, 'done');
  };
  for (const file of modules) visit(file, []);
  return found;
}

describe('modules of the engine', () => {
  it('found the modules', () => {
    expect(MODULES.map(name)).toContain('document.ts');
    expect(runtimeImports(join(SRC, 'engine.ts'), MODULES, (file) => readFileSync(file, 'utf8')).map(name)).toContain('document.ts');
  });

  it('import one way: no cycle among the imports that exist at run time', () => {
    expect(cycles(MODULES, (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  // The geometry of a spline (D70) is a leaf: at run time it imports util.ts alone, so the validator,
  // the profile and the worlds of the sketch tools can all read it.
  it('spline.ts is a leaf: it imports util.ts alone at run time', () => {
    expect(runtimeImports(join(SRC, 'spline.ts'), MODULES, (file) => readFileSync(file, 'utf8')).map(name)).toEqual(['util.ts']);
  });

  // The intersection as computed is a mesh nobody verified (D50): it is measured by the collisions
  // and never becomes a body, the input of another boolean or a file. One module calls it.
  it('the intersection as computed is asked in interference.ts alone', () => {
    const callers = MODULES.filter((file) => /\.intersectionAsComputed\s*\(/.test(readFileSync(file, 'utf8'))).map(name);
    expect(callers).toEqual(['interference.ts']);
  });

  // The guard itself: every form of import that loads a module is an edge, and only a statement
  // that is type-only as a whole is not.
  describe('the reader of imports', () => {
    const pair = (a: string, b = "export const b = 1;\nimport './a';"): string[] => {
      const texts: Record<string, string> = { '/m/a.ts': a, '/m/b.ts': b };
      return cycles(Object.keys(texts), (file) => texts[file]);
    };
    it.each([
      ['a named import', "import { b } from './b';"],
      ['double quotes', 'import { b } from "./b";'],
      ['a side-effect import', "import './b';"],
      ['names that are each marked type', "import { type B } from './b';"],
      ['a default import', "import b from './b';"],
      ['a namespace import', "import * as b from './b';"],
      ['a re-export', "export { b } from './b';"],
      ['a re-export of everything', "export * from './b';"],
      ['a re-export of names that are each marked type', "export { type B } from './b';"],
      ['a dynamic import', "export const load = () => import('./b');"],
      ['a specifier with its extension', "import { b } from './b.ts';"],
    ])('%s is an edge', (_what, text) => {
      expect(pair(text)).toEqual(['a.ts → b.ts → a.ts']);
    });
    it.each([
      ['import type', "import type { B } from './b';"],
      ['export type', "export type { B } from './b';"],
      ['a package', "import { b } from 'b';"],
    ])('%s is not an edge', (_what, text) => {
      expect(pair(text)).toEqual([]);
    });
    it('a relative import that names no module fails', () => {
      expect(() => pair("import { c } from './c';")).toThrow(/names no module/);
    });
  });

  it.each(MODULES.map((file) => [name(file), file]))('%s loads as the first module', async (_name, file) => {
    vi.resetModules();
    await expect(import(/* @vite-ignore */ file)).resolves.toBeDefined();
  });
});
