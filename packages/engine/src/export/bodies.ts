// The bodies a print export writes, and why it writes none (D48, D54). Moved out of `stl.ts`
// without a change of behaviour; `stl`, `3mf` and the outline of a plane that is not a face use it.
import type { QueryContext } from '../query/spec';
import { printedBodies } from '../sections/body-properties';
import type { BodyPropertiesResult, Id } from '../types';

// The texts of `empty` when a print export has no body.
export const NO_BODY = 'the model has no body to export';
export const NO_PRINTED_BODY = 'the model has no printed body (every body is a reference or auxiliary body); list the bodies to export them anyway';

// The list alone, for whoever has no context (the notes of `exportMesh`, D76).
export const chosenIds = (bodyProperties: Readonly<Record<Id, BodyPropertiesResult>>, bodies: readonly Id[] | undefined): Id[] => (bodies === undefined ? printedBodies(bodyProperties) : [...new Set(bodies)]);

// - With a list: the list, each body once, in its order, whatever the use of a body.
// - Without: `printedBodies` of the body properties.
// - `empty`: `NO_PRINTED_BODY` when there is no list and the model has bodies but none is printed;
//   `NO_BODY` when the list that results is empty for any other reason.
export function chosenBodies(context: QueryContext, bodies: readonly Id[] | undefined): { chosen: Id[]; empty?: string } {
  const chosen = chosenIds(context.state.evaluation.bodyProperties, bodies);
  if (chosen.length > 0) return { chosen };
  return { chosen, empty: bodies === undefined && Object.keys(context.bodies).length > 0 ? NO_PRINTED_BODY : NO_BODY };
}
