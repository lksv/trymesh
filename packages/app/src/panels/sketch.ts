// The panel of the sketch mode: the status of the sketch, its diagnosis, the buttons of the
// selection, the list of constraints and dimensions, the projected geometry, the options of the
// active tool (its entry of SKETCH_TOOL_UI), and the row that re-points a point of a curve (D52).
import { type Command, type Expr, type Id, type SketchDiagnosis, type Unit, CONSTRAINTS, CURVE_POINTS, type Constraint, type CurvePointName, constraintPath, isDimension, nearestCurvePoint, referenceEntities } from '@trymesh/engine';
import { h, markProblem } from '../dom';
import { expressionProblem, fieldText, parseField, valueText } from '../fields';
import { CURVE_POINT_LABELS, type DimensionVariant, GEOMETRIC_KINDS, dimensionFor, geometricFor, normalizeAngle, repointSelection } from '../sketch-commands';
import { duplicateTwins, explanationText, freeSummary, markOf } from '../sketch-diagnosis';
import { type SketchHost, type SketchMode, addConstraints, deleteSelection, explain, setTool, toolOptions } from '../sketch-mode';
import { SKETCH_TOOL_UI } from '../sketch-tools';
import { measure, operandsOf } from '../sketch-view';
import { referenceUi } from '../references';

// Jména vazeb jsou v katalogu enginu; nová vazba se tu objeví sama.
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
  if (!context) return [h('p', { className: 'issue error' }, result?.status === 'suppressed' ? 'Skica je potlačená.' : 'Skicu nelze zobrazit: její rovina není k dispozici.'), ...host.issues(result)];
  const r = context.result;
  const unsolved = result?.warnings.some((w) => w.code === 'sketchConflict') === true; // stupně volnosti pak nic neříkají
  const empty = Object.keys(context.feature.points).length + Object.keys(context.feature.curves).length === 0;
  const state =
    r.conflicting.length > 0
      ? ['Vazby jsou v konfliktu', 'error']
      : unsolved
        ? ['Skicu se nepodařilo vyřešit', 'error']
        : empty
          ? ['Prázdná skica', 'open']
          : r.degreesOfFreedom === 0
            ? ['Plně určená', 'ok']
            : [`Stupně volnosti: ${r.degreesOfFreedom}`, 'open'];
  return [
    h('p', { className: `badge ${state[1]}` }, state[0]),
    r.valid ? h('p', { className: 'hint' }, `Uzavřených oblastí: ${r.regions.length}`) : h('p', { className: 'issue error' }, 'Profil je neplatný: křivky se kříží nebo dotýkají mimo spojené body, nebo jsou si blíž, než rozliší dělení oblouků.'),
    ...host.issues(result).filter((element) => !element.classList.contains('error') || r.valid),
  ];
}

// Při tažení se panel nepřestavuje, jen stav určenosti.
export function updateSketchStatus(host: SketchHost, m: SketchMode): void {
  document.getElementById('sketch-status')?.replaceChildren(...sketchStatus(host, m));
}

// Souhrn diagnostiky pod stavem skici: vazby navíc a co se ještě může hýbat.
function diagnosisSummary(host: SketchHost, m: SketchMode, d: SketchDiagnosis): HTMLElement[] {
  const out: HTMLElement[] = [];
  const twins = duplicateTwins(d);
  const removeTwins = (): HTMLElement => {
    const commands = twins.map((id): Command => ({ type: 'removeConstraint', sketch: m.id, id }));
    return h('div', { className: 'buttons' }, h('button', { textContent: `Smazat duplicity (${twins.length})`, onclick: () => host.run({ type: 'batch', commands }, twins.length === 1 ? 'Duplicitní vazba smazána.' : 'Duplicitní vazby smazány.') }));
  };
  if (d.status !== 'solved') {
    // duplicity engine hlásí i u nevyřešené skici; jejich smazání může konflikt odstranit
    if (twins.length > 0) out.push(h('p', { className: 'issue warning' }, `Duplicitní vazby: ${twins.length}. V seznamu jsou označené.`), removeTwins());
    return out;
  }
  if (d.removable.length > 0) {
    out.push(
      h('p', { className: 'issue warning' }, `Vazby navíc: ${d.removable.length}${twins.length > 0 ? `, z toho duplicity: ${twins.length}` : ''}. V seznamu jsou označené; kliknutím na vazbu se ukáže, z čeho plyne.`),
    );
    if (twins.length > 0) out.push(removeTwins());
  }
  const free = freeSummary(d);
  if (free !== undefined) {
    const select = d.free.map((entity) => entity.id);
    out.push(
      h('p', { className: 'hint' }, free),
      h('div', { className: 'buttons' }, h('button', { textContent: 'Vybrat volné', title: 'Vybere volné body a kružnice s volným poloměrem', onclick: () => ((m.selection = select), host.refresh()) })),
    );
  }
  return out;
}

export function sketchPanel(host: SketchHost, m: SketchMode): HTMLElement[] {
  const context = host.sketchContext();
  const out: HTMLElement[] = [h('h2', {}, `Skica: ${host.nameOf(m.id)}`), h('div', { id: 'sketch-status' }, ...sketchStatus(host, m))];
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

  const dimension = (label: string, variant: DimensionVariant, title: string) => {
    const d = dimensionFor(variant, view, m.selection);
    return action(label, d !== undefined, () => addConstraints(host, m, d && [d]), title);
  };
  const ownCurves = m.selection.filter((id) => feature.curves[id]);
  const construction = ownCurves.length > 0 && ownCurves.every((id) => feature.curves[id].construction);
  out.push(
    h('h2', {}, `Výběr (${m.selection.length})`),
    h(
      'div',
      { className: 'buttons' },
      // tlačítko pro každou geometrickou vazbu z katalogu enginu; nápověda je její popis
      ...GEOMETRIC_KINDS.map((kind) => {
        const constraints = geometricFor(kind, view, m.selection);
        return action(constraintName(kind), constraints !== undefined, () => addConstraints(host, m, constraints), CONSTRAINTS[kind].summary);
      }),
    ),
    h(
      'div',
      { className: 'buttons' },
      dimension('Kóta', 'auto', 'Dva body nebo úsečka: vzdálenost; bod a úsečka: vzdálenost; dvě úsečky: úhel; kružnice: průměr; oblouk: poloměr'),
      dimension('Kóta ↔', 'horizontal', 'Vodorovná vzdálenost dvou bodů nebo konců úsečky'),
      dimension('Kóta ↕', 'vertical', 'Svislá vzdálenost dvou bodů nebo konců úsečky'),
    ),
    h(
      'div',
      { className: 'buttons' },
      action(construction ? 'Běžná křivka' : 'Konstrukční', ownCurves.length > 0, () =>
        host.run({ type: 'batch', commands: ownCurves.map((id): Command => ({ type: 'setConstruction', sketch: m.id, id, construction: !construction })) }),
      ),
      action('Smazat', m.selection.length > 0, () => deleteSelection(host, m), 'Delete'),
    ),
    ...repointRow(host, m),
  );

  // vazby, které solver nedostal, protože odkazují na geometrii, kterou nešlo promítnout
  const skipped = new Set((host.view().evaluation.features[m.id]?.warnings ?? []).flatMap((w) => (w.code !== 'sketchConflict' && Array.isArray(w.refs) ? w.refs.slice(1) : [])));
  const rows = Object.entries(feature.constraints).flatMap(([id, c]) => {
    const mark = markOf(diagnosis, id);
    const tone = result.conflicting.includes(id) ? 'conflict' : mark ? 'redundant' : '';
    const row = h('div', {
      className: `constraint clickable ${tone} ${m.focus === id ? 'focus' : ''} ${explanation?.impliedBy.includes(id) ? 'implies' : ''}`,
      title:
        tone === 'conflict'
          ? 'V konfliktu s jinou vazbou'
          : mark === 'duplicate'
            ? 'Duplicita: stejnou vazbu už skica má'
            : mark === 'surplus'
              ? 'Navíc: plyne z ostatních vazeb. Kliknutím se ukáže, ze kterých.'
              : 'Kliknutím se ukáže, jestli vazba plyne z jiných',
      onmouseenter: () => ((m.hoverConstraint = id), host.renderScene()),
      onmouseleave: () => ((m.hoverConstraint = undefined), host.renderScene()),
      // klik na řádek (ne na jeho pole a tlačítka) vazbu označí nebo označení zruší
      onclick: (event: Event) => {
        if ((event.target as HTMLElement).closest('input, button, label')) return;
        m.focus = m.focus === id ? undefined : id;
        host.renderPanel();
        host.renderScene();
      },
    });
    const tag = mark === 'duplicate' ? ' · duplicita' : mark === 'surplus' ? ' · navíc' : '';
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
          if (value === undefined || !host.run({ type: 'setConstraintValue', sketch: m.id, id, value }, 'Hodnota kóty změněna.')) host.refresh();
        },
      });
      row.append(
        input,
        h(
          'label',
          { className: 'check', title: 'Řídicí kóta geometrii určuje, referenční ji jen měří' },
          h('input', {
            type: 'checkbox',
            checked: c.driving,
            // referenční kóta se při přepnutí stane řídicí s právě naměřenou hodnotou
            onchange: () => !host.run({ type: 'setConstraintValue', sketch: m.id, id, driving: !c.driving, ...(c.driving ? {} : { value: shown }) }) && host.refresh(),
          }),
          'řídicí',
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
    row.append(h('button', { className: 'icon', textContent: '✕', title: 'Smazat vazbu', onclick: () => host.run({ type: 'removeConstraint', sketch: m.id, id }) }));
    // Vysvětlení je hned pod označeným řádkem: řádky nad ním se nehnou a druhé kliknutí
    // na stejném místě označení zruší.
    return m.focus === id && explanation ? [row, h('p', { className: 'explain' }, explanationText(c, id, explanation, diagnosis, label, skipped.has(id)))] : [row];
  });
  out.push(h('h2', {}, `Vazby a kóty (${Object.keys(feature.constraints).length})`));
  out.push(...(rows.length > 0 ? rows : [h('p', { className: 'hint' }, 'Vyberte entity a přidejte vazbu tlačítky výše.')]));

  // Promítnutá geometrie: i ta, kterou přepočet nedokázal promítnout a v pohledu proto není vidět.
  // A row by the kind of the entry (REFERENCE_UI); "bez geometrie" when no entity of it has a position.
  const warnings = host.view().evaluation.features[m.id]?.warnings ?? [];
  const projections = Object.entries(feature.external).map(([id, ref]) => {
    const problem = warnings.find((w) => w.code !== 'sketchConflict' && Array.isArray(w.refs) && w.refs[0] === id);
    const ui = referenceUi(ref);
    const shown = Object.keys(referenceEntities(feature, id)).some((entity) => view.points.has(entity) || view.curves.has(entity));
    const repair = ui.repair;
    return h(
      'div',
      {
        className: `constraint ${problem ? 'conflict' : ''} ${m.repair === id ? 'repair' : ''}`,
        title: problem?.message ?? '',
        onmouseenter: () => ((m.hover = id), host.renderScene()),
        onmouseleave: () => ((m.hover = undefined), host.renderScene()),
      },
      h('span', { className: 'name' }, `${ui.title(ref)} `, h('small', {}, `${id} · ${ui.detail(ref, host)}${shown ? '' : ' · bez geometrie'}`)),
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
      h('button', { className: 'icon', textContent: '✕', title: 'Zrušit promítnutí', onclick: () => host.run({ type: 'removeExternal', sketch: m.id, id }, 'Promítnutí zrušeno.') }),
    );
  });
  if (projections.length > 0) out.push(h('h2', {}, `Promítnutá geometrie (${projections.length})`), ...projections);
  return out;
}
