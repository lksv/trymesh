// Regressions from reviews of the app that no driven form of `app.test.ts` reaches.
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_DIRECTION, SECOND_DIRECTION, axisRows } from '../src/axis-picker';
import { selected } from '../src/panels/args';
import { axisText } from '../src/sketch-commands';
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
