// Adaptér portu SketchSolver nad planegcs (2D solver z FreeCADu ve WASM).
// Kontrakt portu je v docs/architecture.md, sekce SketchSolver.
import { Algorithm, DebugMode, GcsWrapper, SolveStatus, init_planegcs_module } from '@salusoft89/planegcs';
import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { Constraint, Curve, Id, Point2, SketchSolver, SolveInput, SolveResult } from '@trymesh/engine';

export interface PlanegcsOptions {
  // Kde najít planegcs.wasm (v browseru); v Node se najde sám.
  locateFile?: (file: string) => string;
}

// Pomocné vazby a primitiva adaptéru. ID uživatele smí obsahovat nejvýš jedno lomítko
// (odvozená ID promítnuté geometrie), takže dvě lomítka na začátku nemohou kolidovat.
const SYNTHETIC = '//';
const isSynthetic = (id: string) => id.startsWith(SYNTHETIC);
// A constraint of the engine that needs two primitives of the library (a fixed point: one per
// coordinate) carries the second one under this prefix; what the library says about it is said
// about the constraint.
const SECOND = `${SYNTHETIC}second/`;
const owners = (ids: string[]): Id[] => [...new Set(ids.map((id) => (id.startsWith(SECOND) ? id.slice(SECOND.length) : id)).filter((id) => !isSynthetic(id)))].sort();

const MERGED = 1e-7; // dva body leží ve stejném místě (vzhledem k velikosti souřadnic)
const SPREAD = 1e-3; // o kolik se splynulé body rozestoupí (vzhledem k rozměru skici)

type Primitive = SketchPrimitive;
type Loose = Record<string, unknown> & { id: string; type: string };

// Jeden průchod knihovnou.
interface Pass {
  ok: boolean; // knihovna našla řešení a nehlásí konflikt
  settled: boolean; // stav Success: všechny vazby včetně nadbytečných jsou splněné
  points: Record<Id, Point2>;
  radii: Record<Id, number>;
  degreesOfFreedom: number;
  conflicting: Id[];
  redundant: Id[];
  // The redundant primitives as the library names them: of a fixed point one coordinate alone
  // may be redundant, and only that one is left out while dragging.
  redundantPrimitives: string[];
}

export async function createPlanegcsSolver(options: PlanegcsOptions = {}): Promise<SketchSolver> {
  const mod = await init_planegcs_module(options.locateFile ? { locateFile: options.locateFile } : undefined);

  const run = (input: SolveInput, extra: { drag?: SolveInput['drag']; without?: Set<string>; algorithm?: Algorithm; collapsed?: Set<Id> } = {}): Pass => {
    const gcs = new GcsWrapper(new mod.GcsSystem());
    try {
      gcs.debug_mode = DebugMode.NoDebug; // jinak solver vypisuje na standardní výstup
      gcs.push_primitives_and_params(buildPrimitives(input, extra.drag, extra.without, extra.collapsed) as unknown as Primitive[]);
      const status = gcs.solve(extra.algorithm);
      const conflicting = owners(gcs.get_gcs_conflicting_constraints());
      const redundantPrimitives = gcs.get_gcs_redundant_constraints();
      const redundant = owners(redundantPrimitives);
      const ok = (status === SolveStatus.Success || status === SolveStatus.Converged) && conflicting.length === 0;
      const pass: Pass = { ok, settled: status === SolveStatus.Success, points: {}, radii: {}, degreesOfFreedom: 0, conflicting, redundant, redundantPrimitives };
      if (!ok) return pass;
      gcs.apply_solution();
      for (const p of gcs.sketch_index.get_primitives() as unknown as Loose[]) {
        if (p.type === 'point') pass.points[p.id] = { x: p.x as number, y: p.y as number };
        else if (p.type === 'circle') pass.radii[p.id] = p.radius as number;
      }
      pass.degreesOfFreedom = gcs.gcs.dof();
      return pass;
    } finally {
      gcs.destroy_gcs_module(); // paměť WASM se uvolňuje ručně
    }
  };

  return {
    solve(input: SolveInput): SolveResult {
      // Při neúspěchu se vrací vstup; počet stupňů volnosti pak nemá význam.
      const failure = (conflicting: Id[], redundant: Id[]): SolveResult => ({
        status: conflicting.length > 0 ? 'conflict' : 'failed',
        points: clonePoints(input.points),
        radii: { ...input.radii },
        degreesOfFreedom: 0,
        conflicting,
        redundant,
      });

      // Splynulá souměrnost. Knihovna počítá souměrnost dvou bodů (a střed úsečky) z jejich
      // spojnice; když body leží ve stejném místě, hlásí vazbu jako konflikt, i když je splněná
      // (oba body na ose). Když je taková vazba mezi konfliktními, zkusí se dvě náhradní cesty:
      // 1. rozestoupit splynulé body o kousek od sebe a řešit původní soustavu (řešení, ve kterém
      //    body nesplývají, se tak najde: kóta šířky, tažení jednoho z bodů),
      // 2. nahradit vazbu jejím splynulým tvarem (totožnost bodů a bod na ose); každé takové
      //    řešení původní vazbu splňuje. Tvar pak platí i pro další průchody tohoto řešení.
      let collapsed = new Set<Id>();
      const attempt = (from: SolveInput, extra: { drag?: SolveInput['drag']; without?: Set<string> }, first: boolean): Pass => {
        let pass = run(from, { ...extra, collapsed });
        // Výchozí algoritmus (DogLeg) občas nedoběhne tam, kde jiný ano; stejně postupuje FreeCAD.
        if (first && !pass.ok && pass.conflicting.length === 0) pass = run(from, { ...extra, collapsed, algorithm: Algorithm.LevenbergMarquardt });
        if (pass.ok) return pass;
        const merged = mergedPairs(from).filter((id) => !collapsed.has(id));
        if (!merged.some((id) => pass.conflicting.includes(id))) return pass;
        if (first) {
          const apart = run(spread(from, merged), { ...extra, collapsed });
          if (apart.ok) return apart;
        }
        const all = new Set([...collapsed, ...merged]);
        const forced = run(from, { ...extra, collapsed: all });
        if (!forced.ok) return pass;
        collapsed = all;
        return forced;
      };

      // Tažení: nadbytečná vazba by se s dočasným cílem tažení ohlásila jako konflikt. Nejdřív se
      // proto zjistí bez tažení, které vazby nadbytečné jsou, a při tažení se vynechají.
      // (Primitives, not constraints: a fixed point whose one coordinate repeats another constraint
      // must keep the other coordinate, or the drag would move it.)
      let without: Set<string> | undefined;
      if (input.drag) {
        const plain = attempt(input, {}, true);
        if (!plain.ok) return failure(plain.conflicting, plain.redundant);
        without = new Set(plain.redundantPrimitives);
        collapsed = new Set(); // tažení smí splynulé body zase rozestoupit
      }
      let pass = attempt(input, { drag: input.drag, without }, true);
      if (!pass.ok) return failure(pass.conflicting, pass.redundant);

      // Ověření a diagnostika z nalezeného stavu. Knihovna hlásí stupně volnosti a nadbytečné vazby
      // podle výchozího odhadu, ne podle výsledku, a ve stavu Converged může nechat nadbytečnou
      // vazbu nesplněnou. Řeší se proto znovu z výsledku, dokud stav není ustálený.
      for (let round = 0; round < 4; round++) {
        const next = attempt({ ...input, points: pass.points, radii: { ...input.radii, ...pass.radii } }, {}, false);
        if (!next.ok) return failure(next.conflicting, next.redundant);
        const moved = Object.keys(next.points).some((id) => next.points[id].x !== pass.points[id].x || next.points[id].y !== pass.points[id].y);
        pass = next;
        if (next.settled && !moved) break;
      }
      if (!pass.settled) return failure([], pass.redundant);

      // Řešení, které není použitelná geometrie, se nevrací: nekonečné hodnoty, nekladný poloměr
      // (knihovna si u tečnosti drží vnější nebo vnitřní dotyk podle výchozího odhadu), oblouk
      // s konci na různých poloměrech.
      const fixed = new Set(input.fixed);
      const usable =
        Object.values(pass.points).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
        Object.values(pass.radii).every((r) => Number.isFinite(r) && r > 0) &&
        Object.values(input.curves).every((curve) => {
          if (curve.type !== 'arc') return true;
          const [c, s, e] = [pass.points[curve.center], pass.points[curve.start], pass.points[curve.end]];
          const [rs, re] = [Math.hypot(s.x - c.x, s.y - c.y), Math.hypot(e.x - c.x, e.y - c.y)];
          return Math.abs(rs - re) <= 1e-6 * Math.max(1, rs);
        });
      if (!usable) return failure([], pass.redundant);
      // pevná kružnice si drží poloměr bitově, i když se její střed hýbe
      for (const id of Object.keys(pass.radii)) if (fixed.has(id)) pass.radii[id] = input.radii[id];
      return { status: 'solved', points: pass.points, radii: pass.radii, degreesOfFreedom: pass.degreesOfFreedom, conflicting: [], redundant: pass.redundant };
    },
  };
}

const clonePoints = (points: Record<Id, Point2>): Record<Id, Point2> =>
  Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { x: p.x, y: p.y }]));

// Pořadí primitiv je seřazené podle ID, aby stejný vstup dal vždy stejný výstup
// bez ohledu na pořadí klíčů v objektech.
// Dvojice bodů, ze které knihovna počítá souměrnost: souměrné body, u středu úsečky její konce.
function pairOf(c: Constraint, curves: Record<Id, Curve>): [Id, Id] | undefined {
  if (c.type === 'symmetric') return [c.a, c.b];
  const line = c.type === 'midpoint' ? curves[c.line] : undefined;
  return line?.type === 'line' ? [line.a, line.b] : undefined;
}

// Vazby souměrnosti a středu úsečky, jejichž dvojice bodů ve vstupu splývá.
function mergedPairs(input: SolveInput): Id[] {
  return Object.keys(input.constraints).filter((id) => {
    const pair = pairOf(input.constraints[id], input.curves);
    if (!pair) return false;
    const [p, q] = [input.points[pair[0]], input.points[pair[1]]];
    return Math.hypot(p.x - q.x, p.y - q.y) <= MERGED * Math.max(1, Math.abs(p.x), Math.abs(p.y));
  });
}

// Vstup, ve kterém jsou splynulé dvojice daných vazeb rozestoupené: souměrné body kolmo na osu,
// konce úsečky ve směru x. Pevnými body se nehýbe.
function spread(input: SolveInput, constraints: Id[]): SolveInput {
  const fixed = new Set(input.fixed);
  const points = clonePoints(input.points);
  let extent = 0;
  for (const p of Object.values(input.points)) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  const step = SPREAD * (extent > 0 ? extent : 1);
  for (const id of constraints) {
    const c = input.constraints[id];
    const [a, b] = pairOf(c, input.curves) as [Id, Id];
    let normal = { x: 1, y: 0 };
    if (c.type === 'symmetric') {
      const axis = input.curves[c.line] as Extract<Curve, { type: 'line' }>;
      const [p, q] = [input.points[axis.a], input.points[axis.b]];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length > 0) normal = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
    }
    if (!fixed.has(a)) points[a] = { x: points[a].x - step * normal.x, y: points[a].y - step * normal.y };
    if (!fixed.has(b)) points[b] = { x: points[b].x + step * normal.x, y: points[b].y + step * normal.y };
  }
  return { ...input, points };
}

function buildPrimitives(input: SolveInput, drag?: SolveInput['drag'], without?: Set<string>, collapsed?: Set<Id>): Loose[] {
  const fixed = new Set(input.fixed);
  for (const id of [...Object.keys(input.points), ...Object.keys(input.curves), ...Object.keys(input.constraints)]) {
    if (isSynthetic(id)) throw new Error(`solver: ID "${id}" koliduje s pomocnými ID adaptéru`);
  }
  // Pevné smějí být body a kružnice (pevný poloměr); nic jiného adaptér zafixovat neumí.
  for (const id of fixed) {
    if (!input.points[id] && input.curves[id]?.type !== 'circle') throw new Error(`solver: "${id}" ve fixed není bod ani kružnice`);
  }
  const out: Loose[] = [];
  const sorted = <T>(record: Record<Id, T>) => Object.keys(record).sort().map((id) => [id, record[id] as T] as const);
  const point = (id: Id): Point2 => {
    const p = input.points[id];
    if (!p) throw new Error(`solver: neznámý bod ${id}`);
    return p;
  };

  // A point with a fixed-point constraint starts at its coordinates. The library finds them
  // anyway, but from a rough estimate it may stop in a place where a dimension that agrees with
  // them looks like a conflict (a point on the axis through the other end of a distance).
  const start = new Map<Id, Point2>();
  for (const [, constraint] of sorted(input.constraints)) {
    if (constraint.type === 'fixed' && !fixed.has(constraint.point)) start.set(constraint.point, { x: constraint.x, y: constraint.y });
  }
  for (const [id, p] of sorted(input.points)) out.push({ id, type: 'point', x: start.get(id)?.x ?? p.x, y: start.get(id)?.y ?? p.y, fixed: fixed.has(id) });

  for (const [id, curve] of sorted(input.curves)) {
    if (curve.type === 'line') {
      point(curve.a);
      point(curve.b);
      out.push({ id, type: 'line', p1_id: curve.a, p2_id: curve.b });
    } else if (curve.type === 'circle') {
      point(curve.center);
      const radius = input.radii[id];
      if (radius === undefined) throw new Error(`solver: kružnice ${id} nemá poloměr`);
      out.push({ id, type: 'circle', c_id: curve.center, radius });
      if (fixed.has(id)) out.push({ id: `${SYNTHETIC}fixRadius/${id}`, type: 'circle_radius', c_id: id, radius });
    } else if (curve.type === 'arc') {
      // Oblouk: knihovna chce poloměr a úhly na vstupu a pravidla oblouku jako vazbu.
      const c = point(curve.center);
      const s = point(curve.start);
      const e = point(curve.end);
      const startAngle = Math.atan2(s.y - c.y, s.x - c.x);
      let endAngle = Math.atan2(e.y - c.y, e.x - c.x);
      if (endAngle <= startAngle) endAngle += 2 * Math.PI; // proti směru hodin
      out.push({
        id,
        type: 'arc',
        c_id: curve.center,
        start_id: curve.start,
        end_id: curve.end,
        radius: Math.hypot(s.x - c.x, s.y - c.y),
        start_angle: startAngle,
        end_angle: endAngle,
      });
      out.push({ id: `${SYNTHETIC}arcRules/${id}`, type: 'arc_rules', a_id: id });
    } else {
      throw new Error(`solver: neznámý druh křivky u ${id}`);
    }
  }

  for (const [id, constraint] of sorted(input.constraints)) {
    if ('driving' in constraint && !constraint.driving) continue; // referenční kóty počítá engine
    if (constraint.type === 'fixed') {
      // two primitives, each left out on its own
      point(constraint.point);
      if (!without?.has(id)) out.push({ id, type: 'coordinate_x', p_id: constraint.point, x: constraint.x });
      if (!without?.has(`${SECOND}${id}`)) out.push({ id: `${SECOND}${id}`, type: 'coordinate_y', p_id: constraint.point, y: constraint.y });
      continue;
    }
    if (without?.has(id)) continue;
    if (collapsed?.has(id)) {
      // splynulý tvar: oba body dvojice v jednom místě, které leží na ose (ve středu úsečky)
      const [a, b] = pairOf(constraint, input.curves) as [Id, Id];
      out.push({ id, type: 'p2p_coincident', p1_id: a, p2_id: b });
      if (constraint.type === 'symmetric') out.push({ id: `${SYNTHETIC}onAxis/${id}`, type: 'point_on_line_pl', p_id: a, l_id: constraint.line });
      else if (constraint.type === 'midpoint') out.push({ id: `${SYNTHETIC}middle/${id}`, type: 'p2p_coincident', p1_id: constraint.point, p2_id: a });
      continue;
    }
    out.push({ id, ...translate(id, constraint, input.curves) });
  }

  if (drag) {
    const { point: p, target } = drag;
    point(p);
    out.push({ id: `${SYNTHETIC}drag/x`, type: 'coordinate_x', p_id: p, x: target.x, temporary: true });
    out.push({ id: `${SYNTHETIC}drag/y`, type: 'coordinate_y', p_id: p, y: target.y, temporary: true });
  }
  return out;
}

// Každá varianta vazby enginu má právě jeden protějšek v knihovně; liší se jen podle druhu křivky.
// (A fixed point is the exception with two primitives and is translated by the caller.)
function translate(id: Id, c: Exclude<Constraint, { type: 'fixed' }>, curves: Record<Id, Curve>): Record<string, unknown> & { type: string } {
  const kind = (curveId: Id): Curve['type'] => {
    const curve = curves[curveId];
    if (!curve) throw new Error(`solver: vazba ${id} odkazuje na neznámou křivku ${curveId}`);
    return curve.type;
  };
  const line = (curveId: Id): Id => {
    if (kind(curveId) !== 'line') throw new Error(`solver: vazba ${id} čeká úsečku, ${curveId} je ${kind(curveId)}`);
    return curveId;
  };
  switch (c.type) {
    case 'coincident':
      return { type: 'p2p_coincident', p1_id: c.a, p2_id: c.b };
    case 'pointOnCurve': {
      const k = kind(c.curve);
      if (k === 'line') return { type: 'point_on_line_pl', p_id: c.point, l_id: c.curve };
      if (k === 'circle') return { type: 'point_on_circle', p_id: c.point, c_id: c.curve };
      if (k === 'arc') return { type: 'point_on_arc', p_id: c.point, a_id: c.curve };
      throw new Error(`solver: vazba ${id}: neznámý druh křivky ${c.curve}`);
    }
    case 'horizontal':
      return { type: 'horizontal_l', l_id: line(c.line) };
    case 'vertical':
      return { type: 'vertical_l', l_id: line(c.line) };
    case 'parallel':
      return { type: 'parallel', l1_id: line(c.a), l2_id: line(c.b) };
    case 'perpendicular':
      return { type: 'perpendicular_ll', l1_id: line(c.a), l2_id: line(c.b) };
    case 'equalLength':
      return { type: 'equal_length', l1_id: line(c.a), l2_id: line(c.b) };
    case 'equalRadius': {
      // operand order of the library: circle before arc
      const [first, second] = kind(c.a) === 'arc' && kind(c.b) === 'circle' ? [c.b, c.a] : [c.a, c.b];
      const pair = `${kind(first)}-${kind(second)}`;
      if (pair === 'circle-circle') return { type: 'equal_radius_cc', c1_id: first, c2_id: second };
      if (pair === 'circle-arc') return { type: 'equal_radius_ca', c1_id: first, a2_id: second };
      if (pair === 'arc-arc') return { type: 'equal_radius_aa', a1_id: first, a2_id: second };
      throw new Error(`solver: vazba ${id}: equal radius needs circles or arcs`);
    }
    case 'tangent': {
      // pořadí operandů knihovny: úsečka, kružnice, oblouk
      const rank = { line: 0, circle: 1, arc: 2 } as const;
      const [first, second] = rank[kind(c.a)] <= rank[kind(c.b)] ? [c.a, c.b] : [c.b, c.a];
      const pair = `${kind(first)}-${kind(second)}`;
      if (pair === 'line-circle') return { type: 'tangent_lc', l_id: first, c_id: second };
      if (pair === 'line-arc') return { type: 'tangent_la', l_id: first, a_id: second };
      if (pair === 'circle-circle') return { type: 'tangent_cc', c1_id: first, c2_id: second };
      if (pair === 'circle-arc') return { type: 'tangent_ca', c_id: first, a_id: second };
      if (pair === 'arc-arc') return { type: 'tangent_aa', a1_id: first, a2_id: second };
      throw new Error(`solver: vazba ${id}: tečnost dvou úseček nedává smysl`);
    }
    case 'symmetric':
      return { type: 'p2p_symmetric_ppl', p1_id: c.a, p2_id: c.b, l_id: line(c.line) };
    case 'midpoint': {
      // bod je středem úsečky, když jsou její konce souměrné podle něj
      const ends = curves[line(c.line)] as Extract<Curve, { type: 'line' }>;
      return { type: 'p2p_symmetric_ppp', p1_id: ends.a, p2_id: ends.b, p_id: c.point };
    }
    case 'distance':
      return { type: 'p2p_distance', p1_id: c.a, p2_id: c.b, distance: c.value };
    case 'distancePointLine':
      return { type: 'p2l_distance', p_id: c.point, l_id: line(c.line), distance: c.value };
    case 'horizontalDistance': // orientovaná: b.x − a.x = value
      return { type: 'difference', param1: { o_id: c.a, prop: 'x' }, param2: { o_id: c.b, prop: 'x' }, difference: c.value };
    case 'verticalDistance': // orientovaná: b.y − a.y = value
      return { type: 'difference', param1: { o_id: c.a, prop: 'y' }, param2: { o_id: c.b, prop: 'y' }, difference: c.value };
    case 'angle': // od směru úsečky a ke směru úsečky b, proti směru hodin
      return { type: 'l2l_angle_ll', l1_id: line(c.a), l2_id: line(c.b), angle: c.value };
    case 'radius':
      return kind(c.curve) === 'arc'
        ? { type: 'arc_radius', a_id: c.curve, radius: c.value }
        : { type: 'circle_radius', c_id: c.curve, radius: c.value };
    case 'diameter':
      return kind(c.curve) === 'arc'
        ? { type: 'arc_diameter', a_id: c.curve, diameter: c.value }
        : { type: 'circle_diameter', c_id: c.curve, diameter: c.value };
  }
}
