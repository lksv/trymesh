// Katalog vazeb: jediný zdroj pravdy o tom, jaké vazby engine zná, jaké mají operandy a hodnoty.
// Řídí se jím validace příkazů, hledání duplicit a popis API pro UI a pro AI (MCP). Nová vazba
// je položka zde, její typ v types.ts a překlad v adaptéru solveru; nic dalšího o ní vědět nemusí.
import type { Constraint, Id } from './types';

export type EntityKind = 'point' | 'line' | 'circle' | 'arc';

export interface OperandSpec {
  field: string; // jméno operandu ve vazbě
  kinds: EntityKind[]; // jaké entity skici operand přijímá
}

// Pravidlo pro hodnotu kóty a její jednotka.
export interface ValueSpec {
  rule: 'nonNegative' | 'positive' | 'any' | 'angle';
  unit: 'mm' | 'rad';
}

export interface ConstraintSpec {
  title: string; // krátké jméno pro uživatele
  summary: string; // co vazba zajišťuje a jak se čtou operandy
  operands: OperandSpec[];
  unordered?: string[]; // operandy, na jejichž pořadí nezáleží (u orientovaných kót záměna jen obrací znaménko)
  value?: ValueSpec; // jen u kót
  // Dodatečné pravidlo nad operandy (v pořadí `operands`): jejich druhy, ID a body, kterými je
  // křivka určená. Vrací text chyby.
  check?: (kinds: EntityKind[], ids: Id[], pointsOf: (curve: Id) => Id[]) => string | undefined;
}

const POINT: EntityKind[] = ['point'];
const LINE: EntityKind[] = ['line'];
const ROUND: EntityKind[] = ['circle', 'arc'];
const CURVE: EntityKind[] = ['line', 'circle', 'arc'];
const pair = (kinds: EntityKind[]): Pick<ConstraintSpec, 'operands' | 'unordered'> => ({
  operands: [
    { field: 'a', kinds },
    { field: 'b', kinds },
  ],
  unordered: ['a', 'b'],
});
const LENGTH: ValueSpec = { rule: 'nonNegative', unit: 'mm' };

export const CONSTRAINTS: Record<Constraint['type'], ConstraintSpec> = {
  coincident: { title: 'Totožné', summary: 'Dva body leží na stejném místě.', ...pair(POINT) },
  pointOnCurve: {
    title: 'Bod na křivce',
    summary: 'Bod leží na úsečce (i na jejím prodloužení), kružnici nebo oblouku.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'curve', kinds: CURVE },
    ],
  },
  horizontal: { title: 'Vodorovně', summary: 'Úsečka je rovnoběžná s osou X skici.', operands: [{ field: 'line', kinds: LINE }] },
  vertical: { title: 'Svisle', summary: 'Úsečka je rovnoběžná s osou Y skici.', operands: [{ field: 'line', kinds: LINE }] },
  parallel: { title: 'Rovnoběžně', summary: 'Dvě úsečky jsou rovnoběžné.', ...pair(LINE) },
  perpendicular: { title: 'Kolmo', summary: 'Dvě úsečky jsou na sebe kolmé.', ...pair(LINE) },
  equalLength: { title: 'Stejná délka', summary: 'Dvě úsečky mají stejnou délku.', ...pair(LINE) },
  tangent: {
    title: 'Tečně',
    summary: 'Úsečka se dotýká kružnice nebo oblouku, nebo se dotýkají dvě kružnice či oblouky.',
    ...pair(CURVE),
    check: (kinds) => (kinds.every((kind) => kind === 'line') ? 'tečnost dvou úseček nedává smysl' : undefined),
  },
  symmetric: {
    title: 'Souměrně',
    summary: 'Body a, b jsou souměrné podle přímky, na které leží úsečka line (osa souměrnosti).',
    operands: [
      { field: 'a', kinds: POINT },
      { field: 'b', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    unordered: ['a', 'b'],
    check: (_kinds, [a, b, line], pointsOf) => (pointsOf(line).includes(a) || pointsOf(line).includes(b) ? 'souměrný bod nesmí být koncem osy' : undefined),
  },
  midpoint: {
    title: 'Střed úsečky',
    summary: 'Bod leží přesně v polovině úsečky.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    check: (_kinds, [point, line], pointsOf) => (pointsOf(line).includes(point) ? 'středem úsečky nemůže být její konec' : undefined),
  },
  distance: { title: 'Vzdálenost', summary: 'Vzdálenost dvou bodů.', ...pair(POINT), value: LENGTH },
  distancePointLine: {
    title: 'Vzdálenost bodu od úsečky',
    summary: 'Kolmá vzdálenost bodu od přímky, na které úsečka leží.',
    operands: [
      { field: 'point', kinds: POINT },
      { field: 'line', kinds: LINE },
    ],
    value: LENGTH,
  },
  horizontalDistance: { title: 'Vodorovná vzdálenost', summary: 'Orientovaný rozdíl souřadnic X: b.x − a.x.', ...pair(POINT), value: { rule: 'any', unit: 'mm' } },
  verticalDistance: { title: 'Svislá vzdálenost', summary: 'Orientovaný rozdíl souřadnic Y: b.y − a.y.', ...pair(POINT), value: { rule: 'any', unit: 'mm' } },
  angle: {
    title: 'Úhel',
    summary: 'Úhel od směru úsečky a ke směru úsečky b, proti směru hodin, v intervalu (−π, π]. Směr úsečky vede od jejího bodu a k bodu b.',
    ...pair(LINE),
    value: { rule: 'angle', unit: 'rad' },
  },
  radius: { title: 'Poloměr', summary: 'Poloměr kružnice nebo oblouku.', operands: [{ field: 'curve', kinds: ROUND }], value: { rule: 'positive', unit: 'mm' } },
  diameter: { title: 'Průměr', summary: 'Průměr kružnice nebo oblouku.', operands: [{ field: 'curve', kinds: ROUND }], value: { rule: 'positive', unit: 'mm' } },
};

export const VALUE_RULES: Record<ValueSpec['rule'], { check: (value: number) => boolean; message: string }> = {
  nonNegative: { check: (value) => value >= 0, message: 'vzdálenost nesmí být záporná' },
  positive: { check: (value) => value > 0, message: 'poloměr a průměr musí být kladné' },
  any: { check: () => true, message: '' },
  angle: { check: (value) => value > -Math.PI && value <= Math.PI, message: 'úhel musí ležet v intervalu (−π, π]' },
};
