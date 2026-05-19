import { EventLog } from './lib.js';

const cells = [];
let eventLog;

const COLOR_ADDED        = 0xFFB3B3; // light red
const COLOR_WALKED_ONCE  = 0xFFA500; // orange — first time walked
const COLOR_WALKED_TWICE = 0x9B59B6; // purple — second time walked

function reset() {
  cells.length = 0;
  eventLog = new EventLog();
}

/**
 * Convert the matrix into a flat list of cell objects with adjacency links.
 *
 * Phase 1 – vertical adjacencies (column-major scan):
 *   Iterate column-by-column, row-by-row within each column.
 *   When a new cell is added, check whether the previous cell added in the
 *   same column has a row coordinate exactly 1 less (directly above). If so,
 *   link them bidirectionally: current.up = prevId and prevId.down = current.id.
 *
 * Phase 2 – horizontal adjacencies (row-pointer scan):
 *   Maintain rowPointer[row] = id of the most recently seen cell at that row
 *   height. Iterate the cell list in insertion order (column-major). For each
 *   cell, if rowPointer[row] already holds a cell whose column is col - 1, they
 *   are direct left/right neighbours: link current.left = that cell and that
 *   cell.right = current.id. Then update rowPointer[row] to current.id.
 */
function initializeCells(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;

  // Phase 1: add cells and link vertical (up/down) adjacencies
  for (let col = 0; col < cols; col++) {
    let prevId  = null;
    let prevRow = null;

    for (let row = 0; row < rows; row++) {
      if (!matrix[row][col]) continue;

      const id = cells.length;
      cells.push({
        id,
        col,
        row,
        up:        null,
        down:      null,
        left:      null,
        right:     null,
        layer:     undefined,
        isVisited: false,
        walked:    0,
      });

      eventLog.updateCell(col, row, COLOR_ADDED);

      // If the previous cell in this column is directly above (row coordinate 1 away), link them
      if (prevId !== null && row === prevRow + 1) {
        cells[id].up       = prevId;
        cells[prevId].down = id;
      }

      prevId  = id;
      prevRow = row;
    }
  }

  // Phase 2: link horizontal (left/right) adjacencies
  // Cells are in column-major order, so each column's cells appear before the next column's.
  const rowPointer = new Array(rows).fill(null); // rowPointer[row] = id of last cell seen at that height

  for (const cell of cells) {
    const leftId = rowPointer[cell.row];

    // If the pointer at this height holds the cell immediately to our left, link them
    if (leftId !== null && cells[leftId].col === cell.col - 1) {
      cell.left           = leftId;
      cells[leftId].right = cell.id;
    }

    rowPointer[cell.row] = cell.id;
  }
}

// TODO: Classify each occupied cell into a peel layer (0 = outermost, 1 = next, ...).
// The outer peel algorithm repeatedly identifies boundary cells (cells with at least
// one null neighbour) and assigns them to the current layer before repeating on the
// remaining interior cells.
function computePeelLayers() {
  // Stub
}

// TODO: Process peel layers from outermost to innermost, emitting EventLog events
// and building the ordered assembly sequence.
function runPeelSweep() {
  if (cells.length === 0) return;

  // Cell 0 is the top of the first (leftmost) column — its left neighbour is
  // guaranteed to be outside the figure, making it a valid outer cell.
  const start = cells[0];
  const outsidePos = { col: start.col - 1, row: start.row };
  outerBoundaryWalk(0, 0, outsidePos);

  eventLog.markWavefront();
}

/**
 * Walks the outer boundary of the shape from cell idA to cell idB, incrementing
 * each visited cell's `walked` counter by 1 (including both endpoints).
 *
 * The walk is a clockwise boundary traversal (left-hand rule: wall on left,
 * outside on right). At each step the outside direction is updated 90° clockwise
 * from the direction of movement, so the walker always knows which side is
 * exterior without re-examining the shape.
 *
 * @param {number} idA - Start cell ID (assumed to be on the outer boundary)
 * @param {number} idB - End cell ID (assumed to be on the outer boundary)
 * @param {{ col: number, row: number }} outsidePos - An exterior (empty) cell
 *   position adjacent to idA. Determines which side of the boundary is "outside"
 *   and sets the initial walking orientation.
 */
export function outerBoundaryWalk(idA, idB, outsidePos) {
  // Direction table: index → { dc, dr }
  // 0=north, 1=east, 2=south, 3=west
  function getNeighborId(cell, dirIdx) {
    if (dirIdx === 0) return cell.up;
    if (dirIdx === 1) return cell.right;
    if (dirIdx === 2) return cell.down;
    return cell.left;
  }

  function dirIndexFromDelta(dc, dr) {
    if (dr < 0) return 0; // north
    if (dc > 0) return 1; // east
    if (dr > 0) return 2; // south
    return 3;             // west
  }

  // Derive initial outside direction from the given exterior position
  const startCell = cells[idA];
  let outIdx = dirIndexFromDelta(
    outsidePos.col - startCell.col,
    outsidePos.row - startCell.row
  );

  function emitWalked(id) {
    const w = cells[id].walked;
    if (w === 1) eventLog.updateCell(cells[id].col, cells[id].row, COLOR_WALKED_ONCE);
    else if (w === 2) eventLog.updateCell(cells[id].col, cells[id].row, COLOR_WALKED_TWICE);
    eventLog.markComponent();
  }

  let currentId = idA;
  cells[currentId].walked++;
  emitWalked(currentId);

  // Left-hand rule (CW traversal, outside on right):
  //   forward    = (outIdx + 3) % 4   (90° CCW from outside = to our left)
  //   priority   = [left-of-fwd, fwd, right-of-fwd, back]
  //              = [(outIdx+2)%4, (outIdx+3)%4, outIdx, (outIdx+1)%4]
  //   new outIdx = (moveIdx + 1) % 4  (90° CW from move direction)
  //
  // Use everMoved to distinguish the start of a full loop from the moment
  // we return to idA=idB — without it the while condition fires immediately.
  const maxSteps = cells.length * 8 + 8;
  let steps = 0;
  let everMoved = false;
  let entryDir     = null; // move direction that brought the walker to the current cell
  let firstExitDir = null; // move direction of the very first step out of idA

  while (!(currentId === idB && everMoved) && steps < maxSteps) {
    steps++;
    const cell = cells[currentId];

    const priority = [
      (outIdx + 2) % 4,
      (outIdx + 3) % 4,
      outIdx,
      (outIdx + 1) % 4,
    ];

    let moved = false;
    for (const dirIdx of priority) {
      const neighborId = getNeighborId(cell, dirIdx);
      if (neighborId === null) continue;

      // Turnaround: exiting through the same face we entered — mark current cell again
      if (entryDir !== null && dirIdx === (entryDir + 2) % 4) {
        cells[currentId].walked++;
        emitWalked(currentId);
      }

      outIdx = (dirIdx + 1) % 4;
      if (firstExitDir === null) firstExitDir = dirIdx;
      entryDir  = dirIdx;
      currentId = neighborId;
      everMoved = true;
      moved = true;

      if (currentId === idA) {
        // Returning home: mark start cell again only if it's a same-side return
        if (dirIdx === (firstExitDir + 2) % 4) {
          cells[currentId].walked++;
          emitWalked(currentId);
        }
      } else {
        cells[currentId].walked++;
        emitWalked(currentId);
      }
      break;
    }

    if (!moved) break; // Dead end — should not occur on a valid boundary
  }
}

// TODO: Compute statistics about the resulting build order once the algorithm is
// implemented. Exact metrics are TBM.
function computeStats() {
  return {};
}

/**
 * Runs the outer peel algorithm on the provided matrix grid.
 *
 * Unlike the wavefront sweep algorithm, this does not produce directed edge
 * orientations. Instead it produces a buildable assembly order: cells are
 * assigned to peel layers (outermost = 0, next = 1, ...) and processed from
 * the outside inward. Statistics about the resulting order are returned
 * alongside the event log.
 *
 * @param {boolean[][]} matrix - 2D matrix where true represents a cube
 * @param {Object} _options - Reserved for future use
 * @returns {{ eventLog: EventLog, vcompCount: number, stats: Object, cells: Object[] }}
 */
export function runAlgorithm(matrix, _options = {}) {
  reset();
  initializeCells(matrix);
  computePeelLayers();
  runPeelSweep();
  const stats = computeStats();
  return { eventLog, vcompCount: cells.length, stats, cells: [...cells] };
}
