// The panel of the parameters and the checks of the document.
import { h, markProblem } from '../dom';
import { expressionProblem, plainNumber } from '../fields';
import type { PanelHost } from '../host';

const CHECK_STATUS = { ok: '✓ holds', failed: '✗ fails', error: '! cannot be evaluated' };

export function parametersPanel(host: PanelHost): HTMLElement[] {
  const { document: doc, evaluation } = host.engine.getState();
  const expr = (value: string, kind: 'number' | 'check', commit: (text: string) => boolean): HTMLInputElement => {
    const input = h('input', {
      className: 'expr',
      value,
      placeholder: kind === 'number' ? 'expression, e.g. 2 * a' : 'condition, e.g. a < b',
      oninput: () => markProblem(input, input.value.trim() === '' ? undefined : expressionProblem(input.value, kind)),
      onchange: () => {
        if (input.value.trim() === value || !commit(input.value)) host.refresh();
      },
    });
    return input;
  };
  const rename = (value: string, title: string, commit: (text: string) => boolean): HTMLInputElement => {
    const input = h('input', { className: 'pname', value, title, onchange: () => (input.value.trim() === value || !commit(input.value.trim())) && host.refresh() });
    return input;
  };
  const adder = (label: string, kind: 'number' | 'check', add: (name: string, text: string) => boolean): HTMLElement => {
    const name = h('input', { className: 'pname', placeholder: 'name' });
    const value = expr('', kind, () => true);
    value.onchange = null;
    const submit = () => {
      if (name.value.trim() === '' || value.value.trim() === '') return host.say(`${label}: fill in both the name and the expression.`, true);
      add(name.value.trim(), value.value);
    };
    for (const input of [name, value]) input.onkeydown = (event: KeyboardEvent) => event.key === 'Enter' && submit();
    return h('div', { className: 'constraint' }, name, value, h('button', { textContent: 'Add', onclick: submit }));
  };

  const out: HTMLElement[] = [h('h2', {}, `Parameters (${doc.parameters.length})`)];
  for (const p of doc.parameters) {
    const result = evaluation.parameters[p.name];
    out.push(
      h(
        'div',
        { className: `constraint ${result && !result.ok ? 'conflict' : ''}`, title: result && !result.ok ? result.error.message : '' },
        rename(p.name, 'Parameter name; renaming also rewrites the expressions that use it', (to) => host.run({ type: 'renameParameter', name: p.name, to }, 'Parameter renamed.')),
        expr(p.expr, 'number', (text) => host.run({ type: 'setParameter', name: p.name, expr: text })),
        h('small', { className: 'computed' }, result?.ok ? `= ${plainNumber(result.value)}` : 'error'),
        h('button', { className: 'icon', textContent: '✕', title: 'Delete parameter', onclick: () => host.run({ type: 'removeParameter', name: p.name }, `Parameter ${p.name} deleted. Expressions that use it report an error.`) }),
      ),
    );
  }
  out.push(
    adder('Parameter', 'number', (name, text) => {
      if (doc.parameters.some((p) => p.name === name)) return host.say(`Parameter ${name} already exists.`, true), false;
      return host.run({ type: 'setParameter', name, expr: text }, `Parameter ${name} added.`);
    }),
    h('p', { className: 'hint' }, 'An expression can be typed into numeric fields and dimensions instead of a number. Angles in an expression are in radians; write degrees as deg(30).'),
    h('h2', {}, `Checks (${doc.checks.length})`),
  );
  for (const c of doc.checks) {
    const result = evaluation.checks[c.name];
    const status = result?.status ?? 'error';
    out.push(
      h(
        'div',
        { className: `constraint ${status === 'ok' ? '' : status === 'failed' ? 'redundant' : 'conflict'}`, title: result?.error?.message ?? '' },
        rename(c.name, 'Check name', (to) => host.run({ type: 'renameCheck', name: c.name, to })),
        expr(c.expr, 'check', (text) => host.run({ type: 'setCheck', name: c.name, expr: text })),
        h('small', { className: 'computed' }, CHECK_STATUS[status]),
        h('button', { className: 'icon', textContent: '✕', title: 'Delete check', onclick: () => host.run({ type: 'removeCheck', name: c.name }) }),
      ),
    );
  }
  out.push(
    adder('Check', 'check', (name, text) => {
      if (doc.checks.some((c) => c.name === name)) return host.say(`Check "${name}" already exists.`, true), false;
      return host.run({ type: 'setCheck', name, expr: text }, 'Check added.');
    }),
  );
  return out;
}
