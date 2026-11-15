# Briefs for the design sessions

Three sessions write the designs of the first packages of [the plan](../README.md) at the same time. Each has a brief here. This file holds what is common to all three; a session reads it and then its own brief.

**State: draft.** The briefs are valid once the contract of the preparatory step ([00-prep/contract.ts](../00-prep/contract.ts), parts 1 and 4; fourth version, three rounds of reviews) has been through its fourth review and the fixes are merged. Until then they may change.

| Brief | Packages | Branch |
|---|---|---|
| [track-a-queries.md](track-a-queries.md) | 1a section, 1b measuring, 1c smallest gap, 1d mass properties, 1e print queries, 1f view image | `d36/design-a` |
| [track-b-extrusion.md](track-b-extrusion.md) | 2a profile offset and wall from a line, 2b taper, 2c hole feature and hardware catalog, 2f extent up to a planar face | `d36/design-b` |
| [track-e-document.md](track-e-document.md) | 3a body properties and materials, 5a mechanism description and posed queries | `d36/design-e` |

## What a session produces

Designs only. No file under `packages/` changes.

For every package of its brief a directory `docs/d36/<id>-<name>/` with `design.md`, `contract.ts` and `calls.ts`, as described in the plan under "A package". The decision number and the validation scenario of each package are in the brief.

- `contract.ts` imports the real types of the engine by a relative path and the shared types from `../00-prep/contract`, and states only what the package adds. A query is added to the map `Queries` by declaration merging; `../00-prep/calls.ts`, section d, shows how, sections f, g and h show an export format, a data catalog and an operation of the app, and section j a feature type, a command, a section of the document and a face role (in a draft these are merged into the maps `FeatureTypes`, `Commands`, `DocumentSections` and `FaceRoles`; in the code they are members of the unions of `types.ts`). All contracts are type-checked together, so a name in a shared map is taken once: the names that start with `example` belong to `00-prep/calls.ts`, and a package uses the real ones (`gap`, `section`, `urdf`).
- `calls.ts` writes the validation scenario of the package as calls against the contract. A step that cannot be written is a hole in the contract: fix the contract, or record the hole.
- `design.md` starts from what [backlog.md](../../backlog.md), part "Direction after D35", says about the package, checks it against the code and decides what the backlog left open. It names the cheap variant and what is deferred, where the code will live, what the package adds to the document, the commands and the queries, the issue codes it adds, the rejected alternatives with reasons, and the open questions.

## Rules

- **Read first:** `CLAUDE.md`, [the decision](../../decisions/D36-order-after-d35.md), [the plan](../README.md), [the preparatory step](../00-prep/design.md) with its `contract.ts` and `calls.ts`.
- **Own branch and worktree.** `git worktree add ../trymesh-<branch name> -b <branch>` from the main tree. For a design the type check of the contracts is enough, and it runs with the root `node_modules` of the main tree linked in: `ln -s <main tree>/node_modules node_modules`. (The full type check and the tests need a real install in the worktree; a design session does not need them.)
- **Write only inside the directories of your packages.** Do not edit `00-prep/`, the plan, another package, or anything under `packages/`.
- **When the shared contract is not enough**, do not change it. Write what is missing into your `design.md` under the heading "Needs from the preparatory step", with the case that cannot be written, and work with a local type that stands in for it. The session that owns the preparatory step collects these and changes the contract once.
- **When two of your packages need the same new thing**, put it into the first one and import it from there.
- **Checks:** `npx tsc -p docs/d36/tsconfig.json` passes.
- **Reviews**, when the designs of the brief are written: three independent reviewers, read-only, with the same brief (what is under review, what to read, what to look for, what to return): an internal subagent, `codex` and `agy`.
  - `codex exec -m gpt-6-astra -c model_reasoning_effort="high" -s read-only -o <answer file> - < <brief file>`
  - `agy --print "$(cat <brief file>)" --model gemini-4-argon-high --effort high --mode plan > <answer file>`
  - Assess every finding against the code before acting on it, fix, and record in `design.md` what was found, whether it held and what changed. Run the three again after the fixes when the findings were many or serious.
- **Commits:** one per package on the branch of the session, docs only, in English. Do not merge into `master`; the session that owns the preparatory step merges the branches after a review across all packages.
- New text is English. The conversation with the owner is in Czech.
