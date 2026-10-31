import { EventLog } from './lib.js';

// Direction indices run clockwise in screen coordinates.
const DIRS = [
  { dc: 0, dr: -1 }, // north
  { dc: 1, dr: 0 },  // east
  { dc: 0, dr: 1 },  // south
  { dc: -1, dr: 0 }, // west
];
// Perimeter travel directions are clockwise: east, south, west, north.
const TRAVEL_DIRS = [
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 0, dr: -1 },
];
const OPPOSITE = [2, 3, 0, 1];

const COLOR_ADDED = 0x808080;
const COLOR_LEAF = 0xE67E22;
const COLOR_CANDIDATE = 0xF1C40F;
const COLOR_REMOVED = 0x2ECC71;

/**
 * Perimeter-driven outer peel.
 *
 * The walker's state is an oriented side of an active cell, not a cell. Each
 * accessible oriented boundary side is explored at most once. A perimeter
 * walk stops at a side already explored, so old perimeter sections are never
 * rescanned.
 *
 * Candidate queues are append-only with head indices. Every cell is
 * reclassified only at initialization and when a cell in its 8-neighbourhood
 * changes state, so queue creation and stale-entry checks are constant work
 * per local update.
 */
export function runAlgorithm(matrix, _options = {}) {
  const eventLog = new EventLog();
  eventLog.mode = 'outer-peel';
  const cells = [];
  const byPosition = new Map();
  const buildOrder = [];
  const peelGroups = [];
  const leafQueue = [];
  const safeQueue = [];
  const exposedSides = new Set();
  const knownOutsideSides = new Set();
  let leafHead = 0;
  let safeHead = 0;
  let nextRevision = 1;

  const positionKey = (col, row) => `${col},${row}`;
  const sideKey = (id, dir) => id * 4 + dir;

  function neighborId(cell, dir) {
    switch (dir) {
      case 0: return cell.up;
      case 1: return cell.right;
      case 2: return cell.down;
      default: return cell.left;
    }
  }

  function lookupNeighborId(cell, dir) {
    const { dc, dr } = DIRS[dir];
    return byPosition.get(positionKey(cell.col + dc, cell.row + dr)) ?? null;
  }

  function isActive(id) {
    return id !== null && id !== undefined && !cells[id].isRemoved;
  }

  function activeDegree(cell) {
    let degree = 0;
    for (let dir = 0; dir < 4; dir++) {
      if (isActive(neighborId(cell, dir))) degree++;
    }
    return degree;
  }

  function hasOutsideSide(cell) {
    for (let dir = 0; dir < 4; dir++) {
      if (knownOutsideSides.has(sideKey(cell.id, dir))) return true;
    }
    return false;
  }

  function outsideSideCount(cell) {
    let count = 0;
    for (let dir = 0; dir < 4; dir++) {
      if (knownOutsideSides.has(sideKey(cell.id, dir))) count++;
    }
    return count;
  }

  function setColor(cell, color) {
    if (cell.visualColor === color) return;
    cell.visualColor = color;
    eventLog.updateCell(cell.col, cell.row, color);
  }

  // A 2x2 block is singular only when its occupied cells are exactly one
  // diagonal pair. Check only blocks touched by the proposed removal.
  function createsSingularDiagonal(removedIds) {
    const removed = new Set(removedIds);
    const checkedBlocks = new Set();

    for (const id of removedIds) {
      const cell = cells[id];
      for (let top = cell.row - 1; top <= cell.row; top++) {
        for (let left = cell.col - 1; left <= cell.col; left++) {
          const blockKey = positionKey(left, top);
          if (checkedBlocks.has(blockKey)) continue;
          checkedBlocks.add(blockKey);

          const ids = [
            byPosition.get(positionKey(left, top)),
            byPosition.get(positionKey(left + 1, top)),
            byPosition.get(positionKey(left, top + 1)),
            byPosition.get(positionKey(left + 1, top + 1)),
          ];
          const occupied = ids.map(id => id !== undefined && !removed.has(id) && !cells[id].isRemoved);
          if ((occupied[0] && occupied[3] && !occupied[1] && !occupied[2]) ||
              (occupied[1] && occupied[2] && !occupied[0] && !occupied[3])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function hasInitialSingularDiagonal() {
    for (const cell of cells) {
      const right = byPosition.get(positionKey(cell.col + 1, cell.row));
      const down = byPosition.get(positionKey(cell.col, cell.row + 1));
      const diagonal = byPosition.get(positionKey(cell.col + 1, cell.row + 1));
      if (right !== undefined && down !== undefined && diagonal !== undefined) continue;
      if (diagonal !== undefined && right === undefined && down === undefined) return true;
      // The other diagonal orientation is checked with this cell as top-right.
      const leftDown = byPosition.get(positionKey(cell.col - 1, cell.row + 1));
      const left = byPosition.get(positionKey(cell.col - 1, cell.row));
      if (leftDown !== undefined && left === undefined && down === undefined) return true;
    }
    return false;
  }

  function enqueueClassification(cell) {
    if (cell.isRemoved) return;
    const revision = nextRevision++;
    cell.revision = revision;
    cell.queuedAs = null;

    const degree = activeDegree(cell);
    if (degree <= 1) {
      // A graph leaf is peelable only after its empty sides are reached by
      // the exterior walk. This keeps enclosed cavities inaccessible until
      // an opening peel connects them to the outside.
      if (outsideSideCount(cell) < 4 - degree) {
        setColor(cell, COLOR_ADDED);
        return;
      }
      cell.queuedAs = 'leaf';
      leafQueue.push({ id: cell.id, revision });
      setColor(cell, COLOR_LEAF);
      return;
    }

    if (degree !== 2) {
      setColor(cell, COLOR_ADDED);
      return;
    }
    const activeDirs = [];
    for (let dir = 0; dir < 4; dir++) {
      if (isActive(neighborId(cell, dir))) activeDirs.push(dir);
    }
    if (((activeDirs[0] - activeDirs[1] + 4) % 4) % 2 !== 1) {
      setColor(cell, COLOR_ADDED);
      return;
    }

    const outsideDirs = activeDirs.map(dir => OPPOSITE[dir]);
    if (!outsideDirs.every(dir => knownOutsideSides.has(sideKey(cell.id, dir)))) {
      setColor(cell, COLOR_ADDED);
      return;
    }

    const [dirA, dirB] = activeDirs;
    const diagonalCol = cell.col + DIRS[dirA].dc + DIRS[dirB].dc;
    const diagonalRow = cell.row + DIRS[dirA].dr + DIRS[dirB].dr;
    const diagonalId = byPosition.get(positionKey(diagonalCol, diagonalRow));
    const isClosed = isActive(diagonalId);

    let action;
    let partnerId = null;
    if (isClosed) {
      action = 'single';
      if (createsSingularDiagonal([cell.id])) {
        setColor(cell, COLOR_ADDED);
        return;
      }
    } else {
      action = 'pair';
      // Either perpendicular neighbour may be the second member of the pair.
      // Prefer the first eligible direction deterministically.
      for (const dir of activeDirs) {
        const candidateId = neighborId(cell, dir);
        const candidate = cells[candidateId];
        if (activeDegree(candidate) === 2 && hasOutsideSide(candidate)) {
          partnerId = candidateId;
          break;
        }
      }
      if (partnerId === null || createsSingularDiagonal([cell.id, partnerId])) {
        setColor(cell, COLOR_ADDED);
        return;
      }
    }

    cell.queuedAs = action;
    safeQueue.push({ id: cell.id, partnerId, action, revision });
    setColor(cell, COLOR_CANDIDATE);
  }

  function classifyNeighborhood(col, row) {
    // Local rules refer to the 8-cell neighborhood, so refresh the changed
    // position and all eight surrounding positions.
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const id = byPosition.get(positionKey(col + dc, row + dr));
        if (id !== undefined) enqueueClassification(cells[id]);
      }
    }
  }

  // Return boundary sides leaving a grid vertex. Side orientations keep the
  // occupied cell on the right of the directed edge.
  function outgoingBoundarySides(x, y) {
    const candidates = [
      [byPosition.get(positionKey(x, y)), 0, 0],         // north side, eastward
      [byPosition.get(positionKey(x - 1, y)), 1, 1],     // east side, southward
      [byPosition.get(positionKey(x - 1, y - 1)), 2, 2], // south side, westward
      [byPosition.get(positionKey(x, y - 1)), 3, 3],     // west side, northward
    ];
    const result = [];
    for (const [id, sideDir, travelDir] of candidates) {
      if (id === undefined || cells[id].isRemoved) continue;
      if (neighborId(cells[id], sideDir) !== null && isActive(neighborId(cells[id], sideDir))) continue;
      result.push({ id, sideDir, travelDir });
    }
    return result;
  }

  function sideStart(cell, sideDir) {
    switch (sideDir) {
      case 0: return { x: cell.col, y: cell.row, travelDir: 0 };
      case 1: return { x: cell.col + 1, y: cell.row, travelDir: 1 };
      case 2: return { x: cell.col + 1, y: cell.row + 1, travelDir: 2 };
      default: return { x: cell.col, y: cell.row + 1, travelDir: 3 };
    }
  }

  function sideEnd(cell, sideDir) {
    const start = sideStart(cell, sideDir);
    const travel = TRAVEL_DIRS[start.travelDir];
    return { x: start.x + travel.dc, y: start.y + travel.dr };
  }

  function recordBoundarySide(id, dir) {
    const key = sideKey(id, dir);
    if (exposedSides.has(key)) return false;
    exposedSides.add(key);
    knownOutsideSides.add(key);
    const cell = cells[id];
    eventLog.markBorder(cell.col, cell.row, dir);
    enqueueClassification(cell);
    return true;
  }

  function walkNewPerimeter(startId, startDir) {
    let id = startId;
    let sideDir = startDir;
    let previousTravelDir = null;
    let exploredAny = false;

    while (true) {
      const key = sideKey(id, sideDir);
      if (exposedSides.has(key)) return exploredAny;
      if (!recordBoundarySide(id, sideDir)) return exploredAny;
      exploredAny = true;

      const cell = cells[id];
      const start = sideStart(cell, sideDir);
      const end = sideEnd(cell, sideDir);
      previousTravelDir = start.travelDir;

      const outgoing = outgoingBoundarySides(end.x, end.y);
      if (outgoing.length === 0) return exploredAny;

      // Follow the boundary with occupied material on the right: prefer a
      // right turn, then straight, left, and finally a reversal.
      const preference = [
        (previousTravelDir + 1) % 4,
        previousTravelDir,
        (previousTravelDir + 3) % 4,
        (previousTravelDir + 2) % 4,
      ];
      outgoing.sort((a, b) => preference.indexOf(a.travelDir) - preference.indexOf(b.travelDir));
      const next = outgoing[0];
      if (exposedSides.has(sideKey(next.id, next.sideDir))) return exploredAny;
      id = next.id;
      sideDir = next.sideDir;
    }
  }

  function enqueueNewlyExposedSides(removedIds) {
    let walkCount = 0;
    for (const id of removedIds) {
      const removedCell = cells[id];
      for (let dir = 0; dir < 4; dir++) {
        const neighbor = neighborId(removedCell, dir);
        if (!isActive(neighbor)) continue;
        const exposedDir = OPPOSITE[dir];
        const key = sideKey(neighbor, exposedDir);
        if (!exposedSides.has(key) && walkNewPerimeter(neighbor, exposedDir)) walkCount++;
      }
    }
    return walkCount;
  }

  function removeGroup(ids) {
    const activeIds = ids.filter(id => !cells[id].isRemoved);
    if (activeIds.length === 0) return { removed: false, walkCount: 0 };
    if (ids.length === 2 && activeIds.length !== 2) return { removed: false, walkCount: 0 };
    if (createsSingularDiagonal(activeIds)) return { removed: false, walkCount: 0 };

    // Pair removals are one event, so even full-detail playback never exposes
    // the transient one-cell-removed state.
    const updates = [];
    for (const id of activeIds) {
      const cell = cells[id];
      cell.isRemoved = true;
      cell.isVisited = true;
      cell.visualColor = COLOR_REMOVED;
      cell.queuedAs = null;
      updates.push({ col: cell.col, row: cell.row, color: COLOR_REMOVED });
      buildOrder.push({ col: cell.col, row: cell.row });
    }
    if (updates.length === 1) eventLog.updateCell(updates[0].col, updates[0].row, updates[0].color);
    else eventLog.updateCells(updates);
    peelGroups.push(activeIds.map(id => ({ col: cells[id].col, row: cells[id].row })));

    for (const id of activeIds) {
      const cell = cells[id];
      classifyNeighborhood(cell.col, cell.row);
    }
    const walkCount = enqueueNewlyExposedSides(activeIds);
    return { removed: true, walkCount };
  }

  function takeLeaf() {
    while (leafHead < leafQueue.length) {
      const entry = leafQueue[leafHead++];
      const cell = cells[entry.id];
      if (!cell.isRemoved && cell.revision === entry.revision && cell.queuedAs === 'leaf') return cell.id;
    }
    return null;
  }

  function takeSafeCandidate() {
    while (safeHead < safeQueue.length) {
      const entry = safeQueue[safeHead++];
      const cell = cells[entry.id];
      if (cell.isRemoved || cell.revision !== entry.revision || cell.queuedAs !== entry.action) continue;

      if (entry.action === 'pair') {
        const partner = cells[entry.partnerId];
        const isAdjacent = DIRS.some((_, dir) => neighborId(cell, dir) === entry.partnerId);
        const partnerStillEligible = partner && !partner.isRemoved && isAdjacent &&
          activeDegree(partner) === 2 && hasOutsideSide(partner) &&
          !createsSingularDiagonal([cell.id, partner.id]);

        // A partner's degree can change when one of its other neighbours is
        // removed, which may be two cells away from the queued corner. Refresh
        // the corner now so it can select a different partner or leave the
        // safe queue entirely.
        if (!partnerStillEligible) {
          enqueueClassification(cell);
          continue;
        }
      }

      return entry;
    }
    return null;
  }

  // Materialize occupied cells and their static coordinate lookup. The input
  // matrix is the source representation, so initialization is linear in its
  // number of entries; all subsequent work is linear in occupied cells.
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row].length; col++) {
      if (!matrix[row][col]) continue;
      const id = cells.length;
      const cell = {
        id, col, row, isRemoved: false, isVisited: false, visualColor: COLOR_ADDED,
        revision: 0, queuedAs: null,
        up: null, right: null, down: null, left: null,
      };
      cells.push(cell);
      byPosition.set(positionKey(col, row), id);
    }
  }

  // Preserve the adjacency fields returned by the previous implementation.
  for (const cell of cells) {
    cell.up = lookupNeighborId(cell, 0);
    cell.right = lookupNeighborId(cell, 1);
    cell.down = lookupNeighborId(cell, 2);
    cell.left = lookupNeighborId(cell, 3);
  }

  if (hasInitialSingularDiagonal()) {
    eventLog.markComponent();
    eventLog.markWavefront();
    return {
      eventLog,
      vcompCount: cells.length,
      stats: { removed: 0, remaining: cells.length, groups: 0, error: 'Input contains a diagonal-only 2x2 block.' },
      cells,
      buildOrder,
      peelGroups,
      remaining: cells.map(({ id, col, row }) => ({ id, col, row })),
      exploredPerimeterSides: 0,
    };
  }

  for (const cell of cells) enqueueClassification(cell);

  if (cells.length > 0) {
    // The first occupied cell in row-major order has an exposed north or west
    // side. Start from any exposed side and trace the exterior boundary once.
    const first = cells[0];
    let startDir = -1;
    for (let dir = 0; dir < 4; dir++) {
      if (!isActive(neighborId(first, dir))) { startDir = dir; break; }
    }
    if (startDir >= 0) {
      walkNewPerimeter(first.id, startDir);
      eventLog.markPerimeter();
      eventLog.markComponent();
    }
  }

  // Leaves always take priority. Only when none remain do we process a
  // closed single peel or an opening pair peel.
  while (true) {
    const leafId = takeLeaf();
    if (leafId !== null) {
      let removedLeaf = false;
      let currentLeaf = leafId;
      while (currentLeaf !== null) {
        const result = removeGroup([currentLeaf]);
        removedLeaf ||= result.removed;
        currentLeaf = takeLeaf();
      }
      if (removedLeaf) eventLog.markComponent();
      continue;
    }

    const candidate = takeSafeCandidate();
    if (candidate === null) break;
    const result = removeGroup(candidate.action === 'pair' ? [candidate.id, candidate.partnerId] : [candidate.id]);
    if (result.removed) {
      if (candidate.action === 'pair' && result.walkCount > 0) eventLog.markPerimeter();
      eventLog.markComponent();
    }
  }

  eventLog.markWavefront();
  const remaining = cells.filter(cell => !cell.isRemoved).map(({ id, col, row }) => ({ id, col, row }));
  return {
    eventLog,
    vcompCount: cells.length,
    stats: { removed: buildOrder.length, remaining: remaining.length, groups: peelGroups.length },
    cells,
    buildOrder,
    peelGroups,
    remaining,
    exploredPerimeterSides: exposedSides.size,
  };
}
