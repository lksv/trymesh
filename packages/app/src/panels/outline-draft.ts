// The import of an outline in the panel of a sketch (D72): the button *Import an outline…*, and the
// draft that shows the file as `importOutline` read it (the report), lets the layers, the unit and
// the weld be changed (the bytes are read again), and places it (`addExternal`) or replaces the file
// of an entry (`updateExternal`, with the constraints that hold an entity that would go removed in
// the same batch when the checkbox says so). The app only composes the command.
import { type Command, type Id, OUTLINE_FORMATS, type OutlineFormat, type OutlineOutcome, type OutlineRevision, type SketchFeature, type SketchOutline, constraintOperands, curveCounts, documentIds, fileStemOf, importAccept, importOutline, outlineFormatOf, outlineRevision } from '@trymesh/engine';
import { h } from '../dom';
import { valueText } from '../fields';
import type { SketchHost, SketchMode } from '../sketch-mode';

// - `options`: as the import takes them; `layers` absent reads every layer.
// - `replace`: the entry whose file is replaced; `remove`: remove the constraints that hold an entity
//   that would go, with the replacement.
// - `stored`: for a replacement, whether the options are those the entry stores (false: the entry does
//   not store them, or they are of another format).
export interface OutlineDraft {
  file: string;
  bytes: Uint8Array;
  format: OutlineFormat;
  options: { layers?: string[]; unit?: string; weld?: number };
  anchor: SketchOutline['anchor'];
  regions: boolean;
  replace?: Id;
  remove: boolean;
  stored?: boolean;
  outcome: OutlineOutcome;
}

const read = (draft: OutlineDraft): OutlineOutcome => importOutline(draft.format, draft.bytes, draft.options as never);

// A file chosen for a new outline or for an entry; a format the app does not read is said.
export async function openOutline(host: SketchHost, m: SketchMode, file: File, replace?: Id): Promise<void> {
  const format = outlineFormatOf(file.name);
  if (format === undefined) return host.say(`${file.name}: an outline is read from ${Object.values(OUTLINE_FORMATS).map((spec) => `.${spec.extensions.join(', .')}`).join(', ')} files.`, true);
  const feature = host.doc.features.find((f) => f.id === m.id) as SketchFeature | undefined;
  const entry = replace !== undefined ? (feature?.external[replace] as SketchOutline | undefined) : undefined;
  const storedWith = entry?.readWith;
  const stored = storedWith?.format === format;
  const options = stored ? (({ format: _, ...rest }) => rest)(storedWith) : {};
  const draft: OutlineDraft = { file: file.name, bytes: new Uint8Array(await file.arrayBuffer()), format, options, anchor: entry?.anchor ?? 'origin', regions: entry?.regions ?? true, remove: false, ...(replace !== undefined ? { replace, stored } : {}), outcome: { ok: false, error: { code: 'empty', message: '' } } };
  draft.outcome = read(draft);
  m.outline = draft;
  host.renderPanel();
}

// The hidden input and the button that opens it; `replace` for the button of a row.
export function outlineFileButton(host: SketchHost, m: SketchMode, label: string, title: string, replace?: Id): HTMLElement[] {
  const input = h('input', { type: 'file', accept: importAccept(OUTLINE_FORMATS as never), hidden: true, id: replace === undefined ? 'outline-file' : `outline-file-${replace}` });
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void openOutline(host, m, file, replace);
  };
  return [h('button', { textContent: label, title, onclick: () => input.click() }), input];
}

// The ID of a new entry from the name of its file, numbered while the document has it.
function entryId(host: SketchHost, feature: SketchFeature, file: string): Id {
  const stem = fileStemOf(file).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'outline';
  const base = /^[A-Za-z_]/.test(stem) ? stem : `o_${stem}`;
  const used = new Set([...documentIds(host.doc), ...Object.keys(feature.external)]);
  let id = base;
  for (let n = 2; used.has(id) || id === 'origin'; n++) id = `${base}_${n}`;
  return id;
}

// The constraints of the sketch that name an entity of the entry the revision takes away.
function holding(feature: SketchFeature, entry: Id, revision: OutlineRevision): Id[] {
  const gone = new Set(revision.removed.map((local) => `${entry}/${local}`));
  const goes = (id: Id): boolean => gone.has(id) || [...gone].some((curve) => id.startsWith(`${curve}/`));
  return Object.entries(feature.constraints)
    .filter(([, c]) => constraintOperands(c).some(goes))
    .map(([id]) => id);
}

export function outlineDraftPanel(host: SketchHost, m: SketchMode, feature: SketchFeature): HTMLElement[] {
  const draft = m.outline;
  if (!draft) return [];
  const again = (): void => {
    draft.outcome = read(draft);
    host.renderPanel();
  };
  const out: HTMLElement[] = [h('h2', {}, draft.replace !== undefined ? `Replace the file of ${draft.replace}` : 'Import an outline'), h('p', { className: 'hint' }, `${draft.file} (${OUTLINE_FORMATS[draft.format].title})`)];
  if (draft.replace !== undefined && !draft.stored) out.push(h('p', { className: 'hint' }, 'The options of the first import are not known (or were of another format): the file is read with these.'));
  const outcome = draft.outcome;
  const about = outcome.ok ? outcome.report.about : outcome.error.about;
  // the unit and the weld
  const units = (OUTLINE_FORMATS[draft.format].options as { unit: { options: readonly string[] } }).unit.options;
  const unit = h('select', { onchange: () => ((draft.options = { ...draft.options, ...(unit.value ? { unit: unit.value } : { unit: undefined }) }), again()) }, h('option', { value: '', textContent: about ? `as the file says (${about.unit})` : 'as the file says', selected: draft.options.unit === undefined }), ...units.map((u) => h('option', { value: u, textContent: u, selected: draft.options.unit === u })));
  const weld = h('input', { className: 'value', value: String(draft.options.weld ?? 0.01), title: 'mm: an open end is put on an end of another curve this close', onchange: () => {
    const value = Number(weld.value);
    if (Number.isFinite(value) && value >= 0 && value <= 1) draft.options = { ...draft.options, weld: value };
    again();
  } });
  out.push(h('div', { className: 'buttons' }, h('label', {}, 'Unit', unit), h('label', {}, 'Weld (mm)', weld)));
  // the layers, each with what it holds
  if (about) {
    const layers = Object.entries(about.layers);
    const chosen = new Set(draft.options.layers ?? layers.map(([name]) => name));
    out.push(
      h('p', { className: 'hint' }, 'Layers:'),
      ...layers.map(([name, types]) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(name), onchange: () => {
          box.checked ? chosen.add(name) : chosen.delete(name);
          const all = layers.every(([layer]) => chosen.has(layer));
          draft.options = { ...draft.options, layers: all ? undefined : layers.map(([layer]) => layer).filter((layer) => chosen.has(layer)) };
          if (!all && chosen.size === 0) draft.options.layers = [name];
          again();
        } });
        return h('label', { className: 'check' }, box, `${name} (${Object.entries(types).map(([type, n]) => `${n} ${type}`).join(', ')})`);
      }),
    );
    const skipped = Object.entries(about.skipped);
    if (skipped.length) out.push(h('p', { className: 'hint' }, `Left out: ${skipped.map(([what, n]) => `${n} ${what}`).join(', ')}.`));
  }
  if (!outcome.ok) {
    out.push(h('p', { className: 'issue error' }, `${outcome.error.code}: ${outcome.error.message}`));
  } else {
    const { report } = outcome;
    const size = [0, 1].map((axis) => valueText(report.bounds.max[axis] - report.bounds.min[axis], 'mm')).join(' × ');
    out.push(h('p', { className: 'hint' }, `${curveCounts(report.byKind)}; ${size}; unit ${report.about.unit}.`));
    const weldSaid = [report.welded ? `${report.welded} ends welded (at most ${valueText(report.moved, 'mm')})` : '', report.reshaped ? `${report.reshaped} arcs reshaped` : '', report.closed ? `${report.closed} closed` : '', report.dropped ? `${report.dropped} without extent left out` : '', report.duplicates ? `${report.duplicates} twins left out` : ''].filter(Boolean);
    if (weldSaid.length) out.push(h('p', { className: 'hint' }, `${weldSaid.join(', ')}.`));
    out.push(h('p', { className: report.open ? 'issue warning' : 'hint' }, report.open ? `${report.open} open ends${report.gaps.length ? `; the nearest gap ${valueText(report.gaps[0].distance, 'mm')}` : ''}.` : 'Every end meets another.'));
    for (const note of report.notes) out.push(h('p', { className: 'hint' }, note));
  }
  const cancel = h('button', { textContent: 'Cancel', onclick: () => ((m.outline = undefined), host.renderPanel()) });
  if (draft.replace !== undefined) {
    const entry = draft.replace;
    const before = (feature.external[entry] as SketchOutline | undefined)?.curves;
    const revision = outcome.ok && before ? outlineRevision(before, outcome.curves) : undefined;
    const held = revision ? holding(feature, entry, revision) : [];
    if (revision) {
      out.push(h('p', { className: 'hint' }, `${revision.kept} stay (${revision.changed} of them changed), ${revision.added.length} come, ${revision.removed.length} go${revision.removed.length ? ` (${revision.removed.join(', ')})` : ''}${revision.renamed.length ? `; renamed by a swap: ${revision.renamed.map((r) => `${r.was} → ${r.id}`).join(', ')}` : ''}.`));
      if (held.length) {
        const box = h('input', { type: 'checkbox', checked: draft.remove, onchange: () => ((draft.remove = box.checked), host.renderPanel()) });
        out.push(h('label', { className: 'check' }, box, `Remove the constraints that hold what goes (${held.join(', ')})`));
      }
    }
    const replace = (): void => {
      if (!outcome.ok) return;
      const update = { type: 'updateExternal', sketch: m.id, id: entry, ref: { type: 'outline', curves: outcome.curves, readWith: outcome.report.readWith } } as Command;
      const commands = draft.remove ? [...held.map((id): Command => ({ type: 'removeConstraint', sketch: m.id, id })), update] : [update];
      if (host.run(commands.length === 1 ? update : { type: 'batch', commands }, `The file of ${entry} replaced.`)) m.outline = undefined;
      host.renderPanel();
    };
    out.push(h('div', { className: 'buttons' }, h('button', { textContent: 'Replace', disabled: !outcome.ok, onclick: replace }), cancel));
    return out;
  }
  const anchor = h('select', { onchange: () => (draft.anchor = anchor.value as SketchOutline['anchor']) }, h('option', { value: 'origin', textContent: 'origin of the file', selected: draft.anchor === 'origin' }), h('option', { value: 'center', textContent: 'centre', selected: draft.anchor === 'center' }));
  const regions = h('input', { type: 'checkbox', checked: draft.regions, onchange: () => (draft.regions = regions.checked) });
  const place = (): void => {
    if (!outcome.ok) return;
    const id = entryId(host, feature, draft.file);
    const name = fileStemOf(draft.file).trim().slice(0, 200);
    const command = { type: 'addExternal', sketch: m.id, id, ref: { type: 'outline', curves: outcome.curves, readWith: outcome.report.readWith, anchor: draft.anchor, regions: draft.regions, ...(name ? { name } : {}) } } as Command;
    if (host.run(command, `Outline ${id} placed: ${curveCounts(outcome.report.byKind)}.`)) m.outline = undefined;
    host.renderPanel();
  };
  out.push(
    h('div', { className: 'buttons' }, h('label', {}, 'At (0, 0)', anchor), h('label', { className: 'check' }, regions, 'regions')),
    h('div', { className: 'buttons' }, h('button', { textContent: 'Place', disabled: !outcome.ok, onclick: place }), cancel),
  );
  return out;
}
