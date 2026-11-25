// The import of an outline in the app (D72): the button of the sketch panel, the draft with the
// report (a layer chosen, the file read again), Place, the row of the entry (its counts, its form,
// its flag, its open ends), Replace file… through the draft with the stored options and with the
// constraints that hold what goes removed, and a picker over an outline above the limit.
import { type Command, type SketchFeature, type SketchOutline, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { boardDxf } from '../../engine/test/outline-kit';
import { PICKER_LIMIT, entryEntities, omittedNotes } from '../src/references';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});
const sketchOf = (h: Harness): SketchFeature => h.engine.getState().document.features.find((f) => f.id === 's') as SketchFeature;
const status = (h: Harness): string => h.document.getElementById('status')?.textContent ?? '';
const panel = (h: Harness): string => h.document.getElementById('panel')?.textContent ?? '';
const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((done) => setTimeout(done, 5));
  if (!condition()) throw new Error(`waited in vain for ${what}`);
};
async function choose(h: Harness, id: string, name: string, text: string): Promise<void> {
  const input = h.document.getElementById(id) as HTMLInputElement;
  const FileOf = (h.document.defaultView as unknown as { File: typeof File }).File;
  Object.defineProperty(input, 'files', { value: [new FileOf([text], name)], configurable: true });
  const before = panel(h);
  h.type(input, '', true);
  await until(() => panel(h) !== before || status(h).includes(name), 'the file to be read');
}
const box = (h: Harness, starts: string): HTMLInputElement => {
  const label = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((l) => l.textContent?.startsWith(starts));
  if (!label) throw new Error(`no checkbox ${starts}`);
  return label.querySelector('input') as HTMLInputElement;
};
const toggle = (h: Harness, input: HTMLInputElement): void => {
  input.checked = !input.checked;
  input.dispatchEvent(new (h.document.defaultView as unknown as typeof globalThis).Event('change'));
};
async function sketch(): Promise<Harness> {
  const h = (harness = await startApp());
  h.engine.execute({ type: 'addFeature', feature: emptySketch('s', 'Skica 1', { kind: 'base', plane: 'XY' }) } as Command);
  const row = h.row('Skica 1');
  row.dispatchEvent(new (h.document.defaultView as unknown as typeof globalThis).MouseEvent('dblclick'));
  return h;
}

describe('the import of an outline in the app (D72)', () => {
  it('the draft: the report, a layer, the unit; Place; the row with its counts, form and flag', async () => {
    const h = await sketch();
    expect(h.button('panel', 'Import an outline…')).toBeDefined();
    await choose(h, 'outline-file', 'board.dxf', boardDxf(60));
    expect(panel(h)).toContain('Import an outline');
    expect(panel(h)).toContain('6 lines, 4 arcs, 4 circles');
    // only the layer Edge.Cuts: the courtyard and the text go
    toggle(h, box(h, 'F.CrtYd'));
    toggle(h, box(h, 'F.SilkS'));
    expect(panel(h)).toContain('4 lines, 4 arcs, 4 circles');
    expect(panel(h)).toContain('Every end meets another.');
    h.choose('At (0, 0)', 'center');
    h.press('panel', 'Place');
    const entry = sketchOf(h).external.board as SketchOutline;
    expect(entry).toMatchObject({ type: 'outline', name: 'board', anchor: 'center', regions: true, readWith: { format: 'dxf', layers: ['Edge.Cuts'] } });
    expect(Object.keys(entry.curves)).toHaveLength(12);
    expect(status(h)).toMatch(/Outline board placed/);
    expect(panel(h)).toContain('board · board: 4 lines, 4 arcs, 4 circles');
    expect(panel(h)).not.toContain('Place');
    // the flag sends the one field
    toggle(h, box(h, 'regions'));
    expect((sketchOf(h).external.board as SketchOutline).regions).toBe(false);
    expect(Object.keys((sketchOf(h).external.board as SketchOutline).curves)).toHaveLength(12);
  });

  it('a file the reader refuses is said in the draft; Cancel drops it', async () => {
    const h = await sketch();
    await choose(h, 'outline-file', 'broken.dxf', 'hello');
    expect(panel(h)).toMatch(/unreadable/);
    expect(h.button('panel', 'Place').disabled).toBe(true);
    h.press('panel', 'Cancel');
    expect(panel(h)).toContain('Import an outline…');
    expect(sketchOf(h).external).toEqual({});
  });

  it('Replace file…: the stored options, the revision, the constraints that hold what goes removed in one batch', async () => {
    const h = await sketch();
    await choose(h, 'outline-file', 'board.dxf', boardDxf(60));
    toggle(h, box(h, 'F.CrtYd'));
    toggle(h, box(h, 'F.SilkS'));
    h.press('panel', 'Place');
    h.engine.execute({ type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'p', x: 0, y: 0 }, { type: 'addConstraint', sketch: 's', id: 'k', constraint: { type: 'coincident', a: 'p', b: 'board/c4/center' } }] } as Command);
      const revised = boardDxf(62).replace(/0\r\nCIRCLE(?:\r\n[^\r\n]*){8}\r\n(?=0\r\nLINE\r\n8\r\nF\.CrtYd)/, '');
    await choose(h, 'outline-file-board', 'board.dxf', revised);
    expect(panel(h)).toContain('Replace the file of board');
    expect(panel(h)).toMatch(/11 stay \(\d+ of them changed\), 0 come, 1 go \(c4\)/);
    expect(panel(h)).toContain('Remove the constraints that hold what goes (k)');
    h.press('panel', 'Replace');
    expect(Object.keys((sketchOf(h).external.board as SketchOutline).curves)).toHaveLength(12);
    expect(status(h)).toMatch(/c4/);
    toggle(h, box(h, 'Remove the constraints'));
    h.press('panel', 'Replace');
    expect(Object.keys((sketchOf(h).external.board as SketchOutline).curves)).toHaveLength(11);
    expect(sketchOf(h).constraints).toEqual({});
    expect((sketchOf(h).external.board as SketchOutline).readWith).toEqual({ format: 'dxf', layers: ['Edge.Cuts'] });
  });

  it('the pickers: the kind first, then the limit, for every entry; the notes of what was left out', async () => {
    const h = await sketch();
    const curves: Record<string, unknown> = {};
    for (let i = 1; i <= 150; i++) curves[`l${i}`] = { type: 'line', a: [i * 3, 0], b: [i * 3 + 1, 0] };
    for (let i = 1; i <= 3; i++) curves[`c${i}`] = { type: 'circle', center: [i * 10, 20], radius: 1 };
    h.engine.execute({ type: 'addExternal', sketch: 's', id: 'o', ref: { type: 'outline', curves } } as Command);
    const feature = sketchOf(h);
    expect(entryEntities(feature, (kind) => kind === 'circle').map((e) => e.id)).toEqual(['o/c1', 'o/c2', 'o/c3']);
    expect(entryEntities(feature, (kind) => kind === 'line')).toHaveLength(PICKER_LIMIT);
    expect(omittedNotes(feature, (kind) => kind === 'line')).toEqual(['… 50 more of o, not listed']);
    expect(omittedNotes(feature, (kind) => kind === 'circle')).toEqual([]);
  });
});
