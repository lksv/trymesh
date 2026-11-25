# Architecture: the recompute

Part of [architecture.md](../architecture.md), the design as implemented. The replay of the features, its cache and the states of errors.

## Recompute

In the code the recompute is a method of the class `Evaluator` (`evaluate.ts`), which holds the cache; it gets the adapters when it is created. The class does what every feature type shares (the cache, the values of expressions, a suppressed feature, a failed expression) and calls the step of the type through the registry: `specOf(feature).step(feature, context)`, where the context (`StepContext`) carries the state before the feature, the settings, the adapters, the callbacks `done` and `failed`, and for the sketch the drag target and the fields whose expression failed; for a module with the member `input` (the mesh feature, D55; the insertion, D62) the object of the document outside the feature that its step reads (`input`); and `insertion(doc)`, the recompute of another document by the same evaluator, which an insertion asks for its stored document ([insert.md](insert.md), "The recompute of a stored document"). The state carries `insertions` (per insertion its entry, the environment of its parameters and its recompute, so a later insertion with the same entry and environment takes the same recompute) and `inserted` (per inserted body what it passes on to the body properties). The signature describes the inputs and the output:

```ts
function evaluate(doc: Document, deps: { solver; kernel }, opts?: {
  upTo?: Id;                                                        // stop at this feature
  drag?: { sketch: Id; point: Id; target: { x: number; y: number } };   // dragging a point, see Solving the sketch
}): Evaluation;

interface Evaluation {
  features: Record<Id, FeatureResult>;
  bodies: Record<Id, BodyResult>;           // the state after the last evaluated feature
  faceNames: FaceName[];                    // the shared table, index = face number
  faceSurfaces: Surface[];                  // the surface of every face, same index (D37)
  parameters: Record<string, ParameterResult>;   // values and errors of parameters
  checks: Record<string, CheckResult>;           // 'ok' | 'failed' | 'error' by check name
  bodyProperties: Record<Id, BodyPropertiesResult>;   // by body of the state (D48), see the document
  mechanism: MechanismResult;                         // the mechanism resolved against this state (D49), see the document
}

interface BodyResult {
  solid: Solid;
  faces: { id: number; planar: boolean }[];             // the faces the body has
  edges: { name: EdgeName; kind: 'line' | 'circle' | 'coplanar' | 'other'; segments: Float64Array }[];   // segments: line segments, 6 numbers per segment
  volume: number;                                       // mm³
  bounds: { min: Vec3; max: Vec3 };                     // the box of the body along the axes of the model
}

interface Issue { code: IssueCode; message: string; refs?: unknown[] }

type IssueCode =
  // errors: the feature has no result
  | 'brokenReference' | 'noProfile' | 'invalidProfile' | 'nonPlanarFace'
  | 'emptyResult' | 'kernelFailure'
  | 'invalidExpression'            // an error everywhere except a sketch, where it is a warning
  | 'invalidExtent'                // an extent up to a plane cannot reach it (D47)
  | 'invalidHole'                  // the dimensions do not make a hole (D46)
  | 'invalidPattern'               // a grid of more than 200 places, or with two places in one (D53)
  | 'invalidClearance'             // a tool of a combine cannot be moved by its clearance (D56)
  | 'invalidAxis'                  // an axis of no length, or for a revolve not in the plane of its profile or with the profile on both sides of it (D58)
  // warnings: the feature has a result
  | 'sketchConflict' | 'brokenProjection' | 'degenerateProjection' | 'unsupportedProjection'
  | 'noEffect'
  | 'gearMesh' | 'gearInterference';   // from the gear generator, see Profile generators

interface FeatureResult {
  status: 'ok' | 'warning' | 'suppressed' | 'error';
  error?: Issue;                 // only with status 'error'
  warnings: Issue[];
  bodies: Id[];                  // bodies the feature created: an extrusion with `new` and a split their own, a pattern of a body its copies
  plane?: { origin: Vec3; x: Vec3; y: Vec3; normal: Vec3 };   // sketch, plane
  sketch?: {
    points: Record<Id, { x: number; y: number }>;   // the positions used, the projected ones included
    radii: Record<Id, number>;
    degreesOfFreedom: number;
    conflicting: Id[];
    redundant: Id[];
    measurements: Record<Id, number>;               // values of reference dimensions
    valid: boolean;                                 // false = curves cross, the profile is invalid
    regions: { ref: RegionRef; loops: Float64Array[] }[];   // for drawing and picking
  };
  fieldErrors?: Record<FieldPath, ExpressionError>;   // expression errors by field
  facts?: Record<string, number | boolean | Vec3>;    // what the profile generator published
  values?: Record<FieldPath, number>;                 // values of fields with an expression used in this recompute
}
```

- `evaluate` is a pure function of the document.
- The replay is linear from the first feature. The state after each feature is memoised by the identity of the feature object and the identity of the previous state, so an unchanged beginning of the log is not recomputed. With expressions the key is the resolved feature (see Parameters and expressions), so the identity changes only when a value of an expression changes. A module that reads an object of the document beside the feature names it by `input(feature, doc)` (D55: the mesh feature names its entry of `meshes`); the memo keeps the input with the step and uses a remembered step only when the input is the same object, so a change of anything else recomputes nothing there, and an entry added under an ID a feature already named recomputes it. `rehang` carries the input over to the new feature object.
- A feature in the state `error` acts as an empty operation and the replay goes on. What depends on it ends in an error too.
- A feature in the state `warning` has a result, and the features that depend on it work with it normally.
- A suppressed feature (`suppressed`) acts as an empty operation, the same as a feature in error. What depends on it ends in `brokenReference`, a projection in `brokenProjection`.
- **The sections of the document** (body properties, D48; the mechanism, D49) are evaluated after the timeline, with the parameters and the checks (`evaluateSections`): from the document, the bodies of the state, the environment of the parameters and the state of the recompute (the sketches, for the axis of a joint). The mechanism of a state after a feature (`at`) is resolved against that state: a body not made yet is missing, a joint whose axis comes later is in error there. Nothing in the timeline is recomputed for a change of one, except a mesh feature whose entry of `meshes` the change replaced (through `input`, above). `Evaluator.evaluate` returns, next to the write-backs of features, the sections whose numbers of expressions changed (`sections`), and `settle` of the engine puts them into the document in the same undo step. The last few results of every key are kept, so an equal result is the same object, also after a preview in between.
- **A body keeps its `Solid` object while no feature changes it** (D57): `applyTool` leaves the object of a target its tool did not change, a pattern of a body leaves its source, every step carries the other bodies over, and no step changes a solid in place; a feature that changes a body gives it a new object. The parts list rests on it: a copy made by `transformSolid` is one mesh with its origin for as long as both keep their objects (`shapeOrigin`, [api.md](api.md), the parts list). A new feature type has to keep to it.
- `upTo` ends the replay at the given feature. A preview while a feature in the middle of the log is edited therefore computes nothing after it.

**The table of face numbers.** Face numbers are part of the memoised state, not a property of one run. The state after each feature carries the table of names; a feature that creates new faces adds their names to the end of the table of the previous state. A face number is thus a function of the beginning of the log and holds even when the beginning is taken from the cache. There is one table shared by all bodies; the numbers are not stored in the document.

A dependency graph (skipping independent features) is a possible later optimisation.
