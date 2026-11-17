// The schema of the document as a list of named upgrade steps (D37). The version a build saves is
// the number of steps it has on `master`, plus one; `load` runs the steps a document has not had.
//
// When a step is needed. For a change of the shape of what older documents hold, and for anything
// a build without the step would drop without a word: `validateDocument` rebuilds a document from
// the fields it knows, so an unknown section, an unknown field directly on a feature and an
// unknown field of an extent are gone after a load. Such an addition gets a step even when the
// step has nothing to convert; a build that does not have it then refuses the document. No step is
// needed where a build without the addition refuses by itself: a new feature type, a new variant,
// a field where the validator lists the fields it allows.
//
// A step reads and changes only what its package owns, or what is on `master` already, so steps of
// different packages give the same document in either order.
//
// The list only grows at its end: the steps `master` has are never reordered or renamed, because
// the version of a document counts them by position. A branch that is merged puts its steps after
// everything `master` has by then.
//
// Branches. Two branches cannot both raise the version, so a branch appends its steps and counts
// them in `SCHEMA_PENDING`: the steps at the end of the list that `master` does not have yet.
// A build with pending steps saves the version of the `master` it started from and the names of
// its pending steps in `Document.schemaSteps`. The merge sets the count to zero; `master` never
// writes the field. So a document saved on a branch loads on that branch after a rebase over
// another merged step (the other step runs, its own does not run twice) and on `master` once the
// branch is merged; `master` before the merge and a build of another branch refuse it.
import { type Dict, fail, isObject } from './validation';

export interface UpgradeStep {
  name: string; // stable and unique; for a package its ID: `3a-body-properties`
  // Changes only the shape of the raw document and returns a new object; the validation after the
  // steps judges the content. The runner sets `schemaVersion` and `schemaSteps`.
  run(document: Dict): Dict;
}

// Version 1 → 2 (D35): an extrusion has a profile source, an extent and a list of targets; the
// document has parameters and checks.
const profilesAndParameters: UpgradeStep = {
  name: 'd35-profiles-and-parameters',
  run: (o) => {
    const extrude = (f: Dict): Dict => {
      const { sketch, regions: list, distance, target, ...rest } = f;
      return {
        ...rest,
        profile: { type: 'regions', sketch, regions: list },
        extent: { type: 'distance', start: 0, distance },
        ...(target === undefined ? {} : { targets: [target] }),
      };
    };
    const features = Array.isArray(o.features) ? o.features.map((f: unknown) => (isObject(f) && f.type === 'extrude' ? extrude(f) : f)) : o.features;
    // version 1 had no parameters and no checks; what is there anyway is kept for the validation to judge
    return { ...o, parameters: o.parameters ?? [], checks: o.checks ?? [], features };
  },
};

// Version 2 → 3 (D37): converts nothing. A build from before this list accepts version 2 and
// rebuilds the document from the fields it knows, so it would strip a document of a branch of
// `schemaSteps` and of everything its pending steps added, without a word. With this step every
// build that can write the field saves version 3 or more, which such a build refuses.
const schemaSteps: UpgradeStep = { name: 'd37-schema-steps', run: (o) => o };

// D45 (2b): the optional field `extent/taper`. It converts nothing; a build without the step would
// drop the field of the extent on load, so it has to refuse the document instead.
const taper: UpgradeStep = { name: '2b-taper', run: (o) => o };

// D48 (3a): the section `bodyProperties`. A build without the step would drop the section on load
// without a word, so it has to refuse the document instead. It gives a document that has no such
// field the empty section; a field that is there, whatever it holds (`null` included), is left for
// the validation to judge. (The step from version 1 is looser: it takes a `parameters` that is
// `null` for one that is missing.)
const bodyProperties: UpgradeStep = { name: '3a-body-properties', run: (o) => ('bodyProperties' in o ? o : { ...o, bodyProperties: {} }) };

// D49 (5a): the section `mechanism`. As for body properties: a build without the step would drop the
// section without a word. It gives a document without the field an empty mechanism and leaves
// a field that is there, whatever it holds, to the validation.
const mechanism: UpgradeStep = { name: '5a-mechanism', run: (o) => ('mechanism' in o ? o : { ...o, mechanism: { links: {}, joints: {} } }) };

// D55 (3b): the section `meshes`. As for body properties: a build without the step would drop the
// section without a word. It gives a document without the field the empty section and leaves a
// field that is there, whatever it holds, to the validation.
const meshes: UpgradeStep = { name: '3b-mesh-import', run: (o) => ('meshes' in o ? o : { ...o, meshes: {} }) };

// D60 (5c): the optional fields `midplaneWith` and `tilt` of the plane feature. It converts nothing;
// a build without the step would drop them on load without a word (the validator of the plane
// rebuilds it from the fields it knows), so it has to refuse the document instead. The kind `face`
// of an axis alone would need no step (a build that does not know a kind refuses it).
const morePlanes: UpgradeStep = { name: '5c-more-planes', run: (o) => o };

// D62 (3c): the section `documents`. As for the stored meshes: a build without the step would drop
// the section without a word. It gives a document without the field the empty section and leaves a
// field that is there, whatever it holds, to the validation. A stored document gets this and every
// other step when it is validated, from its own version, because it is validated as a document.
const documents: UpgradeStep = { name: '3c-document-insert', run: (o) => ('documents' in o ? o : { ...o, documents: {} }) };

export const UPGRADES: readonly UpgradeStep[] = [profilesAndParameters, schemaSteps, taper, bodyProperties, mechanism, meshes, morePlanes, documents];
// The number of steps at the end of `UPGRADES` that `master` does not have yet. Zero on `master`.
export const SCHEMA_PENDING = 1;

// The version a build with these steps saves, and the names it saves next to it.
export const savedVersion = (upgrades: readonly UpgradeStep[] = UPGRADES, pending: number = SCHEMA_PENDING): number => upgrades.length + 1 - pending;
export const SCHEMA_VERSION = savedVersion();
// The head of a document this build writes: `schemaSteps` only when it has pending steps.
export function schemaHeader(upgrades: readonly UpgradeStep[] = UPGRADES, pending: number = SCHEMA_PENDING): { schemaVersion: number; schemaSteps?: string[] } {
  return { schemaVersion: savedVersion(upgrades, pending), ...(pending > 0 ? { schemaSteps: upgrades.slice(upgrades.length - pending).map((step) => step.name) } : {}) };
}

// What a list of steps must obey; a test runs it over `UPGRADES`.
export function schemaProblems(upgrades: readonly UpgradeStep[] = UPGRADES, pending: number = SCHEMA_PENDING): string[] {
  const names = upgrades.map((step) => step.name);
  return [
    ...names.filter((name, i) => names.indexOf(name) !== i).map((name) => `the step "${name}" is in the list twice`),
    ...names.filter((name) => name === '').map(() => 'a step has no name'),
    ...(Number.isInteger(pending) && pending >= 0 && pending <= upgrades.length ? [] : [`SCHEMA_PENDING is ${pending}, not a number of steps of the list`]),
  ];
}

// Brings a raw document to the schema of this build: takes the steps from the version of the
// document on, leaves out the ones the document names, and runs the rest in the order of the list.
// Refused: a version above the one this build saves, and a name that is not among the steps after
// the version of the document (a step this build does not have, or one the version counts already).
// `what`: the path of the document in the messages (a stored document, D62).
export function upgradeDocument(o: Dict, upgrades: readonly UpgradeStep[] = UPGRADES, pending: number = SCHEMA_PENDING, what = 'document'): Dict {
  const saved = savedVersion(upgrades, pending);
  const version = o.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return fail(`${what}: the schema version ${JSON.stringify(version) ?? 'undefined'} is not a version of the document (this build saves ${saved})`);
  if (version > saved) return fail(`${what}: the schema version ${version} is newer than this build reads (it saves ${saved}); open the document with a newer build`);
  const after = upgrades.slice(version - 1);
  const given = o.schemaSteps ?? [];
  if (!Array.isArray(given) || given.some((name) => typeof name !== 'string')) return fail(`${what}.schemaSteps: a list of names of upgrade steps is expected`);
  const done = new Set<string>();
  for (const name of given as string[]) {
    if (!after.some((step) => step.name === name)) fail(`${what}.schemaSteps: this build has no upgrade step "${name}" after version ${version}; the document was saved by a build of another branch, or by one that has not been merged here`);
    if (done.has(name)) fail(`${what}.schemaSteps: the step "${name}" is in the list twice`);
    done.add(name);
  }
  let document = o;
  for (const step of after) if (!done.has(step.name)) document = step.run(document);
  const { schemaVersion: _version, schemaSteps: _steps, ...rest } = document;
  return { ...schemaHeader(upgrades, pending), ...rest };
}
