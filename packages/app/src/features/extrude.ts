// The extrusion in the app: its form with the profile (regions of a sketch picked in the view and
// their offset, a wall along curves of a sketch picked in the view, or a profile generator of the
// catalog), the extent and the targets; its summary; what it draws.
import { type ExtrudeFeature, GENERATORS, type GeneratorName, type Id, type PlaneRef, type RegionRef, type SketchFeature, generatorOf, isFlag } from '@trymesh/engine';
import { fmt, h } from '../dom';
import type { PanelHost } from '../host';
import { OPERATIONS, SIDES, factsText, lengthText, shownValue, startText } from '../labels';
import { entryEntities, omittedNotes, unlistedLabel } from '../references';
import { type ExtentKind, type ExtentSide, type ExtrudeChange, type ExtrudeDraft, type ProfileKind, type RememberedProfiles, type UpToDraft, changeExtrude, draftCommand, noPlane, profileKind, rememberedProfile } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';
import { planeText } from './plane';
import { clickProfile, hoverProfile, profileOverlay, regionsFields, sketchRegions, wallFields } from './profile-picker';

// What the form remembers beyond the draft.
interface Extra {
  distance?: ExtrudeDraft['extent']; // the distance extent the draft had last, to return to from "through all"
  upTo?: UpToDraft; // the extent up to a plane the draft had last, to return to
  // a button "Pick" is armed: the next click in the view takes a plane or a planar face, for the
  // start of the extent (`from`, D66) or for the end of an extent up to a plane
  picking?: 'start' | 'end';
  profiles?: RememberedProfiles; // the profile of each kind the draft had last, to return to from the other source
  hover?: RegionRef; // the region under the pointer
  hoverCurve?: Id; // the curve under the pointer, for a wall
}
type ExtrudeMode = DraftMode<ExtrudeFeature, Extra>;

const EXTENTS: Record<ExtentKind, string> = { distance: 'Distance', throughAll: 'Through all', upTo: 'Up to a plane or face' };

// Výchozí volby: jediná oblast se vybere sama; skica na stěně tělesa navrhne přidání k němu.
function extrudeDefaults(host: PanelHost, sketch: SketchFeature, index: number): Pick<ExtrudeFeature, 'profile' | 'operation' | 'targets'> {
  const regions = sketchRegions(host, sketch.id)?.result.regions ?? [];
  const bodies = Object.keys(host.stateBefore(index).evaluation.bodies);
  const target = sketch.plane.kind === 'face' && bodies.includes(sketch.plane.body) ? sketch.plane.body : undefined;
  return { profile: { type: 'regions', sketch: sketch.id, regions: regions.length === 1 ? [regions[0].ref] : [] }, operation: target ? 'add' : 'new', ...(target ? { targets: [target] } : {}) };
}

// A draft with a profile of regions and none picked yet, or a wall without a curve: there is
// nothing to compute.
// An extent up to a plane without its plane is not complete either.
const unpicked = (draft: ExtrudeDraft): boolean => (draft.profile.type === 'regions' && draft.profile.regions.length === 0) || (draft.profile.type === 'wall' && draft.profile.curves.length === 0) || noPlane(draft.extent);

// Entities of a sketch a generator operand accepts: own curves and projected ones of the given
// kinds; for a point the origin, own points and the points of projected geometry.
function operandChoices(host: PanelHost, sketch: Id, kinds: readonly string[]): { id: Id; label: string }[] {
  const f = host.feature(sketch);
  if (f?.type !== 'sketch') return [];
  const radii = sketchRegions(host, sketch)?.result.radii ?? {};
  const size = (id: Id): string => (radii[id] === undefined ? '' : ` ⌀ ${fmt(2 * radii[id])}`);
  const points = kinds.includes('point')
    ? [
        { id: 'origin', label: 'origin' },
        ...Object.keys(f.points).map((id) => ({ id, label: id })),
        ...entryEntities(f).filter((entity) => entity.kind === 'point').map((entity) => ({ id: entity.id, label: `${entity.id} (${entity.tag})` })),
      ]
    : [];
  return [
    ...points,
    ...Object.entries(f.curves).filter(([, curve]) => kinds.includes(curve.type)).map(([id, curve]) => ({ id, label: `${id}${size(id)}${curve.construction ? ' (construction)' : ''}` })),
    ...entryEntities(f).filter((entity) => entity.kind !== 'point' && kinds.includes(entity.kind)).map(({ id, tag }) => ({ id, label: `${id}${size(id)} (${tag})` })),
  ];
}
const sketchFeature = (host: PanelHost, id: Id): SketchFeature | undefined => {
  const f = host.feature(id);
  return f?.type === 'sketch' ? f : undefined;
};
// the copies of a mirror or pattern of the kinds that `operandChoices` leaves out (D68)
const omittedOf = (host: PanelHost, sketch: Id, kinds: readonly string[]): HTMLElement[] => {
  const f = sketchFeature(host, sketch);
  return f ? omittedNotes(f, (kind) => kinds.includes(kind)).map((text) => h('option', { value: '', textContent: text, disabled: true })) : [];
};
// The first entity of each operand of a generator in a sketch; an operand without one is left out
// and the engine says what is missing.
function defaultOperands(host: PanelHost, generator: GeneratorName, sketch: Id): Record<string, Id> {
  return Object.fromEntries(GENERATORS[generator].operands.flatMap((operand) => operandChoices(host, sketch, operand.kinds).slice(0, 1).map((choice) => [operand.field, choice.id])));
}

function extrudePanel(m: ExtrudeMode, host: PanelHost): HTMLElement[] {
  const sketches = host.doc.features.slice(0, m.index).filter((f) => f.type === 'sketch');
  const bodies = Object.keys(host.stateBefore(m.index).evaluation.bodies);
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const set = (change: ExtrudeChange, rebuild = true) => {
    // the distance extent the draft had last comes back when the extent or the operation returns to it
    if (m.draft.extent.type === 'distance') m.extra.distance = m.draft.extent;
    if (m.draft.extent.type === 'upTo') m.extra.upTo = m.draft.extent;
    m.extra.profiles = { ...m.extra.profiles, [profileKind(m.draft.profile)]: m.draft.profile };
    m.draft = changeExtrude(m.draft, change, bodies, m.extra.distance, m.extra.profiles, m.extra.upTo);
    // the pick of an end goes with the extent up to a plane; the pick of a start survives any change
    if (m.draft.extent.type !== 'upTo' && m.extra.picking === 'end') m.extra.picking = undefined;
    draftChanged(host, rebuild);
  };
  const targets = m.draft.targets ?? [];
  const missing = targets.filter((id) => !bodies.includes(id));
  const extent = m.draft.extent;
  const cut = m.draft.operation === 'cut';
  const profile = m.draft.profile;
  const kind = profileKind(profile);
  // another sketch: the regions and the curves of a wall are picked again and the operands of a generator are found in it
  const toSketch = (sketch: Id): ExtrudeChange => (profile.type === 'regions' ? { sketch, regions: [] } : profile.type === 'wall' ? { sketch, curves: [] } : { sketch, operands: defaultOperands(host, profile.generator, sketch) });
  // a source the draft already had in this sketch comes back as it was; a new generator finds its operands
  const toSource = (source: ProfileKind): ExtrudeChange =>
    source === 'regions' || source === 'wall' || rememberedProfile(m.extra.profiles ?? {}, source, profile.sketch) ? { source } : { source, operands: defaultOperands(host, source, profile.sketch) };
  return [
    h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'Nové vysunutí'),
    // The profile: regions of the sketch, a wall along its curves, or a profile generator from the catalog.
    h(
      'label',
      {},
      'Profile',
      h(
        'select',
        {
          onchange: (event: Event) => {
            const source = (event.target as HTMLSelectElement).value as ProfileKind;
            set(toSource(source));
            // what a click in the view picks now
            if (source === 'wall') host.say('Click curves of the sketch in the view: the wall follows them.');
            else if (source === 'regions') host.say('Klikáním v pohledu vyberte oblasti skici.');
          },
        },
        option('regions', 'Sketch regions', kind === 'regions'),
        option('wall', 'Wall along curves', kind === 'wall'),
        ...(Object.keys(GENERATORS) as GeneratorName[]).map((generator) => option(generator, GENERATORS[generator].title, kind === generator)),
      ),
    ),
    h(
      'label',
      {},
      'Skica',
      h(
        'select',
        { onchange: (event: Event) => set(toSketch((event.target as HTMLSelectElement).value)) },
        ...sketches.map((f) => option(f.id, f.name, f.id === profile.sketch)),
        sketches.some((f) => f.id === profile.sketch) ? null : option(profile.sketch, '(chybí)', true),
      ),
    ),
    ...(profile.type === 'regions' ? regionsFields(host, m, profile, set) : profile.type === 'wall' ? wallFields(host, m, profile, set) : generatorFields(host, m, profile, set)),
    h(
      'label',
      {},
      'Operace',
      h(
        'select',
        { onchange: (event: Event) => set({ operation: (event.target as HTMLSelectElement).value as ExtrudeFeature['operation'] }) },
        ...(Object.keys(OPERATIONS) as ExtrudeFeature['operation'][]).map((operation) => option(operation, OPERATIONS[operation], operation === m.draft.operation)),
      ),
    ),
    // The extent: a distance with a start, through all targets (a cut only), or up to a plane.
    h(
      'label',
      {},
      'Extent',
      h(
        'select',
        { onchange: (event: Event) => set({ extent: (event.target as HTMLSelectElement).value as ExtentKind }) },
        option('distance', EXTENTS.distance, extent.type === 'distance'),
        h('option', { value: 'throughAll', textContent: cut ? EXTENTS.throughAll : `${EXTENTS.throughAll} (a cut only)`, selected: extent.type === 'throughAll', disabled: !cut }),
        option('upTo', EXTENTS.upTo, extent.type === 'upTo'),
      ),
    ),
    ...startFields(host, m, set),
    ...(extent.type === 'distance'
      ? [
          draftField(host, m, startLabel(extent.from), 'extent/start', (start) => set({ start }, false)),
          draftField(host, m, 'Distance (mm or an expression; negative = against the normal)', 'extent/distance', (distance) => set({ distance }, false)),
          // a generated profile has no curves to move, so it has no taper
          m.draft.profile.type === 'generated'
            ? null
            : draftField(host, m, 'Taper (degrees or an expression; positive widens away from the start; empty = none)', 'extent/taper', (taper) => set({ taper: typeof taper === 'number' && Number.isNaN(taper) ? null : taper }, false)),
        ]
      : extent.type === 'upTo'
        ? upToFields(host, m, extent, set)
        : [
          h(
            'label',
            {},
            'Side',
            h(
              'select',
              { onchange: (event: Event) => set({ side: (event.target as HTMLSelectElement).value as ExtentSide }) },
              // from a plane, through all goes forward or backward
              ...(Object.keys(SIDES) as ExtentSide[]).map((side) => h('option', { value: side, textContent: SIDES[side], selected: side === extent.side, disabled: side === 'both' && extent.from !== undefined })),
            ),
          ),
          h('p', { className: 'hint' }, 'The length follows the target bodies at every recompute. On a face the normal points out of the body, so an ordinary hole goes against it.'),
        ]),
    m.draft.operation === 'add'
      ? h(
          'label',
          {},
          'Těleso',
          h(
            'select',
            { onchange: (event: Event) => set({ target: (event.target as HTMLSelectElement).value }) },
            ...bodies.map((body) => option(body, host.bodyName(body), body === targets[0])),
            ...missing.map((body) => option(body, '(chybí)', true)),
          ),
        )
      : null,
    // A cut may go through several bodies: one checkbox per body. A target that no longer exists
    // stays listed so that it can be unticked.
    cut
      ? h(
          'fieldset',
          { className: 'targets' },
          h('legend', {}, 'Target bodies'),
          ...[...bodies, ...missing].map((body) =>
            h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: targets.includes(body), onchange: () => set({ toggleTarget: body }) }), bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`),
          ),
          bodies.length === 0 && missing.length === 0 ? h('p', { className: 'hint' }, 'There is no body to cut yet.') : null,
        )
      : null,
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

// What a click in the view picks for the profile of the draft, said when a pick of a plane ends.
const clickHint = (draft: ExtrudeDraft): string =>
  draft.profile.type === 'wall' ? 'Click curves of the sketch in the view: the wall follows them.' : draft.profile.type === 'regions' ? 'Click regions of the sketch in the view to pick them.' : '';

// Arms a pick of a plane in the view for the start or the end, or disarms it when it is armed.
function arm(host: PanelHost, m: ExtrudeMode, what: 'start' | 'end'): void {
  m.extra.picking = m.extra.picking === what ? undefined : what;
  // no region or curve stays highlighted while the view picks faces
  m.extra.hover = undefined;
  m.extra.hoverCurve = undefined;
  host.say(m.extra.picking === 'start' ? 'Click a plane or a planar face in the view: the extent starts from its plane.' : m.extra.picking === 'end' ? 'Click a plane or a planar face in the view: the extrusion ends in its plane.' : clickHint(m.draft));
  draftChanged(host, true);
}

// The label of the field of the start: from what the offset is measured.
const startLabel = (from: PlaneRef | undefined): string => (from ? 'Start (mm or an expression; offset from the start plane along the normal of the sketch)' : 'Start (mm or an expression; offset from the sketch plane along its normal)');

// The row "Start at" of every extent (D66): the sketch plane, or the plane picked in the view; the
// button that arms the pick, and with a plane the button that returns to the sketch plane.
function startFields(host: PanelHost, m: ExtrudeMode, set: (change: ExtrudeChange, rebuild?: boolean) => void): HTMLElement[] {
  const { from } = m.draft.extent;
  const rows: (HTMLElement | null)[] = [
    h('p', {}, `Start at: ${from ? planeText(host, from) : 'Sketch plane'}`),
    h(
      'div',
      { className: 'buttons' },
      h('button', { textContent: m.extra.picking === 'start' ? 'Picking the start… (click to stop)' : 'Pick the start', onclick: () => arm(host, m, 'start') }),
      from ? h('button', { textContent: 'Sketch plane', onclick: () => set({ from: null }) }) : null,
    ),
    from ? h('p', { id: 'draft-start', className: 'hint' }, startText(m.preview?.evaluation.features[m.draft.id])) : null,
  ];
  return rows.filter((element): element is HTMLElement => element !== null);
}

// The part of the extrusion form for an extent up to a plane (D47): the start, the plane with the
// button that arms a pick in the view, the gap, and the length the preview got.
function upToFields(host: PanelHost, m: ExtrudeMode, extent: UpToDraft, set: (change: ExtrudeChange, rebuild?: boolean) => void): HTMLElement[] {
  return [
    draftField(host, m, startLabel(extent.from), 'extent/start', (start) => set({ start }, false)),
    h('p', {}, `Plane: ${extent.plane ? planeText(host, extent.plane) : 'none yet'}`),
    h('div', { className: 'buttons' }, h('button', { textContent: m.extra.picking === 'end' ? 'Picking… (click to stop)' : 'Pick', onclick: () => arm(host, m, 'end') })),
    draftField(host, m, 'Gap before the plane (mm or an expression; negative = past it; empty = none)', 'extent/gap', (gap) => set({ gap: typeof gap === 'number' && Number.isNaN(gap) ? null : gap }, false)),
    h('p', { className: 'hint' }, 'The tool ends in the plane of the face on whichever side it lies, also beside the face itself; the length follows the model.'),
    h('p', { id: 'draft-length', className: 'hint' }, lengthText(m.draft, m.preview?.evaluation.features[m.draft.id])),
  ];
}

// The part of the extrusion form for a generated profile, built from the generator catalog:
// a select per operand, a field per number, a checkbox per flag and a select per reference. An
// optional number is empty while the draft has none, and emptying it removes it.
function generatorFields(host: PanelHost, m: ExtrudeMode, profile: Extract<ExtrudeDraft['profile'], { type: 'generated' }>, set: (change: ExtrudeChange, rebuild?: boolean) => void): (HTMLElement | null)[] {
  const spec = GENERATORS[profile.generator];
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const earlier = host.doc.features.slice(0, m.index).filter((f) => f.id !== m.draft.id);
  return [
    ...spec.operands.map((operand) => {
      const choices = operandChoices(host, profile.sketch, operand.kinds);
      const chosen = profile.operands[operand.field];
      return h(
        'label',
        {},
        `${operand.field} (${operand.kinds.join(' or ')} of the sketch)`,
        h(
          'select',
          { onchange: (event: Event) => set({ operands: { [operand.field]: (event.target as HTMLSelectElement).value } }) },
          ...choices.map((choice) => option(choice.id, choice.label, choice.id === chosen)),
          choices.some((choice) => choice.id === chosen) ? null : option(chosen ?? '', chosen === undefined ? '(none in the sketch)' : unlistedLabel(sketchFeature(host, profile.sketch), chosen), true),
          ...omittedOf(host, profile.sketch, operand.kinds),
        ),
      );
    }),
    ...Object.entries(spec.params).map(([name, param]) =>
      isFlag(param)
        ? h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: profile.params[name] === true, onchange: (event: Event) => set({ params: { [name]: (event.target as HTMLInputElement).checked } }) }), param.title)
        : param.optional
          ? draftField(host, m, `${param.title} (${param.unit === 'rad' ? '° or an expression in radians' : param.unit === 'mm' ? 'mm or an expression' : 'a number or an expression'}; empty = ${param.default})`, `profile/params/${name}`, (value) => set({ params: { [name]: typeof value === 'number' && Number.isNaN(value) ? null : value } }, false))
          : draftField(host, m, `${param.title}${param.unit === 'rad' ? ' (° or an expression in radians)' : param.unit === 'mm' ? ' (mm or an expression)' : ''}`, `profile/params/${name}`, (value) => set({ params: { [name]: value } }, false)),
    ),
    ...Object.entries(spec.refs).map(([name, ref]) => {
      const choices = earlier.filter((f) => (ref.generators as readonly (string | undefined)[]).includes(generatorOf(f)));
      const chosen = profile.refs?.[name];
      return h(
        'label',
        { title: ref.summary },
        ref.title,
        h(
          'select',
          { onchange: (event: Event) => set({ refs: { [name]: (event.target as HTMLSelectElement).value || null } }) },
          option('', '(none)', chosen === undefined),
          ...choices.map((f) => option(f.id, f.name, f.id === chosen)),
          chosen === undefined || choices.some((f) => f.id === chosen) ? null : option(chosen, `${host.nameOf(chosen)} (missing)`, true),
        ),
      );
    }),
    h('p', { id: 'draft-facts', className: 'hint' }, factsText(m.draft, m.preview?.evaluation.features[m.draft.id])),
  ];
}

const form: FeatureForm<ExtrudeFeature, Extra> = {
  draft(host, at) {
    const sketches = host.doc.features.slice(0, at.index).filter((f): f is SketchFeature => f.type === 'sketch');
    const chosen = sketches.find((f) => f.id === host.selectedFeature) ?? sketches[sketches.length - 1];
    if (!chosen) return { problem: 'Vysunutí potřebuje skicu. Nejdřív nějakou nakreslete.' };
    const id = host.newId('e');
    return {
      draft: { id, name: `Vysunutí ${id.slice(1)}`, suppressed: false, type: 'extrude', extent: { type: 'distance', start: 0, distance: 10 }, ...extrudeDefaults(host, chosen, at.index) },
      extra: {},
      say: 'Klikáním v pohledu vyberte oblasti skici.',
    };
  },
  command: draftCommand,
  incomplete: unpicked,
  panel: extrudePanel,
  live(m, host) {
    const facts = document.getElementById('draft-facts');
    if (facts) facts.textContent = factsText(m.draft, m.preview?.evaluation.features[m.draft.id]);
    const length = document.getElementById('draft-length');
    if (length) length.textContent = lengthText(m.draft, m.preview?.evaluation.features[m.draft.id]);
    const start = document.getElementById('draft-start');
    if (start) start.textContent = startText(m.preview?.evaluation.features[m.draft.id]);
  },
  // a face or a plane while a button "Pick" is armed, otherwise nothing; for the start the view
  // shows the state before the feature, in which the plane is resolved
  picks: (m) => (m.extra.picking === 'start' ? { faces: true, planes: true, before: true } : m.extra.picking === 'end' ? { faces: true, planes: true } : undefined),
  // Escape while a pick is armed disarms it and keeps the draft
  cancel(m, host) {
    if (!m.extra.picking) return false;
    m.extra.picking = undefined;
    host.say(clickHint(m.draft));
    draftChanged(host, true);
    return true;
  },
  // No pick of the view: the form finds the region of its sketch under the pointer itself, and for
  // a wall the curve.
  hover: (m, event, _pick, host) => hoverProfile(host, event, m.draft.profile, m.extra),
  click(m, event, pick, host) {
    if (m.extra.picking) {
      const start = m.extra.picking === 'start';
      const plane = host.planeRefOf(pick);
      if (!plane) return host.say(start ? 'The extrusion can start at a plane or a planar face.' : 'The extrusion can end in a plane or a planar face.', true);
      // the view shows the preview while the end is picked: its own faces exist only after the extrusion
      if (plane.kind === 'face' && (plane.face.feature === m.draft.id || plane.body === m.draft.id)) return host.say(`The extrusion cannot ${start ? 'start at' : 'end in'} a face of its own; pick a plane or a face that exists before it.`, true);
      m.extra.picking = undefined;
      m.draft = changeExtrude(m.draft, start ? { from: plane } : { plane }, []);
      host.say(clickHint(m.draft));
      draftChanged(host, true);
      return;
    }
    const profile = clickProfile(host, event, m.draft.profile);
    if (!profile) return;
    m.draft = { ...m.draft, profile };
    draftChanged(host);
  },
  overlay: (m, scene, host) => profileOverlay(host, m.draft.profile, m.extra, scene),
};

export const extrude: FeatureUi<ExtrudeFeature, Extra> = {
  button: { label: 'Vysunutí', title: 'Vysunout oblasti skici' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const start = f.extent.type === 'distance' && (f.extent.start !== 0 || f.expressions?.['extent/start']) ? `, start ${shownValue(f, 'extent/start', f.extent.start)} mm` : '';
    const taper = f.extent.type === 'distance' && f.extent.taper !== undefined ? `, taper ${f.expressions?.['extent/taper'] ? `${f.expressions['extent/taper']} = ` : ''}${fmt((f.extent.taper * 180) / Math.PI)}°` : '';
    const gap = f.extent.type === 'upTo' && f.extent.gap !== undefined ? `, gap ${shownValue(f, 'extent/gap', f.extent.gap)} mm` : '';
    const upToStart = f.extent.type === 'upTo' && (f.extent.start !== 0 || f.expressions?.['extent/start']) ? `, start ${shownValue(f, 'extent/start', f.extent.start)} mm` : '';
    const from = f.extent.from ? ` from ${planeText(host, f.extent.from)}` : '';
    const extent =
      f.extent.type === 'distance'
        ? `distance ${shownValue(f, 'extent/distance', f.extent.distance)} mm${from}${start}${taper}`
        : f.extent.type === 'upTo'
          ? `up to ${planeText(host, f.extent.plane)}${from}${upToStart}${gap}`
          : `through all (${SIDES[f.extent.side].toLowerCase()})${from}`;
    const targets = f.targets?.length ? `, bodies: ${f.targets.map((id) => host.bodyName(id)).join(', ')}` : '';
    const offset = f.profile.type === 'regions' && f.profile.offset !== undefined ? `, offset ${shownValue(f, 'profile/offset', f.profile.offset)} mm` : '';
    const profile =
      f.profile.type === 'regions'
        ? `regions: ${f.profile.regions.length}${offset}`
        : f.profile.type === 'wall'
          ? `a wall ${shownValue(f, 'profile/thickness', f.profile.thickness)} mm thick along ${f.profile.curves.length === 1 ? 'the curve' : 'the curves'} ${f.profile.curves.join(', ')}`
          : `${GENERATORS[f.profile.generator].title} (${Object.entries(f.profile.operands).map(([field, id]) => `${field} ${id}`).join(', ')})`;
    const out = [h('p', { className: 'hint' }, `${OPERATIONS[f.operation]}, ${extent}, ${profile}${targets}.`)];
    const facts = factsText(f, host.view().evaluation.features[f.id]);
    if (facts) out.push(h('p', { className: 'hint' }, facts));
    const length = lengthText(f, host.view().evaluation.features[f.id]);
    if (length) out.push(h('p', { className: 'hint' }, length));
    const startAt = startText(host.view().evaluation.features[f.id]);
    if (startAt) out.push(h('p', { className: 'hint' }, startAt));
    return out;
  },
  ownsFace: (feature, name) => name.feature === feature.id,
  // an addition and a cut have no body of their own: a body is hidden at the feature that created it
  hideable: (feature) => feature.operation === 'new',
  form,
};
