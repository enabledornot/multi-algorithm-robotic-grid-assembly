import { describe, it, expect } from 'vitest';
import { runAlgorithm } from './outerPeel.js';

// Helper: build a sparse boolean matrix from (col, row) pairs.
// cols/rows are auto-sized to fit all given coordinates.
function makeMatrix(points) {
  const maxCol = Math.max(...points.map(p => p.col));
  const maxRow = Math.max(...points.map(p => p.row));
  const matrix = Array.from({ length: maxRow + 1 }, () => Array(maxCol + 1).fill(false));
  for (const { col, row } of points) matrix[row][col] = true;
  return matrix;
}

// Return the cell at a given (col, row), or throw if not found.
function findCell(cells, col, row) {
  const cell = cells.find(c => c.col === col && c.row === row);
  if (!cell) throw new Error(`No cell at (col=${col}, row=${row})`);
  return cell;
}

// ─── Vertical adjacency ────────────────────────────────────────────────────────

describe('vertical adjacency', () => {
  // Three cells stacked in the same column, consecutive rows:
  //   (col=0, row=0) → (col=0, row=1) → (col=0, row=2)
  const matrix = makeMatrix([{ col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 }]);
  const { cells } = runAlgorithm(matrix);

  const top    = findCell(cells, 0, 0);
  const middle = findCell(cells, 0, 1);
  const bottom = findCell(cells, 0, 2);

  it('top cell has no up neighbour', () => {
    expect(top.up).toBeNull();
  });

  it('top cell links down to middle', () => {
    expect(top.down).toBe(middle.id);
  });

  it('middle cell links up to top', () => {
    expect(middle.up).toBe(top.id);
  });

  it('middle cell links down to bottom', () => {
    expect(middle.down).toBe(bottom.id);
  });

  it('bottom cell links up to middle', () => {
    expect(bottom.up).toBe(middle.id);
  });

  it('bottom cell has no down neighbour', () => {
    expect(bottom.down).toBeNull();
  });

  it('no horizontal links on a vertical strip', () => {
    for (const cell of cells) {
      expect(cell.left).toBeNull();
      expect(cell.right).toBeNull();
    }
  });
});

describe('vertical gap — non-adjacent rows are not linked', () => {
  // Gap at row 1: only rows 0 and 2 occupied in column 0.
  const matrix = makeMatrix([{ col: 0, row: 0 }, { col: 0, row: 2 }]);
  const { cells } = runAlgorithm(matrix);

  const top    = findCell(cells, 0, 0);
  const bottom = findCell(cells, 0, 2);

  it('top cell has no down neighbour (gap between them)', () => {
    expect(top.down).toBeNull();
  });

  it('bottom cell has no up neighbour (gap between them)', () => {
    expect(bottom.up).toBeNull();
  });
});

// ─── Horizontal adjacency ──────────────────────────────────────────────────────

describe('horizontal adjacency', () => {
  // Three cells in a row, consecutive columns:
  //   (col=0, row=0) → (col=1, row=0) → (col=2, row=0)
  const matrix = makeMatrix([{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }]);
  const { cells } = runAlgorithm(matrix);

  const left   = findCell(cells, 0, 0);
  const middle = findCell(cells, 1, 0);
  const right  = findCell(cells, 2, 0);

  it('leftmost cell has no left neighbour', () => {
    expect(left.left).toBeNull();
  });

  it('leftmost cell links right to middle', () => {
    expect(left.right).toBe(middle.id);
  });

  it('middle cell links left to leftmost', () => {
    expect(middle.left).toBe(left.id);
  });

  it('middle cell links right to rightmost', () => {
    expect(middle.right).toBe(right.id);
  });

  it('rightmost cell links left to middle', () => {
    expect(right.left).toBe(middle.id);
  });

  it('rightmost cell has no right neighbour', () => {
    expect(right.right).toBeNull();
  });

  it('no vertical links on a horizontal strip', () => {
    for (const cell of cells) {
      expect(cell.up).toBeNull();
      expect(cell.down).toBeNull();
    }
  });
});

describe('horizontal gap — non-adjacent columns are not linked', () => {
  // Gap at col 1: only cols 0 and 2 occupied in row 0.
  const matrix = makeMatrix([{ col: 0, row: 0 }, { col: 2, row: 0 }]);
  const { cells } = runAlgorithm(matrix);

  const left  = findCell(cells, 0, 0);
  const right = findCell(cells, 2, 0);

  it('left cell has no right neighbour (gap between them)', () => {
    expect(left.right).toBeNull();
  });

  it('right cell has no left neighbour (gap between them)', () => {
    expect(right.left).toBeNull();
  });
});

// ─── Combined adjacency (2x2 square) ──────────────────────────────────────────

describe('2x2 square — all four adjacency directions', () => {
  // (col=0,row=0)  (col=1,row=0)
  // (col=0,row=1)  (col=1,row=1)
  const matrix = makeMatrix([
    { col: 0, row: 0 }, { col: 1, row: 0 },
    { col: 0, row: 1 }, { col: 1, row: 1 },
  ]);
  const { cells } = runAlgorithm(matrix);

  const tl = findCell(cells, 0, 0); // top-left
  const bl = findCell(cells, 0, 1); // bottom-left
  const tr = findCell(cells, 1, 0); // top-right
  const br = findCell(cells, 1, 1); // bottom-right

  it('top-left links down to bottom-left', ()  => expect(tl.down).toBe(bl.id));
  it('bottom-left links up to top-left',   ()  => expect(bl.up).toBe(tl.id));
  it('top-right links down to bottom-right', () => expect(tr.down).toBe(br.id));
  it('bottom-right links up to top-right', ()  => expect(br.up).toBe(tr.id));

  it('top-left links right to top-right',     () => expect(tl.right).toBe(tr.id));
  it('top-right links left to top-left',      () => expect(tr.left).toBe(tl.id));
  it('bottom-left links right to bottom-right', () => expect(bl.right).toBe(br.id));
  it('bottom-right links left to bottom-left', () => expect(br.left).toBe(bl.id));

  it('top-left has no up or left neighbour', () => {
    expect(tl.up).toBeNull();
    expect(tl.left).toBeNull();
  });

  it('bottom-right has no down or right neighbour', () => {
    expect(br.down).toBeNull();
    expect(br.right).toBeNull();
  });
});
