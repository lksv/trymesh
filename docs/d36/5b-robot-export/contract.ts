// Contract of package 5b of D36 (decision D59): the export of a robot description as URDF and as
// MJCF, and a picture of a state that is not written (`at` and `after` on the path of an operation
// of the app, for `view_image`). A draft, only type-checked (`npx tsc -p docs/d36/tsconfig.json`).
// It imports the real types of the engine and of the MCP package of master and states what the
// package adds or changes. The design is design.md; the scenario written as calls is calls.ts.
//
// What the package adds to the document: four optional numeric fields of a joint (the drive of
// a joint: `effort`, `velocity`, and for a turning joint `rotorInertia` and `gearRatio`). The
// entries of the section `mechanism` are strict (a field a build does not know is refused on
// load, `onlyFields` in `sections/mechanism.ts`), so no upgrade step: a build without the package
// refuses a document with a drive instead of dropping it (docs/architecture/api.md, "load",
// "When a step is needed"). No command, no query, no feature type, no face role, no issue code.
//
// Every value of a file format below is given with its source (design.md, "Sources"):
//   [URDF-link], [URDF-joint], [URDF-robot]: wiki.ros.org/urdf/XML/link, /joint, /robot
//   [urdfdom]: github.com/ros/urdfdom, urdf_parser/src/joint.cpp, link.cpp, model.cpp (the C++
//     parser of ROS; what it refuses)
//   [MJCF]: the MuJoCo XML reference, github.com/google-deepmind/mujoco doc/XMLreference.rst,
//     by the anchor of the element (`compiler-angle`, `body-inertial-fullinertia`, ...)
//   [RFC3986]: RFC 3986, section 2.3 (unreserved characters)

// `packages/mcp/src/tools.ts` imports the generated description of the API, a text imported
// with `?raw`; its declaration is here so that this draft can import the types of the MCP package.
/// <reference path="../../../packages/mcp/src/raw.d.ts" />
import type { ArgSpecs, ArgsOf, Engine, EngineState, ExportFile, ExportFormatSpec, ExportFormats, Exported, Expr, ExpressionError, Id, Joint, JointResult, NumberSpec, PoseNote, QueryContext, QueryOptions, QueryOutcome, RunArgsOf, Unit, Vec3 } from '../../../packages/engine/src/index';
import type { Host } from '../../../packages/mcp/src/host';
import type { ToolAnswer } from '../../../packages/mcp/src/tools';
import type { ImageRequest } from '../../../packages/mcp/src/view-image';
import { VIEW_IMAGE_ARGS } from '../../../packages/mcp/src/view-image';

// ================================================================ the drive of a joint

// `catalog.ts`: the units of the new fields. The engine's lengths stay millimetres and its masses
// grams; a force is in newtons, so a torque is in newton-millimetres.
export type UnitAfter5b = Unit | 'N' | 'N·mm' | 'rad/s' | 'mm/s' | 'g·mm2';
export type NumberSpecAfter5b = Omit<NumberSpec, 'unit'> & { unit: UnitAfter5b };

// What drives a joint, for the export; nothing of the recompute, of a pose or of a query reads it.
// Each field is optional and is a numeric field of the joint by the rule of a section (D48: a
// number or an expression in a command, the last valid number in the document, the expression in
// `expressions` of the joint under the name of the field, renamed with a parameter).
// - `effort`: the largest force or torque the drive gives at the joint: N·mm for a revolute and
//   a continuous joint, N for a prismatic one. Above 0.
// - `velocity`: the largest speed of the joint: rad/s, or mm/s for a prismatic one. Above 0.
// - `rotorInertia` (revolute, continuous): the moment of inertia of what turns inside the drive
//   (a rotor, the first stage of a gearbox) about its own axis, at the motor, in g·mm² (the unit
//   of the query `mass`; 1 g·mm² = 1e-9 kg·m²). At least 0. A data sheet gives it in g·cm² (×100)
//   or kg·m² (×1e9).
// - `gearRatio` (revolute, continuous): turns of the motor per turn of the joint. Above 0; 1 when
//   it is not stated.
// A prismatic joint has `effort` and `velocity` only: what a rotor reflects through a screw or
// a belt is a mass and needs the lead, which is deferred. A fixed joint has none.
export interface TurningDrive {
  effort?: number;
  velocity?: number;
  rotorInertia?: number;
  gearRatio?: number;
}
export interface ShiftingDrive {
  effort?: number;
  velocity?: number;
}
type DriveExpressions = { effort?: Expr; velocity?: Expr; rotorInertia?: Expr; gearRatio?: Expr };
export type JointAfter5b = (
  | Extract<Joint, { type: 'fixed' }>
  | (Extract<Joint, { type: 'revolute' | 'continuous' }> & TurningDrive)
  | (Extract<Joint, { type: 'prismatic' }> & ShiftingDrive)
) & { expressions?: DriveExpressions };

// `sections/mechanism.ts`, beside `JOINT_FIELDS` (which stays the list of the fields of the pose:
// `value`, `lower`, `upper`; the app's slider and `setPose` read it). The validator of a joint
// allows the fields of both lists for its kind and requires only those of `JOINT_FIELDS`; a field
// of another kind is refused as today (`onlyFields`). `SECTION_INFO` lists both, with `when`.
// `EntryField` of `sections/fields.ts` gets `optional?: true`, which `readEntryFields` already
// honours (it skips a field that is not there); the check that every field is there skips it.
const positive = (title: string, unit: UnitAfter5b): NumberSpecAfter5b => ({ title, unit, min: { value: 0, open: true } });
export const JOINT_DRIVE_FIELDS = {
  revolute: [
    { path: 'effort', spec: positive('Effort', 'N·mm'), optional: true },
    { path: 'velocity', spec: positive('Velocity', 'rad/s'), optional: true },
    { path: 'rotorInertia', spec: { title: 'Rotor inertia', unit: 'g·mm2', min: { value: 0 } }, optional: true },
    { path: 'gearRatio', spec: positive('Gear ratio', 'none'), optional: true },
  ],
  continuous: [
    { path: 'effort', spec: positive('Effort', 'N·mm'), optional: true },
    { path: 'velocity', spec: positive('Velocity', 'rad/s'), optional: true },
    { path: 'rotorInertia', spec: { title: 'Rotor inertia', unit: 'g·mm2', min: { value: 0 } }, optional: true },
    { path: 'gearRatio', spec: positive('Gear ratio', 'none'), optional: true },
  ],
  prismatic: [
    { path: 'effort', spec: positive('Effort', 'N'), optional: true },
    { path: 'velocity', spec: positive('Velocity', 'mm/s'), optional: true },
  ],
  fixed: [],
} as const satisfies { readonly [T in Joint['type']]: readonly { path: string; spec: NumberSpecAfter5b; optional: true }[] };

// `types.ts`, `JointResult`: the numbers of the drive as the recompute resolved them, and the
// fields whose expression does not evaluate (each an `ExpressionError`, no `Issue`). A fault of
// a drive field does NOT put the joint in error: `status`, `error` and `fieldErrors` stay what D49 defines (the pose, the limits and the
// axis), so a broken expression of an effort blocks no pose and no query. A field in
// `driveErrors` is left out of `drive`; the export refuses such a joint (it would write a stale
// number; both formats refuse it, so that a broken effort is not written as an effort not stated),
// and `get_model` lists it (`jointDriveErrors`, next to `jointErrors`).
export type JointResultAfter5b = JointResult & {
  drive?: TurningDrive; // the fields the joint states, resolved; absent when it states none
  driveErrors?: { effort?: ExpressionError; velocity?: ExpressionError; rotorInertia?: ExpressionError; gearRatio?: ExpressionError };
};

// The command: `setJoint` takes the drive fields in the input form with the rest of the joint. It
// replaces the joint whole for what D49 has (all of it required), and for the drive it is a patch:
// a drive field the command does not name is kept from the joint of the same kind it replaces,
// `null` removes it, a joint of another kind starts without a drive. A string equal to the
// expression a field already has is kept without evaluation, for the drive fields as for the
// fields of the pose (the loop over `JOINT_FIELDS[type]` in `setJoint` runs over both lists).
export type SetJointAfter5b = { type: 'setJoint'; id: Id; joint: InputJointAfter5b };
type InputOf<T> = { [K in keyof T]: T[K] extends number ? number | Expr : T[K] extends number | undefined ? number | Expr | null | undefined : T[K] };
export type InputJointAfter5b = JointAfter5b extends infer J ? (J extends JointAfter5b ? InputOf<J> : never) : never;

// ================================================================ the formats

// The options both formats take.
// - `name`: the name of the robot (URDF `robot/@name`, which [URDF-robot] requires) and of the
//   model (MJCF `mujoco/@model`). Default `robot`.
// - `root`: the link the description starts at. Required when the mechanism has several roots;
//   the trees of the other roots are then left out and named in `about`. A link that is a joint's
//   child is not a root and is refused.
// - `collision`: `meshes` (default) writes every visual mesh again as collision geometry; `none`
//   writes none (URDF without `collision`, MJCF geoms with `contype="0" conaffinity="0"` and no
//   `contact`). MuJoCo collides the convex hull of a mesh [MJCF asset-mesh]: an assembly whose
//   parts sit inside each other (a gearbox in its housing) is in contact everywhere at rest with
//   `meshes` (design.md, "Measured").
export const ROBOT_OPTIONS = {
  name: { kind: 'text', title: 'Name', summary: 'The name of the robot in the file; `robot` without it.', optional: true },
  root: { kind: 'text', title: 'Root link', summary: 'The ID of the link the description starts at. Needed only when the mechanism has several roots; the others are left out.', optional: true },
  collision: { kind: 'choice', options: ['meshes', 'none'], title: 'Collision', summary: 'meshes (the default): every mesh is also a collision shape (MuJoCo takes its convex hull, so parts inside a housing touch it); none: no collision shapes.', optional: true },
} as const satisfies ArgSpecs;
// URDF has one more: `meshPrefix`, put before the name of every mesh file in `filename`. Without it
// the name alone, a path relative to the URDF (MuJoCo and yourdfpy resolve it so; design.md,
// "Measured"). For ROS, which resolves `package://` [URDF-link], `package://<package>/<folder>/`.
// MuJoCo does not resolve `package://` (measured), so a URDF for MuJoCo is written without it.
export const URDF_OPTIONS = {
  ...ROBOT_OPTIONS,
  meshPrefix: { kind: 'text', title: 'Mesh prefix', summary: 'Put before every mesh file name, such as package://arm_description/meshes/ for ROS; without it the files are named relative to the URDF.', optional: true },
} as const satisfies ArgSpecs;
export const MJCF_OPTIONS = ROBOT_OPTIONS;

// The catalog after the package (a stated map, as in 3e: merging into the real `ExportFormats`
// would make the real catalog lack two entries in this program).
export interface ExportFormatsAfter5b extends ExportFormats {
  urdf: typeof URDF_OPTIONS;
  mjcf: typeof MJCF_OPTIONS;
}
export declare const urdf: ExportFormatSpec<typeof URDF_OPTIONS>;
export declare const mjcf: ExportFormatSpec<typeof MJCF_OPTIONS>;

// The files: layout `directory`, all in one folder (no subfolder: the writer of the server stays
// as it is). The description, then one binary STL per body, in the order the description names
// them. The same meshes for both formats.
export const ROBOT_FILES = {
  urdf: { path: 'robot.urdf', mediaType: 'application/xml' },
  mjcf: { path: 'robot.xml', mediaType: 'application/xml' },
  mesh: { mediaType: 'model/stl' },
} as const;
// The file name of the mesh of a body: `meshName(body)`, `<name>.stl` where every byte of the
// body ID as UTF-8 outside A–Z, a–z, 0–9, `.` and `-` is `_` and two hexadecimal digits, upper
// case (`screws/1` → `screws_2F1.stl`, `a_b` → `a_5Fb.stl`). Different IDs give different names
// over the IDs the export accepts (no lone surrogate: see `badName`), and every character of the
// name is unreserved in a URI [RFC3986], so a reader that takes `filename` as a URI (ROS) and one
// that takes it as a path (MuJoCo, yourdfpy) open the same file. (`bodyFileName` of `stl` writes
// `%2F`, which a URI reader decodes to a slash.) Two names that differ only in the case of
// letters are refused (`caseClash`): one folder on macOS or Windows cannot hold both.
export declare function meshName(body: Id): string;

// What `about` of the description says, for the answer of the tool `export` (the note about the
// export as a whole, need 17 of cross-review.md, lives here: `Exported` does not change).
export type RobotAbout = {
  root: Id;
  links: Id[]; // written, depth first from the root, the children in the order of the joints of the section
  joints: Id[]; // written, in the same order
  mass: number; // g, of everything written
  leftOut?: {
    bodies?: Id[]; // bodies of the state in no link (`unassigned` of the mechanism)
    auxiliary?: Id[]; // bodies of written links with the use `auxiliary`: no mesh, no mass
    links?: Id[]; // links of the trees of other roots, with `root`
  };
  coupled?: Id[]; // joints whose value follows an expression: written as free joints
  // What the document says and the format does not write, one sentence each, by joint and field:
  // URDF the rotor and the gear, a continuous joint with only one of effort and velocity, the
  // pose, and with collisions that the pairs of a joint are not excluded from contact; MJCF the
  // velocity of a joint.
  notWritten?: string[];
};
// What `about` of a mesh says (as `MeshAbout` of 3MF).
export type RobotMeshAbout = { bodies: [Id]; triangles: number; link: Id };

// ================================================================ the common part: export/robot.ts

// The tree of links as both writers need it, from the context of the export (the model as
// modelled, D49) and its options. Numbers in the units of the engine (mm, g, g·mm², rad); the
// writers convert.
// - The frame of a link has the axes of the model. Its origin (`origin`, in model coordinates):
//   for the child of a revolute, continuous or prismatic joint the origin of the joint's axis as
//   modelled (`JointResult.axis.origin`: the sketch point, or the origin of the model for a base
//   axis); for the child of a fixed joint the origin of its parent; for the root the origin of the
//   model. So a joint stands at the origin of its child [URDF-joint], `origin` of a joint is the
//   difference of the two origins, and a mesh is only moved, never turned.
// - The bodies of a link: `LinkResult.bodies` in their order, without the auxiliary ones.
// - The mass of a link: `mass.run` of the query over those bodies as one piece, in the context of
//   the export: `mass`, `centerOfMass` and `inertia` (about the centre of mass, in the axes of the
//   model; off the diagonal the element of the tensor, minus the product of inertia, which is
//   what both formats write [URDF-link], [MJCF body-inertial-fullinertia]). A link without such
//   a body has no mass. A link moved by a revolute, continuous or prismatic joint has to carry
//   a mass together with the links welded to it (itself and those below it through fixed joints
//   only), which is what MuJoCo checks of a moving body; otherwise `massless`.
// - A document without a link is `empty`; the format checks it before it calls `robotTree`.
// - A mesh: the positions of the body minus the origin of its link, over 1000 (metres), rounded to
//   float32, with its triangles, as binary STL (`toStl`).
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
  offset: Vec3; // mm: origin of the child minus origin of the parent
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
export declare function robotTree(context: QueryContext, options: { root?: Id }): RobotTree;

// What the export refuses, as `QueryFailure` (the code, the argument, and the start of the text).
// A refusal names everything of its kind at once (every joint without an effort), so one fix is
// enough.
export const ROBOT_REFUSALS = {
  roots: { code: 'invalidArguments', arg: ['root'], text: 'the mechanism has several roots; give `root`, one of: ' },
  noSuchRoot: { code: 'notAvailable', arg: ['root'], text: 'the mechanism has no link ' },
  notRoot: { code: 'invalidArguments', arg: ['root'], text: 'the link is the child of the joint ' },
  jointInError: { code: 'failed', text: 'a joint is in error, so where its link stands is not known: ' },
  driveInError: { code: 'failed', text: 'a field of the drive of a joint does not evaluate: ' },
  missingBodies: { code: 'failed', text: 'a link lists bodies the model does not have (a link would be written lighter than it is): ' },
  massless: { code: 'failed', text: 'a link that a joint moves has no mass, neither of its own nor on the links fixed to it (no body, or only auxiliary bodies); a simulation cannot move it: ' },
  bodyMass: { code: 'failed', text: 'the mass of a link cannot be computed: ' }, // with the text of the query `mass`, and how to set a material
  badName: { code: 'failed', text: 'an ID holds a character XML cannot hold (a control character, half of a surrogate pair), so it cannot be written as it is: ' }, // of a link, a joint or a body written; any change by `xmlText` beyond its four entities
  caseClash: { code: 'failed', text: 'two mesh files would differ only in the case of letters, which one folder on macOS or Windows cannot hold: ' },
  mjcfLocked: { code: 'failed', text: 'MuJoCo needs the lower limit of a joint below its upper one (equal bounds turn the limit off); make the joint fixed: ' }, // also bounds written equal by nine decimals
  urdfLimits: { code: 'failed', text: 'URDF requires an effort and a velocity of every revolute and prismatic joint (setJoint with `effort` and `velocity`): ' },
  mjcfWorld: { code: 'failed', text: 'MJCF reserves the body name world, so the link "world" cannot be written; give the link another ID' },
} as const;
// `Exported.empty` when the document has no link.
export const NO_MECHANISM = 'the model has no mechanism: a robot description needs links and joints (setLink, setJoint)';

// ================================================================ the two files

// Numbers (`export/text.ts`): no exponent, never "-0".
// - Lengths in metres and angles in radians: nine decimals (`plain`), a nanometre.
// - A mass, a velocity, an effort, an armature and a gear: nine significant digits.
// - The six numbers of an inertia tensor: nine significant digits of its largest diagonal element,
//   so what lies under that (the noise of a product of inertia that is zero) is written as 0.
// - A colour: the channel over 255, six decimals.
export declare function significant(value: number, scale?: number): string;
// The units of the files: metres, kilograms, kg·m², seconds, radians [URDF-joint] (`origin`, the
// limits), [MJCF compiler-angle]. Lengths ·1e-3, masses ·1e-3, inertia ·1e-9, a torque in N·mm
// ·1e-3, a speed in mm/s ·1e-3; each by a division by the power of ten, so a round number of the
// model is a round number of the file.
//
// URDF, in this order:
//   <?xml version="1.0" encoding="UTF-8"?>
//   <!-- Written by trymesh. ... -->
//   <robot name="…">                                                   [URDF-robot]
//     <material name="#rrggbb"><color rgba="r g b 1"/></material>        per colour of a written body [URDF-link]
//     <link name="…">                                                  per link, depth first
//       <inertial><origin xyz="c" rpy="0 0 0"/><mass value="m"/>
//         <inertia ixx ixy ixz iyy iyz izz/></inertial>                 a link with mass; c = centre of mass − origin
//       <visual name="body"><geometry><mesh filename="prefix+file"/></geometry><material name="#rrggbb"/></visual>
//       <collision name="body"><geometry><mesh filename="prefix+file"/></geometry></collision>   per body; collision unless `none`
//     </link>
//     <joint name="…" type="revolute|continuous|prismatic|fixed">       per joint, in the order of the links [URDF-joint]
//       <origin xyz="offset" rpy="0 0 0"/><parent link/><child link/>
//       <axis xyz="direction"/>                                          not for fixed
//       <limit lower upper effort velocity/>                             revolute, prismatic: required [urdfdom]
//       <limit effort velocity/>                                         continuous, when the joint states both
//     </joint>
//   </robot>
//
// MJCF:
//   <mujoco model="…">
//     <compiler angle="radian" autolimits="true"/>                       [MJCF compiler-angle]: the default is degree
//     <asset><mesh name="body" file="file"/>…</asset>                    per body [MJCF asset-mesh]
//     <worldbody>
//       <body name="link" pos="offset">                                  nested along the tree; the root at its origin, welded
//         <joint name type="hinge|slide" pos="0 0 0" axis range armature/>   not for the root or a fixed joint;
//                                                                        range for revolute, prismatic; armature =
//                                                                        rotorInertia · gearRatio² [MJCF body-joint-armature]
//         <inertial pos="c" mass fullinertia="Ixx Iyy Izz Ixy Ixz Iyz"/> a link with mass [MJCF body-inertial]
//         <geom name="body" type="mesh" mesh="body" rgba/>               per body; contype/conaffinity 0 with `none`
//     </worldbody>
//     <contact><exclude body1="parent" body2="child"/>…</contact>        per joint, unless `none` [MJCF contact-exclude]
//     <actuator><motor name joint gear ctrlrange="±effort/gear"/></actuator>   per joint with an effort [MJCF actuator-motor]
//     <keyframe><key name="pose" qpos="…"/></keyframe>                    when a value is not 0: the pose of the document
//   </mujoco>

// ================================================================ the engine

export interface EngineAfter5b extends Omit<Engine, 'export' | 'execute' | 'preview'> {
  execute(cmd: CommandAfter5b): ReturnType<Engine['execute']>;
  preview(cmd: CommandAfter5b, at?: Id): ReturnType<Engine['preview']>;
  export<F extends keyof ExportFormatsAfter5b>(format: F, options: ArgsOf<ExportFormatsAfter5b[F]>, queryOptions?: QueryOptions): QueryOutcome<Exported>;
}
export type CommandAfter5b = Parameters<Engine['execute']>[0] | SetJointAfter5b;

// ================================================================ a picture of a state that is not written

// `packages/mcp/src/host.ts`. Every operation of the app takes `at` and `after` on its path, as the
// tool `query` does; they are not arguments of an operation's description.
// - `callHostOperation(host, name, args)` takes `at` and `after` out of `args`, and asks the state:
//   with `after`, `engine.preview(after, at)`, which answers for `at` as well (`after` may add the
//   feature `at` names; a command that does not apply is the answer `after: <its error>`);
//   otherwise `engine.getState(at)`, with an `at` that names no feature of the document answered
//   `notAvailable: at: …` before the engine is asked. Nothing is written.
// - It checks the other arguments against the description in THAT state (`checkArgs` with its
//   document and evaluation), so a body only an earlier state has can be named with `at` (a known
//   limit of 1f goes), and a body that a previewed command adds can be named with `after`.
// - It hands the state to `run`.
// - The server lists `at` and `after` in the input schema of every operation (`operationTools` in
//   server.ts), and describe_api lists them with the arguments of every operation.
export const OPERATION_STATE_ARGS = {
  at: { type: 'string', description: 'Feature ID; the state after it' },
  after: { type: 'object', description: 'A command (as for execute) to preview first; the operation works on the result and the document does not change.' },
} as const;
export interface HostOperationAfter5b<S> {
  title: string;
  summary: string;
  returns: string;
  args: S;
  run: (host: Host, args: RunArgsOf<S>, state: EngineState) => Promise<QueryOutcome<ToolAnswer>>;
}

// `view-image.ts`: `at` leaves the arguments (the path takes it); the request is of the state the
// path hands over, and the section of a picture is asked with `{ state }`. The budget of the
// section stays the last, optional parameter (the tests of 1f use it). With a section, a drawn
// body whose pose is not known (a blocked link) is refused with the operation's own text (the
// joints, and `after: setPose` to zero or fewer bodies); without one it is drawn.
const { at: _movedToThePath, ...VIEW_IMAGE_ARGS_REST } = VIEW_IMAGE_ARGS;
export const VIEW_IMAGE_ARGS_AFTER_5B = VIEW_IMAGE_ARGS_REST;
export type ViewImageArgsAfter5b = RunArgsOf<typeof VIEW_IMAGE_ARGS_AFTER_5B>;
export declare function imageRequestAfter5b(host: Host, args: ViewImageArgsAfter5b, state: EngineState, budget?: number): ImageRequest | Extract<QueryOutcome<ToolAnswer>, { ok: false }>;
// `about` of the picture gains two members, for a state whose mechanism holds a pose:
// - `pose`: the joints that move the model, with their values (`poseNote` of the drawn state, as
//   the tools `query` and `get_body` put it beside their answers);
// - `blocked`: the joints that have no motion, with the drawn bodies beyond them: those are drawn
//   with the joint standing at zero (the transform of `LinkResult`), as the view of the app draws
//   them, and the picture says so instead of refusing.
export type ViewImageAboutAfter5b = { pose?: PoseNote['pose']; blocked?: { joint: Id; bodies: Id[] }[] };

// ================================================================ for the AI

// A paragraph of `CONVENTIONS` in `packages/mcp/src/api.ts`.
export const CONVENTION =
  'A robot description is the export format `urdf` or `mjcf` (tool `export`, a directory): the description and one STL per body, in metres and kilograms. ' +
  'It is the mechanism as modelled: one tree from one root link (`root` when there are several), the frame of a link at the axis of the joint that moves it with the axes of the model, the mass, the centre of mass and the inertia of each link from its bodies (a reference part with the mass of its properties, auxiliary bodies left out). ' +
  'Every link a joint moves needs a mass; URDF needs `effort` (N·mm, N for a prismatic joint) and `velocity` (rad/s, mm/s) of every revolute and prismatic joint: set them with setJoint. ' +
  'MJCF also writes a motor per joint with an effort, with `gearRatio`, and `rotorInertia · gearRatio²` as the armature of the joint, and the pose of the document as the keyframe `pose`. ' +
  'setJoint keeps the drive of a joint it is not given (null removes a field). ' +
  'MuJoCo collides the convex hulls of the meshes; the MJCF excludes the two links of a joint from each other, which URDF cannot say, so use the MJCF for MuJoCo. Parts nested in a housing touch it, so export such a model with `collision: "none"`. ' +
  'A coupled motion (two values over one parameter) is written as free joints. ' +
  'The operation view_image takes `at` and `after` as the tool query does: `after: { type: "setPose", values: { … } }` draws a pose without writing it; a body beyond a joint without a motion is drawn with the joint at zero, and refused when a section is asked.';
