// Chamfers and fillets of edges that run out into round faces (D67, package 4c of D36) against the
// real adapters: the cases the design measured in the spike ("Measured", R1 to R7 and R10) as
// assertions of the real step. "Reference" is the same blend made by the engine before the feature
// that made the end face C. The regressions of the reviews are in review.test.ts, the validation
// scenario in scenario17.test.ts.
import { type Command, type EdgeName, type Engine, type FaceName, type Id, type PlaneRef, emptySketch } from '@trymesh/engine';
import { describe, expect, it } from 'vitest';
import { newEngine as defaultEngine } from './kit';

type Kind = 'chamfer' | 'fillet';
type V2 = [number, number];
const TWO_PI = 2 * Math.PI;
const XY: PlaneRef = { kind: 'base', plane: 'XY' };
const YZ: PlaneRef = { kind: 'base', plane: 'YZ' };
const side = (feature: Id, curve: Id): FaceName => ({ feature, role: 'side', curve });
const cap = (feature: Id): FaceName => ({ feature, role: 'endCap' });
const onTop = (body: Id, feature: Id): PlaneRef => ({ kind: 'face', body, face: cap(feature) });
const sketch = (id: Id, plane: PlaneRef): Command => ({ type: 'addFeature', feature: emptySketch(id, id, plane) });
const polygon = (s: Id, points: V2[], prefix = ''): Command => ({
  type: 'batch',
  commands: [
    ...points.map(([x, y], i): Command => ({ type: 'addPoint', sketch: s, id: `${prefix}p${i}`, x, y })),
    ...points.map((_, i): Command => ({ type: 'addCurve', sketch: s, id: `${prefix}l${i}`, curve: { type: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % points.length}` } })),
  ],
});
const loop = (n: number, prefix = ''): Id[] => Array.from({ length: n }, (_, i) => `${prefix}l${i}`);
const circle = (s: Id, id: Id, x: number, y: number, radius: number): Command => ({ type: 'batch', commands: [{ type: 'addPoint', sketch: s, id: `${id}c`, x, y }, { type: 'addCurve', sketch: s, id, curve: { type: 'circle', center: `${id}c` }, radius }] });
type Extent = { type: 'distance'; start: number; distance: number; taper?: number } | { type: 'throughAll'; side: 'both' };
const extrude = (id: Id, s: Id, regions: Id[][], distance: number | Extent, operation: 'new' | 'add' | 'cut' = 'new', target = 'E'): Command => ({
  type: 'addFeature',
  feature: { id, name: id, suppressed: false, type: 'extrude', profile: { type: 'regions', sketch: s, regions: regions.map((outer) => ({ outerLoop: [...outer].sort() })) }, extent: typeof distance === 'number' ? { type: 'distance', start: 0, distance } : distance, operation, ...(operation === 'new' ? {} : { targets: [target] }) },
});
const THROUGH: Extent = { type: 'throughAll', side: 'both' };
const blend = (kind: Kind, id: Id, edges: EdgeName[], size: number): Command => ({ type: 'addFeature', feature: { id, name: id, suppressed: false, type: kind, body: 'E', edges, ...(kind === 'chamfer' ? { distance: size } : { radius: size }) } as never });

function newEngine(chordTolerance: number): Engine {
  const engine = defaultEngine();
  const state = engine.getState();
  const loaded = engine.load(JSON.stringify({ ...state.document, settings: { ...state.document.settings, chordTolerance } }));
  if (!loaded.ok) throw new Error(loaded.error.message);
  return engine;
}
function run(engine: Engine, ...commands: Command[]): Engine {
  for (const command of commands) {
    const result = engine.execute(command);
    if (!result.ok) throw new Error(result.error.message);
  }
  const state = engine.getState();
  for (const f of state.document.features) if (state.evaluation.features[f.id].status !== 'ok') throw new Error(`${f.id}: ${state.evaluation.features[f.id].error?.message}`);
  return engine;
}
interface Outcome {
  status: string;
  code?: string;
  message: string;
  refs: unknown[];
  taken: number; // the volume of E before less after: cut positive, added negative
}
// The blend as the last feature, in a preview.
function apply(engine: Engine, kind: Kind, edge: EdgeName, size: number): Outcome {
  const before = engine.getState().evaluation.bodies.E.volume;
  const result = engine.preview(blend(kind, 'probe', [edge], size));
  if (!result.ok) throw new Error(result.error.message);
  const outcome = result.state.evaluation.features.probe;
  return { status: outcome.status, code: outcome.error?.code, message: outcome.error?.message ?? '', refs: outcome.error?.refs ?? [], taken: before - result.state.evaluation.bodies.E.volume };
}
// What the same blend made before the feature that makes C takes: the volume of the model without
// it less the volume of the model with it.
const reference = (make: (before?: Command[]) => Engine, kind: Kind, edge: EdgeName, size: number): number => make().getState().evaluation.bodies.E.volume - make([blend(kind, 'C', [edge], size)]).getState().evaluation.bodies.E.volume;
const sameName = (ref: unknown, name: FaceName): boolean => typeof ref === 'object' && ref !== null && 'role' in ref && JSON.stringify(Object.entries(ref).sort()) === JSON.stringify(Object.entries(name).sort());
function expectOk(outcome: Outcome): void {
  expect(outcome.message).toBe('');
  expect(outcome.status).toBe('ok');
}
const near = (value: number, expected: number, tolerance: number): void => expect(Math.abs(value - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(tolerance);
// The run-out against the reference: within `relative` of it, or `absolute` mm³.
function expectReference(outcome: Outcome, ref: number, relative: number, absolute = 0): void {
  expectOk(outcome);
  expect(Math.abs(outcome.taken - ref), `${outcome.taken} against the reference ${ref}`).toBeLessThanOrEqual(Math.max(absolute, relative * Math.abs(ref)));
}
function expectRefused(outcome: Outcome, code: string, face: FaceName, detail?: RegExp): void {
  expect(outcome.code, outcome.message).toBe(code);
  expect(outcome.refs.some((ref) => sameName(ref, face)), JSON.stringify(outcome.refs)).toBe(true);
  if (detail) expect(outcome.message).toMatch(detail);
}
// Every accepted run-out of the spike was within 2.5 % of the reference (the tools of arcs are
// divided from other starts than a whole circle), straight ones within 2 × 10⁻³ mm³.
const ARC_BOUND = 0.025;

// ---------------------------------------------------------------- the bodies of the spike

// The housing of the actuator: a plate 80 × 80 × 8, a bore R 29.5, `count` pockets of radius r on the
// circle `at`, `depth` deep.
function housing(tolerance: number, count: number, r: number, at: number, depth = 4, before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[-40, -40], [40, -40], [40, 40], [-40, 40]]), extrude('E', 's', [loop(4)], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 0, 0, 29.5), extrude('H', 'b', [['h']], -10, 'cut'));
  if (before.length) run(engine, ...before);
  const pockets = Array.from({ length: count }, (_, k) => circle('p', `k${k}`, at * Math.cos((TWO_PI * k) / count), at * Math.sin((TWO_PI * k) / count), r));
  return run(engine, sketch('p', onTop('E', 'E')), ...pockets, extrude('P', 'p', Array.from({ length: count }, (_, k) => [`k${k}`]), -depth, 'cut'));
}
const RIM: EdgeName = { a: cap('E'), b: side('H', 'h') };
// A box 60 × 40 × h with a hole of radius r through it at (30, yc): the top-front edge in two pieces,
// each crossing the hole at φ where yc = r cos φ (the centre behind the front face for yc > 0).
function holedBox(tolerance: number, r: number, yc: number, before: Command[] = [], after: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20));
  if (before.length) run(engine, ...before);
  run(engine, sketch('h', onTop('E', 'E')), circle('h', 'c', 30, yc, r), extrude('H', 'h', [['c']], -25, 'cut'));
  return after.length ? run(engine, ...after) : engine;
}
const TOP_FRONT: EdgeName = { a: cap('E'), b: side('E', 'l0') };
// A plate with a rib (x 5 to 36, y 19 to 21, 10 high) running into a boss of radius `boss` at
// (36, 20), `height` high.
function ribbed(tolerance: number, before: Command[] = [], boss = 6, height = 15): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 5), sketch('r', onTop('E', 'E')), polygon('r', [[5, 19], [36, 19], [36, 21], [5, 21]], 'r'), extrude('R', 'r', [loop(4, 'r')], 10, 'add'));
  if (before.length) run(engine, ...before);
  return run(engine, sketch('b', onTop('E', 'E')), circle('b', 'o', 36, 20, boss), extrude('B', 'b', [['o']], height, 'add'));
}
const FOOT: EdgeName = { a: cap('E'), b: side('R', 'rl0') };
// A shaft of radius 6 with a slot y −3 to −1 across it, 2 deep: the top edge of its wall y = −1 runs
// out through the cylinder at both ends.
const slotted = (tolerance: number): Engine => run(newEngine(tolerance), sketch('s', XY), circle('s', 'c', 0, 0, 6), extrude('E', 's', [['c']], 20), sketch('t', onTop('E', 'E')), polygon('t', [[-7, -3], [7, -3], [7, -1], [-7, -1]], 't'), extrude('S', 't', [loop(4, 't')], -2, 'cut'));
// The exact chamfer of a straight edge along x at the wall y = w (into y > w) on the top of a shaft of
// radius 6, across it: ∫∫ 2 √(36 − y²) over the triangle.
function exactAcross(size: number, w: number): number {
  let total = 0;
  const n = 400;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const [u, v] = [((i + 0.5) * size) / n, ((j + 0.5) * size) / n];
      if (u + v <= size) total += 2 * Math.sqrt(36 - (w + u) ** 2) * (size / n) ** 2;
    }
  return total;
}
// A plate with a bore R 10 and a slot cut 4 deep from the top.
function keyed(tolerance: number, slot: V2[], before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[-20, -20], [20, -20], [20, 20], [-20, 20]]), extrude('E', 's', [loop(4)], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 0, 0, 10), extrude('H', 'b', [['h']], -10, 'cut'));
  if (before.length) run(engine, ...before);
  return run(engine, sketch('k', onTop('E', 'E')), polygon('k', slot, 'k'), extrude('K', 'k', [loop(4, 'k')], -4, 'cut'));
}
const KEYWAY: V2[] = [[0, -1.5], [13, -1.5], [13, 1.5], [0, 1.5]];
// a notch whose floor y = 10 cos φ the rim crosses at φ
const notch = (phi: number): V2[] => [[-6, 10 * Math.cos((phi * Math.PI) / 180)], [6, 10 * Math.cos((phi * Math.PI) / 180)], [6, 13], [-6, 13]];
// A disc r 10, 8 high, with a hole r 4 at (8, 0) breaking out through its side. The reference: a disc
// r 20, the hole, the blend, then the ring outside r 10 cut away.
function brokenOut(tolerance: number, before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), circle('s', 'c', 0, 0, before.length ? 20 : 10), extrude('E', 's', [['c']], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', 8, 0, 4), extrude('H', 'b', [['h']], -10, 'cut'));
  return before.length ? run(engine, ...before, sketch('o', XY), circle('o', 'i', 0, 0, 10), circle('o', 'j', 0, 0, 30), extrude('O', 'o', [['j']], THROUGH, 'cut')) : engine;
}
// A plate with a boss r 8 at (25, 30), 10 high, and a boss r 6 at (36, 30), 12 high, overlapping it.
function twoBosses(tolerance: number, before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 60], [0, 60]]), extrude('E', 's', [loop(4)], 5), sketch('sa', onTop('E', 'E')), circle('sa', 'a', 25, 30, 8), extrude('A', 'sa', [['a']], 10, 'add'));
  if (before.length) run(engine, ...before);
  return run(engine, sketch('sb', onTop('E', 'E')), circle('sb', 'b', 36, 30, 6), extrude('B', 'sb', [['b']], 12, 'add'));
}
// A box whose front face leans (the faces of the top-front edge meet at 104°), a vertical hole r 4
// at (30, 5 + yc) through that edge.
function leaning(tolerance: number, yc: number, before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', YZ), polygon('s', [[0, 0], [40, 0], [40, 20], [5, 20]]), extrude('E', 's', [loop(4)], 60));
  if (before.length) run(engine, ...before);
  return run(engine, sketch('h', XY), circle('h', 'c', 30, 5 + yc, 4), extrude('H', 'h', [['c']], THROUGH, 'cut'));
}
// A box with a hole r 4 drilled along an axis tilted 25° about Y through its top-front edge.
function oblique(tolerance: number, yc: number, before: Command[] = []): Engine {
  const engine = run(newEngine(tolerance), sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20));
  if (before.length) run(engine, ...before);
  return run(
    engine,
    { type: 'addFeature', feature: { id: 'Q', name: 'Q', suppressed: false, type: 'plane', base: XY, offset: 20, tilt: { axis: { kind: 'base', axis: 'Y' }, angle: (25 * Math.PI) / 180 } } as never },
    sketch('h', { kind: 'plane', feature: 'Q' } as PlaneRef),
    circle('h', 'c', 30, yc, 4),
    extrude('H', 'h', [['c']], THROUGH, 'cut'),
  );
}

// ---------------------------------------------------------------- the cases

describe('R1: the rim of a bore broken by 16 pin pockets (arcs running out into cylinders)', () => {
  it('chamfers and fillets at 0.01 and 0.05, each within 2.5 % of the blend made before the pockets', () => {
    for (const [tolerance, kind, size] of [
      [0.01, 'chamfer', 0.5],
      [0.01, 'fillet', 0.5],
      [0.05, 'chamfer', 1.5],
    ] as [number, Kind, number][]) {
      const outcome = apply(housing(tolerance, 16, 2.5, 29), kind, RIM, size);
      expectReference(outcome, reference((before) => housing(tolerance, 16, 2.5, 29, 4, before), kind, RIM, size), ARC_BOUND);
    }
  });
});

describe('R2: a straight edge broken by a hole, at falling angles (the least crossing angle)', () => {
  it('from 90° to 10.5° a run-out equal to the reference or a bridge with advice; under 10° too flat; the hole in refs', () => {
    let accepted = 0;
    for (const [tolerance, phis] of [
      [0.01, [90, 45, 12, 10.5, 9.5, 5]],
      [0.05, [45, 15]],
    ] as [number, number[]][]) {
      for (const phi of phis) {
        for (const sign of phi === 90 ? [1] : [1, -1]) {
          const yc = sign * 4 * Math.cos((phi * Math.PI) / 180);
          for (const [kind, size] of [
            ['chamfer', 1],
            ['fillet', 1],
          ] as [Kind, number][]) {
            const outcome = apply(holedBox(tolerance, 4, yc), kind, TOP_FRONT, size);
            if (phi < 10) {
              expectRefused(outcome, 'unsupportedEdge', side('H', 'c'), /less than 10°/);
              continue;
            }
            if (outcome.code) {
              expectRefused(outcome, 'unsupportedEdge', side('H', 'c'), /passes behind the end face in refs before it crosses it/);
              continue;
            }
            expectReference(outcome, reference((before) => holedBox(tolerance, 4, yc, before), kind, TOP_FRONT, size), 0, 2e-3);
            accepted++;
          }
        }
      }
    }
    expect(accepted).toBeGreaterThanOrEqual(12);
  });

  it('R2b: small holes at 0.05: one that only grazes the edge within the band of its end is refused; a hole of 0.5 runs out', () => {
    const yc = (r: number): number => r * Math.cos(Math.PI / 3);
    const small = apply(holedBox(0.05, 0.1, yc(0.1)), 'chamfer', TOP_FRONT, 0.3);
    expect(small.code).toMatch(/unsupportedEdge|blendDoesNotFit/);
    expect(small.refs.some((ref) => sameName(ref, side('H', 'c')))).toBe(true);
    for (const kind of ['chamfer', 'fillet'] as Kind[]) expectReference(apply(holedBox(0.05, 0.5, yc(0.5)), kind, TOP_FRONT, 0.3), reference((before) => holedBox(0.05, 0.5, yc(0.5), before), kind, TOP_FRONT, 0.3), 0, 2e-3);
  });
});

describe('R3, R4: a concave foot into a boss; out through the cylinder of a shaft', () => {
  it('the foot of a rib running into a boss: a chamfer and a fillet equal to the reference (added)', () => {
    for (const [tolerance, kind, size] of [
      [0.05, 'chamfer', 1.5],
      [0.01, 'fillet', 3],
    ] as [number, Kind, number][]) {
      const outcome = apply(ribbed(tolerance), kind, FOOT, size);
      expect(outcome.taken).toBeLessThan(0);
      expectReference(outcome, reference((before) => ribbed(tolerance, before), kind, FOOT, size), 0, 2e-3);
    }
  });

  it('a slot across a shaft, its wall\'s top edge chamfered 1.5 out through the cylinder at both ends: within 1 % of the exact volume (round 2 refused it as a bridge)', () => {
    // the spike chamfered it by 2, the whole height of the wall: D63 refuses that, the wall would
    // vanish (the spike did not run that check)
    const edge: EdgeName = { a: cap('E'), b: side('S', 'tl2') };
    for (const tolerance of [0.01, 0.05]) {
      const outcome = apply(slotted(tolerance), 'chamfer', edge, 1.5);
      expectOk(outcome);
      expect(Math.abs(outcome.taken - exactAcross(1.5, -1)) / exactAcross(1.5, -1)).toBeLessThan(0.01);
    }
    expectOk(apply(slotted(0.01), 'fillet', edge, 1.5));
    expect(apply(slotted(0.01), 'chamfer', edge, 2).message).toMatch(/the face in refs would vanish/);
  });
});

describe('R5: an arc past planes off its axis', () => {
  it('the rim of a bore into a keyway and into a notch crossed at 10.5°: equal to the reference; at 9.5° too flat', () => {
    for (const [tolerance, kind, size] of [
      [0.01, 'chamfer', 1],
      [0.05, 'fillet', 0.5],
    ] as [number, Kind, number][]) {
      expectReference(apply(keyed(tolerance, KEYWAY), kind, RIM, size), reference((before) => keyed(tolerance, KEYWAY, before), kind, RIM, size), 0.01, 5e-3);
    }
    expectReference(apply(keyed(0.01, notch(10.5)), 'chamfer', RIM, 0.5), reference((before) => keyed(0.01, notch(10.5), before), 'chamfer', RIM, 0.5), 0.01, 5e-3);
    expectRefused(apply(keyed(0.01, notch(9.5)), 'chamfer', RIM, 0.5), 'unsupportedEdge', side('K', 'kl0'), /at 9\.5°, less than 10°/);
  });
});

describe('R6: other corners, axes and sides', () => {
  it('the rim of a hole broken out through a disc (an arc into the air outside a cylinder): equal to the reference', () => {
    for (const [tolerance, kind, size] of [
      [0.01, 'chamfer', 1],
      [0.05, 'fillet', 0.5],
    ] as [number, Kind, number][]) {
      expectReference(apply(brokenOut(tolerance), kind, RIM, size), reference((before) => brokenOut(tolerance, before), kind, RIM, size), ARC_BOUND);
    }
  });

  it('the foot of a boss running into an overlapping boss (a concave arc into material): equal to the reference', () => {
    const foot: EdgeName = { a: cap('E'), b: side('A', 'a') };
    expectReference(apply(twoBosses(0.01), 'fillet', foot, 2), reference((before) => twoBosses(0.01, before), 'fillet', foot, 2), ARC_BOUND);
    expectReference(apply(twoBosses(0.05), 'chamfer', foot, 1), reference((before) => twoBosses(0.05, before), 'chamfer', foot, 1), ARC_BOUND);
  });

  it('a box whose faces meet at 104° and a hole along a tilted axis: equal to the reference', () => {
    const lean: EdgeName = { a: side('E', 'l2'), b: side('E', 'l3') };
    for (const [make, edge] of [
      [leaning, lean],
      [oblique, TOP_FRONT],
    ] as [(t: number, y: number, b?: Command[]) => Engine, EdgeName][]) {
      for (const [kind, yc] of [
        ['chamfer', 2],
        ['fillet', -1],
      ] as [Kind, number][]) {
        const outcome = apply(make(0.01, yc), kind, edge, 1);
        if (outcome.code === 'unsupportedEdge' && /passes behind/.test(outcome.message)) continue;
        expectReference(outcome, reference((before) => make(0.01, yc, before), kind, edge, 1), 0.01, 2e-3);
      }
    }
  });
});

describe('R7: the void check and what is refused', () => {
  it('pockets shallower than the blend are refused (a pocket in refs); deep enough they run out, equal to the reference', () => {
    for (const [tolerance, depth, kind, size] of [
      [0.05, 0.2, 'chamfer', 0.5],
      [0.01, 0.3, 'fillet', 0.5],
      [0.01, 0.8, 'chamfer', 1],
    ] as [number, number, Kind, number][]) {
      const outcome = apply(housing(tolerance, 16, 2.5, 29, depth), kind, RIM, size);
      expect(outcome.code, outcome.message).toBe('blendDoesNotFit');
      expect(outcome.message).toMatch(/would take .* mm³ beyond the end face in refs within its run-out/);
      expect(outcome.refs.some((ref) => typeof ref === 'object' && ref !== null && (ref as FaceName).feature === 'P')).toBe(true);
    }
    expectReference(apply(housing(0.01, 16, 2.5, 29, 1.2), 'chamfer', RIM, 1), reference((before) => housing(0.01, 16, 2.5, 29, 1.2, before), 'chamfer', RIM, 1), ARC_BOUND);
  });

  it('pins and a post standing in the hole where the tool runs on are refused; a pin out of its way is not', () => {
    const yc = -2;
    const xEnd = 30 - Math.sqrt(16 - yc * yc);
    // a pin at the end of each piece (the second mirrored), each a piece of the body of its own
    const pins = (x: number, y: number, r: number): Command[] => [sketch('q', XY), circle('q', 'n0', x, y, r), circle('q', 'n1', 60 - x, y, r), extrude('N', 'q', [['n0'], ['n1']], 20, 'add')];
    for (const [kind, dx, y] of [
      ['chamfer', 0.5, 0.5],
      ['fillet', 0.25, 0.25],
      ['chamfer', 1, 0.75],
    ] as [Kind, number, number][]) {
      expectRefused(apply(holedBox(0.01, 4, yc, [], pins(xEnd + dx, y, 0.2)), kind, TOP_FRONT, 1), 'blendDoesNotFit', side('H', 'c'), /beyond the end face in refs/);
    }
    // a pin deep in the hole, out of the tool's way: accepted, equal to the reference
    const away = [sketch('q', XY), circle('q', 'n0', 30, -1, 0.3), extrude('N', 'q', [['n0']], 20, 'add')];
    expectReference(apply(holedBox(0.01, 4, yc, [], away), 'chamfer', TOP_FRONT, 1), reference((before) => holedBox(0.01, 4, yc, before, away), 'chamfer', TOP_FRONT, 1), 0, 2e-3);
    // a separate post 1 × 1 in a hole r 6 within the run-out of a chamfer of 5
    const x = 30 - Math.sqrt(36 - 4) + 0.3;
    const post = [sketch('t', XY), polygon('t', [[x, 0.5], [x + 1, 0.5], [x + 1, 1.5], [x, 1.5]], 't'), extrude('T', 't', [loop(4, 't')], 20, 'add')];
    expectRefused(apply(holedBox(0.01, 6, 2, [], post), 'chamfer', TOP_FRONT, 5), 'blendDoesNotFit', side('H', 'c'));
  });

  it('a concave run-out into a boss lower than the fillet: refused, the fillet would add material where the boss has none', () => {
    const low = apply(ribbed(0.01, [], 6, 1), 'fillet', FOOT, 1.5);
    expectRefused(low, 'blendDoesNotFit', side('B', 'o'), /would add .* mm³ beyond the end face in refs, where it has no material/);
  });
});

describe('R10: acute corners, where the profile reaches C long before the end vertex', () => {
  // A wedge 60 long whose edge has faces meeting at 10° (a fillet's setback r / tan 5°: 11.4 for
  // r 1), a hole r 25 crossing that edge at 45°; pins in the hole where the profile reaches it 5 mm
  // before the end vertex (round 2 checked only 4 mm back).
  const HOLE = 25;
  const yc = HOLE * Math.cos(Math.PI / 4);
  const wedge = (tolerance: number, before: Command[] = [], pins: V2[] = []): Engine => {
    const engine = run(newEngine(tolerance), sketch('s', YZ), polygon('s', [[0, 0], [60, 0], [60, 60 * Math.tan((10 * Math.PI) / 180)]]), extrude('E', 's', [loop(3)], 60));
    if (before.length) run(engine, ...before);
    run(engine, sketch('h', XY), circle('h', 'c', 30, yc, HOLE), extrude('H', 'h', [['c']], THROUGH, 'cut'));
    return pins.length ? run(engine, sketch('q', XY), ...pins.map(([x, y], i) => circle('q', `n${i}`, x, y, 0.2)), extrude('N', 'q', pins.map((_, i) => [`n${i}`]), { type: 'distance', start: -1, distance: 4 }, 'add')) : engine;
  };
  const ACUTE: EdgeName = { a: side('E', 'l0'), b: side('E', 'l2') };
  it('a fillet of 1 equal to the reference; with pins where the profile reaches the hole early, refused', () => {
    expectReference(apply(wedge(0.01), 'fillet', ACUTE, 1), reference((before) => wedge(0.01, before), 'fillet', ACUTE, 1), 0.01, 2e-3);
    const yp = 0.7 / Math.tan((5 * Math.PI) / 180);
    const xs = 30 - Math.sqrt(HOLE ** 2 - (yp - yc) ** 2);
    const pins: V2[] = [
      [xs + 0.4, yp],
      [60 - xs - 0.4, yp],
    ];
    expect(30 - HOLE * Math.sin(Math.PI / 4) - pins[0][0]).toBeGreaterThan(4.5);
    expectRefused(apply(wedge(0.01, [], pins), 'fillet', ACUTE, 1), 'blendDoesNotFit', side('H', 'c'));
  });
});

describe('the implementation: far from the origin', () => {
  // At 2 000 mm the kernel refused the first boolean of the void check (the tool with the body, a
  // folded triangle) for 3 of 11 random pockets around a bore where the blend made before the
  // pockets builds; the same set is then measured the other way round (the tool cut to the region
  // first). Pinned: the case of the fuzz (seed 1) that failed so.
  it('16 pockets r 1.05 on the circle 29.61 at 2 000 mm, a fillet of 0.526: equal to the reference', () => {
    const far = 2000;
    const make = (before: Command[] = []): Engine => {
      const engine = run(newEngine(0.01), sketch('s', XY), polygon('s', [[far - 40, far - 40], [far + 40, far - 40], [far + 40, far + 40], [far - 40, far + 40]]), extrude('E', 's', [loop(4)], 8), sketch('b', onTop('E', 'E')), circle('b', 'h', far, far, 29.5), extrude('H', 'b', [['h']], -10, 'cut'));
      if (before.length) run(engine, ...before);
      const pockets = Array.from({ length: 16 }, (_, k) => circle('p', `k${k}`, far + 29.61 * Math.cos((TWO_PI * k) / 16), far + 29.61 * Math.sin((TWO_PI * k) / 16), 1.05));
      return run(engine, sketch('p', onTop('E', 'E')), ...pockets, extrude('P', 'p', Array.from({ length: 16 }, (_, k) => [`k${k}`]), -4, 'cut'));
    };
    expectReference(apply(make(), 'fillet', RIM, 0.526), reference(make, 'fillet', RIM, 0.526), ARC_BOUND);
  });
});

describe('two run-outs into one gap', () => {
  // Two shafts of radius 6 side by side, `apart` between their axes, one body, with a slot y −3 to
  // −1 across both, 2 deep: the top edge of its wall y = −1 is one edge of two pieces, whose inner
  // ends run out of each shaft into the gap between them. A chamfer of 1.5 needs about 0.1 past each
  // end (its side must clear the cylinder grown by the lift).
  const twin = (apart: number): Engine =>
    run(newEngine(0.01), sketch('s', XY), circle('s', 'c', 0, 0, 6), circle('s', 'd', apart, 0, 6), extrude('E', 's', [['c'], ['d']], 20), sketch('t', onTop('E', 'E')), polygon('t', [[-7, -3], [apart + 7, -3], [apart + 7, -1], [-7, -1]], 't'), extrude('S', 't', [loop(4, 't')], -2, 'cut'));
  const edge: EdgeName = { a: cap('E'), b: side('S', 'tl2') };
  it('apart 12.3: both run out; apart 12.02 (a gap of 0.19 at the wall): their reaches add up to more than it, a bridge', () => {
    const one = apply(twin(12.3), 'chamfer', edge, 1.5);
    expectOk(one);
    near(one.taken, 2 * exactAcross(1.5, -1), 0.02 * exactAcross(1.5, -1));
    const bridge = apply(twin(12.02), 'chamfer', edge, 1.5);
    expect(bridge.code, bridge.message).toBe('unsupportedEdge');
    expect(bridge.message).toMatch(/the run-outs of two pieces of the edge into the end face in refs reach across the gap between them/);
  });
});

describe('the details of the refusals, through the step (the review of the implementation, M1)', () => {
  it('the piece shorter than its blend reaches: a hole r 10 crossing the front edge at 15°, 5 from the box\'s side, under a chamfer of 2', () => {
    const r = 10;
    const yc = r * Math.cos((15 * Math.PI) / 180);
    const engine = run(newEngine(0.01), sketch('s', XY), polygon('s', [[0, 0], [60, 0], [60, 40], [0, 40]]), extrude('E', 's', [loop(4)], 20), sketch('h', onTop('E', 'E')), circle('h', 'c', 5, yc, r), extrude('H', 'h', [['c']], -25, 'cut'));
    // the piece from the box's side to the hole is 2.4 long; the profile's far point stays in the
    // hole all along it
    expectRefused(apply(engine, 'chamfer', TOP_FRONT, 2), 'blendDoesNotFit', side('H', 'c'), /the piece is shorter than its blend reaches into the end face in refs/);
  });

  it('an arc at a cylinder whose axis is not parallel to its own: the rim of a bore into a groove along the top of the plate', () => {
    const engine = run(newEngine(0.01), sketch('s', XY), polygon('s', [[-40, -40], [40, -40], [40, 40], [-40, 40]]), extrude('E', 's', [loop(4)], 10), sketch('b', onTop('E', 'E')), circle('b', 'h', 0, 0, 10), extrude('H', 'b', [['h']], -12, 'cut'), sketch('g', YZ), circle('g', 'o', 0, 10, 2), extrude('G', 'g', [['o']], THROUGH, 'cut'));
    expectRefused(apply(engine, 'chamfer', { a: cap('E'), b: side('H', 'h') }, 1), 'unsupportedEdge', side('G', 'o'), /the arc ends at a cylinder \(G\/side\/o\) whose axis is not parallel to its own, which this feature cannot run out into yet/);
  });

  it('an end face too large for the chord tolerance: a slot 40 in from the side of a shaft R 900 at 0.001 (its region would need more than 4 096 sides)', () => {
    const R = 900;
    const engine = run(newEngine(0.001), sketch('s', XY), circle('s', 'c', 0, 0, R), extrude('E', 's', [['c']], 20), sketch('t', onTop('E', 'E')), polygon('t', [[-R - 5, R - 45], [R + 5, R - 45], [R + 5, R - 40], [-R - 5, R - 40]], 't'), extrude('S', 't', [loop(4, 't')], -3, 'cut'));
    expectRefused(apply(engine, 'chamfer', { a: cap('E'), b: side('S', 'tl2') }, 1), 'blendDoesNotFit', side('E', 'c'), /the end face in refs is too large for the chord tolerance of the document/);
  });

  it('holes too small for the chord tolerance are refused as grazing, before the radius is read: r 0.1 to 0.2 at 0.05', () => {
    // a hole whose radius is under lift + chord tolerance has both of its roots with the edge
    // within the band of the end vertex, so "too small for the chord tolerance" is a backstop
    for (const [r, yc] of [
      [0.1, 0],
      [0.12, 0.05],
      [0.2, 0.1],
    ]) {
      expectRefused(apply(holedBox(0.05, r, yc), 'chamfer', TOP_FRONT, 1), 'unsupportedEdge', side('H', 'c'), /the edge only grazes the end face in refs/);
    }
  });
});
