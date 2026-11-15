// The collisions of bodies: the panel, and the state it owns. The app holds the state and asks
// this module what it needs of it (is an answer shown, which pair is picked).
import type { Id, Interference, InterferenceReport } from '@trymesh/engine';
import { fmt, h } from '../dom';
import type { Note, PanelHost } from '../host';

// The last answer to "which bodies collide", for the state after `at` (null = the whole model);
// `picked` is the pair highlighted in the view. A change of the document throws the answer away.
// `note` is the note of the last check, while it is the one the status line shows.
export interface Collisions {
  answer?: { at: Id | null; report: InterferenceReport; picked?: number };
  note?: Note;
}

// The answer is shown only for the state it was computed for.
export function shownCollisions(state: Collisions, host: PanelHost): Collisions['answer'] {
  return state.answer && state.answer.at === host.marker ? state.answer : undefined;
}

export function checkCollisions(state: Collisions, host: PanelHost): void {
  const report = host.engine.interference(host.marker ? { at: host.marker } : {});
  state.answer = { at: host.marker, report };
  const failed = report.failed.length ? ` ${report.failed.length} pair(s) could not be computed.` : '';
  const fits = report.fits.length ? ` ${report.fits.length} fit(s) within the chord tolerance.` : '';
  if (report.pairs.length) host.say(`Collisions: ${report.pairs.length} pair(s) of bodies share a volume.${fits}${failed}`, true);
  else host.say(`No collisions: ${report.checked} pair(s) checked.${fits}${failed}`, report.failed.length > 0);
  state.note = host.note; // the note states a fact about the model: it goes when the model changes
  host.refresh();
}

// The colliding pairs; a click on one highlights its two bodies in the view.
export function collisionsPanel(state: Collisions, host: PanelHost): HTMLElement[] {
  const shown = shownCollisions(state, host);
  if (!shown) return [];
  const { report } = shown;
  const pick = (index: number) => {
    shown.picked = shown.picked === index ? undefined : index;
    host.renderPanel();
    host.renderScene();
  };
  // collisions first, then the fits; `picked` counts through both lists
  const row = (pair: Interference, index: number, fit: boolean) =>
    h(
      'div',
      { className: `row ${shown.picked === index ? 'selected' : ''}`, title: `Highlight the two bodies. One reaches ${fmt(pair.depth)} mm into the other`, onclick: () => pick(index) },
      h('span', { className: 'name', textContent: `${host.bodyName(pair.a)} × ${host.bodyName(pair.b)}` }),
      h('small', {}, `${fit ? 'fit, ' : ''}${fmt(pair.volume)} mm³`),
    );
  const rows: (HTMLElement | null)[] = [
    h('h2', {}, `Collisions (${report.pairs.length})`),
    report.pairs.length === 0 && report.failed.length === 0 ? h('p', { className: 'hint' }, `No two bodies collide; ${report.checked} pair(s) checked. Bodies that only touch do not count.`) : null,
    ...report.pairs.map((pair, index) => row(pair, index, false)),
    report.fits.length ? h('p', { className: 'hint' }, 'Fits: round faces that reach into each other by no more than the chord tolerance. Round faces are polygons, so a pin in a hole of the same diameter overlaps its wall by slivers; that is not a collision of the design.') : null,
    ...report.fits.map((pair, index) => row(pair, report.pairs.length + index, true)),
    ...report.failed.map((pair) => h('p', { className: 'issue warning' }, `${host.bodyName(pair.a)} × ${host.bodyName(pair.b)}: could not be computed (${pair.message})`)),
    h('div', { className: 'buttons' }, h('button', { textContent: 'Check again', onclick: () => checkCollisions(state, host) }), h('button', { textContent: 'Close', onclick: () => ((state.answer = undefined), host.refresh()) })),
  ];
  return rows.filter((element): element is HTMLElement => element !== null);
}

// The parameter table and checks. An expression is only checked while typing; the command is sent once the field is committed.

// The note of a check goes with its answer: when the document changed, the marker moved to
// another state or the section was closed. The app calls this on every refresh.
export function followCollisions(state: Collisions, host: PanelHost): void {
  if (!state.note || shownCollisions(state, host)) return;
  if (host.note === state.note) host.say('');
  state.note = undefined;
}

// The pair picked in the shown answer: collisions first, then the fits.
export function pickedPair(state: Collisions, host: PanelHost): Interference | undefined {
  const shown = shownCollisions(state, host);
  return shown?.picked === undefined ? undefined : [...shown.report.pairs, ...shown.report.fits][shown.picked];
}
