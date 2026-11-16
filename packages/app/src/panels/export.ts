// The form of an export (D54): every format of the catalog of the engine can be exported from the
// app, with a form built from the description of its options, like the generic form of a query.
// It shares its place in the model panel and the selection of the view with the form of a query:
// its state is a member of the same object (`QueryPanel.exporting`), and opening one closes the
// other.
import { type AnyExportFormat, type ArgPath, EXPORT_FORMATS, type ExportFormat, type Exported, QueryFailure, storedZip } from '@trymesh/engine';
import { download, h } from '../dom';
import type { PanelHost, ViewPick } from '../host';
import { type ArgDraft, argRows, nextToArm, takeInto } from './args';
import type { QueryPanel } from './query';

// - `draft`, `armed`: the options being filled in and the control that takes the next selection.
// - `problem`: the last refusal, or the text of an export that holds nothing; shown, with the row
//   of the option it names marked, until the next export.
export interface OpenExport extends ArgDraft {
  format: ExportFormat;
  problem?: { message: string; arg?: ArgPath };
}

// How a file is saved: the download of the browser by default (a test passes its own).
export type SaveFile = (name: string, bytes: Uint8Array, mediaType: string) => void;
const saveByDownload: SaveFile = (name, bytes, mediaType) => download(name, new Uint8Array(bytes), mediaType);

const entryOf = (format: ExportFormat): AnyExportFormat => (EXPORT_FORMATS as Record<string, AnyExportFormat>)[format];

export function openExport(panel: QueryPanel, host: PanelHost, format: ExportFormat): void {
  panel.open = undefined; // one form at a time
  panel.exporting = { format, draft: {}, armed: nextToArm(entryOf(format).options, {}) };
  host.refresh();
}

export function closeExport(panel: QueryPanel, host: PanelHost): void {
  panel.exporting = undefined;
  host.refresh();
}

// What one file or a set of files is saved as: one file under its suggested name; a set as one
// ZIP, `<format>.zip`, of the files under their paths (a browser cannot write a folder).
function saved(format: ExportFormat, exported: Exported): { name: string; bytes: Uint8Array; mediaType: string } {
  if (exported.layout === 'file') return { name: exported.files[0].path, bytes: exported.files[0].bytes, mediaType: exported.files[0].mediaType };
  return { name: `${format}.zip`, bytes: storedZip(exported.files.map((file) => ({ name: file.path, bytes: file.bytes }))), mediaType: 'application/zip' };
}

// Exports the state the marker shows with the options of the form, and saves what it gives. The
// format is known only at run time, so the options are whatever the form holds and the engine
// checks them: this is the one cast.
export function runExportForm(panel: QueryPanel, host: PanelHost, save: SaveFile = saveByDownload): void {
  const open = panel.exporting;
  if (!open) return;
  open.armed = undefined;
  open.problem = undefined;
  // the marker is null at the end of the timeline, and `at` takes no null
  const outcome = host.engine.export(open.format, structuredClone(open.draft) as never, host.marker ? { at: host.marker } : {});
  if (!outcome.ok) open.problem = { message: outcome.error.message, ...(outcome.error.arg ? { arg: outcome.error.arg } : {}) };
  else if (outcome.result.empty !== undefined) open.problem = { message: outcome.result.empty };
  else {
    try {
      // the ZIP of a set is built here, outside `engine.export`: its refusal (a path too long for
      // a ZIP) is caught here and shown like any other
      const file = saved(open.format, outcome.result);
      save(file.name, file.bytes, file.mediaType);
      host.say(`Exported ${file.name} (${file.bytes.length} bytes).`);
    } catch (error) {
      if (!(error instanceof QueryFailure)) throw error;
      open.problem = { message: error.message };
    }
  }
  if (open.problem) host.say(open.problem.message, true);
  host.refresh();
}

// The armed control of the open form takes a selection of the view: true when it took it.
export function takeExportSelection(panel: QueryPanel, pick: ViewPick): boolean {
  const open = panel.exporting;
  return open !== undefined && takeInto(entryOf(open.format).options, open, pick);
}

// The menu of the toolbar, beside that of the queries: every format of the catalog by its title.
// A format needs no entry anywhere to be there.
export function exportMenu(panel: QueryPanel, host: PanelHost): HTMLElement {
  const menu: HTMLSelectElement = h(
    'select',
    {
      title: 'Export the model in a format of the engine',
      onchange: () => {
        const format = menu.value;
        menu.value = '';
        if (format !== '') openExport(panel, host, format as ExportFormat);
      },
    },
    h('option', { value: '', textContent: 'Export…', selected: true }),
    ...Object.entries(EXPORT_FORMATS as Record<string, AnyExportFormat>).map(([format, entry]) => h('option', { value: format, textContent: entry.title, title: entry.summary })),
  );
  return menu;
}

// The open form: its options, the buttons, and the problem of the last export.
export function exportPanel(panel: QueryPanel, host: PanelHost): HTMLElement[] {
  const open = panel.exporting;
  if (!open) return [];
  const entry = entryOf(open.format);
  return [
    h('h2', { title: entry.summary }, `Export: ${entry.title}`),
    ...argRows(entry.options, open, host, open.problem),
    h('div', { className: 'buttons' }, h('button', { className: 'primary', textContent: 'Export', onclick: () => runExportForm(panel, host) }), h('button', { textContent: 'Close', onclick: () => closeExport(panel, host) })),
    ...(open.problem ? [h('p', { className: 'issue error' }, open.problem.message)] : []),
  ];
}
