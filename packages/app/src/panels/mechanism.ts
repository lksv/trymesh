// The panel of the mechanism (D49), in the model panel: the tree of links and joints (the roots
// first, a joint under its parent link and its child link under it), the bodies of every link, the
// bodies in no link, and what is wrong at the link or the joint it is about. A joint with a value
// has a field that takes an expression and a slider between its limits: dragging the slider
// previews the pose (the view shows the preview), releasing it writes it. The forms of a link and
// of a joint are in the panel too. Every confirmation is one command.
import { type AxisRef, type EngineState, type Expr, type Id, type Input, JOINT_FIELDS, type Joint, type JointResult, type MechanismResult, type Unit } from '@trymesh/engine';
import { axisRows } from '../axis-picker';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldNote, fieldText, parseField, plainNumber, valueText } from '../fields';
import type { PanelHost } from '../host';
import { changeAxis } from '../sketch-commands';

type JointType = Joint['type'];
type Limited = Extract<Joint, { lower: number }>;
type NumberPath = 'lower' | 'upper' | 'value';

// A link being made or changed: its ID, its name, its bodies (as ticked).
interface LinkForm {
  kind: 'link';
  editing: boolean;
  id: string;
  name: string;
  bodies: Id[];
}
// A joint being made or changed. The numbers are kept as typed, in the units of the form (degrees
// for an angle), and read when the form is confirmed.
interface JointForm {
  kind: 'joint';
  editing: boolean;
  id: string;
  name: string;
  type: JointType;
  parent: Id;
  child: Id;
  axis: AxisRef;
  numbers: Partial<Record<NumberPath, string>>;
}
// What the panel keeps between two renders; the app holds it. `preview`: the state of the pose
// a slider previews while it is dragged; the view shows it, and a refresh of the app drops it.
export interface MechanismPanel {
  form?: LinkForm | JointForm;
  preview?: EngineState;
}

const TYPES: Record<JointType, string> = { revolute: 'Revolute', continuous: 'Continuous (no limits)', prismatic: 'Prismatic (a slide)', fixed: 'Fixed' };
const own = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const unitOf = (type: JointType): Unit => (type === 'prismatic' ? 'mm' : 'rad');
const DEGREES = 180 / Math.PI;
// A number of a joint as the form and the slider show it: an angle in degrees.
const shown = (value: number, unit: Unit): number => (unit === 'rad' ? value * DEGREES : value);
const stored = (value: number, unit: Unit): number => (unit === 'rad' ? value / DEGREES : value);
const fieldLabel = (title: string, unit: Unit): string => `${title} (${unit === 'rad' ? '°' : 'mm'} or an expression${unit === 'rad' ? ' in radians' : ''})`;
// The defaults of the numbers of a new joint, as typed: a turn either way, a slide of 100 mm.
const DEFAULTS: Record<JointType, Partial<Record<NumberPath, string>>> = { revolute: { lower: '-180', upper: '180', value: '0' }, continuous: { value: '0' }, prismatic: { lower: '0', upper: '100', value: '0' }, fixed: {} };
// The range of the slider of a continuous joint, which has no limits: a turn either way, widened to
// the value when it is beyond.
const CONTINUOUS = Math.PI;

const linkName = (host: PanelHost, id: Id): string => {
  const link = own(host.doc.mechanism.links, id) ? host.doc.mechanism.links[id] : undefined;
  return link?.name ?? id;
};
const jointName = (host: PanelHost, id: Id): string => {
  const joint = own(host.doc.mechanism.joints, id) ? host.doc.mechanism.joints[id] : undefined;
  return joint?.name ?? id;
};

// The line of the status bar about the links the view draws out of their pose: the joint that has
// no motion, what is wrong with it, and the links beyond it, drawn with that joint at zero.
export function blockedNote(host: PanelHost, mechanism: MechanismResult): string {
  const by = new Map<Id, Id[]>();
  for (const [id, link] of Object.entries(mechanism.links)) if (link.blockedBy !== undefined) by.set(link.blockedBy, [...(by.get(link.blockedBy) ?? []), id]);
  return [...by]
    .map(([joint, links]) => {
      const error = own(mechanism.joints, joint) ? mechanism.joints[joint].error : undefined;
      return ` The joint ${jointName(host, joint)} has no motion${error ? ` (${host.issueText(error)})` : ''}: ${links.map((link) => linkName(host, link)).join(', ')} drawn with it at zero.`;
    })
    .join('');
}

// The value nearest to zero that the limits of a joint allow (zero itself wherever they contain it).
function nearestZero(joint: Joint, result: JointResult | undefined): number | undefined {
  if (joint.type === 'fixed') return undefined;
  if (joint.type === 'continuous') return 0;
  const lower = result?.lower ?? joint.lower;
  const upper = result?.upper ?? joint.upper;
  return lower > upper ? undefined : Math.min(Math.max(0, lower), upper);
}

export function mechanismPanel(host: PanelHost, panel: MechanismPanel): HTMLElement[] {
  const section = host.doc.mechanism;
  const { evaluation } = host.view();
  const result = evaluation.mechanism;
  if (Object.keys(section.links).length === 0 && Object.keys(evaluation.bodies).length === 0 && !panel.form) return [];
  const out: HTMLElement[] = [h('h2', {}, 'Mechanism')];
  if (Object.keys(section.links).length === 0) out.push(h('p', { className: 'hint' }, 'Links are bodies that move as one piece; a joint moves its child link against its parent. The model as modelled is the zero of every joint.'));

  // ----- the tree: the roots first, a joint under its parent link, its child link under the joint
  const shownLinks = new Set<Id>();
  const linkBlock = (id: Id): HTMLElement => {
    shownLinks.add(id);
    const link = section.links[id];
    const state = own(result.links, id) ? result.links[id] : undefined;
    const bodies = [...(state?.bodies ?? link.bodies.filter((body) => own(evaluation.bodies, body))).map((body) => host.bodyName(body)), ...(state?.missing ?? []).map((body) => `${body} (missing)`)];
    const children = Object.keys(section.joints).filter((joint) => section.joints[joint].parent === id && !shownLinks.has(section.joints[joint].child));
    return h(
      'div',
      { className: 'mech-link' },
      h(
        'div',
        { className: 'mech-head' },
        h('span', { className: 'name', textContent: link.name === undefined ? id : `${link.name} (${id})` }),
        h('button', { className: 'link', textContent: 'Edit', title: 'Change the name and the bodies of the link', onclick: () => openLink(host, panel, id) }),
        h('button', { className: 'link', textContent: 'Remove', title: 'Remove the link; a link a joint names cannot be removed', onclick: () => host.run({ type: 'removeLink', id }, `The link ${linkName(host, id)} removed.`) }),
      ),
      h('p', { className: 'hint' }, bodies.length ? `Bodies: ${bodies.join(', ')}` : 'No bodies.'),
      ...(state?.missing.length ? [h('p', { className: 'issue warning' }, `The model has no body ${state.missing.join(', ')}: the link lists it, and a body made under that ID will be in the link.`)] : []),
      ...(state?.blockedBy !== undefined ? [h('p', { className: 'issue warning' }, `Not in its pose: the joint ${jointName(host, state.blockedBy)} has no motion, so the link is drawn with that joint at zero and a query about its bodies fails.`)] : []),
      ...(children.length ? [h('div', { className: 'mech-children' }, ...children.map(jointBlock))] : []),
    );
  };
  const jointBlock = (id: Id): HTMLElement => {
    const joint = section.joints[id];
    const state = own(result.joints, id) ? result.joints[id] : undefined;
    const about = 'axis' in joint ? ` ${joint.type === 'prismatic' ? 'along' : 'about'} ${joint.axis.kind === 'base' ? `the axis ${joint.axis.axis}` : `the normal through ${joint.axis.point} of ${host.nameOf(joint.axis.sketch)}`}` : '';
    return h(
      'div',
      { className: `mech-joint ${state?.status === 'error' ? 'error' : ''}` },
      h(
        'div',
        { className: 'mech-head' },
        h('span', { className: 'name', textContent: `${joint.name === undefined ? id : `${joint.name} (${id})`}: ${TYPES[joint.type].replace(/ \(.*\)$/, '').toLowerCase()}${about}` }),
        h('button', { className: 'link', textContent: 'Edit', title: 'Change the joint', onclick: () => openJoint(host, panel, id) }),
        h('button', { className: 'link', textContent: 'Remove', title: 'Remove the joint; its child link then stands as modelled', onclick: () => host.run({ type: 'removeJoint', id }, `The joint ${jointName(host, id)} removed.`) }),
      ),
      ...poseControls(host, panel, id, joint, state),
      ...(state?.error ? [h('p', { className: 'issue error' }, host.issueText(state.error))] : []),
      ...Object.entries(state?.fieldErrors ?? {}).map(([path, error]) => h('p', { className: 'issue error' }, `${path}: ${error.message}`)),
      ...(own(section.links, joint.child) && !shownLinks.has(joint.child) ? [h('div', { className: 'mech-children' }, linkBlock(joint.child))] : []),
    );
  };
  const roots = result.roots.filter((id) => own(section.links, id));
  for (const id of roots) out.push(linkBlock(id));
  // a link the tree did not reach (the result of another state): listed on its own
  for (const id of Object.keys(section.links)) if (!shownLinks.has(id)) out.push(linkBlock(id));
  if (result.unassigned.length) out.push(h('p', { className: 'hint' }, `Bodies in no link (they stand as modelled): ${result.unassigned.map((body) => host.bodyName(body)).join(', ')}`));

  if (panel.form) out.push(...(panel.form.kind === 'link' ? linkForm(host, panel, panel.form) : jointForm(host, panel, panel.form)));
  else {
    const free = Object.entries(section.joints).some(([, joint]) => joint.type !== 'fixed' && joint.expressions?.value === undefined);
    out.push(
      h(
        'div',
        { className: 'buttons' },
        h('button', { textContent: 'New link', title: 'Bodies that move as one piece', onclick: () => openLink(host, panel) }),
        h('button', { textContent: 'New joint', title: 'A joint moves its child link against its parent link', disabled: Object.keys(section.links).length < 2, onclick: () => openJoint(host, panel) }),
        h('button', { textContent: 'Reset pose', title: 'Every value without an expression to zero, or as near to it as its limits allow', disabled: !free, onclick: () => resetPose(host) }),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------- the value of a joint

// The field of the value (a number, or an expression over the parameters) and the slider between
// the limits. The slider of a value with an expression is disabled: moving it would replace the
// expression, and with it a coupling, by a number. A fixed joint has no value.
function poseControls(host: PanelHost, panel: MechanismPanel, id: Id, joint: Joint, state: JointResult | undefined): HTMLElement[] {
  if (joint.type === 'fixed') return [];
  const unit = unitOf(joint.type);
  const spec = JOINT_FIELDS[joint.type].find((field) => field.path === 'value')?.spec;
  const expr = joint.expressions?.value;
  const value = state?.value ?? joint.value;
  const names = host.doc.parameters.map((p) => p.name);
  const input = h('input', {
    value: fieldText(expr ?? joint.value, unit),
    oninput: () => {
      const parsed = parseField(input.value, unit);
      markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
    },
    onchange: () => {
      const parsed = parseField(input.value, unit);
      if (parsed === undefined || !host.run({ type: 'setPose', values: { [id]: parsed } })) host.refresh();
    },
  });
  const note = expr !== undefined ? h('small', { className: 'computed' }, state?.fieldErrors?.value ? 'error' : fieldNote(expr, state?.value, unit)) : null;
  // the range of the slider: the limits, or a turn either way for a continuous joint
  const limits = joint.type === 'continuous' ? { lower: Math.min(-CONTINUOUS, value), upper: Math.max(CONTINUOUS, value) } : { lower: state?.lower ?? joint.lower, upper: state?.upper ?? joint.upper };
  const usable = limits.lower < limits.upper;
  const send = (): number => stored(Number(slider.value), unit);
  const slider = h('input', {
    type: 'range',
    className: 'pose',
    min: plainNumber(shown(limits.lower, unit)),
    max: plainNumber(shown(limits.upper, unit)),
    step: 'any',
    value: plainNumber(shown(value, unit)),
    disabled: expr !== undefined || !usable,
    title: expr !== undefined ? 'The value follows its expression; type a number into the field to set it by hand' : `${valueText(limits.lower, unit)} to ${valueText(limits.upper, unit)}${joint.type === 'continuous' ? ' (no limits; the slider spans a turn either way)' : ''}`,
    // dragging previews the pose at the marker; the view shows the preview, the panel stays
    oninput: () => {
      const pose = { type: 'setPose' as const, values: { [id]: send() } };
      const previewed = host.marker ? host.engine.preview(pose, host.marker) : host.engine.preview(pose);
      if (!previewed.ok) return;
      panel.preview = previewed.state;
      input.value = plainNumber(Number(slider.value));
      host.invalidate();
      host.renderScene();
    },
    // releasing writes it: one command, one step of undo
    onchange: () => {
      panel.preview = undefined;
      if (!host.run({ type: 'setPose', values: { [id]: send() } })) host.refresh();
    },
  });
  const limitText = joint.type === 'continuous' ? 'no limits' : `limits ${limitPart(joint, 'lower', state)} to ${limitPart(joint, 'upper', state)}`;
  return [h('label', {}, fieldLabel(spec?.title ?? 'Value', unit), h('span', { className: 'field' }, input, note)), h('label', { className: 'slider' }, h('span', { className: 'hint' }, `Pose, ${limitText}`), slider)];
}
const limitPart = (joint: Limited, path: 'lower' | 'upper', state: JointResult | undefined): string => {
  const unit = unitOf(joint.type);
  const expr = joint.expressions?.[path];
  const value = state?.[path] ?? joint[path];
  return expr === undefined ? valueText(value, unit) : `${expr} = ${valueText(value, unit)}`;
};

// One setPose: every value without an expression to the value nearest to zero its limits allow.
function resetPose(host: PanelHost): void {
  const { document: doc, evaluation } = host.engine.getState();
  const values: Record<Id, number> = {};
  for (const [id, joint] of Object.entries(doc.mechanism.joints)) {
    if (joint.type === 'fixed' || joint.expressions?.value !== undefined) continue;
    const target = nearestZero(joint, own(evaluation.mechanism.joints, id) ? evaluation.mechanism.joints[id] : undefined);
    if (target !== undefined && target !== joint.value) values[id] = target;
  }
  if (Object.keys(values).length === 0) return host.say('Every value without an expression is already as near to zero as its limits allow.');
  host.run({ type: 'setPose', values }, `Pose reset: ${Object.keys(values).map((id) => jointName(host, id)).join(', ')}.`);
}

// ---------------------------------------------------------------- the form of a link

function openLink(host: PanelHost, panel: MechanismPanel, id?: Id): void {
  const link = id === undefined ? undefined : host.doc.mechanism.links[id];
  panel.form = link && id !== undefined ? { kind: 'link', editing: true, id, name: link.name ?? '', bodies: [...link.bodies] } : { kind: 'link', editing: false, id: host.newId('link'), name: '', bodies: [] };
  host.renderPanel();
}

function linkForm(host: PanelHost, panel: MechanismPanel, form: LinkForm): HTMLElement[] {
  const section = host.doc.mechanism;
  const bodies = Object.keys(host.engine.getState().evaluation.bodies);
  // the bodies of the model, then those the link lists that the model does not have
  const offered = [...bodies, ...form.bodies.filter((body) => !bodies.includes(body))];
  const holder = (body: Id): Id | undefined => Object.keys(section.links).find((other) => other !== form.id && section.links[other].bodies.includes(body));
  const id = h('input', { value: form.id, disabled: form.editing, oninput: () => (form.id = id.value.trim()) });
  const name = h('input', { value: form.name, placeholder: form.id, oninput: () => (form.name = name.value) });
  const box = (body: Id): HTMLElement => {
    const other = holder(body);
    const input = h('input', {
      type: 'checkbox',
      checked: form.bodies.includes(body),
      onchange: () => (form.bodies = input.checked ? [...form.bodies, body] : form.bodies.filter((listed) => listed !== body)),
    });
    return h('label', { className: 'check' }, input, `${bodies.includes(body) ? host.bodyName(body) : `${body} (missing)`}${other === undefined ? '' : ` (moves from ${linkName(host, other)})`}`);
  };
  return [
    h('h2', {}, form.editing ? `Link ${linkName(host, form.id)}` : 'New link'),
    h('label', {}, 'ID', id),
    h('label', {}, 'Name (empty: the ID)', name),
    h('fieldset', { className: 'targets' }, h('legend', {}, 'Bodies'), ...offered.map(box), offered.length === 0 ? h('p', { className: 'hint' }, 'The model has no body yet.') : null),
    h('div', { className: 'buttons' }, h('button', { className: 'primary', textContent: 'OK', onclick: () => confirmLink(host, panel, form) }), h('button', { textContent: 'Cancel', onclick: () => ((panel.form = undefined), host.renderPanel()) })),
  ];
}

// One command: setLink, in a batch with the links that give up a body it takes.
function confirmLink(host: PanelHost, panel: MechanismPanel, form: LinkForm): void {
  const section = host.doc.mechanism;
  const old = own(section.links, form.id) ? section.links[form.id] : undefined;
  const name = form.name.trim();
  const set = { type: 'setLink' as const, id: form.id, ...(name !== '' ? { name } : old?.name !== undefined ? { name: null } : {}), bodies: form.bodies };
  const givers = Object.keys(section.links).filter((other) => other !== form.id && section.links[other].bodies.some((body) => form.bodies.includes(body)));
  const takeOut = givers.map((other) => ({ type: 'setLink' as const, id: other, bodies: section.links[other].bodies.filter((body) => !form.bodies.includes(body)) }));
  panel.form = undefined;
  const done = `${old ? 'The link' : 'A link'} ${name || form.id}${old ? ' changed' : ' made'}${givers.length ? `; taken from ${givers.map((other) => linkName(host, other)).join(', ')}` : ''}.`;
  if (!host.run(takeOut.length ? { type: 'batch', commands: [...takeOut, set] } : set, done)) panel.form = form; // refused: the form stays with the reason in the status line
}

// ---------------------------------------------------------------- the form of a joint

function openJoint(host: PanelHost, panel: MechanismPanel, id?: Id): void {
  const section = host.doc.mechanism;
  const joint = id === undefined ? undefined : section.joints[id];
  if (joint && id !== undefined) {
    const unit = unitOf(joint.type);
    const numbers = Object.fromEntries(JOINT_FIELDS[joint.type].map(({ path }) => [path, fieldText(joint.expressions?.[path as NumberPath] ?? (joint as unknown as Record<string, number>)[path], unit)]));
    panel.form = { kind: 'joint', editing: true, id, name: joint.name ?? '', type: joint.type, parent: joint.parent, child: joint.child, axis: 'axis' in joint ? joint.axis : { kind: 'base', axis: 'Z' }, numbers };
  } else {
    // the parent: the first link; the child: the first other link that hangs on no joint yet
    const links = Object.keys(section.links);
    const hanging = new Set(Object.values(section.joints).map((joint) => joint.child));
    const parent = links[0] ?? '';
    const child = links.find((link) => link !== parent && !hanging.has(link)) ?? links.find((link) => link !== parent) ?? '';
    panel.form = { kind: 'joint', editing: false, id: host.newId('joint'), name: '', type: 'revolute', parent, child, axis: { kind: 'base', axis: 'Z' }, numbers: { ...DEFAULTS.revolute } };
  }
  host.renderPanel();
}

function jointForm(host: PanelHost, panel: MechanismPanel, form: JointForm): HTMLElement[] {
  const section = host.doc.mechanism;
  const links = Object.keys(section.links);
  const sketches = host.doc.features.filter((f) => f.type === 'sketch').map((f) => f.id);
  const names = host.doc.parameters.map((p) => p.name);
  const unit = unitOf(form.type);
  const rebuild = () => host.renderPanel();
  const option = (value: string, label: string, selected: boolean) => h('option', { value, textContent: label, selected });
  const linkSelect = (label: string, which: 'parent' | 'child'): HTMLElement => {
    const select: HTMLSelectElement = h('select', { onchange: () => (form[which] = select.value) }, ...links.map((link) => option(link, linkName(host, link), link === form[which])), links.includes(form[which]) ? null : option(form[which], `${form[which] || '(none)'} (missing)`, true));
    return h('label', {}, label, select);
  };
  const id = h('input', { value: form.id, disabled: form.editing, oninput: () => (form.id = id.value.trim()) });
  const name = h('input', { value: form.name, placeholder: form.id, oninput: () => (form.name = name.value) });
  const type: HTMLSelectElement = h(
    'select',
    {
      onchange: () => {
        const next = type.value as JointType;
        // the numbers keep what was typed while the unit stays; another unit starts from its defaults
        form.numbers = unitOf(next) === unit ? Object.fromEntries(JOINT_FIELDS[next].map(({ path }) => [path, form.numbers[path as NumberPath] ?? DEFAULTS[next][path as NumberPath]])) : { ...DEFAULTS[next] };
        form.type = next;
        rebuild();
      },
    },
    ...(Object.keys(TYPES) as JointType[]).map((kind) => option(kind, TYPES[kind], kind === form.type)),
  );
  const number = (path: NumberPath, title: string): HTMLElement => {
    const input = h('input', {
      value: form.numbers[path] ?? '',
      oninput: () => {
        form.numbers[path] = input.value;
        const parsed = parseField(input.value, unit);
        markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
      },
    });
    return h('label', {}, fieldLabel(title, unit), input);
  };
  return [
    h('h2', {}, form.editing ? `Joint ${jointName(host, form.id)}` : 'New joint'),
    h('label', {}, 'ID', id),
    h('label', {}, 'Name (empty: the ID)', name),
    h('label', {}, 'Kind', type),
    linkSelect('Parent link', 'parent'),
    linkSelect('Child link (moves)', 'child'),
    ...(form.type === 'fixed' ? [] : axisRows(host, form.axis, sketches, (change) => ((form.axis = changeAxis(form.axis, change, sketches)), rebuild()), 'An axis through a point needs a sketch.')),
    ...(form.type === 'fixed' ? [] : [h('p', { className: 'hint' }, form.type === 'prismatic' ? 'The child slides along the direction of the axis.' : 'A positive angle turns counter-clockwise seen against the direction of the axis (the right-hand rule).')]),
    ...JOINT_FIELDS[form.type].map(({ path, spec }) => number(path as NumberPath, spec.title)),
    h('div', { className: 'buttons' }, h('button', { className: 'primary', textContent: 'OK', onclick: () => confirmJoint(host, panel, form) }), h('button', { textContent: 'Cancel', onclick: () => ((panel.form = undefined), host.renderPanel()) })),
  ];
}

// One command: setJoint with the whole joint in the input form (a number, or an expression as typed).
function confirmJoint(host: PanelHost, panel: MechanismPanel, form: JointForm): void {
  const unit = unitOf(form.type);
  const numbers: Partial<Record<NumberPath, number | Expr>> = {};
  for (const { path, spec } of JOINT_FIELDS[form.type]) {
    const parsed = parseField(form.numbers[path as NumberPath] ?? '', unit);
    if (parsed === undefined) return host.say(`${spec.title}: fill in a number or an expression.`, true);
    numbers[path as NumberPath] = parsed;
  }
  const name = form.name.trim();
  const joint = { type: form.type, ...(name === '' ? {} : { name }), parent: form.parent, child: form.child, ...(form.type === 'fixed' ? {} : { axis: form.axis }), ...numbers } as Input<Joint>;
  panel.form = undefined;
  if (!host.run({ type: 'setJoint', id: form.id, joint }, `${form.editing ? 'The joint' : 'A joint'} ${name || form.id}${form.editing ? ' changed' : ' made'}.`)) panel.form = form;
}
