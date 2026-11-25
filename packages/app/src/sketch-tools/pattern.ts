// The tools Mirror, Linear pattern and Circular pattern (D68): the own curves and points selected
// before the tool (and `origin`) are the sources; a click on a line (the axis, the direction) or on
// a point (the centre) adds the entry with a fresh ID and opens its form in the panel. With an entry
// to repair (its row's button), the click replaces its axis, direction or centre instead.
import { type Expr, type Id, type Input, type SketchPattern, type SketchTransform, entryInput, entityOf } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField } from '../fields';
import type { SketchHost, SketchMode, SketchContext } from '../sketch-mode';
import { type SketchPlaceTool, anchor } from './spec';

// What the pattern tools remember: the count and the spacing or the angle, a number or an
// expression (`2 * pi` and 360° are a full turn).
export interface PatternToolOptions {
  count: number | Expr;
  spacing: number | Expr;
  angle: number | Expr;
}
export const DEFAULT_PATTERN_TOOL: PatternToolOptions = { count: 3, spacing: 10, angle: 2 * Math.PI };

// The sources of the selection: own curves and points, and `origin`.
export const selectedSources = (m: SketchMode, context: SketchContext): Id[] =>
  m.selection.filter((id) => id === 'origin' || context.view.points.get(id)?.own === true || context.view.curves.get(id)?.own === true);

// A line that may be an axis or a direction: a line of the sketch that is not a copy (an axis of the
// origin is one).
export const patternLine = (curve: Id, context: SketchContext): boolean => {
  const entity = entityOf(context.feature, curve);
  return entity?.kind === 'line' && entity.derived !== true;
};

// The entry being repaired, when it is a mirror or pattern of the transform the tool makes.
const repaired = (m: SketchMode, context: SketchContext, type: SketchTransform['type']): Id | undefined => {
  const ref = m.repair === undefined ? undefined : context.feature.external[m.repair];
  return ref?.type === 'pattern' && ref.transform.type === type ? m.repair : undefined;
};

// The entry with the line or point picked: a repair, or a new entry over the selection.
function place(host: SketchHost, m: SketchMode, context: SketchContext, type: SketchTransform['type'], picked: Id, make: (sources: Id[]) => Input<SketchPattern>, change: (input: Input<SketchPattern>) => Input<SketchPattern>): void {
  const entry = repaired(m, context, type);
  if (entry !== undefined) {
    if (host.run({ type: 'updateExternal', sketch: m.id, id: entry, ref: change(entryInput(context.feature, entry) as Input<SketchPattern>) }, `${picked} picked.`)) m.repair = undefined;
    return;
  }
  const sources = selectedSources(m, context);
  if (sources.length === 0) return host.say(`Select the curves and points to copy first, then pick ${type === 'circular' ? 'the centre' : type === 'mirror' ? 'the axis' : 'the direction'}.`, true);
  const id = host.newId(type === 'mirror' ? 'm' : 'p');
  if (host.run({ type: 'addExternal', sketch: m.id, id, ref: make(sources) }, `${type === 'mirror' ? 'Mirror' : 'Pattern'} ${id} added.`)) {
    m.selection = [];
    m.entry = id;
    host.renderPanel();
  }
}

// The text field of a number of the options, a number or an expression.
function optionField(host: SketchHost, title: string, value: number | Expr, unit: 'count' | 'mm' | 'rad', set: (value: number | Expr) => void): HTMLElement {
  const names = host.doc.parameters.map((p) => p.name);
  const input = h('input', {
    className: 'value',
    value: fieldText(value, unit),
    title: 'a number, or an expression',
    oninput: () => {
      const parsed = parseField(input.value, unit);
      markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
    },
    onchange: () => {
      const parsed = parseField(input.value, unit);
      if (parsed !== undefined && (typeof parsed === 'number' || expressionProblem(parsed, 'number', names) === undefined)) set(parsed);
      host.renderPanel();
    },
  });
  return h('label', {}, title, input);
}

export const mirror: SketchPlaceTool<undefined> = {
  label: 'Mirror',
  hint: 'Select the curves and points to copy, then click the line to mirror them about.',
  picks: 'curve',
  eligible: patternLine,
  atClick: true,
  click: (host, m, places, context) => {
    const at = anchor(places[places.length - 1]);
    if (at.snap?.kind !== 'curve') return host.say('Click a line of the sketch (not a copy).', true);
    const axis = at.snap.id;
    place(
      host,
      m,
      context,
      'mirror',
      axis,
      (sources) => ({ type: 'pattern', sources, transform: { type: 'mirror', axis } }),
      (input) => ({ ...input, transform: { type: 'mirror', axis } }),
    );
  },
};

export const linearPattern: SketchPlaceTool<PatternToolOptions> = {
  label: 'Linear pattern',
  hint: 'Select the curves and points to copy, then click the line to repeat them along.',
  picks: 'curve',
  eligible: patternLine,
  atClick: true,
  click: (host, m, places, context, options) => {
    const at = anchor(places[places.length - 1]);
    if (at.snap?.kind !== 'curve') return host.say('Click a line of the sketch (not a copy).', true);
    const direction = at.snap.id;
    place(
      host,
      m,
      context,
      'linear',
      direction,
      (sources) => ({ type: 'pattern', sources, transform: { type: 'linear', direction, count: options.count, span: { type: 'spacing', spacing: options.spacing } } }) as Input<SketchPattern>,
      (input) => ({ ...input, transform: { ...input.transform, direction } }) as Input<SketchPattern>,
    );
  },
  options: {
    initial: DEFAULT_PATTERN_TOOL,
    panel: (host, value, set) => [
      h('h2', {}, 'Linear pattern'),
      optionField(host, 'Count', value.count, 'count', (count) => set({ ...value, count })),
      optionField(host, 'Spacing', value.spacing, 'mm', (spacing) => set({ ...value, spacing })),
      h('p', { className: 'hint' }, 'Select the curves and points to copy, then click the line to repeat them along. The count includes the source; the copies follow the source and are changed in the row of the pattern.'),
    ],
  },
};

export const circularPattern: SketchPlaceTool<PatternToolOptions> = {
  label: 'Circular pattern',
  hint: 'Select the curves and points to copy, then click the point to turn them about.',
  atClick: true,
  click: (host, m, places, context, options) => {
    const at = anchor(places[places.length - 1]);
    const center = at.snap?.kind === 'point' && entityOf(context.feature, at.snap.id)?.derived !== true ? at.snap.id : undefined;
    if (center === undefined) return host.say('Click a point of the sketch (not a copy).', true);
    const full = typeof options.angle === 'number' && Math.abs(Math.abs(options.angle) - 2 * Math.PI) < 1e-9;
    const span = full ? { type: 'full' as const } : { type: 'angle' as const, angle: options.angle };
    place(
      host,
      m,
      context,
      'circular',
      center,
      (sources) => ({ type: 'pattern', sources, transform: { type: 'circular', center, count: options.count, span } }) as Input<SketchPattern>,
      (input) => ({ ...input, transform: { ...input.transform, center } }) as Input<SketchPattern>,
    );
  },
  options: {
    initial: DEFAULT_PATTERN_TOOL,
    panel: (host, value, set) => [
      h('h2', {}, 'Circular pattern'),
      optionField(host, 'Count', value.count, 'count', (count) => set({ ...value, count })),
      optionField(host, 'Angle', value.angle, 'rad', (angle) => set({ ...value, angle })),
      h('p', { className: 'hint' }, 'Select the curves and points to copy, then click the point to turn them about. 360° spreads the copies over the full turn; another angle is the angle from the source to the last copy.'),
    ],
  },
};
