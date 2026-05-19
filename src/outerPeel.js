import { EventLog } from './lib.js';

const cells = [];
const buildOrder = []; // ordered list of { col, row } — cells in assembly sequence
let eventLog;

const COLOR_ADDED        = 0xFFB3B3; // light red
const COLOR_WALKED_ONCE  = 0xFFA500; // orange — first time walked
const COLOR_WALKED_TWICE = 0x9B59B6; // purple — second time walked
const COLOR_REMOVED      = 0x2ECC71; // green  — removed from shape / placed in build order

function reset() {
  cells.length = 0;
  buildOrder.length = 0;
  eventLog = new EventLog();
}

/**
 * Remove a cell from the shape: marks it visited, emits a color event, and
 * appends its coordinates to the build order. Ignored if already removed.
 * Severing adjacency links is left to the caller (the algorithm handles
 * neighbour unlinking as needed when it advances).
 *
 * @param {number} id - Cell ID to remove
 */
export function removeFromShape(id) {
  const cell = cells[id];
  if (cell.isVisited) return;
  cell.isVisited = true;
  eventLog.updateCell(cell.col, cell.row, COLOR_REMOVED);
  eventLog.markComponent();
  buildOrder.push({ col: cell.col, row: cell.row });
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
  // Full-loop termination (idA === idB):
  //   Stop when we return to idA and are about to take the same first step again
  //   (neighborId === firstStepNeighborId). This ensures the walk goes all the way
  //   around even when the start cell has multiple interior edges — e.g., a start
  //   cell with a neighbor to the right AND below will correctly traverse both
  //   directions before stopping, rather than halting on the first return.
  const maxSteps = cells.length * 8 + 8;
  let steps = 0;
  let done              = false;
  let everMoved         = false;
  let entryDir          = null; // move direction that brought the walker to the current cell
  let firstExitDir      = null; // move direction of the very first step out of idA
  let firstStepNeighborId = null; // id of the cell reached on the very first step
  let pendingTailId     = null; // set to the turnaround cell ID until the next unwalked cell is reached

  while (!done && steps < maxSteps) {
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

      // Full-loop stop: back at start and about to retake the first step → done
      if (idA === idB && everMoved && currentId === idA && neighborId === firstStepNeighborId) {
        done = true;
        break;
      }

      // Turnaround: exiting through the same face we entered — mark current cell again
      // and record it as the tail origin
      if (entryDir !== null && dirIdx === (entryDir + 2) % 4) {
        cells[currentId].walked++;
        emitWalked(currentId);
        pendingTailId = currentId;
      }

      // If we have a pending tail, check the cell we're about to step into.
      // The last double-visited cell is the one we're leaving (currentId) —
      // detected the moment the next cell's walk count is not already 1.
      if (pendingTailId !== null && cells[neighborId].walked !== 1) {
        handleTail(pendingTailId, currentId);
        pendingTailId = null;
      }

      outIdx = (dirIdx + 1) % 4;
      if (firstExitDir === null) {
        firstExitDir      = dirIdx;
        firstStepNeighborId = neighborId;
      }
      entryDir  = dirIdx;
      currentId = neighborId;
      everMoved = true;
      moved = true;

      if (currentId === idA) {
        // Returning home: mark start cell again only if it's a same-side return.
        // Do NOT overwrite pendingTailId here — the real tail origin was already
        // recorded at the branch tip that caused this same-side return, and
        // overwriting it would prevent that tail from ever being resolved.
        if (dirIdx === (firstExitDir + 2) % 4) {
          cells[currentId].walked++;
          emitWalked(currentId);
        }
      } else {
        cells[currentId].walked++;
        emitWalked(currentId);

        // Partial-walk stop: reached the target cell
        if (idA !== idB && currentId === idB) done = true;
      }
      break;
    }

    if (!moved && !done) break; // Dead end — should not occur on a valid boundary
  }
}

/**
 * Remove the tail segment starting at tailCellId back to the nearest cycle.
 *
 * Traverses from tailCellId toward the shape interior, removing each cell as
 * long as it is a pure chain link — exactly one unvisited forward neighbour
 * (not counting the cell we came from). Stops without removing the first cell
 * that has 0 or 2+ forward neighbours: 0 means a dead end already resolved,
 * 2+ means a junction that belongs to a cycle and must be preserved.
 *
 * This degree-based criterion handles the case where tailCellId ===
 * firstUnmarkedId (e.g. a tail rooted at the start vertex) without requiring
 * a separate edge case.
 *
 * @param {number} tailCellId      - The turnaround cell where the tail begins
 * @param {number} _firstUnmarkedId - The last double-visited boundary cell
 *   (retained as a parameter for context/debugging; not used as a stop condition)
 */
function handleTail(tailCellId, _firstUnmarkedId) {
  let prevId    = null;
  let currentId = tailCellId;

  while (true) {
    const cell = cells[currentId];
    const forward = [cell.up, cell.right, cell.down, cell.left]
      .filter(nId => nId !== null && nId !== prevId && !cells[nId].isVisited);

    // Stop at a junction (cycle) or complete dead end — do not remove this cell
    if (forward.length !== 1) break;

    removeFromShape(currentId);
    prevId    = currentId;
    currentId = forward[0];
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
  return { eventLog, vcompCount: cells.length, stats, cells: [...cells], buildOrder: [...buildOrder] };
}
