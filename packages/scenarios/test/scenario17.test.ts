// Validation scenario 17 (docs/requirements.md), the part of package 4c (D67): chamfers and fillets
// of edges that run out into round faces, from the conversion of a cycloidal actuator from Onshape.
// Written from docs/d36/4c-blend-round-ends/calls.ts.
//
// Each part is a body of its own in one document, so that no step consumes an edge another needs:
// a. the housing of the actuator: the top rim of a bore broken by 16 pin pockets (arcs running out
//    into cylinders parallel to the axis);
// b. a hub: the rim of a bore broken by a keyway (an arc running out past planes off its axis);
// c. a rib on a plate running into a boss: its concave foot runs out inside the boss;
// d. the motor shaft: the top edges of a slot from a hex socket out through the shaft's cylinder
//    (straight edges running out into the air outside a cylinder; their other end is a planar face
//    of the socket, D63);
// e. a box whose top edge a hole breaks: accepted where the chamfer crosses the hole, refused as a
//    bridge where it passes behind it;
// f. what is refused, each a preview of the feature inserted right after the feature it is about;
// g. a change of parameters, and a save and load.
// The steps share one engine and run in order.
import { type Command, type CommandResult, type EdgeName, type EngineState, type FaceName, type Id, type Issue, type PlaneRef, type Surface, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { MESSAGE } from '../../engine/src/recompute/services';
import { BLEND_MIN_CROSSING } from '../../engine/src/recompute/tool-edge';
import { newEngine } from './kit';

const engine = newEngine();
const done = (result: CommandResult): EngineState => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
};
const run = (...commands: Command[]): EngineState => done(engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands }));
const near = (value: number | undefined, expected: number, tolerance: number): void => {
  expect(value, `${value} is not ${expected}`).toBeDefined();
  expect(Math.abs((value as number) - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(tolerance);
};
const nameKey = (name: FaceName): string => JSON.stringify(Object.entries(name).sort(([a], [b]) => (a < b ? -1 : 1)));
const sameName = (a: FaceName, b: FaceName): boolean => nameKey(a) === nameKey(b);
const expectAllOk = (state: EngineState): void => {
  for (const feature of state.document.features) expect(`${feature.id}: ${state.evaluation.features[feature.id].status} ${state.evaluation.features[feature.id].error?.message ?? ''}`).toBe(`${feature.id}: ok `);
};
function surfaceOf(state: EngineState, body: Id, name: FaceName): Surface | undefined {
  const face = state.evaluation.bodies[body]?.faces.find((f) => sameName(state.evaluation.faceNames[f.id], name));
  return face ? state.evaluation.faceSurfaces[face.id] : undefined;
}
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
const top = (feature: Id): FaceName => ({ feature, role: 'endCap' });
const edge = (a: FaceName, b: FaceName): EdgeName => ({ a, b });
const chamferFace = (feature: Id, i: number): FaceName => ({ feature, role: 'chamfer', edge: i });
const filletFace = (feature: Id, i: number): FaceName => ({ feature, role: 'fillet', edge: i });
const base = (id: Id) => ({ id, name: id, suppressed: false });
const chamfer = (id: Id, body: Id, edges: EdgeName[], distance: number): Command => ({ type: 'addFeature', feature: { ...base(id), type: 'chamfer', body, edges, distance } });
const fillet = (id: Id, body: Id, edges: EdgeName[], radius: number): Command => ({ type: 'addFeature', feature: { ...base(id), type: 'fillet', body, edges, radius } });
const at = (command: Command, index: number): Command => ({ ...(command as Extract<Command, { type: 'addFeature' }>), index });
// Two faces of a body meet along an edge.
const touches = (state: EngineState, body: Id, a: FaceName, b: FaceName): boolean => state.evaluation.bodies[body].edges.some((e) => (sameName(e.name.a, a) && sameName(e.name.b, b)) || (sameName(e.name.a, b) && sameName(e.name.b, a)));
const volume = (state: EngineState, body: Id): number => state.evaluation.bodies[body].volume;
// The error of a feature inserted right after `after` and evaluated up to itself: the refusal of an
// edge at the place of the timeline where the edge exists.
function refusalAfter(after: Id, command: Command): Issue | undefined {
  const index = engine.getState().document.features.findIndex((f) => f.id === after) + 1;
  const id = (command as Extract<Command, { type: 'addFeature' }>).feature.id;
  return done(engine.preview(at(command, index), id)).evaluation.features[id]?.error;
}
const names = (issue: Issue | undefined, face: FaceName): boolean => (issue?.refs ?? []).some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && sameName(ref as FaceName, face));

const sketch = (id: Id, plane: PlaneRef): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const onFace = (body: Id, face: FaceName): PlaneRef => ({ kind: 'face', body, face });
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const point = (s: Id, id: Id, x: number, y: number): Command => ({ type: 'addPoint', sketch: s, id, x, y });
const line = (s: Id, id: Id, a: Id, b: Id): Command => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
const circle = (s: Id, id: Id, x: number, y: number, radius: number): Command[] => [point(s, `${id}c`, x, y), { type: 'addCurve', sketch: s, id, curve: { type: 'circle', center: `${id}c` }, radius }];
// A polygon of lines `${p}0`, `${p}1`, … between points `${p}p0`, `${p}p1`, …
function polygon(s: Id, p: string, corners: [number, number][]): Command[] {
  return [...corners.map(([x, y], i) => point(s, `${p}p${i}`, x, y)), ...corners.map((_, i) => line(s, `${p}${i}`, `${p}p${i}`, `${p}p${(i + 1) % corners.length}`))];
}
const curvesOf = (p: string, n: number): Id[] => Array.from({ length: n }, (_, i) => `${p}${i}`);
function extrude(id: Id, s: Id, regions: Id[][], distance: number, operation: 'new' | 'add' | 'cut' = 'new', target?: Id, taper?: number, index?: number): Command {
  return {
    type: 'addFeature',
    feature: { ...base(id), type: 'extrude', profile: { type: 'regions', sketch: s, regions: regions.map((outer) => ({ outerLoop: [...outer].sort() })) }, extent: { type: 'distance', start: 0, distance, ...(taper ? { taper } : {}) }, operation, ...(target ? { targets: [target] } : {}) },
    ...(index === undefined ? {} : { index }),
  };
}

// ================================================================ a. the housing

// A plate 80 × 80 × 8, a bore of radius 29.5 through it, 16 pockets of radius 2.5 on the circle of
// radius 29, 4 deep from the top: each cuts into the wall of the bore.
const POCKETS = Array.from({ length: 16 }, (_, k) => `k${k}`);
// The top rim of the bore: one edge of 16 arcs, each ending at a pocket.
const RIM = edge(top('plate'), side('bore', 'h'));
const HUB_RIM = edge(top('hub'), side('hubBore', 'g'));
const FOOT = edge(top('deck'), side('rib', 'r0'));
const RIB_TOP = edge(top('rib'), side('rib', 'r0'));
const SHAFT_Y = -100;
const SLOT_EDGES = [edge(top('shaft'), side('slot', 't0')), edge(top('shaft'), side('slot', 't2'))];
const TOP_FRONT = edge(top('box'), side('box', 'n0'));

describe('scenario 17: chamfers and fillets of edges that run out into round faces (4c, D67)', () => {
  let housed: EngineState;
  it('a. the housing: the rim of the bore broken by 16 pin pockets gets a chamfer of 0.5, one cone meeting every pocket', () => {
    housed = run(
      { type: 'setParameter', name: 'pinR', expr: '2.5' },
      sketch('plateSketch', XY),
      ...polygon('plateSketch', 'o', [
        [-40, -40],
        [40, -40],
        [40, 40],
        [-40, 40],
      ]),
      extrude('plate', 'plateSketch', [curvesOf('o', 4)], 8),
      sketch('boreSketch', onFace('plate', top('plate'))),
      ...circle('boreSketch', 'h', 0, 0, 29.5),
      extrude('bore', 'boreSketch', [['h']], -10, 'cut', 'plate'),
      sketch('pins', onFace('plate', top('plate'))),
      ...POCKETS.flatMap((id, k): Command[] => [...circle('pins', id, 29 * Math.cos((k * Math.PI) / 8), 29 * Math.sin((k * Math.PI) / 8), 2.5), { type: 'addConstraint', sketch: 'pins', id: `${id}r`, constraint: { type: 'radius', curve: id, value: 'pinR', driving: true } }]),
      extrude('pockets', 'pins', POCKETS.map((id) => [id]), -4, 'cut', 'plate'),
    );
    expectAllOk(housed);
    // Chamfer 2 of the actuator: each arc runs on into its pockets until the corner has crossed the
    // pocket's wall (they cross at 76°). Measured: 13.782 mm³ taken at the chord tolerance 0.01 (the
    // chamfer made before the pockets: 13.763).
    const after = run(chamfer('rimChamfer', 'plate', [RIM], 0.5));
    expectAllOk(after);
    const cone = surfaceOf(after, 'plate', chamferFace('rimChamfer', 0));
    expect(cone?.kind).toBe('cone');
    if (cone?.kind === 'cone') near(cone.halfAngle, Math.PI / 4, 1e-9);
    for (const id of POCKETS) expect(touches(after, 'plate', chamferFace('rimChamfer', 0), side('pockets', id)), id).toBe(true);
    const facts = after.evaluation.features.rimChamfer.facts ?? {};
    expect(facts['setback/0']).toBe(0.5);
    expect(facts['cut/0']).toBe(true);
    near(volume(housed, 'plate') - volume(after, 'plate'), 13.78, 0.05);
  });

  it('a. the pockets cut a second time flush with the first, before the chamfer: it still runs out into every pocket and takes the same volume', () => {
    const before = engine.getState();
    const index = before.document.features.findIndex((f) => f.id === 'rimChamfer');
    const commands: Command[] = [
      { type: 'addFeature', feature: emptySketch('pinsAgain', 'pinsAgain', onFace('plate', top('plate'))), index },
      ...POCKETS.flatMap((id, k): Command[] => circle('pinsAgain', `${id}f`, 29 * Math.cos((k * Math.PI) / 8), 29 * Math.sin((k * Math.PI) / 8), 2.5)),
      extrude('pocketsAgain', 'pinsAgain', POCKETS.map((id) => [`${id}f`]), -2, 'cut', 'plate', undefined, index + 1),
    ];
    const after = done(engine.preview({ type: 'batch', commands }, 'rimChamfer'));
    expect(after.evaluation.features.rimChamfer?.error?.message ?? 'ok').toBe('ok');
    near(volume(after, 'plate'), volume(before, 'plate'), 1e-3);
  });

  it('b. a hub whose bore a keyway breaks: the chamfer of its rim runs out past the keyway\'s sides, planes off its axis', () => {
    run(
      sketch('hubSketch', XY),
      ...polygon('hubSketch', 'u', [
        [60, -20],
        [100, -20],
        [100, 20],
        [60, 20],
      ]),
      extrude('hub', 'hubSketch', [curvesOf('u', 4)], 8),
      sketch('hubBoreSketch', onFace('hub', top('hub'))),
      ...circle('hubBoreSketch', 'g', 80, 0, 10),
      extrude('hubBore', 'hubBoreSketch', [['g']], -10, 'cut', 'hub'),
      sketch('keySketch', onFace('hub', top('hub'))),
      ...polygon('keySketch', 'y', [
        [80, -1.5],
        [93, -1.5],
        [93, 1.5],
        [80, 1.5],
      ]),
      extrude('keyway', 'keySketch', [curvesOf('y', 4)], -4, 'cut', 'hub'),
    );
    const before = volume(engine.getState(), 'hub');
    // Measured: 7.705 mm³ taken by a chamfer of 0.5 at 0.01 (made before the keyway: 7.704).
    const state = run(chamfer('hubChamfer', 'hub', [HUB_RIM], 0.5));
    expectAllOk(state);
    expect(surfaceOf(state, 'hub', chamferFace('hubChamfer', 0))?.kind).toBe('cone');
    for (const wall of ['y0', 'y2']) expect(touches(state, 'hub', chamferFace('hubChamfer', 0), side('keyway', wall)), wall).toBe(true);
    near(before - volume(state, 'hub'), 7.705, 0.01);
  });

  it('c. the concave foot of a rib running into a boss gets a fillet of 1.5 that runs out inside the boss', () => {
    const ribbed = run(
      sketch('deckSketch', XY),
      ...polygon('deckSketch', 'd', [
        [0, 100],
        [60, 100],
        [60, 140],
        [0, 140],
      ]),
      extrude('deck', 'deckSketch', [curvesOf('d', 4)], 5),
      sketch('ribSketch', onFace('deck', top('deck'))),
      ...polygon('ribSketch', 'r', [
        [5, 119],
        [36, 119],
        [36, 121],
        [5, 121],
      ]),
      extrude('rib', 'ribSketch', [curvesOf('r', 4)], 10, 'add', 'deck'),
      sketch('bossSketch', onFace('deck', top('deck'))),
      ...circle('bossSketch', 'b', 36, 120, 6),
      extrude('boss', 'bossSketch', [['b']], 15, 'add', 'deck'),
    );
    // Measured: 12.333 mm³ added by a fillet of 1.5 at 0.01, equal to the fillet made before the boss.
    const after = run(fillet('ribFoot', 'deck', [FOOT], 1.5));
    expectAllOk(after);
    const foot = surfaceOf(after, 'deck', filletFace('ribFoot', 0));
    expect(foot?.kind).toBe('cylinder');
    if (foot?.kind === 'cylinder') {
      near(foot.radius, 1.5, 1e-9);
      near(Math.abs(foot.axis[0]), 1, 1e-9);
    }
    expect(touches(after, 'deck', filletFace('ribFoot', 0), side('boss', 'b'))).toBe(true);
    expect(after.evaluation.features.ribFoot.facts?.['cut/0']).toBe(false);
    near(volume(after, 'deck') - volume(ribbed, 'deck'), 12.333, 0.01);
  });

  it('d. the motor shaft: the top edges of a slot out through its cylinder get a chamfer of 0.5, nothing outside its radius', () => {
    const h = 2 * Math.sqrt(3);
    const s = Math.sqrt(3);
    const corners = Array.from({ length: 6 }, (_, k): [number, number] => [h * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), SHAFT_Y + h * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
    const before = run(
      sketch('shaftSketch', XY),
      ...circle('shaftSketch', 'c', 0, SHAFT_Y, 6),
      extrude('shaft', 'shaftSketch', [['c']], 20),
      sketch('socketSketch', onFace('shaft', top('shaft'))),
      ...polygon('socketSketch', 'x', corners),
      extrude('socket', 'socketSketch', [curvesOf('x', 6)], -5, 'cut', 'shaft'),
      sketch('slotSketch', onFace('shaft', top('shaft'))),
      ...polygon('slotSketch', 't', [
        [3, SHAFT_Y - s],
        [7, SHAFT_Y - s],
        [7, SHAFT_Y + s],
        [3, SHAFT_Y + s],
      ]),
      extrude('slot', 'slotSketch', [curvesOf('t', 4)], -2, 'cut', 'shaft'),
    );
    // Measured: 0.372 mm³ per edge at 0.01 (exact: 0.373).
    const state = run(chamfer('slotChamfer', 'shaft', SLOT_EDGES, 0.5));
    expectAllOk(state);
    for (const i of [0, 1]) {
      expect(surfaceOf(state, 'shaft', chamferFace('slotChamfer', i))?.kind).toBe('plane');
      expect(touches(state, 'shaft', chamferFace('slotChamfer', i), side('shaft', 'c'))).toBe(true);
    }
    near(volume(before, 'shaft') - volume(state, 'shaft'), 2 * 0.373, 0.01);
    // nothing of the shaft lies outside its cylinder
    const p = state.evaluation.bodies.shaft.solid.positions;
    let outside = 0;
    for (let i = 0; i < p.length; i += 3) outside = Math.max(outside, Math.hypot(p[i], p[i + 1] - SHAFT_Y) - 6);
    expect(outside).toBeLessThanOrEqual(1e-4);
  });

  it('e. a box whose top edge a hole notches: a chamfer of 1 runs out into the hole, one of 2 passes behind it and is refused as a bridge', () => {
    run(
      sketch('boxSketch', XY),
      ...polygon('boxSketch', 'n', [
        [200, 0],
        [260, 0],
        [260, 40],
        [200, 40],
      ]),
      extrude('box', 'boxSketch', [curvesOf('n', 4)], 20),
      sketch('notchSketch', onFace('box', top('box'))),
      ...circle('notchSketch', 'q', 230, -2.5, 4),
      extrude('notch', 'notchSketch', [['q']], -25, 'cut', 'box'),
    );
    const bridge = refusalAfter('notch', chamfer('notchBridge', 'box', [TOP_FRONT], 2));
    expect(bridge?.code).toBe('unsupportedEdge');
    expect(names(bridge, side('notch', 'q'))).toBe(true);
    expect(bridge?.message).toMatch(/passes behind the end face in refs before it crosses it.*before the feature that makes that face/);
    const accepted = run(chamfer('notchChamfer', 'box', [TOP_FRONT], 1));
    expectAllOk(accepted);
    expect(touches(accepted, 'box', chamferFace('notchChamfer', 0), side('notch', 'q'))).toBe(true);
  });

  it('f. what is refused: stops, two faces at an end, an edge between two cylinders, a cone, a crossing too flat, an earlier fillet, a pin in the void, shallow pockets', () => {
    const flat = 4 * Math.cos((8 * Math.PI) / 180); // the centre behind the front face: a crossing of 8°
    const pinX = 530 - Math.sqrt(12) + 0.75; // 0.75 past the end of the edge at the hole (centre 2 in front)
    run(
      // a disc of radius 30 with a fin to x 28, both trimmed to the radius 25 by one cut (the motor
      // shell): the fin's end and the disc's rim are one face of the cut, so the fin's foot ends at
      // that face alone (calls.ts made the fin's end an arc flush with the disc's side; at y 200 its
      // polygon stood a sliver past the disc's, which left two faces at the end, see "As implemented")
      sketch('discSketch', XY),
      ...circle('discSketch', 'w', 0, 200, 30),
      extrude('disc', 'discSketch', [['w']], 5),
      sketch('finSketch', onFace('disc', top('disc'))),
      ...polygon('finSketch', 'f', [
        [0, 199],
        [28, 199],
        [28, 201],
        [0, 201],
      ]),
      extrude('fin', 'finSketch', [curvesOf('f', 4)], 8, 'add', 'disc'),
      sketch('trimSketch', XY),
      ...circle('trimSketch', 'ti', 0, 200, 25),
      ...circle('trimSketch', 'tj', 0, 200, 40),
      extrude('trim', 'trimSketch', [['tj']], 20, 'cut', 'disc'),
      sketch('lobeSketch', XY),
      ...circle('lobeSketch', 'l1', -198.5, 0, 10),
      extrude('lobe', 'lobeSketch', [['l1']], 5),
      sketch('upperSketch', onFace('lobe', top('lobe'))),
      ...circle('upperSketch', 'l2', -201.5, 0, 10),
      extrude('upper', 'upperSketch', [['l2']], 5, 'add', 'lobe'),
      sketch('flatSketch', XY),
      ...polygon('flatSketch', 'm', [
        [300, 0],
        [360, 0],
        [360, 40],
        [300, 40],
      ]),
      extrude('flatBox', 'flatSketch', [curvesOf('m', 4)], 20),
      sketch('flatHoleSketch', onFace('flatBox', top('flatBox'))),
      ...circle('flatHoleSketch', 'v', 330, flat, 4),
      extrude('flatHole', 'flatHoleSketch', [['v']], -25, 'cut', 'flatBox'),
      sketch('sinkSketch', XY),
      ...polygon('sinkSketch', 'z', [
        [400, 0],
        [460, 0],
        [460, 40],
        [400, 40],
      ]),
      extrude('sinkBox', 'sinkSketch', [curvesOf('z', 4)], 20),
      sketch('sinkHoleSketch', onFace('sinkBox', top('sinkBox'))),
      ...circle('sinkHoleSketch', 'j', 430, 0, 4),
      extrude('sinkHole', 'sinkHoleSketch', [['j']], -25, 'cut', 'sinkBox', 0.3),
      sketch('pinBoxSketch', XY),
      ...polygon('pinBoxSketch', 'a', [
        [500, 0],
        [560, 0],
        [560, 40],
        [500, 40],
      ]),
      extrude('pinBox', 'pinBoxSketch', [curvesOf('a', 4)], 20),
      sketch('pinHoleSketch', onFace('pinBox', top('pinBox'))),
      ...circle('pinHoleSketch', 'i', 530, -2, 4),
      extrude('pinHole', 'pinHoleSketch', [['i']], -25, 'cut', 'pinBox'),
      sketch('pinSketch', XY),
      ...circle('pinSketch', 'e', pinX, 0.5, 0.2),
      extrude('pin', 'pinSketch', [['e']], 20, 'add', 'pinBox'),
      // in the plane YZ: (y, z); the body runs along X from 0 to 60, y from 600 to 640, its top
      // falling from 20 at the front to 16 at the back
      sketch('leanSketch', { kind: 'base', plane: 'YZ' }),
      ...polygon('leanSketch', 'g', [
        [600, 0],
        [640, 0],
        [640, 16],
        [600, 20],
      ]),
      extrude('lean', 'leanSketch', [curvesOf('g', 4)], 60),
      fillet('leanCorner', 'lean', [edge(side('lean', 'g3'), top('lean'))], 5),
    );
    expectAllOk(engine.getState());
    const unsupported = (issue: Issue | undefined, face: FaceName): void => {
      expect(issue?.code, issue?.message).toBe('unsupportedEdge');
      expect(issue?.message.startsWith(MESSAGE.unsupportedEdge), issue?.message).toBe(true);
      expect(names(issue, face), `${JSON.stringify(issue?.refs)} names ${JSON.stringify(face)}`).toBe(true);
    };
    // stops: the rib's top edge into the boss's wall; the foot of the disc's rib past the rim it is
    // flush with
    const ribTop = refusalAfter('boss', chamfer('e1', 'deck', [RIB_TOP], 1));
    unsupported(ribTop, side('boss', 'b'));
    expect(ribTop?.message).toMatch(/material of the end face/);
    const disc = refusalAfter('trim', chamfer('e2', 'disc', [edge(top('disc'), side('fin', 'f2'))], 4));
    unsupported(disc, side('trim', 'ti'));
    expect(disc?.message).toMatch(/past the end face/);
    // two faces at an end: the rim of the lower lobe meets the upper lobe's side and its underside
    // where it overhangs (both named in refs)
    const lobe = refusalAfter('upper', chamfer('e3', 'lobe', [edge(top('lobe'), side('lobe', 'l1'))], 0.5));
    unsupported(lobe, side('upper', 'l2'));
    expect(names(lobe, { feature: 'upper', role: 'startCap' })).toBe(true);
    // an edge between two cylinders (a pocket and the bore): of the kind `other`, as in D63
    const ridge = refusalAfter('pockets', fillet('e4', 'plate', [edge(side('bore', 'h'), side('pockets', 'k0'))], 1));
    expect(ridge?.code).toBe('unsupportedEdge');
    // an end at a cone (a tapered hole); a crossing of 8°, under BLEND_MIN_CROSSING
    unsupported(refusalAfter('sinkHole', chamfer('e5', 'sinkBox', [edge(top('sinkBox'), side('sinkBox', 'z0'))], 1)), side('sinkHole', 'j'));
    const flatIssue = refusalAfter('flatHole', chamfer('e6', 'flatBox', [edge(top('flatBox'), side('flatBox', 'm0'))], 1));
    expect(BLEND_MIN_CROSSING).toBeGreaterThan((8 * Math.PI) / 180);
    unsupported(flatIssue, side('flatHole', 'v'));
    expect(flatIssue?.message).toMatch(/at 8°, less than 10°/);
    // an end at an earlier fillet: the leaning top-front edge runs on smoothly into the fillet of the
    // corner, along the edge between the leaning top and the fillet (of the kind other); D63 advised
    // adding that edge to the feature
    const earlier = refusalAfter('leanCorner', chamfer('e7', 'lean', [edge(side('lean', 'g2'), side('lean', 'g3'))], 1));
    unsupported(earlier, filletFace('leanCorner', 0));
    expect(earlier?.message).not.toMatch(/add it to this feature/);
    // the void check: a pin standing in the hole where the chamfer runs on (measured: 0.046 mm³ of it
    // would be taken); pockets 0.1 deep, whose floors the run-out of the rim's chamfer reaches
    const pinned = refusalAfter('pin', chamfer('e8', 'pinBox', [edge(top('pinBox'), side('pinBox', 'a0'))], 1));
    expect(pinned?.code, pinned?.message).toBe('blendDoesNotFit');
    expect(names(pinned, side('pinHole', 'i'))).toBe(true);
    expect(pinned?.message).toMatch(/would take .* mm³ beyond the end face in refs within its run-out/);
    const shallow = done(engine.preview({ type: 'updateFeature', id: 'pockets', patch: { extent: { type: 'distance', start: 0, distance: -0.1 } } }, 'rimChamfer'));
    const shallowError = shallow.evaluation.features.rimChamfer?.error;
    expect(shallowError?.code, shallowError?.message).toBe('blendDoesNotFit');
    expect(POCKETS.some((id) => names(shallowError, side('pockets', id)))).toBe(true);
  });

  it('g. wider pockets keep every face and the run-outs; save and load give the same volumes and keep the schema version (no step)', () => {
    const before = engine.getState();
    const after = done(engine.preview({ type: 'setParameter', name: 'pinR', expr: '2.8' }));
    expectAllOk(after);
    for (const face of before.evaluation.bodies.plate.faces) expect(after.evaluation.bodies.plate.faces.some((other) => sameName(after.evaluation.faceNames[other.id], before.evaluation.faceNames[face.id]))).toBe(true);
    for (const id of POCKETS) expect(touches(after, 'plate', chamferFace('rimChamfer', 0), side('pockets', id)), id).toBe(true);
    const loaded = done(engine.load(engine.save()));
    for (const id of Object.keys(before.evaluation.bodies)) expect(loaded.evaluation.bodies[id].volume, id).toBe(before.evaluation.bodies[id].volume);
    expect(loaded.document.schemaVersion).toBe(before.document.schemaVersion);
    expect(housed).toBeDefined();
  });
});
