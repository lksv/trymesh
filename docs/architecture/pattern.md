# Architecture: the pattern

Part of [architecture.md](../architecture.md), the design as implemented. The pattern of bodies and of features.

## Pattern (D35, point 4)

A pattern repeats its source by a list of rigid transforms. The step asks one function for the transforms of the copies (`transformsOf` in `features/pattern.ts`, by the kind of `transform`; today `circular`) and the rest does not know the kind, so a linear pattern or a mirror is another kind and nothing else.

```ts
interface PatternFeature extends FeatureBase {
  type: 'pattern';
  source: { type: 'features'; features: Id[] } | { type: 'body'; body: Id };
  transform: { type: 'circular'; axis: AxisRef; count: number; span: { type: 'full' } | { type: 'angle'; angle: number } };
}
type AxisRef = { kind: 'base'; axis: 'X' | 'Y' | 'Z' } | { kind: 'sketchPoint'; sketch: Id; point: Id };
```

**Transforms.** `count` includes the original, so there are `count − 1` copies, numbered from 1. `full` turns copy `k` by `k · 2π / count`; `angle` is the angle between the first and the last copy, so the step is `angle / (count − 1)` and may be negative. A base axis goes through the origin of the model. `sketchPoint` is the normal of the sketch plane through a point of the sketch (an own point, `origin` or a point of projected geometry), read from the solved sketch. A positive angle turns counter-clockwise when seen against the axis (the right-hand rule): around the base axis Z it takes X towards Y. Around a sketch point it is counter-clockwise in the coordinates of that sketch, so a sketch on the base plane XZ, whose normal is −Y, turns the other way than the base axis Y. A transform is `RigidTransform` (`solid.ts`): the rows of an orthogonal matrix and a translation.

**Numeric fields.** `transform/count` is an integer from 1 to 200 (the bound keeps a typo in an expression from starting thousands of booleans) and `transform/span/angle` lies in [−2π, 2π] and is not zero; the angle exists only with the span `angle`. A count that an expression makes fractional is an error of the field (`notInteger`), not a rounding.

**A pattern of features.** The sources are extrusions with the operation `add` or `cut` (reference kind `tool`). For every copy, in the order of the copies, the tool of every source is built in the transformed position and applied to the targets of that source, in the order of the list.

- The recipe transforms the frame of the sketch plane and builds the prism there, it does not move a finished mesh. "Through all" is therefore measured along the direction the copy points in, against the targets as they are at the pattern: a hole turned by 90° passes the width of the body, and material added between the source and the pattern is cut as well.
- The triangulation of the profile is computed once per recipe and reused by every build.
- A source that is missing, suppressed or in error has no recipe: the pattern is `brokenReference` with the sources in `refs`. A source that ended with `noEffect` has one, because a turned copy can hit what the original missed.
- The pattern is atomic. When one application fails (`emptyResult`, `kernelFailure`, a missing target), the pattern is in error and the model stays as it was before it; `refs` start with `{ copy, feature }`. The message does not repeat the copy: a client names it from `refs` in its own words.
- Applications that changed none or only some of their targets are listed in one warning `noEffect` with `refs` of the shape `{ copy, feature, targets }`.
- A copy has no effect on a target when the volume of the target stays the same and, for a cut, the shape stays as well: either no face of the tool is in the result, or every face of the tool in it lies on the surface the target had (`onSurface` in `solid.ts`, by the centroids of the triangles). A copy that falls onto the original, as the last of five copies over an angle of 360° does, is therefore listed in `noEffect` and the hole keeps the faces of the original, while a copy that cuts a small corner off a large plate has an effect although the volume it removes is below the tolerance of the volume comparison (a millionth of the smaller of the two bodies). An extrusion that repeats a cut still counts whenever faces of its tool end up in the body.
- Time: every copy is one boolean per target on the body as it has grown so far, so the time of a pattern of features grows with the square of the count (about 10 s for 100 holes in a disc and 30 s for 200; a pattern of a body copies meshes and takes 0.3 s for 200 gear bodies). Joining the copies of one cut into a single boolean per target would make it linear and is not done.

**A pattern of a body.** The body in the state before the pattern is copied as new bodies `<pattern>/<number>`.

- The copy gets a new face number for every face the body has at that moment, whichever feature or earlier pattern it came from. The name is the old one with the copy tag appended and the analytic description is moved with the copy (`transformFace`), so the top of a copy is still a plane a sketch can stand on and the rim of its hole is still a circle.
- `transformSolid` moves the vertices and renumbers the faces; with a negative determinant (a mirror, later) it reverses the order of the triangle vertices.
- `FeatureResult.bodies` lists the copies in the order of their numbers. A feature that refers to a copy the count no longer reaches is `brokenReference`.
- What is added to the source after the pattern is not copied; what is moved before it is.
- The facts of a generated profile stay with the source feature; a copy publishes none.

**Derived body IDs.** The ID of a body is the ID of the feature that created it or `<feature>/<local name>` (`bodyOwner`). The registry decides whether a feature creates the body: a pattern does for a body source and a local name that is a number from 1 without leading zeros. Whether the copy with that number exists shows only in the recompute, because the count may be an expression. A dependency on a copy is a dependency on its pattern (`featureRefs`), so `moveFeature` keeps the pattern in front of what uses its copies.

**Copy tags.** A face of a copy carries `copy: [{ pattern, index }]`; a pattern of a pattern appends another tag, the latest last. Faces of the original have none, and an empty list is normalized to none, so one face has one spelling. A reference to such a face (the plane of a sketch, either face of a projected edge) is also a reference to every pattern in the list: validation requires each to be a pattern before the referring feature and the number an integer from 1. The key of a name used for comparing and ordering appends `/@<pattern>:<index>` per tag.
