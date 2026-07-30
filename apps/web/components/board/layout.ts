import type { BoardPack, SquareId } from '@parkway/engine';

/**
 * Where each square sits on the board grid.
 *
 * A forty-square board is a ring: four corners and nine ordinary squares along
 * each edge, which is the outer ring of an eleven-track grid. The corner tracks
 * are twice the width of the edge tracks — `2fr repeat(9, 1fr) 2fr` — so a corner
 * occupies a 2×2 area in grid units while still being a single cell. That is what
 * reconciles the design system's "11×11 grid" with its "corners span the 2×2 grid
 * cells": eleven tracks, corners two units across.
 *
 * Travel runs anticlockwise from the bottom right, which is why the bottom edge
 * counts down in columns and the left edge counts down in rows.
 *
 * All of this is arithmetic on the pack's square count rather than a table of
 * forty hardcoded coordinates, so a pack of a different size still lays out and
 * nobody has to proofread forty pairs of numbers.
 */

export type Edge = 'bottom' | 'left' | 'top' | 'right';

export type Placement = {
  readonly id: SquareId;
  /** 1-based CSS grid lines. */
  readonly column: number;
  readonly row: number;
  readonly edge: Edge;
  readonly isCorner: boolean;
};

export type BoardGrid = {
  readonly tracks: number;
  readonly placements: readonly Placement[];
  /** The CSS value for both grid-template-columns and grid-template-rows. */
  readonly template: string;
};

export function boardGrid(pack: BoardPack): BoardGrid {
  const total = pack.squares.length;
  const perEdge = (total - 4) / 4;

  if (!Number.isInteger(perEdge) || perEdge < 1) {
    throw new Error(
      `A board of ${total} squares does not form a ring of four corners and four equal edges`,
    );
  }

  const tracks = perEdge + 2;
  const last = tracks;

  const placements = pack.squares.map((square, index): Placement => {
    const at = (column: number, row: number, edge: Edge, isCorner = false): Placement => ({
      id: square.id,
      column,
      row,
      edge,
      isCorner,
    });

    // The start corner, bottom right. Travel begins here.
    if (index === 0) return at(last, last, 'bottom', true);

    // Bottom edge, running right to left.
    if (index <= perEdge) return at(last - index, last, 'bottom');

    // The gaol corner, bottom left.
    if (index === perEdge + 1) return at(1, last, 'left', true);

    // Left edge, running bottom to top.
    if (index <= 2 * perEdge + 1) return at(1, last - (index - perEdge - 1), 'left');

    // Free parking corner, top left.
    if (index === 2 * perEdge + 2) return at(1, 1, 'top', true);

    // Top edge, running left to right.
    if (index <= 3 * perEdge + 2) return at(1 + (index - 2 * perEdge - 2), 1, 'top');

    // The go-to-gaol corner, top right.
    if (index === 3 * perEdge + 3) return at(last, 1, 'right', true);

    // Right edge, running top to bottom.
    return at(last, 1 + (index - 3 * perEdge - 3), 'right');
  });

  return {
    tracks,
    placements,
    template: `2fr repeat(${perEdge}, 1fr) 2fr`,
  };
}

/**
 * Which side of a square the group colour bar sits on: the outward one, so the
 * ring of colour reads around the outside of the board.
 */
export const groupBarClass: Record<Edge, string> = {
  bottom: 'bottom-0 left-0 right-0 h-[6px]',
  left: 'left-0 top-0 bottom-0 w-[6px]',
  top: 'top-0 left-0 right-0 h-[6px]',
  right: 'right-0 top-0 bottom-0 w-[6px]',
};

/** Edge squares read along their edge, so the side edges rotate their labels. */
export const labelRotationClass: Record<Edge, string> = {
  bottom: '',
  left: '[writing-mode:vertical-rl] rotate-180',
  top: '',
  right: '[writing-mode:vertical-rl]',
};
