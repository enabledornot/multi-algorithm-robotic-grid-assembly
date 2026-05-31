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
    }

    addEdge(edgeType, col, row, orientation) {
        this.events.push({ type: 'addEdge', edgeType, col, row, orientation });
    }

    updateCell(col, row, color) {
        this.events.push({ type: 'updateCell', col, row, color });
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

    stepsForLevel(level) {
        const len = this.events.length;
        if (len === 0) return [];
        switch (level) {
            case 'full':
                return Array.from({ length: len }, (_, i) => i + 1);
            case 'edge': {
                const steps = this.edgeBoundaries.filter((v, i) => v > 0 && (i === 0 || v !== this.edgeBoundaries[i - 1]));
                if (steps.length === 0 || steps[steps.length - 1] !== len) steps.push(len);
                return steps;
            }
            case 'component': {
                const steps = this.componentBoundaries.filter((v, i) => v > 0 && (i === 0 || v !== this.componentBoundaries[i - 1]));
                if (steps.length === 0 || steps[steps.length - 1] !== len) steps.push(len);
                return steps;
            }
            case 'wavefront':
                return this.wavefrontBoundaries.filter((v, i) => v > 0 && (i === 0 || v !== this.wavefrontBoundaries[i - 1]));
            default:
                return [];
        }
    }
}