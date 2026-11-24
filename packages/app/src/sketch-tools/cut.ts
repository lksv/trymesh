// What the tools Trim, Extend and Split share (D65): the batch of the engine's sketch tool run as
// it was made (the switch of construction curves does not apply), what the status line says about
// the features it changed or that read what it changed, and the parts of their panels: the curve
// the tool is bounded by (`with`) and the repair.
import type { Id, Repair, SketchToolName as EngineToolName, SketchToolInputs } from '@trymesh/engine';
import { entityOf, repairsByDefault, sketchTool } from '@trymesh/engine';
import { h } from '../dom';
import type { SketchContext, SketchHost } from '../sketch-mode';

type CutTool = Extract<EngineToolName, 'trim' | 'extend' | 'split'>;

// What Trim and Extend remember: the curve they are bounded by, and the repair as chosen, kept with
// the sketch it was chosen in (an override must not outlive its sketch: `on` would cut every wall
// line of the next sketch of walls, `off` give up the regions of the next outline).
export interface CutOptions {
  with?: Id;
  repair?: { sketch: Id; value: Repair };
}
// What Split remembers: the curve it is bounded by, and whether a click cuts at the nearest contact only.
export interface SplitOptions {
  with?: Id;
  nearest: boolean;
}

const named = (host: SketchHost, ids: Id[]): string => ids.map((id) => host.nameOf(id)).join(', ');

// The notes of a batch: what was patched, and the features and curves to look at.
function notes(host: SketchHost, ids: Record<string, Id[]>): string {
  const list = (key: string): Id[] => ids[key] ?? [];
  const out = [list('patched').length === 0 ? 'no feature needed a patch' : `followed: ${named(host, list('patched'))}`];
  if (list('dropped').length > 0) out.push(`a region is gone from ${named(host, list('dropped'))}`);
  if (list('pending').length > 0) out.push(`still crossed, rewritten by names: ${named(host, list('pending'))}`);
  if (list('reshaped').length > 0) out.push(`a hole changed under the same region: ${named(host, list('reshaped'))}`);
  if (list('moved').length > 0) out.push(`moved with the start of a line: ${named(host, list('moved'))}`);
  if (list('shortened').length > 0) out.push(`reading a changed curve, check: ${named(host, list('shortened'))}`);
  if (list('broken').length > 0) out.push(`naming what is gone: ${named(host, list('broken'))}`);
  if (list('uncut').length > 0) out.push(`left whole where they cannot be cut: ${list('uncut').join(', ')}`);
  return out.join('; ');
}

// Runs a cut on the open sketch; a refusal is said with its reason.
export function runCut<K extends CutTool>(host: SketchHost, context: SketchContext, tool: K, input: SketchToolInputs[K], title: string, done: string): void {
  const made = sketchTool(tool, context.tool, input, host.newId);
  if (!made.ok) return host.say(`${title}: ${made.message}`, true);
  if (made.commands.length === 0) return host.say(`${title}: nothing to cut.`);
  host.run({ type: 'batch', commands: made.commands }, `${done}; ${notes(host, made.ids)}.`);
}

// The own curves of the open sketch: what the three tools take.
export const ownCurve = (curve: Id, context: SketchContext): boolean => curve in context.feature.curves;

// `with` of the options, while the open sketch has that curve (the options outlive a sketch). What
// an ID is in the sketch is asked of the engine, so an axis of the origin can bound a cut.
export const bound = (context: SketchContext, id: Id | undefined): Id | undefined => {
  const entity = id === undefined ? undefined : entityOf(context.feature, id);
  return entity !== undefined && entity.kind !== 'point' ? id : undefined;
};
// The repair as chosen, while the sketch it was chosen in is open.
export const chosenRepair = (context: SketchContext, options: CutOptions): Repair | undefined => (options.repair?.sketch === context.feature.id ? options.repair.value : undefined);

// The row of the curve a tool is bounded by: taken from the one curve selected, and cleared.
export function boundRows<O extends { with?: Id }>(host: SketchHost, value: O, set: (value: O) => void): HTMLElement[] {
  const context = host.sketchContext();
  const selected = (host.sketch?.selection ?? []).filter((id) => context && bound(context, id) !== undefined);
  const current = context ? bound(context, value.with) : undefined;
  const store = (next: O): void => {
    set(next);
    host.renderPanel();
  };
  return [
    h('p', { className: 'hint' }, `Up to: ${current ?? 'the nearest curves'}`),
    h(
      'div',
      { className: 'buttons' },
      h('button', { textContent: 'Use the selected curve', title: 'Only the contacts with the one curve selected bound the cut', disabled: selected.length !== 1, onclick: () => store({ ...value, with: selected[0] }) }),
      h('button', { textContent: 'Clear', title: 'The nearest curves bound the cut', disabled: value.with === undefined, onclick: () => store({ ...value, with: undefined }) }),
    ),
  ];
}

// The repair as a checkbox whose state without a choice is the default of the document; a choice
// away from the default is kept with the sketch it was made in.
export function repairRow(host: SketchHost, value: CutOptions, set: (value: CutOptions) => void): HTMLElement[] {
  const context = host.sketchContext();
  if (!context) return [];
  const byDefault = repairsByDefault(context.tool.document, context.feature.id);
  const chosen = chosenRepair(context, value);
  const box = h('input', {
    type: 'checkbox',
    checked: chosen === undefined ? byDefault : chosen === 'on',
    onchange: () => {
      set({ ...value, repair: box.checked === byDefault ? undefined : { sketch: context.feature.id, value: box.checked ? 'on' : 'off' } });
      host.renderPanel();
    },
  });
  return [
    h('label', { className: 'check', title: 'Cut every other crossing of the outline curves first, so that the profile stays valid and the regions of the features follow; on by default when a feature reads regions of the sketch' }, box, 'Cut the other crossings of the outline first'),
  ];
}
