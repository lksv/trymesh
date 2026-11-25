// Strana aplikace: připojí engine k mostu MCP serveru a obsluhuje jeho požadavky. Běží v prohlížeči
// i v Node (testy), proto čte proud událostí přes fetch a ne přes EventSource.
import type { Engine } from '@trymesh/engine';
import { HOST_OPERATIONS, type Host, type HostOperationSet, callHostOperation, hostOperationProblems, isHostOperation } from './host';
import { MUTATING, type ToolOutcome, callProblem, callTool, tools } from './tools';

export { MUTATING, changesDocument, outlineSaid } from './tools';

// Stejná hlavička jako na straně serveru (bridge.ts); tady zvlášť, aby se do prohlížeče netáhl kód pro Node.
const BRIDGE_HEADER = 'x-trymesh-bridge';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4517';
export type BridgeStatus = 'connecting' | 'connected' | 'off';

export interface BridgeConnection {
  stop(): void;
  // Aplikace vyměnila dokument za jiný (Nový, Otevřít). Server podle toho pozná, že soubor,
  // do kterého ukládal předchozí dokument, tomu novému nepatří.
  documentReplaced(): void;
}

export interface BridgeClientOptions {
  url?: string;
  retryMs?: number; // prodleva mezi pokusy o připojení
  onStatus?: (status: BridgeStatus) => void;
  onDisplaced?: () => void; // k serveru se připojila jiná aplikace; tahle se už sama znovu nepřipojí
  beforeCall?: (name: string, args: Record<string, unknown>) => void; // před provedením nástroje: aplikace si může uklidit rozpracovaný stav
  onCall?: (name: string, outcome: ToolOutcome) => void; // po každém obslouženém požadavku
  // What the operations of the app need of it, with the engine that is connected (host.ts). It is
  // handed to an operation as it is. Without it an operation answers `notAvailable`.
  host?: Host;
  operations?: HostOperationSet; // the operations served; the registry by default (tests give their own)
}

export function connectBridge(engine: Engine, options: BridgeClientOptions = {}): BridgeConnection {
  const url = (options.url ?? DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const abort = new AbortController();
  let stopped = false;
  let document = 0; // pořadové číslo dokumentu; server ho dostává s každou odpovědí
  const operations = options.operations ?? HOST_OPERATIONS;
  const defects = [...hostOperationProblems(operations, tools().map((tool) => tool.name)), ...(options.host !== undefined && options.host.engine !== engine ? ['the host has another engine than the one connected'] : [])];
  if (defects.length) throw new Error(`connectBridge: ${defects.join('; ')}`);
  let status: BridgeStatus | undefined;
  const report = (next: BridgeStatus) => {
    if (status !== next) options.onStatus?.((status = next));
  };

  const serve = async (session: number, call: { id: number; name: string; args: Record<string, unknown> }) => {
    let outcome: ToolOutcome;
    try {
      if (isHostOperation(call.name, operations)) {
        // an operation of the app changes nothing in the document, so the app has nothing to tidy up before it
        outcome = await callHostOperation(options.host, call.name, call.args ?? {}, operations);
      } else {
        // a call the tools refuse outright (an argument outside the schema) must not cancel what the user is doing
        const refused = callProblem(call.name, call.args ?? {});
        if (refused === undefined) options.beforeCall?.(call.name, call.args ?? {});
        outcome = refused === undefined ? callTool(engine, call.name, call.args) : { ok: false, error: refused };
        if (call.name === '_load' && outcome.ok) document += 1;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      // Výjimka může přijít i z posluchače enginu až po zapsání změny, proto ta výhrada. A question
      // (a query, a read, an operation of the app) wrote nothing, and says so instead.
      outcome = { ok: false, error: MUTATING.includes(call.name) ? `v aplikaci nastala chyba (změna už mohla být provedena, ověř stav): ${text}` : `the app failed to answer ${call.name} (nothing was changed): ${text}` };
    }
    try {
      options.onCall?.(call.name, outcome);
    } catch {
      // chyba v obsluze aplikace nesmí nechat volajícího bez odpovědi
    }
    await fetch(`${url}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', [BRIDGE_HEADER]: '1' }, body: JSON.stringify({ id: call.id, session, outcome, document }), signal: abort.signal });
  };

  const listen = async () => {
    const response = await fetch(`${url}/events`, { headers: { Accept: 'text/event-stream', [BRIDGE_HEADER]: '1' }, signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`most odpověděl ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let session = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const lines = buffer.slice(0, end).split('\n');
        buffer = buffer.slice(end + 2);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (event === 'hello') {
          session = (JSON.parse(data) as { session: number }).session;
          report('connected');
        } else if (event === 'call') await serve(session, JSON.parse(data));
        else if (event === 'displaced') {
          // Spojení převzala jiná aplikace. Znovu se nepřipojuje: obě by si ho jinak přebíraly
          // dokola a AI by střídavě měnila dva různé dokumenty.
          stopped = true;
          report('off');
          options.onDisplaced?.();
          return;
        }
      }
    }
  };

  void (async () => {
    while (!stopped) {
      report('connecting');
      try {
        await listen();
      } catch {
        // server neběží nebo spojení spadlo: zkusí se to znovu
      }
      if (stopped) break;
      report('connecting');
      await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 3000));
    }
  })();

  return {
    stop() {
      stopped = true;
      abort.abort();
      report('off');
    },
    documentReplaced() {
      document += 1;
    },
  };
}
