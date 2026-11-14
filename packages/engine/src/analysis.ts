// Rozbor určenosti skici v prvním řádu: stupně volnosti, závislé vazby, volnost entit.
// Pravidla jsou v docs/architecture.md, sekce Diagnostika skici.
//
// Každá vazba je jedna nebo dvě rovnice nad polohami bodů a poloměry kružnic. Z jejich derivací
// ve vyřešeném stavu (Jacobiho matice) plyne všechno ostatní lineární algebrou: stupně volnosti
// jsou počet proměnných minus hodnost, vazba je nadbytečná, když její řádky leží v prostoru
// řádků ostatních vazeb, a bod je volný, když ho řádky vazeb nedrží. Solver se k tomu nevolá:
// jeho počet stupňů volnosti není spolehlivý (cyklus shodných délek, úsečka stažená do bodu)
// a opakované řešení je pomalé.
import { CONSTRAINTS } from './catalog';
import type { Constraint, Curve, FreeEntity, Id, SolveInput, Vec2 } from './types';

// Rovnice mají rozměr délky, jejich derivace jsou tedy bezrozměrné a prahy nezávisí na měřítku.
const DEPENDENT = 1e-6; // řádek se po odečtení průmětu do prostoru ostatních počítá za závislý
const ZERO_ROW = 1e-9; // rovnice, která v tomto stavu nic neurčuje
const SUPPORT = 1e-6; // koeficient, od kterého se vazba počítá mezi ty, ze kterých jiná plyne
const STEP = 1e-6; // krok numerické derivace vzhledem k velikosti geometrie vazby
const SHARED = 1e-6; // bod leží na kružnici (vzhledem k velikosti křivek)

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const nonZero = (value: number): number => (value > 0 ? value : 1);
const sign = (value: number): number => (value < 0 ? -1 : 1);
const norm = (vector: Float64Array): number => {
  let sum = 0;
  for (let k = 0; k < vector.length; k++) sum += vector[k] * vector[k];
  return Math.sqrt(sum);
};

// Geometrie skici při daných hodnotách proměnných.
interface Geometry {
  point(id: Id): Vec2;
  curve(id: Id): Curve;
  radius(id: Id): number; // kružnice: proměnná nebo pevná hodnota; oblouk: vzdálenost začátku od středu
}
const lineOf = (g: Geometry, id: Id): [Vec2, Vec2] => {
  const c = g.curve(id) as Extract<Curve, { type: 'line' }>;
  return [g.point(c.a), g.point(c.b)];
};
const direction = (g: Geometry, id: Id): Vec2 => {
  const [a, b] = lineOf(g, id);
  return sub(b, a);
};
const centerOf = (g: Geometry, id: Id): Vec2 => g.point((g.curve(id) as Extract<Curve, { center: Id }>).center);

type Equations = (g: Geometry) => number[];
// Varianta vazby daného typu (i když ji typy sdružují s jinou, jako horizontal a vertical).
type Variant<C, T> = C extends { type: infer U } ? (T extends U ? C : never) : never;
type Of<T extends Constraint['type']> = Variant<Constraint, T>;

// Rovnice každé vazby: v řešení jsou nulové. `g0` je vyřešený stav; rozhoduje se podle něj to,
// co rovnice sama neurčuje (na které straně přímky bod leží, vnější nebo vnitřní dotyk kružnic).
// Význam musí odpovídat adaptéru solveru; hlídá to test, že vyřešená skica rovnice splňuje.
const EQUATIONS: { [T in Constraint['type']]: (c: Of<T>, g0: Geometry) => Equations } = {
  coincident: (c) => (g) => sub(g.point(c.a), g.point(c.b)),
  pointOnCurve: (c, g0) => {
    if (g0.curve(c.curve).type === 'line') {
      return (g) => {
        const [a, b] = lineOf(g, c.curve);
        return [cross(sub(b, a), sub(g.point(c.point), a)) / nonZero(len(sub(b, a)))];
      };
    }
    return (g) => [len(sub(g.point(c.point), centerOf(g, c.curve))) - g.radius(c.curve)];
  },
  horizontal: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[1] - a[1]];
  },
  vertical: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[0] - a[0]];
  },
  parallel: (c) => (g) => {
    const [u, v] = [direction(g, c.a), direction(g, c.b)];
    return [cross(u, v) / nonZero(Math.max(len(u), len(v)))];
  },
  perpendicular: (c) => (g) => {
    const [u, v] = [direction(g, c.a), direction(g, c.b)];
    return [dot(u, v) / nonZero(Math.max(len(u), len(v)))];
  },
  equalLength: (c) => (g) => [len(direction(g, c.a)) - len(direction(g, c.b))],
  // Tečnost má dvě podoby. Obecně: vzdálenost středu od přímky (nebo středů od sebe) odpovídá
  // poloměrům. Leží-li ale společný bod obou křivek už v jejich určujícím bodě (konec úsečky na
  // kružnici, konec oblouku na druhé kružnici), je tato rovnice v řešení dvojnásobným kořenem
  // a její derivace je nulová. Tečnost pak znamená, že poloměr v tom bodě je kolmý na úsečku,
  // respektive že oba středy a společný bod leží na přímce.
  tangent: (c, g0) => {
    const [first, second] = g0.curve(c.a).type === 'line' ? [c.a, c.b] : [c.b, c.a];
    const onCircle = (point: Id, round: Id, size: number): boolean => Math.abs(len(sub(g0.point(point), centerOf(g0, round))) - g0.radius(round)) <= SHARED * nonZero(size);
    const ends = (round: Id): Id[] => {
      const curve = g0.curve(round);
      return curve.type === 'arc' ? [curve.start, curve.end] : [];
    };
    if (g0.curve(first).type === 'line') {
      const line = g0.curve(first) as Extract<Curve, { type: 'line' }>;
      const size = Math.max(len(direction(g0, first)), g0.radius(second));
      const shared = [line.a, line.b].find((point) => onCircle(point, second, size));
      if (shared !== undefined) {
        return (g) => {
          const u = direction(g, first);
          return [dot(sub(centerOf(g, second), g.point(shared)), u) / nonZero(len(u))];
        };
      }
      const side = (g: Geometry): number => {
        const [a, b] = lineOf(g, first);
        return cross(sub(b, a), sub(centerOf(g, second), a)) / nonZero(len(sub(b, a)));
      };
      const s = sign(side(g0));
      return (g) => [s * side(g) - g.radius(second)];
    }
    const [r1, r2] = [g0.radius(first), g0.radius(second)];
    const shared = [...ends(first).filter((point) => onCircle(point, second, Math.max(r1, r2))), ...ends(second).filter((point) => onCircle(point, first, Math.max(r1, r2)))][0];
    if (shared !== undefined) {
      return (g) => {
        const [u, v] = [sub(centerOf(g, first), g.point(shared)), sub(centerOf(g, second), g.point(shared))];
        return [cross(u, v) / nonZero(Math.max(len(u), len(v)))];
      };
    }
    const between = (g: Geometry): number => len(sub(centerOf(g, first), centerOf(g, second)));
    const outer = Math.abs(between(g0) - (r1 + r2)) <= Math.abs(between(g0) - Math.abs(r1 - r2));
    const s = sign(r1 - r2);
    return (g) => [between(g) - (outer ? g.radius(first) + g.radius(second) : s * (g.radius(first) - g.radius(second)))];
  },
  // Střed bodů a, b leží na ose a jejich spojnice je na osu kolmá.
  symmetric: (c) => (g) => {
    const [p, q] = lineOf(g, c.line);
    const u = sub(q, p);
    const [a, b] = [g.point(c.a), g.point(c.b)];
    const length = nonZero(len(u));
    return [cross(u, sub([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p)) / length, dot(sub(b, a), u) / length];
  },
  midpoint: (c) => (g) => {
    const [p, q] = lineOf(g, c.line);
    const m = g.point(c.point);
    return [m[0] - (p[0] + q[0]) / 2, m[1] - (p[1] + q[1]) / 2];
  },
  // Nulová vzdálenost je totožnost: jedna rovnice by v řešení měla nulovou derivaci.
  distance: (c) => (g) => {
    const d = sub(g.point(c.a), g.point(c.b));
    return c.value === 0 ? d : [len(d) - c.value];
  },
  distancePointLine: (c, g0) => {
    const signed = (g: Geometry): number => {
      const [a, b] = lineOf(g, c.line);
      return cross(sub(b, a), sub(g.point(c.point), a)) / nonZero(len(sub(b, a)));
    };
    const s = sign(signed(g0));
    return (g) => [(c.value === 0 ? 1 : s) * signed(g) - c.value];
  },
  horizontalDistance: (c) => (g) => [g.point(c.b)[0] - g.point(c.a)[0] - c.value],
  verticalDistance: (c) => (g) => [g.point(c.b)[1] - g.point(c.a)[1] - c.value],
  // Úhel se násobí délkou, aby měla rovnice rozměr délky jako ostatní.
  angle: (c) => (g) => {
    const [u, v] = [direction(g, c.a), direction(g, c.b)];
    const off = Math.atan2(cross(u, v), dot(u, v)) - c.value;
    return [Math.atan2(Math.sin(off), Math.cos(off)) * Math.sqrt(len(u) * len(v))];
  },
  radius: (c) => (g) => [g.radius(c.curve) - c.value],
  diameter: (c) => (g) => [2 * g.radius(c.curve) - c.value],
};

// Podmínka oblouku, kterou dokument jako vazbu neukládá: oba konce stejně daleko od středu.
const arcRule =
  (arc: Extract<Curve, { type: 'arc' }>): Equations =>
  (g) => [len(sub(g.point(arc.start), g.point(arc.center))) - len(sub(g.point(arc.end), g.point(arc.center)))];

// ---------------------------------------------------------------- lineární algebra

// Rostoucí ortonormální báze. U každého přijatého vektoru si pamatuje, jak je složený z původních
// přijatých vektorů, aby šel závislý vektor vyjádřit jejich kombinací.
class Basis {
  private readonly q: Float64Array[] = [];
  private readonly mix: Float64Array[] = []; // q[i] = Σ mix[i][j] · původní[j], j ≤ i
  readonly members: number[] = []; // značky přijatých vektorů

  get size(): number {
    return this.q.length;
  }

  // Odečte průmět do báze (dvakrát, kvůli zaokrouhlení); vrací zbytek a složky v bázi.
  private reduce(vector: Float64Array): { rest: Float64Array; parts: Float64Array } {
    const rest = Float64Array.from(vector);
    const parts = new Float64Array(this.q.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.q.length; i++) {
        const qi = this.q[i];
        let d = 0;
        for (let k = 0; k < rest.length; k++) d += rest[k] * qi[k];
        if (d === 0) continue;
        for (let k = 0; k < rest.length; k++) rest[k] -= d * qi[k];
        parts[i] += d;
      }
    }
    return { rest, parts };
  }

  // Délka části vektoru, která v prostoru báze neleží.
  outside(vector: Float64Array): Float64Array {
    return this.reduce(vector).rest;
  }

  // Přidá jednotkový vektor. Je-li závislý, nepřidá ho a vrátí koeficienty u původních přijatých
  // vektorů (v pořadí `members`), kterými ho jde složit.
  add(vector: Float64Array, tag: number): Float64Array | undefined {
    const { rest, parts } = this.reduce(vector);
    const length = norm(rest);
    const count = this.q.length;
    if (length <= DEPENDENT) {
      const coefficients = new Float64Array(count);
      for (let i = 0; i < count; i++) for (let j = 0; j <= i; j++) coefficients[j] += parts[i] * this.mix[i][j];
      return coefficients;
    }
    const mix = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) for (let j = 0; j <= i; j++) mix[j] -= (parts[i] * this.mix[i][j]) / length;
    mix[count] = 1 / length;
    for (let k = 0; k < rest.length; k++) rest[k] /= length;
    this.q.push(rest);
    this.mix.push(mix);
    this.members.push(tag);
    return undefined;
  }
}

const normalized = (vector: Float64Array): Float64Array | undefined => {
  const length = norm(vector);
  return length > ZERO_ROW ? vector.map((value) => value / length) : undefined;
};

// ---------------------------------------------------------------- rozbor

interface Row {
  owner: Id | undefined; // vazba; undefined = podmínka oblouku
  vector: Float64Array | undefined; // jednotkový řádek Jacobiho matice; undefined = nulový
}

export class SketchAnalysis {
  readonly degreesOfFreedom: number;
  readonly residual: number; // největší odchylka rovnic ve vyřešeném stavu (mm)
  private readonly rows: Row[] = [];
  private readonly order: Id[]; // vazby v pořadí dokumentu
  private readonly variables: { id: Id; kind: FreeEntity['kind']; at: number }[] = [];
  private readonly count: number; // počet proměnných
  private readonly basis: Basis; // řádky v pořadí dokumentu: starší mají přednost
  private readonly dual = new Map<number, Float64Array>(); // řádek → jeho složky v bázi závislostí
  private readonly dependencies: number; // rozměr prostoru závislostí mezi řádky
  private surplusCache?: { redundant: Id[]; removable: Id[] };
  private freeCache?: FreeEntity[];

  // `input`: vstup solveru s vyřešenými polohami; jen řídicí vazby, v pořadí dokumentu.
  constructor(private readonly input: SolveInput) {
    const fixed = new Set(input.fixed);
    const at = new Map<Id, number>(); // bod → index x (y následuje)
    const radiusAt = new Map<Id, number>();
    let count = 0;
    for (const id of Object.keys(input.points)) {
      if (fixed.has(id)) continue;
      at.set(id, count);
      this.variables.push({ id, kind: 'point', at: count });
      count += 2;
    }
    for (const [id, curve] of Object.entries(input.curves)) {
      if (curve.type !== 'circle' || fixed.has(id)) continue;
      radiusAt.set(id, count);
      this.variables.push({ id, kind: 'radius', at: count });
      count += 1;
    }
    this.count = count;
    const values = new Float64Array(count);
    for (const [id, index] of at) values.set([input.points[id].x, input.points[id].y], index);
    for (const [id, index] of radiusAt) values[index] = input.radii[id];

    const geometry: Geometry = {
      point: (id) => {
        const index = at.get(id);
        return index === undefined ? [input.points[id].x, input.points[id].y] : [values[index], values[index + 1]];
      },
      curve: (id) => input.curves[id],
      radius: (id) => {
        const curve = input.curves[id];
        if (curve.type === 'arc') return len(sub(geometry.point(curve.start), geometry.point(curve.center)));
        const index = radiusAt.get(id);
        return index === undefined ? input.radii[id] : values[index];
      },
    };
    const pointsOf = (entity: Id): Id[] => {
      const curve = input.curves[entity];
      if (!curve) return [entity];
      return curve.type === 'line' ? [curve.a, curve.b] : curve.type === 'circle' ? [curve.center] : [curve.center, curve.start, curve.end];
    };

    // Řádky Jacobiho matice numerickou derivací; krok se řídí velikostí geometrie, které se vazba týká.
    let extent = 0;
    for (const p of Object.values(input.points)) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    let residual = 0;
    const addRows = (owner: Id | undefined, equations: Equations, entities: Id[]) => {
      const points = [...new Set(entities.flatMap(pointsOf))];
      const touched = new Set<number>();
      let size = 0;
      for (const point of points) {
        const index = at.get(point);
        if (index !== undefined) touched.add(index).add(index + 1);
        for (const other of points) size = Math.max(size, len(sub(geometry.point(point), geometry.point(other))));
      }
      for (const entity of entities) {
        const index = radiusAt.get(entity);
        if (index !== undefined) touched.add(index);
        if (input.curves[entity] && input.curves[entity].type !== 'line') size = Math.max(size, geometry.radius(entity));
      }
      const step = STEP * (size > 0 ? size : nonZero(extent));
      const base = equations(geometry);
      for (const value of base) residual = Math.max(residual, Math.abs(value));
      const vectors = base.map(() => new Float64Array(count));
      for (const index of touched) {
        const saved = values[index];
        values[index] = saved + step;
        const plus = equations(geometry);
        values[index] = saved - step;
        const minus = equations(geometry);
        values[index] = saved;
        for (let e = 0; e < vectors.length; e++) vectors[e][index] = (plus[e] - minus[e]) / (2 * step);
      }
      for (const vector of vectors) this.rows.push({ owner, vector: normalized(vector) });
    };

    for (const curve of Object.values(input.curves)) if (curve.type === 'arc') addRows(undefined, arcRule(curve), [curve.center, curve.start, curve.end]);
    this.order = Object.keys(input.constraints);
    for (const id of this.order) {
      const c = input.constraints[id];
      const build = EQUATIONS[c.type] as (c: Constraint, g0: Geometry) => Equations;
      addRows(id, build(c, geometry), CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]));
    }
    this.residual = residual;

    // Báze řádků v pořadí dokumentu. Každý závislý řádek dává jednu závislost: sám minus
    // kombinace přijatých řádků. Složky řádku ve všech závislostech (sloupec „duální" matice)
    // říkají, jestli a s čím je řádek zaměnitelný.
    this.basis = new Basis();
    const relations: { row: number; coefficients: Float64Array; members: number[] }[] = [];
    this.rows.forEach((row, index) => {
      const coefficients = row.vector ? this.basis.add(row.vector, index) : new Float64Array(0);
      if (coefficients) relations.push({ row: index, coefficients, members: this.basis.members.slice(0, coefficients.length) });
    });
    this.dependencies = relations.length;
    relations.forEach((relation, k) => {
      const set = (row: number, value: number) => {
        let vector = this.dual.get(row);
        if (!vector) this.dual.set(row, (vector = new Float64Array(relations.length)));
        vector[k] = value;
      };
      set(relation.row, 1);
      relation.members.forEach((member, j) => Math.abs(relation.coefficients[j]) > SUPPORT && set(member, -relation.coefficients[j]));
    });
    this.degreesOfFreedom = count - this.basis.size;
  }

  private rowsOf(constraint: Id): number[] {
    const out: number[] = [];
    this.rows.forEach((row, index) => row.owner === constraint && out.push(index));
    return out;
  }

  // `redundant`: vazby, které plynou z ostatních. `removable`: sada, kterou jde odebrat naráz;
  // odebírá se od nejnovější vazby, takže starší zůstávají. Obojí v pořadí dokumentu.
  surplus(): { redundant: Id[]; removable: Id[] } {
    if (this.surplusCache) return this.surplusCache;
    if (this.dependencies === 0) return (this.surplusCache = { redundant: [], removable: [] });
    const redundant = this.order.filter((id) => this.removableTogether(new Basis(), id));
    const removed = new Basis();
    const removable: Id[] = [];
    for (const id of [...redundant].reverse()) if (this.removableTogether(removed, id)) removable.push(id);
    return (this.surplusCache = { redundant, removable: removable.reverse() });
  }

  // Přidá vazbu do sady k odebrání, pokud to hodnost nesníží; jinak sadu nechá beze změny.
  // Sadu řádků jde odebrat právě tehdy, když jsou jejich složky v závislostech lineárně nezávislé.
  private removableTogether(removed: Basis, constraint: Id): boolean {
    const units: Float64Array[] = [];
    for (const index of this.rowsOf(constraint)) {
      const vector = this.dual.get(index);
      const unit = vector && normalized(vector);
      if (!unit) return false;
      units.push(unit);
    }
    // zbytky všech řádků vazby po odečtení sady musí být nezávislé i mezi sebou
    const rests = units.map((unit) => removed.outside(unit));
    const own = new Basis();
    for (const rest of rests) {
      const unit = norm(rest) > DEPENDENT ? normalized(rest) : undefined;
      if (!unit || own.add(unit, 0)) return false;
    }
    for (const unit of units) removed.add(unit, 0);
    return true;
  }

  // Entity, které se ještě mohou hýbat: bod o 1 nebo 2 stupně, poloměr kružnice o 1.
  // Pohyby, které vazby dovolují, tvoří prostor kolmý na řádky vazeb. Jeho báze se získá průmětem
  // tolika pomocných vektorů, kolik má skica stupňů volnosti; volnost entity je hodnost té báze
  // omezené na souřadnice entity.
  free(): FreeEntity[] {
    if (this.freeCache) return this.freeCache;
    const out: FreeEntity[] = [];
    const motions: Float64Array[] = [];
    for (let seed = 0; motions.length < this.degreesOfFreedom && seed < 4 * this.degreesOfFreedom + 8; seed++) {
      // pomocný vektor s pevně danými „náhodnými" složkami, aby byl výsledek opakovatelný
      const probe = Float64Array.from({ length: this.count }, (_, k) => Math.sin(12.9898 * (k + 1) + 78.233 * (seed + 1)));
      const rest = this.basis.outside(probe);
      for (let pass = 0; pass < 2; pass++) {
        for (const motion of motions) {
          let d = 0;
          for (let k = 0; k < rest.length; k++) d += rest[k] * motion[k];
          for (let k = 0; k < rest.length; k++) rest[k] -= d * motion[k];
        }
      }
      const length = norm(rest);
      if (length > 1e-3 * norm(probe)) motions.push(rest.map((value) => value / length));
    }
    const along = (index: number): Float64Array => Float64Array.from(motions, (motion) => motion[index]);
    for (const variable of this.variables) {
      const first = along(variable.at);
      let freedom = norm(first) > DEPENDENT ? 1 : 0;
      if (variable.kind === 'point') {
        const second = along(variable.at + 1);
        if (freedom === 1) {
          // druhý směr se počítá, jen když není násobkem prvního
          let d = 0;
          for (let k = 0; k < first.length; k++) d += second[k] * first[k];
          const square = norm(first) ** 2;
          for (let k = 0; k < first.length; k++) second[k] -= (d / square) * first[k];
        }
        if (norm(second) > DEPENDENT) freedom += 1;
      }
      if (freedom > 0) out.push({ id: variable.id, kind: variable.kind, freedom });
    }
    return (this.freeCache = out);
  }

  // Nejmenší sada ostatních vazeb, ze kterých vazba plyne; undefined = neplyne z nich.
  // Sad může být víc: `prefer` říká, které vazby mají mít přednost (menší číslo dřív).
  explain(constraint: Id, prefer: (other: Id) => number): Id[] | undefined {
    const own = this.rowsOf(constraint);
    if (own.length === 0) return undefined;
    const position = new Map(this.order.map((id, index) => [id, index]));
    const rank = (row: Row): number => (row.owner === undefined ? -1 : prefer(row.owner));
    const others = this.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.owner !== constraint && row.vector)
      .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index);
    const basis = new Basis();
    for (const { row, index } of others) basis.add(row.vector as Float64Array, index);
    const implied = new Set<Id>();
    for (const index of own) {
      const vector = this.rows[index].vector;
      if (!vector) continue; // rovnice, která nic neurčuje, neplyne z ničeho konkrétního
      const coefficients = basis.add(vector, index);
      if (!coefficients) return undefined;
      coefficients.forEach((value, j) => {
        const owner = this.rows[basis.members[j]].owner;
        if (Math.abs(value) > SUPPORT && owner !== undefined) implied.add(owner);
      });
    }
    return [...implied].sort((a, b) => (position.get(a) as number) - (position.get(b) as number));
  }
}
