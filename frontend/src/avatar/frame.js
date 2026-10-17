// ═══════════════════════════════════════════════════
//  AVATAR FRAME — Unified Body-Relative Coordinate System
//  Convention:
//    +X = avatar's anatomical left
//    +Y = avatar's up
//    +Z = forward (the direction the face points)
// ═══════════════════════════════════════════════════

import * as THREE from 'three';

export class AvatarFrame {
    constructor() {
        // Base coordinate frame measured at load
        this.origin = new THREE.Vector3(0, 0, 0); // usually chest world position
        this.forward = new THREE.Vector3(0, 0, 1);
        this.up = new THREE.Vector3(0, 1, 0);
        this.left = new THREE.Vector3(1, 0, 0);

        this.rotation = new THREE.Quaternion(); // world rotation of avatar frame
        this.invRotation = new THREE.Quaternion();

        // Scratch math objects (no allocations during runtime)
        this._vWork = new THREE.Vector3();
    }

    /**
     * Calibrate the avatar frame from real loaded VRM instance.
     * @param {object} vrm
     */
    init(vrm) {
        if (!vrm || !vrm.scene) return;

        vrm.scene.updateMatrixWorld(true);
        const humanoid = vrm.humanoid;
        if (!humanoid) return;

        const chest = humanoid.getNormalizedBoneNode('chest') ||
                      humanoid.getNormalizedBoneNode('spine');
        const head = humanoid.getNormalizedBoneNode('head');
        const lShoulder = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rShoulder = humanoid.getNormalizedBoneNode('rightUpperArm');

        if (chest) {
            chest.getWorldPosition(this.origin);
        }

        if (lShoulder && rShoulder) {
            const pL = new THREE.Vector3();
            const pR = new THREE.Vector3();
            lShoulder.getWorldPosition(pL);
            rShoulder.getWorldPosition(pR);

            // Left vector = direction from right shoulder to left shoulder
            this.left.subVectors(pL, pR).normalize();
            if (this.left.length() < 0.001) this.left.set(1, 0, 0);
        } else {
            this.left.set(1, 0, 0);
        }

        // Up vector is typically world up unless tilted
        this.up.set(0, 1, 0);

        // Forward = left x up (right-handed convention: left (+X) x up (+Y) = forward (+Z))
        this.forward.crossVectors(this.left, this.up).normalize();

        // Build rotation matrix from basis
        const m = new THREE.Matrix4().makeBasis(this.left, this.up, this.forward);
        this.rotation.setFromRotationMatrix(m);
        this.invRotation.copy(this.rotation).invert();
    }

    /**
     * Transform a point from avatar frame (relative to chest origin) to world coordinates.
     * @param {THREE.Vector3} avatarPos - in avatar coordinates (x=left, y=up, z=forward)
     * @param {THREE.Vector3} [out]
     * @returns {THREE.Vector3}
     */
    toWorld(avatarPos, out = new THREE.Vector3()) {
        return out.copy(avatarPos)
            .applyQuaternion(this.rotation)
            .add(this.origin);
    }

    /**
     * Transform a point from world coordinates to avatar frame (relative to chest origin).
     * @param {THREE.Vector3} worldPos
     * @param {THREE.Vector3} [out]
     * @returns {THREE.Vector3}
     */
    fromWorld(worldPos, out = new THREE.Vector3()) {
        return out.copy(worldPos)
            .sub(this.origin)
            .applyQuaternion(this.invRotation);
    }

    /**
     * Transform a direction vector from avatar frame to world frame (no translation).
     * @param {THREE.Vector3} avatarDir
     * @param {THREE.Vector3} [out]
     * @returns {THREE.Vector3}
     */
    toWorldDirection(avatarDir, out = new THREE.Vector3()) {
        return out.copy(avatarDir).applyQuaternion(this.rotation);
    }

    /**
     * Transform a direction vector from world frame to avatar frame (no translation).
     * @param {THREE.Vector3} worldDir
     * @param {THREE.Vector3} [out]
     * @returns {THREE.Vector3}
     */
    fromWorldDirection(worldDir, out = new THREE.Vector3()) {
        return out.copy(worldDir).applyQuaternion(this.invRotation);
    }
}

// Global default avatar frame singleton
export const avatarFrame = new AvatarFrame();
