// The inserted document in the app (D62): a stored document placed as a part. Its form chooses the
// stored document (or reads a file into one), the frame and the six numbers of the placement as the
// mesh feature has them, values for the parameters of the stored document, and which of its bodies
// come in.
import { type BodyPlacement, type Command, type Expr, type Id, type Input, type InsertFeature, type PlaneRef, type StoredDocument, featureInput, fileNameOf, idFromFile, meshNameOf } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField, valueText } from '../fields';
import type { PanelHost } from '../host';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, startDraft } from './draft';
import { LABELS, NUMBERS, type Numbers, frameRows, frameText, numberText, pickFrame, placedText, placementOf } from './mesh';

interface Extra {
  picking?: boolean; // the button "Pick" is armed
  cleared: string[]; // parameters whose value the form emptied: the patch removes them
  // the bodies of the stored document with the values of the draft, from a preview without a list,
  // kept while the entry of the stored document and the values are what they were
  listed?: { entry: StoredDocument | undefined; values: string; bodies: Id[] };
}
type InsertMode = DraftMode<InsertFeature, Extra>;
const XY: PlaneRef = { kind: 'base', plane: 'XY' };

// A stored document for people: its name (or ID) and its features.
function documentText(host: PanelHost, id: Id): string {
  const result = host.engine.getState().evaluation.documents[id];
  return result ? `${result.name ?? id} (${result.features} ${result.features === 1 ? 'feature' : 'features'})` : `${id} (missing)`;
}

// Reads a file the user chose into a stored document: addDocument, or replaceDocument of `replace`
// (one undo step); a file that is no document is said in the status line with its reason. Answers
// with the ID of the stored document.
export async function readDocumentFile(host: PanelHost, file: File, replace?: Id): Promise<Id | undefined> {
  let document: unknown;
  try {
    document = JSON.parse(await file.text());
  } catch (error) {
    host.say(`${file.name} is not a document: ${error instanceof Error ? error.message : String(error)}`, true);
    return undefined;
  }
  const name = meshNameOf(file.name);
  if (replace !== undefined) return host.run({ type: 'replaceDocument', id: replace, document: document as never }, `The stored document ${replace} was replaced by ${fileNameOf(file.name)}; every insertion of it is recomputed.`) ? replace : undefined;
  const id = idFromFile(file.name, (taken) => Object.prototype.hasOwnProperty.call(host.doc.documents, taken), 'document');
  return host.run({ type: 'addDocument', id, document: document as never, ...(name === undefined ? {} : { name }) }, `Stored ${file.name} as "${id}".`) ? id : undefined;
}

// The control that chooses a file: a hidden input and its button.
export function documentFileControl(host: PanelHost, label: string, title: string, then: (file: File) => void, inputId?: string): HTMLElement[] {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, ...(inputId ? { id: inputId } : {}) });
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) then(file);
  };
  return [h('div', { className: 'buttons' }, h('button', { textContent: label, title, onclick: () => input.click() }), input)];
}

// The parameters of the stored document: its value beside a field for the value here, empty for
// the document's own.
function parameterRows(m: InsertMode, host: PanelHost): HTMLElement[] {
  const stored = host.engine.getState().evaluation.documents[m.draft.document];
  // a value set for a name the stored document does not have (or of a stored document that is
  // gone) has its field too, so that it can be emptied
  const rows: { name: string; expr: string; value?: number; gone?: boolean }[] = [...(stored?.parameters ?? [])];
  for (const name of Object.keys(m.draft.parameters ?? {})) if (!rows.some((p) => p.name === name)) rows.push({ name, expr: '', gone: true });
  if (rows.length === 0) return [];
  const names = host.doc.parameters.map((p) => p.name);
  const values = m.preview?.evaluation.features[m.draft.id]?.values;
  return [
    h('h3', {}, 'Parameters of the inserted document'),
    ...rows.map((p) => {
      const given = m.draft.parameters?.[p.name];
      const input = h('input', {
        value: given === undefined ? '' : fieldText(given, 'none'),
        placeholder: p.gone ? 'empty it' : p.value === undefined ? p.expr : valueText(p.value, 'none'),
        oninput: () => {
          const text = input.value.trim();
          const { [p.name]: _old, ...rest } = m.draft.parameters ?? {};
          if (text === '') {
            m.draft = { ...m.draft, parameters: rest };
            m.extra.cleared = [...new Set([...m.extra.cleared, p.name])];
            markProblem(input, undefined);
          } else {
            const parsed = parseField(text, 'none');
            markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
            m.draft = { ...m.draft, parameters: { ...rest, [p.name]: parsed ?? NaN } };
            m.extra.cleared = m.extra.cleared.filter((name) => name !== p.name);
          }
          draftChanged(host, false);
        },
      });
      const used = values?.[`parameters/${p.name}`];
      const there = p.gone ? 'not in the stored document' : `there ${p.expr}${p.value === undefined ? '' : ` = ${valueText(p.value, 'none')}`}`;
      return h('label', {}, `${p.name} (${there})`, h('span', { className: 'field' }, input, h('small', { className: 'computed' }, used === undefined ? '' : `= ${valueText(used, 'none')}`)));
    }),
  ];
}

// The bodies of the stored document as boxes: all ticked is no list. The bodies are read from
// a preview of the draft without a list.
function bodyRows(m: InsertMode, host: PanelHost): HTMLElement[] {
  if (m.draft.document === '') return [];
  const entry = Object.prototype.hasOwnProperty.call(host.doc.documents, m.draft.document) ? host.doc.documents[m.draft.document] : undefined;
  const values = JSON.stringify(m.draft.parameters ?? {});
  let listed = m.extra.listed;
  if (!listed || listed.entry !== entry || listed.values !== values) {
    const { bodies: _list, ...all } = m.draft;
    const previewed = host.engine.preview(insertForm.command(all as Input<InsertFeature>, m.editing, m.index, m.extra), m.draft.id);
    listed = m.extra.listed = { entry, values, bodies: previewed.ok ? (previewed.state.evaluation.features[m.draft.id]?.bodies ?? []).map((body) => body.slice(m.draft.id.length + 1)) : [] };
  }
  const there = listed.bodies;
  if (there.length < 2) return [];
  const chosen = new Set(m.draft.bodies ?? there);
  const toggle = (body: Id) => {
    if (chosen.has(body)) chosen.delete(body);
    else chosen.add(body);
    const list = there.filter((id) => chosen.has(id));
    const { bodies: _old, ...rest } = m.draft;
    m.draft = list.length === there.length ? rest : { ...rest, bodies: list };
    draftChanged(host);
  };
  return [
    h('h3', {}, 'Bodies that come in'),
    ...there.map((body) => h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: chosen.has(body), onchange: () => toggle(body) }), body)),
  ];
}

function insertPanel(m: InsertMode, host: PanelHost): HTMLElement[] {
  const stored = Object.keys(host.doc.documents);
  const facts = m.preview?.evaluation.features[m.draft.id]?.facts;
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  // another stored document: the values set and the list of bodies belong to the one before; an
  // edit removes every value the feature has
  const use = (document: Id) => {
    const had = m.editing ? Object.keys((host.doc.features.find((f) => f.id === m.draft.id) as InsertFeature | undefined)?.parameters ?? {}) : [];
    const { bodies: _list, parameters: given, ...rest } = m.draft;
    m.draft = { ...rest, document, parameters: {} };
    m.extra.cleared = m.editing ? [...new Set([...m.extra.cleared, ...had, ...Object.keys(given ?? {})])] : [];
    draftChanged(host);
  };
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New inserted document'),
    stored.length || m.draft.document !== ''
      ? h(
          'label',
          {},
          'Stored document',
          h(
            'select',
            { onchange: (event: Event) => use((event.target as HTMLSelectElement).value) },
            ...stored.map((id) => option(id, documentText(host, id), id === m.draft.document)),
            stored.includes(m.draft.document) || m.draft.document === '' ? null : option(m.draft.document, `${m.draft.document} (missing)`, true),
          ),
        )
      : h('p', { className: 'hint' }, 'The document has no stored document yet: insert a document file of the part.'),
    ...documentFileControl(host, 'Insert a document…', 'Read a document file (.json) into a stored document of this one', (file) => void readDocumentFile(host, file).then((id) => id !== undefined && host.draft === m && use(id)), 'document-file'),
    ...frameRows(m, host, 'part'),
    ...NUMBERS.map((name) =>
      draftField(host, m, LABELS[name], `placement/${name}`, (value) => {
        m.draft = { ...m.draft, placement: { ...m.draft.placement, [name]: value } };
        draftChanged(host, false);
      }),
    ),
    ...parameterRows(m, host),
    ...bodyRows(m, host),
    h('p', { id: 'draft-placed', className: 'hint' }, placedText(facts, 'part')),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

const insertForm: FeatureForm<InsertFeature, Extra> = {
  draft(host, at) {
    const stored = Object.keys(host.doc.documents);
    const id = host.newId('i');
    const numbers = Object.fromEntries(NUMBERS.map((name) => [name, 0])) as Record<Numbers, number>;
    return {
      draft: { id, name: `Part ${id.slice(1)}`, suppressed: false, type: 'insert', document: stored.at(-1) ?? '', placement: { frame: at.plane ?? XY, ...numbers } },
      extra: { cleared: [] },
      say: stored.length ? 'Choose the stored document and where it stands.' : 'Insert a document file of the part.',
    };
  },
  command(draft, editing, index, extra) {
    const placement = placementOf(draft, editing) as Input<BodyPlacement>;
    const values = draft.parameters ?? {};
    if (editing) {
      const parameters = { ...Object.fromEntries((extra?.cleared ?? []).map((name) => [name, null])), ...values };
      return { type: 'updateFeature', id: draft.id, patch: { document: draft.document, placement: placement as never, parameters, bodies: draft.bodies ?? null } } as Command;
    }
    const { parameters: _given, ...rest } = draft;
    return { type: 'addFeature', feature: { ...rest, placement, ...(Object.keys(values).length ? { parameters: values } : {}) }, index };
  },
  incomplete: (draft) => draft.document === '',
  panel: insertPanel,
  live(m) {
    const placed = document.getElementById('draft-placed');
    if (placed) placed.textContent = placedText(m.preview?.evaluation.features[m.draft.id]?.facts, 'part');
  },
  picks: (m) => (m.extra.picking ? { faces: true, planes: true } : undefined),
  click: (m, _event, pick, host) => pickFrame(m, pick, host, 'part'),
};

// The values a feature sets, for a summary: an expression with its value, or the value.
const valuesText = (f: InsertFeature): string =>
  Object.entries(f.parameters ?? {})
    .map(([name, value]) => {
      const expr = f.expressions?.[`parameters/${name}`];
      return `${name} = ${expr ? `${expr} = ${valueText(value, 'none')}` : valueText(value, 'none')}`;
    })
    .join(', ');

export const insert: FeatureUi<InsertFeature, Extra> = {
  button: { label: 'Insert', title: 'Insert another document (a part saved as a document file) as a part of this one' },
  // with no stored document the form opens with the choice of a file
  create: {
    run: (host, at) => {
      const started = startDraft(host, insertForm, at);
      if (started && Object.keys(host.doc.documents).length === 0) document.getElementById('document-file')?.click();
      return started;
    },
  },
  // the fields show every number, zero for one the feature does not have
  edit: (host, feature) => {
    const draft = featureInput(feature);
    host.openDraft({ kind: 'draft', form: insertForm, editing: true, index: host.doc.features.findIndex((f) => f.id === feature.id), draft: { ...draft, placement: { ...Object.fromEntries(NUMBERS.map((name): [Numbers, number | Expr] => [name, 0])), ...draft.placement } }, extra: { cleared: [] } });
  },
  summary(host, f) {
    const numbers = NUMBERS.filter((name) => f.placement[name] !== undefined).map((name) => numberText(f, name));
    const values = valuesText(f);
    return [
      h(
        'p',
        { className: 'hint' },
        `Stored document ${documentText(host, f.document)}, on ${frameText(host, f.placement.frame)}${numbers.length ? `; ${numbers.join(', ')}` : ''}${values ? `; parameters ${values}` : ''}${f.bodies ? `; the bodies ${f.bodies.join(', ')}` : ''}.`,
      ),
    ];
  },
  ownsFace: (feature, name) => name.feature.startsWith(`${feature.id}/`) && (name.copy ?? []).every((tag) => tag.pattern.startsWith(`${feature.id}/`)),
  hideable: () => true,
  form: insertForm,
};
