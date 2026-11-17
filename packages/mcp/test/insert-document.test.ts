// Inserting another document as a part (D62) through MCP: the tool insert_document (it reads a file,
// stores the document by addDocument or replaceDocument and answers with the command that inserts it
// and what that would bring), get_document with stored documents shortened and `stored`,
// save_document with `stored`, and the stored documents of get_model.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Command, type Engine, emptySketch } from '@trymesh/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changesDocument } from '../src/tools';
import { type Session, connect, newEngine } from './kit';

const XY = { kind: 'base', plane: 'XY' } as const;
// a ring of the outer diameter `D`, 7 high, a bought part of 12 g
const bearingCommands: Command[] = [
  { type: 'setParameter', name: 'D', expr: '22' },
  { type: 'setParameter', name: 'B', expr: '7' },
  { type: 'addFeature', feature: emptySketch('ringSketch', 'Ring', XY) },
  { type: 'addCurve', sketch: 'ringSketch', id: 'outer', curve: { type: 'circle', center: 'origin' }, radius: 11 },
  { type: 'addConstraint', sketch: 'ringSketch', id: 'outerD', constraint: { type: 'diameter', curve: 'outer', value: 'D', driving: true } },
  { type: 'addFeature', feature: { id: 'ring', name: 'Ring', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 'ringSketch', regions: [{ outerLoop: ['outer'] }] }, extent: { type: 'distance', start: 0, distance: 'B' }, operation: 'new' } },
  { type: 'setBodyProperties', body: 'ring', patch: { name: '608 bearing', use: 'reference', mass: 12 } },
];
const saved = (commands: Command[]): string => {
  const shop = newEngine();
  const result = shop.execute({ type: 'batch', commands });
  if (!result.ok) throw new Error(result.error.message);
  return shop.save();
};

describe('the tool insert_document', () => {
  let dir: string;
  let session: Session;
  let engine: Engine;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'trymesh-mcp-insert-'));
    await writeFile(join(dir, '608 bearing.json'), saved(bearingCommands));
    engine = newEngine();
    session = await connect({ engine });
  });
  afterAll(async () => {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('stores the document and answers with its parameters, the command that inserts it and what that would bring', async () => {
    const answer = await session.call('insert_document', { path: join(dir, '608 bearing.json') });
    expect(answer.error).toBeUndefined();
    expect(answer).toMatchObject({ document: '608_bearing', file: join(dir, '608 bearing.json') });
    expect(answer.parameters).toEqual([
      { name: 'D', expr: '22', value: 22 },
      { name: 'B', expr: '7', value: 7 },
    ]);
    expect(answer.bodies).toEqual([{ id: '608_bearing/ring', use: 'reference', mass: 12 }]);
    expect(answer.warning).toBeUndefined();
    expect(answer.next.command).toEqual({ type: 'addFeature', feature: { id: '608_bearing', name: '608 bearing', suppressed: false, type: 'insert', document: '608_bearing', placement: { frame: XY } } });
    expect(answer.next.say).toMatch(/nothing is inserted yet/);
    expect(engine.getState().document.documents['608_bearing'].name).toBe('608 bearing.json');
    // nothing is inserted: one undo step stored it
    expect(engine.getState().document.features).toEqual([]);
    expect((await session.call('execute', { command: { ...answer.next.command, feature: { ...answer.next.command.feature, parameters: { D: 24 } } } })).error).toBeUndefined();
    expect(engine.getState().evaluation.features['608_bearing'].bodies).toEqual(['608_bearing/ring']);
  });

  it('a second time the ID is numbered; a body inherited as a printed part is named in `say`', async () => {
    await writeFile(join(dir, 'clip.json'), saved([...bearingCommands.slice(0, -1), { type: 'setBodyMaterial', body: 'ring', material: 'PETG' }]));
    const first = await session.call('insert_document', { path: join(dir, 'clip.json') });
    expect(first.bodies).toEqual([{ id: 'clip/ring', use: 'part', material: 'PETG', mass: expect.any(Number) }]);
    expect(first.next.say).toMatch(/The bodies clip\/ring come in as printed parts/);
    const second = await session.call('insert_document', { path: join(dir, 'clip.json'), name: 'Clip' });
    expect(second.document).toBe('clip_2');
    expect(engine.getState().document.documents.clip_2.name).toBe('Clip');
  });

  it('with `replace` a revision takes the place of the stored document and every insertion is recomputed', async () => {
    const before = engine.getState().evaluation.bodies['608_bearing/ring'].volume;
    await writeFile(join(dir, 'revision.json'), saved([...bearingCommands.slice(0, 1), { type: 'setParameter', name: 'B', expr: '8' }, ...bearingCommands.slice(2)]));
    expect(await session.call('insert_document', { path: join(dir, 'revision.json'), replace: true })).toEqual({ error: expect.stringMatching(/with `replace` the ID of a stored document to replace is required \(the stored documents: 608_bearing, clip, clip_2\)/) });
    const answer = await session.call('insert_document', { path: join(dir, 'revision.json'), id: '608_bearing', replace: true });
    expect(answer).toMatchObject({ document: '608_bearing', replaced: true });
    expect(engine.getState().document.documents['608_bearing'].name).toBe('608 bearing.json');
    expect(engine.getState().evaluation.bodies['608_bearing/ring'].volume).toBeCloseTo((before * 8) / 7, 3);
  });

  it('what the tool refuses: a file that cannot be read, that is no JSON, a document that does not load, an ID taken', async () => {
    expect(await session.call('insert_document', { path: join(dir, 'missing.json') })).toEqual({ error: expect.stringMatching(/the file cannot be read/) });
    await writeFile(join(dir, 'notes.json'), 'hello');
    expect(await session.call('insert_document', { path: join(dir, 'notes.json') })).toEqual({ error: expect.stringMatching(/the file is not a document \(JSON\)/) });
    await writeFile(join(dir, 'broken.json'), JSON.stringify({ schemaVersion: 1, features: 'none' }));
    expect(await session.call('insert_document', { path: join(dir, 'broken.json') })).toEqual({ error: expect.stringMatching(/^invalidCommand: addDocument\.document/) });
    expect(await session.call('insert_document', { path: join(dir, 'clip.json'), id: 'clip' })).toEqual({ error: expect.stringMatching(/addDocument\.id: the document has a stored document "clip" already/) });
  });

  it('get_document shortens a stored document and prints one with `stored`; get_model lists them; save_document writes one', async () => {
    const document = await session.call('get_document');
    expect(document.documents['608_bearing']).toEqual({
      name: '608 bearing.json',
      parameters: [
        { name: 'D', expr: '22' },
        { name: 'B', expr: '8' },
      ],
      features: 2,
      documents: 0,
      omitted: expect.stringMatching(/^the timeline and the sections: \d+ characters; get_document with `stored: "608_bearing"` prints them$/),
    });
    const one = await session.call('get_document', { stored: '608_bearing' });
    expect(one.features.map((f: { id: string }) => f.id)).toEqual(['ringSketch', 'ring']);
    expect(await session.call('get_document', { stored: '608_bearing', feature: 'ring' })).toMatchObject({ id: 'ring', type: 'extrude' });
    expect(await session.call('get_document', { stored: 'nope' })).toEqual({ error: expect.stringMatching(/the document has no stored document "nope" \(its stored documents: 608_bearing, clip, clip_2\)/) });
    const model = await session.call('get_model');
    expect(model.documents[0]).toEqual({ id: '608_bearing', name: '608 bearing.json', parameters: { D: 22, B: 8 }, features: 2, usedBy: ['608_bearing'] });
    const out = join(dir, 'out', 'bearing.json');
    expect(await session.call('save_document', { stored: '608_bearing' })).toEqual({ error: expect.stringMatching(/argument "path": a stored document is written to a file of its own/) });
    const written = await session.call('save_document', { stored: '608_bearing', path: out });
    expect(written).toMatchObject({ file: out, stored: '608_bearing' });
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(engine.getState().document.documents['608_bearing'].document);
    // opened again, it is a document of its own
    const other = newEngine();
    expect(other.load(await readFile(out, 'utf8')).ok).toBe(true);
  });

  it('a stored document inside a stored document is reached by its path', async () => {
    const kit = newEngine();
    const added = kit.execute({ type: 'addDocument', id: 'bearing', document: JSON.parse(saved(bearingCommands)) });
    expect(added.ok).toBe(true);
    await writeFile(join(dir, 'kit.json'), kit.save());
    await session.call('insert_document', { path: join(dir, 'kit.json') });
    const shown = await session.call('get_document', { stored: 'kit' });
    expect(shown.documents.bearing).toMatchObject({ parameters: [{ name: 'D', expr: '22' }, { name: 'B', expr: '7' }], features: 2, documents: 0 });
    expect((await session.call('get_document', { stored: 'kit/bearing' })).features).toHaveLength(2);
    expect((await session.call('get_document')).documents.kit.documents).toBe(1);
  });

  it('changesDocument: a command of the section changes the document by its content', () => {
    const stored = engine.getState().document.documents.clip.document;
    expect(changesDocument(engine, 'execute', { command: { type: 'replaceDocument', id: 'clip', document: stored } })).toBe(false);
    expect(changesDocument(engine, 'execute', { command: { type: 'removeDocument', id: 'clip' } })).toBe(true);
  });
});
