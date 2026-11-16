// The sliver fuzz of the adapter (D51): intersections of a pin with its hole turned against it, in
// random frames (sliver-fuzz.ts). A case is refused by the adapter's own checks, or answered with a
// mesh that is closed, unfolded, and has the exact volume within its room. The number of cases and
// the first seed:
//   SLIVER_FUZZ_COUNT=10000 SLIVER_FUZZ_FIRST=1 npx vitest run packages/kernel-manifold/test/sliver-fuzz.test.ts
import { expect, it } from 'vitest';
import { checkSliver, describeSliver, generateSliver } from './sliver-fuzz';

const COUNT = Number(process.env.SLIVER_FUZZ_COUNT ?? 100);
const FIRST = Number(process.env.SLIVER_FUZZ_FIRST ?? 1);

it(`intersections of slivers: ${COUNT} cases from the seed ${FIRST}`, { timeout: 60_000 + COUNT * 1000 }, () => {
  const failures: string[] = [];
  const counts = { unbuilt: 0, refused: 0, first: 0, second: 0 };
  for (let seed = FIRST; seed < FIRST + COUNT; seed++) {
    const { outcome, problems } = checkSliver(seed);
    counts[outcome]++;
    if (problems.length) failures.push(`seed ${seed}: ${problems.join('; ')}\n   ${describeSliver(generateSliver(seed))}`);
  }
  console.log(
    `slivers: ${COUNT} cases, ${failures.length} failed, answered by the first cleaning ${counts.first}, by the second ${counts.second}, refused ${counts.refused}, the inputs not built ${counts.unbuilt}`,
  );
  expect(failures.slice(0, 15)).toEqual([]);
  // A refusal is safe, but has to be rare: 49 of 9,999 in the measurement of the design, at most
  // three in any hundred seeds in a row and ten in any thousand.
  expect(counts.refused).toBeLessThanOrEqual(3 + Math.ceil(COUNT * 0.008));
  // the union that makes the pin with its flush plate was refused once in 10,000 (the seed 2535)
  expect(counts.unbuilt).toBeLessThanOrEqual(1 + Math.ceil(COUNT / 2000));
});

// Seeds that failed once and led to a fix of the adapter; none so far.
const PINNED: number[] = [];
it.skipIf(PINNED.length === 0).each(PINNED)('a seed that failed before: %i', (seed) => {
  expect(checkSliver(seed).problems).toEqual([]);
});
