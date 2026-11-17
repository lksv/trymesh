// Regressions from reviews of the MCP package.
import { describe, expect, it } from 'vitest';
import { engineTypes } from '../src/api';

describe('regressions from reviews', () => {
  // D64, the review of 6a part 5: the description for the AI keeps everything after the ports, so
  // the result of a sketch with its curves that are not own is in it (a note had said it was not).
  it('describe_api shows ResultCurve and the curves of a sketch result', () => {
    const types = engineTypes();
    expect(types).toContain('export interface ResultCurve');
    expect(types).toContain('curves: Record<Id, ResultCurve>;');
  });
});
