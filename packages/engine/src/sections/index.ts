// The registry of sections of the document (D48). A section is a field of `Document` that is not
// one of the fields every document had before it (the settings, the parameters, the checks, the
// timeline); the registry is typed by those fields, so a section added to `Document` without an
// entry here does not compile, and neither does one whose result `Evaluation` lacks. Building an
// empty document, loading one, a command of a section, renaming a parameter, comparing two
// documents for undo and the recompute all ask the registry; a second section (the mechanism of
// 5a) is one entry.
import type { Environment } from '../expression';
import type { State } from '../recompute/state';
import type { BodyResult, Command, Document, Evaluation, Id } from '../types';
import { has } from '../util';
import { type Dict, isObject } from '../validation';
import { bodyProperties } from './body-properties';
import { documents } from './documents';
import { mechanism } from './mechanism';
import { meshes } from './meshes';
import type { SectionContext, SectionInfo, SectionSpec } from './spec';

export type SectionName = Exclude<keyof Document, 'schemaVersion' | 'schemaSteps' | 'settings' | 'parameters' | 'checks' | 'features'>;
export type Sections = Pick<Document, SectionName>;
export type SectionResults = Pick<Evaluation, SectionName>;

export const DOCUMENT_SECTIONS: { [K in SectionName]: SectionSpec<Document[K], Evaluation[K]> } = { bodyProperties, mechanism, meshes, documents };

const NAMES = Object.keys(DOCUMENT_SECTIONS) as SectionName[];
// An entry as code that handles any section reads it.
const specOf = (name: SectionName): SectionSpec<unknown, unknown> => DOCUMENT_SECTIONS[name] as SectionSpec<unknown, unknown>;

// The public part of the registry: what the description for the AI and the forms read.
export const SECTION_INFO: { [K in SectionName]: SectionInfo } = Object.fromEntries(NAMES.map((name) => [name, DOCUMENT_SECTIONS[name].info])) as { [K in SectionName]: SectionInfo };

export const emptySections = (): Sections => Object.fromEntries(NAMES.map((name) => [name, specOf(name).empty()])) as Sections;

// The sections of a document being loaded (after the upgrade steps, which give an older document
// every section). `what`: the path of the document in the messages (`document` for the host).
export const validateSections = (o: Dict, what: string, context: SectionContext): Sections => Object.fromEntries(NAMES.map((name) => [name, specOf(name).validate(o[name], `${what}.${name}`, context)])) as Sections;

// A command no case of `applyCommand` has: the document after the command of a section, or
// undefined when no section has a command of that type.
export function applySectionCommand(doc: Document, cmd: Dict, context: SectionContext): Document | undefined {
  for (const name of NAMES) {
    const commands = specOf(name).commands as Record<string, (doc: Document, command: Dict, context: SectionContext) => unknown>;
    if (typeof cmd.type !== 'string' || !has(commands, cmd.type)) continue;
    const section = commands[cmd.type](doc, cmd, context);
    return section === doc[name] ? doc : ({ ...doc, [name]: section } as Document);
  }
  return undefined;
}

// Every section with the parameter `from` renamed to `to` in its expressions.
export const renamedSections = (doc: Document, from: string, to: string): Sections => Object.fromEntries(NAMES.map((name) => [name, specOf(name).renameParameter(doc[name], from, to)])) as Sections;

// Do two documents differ in a section? (An undo step is made only by a change of content.)
export const sectionsDiffer = (a: Document, b: Document): boolean => NAMES.some((name) => a[name] !== b[name] && JSON.stringify(a[name]) !== JSON.stringify(b[name]));

// After the timeline: the result of every section, and the sections whose numbers the recompute
// wrote back. `kept` holds the last few results of every key of a section (a preview or a state
// after a feature in between does not push out the result of the document): a new result equal to
// one of them is replaced by it, so that a result is the same object as long as what it is computed
// from is the same.
// The memory of a key whose entry is gone (a body removed, a link or a joint removed) is not dropped:
// a state after a feature (`at`) or a preview that lacks the entry would otherwise push out the
// results of the document. It grows with the IDs an engine has seen, each with at most
// RESULTS_KEPT small results, and goes with the engine.
export type KeptResults = Map<SectionName, Map<string, Map<string, unknown>>>;
const RESULTS_KEPT = 4; // per key of a section, most recently used last
export function evaluateSections(doc: Document, bodies: Readonly<Record<Id, BodyResult>>, environment: Environment, state: State, kept: KeptResults): { results: SectionResults; written?: Partial<Sections> } {
  const results: Record<string, unknown> = {};
  let written: Partial<Sections> | undefined;
  for (const name of NAMES) {
    const evaluated = specOf(name).evaluate(doc[name], doc, bodies, environment, state);
    let memory = kept.get(name);
    if (!memory) kept.set(name, (memory = new Map()));
    const result = evaluated.result as Record<string, unknown>;
    const stableOf = (key: string, value: unknown): unknown => {
      const text = JSON.stringify(value);
      let known = (memory as Map<string, Map<string, unknown>>).get(key);
      if (!known) (memory as Map<string, Map<string, unknown>>).set(key, (known = new Map()));
      const found = known.get(text) ?? value;
      known.delete(text);
      known.set(text, found);
      if (known.size > RESULTS_KEPT) known.delete(known.keys().next().value as string);
      return found;
    };
    const nested = specOf(name).entries ?? [];
    const stable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      const entries = nested.includes(key) && isObject(value) ? Object.fromEntries(Object.entries(value).map(([inner, item]) => [inner, stableOf(`${key}\u0000${inner}`, item)])) : value;
      stable[key] = stableOf(key, entries);
    }
    results[name] = stable;
    if (evaluated.written !== undefined) (written ??= {})[name] = evaluated.written as never;
  }
  return { results: results as unknown as SectionResults, ...(written ? { written } : {}) };
}

// ---------------------------------------------------------------- IDs a section names

// Every ID of a feature or of a sketch entity a section of the document names, and for a derived ID
// also the one it is derived from (the feature of the body `screws/2`), which is the one a caller
// chooses. A feature or an entity added under such an ID takes the reference over: wanted when the
// thing is made again, a trap when the ID is reused for something else. The generators of IDs
// (`freshIds`, `newId` of the app) count these as used.
export function namedBySections(doc: Document): Id[] {
  return [...new Set(NAMES.flatMap((name) => specOf(name).names(doc[name])))];
}

// The IDs of the features and sketch entities (points, curves, projections) the command adds, at any
// depth of a batch and inside a sketch added whole, that a section of `before` names. It reads the
// document and the command, not the model, so a feature removed and added again inside one batch is
// found, and a body made and given properties in one batch is not reported.
export function takenOver(before: Document, command: Command): Id[] {
  const named = new Set(namedBySections(before));
  const added: Id[] = [];
  const visit = (cmd: unknown): void => {
    if (!isObject(cmd)) return;
    if (cmd.type === 'batch' && Array.isArray(cmd.commands)) return cmd.commands.forEach(visit);
    if (cmd.type === 'addFeature' && isObject(cmd.feature)) {
      const f = cmd.feature;
      if (typeof f.id === 'string') added.push(f.id);
      if (f.type === 'sketch') for (const group of [f.points, f.curves, f.external]) if (isObject(group)) added.push(...Object.keys(group));
    }
    if ((cmd.type === 'addPoint' || cmd.type === 'addCurve' || cmd.type === 'addExternal') && typeof cmd.id === 'string') added.push(cmd.id);
  };
  visit(command);
  return [...new Set(added.filter((id) => named.has(id)))];
}
