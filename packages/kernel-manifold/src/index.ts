// Adaptér portu SolidKernel nad Manifoldem (CSG nad trojúhelníkovými sítěmi ve WASM).
// Kontrakt portu je v docs/architecture.md, sekce SolidKernel.
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { BooleanOp, Solid, SolidKernel } from '@trymesh/engine';
import { clean, cleanBySubdivision, isClosed, isFolded } from './clean';
import { prepareTool, restoreShifted } from './coplanar';
import { type Tolerances, tolerances } from './geometry';

export interface ManifoldKernelOptions {
  // Kde najít manifold.wasm (v browseru); v Node se najde sám.
  locateFile?: (file: string) => string;
}

// Vypnutí kroků adaptéru; jen pro testy, které ukazují, proč jsou potřeba.
export interface BooleanOptions {
  prepare?: boolean; // posun stěn v jedné rovině před booleanem
  restore?: boolean; // návrat posunutých stěn po booleanu
  second?: boolean; // the second cleaning of an intersection the first one leaves open or folded (D51)
}

export interface ManifoldKernel extends SolidKernel {
  boolean(op: BooleanOp, a: Solid, b: Solid, options?: BooleanOptions): Solid;
  // Přístup ke knihovně pro testy (průřezy, rozklad na komponenty).
  readonly wasm: ManifoldToplevel;
  toManifold(s: Solid): Manifold;
  // How often `boolean` ran the second cleaning (D51), for the tests that show which operations reach it.
  readonly secondCleanings: number;
}

export async function createManifoldKernel(options: ManifoldKernelOptions = {}): Promise<ManifoldKernel> {
  const locateFile = options.locateFile;
  const wasm = await Module(locateFile ? { locateFile: () => locateFile('manifold.wasm') } : undefined);
  wasm.setup();

  // Objekty knihovny žijí v paměti WASM a uvolňují se ručně.
  const toManifold = (s: Solid): Manifold =>
    new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(s.positions), triVerts: s.triangles, faceID: s.faceIds }));

  const rawBoolean = (op: BooleanOp, a: Solid, b: Solid): Solid => {
    const owned: Manifold[] = [];
    const keep = (m: Manifold) => {
      owned.push(m);
      return m;
    };
    try {
      // Vstup se ověřuje před předáním knihovně. Ta vadnou síť odmítne výjimkou, ale objekt, který
      // přitom zahodí, neuvolní; a obrácenou orientaci nebo čísla stěn od 2^31 přijme potichu.
      const load = (name: string, s: Solid): Manifold => {
        const problem = inputProblem(s);
        if (problem) throw new Error(`jádro nepřijalo vstup (${name}): ${problem}`);
        try {
          return keep(toManifold(s));
        } catch (error) {
          throw new Error(`jádro nepřijalo vstup (${name}): ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      const A = load('těleso', a);
      const B = load('nástroj', b);
      const result = keep(op === 'union' ? A.add(B) : op === 'difference' ? A.subtract(B) : A.intersect(B));
      if (result.status() !== 'NoError') throw new Error(`boolean selhal: ${result.status()}`);
      const mesh = result.getMesh();
      // kopie: pole z knihovny mohou ukazovat do paměti WASM
      return { positions: Float32Array.from(mesh.vertProperties), triangles: Uint32Array.from(mesh.triVerts), faceIds: Uint32Array.from(mesh.faceID) };
    } finally {
      for (const m of owned) m.delete();
    }
  };

  let secondCleanings = 0;

  return {
    wasm,
    toManifold,
    get secondCleanings() {
      return secondCleanings;
    },

    boolean(op, a, b, { prepare = true, restore = true, second = true } = {}) {
      // The precondition of the port for a union and a difference (D56): the two operands share no
      // face number. The adapter tells the faces of the tool from those of the body by their
      // numbers; with a shared number a union comes out with a wrong volume without a word.
      if (op !== 'intersection') {
        const shared = sharedFace(a, b);
        if (shared !== undefined) throw new Error(`the operands of a ${op} share the face number ${shared}; a union and a difference take operands whose face numbers differ (the precondition of the port)`);
      }
      if (!prepare) return rawBoolean(op, a, b);
      const t = tolerances(a, b);
      const { tool, shifts } = prepareTool(op, a, b, t);
      const raw = rawBoolean(op, a, tool);
      // Síť se čistí vždy, i když se nic neposouvalo: kde se nástroj tělesa jen dotkne hranou,
      // nechává jádro nulové trojúhelníky s číslem stěny nástroje a stěna by se tvářila, že existuje.
      const out = restore && shifts.size > 0 ? restoreShifted(raw, shifts, b, tool, a, t) : clean(raw, t.weld);
      const refusal = verify(out, t);
      if (!refusal) return out;
      // An intersection of slivers can leave the loop of `clean` going round in a cycle and stopping
      // open or folded (D51). It is cleaned again from the raw mesh (for an intersection nothing is
      // moved) by the cleaning that cannot end open, and held to the same checks; what the first
      // cleaning verifies is returned as before. A union and a difference never get here: the
      // second cleaning may leave a null triangle carrying the number of a face that should be gone.
      if (op === 'intersection' && second && shifts.size === 0) {
        secondCleanings++;
        const again = cleanBySubdivision(raw, t.weld);
        if (!verify(again, t)) return again;
      }
      throw new Error(refusal);
    },

    // The intersection as the library returns it (D50): no faces moved before, no cleaning after,
    // and one check, that it is closed by its indices (guarantee 3 of the port). Every refused
    // pose looked at gave a closed mesh; one that is not would otherwise be measured without
    // a word.
    intersectionAsComputed(a, b) {
      const mesh = rawBoolean('intersection', a, b);
      if (!isClosed(mesh)) throw new Error('the intersection as computed is not closed by its indices');
      return { unverified: mesh };
    },

    // Vnější smyčka proti směru hodin, díry po směru; trojúhelníky pak vycházejí proti směru hodin.
    triangulate(loops) {
      if (loops.length === 0) return new Uint32Array(0);
      for (const loop of loops) {
        if (loop.length % 2 !== 0 || loop.length < 6) throw new Error('triangulace: smyčka potřebuje aspoň tři body (dvojice x, y)');
        if (!loop.every(Number.isFinite)) throw new Error('triangulace: souřadnice musí být konečná čísla');
      }
      // Obalová funkce knihovny neuvolňuje vektor s výsledkem ani dočasné vektory smyček (u velké
      // smyčky kilobajty na volání). Volá se proto funkce pod ní a vše se uvolní zde.
      const raw = wasm as unknown as RawTriangulate;
      const outer = new raw.Vector2_vec2();
      const inner: EmbindVector[] = [];
      try {
        for (const loop of loops) {
          const points = new raw.Vector_vec2();
          inner.push(points);
          for (let i = 0; i < loop.length; i += 2) points.push_back({ x: loop[i], y: loop[i + 1] });
          outer.push_back(points);
        }
        const result = raw._Triangulate(outer, -1, true);
        try {
          const out = new Uint32Array(result.size() * 3);
          for (let i = 0; i < result.size(); i++) {
            const triangle = result.get(i) as Record<number, number>;
            for (let k = 0; k < 3; k++) out[3 * i + k] = triangle[k];
          }
          return out;
        } finally {
          result.delete();
        }
      } finally {
        for (const points of inner) points.delete();
        outer.delete();
      }
    },
  };
}

// The two checks of a cleaned result; the message of the refusal, or undefined when it passes.
function verify(out: Solid, t: Tolerances): string | undefined {
  if (!isClosed(out)) return 'výsledek booleanu není uzavřená plocha (těleso se nejspíš samo sebe dotýká jen hranou nebo vrcholem)';
  // Detail menší než přesah (asi 1e-4 rozměru modelu) těsně u lícujících stěn návrat nezvládne:
  // vrcholy se při něm předběhnou a trojúhelník se otočí. Lepší chyba než potichu vadná síť.
  if (isFolded(out, t) || isFolded(out, tolerances(out))) return 'výsledek booleanu má přeložený trojúhelník (detail menší než tolerance jádra u lícujících stěn)';
  return undefined;
}

// Vnitřní rozhraní knihovny (embind), které její typy nepopisují.
interface EmbindVector {
  push_back(value: unknown): void;
  size(): number;
  get(index: number): unknown;
  delete(): void;
}
interface RawTriangulate {
  Vector2_vec2: new () => EmbindVector;
  Vector_vec2: new () => EmbindVector;
  _Triangulate(polygons: EmbindVector, epsilon: number, allowConvex: boolean): EmbindVector;
}

// A face number both solids have, or undefined: one pass over each list.
function sharedFace(a: Solid, b: Solid): number | undefined {
  const own = new Set<number>(a.faceIds);
  for (const id of b.faceIds) if (own.has(id)) return id;
  return undefined;
}

// Proč vstupní těleso nejde použít; undefined = v pořádku. Prázdné těleso je v pořádku.
function inputProblem(s: Solid): string | undefined {
  const count = s.triangles.length / 3;
  if (!Number.isInteger(count) || s.positions.length % 3 !== 0) return 'délka polí neodpovídá trojicím';
  if (s.faceIds.length !== count) return 'počet čísel stěn neodpovídá počtu trojúhelníků';
  for (const id of s.faceIds) if (id >= 0x80000000) return 'číslo stěny je mimo rozsah jádra';
  if (!s.positions.every(Number.isFinite)) return 'souřadnice nejsou konečná čísla';
  const vertexCount = s.positions.length / 3;
  for (const i of s.triangles) if (i >= vertexCount) return 'index vrcholu mimo rozsah';
  if (!isClosed(s)) return 'síť není uzavřená plocha';
  let volume = 0;
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => 3 * s.triangles[3 * t + k]);
    const p = s.positions;
    volume +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  if (volume < 0) return 'síť je orientovaná dovnitř';
  return undefined;
}
