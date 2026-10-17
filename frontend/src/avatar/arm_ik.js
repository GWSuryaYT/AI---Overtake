// ═══════════════════════════════════════════════════
//  ANALYTICAL TWO-BONE IK (v2) — Soft Limiter, Anatomical Constraints
//  Supports Soft Reach Band [0.35R, 0.94R], Torso Ellipsoid & Head Avoidance,
//  Elbow Interior Angle Bounds, and Full Orthonormal Upper/Lower/Hand Solve
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { ARM_IK } from './avatar_config.js';

// Preallocated scratch objects for zero GC per frame
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _vEllipsoid = new THREE.Vector3();
const _vFallbackPole = new THREE.Vector3();

const _xUpper = new THREE.Vector3();
const _yUpper = new THREE.Vector3();
const _zUpper = new THREE.Vector3();
const _xLower = new THREE.Vector3();
const _yLower = new THREE.Vector3();
const _zLower = new THREE.Vector3();
const _xHand = new THREE.Vector3();
const _yHand = new THREE.Vector3();
const _zHand = new THREE.Vector3();

const _mUpper = new THREE.Matrix4();
const _mLower = new THREE.Matrix4();
const _mHand = new THREE.Matrix4();

const _qUpperWorld = new THREE.Quaternion();
const _qLowerWorld = new THREE.Quaternion();
const _qHandWorld = new THREE.Quaternion();
const _qUpperLocal = new THREE.Quaternion();
const _qLowerLocal = new THREE.Quaternion();
const _qHandLocal = new THREE.Quaternion();
const _qInvParent = new THREE.Quaternion();
const _qInvUpper = new THREE.Quaternion();
const _qInvLower = new THREE.Quaternion();

const _palmNorm = new THREE.Vector3();
const _handForward = new THREE.Vector3();
const _planeNormal = new THREE.Vector3();

export class TwoBoneIK {
    /**
     * @param {object} options
     * @param {number} [options.l1=0.25] - upper arm length
     * @param {number} [options.l2=0.23] - lower arm length
     * @param {THREE.Vector3} [options.restUpperDir] - local rest direction (e.g. +X left, -X right)
     * @param {THREE.Vector3} [options.restLowerDir] - local rest direction
     */
    constructor(options = {}) {
        this.l1 = options.l1 || 0.25;
        this.l2 = options.l2 || 0.23;
        this.reach = this.l1 + this.l2;

        this.restUpperDir = (options.restUpperDir || new THREE.Vector3(1, 0, 0)).clone().normalize();
        this.restLowerDir = (options.restLowerDir || new THREE.Vector3(1, 0, 0)).clone().normalize();

        // Scratch vectors for IK solve
        this._dirST = new THREE.Vector3();
        this._poleProj = new THREE.Vector3();
        this._elbowPos = new THREE.Vector3();
        this._upperDir = new THREE.Vector3();
        this._lowerDir = new THREE.Vector3();
        this._clampedTarget = new THREE.Vector3();
    }

    /**
     * Soft reach limiter: smoothly compresses requested target distance d
     * into natural reach band [0.35R, 0.94R], preventing stiff straight arms.
     * @param {number} rawDist
     * @param {boolean} [allowFullPoint=false] - allows up to 0.96R for explicit pointing
     * @returns {number} compressed distance
     */
    softLimitDistance(rawDist, allowFullPoint = false) {
        const minReach = this.reach * (ARM_IK.REACH_MIN_RATIO || 0.35);
        const maxReach = this.reach * (allowFullPoint ? (ARM_IK.POINT_MAX_RATIO || 0.96) : (ARM_IK.REACH_MAX_RATIO || 0.94));

        if (rawDist < minReach) {
            return minReach - 0.02 * Math.exp(-(minReach - rawDist) / 0.02);
        }

        if (rawDist > maxReach) {
            const excess = rawDist - maxReach;
            const delta = 0.015 * (1.0 - Math.exp(-excess / 0.015));
            return maxReach + delta;
        }

        return rawDist;
    }

    /**
     * Apply radial body avoidance (torso ellipsoid & head sphere).
     * @param {THREE.Vector3} target - wrist target (mutated in place)
     * @param {object} landmarks - avatar landmarks
     * @param {string} [mode='default'] - 'think' | 'clasp' | 'default'
     */
    static applyBodyAvoidance(target, landmarks = null, mode = 'default') {
        const tc = (landmarks && landmarks.torsoCenter) ? landmarks.torsoCenter : { x: 0, y: 1.05, z: 0 };
        const tr = (landmarks && landmarks.torsoRadii) ? landmarks.torsoRadii : { x: 0.16, y: 0.22, z: 0.14 };

        // 1. Torso Ellipsoid Avoidance
        _vEllipsoid.set(
            (target.x - tc.x) / tr.x,
            (target.y - tc.y) / tr.y,
            (target.z - tc.z) / tr.z
        );

        const ellDistSq = _vEllipsoid.lengthSq();
        if (ellDistSq < 1.0) {
            const scale = Math.sqrt(ellDistSq);
            if (scale > 0.001) {
                const pushFactor = (1.0 + 0.02 / tr.z) / scale;
                target.x = tc.x + (target.x - tc.x) * pushFactor;
                target.y = tc.y + (target.y - tc.y) * pushFactor;
                target.z = tc.z + (target.z - tc.z) * pushFactor;
            }
        }

        // Front-of-torso surface floor: when near center midline, keep hands in front
        const frontTorsoZ = tc.z + tr.z + (mode === 'clasp' ? 0.01 : 0.02);
        if (Math.abs(target.x - tc.x) < tr.x * 0.9 && target.y < tc.y + tr.y && target.z < frontTorsoZ) {
            target.z = frontTorsoZ;
        }

        // 2. Head Sphere Avoidance
        const hc = (landmarks && landmarks.headCenter) ? landmarks.headCenter : { x: 0, y: 1.35, z: 0 };
        const hr = (landmarks && landmarks.headRadius) ? landmarks.headRadius : 0.12;
        const headClearance = (mode === 'think') ? 0.01 : 0.03;

        _v1.set(target.x - hc.x, target.y - hc.y, target.z - hc.z);
        const distToHead = _v1.length();
        if (distToHead < hr + headClearance && distToHead > 0.0001) {
            _v1.normalize();
            target.x = hc.x + _v1.x * (hr + headClearance);
            target.y = hc.y + _v1.y * (hr + headClearance);
            target.z = hc.z + _v1.z * (hr + headClearance);
        }

        return target;
    }

    /**
     * Analytical Two-Bone IK solve with full orthonormal coordinate frames.
     * Computes elbow position, upper arm, lower arm, and wrist quaternions.
     *
     * @param {THREE.Vector3} S - Shoulder world position
     * @param {THREE.Vector3} T - Target world position
     * @param {THREE.Vector3} pole - Pole vector in world space
     * @param {THREE.Quaternion} upperParentWorldQ - Parent world rotation
     * @param {'left'|'right'} side - Arm side
     * @param {THREE.Vector3} [desiredPalmDir=null] - Desired palm normal in world space
     * @param {boolean} [allowFullPoint=false]
     * @returns {{
     *   elbow: THREE.Vector3,
     *   upperArmLocalQ: THREE.Quaternion,
     *   lowerArmLocalQ: THREE.Quaternion,
     *   handLocalQ: THREE.Quaternion,
     *   interiorElbowAngleDeg: number,
     *   isReachable: boolean
     * }}
     */
    solve(S, T, pole, upperParentWorldQ, side = 'left', desiredPalmDir = null, allowFullPoint = false) {
        const isLeft = (side === 'left');

        this._dirST.subVectors(T, S);
        const rawDist = this._dirST.length();

        // Apply soft reach limiter
        const d = this.softLimitDistance(rawDist, allowFullPoint);

        if (rawDist < 0.0001) {
            this._dirST.set(isLeft ? 1 : -1, 0, 0).applyQuaternion(upperParentWorldQ);
        } else {
            this._dirST.divideScalar(rawDist);
        }

        // Clamped target for exact triangle
        this._clampedTarget.copy(S).addScaledVector(this._dirST, d);

        // Law of Cosines for two-bone triangle:
        //   a = (l1^2 - l2^2 + d^2) / (2d)
        //   h = sqrt(max(0, l1^2 - a^2))
        const a = (this.l1 * this.l1 - this.l2 * this.l2 + d * d) / (2.0 * d);
        const hSq = Math.max(0.0, this.l1 * this.l1 - a * a);
        const h = Math.sqrt(hSq);

        // Project pole vector onto plane perpendicular to dirST
        const poleDotDir = pole.dot(this._dirST);
        this._poleProj.copy(pole).addScaledVector(this._dirST, -poleDotDir);
        const poleProjLen = this._poleProj.length();

        if (poleProjLen > 0.001) {
            this._poleProj.divideScalar(poleProjLen);
        } else {
            // Collinear fallback: natural elbow protrusion is outward and slightly downward
            _vFallbackPole.set(isLeft ? 0.8 : -0.8, -0.4, -0.2);
            const fbDot = _vFallbackPole.dot(this._dirST);
            this._poleProj.copy(_vFallbackPole).addScaledVector(this._dirST, -fbDot).normalize();
        }

        // World elbow position
        this._elbowPos.copy(S)
            .addScaledVector(this._dirST, a)
            .addScaledVector(this._poleProj, h);

        // Desired world bone directions
        this._upperDir.subVectors(this._elbowPos, S).normalize();
        this._lowerDir.subVectors(this._clampedTarget, this._elbowPos).normalize();

        // Interior elbow angle: angle between (S - E) and (T - E)
        _v1.subVectors(S, this._elbowPos).normalize();
        _v2.subVectors(this._clampedTarget, this._elbowPos).normalize();
        const dot = Math.max(-1, Math.min(1, _v1.dot(_v2)));
        const interiorAngleDeg = Math.acos(dot) * (180.0 / Math.PI);

        // ── Construct Orthonormal Basis for Upper & Lower Arm ──
        // The triangle normal represents the hinge axis of the elbow
        _planeNormal.crossVectors(this._upperDir, this._lowerDir);
        if (_planeNormal.lengthSq() < 0.0001) {
            _planeNormal.crossVectors(this._upperDir, this._poleProj);
        }
        _planeNormal.normalize();

        if (isLeft) {
            // Left Upper Arm: bone direction is +X, hinge is -planeNormal
            _xUpper.copy(this._upperDir);
            _yUpper.copy(_planeNormal).negate();
            _zUpper.crossVectors(_xUpper, _yUpper).normalize();

            // Left Lower Arm: bone direction is +X, hinge is -planeNormal
            _xLower.copy(this._lowerDir);
            _yLower.copy(_yUpper);
            _zLower.crossVectors(_xLower, _yLower).normalize();
        } else {
            // Right Upper Arm: bone direction is -X, hinge is +planeNormal
            _xUpper.copy(this._upperDir).negate();
            _yUpper.copy(_planeNormal);
            _zUpper.crossVectors(_xUpper, _yUpper).normalize();

            // Right Lower Arm: bone direction is -X, hinge is +planeNormal
            _xLower.copy(this._lowerDir).negate();
            _yLower.copy(_yUpper);
            _zLower.crossVectors(_xLower, _yLower).normalize();
        }

        // World matrices and quaternions for upper & lower arm
        _mUpper.makeBasis(_xUpper, _yUpper, _zUpper);
        _qUpperWorld.setFromRotationMatrix(_mUpper);

        _mLower.makeBasis(_xLower, _yLower, _zLower);
        _qLowerWorld.setFromRotationMatrix(_mLower);

        // Convert to local parent quaternions
        _qInvParent.copy(upperParentWorldQ).invert();
        _qUpperLocal.multiplyQuaternions(_qInvParent, _qUpperWorld);

        _qInvUpper.copy(_qUpperWorld).invert();
        _qLowerLocal.multiplyQuaternions(_qInvUpper, _qLowerWorld);

        // ── Construct Hand (Wrist) Orientation ──
        _handForward.copy(this._lowerDir);

        if (desiredPalmDir) {
            // Project desired palm normal onto plane perpendicular to hand forward direction
            _palmNorm.copy(desiredPalmDir).addScaledVector(_handForward, -desiredPalmDir.dot(_handForward));
            if (_palmNorm.lengthSq() > 0.001) {
                _palmNorm.normalize();
            } else {
                _palmNorm.copy(isLeft ? _yUpper : _yUpper.clone().negate());
            }
        } else {
            _palmNorm.copy(isLeft ? _yUpper : _yUpper.clone().negate());
        }

        if (isLeft) {
            // VRM Left Hand: fingers along +X, palm faces -Y (so local +Y is -palmNorm)
            _xHand.copy(_handForward);
            _yHand.copy(_palmNorm).negate();
            _zHand.crossVectors(_xHand, _yHand).normalize();
        } else {
            // VRM Right Hand: fingers along -X (local +X is -handForward), palm faces -Y
            _xHand.copy(_handForward).negate();
            _yHand.copy(_palmNorm).negate();
            _zHand.crossVectors(_xHand, _yHand).normalize();
        }

        _mHand.makeBasis(_xHand, _yHand, _zHand);
        _qHandWorld.setFromRotationMatrix(_mHand);

        _qInvLower.copy(_qLowerWorld).invert();
        _qHandLocal.multiplyQuaternions(_qInvLower, _qHandWorld);

        return {
            elbow: this._elbowPos.clone(),
            upperArmLocalQ: _qUpperLocal,
            lowerArmLocalQ: _qLowerLocal,
            handLocalQ: _qHandLocal,
            interiorElbowAngleDeg: parseFloat(interiorAngleDeg.toFixed(1)),
            isReachable: rawDist <= (this.reach * 0.95),
        };
    }
}
