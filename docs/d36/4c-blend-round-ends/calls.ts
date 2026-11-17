// Validation scenario 17 (blends that run out into round faces; the conversion of a cycloidal
// actuator from Onshape), written as calls against the contract of package 4c. Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. After the implementation it becomes `packages/scenarios/test/scenario17.test.ts`.
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
// f. what is refused: stops (a rib's top edge into the boss, a rib's foot flush with the rim of a
//    disc, the rim of a lobe under another lobe), an edge between two cylinders, an end at a cone,
//    a crossing too flat, pockets too shallow for the chamfer. Each refusal is a preview of the
//    feature inserted right after the feature it is about, evaluated up to it.
// Then a change of parameters, and a save and load.

import { emptySketch } from '../../../packages/engine/src/index';
import type { Id } from '../../../packages/engine/src/index';
import type { CommandAfter, EdgeNameAfter, FaceNameAfter, IssueAfter, PlaneRefAfter, StateAfter } from '../00-prep/contract';
import { XY, done, engine, onFace, run, sameName } from '../2a-offset/calls';
import type { StateD, SurfaceD } from '../4a-revolve/contract';
import type { ChamferFeature, FilletFeature } from '../4b-edge-chamfer-fillet/contract';
import { BLEND_MIN_CROSSING, MESSAGE_UNSUPPORTED_EDGE } from './contract';

// ---------------------------------------------------------------- helpers over existing commands

const near = (value: number | undefined, expected: number, tolerance = 1e-6): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => ['ok', 'warning'].includes(state.evaluation.features[feature.id].status));
const withSurfaces = (state: StateAfter): StateD => state;
function surfaceOf(state: StateAfter, body: Id, name: FaceNameAfter): SurfaceD | undefined {
  const d = withSurfaces(state);
  const face = d.evaluation.bodies[body]?.faces.find((f) => sameName(d.evaluation.faceNames[f.id], name));
  return face ? d.evaluation.faceSurfaces[face.id] : undefined;
}
const side = (feature: Id, curve: Id): FaceNameAfter => ({ feature, role: 'side', curve });
const top = (feature: Id): FaceNameAfter => ({ feature, role: 'endCap' });
const edge = (a: FaceNameAfter, b: FaceNameAfter): EdgeNameAfter => ({ a, b });
const chamferFace = (feature: Id, i: number): FaceNameAfter => ({ feature, role: 'chamfer', edge: i });
const filletFace = (feature: Id, i: number): FaceNameAfter => ({ feature, role: 'fillet', edge: i });
const base = (id: Id) => ({ id, name: id, suppressed: false });
type Blend = ChamferFeature | FilletFeature;
const chamfer = (id: Id, body: Id, edges: EdgeNameAfter[], distance: number): Blend => ({ ...base(id), type: 'chamfer', body, edges, distance });
const fillet = (id: Id, body: Id, edges: EdgeNameAfter[], radius: number): Blend => ({ ...base(id), type: 'fillet', body, edges, radius });
const add = (feature: Blend, index?: number): CommandAfter => (feature.type === 'chamfer' ? { type: 'addFeature', feature, index } : { type: 'addFeature', feature, index });
// Two faces of a body meet along an edge.
const touches = (state: StateAfter, body: Id, a: FaceNameAfter, b: FaceNameAfter): boolean => state.evaluation.bodies[body].edges.some((e) => (sameName(e.name.a, a) && sameName(e.name.b, b)) || (sameName(e.name.a, b) && sameName(e.name.b, a)));
const volume = (state: StateAfter, body: Id): number => state.evaluation.bodies[body].volume;
// The error of a feature inserted right after `after` and evaluated up to itself: the refusal of
// an edge at the place of the timeline where the edge exists.
function refusalAfter(after: Id, feature: Blend): IssueAfter | undefined {
  const index = engine.getState().document.features.findIndex((f) => f.id === after) + 1;
  return done(engine.preview(add(feature, index), feature.id)).evaluation.features[feature.id]?.error;
}
const names = (issue: IssueAfter | undefined, face: FaceNameAfter): boolean => (issue?.refs ?? []).some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && sameName(ref as FaceNameAfter, face));

const sketch = (id: Id, plane: PlaneRefAfter): CommandAfter[] => [{ type: 'addFeature', feature: emptySketch(id, id, { kind: 'base', plane: 'XY' }) }, { type: 'setSketchPlane', sketch: id, plane }];
const point = (s: Id, id: Id, x: number, y: number): CommandAfter => ({ type: 'addPoint', sketch: s, id, x, y });
const line = (s: Id, id: Id, a: Id, b: Id): CommandAfter => ({ type: 'addCurve', sketch: s, id, curve: { type: 'line', a, b } });
const circle = (s: Id, id: Id, x: number, y: number, radius: number): CommandAfter[] => [point(s, `${id}c`, x, y), { type: 'addCurve', sketch: s, id, curve: { type: 'circle', center: `${id}c` }, radius }];
// A polygon of lines `${p}0`, `${p}1`, … between points `${p}p0`, `${p}p1`, …
function polygon(s: Id, p: string, corners: [number, number][]): CommandAfter[] {
  return [...corners.map(([x, y], i) => point(s, `${p}p${i}`, x, y)), ...corners.map((_, i) => line(s, `${p}${i}`, `${p}p${i}`, `${p}p${(i + 1) % corners.length}`))];
}
const curvesOf = (p: string, n: number): Id[] => Array.from({ length: n }, (_, i) => `${p}${i}`);
function extrude(id: Id, s: Id, regions: Id[][], distance: number, operation: 'new' | 'add' | 'cut' = 'new', target?: Id, taper?: number): CommandAfter {
  return { type: 'addFeature', feature: { ...base(id), type: 'extrude', profile: { type: 'regions', sketch: s, regions: regions.map((outer) => ({ outerLoop: [...outer].sort() })) }, extent: { type: 'distance', start: 0, distance, ...(taper ? { taper } : {}) }, operation, ...(target ? { targets: [target] } : {}) } };
}

// ================================================================ a. the housing

// A plate 80 × 80 × 8, a bore of radius 29.5 through it, 16 pockets of radius 2.5 on the circle of
// radius 29, 4 deep from the top: each cuts into the wall of the bore.
export const POCKETS = Array.from({ length: 16 }, (_, k) => `k${k}`);
export function housing(): StateAfter {
  return run(
    { type: 'setParameter', name: 'pinR', expr: '2.5' },
    ...sketch('plateSketch', XY),
    ...polygon('plateSketch', 'o', [[-40, -40], [40, -40], [40, 40], [-40, 40]]),
    extrude('plate', 'plateSketch', [curvesOf('o', 4)], 8),
    ...sketch('boreSketch', onFace('plate', top('plate'))),
    ...circle('boreSketch', 'h', 0, 0, 29.5),
    extrude('bore', 'boreSketch', [['h']], -10, 'cut', 'plate'),
    ...sketch('pins', onFace('plate', top('plate'))),
    ...POCKETS.flatMap((id, k): CommandAfter[] => [...circle('pins', id, 29 * Math.cos((k * Math.PI) / 8), 29 * Math.sin((k * Math.PI) / 8), 2.5), { type: 'addConstraint', sketch: 'pins', id: `${id}r`, constraint: { type: 'radius', curve: id, value: 'pinR', driving: true } }]),
    extrude('pockets', 'pins', POCKETS.map((id) => [id]), -4, 'cut', 'plate'),
  );
}
// The top rim of the bore: one edge of 16 arcs, each ending at a pocket.
export const RIM: EdgeNameAfter = edge(top('plate'), side('bore', 'h'));
// Chamfer 2 of the actuator: the rim by 0.5. Each arc runs on into its pockets until the corner has
// crossed the pocket's wall (they cross at 76°): one cone, meeting every pocket's wall. Measured:
// 13.782 mm³ taken at the chord tolerance 0.01 (the chamfer made before the pockets: 13.763).
export function rimChamfer(): StateAfter {
  return run(add(chamfer('rimChamfer', 'plate', [RIM], 0.5)));
}
export function rimChecks(before: StateAfter, after: StateAfter): boolean {
  const cone = surfaceOf(after, 'plate', chamferFace('rimChamfer', 0));
  const coneOk = cone?.kind === 'cone' && near(cone.halfAngle, Math.PI / 4, 1e-9);
  const meetsEveryPocket = POCKETS.every((id) => touches(after, 'plate', chamferFace('rimChamfer', 0), side('pockets', id)));
  const facts = after.evaluation.features['rimChamfer'].facts ?? {};
  const taken = volume(before, 'plate') - volume(after, 'plate');
  return coneOk && meetsEveryPocket && facts['setback/0'] === 0.5 && facts['cut/0'] === true && Math.abs(taken - 13.78) < 0.05 && allOk(after);
}

// ================================================================ b. a hub with a keyway

// A plate 40 × 40 × 8 with a bore of radius 10 and a keyway 3 wide cut radially through the bore's
// wall, 4 deep: the rim's arc ends at the keyway's sides, planes parallel to the axis and off it.
export function hub(): StateAfter {
  return run(
    ...sketch('hubSketch', XY),
    ...polygon('hubSketch', 'u', [[60, -20], [100, -20], [100, 20], [60, 20]]),
    extrude('hub', 'hubSketch', [curvesOf('u', 4)], 8),
    ...sketch('hubBoreSketch', onFace('hub', top('hub'))),
    ...circle('hubBoreSketch', 'g', 80, 0, 10),
    extrude('hubBore', 'hubBoreSketch', [['g']], -10, 'cut', 'hub'),
    ...sketch('keySketch', onFace('hub', top('hub'))),
    ...polygon('keySketch', 'y', [[80, -1.5], [93, -1.5], [93, 1.5], [80, 1.5]]),
    extrude('keyway', 'keySketch', [curvesOf('y', 4)], -4, 'cut', 'hub'),
  );
}
export const HUB_RIM: EdgeNameAfter = edge(top('hub'), side('hubBore', 'g'));
// Measured: 7.705 mm³ taken by a chamfer of 0.5 at 0.01 (made before the keyway: 7.704).
export function hubChamfer(): StateAfter {
  return run(add(chamfer('hubChamfer', 'hub', [HUB_RIM], 0.5)));
}
export function hubChecks(state: StateAfter): boolean {
  const walls = ['y0', 'y2'].every((wall) => touches(state, 'hub', chamferFace('hubChamfer', 0), side('keyway', wall)));
  return surfaceOf(state, 'hub', chamferFace('hubChamfer', 0))?.kind === 'cone' && walls && allOk(state);
}

// ================================================================ c. a rib running into a boss

// A plate 60 × 40 × 5, a rib from x 5 to the boss (2 wide, 10 high), a boss of radius 6 at
// (36, 20), 15 high; placed at y + 100 so it stands apart from the other parts.
export function ribAndBoss(): StateAfter {
  return run(
    ...sketch('deckSketch', XY),
    ...polygon('deckSketch', 'd', [[0, 100], [60, 100], [60, 140], [0, 140]]),
    extrude('deck', 'deckSketch', [curvesOf('d', 4)], 5),
    ...sketch('ribSketch', onFace('deck', top('deck'))),
    ...polygon('ribSketch', 'r', [[5, 119], [36, 119], [36, 121], [5, 121]]),
    extrude('rib', 'ribSketch', [curvesOf('r', 4)], 10, 'add', 'deck'),
    ...sketch('bossSketch', onFace('deck', top('deck'))),
    ...circle('bossSketch', 'b', 36, 120, 6),
    extrude('boss', 'bossSketch', [['b']], 15, 'add', 'deck'),
  );
}
// The rib's side y = 119 is `r0`: its foot (with the deck's top) is concave and runs into the boss
// (they cross at 80°); its other end is the rib's end plane x = 5 (D63).
export const FOOT: EdgeNameAfter = edge(top('deck'), side('rib', 'r0'));
export const RIB_TOP: EdgeNameAfter = edge(top('rib'), side('rib', 'r0'));
// Measured: 12.333 mm³ added by a fillet of 1.5 at 0.01, equal to the fillet made before the boss.
export function ribFoot(): StateAfter {
  return run(add(fillet('ribFoot', 'deck', [FOOT], 1.5)));
}
export function ribChecks(before: StateAfter, after: StateAfter): boolean {
  const foot = surfaceOf(after, 'deck', filletFace('ribFoot', 0));
  const footOk = foot?.kind === 'cylinder' && near(foot.radius, 1.5, 1e-9) && near(Math.abs(foot.axis[0]), 1, 1e-9);
  const meetsBoss = touches(after, 'deck', filletFace('ribFoot', 0), side('boss', 'b'));
  const added = volume(after, 'deck') - volume(before, 'deck');
  return footOk && meetsBoss && after.evaluation.features['ribFoot'].facts?.['cut/0'] === false && Math.abs(added - 12.333) < 0.01 && allOk(after);
}

// ================================================================ d. the motor shaft

// A shaft of radius 6, 20 long, at (0, −100), with a hexagonal socket (circumradius 2√3, corners at
// ±30°) 5 deep and a slot from the socket's corners (3, ±√3) out through the shaft, 2 deep.
const SHAFT_Y = -100;
export function shaft(): StateAfter {
  const h = 2 * Math.sqrt(3);
  const s = Math.sqrt(3);
  const corners = Array.from({ length: 6 }, (_, k): [number, number] => [h * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), SHAFT_Y + h * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
  return run(
    ...sketch('shaftSketch', XY),
    ...circle('shaftSketch', 'c', 0, SHAFT_Y, 6),
    extrude('shaft', 'shaftSketch', [['c']], 20),
    ...sketch('socketSketch', onFace('shaft', top('shaft'))),
    ...polygon('socketSketch', 'x', corners),
    extrude('socket', 'socketSketch', [curvesOf('x', 6)], -5, 'cut', 'shaft'),
    ...sketch('slotSketch', onFace('shaft', top('shaft'))),
    ...polygon('slotSketch', 't', [[3, SHAFT_Y - s], [7, SHAFT_Y - s], [7, SHAFT_Y + s], [3, SHAFT_Y + s]]),
    extrude('slot', 'slotSketch', [curvesOf('t', 4)], -2, 'cut', 'shaft'),
  );
}
// The slot's two top edges, convex: each runs out through the shaft's cylinder into the air outside
// it (they cross it at 73°); the other end is a face of the socket (D63's planar end).
export const SLOT_EDGES: EdgeNameAfter[] = [edge(top('shaft'), side('slot', 't0')), edge(top('shaft'), side('slot', 't2'))];
// The chamfer of the actuator's shaft, 0.5. Measured: 0.372 mm³ per edge at 0.01 (exact: 0.373).
export function slotChamfer(): StateAfter {
  return run(add(chamfer('slotChamfer', 'shaft', SLOT_EDGES, 0.5)));
}
export function slotChecks(state: StateAfter): boolean {
  const planes = [0, 1].every((i) => surfaceOf(state, 'shaft', chamferFace('slotChamfer', i))?.kind === 'plane');
  const meetsCylinder = [0, 1].every((i) => touches(state, 'shaft', chamferFace('slotChamfer', i), side('shaft', 'c')));
  // nothing of the shaft lies outside its cylinder (a chamfer ending in the plane across the edge
  // would leave nothing outside either, but would not meet the cylinder along a curve; a tool that
  // ran on too far would cut, not add, so the check is that no vertex is outside the radius)
  const p = state.evaluation.bodies['shaft'].solid.positions;
  let outside = 0;
  for (let i = 0; i < p.length; i += 3) outside = Math.max(outside, Math.hypot(p[i], p[i + 1] - SHAFT_Y) - 6);
  return planes && meetsCylinder && outside <= 1e-4 && allOk(state);
}

// ================================================================ e. a box whose top edge a hole breaks

// A box 60 × 40 × 20 at x + 200 with a hole of radius 4 through it whose centre lies 2.5 in front of
// the front face: it notches the top-front edge 1.5 deep and crosses it at 51°.
export function notchedBox(): StateAfter {
  return run(
    ...sketch('boxSketch', XY),
    ...polygon('boxSketch', 'n', [[200, 0], [260, 0], [260, 40], [200, 40]]),
    extrude('box', 'boxSketch', [curvesOf('n', 4)], 20),
    ...sketch('notchSketch', onFace('box', top('box'))),
    ...circle('notchSketch', 'q', 230, -2.5, 4),
    extrude('notch', 'notchSketch', [['q']], -25, 'cut', 'box'),
  );
}
export const TOP_FRONT: EdgeNameAfter = edge(top('box'), side('box', 'n0'));
// A chamfer of 1 runs out into the notch (the corner crosses it before the far piece): accepted.
// A chamfer of 2 passes behind the notch: refused as a bridge, naming the hole's face and saying to
// chamfer the edge before the hole.
export function notchChecks(): boolean {
  const accepted = run(add(chamfer('notchChamfer', 'box', [TOP_FRONT], 1)));
  const meets = touches(accepted, 'box', chamferFace('notchChamfer', 0), side('notch', 'q'));
  const bridge = refusalAfter('notch', chamfer('notchBridge', 'box', [TOP_FRONT], 2));
  return meets && allOk(accepted) && bridge?.code === 'unsupportedEdge' && names(bridge, side('notch', 'q')) && /before/.test(bridge.message);
}

// ================================================================ f. what is refused

// A disc of radius 25 at (0, 200) with a radial rib flush with its rim (the motor shell); two
// eccentric lobes stacked at (−200, 0) (the input shaft); a box with a hole crossing its edge at 8°;
// a box with a countersunk (tapered) hole through its edge.
export function refusedParts(): StateAfter {
  const end = Math.sqrt(25 * 25 - 1);
  const flat = 4 * Math.cos((8 * Math.PI) / 180); // the centre behind the front face: a crossing of 8°
  return run(
    ...sketch('discSketch', XY),
    ...circle('discSketch', 'w', 0, 200, 25),
    extrude('disc', 'discSketch', [['w']], 5),
    ...sketch('finSketch', onFace('disc', top('disc'))),
    point('finSketch', 'fa', 0, 199),
    point('finSketch', 'fb', end, 199),
    point('finSketch', 'fc', end, 201),
    point('finSketch', 'fd', 0, 201),
    point('finSketch', 'fo', 0, 200),
    line('finSketch', 'f0', 'fa', 'fb'),
    { type: 'addCurve', sketch: 'finSketch', id: 'f1', curve: { type: 'arc', center: 'fo', start: 'fb', end: 'fc' } },
    line('finSketch', 'f2', 'fc', 'fd'),
    line('finSketch', 'f3', 'fd', 'fa'),
    extrude('fin', 'finSketch', [['f0', 'f1', 'f2', 'f3']], 8, 'add', 'disc'),
    ...sketch('lobeSketch', XY),
    ...circle('lobeSketch', 'l1', -198.5, 0, 10),
    extrude('lobe', 'lobeSketch', [['l1']], 5),
    ...sketch('upperSketch', onFace('lobe', top('lobe'))),
    ...circle('upperSketch', 'l2', -201.5, 0, 10),
    extrude('upper', 'upperSketch', [['l2']], 5, 'add', 'lobe'),
    ...sketch('flatSketch', XY),
    ...polygon('flatSketch', 'm', [[300, 0], [360, 0], [360, 40], [300, 40]]),
    extrude('flatBox', 'flatSketch', [curvesOf('m', 4)], 20),
    ...sketch('flatHoleSketch', onFace('flatBox', top('flatBox'))),
    ...circle('flatHoleSketch', 'v', 330, flat, 4),
    extrude('flatHole', 'flatHoleSketch', [['v']], -25, 'cut', 'flatBox'),
    ...sketch('sinkSketch', XY),
    ...polygon('sinkSketch', 'z', [[400, 0], [460, 0], [460, 40], [400, 40]]),
    extrude('sinkBox', 'sinkSketch', [curvesOf('z', 4)], 20),
    ...sketch('sinkHoleSketch', onFace('sinkBox', top('sinkBox'))),
    ...circle('sinkHoleSketch', 'j', 430, 0, 4),
    extrude('sinkHole', 'sinkHoleSketch', [['j']], -25, 'cut', 'sinkBox', 0.3),
  );
}
export function stillRefused(): boolean {
  const unsupported = (issue: IssueAfter | undefined, face: FaceNameAfter): boolean => issue?.code === 'unsupportedEdge' && issue.message.startsWith(MESSAGE_UNSUPPORTED_EDGE) && names(issue, face);
  // stops: the rib's top edge into the boss's wall; the foot of the disc's rib past the rim; the
  // rim of the lower lobe under the upper one
  const ribTop = refusalAfter('boss', chamfer('e1', 'deck', [RIB_TOP], 1));
  const disc = refusalAfter('fin', chamfer('e2', 'disc', [edge(top('disc'), side('fin', 'f2'))], 4));
  const lobe = refusalAfter('upper', chamfer('e3', 'lobe', [edge(top('lobe'), side('lobe', 'l1'))], 0.5));
  const stops = unsupported(ribTop, side('boss', 'b')) && disc?.code === 'unsupportedEdge' && lobe?.code === 'unsupportedEdge';
  // an edge between two cylinders (a pocket and the bore): of the kind `other`, as in D63
  const ridge = refusalAfter('pockets', fillet('e4', 'plate', [edge(side('bore', 'h'), side('pockets', 'k0'))], 1));
  // an end at a cone (a tapered hole); a crossing of 8°, under BLEND_MIN_CROSSING
  const cone = refusalAfter('sinkHole', chamfer('e5', 'sinkBox', [edge(top('sinkBox'), side('sinkBox', 'z0'))], 1));
  const flat = refusalAfter('flatHole', chamfer('e6', 'flatBox', [edge(top('flatBox'), side('flatBox', 'm0'))], 1));
  const flatOk = BLEND_MIN_CROSSING > (8 * Math.PI) / 180 && unsupported(flat, side('flatHole', 'v'));
  // pockets 0.3 deep: the run-out of the rim's chamfer reaches their floors
  const shallow = done(engine.preview({ type: 'updateFeature', id: 'pockets', patch: { extent: { type: 'distance', start: 0, distance: -0.3 } } }, 'rimChamfer'));
  const shallowError = shallow.evaluation.features['rimChamfer']?.error;
  return stops && ridge?.code === 'unsupportedEdge' && unsupported(cone, side('sinkHole', 'j')) && flatOk && shallowError?.code === 'blendDoesNotFit';
}

// ================================================================ g. parameters, save and load

// The pockets wider (the parameter pinR 2.8): the rim's chamfer still runs out into every pocket and every
// face keeps its name.
export function widerPockets(): boolean {
  const before = engine.getState();
  const after = done(engine.preview({ type: 'setParameter', name: 'pinR', expr: '2.8' }));
  const sameFaces = before.evaluation.bodies['plate'].faces.every((face) => after.evaluation.bodies['plate'].faces.some((other) => sameName(after.evaluation.faceNames[other.id], before.evaluation.faceNames[face.id])));
  return sameFaces && POCKETS.every((id) => touches(after, 'plate', chamferFace('rimChamfer', 0), side('pockets', id))) && allOk(after);
}
export function roundTrip(): boolean {
  const before = engine.getState();
  const loaded = done(engine.load(engine.save()));
  return Object.keys(before.evaluation.bodies).every((id) => loaded.evaluation.bodies[id].volume === before.evaluation.bodies[id].volume) && loaded.document.schemaVersion === before.document.schemaVersion; // no schema step: the version is the one of master
}

// ================================================================ the scenario

export function scenario17(): boolean {
  const housed = housing();
  const rim = rimChecks(housed, rimChamfer());
  hub();
  const keyed = hubChecks(hubChamfer());
  const ribbed = ribAndBoss();
  const rib = ribChecks(ribbed, ribFoot());
  shaft();
  const slot = slotChecks(slotChamfer());
  notchedBox();
  const notch = notchChecks();
  refusedParts();
  return rim && keyed && rib && slot && notch && stillRefused() && widerPockets() && roundTrip();
}

// The two types as commands are D63's.
export const typed: [ChamferFeature['type'], FilletFeature['type']] = ['chamfer', 'fillet'];
