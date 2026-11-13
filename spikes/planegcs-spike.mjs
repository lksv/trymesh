// Spike: ověření předpokladů o planegcs (viz docs/architecture.md, Předpoklady k ověření).
// Spuštění: node planegcs-spike.mjs
import { init_planegcs_module, GcsWrapper, SolveStatus } from '@salusoft89/planegcs';

const mod = await init_planegcs_module();
const results = [];
const STATUS = Object.fromEntries(Object.entries(SolveStatus).map(([k, v]) => [v, k]));

function solve(primitives) {
  const gcs = new GcsWrapper(new mod.GcsSystem());
  try {
    gcs.push_primitives_and_params(structuredClone(primitives));
    const status = gcs.solve();
    gcs.apply_solution();
    return {
      status: STATUS[status],
      dof: gcs.gcs.dof(),
      conflicting: gcs.get_gcs_conflicting_constraints(),
      redundant: gcs.get_gcs_redundant_constraints(),
      prims: gcs.sketch_index.get_primitives(),
    };
  } finally {
    gcs.destroy_gcs_module();
  }
}
const pt = (r, id) => r.prims.find((p) => p.id === id);
const fmt = (p) => `(${p.x.toFixed(6)}, ${p.y.toFixed(6)})`;
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'OK    ' : 'SELHAL'} ${name}${detail ? ' — ' + detail : ''}`); };

// Obdélník ukotvený k pevnému počátku. Polohy jsou záměrně nepřesné (uživatel kreslí od ruky).
const rectBase = [
  { id: 'origin', type: 'point', x: 0, y: 0, fixed: true },
  { id: 'p1', type: 'point', x: 1, y: 2, fixed: false },
  { id: 'p2', type: 'point', x: 37, y: -1, fixed: false },
  { id: 'p3', type: 'point', x: 41, y: 26, fixed: false },
  { id: 'p4', type: 'point', x: -2, y: 31, fixed: false },
  { id: 'l1', type: 'line', p1_id: 'p1', p2_id: 'p2' },
  { id: 'l2', type: 'line', p1_id: 'p2', p2_id: 'p3' },
  { id: 'l3', type: 'line', p1_id: 'p3', p2_id: 'p4' },
  { id: 'l4', type: 'line', p1_id: 'p4', p2_id: 'p1' },
  { id: 'c_anchor', type: 'p2p_coincident', p1_id: 'p1', p2_id: 'origin' },
  { id: 'c_h1', type: 'horizontal_l', l_id: 'l1' },
  { id: 'c_v2', type: 'vertical_l', l_id: 'l2' },
  { id: 'c_h3', type: 'horizontal_l', l_id: 'l3' },
  { id: 'c_v4', type: 'vertical_l', l_id: 'l4' },
  { id: 'd_w', type: 'p2p_distance', p1_id: 'p1', p2_id: 'p2', distance: 40 },
];
const dHeight = { id: 'd_h', type: 'p2p_distance', p1_id: 'p2', p2_id: 'p3', distance: 30 };

console.log('--- P1: plně určený obdélník');
{
  const r = solve([...rectBase, dHeight]);
  console.log(`   status ${r.status}, dof ${r.dof}, p3 ${fmt(pt(r, 'p3'))}, origin ${fmt(pt(r, 'origin'))}`);
  check('P1 vyřešeno, dof 0, p3 = (40, 30)', r.status === 'Success' && r.dof === 0 && Math.abs(pt(r, 'p3').x - 40) < 1e-8 && Math.abs(pt(r, 'p3').y - 30) < 1e-8);
  check('P1 pevný bod origin se nepohnul', pt(r, 'origin').x === 0 && pt(r, 'origin').y === 0);
}

console.log('--- P2: podurčený obdélník (chybí výška)');
{
  const r = solve(rectBase);
  console.log(`   status ${r.status}, dof ${r.dof}, p3 ${fmt(pt(r, 'p3'))}`);
  check('P2 dof 1', r.status === 'Success' && r.dof === 1);
}

console.log('--- P3: konfliktní a nadbytečná kóta');
{
  const conflict = solve([...rectBase, dHeight, { id: 'd_w2', type: 'p2p_distance', p1_id: 'p4', p2_id: 'p3', distance: 50 }]);
  console.log(`   konflikt: status ${conflict.status}, dof ${conflict.dof}, conflicting ${JSON.stringify(conflict.conflicting)}, redundant ${JSON.stringify(conflict.redundant)}`);
  check('P3 konflikt je nahlášen s ID vazeb', conflict.conflicting.length > 0 && conflict.conflicting.includes('d_w2'));
  const redundant = solve([...rectBase, dHeight, { id: 'd_w2', type: 'p2p_distance', p1_id: 'p4', p2_id: 'p3', distance: 40 }]);
  console.log(`   nadbytečná: status ${redundant.status}, dof ${redundant.dof}, conflicting ${JSON.stringify(redundant.conflicting)}, redundant ${JSON.stringify(redundant.redundant)}`);
  check('P3 nadbytečná vazba je nahlášena s ID', redundant.redundant.includes('d_w2') && redundant.conflicting.length === 0);
}

console.log('--- P4: tažení bodu p3 (dočasné vazby), 30 kroků');
{
  let prims = solve(rectBase).prims;
  let ok = true, maxJump = 0, last = pt({ prims }, 'p3');
  for (let i = 1; i <= 30; i++) {
    const target = { x: 40 + i * 1.5, y: 26 + i * 2 };       // táhne šikmo; x je kótou 40 zakázáno
    const r = solve([
      ...prims,
      { id: 'drag_x', type: 'coordinate_x', p_id: 'p3', x: target.x, temporary: true },
      { id: 'drag_y', type: 'coordinate_y', p_id: 'p3', y: target.y, temporary: true },
    ]);
    const p3 = pt(r, 'p3'), p2 = pt(r, 'p2'), p4 = pt(r, 'p4');
    const holds = Math.abs(p3.x - 40) < 1e-6 && Math.abs(p2.x - 40) < 1e-6 && Math.abs(p4.y - p3.y) < 1e-6 && Math.abs(p3.y - target.y) < 1e-6;
    if (!holds || r.dof !== 1) { ok = false; console.log(`   krok ${i}: status ${r.status}, dof ${r.dof}, p3 ${fmt(p3)}, cíl y ${target.y}`); }
    maxJump = Math.max(maxJump, Math.abs(p3.y - last.y));
    last = p3;
    prims = r.prims.filter((p) => !p.id.startsWith('drag_'));
  }
  console.log(`   konec: p3 ${fmt(last)}, největší skok y mezi kroky ${maxJump.toFixed(3)}`);
  check('P4 tažení drží vazby, sleduje cíl ve volném směru, dof se nemění', ok);
}

console.log('--- P4b: tažení bezstavově – každý krok začíná z uložených poloh (tak, jak to volá preview)');
{
  // Podurčený tvar s víc volnostmi: obdélník bez výšky + volná kružnice tečná k horní hraně.
  const scene = [
    ...rectBase,
    { id: 'm', type: 'point', x: 20, y: 40, fixed: false },
    { id: 'circ', type: 'circle', c_id: 'm', radius: 6 },
    { id: 'c_tan', type: 'tangent_lc', l_id: 'l3', c_id: 'circ' },
    { id: 'd_r', type: 'circle_radius', c_id: 'circ', radius: 6 },
  ];
  const stored = solve(scene).prims;
  const dofStored = solve(stored).dof;
  for (const [name, pid, path] of [
    ['roh p3 šikmo pryč', 'p3', (i) => ({ x: 40 + i * 3, y: 26 + i * 4 })],
    ['roh p3 dolů přes spodní hranu (překlopení)', 'p3', (i) => ({ x: 40, y: 26 - i * 3 })],
    ['střed kružnice daleko do strany a dolů', 'm', (i) => ({ x: 20 + i * 5, y: 32 - i * 3 })],
  ]) {
    let ok = true, prev = null, maxStep = 0, worst = '';
    for (let i = 1; i <= 30; i++) {
      const target = path(i);
      const r = solve([
        ...stored,
        { id: 'drag_x', type: 'coordinate_x', p_id: pid, x: target.x, temporary: true },
        { id: 'drag_y', type: 'coordinate_y', p_id: pid, y: target.y, temporary: true },
      ]);
      const g = (id) => pt(r, id);
      const m = g('m'), rad = r.prims.find((p) => p.id === 'circ').radius;
      const holds = Math.abs(g('p1').x) < 1e-6 && Math.abs(g('p1').y) < 1e-6 && Math.abs(g('p2').x - 40) < 1e-6 && Math.abs(g('p2').y) < 1e-6
        && Math.abs(g('p3').x - 40) < 1e-6 && Math.abs(g('p4').x) < 1e-6 && Math.abs(g('p3').y - g('p4').y) < 1e-6
        && Math.abs(Math.abs(m.y - g('p3').y) - 6) < 1e-6 && Math.abs(rad - 6) < 1e-6;
      const cur = [g('p3').y, m.x, m.y];
      if (prev) { const step = Math.max(...cur.map((v, k) => Math.abs(v - prev[k]))); if (step > maxStep) { maxStep = step; worst = `krok ${i}`; } }
      prev = cur;
      if (!holds || r.dof !== dofStored || (r.status !== 'Success' && r.status !== 'Converged')) { ok = false; console.log(`   ${name}, krok ${i}: status ${r.status}, dof ${r.dof}, p3 ${fmt(g('p3'))}, m ${fmt(m)}`); break; }
    }
    console.log(`   ${name}: největší změna mezi sousedními kroky ${maxStep.toFixed(3)} (${worst}), konec p3.y ${prev[0].toFixed(3)}, m (${prev[1].toFixed(3)}, ${prev[2].toFixed(3)})`);
    check(`P4b ${name}: vazby drží, bez skoků`, ok && maxStep < 8);
  }
}

console.log('--- P5: idempotence a determinismus');
{
  const a = solve([...rectBase, dHeight]);
  const b = solve([...rectBase, dHeight]);
  check('P5 stejný vstup → bitově stejný výstup', JSON.stringify(a.prims) === JSON.stringify(b.prims));
  const again = solve(a.prims);
  const same = JSON.stringify(again.prims) === JSON.stringify(a.prims);
  let maxDiff = 0;
  for (const p of a.prims) if (p.type === 'point') { const q = pt(again, p.id); maxDiff = Math.max(maxDiff, Math.abs(p.x - q.x), Math.abs(p.y - q.y)); }
  check('P5 splněný vstup se vrátí beze změny (bitově)', same, `max. rozdíl ${maxDiff.toExponential(2)}`);
  const u = solve(rectBase);
  const u2 = solve(u.prims);
  let maxDiffU = 0;
  for (const p of u.prims) if (p.type === 'point') { const q = pt(u2, p.id); maxDiffU = Math.max(maxDiffU, Math.abs(p.x - q.x), Math.abs(p.y - q.y)); }
  check('P5 totéž pro podurčenou skicu', JSON.stringify(u.prims) === JSON.stringify(u2.prims), `max. rozdíl ${maxDiffU.toExponential(2)}`);
}

console.log('--- P6: promítnutá kružnice (pevný střed i poloměr) a soustředná díra');
{
  const prims = [
    { id: 'origin', type: 'point', x: 0, y: 0, fixed: true },
    { id: 'ext/center', type: 'point', x: 12, y: 7, fixed: true },
    { id: 'ext', type: 'circle', c_id: 'ext/center', radius: 10 },
    { id: 'ext_fix_r', type: 'circle_radius', c_id: 'ext', radius: 10 },
    { id: 'hc', type: 'point', x: 10, y: 9, fixed: false },
    { id: 'hole', type: 'circle', c_id: 'hc', radius: 3.3 },
    { id: 'c_conc', type: 'p2p_coincident', p1_id: 'hc', p2_id: 'ext/center' },
  ];
  const r1 = solve(prims);
  console.log(`   bez kóty: status ${r1.status}, dof ${r1.dof}, střed díry ${fmt(pt(r1, 'hc'))}, poloměr ext ${pt(r1, 'ext').radius}`);
  check('P6 díra je soustředná, zbývá 1 dof (poloměr), pevná kružnice se nezměnila', r1.dof === 1 && pt(r1, 'hc').x === 12 && pt(r1, 'hc').y === 7 && pt(r1, 'ext').radius === 10);
  const r2 = solve([...prims, { id: 'd_d', type: 'circle_diameter', c_id: 'hole', diameter: 8 }]);
  console.log(`   s průměrem 8: status ${r2.status}, dof ${r2.dof}, poloměr díry ${pt(r2, 'hole').radius}`);
  check('P6 kóta průměru → dof 0, poloměr 4', r2.dof === 0 && Math.abs(pt(r2, 'hole').radius - 4) < 1e-8);
  // Tečnost k pevné kružnici: úsečka z počátku tečná k promítnuté kružnici.
  const r3 = solve([
    ...prims.slice(0, 4),
    { id: 'q', type: 'point', x: 20, y: 20, fixed: false },
    { id: 'tl', type: 'line', p1_id: 'origin', p2_id: 'q' },
    { id: 'c_tan', type: 'tangent_lc', l_id: 'tl', c_id: 'ext' },
  ]);
  const q = pt(r3, 'q');
  const dist = Math.abs(q.x * 7 - q.y * 12) / Math.hypot(q.x, q.y);   // vzdálenost středu (12,7) od přímky počátek–q
  console.log(`   tečna: status ${r3.status}, dof ${r3.dof}, q ${fmt(q)}, vzdálenost středu od přímky ${dist.toFixed(8)}, poloměr ext ${pt(r3, 'ext').radius}`);
  check('P6 tečnost k pevné kružnici ji nezmění', Math.abs(dist - 10) < 1e-6 && pt(r3, 'ext').radius === 10 && pt(r3, 'ext/center').x === 12);
}

console.log('--- P7: oblouk (tři body + arc_rules)');
{
  const prims = [
    { id: 'origin', type: 'point', x: 0, y: 0, fixed: true },
    { id: 'c', type: 'point', x: 10, y: 10, fixed: false },
    { id: 's', type: 'point', x: 21, y: 9, fixed: false },      // záměrně nesedí na poloměr
    { id: 'e', type: 'point', x: 11, y: 18, fixed: false },
    { id: 'arc', type: 'arc', c_id: 'c', radius: 10, start_angle: 0, end_angle: Math.PI / 2, start_id: 's', end_id: 'e' },
    { id: 'arc_r', type: 'arc_rules', a_id: 'arc' },
    { id: 'd_r', type: 'arc_radius', a_id: 'arc', radius: 8 },
  ];
  let r;
  try { r = solve(prims); } catch (err) { console.log('   chyba: ' + err.message); }
  if (r) {
    const c = pt(r, 'c'), s = pt(r, 's'), e = pt(r, 'e');
    const rs = Math.hypot(s.x - c.x, s.y - c.y), re = Math.hypot(e.x - c.x, e.y - c.y);
    console.log(`   status ${r.status}, dof ${r.dof}, |cs| ${rs.toFixed(8)}, |ce| ${re.toFixed(8)}`);
    check('P7 start i end leží na poloměru 8', Math.abs(rs - 8) < 1e-6 && Math.abs(re - 8) < 1e-6);
  } else check('P7 start i end leží na poloměru 8', false);
}

console.log('--- P8: mapování všech variant vazeb');
{
  const base = [
    { id: 'origin', type: 'point', x: 0, y: 0, fixed: true },
    { id: 'a', type: 'point', x: 1, y: 1, fixed: false },
    { id: 'b', type: 'point', x: 9, y: 2, fixed: false },
    { id: 'c', type: 'point', x: 8, y: 9, fixed: false },
    { id: 'd', type: 'point', x: 2, y: 8, fixed: false },
    { id: 'ab', type: 'line', p1_id: 'a', p2_id: 'b' },
    { id: 'cd', type: 'line', p1_id: 'c', p2_id: 'd' },
    { id: 'bc', type: 'line', p1_id: 'b', p2_id: 'c' },
    { id: 'm', type: 'point', x: 20, y: 5, fixed: false },
    { id: 'circ', type: 'circle', c_id: 'm', radius: 3 },
    { id: 'm2', type: 'point', x: 30, y: 6, fixed: false },
    { id: 'circ2', type: 'circle', c_id: 'm2', radius: 2 },
  ];
  const variants = {
    'coincident': { type: 'p2p_coincident', p1_id: 'a', p2_id: 'origin' },
    'pointOnCurve (úsečka)': { type: 'point_on_line_pl', p_id: 'd', l_id: 'ab' },
    'pointOnCurve (kružnice)': { type: 'point_on_circle', p_id: 'd', c_id: 'circ' },
    'horizontal': { type: 'horizontal_l', l_id: 'ab' },
    'vertical': { type: 'vertical_l', l_id: 'bc' },
    'parallel': { type: 'parallel', l1_id: 'ab', l2_id: 'cd' },
    'perpendicular': { type: 'perpendicular_ll', l1_id: 'ab', l2_id: 'bc' },
    'equalLength': { type: 'equal_length', l1_id: 'ab', l2_id: 'cd' },
    'tangent (úsečka–kružnice)': { type: 'tangent_lc', l_id: 'ab', c_id: 'circ' },
    'tangent (kružnice–kružnice)': { type: 'tangent_cc', c1_id: 'circ', c2_id: 'circ2' },
    'distance': { type: 'p2p_distance', p1_id: 'a', p2_id: 'b', distance: 12 },
    'distancePointLine': { type: 'p2l_distance', p_id: 'c', l_id: 'ab', distance: 5 },
    'horizontalDistance': { type: 'difference', param1: { o_id: 'a', prop: 'x' }, param2: { o_id: 'b', prop: 'x' }, difference: 7 },
    'verticalDistance': { type: 'difference', param1: { o_id: 'a', prop: 'y' }, param2: { o_id: 'c', prop: 'y' }, difference: 6 },
    'angle': { type: 'l2l_angle_ll', l1_id: 'ab', l2_id: 'bc', angle: Math.PI / 3 },
    'radius': { type: 'circle_radius', c_id: 'circ', radius: 4 },
    'diameter': { type: 'circle_diameter', c_id: 'circ', diameter: 9 },
  };
  const free = solve(base).dof;
  for (const [name, c] of Object.entries(variants)) {
    try {
      const r = solve([...base, { id: 'k', ...c }]);
      const removed = free - r.dof;
      check(`P8 ${name} → ${c.type}`, r.status === 'Success' && removed >= 1, `ubral ${removed} dof`);
    } catch (err) {
      check(`P8 ${name} → ${c.type}`, false, err.message);
    }
  }
  // Referenční (neřídicí) kóta: nemění geometrii a neubírá dof.
  const ref = solve([...base, { id: 'k', type: 'p2p_distance', p1_id: 'a', p2_id: 'b', distance: 999, driving: false }]);
  const k = ref.prims.find((p) => p.id === 'k');
  console.log(`   referenční kóta: dof ${ref.dof} (volných ${free}), hodnota po řešení ${k.distance}`);
  check('P8 referenční kóta neubírá dof', ref.dof === free);
}

console.log('\n==== SOUHRN ====');
const failed = results.filter(([, ok]) => !ok);
console.log(`${results.length - failed.length}/${results.length} prošlo`);
for (const [name] of failed) console.log('SELHAL ' + name);
