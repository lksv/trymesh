// Operations of the app (D37): something only a running app can do, such as a picture of the
// viewport. An operation is not a query: the engine has no renderer, and the operation is
// asynchronous. It is described like a query (`ArgSpecs`) and offered as a tool of its own, named
// by its key here; over a document from a file it answers `notAvailable`. (A tool per operation,
// unlike the queries: two operations exist. If they multiply they get one general tool.)
//
// A package adds an operation as an entry of `HOST_OPERATIONS` with a line in the map
// `HostOperations`, and what it needs of the app as a member of `AppHost`; both interfaces are
// extended by declaration merging, so the app does not compile until it gives the host the new
// member. The server lists the operation as a tool and sends a call to the app over the bridge;
// the app runs it here, next to `callTool`, which stays synchronous and carries only the engine.
//
// This module has no dependency on Node or on a browser: the server and the app share it.
import { type ArgPath, type ArgSpecs, type ArgsOf, type Command, type Engine, type EngineState, type QueryOutcome, type RunArgsOf, checkArgs } from '@trymesh/engine';
import type { Json, ToolAnswer, ToolOutcome } from './tools';
import { getSelection } from './get-selection';
import { viewImage } from './view-image';

// What an operation needs of the app besides the engine. The module of an operation adds its
// member (`view` of view-image.ts, `selection` of get-selection.ts).
export interface AppHost {}
// The host as the app hands it over: its capabilities and its engine in one object, which an
// operation gets as it is (not a copy: a host may be an instance of a class).
export type Host = AppHost & { engine: Engine };

export interface HostOperation<S> {
  title: string;
  summary: string; // goes to the description of the tool and to describe_api
  returns: string;
  args: S;
  // The operation answers about the app as it is now (D74: the selection exists only there): it
  // takes no state path, so `at` and `after` are not in its schema and a call with either is
  // refused; it runs on the present state of the engine.
  presentOnly?: true;
  // Answers like a query: `ok: false` with a code for what the caller can do something about.
  // `state` is the state the call asks about (`at` and `after` on the path, 5b): the arguments were
  // checked in it, and the operation works on it. `path`: `at` and `after` as the caller gave them,
  // for a text that offers a command with them.
  run: (host: Host, args: RunArgsOf<S>, state: EngineState, path: OperationPath) => Promise<QueryOutcome<ToolAnswer>>;
}

// The state an operation works on (5b, D59): every operation takes `at` and `after` on its path, as
// the tool `query` does beside its `args`; they are not arguments of its description. The server
// lists them in the input schema of every operation and describe_api with its arguments; not for
// an operation that is `presentOnly` (D74), which takes neither.
export const OPERATION_STATE_ARGS = {
  at: 'a feature ID. The model as it was after this feature.',
  after: 'a command (as for execute) to preview first; the operation works on the result and the document does not change (a pose: `{ type: "setPose", values: { … } }`). With `at` too, the document after the command up to `at`.',
} as const;

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
  presentOnly?: true;
  run: (host: Host, args: never, state: EngineState, path: OperationPath) => Promise<QueryOutcome<ToolAnswer>>;
}
export interface OperationPath {
  at?: string;
  after?: unknown;
}
export type HostOperationSet = { readonly [name: string]: AnyHostOperation };

// A description in the map that is not a valid `ArgSpecs` stops the type check here.
type InvalidSpecs = { [N in keyof HostOperations]: HostOperations[N] extends ArgSpecs ? never : N }[keyof HostOperations];
export const OPERATIONS_ARE_VALID: [InvalidSpecs] extends [never] ? true : { [N in InvalidSpecs]: 'is not a valid description' } = true;

export const HOST_OPERATIONS: HostCatalog = { view_image: viewImage, get_selection: getSelection };

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
    ...Object.keys(OPERATION_STATE_ARGS).flatMap((arg) => (Object.prototype.hasOwnProperty.call(operations[name].args, arg) ? [`the operation "${name}" has an argument "${arg}", which the path of every operation takes`] : [])),
  ]);
}
export const isHostOperation = (name: string, operations: HostOperationSet = HOST_OPERATIONS): boolean => own(operations, name);

// What the server answers when no app is connected: the operation has nothing to run in.
export const noAppText = (name: string): string => `notAvailable: ${name}: the operation runs in the app and no app is connected (the tools work with the server's own document). Open the app and turn on the connection with its button AI.`;

const refused = (name: string, error: { code: string; message: string; arg?: ArgPath }): ToolOutcome => ({ ok: false, error: `${error.code}: ${error.message.startsWith(`${name}: `) ? '' : `${name}: `}${error.message}` });

// Runs the operation `name` in the app: asks the state of `at` and `after` (as the tool `query`
// does: with `after` the command is previewed where the engine is and the preview answers for `at`
// too; without it the state after `at`), checks the other arguments against the description in
// that state, runs the operation on it and returns its answer as a tool outcome, whose result is
// a `ToolAnswer`. An operation that is `presentOnly` refuses `at` and `after` (`null` counts as
// not given, as for every argument) and runs on the present state. Nothing is written. `host` is missing when the app connected its engine without
// one. An exception of the operation is a defect and goes on to the caller.
export async function callHostOperation(host: Host | undefined, name: string, args: unknown, operations: HostOperationSet = HOST_OPERATIONS): Promise<ToolOutcome> {
  if (!own(operations, name)) return { ok: false, error: `there is no operation "${name}"` };
  if (!host) return { ok: false, error: `notAvailable: ${name}: the connected app does not offer operations of the host` };
  const spec = operations[name];
  const given = args !== null && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
  const { at: rawAt, after, ...rest } = given ?? {};
  const at = rawAt === null ? undefined : rawAt;
  if (spec.presentOnly) {
    const named = at !== undefined ? 'at' : after !== undefined && after !== null ? 'after' : undefined;
    if (named) return refused(name, { code: 'invalidArguments', message: `${named}: the operation answers about the app as it is now, so it takes no at and no after` });
  }
  if (at !== undefined && typeof at !== 'string') return refused(name, { code: 'invalidArguments', message: 'at: a feature ID is expected' });
  let state: EngineState;
  if (after !== undefined && after !== null) {
    if (typeof after !== 'object' || Array.isArray(after)) return refused(name, { code: 'invalidArguments', message: 'after: a command is expected' });
    const previewed = host.engine.preview(after as Command, at);
    if (!previewed.ok) return { ok: false, error: `after: ${previewed.error.code}: ${previewed.error.message}` };
    state = previewed.state;
  } else {
    if (at !== undefined && !host.engine.getState().document.features.some((feature) => feature.id === at)) return refused(name, { code: 'notAvailable', message: `at: the feature "${at}" is not in the document` });
    state = host.engine.getState(at);
  }
  const checked = checkArgs(spec.args, given ? rest : args, { document: state.document, evaluation: state.evaluation });
  if (!checked.ok) return refused(name, checked);
  const answer = await spec.run(host, checked.value as never, state, { ...(at === undefined ? {} : { at }), ...(after === undefined || after === null ? {} : { after }) });
  if (!answer.ok) return refused(name, answer.error);
  // through JSON, as the result of every tool: it has to cross the bridge unchanged
  return { ok: true, result: JSON.parse(JSON.stringify(answer.result)) as Json };
}
