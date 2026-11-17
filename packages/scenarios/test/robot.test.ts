// The export of a robot description (5b, D59, docs/d36/5b-robot-export/design.md): the common part
// (`export/robot.ts`) and the writers `urdf` and `mjcf` against the real adapters. The arm of
// scenario 13 is in scenario13.test.ts; here the arm extended to every kind of joint, the whole text
// of a small mechanism, the names, the numbers and every refusal.
import { type Command, type Engine, type EngineState, type ExportFile, type Exported, type Id, ROBOT_REFUSALS, type RobotAbout, createEngine, meshName, significant } from '@trymesh/engine';
import { createManifoldKernel } from '@trymesh/kernel-manifold';
import { createPlanegcsSolver } from '@trymesh/solver-planegcs';
import { beforeAll, describe, expect, it } from 'vitest';
import { arm, cylinder } from './arm';
import { run } from './kit';

const text = (file: ExportFile): string => new TextDecoder().decode(file.bytes);
const exportOf = (engine: Engine, format: 'urdf' | 'mjcf', options: object = {}, state?: EngineState): Exported => {
  const outcome = engine.export(format, options as never, state ? { state } : {});
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result;
};
const refusalOf = (engine: Engine, format: 'urdf' | 'mjcf', options: object = {}, state?: EngineState) => {
  const outcome = engine.export(format, options as never, state ? { state } : {});
  if (outcome.ok) throw new Error('the export was not refused');
  return outcome.error;
};
const previewOf = (engine: Engine, command: Command): EngineState => {
  const outcome = engine.preview(command);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.state;
};
const SHOULDER = { kind: 'sketchPoint', sketch: 'layout', point: 'shoulder' } as const;
const ELBOW = { kind: 'sketchPoint', sketch: 'layout', point: 'elbow' } as const;
const CAP = { kind: 'sketchPoint', sketch: 'layout', point: 'capAxis' } as const;
const Z = { kind: 'base', axis: 'Z' } as const;

// Two discs of PLA, `low` and `high` standing on it; `high` turns on `low` about Z.
function discs(engine: Engine, joint: object = {}): EngineState {
  const disc = (id: string, start: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start, distance: 10 }, operation: 'new' } });
  return run(engine, {
    type: 'batch',
    commands: [
      { type: 'addFeature', feature: { id: 's', name: 's', suppressed: false, type: 'sketch', plane: { kind: 'base', plane: 'XY' }, points: {}, radii: {}, curves: {}, constraints: {}, external: {}, solved: { inputs: '', external: {} } } },
      { type: 'addCurve', sketch: 's', id: 'k', curve: { type: 'circle', center: 'origin' }, radius: 5 },
      disc('low', 0),
      disc('high', 10),
      { type: 'setBodyMaterial', body: 'low', material: 'PLA' },
      { type: 'setBodyMaterial', body: 'high', material: 'PLA' },
      { type: 'setBodyProperties', body: 'high', patch: { color: '#FF8800' } },
      { type: 'setLink', id: 'base', bodies: ['low'] },
      { type: 'setLink', id: 'top', bodies: ['high'] },
      { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: Z, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2, ...joint } as never },
    ],
  });
}

describe('the export of a robot: the whole text of a small mechanism', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    discs(engine);
  });

  it('URDF', () => {
    const exported = exportOf(engine, 'urdf');
    expect(exported.files.map((file) => [file.path, file.mediaType])).toEqual([['robot.urdf', 'application/xml'], ['low.stl', 'model/stl'], ['high.stl', 'model/stl']]);
    expect(text(exported.files[0])).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!-- Written by trymesh: metres, kilograms, seconds, radians. Every frame has the axes of the model; the frame of a link is at the axis of the joint that moves it. -->
      <robot name="robot">
        <material name="#ff8800"><color rgba="1 0.533333 0 1"/></material>
        <link name="base">
          <inertial>
            <origin xyz="0 0 0.005" rpy="0 0 0"/>
            <mass value="0.000971332562"/>
            <inertia ixx="0.0000000141493095" ixy="0" ixz="0" iyy="0.0000000141493101" iyz="0" izz="0.0000000121097435"/>
          </inertial>
          <visual name="low"><geometry><mesh filename="low.stl"/></geometry></visual>
          <collision name="low"><geometry><mesh filename="low.stl"/></geometry></collision>
        </link>
        <link name="top">
          <inertial>
            <origin xyz="0 0 0.015" rpy="0 0 0"/>
            <mass value="0.000971332562"/>
            <inertia ixx="0.0000000141493095" ixy="0" ixz="0" iyy="0.0000000141493101" iyz="0" izz="0.0000000121097435"/>
          </inertial>
          <visual name="high"><geometry><mesh filename="high.stl"/></geometry><material name="#ff8800"/></visual>
          <collision name="high"><geometry><mesh filename="high.stl"/></geometry></collision>
        </link>
        <joint name="turn" type="revolute">
          <origin xyz="0 0 0" rpy="0 0 0"/>
          <parent link="base"/>
          <child link="top"/>
          <axis xyz="0 0 1"/>
          <limit lower="-1" upper="1" effort="0.5" velocity="2"/>
        </joint>
      </robot>
      "
    `);
    expect(exported.files[0].about).toMatchInlineSnapshot(`
      {
        "joints": [
          "turn",
        ],
        "links": [
          "base",
          "top",
        ],
        "mass": 1.9426651249304683,
        "notWritten": [
          "the two links of a joint are not excluded from contact: URDF cannot say it, so a reader that collides convex hulls (MuJoCo) may find the parts of a joint in contact at rest; for MuJoCo use the MJCF",
        ],
        "root": "base",
      }
    `);
    expect(exported.files[1].about).toEqual({ bodies: ['low'], triangles: engine.getState().evaluation.bodies.low.solid.triangles.length / 3, link: 'base' });
  });

  it('MJCF', () => {
    const exported = exportOf(engine, 'mjcf');
    expect(exported.files.map((file) => file.path)).toEqual(['robot.xml', 'low.stl', 'high.stl']);
    expect(text(exported.files[0])).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!-- Written by trymesh: metres, kilograms, seconds, radians. Every frame has the axes of the model; the frame of a link is at the axis of the joint that moves it. -->
      <mujoco model="robot">
        <compiler angle="radian" autolimits="true"/>
        <asset>
          <mesh name="low" file="low.stl"/>
          <mesh name="high" file="high.stl"/>
        </asset>
        <worldbody>
          <body name="base" pos="0 0 0">
            <inertial pos="0 0 0.005" mass="0.000971332562" fullinertia="0.0000000141493095 0.0000000141493101 0.0000000121097435 0 0 0"/>
            <geom name="low" type="mesh" mesh="low"/>
            <body name="top" pos="0 0 0">
              <joint name="turn" type="hinge" pos="0 0 0" axis="0 0 1" range="-1 1"/>
              <inertial pos="0 0 0.015" mass="0.000971332562" fullinertia="0.0000000141493095 0.0000000141493101 0.0000000121097435 0 0 0"/>
              <geom name="high" type="mesh" mesh="high" rgba="1 0.533333 0 1"/>
            </body>
          </body>
        </worldbody>
        <contact>
          <exclude body1="base" body2="top"/>
        </contact>
        <actuator>
          <motor name="turn" joint="turn" gear="1" ctrlrange="-0.5 0.5"/>
        </actuator>
      </mujoco>
      "
    `);
    // the same meshes as the URDF
    expect(exported.files.slice(1)).toEqual(exportOf(engine, 'urdf').files.slice(1));
  });
});

// The arm of scenario 13 extended to every kind of joint (design.md, "Measured"): the motor a link of
// its own on a fixed joint, a tool off the axis on the forearm, a slider on a prismatic joint along
// the base axis X, a cap on a continuous joint about a point of `layout`.
describe('the export of a robot: the arm extended to every kind of joint', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    run(engine, arm());
    run(engine, { type: 'batch', commands: [...cylinder('tool', 200, 25, 6, 16, 30), ...cylinder('slider', 240, 0, 6, 16, 24), ...cylinder('cap', 240, 0, 3, 24, 30), { type: 'addPoint', sketch: 'layout', id: 'capAxis', x: 240, y: 0 }, { type: 'addConstraint', sketch: 'layout', id: 'capAxisFix', constraint: { type: 'fixed', point: 'capAxis', x: 240, y: 0 } }] });
    run(engine, {
      type: 'batch',
      commands: [
        { type: 'setBodyMaterial', body: 'base', material: 'PETG' },
        { type: 'setBodyMaterial', body: 'upper', material: 'PETG' },
        ...['forearm', 'tool', 'slider', 'cap'].map((body): Command => ({ type: 'setBodyMaterial', body, material: 'PLA' })),
        { type: 'setBodyProperties', body: 'motor', patch: { use: 'reference', mass: 280, color: '#30343a' } },
        { type: 'setBodyProperties', body: 'screw', patch: { use: 'reference', mass: 0.9 } },
        { type: 'setLink', id: 'base', bodies: ['base'] },
        { type: 'setLink', id: 'upper', bodies: ['upper', 'screw', 'screws/1', 'screws/2', 'screws/3'] },
        { type: 'setLink', id: 'motor', bodies: ['motor'] },
        { type: 'setLink', id: 'forearm', bodies: ['forearm', 'tool'] },
        { type: 'setLink', id: 'slider', bodies: ['slider'] },
        { type: 'setLink', id: 'cap', bodies: ['cap'] },
        // the cap's joint first: the tree is walked from the root, whatever the order of the section
        { type: 'setJoint', id: 'spin', joint: { type: 'continuous', parent: 'slider', child: 'cap', axis: CAP, value: 0, effort: 100, velocity: 10, rotorInertia: 2, gearRatio: 3 } },
        { type: 'setJoint', id: 'shoulder', joint: { type: 'revolute', parent: 'base', child: 'upper', axis: SHOULDER, lower: 'deg(-90)', upper: 'deg(90)', value: 0, effort: 2000, velocity: 3, rotorInertia: 5400, gearRatio: 5 } },
        { type: 'setJoint', id: 'mount', joint: { type: 'fixed', parent: 'upper', child: 'motor' } },
        { type: 'setJoint', id: 'elbow', joint: { type: 'revolute', parent: 'upper', child: 'forearm', axis: ELBOW, lower: 'deg(-135)', upper: 'deg(135)', value: 0, effort: 1000, velocity: 4 } },
        { type: 'setJoint', id: 'slide', joint: { type: 'prismatic', parent: 'forearm', child: 'slider', axis: { kind: 'base', axis: 'X' }, lower: 0, upper: 20, value: 0, effort: 50, velocity: 100 } },
      ],
    });
  });

  it('the frames: a link at the axis of its joint, a fixed child at its parent, a slide along a base axis at the origin of the model', () => {
    const urdf = exportOf(engine, 'urdf');
    const about = urdf.files[0].about as RobotAbout;
    expect(about.links).toEqual(['base', 'upper', 'motor', 'forearm', 'slider', 'cap']);
    expect(about.joints).toEqual(['shoulder', 'mount', 'elbow', 'slide', 'spin']);
    const description = text(urdf.files[0]);
    const origin = (joint: string): string => (description.match(new RegExp(`<joint name="${joint}" type="\\w+">\\n    <origin xyz="([^"]*)"`)) as RegExpMatchArray)[1];
    expect(['shoulder', 'mount', 'elbow', 'slide', 'spin'].map(origin)).toEqual(['0 0 0', '0 0 0', '0.12 0 0', '-0.12 0 0', '0.24 0 0']);
    expect(description).toContain('<joint name="mount" type="fixed">\n    <origin xyz="0 0 0" rpy="0 0 0"/>\n    <parent link="upper"/>\n    <child link="motor"/>\n  </joint>');
    expect(description).toContain('<joint name="slide" type="prismatic">');
    expect(description).toContain('<axis xyz="1 0 0"/>\n    <limit lower="0" upper="0.02" effort="50" velocity="0.1"/>');
    expect(description).toContain('<joint name="spin" type="continuous">');
    expect(description).toContain('<limit effort="0.1" velocity="10"/>');
    // the tool off the axis gives the forearm products of inertia
    expect(description).toMatch(/<link name="forearm">\n    <inertial>\n      <origin xyz="0.060060343 0.000315712 0.012113283" rpy="0 0 0"\/>\n      <mass value="0.155133612"\/>\n      <inertia ixx="[0-9.]+" ixy="-0.000000976595" ixz="-0.000000668509" iyy="[0-9.]+" iyz="-0.000000533205" izz="[0-9.]+"\/>/);
    // a mesh of the cap in the frame of its link: around its own origin
    const xml = text(exportOf(engine, 'mjcf').files[0]);
    expect(xml).toContain('<body name="slider" pos="-0.12 0 0">\n            <joint name="slide" type="slide" pos="0 0 0" axis="1 0 0" range="0 0.02"/>');
    expect(xml).toContain('<joint name="spin" type="hinge" pos="0 0 0" axis="0 0 1" armature="0.000000018"/>');
    expect(xml).toContain('<motor name="spin" joint="spin" gear="3" ctrlrange="-0.0333333333 0.0333333333"/>');
    expect(xml).toContain('<motor name="slide" joint="slide" gear="1" ctrlrange="-50 50"/>');
    expect(xml).toContain('<body name="motor" pos="0 0 0">\n          <inertial');
    // the pose as a keyframe, in the order of the joints with a degree of freedom: radians and metres
    const posed = text(exportOf(engine, 'mjcf', {}, previewOf(engine, { type: 'setPose', values: { slide: 12, spin: 7.5 } })).files[0]);
    expect(posed).toContain('<key name="pose" qpos="0 0 0.012 7.5"/>');
    expect((exportOf(engine, 'urdf', {}, previewOf(engine, { type: 'setPose', values: { slide: 12 } })).files[0].about as RobotAbout).notWritten).toContain('the pose of the document (slide 12 mm): URDF has no place for it; the file is the model as modelled, the zero of every joint');
  });

  it('what a format does not write is said, one sentence each', () => {
    const urdf = (exportOf(engine, 'urdf').files[0].about as RobotAbout).notWritten;
    expect(urdf).toEqual([
      'joint "shoulder": rotorInertia and gearRatio: URDF has no place for the rotor or the gear of a drive (outside a transmission of ros_control); the MJCF writes the rotor as the armature of the joint and the gear in its motor',
      'joint "spin": rotorInertia and gearRatio: URDF has no place for the rotor or the gear of a drive (outside a transmission of ros_control); the MJCF writes the rotor as the armature of the joint and the gear in its motor',
      'the two links of a joint are not excluded from contact: URDF cannot say it, so a reader that collides convex hulls (MuJoCo) may find the parts of a joint in contact at rest; for MuJoCo use the MJCF',
    ]);
    expect((exportOf(engine, 'urdf', { collision: 'none' }).files[0].about as RobotAbout).notWritten).toHaveLength(2);
    // a continuous joint with one of effort and velocity: its limit is left out; a gear with neither an effort nor a rotor
    const half = previewOf(engine, { type: 'setJoint', id: 'spin', joint: { type: 'continuous', parent: 'slider', child: 'cap', axis: CAP, value: 0, effort: null, rotorInertia: null } });
    const halfUrdf = exportOf(engine, 'urdf', {}, half);
    expect(text(halfUrdf.files[0])).toContain('<joint name="spin" type="continuous">\n    <origin xyz="0.24 0 0" rpy="0 0 0"/>\n    <parent link="slider"/>\n    <child link="cap"/>\n    <axis xyz="0 0 1"/>\n  </joint>');
    expect((halfUrdf.files[0].about as RobotAbout).notWritten).toContain('joint "spin": velocity: the limit of a continuous joint needs both an effort and a velocity, so it is left out');
    expect((exportOf(engine, 'mjcf', {}, half).files[0].about as RobotAbout).notWritten).toContain('joint "spin": gearRatio: the gear lives in the motor and the armature, and the joint has neither an effort nor a rotor inertia');
    expect(text(exportOf(engine, 'mjcf', {}, half).files[0])).not.toContain('<motor name="spin"');
    // a coupled motion: two values over one parameter, written as free joints and named
    const coupled = previewOf(engine, { type: 'batch', commands: [{ type: 'setParameter', name: 'q', expr: '0.2' }, { type: 'setPose', values: { shoulder: 'q', elbow: '-2 * q' } }] });
    expect(exportOf(engine, 'mjcf', {}, coupled).files[0].about).toMatchObject({ coupled: ['shoulder', 'elbow'] });
  });

  it('a moving group needs a mass; an empty root and an empty child of a fixed joint do not', () => {
    // the root empty, the motor's link empty (the motor in no link): both written
    const empty = previewOf(engine, { type: 'batch', commands: [{ type: 'setLink', id: 'base', bodies: [] }, { type: 'setLink', id: 'motor', bodies: [] }] });
    const exported = exportOf(engine, 'urdf', {}, empty);
    // a link without mass states an inertial of zero (PyBullet would give it 1 kg otherwise: the review of 5b)
    expect(text(exported.files[0])).toContain('<link name="base">\n    <inertial>\n      <origin xyz="0 0 0" rpy="0 0 0"/>\n      <mass value="0"/>\n      <inertia ixx="0" ixy="0" ixz="0" iyy="0" iyz="0" izz="0"/>\n    </inertial>\n  </link>');
    expect(text(exported.files[0])).toContain('<link name="motor">\n    <inertial>');
    expect(exported.files[0].about).toMatchObject({ leftOut: { bodies: ['base', 'motor'] } });
    expect(text(exportOf(engine, 'mjcf', {}, empty).files[0])).toContain('<body name="base" pos="0 0 0">\n      <body name="upper"');
    // the upper arm without a body of its own but with the motor fixed to it: written
    expect(exportOf(engine, 'mjcf', {}, previewOf(engine, { type: 'setLink', id: 'upper', bodies: [] })).files.length).toBeGreaterThan(1);
    // without the motor as well, and with the cap's group empty: both named
    const massless = previewOf(engine, { type: 'batch', commands: [{ type: 'setLink', id: 'upper', bodies: [] }, { type: 'setLink', id: 'motor', bodies: [] }, { type: 'setLink', id: 'cap', bodies: [] }] });
    expect(refusalOf(engine, 'urdf', {}, massless).message).toBe(`urdf: ${ROBOT_REFUSALS.massless.text}upper, cap`);
  });
});

describe('the export of a robot: names, numbers and refusals', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = createEngine({ solver: await createPlanegcsSolver(), kernel: await createManifoldKernel() });
    discs(engine);
  });

  it('meshName: unreserved characters of a URI, every other byte as _ and two hex digits', () => {
    expect(meshName('screws/1')).toBe('screws_2F1.stl');
    expect(meshName('a_b')).toBe('a_5Fb.stl');
    expect(meshName('a.b-C9')).toBe('a.b-C9.stl');
    expect(meshName('loket ž')).toBe('loket_20_C5_BE.stl');
    expect(new Set(['a_b', 'a/b', 'a_2Fb', 'a b'].map(meshName)).size).toBe(4);
  });

  it('significant: nine digits of a scale, no exponent, never -0', () => {
    expect(significant(0.12)).toBe('0.12');
    expect(significant(2 / 5.18)).toBe('0.386100386');
    expect(significant(-2.3e-19, 1.9e-4)).toBe('0');
    expect(significant(-2.37793e-7, 1.9e-4)).toBe('-0.000000237793');
    expect(significant(1.8e-8)).toBe('0.000000018');
    expect(significant(123456789123)).toBe('123456789000');
    expect(significant(-0)).toBe('0');
    expect(significant(5, 0)).toBe('5');
    expect(() => significant(Number.NaN)).toThrow(/not finite/);
  });

  it('names that need escaping are written escaped; a name XML cannot hold is refused, an auxiliary body is not written', () => {
    const quoted = previewOf(engine, { type: 'batch', commands: [{ type: 'removeJoint', id: 'turn' }, { type: 'setJoint', id: 'loket "B" & spoj ž', joint: { type: 'revolute', parent: 'base', child: 'top', axis: Z, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2 } }] });
    expect(text(exportOf(engine, 'urdf', { name: 'a <b>' }, quoted).files[0])).toContain('<robot name="a &lt;b&gt;">');
    expect(text(exportOf(engine, 'urdf', {}, quoted).files[0])).toContain('<joint name="loket &quot;B&quot; &amp; spoj ž" type="revolute">');
    const control = previewOf(engine, { type: 'batch', commands: [{ type: 'removeJoint', id: 'turn' }, { type: 'setJoint', id: 'turn\u0001', joint: { type: 'fixed', parent: 'base', child: 'top' } }, { type: 'setLink', id: 'x\uD800', bodies: [] }] });
    expect(refusalOf(engine, 'mjcf', { root: 'base' }, control).message).toBe(`mjcf: ${ROBOT_REFUSALS.badName.text}"turn\\u0001"`);
    expect(refusalOf(engine, 'urdf', { root: 'x\uD800' }, control).message).toBe(`urdf: ${ROBOT_REFUSALS.badName.text}"\\ud800"`.replace('"\\ud800"', JSON.stringify('x\uD800')));
    // a body: refused when it is written, not when it is auxiliary (written nowhere)
    const odd = (use: 'part' | 'auxiliary'): EngineState =>
      previewOf(engine, {
        type: 'batch',
        commands: [
          { type: 'addFeature', feature: { id: 'odd\u0007', name: 'odd', suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 40, distance: 2 }, operation: 'new' } },
          { type: 'setBodyProperties', body: 'odd\u0007', patch: { use, density: 1 } },
          { type: 'setLink', id: 'top', bodies: ['high', 'odd\u0007'] },
        ],
      });
    expect(refusalOf(engine, 'urdf', {}, odd('part')).message).toBe(`urdf: ${ROBOT_REFUSALS.badName.text}"odd\\u0007"`);
    expect(exportOf(engine, 'urdf', {}, odd('auxiliary')).files[0].about).toMatchObject({ leftOut: { auxiliary: ['odd\u0007'] } });
  });

  it('the IDs of two mesh files that differ only in case are refused; a link named world is refused by MJCF only', () => {
    const disc = (id: string): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: 's', regions: [{ outerLoop: ['k'] }] }, extent: { type: 'distance', start: 40, distance: 2 }, operation: 'new' } });
    const clash = previewOf(engine, { type: 'batch', commands: [disc('Low'), { type: 'setBodyMaterial', body: 'Low', material: 'PLA' }, { type: 'setLink', id: 'top', bodies: ['high', 'Low'] }] });
    expect(refusalOf(engine, 'urdf', {}, clash).message).toBe(`urdf: ${ROBOT_REFUSALS.caseClash.text}low.stl and Low.stl`);
    const world = previewOf(engine, { type: 'batch', commands: [{ type: 'removeJoint', id: 'turn' }, { type: 'removeLink', id: 'top' }, { type: 'setLink', id: 'world', bodies: ['high'] }, { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'world', axis: Z, lower: -1, upper: 1, value: 0, effort: 500, velocity: 2 } }] });
    expect(refusalOf(engine, 'mjcf', {}, world)).toEqual({ code: 'failed', message: `mjcf: ${ROBOT_REFUSALS.mjcfWorld.text}` });
    expect(text(exportOf(engine, 'urdf', {}, world).files[0])).toContain('<link name="world">');
  });

  it('limits a nanoradian apart are written equal: refused by MJCF, written by URDF', () => {
    const close = previewOf(engine, { type: 'setJoint', id: 'turn', joint: { type: 'revolute', parent: 'base', child: 'top', axis: Z, lower: 0.5, upper: 0.5 + 1e-10, value: 0.5 } });
    expect(refusalOf(engine, 'mjcf', {}, close).message).toBe(`mjcf: ${ROBOT_REFUSALS.mjcfLocked.text}turn`);
    expect(text(exportOf(engine, 'urdf', {}, close).files[0])).toContain('<limit lower="0.5" upper="0.5" effort="0.5" velocity="2"/>');
    // a prismatic joint a nanometre apart
    const slide = previewOf(engine, { type: 'setJoint', id: 'turn', joint: { type: 'prismatic', parent: 'base', child: 'top', axis: Z, lower: 0, upper: 1e-7, value: 0 } });
    expect(refusalOf(engine, 'mjcf', {}, slide).message).toBe(`mjcf: ${ROBOT_REFUSALS.mjcfLocked.text}turn`);
  });

  it('an option that is not one is refused before anything is computed', () => {
    expect(refusalOf(engine, 'mjcf', { collision: 'hull' })).toMatchObject({ code: 'invalidArguments', arg: ['collision'] });
    expect(refusalOf(engine, 'urdf', { meshprefix: 'x' })).toMatchObject({ code: 'invalidArguments', arg: ['meshprefix'] });
  });
});
