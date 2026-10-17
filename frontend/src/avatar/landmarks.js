// ═══════════════════════════════════════════════════
//  LANDMARKS & BODY DIMENSIONS (v2)
//  Expresses targets relative to character's own landmarks & limbs (U units)
//  Never hard-code magic numbers in meters!
// ═══════════════════════════════════════════════════

import * as THREE from 'three';
import { avatarFrame } from './frame.js';

export class AvatarLandmarks {
    constructor() {
        this.U = 0.25; // Upper arm length (meters)
        this.F = 0.23; // Forearm length (meters)
        this.R = 0.48; // Total arm reach (U + F)
        this.shoulderWidth = 0.16;
        this.torsoHeight = 0.38;

        // Shoulder joints in world space
        this.shoulderLeft = new THREE.Vector3(0.08, 1.25, 0.0);
        this.shoulderRight = new THREE.Vector3(-0.08, 1.25, 0.0);
        this.midShoulder = new THREE.Vector3(0.0, 1.25, 0.0);

        // Body landmarks (world space, refreshed from live bone poses)
        this.chest = new THREE.Vector3(0.0, 1.06, 0.02);
        this.sternum = new THREE.Vector3(0.0, 1.18, 0.04);
        this.belly = new THREE.Vector3(0.0, 0.92, 0.06);
        this.chin = new THREE.Vector3(0.0, 1.26, 0.10);
        this.mouth = new THREE.Vector3(0.0, 1.31, 0.11);
        this.forehead = new THREE.Vector3(0.0, 1.42, 0.10);
        this.headCenter = new THREE.Vector3(0.0, 1.34, 0.0);
        this.headRadius = 0.12;

        // Torso ellipsoid parameters
        this.torsoCenter = new THREE.Vector3(0.0, 1.08, 0.0);
        this.torsoRadii = new THREE.Vector3(0.16, 0.22, 0.14); // rx (half-width), ry (half-height), rz (half-depth)

        // Scratch math objects
        this._vWork = new THREE.Vector3();
    }

    /**
     * Calibrate landmarks and limb lengths from VRM.
     * @param {object} vrm
     */
    calibrate(vrm) {
        if (!vrm || !vrm.humanoid) return;

        vrm.scene.updateMatrixWorld(true);
        const h = vrm.humanoid;

        const lUpper = h.getNormalizedBoneNode('leftUpperArm');
        const lLower = h.getNormalizedBoneNode('leftLowerArm');
        const lHand = h.getNormalizedBoneNode('leftHand');
        const rUpper = h.getNormalizedBoneNode('rightUpperArm');
        const chest = h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('spine');
        const head = h.getNormalizedBoneNode('head');

        if (lUpper && lLower) {
            const p1 = new THREE.Vector3();
            const p2 = new THREE.Vector3();
            lUpper.getWorldPosition(p1);
            lLower.getWorldPosition(p2);
            this.U = Math.max(0.15, p1.distanceTo(p2));
        }

        if (lLower && lHand) {
            const p1 = new THREE.Vector3();
            const p2 = new THREE.Vector3();
            lLower.getWorldPosition(p1);
            lHand.getWorldPosition(p2);
            this.F = Math.max(0.15, p1.distanceTo(p2));
        }

        this.R = this.U + this.F;

        if (lUpper && rUpper) {
            lUpper.getWorldPosition(this.shoulderLeft);
            rUpper.getWorldPosition(this.shoulderRight);
            this.midShoulder.addVectors(this.shoulderLeft, this.shoulderRight).multiplyScalar(0.5);
            this.shoulderWidth = this.shoulderLeft.distanceTo(this.shoulderRight);
        }

        if (chest) {
            chest.getWorldPosition(this.chest);
            this.sternum.set(this.midShoulder.x, this.midShoulder.y - 0.25 * this.U, this.midShoulder.z + 0.04);
            this.belly.set(this.midShoulder.x, this.midShoulder.y - 1.30 * this.U, this.midShoulder.z + 0.06);
            this.torsoCenter.set(this.chest.x, this.chest.y, this.chest.z);
            this.torsoRadii.set(
                Math.max(0.14, this.shoulderWidth * 0.42),
                this.U * 0.85,
                0.14
            );
        }

        if (head) {
            head.getWorldPosition(this.headCenter);
            this.chin.set(this.headCenter.x, this.headCenter.y - 0.08, this.headCenter.z + 0.09);
            this.mouth.set(this.headCenter.x, this.headCenter.y - 0.03, this.headCenter.z + 0.10);
            this.forehead.set(this.headCenter.x, this.headCenter.y + 0.08, this.headCenter.z + 0.09);
        }
    }

    /**
     * Convert wrist offset in units of U (outward, up, forward) from the shoulder to world space.
     * @param {'left'|'right'} side
     * @param {number[]} offsetU - [outward, up, forward] in U units
     * @param {THREE.Vector3} [out]
     * @returns {THREE.Vector3} world target
     */
    offsetToWorld(side, offsetU, out = new THREE.Vector3()) {
        const isLeft = (side === 'left');
        const shoulder = isLeft ? this.shoulderLeft : this.shoulderRight;

        // In avatar frame:
        // Left arm: outward = +X
        // Right arm: outward = -X
        const sign = isLeft ? 1 : -1;

        const dx = offsetU[0] * this.U * sign;
        const dy = offsetU[1] * this.U;
        const dz = offsetU[2] * this.U;

        this._vWork.set(dx, dy, dz);
        avatarFrame.toWorldDirection(this._vWork, out);
        out.add(shoulder);

        return out;
    }
}

export const avatarLandmarks = new AvatarLandmarks();
