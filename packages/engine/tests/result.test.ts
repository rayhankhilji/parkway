import { describe, expect, it } from 'vitest';
import { err, expectOk, isErr, isOk, ok, type Result } from '../src/result';

describe('Result', () => {
  it('carries a value on the ok branch', () => {
    const result = ok(7);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(7);
  });

  it('carries an error on the err branch', () => {
    const result = err({ code: 'NOT_YOUR_TURN' });
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ code: 'NOT_YOUR_TURN' });
  });

  it('narrows to the value type through isOk', () => {
    const result: Result<number, string> = ok(3);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // Reading .value here is the assertion — it only compiles once narrowed.
      expect(result.value + 1).toBe(4);
    }
  });

  it('narrows to the error type through isErr', () => {
    const result: Result<number, string> = err('bank is out of houses');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('unwraps an ok result', () => {
    expect(expectOk(ok('value'), 'should be ok')).toBe('value');
  });

  it('throws with both the message and the error when unwrapping an err', () => {
    expect(() => expectOk(err({ code: 'UNEVEN_BUILD' }), 'build should succeed')).toThrow(
      'build should succeed: {"code":"UNEVEN_BUILD"}',
    );
  });
});
