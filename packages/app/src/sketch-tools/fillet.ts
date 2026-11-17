// The tool Fillet (D52): the corner under the click gets an arc of the radius of the options. The
// batch is sent as the engine's sketch tool made it: the switch of construction curves does not
// apply, the arc follows its lines.
import type { Expr } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField } from '../fields';
import { DEFAULT_FILLET, type FilletOptions, filletCommands } from '../sketch-commands';
import { type SketchPlaceTool, anchor } from './spec';

export const fillet: SketchPlaceTool<FilletOptions> = {
  label: 'Fillet',
  hint: 'Click the point where two lines meet; the radius is set in the panel.',
  atClick: true,
  click: (host, _m, places, context, options) => {
    const corner = anchor(places[places.length - 1]).snap;
    if (corner?.kind !== 'point') return host.say('Click a point where two lines meet.', true);
    const made = filletCommands(context.tool, corner.id, options, host.newId);
    if (!made.ok) return host.say(`Fillet: ${made.message}`, true);
    const { patched, moved, shortened } = made.ids;
    const notes = [
      patched.length === 0 ? 'no feature needed the arc' : `the arc was added to ${patched.length === 1 ? 'the profile of 1 feature' : `the profiles of ${patched.length} features`}`,
      ...(moved.length > 0 ? [`moved with the start of a line: ${moved.map((id) => host.nameOf(id)).join(', ')}`] : []),
      ...(shortened.length > 0 ? [`reading one line, check: ${shortened.map((id) => host.nameOf(id)).join(', ')}`] : []),
    ];
    host.run({ type: 'batch', commands: made.commands }, `Corner rounded; ${notes.join('; ')}.`);
  },
  // The option, shown while the tool is active: the radius, a number or an expression over the
  // parameters, remembered for the next corner.
  options: {
    initial: DEFAULT_FILLET,
    panel: (host, value, store) => {
      const names = host.doc.parameters.map((p) => p.name);
      const radius = h('input', {
        className: 'value',
        value: fieldText(value.radius, 'mm'),
        title: 'mm, or an expression',
        oninput: () => {
          const parsed = parseField(radius.value, 'mm');
          markProblem(radius, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : typeof parsed === 'number' && !(parsed > 0) ? 'The radius has to be positive.' : undefined);
        },
        onchange: () => {
          // an empty field, a radius that is not positive or an expression in error leaves the radius as it was
          const parsed = parseField(radius.value, 'mm');
          const fine = typeof parsed === 'number' ? parsed > 0 : parsed !== undefined && expressionProblem(parsed, 'number', names) === undefined;
          if (fine) store({ radius: parsed as number | Expr });
          host.renderPanel();
        },
      });
      return [
        h('h2', {}, 'Fillet'),
        h('label', {}, 'Radius', radius),
        h('p', { className: 'hint' }, 'Click the point where two lines meet. The corner gets an arc tangent to both lines with a radius dimension; the lines keep their IDs and the corner point stays where the lines cross. The features that use the outline get the arc in their profile.'),
      ];
    },
  },
};
