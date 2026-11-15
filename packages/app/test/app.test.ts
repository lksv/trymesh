// The class `App` as a user drives it (D37, part 3): fixed sequences of clicks, typing and keys on
// an instance with the real engine, a DOM and a stand-in for the view (app-kit.ts). After every
// step the harness writes down the calls the app made on the engine, what changed in the document,
// what the toolbar, the timeline, the panel and the status line show, and what the app asked of
// the view. The record is compared with the files in `snapshots/`.
//
// A change of the app that is only a move of code leaves the snapshots untouched. A commit that
// has to change one has changed behaviour, and says in its message what and why. To write the
// snapshots again: `npx vitest run packages/app/test/app.test.ts -u`.
import { writeFileSync } from 'node:fs';
import { type Command, emptyDocument } from '@trymesh/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBridge } from '../../mcp/src/bridge';
import { type Harness, client, onPlane, outside, startApp } from './app-kit';

// The app connects to the bridge of the MCP server at its usual address; the test points it at
// a bridge of its own.
const bridgeUrl = vi.hoisted(() => ({ value: '' }));
vi.mock('@trymesh/mcp/bridge-client', async (original) => {
  const real = await original<typeof import('@trymesh/mcp/bridge-client')>();
  return { ...real, connectBridge: ((engine, options = {}) => real.connectBridge(engine, { ...options, url: bridgeUrl.value, retryMs: 20 })) as typeof real.connectBridge };
});

let harness: Harness | undefined;
afterEach(() => {
  // while a case is being written: the record so far, also of a case that failed midway
  if (harness && process.env.APP_RECORD) writeFileSync(process.env.APP_RECORD, harness.text());
  harness?.close();
  harness = undefined;
});
// Every case starts a fresh app: the counters of generated IDs are not reset within one.
const start = async (): Promise<Harness> => (harness = await startApp());
const at = (x: number, y: number, z = 0): { x: number; y: number } => client([x, y, z]);
const matches = (h: Harness, name: string) => expect(h.text()).toMatchFileSnapshot(`./snapshots/${name}.txt`);
// Where a point of a sketch is in the window now.
const point = (h: Harness, sketch: string, id: string): { x: number; y: number } => {
  const result = h.engine.getState().evaluation.features[sketch];
  const p = result?.sketch?.points[id];
  if (!result?.plane || !p) throw new Error(`the sketch ${sketch} has no point ${id}`);
  return onPlane(result.plane, p.x, p.y);
};
// The row of a constraint in the sketch panel, by its operands as the row prints them.
const constraintRow = (h: Harness, operands: string): HTMLElement => {
  const row = Array.from(h.document.querySelectorAll<HTMLElement>('#panel .constraint.clickable')).find((candidate) => candidate.querySelector('small')?.textContent?.startsWith(operands));
  if (!row) throw new Error(`there is no constraint of ${operands}`);
  return row;
};
// The ID of the sketch point that lies at these coordinates of its sketch.
const pointIdAt = (h: Harness, sketch: string, x: number, y: number): string => {
  const found = Object.entries(h.engine.getState().evaluation.features[sketch]?.sketch?.points ?? {}).find(([, p]) => Math.hypot(p.x - x, p.y - y) < 1e-6);
  if (!found) throw new Error(`the sketch ${sketch} has no point at ${x}, ${y}`);
  return found[0];
};
const doubleClick = (h: Harness, name: string): void => void h.row(name).dispatchEvent(new (MouseEventOf(h))('dblclick'));
// A checkbox of the panel by the text of its label.
const tick = (h: Harness, label: string): void => {
  const box = Array.from(h.document.querySelectorAll<HTMLLabelElement>('#panel label.check')).find((candidate) => candidate.textContent === label)?.querySelector('input');
  if (!box) throw new Error(`there is no checkbox "${label}"`);
  box.checked = !box.checked;
  h.type(box, '', true);
};
const DISTANCE = 'Distance (mm or an expression; negative = against the normal)';
const START = 'Start (mm or an expression; offset from the sketch plane along its normal)';
const COUNT = 'Count with the original (a whole number or an expression)';
const ANGLE = 'Angle (° or an expression in radians)';
const OFFSET = 'Offset along the normal (mm or an expression)';
// The name field, the expression field and the button of the row that adds a parameter (0) or a check (1).
const adder = (h: Harness, which: number): { name: HTMLInputElement; value: HTMLInputElement; add: HTMLButtonElement } => {
  const row = h.button('panel', 'Add', which).parentElement as HTMLElement;
  return { name: row.querySelector('input.pname') as HTMLInputElement, value: row.querySelector('input.expr') as HTMLInputElement, add: h.button('panel', 'Add', which) };
};
// A field of the list of parameters and checks by the value it shows.
const shown = (h: Harness, kind: 'pname' | 'expr', value: string): HTMLInputElement => {
  const input = Array.from(h.document.querySelectorAll<HTMLInputElement>(`#panel input.${kind}`)).find((candidate) => candidate.value === value);
  if (!input) throw new Error(`no field shows "${value}"`);
  return input;
};
const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 300 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!condition()) throw new Error(`waited in vain for ${what}`);
};
// A button of the panel by its title (the icons of a row share their text).
const titled = (h: Harness, title: string, nth = 0): HTMLButtonElement => {
  const button = Array.from(h.document.querySelectorAll<HTMLButtonElement>('#panel button')).filter((candidate) => candidate.title === title)[nth];
  if (!button) throw new Error(`there is no button titled "${title}"`);
  return button;
};
const MouseEventOf = (h: Harness): typeof MouseEvent => (h.document.defaultView as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;

describe('the app, driven as a user drives it', () => {
  it('a sketch: every drawing tool, constraints and dimensions, selection, a drag, the keys', async () => {
    const h = await start();
    h.record('the app starts empty');
    h.press('toolbar', 'Skica');
    h.record('Skica: the app waits for a plane');
    h.press('panel', 'XY');
    h.record('the plane XY: a sketch is created and entered');

    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.move(at(25, 20));
    h.record('rectangle: first corner on the origin, the rubber band follows');
    h.click(at(40, 30));
    h.record('rectangle: second corner');

    h.press('toolbar', 'Úsečka');
    h.click(at(60, 0));
    h.move(at(80, 2));
    h.record('line: a nearly horizontal end is inferred');
    h.click(at(80, 2));
    h.move(at(81, 25));
    h.record('line: the chain goes on from the end, a nearly vertical end is inferred');
    h.click(at(81, 25));
    h.click(at(60, 0));
    h.record('line: joining an existing point ends the chain');

    h.press('toolbar', 'Kružnice');
    h.click(at(20, 15));
    h.click(at(26, 15));
    h.record('circle');
    h.press('toolbar', 'Oblouk');
    h.click(at(60, 50));
    h.click(at(72, 50));
    h.move(at(60, 62));
    h.record('arc: centre and start, the rubber band shows the sweep');
    h.click(at(60, 62));
    h.record('arc');

    h.press('toolbar', 'Polygon');
    h.record('polygon: its options are in the panel');
    h.type(h.field('Sides (3 to 64)'), '8', true);
    h.choose('Dimension of the size', 'acrossFlats');
    h.type(h.field('Sides (3 to 64)'), '2', true); // out of range: the count stays
    h.record('polygon: eight sides with the size across flats; a count out of range is not taken');
    h.click(at(110, 20));
    h.click(at(122, 20));
    h.record('polygon');

    h.press('toolbar', 'Konstrukčně');
    h.press('toolbar', 'Úsečka');
    h.click(at(0, 50));
    h.click(at(40, 50));
    h.key('Escape');
    h.press('toolbar', 'Konstrukčně');
    h.record('a construction line; Escape ends the chain');
    h.press('toolbar', 'Bod');
    h.click(at(100, 55));
    h.record('a point');

    // selection: the bottom side of the rectangle, then with Shift its right side
    h.press('toolbar', 'Výběr');
    h.move(at(20, 0));
    h.record('select: a curve under the pointer is highlighted');
    h.click(at(20, 0));
    h.record('select: the bottom side');
    h.press('panel', 'Kóta');
    h.record('a dimension of the selected line');
    h.click(at(40, 15), { shiftKey: true });
    h.record('select with Shift: two sides');
    h.press('panel', 'Kolmo');
    h.record('a constraint the sketch already implies is refused or added as the engine says');
    h.click(at(100, 55));
    h.click(at(110, 20), { shiftKey: true });
    h.press('panel', 'Kóta ↔');
    h.record('a horizontal dimension between two points');
    h.press('panel', 'Kóta ↔');
    h.record('the same dimension again is refused in words');

    // a dimension typed, made a reference one and back: the width of the rectangle
    const value = (): HTMLInputElement => constraintRow(h, 'origin, p2').querySelector('input.value') as HTMLInputElement;
    h.type(value(), '1 +');
    h.record('a dimension: an incomplete expression is marked while typing');
    h.type(value(), '', true);
    h.record('a dimension: an empty field changes nothing');
    h.type(value(), '45', true);
    h.record('a dimension: a new value');
    const driving = (): HTMLInputElement => constraintRow(h, 'origin, p2').querySelector('label.check input') as HTMLInputElement;
    driving().checked = false;
    h.type(driving(), '', true);
    h.record('a dimension made a reference one');
    driving().checked = true;
    h.type(driving(), '', true);
    h.record('and a driving one again, with the measured value');

    // a constraint explained, and Escape through its chain
    constraintRow(h, 'c1, c2').click();
    h.record('a click on a constraint: it is focused and explained');
    constraintRow(h, 'c1, c2').dispatchEvent(new (MouseEventOf(h))('mouseenter'));
    h.record('the pointer over a constraint highlights its operands');
    constraintRow(h, 'c1, c2').dispatchEvent(new (MouseEventOf(h))('mouseleave'));
    h.key('Escape');
    h.record('Escape: the selection goes first');
    h.key('Escape');
    h.record('Escape: then the focus');
    h.press('panel', 'Vybrat volné');
    h.record('the free entities are selected');
    h.key('Escape');

    // the drag of a point: p22 is held only by its horizontal dimension
    const grab = point(h, 's1', 'p22');
    const to = (dx: number, dy: number) => ({ x: grab.x + dx, y: grab.y + dy });
    h.move(grab);
    h.down(grab);
    h.move(to(2, 1), { buttons: 1 });
    h.record('a press on a point and a move within four pixels: no drag yet');
    h.move(to(3, 12), { buttons: 1 });
    h.record('a drag: the engine previews, the status follows without a rebuild of the panel');
    h.up(to(3, 15));
    h.record('the release moves the point');
    h.down(point(h, 's1', 'p22'));
    h.move(to(0, 30), { buttons: 1 });
    h.pointer('pointercancel', to(0, 30));
    h.record('a drag cancelled by the system leaves the point where it was');
    h.down(point(h, 's1', 'p22'));
    h.move(to(0, 30), { buttons: 1 });
    outside(h, { type: 'renameFeature', id: 's1', name: 'Base' });
    h.record('a change of the document under a drag ends the drag');
    h.up(to(0, 30));
    h.record('the release after it does nothing');
    h.down(point(h, 's1', 'p22'));
    h.move(to(0, 30), { buttons: 1 });
    h.key('Escape');
    h.up(to(0, 30));
    h.record('Escape ends a drag');
    h.down(point(h, 's1', 'p22'), { altKey: true });
    h.move(to(0, 30), { buttons: 1, altKey: true });
    h.up(to(0, 30), { altKey: true });
    h.record('a press with Alt belongs to the view: nothing is dragged');

    // delete
    h.click(point(h, 's1', 'p22'));
    h.record('the point is selected');
    h.key('Delete');
    h.record('Delete removes the selected point');
    h.click(at(20, 50));
    h.press('panel', 'Běžná křivka');
    h.record('the construction line is made an ordinary curve');
    h.press('panel', 'Smazat');
    h.record('and deleted by the button, with the points nothing else uses');
    h.click(at(0, 0));
    h.key('Delete');
    h.record('the origin cannot be deleted');
    h.press('toolbar', 'Kružnice');
    h.click(at(150, 50));
    h.key('Escape');
    h.record('Escape drops a shape in progress');
    h.key('Escape');
    h.record('Escape: then the tool');
    h.key('z', { ctrlKey: true });
    h.record('undo in a sketch');
    h.key('z', { ctrlKey: true, shiftKey: true });
    h.record('redo');
    h.press('toolbar', 'Dokončit skicu');
    h.record('the sketch is finished');
    await matches(h, 'sketch');
  });

  it('features: extrusions, a sketch on a face, a cut through all, a pattern, a plane, a gear; each form there and back', async () => {
    const h = await start();
    // the base sketch: a rectangle, a circle next to it and a point in the middle of the rectangle
    h.press('toolbar', 'Vysunutí');
    h.record('an extrusion needs a sketch');
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Kružnice');
    h.click(at(70, 15));
    h.click(at(78, 15));
    h.press('toolbar', 'Bod');
    h.click(at(20, 15));
    h.press('toolbar', 'Dokončit skicu');
    h.record('the base sketch: two regions');

    // ----- an extrusion of a region picked in the view
    h.press('toolbar', 'Vysunutí');
    h.record('a new extrusion: two regions, none picked, nothing to compute or confirm');
    h.move(at(20, 10));
    h.record('the region under the pointer');
    h.click(at(20, 10));
    h.record('a click picks the region: the engine previews');
    h.click(at(20, 10));
    h.record('a second click drops it');
    h.click(at(20, 10));
    h.down(at(70, 15));
    h.up(at(90, 40));
    h.record('a drag of the view is not a click');
    h.type(h.field(DISTANCE), '12');
    h.record('a distance typed: the preview follows at once, the panel is not rebuilt');
    h.type(h.field(START), 'h / 2');
    h.record('an expression with an unknown name: the field is marked and the preview says why');
    h.type(h.field(START), '0');
    h.key('z', { ctrlKey: true });
    h.record('undo while a draft is open does nothing but say so');
    h.press('panel', 'OK');
    h.record('OK: the extrusion is in the document');

    h.press('toolbar', 'Vysunutí');
    h.click(at(70, 15));
    h.press('panel', 'Zrušit výběr oblastí');
    h.record('the picked regions dropped by the button');
    h.click(at(70, 15));
    h.press('panel', 'OK');
    h.record('a second body: the cylinder');

    // ----- a sketch on a face, started with the face selected
    h.move(at(20, 10, 12));
    h.record('model: the face under the pointer');
    h.click(at(20, 10, 12));
    h.record('model: the top face of the plate is selected');
    h.press('toolbar', 'Skica');
    h.record('a sketch on the selected face: its outline is projected');
    h.press('toolbar', 'Kružnice');
    h.click(at(10, 10, 12));
    h.click(at(14, 10, 12));
    // an edge of another body projected, repaired and removed
    h.press('toolbar', 'Promítnout');
    h.move(at(62, 15, 10));
    h.record('project: the edge under the pointer');
    h.click(at(62, 15, 10));
    h.record('the rim of the cylinder projected into the sketch');
    titled(h, 'Promítnout znovu: klikněte potom na novou hranu tělesa', 4).click();
    h.record('a projection to repair: the next click on an edge replaces it');
    h.click(at(70, 7, 0));
    h.record('the projection repaired with the lower rim');
    h.click(at(20, 22, 12));
    h.record('a click that hits no edge projects nothing');
    titled(h, 'Zrušit promítnutí', 4).click();
    h.record('the projection removed');
    h.press('toolbar', 'Dokončit skicu');

    // ----- a cut: the extent there and back, the targets
    h.press('toolbar', 'Vysunutí');
    h.record('an extrusion of a sketch on a face proposes to add to its body');
    h.choose('Operace', 'cut');
    h.record('a cut: the targets are a list of bodies');
    h.choose('Extent', 'throughAll');
    h.record('through all: a side instead of a distance');
    h.choose('Side', 'backward');
    h.choose('Extent', 'distance');
    h.record('back to a distance: the one the draft had');
    h.choose('Extent', 'throughAll');
    h.record('and through all again: the side it had');
    tick(h, 'Vysunutí 2');
    h.record('a second target');
    tick(h, 'Vysunutí 2');
    h.choose('Operace', 'new');
    h.record('a new body cannot go through all: the extent returns to the distance');
    h.choose('Operace', 'cut');
    h.choose('Extent', 'throughAll');
    h.choose('Side', 'backward');
    h.press('panel', 'OK');
    h.record('the hole');

    // ----- a pattern of the cut, with a slow preview
    h.row('Vysunutí 3').click();
    h.record('the cut is selected on the timeline: its faces are highlighted');
    h.press('toolbar', 'Pattern');
    h.record('a new pattern of the selected feature');
    h.choose('Axis', 'sketchPoint');
    h.choose('Sketch', 's1');
    h.choose('Point', pointIdAt(h, 's1', 20, 15));
    h.record('the axis through a point of the base sketch');
    h.tick = 200; // from now on a preview takes 200 ms
    h.type(h.field(COUNT), '2');
    h.record('a count typed: previewed at once, because the preview before it was fast');
    h.type(h.field(COUNT), '3');
    h.record('the next keystroke waits: the last preview was slow');
    expect(h.timers()).toBe(1);
    h.record('after the pause the preview follows');
    h.choose('Span', 'angle');
    h.record('the span as an angle');
    h.type(h.field(ANGLE), '400');
    h.timers();
    h.record('an angle out of range, typed in degrees, is reported in degrees');
    h.type(h.field(ANGLE), '90');
    h.record('nothing was computed for the wrong angle, so this one is previewed at once');
    h.choose('Span', 'full');
    h.choose('Span', 'angle');
    h.record('the full circle and back: the angle the draft had');
    h.choose('Repeat', 'body');
    h.record('a pattern of a body instead');
    h.click(at(70, 15, 10));
    h.record('a click on a body in the view picks it');
    h.choose('Repeat', 'features');
    h.record('and back to the features');
    h.type(h.field(COUNT), '4');
    h.record('a typed change is waiting for its preview');
    h.press('panel', 'OK');
    h.record('OK while a preview is pending: the pattern is confirmed and not previewed again');
    h.timers();
    h.record('the timer that was left does nothing');
    h.tick = 0;

    // ----- a plane: the pick that is refused first, the base changed by a click
    h.press('toolbar', 'Rovina');
    h.record('Rovina: the app waits for a plane');
    h.click(at(65.2, 8.6, 5));
    h.record('a round face is refused and the app keeps waiting');
    h.click(at(70, 15, 10));
    h.record('the top of the cylinder: a draft of a plane on it');
    h.type(h.field(OFFSET), '5');
    h.record('the offset');
    h.click(at(20, 22, 12));
    h.record('a click on another planar face changes the base');
    h.click(at(65.2, 8.6, 5));
    h.record('a click on a round face says why it cannot be one');
    h.click(at(-15, -15));
    h.record('a click on a base plane');
    h.type(h.field(OFFSET), '20');
    h.press('panel', 'OK');
    h.record('the plane');

    // ----- a sketch started with a plane selected on the timeline, and a gear on it
    h.row('Rovina 1').click();
    h.press('toolbar', 'Skica');
    h.record('a sketch on the plane selected on the timeline');
    const plane = h.engine.getState().evaluation.features.s3.plane;
    if (!plane) throw new Error('the sketch on the plane has no frame');
    h.press('toolbar', 'Kružnice');
    h.click(onPlane(plane, 60, 60));
    h.click(onPlane(plane, 70, 60));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.record('an extrusion of the only region of the sketch: it is picked by itself');
    h.choose('Profile', 'involuteGear');
    h.record('a gear from the generator: its fields come from the catalog');
    h.type(h.field('Number of teeth'), '12');
    h.record('the teeth: the facts follow the preview');
    h.type(h.field('Pressure angle (° or an expression in radians)'), '25');
    tick(h, 'Internal (the cut that makes a ring gear)');
    h.record('an angle in degrees and a flag');
    tick(h, 'Internal (the cut that makes a ring gear)');
    h.choose('Profile', 'regions');
    h.record('back to the regions: the picked one is remembered');
    h.choose('Profile', 'involuteGear');
    h.record('and to the gear again: its parameters are remembered');
    h.type(h.field(DISTANCE), '6');
    h.press('panel', 'OK');
    h.record('the gear');

    // ----- opened again: changed, cancelled, refused
    doubleClick(h, 'Vysunutí 1');
    h.record('a double click on the timeline opens the form of the feature');
    h.type(h.field(DISTANCE), '15');
    h.press('panel', 'OK');
    h.record('the change is saved');
    h.row('Vysunutí 4').click();
    h.record('the gear selected: its summary and its body');
    h.press('panel', 'Upravit');
    h.type(h.field('Number of teeth'), '14');
    h.record('the form of the gear, a change typed');
    h.press('panel', 'Zrušit');
    h.record('Zrušit: nothing is changed');
    doubleClick(h, 'Pattern 1');
    h.record('the form of the pattern');
    tick(h, 'Vysunutí 3');
    h.record('a pattern without a source cannot be confirmed');
    h.key('Escape');
    h.record('Escape leaves the form');
    doubleClick(h, 'Rovina 1');
    h.record('the form of the plane');
    h.type(h.field(OFFSET), '');
    h.record('an empty field: the engine refuses the preview');
    h.press('panel', 'OK');
    h.record('OK is refused by the engine and the form stays');
    h.type(h.field(OFFSET), '25');
    h.press('panel', 'OK');
    h.record('a valid offset is saved');
    doubleClick(h, 'Skica 2');
    h.record('a double click on a sketch enters it');
    h.press('toolbar', 'Dokončit skicu');
    h.key('z', { ctrlKey: true });
    h.record('undo after the forms: the offset of the plane goes back');
    h.key('y', { ctrlKey: true });
    h.record('redo with Ctrl+Y');

    // ----- a sketch started by a pick: a round face is refused first
    h.row('Skica 2').click();
    h.press('toolbar', 'Skica');
    h.record('Skica with nothing usable selected: the app waits for a plane');
    h.click(at(65.2, 8.6, 5));
    h.record('a round face is refused and the app keeps waiting');
    h.click(at(70, 15, 10));
    h.record('the top of the cylinder: the sketch is created with its rim projected');
    h.press('toolbar', 'Dokončit skicu');
    await matches(h, 'features');
  });

  // A plate, a pin apart from it and a block that reaches into the plate, drawn through the app.
  const threeBodies = async (): Promise<Harness> => {
    const h = await start();
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Kružnice');
    h.click(at(90, 15));
    h.click(at(95, 15));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.click(at(20, 15));
    h.press('panel', 'OK');
    h.press('toolbar', 'Vysunutí');
    h.click(at(90, 15));
    h.press('panel', 'OK');
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(30, 10));
    h.click(at(60, 25));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.type(h.field(DISTANCE), '8');
    h.press('panel', 'OK');
    return h;
  };

  it('the model: selection in the view, the selected feature, export, the timeline, parameters and checks, collisions', async () => {
    const h = await threeBodies();
    h.record('a model of three bodies');

    // ----- selection in the view
    h.click(at(20, 15, 10));
    h.record('a face selected: what it is and its body');
    h.move(at(20, 0, 10));
    h.record('an edge under the pointer');
    h.click(at(20, 0, 10));
    h.record('an edge selected');
    h.press('panel', 'Export STL');
    h.press('toolbar', 'Export STL');
    h.press('toolbar', 'Uložit');
    h.record('the body of the selection exported alone, the model exported, the document saved');
    h.key('Escape');
    h.record('Escape drops the selection');

    // ----- the selected feature
    h.row('Vysunutí 1').click();
    h.record('a feature selected on the timeline: its summary, its body, its faces highlighted');
    h.type(h.field('Název'), 'Deska', true);
    h.record('renamed');
    h.press('panel', 'Potlačit');
    h.record('suppressed: its body is gone');
    h.press('panel', 'Obnovit');
    h.record('restored');
    h.row('Deska').click();
    h.record('a second click on the row drops the selection of the feature');
    h.click({ x: -20, y: 4 });
    h.record('a base plane selected in the view');
    h.row('Skica 2').click();
    h.press('panel', 'Přenést skicu na vybranou rovinu');
    h.record('the sketch moved to the selected plane: the block follows');
    h.press('toolbar', '↶ Zpět');
    h.record('undo by the button');
    h.press('panel', 'Smazat');
    h.record('the sketch deleted: the extrusion that used it reports an error');
    h.press('toolbar', '↶ Zpět');
    h.press('toolbar', '↷ Znovu');
    h.press('toolbar', '↶ Zpět');
    h.record('undo, redo and undo again');

    // ----- the timeline: the marker, a feature added in the middle, moving, hiding
    h.rowIcon('Deska', '⇤');
    h.record('the marker after the plate: the model is shown as it was there');
    h.press('toolbar', 'Rovina');
    h.record('Rovina with a plane selected in the view: its form opens on that plane at once');
    h.press('panel', 'Zrušit');
    h.key('Escape');
    h.press('toolbar', 'Rovina');
    h.press('panel', 'YZ');
    h.type(h.field(OFFSET), '15');
    h.press('panel', 'OK');
    h.record('a plane added at the marker (the cancelled draft took the number 1): it goes into the middle and the marker follows it');
    h.press('timeline', 'Zobrazit celý model');
    h.record('the whole model again');
    h.rowIcon('Rovina 2', '↓');
    h.record('the plane moved later');
    h.rowIcon('Rovina 2', '↑');
    h.rowIcon('Deska', '👁');
    h.record('moved back; the plate hidden');
    h.click(at(20, 15, 10));
    h.record('a hidden body is not picked: the base plane behind it is');
    h.rowIcon('Deska', '◌');
    h.rowIcon('Rovina 2', '👁');
    h.record('the plate shown, the plane hidden');
    h.press('toolbar', 'Základní roviny');
    h.record('the base planes switched off');
    h.press('toolbar', 'Základní roviny');
    h.press('toolbar', 'Zobrazit vše');
    h.record('and on; the view fitted to the model');

    // ----- parameters and checks
    h.key('Escape');
    adder(h, 0).add.click();
    h.record('a parameter without a name is not added');
    h.type(adder(h, 0).name, 'w');
    h.type(adder(h, 0).value, '4 *');
    h.record('an incomplete expression is marked while typing');
    h.type(adder(h, 0).value, '40');
    adder(h, 0).add.click();
    h.record('a parameter');
    h.type(adder(h, 0).name, 'w');
    h.type(adder(h, 0).value, '1');
    adder(h, 0).add.click();
    h.record('the same name again is refused');
    h.type(adder(h, 0).name, 'h');
    h.type(adder(h, 0).value, 'w / 4');
    adder(h, 0).value.dispatchEvent(new (h.document.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent('keydown', { key: 'Enter' }));
    h.record('a second parameter, added with Enter');
    h.type(adder(h, 1).name, 'fits');
    h.type(adder(h, 1).value, 'h < 20');
    adder(h, 1).add.click();
    h.record('a check that holds');
    // a field of a form takes an expression with a parameter
    h.row('Vysunutí 3').click();
    h.press('panel', 'Upravit');
    h.type(h.field(DISTANCE), 'h + 3');
    h.record('a field of a form with an expression: its value is next to it');
    h.press('panel', 'OK');
    h.row('Vysunutí 3').click();
    h.record('the summary shows the expression and its value');
    h.row('Vysunutí 3').click();
    h.type(shown(h, 'expr', '40'), '100', true);
    h.record('a parameter changed: the block grows, the check fails and the status says so');
    h.type(shown(h, 'pname', 'w'), 'width', true);
    h.record('a parameter renamed: the expression that uses it follows');
    h.type(shown(h, 'expr', '100'), 'nope + 1', true);
    h.record('an expression with an unknown name: the parameter is in error');
    h.type(shown(h, 'expr', 'h < 20'), 'h <', true);
    h.record('a check that is not valid is refused and the field shows the old one');
    h.type(shown(h, 'pname', 'fits'), 'small', true);
    h.press('panel', '✕', 2);
    h.record('the check renamed and deleted');
    h.press('panel', '✕', 0);
    h.record('a parameter deleted: the one that used it is in error, and so is the extrusion');
    h.press('toolbar', '↶ Zpět');
    h.record('undo brings the parameter back');
    h.type(shown(h, 'expr', 'nope + 1'), '40', true);
    h.record('the parameter repaired: the block is back');
    // ----- collisions
    h.press('toolbar', 'Collisions');
    h.record('collisions: the block reaches into the plate');
    (h.document.querySelector('#panel .row') as HTMLElement).click();
    h.record('a pair picked: its two bodies are highlighted');
    h.rowIcon('Deska', '⇤');
    h.record('the marker moved: the answer belongs to another state and is hidden, with its note');
    h.press('timeline', 'Zobrazit celý model');
    h.record('back at the end: the answer is shown again');
    h.press('panel', 'Ask again');
    h.record('checked again');
    h.press('panel', 'Close');
    h.record('closed');
    // ----- the generic form of a query: measuring
    const menu = h.document.querySelector('#toolbar select') as HTMLSelectElement;
    const control = (label: string, index: number): HTMLSelectElement => (h.field(label).closest('label') as HTMLElement).querySelectorAll('select, input')[index] as HTMLSelectElement;
    h.type(menu, 'measure', true);
    h.record('the query Measure opened from the menu: its two arguments, the first armed');
    h.click(at(10, 15, 10));
    h.record('a click on a face goes to the armed argument, not to the selection; the next argument is armed');
    h.click(at(90, 15, 10));
    h.record('a click near the rim of the pin gives its edge: both entities given');
    h.press('panel', 'Ask');
    h.record('asked: the numbers with their units, the face highlighted, the smallest distance drawn');
    h.type(control('To', 0), 'sketchPoint', true);
    h.type(control('To', 1), control('To', 1).options[1].value, true);
    h.type(control('To', 2), 'origin', true);
    h.record('the second entity chosen from the lists: a sketch and its point; the answer stays that of the question asked');
    h.press('panel', 'Ask again');
    h.record('asked again: the face against a sketch point');
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'measure', true);
    h.press('panel', 'Ask');
    h.record('asked with nothing given: the engine names the argument, and its row is marked');
    h.press('panel', 'Pick in the view'); // nothing is armed after a question
    h.click(at(10, 15, 10));
    h.click(at(90, 15, 10));
    h.press('panel', 'Ask again');
    h.record('the arguments given and asked again: the note of the error goes with it');
    // a number out of its range reaches the engine, which refuses it at its argument
    h.press('toolbar', 'Collisions');
    h.type(h.field('Threshold (optional)'), '5', true);
    h.type(h.field('Threshold (optional)'), '-1', true);
    h.press('panel', 'Ask again');
    h.record('a threshold below zero: marked while typed, sent as typed, refused by the engine at the threshold');
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'body', true);
    h.type(h.field('Body'), (h.field('Body') as HTMLSelectElement).options[1].value, true);
    h.press('panel', 'Ask');
    h.record('a query without a view: its answer as a tree of names and values');
    h.press('panel', 'Close');
    h.record('the query closed');
    // ----- a picture of the model, saved by its button
    h.press('toolbar', 'Save picture');
    await until(() => h.downloads.includes('model.png'), 'the picture');
    h.record('a picture of the model saved: every body in its colour, from the camera of the view, drawn off the screen');
    // ----- the section view: the model cut, the cut filled, and what is cut away not picked
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'section', true);
    h.click(at(10, 15, 10));
    h.type(h.field('Offset (optional)'), '-5', true);
    h.record('the query Section: the plane is the top of the plate, taken from a click, 5 mm into the body');
    h.press('panel', 'Ask');
    h.record('asked: the model is cut, the cut of the three bodies filled and outlined, the bodies with their areas');
    h.click(at(10, 15, 5));
    h.record('a click on the filled cut selects nothing: behind it is the inside of the plate');
    h.click(at(20, 0, 2.5));
    h.record('a click on a wall below the cut selects as ever');
    h.key('Escape');
    h.move(at(95, 15, 10));
    h.record('the rim of the pin that is cut away is not under the pointer; the one below the cut is');
    h.press('panel', '+1 mm');
    h.record('the plane stepped along its normal: asked again with the arguments of the form');
    h.rowIcon('Vysunutí 2', '👁');
    h.record('the pin hidden: its fill and its outline go with it');
    h.press('toolbar', 'Save picture');
    await until(() => h.downloads.includes('model.png'), 'the picture');
    h.record('a picture saved while the section is shown: the bodies that are not hidden keep their colours, cut as the view is, each cut filled in the shade of its body');
    h.rowIcon('Vysunutí 2', '◌');
    const flip =h.field('From the other side (optional)') as HTMLInputElement;
    flip.checked = true;
    h.type(flip, 'on', true);
    h.press('panel', 'Ask again');
    h.record('seen from the other side: the other half is cut away');
    h.press('panel', 'Close');
    h.record('the section closed: the model is whole again');
    // ----- the gap view: the pairs as rows, and where a gap is
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'gap', true);
    h.type(h.field('Search distance (optional)'), '100', true);
    h.press('panel', 'Ask');
    h.record('the query Smallest gap within 100 mm: a row per pair, the closest first, a pair at zero with its contact');
    const gapRows = (): HTMLElement[] => Array.from(h.document.querySelectorAll('#panel .row')) as HTMLElement[];
    gapRows()[0].click();
    h.record('a pair at zero picked: its two bodies are highlighted');
    gapRows()[gapRows().length - 1].click();
    h.record('a pair with a gap picked: the two faces named and highlighted, the two points joined by a line with its length');
    h.press('toolbar', 'Save picture');
    await until(() => h.downloads.includes('model.png'), 'the picture');
    h.record('a picture saved while another answer is shown: the model alone, not cut and without what the answer highlights');
    h.view.failing = 'no WebGL';
    h.press('toolbar', 'Save picture');
    await until(() => (h.document.getElementById('status')?.textContent ?? '').startsWith('The picture could not'), 'the refusal');
    h.record('a picture the view cannot draw: nothing is saved and the status bar says why');
    h.view.failing = undefined;
    h.type(h.field('Most pairs (optional)'), '1', true);
    h.press('panel', 'Ask again');
    h.record('at most one pair listed: the panel says how many there are');
    h.press('panel', 'Close');
    h.record('the gaps closed');
    // ----- a query without a view whose answer has units at every depth: the mass
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'mass', true);
    // two bodies: the first is chosen before the second row is added, and stays
    const item = (index: number): HTMLSelectElement => h.document.querySelectorAll('#panel .item select')[index] as HTMLSelectElement;
    h.press('panel', 'Add');
    h.type(item(0), 'e1', true);
    h.press('panel', 'Add');
    h.type(item(1), 'e2', true);
    h.type(h.field('Density (optional)'), '1.24', true);
    // a density of its own for the second body: a row of the record by body
    h.type(h.field('Density by body (optional)'), 'e2', true);
    h.type(h.document.querySelector('#panel label .item input') as HTMLInputElement, '7.8', true);
    h.record('the query Mass properties: two bodies added to the list, the density typed with its unit, a density by body');
    h.press('panel', 'Ask');
    h.record('asked: the mass, the centre of mass and the rows of the tensor with their units; each body with its density and fill factor');
    h.type(h.field('Density (optional)'), '', true);
    h.press('panel', 'Ask again');
    h.record('asked without the density for all: refused at the density for the body that has none, its row marked');
    h.press('panel', 'Close');
    // ----- the print view: a row per body and orientation, and the faces of a picked one
    h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'print', true);
    // the first orientation by a direction that leans, the second by the face that lies on the bed
    const way = (index: number): HTMLElement => h.field('What is up', index).parentElement as HTMLElement;
    h.press('panel', 'Add', 1);
    h.type(h.field('What is up'), 'up', true);
    ['1', '0', '0.5'].forEach((part, axis) => h.type(way(0).querySelectorAll('input')[axis], part, true));
    h.press('panel', 'Add', 1);
    h.type(h.field('What is up', 1), 'onBed', true);
    h.type(way(1).querySelectorAll('select')[1], 'e1', true);
    const faces = way(1).querySelectorAll('select')[2];
    h.type(faces, Array.from(faces.options).find((option) => option.value.includes('endCap'))?.value ?? '', true);
    h.type(h.field('x'), '35', true);
    h.type(h.field('y'), '35', true);
    h.type(h.field('Height'), '200', true);
    h.record('the query Print check: an orientation by a direction, one by a face chosen from the lists of its body, and a bed');
    h.press('panel', 'Ask');
    h.record('asked: a row per body and orientation with its overhang, its height and what lies on the bed; what does not fit the bed says so');
    const printRows = (): HTMLElement[] => Array.from(h.document.querySelectorAll('#panel .row')) as HTMLElement[];
    printRows()[0].click();
    h.record('a row picked: the overhanging faces are listed with their areas and heights and painted on the model');
    printRows()[1].click();
    h.record('the row of the other orientation picked: the face on the bed is painted, nothing overhangs');
    // a stricter printer, a smallest overhang and one face a list
    h.type(h.field('Turn (optional)'), '30', true);
    h.type(h.field('Overhang angle (optional)'), '20', true);
    h.type(h.field('Smallest overhang listed (optional)'), '100', true);
    h.type(h.field('Most faces (optional)'), '1', true);
    h.press('panel', 'Ask again');
    printRows()[0].click();
    h.record('overhangs from 20°, the first orientation turned, at most one face a list: the picked row says what its list leaves out, and the panel how much was listed in all');
    printRows()[2].click();
    h.record('a row with an overhang below the smallest area listed: counted, not listed and not painted');
    h.press('panel', 'Close');
    h.record('the print check closed');
    h.press('toolbar', 'Collisions');
    outside(h, { type: 'renameFeature', id: 'e2', name: 'Kolík' });
    h.record('a change of the document throws the answer away');
    h.press('toolbar', 'Skica');
    h.press('panel', 'Zrušit');
    h.record('waiting for a plane cancelled');
    h.press('toolbar', 'Nový');
    h.record('a new document');
    await matches(h, 'model');
  });

  it('the bridge to the MCP server: commands of the AI while a form is open, a load and a load that fails', async () => {
    const bridge = await startBridge(0);
    bridgeUrl.value = `http://127.0.0.1:${bridge.port}`;
    try {
      const h = await threeBodies();
      const status = (): string => h.document.getElementById('status')?.textContent ?? '';
      const ai = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const outcome = await bridge.call(name, args);
        return outcome.ok ? 'ok' : outcome.error;
      };
      const rename = (name: string): Command => ({ type: 'renameFeature', id: 'e1', name });
      h.record('a model of three bodies');
      h.press('toolbar', 'AI');
      await until(() => bridge.connected() && status().startsWith('Propojeno'), 'the app to connect');
      h.record('the app is connected to the bridge');

      h.press('toolbar', 'Rovina');
      h.press('panel', 'XY');
      h.record('a form is open');
      expect(await ai('view_image', { view: 'top', bodies: ['e1'], width: 320, height: 240 })).toBe('ok');
      h.record('the AI takes a picture: it is drawn off the screen, the form stays, and the status bar says that one was taken');
      expect(await ai('view_image', { bodies: ['nope'] })).toMatch(/^notAvailable: view_image: bodies\[0\]/);
      h.record('a picture of a body that is not there is refused: the AI has the reason, and the app says nothing, as for any question');
      expect(await ai('get_model', {})).toBe('ok');
      h.record('a question of the AI leaves the form alone');
      expect(await ai('execute', { command: rename('Vysunutí 1') })).toBe('ok');
      h.record('a command that changes nothing leaves the form alone');
      expect(await ai('execute', { command: { type: 'removeFeature', id: 'nope' } })).toMatch(/^invalidCommand/);
      h.record('a command the engine refuses leaves the form alone and is reported');
      expect(await ai('execute', { command: rename('Deska') })).toBe('ok');
      h.record('a command that changes the document closes the form first');

      h.press('toolbar', 'Vysunutí');
      expect(await ai('_load', { json: '{"schemaVersion": 99}' })).toMatch(/schema version/);
      h.record('a load that fails: the form and the rest of the app are as they were');
      expect(await ai('_load', { json: JSON.stringify(emptyDocument()) })).toBe('ok');
      h.record('a load: the app starts over with the new document');
      expect(await ai('undo', {})).toBe('není co vracet');
      h.record('undo by the AI after a load has nothing to undo, and says so');
      expect(await ai('execute', { command: { type: 'setParameter', name: 'a', expr: '1' } })).toBe('ok');
      expect(await ai('undo', {})).toBe('ok');
      h.record('a command of the AI and its undo: the app follows both');

      h.press('toolbar', 'AI: připojeno');
      await until(() => !bridge.connected(), 'the app to disconnect');
      h.record('the connection is switched off');
      await matches(h, 'bridge');
    } finally {
      await bridge.close();
    }
  });
});
