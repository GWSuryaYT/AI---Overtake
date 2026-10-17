// ═══════════════════════════════════════════════════
//  SPEECH FEATURES (v2) — Time-Domain RMS, Adaptive Onset & Emphasis
//  Detects stress peaks, running baseline, emphasis strength, and pauses
// ═══════════════════════════════════════════════════

import { SPEECH } from './avatar_config.js';

export class SpeechFeatures {
    /**
     * @param {AnalyserNode|null} analyser
     */
    constructor(analyser = null) {
        this.analyser = null;
        this.timeData = null;
        this.setAnalyser(analyser);

        // Core signals
        this.rms = 0;
        this.rmsDb = -100;
        this.fastEnvelope = 0;
        this.slowBaseline = 0;

        // Flags & metrics
        this.onset = false;
        this.emphasis = 0; // 0 to 1
        this.isSpeaking = false;
        this.pauseMs = 0;

        // Adaptive onset parameters
        this.refractoryTimer = 0;
        this.REFRACTORY_SEC = SPEECH.ONSET_MIN_REFRACTORY || 0.38;
        this.silenceTimer = 0;

        // Running statistics for onset rate logging
        this._onsetCount = 0;
        this._windowTime = 0;
        this.onsetRate = 0; // onsets / sec
    }

    setAnalyser(analyser) {
        this.analyser = analyser;
        if (analyser) {
            // Allocate time-domain buffer (1024 samples)
            this.timeData = new Float32Array(analyser.fftSize || 1024);
        } else {
            this.timeData = null;
        }
    }

    /**
     * Update speech features once per frame.
     * @param {number} dt - delta time in seconds
     */
    update(dt) {
        this.onset = false;
        this.emphasis = 0;
        this._windowTime += dt;

        if (this.refractoryTimer > 0) {
            this.refractoryTimer -= dt;
        }

        // Measure onset rate every 2 seconds
        if (this._windowTime >= 2.0) {
            this.onsetRate = this._onsetCount / this._windowTime;
            this._onsetCount = 0;
            this._windowTime = 0;
        }

        if (!this.analyser || !this.timeData) {
            this.rms = 0;
            this.rmsDb = -100;
            this.isSpeaking = false;
            this.pauseMs += dt * 1000;
            return;
        }

        // 1. Read raw waveform time-domain data
        if (this.analyser.getFloatTimeDomainData) {
            this.analyser.getFloatTimeDomainData(this.timeData);
        }

        // 2. Compute accurate time-domain RMS
        let sumSquares = 0;
        const len = this.timeData.length;
        for (let i = 0; i < len; i++) {
            const v = this.timeData[i];
            sumSquares += v * v;
        }
        const instantRms = Math.sqrt(sumSquares / len);

        // Instantaneous dB (floor at -80 dB)
        const instantDb = (instantRms > 1e-4) ? (20 * Math.log10(instantRms)) : -80;

        // 3. Fast envelope (tau ~ 30ms) & Slow baseline (tau ~ 1.5s)
        const fastK = 1.0 - Math.exp(-33 * dt);
        const slowK = 1.0 - Math.exp(-0.67 * dt);

        this.rms += (instantRms - this.rms) * fastK;
        this.fastEnvelope += (instantDb - this.fastEnvelope) * fastK;
        this.slowBaseline += (instantDb - this.slowBaseline) * slowK;
        this.rmsDb = this.fastEnvelope;

        // 4. Speaking vs Pause detection
        const speakingThreshold = SPEECH.SPEAKING_RMS_THRESHOLD || 0.015;
        if (this.rms > speakingThreshold) {
            this.isSpeaking = true;
            this.silenceTimer = 0;
            this.pauseMs = 0;
        } else {
            this.silenceTimer += dt;
            this.pauseMs = this.silenceTimer * 1000;
            if (this.silenceTimer > (SPEECH.PAUSE_THRESHOLD_MS / 1000 || 0.25)) {
                this.isSpeaking = false;
            }
        }

        // 5. Adaptive Onset Detection: fastEnvelope - slowBaseline > threshold
        const dbDelta = this.fastEnvelope - this.slowBaseline;
        const dbThreshold = SPEECH.ONSET_DB_THRESHOLD || 4.5;

        if (this.isSpeaking && this.refractoryTimer <= 0 && dbDelta > dbThreshold) {
            this.onset = true;
            this._onsetCount++;

            // Emphasis strength: normalized [0, 1] based on excess dB above threshold
            const excess = Math.max(0, dbDelta - dbThreshold);
            this.emphasis = Math.min(1.0, excess / 10.0);

            // Jitter refractory period slightly (350 - 550 ms)
            this.refractoryTimer = 0.35 + (1.0 - this.emphasis) * 0.20;
        }
    }

    getFeatures() {
        return {
            rms: this.rms,
            rmsDb: this.rmsDb,
            onset: this.onset,
            emphasis: this.emphasis,
            isSpeaking: this.isSpeaking,
            pauseMs: this.pauseMs,
            onsetRate: this.onsetRate,
        };
    }
}
