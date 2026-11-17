// D53 (package 2e of D36) in the recompute, against the real adapters: the linear pattern and the
// mirror, of features and of bodies. A tool built in the left-handed frame of a mirrored copy is
// turned over by `applyTool`; a mirrored copy is the mirror image of its source; the names, the
// frames of sketches on its faces and the ends of its projected edges follow the rules of
// docs/architecture/pattern.md, "What a mirrored copy is".
import type { Command, EdgeName, Engine, EngineState, FaceName, HoleFeature, Id, Input, PatternFeature, PlaneRef, Surface, Vec3 } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { XY, addSketch, batch, cap, circle, expectAllOk, faceBox, faceNames, newEngine, onFace, rectLoop, rectangle, run, side, status, volume } from './kit';

type Transform = Input<PatternFeature>['transform'];
type Extent = Extract<Command, { type: 'addFeature' }>['feature'] extends infer F ? (F extends { type: 'extrude'; extent: infer E } ? E : never) : never;
const volumeOf = (state: EngineState, body: Id): number => volume(state.evaluation.bodies[body].solid);
const near = (actual: number, expected: number, tolerance = 1e-3) => expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThan(tolerance);
const pattern = (id: Id, source: PatternFeature['source'], transform: Transform): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'pattern', source, transform } });
const features = (...ids: Id[]): PatternFeature['source'] => ({ type: 'features', features: ids });
const ofBody = (body: Id): PatternFeature['source'] => ({ type: 'body', body });
const mirror = (plane: PlaneRef): Transform => ({ type: 'mirror', plane });
const row = (axis: 'X' | 'Y' | 'Z', count: number | string, spacing: number | string): Transform => ({ type: 'linear', direction: { kind: 'base', axis }, count, span: { type: 'spacing', spacing } });
const planeAt = (id: Id, base: 'XY' | 'XZ' | 'YZ', offset: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'plane', base: { kind: 'base', plane: base }, offset } });
const MID: PlaneRef = { kind: 'plane', feature: 'mid' };
// An extrusion of regions, of a wall or of a generated profile with any extent.
const extrusion = (id: Id, profile: object, extent: Extent, operation: 'new' | 'add' | 'cut', targets?: Id[]): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile, extent, operation, ...(targets ? { targets } : {}) } as never,
});
const regions = (sketch: Id, ...loops: Id[][]): object => ({ type: 'regions', sketch, regions: loops.map((outerLoop) => ({ outerLoop: [...outerLoop].sort() })) });
const hole = (id: Id, sketch: Id, points: Id[], shape: HoleFeature['shape'], extent: HoleFeature['extent'], targets: Id[]): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'hole', sketch, points, shape, extent, targets } });
// A closed polygon of sketch points and lines, without constraints: `${p}0` … and the lines
// `names[i]` (or `${p}l<i>`) from point i to point i + 1.
function polygon(sketch: Id, p: string, corners: [number, number][], names?: Id[]): Command {
  const line = (i: number): Id => names?.[i] ?? `${p}l${i}`;
  return batch(
    ...corners.map(([x, y], i): Command => ({ type: 'addPoint', sketch, id: `${p}${i}`, x, y })),
    ...corners.map((_, i): Command => ({ type: 'addCurve', sketch, id: line(i), curve: { type: 'line', a: `${p}${i}`, b: `${p}${(i + 1) % corners.length}` } })),
  );
}
const loop = (p: string, n: number): Id[] => Array.from({ length: n }, (_, i) => `${p}l${i}`);
// The largest distance of a vertex of a face of the body from the surface the face is published
// with: planes, cylinders and cones (a swept surface carries no shape to measure against).
function offSurface(state: EngineState, body: Id): number {
  const { solid } = state.evaluation.bodies[body];
  let worst = 0;
  for (let t = 0; t < solid.faceIds.length; t++) {
    const surface: Surface = state.evaluation.faceSurfaces[solid.faceIds[t]];
    for (let k = 0; k < 3; k++) {
      const i = 3 * solid.triangles[3 * t + k];
      const p: Vec3 = [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]];
      worst = Math.max(worst, distance(surface, p));
    }
  }
  return worst;
}
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
function distance(surface: Surface, p: Vec3): number {
  if (surface.kind === 'plane') return Math.abs(dot(minus(p, surface.origin), surface.normal)) / length(surface.normal);
  if (surface.kind === 'cylinder') {
    const d = minus(p, surface.origin);
    const along = dot(d, surface.axis) / length(surface.axis);
    return Math.abs(Math.sqrt(Math.max(0, dot(d, d) - along * along)) - surface.radius);
  }
  if (surface.kind === 'cone') {
    const d = minus(p, surface.apex);
    const along = dot(d, surface.axis) / length(surface.axis);
    const across = Math.sqrt(Math.max(0, dot(d, d) - along * along));
    // the distance from the line of the cone in the plane through the axis and the point
    return Math.abs(across * Math.cos(surface.halfAngle) - Math.abs(along) * Math.sin(surface.halfAngle));
  }
  if (surface.kind === 'sphere') return Math.abs(length(minus(p, surface.center)) - surface.radius);
  if (surface.kind === 'torus') {
    // in the half plane of the point the centre of the tube lies at the signed major radius
    const d = minus(p, surface.center);
    const along = dot(d, surface.axis) / length(surface.axis);
    const across = Math.sqrt(Math.max(0, dot(d, d) - along * along));
    return Math.abs(Math.hypot(across - surface.majorRadius, along) - surface.minorRadius);
  }
  return 0;
}

// ---------------------------------------------------------------- tools in a mirrored placement

// A plate 60 × 40 × 10 (A) on the base plane XY, the plane `mid` across it at x = 30, the plane
// `top` in its top face, and a sketch T on `top` (x and y as in the model, the normal up).
function plate(): Engine {
  const engine = newEngine();
  run(engine, addSketch('S', XY), rectangle('S', 'r', 0, 0, 60, 40), extrusion('A', regions('S', rectLoop('r')), { type: 'distance', start: 0, distance: 10 }, 'new'), planeAt('mid', 'YZ', 30), planeAt('top', 'XY', 10), addSketch('T', { kind: 'plane', feature: 'top' }));
  return engine;
}
// An L in the left half of the plate, in the sketch T.
const L: [number, number][] = [
  [5, 5],
  [20, 5],
  [20, 10],
  [10, 10],
  [10, 20],
  [5, 20],
];
// A half circle in T about its diameter, a line of the sketch: the axis of a revolve (D58).
const HALF_DISC: Command = batch(
  { type: 'addPoint', sketch: 'T', id: 'c0', x: 12, y: 15 },
  { type: 'addPoint', sketch: 'T', id: 'c1', x: 12, y: 25 },
  { type: 'addPoint', sketch: 'T', id: 'cc', x: 12, y: 20 },
  { type: 'addCurve', sketch: 'T', id: 'arc', curve: { type: 'arc', center: 'cc', start: 'c0', end: 'c1' } },
  { type: 'addCurve', sketch: 'T', id: 'dia', curve: { type: 'line', a: 'c1', b: 'c0' } },
);
const revolved = (id: Id, extent: object, operation: 'add' | 'cut'): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'revolve', profile: { type: 'regions', sketch: 'T', regions: [{ outerLoop: ['arc', 'dia'] }] }, axis: { kind: 'sketchLine', sketch: 'T', line: 'dia' }, extent, operation, targets: ['A'] } as never,
});
// `off`: how far a vertex of the body may lie from the surface of its face. A vertex the kernel puts
// where a polygon of a sphere meets the plate lies on a chord of the sphere, within the chord
// tolerance; every other kind of tool meets the plate along edges that lie on its surfaces.
const TOOLS: { name: string; commands: Command[]; source: Id; off?: number }[] = [
  { name: 'a revolve added, a whole turn', source: 'F', off: 0.01, commands: [HALF_DISC, revolved('F', { type: 'full' }, 'add')] },
  { name: 'a revolve cut, a partial turn', source: 'F', off: 0.01, commands: [HALF_DISC, revolved('F', { type: 'angle', start: 'deg(-45)', angle: 'deg(270)' }, 'cut')] },
  { name: 'a prism added', source: 'F', commands: [polygon('T', 'L', L), extrusion('F', regions('T', loop('L', 6)), { type: 'distance', start: 0, distance: 5 }, 'add', ['A'])] },
  { name: 'a prism cut blind', source: 'F', commands: [polygon('T', 'L', L), extrusion('F', regions('T', loop('L', 6)), { type: 'distance', start: 0, distance: -3 }, 'cut', ['A'])] },
  { name: 'a prism cut through all', source: 'F', commands: [polygon('T', 'L', L), extrusion('F', regions('T', loop('L', 6)), { type: 'throughAll', side: 'backward' }, 'cut', ['A'])] },
  { name: 'a tapered stack added', source: 'F', commands: [polygon('T', 'L', L), extrusion('F', regions('T', loop('L', 6)), { type: 'distance', start: 0, distance: 5, taper: 'deg(-5)' } as never, 'add', ['A'])] },
  { name: 'a tapered stack cut', source: 'F', commands: [polygon('T', 'L', L), extrusion('F', regions('T', loop('L', 6)), { type: 'distance', start: 0, distance: -4, taper: 'deg(5)' } as never, 'cut', ['A'])] },
  {
    name: 'a wall from a line',
    source: 'F',
    commands: [{ type: 'addPoint', sketch: 'T', id: 'w1', x: 5, y: 30 }, { type: 'addPoint', sketch: 'T', id: 'w2', x: 20, y: 35 }, { type: 'addCurve', sketch: 'T', id: 'w', curve: { type: 'line', a: 'w1', b: 'w2' } }, extrusion('F', { type: 'wall', sketch: 'T', curves: ['w'], thickness: 2 }, { type: 'distance', start: 0, distance: 4 }, 'add', ['A'])],
  },
  { name: 'a plain hole, blind', source: 'F', commands: [{ type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 }, hole('F', 'T', ['h'], { type: 'plain', diameter: 4 }, { type: 'distance', start: 0, distance: -4 }, ['A'])] },
  { name: 'a counterbore through all', source: 'F', commands: [{ type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 }, hole('F', 'T', ['h'], { type: 'counterbore', diameter: 3, headDiameter: 6, headDepth: 2 }, { type: 'throughAll', side: 'backward' }, ['A'])] },
  { name: 'a countersink through all', source: 'F', commands: [{ type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 }, hole('F', 'T', ['h'], { type: 'countersink', diameter: 3, headDiameter: 6, angle: Math.PI / 2 }, { type: 'throughAll', side: 'backward' }, ['A'])] },
  { name: 'a nut pocket', source: 'F', commands: [{ type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 }, hole('F', 'T', ['h'], { type: 'nutPocket', diameter: 3, acrossFlats: 5.5, headDepth: 2.5, rotation: 0.1 }, { type: 'distance', start: 0, distance: -6 }, ['A'])] },
  {
    name: 'a gear cut',
    source: 'F',
    commands: [circle('T', 'g', 15, 20, 9), extrusion('F', { type: 'generated', generator: 'involuteGear', sketch: 'T', operands: { circle: 'g' }, params: { teeth: 18 } }, { type: 'distance', start: 0, distance: -4 }, 'cut', ['A'])],
  },
  {
    name: 'a gear added',
    source: 'F',
    commands: [circle('T', 'g', 15, 20, 9), extrusion('F', { type: 'generated', generator: 'involuteGear', sketch: 'T', operands: { circle: 'g' }, params: { teeth: 18 } }, { type: 'distance', start: 0, distance: 4 }, 'add', ['A'])],
  },
];

describe('a tool in a mirrored placement is turned over (D53)', () => {
  for (const tool of TOOLS) {
    it(`${tool.name}: the copy changes the plate by what the source changed, on the surfaces of its faces`, () => {
      const engine = plate();
      const before = volumeOf(engine.getState(), 'A');
      const once = volumeOf(run(engine, ...tool.commands), 'A');
      const state = run(engine, pattern('M', features(tool.source), mirror(MID)));
      expectAllOk(state);
      expect(Math.abs(once - before)).toBeGreaterThan(1);
      near(volumeOf(state, 'A') - once, once - before, 1e-3 * Math.max(1, Math.abs(once - before)));
      expect(offSurface(state, 'A')).toBeLessThan(tool.off ?? 1e-4);
      // the faces of the copy are those of the source with the tag of the mirror
      const own = faceNames(state, 'A').filter((name) => name.startsWith(`${tool.source}/`));
      expect(own.filter((name) => name.endsWith('@M:1')).map((name) => name.slice(0, -'@M:1'.length))).toEqual(own.filter((name) => !name.includes('@')));
    });
  }

  it('the plate mirrored as features is its own mirror image: the same plate mirrored as a body shares its volume', () => {
    const engine = plate();
    const state = run(
      engine,
      polygon('T', 'L', L),
      extrusion('F', regions('T', loop('L', 6)), { type: 'distance', start: 0, distance: -4, taper: 'deg(5)' } as never, 'cut', ['A']),
      { type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 },
      { type: 'addPoint', sketch: 'T', id: 'k', x: 22, y: 30 },
      hole('N', 'T', ['h'], { type: 'nutPocket', diameter: 3, acrossFlats: 5.5, headDepth: 2.5, rotation: 0.1 }, { type: 'distance', start: 0, distance: -6 }, ['A']),
      hole('C', 'T', ['k'], { type: 'countersink', diameter: 3, headDiameter: 6, angle: Math.PI / 2 }, { type: 'throughAll', side: 'backward' }, ['A']),
      pattern('M', features('F', 'N', 'C'), mirror(MID)),
      pattern('B', ofBody('A'), mirror(MID)),
    );
    expectAllOk(state);
    near(volumeOf(state, 'B/1'), volumeOf(state, 'A'), 1e-3);
    // the two bodies lie on each other: what they share is the whole of either
    const report = engine.query('interference', { bodies: ['A', 'B/1'] });
    if (!report.ok) throw new Error(report.error.message);
    const shared = [...report.result.pairs, ...report.result.fits][0];
    near(shared.volume, volumeOf(state, 'A'), 0.01);
  });
});

// ---------------------------------------------------------------- a mirrored body

// An L-shaped pad 2 high on the base plane XY with the corner at the origin: a leg 15 long along X
// and one 8 long along Y, both 3 wide (60 mm², 120 mm³). The curves are `names` when given.
const PAD: [number, number][] = [
  [0, 0],
  [15, 0],
  [15, 3],
  [3, 3],
  [3, 8],
  [0, 8],
];
function pad(engine: Engine, names?: Id[]): EngineState {
  const curves = names ?? loop('q', 6);
  return run(engine, addSketch('P', XY), polygon('P', 'q', PAD, curves), extrusion('pad', regions('P', curves), { type: 'distance', start: 0, distance: 2 }, 'new'), planeAt('mx', 'YZ', 40), planeAt('my', 'XZ', -25));
}
const tag = (name: FaceName, ...tags: [Id, number][]): FaceName => (tags.length ? { ...name, copy: tags.map(([pattern, index]) => ({ pattern, index })) } : name);
const box = (state: EngineState, body: Id) => state.evaluation.bodies[body].bounds;
// The ends of a projected line, `a` then `b`, in the coordinates of its sketch.
const ends = (state: EngineState, sketch: Id, id: Id): number[][] => ['a', 'b'].map((end) => {
  const p = state.evaluation.features[sketch].sketch?.points[`${id}/${end}`];
  if (!p) throw new Error(`no end ${end} of ${id}`);
  return [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6];
});
const project = (sketch: Id, id: Id, body: Id, edge: EdgeName): Command => ({ type: 'addExternal', sketch, id, ref: { type: 'edge', body, edge, kind: 'line' } });

describe('a mirror of a body (D53)', () => {
  it('copies in the planes x = 40 and y = 25, and a copy of a copy: four pads in the corners', () => {
    const engine = newEngine();
    pad(engine);
    const state = run(engine, pattern('X', ofBody('pad'), mirror({ kind: 'plane', feature: 'mx' })), pattern('Y', ofBody('pad'), mirror({ kind: 'plane', feature: 'my' })), pattern('XY', ofBody('X/1'), mirror({ kind: 'plane', feature: 'my' })));
    expectAllOk(state);
    expect(state.evaluation.features.X.bodies).toEqual(['X/1']);
    for (const body of ['pad', 'X/1', 'Y/1', 'XY/1']) near(volumeOf(state, body), 120, 1e-4);
    expect(box(state, 'X/1')).toMatchObject({ min: [expect.closeTo(65, 5), expect.closeTo(0, 5), 0], max: [expect.closeTo(80, 5), expect.closeTo(8, 5), 2] });
    expect(box(state, 'Y/1')).toMatchObject({ min: [expect.closeTo(0, 5), expect.closeTo(42, 5), 0] });
    expect(box(state, 'XY/1')).toMatchObject({ min: [expect.closeTo(65, 5), expect.closeTo(42, 5), 0], max: [expect.closeTo(80, 5), expect.closeTo(50, 5), 2] });
    // the names: the source face with the tags, the latest last
    expect(faceNames(state, 'XY/1')).toEqual(faceNames(state, 'pad').map((name) => `${name}@X:1@XY:1`));
    expect(offSurface(state, 'XY/1')).toBeLessThan(1e-5);
    // nothing collides
    const report = engine.query('interference', { bodies: ['pad', 'X/1', 'Y/1', 'XY/1'] });
    expect(report).toMatchObject({ ok: true, result: { pairs: [], failed: [] } });
  });

  it('a sketch on a face of the copy has a right-handed frame of its own; a boss from it grows out of the body', () => {
    const engine = newEngine();
    pad(engine);
    run(engine, pattern('X', ofBody('pad'), mirror({ kind: 'plane', feature: 'mx' })), addSketch('onPad', onFace('pad', cap('pad'))), addSketch('onCopy', onFace('X/1', tag(cap('pad'), ['X', 1]))));
    const state = engine.getState();
    const source = state.evaluation.features.onPad.plane;
    const copy = state.evaluation.features.onCopy.plane;
    if (!source || !copy) throw new Error('no frame');
    // the origin and Y are the images of those of the source; X = Y × N is not the image of X
    near(copy.origin[0], 80 - source.origin[0], 1e-9);
    near(copy.origin[1], source.origin[1], 1e-9);
    near(copy.origin[2], 2, 1e-9);
    expect(copy.normal).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9), expect.closeTo(1, 9)]);
    expect(copy.y.map((v, i) => v - [-source.y[0], source.y[1], source.y[2]][i]).every((d) => Math.abs(d) < 1e-9)).toBe(true);
    expect(copy.x.map((v, i) => v - source.x[i]).every((d) => Math.abs(d) < 1e-9)).toBe(true);
    const [x, y, n] = [copy.x, copy.y, copy.normal];
    near((x[1] * y[2] - x[2] * y[1]) * n[0] + (x[2] * y[0] - x[0] * y[2]) * n[1] + (x[0] * y[1] - x[1] * y[0]) * n[2], 1, 1e-9);
    // a boss by a positive distance goes up, out of the copy
    const boss = run(engine, circle('onCopy', 'b', 0, 0, 1), { type: 'addPoint', sketch: 'onCopy', id: 'bc2', x: 0, y: 0 }, extrusion('boss', regions('onCopy', ['b']), { type: 'distance', start: 0, distance: 3 }, 'new'));
    expect(status(boss).boss).toBe('ok');
    near(box(boss, 'boss').max[2], 5, 1e-5);
  });

  it('a cut into a mirrored copy, a mirror in a face of the source, a mirror of a mirror', () => {
    const engine = newEngine();
    pad(engine);
    // the plane of the end face of the long leg (x = 15): the copy continues the leg to x = 30
    let state = run(engine, pattern('E', ofBody('pad'), mirror(onFace('pad', side('pad', 'ql1')))));
    expectAllOk(state);
    near(box(state, 'E/1').min[0], 15, 1e-5);
    near(box(state, 'E/1').max[0], 30, 1e-5);
    state = run(engine, addSketch('C', XY), circle('C', 'k', 28, 1.5, 1), extrusion('cut', regions('C', ['k']), { type: 'throughAll', side: 'both' }, 'cut', ['E/1']));
    expectAllOk(state);
    expect(volumeOf(state, 'E/1')).toBeLessThan(120 - 5);
    near(volumeOf(state, 'pad'), 120, 1e-4);
    // two mirrors make a turn: the copy of the copy in the same plane is the source again
    state = run(engine, pattern('EE', ofBody('E/1'), mirror(onFace('pad', side('pad', 'ql1')))));
    expectAllOk(state);
    near(box(state, 'EE/1').min[0], 0, 1e-5);
    near(box(state, 'EE/1').max[0], 15, 1e-5);
  });

  it('the ends of a projected line: a mirror reverses them; a tag that turns the order of the two face keys reverses them once more', () => {
    // the sides of the pad named so that `edge` and `edge-2` are neighbours: a tag appended to both
    // turns the order of their keys round (`-` sorts below `/`)
    const engine = newEngine();
    pad(engine, ['edge', 'edge-2', 'c', 'd', 'e', 'f']);
    run(engine, pattern('M', ofBody('pad'), mirror({ kind: 'plane', feature: 'mx' })), pattern('R', ofBody('pad'), row('X', 2, 30)), addSketch('K', { kind: 'base', plane: 'XZ' }), addSketch('Top', XY));
    const top = cap('pad');
    // the edge of the top with the side `edge`, seen from above: the image of the end a is the end b
    let state = run(engine, project('Top', 's', 'pad', { a: top, b: side('pad', 'edge') }), project('Top', 'm', 'M/1', { a: tag(top, ['M', 1]), b: tag(side('pad', 'edge'), ['M', 1]) }));
    expect(ends(state, 'Top', 's')).toEqual([
      [0, 0],
      [15, 0],
    ]);
    expect(ends(state, 'Top', 'm')).toEqual([
      [65, 0],
      [80, 0],
    ]);
    // the corner edge of `edge` and `edge-2` (the order of its keys turns with a tag): swapped on
    // the shifted copy, not on the mirrored one, where the two reversals cancel
    const corner = (...tags: [Id, number][]): EdgeName => ({ a: tag(side('pad', 'edge'), ...tags), b: tag(side('pad', 'edge-2'), ...tags) });
    state = run(engine, project('K', 'ks', 'pad', corner()), project('K', 'kr', 'R/1', corner(['R', 1])), project('K', 'km', 'M/1', corner(['M', 1])));
    expect(status(state).K).toBe('ok');
    expect(ends(state, 'K', 'ks')).toEqual([
      [15, 0],
      [15, 2],
    ]);
    expect(ends(state, 'K', 'kr')).toEqual([
      [45, 2],
      [45, 0],
    ]);
    expect(ends(state, 'K', 'km')).toEqual([
      [65, 0],
      [65, 2],
    ]);
    // the corner of `edge-2` and `c`, whose order no tag turns: kept on the shifted copy, swapped on the mirrored one
    const other = (...tags: [Id, number][]): EdgeName => ({ a: tag(side('pad', 'c'), ...tags), b: tag(side('pad', 'edge-2'), ...tags) });
    state = run(engine, project('K', 's2', 'pad', other()), project('K', 'r2', 'R/1', other(['R', 1])), project('K', 'm2', 'M/1', other(['M', 1])));
    const [source, shifted, mirrored] = [ends(state, 'K', 's2'), ends(state, 'K', 'r2'), ends(state, 'K', 'm2')];
    expect(shifted).toEqual(source.map(([x, y]) => [x + 30, y]));
    expect(mirrored).toEqual([...source].reverse().map(([x, y]) => [80 - x, y]));
  });

  // The ridge where a slanted side meets its own mirror image (`f/side/a` and `f/side/a/@m:1`), on
  // a body a later pattern `q` copies: the order of the two keys turns when `/@q:` sorts above
  // `/@m:1/@q:`, so for two IDs of which neither begins the other when m sorts below q, and for
  // `row` and `row-2` the other way round.
  const ridge = (m: Id, q: Id): { source: number[][]; copy: number[][] } => {
    const engine = newEngine();
    run(
      engine,
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 20, 10),
      extrusion('blk', regions('S', rectLoop('r')), { type: 'distance', start: 0, distance: 5 }, 'new'),
      // a triangle in the plane XZ (its normal −Y, so a negative distance runs along +Y), with the
      // slanted side `a` rising to the plane x = 10
      addSketch('V', { kind: 'base', plane: 'XZ' }),
      polygon('V', 't', [
        [5, 5],
        [10, 9],
        [10, 5],
      ], ['a', 'b', 'c']),
      extrusion('f', regions('V', ['a', 'b', 'c']), { type: 'distance', start: 0, distance: -10 }, 'add', ['blk']),
      planeAt('half', 'YZ', 10),
      pattern(m, features('f'), mirror({ kind: 'plane', feature: 'half' })),
      pattern(q, ofBody('blk'), row('X', 2, 30)),
      addSketch('Top', XY),
    );
    const a = side('f', 'a');
    const state = run(engine, project('Top', 'xs', 'blk', { a, b: tag(a, [m, 1]) }), project('Top', 'xc', `${q}/1`, { a: tag(a, [q, 1]), b: tag(a, [m, 1], [q, 1]) }));
    expect(status(state).Top).toBe('ok');
    return { source: ends(state, 'Top', 'xs'), copy: ends(state, 'Top', 'xc') };
  };
  const shiftedBy = (points: number[][], dx: number): number[][] => points.map(([x, y]) => [x + dx, y]);

  it('the ridge of a slanted side and its mirror image on a copied body: the ends follow the order of the keys', () => {
    for (const [m, q, turned] of [
      ['m', 'q', true],
      ['q', 'm', false],
      ['row', 'row-2', false],
      ['row-2', 'row', true],
    ] as [Id, Id, boolean][]) {
      const { source, copy } = ridge(m, q);
      expect(source.every(([x]) => Math.abs(x - 10) < 1e-6), `${m}, ${q}`).toBe(true);
      expect(copy, `${m}, ${q}`).toEqual(turned ? shiftedBy([...source].reverse(), 30) : shiftedBy(source, 30));
    }
  });
});

// ---------------------------------------------------------------- the linear pattern

describe('a linear pattern (D53)', () => {
  // A plate 80 × 20 × 4 and a slot 2 × 10 cut through it at x = 10.
  function slotted(): Engine {
    const engine = newEngine();
    run(
      engine,
      { type: 'setParameter', name: 'n', expr: '5' },
      { type: 'setParameter', name: 'pitch', expr: '6' },
      addSketch('S', XY),
      rectangle('S', 'r', 0, 0, 80, 20),
      extrusion('A', regions('S', rectLoop('r')), { type: 'distance', start: 0, distance: 4 }, 'new'),
      addSketch('T', XY),
      polygon('T', 's', [
        [10, 5],
        [12, 5],
        [12, 15],
        [10, 15],
      ]),
      extrusion('slot', regions('T', loop('s', 4)), { type: 'throughAll', side: 'both' }, 'cut', ['A']),
    );
    return engine;
  }
  const SLOT = 2 * 10 * 4;
  const PLATE = 80 * 20 * 4;

  it('a row of slots: the count and the spacing as parameters; a copy is the slot with its number', () => {
    const engine = slotted();
    let state = run(engine, pattern('P', features('slot'), row('X', 'n', 'pitch')));
    expectAllOk(state);
    near(volumeOf(state, 'A'), PLATE - 5 * SLOT);
    expect(faceBox(state, 'A', tag(side('slot', 'sl0'), ['P', 4]))?.min[0]).toBeCloseTo(34, 4);
    // a sixth slot moves none of the others
    state = run(engine, { type: 'setParameter', name: 'n', expr: '6' });
    near(volumeOf(state, 'A'), PLATE - 6 * SLOT);
    expect(faceBox(state, 'A', tag(side('slot', 'sl0'), ['P', 4]))?.min[0]).toBeCloseTo(34, 4);
    // a negative spacing runs the other way: one copy fits at x = 4
    state = run(engine, { type: 'updateFeature', id: 'P', patch: { transform: { count: 2, span: { spacing: -6 } } } });
    near(volumeOf(state, 'A'), PLATE - 2 * SLOT);
    expect(faceBox(state, 'A', tag(side('slot', 'sl0'), ['P', 1]))?.min[0]).toBeCloseTo(4, 4);
  });

  it('a length between the original and the last copy; a count of 1 has no copy', () => {
    const engine = slotted();
    let state = run(engine, pattern('P', features('slot'), { type: 'linear', direction: { kind: 'base', axis: 'X' }, count: 5, span: { type: 'length', length: 40 } }));
    expectAllOk(state);
    near(volumeOf(state, 'A'), PLATE - 5 * SLOT);
    expect(faceBox(state, 'A', tag(side('slot', 'sl0'), ['P', 4]))?.min[0]).toBeCloseTo(50, 4);
    state = run(engine, { type: 'setField', feature: 'P', path: 'transform/count', value: 1 });
    expectAllOk(state);
    near(volumeOf(state, 'A'), PLATE - SLOT);
  });

  it('copies past the end of the plate are named in noEffect by their numbers; one failed copy fails the pattern', () => {
    const engine = slotted();
    let state = run(engine, pattern('P', features('slot'), row('X', 14, 6)));
    // the slot at 10 + 6k fits up to k = 11 (x = 76 … 78); 12 and 13 run past the end
    expect(state.evaluation.features.P.status).toBe('warning');
    expect(state.evaluation.features.P.warnings[0]).toMatchObject({ code: 'noEffect', refs: [{ copy: 12, feature: 'slot', targets: ['A'] }, { copy: 13, feature: 'slot', targets: ['A'] }] });
    near(volumeOf(state, 'A'), PLATE - 12 * SLOT);
    // a cut of the left half: its copy would remove the rest of the plate, which is the error of the
    // pattern with the copy first in refs; the model stays as it was before the pattern
    const before = volumeOf(run(engine, { type: 'removeFeature', id: 'P' }, addSketch('W', XY), rectangle('W', 'w', -1, -1, 41, 22, null), extrusion('big', regions('W', rectLoop('w')), { type: 'throughAll', side: 'both' }, 'cut', ['A'])), 'A');
    state = run(engine, pattern('P', features('big'), row('X', 2, 40)));
    expect(state.evaluation.features.P.error).toMatchObject({ code: 'emptyResult', refs: [{ copy: 1, feature: 'big' }, 'A'] });
    near(volumeOf(state, 'A'), before);
  });

  it('a pattern of a body along the normal of a sketch on a face', () => {
    const engine = slotted();
    const state = run(engine, addSketch('U', onFace('A', cap('A'))), pattern('stack', ofBody('A'), { type: 'linear', direction: { kind: 'sketchPoint', sketch: 'U', point: 'origin' }, count: 3, span: { type: 'spacing', spacing: 5 } }));
    expectAllOk(state);
    expect(state.evaluation.features.stack.bodies).toEqual(['stack/1', 'stack/2']);
    near(volumeOf(state, 'stack/2'), volumeOf(state, 'A'), 1e-3);
    expect(box(state, 'stack/2')).toMatchObject({ min: [expect.closeTo(0, 5), expect.closeTo(0, 5), expect.closeTo(10, 5)], max: [expect.closeTo(80, 5), expect.closeTo(20, 5), expect.closeTo(14, 5)] });
  });
});

// ---------------------------------------------------------------- extents up to a plane and holes in copies

describe('upTo and holes in the copies of a row and of a mirror (D53)', () => {
  // The plate of the tools, and above it a roof: a body extruded along X from the base plane YZ with
  // a draft of 2°, so its underside rises along X (z = 20 + x · tan 2°). A post of radius 2 on the
  // plate at (15, 20) runs up to that underside.
  const TAN = Math.tan(Math.PI / 90);
  function posts(): Engine {
    const engine = plate();
    run(
      engine,
      addSketch('R', { kind: 'base', plane: 'YZ' }),
      polygon('R', 'f', [
        [0, 20],
        [40, 20],
        [40, 25],
        [0, 25],
      ]),
      extrusion('roof', regions('R', loop('f', 4)), { type: 'distance', start: 0, distance: 60, taper: 'deg(-2)' } as never, 'new'),
      circle('T', 'p', 15, 20, 2),
      extrusion('post', regions('T', ['p']), { type: 'upTo', plane: onFace('roof', side('roof', 'fl0')), start: 0 }, 'add', ['A']),
    );
    return engine;
  }
  const top = (state: EngineState, ...tags: [Id, number][]): number => (faceBox(state, 'A', tag(cap('post'), ...tags)) as { max: number[] }).max[2];

  it('a row of posts under a tilted plane: each copy has its own length', () => {
    const engine = posts();
    const state = run(engine, pattern('P', features('post'), row('X', 3, 10)));
    expectAllOk(state);
    near(top(state), 20 + 17 * TAN, 1e-3);
    near(top(state, ['P', 1]), 20 + 27 * TAN, 1e-3);
    near(top(state, ['P', 2]), 20 + 37 * TAN, 1e-3);
  });

  it('a mirrored post runs to the same plane, which the mirror does not keep: it is longer than its source', () => {
    const engine = posts();
    const source = volumeOf(engine.getState('post'), 'A') - volumeOf(engine.getState('roof'), 'A');
    const before = volumeOf(engine.getState(), 'A');
    const state = run(engine, pattern('P', features('post'), mirror(MID)));
    expectAllOk(state);
    near(top(state, ['P', 1]), 20 + 47 * TAN, 1e-3);
    // the post of radius 2 is longer by (45 − 15) · tan 2° on average (the circle is a polygon, a little smaller)
    const longer = volumeOf(state, 'A') - before - source;
    expect(longer / (30 * TAN * Math.PI * 4)).toBeGreaterThan(0.99);
    expect(longer / (30 * TAN * Math.PI * 4)).toBeLessThan(1);
  });

  it('a copy the plane passes through is invalidExtent, with the copy first in refs', () => {
    const engine = posts();
    // shifted up by 10.52 the start of the copy (z = 20.52) lies between z = 20.454 and 20.594 of the plane over the post
    const state = run(engine, pattern('P', features('post'), row('Z', 2, 10.52)));
    expect(state.evaluation.features.P.error).toMatchObject({ code: 'invalidExtent', refs: [{ copy: 1, feature: 'post' }, onFace('roof', side('roof', 'fl0'))] });
  });

  it('a hole in a copied post: the sources in their order, the post first', () => {
    const engine = posts();
    run(engine, { type: 'addPoint', sketch: 'T', id: 'hc', x: 15, y: 20 }, hole('bore', 'T', ['hc'], { type: 'plain', diameter: 2 }, { type: 'distance', start: 8, distance: -6 }, ['A']));
    for (const transform of [mirror(MID), row('X', 3, 10)]) {
      const preview = engine.preview(pattern('P', features('post', 'bore'), transform));
      if (!preview.ok) throw new Error(preview.error.message);
      expect(status(preview.state).P).toBe('ok');
      expect(faceBox(preview.state, 'A', tag({ feature: 'bore', role: 'holeBore', point: 'hc' }, ['P', 1]))).toBeDefined();
    }
  });

  it('a hole through all in a row and in a mirror removes what the source removed per copy', () => {
    const engine = plate();
    const before = volumeOf(engine.getState(), 'A');
    run(engine, { type: 'addPoint', sketch: 'T', id: 'h', x: 12, y: 30 }, hole('H', 'T', ['h'], { type: 'counterbore', diameter: 3, headDiameter: 6, headDepth: 2 }, { type: 'throughAll', side: 'backward' }, ['A']));
    const one = before - volumeOf(engine.getState(), 'A');
    for (const [transform, copies] of [
      [row('X', 3, 15), 2],
      [mirror(MID), 1],
    ] as [Transform, number][]) {
      const preview = engine.preview(pattern('P', features('H'), transform));
      if (!preview.ok) throw new Error(preview.error.message);
      expectAllOk(preview.state);
      near(before - volumeOf(preview.state, 'A'), (copies + 1) * one, 1e-3);
    }
  });

  it('a headed hole as deep as the targets: the source misses, a copy that hits is the error of its mark', () => {
    const engine = plate();
    // outside the plate, at x = -10: the head is deeper than the plate, so the hole may only miss
    run(engine, { type: 'addPoint', sketch: 'T', id: 'h', x: -10, y: 20 }, hole('H', 'T', ['h'], { type: 'counterbore', diameter: 3, headDiameter: 6, headDepth: 12 }, { type: 'throughAll', side: 'backward' }, ['A']));
    expect(status(engine.getState()).H).toBe('warning:noEffect');
    const missed = engine.preview(pattern('P', features('H'), mirror(MID)));
    expect(missed.ok && missed.state.evaluation.features.P.warnings[0]?.code).toBe('noEffect');
    const hit = engine.preview(pattern('P', features('H'), row('X', 2, 20)));
    if (!hit.ok) throw new Error(hit.error.message);
    expect(hit.state.evaluation.features.P.error).toMatchObject({ code: 'invalidHole', refs: [{ copy: 1, feature: 'H' }, 'A'] });
  });
});

// ---------------------------------------------------------------- the plane of a mirror, and copies onto the original

describe('the plane of a mirror (D53)', () => {
  it('a base plane, a plane feature, a face, a face of a copy; a round face and a removed plane are errors', () => {
    const engine = plate();
    run(engine, circle('T', 'k', 12, 30, 2), extrusion('H', regions('T', ['k']), { type: 'throughAll', side: 'backward' }, 'cut', ['A']), pattern('Q', ofBody('A'), row('X', 2, 100)));
    const at = (plane: PlaneRef): EngineState => {
      const preview = engine.preview(pattern('M', features('H'), mirror(plane)));
      if (!preview.ok) throw new Error(preview.error.message);
      return preview.state;
    };
    const hole = (state: EngineState) => faceBox(state, 'A', tag(side('H', 'k'), ['M', 1]));
    expect(hole(at({ kind: 'base', plane: 'YZ' }))).toBeUndefined(); // the copy at x = -12 misses the plate
    expect(at({ kind: 'base', plane: 'YZ' }).evaluation.features.M.warnings[0]?.code).toBe('noEffect');
    expect(hole(at(MID))?.min[0]).toBeCloseTo(46, 1);
    expect(hole(at({ kind: 'base', plane: 'XZ' }))).toBeUndefined(); // y = -30
    // the side face of the plate at x = 60 (the curve rb): the copy lands at x = 108, beside the plate
    expect(status(at(onFace('A', side('A', 'rb')))).M).toBe('warning:noEffect');
    // the face of a copy: the side of Q/1 at x = 100, so the copy is at 188
    expect(status(at(onFace('Q/1', tag(side('A', 'rb'), ['Q', 1])))).M).toBe('warning:noEffect');
    const round = at(onFace('A', side('H', 'k')));
    expect(round.evaluation.features.M.error).toMatchObject({ code: 'nonPlanarFace', refs: [onFace('A', side('H', 'k'))] });
    const gone = engine.preview(batch(pattern('M', features('H'), mirror(MID)), { type: 'removeFeature', id: 'mid' }));
    if (!gone.ok) throw new Error(gone.error.message);
    expect(gone.state.evaluation.features.M.error).toMatchObject({ code: 'brokenReference', refs: [MID] });
  });

  it('copies onto the original: a circle mirrored in the plane along the X axis of its sketch is its own image', () => {
    // a hole of radius 4 (45 sides, an odd number) cut at (30, 20) and mirrored in the plane y = 20,
    // which runs along the X axis of the sketch through the centre: the polygon is its own image
    const engine = plate();
    run(engine, circle('T', 'k', 30, 20, 4), extrusion('H', regions('T', ['k']), { type: 'throughAll', side: 'backward' }, 'cut', ['A']), planeAt('y20', 'XZ', -20));
    const along = engine.preview(pattern('M', features('H'), mirror({ kind: 'plane', feature: 'y20' })));
    expect(along.ok && along.state.evaluation.features.M.warnings[0]).toMatchObject({ code: 'noEffect', refs: [{ copy: 1, feature: 'H', targets: ['A'] }] });
    // an oblique plane through the centre: the polygon of 50 sides (radius 5) is not its own image, the copy changes the plate
    const oblique = newEngine();
    run(oblique, addSketch('S', XY), rectangle('S', 'r', 0, 0, 60, 40), extrusion('A', regions('S', rectLoop('r')), { type: 'distance', start: 0, distance: 10 }, 'new'), addSketch('T', XY), circle('T', 'k', 30, 20, 5), extrusion('H', regions('T', ['k']), { type: 'throughAll', side: 'both' }, 'cut', ['A']), addSketch('D', XY), polygon('D', 'd', [[30, 20], [31, 20.3], [30, 21]]), extrusion('wedge', regions('D', loop('d', 3)), { type: 'distance', start: 0, distance: 1 }, 'new'));
    const slanted = onFace('wedge', side('wedge', 'dl0'));
    const changed = oblique.preview(pattern('M', features('H'), mirror(slanted)));
    if (!changed.ok) throw new Error(changed.error.message);
    expect(changed.state.evaluation.features.M.status).toBe('ok');
  });
});

// ---------------------------------------------------------------- what other packages read

describe('a mirrored copy in other packages (D53)', () => {
  it('body properties through a mirror and a mirror of a copy; a link; the mass, print and section queries', () => {
    const engine = newEngine();
    pad(engine);
    const state = run(
      engine,
      pattern('X', ofBody('pad'), mirror({ kind: 'plane', feature: 'mx' })),
      pattern('XY', ofBody('X/1'), mirror({ kind: 'plane', feature: 'my' })),
      { type: 'setBodyMaterial', body: 'pad', material: 'TPU' },
      { type: 'setLink', id: 'base', bodies: ['pad', 'X/1', 'XY/1'] },
    );
    expect(state.evaluation.bodyProperties['XY/1']).toMatchObject({ material: 'TPU', from: 'X/1' });
    expect(state.evaluation.bodyProperties['X/1']).toMatchObject({ material: 'TPU', from: 'pad' });
    expect(state.evaluation.mechanism.links.base.bodies).toEqual(['pad', 'X/1', 'XY/1']);
    const mass = engine.query('mass', { bodies: ['pad', 'XY/1'] });
    if (!mass.ok) throw new Error(mass.error.message);
    near(mass.result.bodies[1].mass, mass.result.bodies[0].mass, 1e-9);
    const print = engine.query('print', { bodies: ['XY/1'], orientations: [{ by: { up: [0, 0, 1] } }] } as never);
    expect(print.ok).toBe(true);
    const section = engine.query('section', { plane: XY, offset: 1, bodies: ['XY/1'] });
    if (!section.ok) throw new Error(section.error.message);
    near((section.result as { bodies: { area: number }[] }).bodies[0].area, 60, 1e-3);
  });

  it('an ID a change of the kind left behind: each place reports a body that is not there, also after a load', () => {
    const engine = newEngine();
    pad(engine);
    run(
      engine,
      pattern('R', ofBody('pad'), row('X', 3, 20)),
      addSketch('onTwo', onFace('R/2', tag(cap('pad'), ['R', 2]))),
      addSketch('Top', XY),
      project('Top', 'e', 'R/2', { a: tag(cap('pad'), ['R', 2]), b: tag(side('pad', 'ql0'), ['R', 2]) }),
      addSketch('C', XY),
      circle('C', 'k', 41, 1.5, 1),
      extrusion('cut', regions('C', ['k']), { type: 'throughAll', side: 'both' }, 'cut', ['R/2']),
      { type: 'setBodyProperties', body: 'R/2', patch: { color: '#ff0000' } },
      { type: 'setLink', id: 'base', bodies: ['R/2'] },
    );
    const state = run(engine, { type: 'updateFeature', id: 'R', patch: { transform: mirror({ kind: 'plane', feature: 'mx' }) } });
    expect(state.evaluation.features.R.bodies).toEqual(['R/1']);
    for (const s of [state, (() => {
      const other = newEngine();
      const loaded = other.load(engine.save());
      if (!loaded.ok) throw new Error(loaded.error.message);
      return loaded.state;
    })()]) {
      expect(status(s)).toMatchObject({ onTwo: 'error:brokenReference', cut: 'error:brokenReference', Top: 'warning:brokenProjection' });
      expect(s.evaluation.mechanism.links.base).toMatchObject({ missing: ['R/2'] });
      expect(s.document.bodyProperties['R/2']).toEqual({ color: '#ff0000' });
      expect(s.evaluation.bodies['R/2']).toBeUndefined();
    }
    // the commands of a sketch verify the whole reference every time: they refuse to repeat it
    expect(engine.preview({ type: 'setSketchPlane', sketch: 'onTwo', plane: onFace('R/2', tag(cap('pad'), ['R', 2])) }).ok).toBe(false);
    expect(engine.preview({ type: 'updateExternal', sketch: 'Top', id: 'e', ref: { type: 'edge', body: 'R/2', edge: { a: tag(cap('pad'), ['R', 2]), b: tag(side('pad', 'ql0'), ['R', 2]) }, kind: 'line' } }).ok).toBe(false);
    // a face tagged as copy 2 of the mirror, as a plane: a valid command and an issue of the recompute
    const tagged = engine.preview(addSketch('two', onFace('R/1', tag(cap('pad'), ['R', 2]))));
    expect(tagged.ok && status(tagged.state).two).toBe('error:brokenReference');
  });
});
