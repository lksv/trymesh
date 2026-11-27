// The format `mjcf` (5b, D59): the mechanism as a MuJoCo model (MJCF), with one binary STL per body
// beside it. The MuJoCo XML reference (doc/XMLreference.rst of google-deepmind/mujoco). The design
// is docs/d36/5b-robot-export/design.md.
//
// - `<compiler angle="radian" autolimits="true"/>`: the default unit of an angle is the degree.
// - The tree is nested bodies, each at the offset of its frame from its parent's; the root is
//   a child of `worldbody` with no joint, so it is welded to the world (an arm on a table).
//   A revolute and a continuous joint are a `hinge`, a prismatic one a `slide`, at `pos="0 0 0"`
//   with the axis as modelled; a fixed joint is no element.
// - `inertial` with `pos`, `mass` and `fullinertia` (M11 M22 M33 M12 M13 M23); a body without mass
//   has none (an empty root, an empty child of a fixed joint).
// - A mesh geom per body with its colour; with `collision: 'none'` `contype="0" conaffinity="0"`.
// - The two links of a joint are excluded from contact (`contact/exclude`), unless `none`.
// - A motor per joint with an effort: `gear` the gear ratio (1 without one) and `ctrlrange`
//   ±effort/gear, so the control is the torque of the motor. The armature of a turning joint with
//   a rotor is rotorInertia · gearRatio² (the reflected inertia).
// - The pose of the document is the keyframe `pose`, when a value is not 0.
// - MuJoCo enables a limit only when its lower bound is below the upper one: a joint with equal
//   bounds (as written) is refused. MJCF reserves the body name `world`.
import { QueryFailure } from '../query/spec';
import type { ExportFile, Id } from '../types';
import { NO_MECHANISM, ROBOT_FILES, ROBOT_OPTIONS, ROBOT_REFUSALS, type RobotAbout, type RobotTree, XML_HEAD, fileEffort, fileLength, linkById, metres, rgba, robotTree, writtenOptions } from './robot';
import { cosmeticThreadNotes, notesOf } from './notes';
import type { ExportFormatSpec } from './spec';
import { plain, significant, xmlText } from './text';

export const MJCF_OPTIONS = ROBOT_OPTIONS;

declare module './spec' {
  interface ExportFormats {
    mjcf: typeof MJCF_OPTIONS;
  }
}

const vector = (values: readonly number[]): string => values.map(plain).join(' ');

// The text of the description.
export function mjcfText(tree: RobotTree, options: { name: string; collision: boolean }): string {
  const lines: string[] = [
    XML_HEAD,
    '<!-- Written by trymesh: metres, kilograms, seconds, radians. Every frame has the axes of the model; the frame of a link is at the axis of the joint that moves it. -->',
    `<mujoco model="${xmlText(options.name)}">`,
    '  <compiler angle="radian" autolimits="true"/>',
  ];
  const meshes = tree.links.flatMap((link) => link.bodies);
  if (meshes.length) lines.push('  <asset>', ...meshes.map((body) => `    <mesh name="${xmlText(body.body)}" file="${xmlText(body.file)}"/>`), '  </asset>');
  const links = linkById(tree);
  const jointOf = new Map(tree.joints.map((joint) => [joint.child, joint]));
  const qpos: string[] = [];
  const motors: string[] = [];
  lines.push('  <worldbody>');
  const body = (id: Id, indent: string): void => {
    const link = links.get(id);
    if (!link) return;
    const joint = jointOf.get(id);
    const offset = joint ? joint.offset : link.origin;
    lines.push(`${indent}<body name="${xmlText(id)}" pos="${vector(offset.map(metres))}">`);
    if (joint && joint.type !== 'fixed' && joint.axis) {
      const { effort, rotorInertia, gearRatio } = joint.drive;
      const gear = gearRatio ?? 1;
      const range = joint.lower === undefined || joint.upper === undefined ? '' : ` range="${plain(fileLength(joint, joint.lower))} ${plain(fileLength(joint, joint.upper))}"`;
      const armature = joint.type !== 'prismatic' && rotorInertia !== undefined ? ` armature="${significant((rotorInertia * gear * gear) / 1e9)}"` : '';
      lines.push(`${indent}  <joint name="${xmlText(joint.id)}" type="${joint.type === 'prismatic' ? 'slide' : 'hinge'}" pos="0 0 0" axis="${vector(joint.axis)}"${range}${armature}/>`);
      qpos.push(plain(fileLength(joint, joint.value)));
      if (effort !== undefined) {
        const limit = fileEffort(joint, effort) / gear;
        motors.push(`    <motor name="${xmlText(joint.id)}" joint="${xmlText(joint.id)}" gear="${significant(gear)}" ctrlrange="${significant(-limit)} ${significant(limit)}"/>`);
      }
    }
    if (link.mass) {
      const { mass, centerOfMass, inertia: I } = link.mass;
      const scale = Math.max(I[0][0], I[1][1], I[2][2]) / 1e9;
      const full = [I[0][0], I[1][1], I[2][2], I[0][1], I[0][2], I[1][2]].map((value) => significant(value / 1e9, scale)).join(' ');
      lines.push(`${indent}  <inertial pos="${vector(centerOfMass.map((value, k) => metres(value - link.origin[k])))}" mass="${significant(mass / 1000)}" fullinertia="${full}"/>`);
    }
    for (const written of link.bodies) {
      lines.push(`${indent}  <geom name="${xmlText(written.body)}" type="mesh" mesh="${xmlText(written.body)}"${written.color === undefined ? '' : ` rgba="${rgba(written.color)}"`}${options.collision ? '' : ' contype="0" conaffinity="0"'}/>`);
    }
    for (const child of tree.joints) if (child.parent === id) body(child.child, `${indent}  `);
    lines.push(`${indent}</body>`);
  };
  body(tree.root, '    ');
  lines.push('  </worldbody>');
  if (options.collision && tree.joints.length) lines.push('  <contact>', ...tree.joints.map((joint) => `    <exclude body1="${xmlText(joint.parent)}" body2="${xmlText(joint.child)}"/>`), '  </contact>');
  if (motors.length) lines.push('  <actuator>', ...motors, '  </actuator>');
  if (qpos.some((value) => value !== '0')) lines.push('  <keyframe>', `    <key name="pose" qpos="${qpos.join(' ')}"/>`, '  </keyframe>');
  lines.push('</mujoco>', '');
  return lines.join('\n');
}

// What the document says and MJCF does not write, one sentence each.
export function mjcfNotWritten(tree: RobotTree): string[] {
  const out: string[] = [];
  for (const joint of tree.joints) {
    const { effort, velocity, rotorInertia, gearRatio } = joint.drive;
    if (velocity !== undefined) out.push(`joint "${joint.id}": velocity: a motor clamps its control, not the speed of the joint, so the velocity is not written`);
    if (gearRatio !== undefined && effort === undefined && rotorInertia === undefined) out.push(`joint "${joint.id}": gearRatio: the gear lives in the motor and the armature, and the joint has neither an effort nor a rotor inertia`);
  }
  return out;
}

export const mjcf: ExportFormatSpec<typeof MJCF_OPTIONS> = {
  title: 'MJCF (MuJoCo)',
  summary:
    'The mechanism as a MuJoCo model: a folder with robot.xml and one binary STL per body in metres in the frame of its link. One tree from one root link, welded to the world; the frame of a link at the axis of its joint with the axes of the model; the mass, centre of mass and inertia of each link from its bodies (query mass); a mesh geom per body, the two links of a joint excluded from contact; a motor per joint with an `effort` (with `gearRatio`), `rotorInertia · gearRatio²` as the armature of the joint, and the pose of the document as the keyframe `pose`.',
  options: MJCF_OPTIONS,
  run(context, options) {
    if (Object.keys(context.state.document.mechanism.links).length === 0) return { layout: 'directory', files: [], empty: NO_MECHANISM };
    writtenOptions(options);
    const tree = robotTree(context, options);
    if (tree.links.some((link) => link.id === 'world')) throw new QueryFailure(ROBOT_REFUSALS.mjcfWorld.code, ROBOT_REFUSALS.mjcfWorld.text);
    // equal bounds as written: MuJoCo would turn the limit off
    const locked = tree.joints.filter((joint) => joint.lower !== undefined && joint.upper !== undefined && plain(fileLength(joint, joint.lower)) === plain(fileLength(joint, joint.upper)));
    if (locked.length) throw new QueryFailure(ROBOT_REFUSALS.mjcfLocked.code, ROBOT_REFUSALS.mjcfLocked.text + locked.map((joint) => joint.id).join(', '));
    const collision = options.collision !== 'none';
    const notWritten = mjcfNotWritten(tree);
    const about: RobotAbout = { ...tree.about, ...(notWritten.length ? { notWritten } : {}) };
    const text = mjcfText(tree, { name: options.name ?? 'robot', collision });
    const description: ExportFile = { path: ROBOT_FILES.mjcf.path, mediaType: ROBOT_FILES.mjcf.mediaType, bytes: new TextEncoder().encode(text), about };
    return { layout: 'directory', files: [description, ...tree.meshes], ...notesOf(cosmeticThreadNotes(tree.links.flatMap((link) => link.bodies.map((written) => written.body)), context.threadsAsModelled)) };
  },
};
