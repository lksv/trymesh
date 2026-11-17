// Regressions from reviews of the app that no driven form of `app.test.ts` reaches.
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_DIRECTION, SECOND_DIRECTION, axisRows } from '../src/axis-picker';
import { selected } from '../src/panels/args';
import { axisText } from '../src/sketch-commands';
import { jointPicksFace, takeMechanismSelection, type MechanismPanel } from '../src/panels/mechanism';
import { CONTROLS, type Form } from '../src/queries/controls';
import { FEATURE_UI } from '../src/features/index';
import type { DraftMode } from '../src/features/draft';
import type { PatternFeature } from '@trymesh/engine';
import type { PanelHost } from '../src/host';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the grid: the review of D53', () => {
  // the hint that there is no sketch was shown by both pickers of a grid
  it('a picker with an empty hint shows none; with a hint it shows it', async () => {
    harness = await startApp();
    const host = {} as PanelHost; // a base axis reads nothing of the host
    const X = { kind: 'base', axis: 'X' } as const;
    const hints = (rows: HTMLElement[]): string[] => rows.filter((row) => row.className === 'hint').map((row) => row.textContent ?? '');
    expect(hints(axisRows(host, X, [], () => undefined, 'Needs a sketch.', FIRST_DIRECTION))).toEqual(['Needs a sketch.']);
    expect(hints(axisRows(host, X, [], () => undefined, '', SECOND_DIRECTION))).toEqual([]);
  });
});

describe('the axis of a round face in the app (D60)', () => {
  const host = { featureNames: (id: string) => ({ e: 'Boss' })[id], bodyName: (id: string) => `body ${id}`, nameOf: (id: string) => id } as unknown as PanelHost;
  const options = (rows: HTMLElement[]): string[] => Array.from(rows[0].querySelectorAll('option')).map((option) => option.value);
  const PIN = { kind: 'face', body: 'b', face: { feature: 'e', role: 'side', curve: 'k' } } as const;

  it('the picker offers the kind where a form can pick a face, and shows a face the axis has; choosing the kind arms the pick', async () => {
    harness = await startApp();
    const X = { kind: 'base', axis: 'X' } as const;
    expect(options(axisRows(host, X, [], () => undefined, ''))).not.toContain('face');
    let armed = 0;
    const pick = { armed: false, arm: () => void armed++ };
    const rows = axisRows(host, X, [], () => undefined, '', undefined, pick);
    expect(options(rows)).toContain('face');
    const select = rows[0].querySelector('select') as HTMLSelectElement;
    select.value = 'face';
    select.dispatchEvent(new (harness.document.defaultView as unknown as typeof globalThis).Event('change'));
    expect(armed).toBe(1);
    // armed: the kind shows as chosen and the hint says what to click
    const waiting = axisRows(host, X, [], () => undefined, '', undefined, { armed: true, arm: () => undefined });
    expect((waiting[0].querySelector('option[selected]') as HTMLOptionElement | null)?.value ?? (waiting[0].querySelector('select') as HTMLSelectElement).value).toBe('face');
    expect(waiting.map((row) => row.textContent)).toContain('Click a cylinder, a cone or a torus in the view: its axis.');
    // an axis of a face without a pick (the revolve form) is still shown
    const shown = axisRows(host, PIN, [], () => undefined, '');
    expect(options(shown)).toContain('face');
    expect(shown.map((row) => row.textContent)).toContain('Face: Boss – bok (body b)');
  });

  it('the text of the axis, and a pick of the view for the axis argument of a query', () => {
    expect(axisText(PIN, (id) => id, (body, face) => `${face.feature} of ${body}`)).toBe('the axis of e of b');
    const spec = { kind: 'axis' } as const;
    expect(selected(spec, { kind: 'face', body: 'b', faceId: 3, name: PIN.face, planar: false })).toEqual(PIN);
    expect(selected(spec, { kind: 'face', body: 'b', faceId: 4, name: { feature: 'e', role: 'endCap' }, planar: true })).toBeUndefined();
  });
});

describe('the axis of a round face in the app: the review of D60', () => {
  const PIN_FACE = { feature: 'e', role: 'side', curve: 'k' } as const;
  const roundPick = { kind: 'face', body: 'b', faceId: 0, name: PIN_FACE, planar: false } as const;
  const flatPick = { kind: 'face', body: 'b', faceId: 1, name: { feature: 'e', role: 'endCap' }, planar: false } as const;
  // a host whose view has a cylinder as face 0 and a sphere as face 1
  const said: string[] = [];
  const host = {
    view: () => ({ evaluation: { faceSurfaces: [{ kind: 'cylinder' }, { kind: 'sphere' }], bodies: {} } }),
    say: (text: string) => void said.push(text),
    featureNames: (id: string) => ({ e: 'Boss', n: 'Pins' })[id],
    bodyName: (id: string) => `body ${id}`,
    nameOf: (id: string) => id,
  } as unknown as PanelHost;
  const jointForm = (type: 'revolute' | 'fixed'): MechanismPanel => ({ form: { kind: 'joint', editing: false, id: 'j', name: '', type, parent: 'a', child: 'c', axis: { kind: 'base', axis: 'Z' }, numbers: {}, picking: true } });

  // a pick armed and the kind changed to fixed kept taking every click of the view
  it('the form of a joint: a fixed joint picks nothing; a face without an axis is refused and the pick stays; a round face is taken', () => {
    const fixed = jointForm('fixed');
    expect(jointPicksFace(fixed)).toBe(false);
    expect(takeMechanismSelection(host, fixed, roundPick)).toBe(false);
    const panel = jointForm('revolute');
    expect(jointPicksFace(panel)).toBe(true);
    expect(takeMechanismSelection(host, panel, flatPick)).toBe(true);
    expect(panel.form).toMatchObject({ picking: true, axis: { kind: 'base' } });
    expect(said.at(-1)).toMatch(/a cylinder, a cone or a torus/);
    expect(takeMechanismSelection(host, panel, roundPick)).toBe(true);
    expect(panel.form).toMatchObject({ picking: false, axis: { kind: 'face', body: 'b', face: PIN_FACE } });
    expect(jointPicksFace(panel)).toBe(false);
  });

  // choosing another kind left the pick armed, and the next click on a round face replaced it
  it('the axis control of a query: another kind stops the pick armed for the face', async () => {
    harness = await startApp();
    let armed: unknown = ['about'];
    const form = { host, armed, arm: (path: unknown) => void (armed = path), set: () => undefined, get: () => undefined, title: (_spec: unknown, name: string) => name } as unknown as Form;
    const select = CONTROLS.axis({ kind: 'axis' }, { kind: 'face' }, ['about'], form, {})[0] as HTMLSelectElement;
    select.value = 'X';
    select.dispatchEvent(new (harness.document.defaultView as unknown as typeof globalThis).Event('change'));
    expect(armed).toBeUndefined();
    select.value = 'face';
    select.dispatchEvent(new (harness.document.defaultView as unknown as typeof globalThis).Event('change'));
    expect(armed).toEqual(['about']);
  });

  // the summary of a pattern has branches of its own for a face, which no snapshot reached for a direction
  it('the summary of a pattern names the face of its axis and of each direction', () => {
    const linear = { id: 'n', name: 'Pins', suppressed: false, type: 'pattern', source: { type: 'body', body: 'b' }, transform: { type: 'linear', direction: { kind: 'face', body: 'b', face: PIN_FACE }, count: 2, span: { type: 'spacing', spacing: 5 }, second: { direction: { kind: 'face', body: 'c', face: PIN_FACE }, count: 2, span: { type: 'spacing', spacing: 5 } } } } as PatternFeature;
    const text = FEATURE_UI.pattern.summary(host, linear as never, undefined)[0].textContent;
    expect(text).toContain('along the axis of the face Boss – bok of body b, spacing 5 mm, and along the axis of the face Boss – bok of body c');
  });

  // a face of the copies the previewed pattern makes is refused as its axis, as for the plane of a mirror
  it('the pattern form refuses the axis of a face of its own copies', () => {
    const form = FEATURE_UI.pattern.form as NonNullable<typeof FEATURE_UI.pattern.form>;
    const draft = { id: 'n', name: 'Pattern 1', suppressed: false, type: 'pattern', source: { type: 'body', body: 'b' }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 3, span: { type: 'full' } } } as const;
    const m = { kind: 'draft', form, editing: false, index: 0, draft, extra: { pickingAxis: 'first' } } as unknown as DraftMode<PatternFeature, unknown>;
    const formHost = { ...host, doc: { features: [] }, stateBefore: () => ({ evaluation: { bodies: { b: {} } } }), feature: () => undefined } as unknown as PanelHost;
    form.click?.(m as never, {} as PointerEvent, { ...roundPick, body: 'n/1', name: { ...PIN_FACE, copy: [{ pattern: 'n', index: 1 }] } }, formHost);
    expect(said.at(-1)).toMatch(/a face the pattern itself makes/);
    expect((m.draft as PatternFeature).transform).toMatchObject({ axis: { kind: 'base', axis: 'Z' } });
  });
});
