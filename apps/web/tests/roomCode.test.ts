import { describe, expect, it } from 'vitest';
import { isRoomCode, normaliseRoomCode, roomCodeAlphabet, roomCodeLength } from '../lib/roomCode';

/**
 * PRD F1 requires an unambiguous alphabet. The point of the rule is that someone
 * reads a code down a phone line and the person at the other end types the same
 * six characters, so the test is about what is absent.
 */
describe('the room code alphabet', () => {
  it('leaves out the characters people confuse', () => {
    for (const character of ['O', '0', 'I', '1']) {
      expect(roomCodeAlphabet).not.toContain(character);
    }
  });

  it('is uppercase letters and digits only, with no repeats', () => {
    expect(roomCodeAlphabet).toMatch(/^[A-Z2-9]+$/);
    expect(new Set(roomCodeAlphabet).size).toBe(roomCodeAlphabet.length);
  });

  it('matches the character class in the database constraint', () => {
    // The migration allows ^[A-HJ-NP-Z2-9]{6}$; anything this generator could
    // produce has to satisfy it, or a valid code would be rejected on insert.
    for (const character of roomCodeAlphabet) {
      expect(character).toMatch(/[A-HJ-NP-Z2-9]/);
    }
  });
});

describe('isRoomCode', () => {
  it('accepts a well-formed code', () => {
    expect(isRoomCode('ABC234')).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isRoomCode('ABC23')).toBe(false);
    expect(isRoomCode('ABC2345')).toBe(false);
    expect(isRoomCode('')).toBe(false);
  });

  it('rejects the ambiguous characters', () => {
    expect(isRoomCode('ABCO34')).toBe(false);
    expect(isRoomCode('ABC034')).toBe(false);
    expect(isRoomCode('ABCI34')).toBe(false);
    expect(isRoomCode('ABC134')).toBe(false);
  });

  it('rejects lowercase, since codes are stored uppercase', () => {
    expect(isRoomCode('abc234')).toBe(false);
  });

  it('rejects punctuation and spaces', () => {
    expect(isRoomCode('ABC-34')).toBe(false);
    expect(isRoomCode('ABC 34')).toBe(false);
  });
});

describe('normaliseRoomCode', () => {
  it('uppercases and trims what someone typed', () => {
    expect(normaliseRoomCode('  abc234 ')).toBe('ABC234');
  });

  it('turns a pasted lowercase code into something valid', () => {
    expect(isRoomCode(normaliseRoomCode('abc234'))).toBe(true);
  });

  it('leaves the length alone', () => {
    expect(normaliseRoomCode('abc234')).toHaveLength(roomCodeLength);
  });
});
