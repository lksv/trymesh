// The guards of the catalog of import formats (D55), like those of the export formats, and the tool
// import_mesh of the server.
// - A format added to the catalog without a row in the two tables below does not compile.
// - The test runs every format through the tool and compares what the types let through: the names
//   of the options of an entry and which are optional.
// - What the tool answers, the ID it chooses, what get_document and get_model show of a stored mesh.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnyImportFormat, type Command, type Engine, IMPORT_FORMATS, type ImportFormat, type ImportOptions, idFromFile, meshNameOf, specProblems } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiDescription, apiText } from '../src/api';
import { callTool, changesDocument } from '../src/tools';
import { type Session, connect, newEngine } from './kit';

// A disc of radius 5 and height 10, written as STL by an engine.
function disc(): Uint8Array {
  const engine = newEngine();
  const outcome = callTool(engine, 'execute', {
    command: {
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
        { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
        { type: 'addFeature', feature: { id: 'd', name: 'd', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 0, distance: 10 }, operation: 'new' } },
      ],
    },
  });
  if (!outcome.ok) throw new Error(outcome.error);
  return engine.exportMesh('stl', ['d']);
}

// A file of every format, of the format's own type, and the options it is imported with.
const FIXTURES: { [F in ImportFormat]: { file: () => Uint8Array; options: ImportOptions<F> } } = {
  stl: { file: disc, options: { unit: 'mm' } },
};
// Every option of every format and whether a caller may leave it out, as the type says.
const OPTIONS: { [F in ImportFormat]: { [K in keyof Required<ImportOptions<F>>]: {} extends Pick<ImportOptions<F>, K> ? 'optional' : 'required' } } = {
  stl: { unit: 'optional' },
};
const ENTRIES = Object.entries(IMPORT_FORMATS as Record<string, AnyImportFormat>);

describe('the catalog of import formats and the tool import_mesh (D55)', () => {
  let dir: string;
  let session: Session;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-import-'));
    session = await connect();
  });
  afterAll(async () => {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(ENTRIES)('%s: the options of the entry are those of its type', (name, spec) => {
    const described = Object.fromEntries(Object.entries(spec.options).map(([option, description]) => [option, description.optional ? 'optional' : 'required']));
    expect(described).toEqual(OPTIONS[name as ImportFormat]);
    expect(specProblems(spec.options)).toEqual([]);
    expect(spec.title && spec.summary).toBeTruthy();
    expect(spec.extensions.length).toBeGreaterThan(0);
    for (const extension of spec.extensions) expect(extension).toBe(extension.toLowerCase());
  });

  it.each(ENTRIES)('%s is reached through the tool and described to the AI', async (name) => {
    const fixture = FIXTURES[name as ImportFormat];
    const file = join(dir, `part.${IMPORT_FORMATS[name as ImportFormat].extensions[0]}`);
    await writeFile(file, fixture.file());
    const answer = await session.call('import_mesh', { path: file, options: fixture.options, id: `by_${name}` });
    expect(answer.error).toBeUndefined();
    expect(answer).toMatchObject({ mesh: `by_${name}`, file, report: { format: name, shells: 1 } });
    expect(session.engine.getState().document.meshes[`by_${name}`]).toBeDefined();
    const described = apiDescription().imports.find((entry) => entry.format === name);
    expect(described?.options.map((option) => option.name)).toEqual(Object.keys(IMPORT_FORMATS[name as ImportFormat].options));
    expect(apiText()).toContain(`- ${name} (`);
  });

  it('the answer: the stored mesh, the report and the batch that places it as a reference part without a mass', async () => {
    const file = join(dir, 'nema17.stl');
    await writeFile(file, disc());
    const answer = await session.call('import_mesh', { path: file });
    expect(answer.mesh).toBe('nema17');
    expect(answer.report).toMatchObject({ format: 'stl', about: { encoding: 'binary', unit: 'mm' }, shells: 1, cavities: 0, notes: [] });
    expect(answer.report.volume).toBeCloseTo(session.engine.getState().evaluation.meshes.nema17.volume, 5);
    const command = answer.next.command as Command;
    expect(command).toEqual({
      type: 'batch',
      commands: [
        { type: 'addFeature', feature: { id: 'nema17', name: 'nema17', suppressed: false, type: 'mesh', mesh: 'nema17', placement: { frame: { kind: 'base', plane: 'XY' } } } },
        { type: 'setBodyProperties', body: 'nema17', patch: { use: 'reference' } },
      ],
    });
    expect(answer.next.say).toMatch(/mass of the data sheet/);
    // the stored mesh is one undo step; the batch places it
    expect(session.engine.getState().document.meshes.nema17.name).toBe('nema17.stl');
    const placed = await session.call('execute', { command });
    expect(placed.error).toBeUndefined();
    expect(session.engine.getState().evaluation.bodyProperties.nema17).toMatchObject({ use: 'reference' });
    // a second import of the same file gets the next free ID, and its feature the next free feature ID
    const again = await session.call('import_mesh', { path: file });
    expect(again.mesh).toBe('nema17_2');
    expect(again.next.command.commands[0].feature.id).toBe('nema17_2');
  });

  it('what the tool refuses: a file that cannot be read, that is no solid, a format it cannot tell, a wrong option', async () => {
    expect(await session.call('import_mesh', { path: join(dir, 'missing.stl') })).toEqual({ error: expect.stringMatching(/the file cannot be read/) });
    const text = join(dir, 'notes.txt');
    await writeFile(text, 'hello');
    expect(await session.call('import_mesh', { path: text })).toEqual({ error: expect.stringMatching(/cannot be told from its extension/) });
    expect(await session.call('import_mesh', { path: text, format: 'stl' })).toEqual({ error: expect.stringMatching(/^unreadable: stl: not an STL file/) });
    const open = disc().slice(0, -50);
    new DataView(open.buffer).setUint32(80, (open.length - 84) / 50, true);
    const holed = join(dir, 'holed.stl');
    await writeFile(holed, open);
    expect(await session.call('import_mesh', { path: holed })).toEqual({ error: expect.stringMatching(/^notASolid: stl: the mesh is not a closed solid: \d+ edges? with one triangle/) });
    const file = join(dir, 'disc.stl');
    await writeFile(file, disc());
    expect(await session.call('import_mesh', { path: file, options: { unit: 'ft' } })).toEqual({ error: expect.stringMatching(/^invalidArguments: stl: unit/) });
    expect(await session.call('import_mesh', { path: file, unit: 'm' })).toEqual({ error: expect.stringMatching(/unknown argument "unit"/) });
    expect(await session.call('import_mesh', { path: file, id: 'a/b' })).toEqual({ error: expect.stringMatching(/addMesh\.id/) });
  });

  it('the ID from the name of the file: letters, digits and underscores; `mesh` when that is no ID; numbered when taken', () => {
    const none = () => false;
    expect(idFromFile('/parts/NEMA 17-motor.v2.stl', none)).toBe('NEMA_17_motor_v2');
    expect(idFromFile('C:\\parts\\motor.stl', none)).toBe('motor');
    expect(idFromFile('/parts/origin.stl', none)).toBe('mesh');
    expect(idFromFile('/parts/constructor.stl', none)).toBe('mesh');
    expect(idFromFile('/parts/.stl', none)).toBe('mesh');
    expect(idFromFile('/parts/motor.stl', (id) => ['motor', 'motor_2'].includes(id))).toBe('motor_3');
  });

  it('the name of a stored mesh from its file: trimmed and cut to the length of a name (review)', async () => {
    expect(meshNameOf('/parts/ motor.stl ')).toBe('motor.stl');
    expect(meshNameOf(`/parts/${'a'.repeat(300)}.stl`)).toBe('a'.repeat(200));
    expect(meshNameOf('/parts/ ')).toBeUndefined();
    const file = join(dir, ` ${'b'.repeat(250)}.stl`);
    await writeFile(file, disc());
    const answer = await session.call('import_mesh', { path: file });
    expect(answer.error).toBeUndefined();
    expect(session.engine.getState().document.meshes[answer.mesh].name).toBe('b'.repeat(200));
  });

  it('the feature it proposes avoids every ID of the document, also a point of a sketch (review)', async () => {
    const sketch = { id: 'sk', name: 'sk', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: { servo: { x: 0, y: 0 } }, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } };
    expect((await session.call('execute', { command: { type: 'addFeature', feature: sketch } })).error).toBeUndefined();
    const file = join(dir, 'servo.stl');
    await writeFile(file, disc());
    const answer = await session.call('import_mesh', { path: file });
    expect(answer.mesh).toBe('servo');
    expect(answer.next.command.commands[0].feature).toMatchObject({ id: 'servo_2', name: 'servo' });
    expect((await session.call('execute', { command: answer.next.command })).error).toBeUndefined();
  });
});

describe('a stored mesh in the tools that read the document', () => {
  let engine: Engine;
  beforeAll(() => {
    engine = newEngine();
    const outcome = callTool(engine, 'execute', { command: { type: 'batch', commands: [] } });
    expect(outcome.ok).toBe(true);
  });

  it('get_document leaves out the data of a stored mesh and says how long it was; get_model lists it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-shown-'));
    const session = await connect({ engine });
    try {
      const file = join(dir, 'disc.stl');
      await writeFile(file, disc());
      await session.call('import_mesh', { path: file });
      const stored = engine.getState().document.meshes.disc;
      const document = await session.call('get_document');
      expect(document.meshes).toEqual({ disc: { name: 'disc.stl', omitted: `positions and triangles: ${stored.positions.length + stored.triangles.length} characters of base64; save_document writes them` } });
      const { bounds, triangles } = engine.getState().evaluation.meshes.disc;
      expect((await session.call('get_model')).meshes).toEqual([{ id: 'disc', name: 'disc.stl', triangles, size: bounds.max.map((high, axis) => Math.round((high - bounds.min[axis]) * 1e6) / 1e6), usedBy: [] }]);
      expect(bounds.max[2] - bounds.min[2]).toBe(10);
      // the whole document is what save_document writes
      expect(JSON.parse(engine.save()).meshes.disc.positions).toBe(stored.positions);
    } finally {
      await session.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('changesDocument compares the parts of a document that are other objects only', () => {
    const before = engine.getState().document;
    expect(changesDocument(engine, 'execute', { command: { type: 'batch', commands: [] } })).toBe(false);
    expect(changesDocument(engine, 'execute', { command: { type: 'removeMesh', id: 'disc' } })).toBe(true);
    // decided without a preview (review): a free ID adds, a taken one does not; a mesh in use is not removed
    expect(changesDocument(engine, 'execute', { command: { type: 'addMesh', id: 'disc', mesh: engine.getState().document.meshes.disc } })).toBe(false);
    expect(changesDocument(engine, 'execute', { command: { type: 'addMesh', id: 'other', mesh: engine.getState().document.meshes.disc } })).toBe(true);
    expect(changesDocument(engine, 'execute', { command: { type: 'removeMesh', id: 'nothing' } })).toBe(false);
    expect(engine.getState().document).toBe(before);
  });
});
