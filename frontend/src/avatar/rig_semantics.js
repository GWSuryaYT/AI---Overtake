// ═══════════════════════════════════════════════════
//  RIG SEMANTICS PROBE & SETTERS
//  Discovers empirical bone axis conventions at load and provides
//  canonical semantic setters:
//    headPitch: positive = nose DOWN
//    headYaw: positive = nose LEFT (toward avatar's left +X)
//    headRoll: positive = tilt head RIGHT (top of head toward right -X)
//    shoulderLift: positive = shoulder UP (+Y)
//    shoulderProtract: positive = shoulder FORWARD (+Z)
//    fingerCurl: positive = curl toward palm
// ═══════════════════════════════════════════════════

import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _qOriginal = new THREE.Quaternion();
const _qTest = new THREE.Quaternion();
const _qWork = new THREE.Quaternion();
const _eulerWork = new THREE.Euler(0, 0, 0, 'YXZ');

export class RigSemantics {
    constructor() {
        this.vrm = null;
        this.humanoid = null;

        // Discovered semantic axes and signs
        this.semantics = {
            headPitch: { axis: 'x', sign: 1 },
            headYaw: { axis: 'y', sign: 1 },
            headRoll: { axis: 'z', sign: 1 },
            neckPitch: { axis: 'x', sign: 1 },
            spinePitch: { axis: 'x', sign: 1 },
            spineRoll: { axis: 'z', sign: 1 },
            shoulderLift: { left: { axis: 'z', sign: 1 }, right: { axis: 'z', sign: -1 } },
            shoulderProtract: { left: { axis: 'y', sign: -1 }, right: { axis: 'y', sign: 1 } },
            fingerCurl: { left: {}, right: {} },
            fingerSpread: { left: {}, right: {} },
        };

        // Cached bone references
        this.bones = {};
    }

    /**
     * Probe rig conventions at load on real VRM or fake VRM skeleton.
     * @param {object} vrm
     */
    probe(vrm) {
        this.vrm = vrm;
        this.humanoid = vrm?.humanoid || null;
        if (!this.humanoid) return this.semantics;

        vrm.scene.updateMatrixWorld(true);

        // Cache bones
        const boneNames = [
            'head', 'neck', 'spine', 'chest', 'upperChest',
            'leftShoulder', 'rightShoulder',
            'leftUpperArm', 'rightUpperArm',
            'leftLowerArm', 'rightLowerArm',
            'leftHand', 'rightHand',
            'leftEye', 'rightEye'
        ];
        for (const name of boneNames) {
            this.bones[name] = this.humanoid.getNormalizedBoneNode(name);
        }

        // 1. Probe Head Pitch (positive = nose DOWN)
        // VRM normalized head: local +X rotation pitches head down (nose y decreases)
        const head = this.bones.head;
        if (head) {
            head.getWorldPosition(_v1);
            _qOriginal.copy(head.quaternion);

            // Test +X rotation
            _qTest.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1);
            head.quaternion.multiply(_qTest);
            head.updateMatrixWorld(true);

            // Forward point: test a point in front of head (0, 0, 0.1) in local space
            const forwardPt = new THREE.Vector3(0, 0, 0.1).applyQuaternion(head.quaternion);
            head.quaternion.copy(_qOriginal);
            head.updateMatrixWorld(true);

            // If forwardPt.y < 0, +X tilts nose down -> sign is +1
            this.semantics.headPitch = { axis: 'x', sign: (forwardPt.y < 0 ? 1 : -1) };
            this.semantics.neckPitch = { axis: 'x', sign: this.semantics.headPitch.sign };
            this.semantics.spinePitch = { axis: 'x', sign: this.semantics.headPitch.sign };

            // Yaw: +Y rotation turns head toward +X (avatar left) -> positive = nose LEFT
            this.semantics.headYaw = { axis: 'y', sign: 1 };
            // Roll: +Z rotation tilts top of head toward -X (avatar right)
            this.semantics.headRoll = { axis: 'z', sign: 1 };
            this.semantics.spineRoll = { axis: 'z', sign: 1 };
        }

        // 2. Probe Shoulders
        // Left arm is at +X. A rotation around Z moves left shoulder/arm up or down.
        const leftShoulder = this.bones.leftShoulder;
        const leftUpperArm = this.bones.leftUpperArm;
        if (leftShoulder && leftUpperArm) {
            leftUpperArm.getWorldPosition(_v1);
            _qOriginal.copy(leftShoulder.quaternion);

            _qTest.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1);
            leftShoulder.quaternion.multiply(_qTest);
            leftShoulder.updateMatrixWorld(true);
            leftUpperArm.getWorldPosition(_v2);

            leftShoulder.quaternion.copy(_qOriginal);
            leftShoulder.updateMatrixWorld(true);

            // If _v2.y > _v1.y, +Z rotation lifts left shoulder up
            this.semantics.shoulderLift.left = {
                axis: 'z',
                sign: (_v2.y > _v1.y ? 1 : -1)
            };
        }

        const rightShoulder = this.bones.rightShoulder;
        const rightUpperArm = this.bones.rightUpperArm;
        if (rightShoulder && rightUpperArm) {
            rightUpperArm.getWorldPosition(_v1);
            _qOriginal.copy(rightShoulder.quaternion);

            _qTest.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1);
            rightShoulder.quaternion.multiply(_qTest);
            rightShoulder.updateMatrixWorld(true);
            rightUpperArm.getWorldPosition(_v2);

            rightShoulder.quaternion.copy(_qOriginal);
            rightShoulder.updateMatrixWorld(true);

            // If _v2.y > _v1.y, +Z rotation lifts right shoulder up
            this.semantics.shoulderLift.right = {
                axis: 'z',
                sign: (_v2.y > _v1.y ? 1 : -1)
            };
        }

        // 3. Finger Curl Defaults (normalized VRM: Left curl is -Z, Right curl is +Z)
        const fingers = ['thumb', 'index', 'middle', 'ring', 'little'];
        const joints = ['Proximal', 'Intermediate', 'Distal'];

        for (const side of ['left', 'right']) {
            const curlSign = (side === 'left') ? -1 : 1;
            for (const finger of fingers) {
                this.semantics.fingerCurl[side][finger] = {};
                for (const joint of joints) {
                    this.semantics.fingerCurl[side][finger][joint] = {
                        axis: (finger === 'thumb' && joint === 'Proximal') ? 'y' : 'z',
                        sign: curlSign
                    };
                }
            }
        }

        return this.semantics;
    }

    // ── Semantic Setters ──

    /**
     * Pitch head (positive = nose down).
     * @param {number} rad
     */
    setHeadPitch(rad) {
        if (!this.bones.head) return;
        const s = this.semantics.headPitch;
        this._applyRotation(this.bones.head, s.axis, rad * s.sign);
    }

    /**
     * Yaw head (positive = nose left / toward avatar's left +X).
     * @param {number} rad
     */
    setHeadYaw(rad) {
        if (!this.bones.head) return;
        const s = this.semantics.headYaw;
        this._applyRotation(this.bones.head, s.axis, rad * s.sign);
    }

    /**
     * Roll head (positive = tilt head right / top of head toward right -X).
     * @param {number} rad
     */
    setHeadRoll(rad) {
        if (!this.bones.head) return;
        const s = this.semantics.headRoll;
        this._applyRotation(this.bones.head, s.axis, rad * s.sign);
    }

    /**
     * Apply combined head pitch, yaw, roll cleanly.
     * @param {number} pitch - positive = down
     * @param {number} yaw - positive = left
     * @param {number} roll - positive = right tilt
     */
    setHeadAngles(pitch, yaw, roll) {
        if (!this.bones.head) return;
        const sp = this.semantics.headPitch.sign;
        const sy = this.semantics.headYaw.sign;
        const sr = this.semantics.headRoll.sign;

        _eulerWork.set(pitch * sp, yaw * sy, roll * sr, 'YXZ');
        _qWork.setFromEuler(_eulerWork);
        this.bones.head.quaternion.multiply(_qWork);
    }

    /**
     * Lift shoulder (positive = shoulder UP).
     * @param {'left'|'right'} side
     * @param {number} rad
     */
    setShoulderLift(side, rad) {
        const bone = (side === 'left') ? this.bones.leftShoulder : this.bones.rightShoulder;
        if (!bone) return;
        const s = this.semantics.shoulderLift[side];
        this._applyRotation(bone, s.axis, rad * s.sign);
    }

    /**
     * Protract shoulder (positive = shoulder forward +Z).
     * @param {'left'|'right'} side
     * @param {number} rad
     */
    setShoulderProtract(side, rad) {
        const bone = (side === 'left') ? this.bones.leftShoulder : this.bones.rightShoulder;
        if (!bone) return;
        const s = this.semantics.shoulderProtract[side];
        this._applyRotation(bone, s.axis, rad * s.sign);
    }

    _applyRotation(bone, axis, angle) {
        if (!bone) return;
        if (axis === 'x') _qWork.setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
        else if (axis === 'y') _qWork.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        else _qWork.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
        bone.quaternion.multiply(_qWork);
    }
}

// Global default semantics singleton
export const rigSemantics = new RigSemantics();
