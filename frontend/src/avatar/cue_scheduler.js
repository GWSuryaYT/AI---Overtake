// ═══════════════════════════════════════════════════
//  CUE SCHEDULER (v2) — Synchronous FIFO Pairing & Audio Lead
//  Pairs cues synchronously on arrival, eliminates decode races,
//  schedules early lead for face/gesture preparation
// ═══════════════════════════════════════════════════

export class CueScheduler {
    /**
     * @param {object} options
     * @param {function(object): void} [options.onCue] - callback when a cue fires
     * @param {object} [options.clock] - clock abstraction for testing
     * @param {number} [options.leadMs=120] - lead time in ms for expression/gesture prep
     */
    constructor(options = {}) {
        this.onCue = options.onCue || ((cue) => console.log('[CueScheduler] Fired:', cue));
        this.clock = options.clock || {
            now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (id) => clearTimeout(id),
        };
        this.leadMs = options.leadMs || 120; // 120ms early lead

        // FIFO queue of incoming cue frames
        this._cueQueue = [];
        this._cueSeq = 0;
        this._activeTimers = [];
    }

    /**
     * Called synchronously when a cue frame arrives via WebSocket.
     * Pushes to FIFO with sequence ID.
     * @param {object} cue
     */
    receiveCue(cue) {
        if (!cue) return;
        this._cueQueue.push({ cue, seq: this._cueSeq++ });
    }

    /**
     * Called SYNCHRONOUSLY at WebSocket arrival time of the binary WAV chunk.
     * Pairs with the next cue in FIFO immediately before any async decode.
     * @param {any} rawData - binary data
     * @returns {{ rawData: any, cue: object|null, seq: number }}
     */
    pairSynchronously(rawData) {
        let pairedCue = null;
        if (this._cueQueue.length > 0) {
            pairedCue = this._cueQueue.shift().cue;
        }
        return {
            rawData,
            cue: pairedCue,
            seq: this._cueSeq,
        };
    }

    /**
     * Backwards-compatible alias for existing code.
     */
    pairWithPendingCue(buffer) {
        let pairedCue = null;
        if (this._cueQueue.length > 0) {
            pairedCue = this._cueQueue.shift().cue;
        }
        return {
            buffer,
            cue: pairedCue,
        };
    }

    /**
     * Called when a chunk is scheduled for playback.
     * Fires cue immediately so face/gestures lead audio by leadMs.
     * @param {object} cue
     * @param {AudioBufferSourceNode} [source]
     * @param {AudioContext} [audioContext]
     * @returns {number} scheduled startTime
     */
    triggerPlayback(cue, source = null, audioContext = null) {
        if (!cue) return audioContext ? audioContext.currentTime : 0;

        // Apply cue immediately (face & gestures lead voice)
        this.fireCue(cue);

        if (source && audioContext) {
            const leadSec = this.leadMs / 1000.0;
            const startTime = audioContext.currentTime + leadSec;
            source.start(startTime);
            return startTime;
        }
        return 0;
    }

    /**
     * Directly fires a cue to the director callback.
     * @param {object} cue
     */
    fireCue(cue) {
        if (!cue) return;
        try {
            this.onCue(cue);
        } catch (err) {
            console.error('[CueScheduler] Error firing cue:', err);
        }
    }

    /**
     * Handles end-of-stream [DONE]. If cues arrived with no following audio,
     * fires them immediately.
     */
    flush() {
        while (this._cueQueue.length > 0) {
            const item = this._cueQueue.shift();
            if (item && item.cue) {
                this.fireCue(item.cue);
            }
        }
    }

    /**
     * Reset on new turn (e.g. [STT_OK]).
     */
    reset() {
        this._cueQueue = [];
        for (const t of this._activeTimers) {
            this.clock.clearTimeout(t);
        }
        this._activeTimers = [];
    }
}

let _instance = null;
export function getCueScheduler(onCueCallback) {
    if (!_instance) {
        _instance = new CueScheduler({ onCue: onCueCallback });
    } else if (onCueCallback) {
        _instance.onCue = onCueCallback;
    }
    return _instance;
}
