// The picking of a profile in the view, for the forms of the features that take one: regions of
// a sketch picked by a click inside them, with their offset, or the curves of a wall picked by
// a click near them, with its thickness. What the form of the extrusion had for it, moved here so
// that another form can use it.
import type { Frame, Id, RegionRef, SketchResult } from '@trymesh/engine';
import { h } from '../dom';
import { COLOR, pushPolyline } from '../draw';
import { PICK_REACH, type PanelHost } from '../host';
import type { ExtrudeChange, ExtrudeDraft } from '../sketch-commands';
import { type SketchView, hitCurve, insideLoop, polyline, sketchView } from '../sketch-view';
import type { SceneModel } from '../viewport';
import { type AnyDraft, draftField } from './draft';

// What a form remembers of the pointer: the region under it, and for a wall the curve.
export interface ProfileHover {
  hover?: RegionRef;
  hoverCurve?: Id;
}
// The profile of a draft (of any feature that takes one) and the change of it the fields make.
export type DraftProfile = ExtrudeDraft['profile'];
export type ProfileChange = Pick<ExtrudeChange, 'regions' | 'offset' | 'curves' | 'thickness'>;

export const sameRegion = (a: RegionRef, b: RegionRef): boolean => a.outerLoop.length === b.outerLoop.length && a.outerLoop.every((id, i) => id === b.outerLoop[i]);

export function sketchRegions(host: PanelHost, id: Id): { result: SketchResult; frame: Frame } | undefined {
  if (!host.feature(id)) return undefined; // the extrusion's sketch may have been deleted
  const result = host.engine.getState(id).evaluation.features[id];
  return result?.sketch && result.plane ? { result: result.sketch, frame: result.plane } : undefined;
}

export function regionAt(host: PanelHost, event: PointerEvent, sketch: Id): RegionRef | undefined {
  const info = sketchRegions(host, sketch);
  const p = info && host.planePoint(event, info.frame)?.at;
  if (!info || !p) return undefined;
  return info.result.regions.find((region) => insideLoop(region.loops[0], p) && !region.loops.slice(1).some((hole) => insideLoop(hole, p)))?.ref;
}

// The curves a wall may follow: the own curves of its sketch, as the sketch mode sees them.
export function wallCurves(host: PanelHost, sketch: Id): { view: SketchView; frame: Frame } | undefined {
  const feature = host.feature(sketch);
  const info = sketchRegions(host, sketch);
  return feature?.type === 'sketch' && info ? { view: sketchView(feature, info.result), frame: info.frame } : undefined;
}
// The own curve of the sketch nearest to the point where the pointer meets the sketch plane.
export function curveAt(host: PanelHost, event: PointerEvent, sketch: Id): Id | undefined {
  const info = wallCurves(host, sketch);
  const p = info && host.planePoint(event, info.frame)?.at;
  if (!info || !p) return undefined;
  return hitCurve(info.view, p, PICK_REACH * host.pixelSize(), (id) => !info.view.curves.get(id)?.own)?.id;
}

// The part of a form for a profile of sketch regions. The offset is an optional field: it is empty
// while the draft has none, and emptying it removes it.
export function regionsFields(host: PanelHost, m: AnyDraft, profile: Extract<DraftProfile, { type: 'regions' }>, set: (change: ProfileChange, rebuild?: boolean) => void): (HTMLElement | null)[] {
  const available = sketchRegions(host, profile.sketch)?.result.regions ?? [];
  const stale = profile.regions.filter((region) => !available.some((other) => sameRegion(other.ref, region))).length;
  return [
    h('p', { className: 'hint' }, `Picked regions: ${profile.regions.length}. Regions are picked by a click in the view.`),
    stale > 0 ? h('p', { className: 'issue warning' }, `${stale} of the picked regions are no longer in the sketch. Clear the selection and pick the regions again.`) : null,
    h('div', { className: 'buttons' }, h('button', { textContent: 'Clear picked regions', disabled: profile.regions.length === 0, onclick: () => set({ regions: [] }) })),
    draftField(host, m, 'Offset (mm or an expression; positive grows the profile; empty = none)', 'profile/offset', (offset) => set({ offset: typeof offset === 'number' && Number.isNaN(offset) ? null : offset }, false)),
  ];
}

// The part of a form for a wall along curves of the sketch.
export function wallFields(host: PanelHost, m: AnyDraft, profile: Extract<DraftProfile, { type: 'wall' }>, set: (change: ProfileChange, rebuild?: boolean) => void): (HTMLElement | null)[] {
  const own = wallCurves(host, profile.sketch)?.view.curves;
  const stale = profile.curves.filter((id) => !own?.get(id)?.own);
  return [
    h('p', { className: 'hint' }, `Curves of the wall: ${profile.curves.length}. Click curves of the sketch in the view (construction curves too); they have to form one chain.`),
    stale.length > 0 ? h('p', { className: 'issue warning' }, `${stale.length} of the chosen curves ${stale.length === 1 ? 'is' : 'are'} not in the sketch any more (${stale.join(', ')}). Clear the curves and choose them again.`) : null,
    h('div', { className: 'buttons' }, h('button', { textContent: 'Clear the curves', disabled: profile.curves.length === 0, onclick: () => set({ curves: [] }) })),
    draftField(host, m, 'Thickness (mm or an expression; half of it to each side of the curves)', 'profile/thickness', (thickness) => set({ thickness }, false)),
  ];
}

// The region or the curve under the pointer, remembered in `hover`; true when it changed (the
// scene is drawn again).
export function hoverProfile(host: PanelHost, event: PointerEvent, profile: DraftProfile, hover: ProfileHover): boolean {
  const region = profile.type === 'regions' ? regionAt(host, event, profile.sketch) : undefined;
  const curve = profile.type === 'wall' ? curveAt(host, event, profile.sketch) : undefined;
  if (((region && hover.hover && sameRegion(region, hover.hover)) || region === hover.hover) && curve === hover.hoverCurve) return false;
  hover.hover = region;
  hover.hoverCurve = curve;
  return true;
}

// The profile after a click in the view: the region under the pointer picked or dropped, for
// a wall the curve; undefined when the click hit nothing that counts.
export function clickProfile<P extends DraftProfile>(host: PanelHost, event: PointerEvent, profile: P): P | undefined {
  if (profile.type === 'wall') {
    // a click toggles the curve; the list is kept sorted, as the engine stores it
    const curve = curveAt(host, event, profile.sketch);
    if (curve === undefined) return undefined;
    const curves = profile.curves.includes(curve) ? profile.curves.filter((id) => id !== curve) : [...profile.curves, curve].sort();
    return { ...profile, curves };
  }
  const region = profile.type === 'regions' ? regionAt(host, event, profile.sketch) : undefined; // a generated profile has no regions to pick
  if (!region || profile.type !== 'regions') return undefined;
  const at = profile.regions.findIndex((r) => sameRegion(r, region));
  return { ...profile, regions: at < 0 ? [...profile.regions, region] : profile.regions.filter((_, i) => i !== at) };
}

// What the profile of a draft draws: the regions of its sketch (the picked ones and the one under
// the pointer marked), or the curves a wall can follow, the chosen ones and the one under the
// pointer.
export function profileOverlay(host: PanelHost, profile: DraftProfile, hover: ProfileHover, scene: SceneModel): void {
  const info = sketchRegions(host, profile.sketch);
  const picked = profile.type === 'regions' ? profile.regions : undefined; // a generated profile shows no regions
  for (const region of picked ? (info?.result.regions ?? []) : []) {
    const chosen = picked!.some((r) => sameRegion(r, region.ref));
    const hovered = hover.hover !== undefined && sameRegion(hover.hover, region.ref);
    scene.fills.push({ frame: info!.frame, loops: region.loops, color: chosen ? COLOR.region : hovered ? COLOR.hover : COLOR.rubber, opacity: chosen ? (hovered ? 0.6 : 0.45) : hovered ? 0.35 : 0.15, onTop: true });
  }
  const wall = profile.type === 'wall' ? profile : undefined;
  const curves = wall && wallCurves(host, wall.sketch);
  if (!wall || !curves) return;
  const [offered, chosen, hovered]: number[][] = [[], [], []];
  for (const curve of curves.view.curves.values()) {
    if (!curve.own) continue;
    pushPolyline(curve.id === hover.hoverCurve ? hovered : wall.curves.includes(curve.id) ? chosen : offered, curves.frame, polyline(curve.shape));
  }
  scene.lines.push({ segments: offered, color: COLOR.rubber, width: 2, onTop: true }, { segments: chosen, color: COLOR.region, width: 4, onTop: true }, { segments: hovered, color: COLOR.hover, width: 4, onTop: true });
}
