import { describe, expect, it } from 'vitest';
import { getBoardPack, getSquare } from '@parkway/engine';
import { boardGrid } from '../components/board/layout';

/**
 * The ring arithmetic.
 *
 * Forty squares placed by index into an eleven-track grid is the kind of code
 * that looks right and is off by one somewhere along the third edge. It is also
 * the part that would be slowest to spot by eye — a board with two squares
 * stacked in one cell renders as a board with a gap somewhere else entirely.
 */

const pack = getBoardPack('parkway-classic');
const { placements, tracks, template } = boardGrid(pack);

describe('the board grid', () => {
  it('uses eleven tracks for a forty-square board', () => {
    expect(tracks).toBe(11);
    expect(template).toBe('2fr repeat(9, 1fr) 2fr');
  });

  it('places every square exactly once', () => {
    expect(placements).toHaveLength(pack.squares.length);
    expect(new Set(placements.map((placement) => placement.id)).size).toBe(pack.squares.length);
  });

  it('never puts two squares in the same cell', () => {
    const cells = placements.map((placement) => `${placement.column},${placement.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('keeps every square on the outer ring', () => {
    const offRing = placements.filter(
      (placement) =>
        placement.column !== 1 &&
        placement.column !== tracks &&
        placement.row !== 1 &&
        placement.row !== tracks,
    );
    expect(offRing).toEqual([]);
  });

  it('fills the ring completely, leaving no empty cell', () => {
    const ring: string[] = [];
    for (let column = 1; column <= tracks; column += 1) {
      for (let row = 1; row <= tracks; row += 1) {
        if (column === 1 || column === tracks || row === 1 || row === tracks) {
          ring.push(`${column},${row}`);
        }
      }
    }
    const used = new Set(placements.map((placement) => `${placement.column},${placement.row}`));
    expect(ring.filter((cell) => !used.has(cell))).toEqual([]);
  });

  it('marks exactly four corners, one in each grid corner', () => {
    const corners = placements.filter((placement) => placement.isCorner);
    expect(corners).toHaveLength(4);
    expect(corners.map((corner) => `${corner.column},${corner.row}`).sort()).toEqual(
      [`1,1`, `1,${tracks}`, `${tracks},1`, `${tracks},${tracks}`].sort(),
    );
  });

  it('puts the start square in the bottom right, where travel begins', () => {
    const start = placements[pack.startSquareId];
    expect(start).toEqual({
      id: pack.startSquareId,
      column: tracks,
      row: tracks,
      edge: 'bottom',
      isCorner: true,
    });
  });

  it('puts each named corner in its own corner of the grid', () => {
    const at = (id: number) => {
      const placement = placements[id];
      return placement === undefined ? null : `${placement.column},${placement.row}`;
    };
    // Travel runs anticlockwise: start bottom right, gaol bottom left, free
    // parking top left, go-to-gaol top right.
    expect(at(pack.jail.squareId)).toBe(`1,${tracks}`);
    expect(at(20)).toBe('1,1');
    expect(at(pack.goToJailSquareId)).toBe(`${tracks},1`);
  });

  it('runs anticlockwise, one cell at a time, all the way round', () => {
    // Consecutive squares must be adjacent cells, and the last must join the
    // first — that is what makes it a ring rather than four disconnected edges.
    const gaps: string[] = [];
    for (let index = 0; index < placements.length; index += 1) {
      const from = placements[index];
      const to = placements[(index + 1) % placements.length];
      if (from === undefined || to === undefined) continue;
      const distance = Math.abs(from.column - to.column) + Math.abs(from.row - to.row);
      if (distance !== 1) {
        gaps.push(`${from.id}→${to.id} (${distance} cells apart)`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('faces each square group bar outward', () => {
    const wrong = placements.filter((placement) => {
      if (placement.edge === 'bottom') return placement.row !== tracks;
      if (placement.edge === 'top') return placement.row !== 1;
      if (placement.edge === 'left') return placement.column !== 1;
      return placement.column !== tracks;
    });
    expect(wrong).toEqual([]);
  });

  it('rejects a board that does not form a ring', () => {
    const broken = { ...pack, squares: pack.squares.slice(0, 39) };
    expect(() => boardGrid(broken)).toThrow('does not form a ring');
  });

  it('places the group bars against real squares', () => {
    for (const placement of placements) {
      expect(() => getSquare(pack, placement.id)).not.toThrow();
    }
  });
});
