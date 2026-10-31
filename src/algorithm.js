import { EventLog } from './lib.js';

const vcomps = [];
const vert_edges = [];
const horz_edges = [];
let eventLog;

const COLOR_ADDED      = 0xFFB3B3; // light red
const COLOR_PROCESSING = 0x90EE90; // light green
const COLOR_VISITED    = 0xADD8E6; // light blue

function reset() {
  vcomps.length = 0;
  vert_edges.length = 0;
  horz_edges.length = 0;
  eventLog = new EventLog();
}

function addVerticalComponent(col, rowStart, rowEnd) {
  vcomps.push({
    isVisited: false,
    col: col,
    row_range: [rowStart, rowEnd],
    row_seed: undefined,
    adj_comp_range_left: undefined,
    adj_comp_range_right: undefined,
    edge_range_vert: undefined,
    edge_range_left: undefined,
    edge_range_right: undefined
  });
  for (let row = rowStart; row <= rowEnd; row++) {
    eventLog.updateCell(col, row, COLOR_ADDED);
  }
}

function rowRangesOverlap(range1, range2) {
  const [start1, end1] = range1;
  const [start2, end2] = range2;
  return !(end1 < start2 || end2 < start1);
}

function computeVerticalEdges() {
  for (let i = 0; i < vcomps.length; i++) {
    const vcomp = vcomps[i];
    const [rowStart, rowEnd] = vcomp.row_range;

    // Track the starting edge index for this component
    const edgeRangeStart = vert_edges.length;

    // Create edge for each pair of adjacent cubes within this component
    for (let row = rowStart; row < rowEnd; row++) {
      vert_edges.push({
        col: vcomp.col,
        row: row,
        vcomp_index: i,
        orientation: undefined
      });
    }

    // Set the edge range [inclusive, exclusive]
    vcomp.edge_range_vert = [edgeRangeStart, vert_edges.length];
  }
}

function computeHorizontalEdges() {
  // First pass: add edges during right adjacency processing and set right ranges
  for (let i = 0; i < vcomps.length; i++) {
    const vcomp = vcomps[i];
    const [row1Start, row1End] = vcomp.row_range;

    if (vcomp.adj_comp_range_right !== undefined) {
      const edgeRangeStart = horz_edges.length;
      const [rightStart, rightEnd] = vcomp.adj_comp_range_right;

      for (let j = rightStart; j < rightEnd; j++) {
        const rightVcomp = vcomps[j];
        const [row2Start, row2End] = rightVcomp.row_range;

        // Find overlapping rows
        const overlapStart = Math.max(row1Start, row2Start);
        const overlapEnd = Math.min(row1End, row2End);

        for (let row = overlapStart; row <= overlapEnd; row++) {
          horz_edges.push({
            col: vcomp.col,
            row: row,
            orientation: undefined
          });
        }
      }

      // Set right range immediately - all edges just added
      vcomp.edge_range_right = [edgeRangeStart, horz_edges.length];
    }
  }

  // Second pass: set left ranges by finding edges at col-1 within this component's row range
  for (let i = 0; i < vcomps.length; i++) {
    if (vcomps[i].adj_comp_range_left !== undefined) {
      const targetCol = vcomps[i].col - 1;
      const [rowStart, rowEnd] = vcomps[i].row_range;
      let leftRangeStart = -1;
      let leftRangeEnd = -1;

      for (let j = 0; j < horz_edges.length; j++) {
        if (horz_edges[j].col === targetCol && horz_edges[j].row >= rowStart && horz_edges[j].row <= rowEnd) {
          if (leftRangeStart === -1) leftRangeStart = j;
          leftRangeEnd = j + 1;
        }
      }

      if (leftRangeStart !== -1) {
        vcomps[i].edge_range_left = [leftRangeStart, leftRangeEnd];
      }
    }
  }
}

function computeAdjacencies(cols) {
  // For each column, compute adjacencies to the right
  for (let col = 0; col < cols - 1; col++) {
    const currentColVcomps = vcomps.filter(v => v.col === col);

    for (const vcomp of currentColVcomps) {
      const adjacentIndices = [];

      for (let i = 0; i < vcomps.length; i++) {
        if (vcomps[i].col === col + 1 && rowRangesOverlap(vcomp.row_range, vcomps[i].row_range)) {
          adjacentIndices.push(i);
        }
      }

      // Check if indices are continuous
      if (adjacentIndices.length > 0) {
        let isContinuous = true;
        for (let i = 1; i < adjacentIndices.length; i++) {
          if (adjacentIndices[i] !== adjacentIndices[i - 1] + 1) {
            isContinuous = false;
            break;
          }
        }
        if (isContinuous) {
          vcomp.adj_comp_range_right = [adjacentIndices[0], adjacentIndices[adjacentIndices.length - 1] + 1];
        }
      }
    }
  }

  // For each column, compute adjacencies to the left
  for (let col = 1; col < cols; col++) {
    const currentColVcomps = vcomps.filter(v => v.col === col);

    for (const vcomp of currentColVcomps) {
      const adjacentIndices = [];

      for (let i = 0; i < vcomps.length; i++) {
        if (vcomps[i].col === col - 1 && rowRangesOverlap(vcomp.row_range, vcomps[i].row_range)) {
          adjacentIndices.push(i);
        }
      }

      // Check if indices are continuous
      if (adjacentIndices.length > 0) {
        let isContinuous = true;
        for (let i = 1; i < adjacentIndices.length; i++) {
          if (adjacentIndices[i] !== adjacentIndices[i - 1] + 1) {
            isContinuous = false;
            break;
          }
        }
        if (isContinuous) {
          vcomp.adj_comp_range_left = [adjacentIndices[0], adjacentIndices[adjacentIndices.length - 1] + 1];
        }
      }
    }
  }
}

function initalizeVerticalComponents(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;

  for (let col = 0; col < cols; col++) {
    let inComponent = false;
    let componentStart = 0;

    for (let row = 0; row < rows; row++) {
      if (matrix[row][col]) {
        if (!inComponent) {
          componentStart = row;
          inComponent = true;
        }
      } else {
        if (inComponent) {
          addVerticalComponent(col, componentStart, row - 1);
          inComponent = false;
        }
      }
    }

    // Handle component that extends to end of matrix
    if (inComponent) {
      addVerticalComponent(col, componentStart, rows - 1);
    }
  }

  // Compute left and right adjacencies
  computeAdjacencies(cols);

  // Compute vertical edges
  computeVerticalEdges();

  // Compute horizontal edges
  computeHorizontalEdges();
}


// Returns any vertex (row) in H that has a visited neighbor in column x(H) - d
function findSeedVertex(H, d) {
  const comp = vcomps[H];
  const adjRange = d === 1 ? comp.adj_comp_range_left : comp.adj_comp_range_right;
  if (adjRange === undefined) return undefined;

  const [adjStart, adjEnd] = adjRange;
  for (let j = adjStart; j < adjEnd; j++) {
    if (!vcomps[j].isVisited) continue;
    const overlapStart = Math.max(comp.row_range[0], vcomps[j].row_range[0]);
    const overlapEnd = Math.min(comp.row_range[1], vcomps[j].row_range[1]);
    if (overlapStart <= overlapEnd) return overlapStart;
  }
  return undefined;
}

// Orient each vertical edge in H away from s(H):
//   edge at row >= s points down (+1), edge at row < s points up (-1)
function orientVerticalEdges(H) {
  const comp = vcomps[H];
  const [edgeStart, edgeEnd] = comp.edge_range_vert;
  const s = comp.row_seed;

  for (let i = edgeStart; i < edgeEnd; i++) {
    vert_edges[i].orientation = vert_edges[i].row >= s ? 1 : -1;
    eventLog.addEdge('vertical', vert_edges[i].col, vert_edges[i].row, vert_edges[i].orientation);
  }
}

// Orient all horizontal edges in H's forward direction (d) from H into K.
//   d = +1 → use edge_range_right, orient +1 (left→right)
//   d = -1 → use edge_range_left,  orient -1 (right→left)
function orientHorizontalEdges(H, d) {
  const comp = vcomps[H];
  const edgeRange = d === 1 ? comp.edge_range_right : comp.edge_range_left;
  if (edgeRange === undefined) return;

  const [edgeStart, edgeEnd] = edgeRange;
  for (let i = edgeStart; i < edgeEnd; i++) {
    horz_edges[i].orientation = d;
    eventLog.addEdge('horizontal', horz_edges[i].col, horz_edges[i].row, d);
  }
}

// Add each forward neighbor K of H to W if K is unvisited and not already in W
function expandForwardNeighbors(H, d, W) {
  const comp = vcomps[H];
  const adjRange = d === 1 ? comp.adj_comp_range_right : comp.adj_comp_range_left;
  if (adjRange === undefined) return;

  const [adjStart, adjEnd] = adjRange;
  for (let j = adjStart; j < adjEnd; j++) {
    if (!vcomps[j].isVisited && !W.has(j)) W.add(j);
  }
}

// Orients edges between H and inward neighbor K from K into H,
// but only if no edge between them has been oriented yet.
function orientInwardEdgesIfNeeded(H, K, d) {
  const edgeRange = d === 1 ? vcomps[H].edge_range_left : vcomps[H].edge_range_right;
  if (edgeRange === undefined) return;

  const [edgeStart, edgeEnd] = edgeRange;
  const toOrient = [];

  const [kRowStart, kRowEnd] = vcomps[K].row_range;
  for (let i = edgeStart; i < edgeEnd; i++) {
    if (horz_edges[i].row < kRowStart || horz_edges[i].row > kRowEnd) continue;
    if (horz_edges[i].orientation !== undefined) return;
    toOrient.push(i);
  }

  for (const i of toOrient) {
    horz_edges[i].orientation = d;
    eventLog.addEdge('horizontal', horz_edges[i].col, horz_edges[i].row, d);
  }
}

// Walk inward neighbors (-d side) of H:
//   visited K with unoriented edges → orient from K into H
//   unvisited K not yet in T_{-d}   → add to T_{-d}
function processInwardNeighbors(H, d, T_minus, T_plus) {
  const comp = vcomps[H];
  const adjRange = d === 1 ? comp.adj_comp_range_left : comp.adj_comp_range_right;
  if (adjRange === undefined) return;

  const T_neg_d = d === 1 ? T_minus : T_plus;
  const [adjStart, adjEnd] = adjRange;
  for (let j = adjStart; j < adjEnd; j++) {
    if (vcomps[j].isVisited) {
      orientInwardEdgesIfNeeded(H, j, d);
    } else if (!T_neg_d.has(j)) {
      T_neg_d.add(j);
    }
  }
}

function wavefront(d, T_minus, T_plus) {
  // Let W <- T_d and set T_d to empty
  const T_d = d === 1 ? T_plus : T_minus;
  const W = new Set(T_d);
  T_d.clear();

  // while W is not empty do
  while (W.size > 0) {
    // Remove some component H from W
    const H = W.values().next().value;
    W.delete(H);

    // if H is visited then continue
    if (vcomps[H].isVisited) continue;

    // if s(H) is undefined then
    //   Set s(H) to any vertex of H that has a visited neighbor in column x(H) - d
    if (vcomps[H].row_seed === undefined) {
      vcomps[H].row_seed = findSeedVertex(H, d);
    }

    // Emit processing start for all cells in H
    const [rowStart, rowEnd] = vcomps[H].row_range;
    for (let row = rowStart; row <= rowEnd; row++) {
      eventLog.updateCell(vcomps[H].col, row, COLOR_PROCESSING);
    }
    eventLog.colorDot(vcomps[H].col, vcomps[H].row_seed);
    eventLog.markComponent();

    // Orient all vertical edges in H away from s(H)
    orientVerticalEdges(H);
    eventLog.markEdge();
    // forward side: expand this wave in direction d
    orientHorizontalEdges(H, d);
    eventLog.markEdge();
    expandForwardNeighbors(H, d, W);
    // Inward side: build the frontier for the next wave in direction -d
    processInwardNeighbors(H, d, T_minus, T_plus);
    eventLog.markEdge();

    // Mark H as visited
    vcomps[H].isVisited = true;

    // Emit visited for all cells in H
    for (let row = rowStart; row <= rowEnd; row++) {
      eventLog.updateCell(vcomps[H].col, row, COLOR_VISITED);
    }
  }
}

/**
 * Runs the wavefront sweep algorithm on the provided matrix grid.
 * @param {boolean[][]} matrix - 2D matrix where true represents a cube and false represents empty space
 * @param {Object} options - Optional parameters: { startX, startY } to specify start vertex
 * @returns {Object} Result object containing algorithm output
 */
export function runAlgorithm(matrix, options = {}) {
  reset();
  eventLog.mode = 'wavefront-sweep';
  // Compute column components Hxi and their horizontal adjacencies
  // For all components H, mark H as unvisited and set s(H)

  initalizeVerticalComponents(matrix);
  console.log(vcomps);
  console.log(vert_edges);
  console.log(horz_edges);
  // Initialize global frontier worklists T-1 and T+1 as empty sets
  const T_minus = new Set();
  const T_plus = new Set();

  // Set H_root to the bottom-leftmost component, or find component containing start vertex
  let H_root = 0;
  if (options.startX !== undefined && options.startY !== undefined) {
    // Find the vcomp containing the start vertex
    for (let i = 0; i < vcomps.length; i++) {
      const [rowStart, rowEnd] = vcomps[i].row_range;
      if (vcomps[i].col === options.startX && options.startY >= rowStart && options.startY <= rowEnd) {
        H_root = i;
        break;
      }
    }
  }

  // Set s(Hroot) to the specified start vertex or the lowest vertex in Hroot
  vcomps[H_root].row_seed = options.startY !== undefined ? options.startY : vcomps[H_root].row_range[0];

  // Set d = +1 and T_d <- {H_root}
  let d = 1;
  T_plus.add(H_root);

  // while Td is not empty do
  while ((d === 1 ? T_plus : T_minus).size > 0) {
    wavefront(d, T_minus, T_plus);
    eventLog.markWavefront();
    d = -d;
  }

  return { eventLog, vcompCount: vcomps.length };
}
