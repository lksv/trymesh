// Validation scenario 12 (a box with a lid and screw posts), the part of package 2d, written as
// calls against the contract. Only type-checked (`npx tsc -p docs/d36/tsconfig.json`). A step that
// cannot be written here is a hole in the contract. Lines marked `@ts-expect-error` are calls that
// must not compile.
//
// It continues the finished model of track B (2a, 2b, 2f, 2c: `packages/scenarios/test/box.ts`):
// the box gets round vertical edges by four fillets of its outline, long after everything was
// built on that outline; the bracket gets a round bend; a rib is turned and a gusset joined by
// the bare command.
//
// The numbers in the comments were measured on 2026-11-16 against the real solver and kernel
// (design.md, "Measured"; the fillet as a prototype that edits the saved document, the solver
// adapter with the change of this package).

import type { Expr, Id, SketchSolver, SolveInput, SolveResult, Vec3 } from '../../../packages/engine/src/index';
import type { CommandAfter, FaceNameAfter, StateAfter } from '../00-prep/contract';
import { OUTLINE, RIB_LEFT, done, engine, fail, onFace, pointAt, run, sameName, sketchOn, unwrap } from '../2a-offset/calls';
import type { FilletIds, SketchToolContextAfter } from './contract';
import { CURVE_POINTS, FILLET, freshIds, sketchTool } from './contract';

const near = (value: number | undefined, expected: number, tolerance = 1e-6): boolean => value !== undefined && Math.abs(value - expected) < tolerance;
const allOk = (state: StateAfter): boolean => state.document.features.every((feature) => state.evaluation.features[feature.id].status === 'ok');
const facesOf = (state: StateAfter, body: Id): FaceNameAfter[] => state.evaluation.bodies[body].faces.map((face) => state.evaluation.faceNames[face.id]);
// every face the bodies had is still there under its name
const keptFaces = (before: StateAfter, after: StateAfter): boolean => ['box', 'lid'].every((body) => facesOf(before, body).every((name) => facesOf(after, body).some((other) => sameName(name, other))));
const originOf = (state: StateAfter, sketch: Id): Vec3 | undefined => state.evaluation.features[sketch].plane?.origin;

// ---------------------------------------------------------------- a. the tool

// What a sketch tool is given: the sketch, its solved state, the values of the parameters and,
// new and required, the document.
export function contextOf(state: StateAfter, sketch: Id): SketchToolContextAfter {
  const feature = state.document.features.find((f) => f.id === sketch);
  if (feature?.type !== 'sketch') return fail(`no sketch "${sketch}"`);
  return { sketch: feature, result: state.evaluation.features[sketch].sketch, parameters: state.evaluation.parameters, document: state.document };
}

// One fillet: the tool returns the batch, the caller executes it. One undo takes it back, the
// patches of the other features included.
export function filletCorner(sketch: Id, corner: Id, radius: number | Expr, prefix: string): FilletIds {
  const state = engine.getState();
  const made = sketchTool('fillet', contextOf(state, sketch), { corner, radius }, freshIds(state.document, prefix));
  if (!made.ok) return fail(made.message);
  run(...made.commands);
  return made.ids as FilletIds;
}
// The reason a fillet is refused, if it is.
const refusal = (sketch: Id, corner: Id, radius: number | Expr): string | undefined => {
  const state = engine.getState();
  const made = sketchTool('fillet', contextOf(state, sketch), { corner, radius }, freshIds(state.document, 'x_'));
  return made.ok ? undefined : made.message;
};

// ---------------------------------------------------------------- b. the box gets round corners

// The outline is the rectangle `oa` (o1 to o2), `ob` (o2 to o3), `oc` (o3 to o4), `od` (o4 to o1),
// with its width between o1 and o2 and its height between o2 and o3. Five features read its one
// region: the box, the cavity (offset -wall), the plate of the lid, the lip and its inside.
export const CORNERS: Id[] = ['o1', 'o2', 'o3', 'o4'];
export const ON_OUTLINE: Id[] = ['box', 'cavity', 'lid', 'lip', 'lipInside'];

export function roundCorners(): Record<Id, FilletIds> {
  run({ type: 'setParameter', name: 'cornerR', expr: '6' });
  return Object.fromEntries(CORNERS.map((corner, i): [Id, FilletIds] => [corner, filletCorner('outline', corner, 'cornerR', `f${i + 1}_`)]));
}

export function cornerChecks(before: StateAfter, fillets: Record<Id, FilletIds>): boolean {
  const state = engine.getState();
  const arcs = CORNERS.map((corner) => fillets[corner].arc[0]);
  // every feature on the outline was patched by every fillet, and nothing else was
  const patched = CORNERS.every((corner) => fillets[corner].patched.join() === ON_OUTLINE.join());
  const loops = ON_OUTLINE.every((id) => {
    const feature = state.document.features.find((f) => f.id === id);
    return feature?.type === 'extrude' && feature.profile.type === 'regions' && feature.profile.regions[0].outerLoop.join() === [...OUTLINE, ...arcs].sort().join();
  });
  // the sketch: as determined as it was, its sizes still between the sharp corners
  const outline = state.evaluation.features['outline'].sketch;
  const sharp = near(outline?.points['o3'].x, 80) && near(outline?.points['o3'].y, 50) && outline?.degreesOfFreedom === 0 && outline.regions.length === 1;
  // the bodies: no face lost; one new side face per arc and feature, twenty in all. Sixteen are
  // cylinders (the box 6, the cavity 4: the radius less the wall); the four of the lip are cones,
  // because the lip has the lead-in of 2b.
  const round = state.evaluation.faceNames.flatMap((name, i) => (name.role === 'side' && arcs.includes(name.curve) ? [{ name, surface: state.evaluation.faceSurfaces[i] }] : []));
  const radiusOf = (feature: Id): number | undefined => round.flatMap((face) => (face.name.feature === feature && face.surface.kind === 'cylinder' ? [face.surface.radius] : []))[0];
  const faces = keptFaces(before, state) && round.length === 20 && round.filter((face) => face.surface.kind === 'cylinder').length === 16 && near(radiusOf('box'), 6) && near(radiusOf('cavity'), 4);
  // the lid still fits: no collision
  const report = unwrap(engine.query('interference', { bodies: ['box', 'lid'] }));
  return allOk(state) && patched && loops && sharp && faces && report.pairs.length === 0 && report.failed.length === 0;
}

// What the fillets moved without an error. `od` runs from o4, so its side faces start at o4, and
// the sketch of the brace stands on one of them (the side of the cavity): the fillet at o4 names
// it, and no other fillet names anything. Each line of the outline starts at one corner, so each
// fillet has one line that starts at its corner. Nothing in the box reads one line of the outline
// without the other, so `shortened` is empty four times.
export function movedByTheFillets(before: StateAfter, fillets: Record<Id, FilletIds>): boolean {
  const named = fillets['o4'].moved.join() === 'braceSketch' && ['o1', 'o2', 'o3'].every((corner) => fillets[corner].moved.length === 0) && CORNERS.every((corner) => fillets[corner].shortened.length === 0);
  // The face started at the corner of the cavity, y = W - wall; it now starts where the moved arc
  // ends, y = W - cornerR. The brace went with it, 4 mm along the wall, and is still a brace.
  const [was, is] = [originOf(before, 'braceSketch'), originOf(engine.getState(), 'braceSketch')];
  const moved = near(was?.[1], 48) && near(is?.[1], 44);
  // Its dimension from the origin of the sketch is rewritten, and it is back 16 mm from the wall.
  const back = run({ type: 'setConstraintValue', sketch: 'braceSketch', id: 'brcx', value: '-(W - cornerR - wall - 16)' });
  return named && moved && allOk(back);
}

// The radius is one parameter. A larger one works; one that an inward offset uses up is an error
// of the feature with that offset, with the message of the offset (2a): the inside of the lip is
// moved in by wall + clearance + lipT = 3.7.
export function radiusByParameter(): boolean {
  const larger = done(engine.preview({ type: 'setParameter', name: 'cornerR', expr: '8' }));
  const used = done(engine.preview({ type: 'setParameter', name: 'cornerR', expr: '3.7' }));
  const longer = done(engine.preview({ type: 'setParameter', name: 'L', expr: '120' }));
  return allOk(larger) && used.evaluation.features['lipInside'].error?.code === 'invalidProfile' && used.evaluation.features['cavity'].status === 'ok' && allOk(longer);
}

// A round corner has a rim: the edge of the top of the lid with the round face is a circle, and
// a sketch projects it. Centre (74, 44), radius 6: a screw hole concentric with the corner.
export function cornerRim(fillets: Record<Id, FilletIds>): boolean {
  const top: FaceNameAfter = { feature: 'lid', role: 'endCap' };
  const preview = done(
    engine.preview({
      type: 'batch',
      commands: [...sketchOn('roundRim', onFace('lid', top)), { type: 'addExternal', sketch: 'roundRim', id: 'rim', ref: { type: 'edge', body: 'lid', edge: { a: top, b: { feature: 'lid', role: 'side', curve: fillets['o3'].arc[0] } }, kind: 'circle' } }],
    }),
  );
  return preview.evaluation.features['roundRim'].status === 'ok' && near(preview.evaluation.features['roundRim'].sketch?.radii['rim'], 6);
}

// ---------------------------------------------------------------- b2. what reads one line alone

// What reads a line of a corner by itself is named in `shortened`: two cases, both of which follow
// the fillet without an error. Both are tried on a previewed state, before the corners are
// rounded, so nothing of it stays in the model: the tool is a function of its context, and
// a previewed state is one.
export function readOneLine(): boolean {
  // a. A sketch on the top of the lid projects the edge of the top with the side face of `ob`
  // (o2 to o3) as a line, from (80, 0) to (80, 50). The fillet at o3 names the sketch; the one at
  // o1, which neither end of `ob` is at, does not. After it the projection ends at (80, 44), and
  // the sketch has no warning: the edge is still there, only shorter.
  const top: FaceNameAfter = { feature: 'lid', role: 'endCap' };
  const note: CommandAfter[] = [...sketchOn('edgeNote', onFace('lid', top)), { type: 'addExternal', sketch: 'edgeNote', id: 'edge', ref: { type: 'edge', body: 'lid', edge: { a: top, b: { feature: 'lid', role: 'side', curve: 'ob' } }, kind: 'line' } }];
  const noted = done(engine.preview({ type: 'batch', commands: note }));
  const at = (corner: Id) => sketchTool('fillet', contextOf(noted, 'outline'), { corner, radius: 6 }, freshIds(noted.document, 'n_'));
  const [near3, far] = [at('o3'), at('o1')];
  if (!near3.ok || !far.ok) return false;
  const rounded = done(engine.preview({ type: 'batch', commands: [...note, ...near3.commands] }));
  const projection = rounded.evaluation.features['edgeNote'];
  const edge = near3.ids['shortened'].join() === 'edgeNote' && far.ids['shortened'].length === 0 && projection.status === 'ok' && near(projection.sketch?.points['edge/b'].y, 44);

  // b. A wall along `b12` alone, one of the two lines of the bracket. The fillet of the bend adds
  // the arc to the bracket, which names both lines, and names this wall, which gets no arc: it is
  // 7 long in place of 11 (1.6 thick and 12 high, so its volume is 134.4 in place of 211.2), and
  // its straight end is named by the end of the arc, not by `b2`.
  const half: CommandAfter = { type: 'addFeature', feature: { id: 'half', name: 'half', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'ribs', curves: ['b12'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'new' } };
  const withHalf = done(engine.preview(half));
  const bend = sketchTool('fillet', contextOf(withHalf, 'ribs'), { corner: 'b2', radius: 4 }, freshIds(withHalf.document, 'n_'));
  if (!bend.ok) return false;
  const bent = done(engine.preview({ type: 'batch', commands: [half, ...bend.commands] }));
  const ids = bend.ids as FilletIds;
  const end = ids.ends[ids.lines.indexOf('b12')];
  const ends = facesOf(bent, 'half').flatMap((name) => (name.role === 'wallEnd' ? [name.point] : []));
  const wall = ids.patched.join() === 'bracket' && ids.shortened.join() === 'half' && bent.evaluation.features['half'].status === 'ok' && ends.includes(end) && !ends.includes('b2') && near(withHalf.evaluation.bodies['half'].volume, 211.2, 0.01) && near(bent.evaluation.bodies['half'].volume, 134.4, 0.01);
  return edge && wall;
}

// ---------------------------------------------------------------- c. a wall with a round bend

// The bracket of 2a is a wall along the construction lines `b12` and `b23`, which meet at `b2`.
// The fillet takes construction lines when no other curve ends at the corner, draws
// a construction arc and adds it to the curves of the wall.
export function roundBracket(): boolean {
  const before = engine.getState();
  const ids = filletCorner('ribs', 'b2', 4, 'bf_');
  const state = engine.getState();
  const sketch = state.document.features.find((f) => f.id === 'ribs');
  const bracket = state.document.features.find((f) => f.id === 'bracket');
  const arc = ids.arc[0];
  const construction = sketch?.type === 'sketch' && sketch.curves[arc].construction === true;
  const chain = bracket?.type === 'extrude' && bracket.profile.type === 'wall' && bracket.profile.curves.join() === ['b12', 'b23', arc].sort().join();
  // the bend has two faces, left and right of the arc; the four of the lines kept their names
  const bend = facesOf(state, 'box').filter((name) => name.feature === 'bracket' && name.role === 'wallSide' && name.curve === arc).length === 2;
  // a wall 2 thick needs a bend above 1: at 1 the inner side has no radius left
  const tight = done(engine.preview({ type: 'setConstraintValue', sketch: 'ribs', id: ids.radius[0], value: 1 }));
  return allOk(state) && ids.patched.join() === 'bracket' && construction && chain && bend && keptFaces(before, state) && tight.evaluation.features['bracket'].error?.code === 'invalidProfile';
}

// ---------------------------------------------------------------- d. what the tool refuses

// It runs after the outline is rounded and before the bracket is: the bend `b2` is still a corner
// the tool would fillet, so the last two are refused for their radius and for nothing else.
export function refusals(): (string | undefined)[] {
  return [
    // a corner that was filleted: its two lines now end at the arc
    refusal('outline', 'o3', 2),
    // the free end of the bracket: one line ends there, not two
    refusal('ribs', 'b1', 2),
    // a point no line ends at
    refusal('postSketch', 'mid', 2),
    // an expression the parameters give no value to
    refusal('ribs', 'b2', 'noSuchParameter'),
    // a radius the lines are too short for: they are 11 and 13 long and meet at a right angle,
    // so the radius has to be below 11, and 11 itself would leave `b12` no length
    refusal('ribs', 'b2', 11),
  ]; // each a text; nothing was drawn
}
// The same corner with a radius that fits is not refused (the control of the two above).
export const stillSharp = (): boolean => refusal('ribs', 'b2', 4) === undefined;
export const wrongInputs = (): void => {
  const context = contextOf(engine.getState(), 'outline');
  const newId = freshIds(engine.getState().document);
  // @ts-expect-error the corner is the ID of a point, not an anchor
  sketchTool('fillet', context, { corner: { at: [0, 0] }, radius: 2 }, newId);
  // @ts-expect-error a fillet has a radius
  sketchTool('fillet', context, { corner: 'o3' }, newId);
  // @ts-expect-error no such tool
  sketchTool('chamfer', context, { corner: 'o3', radius: 2 }, newId);
};
// The description for the AI is generated from the entry: the corner is "a point of the sketch,
// by its ID", the radius "a number, positive, mm, or an expression".
export const describedInputs: string[] = Object.keys(FILLET.inputs); // corner, radius
export const returnedLists: string[] = Object.keys(FILLET.ids); // arc, center, lines, ends, constraints, radius, patched, moved, shortened

// ---------------------------------------------------------------- e. the command by itself

// The rib of 2a is a wall along the line `r1`, from `r1a` inside the long wall to `r1b`. Its foot
// is moved 6 mm along the wall: a new point, and the start of the line re-pointed to it. The line
// keeps its ID, so the faces of the rib keep their names, and the brace of 2f, which ends in the
// left side of the rib, follows: 38.15 to 39.02 long in place of 37.38 to 37.54.
export function turnedRib(): boolean {
  const before = engine.getState();
  const state = run(...pointAt('ribs', 'r1c', 'L / 2 + 6', 'wall / 2'), { type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'a', to: 'r1c' });
  const sketch = state.document.features.find((f) => f.id === 'ribs');
  const line = sketch?.type === 'sketch' ? sketch.curves['r1'] : undefined;
  const repointed = line?.type === 'line' && line.a === 'r1c' && line.b === 'r1b' && line.construction === true;
  // the point the line left is still in the sketch, with its two dimensions
  const left = sketch?.type === 'sketch' && 'r1a' in sketch.points && 'r1ax' in sketch.constraints;
  const ribFaces = (s: StateAfter): string => JSON.stringify(facesOf(s, 'box').filter((name) => name.feature === 'rib'));
  const facts = state.evaluation.features['brace'].facts;
  return allOk(state) && repointed && left && ribFaces(state) === ribFaces(before) && facesOf(state, 'box').some((name) => sameName(name, RIB_LEFT)) && typeof facts?.['lengthMin'] === 'number' && facts['lengthMin'] > 38;
}

// A gusset drawn as two lines, each with end points of its own: `g2` and `g2b` are two points at
// one place, so the lines are not joined and a wall along them is an error (`invalidProfile`,
// "not connected"). The second line is re-pointed onto the end of the first, and the wall is one
// chain. (A coincident constraint would join them as well; this leaves one point.)
export function joinedGusset(): boolean {
  run(
    ...pointAt('ribs', 'g1', '14', 'wall / 2'),
    ...pointAt('ribs', 'g2', '14', 'wall + 8'),
    ...pointAt('ribs', 'g2b', '14', 'wall + 8'),
    ...pointAt('ribs', 'g3', 'wall / 2', 'wall + 8'),
    { type: 'addCurve', sketch: 'ribs', id: 'g12', curve: { type: 'line', a: 'g1', b: 'g2', construction: true } },
    { type: 'addCurve', sketch: 'ribs', id: 'g23', curve: { type: 'line', a: 'g2b', b: 'g3', construction: true } },
  );
  const apart = run({ type: 'addFeature', feature: { id: 'gusset', name: 'gusset', suppressed: false, type: 'extrude', profile: { type: 'wall', sketch: 'ribs', curves: ['g12', 'g23'], thickness: 'ribT' }, extent: { type: 'distance', start: 0, distance: 'ribH' }, operation: 'add', targets: ['box'] } });
  const joined = run({ type: 'setCurvePoint', sketch: 'ribs', id: 'g23', point: 'a', to: 'g2' }, { type: 'removeEntity', sketch: 'ribs', id: 'g2b' });
  // Now the corner is one point and the tool can fillet it. The lines are 9 and 13 long and meet
  // at a right angle, so the radius has to be below 9: 20 is refused with that bound.
  return apart.evaluation.features['gusset'].error?.code === 'invalidProfile' && allOk(joined) && refusal('ribs', 'g2', 2) === undefined && refusal('ribs', 'g2', 20) !== undefined;
}

// Refused, each an invalid command that changes nothing.
export function refusedRepoints(): boolean[] {
  const refused = (point: (typeof CURVE_POINTS)['line' | 'arc' | 'circle'][number], to: Id, id: Id = 'r1'): boolean => !engine.preview({ type: 'setCurvePoint', sketch: 'ribs', id, point, to }).ok;
  // A constraint the catalog would refuse: the middle of a line cannot be its end. The batch is
  // valid up to its last command (the IDs `r1m`, `r1mx`, `r1my`, `r1mid` are free), so the index
  // of the command that failed says that the re-point is what was refused.
  const middle: CommandAfter[] = [...pointAt('ribs', 'r1m', 'L / 2', 'wall'), { type: 'addConstraint', sketch: 'ribs', id: 'r1mid', constraint: { type: 'midpoint', point: 'r1m', line: 'r1' } }, { type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'b', to: 'r1m' }];
  const result = engine.preview({ type: 'batch', commands: middle });
  return [
    refused('b', 'r1c'), // both ends of the line at one point
    refused('center', 'r1b'), // a line has no centre
    refused('a', 'o1'), // a point of another sketch
    refused('a', 'nope'), // no such point
    refused('a', 'r1b', 'nope'), // no such curve
    !result.ok && result.error.commandIndex === middle.length - 1,
    // the same batch without the re-point is accepted (the control)
    engine.preview({ type: 'batch', commands: middle.slice(0, -1) }).ok,
  ]; // all true
}
// The point a curve already has is accepted and is no change.
export const samePoint = (): boolean => engine.preview({ type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'b', to: 'r1b' }).ok;
export const wrongCommands = (): void => {
  // @ts-expect-error a curve has no point of that name
  engine.execute({ type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'middle', to: 'r1c' });
  // @ts-expect-error the target is the ID of a point, not coordinates
  engine.execute({ type: 'setCurvePoint', sketch: 'ribs', id: 'r1', point: 'a', to: { x: 0, y: 0 } });
};

// ---------------------------------------------------------------- f. the solver holds a fillet

// A fillet as the tool draws it, given to the port: a right corner at the origin, its lines 40
// and 30 long, the arc of radius 6 exactly in place. `first` is that state; `changed` the same
// with the radius 10 asked for. With the adapter of today `first` is solved and `changed` is
// a conflict that names the two tangencies; with the change of this package both are solved and
// the arc ends at (10, 0) and (0, 10).
declare const solver: SketchSolver;
export function heldBySolver(): [SolveResult['status'], SolveResult['status'], boolean] {
  const input = (radius: number): SolveInput => ({
    points: { origin: { x: 0, y: 0 }, p: { x: 0, y: 0 }, q1: { x: 40, y: 0 }, q2: { x: 0, y: 30 }, t1: { x: 6, y: 0 }, t2: { x: 0, y: 6 }, c: { x: 6, y: 6 } },
    radii: {},
    curves: { l1: { type: 'line', a: 't1', b: 'q1' }, l2: { type: 'line', a: 'q2', b: 't2' }, f: { type: 'arc', center: 'c', start: 't2', end: 't1' } },
    constraints: {
      fix: { type: 'coincident', a: 'p', b: 'origin' },
      h: { type: 'horizontal', line: 'l1' },
      v: { type: 'vertical', line: 'l2' },
      w: { type: 'distance', a: 'p', b: 'q1', value: 40, driving: true },
      d: { type: 'distance', a: 'p', b: 'q2', value: 30, driving: true },
      // what the tool adds
      tan1: { type: 'tangent', a: 'l1', b: 'f' },
      tan2: { type: 'tangent', a: 'l2', b: 'f' },
      on1: { type: 'pointOnCurve', point: 'p', curve: 'l1' },
      on2: { type: 'pointOnCurve', point: 'p', curve: 'l2' },
      r: { type: 'radius', curve: 'f', value: radius, driving: true },
    },
    fixed: ['origin'],
  });
  const [first, changed] = [solver.solve(input(6)), solver.solve(input(10))];
  return [first.status, changed.status, near(changed.points['t1'].x, 10) && near(changed.points['t2'].y, 10)]; // solved, solved, true
}

// ---------------------------------------------------------------- the part of the scenario

export function scenario12d(): boolean {
  const before = engine.getState();
  const followers = readOneLine();
  const fillets = roundCorners();
  const corners = cornerChecks(before, fillets) && movedByTheFillets(before, fillets) && radiusByParameter() && cornerRim(fillets);
  const refused = refusals().every((reason) => reason !== undefined) && stillSharp();
  const bracket = followers && roundBracket();
  const command = turnedRib() && joinedGusset() && refusedRepoints().every(Boolean) && samePoint();
  const [first, changed, at] = heldBySolver();
  return corners && bracket && refused && command && first === 'solved' && changed === 'solved' && at;
}
