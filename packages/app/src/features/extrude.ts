// The extrusion in the app: its form with the profile (regions of a sketch picked in the view, or
// a profile generator of the catalog), the extent and the targets; its summary; what it draws.
import { type ExtrudeFeature, GENERATORS, type GeneratorName, type Frame, type Id, type RegionRef, type SketchFeature, type SketchResult, generatorOf, isFlag } from '@trymesh/engine';
import { fmt, h } from '../dom';
import { COLOR } from '../draw';
import type { PanelHost } from '../host';
import { OPERATIONS, SIDES, factsText, shownValue } from '../labels';
import { type ExtentKind, type ExtentSide, type ExtrudeChange, type ExtrudeDraft, type ProfileKind, type RememberedProfiles, changeExtrude, draftCommand, profileKind, rememberedProfile } from '../sketch-commands';
import { insideLoop } from '../sketch-view';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

// What the form remembers beyond the draft.
interface Extra {
  distance?: ExtrudeDraft['extent']; // the distance extent the draft had last, to return to from "through all"
  profiles?: RememberedProfiles; // the profile of each kind the draft had last, to return to from the other source
  hover?: RegionRef; // the region under the pointer
}
type ExtrudeMode = DraftMode<ExtrudeFeature, Extra>;

const EXTENTS: Record<ExtentKind, string> = { distance: 'Distance', throughAll: 'Through all' };
const sameRegion = (a: RegionRef, b: RegionRef): boolean => a.outerLoop.length === b.outerLoop.length && a.outerLoop.every((id, i) => id === b.outerLoop[i]);

function sketchRegions(host: PanelHost, id: Id): { result: SketchResult; frame: Frame } | undefined {
  if (!host.feature(id)) return undefined; // skica vysunutí mohla být smazána
  const result = host.engine.getState(id).evaluation.features[id];
  return result?.sketch && result.plane ? { result: result.sketch, frame: result.plane } : undefined;
}

function regionAt(host: PanelHost, event: PointerEvent, m: ExtrudeMode): RegionRef | undefined {
  const info = sketchRegions(host, m.draft.profile.sketch);
  const p = info && host.planePoint(event, info.frame)?.at;
  if (!info || !p) return undefined;
  return info.result.regions.find((region) => insideLoop(region.loops[0], p) && !region.loops.slice(1).some((hole) => insideLoop(hole, p)))?.ref;
}

// Výchozí volby: jediná oblast se vybere sama; skica na stěně tělesa navrhne přidání k němu.
function extrudeDefaults(host: PanelHost, sketch: SketchFeature, index: number): Pick<ExtrudeFeature, 'profile' | 'operation' | 'targets'> {
  const regions = sketchRegions(host, sketch.id)?.result.regions ?? [];
  const bodies = Object.keys(host.stateBefore(index).evaluation.bodies);
  const target = sketch.plane.kind === 'face' && bodies.includes(sketch.plane.body) ? sketch.plane.body : undefined;
  return { profile: { type: 'regions', sketch: sketch.id, regions: regions.length === 1 ? [regions[0].ref] : [] }, operation: target ? 'add' : 'new', ...(target ? { targets: [target] } : {}) };
}

// A draft with a profile of regions and none picked yet: there is nothing to compute.
const unpicked = (draft: ExtrudeDraft): boolean => draft.profile.type === 'regions' && draft.profile.regions.length === 0;

// Entities of a sketch a generator operand accepts: own curves and projected ones of the given kinds.
function operandChoices(host: PanelHost, sketch: Id, kinds: readonly string[]): { id: Id; label: string }[] {
  const f = host.feature(sketch);
  if (f?.type !== 'sketch') return [];
  const radii = sketchRegions(host, sketch)?.result.radii ?? {};
  const size = (id: Id): string => (radii[id] === undefined ? '' : ` ⌀ ${fmt(2 * radii[id])}`);
  return [
    ...Object.entries(f.curves).filter(([, curve]) => kinds.includes(curve.type)).map(([id, curve]) => ({ id, label: `${id}${size(id)}${curve.construction ? ' (construction)' : ''}` })),
    ...Object.entries(f.external).filter(([, ref]) => kinds.includes(ref.kind)).map(([id]) => ({ id, label: `${id}${size(id)} (projected)` })),
  ];
}
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
    m.extra.profiles = { ...m.extra.profiles, [profileKind(m.draft.profile)]: m.draft.profile };
    m.draft = changeExtrude(m.draft, change, bodies, m.extra.distance, m.extra.profiles);
    draftChanged(host, rebuild);
  };
  const targets = m.draft.targets ?? [];
  const missing = targets.filter((id) => !bodies.includes(id));
  const extent = m.draft.extent;
  const cut = m.draft.operation === 'cut';
  const profile = m.draft.profile;
  const kind = profileKind(profile);
  // another sketch: the regions are picked again and the operands of a generator are found in it
  const toSketch = (sketch: Id): ExtrudeChange => (profile.type === 'regions' ? { sketch, regions: [] } : { sketch, operands: defaultOperands(host, profile.generator, sketch) });
  // a source the draft already had in this sketch comes back as it was; a new one finds its operands
  const toSource = (source: ProfileKind): ExtrudeChange => (source === 'regions' || rememberedProfile(m.extra.profiles ?? {}, source, profile.sketch) ? { source } : { source, operands: defaultOperands(host, source, profile.sketch) });
  return [
    h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'Nové vysunutí'),
    // The profile: regions of the sketch, or a profile generator from the catalog.
    h(
      'label',
      {},
      'Profile',
      h(
        'select',
        { onchange: (event: Event) => set(toSource((event.target as HTMLSelectElement).value as ProfileKind)) },
        option('regions', 'Sketch regions', kind === 'regions'),
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
    ...(profile.type === 'regions' ? regionsFields(host, profile, set) : generatorFields(host, m, profile, set)),
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
    // The extent: a distance with a start, or through all targets (a cut only).
    h(
      'label',
      {},
      'Extent',
      h(
        'select',
        { onchange: (event: Event) => set({ extent: (event.target as HTMLSelectElement).value as ExtentKind }) },
        option('distance', EXTENTS.distance, extent.type === 'distance'),
        h('option', { value: 'throughAll', textContent: cut ? EXTENTS.throughAll : `${EXTENTS.throughAll} (a cut only)`, selected: extent.type === 'throughAll', disabled: !cut }),
      ),
    ),
    ...(extent.type === 'distance'
      ? [
          draftField(host, m, 'Start (mm or an expression; offset from the sketch plane along its normal)', 'extent/start', (start) => set({ start }, false)),
          draftField(host, m, 'Distance (mm or an expression; negative = against the normal)', 'extent/distance', (distance) => set({ distance }, false)),
        ]
      : [
          h(
            'label',
            {},
            'Side',
            h(
              'select',
              { onchange: (event: Event) => set({ side: (event.target as HTMLSelectElement).value as ExtentSide }) },
              ...(Object.keys(SIDES) as ExtentSide[]).map((side) => option(side, SIDES[side], side === extent.side)),
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

// The part of the extrusion form for a profile of sketch regions.
function regionsFields(host: PanelHost, profile: Extract<ExtrudeDraft['profile'], { type: 'regions' }>, set: (change: ExtrudeChange) => void): (HTMLElement | null)[] {
  const available = sketchRegions(host, profile.sketch)?.result.regions ?? [];
  const stale = profile.regions.filter((region) => !available.some((other) => sameRegion(other.ref, region))).length;
  return [
    h('p', { className: 'hint' }, `Vybraných oblastí: ${profile.regions.length}. Oblasti se vybírají kliknutím v pohledu.`),
    stale > 0 ? h('p', { className: 'issue warning' }, `${stale} z vybraných oblastí už ve skice není. Zrušte výběr a vyberte oblasti znovu.`) : null,
    h('div', { className: 'buttons' }, h('button', { textContent: 'Zrušit výběr oblastí', disabled: profile.regions.length === 0, onclick: () => set({ regions: [] }) })),
  ];
}

// The part of the extrusion form for a generated profile, built from the generator catalog:
// a select per operand, a field per number, a checkbox per flag and a select per reference.
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
          choices.some((choice) => choice.id === chosen) ? null : option(chosen ?? '', chosen === undefined ? '(none in the sketch)' : `${chosen} (missing)`, true),
        ),
      );
    }),
    ...Object.entries(spec.params).map(([name, param]) =>
      isFlag(param)
        ? h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: profile.params[name] === true, onchange: (event: Event) => set({ params: { [name]: (event.target as HTMLInputElement).checked } }) }), param.title)
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
  },
  // No pick of the view: the form finds the region of its sketch under the pointer itself.
  hover(m, event, _pick, host) {
    const region = m.draft.profile.type === 'regions' ? regionAt(host, event, m) : undefined;
    if ((region && m.extra.hover && sameRegion(region, m.extra.hover)) || region === m.extra.hover) return false;
    m.extra.hover = region;
    return true;
  },
  click(m, event, _pick, host) {
    const profile = m.draft.profile;
    const region = profile.type === 'regions' ? regionAt(host, event, m) : undefined; // a generated profile has no regions to pick
    if (!region || profile.type !== 'regions') return;
    const at = profile.regions.findIndex((r) => sameRegion(r, region));
    m.draft = { ...m.draft, profile: { ...profile, regions: at < 0 ? [...profile.regions, region] : profile.regions.filter((_, i) => i !== at) } };
    draftChanged(host);
  },
  overlay(m, scene, host) {
    const info = sketchRegions(host, m.draft.profile.sketch);
    const picked = m.draft.profile.type === 'regions' ? m.draft.profile.regions : undefined; // a generated profile shows no regions
    for (const region of picked ? (info?.result.regions ?? []) : []) {
      const chosen = picked!.some((r) => sameRegion(r, region.ref));
      const hovered = m.extra.hover !== undefined && sameRegion(m.extra.hover, region.ref);
      scene.fills.push({ frame: info!.frame, loops: region.loops, color: chosen ? COLOR.region : hovered ? COLOR.hover : COLOR.rubber, opacity: chosen ? (hovered ? 0.6 : 0.45) : hovered ? 0.35 : 0.15, onTop: true });
    }
  },
};

export const extrude: FeatureUi<ExtrudeFeature, Extra> = {
  button: { label: 'Vysunutí', title: 'Vysunout oblasti skici' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const start = f.extent.type === 'distance' && (f.extent.start !== 0 || f.expressions?.['extent/start']) ? `, start ${shownValue(f, 'extent/start', f.extent.start)} mm` : '';
    const extent = f.extent.type === 'distance' ? `distance ${shownValue(f, 'extent/distance', f.extent.distance)} mm${start}` : `through all (${SIDES[f.extent.side].toLowerCase()})`;
    const targets = f.targets?.length ? `, bodies: ${f.targets.map((id) => host.bodyName(id)).join(', ')}` : '';
    const profile = f.profile.type === 'regions' ? `regions: ${f.profile.regions.length}` : `${GENERATORS[f.profile.generator].title.toLowerCase()} over ${Object.values(f.profile.operands).join(', ')}`;
    const out = [h('p', { className: 'hint' }, `${OPERATIONS[f.operation]}, ${extent}, ${profile}${targets}.`)];
    const facts = factsText(f, host.view().evaluation.features[f.id]);
    if (facts) out.push(h('p', { className: 'hint' }, facts));
    return out;
  },
  ownsFace: (feature, name) => name.feature === feature.id,
  // an addition and a cut have no body of their own: a body is hidden at the feature that created it
  hideable: (feature) => feature.operation === 'new',
  form,
};
