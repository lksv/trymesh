# D36 step 6: the review over the whole set

What [cross-review.md](cross-review.md) did for the designs of steps 1 and 2, for step 6 so far. It covers the plan ([6-plan.md](6-plan.md), the rows 6a to 6g of [README.md](README.md)), the vocabulary of 6a (D64, implemented and merged), and the merged designs of 6e (D65) and 6c (D68). It also covers 6b, 6d and 6f as the plan outlines them. Each design had its own reviews; this one reads how they fit together.

Date: 2026-11-23, at `master` `e70cd65`. Read by a Fable session that wrote none of the designs (they were written and reviewed on Opus 5.5 with `codex`; `agy` ran on none of them). Read-only.

**The owner answered on 2026-11-24**: yes to every recommendation, to the questions of this review and to those of the three single reviews that ran beside it (6a's implementation, the designs of 6e and 6c). All eighteen answers are in "Decisions of the owner" below, each with where it lands. What this review asks of the plan was taken over the same day ("For the plan", at the end): [6-plan.md](6-plan.md), [README.md](README.md), scenario 15 in [../requirements.md](../requirements.md) and the vocabulary in [6a-sketch-prep/design.md](6a-sketch-prep/design.md). The findings of the single reviews are not repeated here: they go to the fix of 6a and to the revisions of the designs of 6e and 6c, which other work owns and records in the "Reviews" of each design. A line that starts "*After the answers*" was added with the answers and is not the reviewer's text.

**Also read, at their branch heads, not reviewed here:** the unmerged designs of 6b (`d36/6b-design`, 86c8be9) and 6d (`d36/6d-design`, da5406c), neither reviewed yet, and 6e's implementation in progress (`d36/6e`, 99ac6b0, stopped before its checks). They were read by search and excerpts, only for whether they answer a cross question. Where a statement rests on one of them it says "branch".

## What was checked

- **The contracts compile together** against `master` (run: `npx tsc -p docs/d36/tsconfig.json`, exit 0). No two packages declare one name with different types.
- **The names each design adds** to a shared map (below), for a name used twice or defined two ways.
- **6a's vocabulary against 6c and 6e**: where a later design left it, and who else that reaches.
- **Every need of 6a**, against the code of `packages/engine/src/references/`, `sketch.ts`, `features/sketch.ts` and `packages/app/src/sketch-tools/`, `sketch-mode.ts`, `references/`.
- **The plan**: the needs and tracks against what the designs are written against; scenario 15 step by step across the plan, `requirements.md` and the designs.
- **Run, one probe against the real engine** (a vitest file over `createEngine` with the real adapters, written and run outside the repository and not kept; each row states its case fully enough to write it again):

| Probe | Result |
|---|---|
| `symmetric` of two projected points about a projected line; `coincident` of two projected points | both refused: "vazba jen mezi pevnými entitami … by se nikdy neprojevila" |
| An extrusion of the region `["m/1/ra", "ra"]`; a sketch on the face `{ role: 'side', curve: 'm/1/ra' }` | both commands accepted; `noProfile` with the region in `refs`, and an error of the sketch |
| `faceKey` of `{ curve: 'o/l/@p:1' }` and of `{ curve: 'o/l', copy: [{ pattern: 'p', index: 1 }] }` | the same key, `E/side/o/l/@p:1` |
| `addExternal` with `type: 'pattern'` | refused: "promítnout jde jen hranu" |
| An axis `{ kind: 'sketchLine', line: 'origin/x' }` | refused: the sketch has no entity `origin/x`; the same axis on a projected line is accepted |

Everything else is from reading.

## Findings

No blocker. "Read" or "run" says how each was established.

### Major

**1. Scenario 15 exists in three versions, and its step 2 cannot be built as the plan writes it.**

- Where: [6-plan.md](6-plan.md), "Validation scenario 15", steps 2, 3 and 6; `docs/requirements.md`, item 15; 6e's design, "Open", 1.
- Step 2 (run): the plan "puts the centre lines on the axes of the origin (a hole pair symmetric about the Y axis)" in a sketch whose hole centres are projections. A constraint whose operands are all fixed is refused (`constraint` in `features/sketch.ts`, the probe above). The skeleton can only measure the symmetry.
- Step 3 (read): the plan extrudes the base from the projected outline with the region flag. 6e changed it to own lines held on the projection, pending the owner. Then no step of the scenario uses the region flag of question 4.
- `requirements.md` item 15 contradicts itself: its headline says "a base from the projected outline with an offset", its sub-item of 6e says "drawn as own lines".
- 6b's unmerged design (branch) proposes a third form: a floor of own lines, a rim from the flagged projection, standoffs. It also moves the symmetry into the board.
- Fix: one text, in the plan and in `requirements.md`, at the merge after this review ("Scenario 15" below proposes it).

**2. The scenario tests each package on a stand-in and no seam between two packages; nobody owns the assembled model.**

- Where: the calls of 6e and 6c; `packages/scenarios/test/scenario15.test.ts` (6e's branch has created it; 6c, 6b and 6d name the same file).
- Read: 6e notches a plain rectangle. 6c mirrors about a construction line with a line for the grip. 6c's calls say "the test of the whole scenario, after 6b, uses `origin/y`", and no package is given that test.
- Not in any step:
  - a cut of a source curve of a mirror or a pattern (6e with 6c: the entries patched, the copies following, the face rule with the derived stage). 6c lists it only under "To verify";
  - a projection of a copy (6b with 6c: a slashed `entity`, the key by the joins after the derived stage);
  - the checks of step 7 that cross packages (a revised DXF, then projections, own outline, mirror).
- Fix: the plan names 6f, the last package, as the one that assembles the cover as one model and replaces the stand-ins. Two cases are added (see "Scenario 15").

**3. The plan's tracks are no longer independent; the designs made step 6 one sequence.**

- Where: README, "Work packages" (Needs of 6c: "6a") and "What can start when" ("Right after 6a: 6b, 6c, 6d and 6e"); 6-plan, "none of them needs another of them".
- Read: 6c writes into 6e's code ("these are changes 6c makes to `sketch-tools.ts` and `sketch-cut.ts`"). 6b (branch) is written "against the designs of 6c and 6e, which are implemented before 6b". 6d (branch) adds to 6c's derive and to 6e's switches.
- Risk: a session that follows the README starts 6b or 6d beside 6c and meets it in the sketch step, `joinPairs`, `entityOf` and `sketch-cut.ts`.
- Fix: the README says the implementation is one sequence, 6a, 6e, 6c, 6b, 6d, 6f, with designs written side by side. The Needs column and the shared places get the rows of "Where packages meet" below.

**4. Later designs changed the vocabulary of 6a in their own files; the record of the vocabulary still states the old rules.**

- Where: 6a's design, "The vocabulary of step 6"; `docs/architecture/sketch.md`, the bullets "IDs" and "Joins"; the README row of 6a.
- Read: 6c replaced the join keys of copies by joins by position, keeps a copy that lies on its source, and changed the derived spec. 6b (branch) takes the axes out of `SketchResult`, which 6a put in. The table "Where the designs leave 6a's vocabulary" lists all of it.
- The vocabulary was written "so that none of them decides it by being merged first". 6f will be designed against a text that is no longer true.
- Fix: amend 6a's section and `sketch.md` now, with a dated list. Rule: a design that changes the vocabulary edits it in the same commit.

**5. After 6d, a cut in a sketch whose region passes a spline drops that region from its feature.**

- Where: 6e's design, "Regions" ("Every test of a point in a region runs on the exact curves") and "Later kinds"; on the branch, `inRegion` and `sampleOf` of `sketch-cut.ts`.
- Read, not run (no spline exists yet). A loop through a spline has no `Loop.exact` (6a, "Ring 2"; 6d's branch says so too). On the branch `inRegion` answers false and `sampleOf` undefined for such a loop. So no face counts as inside the region as it was, and the region leaves the feature's list (`dropped`).
- Failing case: the lid of step 4 with its spline flank, extruded; a notch circle across its top line; `trim`. The profile after is valid, the lid's region is not a region after, and the face rule finds nothing in it.
- 6a's exhaustive switches do not reach this place: it reads a missing field, not a kind. 6e only refuses a spline it is asked to cut. 6d's design (branch) does not list the face rule.
- Fix: 6e says what the rule does for a loop without exact curves. Either the test runs on the polyline with a margin of the chord tolerance, or the region is left as it is and listed, never removed. 6d's design gets `sketch-cut.ts` among its places, with a test.

**6. Where the curves of a sketch cross, and why its profile is invalid, is reachable from the app only.**

- Where: 6e's design, "The app and MCP" (`profileContacts`), "Deferred" (a query of the crossings) and alternative 17.
- Read: `profileContacts` is a function exported beside the engine for the app's marks and status line. This is the hole D36 names ("a query added as a function exported next to it is not caught"). The AI has `valid: false` in `get_sketch`, and the reason only as the refusal of a `split`.
- Fix: a query in `QUERIES` (the contacts as places with the two curves, and the reason when there are none). The app's marks become its view (`QUERY_VIEWS`). It costs the rows of `queries.test.ts`.

**7. The measured need behind the step has no owner and no check.**

- Where: 6-plan, "What step 6 is" (287 of 380 constraints lost, six sketches split with their constraints lost); 6e's "For the plan" ("proposed … if the owner wants it"); 6c's design; 6d (branch), "Open", 2 ("not in 6d").
- Read: the converter (`tools/onshape/sketch.ts`) still skips every constraint with an external operand, every pattern and mirror, and splits by itself. The 287 were never broken down by cause (the plan says so). `docs/onshape-import.md` still says "Step 6 of D36, not designed".
- So step 6 can close with the losses unchanged.
- Fix: a closing point of the step, with the count re-measured as its acceptance number. The converter calls `split`, writes patterns and mirrors as entries, maps the origin and its axes, and projects derived sketches. Or each package carries the converter's part in its own points of work.

### Minor

**8. "An imported outline always forms regions" meets "geometry that is not own is never cut".**
- Where: question 4 of the plan; 6e, "Later kinds".
- Read: an own profile curve that crosses an outline makes the profile invalid for good. A notch or a cut-out over a board outline cannot be drawn in its sketch.
- Fix: 6f gets the flag `regions` that 6b has, default true. The tool "an own outline over a projection" (6e's "Open", 1, deferred) becomes a backlog row, or an option of 6b's `projectSketch` (branch); the scenario does it by hand with 8 curves.

**9. 6f's placement as the plan words it contradicts 6a.**
- Where: 6-plan, 6f ("a point of the sketch and a turn, both fields").
- Read: a reference is computed before the solver. Its place cannot be an own point.
- Fix: coordinates and the turn as numeric fields at `external/<id>/…` (6c's slot), or `origin`, or a point of reference geometry. Also to settle before its design: an entry of `IMPORT_FORMATS` or a tool of its own.

**10. The axes of the origin sit in 6b, but 6c needs them for its main case.**
- Read: 6c tests the mirror about a construction line and a refusal that later goes; 6b (branch) then rewrites 6c's calls.
- Fix, for the owner: the axes as a point of work before 6c. 6a fixed the slot; the work is `entityOf`, `sketchCurves`, the slot of the solver and the view.

**11. "Profile curve" means own and not construction in 6e, the flag `regions` in 6a.**
- Where: 6e's contract, "The cuts"; `isProfile` on the branch.
- Read: after 6c an own curve that crosses a copy leaves the features `pending` with no repair. The reasons `split` without a curve refuses with, and `profileContacts`, do not know the case. 6c's "Copies and the sketch tools" does not take it.
- Fix: three predicates in one place of `sketch-cut.ts` (may be cut; forms regions; can hold a point). 6c adds the reason.

**12. A region that was no region before the batch puts its feature in `dropped` at every tool call.**
- Where: 6e, "Regions" ("A region that cannot be rebuilt … is left … and the feature is in `dropped`"); `patchFeatures` on the branch.
- Read: 6c makes that state ordinary ("When the count drops": a region of a copy above the count is an error on purpose).
- Fix: only a region that was a region before the batch, or names a changed curve, is followed or listed.

**13. 6c's bridge rule over 6e's `split`.**
- Where: 6c, "Copies and the sketch tools", second bullet.
- Read: a line that is not listed and crosses two listed curves is cut in three. Its middle piece is "a piece of a curve it cuts that was not listed" with listed curves at both ends, so it joins the entry and the copies get a chord nobody listed. A span line of 6e (construction, both ends on listed pieces) joins it too.
- Fix: the rule holds for a piece that takes the place of a removed stretch (a trim, a fillet's arc), not for `split`, and not for construction curves.

**14. `get_sketch` of a pattern lists every entity of every copy with its position.**
- Where: 6c, "MCP".
- Read: 200 slots are 1600 entities, against D36's "small enough to read". 6f has the same question.
- Fix: the copy numbers, the positions of copy 1 and the step, with a limit.

**15. The kinds of entries are not described to the AI from the registry.**
- Read: `packages/mcp/src/api.ts` has one hand-written sentence for the edge. 6c, 6b and 6f each add a paragraph by hand.
- Fix, with 6c (the first kind with fields): `summary`, the fields and an `example` on the kind, a generated section, and a test that the examples are accepted, as for `SKETCH_TOOLS` and the generators.

**16. `ReferenceUi.edit.start(host, m, id)` in 6c's contract.**
- Read: it repeats the function form that 6a's implementation replaced by data for `repair`, because the rows would import the sketch mode, which imports the rows ("As implemented", part 5).
- Fix: data.

**17. Documents the designs do not list.**
- 6c: `repository.md` and `modules.test.ts` (the leaf `pattern-numbers.ts`, `references/pattern.ts`), `api.md` (it types `ref: ExternalRef` and has the rule of `kind`), `ai.md` (`get_sketch`), `verification.md`.
- 6e: `ai.md` (the two input kinds).
- None: `docs/onshape-import.md`.

**18. 6c's "To verify" names 6a's code but not 6e's.**
- Read: 6c plugs into `worldOf` (joins from the coincidents alone), `isProfile`, the rule of old ends (`namedOutside`), `patchFeatures` and `CUT_IDS`.
- Fix: 6e's "As implemented" lists these places; 6c verifies against them.

**19. The assembled numbers.**
- Read: the floor of 6b (branch) is extruded with the offset `clearance + wall`; 6e varies the notch radius down to 4 and 1.5. 2a refuses an offset that swallows a concave arc.
- Fix: the radii stay above the offset, or the notch goes on a feature without one.

**20. Reviews.**
- `agy` ran on none of the three designs (HTTP 429 each time). The fixes of the last round of 6e and of 6c were read by no reviewer (6c says so).
- The rules changed there are the riskiest of the set: 6c's groups of rule 3, the counts dropped for the face rule, the fillet between two entries.

**21. Stale text.**
- README, the state paragraph: "none is designed yet, and the questions of that file wait for the owner"; "the schema version is 9"; "full designs are limited to steps 1 and 2".
- README, shared places: "6c if its copies get a map".
- 6c's state line still says 6a is being implemented.
- CLAUDE.md: "D1 to D63", "schema version is 7".
- *After the answers:* the last line does not hold at `e70cd65`, where CLAUDE.md says "D1 to D68" and "schema version is 10"; nothing to fix there. The README's lines were fixed with the plan's update; 6c's state line is its revision's.

### Nits

- **22.** The flag `projected` of the input kind `curve` (6e) says what 6a calls a reference. After 6c "not own" has two kinds, and one of them is refused.
- **23.** 6e's contract does not import 6a's; its three app entries exist only as table rows.
- **24.** 6c does not say where `updateExternal` stands in 6e's order of a batch. It belongs after the new pieces and before `updateFeature`.
- **25.** 6c keeps 6a's second pass of the validator ("fills derived entries after the curves"), though its validator checks the form only.
- **26.** The fillet (D52) refuses a line with `equalLength` or `midpoint`; `trim` moves them to a span line. A backlog row: the fillet may do the same once 6e is in.

## Checked and found sound

- No name is taken twice and no two designs define one thing differently (the table below).
- The ID scheme is one scheme: `<owner>/<local>`, a copy `<owner>/<copy>/<source>`, `origin/x` and `origin/y`. The owner decides the kind, so the locals of two kinds cannot be confused.
- A caller's ID cannot hold a slash (`newId`). Region references and face names take any text (run). A build without a kind refuses its entry aloud (run), so "no schema step" holds for 6c and 6b.
- The quoted face key is needed (run) and 6c is the first to name such a face. A projection of 6b is named by its entry, without a slash.
- The decision numbers D64, D65, D68, D69, D70 and scenario 15.
- The order of the app's bar: 6e after `fillet`, 6c after those.
- `setTool` keeps the selection, so 6c's tools can read it.
- `wallEnd` is named by the point a curve names, not by its vertex, so an entry renames no wall face.
- The order of the layers lets `sketch-cut.ts` import the derived stage from `features/sketch.ts`.

## The plan: tracks and order

| Package | "Needs" in README | What its design is written against |
|---|---|---|
| 6e | 6a for the table of tools; D52 | 6a parts 2, 3 and 4 |
| 6c | 6a | 6a; 6e's code (`sketch-cut.ts`, the fillet's helpers moved there) |
| 6b (branch) | 6a | 6a; 6c (the text that lists the kinds, the joins after the keys, 6c's calls rewritten with the axes); 6e (`shortened`) |
| 6d (branch) | 6a | 6a; 6c's derive and `occupies`; 6e's switches; 6b's validator |
| 6f | 6a, 6b, 6d | all of them |

- The owner's priority (crossing curves, then mirror and pattern) is kept; the order 6a, 6e, 6c, 6b, 6d, 6f is workable.
- Nothing of step 6 of D36 is missing from the cut.
- Deferred with a reason, and to be backlog rows when each package closes: the gear as a block (question 7), the offset of an outline as derived geometry (2a left it to step 6; 6c defers it), the chamfer of a sketch corner and removing a fillet (6e).

## Scenario 15

| Step | The plan | The designs | Proposed |
|---|---|---|---|
| 1 Board | DXF imported (6f) | a stand-in drawn by 6b (branch) until 6f | as the plan; the stand-in until 6f |
| 2 Skeleton | projects holes and outline; "puts the centre lines on the axes" | 6b (branch): the board is placed symmetric, the skeleton measures | the skeleton projects and measures (two reference dimensions to `origin/y`); the symmetry is the board's |
| 3 Base | the projected outline with the flag, an offset | 6e: own lines held on the projection. 6b (branch): a floor so, a rim from the flagged outline, standoffs | the three features of 6b, which keep the flag and the offset of 2a in the scenario |
| 4 Lid | a spline flank, mirrored about the Y axis | 6c: a line and a construction axis until 6d and 6b | as the plan, in the last form |
| 5 Vents | a pattern with `vents`; a cut of copies 1 and 3 | 6c, the same | add: the sketch of the second row projects one copy of the lid's outline and is dimensioned from it (6b with 6c) |
| 6 Notch | across the base outline | 6e: into own lines | add a second notch, in the top line of the lid's source half (6e with 6c; after 6d also finding 5) |
| 7 Checks | `vents`, a revised DXF, `mass`, the section read back | each package its part | the revised DXF and the read-back are 6f's, on the assembled model |

## Names added to the shared maps

| Map | Added | By |
|---|---|---|
| Kinds of entries of `external` | `pattern` (derived) | 6c |
| | `sketch` (reference) | 6b (branch) |
| Engine's sketch tools | `trim`, `extend`, `split` | 6e |
| | `projectSketch` | 6b (branch) |
| Input kinds of a sketch tool | `curve` (with `projected`), `place` | 6e |
| | `sketch` | 6b (branch) |
| Tools of the app's bar | `trim`, `extend`, `split` after `fillet` | 6e |
| | `mirror`, `linearPattern`, `circularPattern` after them | 6c |
| | `spline` after `arc`; `projectSketch` after `project` | 6d, 6b (branch) |
| Lists of `ids` | the fourteen of `CUT_IDS` | 6e |
| | `entries` (the fifteenth, and on the fillet) | 6c |
| Issue codes | `brokenCopies` (a warning) | 6c |
| Curve kinds | `spline` | 6d (branch) |
| Members of a kind | `commandProblem`, `entity`; `derive` may fail with geometry | 6c |
| | `reads`, `keepsValue`, a detail of a failure | 6b (branch) |
| Numeric fields of a sketch | `external/<id>/transform/…` | 6c |
| Derived IDs | `<entry>/<copy>/<source>`, hidden points carried with a copied end | 6c |
| | `origin/x`, `origin/y`, hidden `origin/x/b`, `origin/y/b` | 6b (6a fixed them) |
| Join keys | `["sketch", <sketch>, <vertex>]`; copies have none | 6b (branch); 6c |
| Face keys | a text field with a slash as a JSON string | 6c |
| Modules | `sketch-cut.ts` | 6e |
| | `references/pattern.ts`, `pattern-numbers.ts` | 6c |

Nothing is added to the commands, the queries, the export formats, the feature types, the face roles or the schema.

*After the answers:* 6e adds a query of the places where curves cross (answer 5), and 6f's entry gets the flag `regions` (answer 2). The two points added to the plan take no name beyond the above: 6a2 writes the axes `origin/x` and `origin/y` in place of 6b, 6h changes `tools/onshape` only.

## Where the designs leave 6a's vocabulary

| 6a says | The design does | Whom it reaches | What happens |
|---|---|---|---|
| Points do not join by position; a copy and its source are a declared pair; a copy carries the key of its source's vertex | 6c: the ends of copies that form regions join by position in one stage over all entries: other copies, and own or reference ends that form regions and are one vertex already. The source's coincidents are carried as the entry's `joins`. No keys | 6e: its profiles in memory must take the joins of the derived stage (`worldOf` builds them from the coincidents alone). 6b: its keys must be among the joins before that stage; a projected copy is keyed by the joins after it. 6d: the ends of a spline are ends. 6f, the wall and the fillet's corner: nothing | the owner's question of 6c; then amend the vocabulary |
| A copy that lies on its source is left out of the curves | 6c: kept under its ID with `regions: false`, against every earlier curve that forms regions | 6b: a projected copy may be one that forms none | amend; sound |
| `entityOf` answers for a member of `entities` | 6c: `entities` by the count for listings, `entity` by the form of the ID for validation | 6b: a reference to a copy above the count is valid and broken at the recompute | amend |
| The validator fills derived entries after the curves | 6c: checks the form only | nobody | the second pass can go |
| The result of every sketch carries the axes and their far points | 6b (branch): not in the result; the app and the tools read them as constants | 6e (`worldOfContext` reads `result.curves`), 6c (a tool's `SolvedOwn` reads them too), the view | to settle in 6b's review; amend |
| `hidden`: the far point of an axis | 6c: also own points carried with a copied end | 6b (branch) takes hidden points out of the result's points | consistent |
| An imported outline always forms regions | 6e: such a curve cannot be cut or met away from its vertices | 6f | finding 8 |

*After the answers:* the first row is answer 12, with rule 0 (the source's coincidents carried as the entry's `joins`, and the hidden points carried with a copied end) dropped by answer 14; the last row is answer 2. The row of the axes waits for the review of 6b's design. All seven are written into 6a's design, [6a-sketch-prep/design.md](6a-sketch-prep/design.md), "Amendments after the review of step 6".

## Needs from 6a

"Answered" means `master` has it. "With the package" means it is the slot 6a fixed and that package writes.

| # | Need | From | In `master` | What happens |
|---|---|---|---|---|
| 1 | The table of tools: `picks: 'curve'` with `eligible`, an entry without `clicks`, `draw`, `options.panel`, a batch run as made | 6e; 6c for its axis | Answered: `sketch-tools/spec.ts`. `placeAt` tests every curve of the view, own or not. `SketchContext.tool` holds the document (the contract's stand-in does not show it) | none |
| 2 | A tool reads the selection made before it | 6c | Answered: `setTool` keeps `selection` | none |
| 3 | The profile of a list of curves with joins | 6e, 6c, 6d | Answered: `profileOf`, `joinsOf`, `SketchCurve`, `placedCurve` | none |
| 4 | Exhaustive switches on the kind of a curve | 6d, 6e | Answered, with the spike of "As implemented". Not reached: a reader of `Loop.exact` (finding 5) | 6d lists such places by hand |
| 5 | A derived kind in the registry | 6c | No: `REFERENCE_KINDS`, `kindOf`, `ReferenceValues`, `resolveReferences`, `resultCurves`, `sketchCurves` and the reader of `solved.external` are written for reference kinds. `DerivedKindSpec` and `SolvedOwn` are in the contract only | With 6c. A second member of `ExternalRef` does not compile until the values are split, so the compiler leads |
| 6 | Numeric fields of an entry and their expressions | 6c; 6f for a turn | Half: `entryContext` validates with a fresh reader; the expressions are not handed on, and `withConstraints` drops them | With 6c |
| 7 | Pairs beyond the coincidents | 6c, 6b | The slot: `joinPairs(feature, _references)` reads the coincidents | 6c changes the signature (its pairs come from the derived stage); 6b adds the keys in the same function |
| 8 | The derived stage of the step; the state's `curves`, `joins`, `geometry` | 6c | The state has them; the step is one line of calls | With 6c |
| 9 | One ID asked of a kind; the mark `derived` | 6c | No: `entityOf` lists every entity of the owner at each call | With 6c. The app calls `referenceEntities` in its view and pickers: to measure with 200 copies |
| 10 | The quoted face key | 6c | No (run: the two names share a key) | With 6c |
| 11 | A row of the panel per kind, as data | 6c, 6b | Answered: `REFERENCE_UI`; `repair` is data | finding 16 |
| 12 | The solver's slot of the axes | 6b | In form: `solverSetup` takes any key and stamps only entries. Nothing fills it (run: `origin/x` is no entity) | With 6b |
| 13 | A stored value of another form (an arc, keys) | 6b | `ReferenceValues` by kind; `solved.external` of the document is typed `Projected` | With 6b: a type of the document widens, and `describe_api` shows it |
| 14 | The points of an entry's curve for the own rule of a constraint | 6b, 6f | The edge only (`derivedPoints` in `ruleProblem`) | With 6b |
| 15 | A failure of `compute` with a detail | 6b | A code only | With 6b |
| 16 | Which entries read an entity of another sketch | 6b | `faces(ref)` only | With 6b (`reads`), into the fillet and `sketch-cut.ts` |
| 17 | An update that removes a constrained entity is refused | 6f | Not written; 6c does not need it | With 6f |
| 18 | Entities known from the sketch alone | 6b, 6f | `entities(id, ref, sketch)` | 6b stores `kind`; 6f copies its list into the entry |
| 19 | A tool of any number of clicks, ended by Enter | 6d | Answered: `finish`, `sketchFinish` | none |

Nothing asks for a change of 6a before a package can start.

## Where packages meet

Each later package adapts to the earlier one; the earlier one states its plug-in points in "As implemented".

- **6e, then 6c: `sketch-cut.ts` and the fillet.** 6e creates the module and moves `PROFILE_SOURCES` and the face helpers of the fillet there. 6c adds:
  - the patches of entries, with `updateExternal` of `entryInput`;
  - the joins and copies of the derived stage in each profile in memory (after the batch, the faces, the region as it was);
  - "an entry names it" in the rule of old ends;
  - `ids.entries`, and the refusal of a copy.
  - Both follow regions; they meet in findings 11, 12 and 13.
- **6e and 6c, then 6b.** `reads` goes into `shortened` of the fillet and of the cuts. The axes become a `with` curve and the axis of a mirror. `joinPairs` gets the keys, `entityOf` the owner `origin`. The text for an unknown kind grows by one.
- **6e, 6c and 6b, then 6d.** The compiler finds the switches (the derive, `occupies`, the contacts, the projection's validator). It does not find finding 5.
- **Then 6f.** It adds: a reference curve that forms regions in 6e's tools; an outline's line as an axis of 6c; its entities as sources of 6b; the third part of `updateProblem`; a section and a schema step.
- **The sketch step** (`features/sketch.ts`): 6b writes the stage before the solver, 6c the stage after it.
- **The description for the AI** (`api.ts`), `sketchDetail`, `architecture/sketch.md`, `naming.md`, `ui/sketch.md`, item 15 of `requirements.md` and `scenario15.test.ts`: every package writes there.

## Decisions of the owner

Answered 2026-11-24, every one "yes" to its recommendation. The numbers are those of the owner's list of answers. Rows 1 to 4, 6 to 8, 12, 13 and 17 are the questions of this review (a "finding" is one of the above); rows 5, 9 to 11, 14 to 16 and 18 come from the single reviews of 6e's design, 6c's design and 6a's implementation, whose reports ask them in full. The points 6a2 and 6h are the two the answers add to the plan ([6-plan.md](6-plan.md)).

| # | About | Question | Answer (2026-11-24) | Where it lands |
|---|---|---|---|---|
| 1 | Plan | The axes of the origin before 6c, which needs them for its main case (finding 10) | Yes: `origin/x` and `origin/y` move out of 6b into a small point of their own | The point 6a2, implemented right after 6a |
| 2 | Plan | An outline of 6f forms regions by a flag, default true, where the plan said "always" (finding 8) | Yes. It amends the answer to question 4 of the plan | 6f's design; the plan (question 4) and the vocabulary of 6a amended |
| 3 | Plan | 6f assembles scenario 15 as one model and owns its cross checks (finding 2) | Yes: 6f, the last package, builds the assembled model; the others test on stand-ins | The plan, "Validation scenario 15"; item 15 of `requirements.md` |
| 4 | Plan | A closing point for the converter, with the count of lost constraints kept (finding 7) | Yes: step 6 closes with a point where `tools/onshape` uses the new tools and the lost constraints (287 of 380 today) are measured again | The point 6h, the last of the step |
| 5 | 6e, plan | The places where the curves of a sketch cross, reachable from the app only (finding 6) | Yes: a query in `QUERIES`, so the AI sees them too | 6e's revision (the query, its view, the rows of `queries.test.ts`) |
| 6 | 6e, 1 | The base of scenario 15 | A floor of own lines, a rim from the projected outline, and standoffs: the form of 6b's design (branch) | One text of scenario 15 in the plan and in `requirements.md`; 6e, 6b |
| 7 | 6e, 2 | `equalLength` and `midpoint` of a cut line | They move to a construction (helper) line | 6e, as designed |
| 8 | 6e, 3 | A region that a trim joins with its neighbour | It is taken over into the feature's reference. This holds for a `cut` feature too, whose pocket then swallows the neighbouring region | 6e's revision says the `cut` case aloud |
| 9 | 6e | The edge lists of chamfers and fillets (D63) on a side that is cut | Rewritten in 6e, the same way as faces | 6e's revision |
| 10 | 6e | An extend onto a circle that would make a valid profile invalid | Refused, with the reason | 6e's revision |
| 11 | 6e | A trim cuts every crossing of the sketch; in a sketch of walls the T shapes are meant | Trim repairs crossings only when some feature reads regions of the sketch, or the tool gets an option `repair: false` | 6e's revision chooses between the two and says which |
| 12 | 6c, 1 | The ends of copies join by position | Yes. It holds for copies only; projections of 6b keep their keys | 6c; the vocabulary of 6a amended (finding 4) |
| 13 | 6c, 2 | Holes and walls at copies | Deferred | 6c, as designed; a backlog row when it closes |
| 14 | 6c | Rule 0, the coincidences of the source carried to the copies | Dropped | 6c's revision; the vocabulary of 6a amended |
| 15 | 6c | A broad phase (bounding boxes) in the profile | Part of 6c | 6c's revision; the profile code of `sketch.ts` |
| 16 | 6c | A split pulls an unlisted crossing curve into an entry | Accepted as a known limit | 6c's "Known limits". Finding 13 proposes to narrow the rule; that is left to 6c's revision |
| 17 | 6a | Derived geometry as a kind of entry of `external`, a second map, or `external` renamed (one schema step, cheapest before 6c) | It stays a kind of entry of `external`, as implemented. No rename, no second map | 6a's design, "Amendments after the review of step 6" |
| 18 | Procedure | A preparatory part that adds generic code nothing uses yet (part 4 of 6a went without a review, and the one defect found later is in that code) | It gets at least a light review, even when it does not change behaviour | `CLAUDE.md`, the table "Depth of the review" |

Not asked here, and waiting for the reviews of their designs: of 6b (branch), the tool `projectSketch`; of 6d (branch), the revolve of a spline refused and the converter's splines (the latter is taken up by 6h). 6b's other question, the base in three features, is answer 6.

### Later answers: the reviews of 6b and 6d, and the second round of 6e and 6c

The reviews of the designs of 6b and 6d (on their branches), and a second round over the revised designs of 6e and 6c (one Fable review, codex and agy), asked ten more questions, the revision of 6b three more (29 to 31), and the last rounds of 6d, 6c, 6b and the implementation of 4c five more (32 to 36): eighteen rows. All were answered "yes" to their recommendation on 2026-11-24. Answer 19 replaces the clause "projections of 6b keep their keys" of answer 12. Answer 28 settles the narrowing of answer 16 that 6c's revision made. Answer 29 replaces the hold of answer 21 (the two ends and `equalRadius`) by a radius line.

| # | About | Question | Answer (2026-11-24) | Where it lands |
|---|---|---|---|---|
| 19 | 6b, 6c, 6e | How flagged projections (curves that are not own and form regions) join: by 6b's join keys, which fail for two routes to one corner, a source made of projected edges and copies of 6c, and which the tools of 6e and 6c do not see in memory | By position, as one stage with the joins of copies (answer 12). 6b's keys (`vertices` in the stored value, key pairs) are dropped. Own curves still join only by shared point IDs | 6b's revision; 6c's position stage widened, as the inside of 6e's `sketchWorld` (the one core of `references/world.ts` for the step and the tools, which replaced `toolWorld` and 6c's `withDerived` after the second round); the vocabulary of 6a amended (rows 1, 2 and 13; row 3 with 6b's revision) |
| 20 | Scenario 15 | The cable notch on the floor, which is extruded with an offset: a round notch fits only while it is large against the offset | A rectangular notch, drawn wider by twice the offset. The round notch (a circle trimmed to an arc) is tested on a stand-in without an offset, or on the lid's source half | 6e's calls; the plan and `requirements.md`, item 15 |
| 21 | 6b | `projectSketch` as a tool | Yes. Curves keep the role they have in the source, and a variant makes an own outline held on the projection (the own centre started at the projected centre, so the hold has no second solution) | 6b's revision |
| 22 | 6b, 6d | A projected spline | Refused, as 6b says. 6d writes both refusals (`validate` with `kind: 'spline'`, and `projectSketch`) | 6d's revision |
| 23 | 6d | The revolve of a profile with a spline | Refused now; a backlog row | 6d's revision |
| 24 | 6d | The rim of a part with a spline cannot be chamfered or filleted (D63's chain always meets a spline edge) | A known limit of the cheap variant, stated plainly, with a backlog row for a chamfer along a swept edge. The lid of scenario 15 has no chamfer | 6d's revision |
| 25 | 6d, 6h | The converter's B-splines | In 6h, not in 6d | 6h; 6d's revision |
| 26 | 6d | Where a spline runs, for the AI | `get_sketch` gives each spline the points the curve passes at the joints of its Bezier pieces, and its box | 6d's revision |
| 27 | 6e | The default of the repair, off in every sketch before its first extrusion | It stays as designed: on exactly when a feature reads regions of the sketch, `repair: 'on' \| 'off'` overrides. The round-2 findings it causes (a notch arc left out of a mirror, a trim beyond a touch, the app's remembered override) are fixed | 6e's and 6c's fixes after the second round |
| 28 | 6c | The narrowed rule of answer 16, which misses the notch arc with the repair off | Kept, in the open-end form: a curve the batch makes, re-points or turns into an arc joins an entry when each of its two ends is an open end of that entry's listed curves (the end of exactly one of them) and it has their construction flag. A split still adds only pieces | 6c's third round |
| 29 | 6b | How an own arc is held on a projected arc. The hold of answer 21 (the two ends and `equalRadius`, the centre started at the projected centre) keeps its second solution whatever the start, and has none the analysis accepts at a half turn (measured) | By its two ends and a construction radius line from the own centre to the own start with the projected centre on it: one solution at every sweep. It replaces "ends and `equalRadius`" of answer 21 | 6b's revision and the fixes of its second round |
| 30 | 6b | The inputs of `projectSketch`: answer 21 named the role of the source and the own outline | `projectSketch { sketch, entities?, as? }` with the roles `source` (the default), `reference`, `regions` and `own` | 6b's revision |
| 31 | 6a2 | Under which decision the axes of the origin stand, once carved out of 6b's design | Their own, D71 | [6a2-origin-axes/design.md](6a2-origin-axes/design.md) |
| 32 | 6d | A cusp where a spline's second control point is held on a line behind its end: a valid profile that nothing reports | Not reported in 6d; a backlog row for a general advice of `get_sketch` on a valid profile | 6d's design; [../backlog.md](../backlog.md) |
| 33 | 6c | Clause (ii) of the open-end rule, beyond the letter of answer 28: a curve that was there joins an entry when both its ends are open ends afterwards and one is a bound of a stretch the batch took out of a listed curve with its construction flag (without it the notch arc is left out whenever the circle is trimmed before the line) | Yes, with the flag clause | 6c's design, "Copies and the sketch tools" |
| 34 | 6d | `through` of a spline lists also the middle of every Bezier piece, beyond the joints of answer 26 (a one-piece spline, an SVG `C` or `Q`, gets three points, not its two ends) | Yes | 6d's design |
| 35 | 6b | `projectSketch` with `as: 'own'` draws one own curve per place and lists the rest as `doubled`, while `as: 'regions'` refuses curves lying on each other; a warning of a frozen projection is not passed down a chain of projections | Both as designed; the chain of warnings is a backlog row | 6b's design; [../backlog.md](../backlog.md) |
| 36 | 4c | One pocket case of the larger run-out fuzz (40 of each, seed 1: a fillet of 0.281 at a chord tolerance of 0.05) is 3.74 % from its reference against a bound of 2.5 % | A known limit, recorded; not fixed now | `docs/architecture/verification.md`; D67 |

## What the designs leave out

Against CLAUDE.md and "A package" of the README. The three designs have what a design of this project has: the cheap variant and what is deferred, measurements with a recipe, decisions and rejected alternatives, a contract and calls that compile, the tests owed, the rows for the indexes, the reviews. What is missing:

- **Reachable through MCP** (D36): finding 6 for 6e; finding 14 for the size of an answer.
- **"Add to the catalog rather than special-casing a consumer"**: finding 15, the kinds of entries in `describe_api`.
- **The documents of the area**: finding 17.
- **The plan after a design**: 6e has "For the plan"; 6c has none, though it changes the needs (6e) and the vocabulary. This file carries it.
- **A decision implemented before it was answered**: 6a's question, and 6e's three on its branch. Both follow their recommendation.

## For the plan

To take over into [README.md](README.md), [6-plan.md](6-plan.md) and `requirements.md` with this review:

- the state paragraph of the README and the legend of "Design now" (finding 21);
- the order as one sequence, and the Needs of 6c (6e), 6b (6c, 6e) and 6d (6c, 6e);
- the shared places: `sketch-cut.ts` and the fillet's patches; the sketch step; `joinPairs` and `entityOf`; `faceKey`; `scenario15.test.ts`; the conventions of `api.ts` and `sketchDetail`. The row of the sections loses "6c if its copies get a map";
- scenario 15 as one text (the table above), with 6f assembling it;
- the vocabulary amended in 6a's design and `architecture/sketch.md`;
- 6f's outline corrected (the placement, the flag) before its design starts;
- a row for the converter's closing point, and `docs/onshape-import.md` updated as each package closes.

### Taken over on 2026-11-24

*After the answers.* One commit beside this file did the list above:

- [6-plan.md](6-plan.md): the order as one sequence, 6a, 6a2, 6e, 6c, 6b, 6d, 6f, 6h; the two new points (6a2 the axes of the origin, 6h the converter's closing point); scenario 15 as one text with who tests which part on which stand-in; 6f's outline corrected; the answers beside the questions they amend.
- [README.md](README.md): the rows of 6a2 and 6h, the Needs of the others, the sequence, the shared places of step 6, the state paragraph and the legend.
- `docs/requirements.md`, item 15: the one text.
- [6a-sketch-prep/design.md](6a-sketch-prep/design.md), "Amendments after the review of step 6": each place where a later package leaves the vocabulary, and the package that makes the change. `docs/architecture/sketch.md` points there and describes only what is implemented.
- `docs/onshape-import.md`: the gaps of step 6 name their packages and 6h.

### What other work owns

*After the answers.* Not done by that commit; each is taken by the work named, which reads the plan.

| Work | Takes |
|---|---|
| The fix of 6a (branch `d36/6a-fix`) | The findings of the review of 6a's implementation: a tool of the app that keeps places without `clicks` gets no redraw and its `finish` cannot refuse; the tests 6a owes (`SketchResult.curves` from a recompute, the refusal of an unknown kind of entry, the mode's generic paths); `ruleProblem` reading `derivedPoints` past the registry; the documents against the code |
| The revision of 6e's design (D65) | The findings of its own review (a touch cut like a crossing; arcs left without `equalRadius` when a whole piece is removed; stage 3 of "the region as it was" filling holes; the edge lists of D63), answers 5 to 11, and of this review findings 5 (a loop without exact curves), 6, 11 and 12, nits 22 and 23, and its plug-in points listed for 6c (finding 18) |
| The revision of 6c's design (D68) | The findings of its own review (the derived half of 6a's contract is not in 6a's code; the quadratic profile; the tests the quoted face key changes; a sketch tool's anchor on a copy; why copies did not close), answers 12 to 16, and of this review findings 11, 13 to 16 and 18, nits 24 and 25, its state line (finding 21) and the documents of finding 17 |
| The reviews of the designs of 6b (D69) and 6d (D70) | Whether the axes are in `SketchResult` (the row of the axes in "Where the designs leave 6a's vocabulary"), which 6a2 then implements; need 13 (a stored value of another form, which widens a type of the document) for 6b; for 6d, finding 5 (`sketch-cut.ts` among its places, with a test) |
| 6f's design, when it starts | Findings 8, 9, 14 and 19; the assembled scenario 15 with the cross checks of finding 2 |
| 6h | Finding 7 |
| Every review of a revision | Finding 20: `agy` ran on none of the three designs |
| The owner's own session | Answer 18: the row of the table "Depth of the review" in `CLAUDE.md`. The file of instructions is not changed by a delegated session, so the commit that took the rest over leaves it; until then the rule stands here and in [6-plan.md](6-plan.md), 6a |

Nit 26 (the fillet may move `equalLength` and `midpoint` to a span line once 6e is in) is a backlog row for the package that closes 6e.
