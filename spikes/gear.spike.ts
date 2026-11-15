// Spike ozubení pro D35 (docs/decisions.md, Spike před implementací ozubení).
// Běží přes skutečné adaptéry: buildPrism enginu, jádro Manifold s čištěním, solver planegcs.
// Spuštění z kořene repozitáře: npx vitest run --config spikes/vitest.config.ts
import { test } from 'vitest';
import { createEngine, emptySketch } from '../packages/engine/src/index';
import type { Command, Engine, Solid } from '../packages/engine/src/index';
import type { Region } from '../packages/engine/src/sketch';
import { buildPrism } from '../packages/engine/src/recompute/tool-prism';
import { volumeOf } from '../packages/engine/src/solid';
import { createManifoldKernel } from '../packages/kernel-manifold/src/index';
import { createPlanegcsSolver } from '../packages/solver-planegcs/src/index';

const kernel = await createManifoldKernel();
const solver = await createPlanegcsSolver();

const TOL = 0.01; // chordTolerance dokumentu
const ALPHA = (20 * Math.PI) / 180;
const inv = (a: number) => Math.tan(a) - a;
type P = [number, number];

// ---------------------------------------------------------------- generátor profilu

interface Gear {
  m: number;
  z: number;
  internal: boolean; // true = tvar, který se vyřízne z tělesa, aby vzniklo korunové kolo
  backlash: number; // úbytek tloušťky zubu tohoto kola na roztečné kružnici (mm, po oblouku)
  rotation: number; // úhel osy jednoho zubu (u vnitřního: osy zubové mezery korunového kola)
  center: P;
}

interface Built {
  loop: P[]; // proti směru hodin
  r: number;
  rb: number;
  rTip: number; // vnější poloměr profilu
  rRoot: number;
  half: (rho: number) => number; // poloviční úhel zubu profilu na poloměru rho
}

function arcSteps(sweep: number, radius: number): number {
  const step = Math.min(2 * Math.acos(1 - Math.min(TOL / radius, 1)), Math.PI / 4);
  return Math.max(1, Math.ceil(sweep / step - 1e-9));
}

function buildGear(g: Gear): Built {
  const r = (g.m * g.z) / 2;
  const rb = r * Math.cos(ALPHA);
  // Vnější kolo: hlava r + m, pata r − 1,25 m. Vnitřní profil (nástroj): jeho „zub" je zubová
  // mezera korunového kola, sahá k patní kružnici koruny r + 1,25 m a začíná na její hlavové r − m.
  const rTip = g.internal ? r + 1.25 * g.m : r + g.m;
  const rRoot = g.internal ? r - g.m : r - 1.25 * g.m;
  // Poloviční úhel na roztečné kružnici: vnější zub je o vůli tenčí, mezera koruny o vůli širší.
  const psi = Math.PI / (2 * g.z) + ((g.internal ? 1 : -1) * g.backlash) / (2 * r);
  const half = (rho: number) => psi + inv(ALPHA) - inv(Math.acos(Math.min(1, rb / rho)));
  if (half(rTip) <= 0) throw new Error(`špičatý zub: z=${g.z}`);

  // Evolventa od max(rb, rRoot) po rTip; dělení podle tolerance (rovnoměrně v délce oblouku).
  const rStart = Math.max(rb, rRoot);
  const tOf = (rho: number) => Math.sqrt(Math.max(0, (rho / rb) ** 2 - 1)); // úhel odvalení
  const [t0, t1] = [tOf(rStart), tOf(rTip)];
  const at = (t: number): P => {
    const rho = rb * Math.sqrt(1 + t * t);
    return [rho, half(rho)];
  };
  const polar = ([rho, a]: P): P => [rho * Math.cos(a), rho * Math.sin(a)];
  let n = 1;
  for (; n < 200; n++) {
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const ta = Math.sqrt(t0 * t0 + ((t1 * t1 - t0 * t0) * k) / n);
      const tb = Math.sqrt(t0 * t0 + ((t1 * t1 - t0 * t0) * (k + 1)) / n);
      const [a, b, mid] = [polar(at(ta)), polar(at(tb)), polar(at(Math.sqrt((ta * ta + tb * tb) / 2)))];
      worst = Math.max(worst, Math.hypot(mid[0] - (a[0] + b[0]) / 2, mid[1] - (a[1] + b[1]) / 2));
    }
    if (worst <= TOL) break;
  }
  const flank: P[] = []; // [rho, poloviční úhel], od paty k hlavě
  for (let k = 0; k <= n; k++) flank.push(at(Math.sqrt(t0 * t0 + ((t1 * t1 - t0 * t0) * k) / n)));
  if (rRoot < rb) flank.unshift([rRoot, half(rb)]); // pod základní kružnicí radiálně

  const loop: P[] = [];
  const push = (rho: number, angle: number) => loop.push([g.center[0] + rho * Math.cos(angle), g.center[1] + rho * Math.sin(angle)]);
  const pitch = (2 * Math.PI) / g.z;
  for (let k = 0; k < g.z; k++) {
    const axis = g.rotation + k * pitch;
    for (const [rho, a] of flank) push(rho, axis - a); // pravý bok nahoru
    const tipHalf = flank[flank.length - 1][1];
    const tipN = arcSteps(2 * tipHalf, rTip);
    for (let i = 1; i < tipN; i++) push(rTip, axis - tipHalf + (2 * tipHalf * i) / tipN);
    for (const [rho, a] of [...flank].reverse()) push(rho, axis + a); // levý bok dolů
    const rootHalf = flank[0][1];
    const sweep = pitch - 2 * rootHalf;
    const rootN = arcSteps(sweep, rRoot);
    for (let i = 1; i < rootN; i++) push(rRoot, axis + rootHalf + (sweep * i) / rootN);
  }
  return { loop, r, rb, rTip, rRoot, half };
}

// ---------------------------------------------------------------- natočení ze záběru

const frac = (x: number) => x - Math.floor(x);
// Fáze kola ve směru `angle` od jeho středu: 0 = v tom směru leží osa zubu profilu.
const phase = (g: Pick<Gear, 'z' | 'rotation'>, angle: number) => frac(((angle - g.rotation) * g.z) / (2 * Math.PI));

// Natočení kola `b` v záběru s kolem `a` (obě se středy; `b` smí být vnitřní profil).
function meshRotation(a: Gear, b: Omit<Gear, 'rotation'>): number {
  if (!b.internal) {
    const beta = Math.atan2(b.center[1] - a.center[1], b.center[0] - a.center[0]); // směr a → b
    // Proti ose zubu `a` leží osa mezery `b`: fáze obou kol v roztečném bodě dávají dohromady 1/2.
    const pb = frac(0.5 - phase(a, beta));
    return beta + Math.PI - (pb * 2 * Math.PI) / b.z;
  }
  // Vnitřní záběr: roztečný bod leží od obou středů stejným směrem a fáze jsou shodné
  // (osa zubu satelitu míří do osy zubové mezery koruny).
  const beta = Math.atan2(a.center[1] - b.center[1], a.center[0] - b.center[0]); // směr střed koruny → satelit
  return beta - (phase(a, beta) * 2 * Math.PI) / b.z;
}

// ---------------------------------------------------------------- rovinné měření

const inside = (p: P, poly: P[]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const toBoundary = (p: P, poly: P[]): number => {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[j], poly[i]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
};

// Největší průnik a nejmenší mezera materiálu dvou profilů v okolí roztečného bodu.
// `ringTool`: druhý profil je nástroj koruny; materiál koruny je vně nástroje.
function contact(a: P[], b: P[], around: P, reach: number, ringTool: boolean): { pen: number; gap: number } {
  const near = (poly: P[]) => poly.filter((p) => Math.hypot(p[0] - around[0], p[1] - around[1]) < reach);
  let [pen, gap] = [0, Infinity];
  const probe = (points: P[], other: P[], inMaterial: (p: P) => boolean) => {
    for (const p of points) {
      const d = toBoundary(p, other);
      if (inMaterial(p)) pen = Math.max(pen, d);
      else gap = Math.min(gap, d);
    }
  };
  probe(near(a), b, (p) => inside(p, b) !== ringTool);
  probe(near(b), a, (p) => inside(p, a));
  return { pen, gap };
}

// Otáčí dvojicí v převodovém poměru přes jednu rozteč a měří styk.
function sweep(a: Gear, b: Gear, steps = 48): { pen: number; gapMin: number; gapMax: number } {
  const ra = (a.m * a.z) / 2;
  const dir = Math.atan2(b.center[1] - a.center[1], b.center[0] - a.center[0]);
  // roztečný bod: u vnějšího záběru mezi středy, u vnitřního za středem satelitu směrem od koruny
  const pitchPoint: P = b.internal ? [a.center[0] - ra * Math.cos(dir), a.center[1] - ra * Math.sin(dir)] : [a.center[0] + ra * Math.cos(dir), a.center[1] + ra * Math.sin(dir)];
  let [pen, gapMin, gapMax] = [0, Infinity, 0];
  for (let s = 0; s < steps; s++) {
    const turn = ((2 * Math.PI) / a.z) * (s / steps);
    const A = buildGear({ ...a, rotation: a.rotation + turn }).loop;
    const B = buildGear({ ...b, rotation: b.rotation + (b.internal ? 1 : -1) * turn * (a.z / b.z) }).loop;
    const c = contact(A, B, pitchPoint, 3.5 * a.m, b.internal);
    pen = Math.max(pen, c.pen);
    gapMin = Math.min(gapMin, c.gap);
    gapMax = Math.max(gapMax, c.gap);
  }
  return { pen, gapMin, gapMax };
}

// Tloušťka zubu na roztečné kružnici změřená z lomené čáry (po oblouku).
function thicknessAtPitch(g: Gear): number {
  const { loop, r } = buildGear({ ...g, rotation: 0, center: [0, 0] });
  const angles: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const [p, q] = [loop[i], loop[(i + 1) % loop.length]];
    const [rp, rq] = [Math.hypot(...p), Math.hypot(...q)];
    if (rp < r === rq < r) continue;
    const t = (r - rp) / (rq - rp);
    angles.push(Math.atan2(p[1] + t * (q[1] - p[1]), p[0] + t * (q[0] - p[0])));
  }
  const first = angles.filter((a) => Math.abs(a) < Math.PI / g.z).sort((x, y) => x - y);
  return (first[1] - first[0]) * r;
}

// ---------------------------------------------------------------- tělesa přes skutečný adaptér

let nextFace = 0;
const FRAME = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
function prism(loop: P[], z0: number, z1: number, holes: P[][] = []): Solid {
  const tag = `f${nextFace}`;
  const toLoop = (points: P[], name: string) => ({ xy: points.flat(), keys: points.map((_, i) => `${tag}/${name}/${i}`), curves: points.map(() => name) });
  const region: Region = { ref: { outerLoop: ['side'] }, outer: toLoop(loop, 'side'), holes: holes.map((h, i) => toLoop([...h].reverse(), `hole${i}`)) };
  const frame = { ...FRAME, origin: [0, 0, z0] as [number, number, number] };
  const built = buildPrism(tag, [region], frame, [0, z1 - z0], (curve) => ({ name: { role: 'side', curve }, shape: { type: 'round', center: [0, 0], radius: 1 } }), nextFace, kernel);
  nextFace += built.faces.length;
  return built.solid;
}
const circle = (cx: number, cy: number, radius: number): P[] => {
  const n = arcSteps(2 * Math.PI, radius);
  return Array.from({ length: n }, (_, i): P => [cx + radius * Math.cos((2 * Math.PI * i) / n), cy + radius * Math.sin((2 * Math.PI * i) / n)]);
};
const polygon = (cx: number, cy: number, acrossFlats: number, n = 6): P[] => {
  const radius = acrossFlats / 2 / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, i): P => [cx + radius * Math.cos((2 * Math.PI * i) / n), cy + radius * Math.sin((2 * Math.PI * i) / n)]);
};
const tris = (s: Solid) => s.triangles.length / 3;
function timed<T>(run: () => T): { value?: T; ms: number; error?: string } {
  const start = performance.now();
  try {
    const value = run();
    return { value, ms: performance.now() - start };
  } catch (error) {
    return { ms: performance.now() - start, error: error instanceof Error ? error.message : String(error) };
  }
}
const overlap = (a: Solid, b: Solid) => {
  const result = timed(() => kernel.boolean('intersection', a, b));
  return { volume: result.value ? volumeOf(result.value) : NaN, ms: result.ms, error: result.error };
};
const fmt = (x: number, digits = 4) => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
const log = (...lines: string[]) => console.log(lines.join('\n'));

// ---------------------------------------------------------------- sestavy ze scénáře 9

interface Train {
  name: string;
  m: number;
  zs: number;
  zp: number;
  zr: number;
}
const TRAINS: Train[] = [
  { name: 'převod 5 (18/27/72)', m: 0.9, zs: 18, zp: 27, zr: 72 },
  { name: 'převod 4 (24/24/72)', m: 0.9, zs: 24, zp: 24, zr: 72 },
  { name: 'převod 6 (18/36/90)', m: 0.9, zs: 18, zp: 36, zr: 90 },
];
function gears(t: Train, backlash: number, planetAngle = 0) {
  const a = (t.m * (t.zs + t.zp)) / 2;
  const sun: Gear = { m: t.m, z: t.zs, internal: false, backlash, rotation: 0.1234, center: [0, 0] };
  const planetBase = { m: t.m, z: t.zp, internal: false, backlash, center: [a * Math.cos(planetAngle), a * Math.sin(planetAngle)] as P };
  const planet: Gear = { ...planetBase, rotation: meshRotation(sun, planetBase) };
  const ringBase = { m: t.m, z: t.zr, internal: true, backlash, center: [0, 0] as P };
  const ring: Gear = { ...ringBase, rotation: meshRotation(planet, ringBase) };
  return { sun, planet, ring, a };
}

test('1 profil: rozměry a styk boků ve 2D', () => {
  const lines: string[] = ['', '== 1. Profil a záběr ve 2D (float64, lomená čára podle chordTolerance 0,01) =='];
  for (const z of [18, 24, 27, 36]) {
    for (const b of [0, 0.1]) {
      const g: Gear = { m: 0.9, z, internal: false, backlash: b, rotation: 0, center: [0, 0] };
      lines.push(`tloušťka zubu z=${z} vůle=${b}: změřeno ${fmt(thicknessAtPitch(g))}, očekáváno ${fmt((Math.PI * 0.9) / 2 - b)}, bodů ve smyčce ${buildGear(g).loop.length}`);
    }
  }
  for (const t of TRAINS) {
    for (const b of [0, 0.05, 0.1, -0.05]) {
      const { sun, planet, ring } = gears(t, b);
      const sp = sweep(sun, planet);
      const pr = sweep(planet, ring);
      const expected = b * Math.cos(ALPHA); // normálová mezera na každé straně: (b + b) / 2 · cos α
      lines.push(
        `${t.name} vůle=${b}: slunce–satelit průnik ${fmt(sp.pen)} mezera ${fmt(sp.gapMin)}..${fmt(sp.gapMax)} | satelit–koruna průnik ${fmt(pr.pen)} mezera ${fmt(pr.gapMin)}..${fmt(pr.gapMax)} | očekávaná mezera ${fmt(Math.max(0, expected))}`,
      );
    }
  }
  // kontrola: zuby o 3 % menšího modulu na stejných osách nezabírají (mezera je velká)
  const t = TRAINS[0];
  const { sun, planet } = gears(t, 0);
  const small = sweep({ ...sun, m: t.m * 0.97 }, { ...planet, m: t.m * 0.97 });
  lines.push(`kontrolní případ, zuby menší o 3 %: průnik ${fmt(small.pen)} mezera ${fmt(small.gapMin)}..${fmt(small.gapMax)} (test styku to musí poznat)`);
  // kolo s 15 zuby (převod 6 s malým centrálním kolem)
  // málo zubů: pata pod základní kružnicí je radiální úsečka; naráží do ní hlava protikola?
  for (const few of [
    { name: '15/30/75', m: 0.9, zs: 15, zp: 30, zr: 75 },
    { name: '12/24/60', m: 0.9, zs: 12, zp: 24, zr: 60 },
    { name: '10/20/50', m: 0.9, zs: 10, zp: 20, zr: 50 },
  ] as Train[]) {
    for (const b of [0, 0.05]) {
      const g = gears(few, b);
      const s = sweep(g.sun, g.planet);
      const r = sweep(g.planet, g.ring);
      lines.push(`málo zubů ${few.name} vůle=${b}: slunce–satelit průnik ${fmt(s.pen)} mezera ${fmt(s.gapMin)}..${fmt(s.gapMax)} | satelit–koruna průnik ${fmt(r.pen)} mezera ${fmt(r.gapMin)}..${fmt(r.gapMax)}`);
    }
  }
  log(...lines);
});

test('2 tělesa: průnik kol v záběru přes adaptér jádra', () => {
  const lines: string[] = ['', '== 2. Objem průniku těles (kernel.boolean intersection přes adaptér), šířka kol 8 mm =='];
  for (const t of TRAINS) {
    for (const b of [0, 0.05, 0.1, -0.05]) {
      const { sun, planet, ring } = gears(t, b);
      const sunSolid = prism(buildGear(sun).loop, 0, 8);
      const planetSolid = prism(buildGear(planet).loop, 0, 8);
      const blank = prism(circle(0, 0, 55), 0, 8);
      const cut = timed(() => kernel.boolean('difference', blank, prism(buildGear(ring).loop, -1, 9)));
      const sp = overlap(sunSolid, planetSolid);
      const pr = cut.value ? overlap(cut.value, planetSolid) : { volume: NaN, ms: 0, error: cut.error };
      lines.push(
        `${t.name} vůle=${b}: slunce∩satelit ${fmt(sp.volume, 5)} mm³ (${fmt(sp.ms, 0)} ms)${sp.error ? ' CHYBA ' + sp.error : ''} | koruna∩satelit ${fmt(pr.volume, 5)} mm³ (${fmt(pr.ms, 0)} ms)${pr.error ? ' CHYBA ' + pr.error : ''} | výřez koruny ${fmt(cut.ms, 0)} ms, ${cut.value ? tris(cut.value) : '-'} trojúhelníků`,
      );
    }
  }
  // tři satelity jako tuhá otočení o 120°
  for (const t of TRAINS) {
    const { sun, planet, ring, a } = gears(t, 0.05);
    const sunSolid = prism(buildGear(sun).loop, 0, 8);
    const ringSolid = kernel.boolean('difference', prism(circle(0, 0, 55), 0, 8), prism(buildGear(ring).loop, -1, 9));
    const volumes: string[] = [];
    for (const k of [1, 2]) {
      const turn = (k * 2 * Math.PI) / 3;
      const copy: Gear = { ...planet, center: [a * Math.cos(turn), a * Math.sin(turn)], rotation: planet.rotation + turn };
      const solid = prism(buildGear(copy).loop, 0, 8);
      volumes.push(`kopie ${k}: se sluncem ${fmt(overlap(sunSolid, solid).volume, 5)}, s korunou ${fmt(overlap(ringSolid, solid).volume, 5)}`);
    }
    lines.push(`${t.name} vůle=0.05, tuhé kopie satelitu: ${volumes.join('; ')}`);
  }
  // styk bez průniku: lícující víka, čep v díře s vůlí, těleso na tělese
  const a = prism(circle(0, 0, 20), 0, 8);
  const b = prism(circle(0, 0, 15), 8, 12);
  const pin = prism(circle(10, 0, 2.5), 0, 12);
  const holed = prism(circle(0, 0, 20), 0, 8, [circle(10, 0, 2.65)]);
  const same = prism(circle(10, 0, 2.65), 0, 12);
  for (const [name, x, y] of [
    ['válec na válci (lícující víka)', a, b],
    ['čep Ø5 v díře Ø5,3', holed, pin],
    ['čep Ø5,3 v díře Ø5,3 (shodné válce)', holed, same],
    ['válec ve válci (skutečný průnik, čekáno ' + fmt(Math.PI * 2.5 * 2.5 * 8, 2) + ')', a, pin],
  ] as [string, Solid, Solid][]) {
    const o = overlap(x, y);
    lines.push(`${name}: ${fmt(o.volume, 5)} mm³ (${fmt(o.ms, 0)} ms)${o.error ? ' CHYBA ' + o.error : ''}`);
  }
  log(...lines);
});

test('3 pouzdro: čas booleanů přes adaptér', () => {
  const lines: string[] = ['', '== 3. Pouzdro ze scénáře 9 přes adaptér jádra =='];
  const t = TRAINS[0];
  const { ring } = gears(t, 0.05);
  const step = <T extends Solid>(name: string, run: () => T, body?: Solid): Solid => {
    const result = timed(run);
    lines.push(`${name}: ${fmt(result.ms, 0)} ms${result.value ? `, ${tris(result.value)} trojúhelníků, objem ${fmt(volumeOf(result.value), 1)}` : ''}${result.error ? ' CHYBA ' + result.error : ''}`);
    return result.value ?? (body as Solid);
  };
  let body = step('plný válec Ø110 × 44', () => prism(circle(0, 0, 55), 0, 44));
  body = step('vybrání pro motor Ø92 do hloubky 28', () => kernel.boolean('difference', body, prism(circle(0, 0, 46), -1, 28)), body);
  const tool = step('nástroj koruny (72 zubů)', () => prism(buildGear(ring).loop, -1, 45));
  body = step('výřez koruny skrz vše', () => kernel.boolean('difference', body, tool), body);
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    const [x, y] = [50.5 * Math.cos(angle), 50.5 * Math.sin(angle)];
    body = step(`díra M3 č. ${k + 1}`, () => kernel.boolean('difference', body, prism(circle(x, y, 1.7), -1, 45)), body);
    body = step(`zapuštění matice č. ${k + 1}`, () => kernel.boolean('difference', body, prism(polygon(x, y, 5.6), 41.5, 45)), body);
  }
  // varianta, před kterou varuje review: předvrtaná díra přesně na hlavové kružnici koruny
  const bored = kernel.boolean('difference', prism(circle(0, 0, 55), 0, 16), prism(circle(0, 0, 31.5), -1, 17));
  step('koruna do díry předvrtané přesně na Ø63', () => kernel.boolean('difference', bored, prism(buildGear(ring).loop, -1, 17)));
  const boredSmaller = kernel.boolean('difference', prism(circle(0, 0, 55), 0, 16), prism(circle(0, 0, 25), -1, 17));
  step('koruna do díry Ø50 (menší než hlavová kružnice)', () => kernel.boolean('difference', boredSmaller, prism(buildGear(ring).loop, -1, 17)));
  // centrální kolo: příruba, ozubení jako přidání, čtyři díry
  let sun = step('příruba centrálního kola Ø40 × 4', () => prism(circle(0, 0, 20), 0, 4));
  sun = step('ozubení centrálního kola jako přidání', () => kernel.boolean('union', sun, prism(buildGear({ m: 0.9, z: 18, internal: false, backlash: 0.05, rotation: 0, center: [0, 0] }).loop, 4, 18)), sun);
  for (let k = 0; k < 4; k++) {
    const angle = Math.PI / 4 + (k * Math.PI) / 2;
    sun = step(`díra M3 v přírubě č. ${k + 1}`, () => kernel.boolean('difference', sun, prism(circle(15.5 * Math.cos(angle), 15.5 * Math.sin(angle), 1.7), -1, 19)), sun);
  }
  log(...lines);
});

test('4 skica: tečnost roztečných kružnic a platnost profilu', () => {
  const lines: string[] = ['', '== 4. Skica roztečných kružnic přes engine a planegcs =='];
  const run = (engine: Engine, ...commands: Command[]) => {
    for (const command of commands) {
      const result = engine.execute(command);
      if (!result.ok) throw new Error(`${command.type}: ${result.error.message}`);
    }
    return engine.getState().evaluation.features.sk;
  };
  for (const construction of [false, true]) {
    const engine = createEngine({ solver, kernel });
    const circleOf = (center: string) => ({ type: 'circle' as const, center, ...(construction ? { construction: true } : {}) });
    const dim = (id: string, shape: object, value: number): Command => ({ type: 'addConstraint', sketch: 'sk', id, constraint: { ...shape, value, driving: true } as never });
    run(
      engine,
      { type: 'addFeature', feature: emptySketch('sk', 'sk', { kind: 'base', plane: 'XY' }) },
      { type: 'addPoint', sketch: 'sk', id: 'cs', x: 0.3, y: -0.2 },
      { type: 'addPoint', sketch: 'sk', id: 'cp', x: 19, y: 1.5 },
      { type: 'addCurve', sketch: 'sk', id: 's', curve: circleOf('cs'), radius: 7 },
      { type: 'addCurve', sketch: 'sk', id: 'p', curve: circleOf('cp'), radius: 11 },
      { type: 'addCurve', sketch: 'sk', id: 'r', curve: circleOf('cs'), radius: 30 },
      { type: 'addConstraint', sketch: 'sk', id: 'c0', constraint: { type: 'coincident', a: 'origin', b: 'cs' } },
      { type: 'addConstraint', sketch: 'sk', id: 'c1', constraint: { type: 'tangent', a: 's', b: 'p' } },
      dim('dy', { type: 'verticalDistance', a: 'origin', b: 'cp' }, 0),
      dim('ds', { type: 'diameter', curve: 's' }, 16.2),
      dim('dp', { type: 'diameter', curve: 'p' }, 24.3),
      dim('dr', { type: 'diameter', curve: 'r' }, 64.8),
    );
    const report = (label: string) => {
      const f = engine.getState().evaluation.features.sk;
      const s = f.sketch!;
      lines.push(`${construction ? 'konstrukční' : 'běžné'} kružnice, ${label}: stav ${f.status}, střed satelitu x=${fmt(s.points.cp.x)} y=${fmt(s.points.cp.y)}, volnost ${s.degreesOfFreedom}, profil platný ${s.valid}, oblastí ${s.regions.length}`);
    };
    report('18/27/72 (čekáno x=20,25)');
    const set = (id: string, value: number): Command => ({ type: 'setConstraintValue', sketch: 'sk', id, value });
    run(engine, { type: 'batch', commands: [set('ds', 21.6), set('dp', 21.6)] });
    report('24/24/72 dávkou (čekáno x=21,6)');
    run(engine, { type: 'batch', commands: [set('ds', 16.2), set('dp', 24.3)] });
    report('zpět 18/27/72 (čekáno x=20,25)');
    run(engine, set('ds', 21.6));
    report('jen slunce 24 (čekáno x=22,95)');
    run(engine, set('dp', 21.6));
    report('pak satelit 24 (čekáno x=21,6)');
    run(engine, { type: 'batch', commands: [set('ds', 16.2), set('dp', 32.4), set('dr', 81)] });
    report('18/36/90 (čekáno x=24,3)');
    run(engine, { type: 'batch', commands: [set('ds', 2), set('dp', 60)] });
    report('krajní skok: slunce Ø2, satelit Ø60 (vnější tečnost: x=31)');
  }
  log(...lines);
});
