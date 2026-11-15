// A control per kind of argument (D39): the generic form of a query is built from the description
// of its arguments. The table is typed over the kinds, so a new kind of argument does not compile
// until it has a control.
//
// A control shows the value the draft holds at its path and reports a new one with `set`. The
// draft is plain data in the shape of the description; a value not given yet is undefined, and
// a reference being put together (a body chosen, its face not yet) is an object without some of
// its members. The engine checks the whole when the query is asked.
import { type ArgKind, type ArgPath, type EngineState, type FaceName, type Id, type SketchFeature, type Unit, checkNumber, faceKey } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { fieldText, parseField, unitLabel } from '../fields';
import type { PanelHost } from '../host';
import { angleProblem, faceLabel } from '../issue-text';
import { sketchView } from '../sketch-view';

// What a control gets of the form.
export interface Form {
  host: PanelHost;
  state: EngineState; // the state shown: the lists of bodies, features and sketches come from it
  armed: ArgPath | undefined; // the control that takes the next selection in the view
  arm(path: ArgPath | undefined): void;
  set(path: ArgPath, value: unknown, rebuild?: boolean): void; // `rebuild`: what follows depends on the value, so the panel is built again
  title(spec: ArgKind, name: string): string; // the title of a nested entry, or its key
}
// `value`: what the draft holds at `path`. `siblings`: the named values next to it (the sketch of a constraint).
type Control<K> = (spec: K, value: unknown, path: ArgPath, form: Form, siblings: Record<string, unknown>) => HTMLElement[];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const samePath = (a: ArgPath | undefined, b: ArgPath): boolean => a !== undefined && a.length === b.length && a.every((part, i) => part === b[i]);

// A choice from a list, with an empty first row while nothing is chosen.
function choice(options: readonly (readonly [value: string, label: string])[], current: string | undefined, change: (value: string | undefined) => void, empty = '—'): HTMLSelectElement {
  const known = current !== undefined && options.some(([value]) => value === current);
  const select = h(
    'select',
    { onchange: () => change(select.value === '' ? undefined : select.value) },
    h('option', { value: '', textContent: empty, selected: !known }),
    ...options.map(([value, label]) => h('option', { value, textContent: label, selected: value === current })),
  );
  return select;
}

// The lists a control offers, from the state shown.
const bodies = (form: Form): [Id, string][] => Object.keys(form.state.evaluation.bodies).map((id) => [id, form.host.bodyName(id)]);
const features = (form: Form, only?: (type: string) => boolean): [Id, string][] =>
  form.state.document.features.filter((f) => Object.prototype.hasOwnProperty.call(form.state.evaluation.features, f.id) && (!only || only(f.type))).map((f) => [f.id, f.name]);
const sketches = (form: Form): [Id, string][] => features(form, (type) => type === 'sketch');
const sketchOf = (form: Form, id: unknown): SketchFeature | undefined => form.state.document.features.find((f): f is SketchFeature => f.id === id && f.type === 'sketch');
// The points of a sketch that have a place: the origin, its own points, the points of projected geometry.
function pointsOf(form: Form, sketch: unknown): [Id, string][] {
  const feature = sketchOf(form, sketch);
  const result = feature && form.state.evaluation.features[feature.id]?.sketch;
  return feature && result ? [...sketchView(feature, result).points.keys()].map((id) => [id, id]) : [];
}
const faceText = (form: Form, name: FaceName): string => `${faceLabel(name, form.host.featureNames)} · ${faceKey(name)}`;
const facesOf = (form: Form, body: unknown): [string, string][] => {
  const data = typeof body === 'string' ? form.state.evaluation.bodies[body] : undefined;
  return (data?.faces ?? []).map((face) => form.state.evaluation.faceNames[face.id]).map((name) => [JSON.stringify(name), faceText(form, name)]);
};
const edgesOf = (form: Form, body: unknown): [string, string][] => {
  const data = typeof body === 'string' ? form.state.evaluation.bodies[body] : undefined;
  return (data?.edges ?? []).map((edge) => [JSON.stringify(edge.name), `${faceKey(edge.name.a)} | ${faceKey(edge.name.b)} (${edge.kind})`]);
};

// The button that arms a control: the next face, edge or plane selected in the view goes to it.
function pick(path: ArgPath, form: Form, what: string): HTMLElement {
  const armed = samePath(form.armed, path);
  return h('button', { className: armed ? 'active' : '', textContent: armed ? `Click ${what} in the view…` : 'Pick in the view', title: `Take ${what} selected in the view`, onclick: () => form.arm(armed ? undefined : path) });
}

// A number typed into a form of a query: a number in the unit of the field (an angle in degrees),
// never an expression, because a query does not live in the document.
function numberField(unit: Unit, value: unknown, placeholder: number | undefined, check: (value: number) => string | undefined, change: (value: number | undefined) => void): HTMLInputElement {
  const read = (): { value?: number; problem?: string } => {
    const parsed = parseField(input.value, unit);
    if (parsed === undefined) return {};
    if (typeof parsed === 'string') return { problem: 'a number is expected (a query takes no expression)' };
    return { value: parsed, problem: check(parsed) };
  };
  const input: HTMLInputElement = h('input', {
    className: 'value',
    value: typeof value === 'number' ? fieldText(value, unit) : '',
    placeholder: placeholder === undefined ? '' : fieldText(placeholder, unit),
    oninput: () => markProblem(input, read().problem),
    onchange: () => {
      const { value: number, problem } = read();
      markProblem(input, problem);
      if (problem === undefined) change(number);
    },
  });
  return input;
}

const ENTITY_KINDS = { body: 'Body', face: 'Face', edge: 'Edge', sketchPoint: 'Sketch point' } as const;
const BASE_PLANES = ['XY', 'XZ', 'YZ'] as const;
const BASE_AXES = ['X', 'Y', 'Z'] as const;

export const CONTROLS: { readonly [K in ArgKind['kind']]: Control<Extract<ArgKind, { kind: K }>> } = {
  number: (spec, value, path, form) => {
    const check = (number: number): string | undefined => {
      const checked = checkNumber(number, spec.spec, Infinity);
      return checked.ok ? undefined : (angleProblem(number, spec.spec) ?? checked.message);
    };
    return [numberField(spec.spec.unit, value, spec.spec.default, check, (number) => form.set(path, number)), h('span', { className: 'unit', textContent: unitLabel(spec.spec.unit) })];
  },
  flag: (_spec, value, path, form) => {
    const box = h('input', { type: 'checkbox', checked: value === true, onchange: () => form.set(path, box.checked) });
    return [box];
  },
  text: (_spec, value, path, form) => {
    const input = h('input', { value: typeof value === 'string' ? value : '', onchange: () => form.set(path, input.value.trim() === '' ? undefined : input.value.trim()) });
    return [input];
  },
  choice: (spec, value, path, form) => [choice(spec.options.map((option) => [option, option] as const), typeof value === 'string' ? value : undefined, (chosen) => form.set(path, chosen))],
  body: (_spec, value, path, form) => [choice(bodies(form), typeof value === 'string' ? value : undefined, (chosen) => form.set(path, chosen))],
  feature: (_spec, value, path, form) => [choice(features(form), typeof value === 'string' ? value : undefined, (chosen) => form.set(path, chosen))],
  // a constraint is chosen from the sketch next to it, so a change of the sketch builds the form again
  sketch: (_spec, value, path, form) => [choice(sketches(form), typeof value === 'string' ? value : undefined, (chosen) => form.set(path, chosen, true))],
  constraint: (spec, value, path, form, siblings) => {
    const sketch = sketchOf(form, siblings[spec.of]);
    const options = Object.keys(sketch?.constraints ?? {}).map((id) => [id, `${id} (${sketch?.constraints[id].type})`] as const);
    return [choice(options, typeof value === 'string' ? value : undefined, (chosen) => form.set(path, chosen), sketch ? '—' : 'choose the sketch first')];
  },
  // A face or an edge: selected in the view while the control is armed, or chosen from the lists
  // of a chosen body (the view never picks an edge of the kind `coplanar`, and a face may be
  // hidden behind others). A body: the body of a selected face, or a choice. A sketch point: its
  // sketch and its point from two lists, because the view picks points only inside a sketch.
  entity: (spec, value, path, form) => {
    const current = isRecord(value) ? value : {};
    const kind = typeof current.kind === 'string' && (spec.accepts as readonly string[]).includes(current.kind) ? (current.kind as keyof typeof ENTITY_KINDS) : spec.accepts.length === 1 ? spec.accepts[0] : undefined;
    const out: HTMLElement[] = [];
    if (spec.accepts.length > 1) out.push(choice(spec.accepts.map((accepted) => [accepted, ENTITY_KINDS[accepted]] as const), kind, (chosen) => form.set(path, chosen ? { kind: chosen } : undefined, true), 'what'));
    if (kind === 'sketchPoint') {
      out.push(
        choice(sketches(form), typeof current.sketch === 'string' ? current.sketch : undefined, (sketch) => form.set(path, { kind, sketch }, true), 'sketch'),
        choice(pointsOf(form, current.sketch), typeof current.point === 'string' ? current.point : undefined, (point) => form.set(path, { kind, sketch: current.sketch, point }), 'point'),
      );
    } else if (kind) {
      out.push(choice(bodies(form), typeof current.body === 'string' ? current.body : undefined, (body) => form.set(path, { kind, body }, true), 'body'));
      const key = kind === 'face' ? 'face' : 'edge';
      if (kind !== 'body') {
        const options = kind === 'face' ? facesOf(form, current.body) : edgesOf(form, current.body);
        out.push(choice(options, current[key] === undefined ? undefined : JSON.stringify(current[key]), (chosen) => form.set(path, { kind, body: current.body, [key]: chosen === undefined ? undefined : JSON.parse(chosen) }), key));
      }
    }
    // the view picks faces and edges; a body is the body of what was picked
    if (spec.accepts.some((accepted) => accepted !== 'sketchPoint')) out.push(pick(path, form, spec.accepts.includes('edge') ? 'a face or an edge' : spec.accepts.includes('face') ? 'a face' : 'a face of the body'));
    return out;
  },
  // A base plane or a plane feature from a list; a planar face or a plane selected in the view.
  plane: (_spec, value, path, form) => {
    const current = isRecord(value) ? value : {};
    const planes = features(form, (type) => type === 'plane');
    const chosen = current.kind === 'base' ? `base:${String(current.plane)}` : current.kind === 'plane' ? `plane:${String(current.feature)}` : current.kind === 'face' ? 'face' : undefined;
    const options: [string, string][] = [...BASE_PLANES.map((plane): [string, string] => [`base:${plane}`, plane]), ...planes.map(([id, name]): [string, string] => [`plane:${id}`, name])];
    if (current.kind === 'face' && isRecord(current.face)) options.push(['face', faceText(form, current.face as unknown as FaceName)]);
    const select = choice(options, chosen, (key) => {
      if (key === undefined) form.set(path, undefined);
      else if (key.startsWith('base:')) form.set(path, { kind: 'base', plane: key.slice(5) });
      else if (key.startsWith('plane:')) form.set(path, { kind: 'plane', feature: key.slice(6) });
    });
    return [select, pick(path, form, 'a plane or a planar face')];
  },
  // A base axis, or a sketch and its point.
  axis: (_spec, value, path, form) => {
    const current = isRecord(value) ? value : {};
    const chosen = current.kind === 'base' ? String(current.axis) : current.kind === 'sketchPoint' ? 'point' : undefined;
    const out: HTMLElement[] = [
      choice([...BASE_AXES.map((axis) => [axis, axis] as const), ['point', 'Through a sketch point'] as const], chosen, (key) => form.set(path, key === undefined ? undefined : key === 'point' ? { kind: 'sketchPoint' } : { kind: 'base', axis: key }, true)),
    ];
    if (current.kind === 'sketchPoint') {
      out.push(
        choice(sketches(form), typeof current.sketch === 'string' ? current.sketch : undefined, (sketch) => form.set(path, { kind: 'sketchPoint', sketch }, true), 'sketch'),
        choice(pointsOf(form, current.sketch), typeof current.point === 'string' ? current.point : undefined, (point) => form.set(path, { kind: 'sketchPoint', sketch: current.sketch, point }), 'point'),
      );
    }
    return out;
  },
  vector: (_spec, value, path, form) => {
    const current: unknown[] = Array.isArray(value) ? value : [];
    // the vector is given once all three numbers are; until then the draft keeps what was typed
    return [0, 1, 2].map((axis) =>
      numberField('none', current[axis], undefined, () => undefined, (number) => {
        const next = [current[0], current[1], current[2]];
        next[axis] = number;
        form.set(path, next.every((part) => part === undefined) ? undefined : next);
      }),
    );
  },
  // A row per element, added and removed within `min` and `max`.
  list: (spec, value, path, form, siblings) => {
    const items: unknown[] = Array.isArray(value) ? value : [];
    const without = (index: number): unknown[] | undefined => (items.length === 1 ? undefined : items.filter((_, i) => i !== index));
    const rows = items.map((item, index) =>
      h(
        'div',
        { className: 'item' },
        ...CONTROLS[spec.of.kind](spec.of as never, item, [...path, index], form, siblings),
        h('button', { className: 'icon', textContent: '✕', title: 'Remove', onclick: () => form.set(path, without(index), true) }),
      ),
    );
    const full = spec.max !== undefined && items.length >= spec.max;
    return [...rows, h('button', { className: 'link', textContent: 'Add', disabled: full, onclick: () => form.set(path, [...items, undefined], true) })];
  },
  // A choice of the alternative and the control of the chosen one.
  oneOf: (spec, value, path, form, siblings) => {
    const current = isRecord(value) ? value : {};
    const names = Object.keys(spec.options);
    const chosen = names.find((name) => Object.prototype.hasOwnProperty.call(current, name));
    const out: HTMLElement[] = [choice(names.map((name) => [name, form.title(spec.options[name], name)] as const), chosen, (name) => form.set(path, name === undefined ? undefined : { [name]: undefined }, true))];
    if (chosen !== undefined) out.push(...CONTROLS[spec.options[chosen].kind](spec.options[chosen] as never, current[chosen], [...path, chosen], form, siblings));
    return out;
  },
  // A row per key; the key from a list of bodies or features, or a text.
  record: (spec, value, path, form, siblings) => {
    const current = isRecord(value) ? value : {};
    const keys = spec.keys === 'body' ? bodies(form) : spec.keys === 'feature' ? features(form) : undefined;
    const label = (key: string): string => keys?.find(([id]) => id === key)?.[1] ?? key;
    const without = (key: string): Record<string, unknown> | undefined => {
      const rest = Object.fromEntries(Object.entries(current).filter(([name]) => name !== key));
      return Object.keys(rest).length ? rest : undefined;
    };
    const rows = Object.keys(current).map((key) =>
      h(
        'div',
        { className: 'item' },
        h('span', { className: 'name', textContent: label(key) }),
        ...CONTROLS[spec.of.kind](spec.of as never, current[key], [...path, key], form, siblings),
        h('button', { className: 'icon', textContent: '✕', title: 'Remove', onclick: () => form.set(path, without(key), true) }),
      ),
    );
    const add = (key: string | undefined): void => {
      if (key !== undefined && key !== '' && !Object.prototype.hasOwnProperty.call(current, key)) form.set(path, { ...current, [key]: undefined }, true);
    };
    const free = (keys ?? []).filter(([id]) => !Object.prototype.hasOwnProperty.call(current, id));
    const text: HTMLInputElement = h('input', { placeholder: 'name', onchange: () => add(text.value.trim()) });
    return [...rows, keys ? choice(free, undefined, add, 'Add…') : text];
  },
  // A group: every field with its title.
  fields: (spec, value, path, form) => {
    const current = isRecord(value) ? value : {};
    return [
      h(
        'div',
        { className: 'group' },
        ...Object.entries(spec.fields).map(([name, field]) => h('label', {}, `${form.title(field, name)}${field.optional ? ' (optional)' : ''}`, ...CONTROLS[field.kind](field as never, current[name], [...path, name], form, current))),
      ),
    ];
  },
};
