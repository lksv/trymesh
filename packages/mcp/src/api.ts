// Popis API enginu pro AI. Sestavuje se ze zdrojů enginu, ne z ručně psaného seznamu: typy
// dokumentu a příkazů se berou přímo ze zdrojového textu types.ts a vazby z katalogu, kterým se
// řídí validace; typy features z registru enginu. Co engine přijme, to popis obsahuje, a naopak.
import { CONSTRAINTS, FEATURE_TYPE_INFO, type FeatureTypeInfo } from '@trymesh/engine';
import typesSource from '../../engine/src/types.ts?raw';

const CONVENTIONS = [
  'Délky jsou v milimetrech, úhly v radiánech. Souřadnice skici jsou v její rovině (osy X a Y skici), počátek skici je pevný bod s ID `origin`.',
  'Dokument je časová osa features. Geometrie se vždy odvozuje přehráním; příkazy mění dokument a engine přepočítá, co na změně závisí. Rovinu a vysunutí mění příkaz updateFeature: uvedená pole se s feature slučují, takže stačí poslat jen to, co se mění (například `{ extent: { distance: 12 } }`).',
  'ID volí volající. Musí být jedinečné v celém dokumentu (features i entity všech skic), nesmí obsahovat `/` a nesmí být `origin`.',
  'Skica se kreslí přibližně a geometrii určují vazby a kóty: body se zadají odhadem, solver je po každém příkazu posune tak, aby vazby platily. Více příkazů ke skice je lepší poslat jedním příkazem `batch`; řeší se pak jednou.',
  'Křivky odkazují na body: úsečka má `a`, `b`; kružnice `center` a poloměr (parametr `radius` příkazu addCurve); oblouk `center`, `start`, `end` a vede proti směru hodin. Křivky se spojují sdílením bodu nebo vazbou coincident.',
  'Stejnou řídicí vazbu (stejný typ a operandy) nejde přidat dvakrát. Kóta s `driving: false` jen měří.',
  'Uzavřené oblasti skici (`regions` ve výsledku get_sketch) se vysouvají příkazem addFeature s feature typu extrude: `profile` je `{ type: "regions", sketch, regions }`, kde `regions` je seznam `{ outerLoop }` převzatý z get_sketch, a `extent` je `{ type: "distance", start, distance }`. `start` je posun začátku od roviny skici (obvykle 0), `distance` se měří od začátku; kladná míří ve směru normály roviny skici, u skici na stěně ven z tělesa.',
  'ID tělesa je ID vysunutí s operací `new`. Operace `add` a `cut` potřebují `targets`: seznam s jedním cílovým tělesem.',
  'Stěny a hrany se jmenují podle svého původu: stěna `{ feature, role: side, curve }` vznikla z křivky skici, `startCap` je víko na začátku rozsahu (při nulovém `start` v rovině skici), `endCap` protější víko. Hrana je dvojice jmen stěn. Jména platná pro těleso vrací get_body.',
  'Promítnutá hrana (addExternal) je ve skice pevná křivka: úsečka má odvozené body `<id>/a` a `<id>/b`, kružnice `<id>/center`. Jde k nim vázat a kótovat.',
  'Chyba přepočtu (rozbitý odkaz, konflikt vazeb) není chyba příkazu: příkaz se provede a problém je ve stavu feature. Po každém execute zkontroluj `problems`.',
  'Diagnostika skici: get_sketch vrací stupně volnosti, volné entity, vazby navíc a radu, co chybí; explain_constraint říká, z čeho vazba plyne.',
];

// Typy dokumentu, výsledku přepočtu a příkazů. Porty (rozhraní solveru a jádra) AI nepotřebuje.
export function engineTypes(): string {
  const marker = (name: string) => new RegExp(`^// -+ ${name}$`, 'm');
  const [ports, evaluation] = [typesSource.search(marker('porty')), typesSource.search(marker('přepočet'))];
  if (ports < 0 || evaluation < ports) return typesSource;
  const note = '// (Rozhraní solveru a geometrického jádra jsou vynechána. `Solid` je trojúhelníková síť tělesa:\n// positions, triangles, faceIds; přes nástroje se nepřenáší, těleso popisuje get_body.)\n\n';
  return typesSource.slice(0, ports) + note + typesSource.slice(evaluation);
}

export interface ConstraintDescription {
  type: string;
  title: string;
  summary: string;
  operands: { field: string; kinds: string[] }[];
  value?: { unit: string; rule: string };
  example: Record<string, unknown>;
}

const RULES: Record<string, string> = { nonNegative: 'nezáporná', positive: 'kladná', any: 'libovolná (orientovaná)', angle: 'v intervalu (−π, π]' };

export function constraintCatalog(): ConstraintDescription[] {
  return Object.entries(CONSTRAINTS).map(([type, spec]) => ({
    type,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ field: operand.field, kinds: [...operand.kinds] })),
    ...(spec.value ? { value: { unit: spec.value.unit, rule: RULES[spec.value.rule] } } : {}),
    example: { type, ...Object.fromEntries(spec.operands.map((operand) => [operand.field, `<${operand.kinds.join('|')}>`])), ...(spec.value ? { value: spec.value.unit === 'rad' ? 1.5708 : 10, driving: true } : {}) },
  }));
}

export type FeatureDescription = FeatureTypeInfo & { type: string };

export function featureCatalog(): FeatureDescription[] {
  return Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => ({ type, ...info }));
}

export function apiDescription(): { conventions: string[]; features: FeatureDescription[]; constraints: ConstraintDescription[]; types: string } {
  return { conventions: CONVENTIONS, features: featureCatalog(), constraints: constraintCatalog(), types: engineTypes() };
}

// Tentýž popis jako souvislý text: tak ho dostane AI.
export function apiText(): string {
  const { conventions, features, constraints, types } = apiDescription();
  const feature = (entry: FeatureDescription): string => {
    const body = entry.bodies === 'self' ? ' Může vytvořit těleso se svým ID.' : '';
    const update = entry.updatable.length > 0 ? ` updateFeature mění pole: ${entry.updatable.join(', ')}.` : ' Obsah mění vlastní příkazy, ne updateFeature.';
    return `- ${entry.type} (${entry.title}): ${entry.summary}${body}${update}`;
  };
  const constraint = (entry: ConstraintDescription): string => {
    const operands = entry.operands.map((operand) => `${operand.field}: ${operand.kinds.join(' | ')}`).join(', ');
    const value = entry.value ? `; value: ${entry.value.rule}, ${entry.value.unit}` : '';
    return `- ${entry.type} (${entry.title}) { ${operands}${value} }: ${entry.summary}\n  příklad: ${JSON.stringify(entry.example)}`;
  };
  return [
    '# Konvence',
    ...conventions.map((line) => `- ${line}`),
    '',
    '# Features',
    'Feature je objekt `feature` příkazu addFeature; přesný tvar je v typech níže.',
    ...features.map(feature),
    '',
    '# Vazby a kóty',
    'Vazba je objekt `constraint` příkazu addConstraint. Operandy jsou ID entit skici daného druhu; kóty mají navíc `value` a `driving`.',
    ...constraints.map(constraint),
    '',
    '# Typy (TypeScript, ze zdroje enginu)',
    'Příkaz je hodnota typu Command; dokument typu Document.',
    '```ts',
    types.trim(),
    '```',
  ].join('\n');
}
