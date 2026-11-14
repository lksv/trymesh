// Engine se skutečnými adaptéry a klient MCP propojený se serverem v paměti.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Engine, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import type { Bridge } from '../src/bridge';
import { createTrymeshServer } from '../src/server';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() };
export const newEngine = (): Engine => createEngine(deps);

export interface Session {
  engine: Engine;
  client: Client;
  // Zavolá nástroj a vrátí jeho výsledek; chybu nástroje vrátí jako { error }.
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  text(name: string, args?: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export async function connect(options: { engine?: Engine; bridge?: Bridge; file?: string } = {}): Promise<Session> {
  const engine = options.engine ?? newEngine();
  const server = createTrymeshServer({ engine, bridge: options.bridge, file: options.file });
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
