// What the tools Trim, Extend and Split share (D65): the batch of the engine's sketch tool run as
// it was made (the switch of construction curves does not apply), and what the status line says
// about the features it changed or that read what it changed.
import type { Id, SketchToolName as EngineToolName, SketchToolInputs } from '@trymesh/engine';
import { sketchTool } from '@trymesh/engine';
import type { SketchContext, SketchHost } from '../sketch-mode';

type CutTool = Extract<EngineToolName, 'trim' | 'extend' | 'split'>;

const named = (host: SketchHost, ids: Id[]): string => ids.map((id) => host.nameOf(id)).join(', ');

// The notes of a batch: what was patched, and the features to look at.
function notes(host: SketchHost, ids: Record<string, Id[]>): string {
  const list = (key: string): Id[] => ids[key] ?? [];
  const out = [list('patched').length === 0 ? 'no feature needed a patch' : `the profile of ${named(host, list('patched'))} followed`];
  if (list('dropped').length > 0) out.push(`a region is gone from ${named(host, list('dropped'))}`);
  if (list('pending').length > 0) out.push(`still crossed, followed by the next cut: ${named(host, list('pending'))}`);
  if (list('moved').length > 0) out.push(`moved with the start of a line: ${named(host, list('moved'))}`);
  if (list('shortened').length > 0) out.push(`reading a changed curve, check: ${named(host, list('shortened'))}`);
  if (list('broken').length > 0) out.push(`naming what is gone: ${named(host, list('broken'))}`);
  if (list('uncut').length > 0) out.push(`touched at one point only, left whole: ${list('uncut').join(', ')}`);
  return out.join('; ');
}

// Runs a cut on the open sketch; a refusal is said with its reason.
export function runCut<K extends CutTool>(host: SketchHost, context: SketchContext, tool: K, input: SketchToolInputs[K], title: string, done: string): void {
  const made = sketchTool(tool, context.tool, input, host.newId);
  if (!made.ok) return host.say(`${title}: ${made.message}`, true);
  if (made.commands.length === 0) return host.say(`${title}: nothing to cut.`);
  host.run({ type: 'batch', commands: made.commands }, `${done}; ${notes(host, made.ids)}.`);
}

// The own curves of the open sketch: what the three tools take.
export const ownCurve = (curve: Id, context: SketchContext): boolean => curve in context.feature.curves;
