// Expressions: parsing, evaluation, the parameter table and checks.
import { describe, expect, it } from 'vitest';
import { analyzeExpression, evaluateCheck, evaluateNumber, evaluateParameters, parameterNameProblem, renameInExpression } from '../src/expression';
import { checkNumber, rangeText } from '../src/catalog';

const value = (expr: string, parameters: Record<string, string> = {}): number | string => {
  const result = evaluateNumber(expr, evaluateParameters(Object.entries(parameters).map(([name, e]) => ({ name, expr: e }))));
  return result.ok ? result.value : result.error.code;
};

describe('expressions', () => {
  it('arithmetic, precedence and functions', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('7 % 3')).toBe(1);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('2 ^ -1')).toBe(0.5);
    expect(value('1.5e1 + .5')).toBe(15.5);
    expect(value('max(1, 5, 3) - min(4, 2)')).toBe(3);
    expect(value('sqrt(16) + abs(-2) + floor(2.7) + ceil(2.1) + round(2.5)')).toBe(14);
    expect(value('deg(180)')).toBeCloseTo(Math.PI, 15);
    expect(value('sin(pi / 2) + cos(0) + atan2(1, 1) * 4 / pi')).toBeCloseTo(3, 12);
  });

  it('parameter names; a function is recognised by its parenthesis', () => {
    expect(value('module * Zs', { module: '0.9', Zs: '18' })).toBeCloseTo(16.2, 12);
    expect(value('Zs + 2 * Zp', { Zs: '18', Zp: '27' })).toBe(72);
    expect(value('größe_2 / 2', { größe_2: '10' })).toBe(5); // letters of any alphabet
    // a parameter may share a name with a function
    expect(value('min + min(1, 2)', { min: '10' })).toBe(11);
    expect(value('missing + 1')).toBe('unknownName');
  });

  it('syntax errors carry a position', () => {
    const error = (expr: string) => {
      const result = analyzeExpression(expr);
      return result.ok ? undefined : [result.error.code, result.error.position];
    };
    expect(error('1 +')).toEqual(['syntax', 3]);
    expect(error('')).toEqual(['syntax', 0]);
    expect(error('   ')).toEqual(['syntax', 0]);
    expect(error('2 * (3 + 1')).toEqual(['syntax', 10]);
    expect(error('1 2')).toEqual(['syntax', 2]);
    expect(error('0,9')).toEqual(['syntax', 1]);
    expect(error('sketch.dim')).toEqual(['syntax', 6]); // the dot is reserved
    expect(error('1.5.2')).toEqual(['syntax', 3]);
    expect(error('2x')).toEqual(['syntax', 1]);
    expect(error('foo(1)')).toEqual(['syntax', 0]);
    expect(error('sin(1, 2)')).toEqual(['syntax', 0]);
    expect(error('min()')).toEqual(['syntax', 0]);
    expect(error('1 # 2')).toEqual(['syntax', 2]);
    // limits that keep the parser off the stack limit
    expect(error(`${'('.repeat(150)}1${')'.repeat(150)}`)).toEqual(['syntax', 100]);
    expect(error(`${'-'.repeat(150)}1`)).toEqual(['syntax', 100]);
    expect(error(Array.from({ length: 600 }, () => '1').join('+'))).toEqual(['syntax', 1000]);
    expect(value(Array.from({ length: 400 }, () => '1').join('+'))).toBe(400);
    expect(value(`${'('.repeat(90)}7${')'.repeat(90)}`)).toBe(7);
    const comma = analyzeExpression('2,5 * a');
    expect(!comma.ok && comma.error.message).toMatch(/decimal separator is a dot/);
    expect(error('1 < 2')).toEqual(['type', undefined]); // a numeric field does not expect a comparison
    expect(error('1 + (2 < 3)')).toEqual(['type', 4]);
    expect(analyzeExpression('a + b * sin(c)')).toEqual({ ok: true, names: ['a', 'b', 'c'] });
    expect(analyzeExpression('a + b', { names: ['a'] })).toMatchObject({ ok: false, error: { code: 'unknownName', position: 4 } });
  });

  it('a result that is not a finite number is an error', () => {
    expect(value('1 / 0')).toBe('notFinite');
    expect(value('sqrt(-1)')).toBe('notFinite');
    expect(value('0 / 0')).toBe('notFinite');
  });

  it('checks: comparison with a tolerance and logical connectives', () => {
    const check = (expr: string, parameters: Record<string, string> = {}) => evaluateCheck(expr, evaluateParameters(Object.entries(parameters).map(([name, e]) => ({ name, expr: e })))).status;
    expect(check('Zs % 3 == 0', { Zs: '18' })).toBe('ok');
    expect(check('Zs % 3 == 0', { Zs: '20' })).toBe('failed');
    expect(check('(0.1 + 0.2) - 0.3 == 0')).toBe('ok'); // absolute tolerance near zero
    expect(check('0.1 + 0.2 == 0.3')).toBe('ok');
    expect(check('0.1 + 0.2 < 0.3 || 0.1 + 0.2 > 0.3')).toBe('failed'); // less than also means not equal
    expect(check('0.1 + 0.2 <= 0.3 && 0.1 + 0.2 >= 0.3')).toBe('ok');
    expect(check('1e12 + 0.0001 == 1e12')).toBe('ok'); // relative for large numbers
    expect(check('1 != 1.001 && !(2 < 1)')).toBe('ok');
    expect(check('module * (Zs / 2 + 1) < 12.75', { module: '0.9', Zs: '24' })).toBe('ok');
    expect(check('module * (Zs / 2 + 1) < 12.75', { module: '1', Zs: '24' })).toBe('failed');
    expect(check('x > 0')).toBe('error');
    // the remainder is tolerant like equality: 0.3 / 0.1 is not exactly 3
    expect(check('r % 3 == 0', { r: '0.3 / 0.1' })).toBe('ok');
    expect(check('r % 3 == 0', { r: '3.5' })).toBe('failed');
    expect(value('7.5 % 2')).toBe(1.5);
    expect(value('-7 % 3')).toBe(-1);
  });

  it('checks: a non-finite operand and a broken name are errors, whichever side decides', () => {
    const check = (expr: string, parameters: Record<string, string> = {}) => evaluateCheck(expr, evaluateParameters(Object.entries(parameters).map(([name, e]) => ({ name, expr: e }))));
    for (const expr of ['1 / gap == 5', '1 / gap <= 5', '1 / gap > 0.5', '0 / gap != 0', 'sqrt(gap - 1) < 5']) {
      expect(check(expr, { gap: '0' }), expr).toMatchObject({ status: 'error', error: { code: 'notFinite' } });
    }
    // no short circuit: the unknown name is reported although the left side decides
    expect(check('w > 1 || nope > 1', { w: '5' })).toMatchObject({ status: 'error', error: { code: 'unknownName', position: 9 } });
    expect(check('w < 1 && nope > 1', { w: '5' })).toMatchObject({ status: 'error', error: { code: 'unknownName' } });
    expect(check('w > 1 || broken > 1', { w: '5', broken: 'missing' })).toMatchObject({ status: 'error', error: { code: 'dependsOnError' } });
    expect(check('w > 1 || w > 9', { w: '5' }).status).toBe('ok');
    expect(evaluateCheck('1 + 1', {})).toMatchObject({ status: 'error', error: { code: 'type' } });
    expect(analyzeExpression('1 < 2 < 3', { kind: 'check' })).toMatchObject({ ok: false });
    expect(analyzeExpression('a < b && b < c', { kind: 'check' })).toEqual({ ok: true, names: ['a', 'b', 'c'] });
  });

  it('parameter table: order does not matter, cycles and dependence on an error', () => {
    const table = evaluateParameters([
      { name: 'Zr', expr: 'Zs + 2 * Zp' },
      { name: 'Zs', expr: '18' },
      { name: 'Zp', expr: '27' },
      { name: 'a', expr: 'b + 1' },
      { name: 'b', expr: 'c * 2' },
      { name: 'c', expr: 'a' },
      { name: 'd', expr: 'a + 1' },
      { name: 'e', expr: 'missing' },
      { name: 'f', expr: 'e + Zs' },
      { name: 'self', expr: 'self' },
    ]);
    expect(table.Zr).toEqual({ ok: true, value: 72 });
    for (const name of ['a', 'b', 'c', 'self']) expect(table[name]).toMatchObject({ ok: false, error: { code: 'cycle' } });
    expect(table.d).toMatchObject({ ok: false, error: { code: 'dependsOnError' } });
    expect(table.e).toMatchObject({ ok: false, error: { code: 'unknownName' } });
    expect(table.f).toMatchObject({ ok: false, error: { code: 'dependsOnError' } });
    // every parameter on a cycle gets `cycle`, also one reached after the cycle was closed
    const forked = evaluateParameters([
      { name: 'a', expr: 'b + c' },
      { name: 'b', expr: 'a' },
      { name: 'c', expr: 'a' },
      { name: 'user', expr: 'c + 1' },
    ]);
    for (const name of ['a', 'b', 'c']) expect(forked[name], name).toMatchObject({ ok: false, error: { code: 'cycle' } });
    expect(forked.user).toMatchObject({ ok: false, error: { code: 'dependsOnError' } });
    // a long chain of parameters does not exhaust the stack
    const chain = evaluateParameters(Array.from({ length: 5000 }, (_, i) => ({ name: `p${i}`, expr: i === 4999 ? '1' : `p${i + 1} + 1` })));
    expect(chain.p0).toEqual({ ok: true, value: 5000 });
    // the name of a property every object has is not a parameter
    expect(value('constructor + 1', { x: '1' })).toBe('unknownName');
  });

  it('parameter names', () => {
    expect(parameterNameProblem('Zs')).toBeUndefined();
    expect(parameterNameProblem('größe_2')).toBeUndefined();
    expect(parameterNameProblem('sin')).toBeUndefined(); // a function is recognised by its parenthesis
    expect(parameterNameProblem('pi')).toMatch(/name of a constant/);
    expect(parameterNameProblem('2x')).toMatch(/must not start with a digit/);
    expect(parameterNameProblem('a b')).toBeDefined();
    expect(parameterNameProblem('a.b')).toBeDefined();
    expect(parameterNameProblem('')).toBeDefined();
    expect(parameterNameProblem('constructor')).toMatch(/is not allowed/);
  });

  it('renaming a parameter in an expression leaves functions and the rest of the text alone', () => {
    expect(renameInExpression('min + min(a, 2) *  amin', 'min', 'floor')).toBe('floor + min(a, 2) *  amin');
    expect(renameInExpression('Zs + 2 * Zp', 'Zp', 'planet')).toBe('Zs + 2 * planet');
    expect(renameInExpression('a+a', 'a', 'bb')).toBe('bb+bb');
  });
});

describe('range of a numeric field', () => {
  it('bounds, non-zero and an integer with a tolerance', () => {
    expect(checkNumber(0, { title: 'x', unit: 'mm', min: { value: 0 } })).toEqual({ ok: true, value: 0 });
    expect(checkNumber(0, { title: 'x', unit: 'mm', min: { value: 0, open: true } })).toMatchObject({ ok: false, code: 'outOfRange' });
    expect(checkNumber(0, { title: 'x', unit: 'mm', nonZero: true })).toMatchObject({ ok: false, code: 'outOfRange' });
    expect(checkNumber(-0, { title: 'x', unit: 'mm' })).toEqual({ ok: true, value: 0 });
    expect(Object.is((checkNumber(-0, { title: 'x', unit: 'mm' }) as { value: number }).value, 0)).toBe(true);
    const count = { title: 'Count', unit: 'count' as const, integer: true, min: { value: 1 }, max: { value: 500 } };
    expect(checkNumber(0.3 / 0.1, count)).toEqual({ ok: true, value: 3 });
    expect(checkNumber(2.5, count)).toMatchObject({ ok: false, code: 'notInteger' });
    expect(checkNumber(1000, count)).toMatchObject({ ok: false, code: 'outOfRange' });
    expect(checkNumber(Infinity, count)).toMatchObject({ ok: false, code: 'notFinite' });
    expect(checkNumber(1e10, { title: 'x', unit: 'mm' })).toMatchObject({ ok: false, code: 'outOfRange' });
    // an angle entered in degrees by mistake does not pass
    const angle = { title: 'Angle', unit: 'rad' as const, min: { value: -Math.PI, open: true }, max: { value: Math.PI } };
    expect(checkNumber(90, angle)).toMatchObject({ ok: false, code: 'outOfRange' });
    expect(checkNumber(Math.PI, angle)).toMatchObject({ ok: true });
    expect(checkNumber(-Math.PI, angle)).toMatchObject({ ok: false });
    expect(rangeText(angle)).toBe('in the interval (−π, π]');
    expect(rangeText(count)).toBe('an integer, in the interval [1, 500]');
    expect(rangeText({ title: 'x', unit: 'mm', nonZero: true })).toBe('non-zero');
    expect(rangeText({ title: 'x', unit: 'mm' })).toBe('any');
  });
});
