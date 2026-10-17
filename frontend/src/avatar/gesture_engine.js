// ═══════════════════════════════════════════════════
//  GESTURE ENGINE (v2) — Parametric Program State Machine
//  Keyframes in U units, wave forearm oscillators, hold-until-released,
//  sentence planning, anti-repetition, and deterministic ProgramPlayer integration.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { GESTURE_LIBRARY, GESTURE_MODES } from './gesture_library.js';
import { avatarRNG } from './rng.js';
import { ProgramPlayer } from './program_player.js';

export class HandGestureState {
    constructor(side) {
        this.side = side; // 'left' | 'right'
        this.phase = 'REST'; // 'REST' | 'PREPARATION' | 'STROKE' | 'OSCILLATE' | 'HOLD' | 'RETRACTION'

        this.weight = 0; // Arm activity weight [0, 1]
        this.phaseTime = 0;
        this.phaseDuration = 0.3;
        this.currentGesture = null;
        this.gestureName = '';
        this.keyIndex = 0;

        // Positions in U-units: [outward (+), up (+), forward (+)] relative to same-side shoulder joint
        this.posU = [0.20, -1.35, 0.15];
        this.startPosU = [0.20, -1.35, 0.15];
        this.targetPosU = [0.20, -1.35, 0.15];

        // Hand shape & orientation
        this.palm = 'inward';
        this.handShape = 'soft_open';
        this.pole = 'elbow_down';
        this.shoulderLift = 0;

        // Oscillator state (for wave, argue, etc.)
        this.oscillationAngle = 0;

        this.holdUntilReleased = false;
        this.player = null;
        this.playerTime = 0;
    }
}

export class GestureEngine {
    constructor() {
        this.left = new HandGestureState('left');
        this.right = new HandGestureState('right');

        // Recency history for anti-repetition: [{ type, side }]
        this.history = [];
        this.MAX_HISTORY = 8;

        this.time = 0;
        this.lastTriggerTime = -10;
        this.MIN_TRIGGER_INTERVAL = 0.40;

        // Speech tracking for ready pose and pauses
        this.lastSpeechTime = -10;
        this.isSpeaking = false;
        this.activeMode = 'explain';

        // Dominant hand: right hand leads by default
        this.dominantSide = 'right';

        // ── Single Source of Truth for Debug / Gesture Studio Takeover ──
        this.debug = {
            active: false,
            player: null,
            t: 0,
            paused: false,
            speed: 1.0,
            loop: false,
            loopRange: null, // [t0, t1] or null
            handSel: 'right', // 'left' | 'right' | 'both' | 'auto'
            gestureName: 'wave',
            program: null,
            seed: 12345,
            deterministic: true,
            intensity: 1.0
        };

        // Legacy compatibility properties
        this.isFrozen = false;
        this.isLooping = false;
        this.loopGestureName = null;
        this.loopHandSelector = 'auto';
        this.loopArousal = 0.5;
        this.activeGestureName = 'wave';
    }

    /**
     * Trigger a gesture program by name or mode.
     * @param {string} gestureName - program name (e.g. 'wave', 'explain', 'shy')
     * @param {number} [arousal=0.5] - emotional arousal [0, 1]
     * @param {string} [handSelector='auto'] - 'auto' | 'left' | 'right' | 'both'
     * @param {object} [opts={}] - { force, loop, freezeAtPeak, instantPeak }
     */
    trigger(gestureName = 'explain', arousal = 0.5, handSelector = 'auto', opts = {}) {
        // Clear freeze state on trigger (Fix for Bug 1)
        this.isFrozen = false;
        if (this.debug.active) {
            this.debug.paused = false;
        }

        const now = this.time;
        if (!opts.force && !opts.loop && (now - this.lastTriggerTime < this.MIN_TRIGGER_INTERVAL)) {
            return;
        }

        // Loop management
        if (opts.loop) {
            this.isLooping = true;
            this.loopGestureName = gestureName;
            this.loopHandSelector = handSelector;
            this.loopArousal = arousal;
            if (this.debug.active) {
                this.debug.loop = true;
            }
        } else if (opts.loop === false) {
            this.isLooping = false;
            this.loopGestureName = null;
            if (this.debug.active) {
                this.debug.loop = false;
            }
        }

        this.activeGestureName = gestureName;

        // In Debug Takeover mode, setup debug player and evaluate at t=0
        if (this.debug.active) {
            this.debug.gestureName = gestureName;
            const program = opts.program || GESTURE_LIBRARY[gestureName] || this.debug.program;
            if (program) {
                this.debug.program = program;
                const side = (handSelector === 'left') ? 'left' : 'right';
                this.debug.player = new ProgramPlayer(program, {
                    seed: this.debug.seed,
                    side,
                    intensity: arousal,
                    deterministic: this.debug.deterministic,
                    holdDuration: program.holdUntilReleased ? 3.0 : undefined
                });
                this.debug.t = 0;
                this.debug.handSel = handSelector;
                this._applyDebugPose(this.debug.player.evaluate(0));
            }
            return;
        }

        // Check if gestureName is a mode (only sample if not forced)
        let typeToPlay = gestureName;
        if (!opts.force && GESTURE_MODES[gestureName]) {
            const mode = GESTURE_MODES[gestureName];
            if (mode.rate <= 0) return;
            typeToPlay = this._pickGestureType(mode.weights);
        }

        const def = GESTURE_LIBRARY[typeToPlay];
        if (!def) return;

        // Determine side(s) to use
        let sides = [];
        if (handSelector === 'both' || def.lead === 'both') {
            sides = ['left', 'right'];
        } else if (handSelector === 'left') {
            sides = ['left'];
        } else if (handSelector === 'right') {
            sides = ['right'];
        } else if (def.lead === 'dominant') {
            sides = [this.dominantSide];
        } else {
            const lastEntry = this.history[this.history.length - 1];
            const nextSide = (lastEntry && lastEntry.side === 'right') ? 'left' : 'right';
            sides = [nextSide];
        }

        // Record history
        for (const side of sides) {
            this.history.push({ type: typeToPlay, side });
            if (this.history.length > this.MAX_HISTORY) this.history.shift();
        }
        this.lastTriggerTime = now;

        if (sides.length === 2) {
            const leadSide = this.dominantSide;
            const followSide = (leadSide === 'right') ? 'left' : 'right';
            const leadHand = (leadSide === 'left') ? this.left : this.right;
            const followHand = (followSide === 'left') ? this.left : this.right;

            this._startProgram(leadHand, typeToPlay, def, arousal, 0.0, opts);
            const followDelay = opts.force ? 0.0 : avatarRNG.range(0.04, 0.08);
            this._startProgram(followHand, typeToPlay, def, arousal, followDelay, opts);
        } else {
            const hand = (sides[0] === 'left') ? this.left : this.right;
            this._startProgram(hand, typeToPlay, def, arousal, 0.0, opts);
        }
    }

    _pickGestureType(weights) {
        const candidates = [];
        const lastEntry = this.history[this.history.length - 1];

        for (const [type, baseW] of Object.entries(weights)) {
            let w = baseW;
            const recencyCount = this.history.filter(h => h.type === type).length;
            w /= (1.0 + recencyCount * 1.8);

            if (lastEntry && lastEntry.type === type) {
                const secondLast = this.history[this.history.length - 2];
                if (secondLast && secondLast.type === type) {
                    w *= 0.05;
                }
            }

            candidates.push({ type, weight: w });
        }

        const totalW = candidates.reduce((sum, c) => sum + c.weight, 0);
        let r = avatarRNG.next() * totalW;
        for (const c of candidates) {
            r -= c.weight;
            if (r <= 0) return c.type;
        }
        return candidates[0]?.type || 'explain';
    }

    _startProgram(hand, name, def, arousal, delay = 0, opts = {}) {
        hand.currentGesture = def;
        hand.gestureName = name;
        hand.holdUntilReleased = !!def.holdUntilReleased;

        const player = new ProgramPlayer(def, {
            seed: avatarRNG.int(0, 999999),
            side: hand.side,
            intensity: arousal,
            deterministic: false,
            startPosU: hand.posU
        });

        hand.player = player;
        hand.playerTime = -delay;
        hand.phase = 'PREPARATION';

        if (opts.instantPeak) {
            const peakTime = player.getKeyPeakTime(0);
            hand.playerTime = peakTime;
            const pose = player.evaluate(peakTime);
            this._applyPoseToHand(hand, pose);
            this.isFrozen = true;
        }
    }

    _applyPoseToHand(hand, pose) {
        hand.posU[0] = pose.posU[0];
        hand.posU[1] = pose.posU[1];
        hand.posU[2] = pose.posU[2];
        hand.palm = pose.palm;
        hand.handShape = pose.shape;
        hand.pole = pose.pole;
        hand.shoulderLift = pose.shoulderLift;
        hand.oscillationAngle = pose.oscAngle;
        hand.weight = pose.weight;
        hand.phase = pose.phase;
        hand.keyIndex = pose.keyIndex;
    }

    _applyDebugPose(pose) {
        if (!pose) return;
        const handSel = this.debug.handSel;
        const targetHands = (handSel === 'both') ? [this.left, this.right] :
                            (handSel === 'left') ? [this.left] :
                            (handSel === 'right') ? [this.right] :
                            (this.debug.player?.side === 'left') ? [this.left] : [this.right];

        for (const hand of targetHands) {
            this._applyPoseToHand(hand, pose);
        }

        // If one-handed, decay other hand to rest
        if (targetHands.length === 1) {
            const other = (targetHands[0] === this.left) ? this.right : this.left;
            other.weight = 0;
            other.phase = 'REST';
        }
    }

    /**
     * Freeze / pause gesture execution.
     */
    freeze(shouldFreeze = true, gestureName = null, handSelector = 'both') {
        this.isFrozen = !!shouldFreeze;
        if (this.debug.active) {
            this.debug.paused = !!shouldFreeze;
            return;
        }

        if (this.isFrozen) {
            const hands = (handSelector === 'both') ? [this.left, this.right] :
                          (handSelector === 'left') ? [this.left] : [this.right];

            for (const hand of hands) {
                if (gestureName && (!hand.player || hand.phase === 'REST')) {
                    const def = GESTURE_LIBRARY[gestureName];
                    if (def) {
                        this._startProgram(hand, gestureName, def, 1.0, 0, { force: true, instantPeak: true });
                        continue;
                    }
                }
                if (hand.player) {
                    hand.phase = 'HOLD';
                    hand.weight = 1.0;
                }
            }
        }
    }

    /**
     * Set looping mode for a gesture.
     */
    setLoop(shouldLoop, gestureName = null, handSelector = 'auto', arousal = 0.5) {
        this.isFrozen = false;
        if (this.debug.active) {
            this.debug.loop = !!shouldLoop;
            this.debug.paused = false;
            return;
        }

        this.isLooping = !!shouldLoop;
        if (this.isLooping) {
            this.loopGestureName = gestureName || this.activeGestureName || 'wave';
            this.loopHandSelector = handSelector;
            this.loopArousal = arousal;
            if (this.left.phase === 'REST' && this.right.phase === 'REST') {
                this.trigger(this.loopGestureName, this.loopArousal, this.loopHandSelector, { force: true, loop: true });
            }
        } else {
            this.loopGestureName = null;
        }
    }

    /**
     * Reset arms completely back to idle FBX motion.
     */
    resetToIdle() {
        this.isFrozen = false;
        this.isLooping = false;
        this.loopGestureName = null;

        if (this.debug.active) {
            this.debug.paused = false;
            this.debug.t = 0;
        }

        for (const hand of [this.left, this.right]) {
            hand.phase = 'REST';
            hand.weight = 0;
            hand.currentGesture = null;
            hand.gestureName = '';
            hand.oscillationAngle = 0;
            hand.shoulderLift = 0;
            hand.player = null;
            hand.playerTime = 0;
            hand.posU[0] = 0.20;
            hand.posU[1] = -1.35;
            hand.posU[2] = 0.15;
            hand.targetPosU[0] = 0.20;
            hand.targetPosU[1] = -1.35;
            hand.targetPosU[2] = 0.15;
            hand.handShape = 'relaxed';
        }
    }

    /**
     * Real-time live update of coordinates for tuning.
     */
    liveTuneKeyframe(opts) {
        const hands = (opts.hand === 'left') ? [this.left] :
                      (opts.hand === 'right') ? [this.right] : [this.left, this.right];

        for (const hand of hands) {
            if (opts.x !== undefined) hand.posU[0] = opts.x;
            if (opts.y !== undefined) hand.posU[1] = opts.y;
            if (opts.z !== undefined) hand.posU[2] = opts.z;
            if (opts.palm !== undefined) hand.palm = opts.palm;
            if (opts.pole !== undefined) hand.pole = opts.pole;
            if (opts.shape !== undefined) hand.handShape = opts.shape;
            if (opts.shoulderLift !== undefined) hand.shoulderLift = opts.shoulderLift;
            hand.weight = 1.0;
        }
    }

    /**
     * Release any held pose smoothly.
     */
    releasePose(side = 'both') {
        if (this.debug.active && this.debug.player) {
            const retractSeg = this.debug.player.segments.find(s => s.name === 'RETRACT');
            if (retractSeg) {
                this.debug.t = retractSeg.t0;
            }
            return;
        }

        const hands = (side === 'both') ? [this.left, this.right] :
                      (side === 'left') ? [this.left] : [this.right];

        for (const hand of hands) {
            if (hand.player && hand.holdUntilReleased) {
                hand.holdUntilReleased = false;
                const retractSeg = hand.player.segments.find(s => s.name === 'RETRACT');
                if (retractSeg) {
                    hand.playerTime = retractSeg.t0;
                    hand.phase = 'RETRACTION';
                }
            }
        }
    }

    /**
     * Update state machine for both hands.
     * @param {number} dt - delta time in seconds
     * @param {object} director - director state
     * @param {object} [speechFeatures]
     */
    update(dt, director, speechFeatures = null) {
        this.time += dt;

        // ── DEBUG TAKEOVER ──
        if (this.debug.active) {
            if (!this.debug.paused && this.debug.player) {
                this.debug.t += dt * (this.debug.speed || 1.0);
                const dur = this.debug.player.duration;

                if (this.debug.loop) {
                    const loopStart = this.debug.loopRange ? this.debug.loopRange[0] : 0;
                    const loopEnd = this.debug.loopRange ? this.debug.loopRange[1] : dur;
                    if (this.debug.t >= loopEnd) {
                        this.debug.t = loopStart;
                    }
                } else if (this.debug.t >= dur) {
                    this.debug.t = dur;
                    this.debug.paused = true;
                }
            }

            if (this.debug.player) {
                const pose = this.debug.player.evaluate(this.debug.t);
                this._applyDebugPose(pose);
            }
            // Return early: completely ignore all auto-triggers and background decays
            return;
        }

        // If frozen by legacy command, pause
        if (this.isFrozen) {
            if (this.left.weight > 0.01) this.left.weight = 1.0;
            if (this.right.weight > 0.01) this.right.weight = 1.0;
            return;
        }

        const isSpeaking = !!(director?.isSpeaking || speechFeatures?.isSpeaking);
        this.isSpeaking = isSpeaking;
        if (isSpeaking) {
            this.lastSpeechTime = this.time;
        }

        const currentEmotion = director?.currentEmotion || director?.emotion || 'neutral';
        const currentState = director?.animationState || 'idle';

        // Check held poses for release conditions
        if (this.left.holdUntilReleased) {
            if (this.left.gestureName === 'shy' && currentEmotion !== 'shy') this.releasePose('left');
            if (this.left.gestureName === 'think' && currentState !== 'thinking') this.releasePose('left');
        }
        if (this.right.holdUntilReleased) {
            if (this.right.gestureName === 'shy' && currentEmotion !== 'shy') this.releasePose('right');
            if (this.right.gestureName === 'think' && currentState !== 'thinking') this.releasePose('right');
        }

        // Automatic triggering while speaking
        if (isSpeaking && speechFeatures && !this.isLooping) {
            if (speechFeatures.onset && (speechFeatures.emphasis || 0) >= 0.45) {
                const arousal = (director.emotionIntensity || 0.5) * 0.8 + 0.2;
                const mode = director.gestureMode || 'explain';
                this.trigger(mode, arousal);
            }
        }

        // Automatic state mapping triggers (if not in debug loop)
        if (!this.isLooping) {
            if (currentState === 'thinking' && this.right.phase === 'REST' && this.left.phase === 'REST') {
                this.trigger('think', 0.5, 'right');
            } else if (currentEmotion === 'shy' && this.right.phase === 'REST' && this.left.phase === 'REST') {
                this.trigger('shy', 0.5, 'both');
            }
        }

        this._updateHand(this.left, dt);
        this._updateHand(this.right, dt);

        // Check loop continuation
        if (this.isLooping && this.left.phase === 'REST' && this.right.phase === 'REST') {
            this.trigger(this.loopGestureName, this.loopArousal, this.loopHandSelector, { force: true, loop: true });
        }
    }

    _updateHand(hand, dt) {
        if (!hand.player) {
            // Resting decay
            hand.weight = Math.max(0, hand.weight - dt * 4.0);
            hand.oscillationAngle = 0;
            hand.shoulderLift = 0;
            hand.phase = 'REST';

            // Speaking baseline ready pose
            if (this.isSpeaking && hand.weight <= 0.01 && !this.isLooping) {
                const readyDef = GESTURE_LIBRARY.ready;
                if (readyDef) {
                    this._startProgram(hand, 'ready', readyDef, 0.4, 0.1);
                }
            }
            return;
        }

        hand.playerTime += dt;
        if (hand.playerTime < 0) return; // Follower delay

        // Hold-until-released pause
        if (hand.holdUntilReleased) {
            const holdSeg = hand.player.segments.find(s => s.name === 'HOLD');
            if (holdSeg) {
                const holdMid = (holdSeg.t0 + holdSeg.t1) * 0.5;
                if (hand.playerTime >= holdMid) {
                    hand.playerTime = holdMid;
                }
            }
        }

        if (hand.playerTime >= hand.player.duration) {
            hand.player = null;
            hand.weight = 0;
            hand.phase = 'REST';
            hand.currentGesture = null;
            hand.gestureName = '';
            return;
        }

        const pose = hand.player.evaluate(hand.playerTime);
        this._applyPoseToHand(hand, pose);
    }
}
