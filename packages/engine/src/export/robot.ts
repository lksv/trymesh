// The common part of the robot descriptions `urdf` and `mjcf` (5b, D59): the mechanism of the state
// as one tree of links from one root, as both writers need it. The design is
// docs/d36/5b-robot-export/design.md.
//
// - The context is that of an export: the model as modelled (D49), whatever pose the document holds;
//   the pose is in the values of the joints.
// - The frame of a link has the axes of the model. Its origin: for the child of a revolute,
//   continuous or prismatic joint the origin of the axis of the joint as modelled (the sketch
//   point, or the origin of the model for a base axis); for the child of a fixed joint the origin
//   of its parent; for the root the origin of the model. So a joint stands at the origin of its
//   child (URDF), the offset of a joint is the difference of the two origins, and a mesh is only
//   moved, never turned.
// - The bodies of a link are those of `LinkResult.bodies` without the auxiliary ones. The mass of
//   a link is `run` of the query `mass` over them as one piece, in the context of the export.
// - A mesh per body: its positions minus the origin of its link over 1000 (metres), float32, as
//   binary STL, named by `meshName`.
// Numbers here are in the units of the engine (mm, g, g·mm², rad); the writers convert.
import type { ArgSpecs } from '../query/args';
import { mass as massQuery } from '../query/mass';
import { type QueryContext, QueryFailure } from '../query/spec';
import { toStl } from '../solid';
import type { ExportFile, Id, Joint, TurningDrive, Vec3 } from '../types';
import { has } from '../util';
import { decimals, xmlText } from './text';

// The options both formats take.
export const ROBOT_OPTIONS = {
  name: { kind: 'text', title: 'Name', summary: 'The name of the robot in the file; `robot` without it.', optional: true },
  root: { kind: 'text', title: 'Root link', summary: 'The ID of the link the description starts at. Needed only when the mechanism has several roots; the others are left out.', optional: true },
  collision: {
    kind: 'choice',
    options: ['meshes', 'none'],
    title: 'Collision',
    summary: 'meshes (the default): every mesh is also a collision shape (MuJoCo takes its convex hull, so parts inside a housing touch it); none: no collision shapes.',
    optional: true,
  },
} as const satisfies ArgSpecs;

// The files: the description first, then one binary STL per body, all in one folder.
export const ROBOT_FILES = {
  urdf: { path: 'robot.urdf', mediaType: 'application/xml' },
  mjcf: { path: 'robot.xml', mediaType: 'application/xml' },
  mesh: { mediaType: 'model/stl' },
} as const;

// What the export refuses, as `QueryFailure`: the code, the argument, and the start of the text.
// A refusal names everything of its kind at once, so one fix is enough.
export const ROBOT_REFUSALS = {
  roots: { code: 'invalidArguments', arg: ['root'], text: 'the mechanism has several roots; give `root`, one of: ' },
  noSuchRoot: { code: 'notAvailable', arg: ['root'], text: 'the mechanism has no link ' },
  notRoot: { code: 'invalidArguments', arg: ['root'], text: 'the link is the child of the joint ' },
  jointInError: { code: 'failed', text: 'a joint is in error, so where its link stands is not known: ' },
  driveInError: { code: 'failed', text: 'a field of the drive of a joint does not evaluate: ' },
  missingBodies: { code: 'failed', text: 'a link lists bodies the model does not have (a link would be written lighter than it is): ' },
  massless: { code: 'failed', text: 'a link that a joint moves has no mass, neither of its own nor on the links fixed to it (no body, or only auxiliary bodies); a simulation cannot move it: ' },
  bodyMass: { code: 'failed', text: 'the mass of a link cannot be computed: ' },
  badName: { code: 'failed', text: 'an ID holds a character XML cannot hold (a control character, half of a surrogate pair), so it cannot be written as it is: ' },
  caseClash: { code: 'failed', text: 'two mesh files would differ only in the case of letters, which one folder on macOS or Windows cannot hold: ' },
  mjcfLocked: {
    code: 'failed',
    text: 'MuJoCo needs the lower limit of a joint below its upper one (equal bounds turn the limit off). A fixed joint holds its child as modelled, so it stands for a joint locked at 0 only; a joint locked elsewhere has to be modelled there, or exported as URDF: ',
  },
  urdfLimits: { code: 'failed', text: 'URDF requires an effort and a velocity of every revolute and prismatic joint (setJoint with `effort` and `velocity`): ' },
  mjcfWorld: { code: 'failed', text: 'MJCF reserves the body name world, so the link "world" cannot be written; give the link another ID' },
} as const;

// `Exported.empty` when the document has no link.
export const NO_MECHANISM = 'the model has no mechanism: a robot description needs links and joints (setLink, setJoint)';

// What `about` of the description says (type aliases, so they are assignable to `ExportFile.about`).
export type RobotAbout = {
  root: Id;
  links: Id[]; // written, depth first from the root, the children in the order of the joints of the section
  joints: Id[]; // written, in the same order
  mass: number; // g, of everything written
  leftOut?: {
    bodies?: Id[]; // bodies of the state in no link
    auxiliary?: Id[]; // bodies of written links with the use `auxiliary`: no mesh, no mass
    links?: Id[]; // links of the trees of other roots
  };
  coupled?: Id[]; // joints whose value follows an expression: written as free joints
  notWritten?: string[]; // what the document says and the format does not write, one sentence each
};
// What `about` of a mesh says.
export type RobotMeshAbout = { bodies: [Id]; triangles: number; link: Id };

export interface RobotLink {
  id: Id;
  origin: Vec3; // mm, model coordinates
  joint?: Id; // the joint the link is the child of; none for the root
  bodies: { body: Id; file: string; color?: string; triangles: number }[];
  mass?: { mass: number; centerOfMass: Vec3; inertia: [Vec3, Vec3, Vec3] }; // g, mm (model), g·mm²
}
export interface RobotJoint {
  id: Id;
  type: Joint['type'];
  parent: Id;
  child: Id;
  offset: Vec3; // mm: the origin of the child minus the origin of the parent
  axis?: Vec3; // unit, as modelled; not for a fixed joint
  lower?: number; // rad or mm, revolute and prismatic
  upper?: number;
  value: number; // the pose of the document (0 for a fixed joint)
  drive: TurningDrive; // as resolved; an empty object when the joint states none
}
export interface RobotTree {
  root: Id;
  links: RobotLink[]; // depth first from the root
  joints: RobotJoint[]; // in the same order
  meshes: ExportFile[];
  about: RobotAbout;
}

// The file name of the mesh of a body: `<name>.stl`, where every byte of the body ID as UTF-8
// outside A–Z, a–z, 0–9, `.` and `-` is `_` and two hexadecimal digits, upper case (`screws/1` →
// `screws_2F1.stl`, `a_b` → `a_5Fb.stl`). Different IDs give different names (over the IDs the
// export accepts: no lone surrogate), and every character is unreserved in a URI (RFC 3986, 2.3),
// so a reader that takes `filename` as a URI (ROS) and one that takes it as a path (MuJoCo) open
// the same file. (`bodyFileName` writes `%2F`, which a URI reader decodes to a slash.)
export function meshName(body: Id): string {
  let name = '';
  for (const byte of new TextEncoder().encode(body)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9.-]/.test(char) ? char : `_${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `${name}.stl`;
}

const fail = (refusal: { code: 'notAvailable' | 'invalidArguments' | 'failed'; text: string; arg?: readonly string[] }, what = ''): never => {
  throw new QueryFailure(refusal.code, refusal.text + what, refusal.arg ? [...refusal.arg] : undefined);
};
const moves = (type: Joint['type']): boolean => type !== 'fixed';
// An ID is written as it is when `xmlText` changes nothing in it beyond its four entities.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };
const writtenAsItIs = (id: Id): boolean => xmlText(id).replace(/&(amp|lt|gt|quot);/g, (_, entity: string) => ENTITIES[entity]) === id;

// The tree of the mechanism of the context from one root (`root`, or the one root there is). The
// format checks first that the document has a link (`NO_MECHANISM`).
export function robotTree(context: QueryContext, options: { root?: Id }): RobotTree {
  const { document, evaluation } = context.state;
  const section = document.mechanism;
  const mechanism = evaluation.mechanism;
  const properties = evaluation.bodyProperties;
  if (options.root !== undefined && !has(section.links, options.root)) fail(ROBOT_REFUSALS.noSuchRoot, `"${options.root}"; its links are ${Object.keys(section.links).join(', ')}`);
  const roots = options.root === undefined ? mechanism.roots : [options.root];
  if (roots.length !== 1) fail(ROBOT_REFUSALS.roots, mechanism.roots.join(', '));
  const root = roots[0];
  const jointIds = Object.keys(section.joints);
  const jointOf = (link: Id): Id | undefined => jointIds.find((id) => section.joints[id].child === link);
  const above = jointOf(root);
  if (above !== undefined) fail(ROBOT_REFUSALS.notRoot, `"${above}"; a root is a link that is no joint's child: ${mechanism.roots.join(', ')}`);

  // the tree, depth first, the children of a link in the order of the joints of the section
  const order: Id[] = [];
  const jointOrder: Id[] = [];
  const walk = (link: Id): void => {
    order.push(link);
    for (const id of jointIds) {
      if (section.joints[id].parent !== link) continue;
      jointOrder.push(id);
      walk(section.joints[id].child);
    }
  };
  walk(root);

  // what blocks the export, each kind named whole
  const inError = jointOrder.filter((id) => mechanism.joints[id].status !== 'ok');
  if (inError.length) fail(ROBOT_REFUSALS.jointInError, inError.map((id) => `${id} (${mechanism.joints[id].error?.code ?? 'error'}: ${mechanism.joints[id].error?.message ?? ''})`).join('; '));
  // a broken drive is refused by both formats, not written as a drive not stated
  const driveFaults = jointOrder.filter((id) => mechanism.joints[id].driveErrors !== undefined);
  if (driveFaults.length) {
    fail(ROBOT_REFUSALS.driveInError, driveFaults.map((id) => `${id} (${Object.entries(mechanism.joints[id].driveErrors ?? {}).map(([field, error]) => `${field}: ${error?.message}`).join(', ')})`).join('; '));
  }
  const auxiliary = (body: Id): boolean => has(properties, body) && properties[body].use === 'auxiliary';
  const writtenBodies = (link: Id): Id[] => mechanism.links[link].bodies.filter((body) => !auxiliary(body));
  // IDs written as they are: none that `xmlText` changes beyond its four entities
  const bad = [...order, ...jointOrder, ...order.flatMap(writtenBodies)].filter((id) => !writtenAsItIs(id));
  if (bad.length) fail(ROBOT_REFUSALS.badName, bad.map((id) => JSON.stringify(id)).join(', '));
  const lacking = order.filter((id) => mechanism.links[id].missing.length > 0);
  if (lacking.length) fail(ROBOT_REFUSALS.missingBodies, lacking.map((id) => `${id}: ${mechanism.links[id].missing.join(', ')}`).join('; '));

  // the frame of a link: at the axis of its joint, with the axes of the model
  const origins = new Map<Id, Vec3>();
  const origin = (link: Id): Vec3 => {
    const known = origins.get(link);
    if (known) return known;
    const id = link === root ? undefined : jointOf(link);
    const joint = id === undefined ? undefined : section.joints[id];
    const at: Vec3 = id === undefined || joint === undefined ? [0, 0, 0] : joint.type === 'fixed' ? origin(joint.parent) : [...(mechanism.joints[id].axis?.origin ?? [0, 0, 0])];
    origins.set(link, at);
    return at;
  };

  const meshes: ExportFile[] = [];
  const leftAuxiliary: Id[] = [];
  const links: RobotLink[] = order.map((id) => {
    const at = origin(id);
    const bodies = writtenBodies(id);
    leftAuxiliary.push(...mechanism.links[id].bodies.filter(auxiliary));
    let mass: RobotLink['mass'];
    if (bodies.length) {
      try {
        const answer = massQuery.run(context, { bodies, fill: 1 });
        mass = { mass: answer.mass, centerOfMass: answer.centerOfMass, inertia: answer.inertia };
      } catch (error) {
        if (error instanceof QueryFailure) fail(ROBOT_REFUSALS.bodyMass, `link "${id}": ${error.message}`);
        throw error;
      }
    }
    const joint = id === root ? undefined : jointOf(id);
    const written = bodies.map((body) => {
      const solid = context.bodies[body].solid;
      const positions = new Float32Array(solid.positions.length);
      for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) positions[i + k] = (solid.positions[i + k] - at[k]) / 1000;
      const file = meshName(body);
      const about: RobotMeshAbout = { bodies: [body], triangles: solid.triangles.length / 3, link: id };
      meshes.push({ path: file, mediaType: ROBOT_FILES.mesh.mediaType, bytes: toStl([{ ...solid, positions }]), about });
      const color = has(properties, body) ? properties[body].color : undefined;
      return { body, file, triangles: about.triangles, ...(color === undefined ? {} : { color }) };
    });
    return { id, origin: at, ...(joint === undefined ? {} : { joint }), bodies: written, ...(mass ? { mass } : {}) };
  });

  // a moving link carries a mass together with the links welded to it (fixed joints down the tree)
  const byId = new Map(links.map((link) => [link.id, link]));
  const welded = (link: Id): Id[] => [link, ...jointIds.filter((id) => section.joints[id].parent === link && section.joints[id].type === 'fixed').flatMap((id) => welded(section.joints[id].child))];
  const massless = links.filter((link) => link.joint !== undefined && moves(section.joints[link.joint].type) && welded(link.id).every((id) => byId.get(id)?.mass === undefined));
  if (massless.length) fail(ROBOT_REFUSALS.massless, massless.map((link) => link.id).join(', '));
  const folded = new Map<string, string>();
  for (const { path } of meshes) {
    const other = folded.get(path.toLowerCase());
    if (other !== undefined) fail(ROBOT_REFUSALS.caseClash, `${other} and ${path}`);
    folded.set(path.toLowerCase(), path);
  }

  const joints: RobotJoint[] = jointOrder.map((id) => {
    const joint = section.joints[id];
    const result = mechanism.joints[id];
    const [a, b] = [origin(joint.parent), origin(joint.child)];
    return {
      id,
      type: joint.type,
      parent: joint.parent,
      child: joint.child,
      offset: [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      ...(result.axis && moves(joint.type) ? { axis: result.axis.direction } : {}),
      ...(result.lower === undefined || result.upper === undefined ? {} : { lower: result.lower, upper: result.upper }),
      value: joint.type === 'fixed' ? 0 : (result.value ?? 0),
      drive: result.drive ?? {},
    };
  });
  const otherTrees = Object.keys(section.links).filter((id) => !order.includes(id));
  const coupled = jointOrder.filter((id) => section.joints[id].expressions?.value !== undefined);
  const leftOut = {
    ...(mechanism.unassigned.length ? { bodies: [...mechanism.unassigned] } : {}),
    ...(leftAuxiliary.length ? { auxiliary: leftAuxiliary } : {}),
    ...(otherTrees.length ? { links: otherTrees } : {}),
  };
  const about: RobotAbout = {
    root,
    links: order,
    joints: jointOrder,
    mass: links.reduce((sum, link) => sum + (link.mass?.mass ?? 0), 0),
    ...(Object.keys(leftOut).length ? { leftOut } : {}),
    ...(coupled.length ? { coupled } : {}),
  };
  return { root, links, joints, meshes, about };
}

// ---------------------------------------------------------------- what both writers share

// The units of the files are metres, kilograms, kg·m², seconds and radians. Each conversion is
// a division by a power of ten, so a round number of the model stays round in the file.
export const metres = (mm: number): number => mm / 1000;
// A joint's effort in the file: N·m from N·mm for a turning joint, N for a prismatic one; its
// velocity: rad/s, or m/s from mm/s.
export const fileEffort = (joint: RobotJoint, effort: number): number => (joint.type === 'prismatic' ? effort : effort / 1000);
export const fileVelocity = (joint: RobotJoint, velocity: number): number => (joint.type === 'prismatic' ? velocity / 1000 : velocity);
// A limit or a value in the file: radians, or metres from millimetres.
export const fileLength = (joint: RobotJoint, value: number): number => (joint.type === 'prismatic' ? value / 1000 : value);
// A colour `#rrggbb` as the channels over 255 with six decimals, opaque.
export const rgba = (color: string): string => `${[1, 3, 5].map((at) => decimals(Number.parseInt(color.slice(at, at + 2), 16) / 255, 6)).join(' ')} 1`;
export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
// The colours of the written bodies, in the order they first come.
export const colorsOf = (tree: RobotTree): string[] => [...new Set(tree.links.flatMap((link) => link.bodies.flatMap((body) => (body.color === undefined ? [] : [body.color]))))];
// The links of a tree by ID.
export const linkById = (tree: RobotTree): Map<Id, RobotLink> => new Map(tree.links.map((link) => [link.id, link]));
