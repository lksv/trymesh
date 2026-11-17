// The mesh feature in the app (D55): a stored mesh placed as a body. Its form chooses the stored
// mesh (or imports a file into one), the frame (a base plane, a plane feature, a planar face picked
// in the view, or a point of a sketch) and the six numbers of the placement; a new feature is
// a bought part (`use: 'reference'`) unless the box says otherwise.
import { type BodyPlacement, type Command, type Expr, type FrameRef, IMPORT_FORMATS, type Id, type Input, type InsertFeature, type MeshFeature, type PlaneRef, type SketchFeature, featureInput, idFromFile, importAccept, importFormatOf, importMesh, meshNameOf } from '@trymesh/engine';
import { h } from '../dom';
import { valueText } from '../fields';
import { entryEntities } from '../references';
import type { PanelHost, ViewPick } from '../host';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, startDraft } from './draft';
import { planeText } from './plane';

interface Extra {
  bought: boolean; // a new feature is made a reference part in the same batch
  picking?: boolean; // the button "Pick" is armed: the next click in the view takes a plane or a planar face
}
type MeshMode = DraftMode<MeshFeature, Extra>;
// A draft of a feature with a placement: a mesh, or an inserted document (D62), which shares the
// frame, the six numbers and their summary.
export type PlacedMode = DraftMode<MeshFeature | InsertFeature, { picking?: boolean }>;
export type Numbers = Exclude<keyof BodyPlacement, 'frame'>;
export const NUMBERS: readonly Numbers[] = ['x', 'y', 'z', 'rx', 'ry', 'rz'];
export const LABELS: Record<Numbers, string> = {
  x: 'Offset along X (mm or an expression)',
  y: 'Offset along Y (mm or an expression)',
  z: 'Offset along the normal (mm or an expression)',
  rx: 'Turn about X (° or an expression in radians)',
  ry: 'Turn about Y (° or an expression in radians)',
  rz: 'Turn about the normal (° or an expression in radians)',
};
const XY: PlaneRef = { kind: 'base', plane: 'XY' };

// A frame for people: a plane as the forms name one, or a point of a sketch.
export const frameText = (host: PanelHost, frame: FrameRef | Input<FrameRef>): string => (frame.kind === 'sketchPoint' ? `the point ${frame.point} of ${host.nameOf(frame.sketch)}` : planeText(host, frame as PlaneRef));

// A stored mesh for people: its name (or ID) and its triangles.
function meshText(host: PanelHost, id: Id): string {
  const result = host.engine.getState().evaluation.meshes[id];
  return result ? `${result.name ?? id} (${result.triangles} triangles)` : `${id} (missing)`;
}

// The ID of a stored mesh from the name of its file, numbered when the document has it already.
const meshId = (host: PanelHost, file: string): Id => idFromFile(file, (id) => Object.prototype.hasOwnProperty.call(host.doc.meshes, id));

// Reads a file the user chose into a stored mesh (addMesh, one undo step) and answers with its ID;
// a file the import refuses is said in the status line with its reason.
export async function importFile(host: PanelHost, file: File): Promise<Id | undefined> {
  const format = importFormatOf(file.name);
  if (format === undefined) {
    host.say(`${file.name}: the app reads ${Object.entries(IMPORT_FORMATS).map(([, spec]) => `.${spec.extensions.join(', .')}`).join(', ')} files.`, true);
    return undefined;
  }
  const outcome = importMesh(format, new Uint8Array(await file.arrayBuffer()), {}, meshNameOf(file.name));
  if (!outcome.ok) {
    host.say(`${file.name} cannot be imported: ${outcome.error.message}`, true);
    return undefined;
  }
  const { report } = outcome;
  const id = meshId(host, file.name);
  const size = report.bounds.max.map((high, axis) => valueText(high - report.bounds.min[axis], 'mm')).join(' × ');
  const said = [`Imported ${file.name} as "${id}": ${report.triangles} triangles, ${report.shells} ${report.shells === 1 ? 'shell' : 'shells'}, ${size}.`, ...report.notes.map((note) => `${note[0].toUpperCase()}${note.slice(1)}.`)].join(' ');
  return host.run({ type: 'addMesh', id, mesh: outcome.mesh }, said) ? id : undefined;
}

// The control that chooses a file: a hidden input and its button.
function importControl(host: PanelHost, then: (id: Id) => void): HTMLElement[] {
  const input = h('input', { type: 'file', accept: importAccept(), hidden: true, id: 'mesh-file' });
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importFile(host, file).then((id) => id !== undefined && then(id));
  };
  return [h('div', { className: 'buttons' }, h('button', { textContent: 'Import a file…', title: 'Read an STL file into a stored mesh of the document', onclick: () => input.click() }), input)];
}

// The frame: the base planes, the plane features before the feature, the face the draft has, or
// a point of a sketch before it; a plane or a face is also picked in the view.
export function frameRows(m: PlacedMode, host: PanelHost, what = 'mesh'): HTMLElement[] {
  const before = host.doc.features.slice(0, m.index);
  const planes = before.filter((f) => f.type === 'plane').map((f): PlaneRef => ({ kind: 'plane', feature: f.id }));
  const sketches = before.filter((f): f is SketchFeature => f.type === 'sketch');
  const frame = m.draft.placement.frame;
  const keyOf = (ref: Input<FrameRef>): string => (ref.kind === 'base' ? `base:${ref.plane}` : ref.kind === 'plane' ? `plane:${ref.feature}` : ref.kind === 'face' ? 'face' : 'point');
  const refs: PlaneRef[] = [...(['XY', 'XZ', 'YZ'] as const).map((plane): PlaneRef => ({ kind: 'base', plane })), ...planes];
  const set = (next: Input<FrameRef>) => {
    m.draft = { ...m.draft, placement: { ...m.draft.placement, frame: next } };
    draftChanged(host);
  };
  const choose = (value: string) => {
    if (value === 'point') {
      const sketch = sketches.at(-1);
      if (!sketch) return host.say('A point of a sketch needs a sketch before this place of the timeline.', true);
      return set({ kind: 'sketchPoint', sketch: sketch.id, point: 'origin' });
    }
    const ref = refs.find((candidate) => keyOf(candidate) === value);
    if (ref) set(ref);
  };
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const listed = frame.kind === 'sketchPoint' || refs.some((ref) => keyOf(ref) === keyOf(frame));
  const out: HTMLElement[] = [
    h(
      'label',
      {},
      'Frame',
      h(
        'select',
        { onchange: (event: Event) => choose((event.target as HTMLSelectElement).value) },
        ...refs.map((ref) => option(keyOf(ref), planeText(host, ref), keyOf(ref) === keyOf(frame))),
        listed ? null : option(keyOf(frame), frameText(host, frame), true),
        option('point', 'A point of a sketch', frame.kind === 'sketchPoint'),
      ),
    ),
  ];
  if (frame.kind === 'sketchPoint') {
    const sketch = host.feature(frame.sketch);
    const points = sketch?.type === 'sketch' ? ['origin', ...Object.keys(sketch.points), ...entryEntities(sketch).filter((entity) => entity.kind === 'point').map((entity) => entity.id)] : [];
    const ids = sketches.map((s) => s.id);
    out.push(
      h(
        'label',
        {},
        'Sketch',
        h(
          'select',
          { onchange: (event: Event) => set({ kind: 'sketchPoint', sketch: (event.target as HTMLSelectElement).value, point: 'origin' }) },
          ...ids.map((id) => option(id, host.nameOf(id), id === frame.sketch)),
          ids.includes(frame.sketch) ? null : option(frame.sketch, `${host.nameOf(frame.sketch)} (missing)`, true),
        ),
      ),
      h(
        'label',
        {},
        'Point',
        h(
          'select',
          { onchange: (event: Event) => set({ ...frame, point: (event.target as HTMLSelectElement).value }) },
          ...points.map((id) => option(id, id === 'origin' ? 'origin of the sketch' : id, id === frame.point)),
          points.includes(frame.point) ? null : option(frame.point, `${frame.point} (missing)`, true),
        ),
      ),
      h('p', { className: 'hint' }, 'The frame of the sketch moved to the point: the centre of a bolt pattern drawn from the data sheet.'),
    );
  }
  const arm = () => {
    m.extra.picking = !m.extra.picking;
    host.say(m.extra.picking ? `Click a plane or a planar face in the view: the ${what} stands on it.` : `Frame: ${frameText(host, frame)}.`);
    draftChanged(host, true);
  };
  out.push(h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking ? 'Picking… (click to stop)' : 'Pick', onclick: arm })));
  return out;
}

function meshPanel(m: MeshMode, host: PanelHost): HTMLElement[] {
  const stored = Object.keys(host.doc.meshes);
  const facts = m.preview?.evaluation.features[m.draft.id]?.facts;
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const use = (mesh: Id) => {
    m.draft = { ...m.draft, mesh };
    draftChanged(host);
  };
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New mesh'),
    stored.length || m.draft.mesh !== ''
      ? h(
          'label',
          {},
          'Stored mesh',
          h(
            'select',
            { onchange: (event: Event) => use((event.target as HTMLSelectElement).value) },
            ...stored.map((id) => option(id, meshText(host, id), id === m.draft.mesh)),
            stored.includes(m.draft.mesh) || m.draft.mesh === '' ? null : option(m.draft.mesh, `${m.draft.mesh} (missing)`, true),
          ),
        )
      : h('p', { className: 'hint' }, 'The document has no stored mesh yet: import an STL file of the part.'),
    ...importControl(host, (id) => host.draft === m && use(id)),
    ...frameRows(m, host),
    ...NUMBERS.map((name) =>
      draftField(host, m, LABELS[name], `placement/${name}`, (value) => {
        m.draft = { ...m.draft, placement: { ...m.draft.placement, [name]: value } };
        draftChanged(host, false);
      }),
    ),
    m.editing
      ? null
      : h(
          'label',
          { className: 'check' },
          h('input', {
            type: 'checkbox',
            checked: m.extra.bought,
            onchange: () => {
              m.extra.bought = !m.extra.bought;
              draftChanged(host);
            },
          }),
          'A bought part (a reference body, not printed)',
        ),
    h('p', { id: 'draft-placed', className: 'hint' }, placedText(facts)),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

// Where the origin and the axes of the mesh ended up, from the facts of the previewed feature.
export function placedText(facts: Record<string, unknown> | undefined, what = 'mesh'): string {
  const vector = (value: unknown) => (Array.isArray(value) ? `(${value.map((x: number) => String(Math.round(x * 1000) / 1000 + 0)).join(', ')})` : '?');
  return facts ? `The origin of the ${what} at ${vector(facts.origin)}, its X axis along ${vector(facts.axisX)}, its Z axis along ${vector(facts.axisZ)}.` : '';
}

// The placement of a command: a number that is zero (no expression) is not stored, so it is left out
// of a new feature and removed from one that is edited.
export function placementOf(draft: Input<MeshFeature | InsertFeature>, editing: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { frame: draft.placement.frame };
  for (const name of NUMBERS) {
    const value = draft.placement[name];
    if (value === 0 || value === undefined) {
      if (editing) out[name] = null;
    } else out[name] = value;
  }
  return out;
}

const form: FeatureForm<MeshFeature, Extra> = {
  draft(host, at) {
    const stored = Object.keys(host.doc.meshes);
    const id = host.newId('m');
    const numbers = Object.fromEntries(NUMBERS.map((name) => [name, 0])) as Record<Numbers, number>;
    return {
      draft: { id, name: `Mesh ${id.slice(1)}`, suppressed: false, type: 'mesh', mesh: stored.at(-1) ?? '', placement: { frame: at.plane ?? XY, ...numbers } },
      extra: { bought: true },
      say: stored.length ? 'Choose the stored mesh and where it stands.' : 'Import an STL file of the part.',
    };
  },
  command(draft, editing, index, extra) {
    const placement = placementOf(draft, editing) as Input<BodyPlacement>;
    if (editing) return { type: 'updateFeature', id: draft.id, patch: { mesh: draft.mesh, placement: placement as never } };
    const add: Command = { type: 'addFeature', feature: { ...draft, placement }, index };
    return extra?.bought ? { type: 'batch', commands: [add, { type: 'setBodyProperties', body: draft.id, patch: { use: 'reference' } }] } : add;
  },
  incomplete: (draft) => draft.mesh === '',
  panel: meshPanel,
  live(m) {
    const placed = document.getElementById('draft-placed');
    if (placed) placed.textContent = placedText(m.preview?.evaluation.features[m.draft.id]?.facts);
  },
  picks: (m) => (m.extra.picking ? { faces: true, planes: true } : undefined),
  click: (m, _event, pick, host) => pickFrame(m, pick, host),
};

// A click in the view while the button "Pick" is armed: the plane or the planar face is the frame.
export function pickFrame(m: PlacedMode, pick: ViewPick | undefined, host: PanelHost, what = 'mesh'): void {
  if (!m.extra.picking) return;
  const ref = host.planeRefOf(pick);
  if (!ref) return host.say(`A ${what} stands on a plane or a planar face.`, true);
  const own = (feature: Id) => feature === m.draft.id || feature.startsWith(`${m.draft.id}/`);
  if (ref.kind === 'face' && (own(ref.body) || own(ref.face.feature))) return host.say(`The ${what} cannot stand on its own face.`, true);
  m.extra.picking = false;
  m.draft = { ...m.draft, placement: { ...m.draft.placement, frame: ref } };
  host.say(`Frame: ${frameText(host, ref)}.`);
  draftChanged(host, true);
}

// The number of a field of the placement for a summary: its expression with the value, or the value.
export const numberText = (f: MeshFeature | InsertFeature, name: Numbers): string => {
  const value = valueText(f.placement[name] ?? 0, name.startsWith('r') ? 'rad' : 'mm');
  const expr = f.expressions?.[`placement/${name}`];
  return `${name} ${expr ? `${expr} = ${value}` : value}`;
};

export const mesh: FeatureUi<MeshFeature, Extra> = {
  button: { label: 'Mesh', title: 'Place a stored mesh (a bought part read from an STL file) as a body' },
  // with no stored mesh the form opens with the choice of a file
  create: {
    run: (host, at) => {
      const started = startDraft(host, form, at);
      if (started && Object.keys(host.doc.meshes).length === 0) document.getElementById('mesh-file')?.click();
      return started;
    },
  },
  // the fields show every number, zero for one the feature does not have
  edit: (host, feature) => {
    const draft = featureInput(feature);
    host.openDraft({ kind: 'draft', form, editing: true, index: host.doc.features.findIndex((f) => f.id === feature.id), draft: { ...draft, placement: { ...Object.fromEntries(NUMBERS.map((name): [Numbers, number | Expr] => [name, 0])), ...draft.placement } }, extra: { bought: false } });
  },
  summary(host, f) {
    const numbers = NUMBERS.filter((name) => f.placement[name] !== undefined).map((name) => numberText(f, name));
    return [h('p', { className: 'hint' }, `Stored mesh ${meshText(host, f.mesh)}, on ${frameText(host, f.placement.frame)}${numbers.length ? `; ${numbers.join(', ')}` : ''}.`)];
  },
  ownsFace: (feature, name) => name.feature === feature.id && !name.copy,
  hideable: () => true,
  form,
};
