import { EventLog } from './lib.js';

const cells = [];
const buildOrder = []; // ordered list of { col, row } — cells in assembly sequence
const cycles = []; // cycle structs indexed by cycleId
// Flat worklist of every corner found, across all cycles — a cycle made entirely
// of straight/bridge cells can end up with an empty cornerNodeIndices of its own,
// so peeling can't rely on per-cycle lists alone. Entries can go stale (a cell's
// corner status, or even its presence, can change after other corners get
// peeled) or duplicate (a later bounded walk can re-cross an already-found
// corner) — whoever consumes this queue has to recheck before acting on it.
const cornerQueue = [];
let eventLog;

const COLOR_ADDED        = 0xFFB3B3; // light red
const COLOR_WALKED_ONCE  = 0xFFA500; // orange — first time walked
const COLOR_WALKED_TWICE = 0x9B59B6; // purple — second time walked
const COLOR_REMOVED      = 0x2ECC71; // green  — removed from shape / placed in build order
const COLOR_CORNER       = 0xF1C40F; // yellow — convex corner vertex on the outer cycle

function reset() {
  cells.length = 0;
  buildOrder.length = 0;
  cycles.length = 0;
  cornerQueue.length = 0;
  eventLog = new EventLog();
}

/**
 * Return the cycle struct for cycleId, creating it on first use.
 */
function getOrCreateCycle(cycleId) {
  if (cycles[cycleId] === undefined) {
    cycles[cycleId] = { isActive: true, cornerNodeIndices: [] };
  }
  return cycles[cycleId];
}

function setCellColor(id, color) {
  const cell = cells[id];
  eventLog.updateCell(cell.col, cell.row, color);
}

function setCellLabel(id, label) {
  const cell = cells[id];
  eventLog.labelCell(cell.col, cell.row, label);
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
  setCellColor(id, COLOR_REMOVED);
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
        cycleId:   null,
        isVisited: false,
        walked:    0,
      });

      setCellColor(id, COLOR_ADDED);

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
/**
 * Follow the outer boundary walk path from cells[0] — stepping through removed
 * (visited) cells without skipping them — and return the id and outsidePos of
 * the first active (non-removed) cell encountered.
 *
 * This is more efficient than a linear index scan: the cost is proportional
 * only to the number of removed cells at the head of the boundary path, not
 * the total cell count.  If cells[0] is already active it is returned immediately.
 *
 * The outsidePos is derived from the outIdx at the moment of arrival so that
 * the cycle walk continues with the correct orientation.
 */
function findCycleStart() {
  if (!cells[0].isVisited) {
    return { id: 0, outsidePos: { col: cells[0].col - 1, row: cells[0].row } };
  }

  function neighborId(cell, dirIdx) {
    if (dirIdx === 0) return cell.up;
    if (dirIdx === 1) return cell.right;
    if (dirIdx === 2) return cell.down;
    return cell.left;
  }

  // cells[0] has its left neighbour guaranteed exterior → initial outIdx = west (3)
  let outIdx    = 3;
  let currentId = 0;
  const maxSeek = cells.length * 8 + 8;

  for (let s = 0; s < maxSeek; s++) {
    const cell     = cells[currentId];
    const priority = [
      (outIdx + 2) % 4,
      (outIdx + 3) % 4,
      outIdx,
      (outIdx + 1) % 4,
    ];

    let moved = false;
    for (const dirIdx of priority) {
      const nId = neighborId(cell, dirIdx);
      if (nId === null) continue;
      outIdx    = (dirIdx + 1) % 4;
      currentId = nId;
      moved     = true;

      if (!cells[currentId].isVisited) {
        // Arrived at the first active cell — derive outsidePos from outIdx
        const c  = cells[currentId];
        const dc = outIdx === 1 ? 1 : outIdx === 3 ? -1 : 0;
        const dr = outIdx === 2 ? 1 : outIdx === 0 ? -1 : 0;
        return { id: currentId, outsidePos: { col: c.col + dc, row: c.row + dr } };
      }
      break;
    }
    if (!moved) break;
  }

  return null; // valid shapes should never reach here
}

function runPeelSweep() {
  if (cells.length === 0) return;

  // Cell 0 is the top of the first (leftmost) column — its left neighbour is
  // guaranteed to be outside the figure, making it a valid outer cell.
  const start = cells[0];
  const outsidePos = { col: start.col - 1, row: start.row };
  outerBoundaryWalk(0, 0, outsidePos);

  // Second pass: assign cycleIds using walked counts from the first walk.
  // Walk the boundary from cells[0] through any removed tail cells to find
  // the first active cell and a correctly-oriented outsidePos for it.
  const cycleStart = findCycleStart();
  if (cycleStart) {
    outerBoundaryWalkCycle(cycleStart.id, cycleStart.id, cycleStart.outsidePos, 0);
  }

  drainCornerQueue();

  eventLog.markWavefront();
}

/**
 * Repeatedly peel corners from cornerQueue until none remain.
 *
 * Tail removal isn't wired into the bounded re-walk yet, so this is only the
 * corner-peeling half of the algorithm — once a cycle degenerates down to
 * cells with no corners left, whatever remains is simply left untouched for
 * now rather than swept up as a tail.
 *
 * Entries can be stale (their cell, or one of its former neighbours, may
 * already be gone by the time they're reached) or duplicated (a later
 * bounded walk can re-cross an already-found corner) — both are discarded
 * here rather than acted on. A cell's active-neighbour set can only shrink
 * over time (removals are permanent, never undone), so if cellId/prevId/
 * nextId are all still present the entry is still a valid corner — no
 * further geometric recheck is needed beyond that.
 */
function drainCornerQueue() {
  while (cornerQueue.length > 0) {
    const corner = cornerQueue.shift();
    if (cells[corner.cellId].isVisited) continue;
    if (cells[corner.prevId].isVisited) continue;
    if (cells[corner.nextId].isVisited) continue;
    peelCorner(corner);
  }
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
    if (w === 1) setCellColor(id, COLOR_WALKED_ONCE);
    else if (w === 2) setCellColor(id, COLOR_WALKED_TWICE);
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
  let done                = false;
  let everMoved           = false;
  let entryDir            = null;  // move direction that brought the walker to the current cell
  let firstExitDir        = null;  // move direction of the very first step out of idA
  let firstStepNeighborId = null;  // id of the cell reached on the very first step
  let pendingTailId       = null;  // set to the turnaround cell ID until resolved
  let pendingTailFromId   = null;  // the cell before the tail tip (its boundary-side neighbour)
  let startSameSideReturn = false; // true when idA is confirmed to be a tail tip
  let startFromId         = null;  // the cell the walker came from when it returned same-side to idA

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

      // Full-loop stop: back at start and about to retake the first step → done.
      // Resolve any pending tail before stopping so it is not abandoned.
      if (idA === idB && everMoved && currentId === idA && neighborId === firstStepNeighborId) {
        if (pendingTailId !== null) {
          handleTail(pendingTailId, pendingTailFromId);
          pendingTailId     = null;
          pendingTailFromId = null;
        }
        done = true;
        break;
      }

      // Turnaround: exiting through the same face we entered — mark current cell again
      // and record it as the tail origin. The cell before it (the boundary side)
      // is the cell we are at right now before moving, stored as pendingTailFromId
      // so handleTail knows which direction leads back to the boundary.
      if (entryDir !== null && dirIdx === (entryDir + 2) % 4) {
        cells[currentId].walked++;
        emitWalked(currentId);
        pendingTailId     = currentId;
        pendingTailFromId = getNeighborId(cells[currentId], (entryDir + 2) % 4); // the cell we came from
      }

      // If we have a pending tail, check the cell we're about to step into.
      // The last double-visited cell is the one we're leaving (currentId) —
      // detected the moment the next cell's walk count is not already 1.
      if (pendingTailId !== null && cells[neighborId].walked !== 1) {
        handleTail(pendingTailId, pendingTailFromId);
        pendingTailId     = null;
        pendingTailFromId = null;
      }

      outIdx = (dirIdx + 1) % 4;
      if (firstExitDir === null) {
        firstExitDir        = dirIdx;
        firstStepNeighborId = neighborId;
      }
      entryDir  = dirIdx;
      currentId = neighborId;
      everMoved = true;
      moved = true;

      if (currentId === idA) {
        // Returning home: mark start cell again only if it's a same-side return.
        // Record startSameSideReturn so idA can be handled after the loop.
        // startFromId is the cell we stepped from to get back to idA, giving
        // handleTail the correct boundary-side neighbour to use as prevId.
        if (dirIdx === (firstExitDir + 2) % 4) {
          cells[currentId].walked++;
          emitWalked(currentId);
          startSameSideReturn = true;
          startFromId = getNeighborId(cells[currentId], (firstExitDir + 2) % 4); // boundary-side neighbour of idA (opposite of first exit)
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

  // Resolve any pending tail that was not dispatched during the loop.
  if (pendingTailId !== null) {
    handleTail(pendingTailId, pendingTailFromId);
    pendingTailId     = null;
    pendingTailFromId = null;
  }

  // If idA itself is a tail tip (confirmed by its own same-side return), remove it.
  // startFromId is the boundary-side neighbour of idA, used as prevId so that
  // handleTail walks inward rather than back onto the boundary.
  if (startSameSideReturn) {
    handleTail(idA, startFromId);
  }
}

/**
 * Walks the outer boundary of the shape from cell idA to cell idB using the
 * same left-hand rule traversal as outerBoundaryWalk, assigning cycle IDs to
 * cells based on walked counts recorded by the previous walk.
 *
 * Terminology:
 *   - Cycle cell:  cell.walked === 1 — part of an exterior visible cycle;
 *                  receives a cycleId.
 *   - Bridge cell: cell.walked === 2 — a connecting segment between two cycles
 *                  (former tail or double-traversed edge); does NOT receive a
 *                  cycleId except the very first bridge cell of each entry,
 *                  which retains the incoming cycleId to support reconnection.
 *
 * Walk behaviour:
 *   - Cycle cells: assign currentCycleId to each cell visited.
 *   - Cycle → bridge transition: save currentCycleId; continue traversing.
 *   - Bridge → cycle transition:
 *       • If destination already has a cycleId → restore it as currentCycleId
 *         (reconnecting to a known cycle).
 *       • Otherwise → allocate a new cycleId (entering a previously unseen cycle).
 *
 * Termination:
 *   - Full-loop  (idA === idB): stop when the walker returns to idA and is
 *     about to retake the same first step (identical to outerBoundaryWalk).
 *   - Partial walk (idA !== idB): stop when idB is reached.
 *   - Start-cell present: if idA has not been removed (isVisited === false),
 *     stop at the first non-visited (non-invisible) cell encountered.
 *
 * @param {number} idA              - Start cell ID (on the outer boundary)
 * @param {number} idB              - End cell ID   (idA === idB for a full loop)
 * @param {{ col: number, row: number }} outsidePos - Exterior position adjacent
 *   to idA; sets the initial outside direction.
 * @param {number} startingCycleId  - The cycle ID to begin with.
 * @param {number|null} [initialEntryDir] - The entryDir idA should be treated
 *   as having arrived by, for corner-checking its own first move. Needed by
 *   peelCorner (which resumes a walk mid-boundary, at a cell that may itself
 *   have just become a new corner) — leave null for a fresh/global walk
 *   starting at a genuine boundary origin, where idA's own corner status (if
 *   any) is handled separately via the full-loop-stop special case.
 * @returns {number} The next available cycle ID after this walk completes.
 */
export function outerBoundaryWalkCycle(idA, idB, outsidePos, startingCycleId, initialEntryDir = null) {
  // Direction helpers — identical to outerBoundaryWalk
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

  const startCell = cells[idA];
  let outIdx = dirIndexFromDelta(
    outsidePos.col - startCell.col,
    outsidePos.row - startCell.row
  );

  let currentCycleId   = startingCycleId;
  let nextCycleId      = startingCycleId + 1;
  getOrCreateCycle(currentCycleId);

  // Assign cycleId to start cell if it is a cycle cell (walked === 1)
  if (startCell.walked === 1) {
    startCell.cycleId = currentCycleId;
    setCellLabel(idA, currentCycleId);
    eventLog.markComponent();
  }

  // Distinguishes the two ways this function gets called. The global pass-2
  // walk (initialEntryDir === null) only ever touches cells pass 1 already
  // walked once — it must not treat that as "being revisited right now," or
  // every cell would immediately look like a bridge. A peel's resumed walk
  // (initialEntryDir !== null) is different: any cell already at walked
  // === 1 here genuinely is being visited a second time, by this walk on
  // top of whatever set it to 1 earlier — real bridge-forming behaviour.
  const isPeelContinuation = initialEntryDir !== null;

  const maxSteps = cells.length * 8 + 8;
  let steps = 0;
  let done                = false;
  let everMoved           = false;
  let firstExitDir        = null;
  let firstStepNeighborId = null;
  let entryDir            = initialEntryDir; // move direction that brought the walker to the current cell

  let currentId = idA;

  // Convex corner: cell is a cycle cell (walked === 1) and the walker is
  // turning clockwise relative to how it arrived (exitDir = entryDir + 1).
  // A straight-through cell keeps exitDir === entryDir; a reflex (concave)
  // turn would be entryDir - 1 and is deliberately not marked as a corner.
  //
  // prevId/nextId (the neighbours the walker arrived from / is heading to) are
  // recorded alongside the cell id so peelCorner can later re-walk starting
  // from the correct predecessor, in the correct clockwise direction — the
  // corner's two active neighbours alone don't say which is which.
  //
  // entryDir is recorded too: once the corner is removed, resuming the walk
  // from prevId needs the SAME orientation the corner itself had established
  // ((entryDir + 1) % 4), not one re-derived from prevId's own geometry —
  // prevId can have other exterior sides of its own (e.g. its original edge
  // of the shape) that would send a freshly-derived orientation the wrong
  // way, back into unrelated interior structure instead of forward.
  function checkCorner(cellId, cell, dirIdx) {
    if (entryDir !== null && cell.walked === 1 && dirIdx === (entryDir + 1) % 4) {
      const prevId = getNeighborId(cell, (entryDir + 2) % 4);
      // A genuine corner needs a real, still-active predecessor on the
      // reverse side. For a normal (unseeded) walk entryDir always reflects
      // a move just taken, so this is guaranteed — but for idA of a peel's
      // resumed walk, entryDir is inherited/synthetic rather than a real
      // move, so idA can fail this (e.g. it became a dead end, not a corner,
      // once its neighbour was peeled) even though the exit-direction check
      // above matched.
      if (prevId === null || cells[prevId].isVisited) return;
      const nextId = getNeighborId(cell, dirIdx);
      const record = { cellId, prevId, nextId, cycleId: currentCycleId, entryDir };
      getOrCreateCycle(currentCycleId).cornerNodeIndices.push(record);
      cornerQueue.push(record);
      setCellColor(cellId, COLOR_CORNER);
      eventLog.markComponent();
    }
  }

  // Pre-seek: if the start cell is present but unlabeled (it is a bridge cell),
  // take one step to its first active neighbour. This marks the start cell as
  // visited and positions the walk correctly. The main loop handles everything
  // from here onward — no further special-casing is needed.
  if (!startCell.isVisited && startCell.cycleId === null) {
    const seekPriority = [
      (outIdx + 2) % 4,
      (outIdx + 3) % 4,
      outIdx,
      (outIdx + 1) % 4,
    ];
    for (const dirIdx of seekPriority) {
      const neighborId = getNeighborId(startCell, dirIdx);
      if (neighborId === null) continue;
      if (cells[neighborId].isVisited) continue;
      outIdx              = (dirIdx + 1) % 4;
      firstExitDir        = dirIdx;
      firstStepNeighborId = neighborId;
      currentId           = neighborId;
      everMoved           = true;
      entryDir            = dirIdx;
      break;
    }
  }

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
      if (cells[neighborId].isVisited) continue; // treat removed cells as non-existent

      // Full-loop stop: back at start and about to retake the first step → done.
      // Check the start cell's own corner status here too — it never gets a
      // "normal" iteration of its own once the walk is about to close the loop.
      if (idA === idB && everMoved && currentId === idA && neighborId === firstStepNeighborId) {
        checkCorner(currentId, cell, dirIdx);
        done = true;
        break;
      }

      const neighbor = cells[neighborId];
      const neighborWalkedBefore = neighbor.walked; // snapshot before this arrival updates it

      checkCorner(currentId, cell, dirIdx);

      // Cycle → bridge: always stamp the bridge entry cell with the current
      // cycleId. On the return trip (bridge → cycle), this is read back to
      // restore the correct cycle context. Overwriting a previous tag is
      // intentional — the most recent entry determines the active cycle.
      if (cell.walked === 1 && neighbor.walked === 2) {
        neighbor.cycleId = currentCycleId;
      }

      // Bridge → cycle: restore the cycle context saved on the bridge entry cell,
      // or fall back to the destination cell's ID (reconnect) or a fresh allocation.
      //   cell.cycleId != null → this bridge cell was tagged when we entered the
      //     bridge from a cycle cell; restore that context (the "return trip" pick-up).
      //   neighbor.cycleId != null → destination already labeled; reconnect to it.
      //   otherwise → entering a previously unseen cycle; allocate a fresh ID.
      if (cell.walked === 2 && neighbor.walked === 1) {
        if (cell.cycleId != null) {
          currentCycleId = cell.cycleId;
        } else if (neighbor.cycleId != null) {
          currentCycleId = neighbor.cycleId;
        } else {
          currentCycleId = nextCycleId++;
          getOrCreateCycle(currentCycleId);
        }
      }

      outIdx = (dirIdx + 1) % 4;
      if (firstExitDir === null) {
        firstExitDir        = dirIdx;
        firstStepNeighborId = neighborId;
      }
      entryDir  = dirIdx;
      currentId = neighborId;
      everMoved = true;
      moved = true;

      // Track walked count for this arrival, mirroring outerBoundaryWalk's
      // unconditional per-arrival increment (pass 1 has no such gap — every
      // visit counts, and bridge cells simply fall out of cells that end up
      // visited twice). Here that history is spread across separate peels
      // instead of one continuous walk, so it has to be derived as each
      // arrival happens rather than looked up from a single earlier pass:
      //   - walked === 0 (never touched by any pass): first visit — becomes
      //     a cycle cell.
      //   - walked === 1 (already established, by pass 1 or an earlier
      //     peel): this is a second visit — becomes a bridge, same as it
      //     would have if both visits had happened within one continuous
      //     walk. Stamp its cycleId while cell is still a plain cycle cell
      //     (walked === 1), mirroring the cycle → bridge case above for a
      //     bridge that's only becoming one right now.
      //   - walked >= 2: already a bridge; left alone.
      // The walked === 1 case only applies to a peel's resumed walk — during
      // the global pass-2 walk every cell already starts at walked === 1
      // (set by pass 1), so treating that as "a second visit" there would
      // immediately turn the entire cycle into bridges.
      if (neighborWalkedBefore === 0) {
        neighbor.walked = 1;
        setCellColor(neighborId, COLOR_WALKED_ONCE);
        eventLog.markComponent();
      } else if (isPeelContinuation && neighborWalkedBefore === 1) {
        neighbor.walked = 2;
        if (cell.walked === 1) neighbor.cycleId = currentCycleId;
        setCellColor(neighborId, COLOR_WALKED_TWICE);
        eventLog.markComponent();
      }

      // Assign cycleId to cycle cells that have not yet been labeled.
      if (neighbor.walked === 1 && neighbor.cycleId == null) {
        neighbor.cycleId = currentCycleId;
        setCellLabel(neighborId, currentCycleId);
        eventLog.markComponent();
      }

      if (idA !== idB && currentId === idB) done = true;

      break;
    }

    if (!moved && !done) break; // Dead end — should not occur on a valid boundary
  }

  return nextCycleId;
}

/**
 * Remove one corner cell from a cycle and walk the newly exposed edge back
 * around to reconnect with the rest of the cycle.
 *
 * The corner's prevId/nextId (recorded by checkCorner when the corner was
 * found) give the correct start/end points and direction for the bounded
 * walk — prevId is upstream of the corner in the original clockwise walk, so
 * starting there and walking forward is what actually finds a newly exposed
 * shortcut, rather than heading off the other way around the old boundary.
 *
 * The walk's starting orientation reuses the corner's own — (entryDir + 1) %
 * 4 — rather than deriving one from the corner's grid position. prevId can
 * have its own unrelated exterior sides (e.g. an original edge of the shape),
 * and orienting from raw position picks up on those instead, sending the
 * walk into unrelated interior structure instead of forward through the
 * newly exposed edge.
 *
 * Tail detection is intentionally not handled here yet; this only exercises
 * the bounded walk / walked-count mechanics for newly exposed cells.
 *
 * Callers pulling from cornerQueue rather than a fresh checkCorner call must
 * recheck the entry first (cellId not already visited, prevId/nextId still
 * active) — the queue can hold stale or duplicate entries left over from
 * other peels since it isn't pruned as the shape changes.
 *
 * @param {{cellId: number, prevId: number, nextId: number, cycleId: number, entryDir: number}} corner
 *   - An entry from cornerQueue or cycles[cycleId].cornerNodeIndices
 * @returns {number} The next available cycle ID after this walk completes.
 */
export function peelCorner(corner) {
  const { cellId, prevId, nextId, cycleId, entryDir } = corner;
  const prevCell = cells[prevId];
  const outIdx = (entryDir + 1) % 4;
  const dc = outIdx === 1 ? 1 : outIdx === 3 ? -1 : 0;
  const dr = outIdx === 2 ? 1 : outIdx === 0 ? -1 : 0;
  const outsidePos = { col: prevCell.col + dc, row: prevCell.row + dr };

  removeFromShape(cellId);

  return outerBoundaryWalkCycle(prevId, nextId, outsidePos, cycleId, entryDir);
}

/**
 * Remove the tail segment starting at tailCellId back to the nearest cycle.
 *
 * Starts with prevId=null so the tip cell's only unvisited neighbour (the next
 * cell along the tail toward the cycle) is included in `forward` from the very
 * first step. As each cell is removed (isVisited=true), the isVisited filter
 * prevents the traversal from going backward, so the chain naturally advances
 * inward without needing an explicit fromId.
 *
 * Stops when:
 *   - forward.length === 0: isolated tip (no further chain), remove and stop.
 *   - cell.walked < 2: reached a cycle cell (walked only once), stop without removing.
 *   - forward.length >= 2: junction with multiple active forward paths, stop without
 *     removing. This guards against the case where the boundary walker re-enters the
 *     cycle cell adjacent to the tail (incrementing its walked count to 2) so the
 *     walked < 2 check alone would not catch it.
 *
 * @param {number} tailCellId  - The turnaround cell where the tail begins
 * @param {number} _fromId     - Retained for call-site documentation; not used
 */
function handleTail(tailCellId, _fromId) {
  let prevId    = null;
  let currentId = tailCellId;

  while (true) {
    const cell = cells[currentId];
    const forward = [cell.up, cell.right, cell.down, cell.left]
      .filter(nId => nId !== null && nId !== prevId && !cells[nId].isVisited);

    if (forward.length === 0) {
      // Isolated tip — remove and stop
      removeFromShape(currentId);
      break;
    }

    if (cell.walked < 2 || forward.length >= 2) {
      // Cycle cell (walked once) or junction (multiple active forward paths) — stop without removing.
      // If walked >= 2, the extra count is an artifact of the boundary walker re-entering this
      // cell when exiting the tail. Undo it so the cell reflects its true walk count.
      if (cell.walked >= 2) {
        cells[currentId].walked--;
        setCellColor(currentId, COLOR_WALKED_ONCE);
        eventLog.markComponent();
      }
      break;
    }

    // Double-visited, single forward path: part of the tail — remove and advance
    removeFromShape(currentId);
    prevId    = currentId;
    currentId = forward[0];
    eventLog.markComponent();
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
  return { eventLog, vcompCount: cells.length, stats, cells: [...cells], buildOrder: [...buildOrder], cycles: [...cycles], cornerQueue: [...cornerQueue] };
}
