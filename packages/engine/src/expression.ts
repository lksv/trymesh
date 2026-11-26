// Expressions over parameters: parsing, evaluation, the parameter table and checks.
// The rules are in docs/architecture/document.md, section "Parameters and expressions".
import type { CheckResult, Expr, ExpressionError, Parameter, ParameterResult } from './types';
import { has } from './util';

// A function is recognised by the parenthesis after its name, so a parameter may share a name with
// a function and a function added later does not invalidate an older document. Angles are in
// radians; `deg` converts degrees to radians.
interface FunctionSpec {
  signature: string; // for descriptions: the function with its argument names
  summary: string;
  args: number; // argument count; the minimum when `variadic`
  variadic?: boolean;
  // The kind of each argument when not all are numbers (`if` takes a truth value first). A truth
  // value reaches `apply` as 1 or 0.
  argKinds?: ExprKind[];
  apply: (...args: number[]) => number;
}
const FUNCTIONS: Record<string, FunctionSpec> = {
  deg: { signature: 'deg(x)', summary: 'Degrees to radians: deg(30) is π / 6. Angle fields are in radians.', args: 1, apply: (x) => (x * Math.PI) / 180 },
  sin: { signature: 'sin(x)', summary: 'Sine of an angle in radians.', args: 1, apply: Math.sin },
  cos: { signature: 'cos(x)', summary: 'Cosine of an angle in radians.', args: 1, apply: Math.cos },
  tan: { signature: 'tan(x)', summary: 'Tangent of an angle in radians.', args: 1, apply: Math.tan },
  asin: { signature: 'asin(x)', summary: 'Arc sine, result in radians.', args: 1, apply: Math.asin },
  acos: { signature: 'acos(x)', summary: 'Arc cosine, result in radians.', args: 1, apply: Math.acos },
  atan: { signature: 'atan(x)', summary: 'Arc tangent, result in radians.', args: 1, apply: Math.atan },
  atan2: { signature: 'atan2(y, x)', summary: 'Angle of the point (x, y) from the X axis: atan2(y, x), result in radians.', args: 2, apply: Math.atan2 },
  sqrt: { signature: 'sqrt(x)', summary: 'Square root.', args: 1, apply: Math.sqrt },
  abs: { signature: 'abs(x)', summary: 'Absolute value.', args: 1, apply: Math.abs },
  min: { signature: 'min(a, b, …)', summary: 'The smallest of the values.', args: 1, variadic: true, apply: Math.min },
  max: { signature: 'max(a, b, …)', summary: 'The largest of the values.', args: 1, variadic: true, apply: Math.max },
  floor: { signature: 'floor(x)', summary: 'Rounds down to an integer.', args: 1, apply: Math.floor },
  ceil: { signature: 'ceil(x)', summary: 'Rounds up to an integer.', args: 1, apply: Math.ceil },
  round: { signature: 'round(x)', summary: 'Rounds to the nearest integer.', args: 1, apply: Math.round },
  if: {
    signature: 'if(condition, a, b)',
    summary: 'a when the condition (a comparison, such as gz >= 3 && tabs == 1) holds, otherwise b. All three arguments are always evaluated, so an unknown name or a parameter in error in either branch is an error; a division by zero in the branch not taken is not.',
    args: 3,
    argKinds: ['check', 'number', 'number'],
    apply: (condition, a, b) => (condition !== 0 ? a : b),
  },
};
const CONSTANTS: Record<string, { summary: string; value: number }> = {
  pi: { summary: 'The constant π.', value: Math.PI },
};

// Public description of the syntax: for checking input in the app and for the API description.
export const EXPRESSION_FUNCTIONS: Record<string, { signature: string; summary: string; args: number; variadic?: boolean }> = Object.fromEntries(
  Object.entries(FUNCTIONS).map(([name, { signature, summary, args, variadic }]) => [name, { signature, summary, args, ...(variadic ? { variadic } : {}) }]),
);
export const EXPRESSION_CONSTANTS: Record<string, { summary: string; value: number }> = CONSTANTS;
export const EXPRESSION_SYNTAX =
  'Numbers (1.5, 2e-3), operators + - * / % (remainder) ^ (power), parentheses, parameter names, constants and functions. ' +
  'Checks, and the condition of if(condition, a, b), also use the comparisons == != < <= > >= and the connectives && || !. Equality is compared with the tolerance 1e-9 · max(1, |a|, |b|); ' +
  'the remainder is 0 when the quotient is within that tolerance of an integer. Both sides of && and || are always evaluated. ' +
  'The decimal separator is a dot; a dot inside a name is reserved.';

// ---------------------------------------------------------------- parsing

type Binary = '+' | '-' | '*' | '/' | '%' | '^' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string; position: number }
  | { kind: 'call'; name: string; args: Node[]; position: number }
  | { kind: 'unary'; op: '-' | '!'; operand: Node }
  | { kind: 'binary'; op: Binary; left: Node; right: Node };

export type ExprKind = 'number' | 'check'; // a number, or a truth value (a check)

interface Token {
  type: 'number' | 'name' | 'op' | 'end';
  text: string;
  position: number;
}

class SyntaxProblem extends Error {
  constructor(
    readonly code: ExpressionError['code'],
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[\p{L}_][\p{L}\p{N}_]*/u;
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '(', ')', ',', '<', '>', '!'];

// Limits that keep the recursive parser and evaluator away from the stack limit. An expression
// typed by a person is far below both.
const MAX_LENGTH = 1000;
const MAX_NESTING = 100;

function tokenize(text: string): Token[] {
  if (text.length > MAX_LENGTH) throw new SyntaxProblem('syntax', `the expression is longer than ${MAX_LENGTH} characters`, MAX_LENGTH);
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at);
    const space = /^\s+/.exec(rest);
    if (space) {
      at += space[0].length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ type: 'number', text: number[0], position: at });
      at += number[0].length;
      // `1.5.2` or `2x` is a typo, not two values in a row
      if (/^[\p{L}_.]/u.test(text.slice(at))) throw new SyntaxProblem('syntax', 'an operator is expected after a number', at);
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ type: 'name', text: name[0], position: at });
      at += name[0].length;
      if (text[at] === '.') throw new SyntaxProblem('syntax', 'a dot inside a name is reserved', at);
      continue;
    }
    const op = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (!op) throw new SyntaxProblem('syntax', `unexpected character "${rest[0]}"`, at);
    tokens.push({ type: 'op', text: op, position: at });
    at += op.length;
  }
  tokens.push({ type: 'end', text: '', position: text.length });
  return tokens;
}

interface Parsed {
  node: Node;
  kind: ExprKind;
  names: string[]; // parameter names the expression uses
}

class Parser {
  private at = 0;
  private nesting = 0;
  readonly names = new Set<string>();
  constructor(private readonly tokens: Token[]) {}

  private get token(): Token {
    return this.tokens[this.at];
  }
  private take(text: string): boolean {
    if (this.token.type !== 'op' || this.token.text !== text) return false;
    this.at++;
    return true;
  }
  private typed(result: [Node, ExprKind], kind: ExprKind, position: number, what: string): Node {
    if (result[1] !== kind) throw new SyntaxProblem('type', `${what}: ${kind === 'number' ? 'a number' : 'a comparison'} is expected`, position);
    return result[0];
  }

  parse(): Parsed {
    if (this.token.type === 'end') throw new SyntaxProblem('syntax', 'the expression is empty', 0);
    const [node, kind] = this.or();
    const last = this.tokens[this.at];
    // a comma outside a function call is most likely a decimal comma
    if (last.type !== 'end') throw new SyntaxProblem('syntax', last.text === ',' ? 'unexpected ","; the decimal separator is a dot' : `unexpected "${last.text}"`, last.position);
    return { node, kind, names: [...this.names] };
  }

  private logical(ops: Binary[], next: () => [Node, ExprKind]): [Node, ExprKind] {
    let position = this.token.position;
    let left = next();
    for (;;) {
      const op = ops.find((candidate) => this.token.type === 'op' && this.token.text === candidate);
      if (!op) return left;
      this.at++;
      const at = this.token.position;
      const right = next();
      left = [{ kind: 'binary', op, left: this.typed(left, 'check', position, `left side of ${op}`), right: this.typed(right, 'check', at, `right side of ${op}`) }, 'check'];
      position = at;
    }
  }
  private or = (): [Node, ExprKind] => this.logical(['||'], this.and);
  private and = (): [Node, ExprKind] => this.logical(['&&'], this.comparison);

  private comparison = (): [Node, ExprKind] => {
    const position = this.token.position;
    const left = this.sum();
    const op = (['==', '!=', '<=', '>=', '<', '>'] as const).find((candidate) => this.token.type === 'op' && this.token.text === candidate);
    if (!op) return left;
    this.at++;
    const at = this.token.position;
    const right = this.sum();
    return [{ kind: 'binary', op, left: this.typed(left, 'number', position, `left side of ${op}`), right: this.typed(right, 'number', at, `right side of ${op}`) }, 'check'];
  };

  private arithmetic(ops: Binary[], next: () => [Node, ExprKind]): [Node, ExprKind] {
    let position = this.token.position;
    let left = next();
    for (;;) {
      const op = ops.find((candidate) => this.token.type === 'op' && this.token.text === candidate);
      if (!op) return left;
      this.at++;
      const at = this.token.position;
      const right = next();
      left = [{ kind: 'binary', op, left: this.typed(left, 'number', position, `left side of ${op}`), right: this.typed(right, 'number', at, `right side of ${op}`) }, 'number'];
      position = at;
    }
  }
  private sum = (): [Node, ExprKind] => this.arithmetic(['+', '-'], this.term);
  private term = (): [Node, ExprKind] => this.arithmetic(['*', '/', '%'], this.unary);

  // Every level of nesting (parentheses, function arguments, chains of signs and powers) passes here.
  private unary = (): [Node, ExprKind] => {
    if (++this.nesting > MAX_NESTING) throw new SyntaxProblem('syntax', `the expression is nested deeper than ${MAX_NESTING} levels`, this.token.position);
    try {
      return this.signed();
    } finally {
      this.nesting--;
    }
  };

  private signed = (): [Node, ExprKind] => {
    const position = this.token.position;
    if (this.take('-')) return [{ kind: 'unary', op: '-', operand: this.typed(this.unary(), 'number', position, 'negation') }, 'number'];
    if (this.take('+')) return [this.typed(this.unary(), 'number', position, 'sign'), 'number'];
    if (this.take('!')) return [{ kind: 'unary', op: '!', operand: this.typed(this.unary(), 'check', position, 'logical not') }, 'check'];
    return this.power();
  };

  // Power is right-associative and binds tighter than the sign: -2 ^ 2 is -4, 2 ^ -1 is 0.5.
  private power = (): [Node, ExprKind] => {
    const position = this.token.position;
    const base = this.primary();
    if (!this.take('^')) return base;
    const at = this.token.position;
    const exponent = this.unary();
    return [{ kind: 'binary', op: '^', left: this.typed(base, 'number', position, 'base of the power'), right: this.typed(exponent, 'number', at, 'exponent') }, 'number'];
  };

  private primary = (): [Node, ExprKind] => {
    const token = this.token;
    if (token.type === 'number') {
      this.at++;
      return [{ kind: 'number', value: Number(token.text) }, 'number'];
    }
    if (token.type === 'name') {
      this.at++;
      if (this.take('(')) {
        const spec = has(FUNCTIONS, token.text) ? FUNCTIONS[token.text] : undefined;
        if (!spec) throw new SyntaxProblem('syntax', `unknown function "${token.text}"`, token.position);
        const args: Node[] = [];
        if (!this.take(')')) {
          do {
            const at = this.token.position;
            args.push(this.typed(this.or(), spec.argKinds?.[args.length] ?? 'number', at, `argument of ${token.text}`));
          } while (this.take(','));
          if (!this.take(')')) throw new SyntaxProblem('syntax', 'missing closing parenthesis', this.token.position);
        }
        if (spec.variadic ? args.length < spec.args : args.length !== spec.args) {
          throw new SyntaxProblem('syntax', `function ${token.text} takes ${spec.variadic ? 'at least ' : ''}${spec.args} ${spec.args === 1 ? 'argument' : 'arguments'}`, token.position);
        }
        return [{ kind: 'call', name: token.text, args, position: token.position }, 'number'];
      }
      if (has(CONSTANTS, token.text)) return [{ kind: 'number', value: CONSTANTS[token.text].value }, 'number'];
      this.names.add(token.text);
      return [{ kind: 'name', name: token.text, position: token.position }, 'number'];
    }
    if (this.take('(')) {
      const inner = this.or();
      if (!this.take(')')) throw new SyntaxProblem('syntax', 'missing closing parenthesis', this.token.position);
      return inner;
    }
    throw new SyntaxProblem('syntax', this.tokens[this.at].type === 'end' ? 'the expression is incomplete' : `unexpected "${token.text}"`, token.position);
  };
}

type ParseResult = { ok: true; parsed: Parsed } | { ok: false; error: ExpressionError };
const parsedCache = new Map<string, ParseResult>();

function parse(expr: Expr): ParseResult {
  const cached = parsedCache.get(expr);
  if (cached) return cached;
  let result: ParseResult;
  try {
    result = { ok: true, parsed: new Parser(tokenize(expr)).parse() };
  } catch (error) {
    if (!(error instanceof SyntaxProblem)) throw error;
    result = { ok: false, error: { code: error.code, message: error.message, position: error.position } };
  }
  if (parsedCache.size > 5000) parsedCache.clear();
  parsedCache.set(expr, result);
  return result;
}

// Checks an expression without evaluating it: syntax, result type and (given a list of names) unknown names.
export function analyzeExpression(expr: Expr, context: { kind?: ExprKind; names?: string[] } = {}): { ok: true; names: string[] } | { ok: false; error: ExpressionError } {
  const result = parse(expr);
  if (!result.ok) return result;
  const { parsed } = result;
  const kind = context.kind ?? 'number';
  if (parsed.kind !== kind) return { ok: false, error: { code: 'type', message: kind === 'number' ? 'a number is expected, the expression is a comparison' : 'a comparison is expected, the expression is a number' } };
  if (context.names) {
    const unknown = firstName(parsed.node, (name) => !context.names?.includes(name));
    if (unknown) return { ok: false, error: { code: 'unknownName', message: `unknown name "${unknown.name}"`, position: unknown.position } };
  }
  return { ok: true, names: parsed.names };
}

function firstName(node: Node, match: (name: string) => boolean): Extract<Node, { kind: 'name' }> | undefined {
  if (node.kind === 'name') return match(node.name) ? node : undefined;
  if (node.kind === 'call') {
    for (const arg of node.args) {
      const found = firstName(arg, match);
      if (found) return found;
    }
    return undefined;
  }
  if (node.kind === 'unary') return firstName(node.operand, match);
  if (node.kind === 'binary') return firstName(node.left, match) ?? firstName(node.right, match);
  return undefined;
}

// Renames a parameter inside an expression and leaves the rest of the text as it is. A name followed by a parenthesis is a function.
export function renameInExpression(expr: Expr, from: string, to: string): Expr {
  let tokens: Token[];
  try {
    tokens = tokenize(expr);
  } catch {
    return expr;
  }
  let out = '';
  let at = 0;
  tokens.forEach((token, i) => {
    if (token.type !== 'name' || token.text !== from || tokens[i + 1]?.text === '(') return;
    out += expr.slice(at, token.position) + to;
    at = token.position + token.text.length;
  });
  return out + expr.slice(at);
}

// ---------------------------------------------------------------- evaluation

// Equality with a tolerance: absolute near zero, relative for large numbers.
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// Remainder with the same tolerance: when the quotient is an integer up to rounding, the remainder
// is zero. Without it `(0.3 / 0.1) % 3` is 2.9999999999999996 and `x % 3 == 0` fails.
const remainder = (a: number, b: number): number => (same(a / b, Math.round(a / b)) ? 0 : a % b);

const NOT_FINITE: ExpressionError = { code: 'notFinite', message: 'the result is not a finite number (division by zero or a value outside the domain of a function)' };

class EvaluationProblem extends Error {
  constructor(readonly problem: ExpressionError) {
    super(problem.message);
  }
}

type Lookup = (name: string, position: number) => number;

function compute(node: Node, lookup: Lookup): number | boolean {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'name':
      return lookup(node.name, node.position);
    case 'call':
      return FUNCTIONS[node.name].apply(
        ...node.args.map((arg) => {
          const value = compute(arg, lookup);
          return typeof value === 'boolean' ? Number(value) : value;
        }),
      );
    case 'unary':
      return node.op === '-' ? -(compute(node.operand, lookup) as number) : !compute(node.operand, lookup);
    case 'binary': {
      // Both sides are always evaluated: an unknown name or a parameter in error must show up as an
      // error of the check, not hide behind a side that happens to decide the result.
      if (node.op === '&&' || node.op === '||') {
        const [left, right] = [compute(node.left, lookup) as boolean, compute(node.right, lookup) as boolean];
        return node.op === '&&' ? left && right : left || right;
      }
      const [a, b] = [compute(node.left, lookup) as number, compute(node.right, lookup) as number];
      // A comparison of a non-finite number has no meaningful answer (Infinity equals anything
      // within a relative tolerance); it is an error like a non-finite result of a field.
      if (['==', '!=', '<', '<=', '>', '>='].includes(node.op) && !(Number.isFinite(a) && Number.isFinite(b))) throw new EvaluationProblem(NOT_FINITE);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '%':
          return remainder(a, b);
        case '^':
          return a ** b;
        case '==':
          return same(a, b);
        case '!=':
          return !same(a, b);
        case '<':
          return a < b && !same(a, b);
        case '<=':
          return a < b || same(a, b);
        case '>':
          return a > b && !same(a, b);
        default:
          return a > b || same(a, b);
      }
    }
  }
}

// Values of the names an expression may use. Today the parameter table; later also values produced by the recompute.
export type Environment = Record<string, ParameterResult>;

type Outcome = { ok: true; value: number | boolean } | { ok: false; error: ExpressionError };

function run(expr: Expr, kind: ExprKind, lookup: Lookup): Outcome {
  const analyzed = parse(expr);
  if (!analyzed.ok) return analyzed;
  if (analyzed.parsed.kind !== kind) return { ok: false, error: { code: 'type', message: kind === 'number' ? 'a number is expected, the expression is a comparison' : 'a comparison is expected, the expression is a number' } };
  try {
    const value = compute(analyzed.parsed.node, lookup);
    if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, error: NOT_FINITE };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof EvaluationProblem) return { ok: false, error: error.problem };
    throw error;
  }
}

const fromEnvironment =
  (environment: Environment): Lookup =>
  (name, position) => {
    const found = has(environment, name) ? environment[name] : undefined;
    if (!found) throw new EvaluationProblem({ code: 'unknownName', message: `unknown name "${name}"`, position });
    if (!found.ok) throw new EvaluationProblem({ code: 'dependsOnError', message: `parameter "${name}" is in error: ${found.error.message}`, position });
    return found.value;
  };

export function evaluateNumber(expr: Expr, environment: Environment): { ok: true; value: number } | { ok: false; error: ExpressionError } {
  return run(expr, 'number', fromEnvironment(environment)) as { ok: true; value: number } | { ok: false; error: ExpressionError };
}

// The value of a number expression over the parameters of a document, or undefined when it has
// none (a syntax error, an unknown name, a parameter in error): what the app reads where it decides
// by the value before it sends the expression (an angle of a full turn, D68).
export function expressionValue(expr: Expr, parameters: readonly Parameter[]): number | undefined {
  const result = evaluateNumber(expr, evaluateParameters(parameters));
  return result.ok ? result.value : undefined;
}

export function evaluateCheck(expr: Expr, environment: Environment): CheckResult {
  const result = run(expr, 'check', fromEnvironment(environment));
  if (!result.ok) return { status: 'error', error: result.error };
  return { status: result.value ? 'ok' : 'failed' };
}

// ---------------------------------------------------------------- parameter table

const environments = new WeakMap<readonly Parameter[], Environment>();

// Parameter values. A parameter may refer to any other one regardless of order. Every parameter that
// lies on a cycle gets the error `cycle`; whatever depends on a parameter in error is in error too.
// The result is memoised by the identity of the table. Nothing here recurses over the chain of
// parameters, so a long chain cannot run out of stack.
export function evaluateParameters(parameters: readonly Parameter[]): Environment {
  const cached = environments.get(parameters);
  if (cached) return cached;
  const exprs = new Map(parameters.map((p) => [p.name, p.expr]));
  // parameters each parameter uses
  const uses = new Map<string, string[]>();
  for (const [name, expr] of exprs) {
    const parsed = parse(expr);
    uses.set(name, parsed.ok ? parsed.parsed.names.filter((used) => exprs.has(used)) : []);
  }
  // A parameter is on a cycle when it can be reached from itself.
  const onCycle = (start: string): boolean => {
    const seen = new Set<string>();
    const queue = [...(uses.get(start) as string[])];
    while (queue.length > 0) {
      const name = queue.pop() as string;
      if (name === start) return true;
      if (seen.has(name)) continue;
      seen.add(name);
      queue.push(...(uses.get(name) as string[]));
    }
    return false;
  };
  const done = new Map<string, ParameterResult>();
  for (const name of exprs.keys()) if (onCycle(name)) done.set(name, { ok: false, error: { code: 'cycle', message: `parameter "${name}" depends on itself` } });
  const evaluate = (name: string): void => {
    const outcome = run(exprs.get(name) as string, 'number', (used, position) => {
      const value = done.get(used);
      if (!value) throw new EvaluationProblem({ code: 'unknownName', message: `unknown name "${used}"`, position });
      if (value.ok) return value.value;
      throw new EvaluationProblem({ code: 'dependsOnError', message: `parameter "${used}" is in error: ${value.error.message}`, position });
    });
    done.set(name, outcome as ParameterResult);
  };
  // Dependencies first: a depth-first walk with its own stack.
  for (const root of exprs.keys()) {
    const path: { name: string; next: number }[] = [{ name: root, next: 0 }];
    while (path.length > 0) {
      const top = path[path.length - 1];
      if (done.has(top.name)) {
        path.pop();
        continue;
      }
      const pending = uses.get(top.name) as string[];
      while (top.next < pending.length && done.has(pending[top.next])) top.next++;
      if (top.next < pending.length) path.push({ name: pending[top.next++], next: 0 });
      else {
        evaluate(top.name);
        path.pop();
      }
    }
  }
  const environment: Environment = Object.fromEntries(parameters.map((p) => [p.name, done.get(p.name) as ParameterResult]));
  environments.set(parameters, environment);
  return environment;
}

// A parameter name is an identifier: it is used in expressions. It must not be the name of a constant
// or a property every object has (names are record keys).
export function parameterNameProblem(name: string): string | undefined {
  const match = NAME.exec(name);
  if (!match || match[0] !== name) return 'a parameter name may contain only letters, digits and underscores and must not start with a digit';
  if (has(CONSTANTS, name)) return `"${name}" is the name of a constant`;
  if (name in Object.prototype) return `the name "${name}" is not allowed`;
  return undefined;
}
