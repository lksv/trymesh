// Random tests of the adapter with tapered tools (D45). The number of cases and the first seed:
//   TAPER_FUZZ_COUNT=3000 TAPER_FUZZ_FIRST=1 npx vitest run packages/kernel-manifold/test/taper-fuzz.test.ts
import { expect, it } from 'vitest';
import { checkTapered, describeTapered, generateTapered } from './taper-fuzz';

const COUNT = Number(process.env.TAPER_FUZZ_COUNT ?? 300);
const FIRST = Number(process.env.TAPER_FUZZ_FIRST ?? 1);

it(`random booleans with tapered tools: ${COUNT} cases from the seed ${FIRST}`, { timeout: 60_000 + COUNT * 200 }, () => {
  const failures: string[] = [];
  const rejected = { count: 0 };
  for (let seed = FIRST; seed < FIRST + COUNT; seed++) {
    const problems = checkTapered(seed, rejected);
    if (problems.length) failures.push(`seed ${seed}: ${problems.slice(0, 4).join('; ')}\n   ${describeTapered(generateTapered(seed))}`);
  }
  console.log(`tapered tools: ${COUNT} cases, ${failures.length} failed, the adapter refused ${rejected.count}`);
  expect(failures.slice(0, 15)).toEqual([]);
  // a refusal by an error is safe, but has to be rare
  expect(rejected.count).toBeLessThanOrEqual(Math.ceil(COUNT / 1000));
});
