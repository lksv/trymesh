// Operations of the app (D37): something only a running app can do, such as a picture of the
// viewport. An operation is not a query: the engine has no renderer, and the operation is
// asynchronous. It is described like a query (`ArgSpecs`) and offered as a tool of its own, named
// by its key here; over a document from a file it answers `notAvailable`. (A tool per operation,
// unlike the queries: one operation is planned. If they multiply they get one general tool.)
//
// A package adds an operation as an entry of `HOST_OPERATIONS` with a line in the map
// `HostOperations`, and what it needs of the app as a member of `AppHost`; both interfaces are
// extended by declaration merging, so the app does not compile until it gives the host the new
// member. The server lists the operation as a tool and sends a call to the app over the bridge;
// the app runs it here, next to `callTool`, which stays synchronous and carries only the engine.
//
// This module has no dependency on Node or on a browser: the server and the app share it.
import { type ArgPath, type ArgSpecs, type ArgsOf, type Engine, type QueryOutcome, type RunArgsOf, checkArgs } from '@trymesh/engine';
import type { Json, ToolAnswer, ToolOutcome } from './tools';
import { viewImage } from './view-image';

// What an operation needs of the app besides the engine. The module of an operation adds its
// member (`view` of view-image.ts).
export interface AppHost {}
// The host as the app hands it over: its capabilities and its engine in one object, which an
// operation gets as it is (not a copy: a host may be an instance of a class).
export type Host = AppHost & { engine: Engine };

export interface HostOperation<S> {
  title: string;
  summary: string; // goes to the description of the tool and to describe_api
  returns: string;
  args: S;
  // Answers like a query: `ok: false` with a code for what the caller can do something about.
  run: (host: Host, args: RunArgsOf<S>) => Promise<QueryOutcome<ToolAnswer>>;
}

// The description of the arguments of every operation, by the name of its tool.
export interface HostOperations {}
export type HostOperationName = keyof HostOperations;
export type HostOperationArgs<N extends HostOperationName> = ArgsOf<HostOperations[N]>;
export type HostCatalog = { [N in HostOperationName]: HostOperation<HostOperations[N]> };
// An entry as code that handles any operation reads it.
export interface AnyHostOperation {
  title: string;
  summary: string;
  returns: string;
  args: ArgSpecs;
  run: (host: Host, args: never) => Promise<QueryOutcome<ToolAnswer>>;
}
export type HostOperationSet = { readonly [name: string]: AnyHostOperation };

// A description in the map that is not a valid `ArgSpecs` stops the type check here.
type InvalidSpecs = { [N in keyof HostOperations]: HostOperations[N] extends ArgSpecs ? never : N }[keyof HostOperations];
export const OPERATIONS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [N in InvalidSpecs]: 'is not a valid description' } = true;

export const HOST_OPERATIONS: HostCatalog = { view_image: viewImage };

const own = (set: HostOperationSet, name: string): boolean => Object.prototype.hasOwnProperty.call(set, name);

// An operation is a tool by its name, and a call is looked up among the operations first. So the
// name must not be one a tool has (`taken`: the tools of the engine with the internal ones, and
// the file tools of the server) and must not look like an internal tool. The server and the bridge
// client refuse to start with a set that breaks this; a test runs it over the registry.
export function hostOperationProblems(operations: HostOperationSet, taken: readonly string[]): string[] {
  return Object.keys(operations).flatMap((name) => [
    ...(taken.includes(name) ? [`the operation "${name}" has the name of a tool`] : []),
    ...(name.startsWith('_') ? [`the operation "${name}" has the name of an internal tool (a leading underscore)`] : []),
    ...(name === '' ? ['an operation has no name'] : []),
  ]);
}
export const isHostOperation = (name: string, operations: HostOperationSet = HOST_OPERATIONS): boolean => own(operations, name);

// What the server answers when no app is connected: the operation has nothing to run in.
export const noAppText = (name: string): string => `notAvailable: ${name}: the operation runs in the app and no app is connected (the tools work with the server's own document). Open the app and turn on the connection with its button AI.`;

const refused = (name: string, error: { code: string; message: string; arg?: ArgPath }): ToolOutcome => ({ ok: false, error: `${error.code}: ${error.message.startsWith(`${name}: `) ? '' : `${name}: `}${error.message}` });

// Runs the operation `name` in the app: checks the arguments against its description in the state
// of the document now (as a query does), runs it and returns its answer as a tool outcome, whose
// result is a `ToolAnswer`. `host` is missing when the app connected its engine without one.
// An exception of the operation is a defect and goes on to the caller.
export async function callHostOperation(host: Host | undefined, name: string, args: unknown, operations: HostOperationSet = HOST_OPERATIONS): Promise<ToolOutcome> {
  if (!own(operations, name)) return { ok: false, error: `there is no operation "${name}"` };
  if (!host) return { ok: false, error: `notAvailable: ${name}: the connected app does not offer operations of the host` };
  const spec = operations[name];
  const { document, evaluation } = host.engine.getState();
  const checked = checkArgs(spec.args, args, { document, evaluation });
  if (!checked.ok) return refused(name, checked);
  const answer = await spec.run(host, checked.value as never);
  if (!answer.ok) return refused(name, answer.error);
  // through JSON, as the result of every tool: it has to cross the bridge unchanged
  return { ok: true, result: JSON.parse(JSON.stringify(answer.result)) as Json };
}
