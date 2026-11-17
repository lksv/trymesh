// D66 (package 2h of D36) without adapters: the start of an extent at a plane (`from`) in the
// document (its validation on every variant, its references, the patches of the extrusion and of
// the hole, the upgrade step) and the level of the start plane over the exact outline
// (`planeLevel`, `exactStart`, `resolveStart`, "through all" from a start).
import { describe, expect, it } from 'vitest';
import type { Command, Document, ExtrudeFeature, FeaturePatch, Frame, HoleFeature, Input, PlaneRef, Solid } from '../src/types';
import { applyCommand, emptyDocument, emptySketch, featureRefs, validateDocument } from '../src/document';
import { type ExactCurve, exactStart, planeLevel, resolveStart, throughAll, toolSpan } from '../src/recompute/extent';
import { SCHEMA_PENDING, UPGRADES, upgradeDocument } from '../src/schema';
import type { Loop, Region } from '../src/sketch';

const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const run = (doc: Document, ...commands: Command[]): Document => commands.reduce(applyCommand, doc);
const TOP: PlaneRef = { kind: 'face', body: 'A', face: { feature: 'A', role: 'endCap' } };
const DECK: PlaneRef = { kind: 'plane', feature: 'P' };
const extrude = (id: string, extra: Partial<Input<ExtrudeFeature>> = {}): Input<ExtrudeFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'extrude',
  profile: { type: 'regions', sketch: 'S1', regions: [{ outerLoop: ['c'] }] },
  extent: { type: 'distance', start: 0, distance: 10 },
  operation: 'new',
  ...extra,
});
const hole = (id: string, extra: Partial<Input<HoleFeature>> = {}): Input<HoleFeature> => ({
  id,
  name: id,
  suppressed: false,
  type: 'hole',
  sketch: 'S1',
  points: ['p'],
  shape: { type: 'plain', diameter: 3 },
  extent: { type: 'throughAll', side: 'backward' },
  targets: ['A'],
  ...extra,
});
const add = (feature: Input<ExtrudeFeature> | Input<HoleFeature>, index?: number): Command => ({ type: 'addFeature', feature, ...(index === undefined ? {} : { index }) });
const update = (id: string, patch: FeaturePatch): Command => ({ type: 'updateFeature', id, patch });
const invalid = (doc: Document, command: Command, pattern: RegExp) => expect(() => applyCommand(doc, command)).toThrow(pattern);
const extentOf = (doc: Document, id: string) => (doc.features.find((f) => f.id === id) as ExtrudeFeature | HoleFeature).extent;

// A sketch S1 with a circle `c` and a point `p`, the parameter `s`, the body A and a plane feature P.
function base(): Document {
  return run(
    emptyDocument(),
    { type: 'setParameter', name: 's', expr: '0.6' },
    { type: 'addFeature', feature: emptySketch('S1', 'S1', XY) },
    { type: 'addCurve', sketch: 'S1', id: 'c', curve: { type: 'circle', center: 'origin' }, radius: 5 },
    { type: 'addPoint', sketch: 'S1', id: 'p', x: 1, y: 0 },
    add(extrude('A')),
    { type: 'addFeature', feature: { id: 'P', name: 'P', suppressed: false, type: 'plane', base: XY, offset: 30 } },
  );
}

describe('the start of an extent at a plane in the document', () => {
  it('every variant of the extrusion takes `from`; it is a plane reference listed under extent/from', () => {
    const doc = run(
      base(),
      add(extrude('D', { extent: { type: 'distance', from: TOP, start: '-s', distance: -3 }, operation: 'cut', targets: ['A'] })),
      add(extrude('T', { extent: { type: 'distance', from: DECK, start: 0, distance: 2, taper: 0.1 } })),
      add(extrude('U', { extent: { type: 'upTo', from: TOP, plane: DECK, start: 0, gap: 1 }, operation: 'add', targets: ['A'] })),
      add(extrude('C', { extent: { type: 'throughAll', side: 'backward', from: XY }, operation: 'cut', targets: ['A'] })),
    );
    expect(extentOf(doc, 'D')).toEqual({ type: 'distance', from: TOP, start: -0.6, distance: -3 });
    expect(extentOf(doc, 'T')).toEqual({ type: 'distance', from: DECK, start: 0, distance: 2, taper: 0.1 });
    expect(extentOf(doc, 'U')).toEqual({ type: 'upTo', from: TOP, plane: DECK, start: 0, gap: 1 });
    expect(extentOf(doc, 'C')).toEqual({ type: 'throughAll', side: 'backward', from: XY });
    expect(featureRefs(doc.features.find((f) => f.id === 'U') as ExtrudeFeature)).toEqual(['S1', 'A', 'P']);
    expect(featureRefs(doc.features.find((f) => f.id === 'T') as ExtrudeFeature)).toEqual(['S1', 'P']);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    // not an ID, not a reference to something after the feature
    invalid(base(), add(extrude('X', { extent: { type: 'distance', from: 'A', start: 0, distance: 1 } as never })), /extent\.from/);
    invalid(base(), add(extrude('X', { extent: { type: 'distance', from: { kind: 'face', body: 'A', face: { feature: 'later', role: 'endCap' } }, start: 0, distance: 1 } })), /extent\.from/);
    invalid(base(), add(extrude('X', { extent: { type: 'distance', from: DECK, start: 0, distance: 1 } }), 2), /extent\.from/);
  });

  it('"through all" from a plane goes forward or backward: both is an invalid command', () => {
    invalid(base(), add(extrude('X', { extent: { type: 'throughAll', side: 'both', from: TOP }, operation: 'cut', targets: ['A'] })), /extent\.side: through all from a plane goes forward or backward/);
    // a hole has a mouth anyway: its own message
    invalid(base(), add(hole('H', { extent: { type: 'throughAll', side: 'both', from: TOP } as never })), /extent\.side: a hole has a mouth/);
    const doc = run(base(), add(extrude('X', { extent: { type: 'throughAll', side: 'both' }, operation: 'cut', targets: ['A'] })));
    invalid(doc, update('X', { extent: { from: TOP } }), /extent\.side: through all from a plane/);
  });

  it('moveFeature keeps the feature after its start plane', () => {
    const doc = run(base(), add(extrude('X', { extent: { type: 'distance', from: DECK, start: 0, distance: 1 } })));
    invalid(doc, { type: 'moveFeature', id: 'X', index: 2 }, /P/);
    invalid(doc, { type: 'moveFeature', id: 'P', index: 3 }, /P|X/);
  });

  it('a patch of the extrusion sets, replaces and removes `from`, also where there is none and after a change of the variant', () => {
    const doc = run(base(), add(extrude('X', { extent: { type: 'distance', start: 1, distance: 2, taper: 0.1 } })));
    const set = run(doc, update('X', { extent: { from: TOP } }));
    expect(extentOf(set, 'X')).toEqual({ type: 'distance', start: 1, distance: 2, taper: 0.1, from: TOP });
    expect(extentOf(run(set, update('X', { extent: { from: DECK } })), 'X')).toEqual({ type: 'distance', start: 1, distance: 2, taper: 0.1, from: DECK });
    for (const from of [set, doc]) expect(extentOf(run(from, update('X', { extent: { from: null } })), 'X')).toEqual({ type: 'distance', start: 1, distance: 2, taper: 0.1 });
    // another variant replaces the extent and is complete: `from` only when given
    const upTo = run(set, update('X', { extent: { type: 'upTo', plane: DECK, start: 0 } }));
    expect(extentOf(upTo, 'X')).toEqual({ type: 'upTo', plane: DECK, start: 0 });
    expect(extentOf(run(upTo, update('X', { extent: { from: null } })), 'X')).toEqual({ type: 'upTo', plane: DECK, start: 0 });
    expect(extentOf(run(set, update('X', { extent: { type: 'upTo', from: TOP, plane: DECK, start: 0 } })), 'X')).toEqual({ type: 'upTo', from: TOP, plane: DECK, start: 0 });
    const cut = run(base(), add(extrude('Y', { extent: { type: 'throughAll', side: 'backward', from: TOP }, operation: 'cut', targets: ['A'] })));
    expect(extentOf(run(cut, update('Y', { extent: { type: 'distance', start: 0, distance: -1 } })), 'Y')).toEqual({ type: 'distance', start: 0, distance: -1 });
    expect(extentOf(run(cut, update('Y', { extent: { from: null } })), 'Y')).toEqual({ type: 'throughAll', side: 'backward' });
  });

  it('the hole takes `from` on both variants; its patch removes it, also where there is none; no other null in its extent', () => {
    const doc = run(base(), add(hole('H', { extent: { type: 'throughAll', side: 'backward', from: TOP } })), add(hole('K', { extent: { type: 'distance', from: DECK, start: 0, distance: -2 } })));
    expect(extentOf(doc, 'H')).toEqual({ type: 'throughAll', side: 'backward', from: TOP });
    expect(extentOf(doc, 'K')).toEqual({ type: 'distance', from: DECK, start: 0, distance: -2 });
    expect(featureRefs(doc.features.find((f) => f.id === 'H') as HoleFeature)).toEqual(['S1', 'A']);
    expect(featureRefs(doc.features.find((f) => f.id === 'K') as HoleFeature)).toEqual(['S1', 'A', 'P']);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(extentOf(run(doc, update('H', { extent: { from: null } })), 'H')).toEqual({ type: 'throughAll', side: 'backward' });
    const plain = run(base(), add(hole('H')));
    expect(extentOf(run(plain, update('H', { extent: { from: null } })), 'H')).toEqual({ type: 'throughAll', side: 'backward' });
    expect(extentOf(run(plain, update('H', { extent: { from: TOP } })), 'H')).toEqual({ type: 'throughAll', side: 'backward', from: TOP });
    // a change of the variant: complete, `from` only when given
    expect(extentOf(run(doc, update('H', { extent: { type: 'distance', start: 0, distance: -4 } })), 'H')).toEqual({ type: 'distance', start: 0, distance: -4 });
    // fields a hole never has are not removable
    invalid(plain, update('H', { extent: { taper: null } as never }), /extent\.taper/);
    invalid(plain, update('H', { extent: { gap: null } as never }), /extent\.gap/);
  });

  it('the upgrade step converts nothing; a document of an older version loads, one with `from` is refused by a build without the step', () => {
    const step = UPGRADES.find((entry) => entry.name === '2h-extent-start');
    expect(step).toBeDefined();
    expect(UPGRADES[UPGRADES.length - 1]).toBe(step);
    // the branch d36/2h: the step is pending (0 after its merge)
    expect(SCHEMA_PENDING).toBe(1);
    const doc = run(base(), add(extrude('X', { extent: { type: 'distance', from: TOP, start: 0, distance: 1 }, operation: 'add', targets: ['A'] })));
    const saved = JSON.parse(JSON.stringify(doc));
    expect(step?.run(saved)).toBe(saved);
    expect(validateDocument(saved)).toEqual(doc);
    // an older document (master before the step, version 9 without names) loads and gets the step
    const older = JSON.parse(JSON.stringify({ ...base(), schemaVersion: 9 }));
    delete older.schemaSteps;
    expect(validateDocument(older)).toEqual(base());
    // a build without the step refuses the name of the step it does not have
    expect(() => upgradeDocument(saved, UPGRADES.slice(0, -1), 0)).toThrow(/this build has no upgrade step "2h-extent-start"/);
  });
});

// ---------------------------------------------------------------- the level of the start plane

const FRAME: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] };
// A plane through (0, 0, z) whose normal is turned from Z by `tilt` towards the direction `towards`
// (an angle in the sketch plane).
const tilted = (z: number, tilt: number, towards = 0) => ({ point: [0, 0, z] as [number, number, number], normal: [Math.sin(tilt) * Math.cos(towards), Math.sin(tilt) * Math.sin(towards), Math.cos(tilt)] as [number, number, number] });
const circleLoop = (cx: number, cy: number, r: number, n: number, start = 0): Loop => {
  const xy: number[] = [];
  for (let k = 0; k < n; k++) xy.push(cx + r * Math.cos(start + (2 * Math.PI * k) / n), cy + r * Math.sin(start + (2 * Math.PI * k) / n));
  return { xy, keys: xy.filter((_, i) => i % 2 === 0).map((_, k) => `c:${k}`), curves: xy.filter((_, i) => i % 2 === 0).map(() => 'c'), exact: [{ key: 'c', forward: true, type: 'circle', center: [cx, cy], radius: r, ccw: true }] };
};
const region = (outer: Loop): Region => ({ ref: { outerLoop: ['c'] }, outer, holes: [] });
const levelOf = (plane: ReturnType<typeof tilted>, outline: ExactCurve[]) => planeLevel(plane, FRAME, outline);

describe('the level of a start plane over the exact outline', () => {
  it('a parallel plane: its level, whichever way its normal points', () => {
    expect(levelOf(tilted(4, 0), exactStart([region(circleLoop(10, 0, 3, 16))]))).toEqual({ level: 4 });
    expect(levelOf({ point: [7, 7, -2], normal: [0, 0, -1] }, exactStart([region(circleLoop(10, 0, 3, 16))]))).toEqual({ level: -2 });
  });

  it('a plane parallel to the direction or within 0.01 rad of it is refused', () => {
    const outline = exactStart([region(circleLoop(0, 0, 3, 16))]);
    expect(levelOf({ point: [0, 0, 0], normal: [1, 0, 0] }, outline)).toEqual({ detail: expect.stringMatching(/parallel to the direction of the extrusion/) });
    expect(levelOf(tilted(0, Math.PI / 2 - 0.005), outline)).toEqual({ detail: expect.stringMatching(/within 0.01 rad/) });
    expect(planeLevel(tilted(0, Math.PI / 2), FRAME, outline, 'hole')).toEqual({ detail: expect.stringMatching(/direction of the hole/) });
  });

  it('a plane tilted by 1e-6 rad: refused when its level spreads over the profile by more than the tolerance, wherever the profile lies', () => {
    // a circle of radius 1 far from the origin of the sketch: a spread of 2e-6
    const far = exactStart([region(circleLoop(40000, 0, 1, 64))]);
    const refused = levelOf(tilted(5, 1e-6), far);
    expect(refused).toEqual({ detail: expect.stringMatching(/tilted against the sketch plane by 1e-6 rad: its level differs by 2e-6 mm/) });
    // radius 0.4: a spread of 8e-7, built; the level is the middle of the extremes, 0.04 below 5
    const small = levelOf(tilted(5, 1e-6), exactStart([region(circleLoop(40000, 0, 0.4, 64))]));
    expect('level' in small && Math.abs(small.level - (5 - 40000 * Math.tan(1e-6)))).toBeLessThan(1e-9);
  });


  it('a loop without exact curves (a generated profile) is tested at its vertices', () => {
    const loop = circleLoop(0, 0, 2, 12);
    const { exact: _exact, ...bare } = loop;
    expect(exactStart([region(bare)])).toEqual([{ type: 'points', xy: loop.xy }]);
  });
});

describe('the resolved extent and "through all" from a start', () => {
  it('resolveStart raises the start of a distance and of upTo by the level and drops `from`; "through all" keeps its variant', () => {
    expect(resolveStart({ type: 'distance', from: TOP, start: -0.6, distance: -3 }, 10)).toEqual({ type: 'distance', start: 9.4, distance: -3 });
    expect(resolveStart({ type: 'upTo', from: TOP, plane: DECK, start: 0, gap: 1 }, 4)).toEqual({ type: 'upTo', plane: DECK, start: 4, gap: 1 });
    expect(resolveStart({ type: 'throughAll', side: 'backward', from: TOP }, 4)).toEqual({ type: 'throughAll', side: 'backward' });
    expect(resolveStart({ type: 'distance', start: 2, distance: 1 }, 0)).toEqual({ type: 'distance', start: 2, distance: 1 });
  });

  it('measures from the start: the interval, the reach and the scale; both sides keep 0', () => {
    // a target from z = 0 to 10 (two vertices are enough for the measure)
    const target = { positions: new Float32Array([0, 0, 0, 1, 1, 10]) } as Solid;
    expect(throughAll('backward', FRAME, [target], 0)).toMatchObject({ span: [0, -1], reach: 0 });
    const down = throughAll('backward', FRAME, [target], 10);
    expect(down).toMatchObject({ span: [10, -1], reach: 10, scale: 10, overshoot: 1 });
    expect(throughAll('forward', FRAME, [target], 4)).toMatchObject({ span: [4, 11], reach: 6 });
    // a start far beyond the targets: nothing to reach on the far side, and the scale includes the start
    const far = throughAll('forward', FRAME, [target], 500);
    expect(far).toMatchObject({ span: [500, 505], reach: 0, scale: 500, overshoot: 5 });
    expect(throughAll('backward', FRAME, [target], 500)).toMatchObject({ span: [500, -5], reach: 500 });
    expect(toolSpan({ type: 'throughAll', side: 'backward' }, FRAME, [target], 10)).toEqual([10, -1]);
    expect(toolSpan({ type: 'distance', start: 9.4, distance: -3 }, FRAME, [target], 10)).toEqual([9.4, 6.4]);
  });
});
