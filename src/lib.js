export class gridMap {
    constructor() {
        this.map = new Map();
    }
    key(x, y) {
        return `${x},${y}`
    }
    get(x, y) {
        return this.map.get(this.key(x, y));
    }
    add(x, y, value) {
        this.map.set(this.key(x, y), value);
    }
    clear(x, y) {
        return this.map.delete(this.key(x, y));
    }
    forEach(fn) {
        this.map.forEach(fn);
    }
    toJSON() {
        const cells = [];
        this.map.forEach(v => cells.push({ x: v.x, y: v.y }));
        return cells;
    }
    fromJSON(cells) {
        this.map.clear();
        for (const cell of cells) {
            this.add(cell.x, cell.y, { x: cell.x, y: cell.y, color: 0x808080 });
        }
    }
}

export class EventLog {
    constructor() {
        this.events = [];
        this.componentBoundaries = [];
        this.wavefrontBoundaries = [];
        this.edgeBoundaries = [];
        this.perimeterBoundaries = [];
        this.mode = null;
    }

    addEdge(edgeType, col, row, orientation) {
        this.events.push({ type: 'addEdge', edgeType, col, row, orientation });
    }

    updateCell(col, row, color) {
        this.events.push({ type: 'updateCell', col, row, color });
    }

    updateCells(updates) {
        this.events.push({ type: 'updateCells', updates });
    }

    markBorder(col, row, side) {
        this.events.push({ type: 'markBorder', col, row, side });
    }

    colorDot(col, row) {
        this.events.push({ type: 'colorDot', col, row });
    }

    labelCell(col, row, label) {
        this.events.push({ type: 'labelCell', col, row, label });
    }

    markComponent() {
        this.componentBoundaries.push(this.events.length);
    }

    markWavefront() {
        this.wavefrontBoundaries.push(this.events.length);
    }

    markEdge() {
        this.edgeBoundaries.push(this.events.length);
    }

    markPerimeter() {
        this.perimeterBoundaries.push(this.events.length);
    }

    stepsForLevel(level) {
        const len = this.events.length;
        if (len === 0) return [];
        switch (level) {
            case 'full':
                return Array.from({ length: len }, (_, i) => i + 1);
            case 'wavefront': {
                if (this.mode !== 'outer-peel') {
                    return this.wavefrontBoundaries.filter((v, i) => v > 0 && (i === 0 || v !== this.wavefrontBoundaries[i - 1]));
                }
                // Outer-peel's wavefront level keeps all semantic changes but
                // skips the per-side border-drawing events from perimeter walks.
                return this.events.flatMap((event, i) => event.type === 'markBorder' ? [] : [i + 1]);
            }
            case 'edge': {
                const boundaries = this.mode === 'outer-peel' ? this.perimeterBoundaries : this.edgeBoundaries;
                const steps = boundaries.filter((v, i) => v > 0 && (i === 0 || v !== boundaries[i - 1]));
                if (steps.length === 0 || steps[steps.length - 1] !== len) steps.push(len);
                return steps;
            }
            case 'component': {
                const steps = this.componentBoundaries.filter((v, i) => v > 0 && (i === 0 || v !== this.componentBoundaries[i - 1]));
                if (steps.length === 0 || steps[steps.length - 1] !== len) steps.push(len);
                return steps;
            }
            default:
                return [];
        }
    }
}
