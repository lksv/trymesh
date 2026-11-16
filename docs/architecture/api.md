# Architecture: the API of the engine

Part of [architecture.md](../architecture.md), the design as implemented. The facade, queries, export formats, bodies, the commands and their validation.

## API enginu

```ts
interface Engine {
  execute(cmd: Command): CommandResult;          // změní dokument, jeden krok undo
  preview(cmd: Command, at?: Id): CommandResult; // spočítá, ale nezapíše; at = jen po danou feature
  undo(): void;
  redo(): void;
  getState(at?: Id): EngineState;                // at = stav modelu po dané feature, dál se nepočítá
  diagnoseSketch(sketch: Id): SketchDiagnosis;   // viz Diagnostika skici
  explainConstraint(sketch: Id, constraint: Id): ConstraintExplanation;
  load(json: string): CommandResult;
  save(): string;
  exportMesh(format: 'stl', bodies?: Id[]): Uint8Array;   // without a list the printed bodies (D48); '3mf' později
  interference(options?: { bodies?: Id[]; threshold?: number; at?: Id }): InterferenceReport;   // see Bodies below
  query<N extends QueryName>(name: N, args: QueryArgs<N>, options?: QueryOptions): QueryOutcome<QueryResult<N>>;   // see Queries below
  export<F extends ExportFormat>(format: F, options: ExportOptions<F>, queryOptions?: QueryOptions): QueryOutcome<Exported>;   // see Export formats below
  subscribe(listener: (state: EngineState) => void): () => void;
}

interface EngineState {
  document: Document;
  evaluation: Evaluation;
  canUndo: boolean;
  canRedo: boolean;
}

type CommandResult =
  | { ok: true; state: EngineState }
  | { ok: false; error: { code: 'invalidCommand' | 'invalidDocument'; message: string; commandIndex?: number;
      expression?: { path?: FieldPath; parameter?: string; check?: string; error: ExpressionError } } };   // a rejected expression: where and why
```

### Queries (D37)

A query reads the model and changes nothing. Queries are a catalog `QUERIES` (`query/index.ts`), built like the registry of feature types: a query is a module in `query/` and one line of the catalog, and `Engine.query(name, args, options)` is the one way in for every query added from now on. The three methods that were queries before (`diagnoseSketch`, `explainConstraint`, `interference`) stay for their callers: each keeps its own checks of its arguments and its own texts and throws, and then runs the entry of the catalog that `query` runs, so the computation and its cache are shared and the messages are not. The catalog today: `interference`, `sketchDiagnosis`, `constraintExplanation`, `body` and `catalog`.

```ts
type QueryOptions = { at?: Id } | { state: EngineState };   // now, after a feature, or a state this engine handed out
type QueryOutcome<Result> =
  | { ok: true; result: Result }
  | { ok: false; error: { code: 'invalidArguments' | 'notAvailable' | 'failed'; message: string; arg?: ArgPath } };
type EntityRef =                                            // "this thing of the model" in the arguments of a query
  | { kind: 'body'; body: Id }
  | { kind: 'face'; body: Id; face: FaceName }
  | { kind: 'edge'; body: Id; edge: EdgeName }
  | { kind: 'sketchPoint'; sketch: Id; point: Id };
```

**An entry** (`QuerySpec` in `query/spec.ts`) has a title, a summary and a text on what it returns (all three go to the description for the AI), the description of its arguments, optionally the keys of its result that a tool prints to significant digits (`significant`) and the keys whose numbers have a unit (`units`: what `returns` says in words, for a program; a generic form writes the unit and shows an angle in degrees), and `run(context, args)`. Its result is plain JSON. The types of the queries are a map by name, `Queries`, that a query module extends by declaration merging (`declare module './spec' { interface Queries { … } }`), so a new query edits no shared type; the catalog is typed by the map.

**Arguments** (`query/args.ts`) are named and described, and the checks, the description for the AI and a form in the app come from the description: a number with unit and range, a flag, a text, a choice, the ID of a body, a feature or a sketch, a constraint of the sketch named next to it, a reference to an entity with the kinds it accepts, a plane (`PlaneRef`), an axis (`AxisRef`), a vector, and four ways to build structure: a list with a least and a greatest count, exactly one of several named alternatives (`{ up: [0, 0, 1] }`), a record by key (IDs of bodies or features, or free names) and named fields. An alternative and a field may carry a `title` (for a form) and a `summary` (for a form and for the description for the AI) of their own; without them they are known by their keys. The type of the arguments is derived from the description (`ArgsOf`), so the two cannot disagree; `run` gets the same type with the defaults of optional numbers filled in at every depth (`RunArgsOf`). A description is written `as const satisfies ArgSpecs`.

**Before `run`** the engine checks every argument against its description and fills in the defaults (`checkArgs` in `query/check.ts`). An error names the argument by its path, a list of names and indexes (`['orientations', 1, 'by', 'onBed']`).

| Code | When |
|---|---|
| `invalidArguments` | the shape or the range is wrong, or the query has no such argument; `state` is not a state this engine handed out; there is no such query. Also from `run` (`QueryFailure`), for arguments that do not go together in a way their description cannot say: a direction of length zero, a list that names one body twice |
| `notAvailable` | something named is not in the state asked about. One rule for every ID wherever it sits: a body, a face, an edge is looked up in the bodies of the state; a feature, a sketch, a constraint, a sketch point among the features the state evaluated. A mistyped ID and one that comes after `at` are the same answer. Also `at` that names no feature From `run`: something named is there, but not in the form the query needs (a sketch that did not evaluate has no points to measure to) |
| `failed` | the computation gave up: `run` threw `QueryFailure`, or the kernel threw inside a query |

A number is checked against its own description only: the limit of ±1e9 on numbers of the document does not apply. A sketch that did not evaluate is in the document, so it is a valid argument, and its diagnosis is `unavailable`: what was a successful answer stays one. An exception of another kind inside `run` is a defect and passes through, as it does for commands.

**The state.** A query answers for one state and never recomputes it: the current one, the one after a feature (`at`), or one that `preview` or `getState` returned (`state`), so a parameter can be stepped by previews and each step asked about with nothing written. The engine keeps, for every evaluation it hands out, the state of the recompute it was made from and the document it belongs to, by the identity of the evaluation and weakly. A state put together by a caller, or one of another engine, is refused, and the document is the one the engine kept, so an evaluation cannot be paired with another document. A drag preview is diagnosed as dragged.

**The context** (`QueryContext`) is what `run` reads:

| Member | What it gives |
|---|---|
| `state` | the document and the evaluation, without the bodies and the surfaces |
| `bodies`, `surface(body, face)` | the geometry of bodies. A query reads it nowhere else, so that it answers for bodies moved to a pose once the mechanism of step 5 exists; a surface is asked by body and face because one face number can lie in two bodies |
| `frame(ref)`, `axis(ref)` | the frame of a `PlaneRef` (for a face the normal points out of the body) and the line of an `AxisRef`, or the code the recompute gives for the same reference (`brokenReference`, `nonPlanarFace`) |
| `face(name)`, `sketch(id)` | the number of a named face; what the recompute kept about a sketch (`SketchState`), undefined when it did not evaluate |
| `kernel` | the geometric kernel; an exception of it becomes the answer `failed` |
| `memo(owners, key, compute)` | a result kept for as long as all its owners live (both solids for a pair of bodies, the evaluated sketch for a diagnosis). Owners that live across recomputes are a solid, an evaluated sketch, the document, a section or a feature of it; the order of the owners does not matter, and the keys of different queries are kept apart |

What does not belong to a body is never posed: a sketch and its points, an axis through a sketch point, a plane feature, a base plane or axis.

**The description of a body** (`body`, `query/body.ts`) is what the MCP tool `get_body` used to compute for itself, moved into the engine so that the app and other queries can use it: for every face its name, its surface, its area, for a planar face the unit normal out of the body (`meshNormal`, the sum of the normals of its triangles) and for a cylinder or a cone whether the material is on the side of the axis (`convex`: a pin, or a hole; one more pass over the triangles, because the normals of a full cylinder sum to zero); for every edge its name, its length, the number of its segments and its shape: the two ends of a line and whether a cut interrupts it, and the circle of a circular edge (centre, axis, radius). The circle is that of the surfaces of the two faces of the edge (`circleBetween` in `surfaces.ts`), not a fit to its vertices: it is exact, does not change with the chord tolerance, and an arc of two segments has it as well (D39). The description is kept by the mesh. `get_body` keeps its own check that the body exists and its text, and prints the faces and the edges of the query with its own rounding and labels.

**Measuring** (`measure`, `query/measure.ts`, D39) is asked about two entities, each a face or an edge of a body or a sketch point. The answer has two parts that answer different questions.

- *What each entity is* (`EntityShape`, resolved by `entityShape` in `query/entity.ts` from the surfaces, the frames of faces and the solved sketches of the context, never from a fit to the mesh): a point, a line (the edge of two planar faces: the line of the two planes, with its ends from the mesh along that line), a circle (the circle of the two surfaces of a circular edge), a plane with its normal out of the body, a cylinder or a cone with `convex` from the description of the body, a swept surface (gear teeth: a direction and no position), or `other`.
- *The exact part*, in double precision. Each shape has a reference, which a distance is taken to, and may have a direction:

  | Shape | Reference | Direction |
  |---|---|---|
  | point | the point | none |
  | line | the line | along it |
  | circle | its centre | its axis |
  | plane | the plane | the normal out of the body |
  | cylinder, cone | the axis | the axis |
  | swept | none | the direction it was swept along |
  | other | none | none |

  `distance` is between the two references, taken without their ends and never negative; for two lines the common perpendicular, and for a line and a plane or two planes only when they are parallel within `ANGLE_TOLERANCE` (otherwise they cross somewhere and zero would say nothing about the two faces). What counts as parallel is measured along the direction between the two, so the answer is the same whichever entity is named first. So two cylinders give the distance of their axes, and a hole beside a wall how far its axis is from the wall. `angle` is between the two directions: for two planes between the normals out of the bodies, 0 to π (π: the two sides of a wall); for a plane and a line between the line and the plane, 0 to π/2; otherwise between two lines, 0 to π/2. `facing` tells a wall from a slot of the same width for two planar faces that look opposite ways: `away` (each lies behind the other) or `towards`; it is absent when the planes coincide within the precision of the coordinates.
- *The measured part*, `smallest`: the smallest distance between the two entities as they are on the bodies, with their outlines and ends, and the two points it lies between. It is a pass over the triangles of the two faces (the segments of an edge, the point), so every pair has it, a face of gear teeth included. `accuracy` estimates its difference from the exact shapes. For a hole beside a wall `distance` is the axis to the wall and `smallest` the material left between them.

A pair without an exact answer gets `smallest`, `angle` when both entities have a direction, and no `distance`; nothing is fitted to the mesh to make up an exact-looking number.

**The section** (`section`, `query/section.ts`, D38) is what a plane cuts out of the bodies: per body its area, the number of its closed loops and its regions (an outer loop and the holes in it), with the points in the x and y of the cutting plane. The plane is a `PlaneRef` with an `offset` along its normal and a `flip`; the frame of the answer is the plane as asked for. It is one pass over the triangles of a body and uses no kernel, which is what keeps the name of the face under every piece of a loop.

- *The pass* (`cut`). The heights of the vertices are measured from the plane moved against its normal by the precision of the coordinates of the bodies asked about (`below` of the answer), and a vertex at zero or more counts as above. Every vertex is then on one side, every crossed triangle gives exactly one segment, directed so that the material is on its left, and the segments are chained by the mesh edges they end on, not by coordinates. The point on an edge is computed from its two vertices in a fixed order, so the two triangles of the edge share it. The mesh of a body is a closed surface, so every chain closes; a mesh that is not is answered as `failed`.
  - Why not at the plane itself: the vertices of a face that lies in the plane are in float32, to either side of it as soon as the body is not aligned with the axes, and the section would be a random part of that face. The consequence is stated in the answer: a body that ends in the plane from below shows that face, one that starts in it shows nothing, and `inPlane` names the bodies with a planar face in the plane (one face each).
- *The corners* (`corners`). A side face is a strip of quads of two triangles, so half of the points of a chain lie on diagonals. The points that are not corners are dropped, by the precision of the coordinates of the body being cut (not of all bodies asked about, and not a fixed length), in fixed steps:
  1. a point nearer than the precision to the last point kept goes, and its segment starts at the point kept; the walk starts at the point of the chain that is first in the exact order of u, then v;
  2. the points where the face changes are kept; a loop on one face is walked from the point furthest from the mean of its points and then starts at the corner of that walk furthest from the mean of those corners;
  3. from each kept point the next is the furthest one such that every point between lies within the precision of the straight segment to it, so the polygon of the corners stays within the precision of the points step 1 left however slowly a curve turns (and within twice the precision of a point step 1 dropped);
  4. what is thinner than the precision is dropped: a loop left with fewer than three corners, or with an area under the precision times half its length (a sliver under an edge that lies in the plane).

  The list starts at the corner of step 2 that is first in the order of (u, v), where two u within the precision count as the same, and the loops of a body are in the order of their first points (the first of those left, again and again). So neither depends on where the mesh starts a chain. On a division of a face into other triangles the corners of a polygon stay, with two reservations: a real corner that lies within the precision of the segment to a point of the mesh just past it is stood for by that point, and on a curve that turns slowly the corners follow where the list starts. `area` and `length` are those of the chain before points are dropped.

  The search of step 3 costs one step per point on a straight run: the points between narrow the directions a segment may still take, a point outside them is ruled out, the search ends when none is left, and a point inside them that is at least as far as every point between needs no distance measured.
- *The spans.* A loop is cut into runs that lie on one face, and what a run is follows from the surface of the face and how the plane meets it (within `ANGLE_TOLERANCE`), not from a fit:

  | Surface | The plane meets it | Span |
  |---|---|---|
  | plane | any way | line |
  | cylinder | across the axis | arc: centre, radius, sweep |
  | cylinder | along the axis | line |
  | cone | across the axis | arc |
  | swept | along the direction of the sweep | line |
  | anything | otherwise | curve: the number of its points and its length, and the points while they fit the budget |

  The ends of a span are corners of the mesh, so the spans of a loop join exactly; the centre and the radius of an arc are those of the surface. The sweep is summed along the corners of the run, and is exactly ±2π for a whole circle.
- *The budget* (`maxPoints`, 500 by default) counts items: a span, a point, a loop written as a polyline. It is spent in two rounds, each over the bodies in their order: first the outlines, then the lists of points, each whole or not at all, so the points of an early body never cost a later one its outline. `truncated` says how much was listed of how much.
- *For whoever draws a cut:* `outline: 'polylines'` gives every loop as its polygon; `takenAt(result)` is the plane the section was taken at, which is where the model is clipped and the fills are laid, and `completeRegions(result)` gives the regions with their bodies only when nothing was left out, because a region filled without one of its holes would show material across a cavity.

**The gap** (`gap`, `query/gap.ts`, D40) is how close bodies are to each other, pair by pair: for every pair of the bodies asked about (all of them without `bodies`; two bodies are one pair) that is closer than the search distance `within` (5 mm by default), its smallest distance and where it is. Pairs further apart are counted in `apart`, not measured. `pairs` come the closest first and are limited by `maxPairs`; `close`, `apart`, `refused` and `checked` count all of them.

- *One pair.* Boxes at least `within` apart are apart without a computation. Otherwise the distance is the pass over the two meshes (`closest`, below) within `within`, which also gives the two points and the face each lies on (`between`); where a point lies on a rim the face named is the one that faces the other body, so the wall of a bore and not the cap it ends in: the feature to change. `accuracy` is `meshAccuracy` over the two bodies.
- *A distance of zero* is one no larger than the precision of the coordinates of the pair; such a pair is close whatever the search distance, also one below that precision. What kind of zero it is comes from `interference` over the same pair, as `contact`: `collision`, `fit`, `touching` (flush faces, or less than that query reports) or `unknown` (the kernel could not compute what they share).
- *A body inside the material of another.* The pass sees surfaces only, and the surfaces of such a pair do not meet. So a pair whose surfaces do not meet is asked of `interference` as well, which costs a call of the kernel only when the boxes of the two overlap: a shared volume makes it a distance of zero with the contact `collision`. A body in a closed cavity of another shares nothing with it and has its distance to the wall. When the kernel fails on that question the pair is listed in `failed`, neither close nor apart: its distance would be a guess.
- *The kernel port is not extended for it.* `minGap` of the library answers the same question, without the two points; measured on the joint of scenario 9 and on a model of 73 bodies it was not noticeably faster than the pass with `interference`, and slower at a larger search distance (the table is in the design of D40), and it would have cost a method with a guarantee of its own on a port every kernel has to keep.
- The answer for a pair is kept by its two meshes, so after a change of the model only the pairs with a changed body are measured again; what a pair shares is kept apart from the search distance. What is kept names neither a body nor a face (the distance, the two points, the numbers of the two faces, and which mesh the first point lies on); the IDs and the names are read from the state asked about, and the answer handed out is a new object every time. The work is bounded by the arguments: every pair of `bodies`, each within `within`; `maxPairs` limits the answer only.

**The mass** (`mass`, `query/mass.ts`, D41) is the mass, the centre of mass and the inertia of the listed bodies taken as one rigid piece (a link of a mechanism; one body is a list of one). Lengths are millimetres and masses grams, so an inertia is in g·mm² (1 g·mm² is 1e-9 kg·m²).

- *The integrals* (`massIntegrals`) are one pass over the triangles of a body, by signed tetrahedra as the volume is summed: the volume, the centroid and the six second moments about the centroid, for a density of one. They are summed from a vertex of the mesh, not from the origin of the model, so a body far from the origin loses no digits. They are kept by the mesh. A group is put together from its bodies by the parallel axis theorem, each body with its own density. No kernel is needed.
- *The density of a body* comes from three places, in this order: `densities` of the call, by body; the body's own from the document (`massSourceOf`, which is undefined for every body until body properties exist: package 3a of D36 fills in that one function, with a density or an explicit mass); `density` of the call, for every body that has neither. A body with none is refused at `density`. A density is above zero and at most 1000 g/cm³, and a mass that comes out zero or not finite is refused: the answer never holds a number that is not one.
- *The fill factor* (`fill`, above 0 up to 1) goes with `density` only: it scales the bodies that take the fallback and no other, so a motor given in `densities` is not made lighter by the infill of the printed parts. A fill factor other than 1 that reaches no listed body is refused, not ignored. It assumes the material is spread evenly; the answer lists for every body the density of its material and the fill factor applied, so that mass (g) = density (g/cm³) × fill × volume (mm³) / 1000 can be checked.
- *The inertia* is the tensor about the centre of mass in the axes of the model, as three rows, with the negative products of inertia off the diagonal: what URDF and MJCF take as it is when the frame of a link keeps the orientation of the model. It does not depend on where the origin of the model is.
- *About an axis* (`about`, an `AxisRef`): the moment of inertia about that axis and the perpendicular distance of the centre of mass from it. The distance is geometry only, not the lever of the weight, which needs a direction of gravity the model does not have.
- Bodies that overlap are counted twice; `interference` says whether they do. The numbers are those of the mesh: a body with round faces weighs a little less than its exact shape.

**The print check** (`print`, `query/print.ts`, D42) says how a body prints in given orientations: its box against a bed, the area that lies on the bed and the area that overhangs, per named face. Every body asked about (all of them without `bodies`) is a print of its own and is judged in every orientation (one to twelve), so the answer is a table of bodies by orientations that an AI can pick from per part.

- *An orientation* says what is up: `up`, a direction in the coordinates of the model, or `onBed`, a planar face that lies on the bed (up is the opposite of its normal out of the body). A face gives the direction for every body of the call; for the body it belongs to the answer says whether the face really lies on the bed (`onBed`: false when something of the body reaches below it). `turn` turns the body about the vertical, which changes only the box.
- *The print frame* is fixed by a rule, so the same question gives the same box: for a direction, x is the X axis of the model laid into the bed (the Y axis when up is within 45° of X); for a face, the x of its frame. The bed is at the lowest point of the body. `fits`, with a `bed` of three lengths, is the height and the footprint either way round, within the precision of the coordinates.
- *The pass* (`printPass`) is one pass over the triangles of a body, without a kernel. A triangle of a planar face looks where its face looks: the normal of the face out of the body, which the engine knows exactly (`context.frame`); only a triangle of a face that is not planar is judged by its own normal. (A long thin triangle of a flat face has a normal that float32 coordinates spoil by more than `ANGLE_TOLERANCE` once the body is not along the axes.)
- *Contact*: a planar face as a whole, with all its area, when it looks straight down within `ANGLE_TOLERANCE` and nothing of the body reaches beyond its plane by more than the precision of the coordinates. Both tests are needed (a body thinner than the precision has its top and sides that low too). What is below a face is measured along the normal of that face, not along `up`: a direction typed with five digits then neither lifts the far end of a large face off the bed nor leaves only the lowest of several faces in one plane (the ends of three pins). A round face never counts: a cylinder on its side touches the bed in a line, and the facet of its polygon is not a contact.
- *Overhang*: what looks down and leans from the vertical by more than the overhang angle (45° by default; the angle of the normal below the horizontal) and is not contact, per named face with its area and the height above the bed where it starts (`from`). A face at exactly the angle is not one (`ANGLE_TOLERANCE`), so a chamfer drawn at 45° on purpose does not come back because of the last digit. An overhang of a face below `minArea` (1 mm²) is in the totals and counted in `small`, not listed.
- *The size of the answer*: each of the two lists of a body in an orientation holds at most `maxFaces` (20) faces, the largest first and faces of one area (to six digits, what float32 coordinates give) in the order of their numbers, with the count of all of them next to it; `truncated` says how many faces were listed of how many, over the whole answer.
- It does not know bridges, wall thickness, supports, or whether a part stands.

**Distances on the mesh** (`mesh-distance.ts`), shared by the queries that measure:

- `closest(a, b, within?)` is the smallest distance of two parts of the mesh (a point, the segments of an edge, the triangles of a solid or of one face of it) with the two points and, for triangles, the two faces.
  - Two pieces: the least of every corner against the other piece and every side against every side, and zero where a side of one goes through the other. Without the last test two triangles that cross through their insides come out apart, and two faces of colliding bodies would measure a distance. A part wholly inside a closed solid without touching its surface is not found this way; whether two bodies share a volume is the question of `interference`.
  - The pass is quadratic in the worst case. It starts from a bound (the smallest distance among about fifty pieces of each part, or `within`), drops every piece whose box is further than that from the box of the whole other part, and walks the rest along the longest axis so that a piece meets only the pieces near it there. It stops at the first distance of zero. Two whole bodies of the joint of scenario 9 (some 1800 triangles against 900 to 5300) take from ten to a few hundred milliseconds. A triangle without an area is as close as its nearest side. `within` is a bound: a pair further than it is not found.
  - Where the closest point lies on an edge or a corner of a body, triangles of several faces are equally close (within `LENGTH_TOLERANCE`); among the pairs within the tolerance of the answer the face named is the one that faces the other part most directly, so the wall of a bore is named and not the cap it ends in; faces that face it equally go by the smaller number, and a pair that touches names its own faces.
- `coordinatePrecision(...bodies)` is how precisely a coordinate of the mesh is known: a millionth of the largest coordinate of the bodies concerned (coordinates are single precision), a millionth of a millimetre at least. The interference of bodies uses the same measure for its depths.
- `meshAccuracy(context, bodies)` estimates how far a distance measured on the mesh may be from that of the exact shapes: one chord tolerance of the document for each listed body that has a face which is not planar, plus the precision of the coordinates. A body with only planar faces has only straight edges; a planar face of any other body may end in the polygon of an arc, so it counts. It is an estimate and is called one: above the caps on the number of segments the mesh no longer keeps the chord tolerance.

**Data catalogs** (`data-catalogs.ts`) are tables of data the engine carries: hardware, materials, threads. A catalog has a title, a source (the standard or the data sheet), columns with units and rows by key; every catalog has its own columns. Code reads `DATA_CATALOGS` and gets the row type of the catalog it names, so a column that does not exist does not compile; a caller that is not typed asks the query `catalog` (`name`, optionally `key`), which answers with the table without its row type. The rule of D36 holds: a catalog fills in fields, the document stores the numbers. `describe_api` lists the catalogs by name and summary only. The engine has no catalog yet: a package adds one as a module with its row type, a line in the map `Catalogs` and an entry of `DATA_CATALOGS`.

**Guards.** `packages/mcp/test/queries.test.ts` has two tables typed by the map of queries, so a query without a row does not compile: arguments of the query's own type, which the test runs through the MCP tool `query`, and every argument with whether a caller may leave it out, which the test compares with the entry (a description handed over in a variable could carry an argument the type does not have). The test also checks that `of` of a constraint names a required sketch next to it.

### Export formats (D37)

An export format is an entry of the catalog `EXPORT_FORMATS` (`export/index.ts`), built like a query: a title, a summary, a description of its options in the vocabulary of query arguments (`ArgSpecs`), and `run` over the context of a query. The type of the options follows from the description, and the map `ExportFormats` is extended by declaration merging in the module of the format. A new format is a module in `export/`, a line of the catalog and its rows in the two typed tables of `packages/mcp/test/export-formats.test.ts`; nothing in `Engine`, in `packages/mcp` or in the description for the AI changes.

```ts
interface Exported { layout: 'file' | 'directory'; files: ExportFile[]; empty?: string }
interface ExportFile { path: string; mediaType: string; bytes: Uint8Array; about?: Record<string, unknown> }
```

- **A format returns files**, because a robot description is several files in folders and an outline is not a mesh. `layout` says what the caller's path is: `file` is exactly one file, written to the path the caller names (the `path` of the file is then only a suggested name); `directory` is a set written under the folder the caller names.
- **The form of a path is the engine's to guarantee** (`exportPathProblem`): relative, with forward slashes, every segment non-empty and not `.` or `..`, no backslash, no path twice, no path that is also a folder of another. `runExport` checks the result of every format; a format that breaks the form, or returns a `file` layout with another number of files than one, is a defect and throws. What depends on the disk (the length of a name, names that differ only in the case of letters, names a system reserves) is the writer's to refuse.
- **`about`** says what a file holds, as plain JSON for the answer of a tool (`bodies` and `triangles` for STL).
- **`empty`**: an export that holds nothing worth writing says why (`the model has no body to export`). It is not an error of the format (`exportMesh` of an empty list gives a file without triangles); a caller that writes files refuses with the text.
- **`Engine.export(format, options, queryOptions)`** answers like `query`: the state is chosen by `at` or `state`, the options are checked against the description of the format with the same checker (`invalidArguments`, `notAvailable` with the path of the option), a `QueryFailure` of the format becomes the answer, and nothing throws for a wrong input. The context of a format always has the bodies as modelled.
- **`stl`** (`export/stl.ts`): options `bodies` (each once, in the order of the list, whatever their use; without it the printed bodies, `printedBodies` of the body properties (D48); an empty list is refused) and `perBody`. A model whose bodies are all reference or auxiliary bodies exports nothing and says so in `empty`. One file `model.stl`, or with `perBody` a set with a file per body named `bodyFileName(id).stl`. `exportMesh('stl', bodies?)` keeps its checks and its texts and returns the bytes of the same entry.

### Bodies: volume, export and interference (D35, point 5)

**Volume and bounds.** `BodyResult` carries `volume` (mm³) and `bounds` (`min` and `max` of the box along the axes of the model). They are computed with the faces and edges of the body and remembered by the identity of its mesh. A caller that cannot see the model (AI through MCP) checks with them what it built.

**Export.** `exportMesh('stl', bodies?)` writes the listed bodies in the order of the list, each once; without a list the printed bodies (the use `part` of the body properties, D48; all bodies of a document without properties). A body that does not exist throws: it is the caller's mistake, like `getState` with an unknown feature. `bodyFileName(id)` gives a file name for one body: letters, digits, dot, dash and underscore stay and every other character becomes `%XX` per byte of its UTF-8 form, the percent sign included, so two IDs never give one name (`planets/1` is `planets%2F1`). Names that differ only in the case of letters, names too long for a file system and names a system reserves are left to the caller that writes files.

**Interference.** `interference({ bodies?, threshold?, at? })` answers which bodies share a volume.

```ts
interface Interference { a: Id; b: Id; volume: number; depth: number }   // `a` is the smaller ID in string order
interface InterferenceReport {
  pairs: Interference[];                               // collisions: above the threshold and not a fit
  fits: Interference[];                                // above the threshold, no deeper than the chord tolerance, with a round face
  failed: { a: Id; b: Id; message: string }[];        // the kernel could not compute the pair
  checked: number;                                    // pairs examined
}
```

- Every pair of the chosen bodies (all by default) is examined, in the order of the bodies in the model; `at` asks about the state after a feature.
- The volume is that of the kernel's `intersection` of the two meshes. A pair is reported above the threshold, 0.001 mm³ by default: in the spike flush faces, a pin in the hole cut by the same circle and identical cylinders gave exactly zero, and gears with a negative backlash of 0.05 mm gave 0.5 to 1.7 mm³. The kernel has a floor of its own: an overlap thinner than about a millionth of the size of the two bodies is welded away and counts as touching, whatever the threshold. The size is the larger of the diagonal of the pair and twice its largest coordinate, so planar faces have to overlap by about two millionths of the largest coordinate: 0.006 mm between plates at x = 5000 is nothing, 0.02 mm is a collision.
- **Collision or fit.** Round faces are polygons. A pin in a hole of the same diameter coincides with the wall only when the two polygons have the same vertices (the same sketch circle, or both turned the same way). A pin drawn on a plane that looks the other way, or a copy turned by a pattern, has its corners between the corners of the hole and shares slivers with the wall: up to a quarter of the chord tolerance times the area of the fit, 0.6 mm³ for a pin of radius 4 and length 10, hundreds of times the threshold. Each reported pair therefore has a `depth`: how deep one body reaches into the other. A pair is a fit (`fits`) when its depth is at most the chord tolerance of the document, what the two bodies share has a face that is not planar, and no planar face of one body reaches into a planar face of the other; every other pair is a collision (`pairs`). A shared volume no deeper than the precision of the coordinates is not a pair at all, whatever its size: large flush faces of turned copies share a fraction of a mm³ at a depth of 0.00001 mm. The corner of a pin of the same diameter is in the wall by the sagitta of the polygon at most, which the chord tolerance bounds. A real overlap of round faces that shallow lands among the fits too: the faceted model cannot tell the two apart (a pin thicker than its hole by less than the tolerance is a fit or a collision by how the two polygons are turned). Planar faces have no polygons to blame, so their overlap is a collision however shallow, also beside a round face: a disc lying 0.005 mm inside the top of a plate, a pin 0.005 mm too long for its blind hole. A round face that reaches into a planar one by less than the tolerance stays a fit. Two round faces that bulge towards each other (two shafts side by side) each lack up to the sagitta of their polygon, so their real overlap may be about twice the tolerance before it is a collision, and under one tolerance the meshes may not meet at all.
- **The depth** (`depthOf` in `interference.ts`) is the larger of two measures, because each alone misses something (the second review of point 5 found the cases):
  - *How far one body reaches into the other* (`penetration` in `solid.ts`): every point of the surface of the shared volume lies on the surface of one of the bodies, and its distance to the surface of the other one says how deep it is inside it. The largest such distance over the vertices, the middles of the edges and the centroids of the triangles of the shared mesh is taken. The same over the points of a planar face whose nearest face of the other body is planar too is the planar part of the depth, which a fit must not have. A point does not count for it when a round face of the body it is in lies within the tolerance: the end of a sliver is a point of the cap of a pin inside the plate, exactly as near to the floor of a blind hole (or to the top of the plate under a collar, or to the seat of a counterbore) as to the wall of the hole, and a pin standing out of its hole by less than the sagitta has the top of the plate nearer than the wall. Without this every turned pin that ends on a planar face of the other body was a collision (the fourth review). What it lets through is an overlap of planar faces that lies wholly within the tolerance of a round face, a lip narrower than about twice the tolerance. A key on a pin, a rib between flush blocks or a pin too long for its hole show with their real depth whatever else the pair shares. The measure is zero where the two surfaces coincide all around a volume: two identical bodies.
  - *The mean thickness* of the thickest connected piece of the shared volume, twice the volume of the piece over its surface, finds that case. It is taken piece by piece (pieces are joined by shared edges; touching at a vertex does not join them) so that a lump both bodies have is not thinned out by the slivers of a fit elsewhere. The kernel leaves sheets without thickness in an intersection where faces of the two bodies coincide (a pin in the hole cut by its own circle gives a shared mesh of zero volume and the area of the wall twice); they are left out of the surface, or they would thin the mean out. Looking for them compares every triangle with every other, so it is done only when the pair would otherwise pass as a fit. The two sides of a sheet have the same coordinates, so a sheet is looked for within a thousandth of the precision of a depth: with the precision itself as the tolerance, real slivers that thin lost their surface and came out forty times too thick (pins of radius 25 whose polygons nearly coincide were a collision).
  - Alone, the mean thickness hid real overlaps: a key of 1 mm³ next to the wall of a fit or next to coincident faces came out thinner than the tolerance.
  - Coordinates are single precision, so a depth is known to a millionth of the largest coordinate of the two bodies: that slack is added to the tolerance, and it is the depth below which a pair is not reported.
  - The cost is the distance from every point looked at to the triangles of both bodies near the shared volume: unnoticeable at the default tolerance, about two seconds for one pair of a pin of radius 4 at a chord tolerance of 0.0001 (3500 triangles shared). The answer is remembered with the pair.
- The kernel gives no guarantee for an intersection with flush faces and may throw after cleaning and verifying its result. Such a pair goes to `failed`: it is neither colliding nor clear, and the query itself never fails because of one pair. So does a pair whose intersection comes back with a volume that is not a number. Far from the origin the kernel fails more often, also at the default tolerance (a cylinder of radius 5 at x = 5000 that is 0.05 mm inside the side of a plate).
- Bodies whose boxes do not overlap, or only touch, are not sent to the kernel.
- Computed pairs are remembered by the identity of the two meshes (`context.memo` of the query, `query/interference.ts`), so a repeated query is free and after a change only pairs with a rebuilt body are computed. Bodies replayed after the changed feature are rebuilt even when their shape is the same.
- An unknown body, a threshold that is not a non-negative number and an unknown `at` throw.
- The query reads the model and changes nothing; it is not a command and has no place in undo.

### Příkazy

Příkazy jsou čistá JSON data. ID nových entit generuje volající a posílá je v příkazu, takže dávka může na právě vytvořený bod odkázat hned v dalším příkazu.

```ts
type Command =
  // časová osa
  | { type: 'addFeature'; feature: Input<Feature>; index?: number }   // bez indexu na konec; Input: a numeric field may be an expression
  | { type: 'removeFeature'; id: Id }
  | { type: 'moveFeature'; id: Id; index: number }
  | { type: 'renameFeature'; id: Id; name: string }
  | { type: 'setSuppressed'; id: Id; suppressed: boolean }
  // rovina, extrude (skica má vlastní příkazy níže)
  | { type: 'updateFeature'; id: Id; patch: FeaturePatch }
  | { type: 'setField'; feature: Id; path: FieldPath; value: number | Expr }   // one numeric field by its address; adds an optional field the feature does not have
  // parameters and checks
  | { type: 'setParameter'; name: string; expr: Expr; index?: number }         // creates or changes
  | { type: 'renameParameter'; name: string; to: string }                      // rewrites expressions too
  | { type: 'removeParameter'; name: string }
  | { type: 'setCheck'; name: string; expr: Expr; index?: number }
  | { type: 'renameCheck'; name: string; to: string }
  | { type: 'removeCheck'; name: string }
  // skica
  | { type: 'setSketchPlane'; sketch: Id; plane: PlaneRef }
  | { type: 'addPoint'; sketch: Id; id: Id; x: number; y: number }
  | { type: 'addCurve'; sketch: Id; id: Id; curve: Curve; radius?: number }   // radius u kružnice
  | { type: 'removeEntity'; sketch: Id; id: Id }                              // bod nebo křivka
  | { type: 'setConstruction'; sketch: Id; id: Id; construction: boolean }
  | { type: 'addConstraint'; sketch: Id; id: Id; constraint: Input<Constraint> }
  | { type: 'removeConstraint'; sketch: Id; id: Id }
  | { type: 'setConstraintValue'; sketch: Id; id: Id; value?: number | Expr; driving?: boolean }
  | { type: 'dragPoint'; sketch: Id; point: Id; x: number; y: number }
  | { type: 'addExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'updateExternal'; sketch: Id; id: Id; ref: ExternalRef }
  | { type: 'removeExternal'; sketch: Id; id: Id }
  // body properties (D48), a section of the document; see the document
  | { type: 'setBodyProperties'; body: Id; patch: BodyPropertiesPatch }   // null removes a field
  | { type: 'setBodyMaterial'; body: Id; material: string }                // a row of the catalog materials
  | { type: 'removeBodyProperties'; body: Id }
  // složený
  | { type: 'batch'; commands: Command[] };
```

**`updateFeature` je slučovací změna.** `patch` obsahuje jen pole, která se mění, ve stejném tvaru jako feature; `{ extent: { distance: 12 } }` změní vzdálenost a začátek nechá být. Pravidla:

- Vnořený objekt se s dosavadním slučuje po polích, pokud je to táž varianta (`type` změna neuvádí, nebo je stejný). Jiná varianta dosavadní hodnotu nahradí celou a musí být úplná. A generated profile with another `generator` is another variant too.
- The dictionaries of a generated profile (`operands`, `params`, `refs`) merge by entry: `{ profile: { params: { rotation: 'deg(5)' } } }` leaves the other parameters with their expressions. `null` removes an entry: a parameter returns to its default and loses its expression (a required one cannot be removed), a reference ceases to exist. Removing an entry that is not there is not an error.
- A profile of regions takes its offset the same way: `{ profile: { offset: 2 } }` sets it and `{ profile: { offset: null } }` removes it, also from a feature that did not have it (an optional numeric field, D44). The curves of a wall are a list and are replaced whole; each curve the feature did not have before is verified as an own curve of the sketch.
- Odkaz (objekt s polem `kind`: `PlaneRef`, or the `AxisRef` of a pattern) a seznam se nahrazují celé. Půlka odkazu (objekt bez `kind` tam, kde odkaz je) je neplatný příkaz: sloučení by vybralo jinou stěnu téhož tělesa.
- `null` volitelné pole odebere (`targets: null`). Pole s hodnotou `undefined` (jen z kódu, v JSON není) znamená „neměnit".
- Pole, které výsledná feature nemá (překlep, pole jiné varianty rozsahu), je neplatný příkaz, ne úspěch bez účinku.
- Měnit jde jen pole, která typ feature v registru vyjmenovává (rovina `base`, `offset`; vysunutí `profile`, `extent`, `operation`, `targets`; a pattern `source`, `transform`). ID, jméno, potlačení a typ feature mají vlastní příkazy nebo se nemění; skica se mění jen svými příkazy.
- Přechod na `operation: 'new'` cíle zahodí, pokud je změna sama neuvádí.
- Výsledná feature se ověří celá. Odkazy na jiné features se ale ověřují jen ty, které feature dosud neměla (jiné místo, druh nebo ID): oprava rozbitého odkazu na skicu nesmí narazit na rozbitý cíl, který změna nechává být, a změna vzdálenosti projde i u feature, jejíž skica byla smazána. Platí to i tehdy, když změna dosavadní odkaz zopakuje (formulář aplikace posílá vysunutí celé) nebo mění jen operaci.

**Validace.** Každý příkaz se před provedením ověří. Neplatný příkaz dokument nezmění a vrátí `invalidCommand` s popisem. Dávka je atomická: neplatný kterýkoli příkaz zruší celou dávku a `commandIndex` říká, který to byl. Validace pracuje jen se strukturou dokumentu, přepočet k ní není potřeba. Ověřuje se:

- **ID** nových entit jsou jedinečná a splňují konvence: bez `/`, ne `origin`, ne prázdné a ne jméno vlastnosti, kterou má každý objekt (`constructor`, `toString`…), protože ID jsou klíče záznamů.
- **Odkazy uvnitř skici** musí vést na existující entity správného typu (vazba `parallel` dostala dvě úsečky). Křivka odkazuje na vlastní body nebo `origin`. Vazba smí odkazovat i na promítnutou geometrii; její odvozené entity plynou z `kind` (`<id>`, `<id>/a`, `<id>/b` u úsečky, `<id>`, `<id>/center` u kružnice). Protože mazání ve skici kaskáduje, platí toto pravidlo v každém dokumentu.
- **Odkazy mezi features** se ověřují tam, kde je příkaz nastavuje (`addFeature`, `updateFeature`, `setSketchPlane`, `addExternal`, `updateExternal`): cílová feature existuje, má správný typ a leží před odkazující feature. U stěny a hrany se takto ověřuje těleso i extrude, které stěnu pojmenovalo (stěna existuje až po něm). Odkaz na těleso vede na feature, která ho vytvořila (část ID před lomítkem), a ta musí těleso toho místního jména vytvářet. `moveFeature` nesmí feature přesunout před feature, na kterou odkazuje, ani za feature, která odkazuje na ni.
- **Odkaz na feature, která v dokumentu není, validaci neporušuje.** Vzniká povoleným `removeFeature` a projeví se až při přepočtu jako `brokenReference`, `noProfile` nebo `brokenProjection`. Totéž platí pro jména stěn a hran a pro ID křivek v `regions`: ta se strukturálně ověřit nedají a rozbíjejí se běžnými úpravami.
- **Vazba musí mít aspoň jeden operand, kterým solver může hýbat.** Řídicí vazbu jen mezi pevnými entitami (počátek, promítnutá geometrie) solver tiše ignoruje, takže by se nikdy neprojevila ani jako konflikt; je proto neplatná. Referenční kóta mezi pevnými entitami platná je.
- **Stejná řídicí vazba nesmí být ve skice dvakrát.** `addConstraint` odmítne vazbu se stejným typem a stejnými operandy, jaké už má jiná geometrická vazba nebo řídicí kóta; u vazeb s operandy `a`, `b` na jejich pořadí nezáleží. Platí to i pro kótu s jinou hodnotou (upravit se má ta stávající) a pro přepnutí referenční kóty na řídicí. Referenční kóta smí měřit totéž co řídicí. `load` duplicity přijímá, aby šly otevřít starší dokumenty; ukáže je diagnostika a hodnotu takové kóty jde dál měnit. Druhy operandů, jejich zaměnitelnost a pravidla hodnot jsou v katalogu vazeb (`engine/src/catalog.ts`), kterým se validace řídí.
- **Hodnoty.** Čísla jsou konečná a v rozsahu ±1e9; záporná nula se ukládá jako nula. `extent.distance` u extrude není nula a `profile.regions` není prázdné (tatáž oblast dvakrát je jedna oblast). `add` has exactly one body in `targets`, `cut` one or more without repeats, `new` none. The extent `throughAll` is accepted only with `cut` and needs `side`. Poloměr nové kružnice je kladný. Hodnoty kót splňují konvenci znamének.
- `origin` a odvozené entity promítnuté geometrie nejde smazat ani jimi táhnout.

Příkaz, který je strukturálně v pořádku, ale vede k chybě přepočtu (konfliktní vazba, zaniklá stěna), se provede a problém se objeví ve stavu feature.

**Chování fasády:**

- **Krok undo vzniká jen změnou obsahu dokumentu.** Přejmenování na stejné jméno nebo tažení plně určeného bodu historii nezaplní.
- **Tažení, které solver nevyřeší,** dokument ani stav enginu nezmění; konflikt z neúspěšného pokusu ukáže jen `preview`.
- **A command of a section of the document** (body properties) makes an undo step like any other: `differs` compares the sections too (`sectionsDiffer`).
- **`getState(at)` s neznámou feature vyhodí výjimku; `preview(cmd, at)`** vrátí `invalidCommand`, když `at` v dokumentu po příkazu není. Tichý přepočet celé osy by zakryl chybu volajícího.
- **Posluchači (`subscribe`)** dostanou stavy v pořadí, v jakém vznikly, i když některý z nich sám zavolá engine: vnořená změna se rozešle až po dokončení právě běžícího kola. Výjimka posluchače ostatní o zprávu nepřipraví a vyhodí se až nakonec; stav je v té chvíli už zapsaný.
- **Nový bod a nová křivka ruší razítko řešení skici,** protože zapisují řešené proměnné přímo. Skica se pak při přepočtu vyřeší znovu, i kdyby se otisk vstupů solveru shodoval.

**Pravidla mazání:**

- `removeEntity` kaskáduje: smazání bodu odstraní křivky, které na něm stojí, a smazání bodu nebo křivky odstraní vazby, které na ně odkazují. Křivky v `regions` pozdějších extrude zůstanou a extrude skončí v `noProfile`.
- `removeExternal` odstraní vazby na promítnutou křivku a její odvozené body. Vlastní křivky na promítnuté body neodkazují, takže se jich mazání netýká.
- `updateExternal` zachová ID, takže vazby zůstanou. Smí změnit hranu, ne `kind`: změna druhu by změnila odvozená ID. Kdo chce místo úsečky kružnici, promítnutí smaže a vytvoří nové.
- `removeFeature` nekaskáduje: závislé features zůstanou a skončí v chybě. Opravit je jde bez ztráty ID: `updateFeature` umí u vysunutí změnit i zdrojovou skicu (spolu s novým výběrem oblastí) a cíl, u roviny základ; `setSketchPlane` rovinu skici.

**`load`** brings the document to the schema of this build and then checks the same rules over the whole document. The current schema version is 3.

**The schema is a list of named upgrade steps (D37, `schema.ts`).** `UPGRADES` holds the steps in order; on `master` the version a build saves is their number plus one. A step changes only the shape of the raw document, before the validation, which judges the content.

| Step | Version | What it does |
|---|---|---|
| `d35-profiles-and-parameters` | 1 → 2 | An extrusion gets `profile`, `extent` with a zero start and the list `targets`; the document gets `parameters` and `checks` (what is there anyway is kept for the validation to judge) |
| `d37-schema-steps` | 2 → 3 | Converts nothing. A build from before the list accepts version 2 and rebuilds the document from the fields it knows, so it would strip a document of a branch without a word; from version 3 on it refuses |
| `2b-taper` | 3 → 4 | Converts nothing (D45). A build without it would drop the field `extent/taper` of an extent on load; with the step it refuses a document that may hold one. Merged 2026-11-16 |
| `3a-body-properties` | 4 → 5 | The section `bodyProperties` (D48): a document without the field gets `{}`; a field that is there, whatever it holds (`null` included), is left to the validation. A build without the step would drop the section on load; with it, it refuses the document. Pending on the branch `d36/3a` until its merge (the branch saves version 4 with `schemaSteps: ['3a-body-properties']`) |

- **When a step is needed.** For a change of the shape of what older documents hold, and for anything a build without it would drop without a word: `validateDocument` rebuilds a document from the fields it knows, so an unknown section, an unknown field directly on a feature and an unknown field of an extent are gone after a load. Such an addition gets a step even when it converts nothing. No step is needed where a build without the addition refuses by itself: a new feature type, a new variant, a field where the validator lists the fields it allows.
- **A step reads and changes only what its package owns**, or what is on `master` already, so steps of different packages give the same document in either order.
- **The list only grows at its end.** The steps `master` has are never reordered or renamed: the version of a document counts them by position. A branch that is merged puts its steps after everything `master` has by then (a rebase does that; a merge has to be checked). The test pins the names of the steps in their order.
- **Branches.** Two branches cannot both raise the version. A branch appends its steps and counts them in `SCHEMA_PENDING` (the steps at the end of the list that `master` does not have yet). A build with pending steps saves the version of the `master` it started from and the names of its pending steps in `Document.schemaSteps`; the merge sets the count to zero, and `master` never writes the field.
- **Loading, in every build:** take the steps from the version of the document on, leave out the ones the document names, run the rest in the order of the list. Refused, with a message that says which: a version above the one this build saves, and a name that is not among the steps after the version of the document. So a document saved on a branch loads on that branch after a rebase over another merged step (the other step runs, its own does not run twice) and on `master` once the branch is merged; `master` before the merge and a build of another branch refuse it.
- A test (`packages/engine/test/schema.test.ts`) runs these cases with lists made up for it, and checks the real list (`schemaProblems`: unique names, a count of pending steps that fits).

Převod mění jen tvar, takže převedený dokument dává bitově stejný model a vyřešené skici se neřeší znovu; `save` ukládá vždy současnou verzi. Odkazy na neexistující features jsou přípustné (viz výše), takže dokument, který vznikl povolenými příkazy, jde vždy uložit a znovu načíst, i když obsahuje features v chybě. Neplatný dokument se nenačte, stav enginu se nezmění a vrátí se `invalidDocument`. Po načtení se vyřešené skici zapíší do dokumentu stejně jako po `execute` a historie undo se smaže.

### Co z API vzešlo z návrhu UI (D24)

- **`batch`**: nakreslení úsečky s automaticky odvozenými vazbami musí být jeden krok undo.
- **`addFeature` s pozicí**: vložení feature doprostřed logu.
- **`getState(at)` a `preview(cmd, at)`**: úprava feature uprostřed logu zobrazuje model v tom okamžiku a nepřepočítává features za ní.
- **Data pro výběr**: stěny s příznakem rovinnosti, hrany s úsečkami a druhem, oblasti skici se smyčkami.

Výběr myší: renderer zjistí index trojúhelníku, přes `faceIds` číslo stěny a přes `faceNames` jméno, které pošle zpět v příkazu. Hrany a oblasti analogicky.

**Web Worker.** Vše, co přes API prochází, jsou serializovatelná data. API je ale synchronní, takže přesun enginu do Workeru znamená asynchronní obal nad stejnými příkazy a stavem, ne nulovou změnu. V PoC běží engine v hlavním vlákně.
