// The hole in the app (D46): its form (the sketch and its points, the kind of hole with its fields,
// the extent, the targets, the label, and the sizes from the catalog through the query
// `hardwareHole`), its summary and the faces it highlights.
import { type Command, DATA_CATALOGS, FEATURE_TYPE_INFO, type HoleFeature, type HoleShape, type Id, type Input, type QueryArgs, type SketchFeature } from '@trymesh/engine';
import { fmt, h } from '../dom';
import type { PanelHost } from '../host';
import { SIDES, shownValue, startText } from '../labels';
import { withFrom } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';
import { planeText } from './plane';

type HoleDraft = Input<HoleFeature>;
type ShapeDraft = HoleDraft['shape'];
type Use = QueryArgs<'hardwareHole'>['use'];
type Fit = NonNullable<QueryArgs<'hardwareHole'>['fit']>;
// What the form remembers beyond the draft.
interface Extra {
  shapes: Partial<Record<HoleShape['type'], ShapeDraft>>; // the shape of each kind the draft had last, to return to
  distance?: Extract<HoleDraft['extent'], { type: 'distance' }>; // the distance the draft had last
  use: Use; // the group "From the catalog"
  size?: string;
  fit: Fit;
  allowance: string;
  picking?: boolean; // the button "Pick the start" is armed: the next click in the view takes a plane or a planar face (D66)
}
type HoleMode = DraftMode<HoleFeature, Extra>;

export const KINDS: Record<HoleShape['type'], string> = { plain: 'Plain', counterbore: 'Counterbore', countersink: 'Countersink', nutPocket: 'Nut pocket' };
const USES: Record<Use, string> = { clearance: 'Clearance hole', socketHead: 'Socket head cap screw', countersunk: 'Countersunk screw', nutPocket: 'Hex nut', heatSetInsert: 'Heat-set insert' };
const FITS: Record<Fit, string> = { fine: 'Fine', medium: 'Medium', coarse: 'Coarse' };
const SIDE_OPTIONS = ['backward', 'forward'] as const;
// The labels of the numeric fields of a shape: the unit for a bare number.
const FIELD_LABEL: Record<string, string> = {
  diameter: 'Diameter (mm or an expression)',
  headDiameter: 'Head diameter (mm or an expression)',
  headDepth: 'Head depth (mm or an expression)',
  angle: 'Angle of the countersink (° or an expression in radians)',
  acrossFlats: 'Across flats (mm or an expression)',
  rotation: 'Rotation of a corner from the X axis (° or an expression in radians)',
};

// The numeric fields of a kind of shape, as the registry lists them.
const fieldsOfKind = (kind: HoleShape['type']): string[] => FEATURE_TYPE_INFO.hole.fields.filter((field) => field.when?.path === 'shape/type' && field.when.equals === kind).map((field) => field.path.slice('shape/'.length));
// A shape of another kind: what it had last in this form, or the diameter kept and the other
// fields empty for the preview to ask for (a rotation starts at zero).
function shapeOfKind(draft: ShapeDraft, kind: HoleShape['type'], remembered: Extra['shapes']): ShapeDraft {
  const known = remembered[kind];
  if (known) return known;
  return { type: kind, ...Object.fromEntries(fieldsOfKind(kind).map((name) => [name, name === 'diameter' ? draft.diameter : name === 'rotation' ? 0 : Number.NaN])) } as ShapeDraft;
}

// The sizes the catalog of a use has.
// The catalogs each use reads (the table of the query `hardwareHole`).
const READS: Record<Use, (keyof typeof DATA_CATALOGS)[]> = {
  clearance: ['clearanceHoles'],
  socketHead: ['clearanceHoles', 'socketHeadScrews'],
  countersunk: ['clearanceHoles', 'countersunkScrews'],
  nutPocket: ['clearanceHoles', 'hexNuts'],
  heatSetInsert: ['heatSetInserts'],
};
// The sizes a use can answer: those every catalog it reads has (ISO 4762 has no M3.5, ISO 273 has).
const sizesOf = (use: Use): string[] => {
  const [first, ...rest] = READS[use].map((name) => Object.keys(DATA_CATALOGS[name].rows));
  return first.filter((size) => rest.every((keys) => keys.includes(size)));
};
// The extent of a draft in words, for the status line.
const extentText = (extent: HoleDraft['extent']): string =>
  extent.type === 'throughAll' ? `through all (${SIDES[extent.side].toLowerCase()})` : `a distance of ${typeof extent.distance === 'number' ? fmt(extent.distance) : extent.distance} mm${extent.start === 0 ? '' : ` from a start of ${typeof extent.start === 'number' ? fmt(extent.start) : extent.start} mm`}`;
// The own points of a sketch and its origin, as the form offers them.
const pointsOf = (sketch: SketchFeature | undefined): Id[] => (sketch ? ['origin', ...Object.keys(sketch.points)] : []);

// A patch of the same variant merges with the feature, so a start plane the draft no longer has is
// removed by name, as the label is.
function holeCommand(draft: HoleDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  const { id, sketch, points, shape, extent, targets, label } = draft;
  return { type: 'updateFeature', id, patch: { sketch, points, shape, extent: { ...extent, from: extent.from ?? null }, targets, label: label ?? null } };
}

// The label of the field of the mouth: from what the offset is measured.
const mouthLabel = (extent: HoleDraft['extent']): string =>
  extent.from ? 'Start of the mouth (mm or an expression; offset from the start plane along the normal of the sketch)' : 'Start of the mouth (mm or an expression; offset from the sketch plane along its normal)';

function holePanel(m: HoleMode, host: PanelHost): HTMLElement[] {
  const sketches = host.doc.features.slice(0, m.index).filter((f): f is SketchFeature => f.type === 'sketch');
  const bodies = Object.keys(host.stateBefore(m.index).evaluation.bodies);
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const set = (draft: HoleDraft, rebuild = true) => {
    m.draft = draft;
    draftChanged(host, rebuild);
  };
  const { draft } = m;
  const sketch = sketches.find((f) => f.id === draft.sketch);
  const offered = pointsOf(sketch);
  const toggle = <T,>(list: T[], item: T, order: T[]): T[] => (list.includes(item) ? list.filter((other) => other !== item) : order.filter((other) => other === item || list.includes(other)));
  const missingPoints = draft.points.filter((id) => !offered.includes(id));
  const missingTargets = draft.targets.filter((id) => !bodies.includes(id));
  const extent = draft.extent;
  const out: (HTMLElement | null)[] = [
    h('h2', {}, m.editing ? `Úprava: ${draft.name}` : 'New hole'),
    select(
      'Sketch',
      (value) => set({ ...m.draft, sketch: value, points: [] }),
      ...sketches.map((f) => option(f.id, f.name, f.id === draft.sketch)),
      sketch ? null : option(draft.sketch, `${host.nameOf(draft.sketch)} (missing)`, true),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Points'),
      ...[...missingPoints, ...offered].map((id) =>
        h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: draft.points.includes(id), onchange: () => set({ ...m.draft, points: toggle(m.draft.points, id, [...missingPoints, ...offered]) }) }), offered.includes(id) ? (id === 'origin' ? 'origin of the sketch' : id) : `${id} (missing)`),
      ),
      h('p', { className: 'hint' }, 'One hole at every point ticked; a point of projected geometry cannot carry a hole (draw a point and make it coincident with it).'),
    ),
    select(
      'Kind',
      (value) => {
        m.extra.shapes = { ...m.extra.shapes, [m.draft.shape.type]: m.draft.shape };
        set({ ...m.draft, shape: shapeOfKind(m.draft.shape, value as HoleShape['type'], m.extra.shapes) });
      },
      ...(Object.keys(KINDS) as HoleShape['type'][]).map((kind) => option(kind, KINDS[kind], kind === draft.shape.type)),
    ),
    ...fieldsOfKind(draft.shape.type).map((name) => draftField(host, m, FIELD_LABEL[name], `shape/${name}`, (value) => set({ ...m.draft, shape: { ...m.draft.shape, [name]: value } as ShapeDraft }, false))),
    select(
      'Extent',
      (value) => {
        if (m.draft.extent.type === 'distance') m.extra.distance = m.draft.extent;
        // the start plane of the draft goes with it to the other variant; a remembered one never comes back
        const next: HoleDraft['extent'] = value === 'distance' ? (m.extra.distance ?? { type: 'distance', start: 0, distance: -10 }) : { type: 'throughAll', side: 'backward' };
        set({ ...m.draft, extent: withFrom(next, m.draft.extent.from) });
      },
      option('throughAll', 'Through all', extent.type === 'throughAll'),
      option('distance', 'Distance', extent.type === 'distance'),
    ),
    // the row "Start at" (D66): the sketch plane, or a plane picked in the view
    h('p', {}, `Start at: ${extent.from ? planeText(host, extent.from) : 'Sketch plane'}`),
    h(
      'div',
      { className: 'buttons' },
      h('button', { textContent: m.extra.picking ? 'Picking the start… (click to stop)' : 'Pick the start', onclick: () => arm(host, m) }),
      extent.from ? h('button', { textContent: 'Sketch plane', onclick: () => set({ ...m.draft, extent: withFrom(m.draft.extent, undefined) }) }) : null,
    ),
    extent.from ? h('p', { id: 'draft-start', className: 'hint' }, startText(m.preview?.evaluation.features[m.draft.id])) : null,
    ...(extent.type === 'distance'
      ? [
          draftField(host, m, mouthLabel(extent), 'extent/start', (start) => set({ ...m.draft, extent: { ...(m.draft.extent as typeof extent), start } }, false)),
          draftField(host, m, 'Depth of the whole hole (mm or an expression; negative = against the normal, into the body under a face)', 'extent/distance', (distance) => set({ ...m.draft, extent: { ...(m.draft.extent as typeof extent), distance } }, false)),
        ]
      : [
          select('Side', (value) => set({ ...m.draft, extent: withFrom<HoleDraft['extent']>({ type: 'throughAll', side: value as (typeof SIDE_OPTIONS)[number] }, m.draft.extent.from) }), ...SIDE_OPTIONS.map((side) => option(side, SIDES[side], side === extent.side))),
          h('p', { className: 'hint' }, 'The depth follows the target bodies at every recompute. On a face the normal points out of the body, so a hole into it goes against it.'),
        ]),
    h(
      'fieldset',
      { className: 'targets' },
      h('legend', {}, 'Target bodies'),
      ...[...bodies, ...missingTargets].map((body) =>
        h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: draft.targets.includes(body), onchange: () => set({ ...m.draft, targets: toggle(m.draft.targets, body, [...bodies, ...missingTargets]) }) }), bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`),
      ),
      bodies.length === 0 && missingTargets.length === 0 ? h('p', { className: 'hint' }, 'There is no body to cut yet.') : null,
    ),
    h(
      'label',
      {},
      'Label (for people and a parts list; empty = none)',
      h('input', {
        value: draft.label ?? '',
        oninput: (event: Event) => {
          const text = (event.target as HTMLInputElement).value;
          const { label: _old, ...rest } = m.draft;
          set(text.trim() === '' ? rest : { ...rest, label: text }, false);
        },
      }),
    ),
    ...catalogFields(m, host, option, select),
    ...draftButtons(host, m),
  ];
  return out.filter((element): element is HTMLElement => element !== null);
}

// The group "From the catalog": what the hole is for, the size, the series of the through hole and
// the allowance, and a button that asks the query `hardwareHole` and writes its answer into the
// draft. The app composes nothing itself.
function catalogFields(m: HoleMode, host: PanelHost, option: (value: string, label: string, selected: boolean) => HTMLElement, select: (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => HTMLElement): HTMLElement[] {
  const sizes = sizesOf(m.extra.use);
  // the size chosen, or the first of the catalog; read when the button is pressed, since the select does not rebuild the panel
  const chosen = (): string | undefined => (m.extra.size !== undefined && sizes.includes(m.extra.size) ? m.extra.size : sizes[0]);
  const size = chosen();
  const fill = () => {
    const size = chosen();
    if (size === undefined) return host.say('The catalog has no size.', true);
    const args: QueryArgs<'hardwareHole'> = { use: m.extra.use, size, fit: m.extra.fit, ...(m.extra.allowance.trim() ? { allowance: m.extra.allowance.trim() } : {}) };
    const answer = host.engine.query('hardwareHole', args);
    if (!answer.ok) return host.say(answer.error.message, true);
    const { shape, label, depth } = answer.result;
    // An insert is a blind hole of its depth: the start of the draft stays and so does its direction
    // (the sign of its distance, or the side of "through all": backward is against the normal).
    // A screw or a nut leaves the extent as it is. The status line says what the extent is.
    const current = m.draft.extent;
    // an expression in the distance is read from the preview
    const distance = current.type === 'distance' ? (typeof current.distance === 'number' ? current.distance : m.preview?.evaluation.features[m.draft.id]?.values?.['extent/distance']) : undefined;
    const sign = current.type === 'throughAll' ? (current.side === 'backward' ? -1 : 1) : distance !== undefined && distance > 0 ? 1 : -1;
    const extent: HoleDraft['extent'] = depth === undefined ? current : withFrom<HoleDraft['extent']>({ type: 'distance', start: current.type === 'distance' ? current.start : 0, distance: sign * depth }, current.from);
    m.draft = { ...m.draft, shape, label, extent };
    host.say(`${label}: the sizes from ${answer.result.from.join(' and ')}; the extent ${depth === undefined ? 'stays' : 'is now'} ${extentText(extent)}.`);
    draftChanged(host);
  };
  return [
    h(
      'fieldset',
      {},
      h('legend', {}, 'From the catalog'),
      select('For', (value) => ((m.extra.use = value as Use), host.renderPanel()), ...(Object.keys(USES) as Use[]).map((use) => option(use, USES[use], use === m.extra.use))),
      select('Size', (value) => (m.extra.size = value), ...sizes.map((key) => option(key, key, key === size))),
      m.extra.use === 'heatSetInsert' ? null : select('Series of the through hole', (value) => (m.extra.fit = value as Fit), ...(Object.keys(FITS) as Fit[]).map((fit) => option(fit, FITS[fit], fit === m.extra.fit))),
      h('label', {}, 'Allowance (an expression added to the diameters, such as a parameter; empty = none)', h('input', { value: m.extra.allowance, oninput: (event: Event) => (m.extra.allowance = (event.target as HTMLInputElement).value) })),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Fill from the catalog', disabled: size === undefined, onclick: fill })),
    ),
  ].filter((element): element is HTMLFieldSetElement => element !== null);
}

const form: FeatureForm<HoleFeature, Extra> = {
  // A new hole: the sketch selected on the timeline or the latest one, a plain hole through all
  // backward, the body the sketch stands on as the target. The points are ticked in the form.
  draft(host, at) {
    const sketches = host.doc.features.slice(0, at.index).filter((f): f is SketchFeature => f.type === 'sketch');
    const chosen = sketches.find((f) => f.id === host.selectedFeature) ?? sketches[sketches.length - 1];
    if (!chosen) return { problem: 'A hole needs a sketch with its points. Draw one first.' };
    const bodies = Object.keys(host.stateBefore(at.index).evaluation.bodies);
    if (bodies.length === 0) return { problem: 'A hole needs a body to cut. Create one first.' };
    const target = chosen.plane.kind === 'face' && bodies.includes(chosen.plane.body) ? chosen.plane.body : bodies[bodies.length - 1];
    const id = host.newId('d');
    return {
      draft: { id, name: `Hole ${id.slice(1)}`, suppressed: false, type: 'hole', sketch: chosen.id, points: [], shape: { type: 'plain', diameter: 3 }, extent: { type: 'throughAll', side: 'backward' }, targets: [target] },
      extra: { shapes: {}, use: 'clearance', fit: 'medium', allowance: '' },
      say: 'Tick the points of the sketch; the sizes of a screw, a nut or an insert come from the catalog.',
    };
  },
  command: holeCommand,
  incomplete: (draft) => draft.points.length === 0 || draft.targets.length === 0,
  panel: holePanel,
  live(m) {
    const start = document.getElementById('draft-start');
    if (start) start.textContent = startText(m.preview?.evaluation.features[m.draft.id]);
  },
  // a face or a plane while the button "Pick the start" is armed, in the state before the hole
  picks: (m) => (m.extra.picking ? { faces: true, planes: true, before: true } : undefined),
  click(m, _event, pick, host) {
    if (!m.extra.picking) return;
    const plane = host.planeRefOf(pick);
    if (!plane) return host.say('The mouth of a hole can start at a plane or a planar face.', true);
    if (plane.kind === 'face' && plane.face.feature === m.draft.id) return host.say('The mouth cannot start at a face of the hole itself; pick a plane or a face that exists before it.', true);
    m.extra.picking = false;
    m.draft = { ...m.draft, extent: withFrom(m.draft.extent, plane) };
    host.say('The mouth starts from the plane picked.');
    draftChanged(host, true);
  },
  // Escape while the pick is armed disarms it and keeps the draft
  cancel(m, host) {
    if (!m.extra.picking) return false;
    m.extra.picking = false;
    host.say('The pick is off.');
    draftChanged(host, true);
    return true;
  },
};

// Arms the pick of the plane of the mouth in the view, or disarms it.
function arm(host: PanelHost, m: HoleMode): void {
  m.extra.picking = !m.extra.picking;
  host.say(m.extra.picking ? 'Click a plane or a planar face in the view: the mouth starts from its plane.' : 'The pick is off.');
  draftChanged(host, true);
}

// The shape of a hole in words, for the summary: "counterbore ⌀ 3.4 mm, head ⌀ 6 mm 3 mm deep".
function shapeText(f: HoleFeature): string {
  const { shape } = f;
  const value = (name: string, number: number) => `${shownValue(f, `shape/${name}`, number)}`;
  const bore = `⌀ ${value('diameter', shape.diameter)} mm`;
  if (shape.type === 'plain') return `plain ${bore}`;
  if (shape.type === 'counterbore') return `counterbore ${bore}, head ⌀ ${value('headDiameter', shape.headDiameter)} mm, ${value('headDepth', shape.headDepth)} mm deep`;
  if (shape.type === 'countersink') return `countersink ${bore}, head ⌀ ${value('headDiameter', shape.headDiameter)} mm, ${f.expressions?.['shape/angle'] ? `${f.expressions['shape/angle']} = ` : ''}${fmt((shape.angle * 180) / Math.PI)}°`;
  return `nut pocket ${bore}, ${value('acrossFlats', shape.acrossFlats)} mm across flats, ${value('headDepth', shape.headDepth)} mm deep`;
}

export const hole: FeatureUi<HoleFeature, Extra> = {
  button: { label: 'Hole', title: 'Holes for screws, nuts and inserts at points of a sketch' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, { shapes: {}, use: 'clearance', fit: 'medium', allowance: '' }),
  summary(host, f, result) {
    const from = f.extent.from ? ` from ${planeText(host, f.extent.from)}` : '';
    const extent = f.extent.type === 'distance' ? `depth ${shownValue(f, 'extent/distance', f.extent.distance)} mm${from}${f.extent.start !== 0 || f.expressions?.['extent/start'] ? `, start ${shownValue(f, 'extent/start', f.extent.start)} mm` : ''}` : `through all (${SIDES[f.extent.side].toLowerCase()})${from}`;
    const points = `${f.points.length} ${f.points.length === 1 ? 'point' : 'points'} of ${host.nameOf(f.sketch)}`;
    const out = [h('p', { className: 'hint' }, `${f.label ? `${f.label}: ` : ''}${shapeText(f)}; ${extent}; ${points}; bodies: ${f.targets.map((id) => host.bodyName(id)).join(', ')}.`)];
    const depth = result?.facts?.depth;
    if (typeof depth === 'number') out.push(h('p', { className: 'hint' }, `The hole is ${fmt(depth)} mm deep${typeof result?.facts?.headDepth === 'number' ? `, its head ${fmt(result.facts.headDepth)} mm` : ''}.`));
    const startAt = startText(result);
    if (startAt) out.push(h('p', { className: 'hint' }, `The mouth: ${startAt}.`));
    return out;
  },
  ownsFace: (feature, name) => name.feature === feature.id,
  // a hole has no body of its own
  hideable: () => false,
  form,
};
