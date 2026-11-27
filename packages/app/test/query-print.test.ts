// The view of the query `print` (D42) over answers written by hand: what the model of
// `app.test.ts` has no body for (a body on several faces, a face named that does not lie on the
// bed, an answer without bodies). The page of the tests is the one of `app.test.ts`.
import type { FaceName, PrintOrientation, PrintReport, QueryArgs } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { ViewPanel } from '../src/queries';
import { printView } from '../src/queries/print';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

const face = (feature: string, role: 'startCap' | 'endCap' = 'startCap'): FaceName => ({ feature, role });
const panelOf = (picked?: number): ViewPanel<'print'> =>
  ({ bodyName: (body: string) => `body ${body}`, faceLabel: (name: FaceName) => `${name.feature}/${name.role}`, number: (value: number, unit: string) => `${value} ${unit}`, picked, pick: () => undefined, ask: () => undefined }) as unknown as ViewPanel<'print'>;
const texts = (elements: HTMLElement[]): string[] => elements.flatMap((element) => (element.className === 'tree' ? Array.from(element.children).map((child) => child.textContent ?? '') : [element.textContent ?? '']));
const way = (parts: Partial<PrintOrientation>): PrintOrientation => ({ up: [0, 0, 1], size: [40, 30, 10], contact: { area: 0, count: 0, faces: [] }, overhang: { area: 0, count: 0, small: 0, faces: [] }, ...parts });

describe('the view of the query print', () => {
  // review of D42, the app side
  it('a face is named only on the row of its body, a turn is said, and a face that does not lie on the bed is a warning', async () => {
    harness = await startApp();
    const onBed = { kind: 'face' as const, body: 'a', face: face('a', 'endCap') };
    const args: QueryArgs<'print'> = { orientations: [{ by: { onBed }, turn: Math.PI / 6 }, { by: { up: [0, 0, 2] } }] };
    const result: PrintReport = {
      angle: Math.PI / 4,
      bodies: [
        { body: 'a', orientations: [way({ up: [0, 0, -1], onBed: false, fits: false }), way({ fits: true })] },
        { body: 'b', orientations: [way({ up: [0, 0, -1] }), way({})] },
      ],
    };
    const shown = texts(printView.answer?.(result, args, panelOf()) ?? []);
    expect(shown).toEqual([
      `body a · on a/endCap, turned ${Math.PI / 6} radno overhang`,
      'Height 10 mm; nothing flat on the bed.',
      'Does not fit the bed: 40 mm × 30 mm × 10 mm.',
      'The face named does not lie on the bed: something of the body reaches below it.',
      'body a · up 0, 0, 1no overhang',
      'Height 10 mm; nothing flat on the bed.',
      // the face of another body only gives the direction
      `body b · up 0, 0, -1, turned ${Math.PI / 6} radno overhang`,
      'Height 10 mm; nothing flat on the bed.',
      'body b · up 0, 0, 1no overhang',
      'Height 10 mm; nothing flat on the bed.',
    ]);
    expect(printView.note?.(result, panelOf())).toEqual({ text: 'Print check: 2 bodies in 2 orientations. 1 of 4 do not fit the bed. Pick a row to see its faces.', error: false });
  });

  it('a picked row says what each of its lists leaves out and paints what it lists, on its own body', async () => {
    harness = await startApp();
    const args: QueryArgs<'print'> = { orientations: [{ by: { up: [0, 0, 1] } }], maxFaces: 1 };
    const standing = way({
      contact: { area: 30.004, count: 2, faces: [{ face: face('foot'), area: 18 }] },
      overhang: { area: 50.5, count: 4, small: 1, faces: [{ face: face('roof'), area: 40.126, from: 12.3456 }] },
    });
    const result: PrintReport = { angle: Math.PI / 4, bodies: [{ body: 'a', orientations: [way({})] }, { body: 'b', orientations: [standing] }], truncated: { shown: 2, total: 5 } };
    const shown = texts(printView.answer?.(result, args, panelOf(1)) ?? []);
    expect(shown.slice(2)).toEqual([
      'body b · up 0, 0, 1overhang 50.5 mm2',
      'Height 10 mm; 30 mm2 on the bed on 2 faces; overhang on 4 faces.',
      'Painted in the view: on the bed blue, overhanging red. They look away from what is up, so they may be on the far side of the model.',
      'roof/startCap: 40.13 mm2, from 12.35 mm above the bed',
      '1 of 2 faces on the bed painted; 1 of 3 overhanging faces listed; 1 overhang below the smallest area listed.',
      'Listed: 2 of 5 faces on the bed or overhanging by the smallest area listed or more. Raise "Most faces" to see the rest.',
    ]);
    // the rows are counted through all bodies: the second row is the body b
    expect(printView.scene?.(result, args, panelOf(1)).faces?.map((entry) => [entry.body, entry.face.feature])).toEqual([['b', 'foot'], ['b', 'roof']]);
    expect(printView.scene?.(result, args, panelOf(0))).toEqual({ faces: [] });
    // a pick left over from an answer with more rows paints nothing
    expect(printView.scene?.(result, args, panelOf(7))).toEqual({});
    expect(printView.scene?.(result, args, panelOf())).toEqual({});
  });

  it('the bodies with cosmetic threads are said after the rows (D76)', async () => {
    harness = await startApp();
    const result: PrintReport = { angle: Math.PI / 4, bodies: [{ body: 'a', orientations: [way({})] }], cosmeticThreads: [{ body: 'a', threads: 6 }] };
    expect(texts(printView.answer?.(result, { orientations: [{ by: { up: [0, 0, 1] } }] }, panelOf()) ?? []).slice(2)).toEqual(['Cosmetic threads, not in the mesh and not judged here: body a (6). Tap or cut them after printing.']);
  });

  it('an answer without bodies says so, and its note does not offer a row to pick', async () => {
    harness = await startApp();
    const result: PrintReport = { angle: Math.PI / 4, bodies: [] };
    expect(texts(printView.answer?.(result, { orientations: [{ by: { up: [0, 0, 1] } }] }, panelOf()) ?? [])).toEqual(['The model has no body to print.']);
    expect(printView.note?.(result, panelOf())).toEqual({ text: 'Print check: 0 bodies in 0 orientations.', error: false });
  });
});
