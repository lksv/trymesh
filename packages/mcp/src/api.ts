// Popis API enginu pro AI. Sestavuje se ze zdrojů enginu, ne z ručně psaného seznamu: typy
// dokumentu a příkazů se berou přímo ze zdrojového textu types.ts a vazby z katalogu, kterým se
// řídí validace; typy features z registru enginu. Co engine přijme, to popis obsahuje, a naopak.
import { CONSTRAINTS, EXPRESSION_CONSTANTS, EXPRESSION_FUNCTIONS, EXPRESSION_SYNTAX, FEATURE_TYPE_INFO, type FeatureTypeInfo, type NumberSpec, rangeText } from '@trymesh/engine';
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
  'Parameters: the document has a table of named parameters (command setParameter, a name and an expression). A numeric field of a feature and the value of a driving dimension accept an expression as a string instead of a number, for example `{ extent: { distance: "thickness * 2" } }` or `value: "module * Zs"`. The section Numeric fields lists those fields; elsewhere a string in place of a number is an error. The engine evaluates the expression, fills the number into the field and stores the expression in `expressions` of the feature under the field address. After a parameter changes the model is recomputed.',
  'An expression in a feature field must evaluate right away (the parameters it uses must exist), otherwise the command is invalid. A parameter itself may refer to a parameter that does not exist yet; get_parameters returns its state. A number sent to a field with an expression removes the expression; fields updateFeature does not mention keep theirs. The command setField (`{ feature, path, value }`) changes a single field.',
  'Angles are in radians both as a number and in an expression; degrees are written with the function `deg()`: an angle of 30° is `"deg(30)"`. Angle fields have ranges in radians, so a value entered in degrees by mistake is an invalid command.',
  'Checks (command setCheck) are expressions with a comparison that are supposed to hold, for example `Zs % 3 == 0`. A check that fails does not stop the model; execute returns it in `failedChecks`.',
  'A recompute error (a broken reference, conflicting constraints, an expression that can no longer be evaluated) is not a command error: the command is carried out and the problem is in the feature state. After every execute check `problems`, `failedChecks` and `parameterErrors`.',
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

export function constraintCatalog(): ConstraintDescription[] {
  return Object.entries(CONSTRAINTS).map(([type, spec]) => ({
    type,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ field: operand.field, kinds: [...operand.kinds] })),
    ...(spec.values?.value ? { value: { unit: spec.values.value.unit, rule: rangeText(spec.values.value) } } : {}),
    example: {
      type,
      ...Object.fromEntries(spec.operands.map((operand) => [operand.field, `<${operand.kinds.join('|')}>`])),
      ...Object.fromEntries(Object.entries(spec.values ?? {}).map(([name, value]) => [name, value.unit === 'rad' ? 1.5708 : 10])),
      ...(spec.dimension ? { driving: true } : {}),
    },
  }));
}

export type FeatureDescription = FeatureTypeInfo & { type: string };

const fieldText = (spec: NumberSpec): string => `${spec.title}, ${spec.unit}, ${rangeText(spec)}${spec.default === undefined ? '' : `, default ${spec.default}`}`;

// Expression syntax: operators, functions and constants.
export function expressionSyntax(): { syntax: string; functions: { name: string; signature: string; summary: string }[]; constants: { name: string; summary: string }[] } {
  return {
    syntax: EXPRESSION_SYNTAX,
    functions: Object.entries(EXPRESSION_FUNCTIONS).map(([name, spec]) => ({ name, signature: `${name}(${spec.variadic ? 'a, b, …' : Array.from({ length: spec.args }, (_, i) => 'abc'[i]).join(', ')})`, summary: spec.summary })),
    constants: Object.entries(EXPRESSION_CONSTANTS).map(([name, spec]) => ({ name, summary: spec.summary })),
  };
}

// Numeric fields that accept an expression: feature fields and dimension values.
export function numericFields(): { owner: string; path: string; description: string }[] {
  return [
    ...Object.entries(FEATURE_TYPE_INFO).flatMap(([type, info]) =>
      info.fields.map((field) => ({ owner: type, path: field.path, description: fieldText(field.spec) + (field.when ? ` (only when ${field.when.path} is ${field.when.equals})` : '') })),
    ),
    ...Object.entries(CONSTRAINTS).flatMap(([type, spec]) =>
      Object.entries(spec.values ?? {}).map(([name, value]) => ({ owner: `sketch, constraint ${type}`, path: `constraints/<id>/${name}`, description: fieldText(value) + (spec.dimension ? ' (driving dimension only)' : '') })),
    ),
  ];
}

export function featureCatalog(): FeatureDescription[] {
  return Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => ({ type, ...info }));
}

export function apiDescription(): {
  conventions: string[];
  features: FeatureDescription[];
  constraints: ConstraintDescription[];
  expressions: ReturnType<typeof expressionSyntax>;
  numericFields: ReturnType<typeof numericFields>;
  types: string;
} {
  return { conventions: CONVENTIONS, features: featureCatalog(), constraints: constraintCatalog(), expressions: expressionSyntax(), numericFields: numericFields(), types: engineTypes() };
}

// Tentýž popis jako souvislý text: tak ho dostane AI.
export function apiText(): string {
  const { conventions, features, constraints, expressions, numericFields: fields, types } = apiDescription();
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
    '# Expressions',
    expressions.syntax,
    'Functions:',
    ...expressions.functions.map((fn) => `- ${fn.signature}: ${fn.summary}`),
    'Constants:',
    ...expressions.constants.map((constant) => `- ${constant.name}: ${constant.summary}`),
    '',
    '# Numeric fields',
    'Fields that accept an expression instead of a number. The field address (`path`) is the key in `expressions` of the feature and the argument of the command setField.',
    ...fields.map((field) => `- ${field.owner}: ${field.path} (${field.description})`),
    '',
    '# Typy (TypeScript, ze zdroje enginu)',
    'Příkaz je hodnota typu Command; dokument typu Document.',
    '```ts',
    types.trim(),
    '```',
  ].join('\n');
}
