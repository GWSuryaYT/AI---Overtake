// ═══════════════════════════════════════════════════
//  HAND POSES (v2) — Finger Curl Calibration & Joint Distribution
//  Supports VRM 0 & VRM 1 normalized finger bones with rig semantics.
//  Preserves idle finger animation when arm is at rest (w_arm = 0).
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { smoothFactor } from './springs.js';
import { simplex2 } from './noise.js';
import { rigSemantics } from './rig_semantics.js';
import { avatarRNG } from './rng.js';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'];
export const JOINTS = ['Proximal', 'Intermediate', 'Distal'];

// Joint curl distribution ratios: proximal: 1.0, intermediate: 1.1, distal: 0.7
const JOINT_RATIOS = [1.0, 1.1, 0.7];
const TOTAL_RATIO = JOINT_RATIOS[0] + JOINT_RATIOS[1] + JOINT_RATIOS[2]; // 2.8

// Hand shapes: curl [0 (straight) to 1 (full curl)] per finger [thumb, index, middle, ring, little]
export const HAND_SHAPES = {
    // Soft resting curve
    relaxed: {
        curl: [0.12, 0.20, 0.22, 0.25, 0.25],
        spread: 0.04,
    },
    // Default talking pose — slightly open, alive
    soft_open: {
        curl: [0.08, 0.12, 0.14, 0.16, 0.18],
        spread: 0.06,
    },
    // Fully open hand
    open: {
        curl: [0.0, 0.02, 0.02, 0.02, 0.02],
        spread: 0.14,
    },
    // Pointing with index finger extended
    point: {
        curl: [0.60, 0.0, 0.75, 0.78, 0.78],
        spread: 0.0,
    },
    // Fist
    fist: {
        curl: [0.70, 0.85, 0.88, 0.88, 0.88],
        spread: -0.04,
    },
    // Pinch (thumb and index fingertips meeting)
    pinch: {
        curl: [0.50, 0.58, 0.75, 0.78, 0.78],
        spread: -0.02,
    },
    // Cup / curved palm (holding heart or cup)
    cup: {
        curl: [0.18, 0.35, 0.40, 0.42, 0.42],
        spread: 0.04,
    },
    // Clasp / shy fingers intertwined
    clasp: {
        curl: [0.25, 0.38, 0.42, 0.45, 0.45],
        spread: -0.03,
    },
    // Chin rest (curled fingers with thumb supporting jaw)
    chin_rest: {
        curl: [0.18, 0.55, 0.60, 0.65, 0.65],
        spread: 0.0,
    },
};

// Reusable scratch objects (zero per-frame allocations)
const _eulerWork = new THREE.Euler(0, 0, 0, 'YXZ');
const _qTarget = new THREE.Quaternion();
const _qBase = new THREE.Quaternion();

export class HandPoseController {
    /**
     * @param {object} vrm - VRM instance
     * @param {'left'|'right'} side
     */
    constructor(vrm, side = 'left') {
        this.vrm = vrm;
        this.side = side; // 'left' or 'right'
        this.humanoid = vrm?.humanoid || null;

        // Current and target curl values per finger (5 elements)
        this.currentCurl = [0.15, 0.15, 0.15, 0.15, 0.15];
        this.targetCurl = [0.15, 0.15, 0.15, 0.15, 0.15];
        this.currentSpread = 0.05;
        this.targetSpread = 0.05;

        // Deterministic noise time offset
        this.time = avatarRNG.next() * 500;

        // Cache bone references
        this.bones = {};
        this._cacheBones();

        // Curl sign from rig conventions:
        // In normalized VRM: left curl is -Z (sign = -1), right curl is +Z (sign = +1)
        this.curlSign = (side === 'left') ? -1 : 1;
    }

    _cacheBones() {
        if (!this.humanoid) return;
        const prefix = this.side; // 'left' or 'right'

        for (const finger of FINGERS) {
            this.bones[finger] = [];

            // Probe candidate names (VRM 1 vs VRM 0)
            const candidates = [
                // VRM 1 format: leftThumbMetacarpal, leftThumbProximal, leftThumbDistal
                finger === 'thumb'
                    ? [`${prefix}ThumbMetacarpal`, `${prefix}ThumbProximal`, `${prefix}ThumbDistal`]
                    : [`${prefix}${finger[0].toUpperCase() + finger.slice(1)}Proximal`,
                       `${prefix}${finger[0].toUpperCase() + finger.slice(1)}Intermediate`,
                       `${prefix}${finger[0].toUpperCase() + finger.slice(1)}Distal`],
                // VRM 0 format
                finger === 'thumb'
                    ? [`${prefix}ThumbProximal`, `${prefix}ThumbIntermediate`, `${prefix}ThumbDistal`]
                    : []
            ];

            for (const candidateSet of candidates) {
                if (candidateSet.length > 0) {
                    const found = candidateSet.map(name => this.humanoid.getNormalizedBoneNode(name));
                    if (found.some(n => n !== null && n !== undefined)) {
                        this.bones[finger] = found.filter(n => n !== null && n !== undefined);
                        break;
                    }
                }
            }
        }
    }

    /**
     * Transition to a predefined hand shape.
     * @param {string} shapeName
     */
    setShape(shapeName) {
        const shape = HAND_SHAPES[shapeName] || HAND_SHAPES.soft_open;
        for (let i = 0; i < 5; i++) {
            this.targetCurl[i] = shape.curl[i];
        }
        this.targetSpread = shape.spread;
    }

    /**
     * Update finger curl and apply to bones, blended with arm activity weight.
     * When weight <= 0.001, leaves bone rotations untouched to let idle clip pass through.
     * @param {number} dt - delta time in seconds
     * @param {number} [weight=1.0] - arm activity weight [0, 1]
     */
    update(dt, weight = 1.0) {
        this.time += dt;

        // Smooth toward target curl (spring stiffness omega ~14)
        const smoothK = smoothFactor(14.0, dt);
        for (let i = 0; i < 5; i++) {
            this.currentCurl[i] += (this.targetCurl[i] - this.currentCurl[i]) * smoothK;
        }
        this.currentSpread += (this.targetSpread - this.currentSpread) * smoothK;

        // When arm is fully at rest, do not override idle finger animation
        if (weight <= 0.001) {
            return;
        }

        const isLeft = (this.side === 'left');
        const curlSign = this.curlSign; // -1 for left, +1 for right

        // Maximum total natural curl across all 3 finger joints (~137 degrees)
        const MAX_TOTAL_CURL = 2.40;

        for (let fIdx = 0; fIdx < FINGERS.length; fIdx++) {
            const fingerName = FINGERS[fIdx];
            const boneList = this.bones[fingerName] || [];
            if (boneList.length === 0) continue;

            const baseCurl = Math.max(0.0, Math.min(1.0, this.currentCurl[fIdx]));
            // Micro-noise (< 1 degree) so fingers feel alive
            const noise = simplex2(this.time * 0.4 + fIdx * 2.0, 0) * 0.015;
            const fingerCurl = Math.max(0.0, Math.min(1.0, baseCurl + noise));

            const totalCurlAngle = fingerCurl * MAX_TOTAL_CURL;

            for (let jIdx = 0; jIdx < boneList.length; jIdx++) {
                const node = boneList[jIdx];
                if (!node) continue;

                // Distribute curl across joints using anatomical ratios [1.0, 1.1, 0.7]
                const ratio = (jIdx < JOINT_RATIOS.length) ? JOINT_RATIOS[jIdx] : 1.0;
                const jointCurlAngle = (totalCurlAngle * ratio) / TOTAL_RATIO;
                const spreadAngle = (jIdx === 0) ? (this.currentSpread * (fIdx - 2) * 0.20) : 0;

                if (fingerName === 'thumb') {
                    // Thumb flexion and opposition:
                    // In VRM normalized skeleton: thumb rotates inward toward palm
                    const thumbYaw = jointCurlAngle * 0.20 * (isLeft ? 1 : -1);
                    const thumbPitch = jointCurlAngle * 0.15;
                    const thumbRoll = jointCurlAngle * 0.35 * curlSign;

                    _eulerWork.set(thumbPitch, thumbYaw, thumbRoll, 'YXZ');
                } else {
                    // Regular 4 fingers: primary curl on local Z with correct sign (never hyperextend)
                    _eulerWork.set(
                        0,
                        spreadAngle * (isLeft ? 1 : -1),
                        jointCurlAngle * curlSign,
                        'YXZ'
                    );
                }

                _qTarget.setFromEuler(_eulerWork);

                if (weight >= 0.999) {
                    node.quaternion.copy(_qTarget);
                } else {
                    _qBase.copy(node.quaternion);
                    node.quaternion.copy(_qBase).slerp(_qTarget, weight);
                }
            }
        }
    }
}
