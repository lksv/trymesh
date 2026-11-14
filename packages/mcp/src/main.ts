// Spuštění MCP serveru nad standardním vstupem a výstupem.
//   node dist/server.js [--file model.json] [--port 4517] [--no-bridge]
import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { type Bridge, DEFAULT_BRIDGE_PORT, startBridge } from './bridge';
import { createTrymeshServer } from './server';

// Standardní výstup patří protokolu; zprávy pro člověka jdou na chybový výstup.
const log = (message: string) => process.stderr.write(`trymesh-mcp: ${message}\n`);
const fail = (message: string, usage = true): never => {
  log(message);
  if (usage) log('použití: node server.js [--file model.json] [--port 4517] [--no-bridge]');
  process.exit(2);
};

// Volby: `--jméno hodnota` nebo `--jméno=hodnota`; neznámá volba je chyba.
const options: { file?: string; port?: string; bridge: boolean } = { bridge: true };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const [name, inline] = args[i].split(/=(.*)/s, 2) as [string, string | undefined];
  const value = (): string => {
    const next = inline ?? args[++i];
    if (next === undefined || (inline === undefined && next.startsWith('--'))) fail(`volba ${name} potřebuje hodnotu`);
    return next;
  };
  if (name === '--file') options.file = value();
  else if (name === '--port') options.port = value();
  else if (name === '--no-bridge' && inline === undefined) options.bridge = false;
  else fail(`neznámá volba ${args[i]}`);
}
const portText = options.port ?? process.env.TRYMESH_BRIDGE_PORT ?? String(DEFAULT_BRIDGE_PORT);
const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
if (!(port >= 0 && port <= 65535)) fail(`port "${portText}" není číslo od 0 do 65535`);

const engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
if (options.file !== undefined) {
  let json: string;
  try {
    json = (await readFile(options.file, 'utf8')).replace(/^\uFEFF/, '');
  } catch (error) {
    json = fail(`soubor ${options.file} nejde přečíst: ${error instanceof Error ? error.message : String(error)}`, false);
  }
  const result = engine.load(json);
  if (!result.ok) fail(`soubor ${options.file} nejde načíst: ${result.error.message}`, false);
}

let bridge: Bridge | undefined;
if (options.bridge) {
  try {
    bridge = await startBridge(port);
    log(`most pro aplikaci poslouchá na http://127.0.0.1:${bridge.port}`);
  } catch (error) {
    // Port drží jiný MCP server. Tento poběží jen nad vlastním dokumentem.
    log(`most na portu ${port} nejde otevřít (${error instanceof Error ? error.message : String(error)}); server pracuje jen se soubory`);
  }
}

const server = createTrymeshServer({ engine, bridge, file: options.file });
await server.connect(new StdioServerTransport());
log('připraven');

// Konec: signál, nebo klient zavřel vstup. Bez toho by most držel proces i port naživu
// a aplikace by se připojovala k serveru, se kterým už nikdo nemluví.
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void Promise.allSettled([bridge?.close(), server.close()]).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
