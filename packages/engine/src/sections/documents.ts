// The section `documents` (D62): stored documents by ID, kept inside the document as copies, to be
// inserted as parts by features of the type `insert`. Validation (strict entries; a stored document
// validated as a document is, through the context), the three commands, and the result (what
// a stored document is, without a recompute, and which features insert it).
import { evaluateParameters } from '../expression';
import type { Document, Id, StoredDocument, StoredDocumentResult } from '../types';
import { has } from '../util';
import { type Dict, fail, newId, object, onlyFields, string } from '../validation';
import { label } from './body-properties';
import type { SectionContext, SectionSpec } from './spec';

type Section = Record<Id, StoredDocument>;
type Results = Record<Id, StoredDocumentResult>;

// Documents inside documents, counted below the host (a guard against a stack overflow from a file
// written by hand; a copy cannot hold itself, so there is no cycle). It bounds the recursion, not
// the work.
export const MAX_INSERT_DEPTH = 8;

const ENTRY_FIELDS = ['name', 'document'] as const;

// An entry in its canonical form: its document validated (and so upgraded) as a document.
function entry(v: unknown, what: string, context: SectionContext): StoredDocument {
  const o = object(v, what);
  onlyFields(o, ENTRY_FIELDS, what, 'a stored document');
  const name = o.name === undefined ? undefined : label(o.name, `${what}.name`);
  return { ...(name === undefined ? {} : { name }), document: context.document(o.document, `${what}.document`) };
}

// The features of a document that insert a stored document, in the order of the timeline.
const usersOf = (doc: Document, id: Id): Id[] => doc.features.filter((f) => f.type === 'insert' && f.document === id).map((f) => f.id);

function addDocument(doc: Document, cmd: Dict, context: SectionContext): Section {
  const id = newId(cmd.id, 'addDocument.id');
  if (has(doc.documents, id)) fail(`addDocument.id: the document has a stored document "${id}" already; a new revision of it comes by replaceDocument`);
  return { ...doc.documents, [id]: entry({ document: cmd.document, ...(cmd.name === undefined ? {} : { name: cmd.name }) }, 'addDocument', context) };
}

function replaceDocument(doc: Document, cmd: Dict, context: SectionContext): Section {
  const id = string(cmd.id, 'replaceDocument.id');
  if (!has(doc.documents, id)) fail(`replaceDocument.id: the document has no stored document "${id}"; a new one comes by addDocument`);
  // `name` absent keeps the name, `null` removes it
  const name = cmd.name === undefined ? doc.documents[id].name : cmd.name === null ? undefined : cmd.name;
  return { ...doc.documents, [id]: entry({ document: cmd.document, ...(name === undefined ? {} : { name }) }, 'replaceDocument', context) };
}

function removeDocument(doc: Document, cmd: Dict): Section {
  const id = string(cmd.id, 'removeDocument.id');
  if (!has(doc.documents, id)) fail(`removeDocument.id: the document has no stored document "${id}"`);
  const users = usersOf(doc, id);
  if (users.length) fail(`removeDocument.id: the stored document "${id}" is inserted by the features ${users.join(', ')}; remove them or point them to another stored document first, in the same batch`);
  return Object.fromEntries(Object.entries(doc.documents).filter(([key]) => key !== id));
}

// What a stored document is, without `usedBy`: computed once per entry object.
const DESCRIBED = new WeakMap<StoredDocument, Omit<StoredDocumentResult, 'usedBy'>>();
function described(stored: StoredDocument): Omit<StoredDocumentResult, 'usedBy'> {
  let found = DESCRIBED.get(stored);
  if (!found) {
    const values = evaluateParameters(stored.document.parameters);
    found = {
      ...(stored.name === undefined ? {} : { name: stored.name }),
      parameters: stored.document.parameters.map((p) => {
        const value = values[p.name];
        return { name: p.name, expr: p.expr, ...(value?.ok ? { value: value.value } : {}) };
      }),
      features: stored.document.features.length,
    };
    DESCRIBED.set(stored, found);
  }
  return found;
}

export const documents: SectionSpec<Section, Results> = {
  info: {
    title: 'Stored documents',
    summary:
      'Other documents kept inside this one, to be inserted as parts (the tool insert_document, or "Insert a document" in the app), by ID. A feature of the type `insert` places one; the same document may be inserted several times, each time with parameters of its own. ' +
      'A stored document is a copy: it changes only by replaceDocument (a new revision of the part), and a file it came from may change without changing the model. It is validated as a document is on a load, so an older one is upgraded. `removeDocument` is refused while a feature inserts it. get_document prints a stored document shortened, get_model lists them with what inserts each.',
    commands: ['addDocument', 'replaceDocument', 'removeDocument'],
    fields: [],
  },
  empty: () => ({}),
  validate(value, what, context) {
    const o = object(value, what);
    const out: Section = {};
    for (const [key, item] of Object.entries(o)) out[newId(key, `${what}.${key}`)] = entry(item, `${what}.${key}`, context);
    return out;
  },
  commands: { addDocument, replaceDocument, removeDocument },
  // a stored document has its own parameters; the values an insertion sets are fields of the feature
  renameParameter: (section) => section,
  // the IDs of the stored documents are a namespace of their own: they name no feature
  names: () => [],
  evaluate(section, doc) {
    return { result: Object.fromEntries(Object.entries(section).map(([id, stored]) => [id, { ...described(stored), usedBy: usersOf(doc, id) }])) };
  },
};
