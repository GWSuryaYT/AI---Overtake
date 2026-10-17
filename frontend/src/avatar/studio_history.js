// ═══════════════════════════════════════════════════
//  STUDIO HISTORY — Undo / Redo Manager (50+ steps)
//  Tracks deep-cloned state snapshots with descriptive labels.
// ═══════════════════════════════════════════════════

export class StudioHistory {
    constructor(maxSteps = 60) {
        this.maxSteps = maxSteps;
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Clear all history stacks.
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Push a new snapshot onto the undo stack.
     * Clears redo stack.
     * @param {object} snapshot
     * @param {string} [label='Edit']
     */
    push(snapshot, label = 'Edit') {
        const item = {
            state: JSON.parse(JSON.stringify(snapshot)),
            label,
            timestamp: Date.now()
        };
        this.undoStack.push(item);
        if (this.undoStack.length > this.maxSteps) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    canUndo() {
        return this.undoStack.length > 1;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * Undo last action.
     * @returns {object|null} previous state snapshot
     */
    undo() {
        if (!this.canUndo()) return null;
        const current = this.undoStack.pop();
        this.redoStack.push(current);
        const previous = this.undoStack[this.undoStack.length - 1];
        return JSON.parse(JSON.stringify(previous.state));
    }

    /**
     * Redo next action.
     * @returns {object|null} next state snapshot
     */
    redo() {
        if (!this.canRedo()) return null;
        const next = this.redoStack.pop();
        this.undoStack.push(next);
        return JSON.parse(JSON.stringify(next.state));
    }

    /**
     * Get list of historical actions for display.
     */
    getHistoryList() {
        return this.undoStack.map((item, idx) => ({
            index: idx,
            label: item.label,
            time: item.timestamp,
            isCurrent: idx === this.undoStack.length - 1
        }));
    }
}
