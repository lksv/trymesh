// Náhodné testy adaptéru. Počet případů a první seed jdou změnit proměnnými prostředí:
//   FUZZ_COUNT=30000 FUZZ_FIRST=1 pnpm test packages/kernel-manifold/test/fuzz.test.ts
import { expect, it } from 'vitest';
import { check, describeOps, generate } from './fuzz';

const COUNT = Number(process.env.FUZZ_COUNT ?? 1000);
const FIRST = Number(process.env.FUZZ_FIRST ?? 1);

it(`náhodné posloupnosti booleanů: ${COUNT} případů od seedu ${FIRST}`, { timeout: 60_000 + COUNT * 50 }, () => {
  const failures: string[] = [];
  const rejected = { strict: 0, loose: 0 };
  for (let seed = FIRST; seed < FIRST + COUNT; seed++) {
    const problems = check(seed, rejected);
    if (problems.length) failures.push(`seed ${seed}: ${problems.slice(0, 4).join('; ')}\n   ${describeOps(generate(seed).ops)}`);
  }
  console.log(`náhodné testy: ${COUNT} případů, ${failures.length} selhalo, adaptér odmítl ${rejected.strict} v návrhovém rozsahu a ${rejected.loose} mimo něj (odchylka boku 3e-5)`);
  expect(failures.slice(0, 15)).toEqual([]);
  // Odmítnutí chybou je bezpečné, ale má být vzácné.
  expect(rejected.strict).toBeLessThanOrEqual(Math.ceil(COUNT / 10000));
  expect(rejected.loose).toBeLessThanOrEqual(Math.ceil(COUNT / 200));
});

// Případy, které dřív selhaly a vedly k opravě adaptéru; hlídají se zvlášť, aby je změna výchozího
// rozsahu seedů nevyřadila.
it.each([2004, 3097, 3670, 5310, 5790, 13665, 15417, 18471, 20188, 20619, 23288, 24919, 25304, 27299])('dříve selhávající seed %i', (seed) => {
  expect(check(seed)).toEqual([]);
});
