import { EventLog } from './lib.js';

const cells = [];
let eventLog;

const COLOR_ADDED      = 0xFFB3B3; // light red
const COLOR_PROCESSING = 0x90EE90; // light green
const COLOR_VISITED    = 0xADD8E6; // light blue

function reset() {
  cells.length = 0;
  eventLog = new EventLog();
}

// TODO: Populate the grid cell list from the matrix.
// Each entry should store enough per-cell state for the peeling process.
function initializeCells(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (matrix[row][col]) {
        cells.push({ col, row, layer: undefined, isVisited: false });
        eventLog.updateCell(col, row, COLOR_ADDED);
      }
    }
  }
}

// TODO: Classify each occupied cell into a peel layer (0 = outermost, 1 = next, ...).
// The outer peel algorithm repeatedly identifies boundary cells (cells that have at
// least one empty 4-neighbor) and assigns them to the current layer before removing
// them and repeating on the remaining interior.
function computePeelLayers() {
  // Stub: no layers assigned yet.
}

// TODO: Orient edges within a single peel layer.
// Edges between cells in the same layer should be oriented to form a spanning
// structure across that layer (e.g., a directed path or ring along the boundary).
function orientLayerEdges(_layer) {
  // Stub: no edges oriented yet.
}

// TODO: Orient edges between adjacent peel layers (layer k → layer k+1).
// These edges carry the "peel inward" direction and together with the
// within-layer edges must form a spanning tree of the whole shape.
function orientInterLayerEdges(_outerLayer, _innerLayer) {
  // Stub: no edges oriented yet.
}

// TODO: Process all peel layers from outermost to innermost, marking cells
// and orienting edges at each step, and emitting the appropriate EventLog events.
function runPeelSweep() {
  // Stub: emit a single "visited" pass over all cells to satisfy the renderer.
  for (const cell of cells) {
    eventLog.updateCell(cell.col, cell.row, COLOR_PROCESSING);
    eventLog.markComponent();
    eventLog.updateCell(cell.col, cell.row, COLOR_VISITED);
    cell.isVisited = true;
  }
  eventLog.markWavefront();
}

/**
 * Runs the outer peel algorithm on the provided matrix grid.
 *
 * The outer peel algorithm orients edges by iteratively identifying and
 * processing boundary (outer) cells layer by layer, from the outermost
 * perimeter inward, until all cells have been visited.
 *
 * @param {boolean[][]} matrix - 2D matrix where true represents a cube and false represents empty space
 * @param {Object} options - Optional parameters: { startX, startY } to specify a hint vertex (unused by stub)
 * @returns {{ eventLog: EventLog, vcompCount: number }}
 */
export function runAlgorithm(matrix, options = {}) {
  reset();

  initializeCells(matrix);
  computePeelLayers();
  runPeelSweep();

  return { eventLog, vcompCount: cells.length };
}
