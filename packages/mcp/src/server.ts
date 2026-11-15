// MCP server: nástroje nad enginem pro AI. Engine je buď vlastní (dokument ze souboru), nebo engine
// běžící aplikace připojené přes most; nástroje jsou v obou případech tytéž.
import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Engine } from '@trymesh/engine';
import type { Bridge } from './bridge';
import { type Json, type JsonSchema, type ToolOutcome, argumentProblem, callTool, tools } from './tools';

export interface TrymeshServerOptions {
  engine: Engine; // vlastní engine serveru; použije se, když není připojená aplikace
  bridge?: Bridge;
  file?: string; // soubor, ze kterého je dokument vlastního enginu
}

interface FileTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(args: Record<string, unknown>): Promise<Json>;
}

class Failure extends Error {}

const COMPACT_FROM = 20_000; // znaků

export function createTrymeshServer(options: TrymeshServerOptions): Server {
  const { engine, bridge } = options;
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

  const MAX_FILE_NAME = 255; // bytes
  const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
      description: 'Uloží dokument do souboru; existující soubor přepíše. Bez cesty do souboru, ze kterého byl tento dokument otevřen nebo do kterého byl naposledy uložen.',
      inputSchema: PATH('cesta k souboru .json; výchozí je soubor tohoto dokumentu (viz session_status)', false),
      run: async (args) => {
        const session = bridge?.session();
        const given = path(args, false);
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
      name: 'export_stl',
      description:
        'Saves bodies of the model as binary STL. By default all bodies go into the one file `path`, which is overwritten. `bodies` chooses the bodies. With `perBody` every body gets its own file in the directory `path` (one printable part per file); the file name is the body ID with every character other than letters, digits, dot, dash and underscore written as %XX, so `planets/1` is `planets%2F1.stl`. Per body nothing is written when a file already exists (unless `overwrite` allows replacing it), when two names differ only in the case of letters or when a name is too long for a file; the files appear only after all of them were written.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path of the .stl file, or of the directory with `perBody`' },
          bodies: { type: 'array', items: { type: 'string' }, description: 'body IDs; all bodies by default' },
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
        const files = exported.files.filter((file) => file.bodies.length > 0).map((file) => ({ ...file, path: perBody ? join(target, `${file.name}.stl`) : target }));
        if (files.length === 0) throw new Failure('the model has no body to export');
        const existing: string[] = []; // files of the set that are on disk already
        if (perBody) {
          // a file name is limited to 255 bytes on the common file systems; found before anything is written
          const long = files.filter((file) => Buffer.byteLength(`${file.name}.stl`) > MAX_FILE_NAME);
          if (long.length) throw new Failure(`nothing was written, the file names of these bodies are longer than ${MAX_FILE_NAME} bytes: ${long.map((file) => file.bodies[0]).join(', ')} (export them into one file with \`bodies\`, or rename the features)`);
          // File names come from body IDs, so the caller did not name them one by one: nothing is
          // written unless every file can be written without replacing or shadowing another.
          const seen = new Map<string, string>();
          for (const file of files) {
            const folded = file.path.toLowerCase();
            const other = seen.get(folded);
            if (other !== undefined) throw new Failure(`the bodies "${other}" and "${file.bodies[0]}" would get file names that differ only in the case of letters; export them separately`);
            seen.set(folded, file.bodies[0]);
          }
          for (const file of files) {
            const found = await lstat(file.path).catch(() => undefined);
            // something that is not a file (a directory of that name) cannot be replaced by one
            if (found && !found.isFile()) throw new Failure(`nothing was written, ${file.path} exists and is not a file`);
            if (found) existing.push(file.path);
          }
          if (existing.length && args.overwrite !== true) throw new Failure(`nothing was written, these files already exist: ${existing.join(', ')} (choose another directory or pass overwrite: true)`);
        }
        const directory = perBody ? target : dirname(target);
        // the first directory this call had to create, if any: taken away again when the export fails
        const created = await mkdir(directory, { recursive: true }).catch((error) => {
          throw new Failure(`nothing was written, the directory ${directory} cannot be created: ${reason(error)}`);
        });
        const tidy = async (): Promise<void> => {
          if (created === undefined) return;
          // only directories that are still empty, from the target up to the first one created
          for (let at = directory; at.length >= created.length; at = dirname(at)) {
            if (!(await rmdir(at).then(() => true, () => false)) || at === created) break;
          }
        };
        const written: { path: string; bodies: string[]; triangles: number; bytes: number }[] = [];
        if (!perBody) {
          try {
            for (const file of files) {
              const bytes = Buffer.from(file.base64, 'base64');
              await writeFile(file.path, bytes);
              written.push({ path: file.path, bodies: file.bodies, triangles: file.triangles, bytes: bytes.length });
            }
          } catch (error) {
            await tidy();
            throw new Failure(`the export failed: ${reason(error)}`);
          }
          return { files: written };
        }
        // Per body the files are first written into a directory of this call inside the target,
        // under their final names, and moved once all of them are on disk. A failure while writing
        // (a full disk, a name or a path the file system refuses) leaves the target as it was
        // instead of a part of the set. The directory is new for every call (mkdtemp), so two
        // exports, or a file of the user, cannot get in each other's way.
        let staging: string | undefined;
        const moved: string[] = [];
        let failure: string | undefined;
        let nothingLeft = false;
        try {
          staging = await mkdtemp(join(target, '.trymesh-export-'));
          for (const file of files) {
            const bytes = Buffer.from(file.base64, 'base64');
            await writeFile(join(staging, `${file.name}.stl`), bytes);
            written.push({ path: file.path, bodies: file.bodies, triangles: file.triangles, bytes: bytes.length });
          }
          for (const file of files) {
            await rename(join(staging, `${file.name}.stl`), file.path);
            moved.push(file.path);
          }
        } catch (error) {
          // A move that fails after others succeeded: the new files that replaced nothing are
          // removed again; a file that replaced an old one cannot be brought back and is named.
          const added = moved.filter((file) => !existing.includes(file));
          const replaced = moved.filter((file) => existing.includes(file));
          const kept = (await Promise.all(added.map((file) => rm(file, { force: true }).then(() => undefined, () => file)))).filter((file) => file !== undefined);
          const left = [
            replaced.length ? `these files had already been replaced by new ones: ${replaced.join(', ')}` : '',
            kept.length ? `these new files could not be removed again: ${kept.join(', ')}` : '',
          ].filter((text) => text !== '');
          nothingLeft = left.length === 0;
          failure = `the export failed: ${reason(error)}. ${nothingLeft ? 'Nothing of it was left in the directory' : `The set is not complete; ${left.join('; ')}`}`;
        }
        // the directory of the call goes in every case; one that cannot be removed is said, not hidden
        const stale = staging === undefined ? undefined : await rm(staging, { recursive: true, force: true }).then(() => undefined, () => staging);
        const leftover = stale === undefined ? '' : `the temporary directory ${stale} could not be removed`;
        if (failure !== undefined) {
          if (nothingLeft && stale === undefined) await tidy();
          throw new Failure(leftover ? `${failure}; ${leftover}` : failure);
        }
        return { files: written, ...(leftover ? { note: leftover } : {}) };
      }),
    },
  ];

  const server = new Server({ name: 'trymesh', version: '0.0.0' }, { capabilities: { tools: {} } });
  // Malý výsledek se vypíše s odsazením (čte se líp), velký úsporně.
  const print = (value: Json): string => {
    if (typeof value === 'string') return value;
    const compact = JSON.stringify(value);
    return compact.length > COMPACT_FROM ? compact : JSON.stringify(value, null, 1);
  };
  const reply = (value: Json, isError = false) => ({ content: [{ type: 'text' as const, text: print(value) }], ...(isError ? { isError: true } : {}) });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools().filter((tool) => !tool.hidden), ...fileTools].map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })),
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
      if (name.startsWith('_')) return reply(`neznámý nástroj "${name}"`, true);
      const outcome = await call(bridge?.session(), name, args);
      return outcome.ok ? reply(outcome.result) : reply(outcome.error, true);
    } catch (error) {
      if (error instanceof Failure) return reply(error.message, true);
      return reply(`nástroj ${name} selhal: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  return server;
}
