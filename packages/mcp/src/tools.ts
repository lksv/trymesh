// Nástroje pro AI nad enginem. Čisté funkce bez závislosti na Node i na prohlížeči: stejný kód
// obsluhuje engine uvnitř MCP serveru i engine běžící aplikace (přes most).
//
// Nástrojů je málo a jsou obecné. Co engine umí (příkazy, vazby, tvary dokumentu), se do popisu
// dostává ze zdrojů enginu: z katalogu vazeb a z typů. Nová vazba nebo příkaz v enginu se tak
// v nástrojích objeví bez zásahu sem.
import {
  CONSTRAINTS,
  type Command,
  type CommandResult,
  type Constraint,
  type Engine,
  type EngineState,
  type FaceName,
  type Feature,
  type FeatureResult,
  type Id,
  type SketchFeature,
  type Solid,
  constraintOperands,
} from '@trymesh/engine';
import { apiText } from './api';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonSchema = { [key: string]: unknown };

export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  hidden?: boolean; // vnitřní nástroj mostu a serveru, v seznamu pro AI není
  run(engine: Engine, args: Record<string, unknown>): unknown;
}

export type ToolOutcome = { ok: true; result: Json } | { ok: false; error: string };

// Chyba volání: špatný argument, neznámá skica. Vrací se volajícímu jako text.
export class ToolError extends Error {}

const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;
const text = (args: Record<string, unknown>, name: string): string => {
  const value = args[name];
  if (typeof value !== 'string' || value === '') throw new ToolError(`argument "${name}": čeká se neprázdný řetězec`);
  return value;
};
const optionalText = (args: Record<string, unknown>, name: string): string | undefined => (args[name] === undefined || args[name] === null ? undefined : text(args, name));

function stateAt(engine: Engine, at: string | undefined): EngineState {
  if (at !== undefined && !engine.getState().document.features.some((feature) => feature.id === at)) throw new ToolError(`feature "${at}" v dokumentu není`);
  return engine.getState(at);
}
function sketchOf(engine: Engine, id: string): SketchFeature {
  const feature = engine.getState().document.features.find((f) => f.id === id);
  if (feature?.type !== 'sketch') throw new ToolError(`skica "${id}" v dokumentu není`);
  return feature;
}

// ---------------------------------------------------------------- popis modelu

const faceLabel = (name: FaceName): string => (name.role === 'side' ? `${name.feature}/side/${name.curve}` : `${name.feature}/${name.role}`);

function solidInfo(solid: Solid): { volume: number; min: number[]; max: number[] } {
  const p = solid.positions;
  let volume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3], p[i]);
    max[i % 3] = Math.max(max[i % 3], p[i]);
  }
  for (let t = 0; t < solid.triangles.length; t += 3) {
    const [a, b, c] = [3 * solid.triangles[t], 3 * solid.triangles[t + 1], 3 * solid.triangles[t + 2]];
    volume += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return { volume: round(volume / 6), min: min.map(round), max: max.map(round) };
}

function featureStatus(result: FeatureResult | undefined): Record<string, unknown> {
  if (!result) return { status: 'notEvaluated' };
  return {
    status: result.status,
    ...(result.error ? { error: { code: result.error.code, message: result.error.message } } : {}),
    ...(result.warnings.length > 0 ? { warnings: result.warnings.map((w) => ({ code: w.code, message: w.message })) } : {}),
  };
}

// Stav skici v přehledech. U nevyřešené skici (konflikt, neúspěch solveru) stupně volnosti nic
// neříkají, proto se neuvádějí.
function sketchBrief(result: FeatureResult | undefined): Record<string, unknown> {
  const sketch = result?.sketch;
  if (!sketch) return {};
  const solved = !result.warnings.some((warning) => warning.code === 'sketchConflict');
  return { solved, ...(solved ? { degreesOfFreedom: sketch.degreesOfFreedom } : { conflicting: sketch.conflicting }), profileValid: sketch.valid, regions: sketch.regions.length };
}

function featureSummary(feature: Feature, result: FeatureResult | undefined): unknown {
  const base = { id: feature.id, name: feature.name, type: feature.type, ...(featureStatus(result) as object) };
  if (feature.type === 'plane') return { ...base, base: feature.base as unknown as Json, offset: feature.offset };
  if (feature.type === 'extrude') {
    return { ...base, sketch: feature.sketch, operation: feature.operation, distance: feature.distance, ...(feature.target === undefined ? {} : { target: feature.target }), regions: feature.regions as unknown as Json };
  }
  const sketch = result?.sketch;
  return {
    ...base,
    plane: feature.plane as unknown as Json,
    points: Object.keys(feature.points).length,
    curves: Object.keys(feature.curves).length,
    constraints: Object.keys(feature.constraints).length,
    ...(sketch ? sketchBrief(result) : {}),
  };
}

function modelSummary(state: EngineState): unknown {
  const { document, evaluation } = state;
  return {
    features: document.features.map((feature) => featureSummary(feature, evaluation.features[feature.id])),
    bodies: Object.entries(evaluation.bodies).map(([id, body]) => ({ id, ...solidInfo(body.solid), faces: body.faces.length, edges: body.edges.length })),
    problems: document.features.filter((feature) => ['error', 'warning'].includes(evaluation.features[feature.id]?.status ?? '')).map((feature) => feature.id),
    canUndo: state.canUndo,
    canRedo: state.canRedo,
  };
}

function bodyDetail(state: EngineState, id: string): unknown {
  const body = Object.prototype.hasOwnProperty.call(state.evaluation.bodies, id) ? state.evaluation.bodies[id] : undefined;
  if (!body) throw new ToolError(`těleso "${id}" v tomto místě časové osy není (ID tělesa je ID vysunutí s operací new)`);
  const p = body.solid.positions;
  // plocha a normála stěny ze součtu vektorových součinů jejích trojúhelníků
  const sums = new Map<number, number[]>();
  for (let t = 0; t < body.solid.faceIds.length; t++) {
    const [a, b, c] = [3 * body.solid.triangles[3 * t], 3 * body.solid.triangles[3 * t + 1], 3 * body.solid.triangles[3 * t + 2]];
    const [u, v] = [[p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const sum = sums.get(body.solid.faceIds[t]) ?? [0, 0, 0, 0];
    sums.set(body.solid.faceIds[t], [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2], sum[3] + Math.hypot(n[0], n[1], n[2]) / 2]);
  }
  return {
    id,
    ...solidInfo(body.solid),
    faces: body.faces.map((face) => {
      const name = state.evaluation.faceNames[face.id];
      const sum = sums.get(face.id) ?? [0, 0, 0, 0];
      const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;
      return { name: name as unknown as Json, label: faceLabel(name), planar: face.planar, area: round(sum[3]), ...(face.planar ? { normal: [sum[0] / length, sum[1] / length, sum[2] / length].map(round) } : {}) };
    }),
    edges: body.edges.map((edge) => ({ name: edge.name as unknown as Json, label: `${faceLabel(edge.name.a)} | ${faceLabel(edge.name.b)}`, kind: edge.kind, ...edgeShape(edge.kind, edge.segments) })),
  };
}

// Tvar hrany z jejích úseček (6 čísel na úsečku, v libovolném pořadí). Délka vždy; u přímé hrany
// krajní body podél jejího směru (hrana může mít mezery), u kruhové střed a poloměr.
function edgeShape(kind: string, s: Float64Array): Record<string, unknown> {
  const count = s.length / 6;
  const at = (i: number): number[] => [s[3 * i], s[3 * i + 1], s[3 * i + 2]];
  const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let length = 0;
  for (let i = 0; i < count; i++) length += Math.hypot(...sub(at(2 * i + 1), at(2 * i)));
  const out: Record<string, unknown> = { segments: count, length: round(length) };
  if (count === 0) return out;
  if (kind === 'line') {
    const direction = sub(at(1), at(0));
    let [low, high] = [0, 0];
    for (let i = 0; i < 2 * count; i++) {
      if (dot(sub(at(i), at(0)), direction) < dot(sub(at(low), at(0)), direction)) low = i;
      if (dot(sub(at(i), at(0)), direction) > dot(sub(at(high), at(0)), direction)) high = i;
    }
    const span = Math.hypot(...sub(at(high), at(low)));
    return { ...out, from: at(low).map(round), to: at(high).map(round), ...(length < span - 1e-6 * Math.max(1, span) ? { gaps: true } : {}) };
  }
  if (kind === 'circle' && count >= 3) {
    // střed kružnice opsané třem vrcholům rozloženým po hraně
    const [a, b, c] = [at(0), at(2 * Math.floor(count / 3)), at(2 * Math.floor((2 * count) / 3))];
    const [u, v] = [sub(b, a), sub(c, a)];
    const [uu, vv, uv] = [dot(u, u), dot(v, v), dot(u, v)];
    const det = 2 * (uu * vv - uv * uv);
    if (Math.abs(det) > 1e-12 * uu * vv) {
      const [p, q] = [(vv * (uu - uv)) / det, (uu * (vv - uv)) / det];
      const center = [a[0] + p * u[0] + q * v[0], a[1] + p * u[1] + q * v[1], a[2] + p * u[2] + q * v[2]];
      return { ...out, center: center.map(round), radius: round(Math.hypot(...sub(a, center))) };
    }
  }
  return out;
}

const plural = (count: number): string => `${count} ${count === 1 ? 'stupeň' : count >= 2 && count <= 4 ? 'stupně' : 'stupňů'} volnosti`;

const constraintLabel = (c: Constraint): string => `${CONSTRAINTS[c.type].title} (${constraintOperands(c).join(', ')})`;

function loopArea(loop: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0, n = loop.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop[2 * i] * loop[2 * j + 1] - loop[2 * j] * loop[2 * i + 1];
  }
  return sum / 2;
}

function sketchDetail(engine: Engine, id: string): unknown {
  const feature = sketchOf(engine, id);
  const result = engine.getState(id).evaluation.features[id];
  const diagnosis = engine.diagnoseSketch(id);
  const solved = result?.sketch;
  const position = (point: Id): Json => {
    const p = solved?.points[point] ?? (Object.prototype.hasOwnProperty.call(feature.points, point) ? feature.points[point] : undefined);
    return p ? [round(p.x), round(p.y)] : null;
  };
  const twins = new Set(diagnosis.duplicates.flatMap((group) => group.slice(1)));
  const freedom = new Map(diagnosis.free.map((entity) => [`${entity.kind}:${entity.id}`, entity.freedom]));

  const advice: string[] = [];
  if (diagnosis.status === 'conflict') advice.push('Vazby jsou v konfliktu; odeberte nebo upravte některou z vazeb v `conflicting`.');
  if (diagnosis.status === 'failed') advice.push('Skicu se nepodařilo vyřešit; poloha bodů je daleko od řešení nebo vazby nejdou splnit.');
  if (diagnosis.status === 'unavailable') advice.push('Skica se nevyhodnotila (je potlačená nebo její rovina neexistuje); diagnostika není k dispozici.');
  if (diagnosis.status === 'solved') {
    if (diagnosis.degreesOfFreedom === 0) advice.push('Skica je plně určená.');
    else {
      const anchors = diagnosis.free.filter((entity) => entity.kind === 'point' && entity.freedom === diagnosis.degreesOfFreedom).map((entity) => entity.id);
      advice.push(`Skica má ${plural(diagnosis.degreesOfFreedom)}; volné entity jsou v \`diagnosis.free\`.`);
      // Bod, jehož volnost se rovná volnosti skici: jeho určením je určená celá skica. Totožnost
      // s jiným bodem ubírá dva stupně, hodí se tedy jen při volnosti 2; při volnosti 1 stačí
      // jedna kóta nebo vazba ve směru, kterým se bod může hýbat (totožnost by byla v konfliktu).
      if (anchors.length > 0) {
        const how = diagnosis.degreesOfFreedom === 2 ? 'například vazbou coincident s pevným bodem nebo dvěma kótami od něj' : 'jednou kótou nebo vazbou, která určí jeho polohu ve směru, kterým se může hýbat; totožnost s pevným bodem by tu byla v konfliktu';
        advice.push(`Skicu dourčí určení polohy jednoho z bodů ${anchors.join(', ')} (${how}).`);
      }
    }
    if (diagnosis.removable.length > 0) advice.push(`Vazby navíc: ${diagnosis.removable.join(', ')}. Jdou odebrat naráz beze změny geometrie; z čeho která plyne, řekne explain_constraint.`);
  }
  if (solved && !solved.valid) advice.push('Profil je neplatný: křivky se kříží nebo dotýkají mimo spojené body. Vysunout takovou skicu nejde.');

  return {
    id,
    name: feature.name,
    ...(featureStatus(result) as object),
    plane: feature.plane as unknown as Json,
    ...(result?.plane ? { frame: { origin: result.plane.origin.map(round), x: result.plane.x.map(round), y: result.plane.y.map(round), normal: result.plane.normal.map(round) } } : {}),
    points: Object.keys(feature.points).map((point) => ({ id: point, at: position(point), ...(freedom.has(`point:${point}`) ? { freedom: freedom.get(`point:${point}`) as number } : {}) })),
    curves: Object.entries(feature.curves).map(([curve, shape]) => ({
      id: curve,
      ...(shape as unknown as { [key: string]: Json }),
      ...(shape.type === 'circle' ? { radius: round(solved?.radii[curve] ?? feature.radii[curve]), ...(freedom.has(`radius:${curve}`) ? { radiusFree: true } : {}) } : {}),
    })),
    constraints: Object.entries(feature.constraints).map(([constraint, c]) => ({
      id: constraint,
      label: constraintLabel(c),
      ...(c as unknown as { [key: string]: Json }),
      ...('value' in c && !c.driving && solved?.measurements[constraint] !== undefined ? { measured: round(solved.measurements[constraint]) } : {}),
      ...(diagnosis.conflicting.includes(constraint) ? { conflicting: true } : {}),
      ...(twins.has(constraint) ? { duplicate: true } : {}),
      ...(diagnosis.removable.includes(constraint) ? { surplus: true } : {}),
    })),
    external: Object.entries(feature.external).map(([external, ref]) => ({
      id: external,
      ...(ref as unknown as { [key: string]: Json }),
      // odvozené entity, na které jde vázat
      entities: ref.kind === 'line' ? [external, `${external}/a`, `${external}/b`] : [external, `${external}/center`],
      at: (ref.kind === 'line' ? [position(`${external}/a`), position(`${external}/b`)] : [position(`${external}/center`)]) as Json,
      ...(ref.kind === 'circle' && solved?.radii[external] !== undefined ? { radius: round(solved.radii[external]) } : {}),
    })),
    regions: (solved?.regions ?? []).map((region) => ({ ref: region.ref as unknown as Json, area: round(region.loops.reduce((sum, loop) => sum + loopArea(loop), 0)), holes: region.loops.length - 1 })),
    profileValid: solved?.valid ?? false,
    diagnosis: diagnosis as unknown as Json,
    advice,
  };
}

// ---------------------------------------------------------------- příkazy

// Co se po příkazu změnilo natolik, že to má volající vědět: stavy features, které nejsou v pořádku.
function outcome(result: CommandResult): unknown {
  // Neplatný příkaz dokument nezměnil: je to chyba volání, ne výsledek.
  if (!result.ok) throw new ToolError(`${result.error.code}: ${result.error.message}${result.error.commandIndex === undefined ? '' : ` (příkaz dávky s indexem ${result.error.commandIndex})`}`);
  const { document, evaluation } = result.state;
  const problems = document.features
    .map((feature) => ({ id: feature.id, name: feature.name, ...(featureStatus(evaluation.features[feature.id]) as { status: string }) }))
    .filter((feature) => feature.status !== 'ok' && feature.status !== 'suppressed');
  return {
    ok: true,
    features: document.features.length,
    bodies: Object.keys(evaluation.bodies),
    problems: problems as unknown as Json,
    sketches: document.features
      .filter((feature) => feature.type === 'sketch' && evaluation.features[feature.id]?.sketch)
      .map((feature) => ({ id: feature.id, ...sketchBrief(evaluation.features[feature.id]) })),
  };
}

const command = (args: Record<string, unknown>): Command => {
  const value = args.command;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ToolError('argument "command": čeká se objekt příkazu, viz describe_api');
  return value as Command;
};

const NONE: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const COMMAND: JsonSchema = {
  type: 'object',
  properties: { command: { type: 'object', description: 'Příkaz enginu, objekt s polem `type`. Tvary všech příkazů vrací describe_api.', required: ['type'] } },
  required: ['command'],
  additionalProperties: false,
};

// Nástroje, které mění dokument (včetně vnitřního načtení).
export const MUTATING: readonly string[] = ['execute', 'undo', 'redo', '_load'];

// Seznam nástrojů. Sestavuje se při každém dotazu, protože popisy vycházejí z katalogu enginu.
export function tools(): Tool[] {
  const constraintTypes = Object.keys(CONSTRAINTS).join(', ');
  return [
    {
      name: 'describe_api',
      description:
        'Popis toho, co engine umí: konvence, tvary dokumentu a příkazů (typy v TypeScriptu) a katalog vazeb s operandy. Zavolej před prvním execute nebo preview; popis se generuje ze zdrojů enginu, takže platí pro tuto verzi.',
      inputSchema: NONE,
      run: () => apiText(),
    },
    {
      name: 'get_model',
      description: 'Přehled modelu: features na časové ose se stavem a chybami, tělesa s objemem a rozměry, co je v chybě. `at` = stav po dané feature.',
      inputSchema: { type: 'object', properties: { at: { type: 'string', description: 'ID feature; model se vyhodnotí jen po ni' } }, additionalProperties: false },
      run: (engine, args) => modelSummary(stateAt(engine, optionalText(args, 'at'))),
    },
    {
      name: 'get_document',
      description: 'Dokument tak, jak se ukládá (log operací). `feature` vrátí jen jednu feature.',
      inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'ID feature' } }, additionalProperties: false },
      run: (engine, args) => {
        const { document } = engine.getState();
        const id = optionalText(args, 'feature');
        if (id === undefined) return document;
        const feature = document.features.find((f) => f.id === id);
        if (!feature) throw new ToolError(`feature "${id}" v dokumentu není`);
        return feature;
      },
    },
    {
      name: 'get_sketch',
      description:
        'Skica podrobně: body s polohami, křivky, vazby a kóty, promítnutá geometrie, oblasti k vysunutí a diagnostika (stupně volnosti, co je volné, které vazby jsou navíc nebo v konfliktu). Pole `advice` shrnuje, co se skicou je. Sem patří otázky typu „proč má skica dva stupně volnosti".',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string', description: 'ID skici' } }, required: ['sketch'], additionalProperties: false },
      run: (engine, args) => sketchDetail(engine, text(args, 'sketch')),
    },
    {
      name: 'explain_constraint',
      description: 'Řekne, jestli vazba plyne z ostatních vazeb skici, a vrátí sadu vazeb, ze kterých plyne (nejde z ní nic ubrat).',
      inputSchema: { type: 'object', properties: { sketch: { type: 'string' }, constraint: { type: 'string', description: 'ID vazby' } }, required: ['sketch', 'constraint'], additionalProperties: false },
      run: (engine, args) => {
        const feature = sketchOf(engine, text(args, 'sketch'));
        const id = text(args, 'constraint');
        if (!Object.prototype.hasOwnProperty.call(feature.constraints, id)) throw new ToolError(`vazba "${id}" ve skice "${feature.id}" není`);
        const explanation = engine.explainConstraint(feature.id, id);
        return {
          constraint: { id, label: constraintLabel(feature.constraints[id]) },
          redundant: explanation.redundant,
          impliedBy: explanation.impliedBy.map((other) => ({ id: other, label: constraintLabel(feature.constraints[other]) })),
          note: !explanation.redundant
            ? 'Vazba z ostatních neplyne (nebo je to referenční kóta, případně skica není vyřešená).'
            : explanation.impliedBy.length === 0
              ? 'Vazba plyne už z definice křivky.'
              : 'Odebrat jde vazba sama nebo kterákoli z vazeb v impliedBy; geometrie se nezmění.',
        };
      },
    },
    {
      name: 'get_body',
      description: 'Těleso podrobně: stěny (jméno, rovinnost, plocha, normála) a hrany (jméno, druh, konce). Jména stěn a hran se používají v odkazech: rovina skici na stěně, promítnutí hrany.',
      inputSchema: { type: 'object', properties: { body: { type: 'string', description: 'ID tělesa = ID vysunutí s operací new' }, at: { type: 'string', description: 'ID feature; stav po ní' } }, required: ['body'], additionalProperties: false },
      run: (engine, args) => bodyDetail(stateAt(engine, optionalText(args, 'at')), text(args, 'body')),
    },
    {
      name: 'execute',
      description: `Provede příkaz enginu a zapíše ho do dokumentu (jeden krok undo). Víc příkazů naráz jde složit příkazem batch. Neplatný příkaz dokument nezmění a vrátí důvod. Typy vazeb: ${constraintTypes}. Přesné tvary příkazů vrací describe_api.`,
      inputSchema: COMMAND,
      run: (engine, args) => outcome(engine.execute(command(args))),
    },
    {
      name: 'preview',
      description: 'Spočítá výsledek příkazu, ale do dokumentu ho nezapíše. Hodí se na vyzkoušení změny.',
      inputSchema: COMMAND,
      run: (engine, args) => outcome(engine.preview(command(args))),
    },
    {
      name: 'undo',
      description: 'Vrátí poslední zapsaný příkaz.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canUndo) throw new ToolError('není co vracet');
        engine.undo();
        return modelSummary(engine.getState());
      },
    },
    {
      name: 'redo',
      description: 'Znovu provede vrácený příkaz.',
      inputSchema: NONE,
      run: (engine) => {
        if (!engine.getState().canRedo) throw new ToolError('není co opakovat');
        engine.redo();
        return modelSummary(engine.getState());
      },
    },
    // Vnitřní nástroje: soubory čte a zapisuje server, engine může běžet v aplikaci.
    { name: '_save', description: '', inputSchema: NONE, hidden: true, run: (engine) => engine.save() },
    {
      name: '_load',
      description: '',
      inputSchema: NONE,
      hidden: true,
      run: (engine, args) => {
        const result = engine.load(text(args, 'json'));
        if (!result.ok) throw new ToolError(result.error.message);
        return modelSummary(result.state);
      },
    },
    {
      name: '_export_stl',
      description: '',
      inputSchema: NONE,
      hidden: true,
      run: (engine) => {
        const bytes = engine.exportMesh('stl');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { base64: btoa(binary), bodies: Object.keys(engine.getState().evaluation.bodies).length };
      },
    },
  ];
}

// Zavolá nástroj. Chyby volání se vracejí jako text, ostatní výjimky jsou chyba programu a propadnou.
export function callTool(engine: Engine, name: string, args: Record<string, unknown> = {}): ToolOutcome {
  const tool = tools().find((candidate) => candidate.name === name);
  if (!tool) return { ok: false, error: `neznámý nástroj "${name}"` };
  try {
    // přes JSON: typovaná pole (Float64Array) se nepřenášejí a výsledek musí projít mostem beze změny
    return { ok: true, result: JSON.parse(JSON.stringify(tool.run(engine, args) ?? null)) as Json };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    throw error;
  }
}
