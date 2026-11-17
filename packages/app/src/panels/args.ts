// A draft of arguments described by `ArgSpecs`, and the rows of a form built from the
// description: what the generic form of a query (D39, `query.ts`) and the form of an export
// (D54, `export.ts`) share. Moved out of `query.ts` without a change of behaviour.
import type { ArgKind, ArgPath, ArgSpecs } from '@trymesh/engine';
import { h } from '../dom';
import type { PanelHost, ViewPick } from '../host';
import { CONTROLS, type Form } from '../queries/controls';

// What a form holds: the arguments being filled in, in the shape of their description (a value not
// given yet is undefined), and the path of the control that takes the next selection in the view.
export interface ArgDraft {
  draft: Record<string, unknown>;
  armed?: ArgPath;
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The description of the argument at `path`.
export function specAt(specs: ArgSpecs, path: ArgPath): ArgKind | undefined {
  let spec: ArgKind | undefined = specs[String(path[0])];
  for (const part of path.slice(1)) {
    if (!spec) return undefined;
    if (spec.kind === 'list' || spec.kind === 'record') spec = spec.of;
    else if (spec.kind === 'oneOf') spec = spec.options[String(part)];
    else if (spec.kind === 'fields') spec = spec.fields[String(part)];
    else return undefined;
  }
  return spec;
}
// The draft with `value` at `path`; what is on the way is copied, not changed.
export function withValue(draft: unknown, path: ArgPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [part, ...rest] = path;
  if (typeof part === 'number') {
    const list: unknown[] = Array.isArray(draft) ? [...draft] : [];
    list[part] = withValue(list[part], rest, value);
    return list;
  }
  const record = isRecord(draft) ? draft : {};
  return { ...record, [part]: withValue(record[part], rest, value) };
}

// What a selection in the view is for the argument described by `spec`, or undefined when the
// argument does not take it.
export function selected(spec: ArgKind, pick: ViewPick): unknown {
  if (spec.kind === 'entity' && pick.kind !== 'plane') {
    if (pick.kind === 'face' && spec.accepts.includes('face')) return { kind: 'face', body: pick.body, face: pick.name };
    if (pick.kind === 'edge' && spec.accepts.includes('edge')) return { kind: 'edge', body: pick.body, edge: pick.name };
    return spec.accepts.includes('body') ? { kind: 'body', body: pick.body } : undefined; // the body of what was clicked
  }
  if (spec.kind === 'plane') {
    if (pick.kind === 'plane') return pick.ref;
    return pick.kind === 'face' && pick.planar ? { kind: 'face', body: pick.body, face: pick.name } : undefined;
  }
  // the axis of a round face (D60); whether it has an axis is the engine's to say
  if (spec.kind === 'axis') return pick.kind === 'face' && !pick.planar ? { kind: 'face', body: pick.body, face: pick.name } : undefined;
  return undefined;
}
// Is the reference complete enough to stand for the argument? (A body chosen without its face is not.)
export function given(spec: ArgKind, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (spec.kind === 'plane') return value.kind !== undefined;
  return value.kind === 'body' ? value.body !== undefined : value.kind === 'face' ? value.face !== undefined : value.kind === 'edge' ? value.edge !== undefined : value.kind === 'sketchPoint' ? value.point !== undefined : false;
}
// The first argument that takes a selection of the view and is still empty.
export function nextToArm(specs: ArgSpecs, draft: Record<string, unknown>): ArgPath | undefined {
  const takes = (spec: ArgKind): boolean => spec.kind === 'plane' || (spec.kind === 'entity' && spec.accepts.some((kind) => kind !== 'sketchPoint'));
  const name = Object.keys(specs).find((key) => takes(specs[key]) && !given(specs[key], draft[key]));
  return name === undefined ? undefined : [name];
}

// The armed control of a draft takes a selection of the view: true when it took it. The next
// argument that takes a selection and is still empty is armed.
export function takeInto(specs: ArgSpecs, open: ArgDraft, pick: ViewPick): boolean {
  if (!open.armed) return false;
  const spec = specAt(specs, open.armed);
  const value = spec && selected(spec, pick);
  if (value === undefined) return false;
  open.draft = withValue(open.draft, open.armed, value) as Record<string, unknown>;
  open.armed = nextToArm(specs, open.draft);
  return true;
}

// A row per argument, with the control of its kind. `failed`: a refusal; the row of the argument
// its path names is marked, with the message as its title.
export function argRows(specs: ArgSpecs, open: ArgDraft, host: PanelHost, failed?: { message: string; arg?: ArgPath }): HTMLElement[] {
  const form: Form = {
    host,
    state: host.view(),
    armed: open.armed,
    arm: (path) => {
      open.armed = path;
      host.renderPanel();
    },
    set: (path, value, rebuild = false) => {
      open.draft = withValue(open.draft, path, value) as Record<string, unknown>;
      if (rebuild) host.renderPanel();
    },
    get: (path) => path.reduce<unknown>((held, part) => (Array.isArray(held) && typeof part === 'number' ? held[part] : isRecord(held) && typeof part === 'string' && Object.prototype.hasOwnProperty.call(held, part) ? held[part] : undefined), open.draft),
    title: (spec, name) => (spec as { title?: string }).title ?? name,
  };
  return Object.entries(specs).map(([name, arg]) => {
    const wrong = failed?.arg?.[0] === name;
    return h('label', { className: wrong ? 'invalid' : '', title: wrong ? (failed?.message ?? '') : (arg.summary ?? '') }, `${arg.title}${arg.optional ? ' (optional)' : ''}`, ...CONTROLS[arg.kind](arg as never, open.draft[name], [name], form, open.draft));
  });
}
