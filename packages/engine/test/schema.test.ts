// The schema of the document as named upgrade steps (D37): the version a build saves, what
// a load runs, and what it refuses. The cases with branches use lists made up for the test.
import { describe, expect, it } from 'vitest';
import { emptyDocument, validateDocument } from '../src/document';
import { SCHEMA_PENDING, SCHEMA_VERSION, UPGRADES, type UpgradeStep, savedVersion, schemaHeader, schemaProblems, upgradeDocument } from '../src/schema';
import { CommandError } from '../src/validation';

// A step that notes that it ran, in a field of its own.
const step = (name: string): UpgradeStep => ({ name, run: (o) => ({ ...o, ran: [...((o.ran as string[] | undefined) ?? []), name] }) });
const [A, B, C] = [step('a'), step('b'), step('c')];
const refused = (run: () => unknown, message: RegExp) => {
  expect(run).toThrow(CommandError);
  expect(run).toThrow(message);
};

describe('the schema of the document', () => {
  // The branch d36/2b: its step `2b-taper` is pending, so the build saves the version of master and
  // the name of the step. The merge sets SCHEMA_PENDING to 0, and this test to the version 4 without names.
  it('the branch d36/2b: the version of master and the name of the pending step', () => {
    // the names in their order are pinned: a version counts the steps by position, so the list only grows at its end
    expect(UPGRADES.map((entry) => entry.name)).toEqual(['d35-profiles-and-parameters', 'd37-schema-steps', '2b-taper']);
    expect(SCHEMA_PENDING).toBe(1);
    expect(SCHEMA_VERSION).toBe(3);
    expect(schemaProblems()).toEqual([]);
    expect(schemaHeader()).toEqual({ schemaVersion: 3, schemaSteps: ['2b-taper'] });
    expect(Object.keys(emptyDocument())).toEqual(['schemaVersion', 'schemaSteps', 'settings', 'parameters', 'checks', 'features']);
    expect(Object.keys(validateDocument(JSON.parse(JSON.stringify(emptyDocument()))))).toEqual(['schemaVersion', 'schemaSteps', 'settings', 'parameters', 'checks', 'features']);
  });

  it('a document of version 2 loads unchanged but for the version; an empty list of names is no name', () => {
    const now = emptyDocument();
    expect(validateDocument({ ...now, schemaVersion: 2 })).toEqual(now);
    expect(validateDocument({ ...now, schemaSteps: [] })).toEqual(now);
    refused(() => validateDocument({ ...now, schemaSteps: 'a' }), /document\.schemaSteps: a list of names of upgrade steps is expected/);
    refused(() => validateDocument({ ...now, schemaSteps: [3] }), /document\.schemaSteps: a list of names/);
    // a name the version counts already
    refused(() => validateDocument({ ...now, schemaSteps: ['d37-schema-steps'] }), /this build has no upgrade step "d37-schema-steps" after version 3/);
    expect(validateDocument({ ...now, schemaVersion: 2, schemaSteps: ['d37-schema-steps'] })).toEqual(now);
  });

  it('the steps a document has not had run in the order of the list; the document is not changed', () => {
    const old = { schemaVersion: 1, features: [] };
    expect(upgradeDocument(old, [A, B, C], 0)).toEqual({ schemaVersion: 4, features: [], ran: ['a', 'b', 'c'] });
    expect(old).toEqual({ schemaVersion: 1, features: [] });
    expect(upgradeDocument({ schemaVersion: 3 }, [A, B, C], 0)).toEqual({ schemaVersion: 4, ran: ['c'] });
    expect(upgradeDocument({ schemaVersion: 4 }, [A, B, C], 0)).toEqual({ schemaVersion: 4 });
    expect(Object.keys(upgradeDocument({ features: [], schemaVersion: 1 }, [A], 0))[0]).toBe('schemaVersion');
    refused(() => upgradeDocument({ schemaVersion: 5 }, [A, B, C], 0), /the schema version 5 is newer than this build reads \(it saves 4\)/);
    refused(() => upgradeDocument({ schemaVersion: 1.5 }, [A, B, C], 0), /the schema version 1\.5 is not a version/);
    refused(() => upgradeDocument({ schemaVersion: null }, [A, B, C], 0), /the schema version null is not a version/);
    // a step cannot set the version or the names
    const meddling: UpgradeStep = { name: 'm', run: (o) => ({ ...o, schemaVersion: 99, schemaSteps: ['x'] }) };
    expect(upgradeDocument({ schemaVersion: 1 }, [meddling], 0)).toEqual({ schemaVersion: 2 });
  });

  it('a branch: saves the version of the master it started from and the names of its pending steps', () => {
    // the branch of `b` started from a master with the step `a`
    expect(savedVersion([A, B], 1)).toBe(2);
    expect(schemaHeader([A, B], 1)).toEqual({ schemaVersion: 2, schemaSteps: ['b'] });
    expect(schemaHeader([A, B, C], 2)).toEqual({ schemaVersion: 2, schemaSteps: ['b', 'c'] });
    // a document of master gets the pending step; a document of the branch does not get it twice
    expect(upgradeDocument({ schemaVersion: 2 }, [A, B], 1)).toEqual({ schemaVersion: 2, schemaSteps: ['b'], ran: ['b'] });
    expect(upgradeDocument({ schemaVersion: 2, schemaSteps: ['b'], ran: ['b'] }, [A, B], 1)).toEqual({ schemaVersion: 2, schemaSteps: ['b'], ran: ['b'] });
    expect(upgradeDocument({ schemaVersion: 1 }, [A, B], 1)).toEqual({ schemaVersion: 2, schemaSteps: ['b'], ran: ['a', 'b'] });
    refused(() => upgradeDocument({ schemaVersion: 3 }, [A, B], 1), /the schema version 3 is newer than this build reads \(it saves 2\)/);
  });

  it('a branch rebased over a step merged meanwhile: the other step runs, its own does not run twice', () => {
    // master merged `c` while the branch of `b` was open: after the rebase the list is a, c, b
    const saved = { schemaVersion: 2, schemaSteps: ['b'], ran: ['b'] };
    expect(upgradeDocument(saved, [A, C, B], 1)).toEqual({ schemaVersion: 3, schemaSteps: ['b'], ran: ['b', 'c'] });
    // master after the merge of the branch: the names are gone, the version counts every step
    expect(upgradeDocument(saved, [A, C, B], 0)).toEqual({ schemaVersion: 4, ran: ['b', 'c'] });
    expect(upgradeDocument({ schemaVersion: 3, schemaSteps: ['b'], ran: ['b', 'c'] }, [A, C, B], 0)).toEqual({ schemaVersion: 4, ran: ['b', 'c'] });
  });

  it('a document of a branch is refused by master before the merge and by another branch', () => {
    const saved = { schemaVersion: 2, schemaSteps: ['b'] };
    refused(() => upgradeDocument(saved, [A], 0), /this build has no upgrade step "b" after version 2; the document was saved by a build of another branch/);
    refused(() => upgradeDocument(saved, [A, C], 1), /this build has no upgrade step "b" after version 2/);
    refused(() => upgradeDocument({ schemaVersion: 2, schemaSteps: ['a'] }, [A, B], 1), /this build has no upgrade step "a" after version 2/); // the version counts it already
    refused(() => upgradeDocument({ schemaVersion: 2, schemaSteps: ['b', 'b'] }, [A, B], 1), /the step "b" is in the list twice/);
  });

  it('a list of steps is checked: unique names, and a count of pending steps that fits', () => {
    expect(schemaProblems([A, B, C], 3)).toEqual([]);
    expect(schemaProblems([A, B, A], 0)).toEqual(['the step "a" is in the list twice']);
    expect(schemaProblems([A, step('')], 0)).toEqual(['a step has no name']);
    expect(schemaProblems([A], 2)).toEqual(['SCHEMA_PENDING is 2, not a number of steps of the list']);
    expect(schemaProblems([A], -1)).toHaveLength(1);
    expect(schemaProblems([A], 0.5)).toHaveLength(1);
  });
});
