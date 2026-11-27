// The thread in the app (D76): the form (the faces picked in the view, a size from the catalog
// metricThreads, the fields of the profile and of the place, the hand, the direction, the copies,
// the label, the toggle Modelled), its summary and the walls it highlights. The view draws the
// helix of every cosmetic thread (scene.ts); a modelled one is in the mesh.
import { type Command, DATA_CATALOGS, type Expr, FEATURE_TYPE_INFO, type FaceName, type Id, type Input, type ThreadFeature, type Unit, faceKey } from '@trymesh/engine';
import { fmt, h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField } from '../fields';
import type { PanelHost } from '../host';
import { faceLabel } from '../issue-text';
import { shownValue } from '../labels';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

type ThreadDraft = Input<ThreadFeature>;
interface Extra {
  picking?: boolean; // the button "Pick faces" is armed
  size?: string; // the row of the catalog chosen last
}
type ThreadMode = DraftMode<ThreadFeature, Extra>;
type Optional = 'depth' | 'flankAngle' | 'clearance' | 'starts' | 'offset' | 'length' | 'phase';

const PICK_HINT = 'Click cylindrical faces of one body in the view (a bore or a pin): a click on a picked face removes it.';
const ROWS = DATA_CATALOGS.metricThreads.rows;
const SIZES = Object.keys(ROWS);
// The labels of the numeric fields: the unit for a bare number, and what an empty optional field means.
const FIELDS: Record<keyof typeof FIELD_UNITS, string> = {
  diameter: 'Nominal (major) diameter (mm)',
  pitch: 'Pitch (mm)',
  depth: 'Depth of the profile (mm; empty: the ISO proportion)',
  flankAngle: 'Angle between the flanks (°; empty: 60°)',
  clearance: 'Clearance, radial (mm; empty: none)',
  starts: 'Starts (empty: 1)',
  offset: 'Offset from the end of the face (mm; empty: none)',
  length: 'Length (mm; empty: to the far end of the face)',
  phase: 'Phase (°; empty: 0)',
};
const FIELD_UNITS = Object.fromEntries(FEATURE_TYPE_INFO.thread.fields.map((field) => [field.path, field.spec.unit])) as Record<'diameter' | 'pitch' | Optional, Unit>;
const HANDS: Record<ThreadFeature['hand'], string> = { right: 'Right-hand', left: 'Left-hand' };
const DIRECTIONS: Record<ThreadFeature['direction'], string> = { forward: 'From the end the axis points away from, along it', backward: 'From the other end, against the axis (the mouth of a hole made from a sketch on a face)' };

const bodiesBefore = (host: PanelHost, index: number): Id[] => Object.keys(host.stateBefore(index).evaluation.bodies);
// The faces of a draft as the engine names them (the input form would let a number of a face name
// be an expression, which no face picked in the view has).
const facesOf = (draft: ThreadDraft): FaceName[] => draft.faces as unknown as FaceName[];
// Is a face of the state before the feature a cylinder?
const cylinder = (host: PanelHost, index: number, face: number): boolean => host.stateBefore(index).evaluation.faceSurfaces[face]?.kind === 'cylinder';

// The command of the draft: a new feature, or every field of it (`null` removes what the draft left out).
function threadCommand(draft: ThreadDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  const or = <T>(value: T | undefined): T | null => (value === undefined ? null : value);
  return {
    type: 'updateFeature',
    id: draft.id,
    patch: {
      body: draft.body,
      faces: draft.faces,
      copies: or(draft.copies),
      modelled: draft.modelled,
      diameter: draft.diameter,
      pitch: draft.pitch,
      depth: or(draft.depth),
      flankAngle: or(draft.flankAngle),
      clearance: or(draft.clearance),
      starts: or(draft.starts),
      hand: draft.hand,
      direction: draft.direction,
      offset: or(draft.offset),
      length: or(draft.length),
      phase: or(draft.phase),
      label: or(draft.label),
    },
  };
}

// An optional numeric field: empty leaves the field out (the engine takes its default), a number or
// an expression sets it; an angle typed as a bare number is in degrees.
function optionalField(host: PanelHost, m: ThreadMode, path: Optional, placeholder: string): HTMLElement {
  const unit = FIELD_UNITS[path];
  const names = host.doc.parameters.map((p) => p.name);
  const value = m.draft[path] as number | Expr | undefined;
  const input = h('input', {
    value: value === undefined ? '' : fieldText(value, unit),
    placeholder,
    oninput: () => {
      const parsed = parseField(input.value, unit);
      markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
      const { [path]: _gone, ...rest } = m.draft;
      m.draft = (parsed === undefined ? rest : { ...rest, [path]: parsed }) as ThreadDraft;
      draftChanged(host, false);
    },
  });
  return h('label', {}, FIELDS[path], h('span', { className: 'field' }, input));
}

// What the picked faces would have to be for the thread, against what they are: a bore at the
// minor diameter (the tap drill of a size of the catalog) and a pin at the nominal diameter, each
// moved by twice the clearance. The side and the size are read from the preview.
function wallsText(m: ThreadMode, host: PanelHost): string {
  const threads = m.preview?.evaluation.threads.filter((t) => t.feature === m.draft.id) ?? [];
  if (threads.length === 0) return '';
  const row = m.extra.size !== undefined && ROWS[m.extra.size] && ROWS[m.extra.size].diameter === threads[0].diameter && ROWS[m.extra.size].pitch === threads[0].pitch ? ROWS[m.extra.size] : undefined;
  const minor = threads[0].diameter - 2 * threads[0].depth;
  const lines = threads.map((t) => {
    const wanted = t.internal ? `${fmt((row ? row.tapDrill : minor) + 2 * t.clearance)}${row ? ' (the tap drill' : ' (the minor diameter'}${t.clearance ? ' and twice the clearance)' : ')'}` : `${fmt(t.diameter - 2 * t.clearance)}${t.clearance ? ' (the nominal diameter less twice the clearance)' : ' (the nominal diameter)'}`;
    return `${faceLabel(t.face, host.featureNames)}: a ${t.internal ? 'bore' : 'pin'} of ${fmt(2 * t.radius)}, for this thread ${wanted}`;
  });
  return lines.join('; ');
}

function threadPanel(m: ThreadMode, host: PanelHost): HTMLElement[] {
  const set = (change: Partial<ThreadDraft>, rebuild = true) => {
    m.draft = { ...m.draft, ...change };
    draftChanged(host, rebuild);
  };
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const arm = () => {
    m.extra.picking = !m.extra.picking;
    host.say(m.extra.picking ? PICK_HINT : `${m.draft.faces.length} face${m.draft.faces.length === 1 ? '' : 's'} picked.`);
    draftChanged(host);
  };
  const remove = (i: number) => set({ faces: m.draft.faces.filter((_, k) => k !== i) });
  const fill = (size: string) => {
    m.extra.size = size;
    const row = ROWS[size];
    if (!row) return;
    set({ diameter: row.diameter, pitch: row.pitch, label: size });
    host.say(`${size}: diameter ${row.diameter}, pitch ${row.pitch}; a bore takes the tap drill ${row.tapDrill}, a pin the nominal diameter.`);
  };
  const facts = m.preview?.evaluation.features[m.draft.id]?.facts;
  return [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New thread'),
    h('p', {}, `Body: ${m.draft.faces.length ? host.bodyName(m.draft.body) : 'the body of the first face picked'}`),
    h(
      'ol',
      { className: 'edges' },
      ...facesOf(m.draft).map((face, i) => h('li', {}, `${faceLabel(face, host.featureNames)} `, h('small', {}, `${faceKey(face)} `), h('button', { textContent: 'Remove', title: 'Take the face out of the list', onclick: () => remove(i) }))),
    ),
    m.draft.faces.length === 0 ? h('p', { className: 'hint' }, 'No face picked yet.') : null,
    h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking ? 'Picking… (click to stop)' : 'Pick faces', onclick: arm })),
    h('label', {}, h('input', { type: 'checkbox', checked: m.draft.copies === true, onchange: (event: Event) => set((event.target as HTMLInputElement).checked ? { copies: true } : (({ copies: _c, ...rest }) => ({ ...rest, copies: undefined }))(m.draft)) }), ' Also the copies of a pattern (the bores a pattern of the hole made)'),
    h(
      'fieldset',
      {},
      h('legend', {}, 'From the catalog'),
      h('label', {}, 'Size (ISO metric)', h('select', { onchange: (event: Event) => fill((event.target as HTMLSelectElement).value) }, option('', '—', m.extra.size === undefined), ...SIZES.map((size) => option(size, size, size === m.extra.size)))),
      h('p', { id: 'thread-walls', className: 'hint' }, wallsText(m, host)),
    ),
    draftField(host, m, FIELDS.diameter, 'diameter', (value) => set({ diameter: value }, false)),
    draftField(host, m, FIELDS.pitch, 'pitch', (value) => set({ pitch: value }, false)),
    optionalField(host, m, 'depth', typeof facts?.depth === 'number' ? fmt(facts.depth) : 'ISO proportion'),
    optionalField(host, m, 'flankAngle', '60'),
    optionalField(host, m, 'clearance', '0'),
    optionalField(host, m, 'starts', '1'),
    h('label', {}, 'Hand', h('select', { onchange: (event: Event) => set({ hand: (event.target as HTMLSelectElement).value as ThreadFeature['hand'] }) }, ...(Object.keys(HANDS) as ThreadFeature['hand'][]).map((hand) => option(hand, HANDS[hand], hand === m.draft.hand)))),
    h('label', {}, 'Direction', h('select', { onchange: (event: Event) => set({ direction: (event.target as HTMLSelectElement).value as ThreadFeature['direction'] }) }, ...(Object.keys(DIRECTIONS) as ThreadFeature['direction'][]).map((direction) => option(direction, DIRECTIONS[direction], direction === m.draft.direction)))),
    optionalField(host, m, 'offset', '0'),
    optionalField(host, m, 'length', 'to the far end'),
    optionalField(host, m, 'phase', '0'),
    h(
      'label',
      {},
      'Label (for people; empty = none)',
      h('input', {
        value: m.draft.label ?? '',
        oninput: (event: Event) => {
          const text = (event.target as HTMLInputElement).value;
          const { label: _old, ...rest } = m.draft;
          m.draft = text.trim() === '' ? rest : { ...rest, label: text };
          draftChanged(host, false);
        },
      }),
    ),
    h('label', {}, h('input', { type: 'checkbox', checked: m.draft.modelled, onchange: (event: Event) => set({ modelled: (event.target as HTMLInputElement).checked }) }), ' Modelled'),
    h('p', { className: 'hint' }, m.draft.modelled ? 'Modelled: the grooves are cut into the mesh, for printing. The tool has thousands of triangles and every later feature on the body pays for them: put a modelled thread late in the timeline.' : 'Cosmetic: the mesh stays, the thread is recorded and drawn as its helix, and a screw in such a bore is not a collision. Modelled cuts the grooves, for printing.'),
    h('p', { id: 'draft-facts', className: 'hint' }, factsText(facts)),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

// The facts of the preview, for a human.
function factsText(facts: Record<string, unknown> | undefined): string {
  if (!facts || typeof facts.threads !== 'number') return '';
  const n = (key: string): string => (typeof facts[key] === 'number' ? fmt(facts[key] as number) : '?');
  return `${facts.threads} thread${facts.threads === 1 ? '' : 's'}${typeof facts.copies === 'number' ? ` (${facts.copies} cop${facts.copies === 1 ? 'y' : 'ies'})` : ''}; depth ${n('depth')}, minor diameter ${n('minorDiameter')}, lead ${n('lead')} mm.`;
}

const form: FeatureForm<ThreadFeature, Extra> = {
  // A new thread: on a cylindrical face selected in the view, if one is; the faces are then picked
  // in the view. M6 until a size or numbers are given.
  draft(host, at) {
    const bodies = bodiesBefore(host, at.index);
    if (bodies.length === 0) return { problem: 'A thread needs a body with a bore or a pin. Create one first.' };
    const selected = host.selected?.kind === 'face' && bodies.includes(host.selected.body) && cylinder(host, at.index, host.selected.faceId) ? host.selected : undefined;
    const body = selected?.body ?? (host.selected && host.selected.kind !== 'plane' && bodies.includes(host.selected.body) ? host.selected.body : bodies[bodies.length - 1]);
    const id = host.newId('t');
    const row = ROWS.M6;
    return {
      draft: { id, name: `Thread ${id.slice(1)}`, suppressed: false, type: 'thread', body, faces: selected ? [selected.name] : [], modelled: false, diameter: row.diameter, pitch: row.pitch, hand: 'right', direction: 'backward', label: 'M6' },
      extra: { picking: true, size: 'M6' },
      say: PICK_HINT,
    };
  },
  command: threadCommand,
  incomplete: (draft) => draft.faces.length === 0,
  panel: threadPanel,
  live(m, host) {
    const facts = document.getElementById('draft-facts');
    if (facts) facts.textContent = factsText(m.preview?.evaluation.features[m.draft.id]?.facts);
    const walls = document.getElementById('thread-walls');
    if (walls) walls.textContent = wallsText(m, host);
  },
  picks: (m) => (m.extra.picking ? { faces: true, before: true } : undefined),
  // While "Pick faces" is armed a click on a cylindrical face adds it, or removes it when it is in
  // the list. The first face sets the body.
  click(m, _event, pick, host) {
    if (!m.extra.picking) return;
    if (pick?.kind !== 'face') return host.say(`Click a face. ${PICK_HINT}`, true);
    if (!cylinder(host, m.index, pick.faceId)) return host.say('That face is not a cylinder: a thread goes on a bore or a pin.', true);
    if (m.draft.faces.length && pick.body !== m.draft.body) return host.say(`The faces of one thread belong to one body (${host.bodyName(m.draft.body)}); another body is another feature.`, true);
    const key = faceKey(pick.name);
    const at = facesOf(m.draft).findIndex((face) => faceKey(face) === key);
    if (at >= 0) m.draft = { ...m.draft, faces: m.draft.faces.filter((_, i) => i !== at) };
    else m.draft = { ...m.draft, body: pick.body, faces: [...m.draft.faces, pick.name] };
    host.say(`${m.draft.faces.length} face${m.draft.faces.length === 1 ? '' : 's'} picked.`);
    draftChanged(host);
  },
};

// Does a face carry a thread of the feature: a listed face, or with `copies` a copy of one?
function threadsFace(feature: ThreadFeature, name: FaceName): boolean {
  const key = faceKey(name);
  return feature.faces.some((face) => {
    if (faceKey(face) === key) return true;
    const tags = face.copy?.length ?? 0;
    if (!feature.copies || (name.copy?.length ?? 0) <= tags) return false;
    const stripped = { ...name, copy: name.copy?.slice(0, tags) } as FaceName;
    if (tags === 0) delete (stripped as { copy?: unknown }).copy;
    return faceKey(stripped) === faceKey(face);
  });
}

// The row of the catalog a thread was made from: its key is the label, and the diameter and the
// pitch are the row's (an edited thread shows the size it has in the picker).
function sizeOf(feature: ThreadFeature): string | undefined {
  const row = feature.label !== undefined && Object.hasOwn(ROWS, feature.label) ? ROWS[feature.label] : undefined;
  return row && row.diameter === feature.diameter && row.pitch === feature.pitch ? feature.label : undefined;
}

export const thread: FeatureUi<ThreadFeature, Extra> = {
  button: { label: 'Thread', title: 'A thread on bores or pins of a body (cosmetic: drawn as its helix, the mesh stays)' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, { size: sizeOf(feature) }),
  summary(host, f, result) {
    const size = f.label ?? `${shownValue(f, 'diameter', f.diameter)} x ${shownValue(f, 'pitch', f.pitch)}`;
    const count = typeof result?.facts?.threads === 'number' ? result.facts.threads : f.faces.length;
    return [h('p', { className: 'hint' }, `${size}, ${f.hand === 'left' ? 'left-hand, ' : ''}${f.modelled ? 'modelled' : 'cosmetic'}, on ${count} face${count === 1 ? '' : 's'} of ${host.bodyName(f.body)}${f.copies ? ' and the copies of a pattern' : ''}.`)];
  },
  ownsFace: threadsFace,
  hideable: () => false,
  form,
};
