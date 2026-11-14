// MCP server: nástroje nad enginem pro AI. Engine je buď vlastní (dokument ze souboru), nebo engine
// běžící aplikace připojené přes most; nástroje jsou v obou případech tytéž.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Engine } from '@trymesh/engine';
import type { Bridge } from './bridge';
import { type Json, type JsonSchema, type ToolOutcome, callTool, tools } from './tools';

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
  // Každý dokument má svůj soubor: vlastní dokument serveru jeden, dokument v aplikaci druhý
  // (a jen po dobu jednoho připojení aplikace). Uložení bez cesty tak nikdy nezapíše dokument
  // jednoho enginu přes soubor druhého.
  let serverFile = options.file === undefined ? undefined : resolve(options.file);
  let appFile: { session: number; path: string } | undefined;
  const fileOf = (session: number | undefined): string | undefined => (session === undefined ? serverFile : appFile?.session === session ? appFile.path : undefined);
  const remember = (session: number | undefined, path: string) => {
    if (session === undefined) serverFile = path;
    else appFile = { session, path };
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
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || value === '') throw new Failure('argument "path": čeká se cesta k souboru');
    return resolve(value === '~' || value.startsWith('~/') ? homedir() + value.slice(1) : value);
  };
  const PATH = (description: string, required = true): JsonSchema => ({ type: 'object', properties: { path: { type: 'string', description } }, required: required ? ['path'] : [], additionalProperties: false });

  const fileTools: FileTool[] = [
    {
      name: 'session_status',
      description: 'Nad čím nástroje pracují: nad běžící aplikací (uživatel změny hned vidí), nebo nad vlastním enginem serveru s dokumentem ze souboru.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const session = bridge?.session();
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
        const target = path(args, false) ?? fileOf(session);
        if (target === undefined) throw new Failure('dokument nemá soubor; zadejte "path"');
        const json = (await must(session, '_save')) as string;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, json);
        remember(session, target);
        return { file: target, bytes: Buffer.byteLength(json) };
      },
    },
    {
      name: 'export_stl',
      description: 'Uloží všechna tělesa modelu do binárního souboru STL; existující soubor přepíše.',
      inputSchema: PATH('cesta k souboru .stl'),
      run: async (args) => {
        const session = bridge?.session();
        const target = path(args, true) as string;
        const exported = (await must(session, '_export_stl')) as { base64: string; bodies: number };
        if (exported.bodies === 0) throw new Failure('model nemá žádné těleso');
        const bytes = Buffer.from(exported.base64, 'base64');
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        return { file: target, bytes: bytes.length, bodies: exported.bodies };
      },
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
      if (fileTool) return reply(await fileTool.run(args));
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
