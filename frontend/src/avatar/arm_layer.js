// ═══════════════════════════════════════════════════
//  ARM LAYER (v2) — Procedural Arm IK, Landmark Anchoring & Blending
//  • Targets defined in U-units relative to same-side shoulder
//  • Radial body avoidance (torso ellipsoid & head sphere)
//  • Soft reach limiter preventing straight-arm clamping
//  • Wrist orientation & palm alignment with zero arbitrary twist
//  • Secondary wave wrist-tilt oscillation
//  • Zero per-frame allocations & rig semantics shoulder lifting
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { TwoBoneIK } from './arm_ik.js';
import { HandPoseController } from './hand_poses.js';
import { avatarLandmarks } from './landmarks.js';
import { avatarFrame } from './frame.js';
import { rigSemantics } from './rig_semantics.js';

// Reusable scratch objects (zero per-frame allocations)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _qOsc = new THREE.Quaternion();
const _poleAvatar = new THREE.Vector3();
const _vPalmLocal = new THREE.Vector3();

export class ArmLayer {
    /**
     * @param {object} vrm - VRM instance
     * @param {GestureEngine} gestureEngine
     */
    constructor(vrm, gestureEngine) {
        this.vrm = vrm;
        this.gestureEngine = gestureEngine;
        this.humanoid = vrm?.humanoid || null;

        // Calibrate landmarks from model
        avatarLandmarks.calibrate(vrm);

        // Bone nodes (normalized skeleton)
        this.leftShoulder = this.humanoid?.getNormalizedBoneNode('leftShoulder');
        this.rightShoulder = this.humanoid?.getNormalizedBoneNode('rightShoulder');
        this.leftUpperArm = this.humanoid?.getNormalizedBoneNode('leftUpperArm');
        this.rightUpperArm = this.humanoid?.getNormalizedBoneNode('rightUpperArm');
        this.leftLowerArm = this.humanoid?.getNormalizedBoneNode('leftLowerArm');
        this.rightLowerArm = this.humanoid?.getNormalizedBoneNode('rightLowerArm');
        this.leftHand = this.humanoid?.getNormalizedBoneNode('leftHand');
        this.rightHand = this.humanoid?.getNormalizedBoneNode('rightHand');
        this.chest = this.humanoid?.getNormalizedBoneNode('chest') ||
                     this.humanoid?.getNormalizedBoneNode('upperChest') ||
                     this.humanoid?.getNormalizedBoneNode('spine');

        // Measure bone lengths from rest T-pose
        const l1Left = this._getBoneLength(this.leftUpperArm, this.leftLowerArm, avatarLandmarks.U);
        const l2Left = this._getBoneLength(this.leftLowerArm, this.leftHand, avatarLandmarks.F);
        const l1Right = this._getBoneLength(this.rightUpperArm, this.rightLowerArm, avatarLandmarks.U);
        const l2Right = this._getBoneLength(this.rightLowerArm, this.rightHand, avatarLandmarks.F);

        // Discovered rest directions from bone hierarchy
        const leftRestDir = this._discoverRestDir(this.leftUpperArm, this.leftLowerArm, new THREE.Vector3(1, 0, 0));
        const rightRestDir = this._discoverRestDir(this.rightUpperArm, this.rightLowerArm, new THREE.Vector3(-1, 0, 0));

        const leftLowerRestDir = this._discoverRestDir(this.leftLowerArm, this.leftHand, leftRestDir.clone());
        const rightLowerRestDir = this._discoverRestDir(this.rightLowerArm, this.rightHand, rightRestDir.clone());

        // Two-bone IK solvers with discovered rest directions and calibrated limb lengths
        this.ikLeft = new TwoBoneIK({
            l1: l1Left,
            l2: l2Left,
            restUpperDir: leftRestDir,
            restLowerDir: leftLowerRestDir,
        });

        this.ikRight = new TwoBoneIK({
            l1: l1Right,
            l2: l2Right,
            restUpperDir: rightRestDir,
            restLowerDir: rightLowerRestDir,
        });

        // Hand pose controllers
        this.leftHandPose = new HandPoseController(vrm, 'left');
        this.rightHandPose = new HandPoseController(vrm, 'right');

        // Scratch math objects
        this._sPos = new THREE.Vector3();
        this._tPos = new THREE.Vector3();
        this._polePos = new THREE.Vector3();
        this._desiredPalmDir = new THREE.Vector3();
        this._qAnimUpper = new THREE.Quaternion();
        this._qAnimLower = new THREE.Quaternion();
        this._qAnimHand = new THREE.Quaternion();
        this._upperParentWorldQ = new THREE.Quaternion();

        // Debug positions for visual gizmos (zero-allocation)
        this.debugPositions = {
            leftShoulder: new THREE.Vector3(),
            leftElbow: new THREE.Vector3(),
            leftTarget: new THREE.Vector3(),
            leftPole: new THREE.Vector3(),
            rightShoulder: new THREE.Vector3(),
            rightElbow: new THREE.Vector3(),
            rightTarget: new THREE.Vector3(),
            rightPole: new THREE.Vector3(),
        };
    }

    _discoverRestDir(b1, b2, fallback) {
        if (!b1 || !b2) return fallback.normalize();

        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        b1.getWorldPosition(p1);
        b2.getWorldPosition(p2);

        const dir = new THREE.Vector3().subVectors(p2, p1);
        if (dir.length() < 0.001) return fallback.normalize();

        if (b1.parent) {
            const parentWorldQ = new THREE.Quaternion();
            b1.parent.getWorldQuaternion(parentWorldQ);
            parentWorldQ.invert();
            dir.applyQuaternion(parentWorldQ);
        }

        return dir.normalize();
    }

    _getBoneLength(b1, b2, fallback) {
        if (!b1 || !b2) return fallback;
        const p1 = new THREE.Vector3();
        const p2 = new THREE.Vector3();
        b1.getWorldPosition(p1);
        b2.getWorldPosition(p2);
        const dist = p1.distanceTo(p2);
        return (dist > 0.05 && dist < 1.0) ? dist : fallback;
    }

    /**
     * Apply arm IK, wave oscillation, shoulder lift, and finger shapes.
     * Must be called in render loop after mixer.update() and before vrm.update()!
     * @param {number} dt - delta time (seconds)
     */
    apply(dt) {
        if (!this.humanoid || !this.vrm?.scene) return;

        const wLeft = this.gestureEngine.left.weight;
        const wRight = this.gestureEngine.right.weight;

        // 1. Update finger poses (blended with arm weight so idle fingers pass through when at rest)
        this.leftHandPose.setShape(this.gestureEngine.left.handShape);
        this.rightHandPose.setShape(this.gestureEngine.right.handShape);
        this.leftHandPose.update(dt, wLeft);
        this.rightHandPose.update(dt, wRight);

        // If both arms are resting, FBX idle handles arms 100%
        if (wLeft <= 0.001 && wRight <= 0.001) {
            return;
        }

        // 2. Solve Left Arm
        if (wLeft > 0.001 && this.leftUpperArm && this.leftLowerArm) {
            this._solveArm(
                'left',
                this.leftUpperArm,
                this.leftLowerArm,
                this.leftHand,
                this.ikLeft,
                this.gestureEngine.left,
                wLeft
            );
        }

        // 3. Solve Right Arm
        if (wRight > 0.001 && this.rightUpperArm && this.rightLowerArm) {
            this._solveArm(
                'right',
                this.rightUpperArm,
                this.rightLowerArm,
                this.rightHand,
                this.ikRight,
                this.gestureEngine.right,
                wRight
            );
        }
    }

    /**
     * Solve IK for one arm and blend result with animation.
     * @param {'left'|'right'} side
     * @param {THREE.Object3D} upperArm
     * @param {THREE.Object3D} lowerArm
     * @param {THREE.Object3D|null} hand
     * @param {TwoBoneIK} ik
     * @param {HandGestureState} handState
     * @param {number} weight - blend weight [0, 1]
     */
    _solveArm(side, upperArm, lowerArm, hand, ik, handState, weight) {
        const isLeft = (side === 'left');

        // ── Step 1: Get shoulder world position ──
        upperArm.getWorldPosition(this._sPos);

        // ── Step 2: Compute target in world space from U-unit offset ──
        avatarLandmarks.offsetToWorld(side, handState.posU, this._tPos);

        // ── Step 3: Radial Body Avoidance (Torso Ellipsoid & Head Sphere) ──
        const mode = (handState.gestureName === 'shy') ? 'clasp' :
                     (handState.gestureName === 'think') ? 'think' : 'default';
        TwoBoneIK.applyBodyAvoidance(this._tPos, avatarLandmarks, mode);

        // ── Step 4: Anatomical Pole Vector (Elbow hint) in World Space ──
        const polePreset = handState.pole || 'elbow_down';
        if (polePreset === 'elbow_out') {
            // Flare outward to the side (wave, shrug, dismiss, argue)
            _poleAvatar.set(isLeft ? 0.90 : -0.90, -0.20, -0.08).normalize();
        } else if (polePreset === 'elbow_in') {
            // Closer to the sides of the torso, pointing downward
            _poleAvatar.set(isLeft ? 0.25 : -0.25, -0.95, -0.05).normalize();
        } else if (polePreset === 'elbow_up_out') {
            // High gestures
            _poleAvatar.set(isLeft ? 0.75 : -0.75, 0.45, -0.10).normalize();
        } else {
            // elbow_down: natural downward hanging elbow, slightly outward
            _poleAvatar.set(isLeft ? 0.40 : -0.40, -0.85, -0.10).normalize();
        }
        avatarFrame.toWorldDirection(_poleAvatar, this._polePos);

        // ── Step 5: Get upper arm parent world quaternion ──
        if (upperArm.parent) {
            upperArm.parent.getWorldQuaternion(this._upperParentWorldQ);
        } else {
            this._upperParentWorldQ.identity();
        }

        // ── Step 6: Desired Palm Normal in World Space ──
        const palm = handState.palm || 'inward';
        if (palm === 'forward') {
            _vPalmLocal.set(0, 0, 1);
            avatarFrame.toWorldDirection(_vPalmLocal, this._desiredPalmDir);
        } else if (palm === 'up') {
            _vPalmLocal.set(0, 1, 0);
            avatarFrame.toWorldDirection(_vPalmLocal, this._desiredPalmDir);
        } else if (palm === 'down') {
            _vPalmLocal.set(0, -1, 0);
            avatarFrame.toWorldDirection(_vPalmLocal, this._desiredPalmDir);
        } else {
            // 'inward'
            if (handState.gestureName === 'think') {
                this._desiredPalmDir.subVectors(avatarLandmarks.chin, this._tPos).normalize();
            } else {
                _vPalmLocal.set(isLeft ? -1 : 1, 0, 0.2);
                avatarFrame.toWorldDirection(_vPalmLocal, this._desiredPalmDir);
            }
        }

        // ── Step 7: Solve IK (Upper Arm, Lower Arm, and Wrist) ──
        const allowFullPoint = (handState.gestureName === 'point');
        const res = ik.solve(
            this._sPos,
            this._tPos,
            this._polePos,
            this._upperParentWorldQ,
            side,
            this._desiredPalmDir,
            allowFullPoint
        );

        // Record positions for 3D debug gizmos
        if (isLeft) {
            this.debugPositions.leftShoulder.copy(this._sPos);
            this.debugPositions.leftElbow.copy(res.elbow);
            this.debugPositions.leftTarget.copy(this._tPos);
            this.debugPositions.leftPole.copy(this._polePos);
        } else {
            this.debugPositions.rightShoulder.copy(this._sPos);
            this.debugPositions.rightElbow.copy(res.elbow);
            this.debugPositions.rightTarget.copy(this._tPos);
            this.debugPositions.rightPole.copy(this._polePos);
        }

        // ── Step 8: Wave Wrist Tilt / Roll Oscillation ──
        if (handState.oscillationAngle !== 0) {
            const kind = handState.oscKind || 'forearm_swing';
            if (kind === 'wrist_roll') {
                // Roll around wrist longitudinal axis (Z)
                _qOsc.setFromAxisAngle(new THREE.Vector3(0, 0, 1), handState.oscillationAngle * 0.6);
            } else if (kind === 'point_pulse') {
                // Pitch tilt around X axis
                _qOsc.setFromAxisAngle(new THREE.Vector3(1, 0, 0), handState.oscillationAngle * 0.35);
            } else {
                // Gentle tilt around palm normal / Y axis (wave goodbye motion)
                _qOsc.setFromAxisAngle(new THREE.Vector3(0, 1, 0), handState.oscillationAngle * 0.35);
            }
            res.handLocalQ.multiply(_qOsc);
        }

        // ── Step 9: Shoulder Lift via Rig Semantics ──
        if (handState.shoulderLift !== 0) {
            rigSemantics.setShoulderLift(side, handState.shoulderLift * weight);
        }

        // ── Step 10: Slerp animated pose with procedural IK pose ──
        this._qAnimUpper.copy(upperArm.quaternion);
        this._qAnimLower.copy(lowerArm.quaternion);

        upperArm.quaternion.copy(this._qAnimUpper).slerp(res.upperArmLocalQ, weight);
        lowerArm.quaternion.copy(this._qAnimLower).slerp(res.lowerArmLocalQ, weight);

        if (hand) {
            this._qAnimHand.copy(hand.quaternion);
            hand.quaternion.copy(this._qAnimHand).slerp(res.handLocalQ, weight);
        }
    }
}
