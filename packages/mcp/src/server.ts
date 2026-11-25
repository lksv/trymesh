// MCP server: nástroje nad enginem pro AI. Engine je buď vlastní (dokument ze souboru), nebo engine
// běžící aplikace připojené přes most; nástroje jsou v obou případech tytéž.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { type Command, EXPORT_FORMATS, type Engine, IMPORT_FORMATS, type Document, type ImportFormat, type MeshReport, documentIds, exportPathProblem, OUTLINE_FORMATS, OUTLINE_LIMITS, fileStemOf, idFromFile, importFormatOf, importMesh, meshNameOf, namedBySections } from '@trymesh/engine';
import type { Bridge } from './bridge';
import { Failure, type OutFile, type Wording, writeExport } from './export-writer';
import { hostOperations } from './api';
import { HOST_OPERATIONS, type HostOperationSet, hostOperationProblems, isHostOperation, noAppText } from './host';
import { type Json, type JsonSchema, OUTLINE_BRIDGE_TOOL, type ToolAnswer, type ToolOutcome, ToolError, argumentProblem, callTool, storedDocument, tools } from './tools';

export interface TrymeshServerOptions {
  engine: Engine; // vlastní engine serveru; použije se, když není připojená aplikace
  bridge?: Bridge;
  file?: string; // soubor, ze kterého je dokument vlastního enginu
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

const COMPACT_FROM = 20_000; // znaků

const rounded = (value: unknown): unknown =>
  typeof value === 'number' ? Math.round(value * 1e6) / 1e6 + 0 : Array.isArray(value) ? value.map(rounded) : typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)])) : value;

export function createTrymeshServer(options: TrymeshServerOptions): Server {
  const { engine, bridge } = options;
  const operations = options.operations ?? HOST_OPERATIONS;
  // Každý dokument má svůj soubor: vlastní dokument serveru jeden, dokument v aplikaci druhý.
  // Soubor aplikace platí jen po dobu jednoho připojení a jen pro dokument, který v ní byl
  // otevřený, když se do souboru ukládalo nebo z něj načítalo: po Nový nebo Otevřít v aplikaci
  // už neplatí. Uložení bez cesty tak nikdy nezapíše jeden dokument přes soubor jiného.
  let serverFile = options.file === undefined ? undefined : resolve(options.file);
  let appFile: { session: number; document: number | undefined; path: string } | undefined;
  // Číslo dokumentu aplikace je tak čerstvé jako její poslední odpověď; kdo ho potřebuje přesně,
  // zavolá předtím nástroj aplikace (_save, _ping).
  const fileOf = (session: number | undefined): string | undefined =>
    session === undefined ? serverFile : appFile?.session === session && appFile.document === bridge?.document() ? appFile.path : undefined;
  const remember = (session: number | undefined, path: string) => {
    if (session === undefined) serverFile = path;
    else appFile = { session, document: bridge?.document(), path };
  };

  // Nástroj se provede nad enginem aplikace, je-li připojená, jinak nad vlastním. `session` je
  // připojení zjištěné na začátku nástroje: nástroj složený z více kroků tak pracuje celý nad
  // jedním enginem, i kdyby se aplikace mezitím připojila nebo odpojila.
  const call = (session: number | undefined, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> => {
    if (session === undefined) return Promise.resolve(callTool(engine, name, args));
    if (!bridge || bridge.session() !== session) return Promise.resolve({ ok: false, error: 'aplikace se během nástroje odpojila' });
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
    if (typeof value !== 'string' || value === '') throw new Failure('argument "path": čeká se cesta k souboru');
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
      description: 'Nad čím nástroje pracují: nad běžící aplikací (uživatel změny hned vidí), nebo nad vlastním enginem serveru s dokumentem ze souboru.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const session = bridge?.session();
        if (session !== undefined) await call(session, '_ping'); // aplikace mohla mezitím dokument vyměnit
        return {
          engine: session === undefined ? 'server' : 'app',
          file: fileOf(session) ?? null,
          bridge: bridge ? { port: bridge.port, appConnected: session !== undefined } : null,
          note:
            session !== undefined
              ? 'Nástroje pracují s dokumentem otevřeným v aplikaci. `file` je soubor, který byl do aplikace otevřen nebo z ní uložen tímto serverem.'
              : `Aplikace připojená není, nástroje pracují s vlastním dokumentem serveru${bridge ? ' (v aplikaci se propojení zapíná tlačítkem AI)' : ''}. Dokument ze souboru otevře open_document.`,
        };
      },
    },
    {
      name: 'open_document',
      description: 'Načte dokument ze souboru (JSON uložený aplikací nebo save_document). Nahradí právě otevřený dokument a jeho historii undo.',
      inputSchema: PATH('cesta k souboru .json'),
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        let json: string;
        try {
          json = (await readFile(target, 'utf8')).replace(/^\uFEFF/, '');
        } catch (error) {
          throw new Failure(`soubor nejde přečíst: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (json.trim() === '') throw new Failure('soubor je prázdný');
        const model = await must(session, '_load', { json });
        remember(session, target);
        return { file: target, model };
      },
    },
    {
      name: 'save_document',
      description:
        'Uloží dokument do souboru; existující soubor přepíše. Bez cesty do souboru, ze kterého byl tento dokument otevřen nebo do kterého byl naposledy uložen. ' +
        'With `stored` (the ID of a stored document, `kit/bearing` inside another one) it writes that stored document to `path` as a document of its own, to be opened, changed and brought back by insert_document with `replace`.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'cesta k souboru .json; výchozí je soubor tohoto dokumentu (viz session_status); required with `stored`' }, stored: { type: 'string', description: 'the ID of a stored document to write instead of the document' } },
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
        // Nejdřív dokument, pak soubor: s dokumentem přijde i to, jestli je to pořád ten, kterému
        // zapamatovaný soubor patří.
        const json = (await must(session, '_save')) as string;
        const target = given ?? fileOf(session);
        if (target === undefined) throw new Failure('dokument nemá soubor; zadejte "path"');
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
        'With `replace: true` and `id` it reads a revised file into that entry (updateExternal): with the options the entry stores unless `options` is given, keeping the placement and the IDs by kind and order; the answer has `revision`. A revision that takes away an entity a constraint holds is refused (nothing changes); `remove` lists constraints to remove in the same step. ' +
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
        const answer = (await must(session, OUTLINE_BRIDGE_TOOL, { ...rest, file: { name: basename(target), base64: Buffer.from(bytes).toString('base64') } })) as { [key: string]: Json };
        return { ...answer, file: target };
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
        if (!outcome.ok) throw new Failure(session !== undefined && outcome.error === 'neznámý nástroj "_export"' ? 'the connected app is older than this server and cannot export a format of the catalog; reload the app' : outcome.error);
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
  // Malý výsledek se vypíše s odsazením (čte se líp), velký úsporně.
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
      if (name.startsWith('_')) return reply(`neznámý nástroj "${name}"`, true);
      const outcome = await call(bridge?.session(), name, args);
      if (!outcome.ok) return reply(outcome.error, true);
      // a note beside the result (the pose a query answered for, D49) is a second text
      return outcome.about === undefined ? reply(outcome.result) : { content: [...reply(outcome.result).content, { type: 'text' as const, text: print(outcome.about) }] };
    } catch (error) {
      if (error instanceof Failure) return reply(error.message, true);
      return reply(`nástroj ${name} selhal: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  return server;
}
