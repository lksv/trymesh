// Random modelled threads on the adapter (D76, stage 2; spike.md, P): the tool of the engine
// (`buildThreadTool`) cut from a pin standing on a plate (an open end and a shoulder), a through
// bore (two open ends) and a blind bore (an open end and a shoulder), at the default chord
// tolerance, most of them turned and up to 300 mm from the origin. The oracle: the result is closed,
// none of the hidden faces of the tool is left, and the volume taken is that of the exact grooves
// over the part of the wall the tool cuts. The number of cases and the first seed:
//   THREAD_FUZZ_COUNT=300 THREAD_FUZZ_FIRST=1 npx vitest run packages/kernel-manifold/test/thread-fuzz.test.ts
import { type Solid, THREAD_TOOL_ATTEMPTS, type ToolShape, buildThreadTool, threadLift, threadProfile, toolShape, radiusAt } from '@trymesh/engine';
import { expect, it } from 'vitest';
import { type Random, rng } from './fuzz';
import { type TestFrame, IDENTITY, circle, inspect, kernel, prism, rect, rotation } from './testkit';

const COUNT = Number(process.env.THREAD_FUZZ_COUNT ?? 40);
const FIRST = Number(process.env.THREAD_FUZZ_FIRST ?? 1);
// THREAD_FUZZ_PAST=1: the tool runs this much further past the open end (the second build of
// "To verify" 7 of the design)
const PAST = Number(process.env.THREAD_FUZZ_PAST ?? 0);
// The meshes tried after a refusal, in order: those of the step (`THREAD_TOOL_ATTEMPTS`), or
// THREAD_FUZZ_VARIANTS='[{"sections":2}]' to measure others ('[]': none)
const VARIANTS: { sections?: number }[] = process.env.THREAD_FUZZ_VARIANTS ? JSON.parse(process.env.THREAD_FUZZ_VARIANTS) : THREAD_TOOL_ATTEMPTS.slice(1);
const TOL = 0.01;
const TAU = 2 * Math.PI;
const pick = <T>(r: Random, items: readonly T[]): T => items[Math.floor(r() * items.length)];

type Kind = 'pin' | 'through' | 'blind';
interface ThreadCase {
  kind: Kind;
  diameter: number;
  pitch: number;
  depth?: number;
  flankAngle: number;
  starts: number;
  hand: 'right' | 'left';
  length: number;
  frame: TestFrame;
  phase: number;
}
export function generateThread(seed: number): ThreadCase {
  const r = rng(seed);
  const diameter = 3 + 37 * r();
  const pitch = diameter * (0.06 + 0.1 * r());
  const printed = r() < 0.4;
  const flankAngle = printed ? pick(r, [Math.PI / 2, Math.PI / 3]) : Math.PI / 3;
  const far = r() < 0.7;
  const rotate = rotation(r() * TAU, r() * TAU, r() * TAU);
  const distance = far ? 300 * r() : 0;
  const direction = rotate([0.3, -0.5, 0.8]);
  const frame: TestFrame = far ? { o: [distance * direction[0], distance * direction[1], distance * direction[2]], x: rotate([1, 0, 0]), y: rotate([0, 1, 0]), n: rotate([0, 0, 1]) } : IDENTITY;
  return { kind: pick(r, ['pin', 'through', 'blind'] as const), diameter, pitch, ...(printed ? { depth: pitch * (0.25 + 0.05 * r()) } : {}), flankAngle, starts: pick(r, [1, 1, 1, 2, 3]), hand: pick(r, ['right', 'left'] as const), length: Math.min(30, Math.max(2, pitch * (1 + 8 * r()))), frame, phase: TAU * r() };
}
const describeCase = (c: ThreadCase): string => `${c.kind} ${c.diameter.toFixed(3)}x${c.pitch.toFixed(3)}${c.depth ? ` depth ${c.depth.toFixed(3)}` : ''} at ${((c.flankAngle * 180) / Math.PI).toFixed(0)}°, ${c.starts} start(s), ${c.hand}, ${c.length.toFixed(2)} long, origin ${c.frame.o.map((x) => x.toFixed(1)).join(', ')}`;

// a polygon of a circle for the chord tolerance
const polygon = (radius: number): [number, number][] => circle(0, 0, radius, Math.max(8, Math.ceil(Math.PI / Math.acos(1 - Math.min(TOL / radius, 1)))));
// the mean over a pitch of a function of the axial coordinate
const meanOver = (s: ToolShape, f: (r: number) => number, steps = 4000): number => {
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += f(radiusAt(s, ((i + 0.5) * s.pitch) / steps));
  return sum / steps;
};

export function checkThread(seed: number, refused: { count: number; cases: string[]; attempts?: Map<number, number> }): string[] {
  const c = generateThread(seed);
  const profile = threadProfile({ diameter: c.diameter, pitch: c.pitch, ...(c.depth ? { depth: c.depth } : {}), flankAngle: c.flankAngle, starts: c.starts, hand: c.hand });
  if ('detail' in profile) return [];
  if (profile.depth < 5 * TOL) return []; // not a thread of this tolerance
  const internal = c.kind !== 'pin';
  const wall = internal ? profile.minor : profile.major;
  const side = 2 * profile.major + 10;
  const [w, f] = [c.frame, c.frame];
  const ids = (first: number, sides: number) => ({ start: first, end: first + 1, sides: Array.from({ length: sides }, (_, i) => first + 2 + i) });
  let body: Solid;
  if (c.kind === 'pin') {
    const plate = prism(w, rect(-side / 2, -side / 2, side / 2, side / 2), -3, 0, ids(1, 4));
    const loop = polygon(wall);
    body = kernel.boolean('union', plate, prism(w, loop, 0, c.length, { start: 10, end: 11, sides: loop.map(() => 12) }));
  } else {
    const loop = polygon(wall);
    const block = prism(w, rect(-side / 2, -side / 2, side / 2, side / 2), 0, c.length, ids(1, 4));
    body = kernel.boolean('difference', block, prism(w, loop, -1, c.length + 1, { start: 10, end: 11, sides: loop.map(() => 12) }));
    if (c.kind === 'blind') body = kernel.boolean('union', body, prism(w, rect(-side / 2, -side / 2, side / 2, side / 2), -3, 0, ids(20, 4)));
  }
  const lift = threadLift(TOL, 1e-5 * Math.max(1, 2 * Math.hypot(...f.o) + side));
  const s = toolShape(profile, { radius: wall, internal }, 0, lift);
  // the thread from the top (w = length) down: open there, a shoulder at the bottom but for a through bore
  const datum = { origin: [f.o[0] + c.length * f.n[0], f.o[1] + c.length * f.n[1], f.o[2] + c.length * f.n[2]] as [number, number, number], axis: [-f.n[0], -f.n[1], -f.n[2]] as [number, number, number], zero: [Math.cos(c.phase) * f.x[0] + Math.sin(c.phase) * f.y[0], Math.cos(c.phase) * f.x[1] + Math.sin(c.phase) * f.y[1], Math.cos(c.phase) * f.x[2] + Math.sin(c.phase) * f.y[2]] as [number, number, number] };
  const [z0, z1] = [-lift - PAST, c.kind === 'through' ? c.length + lift + PAST : c.length - lift];
  if (z1 - z0 <= TOL) return [];
  const [guard, first] = [500, 100];
  let result: Solid | undefined;
  let message = '';
  for (const [attempt, variant] of [{}, ...VARIANTS].entries()) {
    try {
      result = kernel.boolean('difference', body, buildThreadTool(s, internal, datum, z0, z1, TOL, lift, first, guard, variant));
      refused.attempts?.set(seed, attempt + 1);
      if (attempt) refused.cases.push(`seed ${seed}: cleared by the build ${attempt + 1}, ${JSON.stringify(variant)}`);
      break;
    } catch (error) {
      message ||= (error as Error).message;
    }
  }
  if (!result) {
    refused.attempts?.set(seed, 0);
    refused.count++;
    refused.cases.push(`seed ${seed}: ${message.slice(0, 120)}\n   ${describeCase(c)}`);
    return [];
  }
  const problems: string[] = [];
  const status = inspect(result);
  if (status.status !== 'NoError') problems.push(`status ${status.status}`);
  if (result.faceIds.includes(guard)) problems.push('a hidden face of the tool is left');
  // the volume taken: the exact grooves over the part of the wall the tool cuts
  const cut = Math.min(z1, c.length) - Math.max(z0, 0);
  const perLength = Math.PI * (internal ? meanOver(s, (r) => Math.max(r, wall) ** 2 - wall ** 2) : meanOver(s, (r) => wall ** 2 - Math.min(r, wall) ** 2));
  const taken = inspect(body).volume - status.volume;
  const bound = ((6 * TOL) / wall) * Math.PI * wall ** 2 * c.length;
  if (Math.abs(taken - perLength * cut) > bound) problems.push(`taken ${taken.toFixed(3)} against ${(perLength * cut).toFixed(3)} (bound ${bound.toFixed(3)})`);
  return problems.length ? [`${problems.join('; ')}\n   ${describeCase(c)}`] : [];
}

// A turn of the event loop between cases: vitest gives none within a synchronous test, and a worker
// that keeps it for a minute under the load of the full suite loses its messages to the main
// process ("Timeout calling onTaskUpdate"; the review of stage 2). A long run of the fuzz takes minutes.
const aTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The seeds the adapter refused with the first build in the runs of the seeds 1 to 600
// (2026-11-27), with the build of THREAD_TOOL_ATTEMPTS that the adapter takes now (0: none, the
// feature is kernelFailure). What is accepted has to be right. This map is a sensor of the adapter:
// after a change of the adapter (or of the meshes of the tool) another build may clear a seed, or
// none, and that is a measurement to record here and in the design (the known limit of the
// refusals), not a defect; the bound of the random run below stays as it is.
const REFUSED_SEEDS: Record<number, number> = { 4: 3, 71: 0, 216: 2, 221: 4, 429: 2, 437: 2, 442: 3, 463: 2, 497: 2 };
it('the seeds refused with the first build: the build that clears each, and right', { timeout: 120_000 }, async () => {
  const refused = { count: 0, cases: [] as string[], attempts: new Map<number, number>() };
  const seeds = Object.keys(REFUSED_SEEDS).map(Number);
  const failures: string[] = [];
  for (const seed of seeds) {
    await aTurn();
    failures.push(...checkThread(seed, refused));
  }
  expect(failures).toEqual([]);
  if (!process.env.THREAD_FUZZ_VARIANTS && !PAST) expect(Object.fromEntries(refused.attempts)).toEqual(REFUSED_SEEDS);
  console.log(`the pinned seeds: ${refused.count} of ${seeds.length} refused${PAST ? ` with the tool ${PAST} further past the open end` : ''}`);
});

it(`random modelled threads on the adapter: ${COUNT} cases from the seed ${FIRST}`, { timeout: 60_000 + COUNT * 3000 }, async () => {
  const failures: string[] = [];
  const refused = { count: 0, cases: [] as string[] };
  // THREAD_FUZZ_SEEDS=4,71: only these seeds
  const seeds = process.env.THREAD_FUZZ_SEEDS ? process.env.THREAD_FUZZ_SEEDS.split(',').map(Number) : Array.from({ length: COUNT }, (_, i) => FIRST + i);
  for (const [i, seed] of seeds.entries()) {
    if (i % 5 === 0) await aTurn();
    failures.push(...checkThread(seed, refused).map((text) => `seed ${seed}: ${text}`));
  }
  console.log(`modelled threads: ${COUNT} cases, ${failures.length} failed, the adapter refused ${refused.count}${refused.cases.length ? `\n${refused.cases.join('\n')}` : ''}`);
  expect(failures.slice(0, 10)).toEqual([]);
  // a refusal is an error of the feature (kernelFailure), safe but rare: 1 of 600 after the builds of
  // THREAD_TOOL_ATTEMPTS (9 of 600 with the first build alone); the bound is 1 %
  expect(refused.count).toBeLessThanOrEqual(Math.ceil(COUNT / 100));
});
