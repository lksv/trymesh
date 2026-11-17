// Validation scenario 14 (turned parts: a V-belt pulley, a knob with an O-ring), the part of
// package 4b, and a short part of scenario 12 (the box with a lid), written as calls against the
// contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written
// here is a hole in the contract.
//
// 4a builds the pulley and the knob (its calls.ts); 4b chamfers and fillets their circular edges.
// The box of scenario 12 has round vertical corners (2d), so the loops of its top and bottom are
// chains of lines and arcs: the straight edges and the smooth ends of 4b.

import type { Expr, Id, Vec3 } from '../../../packages/engine/src/index';
import type { CommandAfter, EdgeNameAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { OUTLINE, done, engine, lidFits, onFace, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import { CORNERS } from '../2d-sketch-fillet/calls';
import type { FilletIds } from '../2d-sketch-fillet/contract';
import type { StateD, SurfaceD } from '../4a-revolve/contract';
import type { ChamferFeature, FilletFeature } from './contract';

const near = (value: number | undefined, expected: number, tolerance = 1e-6): boolean => value !== undefined && Math.abs(value - expected) <= tolerance;
const nearVec = (a: Vec3 | undefined, b: Vec3, tolerance = 1e-6): boolean => a !== undefined && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => ['ok', 'warning'].includes(state.evaluation.features[feature.id].status));
const withSurfaces = (state: StateAfter): StateD => state;
function surfaceOf(state: StateAfter, body: Id, name: FaceNameAfter): SurfaceD | undefined {
  const d = withSurfaces(state);
  const face = d.evaluation.bodies[body]?.faces.find((f) => sameName(d.evaluation.faceNames[f.id], name));
  return face ? d.evaluation.faceSurfaces[face.id] : undefined;
}
const side = (feature: Id, curve: Id): FaceNameAfter => ({ feature, role: 'side', curve });
const edge = (a: FaceNameAfter, b: FaceNameAfter): EdgeNameAfter => ({ a, b });
// The new face of the edge at place `i` of a chamfer or a fillet.
const chamferFace = (feature: Id, i: number): FaceNameAfter => ({ feature, role: 'chamfer', edge: i });
const filletFace = (feature: Id, i: number): FaceNameAfter => ({ feature, role: 'fillet', edge: i });
const base = (id: Id) => ({ id, name: id, suppressed: false });
const chamfer = (id: Id, body: Id, edges: EdgeNameAfter[], distance: number | Expr): CommandAfter => ({ type: 'addFeature', feature: { ...base(id), type: 'chamfer', body, edges, distance } });
const fillet = (id: Id, body: Id, edges: EdgeNameAfter[], radius: number | Expr): CommandAfter => ({ type: 'addFeature', feature: { ...base(id), type: 'fillet', body, edges, radius } });
// The edges of a body that a face is one of the two faces of.
const edgesOf = (state: StateAfter, body: Id, face: FaceNameAfter) => state.evaluation.bodies[body].edges.filter((e) => sameName(e.name.a, face) || sameName(e.name.b, face));
const codeOf = (command: CommandAfter, id: Id): string | undefined => done(engine.preview(command)).evaluation.features[id]?.error?.code;
const refsOf = (command: CommandAfter, id: Id): unknown[] => done(engine.preview(command)).evaluation.features[id]?.error?.refs ?? [];

// ================================================================ scenario 14

// ---------------------------------------------------------------- a. the bore of the pulley

// Both rims of the bore (the top `t` and the bottom `b` with the bore `h`): a chamfer of 0.5. The
// edges are circles between a plane across the axis and a cylinder about it, convex: cut.
export const BORE_EDGES: EdgeNameAfter[] = [edge(side('pulley', 't'), side('pulley', 'h')), edge(side('pulley', 'b'), side('pulley', 'h'))];
export function boreChamfer(): StateAfter {
  return run(chamfer('boreChamfer', 'pulley', BORE_EDGES, 0.5));
}
export function boreChecks(before: StateAfter, after: StateAfter): boolean {
  // two cones of 45° about Z, one per edge, named by the place of the edge
  const cones = [0, 1].map((i) => surfaceOf(after, 'pulley', chamferFace('boreChamfer', i)));
  const conesOk = cones.every((s) => s?.kind === 'cone' && near(s.halfAngle, Math.PI / 4, 1e-9) && near(Math.abs(s.axis[2]), 1) && near(s.apex[0], 0) && near(s.apex[1], 0));
  // each cone meets the top or the bottom and the bore in circles
  const circles = [0, 1].every((i) => {
    const edges = edgesOf(after, 'pulley', chamferFace('boreChamfer', i));
    return edges.length === 2 && edges.every((e) => e.kind === 'circle');
  });
  // the facts: the setback is the distance, and both were cut
  const facts = after.evaluation.features['boreChamfer'].facts ?? {};
  const factsOk = near(facts['setback/0'] as number, 0.5) && near(facts['setback/1'] as number, 0.5) && facts['cut/0'] === true && facts['cut/1'] === true;
  // the volume taken: two triangles of 0.5 × 0.5 / 2 turned at the radius of their centroid,
  // 4 + 0.5 / 3, within the polygons of the bore and of the cones
  const taken = before.evaluation.bodies['pulley'].volume - after.evaluation.bodies['pulley'].volume;
  const exact = 2 * 2 * Math.PI * (4 + 0.5 / 3) * 0.125;
  // the faces of the pulley are kept, the bore and the top only narrower
  const kept = before.evaluation.bodies['pulley'].faces.every((face) => after.evaluation.bodies['pulley'].faces.some((other) => sameName(after.evaluation.faceNames[other.id], before.evaluation.faceNames[face.id])));
  return conesOk && circles && factsOk && Math.abs(taken - exact) < 0.2 && kept && allOk(after);
}

// ---------------------------------------------------------------- b. the outer rims of the pulley

// The four edges of the two rims: with the bottom and the top (planes across the axis) and with the
// flanks (cones). A fillet of 1 in one feature: four tori about Z, each of minor radius 1 and major
// radius 19 (each fillet touches the rim cylinder of radius 20).
export const RIM_EDGES: EdgeNameAfter[] = [
  edge(side('pulley', 'b'), side('pulley', 'r1')),
  edge(side('pulley', 'r1'), side('pulley', 'f1')),
  edge(side('pulley', 'f2'), side('pulley', 'r2')),
  edge(side('pulley', 'r2'), side('pulley', 't')),
];
export function rimFillet(): StateAfter {
  return run(fillet('rimFillet', 'pulley', RIM_EDGES, 1));
}
export function rimChecks(before: StateAfter, after: StateAfter): boolean {
  const tori = RIM_EDGES.map((_, i) => surfaceOf(after, 'pulley', filletFace('rimFillet', i)));
  const toriOk = tori.every((s) => s?.kind === 'torus' && near(s.minorRadius, 1, 1e-9) && near(s.majorRadius, 19, 1e-9) && near(s.center[0], 0) && near(s.center[1], 0));
  // the rims stay (each 4.78 high, less a setback of 1 and of 1 / tan(54.5°) at the flank)
  const rims = ['r1', 'r2'].every((curve) => surfaceOf(after, 'pulley', side('pulley', curve))?.kind === 'cylinder');
  // the edges of a torus with its faces are circles (4a: they touch, one circle each)
  const circles = RIM_EDGES.every((_, i) => edgesOf(after, 'pulley', filletFace('rimFillet', i)).every((e) => e.kind === 'circle'));
  const smaller = after.evaluation.bodies['pulley'].volume < before.evaluation.bodies['pulley'].volume;
  return toriOk && rims && circles && smaller && allOk(after);
}

// ---------------------------------------------------------------- c. the knob

// The foot of the knob (its bottom `kb` with its cylinder `ks`, radius 12) gets a fillet of 2: a
// torus R 10, r 2 about the axis of the knob, its centre at (60, 0, 2). The mouth of the O-ring
// groove (the planes of the groove, `ga` at z 4 and `gc` at z 6, with the cylinder of the knob)
// gets a chamfer of 0.2: faces of two features of the knob in one edge.
export const FOOT: EdgeNameAfter = edge(side('knob', 'kb'), side('knob', 'ks'));
export const MOUTH: EdgeNameAfter[] = [edge(side('ringGroove', 'ga'), side('knob', 'ks')), edge(side('ringGroove', 'gc'), side('knob', 'ks'))];
export function knobEdges(): StateAfter {
  return run(fillet('knobFoot', 'knob', [FOOT], 2), chamfer('grooveMouth', 'knob', MOUTH, 0.2));
}
export function knobEdgeChecks(state: StateAfter): boolean {
  const foot = surfaceOf(state, 'knob', filletFace('knobFoot', 0));
  const footOk = foot?.kind === 'torus' && near(foot.majorRadius, 10, 1e-9) && near(foot.minorRadius, 2, 1e-9) && nearVec(foot.center, [60, 0, 2]);
  const mouths = [0, 1].map((i) => surfaceOf(state, 'knob', chamferFace('grooveMouth', i)));
  const mouthsOk = mouths.every((s) => s?.kind === 'cone' && near(s.halfAngle, Math.PI / 4, 1e-9));
  // the ring still clears the knob, 0.05 off the groove bottom, which the chamfer does not touch
  const gap = unwrap(engine.query('gap', { bodies: ['knob', 'oring'] })).pairs[0];
  const gapOk = gap !== undefined && 'between' in gap && Math.abs(gap.distance - 0.05) <= gap.accuracy + 0.01;
  return footOk && mouthsOk && gapOk && engine.interference({ bodies: ['knob', 'oring'] }).pairs.length === 0 && allOk(state);
}

// ---------------------------------------------------------------- d. what is refused

// Errors of the recompute, each in a preview.
export function blendErrors(): Record<string, string | undefined> {
  return {
    // the rim of the dome: a sphere with a cylinder
    dome: codeOf(fillet('e1', 'knob', [edge(side('knob', 'kd'), side('knob', 'ks'))], 1), 'e1'), // unsupportedEdge
    // a fillet of 5 on rims 4.78 high: the rim would vanish
    tooLarge: codeOf({ type: 'updateFeature', id: 'rimFillet', patch: { radius: 5 } }, 'rimFillet'), // blendDoesNotFit
    // the bottom and the top of the pulley have no edge in common
    noEdge: codeOf(chamfer('e3', 'pulley', [edge(side('pulley', 'b'), side('pulley', 't'))], 0.5), 'e3'), // brokenReference
  };
}
// The face the too large fillet names: the rim.
export const tooLargeNamesTheRim = (): boolean => refsOf({ type: 'updateFeature', id: 'rimFillet', patch: { radius: 5 } }, 'rimFillet').some((ref) => typeof ref === 'object' && ref !== null && 'role' in ref && sameName(ref as FaceNameAfter, side('pulley', 'r1')));
// Invalid commands: no edge, an edge twice, a radius of 0.
export function refusedCommands(): string[] {
  const commands: CommandAfter[] = [fillet('bad1', 'pulley', [], 1), chamfer('bad2', 'pulley', [BORE_EDGES[0], BORE_EDGES[0]], 0.5), fillet('bad3', 'pulley', [RIM_EDGES[0]], 0)];
  return commands.map((command) => {
    const result = engine.execute(command);
    return result.ok ? 'accepted' : result.error.message;
  });
}

// ---------------------------------------------------------------- e. parameters, save and load

// A larger pulley keeps every face, the new ones too; no schema step.
export function largerPulley(): boolean {
  const before = engine.getState();
  const after = done(engine.preview({ type: 'setParameter', name: 'D', expr: '50' }));
  const sameFaces = before.evaluation.bodies['pulley'].faces.every((face) => after.evaluation.bodies['pulley'].faces.some((other) => sameName(after.evaluation.faceNames[other.id], before.evaluation.faceNames[face.id])));
  return sameFaces && allOk(after);
}
export function roundTrip(): boolean {
  const before = engine.getState();
  const loaded = done(engine.load(engine.save()));
  return Object.keys(before.evaluation.bodies).every((id) => loaded.evaluation.bodies[id].volume === before.evaluation.bodies[id].volume);
}

// The part of 4b in scenario 14, after the part of 4a.
export function scenario14b(): boolean {
  const before = engine.getState();
  const bore = boreChecks(before, boreChamfer());
  const beforeRims = engine.getState();
  const rims = rimChecks(beforeRims, rimFillet());
  const knob = knobEdgeChecks(knobEdges());
  const errors = blendErrors();
  const errorsOk = errors.dome === 'unsupportedEdge' && errors.tooLarge === 'blendDoesNotFit' && errors.noEdge === 'brokenReference' && tooLargeNamesTheRim();
  const refused = refusedCommands().every((message) => message !== 'accepted');
  return bore && rims && knob && errorsOk && refused && largerPulley() && roundTrip();
}

// ================================================================ scenario 12

// The fillets of the round corners (2d) give the arcs of the outline; the lid and the box read it.
const TOP: FaceNameAfter = { feature: 'lid', role: 'endCap' };
const BOTTOM: FaceNameAfter = { feature: 'box', role: 'startCap' };
const loopOf = (body: Id, cap: FaceNameAfter, fillets: Record<Id, FilletIds>): EdgeNameAfter[] => [...OUTLINE.map((curve) => edge(cap, side(body, curve))), ...CORNERS.map((corner) => edge(cap, side(body, fillets[corner].arc[0])))];

// The top loop of the lid (3 thick) gets a fillet of 1.5: the four lines and the four arcs in one
// feature, each line ending smoothly at the round face of a corner and each arc at the faces of
// two lines. Four cylinders and four tori.
export function lidRound(fillets: Record<Id, FilletIds>): boolean {
  const state = run(fillet('lidRound', 'lid', loopOf('lid', TOP, fillets), 1.5));
  const faces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => surfaceOf(state, 'lid', filletFace('lidRound', i)));
  const kinds = faces.slice(0, 4).every((s) => s?.kind === 'cylinder' && near(s.radius, 1.5, 1e-9)) && faces.slice(4).every((s) => s?.kind === 'torus' && near(s.minorRadius, 1.5, 1e-9) && near(s.majorRadius, 4.5, 1e-9));
  return kinds && lidFits() && allOk(state);
}
// The lines alone are half of a smooth chain: refused, the edge of an arc named.
export function halfChain(fillets: Record<Id, FilletIds>): boolean {
  const lines = loopOf('lid', TOP, fillets).slice(0, 4);
  const command = fillet('e5', 'lid', lines, 1.5);
  const arcs = CORNERS.map((corner) => side('lid', fillets[corner].arc[0]));
  const named = refsOf(command, 'e5').some((ref) => typeof ref === 'object' && ref !== null && 'a' in ref && arcs.some((arc) => sameName((ref as EdgeNameAfter).a, arc) || sameName((ref as EdgeNameAfter).b, arc)));
  return codeOf(command, 'e5') === 'unsupportedEdge' && named;
}
// The bottom loop of the box gets a chamfer of 0.4 against elephant foot: four planes and four
// cones. A sketch stands on the chamfer of `oa`: its origin where the chamfer meets the side of
// `oa` (the first face of the edge) at the end of the edge its projection calls `a` (x = cornerR),
// Y along +X, the normal out of the body, between -Y and -Z.
export function boxFoot(fillets: Record<Id, FilletIds>): boolean {
  const state = run(chamfer('foot', 'box', loopOf('box', BOTTOM, fillets), 0.4), ...sketchOn('onFoot', onFace('box', chamferFace('foot', 0))));
  const faces = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => surfaceOf(state, 'box', chamferFace('foot', i)));
  const kinds = faces.slice(0, 4).every((s) => s?.kind === 'plane') && faces.slice(4).every((s) => s?.kind === 'cone' && near(s.halfAngle, Math.PI / 4, 1e-9));
  const frame = state.evaluation.features['onFoot'].plane;
  const frameOk = nearVec(frame?.origin, [6, 0, 0.4]) && nearVec(frame?.y, [1, 0, 0]) && nearVec(frame?.normal, [0, -Math.SQRT1_2, -Math.SQRT1_2]);
  return kinds && frameOk && allOk(state);
}

// The part of 4b in scenario 12, after the part of 2d (whose fillets it takes).
export function scenario12b(fillets: Record<Id, FilletIds>): boolean {
  return halfChain(fillets) && lidRound(fillets) && boxFoot(fillets);
}

// The two types as commands: a chamfer has a distance and no radius.
export const typed: [ChamferFeature['type'], FilletFeature['type']] = ['chamfer', 'fillet'];
