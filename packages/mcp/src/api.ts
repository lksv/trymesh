// Popis API enginu pro AI. Sestavuje se ze zdrojů enginu, ne z ručně psaného seznamu: typy
// dokumentu a příkazů se berou přímo ze zdrojového textu types.ts a vazby z katalogu, kterým se
// řídí validace; typy features z registru enginu. Co engine přijme, to popis obsahuje, a naopak.
import {
  CONSTRAINTS,
  EXPRESSION_CONSTANTS,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_SYNTAX,
  FEATURE_TYPE_INFO,
  type FeatureTypeInfo,
  GRID_STRIDE,
  MAX_PATTERN_PLACES,
  DATA_CATALOGS,
  EXPORT_FORMATS,
  type AnyExportFormat,
  IMPORT_FORMATS,
  type AnyImportFormat,
  MESH_LIMITS,
  GENERATORS,
  type AnyQuery,
  type ArgKind,
  type NumberSpec,
  QUERIES,
  SECTION_INFO,
  type SectionInfo,
  SKETCH_TOOLS,
  type SketchToolInput,
  type SketchToolName,
  isFlag,
  rangeText,
  REFERENCE_KINDS,
  type EntryKindName,
  type SketchFeature,
  emptySketch,
  fieldsOf,
} from '@trymesh/engine';
import typesSource from '../../engine/src/types.ts?raw';
import { HOST_OPERATIONS, type HostOperationSet, OPERATION_STATE_ARGS } from './host';

const CONVENTIONS = [
  'Délky jsou v milimetrech, úhly v radiánech. Souřadnice skici jsou v její rovině (osy X a Y skici), počátek skici je pevný bod s ID `origin`.',
  'Dokument je časová osa features. Geometrie se vždy odvozuje přehráním; příkazy mění dokument a engine přepočítá, co na změně závisí. Rovinu, vysunutí a pole (pattern) mění příkaz updateFeature: uvedená pole se s feature slučují, takže stačí poslat jen to, co se mění (například `{ extent: { distance: 12 } }`).',
  'ID volí volající. Musí být jedinečné v celém dokumentu (features i entity všech skic), nesmí obsahovat `/` a nesmí být `origin`.',
  'Skica se kreslí přibližně a geometrii určují vazby a kóty: body se zadají odhadem, solver je po každém příkazu posune tak, aby vazby platily. Více příkazů ke skice je lepší poslat jedním příkazem `batch`; řeší se pak jednou.',
  'Křivky odkazují na body: úsečka má `a`, `b`; kružnice `center` a poloměr (parametr `radius` příkazu addCurve); oblouk `center`, `start`, `end` a vede proti směru hodin. Křivky se spojují sdílením bodu nebo vazbou coincident.',
  "Every sketch has the lines `origin/x` and `origin/y` through its origin along its X and Y (from `origin` towards +X and +Y). A constraint may name one with at least one own operand (a point on it, two points symmetric about it, a distance to it, parallel, perpendicular, an angle, a tangent circle); `midpoint` and `equalLength` do not take them (an axis is a whole line, with no length and no middle). `{ kind: 'sketchLine', sketch, line: 'origin/x' }` is an axis of a revolve, a pattern, a tilted plane or a joint. A sketch tool snaps to them as to any curve (`snap: { kind: 'curve', id: 'origin/y' }`). get_sketch does not list them.",
  'Stejnou řídicí vazbu (stejný typ a operandy) nejde přidat dvakrát. Kóta s `driving: false` jen měří.',
  'A point is put at given coordinates of the sketch by the constraint `fixed` (`{ type: "fixed", point, x, y }`); without `x` and `y` it is fixed where it is (a point added in the same batch has only the estimate of its addPoint so far, because the sketch is solved after the whole batch; give such a point its coordinates). Only an own point of the sketch can be fixed, not the origin or a point of projected geometry. The coordinates are numeric fields `constraints/<id>/x` and `constraints/<id>/y` (command setField) and may be expressions. Holes of the same size share one dimension through `equalRadius`.',
  'Closed regions of a sketch (`regions` in the result of get_sketch) are extruded by the command addFeature with a feature of type extrude: `profile` is `{ type: "regions", sketch, regions }`, where `regions` is a list of `{ outerLoop }` taken from get_sketch. The extent is one of three variants (the third, `upTo`, below). `{ type: "distance", start, distance }`: `start` is the offset of the start along the normal of the sketch plane, from the sketch plane or from `from` (below; usually 0, may be negative), `distance` is measured from the start; a positive one points along the normal of the sketch plane, for a sketch on a face out of the body. `{ type: "throughAll", side }` is for the operation `cut` only: the tool passes through all target bodies and its length follows them at every recompute. `side` is `forward` (along the normal of the sketch plane), `backward` (against it) or `both`; on a face of a body an ordinary hole is `backward`; without `from`, `both` is the safe default unless the body reaches to both sides of the plane and only one part should be cut, and with `from` the side is `forward` or `backward`. ' +
    'Any extent may start from a plane instead of the sketch plane: `from`, a plane reference as for a sketch (a planar face `{ kind: "face", body, face }`, `{ kind: "plane", feature }`, `{ kind: "base", plane }`; for a face the whole plane it lies in), parallel to the sketch plane. So one layout sketch serves every height of a part: `{ type: "distance", from: <the top of the plate>, start: 0, distance: 12 }` is a boss standing on the plate, `{ type: "distance", from: <the top>, start: -0.6, distance: -3 }` a cavity under a skin of 0.6, and `{ type: "throughAll", side: "forward", from: <the top of the plate> }` cuts through a lid above the plate and leaves the plate whole, which a cut through all from the sketch plane would also cut (through all goes through every target on its side of the start, so `backward` from the top of a lid cuts the plate below it too). `start` stays measured along the normal of the sketch plane, whichever way the face points. The plane is resolved at every recompute, so the start follows the face; `facts.startLevel` tells where the tool starts (from the sketch plane along its normal). A plane tilted against the sketch, or parallel to the direction, is the error invalidExtent (put the sketch on that face instead); a face that is gone is brokenReference, a round one nonPlanarFace. `updateFeature` with `{ extent: { from: null } }` returns to the sketch plane.',
  'The ID of a body is the ID of the extrusion with the operation `new` or of the split that cut it off; a copy of a body made by a pattern has the ID `<pattern>/<number>` (numbered from 1; the numbers of a grid have gaps, so read them from `bodies` of the pattern in get_model rather than compose them by counting), listed in `bodies` of the pattern in get_model. The operations `add` and `cut` need `targets`: exactly one body for `add`, one or more for `cut` (a screw hole through two bolted parts is one cut with both bodies as targets). A cut that would remove a whole target is an error and changes none of them; a target the tool does not reach is left unchanged and the warning `noEffect` lists it in `refs`.',
  'A profile of regions may be moved by an offset: `profile: { type: "regions", sketch, regions, offset }`, in millimetres, a number or an expression. A positive offset grows the profile (the outer outline moves outwards, holes shrink), a negative one shrinks it, so the cavity of a box is its own outline with `offset: "-wall"` cut from the floor up. The regions are moved together as one outline (a curve two selected regions share is not part of it); every curve keeps its side face and its name, lines stay planes and arcs cylinders, and corners are mitres. The topology never changes: an offset that makes a curve vanish (an inward offset not smaller than a corner radius, or larger than half the width), that makes loops touch or a hole leave its outline, ends the feature in the error invalidProfile; its message names the curves and says what to do (a smaller offset, a larger corner radius, or the moved outline drawn in the sketch). The field `profile/offset` is optional: a feature without it has no offset; setField with the path `profile/offset` adds it to a profile of regions that has none, and updateFeature with `{ profile: { offset: null } }` removes it. In the section Numeric fields an optional field of a feature is one with a default that is not a parameter of a profile generator (`profile/params/...`, whose default is stored when the parameter is left out), and a parameter of a generator its catalog marks optional (the `shift` of a gear: stored only when given, absent means its default, `null` removes it).',
  'An extent may end in a plane: `extent: { type: "upTo", plane, start, gap }`, where `plane` is a plane reference as for a sketch (`{ kind: "face", body, face }` for a planar face, `{ kind: "plane", feature }`, `{ kind: "base", plane }`). For a face it is the whole plane the face lies in: the tool ends there also where its profile passes beside the face. There is no side: the tool runs from its start (`start` from the sketch plane, or from `from`: standoffs from the floor of a case up to the underside of a lid are `{ type: "upTo", from: <the floor>, start: 0, plane: <the underside> }`) to the plane on whichever side of the start it lies; the plane may be tilted against the sketch, and the end cap then lies in it (a sketch can stand on it). The plane is resolved at every recompute, so screw posts up to the underside of a lid follow the lid; each copy of a pattern of features runs from its own start to that same plane, while the start itself moves with the copy (a pattern of a body copies the body as it is). With `from` the refusals below and the lengths of `facts` are about the start, `from` plus `start`. `gap` (optional, mm) stops the tool that far before the plane, measured across it; a negative gap passes it by as much. The result tells the lengths in `facts`: `lengthMin`, `lengthMax` (equal when the plane is parallel to the sketch) and `forward` (true along the normal of the sketch plane). For every operation; no taper. Errors: brokenReference, nonPlanarFace, and invalidExtent when the plane is parallel to the direction (or within 0.01 rad of it), passes through the start of the tool, or the gap reaches the start.',
  'A wall (a rib, a partition, a ring) is extruded from curves that close no region: `profile: { type: "wall", sketch, curves, thickness }`. `curves` are IDs of own curves of the sketch (lines, arcs, or one circle; construction curves are fine and usual, projected geometry is not allowed) that form one chain: each joined to the next at an end point by a shared point or a coincident constraint, without a branch. The chain is moved by half the `thickness` to each side; an open chain gets a straight end at each free end, a closed chain or a circle gives a band with a hole. The sketch needs no closed region and no valid profile, so the centre line of a rib may end inside the wall it stiffens. Faces of a wall: `{ feature, role: "wallSide", curve, side }`, where `side` is `left` or `right` of the curve in its own direction (a line from `a` to `b`; an arc and a circle counter-clockwise, so `left` is the side of the centre), `{ feature, role: "wallEnd", point }` for the straight end at the sketch point the chain ends at, and the caps `startCap` and `endCap`. Curves that do not form one chain, or a bend tighter than half the thickness, end in invalidProfile with a message that names the curves; a curve that is no longer in the sketch is a brokenReference.',
  'An extent of a distance may taper: `extent: { type: "distance", start, distance, taper }`, the angle in radians between a side face and the direction of the extrusion (in expressions `deg(x)`), strictly between −π/2 and π/2. The profile of the sketch (after its offset) holds at the start of the extent; at the far end it is moved by |distance| · tan(taper) with the rule of the offset. A positive taper widens away from the start, whichever way `distance` points (the outline grows, holes shrink), a negative one narrows. Uses: a draft on a rib or a boss `deg(-2)`; a roof that prints without support `deg(-45)`; a countersink from the face the head sits in, a cut with a negative `distance` (into the body) and a negative taper of half the included angle of the cone, followed by a straight bore; the same from the bore: `start` at the bottom of the cone, `distance` up to the face and a positive taper; a chamfer of the bottom edge against elephant foot, a slab with `profile/offset: -c`, `distance: c` and `deg(45)` under the body. The side of a line is a tilted plane (a sketch may stand on it; its origin stays where the plane meets the sketch plane), the side of an arc or a circle a cone (`kind: "cone"` with `apex`, `axis` from the apex towards the face, `halfAngle` = |taper|); the faces keep the names of the straight extrusion, and the rims of a cone against a cap, a coaxial cylinder or cone are circles a sketch can project. The field `extent/taper` is optional like `profile/offset` (setField adds it, `{ extent: { taper: null } }` removes it). A taper on a generated profile or on an extent through all is an invalid command; a taper under which the far profile cannot be built (a curve vanishes, loops touch) ends the feature in invalidProfile, with a message that says it is the far end and names the curves.',
  'A hole for a screw, a nut or a heat-set insert is a feature of the type hole, not a cut from circles: `{ type: "hole", sketch, points, shape, extent, targets, label }`. `points` are points of the sketch (own points or `origin`, not projected geometry), one hole at each, along the normal of the sketch plane; place them with dimensions or `fixed` like any point. Do not take the sizes from memory: ask the query `hardwareHole` (`{ use, size, fit, allowance }`; `use` is clearance, socketHead, countersunk, nutPocket or heatSetInsert, `size` a row such as "M3", `allowance` best the name of a parameter that compensates the printer) and put its `shape` and `label` into the feature as they come (for an insert also its `depth` as the distance of the extent). The kinds of `shape`: `plain` (diameter), `counterbore` (diameter, headDiameter, headDepth), `countersink` (diameter, headDiameter, angle, the included angle of the cone) and `nutPocket` (diameter, acrossFlats, headDepth, rotation); the head is at the mouth. The extent is `{ type: "distance", start, distance }` (the mouth at `start`, the depth of the whole hole in `distance`, negative into a body for a sketch on its face) or `{ type: "throughAll", side }` with `side` `backward` (into the body from a face it stands on) or `forward`; no taper, no upTo, not both sides. The mouth may be at a face the sketch does not stand on, by `from` as for an extrusion: for a part whose sketch is at the bottom, a counterbore with its head at the top is `{ type: "throughAll", side: "backward", from: <the top face> }`, and `facts.depth` is then measured from the mouth. Faces: `holeBore` and `holeHead` with `point`, `holeFlat` with `point` and `flat` (1 to 6, counter-clockwise from the corner `rotation` points to), `holeSeat` (one face for all points), and `startCap`/`endCap` for the mouths and the bottoms. The result has `facts.depth` and `facts.headDepth`. Errors: invalidHole when the head is not wider than the bore, is as deep as the hole or deeper (for through all: as deep as the targets reach from the mouth), or two holes overlap. A pattern of features repeats a hole like a cut.',
  'A turned part (a pulley, a knob, a cone, a ball, an O-ring groove, a countersink) is a feature of the type revolve: `{ type: "revolve", profile, axis, extent, operation, targets }`. `profile` is regions of a sketch (with an optional offset) or a wall, as for an extrusion, not a generated profile. Draw the half profile in a sketch on a plane that holds the axis (on XZ the x of the sketch is the radius and its y the height along the world Z) with the profile on one side of the axis; it may touch the axis in a point or along a line, and a line on the axis makes no face. `axis` is an AxisRef in the plane of the sketch: `{ kind: "base", axis: "Z" }` for a sketch on XZ or YZ, or `{ kind: "sketchLine", sketch, line }`, best a construction line of the profile\'s own sketch (a line of the profile itself may serve, such as the diameter that closes a half circle). `extent` is `{ type: "full" }` (a whole turn, no caps) or `{ type: "angle", start, angle }` in radians from the sketch plane by the right-hand rule about the direction of the axis (from the point `a` of its line to `b`); a negative angle turns the other way; a whole turn is never an angle of 2π; a turn symmetric about the sketch is `start: "-a / 2"`, `angle: "a"`. The faces are named as for an extrusion of the same profile: `side` with the curve, `startCap` and `endCap` of a partial turn (planes through the axis). A line across the axis gives a plane (a sketch may stand on it; its origin is the start of the line), a line along it a cylinder, another line a cone, an arc a sphere when its centre lies on the axis and a torus otherwise (`majorRadius` signed: negative for an arc centred across the axis); the edges between them are circles a sketch can project (except an edge where two curves meet twice, such as the two rings of a half torus closed by a line across the axis: it is a general edge). A ball is a half circle closed by a line on the axis. The result tells `facts.axisPoint`, `facts.axisDirection` and `facts.steps`. Errors: invalidAxis when the axis does not lie in the plane of the sketch, the profile lies on both sides of it, or its line has no length; invalidProfile also for a tool of more than a million triangles (raise the chord tolerance). A pattern repeats a revolve that adds or cuts like a cut.',
  'Edges are chamfered and rounded by the feature types chamfer and fillet: `{ type: "chamfer", body, edges, distance }` and `{ type: "fillet", body, edges, radius }`, the size a number or an expression in mm. `edges` lists edges of that one body, each `{ a, b }` named by its two faces as the query `body` lists them (the order of the two does not matter). An edge that can take one: a straight edge between two planes (kind line), or a circular edge between faces about one axis that are planes across it, cylinders or cones (kind circle: the rim of a hole, a boss, a bore, a turned part); not an edge of the kind other, and not the rim of a sphere or a torus. A convex edge is cut, a concave one (an inner corner, the foot of a boss) gets material added. An edge that runs on smoothly into another (a line of an outline with round corners into the arc of the corner) needs that edge in the same feature: round the whole loop of a rounded box in one feature, and the error names the edge to add. A convex and a concave edge that meet at a vertex go into two features. An edge may end at a plane, or run out past a round face it crosses at 10° or more (D67): into a hole, a pocket or a boss (a cylinder of any axis for a straight edge, one parallel to its axis for a circular edge; the rim of a bore into pin pockets, an edge into a hole that breaks it, the concave foot of a rib into a boss), out through a round wall into the air outside it (the edges of a slot through a shaft), and a circular edge also past a plane parallel to its axis (the rim of a bore into a keyway); the chamfer or fillet then ends on that face. Refused with the end face in the refs: a stop (a convex edge into a wall, a concave edge past a rim; blend before the feature that makes the face), a bridge (the corner passes behind the face before crossing it, as a hole that notches the edge less deep than the size; blend before the hole or use a smaller size), a crossing under 10°, an end at a cone, sphere or torus, and (blendDoesNotFit) a run-out that would cut or add material beyond the face (a pin in the pocket, a pocket shallower than the size). Several edges in one feature meet at their vertices: in their mitre at the same angle, three chamfers exactly at a corner, three fillets in a crease. Each edge gets one new face `{ feature, role: "chamfer" | "fillet", edge: <its place in edges, from 0> }` (a plane, a cone, a cylinder or a torus; a sketch stands on the plane of a chamfer of a straight edge); keep the order of the list, since removing an edge from the middle renames the faces after it. The faces of the edge keep their names. The result tells `facts["setback/<i>"]` (how far from edge i the new face meets its faces) and `facts["cut/<i>"]` (true where material was cut). Errors: unsupportedEdge (the edge, or a pair of edges, cannot be chamfered or filleted here; the message says why) and blendDoesNotFit (a face would vanish, the tool reaches material it must not touch, the blend reaches the axis of a circular edge, a run-out would cut or add beyond its end face).',
  'Instead of regions, the profile of an extrusion may come from a profile generator: `profile` is `{ type: "generated", generator, sketch, operands, params, refs }` (section Profile generators). `operands` name entities of the sketch, `params` take numbers, expressions and flags (what is left out gets its default), `refs` name earlier features. An operand is a circle (the pitch circle of a gear, the circle of the ring pins of a cycloidal disc) or a point (the centre of a GT2 pulley: an own point, `origin`, or a point of projected geometry such as `<id>/center`). The generator reads only the solved operands, so the sketch needs no closed regions; pitch circles of gears in mesh touch and should be construction circles. Operation, extent and targets work as for any extrusion. The result of the feature carries `facts` (for a gear its module, diameters and the rotation used): read them with get_model to verify what was built. updateFeature merges the dictionaries by entry: `{ profile: { params: { teeth: 24 } } }` changes one parameter, `null` returns a parameter to its default or removes a reference.',
  'Gears: a gear is an extrusion with the generator involuteGear over its pitch circle; the module follows from the circle diameter and the tooth count, so dimension the circle with an expression such as `"module * Zs"`. Give every gear after the first one `refs: { meshWith: <the gear it meshes with> }`: the rotation is then computed and stays right when tooth counts change. A ring gear is a cut with `internal: true` into solid material. The warnings gearMesh (the reference could not be used, the parameter rotation was used) and gearInterference show up in `problems`. A pinion with few teeth that interferes gets a positive profile shift `shift` (for example 0.3) and its mate the opposite one (−0.3); a gear inside a ring has the same shift as the ring. Gears in mesh keep the reference centre distance, so shifts that do not balance are the warning gearMesh; a shifted centre distance is not supported.',
  'Every body in get_model and get_body has its volume in mm³ and its bounding box (`min`, `max`); use them to verify what you built. check_interference tells which bodies collide (`pairs`) and should follow any change to parts that must not overlap. Bodies that only touch do not count; a pin in a hole of the same diameter may be listed in `fits`, which is not a collision: round faces are polygons and their corners need not coincide. Each pair has a `depth`, how deep one body reaches into the other; a fit is no deeper than the chord tolerance (`tolerance` in the answer). export_stl saves the printed bodies into one file, or with `perBody` one file per body for printing.',
  'Body properties (command setBodyProperties, section Sections of the document) say what a body is: a name, a colour `#rrggbb`, a material label, and its use: `part` (printed; the default), `reference` (a bought or given part such as a motor: not printed by an export or a print query that gets no list of bodies, but it has a mass) or `auxiliary` (kept-free space, an envelope: neither printed nor weighed, still checked for collisions). Give a printed part its material from the catalog with setBodyMaterial (it copies the density, do not type a density from memory); give a bought part its `mass` in grams from its data sheet, and a weighed part its weighed mass. A copy made by a pattern of a body takes after its source (colour, material, use, and the density and the mass as a pair), so set the source and only what a copy does differently. The mass query reads these properties. get_model shows them per body; an entry whose body is gone stays (listed in `bodyPropertiesWithoutBody`) and is taken over by a body made again under that ID. execute lists in `takenOver` the IDs the command used again while body properties still named them (a feature, or a sketch point or curve under such an ID); remove the properties first when the ID is meant for something else.',
  'The parts list is the query `partsList` (no arguments) and, as a file, the export format `partsCsv`: printed parts (bodies with the use `part`), bought parts (use `reference`, with the mass of their data sheet) and hardware. ' +
    'Hardware is counted from the labels of the hole features, one piece per hole of the model, so `label` should name the piece that goes into the hole. The label the query `hardwareHole` gives is a start: add what the catalog does not know, such as the length of the screw ("M3x10 countersunk screw"). ' +
    'For a plain clearance hole it names the hole ("M3 clearance hole"), not a piece: write the screw into it when its head sits on the surface, and remove the label when the screw is counted by the hole of its head or of its nut. One screw through two parts is best one hole feature with both bodies as targets: a hole copied with its body is a hole of every copy unless the copies continue it, so parts held by one screw that are copied should touch along the hole, or the hole be cut after the copies. ' +
    'A screw modelled as a body with the use `reference` is a bought part; do not label its hole as well, or it is listed twice. Copies of a body made by a pattern are one row with a count while no feature after the pattern changes one of them: model what every copy should have before the pattern, and give a material to the source. ' +
    'Every copy counts, also copies laid out for printing, with their holes.',
  'The mechanism (section Sections of the document; commands setLink, setJoint, setPose and their removals) says how bodies move: a link is a list of bodies that move as one piece (a copy made by a pattern is listed like any other body), a joint (revolute, continuous, prismatic, fixed) moves its child link against its parent link about or along an axis (`AxisRef`, given as modelled). The model as modelled is the zero of every joint: model an arm in one configuration and its values are turns (rad, positive by the right-hand rule about the direction of the axis; for a sketch point the normal of its sketch, for a line of a sketch from its point `a` to `b`, for a round face as its feature built it) or shifts (mm) from there. ' +
    'A pose is stepped without writing it: `query` with `after: { type: "setPose", values: { elbow: 1.2 } }` (for a coupled motion two values follow one parameter, and the step is `after: setParameter`). The query `mechanism` says where the links stand and which joint is in error, and with `beyond` what hangs on a joint (for its mass give those bodies to the query `mass` with the same `after`). ' +
    'Every query answers in the pose of the document, also with `at`; the tools query, check_interference and get_body then say `pose` beside the answer. A body beyond a joint that has no motion (its axis broken or, with `at`, not made yet while its value is not zero; a limit or an expression in error) cannot be read in the pose and the query fails naming the joint: read it with the joint previewed at zero (`after: setPose` with 0), or ask about the model as modelled with `geometry: "modelled"`. ' +
    'An axis, a sketch point or a plane given to a query is as modelled while the bodies are posed. Exports, get_model and the print query are always as modelled. ' +
    'A pair in `fits` across a joint is a pin in its hole, not a collision, and is there in nearly every turned pose; the kernel verifies nearly every such pose, and a pair it cannot verify is in `cleared` (clear, by a mesh the kernel computed and did not verify) or in `failed`. A pair in `failed` is neither clear nor colliding; its message says what the kernel computed and could not verify. Lay the axes of joints along the axes of the model where you can: askew to them a pair costs seconds.',
  'A robot description is the export format `urdf` or `mjcf` (tool `export`, a directory): the description and one STL per body, in metres and kilograms. ' +
    'It is the mechanism as modelled: one tree from one root link (`root` when there are several), the frame of a link at the axis of the joint that moves it with the axes of the model, the mass, the centre of mass and the inertia of each link from its bodies (a reference part with the mass of its properties, auxiliary bodies left out). ' +
    'Every link a revolute, continuous or prismatic joint moves needs a mass, its own or on the links fixed to it; URDF needs `effort` (N·mm, N for a prismatic joint) and `velocity` (rad/s, mm/s) of every revolute and prismatic joint: set them with setJoint. ' +
    'MJCF also writes a motor per joint with an effort, with `gearRatio`, and `rotorInertia · gearRatio²` as the armature of the joint (`rotorInertia` in g·mm², as the query mass), and the pose of the document as the keyframe `pose`. ' +
    'setJoint keeps the drive of a joint it is not given (null removes a field). ' +
    'MuJoCo collides the convex hulls of the meshes; the MJCF excludes the two links of a joint from each other, which URDF cannot say, so use the MJCF for MuJoCo. Parts nested in a housing touch it, so export such a model with `collision: "none"`. ' +
    'A coupled motion (two values over one parameter) is written as free joints. `about` of the description says what was written and what was not. ' +
    'The operation view_image takes `at` and `after` as the tool query does: `after: { type: "setPose", values: { … } }` draws a pose without writing it; a body beyond a joint without a motion is drawn with the joint at zero, and refused when a section is asked.',
  'A pattern (feature type pattern) repeats its source by one of three kinds of `transform`. `source` is `{ type: "features", features: [...] }` (features that apply a tool: extrusions and revolves with the operation add or cut, holes; for every copy the tool of each is built again in the place of the copy and applied to the targets of that feature, so a cut through all is measured in the direction of the copy; a copy of a feature with `from` carries its start, so it starts at the image of that face (a boss on the top of a plate mirrored in the middle plane of the plate stands under the underside), while the end of `upTo` stays the plane the feature saw (so the mirror of a post from the top of a plate up to a lid runs from the underside up through the plate to the lid)) or `{ type: "body", body }` (the copies are new bodies `<pattern>/<number>`). ' +
    '(1) `{ type: "circular", axis, count, span }` turns the copies around an axis: `axis` is `{ kind: "base", axis: "X" | "Y" | "Z" }` or `{ kind: "sketchPoint", sketch, point }` (the normal of the sketch plane through that point) or `{ kind: "sketchLine", sketch, line }` (along a line of a sketch, own or projected, from its point `a` to `b`; a line without length is the error invalidAxis) or `{ kind: "face", body, face }` (the axis of a round face: a cylinder such as a bore or a pin, a cone, a torus; in the sense its feature gave it, the normal of the sketch of an extrusion or a hole, so out of the body for a bore drilled from a face, or the axis of a revolve; a face without an axis is the error invalidAxis). A positive angle turns counter-clockwise seen against the axis (right-hand rule; around Z it takes X towards Y); around a sketch point that is counter-clockwise in the coordinates of the sketch, so a sketch on the base plane XZ (normal −Y) turns the other way than the base axis Y. `span` is `{ type: "full" }` (the step is the full circle divided by the count) or `{ type: "angle", angle }` (the angle between the first and the last copy). ' +
    '(2) `{ type: "linear", direction, count, span }` shifts the copies along a direction: `direction` is an axis as above of which only the direction counts (a base axis points along its positive half, a sketch point gives the normal of its plane, out of the body for a sketch on a face, use the point `origin`; a line of a sketch points from its `a` to its `b`; a round face along its axis). `span` is `{ type: "spacing", spacing }` (mm between neighbours: copy k is shifted by k · spacing, so a larger count adds copies at the far end and keeps the numbers and places of the others; prefer it when something refers to a copy) or `{ type: "length", length }` (mm between the original and the last copy; a change of the count moves every copy); negative runs against the direction, zero is refused. ' +
    `An optional \`second: { direction, count, span }\` makes a grid: the row is repeated along a second direction, each field as in the first; its count is a field whenever there is a second direction (the list of the numeric fields names it once per span). The copy i steps along the first direction and j along the second has the number i + ${GRID_STRIDE} · j: the first row is 1, 2, …, the second ${GRID_STRIDE}, ${GRID_STRIDE + 1}, …, the third ${2 * GRID_STRIDE}, …; the numbers do not depend on the counts, so with spacings a larger count keeps every copy where it was, and \`bodies\` of the pattern lists the copies that exist. At most ${MAX_PATTERN_PLACES} places together (count × second count, the original included), and no two places in one place (whole numbers of steps along parallel directions that reach the same place, such as the steps 5 and 5, 5 and 10, 5 and −5; a step of next to nothing; directions a hair apart); both are the error invalidPattern of the pattern, not a refused command, with the copies named in its message. \`updateFeature\` with \`transform: { second: null }\` makes a row again. ` +
    '(3) `{ type: "mirror", plane }` makes one copy, number 1 (`<pattern>/1` for a body; `<pattern>/2` is refused), the mirror image in `plane`, a plane reference as for a sketch (a base plane, `{ kind: "plane", feature }`, or a planar face, of which the whole plane counts); no count. The plane of symmetry of a part is best a base plane, a plane feature offset by an expression (`offset: "L / 2"`), or the midplane of two faces (a plane feature with `midplaneWith`, which follows the faces). A mirrored copy is the mirror image as a set of points; its faces have the names of the source faces they are images of, with the copy tag, so what a name says by a sense of rotation is reversed (the `wallSide` `left` lies right of the image of its curve, the `holeFlat`s run clockwise), and a sketch on one of its faces has a right-handed frame of its own (its x runs the other way than the image of a sketch on the source face). The ends `a` and `b` of a projected edge of any copy are read from the sketch that projects it, not derived from the source. ' +
    '`count` (circular, linear) includes the original, so 4 holes around a circle are count 4 and three more copies. A change of the kind keeps the IDs of the copies and the tags of their faces: what stands on copy 1 then stands on the copy of the new kind. A copy of a feature goes to the targets of its source and a copy of a body is the body as it is at the pattern, so what a mirrored half should also get is modelled before the mirror. A grid is the second direction of a linear pattern, of features or of a body; four corners from one are two mirrors and a circular pattern of count 2 about the line where the two planes meet, or, for a body, mirrors of the copies. ' +
    'The pattern is atomic: if one copy fails, the pattern is in error, the model stays as it was before it and `refs` of the error start with `{ copy, feature }`. Copies that leave some of their targets unchanged are listed in the warning `noEffect` as `{ copy, feature, targets }` with those targets; a copy that falls onto what is cut already (the last of 5 copies over an angle of 2π lands on the original) is one of them. A pattern of features takes one boolean per copy and target on a body that keeps growing: tens of copies are fine, 200 holes take tens of seconds; a pattern of a body is cheap.',
  'A bought part as a mesh (D55): the tool import_mesh reads an STL file into a stored mesh of the document (section Sections of the document, `meshes`; the command addMesh, which the tool sends) and answers with the batch that places it: a feature of the type mesh (its `placement`: a frame, which may be a sketch point such as the centre of the bolt pattern of a motor, then offsets and turns in it) and setBodyProperties with `use: "reference"`; add the `mass` of its data sheet there. ' +
    'An imported body has one face, `{ feature, role: "mesh" }`, for its whole surface and no edges: no sketch or plane stands on it (nonPlanarFace), nothing of it is projected, and no extrusion, hole or pattern of them may have it, or a copy of it, as a target, nor a combine as its target or a tool (with a clearance too), nor a split as its body (the error importedTarget). Draw what fits it (a bolt pattern) from the data sheet and check it against the body with check_interference and the query gap; its surface counts as round, so an overlap shallower than the chord tolerance is a fit. ' +
    `A real collision with a large mesh takes seconds (more the deeper it is); an import reads at most ${MESH_LIMITS.triangles} triangles. get_document leaves the data of a stored mesh out; get_model lists the stored meshes and what uses them.`,
  'Another document as a part (D62): the tool insert_document reads a document file (as save_document writes it) into a stored document of this one (section Sections of the document, `documents`; the commands addDocument and replaceDocument) and answers with the command that inserts it: a feature of the type insert with its `placement` (as for a mesh feature), `parameters` (values for parameters of the inserted document, per insertion: a number or an expression over the parameters of this document; the expressions of this document cannot read its parameters) and `bodies` (which of its bodies come in; all without it). ' +
    'The stored document is recomputed from its features with the chord tolerance of this document; two insertions whose parameters evaluate alike are one part. Its bodies are `<insertion>/<ID there>` and its faces keep their names with every feature ID prefixed `<insertion>/` (`{ feature: "b1/ring", role: "side", curve: "outer" }`), so a sketch, a plane, a projected edge, a hole or a cut may use an inserted body as a body modelled here. ' +
    'Body properties come from what the inserted document states (colour, material, use, density and mass) unless setBodyProperties sets them here; a bought part should be `use: "reference"` with the mass of its data sheet in its own document. The warning insertedIssues lists the features of the inserted document in error and its checks that fail. get_document prints a stored document shortened (`stored` prints one whole), save_document with `stored` writes one to a file of its own, and insert_document with `replace` brings a revision back.',
  'Finished bodies are combined by the feature type combine: `{ type: "combine", operation, target, tools, keepTools }` with `operation` `union`, `difference` or `intersection`; the target keeps its ID, its properties and its link, the tools are made with one after another, and `keepTools` (no default) says whether the tool bodies stay or leave the model (a later feature that names a tool that left is a brokenReference). Model a part without a thought for what it must hold, then subtract the bought part (a motor, a board) from it: with `keepTools: true` the part stays a body, and a `clearance` (mm, a difference only; absent or 0 is none) subtracts every tool moved outwards by that much, each face along its own surface, corners sharp. The faces of such a pocket are the faces of the tool with a copy tag `{ pattern: <the combine>, index: <the tool in tools, from 1> }`, exact planes, cylinders and cones, so a sketch stands on the floor of the pocket. A tool that cannot be moved without a change of its shape (a hole no wider than twice the clearance, a slot, two pins or the tips of a C nearer than twice the clearance) is the error invalidClearance naming the faces, and so is a clearance too small to tell from none (under ten precisions of the coordinates, or not more than twice the chord tolerance on a tool with round faces). Verify a pocket with the queries gap (round faces are polygons, so it is short of the clearance by up to the chord tolerance) and measure (between two planes it is exact). A projected edge of a tool that was used up only warns (brokenProjection) and keeps its place. Without a clearance a face of the result keeps its name from the target or the tool. A result the kernel gets wrong (its volume against the volumes of the two and what they share, faces left back to back) is kernelFailure; two parts cut apart and joined again by a union may be refused so or keep a remnant of the cut face. ' +
    'A body is cut into two by the feature type split: `{ type: "split", body, plane, side }`, `plane` a plane reference as for a sketch. The body keeps its ID and the part on the other side than `side`; the part on the side `side` (`forward`: where the normal of the plane points) is a new body with the ID of the split, taking after the body (colour, material, use, density and mass) and in no link until one lists it. Both parts get the cut face `{ feature: <the split>, role: "splitFace" }`, a plane a sketch stands on, where the plane passes through material (a body of pieces on both sides of it is only taken apart). Later features that name the body work on the part that kept the ID, without a word: a cut meant for both parts lists both bodies, so put a split after what both parts should have.',
  'Stěny a hrany se jmenují podle svého původu: stěna `{ feature, role: side, curve }` vznikla z křivky skici (for a generated profile `curve` is the side name from the generator catalog, for a gear `teeth`; such a face is not planar), `startCap` je víko na začátku rozsahu (při nulovém `start` v rovině skici), `endCap` protější víko. A face of a copy made by a pattern has the same name with `copy: [{ pattern, index }]` added (the pattern and the number of the copy; a pattern of a pattern appends another entry); faces of the original have no `copy`. Hrana je dvojice jmen stěn. Jména platná pro těleso vrací get_body.',
  'Mirror and pattern in a sketch (D68; section Entries of a sketch, kind `pattern`): constrain the sources, not the copies; a copy is never an operand of a constraint of its sketch, a point of a curve, or what a sketch tool cuts or snaps to. A count follows a parameter (`count: "vents"`); a feature that should follow the count names a region the copies lie in (they are its holes), while a feature that names a region of a copy names that copy, and a copy above the count is a broken reference of that feature (noProfile) until the count comes back. A projection or a copy is no source. The copies of a mirrored outline close with the source only where their ends meet within 1e-6 mm: hold the end of the source on the axis by a constraint (`pointOnCurve` with the axis); get_sketch says which ends stayed open.',
  'Projected geometry (section Entries of a sketch, the reference kinds `edge` and `sketch`): an entry of a reference kind is fixed for the solver and follows its source at every recompute; a curve is the entry itself and its points are `<id>/a`, `<id>/b`, `<id>/center`, `<id>/start`, `<id>/end`; when the source is gone it keeps its last place (brokenProjection; for a projection from a sketch the message says why) and constraints on it keep acting. Constrain own geometry to it with at least one own operand. A projection from a sketch with `regions: true` bounds regions as an own curve does, and the ends of such curves join at their place, with each other and with an own end there (get_sketch says which ends stayed open). Such a curve is never cut by the sketch tools: an outline to be trimmed is drawn as own curves over the projections, which the sketch tool projectSketch with `as: "own"` does in one batch, taking over an entry that projects the curve with the flag already (its flag switched off) (by hand: an own point coincident with the projected end at each corner, an own line between two of them, an own arc with a centre of its own, a construction line from that centre to the arc\'s start and the projected centre on that line by pointOnCurve; not equalRadius, which has a second solution). What a sketch can project, and where each entity would land, says the query sketchSources: `{ query: "sketchSources", args: { sketch, from } }`; one entity is `addExternal { sketch, id, ref: { type: "sketch", sketch: <earlier sketch>, entity, kind } }`.',
  'Parameters: the document has a table of named parameters (command setParameter, a name and an expression). A numeric field of a feature and the value of a driving dimension accept an expression as a string instead of a number, for example `{ extent: { distance: "thickness * 2" } }` or `value: "module * Zs"`. The section Numeric fields lists those fields; elsewhere a string in place of a number is an error. The engine evaluates the expression, fills the number into the field and stores the expression in `expressions` of the feature under the field address. After a parameter changes the model is recomputed.',
  'An expression in a feature field must evaluate right away (the parameters it uses must exist), otherwise the command is invalid. A parameter itself may refer to a parameter that does not exist yet; get_parameters returns its state. A number sent to a field with an expression removes the expression; fields updateFeature does not mention keep theirs. The command setField (`{ feature, path, value }`) changes a single field.',
  'Angles are in radians both as a number and in an expression; degrees are written with the function `deg()`: an angle of 30° is `"deg(30)"`. Angle fields have ranges in radians, so a value entered in degrees by mistake is an invalid command.',
  'Checks (command setCheck) are expressions with a comparison that are supposed to hold, for example `Zs % 3 == 0`. A check that fails does not stop the model; execute returns it in `failedChecks`.',
  'A recompute error (a broken reference, conflicting constraints, an expression that can no longer be evaluated) is not a command error: the command is carried out and the problem is in the feature state. After every execute check `problems`, `failedChecks` and `parameterErrors`.',
  'Diagnostika skici: get_sketch vrací stupně volnosti, volné entity, vazby navíc a radu, co chybí; explain_constraint říká, z čeho vazba plyne.',
];

// Typy dokumentu, výsledku přepočtu a příkazů. Porty (rozhraní solveru a jádra) AI nepotřebuje.
export function engineTypes(): string {
  const marker = (name: string) => new RegExp(`^// -+ ${name}$`, 'm');
  const [ports, evaluation] = [typesSource.search(marker('porty')), typesSource.search(marker('přepočet'))];
  if (ports < 0 || evaluation < ports) return typesSource;
  const note = '// (Rozhraní solveru a geometrického jádra jsou vynechána. `Solid` je trojúhelníková síť tělesa:\n// positions, triangles, faceIds; přes nástroje se nepřenáší, těleso popisuje get_body.)\n\n';
  // an import of the source file is not part of the description
  return (typesSource.slice(0, ports) + note + typesSource.slice(evaluation)).replace(/^import type .*\n/gm, '');
}

export interface ConstraintDescription {
  type: string;
  title: string;
  summary: string;
  operands: { field: string; kinds: string[] }[];
  value?: { unit: string; rule: string }; // the value of a dimension
  values?: { name: string; unit: string; rule: string }[]; // named values of a constraint that is not a dimension (a fixed point: x, y)
  example: Record<string, unknown>;
}

export function constraintCatalog(): ConstraintDescription[] {
  return Object.entries(CONSTRAINTS).map(([type, spec]) => ({
    type,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ field: operand.field, kinds: [...operand.kinds] })),
    ...(spec.dimension && spec.values?.value ? { value: { unit: spec.values.value.unit, rule: rangeText(spec.values.value) } } : {}),
    ...(!spec.dimension && spec.values ? { values: Object.entries(spec.values).map(([name, value]) => ({ name, unit: value.unit, rule: rangeText(value) })) } : {}),
    example: {
      type,
      ...Object.fromEntries(spec.operands.map((operand) => [operand.field, `<${operand.kinds.join('|')}>`])),
      ...Object.fromEntries(Object.entries(spec.values ?? {}).map(([name, value]) => [name, value.unit === 'rad' ? 1.5708 : 10])),
      ...(spec.dimension ? { driving: true } : {}),
    },
  }));
}

export type FeatureDescription = FeatureTypeInfo & { type: string };

const fieldText = (spec: NumberSpec): string => `${spec.title}, ${spec.unit}, ${rangeText(spec)}${spec.default === undefined ? '' : `, default ${spec.default}`}`;

// Expression syntax: operators, functions and constants.
export function expressionSyntax(): { syntax: string; functions: { name: string; signature: string; summary: string }[]; constants: { name: string; summary: string }[] } {
  return {
    syntax: EXPRESSION_SYNTAX,
    functions: Object.entries(EXPRESSION_FUNCTIONS).map(([name, spec]) => ({ name, signature: spec.signature, summary: spec.summary })),
    constants: Object.entries(EXPRESSION_CONSTANTS).map(([name, spec]) => ({ name, summary: spec.summary })),
  };
}

// Numeric fields that accept an expression: feature fields, dimension values, and the fields of the
// entries of the sections of the document (`<key>/<field>`, the key of the entry first).
export function numericFields(): { owner: string; path: string; description: string }[] {
  return [
    ...Object.values(SECTION_INFO as Record<string, SectionInfo>).flatMap((info) =>
      info.fields.map((field) => ({ owner: `${info.title.toLowerCase()} of a ${field.owner}`, path: `<${field.owner}>/${field.path}`, description: fieldText(field.spec) + (field.when ? ` (only when ${field.when.path} is ${field.when.equals})` : '') })),
    ),
    ...Object.entries(FEATURE_TYPE_INFO).flatMap(([type, info]) =>
      info.fields.map((field) => ({ owner: type, path: field.path, description: fieldText(field.spec) + (field.when ? ` (only when ${field.when.path} is ${field.when.equals})` : '') })),
    ),
    ...Object.entries(CONSTRAINTS).flatMap(([type, spec]) =>
      Object.entries(spec.values ?? {}).map(([name, value]) => ({ owner: `sketch, constraint ${type}`, path: `constraints/<id>/${name}`, description: fieldText(value) + (spec.dimension ? ' (driving dimension only)' : '') })),
    ),
  ];
}

export interface GeneratorDescription {
  generator: string;
  title: string;
  summary: string;
  operands: { name: string; kinds: string[] }[];
  params: { name: string; description: string; required: boolean }[];
  refs: { name: string; title: string; summary: string; generators: string[] }[];
  sides: string[];
  facts: { name: string; description: string }[];
  example: Record<string, unknown>;
}

// Profile generators from the catalog of the engine, each with an example profile the engine accepts
// once the operands are replaced by entities of the sketch.
export function generatorCatalog(): GeneratorDescription[] {
  return Object.entries(GENERATORS).map(([generator, spec]) => ({
    generator,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ name: operand.field, kinds: [...operand.kinds] })),
    params: Object.entries(spec.params).map(([name, param]) => ({
      name,
      description: isFlag(param) ? `${param.title}: true or false, default ${param.default}` : `${fieldText(param)}${param.optional ? '; optional: stored only when given' : ''}`,
      required: !isFlag(param) && param.default === undefined,
    })),
    refs: Object.entries(spec.refs).map(([name, ref]) => ({ name, title: ref.title, summary: ref.summary, generators: [...ref.generators] })),
    sides: [...spec.sides],
    facts: Object.entries(spec.facts).map(([name, description]) => ({ name, description })),
    example: {
      type: 'generated',
      generator,
      sketch: '<sketch>',
      operands: Object.fromEntries(spec.operands.map((operand) => [operand.field, `<${operand.kinds.join('|')}>`])),
      // required parameters only, from the example of the entry; the others have defaults
      params: { ...spec.example },
    },
  }));
}

export function featureCatalog(): FeatureDescription[] {
  return Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => ({ type, ...info }));
}

export function apiDescription(): {
  conventions: string[];
  features: FeatureDescription[];
  generators: GeneratorDescription[];
  constraints: ConstraintDescription[];
  expressions: ReturnType<typeof expressionSyntax>;
  numericFields: ReturnType<typeof numericFields>;
  sketchTools: SketchToolDescription[];
  queries: QueryDescription[];
  operations: QueryDescription[];
  catalogs: ReturnType<typeof dataCatalogs>;
  exports: ReturnType<typeof exportFormats>;
  imports: ReturnType<typeof importFormats>;
  sections: ReturnType<typeof documentSections>;
  entries: EntryKindDescription[];
  types: string;
} {
  return {
    conventions: CONVENTIONS,
    features: featureCatalog(),
    generators: generatorCatalog(),
    constraints: constraintCatalog(),
    expressions: expressionSyntax(),
    numericFields: numericFields(),
    sketchTools: sketchToolCatalog(),
    queries: queryCatalog(),
    operations: hostOperations(),
    catalogs: dataCatalogs(),
    exports: exportFormats(),
    imports: importFormats(),
    sections: documentSections(),
    entries: entryKinds(),
    types: engineTypes(),
  };
}

// The kinds of entries of `external` of a sketch, from the registry of the engine (D68): the type,
// whether it is computed before the solver (reference geometry, which constraints may name) or after
// it (derived geometry, which they may not), the summary, the numeric fields with their ranges
// (`fieldsOf` of a sketch holding the example) and the example, an entry over the fixture of the
// section.
export interface EntryKindDescription {
  type: string;
  title: string;
  source: 'reference' | 'derived';
  summary: string;
  fields: string[];
  example: { id: string; ref: unknown };
}
export const ENTRY_KIND_FIXTURE =
  'The examples are entries of the sketch `top` on the top face of the box `box` (an extrusion of the rectangle `b1`..`b4` of the sketch `base`), which has a rectangle `l1`..`l4` and a construction line `cl`; each is the `id` and `ref` of addExternal `{ type: "addExternal", sketch: "top", id, ref }`.';
export function entryKinds(): EntryKindDescription[] {
  return (Object.keys(REFERENCE_KINDS) as EntryKindName[]).map((type) => {
    const kind = REFERENCE_KINDS[type];
    const sketch: SketchFeature = { ...emptySketch('top', 'top', { kind: 'base', plane: 'XY' }), external: { [kind.example.id]: kind.example.ref } } as SketchFeature;
    return {
      type,
      title: kind.title,
      source: kind.source,
      summary: kind.summary,
      fields: fieldsOf(sketch).map((field) => `${field.path} (${fieldText(field.spec)})`),
      example: kind.example,
    };
  });
}

// The sections of the document (D48): what each holds, the commands that change it and its numeric
// fields, from the registry of the engine.
export function documentSections(): { section: string; title: string; summary: string; commands: string[]; fields: string[] }[] {
  return Object.entries(SECTION_INFO as Record<string, SectionInfo>).map(([section, info]) => ({
    section,
    title: info.title,
    summary: info.summary,
    commands: [...info.commands],
    fields: info.fields.map((field) => `<${field.owner}>/${field.path} (${fieldText(field.spec)})`),
  }));
}

// The sketch tools of the engine (the tool sketch_tool runs them): inputs and the IDs they return.
export interface SketchToolDescription {
  tool: string;
  title: string;
  summary: string;
  inputs: { name: string; description: string; required: boolean }[];
  ids: { name: string; description: string }[];
  example: Record<string, unknown>;
}
const TOOL_EXAMPLES: Record<SketchToolName, Record<string, unknown>> = {
  rectangle: { first: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, opposite: { at: [40, 30] } },
  polygon: { center: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, vertex: { at: [3.2, 0] }, sides: 6, sizeKind: 'acrossFlats', size: 5.5 },
  // the corner `opposite` of the example of the rectangle, drawn into an empty sketch
  fillet: { corner: 'p1', radius: 5 },
  // the three below after the rectangle of its example and a line `x` from (20, 15) to (60, 15)
  // across its right side: the part of `x` outside goes (found by the place alone); `x` grows to
  // the left side; both are cut. `repair: 'on'` cuts the other crossings of the outline too, as an
  // AI that means to extrude the sketch passes it
  trim: { at: [50, 15], repair: 'on' },
  extend: { curve: 'x', end: 'a', repair: 'on' },
  split: {},
  // into the sketch after an earlier sketch `base` on a parallel plane that holds the rectangle of
  // the example of `rectangle`: an own outline over its four lines, held on their projections
  projectSketch: { sketch: 'base', entities: ['c1', 'c2', 'c3', 'c4'], as: 'own' },
};
export function sketchToolCatalog(): SketchToolDescription[] {
  const describe = (input: SketchToolInput): string =>
    input.kind === 'anchor'
      ? 'anchor `{ at: [x, y], snap? }`'
      : input.kind === 'point'
        ? 'the ID of a point of the sketch (an own point or `origin`)'
        : input.kind === 'option'
          ? `one of ${input.options.map((option) => `"${option}"`).join(', ')}`
          : input.kind === 'curve'
            ? `the ID of a curve of the sketch${input.reference ? ' (an own curve, or reference geometry: a projected edge, an axis `origin/x` or `origin/y`)' : ' (an own curve)'}`
            : input.kind === 'place'
              ? 'a place `[x, y]` in the sketch (coordinates; nothing snaps to it)'
              : input.kind === 'sketch'
                ? 'the ID of an earlier sketch of the document'
                : input.kind === 'entities'
                  ? `IDs of points and curves of the sketch \`${input.of}\`, as its get_sketch or the query sketchSources lists them`
                  : `a number, ${rangeText(input.spec)}${input.spec.unit === 'count' || input.spec.unit === 'none' ? '' : `, ${input.spec.unit}`}${input.expression ? ', or an expression' : ''}`;
  return (Object.keys(SKETCH_TOOLS) as SketchToolName[]).map((tool) => ({
    tool,
    title: SKETCH_TOOLS[tool].title,
    summary: SKETCH_TOOLS[tool].summary,
    inputs: Object.entries(SKETCH_TOOLS[tool].inputs).map(([name, input]) => ({ name, description: describe(input), required: input.kind === 'anchor' || input.kind === 'point' || input.kind === 'sketch' || input.optional !== true })),
    ids: Object.entries(SKETCH_TOOLS[tool].ids).map(([name, description]) => ({ name, description })),
    example: TOOL_EXAMPLES[tool],
  }));
}

// An argument of a query, of an export format or of an operation of the app, in words: what its
// description (`ArgKind` of the engine) says a caller writes.
export function argumentText(spec: ArgKind): string {
  const entity: Record<string, string> = {
    body: '{ kind: "body", body }',
    face: '{ kind: "face", body, face: FaceName }',
    edge: '{ kind: "edge", body, edge: EdgeName }',
    sketchPoint: '{ kind: "sketchPoint", sketch, point } (the point `origin` is the origin of the sketch)',
  };
  // a nested entry may say what it is for; its summary follows in brackets
  const named = (fields: { readonly [name: string]: ArgKind & { optional?: boolean; summary?: string } }): string =>
    Object.entries(fields)
      .map(([name, field]) => `${name}${field.optional ? ' (optional)' : ''}: ${argumentText(field)}${field.summary ? ` (${field.summary.replace(/\.$/, '')})` : ''}`)
      .join('; ');
  switch (spec.kind) {
    case 'number':
      return `a number, ${rangeText(spec.spec)}${spec.spec.unit === 'count' || spec.spec.unit === 'none' ? '' : `, ${spec.spec.unit}`}${spec.spec.default === undefined ? '' : `, default ${spec.spec.default}`}`;
    case 'flag':
      return 'true or false';
    case 'text':
      return 'a text';
    case 'choice':
      return `one of ${spec.options.map((option) => `"${option}"`).join(', ')}`;
    case 'body':
    case 'feature':
    case 'sketch':
      return `the ID of a ${spec.kind}`;
    case 'constraint':
      return `the ID of a constraint of the sketch given in \`${spec.of}\``;
    case 'entity':
      return `an entity of the model: ${spec.accepts.map((kind) => entity[kind]).join(' or ')}`;
    case 'plane':
      return 'a plane (PlaneRef)';
    case 'axis':
      return 'an axis (AxisRef)';
    case 'vector':
      return 'three numbers [x, y, z]';
    case 'list': {
      const count = spec.min !== undefined && spec.max !== undefined ? `, ${spec.min} to ${spec.max} items` : spec.min !== undefined ? `, at least ${spec.min}` : spec.max !== undefined ? `, at most ${spec.max}` : '';
      return `a list${count}, each item ${argumentText(spec.of)}`;
    }
    case 'oneOf':
      return `an object with exactly one of these keys: ${named(spec.options)}`;
    case 'record':
      return `an object with a value per ${spec.keys === 'text' ? 'name' : `${spec.keys} ID`}, each ${argumentText(spec.of)}`;
    case 'fields':
      return `an object { ${named(spec.fields)} }`;
  }
}

// The queries of the engine's catalog (the tool query asks them): arguments and what each returns.
export interface QueryDescription {
  query: string;
  title: string;
  summary: string;
  args: { name: string; description: string; required: boolean }[];
  returns: string;
}
export function queryCatalog(): QueryDescription[] {
  return Object.entries(QUERIES as Record<string, AnyQuery>).map(([query, spec]) => ({
    query,
    title: spec.title,
    summary: spec.summary,
    args: Object.entries(spec.args).map(([name, arg]) => ({ name, description: `${argumentText(arg)}${arg.summary ? `. ${arg.summary}` : ''}`, required: arg.optional !== true })),
    returns: spec.returns,
  }));
}

// The data catalogs of the engine by name; their rows are read with the query `catalog`.
export function dataCatalogs(): { catalog: string; title: string; summary: string }[] {
  return Object.entries(DATA_CATALOGS as Record<string, { title: string; summary: string }>).map(([catalog, table]) => ({ catalog, title: table.title, summary: table.summary }));
}

// The operations of the app (host.ts), each a tool of its own: arguments and what each returns.
// After the arguments of an operation `at` and `after`, which the path of every operation takes.
export function hostOperations(operations: HostOperationSet = HOST_OPERATIONS): QueryDescription[] {
  return Object.entries(operations).map(([query, spec]) => ({
    query,
    title: spec.title,
    summary: spec.summary,
    args: [
      ...Object.entries(spec.args).map(([name, arg]) => ({ name, description: `${argumentText(arg)}${arg.summary ? `. ${arg.summary}` : ''}`, required: !arg.optional })),
      ...Object.entries(OPERATION_STATE_ARGS).map(([name, description]) => ({ name, description, required: false })),
    ],
    returns: spec.returns,
  }));
}

// The export formats of the engine's catalog (the tool export writes them) with their options.
export function exportFormats(): { format: string; title: string; summary: string; options: { name: string; description: string }[] }[] {
  return Object.entries(EXPORT_FORMATS as Record<string, AnyExportFormat>).map(([format, spec]) => ({
    format,
    title: spec.title,
    summary: spec.summary,
    options: Object.entries(spec.options).map(([name, option]) => ({ name, description: `${argumentText(option)}${option.summary ? `. ${option.summary}` : ''}` })),
  }));
}

// The import formats of the engine's catalog (the tool import_mesh reads them) with their extensions
// and options.
export function importFormats(): { format: string; title: string; summary: string; extensions: string[]; options: { name: string; description: string }[] }[] {
  return Object.entries(IMPORT_FORMATS as Record<string, AnyImportFormat>).map(([format, spec]) => ({
    format,
    title: spec.title,
    summary: spec.summary,
    extensions: [...spec.extensions],
    options: Object.entries(spec.options).map(([name, option]) => ({ name, description: `${argumentText(option)}${option.summary ? `. ${option.summary}` : ''}` })),
  }));
}

// Tentýž popis jako souvislý text: tak ho dostane AI.
export function apiText(): string {
  const { conventions, features, generators, constraints, expressions, numericFields: fields, sketchTools, queries, operations, catalogs, exports, imports, sections, entries, types } = apiDescription();
  const queryText = (entry: QueryDescription): string =>
    [`- ${entry.query} (${entry.title}): ${entry.summary}`, ...(entry.args.length ? ['  args:', ...entry.args.map((arg) => `  - ${arg.name}${arg.required ? '' : ' (optional)'}: ${arg.description}`)] : ['  args: none']), `  returns: ${entry.returns}`].join('\n');
  const sketchToolText = (entry: SketchToolDescription): string =>
    [
      `- ${entry.tool} (${entry.title}): ${entry.summary}`,
      '  input:',
      ...entry.inputs.map((input) => `  - ${input.name}${input.required ? '' : ' (optional)'}: ${input.description}`),
      '  ids in the result:',
      ...entry.ids.map((id) => `  - ${id.name}: ${id.description}`),
      `  example of input: ${JSON.stringify(entry.example)}`,
    ].join('\n');
  const generator = (entry: GeneratorDescription): string =>
    [
      `- ${entry.generator} (${entry.title}): ${entry.summary}`,
      `  operands: ${entry.operands.map((operand) => `${operand.name}: ${operand.kinds.join(' | ')}`).join(', ')}`,
      '  params:',
      ...entry.params.map((param) => `  - ${param.name}${param.required ? ' (required)' : ''}: ${param.description}`),
      ...(entry.refs.length ? ['  refs:', ...entry.refs.map((ref) => `  - ${ref.name} (${ref.title}): ${ref.summary}`)] : []),
      `  side faces: ${entry.sides.join(', ')}`,
      '  facts in the feature result:',
      ...entry.facts.map((fact) => `  - ${fact.name}: ${fact.description}`),
      `  example: ${JSON.stringify(entry.example)}`,
    ].join('\n');
  const feature = (entry: FeatureDescription): string => {
    const body = entry.bodies === 'self' ? ' Může vytvořit těleso se svým ID.' : entry.bodies === 'derived' ? ' May create bodies with the IDs `<id>/<number>`.' : '';
    const update = entry.updatable.length > 0 ? ` updateFeature mění pole: ${entry.updatable.join(', ')}.` : ' Obsah mění vlastní příkazy, ne updateFeature.';
    return `- ${entry.type} (${entry.title}): ${entry.summary}${body}${update}`;
  };
  const constraint = (entry: ConstraintDescription): string => {
    const operands = entry.operands.map((operand) => `${operand.field}: ${operand.kinds.join(' | ')}`).join(', ');
    const value = entry.value ? `; value: ${entry.value.rule}, ${entry.value.unit}` : (entry.values ?? []).map((named) => `; ${named.name}: ${named.rule}, ${named.unit}`).join('');
    return `- ${entry.type} (${entry.title}) { ${operands}${value} }: ${entry.summary}\n  příklad: ${JSON.stringify(entry.example)}`;
  };
  return [
    '# Konvence',
    ...conventions.map((line) => `- ${line}`),
    '',
    '# Features',
    'Feature je objekt `feature` příkazu addFeature; přesný tvar je v typech níže.',
    ...features.map(feature),
    '',
    '# Profile generators',
    'A generator builds the profile of an extrusion from entities of a sketch and parameters: `profile` of the extrusion is `{ type: "generated", generator, sketch, operands, params, refs }`. Numeric parameters are numeric fields at `profile/params/<name>`.',
    ...generators.map(generator),
    '',
    '# Vazby a kóty',
    'Vazba je objekt `constraint` příkazu addConstraint. Operandy jsou ID entit skici daného druhu; kóty mají navíc `value` a `driving`.',
    ...constraints.map(constraint),
    '',
    '# Expressions',
    expressions.syntax,
    'Functions:',
    ...expressions.functions.map((fn) => `- ${fn.signature}: ${fn.summary}`),
    'Constants:',
    ...expressions.constants.map((constant) => `- ${constant.name}: ${constant.summary}`),
    '',
    '# Sections of the document',
    'Parts of the document beside the timeline, keyed by an ID; a change of one recomputes no geometry, but for a stored mesh, which the mesh features that place it read. Each is changed by its own commands (shapes in the types below) and read from `evaluation` of the state and from get_model.',
    ...sections.map((entry) => [`- ${entry.section} (${entry.title}): ${entry.summary}`, `  commands: ${entry.commands.join(', ')}`, ...(entry.fields.length ? [`  numeric fields: ${entry.fields.join('; ')}`] : [])].join('\n')),
    '',
    '# Entries of a sketch',
    'The entries of `external` of a sketch (commands addExternal, updateExternal with the whole entry in its input form, removeExternal; setField on the sketch for one number). Reference geometry is computed before the sketch is solved and may be constrained to; derived geometry is computed after it and may not. ' + ENTRY_KIND_FIXTURE,
    ...entries.map((entry) =>
      [
        `- ${entry.type} (${entry.title}, ${entry.source === 'reference' ? 'reference geometry' : 'derived geometry'}): ${entry.summary}`,
        ...(entry.fields.length ? [`  numeric fields of the example: ${entry.fields.join('; ')}`] : []),
        `  example: ${JSON.stringify(entry.example)}`,
      ].join('\n'),
    ),
    '',
    '# Numeric fields',
    'Fields that accept an expression instead of a number. The field address (`path`) is the key in `expressions` of the feature and the argument of the command setField; a field of an entry of a section is given in its command (setBodyProperties) and keeps its expression in `expressions` of the entry under the field name.',
    ...fields.map((field) => `- ${field.owner}: ${field.path} (${field.description})`),
    '',
    '# Sketch tools',
    'A sketch tool draws a whole shape with its constraints from a few inputs; run it with the tool sketch_tool `{ sketch, tool, input }`. An anchor is a place in the sketch, `{ at: [x, y] }`, optionally snapped: `snap: { kind: "point", id }` uses that point (an own point or `origin` is used as it is, a point of projected geometry gets a new point with a coincident constraint; `at` must still be given, a rough position is enough, and the place of the point is used) and `snap: { kind: "curve", id }` puts the point on that curve nearest to `at`. The result lists the IDs of what was made (`ids`), to be used in the next commands: the lines as regions of an extrusion, a line for a horizontal constraint, the size dimension for setField.',
    'A tool may also change what is drawn: the fillet re-points two lines (setCurvePoint) and changes the features of the document that read them in the same batch (`updateFeature`); its `ids` say which features it changed and which to look at, and the answer of sketch_tool lists the problems of the model after the batch, so run it with `preview: true` first when the sketch carries other features.',
    'A profile with crossing curves (a circle drawn across an outline, an imported sketch) is repaired by `split` without a curve (every crossing becomes a common point, constraints kept, the regions of the features followed) and then `trim` of the pieces that should go, each by a place on it (`at`, without `curve`); `extend` moves an end of a line or an arc to the next curve. The query sketchContacts says where the curves meet and what cannot be cut. An AI that computes its own end points does not need the tools.',
    ...sketchTools.map(sketchToolText),
    '',
    '# Queries',
    'A query reads the model and changes nothing; ask it with the tool query `{ query, args, at?, after? }`. `at` is a feature ID (the state after it); `after` is a command to preview first, so that a change can be asked about without being written. ' +
      'An answer is the result, or an error with a code: invalidArguments (an argument has the wrong shape or range), notAvailable (something named is not in the state asked about), failed (the computation gave up).',
    ...queries.map(queryText),
    '',
    '# Operations of the app',
    'What only the running app can do. Each is a tool of its own, named as here, with these arguments; without a connected app it answers notAvailable. Every operation takes `at` and `after` as the tool query does: its other arguments are checked in that state and it works on it, and nothing is written.',
    ...(operations.length ? operations.map((entry) => [`- ${entry.query} (${entry.title}): ${entry.summary}`, ...(entry.args.length ? ['  arguments:', ...entry.args.map((arg) => `  - ${arg.name}${arg.required ? '' : ' (optional)'}: ${arg.description}`)] : ['  arguments: none']), `  returns: ${entry.returns}`].join('\n')) : ['(none yet)']),
    '',
    '# Catalogs',
    'Tables of data the engine carries; read one with the query `catalog` `{ name, key? }`. A catalog fills in fields: the document stores the numbers, not a reference to a row.',
    ...(catalogs.length ? catalogs.map((entry) => `- ${entry.catalog} (${entry.title}): ${entry.summary}`) : ['(none yet)']),
    '',
    '# Export formats',
    'The tool export `{ format, path, options?, overwrite?, at?, after? }` writes the model in one of these formats (it needs a disk, so it is a tool of the server). Bodies are exported as modelled. All options are optional unless said otherwise.',
    ...exports.map((entry) => [`- ${entry.format} (${entry.title}): ${entry.summary}`, ...(entry.options.length ? ['  options:', ...entry.options.map((option) => `  - ${option.name}: ${option.description}`)] : ['  options: none'])].join('\n')),
    '',
    '# Import formats',
    `The tool import_mesh \`{ path, format?, options?, id?, name? }\` reads a file of one of these formats into a stored mesh (it needs a disk, so it is a tool of the server); without \`format\` the extension of the path decides. The file has to hold a closed solid; the import leaves out the walls between solids stacked in the file and turns over shells written inside out, and refuses anything else that is not closed. At most ${MESH_LIMITS.triangles} triangles.`,
    ...imports.map((entry) => [`- ${entry.format} (${entry.title}, .${entry.extensions.join(', .')}): ${entry.summary}`, ...(entry.options.length ? ['  options:', ...entry.options.map((option) => `  - ${option.name}: ${option.description}`)] : ['  options: none'])].join('\n')),
    '',
    '# Typy (TypeScript, ze zdroje enginu)',
    'Příkaz je hodnota typu Command; dokument typu Document.',
    '```ts',
    types.trim(),
    '```',
  ].join('\n');
}
