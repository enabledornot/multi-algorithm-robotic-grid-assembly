import * as PIXI from 'pixi.js';
import { gridMap } from './lib.js';
import { runAlgorithm as executeWavefrontSweep } from './algorithm.js';
import { runAlgorithm as executeOuterPeel } from './outerPeel.js';

function getAlgorithmRunner() {
  const mode = document.getElementById('algorithm-mode').value;
  return mode === 'outer-peel' ? executeOuterPeel : executeWavefrontSweep;
}
const presets = import.meta.glob('./models/*.json', { eager: true });

// Wrap everything in an async IIFE — top-level await hangs in Vite production builds
// with PixiJS. See: https://github.com/pixijs/pixijs/issues/10456
(async () => {

// --- Initialize Pixi Application ---
const app = new PIXI.Application();
const container = document.getElementById('canvas-container');
await app.init({ background: 0xFFFFFF, resizeTo: window });

// Append the canvas
container.appendChild(app.canvas);

// --- World container for pan/zoom ---
const world = new PIXI.Container();
app.stage.addChild(world);

// Camera parameters
const camera = { x: 0, y: 0, zoom: 1 };

// Grid settings
const gridSize = 50;
const gridLineColor = 0xA0A0A0;
const dotRadius = gridSize * 0.1;
const arrowGap = gridSize * 0.05;

// Example cubes
// const cubes = [
//   { x: 0, y: 0, color: 0xff0000 },
//   { x: 0, y: 1, color: 0x00ff00 }
//   // { x: -1, y: -2, color: 0x0000ff }
// ];

const cubes = new gridMap();
let edgeData = null;
let animState = null;
let playInterval = null;
let playbackSpeed = 500; // milliseconds per frame

  // --- Draw grid function ---
  function drawGrid() {
    const g = new PIXI.Graphics();
    const strokeStyle = { color: gridLineColor, width: Math.max(0.5, 1 / camera.zoom) };

    const cols = Math.ceil(app.screen.width / (gridSize * camera.zoom)) + 2;
    const rows = Math.ceil(app.screen.height / (gridSize * camera.zoom)) + 2;

    const startX = Math.floor(camera.x / gridSize) - 1;
    const startY = Math.floor(camera.y / gridSize) - 1;

    // Vertical lines
    for (let i = 0; i < cols; i++) {
      const x = (startX + i) * gridSize;
      g.moveTo(x, startY * gridSize).lineTo(x, (startY + rows) * gridSize).stroke(strokeStyle);
    }

    // Horizontal lines
    for (let j = 0; j < rows; j++) {
      const y = (startY + j) * gridSize;
      g.moveTo(startX * gridSize, y).lineTo((startX + cols) * gridSize, y).stroke(strokeStyle);
    }

    return g;
  }

// --- Draw cubes ---
function drawCubes(cellColors, blackDots) {
  const g = new PIXI.Graphics();
  cubes.forEach((cube) => {
    const px = cube.x * gridSize;
    const py = cube.y * gridSize;
    let color = cube.color;
    if (edgeData) {
      // When flipped: algorithm col = gridY - minY, row = gridX - minX
      const key = edgeData.flipped
        ? `${cube.y - edgeData.minY},${cube.x - edgeData.minX}`
        : `${cube.x - edgeData.minX},${cube.y - edgeData.minY}`;
      if (cellColors[key] !== undefined) color = cellColors[key];
    }
    g.rect(px, py, gridSize, gridSize);
    g.fill(color);
    if (edgeData && edgeData.algorithm !== 'outer-peel') {
      const dotKey = edgeData.flipped
        ? `${cube.y - edgeData.minY},${cube.x - edgeData.minX}`
        : `${cube.x - edgeData.minX},${cube.y - edgeData.minY}`;
      g.circle(px + gridSize / 2, py + gridSize / 2, dotRadius);
      g.fill(blackDots.has(dotKey) ? 0x000000 : 0x808080);
    }

    // Highlight the selected start vertex with a colored border (unless wavefront is running)
    if (selectedStartVertex && !edgeData && cube.x === selectedStartVertex.gridX && cube.y === selectedStartVertex.gridY) {
      g.rect(px + 2, py + 2, gridSize - 4, gridSize - 4);
      g.stroke({ color: 0x00ff00, width: 4 });
    }
  });
  return g;
}

// --- Draw a single arrow from (x1,y1) to (x2,y2) ---
function drawArrow(g, x1, y1, x2, y2, color) {
  const headLen = gridSize * 0.25;
  const headWidth = gridSize * 0.15;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;

  // Pull start/end inward past the dot with a visible gap
  const offset = dotRadius + arrowGap;
  const sx = x1 + offset * ux;
  const sy = y1 + offset * uy;
  const ex = x2 - offset * ux;
  const ey = y2 - offset * uy;

  // Shaft stops at arrowhead base
  const baseX = ex - headLen * ux;
  const baseY = ey - headLen * uy;

  g.moveTo(sx, sy);
  g.lineTo(baseX, baseY);
  g.stroke({ color, width: 2 });

  // Filled arrowhead triangle
  g.moveTo(ex, ey);
  g.lineTo(baseX - headWidth * uy, baseY + headWidth * ux);
  g.lineTo(baseX + headWidth * uy, baseY - headWidth * ux);
  g.closePath();
  g.fill(color);
}

// --- Draw oriented edges as arrows ---
function drawEdges(edges) {
  const g = new PIXI.Graphics();
  if (!edgeData) return g;

  const { minX, minY, flipped } = edgeData;
  const color = 0x808080;

  for (const edge of edges) {
    if (!flipped) {
      if (edge.edgeType === 'vertical') {
        const col = edge.col + minX;
        const fromRow = (edge.orientation === 1 ? edge.row     : edge.row + 1) + minY;
        const toRow   = (edge.orientation === 1 ? edge.row + 1 : edge.row)     + minY;
        drawArrow(g,
          (col + 0.5) * gridSize, (fromRow + 0.5) * gridSize,
          (col + 0.5) * gridSize, (toRow   + 0.5) * gridSize,
          color
        );
      } else if (edge.edgeType === 'horizontal') {
        const leftCol  = edge.col + minX;
        const rightCol = edge.col + 1 + minX;
        const row = edge.row + minY;
        const fromCol = edge.orientation === 1 ? leftCol  : rightCol;
        const toCol   = edge.orientation === 1 ? rightCol : leftCol;
        drawArrow(g,
          (fromCol + 0.5) * gridSize, (row + 0.5) * gridSize,
          (toCol   + 0.5) * gridSize, (row + 0.5) * gridSize,
          color
        );
      }
    } else {
      // Flipped: algorithm col → gridY, algorithm row → gridX
      if (edge.edgeType === 'vertical') {
        // Same gridY, connects adjacent gridX values → horizontal arrow on screen
        const fixedY = (edge.col + minY + 0.5) * gridSize;
        const fromX = ((edge.orientation === 1 ? edge.row     : edge.row + 1) + minX + 0.5) * gridSize;
        const toX   = ((edge.orientation === 1 ? edge.row + 1 : edge.row)     + minX + 0.5) * gridSize;
        drawArrow(g, fromX, fixedY, toX, fixedY, color);
      } else if (edge.edgeType === 'horizontal') {
        // Same gridX, connects adjacent gridY values → vertical arrow on screen
        const fixedX = (edge.row + minX + 0.5) * gridSize;
        const fromY = ((edge.orientation === 1 ? edge.col     : edge.col + 1) + minY + 0.5) * gridSize;
        const toY   = ((edge.orientation === 1 ? edge.col + 1 : edge.col)     + minY + 0.5) * gridSize;
        drawArrow(g, fixedX, fromY, fixedX, toY, color);
      }
    }
  }

  return g;
}

// function drawCube(cube) {
//   const px = c.x * gridSize;
//   const py = cy * gridSize;
//   g.rect(px, py, gridSize, gridSize);
//   g.fill(c.color);
// }

// --- Draw cell labels ---
function drawLabels(cellLabels) {
  const container = new PIXI.Container();
  if (!edgeData) return container;

  const fontSize = Math.max(10, gridSize * 0.55);

  cubes.forEach((cube) => {
    const key = edgeData.flipped
      ? `${cube.y - edgeData.minY},${cube.x - edgeData.minX}`
      : `${cube.x - edgeData.minX},${cube.y - edgeData.minY}`;
    const label = cellLabels[key];
    if (label == null) return;

    const text = new PIXI.Text({
      text: String(label),
      style: { fontSize, fill: 0x000000, fontWeight: 'bold' },
    });
    text.anchor.set(0.5, 0.5);
    text.x = (cube.x + 0.5) * gridSize;
    text.y = (cube.y + 0.5) * gridSize;
    container.addChild(text);
  });

  return container;
}

// --- Main draw ---
function draw() {
  world.removeChildren().forEach(child => child.destroy());

  // Replay event log up to current animation position
  const cellColors = {};
  const cellLabels = {};
  const edges = [];
  const blackDots = new Set();
  if (edgeData && animState) {
    const maxEvent = animState.position === 0 ? 0 : animState.steps[animState.position - 1];
    const events = edgeData.eventLog.events;
    for (let i = 0; i < maxEvent; i++) {
      const ev = events[i];
      if (ev.type === 'updateCell') cellColors[`${ev.col},${ev.row}`] = ev.color;
      else if (ev.type === 'addEdge') edges.push(ev);
      else if (ev.type === 'colorDot') blackDots.add(`${ev.col},${ev.row}`);
      else if (ev.type === 'labelCell') cellLabels[`${ev.col},${ev.row}`] = ev.label;
    }
  }

  const grid = drawGrid();
  const cubeGraphics = drawCubes(cellColors, blackDots);
  const edgeGraphics = drawEdges(edges);
  const labelGraphics = drawLabels(cellLabels);

  world.addChild(grid);
  world.addChild(cubeGraphics);
  world.addChild(edgeGraphics);
  world.addChild(labelGraphics);

  // Apply camera transform
  world.scale.set(camera.zoom);
  world.position.set(-camera.x * camera.zoom, -camera.y * camera.zoom);
}

draw();

function addCube(cordX, cordY, color) {
  cubes.add(cordX, cordY, {x: cordX, y: cordY, color: color});
  draw();
}

function checkCube(cordX, cordY) {
  return cubes.get(cordX, cordY);
}

function removeCube(cordX, cordY) {
  const remCube = cubes.clear(cordX, cordY);
  draw();
  return remCube;
}

function cubeToMatrix() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  cubes.forEach((cube) => {
    count++;
    if (cube.x < minX) minX = cube.x;
    if (cube.x > maxX) maxX = cube.x;
    if (cube.y < minY) minY = cube.y;
    if (cube.y > maxY) maxY = cube.y;
  });

  if (minX === Infinity) return { matrix: [], count: 0 };

  if (flipXY) {
    // Transpose: rows = X range, cols = Y range
    // algorithm col → gridY, algorithm row → gridX
    const rows = maxX - minX + 1;
    const cols = maxY - minY + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(false));
    cubes.forEach((cube) => {
      matrix[cube.x - minX][cube.y - minY] = true;
    });
    return { matrix, count, minX, minY };
  }

  const rows = maxY - minY + 1;
  const cols = maxX - minX + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(false));

  cubes.forEach((cube) => {
    matrix[cube.y - minY][cube.x - minX] = true;
  });

  return { matrix, count, minX, minY };
}

function isConnected(matrix, count) {
  const rows = matrix.length;
  const cols = matrix[0].length;

  // Find first occupied cell
  let startR = -1, startC = -1;
  outer:
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c]) { startR = r; startC = c; break outer; }
    }
  }

  // BFS using 4-directional adjacency
  const visited = new Set();
  const queue = [[startR, startC]];
  visited.add(`${startR},${startC}`);
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      const key = `${nr},${nc}`;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && matrix[nr][nc] && !visited.has(key)) {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  return visited.size === count;
}

function computeTreeStats(eventLog) {
  const adj = new Map();
  const inDegree = new Map();

  for (const ev of eventLog.events) {
    if (ev.type !== 'addEdge') continue;
    let fromCol, fromRow, toCol, toRow;
    if (ev.edgeType === 'vertical') {
      if (ev.orientation === 1) { fromCol = ev.col; fromRow = ev.row;     toCol = ev.col; toRow = ev.row + 1; }
      else                       { fromCol = ev.col; fromRow = ev.row + 1; toCol = ev.col; toRow = ev.row;     }
    } else {
      if (ev.orientation === 1) { fromCol = ev.col;     fromRow = ev.row; toCol = ev.col + 1; toRow = ev.row; }
      else                       { fromCol = ev.col + 1; fromRow = ev.row; toCol = ev.col;     toRow = ev.row; }
    }
    const from = `${fromCol},${fromRow}`;
    const to   = `${toCol},${toRow}`;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
    if (!inDegree.has(from)) inDegree.set(from, 0);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  }

  // Root = unique node with in-degree 0
  let root = null;
  for (const [node, deg] of inDegree) {
    if (deg === 0) { root = node; break; }
  }
  // Single-node case: no edges
  if (!root) {
    const only = eventLog.events.find(e => e.type === 'updateCell');
    if (only) root = `${only.col},${only.row}`;
    else return null;
  }

  // BFS: track depth, level width, leaf count
  const depth = new Map([[root, 0]]);
  const queue = [root];
  const levelCounts = new Map([[0, 1]]);
  let height = 0;
  let leaves = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    const d = depth.get(node);
    const children = adj.get(node) || [];
    if (children.length === 0) leaves++;
    for (const child of children) {
      if (!depth.has(child)) {
        depth.set(child, d + 1);
        if (d + 1 > height) height = d + 1;
        levelCounts.set(d + 1, (levelCounts.get(d + 1) || 0) + 1);
        queue.push(child);
      }
    }
  }

  const width = Math.max(...levelCounts.values());
  return { height, width, leaves };
}

function click(cordX, cordY) {
  stopPlay();
  animState = null;
  edgeData = null;
  updateScrubber();
  updatePlayIcon();
  if (checkCube(cordX, cordY)) {
    removeCube(cordX, cordY);
    // If the removed cube was the selected start vertex, clear it
    if (selectedStartVertex && selectedStartVertex.gridX === cordX && selectedStartVertex.gridY === cordY) {
      selectedStartVertex = null;
      selectingStartVertex = false;
      document.getElementById('remove-start-btn').disabled = true;
      document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
      document.getElementById('select-start-btn').style.backgroundColor = '';
    }
  } else if (!eraserActive) {
    addCube(cordX, cordY, 0x808080);
  }
}

function runAlgorithmWithStartVertex(gridX, gridY, autoPlay = true) {
  clearOutput();
  appendOutput('Starting algorithm from selected vertex...');
  const { matrix, count, minX, minY } = cubeToMatrix();

  if (count === 0) {
    appendOutput('No cubes placed on grid.');
    return;
  }

  // Check if selected vertex is within bounds
  // When flipped: algorithm col = gridY - minY, row = gridX - minX
  const matrixX = flipXY ? (gridY - minY) : (gridX - minX);
  const matrixY = flipXY ? (gridX - minX) : (gridY - minY);
  if (matrixX < 0 || matrixX >= matrix[0].length || matrixY < 0 || matrixY >= matrix.length || !matrix[matrixY][matrixX]) {
    appendOutput('Error: Selected vertex must be on a cube.');
    return;
  }

  const rows = matrix.length;
  const cols = matrix[0].length;
  appendOutput(`Matrix: ${rows}x${cols} (${count} cubes)`);

  if (!isConnected(matrix, count)) {
    appendOutput('Error: Figure is not connected. All cubes must be adjacent (up/down/left/right).');
    return;
  }

  const algorithmMode = document.getElementById('algorithm-mode').value;
  const { eventLog, vcompCount } = getAlgorithmRunner()(matrix, { startX: matrixX, startY: matrixY });
  edgeData = { eventLog, minX, minY, flipped: flipXY, algorithm: algorithmMode };
  const vertCount = eventLog.events.filter(e => e.type === 'addEdge' && e.edgeType === 'vertical').length;
  const horzCount = eventLog.events.filter(e => e.type === 'addEdge' && e.edgeType === 'horizontal').length;
  appendOutput(`Vertical edges: ${vertCount}`);
  appendOutput(`Horizontal edges: ${horzCount}`);
  appendOutput(`Waves: ${eventLog.stepsForLevel('wavefront').length}`);
  appendOutput(`Vertical components: ${vcompCount}`);
  const treeStats = computeTreeStats(eventLog);
  if (treeStats) {
    appendOutput(`Tree height: ${treeStats.height}`);
    appendOutput(`Tree width: ${treeStats.width}`);
    appendOutput(`Leaves: ${treeStats.leaves}`);
  }
  const level = document.getElementById('anim-level').value;
  animState = { steps: computeSteps(level), position: 0 };

  updateScrubber();
  draw();
  if (autoPlay) {
    startPlay();
  }
}

function paintCell(gridX, gridY) {
  if (paintMode === 'add' && !checkCube(gridX, gridY)) {
    addCube(gridX, gridY, 0x808080);
  } else if (paintMode === 'remove' && checkCube(gridX, gridY)) {
    removeCube(gridX, gridY);
    // If the removed cube was the selected start vertex, clear it
    if (selectedStartVertex && selectedStartVertex.gridX === gridX && selectedStartVertex.gridY === gridY) {
      selectedStartVertex = null;
      selectingStartVertex = false;
      document.getElementById('remove-start-btn').disabled = true;
      document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
      document.getElementById('select-start-btn').style.backgroundColor = '';
    }
  }
}

// --- Pan handling ---
let dragging = false;
let lastMouse = null;
let firstMouse = null;
let clickThreshold = 5; // pixels
let shiftDragging = false;
let paintMode = null; // 'add' or 'remove'
let eraserActive = false;
let selectingStartVertex = false;
let selectedStartVertex = null; // { gridX, gridY } or null
let flipXY = false;

app.canvas.addEventListener('mousedown', e => {
  if (selectingStartVertex) {
    const gridX = Math.floor((e.offsetX / camera.zoom + camera.x) / gridSize);
    const gridY = Math.floor((e.offsetY / camera.zoom + camera.y) / gridSize);

    // Validate that the selected vertex is on a cube
    if (!checkCube(gridX, gridY)) {
      appendOutput('Error: Selected vertex must be on a cube.');
      return;
    }

    // If wavefront is visible, clear it
    if (edgeData) {
      stopPlay();
      edgeData = null;
      animState = null;
      updateScrubber();
      updatePlayIcon();
    }

    // Store the selected vertex (keep selection mode active - don't set selectingStartVertex to false)
    selectedStartVertex = { gridX, gridY };
    document.getElementById('remove-start-btn').disabled = false;
    appendOutput(`Start vertex selected at (${gridX}, ${gridY})`);
    draw(); // Redraw to show visual feedback
    return;
  }
  if (e.shiftKey) {
    shiftDragging = true;
    const gridX = Math.floor((e.offsetX / camera.zoom + camera.x) / gridSize);
    const gridY = Math.floor((e.offsetY / camera.zoom + camera.y) / gridSize);
    paintMode = eraserActive ? 'remove' : 'add';
    stopPlay();
    animState = null;
    edgeData = null;
    updateScrubber();
    updatePlayIcon();
    paintCell(gridX, gridY);
  } else {
    dragging = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    firstMouse = { x: e.clientX, y: e.clientY };
  }
});

app.canvas.addEventListener('mousemove', e => {
  if (shiftDragging) {
    const gridX = Math.floor((e.offsetX / camera.zoom + camera.x) / gridSize);
    const gridY = Math.floor((e.offsetY / camera.zoom + camera.y) / gridSize);
    paintCell(gridX, gridY);
    return;
  }
  if (!dragging) return;
  const dx = (e.clientX - lastMouse.x) / camera.zoom;
  const dy = (e.clientY - lastMouse.y) / camera.zoom;
  camera.x -= dx;
  camera.y -= dy;
  lastMouse = { x: e.clientX, y: e.clientY };
  draw();
});

app.canvas.addEventListener('mouseup', e => {
  if (shiftDragging) {
    shiftDragging = false;
    paintMode = null;
    return;
  }
  if (!lastMouse) return;
  if (!firstMouse) return;
  dragging = false;

  const dx = e.clientX - firstMouse.x;
  const dy = e.clientY - firstMouse.y;

  if (Math.abs(dx) < clickThreshold && Math.abs(dy) < clickThreshold) {
    const gridX = Math.floor((e.offsetX / camera.zoom + camera.x) / gridSize);
    const gridY = Math.floor((e.offsetY / camera.zoom + camera.y) / gridSize);
    // console.log('Grid clicked at:', gridX, gridY);
    click(gridX, gridY);
  }

  lastMouse = null;
});

app.canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const zoomFactor = 1.1;
  const mouseX = e.offsetX;
  const mouseY = e.offsetY;

  const worldX = mouseX / camera.zoom + camera.x;
  const worldY = mouseY / camera.zoom + camera.y;

  camera.zoom *= e.deltaY < 0 ? zoomFactor : 1 / zoomFactor;
  camera.zoom = Math.max(0.1, Math.min(camera.zoom, 10));

  camera.x = worldX - mouseX / camera.zoom;
  camera.y = worldY - mouseY / camera.zoom;

  draw();
});

// Optional: prevent dragging from continuing outside canvas
window.addEventListener('mouseleave', () => { dragging = false; shiftDragging = false; });
window.addEventListener('resize', () => {
  requestAnimationFrame(draw);
});

// --- Output Helper ---
function clearOutput() {
  const output = document.getElementById('algorithm-output');
  output.textContent = '';
  output.scrollTop = 0;
}

function appendOutput(text) {
  const output = document.getElementById('algorithm-output');
  output.textContent += (output.textContent ? '\n' : '') + text;
  output.scrollTop = output.scrollHeight; // auto-scroll to bottom
}

// --- Run Algorithm ---
function runAlgorithm(autoPlay = true) {
  // If a start vertex is selected, use it
  if (selectedStartVertex) {
    runAlgorithmWithStartVertex(selectedStartVertex.gridX, selectedStartVertex.gridY, autoPlay);
    return;
  }

  // Otherwise, run with default start vertex
  clearOutput();
  appendOutput('Starting algorithm...');
  const { matrix, count, minX, minY } = cubeToMatrix();

  if (count === 0) {
    appendOutput('No cubes placed on grid.');
    return;
  }

  const rows = matrix.length;
  const cols = matrix[0].length;
  appendOutput(`Matrix: ${rows}x${cols} (${count} cubes)`);

  if (!isConnected(matrix, count)) {
    appendOutput('Error: Figure is not connected. All cubes must be adjacent (up/down/left/right).');
    return;
  }

  const algorithmMode = document.getElementById('algorithm-mode').value;
  const { eventLog, vcompCount } = getAlgorithmRunner()(matrix);
  edgeData = { eventLog, minX, minY, flipped: flipXY, algorithm: algorithmMode };
  const vertCount = eventLog.events.filter(e => e.type === 'addEdge' && e.edgeType === 'vertical').length;
  const horzCount = eventLog.events.filter(e => e.type === 'addEdge' && e.edgeType === 'horizontal').length;
  appendOutput(`Vertical edges: ${vertCount}`);
  appendOutput(`Horizontal edges: ${horzCount}`);
  appendOutput(`Waves: ${eventLog.stepsForLevel('wavefront').length}`);
  appendOutput(`Vertical components: ${vcompCount}`);
  const treeStats = computeTreeStats(eventLog);
  if (treeStats) {
    appendOutput(`Tree height: ${treeStats.height}`);
    appendOutput(`Tree width: ${treeStats.width}`);
    appendOutput(`Leaves: ${treeStats.leaves}`);
  }
  const level = document.getElementById('anim-level').value;
  animState = { steps: computeSteps(level), position: 0 };

  updateScrubber();
  draw();
  if (autoPlay) {
    startPlay();
  }
}

// --- Animation helpers ---
function computeSteps(level) {
  if (!edgeData) return [];
  return edgeData.eventLog.stepsForLevel(level);
}

function updateScrubber() {
  const slider = document.getElementById('speed-slider');
  const label = document.getElementById('speed-val');
  if (!animState) {
    slider.max = 0;
    slider.value = 0;
    label.textContent = '0 / 0';
  } else {
    slider.max = animState.steps.length;
    slider.value = animState.position;
    label.textContent = `${animState.position} / ${animState.steps.length}`;
  }
}

function updatePlayIcon() {
  const playing = playInterval !== null;
  document.getElementById('icon-play').style.display = playing ? 'none' : 'block';
  document.getElementById('icon-pause').style.display = playing ? 'block' : 'none';
}

function stopPlay() {
  if (playInterval !== null) {
    clearInterval(playInterval);
    playInterval = null;
    updatePlayIcon();
  }
}

function startPlay() {
  stopPlay();
  if (!animState) return;
  if (animState.position >= animState.steps.length) {
    animState.position = 0;
    updateScrubber();
    draw();
  }
  playInterval = setInterval(() => {
    if (!animState) { stopPlay(); return; }
    if (animState.position >= animState.steps.length) { stopPlay(); return; }
    animState.position++;
    updateScrubber();
    draw();
  }, playbackSpeed);
  updatePlayIcon();
}

// --- Event handlers ---
document.getElementById('run-btn').addEventListener('click', runAlgorithm);

document.getElementById('select-start-btn').addEventListener('click', () => {
  // If already in selection mode, cancel it
  if (selectingStartVertex) {
    selectingStartVertex = false;
    document.getElementById('select-start-btn').style.backgroundColor = '';
    clearOutput();
    appendOutput('Selection cancelled.');
    return;
  }

  // Entering selection mode - validate figure is complete
  const { matrix, count } = cubeToMatrix();

  clearOutput();

  if (count === 0) {
    appendOutput('Error: No cubes placed on grid.');
    return;
  }

  if (!isConnected(matrix, count)) {
    appendOutput('Error: Figure is not connected. All cubes must be adjacent (up/down/left/right).');
    return;
  }

  selectingStartVertex = true;
  document.getElementById('select-start-btn').style.backgroundColor = '#c0392b';
  appendOutput('Click on a cube to select as start vertex...');
  stopPlay();
  animState = null;
  edgeData = null;
  updateScrubber();
  updatePlayIcon();
  draw();
});

document.getElementById('remove-start-btn').addEventListener('click', () => {
  selectedStartVertex = null;
  selectingStartVertex = false;
  document.getElementById('remove-start-btn').disabled = true;
  document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
  document.getElementById('select-start-btn').style.backgroundColor = '';
  clearOutput();
  appendOutput('Start vertex removed.');
  draw();
});

document.getElementById('eraser-btn').addEventListener('click', () => {
  eraserActive = !eraserActive;
  document.getElementById('eraser-btn').classList.toggle('active', eraserActive);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Control' && !e.repeat) {
    eraserActive = !eraserActive;
    document.getElementById('eraser-btn').classList.toggle('active', eraserActive);
  }

  if (e.key === 'Escape' && selectingStartVertex) {
    selectingStartVertex = false;
    document.getElementById('select-start-btn').style.backgroundColor = '';
    clearOutput();
    appendOutput('Selection cancelled.');
  }
});

document.getElementById('clear-btn').addEventListener('click', () => {
  stopPlay();
  animState = null;
  edgeData = null;
  selectedStartVertex = null;
  selectingStartVertex = false;
  document.getElementById('remove-start-btn').disabled = true;
  document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
  document.getElementById('select-start-btn').style.backgroundColor = '';
  updateScrubber();
  updatePlayIcon();
  cubes.map.clear();
  draw();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const saveData = {
    cubes: cubes.toJSON(),
    selectedStartVertex: selectedStartVertex
  };
  const json = JSON.stringify(saveData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'grid.json',
        types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Fall through on SecurityError etc. (e.g. file:// context)
    }
  }

  // Firefox: mozSaveOrOpenBlob opens the native Save As dialog
  if (window.mozSaveOrOpenBlob) {
    window.mozSaveOrOpenBlob(blob, 'grid.json');
  } else {
    const name = prompt('Enter a filename:', 'grid');
    if (name === null) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name.trim() || 'grid') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
});

document.getElementById('load-btn').addEventListener('click', () => {
  document.getElementById('load-input').click();
});

document.getElementById('load-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);

      // Support both old format (array) and new format (object with cubes and selectedStartVertex)
      if (Array.isArray(data)) {
        // Old format: just an array of cubes
        cubes.fromJSON(data);
        selectedStartVertex = null;
      } else {
        // New format: object with cubes and selectedStartVertex
        cubes.fromJSON(data.cubes);
        selectedStartVertex = data.selectedStartVertex || null;

        // Validate that the loaded start vertex is actually on a cube
        if (selectedStartVertex && !checkCube(selectedStartVertex.gridX, selectedStartVertex.gridY)) {
          selectedStartVertex = null;
        }
      }

      stopPlay();
      animState = null;
      edgeData = null;
      selectingStartVertex = false;

      // Update UI based on whether a start vertex was loaded
      if (selectedStartVertex) {
        document.getElementById('remove-start-btn').disabled = false;
        document.getElementById('select-start-btn').textContent = 'Move Start Vertex';
      } else {
        document.getElementById('remove-start-btn').disabled = true;
        document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
      }
      document.getElementById('select-start-btn').style.backgroundColor = '';

      updateScrubber();
      updatePlayIcon();
      draw();
    } catch (err) {
      appendOutput('Error loading file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

function centerOnCubes() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  cubes.forEach((cube) => {
    count++;
    if (cube.x < minX) minX = cube.x;
    if (cube.x > maxX) maxX = cube.x;
    if (cube.y < minY) minY = cube.y;
    if (cube.y > maxY) maxY = cube.y;
  });
  if (count === 0) return;
  camera.zoom = 1;
  const centerX = (minX + maxX + 1) * gridSize / 2;
  const centerY = (minY + maxY + 1) * gridSize / 2;
  camera.x = centerX - app.screen.width / 2;
  camera.y = centerY - app.screen.height / 2;
}

// --- Populate and handle presets dropdown ---
const presetSelect = document.getElementById('preset-select');
Object.keys(presets).sort().forEach(path => {
  const name = path.split('/').pop().replace('.json', '');
  const label = name.replace(/-/g, ' ');
  const option = document.createElement('option');
  option.value = path;
  option.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  presetSelect.appendChild(option);
});

presetSelect.addEventListener('change', () => {
  const data = presets[presetSelect.value]?.default;
  if (!data) return;

  // Support both old format (array) and new format (object with cubes and selectedStartVertex)
  if (Array.isArray(data)) {
    // Old format: just an array of cubes
    cubes.fromJSON(data);
    selectedStartVertex = null;
  } else {
    // New format: object with cubes and selectedStartVertex
    cubes.fromJSON(data.cubes);
    selectedStartVertex = data.selectedStartVertex || null;

    // Validate that the loaded start vertex is actually on a cube
    if (selectedStartVertex && !checkCube(selectedStartVertex.gridX, selectedStartVertex.gridY)) {
      selectedStartVertex = null;
    }
  }

  stopPlay();
  animState = null;
  edgeData = null;
  selectingStartVertex = false;

  // Update UI based on whether a start vertex was loaded
  if (selectedStartVertex) {
    document.getElementById('remove-start-btn').disabled = false;
    document.getElementById('select-start-btn').textContent = 'Move Start Vertex';
  } else {
    document.getElementById('remove-start-btn').disabled = true;
    document.getElementById('select-start-btn').textContent = 'Select Start Vertex';
  }
  document.getElementById('select-start-btn').style.backgroundColor = '';

  updateScrubber();
  updatePlayIcon();
  centerOnCubes();
  draw();
  presetSelect.value = '';
});

document.getElementById('play-btn').addEventListener('click', () => {
  if (playInterval !== null) stopPlay();
  else if (!edgeData) runAlgorithm();
  else startPlay();
});

document.getElementById('stop-btn').addEventListener('click', () => {
  stopPlay();
  edgeData = null;
  animState = null;
  updateScrubber();
  updatePlayIcon();
  draw();
});

document.getElementById('frame-reverse-btn').addEventListener('click', () => {
  if (!animState) return;
  stopPlay();
  if (animState.position > 0) {
    animState.position--;
    updateScrubber();
    draw();
  }
});

document.getElementById('frame-advance-btn').addEventListener('click', () => {
  stopPlay();
  if (!edgeData) {
    runAlgorithm(false);
  }
  if (animState && animState.position < animState.steps.length) {
    animState.position++;
    updateScrubber();
    draw();
  }
});

document.getElementById('speed-slider').addEventListener('input', (e) => {
  if (!animState) return;
  stopPlay();
  animState.position = parseInt(e.target.value);
  updateScrubber();
  draw();
});

document.getElementById('anim-level').addEventListener('change', () => {
  if (!edgeData) return;
  stopPlay();
  animState = { steps: computeSteps(document.getElementById('anim-level').value), position: 0 };
  updateScrubber();
  draw();
});

document.getElementById('flip-xy-checkbox').addEventListener('change', (e) => {
  flipXY = e.target.checked;
});

document.getElementById('playback-speed').addEventListener('change', (e) => {
  playbackSpeed = parseInt(e.target.value);
  // If currently playing, restart with new speed
  if (playInterval !== null) {
    const wasPlaying = true;
    stopPlay();
    if (wasPlaying && animState) {
      startPlay();
    }
  }
});

})(); // end async IIFE