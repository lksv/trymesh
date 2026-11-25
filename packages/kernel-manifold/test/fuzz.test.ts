// Random tests of the adapter. The number of cases and the first seed can be changed by
// environment variables:
//   FUZZ_COUNT=30000 FUZZ_FIRST=1 pnpm test packages/kernel-manifold/test/fuzz.test.ts
import { expect, it } from 'vitest';
import { check, describeOps, generate } from './fuzz';
import { kernel } from './testkit';

const COUNT = Number(process.env.FUZZ_COUNT ?? 1000);
const FIRST = Number(process.env.FUZZ_FIRST ?? 1);

it(`random sequences of booleans: ${COUNT} cases from the seed ${FIRST}`, { timeout: 60_000 + COUNT * 50 }, () => {
  const failures: string[] = [];
  const rejected = { strict: 0, loose: 0 };
  const second = kernel.secondCleanings;
  for (let seed = FIRST; seed < FIRST + COUNT; seed++) {
    const problems = check(seed, rejected);
    if (problems.length) failures.push(`seed ${seed}: ${problems.slice(0, 4).join('; ')}\n   ${describeOps(generate(seed).ops)}`);
  }
  console.log(`random tests: ${COUNT} cases, ${failures.length} failed, the adapter refused ${rejected.strict} in the design range and ${rejected.loose} outside it (a deviation of a side of 3e-5)`);
  expect(failures.slice(0, 15)).toEqual([]);
  // A refusal by an error is safe, but has to be rare.
  expect(rejected.strict).toBeLessThanOrEqual(Math.ceil(COUNT / 10000));
  expect(rejected.loose).toBeLessThanOrEqual(Math.ceil(COUNT / 200));
  // unions and differences never reach the second cleaning of an intersection (D51)
  expect(kernel.secondCleanings).toBe(second);
});

// Cases that failed once and led to a fix of the adapter; they are guarded separately so that a
// change of the default range of seeds does not drop them.
it.each([2004, 3097, 3670, 5310, 5790, 13665, 15417, 18471, 20188, 20619, 23288, 24919, 25304, 27299])('previously failing seed %i', (seed) => {
  expect(check(seed)).toEqual([]);
});
