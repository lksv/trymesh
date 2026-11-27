// The notes of an export (D76, the point between the stages): a line for people per written body
// that has cosmetic threads, which its mesh does not carry. Every format that writes the mesh of
// a body adds them (`stl`, `3mf`, `urdf`, `mjcf`); the MCP server prints them with the files, and
// the app shows them where it reports an export. A modelled thread is in the mesh and has no note.
import { threadLabel } from '../recompute/thread';
import type { Id, ThreadResult } from '../types';

// The line of one body, or nothing when it has no cosmetic thread: `body "plate": 6 cosmetic
// threads (M6), not in the mesh: tap or cut them after printing`.
export function cosmeticThreadNote(body: Id, threads: readonly ThreadResult[]): string | undefined {
  const cosmetic = threads.filter((thread) => !thread.modelled && thread.bodies.includes(body));
  if (cosmetic.length === 0) return undefined;
  const labels = [...new Set(cosmetic.map(threadLabel))];
  return `body "${body}": ${cosmetic.length} cosmetic thread${cosmetic.length === 1 ? '' : 's'} (${labels.join(', ')}), not in the mesh: tap or cut ${cosmetic.length === 1 ? 'it' : 'them'} after printing`;
}

// The notes of the written bodies, in their order; `threadsOf` answers the threads of a body.
export function cosmeticThreadNotes(bodies: readonly Id[], threadsOf: (body: Id) => readonly ThreadResult[]): string[] {
  return [...new Set(bodies)].flatMap((body) => cosmeticThreadNote(body, threadsOf(body)) ?? []);
}
// `notes` of an `Exported`, only when there are some.
export const notesOf = (notes: string[]): { notes?: string[] } => (notes.length ? { notes } : {});
