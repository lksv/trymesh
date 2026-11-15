// Popis API enginu pro AI. Sestavuje se ze zdrojů enginu, ne z ručně psaného seznamu: typy
// dokumentu a příkazů se berou přímo ze zdrojového textu types.ts a vazby z katalogu, kterým se
// řídí validace; typy features z registru enginu. Co engine přijme, to popis obsahuje, a naopak.
import {
  CONSTRAINTS,
  EXPRESSION_CONSTANTS,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_SYNTAX,
  FEATURE_TYPE_INFO,
  type FeatureTypeInfo,
  DATA_CATALOGS,
  EXPORT_FORMATS,
  type AnyExportFormat,
  GENERATORS,
  type AnyQuery,
  type ArgKind,
  type NumberSpec,
  QUERIES,
  SKETCH_TOOLS,
  type SketchToolInput,
  type SketchToolName,
  isFlag,
  rangeText,
} from '@trymesh/engine';
import typesSource from '../../engine/src/types.ts?raw';

const CONVENTIONS = [
  'Délky jsou v milimetrech, úhly v radiánech. Souřadnice skici jsou v její rovině (osy X a Y skici), počátek skici je pevný bod s ID `origin`.',
  'Dokument je časová osa features. Geometrie se vždy odvozuje přehráním; příkazy mění dokument a engine přepočítá, co na změně závisí. Rovinu, vysunutí a pole (pattern) mění příkaz updateFeature: uvedená pole se s feature slučují, takže stačí poslat jen to, co se mění (například `{ extent: { distance: 12 } }`).',
  'ID volí volající. Musí být jedinečné v celém dokumentu (features i entity všech skic), nesmí obsahovat `/` a nesmí být `origin`.',
  'Skica se kreslí přibližně a geometrii určují vazby a kóty: body se zadají odhadem, solver je po každém příkazu posune tak, aby vazby platily. Více příkazů ke skice je lepší poslat jedním příkazem `batch`; řeší se pak jednou.',
  'Křivky odkazují na body: úsečka má `a`, `b`; kružnice `center` a poloměr (parametr `radius` příkazu addCurve); oblouk `center`, `start`, `end` a vede proti směru hodin. Křivky se spojují sdílením bodu nebo vazbou coincident.',
  'Stejnou řídicí vazbu (stejný typ a operandy) nejde přidat dvakrát. Kóta s `driving: false` jen měří.',
  'A point is put at given coordinates of the sketch by the constraint `fixed` (`{ type: "fixed", point, x, y }`); without `x` and `y` it is fixed where it is (a point added in the same batch has only the estimate of its addPoint so far, because the sketch is solved after the whole batch; give such a point its coordinates). Only an own point of the sketch can be fixed, not the origin or a point of projected geometry. The coordinates are numeric fields `constraints/<id>/x` and `constraints/<id>/y` (command setField) and may be expressions. Holes of the same size share one dimension through `equalRadius`.',
  'Closed regions of a sketch (`regions` in the result of get_sketch) are extruded by the command addFeature with a feature of type extrude: `profile` is `{ type: "regions", sketch, regions }`, where `regions` is a list of `{ outerLoop }` taken from get_sketch. The extent is one of two variants. `{ type: "distance", start, distance }`: `start` is the offset of the start from the sketch plane along its normal (usually 0, may be negative), `distance` is measured from the start; a positive one points along the normal of the sketch plane, for a sketch on a face out of the body. `{ type: "throughAll", side }` is for the operation `cut` only: the tool passes through all target bodies and its length follows them at every recompute. `side` is `forward` (along the normal of the sketch plane), `backward` (against it) or `both`; on a face of a body an ordinary hole is `backward`, and `both` is the safe default unless the body reaches to both sides of the plane and only one part should be cut.',
  'The ID of a body is the ID of the extrusion with the operation `new`; a copy of a body made by a pattern has the ID `<pattern>/<number>` (numbered from 1), listed in `bodies` of the pattern in get_model. The operations `add` and `cut` need `targets`: exactly one body for `add`, one or more for `cut` (a screw hole through two bolted parts is one cut with both bodies as targets). A cut that would remove a whole target is an error and changes none of them; a target the tool does not reach is left unchanged and the warning `noEffect` lists it in `refs`.',
  'Instead of regions, the profile of an extrusion may come from a profile generator: `profile` is `{ type: "generated", generator, sketch, operands, params, refs }` (section Profile generators). `operands` name entities of the sketch, `params` take numbers, expressions and flags (what is left out gets its default), `refs` name earlier features. The generator reads only the solved operands, so the sketch needs no closed regions; pitch circles of gears in mesh touch and should be construction circles. Operation, extent and targets work as for any extrusion. The result of the feature carries `facts` (for a gear its module, diameters and the rotation used): read them with get_model to verify what was built. updateFeature merges the dictionaries by entry: `{ profile: { params: { teeth: 24 } } }` changes one parameter, `null` returns a parameter to its default or removes a reference.',
  'Gears: a gear is an extrusion with the generator involuteGear over its pitch circle; the module follows from the circle diameter and the tooth count, so dimension the circle with an expression such as `"module * Zs"`. Give every gear after the first one `refs: { meshWith: <the gear it meshes with> }`: the rotation is then computed and stays right when tooth counts change. A ring gear is a cut with `internal: true` into solid material. The warnings gearMesh (the reference could not be used, the parameter rotation was used) and gearInterference show up in `problems`.',
  'Every body in get_model and get_body has its volume in mm³ and its bounding box (`min`, `max`); use them to verify what you built. check_interference tells which bodies collide (`pairs`) and should follow any change to parts that must not overlap. Bodies that only touch do not count; a pin in a hole of the same diameter may be listed in `fits`, which is not a collision: round faces are polygons and their corners need not coincide. Each pair has a `depth`, how deep one body reaches into the other; a fit is no deeper than the chord tolerance (`tolerance` in the answer). export_stl saves all bodies into one file, or with `perBody` one file per body for printing.',
  'A pattern (feature type pattern) repeats its source around an axis. `source` is `{ type: "features", features: [...] }` (extrusions with the operation add or cut; for every copy the tool of each is built again in the turned position and applied to the targets of that extrusion, so a cut through all is measured in the direction of the copy) or `{ type: "body", body }` (the copies are new bodies). `transform` is `{ type: "circular", axis, count, span }`: `axis` is `{ kind: "base", axis: "X" | "Y" | "Z" }` or `{ kind: "sketchPoint", sketch, point }` (the normal of the sketch plane through that point). A positive angle turns counter-clockwise seen against the axis (right-hand rule; around Z it takes X towards Y); around a sketch point that is counter-clockwise in the coordinates of the sketch, so a sketch on the base plane XZ (normal −Y) turns the other way than the base axis Y. `count` includes the original, so 4 holes around a circle are count 4 and three more copies; `span` is `{ type: "full" }` (the step is the full circle divided by the count) or `{ type: "angle", angle }` (the angle between the first and the last copy). The pattern is atomic: if one copy fails, the pattern is in error, the model stays as it was before it and `refs` of the error start with `{ copy, feature }`. Copies that leave some of their targets unchanged are listed in the warning `noEffect` as `{ copy, feature, targets }` with those targets; a copy that falls onto what is cut already (the last of 5 copies over an angle of 2π lands on the original) is one of them. A pattern of features takes one boolean per copy and target on a body that keeps growing: tens of copies are fine, 200 holes take tens of seconds; a pattern of a body is cheap.',
  'Stěny a hrany se jmenují podle svého původu: stěna `{ feature, role: side, curve }` vznikla z křivky skici (for a generated profile `curve` is the side name from the generator catalog, for a gear `teeth`; such a face is not planar), `startCap` je víko na začátku rozsahu (při nulovém `start` v rovině skici), `endCap` protější víko. A face of a copy made by a pattern has the same name with `copy: [{ pattern, index }]` added (the pattern and the number of the copy; a pattern of a pattern appends another entry); faces of the original have no `copy`. Hrana je dvojice jmen stěn. Jména platná pro těleso vrací get_body.',
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
  // an import of the source file is not part of the description
  return (typesSource.slice(0, ports) + note + typesSource.slice(evaluation)).replace(/^import type .*\n/gm, '');
}

export interface ConstraintDescription {
  type: string;
  title: string;
  summary: string;
  operands: { field: string; kinds: string[] }[];
  value?: { unit: string; rule: string }; // the value of a dimension
  values?: { name: string; unit: string; rule: string }[]; // named values of a constraint that is not a dimension (a fixed point: x, y)
  example: Record<string, unknown>;
}

export function constraintCatalog(): ConstraintDescription[] {
  return Object.entries(CONSTRAINTS).map(([type, spec]) => ({
    type,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ field: operand.field, kinds: [...operand.kinds] })),
    ...(spec.dimension && spec.values?.value ? { value: { unit: spec.values.value.unit, rule: rangeText(spec.values.value) } } : {}),
    ...(!spec.dimension && spec.values ? { values: Object.entries(spec.values).map(([name, value]) => ({ name, unit: value.unit, rule: rangeText(value) })) } : {}),
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
    functions: Object.entries(EXPRESSION_FUNCTIONS).map(([name, spec]) => ({ name, signature: spec.signature, summary: spec.summary })),
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

export interface GeneratorDescription {
  generator: string;
  title: string;
  summary: string;
  operands: { name: string; kinds: string[] }[];
  params: { name: string; description: string; required: boolean }[];
  refs: { name: string; title: string; summary: string; generators: string[] }[];
  sides: string[];
  facts: { name: string; description: string }[];
  example: Record<string, unknown>;
}

// Profile generators from the catalog of the engine, each with an example profile the engine accepts
// once the operands are replaced by entities of the sketch.
export function generatorCatalog(): GeneratorDescription[] {
  return Object.entries(GENERATORS).map(([generator, spec]) => ({
    generator,
    title: spec.title,
    summary: spec.summary,
    operands: spec.operands.map((operand) => ({ name: operand.field, kinds: [...operand.kinds] })),
    params: Object.entries(spec.params).map(([name, param]) => ({
      name,
      description: isFlag(param) ? `${param.title}: true or false, default ${param.default}` : fieldText(param),
      required: !isFlag(param) && param.default === undefined,
    })),
    refs: Object.entries(spec.refs).map(([name, ref]) => ({ name, title: ref.title, summary: ref.summary, generators: [...ref.generators] })),
    sides: [...spec.sides],
    facts: Object.entries(spec.facts).map(([name, description]) => ({ name, description })),
    example: {
      type: 'generated',
      generator,
      sketch: '<sketch>',
      operands: Object.fromEntries(spec.operands.map((operand) => [operand.field, `<${operand.kinds.join('|')}>`])),
      // required parameters only; the others have defaults
      params: Object.fromEntries(Object.entries(spec.params).flatMap(([name, param]) => (isFlag(param) || param.default !== undefined ? [] : [[name, param.min?.value === undefined ? 1 : Math.max(param.min.value, 18)]]))),
    },
  }));
}

export function featureCatalog(): FeatureDescription[] {
  return Object.entries(FEATURE_TYPE_INFO).map(([type, info]) => ({ type, ...info }));
}

export function apiDescription(): {
  conventions: string[];
  features: FeatureDescription[];
  generators: GeneratorDescription[];
  constraints: ConstraintDescription[];
  expressions: ReturnType<typeof expressionSyntax>;
  numericFields: ReturnType<typeof numericFields>;
  sketchTools: SketchToolDescription[];
  queries: QueryDescription[];
  catalogs: ReturnType<typeof dataCatalogs>;
  exports: ReturnType<typeof exportFormats>;
  types: string;
} {
  return {
    conventions: CONVENTIONS,
    features: featureCatalog(),
    generators: generatorCatalog(),
    constraints: constraintCatalog(),
    expressions: expressionSyntax(),
    numericFields: numericFields(),
    sketchTools: sketchToolCatalog(),
    queries: queryCatalog(),
    catalogs: dataCatalogs(),
    exports: exportFormats(),
    types: engineTypes(),
  };
}

// The sketch tools of the engine (the tool sketch_tool runs them): inputs and the IDs they return.
export interface SketchToolDescription {
  tool: string;
  title: string;
  summary: string;
  inputs: { name: string; description: string; required: boolean }[];
  ids: { name: string; description: string }[];
  example: Record<string, unknown>;
}
const TOOL_EXAMPLES: Record<SketchToolName, Record<string, unknown>> = {
  rectangle: { first: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, opposite: { at: [40, 30] } },
  polygon: { center: { at: [0, 0], snap: { kind: 'point', id: 'origin' } }, vertex: { at: [3.2, 0] }, sides: 6, sizeKind: 'acrossFlats', size: 5.5 },
};
export function sketchToolCatalog(): SketchToolDescription[] {
  const describe = (input: SketchToolInput): string =>
    input.kind === 'anchor'
      ? 'anchor `{ at: [x, y], snap? }`'
      : input.kind === 'option'
        ? `one of ${input.options.map((option) => `"${option}"`).join(', ')}`
        : `a number, ${rangeText(input.spec)}${input.spec.unit === 'count' || input.spec.unit === 'none' ? '' : `, ${input.spec.unit}`}${input.expression ? ', or an expression' : ''}`;
  return (Object.keys(SKETCH_TOOLS) as SketchToolName[]).map((tool) => ({
    tool,
    title: SKETCH_TOOLS[tool].title,
    summary: SKETCH_TOOLS[tool].summary,
    inputs: Object.entries(SKETCH_TOOLS[tool].inputs).map(([name, input]) => ({ name, description: describe(input), required: input.kind === 'anchor' || input.optional !== true })),
    ids: Object.entries(SKETCH_TOOLS[tool].ids).map(([name, description]) => ({ name, description })),
    example: TOOL_EXAMPLES[tool],
  }));
}

// An argument of a query, of an export format or of an operation of the app, in words: what its
// description (`ArgKind` of the engine) says a caller writes.
export function argumentText(spec: ArgKind): string {
  const entity: Record<string, string> = {
    body: '{ kind: "body", body }',
    face: '{ kind: "face", body, face: FaceName }',
    edge: '{ kind: "edge", body, edge: EdgeName }',
    sketchPoint: '{ kind: "sketchPoint", sketch, point } (the point `origin` is the origin of the sketch)',
  };
  const named = (fields: { readonly [name: string]: ArgKind & { optional?: boolean } }): string =>
    Object.entries(fields)
      .map(([name, field]) => `${name}${field.optional ? ' (optional)' : ''}: ${argumentText(field)}`)
      .join('; ');
  switch (spec.kind) {
    case 'number':
      return `a number, ${rangeText(spec.spec)}${spec.spec.unit === 'count' || spec.spec.unit === 'none' ? '' : `, ${spec.spec.unit}`}${spec.spec.default === undefined ? '' : `, default ${spec.spec.default}`}`;
    case 'flag':
      return 'true or false';
    case 'text':
      return 'a text';
    case 'choice':
      return `one of ${spec.options.map((option) => `"${option}"`).join(', ')}`;
    case 'body':
    case 'feature':
    case 'sketch':
      return `the ID of a ${spec.kind}`;
    case 'constraint':
      return `the ID of a constraint of the sketch given in \`${spec.of}\``;
    case 'entity':
      return `an entity of the model: ${spec.accepts.map((kind) => entity[kind]).join(' or ')}`;
    case 'plane':
      return 'a plane (PlaneRef)';
    case 'axis':
      return 'an axis (AxisRef)';
    case 'vector':
      return 'three numbers [x, y, z]';
    case 'list': {
      const count = spec.min !== undefined && spec.max !== undefined ? `, ${spec.min} to ${spec.max} items` : spec.min !== undefined ? `, at least ${spec.min}` : spec.max !== undefined ? `, at most ${spec.max}` : '';
      return `a list${count}, each item ${argumentText(spec.of)}`;
    }
    case 'oneOf':
      return `an object with exactly one of these keys: ${named(spec.options)}`;
    case 'record':
      return `an object with a value per ${spec.keys === 'text' ? 'name' : `${spec.keys} ID`}, each ${argumentText(spec.of)}`;
    case 'fields':
      return `an object { ${named(spec.fields)} }`;
  }
}

// The queries of the engine's catalog (the tool query asks them): arguments and what each returns.
export interface QueryDescription {
  query: string;
  title: string;
  summary: string;
  args: { name: string; description: string; required: boolean }[];
  returns: string;
}
export function queryCatalog(): QueryDescription[] {
  return Object.entries(QUERIES as Record<string, AnyQuery>).map(([query, spec]) => ({
    query,
    title: spec.title,
    summary: spec.summary,
    args: Object.entries(spec.args).map(([name, arg]) => ({ name, description: `${argumentText(arg)}${arg.summary ? `. ${arg.summary}` : ''}`, required: arg.optional !== true })),
    returns: spec.returns,
  }));
}

// The data catalogs of the engine by name; their rows are read with the query `catalog`.
export function dataCatalogs(): { catalog: string; title: string; summary: string }[] {
  return Object.entries(DATA_CATALOGS as Record<string, { title: string; summary: string }>).map(([catalog, table]) => ({ catalog, title: table.title, summary: table.summary }));
}

// The export formats of the engine's catalog (the tool export writes them) with their options.
export function exportFormats(): { format: string; title: string; summary: string; options: { name: string; description: string }[] }[] {
  return Object.entries(EXPORT_FORMATS as Record<string, AnyExportFormat>).map(([format, spec]) => ({
    format,
    title: spec.title,
    summary: spec.summary,
    options: Object.entries(spec.options).map(([name, option]) => ({ name, description: `${argumentText(option)}${option.summary ? `. ${option.summary}` : ''}` })),
  }));
}

// Tentýž popis jako souvislý text: tak ho dostane AI.
export function apiText(): string {
  const { conventions, features, generators, constraints, expressions, numericFields: fields, sketchTools, queries, catalogs, exports, types } = apiDescription();
  const queryText = (entry: QueryDescription): string =>
    [`- ${entry.query} (${entry.title}): ${entry.summary}`, ...(entry.args.length ? ['  args:', ...entry.args.map((arg) => `  - ${arg.name}${arg.required ? '' : ' (optional)'}: ${arg.description}`)] : ['  args: none']), `  returns: ${entry.returns}`].join('\n');
  const sketchToolText = (entry: SketchToolDescription): string =>
    [
      `- ${entry.tool} (${entry.title}): ${entry.summary}`,
      '  input:',
      ...entry.inputs.map((input) => `  - ${input.name}${input.required ? '' : ' (optional)'}: ${input.description}`),
      '  ids in the result:',
      ...entry.ids.map((id) => `  - ${id.name}: ${id.description}`),
      `  example of input: ${JSON.stringify(entry.example)}`,
    ].join('\n');
  const generator = (entry: GeneratorDescription): string =>
    [
      `- ${entry.generator} (${entry.title}): ${entry.summary}`,
      `  operands: ${entry.operands.map((operand) => `${operand.name}: ${operand.kinds.join(' | ')}`).join(', ')}`,
      '  params:',
      ...entry.params.map((param) => `  - ${param.name}${param.required ? ' (required)' : ''}: ${param.description}`),
      ...(entry.refs.length ? ['  refs:', ...entry.refs.map((ref) => `  - ${ref.name} (${ref.title}): ${ref.summary}`)] : []),
      `  side faces: ${entry.sides.join(', ')}`,
      '  facts in the feature result:',
      ...entry.facts.map((fact) => `  - ${fact.name}: ${fact.description}`),
      `  example: ${JSON.stringify(entry.example)}`,
    ].join('\n');
  const feature = (entry: FeatureDescription): string => {
    const body = entry.bodies === 'self' ? ' Může vytvořit těleso se svým ID.' : entry.bodies === 'derived' ? ' May create bodies with the IDs `<id>/<number>`.' : '';
    const update = entry.updatable.length > 0 ? ` updateFeature mění pole: ${entry.updatable.join(', ')}.` : ' Obsah mění vlastní příkazy, ne updateFeature.';
    return `- ${entry.type} (${entry.title}): ${entry.summary}${body}${update}`;
  };
  const constraint = (entry: ConstraintDescription): string => {
    const operands = entry.operands.map((operand) => `${operand.field}: ${operand.kinds.join(' | ')}`).join(', ');
    const value = entry.value ? `; value: ${entry.value.rule}, ${entry.value.unit}` : (entry.values ?? []).map((named) => `; ${named.name}: ${named.rule}, ${named.unit}`).join('');
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
    '# Profile generators',
    'A generator builds the profile of an extrusion from entities of a sketch and parameters: `profile` of the extrusion is `{ type: "generated", generator, sketch, operands, params, refs }`. Numeric parameters are numeric fields at `profile/params/<name>`.',
    ...generators.map(generator),
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
    '# Sketch tools',
    'A sketch tool draws a whole shape with its constraints from a few inputs; run it with the tool sketch_tool `{ sketch, tool, input }`. An anchor is a place in the sketch, `{ at: [x, y] }`, optionally snapped: `snap: { kind: "point", id }` uses that point (an own point or `origin` is used as it is, a point of projected geometry gets a new point with a coincident constraint; `at` must still be given, a rough position is enough, and the place of the point is used) and `snap: { kind: "curve", id }` puts the point on that curve nearest to `at`. The result lists the IDs of what was made (`ids`), to be used in the next commands: the lines as regions of an extrusion, a line for a horizontal constraint, the size dimension for setField.',
    ...sketchTools.map(sketchToolText),
    '',
    '# Queries',
    'A query reads the model and changes nothing; ask it with the tool query `{ query, args, at?, after? }`. `at` is a feature ID (the state after it); `after` is a command to preview first, so that a change can be asked about without being written. ' +
      'An answer is the result, or an error with a code: invalidArguments (an argument has the wrong shape or range), notAvailable (something named is not in the state asked about), failed (the computation gave up).',
    ...queries.map(queryText),
    '',
    '# Catalogs',
    'Tables of data the engine carries; read one with the query `catalog` `{ name, key? }`. A catalog fills in fields: the document stores the numbers, not a reference to a row.',
    ...(catalogs.length ? catalogs.map((entry) => `- ${entry.catalog} (${entry.title}): ${entry.summary}`) : ['(none yet)']),
    '',
    '# Export formats',
    'The tool export `{ format, path, options?, overwrite?, at?, after? }` writes the model in one of these formats (it needs a disk, so it is a tool of the server). Bodies are exported as modelled. All options are optional unless said otherwise.',
    ...exports.map((entry) => [`- ${entry.format} (${entry.title}): ${entry.summary}`, ...(entry.options.length ? ['  options:', ...entry.options.map((option) => `  - ${option.name}: ${option.description}`)] : ['  options: none'])].join('\n')),
    '',
    '# Typy (TypeScript, ze zdroje enginu)',
    'Příkaz je hodnota typu Command; dokument typu Document.',
    '```ts',
    types.trim(),
    '```',
  ].join('\n');
}
