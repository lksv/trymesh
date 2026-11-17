# 5b Export of URDF and MJCF, and a picture of a state that is not written (D59)

**State: designed on 2026-11-17, third version, after two rounds of reviews ("Reviews").** Step 5 of [D36](../../decisions/D36-order-after-d35.md), track H of [the plan](../README.md). Written against the code of `master` at `d080fa8` (the mechanism of 5a, the mass query of 1d, the body properties of 3a, the export catalog and the helpers of 2g with the compressed ZIP of its addition, the operation `view_image` of 1f are all in the code). The writers were prototyped in the session scratchpad and their files read back by independent readers; the numbers are under "Measured". Nothing under `packages/` was changed.

Files: [contract.ts](contract.ts) (the drive of a joint, the two formats with every value of a file beside its source, the common part, the path of an operation with `at` and `after`), [calls.ts](calls.ts) (its part of validation scenario 13, with the common part written out against the real context of an export).

The package has two parts that share nothing but the package: the robot description (the main part), and `at` and `after` for the operations of the app, which the owner put here on 2026-11-16 (5a, "Open") because a pose is where a picture of a state that is not written is most wanted.

## What the backlog says, checked against the code

[backlog.md](../../backlog.md), "Export for simulation: URDF, MJCF, USD": URDF and MJCF as an export, because the data such a file needs lives here (geometry, mass properties, joint axes). USD is not proposed. A link has a visual mesh, a collision mesh, a mass, a centre of mass and an inertia tensor; a joint a kind, a parent, a child, an axis and limits. Units: millimetres in the engine, metres and kilograms in the files. Frames: a child link frame sits at a point of its joint axis with the orientation of the model, so meshes are only translated. One binary STL per link, the output several files. Collision: the visual mesh, or a convex hull (MuJoCo takes the hull itself). MJCF can carry a reflected rotor inertia and a gear ratio. Closed loops are out. The inertia assumes uniform density. "Cheaper first step": the AI writes the URDF from the numbers of the queries; the exporter makes frames and inertia transforms deterministic.

[5a](../5a-mechanism/design.md), "What the export of 5b will need": one root, refused otherwise; a joint in error and a link with a missing body refused; bodies in no link left out; the frame of a link at `axis.origin` of its joint, at the frame of its parent for the child of a fixed joint, at the origin of the model for the root; the mass query over the bodies of a link as modelled; reference bodies with their stated mass, auxiliary bodies left out; effort and velocity, rotor inertia and gear ratio as optional fields of a joint, checked against the formats here.

| Statement | What the code and the specifications say |
|---|---|
| "The data such a file needs lives in this tool" | `evaluation.mechanism` has per link the bodies the state has (`LinkResult.bodies`, `missing`) and per joint its numbers and its axis as modelled (`JointResult.axis.origin`, `direction`, a unit vector); `QUERIES.mass.run` gives the mass, the centre of mass and the tensor about it in the axes of the model, with the convention of the off-diagonal element both formats use ([1d](../1d-mass/design.md); checked below against MuJoCo's own integration). An export's context is always the model as modelled (`runExport` passes `'modelled'` to `queryContext`) |
| A joint "has limits" | URDF requires `<limit>` with `effort` and `velocity` for a revolute and a prismatic joint: `urdfdom` (`parseJointLimits`) fails on a limit without either, and on a revolute or prismatic joint without a limit. The document has neither number |
| "One binary STL per link" | Per body (below): the colour, the name and MuJoCo's hull are per body |
| "The output is several files: a folder through MCP, an archive in the app" | `Exported` has the layout `directory`; the tool `export` writes a set into a folder with the guarantees of `export_stl` (`export-writer.ts`), but refuses a path with a folder in it ("this server cannot write an export with folders yet", `server.ts`); the app saves a set as one ZIP (`panels/export.ts`, `zip`). So a set whose files all sit in one folder needs no change of the writer |
| "MJCF can carry reflected rotor inertia and a gear ratio" | `joint/@armature` is the reflected inertia, "the inertia of the spinning body multiplied by the square of the gear ratio" [MJCF body-joint-armature]; `motor/@gear` scales the force and the length of an actuator [MJCF actuator-general-gear] |
| "MuJoCo takes the convex hull of a mesh by itself" | "collision detection works with the convex hull of the mesh" [MJCF asset-mesh]. Measured below: what it means for parts that sit inside each other |
| A picture of a pose (5a, 1f) | `HOST_OPERATIONS` (`host.ts`): `callHostOperation(host, name, args)` checks the arguments in the state of the document now and calls `run(host, args)`; `view_image` takes `at` as an argument of its own (`VIEW_IMAGE_ARGS.at`) and draws `engine.getState(args.at)`; nothing takes a command. The picture already draws the pose of the state it is given (`pictureModel` in `packages/app/src/picture.ts`, `poseOf(request.state.evaluation.mechanism)`), so a previewed state is drawn posed with no change in the app |

## The cheap variant

**Two export formats, `urdf` and `mjcf`,** entries of `EXPORT_FORMATS`, over one common part (`export/robot.ts`). Each writes a set of files into one folder: the description (`robot.urdf` or `robot.xml`) and a binary STL per body, in metres in the frame of its link. Both describe the mechanism as modelled: one tree of links from one root, the frame of a link at the axis of the joint that moves it with the axes of the model, the mass, the centre of mass and the full inertia tensor of each link from the query `mass`, a visual and a collision mesh per body, and per joint its kind, axis and limits. MJCF also gets a motor per joint that states an effort, the reflected rotor inertia as the armature of the joint, the pairs of a joint excluded from contact, and the pose of the document as a keyframe.

**The drive of a joint**: four optional numeric fields of a joint in the document, `effort` and `velocity`, and for a turning joint `rotorInertia` and `gearRatio`. They take expressions, are read by nothing but the export, and a fault in one of them blocks no pose.

**`at` and `after` for every operation of the app**, on its path as the tool `query` has them: the path asks the state (a preview of `after`, or the state after `at`), checks the arguments in that state, and hands it to the operation. `view_image` loses its own `at` and draws the state it is given, which is posed when the state holds a pose; its answer names the pose.

**Nothing else of the document changes**: no command, no query, no feature type, no face role, no issue code. No upgrade step (below). No library: the XML is written as text with the helpers of 2g, the meshes with `toStl`.

**Deferred** (none of them needs a change of what is saved now):

- A subfolder for the meshes (`meshes/`): it needs the writer of the server to make folders, the work the preparatory step assigned to the first format with folders (`00-prep/contract.ts`, `ExportToolInput`). No reader measured needs it.
- One mesh for a body and its unchanged copies (3e's `shapeOrigin`); a convex hull per body as the collision mesh (`hull` of Manifold, an addition to the kernel port); primitives fitted to a mesh.
- A coupled motion written as a coupling (URDF `mimic`, an MJCF equality of two joints): the document has two expressions over one parameter, and writing a coupling needs them read as a linear function of one another.
- A floating root (an MJCF `freejoint`), a `world` link with a fixed joint in URDF, a ground plane.
- Damping and friction of a joint (URDF `dynamics`, MJCF `damping`, `frictionloss`); the rotor of a prismatic drive (a mass through a lead); transmissions of `ros_control`; sensors, cameras, controllers.
- Names for people (`Link.name`) in the files: the IDs are written, which are unique and stable.
- A picture of several poses in one call; `at` and `after` for an operation that changes the document (there is none).

## Sources

No detail of a format is taken from memory. Every one was read on 2026-11-17 in these documents; `contract.ts` names the place beside the value.

| Document | Read for |
|---|---|
| URDF XML specification, ROS wiki: `wiki.ros.org/urdf/XML/link`, `/joint`, `/robot` (the raw pages) | the elements and attributes, which are required, the units, that the joint stands at the origin of the child link and its axis is in the joint frame, the inertia "about Co … for the unit vectors Ĉx, Ĉy, Ĉz" with the "negative product of inertia convention", meshes by `filename` with `package://` |
| `urdfdom`, the C++ parser of ROS (`github.com/ros/urdfdom`, `urdf_parser/src/joint.cpp`, `link.cpp`, `model.cpp`, `master`) | what is refused, which the wiki words loosely: a limit without `effort` or `velocity`, a revolute or prismatic joint without a limit, a link or joint name twice, a material name twice at the top level |
| MuJoCo XML Reference, `doc/XMLreference.rst` of `github.com/google-deepmind/mujoco` (`main`, after 4.0.1), with `doc/modeling.rst` (force limits), `doc/computation/index.rst` (the filtering of contacts) and `doc/changelog.rst` | `compiler` (`angle` defaults to degrees, `autolimits`, `inertiafromgeom`, `meshdir`), `body`, `body/inertial` (`fullinertia` order M11 M22 M33 M12 M13 M23, positive definite), `body/joint` (`hinge`, `slide`, `pos`, `axis`, `range`, `ref`, `armature`), `body/geom` (`mesh`, `rgba`, `contype`, `conaffinity`), `asset/mesh` (STL, the compiler centres the mesh and keeps the offset, triangles under 1e-14 refused, collision by the convex hull), `contact/exclude`, `actuator/motor` with `gear` and `ctrlrange`, `keyframe/key/@qpos`, the reserved body name `world` |
| RFC 3986, section 2.3 | the unreserved characters of a URI, for the names of the mesh files |
| 2g's sources (XML 1.0 for `xmlText`) | as in [2g](../2g-export/design.md) |

## The common part

`robotTree(context, options)` in `export/robot.ts` (`contract.ts`, written out in `calls.ts`) turns the mechanism of the state into what both writers need. The context is that of an export: the model as modelled, whatever pose the document holds.

**The tree.** A document without a link is `empty` (below); the format checks it before it calls `robotTree`. The root is `options.root`, or the one root of `evaluation.mechanism.roots`. Several roots without `root` are refused at `['root']` with the list; `root` that names no link is `notAvailable`, one that names a joint's child is refused. From the root the tree is walked depth first, the children of a link in the order of the joints of the section. The links of other roots are left out and named in `about`. A joint in error anywhere in the tree is refused, with its message: where its child stands is not known (5a). That includes a joint at zero whose only fault is its axis, which D49 lets a query read: an export writes the axis. A joint with a drive field in `driveErrors` is refused by both formats, whichever fields a format writes: the stored number is stale, and leaving the field out would turn a broken effort into an effort not stated (an MJCF without its motor).

**The frame of a link** has the axes of the model; its origin is where 5a put it: the origin of the axis of the joint that moves it (the sketch point, or the origin of the model for a base axis), the origin of its parent for the child of a fixed joint, the origin of the model for the root. So a joint stands at the origin of its child, as URDF defines it, the offset of a joint is the difference of the two origins, and no rotation is written anywhere: a mesh is moved and never turned, and the tensor is in the axes it was computed in. A prismatic joint along a base axis has its child's frame at the origin of the model, away from its bodies; that is correct and only looks odd.

**The bodies of a link** are `LinkResult.bodies` in their order, without the auxiliary ones (3a: no physical thing, no mass). A link whose `missing` is not empty is refused: it would be written lighter than it is (5a). Bodies in no link are left out and named.

**The mass of a link** is `run` of the query `mass` over its bodies as one piece, in the context of the export: the mass in grams, the centre of mass and the tensor about it in g·mm² in the axes of the model. A reference body counts with the mass of its properties, spread evenly over its volume; a body without a density or a mass fails the query, and the export passes the text on with the link. A link without such a body has no mass. **A link that a revolute, continuous or prismatic joint moves has to carry a mass with the links welded to it** (itself and the links that hang on it through fixed joints only): MuJoCo checks a moving body together with the bodies welded to it, and refuses "mass and inertia of moving bodies must be larger than mjMINVAL" when that group has none (measured: an empty hinge body with a fixed child of 0.1 kg compiles, an empty hinge body whose child is on another hinge does not); a simulator that reads URDF merges fixed links the same way (Gazebo). So a link that is only the frame of a joint, with its plate and its motor on fixed children, is written; a moving group without any mass is refused, by both formats. The root and the child of a fixed joint may be empty (measured: MuJoCo compiles both).

**The meshes.** One binary STL per body (`toStl`), the positions minus the origin of the link over 1000, rounded to float32: metres in the frame of the link, the convention MuJoCo's reference describes for meshes of a robot ("we set the body frame at the joint, so that the joint position is (0,0,0) in the body frame, and simply reference the mesh"). The file name is `meshName(body)`: the body ID with every byte outside A–Z, a–z, 0–9, `.` and `-` written as `_` and two hexadecimal digits (`screws/1` → `screws_2F1.stl`). Different IDs give different names (over the IDs the export accepts, below), and every character is unreserved in a URI (RFC 3986, 2.3): a reader that takes `filename` as a URI, as ROS does with `package://`, would decode the `%2F` of `bodyFileName` into a slash. The names keep the case of letters, so `Base` and `base` give two files that one folder on macOS or Windows cannot hold: the export refuses two mesh names that differ only in the case of letters (the writer of the server would refuse the set anyway, and the ZIP of the app would unpack one over the other). The same mesh files serve both formats.

**Names.** Links, joints and bodies are named by their IDs, which are unique within their kind and hold no slash (a body ID may: `screws/1` is a valid name in both formats, measured). `newId` accepts any text without a slash, so an ID may hold a control character or half of a surrogate pair, which XML cannot hold: `xmlText` writes a tab as a space and drops the others, so `world\u0001` would be written `world` and `\u0001` as nothing, and UTF-8 turns a lone surrogate into U+FFFD, which breaks the uniqueness of `meshName`. The export therefore refuses a written ID (of a link, a joint, or a body that is not auxiliary: an auxiliary body is written nowhere) that `xmlText` changes in any way other than its four entities, naming it; every check (the same name twice, `world`) is then on IDs that are written as they are. MJCF reserves the body name `world` ("repeated name 'world' in body", measured), so a link with that ID is refused by `mjcf`, with what to do.

**`about`** of the description file says what was written and what was not (`RobotAbout`): the root, the links and joints in order, the mass of everything written, the bodies left out (in no link, auxiliary, in another tree), the joints whose value follows an expression (a coupled motion through a parameter is written as free joints), and one sentence for each thing the document says and the format does not write, by joint and field: URDF the rotor and the gear of a joint, a continuous joint that states only one of `effort` and `velocity` (its `<limit>` needs both and is left out), the pose of the document, and with collisions on that the pairs of a joint cannot be excluded from contact in URDF (a reader that collides them, as MuJoCo's import does, finds a pin inside the hull of its hole: `base`–`upper` of the arm is in contact at rest there, measured); MJCF the `velocity` of a joint (a motor clamps its control, not the speed of the joint; a velocity servo would be another actuator) and the gear of a joint that has neither an effort nor a rotor (the gear lives in the motor and the armature only). This is the note about an export as a whole (need 17 of [cross-review.md](../cross-review.md)); `Exported` does not change. A mesh file says its body, its triangles and its link.

**`empty`** when the document has no link: the tool refuses with the text (`NO_MECHANISM`).

## URDF

The whole shape is in `contract.ts`. What decides it:

- **No rotation is written**: every `rpy` is `0 0 0`, because every frame has the axes of the model. The inertial frame is translated to the centre of mass and the six numbers are the elements of the tensor of 1d: `ixy` is the element in row x, column y, minus the product of inertia, which is what "URDF assumes a negative product of inertia convention" means; checked against two readers and against MuJoCo's own integration of the meshes ("Measured").
- **A material per colour** of a written body, at the top level, named by the colour (`#rrggbb`), referred to by the visuals of its bodies: `urdfdom` refuses a top-level material name twice, and a material inside each visual would repeat the colour. A body without a colour gets no material.
- **A visual and a collision per body**, both the mesh of the body, named by the body ID; `collision: 'none'` leaves the collisions out.
- **The limits.** A revolute and a prismatic joint get `<limit lower upper effort velocity/>`; a joint without both an effort and a velocity is refused, with every such joint named at once, because `urdfdom` refuses the file (`urdf_parser_py` and `yourdfpy` as well, measured; MuJoCo's importer does not). A made-up number is not written instead: a number in a file is a claim about the part, as 2g refused to invent a colour. A continuous joint gets `<limit effort velocity/>` when it states both, and no limit otherwise.
- **`meshPrefix`** is put before every file name: without it the name alone, relative to the URDF, which MuJoCo and `yourdfpy` resolve; for ROS `package://<package>/<folder>/`. MuJoCo does not resolve `package://` (measured), so one URDF does not serve both; the option says so.
- **The root is not fixed to anything.** URDF has no world; whether the root is fixed or floating is the simulator's choice (`useFixedBase` and its like). Writing a `world` link is deferred.
- **Not written**, and said in `about.notWritten`: the rotor inertia and the gear ratio (URDF has no place for them outside a transmission of `ros_control`), the pose of the document.

## MJCF

- **`<compiler angle="radian" autolimits="true"/>`**: the default unit of an angle in MJCF is the degree [MJCF compiler-angle]; `autolimits` makes a `range` enable the limit and a `ctrlrange` the clamp, which is the default of the current reference and is written so that an older build does the same.
- **The tree is nested bodies**, each at the offset of its frame from its parent's; the root is a child of `worldbody` at its origin, with no joint, so it is welded to the world: an arm on a table. A revolute and a continuous joint are a `hinge`, a prismatic one a `slide`, both at `pos="0 0 0"` with the axis as modelled; a fixed joint is no element (a body without a joint is welded to its parent). `ref` is left at 0: the model as modelled is the zero of every joint, as in D49.
- **`inertial`** with `pos`, `mass` and `fullinertia` in the order M11 M22 M33 M12 M13 M23, no orientation (the compiler finds the principal axes itself). `inertiafromgeom` stays `auto`: every body with geoms has an inertial, and an empty root or an empty child of a fixed joint has neither (measured: both compile).
- **A geom per body**, type `mesh`, its colour as `rgba`. With `collision: 'none'`, `contype="0" conaffinity="0"`.
- **The two links of a joint are excluded from contact** (`<contact><exclude>` per joint). MuJoCo filters a parent and its child "unless the parent is the world body", and bodies welded together count as one [MJCF computation, "Filtering", 3]; the root is welded to the world. And it collides convex hulls: the pin of `base` in the hole of `upper` is inside the hull of the plate, and was a contact at every pose until the pair was excluded (measured). Further down the tree the filter of MuJoCo already covers the pair; the exclusion is written for every joint all the same, so the file says it and does not depend on a flag (`filterparent`).
- **Limits that MuJoCo can hold.** With `autolimits`, MuJoCo enables a limit only when `range[0] < range[1]`, and `limited="true"` with equal bounds is a compile error (measured: "range[0] should be smaller than range[1]"). D49 allows `lower` equal to `upper` (a joint locked at one value), and two bounds closer than a nanoradian or a nanometre are written equal by nine decimals. `mjcf` refuses such a joint, naming it. The text says what holds: a fixed joint holds its child as modelled, so it stands for a joint locked at 0 only; a joint locked at another value has to be modelled there, or exported as URDF. URDF writes it as it is (`urdfdom` takes equal limits). (Writing it as a hinge without a range and an equality of MJCF at the value was considered: the body would start at 0 and be pulled to the value by a soft constraint.)
- **A motor per joint that states an effort**: `<motor joint gear ctrlrange/>` with `gear` the gear ratio (1 when it is not stated) and `ctrlrange` ±effort/gear, so the control is the torque of the motor and the joint gets at most `effort` [MJCF CForceRange: clamping the control of a motor clamps its force]. A position servo would need a gain, which is a controller and belongs to the simulation.
- **The armature** of a turning joint with a rotor is `rotorInertia · gearRatio²` in kg·m², the reflected inertia of the reference. The actuator has an `armature` of its own since MuJoCo 3.7.0 (changelog), scaled by the gear itself; the joint's is read by every version and is the one written. MuJoCo's changelog adds that "models with light links and no armature may need joint armature or a smaller timestep": measured below.
- **The pose of the document** is the keyframe `pose` (`qpos` in the order of the joints of the tree that have a degree of freedom, radians and metres) when a value is not 0. The bodies are still written as modelled.
- **The mesh assets** are named by the body ID, the files by `meshName`; no `meshdir` (the meshes are beside the description).

## Numbers

`export/text.ts` gets `significant(value, scale)`, beside `decimals` and `plain` of 2g. No exponent, never "-0", in either file:

- lengths in metres and angles in radians: nine decimals (`plain`), a nanometre;
- a mass, an effort, a velocity, an armature, a gear: nine significant digits;
- the six numbers of a tensor: nine significant digits of its largest diagonal element, so the noise of a product that is zero by symmetry (−2.3e−19 kg·m² against 1.9e−4) is written 0, and a real product keeps its digits (`ixz="-0.000000237793"` on the forearm);
- a colour channel: over 255, six decimals.

Every conversion is a division by a power of ten (mm to m by 1000, g·mm² to kg·m² by 10⁹, N·mm to N·m by 1000), so a round number of the model stays round in the file (`0.12`, not `0.12000000000000001`). Measured: the rounding costs at most 2.6e−9 of a mass and 2.8e−9 of a tensor, relative.

## The drive of a joint

The document has no effort and no velocity, and URDF cannot be written without them. Four optional numeric fields of a joint (`JointAfter5b` in `contract.ts`):

| Field | Kinds | Unit | Range |
|---|---|---|---|
| `effort` | revolute, continuous; prismatic | N·mm; N | above 0 |
| `velocity` | revolute, continuous; prismatic | rad/s; mm/s | above 0 |
| `rotorInertia` | revolute, continuous | g·mm² (the unit of the query `mass`) | at least 0 |
| `gearRatio` | revolute, continuous | none: turns of the motor per turn of the joint | above 0; 1 when not stated |

- **Millimetres and newtons** keep the units of the engine: a torque is N·mm, so a servo of 11 kg·cm is `1078`. The file gets N·m.
- **Numeric fields by the rule of a section** (D48): a number or an expression in a command, the last valid number in the document, the expression in `expressions` of the joint, renamed with a parameter. A field of another kind is refused as today (`onlyFields`).
- **`setJoint` keeps the drive it is not given.** It replaces a joint whole, as today, for what D49 has (the kind, the links, the axis, the three numbers of the pose), and every one of those is required, so leaving one out is refused. The drive is optional, and an AI that sends a joint again to widen its limits (as scenario 13 does) would erase it without a word, which the URDF export finds out much later and the MJCF never (its motor and armature are gone). So a drive field the command does not name is kept from the joint of the same kind it replaces, `null` removes it, and a joint of another kind starts without a drive. That is the rule of a patch for these four fields only, and it amends D49 as written ("a merging patch like that of `updateFeature` is not worth its rules", [5a](../5a-mechanism/design.md), "Commands"). The command's joint is therefore no longer `Input<Joint>` (which never gives `null`) but a joint input of its own (`InputJointAfter5b`: the drive fields also take `null`), and the batch of the command type carries it too. The texts that say "the whole joint" change with it: the comment of `setJoint` in `types.ts` (which `describe_api` prints), `docs/architecture/api.md`, `docs/architecture/document.md` ("Commands") and `docs/ui/mechanism.md`.
- **The form of a joint in the app** shows the four fields of the kind, each optional, each in its own unit (N·mm or N, rad/s or mm/s, g·mm², none) rather than the one unit of the kind the form has today; an emptied drive field of a joint being edited is sent as `null`, since a field left out is kept.
- **An expression sent back unchanged is kept.** `setJoint` keeps without evaluating a string equal to the expression a field already has (`sections/mechanism.ts`, the loop over `JOINT_FIELDS[type]`); the loop runs over the drive fields as well, so a joint whose effort lost its parameter can still be sent back whole, by the form of the app, to change its limits.
- **They live beside `JOINT_FIELDS`**, in `JOINT_DRIVE_FIELDS`. `JOINT_FIELDS` stays the fields of the pose, which `setPose`, the limits and the slider of the app read; the validator of a joint allows both lists and requires only the first. `EntryField` gets `optional?: true`.
- **A fault of a drive field blocks nothing.** D49 puts a joint in error when a numeric field does not evaluate, and a joint in error has no motion and blocks the bodies beyond it. A broken expression of an effort says nothing about where a link stands, so the drive is resolved apart: `JointResult.drive` holds the numbers, `JointResult.driveErrors` the fields that do not evaluate (each an `ExpressionError`, as in `fieldErrors`; no `Issue`, so no issue code), and `status`, `error` and `fieldErrors` stay what D49 defines (the comment of `JointResult` in `types.ts`, "invalidExpression: a numeric field has an expression in error", becomes "a numeric field of the pose"). The export refuses a joint with a `driveErrors` it would write (the stored number is stale); `get_model` lists them as `jointDriveErrors` beside `jointErrors`.
- **A prismatic joint has no rotor.** What a rotor reflects through a screw or a belt is a mass and needs the lead; deferred.
- The recompute resolves the fields with the parameters (`resolveEntryFields` of 3a) and **writes the numbers back** with those of the pose (`writtenEntry` over both lists in `evaluate` of `sections/mechanism.ts`, which today writes the values of `JOINT_FIELDS` only), so the stored effort follows its parameter as every numeric field does (D48); a field in `driveErrors` keeps its last valid number. Nothing else reads them: a change of an effort recomputes no geometry and moves nothing.

**No upgrade step.** The entries of the section are strict: the validator of a joint (`joint()` in `sections/mechanism.ts`) lists the fields a joint of each kind allows (`onlyFields` in `sections/mechanism.ts`), and a load checks the section whole. A build without this package refuses a document whose joint has a drive ("has no such field") instead of dropping it, which is the case [api.md](../../architecture/api.md), "When a step is needed", exempts: "a field where the validator lists the fields it allows". `SCHEMA_PENDING` is not touched; a document without a drive is the same in both builds.

## A picture of a state that is not written

The open need of [1f](../1f-image/design.md) ("The state an operation works on"), decided by the owner to come with this package.

- **On the path, not in an operation's arguments.** `callHostOperation` takes `at` and `after` out of the arguments of every operation, as the tool `query` takes them beside its `args`: with `after` it previews the command where the engine is (in the app; nothing is written) with `at`, and the preview answers for `at` (`after` may add the feature `at` names, as `askedState` of the tool `query` allows); an `after` that does not apply is answered `after: <its error>`. Without `after` it takes the state after `at`, and an `at` that names no feature of the document is `notAvailable` at `at` before the engine is asked (`getState` throws for it).
- **The arguments are checked in that state** (`checkArgs` with its document and evaluation), not in the state of the document now. So a body only an earlier state had can be named with `at` (a known limit of 1f goes), and a body a previewed command adds can be named with `after`. The operation gets the state: `run(host, args, state)`.
- **`view_image`** loses `VIEW_IMAGE_ARGS.at`; `imageRequest(host, args, state, budget?)` takes the state it is handed (the budget of the section stays its last, optional parameter, which the tests of 1f use), looks the bodies up in it as today and asks the section of a picture with `{ state }`. `pictureModel` already draws the pose of the mechanism of the state, so `after: { type: 'setPose', … }` draws the pose with no change in the app.
- **The answer names the pose** (`about.pose`, the joints that move the model with their values, as `poseNote` gives the tools `query` and `get_body`), and the joints that have no motion (`about.blocked`: the joint and the drawn bodies beyond it). Without a section, the view of the app draws a blocked link with the joint standing at zero and marks it, and a picture does the same and says so, rather than refusing a picture.
- **With a section a blocked body is refused.** The section is a query, posed, and the context of a query throws for a body whose pose is not known (`query/pose.ts`; measured by the review: `at: 'elbowPin'` with the elbow written at 1.2 draws without a section and fails with one). A cut drawn from another pose than the body would be wrong. The text of that refusal is the operation's own: the joints that block, and the ways out for a picture: the bodies without the blocked ones, and a pose at zero only where the text of a blocked body offers it today (`blockedText`: each blocking joint at fault for its axis alone and its limits allowing zero), as a batch with the caller's own `after` when one was given (the query's text names `geometry: 'modelled'`, which an operation does not take).
- **The server** lists `at` and `after` in the input schema of every operation (`operationTools` in `server.ts`, which builds it from the description today) and `describe_api` beside the arguments of every operation. A caller that sends `at` today sends it the same way.
- **The tests** that change: the tables of `packages/mcp/test/host-operations.test.ts` lose `at` of `view_image`; `packages/mcp/test/view-image.test.ts` calls `imageRequest(host, { at, … })` and gets the state as the third argument. The bridge needs nothing (it passes the arguments as they are).

Rejected: `after` as an argument of `view_image` alone. There is no kind of argument for a command, and the next operation would repeat it.

## Measured

The prototype (2026-11-17) is about 230 lines of TypeScript in the session scratchpad: `robotOf` (the common part over the public engine: the mechanism of `getState`, `query('mass', …, { geometry: 'modelled' })`, the moved meshes through `toStl`) and the two writers, with the drive as a table beside the document. It ran by Vitest against the sources of the worktree with the real adapters. The files were read by three programs that share no code with it, installed into a Python 3.12 environment in the scratchpad for this measurement only (`uv`); none of them is a dependency of the project, and none is proposed as one: MuJoCo 4.0.1 (`mujoco` from PyPI), which reads MJCF and imports URDF with a parser of its own; `urdf_parser_py` 0.0.4, the Python parser of ROS; `yourdfpy` 0.0.60 with `trimesh` 5.2.1, which loads the meshes and computes forward kinematics. PyBullet does not install on Python 3.12 for arm64 (no wheel; its build failed); ROS itself was not available.

**The models.**

- *The arm of scenario 13* as `calls.ts` builds it: `arm()`, the materials and reference parts of 3a, the links and joints of 5a, the drives of `calls.ts` (8 bodies, 3 links, 2 revolute joints).
- *The arm extended*, to cover every kind of joint and a tensor with products: the motor as a link of its own on a fixed joint, a tool off the axis on the forearm, a slider on a prismatic joint along the base axis X, a cap on a continuous joint about a point of `layout` (11 bodies, 6 links; 4,220 triangles).
- *The joint of scenario 9* with every body a link on a revolute joint about Z, and a disc 0.4 mm thick, 50 mm in radius, half a metre from the origin (10 links; 17,774 triangles).

**What was compared.** MuJoCo's compiled model against the engine: the mass, the centre of mass (`body_ipos`) and the tensor (`body_inertia` turned back by `body_iquat`) of every body; forward kinematics at three poses (each joint at a value inside its range, the extreme ones included) against the transforms of `evaluation.mechanism.links` of `preview(setPose)`: the origin of the frame of each link moved by its transform, and the rotation. The same for MuJoCo's import of the URDF (with `fusestatic` off, so that a fixed child stays a body of its own to compare). `urdf_parser_py`'s inertials, names, types, axes and limits. `yourdfpy`'s meshes (found and loaded through the file names, the volume of each against `BodyResult.volume`) and its forward kinematics at the three poses.

| Check | Arm (scenario) | Arm extended | Joint of scenario 9 |
|---|---|---|---|
| MJCF compiles in MuJoCo | yes | yes | yes |
| Mass, relative | 2.6e−9 | 2.1e−9 | 2.4e−9 |
| Centre of mass | 3.2e−10 m | 2.8e−10 m | 4.7e−10 m |
| Tensor, relative to its largest diagonal element | 2.3e−9 | 2.3e−9 | 2.8e−9 |
| Forward kinematics, MuJoCo (position; rotation element) | 1.4e−17 m; 2.2e−16 | 8.3e−17 m; 3.3e−16 | (no pose) |
| URDF in MuJoCo: mass, tensor; kinematics | as MJCF | as MJCF | as MJCF |
| `urdf_parser_py`: inertials, against the engine | 2.6e−9 | 2.3e−9 | 2.8e−9 |
| `yourdfpy`: meshes found, volume; kinematics | 8 of 8, 4.2e−7; exact | 11 of 11, 4.2e−7; 5.6e−17 m | 9 of 9, 5.6e−6 |
| MuJoCo's own integration of the meshes (`inertiafromgeom="true"`, `inertia="exact"`, the densities and the stated masses on the geoms) against the engine | | mass 2.3e−7, centre 5.5e−10 m, tensor 4.3e−7 | mass 5.6e−6, tensor 5.6e−6 |

- **The off-diagonal convention holds.** The forearm with its tool has products of inertia of 0.5 % of its diagonal (`ixy` −9.8e−7, `ixz` −6.7e−7, `iyz` −5.3e−7 kg·m²); MuJoCo's own integration of the same meshes agrees with the tensor of 1d to 4.3e−7 of the diagonal, so a wrong sign (an error of 1 %) would show 20,000 times over. MuJoCo reads `ixy` of the URDF as M12 of `fullinertia`, the same number.
- **The volume of MuJoCo** differs from the engine's by up to 5.6e−6 on the joint: the STL is float32 metres of float32 millimetres, rounded once more. The tensor of the file is the engine's, not MuJoCo's.
- **Names and files.** A mesh file `screws%2F1.stl` (the name of `bodyFileName`) was found by MuJoCo and by `yourdfpy`; it is not used, for the reason under "The meshes". A joint and a link named `loket "B" & spoj ž` were read back as written by all three. A body named `world` is refused by MuJoCo; a link `world` is accepted by the three URDF readers. A joint may share its name with a body, a mesh with a geom: MuJoCo keeps a name space per kind.
- **What a reader refuses.** A revolute joint without `effort` and `velocity`: `urdf_parser_py` ("Required attribute not set in XML: effort"), `yourdfpy` (`validate` false); MuJoCo imports it. A moving body without mass: MuJoCo ("mass and inertia of moving bodies must be larger than mjMINVAL"); an empty root and an empty child of a fixed joint compile. Meshes in a folder by `meshdir` and by a relative path in URDF: all three. `package://` in URDF: `urdf_parser_py` and `yourdfpy` read the file, MuJoCo cannot open the mesh.
- **Triangles.** MuJoCo refuses a mesh with a triangle under 1e−14 m². The smallest triangle of the three models is 5.3e−9 m² (the housing of the joint), 5·10⁵ times above; nothing guards it.
- **Contact at rest.** The arm with every collision mesh: the pair `base`–`upper` was in contact at the zero pose and at every pose (the pin of the base inside the hull of the upper plate; MuJoCo does not filter the child of a body welded to the world), and nothing else; with the pairs of the joints excluded, no contact at any pose. The joint of scenario 9, every part a link of the root, its pairs excluded: 15 of its 36 pairs in contact at rest, all of them parts inside the housing or around the sun, through the convex hulls. Hence `collision: 'none'`.
- **A simulation.** The extended arm stepped 2 s at MuJoCo's default time step (2 ms): at rest under gravity (the axes are vertical) nothing moves; with the shoulder and the elbow driven at half their control range the two joints run into their limits and stay there, within the softness of MuJoCo's limits (1.5774 against 1.5708 rad). With every motor at half its range, the 0.21 g cap driven by 0.05 N·m on its continuous joint without armature spun to 10⁶ rad within 0.2 s and took the arm out of its limits (the slide 0.19 m outside a range of 0.02 m): the drive of a light link is stiff, which is what MuJoCo's changelog says of "light links and no armature". Nothing of the export is wrong there; a rotor inertia of the drive is the remedy, and `about` cannot know it is missing.
- **MuJoCo's import of a URDF** names a geom by the name of the collision; with `discardvisual` off it warns that the visual of the same name is a duplicate and leaves it unnamed. With its default (visuals discarded) nothing is said.
- **The keyframe** of a pose put every body where the engine puts it (8.3e−17 m).
- **Time and size.** The common part with both writers: 51 ms for the extended arm (6 mass queries over 11 bodies), 42 ms for the joint (10 links, 17,774 triangles, 889 kB of meshes).

## Where the code lives

| File | What 5b does there |
|---|---|
| `packages/engine/src/export/robot.ts` | new: `robotTree`, `meshName`, the refusals and `NO_MECHANISM` |
| `packages/engine/src/export/urdf.ts`, `mjcf.ts` | new: the formats (their options, a line of `ExportFormats` each, the writer) |
| `packages/engine/src/export/index.ts` | two lines of `EXPORT_FORMATS` |
| `packages/engine/src/export/text.ts` | `significant` |
| `packages/engine/src/types.ts` | the drive fields of `Joint` and their expressions (before `// --- porty`), `drive` and `driveErrors` of `JointResult`, the joint input of `setJoint` with `null` for a drive field and the comment of the command (after `// --- přepočet`) |
| `docs/architecture/api.md`, `document.md`, `docs/ui/mechanism.md` | `setJoint` keeps the drive it is not given; the drive fields of the form |
| `packages/engine/src/catalog.ts` | `Unit` gains `N`, `N·mm`, `rad/s`, `mm/s`, `g·mm2` |
| `packages/engine/src/sections/mechanism.ts` | `JOINT_DRIVE_FIELDS`; the validator allows them; `setJoint` keeps the drive it is not given and an expression sent back unchanged; the result resolves them apart from the pose and writes their numbers back |
| `packages/engine/src/sections/fields.ts` | `EntryField.optional` |
| `packages/mcp/src/host.ts` | the path: `at` and `after`, the state, `run(host, args, state)` |
| `packages/mcp/src/view-image.ts` | no `at` argument; `imageRequest` over the state; `about.pose`, `about.blocked` |
| `packages/mcp/src/server.ts`, `api.ts` | `at` and `after` in the schema and the description of every operation; the paragraph `CONVENTION` of `contract.ts` |
| `packages/mcp/src/tools.ts` | `get_model`: the drive of a joint, `jointDriveErrors` |
| `packages/engine/src/query/mechanism.ts` | the `returns` text names `drive` and `driveErrors` of a joint |
| `packages/mcp/test/export-formats.test.ts`, `host-operations.test.ts` | the rows of the two formats; `at` out of the rows of `view_image` |
| `packages/app/src/fields.ts`, `panels/mechanism.ts` | the labels of the new units; the four fields of a drive in the form of a joint |
| `packages/scenarios/test/scenario13.test.ts` | the part of 5b (`calls.ts`) |

`export/robot.ts` imports `query/mass.ts` (as `export/outline.ts` imports `query/section.ts`: one level of the import order) and `sections/mechanism.ts` for nothing but types. Nothing in `query/` or `sections/` imports `export/`.

The order of the work: the drive in the section (with `EntryField.optional` and the units), then the common part and the two writers, then the path of the operations, then the app, then the scenario and the documents.

## What the package adds

| To | What |
|---|---|
| The document | four optional numeric fields of a joint; no upgrade step |
| Commands | none (`setJoint` takes the fields) |
| Queries | none |
| Feature types, face roles, `FEATURE_UI` | none |
| Issue codes | none; a fault of a drive is an `ExpressionError` in `driveErrors`, not an issue of the joint |
| Export formats | `urdf`, `mjcf` |
| Operations of the app | `at` and `after` on the path of every operation |
| MCP | no new tool. The tool `export` lists the formats from the catalog; `describe_api` gets them in *Export formats*, the drive in *Sections of the document* (from `SECTION_INFO`) and in the types, `at` and `after` with the operations. The tests that pin the list of formats change: four messages ("the formats are stl, 3mf, dxf, svg") and the keys of the catalog in the engine's test, as 2g counted them |
| The app | the export form lists the two formats with no code (the menu *Export…* of 2g reads the catalog; a set is saved as one ZIP); the form of a joint gets four fields; the labels of the units |

## The schema

No step; see "The drive of a joint". An export stores nothing. The path of an operation stores nothing.

## Rejected alternatives

1. **Effort and velocity as options of the export.** An AI would repeat them on every export, and they are a property of the design (the motor that was chosen), not of a file. 5a planned them as fields of a joint.
2. **A placeholder for a missing effort** (0, or a large number). A number in a file is a claim about the part; urdfdom refuses the file instead, and so does the export, naming every joint at once.
3. **A fault of a drive field as a fault of the joint.** It would block the pose and every query beyond the joint for a number no query reads.
4. **Meshes in millimetres in the coordinates of the model**, with `scale` and an offset of the visual (the bytes of `stl`). Every reader would have to honour `scale`, and a mesh in the frame of its link is the convention MuJoCo's reference describes. The price is a second rounding to float32 (5.6e−6 of a volume at most, measured).
5. **One mesh per link**, as the backlog wrote. A body loses its colour and its name, and MuJoCo takes one hull of the whole link, which is larger than the hulls of its bodies (the hull of the upper plate and the motor together rises 5.4 mm above the top of the plate at the elbow, into the forearm's plate).
6. **A `meshes/` folder.** The writer of the server would need to make folders (the work the preparatory step left to this package), and no reader needs it. Deferred.
7. **One format that writes both files.** URDF's required effort would stop the MJCF.
8. **The inertia in its principal axes** (an `rpy` of the inertial, a `quat` in MJCF). Both formats take the full tensor in the frame of the link; an Euler conversion is a place for errors and adds nothing.
9. **Numbers as the shortest text that reads back** (`String(x)`). `4.263256414560601e-17` for a zero, `0.12000000000000001` for 120 mm over 1000 with a multiplication. Rounded decimals without an exponent are what a person reads and what every reader takes.
10. **`bodyFileName` for the meshes.** Its `%2F` is decoded by a reader that takes `filename` as a URI.
11. **No collision by default.** The arm, the case of the scenario, has no contact with the pairs of its joints excluded; a nested assembly is the case for `none`, and the description for the AI says so.
12. **A floating root, or a `world` link in URDF.** An arm stands on a table; the simulator decides for URDF. Deferred as options.
13. **A position servo** (`position` with a gain) in place of a motor: the gain is a controller.
14. **The actuator's `armature`** (MuJoCo 3.7.0 and later) in place of the joint's: the same physics, for fewer versions.
15. **The coupling of two joints written as `mimic` or an equality.** The expressions would have to be read as a linear relation; `about.coupled` names the joints instead.
16. **`after` as an argument of `view_image`.** No kind of argument holds a command, and every operation would repeat it.
17. **A refusal of a picture of a blocked link without a section.** The app draws it with its joint at zero and marks it; a picture does the same and names the joint. A query refuses because a number would be wrong without a word; a picture is looked at. With a section the cut is a query, and it refuses (above).

## Known limits

- **Uniform density.** A reference part with the mass of its data sheet has the inertia of a uniform body of that mass (a motor's rotor and housing are not uniform). The backlog said so; a link's measured inertia is deferred with weighed masses of links.
- **MuJoCo collides convex hulls.** Parts inside a housing touch it at rest; `collision: 'none'` turns collisions off, and nothing finer (a hull per body from the kernel, pairs excluded by name) is offered.
- **The root of a URDF is not fixed**; a simulator decides.
- **`meshPrefix` for ROS and no prefix for MuJoCo**: one URDF does not serve both.
- **A pattern's copies are a mesh each**, the same triangles in another place.
- **A coupled motion is written as free joints**; URDF has no place for the rotor, the gear or the pose (`about` says so).
- **The drive of a light link is stiff** in MuJoCo without a rotor inertia (measured: the 0.21 g cap driven by 0.05 N·m spun to 10⁶ rad within 0.2 s at the default time step).
- **URDF cannot exclude the two links of a joint from contact.** A reader that collides convex hulls finds a pin inside the hull of its hole: MuJoCo's import of the arm's URDF has `base`–`upper` (`world`–`upper` after it fuses the base into the world) in contact at rest, where the MJCF has none (measured by the review). `about.notWritten` says so; for MuJoCo the MJCF is the file to use.
- **Mesh names keep the case of letters**: two bodies whose IDs differ only in case are refused (a folder on macOS or Windows cannot hold both files).
- **A triangle under 1e−14 m²** (1e−8 mm²) is refused by MuJoCo; the export does not check it. The smallest measured is 5·10⁵ times larger.
- **The IDs are the names**; a name for people is not written.
- **Checked by readers, not by a simulator in use**: no file was opened in ROS, Gazebo, Isaac or PyBullet (see "To verify before the implementation").

## To verify before the implementation

- The files of the scenario in the programs the owner uses (see "Open"): at least MuJoCo's `simulate` (the arm drawn with its colours, the motors moving the joints), and RViz or Gazebo if a ROS tree is in use.
- That `EntryField.optional` changes nothing for the readers of `JOINT_FIELDS` (the app's slider, `setPose`, the limits): the drive is a second list for that reason.
- That `jointErrors` of `get_model` and the panel *Mechanism* keep their meaning with `driveErrors` beside them.
- The MuJoCo version the owner runs, against `autolimits` and the joint's `armature` (both in 4.0.1, measured).

## Tests the implementation owes

- **The drive**: the four fields by kind (a rotor on a prismatic joint refused), their ranges, expressions with a parameter renamed and removed, `driveErrors` without a fault of the joint (a pose beyond it still read), `setJoint` keeping an unnamed drive, removing one by `null` (also inside a batch), dropping it with a change of kind, and taking back a broken expression unchanged in the same batch as the removal of its parameter; the numbers written back when a parameter changes; `describe_api` with the fields and their `when`.
- **Existing tests that change**: `packages/engine/test/mechanism.test.ts` (the load refuses `effort` on a joint as a field it does not know) and `packages/scenarios/test/scenario13.test.ts` (part e, the same with `effort: 2.5`; part f, the list of `SECTION_INFO.mechanism.fields`) take a field that stays unknown (`damping`) instead, and the second gets the drive fields; the four messages and the keys of the catalog that list the formats.
- **`robotTree`**: the frames of every kind of joint (the extended arm of "Measured"), the tree order with a joint listed before its parent's joint, `root`, the refusals of `ROBOT_REFUSALS` each with everything of its kind named, `missing`, auxiliary bodies, bodies in no link, a moving link that is only a frame with its mass on a fixed child (written) and a moving group without mass (refused), an empty root, `driveErrors` refused by both formats, `meshName` (a slash, an underscore, letters beyond ASCII), IDs with a control character or a lone surrogate refused, two mesh names that differ only in case refused, `about` with `leftOut.links`, `coupled` and every sentence of `notWritten`.
- **The writers**: the whole text of the two files of a small mechanism pinned; `badName` for a written body and not for an auxiliary one; the numbers (`significant`, a zero product, a round length); a colour; `collision: 'none'`; `meshPrefix`; the keyframe with `after`; a link named `world` in both formats; names that need escaping; a revolute joint with equal limits, and with limits a nanoradian apart, refused by `mjcf` and written by `urdf`.
- **The three readers by hand** once, as under "Measured", on the files of the scenario: the tests cannot use them (no library is approved for it).
- **The path of an operation**: `at` and `after` for `view_image` through a real bridge (the test of 1f extended): a pose drawn, nothing written, the arguments checked in the state asked (`bodies` after `at`), `at` naming a feature that `after` adds, the errors of `after` and of an unknown `at`; the schema of the tool; `about.pose` and `about.blocked`; a blocked body with a section refused with the operation's text; `imageRequest` with its budget.
- **Scenario 13**, the part of `calls.ts`.
- **MCP**: the rows of the two formats; the tool `export` writing both into one folder (the second with `overwrite`); the list of formats in the tests that pin it.
- **The app**: the form of a joint with the drive, each field in its unit, an emptied field of an edited joint sent as `null`; the export form saving the set of a robot as a ZIP.

The engine part writes file formats whose mistakes are silent until another program reads them, and changes the section of 5a: a full review.

## Open

Questions for the owner:

1. **Is the drive of a joint as designed?** Four optional fields of a joint: `effort` (N·mm, N for a prismatic joint), `velocity` (rad/s, mm/s), and for a turning joint `rotorInertia` (g·mm²) and `gearRatio`. *Yes* keeps the design; *no, in the units of the files (N·m, kg·m²)* changes the units and the conversions only.
2. **Should URDF refuse a revolute or prismatic joint without an effort and a velocity?** The ROS parser refuses such a file. *Yes* keeps the design; *no* writes a stated placeholder and says so in `about`.
3. **Which programs should the files be checked in before the package is closed?** MuJoCo's own viewer, RViz, Gazebo, Isaac, PyBullet? Without an answer the check is the one of the spike (MuJoCo 4.0.1, `urdf_parser_py`, `yourdfpy`).
4. **Collision meshes on by default?** *Yes* (the design): every body is a collision shape, the pairs of a joint excluded; a nested assembly is exported with `collision: 'none'`. *No* turns the default round.

No third-party library is needed; the readers of the measurement stay in the scratchpad.

## Reviews

The design was written by Claude Opus 5.5 (Fable was unavailable, owner, 2026-11-17).

### Round 1 (2026-11-17), at `ffdd23a`

Three reviewers were asked with one brief, read-only: an internal subagent (Claude Opus 5.5, effort high, with probes of its own against MuJoCo and the engine in the scratchpad), `codex` (gpt-6-astra, effort high) and `agy` (gemini-4-argon-high). `agy` did not run: its account is out of quota (HTTP 429, "Individual quota reached"). Neither reviewer found a blocker; `codex` returned seven findings (two major), the internal reviewer eleven (none major; one design error). Every finding was checked against the code or MuJoCo before it was acted on.

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| D49 allows `lower` equal to `upper`; MuJoCo with `autolimits` turns such a limit off, and `limited="true"` with equal bounds does not compile; nine decimals can make two close bounds equal | codex | major | Yes (measured: `range="0.5 0.5"` compiles unlimited; with `limited="true"` "range[0] should be smaller than range[1]") | `mjcf` refuses such a joint (`mjcfLocked`, also bounds equal as written); `urdf` writes it; tests |
| The common part let a joint with `driveErrors` through: a broken effort became an effort not stated, and the MJCF lost its motor without a word; `about.leftOut.links` and `about.coupled` were not built in `calls.ts` | codex | major | Yes (the reviewer's probe of `robotTreeAsWritten`) | Both formats refuse a joint with a drive in error; `calls.ts` builds both lists and checks the MJCF refusal |
| A moving link without a mass of its own was refused, while MuJoCo checks a moving body with the bodies welded to it | internal | minor (design error) | Yes (the reviewer's probe: an empty hinge body with a fixed child of 0.1 kg compiles) | The mass is required of the link with the links fixed to it; `calls.ts` writes a link that is only a frame |
| MJCF writes no velocity, and a continuous URDF joint with only one of effort and velocity loses it, without `about` saying so | both | minor | Yes | Both are sentences of `notWritten` |
| `setJoint` keeps an unchanged expression only for the fields of the pose, so a joint whose effort lost its parameter cannot be sent back whole (the form of the app does that) | internal | minor | Yes (`setJoint`, the loop over `JOINT_FIELDS[type]`) | The loop runs over the drive fields as well |
| `setJoint` without the drive would erase it: optional fields in a command that replaces the joint whole | internal | minor (usability) | Yes | The drive is kept unless the command names it; `null` removes a field; a change of kind drops it. In the contract, the conventions and `calls.ts` |
| With a section, `view_image` refuses a blocked body after all (the section is a posed query), and the text names `geometry: 'modelled'`, which an operation does not take | both | minor (factual) | Yes (the reviewer's probe on `master`) | Said so; the operation refuses with its own text; rejected alternative 17 narrowed |
| The URDF in MuJoCo has `base`–`upper` in contact at rest: URDF has no exclusion of a pair | internal | minor | Yes (the reviewer's probe: four contacts, `world`–`upper`) | A known limit and a sentence of `notWritten`; the conventions point MuJoCo at the MJCF |
| `newId` admits control characters and lone surrogates: `xmlText` changes them, `world\u0001` would be written `world`, and UTF-8 breaks the uniqueness of `meshName` | codex | minor | Yes (`newId` checks only the slash, `origin` and the empty text) | The export refuses an ID that `xmlText` changes beyond its four entities (`badName`); the checks run on what is written |
| Mesh names that differ only in the case of letters collide in one folder on macOS or Windows | internal | minor | Yes (`export-writer.ts` refuses such a set; the ZIP would unpack one over the other) | The export refuses them (`caseClash`); a known limit |
| `imageRequest` loses the budget of its section, which the tests of 1f inject; `view-image.test.ts`, `mechanism.test.ts` (a load with `effort` refused) and `scenario13.test.ts` (the same, and the list of `SECTION_INFO` fields) break and were not listed | both | minor | Yes | The budget stays as the last parameter; the tests are listed under "Tests the implementation owes", with `damping` as the field that stays unknown |
| `at` was checked against the document before the preview, while `after` may add the feature it names (the tool `query` allows it) | internal | nit | Yes (`askedState` of `tools.ts`) | With `after` the preview answers for `at` |
| 1e−14 m² was called 0.01 mm² | codex | factual | Yes (it is 1e−8 mm²) | Corrected |
| Wording: a fault of a drive is an `ExpressionError`, not an issue `invalidExpression`; the comment of `JointResult` and the `returns` of the query `mechanism` need the change; the cap's numbers stated two ways; the hull rises 5.4 mm above the plate, not 13 mm | internal | nits | Yes | Corrected; the two texts are in "Where the code lives" and "The drive of a joint" |
| `calls.ts`: no check of `empty` before the tree; the refusal at a point before the axes checked without its text | internal | nits | Yes | The format checks `empty` first; the check names the text and both joints |

Checked by the reviewers and found sound: the frames, the joint offsets and the axes; the units and the conversions; the inertia convention (both formats, three readers, MuJoCo's own integration); the order of `fullinertia`; the armature as the reflected inertia and the motor's gear and control range; the filter of contacts of MuJoCo (filter 3) and the exclusion; the depth-first order of the keyframe; that no upgrade step is needed (`onlyFields`, api.md); the code the design names (`runExport` modelled, `JointResult.axis`, `LinkResult.bodies` and `missing`, the mass query's handling of reference and auxiliary bodies and of a missing density, `readEntryFields`, the refusal of nested paths by the server, `callHostOperation`, `pictureModel`, the ZIP of the app); every expectation of `calls.ts` against the prototype's files; the rejected alternatives. `codex` could not reach the ROS wiki pages; the internal reviewer read them in the scratchpad copies.

With eighteen findings, two of them major, and a fix that changes a rule of a command (`setJoint` keeps the drive), a second round follows.

### Round 2 (2026-11-17), at `e4b0db9`: the fixes of round 1

The same reviewers with a brief on the diff of the fixes: a fresh internal subagent (Claude Opus 5.5, effort high, with a probe of the mass rule against MuJoCo) and `codex` (gpt-6-astra, effort high). `agy` again did not run (HTTP 429). No blocker and no major; `codex` returned four minors, the internal reviewer seven minors and three nits, four of them the same as `codex`'s.

| Finding | Who | Severity | Holds? | What changed |
|---|---|---|---|---|
| The check that a joint with a broken effort can be sent back whole tested nothing: the removal of the parameter was only previewed, and the joint was sent to the live document | both | minor | Yes | One batch of both commands, with the new limit and `driveErrors.effort` checked |
| The command type cannot carry `null` for a drive field: `Input<T>` never gives it, `CommandAfter5b` left the batch on the old type, and the texts that say "the whole joint" and D49's "a merging patch is not worth its rules" were not named | both | minor | Yes (`types.ts`, `Input`, the `setJoint` branch; api.md, document.md, ui/mechanism.md) | A joint input of its own with `null`; the batch carries it; the texts and the amendment of D49 are named under "The drive of a joint" and "Where the code lives" |
| `badName` checked auxiliary bodies, which are written nowhere | both | minor | Yes | Only links, joints and bodies that are not auxiliary |
| "Make the joint fixed" is wrong for a joint locked at another value than 0: a fixed joint holds its child as modelled | both | minor | Yes (`motionOf` gives the identity for a fixed joint) | The text says so and points at URDF or at modelling the joint where it is locked |
| `CONVENTION` kept the old mass rule | internal | minor | Yes | The rule with the links fixed to a moving link |
| The app's form: with the keep rule an emptied drive field must be sent as `null`, and each field has its own unit | internal | minor | Yes (`panels/mechanism.ts`, `confirmJoint`, one unit per kind) | Said under "The drive of a joint" and in the tests owed |
| The drive numbers were not said to be written back; `evaluate` writes back only the values of `JOINT_FIELDS` | internal | minor | Yes (`sections/mechanism.ts`, `evaluate`) | They are written back with the pose; a test in `calls.ts` |
| A gear without an effort or a rotor is dropped by MJCF without a sentence | internal | minor | Yes | A sentence of `notWritten` |
| The refusal of a blocked body with a section offered a pose at zero unconditionally, and would replace the caller's `after` | internal | nit | Yes (`blockedText`) | The condition of `blockedText`; a batch with the caller's `after` |
| `validateJoint` is called `joint()`; an unknown `at` with `after` comes back as an error of `after` (as with the tool `query`) | internal | nits | Yes | The name corrected; the second left as the tool `query` has it |

Checked and found holding by both: keeping a drive and an unchanged expression is implementable over `Fields` in the mode `update`, `readEntryFields`, `renameParameter` and undo; the mass rule matches MuJoCo, which checks a moving body with the bodies welded to it and stops at the next moving joint; `frameOnly`, `locked`, `driveKept` and `at: 'elbowPin'` against the order of `arm.ts` and the inheritance of `use` by the copies of a pattern; `caseClash` folding as the writer of the server does; the path of the operations with `preview(after, at)` and `getState(at)`; the budget of `imageRequest`; every fix of round 1 but the two named above.

No third round: eleven findings, none serious, and fixes of a sentence or a check each (the rule of the rounds: more than six findings with at least three serious, or a large fix). Not reviewed by a second reader: the text of the fixes of this round.

## Rows for the indexes

**`docs/d36/README.md`**, the row of 5b, column "Design now":

> full, designed 2026-11-17 ([5b-robot-export/design.md](5b-robot-export/design.md)), D59: the export formats `urdf` and `mjcf` over one common part (`export/robot.ts`): one tree from one root (`root` when there are several), the frame of a link at the axis of its joint with the axes of the model, the mass and the full tensor of a link from the query `mass`, an STL per body in metres in the frame of its link, all in one folder; MJCF with motors, the reflected rotor inertia as armature, the pairs of a joint excluded from contact and the pose as a keyframe. Four optional numeric fields of a joint (`effort`, `velocity`, `rotorInertia`, `gearRatio`) whose fault blocks no pose; no upgrade step (the entries are strict). `at` and `after` on the path of every operation of the app, so `view_image` draws a pose that is not written. Measured with MuJoCo 4.0.1, `urdf_parser_py` and `yourdfpy` in the scratchpad

**`docs/decisions.md`**, the row of D59:

> | D59 | Export of URDF and MJCF (D36 5b) | Two export formats over one common part: the mechanism as modelled, one tree from one root, link frames at the joint axes with the axes of the model, masses and full tensors from the query `mass`, an STL per body in metres in one folder; MJCF also motors, armature, excluded pairs and the pose as a keyframe. The drive of a joint as four optional fields that block no pose; no upgrade step. `at` and `after` for the operations of the app. [d36/5b-robot-export/design.md](d36/5b-robot-export/design.md) |

**`docs/requirements.md`**, scenario 13, the part of 5b:

> 5b (D59): the arm with a drive on each joint (a stepper with a gearbox at the shoulder, a servo at the elbow, the effort by an expression) exported as URDF and as MJCF into one folder: the elbow's joint 0.12 m from the frame of the upper arm, the upper arm with its motor and screws 438.953225 g, the forearm's product of inertia from its pin, the shoulder's armature 5400 g·mm² · 5.18²; URDF refused while a joint has no effort, a second root refused until `root` names one, a joint in error, a moving link without mass and a body without a density refused with the link; a broken effort blocks no pose; a picture of a pose that is not written (`view_image` with `after: setPose`).
