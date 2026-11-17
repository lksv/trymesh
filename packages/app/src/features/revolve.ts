// The revolve in the app (D58): its form (the profile, regions of a sketch picked in the view with
// their offset or a wall along curves, the axis, the extent of a whole turn or an angle, the
// operation and the targets), its summary, and the axis it draws.
import { type Command, type Feature, type Id, type Input, type RevolveFeature, type SketchFeature, type Vec3 } from '@trymesh/engine';
import { fmt, h } from '../dom';
import { axisRows } from '../axis-picker';
import { COLOR } from '../draw';
import type { PanelHost } from '../host';
import { OPERATIONS, shownValue } from '../labels';
import { type AxisChange, axisText, changeAxis, lineIds } from '../sketch-commands';
import type { SceneModel } from '../viewport';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';
import { type DraftProfile, type ProfileChange, type ProfileHover, clickProfile, hoverProfile, profileOverlay, regionsFields, sketchRegions, wallFields } from './profile-picker';

export type RevolveDraft = Input<RevolveFeature>;
type ProfileDraft = RevolveDraft['profile'];
type AngleDraft = Extract<RevolveDraft['extent'], { type: 'angle' }>;
// What the form remembers beyond the draft: the pointer, the profile of each kind and the angle
// the draft had last, to return to.
interface Extra extends ProfileHover {
  profiles?: Partial<Record<ProfileDraft['type'], ProfileDraft>>;
  angle?: AngleDraft;
}
type RevolveMode = DraftMode<RevolveFeature, Extra>;

const NEW_ANGLE: AngleDraft = { type: 'angle', start: 0, angle: Math.PI / 2 };
const WALL_THICKNESS = 2; // mm: what a new wall starts with, as for an extrusion

// One change of the draft. `axis` is a change of the picker of the axis; the rest are the profile
// (as for an extrusion: another source returns to the profile of that kind the draft had last in
// the same sketch, another sketch picks again), the extent (`full` or `angle`, with `start` and
// `angle` of an angle), the operation and the targets (as for an extrusion).
export interface RevolveChange extends ProfileChange {
  source?: ProfileDraft['type'];
  sketch?: Id;
  axis?: AxisChange;
  extent?: RevolveDraft['extent']['type'];
  start?: number | string;
  angle?: number | string;
  operation?: RevolveFeature['operation'];
  target?: Id;
  toggleTarget?: Id;
}
interface Choices {
  bodies: Id[];
  sketches: Id[];
  lines: (sketch: Id) => Id[];
}
export function changeRevolve(draft: RevolveDraft, change: RevolveChange, choices: Choices, remembered: Extra = {}): RevolveDraft {
  const operation = change.operation ?? draft.operation;
  // the profile
  const sketch = change.sketch ?? draft.profile.sketch;
  let profile: ProfileDraft = draft.profile;
  if (change.source !== undefined && change.source !== profile.type) {
    const before = remembered.profiles?.[change.source];
    profile = before?.sketch === sketch ? before : change.source === 'regions' ? { type: 'regions', sketch, regions: [] } : { type: 'wall', sketch, curves: [], thickness: WALL_THICKNESS };
  }
  if (sketch !== profile.sketch) profile = profile.type === 'regions' ? { type: 'regions', sketch, regions: [] } : { ...profile, sketch, curves: [] };
  if (profile.type === 'regions') {
    // the offset is an optional field: it is in the draft only while it has a value
    const { offset: old, ...rest } = profile;
    const offset = change.offset === undefined ? old : change.offset;
    profile = { ...rest, ...(change.regions === undefined ? {} : { regions: change.regions }), ...(offset === undefined || offset === null ? {} : { offset }) };
  } else profile = { ...profile, ...(change.curves === undefined ? {} : { curves: [...change.curves].sort() }), ...(change.thickness === undefined ? {} : { thickness: change.thickness }) };
  // the extent
  let extent = draft.extent;
  if (change.extent === 'full') extent = { type: 'full' };
  if (change.extent === 'angle' && extent.type !== 'angle') extent = remembered.angle ?? NEW_ANGLE;
  if (extent.type === 'angle') extent = { ...extent, ...(change.start === undefined ? {} : { start: change.start }), ...(change.angle === undefined ? {} : { angle: change.angle }) };
  // the targets, as for an extrusion
  let targets = change.target === undefined ? draft.targets : [change.target];
  if (change.toggleTarget !== undefined) targets = targets?.includes(change.toggleTarget) ? targets.filter((id) => id !== change.toggleTarget) : [...(targets ?? []), change.toggleTarget];
  if (operation === 'add' && targets && targets.length > 1) targets = targets.slice(0, 1);
  if (operation === 'add' && targets?.length === 0) targets = undefined;
  if (operation !== 'new' && targets === undefined && choices.bodies.length > 0) targets = [choices.bodies[choices.bodies.length - 1]];
  const { targets: _old, ...rest } = draft;
  return {
    ...rest,
    profile,
    axis: change.axis ? changeAxis(draft.axis, change.axis, choices.sketches, choices.lines) : draft.axis,
    extent,
    operation,
    ...(operation === 'new' || targets === undefined ? {} : { targets }),
  };
}

// The command of the draft. A change of a feature merges with it, so the offset the draft no
// longer has is removed by name; the rest of the profile, the axis and the extent are whole.
export function revolveCommand(draft: RevolveDraft, editing: boolean, index: number): Command {
  if (!editing) return { type: 'addFeature', feature: draft, index };
  const { id, operation, targets } = draft;
  const profile = draft.profile.type === 'regions' ? { ...draft.profile, offset: draft.profile.offset ?? null } : draft.profile;
  return { type: 'updateFeature', id, patch: { profile, axis: draft.axis, extent: draft.extent, operation, ...(operation === 'new' || targets === undefined ? {} : { targets }) } };
}

// The default axis of a new revolve in a sketch: its first construction line; else the base axis
// that lies in the base plane of the sketch (Z for XZ and YZ, Y for XY); else its first line; else
// Z, which the preview then reports as an axis outside the plane.
export function defaultAxis(sketch: SketchFeature): RevolveFeature['axis'] {
  const lines = Object.entries(sketch.curves).filter(([, curve]) => curve.type === 'line');
  const construction = lines.find(([, curve]) => curve.construction);
  if (construction) return { kind: 'sketchLine', sketch: sketch.id, line: construction[0] };
  if (sketch.plane.kind === 'base') return { kind: 'base', axis: sketch.plane.plane === 'XY' ? 'Y' : 'Z' };
  if (lines.length) return { kind: 'sketchLine', sketch: sketch.id, line: lines[0][0] };
  return { kind: 'base', axis: 'Z' };
}

const sketchesBefore = (host: PanelHost, index: number): SketchFeature[] => host.doc.features.slice(0, index).filter((f): f is SketchFeature => f.type === 'sketch');
const linesOf = (host: PanelHost) => (sketch: Id): Id[] => {
  const f = host.feature(sketch);
  return f?.type === 'sketch' ? lineIds(f) : [];
};
// a profile of regions without a region, a wall without a curve: nothing to compute yet
const unpicked = (draft: RevolveDraft): boolean => (draft.profile.type === 'regions' ? draft.profile.regions.length === 0 : draft.profile.curves.length === 0);

// The facts of the preview or of the feature: the number of steps of the turn.
const stepsText = (result: { facts?: Record<string, unknown> } | undefined): string => (typeof result?.facts?.steps === 'number' ? `The turn is divided into ${result.facts.steps} steps.` : '');

function revolvePanel(m: RevolveMode, host: PanelHost): HTMLElement[] {
  const sketches = sketchesBefore(host, m.index);
  const bodies = Object.keys(host.stateBefore(m.index).evaluation.bodies);
  const choices: Choices = { bodies, sketches: sketches.map((f) => f.id), lines: linesOf(host) };
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const select = (label: string, change: (value: string) => void, ...options: (HTMLElement | null)[]) => h('label', {}, label, h('select', { onchange: (event: Event) => change((event.target as HTMLSelectElement).value) }, ...options));
  const set = (change: RevolveChange, rebuild = true) => {
    m.extra.profiles = { ...m.extra.profiles, [m.draft.profile.type]: m.draft.profile };
    if (m.draft.extent.type === 'angle') m.extra.angle = m.draft.extent;
    m.draft = changeRevolve(m.draft, change, choices, m.extra);
    draftChanged(host, rebuild);
  };
  const { profile, extent } = m.draft;
  const targets = m.draft.targets ?? [];
  const missing = targets.filter((id) => !bodies.includes(id));
  return [
    h('h2', {}, m.editing ? `Úprava: ${m.draft.name}` : 'New revolve'),
    select(
      'Profile',
      (value) => {
        set({ source: value as ProfileDraft['type'] });
        host.say(value === 'wall' ? 'Click curves of the sketch in the view: the wall follows them.' : 'Click regions of the sketch in the view to pick them.');
      },
      option('regions', 'Sketch regions', profile.type === 'regions'),
      option('wall', 'Wall along curves', profile.type === 'wall'),
    ),
    select('Sketch', (value) => set({ sketch: value }), ...sketches.map((f) => option(f.id, f.name, f.id === profile.sketch)), sketches.some((f) => f.id === profile.sketch) ? null : option(profile.sketch, `${profile.sketch} (missing)`, true)),
    ...(profile.type === 'regions' ? regionsFields(host, m, profile, set) : wallFields(host, m, profile, set)),
    ...axisRows(host, m.draft.axis as RevolveFeature['axis'], choices.sketches, (axis) => set({ axis }), 'A line of a sketch can be the axis once a sketch before this place of the timeline has one.'),
    h('p', { className: 'hint' }, 'The axis has to lie in the plane of the sketch, with the profile on one side of it.'),
    select('Extent', (value) => set({ extent: value as RevolveDraft['extent']['type'] }), option('full', 'Whole turn', extent.type === 'full'), option('angle', 'Angle', extent.type === 'angle')),
    ...(extent.type === 'angle'
      ? [
          draftField(host, m, 'Start angle (° or an expression in radians; from the sketch plane)', 'extent/start', (start) => set({ start }, false)),
          draftField(host, m, 'Angle (° or an expression in radians; negative turns the other way)', 'extent/angle', (angle) => set({ angle }, false)),
        ]
      : []),
    select('Operace', (value) => set({ operation: value as RevolveFeature['operation'] }), ...(Object.keys(OPERATIONS) as RevolveFeature['operation'][]).map((operation) => option(operation, OPERATIONS[operation], operation === m.draft.operation))),
    m.draft.operation === 'add' ? select('Těleso', (value) => set({ target: value }), ...bodies.map((body) => option(body, host.bodyName(body), body === targets[0])), ...missing.map((body) => option(body, '(chybí)', true))) : null,
    m.draft.operation === 'cut'
      ? h(
          'fieldset',
          { className: 'targets' },
          h('legend', {}, 'Target bodies'),
          ...[...bodies, ...missing].map((body) => h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: targets.includes(body), onchange: () => set({ toggleTarget: body }) }), bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`)),
          bodies.length === 0 && missing.length === 0 ? h('p', { className: 'hint' }, 'There is no body to cut yet.') : null,
        )
      : null,
    h('p', { id: 'draft-facts', className: 'hint' }, stepsText(m.preview?.evaluation.features[m.draft.id])),
    ...draftButtons(host, m),
  ].filter((element): element is HTMLElement => element !== null);
}

// The axis the preview used, drawn through the profile: from the facts of the feature.
function drawAxis(host: PanelHost, result: { facts?: Record<string, unknown> } | undefined, sketch: Id, scene: SceneModel): void {
  const point = result?.facts?.axisPoint as Vec3 | undefined;
  const direction = result?.facts?.axisDirection as Vec3 | undefined;
  const info = sketchRegions(host, sketch);
  if (!point || !direction || !info) return;
  // as far along the axis as the regions of the sketch reach, and a little more
  let [low, high] = [0, 0];
  for (const region of info.result.regions) {
    for (const loop of region.loops) {
      for (let i = 0; i < loop.length; i += 2) {
        const at = [0, 1, 2].map((k) => info.frame.origin[k] + loop[i] * info.frame.x[k] + loop[i + 1] * info.frame.y[k]);
        const t = (at[0] - point[0]) * direction[0] + (at[1] - point[1]) * direction[1] + (at[2] - point[2]) * direction[2];
        [low, high] = [Math.min(low, t), Math.max(high, t)];
      }
    }
  }
  const margin = 0.1 * (high - low) + 1;
  const end = (t: number): number[] => point.map((value, k) => value + direction[k] * t);
  scene.lines.push({ segments: [...end(low - margin), ...end(high + margin)], color: COLOR.region, width: 2, onTop: true });
}

const form: FeatureForm<RevolveFeature, Extra> = {
  draft(host, at) {
    const sketches = sketchesBefore(host, at.index);
    const chosen = sketches.find((f) => f.id === host.selectedFeature) ?? sketches[sketches.length - 1];
    if (!chosen) return { problem: 'A revolve needs a sketch with the profile. Draw one first.' };
    const id = host.newId('r');
    const regions = sketchRegions(host, chosen.id)?.result.regions ?? [];
    const bodies = Object.keys(host.stateBefore(at.index).evaluation.bodies);
    // a sketch on a face of a body proposes an addition to it, as for an extrusion
    const target = chosen.plane.kind === 'face' && bodies.includes(chosen.plane.body) ? chosen.plane.body : undefined;
    return {
      draft: {
        id,
        name: `Revolve ${id.slice(1)}`,
        suppressed: false,
        type: 'revolve',
        profile: { type: 'regions', sketch: chosen.id, regions: regions.length === 1 ? [regions[0].ref] : [] },
        axis: defaultAxis(chosen),
        extent: { type: 'full' },
        operation: target ? 'add' : 'new',
        ...(target ? { targets: [target] } : {}),
      },
      extra: {},
      say: 'Click regions of the sketch in the view to pick them.',
    };
  },
  command: revolveCommand,
  incomplete: unpicked,
  panel: revolvePanel,
  live(m) {
    const facts = document.getElementById('draft-facts');
    if (facts) facts.textContent = stepsText(m.preview?.evaluation.features[m.draft.id]);
  },
  hover: (m, event, _pick, host) => hoverProfile(host, event, m.draft.profile as DraftProfile, m.extra),
  click(m, event, _pick, host) {
    const profile = clickProfile(host, event, m.draft.profile as DraftProfile);
    if (!profile || profile.type === 'generated') return;
    m.draft = { ...m.draft, profile };
    draftChanged(host);
  },
  overlay(m, scene, host) {
    profileOverlay(host, m.draft.profile as DraftProfile, m.extra, scene);
    drawAxis(host, m.preview?.evaluation.features[m.draft.id], m.draft.profile.sketch, scene);
  },
};

export const revolve: FeatureUi<RevolveFeature, Extra> = {
  button: { label: 'Revolve', title: 'Turn regions of a sketch about an axis in its plane' },
  create: { run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary(host, f) {
    const extent = f.extent.type === 'full' ? 'a whole turn' : `by ${shownDegrees(f, 'extent/angle', f.extent.angle)}${f.extent.start !== 0 || f.expressions?.['extent/start'] ? ` from ${shownDegrees(f, 'extent/start', f.extent.start)}` : ''}`;
    const offset = f.profile.type === 'regions' && f.profile.offset !== undefined ? `, offset ${shownValue(f, 'profile/offset', f.profile.offset)} mm` : '';
    const profile = f.profile.type === 'regions' ? `regions: ${f.profile.regions.length}${offset}` : `a wall ${shownValue(f, 'profile/thickness', f.profile.thickness)} mm thick along ${f.profile.curves.join(', ')}`;
    const targets = f.targets?.length ? `, bodies: ${f.targets.map((id) => host.bodyName(id)).join(', ')}` : '';
    const out = [h('p', { className: 'hint' }, `Revolve of ${host.nameOf(f.profile.sketch)} about ${axisText(f.axis, (id) => host.nameOf(id))}, ${extent}; ${OPERATIONS[f.operation]}, ${profile}${targets}.`)];
    const steps = stepsText(host.view().evaluation.features[f.id]);
    if (steps) out.push(h('p', { className: 'hint' }, steps));
    return out;
  },
  ownsFace: (feature, name) => name.feature === feature.id,
  hideable: (feature) => feature.operation === 'new',
  form,
};

// An angle of a summary in degrees, with its expression.
const shownDegrees = (f: Feature, path: string, value: number): string => (f.expressions?.[path] ? `${f.expressions[path]} = ${fmt((value * 180) / Math.PI)}°` : `${fmt((value * 180) / Math.PI)}°`);
