// Sketch tools (D35, point 7): pure functions that turn a few inputs into a batch of sketch
// commands. The app calls them from its drawing tools and the MCP server offers them as one tool
// whose description is generated from the catalog below, so a tool added here is at both places.
// Nothing here touches the recompute: a tool reads the sketch, its solved positions and, to change
// the features that name its curves in the same batch (the fillet), the document.
import { MAX_NUMBER, type NumberSpec, checkNumber } from './catalog';
import { applyCommand, documentIds } from './document';
import { entityOf } from './references/index';
import { CURVE_POINTS, constraintOperands, duplicateOf } from './sketch-content';
import { evaluateNumber } from './expression';
import { namedBySections } from './sections/index';
import { toolBase } from './references/world';
import { type SolvedCurves, lineExtent, pointJoins, solvedCurves } from './sketch';
import { CUT_IDS, type CurveChanges, type ExtendInput, type SplitInput, type TrimInput, copiesByNames, copyAsSnap, copyInTool, copyParts, cutTool, SPLINE_NOT_CUT, entryCommands, entryPatches, namedOutside, profileSourceOf, readersOf } from './sketch-cut';
import { PROJECT_SKETCH_IDS, type ProjectSketchInput, projectSketch } from './sketch-project';
import type { Command, Constraint, Curve, CurvePointName, Document, Expr, FeaturePatch, FeatureResult, Id, ParameterResult, Point2, RegionRef, SketchFeature, SketchPattern, SketchResult, Vec2 } from './types';
import { ANGLE_TOLERANCE, LENGTH_TOLERANCE, ORIGIN, cross2, dist2, dot2, has, sub2, unreachable } from './util';

// A place in a sketch and what it should snap to. The app passes a click after snapping, an AI
// client coordinates or an existing point.
export interface Anchor {
  at: Vec2;
  snap?: { kind: 'point'; id: Id } | { kind: 'curve'; id: Id };
}

// The sketch a tool draws into, with its solved state: positions of points come from the result
// (projected geometry has them only there), otherwise from the document.
// `parameters` are the values of the parameters of the document (`evaluation.parameters`): with
// them a size given as an expression is drawn at its value, without them as clicked.
export interface SketchToolContext {
  sketch: SketchFeature;
  result?: SketchResult;
  parameters?: Record<string, ParameterResult>;
}

// Supplies IDs for new entities by a kind prefix (`p` point, `c` curve, `k` constraint). It must
// return IDs the whole document does not have; see `freshIds`.
export type NewId = (prefix: string) => Id;

// What `sketchTool` takes: the context of a sketch with the document it is in (D52) and the results
// of the features (`evaluation.features`, D69). A tool that changes curves other features name (the
// fillet) reads the document to change those features in the same batch; a tool that reads another
// sketch (projectSketch) reads its solved result and its plane in `features`, and the plane of its
// own sketch. Both are required, so that a fillet cannot be drawn without its patches and a caller
// that forgot the results is found by the compiler. The functions that never read a document
// (`placeAnchor`, `anchorPosition`, `nearestCurvePoint`) take the plain context.
export interface SketchToolCall extends SketchToolContext {
  document: Document;
  features: Readonly<Record<Id, Pick<FeatureResult, 'sketch' | 'plane'>>>;
}

export interface SketchToolInputs {
  // D73: by `first` or by `center` (one of the two); `width` and `height` add the dimensions of
  // the sides, and `opposite` may be left out when both are given.
  rectangle: { first?: Anchor; center?: Anchor; opposite?: Anchor; width?: number | Expr; height?: number | Expr };
  // `vertex` gives the size and the rotation. `sizeKind` and `size` add a dimension: the diameter
  // of the circumscribed circle, or the size across flats (an even number of sides only).
  polygon: { center: Anchor; vertex: Anchor; sides: number; sizeKind?: 'circumscribed' | 'acrossFlats'; size?: number | Expr };
  // `corner`: the point where two lines meet; `radius`: a number or an expression (D52). `corners`
  // instead of `corner`: several corners with one radius in one batch, each after the one before (D73).
  fillet: { corner?: Id; corners?: Id[]; radius: number | Expr };
  // D65: the piece of `curve` nearest to `at` goes; `with` selects which contacts bound it.
  trim: TrimInput;
  // D65: the end `end` of a line or an arc moves to the first curve its extension meets.
  extend: ExtendInput;
  // D65: curves cut at the points where other curves meet them; without `curve` the whole sketch.
  split: SplitInput;
  // D69: entities of an earlier sketch projected into this one, or an own outline over them.
  projectSketch: ProjectSketchInput;
}
export type SketchToolName = keyof SketchToolInputs;

export type SketchToolInput =
  | { kind: 'anchor'; optional?: boolean }
  // a point of the sketch by its ID: an own point or `origin`, not a point of projected geometry
  | { kind: 'point'; optional?: boolean }
  // a list of such points, none twice (D73)
  | { kind: 'points'; optional?: boolean }
  // `expression`: an expression over parameters is accepted too (it ends up in a dimension)
  | { kind: 'number'; spec: NumberSpec; optional?: boolean; expression?: boolean }
  | { kind: 'option'; options: readonly string[]; optional?: boolean }
  // the ID of a curve of the sketch (D65): an own curve; with `reference` also a curve of reference
  // geometry (a projected edge, an axis of the origin). A copy of a mirror or a pattern is refused.
  | { kind: 'curve'; reference?: boolean; optional?: boolean }
  // a place `[x, y]` of the sketch: nothing is made there and nothing snaps to it (D65)
  | { kind: 'place'; optional?: boolean }
  // the ID of a sketch of the document (D69); the tool says which it takes
  | { kind: 'sketch' }
  // IDs of points and curves of the sketch named by the input `of` (D69)
  | { kind: 'entities'; of: string; optional?: boolean };

export interface SketchToolSpec {
  title: string;
  summary: string;
  inputs: Record<string, SketchToolInput>;
  // groups of optional inputs of which exactly one is given (D73: `first` or `center`)
  oneOf?: readonly (readonly string[])[];
  ids: Record<string, string>; // what the tool returns in `ids`, and in which order
}

export type SketchToolResult =
  | { ok: true; commands: Command[]; ids: Record<string, Id[]> } // the commands are sent as one batch
  | { ok: false; message: string }; // an input the tool cannot draw (both corners at one place)

export const MAX_POLYGON_SIDES = 64;

// The catalog: the single source of truth about the tools, their inputs and what they return.
export const SKETCH_TOOLS: Record<SketchToolName, SketchToolSpec> = {
  rectangle: {
    title: 'Rectangle',
    summary:
      'A rectangle: four lines, two horizontal and two vertical. By two opposite corners, `first` and `opposite`; or by its centre, `center` instead of `first`: the corner opposite `opposite` across the centre is then `points[0]`, and a construction diagonal from `points[0]` to `points[2]` has the centre as its midpoint. `width` and `height` (each a number or an expression) add a distance dimension between the corners of a horizontal and of a vertical side, and the rectangle is drawn at that size from `first` or `center` towards `opposite` (towards +x and +y without it; `opposite` may be left out when both are given, and may then not snap to a point, which the sizes place already; an `opposite` that snaps otherwise keeps its place). Without them the width and the height stay free. With `width`, `height` and `first` or `center` snapped to a fixed point (such as `origin`) the rectangle is fully determined; on a point that is free its two coordinates stay free.',
    inputs: {
      first: { kind: 'anchor', optional: true },
      center: { kind: 'anchor', optional: true },
      opposite: { kind: 'anchor', optional: true },
      width: { kind: 'number', spec: { title: 'Width', unit: 'mm', min: { value: 0, open: true } }, optional: true, expression: true },
      height: { kind: 'number', spec: { title: 'Height', unit: 'mm', min: { value: 0, open: true } }, optional: true, expression: true },
    },
    oneOf: [['first', 'center']],
    ids: {
      points: 'the corners in order round the rectangle: `points[0]` (`first`, or the corner opposite `opposite` across the centre), the corner beside it along x, `points[2]` (`opposite`), the corner beside `points[0]` along y; new points are numbered in this order',
      lines: '`lines[i]` goes from `points[i]` to `points[i + 1]`, the last one back to `points[0]`; even ones are horizontal',
      constraints: 'the constraints the tool added, without the dimensions (horizontal, vertical, those of snapping, and the midpoint of the centre)',
      center: 'the centre point (with `center`)',
      diagonal: 'the construction diagonal from `points[0]` to `points[2]` (with `center`)',
      width: 'the width dimension, between `points[0]` and `points[1]` (with `width`)',
      height: 'the height dimension, between `points[1]` and `points[2]` (with `height`)',
    },
  },
  polygon: {
    title: 'Regular polygon',
    summary:
      'A regular polygon: a construction circle around it, the vertices on the circle and all sides of the same length. Position, size and rotation stay free (4 degrees of freedom) unless the anchors snap or a size is given. `sizeKind` with `size` adds a dimension: the diameter of the circumscribed circle, or the size across flats (the wrench size of a nut; an even number of sides only). `sizeKind` alone dimensions the size as drawn. With a `size` the polygon is drawn at that size around `center`; when `vertex` snaps, the vertex keeps its place and a `center` that does not snap is drawn where the size holds, on the line from the vertex towards it. With both anchors snapped and a size far from their distance (ten times) the polygon may come out folded: give anchors that are about the size apart. The direction from `center` to `vertex` is the rotation: draw the polygon turned as it should be (with `vertex` straight right of the centre, `lines[1]` of a hexagon is horizontal) and add a constraint on a side only to hold it there. The same constraints also hold for folded polygons, and the solver may end in one when a later constraint or a change of the size asks for a big jump (a turn over about 30°, the size across flats several times larger or smaller): the sketch then has no region (`regions: 0`); undo the step and make it smaller. The dimension of the circumscribed circle takes any change.',
    inputs: {
      center: { kind: 'anchor' },
      vertex: { kind: 'anchor' },
      sides: { kind: 'number', spec: { title: 'Sides', unit: 'count', min: { value: 3 }, max: { value: MAX_POLYGON_SIDES }, integer: true } },
      sizeKind: { kind: 'option', options: ['circumscribed', 'acrossFlats'], optional: true },
      size: { kind: 'number', spec: { title: 'Size', unit: 'mm', min: { value: 0, open: true } }, optional: true, expression: true },
    },
    ids: {
      center: 'the centre point',
      circle: 'the circumscribed construction circle',
      points: 'the vertices: `points[0]` is `vertex`, the others follow counter-clockwise',
      lines: '`lines[i]` goes from `points[i]` to `points[i + 1]`, the last one back to `points[0]`',
      constraints: 'the constraints the tool added, without the size dimension',
      size: 'the size dimension, when one was asked for',
    },
  },
  fillet: {
    title: 'Fillet',
    summary:
      'A fillet of the corner where two lines meet: an arc of the given radius, tangent to both lines. The lines are shortened to the ends of the arc and keep their IDs, so the faces made from them keep their names. The corner point stays as the virtual corner, held on both lines: dimensions and constraints on it mean what they did, and a size of the outline is still measured between its sharp corners. `radius` becomes a radius dimension (`ids.radius`), a number or an expression; change it there. The arc is added to every region and wall of the document that passes the corner (`ids.patched`), in the same batch, so the features built on the sketch keep their profiles and get the round face named by the arc: `side` of an extrusion (a cylinder, or a cone when the extrusion is tapered) or of a revolve (a torus, or a sphere when the arc is centred on its axis), `wallSide` left and right of a wall. A region that has the corner only on the rim of a hole (a plate around a pocket) needs no patch, since a region is named by its outer loop: a feature that reads the corner through holes alone gets the round corner too and is in no list. Two lists name what reads the corner directly and is not patched; check them. `ids.moved`: sketches and plane features on a side face that starts at the corner (a side face starts where its line starts, at `a`); their plane has moved along the line, with everything dimensioned from its origin. `ids.shortened`: extrusions and revolves whose wall runs along one of the two lines only (the wall ends at the arc now), and sketches that project an edge of a side face of either line (the end of the projection at the corner has moved). Only features that read the corner directly are listed, by the names in the document: what is built on them follows them, and a listed feature may also be among the problems of the result. Refused: a point that is not the common end of exactly two lines (ends joined by a coincident constraint are two points: re-point one line onto the other point first, setCurvePoint), parallel lines, a radius the lines are too short for or one too small to draw, a line with an equalLength or midpoint constraint (it would measure the shortened line). A profile offset or a wall has to leave the arc a radius: an inward offset as large as the fillet is an error of that feature. Nothing keeps the arc a fillet afterwards: a later change that leaves it no room (a radius too large, a side too short) is often a conflict of the sketch or an invalid profile, but it can also be solved into an arc that runs past the end of a line, with no message and a body made from it, so look at the sketch after such a change. Of the curves that end at the corner the ones that are not construction curves are filleted; if there are none, the construction ones. A mirror or pattern of the sketch whose listed curves the arc stands between gets the arc as a source (`ids.entries`), so its copies are filleted too. A corner of copies is not filleted: fillet the corner of their source.',
    inputs: { corner: { kind: 'point', optional: true }, corners: { kind: 'points', optional: true }, radius: { kind: 'number', spec: { title: 'Radius', unit: 'mm', min: { value: 0, open: true } }, expression: true } },
    oneOf: [['corner', 'corners']],
    ids: {
      corners:
        'with `corners` (several corners in one batch and one undo step, D73): the corners in the order given. Each corner is filleted in the state the corners before it left, so two corners of one line share it; every list below then holds the lists of the corners one after another: `arc[i]`, `center[i]` and `radius[i]` belong to `corners[i]`, `lines` and `ends` have two entries per corner, `constraints` those of each corner in turn, and `patched`, `moved`, `shortened` and `entries` each feature or entry once, in the order of the timeline or of the entries. A corner that is refused refuses the whole call, with the corner named',
      arc: 'the arc',
      center: 'the centre point of the arc',
      lines: 'the two lines that were shortened, in the order of their IDs',
      ends: 'the ends of the arc: `ends[i]` is the new end of `lines[i]`',
      constraints: 'the constraints the tool added, without the radius dimension: the tangency of `lines[0]`, of `lines[1]`, the corner on `lines[0]`, on `lines[1]` (a corner already held on a line keeps that constraint, and it is the one named)',
      radius: 'the radius dimension',
      patched: 'the features whose region or wall named both lines and was given the arc, in the order of the timeline (empty when there are none; a feature that reads the corner only through the hole of a region needs no patch and is not here)',
      moved: 'sketches and plane features on a side face that starts at the corner: their plane moved with the start of its line (empty when there are none)',
      shortened: 'features that read a line of the two by itself: extrusions and revolves whose wall runs along one of them, sketches that project an edge of a side face of either or either line itself (empty when there are none)',
      entries: 'the entries of mirrors and patterns of the sketch the arc joined (updateExternal of the input form, expressions kept): an entry that lists both lines, or of two entries with the same transform that list one line each the first in the order of the entries; their copies get the copy of the arc, and every stored region that holds the copies of both lines with one copy number the copy of the arc (empty when there are none)',
    },
  },
  trim: {
  title: 'Trim',
  summary:
    'Removes the piece of a curve nearest to `at`. A piece is the part between two neighbouring cuts, or between a cut and an end; a cut is a point where another curve crosses the curve, ends on it, or touches it, apart from a common end. `curve` may be left out: the own curve nearest to `at` is trimmed (a place that lies on a projected curve or on a copy of a mirror or a pattern is refused: those are not trimmed; an axis of the origin does not count, and where an own curve crosses a projection or a copy, name the curve). With `curve`, `at` has to be nearer to it than to any other piece on the same line or circle: after a split the ID of a curve names only its first piece, and a place on another piece is refused with the name of that piece. The curves that cut an outline curve are the other outline curves; a construction or reference curve cuts it only when `with` names it (`with`: only the contacts with that curve bound the piece). `repair` (`on`, `off`; left out: on when a feature of the document reads regions of the sketch, off otherwise): on, the trim first cuts every other contact of outline curves in the sketch (as split without curve; contacts inside the removed piece go with it), so each becomes a common point, the profile can close and the regions of the features follow at once; off, only the trimmed curve is cut and its new ends are held on the curves there (pointOnCurve), so no other curve changes and T shapes stay (a sketch of walls). A construction curve is always trimmed that way. Pass `repair` `on` wherever a feature reads regions of the sketch or will; `off` is for a sketch whose T shapes are meant. With `off` in a sketch whose regions a feature reads, a region whose outline loses the piece is rewritten by names and cannot be followed afterwards (`ids.pending`, then `ids.dropped` at the tool that next leaves the sketch valid). What stays keeps its constraints: the piece with the start of the curve keeps its ID; a middle piece removed leaves a new line or arc beyond it, held on the line of the curve (pointOnCurve) or on its circle (the same centre); a circle trimmed becomes an arc under its ID with its constraints. A piece with no cut inside it (a curve that crosses nothing, or a piece left by an earlier split) is removed whole; what held its line or circle moves to a sibling piece on the same line or circle. Two arcs of one circle left without a common end get equalRadius. An end cut off stays, held on the line or circle of the curve, when anything else names it (another curve, any constraint, a feature, a joint), so a dimension of the whole curve still measures it; otherwise it is removed. equalLength and midpoint of a cut line move to a construction line over its old ends (`ids.span`). Where a line only touches an arc (a tangent contact away from their ends), both are cut and the tangency is kept between a line piece and an arc piece that have that point (added when the sketch had none: `ids.constraints`); two arcs that only touch are not cut (`ids.uncut`). A trim cannot stop at a touch that is not cut (two arcs; a line and an arc with the repair off; a circle that would get that one point): a piece that would run through such a touch is refused with the touch named; remove the whole curve with removeEntity, or trim a line and an arc with `repair` `on`. The regions of the features over the sketch follow (`ids.patched`): a region that is gone is replaced by every region after the batch that covers part of it; a region whose outline was opened is dropped (`ids.dropped`); while the sketch still has a contact after the batch the regions are rewritten by names instead (`ids.pending`); a region merged with its neighbour follows into the merged one, so the body grows, and a cut feature then cuts the neighbour too. A region that keeps its name while a hole inside it was opened or closed is in `ids.reshaped`: its body changes without a change of the reference. The edges of chamfers and fillets on a side of a cut curve are rewritten to the pieces (`ids.patched`); an edge whose piece is gone stays in its list while something names a face of that chamfer or fillet at its place or later, and the feature is then in `ids.broken`. Refused: a trim that takes the common end of a tangency off its curve (remove the tangency first); a piece that runs through a touch that is not cut; a place on a curve that is not own; a sketch in conflict. A copy of a mirror or pattern of the sketch is never cut and cannot be named to a tool: cut its source, and the entry follows (`ids.entries`: the pieces of a listed curve take its place, a curve removed whole leaves the list, and a trim that opens the listed curves adds the curve that closes the gap, such as the arc of a notch); features over the copies follow as over the source. Check `reshaped`, `moved`, `shortened`, `broken` and `entries`, and the problems of the answer. To repair crossing curves: ask the query sketchContacts where they are, split the whole sketch (split without curve), then trim the pieces that should go, each by a place on it.',
  inputs: { at: { kind: 'place' }, curve: { kind: 'curve', optional: true }, with: { kind: 'curve', reference: true, optional: true }, repair: { kind: 'option', options: ['on', 'off'], optional: true } },
  ids: CUT_IDS,
  },
  extend: {
  title: 'Extend',
  summary:
    'Moves an end of a line (`a` or `b`) or of an arc (`start` or `end`) along the line or the circle of the curve to the first place where the extension meets another curve (for an outline curve another outline curve; for a construction curve any curve; with `with`, that curve only), within that curve\'s own extent. `repair` as for trim: on (the default when a feature reads regions of the sketch), the extend first cuts every contact of outline curves in the sketch and the extended stretch at every outline curve it crosses, and the curve met is cut at the new end; when the curve itself was cut, the piece that holds the end is extended. Off, and for a construction curve, the new end is held on the curve met (pointOnCurve) and nothing else is cut. The old end stays on the line or circle of the curve when anything else names it, else it is removed. Where the extension of a line only touches an arc that is cut there, it stops there too and the tangency is kept between the line and an arc piece that has the new end. Refused: an end that another curve also ends at (also through a coincident constraint), an end lying on another outline curve, an extension that meets nothing, an arc whose extension would reach the curve as it was (its own other end) first, an extension that would leave a contact no tool can cut while the profile was valid (its end on a circle which would then have that one point, a touch along it that is not cut, or a projected curve or a copy that forms regions, crossed or ended on: the profile would become invalid for good; draw across the circle and trim instead, or change the source of the copy), a sketch in conflict. A touch that is not cut does not stop an extension. The regions of the features over the sketch follow, as for trim.',
  inputs: { curve: { kind: 'curve' }, end: { kind: 'option', options: ['a', 'b', 'start', 'end'] }, with: { kind: 'curve', reference: true, optional: true }, repair: { kind: 'option', options: ['on', 'off'], optional: true } },
  ids: CUT_IDS,
  },
  split: {
  title: 'Split',
  summary:
    'Cuts curves into pieces at the points where other curves cross them, end on them or touch them, and nothing is removed. With `curve`: that curve at all its cuts (`with`: at its contacts with that curve only; `at`: at the one cut nearest to `at`, not on a circle). Without `curve` (and without `with` and `at`): every contact of two outline curves in the sketch, which is what makes a profile with crossing curves invalid, and two ends at one place that are not joined are joined (the curve whose end nothing else names re-pointed onto the other point, else a coincident constraint); a sketch with nothing to cut gives an empty batch when its profile is valid, and a refusal with the reason when it is invalid for something a cut cannot repair (curves lying on each other, a curve of no length, two arcs that only touch, a circle with one point). The query sketchContacts lists the places beforehand, each with what split would do there. Each piece is a curve of its own, so each region between crossing curves has its own name (a line through a circle gives two regions, named by the two arcs and the middle piece). Constraints stay as for trim; a circle cut at two or more points becomes arcs on its centre, the first under its ID. A circle touched at one point only cannot be split (`ids.uncut`). The regions of the features over the sketch follow: a region cut into several is replaced by all of them, so the bodies do not change. Then trim the pieces that should go, each by a place on it.',
  inputs: { curve: { kind: 'curve', optional: true }, with: { kind: 'curve', reference: true, optional: true }, at: { kind: 'place', optional: true } },
  ids: CUT_IDS,
  },
  projectSketch: {
    title: 'Project from a sketch',
    summary:
      'Projects entities of an earlier sketch `sketch` on a parallel plane into this sketch, each by one addExternal of the kind `sketch` (section Entries of a sketch) with a fresh ID and its `kind` from the source. `entities`: the points and curves to project, in that order (the query sketchSources lists every one with its place here). Without it the whole sketch: its own curves that are not construction curves, then the curves of its entries in their order (every curve of a projection, the copies of a mirror or pattern that form regions), then its lone points (an own point no own curve names, which may be a leftover such as the corner a fillet keeps; and a projected point); never anything under `origin/`. `as`, the role of the projected curves here: `source` (the default) forms regions exactly where the curve forms regions in its source, so a sketch projected whole has the regions of its source; `reference` none (a skeleton); `regions` every curve (refused when two of them lie on each other in the source: name the entities, or use `source`); `own` none, and an own outline is drawn over the projected curves and held on them, which is the outline the sketch tools trim, extend and split: one own point per place where projected ends lie (coincident with one of them), an own line between two of them, an own circle (centre coincident, equalRadius), an own arc with a centre of its own, a construction line from it to the arc\'s start (`ids.helpers`) and the projected centre on that line (pointOnCurve), so it has no second solution; 0 degrees of freedom and no redundant constraint. With `own` one own curve is drawn per place: a curve at the place of one before it in the list, or of an own curve that forms regions in this sketch already, is left out (`ids.doubled`), so the whole of a sketch that holds an own outline over its projections gives one outline; curves that only overlap are drawn as they are (after a trim the own outline of a sketch is in pieces over whole projections: project its own curves by `entities`). An entity this sketch projects already is skipped (`ids.skipped`), so the tool can be run again after the source grew; with `own` and `entities`, an entry that projects a curve named in `entities` with the flag `regions` is taken over instead (`ids.taken`: its flag switched off, an own curve drawn over it and held on it, so a crossing there can be cut; a run over the whole sketch skips it). The own curve then names the regions along the entry and its side face, so the features that read them are renamed to it in the same batch (`ids.patched`: the regions of an extrusion or a revolve, the edges of a chamfer or a fillet, the plane of a sketch and the edges it projects, the base or midplane of a plane); the takeover is refused, naming them, when something else names that side face (for example an extent up to it, an axis or a frame on it, a section entry) or a projected edge would swap its two faces under the new name (a chamfer or a fillet is renamed either way), and an entry with an own curve over it already is left out (`ids.doubled`; when nothing else is made, the refusal gives the updateExternal that switches its flag off and names what reads the regions along it or its side face). Where a projected end lies on an end of an own curve of this sketch that forms regions (one vertex there), that own point is reused with no constraint added, so a second run continues the own outline of the first. Refused: a sketch the document does not have, this sketch, a later one, a source or this sketch not evaluated, a plane that is not parallel (the angle is said), an entity the source does not have, anything under `origin/`, nothing left to project.',
    inputs: { sketch: { kind: 'sketch' }, entities: { kind: 'entities', of: 'sketch', optional: true }, as: { kind: 'option', options: ['source', 'reference', 'regions', 'own'], optional: true } },
    ids: PROJECT_SKETCH_IDS,
  },
};

// Points closer than this are one point for drawing: a curve between them would have no length
// and would make the profile of the sketch invalid.
const SAME_PLACE = 1e-6;
const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- geometry of the sketch

type Shape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'circle'; center: Vec2; radius: number } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number };

// The curves and positions of the sketch as the recompute holds them (`solvedCurves`: the own
// curves, those of the result, the axes of the origin; the positions of the result, else of the
// sketch), made once for a sketch and its result.
const solvedOf = new WeakMap<SketchFeature, { result: SketchResult | undefined; solved: SolvedCurves }>();
function solved(context: SketchToolContext): SolvedCurves {
  const known = solvedOf.get(context.sketch);
  if (known && known.result === context.result) return known.solved;
  const made = solvedCurves(context.sketch, context.result);
  solvedOf.set(context.sketch, { result: context.result, solved: made });
  return made;
}

function pointAt(context: SketchToolContext, id: Id): Vec2 | undefined {
  const points = solved(context).geometry.points;
  const p = has(points, id) ? points[id] : undefined;
  return p ? [p.x, p.y] : undefined;
}

// The shape of a curve of the sketch, own or not (a projected one, an axis of the origin);
// undefined when the sketch has no position for it. A line is the stretch `lineExtent` gives, so
// an axis is a whole line.
function shapeOf(context: SketchToolContext, id: Id): Shape | undefined {
  const { curves, geometry } = solved(context);
  const known = curves.get(id);
  const curve = known?.shape;
  if (known && curve) {
    switch (curve.type) {
      case 'line': {
        const extent = lineExtent(known, geometry);
        return extent && { type: 'line', a: [extent.a.x, extent.a.y], b: [extent.b.x, extent.b.y] };
      }
      case 'circle': {
        const center = pointAt(context, curve.center);
        if (!center) return undefined;
        const radius = has(geometry.radii, id) ? geometry.radii[id] : undefined;
        return radius === undefined ? undefined : { type: 'circle', center, radius };
      }
      case 'arc': {
        const center = pointAt(context, curve.center);
        if (!center) return undefined;
        const [start, end] = [pointAt(context, curve.start), pointAt(context, curve.end)];
        if (!start || !end) return undefined;
        const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const turn = (((Math.atan2(end[1] - center[1], end[0] - center[0]) - from) % TAU) + TAU) % TAU;
        return { type: 'arc', center, radius: dist2(center, start), from, sweep: turn || TAU };
      }
      case 'spline':
        return undefined; // nothing snaps to a spline (D70): `anchorProblem` refuses it first
      default:
        return unreachable(curve, 'curve');
    }
  }
  return undefined;
}

function closestOn(shape: Shape, p: Vec2): Vec2 {
  switch (shape.type) {
    case 'line': {
      const [dx, dy] = [shape.b[0] - shape.a[0], shape.b[1] - shape.a[1]];
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - shape.a[0]) * dx + (p[1] - shape.a[1]) * dy) / length2));
      return [shape.a[0] + t * dx, shape.a[1] + t * dy];
    }
    case 'circle': {
      const { center, radius } = shape;
      const angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    case 'arc': {
      const { center, radius } = shape;
      let angle = Math.atan2(p[1] - center[1], p[0] - center[0]);
      const along = (((angle - shape.from) % TAU) + TAU) % TAU;
      // outside the arc: the nearer of its two ends
      if (along > shape.sweep) angle = along - shape.sweep < TAU - along ? shape.from + shape.sweep : shape.from;
      return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    }
    default:
      return unreachable(shape, 'shape');
  }
}

// Where a snapped anchor really lies: on the point or on the curve it snapped to.
export function anchorPosition(context: SketchToolContext, anchor: Anchor): Vec2 {
  if (anchor.snap?.kind === 'point') return pointAt(context, anchor.snap.id) ?? anchor.at;
  if (anchor.snap?.kind === 'curve') {
    const shape = shapeOf(context, anchor.snap.id);
    return shape ? closestOn(shape, anchor.at) : anchor.at;
  }
  return anchor.at;
}

export interface Placed {
  id: Id; // the point a curve may refer to
  commands: Command[];
  constraints: Id[]; // the constraints among the commands
}

// The point for an end of a curve. An own point and the origin are used again. A curve must not
// refer to a point of projected geometry, so a new point with a coincident constraint is made
// there. Snapping to a curve adds a point-on-curve constraint.
export function placeAnchor(context: SketchToolContext, anchor: Anchor, newId: NewId): Placed {
  const sketch = context.sketch.id;
  const snap = anchor.snap;
  if (snap?.kind === 'point' && (snap.id === ORIGIN || has(context.sketch.points, snap.id))) return { id: snap.id, commands: [], constraints: [] };
  const id = newId('p');
  const at = anchorPosition(context, anchor);
  const commands: Command[] = [{ type: 'addPoint', sketch, id, x: at[0], y: at[1] }];
  if (!snap) return { id, commands, constraints: [] };
  const constraint = newId('k');
  commands.push({ type: 'addConstraint', sketch, id: constraint, constraint: snap.kind === 'point' ? { type: 'coincident', a: id, b: snap.id } : { type: 'pointOnCurve', point: id, curve: snap.id } });
  return { id, commands, constraints: [constraint] };
}

// ---------------------------------------------------------------- checking the inputs

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function anchorProblem(context: SketchToolContext, v: unknown): string | undefined {
  if (!isObject(v)) return 'an anchor `{ at: [x, y], snap? }` is expected';
  for (const key of Object.keys(v)) if (key !== 'at' && key !== 'snap') return `an anchor has no field "${key}"`;
  const at = v.at;
  if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number' && Number.isFinite(n))) return '`at` must be two finite numbers `[x, y]`';
  if (!at.every((n) => Math.abs(n) <= MAX_NUMBER)) return `\`at\` is out of the range ±${MAX_NUMBER}`;
  if (v.snap === undefined) return undefined;
  const snap = v.snap;
  if (!isObject(snap) || (snap.kind !== 'point' && snap.kind !== 'curve') || typeof snap.id !== 'string' || Object.keys(snap).some((key) => key !== 'kind' && key !== 'id')) return '`snap` must be `{ kind: "point" | "curve", id }`';
  const entity = entityOf(context.sketch, snap.id);
  if (!entity) return `the sketch has no entity "${snap.id}" to snap to`;
  // a snap ties the new point to what it snaps to, which a copy cannot be (D68)
  const copy = entity.derived ? copyParts(context.sketch, snap.id) : undefined;
  if (copy) return copyAsSnap(snap.id, copy.entry, copy.source);
  if ((entity.kind === 'point') !== (snap.kind === 'point')) return `"${snap.id}" is a ${entity.kind}, not a ${snap.kind}`;
  // a snap to a curve becomes a point held on it, which a spline cannot hold (D70)
  if (entity.kind === 'spline') return SPLINE_AS_SNAP;
  const known = snap.kind === 'point' ? pointAt(context, snap.id) : shapeOf(context, snap.id);
  return known ? undefined : `"${snap.id}" has no solved position to snap to`;
}

export const SPLINE_AS_SNAP = 'a point cannot be held on a spline; snap to a control point or leave the place free';

// A point given by its ID, checked like the snap of an anchor: the sketch has the entity, it is
// a point, it is not a point of projected geometry, and it has a solved position.
function pointProblem(context: SketchToolContext, v: unknown): string | undefined {
  if (typeof v !== 'string') return 'the ID of a point of the sketch is expected';
  const entity = entityOf(context.sketch, v);
  if (!entity) return `the sketch has no point "${v}"`;
  if (entity.kind !== 'point') return `"${v}" is a ${entity.kind}, not a point`;
  const copy = entity.derived ? copyParts(context.sketch, v) : undefined;
  if (copy) return copyInTool(v, copy.entry, copy.source);
  if (!entity.own && v !== ORIGIN) return `"${v}" is a point of projected geometry; give an own point of the sketch`;
  return pointAt(context, v) ? undefined : `"${v}" has no solved position`;
}

// A curve given by its ID: the sketch has it as an own curve (with `reference`, also as a curve of
// reference geometry: a projected edge, an axis of the origin), and it has a solved position.
// A copy of a mirror or a pattern is refused for both.
function curveInputProblem(context: SketchToolContext, v: unknown, reference: boolean): string | undefined {
  if (typeof v !== 'string') return 'the ID of a curve of the sketch is expected';
  const entity = entityOf(context.sketch, v);
  const curve = solved(context).curves.get(v);
  if (entity?.kind === 'point') return `"${v}" is a point, not a curve`;
  if (!entity || !curve) return `the sketch has no curve "${v}"`;
  const copy = curve.source === 'derived' ? copyParts(context.sketch, v) : undefined;
  if (copy) return copyInTool(v, copy.entry, copy.source);
  if (curve.source !== 'own' && !reference) return `"${v}" is reference geometry; give an own curve of the sketch`;
  if (curve.shape.type === 'spline') return SPLINE_NOT_CUT(v); // no tool takes a spline (D70)
  return shapeOf(context, v) ? undefined : `"${v}" has no solved position`;
}

// The inputs against the catalog; the first problem as text.
function inputProblem(spec: SketchToolSpec, context: SketchToolContext, input: unknown): string | undefined {
  if (!isObject(input)) return 'the input of a tool must be an object';
  for (const key of Object.keys(input)) if (!has(spec.inputs, key)) return `${spec.title} has no input "${key}"; it takes ${Object.keys(spec.inputs).join(', ')}`;
  for (const group of spec.oneOf ?? []) {
    const given = group.filter((name) => input[name] !== undefined);
    if (given.length !== 1) return `${spec.title} takes exactly one of ${group.join(', ')}${given.length ? `; given: ${given.join(', ')}` : ''}`;
  }
  for (const [name, kind] of Object.entries(spec.inputs)) {
    const value = input[name];
    if (value === undefined) {
      if (kind.kind === 'sketch' || kind.optional !== true) return `the input "${name}" is missing`;
      continue;
    }
    if (kind.kind === 'anchor') {
      const problem = anchorProblem(context, value);
      if (problem) return `${name}: ${problem}`;
    } else if (kind.kind === 'point') {
      const problem = pointProblem(context, value);
      if (problem) return `${name}: ${problem}`;
    } else if (kind.kind === 'points') {
      if (!Array.isArray(value) || value.length === 0) return `${name}: a non-empty list of IDs of points of the sketch is expected`;
      for (const [i, point] of value.entries()) {
        const problem = pointProblem(context, point);
        if (problem) return `${name}[${i}]: ${problem}`;
        if (value.indexOf(point) !== i) return `${name}[${i}]: "${String(point)}" is in the list twice`;
      }
    } else if (kind.kind === 'curve') {
      const problem = curveInputProblem(context, value, kind.reference === true);
      if (problem) return `${name}: ${problem}`;
    } else if (kind.kind === 'sketch') {
      if (typeof value !== 'string' || value === '') return `${name}: the ID of a sketch of the document is expected`;
    } else if (kind.kind === 'entities') {
      if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === 'string' && id !== '')) return `${name}: a non-empty list of IDs of points and curves of the sketch "${kind.of}" names is expected`;
    } else if (kind.kind === 'place') {
      if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return `${name}: two finite numbers \`[x, y]\` are expected`;
      if (!value.every((n) => Math.abs(n) <= MAX_NUMBER)) return `${name}: out of the range ±${MAX_NUMBER}`;
    } else if (kind.kind === 'option') {
      if (typeof value !== 'string' || !kind.options.includes(value)) return `${name}: one of ${kind.options.join(', ')} is expected`;
    } else if (typeof value === 'string') {
      if (!kind.expression) return `${name}: a number is expected, not an expression`;
      if (value.trim() === '') return `${name}: the expression is empty`;
    } else {
      if (typeof value !== 'number') return `${name}: a number is expected`;
      const checked = checkNumber(value, kind.spec);
      if (!checked.ok) return `${name}: ${checked.message}`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- the tools

const failed = (message: string): SketchToolResult => ({ ok: false, message });

// A size given as a number or an expression (a width, a radius): the number, or the value of the
// expression the parameters give it, checked against the spec of the input as a number is; or why
// it cannot be used. A number has been checked by `inputProblem` already.
function sizeOf(context: SketchToolContext, name: string, value: number | Expr | undefined, input: SketchToolInput): number | undefined | { problem: string } {
  if (value === undefined || typeof value === 'number') return value;
  if (!context.parameters) return { problem: `${name}: the expression cannot be evaluated without the values of the parameters` };
  const known = evaluateNumber(value, context.parameters);
  if (!known.ok) return { problem: `${name}: ${known.error.message}` };
  const checked = checkNumber(known.value, input.kind === 'number' ? input.spec : { title: name, unit: 'mm' });
  return checked.ok ? checked.value : { problem: `${name}: ${checked.message}` };
}

function rectangle(context: SketchToolContext, input: SketchToolInputs['rectangle'], newId: NewId): SketchToolResult {
  const sketch = context.sketch.id;
  // `inputProblem` has made sure that exactly one of `first` and `center` is given
  const byCenter = input.center !== undefined;
  const from = (byCenter ? input.center : input.first) as Anchor;
  const pf = anchorPosition(context, from);
  const sizes = [sizeOf(context, 'width', input.width, SKETCH_TOOLS.rectangle.inputs.width), sizeOf(context, 'height', input.height, SKETCH_TOOLS.rectangle.inputs.height)];
  for (const size of sizes) if (typeof size === 'object') return failed(size.problem);
  const [width, height] = sizes as (number | undefined)[];
  const po = input.opposite && anchorPosition(context, input.opposite);
  if (!po && (width === undefined || height === undefined)) return failed('`opposite` is needed unless `width` and `height` are both given');
  // Both sizes place the opposite corner already; snapped to a point as well, the sketch would ask
  // for it at two places (a conflict whenever `first` or `center` is held).
  if (input.opposite?.snap?.kind === 'point' && width !== undefined && height !== undefined) {
    return failed(`\`opposite\` snaps to the point "${input.opposite.snap.id}", but \`width\` and \`height\` place that corner already: leave out \`opposite\` (drawn towards +x and +y) or give it without \`snap\` (only the direction counts), or leave out one of the sizes`);
  }
  // The corner `opposite` as drawn: where it snaps, else at the given size (half of it from the
  // centre) towards where it was given, else where it was given.
  const reach = byCenter ? 0.5 : 1;
  const towards = (axis: 0 | 1): number => (po && po[axis] < pf[axis] ? -1 : 1);
  const sized = (axis: 0 | 1, size: number | undefined): number => (size !== undefined ? pf[axis] + towards(axis) * size * reach : (po as Vec2)[axis]);
  const pc: Vec2 = po && input.opposite?.snap ? po : [sized(0, width), sized(1, height)];
  const pa: Vec2 = byCenter ? [2 * pf[0] - pc[0], 2 * pf[1] - pc[1]] : pf;
  if (Math.abs(pa[0] - pc[0]) <= SAME_PLACE || Math.abs(pa[1] - pc[1]) <= SAME_PLACE) return failed(byCenter ? 'the centre and the corner must differ in both coordinates' : 'the two corners must differ in both coordinates');
  if ([pa, pc].some((q) => Math.abs(q[0]) > MAX_NUMBER || Math.abs(q[1]) > MAX_NUMBER)) return failed(`the rectangle reaches out of the range ±${MAX_NUMBER}`);
  // the points in the order of the result, so that new IDs are numbered in it (D73)
  const free = (at: Vec2): Placed => {
    const id = newId('p');
    return { id, commands: [{ type: 'addPoint', sketch, id, x: at[0], y: at[1] }], constraints: [] };
  };
  const a = byCenter ? free(pa) : placeAnchor(context, from, newId);
  const b = newId('p');
  const c = input.opposite?.snap ? placeAnchor(context, input.opposite, newId) : free(pc);
  if (a.id === c.id) return failed('the two corners must differ in both coordinates');
  const d = newId('p');
  const center = byCenter ? placeAnchor(context, from, newId) : undefined;
  const points = [a.id, b, c.id, d];
  const commands: Command[] = [...a.commands, { type: 'addPoint', sketch, id: b, x: pc[0], y: pa[1] }, ...c.commands, { type: 'addPoint', sketch, id: d, x: pa[0], y: pc[1] }, ...(center?.commands ?? [])];
  const lines: Id[] = [];
  const constraints: Id[] = [...a.constraints, ...c.constraints, ...(center?.constraints ?? [])];
  points.forEach((corner, i) => {
    const [line, constraint] = [newId('c'), newId('k')];
    lines.push(line);
    constraints.push(constraint);
    commands.push({ type: 'addCurve', sketch, id: line, curve: { type: 'line', a: corner, b: points[(i + 1) % 4] } });
    commands.push({ type: 'addConstraint', sketch, id: constraint, constraint: { type: i % 2 === 0 ? 'horizontal' : 'vertical', line } });
  });
  const ids: Record<string, Id[]> = { points, lines, constraints };
  if (center) {
    const [diagonal, midpoint] = [newId('c'), newId('k')];
    commands.push({ type: 'addCurve', sketch, id: diagonal, curve: { type: 'line', a: a.id, b: c.id, construction: true } });
    commands.push({ type: 'addConstraint', sketch, id: midpoint, constraint: { type: 'midpoint', point: center.id, line: diagonal } });
    constraints.push(midpoint);
    Object.assign(ids, { center: [center.id], diagonal: [diagonal] });
  }
  const dimension = (name: 'width' | 'height', value: number | Expr, p: Id, q: Id) => {
    const id = newId('k');
    commands.push({ type: 'addConstraint', sketch, id, constraint: { type: 'distance', a: p, b: q, value, driving: true } });
    ids[name] = [id];
  };
  if (input.width !== undefined) dimension('width', input.width, a.id, b);
  if (input.height !== undefined) dimension('height', input.height, b, c.id);
  return { ok: true, commands, ids };
}

function polygon(context: SketchToolContext, input: SketchToolInputs['polygon'], newId: NewId): SketchToolResult {
  const sketch = context.sketch.id;
  const sides = Math.round(input.sides);
  const sizeKind = input.sizeKind ?? (input.size === undefined ? undefined : 'circumscribed');
  if (sizeKind === 'acrossFlats' && sides % 2 === 1) return failed('the size across flats needs an even number of sides; an odd polygon is sized by its circumscribed circle');
  let pc = anchorPosition(context, input.center);
  const pv = anchorPosition(context, input.vertex);
  let centre = input.center;
  let radius = dist2(pc, pv);
  if (!(radius > SAME_PLACE)) return failed('the centre and the vertex are at the same place');
  // The size across flats of the polygon with the circumradius 1.
  const flats = 2 * Math.cos(Math.PI / sides);
  // The value of the dimension and the size the polygon is drawn at.
  // - A size that is given (a number, or an expression the parameters give a value to) is also
  //   the drawn size: the solver then starts from a polygon that already holds, and a start far
  //   from the dimension is what folds a polygon.
  // - A vertex that snaps keeps its place. With a centre that does not snap the centre is drawn
  //   where the size holds, on the line from the vertex to where it was given. With both
  //   snapping the start cannot hold: the other vertices are drawn at the larger of the two
  //   sizes, the given one and the drawn one, which is the start that did not fold in the runs
  //   of the review; the solver brings the rest together, or reports the conflict when neither
  //   place can move.
  // - Without a size the dimension takes the size as drawn. With a free vertex it is rounded and
  //   the polygon drawn at the rounded size; a vertex that snaps is where it is, so the dimension
  //   is not rounded (a rounded one would contradict a vertex that cannot move).
  let value: number | Expr | undefined;
  if (sizeKind) {
    const across = sizeKind === 'circumscribed' ? 2 : flats;
    const drawn = across * radius;
    const rounded = Math.round(drawn * 100) / 100;
    value = input.size ?? (input.vertex.snap || !(rounded > 0) ? drawn : rounded);
    const known = typeof value === 'number' ? value : context.parameters ? evaluateNumber(value, context.parameters) : undefined;
    const size = typeof known === 'number' ? known : known?.ok ? known.value : undefined;
    if (size !== undefined && size > 0) {
      const wanted = size / across;
      if (input.vertex.snap && !input.center.snap) {
        pc = [pv[0] + (wanted / radius) * (pc[0] - pv[0]), pv[1] + (wanted / radius) * (pc[1] - pv[1])];
        centre = { at: pc };
      }
      if (!input.vertex.snap || !input.center.snap || wanted > radius) radius = wanted;
    }
  }
  // a side shorter than what counts as one place would be a line without length
  if (!(2 * radius * Math.sin(Math.PI / sides) > SAME_PLACE)) return failed('the polygon is too small: its sides would have no length');
  if (Math.abs(pc[0]) + radius > MAX_NUMBER || Math.abs(pc[1]) + radius > MAX_NUMBER) return failed(`the polygon reaches out of the range ±${MAX_NUMBER}`);
  const direction = Math.atan2(pv[1] - pc[1], pv[0] - pc[0]);
  const corner = (i: number): Vec2 => [pc[0] + radius * Math.cos(direction + (TAU * i) / sides), pc[1] + radius * Math.sin(direction + (TAU * i) / sides)];

  const center = placeAnchor(context, centre, newId);
  let first: Placed;
  if (input.vertex.snap) first = placeAnchor(context, input.vertex, newId);
  else {
    const id = newId('p');
    first = { id, commands: [{ type: 'addPoint', sketch, id, x: corner(0)[0], y: corner(0)[1] }], constraints: [] };
  }
  const commands: Command[] = [...center.commands, ...first.commands];
  const points: Id[] = [first.id];
  for (let i = 1; i < sides; i++) {
    const id = newId('p');
    points.push(id);
    commands.push({ type: 'addPoint', sketch, id, x: corner(i)[0], y: corner(i)[1] });
  }
  const circle = newId('c');
  commands.push({ type: 'addCurve', sketch, id: circle, curve: { type: 'circle', center: center.id, construction: true }, radius });
  const lines = points.map(() => newId('c'));
  lines.forEach((line, i) => commands.push({ type: 'addCurve', sketch, id: line, curve: { type: 'line', a: points[i], b: points[(i + 1) % sides] } }));
  const constraints: Id[] = [...center.constraints, ...first.constraints];
  const constrain = (constraint: Extract<Command, { type: 'addConstraint' }>['constraint']): Id => {
    const id = newId('k');
    commands.push({ type: 'addConstraint', sketch, id, constraint });
    return id;
  };
  // every vertex on the circle and every side as long as the first one: the regular polygon holds
  // these, and so do its folded forms (see the summary of the tool)
  for (const point of points) constraints.push(constrain({ type: 'pointOnCurve', point, curve: circle }));
  for (const line of lines.slice(1)) constraints.push(constrain({ type: 'equalLength', a: lines[0], b: line }));
  const ids: Record<string, Id[]> = { center: [center.id], circle: [circle], points, lines, constraints };
  if (sizeKind && value !== undefined) {
    // across flats: from the first vertex to the line of the opposite side
    ids.size = [constrain(sizeKind === 'circumscribed' ? { type: 'diameter', curve: circle, value, driving: true } : { type: 'distancePointLine', point: points[0], line: lines[sides / 2], value, driving: true })];
  }
  return { ok: true, commands, ids };
}

// ---------------------------------------------------------------- the fillet (D52)

type LineCurve = Extract<Curve, { type: 'line' }>;

// The positions the tool reads: the solved ones (the origin, projected points and the far points
// of the axes included), else those of the document (`solvedCurves`).
const positionsOf = (context: SketchToolContext): Record<Id, Point2> => solved(context).geometry.points;

// The two lines of a corner, or why the corner is not one. The curves that count are the own
// curves whose end (a line by `a` or `b`, an arc by `start` or `end`) is in the vertex of the
// corner: the class of points the profile joins with it (`pointJoins`). Of them the curves that
// are not construction curves are taken, or if there are none the construction ones; they have to
// be exactly two lines, both ending at the corner point itself.
function cornerLines(context: SketchToolContext, corner: Id): [Id, Id] | string {
  const { sketch } = context;
  const vertex = pointJoins(sketch, { points: positionsOf(context), radii: {} });
  const at = vertex(corner);
  const ends = (curve: Curve): Id[] => {
    switch (curve.type) {
      case 'line':
        return [curve.a, curve.b];
      case 'arc':
        return [curve.start, curve.end];
      case 'spline':
        return [curve.points[0], curve.points[curve.points.length - 1]];
      case 'circle':
        return [];
      default:
        return unreachable(curve, 'curve');
    }
  };
  const ending = Object.keys(sketch.curves).filter((id) => ends(sketch.curves[id]).some((p) => vertex(p) === at));
  const real = ending.filter((id) => !sketch.curves[id].construction);
  const taken = real.length > 0 ? real : ending;
  const lines = taken.filter((id) => sketch.curves[id].type === 'line');
  if (taken.length !== 2 || lines.length !== 2) {
    const what = taken.map((id) => `"${id}" (${sketch.curves[id].type})`).join(', ');
    return `"${corner}" is not the common end of exactly two lines: ${taken.length === 0 ? 'no curve ends there' : `what ends there is ${what}`}`;
  }
  for (const id of lines) {
    const line = sketch.curves[id] as LineCurve;
    if (line.a !== corner && line.b !== corner) {
      const other = vertex(line.a) === at ? line.a : line.b;
      return `the corner is two points: "${id}" ends at "${other}", which a coincident constraint joins to "${corner}"; re-point one line onto the other point first (setCurvePoint)`;
    }
  }
  return [lines[0], lines[1]].sort() as [Id, Id];
}

// One corner (D52).
function filletCorner(context: SketchToolCall, corner: Id, input: { radius: number | Expr }, newId: NewId): SketchToolResult {
  const { sketch, document } = context;
  const found = cornerLines(context, corner);
  if (typeof found === 'string') return failed(found);
  const lines = found;
  for (const [id, c] of Object.entries(sketch.constraints)) {
    if ((c.type === 'equalLength' || c.type === 'midpoint') && constraintOperands(c).some((operand) => lines.includes(operand))) {
      return failed(`the ${c.type} constraint "${id}" is on a line of the corner; after the fillet it would measure the shortened line, so remove it first`);
    }
  }
  // the radius: a number, or an expression the parameters give a value to
  const radius = sizeOf(context, 'radius', input.radius, SKETCH_TOOLS.fillet.inputs.radius) as number | { problem: string };
  if (typeof radius === 'object') return failed(radius.problem);

  const p = pointAt(context, corner) as Vec2;
  const curves = lines.map((id) => sketch.curves[id] as LineCurve);
  const far = curves.map((line): Vec2 => pointAt(context, line.a === corner ? line.b : line.a) as Vec2);
  const lengths = far.map((q) => dist2(p, q));
  for (const [i, length] of lengths.entries()) if (!(length > LENGTH_TOLERANCE)) return failed(`the line "${lines[i]}" is shorter than ${LENGTH_TOLERANCE} mm and has no direction`);
  const u = far.map((q, i): Vec2 => [(q[0] - p[0]) / lengths[i], (q[1] - p[1]) / lengths[i]]);
  const angle = Math.atan2(Math.abs(cross2(u[0], u[1])), dot2(u[0], u[1]));
  if (angle <= ANGLE_TOLERANCE || angle >= Math.PI - ANGLE_TOLERANCE) return failed(`the lines "${lines[0]}" and "${lines[1]}" are parallel: there is no corner to round`);
  const half = Math.tan(angle / 2);
  const along = radius / half; // from the corner to an end of the arc
  const chord = 2 * radius * Math.cos(angle / 2);
  if (Math.min(...lengths) - along <= LENGTH_TOLERANCE) {
    return failed(`the radius ${radius} does not fit: the lines are ${lengths.map((l) => fmt(l)).join(' and ')} long at an angle of ${fmt((angle * 180) / Math.PI)}°, so the radius has to be below ${fmt(Math.min(...lengths) * half)}`);
  }
  if (!(radius > LENGTH_TOLERANCE) || !(along > LENGTH_TOLERANCE) || !(chord > LENGTH_TOLERANCE)) return failed(`the radius ${radius} is too small to draw: the arc would have no length`);
  const ends = u.map((dir): Vec2 => [p[0] + along * dir[0], p[1] + along * dir[1]]);
  const bisector: Vec2 = [u[0][0] + u[1][0], u[0][1] + u[1][1]];
  const reach = radius / Math.sin(angle / 2) / Math.hypot(bisector[0], bisector[1]);
  const center: Vec2 = [p[0] + reach * bisector[0], p[1] + reach * bisector[1]];
  if ([...ends, center].some((q) => Math.abs(q[0]) > MAX_NUMBER || Math.abs(q[1]) > MAX_NUMBER)) return failed(`the fillet reaches out of the range ±${MAX_NUMBER}`);

  const id = sketch.id;
  const [end0, end1, centre, arc] = [newId('p'), newId('p'), newId('p'), newId('c')];
  const endIds = [end0, end1];
  // counter-clockwise from start to end, the short way round
  const ccw = cross2(sub2(ends[0], center), sub2(ends[1], center)) > 0;
  const construction = curves[0].construction === true;
  const commands: Command[] = [
    ...endIds.map((point, i): Command => ({ type: 'addPoint', sketch: id, id: point, x: ends[i][0], y: ends[i][1] })),
    { type: 'addPoint', sketch: id, id: centre, x: center[0], y: center[1] },
    ...lines.map((line, i): Command => ({ type: 'setCurvePoint', sketch: id, id: line, point: curves[i].a === corner ? 'a' : 'b', to: endIds[i] })),
    { type: 'addCurve', sketch: id, id: arc, curve: { ...(construction ? { construction: true } : {}), type: 'arc', center: centre, start: ccw ? end0 : end1, end: ccw ? end1 : end0 } },
  ];
  const constrain = (constraint: Constraint): Id => {
    const constraintId = newId('k');
    commands.push({ type: 'addConstraint', sketch: id, id: constraintId, constraint });
    return constraintId;
  };
  const constraints = [
    ...lines.map((line) => constrain({ type: 'tangent', a: line, b: arc })),
    // the corner stays on both lines; a pointOnCurve the sketch has already is the one named
    ...lines.map((line) => {
      const held: Constraint = { type: 'pointOnCurve', point: corner, curve: line };
      return duplicateOf(sketch, held) ?? constrain(held);
    }),
  ];
  const radiusId = newId('k');
  commands.push({ type: 'addConstraint', sketch: id, id: radiusId, constraint: { type: 'radius', curve: arc, value: input.radius, driving: true } });

  // the plan of the fillet as data, as the cuts of D65 give it
  const starting = lines.filter((_, i) => curves[i].a === corner);
  const changes: CurveChanges = { changed: [...lines], restarted: starting, rekinded: [], removed: [], removedPoints: [], added: [arc], span: [], pieces: Object.fromEntries(lines.map((line) => [line, [line]])), stretches: [{ curves: [...lines], bounds: [end0, end1] }] };
  // the entries of mirrors and patterns: the arc joins the entry whose lines it rounds (D68), by
  // updateExternal of its input form, after the sketch commands and before the features
  let joined: ReturnType<typeof entryPatches>['joined'] = [];
  const entries: Id[] = [];
  // the sketch after the batch, its entries patched, which the rewrite by names reads (as the cuts do)
  let patchedSketch: SketchFeature = sketch;
  if (Object.values(sketch.external).some((ref) => ref.type === 'pattern')) {
    let afterSketch: SketchFeature;
    try {
      afterSketch = applyCommand(document, { type: 'batch', commands }).features.find((f): f is SketchFeature => f.id === id) as SketchFeature;
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    const points: Record<Id, Point2> = Object.fromEntries([...endIds.map((point, i): [Id, Point2] => [point, { x: ends[i][0], y: ends[i][1] }]), [centre, { x: center[0], y: center[1] }]]);
    const result: SketchResult = context.result ?? { points: {}, radii: {}, curves: {}, degreesOfFreedom: 0, conflicting: [], redundant: [], measurements: {}, valid: true, regions: [] };
    const found = entryPatches(sketch, toolBase(afterSketch, result, { points }), changes, 'fillet', namedOutside(document, id));
    commands.push(...entryCommands(sketch, found.patches));
    joined = found.joined;
    entries.push(...found.patches.map((patch) => patch.entry));
    const external = { ...afterSketch.external };
    for (const patch of found.patches) external[patch.entry] = { ...(external[patch.entry] as SketchPattern), sources: patch.sources };
    patchedSketch = { ...afterSketch, external };
  }

  // the features of the document: a region that passes the corner gets the arc, a stored region of
  // copies the copy of the arc (by names, whatever the count)
  const both = (list: readonly Id[]): boolean => lines.every((line) => list.includes(line));
  const patched: Id[] = [];
  const walls: Id[] = [];
  const withArc = (region: RegionRef): RegionRef => {
    const own = both(region.outerLoop) ? { ...region, outerLoop: [...region.outerLoop, arc].sort() } : region;
    return copiesByNames(own, changes, patchedSketch, joined) ?? own;
  };
  for (const feature of document.features) {
    const source = profileSourceOf(feature);
    const regions = source?.sketch === id && source.type === 'regions' ? source.regions.map(withArc) : undefined;
    if (source?.type === 'regions' && regions && JSON.stringify(regions) !== JSON.stringify(source.regions)) {
      commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { regions } } as FeaturePatch });
      patched.push(feature.id);
    } else if (source?.sketch === id && source.type === 'wall' && both(source.curves)) {
      commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { curves: [...source.curves, arc].sort() } } as FeaturePatch });
      patched.push(feature.id);
    } else if (source?.sketch === id && source.type === 'wall' && lines.some((line) => source.curves.includes(line))) walls.push(feature.id);
  }
  // what reads the lines directly: one function with the cuts of D65 (`readersOf`), given the plan
  // of the fillet as data
  const readers = readersOf(document, id, changes, sketch);
  const shortened = document.features.map((f) => f.id).filter((feature) => walls.includes(feature) || readers.shortened.includes(feature));
  return { ok: true, commands, ids: { arc: [arc], center: [centre], lines: [...lines], ends: endIds, constraints, radius: [radiusId], patched, moved: readers.moved, shortened, entries } };
}

// The fillet of one corner, or of several in one batch (D73). Each corner is filleted in the state
// the corners before it leave: the document after their commands (the sketch re-pointed, the
// regions and walls patched, the entries joined) and the positions of the points they added, so a
// line two corners share is shortened at both ends and a region gets both arcs. The lists of
// `ids` are those of each corner one after another; the features and the entries once each.
function fillet(context: SketchToolCall, input: SketchToolInputs['fillet'], newId: NewId): SketchToolResult {
  if (input.corners === undefined) return filletCorner(context, input.corner as Id, input, newId);
  let call = context;
  const commands: Command[] = [];
  const lists: Record<string, Id[]> = { corners: [...input.corners] };
  for (const corner of input.corners) {
    const made = filletCorner(call, corner, input, newId);
    if (!made.ok) return failed(`corner "${corner}": ${made.message}`);
    commands.push(...made.commands);
    for (const [name, ids] of Object.entries(made.ids)) lists[name] = [...(lists[name] ?? []), ...ids];
    let document: Document;
    try {
      document = applyCommand(call.document, { type: 'batch', commands: made.commands });
    } catch (error) {
      return failed(`corner "${corner}": ${error instanceof Error ? error.message : String(error)}`);
    }
    const sketch = document.features.find((f): f is SketchFeature => f.id === context.sketch.id) as SketchFeature;
    const added = Object.fromEntries(made.commands.flatMap((command): [Id, Point2][] => (command.type === 'addPoint' ? [[command.id, { x: command.x, y: command.y }]] : [])));
    call = { ...call, document, sketch, result: call.result && { ...call.result, points: { ...call.result.points, ...added } } };
  }
  // the features in the order of the timeline, the entries in the order of the sketch, each once
  const timeline = call.document.features.map((f) => f.id);
  const entries = Object.keys(call.sketch.external);
  const ordered = (ids: Id[] | undefined, order: Id[]): Id[] => [...new Set(ids ?? [])].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const ids: Record<string, Id[]> = {};
  for (const name of Object.keys(SKETCH_TOOLS.fillet.ids)) {
    ids[name] = name === 'patched' || name === 'moved' || name === 'shortened' ? ordered(lists[name], timeline) : name === 'entries' ? ordered(lists[name], entries) : (lists[name] ?? []);
  }
  return { ok: true, commands, ids };
}

// A short text of a number for a message.
const fmt = (value: number): string => String(Math.round(value * 1e4) / 1e4);

// Which point of an own curve is nearest to a point of the sketch, by the solved positions: what
// the app offers first when it re-points a curve (setCurvePoint). Undefined when the sketch has no
// such curve or point, or no position for them.
export function nearestCurvePoint(context: SketchToolContext, curve: Id, to: Id): CurvePointName | undefined {
  if (!has(context.sketch.curves, curve)) return undefined;
  const shape = context.sketch.curves[curve];
  const target = pointAt(context, to);
  if (!target) return undefined;
  let best: CurvePointName | undefined;
  let distance = Infinity;
  for (const name of CURVE_POINTS[shape.type]) {
    const at = pointAt(context, (shape as unknown as Record<string, Id>)[name]);
    if (at && dist2(at, target) < distance) [best, distance] = [name, dist2(at, target)];
  }
  return best;
}

// Runs a tool: checks the inputs against the catalog and returns the batch with the IDs of what it
// makes, or says why the input cannot be drawn. The commands are not executed here.
export function sketchTool<K extends SketchToolName>(tool: K, context: SketchToolCall, input: SketchToolInputs[K], newId: NewId): SketchToolResult {
  if (typeof tool !== 'string' || !has(SKETCH_TOOLS, tool)) return failed(`unknown sketch tool "${String(tool)}"; the tools are ${Object.keys(SKETCH_TOOLS).join(', ')}`);
  const problem = inputProblem(SKETCH_TOOLS[tool], context, input);
  if (problem) return failed(problem);
  const run: { [T in SketchToolName]: (context: SketchToolCall, input: SketchToolInputs[T], newId: NewId) => SketchToolResult } = {
    rectangle,
    polygon,
    fillet,
    trim: (call, given, ids) => cutTool(call, { tool: 'trim', ...given }, ids),
    extend: (call, given, ids) => cutTool(call, { tool: 'extend', ...given }, ids),
    split: (call, given, ids) => cutTool(call, { tool: 'split', ...given }, ids),
    projectSketch,
  };
  return (run[tool] as (context: SketchToolCall, input: SketchToolInputs[K], newId: NewId) => SketchToolResult)(context, input, newId);
}

// Every text in a document: IDs, and also references to entities that are gone. A feature may
// refer to a removed entity on purpose (it is then in error until the reference is repaired); an
// entity made anew under that ID would quietly take the reference over.
function textsOf(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) textsOf(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      textsOf(item, into);
    }
  }
  return into;
}

// A supplier of IDs the document does not have: `<prefix><kind><number>`, counted up from 1 for
// every kind. IDs it has handed out are not handed out again, and neither is any text the
// features of the document contain: an ID that a region of a profile still names, though its
// curve was removed, stays taken; so does an ID a section of the document names (the feature of an
// entry of body properties whose body is gone, D48).
export function freshIds(doc: Document, prefix = ''): NewId {
  // an ID a section of the document still names (an entry of body properties) is not handed out
  const used = textsOf(doc.features, new Set([...documentIds(doc), ...namedBySections(doc)]));
  const counters = new Map<string, number>();
  return (kind) => {
    let n = counters.get(kind) ?? 1;
    while (used.has(`${prefix}${kind}${n}`)) n++;
    counters.set(kind, n + 1);
    const id = `${prefix}${kind}${n}`;
    used.add(id);
    return id;
  };
}
