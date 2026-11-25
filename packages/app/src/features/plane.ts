// The plane in the app: a form with its base, picked in the view, the second plane of a midplane
// and the tilt about an axis (D60), and its offset.
import type { FaceName, Input, PlaneFeature, PlaneRef, Vec3 } from '@trymesh/engine';
import { type FacePick, axisLabel, axisRows, roundFaceOf } from '../axis-picker';
import { h } from '../dom';
import { COLOR, loopSegments, planeSquare } from '../draw';
import type { PanelHost } from '../host';
import { faceLabel } from '../issue-text';
import { shownDegrees, shownValue } from '../labels';
import { type AxisChange, changeAxis, draftCommand, lineIds } from '../sketch-commands';
import { type DraftMode, type FeatureForm, type FeatureUi, draftButtons, draftChanged, draftField, editDraft, startDraft } from './draft';

// What the form remembers beyond the draft: which pick the next click in the view makes. Without
// one a click picks the base; `midplaneWith` the second plane; `axis` a round face for the axis of
// the tilt.
interface Extra {
  picking?: 'midplaneWith' | 'axis';
}
type PlaneMode = DraftMode<PlaneFeature, Extra>;
type TiltDraft = NonNullable<Input<PlaneFeature>['tilt']>;
// A new tilt: by 30° about the first base axis that lies in the plane the preview has (the plane
// before a tilt), so that it does not start in error; about X when none does.
function newTilt(normal: Vec3 | undefined): TiltDraft {
  const axis = (['X', 'Y', 'Z'] as const).find((_, i) => normal !== undefined && Math.abs(normal[i]) < 1e-9) ?? 'X';
  return { axis: { kind: 'base', axis }, angle: Math.PI / 6 };
}

// A plane reference as the forms show it: a base plane, a plane feature, or a face of a body.
export const planeText = (host: PanelHost, ref: PlaneRef | Input<PlaneRef>): string =>
  ref.kind === 'base' ? `plane ${ref.plane}` : ref.kind === 'plane' ? `plane "${host.nameOf(ref.feature)}"` : `face ${faceLabel(ref.face as FaceName, host.featureNames)} (${host.bodyName(ref.body)})`;

// The sketches the axis of a tilt may go through: those before the plane.
const sketchesBefore = (host: PanelHost, index: number) => host.doc.features.slice(0, index).filter((f) => f.type === 'sketch').map((f) => f.id);

function planePanel(m: PlaneMode, host: PanelHost): HTMLElement[] {
  const label = planeText(host, m.draft.base);
  const arm = (which: Extra['picking']) => {
    m.extra.picking = m.extra.picking === which ? undefined : which;
    if (m.extra.picking === 'midplaneWith') host.say('Click a plane or a planar face in the view: the second plane of the midplane.');
    if (m.extra.picking === 'axis') host.say('Click a cylinder, a cone or a torus in the view: its axis.');
    draftChanged(host, true);
  };
  const button = (text: string, onclick: () => void) => h('button', { textContent: text, onclick });
  const { midplaneWith, tilt } = m.draft;
  const out: (HTMLElement | null)[] = [
    h('h2', {}, m.editing ? `Edit: ${m.draft.name}` : 'New plane'),
    h('p', {}, `Base: ${label}`),
    h('p', { className: 'hint' }, m.extra.picking ? 'A click in the view picks what the armed button asks for.' : 'Click a plane or a planar face in the view to choose another base.'),
    // the midplane of the base and a second plane
    midplaneWith ? h('p', {}, `Midplane with: ${planeText(host, midplaneWith)}`) : null,
    h(
      'div',
      { className: 'buttons' },
      button(m.extra.picking === 'midplaneWith' ? 'Picking… (click to stop)' : midplaneWith ? 'Pick another second plane' : 'Midplane with… (pick)', () => arm('midplaneWith')),
      midplaneWith
        ? button('Remove the midplane', () => {
            const { midplaneWith: _gone, ...rest } = m.draft;
            m.draft = rest;
            if (m.extra.picking === 'midplaneWith') m.extra.picking = undefined;
            draftChanged(host);
          })
        : null,
    ),
    midplaneWith ? h('p', { className: 'hint' }, 'The plane halfway between the base and the second plane; for planes at an angle the bisector nearer to the base (turned by at most 45° from it).') : null,
  ];
  // the tilt about an axis
  if (tilt) {
    const sketches = sketchesBefore(host, m.index);
    const lines = (id: string) => {
      const f = host.feature(id);
      return f?.type === 'sketch' ? lineIds(f) : [];
    };
    const setAxis = (change: AxisChange) => {
      if (!m.draft.tilt) return;
      m.draft = { ...m.draft, tilt: { ...m.draft.tilt, axis: changeAxis(m.draft.tilt.axis, change, sketches, lines) } };
      if (m.extra.picking === 'axis') m.extra.picking = undefined;
      draftChanged(host);
    };
    const facePick: FacePick = { armed: m.extra.picking === 'axis', arm: () => arm('axis') };
    out.push(
      h('h3', {}, 'Tilt'),
      ...axisRows(host, tilt.axis, sketches, setAxis, 'An axis through a point or along a line needs a sketch before this place of the timeline.', undefined, facePick),
      draftField(host, m, 'Tilt angle (° or an expression in radians)', 'tilt/angle', (angle) => {
        if (m.draft.tilt) m.draft = { ...m.draft, tilt: { ...m.draft.tilt, angle } };
        draftChanged(host, false);
      }),
      h('p', { className: 'hint' }, 'The plane through the axis, turned by the angle (the right-hand rule about the axis) from the plane it tilts: the base, or the midplane. The axis has to be parallel to that plane.'),
      h(
        'div',
        { className: 'buttons' },
        button('Remove the tilt', () => {
          const { tilt: _gone, ...rest } = m.draft;
          m.draft = rest;
          if (m.extra.picking === 'axis') m.extra.picking = undefined;
          draftChanged(host);
        }),
      ),
    );
  } else {
    out.push(
      h(
        'div',
        { className: 'buttons' },
        button('Add a tilt', () => {
          m.draft = { ...m.draft, tilt: newTilt(host.view().evaluation.features[m.draft.id]?.plane?.normal) };
          draftChanged(host);
        }),
      ),
    );
  }
  out.push(
    draftField(host, m, 'Offset along the normal (mm or an expression)', 'offset', (offset) => {
      m.draft = { ...m.draft, offset };
      draftChanged(host, false);
    }),
    ...draftButtons(host, m),
  );
  return out.filter((element): element is HTMLElement => element !== null);
}

const form: FeatureForm<PlaneFeature, Extra> = {
  draft(host, at) {
    if (!at.plane) return { problem: 'Select a plane or a planar face.' };
    const id = host.newId('r');
    return { draft: { id, name: `Plane ${id.slice(1)}`, suppressed: false, type: 'plane', base: at.plane, offset: 10 }, extra: {}, say: 'Enter the offset; a click in the view changes the base.' };
  },
  command: draftCommand,
  panel: planePanel,
  picks: (m) => (m.extra.picking === 'axis' ? { faces: true } : { faces: true, planes: true }),
  // A click on a plane or a planar face makes it the base, or the second plane while that pick is
  // armed; a round face is the axis of the tilt while that pick is armed. The plane itself is not
  // in the state before it, so a face or a plane it would make cannot be picked.
  click(m, _event, pick, host) {
    if (m.extra.picking === 'axis') {
      const face = roundFaceOf(host, pick);
      if (!face || !m.draft.tilt) return host.say('The axis of a face is the axis of a cylinder, a cone or a torus; click one of them.', true);
      m.draft = { ...m.draft, tilt: { ...m.draft.tilt, axis: changeAxis(m.draft.tilt.axis, { face }, []) } };
      m.extra.picking = undefined;
      if (m.draft.tilt) host.say(`Axis of the tilt: ${axisLabel(host, m.draft.tilt.axis)}.`);
      draftChanged(host);
      return;
    }
    const ref = host.planeRefOf(pick);
    if (!ref) return host.say(m.extra.picking === 'midplaneWith' ? 'The second plane of a midplane is a plane or a planar face.' : 'The base of a plane can be a plane or a planar face.', true);
    if (m.extra.picking === 'midplaneWith') {
      m.draft = { ...m.draft, midplaneWith: ref };
      m.extra.picking = undefined;
      host.say(`Midplane with ${planeText(host, ref)}.`);
    } else m.draft = { ...m.draft, base: ref };
    draftChanged(host);
  },
  overlay(m, scene, host) {
    const state = host.view();
    const result = state.evaluation.features[m.draft.id];
    const frame = result?.plane;
    if (!frame) return;
    const size = host.planeSize(state);
    const square = planeSquare(size);
    scene.fills.push({ frame, loops: [square], color: COLOR.select, opacity: 0.3 });
    scene.lines.push({ segments: loopSegments(frame, square), color: COLOR.select, width: 2 });
    // the axis of a tilt: a line through the square, centred where it passes nearest to the origin of the plane
    const point = result.facts?.axisPoint as Vec3 | undefined;
    const direction = result.facts?.axisDirection as Vec3 | undefined;
    if (!point || !direction) return;
    const t = (frame.origin[0] - point[0]) * direction[0] + (frame.origin[1] - point[1]) * direction[1] + (frame.origin[2] - point[2]) * direction[2];
    const end = (s: number): number[] => point.map((value, k) => value + direction[k] * (t + s));
    scene.lines.push({ segments: [...end(-size / 2), ...end(size / 2)], color: COLOR.region, width: 2, onTop: true });
  },
};

export const plane: FeatureUi<PlaneFeature, Extra> = {
  button: { label: 'Plane', title: 'A plane offset from a plane or a planar face' },
  // the plane picked first is the base of the draft
  create: { plane: { header: 'New plane' }, run: (host, at) => startDraft(host, form, at) },
  edit: (host, feature) => editDraft(host, form, feature, {}),
  summary: (host, f) => [
    h(
      'p',
      { className: 'hint' },
      `Offset ${shownValue(f, 'offset', f.offset)} mm.${f.midplaneWith ? ` Midplane with ${planeText(host, f.midplaneWith)}.` : ''}${f.tilt ? ` Tilted by ${shownDegrees(f, 'tilt/angle', f.tilt.angle)} about ${axisLabel(host, f.tilt.axis)}.` : ''}`,
    ),
  ],
  hideable: () => true,
  form,
};
