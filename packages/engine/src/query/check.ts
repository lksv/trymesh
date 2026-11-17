// Checks the arguments of a query (or the options of an export format) against their description
// before `run`, and fills in the defaults. `run` then gets values of the type its description
// derives, and does not check them again.
//
// Two kinds of problem, both with the path of the argument:
// - `invalidArguments`: the shape or the range is wrong, or there is no such argument.
// - `notAvailable`: something named is not in the state asked about. One rule for every ID wherever
//   it sits: a body, a face, an edge is looked up in the bodies of the state; a feature, a sketch,
//   a constraint, a sketch point among the features the state evaluated. A sketch that did not
//   evaluate (it is in error) is among them, so it is a valid argument.
import { checkNumber } from '../catalog';
import { entityOf } from '../sketch-content';
import type { ArgPath, Document, Evaluation, Feature, Id, SketchFeature } from '../types';
import { edgeKey, faceKey, has } from '../util';
import { CommandError, type RefContext, axisRef, edgeName, faceName, isObject, planeRef } from '../validation';
import type { ArgKind, ArgSpecs } from './args';

// The state the arguments are checked against.
export interface CheckScope {
  document: Document;
  evaluation: Evaluation;
}
export type Checked = { ok: true; value: Record<string, unknown> } | { ok: false; code: 'invalidArguments' | 'notAvailable'; message: string; arg: ArgPath };

// `orientations[1].by.onBed`
export const argText = (path: ArgPath): string => path.map((part, i) => (typeof part === 'number' ? `[${part}]` : i === 0 ? part : `.${part}`)).join('');

class Problem extends Error {
  constructor(
    readonly code: 'invalidArguments' | 'notAvailable',
    readonly arg: ArgPath,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (path: ArgPath, text: string): never => {
  throw new Problem('invalidArguments', path, `${argText(path)}: ${text}`);
};
const missing = (path: ArgPath, text: string): never => {
  throw new Problem('notAvailable', path, `${argText(path)}: ${text}`);
};

// The shape of a reference is checked by the validators of the document; where the thing is, by the
// state. So the context of those validators checks nothing.
const SHAPE_ONLY = (document: Document): RefContext => ({ doc: document, before: undefined, requireRef: () => undefined });
function shaped<T>(path: ArgPath, read: (what: string) => T): T {
  try {
    return read(argText(path));
  } catch (error) {
    // the message of a validator starts with the place it was given, which is the path of the argument
    if (error instanceof CommandError) throw new Problem('invalidArguments', path, error.message);
    throw error;
  }
}

class Checker {
  constructor(private readonly scope: CheckScope) {}

  private feature(id: Id): Feature | undefined {
    return has(this.scope.evaluation.features, id) ? this.scope.document.features.find((feature) => feature.id === id) : undefined;
  }

  private id(value: unknown, path: ArgPath, what: string): Id {
    return typeof value === 'string' ? value : invalid(path, `the ID of a ${what} is expected`);
  }

  private body(value: unknown, path: ArgPath): Id {
    const id = this.id(value, path, 'body');
    return has(this.scope.evaluation.bodies, id) ? id : missing(path, `the body "${id}" is not in the state asked about`);
  }

  private sketch(value: unknown, path: ArgPath): SketchFeature {
    const id = this.id(value, path, 'sketch');
    const feature = this.feature(id);
    return feature?.type === 'sketch' ? feature : missing(path, `the sketch "${id}" is not in the state asked about`);
  }

  private face(body: Id, value: unknown, path: ArgPath): unknown {
    const name = shaped(path, (what) => faceName(value, what));
    const key = faceKey(name);
    const { faceNames, bodies } = this.scope.evaluation;
    return bodies[body].faces.some((face) => faceKey(faceNames[face.id]) === key) ? name : missing(path, `the body "${body}" has no face ${key}`);
  }

  private edge(body: Id, value: unknown, path: ArgPath): unknown {
    const name = shaped(path, (what) => edgeName(value, what));
    const key = edgeKey(name);
    return this.scope.evaluation.bodies[body].edges.some((edge) => edgeKey(edge.name) === key) ? name : missing(path, `the body "${body}" has no edge ${key}`);
  }

  private sketchPoint(sketch: SketchFeature, value: unknown, path: ArgPath): Id {
    const point = this.id(value, path, 'sketch point');
    return entityOf(sketch, point)?.kind === 'point' ? point : missing(path, `the sketch "${sketch.id}" has no point "${point}"`);
  }

  private sketchLine(sketch: SketchFeature, value: unknown, path: ArgPath): Id {
    const line = this.id(value, path, 'sketch line');
    return entityOf(sketch, line)?.kind === 'line' ? line : missing(path, `the sketch "${sketch.id}" has no line "${line}"`);
  }

  // A record of named values: the top level of the arguments and the kind `fields`.
  fields(specs: { readonly [name: string]: ArgKind & { optional?: boolean } }, value: unknown, path: ArgPath): Record<string, unknown> {
    if (!isObject(value)) return invalid(path.length ? path : ['arguments'], 'an object with the named arguments is expected');
    for (const name of Object.keys(value)) if (!has(specs, name) && value[name] !== undefined) invalid([...path, name], 'there is no such argument');
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(specs)) {
      const given = has(value, name) ? value[name] : undefined;
      if (given === undefined) {
        if (!spec.optional) invalid([...path, name], 'the argument is required');
        if (spec.kind === 'number' && spec.spec.default !== undefined) out[name] = spec.spec.default;
        continue;
      }
      out[name] = this.value(spec, given, [...path, name], value, path);
    }
    return out;
  }

  // `siblings`: the named values of the record this one is in (at `within`), for `of` of
  // a constraint. A list, a record by key and an alternative keep the record they are in.
  private value(spec: ArgKind, value: unknown, path: ArgPath, siblings: Record<string, unknown>, within: ArgPath): unknown {
    switch (spec.kind) {
      case 'number': {
        if (typeof value !== 'number') return invalid(path, 'a number is expected');
        const checked = checkNumber(value, spec.spec, Infinity);
        return checked.ok ? checked.value : invalid(path, checked.message);
      }
      case 'flag':
        return typeof value === 'boolean' ? value : invalid(path, 'true or false is expected');
      case 'text':
        return typeof value === 'string' ? value : invalid(path, 'a text is expected');
      case 'choice':
        return typeof value === 'string' && spec.options.includes(value) ? value : invalid(path, `one of ${spec.options.join(', ')} is expected`);
      case 'body':
        return this.body(value, path);
      case 'feature': {
        const id = this.id(value, path, 'feature');
        return this.feature(id) ? id : missing(path, `the feature "${id}" is not in the state asked about`);
      }
      case 'sketch':
        return this.sketch(value, path).id;
      case 'constraint': {
        const id = this.id(value, path, 'constraint');
        // the sketch next to it was checked first only if it is listed first; check it here as well
        if (siblings[spec.of] === undefined) return invalid([...within, spec.of], 'the argument is required');
        const sketch = this.sketch(siblings[spec.of], [...within, spec.of]);
        return has(sketch.constraints, id) ? id : missing(path, `the sketch "${sketch.id}" has no constraint "${id}"`);
      }
      case 'entity': {
        if (!isObject(value) || typeof value.kind !== 'string' || !(spec.accepts as readonly string[]).includes(value.kind)) return invalid(path, `an entity of the kind ${spec.accepts.join(' or ')} is expected, as { kind, ... }`);
        if (value.kind === 'sketchPoint') {
          const sketch = this.sketch(value.sketch, [...path, 'sketch']);
          return { kind: 'sketchPoint', sketch: sketch.id, point: this.sketchPoint(sketch, value.point, [...path, 'point']) };
        }
        const body = this.body(value.body, [...path, 'body']);
        if (value.kind === 'body') return { kind: 'body', body };
        return value.kind === 'face' ? { kind: 'face', body, face: this.face(body, value.face, [...path, 'face']) } : { kind: 'edge', body, edge: this.edge(body, value.edge, [...path, 'edge']) };
      }
      case 'plane': {
        const ref = shaped(path, (what) => planeRef(SHAPE_ONLY(this.scope.document), value, what));
        if (ref.kind === 'plane' && this.feature(ref.feature)?.type !== 'plane') return missing([...path, 'feature'], `the plane "${ref.feature}" is not in the state asked about`);
        if (ref.kind === 'face') return { kind: 'face', body: this.body(ref.body, [...path, 'body']), face: this.face(ref.body, ref.face, [...path, 'face']) };
        return ref;
      }
      case 'axis': {
        const ref = shaped(path, (what) => axisRef(SHAPE_ONLY(this.scope.document), value, what));
        if (ref.kind === 'sketchPoint') this.sketchPoint(this.sketch(ref.sketch, [...path, 'sketch']), ref.point, [...path, 'point']);
        if (ref.kind === 'sketchLine') this.sketchLine(this.sketch(ref.sketch, [...path, 'sketch']), ref.line, [...path, 'line']);
        // the axis of a round face: a face of the body in the state asked about (D60); whether it is round is the recompute's to say
        if (ref.kind === 'face') return { kind: 'face', body: this.body(ref.body, [...path, 'body']), face: this.face(ref.body, ref.face, [...path, 'face']) };
        return ref;
      }
      case 'vector':
        // `Array.from` visits the holes of a sparse array, which `every` and `map` skip
        return Array.isArray(value) && value.length === 3 && Array.from(value).every((item) => typeof item === 'number' && Number.isFinite(item)) ? Array.from(value, (item: number) => item + 0) : invalid(path, 'three finite numbers are expected');
      case 'list': {
        if (!Array.isArray(value)) return invalid(path, 'a list is expected');
        if (spec.min !== undefined && value.length < spec.min) return invalid(path, `at least ${spec.min} ${spec.min === 1 ? 'item is' : 'items are'} expected`);
        if (spec.max !== undefined && value.length > spec.max) return invalid(path, `at most ${spec.max} ${spec.max === 1 ? 'item is' : 'items are'} expected`);
        return Array.from(value, (item, i) => this.value(spec.of, item, [...path, i], siblings, within));
      }
      case 'oneOf': {
        const names = Object.keys(spec.options);
        const given = isObject(value) ? Object.keys(value).filter((name) => value[name] !== undefined) : [];
        if (!isObject(value) || given.length !== 1 || !has(spec.options, given[0])) return invalid(path, `an object with exactly one of ${names.join(', ')} is expected`);
        return { [given[0]]: this.value(spec.options[given[0]], value[given[0]], [...path, given[0]], siblings, within) };
      }
      case 'record': {
        if (!isObject(value)) return invalid(path, 'an object with a value per key is expected');
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
          if (key in Object.prototype) invalid([...path, key], 'the key is not allowed');
          if (spec.keys === 'body') this.body(key, [...path, key]);
          if (spec.keys === 'feature' && !this.feature(key)) missing([...path, key], `the feature "${key}" is not in the state asked about`);
          out[key] = this.value(spec.of, item, [...path, key], siblings, within);
        }
        return out;
      }
      case 'fields':
        return this.fields(spec.fields, value, path);
      default: {
        const unknown: never = spec;
        throw new Error(`a description of an argument of an unknown kind: ${JSON.stringify(unknown)}`);
      }
    }
  }
}

// Checks `args` against `specs` in the given state. The value returned is what `run` gets: every
// argument in its canonical form, the defaults of optional numbers filled in at every depth.
export function checkArgs(specs: ArgSpecs, args: unknown, scope: CheckScope): Checked {
  try {
    return { ok: true, value: new Checker(scope).fields(specs, args ?? {}, []) };
  } catch (error) {
    if (error instanceof Problem) return { ok: false, code: error.code, message: error.message, arg: error.arg };
    throw error;
  }
}

// What the types let through and a description must still obey; a guard test runs it over every
// catalog. `of` of a constraint names a required argument of the kind `sketch` next to it.
export function specProblems(specs: { readonly [name: string]: ArgKind & { optional?: boolean } }, path: ArgPath = []): string[] {
  const inside = (spec: ArgKind, at: ArgPath, siblings: { readonly [name: string]: ArgKind & { optional?: boolean } }): string[] => {
    if (spec.kind === 'constraint') {
      const of = has(siblings, spec.of) ? siblings[spec.of] : undefined;
      return of && of.kind === 'sketch' && !of.optional ? [] : [`${argText(at)}: \`of\` must name a required argument of the kind sketch next to it, not "${spec.of}"`];
    }
    if (spec.kind === 'list' || spec.kind === 'record') return inside(spec.of, at, siblings);
    if (spec.kind === 'oneOf') return Object.entries(spec.options).flatMap(([name, option]) => inside(option, [...at, name], siblings));
    if (spec.kind === 'fields') return specProblems(spec.fields, at);
    return [];
  };
  return Object.entries(specs).flatMap(([name, spec]) => inside(spec, [...path, name], specs));
}
