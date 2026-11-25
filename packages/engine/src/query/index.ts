// The catalog of queries, built like the registry of feature types: a query is a module in this
// directory and one line here. `Engine.query` and the MCP tool `query` reach every entry; the
// description for the AI and a form in the app read the catalog.
import type { ArgPath, Evaluation, QueryOutcome } from '../types';
import { has } from '../util';
import { checkArgs } from './check';
import { body } from './body';
import { catalog } from './catalog';
import { type ContextDeps, type Internals, queryContext } from './context';
import { gap } from './gap';
import { hardwareHole } from './hardware-hole';
import { interference } from './interference';
import { mass } from './mass';
import { mechanism } from './mechanism';
import { partsList } from './parts-list';
import { measure } from './measure';
import { print } from './print';
import { section } from './section';
import { constraintExplanation, sketchContacts, sketchDiagnosis } from './sketch';
import { entryCurves } from './entry-curves';
import { sketchRegions } from './sketch-regions';
import { sketchSources } from './sketch-sources';
import { type AnyQuery, type QueryCatalog, QueryFailure } from './spec';

export const QUERIES: QueryCatalog = { interference, sketchDiagnosis, constraintExplanation, sketchContacts, sketchSources, body, catalog, measure, section, gap, mass, print, hardwareHole, mechanism, partsList, entryCurves, sketchRegions };

const refused = (code: 'invalidArguments' | 'notAvailable' | 'failed', message: string, arg?: ArgPath): QueryOutcome<never> => ({ ok: false, error: { code, message, ...(arg ? { arg } : {}) } });

// Asks the query `name` about one state: checks the arguments against the description of the
// query, fills in the defaults and runs it. `name` and `args` come from callers that are not typed
// (a tool, the bridge), so both are checked here.
// `geometry: 'modelled'`: the caller asks about the model as modelled; an entry may say so itself.
export function runQuery(name: string, args: unknown, evaluation: Evaluation, internals: Internals, deps: ContextDeps, geometry?: 'modelled'): QueryOutcome<unknown> {
  if (typeof name !== 'string' || !has(QUERIES, name)) return refused('invalidArguments', `there is no query ${typeof name === 'string' ? `"${name}"` : 'of that name (a text is expected)'}; the queries are ${Object.keys(QUERIES).join(', ')}`, ['query']);
  const spec = (QUERIES as Record<string, AnyQuery>)[name];
  const checked = checkArgs(spec.args, args, { document: internals.document, evaluation });
  if (!checked.ok) return refused(checked.code, `${name}: ${checked.message}`, checked.arg);
  try {
    // the checker has made the values what the description derives; that is the one cast
    return { ok: true, result: spec.run(queryContext(name, evaluation, internals, deps, spec.geometry ? 'modelled' : geometry), checked.value as never) };
  } catch (error) {
    if (error instanceof QueryFailure) return refused(error.code, `${name}: ${error.message}`, error.arg);
    throw error;
  }
}
