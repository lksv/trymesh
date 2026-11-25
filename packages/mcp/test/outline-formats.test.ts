// The guards of the catalog of outline formats (D72), like those of the import formats, and the tool
// import_outline of the server with the internal tool `_outline` where the engine is.
// - A format added to the catalog without a row in the two tables below does not compile.
// - The test runs every format through the tool and compares what the types let through.
// - What the tool answers: a look, a placement, a replacement with the stored options and with
//   `remove`, a refusal with the report; get_sketch and get_document of an outline; the queries
//   entryCurves and sketchRegions from MCP alone; `changesDocument` and `outlineSaid`.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnyOutlineFormat, type Command, type Engine, OUTLINE_FORMATS, OUTLINE_LIMITS, type OutlineFormat, type OutlineOptions, specProblems } from '@trymesh/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boardDxf } from '../../engine/test/outline-kit';
import { apiDescription, apiText } from '../src/api';
import { startBridge } from '../src/bridge';
import { type BridgeStatus, connectBridge } from '../src/bridge-client';
import { OUTLINE_OMITTED, callTool, changesDocument, outlineBytes, outlineSaid } from '../src/tools';
import { type Session, connect, newEngine } from './kit';

const SKETCH: Command = { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } } as Command;
const square = (side: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${side}mm" height="${side}mm" viewBox="0 0 ${side} ${side}"><g id="cut"><rect width="${side}" height="${side}"/><circle cx="${side / 2}" cy="${side / 2}" r="2"/></g></svg>`;
// A file of every format, of the format's own type, and the options it is imported with.
const FIXTURES: { [F in OutlineFormat]: { file: () => string; options: OutlineOptions<F> } } = {
  dxf: { file: () => boardDxf(60), options: { layers: ['Edge.Cuts'] } },
  svg: { file: () => square(20), options: { layers: ['cut'], unit: 'mm' } },
};
// Every option of every format and whether a caller may leave it out, as the type says.
const OPTIONS: { [F in OutlineFormat]: { [K in keyof Required<OutlineOptions<F>>]: {} extends Pick<OutlineOptions<F>, K> ? 'optional' : 'required' } } = {
  dxf: { layers: 'optional', weld: 'optional', unit: 'optional' },
  svg: { layers: 'optional', weld: 'optional', unit: 'optional' },
};
const ENTRIES = Object.entries(OUTLINE_FORMATS as Record<string, AnyOutlineFormat>);
const base64 = (text: string): string => Buffer.from(text).toString('base64');

describe('the catalog of outline formats and the tool import_outline (D72)', () => {
  let dir: string;
  let session: Session;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-outline-'));
  });
  beforeEach(async () => {
    session?.close();
    session = await connect();
    expect((await session.call('execute', { command: SKETCH })).error).toBeUndefined();
  });
  afterAll(async () => {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(ENTRIES)('%s: the options of the entry are those of its type', (name, spec) => {
    const described = Object.fromEntries(Object.entries(spec.options).map(([option, description]) => [option, description.optional ? 'optional' : 'required']));
    expect(described).toEqual(OPTIONS[name as OutlineFormat]);
    expect(specProblems(spec.options)).toEqual([]);
    expect(spec.title && spec.summary).toBeTruthy();
    for (const extension of spec.extensions) expect(extension).toBe(extension.toLowerCase());
  });

  it.each(ENTRIES)('%s is reached through the tool and described to the AI', async (name) => {
    const fixture = FIXTURES[name as OutlineFormat];
    const file = join(dir, `board.${OUTLINE_FORMATS[name as OutlineFormat].extensions[0]}`);
    await writeFile(file, fixture.file());
    const answer = await session.call('import_outline', { path: file, options: fixture.options, sketch: 's', id: `by_${name}` });
    expect(answer.error).toBeUndefined();
    expect(answer).toMatchObject({ file, entry: { sketch: 's', id: `by_${name}` }, report: { format: name, open: 0 }, sketch: { profileValid: true } });
    expect(session.engine.getState().document.features[0]).toMatchObject({ external: { [`by_${name}`]: { type: 'outline', readWith: { format: name, ...fixture.options } } } });
    const described = apiDescription().outlines.find((entry) => entry.format === name);
    expect(described?.options.map((option) => option.name)).toEqual(Object.keys(OUTLINE_FORMATS[name as OutlineFormat].options));
    expect(apiText()).toContain('# Outline formats');
    expect(apiText()).toContain(`- ${name} (`);
  });

  it('a look changes nothing; a placement is one undo step under the name of the file; a second takes the next free ID', async () => {
    const file = join(dir, 'pcb board.dxf');
    await writeFile(file, boardDxf(60));
    const before = session.engine.getState().document;
    const look = await session.call('import_outline', { path: file, options: { layers: ['Edge.Cuts'] } });
    expect(look).toMatchObject({ file, report: { curves: 12, byKind: { line: 4, arc: 4, circle: 4, spline: 0 } } });
    expect(look.entry).toBeUndefined();
    expect(look.next).toMatch(/Nothing was placed/);
    expect(session.engine.getState().document).toBe(before);
    const placed = await session.call('import_outline', { path: file, options: { layers: ['Edge.Cuts'] }, sketch: 's', anchor: 'center', x: 'deg(0) + 5' });
    expect(placed.entry).toEqual({ sketch: 's', id: 'pcb_board' });
    expect(placed.next).toMatch(/sketchRegions/);
    const entry = session.engine.getState().document.features[0] as { external: Record<string, { name?: string; x: number }> } & { expressions?: unknown };
    expect(entry.external.pcb_board).toMatchObject({ name: 'pcb board', x: 5, anchor: 'center' });
    expect(JSON.stringify(placed)).not.toContain('"curves":{');
    expect((await session.call('import_outline', { path: file, options: { layers: ['Edge.Cuts'] }, sketch: 's' })).entry.id).toBe('pcb_board_2');
    expect((await session.call('undo')).error).toBeUndefined();
    expect(Object.keys((session.engine.getState().document.features[0] as { external: object }).external)).toEqual(['pcb_board']);
  });

  it('a replacement reads with the stored options, keeps the placement and answers the revision; refused by the rule, then with remove', async () => {
    const file = join(dir, 'rev.dxf');
    await writeFile(file, boardDxf(60));
    await session.call('import_outline', { path: file, options: { layers: ['Edge.Cuts'] }, sketch: 's', id: 'b', x: 3 });
    // a constraint on the fourth hole, which the revised file has no more
    const own = await session.call('execute', { command: { type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'p', x: 0, y: 0 }, { type: 'addConstraint', sketch: 's', id: 'k', constraint: { type: 'coincident', a: 'p', b: 'b/c4/center' } }] } });
    expect(own.error).toBeUndefined();
    const revised = boardDxf(62).replace(/0\r\nCIRCLE(?:\r\n[^\r\n]*){8}\r\n(?=0\r\nLINE\r\n8\r\nF\.CrtYd)/, '');
    await writeFile(file, revised);
    const refused = await session.call('import_outline', { path: file, sketch: 's', id: 'b', replace: true });
    expect(refused.refused).toMatch(/b\/c4/);
    expect(refused.report.curves).toBe(11);
    expect(refused.next).toMatch(/options the entry stores/);
    expect(refused.next).toMatch(/remove/);
    const done = await session.call('import_outline', { path: file, sketch: 's', id: 'b', replace: true, remove: ['k'] });
    expect(done.refused).toBeUndefined();
    expect(done.revision).toMatchObject({ removed: ['c4'], added: [] });
    const entry = (session.engine.getState().document.features[0] as { external: Record<string, { x: number; readWith: unknown; curves: object }> }).external.b;
    expect(entry.x).toBe(3);
    expect(entry.readWith).toEqual({ format: 'dxf', layers: ['Edge.Cuts'] });
    expect(Object.keys(entry.curves)).toHaveLength(11);
    // one undo step takes the constraint and the curves back
    await session.call('undo');
    const back = session.engine.getState().document.features[0] as { constraints: object; external: Record<string, { curves: object }> };
    expect(Object.keys(back.constraints)).toEqual(['k']);
    expect(Object.keys(back.external.b.curves)).toHaveLength(12);
  });

  it('what the tool refuses: replace or remove without a sketch, replace without id or of no outline, a file it cannot read or tell', async () => {
    const file = join(dir, 'x.dxf');
    await writeFile(file, boardDxf(60));
    expect((await session.call('import_outline', { path: file, replace: true, id: 'b' })).error).toMatch(/need `sketch`/);
    expect((await session.call('import_outline', { path: file, sketch: 's', replace: true })).error).toMatch(/needs `id`/);
    expect((await session.call('import_outline', { path: file, sketch: 's', replace: true, id: 'nothing' })).error).toMatch(/has no outline "nothing"/);
    expect((await session.call('import_outline', { path: join(dir, 'missing.dxf') })).error).toMatch(/cannot be read/);
    const text = join(dir, 'notes.txt');
    await writeFile(text, 'hello');
    expect((await session.call('import_outline', { path: text })).error).toMatch(/cannot be told from its extension/);
    expect((await session.call('import_outline', { path: text, format: 'dxf' })).error).toMatch(/^unreadable: dxf/);
    expect((await session.call('import_outline', { path: file, options: { weld: 5 } })).error).toMatch(/^invalidArguments: dxf: weld/);
  });

  it('get_sketch: the row of an outline bounded by curves and positions, the regions capped with the way to sketchRegions; get_document shortened on its paths', async () => {
    const many = ['0', 'SECTION', '2', 'ENTITIES'];
    // a comb: one outline of 600 lines that bounds one region
    const n = 300;
    const at: [number, number][] = [];
    for (let i = 0; i < n; i++) at.push([i * 2, 0], [i * 2 + 1, i % 2 ? 5 : 3]);
    at.push([n * 2, 0], [n * 2, -10], [0, -10]);
    for (let i = 0; i < at.length; i++) {
      const [a, b] = [at[i], at[(i + 1) % at.length]];
      many.push('0', 'LINE', '8', '0', '10', String(a[0]), '20', String(a[1]), '11', String(b[0]), '21', String(b[1]));
    }
    many.push('0', 'ENDSEC', '0', 'EOF');
    const file = join(dir, 'comb.dxf');
    await writeFile(file, many.join('\n'));
    const placed = await session.call('import_outline', { path: file, sketch: 's', id: 'comb' });
    expect(placed.error).toBeUndefined();
    const sketch = await session.call('get_sketch', { sketch: 's' });
    const row = sketch.external.find((entry: { id: string }) => entry.id === 'comb');
    expect(row).toMatchObject({ id: 'comb', type: 'outline', source: 'reference', readWith: { format: 'dxf' }, counts: { line: at.length }, total: at.length, listed: OUTLINE_LIMITS.listed });
    expect(row.curves[0]).toMatchObject({ id: 'comb/l1', type: 'line', a: [0, 0], b: [1, 3] });
    expect(row.more).toMatch(/entryCurves/);
    expect(row.box).toEqual([0, -10, n * 2, 5]);
    expect(sketch.regions).toHaveLength(1);
    const ref = sketch.regions[0].ref;
    expect(ref).toMatchObject({ count: at.length, index: 0, entries: ['comb'] });
    expect(ref.first).toHaveLength(20);
    // the region whole from MCP alone, and extruded
    const whole = await session.call('query', { query: 'sketchRegions', args: { sketch: 's', index: ref.index } });
    expect(whole.regions[0].ref.outerLoop).toHaveLength(at.length);
    const extruded = await session.call('execute', { command: { type: 'addFeature', feature: { id: 'e', name: 'e', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [whole.regions[0].ref] }, extent: { type: 'distance', start: 0, distance: 2 }, operation: 'new' } } });
    expect(extruded.problems).toEqual([]);
    // a page of entryCurves
    const page = await session.call('query', { query: 'entryCurves', args: { sketch: 's', entry: 'comb', from: 600, max: 500 } });
    expect(page).toMatchObject({ status: 'ok', total: at.length, from: 600 });
    expect(page.curves[0].id).toBe('comb/l601');
    // get_document on the whole document and one feature
    const omitted = OUTLINE_OMITTED(at.length);
    expect((await session.call('get_document')).features[0].external.comb.curves).toBe(omitted);
    expect((await session.call('get_document', { feature: 's' })).external.comb.curves).toBe(omitted);
  });

  it('the advice of an open end of an outline', async () => {
    const file = join(dir, 'open.dxf');
    await writeFile(file, ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0', '0', 'LINE', '8', '0', '10', '10', '20', '0', '11', '10', '21', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n'));
    await session.call('import_outline', { path: file, sketch: 's', id: 'o' });
    const advice = (await session.call('get_sketch', { sketch: 's' })).advice.join(' ');
    expect(advice).toMatch(/Curves of an imported outline close where their ends are within 1e-6 mm/);
  });
});

describe('the internal tool _outline where the engine is (D72)', () => {
  let engine: Engine;
  const file = { name: 'board.dxf', base64: base64(boardDxf(60)) };
  beforeEach(() => {
    engine = newEngine();
    expect(callTool(engine, 'execute', { command: SKETCH }).ok).toBe(true);
  });

  it('the bytes through JSON and back; a text over the limit refused before it is decoded', () => {
    const through = JSON.parse(JSON.stringify({ file }));
    expect(new TextDecoder().decode(outlineBytes(through.file.base64))).toBe(boardDxf(60));
    expect(() => outlineBytes('A'.repeat(4 * Math.ceil(OUTLINE_LIMITS.bytes / 3) + 4))).toThrow(/tooLarge/);
    expect(() => outlineBytes(42)).toThrow(/a text is expected/);
  });

  it('changesDocument: false for a look, a file that cannot be read, a replacement the rule refuses; true for a placement', () => {
    expect(changesDocument(engine, '_outline', { file })).toBe(false);
    expect(changesDocument(engine, '_outline', { file: { name: 'x.dxf', base64: base64('hello') }, sketch: 's' })).toBe(false);
    expect(changesDocument(engine, '_outline', { file, sketch: 's', options: { layers: ['Edge.Cuts'] } })).toBe(true);
    expect(callTool(engine, '_outline', { file, sketch: 's', id: 'b', options: { layers: ['Edge.Cuts'] } }).ok).toBe(true);
    expect(callTool(engine, 'execute', { command: { type: 'batch', commands: [{ type: 'addPoint', sketch: 's', id: 'p', x: 0, y: 0 }, { type: 'addConstraint', sketch: 's', id: 'k', constraint: { type: 'coincident', a: 'p', b: 'b/c4/center' } }] } }).ok).toBe(true);
    const without = { name: 'board.dxf', base64: base64(boardDxf(60).replace('Edge.Cuts\r\n10\r\n156.500000', 'Other\r\n10\r\n156.500000')) };
    expect(changesDocument(engine, '_outline', { file: without, sketch: 's', id: 'b', replace: true })).toBe(false);
  });

  it('outlineSaid: nothing for a look, the placement, the refusal as an error', () => {
    const look = callTool(engine, '_outline', { file });
    expect(look.ok && outlineSaid(look.result)).toBeUndefined();
    const placed = callTool(engine, '_outline', { file, sketch: 's', id: 'b' });
    expect(placed.ok && outlineSaid(placed.result)).toEqual({ text: 'AI: imported the outline b into s', error: false });
    const again = callTool(engine, '_outline', { file, sketch: 's', id: 'b' });
    expect(again.ok && outlineSaid(again.result)).toMatchObject({ error: true });
  });
});

describe('import_outline over the bridge (D72)', () => {
  it('the same answer in the app as on the server\'s own engine; the app is asked before the call whether it changes the document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-outline-bridge-'));
    const bridge = await startBridge(0);
    const file = join(dir, 'board.dxf');
    await writeFile(file, boardDxf(60));
    const args = { path: file, options: { layers: ['Edge.Cuts'] }, sketch: 's', id: 'b', anchor: 'center' };
    try {
      // the server's own engine
      const own = await connect();
      await own.call('execute', { command: SKETCH });
      const alone = await own.call('import_outline', args);
      await own.close();
      // the app's engine over the bridge
      const session = await connect({ bridge });
      const app = newEngine();
      expect(callTool(app, 'execute', { command: SKETCH }).ok).toBe(true);
      const asked: [string, boolean][] = [];
      let status = 'off' as BridgeStatus;
      const connection = connectBridge(app, { url: `http://127.0.0.1:${bridge.port}`, retryMs: 20, onStatus: (next) => (status = next), beforeCall: (name, given) => void (name === '_outline' && asked.push([name, changesDocument(app, name, given)])) });
      for (let i = 0; i < 200 && !(status === 'connected' && bridge.connected()); i++) await new Promise((done) => setTimeout(done, 10));
      const look = await session.call('import_outline', { path: file });
      expect(look.entry).toBeUndefined();
      const bridged = await session.call('import_outline', args);
      expect(bridged).toEqual(alone);
      expect(Object.keys((app.getState().document.features[0] as { external: object }).external)).toEqual(['b']);
      expect(session.engine.getState().document.features).toEqual([]);
      expect(asked).toEqual([['_outline', false], ['_outline', true]]);
      connection.stop();
      await session.close();
    } finally {
      await bridge.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
