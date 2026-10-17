// ═══════════════════════════════════════════════════
//  PROGRAM PLAYER — Pure, Deterministic Gesture Evaluator
//  Samples parameters once per instance from seeded RNG.
//  Given (program, seed, t), always produces the exact same pose.
// ═══════════════════════════════════════════════════

import { PRNG } from './rng.js';

/**
 * Smootherstep easing: 6t^5 - 15t^4 + 10t^3
 * C2-continuous at boundaries: zero velocity and zero acceleration at t=0 and t=1.
 */
function smootherstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * c * (c * (c * 6 - 15) + 10);
}

/**
 * Smoothstep easing: 3t^2 - 2t^3
 */
function smoothstep(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
}

function sampleRange(range, rng, deterministic) {
    if (!range || !Array.isArray(range)) return 0.3;
    if (range.length === 1) return range[0];
    if (deterministic) {
        return (range[0] + range[1]) / 2;
    }
    return rng.range(range[0], range[1]);
}

function sampleInt(range, rng, deterministic) {
    if (!range || !Array.isArray(range)) return 1;
    if (range.length === 1) return range[0];
    if (deterministic) {
        return Math.round((range[0] + range[1]) / 2);
    }
    return rng.int(range[0], range[1]);
}

export class ProgramPlayer {
    /**
     * @param {object} program - gesture program definition
     * @param {object} [opts={}]
     * @param {number} [opts.seed=12345]
     * @param {'left'|'right'} [opts.side='right']
     * @param {number} [opts.intensity=1.0]
     * @param {boolean} [opts.deterministic=false]
     * @param {number[]} [opts.startPosU=[0.20, -1.35, 0.15]]
     * @param {number[]} [opts.restPosU=[0.20, -1.35, 0.15]]
     * @param {number} [opts.holdDuration]
     * @param {number} [opts.retractDuration=0.38]
     */
    constructor(program, opts = {}) {
        this.program = program || { keys: [{ t: [0.3, 0.3], pos: [0.2, -1.35, 0.15] }] };
        this.seed = (opts.seed !== undefined) ? opts.seed : 12345;
        this.side = opts.side || 'right';
        this.intensity = (opts.intensity !== undefined) ? opts.intensity : 1.0;
        this.deterministic = !!opts.deterministic;

        this.startPosU = opts.startPosU ? [...opts.startPosU] : [0.20, -1.35, 0.15];
        this.restPosU = opts.restPosU ? [...opts.restPosU] : [0.20, -1.35, 0.15];
        this.retractDuration = opts.retractDuration || 0.38;

        this.rng = new PRNG(this.seed);

        // Precompute sampled segments and parameters
        this.segments = [];
        this.keyTargets = [];
        this._buildSegments(opts);
    }

    _buildSegments(opts) {
        const sideOverride = this.program.overrides?.[this.side];
        const keys = (sideOverride?.keys && sideOverride.keys.length > 0)
            ? sideOverride.keys
            : ((this.program.keys && this.program.keys.length > 0)
                ? this.program.keys
                : [{ t: [0.3, 0.3], pos: [0.20, -1.35, 0.15] }]);

        this.keys = keys;
        const defaultPole = sideOverride?.pole || this.program.pole || 'elbow_down';

        let currentT = 0;
        let prevPos = [...this.startPosU];
        let prevLift = 0;

        // 1. Preparation Segment (Key 0)
        const key0 = keys[0];
        const prepDur = sampleRange(key0.t || [0.25, 0.35], this.rng, this.deterministic);

        const jitter = this.deterministic ? 0 : 0.015;
        const jX = jitter ? this.rng.range(-jitter, jitter) : 0;
        const jY = jitter ? this.rng.range(-jitter, jitter) : 0;
        const jZ = jitter ? this.rng.range(-jitter, jitter) : 0;

        const targetPos0 = [
            key0.pos[0] + jX,
            key0.pos[1] + jY,
            key0.pos[2] + jZ
        ];
        const lift0 = (key0.shoulderLift || 0) * (0.8 + 0.4 * this.intensity);

        this.segments.push({
            name: 'PREP',
            t0: currentT,
            t1: currentT + prepDur,
            keyIndex: 0,
            startPos: [...prevPos],
            endPos: [...targetPos0],
            startLift: 0,
            endLift: lift0,
            palm: key0.palm || 'inward',
            shape: key0.shape || 'soft_open',
            pole: key0.pole || defaultPole,
        });

        this.keyTargets.push({
            keyIndex: 0,
            peakTime: currentT + prepDur,
            targetPos: [...targetPos0],
            palm: key0.palm || 'inward',
            shape: key0.shape || 'soft_open',
            pole: key0.pole || defaultPole,
            shoulderLift: lift0
        });


        currentT += prepDur;
        prevPos = [...targetPos0];
        prevLift = lift0;

        // 2. Subsequent Stroke Keyframes
        for (let i = 1; i < keys.length; i++) {
            const key = keys[i];
            const strokeDur = sampleRange(key.t || [0.18, 0.25], this.rng, this.deterministic);
            const targetPos = [...key.pos];
            const lift = (key.shoulderLift || 0) * (0.8 + 0.4 * this.intensity);

            this.segments.push({
                name: `STROKE#${i}`,
                t0: currentT,
                t1: currentT + strokeDur,
                keyIndex: i,
                startPos: [...prevPos],
                endPos: [...targetPos],
                startLift: prevLift,
                endLift: lift,
                palm: key.palm || this.segments[this.segments.length - 1].palm,
                shape: key.shape || this.segments[this.segments.length - 1].shape,
                pole: key.pole || defaultPole,
            });

            this.keyTargets.push({
                keyIndex: i,
                peakTime: currentT + strokeDur,
                targetPos: [...targetPos],
                palm: key.palm || this.segments[this.segments.length - 1].palm,
                shape: key.shape || this.segments[this.segments.length - 1].shape,
                pole: key.pole || defaultPole,
                shoulderLift: lift
            });

            currentT += strokeDur;
            prevPos = [...targetPos];
            prevLift = lift;
        }

        // 3. Oscillator Segment
        this.oscillatorData = null;
        if (this.program.oscillate) {
            const osc = this.program.oscillate;
            const cycles = sampleInt(osc.cycles || [2, 4], this.rng, this.deterministic);
            const freq = sampleRange(osc.freq || [2.0, 3.0], this.rng, this.deterministic);
            const ampDeg = sampleRange(osc.ampDeg || [12, 18], this.rng, this.deterministic);
            const ampRad = (ampDeg * Math.PI) / 180.0;
            const decay = (osc.decay !== undefined) ? osc.decay : 0.85;
            const oscDuration = cycles / Math.max(0.1, freq);

            this.oscillatorData = {
                cycles,
                freq,
                ampRad,
                ampDeg,
                decay,
                duration: oscDuration,
                wristRollDeg: osc.wristRollDeg ? sampleRange(osc.wristRollDeg, this.rng, this.deterministic) : 0
            };

            this.segments.push({
                name: 'OSC',
                kind: osc.kind || 'forearm_swing',
                t0: currentT,
                t1: currentT + oscDuration,
                cycles,
                freq,
                ampRad,
                decay,
                basePos: [...prevPos],
                lift: prevLift,
                palm: this.segments[this.segments.length - 1].palm,
                shape: this.segments[this.segments.length - 1].shape,
                pole: this.segments[this.segments.length - 1].pole
            });

            currentT += oscDuration;
        }

        // 4. Hold Segment
        let holdDur;
        if (opts.holdDuration !== undefined) {
            holdDur = opts.holdDuration;
        } else if (this.program.holdUntilReleased && this.deterministic) {
            // For deterministic studio timeline scrubbing, default to hold midpoint or 2.0s
            const holdRange = this.program.hold || [10.0, 30.0];
            holdDur = Math.min(2.0, (holdRange[0] + holdRange[1]) / 2);
        } else {
            const holdRange = this.program.hold || [0.2, 0.4];
            holdDur = sampleRange(holdRange, this.rng, this.deterministic);
        }

        this.segments.push({
            name: 'HOLD',
            t0: currentT,
            t1: currentT + holdDur,
            basePos: [...prevPos],
            lift: prevLift,
            palm: this.segments[this.segments.length - 1].palm,
            shape: this.segments[this.segments.length - 1].shape,
            pole: this.segments[this.segments.length - 1].pole
        });

        currentT += holdDur;

        // 5. Retraction Segment
        this.segments.push({
            name: 'RETRACT',
            t0: currentT,
            t1: currentT + this.retractDuration,
            startPos: [...prevPos],
            endPos: [...this.restPosU],
            startLift: prevLift,
            endLift: 0,
            palm: this.segments[this.segments.length - 1].palm,
            shape: this.segments[this.segments.length - 1].shape,
            pole: defaultPole
        });

        currentT += this.retractDuration;
        this.duration = currentT;
    }

    /**
     * Get the exact time at which keyframe N reaches its peak.
     * @param {number} keyIndex
     * @returns {number}
     */
    getKeyPeakTime(keyIndex = 0) {
        const kt = this.keyTargets[keyIndex];
        return kt ? kt.peakTime : 0;
    }

    /**
     * Get the time of the first oscillation peak.
     * At this time, oscAngle achieves its local peak amplitude.
     * @returns {number|null}
     */
    getOscPeakTime() {
        const oscSeg = this.segments.find(s => s.name === 'OSC');
        if (!oscSeg || !this.oscillatorData) return null;

        const { freq, cycles, decay } = this.oscillatorData;
        const omega = 2 * Math.PI * freq;
        const lambda = (decay * freq) / Math.max(1, cycles);

        // First peak occurs when tan(omega * tau) = omega / lambda
        const tauPeak = Math.atan(omega / lambda) / omega;
        return oscSeg.t0 + tauPeak;
    }

    /**
     * Get the start time of the HOLD segment.
     * @returns {number}
     */
    getHoldTime() {
        const holdSeg = this.segments.find(s => s.name === 'HOLD');
        return holdSeg ? holdSeg.t0 : this.duration;
    }

    /**
     * Evaluate the gesture program at time t.
     * @param {number} t - time in seconds
     * @returns {{
     *   posU: number[],
     *   palm: string,
     *   shape: string,
     *   pole: string,
     *   shoulderLift: number,
     *   oscAngle: number,
     *   weight: number,
     *   phase: string,
     *   keyIndex: number
     * }}
     */
    evaluate(t) {
        const keys = this.program.keys || [];
        const key0 = keys[0] || {};

        if (t <= 0) {
            return {
                posU: [...this.startPosU],
                palm: key0.palm || 'inward',
                shape: key0.shape || 'soft_open',
                pole: key0.pole || this.program.pole || 'elbow_down',
                shoulderLift: 0,
                oscAngle: 0,
                weight: 0,
                phase: 'REST',
                keyIndex: 0
            };
        }

        if (t >= this.duration) {
            return {
                posU: [...this.restPosU],
                palm: 'inward',
                shape: 'relaxed',
                pole: this.program.pole || 'elbow_down',
                shoulderLift: 0,
                oscAngle: 0,
                weight: 0,
                phase: 'REST',
                keyIndex: keys.length - 1
            };
        }

        // Find active segment
        let activeSeg = null;
        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            if (t >= seg.t0 && (t < seg.t1 || i === this.segments.length - 1)) {
                activeSeg = seg;
                break;
            }
        }

        if (!activeSeg) {
            activeSeg = this.segments[this.segments.length - 1];
        }

        const segDur = Math.max(0.0001, activeSeg.t1 - activeSeg.t0);
        const u = Math.max(0, Math.min(1, (t - activeSeg.t0) / segDur));

        switch (activeSeg.name) {
            case 'PREP': {
                const s = smootherstep(u);
                const posU = [
                    activeSeg.startPos[0] + (activeSeg.endPos[0] - activeSeg.startPos[0]) * s,
                    activeSeg.startPos[1] + (activeSeg.endPos[1] - activeSeg.startPos[1]) * s,
                    activeSeg.startPos[2] + (activeSeg.endPos[2] - activeSeg.startPos[2]) * s
                ];
                // Smooth weight ramp up from 0 to 1
                const weight = Math.min(1.0, s);
                const shoulderLift = activeSeg.endLift * s;

                return {
                    posU,
                    palm: activeSeg.palm,
                    shape: activeSeg.shape,
                    pole: activeSeg.pole,
                    shoulderLift,
                    oscAngle: 0,
                    weight,
                    phase: 'PREPARATION',
                    keyIndex: 0
                };
            }

            case 'OSC': {
                const tau = t - activeSeg.t0;
                const totalDuration = segDur;
                const decayExp = Math.exp(-activeSeg.decay * (tau / totalDuration));
                const angle = activeSeg.ampRad * decayExp * Math.sin(2 * Math.PI * activeSeg.freq * tau);

                let posU = [...activeSeg.basePos];
                const kind = activeSeg.kind || 'forearm_swing';
                if (kind === 'forearm_swing') {
                    posU[0] += angle * 0.25; // Lateral X swing
                } else if (kind === 'point_pulse') {
                    posU[2] += angle * 0.20; // Forward Z pulse
                } else if (kind === 'wrist_roll') {
                    posU[1] += angle * 0.05; // Minor vertical bob
                }

                return {
                    posU,
                    palm: activeSeg.palm,
                    shape: activeSeg.shape,
                    pole: activeSeg.pole,
                    shoulderLift: activeSeg.lift,
                    oscAngle: angle,
                    oscKind: kind,
                    weight: 1.0,
                    phase: 'OSCILLATE',
                    keyIndex: (this.program.keys?.length || 1) - 1
                };
            }

            case 'HOLD': {
                return {
                    posU: [...activeSeg.basePos],
                    palm: activeSeg.palm,
                    shape: activeSeg.shape,
                    pole: activeSeg.pole,
                    shoulderLift: activeSeg.lift,
                    oscAngle: 0,
                    weight: 1.0,
                    phase: 'HOLD',
                    keyIndex: (this.program.keys?.length || 1) - 1
                };
            }

            case 'RETRACT': {
                const s = smoothstep(u);
                const posU = [
                    activeSeg.startPos[0] + (activeSeg.endPos[0] - activeSeg.startPos[0]) * s,
                    activeSeg.startPos[1] + (activeSeg.endPos[1] - activeSeg.startPos[1]) * s,
                    activeSeg.startPos[2] + (activeSeg.endPos[2] - activeSeg.startPos[2]) * s
                ];
                const weight = Math.max(0, 1.0 - u);
                const shoulderLift = activeSeg.startLift * (1.0 - u);
                const shape = (u > 0.6) ? 'relaxed' : activeSeg.shape;

                return {
                    posU,
                    palm: activeSeg.palm,
                    shape,
                    pole: activeSeg.pole,
                    shoulderLift,
                    oscAngle: 0,
                    weight,
                    phase: 'RETRACTION',
                    keyIndex: (this.program.keys?.length || 1) - 1
                };
            }

            default: { // STROKE#i
                const s = smootherstep(u);
                const posU = [
                    activeSeg.startPos[0] + (activeSeg.endPos[0] - activeSeg.startPos[0]) * s,
                    activeSeg.startPos[1] + (activeSeg.endPos[1] - activeSeg.startPos[1]) * s,
                    activeSeg.startPos[2] + (activeSeg.endPos[2] - activeSeg.startPos[2]) * s
                ];
                const shoulderLift = activeSeg.startLift + (activeSeg.endLift - activeSeg.startLift) * s;

                return {
                    posU,
                    palm: activeSeg.palm,
                    shape: activeSeg.shape,
                    pole: activeSeg.pole,
                    shoulderLift,
                    oscAngle: 0,
                    weight: 1.0,
                    phase: 'STROKE',
                    keyIndex: activeSeg.keyIndex
                };
            }
        }
    }
}
