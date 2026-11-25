// A feature type as a module: the entry of the registry of feature types (what the document needs to
// know about the type) and the step of the recompute. The registry is in features/index.ts; a module
// imports neither the registry, nor document.ts, nor evaluate.ts.
import type { FieldSpec } from '../catalog';
import type { Step, StepContext } from '../recompute/state';
import type { Document, Feature, Id } from '../types';
import type { Dict, FeatureRef, ValidationContext } from '../validation';

// The public description of a feature type (for the UI and the description of the API).
export interface FeatureTypeInfo {
  title: string;
  summary: string;
  // Numeric fields of the type (unit, range) that accept an expression. Sketch constraint values are
  // not listed here: the constraint catalog describes them (`values`), the address is
  // `constraints/<id>/<value name>`.
  fields: readonly FieldSpec[];
  // Which bodies the type can create: `self` a body with the feature's ID, `derived` bodies
  // `<feature>/<local name>`. Whether a particular feature does is up to the registry (an extrusion
  // only with the operation new, a pattern only with a body as its source).
  bodies: 'none' | 'self' | 'derived';
  updatable: readonly string[]; // the fields the command updateFeature changes; empty = it has its own commands
}

export interface FeatureModule<F extends Feature> {
  info: Omit<FeatureTypeInfo, 'updatable'>;
  // Validates the feature and returns its canonical copy. What needs the registry (is the target of
  // a reference there, of the right kind and before this feature) and the reader of numeric fields
  // come in the context.
  validate(o: Dict, what: string, context: ValidationContext): F;
  // References to other features, with the place inside the feature where each lies.
  refs(f: F): FeatureRef[];
  // Does the feature create a body with this ID? `local` is the part of the ID after the slash
  // (absent without one).
  createsBody(f: F, local: string | undefined): boolean;
  // The body a body of this feature was copied from (D48), for the properties it inherits: a pattern
  // of a body answers with its source. Asked only for a body the feature creates. A type that
  // derives a body from another (a mirror, a split) sets it; without it a body is copied from none.
  bodySource?(f: F, local: string | undefined): Id | undefined;
  namesFaces: boolean; // does the feature name faces of bodies?
  // Does the feature leave a tool recipe that a pattern can repeat?
  producesTool(f: F): boolean;
  // May a copy tag of a face name (`CopyTag`, a reference of the kind `pattern`) name the feature?
  // A pattern always; a combine as a difference, whose tools moved by a clearance leave tagged faces
  // (D56). Absent: never.
  tagsFaces?(f: F): boolean;
  // The generator of its profile, when it has a profile and the profile comes from one.
  generator?(f: F): string | undefined;
  // A failed expression of a field is a warning and the step runs with the last valid value, instead
  // of an error of the feature (the sketch: it stays visible and what is built on it does not fail).
  keepsLastValidValues?: true;
  // The fields `updateFeature` may change; without them the feature cannot be changed by that command.
  // `removable`: may `null` in a patch name this path although the feature did not have it? (An
  // optional field, an entry of a dictionary with known names.) `f` is the feature after the change.
  // `dictionaries`: the paths of the fields that are dictionaries of numbers by free names (the
  // values of the parameters of an insertion, D62). Every function of a patch takes such a field
  // key by key, without reading `kind` as a reference or `type` and `generator` as a variant: those
  // are legal names there.
  patch?: { fields: readonly string[]; normalize?(merged: Dict, patch: Dict): void; removable?(f: F, path: string[]): boolean; dictionaries?: readonly string[] };
  // The object of the document, outside the feature, that the step reads (D55): a mesh feature
  // answers with the entry of the section `meshes` it places, an insertion with the entry of the
  // section `documents` (D62), undefined when the section has none.
  // The recompute hands it to the step (`StepContext.input`) and uses a remembered step only when it
  // was computed from the same object. A module reads the document nowhere else.
  input?(f: F, doc: Document): object | undefined;
  // The step of the recompute: the state after the feature.
  step(feature: F, context: StepContext): Step;
}
