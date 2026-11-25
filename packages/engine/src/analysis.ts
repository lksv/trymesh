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
import { commonEnd } from './common-end';
import { curvePoints } from './sketch-content';
import type { Constraint, Curve, FreeEntity, Id, SolveInput, Vec2 } from './types';
import { ORIGIN, unreachable } from './util';

// Rovnice mají rozměr délky, jejich derivace jsou tedy bezrozměrné a prahy nezávisí na měřítku.
const DEPENDENT = 1e-6; // řádek se po odečtení průmětu do prostoru ostatních počítá za závislý
const ZERO_ROW = 1e-9; // rovnice, která v tomto stavu nic neurčuje
const SUPPORT = 1e-6; // koeficient, od kterého se vazba počítá mezi ty, ze kterých jiná plyne
const STEP = 1e-6; // krok numerické derivace vzhledem k velikosti geometrie vazby
const PROBE = 1e-3; // část pomocného vektoru, která musí zbýt, aby se počítala za nový pohyb
const SHARED = 1e-6; // bod leží na kružnici (vzhledem k velikosti křivek)

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const nonZero = (value: number): number => (value > 0 ? value : 1);
const sign = (value: number): number => (value < 0 ? -1 : 1);
// Opakovatelná „náhodná" čísla z (−1, 1) (mulberry32); výsledek rozboru se tak nemění.
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
};
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
// Drží ostatní vazby (bez tečností) bod na kružnici nebo oblouku?
type Held = (point: Id, round: Id) => boolean;
// The end of the arc the adapter takes as the common end of a tangency of a line and an arc only
// because two fixed points lie at one place (`commonEnd` with `byPlace`, D72), or undefined.
type JoinedByPlace = (line: Id, arc: Id) => Id | undefined;
// Varianta vazby daného typu (i když ji typy sdružují s jinou, jako horizontal a vertical).
type Variant<C, T> = C extends { type: infer U } ? (T extends U ? C : never) : never;
type Of<T extends Constraint['type']> = Variant<Constraint, T>;

// A spline is never an operand of a constraint (D70): the catalog refuses it, so a validated
// document never reaches the case.
const neverAnOperand = (what: string): never => {
  throw new Error(`a spline is never an operand of ${what}`);
};

// Rovnice každé vazby: v řešení jsou nulové. `g0` je vyřešený stav; rozhoduje se podle něj to,
// co rovnice sama neurčuje (na které straně přímky bod leží, vnější nebo vnitřní dotyk kružnic),
// a berou se z něj délky, kterými se dělí rovnice s nulovou pravou stranou: dělitel je pak
// konstanta a rovnice zůstane hladká. Rovnice závisí jen na rozdílech poloh, ne na počátku.
// Význam musí odpovídat adaptéru solveru; hlídá to test, že vyřešená skica rovnice splňuje.
const EQUATIONS: { [T in Constraint['type']]: (c: Of<T>, g0: Geometry, held: Held, joined: JoinedByPlace) => Equations } = {
  coincident: (c) => (g) => sub(g.point(c.a), g.point(c.b)),
  pointOnCurve: (c, g0) => {
    const curve = g0.curve(c.curve);
    switch (curve.type) {
      case 'line':
        return (g) => {
          const [a, b] = lineOf(g, c.curve);
          return [cross(sub(b, a), sub(g.point(c.point), a)) / nonZero(len(sub(b, a)))];
        };
      case 'circle':
      case 'arc':
        return (g) => [len(sub(g.point(c.point), centerOf(g, c.curve))) - g.radius(c.curve)];
      case 'spline':
        return neverAnOperand('pointOnCurve');
      default:
        return unreachable(curve, 'curve');
    }
  },
  horizontal: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[1] - a[1]];
  },
  vertical: (c) => (g) => {
    const [a, b] = lineOf(g, c.line);
    return [b[0] - a[0]];
  },
  parallel: (c, g0) => {
    const scale = nonZero(Math.max(len(direction(g0, c.a)), len(direction(g0, c.b))));
    return (g) => [cross(direction(g, c.a), direction(g, c.b)) / scale];
  },
  perpendicular: (c, g0) => {
    const scale = nonZero(Math.max(len(direction(g0, c.a)), len(direction(g0, c.b))));
    return (g) => [dot(direction(g, c.a), direction(g, c.b)) / scale];
  },
  equalLength: (c) => (g) => [len(direction(g, c.a)) - len(direction(g, c.b))],
  equalRadius: (c) => (g) => [g.radius(c.a) - g.radius(c.b)],
  // Positions are given relative to a point of the constraint, not to the origin of the sketch, so
  // the coordinates are measured from the origin point: two equations over an ordinary variable point.
  fixed: (c) => (g) => {
    const [p, o] = [g.point(c.point), g.point(ORIGIN)];
    return [p[0] - o[0] - c.x, p[1] - o[1] - c.y];
  },
  // Tečnost má dvě podoby. Obecně: vzdálenost středu od přímky (nebo středů od sebe) odpovídá
  // poloměrům. Drží-li ale ostatní vazby na kružnici už určující bod druhé křivky (konec úsečky,
  // konec oblouku), říká tahle rovnice v prvním řádu totéž co ony: soustava má v řešení
  // dvojnásobný kořen. Tečnost pak znamená, že poloměr v tom bodě je kolmý na úsečku, respektive
  // že oba středy a společný bod leží na přímce. Když bod na kružnici leží jen shodou okolností
  // nebo až díky tečnosti samé, platí obecná podoba: jinak by z rozboru vypadl poloměr.
  tangent: (c, g0, held, joined) => {
    const [first, second] = g0.curve(c.a).type === 'line' ? [c.a, c.b] : [c.b, c.a];
    const onCircle = (point: Id, round: Id, size: number): boolean => Math.abs(len(sub(g0.point(point), centerOf(g0, round))) - g0.radius(round)) <= SHARED * nonZero(size);
    const ends = (round: Id): Id[] => {
      const curve = g0.curve(round);
      switch (curve.type) {
        case 'arc':
          return [curve.start, curve.end];
        case 'line':
        case 'circle':
          return [];
        case 'spline':
          return neverAnOperand('tangent');
        default:
          return unreachable(curve, 'curve');
      }
    };
    const firstCurve = g0.curve(first);
    switch (firstCurve.type) {
      case 'line': {
        const line = firstCurve;
        const size = Math.max(len(direction(g0, first)), g0.radius(second));
        const shared = [line.a, line.b].find((point) => onCircle(point, second, size) && held(point, second));
        if (shared !== undefined) {
          return (g) => {
            const u = direction(g, first);
            return [dot(sub(centerOf(g, second), g.point(shared)), u) / nonZero(len(u))];
          };
        }
        // The adapter's rule by place: an end of the arc on a fixed point within the fixed join of
        // a fixed end of the line. The adapter then solves the radius to that end square to the
        // line, so the analysis reads that equation, also where the end of the line lies off the
        // circle by more than SHARED of the size (an own arc under 1 mm; the review of 6f, kind 1).
        const end = joined(first, second);
        if (end !== undefined) {
          return (g) => {
            const u = direction(g, first);
            return [dot(sub(centerOf(g, second), g.point(end)), u) / nonZero(len(u))];
          };
        }
        const side = (g: Geometry): number => {
          const [a, b] = lineOf(g, first);
          return cross(sub(b, a), sub(centerOf(g, second), a)) / nonZero(len(sub(b, a)));
        };
        const s = sign(side(g0));
        return (g) => [s * side(g) - g.radius(second)];
      }
      case 'circle':
      case 'arc':
        break;
      case 'spline':
        return neverAnOperand('tangent');
      default:
        return unreachable(firstCurve, 'curve');
    }
    const [r1, r2] = [g0.radius(first), g0.radius(second)];
    const touches = (point: Id, round: Id): boolean => onCircle(point, round, Math.max(r1, r2)) && held(point, round);
    const shared = [...ends(first).filter((point) => touches(point, second)), ...ends(second).filter((point) => touches(point, first))][0];
    if (shared !== undefined) {
      const scale = nonZero(Math.max(r1, r2));
      return (g) => [cross(sub(centerOf(g, first), g.point(shared)), sub(centerOf(g, second), g.point(shared))) / scale];
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

  // Odečte průmět do báze; vrací zbytek a složky v bázi. Když se odečetla větší část vektoru,
  // zbytek nese zaokrouhlovací chybu a odečítá se podruhé; jinak stačí jeden průchod.
  private reduce(vector: Float64Array): { rest: Float64Array; parts: Float64Array } {
    const rest = Float64Array.from(vector);
    const parts = new Float64Array(this.q.length);
    const before = norm(vector);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.q.length; i++) {
        const qi = this.q[i];
        let d = 0;
        for (let k = 0; k < rest.length; k++) d += rest[k] * qi[k];
        if (d === 0) continue;
        for (let k = 0; k < rest.length; k++) rest[k] -= d * qi[k];
        parts[i] += d;
      }
      if (norm(rest) > 0.5 * before) break;
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

    // Rovnice se vyhodnocují v polohách vzhledem k bodu vazby (`origin`), ne k počátku skici:
    // malý útvar daleko od počátku by jinak ztratil přesnost v zaokrouhlení souřadnic.
    // Derivuje se posunem jedné proměnné (`moved`) o `shift`.
    let origin: Vec2 = [0, 0];
    let moved = -1;
    let shift = 0;
    const geometry: Geometry = {
      point: (id) => {
        const index = at.get(id);
        if (index === undefined) return [input.points[id].x - origin[0], input.points[id].y - origin[1]];
        return [values[index] - origin[0] + (index === moved ? shift : 0), values[index + 1] - origin[1] + (index + 1 === moved ? shift : 0)];
      },
      curve: (id) => input.curves[id],
      radius: (id) => {
        const curve = input.curves[id];
        switch (curve.type) {
          case 'arc':
            return len(sub(geometry.point(curve.start), geometry.point(curve.center)));
          case 'circle':
          case 'line': {
            // a circle: its variable, or its value when it is fixed (a line is never asked)
            const index = radiusAt.get(id);
            return index === undefined ? input.radii[id] : values[index] + (index === moved ? shift : 0);
          }
          case 'spline':
            return neverAnOperand('a radius');
          default:
            return unreachable(curve, 'curve');
        }
      },
    };
    const pointsOf = (entity: Id): Id[] => {
      const curve = input.curves[entity];
      if (!curve) return [entity];
      return curvePoints(curve);
    };

    // Jednotkové řádky Jacobiho matice numerickou derivací; krok se řídí velikostí geometrie,
    // které se vazba týká. Řádek rovnice, která v tomto stavu nic neurčuje, je undefined.
    let extent = 0;
    for (const p of Object.values(input.points)) extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    let residual = 0;
    const derive = (build: (g0: Geometry) => Equations, entities: Id[]): (Float64Array | undefined)[] => {
      const points = [...new Set(entities.flatMap(pointsOf))];
      const outer = origin; // derive se volá i zevnitř `build` (otázka tečnosti)
      origin = points.length > 0 ? [input.points[points[0]].x, input.points[points[0]].y] : [0, 0];
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
        const curve = input.curves[entity];
        if (curve) {
          switch (curve.type) {
            case 'line':
            case 'spline': // no radius (a spline is never an operand; its points are)
              break;
            case 'circle':
            case 'arc':
              size = Math.max(size, geometry.radius(entity));
              break;
            default:
              unreachable(curve, 'curve');
          }
        }
      }
      const step = STEP * (size > 0 ? size : nonZero(extent));
      const equations = build(geometry);
      const base = equations(geometry);
      for (const off of base) residual = Math.max(residual, Math.abs(off));
      const vectors = base.map(() => new Float64Array(count));
      for (const index of touched) {
        moved = index;
        shift = step;
        const plus = equations(geometry);
        shift = -step;
        const minus = equations(geometry);
        for (let e = 0; e < vectors.length; e++) vectors[e][index] = (plus[e] - minus[e]) / (2 * step);
      }
      moved = -1;
      origin = outer;
      return vectors.map(normalized);
    };

    // Tečnost se ptá, jestli bod drží na kružnici ostatní vazby. Proto se nejdřív spočítají řádky
    // všeho ostatního; z nich se (jen když je to potřeba) postaví báze, proti které se otázka řeší.
    const ends = { points: input.points, fixed };
    const joined: JoinedByPlace = (line, arc) => {
      const [l, a] = [input.curves[line], input.curves[arc]];
      if (l?.type !== 'line' || a?.type !== 'arc') return undefined;
      const found = commonEnd(l, a, input.constraints, ends);
      return found?.byPlace ? found.end : undefined;
    };
    const arcRows = Object.values(input.curves).flatMap((curve) => (curve.type === 'arc' ? derive(() => arcRule(curve), [curve.center, curve.start, curve.end]) : []));
    this.order = Object.keys(input.constraints);
    const operands = (c: Constraint): Id[] => CONSTRAINTS[c.type].operands.map((operand) => (c as unknown as Record<string, Id>)[operand.field]);
    const rowsOf = (id: Id, held: Held): (Float64Array | undefined)[] => {
      const c = input.constraints[id];
      const build = EQUATIONS[c.type] as (c: Constraint, g0: Geometry, held: Held, joined: JoinedByPlace) => Equations;
      return derive((g0) => build(c, g0, held, joined), operands(c));
    };
    const built = new Map<Id, (Float64Array | undefined)[]>();
    for (const id of this.order) if (input.constraints[id].type !== 'tangent') built.set(id, rowsOf(id, () => false));
    let others: Basis | undefined;
    const held: Held = (point, round) => {
      const [row] = derive(() => (g) => [len(sub(g.point(point), centerOf(g, round))) - g.radius(round)], [point, round]);
      if (!row) return true; // začátek oblouku na něm leží z definice
      if (!others) {
        others = new Basis();
        for (const vector of [...arcRows, ...this.order.flatMap((id) => built.get(id) ?? [])]) if (vector) others.add(vector, 0);
      }
      return norm(others.outside(row)) <= DEPENDENT;
    };
    for (const id of this.order) if (!built.has(id)) built.set(id, rowsOf(id, held));
    for (const vector of arcRows) this.rows.push({ owner: undefined, vector });
    for (const id of this.order) for (const vector of built.get(id) as (Float64Array | undefined)[]) this.rows.push({ owner: id, vector });
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
    const next = random(1);
    for (let attempt = 0; motions.length < this.degreesOfFreedom && attempt < 4 * this.degreesOfFreedom + 8; attempt++) {
      const probe = Float64Array.from({ length: this.count }, next);
      const rest = this.basis.outside(probe);
      for (let pass = 0; pass < 2; pass++) {
        for (const motion of motions) {
          let d = 0;
          for (let k = 0; k < rest.length; k++) d += rest[k] * motion[k];
          for (let k = 0; k < rest.length; k++) rest[k] -= d * motion[k];
        }
      }
      const length = norm(rest);
      if (length > PROBE * norm(probe)) motions.push(rest.map((value) => value / length));
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

  // Sada ostatních vazeb, ze kterých vazba plyne a ze které už nejde nic ubrat; undefined =
  // neplyne z nich. Sad může být víc: `prefer` říká, které vazby mají mít přednost (menší číslo dřív).
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
    // Vazba se dvěma rovnicemi se do báze může dostat jen jednou z nich a druhou za ni zastoupí
    // jiná vazba, která pak v sadě zbytečně zůstane. Proto se ze sady zkouší ubírat, od nejméně
    // vhodných vazeb: co jde vynechat, aniž vazba přestane plynout, tam nepatří.
    const targets = own.map((index) => this.rows[index].vector).filter((vector) => vector !== undefined);
    const follows = (from: Set<Id>): boolean => {
      const span = new Basis();
      this.rows.forEach((row, index) => row.vector && (row.owner === undefined || from.has(row.owner)) && span.add(row.vector, index));
      return targets.every((vector) => norm(span.outside(vector)) <= DEPENDENT);
    };
    const order = (id: Id): number => position.get(id) as number;
    for (const id of [...implied].sort((a, b) => prefer(b) - prefer(a) || order(b) - order(a))) {
      implied.delete(id);
      if (!follows(implied)) implied.add(id);
    }
    return [...implied].sort((a, b) => order(a) - order(b));
  }
}
