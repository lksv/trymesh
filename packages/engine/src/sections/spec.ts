// A section of the document (D48): a field of `Document` next to `parameters` and `checks` that is
// not a timeline (the properties of bodies; the mechanism of 5a). A section is a module in this
// directory and one entry of the registry `DOCUMENT_SECTIONS` (sections/index.ts); the places of
// the engine that build, change, compare and evaluate a document ask the registry.
import type { NumberSpec } from '../catalog';
import type { Environment } from '../expression';
import type { State } from '../recompute/state';
import type { BodyResult, Document, Id } from '../types';
import type { Dict } from '../validation';

// A numeric field of an entry of a section. `owner` says which kind of entry has the field (`body`;
// a joint in 5a), `path` is its address inside the entry and the key in `expressions` of the entry.
export interface SectionFieldSpec {
  owner: string;
  path: string;
  spec: NumberSpec;
  when?: { path: string; equals: string };
}

// What the description for the AI and the forms read about a section: what it is, the commands
// that change it and its numeric fields.
export interface SectionInfo {
  title: string;
  summary: string;
  commands: readonly string[];
  fields: readonly SectionFieldSpec[];
}

// What a section evaluates to after the timeline, and the section with the numbers of its
// expressions written back, when one changed.
export interface SectionEvaluation<S, R> {
  result: R;
  written?: S;
}

// What the validation and the commands of a section get besides the value (D62): the validator of
// a nested document, as `validateDocument` validates a document on a load, one level deeper than
// the document the section belongs to (refused beyond 8 levels), with `what` as the path of its
// messages. document.ts builds it, so that no section imports document.ts, which imports the
// sections. The sections that hold no document ignore it.
export interface SectionContext {
  depth: number; // of the document the section belongs to: 0 for the host
  document(value: unknown, what: string): Document;
}

// The entry of the registry of sections.
export interface SectionSpec<S, R> {
  info: SectionInfo;
  empty(): S;
  // A document is loaded: the shape and the rules of the section alone, strict (a field the section
  // does not know is refused, not dropped). Expressions are checked for their syntax only.
  validate(value: unknown, what: string, context: SectionContext): S;
  // The commands that change the section, by type. A command is validated in full, as every other
  // one; an invalid one throws `CommandError`. Returns the new section.
  commands: Record<string, (doc: Document, command: Dict, context: SectionContext) => S>;
  renameParameter(section: S, from: string, to: string): S;
  // The IDs of features and sketch entities the section names, and for a derived ID also the ID it
  // is derived from (the feature of the body `screws/2`).
  names(section: S): Id[];
  // Top-level keys of the result whose values are records: each entry is kept stable on its own as
  // well (the links and the joints of the mechanism), not only the record as a whole.
  entries?: readonly string[];
  // After the timeline: the result, from the document, the bodies of the state, the environment of
  // the parameters and the state of the recompute the bodies come from (the frames and the points of
  // the sketches, for an axis through a sketch point); and the section with the numbers written back
  // when they changed.
  evaluate(section: S, doc: Document, bodies: Readonly<Record<Id, BodyResult>>, environment: Environment, state: State): SectionEvaluation<S, R>;
}
