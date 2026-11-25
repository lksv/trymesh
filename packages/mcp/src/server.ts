// MCP server: tools over the engine for the AI. The engine is either its own (a document from a file), or
// the engine of the running app connected through the bridge; the tools are the same in both cases.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { type Command, EXPORT_FORMATS, type Engine, IMPORT_FORMATS, type Document, type ImportFormat, type MeshReport, documentIds, exportPathProblem, OUTLINE_FORMATS, OUTLINE_LIMITS, fileStemOf, idFromFile, importFormatOf, importMesh, meshNameOf, namedBySections } from '@trymesh/engine';
import { type Bridge, type BridgeFailure, DEFAULT_BRIDGE_PORT } from './bridge';
import { Failure, type OutFile, type Wording, writeExport } from './export-writer';
import { hostOperations } from './api';
import { HOST_OPERATIONS, type HostOperationSet, hostOperationProblems, isHostOperation, noAppText } from './host';
import { type Json, type JsonSchema, OUTLINE_BRIDGE_TOOL, type ToolAnswer, type ToolOutcome, ToolError, argumentProblem, callTool, storedDocument, tools } from './tools';

export interface TrymeshServerOptions {
  engine: Engine; // the server's own engine; used when no app is connected
  bridge?: Bridge;
  // Why the bridge could not be opened at the start (D73), and how to try again. The server tries
  // only when asked (session_status with `openBridge: true`): the port it would take is the one the
  // app connects to, and taking it by itself could take the owner's app from another session.
  bridgeFailure?: BridgeFailure;
  reopenBridge?: () => Promise<{ bridge: Bridge } | { failure: BridgeFailure }>;
  file?: string; // the file the document of the own engine comes from
  operations?: HostOperationSet; // the operations of the app offered as tools; the registry by default (tests give their own)
}

interface FileTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(args: Record<string, unknown>): Promise<Json>;
}

// The messages of the writer that speak of what the files hold: bodies for `export_stl` (its file
// names come from body IDs), the files themselves for `export`.
const STL_WORDING: Wording = {
  tooLong: (bodies, limit) => `nothing was written, the file names of these bodies are longer than ${limit} bytes: ${bodies.join(', ')} (export them into one file with \`bodies\`, or rename the features)`,
  sameName: (first, second) => `the bodies "${first}" and "${second}" would get file names that differ only in the case of letters; export them separately`,
};
const FILE_WORDING: Wording = {
  tooLong: (names, limit) => `nothing was written, these file names are longer than ${limit} bytes: ${names.join(', ')}`,
  sameName: (first, second) => `nothing was written, the files "${first}" and "${second}" have names that differ only in the case of letters`,
};

const COMPACT_FROM = 20_000; // characters

// The refusal of a tool the connected app does not know; an app built before the English texts
// answers in Czech.
const unknownTool = (error: string, tool: string): boolean => error === `unknown tool "${tool}"` || error === `neznámý nástroj "${tool}"`;

const rounded = (value: unknown): unknown =>
  typeof value === 'number' ? Math.round(value * 1e6) / 1e6 + 0 : Array.isArray(value) ? value.map(rounded) : typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)])) : value;

export function createTrymeshServer(options: TrymeshServerOptions): Server {
  const { engine } = options;
  let bridge = options.bridge;
  let bridgeFailure = options.bridgeFailure;
  // Another try at the port of the bridge (D73), only when session_status is asked to: the app
  // connects to whichever server listens there, so taking it by itself could take the owner's app
  // from the session that had it. Tries that overlap share one.
  let trying: Promise<Json> | undefined;
  const openBridgeNow = (): Promise<Json> => {
    const reopen = options.reopenBridge;
    if (bridge) return Promise.resolve({ result: 'openAlready', port: bridge.port });
    if (!reopen) return Promise.resolve({ result: 'noBridge', note: 'this server was started without a bridge (--no-bridge)' });
    trying ??= reopen()
      .then((opened): Json => {
        if ('bridge' in opened) {
          [bridge, bridgeFailure] = [opened.bridge, undefined];
          return { result: 'opened', port: opened.bridge.port, note: 'the bridge listens; the app connects to it within a few seconds while its button AI is on, and the tools then work on the document open in the app (the answer after the switch says so)' };
        }
        bridgeFailure = opened.failure;
        return { result: 'failed', note: 'the port is still taken: see bridgeError' };
      })
      .finally(() => {
        trying = undefined;
      });
    return trying;
  };
  const bridgeError = (failure: BridgeFailure): Json => ({
    port: failure.port,
    ...(failure.code ? { code: failure.code } : {}),
    message: failure.message,
    advice:
      (failure.code === 'EADDRINUSE'
        ? `Another program holds 127.0.0.1:${failure.port}, most likely another trymesh MCP server (of another session or working tree), and the app is bridged to that one. Stop it to bridge this server, or start this one with --port or TRYMESH_BRIDGE_PORT (the app connects to ${DEFAULT_BRIDGE_PORT} only). `
        : `The bridge cannot listen on 127.0.0.1:${failure.port}. `) +
      'The tools work on the own document of this server, and it does not try the port again by itself: once the port is free, session_status with `openBridge: true` takes it (only when the app should be bridged to this server, not to the session that had it).',
  });
  const operations = options.operations ?? HOST_OPERATIONS;
  // Each document has its own file: one for the server's own document, another for the document in the app.
  // The app's file holds only for the duration of one connection and only for the document that was open
  // in it when it was saved to the file or loaded from it: after New or Open in the app it no longer
  // holds. A save without a path thus never writes one document over the file of another.
  let serverFile = options.file === undefined ? undefined : resolve(options.file);
  let appFile: { session: number; document: number | undefined; path: string } | undefined;
  // The app's document number is as fresh as its last answer; whoever needs it exactly
  // calls a tool of the app first (_save, _ping).
  const fileOf = (session: number | undefined): string | undefined =>
    session === undefined ? serverFile : appFile?.session === session && appFile.document === bridge?.document() ? appFile.path : undefined;
  const forget = (session: number | undefined) => {
    if (session === undefined) serverFile = undefined;
    else appFile = undefined;
  };
  const remember = (session: number | undefined, path: string) => {
    if (session === undefined) serverFile = path;
    else appFile = { session, document: bridge?.document(), path };
  };
  // The file of the server's own document that new_document emptied (D73, review), with the
  // document before and after: an undo that brings that document back brings its file back, and
  // a redo that empties it again forgets the file again. The own engine changes only by the tools,
  // so looking after each tool is enough; the document of the app is not followed (its file stays
  // forgotten).
  let emptied: { path: string; before: Document; after: Document } | undefined;
  const followEmptied = () => {
    if (!emptied || bridge?.session() !== undefined) return;
    const now = engine.getState().document;
    if (now === emptied.before) serverFile ??= emptied.path;
    else if (now === emptied.after) serverFile = undefined;
  };

  // A tool runs over the app's engine when it is connected, otherwise over the own one. `session` is
  // the connection found at the start of the tool: a tool made of several steps thus works wholly over
  // one engine, even if the app connected or disconnected in the meantime.
  const call = (session: number | undefined, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> => {
    if (session === undefined) return Promise.resolve(callTool(engine, name, args));
    if (!bridge || bridge.session() !== session) return Promise.resolve({ ok: false, error: 'the app disconnected during the tool' });
    return bridge.call(name, args);
  };
  const must = async (session: number | undefined, name: string, args?: Record<string, unknown>): Promise<Json> => {
    const outcome = await call(session, name, args);
    if (!outcome.ok) throw new Failure(outcome.error);
    return outcome.result;
  };
  const path = (args: Record<string, unknown>, required: boolean): string | undefined => {
    const value = args.path;
    if ((value === undefined || value === null) && !required) return undefined; // null counts as not given, as for every other argument
    if (typeof value !== 'string' || value === '') throw new Failure('argument "path": a file path is expected');
    return resolve(value === '~' || value.startsWith('~/') ? homedir() + value.slice(1) : value);
  };
  const PATH = (description: string, required = true): JsonSchema => ({ type: 'object', properties: { path: { type: 'string', description } }, required: required ? ['path'] : [], additionalProperties: false });

  // Exports run one after another: a client may send several at once, and two of them checking
  // and writing the same directory at the same time could not keep "nothing is written unless
  // every file can be written".
  let exporting: Promise<unknown> = Promise.resolve();
  const oneByOne = <T>(work: () => Promise<T>): Promise<T> => {
    const run = exporting.then(work, work);
    exporting = run.catch(() => undefined);
    return run;
  };

  const fileTools: FileTool[] = [
    {
      name: 'session_status',
      description:
        'What the tools work on: the running app (the user sees the changes at once), or the server\'s own engine with a document from a file. ' +
        'When the bridge could not listen (`bridgeError`, its port held by another server), `openBridge: true` tries the port now and says how it went (`openBridge`); the server never tries by itself. Take the port only when the app should be bridged to this server.',
      inputSchema: { type: 'object', properties: { openBridge: { type: 'boolean', description: 'try now to listen on the port of the bridge, when this server could not' } }, additionalProperties: false },
      run: async (args) => {
        const opened = args.openBridge === true ? await openBridgeNow() : undefined;
        const session = bridge?.session();
        if (session !== undefined) await call(session, '_ping'); // the app may have replaced the document in the meantime
        return {
          engine: session === undefined ? 'server' : 'app',
          file: fileOf(session) ?? null,
          bridge: bridge ? { port: bridge.port, appConnected: session !== undefined } : null,
          ...(!bridge && bridgeFailure ? { bridgeError: bridgeError(bridgeFailure) } : {}),
          ...(opened ? { openBridge: opened } : {}),
          note:
            session !== undefined
              ? 'The tools work with the document open in the app. `file` is the file that was opened into the app or saved from it by this server.'
              : `No app is connected; the tools work with the server's own document${bridge ? ' (in the app the connection is switched on by the button AI)' : bridgeFailure ? ' (the bridge is not open: see bridgeError)' : ''}. open_document opens a document from a file.`,
        };
      },
    },
    {
      name: 'open_document',
      description: 'Loads a document from a file (JSON saved by the app or by save_document). It replaces the document open now and its undo history.',
      inputSchema: PATH('path of the .json file'),
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        let json: string;
        try {
          json = (await readFile(target, 'utf8')).replace(/^\uFEFF/, '');
        } catch (error) {
          throw new Failure(`the file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (json.trim() === '') throw new Failure('the file is empty');
        const model = await must(session, '_load', { json });
        remember(session, target);
        return { file: target, model };
      },
    },
    {
      name: 'save_document',
      description:
        'Saves the document to a file; an existing file is overwritten. Without a path, to the file this document was opened from or last saved to. ' +
        'With `stored` (the ID of a stored document, `kit/bearing` inside another one) it writes that stored document to `path` as a document of its own, to be opened, changed and brought back by insert_document with `replace`.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'path of the .json file; by default the file of this document (see session_status); required with `stored`' }, stored: { type: 'string', description: 'the ID of a stored document to write instead of the document' } },
        required: [],
        additionalProperties: false,
      },
      run: async (args) => {
        const session = bridge?.session();
        const given = path(args, false);
        if (args.stored !== undefined && args.stored !== null) {
          if (typeof args.stored !== 'string' || args.stored === '') throw new Failure('argument "stored": the ID of a stored document is expected');
          if (given === undefined) throw new Failure('argument "path": a stored document is written to a file of its own; give its path');
          let part: string;
          try {
            part = JSON.stringify(storedDocument(JSON.parse((await must(session, '_save')) as string), args.stored));
          } catch (error) {
            if (error instanceof ToolError) throw new Failure(error.message);
            throw error;
          }
          await mkdir(dirname(given), { recursive: true });
          await writeFile(given, part);
          return { file: given, stored: args.stored, bytes: Buffer.byteLength(part) } as Json;
        }
        // The document first, then the file: the document comes with whether it is still the one the
        // remembered file belongs to.
        const json = (await must(session, '_save')) as string;
        const target = given ?? fileOf(session);
        if (target === undefined) throw new Failure('the document has no file; give "path"');
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, json);
        remember(session, target);
        return { file: target, bytes: Buffer.byteLength(json) };
      },
    },
    {
      name: 'import_outline',
      description:
        `Reads a 2D outline (${Object.entries(OUTLINE_FORMATS).map(([format, spec]) => `${format}: .${spec.extensions.join(', .')}`).join('; ')}) for a sketch: a board of a PCB tool, a drawing for a laser cutter (D72). ` +
        'Without `sketch` it only reads the file and answers with the report: the curves by kind, the unit and where it came from, the layers of the file with what each holds, what was left out, what the weld did, the open ends and the nearest gaps, the bounds, notes. Look first, then place. ' +
        'With `sketch` it places the curves as an entry `outline` of `external` (addExternal under `id`, by default from the name of the file; one undo step): fixed reference geometry that forms regions, at `x`, `y` (mm) and `turn` (rad, each may be an expression) by its `anchor` (`origin` of the file or the `center` of its box). Its curves are `<id>/l1`, `<id>/a1`, `<id>/c1`, `<id>/s1` … by kind and order of the file, their points `<id>/l1/a`, `<id>/c1/center`, `<id>/s1/0` … (`report.ids` says the last numbers and the unused ones). ' +
        'With `replace: true` and `id` it reads a revised file into that entry (updateExternal): with the options the entry stores unless `options` is given, keeping the placement and the IDs by kind and order; the answer has `revision`, and `hold`, the constraints that name an entity the file takes away or changes in kind. Such a revision is refused (nothing changes) unless they are in `remove`, the constraints to remove in the same step. ' +
        'Options of the formats (`layers`, `unit`, `weld`) are in describe_api, section Outline formats. The answer never holds the curves: get_sketch lists the first, the query entryCurves the rest, the query sketchRegions the regions to extrude.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path of the file' },
          format: { type: 'string', enum: Object.keys(OUTLINE_FORMATS), description: 'the format; by default the extension of the path decides (for a replacement, else the format of the entry)' },
          options: { type: 'object', description: 'the options of the format: `layers` (a list of names), `unit`, `weld` (mm)' },
          sketch: { type: 'string', description: 'the sketch to place the outline in; without it the file is only read' },
          id: { type: 'string', description: 'the ID of the entry; by default from the name of the file' },
          replace: { type: 'boolean', description: 'read a revised file into the entry `id`' },
          remove: { type: 'array', items: { type: 'string' }, description: 'with replace: constraints of the sketch to remove in the same step' },
          name: { type: 'string', description: 'the name of the entry, for people; by default the name of the file' },
          x: { type: ['number', 'string'], description: 'mm, a number or an expression' },
          y: { type: ['number', 'string'], description: 'mm, a number or an expression' },
          turn: { type: ['number', 'string'], description: 'rad, a number or an expression (deg(90))' },
          anchor: { type: 'string', enum: ['origin', 'center'], description: 'what stands at (x, y): the origin of the file or the centre of its box' },
          regions: { type: 'boolean', description: 'whether the curves bound regions (true by default)' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        let bytes: Uint8Array;
        try {
          const size = (await stat(target)).size;
          if (size > OUTLINE_LIMITS.bytes) throw new Failure(`tooLarge: the file has ${size} bytes, more than ${OUTLINE_LIMITS.bytes}`);
          bytes = new Uint8Array(await readFile(target));
        } catch (error) {
          if (error instanceof Failure) throw error;
          throw new Failure(`the file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { path: _, ...rest } = args;
        // the bytes go where the engine is, over the bridge as base64 (D72)
        const outcome = await call(session, OUTLINE_BRIDGE_TOOL, { ...rest, file: { name: basename(target), base64: Buffer.from(bytes).toString('base64') } });
        // an app older than this server has no `_outline`: said as for `_export`
        if (!outcome.ok) throw new Failure(session !== undefined && unknownTool(outcome.error, OUTLINE_BRIDGE_TOOL) ? 'the connected app is older than this server and cannot import an outline; reload the app' : outcome.error);
        return { ...(outcome.result as { [key: string]: Json }), file: target };
      },
    },
    {
      name: 'import_mesh',
      description:
        `Reads a mesh file (${Object.entries(IMPORT_FORMATS).map(([format, spec]) => `${format}: .${spec.extensions.join(', .')}`).join('; ')}) into a stored mesh of the document: the command addMesh, one undo step. The file has to hold a closed solid (refused otherwise, with the count of the edges that are wrong). ` +
        'It answers with the ID of the stored mesh, the report of the import (triangles, shells, hollows, the volume, the bounds in mm, notes) and `next`: the batch that places the mesh as a body, a feature of the type mesh on the base plane XY and setBodyProperties with `use: "reference"`, to be changed (the frame, the offsets, the turns, the mass of the data sheet) and sent with execute. Options of the formats are in describe_api, section Import formats.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path of the file' },
          format: { type: 'string', enum: Object.keys(IMPORT_FORMATS), description: 'the format; by default the extension of the path decides' },
          options: { type: 'object', description: 'the options of the format, by name (STL: `unit`, one of mm, cm, m, in)' },
          id: { type: 'string', description: 'the ID of the stored mesh; by default the name of the file' },
          name: { type: 'string', description: 'the name of the stored mesh, for people; by default the name of the file' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        const format = (args.format ?? importFormatOf(target)) as ImportFormat | undefined;
        if (format === undefined) throw new Failure(`the format of "${basename(target)}" cannot be told from its extension; give \`format\` (${Object.keys(IMPORT_FORMATS).join(', ')})`);
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await readFile(target));
        } catch (error) {
          throw new Failure(`the file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        // the name of the file, trimmed and cut to the length of a name, unless one is given
        const name = args.name === undefined || args.name === null ? meshNameOf(target) : args.name;
        if (name !== undefined && typeof name !== 'string') throw new Failure('argument "name": a text is expected');
        const outcome = importMesh(format, bytes, (args.options ?? undefined) as never, name);
        if (!outcome.ok) throw new Failure(`${outcome.error.code}: ${outcome.error.message}`);
        // the ID: given, or from the name of the file, among the stored meshes of the engine the other tools use
        const document = (await must(session, 'get_document')) as unknown as Document;
        const id = args.id === undefined || args.id === null ? idFromFile(target, (taken) => Object.prototype.hasOwnProperty.call(document.meshes, taken)) : args.id;
        const added = await call(session, 'execute', { command: { type: 'addMesh', id, mesh: outcome.mesh } });
        if (!added.ok) throw new Failure(added.error);
        // the feature takes the ID of the mesh when the document does not use it (a feature, an entity
        // of a sketch, an ID a section names), else the next free one
        const used = new Set([...documentIds(document), ...namedBySections(document)]);
        let feature = String(id);
        for (let n = 2; used.has(feature); n++) feature = `${id}_${n}`;
        const command: Command = {
          type: 'batch',
          commands: [
            { type: 'addFeature', feature: { id: feature, name: fileStemOf(target).trim() || feature, suppressed: false, type: 'mesh', mesh: String(id), placement: { frame: { kind: 'base', plane: 'XY' } } } },
            { type: 'setBodyProperties', body: feature, patch: { use: 'reference' } },
          ],
        };
        const report = rounded(outcome.report) as MeshReport;
        return {
          mesh: id,
          file: target,
          report,
          next: {
            say: `The mesh is stored as "${String(id)}"; nothing is placed yet. Change \`command\` as needed (the frame of \`placement\`, for a bought part best the sketch point at the centre of its bolt pattern; the offsets x, y, z and the turns rx, ry, rz in it; the feature ID) and send it with execute. Add the mass of the data sheet in grams to setBodyProperties (\`mass\`): neither the file nor this tool knows it.`,
            command,
          },
        } as unknown as Json;
      },
    },
    {
      name: 'insert_document',
      description:
        'Reads a document file (JSON as the app or save_document writes it, of any version this build reads) into a stored document of this one (D62): the command addDocument, one undo step; with `replace` the command replaceDocument puts it in the place of the stored document `id` (a new revision of a part), and every insertion of it is recomputed. ' +
        'It answers with the ID of the stored document, its parameters, and `next`: the command that inserts it, a feature of the type insert on the base plane XY, to be changed (the frame and the offsets and turns of `placement`, values for its parameters in `parameters`, the bodies in `bodies`, the feature ID) and sent with execute; and what that command would bring, by a preview of it: the bodies with the use, the material and the mass they inherit from the document, and the warning of the insertion.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path of the document file (.json)' },
          id: { type: 'string', description: 'the ID of the stored document; by default the name of the file reduced to letters, digits and underscores; required with `replace`' },
          name: { type: 'string', description: 'the name of the stored document, for people; by default the name of the file' },
          replace: { type: 'boolean', description: 'replace the stored document `id` instead of adding one' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        let text: string;
        try {
          text = (await readFile(target, 'utf8')).replace(/^\uFEFF/, '');
        } catch (error) {
          throw new Failure(`the file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new Failure(`the file is not a document (JSON): ${error instanceof Error ? error.message : String(error)}`);
        }
        if (args.replace !== undefined && args.replace !== null && typeof args.replace !== 'boolean') throw new Failure('argument "replace": true or false is expected');
        const replace = args.replace === true;
        const name = args.name === undefined || args.name === null ? meshNameOf(target) : args.name;
        if (name !== undefined && typeof name !== 'string') throw new Failure('argument "name": a text is expected');
        // the ID among the stored documents of the engine the other tools use
        const document = (await must(session, 'get_document')) as unknown as Document;
        const stored = document.documents ?? {};
        const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(stored, key);
        if (replace && (typeof args.id !== 'string' || !has(args.id))) throw new Failure(`argument "id": with \`replace\` the ID of a stored document to replace is required${Object.keys(stored).length ? ` (the stored documents: ${Object.keys(stored).join(', ')})` : ' (the document has none)'}`);
        const id = args.id === undefined || args.id === null ? idFromFile(target, has, 'document') : args.id;
        const added = await call(session, 'execute', { command: replace ? { type: 'replaceDocument', id, document: parsed, ...(args.name === undefined || args.name === null ? {} : { name }) } : { type: 'addDocument', id, document: parsed, ...(name === undefined ? {} : { name }) } });
        if (!added.ok) throw new Failure(added.error);
        // the feature takes the ID of the stored document when the document does not use it (a
        // feature, an entity of a sketch, an ID a section names), else the next free one
        const used = new Set([...documentIds(document), ...namedBySections(document)]);
        let feature = String(id);
        for (let n = 2; used.has(feature); n++) feature = `${id}_${n}`;
        const command: Command = { type: 'addFeature', feature: { id: feature, name: (typeof name === 'string' ? name : fileStemOf(target)).replace(/\.json$/i, '').trim() || feature, suppressed: false, type: 'insert', document: String(id), placement: { frame: { kind: 'base', plane: 'XY' } } } };
        // the document is stored by now: a preview that fails says so in the answer, not as an error
        type Preview = { parameters: Json[]; bodies: { id: string; use: string; material?: string; mass?: number }[]; warning?: string };
        let preview: Preview;
        try {
          preview = (await must(session, '_insertion', { document: id, command })) as Preview;
        } catch (error) {
          preview = { parameters: [], bodies: [], warning: `the document is ${replace ? 'replaced' : 'stored'}, but what an insertion would bring could not be previewed: ${error instanceof Error ? error.message : String(error)}` };
        }
        const printed = preview.bodies.filter((body) => body.use === 'part').map((body) => body.id);
        return {
          document: id,
          file: target,
          ...(replace ? { replaced: true } : {}),
          parameters: preview.parameters,
          bodies: preview.bodies,
          ...(preview.warning ? { warning: preview.warning } : {}),
          next: {
            say:
              `The document is ${replace ? 'replaced' : 'stored'} as "${String(id)}"${replace ? '; every insertion of it is recomputed' : '; nothing is inserted yet'}. Change \`command\` as needed (the frame of \`placement\` and its offsets and turns; values for its parameters in \`parameters\`; \`bodies\` to bring only some; the feature ID) and send it with execute. ` +
              (printed.length ? `The bodies ${printed.join(', ')} come in as printed parts (use \`part\`); a bought part should be \`use: "reference"\` with the mass of its data sheet, in its own document or by setBodyProperties here.` : 'Every body comes in with the use its document states.'),
            command,
          },
        } as unknown as Json;
      },
    },
    {
      name: 'export_stl',
      description:
        'Saves bodies of the model as binary STL. By default the printed bodies (use `part` of the body properties; not the reference and auxiliary bodies) go into the one file `path`, which is overwritten. `bodies` chooses the bodies, whatever their use. With `perBody` every body gets its own file in the directory `path` (one printable part per file); the file name is the body ID with every character other than letters, digits, dot, dash and underscore written as %XX, so `planets/1` is `planets%2F1.stl`. Per body nothing is written when a file already exists (unless `overwrite` allows replacing it), when two names differ only in the case of letters or when a name is too long for a file; the files appear only after all of them were written.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path of the .stl file, or of the directory with `perBody`' },
          bodies: { type: 'array', items: { type: 'string' }, description: 'body IDs; the printed bodies by default' },
          perBody: { type: 'boolean', description: 'one file per body in the directory `path`' },
          overwrite: { type: 'boolean', description: 'with `perBody`: replace files that already exist' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      run: (args) => oneByOne(async () => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        for (const flag of ['perBody', 'overwrite']) if (args[flag] !== undefined && args[flag] !== null && typeof args[flag] !== 'boolean') throw new Failure(`argument "${flag}": true or false is expected`);
        const perBody = args.perBody === true;
        const exported = (await must(session, '_export_stl', { ...(args.bodies === undefined ? {} : { bodies: args.bodies }), perBody })) as { files: { name?: string; bodies: string[]; triangles: number; base64: string }[] };
        const files = exported.files.filter((file) => file.bodies.length > 0);
        if (files.length === 0) throw new Failure('the model has no body to export');
        const out = files.map((file): OutFile => ({ name: perBody ? `${file.name}.stl` : '', subject: file.bodies[0], base64: file.base64, about: { bodies: file.bodies, triangles: file.triangles } }));
        return (await writeExport(target, perBody ? 'directory' : 'file', out, args.overwrite === true, STL_WORDING)) as Json;
      }),
    },
    {
      name: 'export',
      description:
        `Exports the model in a format of the engine's catalog: ${Object.keys(EXPORT_FORMATS).join(', ')}. The options of each format are in describe_api, section Export formats. A format writes one file, and then \`path\` is that file and is overwritten, ` +
        'or a set of files, and then `path` is a directory: nothing is written unless every file can be, and a file that already exists is replaced only with `overwrite`. `at` exports the state after that feature; `after` is a command to preview first, and what is exported is the model after it, with nothing written to the document.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: Object.keys(EXPORT_FORMATS), description: 'The export format.' },
          path: { type: 'string', description: 'path of the file, or of the directory for a format or an option that writes a set of files' },
          options: { type: 'object', description: 'The options of the format, by name; see describe_api.' },
          overwrite: { type: 'boolean', description: 'for a set of files: replace files that already exist' },
          at: { type: 'string', description: 'Feature ID; the state after it' },
          after: { type: 'object', description: 'A command (as for execute) to preview first; the result is exported and the document does not change.' },
        },
        required: ['format', 'path'],
        additionalProperties: false,
      },
      run: (args) => oneByOne(async () => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        const given = Object.fromEntries(['format', 'options', 'at', 'after'].filter((name) => args[name] !== undefined && args[name] !== null).map((name) => [name, args[name]]));
        const outcome = await call(session, '_export', given);
        // an app from before the catalog of formats does not know the internal tool
        if (!outcome.ok) throw new Failure(session !== undefined && unknownTool(outcome.error, '_export') ? 'the connected app is older than this server and cannot export a format of the catalog; reload the app' : outcome.error);
        const answer = outcome.result as unknown as Extract<ToolAnswer, { kind: 'files' }>;
        // a format that returns no file and does not say why is a defect; nothing is written, not even the folder
        if (answer.files.length === 0) throw new Failure('nothing was written, the export has no file');
        // the form of the paths is the engine's to guarantee; what is written to disk is checked again
        const problem = exportPathProblem(answer.files);
        if (problem) throw new Failure(`nothing was written, the export has a path that cannot be written: ${problem}`);
        const nested = answer.files.filter((file) => file.path.includes('/'));
        if (nested.length) throw new Failure(`nothing was written, this server cannot write an export with folders yet: ${nested.map((file) => file.path).join(', ')}`);
        const out = answer.files.map((file): OutFile => ({ name: file.path, subject: file.path, base64: file.base64, about: file.about ?? {} }));
        return (await writeExport(target, answer.layout, out, args.overwrite === true, FILE_WORDING)) as Json;
      }),
    },
  ];
  // an operation of the app is a tool by its name and is looked up first: it must not shadow a tool
  const shadowed = hostOperationProblems(operations, [...tools().map((tool) => tool.name), ...fileTools.map((tool) => tool.name)]);
  if (shadowed.length) throw new Error(`createTrymeshServer: ${shadowed.join('; ')}`);

  const server = new Server({ name: 'trymesh', version: '0.0.0' }, { capabilities: { tools: {} } });
  // A small result is printed with indentation (it reads better), a large one compactly.
  const print = (value: Json): string => {
    if (typeof value === 'string') return value;
    const compact = JSON.stringify(value);
    return compact.length > COMPACT_FROM ? compact : JSON.stringify(value, null, 1);
  };
  const reply = (value: Json, isError = false) => ({ content: [{ type: 'text' as const, text: print(value) }], ...(isError ? { isError: true } : {}) });
  // The answer of an operation of the app is a `ToolAnswer`, and the server acts on its kind. Files
  // need a path to be written to, which an operation does not take: the tool `export` is the one
  // that writes.
  const answer = (name: string, value: ToolAnswer) =>
    value.kind === 'image' ? { content: [{ type: 'image' as const, data: value.base64, mimeType: value.mediaType }, ...(value.about ? [{ type: 'text' as const, text: print(value.about) }] : [])] } : value.kind === 'data' ? reply(value.data) : reply(`the operation ${name} answered with files, which this tool has no path to write to`, true);
  // An operation of the app as a tool: its arguments are those of its description, checked by the
  // app in the state of its document.
  const operationTools = () =>
    hostOperations(operations).map((entry) => ({
      name: entry.query,
      description: `${entry.summary} Returns ${entry.returns} It runs in the app: without a connected app it answers notAvailable.`,
      inputSchema: {
        type: 'object',
        // `at` and `after` of the path (5b) with their types, as the tool `query` declares them
        properties: Object.fromEntries(entry.args.map((arg) => [arg.name, { ...(arg.name === 'at' ? { type: 'string' } : arg.name === 'after' ? { type: 'object' } : {}), description: arg.description }])),
        required: entry.args.filter((arg) => arg.required).map((arg) => arg.name),
        additionalProperties: false,
      } as JsonSchema,
    }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools().filter((tool) => !tool.hidden), ...fileTools, ...operationTools()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // the first answer after the tools switched engines says so (D73, review)
    const note = switched(bridge?.session());
    const answered = await respond(name, args);
    followEmptied();
    return note === undefined ? answered : { ...answered, content: [...answered.content, { type: 'text' as const, text: note }] };
  });
  // What the last tool worked on: the server's own engine, or the app of one connection.
  let target: string | undefined;
  const switched = (session: number | undefined): string | undefined => {
    const now = session === undefined ? 'server' : `app ${session}`;
    const before = target;
    target = now;
    if (before === undefined || before === now) return undefined;
    if (session === undefined) return 'Note: the app is no longer connected. This tool worked on the server\'s own document, not on the app\'s, which the answers before were about (see session_status).';
    if (before === 'server') return 'Note: the app connected through the bridge. This tool worked on the document open in the app; the answers before were about the server\'s own document (see session_status).';
    return 'Note: the app connected anew (another connection of the bridge). This tool worked on the document open in the app now connected, which may be another one than before (see session_status).';
  };
  const respond = async (name: string, args: Record<string, unknown>) => {
    const fileTool = fileTools.find((tool) => tool.name === name);
    try {
      if (fileTool) {
        const problem = argumentProblem(fileTool.inputSchema, args);
        return problem ? reply(problem, true) : reply(await fileTool.run(args));
      }
      if (isHostOperation(name, operations)) {
        const session = bridge?.session();
        if (session === undefined) return reply(noAppText(name), true);
        const outcome = await call(session, name, args);
        return outcome.ok ? answer(name, outcome.result as ToolAnswer) : reply(outcome.error, true);
      }
      if (name.startsWith('_')) return reply(`unknown tool "${name}"`, true);
      const session = bridge?.session();
      const own = session === undefined ? engine.getState().document : undefined;
      const outcome = await call(session, name, args);
      if (!outcome.ok) return reply(outcome.error, true);
      // an empty document is no longer the one of the file: a save without a path must not write it there
      if (name === 'new_document' && (outcome.result as { discarded?: object }).discarded && Object.keys((outcome.result as { discarded: object }).discarded).length > 0) {
        const file = fileOf(session);
        forget(session);
        emptied = own && file !== undefined ? { path: file, before: own, after: engine.getState().document } : undefined;
      }
      // a note beside the result (the pose a query answered for, D49) is a second text
      return outcome.about === undefined ? reply(outcome.result) : { content: [...reply(outcome.result).content, { type: 'text' as const, text: print(outcome.about) }] };
    } catch (error) {
      if (error instanceof Failure) return reply(error.message, true);
      return reply(`the tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  };
  return server;
}
