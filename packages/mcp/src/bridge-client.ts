// The app's side: connects the engine to the bridge of the MCP server and serves its requests. Runs in the
// browser and in Node (tests), so it reads the event stream through fetch and not through EventSource.
import type { Engine } from '@trymesh/engine';
import { HOST_OPERATIONS, type Host, type HostOperationSet, callHostOperation, hostOperationProblems, isHostOperation } from './host';
import { MUTATING, type ToolOutcome, callProblem, callTool, tools } from './tools';

export { MUTATING, changesDocument, outlineSaid } from './tools';

// The same header as on the server's side (bridge.ts); separate here so that code for Node is not pulled
// into the browser.
const BRIDGE_HEADER = 'x-trymesh-bridge';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4517';
export type BridgeStatus = 'connecting' | 'connected' | 'off';

export interface BridgeConnection {
  stop(): void;
  // The app replaced the document with another one (New, Open). The server tells from it that the file
  // the previous document was saved to does not belong to the new one.
  documentReplaced(): void;
}

export interface BridgeClientOptions {
  url?: string;
  retryMs?: number; // delay between attempts to connect
  onStatus?: (status: BridgeStatus) => void;
  onDisplaced?: () => void; // another app connected to the server; this one does not reconnect by itself any more
  beforeCall?: (name: string, args: Record<string, unknown>) => void; // before a tool runs: the app can clean up a state in progress
  onCall?: (name: string, outcome: ToolOutcome, args: Record<string, unknown>) => void; // after every request served (with the arguments of the call)
  // What the operations of the app need of it, with the engine that is connected (host.ts). It is
  // handed to an operation as it is. Without it an operation answers `notAvailable`.
  host?: Host;
  operations?: HostOperationSet; // the operations served; the registry by default (tests give their own)
}

export function connectBridge(engine: Engine, options: BridgeClientOptions = {}): BridgeConnection {
  const url = (options.url ?? DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const abort = new AbortController();
  let stopped = false;
  let document = 0; // sequence number of the document; the server gets it with every answer
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
      // An exception can come from a listener of the engine too, after the change was written, hence that
      // caveat. A question (a query, a read, an operation of the app) wrote nothing, and says so instead.
      outcome = { ok: false, error: MUTATING.includes(call.name) ? `an error occurred in the app (the change may already have been made, check the state): ${text}` : `the app failed to answer ${call.name} (nothing was changed): ${text}` };
    }
    try {
      options.onCall?.(call.name, outcome, call.args ?? {});
    } catch {
      // an error in the app's handling must not leave the caller without an answer
    }
    await fetch(`${url}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json', [BRIDGE_HEADER]: '1' }, body: JSON.stringify({ id: call.id, session, outcome, document }), signal: abort.signal });
  };

  const listen = async () => {
    const response = await fetch(`${url}/events`, { headers: { Accept: 'text/event-stream', [BRIDGE_HEADER]: '1' }, signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`the bridge answered ${response.status}`);
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
          // Another app took over the connection. It does not reconnect: otherwise the two would take it
          // from each other over and over and the AI would change two different documents in turn.
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
        // the server is not running or the connection dropped: it is tried again
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
