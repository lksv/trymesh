// A harness for tests of the class `App`: the real engine with the real adapters, a DOM from
// happy-dom, and a stand-in for the view (a DOM without layout and without WebGL cannot run the
// real one). After every step of a test it writes down what the app did and what a user sees.
//
// The test runs in the Node environment and makes the window itself: the adapters load their WASM
// as in Node, and only then the globals the app reads (`window`, `document`) are set.
import { createPakoDeflater } from '@trymesh/deflate-pako';
import { type Command, type Document, type Engine, type Frame, type Id, type RigidTransform, type Vec3, createEngine } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { Window } from 'happy-dom';
import type { BodyHit, Picture, PictureCamera, PictureModel, SceneModel, View } from '../src/viewport';

const deps = { solver: await createPlanegcsSolver(), kernel: await createManifoldKernel(), deflater: createPakoDeflater() };

// ---------------------------------------------------------------- the view

// One fixed parallel camera that looks down at a slant, so that the top of a body and its sides
// towards -X and -Y can be picked. A point of the window is where its ray pierces the plane z = 0,
// and one pixel is one millimetre.
const LOOK: Vec3 = (() => {
  const d: Vec3 = [0.3, 0.4, -1];
  const length = Math.hypot(...d);
  return [d[0] / length, d[1] / length, d[2] / length];
})();
const FAR = 1000;
// Where a point of the model is in the window.
export function client(world: Vec3): { x: number; y: number; depth: number } {
  const t = world[2] / LOOK[2];
  return { x: world[0] - t * LOOK[0], y: world[1] - t * LOOK[1], depth: FAR + t };
}
export const onPlane = (frame: Frame, u: number, v: number): { x: number; y: number } => client([frame.origin[0] + u * frame.x[0] + v * frame.y[0], frame.origin[1] + u * frame.x[1] + v * frame.y[1], frame.origin[2] + u * frame.x[2] + v * frame.y[2]]);

export class StubView implements View {
  readonly element: HTMLElement;
  scene: SceneModel = { bodies: [], lines: [], points: [], fills: [], faces: [], labels: [] };
  scenes = 0; // scenes set since the last record
  calls: string[] = []; // lookAt, fit and image since the last record
  failing?: string; // a picture fails with this, as a browser without WebGL would

  constructor(container: HTMLElement) {
    this.element = container.ownerDocument.createElement('canvas');
    container.append(this.element);
  }
  setScene(model: SceneModel): void {
    this.scene = model;
    this.scenes += 1;
  }
  ray(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } {
    return { origin: [clientX - FAR * LOOK[0], clientY - FAR * LOOK[1], -FAR * LOOK[2]], direction: LOOK };
  }
  // The nearest triangle of the bodies of the scene under the ray, each where its transform puts it
  // (the pose of the mechanism); of a cut model, the nearest point that is not cut away (the bodies
  // are then drawn two-sided, and this view hits a triangle from either side anyway).
  pickBody(clientX: number, clientY: number): BodyHit | undefined {
    const { origin, direction } = this.ray(clientX, clientY);
    const clip = this.scene.clip;
    let best: BodyHit | undefined;
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const { id, solid, transform } of this.scene.bodies) {
      const corner = (index: number): Vec3 => placed(transform, [solid.positions[3 * index], solid.positions[3 * index + 1], solid.positions[3 * index + 2]]);
      for (let triangle = 0; triangle < solid.triangles.length / 3; triangle++) {
        const [a, b, c] = [corner(solid.triangles[3 * triangle]), corner(solid.triangles[3 * triangle + 1]), corner(solid.triangles[3 * triangle + 2])];
        const [e1, e2] = [sub(b, a), sub(c, a)];
        const p = cross(direction, e2);
        const det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const s = sub(origin, a);
        const u = dot(s, p) / det;
        const q = cross(s, e1);
        const v = dot(direction, q) / det;
        const depth = dot(e2, q) / det;
        if (u < 0 || v < 0 || u + v > 1 || depth <= 0 || (best && depth >= best.depth)) continue;
        const point: Vec3 = [origin[0] + depth * direction[0], origin[1] + depth * direction[1], origin[2] + depth * direction[2]];
        if (clip && dot(sub(point, clip.origin), clip.normal) > 0) continue;
        best = { body: id, triangle, point, depth };
      }
    }
    return best;
  }
  projector(): (x: number, y: number, z: number) => { x: number; y: number; depth: number } {
    return (x, y, z) => client([x, y, z]);
  }
  pixelSize(): number {
    return 1;
  }
  lookAt(frame: Frame): void {
    this.calls.push(`lookAt origin ${numbers(frame.origin)} normal ${numbers(frame.normal)}`);
  }
  fit(min: Vec3, max: Vec3): void {
    this.calls.push(`fit ${numbers(min)} .. ${numbers(max)}`);
  }
  // A picture is not drawn here: what the view was asked to draw is written down, and the answer
  // is a few bytes ("PNG" in base64) at a quarter of a millimetre per pixel.
  async image(model: PictureModel, camera: PictureCamera, width: number, height: number): Promise<Picture> {
    if (this.failing) throw new Error(this.failing);
    const colours = model.bodies.map((body) => `#${body.color.toString(16).padStart(6, '0')}`).join(' ');
    const fills = model.fills.map((fill) => `#${fill.color.toString(16).padStart(6, '0')}`).join(' ');
    const segments = model.lines.reduce((sum, set) => sum + set.segments.length / 6, 0);
    const cut = model.clip ? `, cut at ${numbers(model.clip.origin)} normal ${numbers(model.clip.normal)}, ${model.fills.length} fill(s) ${fills}` : '';
    const posed = model.bodies.filter((body) => body.transform).map((body) => `${hex(body.color)} ${transformText(body.transform as RigidTransform)}`);
    this.calls.push(`image ${width} × ${height}, camera ${camera === 'current' ? 'current' : `from ${numbers(camera.from)} up ${numbers(camera.up)}`}, ${model.bodies.length} bodies ${colours}, ${segments} segments${cut}${posed.length ? `, posed: ${posed.join(', ')}` : ''}`);
    return { base64: 'UE5H', scale: 0.25 };
  }
}

// ---------------------------------------------------------------- writing things down

const round = (value: number): number => {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded; // no -0
};
const numbers = (values: ArrayLike<number>): string => `[${Array.from(values, round).join(', ')}]`;
// A list of coordinates as its length and a sum that depends on the order.
const digest = (values: ArrayLike<number>): string => `${values.length} numbers, sum ${round(Array.from(values).reduce((sum, value, i) => sum + value * ((i % 7) + 1), 0))}`;
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
// A point where a transform puts it; without one, as it is.
const placed = (t: RigidTransform | undefined, p: Vec3): Vec3 => (t ? [0, 1, 2].map((row) => t.matrix[row][0] * p[0] + t.matrix[row][1] * p[1] + t.matrix[row][2] * p[2] + t.translation[row]) as Vec3 : p);
// The pose of a body in the scene (D49): the rows of the matrix and the shift.
const transformText = (t: RigidTransform): string => `posed ${t.matrix.map((row) => numbers(row)).join(' ')} + ${numbers(t.translation)}`;

function sceneText(scene: SceneModel): string[] {
  const owner = (solid: unknown): string => scene.bodies.find((body) => body.solid === solid)?.id ?? '(a body that is not shown)';
  return [
    `bodies: ${scene.bodies.map((body) => `${body.id}${body.color === undefined ? '' : ` ${hex(body.color)}`}${body.opacity === undefined ? '' : ` opacity ${body.opacity}`}${body.transform ? ` ${transformText(body.transform)}` : ''}`).join(', ') || '(none)'}`,
    ...(scene.clip ? [`clip: cut away above ${numbers(scene.clip.origin)} along ${numbers(scene.clip.normal)}`] : []),
    ...scene.lines.filter((set) => set.segments.length > 0).map((set) => `line ${hex(set.color)} width ${set.width}${set.dashed ? ' dashed' : ''}${set.onTop ? ' onTop' : ''}${set.overFills ? ' overFills' : ''}: ${digest(set.segments)}`),
    ...scene.points.filter((set) => set.positions.length > 0).map((set) => `points ${hex(set.color)} size ${set.size}: ${digest(set.positions)}`),
    ...scene.fills.map((fill) => `fill ${hex(fill.color)} opacity ${fill.opacity}${fill.onTop ? ' onTop' : ''} at ${numbers(fill.frame.origin)} normal ${numbers(fill.frame.normal)}: ${fill.loops.map((loop) => digest(loop)).join(' | ')}`),
    ...scene.faces.map((face) => `face ${owner(face.solid)} #${face.faceId} ${hex(face.color)} opacity ${face.opacity}${face.transform ? ' posed with its body' : ''}`),
    ...scene.labels.map((label) => `label "${label.text}" ${label.tone ?? ''} at ${numbers(label.at)}`),
  ];
}

// An element as a user meets it: its text, the value of a control, whether it is disabled, its
// class and its title.
function domText(node: Node, indent = ''): string[] {
  if (node.nodeType === 3) return node.textContent?.trim() ? [`${indent}"${node.textContent.trim()}"`] : [];
  if (node.nodeType !== 1) return [];
  const element = node as HTMLElement;
  const control = element as HTMLInputElement;
  const tag = element.tagName.toLowerCase();
  const marks = [
    element.id ? `#${element.id}` : '',
    element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : '',
    tag === 'input' && control.type !== 'text' ? ` type=${control.type}` : '',
    tag === 'input' && control.type !== 'checkbox' && control.type !== 'file' ? ` value="${control.value}"` : '',
    tag === 'input' && control.type === 'checkbox' ? (control.checked ? ' checked' : ' unchecked') : '',
    tag === 'input' && control.placeholder ? ` placeholder="${control.placeholder}"` : '',
    tag === 'select' ? ` value="${control.value}"` : '',
    tag === 'option' && (element as HTMLOptionElement).selected ? ' selected' : '',
    tag === 'option' ? ` value="${control.value}"` : '',
    control.disabled === true ? ' disabled' : '',
    element.hidden ? ' hidden' : '',
    element.title ? ` title="${element.title}"` : '',
    ...Object.entries(element.dataset ?? {}).map(([name, value]) => ` data-${name}="${value}"`),
  ].join('');
  const children = Array.from(element.childNodes);
  const only = children.length === 1 && children[0].nodeType === 3 ? children[0].textContent?.trim() : undefined;
  if (only !== undefined) return [`${indent}${tag}${marks}${only ? `: "${only}"` : ''}`];
  return [`${indent}${tag}${marks}`, ...children.flatMap((child) => domText(child, `${indent}  `))];
}

// A feature as lines: a sketch has a line per point, curve, constraint and projection, so that
// a change shows as the lines that changed. The solution a sketch keeps is the engine's and
// changes with every edit, so it is left out.
function featureLines(feature: Document['features'][number]): string[] {
  if (feature.type !== 'sketch') return [JSON.stringify(feature)];
  const { points, radii, curves, constraints, external, expressions, solved: _solved, ...head } = feature;
  const group = (name: string, entries: Record<string, unknown> | undefined): string[] => Object.entries(entries ?? {}).map(([id, value]) => `${name} ${id}: ${JSON.stringify(value)}`);
  return [JSON.stringify(head), ...group('point', points), ...group('radius', radii), ...group('curve', curves), ...group('constraint', constraints), ...group('external', external), ...group('expression', expressions)];
}

// What changed between two lists of lines: the lines that went (`-`) and the lines that came
// (`+`), in order. A list written for the first time is written whole.
function changes(before: string[] | undefined, now: string[]): string[] {
  if (before === undefined) return now.map((line) => `  ${line}`);
  const [n, m] = [before.length, now.length];
  const common = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) common[i][j] = before[i] === now[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  const out: string[] = [];
  for (let i = 0, j = 0; i < n || j < m; ) {
    if (i < n && j < m && before[i] === now[j]) [i, j] = [i + 1, j + 1];
    else if (j < m && (i === n || common[i][j + 1] >= common[i + 1][j])) out.push(`+ ${now[j++]}`);
    else out.push(`- ${before[i++]}`);
  }
  return out;
}

// ---------------------------------------------------------------- the harness

export interface Harness {
  app: unknown;
  engine: Engine; // the engine the app got: every call on it is written down
  view: StubView;
  document: globalThis.Document;
  // What happened and what is shown since the last record, under a title.
  record(title: string): void;
  text(): string; // everything recorded
  // ----- acting as a user
  button(where: Region, text: string, nth?: number): HTMLButtonElement;
  press(where: Region, text: string, nth?: number): void; // a click on a button
  field(label: string, nth?: number): HTMLInputElement | HTMLSelectElement; // the control inside the label with this text
  type(input: HTMLInputElement | HTMLSelectElement, value: string, commit?: boolean): void; // typing into a field; `commit`: leaving it
  choose(label: string, value: string): void; // a select by its label
  row(name: string): HTMLElement; // a row of the timeline
  rowIcon(name: string, icon: string): void;
  move(at: { x: number; y: number }, extra?: PointerEventInit): void;
  down(at: { x: number; y: number }, extra?: PointerEventInit): void;
  up(at: { x: number; y: number }, extra?: PointerEventInit): void;
  click(at: { x: number; y: number }, extra?: PointerEventInit): void; // move, down, up
  pointer(type: string, at: { x: number; y: number }, extra?: PointerEventInit): void;
  key(key: string, extra?: KeyboardEventInit): void;
  // ----- the clock and the timers of the app
  tick: number; // how long a preview of a draft takes from now on, in ms of the pinned clock
  timers(): number; // runs the timers the app set through `window.setTimeout`; returns how many
  downloads: string[];
  close(): void;
}
export type Region = 'toolbar' | 'timeline' | 'panel';

const SHELL = '<div id="app"><header id="toolbar"></header><aside id="timeline"></aside><main id="viewport"></main><aside id="panel"></aside><footer id="status"></footer></div>';

export async function startApp(): Promise<Harness> {
  const window = new Window();
  window.document.body.innerHTML = SHELL;
  const document = window.document as unknown as globalThis.Document;
  const real = { now: performance.now };
  Object.assign(globalThis, { window, document });

  // the timers of the app, run by the test
  let timerId = 0;
  const pending = new Map<number, () => void>();
  Object.assign(window, {
    setTimeout: (run: () => void) => (pending.set(++timerId, run), timerId),
    clearTimeout: (id: number) => void pending.delete(id),
  });
  // the clock: every reading is `tick` later than the one before, so a preview takes `tick`
  let clock = 0;
  const harness = { tick: 0 } as Harness;
  performance.now = () => (clock += harness.tick);
  // a download is a click on a link that is not in the page
  const downloads: string[] = [];
  (window.HTMLAnchorElement.prototype as unknown as { click(this: HTMLAnchorElement): void }).click = function () {
    downloads.push(this.download);
  };

  const calls: string[] = [];
  const inner = createEngine(deps);
  const outcome = (result: unknown): string => {
    const answer = result as { ok?: boolean; error?: { code: string; message: string } } | undefined;
    return answer && typeof answer === 'object' && 'ok' in answer ? (answer.ok ? ' -> ok' : ` -> ${answer.error?.code}: ${answer.error?.message}`) : '';
  };
  // Reading the current state costs nothing and the class does it dozens of times per refresh, so
  // it is not written down; a state after a feature is computed, and is.
  const engine = Object.fromEntries(
    (Object.keys(inner) as (keyof Engine)[]).map((name) => [
      name,
      (...args: unknown[]) => {
        const result = (inner[name] as (...given: unknown[]) => unknown)(...args);
        if (name === 'subscribe' || (name === 'getState' && args[0] === undefined)) return result;
        const shown = args.map((arg) => (typeof arg === 'string' && arg.length > 200 ? `"(${arg.length} characters)"` : JSON.stringify(arg))).join(', ');
        calls.push(`${name}(${shown})${outcome(result)}`);
        return result;
      },
    ]),
  ) as unknown as Engine;

  const view = new StubView(document.getElementById('viewport') as HTMLElement);
  const { App } = await import('../src/app');
  const app = new App(engine, view);

  const lines: string[] = [];
  const last: { features: Map<Id, string[]>; order: string; rest: string; properties: string; mechanism: string; meshes: string; documents: string; status?: string; scene?: string[] } & Partial<Record<Region, string[]>> = { features: new Map(), order: '', rest: '', properties: '{}', mechanism: '{"links":{},"joints":{}}', meshes: '{}', documents: '{}' };
  const region = (id: Region): string[] => Array.from((document.getElementById(id) as HTMLElement).childNodes).flatMap((child) => domText(child));
  const section = (title: string, changed: string[]): void => {
    if (changed.length) lines.push(`  ${title}:`, ...changed.map((line) => `    ${line}`));
  };
  let step = 0;
  const record = (title: string): void => {
    lines.push('', `=== ${++step}. ${title}`);
    // the calls on the engine, a run of the same call as one line
    const runs: [string, number][] = [];
    for (const call of calls.splice(0)) runs.length && runs[runs.length - 1][0] === call ? runs[runs.length - 1][1]++ : runs.push([call, 1]);
    for (const [call, count] of runs) lines.push(`  engine: ${call}${count > 1 ? `  (x${count})` : ''}`);
    // the document: what changed
    const doc = inner.getState().document;
    const order = doc.features.map((feature) => feature.id).join(', ');
    if (order !== last.order) lines.push(`  features: ${order || '(none)'}`);
    last.order = order;
    for (const feature of doc.features) {
      const now = featureLines(feature);
      section(`feature ${feature.id}`, changes(last.features.get(feature.id), now));
      last.features.set(feature.id, now);
    }
    for (const id of [...last.features.keys()]) if (!doc.features.some((feature) => feature.id === id)) last.features.delete(id);
    const rest = JSON.stringify({ parameters: doc.parameters, checks: doc.checks, settings: doc.settings, schemaVersion: doc.schemaVersion });
    if (rest !== last.rest) lines.push(`  document: ${rest}`);
    last.rest = rest;
    // the body properties (D48), when they changed; a document without any says nothing
    const properties = JSON.stringify(doc.bodyProperties);
    if (properties !== last.properties) lines.push(`  bodyProperties: ${properties}`);
    last.properties = properties;
    // the mechanism (D49), when it changed; a document without links and joints says nothing
    const mechanism = JSON.stringify(doc.mechanism);
    if (mechanism !== last.mechanism) lines.push(`  mechanism: ${mechanism}`);
    last.mechanism = mechanism;
    // the stored meshes (D55), when they changed: their names and the length of their data
    const meshes = JSON.stringify(Object.fromEntries(Object.entries(doc.meshes).map(([id, mesh]) => [id, `${mesh.name ?? ''} ${mesh.positions.length}+${mesh.triangles.length} characters`])));
    if (meshes !== last.meshes) lines.push(`  meshes: ${meshes}`);
    last.meshes = meshes;
    // the stored documents (D62), when they changed: their names, features and parameters
    const documents = JSON.stringify(Object.fromEntries(Object.entries(doc.documents ?? {}).map(([id, stored]) => [id, `${stored.name ?? ''}: ${stored.document.features.map((f) => f.id).join(' ')}; ${stored.document.parameters.map((p) => `${p.name}=${p.expr}`).join(' ')}`])));
    if (documents !== last.documents) lines.push(`  documents: ${documents}`);
    last.documents = documents;
    // what a user sees: only the parts that changed
    for (const id of ['toolbar', 'timeline', 'panel'] as const) {
      const now = region(id);
      section(id, changes(last[id], now));
      last[id] = now;
    }
    const bar = document.getElementById('status');
    const status = `${bar?.textContent ?? ''}${bar?.classList.contains('error') ? '  [error]' : ''}`;
    if (status !== last.status) lines.push(`  status: ${status}`);
    last.status = status;
    // what the app asked of the view: how many scenes it set, and what changed in the last one
    const scene = sceneText(view.scene);
    lines.push(`  view: ${view.scenes} scene(s) set`);
    section('scene', changes(last.scene, scene));
    last.scene = scene;
    view.scenes = 0;
    for (const call of view.calls.splice(0)) lines.push(`  view: ${call}`);
    for (const name of downloads.splice(0)) lines.push(`  download: ${name}`);
    if (pending.size) lines.push(`  timers waiting: ${pending.size}`);
  };

  const all = <T extends Element>(where: Region, selector: string): T[] => Array.from((document.getElementById(where) as HTMLElement).querySelectorAll<T>(selector));
  const nthOf = <T>(found: T[], what: string, nth = 0): T => {
    if (!found[nth]) throw new Error(`there is no ${what}${nth ? ` (number ${nth + 1})` : ''}`);
    return found[nth];
  };
  const events = window as unknown as { PointerEvent: typeof PointerEvent; KeyboardEvent: typeof KeyboardEvent; Event: typeof Event; MouseEvent: typeof MouseEvent };
  const pointer = (type: string, at: { x: number; y: number }, extra: PointerEventInit = {}): void => {
    view.element.dispatchEvent(new events.PointerEvent(type, { clientX: at.x, clientY: at.y, button: 0, buttons: 0, pointerId: 1, bubbles: true, ...extra }));
  };

  Object.assign(harness, {
    app,
    engine,
    view,
    document,
    record,
    text: () => `${lines.join('\n')}\n`,
    button: (where, text, nth) => nthOf(all<HTMLButtonElement>(where, 'button').filter((button) => button.textContent === text), `button "${text}" in the ${where}`, nth),
    press(where, text, nth) {
      const button = harness.button(where, text, nth);
      if (button.disabled) throw new Error(`the button "${text}" is disabled`);
      button.click();
    },
    field: (label, nth) => nthOf(all<HTMLLabelElement>('panel', 'label').filter((element) => Array.from(element.childNodes).some((child) => child.nodeType === 3 && child.textContent?.trim() === label)), `field "${label}"`, nth).querySelector('input, select') as HTMLInputElement,
    type(input, value, commit = false) {
      input.value = value;
      input.dispatchEvent(new events.Event(commit ? 'change' : 'input', { bubbles: true }));
    },
    choose: (label, value) => harness.type(harness.field(label), value, true),
    row: (name) => nthOf(all<HTMLElement>('timeline', '.row').filter((row) => row.querySelector('.name')?.textContent === name), `row "${name}" on the timeline`),
    rowIcon(name, icon) {
      const button = nthOf(Array.from(harness.row(name).querySelectorAll<HTMLButtonElement>('button')).filter((candidate) => candidate.textContent === icon), `icon ${icon} of "${name}"`);
      if (button.disabled) throw new Error(`the icon ${icon} of "${name}" is disabled`);
      button.click();
    },
    pointer,
    move: (at, extra) => pointer('pointermove', at, extra),
    down: (at, extra) => pointer('pointerdown', at, { buttons: 1, ...extra }),
    up: (at, extra) => pointer('pointerup', at, extra),
    click(at, extra) {
      pointer('pointermove', at, extra);
      pointer('pointerdown', at, { buttons: 1, ...extra });
      pointer('pointerup', at, extra);
    },
    key: (key, extra) => void document.body.dispatchEvent(new events.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })),
    timers() {
      const due = [...pending.values()];
      pending.clear();
      for (const run of due) run();
      return due.length;
    },
    downloads,
    // The clock goes back. The window stays: something the app left running (a connection to the
    // bridge that is being closed) may still write its status line.
    close() {
      performance.now = real.now;
    },
  } satisfies Omit<Harness, 'tick'>);
  return harness;
}

// A command sent past the app, as another client of the engine would (the bridge, a console).
export const outside = (harness: Harness, command: Command): void => void harness.engine.execute(command);
