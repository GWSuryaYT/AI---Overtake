// ═══════════════════════════════════════════════════
//  CLIP LAYER — Runtime Bone Clip Playback & Blending
//  Applies evaluated bone rotations on normalized VRM bones,
//  blends with animated pose, and disables IK for keyed arms.
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { evaluateClip, mirrorClip } from './clip_evaluator.js';

const _qBase = new THREE.Quaternion();
const _qTarget = new THREE.Quaternion();
const _qBlended = new THREE.Quaternion();

// List of humanoid bones corresponding to each arm
const LEFT_ARM_BONES = new Set([
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal'
]);

const RIGHT_ARM_BONES = new Set([
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
]);

export class ClipLayer {
    constructor(vrm = null) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;

        this.activeClip = null;
        this.effectiveClip = null;
        this.currentTime = 0;
        this.isPlaying = false;
        this.weight = 0.0;
        this.fadeState = 'idle'; // 'in' | 'hold' | 'out' | 'idle'

        this.fadeInDuration = 0.25;
        this.fadeOutDuration = 0.35;
        this.holdUntilReleased = false;
        this.isReleased = false;

        this.activeSide = 'right';
        this.keyedBones = new Set();
        this.clipsRegistry = new Map();
    }

    setVRM(vrm) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;
    }

    registerClip(name, clip) {
        this.clipsRegistry.set(name, clip);
    }

    getClip(name) {
        return this.clipsRegistry.get(name) || null;
    }

    /**
     * Start playing a clip.
     * @param {string|object} clipOrName
     * @param {object} [opts={}]
     */
    play(clipOrName, opts = {}) {
        let clip = typeof clipOrName === 'string' ? this.getClip(clipOrName) : clipOrName;
        if (!clip) return false;

        this.activeSide = opts.side || 'right';
        if (opts.mirror || (this.activeSide === 'left' && !opts.noAutoMirror)) {
            this.effectiveClip = mirrorClip(clip);
        } else {
            this.effectiveClip = clip;
        }

        this.activeClip = clip;
        this.currentTime = opts.startTime !== undefined ? opts.startTime : 0;
        this.isPlaying = true;
        this.fadeInDuration = opts.fadeIn || clip.fadeIn || 0.25;
        this.fadeOutDuration = opts.fadeOut || clip.fadeOut || 0.35;
        this.holdUntilReleased = !!opts.holdUntilReleased || !!clip.holdUntilReleased;
        this.isReleased = false;
        this.fadeState = 'in';
        this.weight = opts.instant ? 1.0 : 0.0;

        this.keyedBones = new Set(Object.keys(this.effectiveClip.tracks || {}));
        return true;
    }

    stop(fadeOut = true) {
        if (!this.activeClip) return;
        if (!fadeOut) {
            this.isPlaying = false;
            this.activeClip = null;
            this.effectiveClip = null;
            this.weight = 0;
            this.fadeState = 'idle';
            this.keyedBones.clear();
        } else {
            this.fadeState = 'out';
            this.isReleased = true;
        }
    }

    release() {
        this.isReleased = true;
        this.fadeState = 'out';
    }

    seek(t) {
        this.currentTime = t;
        if (this.effectiveClip) {
            const dur = this.effectiveClip.duration || 1.0;
            this.currentTime = Math.max(0, Math.min(dur, t));
        }
    }

    /**
     * Check if a given arm is controlled/keyed by the active clip.
     * When true, IK arm control should be disabled for this side.
     * @param {'left'|'right'} side
     * @returns {boolean}
     */
    isArmKeyed(side) {
        if (!this.isPlaying || this.weight <= 0.001) return false;
        const armBones = side === 'left' ? LEFT_ARM_BONES : RIGHT_ARM_BONES;
        for (const bone of this.keyedBones) {
            if (armBones.has(bone)) return true;
        }
        return false;
    }

    /**
     * Main update: progresses playback, evaluates tracks, and blends quaternions.
     * @param {number} dt - delta time in seconds
     */
    update(dt) {
        if (!this.isPlaying || !this.effectiveClip || !this.humanoid) return;

        const dur = this.effectiveClip.duration || 1.0;

        // Advance time
        this.currentTime += dt;

        // Update fade weights
        if (this.fadeState === 'in') {
            const step = this.fadeInDuration > 0 ? (dt / this.fadeInDuration) : 1;
            this.weight = Math.min(1.0, this.weight + step);
            if (this.weight >= 1.0) {
                this.fadeState = this.holdUntilReleased ? 'hold' : 'play';
            }
        } else if (this.fadeState === 'out') {
            const step = this.fadeOutDuration > 0 ? (dt / this.fadeOutDuration) : 1;
            this.weight = Math.max(0.0, this.weight - step);
            if (this.weight <= 0.0) {
                this.stop(false);
                return;
            }
        }

        // Handle loop / completion
        if (this.effectiveClip.loop) {
            this.currentTime = this.currentTime % dur;
        } else if (this.currentTime >= dur) {
            if (this.holdUntilReleased && !this.isReleased) {
                this.currentTime = dur;
            } else if (this.fadeState !== 'out') {
                this.fadeState = 'out';
            }
        }

        // Evaluate clip at current time
        const evaluatedPose = evaluateClip(this.effectiveClip, this.currentTime);

        // Blend onto VRM normalized bones
        for (const [boneName, qTargetArr] of Object.entries(evaluatedPose)) {
            const boneNode = this.humanoid.getNormalizedBoneNode(boneName);
            if (!boneNode) continue;

            _qBase.copy(boneNode.quaternion);
            _qTarget.set(qTargetArr[0], qTargetArr[1], qTargetArr[2], qTargetArr[3]);

            if (this.weight >= 0.999) {
                boneNode.quaternion.copy(_qTarget);
            } else {
                _qBlended.copy(_qBase).slerp(_qTarget, this.weight);
                boneNode.quaternion.copy(_qBlended);
            }
        }
    }
}

export const clipLayer = new ClipLayer();
