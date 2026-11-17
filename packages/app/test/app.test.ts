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
import { type Command, emptyDocument, emptySketch } from '@trymesh/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBridge } from '../../mcp/src/bridge';
import { readZip } from '../../engine/test/zip-reader';
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
const SPACING = 'Spacing (mm or an expression; negative = against the direction)';
const LENGTH = 'Length (mm or an expression; negative = against the direction)';
const SECOND_COUNT = 'Count along the second direction (a whole number or an expression)';
const SECOND_SPACING = 'Second spacing (mm or an expression; negative = against the direction)';
const SECOND_LENGTH = 'Second length (mm or an expression; negative = against the direction)';
const OFFSET = 'Offset along the normal (mm or an expression)';
const PROFILE_OFFSET = 'Offset (mm or an expression; positive grows the profile; empty = none)';
const THICKNESS = 'Thickness (mm or an expression; half of it to each side of the curves)';
const TAPER = 'Taper (degrees or an expression; positive widens away from the start; empty = none)';
const GAP = 'Gap before the plane (mm or an expression; negative = past it; empty = none)';
const HEAD_DIAMETER = 'Head diameter (mm or an expression)';
const HEAD_DEPTH = 'Head depth (mm or an expression)';
const HOLE_DEPTH = 'Depth of the whole hole (mm or an expression; negative = against the normal, into the body under a face)';
const LABEL = 'Label (for people and a parts list; empty = none)';
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

  it('the fillet of a corner and the re-point of a curve (D52)', async () => {
    const h = await start();
    // a rectangle from the origin, extruded
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.press('panel', 'OK');
    doubleClick(h, 'Skica 1');
    h.record('a rectangle from the origin and its extrusion; the sketch opened again');

    h.press('toolbar', 'Fillet');
    h.record('the tool Fillet: its radius in the panel, 2 mm at first');
    h.type(h.field('Radius'), '-1');
    h.record('a radius that is not positive is marked while typing');
    h.type(h.field('Radius'), '-1', true);
    h.record('and not taken');
    h.type(h.field('Radius'), '5', true);
    h.click(at(20, 15));
    h.record('a click on no point says what the tool wants');
    h.click(point(h, 's1', pointIdAt(h, 's1', 40, 30)));
    h.record('a click on the corner: the arc, the lines shortened, the extrusion patched; the status says so');
    h.click(point(h, 's1', pointIdAt(h, 's1', 40, 30)));
    h.record('the same corner again is refused with the reason');
    h.type(h.field('Radius'), '50', true);
    h.click(at(0, 0));
    h.record('a radius the lines are too short for is refused with the bound');

    // the re-point row: a line and a point selected
    h.press('toolbar', 'Výběr');
    h.press('toolbar', 'Bod');
    h.click(at(30, 45));
    h.press('toolbar', 'Výběr');
    h.click(at(20, 0));
    h.click(at(30, 45), { shiftKey: true });
    h.record('a line and a point selected: the row Re-point offers the start and the end, the nearer chosen');
    h.choose('Point of c1', 'a');
    h.press('panel', 'Re-point');
    h.record('the start of the line re-pointed: the line keeps its ID, the region it closed is gone');
    h.key('z', { ctrlKey: true });
    h.press('toolbar', 'Kružnice');
    h.click(at(70, 10));
    h.click(at(80, 10));
    h.press('toolbar', 'Výběr');
    h.click(at(70, 20));
    h.click(at(30, 45), { shiftKey: true });
    h.record('a circle and a point: the row offers the centre only');
    h.press('panel', 'Re-point');
    h.record('the circle moved onto the point');
    h.press('toolbar', 'Oblouk');
    h.click(at(100, 10));
    h.click(at(110, 10));
    h.click(at(100, 20));
    h.press('toolbar', 'Výběr');
    h.click(at(100 + 10 * Math.SQRT1_2, 10 + 10 * Math.SQRT1_2));
    h.click(at(30, 45), { shiftKey: true });
    h.record('an arc and a point: the centre, the start and the end');
    await matches(h, 'fillet');
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

  it('an offset of a profile and a wall along curves of a sketch (D44)', async () => {
    const h = await start();
    // a rectangle and, inside it, a chain of two construction lines
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Konstrukčně');
    h.press('toolbar', 'Úsečka');
    h.click(at(10, 10));
    h.click(at(30, 10));
    h.click(at(30, 20));
    h.key('Escape');
    h.press('toolbar', 'Dokončit skicu');

    // ----- the offset of a profile of regions
    h.press('toolbar', 'Vysunutí');
    h.record('a new extrusion: the offset is empty, the draft has none');
    h.type(h.field(PROFILE_OFFSET), '-2');
    h.record('an offset typed: the profile shrinks in the preview, the draft has the field');
    h.type(h.field(PROFILE_OFFSET), '-20');
    h.record('an offset the outline does not survive: the preview says which curves vanish and what to do');
    h.type(h.field(PROFILE_OFFSET), '-2');
    h.press('panel', 'OK');
    h.record('OK: the extrusion with its offset is in the document');
    doubleClick(h, 'Vysunutí 1');
    h.record('editing: the field shows the offset');
    h.type(h.field(PROFILE_OFFSET), '');
    h.record('the field emptied: the draft has no offset and the preview is the plain outline');
    h.press('panel', 'OK');
    h.record('OK: the offset is removed from the feature');

    // ----- a wall along curves picked in the view
    h.press('toolbar', 'Vysunutí');
    h.choose('Profile', 'wall');
    h.record('the source of the profile is a wall: no curve yet, nothing to compute or confirm');
    h.move(at(20, 10));
    h.record('the curve under the pointer');
    h.click(at(20, 10));
    h.record('a click takes the curve: the engine previews a wall along it');
    h.click(at(30, 15));
    h.record('a second curve joined to the first: an L');
    h.click(at(30, 15));
    h.record('a click on a chosen curve drops it');
    h.click(at(20, 22));
    h.record('a click away from every curve chooses nothing');
    h.type(h.field(THICKNESS), '3');
    h.record('the thickness typed: the preview follows');
    h.choose('Profile', 'regions');
    h.record('to regions and');
    h.choose('Profile', 'wall');
    h.record('back: the wall is as it was');
    h.press('panel', 'Clear the curves');
    h.record('the curves dropped by the button');
    h.click(at(20, 10));
    h.click(at(30, 15));
    h.press('panel', 'OK');
    h.record('OK: the wall is a body of its own');
    h.row('Vysunutí 2').click();
    h.record('the wall selected: its summary names the thickness and the curves');
    await matches(h, 'offset');
  });

  it('a taper on the extent of an extrusion (D45)', async () => {
    const h = await start();
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.record('a new extrusion: the only region is selected, the taper is empty, the draft has none');
    h.type(h.field(TAPER), '-10');
    h.record('a taper typed in degrees: the draft has it in radians and the preview narrows');
    h.type(h.field(TAPER), '-80');
    h.record('a taper the far end does not survive: the preview says it is the far end and names the curves');
    h.type(h.field(TAPER), 'deg(-5)');
    h.press('panel', 'OK');
    h.record('OK: the extrusion with its taper is in the document');
    h.row('Vysunutí 1').click();
    h.record('selected: the summary names the taper in degrees');
    doubleClick(h, 'Vysunutí 1');
    h.record('editing: the field shows the expression');
    h.type(h.field(TAPER), '');
    h.record('the field emptied: the draft has no taper and the preview is the prism');
    h.press('panel', 'OK');
    h.record('OK: the taper is removed from the feature');
    await matches(h, 'taper');
  });

  it('an extent up to a plane or a face, picked in the view (D47)', async () => {
    const h = await start();
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Kružnice');
    h.click(at(70, 15));
    h.click(at(75, 15));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.click(at(20, 10));
    h.type(h.field(DISTANCE), '12');
    h.press('panel', 'OK');
    // the cylinder ends in the plane of the top of the plate, beside the plate itself
    h.press('toolbar', 'Vysunutí');
    h.click(at(70, 15));
    h.choose('Extent', 'upTo');
    h.record('up to a plane: no plane yet, nothing to compute or confirm; the button arms a pick');
    h.press('panel', 'Pick');
    h.record('the pick armed: the view picks faces and planes');
    h.move(at(20, 10, 12));
    h.record('the face under the pointer');
    h.click(at(20, 10, 12));
    h.record('the top face of the plate picked: the preview runs to its plane and says the length');
    h.type(h.field(GAP), '2');
    h.record('a gap typed: the cylinder stops 2 short of the plane');
    h.press('panel', 'Pick');
    h.click(at(70, 15, 10));
    h.record('the end of its own preview is refused: the plane stays, the pick stays armed');
    h.press('panel', 'Picking… (click to stop)');
    h.record('the pick disarmed: clicks pick regions again');
    h.press('panel', 'OK');
    h.record('OK: the extrusion with its plane and gap is in the document');
    h.row('Vysunutí 2').click();
    h.record('selected: the summary names the plane, the gap and the length');
    doubleClick(h, 'Vysunutí 2');
    h.type(h.field(GAP), '');
    h.press('panel', 'OK');
    h.record('the gap emptied and confirmed: removed from the feature');
    await matches(h, 'upto');
  });

  it('the kinds of a pattern: along a direction, a mirror in a plane picked in the view (D53)', async () => {
    const h = await start();
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Kružnice');
    h.click(at(10, 15));
    h.click(at(13, 15));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.click(at(30, 10));
    h.type(h.field(DISTANCE), '10');
    h.press('panel', 'OK');
    const plate = h.engine.getState().document.features[1].id;
    const sketch = h.engine.getState().document.features[0].id;
    const circle = Object.keys((h.engine.getState().document.features[0] as { curves: Record<string, { type: string }> }).curves).find((id) => (h.engine.getState().document.features[0] as { curves: Record<string, { type: string }> }).curves[id].type === 'circle') as string;
    outside(h, { type: 'addFeature', feature: { id: 'hole', name: 'Hole', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: [circle] }] }, extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: [plate] } });
    outside(h, { type: 'addFeature', feature: { id: 'mid', name: 'Mid plane', suppressed: false, type: 'plane', base: { kind: 'base', plane: 'YZ' }, offset: 50 } });
    h.record('a plate with a hole and a plane beside it');

    h.press('toolbar', 'Pattern');
    h.record('a new pattern of the hole: around an axis');
    h.choose('Kind', 'linear');
    h.record('along a direction: the axis X, a count of 3 and a spacing of 10');
    h.choose('Direction', 'sketchPoint');
    h.record('the normal of a sketch plane: no row of the point');
    h.choose('Direction', 'Y');
    h.type(h.field(SPACING), '8');
    h.record('along Y, 8 apart');
    h.choose('Span', 'length');
    h.record('a length between the first and the last copy');
    h.type(h.field(LENGTH), '20');
    h.choose('Span', 'spacing');
    h.record('back to the spacing: the one the draft had');
    h.choose('Kind', 'mirror');
    h.record('a mirror: named so, in the base plane YZ');
    h.choose('Mirror plane', 'plane:mid');
    h.record('the plane feature chosen in the list');
    h.choose('Repeat', 'body');
    h.record('a mirror of the plate: its copy beside it');
    h.press('panel', 'Pick');
    h.record('the pick armed: the view picks faces and planes');
    h.click(at(80, 15, 10));
    h.record('the top of the copy the preview made is refused: the pick stays armed');
    h.click(at(20, 25, 10));
    h.record('the top of the plate picked: the copy is its image in that plane');
    h.choose('Kind', 'circular');
    h.record('back around an axis: the transform the draft had there, named a pattern again');
    h.choose('Kind', 'mirror');
    h.record('and the mirror again: the plane it had');
    h.press('panel', 'OK');
    h.record('OK: the mirror is in the document');
    h.row('Mirror 1').click();
    h.record('selected: the summary names the plane and the body');
    doubleClick(h, 'Mirror 1');
    h.choose('Kind', 'linear');
    h.type(h.field(COUNT), '2');
    h.type(h.field(SPACING), '50');
    h.press('panel', 'OK');
    h.record('edited into a row of the plate: another kind replaces the transform; the copy keeps its ID');
    h.row('Mirror 1').click();
    h.record('the summary of a row');
    // the grid (D53): the row of the plate gets a second direction
    doubleClick(h, 'Mirror 1');
    tick(h, 'A second direction (a grid)');
    h.record('a second direction: along Y, a count of 2 and a spacing of 10; the copies 1, 1000, 1001');
    h.choose('Second direction', 'X');
    h.type(h.field(SECOND_SPACING), '50');
    h.record('along X with the step of the first: the preview says that the copies 1 and 1000 would stand in one place');
    h.choose('Second direction', 'Y');
    h.choose('Second span', 'length');
    h.type(h.field(SECOND_LENGTH), '70');
    h.type(h.field(SECOND_COUNT), '3');
    h.press('panel', 'OK');
    h.record('OK: a grid 2 × 3 over a length of 70 along Y');
    expect(h.engine.getState().evaluation.features[h.engine.getState().document.features.find((f) => f.name === 'Mirror 1')?.id as string].bodies).toHaveLength(5);
    h.row('Mirror 1').click();
    h.record('the summary of a grid');
    doubleClick(h, 'Mirror 1');
    tick(h, 'A second direction (a grid)');
    h.press('panel', 'OK');
    h.record('the checkbox cleared: a row again, the command removes the second direction by name');
    // review of D53: a direction whose point is gone can be repaired in the form
    outside(h, { type: 'addPoint', sketch, id: 'pp', x: 30, y: 25 });
    outside(h, { type: 'addFeature', feature: { id: 'lin', name: 'Row', suppressed: false, type: 'pattern', source: { type: 'features', features: ['hole'] }, transform: { type: 'linear', direction: { kind: 'sketchPoint', sketch, point: 'pp' }, count: 2, span: { type: 'spacing', spacing: 15 } } } });
    outside(h, { type: 'removeEntity', sketch, id: 'pp' });
    doubleClick(h, 'Row');
    h.record('a row along the normal of a sketch whose point is gone: the form warns and offers the origin');
    h.press('panel', 'Use the origin of the sketch');
    h.press('panel', 'OK');
    h.record('the direction repaired: the point is the origin, the row computes again (a copy up the normal of the base sketch lands on the hole through all: noEffect)');
    expect(h.engine.getState().evaluation.features.lin.status).toBe('warning');
    await matches(h, 'pattern-kinds');
  });

  it('a hole at points of a sketch on a face: the points, the kind and its fields, the extent, the label (D46)', async () => {
    const h = await start();
    h.press('toolbar', 'Hole');
    h.record('a hole needs a sketch');
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.type(h.field(DISTANCE), '10');
    h.press('panel', 'OK');
    h.click(at(20, 10, 10));
    h.press('toolbar', 'Skica');
    h.press('toolbar', 'Bod');
    h.click(at(10, 10, 10));
    h.click(at(30, 10, 10));
    h.press('toolbar', 'Dokončit skicu');
    const sketch = h.engine.getState().document.features.filter((f) => f.type === 'sketch').at(-1)?.id as string;
    const [left, right] = [pointIdAt(h, sketch, 10, 10), pointIdAt(h, sketch, 30, 10)];
    h.press('toolbar', 'Hole');
    h.record('a new hole: the latest sketch, its body the target, a plain hole through all backward, no point ticked yet');
    tick(h, left);
    h.record('a point ticked: the engine previews the hole');
    tick(h, right);
    h.choose('Kind', 'counterbore');
    h.record('a counterbore: the diameter kept, the head empty, the preview asks for it');
    h.type(h.field(HEAD_DIAMETER), '6');
    h.type(h.field(HEAD_DEPTH), '3');
    h.record('the head typed: the preview has the counterbore at both points');
    h.type(h.field(HEAD_DIAMETER), '3');
    h.record('a head not wider than the bore: the preview says why');
    h.type(h.field(HEAD_DIAMETER), '6');
    h.choose('Extent', 'distance');
    h.type(h.field(HOLE_DEPTH), '-2');
    h.record('a blind hole as deep as its head: refused by the preview');
    h.type(h.field(HOLE_DEPTH), '-6');
    h.type(h.field(LABEL), 'M3 socket head cap screw');
    h.press('panel', 'OK');
    h.record('OK: the hole is in the document with its label');
    h.row('Hole 1').click();
    h.record('selected: the summary names the label, the shape, the depth and the points; its faces are highlighted');
    doubleClick(h, 'Hole 1');
    h.choose('For', 'countersunk');
    h.record('from the catalog for a countersunk screw: the sizes both of its catalogs have (no M3.5)');
    h.type(h.field('Allowance (an expression added to the diameters, such as a parameter; empty = none)'), '0.2');
    h.press('panel', 'Fill from the catalog');
    h.record('filled from the catalog: a countersink with the allowance in its diameters, the angle in degrees, the label; the extent stays and the status line says so');
    h.type(h.field('Start of the mouth (mm or an expression; offset from the sketch plane along its normal)'), '1');
    h.choose('For', 'heatSetInsert');
    h.choose('Size', 'M3x4x4.5');
    h.press('panel', 'Fill from the catalog');
    h.record('filled for a heat-set insert: a plain hole, the depth of the insert as the distance, the start and the direction kept');
    h.type(h.field('Allowance (an expression added to the diameters, such as a parameter; empty = none)'), '0.2 +');
    h.press('panel', 'Fill from the catalog');
    h.record('an allowance that is no expression: the status line says why, the draft stays');
    h.choose('Kind', 'plain');
    h.type(h.field(LABEL), '');
    h.press('panel', 'OK');
    h.record('edited: a plain hole without a label');
    await matches(h, 'hole');
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

  it('the properties of a body: the form, the line of the body, the view, the export, an entry whose body is gone (D48)', async () => {
    const h = await start();
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Dokončit skicu');
    h.press('toolbar', 'Vysunutí');
    h.press('panel', 'OK');
    const body = h.engine.getState().evaluation.features[h.engine.getState().document.features[1].id].bodies[0];
    h.row('Vysunutí 1').click();
    h.record('the extrusion selected: the form of the properties of its body, empty, with the defaults as placeholders');
    h.choose('Material from the catalog', 'PETG');
    h.record('PETG from the catalog: the label and the density of the data sheet in the document; the line of the body has the material and the mass');
    h.type(h.field('Name'), 'Base plate', true);
    h.record('a name: the line, the form and the heading use it');
    h.type(h.field('Density (g/cm3)'), 'nope * 2', true);
    h.record('a density that does not evaluate: refused, the status line says why');
    h.type(h.field('Mass (g)'), '280', true);
    h.choose('Use', 'reference');
    h.record('a weighed mass and the use reference: the mass wins over the density, the export of the model has no printed body');
    h.type(h.field('Colour'), '#30343A', true);
    h.record('a colour: stored in lower case, the view draws the body in it');
    h.choose('Use', 'auxiliary');
    h.record('auxiliary: the view draws it see-through, it has no mass');
    h.press('panel', 'Smazat');
    h.record('the extrusion deleted: its properties stay, listed as without a body');
    h.press('panel', 'Remove');
    h.record('removed: the document has no properties');
    h.engine.undo();
    h.engine.undo();
    h.record('undo twice: the extrusion and its properties are back');
    expect(Object.keys(h.engine.getState().document.bodyProperties)).toEqual([body]);
    h.row('Vysunutí 1').click();
    h.press('panel', 'Clear the properties');
    h.record('the properties cleared by the button of the form');
    // A copy made by a pattern of the body: its form offers the use of its source, read from the
    // result of the source, not its own use.
    outside(h, { type: 'addFeature', feature: { id: 'pat', name: 'Pattern', suppressed: false, type: 'pattern', source: { type: 'body', body }, transform: { type: 'circular', axis: { kind: 'base', axis: 'Z' }, count: 2, span: { type: 'full' } } } });
    outside(h, { type: 'setBodyProperties', body: 'pat/1', patch: { use: 'reference' } });
    h.row('Vysunutí 1').click(); // the extrusion no longer selected on the timeline: the form is that of the face picked
    h.click(at(-20, -15, 10));
    h.record('a face of the copy selected: its form says it is a copy, its own use is reference, the empty choice is the use of its source');
    const useOf = () => Array.from((h.field('Use') as HTMLSelectElement).options).map((option) => option.textContent);
    expect(useOf()[0]).toBe('As its source: Printed part');
    outside(h, { type: 'setBodyProperties', body, patch: { use: 'auxiliary' } });
    h.record('the source made auxiliary: the empty choice of the copy follows it');
    expect(useOf()[0]).toBe('As its source: Auxiliary (no mass, not printed)');
    h.choose('Use', '');
    h.record('the empty choice: the copy has no use of its own and takes that of its source');
    expect(h.engine.getState().evaluation.bodyProperties['pat/1'].use).toBe('auxiliary');
    await matches(h, 'properties');
  });

  it('the mechanism: links and a joint made in the panel, the slider, the pose in the view, the query as modelled, a blocked link (D49)', async () => {
    const h = await threeBodies();
    h.record('a model of three bodies: the panel of the mechanism offers a new link');
    h.press('panel', 'New link');
    h.record('the form of a new link: a generated ID, a name, the bodies of the model');
    h.type(h.field('Name (empty: the ID)'), 'Base');
    tick(h, 'Vysunutí 1');
    h.press('panel', 'OK');
    h.record('the link Base with the plate: one setLink; the other bodies are in no link');
    h.press('panel', 'New link');
    h.type(h.field('Name (empty: the ID)'), 'Arm');
    tick(h, 'Vysunutí 3');
    h.press('panel', 'OK');
    h.record('the link Arm with the third body');
    h.press('panel', 'New joint');
    h.record('the form of a new joint: revolute about Z, the parent the first link, the child the next one');
    h.type(h.field('Name (empty: the ID)'), 'Elbow');
    h.type(h.field('Lower limit (° or an expression in radians)'), '-90');
    h.type(h.field('Upper limit (° or an expression in radians)'), '90');
    h.press('panel', 'OK');
    h.record('the joint Elbow: one setJoint; the tree has Arm under Elbow under Base');

    // ----- the slider: a preview while dragged, one command when released
    const slider = (): HTMLInputElement => {
      const found = h.document.querySelector<HTMLInputElement>('#panel input.pose');
      if (!found) throw new Error('there is no slider');
      return found;
    };
    h.type(slider(), '45');
    h.record('the slider dragged to 45°: a preview, the view shows the arm turned, the document is unchanged');
    expect(h.engine.getState().document.mechanism.joints.joint1).toMatchObject({ value: 0 });
    h.type(slider(), '90');
    h.type(slider(), '90', true);
    h.record('the slider released at 90°: one setPose, the status line says the view shows the pose');
    expect(h.engine.getState().document.mechanism.joints.joint1).toMatchObject({ value: Math.PI / 2 });
    h.press('toolbar', '↶ Zpět');
    h.record('undo: the drag was one step, the arm is back as modelled');
    expect(h.engine.getState().document.mechanism.joints.joint1).toMatchObject({ value: 0 });
    h.press('toolbar', '↷ Znovu');
    h.record('redo: turned again');
    h.click(at(-17.5, 45, 8));
    h.record('a click where the turned arm is drawn picks its top face');
    h.key('Escape');
    h.press('toolbar', 'Save picture');
    await until(() => h.downloads.length > 0, 'the picture to be saved');
    h.record('a picture of the model: the arm in the pose');

    // ----- the collisions in the pose and as modelled
    h.press('toolbar', 'Collisions');
    h.record('the collisions are asked in the pose: the turned arm touches nothing; the form offers "As modelled"');
    tick(h, 'As modelled');
    h.press('panel', 'Ask again');
    h.record('asked as modelled: the plate and the arm collide, and the view shows the model as modelled while the answer is shown');
    h.press('panel', 'Close');
    h.record('the query closed: the view shows the pose again');
    h.type(slider(), '45', true);
    h.press('toolbar', 'Collisions');
    (h.document.querySelector('#panel div.row') as HTMLElement).click();
    h.record('at 45° the arm reaches into the plate: the pair picked, its two bodies highlighted where the pose puts them');
    h.press('panel', 'Close');
    h.type(slider(), '90', true);

    // ----- a sketch is edited as modelled
    doubleClick(h, 'Skica 2');
    h.record('in the sketch the view shows the model as modelled, and the status line says so');
    h.press('toolbar', 'Dokončit skicu');
    h.record('back in the model: the pose');

    // ----- the value by an expression, a value out of the limits that blocks the link
    outside(h, { type: 'setParameter', name: 'q', expr: '0.5' });
    h.type(h.field('Angle (° or an expression in radians)'), 'q', true);
    h.record('the value follows the parameter q: the slider is disabled, the field shows the expression and its value');
    outside(h, { type: 'setParameter', name: 'q', expr: '3' });
    h.record('q = 3 is outside the limits: the joint is in error, the arm is drawn with it at zero and marked, the status line names the joint');
    h.press('toolbar', 'Collisions');
    h.record('the collisions cannot be asked in the pose: the arm is blocked, the form says why');
    tick(h, 'As modelled');
    h.press('panel', 'Ask again');
    h.record('as modelled they can: the plate and the arm collide there');
    h.press('panel', 'Close');
    h.type(h.field('Angle (° or an expression in radians)'), '30', true);
    h.record('a number typed into the field replaces the expression: the arm is posed again');
    h.press('panel', 'Reset pose');
    h.record('reset pose: one setPose, every value without an expression to zero');

    // ----- the marker, the state before the first feature, removing
    h.rowIcon('Vysunutí 1', '⇤');
    h.record('the marker after the plate: the mechanism of that state, the arm has no body there');
    h.press('timeline', 'Zobrazit celý model');
    const before = (h.app as { stateBefore(index: number): import('@trymesh/engine').EngineState }).stateBefore(0).evaluation.mechanism;
    expect(before.links.link1).toMatchObject({ bodies: [], missing: ['e1'] });
    expect(before.unassigned).toEqual([]);
    h.press('panel', 'Remove');
    h.record('removing the link Base, which the joint names, is refused with the reason');
    h.press('panel', 'Edit', 1);
    h.record('the form of the joint, filled in from the document');
    h.choose('Kind', 'prismatic');
    h.record('another kind: the numbers start from the defaults of its unit');
    h.press('panel', 'Cancel');
    h.press('panel', 'Remove', 1);
    h.record('the joint removed: one removeJoint, the arm stands as modelled');
    await matches(h, 'mechanism');
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

  it('the export form: a format from the menu, a face picked into its plane, an export with nothing in it, a refusal, a set as one ZIP, the state at the marker (D54)', async () => {
    const h = await start();
    const saved = vi.spyOn(URL, 'createObjectURL');
    const savedBytes = async (index: number): Promise<Uint8Array> => new Uint8Array(await (saved.mock.calls[index][0] as Blob).arrayBuffer());
    const exportMenu = (): HTMLSelectElement => h.document.querySelectorAll<HTMLSelectElement>('#toolbar select')[1];
    try {
      h.press('toolbar', 'Skica');
      h.press('panel', 'XY');
      h.press('toolbar', 'Obdélník');
      h.click(at(0, 0));
      h.click(at(40, 30));
      h.press('toolbar', 'Dokončit skicu');
      h.press('toolbar', 'Vysunutí');
      h.press('panel', 'OK');
      outside(h, { type: 'addFeature', feature: { id: 'top', name: 'Top', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's1', regions: [{ outerLoop: ['c1', 'c2', 'c3', 'c4'] }] }, extent: { type: 'distance', start: -20, distance: 5 }, operation: 'new' } });
      h.record('a plate and a second body under it; the menu Export… beside the queries');
      h.type(exportMenu(), 'dxf', true);
      h.record('DXF opened from the menu: its options, the plane armed');
      h.click(at(10, 15, 10));
      h.record('a click on the top face of the plate goes to the armed plane, not to the selection');
      h.type(h.field('Offset (optional)'), '-1', true);
      h.press('panel', 'Export');
      h.record('exported a millimetre under the face: the outline of the plate saved under its suggested name, its size in the status line');
      expect(new TextDecoder().decode(await savedBytes(0))).toContain('POLYLINE');
      h.type(h.field('Offset (optional)'), '1', true);
      h.press('panel', 'Export');
      h.record('a millimetre above the face: nothing is cut, the text of the export stays in the form, nothing is saved');
      expect(saved.mock.calls.length).toBe(1);
      h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'body', true);
      h.record('a query opened: the export form closes, one form at a time');
      h.type(exportMenu(), 'svg', true);
      h.record('SVG opened: the query closes');
      h.press('panel', 'Export');
      h.record('exported without a plane: refused by the engine, the row of the plane marked');
      h.type(exportMenu(), 'stl', true);
      const perBody = h.field('A file per body (optional)') as HTMLInputElement;
      perBody.checked = true;
      h.type(perBody, '', true);
      h.press('panel', 'Export');
      h.record('STL with a file per body: the set saved as one ZIP');
      expect(readZip(await savedBytes(1)).map((entry) => entry.name)).toEqual(['e1.stl', 'top.stl']);
      h.type(exportMenu(), '3mf', true);
      h.rowIcon('Vysunutí 1', '⇤');
      h.press('panel', 'Export');
      h.record('3MF with the marker after the plate: the state there, the plate alone');
      h.press('timeline', 'Zobrazit celý model');
      h.press('panel', 'Export');
      h.record('3MF at the end of the timeline: no `at`, both bodies');
      expect(readZip(await savedBytes(3)).map((entry) => entry.name)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
      h.press('panel', 'Close');
      h.record('the form closed');
    } finally {
      saved.mockRestore();
    }
    await matches(h, 'export');
  });

  it('the parts list: asked as its form opens, the three groups, a picked row of bodies and of hardware, the sums; the table as a file (D57)', async () => {
    const h = await start();
    const saved = vi.spyOn(URL, 'createObjectURL');
    const exportMenu = (): HTMLSelectElement => h.document.querySelectorAll<HTMLSelectElement>('#toolbar select')[1];
    const rows = (): HTMLElement[] => Array.from(h.document.querySelectorAll('#panel .row')) as HTMLElement[];
    try {
      const XY = { kind: 'base', plane: 'XY' } as const;
      const corners: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
      const extrude = (id: string, sketch: string, loop: string[], start: number, distance: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch, regions: [{ outerLoop: loop }] }, extent: { type: 'distance', start, distance }, operation: 'new' } });
      // a plate with a labelled hole, in a row of three; a motor bought with the mass of its data
      // sheet; a body kept free, which is no part
      outside(h, {
        type: 'batch',
        commands: [
          { type: 'addFeature', feature: emptySketch('s', 's', XY) },
          ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch: 's', id: `p${i}`, x, y })),
          ...corners.map((_, i): Command => ({ type: 'addCurve', sketch: 's', id: `l${i}`, curve: { type: 'line', a: `p${i}`, b: `p${(i + 1) % 4}` } })),
          extrude('plate', 's', ['l0', 'l1', 'l2', 'l3'], 0, 5),
          { type: 'addFeature', feature: emptySketch('hs', 'hs', XY) },
          { type: 'addPoint', sketch: 'hs', id: 'q', x: 10, y: 10 },
          { type: 'addFeature', feature: { id: 'holes', name: 'Holes', suppressed: false, type: 'hole', sketch: 'hs', points: ['q'], shape: { type: 'plain', diameter: 3.4 }, extent: { type: 'distance', start: 5, distance: -6 }, targets: ['plate'], label: 'M3x8 screw' } },
          { type: 'addFeature', feature: { id: 'row', name: 'Row', suppressed: false, type: 'pattern', source: { type: 'body', body: 'plate' }, transform: { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 3, span: { type: 'spacing', spacing: 50 } } } },
          { type: 'addFeature', feature: emptySketch('ms', 'ms', XY) },
          { type: 'addPoint', sketch: 'ms', id: 'mc', x: 20, y: 60 },
          { type: 'addCurve', sketch: 'ms', id: 'mk', curve: { type: 'circle', center: 'mc' }, radius: 8 },
          extrude('motor', 'ms', ['mk'], 0, 20),
          extrude('keep', 'ms', ['mk'], 30, 10),
          { type: 'setBodyMaterial', body: 'plate', material: 'PLA' },
          { type: 'setBodyProperties', body: 'motor', patch: { name: 'Motor', color: '#30343a', use: 'reference', mass: 60 } },
          { type: 'setBodyProperties', body: 'keep', patch: { use: 'auxiliary' } },
        ],
      });
      h.record('a plate with a labelled hole in a row of three, a motor bought, a body kept free');
      h.type(h.document.querySelector('#toolbar select') as HTMLSelectElement, 'partsList', true);
      h.record('the parts list opened: asked at once; to print, to buy, the hardware, the sums, the body that is no part; the note counts the three');
      rows()[0].click();
      h.record('the row of the plate picked: its three bodies drawn in the colour of a selection');
      rows()[2].click();
      h.record('the row of the screws picked: the bores of the hole feature painted in the three plates');
      outside(h, { type: 'setBodyProperties', body: 'row/2', patch: { color: '#000000' } });
      h.press('panel', 'Ask');
      h.record('a copy painted black and asked again: a row of its own, with a patch of its colour, a copy of the plate');
      h.press('panel', 'Close');
      h.type(exportMenu(), 'partsCsv', true);
      h.record('the export Parts list (CSV) opened: no option, its button alone');
      h.press('panel', 'Export');
      h.record('exported: the table saved under its suggested name');
      const text = await (saved.mock.calls[0][0] as Blob).text();
      expect(text.split('\r\n')).toEqual([
        'Kind,Name,Count,Material,Colour,Mass each (g),Mass total (g),Note,IDs',
        expect.stringMatching(/^printed,plate,2,PLA,,[0-9.]+,[0-9.]+,,plate row\/1$/),
        expect.stringMatching(/^printed,plate,1,PLA,#000000,[0-9.]+,[0-9.]+,copy of plate,row\/2$/),
        'bought,Motor,1,,#30343a,60,60,,motor',
        'hardware,M3x8 screw,3,,,,,,holes',
        '',
      ]);
      h.press('panel', 'Close');
    } finally {
      saved.mockRestore();
    }
    await matches(h, 'parts-list');
  });

  it('a bought part from an STL file: the form, the import, the placement on a point of a sketch, a reference part, the stored meshes in the panel (D55)', async () => {
    const h = await start();
    // a tetrahedron, its four faces outwards, as binary STL
    const corners = [
      [0, 0, 0, 0, 10, 0, 10, 0, 0],
      [0, 0, 0, 10, 0, 0, 0, 0, 10],
      [0, 0, 0, 0, 0, 10, 0, 10, 0],
      [10, 0, 0, 0, 10, 0, 0, 0, 10],
    ];
    const bytes = new Uint8Array(84 + 50 * corners.length);
    const data = new DataView(bytes.buffer);
    data.setUint32(80, corners.length, true);
    corners.forEach((triangle, t) => triangle.forEach((value, k) => data.setFloat32(84 + 50 * t + 12 + 4 * k, value, true)));
    const choose = async (name: string, content: Uint8Array<ArrayBuffer>): Promise<void> => {
      const input = h.document.getElementById('mesh-file') as HTMLInputElement;
      const FileOf = (h.document.defaultView as unknown as { File: typeof File }).File;
      Object.defineProperty(input, 'files', { value: [new FileOf([content], name)], configurable: true });
      const before = Object.keys(h.engine.getState().document.meshes).length;
      const status = h.document.getElementById('status') as HTMLElement;
      const said = status.textContent;
      h.type(input, '', true);
      await until(() => Object.keys(h.engine.getState().document.meshes).length > before || status.textContent !== said, 'the import');
    };
    h.press('toolbar', 'Skica');
    h.press('panel', 'XY');
    h.press('toolbar', 'Obdélník');
    h.click(at(0, 0));
    h.click(at(40, 30));
    h.press('toolbar', 'Dokončit skicu');
    h.record('a sketch with a rectangle: its corners are points a frame can be');
    h.press('toolbar', 'Mesh');
    h.record('the button Mesh without a stored mesh: the form says to import a file, OK is disabled');
    await choose('broken.stl', bytes.slice(0, 100));
    h.record('a file that is no STL: the status line says why, nothing is stored');
    await choose('tetra 1.stl', bytes);
    h.record('the tetrahedron imported: one undo step (addMesh), the report in the status line, the form uses it, the preview places it on XY');
    h.choose('Frame', 'point');
    h.record('a point of a sketch as the frame: the latest sketch, its origin');
    const corner = Object.keys((h.engine.getState().document.features[0] as { points: Record<string, unknown> }).points)[2];
    h.choose('Point', corner);
    h.type(h.field(OFFSET), '5');
    h.type(h.field('Turn about the normal (° or an expression in radians)'), '90');
    h.timers();
    h.record('a corner of the rectangle, 5 mm up, turned by 90°: the facts of the preview say where the origin and the axes are');
    h.press('panel', 'OK');
    h.record('confirmed: one batch, the feature and the use reference (a bought part)');
    expect(h.engine.getState().evaluation.bodyProperties.m1?.use).toBe('reference');
    doubleClick(h, 'Mesh 1');
    h.record('the feature edited: every number shown, a zero for one it does not have, no box of a bought part');
    h.type(h.field('Turn about the normal (° or an expression in radians)'), '0');
    h.timers();
    h.press('panel', 'OK');
    h.record('the turn set back to zero: the patch removes it');
    expect(h.engine.getState().document.features[1]).toMatchObject({ placement: { z: 5 } });
    expect('rz' in (h.engine.getState().document.features[1] as { placement: object }).placement).toBe(false);
    h.row('Mesh 1').click();
    h.press('panel', 'Smazat');
    h.record('the feature deleted: the stored mesh is not placed, the panel offers to remove it');
    titled(h, 'Remove the stored mesh from the document').click();
    h.record('the stored mesh removed; the properties of the body stay, listed as without a body');
    expect(h.engine.getState().document.meshes).toEqual({});
    await matches(h, 'mesh');
  });
});
