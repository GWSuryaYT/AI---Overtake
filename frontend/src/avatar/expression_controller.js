// ═══════════════════════════════════════════════════
//  EXPRESSION CONTROLLER — Face, Expressions, Blink & LipSync
//  Critically damped springs, blend caps, override protection
// ═══════════════════════════════════════════════════

import { Spring, smoothFactor } from './springs.js';
import { getEmotionConfig } from './emotion_map.js';
import { EXPRESSION } from './avatar_config.js';

// Standard VRM 1.0 expression names
const STANDARD_EXPRESSIONS = [
    'happy', 'angry', 'sad', 'relaxed', 'surprised', 'neutral',
    'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'blinkLeft', 'blinkRight'
];

export class ExpressionController {
    /**
     * @param {object} vrm - VRM instance
     */
    constructor(vrm) {
        this.vrm = vrm;
        this.expressionManager = vrm?.expressionManager || null;

        // Springs for every known expression
        this.springs = new Map();

        // Discover available expressions on model
        this.availableExpressions = new Set();
        if (this.expressionManager && this.expressionManager.expressionMap) {
            for (const key of Object.keys(this.expressionManager.expressionMap)) {
                this.availableExpressions.add(key);
            }
        }

        // Initialize springs for available and standard expressions
        const allKnown = new Set([...STANDARD_EXPRESSIONS, ...this.availableExpressions]);
        for (const name of allKnown) {
            this.springs.set(name, new Spring(0, EXPRESSION.SPRING_SPEED || 10));
        }

        // Current emotion state
        this.activeEmotion = 'neutral';
        this.targetEmotion = 'neutral';
        this.emotionIntensity = 1.0;
        this.decayTimer = 0;
        this.DECAY_DELAY = 2.0; // 2 seconds after speech before decaying

        // Lip sync target & current weights
        this.lipSyncCurrent = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
        this.lipSyncTarget = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
        this.isMouthActive = false;

        // Timer-based blink state
        this.blinkTimer = 2.0 + Math.random() * 3.0;
        this.blinkPhase = 'idle'; // 'idle' | 'closing' | 'opening'
        this.blinkProgress = 0;
        this.isDoubleBlink = false;
        this.doubleBlinkPending = false;
        this.BLINK_CLOSE_DURATION = 0.07;
        this.BLINK_OPEN_DURATION = 0.12;
    }

    /**
     * Apply a new emotion cue.
     * @param {string} emotionName
     * @param {number} [intensity=1.0]
     */
    setEmotion(emotionName, intensity = 1.0) {
        this.targetEmotion = emotionName.toLowerCase();
        this.emotionIntensity = Math.max(0.1, Math.min(1.0, intensity));
        this.decayTimer = 0; // reset decay
    }

    /**
     * Set target phonemes from audio analyser.
     * @param {object} phonemes - { a, e, i, o, u }
     */
    setLipSync(phonemes) {
        this.lipSyncTarget.aa = phonemes.a || 0;
        this.lipSyncTarget.ee = phonemes.e || 0;
        this.lipSyncTarget.ih = phonemes.i || 0;
        this.lipSyncTarget.oh = phonemes.o || 0;
        this.lipSyncTarget.ou = phonemes.u || 0;

        const sum = this.lipSyncTarget.aa + this.lipSyncTarget.ee +
                    this.lipSyncTarget.ih + this.lipSyncTarget.oh + this.lipSyncTarget.ou;
        this.isMouthActive = sum > 0.05;
    }

    /**
     * Main update loop for expressions, blinking, and lipsync.
     * @param {number} dt - delta time (seconds)
     * @param {object} [director] - director state
     */
    update(dt, director = null) {
        if (!this.expressionManager) return;

        // 1. Emotion decay after speaking ends
        if (director && !director.isSpeaking) {
            this.decayTimer += dt;
            if (this.decayTimer > this.DECAY_DELAY) {
                // Smoothly decay back to neutral
                this.targetEmotion = 'neutral';
            }
        } else {
            this.decayTimer = 0;
        }

        // 2. Compute target weights for expressions from active emotion
        const config = getEmotionConfig(this.targetEmotion);
        const emotionMultiplier = this.targetEmotion === 'neutral' ? 1.0 : this.emotionIntensity;

        // Reset all targets
        for (const [name, spring] of this.springs) {
            if (!name.startsWith('blink') && !['aa', 'ee', 'ih', 'oh', 'ou'].includes(name)) {
                spring.target = 0;
            }
        }

        // Apply emotion expression targets
        let totalWeight = 0;
        for (const [exprName, weight] of Object.entries(config.expressions)) {
            // Check if model has this expression, or if we can use relaxed/happy fallback
            let targetName = exprName;
            if (!this.availableExpressions.has(exprName)) {
                if (exprName === 'blush') targetName = 'happy';
                else if (exprName === 'pout') targetName = 'angry';
            }

            const spring = this.springs.get(targetName);
            if (spring) {
                let scaledWeight = weight * emotionMultiplier;

                // Override protection: if mouth is speaking, scale down mouth-affecting expressions
                if (this.isMouthActive && (targetName === 'happy' || targetName === 'angry' || targetName === 'sad')) {
                    scaledWeight *= 0.3; // Allow mouth room for visemes
                }

                spring.target = Math.max(spring.target, scaledWeight);
                totalWeight += spring.target;
            }
        }

        // Blend cap: ensure total expression weight does not distort face
        const MAX_TOTAL_WEIGHT = EXPRESSION.MAX_EXPRESSION_WEIGHT || 1.0;
        if (totalWeight > MAX_TOTAL_WEIGHT) {
            const scale = MAX_TOTAL_WEIGHT / totalWeight;
            for (const [name, spring] of this.springs) {
                if (!name.startsWith('blink') && !['aa', 'ee', 'ih', 'oh', 'ou'].includes(name)) {
                    spring.target *= scale;
                }
            }
        }

        // 3. Update all expression springs and write to VRM
        for (const [name, spring] of this.springs) {
            if (!name.startsWith('blink') && !['aa', 'ee', 'ih', 'oh', 'ou'].includes(name)) {
                spring.update(dt);
                if (this.availableExpressions.has(name)) {
                    this.expressionManager.setValue(name, spring.value);
                }
            }
        }

        // 4. Timer-based blink with emotion multiplier & occasional double blink
        this._updateBlink(dt, config.blinkMultiplier || 1.0);

        // 5. Lip-sync smoothing and writing
        this._updateLipSync(dt);
    }

    _updateBlink(dt, blinkMultiplier) {
        switch (this.blinkPhase) {
            case 'idle':
                this.blinkTimer -= dt * blinkMultiplier;
                if (this.blinkTimer <= 0) {
                    this.blinkPhase = 'closing';
                    this.blinkProgress = 0;
                }
                break;

            case 'closing':
                this.blinkProgress += dt / this.BLINK_CLOSE_DURATION;
                if (this.blinkProgress >= 1.0) {
                    this.blinkProgress = 1.0;
                    this.blinkPhase = 'opening';
                }
                this._setBlinkValue(this.blinkProgress);
                break;

            case 'opening':
                this.blinkProgress -= dt / this.BLINK_OPEN_DURATION;
                if (this.blinkProgress <= 0) {
                    this.blinkProgress = 0;
                    this._setBlinkValue(0);

                    // Check if double blink should trigger
                    if (this.doubleBlinkPending) {
                        this.doubleBlinkPending = false;
                        this.blinkTimer = 0.08; // very short pause between double blinks
                        this.blinkPhase = 'idle';
                    } else {
                        // 15% chance of double blink
                        if (Math.random() < 0.15) {
                            this.doubleBlinkPending = true;
                            this.blinkTimer = 0.06;
                        } else {
                            // Standard 2-6s interval (sum of two uniforms for gaussian curve)
                            this.blinkTimer = 1.2 + Math.random() * 2.2 + Math.random() * 2.2;
                        }
                        this.blinkPhase = 'idle';
                    }
                } else {
                    this._setBlinkValue(this.blinkProgress);
                }
                break;
        }
    }

    _setBlinkValue(val) {
        if (this.availableExpressions.has('blink')) {
            this.expressionManager.setValue('blink', val);
        }
    }

    _updateLipSync(dt) {
        const lf = smoothFactor(EXPRESSION.LIPSYNC_SMOOTH_SPEED || 18, dt);
        this.lipSyncCurrent.aa += (this.lipSyncTarget.aa - this.lipSyncCurrent.aa) * lf;
        this.lipSyncCurrent.ee += (this.lipSyncTarget.ee - this.lipSyncCurrent.ee) * lf;
        this.lipSyncCurrent.ih += (this.lipSyncTarget.ih - this.lipSyncCurrent.ih) * lf;
        this.lipSyncCurrent.oh += (this.lipSyncTarget.oh - this.lipSyncCurrent.oh) * lf;
        this.lipSyncCurrent.ou += (this.lipSyncTarget.ou - this.lipSyncCurrent.ou) * lf;

        if (this.availableExpressions.has('aa')) this.expressionManager.setValue('aa', this.lipSyncCurrent.aa);
        if (this.availableExpressions.has('ee')) this.expressionManager.setValue('ee', this.lipSyncCurrent.ee);
        if (this.availableExpressions.has('ih')) this.expressionManager.setValue('ih', this.lipSyncCurrent.ih);
        if (this.availableExpressions.has('oh')) this.expressionManager.setValue('oh', this.lipSyncCurrent.oh);
        if (this.availableExpressions.has('ou')) this.expressionManager.setValue('ou', this.lipSyncCurrent.ou);
    }
}
