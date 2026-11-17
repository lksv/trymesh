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
import { emptyDocument, emptySketch } from '@trymesh/engine';
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

describe('the inserted document: the review of D62', () => {
  // a disc of the height `H` and a pin, as a document file holds it
  const part = {
    ...emptyDocument(),
    parameters: [{ name: 'H', expr: '5' }],
    features: [
      { ...emptySketch('s', 'Disc', { kind: 'base', plane: 'XY' }), curves: { c: { type: 'circle', center: 'origin' } }, radii: { c: 5 } },
      { id: 'disc', name: 'Disc', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new', expressions: { 'extent/distance': 'H' } },
      { id: 'pin', name: 'Pin', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 20, distance: 2 }, operation: 'new' },
    ],
  };
  const start = async (): Promise<Harness> => {
    const h = (harness = await startApp());
    const done = h.engine.execute({
      type: 'batch',
      commands: [
        { type: 'addDocument', id: 'a', document: part as never },
        { type: 'addDocument', id: 'b', document: part as never },
        { type: 'addFeature', feature: { id: 'i1', name: 'Part 1', suppressed: false, type: 'insert', document: 'a', placement: { frame: { kind: 'base', plane: 'XY' } }, parameters: { H: 8 }, bodies: ['disc'] } },
      ],
    });
    expect(done.ok).toBe(true);
    h.row('Part 1').dispatchEvent(new (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('dblclick'));
    return h;
  };

  // an edit that chose another stored document kept the values (merged key by key) and the list
  it('another stored document in the edit removes the values the feature had and its list of bodies', async () => {
    const h = await start();
    h.choose('Stored document', 'b');
    h.timers();
    h.press('panel', 'OK');
    expect(h.engine.getState().document.features[0]).toEqual({ id: 'i1', name: 'Part 1', suppressed: false, type: 'insert', document: 'b', placement: { frame: { kind: 'base', plane: 'XY' } } });
    expect(h.engine.getState().evaluation.features.i1.bodies).toEqual(['i1/disc', 'i1/pin']);
  });

  // the boxes of the bodies were kept by the place of the ID, not by the stored entry
  it('a revision of the stored document while the form is open lists its bodies again', async () => {
    const h = await start();
    const boxes = (): string[] => Array.from(h.document.querySelectorAll<HTMLElement>('#panel label.check')).map((label) => label.textContent ?? '');
    expect(boxes()).toEqual(['disc', 'pin']);
    const third = { ...part, features: [...part.features, { ...part.features[2], id: 'cap', name: 'Cap', extent: { type: 'distance', start: 30, distance: 2 } }] };
    expect(h.engine.execute({ type: 'replaceDocument', id: 'a', document: third as never }).ok).toBe(true);
    expect(h.document.querySelector('#panel h2')?.textContent).toBe('Edit: Part 1');
    expect(boxes()).toEqual(['disc', 'pin', 'cap']);
  });

  // a value of a parameter the stored document no longer has could not be emptied in the form
  it('a value the stored document does not have has its field and can be emptied', async () => {
    const h = await start();
    expect(h.engine.execute({ type: 'replaceDocument', id: 'a', document: { ...part, parameters: [], features: part.features.map((f) => (f.id === 'disc' ? { ...f, expressions: undefined } : f)) } as never }).ok).toBe(true);
    h.row('Part 1').dispatchEvent(new (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('dblclick'));
    h.type(h.field('H (not in the stored document)'), '');
    h.timers();
    h.press('panel', 'OK');
    expect(h.engine.getState().document.features[0]).not.toHaveProperty('parameters');
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

describe('the edge picker on an inserted body (D62 with D63)', () => {
  // a disc of the radius 5 and the height 5 as a stored document, inserted, its top edge chamfered
  const part = {
    ...emptyDocument(),
    features: [
      { ...emptySketch('s', 'Disc', { kind: 'base', plane: 'XY' }), curves: { c: { type: 'circle', center: 'origin' } }, radii: { c: 5 } },
      { id: 'disc', name: 'Disc', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['c'] }] }, extent: { type: 'distance', start: 0, distance: 5 }, operation: 'new' },
    ],
  };
  it('lists the edge by the insertion and the names there, of its kind on the body, and the chamfer is computed', async () => {
    const h = (harness = await startApp());
    const edge = { a: { feature: 'i1/disc', role: 'endCap' }, b: { feature: 'i1/disc', role: 'side', curve: 'c' } };
    const done = h.engine.execute({
      type: 'batch',
      commands: [
        { type: 'addDocument', id: 'a', document: part as never },
        { type: 'addFeature', feature: { id: 'i1', name: 'Part 1', suppressed: false, type: 'insert', document: 'a', placement: { frame: { kind: 'base', plane: 'XY' } } } },
        { type: 'addFeature', feature: { id: 'k', name: 'Chamfer 1', suppressed: false, type: 'chamfer', body: 'i1/disc', edges: [edge as never], distance: 1 } },
      ],
    });
    expect(done.ok).toBe(true);
    expect(h.engine.getState().evaluation.features.k.status).toBe('ok');
    h.row('Chamfer 1').dispatchEvent(new (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('dblclick'));
    const item = Array.from(h.document.querySelectorAll<HTMLElement>('#panel li')).map((li) => li.textContent ?? '');
    expect(item).toHaveLength(1);
    expect(item[0]).toContain('Part 1 › Disc');
    expect(item[0]).not.toContain('not on the body');
  });
});

