// ═══════════════════════════════════════════════════
//  STUDIO VARIATION — Procedural Variation for Clips
//  Applies Side selection, timing jitter, amplitude jitter,
//  and per-bone random angular offsets using seeded RNG.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { mirrorClip } from './clip_evaluator.js';
import { SeededRNG } from './rng.js';

const _qIdentity = new THREE.Quaternion(0, 0, 0, 1);
const _qTemp = new THREE.Quaternion();
const _eulerTemp = new THREE.Euler(0, 0, 0, 'XYZ');

/**
 * Variation configuration schema attached to an animation clip:
 * {
 *   side: 'right' | 'left' | 'either' | 'both' | 'alternate',
 *   timingJitterPct: 0.10,     // e.g. ±10%
 *   amplitudeJitterPct: 0.15,  // e.g. ±15%
 *   boneNoiseDeg: 2.0,         // e.g. ±2° random offset
 *   seed: 12345
 * }
 */

/**
 * Apply variation to a clip, returning a cloned clip with randomized/perturbed tracks.
 * @param {object} clip - source clip
 * @param {object} [varConfig={}] - variation options
 * @param {SeededRNG|null} [customRng=null] - optional RNG
 * @returns {object} - perturbed clip
 */
export function applyVariation(clip, varConfig = {}, customRng = null) {
    if (!clip || !clip.tracks) return clip;

    const rng = customRng || new SeededRNG(varConfig.seed !== undefined ? varConfig.seed : Math.floor(Math.random() * 1000000));
    const config = Object.assign({
        side: 'right',
        timingJitterPct: 0,
        amplitudeJitterPct: 0,
        boneNoiseDeg: 0,
    }, clip.variation || {}, varConfig);
    if (config.timingJitter !== undefined && config.timingJitterPct === 0) config.timingJitterPct = config.timingJitter;
    if (config.ampJitter !== undefined && config.amplitudeJitterPct === 0) config.amplitudeJitterPct = config.ampJitter;

    // 1. Determine effective side / mirroring
    let baseClip = clip;
    let chosenSide = config.side;
    if (config.side === 'either') {
        chosenSide = rng.next() > 0.5 ? 'right' : 'left';
    }

    if (chosenSide === 'left') {
        baseClip = mirrorClip(clip);
    }

    // 2. Deep clone clip
    const variedClip = JSON.parse(JSON.stringify(baseClip));
    variedClip._effectiveSide = chosenSide;

    // 3. Timing Jitter
    const timeScale = 1.0 + (rng.range(-1, 1) * config.timingJitterPct);
    variedClip.duration = Math.max(0.2, (baseClip.duration || 1.0) * timeScale);

    // 4. Amplitude & Bone Noise
    const ampScale = 1.0 + (rng.range(-1, 1) * config.amplitudeJitterPct);
    const noiseRad = THREE.MathUtils.degToRad(config.boneNoiseDeg || 0);

    for (const [boneName, track] of Object.entries(variedClip.tracks)) {
        for (const key of track) {
            // Apply time jitter
            key.t = Math.max(0, Math.min(variedClip.duration, key.t * timeScale));

            // Amplitude jitter (slerp toward or away from identity)
            if (Math.abs(ampScale - 1.0) > 0.001) {
                _qTemp.set(key.rot[0], key.rot[1], key.rot[2], key.rot[3]);
                // If ampScale > 1, extrapolate; if < 1, slerp toward identity
                if (ampScale < 1.0) {
                    _qTemp.slerp(_qIdentity, 1.0 - ampScale);
                }
                key.rot = [_qTemp.x, _qTemp.y, _qTemp.z, _qTemp.w];
            }

            // Angular noise
            if (noiseRad > 0.001) {
                _qTemp.set(key.rot[0], key.rot[1], key.rot[2], key.rot[3]);
                _eulerTemp.set(
                    rng.range(-noiseRad, noiseRad),
                    rng.range(-noiseRad, noiseRad),
                    rng.range(-noiseRad, noiseRad),
                    'XYZ'
                );
                const noiseQ = new THREE.Quaternion().setFromEuler(_eulerTemp);
                _qTemp.multiply(noiseQ);
                key.rot = [
                    Math.round(_qTemp.x * 10000) / 10000,
                    Math.round(_qTemp.y * 10000) / 10000,
                    Math.round(_qTemp.z * 10000) / 10000,
                    Math.round(_qTemp.w * 10000) / 10000,
                ];
            }
        }
    }

    return variedClip;
}
