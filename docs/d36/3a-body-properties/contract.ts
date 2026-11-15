// Contract of package 3a (D48): body properties and the catalog of materials.
// A draft for review, not code that runs: it is only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). It imports the real types of the engine and the shared
// types of the preparatory step and states what the package adds. The design is design.md; the
// scenario written as calls is calls.ts.
//
// Second version, after the first round of reviews (design.md, "Reviews").
//
// Where the types will live: everything a caller of the engine or an AI reads goes to `types.ts`
// (the section, its entry, the patch, the three commands, the result in the evaluation), into the
// parts that `describe_api` prints: the document before the marker `// --- porty`, the result and
// the commands after the marker `// --- přepočet`. What stands between the two markers is cut
// out of the description. `SECTION_INFO` and the catalog are values of the engine and are
// exported from its index.

import type { Expr, ExpressionError, Id, Vec3 } from '../../../packages/engine/src/index';
import type { ArgSpecs, QuantitySpec, UpgradeStep } from '../00-prep/contract';

// ================================================================ the section of the document

// What a body is used as. It decides who reads the body:
// - `part`: a printed part of the design. The default.
// - `reference`: a bought or given part (a motor, a bearing, a board), modelled so that the design
//   fits around it. It is not printed: the print exports and the print queries leave it out when
//   they are given no list of bodies. It has a mass and belongs to the mechanism and to the robot
//   description.
// - `auxiliary`: not a physical thing (kept-free space, the envelope of a motion, a jig that only
//   helps the modelling). It takes part in the interference and gap queries, which is what it is
//   for. It is in no list a reader makes by itself (print, parts, robot description) and it never
//   has a mass, also when a caller names it.
// One rule for every reader: a body the caller lists is taken as listed. A print export of a list
// with a reference or an auxiliary body writes that body; the mass query of such a list counts
// the reference body and reports the auxiliary one as skipped, because it has no mass to count.
// "Not printed" and "not part of the mechanism" are the two values next to the default; see
// design.md, "Two flags or one field".
export type BodyUse = 'part' | 'reference' | 'auxiliary';

// The properties of one body. Every field is optional; a field that is not there is inherited
// from the body this one was copied from (a copy made by a pattern), or has its default. An entry
// with no field is not stored.
// - `name`: for people; not inherited. Non-empty, no leading or trailing space, at most 200
//   characters. Without it the body is named as today, after the feature that created it.
// - `color`: `#rrggbb`, lower case.
// - `material`: a label for people and for the parts list, such as "PETG". It is free text: the
//   catalog fills `material` and `density` together (command `setBodyMaterial`) and the document
//   keeps the number, so a corrected catalog does not change an old model.
// - `density`: g/cm3, the effective density of the body as it is made (a printed part has shells
//   and infill). A numeric field: it takes an expression.
// - `mass`: g, the mass of the whole body from a data sheet or a scale. When it is there the
//   density is not used for the mass. A numeric field.
// - `expressions`: the expressions of the two numeric fields, by the same rule as
//   `FeatureBase.expressions`: the field holds the last valid number, the recompute rewrites it.
// Inheritance, field by field, with one exception: `density` and `mass` say together what the
// body weighs and are inherited together. An entry that states either of the two inherits
// neither, so a copy given another material is weighed by its own density and not by the mass
// of its source.
export interface BodyProperties {
  name?: string;
  color?: string;
  material?: string;
  use?: BodyUse;
  density?: number;
  mass?: number;
  expressions?: { density?: Expr; mass?: Expr };
}

// The section: an entry per body ID, also for a derived one (`<pattern>/<number>`). A document
// always has it, possibly empty. An entry whose body no state has stays in the document; see
// `bodyPropertiesWithoutBody`.
export type BodyPropertiesSection = Record<Id, BodyProperties>;

// The range of the two numeric fields. The upper bound of the density is there for the same
// reason as the ranges of angles: a value in another unit by mistake (1240 kg/m3) does not pass.
export const DENSITY = { title: 'Density', unit: 'g/cm3', min: { value: 0, open: true }, max: { value: 25 } } as const satisfies QuantitySpec;
export const MASS = { title: 'Mass', unit: 'g', min: { value: 0, open: true } } as const satisfies QuantitySpec;

// ================================================================ commands

// What `setBodyProperties` changes: the fields it names. `null` removes a field (the body then
// inherits it or has the default); a number in a numeric field removes its expression, a string
// sets one, as in `updateFeature`.
export interface BodyPropertiesPatch {
  name?: string | null;
  color?: string | null;
  material?: string | null;
  use?: BodyUse | null;
  density?: number | Expr | null;
  mass?: number | Expr | null;
}

// The three commands. In the code they are members of `Command`.
// - `setBodyProperties`: merges `patch` into the entry of `body`, creating it. The body has to be
//   one a feature of the document can create: the feature exists and its type creates a body of
//   that ID (an extrusion with the operation new; `<pattern>/<number>` of a pattern of a body).
//   Whether the body exists in the model is not asked: the count of a pattern may be an
//   expression and a feature may be suppressed.
// - `setBodyMaterial`: takes the row `material` of the catalog `materials` and writes its key
//   into `material` and its density into `density` (a number, the expression goes). A key the
//   catalog does not have is an invalid command whose message lists the keys. `mass` stays.
// - `removeBodyProperties`: removes the entry. It asks only that the entry is there, so it also
//   removes an entry whose body is gone.
export interface BodyPropertiesCommands {
  setBodyProperties: { type: 'setBodyProperties'; body: Id; patch: BodyPropertiesPatch };
  setBodyMaterial: { type: 'setBodyMaterial'; body: Id; material: string };
  removeBodyProperties: { type: 'removeBodyProperties'; body: Id };
}

// ================================================================ the result of the recompute

// The properties of a body of the state, with what it inherits and the defaults filled in.
// Computed with the parameters and the checks, after the timeline, from the document alone and
// the volume of the body; no step of a feature reads it, so a change of a property recomputes
// no geometry.
//
// The mass, in this order:
// 1. An auxiliary body has none.
// 2. The pair `density` and `mass` is the own one when the entry states either, else the
//    inherited one.
// 3. With a `mass` in that pair: the mass, `massFrom: 'mass'`. If its expression is in error
//    there is no mass; the density does not step in for a weighed value that cannot be read.
// 4. Else with a `density`: density · volume / 1000, `massFrom: 'density'`; none if it is in error.
// 5. Else none.
// A field in error is reported in `fieldErrors` and is left out of the result. Nothing takes its
// place: not its last number, not the inherited value.
export interface BodyPropertiesResult {
  name: string; // the own name, else that of the creating feature; a copy adds ` / <number>`, as the app names it today
  color?: string;
  material?: string;
  use: BodyUse;
  density?: number; // g/cm3
  mass?: number; // g, by the rule above
  massFrom?: 'mass' | 'density';
  // The body this one was copied from (the source of the pattern that made it): the nearest one.
  // A field may come from further up a chain of patterns; the chain is followed through `from`
  // of the source.
  from?: Id;
  fieldErrors?: { density?: ExpressionError; mass?: ExpressionError };
}

// Entries of the section whose body the state does not have (the feature was removed or
// suppressed, an extrusion became an addition, the count of a pattern dropped): the keys of the
// section that are not keys of the result. Meant for the state at the end of the timeline; MCP
// and the app list them and offer to remove them.
export declare function bodyPropertiesWithoutBody(section: BodyPropertiesSection, properties: Record<Id, BodyPropertiesResult>): Id[];

// The bodies a print export or a print query takes when the caller names none: those with the
// use `part`, in the order of the model. It takes the result of the recompute, which the context
// of a query or of a format has (`context.state.evaluation.bodyProperties`) as well as a state.
export declare function printedBodies(properties: Record<Id, BodyPropertiesResult>): Id[];

// ================================================================ the catalog of materials

// A small table of printing materials. `density` is that of the solid material from the data
// sheet of a named maker; `source` says which. A printed part is lighter, so the value is an
// upper bound until the density is corrected or the mass is weighed.
export interface MaterialRow {
  density: number; // g/cm3
  source: string;
}

// ================================================================ sections as a registry

// What the description for the AI and the forms read about a section that a package adds:
// the commands that change it and its numeric fields. `owner` says which kind of entry has the
// field (`body`; a joint in 5a), `path` is its address inside that entry and the key in
// `expressions` of the entry. The registry of the engine has more per section (validation, the
// commands, the recompute, the rename of a parameter); see design.md, "A registry of sections".
export interface SectionFieldSpec {
  owner: string;
  path: string;
  spec: QuantitySpec;
  when?: { path: string; equals: string };
}
export interface SectionInfo {
  title: string;
  summary: string;
  commands: readonly string[];
  fields: readonly SectionFieldSpec[];
}

// ================================================================ the upgrade step

// The section is new, so a build without the package would drop it on load without a word; the
// step makes such a build refuse the document instead. It has nothing to convert: it gives
// a document that has no such field the empty section. A field that is there, whatever it holds
// (`null` included), is left for the validation to judge, as the step from version 1 does with
// `parameters`.
export const BODY_PROPERTIES_STEP: UpgradeStep = {
  name: '3a-body-properties',
  run: (document) => ('bodyProperties' in document ? document : { ...document, bodyProperties: {} }),
};

// ================================================================ a stand-in for the mass query of 1d

// Package 1d (track A) designs the mass query on another branch. This is what 3a assumes of it,
// under a name that cannot collide; design.md, "What 1d and the exports read".
// - The bodies are taken as one piece, in the pose asked about (it reads `context.bodies`).
// - The mass of a body is `mass` of its `BodyPropertiesResult`. A body without one takes the
//   argument `density`; without that too the query fails and names the body.
// - An auxiliary body adds nothing and is listed in `skipped`.
export const STAND_IN_MASS_ARGS = {
  bodies: { kind: 'list', of: { kind: 'body' }, min: 1, title: 'Bodies taken as one piece' },
  density: { kind: 'number', title: 'Density of the bodies that state neither a density nor a mass', optional: true, spec: DENSITY },
} as const satisfies ArgSpecs;
export interface StandInMassResult {
  mass: number; // g
  centerOfMass: Vec3; // mm, in the pose asked about
  bodies: { body: Id; mass: number; from: 'mass' | 'density' | 'argument' }[];
  skipped: Id[]; // auxiliary bodies
}

// ================================================================ additions to the shared maps

declare module '../00-prep/contract' {
  interface DocumentSections {
    bodyProperties: BodyPropertiesSection;
  }
  interface Commands extends BodyPropertiesCommands {}
  interface EvaluationAfter {
    bodyProperties: Record<Id, BodyPropertiesResult>; // by body of the state
  }
  interface Catalogs {
    materials: MaterialRow;
  }
  interface Queries {
    standInMass: { spec: typeof STAND_IN_MASS_ARGS; result: StandInMassResult };
  }
}

// By section of the document; 5a adds its line by adding its section to `DocumentSections`.
// (The examples of 00-prep/calls.ts put a section of their own into the map; the registry of
// the code has the real ones.)
export declare const SECTION_INFO: { [S in keyof import('../00-prep/contract').DocumentSections]-?: SectionInfo };
