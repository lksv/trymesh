// The arguments of a query, of an export format and of an operation of the app: how they are
// described and the type that follows from a description.
//
// The arguments are named, and each is described: the checks, the input a tool accepts and a form
// in the app come from the description. A value may have structure; the description is still data.
// - `list`: values of one kind, with an optional least and greatest count.
// - `oneOf`: exactly one of the named alternatives, written as an object with that one key:
//   `{ up: [0, 0, 1] }` or `{ onBed: { kind: 'face', ... } }`.
// - `record`: values by key, such as densities by body. The description says what the keys are
//   (IDs of bodies or of features, or free names), so that a mistyped ID is found by the same rule
//   as anywhere else and a form can offer the keys.
// - `fields`: named values of different kinds, for an element of a list or an alternative that is
//   more than one value.
// `of` of a constraint names a required argument of the kind `sketch` next to it: at the top level
// another argument, inside `fields` another of those fields.
// A number is checked against its own description only. The limit of ±1e9 on a number of the
// document (coordinates are float32) is not applied to an argument.
// An alternative of `oneOf` and a field of `fields` may carry a `title` and a `summary` of their
// own, for a form and for the description; without them they are known by their keys.
// A description is written `as const satisfies ArgSpecs`; without `as const` the options of
// a choice and the accepted kinds of an entity widen to `string` and the derived type with them.
import type { NumberSpec } from '../catalog';
import type { AxisRef, EntityRef, Id, PlaneRef, Vec3 } from '../types';

export type ArgKind =
  | { kind: 'number'; spec: NumberSpec } // unit and range as for a numeric field
  | { kind: 'flag' }
  | { kind: 'text' }
  | { kind: 'choice'; options: readonly string[] }
  | { kind: 'body' | 'feature' | 'sketch' } // an ID of that kind
  | { kind: 'constraint'; of: string } // a constraint of the sketch named by the argument `of`
  | { kind: 'entity'; accepts: readonly EntityRef['kind'][] }
  | { kind: 'plane' } // PlaneRef
  | { kind: 'axis' } // AxisRef
  | { kind: 'vector' } // three numbers
  | { kind: 'list'; of: ArgKind; min?: number; max?: number }
  | { kind: 'oneOf'; options: { readonly [name: string]: ArgKind & Described } }
  | { kind: 'record'; keys: 'body' | 'feature' | 'text'; of: ArgKind }
  | { kind: 'fields'; fields: { readonly [name: string]: ArgKind & Described & { optional?: boolean } } };
// What a nested entry may say about itself.
export interface Described {
  title?: string;
  summary?: string;
}
export type ArgSpec = ArgKind & { title: string; summary?: string; optional?: boolean };
export type ArgSpecs = { readonly [name: string]: ArgSpec };

// The type of the arguments follows from their description, so the two cannot disagree. `ValueOf`
// works on an exact description; applied to `ArgKind` itself it does not terminate, so code that
// handles any description (the checker, a generated form) treats values as unknown.
export type ValueOf<K> = K extends { kind: 'number' }
  ? number
  : K extends { kind: 'flag' }
    ? boolean
    : K extends { kind: 'text' }
      ? string
      : K extends { kind: 'choice'; options: readonly (infer O)[] }
        ? O
        : K extends { kind: 'body' | 'feature' | 'sketch' | 'constraint' }
          ? Id
          : K extends { kind: 'entity'; accepts: readonly (infer A)[] }
            ? Extract<EntityRef, { kind: A }>
            : K extends { kind: 'plane' }
              ? PlaneRef
              : K extends { kind: 'axis' }
                ? AxisRef
                : K extends { kind: 'vector' }
                  ? Vec3
                  : K extends { kind: 'list'; of: infer E }
                    ? ValueOf<E>[]
                    : K extends { kind: 'oneOf'; options: infer O }
                      ? { [P in keyof O]: { -readonly [Q in P]: ValueOf<O[P]> } & { [Q in Exclude<keyof O, P>]?: never } }[keyof O]
                      : K extends { kind: 'record'; of: infer E }
                        ? Record<string, ValueOf<E>>
                        : K extends { kind: 'fields'; fields: infer F }
                          ? ArgsOf<F>
                          : never;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];
// What a caller passes: an optional argument may be left out.
export type ArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { -readonly [K in OptionalKeys<S>]?: ValueOf<S[K]> };
// What `run` receives: the engine has filled in the default of every optional number that has one,
// at every depth (in an element of a list, in `fields`, in an alternative).
type DefaultedKeys<S> = { [K in keyof S]: S[K] extends { optional: true; spec: { default: number } } ? K : never }[keyof S];
export type RunValueOf<K> = K extends { kind: 'list'; of: infer E }
  ? RunValueOf<E>[]
  : K extends { kind: 'oneOf'; options: infer O }
    ? { [P in keyof O]: { -readonly [Q in P]: RunValueOf<O[P]> } & { [Q in Exclude<keyof O, P>]?: never } }[keyof O]
    : K extends { kind: 'record'; of: infer E }
      ? Record<string, RunValueOf<E>>
      : K extends { kind: 'fields'; fields: infer F }
        ? RunArgsOf<F>
        : ValueOf<K>;
export type RunArgsOf<S> = { -readonly [K in Exclude<keyof S, OptionalKeys<S>> | DefaultedKeys<S>]: RunValueOf<S[K]> } & { -readonly [K in Exclude<OptionalKeys<S>, DefaultedKeys<S>>]?: RunValueOf<S[K]> };
