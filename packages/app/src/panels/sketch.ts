// The panel of the sketch mode: the status of the sketch, its diagnosis, the buttons of the
// selection, the list of constraints and dimensions, the projected geometry, the options of the
// active tool (its entry of SKETCH_TOOL_UI), and the row that re-points a point of a curve (D52).
import { type Command, type Expr, type ExternalRef, type Id, type Input, type SketchDiagnosis, type SketchFeature, type Unit, CONSTRAINTS, CURVE_POINTS, type Constraint, type CurvePointName, atPath, constraintPath, entityIndex, entryInput, isDimension, isOriginAxis, kindOf, nearestCurvePoint, withPath } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField, valueText } from '../fields';
import { CURVE_POINT_LABELS, type DimensionVariant, GEOMETRIC_KINDS, dimensionFor, geometricFor, normalizeAngle, repointSelection } from '../sketch-commands';
import { duplicateTwins, explanationText, freeSummary, markOf } from '../sketch-diagnosis';
import { type SketchHost, type SketchMode, addConstraints, contactsOf, deleteSelection, explain, setTool, toolOptions } from '../sketch-mode';
import { SKETCH_TOOL_UI } from '../sketch-tools';
import { measure, operandsOf } from '../sketch-view';
import { type EntryControl, PICKER_LIMIT, entryEntities, referenceUi } from '../references';
import { outlineDraftPanel, outlineFileButton } from './outline-draft';
import { selectedSources } from '../sketch-tools/pattern';

// The names of constraints are in the engine's catalog; a new constraint shows up here by itself.
const constraintName = (type: Constraint['type']): string => CONSTRAINTS[type].title;

// A row that re-points a point of the selected curve to the selected point (setCurvePoint, D52):
// a choice of the points the curve has, the nearest one chosen at first.
function repointRow(host: SketchHost, m: SketchMode): HTMLElement[] {
  const context = host.sketchContext();
  const picked = context && repointSelection(context.view, m.selection);
  if (!context || !picked) return [];
  const kind = context.feature.curves[picked.curve].type;
  const nearest = nearestCurvePoint(context.view.source, picked.curve, picked.to);
  const choice = h('select', { title: 'Which point of the curve' }, ...CURVE_POINTS[kind].map((name) => h('option', { value: name, textContent: CURVE_POINT_LABELS[name], selected: name === nearest })));
  const send = () => host.run({ type: 'setCurvePoint', sketch: m.id, id: picked.curve, point: choice.value as CurvePointName, to: picked.to }, 'Point of the curve changed.');
  return [h('div', { className: 'buttons repoint' }, h('label', {}, `Point of ${picked.curve}`, choice), h('button', { textContent: 'Re-point', title: `The chosen point of ${picked.curve} becomes ${picked.to}; the curve keeps its ID and its constraints`, onclick: send }))];
}

function sketchStatus(host: SketchHost, m: SketchMode): HTMLElement[] {
  const context = host.sketchContext();
  const result = host.view().evaluation.features[m.id];
  if (!context) return [h('p', { className: 'issue error' }, result?.status === 'suppressed' ? 'The sketch is suppressed.' : 'The sketch cannot be shown: its plane is not available.'), ...host.issues(result)];
  const r = context.result;
  const unsolved = result?.warnings.some((w) => w.code === 'sketchConflict') === true; // the degrees of freedom then say nothing
  const empty = Object.keys(context.feature.points).length + Object.keys(context.feature.curves).length === 0;
  const state =
    r.conflicting.length > 0
      ? ['Constraints in conflict', 'error']
      : unsolved
        ? ['The sketch could not be solved', 'error']
        : empty
          ? ['Empty sketch', 'open']
          : r.degreesOfFreedom === 0
            ? ['Fully constrained', 'ok']
            : [`Degrees of freedom: ${r.degreesOfFreedom}`, 'open'];
  return [
    h('p', { className: `badge ${state[1]}` }, state[0]),
    r.valid ? h('p', { className: 'hint' }, `Closed regions: ${r.regions.length}`) : h('p', { className: 'issue error' }, 'The profile is invalid: curves cross or touch away from joined points, or are closer than the division of arcs can tell apart.'),
    ...(r.valid ? [] : [contactsHint(host, m.id)]),
    ...host.issues(result).filter((element) => !element.classList.contains('error') || r.valid),
  ];
}

// D65: what repairs an invalid profile, from the query sketchContacts: the places where its curves
// meet, marked in the view and cut by Split crossings (the tool Split), or why nothing can be cut.
function contactsHint(host: SketchHost, sketch: Id): HTMLElement {
  const found = contactsOf(host, sketch);
  if (!found) return h('p', { className: 'hint' }, 'The contacts of the curves are not known.');
  if (found.total === 0) return h('p', { className: 'hint' }, `Nothing to cut: ${found.reason ?? 'no contact found'}.`);
  const stuck = found.reason ? ` Not every one can be cut: ${found.reason}.` : '';
  return h('p', { className: 'hint' }, `Contacts marked in the view: ${found.total}. Split crossings (the tool Split) cuts them; then Trim removes the pieces that should go.${stuck}`);
}

// While dragging, the panel is not rebuilt, only the state of how constrained the sketch is.
export function updateSketchStatus(host: SketchHost, m: SketchMode): void {
  document.getElementById('sketch-status')?.replaceChildren(...sketchStatus(host, m));
}

// Summary of the diagnosis under the state of the sketch: redundant constraints and what can still move.
function diagnosisSummary(host: SketchHost, m: SketchMode, d: SketchDiagnosis): HTMLElement[] {
  const out: HTMLElement[] = [];
  const twins = duplicateTwins(d);
  const removeTwins = (): HTMLElement => {
    const commands = twins.map((id): Command => ({ type: 'removeConstraint', sketch: m.id, id }));
    return h('div', { className: 'buttons' }, h('button', { textContent: `Delete duplicates (${twins.length})`, onclick: () => host.run({ type: 'batch', commands }, twins.length === 1 ? 'Duplicate constraint deleted.' : 'Duplicate constraints deleted.') }));
  };
  if (d.status !== 'solved') {
    // the engine reports duplicates for an unsolved sketch too; deleting them may remove the conflict
    if (twins.length > 0) out.push(h('p', { className: 'issue warning' }, `Duplicate constraints: ${twins.length}. They are marked in the list.`), removeTwins());
    return out;
  }
  if (d.removable.length > 0) {
    out.push(
      h('p', { className: 'issue warning' }, `Surplus constraints: ${d.removable.length}${twins.length > 0 ? `, of them duplicates: ${twins.length}` : ''}. They are marked in the list; a click on a constraint shows what it follows from.`),
    );
    if (twins.length > 0) out.push(removeTwins());
  }
  const free = freeSummary(d);
  if (free !== undefined) {
    const select = d.free.map((entity) => entity.id);
    out.push(
      h('p', { className: 'hint' }, free),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Select free', title: 'Selects the free points and the circles with a free radius', onclick: () => ((m.selection = select), host.refresh()) })),
    );
  }
  return out;
}

export function sketchPanel(host: SketchHost, m: SketchMode): HTMLElement[] {
  const context = host.sketchContext();
  const out: HTMLElement[] = [h('h2', {}, `Sketch: ${host.nameOf(m.id)}`), h('div', { id: 'sketch-status' }, ...sketchStatus(host, m))];
  if (!context) return out;
  const { feature, view, result } = context;
  const action = (label: string, enabled: boolean, run: () => void, title = '') => h('button', { textContent: label, disabled: !enabled, title, onclick: run });
  const diagnosis = host.engine.diagnoseSketch(m.id);
  if (m.focus && !feature.constraints[m.focus]) m.focus = undefined;
  const explanation = m.focus ? explain(host, m.id, m.focus, diagnosis) : undefined;
  const label = (id: Id): string => (feature.constraints[id] ? `${constraintName(feature.constraints[id].type)} (${operandsOf(feature.constraints[id]).join(', ')})` : id);
  const parameterNames = host.doc.parameters.map((p) => p.name);
  out.push(...host.issues(host.view().evaluation.features[m.id]).filter((element) => element.textContent?.startsWith('Field ')));
  out.push(...diagnosisSummary(host, m, diagnosis));
  // the options of the active tool (the sides of the polygon, the radius of the fillet)
  const options = SKETCH_TOOL_UI[m.tool].options;
  if (options) out.push(...options.panel(host, toolOptions(host, m.tool), (value) => (host.sketching.tools[m.tool] = value)));
  // the import of an outline (D72): a button beside the tools, and the draft while a file is open
  if (m.outline) out.push(...outlineDraftPanel(host, m, feature));
  else out.push(h('div', { className: 'buttons' }, ...outlineFileButton(host, m, 'Import an outline…', 'Read a DXF or SVG file into this sketch as an outline of fixed curves')));

  const dimension = (label: string, variant: DimensionVariant, title: string) => {
    const d = dimensionFor(variant, view, m.selection);
    return action(label, d !== undefined, () => addConstraints(host, m, d && [d]), title);
  };
  const ownCurves = m.selection.filter((id) => feature.curves[id]);
  const construction = ownCurves.length > 0 && ownCurves.every((id) => feature.curves[id].construction);
  out.push(
    h('h2', {}, `Selection (${m.selection.length})`),
    h(
      'div',
      { className: 'buttons' },
      // a button for each geometric constraint of the engine's catalog; its tooltip is its description
      ...GEOMETRIC_KINDS.map((kind) => {
        const constraints = geometricFor(kind, view, m.selection);
        return action(constraintName(kind), constraints !== undefined, () => addConstraints(host, m, constraints), CONSTRAINTS[kind].summary);
      }),
    ),
    h(
      'div',
      { className: 'buttons' },
      dimension('Dimension', 'auto', 'Two points or a line: distance; a point and a line: distance; two lines: angle; a circle: diameter; an arc: radius'),
      dimension('Dimension ↔', 'horizontal', 'Horizontal distance of two points or of the ends of a line'),
      dimension('Dimension ↕', 'vertical', 'Vertical distance of two points or of the ends of a line'),
    ),
    h(
      'div',
      { className: 'buttons' },
      action(construction ? 'Normal curve' : 'Construction', ownCurves.length > 0, () =>
        host.run({ type: 'batch', commands: ownCurves.map((id): Command => ({ type: 'setConstruction', sketch: m.id, id, construction: !construction })) }),
      ),
      action('Delete', m.selection.length > 0, () => deleteSelection(host, m), 'Delete'),
    ),
    ...repointRow(host, m),
  );

  // constraints the solver did not get, because they refer to geometry that could not be projected
  const skipped = new Set((host.view().evaluation.features[m.id]?.warnings ?? []).flatMap((w) => (w.code !== 'sketchConflict' && Array.isArray(w.refs) ? w.refs.slice(1) : [])));
  const rows = Object.entries(feature.constraints).flatMap(([id, c]) => {
    const mark = markOf(diagnosis, id);
    const tone = result.conflicting.includes(id) ? 'conflict' : mark ? 'redundant' : '';
    const row = h('div', {
      className: `constraint clickable ${tone} ${m.focus === id ? 'focus' : ''} ${explanation?.impliedBy.includes(id) ? 'implies' : ''}`,
      title:
        tone === 'conflict'
          ? 'In conflict with another constraint'
          : mark === 'duplicate'
            ? 'Duplicate: the sketch already has the same constraint'
            : mark === 'surplus'
              ? 'Surplus: follows from the other constraints. A click shows which ones.'
              : 'A click shows whether the constraint follows from others',
      onmouseenter: () => ((m.hoverConstraint = id), host.renderScene()),
      onmouseleave: () => ((m.hoverConstraint = undefined), host.renderScene()),
      // a click on the row (not on its field and buttons) marks the constraint or clears the mark
      onclick: (event: Event) => {
        if ((event.target as HTMLElement).closest('input, button, label')) return;
        m.focus = m.focus === id ? undefined : id;
        host.renderPanel();
        host.renderScene();
      },
    });
    const tag = mark === 'duplicate' ? ' · duplicate' : mark === 'surplus' ? ' · surplus' : '';
    row.append(h('span', { className: 'name' }, `${constraintName(c.type)} `, h('small', {}, `${operandsOf(c).join(', ')}${tag}`)));
    if (isDimension(c)) {
      const unit: Unit = CONSTRAINTS[c.type].values?.value.unit ?? 'mm';
      const shown = c.driving ? c.value : (result.measurements[id] ?? measure(c, view) ?? c.value);
      const expression: Expr | undefined = c.driving ? feature.expressions?.[constraintPath(id)] : undefined;
      const input = h('input', {
        className: 'value',
        value: fieldText(expression ?? shown, unit),
        disabled: !c.driving,
        title: expression ? `= ${valueText(shown, unit)}` : unit === 'rad' ? 'degrees, or an expression in radians (deg(30))' : 'mm, or an expression',
        oninput: () => {
          const parsed = parseField(input.value, unit);
          markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
        },
        onchange: () => {
          // an empty field does not change the value; an angle number is wrapped into the range the engine accepts
          const parsed = parseField(input.value, unit);
          const value = typeof parsed === 'number' && c.type === 'angle' ? normalizeAngle(parsed) : parsed;
          if (value === undefined || !host.run({ type: 'setConstraintValue', sketch: m.id, id, value }, 'Dimension value changed.')) host.refresh();
        },
      });
      row.append(
        input,
        h(
          'label',
          { className: 'check', title: 'A driving dimension drives the geometry, a reference one only measures it' },
          h('input', {
            type: 'checkbox',
            checked: c.driving,
            // on switching, a reference dimension becomes driving with the value just measured
            onchange: () => !host.run({ type: 'setConstraintValue', sketch: m.id, id, driving: !c.driving, ...(c.driving ? {} : { value: shown }) }) && host.refresh(),
          }),
          'driving',
        ),
      );
    } else {
      // Named values of a constraint that is not a dimension (the coordinates of a fixed point):
      // numeric fields of the sketch, changed one at a time by setField.
      for (const [name, spec] of Object.entries(CONSTRAINTS[c.type].values ?? {})) {
        const path = constraintPath(id, name);
        const current = (c as unknown as Record<string, number>)[name];
        const expression: Expr | undefined = feature.expressions?.[path];
        const input = h('input', {
          className: 'value',
          value: fieldText(expression ?? current, spec.unit),
          title: expression ? `= ${valueText(current, spec.unit)}` : `${spec.unit === 'rad' ? 'degrees, or an expression in radians (deg(30))' : `${spec.unit}, or an expression`}`,
          oninput: () => {
            const parsed = parseField(input.value, spec.unit);
            markProblem(input, typeof parsed === 'string' ? expressionProblem(parsed, 'number', parameterNames) : undefined);
          },
          onchange: () => {
            // an empty field does not change the value
            const value = parseField(input.value, spec.unit);
            if (value === undefined || !host.run({ type: 'setField', feature: m.id, path, value }, `${constraintName(c.type)}: ${spec.title} changed.`)) host.refresh();
          },
        });
        row.append(h('label', { className: 'named' }, spec.title, input));
      }
    }
    row.append(h('button', { className: 'icon', textContent: '✕', title: 'Delete the constraint', onclick: () => host.run({ type: 'removeConstraint', sketch: m.id, id }) }));
    // The explanation is right under the marked row: the rows above it do not move and a second click
    // at the same place clears the mark.
    return m.focus === id && explanation ? [row, h('p', { className: 'explain' }, explanationText(c, id, explanation, diagnosis, label, skipped.has(id)))] : [row];
  });
  out.push(h('h2', {}, `Constraints and dimensions (${Object.keys(feature.constraints).length})`));
  out.push(...(rows.length > 0 ? rows : [h('p', { className: 'hint' }, 'Select entities and add a constraint with the buttons above.')]));

  // The entries of `external`: projections, also those the recompute could not project and the view
  // therefore does not show, and mirrors and patterns. A row by the kind of the entry (REFERENCE_UI);
  // "no geometry" when no entity of it has a position.
  // A derived entry (a mirror or pattern, D68): "no copies" when its count makes none, "n open ends"
  // when the result lists open ends of its copies; a click on its name opens its form.
  const warnings = host.view().evaluation.features[m.id]?.warnings ?? [];
  const index = entityIndex(feature);
  const openEnds = context.result.openEnds;
  const projections = Object.entries(feature.external).flatMap(([id, ref]) => {
    const problem = warnings.find((w) => w.code !== 'sketchConflict' && Array.isArray(w.refs) && w.refs[0] === id);
    const ui = referenceUi(ref);
    const entities = index.byEntry.get(id) ?? [];
    const shown = entities.some((entity) => view.points.has(entity) || view.curves.has(entity));
    const derived = kindOf(ref).source === 'derived';
    const open = derived || ref.type === 'outline' ? (openEnds?.ends ?? []).filter((end) => end.end.startsWith(`${id}/`)) : [];
    const state = derived ? (entities.length === 0 ? ' · no copies' : !shown ? ' · no geometry' : '') : shown ? '' : ' · no geometry';
    const repair = ui.repair?.(ref);
    const form = ui.form;
    const row = h(
      'div',
      {
        // a row whose entity is selected (a copy picked by the select tool, D68) is marked
        className: `constraint ${problem ? 'conflict' : ''} ${m.repair === id ? 'repair' : ''} ${m.entry === id ? 'focus' : ''} ${m.selection.some((selected) => index.entities.get(selected)?.entry === id) ? 'selected' : ''}`,
        title: problem?.message ?? (open.length > 0 ? `${open[0].end}: ${open[0].reason === 'apart' ? `${Math.round(open[0].distance * 1e6) / 1e6} mm from ${open[0].near.join(', ') || 'every other end'}` : `lands where ${open[0].near.join(' and ')} lie without being joined`}` : ''),
        onmouseenter: () => ((m.hover = id), host.renderScene()),
        onmouseleave: () => ((m.hover = undefined), host.renderScene()),
      },
      h(
        'span',
        { className: 'name', ...(form ? { onclick: () => ((m.entry = m.entry === id ? undefined : id), host.renderPanel()) } : {}) },
        `${ui.title(ref)} `,
        h('small', {}, `${id} · ${ui.detail(ref, host)}${state}${open.length > 0 ? ` · ${open.length} open ${open.length === 1 ? 'end' : 'ends'}` : ''}`),
      ),
      ...flagBox(host, m, id, ref, ui),
      ...(ui.file ? outlineFileButton(host, m, ui.file.label, ui.file.title, id) : []),
      repair
        ? h('button', {
            className: 'icon',
            textContent: '↻',
            title: repair.title,
            onclick: () => {
              setTool(host, repair.tool);
              m.repair = id;
              host.say(repair.hint);
              host.renderPanel();
            },
          })
        : null,
      h('button', { className: 'icon', textContent: '✕', title: derived ? 'Remove the mirror or pattern' : 'Remove the projection', onclick: () => host.run({ type: 'removeExternal', sketch: m.id, id }, derived ? 'Mirror or pattern removed.' : 'Projection removed.') }),
    );
    return form && m.entry === id ? [row, entryForm(host, m, feature, id, form)] : [row];
  });
  if (projections.length > 0) out.push(h('h2', {}, `Projections, mirrors and patterns (${projections.length})`), ...projections);
  return out;
}

// The checkbox of the flag of an entry (D69: `regions` of a projection from a sketch), which sends
// `updateExternal` with the flag switched; none where the kind has no flag or the entry none.
function flagBox(host: SketchHost, m: SketchMode, id: Id, ref: ExternalRef, ui: ReturnType<typeof referenceUi>): HTMLElement[] {
  const flag = ui.flag;
  const on = flag?.get(ref);
  if (!flag || on === undefined) return [];
  const box = h('input', { type: 'checkbox', checked: on, onchange: () => host.run({ type: 'updateExternal', sketch: m.id, id, ref: flag.set(ref, box.checked) as Input<ExternalRef> }, box.checked ? `${id} forms regions.` : `${id} forms no regions.`) || host.renderPanel() });
  return [h('label', { className: 'check', title: flag.title }, box, flag.label)];
}

// The form of an entry (D68): the controls of its kind, each over the path of its field in the
// input form (`entryInput`); a change sends `updateExternal` with the whole input form, and an
// invalid one is said with the engine's message.
function entryForm(host: SketchHost, m: SketchMode, feature: SketchFeature, id: Id, form: (input: Input<ExternalRef>) => EntryControl[]): HTMLElement {
  const input = entryInput(feature, id) as Input<ExternalRef>;
  const send = (next: unknown, done: string): void => {
    if (!host.run({ type: 'updateExternal', sketch: m.id, id, ref: next as Input<ExternalRef> }, done)) host.renderPanel();
  };
  const names = host.doc.parameters.map((p) => p.name);
  const context = host.sketchContext();
  // the lines or points that may serve: not copies; of each entry at most the first PICKER_LIMIT of the kind
  const choices = (entity: 'line' | 'point'): Id[] => {
    const own = entity === 'point' ? ['origin', ...Object.keys(feature.points)] : Object.keys(feature.curves).filter((curve) => feature.curves[curve].type === 'line');
    const entries = entryEntities(feature, (kind) => kind === entity).filter((e) => kindOf(feature.external[e.entry]).source !== 'derived').map((e) => e.id);
    return [...own, ...entries, ...(entity === 'line' ? ['origin/x', 'origin/y'] : [])];
  };
  const control = (c: EntryControl): HTMLElement => {
    const value = atPath(input, c.path);
    switch (c.kind) {
      case 'sources': {
        const list = Array.isArray(value) ? (value as Id[]) : [];
        return h(
          'div',
          { className: 'buttons' },
          h('span', { className: 'name' }, `${c.title}: `, h('small', {}, list.length > PICKER_LIMIT ? `${list.slice(0, PICKER_LIMIT).join(', ')} … (${list.length - PICKER_LIMIT} more)` : list.join(', '))),
          h('button', {
            textContent: 'Use selection',
            title: 'The own curves and points selected become the sources',
            onclick: () => {
              const sources = context ? selectedSources(m, context) : [];
              if (sources.length === 0) return host.say('Select the own curves and points to copy first.', true);
              send(withPath(input, c.path, sources), 'Sources changed.');
            },
          }),
        );
      }
      case 'choice': {
        const select = h('select', { onchange: () => send(c.set(input, select.value), `${c.title} changed.`) }, ...c.options.map((option) => h('option', { value: option.value, textContent: option.label, selected: option.value === value })));
        return h('label', {}, c.title, select);
      }
      case 'entity': {
        const ids = choices(c.entity);
        const current = typeof value === 'string' ? value : '';
        const select = h(
          'select',
          { onchange: () => send(withPath(input, c.path, select.value), `${c.title} changed.`) },
          ...(ids.includes(current) ? ids : [current, ...ids]).map((option) => h('option', { value: option, textContent: isOriginAxis(option) ? `${option} (${option === 'origin/x' ? 'X' : 'Y'} axis of the sketch)` : option, selected: option === current })),
        );
        return h('label', {}, c.title, select);
      }
      case 'number': {
        const unit: Unit = c.spec.unit as Unit;
        const field = h('input', {
          className: 'value',
          value: typeof value === 'number' || typeof value === 'string' ? fieldText(value as number | Expr, unit) : '',
          title: 'a number, or an expression',
          oninput: () => {
            const parsed = parseField(field.value, unit);
            markProblem(field, typeof parsed === 'string' ? expressionProblem(parsed, 'number', names) : undefined);
          },
          onchange: () => {
            const parsed = parseField(field.value, unit);
            if (parsed === undefined) return host.renderPanel();
            send(withPath(input, c.path, parsed), `${c.title} changed.`);
          },
        });
        return h('label', {}, c.title, field);
      }
      case 'switch': {
        const box = h('input', {
          type: 'checkbox',
          checked: value !== undefined,
          onchange: () => {
            const keys = c.path.split('/');
            const without = (object: unknown, i: number): unknown => {
              const { [keys[i]]: inner, ...rest } = object as Record<string, unknown>;
              return i === keys.length - 1 ? rest : { ...rest, [keys[i]]: without(inner, i + 1) };
            };
            send(box.checked ? withPath(input, c.path, c.on) : without(input, 0), `${c.title} ${box.checked ? 'on' : 'off'}.`);
          },
        });
        return h('label', { className: 'check' }, box, c.title);
      }
      default:
        return c satisfies never;
    }
  };
  return h('div', { className: 'entry-form' }, ...form(input).map(control));
}
