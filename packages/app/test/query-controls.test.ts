// The controls of the generic form of a query that no query of the catalog reaches yet, driven
// directly: the page of the tests is the one of `app.test.ts`, the form is written by hand.
import { afterEach, describe, expect, it } from 'vitest';
import { CONTROLS, type Form } from '../src/queries/controls';
import { type Harness, startApp } from './app-kit';

let harness: Harness | undefined;
afterEach(() => {
  harness?.close();
  harness = undefined;
});

// A form that only remembers what its controls wrote.
function recordingForm(): { form: Form; written: unknown[] } {
  const written: unknown[] = [];
  const form = { armed: undefined, arm: () => undefined, set: (_path: unknown, value: unknown) => void written.push(value), get: () => written[written.length - 1], title: (_spec: unknown, name: string) => name } as unknown as Form;
  return { form, written };
}

describe('controls of the form of a query', () => {
  // review of D39, the app side: each field wrote the vector with only its own number
  it('a vector: its three fields share what was typed, in any order', async () => {
    const h = (harness = await startApp());
    const { form, written } = recordingForm();
    const fields = Array.from(CONTROLS.vector({ kind: 'vector' }, undefined, ['direction'], form, {})[0].querySelectorAll('input'));
    h.type(fields[2], '3', true);
    h.type(fields[0], '1', true);
    h.type(fields[1], '-2.5', true);
    expect(written).toEqual([[undefined, undefined, 3], [1, undefined, 3], [1, -2.5, 3]]);
    h.type(fields[1], '', true);
    expect(written[3]).toEqual([1, undefined, 3]);
  });

  it('a vector: starts from the value of the draft, and is not given once all three fields are empty', async () => {
    const h = (harness = await startApp());
    const { form, written } = recordingForm();
    const fields = Array.from(CONTROLS.vector({ kind: 'vector' }, [0, 0, 1], ['direction'], form, {})[0].querySelectorAll('input'));
    expect(fields.map((field) => field.value)).toEqual(['0', '0', '1']);
    h.type(fields[0], '2', true);
    expect(written[0]).toEqual([2, 0, 1]);
    for (const field of fields) h.type(field, '', true);
    expect(written[written.length - 1]).toBeUndefined();
  });

  // Found in a browser with the first query that takes two bodies and a record (D41): a value
  // chosen inside a list does not rebuild the panel, and `Add` wrote the list as it was built.
  it('a list and a record write what the draft holds when they are pressed, not what they were built with', async () => {
    const h = (harness = await startApp());
    const { form, written } = recordingForm();
    // built with one empty item; since then the draft got a body in it
    const list = CONTROLS.list({ kind: 'list', of: { kind: 'text' } }, [undefined], ['names'], form, {});
    written.push(['first']);
    (list[list.length - 1] as HTMLButtonElement).click(); // Add
    expect(written[written.length - 1]).toEqual(['first', undefined]);
    written.push(['first', 'second']);
    (list[0].querySelector('button') as HTMLButtonElement).click(); // remove the first item
    expect(written[written.length - 1]).toEqual(['second']);
    // a record built with one key without a value; since then the draft got its value
    const record = CONTROLS.record({ kind: 'record', keys: 'text', of: { kind: 'text' } }, { a: undefined }, ['byName'], form, {});
    written.push({ a: 'one' });
    h.type(record[record.length - 1] as HTMLInputElement, 'b', true);
    expect(written[written.length - 1]).toEqual({ a: 'one', b: undefined });
    written.push({ a: 'one', b: 'two' });
    (record[0].querySelector('button') as HTMLButtonElement).click(); // remove the key a
    expect(written[written.length - 1]).toEqual({ b: 'two' });
  });

  // review of D39, the app side: a field marked as wrong kept the value from before in the draft
  it('a number: what was typed is written also when it is marked as wrong', async () => {
    const h = (harness = await startApp());
    const { form, written } = recordingForm();
    const field = CONTROLS.number({ kind: 'number', spec: { title: 'Width', unit: 'mm', min: { value: 0 } } }, undefined, ['width'], form, {})[0].querySelector('input') as HTMLInputElement;
    h.type(field, '4', true);
    h.type(field, '-1', true);
    h.type(field, 'a + 1', true);
    h.type(field, '', true);
    expect(written).toEqual([4, -1, 'a + 1', undefined]);
  });
});
