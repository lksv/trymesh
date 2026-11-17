// The format `urdf` (5b, D59): the mechanism as a URDF robot description, with one binary STL per
// body beside it. URDF XML specification (wiki.ros.org/urdf/XML/link, /joint, /robot) and what
// `urdfdom`, the parser of ROS, refuses. The design is docs/d36/5b-robot-export/design.md.
//
// - No rotation is written: every frame has the axes of the model, so every `rpy` is `0 0 0`. The
//   inertial frame is at the centre of mass, and the six numbers are the elements of the tensor of
//   the query `mass` (off the diagonal minus the product of inertia, the convention of URDF).
// - A material per colour of a written body, at the top level, named by the colour (urdfdom
//   refuses a top-level material name twice).
// - A visual and a collision per body, both its mesh, named by the body ID; `collision: 'none'`
//   leaves the collisions out.
// - A revolute and a prismatic joint need `<limit lower upper effort velocity/>` (urdfdom refuses
//   the file otherwise): a joint without both an effort and a velocity is refused, every such
//   joint named at once. A continuous joint gets `<limit effort velocity/>` when it states both.
// - The root is not fixed to anything: URDF has no world; the simulator decides.
import type { ArgSpecs } from '../query/args';
import { QueryFailure } from '../query/spec';
import type { ExportFile } from '../types';
import { NO_MECHANISM, ROBOT_FILES, ROBOT_OPTIONS, ROBOT_REFUSALS, type RobotAbout, type RobotJoint, type RobotTree, XML_HEAD, colorsOf, fileEffort, fileLength, fileVelocity, metres, rgba, robotTree } from './robot';
import type { ExportFormatSpec } from './spec';
import { plain, significant, xmlText } from './text';

export const URDF_OPTIONS = {
  ...ROBOT_OPTIONS,
  meshPrefix: {
    kind: 'text',
    title: 'Mesh prefix',
    summary: 'Put before every mesh file name, such as package://arm_description/meshes/ for ROS; without it the files are named relative to the URDF (MuJoCo does not resolve package://).',
    optional: true,
  },
} as const satisfies ArgSpecs;

declare module './spec' {
  interface ExportFormats {
    urdf: typeof URDF_OPTIONS;
  }
}

const vector = (values: readonly number[]): string => values.map(plain).join(' ');
const turning = (joint: RobotJoint): boolean => joint.type === 'revolute' || joint.type === 'continuous';

// The text of the description.
export function urdfText(tree: RobotTree, options: { name: string; collision: boolean; meshPrefix: string }): string {
  const lines: string[] = [XML_HEAD, '<!-- Written by trymesh: metres, kilograms, seconds, radians. Every frame has the axes of the model; the frame of a link is at the axis of the joint that moves it. -->', `<robot name="${xmlText(options.name)}">`];
  for (const color of colorsOf(tree)) lines.push(`  <material name="${color}"><color rgba="${rgba(color)}"/></material>`);
  for (const link of tree.links) {
    if (!link.mass && link.bodies.length === 0) {
      lines.push(`  <link name="${xmlText(link.id)}"/>`);
      continue;
    }
    lines.push(`  <link name="${xmlText(link.id)}">`);
    if (link.mass) {
      const { mass, centerOfMass, inertia: I } = link.mass;
      const scale = Math.max(I[0][0], I[1][1], I[2][2]) / 1e9;
      const element = (value: number): string => significant(value / 1e9, scale);
      lines.push(
        '    <inertial>',
        `      <origin xyz="${vector(centerOfMass.map((value, k) => metres(value - link.origin[k])))}" rpy="0 0 0"/>`,
        `      <mass value="${significant(mass / 1000)}"/>`,
        `      <inertia ixx="${element(I[0][0])}" ixy="${element(I[0][1])}" ixz="${element(I[0][2])}" iyy="${element(I[1][1])}" iyz="${element(I[1][2])}" izz="${element(I[2][2])}"/>`,
        '    </inertial>',
      );
    }
    for (const body of link.bodies) {
      const mesh = `<geometry><mesh filename="${xmlText(options.meshPrefix + body.file)}"/></geometry>`;
      lines.push(`    <visual name="${xmlText(body.body)}">${mesh}${body.color === undefined ? '' : `<material name="${body.color}"/>`}</visual>`);
      if (options.collision) lines.push(`    <collision name="${xmlText(body.body)}">${mesh}</collision>`);
    }
    lines.push('  </link>');
  }
  for (const joint of tree.joints) {
    lines.push(`  <joint name="${xmlText(joint.id)}" type="${joint.type}">`, `    <origin xyz="${vector(joint.offset.map(metres))}" rpy="0 0 0"/>`, `    <parent link="${xmlText(joint.parent)}"/>`, `    <child link="${xmlText(joint.child)}"/>`);
    if (joint.axis) lines.push(`    <axis xyz="${vector(joint.axis)}"/>`);
    const { effort, velocity } = joint.drive;
    const drive = effort === undefined || velocity === undefined ? undefined : `effort="${significant(fileEffort(joint, effort))}" velocity="${significant(fileVelocity(joint, velocity))}"`;
    if (joint.lower !== undefined && joint.upper !== undefined && drive) lines.push(`    <limit lower="${plain(fileLength(joint, joint.lower))}" upper="${plain(fileLength(joint, joint.upper))}" ${drive}/>`);
    else if (joint.type === 'continuous' && drive) lines.push(`    <limit ${drive}/>`);
    lines.push('  </joint>');
  }
  lines.push('</robot>', '');
  return lines.join('\n');
}

// What the document says and URDF does not write, one sentence each.
export function urdfNotWritten(tree: RobotTree, collision: boolean): string[] {
  const out: string[] = [];
  for (const joint of tree.joints) {
    const { effort, velocity, rotorInertia, gearRatio } = joint.drive;
    const fields = [...(rotorInertia === undefined ? [] : ['rotorInertia']), ...(gearRatio === undefined ? [] : ['gearRatio'])];
    if (turning(joint) && fields.length) out.push(`joint "${joint.id}": ${fields.join(' and ')}: URDF has no place for the rotor or the gear of a drive (outside a transmission of ros_control); the MJCF writes them`);
    if (joint.type === 'continuous' && (effort === undefined) !== (velocity === undefined)) out.push(`joint "${joint.id}": ${effort === undefined ? 'velocity' : 'effort'}: the limit of a continuous joint needs both an effort and a velocity, so it is left out`);
  }
  const posed = tree.joints.filter((joint) => joint.value !== 0);
  if (posed.length) out.push(`the pose of the document (${posed.map((joint) => `${joint.id} ${plain(joint.value)}`).join(', ')}): URDF has no place for it; the file is the model as modelled, the zero of every joint`);
  if (collision && tree.joints.length) out.push('the two links of a joint are not excluded from contact: URDF cannot say it, so a reader that collides convex hulls (MuJoCo) may find the parts of a joint in contact at rest; for MuJoCo use the MJCF');
  return out;
}

export const urdf: ExportFormatSpec<typeof URDF_OPTIONS> = {
  title: 'URDF (robot)',
  summary:
    'The mechanism as a URDF robot description for ROS and simulators: a folder with robot.urdf and one binary STL per body in metres in the frame of its link. One tree from one root link; the frame of a link at the axis of its joint with the axes of the model; the mass, centre of mass and inertia of each link from its bodies (query mass); a visual and a collision mesh per body. Every revolute and prismatic joint needs `effort` and `velocity` (setJoint). The root is not fixed: the simulator decides.',
  options: URDF_OPTIONS,
  run(context, options) {
    if (Object.keys(context.state.document.mechanism.links).length === 0) return { layout: 'directory', files: [], empty: NO_MECHANISM };
    const tree = robotTree(context, options);
    const lacking = tree.joints.filter((joint) => (joint.type === 'revolute' || joint.type === 'prismatic') && (joint.drive.effort === undefined || joint.drive.velocity === undefined));
    if (lacking.length) throw new QueryFailure(ROBOT_REFUSALS.urdfLimits.code, ROBOT_REFUSALS.urdfLimits.text + lacking.map((joint) => `${joint.id} (${[joint.drive.effort === undefined ? 'effort' : '', joint.drive.velocity === undefined ? 'velocity' : ''].filter(Boolean).join(', ')})`).join('; '));
    const collision = options.collision !== 'none';
    const notWritten = urdfNotWritten(tree, collision);
    const about: RobotAbout = { ...tree.about, ...(notWritten.length ? { notWritten } : {}) };
    const text = urdfText(tree, { name: options.name ?? 'robot', collision, meshPrefix: options.meshPrefix ?? '' });
    const description: ExportFile = { path: ROBOT_FILES.urdf.path, mediaType: ROBOT_FILES.urdf.mediaType, bytes: new TextEncoder().encode(text), about };
    return { layout: 'directory', files: [description, ...tree.meshes] };
  },
};
