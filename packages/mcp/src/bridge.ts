// The bridge between the MCP server and the running app. The server listens on a local address; the app
// connects to it, reads requests as an event stream (SSE) and sends the answers back by POST. The tools
// thus run over the app's engine and the user sees the changes at once.
import { type IncomingMessage, type Server as HttpServer, type ServerResponse, createServer } from 'node:http';
import type { ToolOutcome } from './tools';

export const DEFAULT_BRIDGE_PORT = 4517;
const CALL_TIMEOUT_MS = 30_000;
const KEEPALIVE_MS = 15_000;

// The header every request of the app must have. A page of another origin cannot send it without the
// server's consent (preflight), and elements such as <img> do not send it at all.
export const BRIDGE_HEADER = 'x-trymesh-bridge';

export interface Bridge {
  port: number;
  connected(): boolean;
  session(): number | undefined; // number of the app's connection; it changes with a new connection
  // The sequence number of the document in the connected app, as it reported it in its last answer. It grows
  // whenever the app replaces the document with another one (New, Open, loading from the AI).
  document(): number | undefined;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  close(): Promise<void>;
}

// Only a page from this computer may connect (or a client without the Origin header, so not a browser). The
// origin alone is not enough: a foreign page sends a request without the Origin header too (an image, the
// same origin after DNS rebinding). So the target address in the Host header and an own header are checked
// as well.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
function localHost(host: string | undefined, port: number): boolean {
  return host !== undefined && LOCAL_HOSTS.some((name) => host === `${name}:${port}`);
}
function allowedOrigin(origin: string | undefined): string | undefined | false {
  if (origin === undefined) return undefined;
  try {
    const { hostname } = new URL(origin);
    return LOCAL_HOSTS.includes(hostname) ? origin : false;
  } catch {
    return false;
  }
}

// port 0 = the system assigns a free port. When the port cannot be opened (another server runs), the
// promise is rejected.
export function startBridge(port: number = DEFAULT_BRIDGE_PORT): Promise<Bridge> {
  let client: { response: ServerResponse; session: number; document: number } | undefined;
  let sessions = 0;
  let calls = 0;
  const pending = new Map<number, { resolve: (outcome: ToolOutcome) => void; timer: ReturnType<typeof setTimeout>; session: number }>();
  const settle = (id: number, outcome: ToolOutcome) => {
    const call = pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(id);
    call.resolve(outcome);
  };
  const drop = (session: number, reason: string) => {
    for (const [id, call] of pending) if (call.session === session) settle(id, { ok: false, error: reason });
  };

  let listening = port;
  const handle = (request: IncomingMessage, response: ServerResponse) => {
    const origin = allowedOrigin(request.headers.origin);
    if (origin === false || !localHost(request.headers.host, listening)) {
      response.writeHead(403).end('origin not allowed');
      return;
    }
    const cors = origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    const path = (request.url ?? '').split('?')[0];
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': `Content-Type, ${BRIDGE_HEADER}`, 'Access-Control-Max-Age': '600' }).end();
    } else if (path !== '/status' && request.headers[BRIDGE_HEADER] === undefined) {
      response.writeHead(403, cors).end('missing bridge header');
    } else if (request.method === 'GET' && path === '/events') {
      // The last connected app holds; the previous connection is closed.
      const previous = client;
      const session = ++sessions;
      response.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      response.write(`event: hello\ndata: ${JSON.stringify({ session })}\n\n`);
      client = { response, session, document: 0 };
      if (previous) {
        // The displaced app is told why, so that it does not reconnect: two apps would otherwise take
        // the connection from each other over and over and a command could end in the wrong document.
        drop(previous.session, 'another app connected');
        previous.response.end('event: displaced\ndata: {}\n\n');
      }
      const keepalive = setInterval(() => response.write(': keepalive\n\n'), KEEPALIVE_MS);
      response.on('close', () => {
        clearInterval(keepalive);
        if (client?.session === session) client = undefined;
        drop(session, 'the app disconnected');
      });
    } else if (request.method === 'POST' && path === '/reply') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => {
        try {
          const reply = JSON.parse(body) as { id: number; session: number; outcome: ToolOutcome; document?: number };
          if (pending.get(reply.id)?.session === reply.session && typeof reply.outcome?.ok === 'boolean') {
            if (client?.session === reply.session && typeof reply.document === 'number') client.document = reply.document;
            settle(reply.id, reply.outcome);
          }
          response.writeHead(204, cors).end();
        } catch {
          response.writeHead(400, cors).end('bad reply');
        }
      });
    } else if (request.method === 'GET' && path === '/status') {
      response.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ service: 'trymesh-mcp-bridge', connected: client !== undefined }));
    } else response.writeHead(404, cors).end();
  };

  return new Promise((resolve, reject) => {
    const server: HttpServer = createServer(handle);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      listening = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: listening,
        connected: () => client !== undefined,
        session: () => client?.session,
        document: () => client?.document,
        call(name, args) {
          const target = client;
          if (!target) return Promise.resolve({ ok: false, error: 'the app is not connected' });
          const id = ++calls;
          return new Promise<ToolOutcome>((done) => {
            const timer = setTimeout(() => settle(id, { ok: false, error: 'the app did not answer in time' }), CALL_TIMEOUT_MS);
            pending.set(id, { resolve: done, timer, session: target.session });
            target.response.write(`event: call\ndata: ${JSON.stringify({ id, name, args })}\n\n`);
          });
        },
        close() {
          for (const id of [...pending.keys()]) settle(id, { ok: false, error: 'the bridge is closing' });
          client?.response.end();
          client = undefined;
          return new Promise<void>((closed) => {
            server.close(() => closed());
            server.closeAllConnections();
          });
        },
      });
    });
  });
}
