// Package 5b written out as calls: its part of validation scenario 13 (the arm of 3a and 5a: a base,
// an upper arm with its motor and screws, a forearm; two revolute joints), "the arm as URDF and as
// MJCF, and a picture of a pose that is not written". Only type-checked
// (`npx tsc -p docs/d36/tsconfig.json`). A step that cannot be written here is a hole in the
// contract. The first part writes the common part of the two formats out against the real context
// of an export, so that the contract is shown to be enough for it; after the implementation it is
// `export/robot.ts`, and the rest becomes the part of 5b of `packages/scenarios/test/scenario13.test.ts`.
//
// The numbers in the comments were measured on 2026-11-17 with a prototype of the two writers over
// the arm as `packages/scenarios/test/arm.ts` builds it, with the mechanism of the part of 5a, and
// read back by MuJoCo 4.0.1, urdf_parser_py 0.0.4 and yourdfpy 0.0.60 (design.md, "Measured").

/// <reference path="../../../packages/mcp/src/raw.d.ts" />
import type { Command, EngineState, ExportFile, Exported, Id, MassProperties, QueryContext, QueryOutcome, Vec3 } from '../../../packages/engine/src/index';
import { QUERIES, QueryFailure } from '../../../packages/engine/src/index';
import { arm } from '../../../packages/scenarios/test/arm';
import type { Host } from '../../../packages/mcp/src/host';
import type { ImageRequest } from '../../../packages/mcp/src/view-image';
import type { CommandAfter5b, EngineAfter5b, InputJointAfter5b, JointResultAfter5b, RobotAbout, RobotJoint, RobotLink, RobotMeshAbout, RobotTree, ViewImageAboutAfter5b } from './contract';
import { NO_MECHANISM, ROBOT_FILES, ROBOT_REFUSALS, type meshName, type robotTree } from './contract';

declare const engine: EngineAfter5b;
declare function fail(message: string): never;
declare function check(condition: boolean, what: string): void;
const unwrap = <T>(outcome: QueryOutcome<T>): T => (outcome.ok ? outcome.result : fail(`${outcome.error.code}: ${outcome.error.message}`));
function run(...commands: CommandAfter5b[]): EngineState {
  const result = engine.execute(commands.length === 1 ? commands[0] : { type: 'batch', commands: commands as Command[] });
  return result.ok ? result.state : fail(result.error.message);
}
function preview(command: CommandAfter5b): EngineState {
  const result = engine.preview(command);
  return result.ok ? result.state : fail(result.error.message);
}
const near = (actual: number, expected: number, tolerance = 1e-9): boolean => Math.abs(actual - expected) <= tolerance;
const text = (file: ExportFile): string => new TextDecoder().decode(file.bytes);

// ================================================================ the common part, written out

// `robotTree` of `export/robot.ts` over the context of an export (the model as modelled). Shown so
// that what the contract names is enough for it: the mechanism resolved in the evaluation, the
// properties of the bodies, and `run` of the query `mass` with the same context.
declare const meshNameAsDeclared: typeof meshName;
export const robotTreeAsWritten: typeof robotTree = (context, options): RobotTree => {
  const { document, evaluation } = context.state;
  const section = document.mechanism;
  const mechanism = evaluation.mechanism;
  const roots = options.root === undefined ? mechanism.roots : [options.root];
  if (options.root !== undefined && !Object.hasOwn(section.links, options.root)) throw new QueryFailure(ROBOT_REFUSALS.noSuchRoot.code, `${ROBOT_REFUSALS.noSuchRoot.text}"${options.root}"`, ['root']);
  if (roots.length !== 1) throw new QueryFailure(ROBOT_REFUSALS.roots.code, `${ROBOT_REFUSALS.roots.text}${mechanism.roots.join(', ')}`, ['root']);
  const root = roots[0];
  const jointOf = (link: Id): Id | undefined => Object.keys(section.joints).find((id) => section.joints[id].child === link);
  const above = jointOf(root);
  if (above !== undefined) throw new QueryFailure(ROBOT_REFUSALS.notRoot.code, `${ROBOT_REFUSALS.notRoot.text}"${above}"`, ['root']);
  // the tree of the root, depth first, the children in the order of the joints of the section
  const order: Id[] = [];
  const jointOrder: Id[] = [];
  const walk = (link: Id): void => {
    order.push(link);
    for (const id of Object.keys(section.joints)) if (section.joints[id].parent === link) (jointOrder.push(id), walk(section.joints[id].child));
  };
  walk(root);
  // what blocks the export, each kind named whole
  const inError = jointOrder.filter((id) => mechanism.joints[id].status !== 'ok');
  if (inError.length) throw new QueryFailure('failed', ROBOT_REFUSALS.jointInError.text + inError.map((id) => `${id} (${mechanism.joints[id].error?.message})`).join('; '));
  const lacking = order.filter((id) => mechanism.links[id].missing.length > 0);
  if (lacking.length) throw new QueryFailure('failed', ROBOT_REFUSALS.missingBodies.text + lacking.map((id) => `${id}: ${mechanism.links[id].missing.join(', ')}`).join('; '));
  // the frame of a link: at the axis of its joint, with the axes of the model
  const origin = (link: Id): Vec3 => {
    const id = jointOf(link);
    if (id === undefined || link === root) return [0, 0, 0];
    const joint = section.joints[id];
    return joint.type === 'fixed' ? origin(joint.parent) : (mechanism.joints[id].axis as { origin: Vec3 }).origin;
  };
  const properties = evaluation.bodyProperties;
  const auxiliary: Id[] = [];
  const meshes: ExportFile[] = [];
  const links: RobotLink[] = order.map((id) => {
    const at = origin(id);
    const all = mechanism.links[id].bodies;
    const bodies = all.filter((body) => properties[body].use !== 'auxiliary');
    auxiliary.push(...all.filter((body) => !bodies.includes(body)));
    let mass: RobotLink['mass'];
    if (bodies.length) {
      let answer: MassProperties;
      try {
        answer = QUERIES.mass.run(context, { bodies, fill: 1 });
      } catch (error) {
        if (error instanceof QueryFailure) throw new QueryFailure('failed', `${ROBOT_REFUSALS.bodyMass.text}link "${id}": ${error.message}`);
        throw error;
      }
      mass = { mass: answer.mass, centerOfMass: answer.centerOfMass, inertia: answer.inertia };
    }
    const joint = jointOf(id);
    if (!mass && joint !== undefined && section.joints[joint].type !== 'fixed') throw new QueryFailure('failed', `${ROBOT_REFUSALS.massless.text}${id}`);
    const written = bodies.map((body) => {
      const solid = context.bodies[body].solid;
      const file = meshNameAsDeclared(body);
      const about: RobotMeshAbout = { bodies: [body], triangles: solid.triangles.length / 3, link: id };
      meshes.push({ path: file, mediaType: ROBOT_FILES.mesh.mediaType, bytes: new Uint8Array(84 + 50 * about.triangles), about }); // `toStl` of the moved positions, in metres
      const color = properties[body].color;
      return { body, file, triangles: about.triangles, ...(color === undefined ? {} : { color }) };
    });
    return { id, origin: at, ...(joint === undefined || id === root ? {} : { joint }), bodies: written, ...(mass ? { mass } : {}) };
  });
  const joints: RobotJoint[] = jointOrder.map((id) => {
    const joint = section.joints[id];
    const result = mechanism.joints[id] as JointResultAfter5b;
    const [a, b] = [origin(joint.parent), origin(joint.child)];
    return {
      id,
      type: joint.type,
      parent: joint.parent,
      child: joint.child,
      offset: [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      ...(result.axis ? { axis: result.axis.direction } : {}),
      ...(result.lower === undefined ? {} : { lower: result.lower, upper: result.upper }),
      value: result.value ?? 0,
      drive: result.drive ?? {},
    };
  });
  const about: RobotAbout = {
    root,
    links: order,
    joints: jointOrder,
    mass: links.reduce((sum, link) => sum + (link.mass?.mass ?? 0), 0),
    ...(mechanism.unassigned.length || auxiliary.length ? { leftOut: { ...(mechanism.unassigned.length ? { bodies: mechanism.unassigned } : {}), ...(auxiliary.length ? { auxiliary } : {}) } } : {}),
  };
  return { root, links, joints, meshes, about };
};

// ================================================================ the scenario

const SHOULDER = { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' } as const;
const ELBOW = { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' } as const;
const LINK = ['upper', 'motor', 'screw', 'screws/1', 'screws/2', 'screws/3'];
const shoulder = (drive: Partial<InputJointAfter5b> = {}): CommandAfter5b => ({ type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: SHOULDER, lower: 'deg(-90)', upper: 'deg(90)', value: 0, ...drive } as InputJointAfter5b });
const elbow = (drive: Partial<InputJointAfter5b> = {}): CommandAfter5b => ({ type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower: 'deg(-135)', upper: 'deg(135)', value: 0, ...drive } as InputJointAfter5b });

// The model of scenario 13 with the materials of 3a and the mechanism of 5a.
export function build(): EngineState {
  run(arm());
  run(
    { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
    { type: 'setBodyMaterial', body: 'forearm', material: 'PLA' },
    { type: 'setBodyProperties', body: 'motor', patch: { use: 'reference', mass: 280, color: '#30343a' } },
    { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
  );
  return run({ type: 'setLink', id: 'base', bodies: ['base'] }, { type: 'setLink', id: 'upper', name: 'Upper arm', bodies: LINK }, { type: 'setLink', id: 'forearm', bodies: ['forearm'] }, shoulder(), elbow());
}

// a. MJCF needs no drive; URDF refuses until every revolute joint has an effort and a velocity,
//    and names both joints at once.
export function withoutDrives(): void {
  const mjcf = unwrap(engine.export('mjcf', {}));
  check(mjcf.layout === 'directory', 'a set of files in one folder');
  // robot.xml, then a mesh per body in the order of the links: base, upper, motor, screw, screws_2F1, …, forearm
  check(mjcf.files.map((file) => file.path).join(' ') === 'robot.xml base.stl upper.stl motor.stl screw.stl screws_2F1.stl screws_2F2.stl screws_2F3.stl forearm.stl', 'the files');
  check(!text(mjcf.files[0]).includes('<actuator>'), 'no motor without an effort');
  const urdf = engine.export('urdf', {});
  check(!urdf.ok && urdf.error.code === 'failed' && urdf.error.message.includes(ROBOT_REFUSALS.urdfLimits.text) && urdf.error.message.includes('shoulder') && urdf.error.message.includes('elbow'), 'both joints named');
}

// b. The drives: a stepper with a gearbox at the shoulder (54 g·cm² rotor, 5.18 : 1), a servo at
//    the elbow (1.1 N·m, 6.2 rad/s); one batch, one undo step. An effort by an expression.
export function drives(): EngineState {
  return run(
    { type: 'setParameter', name: 'servoTorque', expr: '1100' },
    shoulder({ effort: 2000, velocity: 3, rotorInertia: 5400, gearRatio: 5.18 }),
    elbow({ effort: 'servoTorque', velocity: 6.2 }),
  );
}

// c. URDF: the frames, the masses and the meshes.
export function urdfOfTheArm(): Exported {
  const exported = unwrap(engine.export('urdf', { name: 'arm' }));
  const urdf = text(exported.files[0]);
  check(exported.files[0].path === ROBOT_FILES.urdf.path, 'robot.urdf first');
  // The upper arm turns about the shoulder (0, 0) and its frame is at the origin; the forearm turns
  // about the elbow (120, 0), so its joint stands 0.12 m along X from the frame of the upper arm.
  check(urdf.includes('<joint name="elbow" type="revolute">\n    <origin xyz="0.12 0 0" rpy="0 0 0"/>'), 'the elbow 120 mm along X');
  check(urdf.includes('<axis xyz="0 0 1"/>'), 'the normal of the sketch layout');
  // limits in radians as stored (±135° → ±2.356194490), effort in N·m (1100 N·mm → 1.1), velocity in rad/s
  check(urdf.includes('<limit lower="-2.35619449" upper="2.35619449" effort="1.1" velocity="6.2"/>'), 'the limits of the elbow');
  // The mass of a link is the query `mass` over its bodies as one piece: the upper arm with the
  // motor at 280 g and four screws at 0.9 g each. Measured: 438.953225 g, the centre of mass at
  // (60, 0, 16.177152) mm, the tensor diagonal (263950.017, 260284.936, 408222.075) g·mm², the
  // products zero (the arm is symmetric about XZ); the forearm 153.17451 g with ixz = −237.793 g·mm²
  // from its pin, which the file writes as −0.000000237793 kg·m².
  const upper = unwrap(engine.query('mass', { bodies: LINK }, { geometry: 'modelled' }));
  check(near(upper.mass, 280 + 4 * 0.9 + upper.bodies[0].mass, 1e-6), 'the motor and the screws with their stated masses');
  check(urdf.includes('<origin xyz="0.06 0 0.016177152" rpy="0 0 0"/>\n      <mass value="0.438953225"/>'), 'kilograms and metres, from the frame of the link');
  check(urdf.includes('ixz="-0.000000237793"'), 'the element of the tensor, minus the product of inertia');
  const about = exported.files[0].about as RobotAbout;
  check(about.root === 'base' && about.links.join() === 'base,upper,forearm' && about.joints.join() === 'shoulder,elbow', 'the tree');
  check(about.notWritten?.some((line) => line.includes('rotorInertia')) === true, 'URDF has no place for the rotor and the gear of the shoulder');
  // a mesh per body, in metres in the frame of its link: the forearm is moved by −120 mm in X
  const mesh = exported.files.find((file) => file.path === 'forearm.stl') as ExportFile;
  check((mesh.about as RobotMeshAbout).link === 'forearm', 'the link of the mesh');
  return exported;
}

// d. MJCF: the motors, the armature, the excluded pairs, and the pose of the document as a keyframe.
export function mjcfOfTheArm(): void {
  const xml = text(unwrap(engine.export('mjcf', { name: 'arm' })).files[0]);
  check(xml.includes('<compiler angle="radian" autolimits="true"/>'), 'radians: the default of MJCF is degrees');
  // the armature of the shoulder: 5400 g·mm² · 5.18² = 144,894.96 g·mm² = 0.00014489496 kg·m²
  check(xml.includes('armature="0.00014489496"'), 'the rotor reflected through the gear');
  // the motor of the shoulder: gear 5.18, the control the motor torque, 2 N·m / 5.18
  check(xml.includes('<motor name="shoulder" joint="shoulder" gear="5.18" ctrlrange="-0.386100386 0.386100386"/>'), 'the motor of the shoulder');
  check(xml.includes('<exclude body1="base" body2="upper"/>') && xml.includes('<exclude body1="upper" body2="forearm"/>'), 'the two links of a joint do not collide');
  check(!xml.includes('<keyframe>'), 'the pose of the document is zero');
  // Exported with a pose that is not written: the keyframe holds it, the bodies stay as modelled.
  const posed = unwrap(engine.export('mjcf', {}, { state: preview({ type: 'setPose', values: { shoulder: 0.3, elbow: -0.7 } }) }));
  check(text(posed.files[0]).includes('<key name="pose" qpos="0.3 -0.7"/>'), 'the keyframe in the order of the joints');
}

// e. What the export refuses or leaves out.
export function refusals(): void {
  // a second root (a link without a joint) is refused until `root` names one; the other tree is left out
  const twoRoots = preview({ type: 'setLink', id: 'gripper', bodies: [] });
  const refused = engine.export('urdf', {}, { state: twoRoots });
  check(!refused.ok && refused.error.code === 'invalidArguments' && refused.error.arg?.[0] === 'root' && refused.error.message.includes('base, gripper'), 'several roots');
  check((unwrap(engine.export('urdf', { root: 'base' }, { state: twoRoots })).files[0].about as RobotAbout).root === 'base', 'one tree');
  check(!engine.export('urdf', { root: 'upper' }).ok, 'a child is not a root');
  // the state after the forearm: the sketch of the axes comes later, so both joints are in error
  check(!engine.export('urdf', {}, { at: 'forearm' }).ok, 'a joint in error');
  // a forearm made auxiliary: the link a joint moves has no mass
  const massless = engine.export('mjcf', {}, { state: preview({ type: 'setBodyProperties', body: 'forearm', patch: { use: 'auxiliary' } }) });
  check(!massless.ok && massless.error.message.includes(ROBOT_REFUSALS.massless.text), 'no mass');
  // a body without a density or a mass: the text of the query `mass`, with the link
  const noDensity = engine.export('mjcf', {}, { state: preview({ type: 'setBodyProperties', body: 'base', patch: { material: null, density: null } }) });
  check(!noDensity.ok && noDensity.error.message.includes('link "base"'), 'which link');
  // a body of the model in no link is left out and named
  const leftOut = unwrap(engine.export('mjcf', {}, { state: preview({ type: 'setLink', id: 'upper', bodies: LINK.slice(0, -1) }) }));
  check((leftOut.files[0].about as RobotAbout).leftOut?.bodies?.join() === 'screws/3', 'a forgotten copy');
  // a broken expression of an effort: the joint stays ok for the pose, the export refuses
  const broken = preview({ type: 'removeParameter', name: 'servoTorque' } as CommandAfter5b);
  const elbowResult = broken.evaluation.mechanism.joints.elbow as JointResultAfter5b;
  check(elbowResult.status === 'ok' && elbowResult.driveErrors?.effort !== undefined, 'the pose is not blocked');
  check(!engine.export('urdf', {}, { state: broken }).ok, 'a stale effort is not written');
  // a document without a link
  check(NO_MECHANISM.startsWith('the model has no mechanism'), 'the text of `empty`');
}

// f. A picture of a pose that is not written: the tool view_image with `after`, through the path of
//    an operation. The request is of the previewed state, so the forearm is drawn turned; the
//    answer names the pose.
declare const host: Host;
declare function callHostOperation(host: Host, name: 'view_image', args: Record<string, unknown>): Promise<{ ok: true; result: { kind: 'image'; about: ViewImageAboutAfter5b & Record<string, unknown> } } | { ok: false; error: string }>;
declare const lastRequest: () => ImageRequest; // what the view of the test was asked to draw
export async function pictureOfAPose(): Promise<void> {
  const answer = await callHostOperation(host, 'view_image', { view: 'top', after: { type: 'setPose', values: { elbow: 1.2 } } });
  if (!answer.ok) return fail(answer.error);
  check(answer.result.about.pose?.elbow === 1.2, 'the pose drawn');
  const request = lastRequest();
  check(request.state.evaluation.mechanism.links.forearm.transform.matrix[0][0] !== 1, 'the forearm turned');
  check(engine.getState().evaluation.mechanism.joints.elbow.value === 0, 'nothing written');
  // the arguments are checked in the state asked about: the motor is not made yet after `upper`
  const early = await callHostOperation(host, 'view_image', { at: 'upper', bodies: ['base', 'motor'] });
  check(!early.ok && early.error.includes('bodies[1]'), 'checked in the state after upper');
  // a command that does not apply
  const wrong = await callHostOperation(host, 'view_image', { after: { type: 'setPose', values: { elbow: 3 } } });
  check(!wrong.ok && wrong.error.startsWith('after: '), 'outside the limits of the elbow');
}

// g. Over MCP: the tool `export` writes the set into a folder (the writer of the server as it is:
//    one folder, no subfolder); the answer lists every file with its `about`.
declare function callExportTool(args: { format: 'urdf' | 'mjcf'; path: string; options?: Record<string, unknown>; overwrite?: boolean; after?: Command }): Promise<{ files: ({ path: string; bytes: number } & Record<string, unknown>)[] }>;
export async function overMcp(): Promise<void> {
  const written = await callExportTool({ format: 'urdf', path: '/tmp/arm', options: { name: 'arm', meshPrefix: 'package://arm_description/' } });
  check(written.files[0].path.endsWith('robot.urdf') && written.files.length === 9, 'the description and eight meshes');
  // the MJCF into the same folder: the meshes are the same files, so replacing them needs `overwrite`
  await callExportTool({ format: 'mjcf', path: '/tmp/arm', overwrite: true });
}
