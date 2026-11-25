// Trim, extend and split (D65): sketch curves cut at the points where other curves meet them, as
// batches of commands every build knows (addPoint, addCurve, setCurvePoint, removeEntity,
// addConstraint, removeConstraint, updateFeature). The design is docs/d36/6e-trim-extend-split/
// design.md; the rules are in docs/architecture/sketch.md, "Sketch tools".
//
// The work goes in three stages:
// 1. The contacts (`curveContacts` of sketch.ts, each with its kind) become events: a place, the
//    curves cut there and the curves the point is held on. The points of a circle are pooled over
//    the batch; a circle with one point is not cut. Each place gets one point, used or made.
// 2. A model of the sketch after the batch: the curves cut into pieces (the keeper keeps the ID),
//    the constraints moved to where they belong, the holds, the ends cut off, the joins. The batch
//    is the difference between the sketch and the model, in a fixed order, and the plan of the
//    batch as data (`CurveChanges`).
// 3. The features over the sketch: their regions followed by the faces of the cut sketch (the face
//    rule), their walls and the edge lists of their chamfers and fillets patched, and the lists of
//    what reads a changed curve (`readersOf`, which the fillet of sketch-tools.ts calls as well).
//
// The places the later packages plug into (design.md, "Plug-in points") keep their names:
// `curvePredicates`, `CurveChanges`, `readersOf`, `piecesOf`, `reshapedProbes`, `contactFix`,
// `repairsByDefault`, `CUT_IDS`; the world of a sketch is `references/world.ts`.
import { MAX_NUMBER } from './catalog';
import { applyCommand, entryInput } from './document';
import { evaluateNumber } from './expression';
import { inside } from './recompute/outline';
import { entryOrder } from './references/derive';
import { derivedOrigin, entityOf, kindOf } from './references/index';
import { type SketchBase, type SketchWorld, cutInMemory, sketchWorld, toolBase } from './references/world';
import { DOCUMENT_SECTIONS, namedBySections } from './sections/index';
import { type ContactKind, type CurveContacts, type Profile, type Region, type SketchCurve, type SketchGeometry, type TightPlace, curveContacts, curvesTouch, joinsOf, lineExtent, profileOf, profileProblem, sameRegion } from './sketch';
import { constraintKey, constraintOperands, constraintPath, curvePoints, isDimension, isDriving } from './sketch-content';
import type { NewId, SketchToolCall, SketchToolContext, SketchToolResult } from './sketch-tools';
import type { Command, Constraint, Curve, CurvePointName, CurveShape, Document, EdgeName, Expr, FaceName, Feature, FeaturePatch, Id, ParameterResult, PlaneRef, Point2, ProfileSource, RegionRef, SketchFeature, SketchPattern, SketchProjection, SketchResult, Vec2 } from './types';
import { LENGTH_TOLERANCE, ORIGIN, canonicalEdge, dist2, has, isOriginAxis, unreachable } from './util';

// ---------------------------------------------------------------- what reads a profile (D52)

// Which features read a profile from a sketch, by feature type: a feature type added later does
// not compile until it says whether it has a profile source (the fillet and the cuts patch its
// regions and walls).
const PROFILE_SOURCES: { [T in Feature['type']]: (feature: Extract<Feature, { type: T }>) => ProfileSource | undefined } = {
  plane: () => undefined,
  sketch: () => undefined,
  extrude: (feature) => feature.profile,
  pattern: () => undefined,
  mesh: () => undefined,
  hole: () => undefined,
  combine: () => undefined,
  split: () => undefined,
  revolve: (feature) => feature.profile,
  chamfer: () => undefined,
  fillet: () => undefined,
  insert: () => undefined,
};
export const profileSourceOf = (feature: Feature): ProfileSource | undefined => (PROFILE_SOURCES[feature.type] as (f: Feature) => ProfileSource | undefined)(feature);

// The side faces of a line and of a wall along it are named by the curve.
export const sideOf = (face: FaceName, curves: readonly Id[]): boolean => (face.role === 'side' || face.role === 'wallSide') && curves.includes(face.curve);
export const planeOn = (plane: PlaneRef, curves: readonly Id[]): boolean => plane.kind === 'face' && sideOf(plane.face, curves);

// Every face name in a value (a feature, a section entry): every object with a `feature` and
// a `role`, at any depth (planes, projected edges, extents up to a face, edges of chamfers).
function facesIn(value: unknown, into: FaceName[] = []): FaceName[] {
  if (Array.isArray(value)) for (const item of value) facesIn(item, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (typeof o.feature === 'string' && typeof o.role === 'string') into.push(o as unknown as FaceName);
    for (const item of Object.values(o)) facesIn(item, into);
  }
  return into;
}
// Every axis on a line of a sketch in a value (`sketchLine` of AxisRef), at any depth.
function sketchLinesIn(value: unknown, sketch: Id, into: Id[] = []): Id[] {
  if (Array.isArray(value)) for (const item of value) sketchLinesIn(item, sketch, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.kind === 'sketchLine' && o.sketch === sketch && typeof o.line === 'string') into.push(o.line);
    for (const item of Object.values(o)) sketchLinesIn(item, sketch, into);
  }
  return into;
}
function sketchPointsIn(value: unknown, sketch: Id, into: Id[] = []): Id[] {
  if (Array.isArray(value)) for (const item of value) sketchPointsIn(item, sketch, into);
  else if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.kind === 'sketchPoint' && o.sketch === sketch && typeof o.point === 'string') into.push(o.point);
    for (const item of Object.values(o)) sketchPointsIn(item, sketch, into);
  }
  return into;
}
// Every text in a value.
function textsIn(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') into.add(value);
  else if (Array.isArray(value)) for (const item of value) textsIn(item, into);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) textsIn(item, into);
  return into;
}

// ---------------------------------------------------------------- the inputs

// `on`: a trim or an extend of a curve that forms regions first cuts every other contact of such
// curves in the sketch; `off`: its own curve alone is cut and its points are held on the curves
// there. Left out, it follows the document (`repairsByDefault`).
export type Repair = 'on' | 'off';
export interface TrimInput {
  at: Vec2;
  curve?: Id;
  with?: Id;
  repair?: Repair;
}
export interface ExtendInput {
  curve: Id;
  end: Exclude<CurvePointName, 'center'>;
  with?: Id;
  repair?: Repair;
}
export interface SplitInput {
  curve?: Id;
  with?: Id;
  at?: Vec2;
}
export type CutRequest = ({ tool: 'trim' } & TrimInput) | ({ tool: 'extend' } & ExtendInput) | ({ tool: 'split' } & SplitInput);

// The lists every cut returns (the `ids` of the three tools), each always there, in this order.
// 6c appended `entries` after `broken` (D68).
const ENTRIES_LIST =
  'entries of mirrors and patterns of the sketch the batch changed (updateExternal of the input form, expressions kept: the pieces of a cut source in its place, a removed source left out, a curve that closes the gap a trim or a fillet opened in the listed curves added), and those left without their axis or direction line; in the order of the entries';
export const CUT_IDS = {
  changed: 'curves that keep their ID and were changed: re-pointed, cut into pieces, or a circle that became an arc (the keeper of each cut curve), in the order of their IDs',
  added: 'new curves: for each changed curve in the order of `changed`, its new pieces in its own direction (a line from `a` to `b`, an arc counter-clockwise); span lines are in `span`, not here. The list is flat: to trim one of them, give `trim` the place and leave `curve` out',
  span: 'construction lines over the old ends of a line that was cut or re-pointed and carried equalLength or midpoint; those constraints were moved onto them; in the order of `changed`',
  points: 'the points at the cuts, new or already there, each once, at its first place in the order of `changed`, each curve in its own direction (extend: the new end last)',
  constraints:
    'the constraints the tool added, in the order of the batch: a piece held on the line of its curve, an old end held on the line or circle of its curve, a cut point held on a curve that is not cut there, equalRadius of arcs of one circle that share no end, a tangency between a line piece and an arc piece at a point where the two only touched, coincident of two ends at one place',
  reattached: 'constraints that keep their ID and now name another curve, in the order of their IDs: a tangency moved to the pieces that have the common end, constraints moved to a sibling piece or to a span line, the constraints of a circle that became an arc',
  removed: 'curves, points and constraints the batch removes for good, in that order and each by ID: the trimmed piece when it was a whole curve, cut-off ends nothing else names, constraints that went with them, became identities, would repeat one the sketch has (a driving constraint of the same kind and operands; the one there stays, unless only the moved one has an expression, which then stays instead) or would name one curve twice',
  uncut:
    'curves left whole at a place where something touches them, in the order of their IDs: a circle with one point only, a circle a generated profile names as an operand, two arcs or circles that only touch each other (both are listed), a curve of reference or derived geometry that forms regions and is met by an own curve (that curve is listed, not the own one: it is the one no tool can cut). The profile stays invalid there; the query sketchContacts says where and why',
  patched: 'features the batch changed in the same batch (updateFeature), in the order of the timeline: the regions or the wall of an extrusion or a revolve over the sketch, and the edges of a chamfer or a fillet that named an edge of a side face of a cut curve',
  dropped:
    'features of which a region is gone: no region after the batch holds any of it (its outline was opened), or a region left with no curve by the rewrite of `pending`; dropped from the feature when it has other regions (the feature is then also in `patched`), else left and the feature ends in noProfile. Also features with a region that could not be followed: it could not be rebuilt as it was, the faces could not be built while the sketch after the batch is valid, or a face next to a loop without exact curves was too thin to be told inside from outside; that region is left in their list as it is. A region is followed when it names a changed curve, when it was a region before the batch, or when the batch makes an invalid profile valid and the sketch has every curve the region names (a region left from `pending`); a region that is none of these is left alone and its feature is in no list. In the order of the timeline',
  pending:
    'features whose regions name a changed curve while the sketch still has contacts after the batch (one the tools do not cut, one that split with `with` or `at` was not asked to cut, or one left by a trim or an extend with the repair off): their regions were rewritten by names (each changed curve replaced by its pieces that stay; the feature is also in `patched`). A region whose curves were only cut still names a closed outline, and the next tool that leaves the sketch valid follows it. A region whose outline lost a piece (a trim with the repair off, or beside a contact no tool can cut) names an open chain: no later tool can follow it, the tool that next leaves the sketch valid lists the feature in `dropped` (whatever curve it changes), and the region has to be picked again; in the order of the timeline',
  reshaped: 'features with a region that keeps its name while the batch changed the holes inside it: a trim opened the outline of a hole (the hole is filled, or smaller), or an extension closed a loop inside the region (a new hole). The reference does not change and the body does; in the order of the timeline',
  moved: 'sketches and plane features on a side face of a line whose start `a` was re-pointed: their plane moved along the line; in the order of the timeline',
  shortened:
    'features that read a face of a changed curve directly and are not in `moved`: walls along a curve that lost a piece and chamfers and fillets whose edge lost a piece (both also in `patched`), sketches that project an edge of such a face, sketches that project a changed curve that keeps its ID (only the piece that kept it is projected), chamfers and fillets of an edge of such a face with a face of another feature (which piece meets that face is not known from the sketch, so the edge is left as it is), features that name the face of a chamfer or a fillet whose edge was rewritten; in the order of the timeline',
  broken:
    'features and sections that name what the batch removes or renames: a removed curve or a face of it, a sketch that projects a removed curve or point or a circle that became an arc (its projection keeps its last place, brokenProjection), an axis on it (also of a joint), a copy of a removed curve (a mirror or pattern of the sketch) or a face of it, a wall left with no curve, the straight end of a wall (wallEnd) whose chain no longer ends at that point, a chamfer or a fillet with an edge that no piece has any more and that is left in its list because something names a face of the blend at its place or a later one (a face is named by the place of its edge, so taking the edge out would hand those names to other faces), or because it is the only edge and a list may not be empty; features in the order of the timeline, then the IDs of section entries',
  entries: ENTRIES_LIST,
} as const;
export type CutIds = { [K in keyof typeof CUT_IDS]: Id[] };

// ---------------------------------------------------------------- the predicates of a curve

// The only place that says what a tool may cut, what makes regions and what holds a point
// (design.md, "Where the tools cut"). 6c, 6b, 6d and 6f add their kinds here.
// - `mayCut`: an own line, arc or circle that no generated profile names as an operand.
// - `formsRegions`: 6a's flag `regions` (an own curve that is not a construction curve).
// - `holdsPoint`: an own or a reference line, arc or circle (a projected edge, an axis).
export interface CurvePredicates {
  mayCut(curve: SketchCurve): boolean;
  formsRegions(curve: SketchCurve): boolean;
  holdsPoint(curve: SketchCurve): boolean;
}
// The circles a generated profile of the document names as operands.
function generatedCircles(document: Document, sketch: Id): Set<Id> {
  const out = new Set<Id>();
  for (const feature of document.features) {
    const source = profileSourceOf(feature);
    if (source?.type === 'generated' && source.sketch === sketch) for (const operand of Object.values(source.operands)) out.add(operand);
  }
  return out;
}
const simpleCurve = (curve: SketchCurve): boolean => {
  switch (curve.shape.type) {
    case 'line':
    case 'arc':
    case 'circle':
      return true;
    default:
      return unreachable(curve.shape, 'curve');
  }
};
export function curvePredicates(document: Document, sketch: SketchFeature): CurvePredicates {
  const generated = generatedCircles(document, sketch.id);
  return {
    mayCut: (curve) => curve.source === 'own' && simpleCurve(curve) && !generated.has(curve.id),
    formsRegions: (curve) => curve.regions,
    holdsPoint: (curve) => (curve.source === 'own' || curve.source === 'reference') && simpleCurve(curve),
  };
}

// What split without a curve does at a contact, for the tools and for the query alike: `cut`,
// `join`, or `none` with the reason (design.md, "Plug-in points"). A circle with one point only
// is decided by the caller, once every contact is found. Undefined: not listed (6e never answers
// it; 6c does for the image of a contact of two sources, 6b for the ends of an own curve and a
// projection that forms regions).
export type ContactFix = { fix: 'cut' | 'join' } | { fix: 'none'; why: string } | undefined;
export function contactFix(a: SketchCurve, b: SketchCurve, kind: ContactKind | 'ends', predicates: CurvePredicates, sketch: SketchFeature): ContactFix {
  // copies of a mirror or pattern (D68): never cut
  const [ca, cb] = [a.source === 'derived' ? copyParts(sketch, a.id) : undefined, b.source === 'derived' ? copyParts(sketch, b.id) : undefined];
  if (ca && cb) {
    // the image of a contact of their two sources, which is listed and whose cut cures both
    if (ca.entry === cb.entry && ca.copy === cb.copy) return undefined;
    return { fix: 'none', why: copiesCross(a.id, b.id) };
  }
  const copy = ca ?? cb;
  if (copy) {
    const other = ca ? b : a;
    if (other.source === 'own') return { fix: 'none', why: ownCrossesCopy(ca ? a.id : b.id, copy.entry) };
    return { fix: 'none', why: copiesCross(a.id, b.id) };
  }
  const stuck = [a, b].find((curve) => !predicates.mayCut(curve));
  // a projection from a sketch that forms regions (D69): the way is an own outline over it
  const flagged = [a, b].find((curve) => curve.source === 'reference' && curve.regions && sketch.external[curve.id]?.type === 'sketch');
  if (flagged) {
    // Ends of it and of another curve that stay apart: the other is own (two flagged ends, or one
    // and a copy's, join by position), with a second own vertex at that place. Nothing needs a cut,
    // and a coincident with the projected end could be redundant: joining the own ends there,
    // which is listed with them, makes them one vertex, and the joins by position take the
    // projection's end in. Not listed.
    if (kind === 'ends') return undefined;
    const ref = sketch.external[flagged.id] as SketchProjection;
    return { fix: 'none', why: flaggedNotCut(flagged.id, ref.sketch, ref.entity) };
  }
  if (stuck) {
    const why = stuck.source === 'own' ? `the circle "${stuck.id}" is an operand of a generated profile, which takes a whole circle` : `"${stuck.id}" is ${stuck.source === 'reference' ? 'reference' : 'derived'} geometry, which no tool cuts`;
    return { fix: 'none', why };
  }
  switch (kind) {
    case 'ends':
      return { fix: 'join' };
    case 'touch':
      return roundShape(a.shape) && roundShape(b.shape) ? { fix: 'none', why: `"${a.id}" and "${b.id}" are two round curves that only touch; no cut can be held there` } : { fix: 'cut' };
    case 'crossing':
    case 'end':
    case 'overlap':
      return { fix: 'cut' };
    default:
      return unreachable(kind, 'contact');
  }
}

// The reason of a contact with a projection from a sketch that forms regions (D69).
export const flaggedNotCut = (entry: Id, source: Id, entity: Id): string =>
  `${entry} is a projection that forms regions and is not cut: draw an own curve over it with the sketch tool projectSketch { sketch: "${source}", entities: ["${entity}"], as: "own" }, which also switches its flag off, then cut that; or remove the curve that meets it`;

// ---------------------------------------------------------------- copies of a mirror or pattern (D68)

// A copy `<entry>/<n>/<source>` of a mirror or pattern of the sketch, by its ID alone: the entry,
// the copy number as written, the source. Undefined for any other ID.
export function copyParts(sketch: SketchFeature, id: Id): { entry: Id; copy: string; source: Id } | undefined {
  const slash = id.indexOf('/');
  if (slash <= 0) return undefined;
  const entry = id.slice(0, slash);
  if (!has(sketch.external, entry) || sketch.external[entry].type !== 'pattern') return undefined;
  const rest = id.slice(slash + 1);
  const second = rest.indexOf('/');
  if (second <= 0) return undefined;
  return { entry, copy: rest.slice(0, second), source: rest.slice(second + 1) };
}
// The texts of a copy named to a tool, of a snap to one, and of a contact with one.
export const copyInTool = (id: Id, entry: Id, source: Id): string => `"${id}" is a copy of the mirror or pattern "${entry}"; change its source "${source}", and the copies follow`;
export const copyAsSnap = (id: Id, entry: Id, source: Id): string => `"${id}" is a copy of the mirror or pattern "${entry}": a new point cannot be tied to a copy; snap to its source "${source}", or place the point by its coordinates`;
const ownCrossesCopy = (copy: Id, entry: Id): string => `it is a copy of the mirror or pattern "${entry}" ("${copy}"), which is never cut: move the curve or change the source of the copy`;
const copiesCross = (a: Id, b: Id): string => `"${a}" and "${b}" are copies, which are never cut: change their sources, the count or the spacing`;

// Two entries have the same transform when the `transform` of their input forms is equal field by
// field, an expression compared as its text (`count: 'vents'` and `count: 5` are not the same).
export const sameTransform = (sketch: SketchFeature, a: Id, b: Id): boolean => JSON.stringify((entryInput(sketch, a) as SketchPattern).transform) === JSON.stringify((entryInput(sketch, b) as SketchPattern).transform);

// What a batch does to the derived entries of the sketch (design.md of 6c, "Copies and the sketch
// tools"): for each, the list of sources after the batch, from the plan of the batch (`changes`).
// 1. the pieces of a listed curve the batch cut or trimmed take its place, in every entry that
//    listed it; 2. a curve removed whole leaves the list (an entry left with none keeps its last);
// 3. (not for a split) a curve joins an entry when, in the sketch after the batch, its two ends are
//    two different open ends of the curves the entry lists that have its construction flag (an open
//    end: a vertex, by the joins of own points, at which exactly one of them ends), and the batch is
//    why: (i) it made the curve, re-pointed it or turned it from a circle into an arc, or (ii) the
//    curve was there and one of its ends is the vertex of a bound of a stretch the batch took out of
//    a listed curve with the curve's flag. A span line of the batch and a circle never join. A curve
//    no entry takes so, whose ends are open ends of two entries with the same transform, joins the
//    first of them in the order of the entries.
// 4. A point a copy of which something outside the sketch names (`named`: a generator's operand
//    `m/1/b`, an axis on a copied point) stays copied: when the batch takes it off every curve the
//    entry lists, it joins the list (the rule of old ends keeps the point itself; `origin` is always
//    there). The fallback of rule 2 comes after this rule, so an entry that keeps a point does not
//    keep a removed curve too.
// `after` is the base of the sketch after the batch, before its entries are patched. Answers the
// entries whose list changes, the curves that joined (with the listed curves at their two ends,
// which the rewrite of a stored region by names reads), and the entries left without their axis
// or direction line.
export interface EntryPatch {
  entry: Id;
  sources: Id[];
}
export interface JoinedCurve {
  curve: Id;
  entry: Id;
  between: [{ entry: Id; curve: Id }, { entry: Id; curve: Id }];
}
export function entryPatches(before: SketchFeature, after: SketchBase, changes: CurveChanges, tool: 'fillet' | 'trim' | 'extend' | 'split', named: ReadonlySet<string> = new Set()): { patches: EntryPatch[]; joined: JoinedCurve[]; orphaned: Id[] } {
  const own = after.sketch.curves;
  const entries = entryOrder(before).filter((id) => before.external[id].type === 'pattern');
  const lists = new Map<Id, Id[]>();
  const orphaned: Id[] = [];
  for (const entry of entries) {
    const ref = before.external[entry] as SketchPattern;
    const sources: Id[] = [];
    for (const source of ref.sources) {
      const now = has(changes.pieces, source) ? changes.pieces[source] : changes.removed.includes(source) ? [] : [source];
      for (const id of now) if (!sources.includes(id)) sources.push(id);
    }
    lists.set(entry, sources);
    const t = ref.transform;
    const lines = t.type === 'mirror' ? [t.axis] : t.type === 'linear' ? [t.direction, ...(t.second ? [t.second.direction] : [])] : [];
    if (lines.some((line) => changes.removed.includes(line))) orphaned.push(entry);
  }
  const joined: JoinedCurve[] = [];
  if (tool !== 'split' && entries.length > 0) {
    const vertex = joinsOf(after.pairs, after.geometry);
    const flag = (curve: Curve): boolean => curve.construction === true;
    const ends = (id: Id): [Id, Id] | undefined => {
      const curve = own[id];
      if (!curve || curve.type === 'circle') return undefined;
      const [p, q] = endsOf(curve);
      return has(after.geometry.points, p) && has(after.geometry.points, q) ? [vertex(p), vertex(q)] : undefined;
    };
    // the open ends of an entry's listed curves of one flag: vertex → the one curve that ends there
    const openOf = (entry: Id, construction: boolean): Map<Id, Id> => {
      const count = new Map<Id, Id[]>();
      for (const id of lists.get(entry) as Id[]) {
        const curve = own[id];
        if (!curve || flag(curve) !== construction) continue;
        for (const v of ends(id) ?? []) count.set(v, [...(count.get(v) ?? []), id]);
      }
      return new Map([...count].filter(([, curves]) => curves.length === 1).map(([v, curves]) => [v, curves[0]]));
    };
    const open = new Map<string, Map<Id, Id>>();
    const openEnds = (entry: Id, construction: boolean): Map<Id, Id> => {
      const key = `${entry}\u0000${construction}`;
      if (!open.has(key)) open.set(key, openOf(entry, construction));
      return open.get(key) as Map<Id, Id>;
    };
    const made = new Set([...changes.added, ...changes.changed, ...changes.rekinded]);
    const span = new Set(changes.span);
    // (ii): the vertices of the bounds of the stretches taken out of a curve the entry listed before
    // the batch, with that curve's flag
    const opened = (entry: Id, construction: boolean): Set<Id> => {
      const listed = (before.external[entry] as SketchPattern).sources;
      const out = new Set<Id>();
      for (const stretch of changes.stretches) {
        for (const bound of stretch.bounds) {
          // the curve the bound lies on: of a stretch over two curves, the one it is an end of after
          const on = stretch.curves.length === 1 ? stretch.curves[0] : stretch.curves.find((id) => own[id] !== undefined && endsOf(own[id]).includes(bound));
          if (on === undefined || !listed.includes(on) || !has(before.curves, on) || flag(before.curves[on]) !== construction) continue;
          if (has(after.geometry.points, bound)) out.add(vertex(bound));
        }
      }
      return out;
    };
    const candidates = Object.keys(own).filter((id) => !span.has(id) && ends(id) !== undefined && (ends(id) as [Id, Id])[0] !== (ends(id) as [Id, Id])[1]);
    const why = (id: Id, entries_: Id[]): boolean => {
      if (made.has(id)) return true;
      const construction = flag(own[id]);
      const [v1, v2] = ends(id) as [Id, Id];
      return entries_.some((entry) => {
        const bounds = opened(entry, construction);
        return bounds.has(v1) || bounds.has(v2);
      });
    };
    const taken = new Set<Id>();
    const additions = new Map<Id, Id[]>(entries.map((entry) => [entry, []]));
    for (const entry of entries) {
      const list = lists.get(entry) as Id[];
      for (const id of candidates) {
        if (list.includes(id)) continue;
        const construction = flag(own[id]);
        const [v1, v2] = ends(id) as [Id, Id];
        const at = openEnds(entry, construction);
        if (!at.has(v1) || !at.has(v2) || !why(id, [entry])) continue;
        (additions.get(entry) as Id[]).push(id);
        taken.add(id);
        joined.push({ curve: id, entry, between: [{ entry, curve: at.get(v1) as Id }, { entry, curve: at.get(v2) as Id }] });
      }
    }
    // between two entries with the same transform: the first of them in the order of the entries
    for (const id of candidates) {
      if (taken.has(id) || entries.some((entry) => (lists.get(entry) as Id[]).includes(id))) continue;
      const construction = flag(own[id]);
      const [v1, v2] = ends(id) as [Id, Id];
      for (let i = 0; i < entries.length && !taken.has(id); i++) {
        for (let j = 0; j < entries.length && !taken.has(id); j++) {
          if (i === j) continue;
          const [a, b] = [entries[i], entries[j]];
          const [atA, atB] = [openEnds(a, construction), openEnds(b, construction)];
          if (!atA.has(v1) || !atB.has(v2) || !why(id, [a, b]) || !sameTransform(before, a, b)) continue;
          const first = i < j ? a : b;
          (additions.get(first) as Id[]).push(id);
          taken.add(id);
          joined.push({ curve: id, entry: first, between: [{ entry: a, curve: atA.get(v1) as Id }, { entry: b, curve: atB.get(v2) as Id }] });
        }
      }
    }
    for (const entry of entries) lists.set(entry, [...(lists.get(entry) as Id[]), ...(additions.get(entry) as Id[])]);
  }
  for (const text of named) {
    if (!text.includes('/') || entityOf(before, text)?.kind !== 'point') continue;
    const origin = derivedOrigin(before, text);
    if (!origin || !lists.has(origin.entry) || (origin.source !== ORIGIN && !has(after.sketch.points, origin.source))) continue;
    const list = lists.get(origin.entry) as Id[];
    if (list.includes(origin.source) || list.some((id) => has(own, id) && curvePoints(own[id]).includes(origin.source))) continue;
    lists.set(origin.entry, [...list, origin.source]);
  }
  // an entry left with none keeps its last (after rule 4, which may have given it a point)
  for (const entry of entries) {
    const sources = (before.external[entry] as SketchPattern).sources;
    if ((lists.get(entry) as Id[]).length === 0) lists.set(entry, [sources[sources.length - 1]]);
  }
  const patches = entries.filter((entry) => JSON.stringify(lists.get(entry)) !== JSON.stringify((before.external[entry] as SketchPattern).sources)).map((entry) => ({ entry, sources: lists.get(entry) as Id[] }));
  return { patches, joined, orphaned };
}

// The commands of the patches of entries: `updateExternal` of the input form of each, its
// expressions kept.
export const entryCommands = (before: SketchFeature, patches: readonly EntryPatch[]): Command[] =>
  patches.map((patch) => ({ type: 'updateExternal', sketch: before.id, id: patch.entry, ref: { ...(entryInput(before, patch.entry) as SketchPattern), sources: patch.sources } }) as Command);

// A stored region of copies rewritten by names (a copy the count does not make now, so no face
// follows it): the copies of a cut source by their pieces (`piecesOf`), and the copy of a curve that
// joined an entry where the region holds, with one copy number, the copies of the two listed curves
// it stands between. Undefined when nothing changes.
export function copiesByNames(region: RegionRef, changes: CurveChanges, after: SketchFeature, joined: readonly JoinedCurve[]): RegionRef | undefined {
  let changed = false;
  const ids = region.outerLoop.flatMap((id) => {
    if (!id.includes('/')) return [id];
    const pieces = piecesOf(changes, after, id);
    if (pieces === undefined) return [id];
    changed = true;
    return pieces;
  });
  for (const join of joined) {
    const [first, second] = join.between;
    for (const id of ids) {
      if (!id.startsWith(`${first.entry}/`) || !id.endsWith(`/${first.curve}`)) continue;
      const copy = id.slice(first.entry.length + 1, id.length - first.curve.length - 1);
      if (copy.includes('/') || !ids.includes(`${second.entry}/${copy}/${second.curve}`)) continue;
      const added = `${join.entry}/${copy}/${join.curve}`;
      if (!ids.includes(added)) {
        ids.push(added);
        changed = true;
      }
    }
  }
  return changed ? { ...region, outerLoop: [...new Set(ids)].sort() } : undefined;
}

// Whether a trim or an extend without `repair` repairs: a feature of the document reads regions of
// the sketch (an extrusion or a revolve over its regions, suppressed or not), or a sketch projects
// a curve of this sketch with the region flag (D69): its outline is made of this sketch's curves,
// and a T left here is a T there, where nothing can cut it.
export function repairsByDefault(document: Document, sketch: Id): boolean {
  return document.features.some((feature) => {
    if (feature.type === 'sketch') return Object.values(feature.external).some((ref) => ref.type === 'sketch' && ref.sketch === sketch && ref.regions && ref.kind !== 'point');
    const source = profileSourceOf(feature);
    return source?.type === 'regions' && source.sketch === sketch;
  });
}

// ---------------------------------------------------------------- the sketch as the tools read it

const TAU = 2 * Math.PI;
const positive = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const tol = LENGTH_TOLERANCE;
const xy = (p: Point2): Vec2 => [p.x, p.y];

// The carrier of a curve with its parameter: a line from `a` (0) to `b` (1), beyond both; an arc by
// the angle from its start counter-clockwise; a circle by the angle from the x axis, in [0, 2π).
type Carrier = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; c: Vec2; r: number; from: number; sweep: number } | { type: 'circle'; c: Vec2; r: number };

function paramOf(carrier: Carrier, p: Vec2): number {
  switch (carrier.type) {
    case 'line': {
      const [dx, dy] = [carrier.b[0] - carrier.a[0], carrier.b[1] - carrier.a[1]];
      return ((p[0] - carrier.a[0]) * dx + (p[1] - carrier.a[1]) * dy) / (dx * dx + dy * dy);
    }
    case 'arc':
      return positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]) - carrier.from);
    case 'circle': {
      // an angle within the length tolerance of a full turn, measured along the circle, is 0: a cut
      // on the +x ray from the centre must not be the first or the last by the noise of the solver,
      // since the first piece keeps the ID (finding F3)
      const t = positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]));
      return (TAU - t) * carrier.r <= tol ? 0 : t;
    }
    default:
      return unreachable(carrier, 'carrier');
  }
}
function pointOn(carrier: Carrier, t: number): Vec2 {
  switch (carrier.type) {
    case 'line':
      return [carrier.a[0] + t * (carrier.b[0] - carrier.a[0]), carrier.a[1] + t * (carrier.b[1] - carrier.a[1])];
    case 'arc':
      return [carrier.c[0] + carrier.r * Math.cos(carrier.from + t), carrier.c[1] + carrier.r * Math.sin(carrier.from + t)];
    case 'circle':
      return [carrier.c[0] + carrier.r * Math.cos(t), carrier.c[1] + carrier.r * Math.sin(t)];
    default:
      return unreachable(carrier, 'carrier');
  }
}

// The piece of a curve as the app draws it.
export type PieceShape = { type: 'line'; a: Vec2; b: Vec2 } | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number } | { type: 'circle'; center: Vec2; radius: number };
function pieceShape(carrier: Carrier, from: number, to: number): PieceShape {
  switch (carrier.type) {
    case 'line':
      return { type: 'line', a: pointOn(carrier, from), b: pointOn(carrier, to) };
    case 'arc':
      return { type: 'arc', center: carrier.c, radius: carrier.r, from: carrier.from + from, sweep: to - from };
    case 'circle':
      return to - from >= TAU - 1e-12 ? { type: 'circle', center: carrier.c, radius: carrier.r } : { type: 'arc', center: carrier.c, radius: carrier.r, from, sweep: to - from };
    default:
      return unreachable(carrier, 'carrier');
  }
}

// The sketch as a tool reads it: the world of the sketch (references/world.ts) with the document,
// the predicates and the contacts of two curves, kept per pair.
interface World extends SketchWorld {
  doc: Document;
  sketch: SketchFeature;
  result: SketchResult;
  predicates: CurvePredicates;
  parameters?: Record<Id, ParameterResult>;
  contacts(a: Id, b: Id): CurveContacts;
}

const NO_CONTACT: CurveContacts = { points: [], ends: [], lying: false };
// A test of two curves whose boxes lie apart, by their carriers, so that pairs far apart are not
// tested (a sketch of many curves). Kept by the curves it is given.
function boxesApart(curves: ReadonlyMap<Id, SketchCurve>, geometry: SketchGeometry): (a: Id, b: Id) => boolean {
  const boxes = new Map<Id, [number, number, number, number] | undefined>();
  const boxOf = (id: Id): [number, number, number, number] | undefined => {
    if (boxes.has(id)) return boxes.get(id);
    const carrier = carrierIn(curves.get(id), geometry);
    let box: [number, number, number, number] | undefined;
    if (carrier) {
      switch (carrier.type) {
        case 'line':
          box = [Math.min(carrier.a[0], carrier.b[0]), Math.min(carrier.a[1], carrier.b[1]), Math.max(carrier.a[0], carrier.b[0]), Math.max(carrier.a[1], carrier.b[1])];
          break;
        case 'arc':
        case 'circle':
          box = [carrier.c[0] - carrier.r, carrier.c[1] - carrier.r, carrier.c[0] + carrier.r, carrier.c[1] + carrier.r];
          break;
        default:
          unreachable(carrier, 'carrier');
      }
    }
    boxes.set(id, box);
    return box;
  };
  return (a, b) => {
    const [p, q] = [boxOf(a), boxOf(b)];
    const margin = 10 * tol;
    return p !== undefined && q !== undefined && (p[2] + margin < q[0] || q[2] + margin < p[0] || p[3] + margin < q[1] || q[3] + margin < p[1]);
  };
}

function worldOf(doc: Document, sketch: SketchFeature, result: SketchResult, base: SketchWorld, parameters?: Record<Id, ParameterResult>): World {
  const { curves, geometry, joins } = base;
  const cache = new Map<string, CurveContacts>();
  const apart = boxesApart(curves, geometry);
  const swapEnds = (found: CurveContacts): CurveContacts => ({ ...found, ends: found.ends.map(([i, j]): [number, number] => [j, i]) });
  return {
    ...base,
    doc,
    sketch,
    result,
    parameters,
    predicates: curvePredicates(doc, sketch),
    contacts(a, b) {
      const [first, second] = a < b ? [a, b] : [b, a];
      const key = `${first}\u0000${second}`;
      let found = cache.get(key);
      if (!found) {
        const [ca, cb] = [curves.get(first), curves.get(second)];
        found = (ca && cb && !apart(first, second) ? curveContacts(ca, cb, joins, geometry) : undefined) ?? NO_CONTACT;
        cache.set(key, found);
      }
      // the ends are given as those of the first curve asked, then of the second
      return a < b ? found : swapEnds(found);
    },
  };
}

function worldOfContext(context: SketchToolCall): World | string {
  const { sketch, result, document } = context;
  if (!result) return `the sketch "${sketch.id}" has no solved state`;
  return worldOf(document, sketch, result, sketchWorld(toolBase(sketch, result)), context.parameters);
}

const curveOf = (world: World, id: Id): SketchCurve | undefined => world.curves.get(id);
const isOwn = (world: World, id: Id): boolean => has(world.sketch.curves, id);
const formsRegions = (world: World, id: Id): boolean => {
  const curve = curveOf(world, id);
  return curve !== undefined && world.predicates.formsRegions(curve);
};
const mayCut = (world: World, id: Id): boolean => {
  const curve = curveOf(world, id);
  return curve !== undefined && world.predicates.mayCut(curve);
};
const holdsPoint = (world: World, id: Id): boolean => {
  const curve = curveOf(world, id);
  return curve !== undefined && world.predicates.holdsPoint(curve);
};
// A curve that takes part in the profile and can be cut there: both curves of a contact are cut
// only when both are such curves.
const cuttable = (world: World, id: Id): boolean => formsRegions(world, id) && mayCut(world, id);
const position = (world: World, id: Id): Vec2 | undefined => (has(world.geometry.points, id) ? xy(world.geometry.points[id]) : undefined);
// A line is straight; an arc and a circle are round (a switch, so that a new kind does not compile
// until it says which it is).
function roundShape(shape: CurveShape): boolean {
  switch (shape.type) {
    case 'line':
      return false;
    case 'arc':
    case 'circle':
      return true;
    default:
      return unreachable(shape, 'curve');
  }
}
// The centre point of a round curve, none of a line.
function centreOf(curve: Curve): Id[] {
  switch (curve.type) {
    case 'line':
      return [];
    case 'arc':
    case 'circle':
      return [curve.center];
    default:
      return unreachable(curve, 'curve');
  }
}
const isRound = (world: World, id: Id): boolean => {
  const curve = curveOf(world, id);
  return curve !== undefined && roundShape(curve.shape);
};

// The carrier of a curve from positions; a line is the stretch `lineExtent` gives (an axis of the
// origin is a whole line).
function carrierIn(curve: SketchCurve | undefined, geometry: SketchGeometry): Carrier | undefined {
  if (!curve) return undefined;
  const at = (id: Id): Vec2 | undefined => (has(geometry.points, id) ? xy(geometry.points[id]) : undefined);
  const shape = curve.shape;
  switch (shape.type) {
    case 'line': {
      const extent = lineExtent(curve, geometry);
      if (!extent) return undefined;
      const [a, b] = [xy(extent.a), xy(extent.b)];
      return dist2(a, b) > tol ? { type: 'line', a, b } : undefined;
    }
    case 'circle': {
      const c = at(shape.center);
      const r = has(geometry.radii, curve.id) ? geometry.radii[curve.id] : undefined;
      return c && r !== undefined && r > tol ? { type: 'circle', c, r } : undefined;
    }
    case 'arc': {
      const [c, s, e] = [at(shape.center), at(shape.start), at(shape.end)];
      if (!c || !s || !e) return undefined;
      const from = Math.atan2(s[1] - c[1], s[0] - c[0]);
      const sweep = positive(Math.atan2(e[1] - c[1], e[0] - c[0]) - from) || TAU;
      const r = dist2(c, s);
      return r > tol && dist2(s, e) > tol ? { type: 'arc', c, r, from, sweep } : undefined;
    }
    default:
      return unreachable(shape, 'curve');
  }
}
const carrierOf = (world: World, id: Id): Carrier | undefined => carrierIn(curveOf(world, id), world.geometry);

// The points at the ends of a curve (a line `a`, `b`; an arc `start`, `end`; none for a circle).
function endsOf(curve: Curve | SketchCurve['shape']): Id[] {
  switch (curve.type) {
    case 'line':
      return [curve.a, curve.b];
    case 'arc':
      return [curve.start, curve.end];
    case 'circle':
      return [];
    default:
      return unreachable(curve, 'curve');
  }
}
// The names of the ends of a curve of a kind (a circle has none).
function endNames(curve: Curve): readonly ('a' | 'b' | 'start' | 'end')[] {
  switch (curve.type) {
    case 'line':
      return ['a', 'b'];
    case 'arc':
      return ['start', 'end'];
    case 'circle':
      return [];
    default:
      return unreachable(curve, 'curve');
  }
}
const endPositions = (world: World, id: Id): Vec2[] => {
  const curve = curveOf(world, id);
  return curve
    ? endsOf(curve.shape).flatMap((p): Vec2[] => {
        const q = position(world, p);
        return q ? [q] : [];
      })
    : [];
};
const atEnd = (world: World, id: Id, p: Vec2): boolean => endPositions(world, id).some((q) => dist2(p, q) <= tol);

// The nearest place of a carrier to a point, by its parameter (a line within its ends, an arc within
// its sweep).
function nearestParam(carrier: Carrier, p: Vec2): number {
  switch (carrier.type) {
    case 'line':
      return Math.min(1, Math.max(0, paramOf(carrier, p)));
    case 'arc': {
      const t = paramOf(carrier, p);
      if (t <= carrier.sweep) return t;
      return t - carrier.sweep < TAU - t ? carrier.sweep : 0;
    }
    case 'circle':
      return paramOf(carrier, p);
    default:
      return unreachable(carrier, 'carrier');
  }
}
const distanceTo = (carrier: Carrier, p: Vec2): number => dist2(pointOn(carrier, nearestParam(carrier, p)), p);
function curveHas(carrier: Carrier, p: Vec2): boolean {
  switch (carrier.type) {
    case 'line': {
      const t = paramOf(carrier, p);
      return t >= -1e-12 && t <= 1 + 1e-12 && dist2(pointOn(carrier, t), p) <= tol;
    }
    case 'arc':
      return Math.abs(dist2(carrier.c, p) - carrier.r) <= tol && (paramOf(carrier, p) <= carrier.sweep || dist2(pointOn(carrier, 0), p) <= tol);
    case 'circle':
      return Math.abs(dist2(carrier.c, p) - carrier.r) <= tol;
    default:
      return unreachable(carrier, 'carrier');
  }
}
// Do two carriers lie on one line or one circle (by position, within the tolerance)?
function sameCarrier(p: Carrier, q: Carrier): boolean {
  if (p.type === 'line' && q.type === 'line') {
    const [dx, dy] = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
    const length = Math.hypot(dx, dy);
    const off = (v: Vec2): number => Math.abs(dx * (v[1] - p.a[1]) - dy * (v[0] - p.a[0])) / length;
    return off(q.a) <= tol && off(q.b) <= tol;
  }
  if (p.type !== 'line' && q.type !== 'line') return dist2(p.c, q.c) <= tol && Math.abs(p.r - q.r) <= tol;
  return false;
}

// ---------------------------------------------------------------- the cuts of a curve

// The curves whose contacts with X are cuts of X: for a curve that forms regions, the other curves
// that form regions and may be cut (a contact with one that may not be cut is no cut of either);
// for a construction curve, every other curve that can hold a point; only `with` when it is given.
function cuttersOf(world: World, X: Id, withId?: Id): Id[] {
  if (withId !== undefined) return [withId];
  const all = [...world.curves.keys()].filter((id) => id !== X);
  return formsRegions(world, X) ? all.filter((id) => cuttable(world, id)) : all.filter((id) => holdsPoint(world, id));
}

// The places a circle gets from the contacts of curves that form regions and may be cut: a touch
// with a circle is a cut only where the circle gets two points or more.
function circlePlaces(world: World, circle: Id): number {
  const places: Vec2[] = [];
  const own = curveOf(world, circle) as SketchCurve;
  for (const id of world.curves.keys()) {
    if (id === circle || !cuttable(world, id)) continue;
    for (const contact of world.contacts(circle, id).points) {
      // only where split without a curve would cut: a touch of two round curves is never cut
      if (contactFix(own, curveOf(world, id) as SketchCurve, contact.kind, world.predicates, world.sketch)?.fix !== 'cut') continue;
      if (!places.some((p) => dist2(p, contact.at) <= tol)) places.push(contact.at);
    }
  }
  return places.length;
}
// Is a touch of X with C a cut? Only where both curves are cut there (`bothCut`: both form regions
// and may be cut, and the other curve is cut at a contact: the repair is on, or a split), one of
// them is a line, and a circle among them gets two points or more (design.md, "A touch is cut only
// where a tangency can hold it").
function touchIsCut(world: World, X: Id, C: Id, bothCut: boolean): boolean {
  if (!bothCut || !cuttable(world, X) || !cuttable(world, C)) return false;
  if (isRound(world, X) === isRound(world, C)) return false;
  const round = isRound(world, X) ? X : C;
  return curveOf(world, round)?.shape.type !== 'circle' || circlePlaces(world, round) >= 2;
}

// A cut of X: a contact away from the ends of X, with the curve it is a contact with.
interface Cut {
  at: Vec2;
  t: number;
  with: Id;
  touch: boolean; // a touch that is a cut: a tangency holds the point
}
// The cuts of X with the given curves, one per place, sorted along X, and the touches that are no
// cuts (they bound no piece and stop no extension; a trim through one is refused).
function cutsOf(world: World, X: Id, cutters: Id[], carrier: Carrier, bothCut: boolean): { cuts: Cut[]; touches: Cut[] } {
  const cuts: Cut[] = [];
  const touches: Cut[] = [];
  for (const C of cutters) {
    for (const contact of world.contacts(X, C).points) {
      const p = contact.at;
      if (atEnd(world, X, p)) continue;
      const touch = contact.kind === 'touch';
      if (touch && !touchIsCut(world, X, C, bothCut)) {
        if (!touches.some((other) => dist2(other.at, p) <= tol)) touches.push({ at: p, t: paramOf(carrier, p), with: C, touch: false });
        continue;
      }
      if (cuts.some((cut) => dist2(cut.at, p) <= tol)) continue;
      cuts.push({ at: p, t: paramOf(carrier, p), with: C, touch });
    }
  }
  return { cuts: cuts.sort((p, q) => p.t - q.t), touches };
}

// The piece of X around the parameter `t` between the cuts: its bounds as cuts (undefined at an end
// of a line or an arc), and its range of parameters. A circle with no cut or one cut is one piece
// from the cut round to itself (the whole circle).
interface Piece {
  lo?: Cut;
  hi?: Cut;
  from: number;
  to: number;
}
function pieceAround(carrier: Carrier, cuts: Cut[], t: number): Piece {
  switch (carrier.type) {
    case 'line':
    case 'arc': {
      const end = carrier.type === 'line' ? 1 : carrier.sweep;
      const lo = [...cuts].reverse().find((cut) => cut.t < t);
      const hi = cuts.find((cut) => cut.t >= t);
      return { lo, hi, from: lo?.t ?? 0, to: hi?.t ?? end };
    }
    case 'circle': {
      if (cuts.length < 2) return { from: cuts[0]?.t ?? 0, to: (cuts[0]?.t ?? 0) + TAU };
      const hiIndex = cuts.findIndex((cut) => cut.t >= t);
      const hi = hiIndex < 0 ? cuts[0] : cuts[hiIndex];
      const lo = hiIndex <= 0 ? cuts[cuts.length - 1] : cuts[hiIndex - 1];
      const from = lo.t;
      const to = hi.t > lo.t ? hi.t : hi.t + TAU;
      return { lo, hi, from, to };
    }
    default:
      return unreachable(carrier, 'carrier');
  }
}
// Is a parameter strictly inside the piece (anywhere on a piece that is a whole curve)?
function paramInPiece(carrier: Carrier, piece: Piece, t: number): boolean {
  if (!piece.lo && !piece.hi) return true;
  if (carrier.type === 'circle') {
    const u = t < piece.from ? t + TAU : t;
    return u > piece.from && u < piece.to;
  }
  return t > piece.from && t < piece.to;
}
// Is a place on the piece of X a trim removes? Strictly between its bounds; an end of X belongs to
// the piece when no bound is on its side (it goes with the piece), so a contact there is not cut.
function inPiece(world: World, X: Id, carrier: Carrier, piece: Piece, p: Vec2): boolean {
  if (!curveHas(carrier, p)) return false;
  if ((piece.lo && dist2(piece.lo.at, p) <= tol) || (piece.hi && dist2(piece.hi.at, p) <= tol)) return false;
  if (carrier.type === 'circle') {
    if (!piece.lo) return true; // the whole circle
    return paramInPiece(carrier, piece, paramOf(carrier, p));
  }
  const [start, end] = endPositions(world, X);
  if (start && dist2(start, p) <= tol) return !piece.lo;
  if (end && dist2(end, p) <= tol) return !piece.hi;
  return paramInPiece(carrier, piece, paramOf(carrier, p));
}

// ---------------------------------------------------------------- stage 1: events and points

// A place where curves are cut (`cut`: each gets a node there unless it ends there) and where the
// point is held on curves that are not cut (`hold`). A `bound` is a place a trim cuts its curve at,
// or the new end of an extension: there the curve is cut even when the other one cannot be.
// `touch`: the two curves only touch there; when both are cut, a tangency holds the point.
interface Event {
  at: Vec2;
  cut: Id[];
  hold: Id[];
  bound: boolean;
  involved: Id[]; // every curve the event names, for finding a point that is there already
  touch?: [Id, Id];
  endsHere?: Id[]; // curves that end at the place after the batch (the extended curve at its new end)
}
const event = (at: Vec2, cut: Id[], hold: Id[], bound = false, touch?: [Id, Id]): Event => ({ at, cut, hold, bound, involved: [...cut, ...hold], ...(touch ? { touch } : {}) });

// A contact of X with a curve C, as an event: both cut when both take part in the profile and may
// be cut and the other curve is cut (`bothCut`); else X cut and the point held on C when it can
// hold one.
const contactEvent = (world: World, X: Id, C: Id, cut: Cut, bound: boolean, bothCut: boolean): Event =>
  bothCut && cuttable(world, X) && cuttable(world, C) ? event(cut.at, [X, C], [], bound, cut.touch ? [X, C] : undefined) : event(cut.at, [X], holdsPoint(world, C) ? [C] : [], bound);

interface Node {
  point: Id;
  at: Vec2;
}
interface Resolved {
  nodes: Map<Id, Node[]>; // the points a curve is cut at, by curve
  holds: [Id, Id][]; // a point held on a curve that is not cut there
  added: Map<Id, Vec2>; // new points
  uncut: Set<Id>;
  touches: { point: Id; curves: [Id, Id] }[]; // touches cut on both curves
  pointOf(at: Vec2): Id | undefined; // the point made or found at a place of an event
  failed?: string; // a refusal: a bound at a touch whose circle gets that one point only
}

// Pools the points of the circles, drops what cannot be cut and gives each place one point.
function resolve(world: World, events: Event[], newId: NewId, extra: { at: Vec2; involved: Id[] }[] = []): Resolved {
  const uncut = new Set<Id>();
  let failed: string | undefined;
  // a curve that ends at the place is not cut there
  for (const e of events) e.cut = e.cut.filter((id) => !atEnd(world, id, e.at));
  // the circles: cut when they get two points or more over the batch, never one that may not be cut
  for (;;) {
    const counts = new Map<Id, Vec2[]>();
    for (const e of events) {
      for (const id of e.cut) {
        if (curveOf(world, id)?.shape.type !== 'circle') continue;
        const list = counts.get(id) ?? [];
        if (!list.some((p) => dist2(p, e.at) <= tol)) list.push(e.at);
        counts.set(id, list);
      }
    }
    const bad = [...counts.entries()].filter(([id, list]) => list.length < 2 || !mayCut(world, id)).map(([id]) => id);
    if (bad.length === 0) break;
    for (const e of events) {
      const lost = e.cut.filter((id) => bad.includes(id));
      if (lost.length === 0) continue;
      for (const id of lost) uncut.add(id);
      // a bound at a touch whose round curve is not cut would be a point held on a curve the other
      // only touches: the double root a tangency exists to avoid (design.md, "A touch is cut only
      // where a tangency can hold it")
      const touched = e.bound && e.touch ? lost.find((id) => e.touch?.includes(id)) : undefined;
      if (touched !== undefined && failed === undefined) {
        const other = (e.touch as [Id, Id]).find((id) => id !== touched) as Id;
        failed = `"${other}" only touches the circle "${touched}" at ${fmt(e.at)}, and the circle would get that one point only, so neither curve can be cut there; draw across the circle to give it a second point, or remove the whole curve with removeEntity`;
      }
      e.cut = e.cut.filter((id) => !lost.includes(id));
      if (e.bound) e.hold.push(...lost);
      else [e.cut, e.hold] = [[], []];
    }
  }
  const live = events.filter((e) => e.cut.length > 0 || (e.bound && e.hold.length > 0));
  // one point per place: one already there that a curve of the place ends at or holds, or a new one
  const places: { at: Vec2; point: Id }[] = [];
  const added = new Map<Id, Vec2>();
  const own = (id: Id): boolean => id === ORIGIN || has(world.sketch.points, id);
  const pointFor = (at: Vec2, involved: Id[]): Id => {
    const known = places.find((place) => dist2(place.at, at) <= tol);
    if (known) return known.point;
    const candidates = new Set<Id>();
    for (const id of involved) {
      const curve = curveOf(world, id);
      if (curve) for (const p of endsOf(curve.shape)) if (own(p)) candidates.add(p);
    }
    for (const c of Object.values(world.sketch.constraints)) if (c.type === 'pointOnCurve' && involved.includes(c.curve) && own(c.point)) candidates.add(c.point);
    let best: Id | undefined;
    let distance = tol;
    for (const id of [...candidates].sort()) {
      const p = position(world, id);
      if (p && dist2(p, at) <= distance) [best, distance] = [id, dist2(p, at)];
    }
    const point = best ?? newId('p');
    if (!best) added.set(point, at);
    places.push({ at, point });
    return point;
  };
  const nodes = new Map<Id, Node[]>();
  const holds: [Id, Id][] = [];
  const touches: { point: Id; curves: [Id, Id] }[] = [];
  for (const place of extra) pointFor(place.at, place.involved);
  for (const e of live) {
    const point = pointFor(e.at, e.involved);
    for (const id of e.cut) {
      const list = nodes.get(id) ?? [];
      if (!list.some((n) => n.point === point)) list.push({ point, at: e.at });
      nodes.set(id, list);
    }
    for (const id of e.hold) if (!holds.some(([p, c]) => p === point && c === id)) holds.push([point, id]);
    if (e.touch && e.touch.every((id) => e.cut.includes(id) || e.endsHere?.includes(id)) && !touches.some((t) => t.point === point)) touches.push({ point, curves: e.touch });
  }
  return { nodes, holds, added, uncut, touches, pointOf: (at) => places.find((place) => dist2(place.at, at) <= tol)?.point, ...(failed === undefined ? {} : { failed }) };
}

// The contacts of every two curves of the sketch that form regions (the repair, and split without
// a curve), apart from those `skip` leaves out: the cuts as events, the ends of two such curves at
// one place that are not joined, and what cannot be cut (`contactFix`).
function repairEvents(world: World, skip: (at: Vec2, a: Id, b: Id) => boolean = () => false): { events: Event[]; ends: [Id, Id][]; uncut: Set<Id> } {
  const profile = [...world.curves.keys()].filter((id) => formsRegions(world, id)).sort();
  const events: Event[] = [];
  const ends: [Id, Id][] = [];
  const uncut = new Set<Id>();
  for (let i = 0; i < profile.length; i++) {
    for (let j = i + 1; j < profile.length; j++) {
      const [a, b] = [profile[i], profile[j]];
      const [ca, cb] = [curveOf(world, a) as SketchCurve, curveOf(world, b) as SketchCurve];
      const found = world.contacts(a, b);
      for (const contact of found.points) {
        if (skip(contact.at, a, b)) continue;
        const fix = contactFix(ca, cb, contact.kind, world.predicates, world.sketch);
        if (fix?.fix === 'cut') events.push(event(contact.at, [a, b], [], false, contact.kind === 'touch' ? [a, b] : undefined));
        else if (fix?.fix === 'none') for (const curve of [ca, cb]) if (!world.predicates.mayCut(curve) || contact.kind === 'touch') uncut.add(curve.id);
      }
      if (found.ends.length > 0 && contactFix(ca, cb, 'ends', world.predicates, world.sketch)?.fix === 'join') {
        const [ea, eb] = [endsOf(ca.shape), endsOf(cb.shape)];
        for (const [x, y] of found.ends) ends.push([ea[x], eb[y]]);
      }
    }
  }
  return { events, ends, uncut };
}

// ---------------------------------------------------------------- stage 2: the model after the batch

interface CutCurve {
  id: Id;
  original: Curve;
  pieces: { id: Id; from: Id; to: Id }[]; // the pieces that stay, in the order of the curve; the keeper is the one with `id`
  cutOff: Id[]; // ends of the curve as it was that no piece has
  lostPiece: boolean; // a piece was trimmed away
  whole?: { sibling?: Id }; // the curve was removed whole
  nodes: Id[]; // the points it was cut at, in its own direction
}

class Model {
  readonly points: Map<Id, Point2>;
  readonly newPoints = new Map<Id, Vec2>();
  readonly curves: Map<Id, Curve>;
  readonly newCurves: Id[] = [];
  readonly constraints: Map<Id, Constraint>;
  readonly newConstraints: Id[] = [];
  readonly moved = new Set<Id>(); // constraints removed and added again under their ID
  readonly expressions: Record<string, Expr>;
  constructor(
    readonly sketch: SketchFeature,
    private readonly newId: NewId,
  ) {
    this.points = new Map(Object.entries(sketch.points));
    this.curves = new Map(Object.entries(sketch.curves));
    this.constraints = new Map(Object.entries(sketch.constraints));
    this.expressions = { ...(sketch.expressions ?? {}) } as Record<string, Expr>;
  }
  addPoint(id: Id, at: Vec2): void {
    this.points.set(id, { x: at[0], y: at[1] });
    this.newPoints.set(id, at);
  }
  addCurve(curve: Curve): Id {
    const id = this.newId('c');
    this.curves.set(id, curve);
    this.newCurves.push(id);
    return id;
  }
  constrain(c: Constraint): Id | undefined {
    if (this.identity(c) || this.repeated(c) !== undefined) return undefined;
    const id = this.newId('k');
    this.constraints.set(id, c);
    this.newConstraints.push(id);
    return id;
  }
  // A constraint that says nothing: a point held on a curve it is an end of, or a constraint of one
  // curve with itself.
  identity(c: Constraint): boolean {
    const operands = constraintOperands(c);
    if (new Set(operands).size < operands.length) return true;
    if (c.type === 'pointOnCurve') {
      const curve = this.curves.get(c.curve);
      return curve !== undefined && endsOf(curve).includes(c.point);
    }
    return false;
  }
  repeated(c: Constraint, except?: Id): Id | undefined {
    if (!isDriving(c)) return undefined;
    const key = constraintKey(c);
    for (const [id, other] of this.constraints) if (id !== except && isDriving(other) && constraintKey(other) === key) return id;
    return undefined;
  }
  usesPoint(point: Id, except: (curve: Id) => boolean = () => false): boolean {
    for (const [id, curve] of this.curves) if (!except(id) && curvePoints(curve).includes(point)) return true;
    return false;
  }
  heldOn(point: Id, curve: Id): boolean {
    for (const c of this.constraints.values()) if (c.type === 'pointOnCurve' && c.point === point && c.curve === curve) return true;
    return false;
  }
}

// What names a point besides the curves and constraints of the sketch: a feature of the document
// (other than the sketch) or a section.
export function namedOutside(doc: Document, sketch: Id): Set<Id> {
  const texts = new Set<string>(namedBySections(doc));
  for (const feature of doc.features) if (feature.id !== sketch) textsIn(feature, texts);
  // an entry of the sketch names its points too: a listed point, the centre of a circular pattern (D68)
  const own = doc.features.find((f) => f.id === sketch);
  if (own?.type === 'sketch') {
    textsIn(own.external, texts);
    // a copy named anywhere names its source: the copy of a point is an entity only while the point
    // is (a generator's operand `m/1/b` keeps `b`)
    for (const text of [...texts]) {
      const source = text.includes('/') ? derivedOrigin(own, text)?.source : undefined;
      if (source !== undefined) texts.add(source);
    }
  }
  return texts;
}

// ---------------------------------------------------------------- the plan of a batch as data

// What a batch did to the curves of a sketch (design.md, "Plug-in points"), as the fillet (D52) and
// the three tools give it, so that a reader added later is added once (`readersOf`) and 6c's rules
// read what the batch did.
// - `changed`: curves that keep their ID with another extent; `restarted`: lines whose start `a`
//   was re-pointed; `rekinded`: circles that became arcs; `removed` and `removedPoints`: what the
//   batch removes.
// - `added`: the curves the batch makes in the place of what was there (the new pieces, the arc of
//   a fillet); `span`: the construction lines made for equalLength and midpoint.
// - `pieces`: for every curve the batch cut or trimmed, by its ID before the batch, the curves that
//   stay of it in its own direction, the keeper among them; empty for a curve removed whole. A curve
//   only re-pointed has itself.
// - `stretches`: what the batch takes out, each as the curves it ran over and its two bounds (the
//   points at the cuts of a trimmed piece, the ends of a piece removed whole, the two tangent points
//   of a fillet). A circle removed whole has none.
export interface RemovedStretch {
  curves: Id[];
  bounds: [Id, Id];
}
export interface CurveChanges {
  changed: Id[];
  restarted: Id[];
  rekinded: Id[];
  removed: Id[];
  removedPoints: Id[];
  added: Id[];
  span: Id[];
  pieces: Record<Id, Id[]>;
  stretches: RemovedStretch[];
}

// What a curve that a feature names became in the batch: the curves that take its place, in its
// direction, or undefined when the batch did not change it. Every rewrite by names reads a curve
// through it (a region of `pending`, the curves of a wall, the edges of a chamfer or a fillet). 6c
// makes it answer for a copy of a cut source. `sketch` is the sketch after the batch.
// A copy `<entry>/<n>/<X>` of a cut source X becomes `<entry>/<n>/<piece>` for the pieces of X the
// entry lists in `sketch` (patched in the batch), for any copy number whatever the count (D68).
export function piecesOf(changes: CurveChanges, sketch: SketchFeature, curve: Id): Id[] | undefined {
  if (has(changes.pieces, curve)) return changes.pieces[curve];
  const copy = copyParts(sketch, curve);
  if (!copy || !has(changes.pieces, copy.source)) return undefined;
  const listed = (sketch.external[copy.entry] as SketchPattern).sources;
  return changes.pieces[copy.source].filter((piece) => listed.includes(piece)).map((piece) => `${copy.entry}/${copy.copy}/${piece}`);
}

// The places at which a batch may have changed a hole of a region that keeps its name: the middle
// of each removed piece and of each added stretch. 6c adds their images under the copies of every
// entry that lists the curve. `before` is the sketch before the batch, `world` the world as it was.
// 6c (D68): also the image of each place under every copy the count makes of every entry of
// `before` that lists its curve. The map of a copy is read from the world as it was: a mirror
// reflects in its axis; a row shifts as the copy of a point of the curve is shifted; a circle turns
// about its centre as the copy of a point of the curve away from the centre is turned.
export function reshapedProbes(before: SketchFeature, world: SketchWorld, middles: readonly { curve: Id; at: Vec2 }[]): Vec2[] {
  const out: Vec2[] = middles.map((middle) => middle.at);
  const at = (id: Id): Vec2 | undefined => (has(world.geometry.points, id) ? xy(world.geometry.points[id]) : undefined);
  for (const middle of middles) {
    const curve = before.curves[middle.curve];
    if (!curve) continue;
    for (const entry of entryOrder(before)) {
      const ref = before.external[entry];
      if (ref.type !== 'pattern' || !ref.sources.includes(middle.curve)) continue;
      const geometry = world.derived.entries[entry];
      if (!geometry) continue;
      const t = ref.transform;
      const copies = copyNumbersMade(geometry, entry, middle.curve);
      switch (t.type) {
        case 'mirror': {
          const axis = world.curves.get(t.axis)?.shape;
          const [a, b] = axis?.type === 'line' ? [at(axis.a), at(axis.b)] : [undefined, undefined];
          if (!a || !b) break;
          const length = dist2(a, b);
          if (!(length > 0)) break;
          const u: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
          const d: Vec2 = [middle.at[0] - a[0], middle.at[1] - a[1]];
          const along = d[0] * u[0] + d[1] * u[1];
          out.push([a[0] + 2 * along * u[0] - d[0], a[1] + 2 * along * u[1] - d[1]]);
          break;
        }
        case 'linear': {
          const p = curvePoints(curve)[0];
          const source = at(p);
          for (const copy of copies) {
            const image = has(geometry.points, `${entry}/${copy}/${p}`) ? xy(geometry.points[`${entry}/${copy}/${p}`]) : undefined;
            if (source && image) out.push([middle.at[0] + image[0] - source[0], middle.at[1] + image[1] - source[1]]);
          }
          break;
        }
        case 'circular': {
          const c = at(t.center);
          if (!c) break;
          const p = curvePoints(curve).find((id) => {
            const q = at(id);
            return q !== undefined && dist2(q, c) > tol;
          });
          const source = p === undefined ? undefined : at(p);
          if (!p || !source) break;
          for (const copy of copies) {
            const image = has(geometry.points, `${entry}/${copy}/${p}`) ? xy(geometry.points[`${entry}/${copy}/${p}`]) : undefined;
            if (!image) continue;
            const turn = Math.atan2(image[1] - c[1], image[0] - c[0]) - Math.atan2(source[1] - c[1], source[0] - c[0]);
            const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
            const d: Vec2 = [middle.at[0] - c[0], middle.at[1] - c[1]];
            out.push([c[0] + d[0] * cos - d[1] * sin, c[1] + d[0] * sin + d[1] * cos]);
          }
          break;
        }
        default:
          unreachable(t, 'transform');
      }
    }
  }
  return out;
}
// The copy numbers an entry made of a curve.
const copyNumbersMade = (geometry: { curves: Record<Id, unknown> }, entry: Id, curve: Id): string[] =>
  Object.keys(geometry.curves).flatMap((id) => {
    const rest = id.slice(entry.length + 1);
    const slash = rest.indexOf('/');
    return slash > 0 && rest.slice(slash + 1) === curve ? [rest.slice(0, slash)] : [];
  });

// ---------------------------------------------------------------- the cut, as one plan

interface Plan {
  commands: Command[]; // the sketch commands, without the patches
  model: Model;
  cuts: Map<Id, CutCurve>;
  joined: [Id, Id][]; // pairs of points the batch joins (a coincident or a re-point)
  repointed: Id[]; // curves re-pointed onto another point (ends at one place)
  uncut: Set<Id>;
  pointsAtCuts: Id[];
  newEnd?: Id; // the new end of an extension
  extended?: Id;
}

interface CutSpec {
  // events of the batch
  events: Event[];
  // pairs of ends at one place to join
  ends: [Id, Id][];
  // curves that cannot be cut at a contact the batch meets (`contactFix`)
  uncut: Set<Id>;
  // the curve a trim cuts, with the piece it removes (its bounds are among the events)
  trim?: { X: Id; carrier: Carrier; piece: Piece; whole: boolean };
  // the curve an extension moves, with its end and the place it moves to
  extend?: { X: Id; end: 'a' | 'b' | 'start' | 'end'; at: Vec2; target: Id; stretch: Event[] };
}

function makePlan(world: World, spec: CutSpec, newId: NewId): Plan | string {
  const { sketch, doc } = world;
  const outside = namedOutside(doc, sketch.id);
  const extendExtra = spec.extend ? [{ at: spec.extend.at, involved: [spec.extend.X, spec.extend.target] }] : [];
  const resolved = resolve(world, [...spec.events, ...(spec.extend?.stretch ?? [])], newId, extendExtra);
  if (resolved.failed !== undefined) return resolved.failed;
  for (const id of spec.uncut) resolved.uncut.add(id);
  const model = new Model(sketch, newId);
  for (const [id, at] of resolved.added) model.addPoint(id, at);
  const newEnd = spec.extend ? resolved.pointOf(spec.extend.at) : undefined;

  // ---- ends at one place: re-pointed onto one point, or joined by a coincident
  const joined: [Id, Id][] = [];
  const repointed: Id[] = [];
  const coincidents: [Id, Id][] = [];
  {
    const parent = new Map<Id, Id>();
    const find = (p: Id): Id => {
      while (parent.has(p) && parent.get(p) !== p) p = parent.get(p) as Id;
      return p;
    };
    for (const [p, q] of spec.ends) {
      if (world.joins(p) === world.joins(q)) continue;
      if (!parent.has(p)) parent.set(p, p);
      if (!parent.has(q)) parent.set(q, q);
      const [rp, rq] = [find(p), find(q)];
      if (rp !== rq) parent.set(rp < rq ? rq : rp, rp < rq ? rp : rq);
    }
    const clusters = new Map<Id, Id[]>();
    for (const p of parent.keys()) clusters.set(find(p), [...(clusters.get(find(p)) ?? []), p]);
    const curvesUsing = (p: Id): Id[] => Object.keys(sketch.curves).filter((id) => curvePoints(sketch.curves[id]).includes(p));
    const orphan = (p: Id): boolean => p !== ORIGIN && curvesUsing(p).length === 1 && !Object.values(sketch.constraints).some((c) => constraintOperands(c).includes(p)) && !outside.has(p);
    for (const members of clusters.values()) {
      const sorted = [...new Set(members)].sort();
      const named = sorted.filter((p) => !orphan(p));
      const rep = named[0] ?? sorted[0];
      for (const p of sorted) {
        if (p === rep || world.joins(p) === world.joins(rep)) continue;
        joined.push([rep, p]);
        if (orphan(p)) {
          const [curveId] = curvesUsing(p);
          const curve = model.curves.get(curveId) as Curve;
          const field = endNames(curve).find((name) => (curve as unknown as Record<string, Id>)[name] === p) as string;
          model.curves.set(curveId, { ...curve, [field]: rep } as Curve);
          model.points.delete(p);
          repointed.push(curveId);
        } else coincidents.push([rep, p]);
      }
    }
  }

  // ---- the curves cut into pieces
  const cuts = new Map<Id, CutCurve>();
  const pointsAtCuts: Id[] = [];
  const cutIds = new Set<Id>([...resolved.nodes.keys(), ...(spec.trim && !spec.trim.whole ? [spec.trim.X] : []), ...(spec.extend ? [spec.extend.X] : [])]);
  for (const X of [...cutIds].sort()) {
    if (!isOwn(world, X)) continue;
    const curve = model.curves.get(X) as Curve;
    const carrier = carrierOf(world, X);
    if (!carrier) continue;
    const nodes = [...(resolved.nodes.get(X) ?? [])];
    const order = (n: Node): number => {
      let t = paramOf(carrier, n.at);
      if (spec.extend?.X === X && carrier.type === 'arc' && spec.extend.end === 'start' && t > carrier.sweep + 1e-12) t -= TAU;
      return t;
    };
    nodes.sort((p, q) => order(p) - order(q));
    // a cut at a point a `symmetric` constraint mirrors about X would make it an end of its own axis
    for (const n of nodes) {
      for (const [id, c] of Object.entries(sketch.constraints)) {
        if (c.type === 'symmetric' && c.line === X && (c.a === n.point || c.b === n.point)) return `the cut of "${X}" at "${n.point}" would make that point an end of the line "${X}", about which the constraint "${id}" mirrors it; remove or change "${id}" first`;
      }
    }
    let chain: Id[];
    let cyclic = false;
    const ends = endsOf(curve);
    switch (curve.type) {
      case 'circle':
        chain = nodes.map((n) => n.point);
        cyclic = true;
        break;
      case 'line':
      case 'arc':
        if (spec.extend?.X === X) {
          const atStart = spec.extend.end === 'a' || spec.extend.end === 'start';
          chain = atStart ? [newEnd as Id, ...nodes.map((n) => n.point), ends[1]] : [ends[0], ...nodes.map((n) => n.point), newEnd as Id];
        } else chain = [ends[0], ...nodes.map((n) => n.point), ends[1]];
        break;
      default:
        return unreachable(curve, 'curve');
    }
    if (cyclic && chain.length < 2) continue;
    for (const n of nodes) if (!pointsAtCuts.includes(n.point)) pointsAtCuts.push(n.point);
    const count = cyclic ? chain.length : chain.length - 1;
    const pairs = Array.from({ length: count }, (_, i): [Id, Id] => [chain[i], chain[(i + 1) % chain.length]]);
    // the piece a trim removes: the one whose middle lies in the piece of the trim
    let removed: number | undefined;
    if (spec.trim?.X === X && !spec.trim.whole) {
      const { piece, carrier: c } = spec.trim;
      const mid = (piece.from + piece.to) / 2;
      const midPoint = pointOn(c, c.type === 'circle' ? positive(mid) : mid);
      const at = (p: Id): Vec2 => model.newPoints.get(p) ?? position(world, p) ?? [NaN, NaN];
      removed = pairs.findIndex(([p, q]) => {
        const tp = paramOf(c, at(p));
        let tq = paramOf(c, at(q));
        let tm = paramOf(c, midPoint);
        if (c.type === 'circle') {
          if (tq <= tp) tq += TAU;
          if (tm < tp) tm += TAU;
        } else if (c.type === 'arc') {
          if (p === ends[1]) return false;
          if (q === ends[1]) tq = c.sweep;
          if (p === ends[0]) return tm < tq;
        }
        return tm > tp && tm < tq;
      });
      if (removed < 0) removed = undefined;
    }
    const kept = pairs.map((_, i) => i).filter((i) => i !== removed);
    if (kept.length === 0) continue;
    const keeperIndex = kept[0];
    const pieces = kept.map((i) => ({ i, from: pairs[i][0], to: pairs[i][1], id: '' }));
    const construction = curve.construction === true ? { construction: true } : {};
    for (const piece of pieces) {
      let shape: Curve;
      switch (curve.type) {
        case 'line':
          shape = { ...construction, type: 'line', a: piece.from, b: piece.to };
          break;
        case 'arc':
        case 'circle':
          shape = { ...construction, type: 'arc', center: curve.center, start: piece.from, end: piece.to };
          break;
        default:
          return unreachable(curve, 'curve');
      }
      if (piece.i === keeperIndex) {
        piece.id = X;
        model.curves.set(X, shape);
      } else piece.id = model.addCurve(shape);
    }
    const keptPoints = new Set(pieces.flatMap((piece) => [piece.from, piece.to]));
    const originalEnds = endsOf(sketch.curves[X]);
    cuts.set(X, {
      id: X,
      original: sketch.curves[X],
      pieces: pieces.map(({ id, from, to }) => ({ id, from, to })),
      cutOff: originalEnds.filter((p) => !keptPoints.has(p) && !(repointed.includes(X) && !endsOf(curve).includes(p))),
      lostPiece: removed !== undefined || spec.extend?.X === X,
      nodes: nodes.map((n) => n.point),
    });
  }
  if (spec.extend && newEnd && !pointsAtCuts.includes(newEnd)) pointsAtCuts.push(newEnd);
  else if (spec.extend && newEnd) pointsAtCuts.push(...pointsAtCuts.splice(pointsAtCuts.indexOf(newEnd), 1));

  // ---- a whole piece removed
  if (spec.trim?.whole) {
    const X = spec.trim.X;
    const curve = sketch.curves[X];
    const sibling = siblingOf(world, model, X);
    model.curves.delete(X);
    cuts.set(X, { id: X, original: curve, pieces: [], cutOff: endsOf(curve), lostPiece: true, whole: { sibling }, nodes: [] });
  }

  // ---- the constraints that name a cut curve
  const refusal = moveConstraints(world, model, cuts);
  if (refusal) return refusal;

  // ---- the holds: pieces on the line of their curve, arcs of one circle that share no end
  for (const cut of cuts.values()) {
    if (cut.whole) continue;
    const keeper = model.curves.get(cut.id) as Curve;
    switch (keeper.type) {
      case 'line': {
        const keeperEnds = endsOf(keeper);
        // a midpoint moved to the span whose point is on X holds the far end on the line already
        const spanned = [...model.constraints.values()].some((c) => {
          if (c.type !== 'midpoint') return false;
          const span = model.curves.get(c.line);
          if (!span || span.type !== 'line' || !model.newCurves.includes(c.line) || !endsOf(cut.original).every((p) => endsOf(span).includes(p))) return false;
          return cut.pieces.some((piece) => piece.from === c.point || piece.to === c.point) || model.heldOn(c.point, cut.id);
        });
        let skipped = false;
        const points = cut.pieces.flatMap((piece) => [piece.from, piece.to]).filter((p, i, list) => list.indexOf(p) === i && !keeperEnds.includes(p));
        for (const p of points) {
          if (model.heldOn(p, cut.id)) continue;
          if (spanned && !skipped && endsOf(cut.original).includes(p)) {
            skipped = true;
            continue;
          }
          model.constrain({ type: 'pointOnCurve', point: p, curve: cut.id });
        }
        break;
      }
      case 'arc':
      case 'circle': {
        // groups of pieces that share an end; each group after the first tied to the keeper
        const groups: (typeof cut.pieces)[] = [];
        for (const piece of cut.pieces) {
          const group = groups.find((g) => g.some((other) => other.to === piece.from || other.from === piece.to));
          if (group) group.push(piece);
          else groups.push([piece]);
        }
        // a circle's chain closes: the last group may join the first
        if (groups.length > 1 && groups[groups.length - 1].some((p) => groups[0].some((q) => q.from === p.to || q.to === p.from))) groups[0].push(...(groups.pop() as typeof cut.pieces));
        for (const group of groups) if (!group.some((piece) => piece.id === cut.id)) model.constrain({ type: 'equalRadius', a: group[0].id, b: cut.id });
        break;
      }
      default:
        unreachable(keeper, 'curve');
    }
  }

  // ---- the ends cut off: held on the line or circle of the curve when anything else names them
  for (const cut of cuts.values()) {
    const sibling = cut.whole?.sibling;
    const carrierOwn = new Set<Id>([cut.id, ...cut.pieces.map((piece) => piece.id), ...(sibling ? [sibling] : [])]);
    const holder = cut.whole ? sibling : cut.id;
    const centre = cut.whole && !sibling ? centreOf(cut.original) : [];
    for (const p of [...cut.cutOff, ...centre]) {
      if (!model.points.has(p) && p !== ORIGIN) continue;
      const named = p === ORIGIN || model.usesPoint(p) || [...model.constraints.values()].some((c) => constraintOperands(c).includes(p) && !(c.type === 'pointOnCurve' && c.point === p && carrierOwn.has(c.curve))) || outside.has(p);
      if (!named) {
        model.points.delete(p);
        for (const [id, c] of [...model.constraints]) if (constraintOperands(c).includes(p)) model.constraints.delete(id);
        continue;
      }
      // a point held on a round holder already through the arcs that stay needs no hold (M2)
      if (holder && !p.includes('/') && model.curves.has(holder) && !model.heldOn(p, holder) && !onCircleAlready(model, p, holder)) model.constrain({ type: 'pointOnCurve', point: p, curve: holder });
    }
  }

  // ---- a point at a cut held on a curve that is not cut there; ends at one place joined
  for (const [p, C] of resolved.holds) {
    if (!model.points.has(p) && p !== ORIGIN) continue;
    if (cuts.has(C) && !cuts.get(C)?.whole) continue;
    if (model.heldOn(p, C)) continue;
    const shape = model.curves.get(C) ?? curveOf(world, C)?.shape;
    if (shape && endsOf(shape).includes(p)) continue;
    model.constrain({ type: 'pointOnCurve', point: p, curve: C });
  }
  for (const [a, b] of coincidents) model.constrain({ type: 'coincident', a, b });

  // ---- a touch cut on both curves: a tangency between a line piece and an arc piece that have the
  // point (the one of the sketch moved there already, else one added; row 8)
  for (const touch of resolved.touches) {
    const at = (X: Id): Id | undefined => {
      const cut = cuts.get(X);
      if (!cut || cut.whole) return undefined;
      const keeper = cut.pieces.find((piece) => piece.id === X && (piece.from === touch.point || piece.to === touch.point));
      return (keeper ?? cut.pieces.find((piece) => piece.to === touch.point) ?? cut.pieces.find((piece) => piece.from === touch.point))?.id;
    };
    const [p, q] = [at(touch.curves[0]), at(touch.curves[1])];
    if (!p || !q) continue;
    const piecesOfCurve = (X: Id): Id[] => cuts.get(X)?.pieces.map((piece) => piece.id) ?? [X];
    const [ps, qs] = [piecesOfCurve(touch.curves[0]), piecesOfCurve(touch.curves[1])];
    const held = [...model.constraints.values()].some((c) => c.type === 'tangent' && ((ps.includes(c.a) && qs.includes(c.b)) || (qs.includes(c.a) && ps.includes(c.b))) && commonEnd(model, c.a, c.b) === touch.point);
    if (held) continue;
    const [line, round] = model.curves.get(p)?.type === 'line' ? [p, q] : [q, p];
    model.constrain({ type: 'tangent', a: line, b: round });
  }

  const commands = emit(world, model);
  return { commands, model, cuts, joined, repointed, uncut: resolved.uncut, pointsAtCuts, newEnd, extended: spec.extend?.X };
}

// Is a point on the circle of a round holder already, through the arcs that stay: an arc on the
// holder's centre point that ends at the point and is tied to the holder by a chain of such arcs
// with common ends, or by equalRadius? A hold on it would then be redundant (finding M2).
function onCircleAlready(model: Model, p: Id, holder: Id): boolean {
  const start = model.curves.get(holder);
  if (!start || start.type !== 'arc') return false;
  const seen = new Set<Id>([holder]);
  const queue = [holder];
  while (queue.length > 0) {
    const id = queue.pop() as Id;
    const arc = model.curves.get(id) as Extract<Curve, { type: 'arc' }>;
    if (id !== holder && (arc.start === p || arc.end === p)) return true;
    for (const [other, c] of model.curves) {
      if (seen.has(other) || c.type !== 'arc' || c.center !== start.center) continue;
      const shares = c.start === arc.start || c.start === arc.end || c.end === arc.start || c.end === arc.end;
      const tied = [...model.constraints.values()].some((k) => k.type === 'equalRadius' && ((k.a === id && k.b === other) || (k.a === other && k.b === id)));
      if (shares || tied) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return false;
}

// A sibling of a curve removed whole: another own curve on its carrier held there by constraints
// (a line both of whose ends are ends of X or held on X, or the reverse, running the same way; an
// arc with the same centre point that shares an end with X or is tied to it by equalRadius). One
// with the construction flag of X first, then one that shares an end, then the first by ID.
function siblingOf(world: World, model: Model, X: Id): Id | undefined {
  const curve = world.sketch.curves[X];
  if (curve.type === 'circle') return undefined;
  const ends = endsOf(curve);
  const found: { id: Id; sameFlag: boolean; shares: boolean }[] = [];
  for (const [id, other] of model.curves) {
    if (id === X || other.type !== curve.type) continue;
    const otherEnds = endsOf(other);
    const shares = ends.some((p) => otherEnds.includes(p));
    if (curve.type === 'line' && other.type === 'line') {
      const onX = otherEnds.every((p) => ends.includes(p) || model.heldOn(p, X));
      const onOther = ends.every((p) => otherEnds.includes(p) || model.heldOn(p, id));
      if (!onX && !onOther) continue;
      const [a, b, c, d] = [position(world, curve.a), position(world, curve.b), model.newPoints.get(other.a) ?? position(world, other.a), model.newPoints.get(other.b) ?? position(world, other.b)];
      if (!a || !b || !c || !d || (b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1]) <= 0) continue;
    } else if (curve.type === 'arc' && other.type === 'arc') {
      if (other.center !== curve.center) continue;
      const tied = [...model.constraints.values()].some((c) => c.type === 'equalRadius' && ((c.a === X && c.b === id) || (c.a === id && c.b === X)));
      if (!shares && !tied) continue;
    } else continue;
    found.push({ id, sameFlag: (other.construction === true) === (curve.construction === true), shares });
  }
  found.sort((p, q) => Number(q.sameFlag) - Number(p.sameFlag) || Number(q.shares) - Number(p.shares) || (p.id < q.id ? -1 : 1));
  return found[0]?.id;
}

// The common end of a tangency by the rule of the solver adapter (D52): the same point, or two
// points one coincident of the sketch names together; for a line and an arc only.
function commonEnd(model: Model, a: Id, b: Id): Id | undefined {
  const [ca, cb] = [model.curves.get(a), model.curves.get(b)];
  if (!ca || !cb) return undefined;
  const [line, arc] = ca.type === 'line' && cb.type === 'arc' ? [ca, cb] : cb.type === 'line' && ca.type === 'arc' ? [cb, ca] : [undefined, undefined];
  if (!line || !arc) return undefined;
  const lineEnds = [line.a, line.b];
  const shared = [arc.start, arc.end].find((p) => lineEnds.includes(p));
  if (shared !== undefined) return shared;
  const joins = [...model.constraints.values()].filter((c): c is Extract<Constraint, { type: 'coincident' }> => c.type === 'coincident');
  return [arc.start, arc.end].find((p) => joins.some((c) => (c.a === p && lineEnds.includes(c.b)) || (c.b === p && lineEnds.includes(c.a))));
}

// Each constraint on a cut curve where it belongs (design.md, "What happens to the constraints").
// A refusal as text.
function moveConstraints(world: World, model: Model, cuts: Map<Id, CutCurve>): string | undefined {
  const { sketch } = world;
  const spans = new Map<Id, Id>();
  const spanOf = (X: Id): Id => {
    let span = spans.get(X);
    if (!span) {
      const original = cuts.get(X)?.original as Extract<Curve, { type: 'line' }>;
      span = model.addCurve({ construction: true, type: 'line', a: original.a, b: original.b });
      spans.set(X, span);
    }
    return span;
  };
  const piecesFor = (X: Id): Id[] => {
    const cut = cuts.get(X);
    if (!cut) return [X];
    if (cut.whole) return cut.whole.sibling ? [cut.whole.sibling] : [];
    return cut.pieces.map((piece) => piece.id);
  };
  // before the moves: the common ends of the tangencies as they were
  const before = new Model(sketch, () => '');
  for (const id of Object.keys(sketch.constraints).sort()) {
    const c = sketch.constraints[id];
    const named = constraintOperands(c).filter((operand) => cuts.has(operand));
    if (named.length === 0) continue;
    const X = named[0];
    const cut = cuts.get(X) as CutCurve;
    const circleTurned = cut.original.type === 'circle';
    let next: Constraint | undefined = c;
    const swap = (from: Id, to: Id): void => {
      if (!next) return;
      const fields = Object.fromEntries(Object.entries(next).map(([key, value]) => [key, key !== 'type' && value === from ? to : value]));
      next = fields as unknown as Constraint;
    };
    // the operands one by one
    for (const operand of named) {
      const own = cuts.get(operand) as CutCurve;
      if (own.whole) {
        const sibling = own.whole.sibling;
        if (!sibling || c.type === 'equalLength' || c.type === 'midpoint') {
          next = undefined;
          break;
        }
        swap(operand, sibling);
        continue;
      }
      if ((c.type === 'equalLength' || c.type === 'midpoint') && own.original.type === 'line') swap(operand, spanOf(operand));
    }
    if (next && c.type === 'tangent') {
      const [a, b] = [c.a, c.b];
      const was = commonEnd(before, a, b);
      const pairs = piecesFor(a).flatMap((p) => piecesFor(b).map((q): [Id, Id] => [p, q]));
      const hit = pairs.find(([p, q]) => commonEnd(model, p, q) !== undefined);
      if (hit) next = { ...c, a: hit[0], b: hit[1] };
      else if (was !== undefined) return `the tangency "${id}" holds "${a}" and "${b}" at their common end "${was}", which the trim takes off; remove the tangency first`;
      else next = { ...c, a: piecesFor(a)[0] ?? a, b: piecesFor(b)[0] ?? b };
    }
    if (!next) {
      model.constraints.delete(id);
      continue;
    }
    const changed = circleTurned || JSON.stringify(next) !== JSON.stringify(c);
    if (!changed) continue;
    model.constraints.set(id, next);
    model.moved.add(id);
  }
  // identities, repeats and constraints of one curve with itself go; a moved one with an expression
  // wins over a repeat without one
  for (const id of [...model.moved].sort()) {
    const c = model.constraints.get(id);
    if (!c) continue;
    if (model.identity(c)) {
      model.constraints.delete(id);
      model.moved.delete(id);
      continue;
    }
    const twin = model.repeated(c, id);
    if (twin === undefined) continue;
    const mine = model.expressions[constraintPath(id)] !== undefined;
    const theirs = model.expressions[constraintPath(twin)] !== undefined;
    if (mine && !theirs) {
      model.constraints.delete(twin);
      model.moved.delete(twin);
    } else {
      model.constraints.delete(id);
      model.moved.delete(id);
    }
  }
  // the identities of constraints that stay on the keeper (a point held on a line it now ends)
  for (const [id, c] of [...model.constraints]) {
    if (c.type !== 'pointOnCurve' || !cuts.has(c.curve)) continue;
    const cut = cuts.get(c.curve) as CutCurve;
    if (cut.whole) continue;
    const keeper = model.curves.get(c.curve) as Curve;
    const vertex = (p: Id): Id => world.joins(p);
    const ends = keeper.type === 'line' ? endsOf(keeper) : cut.pieces.flatMap((piece) => [piece.from, piece.to]);
    if (ends.some((p) => p === c.point || vertex(p) === vertex(c.point))) {
      model.constraints.delete(id);
      model.moved.delete(id);
    }
  }
  // a moved dimension with an expression must be added again by it
  for (const id of model.moved) {
    const expr = model.expressions[constraintPath(id)];
    if (expr === undefined || !world.parameters) continue;
    const value = evaluateNumber(expr, world.parameters);
    if (!value.ok) return `the dimension "${id}" has to move to another curve, but its expression "${expr}" does not evaluate: ${value.error.message}`;
  }
  return undefined;
}

// The batch: the difference between the sketch and the model, in the order of design.md: new
// points; constraints removed or moved; re-points, circles turned into arcs, new curves; curves and
// points removed; constraints added and added again.
function emit(world: World, model: Model): Command[] {
  const { sketch } = world;
  const s = sketch.id;
  const out: Command[] = [];
  for (const [id, at] of model.newPoints) out.push({ type: 'addPoint', sketch: s, id, x: at[0], y: at[1] });
  const turned = Object.keys(sketch.curves).filter((id) => model.curves.has(id) && model.curves.get(id)?.type !== sketch.curves[id].type);
  for (const id of Object.keys(sketch.constraints).sort()) {
    const c = sketch.constraints[id];
    const gone = !model.constraints.has(id) || model.moved.has(id) || constraintOperands(c).some((operand) => turned.includes(operand));
    if (gone) out.push({ type: 'removeConstraint', sketch: s, id });
  }
  for (const id of Object.keys(sketch.curves).sort()) {
    const was = sketch.curves[id];
    const now = model.curves.get(id);
    if (!now) continue;
    if (now.type !== was.type) {
      out.push({ type: 'removeEntity', sketch: s, id }, { type: 'addCurve', sketch: s, id, curve: now });
      continue;
    }
    for (const name of endNames(was)) {
      const [from, to] = [(was as unknown as Record<string, Id>)[name], (now as unknown as Record<string, Id>)[name]];
      if (from !== to) out.push({ type: 'setCurvePoint', sketch: s, id, point: name, to });
    }
  }
  for (const id of model.newCurves) if (model.curves.has(id)) out.push({ type: 'addCurve', sketch: s, id, curve: model.curves.get(id) as Curve });
  for (const id of Object.keys(sketch.curves).sort()) if (!model.curves.has(id)) out.push({ type: 'removeEntity', sketch: s, id });
  for (const id of Object.keys(sketch.points).sort()) if (!model.points.has(id)) out.push({ type: 'removeEntity', sketch: s, id });
  const again = [...model.constraints.keys()].filter((id) => has(sketch.constraints, id) && (model.moved.has(id) || constraintOperands(sketch.constraints[id]).some((operand) => turned.includes(operand))));
  for (const id of again.sort()) out.push({ type: 'addConstraint', sketch: s, id, constraint: inputOf(model, id) });
  for (const id of model.newConstraints) if (model.constraints.has(id)) out.push({ type: 'addConstraint', sketch: s, id, constraint: model.constraints.get(id) as Constraint });
  return out;
}

// A constraint in the form a command takes: a driving dimension with its expression, when it has one.
function inputOf(model: Model, id: Id): Extract<Command, { type: 'addConstraint' }>['constraint'] {
  const c = model.constraints.get(id) as Constraint;
  const expr = model.expressions[constraintPath(id)];
  return isDimension(c) && c.driving && expr !== undefined ? ({ ...c, value: expr } as Extract<Command, { type: 'addConstraint' }>['constraint']) : c;
}

// The plan of a batch as data (`CurveChanges`).
function changesOf(world: World, plan: Plan, spec: CutSpec): CurveChanges {
  const { sketch } = world;
  const model = plan.model;
  const pieces: Record<Id, Id[]> = {};
  for (const cut of plan.cuts.values()) pieces[cut.id] = cut.pieces.map((piece) => piece.id);
  for (const id of plan.repointed) if (!has(pieces, id)) pieces[id] = [id];
  const changed = [...new Set([...[...plan.cuts.values()].filter((cut) => !cut.whole).map((cut) => cut.id), ...plan.repointed])].sort();
  const added: Id[] = [];
  for (const X of changed) for (const piece of plan.cuts.get(X)?.pieces ?? []) if (piece.id !== X) added.push(piece.id);
  const span = model.newCurves.filter((id) => model.curves.has(id) && !added.includes(id));
  const restarted = Object.keys(sketch.curves).filter((id) => {
    const [was, now] = [sketch.curves[id], model.curves.get(id)];
    return was.type === 'line' && now?.type === 'line' && was.a !== now.a;
  });
  const rekinded = Object.keys(sketch.curves).filter((id) => sketch.curves[id].type === 'circle' && model.curves.get(id)?.type === 'arc');
  const stretches: RemovedStretch[] = [];
  const trim = spec.trim;
  if (trim) {
    const original = sketch.curves[trim.X];
    const ends = endsOf(original);
    const pointAt = (cut: Cut | undefined, end: Id | undefined): Id | undefined => (cut ? findPoint(plan, cut.at, world) : end);
    if (trim.whole) {
      if (ends.length === 2) stretches.push({ curves: [trim.X], bounds: [ends[0], ends[1]] });
    } else {
      const lo = pointAt(trim.piece.lo, ends[0]);
      const hi = pointAt(trim.piece.hi, ends[1]);
      if (lo !== undefined && hi !== undefined) stretches.push({ curves: [trim.X], bounds: [lo, hi] });
    }
  }
  return {
    changed,
    restarted,
    rekinded,
    removed: Object.keys(sketch.curves).filter((id) => !model.curves.has(id)).sort(),
    removedPoints: Object.keys(sketch.points).filter((id) => !model.points.has(id)).sort(),
    added,
    span,
    pieces,
    stretches,
  };
}
const findPoint = (plan: Plan, at: Vec2, world: World): Id | undefined => {
  for (const [id, p] of plan.model.points) if (dist2(xy(p), at) <= tol) return id;
  for (const [id, p] of Object.entries(world.sketch.points)) if (dist2(xy(p), at) <= tol) return id;
  return dist2([0, 0], at) <= tol ? ORIGIN : undefined;
};

// ---------------------------------------------------------------- the three tools

const failed = (message: string): SketchToolResult => ({ ok: false, message });
const fmt = (p: Vec2): string => `[${p.map((v) => +v.toFixed(6)).join(', ')}]`;

// The checks every tool makes on the curve it is given.
function curveProblem(world: World, X: Id, withId?: Id): string | undefined {
  const curve = curveOf(world, X);
  if (!curve) return `the sketch has no curve "${X}"`;
  if (!world.predicates.mayCut(curve)) {
    if (curve.source === 'own') return `the circle "${X}" is an operand of a generated profile, which takes a whole circle; it is not trimmed, extended or split`;
    const copy = curve.source === 'derived' ? copyParts(world.sketch, X) : undefined;
    if (copy) return copyInTool(X, copy.entry, copy.source);
    return `"${X}" is ${curve.source === 'reference' ? 'reference' : 'derived'} geometry of the sketch, which is not trimmed, extended or split; draw an own curve over it`;
  }
  if (!carrierOf(world, X)) return `"${X}" has no solved position or no length`;
  if (withId !== undefined) {
    if (withId === X) return '`with` names the curve itself';
    const other = curveOf(world, withId);
    if (!other) return `with: the sketch has no curve "${withId}"`;
    const copy = other.source === 'derived' ? copyParts(world.sketch, withId) : undefined;
    if (copy) return `with: ${copyInTool(withId, copy.entry, copy.source)} (no point can be held on a copy in its own sketch)`;
  }
  return undefined;
}

// The repair of a trim or an extend: as given, else the default of the document.
const repairOf = (world: World, given: Repair | undefined): boolean => (given ?? (repairsByDefault(world.doc, world.sketch.id) ? 'on' : 'off')) === 'on';

// The own curve nearest to a place: of curves equally near (within the tolerance), one that forms
// regions before a construction curve, then the first by ID.
function nearestOwn(world: World, at: Vec2): { id: Id; distance: number } | undefined {
  let best: { id: Id; distance: number; regions: boolean } | undefined;
  for (const id of Object.keys(world.sketch.curves).sort()) {
    const carrier = carrierOf(world, id);
    if (!carrier) continue;
    const distance = distanceTo(carrier, at);
    const regions = formsRegions(world, id);
    if (!best || distance < best.distance - tol || (Math.abs(distance - best.distance) <= tol && regions && !best.regions)) best = { id, distance, regions };
  }
  return best && { id: best.id, distance: best.distance };
}

// The curve a trim means: `curve`, or the own curve nearest to `at`; a refusal as text.
function trimCurve(world: World, input: TrimInput): Id | string {
  if (input.curve === undefined) {
    const own = nearestOwn(world, input.at);
    if (!own) return 'the sketch has no own curve to trim';
    // a curve that is not own nearer to the place means it, the nearest of them (6c: a mirror makes
    // many); the axes of the origin do not count
    let nearest: { id: Id; curve: SketchCurve; distance: number } | undefined;
    for (const [id, curve] of world.curves) {
      if (curve.source === 'own' || isOriginAxis(id)) continue;
      const carrier = carrierOf(world, id);
      const distance = carrier ? distanceTo(carrier, input.at) : Infinity;
      if (distance < own.distance - tol && (!nearest || distance < nearest.distance)) nearest = { id, curve, distance };
    }
    if (nearest) {
      const { id, curve } = nearest;
      const copy = curve.source === 'derived' ? copyParts(world.sketch, id) : undefined;
      if (copy) return `the place ${fmt(input.at)} lies on "${id}", which is not an own curve of the sketch: ${copyInTool(id, copy.entry, copy.source)}. Where an own curve runs beside it, give \`curve\``;
      const why = 'reference geometry (a projection) is not trimmed; draw an own curve over it';
      return `the place ${fmt(input.at)} lies on "${id}", which is not an own curve of the sketch: ${why}. Where an own curve crosses it, give \`curve\``;
    }
    return own.id;
  }
  const X = input.curve;
  const carrier = carrierOf(world, X);
  if (!carrier || !isOwn(world, X)) return X; // the checks of the curve say why
  const mine = distanceTo(carrier, input.at);
  for (const id of Object.keys(world.sketch.curves).sort()) {
    if (id === X) continue;
    const other = carrierOf(world, id);
    if (!other || !sameCarrier(carrier, other)) continue;
    if (distanceTo(other, input.at) < mine - tol) return `the place ${fmt(input.at)} lies on "${id}", another piece on the ${carrier.type === 'line' ? 'line' : 'circle'} of "${X}" (after a split the ID of a curve names only its first piece); give the place alone, without \`curve\`, or name "${id}"`;
  }
  return X;
}

// Why a touch is no cut, for the message of a trim that would run through it.
function touchWhy(world: World, X: Id, C: Id, repairOn: boolean): string {
  if (isRound(world, X) && isRound(world, C)) return 'two round curves that only touch are not cut';
  if (!formsRegions(world, X)) return `"${X}" is a construction curve, which cuts no other curve`;
  if (!cuttable(world, C)) return `"${C}" is a construction or a reference curve, which is not cut`;
  if (!repairOn) return 'the repair is off, so the other curve is not cut';
  return `the circle "${isRound(world, X) ? X : C}" would get that one point only`;
}

function trimSpec(world: World, input: TrimInput, X: Id): CutSpec | string {
  const carrier = carrierOf(world, X) as Carrier;
  const repairOn = repairOf(world, input.repair);
  const bothCut = repairOn && cuttable(world, X);
  const { cuts, touches } = cutsOf(world, X, cuttersOf(world, X, input.with), carrier, bothCut);
  const piece = pieceAround(carrier, cuts, nearestParam(carrier, input.at));
  // a touch that is no cut bounds nothing: the piece would run through it (finding E3)
  const through = touches.find((touch) => paramInPiece(carrier, piece, touch.t));
  if (through) {
    const lineAndArc = isRound(world, X) !== isRound(world, through.with);
    const way = lineAndArc && !repairOn && cuttable(world, X) && cuttable(world, through.with) ? ", or trim with repair: 'on'" : '';
    return `the piece of "${X}" at that place passes ${fmt(through.at)}, where it only touches "${through.with}", and a trim cannot stop there (${touchWhy(world, X, through.with, repairOn)}); remove the whole curve with removeEntity${way}`;
  }
  const whole = !piece.lo && !piece.hi;
  const events: Event[] = [];
  for (const bound of [piece.lo, piece.hi]) if (bound) events.push(contactEvent(world, X, bound.with, bound, true, bothCut));
  let ends: [Id, Id][] = [];
  let uncut = new Set<Id>();
  if (bothCut) {
    // the contacts of X inside the removed piece are not cut: the piece goes (a contact of two other
    // curves there is cut as any other)
    const repair = repairEvents(world, (at, a, b) => (a === X || b === X) && inPiece(world, X, carrier, piece, at));
    events.push(...repair.events);
    ends = repair.ends;
    uncut = repair.uncut;
  }
  return { events, ends, uncut, trim: { X, carrier, piece, whole } };
}

// Where the extension of an end of X first meets a curve: the place, the curve, and the contacts
// with curves that form regions before it (with `with` only). A refusal as text.
interface Reach {
  at: Vec2;
  target: Id;
  touch: boolean; // the extension stops where it touches the curve met, and both are cut there
  before: { at: Vec2; with: Id }[];
  passed: { at: Vec2; with: Id }[]; // touches that are no cut, passed before the stop
  stuck: { at: Vec2; with: Id }[]; // curves that form regions and may not be cut, met before the stop, the nearest first
}
function reachOf(world: World, X: Id, end: ExtendInput['end'], withId: Id | undefined, bothCut: boolean): Reach | string {
  const curve = world.sketch.curves[X];
  const carrier = carrierOf(world, X) as Carrier;
  const E = (curve as unknown as Record<string, Id>)[end];
  const e = position(world, E) as Vec2;
  // the stretch the end moves along, as a curve of its own with two points that are not in the sketch
  const [far, near] = ['\u0000far', '\u0000near'];
  let stretch: SketchCurve;
  const points = { ...world.geometry.points };
  let along: (p: Vec2) => number;
  switch (carrier.type) {
    case 'line': {
      const other = end === 'a' ? carrier.b : carrier.a;
      const length = dist2(e, other);
      const u: Vec2 = [(e[0] - other[0]) / length, (e[1] - other[1]) / length];
      let size = 1;
      for (const p of Object.values(world.geometry.points)) size = Math.max(size, Math.abs(p.x), Math.abs(p.y));
      for (const r of Object.values(world.geometry.radii)) size = Math.max(size, r);
      const reach = 8 * size + 10;
      points[far] = { x: e[0] + u[0] * reach, y: e[1] + u[1] * reach };
      stretch = { id: '\u0000stretch', shape: { type: 'line', a: E, b: far }, source: 'own', regions: true };
      along = (p) => (p[0] - e[0]) * u[0] + (p[1] - e[1]) * u[1];
      break;
    }
    case 'arc': {
      // the rest of the circle, from the end of the arc counter-clockwise to its start
      const arc = curve as Extract<Curve, { type: 'arc' }>;
      points[near] = world.geometry.points[arc.end];
      points[far] = world.geometry.points[arc.start];
      stretch = { id: '\u0000stretch', shape: { type: 'arc', center: arc.center, start: end === 'end' ? E : near, end: end === 'end' ? far : E }, source: 'own', regions: true };
      const rest = TAU - carrier.sweep;
      const angle = (p: Vec2): number => positive(Math.atan2(p[1] - carrier.c[1], p[0] - carrier.c[0]) - (carrier.from + carrier.sweep));
      along = (p) => (end === 'end' ? angle(p) : rest - angle(p)) * carrier.r;
      break;
    }
    case 'circle':
      return 'a circle has no end to extend';
    default:
      return unreachable(carrier, 'carrier');
  }
  const geometry = { points, radii: world.geometry.radii };
  const joins = (id: Id): Id => (id.startsWith('\u0000') ? id : world.joins(id));
  const contactsWith = (C: Id): { at: Vec2; d: number; touch: boolean }[] => {
    const curveC = curveOf(world, C);
    if (!curveC) return [];
    return (curveContacts(stretch, curveC, joins, geometry)?.points ?? []).flatMap((contact) => {
      const p = contact.at;
      const d = along(p);
      if (d <= tol || dist2(p, e) <= tol) return [];
      if (carrier.type === 'arc' && dist2(p, end === 'end' ? xy(points[far]) : xy(points[near])) <= tol) return [];
      return [{ at: p, d, touch: contact.kind === 'touch' }];
    });
  };
  // a touch with a circle is a cut only when the circle gets a second point
  const touchCut = (C: Id): boolean => {
    if (!bothCut || !cuttable(world, X) || !cuttable(world, C) || isRound(world, X) === isRound(world, C)) return false;
    return curveOf(world, C)?.shape.type !== 'circle' || circlePlaces(world, C) + 1 >= 2;
  };
  const found: { at: Vec2; with: Id; d: number; touch: boolean }[] = [];
  const passed: { at: Vec2; with: Id; d: number }[] = [];
  for (const C of cuttersOf(world, X, withId)) {
    for (const contact of contactsWith(C)) {
      if (contact.touch && !touchCut(C)) passed.push({ at: contact.at, with: C, d: contact.d });
      else found.push({ ...contact, with: C });
    }
  }
  found.sort((p, q) => p.d - q.d);
  const stop = found[0];
  if (!stop) {
    // a copy on the way is no stop: it is never cut, and no point can be held on it (D68)
    if (withId === undefined) {
      const copies = [...world.curves.keys()].flatMap((C) => {
        const copy = C === X ? undefined : copyParts(world.sketch, C);
        return copy ? contactsWith(C).map((contact) => ({ ...contact, C, copy })) : [];
      });
      copies.sort((p, q) => p.d - q.d);
      if (copies.length > 0) {
        const { C, copy, at } = copies[0];
        return `the extension of "${X}" beyond "${E}" meets no curve it can stop at, only "${C}" at ${fmt(at)}: ${copyInTool(C, copy.entry, copy.source)}; an extension stops only at a curve that is cut there or holds its new end, and a copy does neither`;
      }
    }
    if (carrier.type === 'arc') return `the extension of the arc "${X}" comes round to the arc itself before it meets ${withId ? `"${withId}"` : 'another curve'}`;
    return `the extension of "${X}" beyond "${E}" meets ${withId ? `no "${withId}"` : 'nothing'}`;
  }
  if (Math.abs(stop.at[0]) > MAX_NUMBER || Math.abs(stop.at[1]) > MAX_NUMBER) return `the new end of "${X}" would be out of the range ±${MAX_NUMBER}`;
  // with `with`, the curves that form regions the stretch crosses before it stops
  const before: { at: Vec2; with: Id }[] = [];
  if (withId !== undefined && bothCut) {
    for (const C of cuttersOf(world, X)) {
      if (C === stop.with) continue;
      for (const contact of contactsWith(C)) if (contact.d < stop.d - tol && !(contact.touch && !touchCut(C))) before.push({ at: contact.at, with: C });
    }
  }
  // curves that form regions and may not be cut, met on the way, the nearest first
  const stuck: { at: Vec2; with: Id; d: number }[] = [];
  if (formsRegions(world, X)) {
    for (const [C, curveC] of world.curves) {
      if (C === X || !world.predicates.formsRegions(curveC) || world.predicates.mayCut(curveC)) continue;
      for (const contact of contactsWith(C)) if (contact.d <= stop.d + tol) stuck.push({ at: contact.at, with: C, d: contact.d });
    }
  }
  stuck.sort((p, q) => p.d - q.d);
  return { at: stop.at, target: stop.with, touch: stop.touch, before, passed: passed.filter((p) => p.d < stop.d - tol), stuck: stuck.map(({ at, with: C }) => ({ at, with: C })) };
}

// Why the end of X cannot be extended, if it cannot.
function endProblem(world: World, X: Id, end: string): string | undefined {
  const curve = world.sketch.curves[X];
  const names = endNames(curve);
  if (names.length === 0) return `"${X}" is a circle and has no end to extend`;
  if (!(names as readonly string[]).includes(end)) return `a ${curve.type} has the ends ${names.join(' and ')}, not "${end}"`;
  const E = (curve as unknown as Record<string, Id>)[end];
  const vertex = world.joins(E);
  for (const [id, other] of Object.entries(world.sketch.curves)) {
    // a curve that forms no regions (a span line, a construction line) makes no T in the profile:
    // the old end stays, held on the line of X, as an end cut off by a trim
    if (id === X || !formsRegions(world, id)) continue;
    if (endsOf(other).some((p) => world.joins(p) === vertex)) return `"${id}" ends at "${E}" too; extending "${X}" would leave the end of "${id}" in its middle`;
  }
  const e = position(world, E) as Vec2;
  for (const id of world.curves.keys()) {
    if (id === X || !formsRegions(world, id)) continue;
    const carrier = carrierOf(world, id);
    if (carrier && curveHas(carrier, e) && !atEnd(world, id, e)) return `"${E}" lies on "${id}" away from its ends; the extension would pass through "${id}"`;
  }
  return undefined;
}

function extendSpec(world: World, input: ExtendInput, repairOfSketch = true): CutSpec | string {
  const X = input.curve;
  const problem = endProblem(world, X, input.end);
  if (problem) return problem;
  const repairOn = repairOf(world, input.repair);
  const bothCut = repairOn && cuttable(world, X);
  const reach = reachOf(world, X, input.end, input.with, bothCut);
  if (typeof reach === 'string') return reach;
  const target = curveOf(world, reach.target) as SketchCurve;
  // in a profile that was valid, an extension that would leave a contact no tool can cut is refused
  // (owner, answer 10)
  if (bothCut && world.result.valid) {
    if (reach.stuck.length > 0) {
      const { with: C, at } = reach.stuck[0];
      const copy = copyParts(world.sketch, C);
      if (copy) return `the extension of "${X}" would meet "${C}" at ${fmt(at)}, where no cut can be made: the profile would become invalid; ${copyInTool(C, copy.entry, copy.source)}`;
      return `the extension of "${X}" would meet "${C}" at ${fmt(at)}, a curve that forms regions and is not own, which no tool cuts: the profile would become invalid; draw an own curve over it or change its source`;
    }
    if (reach.passed.length > 0) return `the extension of "${X}" would pass ${fmt(reach.passed[0].at)}, where it only touches "${reach.passed[0].with}", which no tool can cut: the profile would become invalid`;
    if (target.shape.type === 'circle' && cuttable(world, reach.target) && circlePlaces(world, reach.target) + 1 < 2) return `the extension of "${X}" would end on the circle "${reach.target}", which would then have that one point and cannot be cut: the profile would become invalid; draw across the circle and trim instead`;
  }
  const events: Event[] = [];
  let ends: [Id, Id][] = [];
  let uncut = new Set<Id>();
  if (bothCut && repairOfSketch) {
    const repair = repairEvents(world);
    events.push(...repair.events);
    ends = repair.ends;
    uncut = repair.uncut;
  }
  const stretch = reach.before.map((b) => event(b.at, [X, b.with], []));
  // the curve met: cut there when both take part in the profile and the repair is on, else the new
  // end held on it
  const meets = bothCut && cuttable(world, reach.target) ? { ...event(reach.at, [reach.target], [], true, reach.touch ? [X, reach.target] : undefined), endsHere: [X] } : event(reach.at, [], holdsPoint(world, reach.target) ? [reach.target] : [], true);
  return { events: [...events, meets], ends, uncut, extend: { X, end: input.end, at: reach.at, target: reach.target, stretch } };
}

function splitSpec(world: World, input: SplitInput): CutSpec | string {
  if (input.curve === undefined) {
    if (input.with !== undefined || input.at !== undefined) return '`with` and `at` need `curve`';
    return repairEvents(world);
  }
  const X = input.curve;
  const carrier = carrierOf(world, X) as Carrier;
  if (input.at !== undefined && carrier.type === 'circle') return `at: one point does not split the circle "${X}"; split it without \`at\` (at two points or more)`;
  const found = cutsOf(world, X, cuttersOf(world, X, input.with), carrier, true);
  let cuts = found.cuts;
  if (cuts.length === 0 && found.touches.length > 0 && carrier.type === 'circle') return `the circle "${X}" is touched at one point only; one point does not split a circle`;
  if (cuts.length === 0) return input.with !== undefined ? `"${X}" has no contact with "${input.with}" away from its ends` : `nothing crosses or touches "${X}" away from its ends`;
  if (input.at !== undefined) {
    const at = input.at;
    cuts = [cuts.reduce((best, cut) => (dist2(cut.at, at) < dist2(best.at, at) ? cut : best))];
  }
  return { events: cuts.map((cut) => contactEvent(world, X, cut.with, cut, false, true)), ends: [], uncut: new Set() };
}

// ---------------------------------------------------------------- stage 3: the features over the sketch

// A point in a loop: on the exact curves when the loop has them, else on its polygon `Loop.xy` (the
// polygon the body is built from), where a point nearer to the polygon than the margin is not
// decided (undefined): two polylines of one curve differ by up to twice the chord tolerance.
function polygonHas(p: Vec2, xy: number[]): boolean {
  let odd = false;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [xy[2 * i], xy[2 * i + 1], xy[2 * j], xy[2 * j + 1]];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}
function polygonDistance(p: Vec2, xy: number[]): number {
  let best = Infinity;
  const n = xy.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay, bx, by] = [xy[2 * j], xy[2 * j + 1], xy[2 * i], xy[2 * i + 1]];
    const [dx, dy] = [bx - ax, by - ay];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}
function loopHas(p: Vec2, loop: Region['outer'], margin: number): boolean | undefined {
  if (loop.exact) return inside(p, loop.exact);
  if (polygonDistance(p, loop.xy) <= margin) return undefined;
  return polygonHas(p, loop.xy);
}
// true, false, or undefined when a loop without exact curves cannot tell
function regionHas(p: Vec2, region: Region, margin: number): boolean | undefined {
  const outer = loopHas(p, region.outer, margin);
  if (outer !== true) return outer;
  let unknown = false;
  for (const hole of region.holes) {
    const h = loopHas(p, hole, margin);
    if (h === true) return false;
    if (h === undefined) unknown = true;
  }
  return unknown ? undefined : true;
}
const exactRegion = (region: Region): boolean => region.outer.exact !== undefined && region.holes.every((hole) => hole.exact !== undefined);

// A point inside a region away from its boundary that every region of `against` decides: stepped in
// from the middle of a curve of its outer loop (the material is on the left), or of a piece of its
// polygon when the loop has no exact curves. Smaller steps for a thin region.
function sampleOf(region: Region, margin: number, against: readonly Region[]): Vec2 | undefined {
  const ok = (p: Vec2): boolean => regionHas(p, region, margin) === true && against.every((r) => regionHas(p, r, margin) !== undefined);
  const outer = region.outer.exact;
  if (!outer) {
    const xy = region.outer.xy;
    const n = xy.length / 2;
    const pieces = Array.from({ length: n }, (_, i) => {
      const j = (i + 1) % n;
      return { a: [xy[2 * i], xy[2 * i + 1]] as Vec2, b: [xy[2 * j], xy[2 * j + 1]] as Vec2 };
    }).sort((p, q) => dist2(q.a, q.b) - dist2(p.a, p.b));
    let area = 0;
    for (let i = 0; i < n; i++) area += xy[2 * i] * xy[2 * ((i + 1) % n) + 1] - xy[2 * ((i + 1) % n)] * xy[2 * i + 1];
    const left = area > 0 ? 1 : -1;
    for (const d of [8 * margin, 4 * margin, 2 * margin + 10 * tol, 32 * margin, 128 * margin, 1024 * margin]) {
      for (const piece of pieces.slice(0, 64)) {
        const [dx, dy] = [piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]];
        const l = Math.hypot(dx, dy);
        if (l === 0) continue;
        const p: Vec2 = [(piece.a[0] + piece.b[0]) / 2 - (left * dy * d) / l, (piece.a[1] + piece.b[1]) / 2 + (left * dx * d) / l];
        if (ok(p)) return p;
      }
    }
    return undefined;
  }
  const length = (c: (typeof outer)[number]): number => {
    switch (c.type) {
      case 'line':
        return dist2(c.from, c.to);
      case 'arc':
        return Math.abs(c.sweep) * c.radius;
      case 'circle':
        return TAU * c.radius;
      default:
        return unreachable(c, 'curve');
    }
  };
  const curves = [...outer].sort((p, q) => length(q) - length(p));
  for (const k of [8, 64, 512, 4096, 32768]) {
    for (const c of curves) {
      const d = length(c) / k;
      if (d < 10 * tol) continue;
      let p: Vec2;
      switch (c.type) {
        case 'line': {
          const [dx, dy] = [c.to[0] - c.from[0], c.to[1] - c.from[1]];
          const l = Math.hypot(dx, dy);
          p = [(c.from[0] + c.to[0]) / 2 - (dy / l) * d, (c.from[1] + c.to[1]) / 2 + (dx / l) * d];
          break;
        }
        case 'arc': {
          const angle = c.start + c.sweep / 2;
          const inward = c.sweep > 0 ? -1 : 1;
          p = [c.center[0] + (c.radius + inward * d) * Math.cos(angle), c.center[1] + (c.radius + inward * d) * Math.sin(angle)];
          break;
        }
        case 'circle':
          p = [c.center[0] + c.radius + (c.ccw ? -d : d), c.center[1]];
          break;
        default:
          return unreachable(c, 'curve');
      }
      if (ok(p)) return p;
    }
  }
  return undefined;
}

// R as it was: R with the holes the profile would give it had everything that does not cross its
// outline been cut first (design.md, "Regions"): the curves that form regions and touch none of R's
// curves (nor end at a vertex of them), cut in memory at their contacts with each other, the pieces with a free end pruned
// (counted among the pieces that are not R's), and R a region of its curves and what stays.
function regionAsItWas(before: SketchWorld, predicates: CurvePredicates, region: RegionRef, chord: number): Region | undefined {
  const own = region.outerLoop;
  const curve = (id: Id): SketchCurve | undefined => before.curves.get(id);
  if (!own.every((id) => {
    const c = curve(id);
    return c !== undefined && predicates.formsRegions(c);
  }))
    return undefined;
  // 1. what touches a curve of the region apart from a common point, and what ends at a vertex of
  // its outline: a curve that crossed the outline and was cut there by an earlier batch (the notch
  // circle split while the sketch stayed invalid) crosses it all the same; kept, its pieces would
  // close a loop through R's vertices and divide R
  const vertices = new Set(own.flatMap((id) => endsOf((curve(id) as SketchCurve).shape).map((p) => before.joins(p))));
  const attached = (c: SketchCurve): boolean => endsOf(c.shape).some((p) => vertices.has(before.joins(p)));
  const others = [...before.curves.values()].filter((c) => predicates.formsRegions(c) && !own.includes(c.id) && !attached(c) && own.every((id) => !curvesTouch(curve(id) as SketchCurve, c, before.joins, before.geometry)));
  // 2. the rest cut where they meet, in memory
  const cut = cutInMemory(before, others.map((c) => c.id));
  const fromOthers = (id: Id): boolean => others.some((o) => id === o.id || id.startsWith(`${o.id}\u0000`));
  let pieces = [...cut.curves.values()].filter((c) => fromOthers(c.id));
  // 3. pieces with a free end go, again until none has one
  for (;;) {
    const count = new Map<Id, number>();
    for (const o of pieces) for (const p of endsOf(o.shape)) count.set(cut.joins(p), (count.get(cut.joins(p)) ?? 0) + 1);
    const free = pieces.filter((o) => endsOf(o.shape).some((p) => (count.get(cut.joins(p)) ?? 0) < 2));
    if (free.length === 0) break;
    pieces = pieces.filter((o) => !free.includes(o));
  }
  // 4. R a region of its curves and the pieces that stay, with its holes
  const profile = profileOf([...own.map((id) => cut.curves.get(id) as SketchCurve), ...pieces], cut.joins, cut.geometry, chord);
  return profile.valid ? profile.regions.find((r) => sameRegion(r.ref, region)) : undefined;
}

// The geometry of the piece a trim removes, to put back into the faces: a curve over points of the
// sketch after the batch where they are there, else over points of its own.
function removedPiece(world: World, plan: Plan, spec: CutSpec, afterSketch: SketchFeature): { curve: Curve; points: Record<Id, Point2> } | undefined {
  const trim = spec.trim;
  if (!trim) return undefined;
  const { X, carrier, piece } = trim;
  const points: Record<Id, Point2> = {};
  let counter = 0;
  const pointAt = (at: Vec2, known?: Id): Id => {
    if (known !== undefined && (known === ORIGIN || has(afterSketch.points, known))) return known;
    const id = `\u0000put${++counter}`;
    points[id] = { x: at[0], y: at[1] };
    return id;
  };
  const original = world.sketch.curves[X];
  const ends = endsOf(original);
  const from = piece.lo ? pointAt(piece.lo.at, findPoint(plan, piece.lo.at, world)) : pointAt(pointOn(carrier, piece.from), ends[0]);
  const to = piece.hi ? pointAt(piece.hi.at, findPoint(plan, piece.hi.at, world)) : pointAt(pointOn(carrier, carrier.type === 'arc' ? carrier.sweep : piece.to), ends[1]);
  switch (original.type) {
    case 'line':
      return { curve: { type: 'line', a: from, b: to }, points };
    case 'arc':
      return { curve: { type: 'arc', center: pointAt(position(world, original.center) as Vec2, original.center), start: from, end: to }, points };
    case 'circle': {
      const center = pointAt(position(world, original.center) as Vec2, original.center);
      if (trim.whole) return { curve: { type: 'circle', center }, points };
      return { curve: { type: 'arc', center, start: from, end: to }, points };
    }
    default:
      return unreachable(original, 'curve');
  }
}

// The middle of the piece a trim removes, or of the stretch an extension adds: where a hole of
// a region that keeps its name may have changed (`reshaped`).
function middleOf(world: World, spec: CutSpec, plan: Plan): { curve: Id; at: Vec2 } | undefined {
  if (spec.trim) {
    const { X, carrier, piece } = spec.trim;
    const mid = (piece.from + piece.to) / 2;
    return { curve: X, at: pointOn(carrier, carrier.type === 'circle' ? positive(mid) : mid) };
  }
  if (spec.extend && plan.newEnd) {
    const { X, end } = spec.extend;
    const carrier = carrierOf(world, X) as Carrier;
    const old = position(world, (world.sketch.curves[X] as unknown as Record<string, Id>)[end]) as Vec2;
    const now = spec.extend.at;
    switch (carrier.type) {
      case 'line':
        return { curve: X, at: [(old[0] + now[0]) / 2, (old[1] + now[1]) / 2] };
      case 'arc':
      case 'circle': {
        const [a, b] = [Math.atan2(old[1] - carrier.c[1], old[0] - carrier.c[0]), Math.atan2(now[1] - carrier.c[1], now[0] - carrier.c[0])];
        const turn = end === 'end' ? positive(b - a) : -positive(a - b);
        const angle = a + turn / 2;
        return { curve: X, at: [carrier.c[0] + carrier.r * Math.cos(angle), carrier.c[1] + carrier.r * Math.sin(angle)] };
      }
      default:
        return unreachable(carrier, 'carrier');
    }
  }
  return undefined;
}

// The outer loop of a region rewritten by names: each curve read through `piecesOf`, sorted and
// without duplicates as a region is named.
const loopByNames = (loop: readonly Id[], changes: CurveChanges, sketch: SketchFeature): Id[] => [...new Set(loop.flatMap((id) => piecesOf(changes, sketch, id) ?? [id]))].sort();

interface Patches {
  commands: Command[];
  patched: Id[];
  dropped: Id[];
  pending: Id[];
  reshaped: Id[];
  shortened: Id[];
  broken: Id[];
  regionsAfter: Map<Id, RegionRef[]>; // the regions of the features over the sketch after the patches
  validAfter: boolean; // the profile of the sketch after the batch
}

// The regions, walls and edge lists of the features over the sketch, patched in the same batch.
function patchFeatures(world: World, plan: Plan, spec: CutSpec, changes: CurveChanges, afterDoc: Document, tool: CutRequest['tool'], joined: readonly JoinedCurve[]): Patches {
  const { sketch, doc } = world;
  const chord = doc.settings.chordTolerance;
  const margin = 2 * chord;
  const out: Patches = { commands: [], patched: [], dropped: [], pending: [], reshaped: [], shortened: [], broken: [], regionsAfter: new Map(), validAfter: true };
  const afterSketch = afterDoc.features.find((f) => f.id === sketch.id) as SketchFeature;
  const newPoints: Record<Id, Point2> = {};
  for (const [id, at] of plan.model.newPoints) newPoints[id] = { x: at[0], y: at[1] };
  const after = sketchWorld(toolBase(afterSketch, world.result, { points: newPoints }));
  const before = sketchWorld(toolBase(sketch, world.result, { pairs: plan.joined }));
  const regionCurves = (w: SketchWorld): SketchCurve[] => [...w.curves.values()];
  const profileAfter = profileOf(regionCurves(after), after.joins, after.geometry, chord);
  out.validAfter = profileAfter.valid;
  const changedOrGone = new Set<Id>([...changes.changed, ...changes.removed, ...Object.keys(changes.pieces)]);
  // a curve the batch changed or removed, or a copy of one (D68)
  const touched = (id: Id): boolean => changedOrGone.has(id) || (id.includes('/') && piecesOf(changes, afterSketch, id) !== undefined);
  const regionsBefore = world.result.regions.map((r) => r.ref);
  const madeValid = !world.result.valid && profileAfter.valid;
  const asItWas = new Map<string, Region | undefined>();
  const wasOf = (region: RegionRef): Region | undefined => {
    const key = region.outerLoop.join('\u0000');
    if (!asItWas.has(key)) asItWas.set(key, regionAsItWas(before, world.predicates, region, chord));
    return asItWas.get(key);
  };
  // the faces of the cut sketch: the sketch after the batch with the removed piece put back, every
  // contact of the curves that form regions cut in memory
  let faces: Profile | undefined;
  const facesOf = (): Profile => {
    if (faces) return faces;
    const put = removedPiece(world, plan, spec, afterSketch);
    if (!put) return (faces = profileAfter);
    const id = '\u0000putback';
    // the piece put back into the entries that listed the trimmed curve, so the copies are those as
    // they were, cut where the source is cut (D68)
    const X = spec.trim?.X;
    const external = Object.fromEntries(
      Object.entries(afterSketch.external).map(([entry, ref]) => [entry, ref.type === 'pattern' && X !== undefined && (sketch.external[entry] as SketchPattern | undefined)?.sources.includes(X) ? { ...ref, sources: [...ref.sources, id] } : ref]),
    );
    const memory: SketchFeature = { ...afterSketch, points: { ...afterSketch.points, ...put.points }, curves: { ...afterSketch.curves, [id]: put.curve }, external };
    const radii: Record<Id, number> = put.curve.type === 'circle' && spec.trim ? { [id]: world.geometry.radii[spec.trim.X] } : {};
    const withPiece = sketchWorld(toolBase(memory, world.result, { points: { ...newPoints, ...put.points }, radii }));
    // a removed piece that lies on a curve that stays (a duplicate) bounds nothing the other does not
    const piece = withPiece.curves.get(id) as SketchCurve;
    const duplicate = regionCurves(after).some((c) => c.regions && curveContacts(piece, c, withPiece.joins, withPiece.geometry)?.lying === true);
    const base = duplicate ? after : withPiece;
    const cut = cutInMemory(base, [...base.curves.values()].filter((c) => c.regions).map((c) => c.id));
    return (faces = profileOf(regionCurves(cut), cut.joins, cut.geometry, chord));
  };
  const loopsExact = (): boolean => (facesOf().regions.every(exactRegion) && profileAfter.regions.every(exactRegion));

  for (const feature of doc.features) {
    const source = profileSourceOf(feature);
    if (!source || source.sketch !== sketch.id) continue;
    if (source.type === 'regions') {
      let regions: RegionRef[] = source.regions;
      let dropped = false;
      let pending = false;
      if (!profileAfter.valid) {
        // still crossed: the regions that name a changed curve rewritten by names
        regions = [];
        for (const region of source.regions) {
          if (!region.outerLoop.some(touched)) {
            regions.push(region);
            continue;
          }
          pending = true;
          const outerLoop = loopByNames(region.outerLoop, changes, afterSketch);
          if (outerLoop.length > 0) regions.push({ ...region, outerLoop });
          else dropped = true;
        }
        if (regions.length === 0) regions = source.regions;
      } else {
        const kept: RegionRef[] = [];
        const added: RegionRef[] = [];
        for (const region of source.regions) {
          if (profileAfter.regions.some((r) => sameRegion(r.ref, region))) {
            kept.push(region);
            continue;
          }
          // which regions are followed: one that names a changed curve, one that was a region before
          // the batch, or, in a batch that makes the profile valid, one whose curves all exist
          // a region of copies the count does not make (no region before, a copy the world as it was
          // has not): no face follows it, so it is rewritten by names (D68); its feature is in
          // `patched` alone
          if (!regionsBefore.some((r) => sameRegion(r, region)) && region.outerLoop.some((id) => copyParts(afterSketch, id) !== undefined && !before.curves.has(id))) {
            kept.push(copiesByNames(region, changes, afterSketch, joined) ?? region);
            continue;
          }
          const followed = region.outerLoop.some(touched) || regionsBefore.some((r) => sameRegion(r, region)) || (madeValid && region.outerLoop.every((id) => after.curves.has(id)));
          if (!followed) {
            kept.push(region);
            continue;
          }
          const was = wasOf(region);
          const cutFaces = facesOf();
          if (!was || !cutFaces.valid) {
            kept.push(region);
            dropped = true;
            continue;
          }
          const into: RegionRef[] = [];
          let undecided = false;
          for (const face of cutFaces.regions) {
            const p = sampleOf(face, margin, [was, ...profileAfter.regions]);
            if (!p) {
              if (!exactRegion(face) || !exactRegion(was) || !loopsExact()) undecided = true;
              continue;
            }
            if (regionHas(p, was, margin) !== true) continue;
            const hit = profileAfter.regions.find((r) => regionHas(p, r, margin) === true);
            if (hit && !into.some((r) => sameRegion(r, hit.ref))) into.push(hit.ref);
          }
          if (undecided) {
            kept.push(region);
            dropped = true;
            continue;
          }
          if (into.length === 0) dropped = true;
          for (const r of into) if (!kept.some((k) => sameRegion(k, r)) && !added.some((a) => sameRegion(a, r))) added.push(r);
        }
        regions = [...kept, ...added.filter((a) => !kept.some((k) => sameRegion(k, a)))];
        if (regions.length === 0) regions = source.regions;
        // a region that keeps its name while a hole inside it changed (`reshaped`)
        const middle = tool === 'split' ? undefined : middleOf(world, spec, plan);
        if (middle && !out.reshaped.includes(feature.id)) {
          const probes = reshapedProbes(sketch, before, [middle]);
          for (const region of source.regions) {
            const now = profileAfter.regions.find((r) => sameRegion(r.ref, region));
            if (!now || !probes.some((p) => loopHas(p, now.outer, margin) === true)) continue;
            const was = wasOf(region);
            const cutFaces = facesOf();
            if (!was || !cutFaces.valid) continue;
            const differs = cutFaces.regions.some((face) => {
              const p = sampleOf(face, margin, [was, now]);
              return p !== undefined && regionHas(p, was, margin) !== regionHas(p, now, margin);
            });
            if (differs) {
              out.reshaped.push(feature.id);
              break;
            }
          }
        }
      }
      if (dropped) out.dropped.push(feature.id);
      if (pending) out.pending.push(feature.id);
      out.regionsAfter.set(feature.id, regions);
      if (JSON.stringify(regions) !== JSON.stringify(source.regions)) {
        out.commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { regions } } as FeaturePatch });
        out.patched.push(feature.id);
      }
    } else if (source.type === 'wall') {
      if (!source.curves.some(touched)) continue;
      const curves = source.curves.flatMap((id) => piecesOf(changes, afterSketch, id) ?? [id]);
      if (curves.length === 0) {
        out.broken.push(feature.id);
        continue;
      }
      if (source.curves.some((id) => plan.cuts.get(id)?.lostPiece)) out.shortened.push(feature.id);
      out.regionsAfter.set(feature.id, []);
      if (JSON.stringify(curves) !== JSON.stringify(source.curves)) {
        out.commands.push({ type: 'updateFeature', id: feature.id, patch: { profile: { curves } } as FeaturePatch });
        out.patched.push(feature.id);
      }
    }
  }
  patchBlends(world, plan, changes, afterDoc, before, after, profileAfter, out);
  return out;
}

// The edges of the chamfers and fillets (D63) on the sides of cut curves of the features over the
// sketch, rewritten to the pieces (design.md, "Walls, edges and what reads a curve"): the place of
// an edge is kept (a face of a blend is named by it), further pieces are appended, and an edge no
// piece has is taken out only when nothing names a face of the blend at its place or a later one.
function patchBlends(world: World, plan: Plan, changes: CurveChanges, afterDoc: Document, before: SketchWorld, after: SketchWorld, profileAfter: Profile, out: Patches): void {
  const { doc, sketch } = world;
  const afterSketch = afterDoc.features.find((f) => f.id === sketch.id) as SketchFeature;
  const over = new Map<Id, ProfileSource>();
  for (const feature of doc.features) {
    const source = profileSourceOf(feature);
    if (source?.sketch === sketch.id) over.set(feature.id, source);
  }
  const cutCurve = (id: Id): boolean => {
    const pieces = piecesOf(changes, afterSketch, id);
    return pieces !== undefined && !(pieces.length === 1 && pieces[0] === id);
  };
  const sideOfCut = (face: FaceName): face is Extract<FaceName, { role: 'side' | 'wallSide' }> => (face.role === 'side' || face.role === 'wallSide') && over.has(face.feature) && cutCurve(face.curve);
  const vertices = (w: SketchWorld, id: Id): Id[] => {
    const curve = w.curves.get(id);
    return curve ? endsOf(curve.shape).filter((p) => has(w.geometry.points, p)).map((p) => w.joins(p)) : [];
  };
  // does a piece still bound its feature: in a loop of exactly one of its regions after the batch, or
  // in the list of its wall
  const bounds = (feature: Id, piece: Id): boolean => {
    const source = over.get(feature);
    if (source?.type === 'wall') {
      const patched = out.commands.find((c): c is Extract<Command, { type: 'updateFeature' }> => c.type === 'updateFeature' && c.id === feature);
      const curves = (patched?.patch as { profile?: { curves?: Id[] } } | undefined)?.profile?.curves ?? source.curves;
      return curves.includes(piece);
    }
    if (!profileAfter.valid) return true;
    const refs = out.regionsAfter.get(feature) ?? (source?.type === 'regions' ? source.regions : []);
    return profileAfter.regions.filter((r) => refs.some((ref) => sameRegion(ref, r.ref)) && [r.outer, ...r.holes].some((loop) => loop.curves.includes(piece))).length === 1;
  };
  const sectionFaces = (): FaceName[] => {
    const faces: FaceName[] = [];
    for (const name of Object.keys(DOCUMENT_SECTIONS) as (keyof typeof DOCUMENT_SECTIONS)[]) facesIn(doc[name], faces);
    return faces;
  };
  // A face `wallEnd` of a wall over the sketch after the batch: undefined while its chain still ends
  // at its point, the face at the new end of the chain when one end is new, null when that is not
  // known (the blend then names what is gone).
  const chainEnds = (of: SketchFeature, curves: Id[]): Map<Id, number> => {
    const count = new Map<Id, number>();
    for (const id of curves) if (has(of.curves, id)) for (const p of endsOf(of.curves[id])) count.set(p, (count.get(p) ?? 0) + 1);
    return count;
  };
  const wallEndNow = (face: FaceName): FaceName | null | undefined => {
    if (face.role !== 'wallEnd') return undefined;
    const source = over.get(face.feature);
    if (source?.type !== 'wall') return undefined;
    const patched = out.commands.find((c): c is Extract<Command, { type: 'updateFeature' }> => c.type === 'updateFeature' && c.id === face.feature);
    const curves = (patched?.patch as { profile?: { curves?: Id[] } } | undefined)?.profile?.curves ?? source.curves;
    const endsBefore = chainEnds(sketch, source.curves);
    // a face that was stale before the batch is not this batch's to follow or to report
    if (endsBefore.get(face.point) !== 1) return undefined;
    const endsAfter = chainEnds(afterSketch, curves);
    if (endsAfter.get(face.point) === 1) return undefined;
    const fresh = [...endsAfter].filter(([p, n]) => n === 1 && endsBefore.get(p) !== 1).map(([p]) => p);
    return fresh.length === 1 ? { ...face, point: fresh[0] } : null;
  };
  for (const blend of doc.features) {
    if (blend.type !== 'chamfer' && blend.type !== 'fillet') continue;
    const edges: EdgeName[] = [...blend.edges];
    const appended: EdgeName[] = [];
    const gone: number[] = [];
    const rewritten: number[] = [];
    let lost = false;
    let touched = false;
    let namesGone = false;
    for (const [i, named] of blend.edges.entries()) {
      // the straight end of a wall whose chain no longer ends at its point: the new end of the chain
      // where there is one, else the blend names what is gone
      const [na, nb] = [wallEndNow(named.a), wallEndNow(named.b)];
      if (na === null || nb === null) {
        touched = true;
        namesGone = true;
        continue;
      }
      const edge: EdgeName = na || nb ? { a: na ?? named.a, b: nb ?? named.b } : named;
      if (edge !== named) {
        touched = true;
        lost = true; // the end of the wall moved: look at the blend
        edges[i] = edge;
        rewritten.push(i);
      }
      const flip = !sideOfCut(edge.a);
      const [s, o] = flip ? [edge.b, edge.a] : [edge.a, edge.b];
      if (!sideOfCut(s)) continue;
      touched = true;
      const X = s.curve;
      if (plan.cuts.get(X)?.lostPiece) lost = true;
      const make = (piece: Id, other: FaceName): EdgeName => (flip ? { a: other, b: { ...s, curve: piece } } : { a: { ...s, curve: piece }, b: other });
      let list: EdgeName[];
      // a copy the count does not make (D68): no world has it, so its edges are rewritten by names
      // through its source, the copy of a piece having the copy of a point exactly when the piece has
      // the point
      const unmadeX = before.curves.has(X) ? undefined : copyParts(afterSketch, X);
      if (o.feature === s.feature && (o.role === 'side' || o.role === 'wallSide')) {
        // a vertical edge at a vertex of the profile: the pieces of X and of Y that have it after
        const Y = o.curve;
        list = [];
        if (unmadeX) {
          const unmadeY = before.curves.has(Y) ? undefined : copyParts(afterSketch, Y);
          if (unmadeY && unmadeY.entry === unmadeX.entry && unmadeY.copy === unmadeX.copy) {
            const listed = (afterSketch.external[unmadeX.entry] as SketchPattern).sources;
            const copyOf = (piece: Id): Id => `${unmadeX.entry}/${unmadeX.copy}/${piece}`;
            for (const v of vertices(before, unmadeX.source).filter((p) => vertices(before, unmadeY.source).includes(p))) {
              if (!has(after.geometry.points, v)) continue;
              const at = (source: Id): Id | undefined => (has(changes.pieces, source) ? changes.pieces[source] : [source]).filter((piece) => listed.includes(piece)).find((piece) => vertices(after, piece).includes(after.joins(v)));
              const [px, py] = [at(unmadeX.source), at(unmadeY.source)];
              if (px && py) list.push(make(copyOf(px), { ...o, curve: copyOf(py) }));
            }
          }
        } else {
          const shared = vertices(before, X).filter((v) => vertices(before, Y).includes(v));
          for (const v of shared) {
            if (!has(after.geometry.points, v)) continue;
            const at = (curve: Id): Id | undefined => (piecesOf(changes, afterSketch, curve) ?? [curve]).find((piece) => vertices(after, piece).includes(after.joins(v)));
            const [px, py] = [at(X), at(Y)];
            if (px && py) list.push(make(px, { ...o, curve: py }));
          }
        }
      } else if (o.feature === s.feature && (o.role === 'startCap' || o.role === 'endCap')) {
        // of a copy the count does not make, every listed piece: its region is rewritten by names
        // to hold them all
        list = (piecesOf(changes, afterSketch, X) ?? [X]).filter((piece) => unmadeX !== undefined || bounds(s.feature, piece)).map((piece) => make(piece, o));
      } else if (o.feature === s.feature && o.role === 'wallEnd') {
        // the edge at the straight end of a wall: the piece of X that ends at that point
        const end = has(after.geometry.points, o.point) ? after.joins(o.point) : undefined;
        const piece = end === undefined ? undefined : (piecesOf(changes, afterSketch, X) ?? [X]).find((p) => vertices(after, p).includes(end));
        list = piece ? [make(piece, o)] : [];
      } else {
        // a face of another feature: which piece meets it is not known from the sketch; with no piece
        // left the edge names what is gone
        if ((piecesOf(changes, afterSketch, X) ?? [X]).length === 0) namesGone = true;
        else out.shortened.push(blend.id);
        continue;
      }
      if (list.length === 0) {
        gone.push(i);
        continue;
      }
      if (JSON.stringify(list[0]) !== JSON.stringify(edge) || list.length > 1) rewritten.push(i);
      edges[i] = list[0];
      appended.push(...list.slice(1));
    }
    if (!touched) continue;
    // an edge no piece has: taken out only when nothing names a face of the blend at its place or later
    const named = [...doc.features.filter((f) => f.id !== blend.id).flatMap((f) => facesIn(f)), ...sectionFaces()].flatMap((face) => (face.feature === blend.id && (face.role === 'chamfer' || face.role === 'fillet') ? [face.edge] : []));
    let broken = namesGone;
    for (const i of [...gone].sort((p, q) => q - p)) {
      if (named.some((edge) => edge >= i)) broken = true;
      else edges.splice(i, 1);
    }
    // a kept edge no piece has stays as it was
    let final = [...edges, ...appended];
    if (final.length === 0) {
      final = blend.edges;
      broken = true;
    }
    if (broken) out.broken.push(blend.id);
    if (JSON.stringify(final) !== JSON.stringify(blend.edges)) {
      out.commands.push({ type: 'updateFeature', id: blend.id, patch: { edges: final } as FeaturePatch });
      out.patched.push(blend.id);
      if (lost || gone.length > 0) out.shortened.push(blend.id);
    }
    // features that name the face of the blend at a rewritten place
    for (const feature of doc.features) {
      if (feature.id === blend.id) continue;
      if (facesIn(feature).some((face) => face.feature === blend.id && (face.role === 'chamfer' || face.role === 'fillet') && rewritten.includes(face.edge))) out.shortened.push(feature.id);
    }
  }
}

// ---------------------------------------------------------------- curves renamed one for one

// A value with the face names `face` renames replaced, at any depth; the value itself when none is.
function withFaces<T>(value: T, face: (name: FaceName) => FaceName | undefined): T {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = withFaces(item, face);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? items : value) as T;
  }
  if (typeof value !== 'object' || value === null) return value;
  const o = value as Record<string, unknown>;
  const base = (typeof o.feature === 'string' && typeof o.role === 'string' ? face(o as unknown as FaceName) : undefined) ?? o;
  let out: Record<string, unknown> | undefined;
  for (const [key, item] of Object.entries(base)) {
    const next = withFaces(item, face);
    if (next !== item) (out ??= { ...base })[key] = next;
  }
  return (out ?? base) as T;
}

// What reads curves of a sketch renamed one for one (6b's takeover, D69: the flag `regions` of a
// projection switched off and an own curve drawn over it at the same place, so that every region
// along it and every side face of it is named by the own curve after the batch), patched in the
// same batch as the cuts patch theirs: the regions rewritten by names (`piecesOf`, one piece per
// curve) and the side faces by the face rule (`sideOf`, of the features over the sketch).
// - the regions of the features over the sketch (`updateFeature` of `profile.regions`);
// - the edges of chamfers and fillets (`updateFeature` of `edges`; a face of a blend is named by the
//   place of its edge, which stays; an edge whose faces swap their order under the new name is
//   patched too, since a blend is symmetric in them);
// - the plane of a sketch (`setSketchPlane`) and the edges it projects (`updateExternal`);
// - the base and the midplane of a plane feature (`updateFeature`).
// A side face named anywhere else (an extent up to it, an axis, a frame, a split, a section entry),
// or a projected edge whose two faces would change their order under the new name (its line is
// oriented by them, so `<id>/a` would become `<id>/b`), is not patched: `unpatched` lists those
// readers (features in the order of the timeline, then the keys of section entries), and the
// caller refuses the rename. A wall names own curves only, so it never reads a projection.
export interface RenamePatches {
  commands: Command[];
  patched: Id[];
  unpatched: Id[];
}
export function renamePatches(document: Document, sketch: SketchFeature, renames: Readonly<Record<Id, Id>>): RenamePatches {
  const renamed = Object.keys(renames);
  const changes: CurveChanges = { changed: [], restarted: [], rekinded: [], removed: [], removedPoints: [], added: [], span: [], pieces: Object.fromEntries(renamed.map((id) => [id, [renames[id]]])), stretches: [] };
  const over = new Set(document.features.filter((f) => profileSourceOf(f)?.sketch === sketch.id).map((f) => f.id));
  const face = (name: FaceName): FaceName | undefined => {
    if (!over.has(name.feature) || !sideOf(name, renamed)) return undefined;
    const side = name as Extract<FaceName, { curve: Id }>;
    return { ...side, curve: (piecesOf(changes, sketch, side.curve) as Id[])[0] };
  };
  const names = (value: unknown): boolean => facesIn(value).some((name) => face(name) !== undefined);
  // a projected edge keeps the order of its faces under the new names
  const keepsOrder = (edge: EdgeName): boolean => {
    const c = canonicalEdge(edge);
    const next = { a: face(c.a) ?? c.a, b: face(c.b) ?? c.b };
    return canonicalEdge(next) === next;
  };
  const out: RenamePatches = { commands: [], patched: [], unpatched: [] };
  for (const feature of document.features) {
    if (feature.id === sketch.id) continue;
    const commands: Command[] = [];
    const patch: Record<string, unknown> = {};
    // the fields patched below; a renamed face in any other is not patched
    let handled: string[] = [];
    let unpatched = false;
    const source = profileSourceOf(feature);
    if (source?.type === 'regions' && source.sketch === sketch.id) {
      handled = ['profile'];
      const regions = source.regions.map((region) => ({ ...region, outerLoop: loopByNames(region.outerLoop, changes, sketch) }));
      if (JSON.stringify(regions) !== JSON.stringify(source.regions)) patch.profile = { regions };
    }
    switch (feature.type) {
      case 'sketch': {
        handled = ['plane', 'external'];
        const plane = withFaces(feature.plane, face);
        if (plane !== feature.plane) commands.push({ type: 'setSketchPlane', sketch: feature.id, plane });
        for (const [id, ref] of Object.entries(feature.external)) {
          const next = withFaces(ref, face);
          if (next === ref) continue;
          if (ref.type === 'edge' && !keepsOrder(ref.edge)) unpatched = true;
          else commands.push({ type: 'updateExternal', sketch: feature.id, id, ref: next });
        }
        break;
      }
      case 'chamfer':
      case 'fillet': {
        // a blend is symmetric in the two faces of its edge (one distance or radius) and pairs them
        // with the body's edge by the same canonical order, so an edge whose faces swap under the
        // new name is patched too, written canonically as a command would store it
        handled = ['edges'];
        const edges = withFaces(feature.edges, face);
        if (edges !== feature.edges) patch.edges = edges.map((edge, i) => (edge === feature.edges[i] ? edge : canonicalEdge(edge)));
        break;
      }
      case 'plane': {
        handled = ['base', 'midplaneWith'];
        for (const key of handled as ('base' | 'midplaneWith')[]) {
          const next = withFaces(feature[key], face);
          if (next !== feature[key]) patch[key] = next;
        }
        break;
      }
      default:
        break;
    }
    if (Object.entries(feature).some(([key, value]) => !handled.includes(key) && names(value))) unpatched = true;
    if (unpatched) {
      out.unpatched.push(feature.id);
      continue;
    }
    if (Object.keys(patch).length > 0) commands.push({ type: 'updateFeature', id: feature.id, patch: patch as FeaturePatch });
    if (commands.length === 0) continue;
    out.commands.push(...commands);
    out.patched.push(feature.id);
  }
  // the entries of the sections that name such a face
  const entries: Id[] = [];
  for (const name of Object.keys(DOCUMENT_SECTIONS) as (keyof typeof DOCUMENT_SECTIONS)[]) {
    const section = document[name] as unknown;
    if (typeof section !== 'object' || section === null) continue;
    for (const group of Object.values(section as Record<string, unknown>)) {
      if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
      for (const [key, entry] of Object.entries(group as Record<string, unknown>)) if (names(entry)) entries.push(key);
    }
  }
  out.unpatched.push(...[...new Set(entries)].sort());
  return out;
}

// ---------------------------------------------------------------- what reads a changed curve

// `moved`, `shortened` and `broken` of a batch, from its plan (design.md, "Walls, edges and what
// reads a curve"), for the fillet of D52 and the three tools alike. `document` is the document
// after the commands of the sketch (before the patches of the features); the patches add their own
// entries (walls, blends) to these lists.
// - `moved`: sketches and plane features on a side face of a line whose start was re-pointed.
// - `shortened`: sketches that project an edge of a side face of a changed curve (a circle that
//   became an arc included), or that project a changed curve itself from this sketch (D69, by the
//   entity references of their entries), not in `moved`.
// - `broken`: features and sections that name a removed curve or a face of it, an axis on it, a
//   sketch that projects a removed curve or point or a circle that became an arc (D69), a
//   point (a `sketchPoint`, a generator's operand) that is no longer an entity of the sketch (an
//   own point removed, a copy no entry makes now), or the straight end of a wall whose chain no
//   longer ends there.
// Features in the order of the timeline; `broken` then the IDs of section entries.
// `before` is the sketch before the batch (the sketch of `document` when left out): a copy reads as
// its source only when an entry of it lists the source, as it was before the batch (D68).
export function readersOf(document: Document, sketch: Id, changes: CurveChanges, before?: SketchFeature): { moved: Id[]; shortened: Id[]; broken: Id[] } {
  const changed = [...new Set([...changes.changed, ...changes.rekinded, ...Object.keys(changes.pieces)])];
  const removed = new Set(changes.removed);
  const moved: Id[] = [];
  const shortened: Id[] = [];
  const broken: Id[] = [];
  const after = document.features.find((f) => f.id === sketch);
  const listing = before ?? (after?.type === 'sketch' ? after : undefined);
  // a copy of a mirror or pattern reads as its source (D68): a face on the side of a copy of
  // a changed line, an axis on a copy of a removed one
  const sourceOf = (id: Id): Id => (listing && id.includes('/') ? (derivedOrigin(listing, id)?.source ?? id) : id);
  const onSide = (face: FaceName, curves: readonly Id[]): boolean => (face.role === 'side' || face.role === 'wallSide') && curves.includes(sourceOf(face.curve));
  const planeOnSide = (plane: PlaneRef, curves: readonly Id[]): boolean => plane.kind === 'face' && onSide(plane.face, curves);
  // a named point the batch removes, or a named entity that was one of the sketch before the batch
  // and is not one of the sketch of `document` (an own point removed, a copy whose source its entry
  // no longer copies). The rule of old ends and the fourth rule of the entries keep what is named
  // so; this names any gap they leave. (The fillet passes the document before its batch, where
  // nothing is lost; it removes no point.)
  const known = new Map<Id, boolean>();
  const lost = (id: Id): boolean => {
    if (changes.removedPoints.includes(id)) return true;
    if (!listing || after?.type !== 'sketch') return false;
    if (!known.has(id)) known.set(id, entityOf(listing, id) !== undefined && entityOf(after, id) === undefined);
    return known.get(id) as boolean;
  };
  for (const feature of document.features) {
    if (feature.id === sketch) continue;
    if ((feature.type === 'sketch' && planeOnSide(feature.plane, changes.restarted)) || (feature.type === 'plane' && planeOnSide(feature.base, changes.restarted))) moved.push(feature.id);
    // what a feature reads directly: a sketch its plane and the edges it projects, another feature
    // every face it names
    // (the edges of a chamfer or a fillet are left to the patch of the cut, which rewrites them and
    // says which blend stays broken: patchBlends)
    const read = feature.type === 'sketch' ? Object.values(feature.external).flatMap((ref) => kindOf(ref).faces(ref)) : feature.type === 'chamfer' || feature.type === 'fillet' ? [] : facesIn(feature);
    const faces = feature.type === 'sketch' ? [...facesIn(feature.plane), ...read] : read;
    // the entities it names by ID: every `sketchPoint` (an axis, a frame), an operand of a generated
    // profile
    const source = profileSourceOf(feature);
    const points = [...sketchPointsIn(feature, sketch), ...(source?.type === 'generated' && source.sketch === sketch ? Object.values(source.operands) : [])];
    // the entities of this sketch an entry of another sketch reads (a projection from a sketch,
    // D69), found by the references of its entries: broken when it is removed or of another kind
    // now, shortened when it is a curve that keeps its ID with another extent
    const projected = feature.type === 'sketch' ? Object.entries(feature.external).flatMap(([id, ref]) => kindOf(ref).refs(ref, `external/${id}`)).flatMap((ref) => (ref.kind === 'entity' && ref.sketch === sketch ? [ref.id] : [])) : [];
    const projectionBroken = projected.some((id) => removed.has(sourceOf(id)) || changes.rekinded.includes(sourceOf(id)) || lost(id));
    if (projectionBroken || faces.some((face) => onSide(face, [...removed])) || sketchLinesIn(feature, sketch).some((line) => removed.has(sourceOf(line))) || points.some(lost) || (after?.type === 'sketch' && wallEndBroken(document, after, changes, faces))) {
      broken.push(feature.id);
      continue;
    }
    if (feature.type === 'sketch' && (read.some((face) => onSide(face, changed)) || projected.some((id) => changed.includes(sourceOf(id)))) && !moved.includes(feature.id)) shortened.push(feature.id);
  }
  // the entries of the sections that name what goes: an axis on a removed line, a removed point
  const entries: Id[] = [];
  for (const name of Object.keys(DOCUMENT_SECTIONS) as (keyof typeof DOCUMENT_SECTIONS)[]) {
    const section = document[name] as unknown;
    if (typeof section !== 'object' || section === null) continue;
    for (const group of Object.values(section as Record<string, unknown>)) {
      if (typeof group !== 'object' || group === null || Array.isArray(group)) continue;
      for (const [key, entry] of Object.entries(group as Record<string, unknown>)) {
        if (sketchLinesIn(entry, sketch).some((line) => removed.has(sourceOf(line))) || sketchPointsIn(entry, sketch).some(lost) || facesIn(entry).some((face) => onSide(face, [...removed]))) entries.push(key);
      }
    }
  }
  return { moved, shortened, broken: [...broken, ...[...new Set(entries)].sort()] };
}

// A straight end of a wall over the sketch (`wallEnd` with a point) whose chain no longer ends there:
// the curves of the wall after the batch read through `piecesOf`.
function wallEndBroken(document: Document, sketch: SketchFeature, changes: CurveChanges, faces: FaceName[]): boolean {
  for (const face of faces) {
    if (face.role !== 'wallEnd') continue;
    const wall = document.features.find((f) => f.id === face.feature);
    const source = wall ? profileSourceOf(wall) : undefined;
    if (source?.type !== 'wall' || source.sketch !== sketch.id) continue;
    if (!source.curves.some((id) => has(changes.pieces, id))) continue;
    const curves = source.curves.flatMap((id) => piecesOf(changes, sketch, id) ?? [id]).filter((id) => has(sketch.curves, id));
    let count = 0;
    for (const id of curves) for (const p of endsOf(sketch.curves[id])) if (p === face.point) count++;
    if (count !== 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the lists

function lists(world: World, plan: Plan, changes: CurveChanges, patches: Patches, afterDoc: Document): Omit<CutIds, 'entries'> {
  const { sketch, doc } = world;
  const model = plan.model;
  const points = plan.pointsAtCuts.filter((p) => model.points.has(p) || p === ORIGIN);
  const constraints = model.newConstraints.filter((id) => model.constraints.has(id));
  const reattached = [...model.constraints.keys()].filter((id) => has(sketch.constraints, id) && (model.moved.has(id) || constraintOperands(sketch.constraints[id]).some((operand) => changes.rekinded.includes(operand)))).sort();
  const removedConstraints = Object.keys(sketch.constraints).filter((id) => !model.constraints.has(id)).sort();
  const readers = readersOf(afterDoc, sketch.id, changes, sketch);
  const order = (ids: Id[]): Id[] => doc.features.map((f) => f.id).filter((id) => ids.includes(id));
  const featureIds = new Set(doc.features.map((f) => f.id));
  const moved = order(readers.moved);
  return {
    changed: changes.changed,
    added: changes.added,
    span: changes.span,
    points,
    constraints,
    reattached,
    removed: [...changes.removed, ...changes.removedPoints, ...removedConstraints],
    uncut: [...plan.uncut].sort(),
    patched: order(patches.patched),
    dropped: order(patches.dropped),
    pending: order(patches.pending),
    reshaped: order(patches.reshaped),
    moved,
    shortened: order([...patches.shortened, ...readers.shortened].filter((id) => !moved.includes(id))),
    broken: [...order([...patches.broken, ...readers.broken.filter((id) => featureIds.has(id))]), ...readers.broken.filter((id) => !featureIds.has(id))],
  };
}

// ---------------------------------------------------------------- the entry

// Runs trim, extend or split: the batch with its patches and the lists, or the reason it cannot.
export function cutTool(context: SketchToolCall, request: CutRequest, newId: NewId): SketchToolResult {
  const world = worldOfContext(context);
  if (typeof world === 'string') return failed(world);
  if (world.result.conflicting.length > 0) return failed(`the sketch "${world.sketch.id}" is in conflict (${world.result.conflicting.join(', ')}): its positions are the last that held, not a solution; resolve the conflict first`);
  let spec: CutSpec | string;
  switch (request.tool) {
    case 'trim': {
      const X = trimCurve(world, request);
      if (!has(world.sketch.curves, X) && !world.curves.has(X)) return failed(X);
      const problem = curveProblem(world, X, request.with);
      if (problem) return failed(problem);
      spec = trimSpec(world, request, X);
      break;
    }
    case 'extend': {
      const problem = curveProblem(world, request.curve, request.with);
      if (problem) return failed(problem);
      spec = extendSpec(world, request);
      break;
    }
    case 'split': {
      if (request.curve !== undefined) {
        const problem = curveProblem(world, request.curve, request.with);
        if (problem) return failed(problem);
      } else if (request.with !== undefined || request.at !== undefined) return failed('`with` and `at` need `curve`');
      spec = splitSpec(world, request);
      break;
    }
    default:
      return unreachable(request, 'tool');
  }
  if (typeof spec === 'string') return failed(spec);
  const plan = makePlan(world, spec, newId);
  if (typeof plan === 'string') return failed(plan);
  if (plan.commands.length === 0 && request.tool === 'split') {
    if (request.curve !== undefined) return failed(plan.uncut.has(request.curve) ? `"${request.curve}" is touched at one place only, or only where it cannot be cut; one point does not split a circle` : `nothing can be cut on "${request.curve}"`);
    if (!world.result.valid) {
      const reason = invalidReason(world);
      if (reason) return failed(reason);
    }
  }
  const changes = changesOf(world, plan, spec);
  // the entries of mirrors and patterns that list a changed curve, patched after the new pieces and
  // the removals and before the patches of the features (D68)
  let afterDoc: Document;
  let entries: { commands: Command[]; patched: Id[]; orphaned: Id[]; joined: JoinedCurve[] };
  try {
    const sketchOnly = applyCommand(context.document, { type: 'batch', commands: plan.commands });
    const afterSketch = sketchOnly.features.find((f) => f.id === world.sketch.id) as SketchFeature;
    const newPoints: Record<Id, Point2> = {};
    for (const [id, at] of plan.model.newPoints) newPoints[id] = { x: at[0], y: at[1] };
    const found = entryPatches(world.sketch, toolBase(afterSketch, world.result, { points: newPoints }), changes, request.tool, namedOutside(context.document, world.sketch.id));
    const commands = entryCommands(world.sketch, found.patches);
    afterDoc = commands.length ? applyCommand(sketchOnly, { type: 'batch', commands }) : sketchOnly;
    entries = { commands, patched: found.patches.map((patch) => patch.entry), orphaned: found.orphaned, joined: found.joined };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
  const patches = patchFeatures(world, plan, spec, changes, afterDoc, request.tool, entries.joined);
  // an extend that would spoil a valid profile is refused (answer 10), whatever it is that the
  // batch cannot cut: the checks of extendSpec name the known cases, this one the rest (a circle
  // the stretch crosses once with `with`)
  if (request.tool === 'extend' && world.result.valid && !patches.validAfter && formsRegions(world, request.curve) && repairOf(world, request.repair)) {
    const left = [...plan.uncut].sort();
    const circle = left.some((id) => curveOf(world, id)?.shape.type === 'circle');
    return failed(`extending "${request.curve}" would leave the profile of the sketch invalid${left.length > 0 ? `: it would meet ${left.map((id) => `"${id}"`).join(', ')} where no cut can be made (a circle that would get one point only, or a curve that is not cut)` : ''}; ${request.with !== undefined ? 'extend it without `with`, or ' : ''}${circle ? 'draw across the circle and trim' : 'trim the curves there first, or extend it to another curve'}`);
  }
  const entryIds = entryOrder(world.sketch).filter((id) => entries.patched.includes(id) || entries.orphaned.includes(id));
  return { ok: true, commands: [...plan.commands, ...entries.commands, ...patches.commands], ids: { ...lists(world, plan, changes, patches, afterDoc), entries: entryIds } };
}

// ---------------------------------------------------------------- the contacts of a sketch

// One place where two curves that form regions meet apart from a common point (the query
// `sketchContacts`), with what split without a curve does there.
export interface SketchContact {
  at: Vec2;
  kind: ContactKind | 'ends';
  curves: [Id, Id];
  fix: 'cut' | 'join' | 'none';
  why?: string;
}
export interface SketchContacts {
  contacts: SketchContact[];
  lying: [Id, Id][];
  degenerate: Id[];
  tight?: TightPlace;
  reason?: string;
}
// The places alone, from the solved sketch: kept by it.
interface ContactPlaces {
  places: { at: Vec2; kind: ContactKind | 'ends'; curves: [Id, Id] }[];
  lying: [Id, Id][];
  degenerate: Id[];
  tight?: TightPlace;
}
export function contactPlaces(world: Pick<SketchWorld, 'curves' | 'geometry' | 'joins'>, valid: boolean, chord: number): ContactPlaces {
  const curves = [...world.curves.values()].filter((c) => c.regions).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const places: ContactPlaces['places'] = [];
  const lying: [Id, Id][] = [];
  const degenerate = curves.filter((c) => !carrierIn(c, world.geometry)).map((c) => c.id);
  const alive = curves.filter((c) => !degenerate.includes(c.id));
  const apart = boxesApart(new Map(alive.map((c) => [c.id, c])), world.geometry);
  for (let i = 0; i < alive.length; i++) {
    const carrier = carrierIn(alive[i], world.geometry) as Carrier;
    for (let j = i + 1; j < alive.length; j++) {
      const [a, b] = [alive[i], alive[j]];
      if (apart(a.id, b.id)) continue;
      const found = curveContacts(a, b, world.joins, world.geometry);
      if (!found) continue;
      if (found.lying) lying.push([a.id, b.id]);
      const sorted = [...found.points].sort((p, q) => paramOf(carrier, p.at) - paramOf(carrier, q.at));
      for (const contact of sorted) places.push({ at: contact.at, kind: contact.kind, curves: [a.id, b.id] });
      const [ea, eb] = [endsOf(a.shape), endsOf(b.shape)];
      for (const [x] of found.ends) {
        const at = has(world.geometry.points, ea[x]) ? xy(world.geometry.points[ea[x]]) : undefined;
        if (at) places.push({ at, kind: 'ends', curves: [a.id, b.id] });
      }
      void eb;
    }
  }
  const tight = !valid && places.length === 0 && lying.length === 0 && degenerate.length === 0 ? profileProblem(curves, world.joins, world.geometry, chord) : undefined;
  return { places, lying, degenerate, ...(tight ? { tight } : {}) };
}
// What split without a curve would do at each place, and why a profile is invalid when no cut
// repairs it (the text split without a curve refuses with).
export function sketchContactsOf(places: ContactPlaces, curves: ReadonlyMap<Id, SketchCurve>, document: Document, sketch: SketchFeature, valid: boolean): SketchContacts {
  const predicates = curvePredicates(document, sketch);
  // a place `contactFix` does not list (the image of a contact of two sources, D68) is left out
  const contacts: SketchContact[] = places.places.flatMap((place) => {
    const fix = contactFix(curves.get(place.curves[0]) as SketchCurve, curves.get(place.curves[1]) as SketchCurve, place.kind, predicates, sketch);
    return fix ? [{ at: place.at, kind: place.kind, curves: place.curves, ...fix }] : [];
  });
  // a circle that would get one point only is not cut
  const circles = new Map<Id, Vec2[]>();
  for (const contact of contacts) {
    if (contact.fix !== 'cut') continue;
    for (const id of contact.curves) {
      if (curves.get(id)?.shape.type !== 'circle') continue;
      const list = circles.get(id) ?? [];
      if (!list.some((p) => dist2(p, contact.at) <= tol)) list.push(contact.at);
      circles.set(id, list);
    }
  }
  for (const contact of contacts) {
    const lonely = contact.fix === 'cut' && contact.curves.find((id) => (circles.get(id)?.length ?? 2) < 2);
    if (lonely) Object.assign(contact, { fix: 'none', why: `the circle "${lonely}" is touched at one point only, and one point does not split a circle` });
  }
  let reason: string | undefined;
  if (!valid) {
    if (places.degenerate.length > 0) reason = `the curve "${places.degenerate[0]}" has no length`;
    else if (places.lying.length > 0) reason = `"${places.lying[0][0]}" and "${places.lying[0][1]}" lie on each other; trim or remove one of them`;
    else {
      const stuck = contacts.find((contact) => contact.fix === 'none');
      if (stuck) reason = `${stuck.why} ("${stuck.curves[0]}" and "${stuck.curves[1]}" meet at ${fmt(stuck.at)}, where no cut can be made)`;
      else if (places.tight) reason = `the curves ${places.tight.curves.map((id) => `"${id}"`).join(' and ')} enclose a region thinner than the chord tolerance, or their polygons cross, at ${fmt(places.tight.at)}: trim one of them, or move the curves apart`;
      else if (contacts.length === 0) reason = 'the curves come too close to each other for the chord tolerance; move them apart or lower the chord tolerance';
    }
  }
  return { contacts, lying: places.lying, degenerate: places.degenerate, ...(places.tight ? { tight: places.tight } : {}), ...(reason ? { reason } : {}) };
}

// Why the profile of the sketch is invalid although no contact can be cut, if it is: what split
// without a curve refuses with.
function invalidReason(world: World): string | undefined {
  const places = contactPlaces(world, world.result.valid, world.doc.settings.chordTolerance);
  const found = sketchContactsOf(places, world.curves, world.doc, world.sketch, world.result.valid);
  return found.reason ?? (found.contacts.length > 0 ? `nothing can be cut: ${found.contacts.map((c) => c.why).filter((why) => why !== undefined)[0] ?? 'the contacts are not cut'}` : undefined);
}

// ---------------------------------------------------------------- what the app draws

// The curve a place means: the own curve nearest to it, one that forms regions before
// a construction curve at the same distance (a span line lies exactly over the pieces of its
// line), then the first by ID. It is how trim without `curve` chooses among the own curves. The app
// passes the curve its picker found (`picked`), which the answer is when the sketch has no own
// curve with a position. Undefined when the sketch has no own curve.
export function curveUnder(context: SketchToolCall, at: Vec2, picked?: Id): Id | undefined {
  const world = worldOfContext(context);
  const own = picked !== undefined && has(context.sketch.curves, picked) ? picked : undefined;
  if (typeof world === 'string') return own;
  if (own === undefined) return nearestOwn(world, at)?.id;
  // the picker's curve, which the tool found eligible, unless it forms no regions and an own curve
  // on the same line or circle that does is as near (a span line over a piece): a tie only
  if (formsRegions(world, own)) return own;
  const carrier = carrierOf(world, own);
  if (!carrier) return own;
  const distance = distanceTo(carrier, at);
  for (const id of Object.keys(world.sketch.curves).sort()) {
    if (id === own || !formsRegions(world, id)) continue;
    const other = carrierOf(world, id);
    if (other && sameCarrier(carrier, other) && Math.abs(distanceTo(other, at) - distance) <= tol) return id;
  }
  return own;
}

// The piece `trim` would remove, from the cuts that select it only (not the repair of the sketch);
// undefined where the tool would refuse.
export function trimPiece(context: SketchToolCall, input: TrimInput): PieceShape | undefined {
  const world = worldOfContext(context);
  if (typeof world === 'string' || world.result.conflicting.length > 0) return undefined;
  const X = trimCurve(world, input);
  if (!has(world.sketch.curves, X) || curveProblem(world, X, input.with)) return undefined;
  const carrier = carrierOf(world, X) as Carrier;
  const bothCut = repairOf(world, input.repair) && cuttable(world, X);
  const { cuts, touches } = cutsOf(world, X, cuttersOf(world, X, input.with), carrier, bothCut);
  const piece = pieceAround(carrier, cuts, nearestParam(carrier, input.at));
  if (touches.some((touch) => paramInPiece(carrier, piece, touch.t))) return undefined;
  return pieceShape(carrier, piece.from, piece.to);
}

// The end of a line or an arc nearest to a place: what the app offers for extend under the pointer.
export function extendEnd(context: SketchToolContext, curve: Id, at: Vec2): ExtendInput['end'] | undefined {
  if (!has(context.sketch.curves, curve)) return undefined;
  const c = context.sketch.curves[curve];
  const points = context.result?.points ?? context.sketch.points;
  let best: ExtendInput['end'] | undefined;
  let distance = Infinity;
  for (const name of endNames(c)) {
    const id = (c as unknown as Record<string, Id>)[name];
    const p = has(points, id) ? points[id] : undefined;
    if (p && Math.hypot(p.x - at[0], p.y - at[1]) < distance) [best, distance] = [name, Math.hypot(p.x - at[0], p.y - at[1])];
  }
  return best;
}

// Where `extend` would move the end; undefined where it would refuse.
export function extendReach(context: SketchToolCall, input: ExtendInput): Vec2 | undefined {
  const world = worldOfContext(context);
  if (typeof world === 'string' || world.result.conflicting.length > 0 || curveProblem(world, input.curve, input.with)) return undefined;
  // the extension alone, without the repair of the sketch: cheap enough for every move of the pointer
  const spec = extendSpec(world, input, false);
  return typeof spec === 'string' ? undefined : spec.extend?.at;
}
