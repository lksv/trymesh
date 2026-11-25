// An engine with the real adapters and an MCP client linked to the server in memory.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPakoDeflater } from '@trymesh/deflate-pako';
import { type Engine, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import type { Bridge } from '../src/bridge';
import type { HostOperationSet } from '../src/host';
import { type TrymeshServerOptions, createTrymeshServer } from '../src/server';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel(), deflater: createPakoDeflater() };
export const newEngine = (): Engine => createEngine(deps);

export interface Session {
  engine: Engine;
  client: Client;
  // Calls a tool and returns its result; an error of the tool is returned as { error }.
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  text(name: string, args?: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function connect(options: { engine?: Engine; bridge?: Bridge; file?: string; operations?: HostOperationSet } & Pick<TrymeshServerOptions, 'bridgeFailure' | 'reopenBridge'> = {}): Promise<Session> {
  const engine = options.engine ?? newEngine();
  const server = createTrymeshServer({ engine, bridge: options.bridge, file: options.file, operations: options.operations, bridgeFailure: options.bridgeFailure, reopenBridge: options.reopenBridge });
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const raw = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { text: result.content[0].text, isError: result.isError === true };
  };
  return {
    engine,
    client,
    async call(name, args) {
      const result = await raw(name, args);
      if (result.isError) return { error: result.text };
      try {
        return JSON.parse(result.text);
      } catch {
        return result.text;
      }
    },
    async text(name, args) {
      return (await raw(name, args)).text;
    },
    async close() {
      await Promise.all([client.close(), server.close()]);
    },
  };
}
